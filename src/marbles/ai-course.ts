import * as THREE from 'three';
import type { Path } from './builder.ts';
import type { Course } from './courses.ts';
import { GRAVITY, JUMP_V, RADIUS, type Kin } from './physics.ts';

/**
 * What the bots know about a course, worked out once when it's built: the usable width and which
 * edges are open, a racing line (a rubber band pulled tight between the walls), the speed each
 * point of it can be taken at (the bend's pull against what the marble's spin and the banking can
 * hold, slower over floor with holes in it, then braked back from every corner), where a bend has
 * an outside wall to ride if it comes in too hot, the jumps (declared gaps and any stretch of
 * missing floor) with the speed a marble needs to clear them, and every collider sorted into
 * "stand on it" (a turntable, a moving platform) or "keep off it", bucketed along the path with
 * the range it ever sweeps. Colliders are asked where they'll be through a small cache of their
 * poses on a 1/40 s grid that all 23 bots share, and the floor under any (s, lateral) is probed
 * once and remembered.
 */

export const DS = 0.25;
const BUCKET = 2;
/** the sideways acceleration a marble's own spin can hold on the flat (the banking adds to it) */
const A_HOLD = 13;
/** the speed to cross floor with holes in it, and a thicket of fixed obstacles */
const HOLE_V = 10;
const THICKET_V = 14;

export interface Hz {
  k: Kin;
  /** stands on it rather than steering round it */
  plat: boolean;
  /** how bad a touch is (seconds lost) */
  w: number;
  /** the range of the path it ever reaches */
  s0: number;
  s1: number;
  l0: number;
  l1: number;
  /** pose cache: per slot, the shape's axes (rows of its inverse rotation) and its centre */
  slot: Int32Array;
  m: Float32Array;
}

export interface Jump {
  /** takeoff and landing s */
  s0: number;
  s1: number;
  /** the slowest takeoff that clears it (no kicker counted: conservative) */
  vNeed: number;
}

const SLOT_HZ = 40;
const RING = 256;
const KP = new THREE.Vector3();
const KQ = new THREE.Quaternion();
const V = new THREE.Vector3();
const W = new THREE.Vector3();

/** the collider's frame at time t from the cache (offset into h.m) */
function frame(h: Hz, t: number): number {
  const k = h.k;
  if (!k.pose) {
    if (h.slot[0] !== 1) fill(h, 0, k.pos, k.quat), (h.slot[0] = 1);
    return 0;
  }
  const sl = Math.round(t * SLOT_HZ);
  const j = sl & (RING - 1);
  if (h.slot[j] !== sl) {
    k.pose(sl / SLOT_HZ, KP, KQ);
    fill(h, j * 12, KP, KQ);
    h.slot[j] = sl;
  }
  return j * 12;
}
function fill(h: Hz, o: number, p: THREE.Vector3, q: THREE.Quaternion) {
  const m = h.m;
  V.set(1, 0, 0).applyQuaternion(q);
  m[o] = V.x, m[o + 1] = V.y, m[o + 2] = V.z;
  V.set(0, 1, 0).applyQuaternion(q);
  m[o + 3] = V.x, m[o + 4] = V.y, m[o + 5] = V.z;
  V.set(0, 0, 1).applyQuaternion(q);
  m[o + 6] = V.x, m[o + 7] = V.y, m[o + 8] = V.z;
  m[o + 9] = p.x, m[o + 10] = p.y, m[o + 11] = p.z;
}

/** signed distance from a point to a collider's surface at time t (the same shapes the physics uses) */
export function hzDist(h: Hz, t: number, x: number, y: number, z: number): number {
  const o = frame(h, t), m = h.m;
  const dx = x - m[o + 9], dy = y - m[o + 10], dz = z - m[o + 11];
  const lx = m[o] * dx + m[o + 1] * dy + m[o + 2] * dz;
  const ly = m[o + 3] * dx + m[o + 4] * dy + m[o + 5] * dz;
  const lz = m[o + 6] * dx + m[o + 7] * dy + m[o + 8] * dz;
  const s = h.k.shape;
  if (s.type === 'sph') return Math.hypot(lx, ly, lz) - s.r;
  if (s.type === 'box') {
    const qx = Math.abs(lx) - s.hx, qy = Math.abs(ly) - s.hy, qz = Math.abs(lz) - s.hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
  }
  const qr = Math.hypot(lx, lz) - s.r, qy = Math.abs(ly) - s.hh;
  const or = Math.max(qr, 0), oy = Math.max(qy, 0);
  return Math.sqrt(or * or + oy * oy) + Math.min(Math.max(qr, qy), 0);
}

