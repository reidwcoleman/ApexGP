// Every pixel in the game is painted here at boot: trees, ground, buildings, machines, people, icons.
import { C, canvas, hash, bayer, mix } from './pal';
import { SPECIES, BUILDINGS } from './data.ts';

type G = CanvasRenderingContext2D;
const R = (g: G, c: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

// ---- trees ----------------------------------------------------------------------------------------------
export const STAGE_PX = [5, 8, 11, 15, 19, 23, 28, 37, 52];
export interface TreeOpts { sp: number; px: number; shape: number; snow: number; sway: number; dead?: boolean; gold?: boolean; sick?: boolean; seed?: number }

export function paintTree(g: G, cx: number, base: number, o: TreeOpts) {
  const S = SPECIES[o.sp]; let ramp: readonly string[] = S.ramp; const Hh = o.px, seed = o.seed ?? 1;
  if (o.dead) ramp = [C.dbrown, C.bark, C.brown, C.tan];
  if (o.sick) ramp = ['#4a3a1e', '#7a5c26', '#a8843a', '#d4b860'];
  if (o.gold) ramp = ['#a06a14', '#dca426', '#fbdc56', '#fff6c4'];
  if (Hh < 4) { R(g, ramp[1], cx, base - Hh + 1, 1, Hh); if (Hh > 1) R(g, ramp[2], cx, base - Hh + 1); return; }
  const trunk = Math.max(1, Math.round(Hh * 0.09)), crown = Hh - trunk, half = Math.max(1.5, Hh * (S.style === 'pine' ? 0.42 : S.style === 'spruce' ? 0.4 : S.style === 'noble' ? 0.39 : 0.37));
  R(g, C.bark, cx - (Hh > 22 ? 1 : 0), base - trunk + 1, Hh > 22 ? 2 : 1, trunk);
  const tiers = Math.max(1, Math.min(7, Math.round(crown / (S.style === 'noble' ? 7 : S.style === 'pine' ? 6.5 : 5.5))));
  const rough = (2 - o.shape) * (S.style === 'pine' ? 1.3 : 0.9) + (S.style === 'pine' ? 0.5 : 0.15);
  const notch = S.style === 'noble' ? 0.62 : S.style === 'spruce' ? 0.5 : S.style === 'pine' ? 0.34 : 0.42;
  for (let r = 0; r < crown; r++) {
    const y = base - trunk - crown + 1 + r, t = (r + 0.8) / crown, tt = t * tiers, ti = Math.min(tiers - 1, Math.floor(tt)), f = tt - ti;
    let hw = half * (Math.pow(t, 0.92) * (1 - notch) + ((ti + f) / tiers) * notch * (0.45 + 0.55 * f) * 1.32);
    hw = Math.max(0.5, hw);
    const sway = o.sway * (1 - t) * 1.4;
    const jl = (hash(r, 11, seed) - 0.5) * rough * 2 * (0.4 + t), jr = (hash(r, 23, seed) - 0.5) * rough * 2 * (0.4 + t);
    const x0 = Math.round(cx - hw + jl + sway), x1 = Math.round(cx + hw + jr + sway);
    for (let x = x0; x <= x1; x++) {
      const u = (x - cx - sway) / Math.max(1, hw);
      let v = 0.5 - u * 0.36 + (f - 0.55) * 0.42 + (hash(x, y, seed + 3) - 0.5) * 0.34;
      if (S.style === 'pine') v += (hash(x >> 1, y >> 1, seed) - 0.5) * 0.3;
      const k = v + (bayer(x, y) - 0.5) * 0.22;
      const c = k < 0.27 ? ramp[0] : k < 0.56 ? ramp[1] : k < 0.82 ? ramp[2] : ramp[3];
      R(g, c, x, y);
      if (o.snow > 0 && f < 0.2 * o.snow + 0.05 && hash(x, y, seed + 9) < (0.35 + 0.4 * o.snow - f) * (u > 0.45 ? 0.5 : 1)) R(g, u < 0.2 ? C.white : C.ice, x, y);
    }
  }
}

const treeCache = new Map<string, HTMLCanvasElement>();
/** a baked tree: canvas is (w x h), base centre at (w/2, h-1) */
export function treeSprite(sp: number, px: number, shape: number, snow: number, sway: number, kind: 0 | 1 | 2 | 3, seed: number) {
  const key = `${sp}.${px}.${shape}.${snow}.${sway}.${kind}.${seed}`;
  let c = treeCache.get(key); if (c) return c;
  const w = Math.ceil(px * 1.05) + 8, r = canvas(w, px + 2);
  paintTree(r.g, w >> 1, px + 1, { sp, px, shape, snow, sway, dead: kind === 1, gold: kind === 2, sick: kind === 3, seed });
  c = r.c; treeCache.set(key, c); return c;
}
export function resetTreeCache() { treeCache.clear(); }

// wild forest uses a darker, older tree
export function wildSprite(px: number, season: number, snow: number, v: number) {
  const key = `w${px}.${season}.${snow}.${v}`; let c = treeCache.get(key); if (c) return c;
  const sp = v % 2 ? 1 : 0, w = Math.ceil(px * 1.05) + 8, r = canvas(w, px + 2);
  if (v % 3 === 2 && px > 12) {
    // a broadleaf at the edge of the wood: this is what shows the seasons
    const leaf = season === 3 ? [C.bark, C.orange, C.gold, C.lemon] : season === 0 ? [C.bark, C.brown, C.tan, C.tan] : season === 1 ? [C.leaf, C.grass, C.lime, C.lemon] : [C.forest, C.pine, C.leaf, C.grass];
    const g = r.g, cx = w >> 1, b = px + 1; R(g, C.bark, cx, b - px * 0.5, 2, px * 0.5);
    const rr = px * 0.36, cy = b - px * 0.62;
    if (season !== 0) for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
      const d = Math.hypot(x, y) / rr + (hash(x | 0, y | 0, v) - 0.5) * 0.3; if (d > 1) continue;
      const k = 0.55 - x / rr * 0.3 - y / rr * 0.3 + (bayer(x + 8 | 0, y + 8 | 0) - 0.5) * 0.3;
      R(g, leaf[k < 0.3 ? 0 : k < 0.6 ? 1 : k < 0.85 ? 2 : 3], Math.round(cx + x), Math.round(cy + y));
    } else for (let k = 0; k < 7; k++) { const a = -2.6 + k * 0.35, L = rr * (0.7 + hash(k, v) * 0.4); for (let q = 0; q < L; q++) R(g, C.bark, Math.round(cx + Math.cos(a) * q), Math.round(cy + rr * 0.4 + Math.sin(a) * q)); if (snow) R(g, C.white, Math.round(cx + Math.cos(a) * L), Math.round(cy + rr * 0.4 + Math.sin(a) * L)); }
  } else paintTree(r.g, w >> 1, px + 1, { sp: sp ? 3 : 1, px, shape: 0, snow: snow / 3, sway: 0, seed: 40 + v });
  c = r.c; treeCache.set(key, c); return c;
}

