import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { buildMontrealDress } from './montrealDress.ts';
import { buildSpielbergDress } from './spielbergDress.ts';
import { buildZandvoortDress } from './zandvoortDress.ts';
import { buildAustinDress } from './austinDress.ts';
import { buildInterlagosDress } from './interlagosDress.ts';

/**
 * The venue's own race-weekend dressing (dressKit.ts): its gantries, hoardings, big boards,
 * painted run-off and the features on top of its pit building. Null for a circuit without one.
 * (A failure here must not take the landscape with it.)
 */
export function buildVenueDress(track: Track, map: WorldMap, layout: Layout): THREE.Group | null {
  const build: Record<string, (t: Track, m: WorldMap, l: Layout) => THREE.Group> = {
    montreal: buildMontrealDress,
    spielberg: buildSpielbergDress,
    zandvoort: buildZandvoortDress,
    austin: buildAustinDress,
    interlagos: buildInterlagosDress,
  };
  const fn = build[track.def.id];
  if (!fn) return null;
  try {
    return fn(track, map, layout);
  } catch (e) {
    console.error('[scenery] venue dressing failed — skipping it', e);
    return null;
  }
}

/**
 * Seat colours of the venue's stands (grandstands.ts; schemes cycle by stand, colours by block and
 * tier): Montréal's aluminium bleachers with blue and red blocks, Spielberg's red-white-red and the
 * owner's navy, Austin's red, white and navy, Interlagos's blue, green and yellow.
 */
export const VENUE_SEATS: Partial<Record<string, number[][]>> = {
  montreal: [
    [0xb9bdc1, 0xa9adb2, 0xb9bdc1, 0x1f4f9c],
    [0x1f4f9c, 0x17407f, 0x1f4f9c, 0xb9bdc1],
    [0xc8102e, 0xb9bdc1, 0xa9adb2, 0xc8102e],
  ],
  spielberg: [
    [0xc8102e, 0xb20d27, 0xc8102e, 0xe8e8e8],
    [0x1b2b5a, 0x223971, 0x1b2b5a, 0xd9d9d9],
    [0xe8e8e8, 0xc8102e, 0xe8e8e8, 0x1b2b5a],
  ],
  austin: [
    [0x1f3a68, 0x17305a, 0x1f3a68, 0xb22234],
    [0xb22234, 0x9a1c2c, 0xb22234, 0xe8e8e8],
    [0xe8e8e8, 0x1f3a68, 0xb22234, 0x1f3a68],
  ],
  interlagos: [
    [0x1f5fbf, 0x1b2552, 0x1f5fbf, 0xffd400],
    [0x009c3b, 0x0b7a33, 0x009c3b, 0xffdf00],
    [0xffdf00, 0x009c3b, 0x1f5fbf, 0xffdf00],
  ],
};
