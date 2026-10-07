import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { BannerAtlas, DRESS_BRANDS as B, Dress, brandCell, brandNamed, dressPlan, footbridge, ledCell, ledRun, planBridge, setDressPlan, wordCell, type BridgeSpot } from './dressKit.ts';
import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * Monza's own trackside, as the broadcast shows it:
 *
 *   the Rettifilo bridge   the enclosed footbridge over the braking zone for the first chicane
 *                          (the 150 m board stands under it), one title sponsor in Italian red
 *                          across the face the cars run at, the bank on the far face
 *   the Parabolica bridge  over the run from Ascari, in the watchmaker's green and gold
 *   LED boards             along the wall in front of the Tribuna Centrale and the laterals,
 *                          lit sponsor panels in runs, from the Parabolica exit to the chicane
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
  const atlas = new BannerAtlas([
    ['veloce', 'band', wordCell({ text: 'VELOCE', bg: '#c8102e', fg: '#ffffff', accent: '#ffd400', italic: true, rules: true, sx: 1.12, seed: 5 })],
    ['brianza', 'band', brandCell(B.brianza, false, 11)],
    ['coronelle', 'band', wordCell({ text: 'CORONELLE', bg: '#0b5a3a', fg: '#e8cf86', weight: 600, track: 0.24, seed: 9 })],
    ['karro', 'band', wordCell({ text: 'KARRO', bg: '#ffcc00', fg: '#d40511', italic: true, sx: 1.25, seed: 13 })],
    ['led0', 'band', ledCell(brandCell(B.coronelle, false, 21, 0.3))],
    ['led1', 'band', ledCell(brandCell(B.veloce, false, 22, 0.3))],
    ['led2', 'band', ledCell(brandCell(B.karro, false, 23, 0.3))],
    ['led3', 'band', ledCell(brandCell(B.meridian, false, 24, 0.3))],
    ['led4', 'band', ledCell(brandCell(brandNamed('SABLE AIRWAYS'), false, 25, 0.3))],
    ['led5', 'band', ledCell(brandCell(B.nexa, false, 26, 0.3))],
    ['led6', 'band', ledCell(brandCell(B.castellan, true, 27, 0.3))],
    ['veloce_p', 'panel', brandCell(B.veloce, false, 41)],
    ['coronelle_p', 'panel', brandCell(B.coronelle, false, 42)],
  ]);
  const d = new Dress(track, map, atlas);
  const [rettifilo, parabolica] = plan.bridges;
  if (rettifilo) footbridge(d, rettifilo, { front: ['veloce'], back: ['brianza'], kind: 'box', steel: 0x8e1020, tower: 0xd9d6cf, towerCells: ['veloce_p'] });
  if (parabolica) footbridge(d, parabolica, { front: ['coronelle'], back: ['karro'], kind: 'box', steel: 0x0b3d28, tower: 0xc9ccce, towerCells: ['coronelle_p'] });
  // LED boards on the grandstand side of the main straight (the pits are on the right)
  ledRun(d, 236, 1000, -1, 1.0, ['led0', 'led1', 'led2', 'led3', 'led4', 'led5', 'led6'], 3);
  return d.finish('monza_dress');
}
