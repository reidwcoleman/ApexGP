import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, lerp, ridged2, smoothstep } from '../noise.ts';

/**
 * Zandvoort's land: the circuit sits in the coastal dunes (Noordduinen) right behind the
 * North Sea beach. West of the main straight a ~20 m foredune, then the beach and the sea;
 * rolling dunes with marram grass, blowouts and scrubby hollows all round the circuit; the
 * town of Zandvoort to the south-south-west (the boulevard with its apartment towers along the
 * beach, the old water tower on a dune); pine plantations of the Kennemerduinen further
 * inland and the wooded estates and polders toward Haarlem in the east.
 *
 * Everything is in the circuit's frame: x = east, z = south, heights in the lap's frame
 * (the main straight ≈ +3.4, the Slotemaker crest ≈ +14.6); the sea is at SEA_Y.
 *
 * Coast coordinates: `c` = metres inland from the waterline (negative = out at sea),
 * `a` = metres along the coast, positive toward the north-north-east.
 */

/** the North Sea's surface (world y) */
export const SEA_Y = -4;
/** the waterline lies this far west of the main straight's line */
export const COAST_OFF = 520;

export interface ZandvoortGeo {
  /** a point on the main straight (the start line) */
  px: number;
  pz: number;
  /** unit tangent of the coast (north-north-east) */
  tx: number;
  tz: number;
  /** unit normal toward the sea (west-north-west) */
  nx: number;
  nz: number;
}

const GEO = new WeakMap<WorldMap, ZandvoortGeo>();

export function zandvoortGeo(map: WorldMap): ZandvoortGeo {
  let g = GEO.get(map);
  if (g) return g;
  const t = map.track;
  const s = t.startS;
  const i = Math.floor(s);
  const tx = t.tx[i], tz = t.tz[i];
  const L = Math.hypot(tx, tz) || 1;
  const ux = tx / L, uz = tz / L;
  // the straight runs north-north-east; the sea is on its left (west)
  g = { px: t.px[i], pz: t.pz[i], tx: ux, tz: uz, nx: uz, nz: -ux };
  // make sure the normal points west
  if (g.nx > 0) { g.nx = -g.nx; g.nz = -g.nz; }
  GEO.set(map, g);
  return g;
}

/** (a, c): along the coast (north +) and inland from the waterline (sea −) */
export function coastCoords(map: WorldMap, x: number, z: number): { a: number; c: number } {
  const g = zandvoortGeo(map);
  const dx = x - g.px, dz = z - g.pz;
  return { a: dx * g.tx + dz * g.tz, c: COAST_OFF - (dx * g.nx + dz * g.nz) };
}

/** world point from coast coordinates */
export function coastPoint(map: WorldMap, a: number, c: number): { x: number; z: number } {
  const g = zandvoortGeo(map);
  const d = COAST_OFF - c;
  return { x: g.px + g.tx * a + g.nx * d, z: g.pz + g.tz * a + g.nz * d };
}

/** the circuit's estate: the dunes round the lap (the town and the far dunes lie outside) */
export function zandvoortPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  return { cx: center.x + 40, cz: center.z - 60, rx: (bb.x1 - bb.x0) / 2 + 330, rz: (bb.z1 - bb.z0) / 2 + 300 };
}

/** built-up density 0..1: the town of Zandvoort (south-south-west, along the beach) */
export function zandvoortUrban(map: WorldMap, x: number, z: number): number {
  const { a, c } = coastCoords(map, x, z);
  if (c < 60) return 0;
  const n = fbm2(x / 420 + 7.3, z / 420 - 3.9, 3);
  // the town: from the boulevard inland ~1.4 km, south of the circuit's last corners
  const along = smoothstep(-660 + 120 * n, -900, a) * (1 - smoothstep(-3300, -3900, a));
  const inland = 1 - smoothstep(1250 + 250 * n, 1650 + 250 * n, c);
  // Zandvoort-Noord pushes up toward the circuit east of the Kumho corner
  const noord = smoothstep(-480, -700, a + 0.25 * (c - 900)) * smoothstep(650, 800, c) * (1 - smoothstep(1300, 1500, c));
  let u = Math.max(along * inland, noord * 0.9) * smoothstep(60, 110, c);
  // never on the circuit's own dunes (stands, car parks)
  u *= smoothstep(160, 260, map.distToTrack(x, z));
  // Bentveld / Aerdenhout: villas among the trees 3 km inland
  const villas = smoothstep(2700, 3100, c) * (1 - smoothstep(3900, 4300, c)) * smoothstep(-2500, -1800, a) * (1 - smoothstep(600, 1200, a));
  u = Math.max(u, villas * smoothstep(0.1, 0.3, n * 0.5 + 0.5) * 0.75);
  // Haarlem on the horizon's plain (7 km east)
  u = Math.max(u, smoothstep(6000, 7000, c) * 0.9);
  return clamp(u, 0, 1);
}

