import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, lerp, ridged2, smoothstep } from '../noise.ts';

/**
 * The Hungaroring's land: a valley bowl in the Gödöllő Hills, 18 km north-east of Budapest,
 * between the village of Mogyoród (north-west) and the M3 motorway (south). The lap climbs
 * from the bottom of the valley (Turn 2) to the top of the hill (the chicane), so the land
 * round it tilts the same way; beyond it the rolling hills rise higher to the north and east,
 * wooded with oak and acacia (black locust), and fall away to the south-west toward the plain
 * and Budapest. Between the woods: big sunflower, wheat and maize fields, dry July pasture.
 *
 * Everything is in the circuit's frame: x = east, z = south, heights relative to the lowest
 * point of the lap (Turn 2 ≈ 0; the chicane ≈ +35).
 */

/** the villages and towns round the circuit (offsets from the circuit's centre, m) */
export const HUNGARORING_TOWNS: { name: string; x: number; z: number; r: number }[] = [
  { name: 'Mogyoród', x: -1750, z: -1050, r: 820 },
  { name: 'Fót', x: -4300, z: -500, r: 1150 },
  { name: 'Kerepes', x: -1300, z: 2900, r: 780 },
  { name: 'Kistarcsa', x: -3100, z: 2500, r: 700 },
  { name: 'Szada', x: 1700, z: -3300, r: 620 },
  { name: 'Gödöllő', x: 5200, z: 900, r: 1400 },
];

/** the M3 motorway: an east–west line ~1.25 km south of the circuit (z at x, circuit frame) */
export function hungaroringM3(x: number): number {
  return 1250 + 0.09 * x + 90 * Math.sin(x / 2100 + 0.4);
}

/** the lap's own tilt (a plane fitted to the heights: up to the north-east), capped */
function tilt(X: number, Z: number): number {
  const v = 0.028 * X - 0.031 * Z;
  return 14 + 34 * Math.tanh(v / 34);
}

/** inside the lap (0..1, smooth), from a coarse raster of the centreline polygon */
const insideCache = new WeakMap<WorldMap, { x0: number; z0: number; w: number; h: number; g: Float32Array }>();
const IN_CELL = 16;
export function hungaroringInside(map: WorldMap, x: number, z: number): number {
  let r = insideCache.get(map);
  if (!r) {
    const t = map.track;
    const poly: number[] = [];
    for (let i = 0; i < t.n; i += 8) poly.push(t.px[i], t.pz[i]);
    const bb = map.A.bb;
    const x0 = bb.x0 - 400, z0 = bb.z0 - 400;
    const w = Math.ceil((bb.x1 - bb.x0 + 800) / IN_CELL) + 1, h = Math.ceil((bb.z1 - bb.z0 + 800) / IN_CELL) + 1;
    const g = new Float32Array(w * h);
    const m = poly.length / 2;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const px = x0 + i * IN_CELL, pz = z0 + j * IN_CELL;
        let c = false;
        for (let a = 0, b = m - 1; a < m; b = a++) {
          const ax = poly[a * 2], az = poly[a * 2 + 1], bx = poly[b * 2], bz = poly[b * 2 + 1];
          if (az > pz !== bz > pz && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) c = !c;
        }
        g[j * w + i] = c ? 1 : 0;
      }
    // soften the edge a little (three box passes)
    const tmp = new Float32Array(w * h);
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          let s = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
              s += g[jj * w + ii];
              n++;
            }
          tmp[j * w + i] = s / n;
        }
      g.set(tmp);
    }
    r = { x0, z0, w, h, g };
    insideCache.set(map, r);
  }
  const fx = (x - r.x0) / IN_CELL, fz = (z - r.z0) / IN_CELL;
  if (fx < 0 || fz < 0 || fx >= r.w - 1 || fz >= r.h - 1) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const G = r.g, W = r.w;
  return lerp(lerp(G[j * W + i], G[j * W + i + 1], u), lerp(G[(j + 1) * W + i], G[(j + 1) * W + i + 1], u), v);
}

