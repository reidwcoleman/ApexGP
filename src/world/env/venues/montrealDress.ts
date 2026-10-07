import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { ARCH } from '../archMaterial.ts';
import { H as PIT_H } from '../../pitlane/building.ts';
import { DB } from './dressBrands.ts';
import { Dress, DressAtlas, brandCell, brandDraw, ledCell, textCell } from './dressKit.ts';
import { mapleLeaf } from './montreal.ts';

/**
 * Circuit Gilles Villeneuve dressed for the Grand Prix du Canada, as the broadcast shows it:
 *
 *   the paddock building   the 2019 building's roof terrace: a thin white canopy on slim columns
 *                          over the top floor, a glass balustrade along its front edge, the
 *                          GRAND PRIX DU CANADA band on the canopy's fascia facing the grid
 *   the Casino straight    the banner gantry over the run down to the final chicane (between the
 *                          footbridge and the braking zone), boards along the river side
 *   the back leg           boards along the outside of the island's long back straight
 *   painted run-off        sponsor logos in the tarmac run-offs at Turn 1, the Senna S, Turn 6,
 *                          the Turn 8 chicane, the hairpin and the final chicane
 *   the walls              (circuits/montreal.ts) sponsor wraps on the walls of the Casino straight
 *                          and the back leg, the white Wall of Champions at the exit of the chicane
 *
 * Red and white for the event, the Québec bank's green, the lager's green, the freight yellow.
 */

/** where the generic trackside also stands something big (footbridges, its corner billboards) */
const MTL_BRIDGES = [3760, 2380];
/** the gantry over the Casino straight (structures.ts keeps its arches clear of it) */
export const MTL_GANTRIES = [4170];

