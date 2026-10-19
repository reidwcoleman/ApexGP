/**
 * Lawns: every lawn is a pure function of its number, so lawn 12 is the same lawn for everyone.
 * A lawn is a grid of 2 m tiles (any shape) with the things standing on it, coins and flowers;
 * in metres, centred on the origin. Some have a house along the back, with a patio.
 */
import { Nav, TS, shapeGap, type Shape } from './nav.ts';
import { Rng, clamp, vnoise } from './util.ts';

export interface Theme {
  id: 'morning' | 'day' | 'autumn' | 'dusk';
  name: string;
  hdri: string;
  /** sun elevation (degrees) and the compass direction it shines from (radians, in the xz plane) */
  sunEl: number;
  sunAz: number;
  sunColor: string;
  sunIntensity: number;
  envIntensity: number;
  exposure: number;
  /** haze: colour and density (exp2) */
  fogColor: string;
  fogDensity: number;
  grass: { base: string; tipA: string; tipB: string; cutL: string; cutD: string; dry: string };
  /** multiplier on the scanned foliage's colour */
  leafTint: [number, number, number];
  blooms: string[];
  ambient: 'pollen' | 'leaves' | 'petals' | 'fireflies';
  /** lanterns and windows lit */
  lights: boolean;
  /** CSS gradient behind the UI while loading */
  skyTop: string;
  skyBottom: string;
}

export const THEMES: Theme[] = [
  {
    id: 'morning',
    name: 'Morning',
    hdri: 'morning',
    sunEl: 20,
    sunAz: 2.5,
    sunColor: '#ffd9a8',
    sunIntensity: 3.6,
    envIntensity: 0.9,
    exposure: 1.0,
    fogColor: '#d9e2e8',
    fogDensity: 0.0075,
    grass: { base: '#1d5a1c', tipA: '#5aa02a', tipB: '#8ab838', cutL: '#7fb343', cutD: '#639938', dry: '#a9a444' },
    leafTint: [1.0, 1.0, 0.92],
    blooms: ['#ffffff', '#ffe14a', '#f3a6c8', '#b9a1f0'],
    ambient: 'pollen',
    lights: false,
    skyTop: '#9cc4e8',
    skyBottom: '#f6e7cf',
  },
  {
    id: 'day',
    name: 'Summer',
    hdri: 'day',
    sunEl: 52,
    sunAz: 2.2,
    sunColor: '#fff3df',
    sunIntensity: 4.2,
    envIntensity: 1.0,
    exposure: 1.0,
    fogColor: '#cfe2f3',
    fogDensity: 0.0055,
    grass: { base: '#1b5a1d', tipA: '#4f9a2a', tipB: '#7fb534', cutL: '#76aa3e', cutD: '#58903a', dry: '#a3a047' },
    leafTint: [1.0, 1.0, 1.0],
    blooms: ['#ffffff', '#ffd83a', '#ff9ec4', '#a98cf0'],
    ambient: 'pollen',
    lights: false,
    skyTop: '#6fb0ea',
    skyBottom: '#e3f0f8',
  },
  {
    id: 'autumn',
    name: 'Autumn',
    hdri: 'autumn',
    sunEl: 30,
    sunAz: 2.8,
    sunColor: '#ffd29a',
    sunIntensity: 3.8,
    envIntensity: 0.95,
    exposure: 1.0,
    fogColor: '#e3d3b8',
    fogDensity: 0.0075,
    grass: { base: '#3f5420', tipA: '#8aa030', tipB: '#b8b846', cutL: '#a8ab4e', cutD: '#83993b', dry: '#c0a24a' },
    leafTint: [1.35, 0.95, 0.55],
    blooms: ['#ffb43a', '#ff7a3a', '#fff0b0', '#c9482a'],
    ambient: 'leaves',
    lights: false,
    skyTop: '#d8a56a',
    skyBottom: '#f6e2c4',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    hdri: 'dusk',
    sunEl: 7,
    sunAz: 3.9,
    sunColor: '#ff9d5a',
    sunIntensity: 3.0,
    envIntensity: 1.1,
    exposure: 1.1,
    fogColor: '#b8a4b8',
    fogDensity: 0.009,
    grass: { base: '#183f26', tipA: '#3f8a46', tipB: '#6aa34a', cutL: '#659d49', cutD: '#46823a', dry: '#8f8f4a' },
    leafTint: [0.95, 0.95, 1.0],
    blooms: ['#ffe9a8', '#ffa8d4', '#9ad0ff', '#ffffff'],
    ambient: 'fireflies',
    lights: true,
    skyTop: '#46508f',
    skyBottom: '#f0a58c',
  },
];

