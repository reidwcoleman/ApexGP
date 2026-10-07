import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec } from '../layout.ts';
import type { Brand } from '../../brands.ts';
import { printWear } from '../../brands.ts';
import { AdSheet, VenueAds, brandCell, ledCell, paintCell, reserveAds, titleCell, type AdBoard, type AdPainter, type AdRun } from './venueAds.ts';

/**
 * The race weekend's own boards at Albert Park, the Autódromo Hermanos Rodríguez, Sakhir and Yas
 * Marina (venueAds.ts builds them): each Grand Prix's title partner and local partners — fictional
 * brands in the colour blocks of the real boards — where the TV picture shows them:
 *
 *   Melbourne   LED boards along the foot of the Fangio and Brabham stands, printed hoardings
 *               round the backs of the gravel traps at Turns 1, 3, 6, 9–10, 11 and 13; green and
 *               gold, the title partner's monogram brown, the local lager's green
 *   Mexico      LED boards down the 1.2 km main straight, the rosa mexicano of the Gran Premio
 *               everywhere (the stadium's walls in front of the Foro Sol's stands, the hoardings at
 *               Turn 1), the big painted word marks on the asphalt run-offs at Turns 1, 4, 6, 12
 *   Sakhir      LED boards in front of the Main Grandstand, the national airline's navy and gold
 *               and Bahrain's serrated red and white, painted word marks in every big run-off
 *               (Turns 1, 4, 8, 10, 11, 13, 14), hoardings round Turn 1
 *   Yas Marina  LED boards along the Main Grandstand, champagne-and-gold airline boards, the
 *               state energy company's blue, painted run-offs at Turns 1, 5, 7, 8, 11, 14
 *
 * `reserveVenueAds` keeps the trees off the boards (called from the venue's plan, before the
 * woods grow); `buildVenueAds` builds them (from its scenery). Both read the same plan.
 */

type B = Brand;

// ---------------------------------------------------------------- the partners (all fictional)

const MELBOURNE: B[] = [
  // the title partner: a Parisian maison's brown and sand monogram
  { name: 'MAISON VERNET', tag: 'PARIS · DEPUIS 1854', bg: '#4b3527', fg: '#e8d6ad', accent: '#c9a45c', mark: 'none', weight: 300, track: 0.3 },
  // the local lager's green with its red star
  { name: 'HARBOUR LAGER', tag: 'BREWED IN MELBOURNE', bg: '#0b6b35', fg: '#ffffff', accent: '#e2231a', mark: 'dot', weight: 900, italic: true },
  { name: 'VELOXA EXPRESS', tag: 'EXPRESS · LOGISTICS', bg: '#ffcc00', fg: '#d40511', accent: '#d40511', mark: 'bars', weight: 900, italic: true, sx: 1.12 },
  { name: 'KESTRIA AIRWAYS', tag: 'GOING PLACES TOGETHER', bg: '#5c0632', fg: '#ffffff', accent: '#b3a07a', mark: 'wing', weight: 600, track: 0.05 },
  { name: 'nebulix', tag: 'THE FUTURE OF PAYMENTS', bg: '#002d74', fg: '#ffffff', accent: '#59c3ff', mark: 'diamond', weight: 600, lower: true },
  { name: 'TASMAN MUTUAL', tag: 'INSURANCE · SINCE 1911', bg: '#ffffff', fg: '#00205b', accent: '#ffcd00', mark: 'shield', weight: 700 },
  { name: 'LANEWAY ROASTERS', tag: 'SPECIALTY COFFEE', bg: '#1d1a17', fg: '#f2e6d0', accent: '#c46a2b', mark: 'ring', weight: 400, track: 0.12 },
];

const MEXICO: B[] = [
  { name: 'CELLIA', tag: 'RED 5G · TODO MÉXICO', bg: '#0057b8', fg: '#ffffff', accent: '#00c1f3', mark: 'wave', weight: 900, italic: true },
  { name: 'PALMERA', tag: 'CERVEZA · DESDE 1925', bg: '#0f3b26', fg: '#f2d16b', accent: '#c8102e', mark: 'ring', weight: 900 },
  { name: 'BANCO ALTIPLANO', tag: 'EL BANCO FUERTE DE MÉXICO', bg: '#e30613', fg: '#ffffff', accent: '#ffffff', mark: 'bars', weight: 700 },
  { name: 'TONALLI', tag: 'VIVE LA CIUDAD', bg: '#00a19a', fg: '#ffffff', accent: '#e6007e', mark: 'dot', weight: 700, track: 0.06 },
  { name: 'AGUAVIVA', tag: 'AGUA DE MANANTIAL', bg: '#e8f4fb', fg: '#004a98', accent: '#47a9e0', mark: 'wave', weight: 600 },
  { name: 'NUBE ALTA', tag: 'MEZCAL ARTESANAL · OAXACA', bg: '#111111', fg: '#d4b06a', accent: '#d4b06a', mark: 'none', weight: 300, track: 0.26 },
];

