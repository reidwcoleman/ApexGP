import { Track, type DistanceField } from '../Track.ts';
import { clamp, fbm2, lerp, perlin2, ridged2, smoothstep } from './noise.ts';

/**
 * The shape of the land around the circuit.
 *
 * Everything is anchored to features of the track (corner apexes, segments, its
 * bounding box) so the world follows if the circuit layout is re-tuned:
 *   natural(x,z)  rolling plateau that follows the circuit's heights (a heavily
 *                 blurred copy of the centreline elevation), hills rising to the
 *                 north / north-west / north-east, a mound inside the loop.
 *   coast         coastline polyline built from anchors (sea to the south & south-
 *                 west): limestone cliffs around the lighthouse cape at Faro, a beach
 *                 below the Bajada, quays around the harbour at the hairpin, the town
 *                 beach west of the Paseo, big cliffs under the west hills.
 *   track         within barrier + 2 m the ground sits 0.3 m under the extended road
 *                 plane (the trackside meshes cover it), then blends to the natural
 *                 terrain over ~42 m.
 *   pads          flat platforms for buildings / grandstands, in world or track coords.
 *
 * Heights are cached in three nested grids after `bake()`:
 *   far  256 m  (30 km square: mountains + far coast)
 *   mid   16 m  (the 6 km terrain square)
 *   fine   4 m  (the circuit and its surroundings)
 * `height(x, z)` samples those grids exactly like the rendered triangles.
 */

export const SEA_LEVEL = 0;
export const FINE_CELL = 4;
export const MID_CELL = 16;
export const FAR_CELL = 256;

export interface Bounds { x0: number; x1: number; z0: number; z1: number }
export interface CoastVertex { x: number; z: number; cliff: number; quay: number }
export interface V2 { x: number; z: number }

export interface WorldPad {
  /** world-space oriented rectangle */
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

export interface Exclusion { cx: number; cz: number; halfW: number; halfL: number; angle: number }

export interface CoastInfo { dc: number; cliff: number; quay: number }

export interface Anchors {
  /** track bounding box */
  bb: Bounds;
  center: V2;
  /** corner apexes */
  t1: V2;
  mirador: V2;
  hairpin: V2;
  lonja: V2;
  pinos: V2;
  curva: V2;
  busStop: V2;
  /** Paseo straight midpoint */
  paseo: V2;
  /** loop interior (for the olive mound) */
  interior: V2;
}

const floorTo = (v: number, k: number) => Math.floor(v / k) * k;
const ceilTo = (v: number, k: number) => Math.ceil(v / k) * k;

export class WorldMap {
  readonly track: Track;
  readonly dfFar: DistanceField;
  readonly dfNear: DistanceField;
  readonly A: Anchors;
  readonly SQUARE: Bounds;
  readonly FINE: Bounds;
  readonly FAR: Bounds;
  readonly coast: CoastVertex[];
  readonly moles: V2[][];
  private readonly seaPoly: [number, number][];
  private pitBox!: Bounds;
  private readonly proj = { s: 0, lat: 0 };
  private readonly platform: Float32Array;
  readonly worldPads: WorldPad[] = [];
  readonly trackPads: TrackPad[] = [];
  readonly exclusions: Exclusion[] = [];

  // natural-height grid (32 m, bicubic) covering the square + margin
  private natGrid!: Float32Array;
  private natW = 0;
  private natH = 0;
  private static readonly NAT_CELL = 32;
  private natX0 = 0;
  private natZ0 = 0;
  // coarse coast-distance grid (64 m)
  private coastGrid!: Float32Array;
  private coastW = 0;
  private coastH = 0;
  private coastX0 = 0;
  private coastZ0 = 0;
  private static readonly COAST_CELL = 64;

  // baked grids
  far!: Float32Array; farW = 0; farH = 0;
  mid!: Float32Array; midW = 0; midH = 0;
  fine!: Float32Array; fineW = 0; fineH = 0;
  /** per fine vertex: 0..1 how much the track flattening owns it (1 = flat zone) */
  fineTrack!: Float32Array;
  /** per fine vertex: paved flag 0..1 */
  finePaved!: Float32Array;
  fineSand!: Float32Array;
  midSand!: Float32Array;

