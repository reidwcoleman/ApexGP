/**
 * The monocoque + nose + sidepods + engine cover as ONE lofted surface.
 *
 * Each station is a half cross-section (x ≥ 0) given by 13 control points walking from the
 * top centre (P0) round the outside to the bottom centre (P12):
 *
 *   P0  top centre (in the cockpit: seat floor)       P7  sidepod max width
 *   P1  crown / cockpit floor corner                  P8  sidepod lower lip (undercut starts)
 *   P2  crown / cockpit inner wall top                P9  undercut (deepest inboard)
 *   P3  shoulder / cockpit rim                        P10 floor junction
 *   P4  body side (engine-cover flank)                P11 bottom outer corner
 *   P5  sidepod top inner                             P12 bottom centre
 *   P6  sidepod top shoulder
 *
 * Every control point is interpolated along z with a monotone cubic, and each slice is a smooth
 * Hermite curve through its points, so the loft is feature-aligned and free of overshoot.
 *
 * UV unwrap (paint atlas): u = z (linear), v = signed arc length from the top centre line —
 * left side (+X) above the centre row, right side (−X) below. Livery.ts paints against the
 * exact same functions, so patterns computed from 3D positions line up with the mesh.
 */
import { type V2, type V3, pchip, hermiteSeg, lerp2 } from './carMath.ts';
import { HULL_ROWS, HULL_Z0, HULL_Z1, PAINT_H, PAINT_W } from './carLayout.ts';

interface SecDef {
  z: number;
  top?: number;
  sh: V2;
  side: V2;
  cock?: { seat: number; wi: number };
  pod?: { top: V2; max: V2; low: V2; cut: V2; inner?: V2 };
  floor: V2;
  bot: V2;
  bottom: number;
}

const K = 13;
const TENSION = [1, 1, 0.75, 0.5, 0.85, 0.8, 0.65, 1, 0.8, 1, 0.55, 0.8, 1];

function sec(d: SecDef): { z: number; p: V2[]; cock: number; pod: number } {
  const p: V2[] = [];
  if (d.cock) {
    p[0] = [0, d.cock.seat];
    p[1] = [d.cock.wi * 0.78, d.cock.seat + 0.015];
    p[2] = [d.cock.wi, d.sh[1] - 0.035];
  } else {
    const top = d.top!;
    const crown = top - d.sh[1];
    p[0] = [0, top];
    p[1] = [d.sh[0] * 0.42, top - crown * 0.14];
    p[2] = [d.sh[0] * 0.78, top - crown * 0.5];
  }
  p[3] = d.sh;
  p[4] = d.side;
  if (d.pod) {
    p[5] = d.pod.inner ?? [d.side[0] + 0.035, d.pod.top[1] + 0.012];
    p[6] = d.pod.top;
    p[7] = d.pod.max;
    p[8] = d.pod.low;
    p[9] = d.pod.cut;
  } else {
    for (let k = 5; k <= 9; k++) p[k] = lerp2(d.side, d.floor, (k - 4) / 6);
  }
  p[10] = d.floor;
  p[11] = d.bot;
  p[12] = [0, d.bottom];
  return { z: d.z, p, cock: d.cock ? 1 : 0, pod: d.pod ? 1 : 0 };
}

