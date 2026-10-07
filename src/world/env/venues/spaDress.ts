import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { ARCH } from '../archMaterial.ts';
import { srgb } from '../geom.ts';
import {
  BannerAtlas, DRESS_BRANDS as B, Dress, barrierLine, brandCell, brandNamed, dressPlan, footbridge, ledCell, ledRun, pitRow, planBridge, planRow, rowModule, setDressPlan, wordCell,
  type BridgeSpot, type RowSpot,
} from './dressKit.ts';
import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * Spa-Francorchamps' own trackside:
 *
 *   the old pits        the circuit's first pit row on the run down from La Source to Eau Rouge
 *                       (the start was there until 1979): a long single-storey row of garages
 *                       stepping down the hill, spectators along the rail on its roof, the old
 *                       two-storey timing block at the top end
 *   the bridges         the footbridge over the run down to Eau Rouge, just past the old pits, in
 *                       the watchmaker's green; the Kemmel bridge over the straight past the
 *                       Raidillon crest, a lager's green and red; the bridge on the long run from
 *                       Paul Frère toward Blanchimont
 *   LED boards          along the wall in front of the main grandstand opposite the pits
 */

interface SpaPlan {
  bridges: BridgeSpot[];
  oldPits: RowSpot | null;
}

export function planSpaDress(track: Track, map: WorldMap, gs: GrandstandSpec[], banks: SpectatorBank[]) {
  const bridges = DRESS_BRIDGES.spa.map((s) => planBridge(track, map, gs, banks, s));
  // the old pits: on the right of the run down from La Source, ending short of the Eau Rouge
  // bridge; the left if the right has no room (a stand, a bank, another leg of the lap)
  const ls = track.corners.find((c) => c.name === 'La Source');
  const er = track.corners.find((c) => c.name === 'Eau Rouge');
  let oldPits: RowSpot | null = null;
  if (ls && er) {
    const sA = ls.sEnd + 170, sB = Math.min(er.sStart - 150, DRESS_BRIDGES.spa[0] - 30);
    const q = new THREE.Vector3();
    for (const side of [1, -1]) {
      if (sB - sA < 60) break;
      let ok = true;
      for (let s = sA; s <= sB && ok; s += 10)
        for (const u of [5, 11, 17]) {
          track.point(s, side * (barrierLine(track, s, side) + u), 0, q);
          if (map.trackClearance(q.x, q.z) < 3 || map.excluded(q.x, q.z, 1)) ok = false;
          for (const b of banks) if (b.side === side && track.delta(b.sA, s) >= 0 && track.delta(s, b.sB) >= 0) ok = false;
        }
      if (!ok) continue;
      oldPits = planRow(track, map, sA, sB, side, 4.5, 12);
      break;
    }
  }
  setDressPlan<SpaPlan>(map, { bridges, oldPits });
}

