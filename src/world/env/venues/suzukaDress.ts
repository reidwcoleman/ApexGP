import type * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { BannerAtlas, Dress, barrierLine, brandCell, brandWord, dressPlan, footbridge, hoarding, ledRun, planBridge, setDressPlan, wordCell, type BridgeSpot } from './venueDressKit.ts';
import { rosterFor } from '../../partners.ts';
import { LedReel, rotation } from './ledReel.ts';

import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * Suzuka's own trackside:
 *
 *   the Dunlop arch     the yellow arch at the top of the climb through the Dunlop curve (the
 *                       curve is named after it), over the short run to Degner where the run-offs
 *                       narrow, the series tyre maker's word mark across it in black on yellow
 *   the bridges         the enclosed footbridge over the end of the main straight (the home car
 *                       maker's red: it owns the circuit), the bridge over the back straight on the
 *                       run from Spoon to 130R (the title partner, the energy company, as in 2026)
 *   the 130R boards     big hoardings out past the run-off on the outside of 130R, square to the
 *                       cars coming off the back straight: the title partner and the home maker
 *   LED boards          along the wall in front of the Main Grandstand
 */

interface SuzukaPlan {
  bridges: BridgeSpot[];
}

export function planSuzukaDress(track: Track, map: WorldMap, gs: GrandstandSpec[], banks: SpectatorBank[]) {
  setDressPlan<SuzukaPlan>(map, { bridges: DRESS_BRIDGES.suzuka.map((s) => planBridge(track, map, gs, banks, s, s === 2500 ? 3.2 : 2.4)) });
  // the 130R boards' ground (out past the run-off, between the banks)
  const r130 = track.corners.find((c) => c.name === '130R');
  if (r130) for (const ds of [-46, -22]) {
    const s = r130.sStart + ds;
    const q = track.point(s, track.barrierAt(s, 1) + 8, 0);
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 10, halfL: 6, angle: Math.atan2(track.frame(s).tangent.x, track.frame(s).tangent.z) });
  }
}

export function buildSuzukaDress(track: Track, map: WorldMap): THREE.Group | null {
  const plan = dressPlan<SuzukaPlan>(map);
  if (!plan) return null;
  const R = rosterFor(track.def.id);
  const atlas = new BannerAtlas([
    ['tyres', 'band', brandWord(R.b('tyres'), { seed: 3 })],
    ['hayate', 'band', brandWord(R.b('hayate'), { rules: true, seed: 7 })],
    ['suzuka', 'band', wordCell({ text: 'SUZUKA', bg: '#ffffff', fg: '#bc002d', accent: '#111111', weight: 900, italic: true, rules: true, seed: 11 })],
    ['title', 'band', brandCell(R.b('title'), false, 13)],
    ['kosei', 'band', brandWord(R.b('kosei'), { seed: 17 })],
    ['board0', 'board', brandCell(R.b('title'), false, 21)],
    ['board1', 'board', brandCell(R.b('hayate'), false, 22)],
    ['hayate_p', 'panel', brandCell(R.b('hayate'), false, 41)],
  ]);
  const d = new Dress(track, map, atlas, new LedReel(rotation(R), 1024, 128));
  const [straight, dunlop, back] = plan.bridges;
  if (straight) footbridge(d, straight, { front: ['hayate'], back: ['suzuka'], kind: 'box', steel: 0x8e0a12, tower: 0xe9e9e6, towerCells: ['hayate_p'] });
  // the Dunlop arch: yellow ribs, the deck hung under them, black on yellow both faces
  if (dunlop) footbridge(d, dunlop, { front: ['tyres'], back: ['tyres'], kind: 'arch', arch: 0xf2c200, steel: 0x1b1b1b, clear: 6.8, bannerH: 2.8 });
  if (back) footbridge(d, back, { front: ['title'], back: ['kosei'], kind: 'truss', steel: 0x2b2f35 });
  // LED boards along the Main Grandstand's wall (the pits are on the right)
  ledRun(d, 330, 900, -1, 1.0, ['title'], 3);
  // 130R: big boards on the outside (a left-hander: the right side), facing the back straight
  const r130 = track.corners.find((c) => c.name === '130R');
  if (r130)
    [-46, -22].forEach((ds, k) => {
      const s = r130.sStart + ds;
      hoarding(d, s, barrierLine(track, s, 1) + 8, 0.45, 16, 4, 2.4, k ? 'board1' : 'board0');
    });
  return d.finish('suzuka_dress');
}
