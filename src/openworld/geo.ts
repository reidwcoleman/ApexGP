/**
 * Miami at real scale. Everything is placed from latitude / longitude so the city sits where it
 * really is: x = east (m), z = south (m), origin at Flagler Street × Miami Avenue (25.7742 N,
 * 80.1937 W) — the zero point of Miami's own street numbering. North is −z (as the race game's
 * compass bearings: 0 = north = −Z, 90 = east = +X).
 *
 * The coastlines, islands and causeways follow the real shoreline closely (a few tens of metres);
 * the street grids are the real grids' spacing and orientation (Brickell's runs 34° off north,
 * parallel to Brickell Avenue and the bay).
 */

export interface P2 {
  x: number;
  z: number;
}

const LAT0 = 25.7742;
const LON0 = -80.1937;
/** metres per degree at 25.77° N */
const KX = 100246;
const KZ = 110900;

export function ll(lat: number, lon: number): P2 {
  return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KZ };
}
export const lla = (pts: [number, number][]): P2[] => pts.map(([a, b]) => ll(a, b));

/** the world's extent (m) — the map, the water sheet and the light map cover this */
export const WORLD = { x0: -2600, x1: 7600, z0: -4700, z1: 4400 };

/** the land beyond the map (Miami-Dade goes on inland): the outlines reach this far */
export const FAR = 30000;

/** water surface level (land tops are at y = 0) */
export const WATER_Y = -1.1;

// -------------------------------------------------------------------------------- the land

export interface LandDef {
  name: string;
  outline: P2[];
  /** shore kind: 'wall' = seawall (most of Miami), 'beach' handled by BEACHES */
  kind?: 'mainland' | 'island';
}

/** the Miami River's centreline (mouth → west), its width tapering upstream */
export const RIVER = lla([
  [25.7697, -80.1855],
  [25.7699, -80.1878],
  [25.7701, -80.1902],
  [25.7704, -80.1928],
  [25.7711, -80.1957],
  [25.7724, -80.1985],
  [25.7744, -80.2015],
  [25.7768, -80.2045],
  [25.7795, -80.2083],
  [25.7826, -80.2125],
  [25.7850, -80.2170],
  [25.7868, -80.2215],
]);
export const RIVER_W0 = 78;
export const RIVER_W1 = 48;

/** the mainland's bay shore, north → south (the river mouth splits it) */
const COAST_NORTH = lla([
  [25.8170, -80.1858],
  [25.8100, -80.1862],
  [25.8030, -80.1860],
  [25.7975, -80.1866],
  [25.7935, -80.1872],
  [25.7905, -80.1874],
  [25.7880, -80.1866],
  [25.7860, -80.1852],
  [25.7838, -80.1848],
  [25.7815, -80.1853],
  [25.7800, -80.1861],
  [25.7788, -80.1864],
  [25.7778, -80.1856],
  [25.7765, -80.1848],
  [25.7748, -80.1843],
  [25.7730, -80.1848],
  [25.7716, -80.1856],
  [25.7706, -80.1858],
]);
const COAST_SOUTH = lla([
  [25.7688, -80.1866],
  [25.7672, -80.1874],
  [25.7652, -80.1884],
  [25.7628, -80.1895],
  [25.7604, -80.1906],
  [25.7578, -80.1920],
  [25.7552, -80.1937],
  [25.7528, -80.1958],
  [25.7506, -80.1985],
  [25.7488, -80.2010],
  [25.7462, -80.2044],
  [25.7432, -80.2080],
  [25.7400, -80.2118],
  [25.7370, -80.2150],
  [25.7345, -80.2178],
]);

