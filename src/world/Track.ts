import * as THREE from 'three';
import { generateCircuit, type CircuitData, type CircuitDef, type CornerInfo, type RunoffKind } from './CircuitGen.ts';

/**
 * The circuit as the rest of the game sees it.
 *
 * Everything is sampled every metre of centreline (index i ⇔ s = i metres).
 * Conventions (read these before touching anything that uses the track):
 *   - three.js world: Y up, circuit lies roughly in XZ.
 *   - heading θ: forward = (sin θ, 0, cos θ); +θ turns LEFT.
 *   - lateral offset: + = RIGHT of the direction of travel (right = forward × up).
 *   - curvature κ: + = left-hand corner. 1/κ is the radius in metres.
 *   - s wraps at `length`. The start/finish line is at `startS` (not 0).
 *
 * Cross-section at any s, from the centre outwards on each side:
 *   |lat| ≤ halfWidth                    ROAD
 *   halfWidth … +kerbW                    KERB (0 width = no kerb)
 *   … +VERGE (1.5 m)                      ASPHALT verge strip (painted)
 *   … barrier                             runoff[side]: GRASS / GRAVEL / ASPHALT
 *       gravel beds leave GRAVEL_EDGE m of grass before the barrier
 *   barrier                               WALL (tyre wall / armco / tecpro / pit wall)
 */

export const SURF = {
  ROAD: 0,
  KERB: 1,
  ASPHALT: 2,
  GRASS: 3,
  GRAVEL: 4,
} as const;
export type SurfaceCode = (typeof SURF)[keyof typeof SURF];

export const VERGE = 1.5;
export const GRAVEL_EDGE = 3;

const RUNOFF_CODE: Record<RunoffKind, SurfaceCode> = {
  grass: SURF.GRASS,
  gravel: SURF.GRAVEL,
  asphalt: SURF.ASPHALT,
};

export interface TrackFrame {
  s: number;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  heading: number;
  kappa: number;
  halfWidth: number;
}

export interface ProjectResult {
  s: number;
  lateral: number;
  index: number;
}

export interface DrsZone {
  detect: number;
  start: number;
  end: number;
}

export interface DistanceField {
  originX: number;
  originZ: number;
  cell: number;
  w: number;
  h: number;
  /** horizontal distance to the nearest centreline sample (m), Infinity if far */
  dist: Float32Array;
  /** centreline height of that nearest sample */
  height: Float32Array;
  /** index of that nearest sample (−1 if none) */
  nearest: Int32Array;
}

export class Track {
  readonly def: CircuitDef;
  readonly data: CircuitData;
  readonly n: number;
  readonly length: number;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly tz: Float32Array;
  readonly rx: Float32Array;
  readonly ry: Float32Array;
  readonly rz: Float32Array;
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly uz: Float32Array;
  readonly heading: Float32Array;
  readonly kappa: Float32Array;
  /** bank angle (rad), + = right side lower */
  readonly bank: Float32Array;
  readonly halfWidth: Float32Array;
  readonly kerbL: Float32Array;
  readonly kerbR: Float32Array;
  readonly runoffL: Uint8Array;
  readonly runoffR: Uint8Array;
  /** distance from centreline to the barrier face (positive numbers on both sides) */
  readonly barrierL: Float32Array;
  readonly barrierR: Float32Array;
  /** racing-line lateral offset (m, + right) */
  readonly racingLine: Float32Array;

  readonly corners: CornerInfo[];
  readonly startS: number;
  /** absolute s of the sector 1→2 and 2→3 boundaries */
  readonly sectorS: [number, number];
  readonly drs: DrsZone[];
  /** pit lane along the main straight: s range, side (+1 right) and lateral band */
  readonly pit: { side: 1 | -1; sStart: number; sEnd: number; wallOffset: number; laneInner: number; laneOuter: number; garageOffset: number };