const SAKHIR: B[] = [
  // the national airline's navy and gold
  { name: 'AWAL AIRWAYS', tag: 'THE PEARL OF THE GULF', bg: '#0c1f4a', fg: '#efe0b4', accent: '#c9a227', mark: 'wing', weight: 600, track: 0.06 },
  { name: 'NAJMA', tag: 'TELECOM · 5G', bg: '#e4002b', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 900 },
  { name: 'SITRA ENERGIES', tag: 'POWERING THE KINGDOM', bg: '#ffffff', fg: '#00754a', accent: '#00a3e0', mark: 'wave', weight: 700 },
  { name: 'DILMUN BANK', tag: 'PRIVATE · CORPORATE', bg: '#1d1d1b', fg: '#d6b46a', accent: '#d6b46a', mark: 'shield', weight: 300, track: 0.2 },
  { name: 'ALUMINIA', tag: 'BAHRAIN ALUMINIUM', bg: '#d9dde1', fg: '#1b365d', accent: '#1b365d', mark: 'bars', weight: 900, sx: 1.1 },
];

const YAS: B[] = [
  // the airline: champagne and gold on stone
  { name: 'YASMEEN AIRWAYS', tag: 'FROM ABU DHABI TO THE WORLD', bg: '#efe9df', fg: '#8a6a2c', accent: '#bd8b13', mark: 'wing', weight: 600, track: 0.08 },
  { name: 'KHALEEJ', tag: 'ENERGY · SINCE 1971', bg: '#0047ba', fg: '#ffffff', accent: '#00b2e3', mark: 'diamond', weight: 900, italic: true },
  { name: 'SAADIYAT & CO', tag: 'COMMUNITIES · RESORTS', bg: '#ffffff', fg: '#002f6c', accent: '#00a0df', mark: 'none', weight: 300, track: 0.24 },
  { name: 'FALCON PAY', tag: 'TAP · PAY · GO', bg: '#111111', fg: '#ffffff', accent: '#00c08b', mark: 'ring', weight: 700 },
  { name: 'QASR HOTELS', tag: 'ARABIAN HOSPITALITY', bg: '#7a1f2b', fg: '#f3e3c3', accent: '#d9b46a', mark: 'shield', weight: 400, track: 0.14 },
];

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
  runs: AdRun[];
  boards: AdBoard[];
  /** painted run-off word marks: corner name, cell, length, width */
  paint: [string, number, number, number][];
  /** title banners over the sponsor footbridges (their s as trackside/structures.ts VENUE_PROPS has them) */
  bridges: [number, number][];
}

/**
 * Sheet layout per venue: [0] the event banner, then each partner as vinyl (1…n), as LED
 * (n+1…2n) and as run-off paint (2n+1…3n), then the venue's extras.
 */
function sheetFor(title: AdPainter, partners: B[], extra: AdPainter[] = []): AdPainter[] {
  return [
    title,
    ...partners.map((b, k) => brandCell(b, false, 301 + k)),
    ...partners.map((b) => ledCell(b)),
    ...partners.map((b, k) => paintCell(b, false, 401 + k)),
    ...extra,
  ];
}
const vinyl = (k: number) => 1 + k;
const led = (n: number, k: number) => 1 + n + k;
const paint = (n: number, k: number) => 1 + 2 * n + k;

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

