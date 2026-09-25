import { Track, type DistanceField } from '../Track.ts';
import { clamp, fbm2, lerp, perlin2, ridged2, smoothstep } from './noise.ts';
import type { OvalPath } from './ovalpath.ts';

/**
 * The shape of the land around Monza: the Parco di Monza (flat royal park,
 * woods and lawns), the Lombardy plain beyond it and the Prealps on the
 * northern horizon.
 *
 *   natural(x,z)  a heavily blurred copy of the circuit's heights (the park is
 *                 almost flat, ≤ 6 m) + gentle undulation, the plain falling
 *                 away very slowly to the south, mountains 9–15 km north.
 *   track         within barrier + 2 m the ground sits 0.3 m under the extended
 *                 road plane (the trackside meshes cover it), then blends back
 *                 to the natural ground over ~30 m. The pit/paddock band east of
 *                 the main straight is kept flat for the pit complex.
 *   pads          flat platforms / raised spectator banks, in world or track coords.
 *
 * Heights are cached in three nested grids after `bake()`:
 *   far  256 m  (±15 km: plain + mountains)
 *   mid   16 m  (the 6 km park square)
 *   fine   4 m  (the circuit and its surroundings)
 * `height(x, z)` samples those grids exactly like the rendered triangles.
 */

export const FINE_CELL = 4;
export const MID_CELL = 16;
export const FAR_CELL = 256;

export interface Bounds { x0: number; x1: number; z0: number; z1: number }
export interface V2 { x: number; z: number }

export interface WorldPad {
  cx: number; cz: number; halfW: number; halfL: number; angle: number;
  /** target height (absolute) */
  h: number;
  blend: number;
  paved?: boolean;
}

export interface TrackPad {
  /** track-relative band: s range and lateral range (signed, + = right) */
  sA: number; sB: number; latA: number; latB: number;
  /** offset from the extended road plane */
  offset: number;
  blend: number;
  paved?: boolean;
}

/** oriented rectangle nothing (trees, props) may enter */
export interface Exclusion { cx: number; cz: number; halfW: number; halfL: number; angle: number }

/** soft open area (lawn / meadow): trees thin out inside it */
export interface Clearing { x: number; z: number; r: number; soft: number; keep: number }

/** polyline path/road; kind 1 = gravel path, 2 = asphalt road */
export interface ParkPath { pts: V2[]; width: number; kind: 1 | 2 }

export interface Anchors {
  bb: Bounds;
  center: V2;
}

const floorTo = (v: number, k: number) => Math.floor(v / k) * k;
const ceilTo = (v: number, k: number) => Math.ceil(v / k) * k;

export type Venue = 'park' | 'ardennes' | 'airfield';

export class WorldMap {
  readonly track: Track;
  readonly dfFar: DistanceField;
  readonly dfNear: DistanceField;
  readonly A: Anchors;
  readonly SQUARE: Bounds;
  readonly FINE: Bounds;
  readonly FAR: Bounds;
  /** the Parco di Monza boundary (inside = park) */
  readonly park: { cx: number; cz: number; rx: number; rz: number };
  /** the land the circuit sits in: Monza's flat royal park or the hills and spruce woods of the Ardennes */
  readonly venue: Venue;
  private pitBox!: Bounds;
  private readonly proj = { s: 0, lat: 0 };
  private readonly platform: Float32Array;
  private platformFar = 2;
  readonly worldPads: WorldPad[] = [];
  readonly trackPads: TrackPad[] = [];
  readonly exclusions: Exclusion[] = [];
  readonly clearings: Clearing[] = [];
  readonly paths: ParkPath[] = [];
  oval: OvalPath | null = null;
  private ovalHash = new Map<number, number[]>();

  // natural-height grid (32 m, bicubic) covering the square + margin
  private natGrid!: Float32Array;
  private natW = 0;
  private natH = 0;
  private static readonly NAT_CELL = 32;
  private natX0 = 0;
  private natZ0 = 0;

  far!: Float32Array; farW = 0; farH = 0;
  mid!: Float32Array; midW = 0; midH = 0;
  fine!: Float32Array; fineW = 0; fineH = 0;
  /** per fine vertex: 0..1 how much the track flattening owns it (1 = flat zone) */
  fineTrack!: Float32Array;