// ---- ground ---------------------------------------------------------------------------------------------
export interface GroundPal { g0: string; g1: string; g2: string; g3: string; soil: string; soil2: string; road: string; road2: string; water: string; water2: string; rock: string; rock2: string }
export function groundPal(season: number, snow: number, dry: boolean): GroundPal {
  const base = [
    { g0: '#7da35a', g1: '#769c56', g2: '#5c8446', g3: '#9dbb6a' },
    { g0: '#79b84f', g1: '#72b04b', g2: '#57963e', g3: '#a6d264' },
    { g0: '#6ca648', g1: '#669e45', g2: '#4d8638', g3: '#8fbf56' },
    { g0: '#94a84e', g1: '#8ca04a', g2: '#6f8a3e', g3: '#bfb85a' },
  ][season];
  let p: GroundPal = { ...base, soil: '#6b4a32', soil2: '#59402d', road: '#a8976f', road2: '#8e7d5c', water: '#3f6fb0', water2: '#5a8fc8', rock: '#8b8c9a', rock2: '#62636f' };
  if (dry) p = { ...p, g0: mix(p.g0, C.tan, 0.5), g1: mix(p.g1, C.tan, 0.5), g2: mix(p.g2, C.brown, 0.4), g3: mix(p.g3, C.lemon, 0.4), soil: mix(p.soil, C.tan, 0.3) };
  if (snow >= 2) {
    const k = snow === 3 ? 1 : 0.7;
    p = { ...p, g0: mix(p.g0, '#e8f0f4', k), g1: mix(p.g1, '#e2ecf2', k), g2: mix(p.g2, '#bcd2e4', k), g3: mix(p.g3, '#f7f5ea', k), soil: mix(p.soil, '#b4c8da', 0.8), soil2: mix(p.soil2, '#9fb6cc', 0.8), road: mix(p.road, '#c0c8d0', 0.75), road2: mix(p.road2, '#9aa4b4', 0.7), water: '#5a86b8', water2: '#c9e8f2', rock: '#d8e4ec', rock2: '#8e9cb0' };
  } else if (snow === 1) { p = { ...p, g0: mix(p.g0, '#e8f0f4', 0.2), g3: '#e8f0f4' }; }
  return p;
}
/** a single ground tile at any scale, drawn into a chunk */
export function groundTile(g: G, p: GroundPal, kind: number, x: number, y: number, px: number, py: number, s: number, planted: boolean, n: (dx: number, dy: number) => number) {
  if (kind === 2) {
    R(g, p.water, px, py, s, s);
    if (s >= 8) { for (let k = 0; k < s / 4; k++) R(g, p.water2, px + ((hash(x, y, k) * s) | 0), py + ((hash(x, y, k + 9) * s) | 0), s >= 16 ? 3 : 2, 1); const shore = '#b8d4a0'; if (n(0, -1) !== 2) R(g, shore, px, py, s, 1); if (n(-1, 0) !== 2) R(g, shore, px, py, 1, s); if (n(1, 0) !== 2) R(g, shore, px + s - 1, py, 1, s); if (n(0, 1) !== 2) R(g, shore, px, py + s - 1, s, 1); }
    return;
  }
  if (kind === 5) { R(g, p.road2, px, py, s, s); if (s >= 8) for (let k = 0; k < s; k += 4) R(g, C.bark, px + k, py, 1, s); return; }
  if (s <= 2) { R(g, kind === 1 ? p.road : kind === 3 ? p.rock : planted ? p.soil : (hash(x >> 1, y >> 1) > 0.5 ? p.g0 : p.g1), px, py, s, s); return; }
  const v = hash(x, y);
  R(g, Math.sin(x * 0.37 + Math.sin(y * 0.23) * 2) + Math.sin(y * 0.31 + x * 0.11) + v * 1.4 > 0.7 ? p.g0 : p.g1, px, py, s, s);
  if (s >= 8) {
    const dots = s >= 16 ? 7 : 3;
    for (let k = 0; k < dots; k++) { const a = hash(x, y, k + 1), b = hash(x, y, k + 21); R(g, a > 0.55 ? p.g2 : p.g3, px + ((a * s) | 0), py + ((b * s) | 0), 1, s >= 16 && k % 3 === 0 ? 2 : 1); }
    if (s >= 16 && v > 0.93) { const fl = [C.white, C.gold, C.pink][(v * 100 | 0) % 3]; R(g, fl, px + 5, py + 6); R(g, fl, px + 7, py + 8); }
  }
  if (planted) {
    if (s >= 16) { const c = mix(p.soil, p.g2, 0.45); R(g, c, px + 5, py + 11, 6, 4); R(g, c, px + 4, py + 12, 8, 2); } else if (s >= 8) R(g, p.soil, px + 2, py + 4, 4, 3); else R(g, p.soil, px, py, s, s);
  }
  if (kind === 1) {
    R(g, p.road, px, py, s, s);
    if (s >= 8) { for (let k = 0; k < s; k++) { if (hash(x, y, k) > 0.6) R(g, p.road2, px + ((hash(x, y, k + 5) * s) | 0), py + ((hash(x, y, k + 6) * s) | 0)); } if (n(0, -1) !== 1 && n(0, -1) !== 5) for (let k = 0; k < s; k += 2) R(g, p.g2, px + k, py, 1, 1 + ((hash(x + k, y) * 2) | 0)); if (n(0, 1) !== 1 && n(0, 1) !== 5) for (let k = 0; k < s; k += 2) R(g, p.g2, px + k, py + s - 1 - ((hash(x + k, y, 2) * 2) | 0), 1, 2); if (n(-1, 0) !== 1 && n(-1, 0) !== 5) R(g, p.g2, px, py, 1, s); if (n(1, 0) !== 1 && n(1, 0) !== 5) R(g, p.g2, px + s - 1, py, 1, s); }
  }
  if (kind === 3) {
    R(g, p.g2, px, py, s, s); const m = Math.max(1, s >> 3);
    R(g, p.rock2, px + m, py + m * 2, s - m * 2, s - m * 3); R(g, p.rock, px + m * 2, py + m, s - m * 4, s - m * 4);
    if (s >= 16) { R(g, C.white, px + 5, py + 3, 3, 1); R(g, p.rock2, px + 9, py + 6, 2, 3); }
  }
}

