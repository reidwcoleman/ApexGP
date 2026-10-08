import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { ARCH } from '../archMaterial.ts';
import { srgb } from '../geom.ts';
import {
  BannerAtlas, Dress, barrierLine, brandCell, brandWord, dressPlan, footbridge, ledRun, pitRow, planBridge, planRow, rowModule, setDressPlan, wordCell,
  type BridgeSpot, type RowSpot,
} from './venueDressKit.ts';
import { rosterFor } from '../../partners.ts';
import { LedReel, rotation } from './ledReel.ts';
import { DRESS_BRIDGES } from './dressBridges.ts';

/**
 * Silverstone's own trackside:
 *
 *   the National pits   the old pit complex on the inside of the National Pits Straight, where the
 *                       Grand Prix started until the Wing: a two-storey row (garages, the glazed
 *                       hospitality floor over them under a thin oversailing roof) from Woodcote to
 *                       short of Copse, and the drivers' club's clubhouse, three glazed floors on the inside of
 *                       Woodcote at its head
 *   the bridges         over the Wellington Straight (the title partner — the tyre maker, as at the
 *                       2026 British GP: docs/F1_ADVERTISING.md §2) and the Hangar Straight (the
 *                       series airline's burgundy, the freight yellow behind), both enclosed
 *                       box-girder walkways
 *   the old pits'       the promoter's partners: the tailor, the sports-car maker, the telecom
 *   fascias
 *   LED boards          along the wall in front of the International grandstand on the Hamilton
 *                       Straight, opposite the Wing
 */

interface SilverstonePlan {
  bridges: BridgeSpot[];
  pits: RowSpot | null;
  club: RowSpot | null;
}

/** is the band (sA..sB, `u0`..`u1` m behind the barrier on `side`) clear of the lap, the stands' and props' ground and the fans' banks? */
function bandClear(track: Track, map: WorldMap, banks: SpectatorBank[], sA: number, sB: number, side: number, u0: number, u1: number) {
  const q = new THREE.Vector3();
  for (let s = sA; s <= sB; s += 8)
    for (let u = u0; u <= u1; u += (u1 - u0) / 3) {
      track.point(s, side * (barrierLine(track, s, side) + u), 0, q);
      if (map.trackClearance(q.x, q.z) < 3 || map.excluded(q.x, q.z, 1)) return false;
    }
  for (const b of banks) if (b.side === side && track.delta(b.sA, sB) >= 0 && track.delta(sA, b.sB) >= 0) return false;
  return true;
}

export function planSilverstoneDress(track: Track, map: WorldMap, gs: GrandstandSpec[], banks: SpectatorBank[]) {
  const bridges = DRESS_BRIDGES.silverstone.map((s) => planBridge(track, map, gs, banks, s));
  const wc = track.corners.find((c) => c.name === 'Woodcote');
  const co = track.corners.find((c) => c.name === 'Copse');
  let pits: RowSpot | null = null, club: RowSpot | null = null;
  if (wc && co) {
    // (the inside of the lap is on the right: the old pit lane ran down the right of the straight)
    const sA = wc.sEnd + 45, sB = co.sStart - 85;
    if (sB - sA > 60 && bandClear(track, map, banks, sA, sB, 1, 5, 19)) pits = planRow(track, map, sA, sB, 1, 5, 14);
    const cA = sA - 40, cB = sA - 8;
    if (bandClear(track, map, banks, cA, cB, 1, 8, 28)) club = planRow(track, map, cA, cB, 1, 8, 20);
  }
  setDressPlan<SilverstonePlan>(map, { bridges, pits, club });
}