  private readonly hash = new Map<number, number[]>();
  private static readonly HASH_CELL = 24;

  constructor(def: CircuitDef) {
    this.def = def;
    const d = (this.data = generateCircuit(def));
    const n = (this.n = d.n);
    this.length = n;
    this.corners = d.corners;

    const f32 = () => new Float32Array(n);
    this.px = f32(); this.py = f32(); this.pz = f32();
    this.tx = f32(); this.ty = f32(); this.tz = f32();
    this.rx = f32(); this.ry = f32(); this.rz = f32();
    this.ux = f32(); this.uy = f32(); this.uz = f32();
    this.heading = f32();
    this.kappa = f32();
    this.bank = f32();
    this.halfWidth = f32();
    this.kerbL = f32();
    this.kerbR = f32();
    this.runoffL = new Uint8Array(n).fill(SURF.GRASS);
    this.runoffR = new Uint8Array(n).fill(SURF.GRASS);
    this.barrierL = f32();
    this.barrierR = f32();
    this.racingLine = f32();

    for (let i = 0; i < n; i++) {
      this.px[i] = d.x[i];
      this.pz[i] = d.z[i];
      this.py[i] = d.y[i];
      this.heading[i] = d.heading[i];
      this.kappa[i] = d.kappa[i];
      this.halfWidth[i] = def.halfWidth;
    }

    // Banking: a touch of positive camber in the faster corners.
    {
      const raw = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const k = this.kappa[i];
        const R = Math.abs(k) > 1e-6 ? 1 / Math.abs(k) : 1e9;
        // corners between R≈60 and R≈400 get up to ~2.5° of camber toward the inside
        const w = R < 40 ? 0.3 : R > 500 ? 0 : 1;
        raw[i] = -Math.sign(k) * w * Math.min(0.045, Math.abs(k) * 4);
      }
      const sm = smoothCircular(raw, 20, 3);
      // bank > 0 means the right side is lower. Left turn (κ>0) → inside is left → left lower → bank < 0.
      for (let i = 0; i < n; i++) this.bank[i] = sm[i];
    }