function riverBank(side: 1 | -1): P2[] {
  // offset the centreline to one bank (side 1 = north/left bank going upstream)
  const out: P2[] = [];
  const n = RIVER.length;
  for (let i = 0; i < n; i++) {
    const a = RIVER[Math.max(0, i - 1)], b = RIVER[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const w = (RIVER_W0 + (RIVER_W1 - RIVER_W0) * (i / (n - 1))) / 2;
    // left of upstream direction: (dz, -dx) points north-ish for a westward river
    out.push({ x: RIVER[i].x + dz * w * side, z: RIVER[i].z - dx * w * side });
  }
  return out;
}

export const RIVER_NORTH_BANK = riverBank(1);
export const RIVER_SOUTH_BANK = riverBank(-1);

function mainlandNorth(): P2[] {
  const bank = RIVER_NORTH_BANK;
  const last = bank[bank.length - 1];
  return [
    { x: WORLD.x0 - FAR, z: WORLD.z0 - FAR },
    { x: COAST_NORTH[0].x - 300, z: WORLD.z0 - FAR },
    ...COAST_NORTH,
    ...bank,
    { x: WORLD.x0 - FAR, z: last.z },
  ];
}
function mainlandSouth(): P2[] {
  const bank = RIVER_SOUTH_BANK;
  const last = bank[bank.length - 1];
  const tail = COAST_SOUTH[COAST_SOUTH.length - 1];
  return [{ x: WORLD.x0 - FAR, z: last.z }, ...bank.slice().reverse(), ...COAST_SOUTH, { x: tail.x - 2500, z: WORLD.z1 + FAR }, { x: WORLD.x0 - FAR, z: WORLD.z1 + FAR }];
}

/** Miami Beach's bay shore (west) and Atlantic shore (east), south → north */
export const BEACH_BAY_SHORE = lla([
  [25.7652, -80.1372],
  [25.7672, -80.1396],
  [25.7702, -80.1410],
  [25.7738, -80.1412],
  [25.7778, -80.1418],
  [25.7820, -80.1423],
  [25.7862, -80.1418],
  [25.7900, -80.1411],
  [25.7945, -80.1420],
  [25.7990, -80.1436],
  [25.8045, -80.1442],
  [25.8100, -80.1445],
  [25.8170, -80.1440],
]);
export const BEACH_OCEAN_SHORE = lla([
  [25.7652, -80.1330],
  [25.7672, -80.1318],
  [25.7705, -80.1305],
  [25.7745, -80.1294],
  [25.7790, -80.1284],
  [25.7840, -80.1275],
  [25.7890, -80.1265],
  [25.7945, -80.1254],
  [25.8000, -80.1243],
  [25.8060, -80.1232],
  [25.8120, -80.1222],
  [25.8170, -80.1214],
]);

function miamiBeach(): P2[] {
  const north0 = { x: BEACH_BAY_SHORE[BEACH_BAY_SHORE.length - 1].x - 200, z: WORLD.z0 - FAR };
  const north1 = { x: BEACH_OCEAN_SHORE[BEACH_OCEAN_SHORE.length - 1].x + 600, z: WORLD.z0 - FAR };
  return [...BEACH_BAY_SHORE, north0, north1, ...BEACH_OCEAN_SHORE.slice().reverse()];
}

/** an oval island from its centre and radii (m), `n` points, rotated `rot` rad */
function oval(c: P2, rx: number, rz: number, rot = 0, n = 28, wobble = 0.04, seed = 1): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(a * 3 + seed) + wobble * 0.6 * Math.sin(a * 5 + seed * 2.3);
    const x = Math.cos(a) * rx * w, z = Math.sin(a) * rz * w;
    out.push({ x: c.x + x * Math.cos(rot) - z * Math.sin(rot), z: c.z + x * Math.sin(rot) + z * Math.cos(rot) });
  }
  return out;
}

