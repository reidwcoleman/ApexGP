import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BODIES } from '../loadout.ts';

/**
 * The battle cars, built from code in the simulation's car frame (cm; x forward, y left, z up, the
 * ground 17 below the origin before each car is dropped to its own ride height).
 *
 * Each body is lofted through cross-sections with hard character lines: a flat floor, a chamfered
 * rocker, a beltline crease, a shoulder crease and a crowned top. Sections are interpolated along
 * the car (Catmull-Rom), the rocker and belt are pushed up into an arch over every wheel so the
 * haunches swell round the tyres, and normals are creased (smooth across a panel, sharp across a
 * line), which is what gives the genre's cars their crisp, toy-like gloss. A tinted greenhouse sits
 * on top with a painted roof that sweeps down into the rear pillars. Wheels are fat slicks on deep
 * dish rims with bevelled spokes, discs and accent calipers. Every car is sized to its RocketSim
 * hitbox class and stands on that class's wheels.
 */

type P3 = [number, number, number];
type P2 = [number, number];

/** a body section: half widths and heights of its lines (z up from the car origin) */
interface BSec {
  x: number;
  /** floor */
  zb: number;
  wb: number;
  /** beltline (the widest crease) */
  wm: number;
  zm: number;
  /** shoulder crease */
  ws: number;
  zs: number;
  /** the top's flat edge and its crown */
  wt: number;
  zt: number;
  crown: number;
}
/** a greenhouse section: the base on the body, the roof edge, the crown */
interface CSec {
  x: number;
  wb: number;
  zb: number;
  wt: number;
  zt: number;
  crown: number;
}
type Wing = 'blade' | 'duck' | 'wide' | 'tall' | 'fin' | 'none';
interface Spec {
  body: BSec[];
  cabin: CSec[];
  /** the cabin's roof paint starts covering the sides (the rear pillars) aft of this x */
  pillar: number;
  /** front and rear wheels: x, drawn radius, centre y, tyre width */
  wf: [number, number, number, number];
  wr: [number, number, number, number];
  /** the floor's half width between the wheels (the wells start outside it) */
  inner: number;
  wing: Wing;
  /** the wing: chord x range, height, half span */
  wx: [number, number];
  wz: number;
  ws: number;
  /** head and tail light positions (front corner / rear corner) */
  head: P3;
  tail: P3;
  /** the boost nozzles (one each side of the centre at ±y) and the antenna's root */
  jet: P3;
  antenna: P3;
  /** nose and tail caps bulge this far */
  bulge: [number, number];
  extras?: 'truck' | 'pods';
}

// (the floor comes down 10 below the figure given, to a low rocker: the hitbox floats above the
// visual's sills, as in the genre)
const S = (x: number, zb: number, wb: number, wm: number, zm: number, ws: number, zs: number, wt: number, zt: number, crown = 1.2): BSec => ({ x, zb: Math.max(-13.5, zb - 10), wb, wm, zm: zm - 1.5, ws, zs, wt, zt, crown });
const C = (x: number, wb: number, zb: number, wt: number, zt: number, crown = 1): CSec => ({ x, wb, zb, wt, zt, crown });