// ---- buildings ------------------------------------------------------------------------------------------
const roofRows = (g: G, x: number, y: number, w: number, h: number, a: string, b: string) => { for (let j = 0; j < h; j++) { R(g, j % 3 === 2 ? b : a, x, y + j, w, 1); } };
export function buildingSprite(k: string, snow: boolean, lit: boolean) {
  const key = `${k}.${snow}.${lit}`; let c = bCache.get(key); if (c) return c;
  const d = BUILDINGS[k], top = 26, W = d.w * 16, H = d.h * 16 + top, r = canvas(W, H), g = r.g, cap = (x: number, y: number, w: number, h = 3) => { if (snow) { R(g, C.white, x, y, w, h); for (let i = 0; i < w; i += 3) R(g, C.ice, x + i, y + h, 2, 1); } };
  const win = (x: number, y: number, w = 7, h = 7) => { R(g, C.white, x - 1, y - 1, w + 2, h + 2); R(g, lit ? C.gold : C.dusk, x, y, w, h); R(g, lit ? C.lemon : C.blue, x, y, w >> 1, h >> 1); R(g, C.white, x + (w >> 1), y, 1, h); R(g, C.white, x, y + (h >> 1), w, 1); };
  const shadow = () => { g.globalAlpha = 0.3; R(g, C.ink, 2, H - 3, W - 2, 3); g.globalAlpha = 1; };
  switch (k) {
    case 'house': {
      shadow();
      R(g, C.cream, 6, 40, 68, H - 44); for (let y = 42; y < H - 4; y += 4) R(g, C.tan, 6, y, 68, 1);
      R(g, C.tan, 6, H - 8, 68, 4);
      roofRows(g, 2, 16, 76, 25, C.dred, '#651823'); R(g, C.red, 2, 16, 76, 2); R(g, '#651823', 2, 40, 76, 2);
      R(g, C.bark, 56, 2, 9, 20); R(g, C.brown, 56, 2, 9, 3); cap(55, 1, 11, 2);
      cap(2, 13, 76, 5);
      win(14, 50, 9, 9); win(56, 50, 9, 9); R(g, C.pine, 34, 50, 13, H - 54); R(g, C.gold, 44, 62, 1, 2); R(g, C.bark, 30, 46, 21, 3); R(g, C.white, 33, 49, 15, 1);
      R(g, C.leaf, 36, 52, 9, 9); R(g, C.pine, 38, 54, 5, 5); R(g, C.red, 40, 60, 1, 2);
      break;
    }
    case 'barn': {
      shadow();
      R(g, C.red, 4, 38, 72, H - 42); for (let x = 6; x < 76; x += 4) R(g, C.dred, x, 38, 1, H - 42);
      for (let j = 0; j < 22; j++) { const w = 36 + j * 1.8; R(g, j < 2 ? C.white : C.dgrey, 40 - w / 2 + (j > 16 ? 0 : 0), 18 + j, w, 1); if (j % 3 === 2) R(g, '#3e3f4e', 40 - w / 2, 18 + j, w, 1); }
      R(g, C.white, 2, 38, 76, 2); cap(22, 14, 36, 4); if (snow) for (let j = 0; j < 20; j += 1) { const w = 36 + j * 1.8; R(g, C.white, 40 - w / 2, 18 + j, 2, 1); R(g, C.white, 40 + w / 2 - 3, 18 + j, 2, 1); }
      R(g, C.dbrown, 24, 50, 32, H - 54); R(g, C.white, 24, 50, 32, 2); R(g, C.white, 24, 50, 2, H - 54); R(g, C.white, 54, 50, 2, H - 54); R(g, C.white, 39, 50, 2, H - 54);
      for (let i = 0; i < 28; i++) { R(g, C.white, 26 + i, 52 + i * ((H - 56) / 28) | 0, 2, 1); R(g, C.white, 54 - i, 52 + i * ((H - 56) / 28) | 0, 2, 1); }
      win(36, 26, 8, 8);
      break;
    }
    case 'lot': {
      for (const [x, y] of [[0, 28], [W - 2, 28], [0, H - 14], [W - 2, H - 14]]) R(g, C.bark, x, y, 2, 20);
      for (let i = 0; i < W; i += 1) { const s = Math.sin(i / W * Math.PI) * 6; R(g, C.dbrown, i, 28 + s, 1, 1); if (i % 6 === 3) R(g, [C.red, C.gold, C.aqua, C.pink][(i / 6 | 0) % 4], i, 29 + s, 2, 2); }
      for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) {
        const x = 7 + i * 12 + (row % 2) * 3, y = 34 + row * 13;
        R(g, C.brown, x + 2, y + 13, 1, 2); paintTree(g, x + 2, y + 13, { sp: i % 3 === 0 ? 1 : 3, px: 14, shape: 2, snow: snow ? 0.8 : 0, sway: 0, seed: i + row * 7 });
      }
      R(g, C.red, 28, 4, 40, 14); R(g, C.dred, 28, 16, 40, 2); R(g, C.white, 30, 6, 36, 8); R(g, C.bark, 46, 18, 3, 14);
      R(g, C.red, 33, 8, 26, 1); R(g, C.pine, 33, 11, 30, 1);
      break;
    }
    case 'depot': {
      shadow(); R(g, C.tan, 3, 30, W - 6, H - 34); for (let x = 6; x < W; x += 5) R(g, C.brown, x, 30, 1, H - 34);
      R(g, C.dgrey, 0, 22, W, 9); R(g, C.grey, 0, 22, W, 2); cap(0, 20, W, 3); R(g, C.dbrown, 14, 36, 20, H - 40);
      break;
    }
    case 'cocoa': {
      shadow(); R(g, C.brown, 3, 34, 26, H - 38); R(g, C.tan, 3, 34, 26, 3); R(g, C.dbrown, 6, 38, 20, 9); R(g, C.gold, 8, 40, 16, 1);
      for (let x = 0; x < 32; x += 4) R(g, (x / 4) % 2 ? C.red : C.white, x, 22, 4, 11); R(g, C.dred, 0, 33, 32, 1); cap(0, 20, 32, 3);
      R(g, C.white, 12, 40, 4, 4); R(g, C.bark, 13, 41, 2, 2);
      break;
    }
    case 'santa': {
      shadow(); R(g, C.bark, 4, 32, 40, H - 36); for (let y = 34; y < H - 4; y += 4) R(g, C.dbrown, 4, y, 40, 1);
      for (let j = 0; j < 16; j++) R(g, j % 3 === 2 ? C.dred : C.red, 24 - (10 + j * 1.4), 16 + j, (10 + j * 1.4) * 2, 1);
      cap(13, 13, 22, 4); R(g, C.pine, 19, 42, 10, H - 46); win(8, 40, 6, 6); win(34, 40, 6, 6); R(g, C.gold, 23, 8, 2, 5);
      break;
    }
    case 'sleigh': {
      shadow(); R(g, C.white, 4, H - 10, W - 8, 2);
      R(g, C.red, 18, H - 30, 34, 16); R(g, C.dred, 18, H - 16, 34, 2); R(g, C.gold, 18, H - 30, 34, 2); R(g, C.gold, 14, H - 12, 44, 2); R(g, C.gold, 12, H - 18, 2, 7); R(g, C.gold, 56, H - 18, 2, 6);
      R(g, C.brown, 44, H - 42, 12, 12); for (let i = 0; i < 2; i++) { R(g, C.bark, 2 + i * 7, H - 24, 2, 10); }
      break;
    }
    case 'greenhouse': {
      shadow(); R(g, C.ice, 3, 36, W - 6, H - 40); for (let x = 3; x < W - 3; x += 10) R(g, C.white, x, 26, 1, H - 30); for (let y = 36; y < H - 4; y += 9) R(g, C.white, 3, y, W - 6, 1);
      for (let j = 0; j < 14; j++) R(g, j % 3 ? C.sky : C.ice, 3 + j / 2, 22 + j, W - 6 - j, 1); R(g, C.white, 3, 36, W - 6, 1); cap(8, 19, W - 16, 3);
      for (let x = 8; x < W - 8; x += 6) { R(g, C.leaf, x, H - 12, 3, 5); R(g, C.grass, x + 1, H - 15, 1, 3); }
      break;
    }
    case 'kennel': {
      shadow(); R(g, C.brown, 5, 34, 22, H - 38); R(g, C.dbrown, 12, 42, 9, H - 46);
      for (let j = 0; j < 11; j++) R(g, j % 2 ? C.red : C.dred, 16 - 4 - j * 1.1, 23 + j, 8 + j * 2.2, 1); cap(10, 21, 12, 3);
      break;
    }
    case 'sprinkler': {
      R(g, C.grey, 7, H - 8, 2, 7); R(g, C.lgrey, 5, H - 9, 6, 2); R(g, C.sky, 3, H - 12, 1, 2); R(g, C.sky, 12, H - 12, 1, 2);
      break;
    }
    case 'helipad': {
      R(g, C.dgrey, 0, top, W, H - top); R(g, C.gold, 2, top + 2, W - 4, 1); R(g, C.gold, 2, H - 3, W - 4, 1); R(g, C.gold, 2, top + 2, 1, H - top - 4); R(g, C.gold, W - 3, top + 2, 1, H - top - 4);
      const cy = (top + H) / 2; R(g, C.white, 22, cy - 14, 5, 28); R(g, C.white, 37, cy - 14, 5, 28); R(g, C.white, 22, cy - 2, 20, 5);
      break;
    }
  }
  c = r.c; bCache.set(key, c); return c;
}
const bCache = new Map<string, HTMLCanvasElement>();
export const BLD_TOP = 26;