  constructor(track: Track) {
    this.track = track;
    this.A = computeAnchors(track);
    const { bb, center } = this.A;
    const cx = Math.round(center.x / 512) * 512;
    const cz = Math.round(center.z / 512) * 512;
    this.SQUARE = { x0: cx - 3072, x1: cx + 3072, z0: cz - 3072, z1: cz + 3072 };
    this.FAR = { x0: this.SQUARE.x0 - 12288, x1: this.SQUARE.x1 + 12288, z0: this.SQUARE.z0 - 12288, z1: this.SQUARE.z1 + 12288 };
    this.FINE = {
      x0: floorTo(bb.x0 - 340, 16),
      x1: ceilTo(bb.x1 + 340, 16),
      z0: floorTo(bb.z0 - 340, 16),
      z1: ceilTo(bb.z1 + 420, 16),
    };
    // the park: the circuit sits in its northern half, the Villa Reale lawns to the south
    this.venue = track.def.id === 'spa' ? 'ardennes' : track.def.id === 'silverstone' ? 'airfield' : 'park';
    // (in the Ardennes the "park" is the whole forest: no plain, no towns)
    // (at Silverstone the "park" is the circuit estate on the old airfield: farmland and villages beyond)
    const { bb: B } = this.A;
    this.park =
      this.venue === 'ardennes'
        ? { cx: center.x, cz: center.z, rx: 1e5, rz: 1e5 }
        : this.venue === 'airfield'
          ? { cx: center.x, cz: center.z, rx: (B.x1 - B.x0) / 2 + 520, rz: (B.z1 - B.z0) / 2 + 520 }
          : { cx: center.x - 40, cz: center.z + 420, rx: 1450, rz: 2250 };
    this.dfFar = track.buildDistanceField(40, 700, 560);
    this.dfNear = track.buildDistanceField(8, 170, 124);
    {
      const p = track.pit;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const s of [p.sStart - 30, p.sEnd + 30])
        for (const l of [0, p.side * 150]) {
          const q = track.point(s, l, 0);
          x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
        }
      this.pitBox = { x0, x1, z0, z1 };
    }
    // platform = normalised blur of the centreline heights
    const f = this.dfFar;
    const n = f.w * f.h;
    const hw = new Float32Array(n);
    const w = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < track.n; i++) mean += track.py[i];
    mean /= track.n;
    this.platformFar = mean;
    for (let i = 0; i < n; i++) {
      const d = f.dist[i];
      if (isFinite(d)) {
        const ww = Math.exp(-((d / 240) ** 2));
        w[i] = ww;
        hw[i] = f.height[i] * ww;
      }
    }
    blur2(hw, f.w, f.h, 3, 3);
    blur2(w, f.w, f.h, 3, 3);
    this.platform = new Float32Array(n);
    for (let i = 0; i < n; i++) this.platform[i] = (hw[i] + mean * 0.03) / (w[i] + 0.03);
  }

  private ovG: { x0: number; z0: number; w: number; h: number; d: Float32Array; i: Int32Array } | null = null;
  setOval(o: OvalPath) {
    this.oval = o;
    this.ovalHash.clear();
    for (let i = 0; i < o.n; i++) {
      const k = this.ovalKey(Math.floor(o.x[i] / 32), Math.floor(o.z[i] / 32));
      let a = this.ovalHash.get(k);
      if (!a) this.ovalHash.set(k, (a = []));
      a.push(i);
    }
    // 4 m distance grid around the oval (reach 36 m) for fast clearance queries
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < o.n; i++) {
      x0 = Math.min(x0, o.x[i]); x1 = Math.max(x1, o.x[i]); z0 = Math.min(z0, o.z[i]); z1 = Math.max(z1, o.z[i]);
    }
    const C = 4, M = 40;
    x0 -= M; z0 -= M; x1 += M; z1 += M;
    const w = Math.ceil((x1 - x0) / C) + 1, h = Math.ceil((z1 - z0) / C) + 1;
    const d = new Float32Array(w * h).fill(1e4);
    const id = new Int32Array(w * h).fill(-1);
    const R = 9;
    for (let i = 0; i < o.n; i++) {
      const ci = Math.round((o.x[i] - x0) / C), cj = Math.round((o.z[i] - z0) / C);
      for (let b = -R; b <= R; b++) {
        const jj = cj + b;
        if (jj < 0 || jj >= h) continue;
        for (let a = -R; a <= R; a++) {
          const ii = ci + a;
          if (ii < 0 || ii >= w) continue;
          const k = jj * w + ii;
          const dd = Math.hypot(x0 + ii * C - o.x[i], z0 + jj * C - o.z[i]);
          if (dd < d[k]) { d[k] = dd; id[k] = i; }
        }
      }
    }
    this.ovG = { x0, z0, w, h, d, i: id };
  }
  private ovalKey(cx: number, cz: number) {
    return (cx + 2048) * 4096 + (cz + 2048);
  }
  /** nearest oval sample within ~64 m: index and horizontal distance (−1 / Infinity if none) */
  ovalNear(x: number, z: number): { i: number; d: number } {
    const o = this.oval;
    if (!o) return { i: -1, d: Infinity };
    const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
    let best = -1, bd = Infinity;
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const arr = this.ovalHash.get(this.ovalKey(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const d = (x - o.x[i]) ** 2 + (z - o.z[i]) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    return { i: best, d: Math.sqrt(bd) };
  }

  /**
   * Distance from the old oval's footprint (running surface + supports, or the
   * embankment's toe near the bridge). Negative inside; large when far away.
   */
  ovalClearance(x: number, z: number): number {
    const o = this.oval;
    const g = this.ovG;
    if (!o || !g) return 1e4;
    const ii = Math.round((x - g.x0) / 4), jj = Math.round((z - g.z0) / 4);
    if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) return 1e4;
    const k = jj * g.w + ii;
    const i = g.i[k];
    if (i < 0) return 1e4;
    const d = Math.hypot(x - o.x[i], z - o.z[i]);
    const half = o.width / 2 + 2.5 + 1.6 * o.emb[i] + 1.5 * o.bank[i];
    return d - half;
  }

  /** Allocation-free nearest-centreline projection around a hint index. */
  projectFast(x: number, z: number, hint: number, win: number): { s: number; lat: number } {
    const t = this.track;
    const n = t.n;
    const px = t.px, pz = t.pz;
    let best = hint, bestD = Infinity;
    for (let k = -win; k <= win; k++) {
      let i = hint + k;
      if (i < 0) i += n;
      else if (i >= n) i -= n;
      const dx = x - px[i], dz = z - pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    const ip = best === 0 ? n - 1 : best - 1;
    const inx = best === n - 1 ? 0 : best + 1;
    let ax = px[ip], az = pz[ip], vx = px[best] - ax, vz = pz[best] - az;
    let ta = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
    ta = ta < 0 ? 0 : ta > 1 ? 1 : ta;
    const da = (x - ax - vx * ta) ** 2 + (z - az - vz * ta) ** 2;
    ax = px[best]; az = pz[best]; vx = px[inx] - ax; vz = pz[inx] - az;
    let tb = ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz);
    tb = tb < 0 ? 0 : tb > 1 ? 1 : tb;
    const db = (x - ax - vx * tb) ** 2 + (z - az - vz * tb) ** 2;
    let s = da < db ? best - 1 + ta : best + tb;
    if (s < 0) s += n;
    if (s >= n) s -= n;
    const j = Math.floor(s);
    const f = s - j;
    const j2 = j + 1 >= n ? 0 : j + 1;
    const cx = px[j] * (1 - f) + px[j2] * f;
    const cz = pz[j] * (1 - f) + pz[j2] * f;
    const rx = t.rx[j] * (1 - f) + t.rx[j2] * f;
    const rz = t.rz[j] * (1 - f) + t.rz[j2] * f;
    const rl = Math.sqrt(rx * rx + rz * rz);
    this.proj.s = s;
    this.proj.lat = ((x - cx) * rx + (z - cz) * rz) / rl;
    return this.proj;
  }

  /** nearest centreline (s, lateral) for points within ~120 m of the track, else null */
  projectNear(x: number, z: number): { s: number; lat: number } | null {
    const f = this.dfNear;
    const gx = Math.round((x - f.originX) / f.cell);
    const gz = Math.round((z - f.originZ) / f.cell);
    if (gx < 0 || gz < 0 || gx >= f.w || gz >= f.h) return null;
    const hint = f.nearest[gz * f.w + gx];
    if (hint < 0) return null;
    return this.projectFast(x, z, hint, 10);
  }

  // ------------------------------------------------------------ primitives

  distToTrack(x: number, z: number): number {
    const d = Track.sampleField(this.dfFar, this.dfFar.dist, x, z);
    return isFinite(d) ? d : 1e5;
  }

  platformAt(x: number, z: number): number {
    const f = this.dfFar;
    const gx = (x - f.originX) / f.cell;
    const gz = (z - f.originZ) / f.cell;
    if (gx < 0 || gz < 0 || gx >= f.w - 1 || gz >= f.h - 1) return this.platformFar;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const i = z0 * f.w + x0;
    const p = this.platform;
    return (p[i] * (1 - fx) + p[i + 1] * fx) * (1 - fz) + (p[i + f.w] * (1 - fx) + p[i + f.w + 1] * fx) * fz;
  }

  /** 0 inside the park … 1 well outside it (farmland / villages) */
  outsidePark(x: number, z: number): number {
    const P = this.park;
    const u = (x - P.cx) / P.rx, v = (z - P.cz) / P.rz;
    const r = Math.sqrt(u * u + v * v) + 0.06 * fbm2(x / 700 + 3.1, z / 700 - 1.7, 2);
    return smoothstep(0.97, 1.03, r);
  }

  /** metres beyond the park boundary (negative inside), approximate */
  parkDistance(x: number, z: number): number {
    const P = this.park;
    const u = (x - P.cx) / P.rx, v = (z - P.cz) / P.rz;
    const r = Math.sqrt(u * u + v * v);
    return (r - 1) * Math.sqrt(P.rx * P.rz);
  }

  /** built-up density 0..1 outside the park: Monza, Villasanta, Biassono, Vedano… */
  urban(x: number, z: number): number {
    const out = this.outsidePark(x, z);
    if (out <= 0) return 0;
    const d = this.parkDistance(x, z);
    const near = 1 - smoothstep(600, 3800, d);
    const n = fbm2(x / 1100 + 7.3, z / 1100 - 3.9, 3) * 0.5 + 0.5;
    const n2 = fbm2(x / 300 - 1.7, z / 300 + 2.2, 2) * 0.5 + 0.5;
    // Monza to the south is solid town; elsewhere separate villages with fields between
    const south = this.venue === 'airfield' ? -0.12 : smoothstep(this.park.cz + 1200, this.park.cz + 2600, z) * 0.22;
    return out * smoothstep(0.5, 0.64, 0.12 + 0.38 * near + 0.95 * (n - 0.5) + 0.22 * (n2 - 0.5) + south);
  }

  /** natural land height (before track and pads) — exact evaluation */
  naturalExact(x: number, z: number): number {
    const { center } = this.A;
    const P = this.platformAt(x, z);
    const dT = this.distToTrack(x, z);
    const far = smoothstep(40, 380, dT);
    let h = P;
    if (this.venue === 'ardennes') {
      // wooded valley sides near the circuit, rolling ridges of 100–200 m further out
      h += (0.3 + 0.7 * far) * (14 * fbm2(x / 700 + 2.3, z / 700 - 4.1, 4) + 4 * fbm2(x / 180 - 3.3, z / 180 + 1.9, 2));
      const Rh = Math.hypot(x - center.x, z - center.z);
      const hills = smoothstep(1400, 6000, Rh);
      const m = ridged2(x / 3800 + 0.7, z / 3800 - 2.9, 4, 2.0, 0.5);
      h += hills * (30 + 170 * Math.pow(m, 1.4) * (0.6 + 0.4 * (fbm2(x / 7000 - 1.1, z / 7000 + 2.6, 2) * 0.5 + 0.5)));
      return h;
    }
    if (this.venue === 'airfield') {
      // Northamptonshire: an old airfield on a plateau, gentle rolling farmland round it
      h += (0.2 + 0.8 * far) * (1.6 * fbm2(x / 420 + 5.2, z / 420 - 2.4, 3) + 0.3 * fbm2(x / 110 - 1.3, z / 110 + 7.1, 2));
      const R = Math.hypot(x - center.x, z - center.z);
      h += smoothstep(1800, 7000, R) * 26 * (fbm2(x / 2600 + 1.7, z / 2600 - 0.4, 3) * 0.5 + 0.35);
      return h;
    }
    // gentle park undulation (never more than a couple of metres)
    h += (0.25 + 0.75 * far) * (1.3 * fbm2(x / 340 + 5.2, z / 340 - 2.4, 3) + 0.35 * fbm2(x / 95 - 1.3, z / 95 + 7.1, 2));
    // the plain drops very slowly towards Milan (south) and the Lambro valley (east)
    const R = Math.hypot(x - center.x, z - center.z);
    const plain = smoothstep(2200, 5000, R);
    h += plain * (-0.0022 * (z - center.z) - 4);
    // Brianza hills and the Prealps to the north
    const north = smoothstep(center.z - 8500, center.z - 14500, z);
    if (north > 0) {
      const m = ridged2(x / 5200 + 1.3, z / 5200 + 8.2, 4, 2.1, 0.5);
      const bmass = fbm2(x / 9000 - 2.1, z / 9000 + 0.7, 2) * 0.5 + 0.5;
      h += north * (80 + 1350 * m * m * (0.45 + 0.7 * bmass));
    }
    const brianza = smoothstep(center.z - 2600, center.z - 6500, z) * (1 - north);
    h += brianza * 45 * (fbm2(x / 1600 + 4.4, z / 1600 - 2.2, 3) * 0.5 + 0.5);
    return h;
  }

  natural(x: number, z: number): number {
    return this.natBicubic(x, z) + 0.12 * perlin2(x / 21 + 0.37, z / 21 + 0.71);
  }

  private natBicubic(x: number, z: number): number {
    const C = WorldMap.NAT_CELL;
    const gx = (x - this.natX0) / C;
    const gz = (z - this.natZ0) / C;
    const W = this.natW, H = this.natH;
    let x1 = Math.floor(gx), z1 = Math.floor(gz);
    const fx = gx - x1, fz = gz - z1;
    x1 = x1 < 1 ? 1 : x1 > W - 3 ? W - 3 : x1;
    z1 = z1 < 1 ? 1 : z1 > H - 3 ? H - 3 : z1;
    const g = this.natGrid;
    let k = (z1 - 1) * W + x1 - 1;
    const r0 = cubic(g[k], g[k + 1], g[k + 2], g[k + 3], fx);
    k += W;
    const r1 = cubic(g[k], g[k + 1], g[k + 2], g[k + 3], fx);
    k += W;
    const r2 = cubic(g[k], g[k + 1], g[k + 2], g[k + 3], fx);
    k += W;
    const r3 = cubic(g[k], g[k + 1], g[k + 2], g[k + 3], fx);
    return cubic(r0, r1, r2, r3, fz);
  }

  private tpIndex: (TrackPad[] | undefined)[] | null = null;
  private tpCount = -1;
  private indexTrackPads() {
    const n = this.track.n;
    const idx: (TrackPad[] | undefined)[] = new Array(n);
    for (const p of this.trackPads) {
      const len = this.track.delta(p.sA, p.sB);
      for (let s = Math.floor(p.sA - p.blend - 1); s <= Math.ceil(p.sA + len + p.blend + 1); s++) {
        const i = ((s % n) + n) % n;
        (idx[i] ??= []).push(p);
      }
    }
    this.tpIndex = idx;
    this.tpCount = this.trackPads.length;
  }

  private wpHash: Map<number, WorldPad[]> | null = null;
  private wpCount = -1;
  private hashPads() {
    const h = new Map<number, WorldPad[]>();
    for (const p of this.worldPads) {
      const R = p.halfW + p.halfL + p.blend;
      for (let a = Math.floor((p.cx - R) / 64); a <= Math.floor((p.cx + R) / 64); a++)
        for (let b = Math.floor((p.cz - R) / 64); b <= Math.floor((p.cz + R) / 64); b++) {
          const k = (a + 4096) * 8192 + (b + 4096);
          let arr = h.get(k);
          if (!arr) h.set(k, (arr = []));
          arr.push(p);
        }
    }
    this.wpHash = h;
    this.wpCount = this.worldPads.length;
  }

  /** Exact final height. `trackOut` receives [trackWeight, s, lateral]. */
  evaluate(x: number, z: number, trackOut?: Float32Array): number {
    let N = this.natural(x, z);
    // world pads
    if (!this.wpHash || this.wpCount !== this.worldPads.length) this.hashPads();
    const wpl = this.wpHash!.get((Math.floor(x / 64) + 4096) * 8192 + (Math.floor(z / 64) + 4096));
    if (wpl) for (const p of wpl) {
      const dx = x - p.cx, dz = z - p.cz;
      const R = p.halfW + p.halfL + p.blend;
      if (dx * dx + dz * dz > R * R) continue;
      const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      const u = Math.abs(dx * ca - dz * sa) - p.halfW;
      const v = Math.abs(dx * sa + dz * ca) - p.halfL;
      const o = Math.hypot(Math.max(u, 0), Math.max(v, 0));
      if (o < p.blend) N = lerp(p.h, N, smoothstep(0, p.blend, o));
    }
    let tw = 0;
    let sOut = -1, latOut = 0;
    const dNear = Track.sampleField(this.dfNear, this.dfNear.dist, x, z);
    const pb = this.pitBox;
    const inPit = x > pb.x0 && x < pb.x1 && z > pb.z0 && z < pb.z1;
    let hint = -1;
    if (isFinite(dNear) && dNear < 118) {
      const f = this.dfNear;
      const gx = Math.round((x - f.originX) / f.cell);
      const gz = Math.round((z - f.originZ) / f.cell);
      hint = f.nearest[clamp(gz, 0, f.h - 1) * f.w + clamp(gx, 0, f.w - 1)];
    } else if (inPit) {
      hint = this.track.project(x, z, Math.round((this.track.pit.sStart + this.track.pit.sEnd) / 2), 480).index;
    }
    if (hint >= 0) {
      const pr = this.projectFast(x, z, hint, 12);
      const tr = this.track;
      const s = pr.s, lat = pr.lat;
      sOut = s; latOut = lat;
      const side = lat < 0 ? -1 : 1;
      const bar = tr.barrierAt(s, side);
      const al = Math.abs(lat);
      const i = Math.floor(s) % tr.n;
      const j = (i + 1) % tr.n;
      const a = s - Math.floor(s);
      const py = tr.py[i] * (1 - a) + tr.py[j] * a;
      const ry = tr.ry[i] * (1 - a) + tr.ry[j] * a;
      // the plane is only extended a little: far out it follows the centreline height
      const plane = py + ry * Math.min(al, 40) * Math.sign(lat);
      let flatUntil = bar + 2;
      let offset = -0.3;
      let blend = 30;
      const pit = tr.pit;
      if (side === pit.side && s > pit.sStart - 40 && s < pit.sEnd + 40) {
        const ramp = Math.min(smoothstep(pit.sStart - 40, pit.sStart + 10, s), 1 - smoothstep(pit.sEnd - 10, pit.sEnd + 40, s));
        flatUntil = lerp(flatUntil, 132, ramp);
        if (al > pit.wallOffset + 1 && ramp > 0.02) offset = lerp(offset, -0.16, ramp);
        blend = 40;
      }
      if (!this.tpIndex || this.tpCount !== this.trackPads.length) this.indexTrackPads();
      const tpl = this.tpIndex![Math.floor(s) % tr.n];
      if (tpl) for (const p of tpl) {
        const ds = tr.delta(p.sA, s);
        const len = tr.delta(p.sA, p.sB);
        if (ds < -p.blend || ds > len + p.blend) continue;
        const lo = Math.min(p.latA, p.latB), hi = Math.max(p.latA, p.latB);
        const os = Math.max(0, -ds, ds - len);
        const ol = Math.max(0, lo - lat, lat - hi);
        const o = Math.hypot(os, ol);
        if (o < p.blend) N = lerp(plane + p.offset, N, smoothstep(0, p.blend, o));
      }
      tw = 1 - smoothstep(flatUntil, flatUntil + blend, al);
      N = lerp(N, plane + offset, tw);
    }
    if (trackOut) {
      trackOut[0] = tw;
      trackOut[1] = sOut;
      trackOut[2] = latOut;
    }
    return N;
  }

  // ------------------------------------------------------------ baking

  timings: Record<string, number> = {};

  bake() {
    const { SQUARE, FINE, FAR } = this;
    let tt = performance.now();
    const lap = (k: string) => {
      const n = performance.now();
      this.timings[k] = Math.round(n - tt);
      tt = n;
    };
    {
      const C = WorldMap.NAT_CELL;
      this.natX0 = SQUARE.x0 - 2 * C;
      this.natZ0 = SQUARE.z0 - 2 * C;
      this.natW = Math.round((SQUARE.x1 - SQUARE.x0) / C) + 5;
      this.natH = Math.round((SQUARE.z1 - SQUARE.z0) / C) + 5;
      this.natGrid = new Float32Array(this.natW * this.natH);
      for (let j = 0; j < this.natH; j++)
        for (let i = 0; i < this.natW; i++)
          this.natGrid[j * this.natW + i] = this.naturalExact(this.natX0 + i * C, this.natZ0 + j * C);
    }
    lap('nat');
    {
      const C = FAR_CELL;
      const W = (this.farW = Math.round((FAR.x1 - FAR.x0) / C) + 1);
      const H = (this.farH = Math.round((FAR.z1 - FAR.z0) / C) + 1);
      this.far = new Float32Array(W * H);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const x = FAR.x0 + i * C, z = FAR.z0 + j * C;
          const inside = x >= SQUARE.x0 && x <= SQUARE.x1 && z >= SQUARE.z0 && z <= SQUARE.z1;
          this.far[j * W + i] = inside ? this.natural(x, z) : this.naturalExact(x, z);
        }
    }
    lap('far');
    {
      const C = MID_CELL;
      const W = (this.midW = Math.round((SQUARE.x1 - SQUARE.x0) / C) + 1);
      const H = (this.midH = Math.round((SQUARE.z1 - SQUARE.z0) / C) + 1);
      this.mid = new Float32Array(W * H);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const x = SQUARE.x0 + i * C, z = SQUARE.z0 + j * C;
          let h: number;
          if (i === 0 || j === 0 || i === W - 1 || j === H - 1) h = this.sampleFar(x, z);
          else if (x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1) h = 0;
          else {
            h = this.evaluate(x, z);
            const e = Math.min(x - SQUARE.x0, SQUARE.x1 - x, z - SQUARE.z0, SQUARE.z1 - z);
            if (e < 400) h = lerp(this.sampleFar(x, z), h, smoothstep(0, 400, e));
          }
          this.mid[j * W + i] = h;
        }
    }
    lap('mid');
    {
      const C = FINE_CELL;
      const W = (this.fineW = Math.round((FINE.x1 - FINE.x0) / C) + 1);
      const H = (this.fineH = Math.round((FINE.z1 - FINE.z0) / C) + 1);
      this.fine = new Float32Array(W * H);
      this.fineTrack = new Float32Array(W * H);
      const out = new Float32Array(3);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const x = FINE.x0 + i * C, z = FINE.z0 + j * C;
          const k = j * W + i;
          if (i === 0 || j === 0 || i === W - 1 || j === H - 1) {
            this.fine[k] = this.sampleMid(x, z);
            continue;
          }
          this.fine[k] = this.evaluate(x, z, out);
          this.fineTrack[k] = out[0];
        }
      // relax creases in the blend band
      const tmp = new Float32Array(this.fine);
      for (let it = 0; it < 2; it++) {
        for (let j = 1; j < H - 1; j++)
          for (let i = 1; i < W - 1; i++) {
            const k = j * W + i;
            const tw = this.fineTrack[k];
            if (tw <= 0.02 || tw >= 0.97) continue;
            const avg = (this.fine[k - 1] + this.fine[k + 1] + this.fine[k - W] + this.fine[k + W]) * 0.25;
            const m = 0.6 * Math.min(1, tw * 4) * Math.min(1, (1 - tw) * 6);
            tmp[k] = lerp(this.fine[k], avg, m);
          }
        this.fine.set(tmp);
      }
    }
    for (let j = 0; j < this.midH; j++)
      for (let i = 0; i < this.midW; i++) {
        const x = SQUARE.x0 + i * MID_CELL, z = SQUARE.z0 + j * MID_CELL;
        if (!(x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1)) continue;
        const fi = Math.round((x - FINE.x0) / FINE_CELL), fj = Math.round((z - FINE.z0) / FINE_CELL);
        this.mid[j * this.midW + i] = this.fine[fj * this.fineW + fi];
      }
    lap('fine');
  }

  sampleFar(x: number, z: number): number {
    return bilinear(this.far, this.farW, this.farH, this.FAR.x0, this.FAR.z0, FAR_CELL, x, z);
  }
  sampleMid(x: number, z: number): number {
    return bilinear(this.mid, this.midW, this.midH, this.SQUARE.x0, this.SQUARE.z0, MID_CELL, x, z);
  }

  inFine(x: number, z: number): boolean {
    const F = this.FINE;
    return x > F.x0 && x < F.x1 && z > F.z0 && z < F.z1;
  }
  inSquare(x: number, z: number): boolean {
    const S = this.SQUARE;
    return x > S.x0 && x < S.x1 && z > S.z0 && z < S.z1;
  }

  /** terrain height (matches the rendered mesh to within a few cm) */
  height(x: number, z: number): number {
    if (this.inFine(x, z)) return bilinear(this.fine, this.fineW, this.fineH, this.FINE.x0, this.FINE.z0, FINE_CELL, x, z);
    if (this.inSquare(x, z)) return this.sampleMid(x, z);
    return this.sampleFar(x, z);
  }

  slope(x: number, z: number, e = 3): number {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return (2 * e) / Math.hypot(hx, 2 * e, hz);
  }

  private exHash: Map<number, Exclusion[]> | null = null;
  private exCount = -1;
  private static readonly EX_CELL = 64;
  excluded(x: number, z: number, margin = 0): boolean {
    if (!this.exHash || this.exCount !== this.exclusions.length) {
      const h = new Map<number, Exclusion[]>();
      const C = WorldMap.EX_CELL;
      for (const e of this.exclusions) {
        const R = e.halfW + e.halfL + 12;
        for (let a = Math.floor((e.cx - R) / C); a <= Math.floor((e.cx + R) / C); a++)
          for (let b = Math.floor((e.cz - R) / C); b <= Math.floor((e.cz + R) / C); b++) {
            const k = (a + 4096) * 8192 + (b + 4096);
            let arr = h.get(k);
            if (!arr) h.set(k, (arr = []));
            arr.push(e);
          }
      }
      this.exHash = h;
      this.exCount = this.exclusions.length;
    }
    const C = WorldMap.EX_CELL;
    const list = this.exHash.get((Math.floor(x / C) + 4096) * 8192 + (Math.floor(z / C) + 4096));
    if (!list) return false;
    for (const e of list) {
      const dx = x - e.cx, dz = z - e.cz;
      const R = e.halfW + e.halfL + margin;
      if (dx * dx + dz * dz > R * R) continue;
      const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
      const u = Math.abs(dx * ca - dz * sa);
      const v = Math.abs(dx * sa + dz * ca);
      if (u < e.halfW + margin && v < e.halfL + margin) return true;
    }
    return false;
  }

  /** is (x,z) inside the pit/paddock band reserved for the pit complex (+ margin)? */
  inPitZone(x: number, z: number, margin = 0): boolean {
    const pb = this.pitBox;
    if (x < pb.x0 - margin || x > pb.x1 + margin || z < pb.z0 - margin || z > pb.z1 + margin) return false;
    const f = this.dfFar;
    const gx = Math.round((x - f.originX) / f.cell), gz = Math.round((z - f.originZ) / f.cell);
    if (gx < 0 || gz < 0 || gx >= f.w || gz >= f.h) return false;
    const hint = f.nearest[gz * f.w + gx];
    if (hint < 0) return false;
    const pr = this.projectFast(x, z, hint, 40);
    const pit = this.track.pit;
    return (
      Math.sign(pr.lat) === pit.side &&
      pr.s > pit.sStart - 20 - margin &&
      pr.s < pit.sEnd + 20 + margin &&
      Math.abs(pr.lat) < 132 + margin
    );
  }

  /**
   * Clearance from the track: distance beyond the barrier on the nearest side
   * (negative = inside the barriers). Large when far away.
   */
  trackClearance(x: number, z: number): number {
    const d = this.distToTrack(x, z);
    if (d > 110) return d - 45;
    const pr = this.projectNear(x, z);
    if (!pr) return d - 45;
    const side = pr.lat < 0 ? -1 : 1;
    const bar = this.track.barrierAt(pr.s, side);
    return Math.abs(pr.lat) - bar;
  }

  private clHash: Map<number, Clearing[]> | null = null;
  private clCount = -1;
  /** soft clearing factor 0 (open lawn) … 1 (no clearing) */
  clearingKeep(x: number, z: number): number {
    const CC = 128;
    if (!this.clHash || this.clCount !== this.clearings.length) {
      const h = new Map<number, Clearing[]>();
      for (const c of this.clearings) {
        const R = c.r + c.soft;
        for (let a = Math.floor((c.x - R) / CC); a <= Math.floor((c.x + R) / CC); a++)
          for (let b = Math.floor((c.z - R) / CC); b <= Math.floor((c.z + R) / CC); b++) {
            const key = (a + 4096) * 8192 + (b + 4096);
            let arr = h.get(key);
            if (!arr) h.set(key, (arr = []));
            arr.push(c);
          }
      }
      this.clHash = h;
      this.clCount = this.clearings.length;
    }
    const list = this.clHash.get((Math.floor(x / CC) + 4096) * 8192 + (Math.floor(z / CC) + 4096));
    if (!list) return 1;
    let k = 1;
    for (const c of list) {
      const dx = x - c.x, dz = z - c.z;
      const R = c.r + c.soft;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const t = smoothstep(c.r, R, Math.sqrt(d2));
      k = Math.min(k, lerp(c.keep, 1, t));
    }
    return k;
  }

  private segHash: Map<number, [number, number, number, number, number, number][]> | null = null;
  private segCount = -1;
  private readonly pd = { d: 40, kind: 0 };
  /** distance to the nearest park path/road edge (m, negative inside), capped at 40 */
  pathDistance(x: number, z: number): { d: number; kind: number } {
    const CC = 64;
    if (!this.segHash || this.segCount !== this.paths.length) {
      const h = new Map<number, [number, number, number, number, number, number][]>();
      for (const p of this.paths)
        for (let i = 0; i < p.pts.length - 1; i++) {
          const a = p.pts[i], b = p.pts[i + 1];
          const seg: [number, number, number, number, number, number] = [a.x, a.z, b.x, b.z, p.width / 2, p.kind];
          const m = 42 + p.width;
          for (let cx = Math.floor((Math.min(a.x, b.x) - m) / CC); cx <= Math.floor((Math.max(a.x, b.x) + m) / CC); cx++)
            for (let cz = Math.floor((Math.min(a.z, b.z) - m) / CC); cz <= Math.floor((Math.max(a.z, b.z) + m) / CC); cz++) {
              const key = (cx + 4096) * 8192 + (cz + 4096);
              let arr = h.get(key);
              if (!arr) h.set(key, (arr = []));
              arr.push(seg);
            }
        }
      this.segHash = h;
      this.segCount = this.paths.length;
    }
    let best = 40, kind = 0;
    const list = this.segHash.get((Math.floor(x / CC) + 4096) * 8192 + (Math.floor(z / CC) + 4096));
    if (list)
      for (const [ax, az, bx, bz, hw, k] of list) {
        const vx = bx - ax, vz = bz - az;
        const L2 = vx * vx + vz * vz || 1;
        let t = ((x - ax) * vx + (z - az) * vz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t) - hw;
        if (d < best) { best = d; kind = k; }
      }
    this.pd.d = best;
    this.pd.kind = kind;
    return this.pd;
  }

  private maskW = 0;
  private maskH = 0;
  private forestGrid: Float32Array | null = null;
  static readonly MASK_CELL = 16;

  /** cache the forest density on a 12 m grid over the fine region (+ coarse outside) */
  bakeMasks() {
    const S = this.SQUARE;
    const C = WorldMap.MASK_CELL;
    const W = (this.maskW = Math.round((S.x1 - S.x0) / C) + 1);
    const H = (this.maskH = Math.round((S.z1 - S.z0) / C) + 1);
    const fg = new Float32Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) fg[j * W + i] = this.forestExact(S.x0 + i * C, S.z0 + j * C);
    this.forestGrid = fg;
  }

  forest(x: number, z: number): number {
    if (!this.forestGrid) return this.forestExact(x, z);
    return bilinear(this.forestGrid, this.maskW, this.maskH, this.SQUARE.x0, this.SQUARE.z0, WorldMap.MASK_CELL, x, z);
  }

  /**
   * Forest density 0..1. The park's woods press right up to the circuit for most
   * of the lap; further out there are big lawns and meadows; outside the park,
   * farmland with hedgerows and copses.
   */
  private forestExact(x: number, z: number): number {
    const dT = this.distToTrack(x, z);
    const n1 = fbm2(x / 520 + 11.3, z / 520 - 7.7, 4);
    const n2 = fbm2(x / 170 - 2.3, z / 170 + 6.1, 3);
    const nearBoost = 0.42 * (1 - smoothstep(90, 320, dT));
    let f = smoothstep(0.42, 0.6, 0.55 + 0.42 * n1 + 0.14 * n2 + nearBoost);
    if (this.venue === 'airfield') {
      // open grass and car parks round the circuit, belts of trees and the odd copse further out
      const belt = smoothstep(0.66, 0.8, fbm2(x / 340 + 3.7, z / 340 - 8.2, 3) * 0.5 + 0.5 + 0.1 * n2);
      f = belt * smoothstep(70, 240, dT) * 0.85;
    }
    f *= this.clearingKeep(x, z);
    const out = this.outsidePark(x, z);
    if (out > 0) {
      // farmland: scattered copses only
      const copse = smoothstep(0.62, 0.78, fbm2(x / 260 + 1.9, z / 260 - 4.4, 3) * 0.5 + 0.5) * (1 - smoothstep(0.2, 0.5, this.urban(x, z)));
      f = lerp(f, copse * 0.8, out);
    }
    return clamp(f, 0, 1);
  }
}