export function buildSilverstoneDress(track: Track, map: WorldMap): THREE.Group | null {
  const plan = dressPlan<SilverstonePlan>(map);
  if (!plan) return null;
  const R = rosterFor(track.def.id);
  const atlas = new BannerAtlas([
    ['title', 'band', brandWord(R.b('title'), { rules: true, seed: 3 })],
    ['logistics', 'band', brandWord(R.b('logistics'), { seed: 7 })],
    ['airline', 'band', brandWord(R.b('airline'), { seed: 11 })],
    ['silverstone', 'band', wordCell({ text: 'SILVERSTONE', bg: '#012169', fg: '#ffffff', accent: '#c8102e', weight: 900, italic: true, rules: true, track: 0.04, seed: 13 })],
    ['fascia0', 'band', brandCell(R.b('parrish'), false, 21)],
    ['fascia1', 'band', brandCell(R.b('harcourt'), false, 22)],
    ['fascia2', 'band', brandCell(R.b('norvik'), false, 23)],
    ['club', 'board', wordCell({ text: 'SILVERSTONE', bg: '#0e2a1f', fg: '#e8d6a8', weight: 600, track: 0.16, seed: 29 })],
    ['title_p', 'panel', brandCell(R.b('title'), false, 41)],
    ['airline_p', 'panel', brandCell(R.b('airline'), false, 42)],
  ]);
  const d = new Dress(track, map, atlas, new LedReel(rotation(R), 1024, 128));
  const [wellington, hangar] = plan.bridges;
  if (wellington) footbridge(d, wellington, { front: ['title'], back: ['silverstone'], kind: 'box', steel: 0x1b1b1b, tower: 0xc9ccce, towerCells: ['title_p'] });
  if (hangar) footbridge(d, hangar, { front: ['airline'], back: ['logistics'], kind: 'box', steel: 0x4a0a28, tower: 0xc9ccce, towerCells: ['airline_p'] });
  // LED boards in front of the International grandstand (the Wing is on the right)
  ledRun(d, 130, 630, -1, 1.0, ['title'], 3);

  if (plan.pits) pitRow(d, plan.pits, { storeys: 2, wall: 0xdedfdc, trim: 0xf2f2ef, doors: [0x1f2f4f, 0xb7babd, 0x1f2f4f], fascia: ['fascia0', 'fascia1', 'fascia2'] });
  if (plan.club) {
    // the drivers' clubhouse: three glazed floors between white slab bands, set back a little each
    // floor up toward the track, a roof terrace under a canopy, the club's board on the end
    const row = plan.club;
    const { L, len } = rowModule(d, row, row.sA, row.sB);
    const z = (u: number) => row.side * u;
    const span = (u0: number, u1: number): [number, number] => [Math.min(z(u0), z(u1)), Math.max(z(u0), z(u1))];
    const white = srgb(0xf2f2ef), dark = srgb(0x4a4e55);
    const FH = 3.8, x0 = -len / 2, x1 = len / 2;
    d.box(L, x0 - 0.5, -1.2, span(-0.5, row.depth + 0.5)[0], x1 + 0.5, 0.3, span(-0.5, row.depth + 0.5)[1], srgb(0x8f8b84));
    for (let f = 0; f < 3; f++) {
      const y = 0.3 + f * FH, set = 1.5 - f * 0.7;
      const [ga, gb] = span(set + 0.1, row.depth);
      // the glazed floor (interior-mapped rooms), its slab band oversailing it toward the track
      d.glaze(L, row.side > 0 ? x1 : x0, z(set), row.side > 0 ? x0 : x1, z(set), y + 0.1, y + FH - 0.35, new THREE.Vector3(0, 0, -row.side), 7);
      d.box(L, x0, y, ga, x1, y + FH - 0.35, gb, dark, ARCH.PLAIN);
      const [sa, sb] = span(set - 1.2, row.depth + 0.3);
      d.box(L, x0 - 0.4, y + FH - 0.35, sa, x1 + 0.4, y + FH, sb, white, ARCH.RENDER);
      for (let x = x0; x <= x1 + 0.01; x += 1.6) d.box(L, x - 0.05, y, Math.min(z(set - 0.08), z(set + 0.04)), x + 0.05, y + FH - 0.35, Math.max(z(set - 0.08), z(set + 0.04)), white, ARCH.STEEL, true);
    }
    // the roof terrace's canopy on slim posts, a stair core at the back
    const yR = 0.3 + 3 * FH;
    const [ca, cb] = span(-0.6, row.depth * 0.6);
    d.box(L, x0 + 1, yR + 3.0, ca, x1 - 1, yR + 3.3, cb, white, ARCH.RENDER);
    for (const x of [x0 + 2, 0, x1 - 2]) d.box(L, x - 0.08, yR, Math.min(z(0.2), z(0.36)), x + 0.08, yR + 3.0, Math.max(z(0.2), z(0.36)), srgb(0x9aa0a6), ARCH.STEEL, true);
    const [ka, kb] = span(row.depth - 6, row.depth);
    d.box(L, x1 - 7, 0.3, ka, x1 - 1, yR + 3.3, kb, srgb(0xc9ccce), ARCH.CLAD);
    // the club's board on the end the cars come out of Woodcote toward
    const [ba, bb] = span(2, 10);
    d.bannerX(L, ba, bb, yR - 3.2, yR - 1.2, x0 - 0.45, -1, 'club');
  }
  return d.finish('silverstone_dress');
}
