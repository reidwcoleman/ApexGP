import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec } from '../layout.ts';
import { printWear } from '../../brands.ts';
import { EVENT } from '../../event.ts';
import { rosterFor, type Roster } from '../../partners.ts';
import { AdSheet, VenueAds, brandCell, paintCell, reserveAds, titleCell, type AdBoard, type AdPainter, type AdRun } from './venueAds.ts';
import { LedReel, rotation } from './ledReel.ts';

/**
 * The race weekend's own boards at Albert Park, the Autódromo Hermanos Rodríguez, Sakhir and Yas
 * Marina (venueAds.ts builds them): each Grand Prix's title partner, the series partners and the
 * promoter's local partners (partners.ts — all fictional, in the colour blocks of the real boards)
 * where the TV picture shows them (docs/F1_ADVERTISING.md):
 *
 *   Melbourne   LED boards along the foot of the Fangio and Brabham stands, printed hoardings
 *               round the backs of the gravel traps at Turns 1, 3, 6, 9–10, 11 and 13 — the title
 *               airline's burgundy in every run (§2: the title partner's branding "throughout"),
 *               the harbour lager's green, the series' freight yellow
 *   Mexico      no title partner: the city's own Gran Premio "presented by" the lager; LED boards
 *               down the 1.2 km main straight, the rosa mexicano everywhere (the stadium's walls in
 *               front of the Foro Sol's stands, the hoardings at Turn 1), the promoter's telecom,
 *               beer and bank, big painted word marks on the asphalt run-offs at Turns 1, 4, 6, 12
 *   Sakhir      the national airline's navy and gold as title partner, Bahrain's serrated red and
 *               white, LED boards in front of the Main Grandstand, painted word marks in every big
 *               run-off (Turns 1, 4, 8, 10, 11, 13, 14), hoardings round Turn 1
 *   Yas Marina  the national airline's champagne and gold as title partner, the state energy
 *               company's blue, LED boards along the Main Grandstand, painted run-offs at
 *               Turns 1, 5, 7, 8, 11, 14
 *
 * The title partner takes the first corner's paint and the most boards; the series partners hold
 * the camera positions; the LED boards roll through the partners together (ledReel.ts).
 *
 * `reserveVenueAds` keeps the trees off the boards (called from the venue's plan, before the
 * woods grow); `buildVenueAds` builds them (from its scenery). Both read the same plan.
 */

/** Bahrain's own board: white, the flag's red serrated edge, the name in English and Arabic */
const bahrainCell: AdPainter = (g, x, y, w, h) => {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#ce1126';
  const band = w * 0.18;
  g.beginPath();
  g.moveTo(x + w, y);
  g.lineTo(x + w - band, y);
  for (let k = 0; k < 5; k++) {
    g.lineTo(x + w - band - h * 0.16, y + (h * (k + 0.5)) / 5);
    g.lineTo(x + w - band, y + (h * (k + 1)) / 5);
  }
  g.lineTo(x + w, y + h);
  g.closePath();
  g.fill();
  g.fillStyle = '#ce1126';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `italic 900 ${Math.round(h * 0.5)}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
  g.fillText('BAHRAIN', x + (w - band) * 0.36, y + h * 0.52);
  g.font = `700 ${Math.round(h * 0.42)}px "Geeza Pro", "Noto Naskh Arabic", "Arial", sans-serif`;
  g.fillText('البحرين', x + (w - band) * 0.8, y + h * 0.5);
  g.restore();
  printWear(g, x, y, w, h, 77, 0.6);
};

/** the Gran Premio's rosa mexicano, papel picado along the top */
const mexicoCell: AdPainter = (g, x, y, w, h) => {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#e6007e';
  g.fillRect(x, y, w, h);
  const cols = ['#00a19a', '#ffd400', '#ff6a13', '#7b2ca8'];
  for (let k = 0; k * 32 < w; k++) {
    g.fillStyle = cols[k % cols.length];
    g.beginPath();
    g.moveTo(x + k * 32, y);
    g.lineTo(x + k * 32 + 32, y);
    g.lineTo(x + k * 32 + 16, y + h * 0.16);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = `italic 900 ${Math.round(h * 0.5)}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
  g.fillText('MÉXICO GP', x + w / 2, y + h * 0.58, w * 0.9);
  g.restore();
  printWear(g, x, y, w, h, 88, 0.6);
};

// ---------------------------------------------------------------- the plans

interface Plan {
  cells: AdPainter[];
  /** the LED boards' rotation */
  reel: LedReel | null;
  runs: AdRun[];
  boards: AdBoard[];
  /** painted run-off word marks: corner name, cell, length, width */
  paint: [string, number, number, number][];
  /** title banners over the sponsor footbridges (their s as trackside/structures.ts VENUE_PROPS has them) */
  bridges: [number, number][];
}

/**
 * Sheet layout per venue: [0] the event's title banner, then every partner as printed vinyl
 * (1…20, the roster's order), then the run-off paint the venue uses, then the venue's extras.
 */