// Stations, front → rear. Front axle z = +1.7, rear axle z = −1.7.
const STATIONS = [
  sec({ z: 3.0, top: 0.196, sh: [0.03, 0.19], side: [0.042, 0.168], floor: [0.038, 0.142], bot: [0.026, 0.134], bottom: 0.132 }),
  sec({ z: 2.975, top: 0.212, sh: [0.064, 0.203], side: [0.08, 0.178], floor: [0.076, 0.138], bot: [0.056, 0.126], bottom: 0.123 }),
  sec({ z: 2.8, top: 0.255, sh: [0.086, 0.243], side: [0.1, 0.205], floor: [0.096, 0.136], bot: [0.072, 0.12], bottom: 0.117 }),
  sec({ z: 2.5, top: 0.335, sh: [0.11, 0.318], side: [0.125, 0.265], floor: [0.12, 0.155], bot: [0.088, 0.134], bottom: 0.13 }),
  sec({ z: 2.15, top: 0.43, sh: [0.136, 0.408], side: [0.155, 0.34], floor: [0.148, 0.19], bot: [0.108, 0.165], bottom: 0.16 }),
  sec({ z: 1.8, top: 0.52, sh: [0.165, 0.495], side: [0.19, 0.415], floor: [0.178, 0.22], bot: [0.13, 0.195], bottom: 0.19 }),
  sec({ z: 1.45, top: 0.592, sh: [0.2, 0.568], side: [0.228, 0.475], floor: [0.215, 0.21], bot: [0.158, 0.18], bottom: 0.175 }),
  sec({ z: 1.12, top: 0.637, sh: [0.235, 0.615], side: [0.268, 0.515], floor: [0.255, 0.13], bot: [0.195, 0.1], bottom: 0.095 }),
  sec({ z: 0.9, top: 0.658, sh: [0.265, 0.638], side: [0.3, 0.54], floor: [0.29, 0.07], bot: [0.23, 0.055], bottom: 0.052 }),
  sec({ z: 0.77, top: 0.665, sh: [0.285, 0.648], side: [0.322, 0.553], floor: [0.312, 0.063], bot: [0.248, 0.052], bottom: 0.05 }),
  // cockpit
  sec({ z: 0.68, cock: { seat: 0.58, wi: 0.19 }, sh: [0.305, 0.66], side: [0.338, 0.565], floor: [0.328, 0.061], bot: [0.256, 0.05], bottom: 0.05 }),
  sec({ z: 0.6, cock: { seat: 0.43, wi: 0.225 }, sh: [0.322, 0.67], side: [0.352, 0.575], floor: [0.345, 0.06], bot: [0.262, 0.05], bottom: 0.05 }),
  sec({ z: 0.44, cock: { seat: 0.4, wi: 0.24 }, sh: [0.336, 0.675], side: [0.365, 0.59], floor: [0.36, 0.06], bot: [0.27, 0.05], bottom: 0.05 }),
  // sidepod inlet: upper + lower lip at z 0.37, recessed mouth (P7 pulled in) behind, full pod by 0.3
  sec({ z: 0.41, cock: { seat: 0.4, wi: 0.241 }, sh: [0.337, 0.676], side: [0.366, 0.598], floor: [0.365, 0.06], bot: [0.275, 0.05], bottom: 0.05 }),
  sec({
    z: 0.37, cock: { seat: 0.4, wi: 0.242 }, sh: [0.338, 0.677], side: [0.366, 0.608],
    pod: { inner: [0.392, 0.624], top: [0.575, 0.614], max: [0.61, 0.56], low: [0.585, 0.455], cut: [0.43, 0.27] },
    floor: [0.39, 0.06], bot: [0.285, 0.05], bottom: 0.05,
  }),
  sec({
    z: 0.345, cock: { seat: 0.4, wi: 0.243 }, sh: [0.339, 0.678], side: [0.367, 0.62],
    pod: { inner: [0.396, 0.62], top: [0.59, 0.61], max: [0.47, 0.525], low: [0.6, 0.44], cut: [0.435, 0.245] },
    floor: [0.405, 0.06], bot: [0.292, 0.05], bottom: 0.05,
  }),
  sec({
    z: 0.3, cock: { seat: 0.4, wi: 0.244 }, sh: [0.34, 0.68], side: [0.368, 0.638],
    pod: { inner: [0.4, 0.615], top: [0.603, 0.605], max: [0.658, 0.515], low: [0.618, 0.425], cut: [0.44, 0.22] },
    floor: [0.42, 0.06], bot: [0.3, 0.05], bottom: 0.05,
  }),
  sec({
    z: 0.1, cock: { seat: 0.41, wi: 0.24 }, sh: [0.34, 0.7], side: [0.37, 0.655],
    pod: { inner: [0.4, 0.585], top: [0.62, 0.595], max: [0.672, 0.5], low: [0.635, 0.4], cut: [0.45, 0.19] },
    floor: [0.43, 0.06], bot: [0.31, 0.05], bottom: 0.05,
  }),
  sec({
    z: -0.05, cock: { seat: 0.46, wi: 0.2 }, sh: [0.32, 0.72], side: [0.36, 0.66],
    pod: { inner: [0.39, 0.57], top: [0.62, 0.58], max: [0.67, 0.485], low: [0.63, 0.385], cut: [0.45, 0.185] },
    floor: [0.43, 0.06], bot: [0.31, 0.05], bottom: 0.05,
  }),
  // roll hoop / airbox front face
  sec({
    z: -0.13, top: 0.935, sh: [0.13, 0.82], side: [0.3, 0.68],
    pod: { inner: [0.37, 0.555], top: [0.615, 0.565], max: [0.665, 0.47], low: [0.625, 0.375], cut: [0.45, 0.18] },
    floor: [0.43, 0.06], bot: [0.31, 0.05], bottom: 0.05,
  }),
  sec({
    z: -0.32, top: 0.95, sh: [0.118, 0.845], side: [0.25, 0.64],
    pod: { inner: [0.33, 0.52], top: [0.6, 0.535], max: [0.648, 0.445], low: [0.61, 0.355], cut: [0.445, 0.17] },
    floor: [0.43, 0.06], bot: [0.31, 0.05], bottom: 0.05,
  }),
  sec({
    z: -0.6, top: 0.875, sh: [0.1, 0.8], side: [0.215, 0.58],
    pod: { inner: [0.29, 0.465], top: [0.56, 0.475], max: [0.6, 0.395], low: [0.565, 0.31], cut: [0.43, 0.15] },
    floor: [0.42, 0.06], bot: [0.3, 0.05], bottom: 0.05,
  }),
  sec({
    z: -0.9, top: 0.785, sh: [0.086, 0.73], side: [0.18, 0.52],
    pod: { inner: [0.24, 0.41], top: [0.46, 0.39], max: [0.49, 0.33], low: [0.465, 0.26], cut: [0.385, 0.125] },
    floor: [0.38, 0.06], bot: [0.27, 0.05], bottom: 0.05,
  }),
  sec({
    z: -1.18, top: 0.69, sh: [0.076, 0.645], side: [0.16, 0.47],
    pod: { inner: [0.21, 0.36], top: [0.36, 0.315], max: [0.378, 0.27], low: [0.36, 0.21], cut: [0.315, 0.105] },
    floor: [0.31, 0.06], bot: [0.23, 0.05], bottom: 0.05,
  }),
  sec({
    z: -1.42, top: 0.61, sh: [0.07, 0.572], side: [0.15, 0.43],
    pod: { inner: [0.18, 0.33], top: [0.265, 0.285], max: [0.275, 0.24], low: [0.265, 0.185], cut: [0.24, 0.1] },
    floor: [0.24, 0.06], bot: [0.18, 0.055], bottom: 0.055,
  }),
  sec({ z: -1.66, top: 0.54, sh: [0.066, 0.508], side: [0.145, 0.43], floor: [0.19, 0.1], bot: [0.13, 0.08], bottom: 0.08 }),
  sec({ z: -1.95, top: 0.465, sh: [0.06, 0.44], side: [0.122, 0.385], floor: [0.13, 0.18], bot: [0.09, 0.17], bottom: 0.168 }),
  sec({ z: -2.2, top: 0.405, sh: [0.054, 0.385], side: [0.084, 0.345], floor: [0.078, 0.262], bot: [0.056, 0.252], bottom: 0.25 }),
  sec({ z: -2.37, top: 0.37, sh: [0.046, 0.354], side: [0.064, 0.326], floor: [0.058, 0.282], bot: [0.042, 0.276], bottom: 0.274 }),
];