// ---- people and machines --------------------------------------------------------------------------------
export interface Look { hat: string; coat: string; skin: string; pants: string }
export function person(look: Look, dir: number, frame: number, carry = false) {
  const key = `p${look.hat}${look.coat}${look.skin}${look.pants}${dir}${frame}${carry}`; let c = bCache.get(key); if (c) return c;
  const r = canvas(11, 16), g = r.g, sw = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  R(g, 'rgba(18,18,28,.3)', 2, 14, 7, 2);
  if (dir === 1 || dir === 3) { const f = dir === 1 ? 1 : -1; R(g, look.pants, 4 + sw, 11, 2, 3); R(g, look.pants, 5 - sw, 11, 2, 3); R(g, look.coat, 3, 6, 5, 5); R(g, look.skin, 3, 2, 5, 4); R(g, look.hat, 3, 1, 5, 2); R(g, look.hat, f > 0 ? 7 : 2, 3, 2, 1); R(g, C.ink, f > 0 ? 6 : 4, 4); R(g, mix(look.coat, C.ink, 0.3), 5 + sw, 7, 2, 3); }
  else {
    R(g, look.pants, 3, 11 + (sw > 0 ? -1 : 0), 2, 3); R(g, look.pants, 6, 11 + (sw < 0 ? -1 : 0), 2, 3); R(g, look.coat, 2, 6, 7, 5); R(g, mix(look.coat, C.ink, 0.3), 2, 10, 7, 1); R(g, look.skin, 1, 7 + sw, 1, 2); R(g, look.skin, 9, 7 - sw, 1, 2);
    R(g, look.skin, 3, 2, 5, 4); R(g, look.hat, 3, 0, 5, 3); if (dir === 2) { R(g, C.ink, 4, 4); R(g, C.ink, 6, 4); R(g, look.hat, 2, 2, 7, 1); } else R(g, look.hat, 3, 2, 5, 4);
  }
  if (carry) { R(g, C.pine, 0, 3, 10, 3); R(g, C.leaf, 1, 2, 7, 2); }
  c = r.c; bCache.set(key, c); return c;
}

