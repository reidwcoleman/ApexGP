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
 * The Circuit of the Americas dressed for the United States Grand Prix:
 *
 *   the pit building   the Paddock Club's white roof blade reaching out over the pit lane, a
 *                      screen of white vertical fins under its leading edge (the terrace's sun
 *                      screen), the event's band on its fascia
 *   Turn 1             the enormous painted run-off at the top of the hill — logos the size of a
 *                      tennis court — and a big board at its far end facing the climb
 *   the back straight  the banner gantry before the stadium section, boards down both sides
 *   the stadium        painted run-off at Turns 11, 12, 15 and 19–20, big boards at the end of the
 *                      Turn 11 and Turn 12 run-offs
 *   the T9/T10 crest   boards along the outside of the climb
 *
 * Red, white and navy for the event and Texas; the cruise line's navy and gold as the race's title
 * partner (as in 2025–26: docs/F1_ADVERTISING.md §2) at the top of Turn 1, on the gantry and the
 * back straight; the truck maker's navy and burnt orange, the US rights holder's streaming blue.
 */

export const COTA_GANTRIES = [3780];
const COTA_BRIDGES = [3380];

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string) {
  g.fillStyle = col;
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.4 : r;
    k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function atlas(R: Roster): { atlas: DressAtlas; reel: LedReel } {
  const usa = ['#b22234', '#ffffff', '#b22234'];
  const lone = (g: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) => {
    g.fillStyle = '#002868';
    g.fillRect(x, y, h * 1.0, h);
    star(g, x + h * 0.5, y + h * 0.5, h * 0.3, '#ffffff');
  };
  // the event's own LED slide, in the reel after the title partner's
  const ledGp: DressCell['draw'] = (g, x, y, w, h) => {
    g.fillStyle = '#0b1f4b';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#b22234';
    g.fillRect(x, y + h * 0.82, w, h * 0.18);
    g.fillStyle = '#ffffff';
    g.font = `italic 900 ${Math.round(h * 0.48)}px "Titillium Web", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('USGP', x + w / 2, y + h * 0.42);
  };
  const atlas = new DressAtlas([
    titleCell('gp', R.title, 'UNITED STATES GRAND PRIX', { bg: '#0b1f4b', fg: '#ffffff', accent: '#ffffff', bands: usa }),
    textCell('gpR', 'UNITED STATES GRAND PRIX', { bg: '#b22234', fg: '#ffffff', top: '#ffffff', weight: 900, italic: true }),
    textCell('austin', 'AUSTIN', { bg: '#ffffff', fg: '#0b1f4b', sub: 'TEXAS · USA', subFg: '#b22234', weight: 900, track: 0.1 }),
    textCell('cota', 'CIRCUIT OF THE AMERICAS', { bg: '#c62026', fg: '#ffffff', weight: 900, track: 0.02 }),
    textCell('texas', 'TEXAS', { bg: '#ffffff', fg: '#bf0a30', deco: lone, indent: 1.0, weight: 900, italic: true, track: 0.12, bands: ['#bf0a30'] }),
    brandCell('watch', R.b('timing')),
    brandCell('freight', R.b('logistics')),
    brandCell('lager', R.b('lager')),
    brandCell('tyres', R.b('tyres')),
    brandCell('cruise', R.b('cruise')),
    brandCell('crypto', R.b('crypto')),
    brandCell('cloud', R.b('cloud')),
    brandCell('energy', R.b('energy')),
    brandCell('crm', R.b('mesa')),
    brandCell('trucks', R.b('longhorn')),
    brandCell('stream', R.b('skyreach')),
    brandCell('laptop', R.b('tech')),
    brandCell('airline', R.b('airline')),
  ]);
  return { atlas, reel: new LedReel(rotation(R, [['ledGp', ledGp]])) };
}

export function buildAustinDress(track: Track, map: WorldMap, layout: Layout): THREE.Group {
  const partners = rosterFor(track.def.id);
  const dressing = atlas(partners);
  const d = new Dress(track, map, layout, dressing.atlas, dressing.reel);
  const L = -1, R = 1;
  const c = (n: string) => d.corner(n);
  const t1 = c('Turn 1'), t2 = c('Turn 2'), t9 = c('Turn 9'), t10 = c('Turn 10'), t11 = c('Turn 11'), t12 = c('Turn 12');
  const t15 = c('Turn 15'), t19 = c('Turn 19'), t20 = c('Turn 20');
  d.keepClear = [...COTA_BRIDGES, ...COTA_GANTRIES, track.startS];
  for (const k of [t15, t19]) if (k) d.keepClear.push(k.sStart - 10);

  // ---------------------------------------------------------------- the Paddock Club's roof blade
  {
    const { plan, P, F, BB } = d.pit();
    const top = PIT_H.roofTop;
    const gap: [number, number] = [plan.towerS0 - 5, plan.towerS1 + 5];
    const s0 = plan.bldgS0 + 1, s1 = plan.bldgS1 - 1;
    const prof: [number, number][] = [[F - 6, top + 4.8], [F + 2, top + 4.5], [BB - 1, top + 4.2]];
    const bladeAt = (l: number) => (l < F + 2 ? top + 4.8 - (0.3 * (l - F + 6)) / 8 : top + 4.5 - (0.3 * (l - F - 2)) / (BB - 1 - F - 2));
    d.pitBlade(d.arch, s0, s1, prof, 0.6, 0xf4f4f1, [gap], ARCH.STEEL, 0xe6e7e6);
    for (const [a, b] of [[s0, gap[0]], [gap[1], s1]] as [number, number][]) {
      if (b - a < 8) continue;
      // the fascia and its band
      d.pitBox(d.arch, a, b, F - 6.22, F - 6, top + 3.9, top + 4.85, 0xf4f4f1);
      d.pitPrint(a + 0.4, b - 0.4, F - 6.24, top + 3.98, top + 4.78, -1, ['gp', 'austin', 'cota', 'gp', 'texas', 'trucks'], 3.2);
      // the fin screen under the leading edge
      for (let s = a + 1; s < b - 0.5; s += 1.8) d.pitBox(d.arch, s - 0.06, s + 0.06, F - 5.6, F - 1.9, top + 1.2, bladeAt(F - 1.9) - 0.55, 0xf0f0ed);
    }
    // columns: round the front of the terrace and at the back, clear of the plant
    for (let s = s0 + 5; s < s1 - 3; s += 12) {
      if (s > gap[0] - 1 && s < gap[1] + 1) continue;
      for (const l of [F - 1.0, BB - 3]) {
        const q = P(s, l, 0);
        const hh = bladeAt(l) - 0.6 - top + 0.05;
        d.box(d.arch, q.x, q.y + top + hh / 2, q.z, 0.34, hh, 0.34, 0, 0xdedfdd);
      }
    }
  }

  // ---------------------------------------------------------------- Turn 1
  if (t1 && t2) d.logos(t1.sStart - 30, t2.sStart, R, ['cruise', 'freight', 'texas', 'gp', 'trucks', 'tyres'], 26, 26);
  if (t1) d.billboard(t1.sApex + 25, R, 8, 14, 3.5, 2.4, 'cota', t1.sStart - 160);

  // ---------------------------------------------------------------- the back straight and the stadium
  d.gantry({ s: COTA_GANTRIES[0], cells: ['gp', 'cruise', 'gp'], back: ['austin', 'stream', 'austin'], y0: 6.6, h: 1.8, steel: 0xe8e9eb });
  if (t11 && t12) {
    d.hoardings({ sA: t11.sEnd + 60, sB: t12.sStart - 210, side: R, off: 5.2, cells: ['cruise', 'crypto', 'trucks', 'crm', 'cloud', 'airline', 'energy'], run: 3 });
    d.hoardings({ sA: t11.sEnd + 190, sB: t12.sStart - 20, side: L, off: 5.2, cells: ['title'], run: 2, led: true, y0: 1.3, h: 1.2 });
  }
  if (t11) d.logos(t11.sStart - 30, t11.sEnd + 20, R, ['gpR', 'laptop'], 28, 20);
  if (t12) d.logos(t12.sStart - 40, t12.sEnd + 20, R, ['crypto', 'gp', 'tyres'], 28, 22);
  if (t15) d.logos(t15.sStart - 10, t15.sEnd + 20, R, ['stream', 'texas'], 30, 18);
  if (t19) d.logos(t19.sStart - 20, t19.sEnd + 20, R, ['trucks'], 30, 16);
  if (t20) d.logos(t20.sStart - 20, t20.sEnd + 20, R, ['gpR', 'watch'], 30, 16);
  if (t11) d.billboard(t11.sApex + 12, R, 9, 12, 3, 2.2, 'gp', t11.sStart - 130);
  if (t12) d.billboard(t12.sApex + 15, R, 9, 14, 3.5, 2.4, 'trucks', t12.sStart - 160);

  // ---------------------------------------------------------------- the T9/T10 crest
  if (t9 && t10) d.hoardings({ sA: t9.sEnd + 20, sB: t10.sStart + 10, side: L, off: 5.2, cells: ['watch', 'cruise', 'freight', 'austin'], run: 3 });

  return d.build('AustinDress');
}