/** the regional land (no circuit): the tilted bowl, the rolling Gödöllő Hills, the plain to the SW */
export function hungaroringRegional(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  const X = x - c.x, Z = z - c.z;
  const R = Math.hypot(X, Z);
  let h = tilt(X, Z);
  // rolling hills everywhere, bigger away from the circuit
  const grow = 0.35 + 0.65 * smoothstep(500, 2600, R);
  h += grow * (20 * fbm2(X / 1500 + 3.1, Z / 1500 - 1.7, 4) + 7 * fbm2(X / 480 - 2.2, Z / 480 + 5.3, 3));
  // the Gödöllő Hills: higher, wooded ridges to the north and east (~100–150 m above the valley)
  const ne = X * 0.62 - Z * 0.78;
  const hills = smoothstep(200, 2600, ne + 500 * fbm2(X / 3000, Z / 3000 + 4.4, 2));
  const rid = ridged2(X / 1900 + 0.7, Z / 1900 - 2.9, 4, 2.0, 0.5);
  h += hills * (40 + 95 * rid * (0.6 + 0.4 * (fbm2(X / 5200 - 1.1, Z / 5200 + 2.6, 2) * 0.5 + 0.5)));
  // and all round, a ring of rolling hills a kilometre or two out (the valley's rim)
  h += smoothstep(700, 2200, R) * (1 - 0.5 * smoothstep(3500, 7000, R)) * (28 + 34 * ridged2(X / 1500 - 4.1, Z / 1500 + 1.3, 3, 2.0, 0.5));
  // east beyond Gödöllő the hills roll on; west and south-west the land falls to the Danube plain
  const sw = -X * 0.72 + Z * 0.69;
  h -= smoothstep(1400, 7000, sw) * 38;
  // the M3's broad valley south of the circuit
  const dm = Math.abs(Z - hungaroringM3(X));
  h -= 7 * (1 - smoothstep(60, 700, dm));
  // far out: gentle long swells so the horizon isn't flat
  h += smoothstep(4000, 9000, R) * 30 * fbm2(X / 6000 + 7.7, Z / 6000 - 4.2, 3);
  return h;
}

/** natural land height at (x, z) for the venue (platform = blurred circuit heights) */
export function hungaroringNatural(map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  const reg = hungaroringRegional(map, x, z);
  const near = 1 - smoothstep(120, 560, dT);
  let h = lerp(reg, platform, near);
  // the bowl: the land rises gently away from the track on the outside of the lap (the
  // natural hillside grandstands), the infield rolls over low knolls
  const inside = hungaroringInside(map, x, z);
  const rim = smoothstep(50, 480, dT);
  h += rim * lerp(30 + 12 * fbm2(x / 420 + 1.3, z / 420 - 0.4, 2), 7 + 7 * fbm2(x / 240 - 3.1, z / 240 + 2.2, 2), inside);
  // bumpy dry meadows
  const bumps = (0.3 + 0.7 * smoothstep(35, 260, dT)) * (2.6 * fbm2(x / 240 + 2.3, z / 240 - 4.1, 3) + 0.9 * fbm2(x / 64 - 3.3, z / 64 + 1.9, 2));
  return h + bumps;
}

/** the circuit's estate: grass banks, car parks and campsites round it */
export function hungaroringPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  return { cx: center.x - 40, cz: center.z + 40, rx: (bb.x1 - bb.x0) / 2 + 520, rz: (bb.z1 - bb.z0) / 2 + 500 };
}

/** built-up density 0..1: Mogyoród and the other villages, Gödöllő */
export function hungaroringUrban(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  let u = 0;
  const n = fbm2(x / 360 + 7.3, z / 360 - 3.9, 3) * 0.5 + 0.5;
  for (const T of HUNGARORING_TOWNS) {
    const d = Math.hypot(x - c.x - T.x, z - c.z - T.z);
    if (d > T.r * 1.4) continue;
    u = Math.max(u, 1 - smoothstep(T.r * 0.35, T.r * 1.15, d + (n - 0.5) * T.r * 0.55));
  }
  u *= 1 - smoothstep(-0.05, 0.1, -map.parkDistance(x, z) / 300);
  // not across the motorway
  const dm = Math.abs(z - c.z - hungaroringM3(x - c.x));
  u *= smoothstep(40, 110, dm);
  return clamp(smoothstep(0.3, 0.6, u), 0, 1);
}