/** the up axis and centre of a collider at time t (for the plate's bars) */
export function hzAxis(h: Hz, t: number, out: { ax: number; ay: number; az: number; x: number; y: number; z: number }) {
  const o = frame(h, t), m = h.m;
  out.ax = m[o + 3], out.ay = m[o + 4], out.az = m[o + 5];
  out.x = m[o + 9], out.y = m[o + 10], out.z = m[o + 11];
  return out;
}

export function makeHz(k: Kin, plat = false, w = 1): Hz {
  return { k, plat, w, s0: -1e9, s1: 1e9, l0: -1e9, l1: 1e9, slot: new Int32Array(RING).fill(-2147483647), m: new Float32Array(RING * 12) };
}

export class CourseAI {
  readonly path: Path;
  readonly n: number;
  /** usable lateral range (a marble's centre), and whether that edge is open (no wall) */
  readonly lo: Float32Array;
  readonly hi: Float32Array;
  readonly openL: Uint8Array;
  readonly openR: Uint8Array;
  /** the racing line (lateral offset) and its curvature (+: bending toward +lateral) */
  readonly line: Float32Array;
  readonly kap: Float32Array;
  /** the fastest the line can be taken at each point, braking for what's ahead included */
  readonly vcap: Float32Array;
  /** the sideways acceleration the marble can hold here by itself (spin + banking) */
  readonly hold: Float32Array;
  /** the lateral of the outside wall's fillet where a bend has one (NaN: open, or straight) */
  readonly ride: Float32Array;
  /** sin of the slope (+: downhill) */
  readonly fall: Float32Array;
  readonly hz: Hz[] = [];
  readonly plats: Hz[] = [];
  private hzB: Int32Array[] = [];
  private platB: Int32Array[] = [];
  readonly jumps: Jump[] = [];
  readonly finishS: number;
  private sup: Uint8Array;
  private LMAX: number;
  private NL: number;