function plan(track: Track): Plan | null {
  const id = track.def.id;
  const c = (name: string) => corner(track, name);
  if (id === 'melbourne') {
    const n = MELBOURNE.length;
    const avoid = avoidList(track, ['Jones', 'Sports Centre', 'Ascari', 'Turn 9', 'Marina'], [1520, 3560]);
    const runs: AdRun[] = [
      // LED boards at the foot of the Fangio and Brabham stands (behind the light poles)
      { sA: 340, sB: 1030, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [led(n, 0), led(n, 1), led(n, 4), led(n, 0), led(n, 2), led(n, 3), led(n, 6)], repeat: 2, avoid },
    ];
    // printed hoardings round the backs of the gravel traps, the title partner's in every run
    const trap = (name: string, before: number, after: number, cells: number[]) => {
      const k = c(name);
      if (!k) return;
      runs.push({ sA: k.sStart - before, sB: k.sEnd + after, side: k.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells, repeat: 3, avoid });
    };
    trap('Jones', 70, 10, [0, vinyl(1), vinyl(2), vinyl(0)]);
    trap('Sports Centre', 90, 20, [vinyl(0), vinyl(1), vinyl(5), 0]);
    trap('Marina', 60, 10, [vinyl(1), vinyl(3), vinyl(0)]);
    trap('Turn 9', 60, 60, [0, vinyl(4), vinyl(1), vinyl(6)]);
    trap('Ascari', 80, 20, [vinyl(0), vinyl(2), vinyl(1)]);
    trap('Turn 13', 50, 20, [vinyl(1), 0, vinyl(5)]);
    return { cells: sheetFor(titleCell('MAISON VERNET', 'AUSTRALIAN GRAND PRIX', '#0f1c2e', '#ffffff', '#ffcd00', 501), MELBOURNE), runs, boards: [], paint: [], bridges: [[1520, 0], [3560, 0]] };
  }
  if (id === 'mexico') {
    const n = MEXICO.length;
    const MX = 1 + 3 * n; // the rosa mexicano board
    const avoid = avoidList(track, ['Turn 1', 'Turn 4', 'Turn 6', 'Turn 12', 'Turn 7'], [2080, 3840]);
    const t1 = c('Turn 1'), t13 = c('Turn 13');
    const runs: AdRun[] = [
      // LED boards the length of the main straight's grandstands
      { sA: 400, sB: 1480, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [led(n, 0), MX, led(n, 1), led(n, 2), MX, led(n, 3), led(n, 5)], repeat: 2, avoid },
    ];
    // the Foro Sol: pink and partners round the wall in front of the stadium's stands (behind the
    // photographers' stands at Turns 14 and 16)
    if (t13) runs.push({ sA: t13.sApex + 16, sB: 120, side: -1, back: 4.2, w: 6, h: 1.1, y: 0.35, cells: [MX, vinyl(1), MX, vinyl(0), MX, vinyl(3)], repeat: 2, avoid });
    // Turn 1: the hoardings at the back of the run-off, past the Grada 1
    if (t1) runs.push({ sA: t1.sStart - 120, sB: t1.sEnd + 10, side: t1.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells: [MX, vinyl(0), vinyl(2), vinyl(1)], repeat: 3, avoid });
    return {
      cells: sheetFor(titleCell('CDMX', 'GRAN PREMIO DE LA CIUDAD DE MÉXICO', '#e6007e', '#ffffff', '#00a19a', 502), MEXICO, [mexicoCell]),
      runs,
      boards: [],
      paint: [['Turn 1', paint(n, 0), 30, 8], ['Turn 4', paint(n, 1), 24, 7], ['Turn 6', paint(n, 3), 20, 6], ['Turn 12', paint(n, 2), 22, 6]],
      bridges: [[2080, MX], [3840, 0]],
    };
  }
  if (id === 'sakhir') {
    const n = SAKHIR.length;
    const BH = 1 + 3 * n; // Bahrain's own board
    const avoid = avoidList(track, ['Turn 1', 'Turn 4', 'Turn 10', 'Turn 11', 'Turn 14'], [1660, 3520]);
    const t1 = c('Turn 1');
    const runs: AdRun[] = [
      // LED boards in front of the Main Grandstand (behind the light masts)
      { sA: 300, sB: 1060, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [led(n, 0), led(n, 1), BH, led(n, 2), led(n, 0), led(n, 3), BH, led(n, 4)], repeat: 2, avoid },
    ];
    if (t1) runs.push({ sA: t1.sStart - 60, sB: t1.sEnd + 40, side: t1.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells: [0, vinyl(0), BH, vinyl(1), vinyl(2)], repeat: 3, avoid });
    return {
      cells: sheetFor(titleCell('AWAL AIRWAYS', 'BAHRAIN GRAND PRIX', '#0c1f4a', '#ffffff', '#c9a227', 503), SAKHIR, [bahrainCell]),
      runs,
      boards: [],
      paint: [['Turn 1', paint(n, 0), 34, 9], ['Turn 4', paint(n, 2), 30, 8], ['Turn 8', paint(n, 1), 24, 7], ['Turn 10', paint(n, 0), 26, 7], ['Turn 11', paint(n, 3), 26, 7], ['Turn 13', paint(n, 4), 24, 7], ['Turn 14', paint(n, 0), 30, 8]],
      bridges: [[1660, 0], [3520, BH]],
    };
  }
  if (id === 'yasmarina') {
    const n = YAS.length;
    const avoid = avoidList(track, ['Turn 1', 'Turn 7', 'Turn 8', 'Turn 11', 'Turn 20'], [2450, 3700]);
    const t7 = c('Turn 7');
    const runs: AdRun[] = [
      { sA: 190, sB: 690, side: -1, back: 3.2, w: 6, h: 1.0, y: 0.9, led: true, cells: [led(n, 0), led(n, 1), led(n, 3), led(n, 0), led(n, 2), led(n, 4)], repeat: 2, avoid },
    ];
    // the hairpin: hoardings at the back of its big run-off, past the North Grandstand
    if (t7) runs.push({ sA: t7.sStart - 80, sB: t7.sEnd + 20, side: t7.dir, back: 6.2, w: 6, h: 1.3, y: 0.6, cells: [0, vinyl(0), vinyl(1), vinyl(3)], repeat: 3, avoid });
    return {
      cells: sheetFor(titleCell('YASMEEN AIRWAYS', 'ABU DHABI GRAND PRIX', '#2b2a29', '#ffffff', '#bd8b13', 504), YAS),
      runs,
      boards: [],
      paint: [['Turn 1', paint(n, 0), 30, 8], ['Turn 5', paint(n, 1), 24, 7], ['Turn 7', paint(n, 0), 30, 8], ['Turn 8', paint(n, 1), 30, 8], ['Turn 11', paint(n, 3), 26, 7], ['Turn 14', paint(n, 2), 22, 6]],
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
  const ads = new VenueAds(track, map, new AdSheet(p.cells), stands);
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