class Sheet {
  readonly cells: AdPainter[];
  private readonly paintAt = new Map<string, number>();
  readonly extra: number[] = [];
  constructor(readonly R: Roster, title: AdPainter, paintKeys: string[], extras: AdPainter[] = []) {
    this.cells = [title, ...R.brands.map((b, k) => brandCell(b, false, 301 + k))];
    for (const k of paintKeys) {
      if (this.paintAt.has(k)) continue;
      this.paintAt.set(k, this.cells.length);
      this.cells.push(paintCell(R.b(k), false, 401 + this.cells.length));
    }
    for (const e of extras) {
      this.extra.push(this.cells.length);
      this.cells.push(e);
    }
  }
  /** a partner's vinyl board ('title' is the event's title banner) */
  v(key: string): number {
    return key === 'banner' ? 0 : 1 + this.R.index(key);
  }
  /** a partner's run-off paint */
  p(key: string): number {
    return this.paintAt.get(key) ?? 0;
  }
}

function corner(track: Track, name: string) {
  return track.corners.find((c) => c.name === name);
}

/** the spots of the paddock-wide corner billboards (trackside/structures.ts) and footbridges: the runs keep clear */
function avoidList(track: Track, billboards: string[], bridges: number[]): number[] {
  const out = [...bridges];
  for (const n of billboards) {
    const c = corner(track, n);
    if (c) out.push(c.sStart - 10);
  }
  return out;
}

const BANNER = (R: Roster, bg: string, fg: string, accent: string, seed: number, bands?: string[]) => titleCell(R.title, EVENT.gp, { bg, fg, accent, bands }, seed);

