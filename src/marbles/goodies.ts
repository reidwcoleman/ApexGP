import * as THREE from 'three';
import type { Course } from './courses.ts';
import { Mode, type Marble, type World } from './physics.ts';
import { glowMat } from './obs-world.ts';

/**
 * Goodie boxes: rows of them along every race. Run through one and it goes off at once, no button:
 *
 *  ZOOM    a few seconds of extra running speed
 *  SPRING  a few seconds of higher jumps
 *  BONK    a shockwave that knocks over everyone close
 *  BUBBLE  a few seconds in which nothing can knock you over
 *
 * Where they stand is the same in every browser (hashed from the course); each browser runs them
 * for its own beans, so nothing here goes over the network except a bonk's shoves (World.shoves).
 */
export const GOODIE = { every: 34, back: 5, zoomT: 3.2, zoomK: 1.28, springT: 5, springK: 1.32, bubbleT: 5, bonkR: 5.5 };
export type Goodie = 'ZOOM' | 'SPRING' | 'BONK' | 'BUBBLE';
const COLOR: Record<Goodie, number> = { ZOOM: 0x2fe06a, SPRING: 0xffd21f, BONK: 0xff4f6a, BUBBLE: 0x2fa8ff };

interface Who {
  c: { id: number; player: boolean; human: boolean };
  m: Marble;
  out: boolean;
  fell: number;
  local: boolean;
}
interface Box {
  x: number;
  y: number;
  z: number;
  /** back at this world time */
  back: number;
}

const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();

