/**
 * Lawns: every lawn is a pure function of its number, so lawn 12 is the same lawn for everyone.
 * A lawn is a grid of 1x1 tiles (any shape), the things standing on it, coins and flowers.
 */
import { Nav, shapeGap, type Shape } from './nav.ts';
import { Rng, clamp, vnoise } from './util.ts';

export interface Theme {
  id: string;
  name: string;
  skyTop: string;
  skyBottom: string;
  tipA: string;
  tipB: string;
  base: string;
  cutL: string;
  cutD: string;
  soil: string[];
  stone: string;
  canopy: string[];
  trunk: string;
  blooms: string[];
  sun: string;
  hemiSky: string;
  hemiGround: string;
  ambient: 'petals' | 'leaves' | 'fireflies' | 'motes';
  drift: string[];
  glow: number;
}

export const THEMES: Theme[] = [
  {
    id: 'meadow',
    name: 'Meadow',
    skyTop: '#8fd8ff',
    skyBottom: '#f4ffd9',
    tipA: '#6edb4c',
    tipB: '#a5ea58',
    base: '#1d8a35',
    cutL: '#b3f06c',
    cutD: '#82d958',
    soil: ['#7b4f31', '#946443', '#6a4129', '#8d8f98'],
    stone: '#b9bec8',
    canopy: ['#3fbf4f', '#59d062', '#2fa845'],
    trunk: '#7a4b2c',
    blooms: ['#ffffff', '#ffe46b', '#ff8fb3', '#b9a4ff'],
    sun: '#fff1cf',
    hemiSky: '#e8f6ff',
    hemiGround: '#a8c98a',
    ambient: 'motes',
    drift: ['#ffffff', '#fff7bf'],
    glow: 0,
  },
  {
    id: 'blossom',
    name: 'Blossom',
    skyTop: '#ffb8d8',
    skyBottom: '#fff1e2',
    tipA: '#74d95a',
    tipB: '#b3ec6d',
    base: '#238c3c',
    cutL: '#c2f58a',
    cutD: '#93de72',
    soil: ['#85563a', '#9c6b4a', '#714531', '#9a8f98'],
    stone: '#cdbfc9',
    canopy: ['#ff9ec4', '#ffc2da', '#ff7fb0'],
    trunk: '#7d4a3a',
    blooms: ['#ffffff', '#ffd1e4', '#ff7fb0', '#fff08a'],
    sun: '#fff0e6',
    hemiSky: '#ffeaf3',
    hemiGround: '#b9d49a',
    ambient: 'petals',
    drift: ['#ffc2da', '#ff9ec4', '#ffffff'],
    glow: 0,
  },
  {
    id: 'autumn',
    name: 'Harvest',
    skyTop: '#ffcf8a',
    skyBottom: '#fff0d0',
    tipA: '#aecb43',
    tipB: '#d4d84e',
    base: '#566f1f',
    cutL: '#e1de63',
    cutD: '#bdca4a',
    soil: ['#7b4a28', '#97602f', '#65391f', '#8f8575'],
    stone: '#c9bfa8',
    canopy: ['#ff8a3d', '#ffbd3a', '#e4572e'],
    trunk: '#6d4224',
    blooms: ['#ffb43a', '#ff7a3a', '#fff0b0', '#c9482a'],
    sun: '#ffe8b8',
    hemiSky: '#fff1d6',
    hemiGround: '#c9b27a',
    ambient: 'leaves',
    drift: ['#ff8a3d', '#ffbd3a', '#e4572e', '#c9a227'],
    glow: 0,
  },
  {
    id: 'dusk',
    name: 'Dusk',
    skyTop: '#4a3f9f',
    skyBottom: '#ffb09a',
    tipA: '#3dc58e',
    tipB: '#65e0a8',
    base: '#0f5260',
    cutL: '#7beab4',
    cutD: '#47c79c',
    soil: ['#4d3d6b', '#614f84', '#3d2f58', '#6f6a8f'],
    stone: '#9ea0c4',
    canopy: ['#2fa89a', '#4cc9b0', '#238a86'],
    trunk: '#4b3558',
    blooms: ['#ffe9a8', '#ffa8d4', '#9ad0ff', '#ffffff'],
    sun: '#ffd6c4',
    hemiSky: '#cdbcff',
    hemiGround: '#6b8aa0',
    ambient: 'fireflies',
    drift: ['#fff3a8', '#fffbd0'],
    glow: 1,
  },
];

