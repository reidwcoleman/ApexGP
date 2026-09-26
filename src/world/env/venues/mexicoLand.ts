import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, smoothstep } from '../noise.ts';

/**
 * Mexico City's land round the Autódromo Hermanos Rodríguez. The circuit fills the northern
 * half of the Magdalena Mixiuhca sports city, on the dead-flat bed of old Lake Texcoco,
 * 2,240 m up: the Viaducto Río de la Piedad (an elevated-looking expressway in its trench)
 * along the north behind the main-straight grandstands, the Foro Sol stadium in the
 * north-west corner inside the Peraltada, the Palacio de los Deportes' copper dome at the
 * north-east corner by Turn 1, and south of the lap the sports city's fields, eucalyptus and
 * ash groves, a lake in the infield and the long straight rowing course. All round, beyond the
 * park, the city: flat-roofed two- and three-storey concrete houses to the horizon, apartment
 * blocks, the towers of Reforma and the centre ~7 km to the west-north-west (horizon.ts), and
 * on a clear day Popocatépetl and Iztaccíhuatl to the south-east.
 *
 * Circuit frame: x = east, z = south, heights relative to the lap (≈ 0.1 … 1.3 m).
 * The pure functions of the land live here (WorldMap calls them for venue 'mexico'); the
 * layout is in venues/mexico.ts, the buildings and the water in venues/mexicoScenery.ts and
 * venues/mexicoCity.ts.
 */

/** the lake and the rowing course's surface (world y) */
export const MX_WATER_Y = -0.7;

/** the rowing course (pista de canotaje): a long straight E–W basin south of the lap. A → B, half width */
export const CANAL = { ax: -820, az: 700, bx: 560, bz: 700, half: 34 };
/** the lake in the infield (between the main straight's end and the esses) */
export const MX_LAKE = { x: 395, z: -140, rx: 88, rz: 52, rot: 0.35 };
/** landmark sites (world, circuit frame) */
export const MX_SITES = {
  /** the Foro Sol: the centre of its bowl (the track winds through the field in front of the main stand) */
  foro: { x: -652, z: -372 },
  /** the Palacio de los Deportes (Félix Candela's copper dome, 1968), across from Turn 1 */
  palacio: { x: 640, z: -575, r: 62 },
  /** the Viaducto: a line along the north, z of its axis as a function of x */
  viaductoZ: (x: number) => -640 + 0.14 * x,
};

// ------------------------------------------------------------------ helpers

/** signed distance to the rowing course (negative inside the water) */
export function sdCanal(x: number, z: number): number {
  const B = CANAL;
  const dx = B.bx - B.ax, dz = B.bz - B.az;
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const px = x - (B.ax + B.bx) / 2, pz = z - (B.az + B.bz) / 2;
  const a = Math.abs(px * ux + pz * uz) - L / 2;
  const b = Math.abs(-px * uz + pz * ux) - B.half;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
}

/** approximate signed distance to the infield lake (negative inside) */
export function sdLake(x: number, z: number): number {
  const L = MX_LAKE;
  const c = Math.cos(L.rot), s = Math.sin(L.rot);
  const dx = x - L.x, dz = z - L.z;
  const u = dx * c - dz * s, v = dx * s + dz * c;
  // a slightly irregular shore
  const wob = 1 + 0.08 * Math.sin(Math.atan2(v, u) * 3 + 0.7);
  return (Math.hypot(u / L.rx, v / L.rz) - wob) * Math.min(L.rx, L.rz);
}

/** metres to the nearest water (negative inside) */
export function mexicoWater(x: number, z: number): number {
  return Math.min(sdCanal(x, z), sdLake(x, z));
}

// ------------------------------------------------------------------ the worldmap hooks

/** the Magdalena Mixiuhca sports city: the lap in its northern half, the fields and the rowing course south */
export function mexicoPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  return { cx: center.x - 30, cz: center.z + 190, rx: (bb.x1 - bb.x0) / 2 + 330, rz: (bb.z1 - bb.z0) / 2 + 440 };
}

/** the old lake bed: flat to within a metre or two for kilometres, the city's ground the same */
export function mexicoNatural(map: WorldMap, x: number, z: number, platform: number, dT: number, far: number): number {
  let h = platform + (0.2 + 0.8 * far) * (0.45 * fbm2(x / 300 + 5.2, z / 300 - 2.4, 3) + 0.12 * fbm2(x / 80 - 1.3, z / 80 + 7.1, 2));
  // landscaped mounds out in the park (the old Mixiuhca spoil heaps under the eucalyptus)
  h += 1.4 * smoothstep(0.4, 0.75, fbm2(x / 170 + 9.1, z / 170 - 3.3, 2)) * smoothstep(70, 160, dT) * (1 - map.outsidePark(x, z));
  // the city subsides very gently toward the east (the old lake's centre)
  h -= 0.0006 * Math.max(0, x - 1500);
  // banks down to the water
  const w = mexicoWater(x, z);
  if (w < 6) h = Math.min(h, MX_WATER_Y + 0.4 + Math.max(0, w) * 0.12);
  return h;
}

/** trees: eucalyptus and ash groves in the park, a belt behind the fences, street trees in the city */
export function mexicoForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  if (mexicoWater(x, z) < 7) return 0;
  const out = map.outsidePark(x, z);
  const n1 = fbm2(x / 260 + 11.3, z / 260 - 7.7, 3);
  const n2 = fbm2(x / 95 - 2.3, z / 95 + 6.1, 2);
  // groves in the park, with open fields between (the sports city's pitches are clearings too)
  const grove = smoothstep(0.44, 0.62, 0.5 + 0.55 * n1 + 0.22 * n2);
  // a thin belt of trees behind the fences for much of the lap
  const belt = (1 - smoothstep(34, 70, dT)) * smoothstep(12, 24, dT) * smoothstep(-0.1, 0.25, n2 + 0.15);
  let f = Math.max(grove * 0.88, belt * 0.8) * smoothstep(14, 30, dT);
  // lines of trees along the rowing course's banks
  const cb = sdCanal(x, z);
  if (cb > 8 && cb < 26) f = Math.max(f, 0.75);
  // the city: street trees and small parks only
  const city = 0.1 * smoothstep(0.55, 0.8, 0.5 + n2);
  f = f * (1 - out) + city * out;
  return clamp(f * map.clearingKeep(x, z), 0, 1);
}

/** built-up density 0..1: the city everywhere beyond the sports city's fences */
export function mexicoUrban(map: WorldMap, x: number, z: number): number {
  const out = map.outsidePark(x, z);
  if (out <= 0) return 0;
  // the odd park, school yard or market square breaks the carpet of roofs
  const n = fbm2(x / 700 + 7.3, z / 700 - 3.9, 3);
  const gap = smoothstep(0.34, 0.46, n);
  // the Viaducto's cutting and its verges along the north side stay open
  const via = smoothstep(18, 40, Math.abs(z - MX_SITES.viaductoZ(x)));
  return out * (0.95 - 0.7 * gap) * via;
}
