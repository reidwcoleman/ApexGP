import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, lerp, smoothstep } from '../noise.ts';

/**
 * Yas Island's land and water round the Yas Marina Circuit (circuit frame: x = east,
 * z = south, heights relative to the lap, ≈ 0 … 1 m).
 *
 * Reclaimed, dead-flat coastal land. The harbour (Yas Marina) sits in the pocket the lap
 * leaves between the pit building (north), the hotel section (west) and the T14–T15 run
 * (south), and opens east into the channel. The sea wraps the site's east and south
 * sides; beyond the channel lies the mainland shore (Al Raha: towers, the round Aldar
 * HQ). The island runs on north (Ferrari World under its red roof, Yas Mall) and west
 * (Yas Links). Abu Dhabi city is a skyline ~25 km to the south-west (horizon.ts).
 *
 * Everything is one signed "coast" distance (m, > 0 land, < 0 water); the marina basin is
 * cut with sharp-edged pads (venues/yasmarina.ts) so its quay walls stay vertical at the
 * fine terrain resolution.
 */

/** the sea and the marina's surface */
export const YAS_WATER_Y = -1.5;

/** the marina basin: an axis-aligned rectangle (world), open to the sea at its east end */
export const MARINA = { x0: 162, x1: 640, z0: 286, z1: 622 };
/** where the land's east coast runs (x) for the latitudes of the circuit */
const EAST_COAST = 590;

/** landmark sites (world, circuit frame) */
export const YAS_SITES = {
  /** the W Yas Marina hotel: the two wings either side of the T18–T19 run, the bridge between */
  hotel: { x: 88, z: 408 },
  /** Ferrari World Abu Dhabi, north-east of the hairpin */
  ferrari: { x: 420, z: -1330, r: 185 },
  /** Yas Mall, north of Ferrari World */
  mall: { x: -250, z: -1700 },
  /** Aldar HQ (the round tower) across the channel on the Al Raha shore */
  aldar: { x: 1650, z: 2350 },
};

// ------------------------------------------------------------------ geometry

/** east coast of the island (x of the shore at latitude z): bends east north of the circuit */
const eastCoastX = (z: number) => EAST_COAST + 1.15 * Math.max(0, -250 - z) + 22 * Math.sin(z / 170);
/** south coast (z of the shore at longitude x) */
const southCoastZ = (x: number) => 1085 + 0.12 * Math.max(0, -x - 300) + 26 * Math.sin(x / 210 + 0.7);
/** the mainland across the channel (Al Raha): metres inland of its shore (SW → NE), < 0 in the water */
const mainland = (x: number, z: number) => Math.max(z - (2250 - 0.42 * x), x - (2900 - 0.5 * z));

/** signed distance to the marina rectangle (negative inside) */
export function sdMarina(x: number, z: number): number {
  const M = MARINA;
  const cx = (M.x0 + M.x1) / 2, cz = (M.z0 + M.z1) / 2;
  const a = Math.abs(x - cx) - (M.x1 - M.x0) / 2;
  const b = Math.abs(z - cz) - (M.z1 - M.z0) / 2;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
}

export interface YasGeo {
  /** signed coast distance (m): > 0 land, < 0 water */
  coast: number;
  /** 0 water, 1 Yas Island, 2 the mainland shore (Al Raha) */
  land: number;
}
const G: YasGeo = { coast: 0, land: 0 };

export function yasGeo(x: number, z: number): YasGeo {
  // Yas Island: west of the east coast, north of the south coast; the island's own west and
  // north shores are far off (≈ 2.3 km west, 3.6 km north)
  const wob = 14 * fbm2(x / 300 + 1.3, z / 300 - 2.1, 2);
  let island = Math.min(eastCoastX(z) - x, southCoastZ(x) - z, x + 2300, z + 3600) + wob;
  // the marina cuts into it
  island = Math.min(island, sdMarina(x, z));
  const main = mainland(x, z) + 30 * fbm2(x / 500 - 4.4, z / 500 + 0.7, 2);
  let coast = island, land = 1;
  if (main > coast) { coast = main; land = 2; }
  if (coast < 0) land = 0;
  G.coast = coast;
  G.land = land;
  return G;
}

// ------------------------------------------------------------------ the worldmap hooks

/** the "park" is the circuit's own grounds */
export function yasmarinaPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const c = map.A.center;
  const B = map.A.bb;
  return { cx: c.x, cz: c.z, rx: (B.x1 - B.x0) / 2 + 520, rz: (B.z1 - B.z0) / 2 + 480 };
}

export function yasmarinaNatural(map: WorldMap, x: number, z: number, platform: number, dT: number, far: number): number {
  const g = yasGeo(x, z);
  // reclaimed land: flat fill a little above the sea, a few landscaped mounds out beyond the stands
  let landH = platform + (0.2 + 0.8 * far) * (0.35 * fbm2(x / 260 + 5.2, z / 260 - 2.4, 3) + 0.1 * fbm2(x / 70 - 1.3, z / 70 + 7.1, 2));
  landH += 1.4 * smoothstep(0.4, 0.75, fbm2(x / 180 + 9.1, z / 180 - 3.3, 2)) * smoothstep(90, 200, dT);
  if (g.land === 2) landH = 1.2 + 2.5 * smoothstep(0, 1500, g.coast);
  // (the far island: very low dunes)
  landH += smoothstep(700, 2000, dT) * 2.2 * (fbm2(x / 900 - 2.2, z / 900 + 1.6, 2) * 0.5 + 0.5) * (g.land === 1 ? 1 : 0);
  // banks: a beach / rip-rap slope into the water, then the sea bed
  const W = YAS_WATER_Y;
  const c = g.coast;
  if (c >= 0) return lerp(W + 0.35, landH, smoothstep(0, 26, c));
  return lerp(W + 0.35, W - 6.5, smoothstep(0, 40, -c));
}

/** tree cover: almost none (palms are placed by the scenery); a little scrub out on the fill */
export function yasmarinaForest(map: WorldMap, x: number, z: number): number {
  const g = yasGeo(x, z);
  if (g.coast < 10) return 0;
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 260 + 11.3, z / 260 - 7.7, 3) * 0.5 + 0.5;
  const n2 = fbm2(x / 90 - 2.3, z / 90 + 6.1, 2) * 0.5 + 0.5;
  // ghaf and acacia clumps on the sand beyond the circuit's landscaping
  const f = smoothstep(0.66, 0.82, n1 * 0.75 + n2 * 0.4 - 0.05) * 0.32 * smoothstep(120, 320, dT);
  return clamp(f * map.clearingKeep(x, z), 0, 1);
}

/** built-up: nothing near the circuit (the scenery builds its own landmarks and towers) */
export function yasmarinaUrban(_map: WorldMap, _x: number, _z: number): number {
  return 0;
}