// ------------------------------------------------------------------ the six cars
// (heights from the origin; the ground is at −17; hitboxes from RocketSim, the visual hugging them)
const SPECS: Spec[] = [
  // Striker: tall and chunky, a short blunt nose, a big bubble cab, swollen rear haunches, a deck spoiler
  {
    body: [
      S(77, 4, 20, 23, 7.5, 21, 10.5, 13, 11.5, 0.6),
      S(72, 1.5, 28, 33, 8.5, 32, 14.5, 21, 16, 1),
      S(62, 1, 30, 40.5, 9.5, 39.5, 19, 25, 20.5, 1.2),
      S(48, 1, 30, 41, 10, 39.5, 21, 26, 22.3, 1.3),
      S(34, 1, 31, 37.5, 10.5, 36.5, 23, 27.5, 24.2, 1.2),
      S(14, 1, 32, 37.5, 11, 36.5, 24.5, 28.5, 25.5, 1),
      S(-10, 1, 32, 38.5, 11.5, 37.5, 26, 29, 27, 1),
      S(-28, 1, 32, 43.5, 12.5, 42.5, 28.5, 30, 29.7, 1.2),
      S(-42, 1.5, 31, 43.5, 12.5, 42, 29, 30, 30.2, 1.2),
      S(-51, 3.5, 28, 39, 12.5, 37, 28, 27, 29, 1),
      S(-56, 7, 24, 31, 13, 29, 25.5, 22, 26.5, 0.6),
    ],
    cabin: [C(35, 25, 23.6, 14, 25.5, 0.5), C(26, 27, 24.6, 21, 33.5), C(16, 28, 25.2, 23.5, 39.5), C(2, 28.5, 25.6, 24.5, 43), C(-14, 28.5, 26.8, 24.5, 43.6), C(-27, 28.5, 28.4, 23.5, 41), C(-37, 28, 29.4, 21, 35.5), C(-44, 26, 29.9, 16, 31, 0.6)],
    pillar: -21,
    wf: [51.25, 14.5, 33.5, 12.5],
    wr: [-33.75, 17.5, 34.5, 15.5],
    inner: 23,
    wing: 'blade',
    wx: [-58, -47],
    wz: 37,
    ws: 31,
    head: [71, 21, 13.5],
    tail: [-55.5, 22, 22],
    jet: [-56, 12, 13],
    antenna: [-40, 18, 29.6],
    bulge: [2.5, 1.5],
  },
  // Mako: long and low, a long hood with a power bulge, a fastback cab set well back, a ducktail
  {
    body: [
      S(78, 3, 22, 26, 6, 25, 9.5, 16, 10.5, 0.6),
      S(72, 0.5, 29, 36, 7, 35.5, 12.5, 24, 13.6, 1.2),
      S(60, 0, 30, 41.5, 8, 41, 15.5, 27, 16.8, 2),
      S(44, 0, 30, 41.5, 8.5, 41, 16.5, 28, 18, 2.2),
      S(26, 0, 31, 38.5, 9, 38, 17.5, 29, 18.8, 1.8),
      S(6, 0, 32, 38.5, 9.5, 38, 18.5, 30, 19.5, 1),
      S(-16, 0, 32, 39, 10, 38.5, 19.5, 30.5, 20.5, 1),
      S(-32, 0, 32, 43, 10.5, 42.5, 21, 31, 22, 1),
      S(-46, 0.5, 31, 43, 10.5, 42.5, 21.5, 31, 22.6, 1),
      S(-55, 2.5, 29, 40, 10.5, 39, 22, 29, 23.4, 0.8),
      S(-59, 6, 25, 33, 11, 31, 21.5, 24, 22.6, 0.5),
    ],
    cabin: [C(16, 27, 18.6, 16, 20, 0.5), C(6, 29, 19.4, 22, 26), C(-6, 29.5, 20.2, 24, 30.8), C(-18, 29.5, 20.8, 24, 32), C(-30, 29, 21.6, 22.5, 30.5), C(-41, 28, 22.3, 19, 26.5), C(-50, 26, 22.8, 13, 23.6, 0.5)],
    pillar: -28,
    wf: [50.3, 14, 35, 12.5],
    wr: [-34.75, 15.5, 36, 15],
    inner: 25,
    wing: 'duck',
    wx: [-59, -48],
    wz: 24,
    ws: 28,
    head: [72, 23, 10.5],
    tail: [-58.5, 24, 18],
    jet: [-59, 12, 10],
    antenna: [-36, 20, 22.6],
    bulge: [2, 1.5],
  },
  // Stingray: a flat wide wedge, a small canopy, enormous rear tyres in deep haunches, a low wide wing
  {
    body: [
      S(79, 0, 22, 27, 2.5, 26, 4.5, 18, 5.2, 0.4),
      S(70, -1.5, 30, 38, 4, 37.5, 8, 26, 9, 0.8),
      S(56, -2, 31, 42.5, 5, 42, 11, 29, 12.3, 1.4),
      S(42, -2, 31, 42.5, 5.5, 42, 12.5, 30, 13.8, 1.4),
      S(22, -2, 32, 39.5, 6, 39, 13.5, 31, 15, 1.2),
      S(0, -2, 32, 39.5, 6.5, 39, 14.5, 31, 16, 1),
      S(-20, -2, 32, 44, 7, 43.5, 16, 32, 17.4, 1),
      S(-36, -2, 32, 45, 7.5, 44.5, 17, 32, 18.5, 1),
      S(-50, -1.5, 31, 44, 7.5, 43, 17.5, 31, 18.8, 0.8),
      S(-58, 1, 27, 38, 8, 36, 17, 26, 18, 0.5),
    ],
    cabin: [C(16, 20, 14.6, 10, 16, 0.4), C(6, 22, 15.6, 15, 22.5), C(-6, 22.5, 16.4, 17, 26.5), C(-18, 22.5, 17.2, 17, 27), C(-30, 21.5, 18, 14, 24), C(-40, 18, 18.6, 8, 20, 0.4)],
    pillar: -24,
    wf: [49.97, 14.5, 36, 12],
    wr: [-35.43, 19, 37, 18],
    inner: 25,
    wing: 'wide',
    wx: [-60, -48],
    wz: 27,
    ws: 37,
    head: [70, 25, 7.5],
    tail: [-57.5, 26, 14],
    jet: [-58, 12, 7],
    antenna: [-30, 24, 18],
    bulge: [3, 1],
  },
  // Viper: a long pointed nose, a forward canopy, narrow waisted flanks, a tall wing
  {
    body: [
      S(82, 0.5, 8, 10, 2.5, 9, 4, 5, 4.5, 0.3),
      S(76, -1, 18, 23, 4, 22, 7, 13, 7.8, 0.6),
      S(64, -2, 26, 38.5, 5.5, 38, 11, 22, 12, 1.2),
      S(50, -2, 28, 40, 6, 39.5, 13, 25, 14.2, 1.4),
      S(34, -2, 29, 35, 6.5, 34.5, 14.5, 26, 15.6, 1.2),
      S(12, -2, 30, 34.5, 7, 34, 15.5, 27, 16.6, 1),
      S(-12, -2, 30, 37, 7.5, 36.5, 17, 27.5, 18, 1),
      S(-30, -2, 30, 41, 8, 40.5, 18.5, 28, 19.5, 1),
      S(-44, -1.5, 29, 41, 8, 40, 19, 28, 20, 1),
      S(-52, 0.5, 27, 37, 8.5, 35, 19, 25, 20, 0.6),
      S(-56, 4, 23, 30, 9, 28, 18, 20, 18.8, 0.4),
    ],
    cabin: [C(34, 22, 15, 10, 16.4, 0.4), C(24, 24, 15.6, 17, 22.5), C(12, 25, 16.2, 19, 27.5), C(-2, 25, 17, 19, 29), C(-16, 24.5, 17.8, 17.5, 27.5), C(-28, 23, 18.6, 13, 23), C(-36, 20, 19.2, 7, 20.4, 0.3)],
    pillar: -14,
    wf: [51.5, 15.5, 33, 12.5],
    wr: [-35.75, 17, 34, 15],
    inner: 22,
    wing: 'tall',
    wx: [-58, -47],
    wz: 38,
    ws: 29,
    head: [72, 17, 8.5],
    tail: [-55.5, 22, 15.5],
    jet: [-56, 11, 9],
    antenna: [-36, 20, 19.6],
    bulge: [1.5, 1],
  },
  // Comet: a sleek coupe, a long fastback running to a short tail, a shark fin
  {
    body: [
      S(80, 3.5, 20, 24, 7, 22.5, 10, 14, 11, 0.6),
      S(74, 1, 28, 34, 8, 33.5, 13.5, 22, 15, 1),
      S(62, 0.5, 30, 40, 9, 39.5, 17, 26, 18.6, 1.6),
      S(48, 0.5, 30, 40.5, 9.5, 40, 18.5, 27, 20, 1.6),
      S(30, 0.5, 31, 37, 10, 36.5, 20, 28, 21.4, 1.4),
      S(8, 0.5, 31.5, 37, 10.5, 36.5, 21.5, 28.5, 22.6, 1),
      S(-16, 0.5, 31.5, 38.5, 11, 38, 23, 29, 24, 1),
      S(-32, 0.5, 31.5, 42.5, 12, 42, 25, 29.5, 26, 1),
      S(-45, 1, 30.5, 42, 12, 41, 25.5, 29, 26.5, 1),
      S(-52, 3, 28, 37, 12, 35, 25, 26, 25.8, 0.8),
      S(-55, 6, 24, 30, 12.5, 28, 23.5, 21, 24.2, 0.4),
    ],
    cabin: [C(32, 25, 21, 14, 22.8, 0.5), C(22, 27, 22, 21, 30.5), C(10, 28, 22.6, 23.5, 36.5), C(-4, 28.5, 23.4, 24, 39), C(-18, 28.5, 24.4, 23, 37.5), C(-30, 28, 25.4, 20, 33), C(-40, 27, 26, 16, 29), C(-47, 25, 26.4, 10, 27, 0.4)],
    pillar: -24,
    wf: [51.25, 14.5, 33, 12.5],
    wr: [-34, 17, 34, 15],
    inner: 23,
    wing: 'fin',
    wx: [-56, -24],
    wz: 26,
    ws: 26,
    head: [74, 21, 12.5],
    tail: [-54.5, 22, 20.5],
    jet: [-55, 12, 12],
    antenna: [-38, 20, 26.6],
    bulge: [2, 1.5],
  },
  // Bulldog: a tall armoured truck, slab sides, an upright cab, big tyres, a bull bar and a roof rack
  {
    body: [
      S(74, 3, 30, 34, 9, 33, 17, 28, 19, 0.5),
      S(70, 1, 33, 38.5, 10, 38, 22, 31, 24, 0.8),
      S(60, 0.5, 33, 39.5, 11, 39, 25, 32, 27, 1),
      S(44, 0.5, 33, 39.5, 11.5, 39, 27, 32.5, 28.6, 1),
      S(28, 0.5, 33, 37, 12, 36.5, 28.5, 33, 30, 0.8),
      S(4, 0.5, 33, 37, 12.5, 36.5, 29.5, 33, 31, 0.8),
      S(-20, 0.5, 33, 37.5, 13, 37, 30.5, 33, 32, 0.8),
      S(-34, 0.5, 33, 40, 13.5, 39.5, 31, 33.5, 32.5, 0.8),
      S(-46, 1, 32, 39.5, 13.5, 39, 31, 33, 32.4, 0.6),
      S(-52, 3, 31, 36, 14, 35, 30.5, 31, 31.6, 0.4),
    ],
    cabin: [C(28, 32, 30.6, 27, 33, 0.4), C(22, 33, 31.2, 29.5, 42), C(12, 33, 31.6, 30, 46), C(-6, 33, 32.4, 30, 47), C(-24, 33, 33, 30, 46.6), C(-36, 32.5, 33.2, 29, 44), C(-44, 31.5, 33.2, 26, 39, 0.4)],
    pillar: -30,
    wf: [51.25, 17, 32, 14],
    wr: [-33.75, 17, 32, 15],
    inner: 21,
    wing: 'none',
    wx: [-50, -44],
    wz: 33,
    ws: 30,
    head: [71, 27, 22],
    tail: [-51.5, 29, 26],
    jet: [-52, 12, 12],
    antenna: [-42, 26, 33.5],
    bulge: [1, 1],
    extras: 'truck',
  },
];

