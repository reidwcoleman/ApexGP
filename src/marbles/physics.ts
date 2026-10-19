import * as THREE from 'three';

/**
 * Marble physics: solid glass spheres (I = 2/5·m·r²) rolling on a static triangle mesh (the wooden
 * course) and on analytic moving shapes (sweepers, hammers, turntables, pegs, bumpers), and off each
 * other. Impulses at the contact point, so a marble really rolls: it spins up from sliding, a spinning
 * marble grabs when it lands, a turntable carries it round. Control is a torque (the marble drives
 * itself by spinning, like a hamster ball), a little air control, a hop off the ground and a dash.
 * Fixed substeps (≤ 1/240 s) keep a fast marble from passing through a rail.
 */

export const RADIUS = 0.5;
export const GRAVITY = 24;
const SUB = 1 / 240;
/** the roll the marble can give itself: angular acceleration (rad/s²) and its own top spin (rad/s) */
const ROLL_ACC = 92;
const ROLL_MAX = 29;
const AIR_ACC = 7;
export const JUMP_V = 8.6;
const IR = 0.4 * RADIUS * RADIUS;

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
  /** 'glass': marble on marble; 'surface': marble on the course or an obstacle */
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

export class Marble {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly ang = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** desired roll direction (horizontal, world), length 0..1 */
  readonly input = new THREE.Vector3();
  jump = false;
  dash = false;
  /** seconds since a contact that counts as ground */
  groundT = 1;
  readonly groundN = new THREE.Vector3(0, 1, 0);
  groundMat: Mat = Mat.Wood;
  dashCD = 0;
  /** in the simulation at all */
  active = true;
  /** held in place (the start gate, a respawn) */
  frozen = false;
  /** per-partner sound cooldowns */
  readonly quiet = new Map<unknown, number>();
  /** jumped / dashed this frame (for the sound) */
  hopped = false;
  dashed = false;
  constructor(readonly id: number) {}
  get grounded() {
    return this.groundT < 0.1;
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
    const n = Math.max(1, Math.ceil(dt / SUB - 1e-6));
    const h = (this.h = dt / n);
    for (const m of this.marbles) this.controlFrame(m);
    for (let k = 0; k < n; k++) {
      this.time += h;
      for (const kin of this.kins) {
        kin.prev.copy(kin.m);
        kin.set(this.time);
      }
      for (const m of this.marbles) if (m.active && !m.frozen) this.integrate(m, h);
      for (const m of this.marbles) if (m.active && !m.frozen) this.collide(m);
      this.pairs();
    }
    for (const m of this.marbles) {
      for (const [k, t] of m.quiet) if (t < this.time - 0.5) m.quiet.delete(k);
    }
  }

  /** per frame: the hop and the dash */
  private controlFrame(m: Marble) {
    m.hopped = m.dashed = false;
    if (!m.active || m.frozen) return;
    m.dashCD = Math.max(0, m.dashCD - this.h);
    if (m.jump && m.groundT < 0.14) {
      const vn = m.vel.dot(m.groundN);
      // (off a slope it leaves along the surface's normal, mostly up)
      TMP.copy(m.groundN).lerp(UP, 0.35).normalize();
      m.vel.addScaledVector(TMP, Math.max(0, JUMP_V - Math.max(0, vn)));
      m.groundT = 1;
      m.hopped = true;
    }
    m.jump = false;
    if (m.dash && m.dashCD <= 0) {
      L.copy(m.input);
      if (L.lengthSq() < 0.01) L.set(m.vel.x, 0, m.vel.z);
      if (L.lengthSq() > 1e-4) {
        L.normalize();
        m.vel.addScaledVector(L, 7.5);
        if (m.grounded) m.vel.y += 2.5;
        m.dashCD = 1.8;
        m.dashed = true;
      }
    }
    m.dash = false;
  }

  private integrate(m: Marble, h: number) {
    const inp = m.input;
    const il = Math.min(1, inp.length());
    if (il > 0.02) {
      if (m.groundT < 0.08) {
        // spin about the axis that rolls it along the input: up × dir (on a slope, the ground's normal)
        const n = m.groundN;
        TMP.copy(n).cross(inp).normalize();
        const along = m.ang.dot(TMP);
        if (along < ROLL_MAX * il) m.ang.addScaledVector(TMP, ROLL_ACC * il * h);
      } else {
        m.vel.addScaledVector(inp, (AIR_ACC * h) / Math.max(il, 1));
        // (the spin it was given in the air is what grabs on landing)
        TMP.set(inp.z, 0, -inp.x);
        if (m.ang.dot(TMP) < ROLL_MAX * il) m.ang.addScaledVector(TMP, ROLL_ACC * 0.4 * h);
      }
    }
    m.vel.y -= GRAVITY * h;
    // air drag (quadratic, slight) and the rolling resistance of a marble on wood
    const sp = m.vel.length();
    if (sp > 0) m.vel.multiplyScalar(1 - Math.min(0.5, 0.0035 * sp * h));
    if (m.groundT < 0.08) m.ang.multiplyScalar(1 - 0.2 * h);
    const wl = m.ang.length();
    if (wl > 90) m.ang.multiplyScalar(90 / wl);
    m.pos.addScaledVector(m.vel, h);
    // orientation: dq = ½·ω·q·h
    QD.set(m.ang.x * 0.5 * h, m.ang.y * 0.5 * h, m.ang.z * 0.5 * h, 0).multiply(m.quat);
    m.quat.set(m.quat.x + QD.x, m.quat.y + QD.y, m.quat.z + QD.z, m.quat.w + QD.w).normalize();
    m.groundT += h;
  }