export type ObstacleKind = 'rock' | 'tree' | 'bush' | 'gnome' | 'bed' | 'pond' | 'hedge' | 'fence' | 'bench' | 'table' | 'lantern';

export interface ObstacleDef {
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Visual scale (radius for round things). */
  size: number;
  /** Half extents for boxy things. */
  hw: number;
  hd: number;
  rot: number;
  /** How tall it stands: how long its shadow is. */
  height: number;
  seed: number;
  shape: Shape;
}

export interface CoinDef {
  x: number;
  z: number;
}
export interface FlowerDef {
  x: number;
  z: number;
  color: string;
  h: number;
}

export interface LevelDef {
  index: number;
  name: string;
  theme: Theme;
  w: number;
  h: number;
  tiles: Uint8Array;
  obstacles: ObstacleDef[];
  coins: CoinDef[];
  flowers: FlowerDef[];
  start: { x: number; z: number; heading: number };
  nav: Nav;
  tileCount: number;
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
      // round the four corners by notching 1 (or a 2-step diagonal for the big ones)
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
      const cw = Math.max(2, Math.round(w * rng.range(0.38, 0.5)));
      const ch = Math.max(2, Math.round(h * rng.range(0.42, 0.55)));
      const corner = rng.int(0, 3);
      if (corner === 0) clear(w - cw, 0, w, ch);
      else if (corner === 1) clear(0, 0, cw, ch);
      else if (corner === 2) clear(w - cw, h - ch, w, h);
      else clear(0, h - ch, cw, h);
      break;
    }
    case 'plus': {
      const cw = Math.max(2, Math.round(w * 0.3));
      const ch = Math.max(2, Math.round(h * 0.34));
      clear(0, 0, cw, ch);
      clear(w - cw, 0, w, ch);
      clear(0, h - ch, cw, h);
      clear(w - cw, h - ch, w, h);
      break;
    }
    case 'bridge': {
      const mid = Math.round(w * 0.38);
      const mid2 = Math.round(w * 0.62);
      const band = Math.max(2, Math.round(h * 0.36));
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
          const n = vnoise(i * 0.55 + sx, j * 0.55 + sy);
          if (d + (n - 0.45) * 0.75 > 0.98) t[j * w + i] = 0;
        }
      }
      break;
    }
    default:
      break;
  }
  return t;
}

