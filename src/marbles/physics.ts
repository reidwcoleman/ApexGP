import * as THREE from 'three';

/**
 * The physics of the show. Every contestant is a bean: a body that stands, runs, jumps, dives,
 * grabs and, when something hits it hard enough, goes over and tumbles like a ball until it can get
 * back up. Standing, it is two spheres (the feet and the head, one above the other) against the
 * course's static triangles, the analytic moving shapes (sweepers, hammers, turntables, pegs,
 * bumpers) and the other beans (capsule on capsule); running is a velocity controller relative to
 * whatever it stands on, so a turntable carries it, a conveyor fights it and a booster bed flings it.
 * Tumbling, it is a solid ball again (I = 2/5·m·r²): impulses at the contact point, real rolling.
 * A puppet is a bean someone else simulates (a player online, or a bot on the host): it pushes the
 * local beans about and is moved only by the network. Fixed substeps (≤ 1/240 s).
 */

export const RADIUS = 0.5;
export const GRAVITY = 24;
const SUB = 1 / 240;
/** a tumbling bean's roll (the old marble's: angular acceleration and top spin) */
const ROLL_ACC = 92;
const ROLL_MAX = 29;
export const JUMP_V = 8.6;
const IR = 0.4 * RADIUS * RADIUS;
/** running: top speed on the flat (m/s), how fast it gets there, and the push it has in the air */
export const RUN = 9.4;
const RUN_K = 11;
const RUN_ACC = 70;
const AIR_ACC = 15;
/** the head sphere: its centre above the feet sphere's, and its radius; the body's for bean on bean */
export const HEAD_UP = 0.62;
const HEAD_R = 0.4;
const BODY_R = 0.44;
/** the dive: its launch speed, and the wait before the next */
export const DIVE_V = 12.5;
export const DASH_CD = 1.2;
/** grabbing: reach, how long a hold lasts, the wait after */
const GRAB_REACH = 1.45;
const GRAB_T = 2.6;
const GRAB_CD = 1.0;

export const enum Mat {
  Wood = 0,
  Paint = 1,
  Bumper = 2,
  Metal = 3,
  Felt = 4,
}
/** restitution and friction per surface */
const MATS = [
  { e: 0.3, mu: 0.75 },
  { e: 0.42, mu: 0.6 },
  { e: 0.75, mu: 0.4 },
  { e: 0.5, mu: 0.3 },
  { e: 0.08, mu: 1.1 },
];

export interface Hit {
  /** 'glass': bean on bean; 'surface': bean on the course or an obstacle */
  kind: 'glass' | 'surface';
  mat: Mat;
  /** closing speed along the normal (m/s) */
  speed: number;
  x: number;
  y: number;
  z: number;
  /** the surface normal's up component (1: a floor, 0: a wall) */
  ny: number;
  a: Marble;
  b?: Marble;
  kin?: Kin;
}

/** something a local bean did to a puppet (the game tells its owner) */
export interface Shove {
  target: Marble;
  kind: 'knock' | 'grab';
  vx: number;
  vy: number;
  vz: number;
}

export const enum Mode {
  Run = 0,
  Dive = 1,
  Tumble = 2,
}

/** a contestant's body (the name stays from the marble days: the AI and the show speak of marbles) */
export class Marble {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly ang = new THREE.Vector3();
  /** the tumble's orientation (standing, the body is upright and turned to `yaw`) */
  readonly quat = new THREE.Quaternion();
  /** desired run direction (horizontal, world), length 0..1 */
  readonly input = new THREE.Vector3();
  jump = false;
  dash = false;
  /** the grab button, held */
  grab = false;
  /** seconds since a contact that counts as ground */
  groundT = 1;
  readonly groundN = new THREE.Vector3(0, 1, 0);
  /** the velocity of what it stands on (a turntable, a conveyor, a roller bed) */
  readonly groundVel = new THREE.Vector3();
  groundMat: Mat = Mat.Wood;
  dashCD = 0;
  /** in the simulation at all */
  active = true;
  /** held in place (the start gate, a respawn) */
  frozen = false;
  /** simulated elsewhere: the network moves it */
  puppet = false;
  mode: Mode = Mode.Run;
  /** facing (rad, atan2(x, z)) */
  yaw = 0;
  /** time left in a tumble; time into a dive */
  tumbleT = 0;
  diveT = 0;
  /** getting up after a dive or a tumble (no running yet) */
  upT = 0;
  /** the bean it holds, and how long it has; being held (seconds left, refreshed by the holder) */
  holding: Marble | null = null;
  holdT = 0;
  grabCD = 0;
  heldT = 0;
  /** per-partner sound cooldowns */
  readonly quiet = new Map<unknown, number>();
  /** this frame: jumped, dived, knocked over, landed (speed), grabbed someone */
  hopped = false;
  dashed = false;
  knocked = false;
  landed = 0;
  grabbed = false;
  constructor(readonly id: number) {}
  get grounded() {
    return this.groundT < 0.1;
  }
  /** knocked over: a tumble of `t` seconds (longer if it's already going) */
  knock(t: number) {
    if (this.puppet || this.frozen) return;
    if (this.mode !== Mode.Tumble) {
      this.mode = Mode.Tumble;
      this.knocked = true;
      // (start it rolling the way it's flying, from upright)
      this.quat.setFromAxisAngle(UP, this.yaw);
      this.ang.set(this.vel.z, 0, -this.vel.x).multiplyScalar(1 / RADIUS);
      this.ang.y += (Math.random() - 0.5) * 8;
      this.release();
    }
    this.tumbleT = Math.max(this.tumbleT, t);
  }
  release() {
    if (this.holding) this.grabCD = GRAB_CD;
    this.holding = null;
    this.holdT = 0;
  }
}

