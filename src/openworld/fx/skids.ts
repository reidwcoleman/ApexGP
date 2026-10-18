import * as THREE from 'three';
import type { CarBody } from '../sim/car.ts';

/**
 * Tyre marks: every wheel that slides (locked, spinning up, drifting past the peak) lays rubber on
 * the road behind it; a wheel on a lawn or the beach cuts a rut whether it slides or not. One ring
 * buffer of quads (the oldest marks go as new ones are laid), one draw. A mark is darker the harder
 * the tyre slid, fades toward its ends, and barely shows on a wet road.
 */

const QUADS = 9000;
const WIDTH = 0.24;

interface Track {
  x: number;
  y: number;
  z: number;
  on: boolean;
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private head = 0;
  private written = 0;
  private dirty = false;
  private readonly tracks = new WeakMap<CarBody, Track[]>();

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(QUADS * 4 * 3);
    this.col = new Float32Array(QUADS * 4 * 4);
    const idx = new Uint32Array(QUADS * 6);
    for (let q = 0; q < QUADS; q++) {
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'skids';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** a car's wheels this frame (wet: 0..1 — the rain washes the marks out) */
  add(b: CarBody, wet: number) {
    let tr = this.tracks.get(b);
    if (!tr) this.tracks.set(b, (tr = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, on: false }))));
    const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
    const tp = Math.tan(b.groundPitch), tq = Math.tan(b.groundRoll);
    const tw = b.spec.track ?? b.spec.hw - 0.12;
    for (let i = 0; i < 4; i++) {
      const t = tr[i];
      const lx = i % 2 === 0 ? tw : -tw, lz = i < 2 ? b.spec.a : -b.spec.b;
      const x = b.pos.x + sy * lz + cy * lx, z = b.pos.z + cy * lz - sy * lx;
      const y = b.pos.y + lz * tp + lx * tq + b.wDrop[i] + 0.025;
      const down = !b.free && b.onGround && !b.inWater && b.wLoad[i] > 50;
      const soft = b.wGrip[i] < 0.7;
      // rubber past the peak slip; a rut in soft ground; a rim's gouge
      const flat = (b.flats >> i) & 1;
      let k = down ? THREE.MathUtils.clamp((b.wSlip[i] - 1.05) * 1.4, 0, 1) : 0;
      if (down && soft && b.speed > 1) k = Math.max(k, 0.45);
      if (down && flat && b.speed > 2) k = Math.max(k, 0.7);
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz);
      if (d > 4) {
        // (a jump in place: a respawn, a new car)
        t.x = x;
        t.y = y;
        t.z = z;
        t.on = false;
        continue;
      }
      if (d < 0.18 && k > 0 && t.on) continue;
      if (k > 0 && t.on && d > 1e-3) {
        const a = k * (soft ? 0.75 : 0.62) * (1 - 0.7 * wet);
        const [r, g, bl] = soft ? [0.09, 0.07, 0.04] : [0.012, 0.012, 0.013];
        const w = (flat ? 0.12 : WIDTH) * 0.5;
        const nx = (-dz / d) * w, nz = (dx / d) * w;
        this.quad(t.x + nx, t.y, t.z + nz, t.x - nx, t.y, t.z - nz, x + nx, y, z + nz, x - nx, y, z - nz, r, g, bl, a);
      }
      t.x = x;
      t.y = y;
      t.z = z;
      t.on = k > 0;
    }
  }

  private quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, r: number, g: number, b: number, a: number) {
    const q = this.head;
    this.head = (this.head + 1) % QUADS;
    this.written++;
    const p = this.pos, c = this.col, o = q * 12, oc = q * 16;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    p[o + 9] = dx; p[o + 10] = dy; p[o + 11] = dz;
    for (let v = 0; v < 4; v++) {
      c[oc + v * 4] = r;
      c[oc + v * 4 + 1] = g;
      c[oc + v * 4 + 2] = b;
      // (the tread's edges softer than its middle: the outer vertices a shade lighter)
      c[oc + v * 4 + 3] = a;
    }
    this.dirty = true;
  }

  /** upload the new marks (and fade the oldest so the ring's seam doesn't pop) */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.mesh.geometry;
    const pa = g.getAttribute('position') as THREE.BufferAttribute, ca = g.getAttribute('color') as THREE.BufferAttribute;
    // the quads about to be overwritten fade toward the seam
    const c = this.col, FADE = 300;
    for (let k = 0; k < FADE; k++) {
      const q = (this.head + k) % QUADS;
      for (let v = 0; v < 4; v++) c[q * 16 + v * 4 + 3] = Math.min(c[q * 16 + v * 4 + 3], (k / FADE) * 0.7);
    }
    // only what changed goes up: from where this frame started writing to the end of the fade
    const len = Math.min(QUADS, this.written + FADE);
    const start = (((this.head - this.written) % QUADS) + QUADS) % QUADS, end = start + len;
    pa.clearUpdateRanges();
    ca.clearUpdateRanges();
    for (const [a, b] of end <= QUADS ? [[start, end]] : [[start, QUADS], [0, end - QUADS]]) {
      pa.addUpdateRange(a * 12, (b - a) * 12);
      ca.addUpdateRange(a * 16, (b - a) * 16);
    }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    this.written = 0;
  }
}