export type ObstacleKind = 'tree' | 'shrub' | 'rock' | 'bed' | 'pond' | 'bench' | 'table' | 'gnome' | 'hedge' | 'fence' | 'lantern' | 'shed' | 'firepit' | 'planter' | 'sprinkler' | 'stump';

export interface ObstacleDef {
  kind: ObstacleKind;
  x: number;
  z: number;
  /** tree / shrub: scale on the scanned prototype; rock: diameter (m); pond: radius (m) */
  size: number;
  /** half extents for boxy things */
  hw: number;
  hd: number;
  rot: number;
  seed: number;
  /** which prototype / model */
  variant: number;
  shape: Shape;
}

export interface CoinDef {
  x: number;
  z: number;
}
export interface FlowerDef {
  x: number;
  z: number;
  kind: 0 | 1 | 2;
  color: string;
  h: number;
}

export interface HouseDef {
  x0: number;
  x1: number;
  /** the wall's z (the lawn's back edge) */
  z: number;
  /** the patio laid on the carved tiles */
  px0: number;
  px1: number;
  pz1: number;
  style: 0 | 1;
}

export type FenceStyle = 'timber' | 'hedge' | 'stone' | 'mixed';

export interface LevelDef {
  index: number;
  name: string;
  theme: Theme;
  seed: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  obstacles: ObstacleDef[];
  coins: CoinDef[];
  flowers: FlowerDef[];
  start: { x: number; z: number; heading: number };
  nav: Nav;
  tileCount: number;
  /** mowable area in m² */
  area: number;
  house: HouseDef | null;
  fence: FenceStyle;
}

type ShapeKind = 'rect' | 'rounded' | 'ell' | 'plus' | 'blob' | 'bridge';

function makeTiles(kind: ShapeKind, w: number, h: number, rng: Rng): Uint8Array {
  const t = new Uint8Array(w * h).fill(1);
  const clear = (i0: number, j0: number, i1: number, j1: number) => {
    for (let j = Math.max(0, j0); j < Math.min(h, j1); j++) for (let i = Math.max(0, i0); i < Math.min(w, i1); i++) t[j * w + i] = 0;
  };
  switch (kind) {
    case 'rounded': {
      const c = w > 8 && h > 6 ? 2 : 1;
      clear(0, 0, 1, 1);
      clear(w - 1, 0, w, 1);
      clear(0, h - 1, 1, h);
      clear(w - 1, h - 1, w, h);
      if (c === 2) {
        clear(1, 0, 2, 1);
        clear(0, 1, 1, 2);
        clear(w - 2, 0, w - 1, 1);
        clear(w - 1, 1, w, 2);
        clear(1, h - 1, 2, h);
        clear(0, h - 2, 1, h - 1);
        clear(w - 2, h - 1, w - 1, h);
        clear(w - 1, h - 2, w, h - 1);
      }
      break;
    }
    case 'ell': {
      const cw = Math.max(2, Math.round(w * rng.range(0.34, 0.46)));
      const ch = Math.max(2, Math.round(h * rng.range(0.38, 0.5)));
      // (the cut is always a front corner: the back stays straight for the house and fence)
      if (rng.chance(0.5)) clear(w - cw, h - ch, w, h);
      else clear(0, h - ch, cw, h);
      break;
    }
    case 'plus': {
      const cw = Math.max(2, Math.round(w * 0.28));
      const ch = Math.max(2, Math.round(h * 0.32));
      clear(0, h - ch, cw, h);
      clear(w - cw, h - ch, w, h);
      clear(0, 0, Math.max(1, cw - 1), Math.max(1, ch - 1));
      clear(w - Math.max(1, cw - 1), 0, w, Math.max(1, ch - 1));
      break;
    }
    case 'bridge': {
      const mid = Math.round(w * 0.38);
      const mid2 = Math.round(w * 0.62);
      const band = Math.max(2, Math.round(h * 0.34));
      clear(mid, 0, mid2, band);
      clear(mid, h - band, mid2, h);
      break;
    }
    case 'blob': {
      const sx = rng.range(0, 100);
      const sy = rng.range(0, 100);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const nx = ((i + 0.5) / w) * 2 - 1;
          const nz = ((j + 0.5) / h) * 2 - 1;
          const d = Math.hypot(nx, nz);
          const n = vnoise(i * 0.5 + sx, j * 0.5 + sy);
          if (d + (n - 0.45) * 0.7 > 0.98) t[j * w + i] = 0;
        }
      }
      break;
    }
    default:
      break;
  }
  return t;
}