// RocketSim's ride height for each hitbox class (where the origin settles on flat ground)
const REST = [17.03, 17.07, 18.67, 18.36, 17.03, 18.81];

// ------------------------------------------------------------------ lofting
/** Catmull-Rom through a sequence of numbers at parameter t ∈ [0, n−1] */
function cr(v: number[], t: number): number {
  const n = v.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(t)));
  const f = t - i;
  const p0 = v[Math.max(0, i - 1)];
  const p1 = v[i];
  const p2 = v[i + 1];
  const p3 = v[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** interpolate a run of sections field by field, `steps` rings per span */
function sample<T extends { x: number }>(secs: T[], steps: number): T[] {
  const keys = Object.keys(secs[0]) as (keyof T)[];
  const cols = keys.map((k) => secs.map((s) => s[k] as unknown as number));
  const out: T[] = [];
  const n = secs.length;
  for (let k = 0; k <= (n - 1) * steps; k++) {
    const t = k / steps;
    const o = {} as Record<string, number>;
    keys.forEach((key, j) => (o[key as string] = cr(cols[j], t)));
    out.push(o as unknown as T);
  }
  return out;
}

/**
 * a closed loft through rings of half-profile points (each from the bottom centre round to the top
 * centre, y ≥ 0, mirrored), capped at both ends with a slight bulge; creased normals
 */
function loftRings(rings: { x: number; p: P2[] }[], bulge: [number, number] = [0, 0], open = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const full = rings.map((r) => {
    const right = r.p;
    const left = right
      .slice(1, -1)
      .reverse()
      .map(([y, z]) => [-y, z] as P2);
    return { x: r.x, p: [...right, ...left] };
  });
  const m = full[0].p.length;
  const tri = (a: P3, b: P3, c: P3) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < full.length - 1; i++) {
    const A = full[i];
    const B = full[i + 1];
    for (let j = 0; j < m; j++) {
      if (open && j === m - 1) continue;
      const j2 = (j + 1) % m;
      const a: P3 = [A.x, A.p[j][0], A.p[j][1]];
      const b: P3 = [A.x, A.p[j2][0], A.p[j2][1]];
      const c: P3 = [B.x, B.p[j][0], B.p[j][1]];
      const d: P3 = [B.x, B.p[j2][0], B.p[j2][1]];
      // (rings run front to back: wind so the outside faces out)
      tri(a, c, b);
      tri(b, c, d);
    }
  }
  if (!open)
    for (const [r, s, k] of [
      [full[0], 1, bulge[0]],
      [full[full.length - 1], -1, bulge[1]],
    ] as [{ x: number; p: P2[] }, number, number][]) {
      let cy = 0;
      let cz = 0;
      for (const [y, z] of r.p) {
        cy += y;
        cz += z;
      }
      const cen: P3 = [r.x + s * k, cy / m, cz / m];
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m;
        const a: P3 = [r.x, r.p[j][0], r.p[j][1]];
        const b: P3 = [r.x, r.p[j2][0], r.p[j2][1]];
        if (s > 0) tri(cen, a, b);
        else tri(cen, b, a);
      }
    }
  return creased(pos, 0.42);
}

