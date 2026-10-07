import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { ARCH } from '../archMaterial.ts';
import { H as PIT_H } from '../../pitlane/building.ts';
import { DB } from './dressBrands.ts';
import { Dress, DressAtlas, brandCell, brandDraw, ledCell, textCell } from './dressKit.ts';

/**
 * Zandvoort dressed for the Dutch Grand Prix: orange on everything the broadcast sees.
 *
 *   the pit building   the glazed Paddock Club pavilion on the roof (interior-mapped glass on
 *                      four sides, a white roof slab), the orange DUTCH GRAND PRIX fascia along its
 *                      front, a glass balustrade round the terrace in front of it
 *   the main straight  the orange banner gantry at the end of the straight, over the braking zone
 *                      into Tarzan; boards along the start of the straight out of the banking
 *   Tarzan             boards round the inside of the hairpin, looking out at the big stands
 *   the dunes          boards through the T9/T10 loop (the dune banks of the Orange Army stand
 *                      at the fence everywhere else)
 *   painted run-off    logos in the tarmac run-off on the exit of the Hans Ernst chicane
 *
 * Orange and the Dutch red-white-blue for the event, the lager's green (a Dutch brewer's
 * home race), the supermarket's yellow, the flag carrier's sky blue.
 */

export const ZVT_GANTRIES = [930];
const ZVT_BRIDGES = [1690, 3480];

