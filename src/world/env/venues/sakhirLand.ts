import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, ridged2, smoothstep } from '../noise.ts';

/**
 * The land round the Bahrain International Circuit: the island's central depression, a
 * flat, stony desert of pale sand and grey-brown limestone pavement, with low rocky
 * knolls and flat-topped outcrops (the circuit is cut between them; they stand a few
 * metres high all round the lap). About 4 km east rises Jebel ad-Dukhan, the island's
 * highest point (~134 m, ~110 m above the circuit), a broad rocky dome; to the west the
 * depression's rim, a low broken escarpment. No farmland, no woods: a little dusty scrub,
 * and irrigated lawns and palms only round the buildings (venues/sakhirScenery.ts).
 *
 * Circuit frame: x = east, z = south, heights relative to the lap (≈ 1.6 … 15.6).
 * Only the pure functions of the land live here (WorldMap calls them for venue 'sakhir');
 * the layout is venues/sakhir.ts, the buildings and the terrain look venues/sakhirScenery.ts.
 */

/** Jebel ad-Dukhan, relative to the circuit centre (x east, z south), its radius and height */
export const DUKHAN = { dx: 4100, dz: 250, r: 1500, h: 108 };

/** the circuit estate: the desert inside the perimeter fence (nothing built beyond it) */
export function sakhirPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  return { cx: center.x, cz: center.z, rx: (bb.x1 - bb.x0) / 2 + 460, rz: (bb.z1 - bb.z0) / 2 + 420 };
}

/** built-up density: none (the desert round Sakhir is empty; the towns are beyond the horizon) */
export function sakhirUrban(_map: WorldMap, _x: number, _z: number): number {
  return 0;
}

/** flat-topped limestone outcrops: 0 on the plain, 1 on a knoll's top (steep, crumbling sides) */
export function sakhirKnoll(x: number, z: number): number {
  const n = ridged2(x / 330 + 3.7, z / 330 - 1.9, 3, 2.0, 0.5) * 0.7 + (fbm2(x / 120 - 4.4, z / 120 + 2.2, 2) * 0.5 + 0.5) * 0.3;
  return smoothstep(0.66, 0.72, n);
}

/** natural height (absolute, circuit frame) */
export function sakhirNatural(map: WorldMap, x: number, z: number, P: number, dT: number, far: number): number {
  const c = map.A.center;
  let h = P;
  // the desert floor: long, very low swells and a little texture close in
  h += (0.3 + 0.7 * far) * (2.2 * fbm2(x / 640 + 2.3, z / 640 - 4.1, 4) + 0.45 * fbm2(x / 90 - 3.3, z / 90 + 1.9, 2));
  // rocky knolls: a few metres, kept away from the track itself (the circuit was cut through them)
  const keep = smoothstep(55, 150, dT);
  h += keep * sakhirKnoll(x, z) * (3.5 + 4.5 * (fbm2(x / 260 + 9.1, z / 260 - 6.3, 2) * 0.5 + 0.5));
  // Jebel ad-Dukhan: a broad rocky dome to the east, gullied flanks
  const jx = c.x + DUKHAN.dx, jz = c.z + DUKHAN.dz;
  const rj = Math.hypot(x - jx, z - jz) / DUKHAN.r;
  if (rj < 2.2) {
    const dome = Math.exp(-rj * rj * 1.6);
    const gully = ridged2(x / 380 + 1.3, z / 380 - 7.1, 3, 2.1, 0.5);
    h += DUKHAN.h * dome * (0.82 + 0.3 * gully) + 14 * smoothstep(2.2, 0.8, rj) * (fbm2(x / 300, z / 300, 3) * 0.5 + 0.5);
  }
  // the depression's rim to the west: a low broken escarpment ~3 km out, the plateau beyond
  const wx = c.x - 3000 + 260 * fbm2(z / 1500 + 5.5, 0.7, 3);
  const rim = smoothstep(wx + 60, wx - 120, x);
  h += rim * (22 + 10 * (fbm2(x / 500 - 2.2, z / 500 + 3.1, 3) * 0.5 + 0.5));
  // the land falls very gently toward the coasts far off
  const R = Math.hypot(x - c.x, z - c.z);
  h -= smoothstep(3500, 9000, R) * 8;
  return h;
}

/**
 * Plant cover 0..1: the desert is bare. A little dusty scrub in the hollows (small shrubs,
 * vegetation.ts), none on the knolls or near the track.
 */
export function sakhirForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const n = fbm2(x / 180 + 11.3, z / 180 - 7.7, 3) * 0.5 + 0.5;
  const scrub = smoothstep(0.62, 0.8, n) * 0.09;
  return clamp(scrub * smoothstep(40, 140, dT) * (1 - sakhirKnoll(x, z)), 0, 1);
}