export const LANDS: LandDef[] = [
  { name: 'Mainland (Downtown)', outline: mainlandNorth(), kind: 'mainland' },
  { name: 'Mainland (Brickell)', outline: mainlandSouth(), kind: 'mainland' },
  { name: 'Miami Beach', outline: miamiBeach(), kind: 'mainland' },
  {
    name: 'Brickell Key',
    outline: lla([
      [25.7697, -80.1849],
      [25.7700, -80.1836],
      [25.7695, -80.1822],
      [25.7684, -80.1815],
      [25.7670, -80.1816],
      [25.7660, -80.1826],
      [25.7659, -80.1840],
      [25.7666, -80.1852],
      [25.7680, -80.1857],
    ]),
    kind: 'island',
  },
  {
    name: 'Watson Island',
    outline: lla([
      [25.7908, -80.1806],
      [25.7915, -80.1770],
      [25.7905, -80.1735],
      [25.7880, -80.1708],
      [25.7852, -80.1705],
      [25.7836, -80.1728],
      [25.7832, -80.1765],
      [25.7842, -80.1797],
      [25.7868, -80.1812],
    ]),
    kind: 'island',
  },
  {
    name: 'Dodge Island',
    outline: lla([
      [25.7776, -80.1812],
      [25.7790, -80.1790],
      [25.7795, -80.1720],
      [25.7793, -80.1640],
      [25.7786, -80.1575],
      [25.7772, -80.1535],
      [25.7748, -80.1518],
      [25.7728, -80.1530],
      [25.7722, -80.1580],
      [25.7728, -80.1660],
      [25.7742, -80.1735],
      [25.7758, -80.1790],
    ]),
    kind: 'island',
  },
  { name: 'Star Island', outline: oval(ll(25.7776, -80.1489), 270, 140, -0.12, 30, 0.05, 2), kind: 'island' },
  { name: 'Palm Island', outline: oval(ll(25.7836, -80.1560), 400, 85, -0.05, 30, 0.03, 4), kind: 'island' },
  { name: 'Hibiscus Island', outline: oval(ll(25.7858, -80.1492), 380, 70, -0.04, 30, 0.03, 7), kind: 'island' },
  { name: 'Fisher Island', outline: oval(ll(25.7605, -80.1430), 420, 380, 0.3, 34, 0.06, 3), kind: 'island' },
];

// -------------------------------------------------------------------------------- districts

export interface GridDistrict {
  id: string;
  name: string;
  /** grid origin and the unit vectors of its two street directions */
  origin: P2;
  /** angle of the "u" streets (deg clockwise from north); v streets run perpendicular */
  angle: number;
  /** positions of the lines along u (avenues: offsets across, in m, perpendicular to u) */
  cols: { at: number; name: string; kind: RoadKind; span?: [number, number] }[];
  /** positions along u of the cross streets */
  rows: { at: number; name: string; kind: RoadKind }[];
  /** keep a node only if this says so (district borders): land = LANDS index + 1 at the node */
  keep?: (p: P2, land: number) => boolean;
  /** building character */
  density: 'tower' | 'midrise' | 'lowrise' | 'deco' | 'residential' | 'port';
}

export type RoadKind = 'street' | 'avenue' | 'boulevard' | 'ocean' | 'highway' | 'causeway' | 'ramp' | 'service' | 'lane';

const rowsEvery = (from: number, to: number, step: number, name: (i: number) => string, kind: (i: number) => RoadKind = () => 'street') => {
  const out: { at: number; name: string; kind: RoadKind }[] = [];
  let i = 0;
  for (let a = from; a <= to + 0.1; a += step, i++) out.push({ at: a, name: name(i), kind: kind(i) });
  return out;
};

const ORD = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** Brickell's grid: Brickell Avenue's heading (deg clockwise from north) */
export const BRICKELL_ANGLE = 33.7;
const BRICKELL_O = ll(25.7688, -80.1897);

