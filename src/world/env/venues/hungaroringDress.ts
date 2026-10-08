import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { BannerAtlas, Dress, brandCell, brandWord, dressPlan, footbridge, ledRun, planBridge, setDressPlan, wordCell, type BridgeSpot } from './venueDressKit.ts';
import { rosterFor } from '../../partners.ts';
import { LedReel, rotation } from './ledReel.ts';

import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * The Hungaroring's own trackside:
 *
 *   the bridges   open truss footbridges over the back straight up to the Turn 4 crest (the
 *                 title partner — the cloud company, as in 2026 — the circuit's name on the far
 *                 face) and over the run down from Turn 11 to Turn 12 (the freight company's
 *                 yellow, the Balaton beer behind)
 *   LED boards    along the wall in front of the Super Gold and Gold stands, down the pit
 *                 straight to the Turn 1 braking zone, rolling through the partners
 */

interface HungaroringPlan {
  bridges: BridgeSpot[];
}

export function planHungaroringDress(track: Track, map: WorldMap, gs: GrandstandSpec[], banks: SpectatorBank[]) {
  setDressPlan<HungaroringPlan>(map, { bridges: DRESS_BRIDGES.hungaroring.map((s) => planBridge(track, map, gs, banks, s)) });
}

export function buildHungaroringDress(track: Track, map: WorldMap): THREE.Group | null {
  const plan = dressPlan<HungaroringPlan>(map);
  if (!plan) return null;
  const R = rosterFor(track.def.id);
  const atlas = new BannerAtlas([
    ['title', 'band', brandWord(R.b('title'), { rules: true, seed: 3 })],
    ['hungaroring', 'band', wordCell({ text: 'HUNGARORING', bg: '#ce2939', fg: '#ffffff', accent: '#477050', weight: 900, italic: true, rules: true, seed: 7 })],
    ['logistics', 'band', brandWord(R.b('logistics'), { seed: 11 })],
    ['balaton', 'band', brandCell(R.b('balaton'), false, 13)],
    ['tisza_p', 'panel', brandCell(R.b('tisza'), false, 41)],
  ]);
  const d = new Dress(track, map, atlas, new LedReel(rotation(R), 1024, 128));
  const [backStraight, turn12] = plan.bridges;
  if (backStraight) footbridge(d, backStraight, { front: ['title'], back: ['hungaroring'], kind: 'truss', steel: 0x2b2f35, towerCells: ['tisza_p'] });
  if (turn12) footbridge(d, turn12, { front: ['logistics'], back: ['balaton'], kind: 'truss', steel: 0x3a3d42 });
  // LED boards along the grandstand wall of the pit straight (the pits are on the right)
  ledRun(d, 430, 1030, -1, 1.0, ['title'], 3);
  return d.finish('hungaroring_dress');
}