/** dir: 0 up, 1 right, 2 down, 3 left */
export function machine(kind: number, dir: number, frame: number, tint: string, load: number) {
  const key = `m${kind}.${dir}.${frame}.${tint}.${load}`; let c = bCache.get(key); if (c) return c;
  const side = dir === 1 || dir === 3, flip = dir === 3;
  const W = [0, 26, 34, 62, 90][kind], Hh = [0, 22, 30, 44, 56][kind], r = canvas(W, Hh), g = r.g;
  const dark = mix(tint, C.ink, 0.4), lite = mix(tint, C.white, 0.35);
  const load_ = (x: number, y: number, w: number) => { for (let i = 0; i < load; i++) { const yy = y - (i >> 1) * 2, xx = x + (i % 2) * 2; R(g, C.bark, xx, yy + 1, w, 1); R(g, C.pine, xx + 1, yy - 1, w - 2, 2); R(g, C.leaf, xx + 2, yy - 1, w - 5, 1); } };
  const wheel = (x: number, y: number, s: number) => { R(g, C.ink, x, y, s, s); R(g, C.dgrey, x + 1, y + 1, s - 2, s - 2); R(g, frame ? C.lgrey : C.grey, x + (s >> 1) - 1, y + (s >> 1) - 1, 2, 2); };
  R(g, 'rgba(18,18,28,.3)', 2, Hh - 4, W - 4, 4);
  if (kind === 1) {
    if (side) { R(g, C.tan, 0, 9, 9, 6); R(g, C.brown, 0, 14, 9, 1); load_(1, 8, 7); wheel(2, 14, 5); R(g, C.dgrey, 8, 13, 3, 1); R(g, tint, 11, 8, 12, 6); R(g, dark, 11, 12, 12, 2); R(g, lite, 13, 8, 7, 1); R(g, C.ink, 19, 4, 1, 4); R(g, C.lgrey, 17, 4, 5, 1); wheel(10, 14, 6); wheel(19, 14, 6); }
    else { R(g, tint, 8, 8, 10, 9); R(g, dark, 8, 14, 10, 3); R(g, C.lgrey, 6, 5, 14, 1); wheel(4, 11, 5); wheel(17, 11, 5); if (dir === 0) { R(g, C.tan, 8, 15, 10, 4); load_(9, 14, 7); } else R(g, C.gold, 11, 10, 4, 2); }
  } else if (kind === 2) {
    if (side) { R(g, tint, 15, 12, 17, 8); R(g, dark, 15, 18, 17, 2); R(g, lite, 17, 12, 13, 1); for (let x = 25; x < 31; x += 2) R(g, dark, x, 14, 1, 3); R(g, C.ink, 27, 5, 2, 7); R(g, C.lgrey, 26, 4, 4, 1); R(g, C.dgrey, 7, 7, 13, 1); R(g, C.ice, 9, 8, 9, 7); R(g, C.dgrey, 8, 8, 1, 7); R(g, C.dgrey, 18, 8, 1, 7); R(g, tint, 7, 15, 13, 3); wheel(4, 15, 13); wheel(24, 20, 8); R(g, C.tan, 0, 17, 5, 3); load_(0, 13, 8); }
    else { R(g, tint, 10, 8, 14, 15); R(g, dark, 10, 19, 14, 4); R(g, C.ice, 12, 3, 10, 7); R(g, C.dgrey, 11, 2, 12, 1); wheel(3, 15, 8); wheel(23, 15, 8); if (dir === 2) { R(g, C.lgrey, 13, 13, 8, 2); R(g, C.gold, 12, 20, 2, 2); R(g, C.gold, 20, 20, 2, 2); } else load_(13, 22, 7); }
  } else if (kind === 3) {
    if (side) {
      R(g, tint, 8, 14, 40, 18); R(g, dark, 8, 28, 40, 4); R(g, lite, 10, 14, 36, 1); R(g, C.gold, 8, 22, 40, 2);
      R(g, C.ice, 32, 3, 14, 12); R(g, C.dgrey, 31, 2, 16, 2); R(g, tint, 30, 14, 18, 2); load_(10, 13, 9);
      wheel(10, 28, 14); wheel(34, 30, 12);
      R(g, C.dgrey, 48, 22, 4, 3); R(g, C.lgrey, 50, 16 + frame, 10, 20); for (let y = 17; y < 36; y += 4) R(g, frame ? C.gold : C.dgrey, 51, y + frame * 2, 8, 2);
    } else { R(g, tint, 16, 10, 30, 26); R(g, dark, 16, 30, 30, 6); R(g, C.ice, 22, 3, 18, 10); R(g, C.dgrey, 21, 2, 20, 2); wheel(8, 24, 10); wheel(44, 24, 10); if (dir === 2) { R(g, C.lgrey, 0, 33, W, 6); for (let x = 2; x < W; x += 5) R(g, frame ? C.gold : C.dgrey, x + frame * 2, 34, 3, 4); } else load_(24, 28, 12); }
  } else if (kind === 4) {
    const cy = 28; R(g, tint, 30, cy - 8, 34, 16); R(g, dark, 30, cy + 4, 34, 4); R(g, C.ice, 54, cy - 6, 10, 8); R(g, lite, 34, cy - 8, 20, 1); R(g, tint, 4, cy - 3, 28, 5); R(g, dark, 4, cy, 28, 2); R(g, tint, 3, cy - 10, 4, 8); R(g, C.lgrey, 1, cy - 12 + frame * 2, 8, 2); R(g, C.dgrey, 44, cy - 13, 3, 5);
    if (frame) R(g, C.lgrey, 6, cy - 14, 80, 1); else { R(g, C.lgrey, 20, cy - 15, 52, 1); R(g, C.grey, 40, cy - 17, 12, 4); }
    R(g, C.gold, 30, cy + 8, 34, 1); R(g, C.dgrey, 36, cy + 9, 1, 3); R(g, C.dgrey, 58, cy + 9, 1, 3); R(g, C.lgrey, 32, cy + 12, 30, 1);
  }
  if (flip) { const f = canvas(W, Hh); f.g.translate(W, 0); f.g.scale(-1, 1); f.g.drawImage(r.c, 0, 0); c = f.c; } else c = r.c;
  bCache.set(key, c); return c;
}