export const DISTRICTS: GridDistrict[] = [
  {
    id: 'downtown',
    name: 'Downtown',
    origin: { x: 0, z: 0 },
    angle: 0,
    // avenues (N–S), x offsets east of Miami Avenue
    cols: [
      { at: ll(0, -80.2165).x, name: 'NW 12th Ave', kind: 'avenue' },
      { at: ll(0, -80.2128).x, name: 'NW 10th Ave', kind: 'street' },
      { at: ll(0, -80.2092).x, name: 'NW 8th Ave', kind: 'street' },
      { at: ll(0, -80.2055).x, name: 'NW 6th Ave', kind: 'street' },
      { at: ll(0, -80.1993).x, name: 'NW 3rd Ave', kind: 'street' },
      { at: ll(0, -80.1975).x, name: 'NW 2nd Ave', kind: 'avenue' },
      { at: ll(0, -80.1955).x, name: 'NW 1st Ave', kind: 'street' },
      { at: 0, name: 'Miami Ave', kind: 'avenue' },
      { at: ll(0, -80.1918).x, name: 'NE 1st Ave', kind: 'street' },
      { at: ll(0, -80.1899).x, name: 'NE 2nd Ave', kind: 'avenue' },
      { at: ll(0, -80.1884).x, name: 'NE 3rd Ave', kind: 'street' },
      { at: ll(0, -80.1869).x, name: 'Biscayne Blvd', kind: 'boulevard' },
    ],
    // streets (E–W), z offsets (south positive); Flagler at 0
    rows: [
      ...rowsEvery(-4400, -2360, 145, (i) => `NE ${ORD(36 - i)} St`, (i) => (i === 7 ? 'avenue' : 'street')),
      ...rowsEvery(-2220, -111, 111, (i) => `NE ${ORD(20 - i)} St`, (i) => (20 - i === 14 || 20 - i === 8 ? 'avenue' : 'street')),
      { at: 0, name: 'Flagler St', kind: 'avenue' },
      { at: 111, name: 'SE 1st St', kind: 'street' },
      { at: 222, name: 'SE 2nd St', kind: 'street' },
      { at: 318, name: 'SE 3rd St', kind: 'street' },
    ],
    keep: (p, land) => land === 1 && p.x < 760,
    density: 'tower',
  },
  {
    id: 'brickell',
    name: 'Brickell',
    origin: BRICKELL_O,
    angle: BRICKELL_ANGLE,
    // lines parallel to Brickell Avenue (offset across: + toward the bay)
    cols: [
      { at: 175, name: 'Brickell Bay Dr', kind: 'street' },
      { at: 0, name: 'Brickell Ave', kind: 'boulevard' },
      { at: -165, name: 'S Miami Ave', kind: 'avenue' },
      { at: -325, name: 'SW 1st Ave', kind: 'street' },
      { at: -480, name: 'SW 2nd Ave', kind: 'avenue' },
      { at: -640, name: 'SW 3rd Ave', kind: 'street' },
    ],
    rows: rowsEvery(60, 2700, 132, (i) => (i === 3 ? 'SW 8th St' : i === 10 ? 'Coral Way' : `SE ${ORD(5 + i)} St`), (i) => (i === 3 || i === 10 ? 'avenue' : 'street')),
    keep: (p, land) => land === 2 && brickellV(p) > -700,
    density: 'tower',
  },
  {
    id: 'havana',
    name: 'Little Havana',
    origin: { x: 0, z: 0 },
    angle: 0,
    cols: [
      { at: ll(0, -80.2165).x, name: 'SW 12th Ave', kind: 'avenue' },
      { at: ll(0, -80.2128).x, name: 'SW 10th Ave', kind: 'street' },
      { at: ll(0, -80.2092).x, name: 'SW 8th Ave', kind: 'street' },
      { at: ll(0, -80.2055).x, name: 'SW 6th Ave', kind: 'street' },
      { at: ll(0, -80.2020).x, name: 'SW 4th Ave', kind: 'street' },
    ],
    rows: rowsEvery(-1400, 4300, 125, (i) => `SW ${ORD(Math.max(1, i - 10))} St`, (i) => (i === 14 ? 'avenue' : 'street')),
    keep: (p, land) => land === 2 && brickellV(p) < -790,
    density: 'residential',
  },
  {
    id: 'southbeach',
    name: 'South Beach',
    origin: { x: 0, z: 0 },
    angle: 0,
    cols: [
      { at: ll(0, -80.1410).x, name: 'West Ave', kind: 'street' },
      { at: ll(0, -80.1395).x, name: 'Alton Rd', kind: 'avenue' },
      { at: ll(0, -80.1375).x, name: 'Lenox Ave', kind: 'street' },
      { at: ll(0, -80.1356).x, name: 'Meridian Ave', kind: 'street' },
      { at: ll(0, -80.1340).x, name: 'Washington Ave', kind: 'avenue' },
      { at: ll(0, -80.1324).x, name: 'Collins Ave', kind: 'avenue' },
      { at: ll(0, -80.1309).x, name: 'Ocean Dr', kind: 'ocean', span: [ll(25.7870, 0).z, ll(25.7672, 0).z] },
    ],
    rows: ([
      { at: ll(25.7672, 0).z, name: 'South Pointe Dr', kind: 'street' },
      { at: ll(25.7698, 0).z, name: '2nd St', kind: 'street' },
      { at: ll(25.7718, 0).z, name: '3rd St', kind: 'street' },
      { at: ll(25.7737, 0).z, name: '5th St', kind: 'boulevard' },
      ...rowsEvery(ll(25.7751, 0).z, ll(25.7752, 0).z, 1, () => '6th St'),
      ...[7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n, i) => ({ at: ll(25.7764 + i * 0.00125, 0).z, name: `${ORD(n)} St`, kind: (n === 10 || n === 15 ? 'avenue' : 'street') as RoadKind })),
      { at: ll(25.7905, 0).z, name: 'Lincoln Rd', kind: 'street' },
      ...rowsEvery(ll(25.7925, 0).z - 0, ll(25.8150, 0).z, -138, (i) => `${ORD(18 + i * 2)} St`).map((r) => r),
    ] as { at: number; name: string; kind: RoadKind }[]).sort((a, b) => a.at - b.at),
    keep: (_p, land) => land === 3,
    density: 'deco',
  },
];