function atlas(): DressAtlas {
  const leaf = (g: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) => {
    // a white square at the left end with the red leaf in it
    g.fillStyle = '#ffffff';
    g.fillRect(x + h * 0.14, y + h * 0.14, h * 0.72, h * 0.72);
    mapleLeaf(g, x + h * 0.5, y + h * 0.53, h * 0.3);
  };
  return new DressAtlas([
    textCell('gp', 'GRAND PRIX DU CANADA', { bg: '#d52b1e', fg: '#ffffff', deco: leaf, indent: 0.9, weight: 900, italic: true }),
    textCell('gpW', 'GRAND PRIX DU CANADA', { bg: '#ffffff', fg: '#d52b1e', top: '#d52b1e', bands: ['#d52b1e'], weight: 900, italic: true }),
    textCell('mtl', 'MONTRÉAL', { bg: '#ffffff', fg: '#d52b1e', sub: 'CIRCUIT GILLES-VILLENEUVE', subFg: '#1a1a1a', weight: 900, track: 0.08 }),
    textCell('gilles', 'SALUT GILLES', { bg: '#c8102e', fg: '#ffffff', sub: '27', subFg: '#ffd400', weight: 900, italic: true }),
    brandCell('watch', DB.watch),
    brandCell('freight', DB.freight),
    brandCell('lager', DB.lager),
    brandCell('tyres', DB.tyres),
    brandCell('cruise', DB.cruise),
    brandCell('airline', DB.airline),
    brandCell('crypto', DB.crypto),
    brandCell('energy', DB.energy),
    brandCell('caisse', DB.caisse),
    brandCell('cafe', DB.cafe),
    brandCell('boreal', DB.boreal),
    brandCell('loto', DB.loto),
    ledCell('ledGp', (g, x, y, w, h) => {
      g.fillStyle = '#d52b1e';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#ffffff';
      g.font = `italic 900 ${Math.round(h * 0.52)}px "Titillium Web", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('CANADA', x + w / 2, y + h / 2);
    }),
    ledCell('ledCaisse', brandDraw(DB.caisse)),
    ledCell('ledLager', brandDraw(DB.lager)),
    ledCell('ledCrypto', brandDraw(DB.crypto)),
  ]);
}

export function buildMontrealDress(track: Track, map: WorldMap, layout: Layout): THREE.Group {
  const d = new Dress(track, map, layout, atlas());
  const L = -1, R = 1;
  const c = (n: string) => d.corner(n);
  const t1 = c('Turn 1'), t2 = c('Virage Senna'), t6 = c('Turn 6'), t8 = c('Turn 8'), hp = c("L'Épingle"), t13 = c('Turn 13');
  // the generic footbridges, start gantry and corner billboards (structures.ts): keep clear of them
  d.keepClear = [...MTL_BRIDGES, ...MTL_GANTRIES, track.startS];
  for (const k of [t1, hp, t13, t8, c('Turn 3')]) if (k) d.keepClear.push(k.sStart - 10);

  // ---------------------------------------------------------------- the paddock building's roof terrace
  {
    const { plan, P, F, BB } = d.pit();
    const top = PIT_H.roofTop;
    const gap: [number, number] = [plan.towerS0 - 5, plan.towerS1 + 5];
    const s0 = plan.bldgS0 + 3, s1 = plan.bldgS1 - 3;
    // the canopy: thin and white, a slight fall to the paddock side, its fascia deeper at the front
    d.pitBlade(d.arch, s0, s1, [[F - 3.4, top + 4.5], [F + 6, top + 4.4], [BB - 1.2, top + 4.1]], 0.35, 0xf2f2ee, [gap], ARCH.STEEL, 0xe4e5e3);
    d.pitBox(d.arch, s0, gap[0], F - 3.6, F - 3.35, top + 3.55, top + 4.55, 0xf4f4f1);
    d.pitBox(d.arch, gap[1], s1, F - 3.6, F - 3.35, top + 3.55, top + 4.55, 0xf4f4f1);
    // the event band on the fascia, facing the grid and the grandstands opposite
    for (const [a, b] of [[s0, gap[0]], [gap[1], s1]] as [number, number][]) if (b - a > 8) d.pitPrint(a + 0.3, b - 0.3, F - 3.62, top + 3.62, top + 4.48, -1, ['gp', 'gpW', 'mtl', 'gp', 'caisse', 'gpW'], 3.6);
    // slim columns on the roof up to the canopy's soffit, clear of the plant (BB − 10 … BB − 6) and the skylights
    const soffit = (l: number) => (l < F + 6 ? top + 4.5 - (0.1 * (l - F + 3.4)) / 9.4 : top + 4.4 - (0.3 * (l - F - 6)) / (BB - 1.2 - F - 6)) - 0.35;
    for (let s = s0 + 4; s < s1 - 2; s += 12) {
      if (s > gap[0] - 1 && s < gap[1] + 1) continue;
      for (const l of [F + 0.6, BB - 3.2]) {
        const q = P(s, l, 0);
        const hh = soffit(l) - top + 0.05;
        d.box(d.arch, q.x, q.y + top + hh / 2, q.z, 0.26, hh, 0.26, 0, 0xe9eae8);
      }
    }
    // the glass balustrade along the roof's front edge, a steel top rail
    for (const [a, b] of [[plan.bldgS0, gap[0]], [gap[1], plan.bldgS1]] as [number, number][]) {
      d.pitBox(d.arch, a, b, F - 1.32, F - 1.26, top, top + 1.05, 0x5d717d, ARCH.PLAIN);
      d.pitBox(d.fine, a, b, F - 1.36, F - 1.22, top + 1.05, top + 1.12, 0xc8ccd0);
    }
  }

  // ---------------------------------------------------------------- the Casino straight
  d.gantry({ s: MTL_GANTRIES[0], cells: ['gp', 'lager', 'gp', 'freight', 'gp'], back: ['mtl', 'caisse', 'mtl'], y0: 6.6, h: 1.8 });
  // boards along the river side of the straight, the lager and the Québec bank holding long runs
  // (LED boards out of the hairpin, where the cameras on the exit look back)
  d.hoardings({ sA: 3470, sB: 3700, side: R, off: 5.2, cells: ['ledGp', 'ledCaisse', 'ledLager', 'ledCrypto'], run: 2, led: true, y0: 1.3, h: 1.2 });
  d.hoardings({ sA: 3720, sB: 4420, side: R, off: 5.2, cells: ['lager', 'caisse', 'freight', 'watch', 'cafe', 'gp', 'boreal'], run: 3 });

  // ---------------------------------------------------------------- the back leg
  d.hoardings({ sA: 2030, sB: 2660, side: R, off: 5.2, cells: ['crypto', 'tyres', 'loto', 'airline', 'energy', 'cruise'], run: 3 });
  if (t2) d.hoardings({ sA: t2.sEnd + 30, sB: t2.sEnd + 330, side: R, off: 5.2, cells: ['cafe', 'gilles', 'boreal', 'watch'], run: 2 });

  // ---------------------------------------------------------------- painted run-off
  if (t1 && t2) d.logos(t1.sStart - 30, t2.sStart, R, ['gp', 'lager', 'freight'], 30, 18);
  if (t2) d.logos(t2.sApex, t2.sEnd + 60, L, ['caisse', 'gpW'], 30, 16);
  if (t6) d.logos(t6.sStart - 60, t6.sEnd, R, ['crypto'], 34, 14);
  if (t8) d.logos(t8.sStart - 70, t8.sEnd + 10, L, ['tyres', 'gp'], 30, 16);
  if (hp) d.logos(hp.sStart - 90, hp.sEnd + 20, L, ['lager', 'gp', 'watch', 'freight'], 26, 20);
  if (t13) d.logos(t13.sStart - 80, t13.sEnd, L, ['gpW', 'caisse'], 30, 16);

  // ---------------------------------------------------------------- a billboard at the end of the Turn 6 run-off
  if (t6) d.billboard(t6.sStart + 5, R, 7, 12, 3, 2.2, 'gpW', t6.sStart - 90);

  return d.build('MontrealDress');
}