export const HULL_FRONT = STATIONS[0].z;
export const HULL_REAR = STATIONS[STATIONS.length - 1].z;

// interpolants, z ascending
const zsAsc = STATIONS.map((s) => s.z).reverse();
const fx: ((z: number) => number)[] = [];
const fy: ((z: number) => number)[] = [];
for (let k = 0; k < K; k++) {
  fx.push(pchip(zsAsc, STATIONS.map((s) => s.p[k][0]).reverse()));
  fy.push(pchip(zsAsc, STATIONS.map((s) => s.p[k][1]).reverse()));
}
const fCock = pchip(zsAsc, STATIONS.map((s) => s.cock).reverse());
const fPod = pchip(zsAsc, STATIONS.map((s) => s.pod).reverse());

export function cockpitWeight(z: number) {
  return fCock(z);
}
export function podWeight(z: number) {
  return fPod(z);
}

export function sectionAt(z: number): V2[] {
  const p: V2[] = [];
  for (let k = 0; k < K; k++) p.push([Math.max(0, fx[k](z)), fy[k](z)]);
  p[0][0] = 0;
  p[12][0] = 0;
  return p;
}

const SUB = 20;
/** Dense half profile: arrays of x, y, cumulative arc length s, and curve parameter (k + t). */
export interface Profile {
  x: Float64Array;
  y: Float64Array;
  s: Float64Array;
  kt: Float64Array;
  total: number;
}
export function profileAt(z: number): Profile {
  const P = sectionAt(z);
  const before: V2 = [-P[1][0], P[1][1]];
  const after: V2 = [-P[11][0], P[11][1]];
  const n = (K - 1) * SUB + 1;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const s = new Float64Array(n);
  const kt = new Float64Array(n);
  let i = 0;
  for (let k = 0; k < K - 1; k++) {
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      const q = hermiteSeg(P, k, t, TENSION, before, after);
      x[i] = Math.max(0, q[0]);
      y[i] = q[1];
      kt[i] = k + t;
      i++;
    }
  }
  x[i] = 0;
  y[i] = P[12][1];
  kt[i] = K - 1;
  s[0] = 0;
  for (let j = 1; j < n; j++) s[j] = s[j - 1] + Math.hypot(x[j] - x[j - 1], y[j] - y[j - 1]);
  return { x, y, s, kt, total: s[n - 1] };
}