/** a triangle soup wound outward (by its signed volume) with creased normals */
function creased(pos: number[], angle: number): THREE.BufferGeometry {
  let vol = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.slice(i, i + 9);
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0)
    for (let i = 0; i < pos.length; i += 9)
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return toCreasedNormals(g, angle);
}

interface Wheel {
  x: number;
  r: number;
  y: number;
  w: number;
}
/** the arch over a wheel at this x: the height the rocker and belt are lifted to (−∞ clear of it) */
function archZ(x: number, wheels: Wheel[]): number {
  let z = -1e9;
  for (const w of wheels) {
    const R = w.r + 2.6;
    const dx = x - w.x;
    if (Math.abs(dx) < R) z = Math.max(z, w.r - 17 + Math.sqrt(R * R - dx * dx));
  }
  return z;
}

function bodyRing(s: BSec, inner: number, wheels: Wheel[]): P2[] {
  const inn = Math.min(inner, s.wb - 0.6);
  const p: P2[] = [
    [0, s.zb],
    [inn, s.zb],
    [s.wb, s.zb],
    [Math.min(s.wm - 0.4, s.wb + 1.5), s.zb + 2],
    [s.wm, s.zm],
    [s.ws, s.zs],
    [s.wt + (s.ws - s.wt) * 0.3, s.zt - (s.zt - s.zs) * 0.25],
    [s.wt, s.zt],
    [s.wt * 0.55, s.zt + s.crown * 0.75],
    [0, s.zt + s.crown],
  ];
  // the wells: everything outboard of the floor is lifted into the arch
  const az = archZ(s.x, wheels);
  if (az > -1e8) for (let k = 2; k < p.length; k++) if (p[k][1] < az && p[k][0] > inn + 0.5) p[k] = [p[k][0], az + (k - 2) * 0.01];
  return p;
}

