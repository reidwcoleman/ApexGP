import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { ARCH } from '../archMaterial.ts';
import { H as PIT_H } from '../../pitlane/building.ts';
import { rosterFor, type Roster } from '../../partners.ts';
import { LedReel, rotation } from './ledReel.ts';
import { Dress, DressAtlas, brandCell, textCell, titleCell, type DressCell } from './dressKit.ts';

/**
 * The Red Bull Ring dressed for the Grosser Preis von Österreich: a circuit owned by an energy
 * drink, so its navy-and-silver (here a fictional TAURO) is on everything the broadcast sees —
 *
 *   the pit building   a graphite steel roof blade sweeping up toward the track over the top
 *                      floor, a red band along its leading edge, raked struts under it
 *   Turn 1 / Remus /   the huge tarmac run-offs painted with the drink's logos (Remus's facing the
 *   Schlossgold        cars climbing to it), a big board at the end of Remus's run-off
 *   the hill           the gantry over the run from Remus down to Schlossgold, boards along the
 *                      kink at Turn 2, through Turn 5 and the valley at Turn 8 (the banks of fans
 *                      everywhere else stand right at the fence)
 *
 * The event's red-white-red; the race's title partner (the laptop maker, as in 2026:
 * docs/F1_ADVERTISING.md §2, §4) on the banners, the gantry and the first run-off beside the
 * owner's drink; the Styrian tourism board's green, the Austrian bank's yellow.
 */

const RBR_BRIDGES = [1330, 2330];
export const RBR_GANTRIES = [2060];

function atlas(R: Roster): { atlas: DressAtlas; reel: LedReel } {
  const rwr = ['#c8102e', '#ffffff', '#c8102e'];
  const atlas = new DressAtlas([
    titleCell('gp', R.title, 'GROSSER PREIS VON ÖSTERREICH', { bg: '#ffffff', fg: '#1b2b5a', accent: '#1b2b5a', bands: rwr }),
    textCell('spielberg', 'SPIELBERG', { bg: '#1b2b5a', fg: '#ffffff', sub: 'STEIERMARK · AUSTRIA', subFg: '#c9d1dc', weight: 900, italic: true, track: 0.06 }),
    textCell('ring', 'THE RING', { bg: '#c8102e', fg: '#ffffff', top: '#ffffff', bands: ['#ffffff'], weight: 900, italic: true, track: 0.12 }),
    brandCell('title', R.b('title')),
    brandCell('bull', R.b('energyDrink')),
    brandCell('bullS', R.b('energyDrink'), 512, 128, true),
    brandCell('bullM', R.b('tauro')),
    brandCell('watch', R.b('timing')),
    brandCell('freight', R.b('logistics')),
    brandCell('tyres', R.b('tyres')),
    brandCell('cruise', R.b('cruise')),
    brandCell('crypto', R.b('crypto')),
    brandCell('cloud', R.b('cloud')),
    brandCell('styria', R.b('steiermark')),
    brandCell('alpbank', R.b('alpenbank')),
    brandCell('alpcom', R.b('alpcom')),
    brandCell('airline', R.b('airline')),
  ]);
  return { atlas, reel: new LedReel(rotation(R)) };
}

