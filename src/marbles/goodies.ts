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
export const GOODIE = { every: 34, back: 5, arena: 6, arenaBack: 13, zoomT: 3.2, zoomK: 1.28, springT: 5, springK: 1.32, bubbleT: 5, bonkR: 5.5 };
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
  private backT: number = GOODIE.back;
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
    const P = course.path;
    const seed = [...course.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 100000;
    const gap = (s: number) => course.gaps.some(([a, b]) => s > a - 4 && s < b + 4);
    // (an arena: a ring of them round the floor, worth fighting over, and slower to come back)
    if (!P) {
      const pl = course.plate!;
      this.backT = GOODIE.arenaBack;
      for (let k = 0; k < GOODIE.arena; k++) {
        const a = (k / GOODIE.arena) * Math.PI * 2 + 0.4, r = pl.radius * 0.6;
        this.boxes.push({ x: pl.center.x + Math.cos(a) * r, y: pl.center.y + 1.15, z: pl.center.z + Math.sin(a) * r, back: 0 });
      }
    }
    for (let s = 26, row = 0; P && s < course.finishS - 14; s += GOODIE.every, row++) {
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
        b.back = t + this.backT;
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
        const k = 6 * (1.1 - d / GOODIE.bonkR);
        if (o.m.puppet) w.shoves.push({ target: o.m, kind: 'knock', vx: (dx / d) * k, vy: 3.2, vz: (dz / d) * k });
        else {
          o.m.vel.x += (dx / d) * k;
          o.m.vel.z += (dz / d) * k;
          o.m.vel.y += 3.2;
          o.m.knock(0.55);
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

/**
 * Stars: trails of them along the risky lines of a race, arcs of them over every jump. They're yours
 * alone (each browser has its own), and every STARS.zoom of them is a burst of speed.
 */
export const STARS = { zoom: 10, burst: 2.6, r: 1.45 };

function starGeo() {
  const sh = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2, r = k % 2 ? 0.14 : 0.33;
    if (k === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, steps: 1 });
  g.center();
  return g;
}

export class Stars {
  private mesh: THREE.InstancedMesh;
  private spots: { x: number; y: number; z: number; got: boolean; pop: number }[] = [];
  constructor(
    c: Course,
    private scene: THREE.Scene,
  ) {
    const path = c.path!;
    const add = (v: THREE.Vector3) => this.spots.push({ x: v.x, y: v.y, z: v.z, got: false, pop: 0 });
    for (const v of c.b.starSpots) add(v);
    // lines of them near the open edges, where it's a risk to go
    let side = 1;
    const first = (c.checkpoints[0] ?? 40) + 14, end = c.finishS - 18;
    for (let s = first; s < end; s += 27) {
      let ok = true;
      for (let q = 0; q <= 10 && ok; q += 2) {
        const sec = path.sec[path.index(s + q)];
        ok = sec.floor && sec.w > 8;
      }
      if (!ok || c.gaps.some(([a, e]) => s + 12 > a && s - 2 < e)) continue;
      const w = path.sec[path.index(s)].w;
      for (let q = 0; q < 5; q++) add(path.at(s + q * 2.4, side * (w / 2 - 1.8), 1));
      side = -side;
    }
    // and an arc over every jump
    for (const [a, e] of c.gaps) {
      if (e - a < 2.5 || e - a > 14) continue;
      for (let q = 1; q < 6; q++) {
        const k = q / 6;
        add(path.at(a + (e - a) * k, 0, 1.4 + Math.sin(k * Math.PI) * 1.6));
      }
    }
    this.mesh = new THREE.InstancedMesh(starGeo(), new THREE.MeshPhysicalMaterial({ color: 0xffd84a, roughness: 0.3, metalness: 0.1, emissive: 0xffb820, emissiveIntensity: 0.75, clearcoat: 1 }), Math.max(1, this.spots.length));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }
  /** the stars a bean has just picked up */
  take(m: Marble, t: number) {
    let n = 0;
    for (const s of this.spots) {
      if (s.got) continue;
      const dx = m.pos.x - s.x, dy = m.pos.y + 0.2 - s.y, dz = m.pos.z - s.z;
      if (dx * dx + dz * dz > STARS.r * STARS.r || Math.abs(dy) > 1.9) continue;
      s.got = true;
      s.pop = t;
      n++;
    }
    return n;
  }
  sync(t: number) {
    let i = 0;
    for (const s of this.spots) {
      const q = s.got ? (t - s.pop) / 0.28 : -1;
      // (taken: it swells and is gone)
      if (q >= 1) continue;
      const k = q < 0 ? 1 + Math.sin(t * 3 + i) * 0.06 : 1.5 * (1 - q);
      Q.setFromEuler(E.set(0, t * 2.4 + i * 0.7, 0));
      V.set(s.x, s.y + Math.sin(t * 2.2 + i) * 0.1 + (q > 0 ? q * 0.9 : 0), s.z);
      this.mesh.setMatrixAt(i++, M.compose(V, Q, S.setScalar(k)));
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