  constructor(track: Track) {
    this.track = track;
    this.A = computeAnchors(track);
    const { bb, center } = this.A;
    const cx = Math.round(center.x / 512) * 512;
    const cz = Math.round(center.z / 512) * 512;
    this.SQUARE = { x0: cx - 3072, x1: cx + 3072, z0: cz - 3072, z1: cz + 3072 };
    this.FAR = { x0: this.SQUARE.x0 - 12288, x1: this.SQUARE.x1 + 12288, z0: this.SQUARE.z0 - 12288, z1: this.SQUARE.z1 + 12288 };
    this.FINE = {
      x0: floorTo(bb.x0 - 360, 16),
      x1: ceilTo(bb.x1 + 330, 16),
      z0: floorTo(bb.z0 - 330, 16),
      z1: ceilTo(bb.z1 + 340, 16),
    };
    const { coast, moles } = buildCoast(this.A);
    this.coast = coast;
    this.moles = moles;
    this.seaPoly = [
      ...coast.map((c) => [c.x, c.z] as [number, number]),
      [coast[coast.length - 1].x, 60000],
      [coast[0].x, 60000],
    ];
    // coarse field: hill mask + platform heights; near field: flattening hints
    this.dfFar = track.buildDistanceField(40, 640, 480);
    this.dfNear = track.buildDistanceField(12, 170, 124);
    // world box of the pit/paddock platform (needs flattening further out)
    {
      const p = track.pit;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const s of [p.sStart - 50, p.sEnd + 50])
        for (const l of [0, p.side * 215]) {
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
    for (let i = 0; i < n; i++) {
      const d = f.dist[i];
      if (isFinite(d)) {
        const ww = Math.exp(-((d / 260) ** 2));
        w[i] = ww;
        hw[i] = f.height[i] * ww;
      }
    }
    blur2(hw, f.w, f.h, 3, 3);
    blur2(w, f.w, f.h, 3, 3);
    this.platform = new Float32Array(n);
    for (let i = 0; i < n; i++) this.platform[i] = (hw[i] + 20 * 0.03) / (w[i] + 0.03);
  }

  /**
   * Allocation-free nearest-centreline projection around a hint index
   * (same maths as Track.project, which is too allocation-heavy for 300k calls).
   */
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

  // ------------------------------------------------------------ primitives

  distToTrack(x: number, z: number): number {
    const d = Track.sampleField(this.dfFar, this.dfFar.dist, x, z);
    return isFinite(d) ? d : 1e5;
  }

  platformAt(x: number, z: number): number {
    const f = this.dfFar;
    const gx = (x - f.originX) / f.cell;
    const gz = (z - f.originZ) / f.cell;
    if (gx < 0 || gz < 0 || gx >= f.w - 1 || gz >= f.h - 1) return 20;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const i = z0 * f.w + x0;
    const p = this.platform;
    return (p[i] * (1 - fx) + p[i + 1] * fx) * (1 - fz) + (p[i + f.w] * (1 - fx) + p[i + f.w + 1] * fx) * fz;
  }

  /** exact signed coast distance (+ inland) and interpolated coast type */
  coastExact(x: number, z: number): CoastInfo {
    const C = this.coast;
    let best = Infinity, cliff = 0, quay = 0;
    for (let i = 0; i < C.length - 1; i++) {
      const a = C[i], b = C[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z;
      const L2 = vx * vx + vz * vz;
      let t = ((x - a.x) * vx + (z - a.z) * vz) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a.x + vx * t - x, qz = a.z + vz * t - z;
      const d2 = qx * qx + qz * qz;
      if (d2 < best) {
        best = d2;
        cliff = a.cliff + (b.cliff - a.cliff) * t;
        quay = a.quay + (b.quay - a.quay) * t;
      }
    }
    const d = Math.sqrt(best);
    return { dc: pointInPoly(x, z, this.seaPoly) ? -d : d, cliff, quay };
  }

  private coastApprox(x: number, z: number): number {
    const gx = (x - this.coastX0) / WorldMap.COAST_CELL;
    const gz = (z - this.coastZ0) / WorldMap.COAST_CELL;
    const W = this.coastW, H = this.coastH;
    if (gx < 0 || gz < 0 || gx >= W - 1 || gz >= H - 1) return 1e4;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const i = z0 * W + x0;
    const g = this.coastGrid;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fz) + (g[i + W] * (1 - fx) + g[i + W + 1] * fx) * fz;
  }

  /** natural land height (before coast, track and pads) — exact evaluation */
  naturalExact(x: number, z: number): number {
    const { bb, hairpin: HP, interior, center } = this.A;
    const P = this.platformAt(x, z);
    const dT = this.distToTrack(x, z);
    const far = smoothstep(55, 420, dT);
    const north = smoothstep(bb.z0 + 20, bb.z0 - 1550, z);
    const west = smoothstep(bb.x0 + 140, bb.x0 - 1460, x) * smoothstep(HP.z - 350, HP.z - 1150, z);
    const northWest = smoothstep(bb.x0 + 340, bb.x0 - 560, x) * smoothstep(bb.z0 + 650, bb.z0 - 250, z);
    const east = smoothstep(bb.x1 + 250, bb.x1 + 2400, x) * smoothstep(bb.z0 + 1350, bb.z0 - 250, z);
    const r = ridged2(x / 1500 + 7.1, z / 1500 - 3.3, 5);
    const f = fbm2(x / 650 + 3.7, z / 650 - 1.2, 4);
    const amp = 18 + 300 * north + 170 * west + 90 * northWest + 110 * east;
    let h = P + far * (amp * (0.62 * r + 0.3 * (f * 0.5 + 0.5)) - 9);
    // gentle undulation everywhere (the flat bits must not look planar)
    h += (0.35 + 0.65 * far) * 4.5 * fbm2(x / 260 - 5.2, z / 260 + 2.4, 3);
    // mound inside the loop (olive-grove hill)
    const mx = x - interior.x, mz = z - interior.z;
    h += 22 * Math.exp(-(mx * mx + mz * mz) / (2 * 190 * 190)) * smoothstep(40, 200, dT);
    // castle hill to the north-east of the circuit
    const cx = x - (center.x + 940), cz = z - (bb.z0 - 470);
    h += 70 * Math.exp(-(cx * cx + cz * cz) / (2 * 230 * 230));
    // distant sierra beyond the terrain square (W → N → E arc), broad massifs
    const R = Math.hypot(x - center.x, z - center.z + 150);
    const ring = smoothstep(6500, 11000, R) * smoothstep(center.z + 750, center.z - 3050, z - 0.12 * Math.abs(x - center.x));
    if (ring > 0) {
      const m = ridged2(x / 7000 + 1.3, z / 7000 + 8.2, 3, 2.2, 0.45);
      const b = fbm2(x / 9000 - 2.1, z / 9000 + 0.7, 2) * 0.5 + 0.5;
      h += ring * (250 + 1050 * m * m * (0.55 + 0.6 * b));
    }
    return h;
  }

  /** natural height from the cached bicubic grid + a detail octave */
  natural(x: number, z: number): number {
    return this.natBicubic(x, z) + 1.1 * perlin2(x / 34 + 0.37, z / 34 + 0.71);
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

  /** apply the coast profile to a natural height */
  coastProfile(N: number, x: number, z: number, info: CoastInfo): number {
    const { cliff, quay } = info;
    // wiggle the waterline: coves and headlands
    const wig = (14 * cliff + 5 * (1 - cliff)) * (1 - quay) * fbm2(x / 150 + 1.7, z / 150 - 4.1, 3);
    const dc = info.dc + wig;
    // beach
    let hb: number;
    if (dc >= 0) hb = lerp(0.35 + dc * 0.05, N, smoothstep(22, 170, dc));
    else hb = 0.35 + dc * 0.042 + Math.min(0, dc + 60) * 0.09;
    // cliff
    const width = 10 + Math.max(0, N) * 0.55;
    let hc: number;
    if (dc >= 0) {
      const t = clamp(dc / width, 0, 1);
      hc = Math.max(N, 1.5) * smoothstep(0.02, 0.8, t) + (1 - t) * 1.2 * (0.5 + 0.5 * perlin2(x / 9, z / 9));
    } else hc = -1.5 * Math.min(1, -dc / 3) + dc * 0.32;
    // quay
    let hq: number;
    if (dc >= 0) hq = lerp(2.2, N, smoothstep(35, 150, dc));
    else hq = lerp(2.2, -5.5, clamp(-dc / 3, 0, 1)) + Math.min(0, dc + 30) * 0.04;
    const h = lerp(lerp(hb, hc, cliff), hq, quay);
    return Math.max(h, -60);
  }

  /**
   * Exact final height + masks. `trackOut` receives [trackWeight, paved, s, lateral, sand].
   */
  evaluate(x: number, z: number, trackOut?: Float32Array): number {
    let N = this.natural(x, z);
    let beach = 0, cliffK = 0, dcOut = 1e4;
    // coast (only close to the coastline)
    const approx = this.coastApprox(x, z);
    if (approx > -700 && approx < 320) {
      const info = this.coastExact(x, z);
      N = this.coastProfile(N, x, z, info);
      beach = (1 - info.cliff) * (1 - info.quay);
      cliffK = info.cliff;
      dcOut = info.dc;
    } else if (approx <= -700) {
      N = -45;
      dcOut = -1e4;
    }
    let paved = 0;
    // world pads
    for (const p of this.worldPads) {
      const dx = x - p.cx, dz = z - p.cz;
      const R = p.halfW + p.halfL + p.blend;
      if (dx * dx + dz * dz > R * R) continue;
      const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      const u = Math.abs(dx * ca - dz * sa) - p.halfW;
      const v = Math.abs(dx * sa + dz * ca) - p.halfL;
      const o = Math.hypot(Math.max(u, 0), Math.max(v, 0));
      if (o < p.blend) {
        const t = smoothstep(0, p.blend, o);
        N = lerp(p.h, N, t);
        if (p.paved && o <= 0) paved = 1;
      }
    }
    // track
    let tw = 0;
    let sOut = -1, latOut = 0;
    const dNear = Track.sampleField(this.dfNear, this.dfNear.dist, x, z);
    const pb = this.pitBox;
    const inPit = x > pb.x0 && x < pb.x1 && z > pb.z0 && z < pb.z1;
    let hint = -1;
    if (isFinite(dNear) && (dNear < 112 || (inPit && dNear < 124))) {
      const f = this.dfNear;
      const gx = Math.round((x - f.originX) / f.cell);
      const gz = Math.round((z - f.originZ) / f.cell);
      hint = f.nearest[clamp(gz, 0, f.h - 1) * f.w + clamp(gx, 0, f.w - 1)];
    } else if (inPit) {
      // deep in the paddock: nearest is the pit straight
      const pr0 = this.track.project(x, z, Math.round((this.track.pit.sStart + this.track.pit.sEnd) / 2), 480);
      hint = pr0.index;
    }
    if (hint >= 0) {
      const pr = this.projectFast(x, z, hint, 14);
      const tr = this.track;
      const s = pr.s, lat = pr.lat;
      sOut = s; latOut = lat;
      const side = lat < 0 ? -1 : 1;
      const bar = tr.barrierAt(s, side);
      const al = Math.abs(lat);
      // road plane height at (s, lat)
      const i = Math.floor(s) % tr.n;
      const j = (i + 1) % tr.n;
      const a = s - Math.floor(s);
      const py = tr.py[i] * (1 - a) + tr.py[j] * a;
      const ry = tr.ry[i] * (1 - a) + tr.ry[j] * a;
      const plane = py + ry * lat;
      let flatUntil = bar + 2;
      let offset = -0.3;
      let blend = 42;
      // pit + paddock platform
      const pit = tr.pit;
      if (side === pit.side && s > pit.sStart - 45 && s < pit.sEnd + 45) {
        const ramp = Math.min(smoothstep(pit.sStart - 45, pit.sStart - 5, s), 1 - smoothstep(pit.sEnd + 5, pit.sEnd + 45, s));
        flatUntil = lerp(flatUntil, 150, ramp);
        if (al > pit.garageOffset + 1 && ramp > 0.5) { offset = -0.02; paved = Math.max(paved, 1); }
        blend = 60;
      }
      for (const p of this.trackPads) {
        const ds = tr.delta(p.sA, s);
        const len = tr.delta(p.sA, p.sB);
        if (ds < -p.blend || ds > len + p.blend) continue;
        const lo = Math.min(p.latA, p.latB), hi = Math.max(p.latA, p.latB);
        const os = Math.max(0, -ds, ds - len);
        const ol = Math.max(0, lo - lat, lat - hi);
        const o = Math.hypot(os, ol);
        if (o < p.blend) {
          const t = smoothstep(0, p.blend, o);
          const target = plane + p.offset;
          N = lerp(target, N, t);
          if (p.paved && o <= 0) paved = 1;
        }
      }
      tw = 1 - smoothstep(flatUntil, flatUntil + blend, al);
      N = lerp(N, plane + offset, tw);
    }
    if (trackOut) {
      trackOut[0] = tw;
      trackOut[1] = paved;
      trackOut[2] = sOut;
      trackOut[3] = latOut;
      // sand: beaches + shingle at cliff feet
      let sand = 0;
      if (dcOut < 110 && N < 6) {
        sand = beach * (1 - smoothstep(30, 95, dcOut)) * (1 - smoothstep(2.5, 5.5, N));
        sand = Math.max(sand, cliffK * (1 - smoothstep(0.6, 2.2, N)) * 0.7);
      }
      trackOut[4] = sand * (1 - tw);
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
    // 1) natural grid (32 m) over the square + 2 cells
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
    // 2) coarse coast grid over the square (+256 m)
    {
      const C = WorldMap.COAST_CELL;
      this.coastX0 = SQUARE.x0 - 256;
      this.coastZ0 = SQUARE.z0 - 256;
      this.coastW = Math.round((SQUARE.x1 - SQUARE.x0 + 512) / C) + 1;
      this.coastH = Math.round((SQUARE.z1 - SQUARE.z0 + 512) / C) + 1;
      this.coastGrid = new Float32Array(this.coastW * this.coastH);
      for (let j = 0; j < this.coastH; j++)
        for (let i = 0; i < this.coastW; i++) {
          const x = this.coastX0 + i * C, z = this.coastZ0 + j * C;
          this.coastGrid[j * this.coastW + i] = this.coastExact(x, z).dc;
        }
    }
    lap('coast');
    // 3) far grid (exact natural outside the square)
    {
      const C = FAR_CELL;
      const W = (this.farW = Math.round((FAR.x1 - FAR.x0) / C) + 1);
      const H = (this.farH = Math.round((FAR.z1 - FAR.z0) / C) + 1);
      this.far = new Float32Array(W * H);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const x = FAR.x0 + i * C, z = FAR.z0 + j * C;
          const inside = x >= SQUARE.x0 && x <= SQUARE.x1 && z >= SQUARE.z0 && z <= SQUARE.z1;
          let h = inside ? this.natural(x, z) : this.naturalExact(x, z);
          const ci = this.coastExact(x, z);
          if (Math.abs(ci.dc) < 1500) h = this.coastProfile(h, x, z, ci);
          else if (ci.dc < 0) h = -60;
          this.far[j * W + i] = h;
        }
    }
    lap('far');
    // 4) mid grid (16 m) over the square; boundary stitched to the far grid
    {
      const C = MID_CELL;
      const W = (this.midW = Math.round((SQUARE.x1 - SQUARE.x0) / C) + 1);
      const H = (this.midH = Math.round((SQUARE.z1 - SQUARE.z0) / C) + 1);
      this.mid = new Float32Array(W * H);
      this.midSand = new Float32Array(W * H);
      const out = new Float32Array(5);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const x = SQUARE.x0 + i * C, z = SQUARE.z0 + j * C;
          let h: number;
          if (i === 0 || j === 0 || i === W - 1 || j === H - 1) h = this.sampleFar(x, z);
          else if (x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1) {
            h = 0; // filled from the fine grid below
          } else {
            h = this.evaluate(x, z, out);
            this.midSand[j * W + i] = out[4];
            // fade toward the far grid close to the square's edge
            const e = Math.min(x - SQUARE.x0, SQUARE.x1 - x, z - SQUARE.z0, SQUARE.z1 - z);
            if (e < 400) h = lerp(this.sampleFar(x, z), h, smoothstep(0, 400, e));
          }
          this.mid[j * W + i] = h;
        }
    }
    lap('mid');
    // 5) fine grid (4 m); boundary stitched to the mid grid
    {
      const C = FINE_CELL;
      const W = (this.fineW = Math.round((FINE.x1 - FINE.x0) / C) + 1);
      const H = (this.fineH = Math.round((FINE.z1 - FINE.z0) / C) + 1);
      this.fine = new Float32Array(W * H);
      this.fineTrack = new Float32Array(W * H);
      this.finePaved = new Float32Array(W * H);
      this.fineSand = new Float32Array(W * H);
      const out = new Float32Array(5);
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
          this.finePaved[k] = out[1];
          this.fineSand[k] = out[4];
        }
      // relax creases in the blend band (between sections at different heights)
      const tmp = new Float32Array(this.fine);
      for (let it = 0; it < 3; it++) {
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
    // mid grid inside the fine region = downsampled fine grid (keeps queries consistent)
    for (let j = 0; j < this.midH; j++)
      for (let i = 0; i < this.midW; i++) {
        const x = SQUARE.x0 + i * MID_CELL, z = SQUARE.z0 + j * MID_CELL;
        if (!(x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1)) continue;
        const fi = Math.round((x - FINE.x0) / FINE_CELL), fj = Math.round((z - FINE.z0) / FINE_CELL);
        this.mid[j * this.midW + i] = this.fine[fj * this.fineW + fi];
        this.midSand[j * this.midW + i] = this.fineSand[fj * this.fineW + fi];
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

  /** surface normal y component (1 = flat) from the grids */
  slope(x: number, z: number, e = 3): number {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return (2 * e) / Math.hypot(hx, 2 * e, hz);
  }

  isSea(x: number, z: number): boolean {
    return this.height(x, z) < 0.4;
  }

  excluded(x: number, z: number, margin = 0): boolean {
    for (const e of this.exclusions) {
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

  /**
   * Clearance from the track: distance beyond the barrier on the nearest side
   * (negative = inside the barriers). Large when far away.
   */
  trackClearance(x: number, z: number): number {
    const d = this.distToTrack(x, z);
    const pb = this.pitBox;
    if (x > pb.x0 && x < pb.x1 && z > pb.z0 && z < pb.z1) {
      // pit side of the straight: keep the paddock platform clear
      if (d < 150) return d - 150;
    }
    if (d > 110) return d - 45;
    const f = this.dfNear;
    const gx = Math.round((x - f.originX) / f.cell);
    const gz = Math.round((z - f.originZ) / f.cell);
    if (gx < 0 || gz < 0 || gx >= f.w || gz >= f.h) return d - 45;
    const hint = f.nearest[gz * f.w + gx];
    if (hint < 0) return d - 45;
    const pr = this.projectFast(x, z, hint, 14);
    const side = pr.lat < 0 ? -1 : 1;
    let bar = this.track.barrierAt(pr.s, side);
    const pit = this.track.pit;
    if (side === pit.side && pr.s > pit.sStart - 45 && pr.s < pit.sEnd + 45) bar = Math.max(bar, 150);
    return Math.abs(pr.lat) - bar;
  }

  private maskW = 0;
  private maskH = 0;
  private forestGrid: Float32Array | null = null;
  private townGrid: Float32Array | null = null;
  private static readonly MASK_CELL = 24;

  /** cache forest/town masks on a 24 m grid (bilinear lookups afterwards) */
  bakeMasks() {
    const S = this.SQUARE;
    const C = WorldMap.MASK_CELL;
    const W = (this.maskW = Math.round((S.x1 - S.x0) / C) + 1);
    const H = (this.maskH = Math.round((S.z1 - S.z0) / C) + 1);
    const fg = new Float32Array(W * H);
    const tg = new Float32Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = S.x0 + i * C, z = S.z0 + j * C;
        tg[j * W + i] = this.townExact(x, z);
        fg[j * W + i] = this.forestExact(x, z, tg[j * W + i]);
      }
    this.forestGrid = fg;
    this.townGrid = tg;
  }

  forest(x: number, z: number): number {
    if (!this.forestGrid) return this.forestExact(x, z, this.townExact(x, z));
    return bilinear(this.forestGrid, this.maskW, this.maskH, this.SQUARE.x0, this.SQUARE.z0, WorldMap.MASK_CELL, x, z);
  }

  town(x: number, z: number): number {
    if (!this.townGrid) return this.townExact(x, z);
    return bilinear(this.townGrid, this.maskW, this.maskH, this.SQUARE.x0, this.SQUARE.z0, WorldMap.MASK_CELL, x, z);
  }

  /** forest density 0..1 (pines), shared by vegetation and the ground shader */
  private forestExact(x: number, z: number, town: number): number {
    const { bb, hairpin: HP, interior } = this.A;
    const n = fbm2(x / 520 + 11.3, z / 520 - 7.7, 4) * 0.5 + 0.5;
    const hills = smoothstep(bb.z0 + 100, bb.z0 - 1050, z) * 0.22 + smoothstep(bb.x0 + 190, bb.x0 - 460, x) * smoothstep(HP.z - 400, HP.z - 900, z) * 0.42;
    const east = smoothstep(bb.x1 + 300, bb.x1 + 1400, x) * 0.08;
    const ix = x - interior.x, iz = z - interior.z;
    const inner = Math.exp(-((ix * ix + iz * iz) / (2 * 260 * 260))) * 0.25;
    // patchy stands of pine with open garrigue between them
    const patchy = fbm2(x / 170 - 2.3, z / 170 + 6.1, 2) * 0.12;
    let f = smoothstep(0.58, 0.76, n + hills + east + inner + patchy);
    f *= 1 - town;
    return f;
  }

  /** town density 0..1 (white houses) */
  private townExact(x: number, z: number): number {
    const { bb, center, hairpin: HP, paseo } = this.A;
    // hillside town north of the circuit
    const ax = (x - (center.x + 440)) / 820, az = (z - (bb.z0 - 550)) / 360;
    const a = Math.exp(-(ax * ax + az * az) * 1.6);
    // harbour district between the Paseo and the town beach
    const hx = (paseo.x + HP.x) / 2 - 60;
    const bx = (x - hx) / 170, bz = (z - (HP.z - 290)) / 230;
    const b = Math.exp(-(bx * bx + bz * bz) * 1.4);
    // village on the east hills
    const cx = (x - (bb.x1 + 1250)) / 260, cz = (z - (bb.z0 + 50)) / 220;
    const c = Math.exp(-(cx * cx + cz * cz) * 1.8);
    const edge = fbm2(x / 180 - 3.1, z / 180 + 9.4, 3) * 0.28;
    return smoothstep(0.3, 0.6, Math.max(a, b, c * 0.9) + edge);
  }
}

// ---------------------------------------------------------------- anchors + coast

function computeAnchors(track: Track): Anchors {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < track.n; i++) {
    x0 = Math.min(x0, track.px[i]); x1 = Math.max(x1, track.px[i]);
    z0 = Math.min(z0, track.pz[i]); z1 = Math.max(z1, track.pz[i]);
  }
  const bb = { x0, x1, z0, z1 };
  const apex = (name: string, fallback: number): V2 => {
    const c = track.corners.find((k) => k.name === name) ?? track.corners[Math.min(fallback, track.corners.length - 1)];
    const i = Math.round(c.sApex) % track.n;
    return { x: track.px[i], z: track.pz[i] };
  };
  // the hairpin: the named one, else the tightest corner
  let hp = track.corners.find((c) => c.name.startsWith('Horquilla'));
  if (!hp) hp = [...track.corners].sort((a, b) => a.radius - b.radius)[0];
  const hi = Math.round(hp.sApex) % track.n;
  const segs = track.data.def.segments;
  const paseoIdx = segs.findIndex((s) => s.name === 'Paseo');
  let paseo: V2;
  if (paseoIdx >= 0) {
    const s = track.data.segStart[paseoIdx] + track.data.segLen[paseoIdx] / 2;
    const i = Math.round(s) % track.n;
    paseo = { x: track.px[i], z: track.pz[i] };
  } else paseo = { x: bb.x0 + 300, z: (bb.z0 + bb.z1) / 2 };
  const center = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  return {
    bb,
    center,
    t1: apex('Faro', 0),
    mirador: apex('Mirador', 2),
    hairpin: { x: track.px[hi], z: track.pz[hi] },
    lonja: apex('Lonja', 4),
    pinos: apex('Pinos II', 6),
    curva: apex('Curva Grande', 9),
    busStop: apex('Bus Stop', 10),
    paseo,
    interior: { x: (paseo.x + bb.x1) / 2 + 30, z: center.z + 20 },
  };
}

/** coastline east → west (sea on the far side), relative to the anchors */
function buildCoast(A: Anchors): { coast: CoastVertex[]; moles: V2[][] } {
  const T = A.t1, M = A.mirador, H = A.hairpin, bb = A.bb;
  const v = (x: number, z: number, cliff: number, quay = 0): CoastVertex => ({ x, z, cliff, quay });
  const coast: CoastVertex[] = [
    v(bb.x1 + 14000, T.z + 1600, 0.9),
    v(bb.x1 + 4000, T.z + 760, 0.9),
    v(bb.x1 + 2000, T.z + 510, 0.8),
    v(bb.x1 + 1000, T.z + 395, 1),
    v(T.x + 461, T.z + 304, 1),
    v(T.x + 241, T.z + 229, 1),
    v(T.x + 146, T.z + 154, 1),
    v(T.x + 51, T.z + 196, 1),
    v(T.x - 109, T.z + 259, 1),
    v(M.x + 95, M.z + 108, 0.75),
    v(M.x - 55, M.z + 125, 0.2),
    v(M.x - 225, M.z + 100, 0),
    v(M.x - 405, M.z + 55, 0),
    v(H.x + 91, H.z + 190, 0, 0.4),
    v(H.x - 9, H.z + 148, 0, 1),
    v(H.x - 64, H.z + 102, 0, 1),
    v(H.x - 89, H.z + 12, 0, 1),
    v(H.x - 104, H.z - 88, 0, 1),
    v(H.x - 131, H.z - 193, 0, 0.5),
    v(H.x - 171, H.z - 358, 0),
    v(H.x - 209, H.z - 523, 0.1),
    v(H.x - 339, H.z - 663, 0.6),
    v(H.x - 659, H.z - 783, 1),
    v(H.x - 1259, H.z - 853, 1),
    v(H.x - 2459, H.z - 898, 0.9),
    v(H.x - 14959, H.z - 1448, 0.9),
  ];
  const r = (dx: number, dz: number): V2 => ({ x: H.x + dx, z: H.z + dz });
  const moles = [
    [r(89, 188), r(41, 270), r(-44, 324), r(-149, 344), r(-244, 324)],
    [r(-131, -192), r(-204, -143), r(-277, -63), r(-311, 37), r(-315, 142)],
  ];
  return { coast, moles };
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

function pointInPoly(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function blur2(a: Float32Array, W: number, H: number, r: number, passes: number) {
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