export function buildSpielbergDress(track: Track, map: WorldMap, layout: Layout): THREE.Group {
  const partners = rosterFor(track.def.id);
  const dressing = atlas(partners);
  const d = new Dress(track, map, layout, dressing.atlas, dressing.reel);
  const L = -1, R = 1;
  const c = (n: string) => d.corner(n);
  const t1 = c('Niki Lauda'), t2 = c('Turn 2'), t3 = c('Remus'), t4 = c('Schlossgold'), t5 = c('Turn 5'), t8 = c('Turn 8');
  d.keepClear = [...RBR_BRIDGES, ...RBR_GANTRIES, track.startS];
  for (const k of [t1, t3, t4, c('Red Bull Mobile'), c('Rauch')]) if (k) d.keepClear.push(k.sStart - 10);

  // ---------------------------------------------------------------- the pit building's roof blade
  {
    const { plan, P, F, BB } = d.pit();
    const top = PIT_H.roofTop;
    const gap: [number, number] = [plan.towerS0 - 5, plan.towerS1 + 5];
    const s0 = plan.bldgS0 + 1, s1 = plan.bldgS1 - 1;
    // section: the leading edge reaches out over the apron and lifts, the back settles toward the paddock
    const prof: [number, number][] = [[F - 8.5, top + 6.0], [F - 5, top + 5.3], [F, top + 4.8], [F + 8, top + 4.5], [BB - 1, top + 4.1]];
    d.pitBlade(d.arch, s0, s1, prof, 0.55, 0x3d4147, [gap], ARCH.STEEL, 0x2a2d32);
    // the red band on the leading edge, and the event's lettering on it
    for (const [a, b] of [[s0, gap[0]], [gap[1], s1]] as [number, number][]) {
      if (b - a < 8) continue;
      d.pitBox(d.arch, a, b, F - 8.75, F - 8.5, top + 5.15, top + 6.15, 0xc8102e);
      d.pitPrint(a + 0.4, b - 0.4, F - 8.77, top + 5.22, top + 6.08, -1, ['spielberg', 'bull', 'gp', 'bullS', 'spielberg', 'ring'], 3.5);
    }
    // raked struts from the roof up to the blade, and back columns
    for (let s = s0 + 5; s < s1 - 3; s += 10) {
      if (s > gap[0] - 1 && s < gap[1] + 1) continue;
      d.bar(d.arch, P(s, F - 1.0, top), P(s - 2.5, F - 4.5, top + 4.95), 0.28, 0x2a2d32);
      d.bar(d.arch, P(s, F - 1.0, top), P(s + 2.5, F - 4.5, top + 4.95), 0.28, 0x2a2d32);
      const q = P(s, BB - 3, 0);
      d.box(d.arch, q.x, q.y + top + 1.95, q.z, 0.3, 3.9, 0.3, 0, 0x2a2d32);
    }
  }

  // ---------------------------------------------------------------- the hill
  d.gantry({ s: RBR_GANTRIES[0], cells: ['bull', 'title', 'bull'], back: ['gp', 'spielberg', 'gp'], y0: 6.6, h: 1.8, steel: 0x1f2a44 });
  if (t2) d.hoardings({ sA: t2.sStart - 160, sB: t2.sEnd + 60, side: R, off: 5.0, cells: ['title', 'bull', 'styria', 'bullS', 'freight', 'alpbank'], run: 3 });
  if (t5) d.hoardings({ sA: t5.sStart - 40, sB: t5.sEnd + 20, side: R, off: 5.0, cells: ['title'], run: 3, led: true, y0: 1.3, h: 1.2 });
  if (t8) d.hoardings({ sA: t8.sStart - 120, sB: t8.sEnd + 80, side: R, off: 5.0, cells: ['bullM', 'tyres', 'alpcom', 'crypto', 'cloud'], run: 3 });

  // ---------------------------------------------------------------- painted run-off
  if (t1) d.logos(t1.sStart - 30, t1.sEnd + 40, L, ['title', 'bull', 'gp', 'bullS', 'tyres'], 28, 22);
  if (t3) d.logos(t3.sStart - 40, t3.sEnd + 30, L, ['bull', 'bullS', 'spielberg'], 26, 22, true);
  if (t4) d.logos(t4.sStart - 30, t4.sEnd + 30, L, ['bullM', 'freight', 'bull'], 28, 20);

  // ---------------------------------------------------------------- the board at the end of Remus's run-off, looking down the climb
  if (t3) d.billboard(t3.sApex + 10, L, 9, 14, 3.5, 2.4, 'bull', t3.sStart - 140);
  if (t1) d.billboard(t1.sApex + 30, L, 8, 12, 3, 2.2, 'bullS', t1.sStart - 120);

  return d.build('SpielbergDress');
}