function cabinRing(s: CSec): P2[] {
  return [
    [0, s.zb - 2],
    [s.wb, s.zb],
    [s.wb - 0.8, s.zb + 2],
    [s.wt + 1.4, s.zt - 1.8],
    [s.wt, s.zt - 0.4],
    [s.wt * 0.5, s.zt + s.crown * 0.7],
    [0, s.zt + s.crown],
  ];
}

/** a hoop swept round a wheel (an arch's trim lip): centre cx, cz in x–z, at y, angles t0…t1 */
function hoop(cx: number, cz: number, R: number, t0: number, t1: number, y: number, halfY: number, halfT: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nu = 28;
  const prof: P2[] = [
    [-halfY, -halfT],
    [halfY, -halfT],
    [halfY, halfT],
    [-halfY, halfT],
  ];
  const pt = (u: number, k: number): P3 => {
    const t = t0 + (t1 - t0) * u;
    const r = R + prof[k][1];
    return [cx + Math.cos(t) * r, y + prof[k][0] * Math.sign(y), cz + Math.sin(t) * r];
  };
  for (let i = 0; i < nu; i++)
    for (let k = 0; k < 4; k++) {
      const a = pt(i / nu, k);
      const b = pt(i / nu, (k + 1) % 4);
      const c = pt((i + 1) / nu, k);
      const d = pt((i + 1) / nu, (k + 1) % 4);
      pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  return creased(pos, 0.6);
}

/** primitives into the shared non-indexed, uv-less layout so everything merges */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let o = g.index ? g.toNonIndexed() : g;
  if (!o.attributes.normal) o.computeVertexNormals();
  o = o.clone();
  for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k);
  return o;
}
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, r = 0.6) => prep(new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2.1, sy / 2.1, sz / 2.1)).translate(x, y, z));
const merge = (a: THREE.BufferGeometry[]) => mergeGeometries(a.map(prep));