/** Keep the biggest connected piece, trimmed to its bounding box. */
function largestPiece(t: Uint8Array, w: number, h: number): { tiles: Uint8Array; w: number; h: number } {
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
  let i0 = w, j0 = h, i1 = -1, j1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (label[j * w + i] === bestId) {
    i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
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
  { kind: 'rock', w: 2, from: 2 },
  { kind: 'bush', w: 2, from: 2 },
  { kind: 'tree', w: 2.2, from: 2 },
  { kind: 'gnome', w: 1, from: 3 },
  { kind: 'bed', w: 1.6, from: 3 },
  { kind: 'pond', w: 1.1, from: 4 },
  { kind: 'bench', w: 0.8, from: 4 },
  { kind: 'hedge', w: 1.3, from: 5 },
  { kind: 'fence', w: 1.2, from: 6 },
  { kind: 'table', w: 0.6, from: 6 },
];

export function buildLevel(index: number): LevelDef {
  const seed = index * 7919 + 13;
  const rng = new Rng(seed);
  const theme = THEMES[Math.floor((index - 1) / 3) % THEMES.length];

  // size grows with the lawn number, then holds
  let w = clamp(6 + Math.floor(index * 0.45), 6, 18) + (index > 2 ? rng.int(-1, 1) : 0);
  let h = clamp(5 + Math.floor(index * 0.38), 5, 13) + (index > 2 ? rng.int(-1, 1) : 0);
  w = clamp(w, 6, 18);
  h = clamp(h, 5, 13);
  let kind: ShapeKind = 'rect';
  if (index >= 3) {
    const pool: { k: ShapeKind; w: number }[] = [
      { k: 'rect', w: 2 },
      { k: 'rounded', w: 2 },
      { k: 'ell', w: 1.6 },
      { k: 'blob', w: 2 },
      { k: 'plus', w: index >= 5 && w >= 9 ? 1.2 : 0 },
      { k: 'bridge', w: index >= 6 && w >= 11 ? 1.1 : 0 },
    ];
    kind = rng.weighted(pool).k;
  } else if (index === 2) kind = 'rounded';
  const piece = largestPiece(makeTiles(kind, w, h, rng), w, h);
  w = piece.w;
  h = piece.h;
  const tiles = piece.tiles;
  let tileCount = 0;
  for (let i = 0; i < tiles.length; i++) tileCount += tiles[i];

  const playable = (x: number, z: number) => {
    const i = Math.floor(x + w / 2);
    const j = Math.floor(z + h / 2);
    return i >= 0 && j >= 0 && i < w && j < h && tiles[j * w + i] === 1;
  };
  // is a disc of radius m around the point wholly over tiles?
  const inside = (x: number, z: number, m: number) => {
    if (!playable(x, z)) return false;
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2;
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
    sx = bestI + 0.5 - w / 2;
    sz = bestJ + 0.5 - h / 2 - 0.1;
  }

  // things standing on the lawn
  const obstacles: ObstacleDef[] = [];
  const area = tileCount;
  const want = index <= 1 ? 0 : Math.min(Math.round(1 + (index - 1) * 0.8), Math.floor(area / 8));
  const GAP = 1.45;
  const edge = 1.25;
  let guard = 0;
  while (obstacles.length < want && guard++ < want * 60) {
    const spec = rng.weighted(KINDS.map((k) => ({ ...k, w: index >= k.from ? k.w : 0 })).concat(theme.glow ? [{ kind: 'lantern' as ObstacleKind, w: 1.6, from: 2 }] : []));
    const o = makeObstacle(spec.kind, rng, index);
    const px = rng.range(-w / 2, w / 2);
    const pz = rng.range(-h / 2, h / 2);
    o.x = px;
    o.z = pz;
    placeShape(o);
    const reach = o.shape.t === 0 ? o.shape.r : Math.hypot(o.hw, o.hd);
    if (!inside(px, pz, reach + edge)) continue;
    if (Math.hypot(px - sx, pz - sz) < reach + 2.3) continue;
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
    for (let j = 0; j < h * 5; j++) {
      for (let i = 0; i < w * 5; i++) {
        const x = (i + 0.5) * 0.2 - w / 2;
        const z = (j + 0.5) * 0.2 - h / 2;
        if (!n.playable(x, z) || n.solidAt(x, z, 0.03)) continue;
        all++;
        if (n.coverable(x, z)) open++;
      }
    }
    return all ? open / all : 1;
  };
  let nav = new Nav(tiles, w, h, []);
  nav.computeReach(sx, sz);
  // the bare lawn sets the bar (a thin peninsula can't be fully reached whatever stands on it)
  const bar = openFraction(nav) - 0.01;
  nav = new Nav(tiles, w, h, obstacles.map((o) => o.shape));
  nav.computeReach(sx, sz);
  while (obstacles.length && openFraction(nav) < bar) {
    obstacles.pop();
    nav = new Nav(tiles, w, h, obstacles.map((o) => o.shape));
    nav.computeReach(sx, sz);
  }

  // coins: lone ones, short lines and arcs, only where the mower can get
  const coins: CoinDef[] = [];
  const nCoins = Math.min(5 + index, 22);
  const okCoin = (x: number, z: number) => {
    if (!nav.reachable(x, z) || nav.blocked(x, z, 0.5) || !inside(x, z, 0.45)) return false;
    if (Math.hypot(x - sx, z - sz) < 1.2) return false;
    for (const c of coins) if (Math.hypot(c.x - x, c.z - z) < 0.75) return false;
    return true;
  };
  let tries = 0;
  while (coins.length < nCoins && tries++ < 400) {
    const px = rng.range(-w / 2, w / 2);
    const pz = rng.range(-h / 2, h / 2);
    const pattern = rng.next();
    if (pattern < 0.45) {
      if (okCoin(px, pz)) coins.push({ x: px, z: pz });
    } else if (pattern < 0.78) {
      const a = rng.range(0, Math.PI * 2);
      const n = rng.int(3, 5);
      for (let k = 0; k < n && coins.length < nCoins; k++) {
        const x = px + Math.cos(a) * k * 0.9;
        const z = pz + Math.sin(a) * k * 0.9;
        if (okCoin(x, z)) coins.push({ x, z });
      }
    } else {
      const n = rng.int(4, 6);
      const r = rng.range(0.9, 1.3);
      const a0 = rng.range(0, Math.PI * 2);
      for (let k = 0; k < n && coins.length < nCoins; k++) {
        const a = a0 + (k / n) * Math.PI * 2;
        const x = px + Math.cos(a) * r;
        const z = pz + Math.sin(a) * r;
        if (okCoin(x, z)) coins.push({ x, z });
      }
    }
  }

  // flowers dotted through the long grass
  const flowers: FlowerDef[] = [];
  const nFlowers = Math.round(area * 0.75);
  tries = 0;
  while (flowers.length < nFlowers && tries++ < nFlowers * 12) {
    const px = rng.range(-w / 2, w / 2);
    const pz = rng.range(-h / 2, h / 2);
    if (!nav.coverable(px, pz) || nav.solidAt(px, pz, 0.3) || !inside(px, pz, 0.12)) continue;
    if (Math.hypot(px - sx, pz - sz) < 0.9) continue;
    const color = rng.pick(theme.blooms);
    const n = rng.chance(0.5) ? 1 : rng.int(2, 3);
    for (let k = 0; k < n; k++) {
      const x = px + rng.range(-0.28, 0.28);
      const z = pz + rng.range(-0.28, 0.28);
      if (!nav.coverable(x, z) || nav.solidAt(x, z, 0.25) || !inside(x, z, 0.08)) continue;
      flowers.push({ x, z, color: rng.chance(0.2) ? rng.pick(theme.blooms) : color, h: rng.range(0.5, 0.72) });
    }
  }

  return {
    index,
    name: `Lawn ${index}`,
    theme,
    w,
    h,
    tiles,
    obstacles,
    coins,
    flowers,
    start: { x: sx, z: sz, heading: Math.PI },
    nav,
    tileCount,
  };
}

function makeObstacle(kind: ObstacleKind, rng: Rng, index: number): ObstacleDef {
  const o: ObstacleDef = {
    kind,
    x: 0,
    z: 0,
    size: 0.5,
    hw: 0,
    hd: 0,
    rot: rng.range(0, Math.PI * 2),
    height: 0.5,
    seed: rng.int(1, 1e9),
    shape: { t: 0, x: 0, z: 0, r: 0.5 },
  };
  const horiz = rng.chance(0.5);
  switch (kind) {
    case 'rock':
      o.size = rng.range(0.42, 0.78);
      o.height = o.size * 0.9;
      break;
    case 'bush':
      o.size = rng.range(0.5, 0.72);
      o.height = o.size * 1.4;
      break;
    case 'tree':
      o.size = rng.range(0.9, 1.15);
      o.height = 2.5 * o.size;
      break;
    case 'gnome':
      o.size = 0.24;
      o.height = 0.8;
      break;
    case 'lantern':
      o.size = 0.17;
      o.height = 1.5;
      break;
    case 'pond':
      o.size = rng.range(1.0, 1.55 + Math.min(index, 20) * 0.015);
      o.height = 0.05;
      break;
    case 'bed':
      o.hw = rng.range(0.7, 1.3);
      o.hd = rng.range(0.42, 0.62);
      o.rot = horiz ? 0 : Math.PI / 2;
      o.height = 0.7;
      break;
    case 'hedge':
      o.hw = rng.range(0.9, 1.9);
      o.hd = 0.3;
      o.rot = horiz ? 0 : Math.PI / 2;
      o.height = 1.0;
      break;
    case 'fence':
      o.hw = rng.range(1.1, 2.2);
      o.hd = 0.12;
      o.rot = horiz ? 0 : Math.PI / 2;
      o.height = 0.8;
      break;
    case 'bench':
      o.hw = 0.62;
      o.hd = 0.28;
      o.rot = horiz ? 0 : Math.PI / 2;
      o.height = 0.9;
      break;
    case 'table':
      o.hw = 0.78;
      o.hd = 0.5;
      o.rot = horiz ? 0 : Math.PI / 2;
      o.height = 0.9;
      break;
  }
  return o;
}

/** Fit the collider to wherever the obstacle now stands. */
function placeShape(o: ObstacleDef) {
  const boxy = o.kind === 'bed' || o.kind === 'hedge' || o.kind === 'fence' || o.kind === 'bench' || o.kind === 'table';
  if (boxy) {
    const vertical = Math.abs(Math.sin(o.rot)) > 0.5;
    const hw = vertical ? o.hd : o.hw;
    const hd = vertical ? o.hw : o.hd;
    o.shape = { t: 1, x0: o.x - hw, z0: o.z - hd, x1: o.x + hw, z1: o.z + hd };
    return;
  }
  const r = o.kind === 'tree' ? 0.34 * o.size : o.kind === 'bush' ? o.size * 0.95 : o.kind === 'pond' ? o.size : o.kind === 'rock' ? o.size * 0.92 : o.size;
  o.shape = { t: 0, x: o.x, z: o.z, r };
}