/** offset across Brickell's grid (+ toward the bay) of a point */
export function brickellV(p: P2): number {
  const a = (BRICKELL_ANGLE * Math.PI) / 180;
  return (p.x - BRICKELL_O.x) * Math.cos(a) + (p.z - BRICKELL_O.z) * Math.sin(a);
}

/** Ocean Drive's hotel strip (between 5th and 15th) — art deco on the west side, Lummus Park east */
export const OCEAN_DRIVE = { x: ll(0, -80.1309).x, z0: ll(25.7870, 0).z, z1: ll(25.7737, 0).z };

// -------------------------------------------------------------------------------- the arteries

export interface RouteDef {
  id: string;
  name: string;
  kind: RoadKind;
  /** control points (x, z) and the deck height y at each (m above land) */
  pts: { p: P2; y: number }[];
  lanes: number;
  /** a fill embankment either side (causeways), m */
  fill?: number;
  oneway?: boolean;
}

const pt = (lat: number, lon: number, y = 0) => ({ p: ll(lat, lon), y });

export const ROUTES: RouteDef[] = [
  {
    id: 'i95',
    name: 'I-95',
    kind: 'highway',
    lanes: 4,
    pts: [
      pt(25.8170, -80.2030, 9),
      pt(25.8000, -80.2031, 9),
      pt(25.7900, -80.2028, 10),
      pt(25.7800, -80.2025, 11),
      pt(25.7730, -80.2023, 13),
      pt(25.7680, -80.2030, 12),
      pt(25.7630, -80.2052, 10),
      pt(25.7570, -80.2085, 9),
      pt(25.7500, -80.2120, 9),
      pt(25.7420, -80.2160, 8),
      pt(25.7350, -80.2195, 8),
    ],
  },
  {
    id: 'i395',
    name: 'I-395 / MacArthur Causeway',
    kind: 'causeway',
    lanes: 3,
    fill: 0,
    pts: [
      pt(25.7893, -80.2029, 10),
      pt(25.7893, -80.1990, 10),
      pt(25.7893, -80.1950, 9),
      pt(25.7893, -80.1905, 8.5),
      pt(25.7891, -80.1876, 9),
      // the high bridge over the main channel
      pt(25.7884, -80.1850, 17),
      pt(25.7874, -80.1826, 19),
      pt(25.7866, -80.1806, 9),
      // Watson Island
      pt(25.7860, -80.1785, 1.0),
      pt(25.7852, -80.1745, 0.8),
      pt(25.7845, -80.1712, 1.0),
      pt(25.7835, -80.1680, 4.5),
      pt(25.7825, -80.1650, 1.2),
      pt(25.7812, -80.1600, 1.2),
      pt(25.7805, -80.1565, 1.2),
      pt(25.7797, -80.1530, 1.2),
      pt(25.7786, -80.1495, 1.2),
      pt(25.7772, -80.1460, 3.5),
      pt(25.7757, -80.1432, 1.2),
      pt(25.7742, -80.1412, 0.4),
      pt(25.7737, -80.1395, 0),
    ],
  },
  {
    id: 'ramp395',
    name: 'I-395 Ramp',
    kind: 'ramp',
    lanes: 1,
    pts: [pt(25.7893, -80.1950, 9), pt(25.7887, -80.1925, 6.5), pt(25.7880, -80.1900, 3), pt(25.7874, -80.1882, 0.6), pt(25.7870, -80.1870, 0)],
  },
  {
    id: 'ramp95n',
    name: 'I-95 Ramp',
    kind: 'ramp',
    lanes: 1,
    pts: [pt(25.7800, -80.2025, 11), pt(25.7794, -80.2010, 7.5), pt(25.7790, -80.1998, 3), pt(25.7786, -80.1985, 0.3), pt(25.7786, -80.1975, 0)],
  },
  {
    id: 'ramp95s',
    name: 'I-95 Ramp',
    kind: 'ramp',
    lanes: 1,
    pts: [pt(25.7630, -80.2052, 10), pt(25.7628, -80.2030, 6.5), pt(25.7626, -80.2008, 2.5), pt(25.7624, -80.1990, 0.2), pt(25.7622, -80.1978, 0)],
  },
  {
    id: 'portblvd',
    name: 'Port Blvd',
    kind: 'avenue',
    lanes: 2,
    pts: [pt(25.7790, -80.1869, 0), pt(25.7787, -80.1850, 4), pt(25.7782, -80.1828, 6), pt(25.7776, -80.1810, 0.6), pt(25.7772, -80.1790, 0), pt(25.7768, -80.1700, 0), pt(25.7760, -80.1600, 0), pt(25.7752, -80.1545, 0)],
  },
  {
    id: 'brickellkey',
    name: 'Brickell Key Dr',
    kind: 'street',
    lanes: 1,
    pts: [pt(25.7676, -80.1872, 0), pt(25.7678, -80.1862, 1.2), pt(25.7680, -80.1852, 0), pt(25.7683, -80.1838, 0), pt(25.7690, -80.1826, 0), pt(25.7680, -80.1820, 0), pt(25.7668, -80.1826, 0), pt(25.7666, -80.1840, 0), pt(25.7680, -80.1852, 0)],
  },
  {
    id: 'starisland',
    name: 'Star Island Dr',
    kind: 'street',
    lanes: 1,
    pts: [pt(25.7790, -80.1515, 1.2), pt(25.7786, -80.1510, 0.6), pt(25.7782, -80.1505, 0), pt(25.7784, -80.1480, 0), pt(25.7778, -80.1465, 0), pt(25.7768, -80.1470, 0), pt(25.7766, -80.1495, 0), pt(25.7772, -80.1512, 0), pt(25.7782, -80.1505, 0)],
  },
  {
    id: 'palmisland',
    name: 'Palm Ave',
    kind: 'street',
    lanes: 1,
    pts: [pt(25.7808, -80.1560, 1.2), pt(25.7816, -80.1560, 0.8), pt(25.7832, -80.1562, 0), pt(25.7836, -80.1590, 0), pt(25.7837, -80.1528, 0)],
  },
  {
    id: 'watson',
    name: 'Watson Island Rd',
    kind: 'street',
    lanes: 1,
    pts: [pt(25.7856, -80.1760, 0.8), pt(25.7875, -80.1765, 0), pt(25.7895, -80.1775, 0), pt(25.7900, -80.1750, 0), pt(25.7885, -80.1725, 0)],
  },
  {
    id: 'watsonsouth',
    name: 'Watson Island S',
    kind: 'street',
    lanes: 1,
    pts: [pt(25.7849, -80.1735, 0.8), pt(25.7840, -80.1740, 0), pt(25.7838, -80.1770, 0)],
  },
];

