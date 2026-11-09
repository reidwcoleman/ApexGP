// Bluebird: the mountain. One height grid (2 m) that the renderer, the skiers, the vehicles and the
// snow state all read; the trail map (runs, lifts, nodes) is data here too. Pure math, no three.js.
//
// Axes: x east, z toward the base village (downhill is +z), y up. The playable square is 1600 m.

export const SIZE = 1600;
export const HALF = SIZE / 2;
export const GN = 801; // height grid points per side
export const GS = SIZE / (GN - 1); // 2 m
export const SN = 512; // snow-state grid per side
export const SC = SIZE / SN; // 3.125 m

export type Diff = 'green' | 'blue' | 'black' | 'double' | 'park';
export type NodeId = 'base' | 'bunny' | 'mid' | 'summit' | 'ridge';

export interface LiftDef {
  id: string;
  name: string;
  kind: 'carpet' | 'chair' | 'gondola';
  from: NodeId;
  to: NodeId;
  a: [number, number];
  b: [number, number];
  cost: number;
}

export interface RunDef {
  id: string;
  name: string;
  diff: Diff;
  from: NodeId;
  to: NodeId;
  pts: [number, number][];
  w: number;
  cost: number;
  lit?: boolean; // gets lamps once night lighting is bought
  glade?: boolean; // keeps a few trees in it
  needs: string; // lift that must exist
}

export const LIFTS: LiftDef[] = [
  { id: 'carpet', name: 'Sprout Carpet', kind: 'carpet', from: 'base', to: 'bunny', a: [-150, 462], b: [-150, 372], cost: 0 },
  { id: 'meadow', name: 'Meadow Chair', kind: 'chair', from: 'base', to: 'mid', a: [40, 442], b: [168, 46], cost: 18000 },
  { id: 'summit', name: 'Summit Express', kind: 'chair', from: 'mid', to: 'summit', a: [112, 76], b: [14, -462], cost: 85000 },
  { id: 'ridge', name: 'Ridge Triple', kind: 'chair', from: 'base', to: 'ridge', a: [-236, 428], b: [-418, -292], cost: 160000 },
  { id: 'gondola', name: 'Peak Gondola', kind: 'gondola', from: 'base', to: 'summit', a: [214, 474], b: [58, -470], cost: 520000 },
];

export const RUNS: RunDef[] = [
  { id: 'bunny', name: 'Sprout Slope', diff: 'green', from: 'bunny', to: 'base', needs: 'carpet', w: 46, cost: 0, lit: true,
    pts: [[-124, 372], [-118, 410], [-122, 446], [-132, 484]] },
  { id: 'meadowlark', name: 'Meadowlark', diff: 'green', from: 'mid', to: 'base', needs: 'meadow', w: 34, cost: 6000, lit: true,
    pts: [[188, 40], [262, 92], [300, 172], [262, 252], [300, 330], [250, 412], [150, 482]] },
  { id: 'fox', name: 'Fox Run', diff: 'blue', from: 'mid', to: 'base', needs: 'meadow', w: 32, cost: 9000, lit: true,
    pts: [[160, 52], [178, 140], [196, 228], [158, 318], [112, 404], [96, 476]] },
  { id: 'park', name: 'Kicker Alley', diff: 'park', from: 'mid', to: 'base', needs: 'meadow', w: 36, cost: 22000, lit: true,
    pts: [[104, 74], [44, 160], [12, 258], [-6, 350], [-18, 444], [-24, 484]] },
  { id: 'bowl', name: 'Bluebird Bowl', diff: 'blue', from: 'summit', to: 'mid', needs: 'summit', w: 64, cost: 20000,
    pts: [[2, -452], [-62, -356], [-44, -228], [24, -110], [92, 30], [108, 66]] },
  { id: 'widow', name: 'Widowmaker', diff: 'black', from: 'summit', to: 'mid', needs: 'summit', w: 28, cost: 26000,
    pts: [[34, -458], [112, -360], [150, -240], [170, -118], [150, 20], [124, 70]] },
  { id: 'longhaul', name: 'Long Haul', diff: 'blue', from: 'summit', to: 'base', needs: 'summit', w: 32, cost: 48000,
    pts: [[64, -466], [204, -424], [330, -304], [384, -150], [404, 0], [384, 160], [346, 322], [262, 448], [230, 486]] },
  { id: 'chutes', name: 'Eagle Chutes', diff: 'double', from: 'ridge', to: 'base', needs: 'ridge', w: 26, cost: 40000,
    pts: [[-430, -286], [-440, -180], [-410, -60], [-366, 80], [-306, 250], [-266, 446]] },
  { id: 'glade', name: 'Lynx Glade', diff: 'black', from: 'ridge', to: 'base', needs: 'ridge', w: 44, cost: 34000, glade: true,
    pts: [[-404, -296], [-322, -200], [-264, -62], [-230, 100], [-212, 262], [-204, 446]] },
];

