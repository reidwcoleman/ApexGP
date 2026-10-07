import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { DB } from './dressBrands.ts';
import { Dress, DressAtlas, brandCell, brandDraw, ledCell, textCell } from './dressKit.ts';

/**
 * Interlagos dressed for the Grande Prêmio de São Paulo:
 *
 *   the Subida dos Boxes   a line of big boards on frames up the infield bank beside the climb
 *                          from Junção to the line, each turned to the cars coming up the hill
 *   the S do Senna         the painted tarmac run-off on the outside of the plunge into Turn 1
 *   the Reta Oposta        the banner gantry before the Descida do Lago, boards down the infield
 *                          side of the straight
 *   the infield            painted run-off at Pinheirinho, Bico de Pato and Junção
 *
 * The event's green and yellow, the Paulista bank's orange, the lager's green, Senna's yellow.
 */

export const INT_GANTRIES = [2480];
const INT_BRIDGES = [2240, 440];

function atlas(): DressAtlas {
  const br = ['#009c3b', '#ffdf00', '#002776'];
  return new DressAtlas([
    textCell('gp', 'GRANDE PRÊMIO DE SÃO PAULO', { bg: '#009c3b', fg: '#ffdf00', bands: br, weight: 900, italic: true }),
    textCell('gpY', 'GRANDE PRÊMIO DE SÃO PAULO', { bg: '#ffdf00', fg: '#002776', top: '#009c3b', weight: 900, italic: true }),
    textCell('sp', 'SÃO PAULO', { bg: '#002776', fg: '#ffffff', sub: 'AUTÓDROMO JOSÉ CARLOS PACE', subFg: '#ffdf00', weight: 900, track: 0.06 }),
    textCell('interlagos', 'INTERLAGOS', { bg: '#ffdf00', fg: '#009c3b', bands: ['#009c3b', '#002776'], weight: 900, italic: true, track: 0.06 }),
    textCell('senna', 'SENNA SEMPRE', { bg: '#ffd400', fg: '#12306e', top: '#00843d', bands: ['#00843d', '#12306e'], weight: 900, italic: true }),
    brandCell('lager', DB.lager),
    brandCell('cruise', DB.cruise),
    brandCell('freight', DB.freight),
    brandCell('watch', DB.watch),
    brandCell('tyres', DB.tyres),
    brandCell('crypto', DB.crypto),
    brandCell('laptop', DB.laptop),
    brandCell('airline', DB.airline),
    brandCell('banco', DB.itapua),
    brandCell('petro', DB.petrosul),
    brandCell('bank', DB.bank),
    ledCell('ledGp', (g, x, y, w, h) => {
      g.fillStyle = '#009c3b';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#ffdf00';
      g.font = `italic 900 ${Math.round(h * 0.5)}px "Titillium Web", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('BRASIL', x + w / 2, y + h / 2);
    }),
    ledCell('ledBanco', brandDraw(DB.itapua)),
    ledCell('ledLager', brandDraw(DB.lager)),
  ]);
}

export function buildInterlagosDress(track: Track, map: WorldMap, layout: Layout): THREE.Group {
  const d = new Dress(track, map, layout, atlas());
  const L = -1, R = 1;
  const c = (n: string) => d.corner(n);
  const ju = c('Junção'), ss = c('S do Senna'), t2 = c('Turn 2'), pin = c('Pinheirinho'), bp = c('Bico de Pato'), dl = c('Descida do Lago');
  d.keepClear = [...INT_BRIDGES, ...INT_GANTRIES, track.startS];
  for (const k of [ss, dl, bp, ju, c('Ferradura')]) if (k) d.keepClear.push(k.sStart - 10);

  // ---------------------------------------------------------------- the Subida dos Boxes: big boards up the infield bank
  {
    const cells = ['gp', 'lager', 'banco', 'interlagos', 'cruise', 'petro', 'senna', 'freight', 'sp', 'watch'];
    let k = 0;
    for (let s = 330; s <= 930; s += 55) {
      // turned toward the cars ~120 m down the hill
      if (d.billboard(s, L, 8, 12, 3, 2.6, cells[k % cells.length], s - 120, 2)) k++;
    }
  }

  // ---------------------------------------------------------------- the S do Senna and the Reta Oposta
  if (ss && t2) d.logos(ss.sStart - 40, t2.sStart, R, ['gp', 'lager', 'banco', 'senna'], 26, 24);
  d.gantry({ s: INT_GANTRIES[0], cells: ['gp', 'lager', 'gp'], back: ['sp', 'banco', 'sp'], y0: 6.6, h: 1.8, steel: 0x1d2a20 });
  d.hoardings({ sA: 1990, sB: 2460, side: L, off: 5.2, cells: ['banco', 'cruise', 'petro', 'crypto', 'laptop', 'airline', 'gpY'], run: 3 });
  if (dl) d.hoardings({ sA: dl.sEnd + 10, sB: dl.sEnd + 220, side: L, off: 5.2, cells: ['ledGp', 'ledBanco', 'ledLager'], run: 2, led: true, y0: 1.3, h: 1.2 });

  // ---------------------------------------------------------------- the infield and Junção
  if (pin) d.logos(pin.sStart - 20, pin.sEnd + 40, R, ['petro', 'gpY'], 30, 16);
  if (bp) d.logos(bp.sStart - 30, bp.sEnd + 30, L, ['tyres', 'bank'], 30, 16);
  if (ju) d.logos(ju.sStart - 40, ju.sEnd + 40, R, ['gp', 'interlagos', 'lager'], 28, 18);

  return d.build('InterlagosDress');
}