export function deerSprite(dir: number, frame: number) {
  const key = `d${dir}${frame}`; let c = bCache.get(key); if (c) return c;
  const r = canvas(16, 14), g = r.g; R(g, 'rgba(18,18,28,.3)', 2, 12, 12, 2);
  R(g, C.brown, 3, 5, 9, 4); R(g, C.tan, 4, 7, 6, 2); R(g, C.brown, 11, 2, 3, 4); R(g, C.ink, 14, 3); R(g, C.white, 2, 5);
  for (const x of [3, 5, 9, 11]) R(g, C.bark, x + (frame && x % 4 === 1 ? 1 : 0), 9, 1, 3);
  R(g, C.bark, 11, 0, 1, 2); R(g, C.bark, 13, 0, 1, 2);
  if (dir === 3) { const f = canvas(16, 14); f.g.translate(16, 0); f.g.scale(-1, 1); f.g.drawImage(r.c, 0, 0); c = f.c; } else c = r.c;
  bCache.set(key, c); return c;
}
export function dogSprite(dir: number, frame: number) {
  const key = `g${dir}${frame}`; let c = bCache.get(key); if (c) return c;
  const r = canvas(12, 9), g = r.g; R(g, 'rgba(18,18,28,.3)', 1, 7, 10, 2);
  R(g, C.tan, 2, 3, 7, 3); R(g, C.white, 8, 1, 3, 3); R(g, C.ink, 10, 2); R(g, C.brown, 8, 0, 1, 2); R(g, C.tan, 1, 2 + frame, 1, 2);
  for (const x of [2, 4, 7, 8]) R(g, C.bark, x, 6 - (frame && x % 4 === 0 ? 1 : 0), 1, 2);
  if (dir === 3) { const f = canvas(12, 9); f.g.translate(12, 0); f.g.scale(-1, 1); f.g.drawImage(r.c, 0, 0); c = f.c; } else c = r.c;
  bCache.set(key, c); return c;
}