  private collide(m: Marble) {
    const T = this.statics.tris;
    const p = m.pos;
    this.statics.query(p, RADIUS + 0.05, (o, mat) => {
      closestOnTri(T, o, p.x, p.y, p.z, CP);
      N.copy(p).sub(CP);
      const d2 = N.lengthSq();
      if (d2 >= RADIUS * RADIUS) return;
      const d = Math.sqrt(d2);
      if (d < 1e-6) {
        // (on the plane: the face normal)
        const ax = T[o], ay = T[o + 1], az = T[o + 2];
        N.set(T[o + 3] - ax, T[o + 4] - ay, T[o + 5] - az).cross(TMP.set(T[o + 6] - ax, T[o + 7] - ay, T[o + 8] - az)).normalize();
      } else N.divideScalar(d);
      this.respond(m, N, RADIUS - d, null, mat, null);
    });
    for (const k of this.kins) {
      if (!k.enabled) continue;
      const dx = p.x - k.pos.x, dy = p.y - k.pos.y, dz = p.z - k.pos.z;
      const br = k.bound + RADIUS;
      if (dx * dx + dy * dy + dz * dz > br * br) continue;
      L.copy(p).applyMatrix4(k.inv);
      const d = closestOnShape(k.shape, L, LP, LN);
      if (d >= RADIUS) continue;
      // the surface's velocity at the contact: where that point of the shape was a substep ago
      CP.copy(LP).applyMatrix4(k.m);
      SV.copy(LP).applyMatrix4(k.prev);
      SV.subVectors(CP, SV).divideScalar(this.h);
      N.copy(LN).transformDirection(k.m);
      this.respond(m, N, RADIUS - d, SV, k.mat, k);
    }
  }

  private respond(m: Marble, n: THREE.Vector3, pen: number, sv: THREE.Vector3 | null, mat: Mat, kin: Kin | null) {
    m.pos.addScaledVector(n, pen);
    const M = MATS[mat];
    R.copy(n).multiplyScalar(-RADIUS);
    VC.copy(m.ang).cross(R).add(m.vel);
    if (sv) VC.sub(sv);
    const vn = VC.dot(n);
    if (n.y > 0.45) {
      m.groundT = 0;
      m.groundN.copy(n);
      m.groundMat = mat;
    }
    if (vn >= 0) return;
    const imp = -vn;
    const e = imp > 1.6 ? M.e : 0;
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
    // friction at the contact point: brings the slip to zero (rolling) within the Coulomb limit;
    // the effective mass of a solid sphere's contact point is 2/7 of its mass
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

  private pairs() {
    const ms = this.marbles;
    const D = 2 * RADIUS;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (!a.active) continue;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (!b.active || (a.frozen && b.frozen)) continue;
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= D * D || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        N.set(dx / d, dy / d, dz / d);
        const pen = D - d;
        // (a held marble is a wall)
        const wa = a.frozen ? 0 : b.frozen ? 1 : 0.5, wb = 1 - wa;
        a.pos.addScaledVector(N, -pen * wa);
        b.pos.addScaledVector(N, pen * wb);
        // relative velocity of the touching points
        R.copy(N).multiplyScalar(RADIUS);
        VC.copy(a.ang).cross(R).add(a.vel);
        R.negate();
        TMP.copy(b.ang).cross(R).add(b.vel);
        VC.sub(TMP).negate();
        const vn = VC.dot(N);
        if (vn >= 0) continue;
        const imp = -vn;
        const e = imp > 0.6 ? 0.9 : 0.3;
        const jn = (1 + e) * imp;
        // equal masses (a frozen one infinitely heavy)
        const ka = a.frozen ? 0 : b.frozen ? 1 : 0.5, kb = b.frozen ? 0 : a.frozen ? 1 : 0.5;
        a.vel.addScaledVector(N, -jn * ka);
        b.vel.addScaledVector(N, jn * kb);
        // a little glass-on-glass friction: spins traded on a glancing hit
        VT.copy(VC).addScaledVector(N, -vn);
        const vt = VT.length();
        if (vt > 1e-5) {
          const jt = Math.min(vt * (1 / 7), 0.12 * jn);
          VT.divideScalar(vt);
          a.vel.addScaledVector(VT, jt * ka);
          b.vel.addScaledVector(VT, -jt * kb);
          R.copy(N).multiplyScalar(RADIUS);
          W0.copy(R).cross(VT).multiplyScalar((jt * ka) / IR);
          a.ang.add(W0);
          R.negate();
          W0.copy(R).cross(VT).multiplyScalar((-jt * kb) / IR);
          b.ang.add(W0);
        }
        if (imp > 0.5) this.emit(a, b, 'glass', Mat.Metal, imp, a.pos.x + N.x * RADIUS, a.pos.y + N.y * RADIUS, a.pos.z + N.z * RADIUS, 0, b);
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