  constructor(readonly c: Course) {
    const path = (this.path = c.path!);
    const n = (this.n = path.count);
    this.finishS = c.finishS;
    this.lo = new Float32Array(n);
    this.hi = new Float32Array(n);
    this.openL = new Uint8Array(n);
    this.openR = new Uint8Array(n);
    this.fall = new Float32Array(n);
    let lmax = 0;
    for (let i = 0; i < n; i++) {
      const sec = path.sec[i];
      const oL = sec.wallL < 0.5, oR = sec.wallR < 0.5;
      this.openL[i] = oL ? 1 : 0;
      this.openR[i] = oR ? 1 : 0;
      this.lo[i] = Math.min(0, -sec.w / 2 + (oL ? 1.25 : 0.8));
      this.hi[i] = Math.max(0, sec.w / 2 - (oR ? 1.25 : 0.8));
      this.fall[i] = -path.T[i].y;
      lmax = Math.max(lmax, sec.w / 2 + 1);
    }
    this.LMAX = lmax;
    this.NL = Math.ceil((2 * lmax) / 0.25) + 1;
    this.sup = new Uint8Array(n * this.NL);
    this.line = this.raceLine();
    this.kap = this.curvature(this.line);
    this.hold = new Float32Array(n);
    this.ride = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const sec = path.sec[i];
      const k = this.kap[i];
      // (a bank leaning into the bend helps; one leaning out of it hurts)
      this.hold[i] = Math.max(4, A_HOLD + GRAVITY * Math.sin(sec.bank) * Math.sign(k));
      const wall = k > 0 ? sec.wallL : sec.wallR;
      this.ride[i] = Math.abs(k) > 0.004 && wall > 0.9 ? (k > 0 ? this.lo[i] : this.hi[i]) : NaN;
    }
    this.indexKins();
    this.findJumps();
    this.vcap = this.speeds();
  }

  index(s: number) {
    return THREE.MathUtils.clamp(Math.round(s / DS), 0, this.n - 1);
  }

  // ------------------------------------------------------------------------------- the line
  /** a rubber band through the chute: pulled straight between the walls, coarse to fine */
  private raceLine() {
    const { path, n, lo, hi } = this;
    const L = new Float32Array(n);
    const P = path.P, R = path.Rt;
    for (const k of [32, 16, 8, 4]) {
      for (let it = 0; it < 40; it++) {
        for (let i = k; i < n - k; i++) {
          const a = i - k, b = i + k;
          const mx = (P[a].x + R[a].x * L[a] + P[b].x + R[b].x * L[b]) / 2;
          const mz = (P[a].z + R[a].z * L[a] + P[b].z + R[b].z * L[b]) / 2;
          const r = R[i];
          const rh = r.x * r.x + r.z * r.z;
          const l = ((mx - P[i].x) * r.x + (mz - P[i].z) * r.z) / Math.max(rh, 0.3);
          L[i] = THREE.MathUtils.clamp(L[i] + 0.7 * (l - L[i]), lo[i] * 0.85, hi[i] * 0.85);
        }
      }
    }
    return L;
  }

  /** the line's curvature from its points 2 m either side (+: turning toward +lateral) */
  private curvature(L: Float32Array) {
    const { path, n } = this;
    const P = path.P, R = path.Rt;
    const K = new Float32Array(n);
    const k = 8;
    for (let i = k; i < n - k; i++) {
      const a = i - k, b = i + k;
      const ax = P[a].x + R[a].x * L[a], az = P[a].z + R[a].z * L[a];
      const cx = P[i].x + R[i].x * L[i], cz = P[i].z + R[i].z * L[i];
      const bx = P[b].x + R[b].x * L[b], bz = P[b].z + R[b].z * L[b];
      const d1x = cx - ax, d1z = cz - az, d2x = bx - cx, d2z = bz - cz;
      const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
      if (l1 < 1e-3 || l2 < 1e-3) continue;
      const cr = (d1x * d2z - d1z * d2x) / (l1 * l2);
      // (the sign: + when it turns toward the frame's right, which is +lateral)
      const rx = R[i].x, rz = R[i].z;
      const turnRight = (d2x / l2 - d1x / l1) * rx + (d2z / l2 - d1z / l1) * rz;
      K[i] = (Math.sign(turnRight) * Math.abs(Math.asin(THREE.MathUtils.clamp(cr, -1, 1)))) / ((l1 + l2) / 2);
    }
    // a little smoothing
    const S = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) (s += K[j]), c++;
      S[i] = s / c;
    }
    return S;
  }

  /** the speed profile: the bend's limit at each point, then braked back from everything ahead */
  private speeds() {
    const { n, kap } = this;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(kap[i]);
      // on the line, held there by its own spin and the banking
      // (riding the outside wall is faster through the bend but the longer way round: a loss)
      v[i] = Math.min(40, Math.sqrt(this.hold[i] / Math.max(k, 1e-4)));
    }
    // floor with holes in it (a turntable's corners, platforms that come and go): taken steadily
    for (let i = 0; i < n; i += 2) {
      const sAt = i * DS;
      if (this.jumps.some((j) => sAt > j.s0 - 1 && sAt < j.s1 + 1)) continue;
      if (this.holey(sAt)) for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6); k++) v[k] = Math.min(v[k], HOLE_V);
    }
    // a thicket of fixed obstacles (a peg field): no way through without a knock, so not flat out
    for (let b = 0; b < this.hzB.length; b++) {
      let fixed = 0;
      for (const id of this.hzB[b]) if (!this.hz[id].k.pose && this.hz[id].w > 0.3) fixed++;
      if (fixed < 3) continue;
      for (let k = this.index(b * BUCKET - 1); k <= this.index(b * BUCKET + BUCKET + 1); k++) v[k] = Math.min(v[k], THICKET_V);
    }
    // a jump's run-up is never braked below what clears it
    for (const j of this.jumps) {
      for (let i = this.index(j.s0 - 25); i <= this.index(j.s0); i++) v[i] = Math.max(v[i], j.vNeed + 2);
    }
    for (let i = n - 2; i >= 0; i--) {
      const B = Math.max(3, 11 - GRAVITY * this.fall[i]);
      v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * B * DS));
    }
    return v;
  }

  /** somewhere across here (now, or a moment from now) there's no floor */
  private holey(s: number) {
    const i = this.index(s);
    // (a plain stretch of chute is whole)
    if (this.path.sec[i].floor && !this.platB[THREE.MathUtils.clamp(Math.floor(s / BUCKET), 0, this.platB.length - 1)].length) return false;
    for (const t of [0, 1.3, 2.6]) for (let l = this.lo[i]; l <= this.hi[i]; l += 0.75) if (!this.supported(s, l, t)) return true;
    return false;
  }

  // ------------------------------------------------------------------------------- colliders
  private indexKins() {
    const { path, c } = this;
    const hazards = new Set(c.b.hazards);
    const nb = Math.ceil(path.length / BUCKET) + 2;
    const hzB: number[][] = Array.from({ length: nb }, () => []);
    const platB: number[][] = Array.from({ length: nb }, () => []);
    let hint = 0;
    for (const k of c.b.world.kins) {
      // where it ever goes: its pose over a while (all of these repeat within a few seconds)
      const times = k.pose ? Array.from({ length: 61 }, (_, i) => i * 0.2) : [0];
      let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity, hMin = Infinity, dMin = Infinity;
      let plat = false;
      for (const t of times) {
        if (k.pose) k.pose(t, KP, KQ);
        else KP.copy(k.pos), KQ.copy(k.quat);
        const pr = t === 0 ? path.projectAll(KP) : path.project(KP, hint, 40);
        hint = pr.i;
        const b = k.bound + RADIUS + 0.4;
        s0 = Math.min(s0, pr.s - b);
        s1 = Math.max(s1, pr.s + b);
        l0 = Math.min(l0, pr.lat - b);
        l1 = Math.max(l1, pr.lat + b);
        hMin = Math.min(hMin, pr.h - k.bound);
        dMin = Math.min(dMin, Math.abs(pr.lat) - path.sec[pr.i].w / 2 - k.bound);
        if (t === 0) plat = isPlatform(k, path, pr.i, KP, KQ);
      }
      // (well off the chute, or overhead)
      if (dMin > 2 || hMin > 2.2) continue;
      // (a course can say what a collider is for, where the shape alone doesn't tell: kin.aiRole)
      const role = (k as unknown as { aiRole?: 'ride' | 'avoid' | 'ignore' }).aiRole;
      if (role === 'ignore') continue;
      if (role) plat = role === 'ride';
      // (what a touch costs, in seconds: a glance off a peg, a bumper's kick, a hammer's swat)
      const w = plat ? 0 : (k.kick > 0 ? 1.1 : k.pose ? 1.6 : 0.45) * (hazards.has(k) ? 1 : 0.6);
      const h = makeHz(k, plat, w);
      h.s0 = s0, h.s1 = s1, h.l0 = l0, h.l1 = l1;
      const list = plat ? this.plats : this.hz;
      const id = list.length;
      list.push(h);
      const B = plat ? platB : hzB;
      for (let b = Math.max(0, Math.floor(s0 / BUCKET)); b <= Math.min(nb - 1, Math.floor(s1 / BUCKET)); b++) B[b].push(id);
    }
    this.hzB = hzB.map((l) => Int32Array.from(l));
    this.platB = platB.map((l) => Int32Array.from(l));
    this.calm = new Uint8Array(nb);
    for (let b = 0; b < nb; b++) {
      let ok = !hzB[b].length && !platB[b].length;
      for (let i = this.index(b * BUCKET); ok && i <= this.index(b * BUCKET + BUCKET); i++) ok = path.sec[i].floor && !this.openL[i] && !this.openR[i];
      this.calm[b] = ok ? 1 : 0;
    }
  }

  /** nothing between s0 and s1 but chute: no obstacle, platform, gap or open edge */
  quiet(s0: number, s1: number) {
    for (let b = Math.max(0, Math.floor(s0 / BUCKET)); b <= Math.min(this.hzB.length - 1, Math.floor(s1 / BUCKET)); b++) if (!this.calm[b]) return false;
    return true;
  }
  private calm = new Uint8Array(0);

  /** the colliders that can reach s (ids into hz) */
  hazardsAt(s: number) {
    return this.hzB[THREE.MathUtils.clamp(Math.floor(s / BUCKET), 0, this.hzB.length - 1)];
  }

  /** the floor under a marble at (s, lat) at time t: the chute, a kicker, a turntable, a platform
   * (a crack narrower than the marble, like a turntable's seam, it just rolls over) */
  supported(s: number, lat: number, t: number) {
    return this.under(s, lat, t) || (this.under(s - 0.45, lat, t) && this.under(s + 0.45, lat, t));
  }

  private under(s: number, lat: number, t: number) {
    const i = this.index(s);
    const li = Math.round((lat + this.LMAX) / 0.25);
    if (li < 0 || li >= this.NL) return false;
    const k = i * this.NL + li;
    let v = this.sup[k];
    if (v === 0) {
      const p = this.path.at(s, lat, RADIUS, W);
      const f = this.c.b.world.statics.floorBelow(p.x, p.y, p.z, 1.3);
      v = this.sup[k] = f > -Infinity ? 1 : 2;
    }
    if (v === 1) return true;
    const ids = this.platB[THREE.MathUtils.clamp(Math.floor(s / BUCKET), 0, this.platB.length - 1)];
    if (!ids.length) return false;
    const p = this.path.at(s, lat, -0.08, W);
    for (let j = 0; j < ids.length; j++) if (hzDist(this.plats[ids[j]], t, p.x, p.y, p.z) < 0.1) return true;
    return false;
  }

  // ------------------------------------------------------------------------------- jumps
  private findJumps() {
    const { path, n, c } = this;
    const runs: [number, number][] = [];
    // floor missing along the centre line, with nothing to stand on there at any time
    let a = -1;
    for (let i = 0; i < n; i++) {
      const gap = !path.sec[i].floor && !this.everSupported(i * DS);
      if (gap && a < 0) a = i;
      if ((!gap || i === n - 1) && a >= 0) {
        runs.push([a * DS, i * DS]);
        a = -1;
      }
    }
    const all: [number, number][] = c.gaps.map(([x, y]) => [x, y]);
    for (const r of runs) if (r[1] - r[0] >= 1.2 && !all.some(([x, y]) => r[0] < y + 1 && r[1] > x - 1)) all.push(r);
    all.sort((x, y) => x[0] - y[0]);
    for (const [s0, s1] of all) this.jumps.push({ s0, s1, vNeed: this.needed(s0, s1) });
  }

  private everSupported(s: number) {
    for (let t = 0; t < 12; t += 0.5) if (this.under(s, 0, t)) return true;
    return false;
  }

  /** the slowest takeoff (with a hop at the lip) that lands a metre past the far edge */
  private needed(s0: number, s1: number) {
    const path = this.path;
    const i0 = this.index(s0);
    const T = path.T[i0], U = path.U[i0];
    const p0 = path.P[i0];
    const th = new THREE.Vector3(T.x, 0, T.z).normalize();
    for (let v = 4; v < 40; v += 0.5) {
      const vel = new THREE.Vector3().copy(T).multiplyScalar(v);
      V.copy(U).lerp(W.set(0, 1, 0), 0.35).normalize();
      vel.addScaledVector(V, JUMP_V);
      const p = new THREE.Vector3().copy(p0).addScaledVector(U, RADIUS);
      let ok = false;
      for (let t = 0; t < 3; t += 0.01) {
        p.addScaledVector(vel, 0.01);
        vel.y -= GRAVITY * 0.01;
        const s = s0 + (p.x - p0.x) * th.x + (p.z - p0.z) * th.z;
        const fy = path.P[this.index(s)].y;
        if (s > s1 + 1) {
          ok = p.y - RADIUS > fy - 0.1;
          break;
        }
        if (p.y < fy - 0.5) break;
      }
      if (ok) return v;
    }
    return 30;
  }
}

/** a big flat top at floor level, facing up: something to ride on, not to dodge */
function isPlatform(k: Kin, path: Path, i: number, p: THREE.Vector3, q: THREE.Quaternion) {
  const s = k.shape;
  if (s.type === 'sph') return false;
  const hh = s.type === 'box' ? s.hy : s.hh;
  const span = s.type === 'box' ? Math.min(s.hx, s.hz) : s.r;
  if (hh > 0.65 || span < 1.2) return false;
  V.set(0, 1, 0).applyQuaternion(q);
  if (V.dot(path.U[i]) < 0.85) return false;
  W.copy(p).addScaledVector(V, hh).sub(path.P[i]);
  const top = W.dot(path.U[i]);
  return top > -0.7 && top < 0.45;
}

const CACHE = new WeakMap<Course, CourseAI>();
/** the course's analysis (built on first use) */
export function courseAI(c: Course) {
  let a = CACHE.get(c);
  if (!a) CACHE.set(c, (a = new CourseAI(c)));
  return a;
}
