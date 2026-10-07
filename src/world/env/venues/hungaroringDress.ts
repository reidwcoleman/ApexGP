import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { BannerAtlas, DRESS_BRANDS as B, Dress, brandCell, brandNamed, dressPlan, footbridge, ledCell, ledRun, planBridge, setDressPlan, wordCell, type BridgeSpot } from './venueDressKit.ts';
import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * The Hungaroring's own trackside:
 *
 *   the bridges   open truss footbridges over the back straight up to the Turn 4 crest (the
 *                 bank's navy, the circuit's name on the far face) and over the run down from
 *                 Turn 11 to Turn 12 (the freight company's yellow)
 *   LED boards    along the wall in front of the Super Gold and Gold stands, down the pit
 *                 straight to the Turn 1 braking zone
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
  const atlas = new BannerAtlas([
    ['tisza', 'band', wordCell({ text: 'TISZA BANK', bg: '#00205b', fg: '#ffffff', accent: '#ce2939', weight: 700, rules: true, track: 0.06, seed: 3 })],
    ['hungaroring', 'band', wordCell({ text: 'HUNGARORING', bg: '#ce2939', fg: '#ffffff', accent: '#477050', weight: 900, italic: true, rules: true, seed: 7 })],
    ['karro', 'band', wordCell({ text: 'KARRO', bg: '#ffcc00', fg: '#d40511', italic: true, sx: 1.25, seed: 11 })],
    ['hallstein', 'band', brandCell(B.hallstein, false, 13)],
    ['led0', 'band', ledCell(brandCell(B.tisza, false, 31, 0.3))],
    ['led1', 'band', ledCell(brandCell(B.karro, false, 32, 0.3))],
    ['led2', 'band', ledCell(brandCell(B.hallstein, false, 33, 0.3))],
    ['led3', 'band', ledCell(brandCell(B.coronelle, false, 34, 0.3))],
    ['led4', 'band', ledCell(brandCell(brandNamed('RIDGEWAY'), false, 35, 0.3))],
    ['led5', 'band', ledCell(brandCell(B.meridian, false, 36, 0.3))],
    ['tisza_p', 'panel', brandCell(B.tisza, false, 41)],
  ]);
  const d = new Dress(track, map, atlas);
  const [backStraight, turn12] = plan.bridges;
  if (backStraight) footbridge(d, backStraight, { front: ['tisza'], back: ['hungaroring'], kind: 'truss', steel: 0x2b2f35, towerCells: ['tisza_p'] });
  if (turn12) footbridge(d, turn12, { front: ['karro'], back: ['hallstein'], kind: 'truss', steel: 0x3a3d42 });
  // LED boards along the grandstand wall of the pit straight (the pits are on the right)
  ledRun(d, 430, 1030, -1, 1.0, ['led0', 'led1', 'led2', 'led3', 'led4', 'led5'], 3);
  return d.finish('hungaroring_dress');
}