/** Label the connected pieces; keep the biggest. With `trim`, crop to its bounding box. */
function largestPiece(t: Uint8Array, w: number, h: number, trim: boolean): { tiles: Uint8Array; w: number; h: number } {
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1;
  let bestN = 0;
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!t[s] || label[s] >= 0) continue;
    const st = [s];
    label[s] = id;
    let n = 0;
    while (st.length) {
      const k = st.pop()!;
      n++;
      const i = k % w;
      const j = (k / w) | 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= w || b >= h) continue;
        const q = b * w + a;
        if (t[q] && label[q] < 0) {
          label[q] = id;
          st.push(q);
        }
      }
    }
    if (n > bestN) {
      bestN = n;
      bestId = id;
    }
    id++;
  }
  let i0 = 0, j0 = 0, i1 = w - 1, j1 = h - 1;
  if (trim) {
    i0 = w; j0 = h; i1 = -1; j1 = -1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (label[j * w + i] === bestId) {
      i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
    }
  }
  const nw = i1 - i0 + 1;
  const nh = j1 - j0 + 1;
  const out = new Uint8Array(nw * nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) out[j * nw + i] = label[(j + j0) * w + (i + i0)] === bestId ? 1 : 0;
  return { tiles: out, w: nw, h: nh };
}

interface KindSpec {
  kind: ObstacleKind;
  w: number;
  from: number;
}

const KINDS: KindSpec[] = [
  { kind: 'tree', w: 2.4, from: 1 },
  { kind: 'shrub', w: 2.2, from: 1 },
  { kind: 'rock', w: 1.6, from: 2 },
  { kind: 'bed', w: 1.8, from: 1 },
  { kind: 'gnome', w: 0.8, from: 3 },
  { kind: 'pond', w: 1.0, from: 4 },
  { kind: 'bench', w: 0.9, from: 3 },
  { kind: 'table', w: 0.7, from: 5 },
  { kind: 'hedge', w: 1.1, from: 4 },
  { kind: 'fence', w: 0.7, from: 6 },
  { kind: 'shed', w: 0.5, from: 5 },
  { kind: 'firepit', w: 0.45, from: 7 },
  { kind: 'planter', w: 0.8, from: 4 },
  { kind: 'sprinkler', w: 0.6, from: 3 },
  { kind: 'stump', w: 0.6, from: 3 },
];

