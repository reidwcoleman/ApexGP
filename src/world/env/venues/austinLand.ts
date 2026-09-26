import type { WorldMap } from '../worldmap.ts';
import { fbm2, ridged2, smoothstep } from '../noise.ts';

/**
 * The land round the Circuit of the Americas: Texas blackland prairie on the edge of the
 * Hill Country, south-east of Austin. Gently rolling ranch land of golden-green grass,
 * shallow creek valleys lined with pecan and live oak, mottes of live oak and cedar out in
 * the pastures, a few subdivisions, and on the north-western horizon the Austin skyline in
 * front of the blue-grey ridges of the Balcones Escarpment.
 *
 * Only the pure functions of the land live here (WorldMap calls them for venue 'austin');
 * the layout is in venues/austin.ts and the buildings in venues/austinScenery.ts.
 */

/** where downtown Austin stands, relative to the circuit centre (x east, z south): ~12 km NW */
export const AUSTIN_DOWNTOWN = { dx: -8300, dz: -8900 };

/** creek network: 1 on a creek line, falling to 0 over ~150 m */
function creek(x: number, z: number): number {
  const v = ridged2(x / 2300 + 4.1, z / 2300 - 1.3, 3, 2.0, 0.5);
  return smoothstep(0.62, 0.95, v);
}

/** natural height above the circuit's blurred platform */
export function austinNatural(map: WorldMap, x: number, z: number, dT: number, far: number): number {
  const c = map.A.center;
  let h = 0;
  // the rolling prairie: long low swells, a little texture close in
  h += (0.3 + 0.7 * far) * (6 * fbm2(x / 760 + 2.3, z / 760 - 4.1, 4) + 1.4 * fbm2(x / 170 - 3.3, z / 170 + 1.9, 2));
  const R = Math.hypot(x - c.x, z - c.z);
  const out = smoothstep(500, 2600, dT);
  h += out * 14 * (fbm2(x / 1900 + 1.7, z / 1900 - 0.4, 3) * 0.5 + 0.4);
  // shallow creek valleys cutting the swells (kept away from the circuit itself)
  h -= smoothstep(150, 700, dT) * 9 * creek(x, z);
  // the Hill Country: the Balcones ridges rise to the west and north-west, beyond the city
  const wx = x - c.x, wz = z - c.z;
  const west = smoothstep(5200, 12500, -(wx * 0.82 + wz * 0.35));
  if (west > 0) {
    const m = ridged2(x / 3400 + 3.1, z / 3400 - 1.7, 4, 2.1, 0.5);
    h += west * (60 + 210 * Math.pow(m, 1.6) * (0.55 + 0.5 * (fbm2(x / 7000 + 0.3, z / 7000 - 1.9, 2) * 0.5 + 0.5)));
  }
  // the Colorado valley and downtown sit low and flat
  const dtx = c.x + AUSTIN_DOWNTOWN.dx, dtz = c.z + AUSTIN_DOWNTOWN.dz;
  const town = 1 - smoothstep(1400, 3800, Math.hypot(x - dtx, z - dtz));
  h *= 1 - 0.8 * town;
  h -= smoothstep(2500, 9000, R) * 6;
  return h;
}

/** tree cover 0..1 (before clearings): open pasture, mottes, creek woods, cedar on the ridges */
export function austinForest(map: WorldMap, x: number, z: number, dT: number): number {
  const n1 = fbm2(x / 420 + 11.3, z / 420 - 7.7, 4) * 0.5 + 0.5;
  const n2 = fbm2(x / 120 - 2.3, z / 120 + 6.1, 3) * 0.5 + 0.5;
  // mottes: clumps of live oak out in the grass
  const motte = smoothstep(0.7, 0.84, n1 * 0.7 + n2 * 0.45 - 0.08);
  // lone mesquite and oaks scattered across the pastures
  const lone = 0.015 + 0.035 * n2 * n2;
  // creeks: pecan and oak galleries
  const cr = creek(x, z) * smoothstep(90, 260, dT);
  let f = Math.max(motte * 0.75, lone, cr * 0.85);
  // the circuit itself is open ground: a few trees in the infield, clear round the stands
  f *= 0.25 + 0.75 * smoothstep(40, 240, dT);
  // cedar brakes on the Hill Country ridges
  const c = map.A.center;
  const west = smoothstep(5200, 11000, -((x - c.x) * 0.82 + (z - c.z) * 0.35));
  f = Math.max(f, west * smoothstep(0.45, 0.6, n1) * 0.8);
  // less in town
  f *= 1 - 0.7 * smoothstep(0.25, 0.6, map.urban(x, z));
  return f;
}

/** additive bias for WorldMap.urban(): subdivisions toward Austin (NW), open ranch land elsewhere */
export function austinUrbanBias(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  const toTown = -((x - c.x) * 0.7 + (z - c.z) * 0.72);
  return -0.14 + 0.26 * smoothstep(1500, 6000, toTown);
}

/** US building colours for the subdivisions: tan/cream/grey siding and brick, grey shingle */
export const US_WALLS = [0xd9ccb0, 0xe8e2d4, 0xc9b28c, 0xb8a58a, 0xa36a4f, 0xdcd6cc, 0x9b8f80, 0xefe9dc];
export const US_ROOFS = [0x4a4c50, 0x5b5750, 0x3c3e42, 0x6c655c, 0x57504a, 0x7a5a45];