function atlas(): DressAtlas {
  const nl = ['#ae1c28', '#ffffff', '#21468b'];
  return new DressAtlas([
    textCell('gp', 'DUTCH GRAND PRIX', { bg: '#ff6a00', fg: '#ffffff', bands: nl, weight: 900, italic: true }),
    textCell('gpW', 'DUTCH GRAND PRIX', { bg: '#ffffff', fg: '#ff6a00', top: '#ff6a00', bands: nl, weight: 900, italic: true }),
    textCell('zandvoort', 'ZANDVOORT', { bg: '#21468b', fg: '#ffffff', sub: 'CIRCUIT · AAN ZEE', subFg: '#ffb27a', weight: 900, track: 0.08 }),
    textCell('oranje', 'HUP HOLLAND HUP', { bg: '#ff7b00', fg: '#101216', weight: 900, italic: true }),
    textCell('orange', 'ORANJE', { bg: '#101216', fg: '#ff7b00', weight: 900, italic: true, track: 0.1 }),
    brandCell('lager', DB.lager),
    brandCell('duinbank', DB.oranje),
    brandCell('groot', DB.grootmarkt),
    brandCell('noordzee', DB.noordzee),
    brandCell('watch', DB.watch),
    brandCell('freight', DB.freight),
    brandCell('tyres', DB.tyres),
    brandCell('crypto', DB.crypto),
    brandCell('cruise', DB.cruise),
    brandCell('cloud', DB.cloud),
    ledCell('ledGp', (g, x, y, w, h) => {
      g.fillStyle = '#ff6a00';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#ffffff';
      g.font = `italic 900 ${Math.round(h * 0.5)}px "Titillium Web", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ZANDVOORT', x + w / 2, y + h / 2);
    }),
    ledCell('ledLager', brandDraw(DB.lager)),
    ledCell('ledDuin', brandDraw(DB.oranje)),
  ]);
}

export function buildZandvoortDress(track: Track, map: WorldMap, layout: Layout): THREE.Group {
  const d = new Dress(track, map, layout, atlas());
  const R = 1;
  const c = (n: string) => d.corner(n);
  const t1 = c('Tarzanbocht'), he = c('Hans Ernstbocht'), t13 = c('Turn 13'), t9 = c('Turn 9'), t10 = c('Turn 10');
  d.keepClear = [...ZVT_BRIDGES, ...ZVT_GANTRIES, track.startS];
  for (const k of [t1, c('Hugenholtzbocht'), c('Mastersbocht'), he, c('Kumhobocht')]) if (k) d.keepClear.push(k.sStart - 10);
  d.glassTint = 0x2a3a46;

  // ---------------------------------------------------------------- the Paddock Club pavilion on the roof
  {
    const { plan, P, F } = d.pit();
    const top = PIT_H.roofTop;
    const gap: [number, number] = [plan.towerS0 - 5, plan.towerS1 + 5];
    const l0 = F + 0.6, l1 = F + 9.4, hh = 3.7;
    const runs: [number, number][] = [[plan.bldgS0 + 18, gap[0]], [gap[1], plan.bldgS1 - 18]];
    for (const [a, b] of runs) {
      if (b - a < 12) continue;
      // glass all round (rooms behind it), mullions every 1.5 m
      const pane = (sA: number, sB: number, lA: number, lB: number, out: THREE.Vector3, al0: number, al1: number) => {
        const A = P(sA, lA, top + 0.15), B = P(sB, lB, top + 0.15), C = P(sB, lB, top + hh), D = P(sA, lA, top + hh);
        d.rooms.quad(A, B, C, D, out, al0, al1, A.y, C.y, 6);
      };
      const n = Math.max(1, Math.ceil((b - a) / 6));
      for (let k = 0; k < n; k++) {
        const sa = a + ((b - a) * k) / n, sb = a + ((b - a) * (k + 1)) / n;
        pane(sa, sb, l0, l0, P(sa, l0 - 1, 0).sub(P(sa, l0, 0)), sa, sb);
        pane(sa, sb, l1, l1, P(sa, l1 + 1, 0).sub(P(sa, l1, 0)), sa, sb);
      }
      pane(a, a, l0, l1, P(a - 1, l0, 0).sub(P(a, l0, 0)), l0, l1);
      pane(b, b, l0, l1, P(b + 1, l0, 0).sub(P(b, l0, 0)), l0, l1);
      for (let s = a; s <= b + 0.01; s += 1.5) {
        d.pitBox(d.fine, s - 0.04, s + 0.04, l0 - 0.08, l0 + 0.02, top, top + hh, 0xe8e8e6);
        d.pitBox(d.fine, s - 0.04, s + 0.04, l1 - 0.02, l1 + 0.08, top, top + hh, 0xe8e8e6);
      }
      // the roof slab, overhanging the terrace, and the orange fascia with the event on it
      d.pitBox(d.arch, a - 1.2, b + 1.2, l0 - 2.4, l1 + 0.8, top + hh, top + hh + 0.4, 0xf1f1ee, ARCH.CONCRETE);
      d.pitBox(d.arch, a - 1.2, b + 1.2, l0 - 2.62, l0 - 2.4, top + hh - 0.5, top + hh + 0.55, 0xff6a00);
      d.pitPrint(a - 1.0, b + 1.0, l0 - 2.64, top + hh - 0.42, top + hh + 0.47, -1, ['gp', 'zandvoort', 'gp', 'duinbank', 'gp', 'lager'], 4);
    }
    // the terrace's glass balustrade along the roof's front edge
    for (const [a, b] of [[plan.bldgS0, gap[0]], [gap[1], plan.bldgS1]] as [number, number][]) {
      d.pitBox(d.arch, a, b, F - 1.32, F - 1.26, top, top + 1.05, 0x5d717d, ARCH.PLAIN);
      d.pitBox(d.fine, a, b, F - 1.36, F - 1.22, top + 1.05, top + 1.12, 0xc8ccd0);
    }
  }

  // ---------------------------------------------------------------- the main straight
  d.gantry({ s: ZVT_GANTRIES[0], cells: ['gp', 'lager', 'gp'], back: ['zandvoort', 'oranje', 'zandvoort'], y0: 6.6, h: 1.8, steel: 0xd9dadc });
  d.hoardings({ sA: 300, sB: 432, side: R, off: 5.2, cells: ['ledGp', 'ledLager', 'ledDuin'], run: 2, led: true, y0: 1.3, h: 1.2 });
  // round the inside of Tarzan, looking out at the stands on the dune
  if (t1) d.hoardings({ sA: t1.sStart - 20, sB: t1.sEnd + 80, side: R, off: 5.0, cells: ['oranje', 'groot', 'gp', 'noordzee', 'freight', 'orange'], run: 2 });
  // the loop through Turns 9 and 10
  if (t9 && t10) d.hoardings({ sA: t9.sStart - 80, sB: t10.sEnd + 120, side: R, off: 5.0, cells: ['duinbank', 'watch', 'tyres', 'crypto', 'cruise', 'cloud', 'gpW'], run: 3 });

  // ---------------------------------------------------------------- painted run-off
  if (t13) d.logos(t13.sStart - 20, t13.sEnd + 60, R, ['gp', 'duinbank', 'lager'], 28, 18);

  return d.build('ZandvoortDress');
}