    // Frames.
    const t = new THREE.Vector3();
    const r = new THREE.Vector3();
    const u = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      t.set(this.px[b] - this.px[a], this.py[b] - this.py[a], this.pz[b] - this.pz[a]).normalize();
      r.crossVectors(t, worldUp).normalize();
      u.crossVectors(r, t).normalize();
      // apply bank: rotate right & up around tangent
      const bk = this.bank[i];
      if (bk !== 0) {
        r.applyAxisAngle(t, bk);
        u.applyAxisAngle(t, bk);
      }
      this.tx[i] = t.x; this.ty[i] = t.y; this.tz[i] = t.z;
      this.rx[i] = r.x; this.ry[i] = r.y; this.rz[i] = r.z;
      this.ux[i] = u.x; this.uy[i] = u.y; this.uz[i] = u.z;
    }

    // Spatial hash of centreline samples.
    for (let i = 0; i < n; i++) {
      const key = this.hashKey(this.px[i], this.pz[i]);
      let arr = this.hash.get(key);
      if (!arr) this.hash.set(key, (arr = []));
      arr.push(i);
    }

    // Race geometry.
    const segS = (segIdx: number, frac: number) => (d.segStart[segIdx] + frac * d.segLen[segIdx]) % n;
    this.startS = def.startOffset % n;
    this.sectorS = [
      (this.startS + def.sectors[0] * n) % n,
      (this.startS + def.sectors[1] * n) % n,
    ];
    this.drs = def.drs.map((z) => ({
      detect: segS(z.detect[0], z.detect[1]),
      start: segS(z.start[0], z.start[1]),
      end: segS(z.end[0], z.end[1]),
    }));

    // Pit lane: most of segment 0.
    const s0 = d.segStart[0];
    const L0 = d.segLen[0];
    this.pit = {
      side: def.pitSide,
      sStart: s0 + 70,
      sEnd: s0 + L0 - 90,
      wallOffset: def.halfWidth + 3.2,
      laneInner: def.halfWidth + 4.2,
      laneOuter: def.halfWidth + 16,
      garageOffset: def.halfWidth + 19,
    };

    this.buildKerbs();
    this.buildRunoff();
    this.buildBarriers();
    this.buildRacingLine();
  }

  // ---------------------------------------------------------------- queries

  wrap(s: number): number {
    const n = this.n;
    return ((s % n) + n) % n;
  }

  /** signed shortest distance from a to b along the lap (b − a), in (−L/2, L/2] */
  delta(a: number, b: number): number {
    let d = this.wrap(b) - this.wrap(a);
    if (d > this.n / 2) d -= this.n;
    else if (d <= -this.n / 2) d += this.n;
    return d;
  }

  private lerpArr(arr: Float32Array, s: number): number {
    const n = this.n;
    const w = this.wrap(s);
    const i = Math.floor(w);
    const f = w - i;
    const a = arr[i];
    const b = arr[(i + 1) % n];
    return a + (b - a) * f;
  }

  kappaAt(s: number): number {
    return this.lerpArr(this.kappa, s);
  }
  halfWidthAt(s: number): number {
    return this.lerpArr(this.halfWidth, s);
  }
  racingLineAt(s: number): number {
    return this.lerpArr(this.racingLine, s);
  }
  barrierAt(s: number, side: number): number {
    return this.lerpArr(side < 0 ? this.barrierL : this.barrierR, s);
  }
  kerbAt(s: number, side: number): number {
    return this.lerpArr(side < 0 ? this.kerbL : this.kerbR, s);
  }
  heightAt(s: number): number {
    return this.lerpArr(this.py, s);
  }

  /** Interpolated frame at s. `out` is reused if given. */
  frame(s: number, out?: TrackFrame): TrackFrame {
    const f = out ?? {
      s: 0,
      pos: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      heading: 0,
      kappa: 0,
      halfWidth: 0,
    };
    const n = this.n;
    const w = this.wrap(s);
    const i = Math.floor(w);
    const j = (i + 1) % n;
    const a = w - i;
    const b = 1 - a;
    f.s = w;
    f.pos.set(this.px[i] * b + this.px[j] * a, this.py[i] * b + this.py[j] * a, this.pz[i] * b + this.pz[j] * a);
    f.tangent.set(this.tx[i] * b + this.tx[j] * a, this.ty[i] * b + this.ty[j] * a, this.tz[i] * b + this.tz[j] * a).normalize();
    f.right.set(this.rx[i] * b + this.rx[j] * a, this.ry[i] * b + this.ry[j] * a, this.rz[i] * b + this.rz[j] * a).normalize();
    f.up.set(this.ux[i] * b + this.ux[j] * a, this.uy[i] * b + this.uy[j] * a, this.uz[i] * b + this.uz[j] * a).normalize();
    let dh = this.heading[j] - this.heading[i];
    if (j === 0) dh = 0;
    f.heading = this.heading[i] + dh * a;
    f.kappa = this.kappa[i] * b + this.kappa[j] * a;
    f.halfWidth = this.halfWidth[i] * b + this.halfWidth[j] * a;
    return f;
  }

  /** World position of (s, lateral) on the extended road plane, plus `lift` along the surface normal. */
  point(s: number, lateral: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.n;
    const w = this.wrap(s);
    const i = Math.floor(w);
    const j = (i + 1) % n;
    const a = w - i;
    const b = 1 - a;
    const rx = this.rx[i] * b + this.rx[j] * a;
    const ry = this.ry[i] * b + this.ry[j] * a;
    const rz = this.rz[i] * b + this.rz[j] * a;
    const ux = this.ux[i] * b + this.ux[j] * a;
    const uy = this.uy[i] * b + this.uy[j] * a;
    const uz = this.uz[i] * b + this.uz[j] * a;
    out.set(
      this.px[i] * b + this.px[j] * a + rx * lateral + ux * lift,
      this.py[i] * b + this.py[j] * a + ry * lateral + uy * lift,
      this.pz[i] * b + this.pz[j] * a + rz * lateral + uz * lift,
    );
    return out;
  }

  /**
   * Nearest centreline point to world (x, z). With `hint` (a previous index)
   * only ±`window` samples are searched, which is what per-frame callers want.
   */
  project(x: number, z: number, hint = -1, window = 40): ProjectResult {
    const n = this.n;
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      for (let k = -window; k <= window; k++) {
        const i = (((hint + k) % n) + n) % n;
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0 || bestD > 60 * 60) {
      // hash lookup, falling back to a coarse global scan
      const C = Track.HASH_CELL;
      const cx = Math.floor(x / C);
      const cz = Math.floor(z / C);
      for (let ox = -2; ox <= 2; ox++)
        for (let oz = -2; oz <= 2; oz++) {
          const arr = this.hash.get(this.hashKeyCell(cx + ox, cz + oz));
          if (!arr) continue;
          for (const i of arr) {
            const dx = x - this.px[i];
            const dz = z - this.pz[i];
            const d = dx * dx + dz * dz;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      if (best < 0) {
        for (let i = 0; i < n; i += 2) {
          const dx = x - this.px[i];
          const dz = z - this.pz[i];
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    // refine on the neighbouring segments
    const i0 = best;
    let s = i0;
    let lateral = 0;
    {
      const ip = (i0 - 1 + n) % n;
      const inx = (i0 + 1) % n;
      const segProj = (a: number, b: number) => {
        const ax = this.px[a], az = this.pz[a];
        const bx = this.px[b], bz = this.pz[b];
        const vx = bx - ax, vz = bz - az;
        const L2 = vx * vx + vz * vz;
        let t = ((x - ax) * vx + (z - az) * vz) / L2;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + vx * t, qz = az + vz * t;
        return { t, d: (x - qx) ** 2 + (z - qz) ** 2 };
      };
      const A = segProj(ip, i0);
      const B = segProj(i0, inx);
      if (A.d < B.d) s = i0 - 1 + A.t;
      else s = i0 + B.t;
      s = this.wrap(s);
      const j = Math.floor(s);
      const f = s - j;
      const j2 = (j + 1) % n;
      const cx = this.px[j] * (1 - f) + this.px[j2] * f;
      const cz = this.pz[j] * (1 - f) + this.pz[j2] * f;
      const rx = this.rx[j] * (1 - f) + this.rx[j2] * f;
      const rz = this.rz[j] * (1 - f) + this.rz[j2] * f;
      const rl = Math.hypot(rx, rz);
      lateral = ((x - cx) * rx + (z - cz) * rz) / rl;
    }
    return { s, lateral, index: Math.floor(s) };
  }

  /** Surface under a point given its (s, lateral). */
  surfaceAt(s: number, lateral: number): SurfaceCode {
    const i = Math.floor(this.wrap(s));
    const a = Math.abs(lateral);
    const hw = this.halfWidth[i];
    if (a <= hw) return SURF.ROAD;
    const left = lateral < 0;
    const kw = left ? this.kerbL[i] : this.kerbR[i];
    if (a <= hw + kw) return SURF.KERB;
    if (a <= hw + kw + VERGE) return SURF.ASPHALT;
    const ro = (left ? this.runoffL[i] : this.runoffR[i]) as SurfaceCode;
    if (ro === SURF.GRAVEL) {
      const bar = left ? this.barrierL[i] : this.barrierR[i];
      return a > bar - GRAVEL_EDGE ? SURF.GRASS : SURF.GRAVEL;
    }
    // pit lane is tarmac
    if (this.inPit(s) && Math.sign(lateral) === this.pit.side) return SURF.ASPHALT;
    return ro;
  }

  inPit(s: number): boolean {
    const w = this.wrap(s);
    return w >= this.pit.sStart && w <= this.pit.sEnd;
  }

  /** Grid slot k (0 = pole): world position and the s/lateral it sits at. */
  gridSlot(k: number): { s: number; lateral: number } {
    const back = 7 + k * 8;
    const lateral = (k % 2 === 0 ? -1 : 1) * 2.8;
    return { s: this.wrap(this.startS - back), lateral };
  }

  /** Distance (m) along the lap from the start line, in [0, length). */
  lapDistance(s: number): number {
    return this.wrap(s - this.startS);
  }

  /**
   * Nearest-centreline distance field over the circuit's bounding box (plus
   * `margin`). Used for terrain blending and scenery placement.
   */
  buildDistanceField(cell = 8, margin = 700, reach = 260): DistanceField {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minx = Math.min(minx, this.px[i]); maxx = Math.max(maxx, this.px[i]);
      minz = Math.min(minz, this.pz[i]); maxz = Math.max(maxz, this.pz[i]);
    }
    const originX = minx - margin;
    const originZ = minz - margin;
    const w = Math.ceil((maxx - minx + margin * 2) / cell) + 1;
    const h = Math.ceil((maxz - minz + margin * 2) / cell) + 1;
    const dist = new Float32Array(w * h).fill(Infinity);
    const height = new Float32Array(w * h);
    const nearest = new Int32Array(w * h).fill(-1);
    const rc = Math.ceil(reach / cell);
    for (let i = 0; i < this.n; i += 2) {
      const cx = Math.round((this.px[i] - originX) / cell);
      const cz = Math.round((this.pz[i] - originZ) / cell);
      for (let oz = -rc; oz <= rc; oz++) {
        const gz = cz + oz;
        if (gz < 0 || gz >= h) continue;
        for (let ox = -rc; ox <= rc; ox++) {
          const gx = cx + ox;
          if (gx < 0 || gx >= w) continue;
          const wx = originX + gx * cell;
          const wz = originZ + gz * cell;
          const dd = Math.hypot(wx - this.px[i], wz - this.pz[i]);
          const idx = gz * w + gx;
          if (dd < dist[idx]) {
            dist[idx] = dd;
            height[idx] = this.py[i];
            nearest[idx] = i;
          }
        }
      }
    }
    return { originX, originZ, cell, w, h, dist, height, nearest };
  }

  /** Bilinear lookup helper for a DistanceField. Returns Infinity outside the reach. */
  static sampleField(f: DistanceField, arr: Float32Array, x: number, z: number): number {
    const gx = (x - f.originX) / f.cell;
    const gz = (z - f.originZ) / f.cell;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    if (x0 < 0 || z0 < 0 || x0 >= f.w - 1 || z0 >= f.h - 1) return arr === f.dist ? Infinity : 0;
    const fx = gx - x0, fz = gz - z0;
    const i = z0 * f.w + x0;
    const a = arr[i], b = arr[i + 1], c = arr[i + f.w], d = arr[i + f.w + 1];
    if (!isFinite(a) || !isFinite(b) || !isFinite(c) || !isFinite(d)) {
      return Math.min(a, b, c, d);
    }
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /**
   * Distance from world (x,z) to the nearest centreline sample whose index is
   * more than `exclude` metres away from `self` along the lap. Used to keep
   * barriers of neighbouring track sections apart.
   */
  distanceToOther(x: number, z: number, self: number, exclude = 120): number {
    const C = Track.HASH_CELL;
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    let best = Infinity;
    for (let ox = -3; ox <= 3; ox++)
      for (let oz = -3; oz <= 3; oz++) {
        const arr = this.hash.get(this.hashKeyCell(cx + ox, cz + oz));
        if (!arr) continue;
        for (const i of arr) {
          if (Math.abs(this.delta(self, i)) < exclude) continue;
          const d = Math.hypot(x - this.px[i], z - this.pz[i]);
          if (d < best) best = d;
        }
      }
    return best;
  }

  // ---------------------------------------------------------------- build

  private hashKey(x: number, z: number) {
    return this.hashKeyCell(Math.floor(x / Track.HASH_CELL), Math.floor(z / Track.HASH_CELL));
  }
  private hashKeyCell(cx: number, cz: number) {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private buildKerbs() {
    const n = this.n;
    const mark = (side: number, from: number, to: number, width: number) => {
      const arr = side < 0 ? this.kerbL : this.kerbR;
      for (let s = Math.floor(from); s <= Math.ceil(to); s++) {
        const i = ((s % n) + n) % n;
        arr[i] = Math.max(arr[i], width);
      }
    };
    for (const c of this.corners) {
      const inside = -c.dir; // lateral sign of the inside of the corner
      const outside = c.dir;
      const st = c.sStart;
      const ap = st + this.delta(st, c.sApex);
      const en = st + this.delta(st, c.sEnd);
      const w = c.radius < 90 ? 1.35 : c.radius < 180 ? 1.2 : 1.0;
      // apex kerb on the inside
      mark(inside, ap - (ap - st) * 0.6 - 4, ap + (en - ap) * 0.6 + 4, w);
      // exit kerb on the outside
      mark(outside, ap + (en - ap) * 0.3, en + (c.radius < 150 ? 28 : 18), w * 1.1);
      // turn-in kerb on the outside for slower corners
      if (c.radius < 160) mark(outside, st - 22, st + 6, w);
    }
    // Clean up tiny gaps (<10 m) so chicanes read as continuous kerbing.
    for (const arr of [this.kerbL, this.kerbR]) {
      let gapStart = -1;
      for (let s = 0; s < n * 2; s++) {
        const i = s % n;
        if (arr[i] === 0) {
          if (gapStart < 0) gapStart = s;
        } else {
          if (gapStart >= 0 && s - gapStart < 10 && gapStart > 0) {
            const wv = arr[i];
            for (let k = gapStart; k < s; k++) arr[k % n] = wv;
          }
          gapStart = -1;
        }
      }
    }
  }

  private buildRunoff() {
    const n = this.n;
    for (const c of this.corners) {
      const outside = c.dir;
      const code = RUNOFF_CODE[c.runoff];
      const st = c.sStart;
      const en = st + this.delta(st, c.sEnd);
      const arr = outside < 0 ? this.runoffL : this.runoffR;
      for (let s = Math.floor(st - 25); s <= Math.ceil(en + 70); s++) {
        const i = ((s % n) + n) % n;
        // asphalt wins over gravel wins over grass
        const cur = arr[i];
        if (code === SURF.ASPHALT || cur === SURF.GRASS) arr[i] = code;
      }
      // slow corners get tarmac on the inside too
      if (c.radius < 45) {
        const inArr = outside < 0 ? this.runoffR : this.runoffL;
        for (let s = Math.floor(st - 10); s <= Math.ceil(en + 10); s++) inArr[((s % n) + n) % n] = SURF.ASPHALT;
      }
    }
    // pit side of the main straight is tarmac (pit lane)
    const pitArr = this.pit.side > 0 ? this.runoffR : this.runoffL;
    for (let s = Math.floor(this.pit.sStart) - 40; s <= this.pit.sEnd + 40; s++) pitArr[((s % n) + n) % n] = SURF.ASPHALT;
  }

  private buildBarriers() {
    const n = this.n;
    const hw = this.def.halfWidth;
    const tL = new Float32Array(n);
    const tR = new Float32Array(n);
    // Straights: 11–16 m from the edge with a slow wobble so walls don't look ruled.
    for (let i = 0; i < n; i++) {
      const wob = 2.5 * Math.sin(i * 0.011) + 1.5 * Math.sin(i * 0.029 + 1.3);
      tL[i] = hw + 13 + wob;
      tR[i] = hw + 13 - wob;
    }
    for (const c of this.corners) {
      const outside = c.dir;
      const st = c.sStart;
      const en = st + this.delta(st, c.sEnd);
      const out = outside < 0 ? tL : tR;
      const ins = outside < 0 ? tR : tL;
      for (let s = Math.floor(st - 40); s <= Math.ceil(en + 80); s++) {
        const i = ((s % n) + n) % n;
        // ramp in/out of the full runoff depth
        const ramp = Math.min(1, (s - (st - 40)) / 50, (en + 80 - s) / 60);
        out[i] = Math.max(out[i], hw + 10 + (c.runoffDepth - 10) * Math.max(0, ramp));
      }
      for (let s = Math.floor(st); s <= Math.ceil(en); s++) {
        const i = ((s % n) + n) % n;
        ins[i] = Math.max(ins[i], hw + 9);
      }
    }
    // pit wall
    const pitT = this.pit.side > 0 ? tR : tL;
    for (let s = Math.floor(this.pit.sStart) - 30; s <= this.pit.sEnd + 30; s++) {
      const i = ((s % n) + n) % n;
      const inside = s >= this.pit.sStart && s <= this.pit.sEnd;
      pitT[i] = inside ? this.pit.wallOffset : Math.min(pitT[i], hw + 8);
    }

    let L = smoothCircular(tL, 12, 3);
    let R = smoothCircular(tR, 12, 3);
    // the pit wall is dead straight; don't let smoothing round its ends into the lane
    for (let s = Math.floor(this.pit.sStart); s <= this.pit.sEnd; s++) {
      const i = ((s % n) + n) % n;
      (this.pit.side > 0 ? R : L)[i] = this.pit.wallOffset;
    }

    // Geometric limits: inside of tight corners, and other parts of the circuit.
    // `clear` is each sample's distance to the nearest *other* section, so the
    // expensive outward march only runs where two sections are actually close.
    const clear = new Float32Array(n);
    for (let i = 0; i < n; i++) clear[i] = this.distanceToOther(this.px[i], this.pz[i], i);
    const limit = (arr: Float32Array, side: number) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let d = arr[i];
        const k = this.kappa[i];
        // inside of a corner: the offset curve cusps at 1/κ
        if (Math.sign(k) === -side && Math.abs(k) > 1e-5) d = Math.min(d, 0.8 / Math.abs(k));
        // march outwards and stop where another section is closer than we are
        const rx = this.rx[i] * side;
        const rz = this.rz[i] * side;
        if (clear[i] < d * 2 + 12) for (let q = hw + 2; q <= d; q += 2) {
          const x = this.px[i] + rx * q;
          const z = this.pz[i] + rz * q;
          const other = this.distanceToOther(x, z, i);
          if (other < q + 2) {
            d = Math.max(hw + 2.5, q - 2);
            break;
          }
        }
        out[i] = Math.max(hw + 2.5, d);
      }
      return out;
    };
    L = limit(L, -1);
    R = limit(R, 1);
    // smooth the limited result, but only ever pull walls in
    const Ls = smoothCircular(L, 6, 2);
    const Rs = smoothCircular(R, 6, 2);
    for (let i = 0; i < n; i++) {
      this.barrierL[i] = Math.min(L[i], Ls[i] + 0.5);
      this.barrierR[i] = Math.min(R[i], Rs[i] + 0.5);
    }
    for (let s = Math.floor(this.pit.sStart); s <= this.pit.sEnd; s++) {
      const i = ((s % n) + n) % n;
      (this.pit.side > 0 ? this.barrierR : this.barrierL)[i] = this.pit.wallOffset;
    }
  }

  /**
   * Racing line after Rémi Coulom's K1999: iteratively move each point
   * laterally so its curvature becomes the average of its neighbours'
   * curvatures. That spreads every corner over the available width and gives
   * the classic outside–apex–outside line (a plain elastic band would just hug
   * the inside of the lap). Coarse strides first, then finer ones.
   */
  private buildRacingLine() {
    const n = this.n;
    const step = 3;
    const m = Math.floor(n / step);
    const off = new Float64Array(m);
    const lo = new Float64Array(m);
    const hi = new Float64Array(m);
    const cx = new Float64Array(m), cz = new Float64Array(m), rx = new Float64Array(m), rz = new Float64Array(m);
    const MARGIN = 1.2;
    for (let j = 0; j < m; j++) {
      const i = j * step;
      cx[j] = this.px[i]; cz[j] = this.pz[i];
      const rl = Math.hypot(this.rx[i], this.rz[i]);
      rx[j] = this.rx[i] / rl; rz[j] = this.rz[i] / rl;
      const hw = this.halfWidth[i];
      lo[j] = -(hw - MARGIN) - this.kerbL[i] * 0.6;
      hi[j] = hw - MARGIN + this.kerbR[i] * 0.6;
    }
    const X = (j: number) => cx[j] + rx[j] * off[j];
    const Z = (j: number) => cz[j] + rz[j] * off[j];
    const curv3 = (ax: number, az: number, bx: number, bz: number, qx: number, qz: number) => {
      const x1 = bx - ax, z1 = bz - az, x2 = qx - bx, z2 = qz - bz;
      const cross = x1 * z2 - z1 * x2;
      const d = Math.hypot(x1, z1) * Math.hypot(x2, z2) * Math.hypot(qx - ax, qz - az);
      return d > 1e-9 ? (2 * cross) / d : 0;
    };
    const w = (j: number) => ((j % m) + m) % m;
    const curvAt = (j: number, k: number) => {
      const a = w(j - k), b = w(j + k);
      return curv3(X(a), Z(a), X(j), Z(j), X(b), Z(b));
    };
    for (const k of [24, 12, 6, 3, 2, 1]) {
      const iters = k >= 12 ? 70 : 45;
      for (let it = 0; it < iters; it++) {
        for (let j = 0; j < m; j++) {
          const a = w(j - k), b = w(j + k);
          const target = 0.5 * (curvAt(a, k) + curvAt(b, k));
          const ax = X(a), az = Z(a), bx = X(b), bz = Z(b);
          const o = off[j];
          const c0 = curv3(ax, az, cx[j] + rx[j] * o, cz[j] + rz[j] * o, bx, bz);
          const eps = 0.05;
          const c1 = curv3(ax, az, cx[j] + rx[j] * (o + eps), cz[j] + rz[j] * (o + eps), bx, bz);
          const dc = (c1 - c0) / eps;
          if (Math.abs(dc) < 1e-7) continue;
          let nv = o + ((target - c0) / dc) * 0.7;
          if (nv < lo[j]) nv = lo[j];
          if (nv > hi[j]) nv = hi[j];
          off[j] = nv;
        }
      }
    }
    // upsample to 1 m and smooth gently
    const full = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = i / step;
      const j = Math.floor(g) % m;
      const f = g - Math.floor(g);
      full[i] = off[j] * (1 - f) + off[(j + 1) % m] * f;
    }
    const sm = smoothCircular(full, 3, 2);
    for (let i = 0; i < n; i++) this.racingLine[i] = sm[i];
  }
}

export function smoothCircular(src: Float32Array | Float64Array, radius: number, passes: number): Float32Array {
  const n = src.length;
  let a = Float32Array.from(src);
  let b = new Float32Array(n);
  const w = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += a[((k % n) + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = acc / w;
      acc += a[(i + radius + 1) % n] - a[(((i - radius) % n) + n) % n];
    }
    const t = a;
    a = b;
    b = t;
  }
  return a;
}