/** a present: a ribbon both ways and a star where they cross (the box's colour tints the paper) */
function giftTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(0, 0, 0, 0.16)';
  for (let i = -128; i < 128; i += 32) {
    x.beginPath();
    x.moveTo(i, 128);
    x.lineTo(i + 16, 128);
    x.lineTo(i + 144, 0);
    x.lineTo(i + 128, 0);
    x.closePath();
    x.fill();
  }
  x.fillStyle = '#fff6c8';
  x.fillRect(50, 0, 28, 128);
  x.fillRect(0, 50, 128, 28);
  x.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 13 : 30;
    x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  x.closePath();
  x.fillStyle = '#ffffff';
  x.fill();
  x.lineWidth = 5;
  x.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Goodies {
  private boxes: Box[] = [];
  private mesh: THREE.InstancedMesh;
  private halo: THREE.InstancedMesh;
  private bubbles = new Map<number, THREE.Mesh>();
  private bubbleG = new THREE.SphereGeometry(1.15, 20, 14);
  private bubbleM = new THREE.MeshPhysicalMaterial({ color: 0x8ad0ff, transparent: true, opacity: 0.28, roughness: 0.1, clearcoat: 1, depthWrite: false });
  /** what went off this frame, for the show to play */
  fired: { r: Who; what: Goodie }[] = [];

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    const P = course.path!;
    const seed = [...course.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 100000;
    const gap = (s: number) => course.gaps.some(([a, b]) => s > a - 4 && s < b + 4);
    for (let s = 26, row = 0; s < course.finishS - 14; s += GOODIE.every, row++) {
      if (gap(s)) continue;
      const i = P.index(s);
      const half = P.sec[i].w / 2 - 1.4;
      const n = half > 3 ? 3 : half > 1 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const lat = n === 1 ? 0 : -half + (2 * half * k) / (n - 1) + (hash(seed + row, k) - 0.5) * 0.8;
        const p = P.at(s, lat, 1.15);
        this.boxes.push({ x: p.x, y: p.y, z: p.z, back: 0 });
      }
    }
    const n = Math.max(1, this.boxes.length);
    const mat = new THREE.MeshPhysicalMaterial({ map: giftTexture(), roughness: 0.25, clearcoat: 1, emissive: 0x303030, emissiveIntensity: 0.5 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let k = 0; k < n; k++) this.mesh.setColorAt(k, C.set(0xffffff));
    this.halo = new THREE.InstancedMesh(new THREE.TorusGeometry(0.95, 0.05, 8, 28), glowMat(0xffffff, 2.2), n);
    this.halo.frustumCulled = false;
    scene.add(this.mesh, this.halo);
  }

  dispose() {
    this.scene.remove(this.mesh, this.halo);
    for (const b of this.bubbles.values()) this.scene.remove(b);
    this.bubbles.clear();
  }

  /** a bot never gets a spring (its jumps are sums worked out for a normal hop), and rarely a bonk */
  private roll(r: Who): Goodie {
    const u = Math.random();
    if (r.c.human) return u < 0.34 ? 'ZOOM' : u < 0.6 ? 'SPRING' : u < 0.8 ? 'BONK' : 'BUBBLE';
    return u < 0.55 ? 'ZOOM' : u < 0.7 ? 'BONK' : 'BUBBLE';
  }

  /** this browser's beans through the boxes; a box is gone for a few seconds after */
  update(t: number, w: World) {
    this.fired.length = 0;
    for (const r of this.who()) {
      if (!r.local || r.out || r.fell || !r.m.active) continue;
      const m = r.m;
      if (m.zoomT > t) m.boostK = GOODIE.zoomK;
      else m.boostK = 1;
      m.hopK = m.springT > t ? GOODIE.springK : 1;
      for (const b of this.boxes) {
        if (b.back > t) continue;
        const dx = m.pos.x - b.x, dz = m.pos.z - b.z, dy = m.pos.y - b.y;
        if (dx * dx + dz * dz > 1.9 || Math.abs(dy) > 1.7) continue;
        b.back = t + GOODIE.back;
        const what = this.roll(r);
        this.give(r, what, t, w);
        this.fired.push({ r, what });
      }
    }
  }

  private give(r: Who, what: Goodie, t: number, w: World) {
    const m = r.m;
    if (what === 'ZOOM') m.zoomT = t + GOODIE.zoomT;
    else if (what === 'SPRING') m.springT = t + GOODIE.springT;
    else if (what === 'BUBBLE') {
      m.guardT = GOODIE.bubbleT;
      m.bubbleT = t + GOODIE.bubbleT;
    } else {
      for (const o of this.who()) {
        if (o === r || o.out || o.fell || !o.m.active) continue;
        const dx = o.m.pos.x - m.pos.x, dz = o.m.pos.z - m.pos.z, d = Math.hypot(dx, dz);
        if (d > GOODIE.bonkR || d < 0.05 || Math.abs(o.m.pos.y - m.pos.y) > 3) continue;
        const k = 9 * (1.1 - d / GOODIE.bonkR);
        if (o.m.puppet) w.shoves.push({ target: o.m, kind: 'knock', vx: (dx / d) * k, vy: 5, vz: (dz / d) * k });
        else {
          o.m.vel.x += (dx / d) * k;
          o.m.vel.z += (dz / d) * k;
          o.m.vel.y += 5;
          o.m.knock(0.8);
        }
      }
    }
  }

  static color(what: Goodie) {
    return COLOR[what];
  }

  /** the boxes turning through the colours, and a bubble round anyone in one */
  sync(t: number) {
    let i = 0;
    for (const b of this.boxes) {
      const up = b.back <= t;
      const grow = up ? 1 : 0.001;
      Q.setFromEuler(E.set(0.5, t * 1.8 + i, 0.5));
      V.set(b.x, b.y + Math.sin(t * 2.6 + i) * 0.14, b.z);
      this.mesh.setMatrixAt(i, M.compose(V, Q, S.setScalar(grow)));
      this.mesh.setColorAt(i, C.setHSL((t * 0.22 + i * 0.13) % 1, 1, 0.5));
      Q.setFromEuler(E.set(Math.PI / 2, 0, t));
      this.halo.setMatrixAt(i, M.compose(V, Q, S.setScalar(grow * (1 + 0.08 * Math.sin(t * 5 + i)))));
      i++;
    }
    this.mesh.count = this.halo.count = i;
    this.mesh.instanceMatrix.needsUpdate = this.halo.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const r of this.who()) {
      const on = r.m.bubbleT > t && !r.out && !r.fell && r.m.mode !== Mode.Tumble;
      let s = this.bubbles.get(r.c.id);
      if (!s && on) {
        s = new THREE.Mesh(this.bubbleG, this.bubbleM);
        this.scene.add(s);
        this.bubbles.set(r.c.id, s);
      }
      if (!s) continue;
      s.visible = on;
      if (on) s.position.set(r.m.pos.x, r.m.pos.y + 0.32, r.m.pos.z);
    }
  }
}