export type Shape = { type: 'box'; hx: number; hy: number; hz: number } | { type: 'cyl'; r: number; hh: number } | { type: 'sph'; r: number };

/** an analytic collider; its pose is a pure function of time, so the AI can look ahead */
export class Kin {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly m = new THREE.Matrix4();
  readonly prev = new THREE.Matrix4();
  readonly inv = new THREE.Matrix4();
  /** bounding radius around pos */
  readonly bound: number;
  enabled = true;
  /** extra outward speed on a hit (the bumpers) */
  kick = 0;
  onHit?: (m: Marble, speed: number) => void;
  /** last hit time (for a flash) */
  lastHit = -10;
  constructor(
    readonly shape: Shape,
    readonly mat: Mat,
    readonly pose: ((t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => void) | null = null,
  ) {
    this.bound = shape.type === 'box' ? Math.hypot(shape.hx, shape.hy, shape.hz) : shape.type === 'cyl' ? Math.hypot(shape.r, shape.hh) : shape.r;
  }
  set(t: number) {
    if (this.pose) this.pose(t, this.pos, this.quat);
    this.m.compose(this.pos, this.quat, ONE);
    this.inv.copy(this.m).invert();
  }
}
const ONE = new THREE.Vector3(1, 1, 1);

/** the course's static triangles in a hashed grid */
export class StaticMesh {
  private tri: number[] = [];
  private mats: number[] = [];
  private T = new Float32Array(0);
  private M = new Uint8Array(0);
  private cells = new Map<number, number[]>();
  private stamp = new Uint32Array(0);
  private stampN = 1;
  readonly cell = 2;
  minY = Infinity;
  add(pos: ArrayLike<number>, index: ArrayLike<number> | null, mat: Mat, matrix?: THREE.Matrix4) {
    const v = new THREE.Vector3();
    const P: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]);
      if (matrix) v.applyMatrix4(matrix);
      P.push(v.x, v.y, v.z);
    }
    const n = index ? index.length : P.length / 3;
    for (let k = 0; k < n; k += 3) {
      for (let j = 0; j < 3; j++) {
        const i = index ? index[k + j] : k + j;
        this.tri.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      }
      this.mats.push(mat);
    }
  }
  addGeometry(g: THREE.BufferGeometry, mat: Mat, matrix?: THREE.Matrix4) {
    this.add(g.getAttribute('position').array, g.index ? g.index.array : null, mat, matrix);
  }
  build() {
    this.T = new Float32Array(this.tri);
    this.M = new Uint8Array(this.mats);
    this.tri = [];
    this.mats = [];
    const n = this.M.length;
    this.stamp = new Uint32Array(n);
    const c = this.cell;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const T = this.T;
      const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
      const y0 = Math.min(T[o + 1], T[o + 4], T[o + 7]), y1 = Math.max(T[o + 1], T[o + 4], T[o + 7]);
      const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
      this.minY = Math.min(this.minY, y0);
      // (degenerate slivers from collapsed profiles never collide)
      const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
      const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      if (cx * cx + cy * cy + cz * cz < 1e-10) continue;
      for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++)
        for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++)
          for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
            const k = key(ix, iy, iz);
            let l = this.cells.get(k);
            if (!l) this.cells.set(k, (l = []));
            l.push(t);
          }
    }
  }
  /** calls f(triangle, material) for each triangle near the sphere */
  query(p: THREE.Vector3, r: number, f: (o: number, mat: Mat) => void) {
    const c = this.cell;
    const s = ++this.stampN;
    for (let ix = Math.floor((p.x - r) / c); ix <= Math.floor((p.x + r) / c); ix++)
      for (let iy = Math.floor((p.y - r) / c); iy <= Math.floor((p.y + r) / c); iy++)
        for (let iz = Math.floor((p.z - r) / c); iz <= Math.floor((p.z + r) / c); iz++) {
          const l = this.cells.get(key(ix, iy, iz));
          if (!l) continue;
          for (const t of l) {
            if (this.stamp[t] === s) continue;
            this.stamp[t] = s;
            f(t * 9, this.M[t] as Mat);
          }
        }
  }
  get tris() {
    return this.T;
  }
  /** the highest surface below (x, y, z) within `depth` (−Infinity: none) */
  floorBelow(x: number, y: number, z: number, depth: number): number {
    const c = this.cell, T = this.T;
    const ix = Math.floor(x / c), iz = Math.floor(z / c);
    let best = -Infinity;
    const s = ++this.stampN;
    for (let iy = Math.floor(y / c); iy >= Math.floor((y - depth) / c); iy--) {
      const l = this.cells.get(key(ix, iy, iz));
      if (!l) continue;
      for (const t of l) {
        if (this.stamp[t] === s) continue;
        this.stamp[t] = s;
        const o = t * 9;
        // the vertical line through (x, z) against the triangle (barycentric in xz)
        const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const h = l1 * T[o + 1] + l2 * T[o + 4] + l3 * T[o + 7];
        if (h <= y && h >= y - depth && h > best) best = h;
      }
      if (best > -Infinity) return best;
    }
    return best;
  }
}
const key = (x: number, y: number, z: number) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;