// ------------------------------------------------------------------ assembling a car
export interface CarGeos {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  carbon: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  grille: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  rimLip: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
  nozzle: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
}
export interface Rig {
  /** wheels in the car frame: x, y, drawn radius, resting centre z, tyre width */
  wheels: [number, number, number, number, number][];
  /** the arches for the paint (x, z, radius), the well's half width outboard of which it's dark */
  archF: P3;
  archR: P3;
  ground: number;
  /** body width (the paint shader's decals scale to it) */
  wk: number;
  jets: P3[];
  antenna: P3;
}

const cache = new Map<number, { g: CarGeos; rig: Rig }>();

export function carModel(body: number): { g: CarGeos; rig: Rig } {
  const b = Math.max(0, Math.min(SPECS.length - 1, body | 0));
  const hit = cache.get(b);
  if (hit) return hit;
  const sp = SPECS[b];
  const dz = 17 - REST[BODIES[b].preset];
  const wheels: Wheel[] = [
    { x: sp.wf[0], r: sp.wf[1], y: sp.wf[2], w: sp.wf[3] },
    { x: sp.wr[0], r: sp.wr[1], y: sp.wr[2], w: sp.wr[3] },
  ];
  const paint: THREE.BufferGeometry[] = [];
  const carbon: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const head: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];

  // the body: fine rings through the sections, the arches cut at every ring
  const bs = sample(sp.body, 8);
  paint.push(loftRings(bs.map((s) => ({ x: s.x, p: bodyRing(s, sp.inner, wheels) })), sp.bulge));
  // the greenhouse in glass, its roof (and rear pillars) in paint a hair proud of it
  const cs = sample(sp.cabin, 6);
  const glass = loftRings(cs.map((s) => ({ x: s.x, p: cabinRing(s) })), [1, 1]);
  const roof = cs
    .filter((s) => s.x < sp.cabin[1].x - 1)
    .map((s) => {
      const r = cabinRing(s);
      // aft of the pillar line the paint comes down the side to the sill; forward, only the roof
      const k = Math.min(1, Math.max(0, (sp.pillar - s.x) / 6));
      const lo: P2 = [r[2][0] * k + r[3][0] * (1 - k), r[2][1] * k + r[3][1] * (1 - k)];
      const pts: P2[] = [[0, r[0][1]], lo, r[3], r[4], r[5], r[6]].map(([y, z], i) => (i === 0 ? [0, z] : [y + 0.35, z + 0.35])) as P2[];
      // (collapsed under the roof forward of the pillar, so the side windows stay glass)
      pts[0] = [0, lo[1] - 0.5];
      return { x: s.x, p: pts };
    });
  paint.push(loftRings(roof, [0.5, 0.5]));

  // nose: grille, splitter, lights; tail: diffuser, light bar, nozzles
  const f0 = sp.body[0];
  const f1 = sp.body[1];
  const grille = new THREE.PlaneGeometry(Math.max(4, f1.zm - f1.zb), f1.wb * 1.15, 1, 1)
    .rotateY(Math.PI / 2 + 0.25)
    .translate(f0.x - 1.2, 0, (f0.zb + f0.zm) / 2 + 1);
  carbon.push(box(9, f0.wb * 2 + 10, 1.4, f0.x - 5, 0, f0.zb + 0.4, 0.5));
  for (const sy of [-1, 1]) {
    const h = new THREE.BoxGeometry(10, 1.6, 1.6);
    h.rotateY(0.38);
    h.rotateZ(sy * 0.32);
    h.translate(sp.head[0], sy * sp.head[1], sp.head[2]);
    head.push(h);
    head.push(new THREE.CylinderGeometry(1.6, 1.6, 1, 14).rotateZ(Math.PI / 2).translate(f0.x - 0.6, sy * (f1.wb * 0.75), f0.zb + 2.5));
    tail.push(new THREE.BoxGeometry(1.2, 9, 3.2).translate(sp.tail[0], sy * sp.tail[1], sp.tail[2]));
  }
  tail.push(new THREE.BoxGeometry(1, sp.tail[1] * 1.6, 1).translate(sp.tail[0] - 0.2, 0, sp.tail[2] + 1.2));
  const t0 = sp.body[sp.body.length - 1];
  carbon.push(box(12, t0.wm * 1.5, 7, t0.x + 3, 0, t0.zb + 2.5, 1));
  for (const fy of [-0.5, -0.17, 0.17, 0.5]) carbon.push(box(10, 0.9, 5, t0.x + 1, fy * t0.wm * 1.3, t0.zb + 2.2, 0.3));
  // the floor pan between the wheels
  carbon.push(box(90, sp.inner * 2, 2, 8, 0, Math.min(...sp.body.map((s) => s.zb)) + 1.2, 0.8));

  // the wing
  const [wx0, wx1] = sp.wx;
  if (sp.wing === 'blade' || sp.wing === 'wide' || sp.wing === 'tall') {
    const chord = wx1 - wx0;
    const blade = prep(new RoundedBoxGeometry(chord, sp.ws * 2, 2.6, 2, 1.1));
    blade.rotateY(-0.12);
    blade.translate((wx0 + wx1) / 2, 0, sp.wz);
    accent.push(blade);
    const deck = archZ(wx0, []) > -1e8 ? 0 : 0;
    const deckZ = sp.body[sp.body.length - 3].zt + deck;
    for (const sy of [-1, 1]) {
      carbon.push(box(chord + 4, 1.2, 9, (wx0 + wx1) / 2 - 1, sy * (sp.ws + 0.6), sp.wz, 0.5));
      const h = sp.wz - deckZ;
      const st = prep(new RoundedBoxGeometry(4.5, 1.6, h + 1, 1, 0.5));
      st.rotateY(0.25);
      st.translate((wx0 + wx1) / 2 + 2, sy * Math.min(15, sp.ws * 0.5), deckZ + h / 2);
      carbon.push(st);
    }
  } else if (sp.wing === 'duck') {
    const lip = sample(
      [
        S(wx1, sp.wz - 4, 0, 1, 0, 1, 0, sp.ws - 2, sp.wz - 1, 0.3),
        S((wx0 + wx1) / 2, sp.wz - 3, 0, 1, 0, 1, 0, sp.ws, sp.wz + 1.5, 0.3),
        S(wx0, sp.wz - 2, 0, 1, 0, 1, 0, sp.ws, sp.wz + 3, 0.2),
      ],
      4,
    ).map((s) => ({ x: s.x, p: [[0, s.zb], [s.wt, s.zb], [s.wt, s.zt], [0, s.zt + s.crown]] as P2[] }));
    accent.push(loftRings(lip, [0.2, 0.2]));
  } else if (sp.wing === 'fin') {
    const fin = sample(
      [
        { x: wx1, zb: sp.wz - 4, zt: sp.wz - 3.5 },
        { x: (wx0 + wx1) / 2, zb: sp.wz - 2, zt: sp.wz + 6 },
        { x: wx0 + 4, zb: sp.wz - 1, zt: sp.wz + 12 },
        { x: wx0, zb: sp.wz - 1, zt: sp.wz + 10 },
      ],
      4,
    ).map((s) => ({ x: s.x, p: [[0, s.zb], [0.9, s.zb], [0.6, s.zt], [0, s.zt + 0.2]] as P2[] }));
    accent.push(loftRings(fin, [0.5, 0.5]));
    accent.push(box(7, sp.ws * 1.8, 2, wx0 + 3, 0, sp.body[sp.body.length - 2].zt + 0.8, 0.8));
  }
  if (sp.extras === 'truck') {
    // a roof rack (rails in the accent) and a bull bar
    const top = sp.cabin[3].zt + sp.cabin[3].crown;
    for (const rx of [-26, -8, 8]) carbon.push(box(2.2, 50, 1.8, rx, 0, top + 2.2, 0.6));
    for (const sy of [-1, 1]) {
      accent.push(box(40, 2, 2, -9, sy * 25, top + 2.2, 0.8));
      carbon.push(box(2, 2, 14, f0.x + 3, sy * 18, f0.zb + 7, 0.8));
    }
    carbon.push(box(2.2, 42, 2.2, f0.x + 3.5, 0, f0.zb + 13, 0.9));
    carbon.push(box(2.2, 42, 2.2, f0.x + 3.5, 0, f0.zb + 4, 0.9));
  }

  // ---- wheels (axle along y, unit radius and width, the outer face +y)
  // a fat slick: rounded shoulders, a bulging sidewall
  const tp: THREE.Vector2[] = [new THREE.Vector2(0.6, -0.47)];
  for (let k = 0; k <= 14; k++) {
    const a = (k / 14) * Math.PI;
    tp.push(new THREE.Vector2(0.78 + 0.22 * Math.sin(a) ** 0.45, -0.5 + 0.5 * (1 - Math.cos(a))));
  }
  tp.push(new THREE.Vector2(0.6, 0.47));
  const tyre = new THREE.LatheGeometry(tp, 56);
  // the rim: a deep dish, a stepped lip, six bevelled twin spokes, a centre cap
  const dish = new THREE.LatheGeometry(
    [new THREE.Vector2(0.001, 0.22), new THREE.Vector2(0.17, 0.22), new THREE.Vector2(0.2, 0.3), new THREE.Vector2(0.24, 0.32), new THREE.Vector2(0.55, 0.12), new THREE.Vector2(0.6, 0.38), new THREE.Vector2(0.63, 0.4), new THREE.Vector2(0.62, -0.3)],
    40,
  );
  const spokes: THREE.BufferGeometry[] = [prep(dish)];
  const shape = new THREE.Shape();
  shape.moveTo(-0.06, 0.18);
  shape.lineTo(0.06, 0.18);
  shape.lineTo(0.035, 0.6);
  shape.lineTo(-0.035, 0.6);
  shape.closePath();
  for (let k = 0; k < 6; k++)
    for (const off of [-0.075, 0.075]) {
      const e = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1 });
      // (the shape lies in x–y with depth along z: stand it in the wheel's x–z plane, its face out +y)
      e.rotateX(-Math.PI / 2);
      e.translate(off, 0.3, 0);
      e.rotateY(0.12 * Math.sign(off));
      e.rotateY((k / 6) * Math.PI * 2);
      spokes.push(prep(e));
    }
  spokes.push(prep(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 18).translate(0, 0.34, 0)));
  const rim = mergeGeometries(spokes);
  const rimLip = new THREE.TorusGeometry(0.63, 0.03, 8, 48);
  rimLip.rotateX(Math.PI / 2);
  rimLip.translate(0, 0.4, 0);
  const disc = mergeGeometries([prep(new THREE.CylinderGeometry(0.47, 0.47, 0.05, 32).translate(0, 0.02, 0)), prep(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 18).translate(0, 0.03, 0))]);
  // the caliper: a block over the disc's rear quarter (doesn't spin)
  const cal = prep(new RoundedBoxGeometry(0.34, 0.16, 0.2, 2, 0.05));
  cal.translate(0, 0.1, 0.38);
  cal.rotateY(0.7);
  const nozzle = new THREE.CylinderGeometry(5.6, 4.2, 10, 24, 1, true);
  nozzle.rotateZ(Math.PI / 2);
  const flame = new THREE.ConeGeometry(1, 1, 18, 6, true);
  flame.rotateZ(Math.PI / 2);
  flame.translate(-0.5, 0, 0);

  // drop everything to the class's ride height
  const drop = (g: THREE.BufferGeometry) => g.translate(0, 0, dz);
  const g: CarGeos = {
    paint: drop(merge(paint)),
    glass: drop(prep(glass)),
    carbon: drop(merge(carbon)),
    accent: drop(merge(accent.length ? accent : [box(0.1, 0.1, 0.1, 0, 0, -10)])),
    grille: drop(grille),
    head: drop(merge(head)),
    tail: drop(merge(tail)),
    tyre,
    rim,
    rimLip,
    disc,
    caliper: cal,
    nozzle,
    flame,
  };
  const rest = REST[BODIES[b].preset];
  const rig: Rig = {
    wheels: [
      [sp.wf[0], sp.wf[2], sp.wf[1], sp.wf[1] - rest, sp.wf[3]],
      [sp.wf[0], -sp.wf[2], sp.wf[1], sp.wf[1] - rest, sp.wf[3]],
      [sp.wr[0], sp.wr[2], sp.wr[1], sp.wr[1] - rest, sp.wr[3]],
      [sp.wr[0], -sp.wr[2], sp.wr[1], sp.wr[1] - rest, sp.wr[3]],
    ],
    archF: [sp.wf[0], sp.wf[1] - rest, sp.wf[1] + 2.6],
    archR: [sp.wr[0], sp.wr[1] - rest, sp.wr[1] + 2.6],
    ground: -rest,
    wk: (bs.reduce((a, s) => Math.max(a, s.wm), 0) / 43.5) * 1,
    jets: [
      [sp.jet[0], sp.jet[1], sp.jet[2] + dz],
      [sp.jet[0], -sp.jet[1], sp.jet[2] + dz],
    ],
    antenna: [sp.antenna[0], sp.antenna[1], sp.antenna[2] + dz],
  };
  const out = { g, rig };
  cache.set(b, out);
  return out;
}