/** point at curve parameter kt on a profile (linear in the dense table) */
export function profileAtParam(pr: Profile, kt: number): { x: number; y: number; s: number } {
  const f = Math.min(pr.kt.length - 1.0001, Math.max(0, kt * SUB));
  const i = Math.floor(f);
  const t = f - i;
  return { x: pr.x[i] + (pr.x[i + 1] - pr.x[i]) * t, y: pr.y[i] + (pr.y[i + 1] - pr.y[i]) * t, s: pr.s[i] + (pr.s[i + 1] - pr.s[i]) * t };
}

/** point at arc length s (clamped); returns x, y, param, and 2D outward normal */
export function profileAtS(pr: Profile, s: number): { x: number; y: number; kt: number; nx: number; ny: number } {
  const n = pr.s.length;
  if (s <= 0) s = 0;
  if (s >= pr.total) s = pr.total - 1e-6;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pr.s[m] > s) hi = m;
    else lo = m;
  }
  const ds = pr.s[hi] - pr.s[lo] || 1e-9;
  const t = (s - pr.s[lo]) / ds;
  const dx = pr.x[hi] - pr.x[lo];
  const dy = pr.y[hi] - pr.y[lo];
  const l = Math.hypot(dx, dy) || 1;
  // walking P0 → P12 down the +X side; outward normal = direction rotated +90°
  return { x: pr.x[lo] + dx * t, y: pr.y[lo] + dy * t, kt: pr.kt[lo] + (pr.kt[hi] - pr.kt[lo]) * t, nx: -dy / l, ny: dx / l };
}

// ------------------------------------------------------------------ unwrap
/** max half perimeter over the hull, sets the vertical texel scale */
export const S_MAX = (() => {
  let m = 0;
  for (let z = HULL_REAR; z <= HULL_FRONT; z += 0.02) m = Math.max(m, profileAt(z).total);
  return m * 1.015;
})();
export const HULL_ROW0 = HULL_ROWS / 2;
export const HULL_RHO = HULL_ROW0 / S_MAX; // atlas rows per metre of arc
export const HULL_PX_PER_M = PAINT_W / (HULL_Z1 - HULL_Z0);

export function hullAtlasX(z: number) {
  return ((z - HULL_Z0) / (HULL_Z1 - HULL_Z0)) * PAINT_W;
}
/** canvas row for signed arc length (s > 0 = left/+X side) */
export function hullAtlasRow(sSigned: number) {
  return HULL_ROW0 - sSigned * HULL_RHO;
}
export function hullUV(z: number, sSigned: number): V2 {
  return [hullAtlasX(z) / PAINT_W, 1 - hullAtlasRow(sSigned) / PAINT_H];
}

