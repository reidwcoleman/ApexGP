import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { BannerAtlas, Dress, brandCell, brandWord, dressPlan, footbridge, ledRun, planBridge, setDressPlan, type BridgeSpot } from './venueDressKit.ts';
import { rosterFor } from '../../partners.ts';
import { LedReel, rotation } from './ledReel.ts';

import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * Monza's own trackside, as the broadcast shows it:
 *
 *   the Rettifilo bridge   the enclosed footbridge over the braking zone for the first chicane
 *                          (the 150 m board stands under it): the title partner — the tyre
 *                          maker, as at the real Gran Premio (docs/F1_ADVERTISING.md §2) —
 *                          across the face the cars run at, the Lombard bank on the far face
 *   the Parabolica bridge  over the run from Ascari: the timekeeper's black, the freight yellow
 *   LED boards             along the wall in front of the Tribuna Centrale and the laterals,
 *                          from the Parabolica exit to the chicane, rolling through the partners
 */

interface MonzaPlan {
  bridges: BridgeSpot[];
}

export function planMonzaDress(track: Track, map: WorldMap, gs: GrandstandSpec[], banks: SpectatorBank[]) {
  setDressPlan<MonzaPlan>(map, { bridges: DRESS_BRIDGES.monza.map((s) => planBridge(track, map, gs, banks, s)) });
}

export function buildMonzaDress(track: Track, map: WorldMap): THREE.Group | null {
  const plan = dressPlan<MonzaPlan>(map);
  if (!plan) return null;
  const R = rosterFor(track.def.id);
  const atlas = new BannerAtlas([
    ['title', 'band', brandWord(R.b('title'), { rules: true, seed: 5 })],
    ['brianza', 'band', brandCell(R.b('brianza'), false, 11)],
    ['timing', 'band', brandWord(R.b('timing'), { seed: 9 })],
    ['logistics', 'band', brandWord(R.b('logistics'), { seed: 13 })],
    ['title_p', 'panel', brandCell(R.b('title'), false, 41)],
    ['timing_p', 'panel', brandCell(R.b('timing'), false, 42)],
  ]);
  const d = new Dress(track, map, atlas, new LedReel(rotation(R), 1024, 128));
  const [rettifilo, parabolica] = plan.bridges;
  if (rettifilo) footbridge(d, rettifilo, { front: ['title'], back: ['brianza'], kind: 'box', steel: 0x1b1b1b, tower: 0xd9d6cf, towerCells: ['title_p'] });
  if (parabolica) footbridge(d, parabolica, { front: ['timing'], back: ['logistics'], kind: 'box', steel: 0x15201b, tower: 0xc9ccce, towerCells: ['timing_p'] });
  // LED boards on the grandstand side of the main straight (the pits are on the right)
  ledRun(d, 236, 1000, -1, 1.0, ['title'], 3);
  return d.finish('monza_dress');
}