// ---------------------------------------------------------------- anchors

function computeAnchors(track: Track): Anchors {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < track.n; i++) {
    x0 = Math.min(x0, track.px[i]); x1 = Math.max(x1, track.px[i]);
    z0 = Math.min(z0, track.pz[i]); z1 = Math.max(z1, track.pz[i]);
  }
  return { bb: { x0, x1, z0, z1 }, center: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 } };
}

// ---------------------------------------------------------------- helpers

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function bilinear(g: Float32Array, W: number, H: number, x0: number, z0: number, C: number, x: number, z: number): number {
  let gx = (x - x0) / C;
  let gz = (z - z0) / C;
  gx = clamp(gx, 0, W - 1.0001);
  gz = clamp(gz, 0, H - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const k = j * W + i;
  // match the mesh triangulation (diagonal from (i,j) to (i+1,j+1))
  if (fx > fz) return g[k] + (g[k + 1] - g[k]) * fx + (g[k + W + 1] - g[k + 1]) * fz;
  return g[k] + (g[k + W] - g[k]) * fz + (g[k + W + 1] - g[k + W]) * fx;
}

export function blur2(a: Float32Array, W: number, H: number, r: number, passes: number) {
  const tmp = new Float32Array(a.length);
  const win = r * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < H; j++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[j * W + clamp(k, 0, W - 1)];
      for (let i = 0; i < W; i++) {
        tmp[j * W + i] = acc / win;
        acc += a[j * W + clamp(i + r + 1, 0, W - 1)] - a[j * W + clamp(i - r, 0, W - 1)];
      }
    }
    for (let i = 0; i < W; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, H - 1) * W + i];
      for (let j = 0; j < H; j++) {
        a[j * W + i] = acc / win;
        acc += tmp[clamp(j + r + 1, 0, H - 1) * W + i] - tmp[clamp(j - r, 0, H - 1) * W + i];
      }
    }
  }
}