/**
 * The coast by distance inland from the waterline: the sea floor, the beach (78 m of sand up to
 * the dune foot), the foredune's steep sea face to a crest ~20 m above the sea, and its long
 * back slope. `own` = how much the profile owns the height (1 up to the crest, 0 well behind).
 */
function coastProfile(c: number, a: number, n: number): { h: number; own: number } {
  // (the sea floor drops away quickly past the waterline: water and sand must stay a metre or two
  // apart or the depth buffer can't tell them apart from a distance)
  if (c < 0) return { h: SEA_Y + 0.2 - Math.min(-c * 0.3, 3.2) - Math.min(-c * 0.012, 8), own: 1 };
  if (c < 78) return { h: SEA_Y + 0.2 + (c / 78) * 2.8, own: 1 };
  const crestC = 150 + 30 * n;
  const crestH = SEA_Y + 20 + 5 * fbm2(a / 260 + 1.3, 0.7, 2);
  const h = c < crestC
    ? lerp(SEA_Y + 3, crestH, smoothstep(78, crestC, c))
    : lerp(crestH, SEA_Y + 10, smoothstep(crestC, crestC + 240, c));
  return { h, own: 1 - smoothstep(crestC - 10, crestC + 260, c) };
}

/** natural land height (before the track and the pads) */
export function zandvoortNatural(map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  const { a, c } = coastCoords(map, x, z);
  const n = fbm2(x / 380 + 2.3, z / 380 - 4.1, 3);
  // the dune field: parabolic dunes stretched along the south-westerly wind, hummocks, blowouts
  const wa = 0.42, ca = Math.cos(wa), sa = Math.sin(wa);
  const u = x * ca - z * sa, v = x * sa + z * ca;
  const ridge = ridged2(u / 340 + 3.1, v / 190 - 1.7, 4, 2.05, 0.5);
  const roll = fbm2(x / 220 - 5.2, z / 220 + 2.4, 3);
  const hummock = fbm2(x / 55 + 1.1, z / 55 - 0.3, 2);
  const inlandFade = 1 - smoothstep(1800, 3000, c);
  let dunes = SEA_Y + 7 + (14 * Math.pow(ridge, 1.6) + 5 * roll + 1.4 * hummock) * inlandFade;
  // the town sits on lower, levelled dunes; the villas and polders further inland are flat
  const urb = zandvoortUrban(map, x, z);
  dunes = lerp(dunes, SEA_Y + 8 + 3 * roll, urb * 0.8);
  dunes = lerp(dunes, SEA_Y + 1 + 1.5 * roll, smoothstep(2600, 3600, c));
  // near the circuit the land follows the lap's own heights (a blurred platform), dunes beyond
  // (the dunes rise right behind the fences: spectator banks on their slopes)
  const near = 1 - smoothstep(35, 170, dT);
  const bumps = (0.3 + 0.7 * smoothstep(25, 110, dT)) * (3.6 * roll + 1.2 * hummock + 3.5 * (Math.pow(ridge, 1.4) - 0.2));
  let h = lerp(dunes, platform + bumps, near);
  // the coast: sea floor, beach, foredune
  const cp = coastProfile(c, a, n);
  if (cp.own > 0) h = lerp(h, cp.h, cp.own);
  return h;
}

/** tree density 0..1: scrub in the dune hollows, pine plantations inland, the estates' woods */
export function zandvoortForest(map: WorldMap, x: number, z: number): number {
  const { c } = coastCoords(map, x, z);
  if (c < 230) return 0;
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 480 + 11.3, z / 480 - 7.7, 4);
  const n2 = fbm2(x / 150 - 2.3, z / 150 + 6.1, 3);
  // scrub (sea buckthorn, creeping willow, the odd wind-bent pine) in patches through the dunes
  const nS = 0.5 + 0.55 * n2 + 0.3 * n1;
  let f = Math.max(smoothstep(0.6, 0.8, nS) * 0.75, smoothstep(0.3, 0.6, nS) * 0.14) * smoothstep(300, 520, c);
  // pine plantations of the Kennemerduinen, 0.6–3 km inland, away from the circuit
  const pines = smoothstep(0.64, 0.76, 0.5 + 0.45 * n1 + 0.12 * n2) * smoothstep(1300, 1900, c) * smoothstep(450, 800, dT) * 0.75;
  f = Math.max(f, pines * 0.9);
  // the wooded estates toward Haarlem
  f = Math.max(f, smoothstep(2300, 2900, c) * (1 - smoothstep(5200, 6200, c)) * smoothstep(0.35, 0.55, 0.5 + 0.5 * n1) * 0.95);
  f *= smoothstep(30, 90, dT) * (1 - 0.8 * zandvoortUrban(map, x, z));
  return clamp(f * map.clearingKeep(x, z), 0, 1);
}