export function buildSpaDress(track: Track, map: WorldMap): THREE.Group | null {
  const plan = dressPlan<SpaPlan>(map);
  if (!plan) return null;
  const atlas = new BannerAtlas([
    ['coronelle', 'band', wordCell({ text: 'CORONELLE', bg: '#0b5a3a', fg: '#e8cf86', weight: 600, track: 0.24, seed: 7 })],
    ['valdor', 'band', brandCell(B.valdor, false, 12)],
    ['hallstein', 'band', wordCell({ text: 'HALLSTEIN', bg: '#0b6e3f', fg: '#ffffff', accent: '#e4002b', weight: 700, rules: true, track: 0.06, seed: 17 })],
    ['spa', 'band', wordCell({ text: 'CIRCUIT DE SPA-FRANCORCHAMPS', bg: '#1a1a1a', fg: '#fdda24', accent: '#ef3340', weight: 700, rules: true, track: 0.04, seed: 19 })],
    ['karro', 'band', wordCell({ text: 'KARRO', bg: '#ffcc00', fg: '#d40511', italic: true, sx: 1.25, seed: 23 })],
    ['nexa', 'band', brandCell(B.nexa, false, 29)],
    ['spa_board', 'board', wordCell({ text: 'SPA-FRANCORCHAMPS', bg: '#1a1a1a', fg: '#fdda24', accent: '#ef3340', weight: 700, rules: true, seed: 37 })],
    ['fascia0', 'band', brandCell(B.valdor, true, 41)],
    ['fascia1', 'band', brandCell(B.hallstein, false, 42)],
    ['fascia2', 'band', brandCell(brandNamed('MAISON DUVAL'), false, 43)],
    ['led0', 'band', ledCell(brandCell(B.hallstein, false, 51, 0.3))],
    ['led1', 'band', ledCell(brandCell(B.coronelle, false, 52, 0.3))],
    ['led2', 'band', ledCell(brandCell(B.karro, false, 53, 0.3))],
    ['led3', 'band', ledCell(brandCell(B.valdor, false, 54, 0.3))],
    ['led4', 'band', ledCell(brandCell(B.nexa, false, 55, 0.3))],
    ['led5', 'band', ledCell(brandCell(brandNamed('CASTELLAN'), false, 56, 0.3))],
    ['coronelle_p', 'panel', brandCell(B.coronelle, false, 61)],
    ['hallstein_p', 'panel', brandCell(B.hallstein, false, 62)],
  ]);
  const d = new Dress(track, map, atlas);
  const [eauRouge, kemmel, blanchimont] = plan.bridges;
  if (eauRouge) footbridge(d, eauRouge, { front: ['coronelle'], back: ['spa'], kind: 'truss', steel: 0x0b3d28, towerCells: ['coronelle_p'] });
  if (kemmel) footbridge(d, kemmel, { front: ['hallstein'], back: ['valdor'], kind: 'box', steel: 0x2b2f35, tower: 0xc9ccce, towerCells: ['hallstein_p'] });
  if (blanchimont) footbridge(d, blanchimont, { front: ['karro'], back: ['nexa'], kind: 'truss', steel: 0x3a3d42 });
  // LED boards along the grandstand wall opposite the pits (pits on the left)
  ledRun(d, 340, 790, 1, 1.0, ['led0', 'led1', 'led2', 'led3', 'led4', 'led5'], 3);

  if (plan.oldPits) {
    const row = plan.oldPits;
    pitRow(d, row, { storeys: 1, wall: 0xe9e6de, trim: 0xf2f0ea, doors: [0x6d1f24, 0x3a3d42, 0x6d1f24], fascia: ['fascia0', 'fascia1', 'fascia2'], terrace: true });
    // the old timing block at the top end: two storeys over the first garages, the glazed box of
    // the old timekeepers' room on top of it
    const { L } = rowModule(d, row, row.sA, row.sA + 16);
    const z = (u: number) => row.side * u;
    const [za, zb] = [Math.min(z(0), z(row.depth)), Math.max(z(0), z(row.depth))];
    const render = srgb(0xe9e6de), trim = srgb(0xf4f2ec);
    d.box(L, -8, 4.4, za, 8, 9.4, zb, render, ARCH.RENDER);
    d.box(L, -8.4, 9.4, Math.min(z(-0.6), z(row.depth + 0.4)), 8.4, 9.8, Math.max(z(-0.6), z(row.depth + 0.4)), trim, ARCH.RENDER);
    // a band of windows toward the track on the upper floor
    d.glaze(L, row.side > 0 ? 7.4 : -7.4, z(-0.02), row.side > 0 ? -7.4 : 7.4, z(-0.02), 6.0, 8.6, new THREE.Vector3(0, 0, -row.side), 5);
    // the timekeepers' room: glazed all round under a flat roof
    const [ga, gb] = [Math.min(z(2), z(8)), Math.max(z(2), z(8))];
    d.box(L, -3.4, 9.8, ga, 3.4, 10.1, gb, trim, ARCH.RENDER);
    d.darkGlass(L, -3, 10.1, ga + 0.3, 3, 12.1, gb - 0.3);
    d.box(L, -3.8, 12.1, ga - 0.3, 3.8, 12.45, gb + 0.3, trim, ARCH.RENDER);
    d.bannerX(L, ga + 0.2, gb - 0.2, 10.4, 11.8, -3.06, -1, 'spa_board');
  }
  return d.finish('spa_dress');
}