/** named places for the district toast and the map */
export const PLACES: { name: string; p: P2; r: number }[] = [
  { name: 'Brickell', p: ll(25.7620, -80.1935), r: 900 },
  { name: 'Downtown Miami', p: ll(25.7745, -80.1905), r: 650 },
  { name: 'Park West', p: ll(25.7825, -80.1915), r: 450 },
  { name: 'Edgewater', p: ll(25.7990, -80.1895), r: 900 },
  { name: 'Overtown', p: ll(25.7830, -80.2010), r: 600 },
  { name: 'Little Havana', p: ll(25.7660, -80.2120), r: 900 },
  { name: 'Brickell Key', p: ll(25.7678, -80.1836), r: 230 },
  { name: 'Watson Island', p: ll(25.7872, -80.1760), r: 380 },
  { name: 'PortMiami', p: ll(25.7765, -80.1660), r: 1100 },
  { name: 'MacArthur Causeway', p: ll(25.7815, -80.1610), r: 650 },
  { name: 'Star Island', p: ll(25.7776, -80.1489), r: 300 },
  { name: 'South Beach', p: ll(25.7800, -80.1330), r: 800 },
  { name: 'Ocean Drive', p: ll(25.7805, -80.1306), r: 260 },
  { name: 'South Pointe', p: ll(25.7680, -80.1345), r: 380 },
  { name: 'Miami Beach', p: ll(25.8050, -80.1320), r: 1400 },
  { name: 'Fisher Island', p: ll(25.7605, -80.1430), r: 420 },
  { name: 'Biscayne Bay', p: ll(25.7740, -80.1720), r: 4000 },
];

