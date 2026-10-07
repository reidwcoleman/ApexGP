import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import { buildMonzaDress } from './monzaDress.ts';
import { buildSpaDress } from './spaDress.ts';
import { buildSilverstoneDress } from './silverstoneDress.ts';
import { buildSuzukaDress } from './suzukaDress.ts';
import { buildHungaroringDress } from './hungaroringDress.ts';

/**
 * The venue's own trackside dressing (footbridges, LED boards, the old pit rows; see dressKit.ts),
 * built with the scenery from what the layout planned. Null where the venue has none.
 */
export function buildVenueDress(track: Track, map: WorldMap): THREE.Group | null {
  try {
    switch (track.def.id) {
      case 'monza':
        return buildMonzaDress(track, map);
      case 'spa':
        return buildSpaDress(track, map);
      case 'silverstone':
        return buildSilverstoneDress(track, map);
      case 'suzuka':
        return buildSuzukaDress(track, map);
      case 'hungaroring':
        return buildHungaroringDress(track, map);
    }
  } catch (e) {
    // (dressing is a garnish: a failure here must not take the whole landscape with it)
    console.error('[scenery] venue dressing failed — building without it', e);
  }
  return null;
}