export const RUN_BY: Record<string, RunDef> = Object.fromEntries(RUNS.map((r) => [r.id, r]));
export const LIFT_BY: Record<string, LiftDef> = Object.fromEntries(LIFTS.map((l) => [l.id, l]));

export const DIFF_COLOR: Record<Diff, string> = { green: '#2fb65a', blue: '#2f7fe0', black: '#1d1d22', double: '#1d1d22', park: '#f08a24' };
export const DIFF_NAME: Record<Diff, string> = { green: 'Easy', blue: 'Intermediate', black: 'Expert', double: 'Double black', park: 'Terrain park' };

// The base village: buildings sit on this flat shelf.
export const BASE = { x0: -300, x1: 320, z0: 430, z1: 600 };

export const BUILD_SPOTS = {
  lodge: [30, 532] as [number, number],
  rental: [-60, 520] as [number, number],
  school: [-196, 498] as [number, number],
  patrol: [120, 512] as [number, number],
  shed: [282, 548] as [number, number],
  hotel: [-120, 570] as [number, number],
  parking: [150, 572] as [number, number],
  tickets: [-14, 488] as [number, number],
};

// --------------------------------------------------------------------------- noise
function hash2(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (vnoise(x * f, y * f) * 2 - 1); f *= 2.03; a *= 0.5; }
  return s;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smax = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

export const SUMMIT_H = 430;

/** the mountain before trails are cut */
export function rawHeight(x: number, z: number): number {
  const t = (452 - z) / 930;
  let main: number;
  if (t <= 0) main = t * 40;
  else if (t <= 1) main = SUMMIT_H * (0.42 * t + 0.58 * Math.pow(t, 2.35));
  else main = SUMMIT_H - (t - 1) * 930 * 0.55;
  const width = 330 + 300 * (1 - Math.min(1, Math.max(0, t)));
  const lat = x / width;
  main *= Math.exp(-lat * lat * 0.55);
  const g = (cx: number, cz: number, sx: number, sz: number, h: number) => h * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2) * 0.5);
  const ridge = g(-440, -330, 170, 300, 372) + g(-300, -470, 200, 160, 160);
  const shoulder = g(390, -150, 150, 260, 230) + g(470, 120, 160, 260, 70);
  let h = smax(main, ridge, 60);
  h = smax(h, shoulder, 50);
  // the valley walls beyond the resort
  const ax = Math.abs(x);
  h += 260 * smooth(520, 820, ax) * (0.6 + 0.4 * smooth(600, -200, z));
  h += 220 * smooth(-480, -800, z);
  // rough it up: big lumps up high, gentle below
  const rough = 0.35 + 0.65 * smooth(0, 300, h);
  h += fbm(x / 210, z / 210, 5) * 34 * rough + fbm(x / 55 + 7, z / 55 - 3, 3) * 6 * rough;
  // the base shelf
  const inBase = smooth(BASE.z0 - 70, BASE.z0 + 10, z) * smooth(BASE.x0 - 90, BASE.x0 + 10, x) * smooth(BASE.x1 + 90, BASE.x1 - 10, x);
  const shelf = 1.5 + fbm(x / 90, z / 90, 2) * 1.2 + (z - 500) * -0.012;
  h = h + (shelf - h) * inBase;
  return h;
}