export function buildLevel(index: number): LevelDef {
  const seed = index * 7919 + 13;
  const rng = new Rng(seed);
  const theme = THEMES[Math.floor((index - 1) / 3) % THEMES.length];

  // size grows with the lawn number, then holds (a first lawn is 14 x 12 m; the big ones 50 x 36 m)
  let w = clamp(7 + Math.floor(index * 0.65), 7, 26) + (index > 2 ? rng.int(-1, 1) : 0);
  let h = clamp(6 + Math.floor(index * 0.5), 6, 19) + (index > 2 ? rng.int(-1, 1) : 0);
  w = clamp(w, 7, 26);
  h = clamp(h, 6, 19);
  let kind: ShapeKind = 'rect';
  if (index >= 3) {
    const pool: { k: ShapeKind; w: number }[] = [
      { k: 'rect', w: 3 },
      { k: 'rounded', w: 2 },
      { k: 'ell', w: 1.6 },
      { k: 'blob', w: 1.6 },
      { k: 'plus', w: index >= 6 && w >= 10 ? 1 : 0 },
      { k: 'bridge', w: index >= 8 && w >= 13 ? 0.9 : 0 },
    ];
    kind = rng.weighted(pool).k;
  } else if (index === 2) kind = 'rounded';
  const piece = largestPiece(makeTiles(kind, w, h, rng), w, h, true);
  w = piece.w;
  h = piece.h;
  let tiles = piece.tiles;
  const W = w * TS;
  const H = h * TS;

  // a house along the back, when the back edge is long and straight enough: its patio is carved out of the lawn
  let house: HouseDef | null = null;
  if (index >= 2 && rng.chance(0.78)) {
    let j0 = 0;
    for (let j = 0; j < h; j++) {
      let any = false;
      for (let i = 0; i < w; i++) if (tiles[j * w + i]) any = true;
      if (any) {
        j0 = j;
        break;
      }
    }
    let best = { i: 0, n: 0 };
    const cur = { i: 0, n: 0 };
    for (let i = 0; i < w; i++) {
      if (tiles[j0 * w + i]) {
        if (!cur.n) cur.i = i;
        cur.n++;
        if (cur.n > best.n) best = { i: cur.i, n: cur.n };
      } else cur.n = 0;
    }
    if (best.n >= 4) {
      const pw = Math.min(best.n - 2, rng.int(2, 4));
      const pi0 = best.i + Math.floor((best.n - pw) / 2) + (best.n - pw >= 2 ? rng.int(-1, 1) : 0);
      const pi = clamp(pi0, best.i + 1, best.i + best.n - pw - 1);
      for (let j = j0; j < Math.min(h, j0 + 2); j++) for (let i = pi; i < pi + pw; i++) tiles[j * w + i] = 0;
      const lw = Math.min(best.n * TS, 18);
      const cx = (best.i + best.n / 2) * TS - W / 2;
      house = {
        x0: cx - lw / 2,
        x1: cx + lw / 2,
        z: j0 * TS - H / 2,
        px0: pi * TS - W / 2,
        px1: (pi + pw) * TS - W / 2,
        pz1: (j0 + 2) * TS - H / 2,
        style: rng.chance(0.5) ? 0 : 1,
      };
      tiles = largestPiece(tiles, w, h, false).tiles;
    }
  }
  let tileCount = 0;
  for (let i = 0; i < tiles.length; i++) tileCount += tiles[i];

  const playable = (x: number, z: number) => {
    const i = Math.floor((x + W / 2) / TS);
    const j = Math.floor((z + H / 2) / TS);
    return i >= 0 && j >= 0 && i < w && j < h && tiles[j * w + i] === 1;
  };
  // is a disc of radius m around the point wholly over tiles?
  const inside = (x: number, z: number, m: number) => {
    if (!playable(x, z)) return false;
    const n = Math.max(12, Math.ceil(m * 5));
    for (let a = 0; a < n; a++) {
      const t = (a / n) * Math.PI * 2;
      if (!playable(x + Math.cos(t) * m, z + Math.sin(t) * m)) return false;
    }
    return true;
  };

  // start: the front row, nearest the middle
  let sx = 0;
  let sz = 0;
  {
    let bestJ = -1;
    for (let j = h - 1; j >= 0 && bestJ < 0; j--) for (let i = 0; i < w; i++) if (tiles[j * w + i]) bestJ = j;
    let bestI = 0;
    let bd = 1e9;
    for (let i = 0; i < w; i++) {
      if (!tiles[bestJ * w + i]) continue;
      const d = Math.abs(i + 0.5 - w / 2);
      if (d < bd) {
        bd = d;
        bestI = i;
      }
    }
    sx = (bestI + 0.5) * TS - W / 2;
    // (a little in from the edge, so the gardener behind the mower is not standing in the fence)
    let off = 2.5;
    while (off > 1.3 && !inside(sx, (bestJ + 1) * TS - H / 2 - off, 0.7)) off -= 0.2;
    sz = (bestJ + 1) * TS - H / 2 - off;
  }

  // things standing on the lawn
  const obstacles: ObstacleDef[] = [];
  const area = tileCount * TS * TS;
  const want = index <= 1 ? 3 : Math.min(Math.round(3 + (index - 1) * 0.9), Math.floor(area / 26));
  const GAP = 2.0;
  const edge = 2.1;
  let guard = 0;
  while (obstacles.length < want && guard++ < want * 80) {
    const pool: KindSpec[] = KINDS.map((k) => ({ ...k, w: index >= k.from ? k.w : 0 }));
    if (theme.lights) pool.push({ kind: 'lantern', w: 1.4, from: 1 });
    const spec = rng.weighted(pool);
    // (a small first lawn takes one big tree, not three)
    if (spec.kind === 'tree' && w * h < 60 && obstacles.some((q) => q.kind === 'tree')) continue;
    const o = makeObstacle(spec.kind, rng);
    o.x = rng.range(-W / 2, W / 2);
    o.z = rng.range(-H / 2, H / 2);
    placeShape(o);
    const reach = o.shape.t === 0 ? o.shape.r : Math.hypot((o.shape.x1 - o.shape.x0) / 2, (o.shape.z1 - o.shape.z0) / 2);
    const margin = o.kind === 'tree' ? 2.4 : edge + (o.kind === 'hedge' || o.kind === 'fence' ? 0.3 : 0);
    if (!inside(o.x, o.z, reach + margin)) continue;
    if (Math.hypot(o.x - sx, o.z - sz) < reach + 3.5) continue;
    let ok = true;
    for (const q of obstacles) {
      if (shapeGap(o.shape, q.shape) < GAP) {
        ok = false;
        break;
      }
    }
    if (ok) obstacles.push(o);
  }

  // every blade must be cuttable: if the things placed wall off part of the lawn, take the last one away
  const openFraction = (n: Nav) => {
    let open = 0;
    let all = 0;
    const st = 0.25;
    for (let j = 0; j < H / st; j++) {
      for (let i = 0; i < W / st; i++) {
        const x = (i + 0.5) * st - W / 2;
        const z = (j + 0.5) * st - H / 2;
        if (!n.playable(x, z) || n.solidAt(x, z, 0.03)) continue;
        all++;
        if (n.coverable(x, z)) open++;
      }
    }
    return all ? open / all : 1;
  };
  let nav = new Nav(tiles, w, h, []);
  nav.computeReach(sx, sz);
  // (each obstacle takes a thin uncuttable ring with it, so allow some: a walled-off pocket costs far more)
  const bar = openFraction(nav) - 0.06;
  nav = new Nav(tiles, w, h, obstacles.map((o) => o.shape));
  nav.computeReach(sx, sz);
  while (obstacles.length && openFraction(nav) < bar) {
    obstacles.pop();
    nav = new Nav(tiles, w, h, obstacles.map((o) => o.shape));
    nav.computeReach(sx, sz);
  }

  // coins: lone ones, short lines and arcs, only where the mower can get
  const coins: CoinDef[] = [];
  const nCoins = Math.min(8 + Math.round(index * 1.3), 42);
  const okCoin = (x: number, z: number) => {
    if (!nav.reachable(x, z) || nav.blocked(x, z, 0.7) || !inside(x, z, 0.7)) return false;
    if (Math.hypot(x - sx, z - sz) < 2.2) return false;
    for (const c of coins) if (Math.hypot(c.x - x, c.z - z) < 1.3) return false;
    return true;
  };
  let tries = 0;
  while (coins.length < nCoins && tries++ < 800) {
    const px = rng.range(-W / 2, W / 2);
    const pz = rng.range(-H / 2, H / 2);
    const pattern = rng.next();
    if (pattern < 0.4) {
      if (okCoin(px, pz)) coins.push({ x: px, z: pz });
    } else if (pattern < 0.75) {
      const a = rng.range(0, Math.PI * 2);
      const n = rng.int(3, 6);
      for (let k = 0; k < n && coins.length < nCoins; k++) {
        const x = px + Math.cos(a) * k * 1.5;
        const z = pz + Math.sin(a) * k * 1.5;
        if (okCoin(x, z)) coins.push({ x, z });
      }
    } else {
      const n = rng.int(5, 8);
      const r = rng.range(1.5, 2.3);
      const a0 = rng.range(0, Math.PI * 2);
      for (let k = 0; k < n && coins.length < nCoins; k++) {
        const a = a0 + (k / n) * Math.PI * 2;
        const x = px + Math.cos(a) * r;
        const z = pz + Math.sin(a) * r;
        if (okCoin(x, z)) coins.push({ x, z });
      }
    }
  }

  // wild flowers dotted through the long grass: daisies, dandelions, clover
  const flowers: FlowerDef[] = [];
  const nFlowers = Math.min(Math.round(area * 0.16), 520);
  tries = 0;
  while (flowers.length < nFlowers && tries++ < nFlowers * 14) {
    const px = rng.range(-W / 2, W / 2);
    const pz = rng.range(-H / 2, H / 2);
    if (!nav.coverable(px, pz) || nav.solidAt(px, pz, 0.4) || !inside(px, pz, 0.3)) continue;
    if (Math.hypot(px - sx, pz - sz) < 1.6) continue;
    const kindF = rng.pick([0, 0, 1, 1, 2]) as 0 | 1 | 2;
    const color = kindF === 0 ? '#ffffff' : kindF === 1 ? '#ffd21f' : rng.pick(['#e58fb8', '#c58fe0', '#ffffff']);
    const n = rng.chance(0.55) ? 1 : rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const x = px + rng.range(-0.5, 0.5);
      const z = pz + rng.range(-0.5, 0.5);
      if (!nav.coverable(x, z) || nav.solidAt(x, z, 0.3) || !inside(x, z, 0.2)) continue;
      flowers.push({ x, z, kind: kindF, color, h: rng.range(0.14, 0.26) });
    }
  }

  const fence: FenceStyle = rng.weighted([
    { f: 'timber' as FenceStyle, w: 3 },
    { f: 'hedge' as FenceStyle, w: 2 },
    { f: 'stone' as FenceStyle, w: index >= 3 ? 1.5 : 0 },
    { f: 'mixed' as FenceStyle, w: index >= 4 ? 1.5 : 0 },
  ]).f;

  return {
    index,
    name: `Lawn ${index}`,
    theme,
    seed,
    w,
    h,
    tiles,
    obstacles,
    coins,
    flowers,
    start: { x: sx, z: sz, heading: Math.PI },
    nav,
    tileCount,
    area,
    house,
    fence,
  };
}