export function placeAt(x: number, z: number): string {
  let best = 'Miami', bd = Infinity;
  for (const pl of PLACES) {
    const d = Math.hypot(x - pl.p.x, z - pl.p.z) / pl.r;
    if (d < 1 && d < bd) {
      bd = d;
      best = pl.name;
    }
  }
  return best;
}

// -------------------------------------------------------------------------------- polygon helpers

export function pointInPoly(x: number, z: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSeg(px: number, pz: number, a: P2, b: P2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

export function distToPoly(px: number, pz: number, poly: P2[], closed = true): number {
  let d = Infinity;
  const n = poly.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) d = Math.min(d, distToSeg(px, pz, poly[i], poly[(i + 1) % n]));
  return d;
}

/** a coarse land mask for fast point tests: 8 m cells over WORLD */
export class LandMask {
  readonly cell = 8;
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  constructor(lands: LandDef[]) {
    this.w = Math.ceil((WORLD.x1 - WORLD.x0) / this.cell);
    this.h = Math.ceil((WORLD.z1 - WORLD.z0) / this.cell);
    this.data = new Uint8Array(this.w * this.h);
    // scanline fill each polygon
    for (const [li, L] of lands.entries()) {
      const poly = L.outline;
      for (let j = 0; j < this.h; j++) {
        const z = WORLD.z0 + (j + 0.5) * this.cell;
        const xs: number[] = [];
        for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
          const a = poly[i], b = poly[k];
          if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
        }
        xs.sort((a, b) => a - b);
        for (let s = 0; s + 1 < xs.length; s += 2) {
          const i0 = Math.max(0, Math.ceil((xs[s] - WORLD.x0) / this.cell - 0.5));
          const i1 = Math.min(this.w - 1, Math.floor((xs[s + 1] - WORLD.x0) / this.cell - 0.5));
          for (let i = i0; i <= i1; i++) this.data[j * this.w + i] = li + 1;
        }
      }
    }
  }
  /** 0 = water, else the land index + 1 */
  at(x: number, z: number): number {
    const i = Math.floor((x - WORLD.x0) / this.cell), j = Math.floor((z - WORLD.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 0;
    return this.data[j * this.w + i];
  }
  land(x: number, z: number): boolean {
    return this.at(x, z) > 0;
  }
  /** land all along a segment (sampled every 6 m) */
  segLand(a: P2, b: P2, margin = 0): boolean {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(l / 6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (!this.land(x, z)) return false;
      if (margin > 0 && (!this.land(x + margin, z) || !this.land(x - margin, z) || !this.land(x, z + margin) || !this.land(x, z - margin))) return false;
    }
    return true;
  }
}