// --------------------------------------------------------------------------- run splines
export interface RunPath {
  def: RunDef;
  x: Float32Array;
  z: Float32Array;
  s: Float32Array; // distance from the top
  tx: Float32Array; // unit tangent (downhill)
  tz: Float32Array;
  h: Float32Array; // carved centreline height
  len: number;
}

function catmull(p: [number, number][], step: number) {
  const out: [number, number][] = [];
  const P = [p[0], ...p, p[p.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(p[p.length - 1]);
  // resample to an even step
  const res: [number, number][] = [out[0]];
  let carry = 0;
  for (let i = 1; i < out.length; i++) {
    const [ax, az] = out[i - 1], [bx, bz] = out[i];
    const L = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= L) { const t = d / L; res.push([ax + (bx - ax) * t, az + (bz - az) * t]); d += step; }
    carry = L - (d - step);
  }
  const last = out[out.length - 1];
  if (Math.hypot(res[res.length - 1][0] - last[0], res[res.length - 1][1] - last[1]) > step * 0.3) res.push(last);
  return res;
}

// --------------------------------------------------------------------------- the built mountain
export interface Kicker { x: number; z: number; tx: number; tz: number; size: number }

export class Mountain {
  H = new Float32Array(GN * GN);
  runs: RunPath[] = [];
  runOf: Record<string, RunPath> = {};
  /** snow-state cell -> run index + 1 (0 = off piste) */
  runCell = new Uint8Array(SN * SN);
  /** nearest run (index + 1) for every cell within 30 m of one, 0 elsewhere */
  nearRun = new Uint8Array(SN * SN);
  /** cells per run, for averages */
  cellsOf: Uint32Array[] = [];
  kickers: Kicker[] = [];
  /** distance-to-nearest-run grid (state resolution), metres beyond the edge (negative = on the run) */
  edge = new Float32Array(SN * SN);

  constructor() {
    const H = this.H;
    for (let j = 0; j < GN; j++)
      for (let i = 0; i < GN; i++) H[j * GN + i] = rawHeight(i * GS - HALF, j * GS - HALF);
    // trails, widest first so narrow ones cut cleanly
    for (const def of [...RUNS].sort((a, b) => b.w - a.w)) this.carve(def);
    this.runs = RUNS.map((d) => this.runOf[d.id]);
    for (const l of LIFTS) { this.pad(l.a[0], l.a[1], 16); this.pad(l.b[0], l.b[1], 15); }
    this.buildMask();
    this.buildKickers();
  }

  private carve(def: RunDef) {
    const P = catmull(def.pts, GS);
    const n = P.length;
    const x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n), tx = new Float32Array(n), tz = new Float32Array(n), h = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = P[i][0]; z[i] = P[i][1]; s[i] = i ? s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]) : 0; }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      const dx = x[b] - x[a], dz = z[b] - z[a], L = Math.hypot(dx, dz) || 1;
      tx[i] = dx / L; tz[i] = dz / L;
    }
    // centreline: average of the cross section, always going down, then smoothed
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let k = -2; k <= 2; k++) { const o = (k / 2) * def.w * 0.45; sum += this.at(x[i] - tz[i] * o, z[i] + tx[i] * o); c++; }
      h[i] = sum / c;
    }
    const minDrop = def.diff === 'green' ? 0.06 : 0.09;
    for (let i = 1; i < n; i++) h[i] = Math.min(h[i], h[i - 1] - minDrop * (s[i] - s[i - 1]));
    const sm = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        let sum = 0, c = 0;
        for (let k = -6; k <= 6; k++) { const q = Math.min(n - 1, Math.max(0, i + k)); sum += h[q]; c++; }
        sm[i] = sum / c;
      }
      h.set(sm);
    }
    // ends blend back into whatever they meet
    const endH = this.at(x[n - 1], z[n - 1]);
    for (let i = Math.max(0, n - 20); i < n; i++) { const t = (i - (n - 20)) / 19; h[i] = h[i] + (endH - h[i]) * t * t; }
    const path: RunPath = { def, x, z, s, tx, tz, h, len: s[n - 1] };
    this.runOf[def.id] = path;

    // stamp: nearest centreline point per grid point within reach
    const half = def.w / 2, reach = half + 26;
    const best = new Map<number, number>(); // grid index -> packed (dist, i)
    const bestD = new Map<number, number>();
    for (let i = 0; i < n; i += 1) {
      const gi0 = Math.floor((x[i] - reach + HALF) / GS), gi1 = Math.ceil((x[i] + reach + HALF) / GS);
      const gj0 = Math.floor((z[i] - reach + HALF) / GS), gj1 = Math.ceil((z[i] + reach + HALF) / GS);
      for (let gj = Math.max(0, gj0); gj <= Math.min(GN - 1, gj1); gj++)
        for (let gi = Math.max(0, gi0); gi <= Math.min(GN - 1, gi1); gi++) {
          const px = gi * GS - HALF, pz = gj * GS - HALF;
          const d = Math.hypot(px - x[i], pz - z[i]);
          if (d > reach) continue;
          const k = gj * GN + gi;
          const o = bestD.get(k);
          if (o === undefined || d < o) { bestD.set(k, d); best.set(k, i); }
        }
    }
    const H = this.H;
    for (const [k, i] of best) {
      const d = bestD.get(k)!;
      const gi = k % GN, gj = (k / GN) | 0;
      const px = gi * GS - HALF, pz = gj * GS - HALF;
      const lat = (px - x[i]) * -tz[i] + (pz - z[i]) * tx[i];
      const raw = H[k];
      const cross = (raw - h[i]) * 0.12 + lat * 0.015;
      const target = h[i] + Math.max(-2.5, Math.min(2.5, cross));
      const wgt = 1 - smooth(half - 2, reach, d);
      // only cut down or fill gently: big fills look like dams
      H[k] = raw + (target - raw) * wgt * (target > raw ? 0.85 : 1);
    }
  }

  private pad(cx: number, cz: number, r: number) {
    const h0 = this.at(cx, cz);
    const R = r + 14;
    for (let gj = Math.floor((cz - R + HALF) / GS); gj <= Math.ceil((cz + R + HALF) / GS); gj++)
      for (let gi = Math.floor((cx - R + HALF) / GS); gi <= Math.ceil((cx + R + HALF) / GS); gi++) {
        if (gi < 0 || gj < 0 || gi >= GN || gj >= GN) continue;
        const d = Math.hypot(gi * GS - HALF - cx, gj * GS - HALF - cz);
        const w = 1 - smooth(r, R, d);
        const k = gj * GN + gi;
        this.H[k] += (h0 - this.H[k]) * w;
      }
  }

  private buildMask() {
    this.edge.fill(1e3);
    const counts = RUNS.map(() => 0);
    this.runs.forEach((p, ri) => {
      const half = p.def.w / 2;
      const reach = half + 30;
      for (let i = 0; i < p.x.length; i += 2) {
        const ci0 = Math.floor((p.x[i] - reach + HALF) / SC), ci1 = Math.ceil((p.x[i] + reach + HALF) / SC);
        const cj0 = Math.floor((p.z[i] - reach + HALF) / SC), cj1 = Math.ceil((p.z[i] + reach + HALF) / SC);
        for (let cj = Math.max(0, cj0); cj <= Math.min(SN - 1, cj1); cj++)
          for (let ci = Math.max(0, ci0); ci <= Math.min(SN - 1, ci1); ci++) {
            const px = (ci + 0.5) * SC - HALF, pz = (cj + 0.5) * SC - HALF;
            const d = Math.hypot(px - p.x[i], pz - p.z[i]) - half;
            const k = cj * SN + ci;
            if (d < this.edge[k]) { this.edge[k] = d; this.nearRun[k] = ri + 1; if (d <= 0) this.runCell[k] = ri + 1; }
          }
      }
    });
    for (let k = 0; k < SN * SN; k++) if (this.runCell[k]) counts[this.runCell[k] - 1]++;
    this.cellsOf = counts.map((c) => new Uint32Array(c));
    const fill = RUNS.map(() => 0);
    for (let k = 0; k < SN * SN; k++) { const r = this.runCell[k]; if (r) this.cellsOf[r - 1][fill[r - 1]++] = k; }
  }

  private buildKickers() {
    const p = this.runOf['park'];
    const at = [70, 150, 230, 318, 392];
    const sizes = [0.7, 1, 1.25, 1, 0.8];
    at.forEach((s, k) => {
      const i = this.idxAt(p, s);
      const lat = (k % 2 ? -1 : 1) * 4;
      this.kickers.push({ x: p.x[i] - p.tz[i] * lat, z: p.z[i] + p.tx[i] * lat, tx: p.tx[i], tz: p.tz[i], size: sizes[k] });
    });
  }

  idxAt(p: RunPath, s: number) {
    let lo = 0, hi = p.s.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (p.s[m] < s) lo = m + 1; else hi = m; }
    return lo;
  }

  /** bilinear grid height (no kickers) */
  at(x: number, z: number): number {
    const fx = Math.min(GN - 1.001, Math.max(0, (x + HALF) / GS));
    const fz = Math.min(GN - 1.001, Math.max(0, (z + HALF) / GS));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.H, k = j * GN + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + GN] * (1 - u) + H[k + GN + 1] * u) * v;
  }

  /** kicker shape at a point (metres above the ground) */
  kickAt(x: number, z: number): number {
    let best = 0;
    for (const k of this.kickers) {
      const dx = x - k.x, dz = z - k.z;
      if (dx * dx + dz * dz > 900) continue;
      const u = (dx * k.tx + dz * k.tz) / k.size, v = Math.abs(-dx * k.tz + dz * k.tx);
      const hk = kickerProfile(u) * k.size;
      const lw = 1 - smooth(5.5, 7.5, v);
      best = Math.max(best, hk * lw);
    }
    return best;
  }

  /** ground height the skiers and vehicles stand on */
  ground(x: number, z: number): number { return this.at(x, z) + (this.kickers.length ? this.kickAt(x, z) : 0); }

  normal(x: number, z: number, out: { x: number; y: number; z: number }, e = 1.2) {
    const hx = this.ground(x + e, z) - this.ground(x - e, z);
    const hz = this.ground(x, z + e) - this.ground(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const L = Math.hypot(nx, ny, nz);
    out.x = nx / L; out.y = ny / L; out.z = nz / L;
    return out;
  }

  cellAt(x: number, z: number) {
    const ci = Math.floor((x + HALF) / SC), cj = Math.floor((z + HALF) / SC);
    if (ci < 0 || cj < 0 || ci >= SN || cj >= SN) return -1;
    return cj * SN + ci;
  }

  /** nearest point on a run: index along it and signed lateral offset */
  nearestOn(p: RunPath, x: number, z: number) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < p.x.length; i += 4) { const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    for (let i = Math.max(0, bi - 4); i < Math.min(p.x.length, bi + 5); i++) { const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const lat = (x - p.x[bi]) * -p.tz[bi] + (z - p.z[bi]) * p.tx[bi];
    return { i: bi, lat, d: Math.sqrt(bd) };
  }
}

/** tabletop jump profile along its axis, metres (u = 0 at the lip) */
export function kickerProfile(u: number): number {
  const H = 2.3;
  if (u < -11 || u > 22) return 0;
  if (u < 0) { const t = (u + 11) / 11; return H * t * t; }
  if (u < 7) return H;
  const t = (u - 7) / 15;
  return H * (0.5 + 0.5 * Math.cos(t * Math.PI));
}

export const NODE_POS: Record<NodeId, [number, number]> = {
  base: [20, 470],
  bunny: [-150, 372],
  mid: [140, 62],
  summit: [30, -466],
  ridge: [-418, -292],
};