function plan(track: Track): Plan | null {
  const id = track.def.id;
  const R = rosterFor(id);
  const c = (name: string) => corner(track, name);
  if (id === 'melbourne') {
    const sh = new Sheet(R, BANNER(R, '#0f1c2e', '#ffffff', '#ffcd00', 501), []);
    const v = (k: string) => sh.v(k);
    const avoid = avoidList(track, ['Jones', 'Sports Centre', 'Ascari', 'Turn 9', 'Marina'], [1520, 3560]);
    const runs: AdRun[] = [
      // LED boards at the foot of the Fangio and Brabham stands (behind the light poles): the whole run one slide
      { sA: 340, sB: 1030, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [0], repeat: 2, avoid },
    ];
    // printed hoardings round the backs of the gravel traps, the title airline in every run
    const trap = (name: string, before: number, after: number, cells: number[]) => {
      const k = c(name);
      if (!k) return;
      runs.push({ sA: k.sStart - before, sB: k.sEnd + after, side: k.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells, repeat: 3, avoid });
    };
    trap('Jones', 70, 10, [0, v('harbour'), v('logistics'), v('title')]);
    trap('Sports Centre', 90, 20, [v('title'), v('harbour'), v('tasman'), 0]);
    trap('Marina', 60, 10, [v('harbour'), v('yarra'), v('title')]);
    trap('Turn 9', 60, 60, [0, v('nebulix'), v('timing'), v('laneway')]);
    trap('Ascari', 80, 20, [v('title'), v('logistics'), v('wattle')]);
    trap('Turn 13', 50, 20, [v('lager'), 0, v('tasman')]);
    return { cells: sh.cells, reel: new LedReel(rotation(R)), runs, boards: [], paint: [], bridges: [[1520, 0], [3560, 0]] };
  }
  if (id === 'mexico') {
    const sh = new Sheet(R, BANNER(R, '#e6007e', '#ffffff', '#00a19a', 502), ['title', 'cellia', 'tonalli', 'banco'], [mexicoCell]);
    const v = (k: string) => sh.v(k), p = (k: string) => sh.p(k);
    const MX = sh.extra[0]; // the rosa mexicano board
    const avoid = avoidList(track, ['Turn 1', 'Turn 4', 'Turn 6', 'Turn 12', 'Turn 7'], [2080, 3840]);
    const t1 = c('Turn 1'), t13 = c('Turn 13');
    const reel = new LedReel(rotation(R, [['mx', mexicoCell]]));
    const runs: AdRun[] = [
      // LED boards the length of the main straight's grandstands
      { sA: 400, sB: 1480, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [0], repeat: 2, avoid },
    ];
    // the Foro Sol: pink and the promoter's partners round the wall in front of the stadium's stands
    // (behind the photographers' stands at Turns 14 and 16)
    if (t13) runs.push({ sA: t13.sApex + 16, sB: 120, side: -1, back: 4.2, w: 6, h: 1.1, y: 0.35, cells: [MX, v('palmera'), MX, v('title'), MX, v('cellia')], repeat: 2, avoid });
    // Turn 1: the hoardings at the back of the run-off, past the Grada 1
    if (t1) runs.push({ sA: t1.sStart - 120, sB: t1.sEnd + 10, side: t1.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells: [MX, v('cellia'), v('banco'), v('palmera'), v('logistics')], repeat: 3, avoid });
    return {
      cells: sh.cells,
      reel,
      runs,
      boards: [],
      paint: [['Turn 1', p('title'), 30, 8], ['Turn 4', p('cellia'), 24, 7], ['Turn 6', p('tonalli'), 20, 6], ['Turn 12', p('banco'), 22, 6]],
      bridges: [[2080, MX], [3840, 0]],
    };
  }
  if (id === 'sakhir') {
    const sh = new Sheet(R, BANNER(R, '#0c1f4a', '#ffffff', '#c9a227', 503), ['title', 'sitra', 'najma', 'dilmun', 'aluminia', 'energy'], [bahrainCell]);
    const v = (k: string) => sh.v(k), p = (k: string) => sh.p(k);
    const BH = sh.extra[0]; // Bahrain's own board
    const avoid = avoidList(track, ['Turn 1', 'Turn 4', 'Turn 10', 'Turn 11', 'Turn 14'], [1660, 3520]);
    const t1 = c('Turn 1');
    const reel = new LedReel(rotation(R, [['bh', bahrainCell]]));
    const runs: AdRun[] = [
      // LED boards in front of the Main Grandstand (behind the light masts)
      { sA: 300, sB: 1060, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [0], repeat: 2, avoid },
    ];
    if (t1) runs.push({ sA: t1.sStart - 60, sB: t1.sEnd + 40, side: t1.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells: [0, v('title'), BH, v('najma'), v('sitra'), v('timing')], repeat: 3, avoid });
    return {
      cells: sh.cells,
      reel,
      runs,
      boards: [],
      paint: [['Turn 1', p('title'), 34, 9], ['Turn 4', p('sitra'), 30, 8], ['Turn 8', p('najma'), 24, 7], ['Turn 10', p('title'), 26, 7], ['Turn 11', p('dilmun'), 26, 7], ['Turn 13', p('aluminia'), 24, 7], ['Turn 14', p('energy'), 30, 8]],
      bridges: [[1660, 0], [3520, BH]],
    };
  }
  if (id === 'yasmarina') {
    const sh = new Sheet(R, BANNER(R, '#2b2a29', '#ffffff', '#bd8b13', 504), ['title', 'khaleej', 'falcon', 'saadiyat']);
    const v = (k: string) => sh.v(k), p = (k: string) => sh.p(k);
    const avoid = avoidList(track, ['Turn 1', 'Turn 7', 'Turn 8', 'Turn 11', 'Turn 20'], [2450, 3700]);
    const t7 = c('Turn 7');
    const runs: AdRun[] = [
      { sA: 190, sB: 690, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [0], repeat: 2, avoid },
    ];
    // the hairpin: hoardings at the back of its big run-off, past the North Grandstand
    if (t7) runs.push({ sA: t7.sStart - 80, sB: t7.sEnd + 20, side: t7.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells: [0, v('title'), v('khaleej'), v('qasr'), v('cruise')], repeat: 3, avoid });
    return {
      cells: sh.cells,
      reel: new LedReel(rotation(R)),
      runs,
      boards: [],
      paint: [['Turn 1', p('title'), 30, 8], ['Turn 5', p('khaleej'), 24, 7], ['Turn 7', p('title'), 30, 8], ['Turn 8', p('khaleej'), 30, 8], ['Turn 11', p('falcon'), 26, 7], ['Turn 14', p('saadiyat'), 22, 6]],
      bridges: [[2450, 0], [3700, 0]],
    };
  }
  return null;
}

// ---------------------------------------------------------------- entry points

/** keep the trees off where the boards will stand (from the venue's plan) */
export function reserveVenueAds(track: Track, map: WorldMap) {
  const p = plan(track);
  if (p) reserveAds(track, map, p.runs, p.boards);
}

/** the venue's boards and painted run-offs (from its scenery) */
export function buildVenueAds(track: Track, map: WorldMap, stands: GrandstandSpec[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'VenueAds';
  const p = plan(track);
  if (!p) return group;
  const ads = new VenueAds(track, map, new AdSheet(p.cells), stands, p.reel);
  for (const r of p.runs) ads.run(r);
  for (const b of p.boards) ads.billboard(b);
  for (const [s, cell] of p.bridges) ads.bridgeBanner(s, cell);
  for (const [name, cell, len, wid] of p.paint) {
    const k = corner(track, name);
    if (!k) continue;
    // (the outside of the corner, from the apex on: try a little further out if the verge is in the way)
    const side = k.dir;
    for (const [ds, inset] of [[len * 0.3, 3], [len * 0.6, 3], [len * 0.3, 7], [0, 5]] as const) if (ads.runoff(k.sApex + ds, side, cell, len, wid, inset)) break;
  }
  for (const m of ads.meshes('venue_ads')) group.add(m);
  return group;
}