/** 3D point + normal on the hull at z and signed arc length (s>0 → +X side). */
export function hullPoint(z: number, sSigned: number, pr?: Profile): { p: V3; n: V3; kt: number } {
  const prof = pr ?? profileAt(z);
  const q = profileAtS(prof, Math.abs(sSigned));
  const sg = sSigned >= 0 ? 1 : -1;
  // z-slope correction of the normal: finite difference along z
  const dz = 0.01;
  const pa = profileAtS(profileAt(z + dz), Math.abs(sSigned));
  const pb = profileAtS(profileAt(z - dz), Math.abs(sSigned));
  const tz: V3 = [sg * (pa.x - pb.x), pa.y - pb.y, 2 * dz];
  const ts: V3 = [-sg * q.ny, q.nx, 0]; // tangent along the profile, rotate normal... (approx)
  // normal = profile normal adjusted to be perpendicular to tz
  let n: V3 = [sg * q.nx, q.ny, 0];
  const tl = Math.hypot(tz[0], tz[1], tz[2]);
  const d = (n[0] * tz[0] + n[1] * tz[1]) / (tl * tl);
  n = [n[0] - tz[0] * d, n[1] - tz[1] * d, -tz[2] * d];
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  void ts;
  return { p: [sg * q.x, q.y, z], n: [n[0] / nl, n[1] / nl, n[2] / nl], kt: q.kt };
}

/** arc length of a curve-parameter feature line at z (e.g. 7.4 = 40% of the way from P7 to P8) */
export function sAtParam(z: number, kt: number) {
  return profileAtParam(profileAt(z), kt).s;
}

// ------------------------------------------------------------------ mesh sampling
export const HULL_SEGS: number[][] = [
  [3, 5, 4, 5, 3, 8, 7, 6, 8, 5, 3, 3],
  [2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 2, 2],
  [1, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1, 1],
];
export const HULL_STEP = [0.026, 0.065, 0.17];

export function hullSlices(level: number): number[] {
  const zs: number[] = [];
  const step = HULL_STEP[level];
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i].z;
    const b = STATIONS[i + 1].z;
    // where the section changes fast (sidepod inlet, roll-hoop face) slice much finer so the
    // livery unwrap doesn't shear across long triangles
    let rate = 0;
    for (let k = 0; k < K; k++) {
      const d = Math.hypot(STATIONS[i].p[k][0] - STATIONS[i + 1].p[k][0], STATIONS[i].p[k][1] - STATIONS[i + 1].p[k][1]);
      rate = Math.max(rate, d / (a - b));
    }
    const st = rate > 1 ? step / Math.min(level === 0 ? 7 : 4, rate) : step;
    const n = Math.max(1, Math.ceil((a - b) / st));
    for (let j = 0; j < n; j++) zs.push(a + (b - a) * (j / n));
  }
  zs.push(STATIONS[STATIONS.length - 1].z);
  return zs;
}

/** half-profile samples at z for a detail level: returns points and their arc lengths */
export function halfRing(z: number, level: number): { pts: V2[]; s: number[]; kt: number[] } {
  const P = sectionAt(z);
  const before: V2 = [-P[1][0], P[1][1]];
  const after: V2 = [-P[11][0], P[11][1]];
  const pr = profileAt(z);
  const segs = HULL_SEGS[level];
  const pts: V2[] = [];
  const s: number[] = [];
  const kt: number[] = [];
  for (let k = 0; k < K - 1; k++) {
    for (let j = 0; j < segs[k]; j++) {
      const t = j / segs[k];
      const q = hermiteSeg(P, k, t, TENSION, before, after);
      pts.push([Math.max(0, q[0]), q[1]]);
      s.push(profileAtParam(pr, k + t).s);
      kt.push(k + t);
    }
  }
  pts.push([0, P[12][1]]);
  s.push(pr.total);
  kt.push(K - 1);
  pts[0][0] = 0;
  return { pts, s, kt };
}