const CP = new THREE.Vector3();
const N = new THREE.Vector3();
const R = new THREE.Vector3();
const VC = new THREE.Vector3();
const VT = new THREE.Vector3();
const TMP = new THREE.Vector3();
const L = new THREE.Vector3();
const LP = new THREE.Vector3();
const LN = new THREE.Vector3();
const SV = new THREE.Vector3();
const W0 = new THREE.Vector3();
const QD = new THREE.Quaternion();

/** closest point on triangle (a, b, c) to p (Ericson) */
function closestOnTri(T: Float32Array, o: number, px: number, py: number, pz: number, out: THREE.Vector3) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const abx = T[o + 3] - ax, aby = T[o + 4] - ay, abz = T[o + 5] - az;
  const acx = T[o + 6] - ax, acy = T[o + 7] - ay, acz = T[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return out.set(ax, ay, az);
  const bpx = px - T[o + 3], bpy = py - T[o + 4], bpz = pz - T[o + 5];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return out.set(T[o + 3], T[o + 4], T[o + 5]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return out.set(ax + abx * v, ay + aby * v, az + abz * v);
  }
  const cpx = px - T[o + 6], cpy = py - T[o + 7], cpz = pz - T[o + 8];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return out.set(T[o + 6], T[o + 7], T[o + 8]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return out.set(ax + acx * w, ay + acy * w, az + acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
    return out.set(bx + (T[o + 6] - bx) * w, by + (T[o + 7] - by) * w, bz + (T[o + 8] - bz) * w);
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return out.set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

/** closest point on a shape's surface in its own frame; returns the signed distance (negative: inside) */
function closestOnShape(s: Shape, p: THREE.Vector3, out: THREE.Vector3, n: THREE.Vector3): number {
  if (s.type === 'sph') {
    const d = p.length();
    if (d < 1e-6) n.set(0, 1, 0);
    else n.copy(p).divideScalar(d);
    out.copy(n).multiplyScalar(s.r);
    return d - s.r;
  }
  if (s.type === 'box') {
    const qx = THREE.MathUtils.clamp(p.x, -s.hx, s.hx), qy = THREE.MathUtils.clamp(p.y, -s.hy, s.hy), qz = THREE.MathUtils.clamp(p.z, -s.hz, s.hz);
    if (qx !== p.x || qy !== p.y || qz !== p.z) {
      out.set(qx, qy, qz);
      n.copy(p).sub(out);
      const d = n.length();
      n.divideScalar(d);
      return d;
    }
    // inside: out through the nearest face
    const dx = s.hx - Math.abs(p.x), dy = s.hy - Math.abs(p.y), dz = s.hz - Math.abs(p.z);
    out.copy(p);
    if (dx <= dy && dx <= dz) {
      n.set(Math.sign(p.x) || 1, 0, 0);
      out.x = s.hx * n.x;
      return -dx;
    }
    if (dy <= dz) {
      n.set(0, Math.sign(p.y) || 1, 0);
      out.y = s.hy * n.y;
      return -dy;
    }
    n.set(0, 0, Math.sign(p.z) || 1);
    out.z = s.hz * n.z;
    return -dz;
  }
  // cylinder along local y
  const rad = Math.hypot(p.x, p.z);
  const ux = rad > 1e-6 ? p.x / rad : 1, uz = rad > 1e-6 ? p.z / rad : 0;
  const inR = rad <= s.r, inY = Math.abs(p.y) <= s.hh;
  if (inR && inY) {
    const dr = s.r - rad, dy = s.hh - Math.abs(p.y);
    if (dr < dy) {
      n.set(ux, 0, uz);
      out.set(ux * s.r, p.y, uz * s.r);
      return -dr;
    }
    n.set(0, Math.sign(p.y) || 1, 0);
    out.set(p.x, s.hh * n.y, p.z);
    return -dy;
  }
  const cr = Math.min(rad, s.r);
  out.set(ux * cr, THREE.MathUtils.clamp(p.y, -s.hh, s.hh), uz * cr);
  n.copy(p).sub(out);
  const d = n.length();
  n.divideScalar(d || 1);
  return d;
}

export class World {
  readonly marbles: Marble[] = [];
  readonly kins: Kin[] = [];
  readonly hits: Hit[] = [];
  /** what local beans did to puppets this frame */
  readonly shoves: Shove[] = [];
  statics = new StaticMesh();
  time = 0;
  /** the slowest the course allows before a fall counts (m below) */
  private h = SUB;

  addKin(k: Kin) {
    this.kins.push(k);
    k.set(this.time);
    k.prev.copy(k.m);
    return k;
  }

  step(dt: number) {
    this.hits.length = 0;
    this.shoves.length = 0;
    const n = Math.max(1, Math.ceil(dt / SUB - 1e-6));
    const h = (this.h = dt / n);
    for (const m of this.marbles) this.controlFrame(m, dt);
    for (let k = 0; k < n; k++) {
      this.time += h;
      for (const kin of this.kins) {
        kin.prev.copy(kin.m);
        kin.set(this.time);
      }
      for (const m of this.marbles) if (m.active && !m.frozen) this.integrate(m, h);
      for (const m of this.marbles) if (m.active && !m.frozen && !m.puppet) this.collide(m);
      this.pairs();
      this.holds(h);
    }
    for (const m of this.marbles) {
      for (const [k, t] of m.quiet) if (t < this.time - 0.5) m.quiet.delete(k);
    }
  }

  /** per frame: the jump, the dive, the grab */
  private controlFrame(m: Marble, dt: number) {
    m.hopped = m.dashed = m.knocked = m.grabbed = false;
    m.landed = 0;
    if (!m.active || m.frozen || m.puppet) {
      m.jump = m.dash = false;
      return;
    }
    m.dashCD = Math.max(0, m.dashCD - dt);
    m.grabCD = Math.max(0, m.grabCD - dt);
    m.heldT = Math.max(0, m.heldT - dt);
    const ok = m.mode === Mode.Run && m.upT <= 0;
    if (m.jump && ok && m.groundT < 0.14) {
      // (straight up, whatever the slope; a held bean struggles)
      const v = m.heldT > 0 ? JUMP_V * 0.72 : JUMP_V;
      m.vel.y = Math.max(m.vel.y - m.groundVel.y, 0) * 0.3 + m.groundVel.y + v;
      m.groundT = 1;
      m.hopped = true;
    }
    m.jump = false;
    if (m.dash && ok && m.dashCD <= 0) {
      L.copy(m.input);
      L.y = 0;
      if (L.lengthSq() < 0.01) L.set(Math.sin(m.yaw), 0, Math.cos(m.yaw));
      L.normalize();
      // a dive: thrown forward flat out, a little up off the ground
      const along = m.vel.x * L.x + m.vel.z * L.z;
      const sp = Math.max(DIVE_V * (m.heldT > 0 ? 0.6 : 1), along + 2.5);
      const up = m.grounded ? 4.2 : Math.max(m.vel.y, 2.6);
      m.vel.set(L.x * sp, up, L.z * sp);
      m.yaw = Math.atan2(L.x, L.z);
      m.mode = Mode.Dive;
      m.diveT = 0;
      m.groundT = 1;
      m.dashCD = DASH_CD;
      m.dashed = true;
      m.release();
    }
    m.dash = false;
    // the grab: someone just in front, within reach
    if (m.grab && ok && !m.holding && m.grabCD <= 0) {
      const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
      let best: Marble | null = null, bd = GRAB_REACH;
      for (const o of this.marbles) {
        if (o === m || !o.active || o.frozen || o.mode === Mode.Tumble) continue;
        const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z, dy = o.pos.y - m.pos.y;
        if (Math.abs(dy) > 1.1) continue;
        const d = Math.hypot(dx, dz);
        if (d > bd || d < 1e-3 || (dx * fx + dz * fz) / d < 0.45) continue;
        best = o;
        bd = d;
      }
      if (best) {
        m.holding = best;
        m.holdT = GRAB_T;
        m.grabbed = true;
      }
    }
    if (m.holding && (!m.grab || m.holdT <= 0 || m.mode !== Mode.Run || !m.holding.active || m.holding.mode === Mode.Tumble)) m.release();
  }

  /** holds: the one held is slowed and dragged back toward the one holding */
  private holds(h: number) {
    for (const m of this.marbles) {
      const o = m.holding;
      if (!o || m.puppet) continue;
      m.holdT -= h;
      const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > GRAB_REACH + 0.9) {
        m.release();
        continue;
      }
      if (o.puppet) {
        this.shoves.push({ target: o, kind: 'grab', vx: d > 1.1 ? (dx / d) * 2.5 : 0, vy: 0, vz: d > 1.1 ? (dz / d) * 2.5 : 0 });
        continue;
      }
      o.heldT = Math.max(o.heldT, 0.2);
      if (d > 1.1) {
        // (pulled back in, a little at a time)
        const k = Math.min(1, (d - 1.1) * 6 * h);
        o.vel.x += (dx / d) * 9 * k;
        o.vel.z += (dz / d) * 9 * k;
      }
    }
  }

  private integrate(m: Marble, h: number) {
    if (m.puppet) {
      // (between packets it carries on as it was going)
      m.pos.addScaledVector(m.vel, h);
      return;
    }
    if (m.mode === Mode.Tumble) return this.roll(m, h);
    const grounded = m.groundT < 0.08;
    const inp = m.input;
    const il = Math.min(1, Math.hypot(inp.x, inp.z));
    m.upT = Math.max(0, m.upT - h);
    if (m.mode === Mode.Dive) {
      m.diveT += h;
      if (grounded) {
        // the belly slide: no steering, it scrubs off
        const rx = m.vel.x - m.groundVel.x, rz = m.vel.z - m.groundVel.z;
        const sp = Math.hypot(rx, rz);
        const k = sp > 1e-4 ? Math.max(0, sp - 16 * h) / sp : 0;
        m.vel.x = m.groundVel.x + rx * k;
        m.vel.z = m.groundVel.z + rz * k;
        if (m.diveT > 0.42 && sp < 7) {
          m.mode = Mode.Run;
          m.upT = 0.16;
        }
      } else if (m.diveT > 2.5) m.mode = Mode.Run;
    } else if (grounded) {
      // running: toward the input's velocity relative to the ground, faster downhill
      const n = m.groundN;
      let run = RUN * (m.heldT > 0 ? 0.38 : m.holding ? 0.6 : 1);
      if (il > 0.02) run *= 1 + 3.2 * Math.max(0, (n.x * inp.x + n.z * inp.z) / il);
      if (m.upT > 0) run = 0;
      const tx = m.groundVel.x + inp.x * run, tz = m.groundVel.z + inp.z * run;
      let ax = (tx - m.vel.x) * RUN_K, az = (tz - m.vel.z) * RUN_K;
      const a = Math.hypot(ax, az);
      // (the grip goes on a tilt: past ~11 degrees the feet start to slip, past ~25 it's a slide)
      const grip = RUN_ACC * THREE.MathUtils.clamp((n.y - 0.9) / (0.98 - 0.9), 0.1, 1);
      if (a > grip) (ax *= grip / a), (az *= grip / a);
      m.vel.x += ax * h;
      m.vel.z += az * h;
    } else if (il > 0.02) {
      // air control: a push toward the input up to running speed; it never brakes a launch
      const dx = inp.x / il, dz = inp.z / il;
      const along = m.vel.x * dx + m.vel.z * dz;
      const want = RUN * il * (m.heldT > 0 ? 0.5 : 1);
      if (along < want) {
        const dv = Math.min(AIR_ACC * h, want - along);
        m.vel.x += dx * dv;
        m.vel.z += dz * dv;
      }
      // (and the sideways drift dies away)
      const sx = m.vel.x - dx * along, sz = m.vel.z - dz * along;
      const k = Math.min(1, 1.6 * il * h);
      m.vel.x -= sx * k;
      m.vel.z -= sz * k;
    }
    m.vel.y -= GRAVITY * h;
    const sp = m.vel.length();
    if (sp > 0) m.vel.multiplyScalar(1 - Math.min(0.5, 0.0035 * sp * h));
    // facing: where it's running (or trying to)
    if (m.mode === Mode.Run) {
      const rx = m.vel.x - (grounded ? m.groundVel.x : 0), rz = m.vel.z - (grounded ? m.groundVel.z : 0);
      let want = NaN;
      if (il > 0.2) want = Math.atan2(inp.x, inp.z);
      else if (rx * rx + rz * rz > 1) want = Math.atan2(rx, rz);
      if (!Number.isNaN(want)) {
        let d = want - m.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        m.yaw += THREE.MathUtils.clamp(d, -14 * h, 14 * h);
      }
    }
    m.pos.addScaledVector(m.vel, h);
    m.groundT += h;
  }

  /** tumbling: the marble it was, rolling free; up again once it's on the ground and slow */
  private roll(m: Marble, h: number) {
    const inp = m.input;
    const il = Math.min(1, inp.length());
    if (il > 0.02 && m.groundT >= 0.08) m.vel.addScaledVector(inp, (3 * h) / Math.max(il, 1));
    else if (il > 0.02) {
      TMP.copy(m.groundN).cross(inp).normalize();
      if (m.ang.dot(TMP) < ROLL_MAX * 0.3 * il) m.ang.addScaledVector(TMP, ROLL_ACC * 0.3 * il * h);
    }
    m.vel.y -= GRAVITY * h;
    const sp = m.vel.length();
    if (sp > 0) m.vel.multiplyScalar(1 - Math.min(0.5, 0.0035 * sp * h));
    if (m.groundT < 0.08) {
      m.ang.multiplyScalar(1 - 1.2 * h);
      // (a bean is no marble: it scrubs to a stop)
      m.vel.x *= 1 - 1.4 * h;
      m.vel.z *= 1 - 1.4 * h;
    }
    const wl = m.ang.length();
    if (wl > 40) m.ang.multiplyScalar(40 / wl);
    m.pos.addScaledVector(m.vel, h);
    QD.set(m.ang.x * 0.5 * h, m.ang.y * 0.5 * h, m.ang.z * 0.5 * h, 0).multiply(m.quat);
    m.quat.set(m.quat.x + QD.x, m.quat.y + QD.y, m.quat.z + QD.z, m.quat.w + QD.w).normalize();
    m.groundT += h;
    m.tumbleT -= h;
    if (m.tumbleT <= 0 && m.groundT < 0.08 && m.vel.length() < 4.5) {
      m.mode = Mode.Run;
      m.upT = 0.3;
      m.ang.set(0, 0, 0);
      const e = new THREE.Euler().setFromQuaternion(m.quat, 'YXZ');
      m.yaw = e.y;
    } else if (m.tumbleT < -3) m.tumbleT = 0.5;
  }

  private collide(m: Marble) {
    this.sphere(m, 0, RADIUS);
    if (m.mode === Mode.Run) this.sphere(m, HEAD_UP, HEAD_R);
  }

  /** one of the bean's spheres (its centre `up` above the feet) against the course and the obstacles */
  private sphere(m: Marble, up: number, r: number) {
    const T = this.statics.tris;
    const p = SP.copy(m.pos);
    p.y += up;
    const feet = up === 0;
    this.statics.query(p, r + 0.05, (o, mat) => {
      closestOnTri(T, o, p.x, p.y, p.z, CP);
      N.copy(p).sub(CP);
      const d2 = N.lengthSq();
      if (d2 >= r * r) return;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        // (on the plane: the face normal)
        const ax = T[o], ay = T[o + 1], az = T[o + 2];
        N.set(T[o + 3] - ax, T[o + 4] - ay, T[o + 5] - az).cross(TMP.set(T[o + 6] - ax, T[o + 7] - ay, T[o + 8] - az)).normalize();
      } else N.divideScalar(d);
      p.addScaledVector(N, r - d);
      this.respond(m, N, r - d, null, mat, null, feet);
    });
    for (const k of this.kins) {
      if (!k.enabled) continue;
      const dx = p.x - k.pos.x, dy = p.y - k.pos.y, dz = p.z - k.pos.z;
      const br = k.bound + r;
      if (dx * dx + dy * dy + dz * dz > br * br) continue;
      L.copy(p).applyMatrix4(k.inv);
      const d = closestOnShape(k.shape, L, LP, LN);
      if (d >= r) continue;
      // the surface's velocity at the contact: where that point of the shape was a substep ago
      CP.copy(LP).applyMatrix4(k.m);
      SV.copy(LP).applyMatrix4(k.prev);
      SV.subVectors(CP, SV).divideScalar(this.h);
      N.copy(LN).transformDirection(k.m);
      p.addScaledVector(N, r - d);
      this.respond(m, N, r - d, SV, k.mat, k, feet);
    }
  }

  private respond(m: Marble, n: THREE.Vector3, pen: number, sv: THREE.Vector3 | null, mat: Mat, kin: Kin | null, feet: boolean) {
    m.pos.addScaledVector(n, pen);
    if (m.mode === Mode.Tumble) return this.respondBall(m, n, sv, mat, kin);
    VC.copy(m.vel);
    if (sv) VC.sub(sv);
    const vn = VC.dot(n);
    const floor = n.y > 0.55;
    if (floor && feet) {
      if (m.groundT > 0.05 && vn < -3) m.landed = Math.max(m.landed, -vn);
      m.groundT = 0;
      m.groundN.copy(n);
      m.groundMat = mat;
      if (sv) m.groundVel.copy(sv);
      else m.groundVel.set(0, 0, 0);
    }
    if (vn >= 0) return;
    const imp = -vn;
    m.vel.addScaledVector(n, imp);
    if (kin) {
      if (kin.kick > 0 && imp > 0.3) {
        if (floor) {
          // a trampoline: thrown back up
          m.vel.addScaledVector(n, imp * 0.7 + kin.kick * 1.6);
          m.groundT = 1;
        } else {
          // a bumper: a smack and over it goes
          m.vel.addScaledVector(n, kin.kick * 1.3 + imp * 0.5);
          m.vel.y += 2.5;
          m.knock(0.7);
        }
      } else if (sv && !floor) {
        // something moving hit it: a hammer, a sweeper, a swinging axe
        const push = sv.dot(n);
        if (push > 4.2 || (push > 2.4 && imp > 7)) {
          // (sent flying the way it was swung: a little faster than the thing that hit it, and up)
          m.vel.copy(sv).multiplyScalar(1.15).addScaledVector(n, 2.5);
          m.vel.y = Math.max(m.vel.y, 0) + 4.5;
          m.knock(1.1);
        }
      }
      if (imp > 0.8) {
        kin.lastHit = this.time;
        kin.onHit?.(m, imp);
      }
    } else if (!floor && imp > 9 && m.mode === Mode.Dive) m.knock(0.6);
    if (imp > 0.9) this.emit(m, kin ?? mat, 'surface', mat, imp, m.pos.x - n.x * RADIUS, m.pos.y - n.y * RADIUS, m.pos.z - n.z * RADIUS, n.y, undefined, kin ?? undefined);
  }

  /** a tumbling bean: the marble's contact (impulse at the point, rolling friction) */
  private respondBall(m: Marble, n: THREE.Vector3, sv: THREE.Vector3 | null, mat: Mat, kin: Kin | null) {
    const M = MATS[mat];
    R.copy(n).multiplyScalar(-RADIUS);
    VC.copy(m.ang).cross(R).add(m.vel);
    if (sv) VC.sub(sv);
    const vn = VC.dot(n);
    if (n.y > 0.45) {
      m.groundT = 0;
      m.groundN.copy(n);
      m.groundMat = mat;
      if (sv) m.groundVel.copy(sv);
      else m.groundVel.set(0, 0, 0);
    }
    if (vn >= 0) return;
    const imp = -vn;
    const e = imp > 1.6 ? M.e * 0.8 : 0;
    let jn = (1 + e) * imp;
    m.vel.addScaledVector(n, jn);
    if (kin) {
      if (kin.kick > 0 && imp > 0.3) {
        m.vel.addScaledVector(n, kin.kick);
        jn += kin.kick;
      }
      if (imp > 0.8) {
        kin.lastHit = this.time;
        kin.onHit?.(m, imp);
      }
    }
    VT.copy(VC).addScaledVector(n, -vn);
    const vt = VT.length();
    if (vt > 1e-6) {
      const jt = Math.min(vt * (2 / 7), M.mu * jn);
      VT.divideScalar(vt);
      m.vel.addScaledVector(VT, -jt);
      W0.copy(R).cross(VT).multiplyScalar(-jt / IR);
      m.ang.add(W0);
    }
    if (imp > 0.9) this.emit(m, kin ?? mat, 'surface', mat, imp, m.pos.x - n.x * RADIUS, m.pos.y - n.y * RADIUS, m.pos.z - n.z * RADIUS, n.y, undefined, kin ?? undefined);
  }

  /** bean on bean: two upright capsules (a tumbling one is a ball) */
  private pairs() {
    const ms = this.marbles;
    const D = 2 * BODY_R;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (!a.active) continue;
      const ah = a.mode === Mode.Run ? HEAD_UP : 0;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (!b.active || ((a.frozen || a.puppet) && (b.frozen || b.puppet))) continue;
        const bh = b.mode === Mode.Run ? HEAD_UP : 0;
        // the nearest points of the two vertical segments
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        if (dx * dx + dz * dz >= D * D) continue;
        let dy = b.pos.y - a.pos.y;
        if (dy > ah) dy -= ah;
        else if (dy < -bh) dy += bh;
        else dy = 0;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= D * D || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        N.set(dx / d, dy / d, dz / d);
        const pen = D - d;
        // (a held or remote bean is a wall to this one)
        const fa = a.frozen || a.puppet, fb = b.frozen || b.puppet;
        const wa = fa ? 0 : fb ? 1 : 0.5, wb = fb ? 0 : fa ? 1 : 0.5;
        a.pos.addScaledVector(N, -pen * wa);
        b.pos.addScaledVector(N, pen * wb);
        // standing on a head: that's ground
        if (N.y < -0.6 && wa > 0) {
          a.groundT = 0;
          a.groundN.copy(N).negate();
          a.groundVel.copy(b.vel);
        } else if (N.y > 0.6 && wb > 0) {
          b.groundT = 0;
          b.groundN.copy(N);
          b.groundVel.copy(a.vel);
        }
        VC.subVectors(b.vel, a.vel);
        const vn = VC.dot(N);
        if (vn >= 0) continue;
        const imp = -vn;
        const e = imp > 3 ? 0.5 : 0.1;
        const jn = (1 + e) * imp;
        // (who hit whom: the faster one going in)
        const aFast = a.vel.lengthSq() > b.vel.lengthSq();
        a.vel.addScaledVector(N, -jn * wa);
        b.vel.addScaledVector(N, jn * wb);
        // a dive into someone (or a flying body) bowls them over
        if (imp > 7.5) {
          const hitter = aFast ? a : b;
          const target = hitter === a ? b : a;
          if (hitter.mode === Mode.Dive || hitter.mode === Mode.Tumble) {
            if (target.puppet) this.shoves.push({ target, kind: 'knock', vx: hitter.vel.x * 0.6, vy: 3, vz: hitter.vel.z * 0.6 });
            else {
              target.vel.y += 3;
              target.knock(0.8);
            }
          }
        }
        if (imp > 1.2) this.emit(a, b, 'glass', Mat.Felt, imp, a.pos.x + N.x * BODY_R, a.pos.y + N.y * BODY_R, a.pos.z + N.z * BODY_R, 0, b);
      }
    }
  }

  private emit(m: Marble, partner: unknown, kind: 'glass' | 'surface', mat: Mat, speed: number, x: number, y: number, z: number, ny: number, b?: Marble, kin?: Kin) {
    // a contact rattling at rest isn't a new knock: one per partner per 70 ms, louder ones always
    const last = m.quiet.get(partner);
    if (last !== undefined && this.time - last < 0.07 && speed < 4) return;
    m.quiet.set(partner, this.time);
    this.hits.push({ kind, mat, speed, x, y, z, ny, a: m, b, kin });
  }
}
const SP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const KP = new THREE.Vector3();
const KQ = new THREE.Quaternion();
const KM = new THREE.Matrix4();
const KL = new THREE.Vector3();
const KO = new THREE.Vector3();
const KN = new THREE.Vector3();
/** how far p is from a collider's surface at time t (its pose is a function of time: a look ahead) */
export function kinDistanceAt(k: Kin, t: number, p: THREE.Vector3) {
  if (k.pose) {
    k.pose(t, KP, KQ);
    KM.compose(KP, KQ, ONE).invert();
  } else KM.copy(k.inv);
  KL.copy(p).applyMatrix4(KM);
  return closestOnShape(k.shape, KL, KO, KN);
}