// ---- icons ----------------------------------------------------------------------------------------------
export function icon(name: string, col: string = C.cream) {
  const key = `i${name}${col}`; let c = bCache.get(key); if (c) return c;
  const r = canvas(12, 12), g = r.g, P = (rows: string[]) => { rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') R(g, row[x] === 'o' ? col : row[x] === 'r' ? C.red : row[x] === 'g' ? C.gold : row[x] === 'l' ? C.leaf : row[x] === 'b' ? C.brown : row[x] === 'w' ? C.white : row[x] === 's' ? C.lgrey : C.sky, x, y); }); };
  const S: Record<string, string[]> = {
    saw: ['............', '........ss..', '.......sss..', '......sss...', '.....sss....', '....sss.....', '...bss......', '..bbb.......', '.bbb........', 'bbb.........', 'bb..........', '............'],
    plant: ['............', '.....ll.....', '....llll....', '..l.ll.l....', '..llllll....', '...llll.....', '....ll......', '....bb......', '..bbbbbb....', '.bbbbbbbb...', '............', '............'],
    shear: ['ss.......ss.', '.ss.....ss..', '..ss...ss...', '...ss.ss....', '....sss.....', '....sos.....', '...rr.rr....', '..r..r..r...', '..r..r..r...', '...rr..rr...', '............', '............'],
    tank: ['.....ss.....', '....ssss....', '.bbbbbbbbbb.', '.bcccccccccb'.slice(0, 12), '.bcccccccob.', '.bcccccccob.', '.bcccccccob.', '.bcccccccob.', '.bbbbbbbbbb.', '...b....b...', '............', '............'],
    block: ['oo.oo.oo.oo.', 'o..........o', '............', 'o..........o', 'o..........o', '............', 'o..........o', 'o..........o', '............', 'o..........o', 'oo.oo.oo.oo.', '............'],
    build: ['............', '.....rr.....', '...rrrrrr...', '.rrrrrrrrrr.', '..wwwwwwww..', '..wbbwwbbw..', '..wbbwwbbw..', '..wwwbbwww..', '..wwwbbwww..', '..wwwbbwww..', '............', '............'],
    land: ['............', '.ooo..ooo...', '.o.o..o.o...', '.ooo..ooo...', '............', '.ooo..ggg...', '.o.o..g.g...', '.ooo..ggg...', '............', '............', '............', '............'],
    shop: ['............', '...rrrrr....', '...r...rrr..', '.rrrrrrrrrr.', '.rrrrrrrrrr.', '.rrrrrrrrrr.', '.rrrrrrrrrr.', '..ss....ss..', '.ssss..ssss.', '..ss....ss..', '............', '............'],
    crew: ['............', '...oo.......', '..oooo......', '...oo...oo..', '..oooo.oooo.', '.oooooo.oo..', '.oooooooooo.', '.oooooooooo.', '..oo.oo.oo..', '..oo.oo.oo..', '............', '............'],
    ledger: ['.oooooooooo.', '.o........o.', '.o.oooo...o.', '.o........o.', '.o.oooooo.o.', '.o........o.', '.o.oooooo.o.', '.o........o.', '.o.ooo....o.', '.o........o.', '.oooooooooo.', '............'],
    market: ['............', '..........g.', '.........gg.', '........g.g.', '.......g..g.', '..o...g.....', '.o.o.g......', 'o...g.......', '............', 'oooooooooooo', '............', '............'],
    bank: ['.....oo.....', '...oooooo...', '.oooooooooo.', '............', '..oo.oo.oo..', '..oo.oo.oo..', '..oo.oo.oo..', '..oo.oo.oo..', '............', '.oooooooooo.', 'oooooooooooo', '............'],
    tree: ['.....l......', '....lll.....', '...lllll....', '....lll.....', '...lllll....', '..lllllll...', '...lllll....', '..lllllll...', '.lllllllll..', '.....b......', '.....b......', '............'],
    star: ['.....g......', '.....g......', '....ggg.....', 'ggggggggggg.', '.ggggggggg..', '..ggggggg...', '..ggggggg...', '.ggg...ggg..', '.g.......g..', '............', '............', '............'],
    pause: ['............', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '..ooo..ooo..', '............', '............'],
    play: ['............', '..oo........', '..oooo......', '..oooooo....', '..oooooooo..', '..oooooooo..', '..oooooo....', '..oooo......', '..oo........', '............', '............', '............'],
    ff: ['............', '.o....o.....', '.ooo..ooo...', '.ooooooooo..', '.oooooooooo.', '.oooooooooo.', '.ooooooooo..', '.ooo..ooo...', '.o....o.....', '............', '............', '............'],
    sound: ['............', '.....o......', '....oo..o...', '.ooooo...o..', '.ooooo...o..', '.ooooo...o..', '.ooooo...o..', '....oo..o...', '.....o......', '............', '............', '............'],
    bell: ['.....g......', '....ggg.....', '...ggggg....', '...ggggg....', '...ggggg....', '..ggggggg...', '..ggggggg...', '.ggggggggg..', '.....b......', '............', '............', '............'],
    bug: ['............', '...o...o....', '....ooo.....', '..ro.o.or...', '.rrrrrrrrr..', '..rrrrrrr...', '.rrrrrrrrr..', '..rrrrrrr...', '...rrrrr....', '............', '............', '............'],
    check: ['............', '..........g.', '.........gg.', '........gg..', '.......gg...', 'gg....gg....', '.gg..gg.....', '..gggg......', '...gg.......', '............', '............', '............'],
    x: ['............', '.rr.....rr..', '..rr...rr...', '...rr.rr....', '....rrr.....', '...rr.rr....', '..rr...rr...', '.rr.....rr..', '............', '............', '............', '............'],
  };
  P(S[name] ?? S.tree);
  c = r.c; bCache.set(key, c); return c;
}

export function carSprite(col: string, tree: boolean, dir: number) {
  const key = `c${col}${tree}${dir}`; let c = bCache.get(key); if (c) return c;
  const r = canvas(30, 18), g = r.g, dark = mix(col, C.ink, 0.4), lite = mix(col, C.white, 0.35);
  R(g, 'rgba(18,18,28,.3)', 2, 15, 26, 3);
  R(g, col, 2, 9, 26, 5); R(g, dark, 2, 13, 26, 1); R(g, lite, 4, 9, 22, 1); R(g, col, 8, 4, 14, 5); R(g, C.ice, 10, 5, 4, 3); R(g, C.ice, 16, 5, 4, 3); R(g, C.gold, 27, 10, 1, 2); R(g, C.red, 2, 10, 1, 2);
  for (const x of [5, 20]) { R(g, C.ink, x, 12, 5, 5); R(g, C.lgrey, x + 2, 14, 1, 1); }
  if (tree) { R(g, C.bark, 7, 3, 3, 1); for (let i = 0; i < 16; i++) { const h = 1 + Math.round((i / 16) * 2); R(g, i % 3 ? C.pine : C.leaf, 8 + i, 3 - h, 1, h); } R(g, C.tan, 11, 2, 1, 2); R(g, C.tan, 19, 2, 1, 2); }
  if (dir === 3) { const f = canvas(30, 18); f.g.translate(30, 0); f.g.scale(-1, 1); f.g.drawImage(r.c, 0, 0); c = f.c; } else c = r.c;
  bCache.set(key, c); return c;
}
export function thiefSprite(frame: number) {
  return person({ hat: C.ink, coat: C.purple, skin: C.pink, pants: C.ink }, 3, frame, true);
}