/**
 * Forest density 0..1: oak and acacia woods on the hills (north and east above all), copses
 * and shelterbelts between the fields, wooded patches in the infield and on the outer slopes;
 * open dry grass right round the track, the car parks and the villages.
 */
export function hungaroringForest(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  const X = x - c.x, Z = z - c.z;
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 560 + 11.3, z / 560 - 7.7, 4);
  const n2 = fbm2(x / 170 - 2.3, z / 170 + 6.1, 3);
  // the hill woods: higher ground is wooded, the valleys farmed
  const ne = X * 0.62 - Z * 0.78;
  const hill = smoothstep(700, 2600, ne + 700 * n1);
  let f = smoothstep(0.44, 0.58, 0.42 + 0.36 * n1 + 0.14 * n2 + 0.28 * hill);
  // copses and acacia shelterbelts along the field edges
  const copse = smoothstep(0.7, 0.75, fbm2(x / 320 + 1.9, z / 320 - 4.4, 3) * 0.5 + 0.5 + 0.08 * n2);
  const S = map.SQUARE;
  const inSq = x > S.x0 + 60 && x < S.x1 - 60 && z > S.z0 + 60 && z < S.z1 - 60;
  const belt = inSq ? smoothstep(0.972, 0.99, 1 - Math.abs(fbm2(x / 560 - 6.1, z / 560 + 3.3, 2))) * 0.85 * smoothstep(-0.25, 0.2, fbm2(x / 900 + 2.2, z / 900, 2)) : 0;
  f = Math.max(f, copse * 0.85, belt);
  // the estate right round the track: open grass banks, a few wooded patches (inside the lap,
  // on the hill behind Turns 5–11 above all)
  const estate = 1 - smoothstep(-40, 160, map.parkDistance(x, z));
  const inside = hungaroringInside(map, x, z);
  const patch = smoothstep(0.59, 0.65, 0.5 + 0.42 * n1 + 0.2 * n2 + 0.12 * inside) * 0.9;
  f = lerp(f, Math.max(f * 0.35, patch), estate);
  // open grass round the track (the woods stand back from the fences)
  f *= smoothstep(48, 120, dT);
  f *= map.clearingKeep(x, z);
  f *= 1 - smoothstep(0.12, 0.4, hungaroringUrban(map, x, z));
  // no trees on the motorway
  const dm = Math.abs(Z - hungaroringM3(X));
  f *= smoothstep(26, 60, dm);
  return f < 0.22 ? 0 : clamp(f, 0, 1);
}

/**
 * Tree species: oak (sessile and Turkey oak) on the hills, black locust (acacia — the chestnut
 * crowns stand in: light, round, airy) along the field edges and on the lower slopes, a few
 * planted black pines (the spruce stand in), poplars in the lines by the lanes and villages.
 */
export function hungaroringSpecies(map: WorldMap, x: number, z: number, n: number, n2: number, h: number): 'plane' | 'oak' | 'chestnut' | 'poplar' | 'spruce' {
  const c = map.A.center;
  const X = x - c.x, Z = z - c.z;
  const ne = X * 0.62 - Z * 0.78;
  const hill = smoothstep(700, 2600, ne);
  if (map.urban(x, z) > 0.05 || Math.abs(Z - hungaroringM3(X)) < 90) return h > 0.55 ? 'poplar' : 'plane';
  if (n < -0.42 && h < 0.35) return 'spruce';
  if (n2 > 0.28 - 0.3 * hill) return 'oak';
  if (n2 > -0.15) return 'chestnut';
  return h > 0.7 ? 'poplar' : 'plane';
}