function makeObstacle(kind: ObstacleKind, rng: Rng): ObstacleDef {
  const o: ObstacleDef = {
    kind,
    x: 0,
    z: 0,
    size: 1,
    hw: 0,
    hd: 0,
    rot: rng.range(0, Math.PI * 2),
    seed: rng.int(1, 1e9),
    variant: 0,
    shape: { t: 0, x: 0, z: 0, r: 0.5 },
  };
  const horiz = rng.chance(0.5);
  const axisRot = horiz ? 0 : Math.PI / 2;
  switch (kind) {
    case 'tree':
      o.variant = rng.int(0, 5);
      o.size = rng.range(0.3, 0.42);
      break;
    case 'shrub':
      o.variant = rng.int(0, 6);
      o.size = rng.range(0.55, 0.95);
      break;
    case 'rock':
      o.variant = rng.int(0, 4);
      o.size = rng.range(0.9, 1.9);
      break;
    case 'gnome':
      o.size = 0.5;
      break;
    case 'lantern':
      o.size = 0.15;
      break;
    case 'pond':
      o.size = rng.range(1.8, 2.7);
      break;
    case 'bed':
      o.hw = rng.range(1.2, 2.2);
      o.hd = rng.range(0.55, 0.85);
      o.rot = axisRot;
      o.variant = rng.int(0, 2);
      break;
    case 'hedge':
      o.hw = rng.range(1.5, 3.4);
      o.hd = 0.45;
      o.rot = axisRot;
      break;
    case 'fence':
      o.hw = rng.range(1.6, 3.2);
      o.hd = 0.08;
      o.rot = axisRot;
      break;
    case 'bench':
      o.hw = 0.85;
      o.hd = 0.32;
      o.rot = axisRot;
      break;
    case 'table':
      o.size = 1.05;
      break;
    case 'shed':
      o.hw = 1.4;
      o.hd = 1.0;
      o.rot = axisRot;
      break;
    case 'firepit':
      o.size = 0.85;
      break;
    case 'planter':
      o.hw = 0.5;
      o.hd = 0.3;
      o.variant = rng.int(0, 1);
      o.rot = axisRot;
      break;
    case 'sprinkler':
      o.size = 0.22;
      break;
    case 'stump':
      o.size = rng.range(0.4, 0.55);
      break;
  }
  return o;
}

/** Fit the collider to wherever the obstacle now stands. */
export function placeShape(o: ObstacleDef) {
  const boxy = o.kind === 'bed' || o.kind === 'hedge' || o.kind === 'fence' || o.kind === 'bench' || o.kind === 'shed' || o.kind === 'planter';
  if (boxy) {
    const vertical = Math.abs(Math.sin(o.rot)) > 0.5;
    const hw = vertical ? o.hd : o.hw;
    const hd = vertical ? o.hw : o.hd;
    o.shape = { t: 1, x0: o.x - hw, z0: o.z - hd, x1: o.x + hw, z1: o.z + hd };
    return;
  }
  let r: number;
  switch (o.kind) {
    case 'tree':
      r = 0.34;
      break;
    case 'shrub':
      r = 0.62 * o.size + 0.18;
      break;
    case 'rock':
      r = o.size * 0.5;
      break;
    case 'pond':
      r = o.size;
      break;
    case 'table':
      r = o.size * 0.85;
      break;
    case 'firepit':
      r = o.size * 0.8;
      break;
    case 'stump':
      r = o.size * 0.5;
      break;
    default:
      r = o.size;
  }
  o.shape = { t: 0, x: o.x, z: o.z, r };
}
