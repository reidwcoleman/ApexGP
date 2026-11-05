// Every pixel in the game is painted here at boot: buildings, machines, people, props, icons, trim.
import { C, canvas, hash, mix, Buf, bayer as bayerq, u32 } from './pal';
import { BUILDINGS } from './data.ts';
import { paintTreeBuf, treeBuf, STAGE_PX, type TreeOpts } from './trees';
export { STAGE_PX };

type G = CanvasRenderingContext2D;
const R = (g: G, c: string, x: number, y: number, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const RIM = '#241a3c';
const bCache = new Map<string, HTMLCanvasElement>();
const once = (key: string, f: () => HTMLCanvasElement) => { let c = bCache.get(key); if (!c) { c = f(); bCache.set(key, c); } return c; };

// ---- trees ----------------------------------------------------------------------------------------------
const treeCache = new Map<string, HTMLCanvasElement>();
/** a baked tree: the trunk's foot sits at (w/2, h-2) */
export function treeSprite(sp: number, px: number, shape: number, snow: number, sway: number, kind: 0 | 1 | 2 | 3, seed: number, deco = 0, star = false) {
  const key = `${sp}.${px}.${shape}.${snow}.${sway}.${kind}.${seed}.${deco}.${star ? 1 : 0}`;
  let c = treeCache.get(key); if (c) return c;
  c = treeBuf({ sp, px, shape, snow, sway, dead: kind === 1, gold: kind === 2, sick: kind === 3, seed, deco, star }).bake(); treeCache.set(key, c); return c;
}
export function paintTree(g: G, cx: number, base: number, o: TreeOpts) { const b = treeBuf(o); g.drawImage(b.bake(), Math.round(cx - (b.w >> 1)), Math.round(base - b.h + 2)); }
export function resetTreeCache() { treeCache.clear(); }

const WILD_RAMP = ['#0a2a3c', '#10404a', '#17605c', '#2f8a72'], WILD_RAMP2 = ['#0c2440', '#143a52', '#1e5868', '#3a8488'];
export function wildSprite(px: number, snow: number, v: number) {
  const key = `w${px}.${snow}.${v}`; let c = treeCache.get(key); if (c) return c;
  if (v % 5 === 4 && px > 16) { // a bare birch among the firs
    const w = Math.ceil(px * 0.8) + 4, h = px + 3, b = new Buf(w, h), cx = w >> 1, base = h - 2;
    for (let y = 0; y < px * 0.8; y++) { b.px(cx, base - y, C.white); b.px(cx + 1, base - y, C.sn3); if (hash(y, v) > 0.7) b.px(cx, base - y, C.dgrey); }
    for (let k = 0; k < 7; k++) { const y0 = base - px * (0.32 + k * 0.08), s = k % 2 ? 1 : -1, L = px * (0.34 - k * 0.03); for (let q = 0; q < L; q++) { const X = cx + s * q, Y = y0 - q * 0.8; b.px(X, Y, C.dgrey); if (snow) b.px(X, Y - 1, C.white); } }
    b.outline(mix(C.sn5, C.ink, 0.45)); c = b.bake();
  } else c = treeBuf({ sp: 1, ramp: v % 2 ? WILD_RAMP : WILD_RAMP2, px, shape: 1, snow: snow >= 3 ? 2 : snow ? 1 : 0, sway: 0, seed: 40 + v }).bake();
  treeCache.set(key, c); return c;
}

/** a clean half-size copy for the mid zooms: blended, then hard-edged again so it still reads as pixels */
export function half(c: HTMLCanvasElement) {
  const key = c; let h = halves.get(key); if (h) return h;
  const w = Math.max(1, c.width >> 1), hh = Math.max(1, c.height >> 1), r = canvas(w, hh); r.g.imageSmoothingEnabled = true; r.g.imageSmoothingQuality = 'medium'; r.g.drawImage(c, 0, 0, w, hh);
  const im = r.g.getImageData(0, 0, w, hh), d = im.data; for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0; r.g.putImageData(im, 0, 0); h = r.c; halves.set(key, h); return h;
}
const halves = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

// ---- ground decals and props ----------------------------------------------------------------------------
/** soft blue shadow a tree lays on the snow, keyed on its stage */
export function treeShadow(st: number) {
  return once(`ts${st}`, () => {
    const w = Math.max(6, Math.round(STAGE_PX[st] * 0.86)) + 4, h = Math.max(3, Math.round(w * 0.36)), r = canvas(w, h);
    r.g.fillStyle = 'rgba(58,60,170,.3)'; for (let y = 0; y < h; y++) { const u = (y + 0.5) / h * 2 - 1, half = Math.sqrt(1 - u * u) * w / 2; r.g.fillRect(Math.round(w / 2 - half), y, Math.round(half * 2), 1); }
    return r.c;
  });
}
export function shadowBlob(w: number) {
  return once(`sb${w}`, () => {
    const h = Math.max(2, Math.round(w * 0.3)), r = canvas(w, h); r.g.fillStyle = 'rgba(40,40,130,.34)';
    for (let y = 0; y < h; y++) { const u = (y + 0.5) / h * 2 - 1, half = Math.sqrt(1 - u * u) * w / 2; r.g.fillRect(Math.round(w / 2 - half), y, Math.round(half * 2), 1); }
    return r.c;
  });
}
export function mound() {
  return once('mound', () => { const b = new Buf(12, 6); b.disc(6, 3, 5, 2, '#7a5a5e'); b.disc(5, 2, 3, 1, '#a07f76'); b.outline(C.sn4); return b.bake(); });
}
export function stump(snow: boolean) {
  return once(`stump${snow}`, () => {
    const b = new Buf(11, 9); b.rect(2, 3, 7, 5, C.bark); b.rect(2, 3, 2, 5, C.brown); b.rect(1, 7, 9, 1, C.bark); b.disc(5, 2, 3, 1, C.tan); b.px(5, 2, C.brown); b.px(4, 2, '#f2d29a');
    if (snow) { b.rect(3, 1, 3, 1, C.white); b.px(2, 2, C.white); } b.outline(RIM); return b.bake();
  });
}
export function snowman(v: number) {
  return once(`sman${v}`, () => {
    const b = new Buf(17, 23);
    b.disc(8, 16, 6, 5, C.sn1); b.disc(7, 15, 4, 3, C.sn0); b.disc(8, 9, 4, 4, C.sn1); b.disc(7, 8, 3, 3, C.sn0);
    for (let y = 12; y < 21; y++) b.over(13, y, C.sn3); b.rect(11, 18, 3, 2, C.sn3);
    b.px(7, 8, C.ink); b.px(10, 8, C.ink); b.rect(8, 10, 3, 1, C.orange); b.px(11, 10, '#c05a18');
    const hat = v % 2 ? C.red : C.ink; b.rect(5, 5, 7, 1, hat); b.rect(6, 1, 5, 4, hat); b.rect(6, 3, 5, 1, v % 2 ? C.white : C.dred);
    const sc = v % 2 ? C.leaf : C.red; b.rect(4, 12, 9, 2, sc); b.rect(10, 13, 2, 4, sc); b.px(10, 16, C.gold);
    b.px(8, 15, C.ink); b.px(8, 18, C.ink); b.line(3, 14, 0, 11, C.bark); b.line(13, 14, 16, 11, C.bark);
    b.outline(mix(C.sn5, C.ink, 0.4)); return b.bake();
  });
}
export function candyCane() {
  return once('cane', () => {
    const b = new Buf(9, 16); for (let y = 4; y < 15; y++) { const c = ((y >> 1) & 1) ? C.red : C.white; b.rect(5, y, 2, 1, c); }
    const a = [[5, 3], [5, 2], [4, 1], [3, 1], [2, 1], [1, 2], [1, 3], [1, 4]]; a.forEach(([x, y], i) => { const c = (i >> 1) & 1 ? C.red : C.white; b.rect(x, y, 2, 1, c); });
    b.outline(RIM); return b.bake();
  });
}
export function lampPost(on: boolean) {
  return once(`lamp${on}`, () => {
    const b = new Buf(13, 29); b.rect(5, 8, 3, 19, C.dgrey); b.rect(5, 8, 1, 19, C.grey); b.rect(4, 25, 5, 2, C.dgrey); b.rect(3, 27, 7, 1, C.dgrey);
    b.rect(4, 2, 5, 6, on ? C.lemon : C.ice); b.rect(4, 2, 2, 6, on ? C.white : C.white); b.rect(3, 1, 7, 1, C.dgrey); b.rect(3, 8, 7, 1, C.dgrey); b.rect(4, 0, 5, 1, C.white);
    b.rect(3, 12, 7, 2, C.leaf); b.px(4, 12, C.lime); b.px(6, 14, C.red); b.px(7, 13, C.red); b.px(5, 14, C.red); b.rect(2, 13, 1, 2, C.red); b.rect(10, 13, 1, 2, C.red);
    b.outline(RIM); return b.bake();
  });
}
export function giftPile(v: number) {
  return once(`gift${v}`, () => {
    const b = new Buf(19, 14), box = (x: number, y: number, w: number, h: number, c: string, r: string) => { b.rect(x, y, w, h, c); b.rect(x + w - 2, y, 2, h, mix(c, C.ink, 0.3)); b.rect(x, y, w, 1, mix(c, C.white, 0.35)); b.rect(x + (w >> 1), y, 2, h, r); b.rect(x, y + (h >> 1), w, 1, r); b.px(x + (w >> 1) - 1, y - 1, r); b.px(x + (w >> 1) + 2, y - 1, r); };
    const P = [[C.red, C.gold], [C.leaf, C.red], ['#2f7ae0', C.white], [C.gold, C.red]];
    box(1, 6, 9, 7, P[v % 4][0], P[v % 4][1]); box(9, 8, 8, 5, P[(v + 1) % 4][0], P[(v + 1) % 4][1]); box(6, 2, 7, 5, P[(v + 2) % 4][0], P[(v + 2) % 4][1]);
    b.outline(RIM); return b.bake();
  });
}
/** the farm boundary: candy-striped posts with a pine-rope rail. kind 0 runs across, 1 runs down */
export function fence(kind: number, ph: number) {
  return once(`fence${kind}.${ph}`, () => {
    const L = [C.red, C.gold, C.aqua, C.white];
    if (kind === 0) {
      const b = new Buf(16, 13); for (let y = 1; y < 12; y++) b.rect(1, y, 2, 1, (y >> 1) & 1 ? C.red : C.white); b.px(1, 0, C.white); b.px(2, 0, C.white);
      for (let x = 3; x < 16; x++) { const y = 4 + Math.round(Math.sin((x - 3) / 13 * Math.PI) * 2); b.px(x, y, C.pine); b.px(x, y + 1, C.leaf); if (x % 2) b.px(x, y - 1, C.leaf); }
      b.px(9, 8, L[ph % 4]); b.px(13, 7, L[(ph + 1) % 4]); b.outline(RIM); return b.bake();
    }
    const b = new Buf(4, 16); for (let y = 2; y < 16; y++) b.rect(1, y, 2, 1, (y >> 1) & 1 ? C.red : C.white); b.px(1, 1, C.white); b.px(2, 1, C.white); b.outline(RIM); return b.bake();
  });
}

// ---- trim for the interface -----------------------------------------------------------------------------
export function holly(flip = false) {
  return once(`holly${flip}`, () => {
    const b = new Buf(19, 13), leaf = (x: number, s: number) => { for (let i = 0; i < 8; i++) { const w = [1, 2, 3, 2, 3, 2, 2, 1][i]; for (let k = -w; k <= w; k++) b.px(x + i * s, 4 + i * 0.25 + k * 0.7, k < 0 ? C.leaf : C.pine); } b.line(x, 4, x + 7 * s, 6, C.lime); };
    leaf(8, -1); leaf(10, 1); b.disc(8, 8, 2, 2, C.red); b.disc(11, 9, 2, 2, C.red); b.disc(10, 6, 1.5, 1.5, C.red); b.px(7, 7, C.pink); b.px(10, 8, C.pink); b.px(9, 5, C.pink);
    b.outline(RIM); return (flip ? b.flip() : b).bake();
  });
}
/** a run of pine rope with bulbs, 8 px tall plus room for the bulbs to hang */
export function garland(w: number, ph: number) {
  return once(`gar${w}.${ph}`, () => {
    const b = new Buf(w, 12), L = [C.red, C.gold, '#3fa0ff', C.lime, C.pink];
    for (let x = 0; x < w; x++) { const y = 2 + Math.round(Math.abs(Math.sin(x * Math.PI / 48)) * 3); for (let k = 0; k < 4; k++) { const q = hash(x >> 1, k, 3); b.px(x, y + k - 1, q > 0.7 ? C.leaf : q > 0.2 ? C.pine : C.forest); } if (hash(x, 9) > 0.8) b.px(x, y - 1, C.grass); }
    for (let x = 6; x < w; x += 12) { const y = 2 + Math.round(Math.abs(Math.sin(x * Math.PI / 48)) * 3) + 3, i = (x / 12) | 0, on = (i + ph) % 3 !== 0, c = L[i % L.length]; b.rect(x, y, 2, 1, C.dgrey); b.rect(x - 0, y + 1, 2, 3, on ? c : mix(c, C.ink, 0.5)); if (on) b.px(x, y + 1, C.white); }
    return b.bake();
  });
}
export function snowEdge(w: number) {
  return once(`se${w}`, () => {
    const b = new Buf(w, 8);
    for (let x = 0; x < w; x++) { const h = 3 + Math.round((Math.sin(x * 0.19) + Math.sin(x * 0.07 + 2)) * 1.1 + hash(x >> 2, 3) * 1.2); for (let y = 0; y < h; y++) b.px(x, y, y === h - 1 ? C.sn3 : y === h - 2 ? C.sn1 : C.sn0); }
    for (let x = 5; x < w; x += 7) { const L = 2 + ((hash(x, 8) * 4) | 0), y0 = 3; for (let k = 0; k < L; k++) b.px(x, y0 + k, k === L - 1 ? C.white : C.ice); }
    return b.bake();
  });
}
/** a sparkle in four sizes */
export function glint(k: number, col: string = C.white) {
  return once(`gl${k}${col}`, () => { const b = new Buf(7, 7); const c = 3; b.px(c, c, col); if (k > 0) { b.px(c - 1, c, col); b.px(c + 1, c, col); b.px(c, c - 1, col); b.px(c, c + 1, col); } if (k > 1) { b.px(c - 2, c, col); b.px(c + 2, c, col); b.px(c, c - 2, col); b.px(c, c + 2, col); } if (k > 2) { b.px(c - 3, c, col); b.px(c + 3, c, col); b.px(c, c - 3, col); b.px(c, c + 3, col); } return b.bake(); });
}
/** stepped, dithered round glow for additive light: pixels, never a smooth gradient */
export function glow(r: number, col: string) {
  return once(`glow${r}${col}`, () => {
    const c = canvas(r * 2, r * 2), g = c.g, a = [0.2, 0.13, 0.07, 0.03];
    for (let y = 0; y < r * 2; y++) for (let x = 0; x < r * 2; x++) { const d = Math.hypot(x - r + 0.5, y - r + 0.5) / r; if (d >= 1) continue; const k = d * 4 + (bayerq(x, y) - 0.5) * 0.9; const i = Math.max(0, Math.min(3, Math.floor(k))); g.globalAlpha = a[i]; g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    return c.c;
  });
}

// ---- buildings ------------------------------------------------------------------------------------------
const BULBS = [C.red, C.gold, '#3fa0ff', C.lime, '#ff6ac8'];
const letters: Record<string, string[]> = { T: ['###', '.#.', '.#.', '.#.', '.#.'], R: ['##.', '#.#', '##.', '#.#', '#.#'], E: ['###', '#..', '##.', '#..', '###'], S: ['.##', '#..', '.#.', '..#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], A: ['.#.', '#.#', '###', '#.#', '#.#'], N: ['#.#', '###', '###', '###', '#.#'], H: ['#.#', '#.#', '###', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'], D: ['##.', '#.#', '#.#', '#.#', '##.'], P: ['##.', '#.#', '##.', '#..', '#..'], I: ['#', '#', '#', '#', '#'], G: ['.##', '#..', '#.#', '#.#', '.##'] };
function sign(b: Buf, t: string, x: number, y: number, c: string) { for (const ch of t) { const L = letters[ch]; if (!L) { x += 2; continue; } b.map(L, x, y, { '#': c }); x += L[0].length + 1; } }
function wreath(b: Buf, cx: number, cy: number, r: number) {
  for (let a = 0; a < 40; a++) { const t = a / 40 * 6.283, k = r + (a % 3 === 0 ? 0.6 : 0); b.px(cx + Math.cos(t) * k, cy + Math.sin(t) * k, a % 2 ? C.leaf : C.pine); b.px(cx + Math.cos(t) * (k - 1), cy + Math.sin(t) * (k - 1), a % 3 ? C.pine : C.grass); }
  for (let a = 0; a < 5; a++) { const t = a / 5 * 6.283 + 0.4; b.px(cx + Math.cos(t) * r, cy + Math.sin(t) * r, C.red); }
  b.rect(cx - 2, cy + r - 1, 5, 2, C.red); b.px(cx - 3, cy + r + 1, C.red); b.px(cx + 3, cy + r + 1, C.red); b.px(cx, cy + r, C.pink);
}
function win(b: Buf, x: number, y: number, w: number, h: number, lit: boolean, trim: string = C.white) {
  b.rect(x - 1, y - 1, w + 2, h + 2, trim); b.rect(x - 2, y + h + 1, w + 4, 1, trim); b.rect(x - 2, y + h + 2, w + 4, 1, C.sn3);
  if (lit) { b.rect(x, y, w, h, C.gold); b.rect(x, y, w, h >> 1, C.lemon); b.rect(x + 1, y + 1, (w >> 1) - 1, (h >> 1) - 1, '#fffbd8'); }
  else { b.rect(x, y, w, h, '#3c58a8'); b.rect(x, y, w, h >> 1, '#5c84cc'); b.line(x + 1, y + h - 2, x + Math.min(w, h) - 2, y + 1, '#a8d8f6'); }
  b.rect(x + (w >> 1), y, 1, h, trim); b.rect(x, y + (h >> 1), w, 1, trim);
  if (w >= 7) { const cx = x + (w >> 2); b.rect(cx, y + h - 3, 1, 3, C.white); b.px(cx, y + h - 4, lit ? C.white : C.orange); } // a candle in the window
}
function lightsAlong(b: Buf, pts: [number, number][], lit: boolean, ph: number, step = 5) {
  let n = 0, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    for (let d = 0; d < L; d += 1) {
      const t = d / L, sag = Math.sin((acc + d) / step * Math.PI) * 1.2, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t + Math.abs(sag));
      b.px(x, y, '#2e2c44');
      if (((acc + d) | 0) % step === 0) { const c = BULBS[n % 5], on = lit ? (n + ph) % 3 !== 2 : true; n++; b.px(x, y + 1, on ? c : mix(c, C.ink, 0.45)); b.px(x, y + 2, on ? (lit ? C.white : c) : mix(c, C.ink, 0.45)); }
    }
    acc += L;
  }
}
function icicles(b: Buf, x: number, y: number, w: number, seed: number) { for (let i = 0; i < w; i += 1 + ((hash(i, seed) * 3) | 0)) { const L = 1 + ((hash(i, seed + 1) * 5) | 0); for (let k = 0; k < L; k++) b.px(x + i, y + k, k === L - 1 ? C.white : C.ice); } }
/** a fat pillow of snow lying along y(x), with drips */
function snowLoad(b: Buf, x0: number, x1: number, yOf: (x: number) => number, depth: number, seed: number) {
  for (let x = x0; x < x1; x++) { const y = Math.round(yOf(x)), d = depth + Math.round(Math.sin(x * 0.31 + seed) * 1.2 + Math.sin(x * 0.11 + seed * 2) * 1.1); for (let k = -1; k < d; k++) b.px(x, y + k, k === d - 1 ? C.sn3 : k === d - 2 ? C.sn1 : k === -1 ? C.sn1 : C.sn0); }
}
function shingles(b: Buf, x0: number, x1: number, y0: number, y1: number, a: string, c: string, d: string) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (!b.get(x, y) && false) continue; const row = ((y - y0) / 4) | 0, off = row % 2 ? 3 : 0, ly = (y - y0) % 4, seam = (x + off) % 6 === 0; b.px(x, y, ly === 3 ? d : seam ? c : ly === 0 ? mix(a, C.white, 0.14) : a); } }
function boards(b: Buf, x: number, y: number, w: number, h: number, c: string, line: string, hi: string) { b.rect(x, y, w, h, c); for (let j = y; j < y + h; j += 4) { b.rect(x, j, w, 1, line); b.rect(x, j + 1, w, 1, hi); for (let i = x + ((j >> 2) % 2 ? 7 : 2); i < x + w; i += 11) b.px(i, j + 2, line); } }
function logs(b: Buf, x: number, y: number, w: number, h: number) { for (let j = y; j < y + h; j += 5) { b.rect(x, j, w, 4, C.brown); b.rect(x, j, w, 1, '#c88a56'); b.rect(x, j + 3, w, 2, C.bark); b.disc(x, j + 2, 1.6, 1.6, C.tan); b.disc(x + w - 1, j + 2, 1.6, 1.6, C.tan); } }
function door(b: Buf, x: number, y: number, w: number, h: number, c: string, lit: boolean) {
  b.rect(x - 1, y - 1, w + 2, h + 1, C.white); b.rect(x, y, w, h, c); b.rect(x + 2, y + 2, w - 4, (h >> 1) - 3, mix(c, C.ink, 0.25)); b.rect(x + 2, y + (h >> 1), w - 4, (h >> 1) - 3, mix(c, C.ink, 0.25)); b.rect(x, y, 1, h, mix(c, C.white, 0.2)); b.px(x + w - 3, y + (h >> 1), C.gold); wreath(b, x + (w >> 1), y + 6, 3); void lit;
}
const mug = (b: Buf, x: number, y: number) => { b.rect(x, y, 4, 4, C.white); b.px(x + 4, y + 1, C.white); b.px(x + 4, y + 2, C.white); b.rect(x + 1, y, 2, 1, C.bark); };

function paintBuilding(k: string, b: Buf, W: number, H: number, lit: boolean, ph: number) {
  switch (k) {
    case 'house': {
      const wallT = 46, wallB = H - 4;
      boards(b, 5, wallT, 70, wallB - wallT, '#f4e0b8', '#c8a878', '#fff2d0'); b.rect(5, wallB - 4, 70, 4, '#8e8ca8'); for (let x = 7; x < 75; x += 6) b.rect(x, wallB - 4, 1, 4, '#6e6c8c'); b.rect(71, wallT, 4, wallB - wallT - 4, '#d4b88c');
      // chimney behind the roof
      b.rect(56, 6, 10, 20, '#a8483c'); for (let y = 8; y < 26; y += 3) { b.rect(56, y, 10, 1, '#7c3030'); b.px(58 + ((y / 3) % 2) * 4, y + 1, '#7c3030'); } b.rect(55, 5, 12, 2, '#c8c4d8');
      // roof
      for (let y = 18; y < 46; y++) { const t = (y - 18) / 28, w = 62 + t * 18; b.rect(40 - w / 2, y, w, 1, C.dred); }
      shingles(b, 0, 80, 18, 46, '#b0203a', '#8c1a30', '#6e1430'); for (let y = 18; y < 46; y++) { const t = (y - 18) / 28, w = 62 + t * 18, l = Math.round(40 - w / 2), r = Math.round(40 + w / 2); for (let x = 0; x < l; x++) b.px(x, y, 0); for (let x = r; x < 80; x++) b.px(x, y, 0); }
      // dormer with a wreath
      b.rect(30, 26, 20, 16, '#f4e0b8'); b.rect(30, 26, 20, 1, '#c8a878'); for (let j = 0; j < 9; j++) { b.rect(40 - 12 + j * 1.3, 25 - j, 24 - j * 2.6, 1, C.dred); } win(b, 35, 31, 10, 8, lit); snowLoad(b, 27, 54, (x) => 25 - (12 - Math.abs(x - 40)) * 0.72, 3, 3);
      snowLoad(b, 0, 80, (x) => (x < 28 || x > 52 ? 19 + Math.abs(x - 40) * 0.1 : 99), 7, 1); snowLoad(b, 8, 30, (x) => 34 + (x % 9 < 4 ? 0 : 1), 3, 4); snowLoad(b, 52, 74, (x) => 33 + (x % 7 < 3 ? 0 : 1), 3, 5);
      b.rect(0, 45, 80, 2, C.sn2); b.rect(0, 45, 80, 1, C.white); icicles(b, 2, 47, 76, 3);
      lightsAlong(b, [[4, 48], [76, 48]], lit, ph, 6);
      // porch
      win(b, 13, 55, 12, 13, lit); win(b, 55, 55, 12, 13, lit); for (const x of [10, 26, 52, 68]) { b.rect(x, 55, 2, 13, C.dred); b.px(x, 55, C.red); }
      door(b, 33, 56, 14, H - 4 - 56, '#1f7a4a', lit); b.rect(30, 51, 20, 3, C.white); b.rect(30, 53, 20, 1, C.sn3);
      for (let x = 28; x < 52; x += 1) { const y = 50 + Math.round(Math.sin((x - 28) / 24 * Math.PI) * 3); b.px(x, y, C.pine); b.px(x, y + 1, C.leaf); } b.px(30, 52, C.red); b.px(50, 52, C.red);
      b.rect(26, H - 8, 28, 4, '#b0aed0'); b.rect(26, H - 8, 28, 1, C.white);
      for (const x of [26, 52]) { b.rect(x - 1, H - 15, 3, 7, '#8a4a30'); b.rect(x - 1, H - 15, 3, 1, C.white); paintTreeBuf(b, x, H - 15, { sp: 1, px: 12, shape: 2, snow: 1, sway: 0, seed: x, deco: 1 }); }
      snowLoad(b, 3, 26, () => H - 7, 4, 7); snowLoad(b, 54, 77, () => H - 7, 4, 8);
      break;
    }
    case 'barn': {
      const prof = (y: number) => { if (y < 10) return 0; if (y < 28) return 18 + (y - 10) * 0.78 + 6; return 38; };
      for (let y = 10; y < 46; y++) { const w = prof(y); b.rect(40 - w, y, w * 2, 1, '#55506e'); }
      for (let y = 10; y < 46; y += 3) for (let x = 0; x < 80; x++) if (b.get(x, y)) b.px(x, y, '#3e3a5c');
      for (let y = 10; y < 46; y++) { const w = prof(y); b.rect(40 - w + 6, y, w * 2 - 12, 1, '#c82a2e'); } for (let x = 4; x < 76; x += 5) for (let y = 10; y < 46; y++) b.over(x, y, b.get(x, y) ? '#a01e2e' : C.red);
      for (let y = 10; y < 46; y++) { const w = prof(y); for (let x = 0; x < 80; x++) { const inset = Math.abs(x - 40) < w - 6; if (!inset && b.get(x, y)) b.px(x, y, (y % 3) ? '#55506e' : '#3e3a5c'); } }
      // walls
      b.rect(4, 46, 72, H - 50, '#c82a2e'); for (let x = 4; x < 76; x += 5) b.rect(x, 46, 1, H - 50, '#a01e2e'); b.rect(4, H - 7, 72, 3, '#8e8ca8'); b.rect(70, 46, 6, H - 53, '#a01e2e');
      b.rect(4, 45, 72, 2, C.white);
      // loft
      b.rect(32, 22, 16, 15, C.white); b.rect(34, 24, 12, 11, C.dbrown); b.rect(34, 30, 12, 5, '#e8c060'); for (let x = 35; x < 46; x += 2) b.px(x, 29 + (x % 3), '#e8c060'); b.line(34, 24, 45, 34, C.white); b.rect(30, 14, 20, 3, '#6a6a88');
      // doors
      b.rect(20, 52, 40, H - 56, C.white); b.rect(22, 54, 18, H - 60, '#a81e2c'); b.rect(41, 54, 17, H - 60, '#a81e2c'); b.line(22, 54, 39, H - 7, C.white); b.line(39, 54, 22, H - 7, C.white); b.line(41, 54, 57, H - 7, C.white); b.line(57, 54, 41, H - 7, C.white); if (lit) { b.rect(38, 56, 4, H - 62, C.gold); }
      wreath(b, 40, 53, 6); win(b, 9, 56, 7, 8, lit); win(b, 64, 56, 7, 8, lit);
      snowLoad(b, 0, 80, (x) => { const w = Math.abs(x - 40); return w < 24 ? 10 : 10 + (w - 24) * 1.28; }, 6, 2); icicles(b, 3, 46, 74, 5);
      lightsAlong(b, [[2, 44], [17, 22], [40, 12], [63, 22], [78, 44]], lit, ph, 6);
      snowLoad(b, 2, 20, () => H - 6, 4, 9); snowLoad(b, 60, 78, () => H - 6, 4, 11);
      break;
    }
    case 'lot': {
      // bunting first, then the trees on stands, then the fence
      for (const [x, y] of [[1, 34], [W - 3, 34], [1, H - 16], [W - 3, H - 16]]) { for (let j = 0; j < 16; j++) b.rect(x, y + j, 2, 1, (j >> 1) & 1 ? C.red : C.white); }
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
        const x = 11 + i * 15 + (row % 2) * 6, y = 50 + row * 15;
        b.rect(x - 2, y + 1, 5, 1, C.bark); paintTreeBuf(b, x, y, { sp: [1, 3, 0, 2][(i + row) % 4], px: 18, shape: 2, snow: 1, sway: 0, seed: i + row * 7, deco: (i + row) % 3 === 0 ? 1 : 0 });
      }
      lightsAlong(b, [[2, 36], [W >> 1, 42], [W - 2, 36]], lit, ph, 6);
      // sign
      b.rect(30, 3, 36, 19, C.dred); b.rect(31, 4, 34, 17, C.red); b.rect(33, 6, 30, 13, C.cream); sign(b, 'TREES', 37, 8, C.dred); for (let x = 34; x < 62; x += 3) b.px(x, 16, C.leaf); b.rect(46, 22, 4, 12, C.bark); b.rect(46, 22, 1, 12, C.brown); snowLoad(b, 28, 68, () => 3, 3, 4); lightsAlong(b, [[28, 22], [68, 22]], lit, ph, 5);
      break;
    }
    case 'depot': {
      b.rect(3, 30, W - 6, H - 34, '#a06c44'); for (let x = 5; x < W; x += 5) b.rect(x, 30, 1, H - 34, '#7c4e34'); b.rect(10, 36, 26, H - 40, C.dbrown);
      for (let i = 0; i < 5; i++) paintTreeBuf(b, 14 + i * 5, H - 5, { sp: i % 2, px: 11, shape: 2, snow: 0, sway: 0, seed: i });
      b.rect(0, 22, W, 9, '#55506e'); for (let y = 22; y < 31; y += 3) b.rect(0, y, W, 1, '#3e3a5c'); b.rect(0, 30, W, 1, '#2e2c44'); snowLoad(b, 0, W, () => 21, 5, 3); icicles(b, 1, 31, W - 2, 7); wreath(b, 40, 40, 4); lightsAlong(b, [[1, 32], [W - 1, 32]], lit, ph, 6);
      break;
    }
    case 'cocoa': {
      b.rect(3, 34, 26, H - 38, '#a06c44'); for (let y = 36; y < H - 4; y += 4) b.rect(3, y, 26, 1, '#7c4e34'); b.rect(3, 34, 26, 2, C.tan);
      b.rect(5, 37, 22, 9, lit ? C.gold : C.dbrown); if (lit) b.rect(5, 37, 22, 3, C.lemon); b.rect(2, 46, 28, 3, C.cream); b.rect(2, 48, 28, 1, C.tan); mug(b, 8, 42); mug(b, 18, 42);
      for (let x = 0; x < 32; x += 4) { b.rect(x, 22, 4, 11, (x / 4) % 2 ? C.red : C.white); b.rect(x, 33, 4, 1, (x / 4) % 2 ? C.dred : C.sn3); b.px(x + 1, 34, (x / 4) % 2 ? C.dred : C.sn3); b.px(x + 2, 34, (x / 4) % 2 ? C.dred : C.sn3); }
      snowLoad(b, 0, 32, () => 21, 4, 2); sign(b, 'COCOA', 5, 52, C.cream); lightsAlong(b, [[1, 33], [31, 33]], lit, ph, 5);
      break;
    }
    case 'santa': {
      logs(b, 4, 36, 40, H - 40); for (let j = 0; j < 20; j++) { const w = 12 + j * 1.3; b.rect(24 - w, 16 + j, w * 2, 1, j % 4 === 3 ? '#8c1a30' : '#c82a3a'); }
      b.rect(32, 8, 7, 12, '#8e8ca8'); b.rect(32, 8, 2, 12, '#b0aed0'); b.rect(31, 7, 9, 2, C.sn1);
      snowLoad(b, 8, 40, (x) => 16 + Math.abs(x - 24) * 0.25, 7, 2); b.rect(0, 36, 48, 1, C.sn1); icicles(b, 2, 37, 44, 3);
      door(b, 19, 44, 10, H - 48, '#1f7a4a', lit); win(b, 7, 44, 7, 7, lit); win(b, 34, 44, 7, 7, lit); lightsAlong(b, [[1, 37], [47, 37]], lit, ph, 5);
      break;
    }
    case 'sleigh': {
      const y0 = H - 40;
      // runners
      for (let x = 8; x < W - 6; x++) { const y = H - 8 + (x > W - 16 ? -Math.round(((x - (W - 16)) / 10) ** 2 * 6) : 0); b.px(x, y, C.gold); b.px(x, y + 1, '#c07a10'); }
      b.rect(14, H - 14, 2, 6, C.gold); b.rect(40, H - 14, 2, 6, C.gold);
      // body
      for (let x = 8; x < 50; x++) { const u = (x - 8) / 42, top = y0 + 8 + Math.round(Math.sin(u * 3.14) * -3 + (u < 0.25 ? -(0.25 - u) * 44 : 0)); b.rect(x, top, 1, H - 13 - top, C.red); b.px(x, top, C.pink); b.px(x, top + 1, C.gold); b.rect(x, H - 15, 1, 2, C.dred); }
      for (let x = 14; x < 46; x += 8) { b.px(x, H - 22, C.gold); b.px(x + 1, H - 23, C.gold); b.px(x + 2, H - 22, C.gold); b.px(x + 1, H - 21, C.gold); }
      giftTop(b, 22, y0 + 4); b.rect(10, y0 + 1, 10, 7, C.dred); b.rect(10, y0 + 1, 10, 1, C.gold);
      reindeer(b, W - 16, H - 22, ph); lightsAlong(b, [[8, y0 + 8], [48, y0 + 8]], lit, ph, 5);
      break;
    }
    case 'greenhouse': {
      b.rect(3, 36, W - 6, H - 40, lit ? '#f7e8a0' : '#b8e0f2'); for (let x = 3; x < W - 3; x += 10) b.rect(x, 26, 1, H - 30, C.white); for (let y = 36; y < H - 4; y += 9) b.rect(3, y, W - 6, 1, C.white);
      for (let j = 0; j < 14; j++) { b.rect(3 + j / 2, 22 + j, W - 6 - j, 1, j % 3 ? (lit ? '#fff2b8' : C.sky) : C.ice); } b.rect(3, 36, W - 6, 1, C.white);
      for (let x = 8; x < W - 6; x += 8) paintTreeBuf(b, x, H - 6, { sp: (x >> 3) % 3, px: 11 + (x % 3) * 2, shape: 2, snow: 0, sway: 0, seed: x });
      b.rect(3, H - 6, W - 6, 2, '#8e8ca8'); snowLoad(b, 5, W - 5, () => 22, 4, 3); lightsAlong(b, [[3, 37], [W - 3, 37]], lit, ph, 6);
      break;
    }
    case 'kennel': {
      b.rect(5, 36, 22, H - 40, C.brown); for (let y = 38; y < H - 4; y += 3) b.rect(5, y, 22, 1, C.bark); b.disc(16, 46, 5, 6, C.dbrown); b.rect(11, 46, 11, H - 50, C.dbrown);
      for (let j = 0; j < 13; j++) b.rect(16 - 3 - j * 1.1, 23 + j, 6 + j * 2.2, 1, j % 3 === 2 ? C.dred : C.red); snowLoad(b, 3, 29, (x) => 23 + Math.abs(x - 16) * 0.95, 3, 4); wreath(b, 16, 33, 3); lightsAlong(b, [[3, 37], [29, 37]], lit, ph, 5);
      break;
    }
    case 'sprinkler': {
      b.rect(7, H - 13, 3, 12, C.grey); b.rect(7, H - 13, 1, 12, C.lgrey); b.rect(4, H - 14, 9, 2, C.lgrey); b.rect(6, H - 16, 5, 2, C.gold); icicles(b, 4, H - 12, 9, 4); b.px(3, H - 15, C.sky); b.px(13, H - 15, C.sky); b.rect(5, H - 3, 7, 2, C.sn1);
      break;
    }
    case 'helipad': {
      const top = BLD_TOP; b.rect(0, top, W, H - top, '#55567e'); b.rect(0, top, W, 2, '#7476a0'); for (let x = 0; x < W; x += 8) { b.rect(x, top, 4, 2, C.red); b.rect(x + 4, top, 4, 2, C.white); b.rect(x, H - 3, 4, 2, C.white); b.rect(x + 4, H - 3, 4, 2, C.red); }
      for (let y = top; y < H; y += 8) { b.rect(0, y, 2, 4, C.white); b.rect(W - 2, y + 4, 2, 4, C.white); b.rect(0, y + 4, 2, 4, C.red); b.rect(W - 2, y, 2, 4, C.red); }
      const cy = (top + H) >> 1; for (let a = 0; a < 90; a++) { const t = a / 90 * 6.283; b.px(W / 2 + Math.cos(t) * 24, cy + Math.sin(t) * 24, C.gold); b.px(W / 2 + Math.cos(t) * 23, cy + Math.sin(t) * 23, C.gold); }
      b.rect(22, cy - 13, 5, 26, C.white); b.rect(37, cy - 13, 5, 26, C.white); b.rect(22, cy - 2, 20, 5, C.white);
      for (let k = 0; k < 8; k++) b.rect(3 + hash(k, 1) * (W - 12), top + 3 + hash(k, 2) * (H - top - 8), 7, 2, C.sn1);
      break;
    }
  }
}
function giftTop(b: Buf, x: number, y: number) { const box = (X: number, Y: number, w: number, h: number, c: string, r: string) => { b.rect(X, Y, w, h, c); b.rect(X + (w >> 1), Y, 2, h, r); b.rect(X, Y + (h >> 1), w, 1, r); }; box(x, y + 2, 8, 7, C.leaf, C.gold); box(x + 8, y, 9, 9, C.gold, C.red); box(x + 17, y + 3, 7, 6, '#2f7ae0', C.white); }
function reindeer(b: Buf, x: number, y: number, ph: number) { // standing, facing right, feet near y+16
  const c = C.brown, d = C.bark; b.rect(x - 8, y + 4, 13, 6, c); b.rect(x - 8, y + 8, 13, 2, d); b.rect(x - 7, y + 3, 11, 1, c); for (const q of [-8, -5, 1, 4]) { b.rect(x + q, y + 10, 2, 6, d); b.rect(x + q, y + 15, 2, 1, C.ink); }
  b.rect(x + 3, y - 1, 3, 6, c); b.rect(x + 3, y - 4, 7, 4, c); b.rect(x + 8, y - 3, 2, 2, C.tan); b.px(x + 10, y - 3, ph % 2 ? C.red : C.pink); b.px(x + 6, y - 4, C.ink); b.px(x + 2, y - 3, c);
  b.line(x + 4, y - 4, x + 1, y - 10, C.tan); b.line(x + 6, y - 5, x + 8, y - 10, C.tan); b.px(x + 2, y - 8, C.tan); b.px(x, y - 8, C.tan); b.px(x + 8, y - 8, C.tan); b.px(x + 9, y - 9, C.tan);
  b.rect(x + 2, y + 2, 4, 1, C.red); b.px(x + 3, y + 3, C.gold); b.px(x - 9, y + 4, C.white);
}

export const BLD_TOP = 26;
const BURN = new Set([C.gold, C.lemon, '#fffbd8', C.white, ...BULBS].map(u32));
/** just the pixels that make their own light, drawn again over the night tint */
export function buildingLights(k: string, ph: number) {
  const key = `em${k}.${ph % 3}`; let c = bCache.get(key); if (c) return c;
  const d = BUILDINGS[k], W = d.w * 16, H = d.h * 16 + BLD_TOP, b = new Buf(W, H), o = new Buf(W, H), off = new Buf(W, H);
  paintBuilding(k, b, W, H, true, ph); paintBuilding(k, off, W, H, false, ph);
  for (let i = 0; i < b.d.length; i++) if (BURN.has(b.d[i]) && (b.d[i] !== off.d[i] || BULB_SET.has(b.d[i]))) o.d[i] = b.d[i];
  c = o.bake(); bCache.set(key, c); return c;
}
const BULB_SET = new Set(BULBS.map(u32));
export function buildingSprite(k: string, snow: boolean, lit: boolean, ph = 0) {
  const key = `${k}.${snow}.${lit}.${lit ? ph % 3 : 0}`; let c = bCache.get(key); if (c) return c;
  const d = BUILDINGS[k], W = d.w * 16, H = d.h * 16 + BLD_TOP, b = new Buf(W, H);
  paintBuilding(k, b, W, H, lit, ph);
  if (k !== 'lot' && k !== 'helipad') b.outline(RIM);
  c = b.bake(); bCache.set(key, c); return c;
}

// ---- people ---------------------------------------------------------------------------------------------
export interface Look { hat: string; coat: string; skin: string; pants: string; kind?: 'santa' | 'elf' | 'beanie' | 'hood'; trim?: string; scarf?: string }
export const PX_AX = 8, PX_AY = 20;
export function person(look: Look, dir: number, frame: number, carry = false) {
  const key = `p${look.hat}${look.coat}${look.skin}${look.pants}${look.kind}${look.trim}${look.scarf}${dir}${frame}${carry}`; let c = bCache.get(key); if (c) return c;
  const b = new Buf(19, 23), cs = mix(look.coat, C.ink, 0.32), ch = mix(look.coat, C.white, 0.2), ss = mix(look.skin, C.dred, 0.25), elf = look.kind === 'elf', trim = look.trim ?? C.white;
  const hs = mix(look.hat, C.ink, 0.3), up = frame === 1 || frame === 3 ? -1 : 0, ox = 1, Y = (y: number) => y + up + 1;
  const flipped = dir === 3, side = dir === 1 || dir === 3, boots = elf ? look.hat : C.dbrown, X = (x: number) => x + ox;
  if (side) {
    const l1 = frame === 1 ? 2 : frame === 3 ? -2 : 0, l2 = -l1;
    b.rect(X(6 + l2), Y(17) - up, 3, 3, mix(look.pants, C.ink, 0.25)); b.rect(X(6 + l2), Y(19) - up, 4, 1, mix(boots, C.ink, 0.2));
    b.rect(X(6 + l1), Y(17) - up, 3, 3, look.pants); b.rect(X(6 + l1), Y(19) - up, 4, 1, boots); if (elf) b.px(X(10 + l1), Y(18) - up, boots);
    b.rect(X(5), Y(11), 7, 7, look.coat); b.rect(X(5), Y(11), 1, 7, cs); b.rect(X(10), Y(11), 2, 7, ch); b.rect(X(5), Y(16), 7, 1, trim === C.white ? C.gold : trim);
    b.rect(X(7 + (l1 >> 1)), Y(12), 3, 5, cs); b.rect(X(7 + (l1 >> 1)), Y(16), 3, 2, elf ? C.red : C.dbrown);
    b.rect(X(5), Y(5), 8, 6, look.skin); b.rect(X(5), Y(5), 3, 5, look.kind === 'hood' ? look.hat : C.bark); b.px(X(10), Y(7), C.ink); b.px(X(10), Y(8), C.ink); b.px(X(13), Y(8), ss); b.px(X(11), Y(9), C.pink); b.rect(X(5), Y(10), 8, 1, ss);
    b.rect(X(4), Y(10), 9, 2, look.scarf ?? trim); if (look.scarf) { b.rect(X(3), Y(11), 3, 4, look.scarf); }
    if (elf) { b.px(X(6), Y(7), look.skin); b.px(X(5), Y(6), look.skin); }
  } else {
    const a = frame === 1 ? -1 : 0, c2 = frame === 3 ? -1 : 0;
    b.rect(X(5), Y(17) - up + a, 3, 3 - a, look.pants); b.rect(X(9), Y(17) - up + c2, 3, 3 - c2, look.pants); b.rect(X(5), Y(19) - up + a, 3, 1, boots); b.rect(X(9), Y(19) - up + c2, 3, 1, boots);
    if (elf) { b.px(X(4), Y(19) - up, boots); b.px(X(12), Y(19) - up, boots); }
    b.rect(X(4), Y(11), 9, 7, look.coat); b.rect(X(11), Y(11), 2, 7, cs); b.rect(X(4), Y(11), 2, 6, ch); b.rect(X(4), Y(16), 9, 1, trim === C.white ? C.dbrown : trim);
    const s1 = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    b.rect(X(2), Y(12), 2, 5, cs); b.rect(X(13), Y(12), 2, 5, cs); b.rect(X(2), Y(16 + s1), 2, 2, elf ? C.red : C.dbrown); b.rect(X(13), Y(16 - s1), 2, 2, elf ? C.red : C.dbrown);
    if (dir === 2) { b.px(X(8), Y(13), C.gold); b.px(X(8), Y(15), C.gold); if (elf) { for (let x = 4; x < 13; x += 2) b.px(X(x), Y(12), trim); } }
    b.rect(X(4), Y(5), 9, 6, look.skin); b.px(X(4), Y(10), 0); b.px(X(12), Y(10), 0); b.rect(X(11), Y(5), 2, 6, ss);
    if (dir === 2) { b.rect(X(6), Y(7), 1, 2, C.ink); b.rect(X(10), Y(7), 1, 2, C.ink); b.px(X(5), Y(9), C.pink); b.px(X(11), Y(9), C.pink); if (look.kind === 'hood') { b.rect(X(4), Y(6), 9, 1, C.ink); b.px(X(6), Y(7), C.lemon); b.px(X(10), Y(7), C.lemon); } }
    else b.rect(X(4), Y(5), 9, 5, look.kind === 'hood' ? look.hat : C.bark);
    if (elf) { b.px(X(3), Y(7), look.skin); b.px(X(2), Y(6), look.skin); b.px(X(13), Y(7), look.skin); b.px(X(14), Y(6), look.skin); }
    b.rect(X(4), Y(10), 9, 2, look.scarf ?? (elf ? trim : ch)); if (look.scarf) { b.rect(X(10), Y(11), 2, 4, look.scarf); b.px(X(10), Y(14), C.white); }
  }
  // hats
  const k = look.kind ?? 'beanie', fx = side ? 1 : 0;
  if (k === 'santa') {
    b.rect(X(5 + fx), Y(3), 8, 2, look.hat); b.rect(X(6 + fx), Y(2), 6, 1, look.hat); b.rect(X(8 + fx), Y(1), 4, 1, look.hat); b.rect(X(10 + fx), Y(2), 4, 1, hs); b.rect(X(11 + fx), Y(3), 3, 2, hs);
    b.disc(X(14 + fx), Y(5), 1.6, 1.6, C.white); b.rect(X(3 + fx), Y(4), 11, 2, C.white); b.rect(X(3 + fx), Y(5), 11, 1, C.sn2);
  } else if (k === 'elf') {
    for (let i = 0; i < 5; i++) b.rect(X(5 + i + fx), Y(3 - i), 8 - i * 2 > 1 ? 8 - i * 2 : 1, 1, i % 2 ? look.hat : hs);
    b.rect(X(4 + fx), Y(4), 9, 2, look.hat); for (let x = 4; x < 13; x += 2) b.px(X(x + fx), Y(5), trim); b.px(X(9 + fx), Y(-1), C.gold); b.px(X(10 + fx), Y(-1), C.lemon);
  } else if (k === 'hood') {
    b.rect(X(3 + fx), Y(3), 10, 3, look.hat); b.rect(X(4 + fx), Y(2), 8, 1, hs); b.rect(X(3), Y(5), 2, 5, look.hat); if (!side) b.rect(X(12), Y(5), 2, 5, look.hat);
  } else {
    b.rect(X(4 + fx), Y(3), 9, 3, look.hat); b.rect(X(5 + fx), Y(2), 7, 1, look.hat); b.rect(X(4 + fx), Y(5), 9, 1, hs); b.rect(X(4 + fx), Y(4), 9, 1, trim); b.disc(X(8 + fx), Y(1), 1.2, 1.2, trim);
  }
  if (carry) { for (let i = 0; i < 15; i++) { const h = Math.round(i / 15 * 3); b.rect(i + 2, 8 - h - up, 1, h * 2 + 1, i % 3 ? C.pine : C.leaf); } b.rect(0, 8 - up, 3, 1, C.bark); }
  b.outline(RIM);
  c = (flipped ? b.flip() : b).bake(); bCache.set(key, c); return c;
}

// ---- machines -------------------------------------------------------------------------------------------
export const VEH_TINT = ['', C.blue, C.red, C.leaf, C.red];
export const MACHINE_FOOT = [0, 3, 3, 3, 0];
/** dir: 0 up, 1 right, 2 down, 3 left */
export function machine(kind: number, dir: number, frame: number, tint: string, load: number) {
  const key = `m${kind}.${dir}.${frame}.${tint}.${load}`; let c = bCache.get(key); if (c) return c;
  const side = dir === 1 || dir === 3, flip = dir === 3;
  const W = [0, 34, 42, 66, 92][kind], Hh = [0, 26, 36, 50, 58][kind], b = new Buf(W, Hh);
  const dark = mix(tint, C.ink, 0.42), lite = mix(tint, C.white, 0.38), glass = '#a8dcf6';
  const stack = (x: number, y: number, w: number) => { for (let i = 0; i < load; i++) { const yy = y - (i >> 1) * 3, xx = x + (i % 2) * 2; b.rect(xx, yy + 1, 2, 1, C.bark); for (let q = 0; q < w; q++) { const hh = Math.round(q / w * 2); b.rect(xx + 2 + q, yy - hh + 1, 1, hh * 2 + 1, q % 3 ? C.pine : C.leaf); } } };
  const wheel = (x: number, y: number, r: number) => { b.disc(x, y, r, r, C.ink); b.disc(x, y, r - 1, r - 1, '#2e2c44'); b.disc(x, y, r * 0.5, r * 0.5, C.gold); b.px(x, y, C.dgrey); const a = frame ? 0.8 : 0; for (let k = 0; k < 4; k++) b.px(x + Math.cos(a + k * 1.57) * (r - 1), y + Math.sin(a + k * 1.57) * (r - 1), C.grey); };
  const wreathOn = (x: number, y: number) => wreath(b, x, y, 3);
  const bulbs = (x: number, y: number, w: number) => { for (let i = 0; i <= w; i += 3) b.px(x + i, y, BULBS[(i / 3 + frame) % 5 | 0]); };
  const antlers = (x: number, y: number) => { b.line(x, y, x - 2, y - 5, C.tan); b.line(x + 3, y, x + 5, y - 5, C.tan); b.px(x - 3, y - 3, C.tan); b.px(x + 6, y - 3, C.tan); b.px(x - 1, y - 2, C.brown); };
  if (kind === 1) {
    if (side) {
      b.rect(0, 12, 12, 7, C.tan); b.rect(0, 12, 12, 1, '#f2d29a'); b.rect(0, 18, 12, 1, C.brown); for (let x = 2; x < 12; x += 3) b.rect(x, 12, 1, 7, C.brown); stack(1, 10, 8); wheel(5, 20, 3); b.rect(12, 17, 4, 1, C.dgrey);
      b.rect(15, 10, 15, 7, tint); b.rect(15, 15, 15, 2, dark); b.rect(17, 10, 10, 1, lite); b.rect(18, 7, 8, 3, C.dbrown); b.rect(26, 5, 1, 5, C.ink); b.rect(24, 4, 5, 1, C.lgrey); b.rect(29, 11, 2, 3, C.gold); b.px(30, 12, C.white);
      wheel(18, 19, 4); wheel(28, 19, 4); antlers(27, 4); b.px(31, 13, C.red);
    } else {
      b.rect(9, 8, 16, 11, tint); b.rect(9, 15, 16, 4, dark); b.rect(11, 8, 12, 1, lite); wheel(7, 16, 4); wheel(27, 16, 4); b.rect(7, 5, 20, 1, C.lgrey);
      if (dir === 0) { b.rect(10, 15, 14, 6, C.tan); stack(12, 14, 8); } else { b.rect(13, 10, 8, 3, C.gold); b.rect(15, 10, 4, 1, C.white); b.px(17, 15, C.red); antlers(15, 5); }
    }
  } else if (kind === 2) {
    if (side) {
      b.rect(0, 22, 8, 4, C.tan); stack(0, 19, 7);
      b.rect(14, 15, 24, 11, tint); b.rect(14, 23, 24, 3, dark); b.rect(16, 15, 21, 1, lite); for (let x = 30; x < 37; x += 2) b.rect(x, 18, 1, 4, dark); b.rect(37, 16, 2, 8, C.lgrey); b.rect(32, 6, 3, 9, C.ink); b.rect(31, 5, 5, 1, C.lgrey);
      b.rect(9, 3, 17, 2, C.white); b.rect(9, 2, 17, 1, C.white); b.rect(10, 5, 2, 10, dark); b.rect(24, 5, 2, 10, dark); b.rect(12, 5, 12, 10, glass); b.line(14, 13, 19, 6, C.white); b.rect(9, 15, 17, 3, tint); bulbs(10, 5, 15);
      wheel(14, 25, 10); wheel(33, 30, 5); wreathOn(25, 20);
    } else {
      b.rect(12, 12, 18, 18, tint); b.rect(12, 25, 18, 5, dark); b.rect(14, 12, 14, 1, lite); b.rect(14, 3, 14, 10, glass); b.rect(13, 2, 16, 2, C.white); b.rect(13, 3, 1, 10, dark); b.rect(28, 3, 1, 10, dark); wheel(6, 24, 8); wheel(36, 24, 8);
      if (dir === 2) { b.rect(16, 17, 10, 6, C.lgrey); for (let x = 17; x < 25; x += 2) b.rect(x, 17, 1, 6, C.dgrey); b.rect(13, 26, 3, 2, C.gold); b.rect(26, 26, 3, 2, C.gold); wreathOn(21, 20); } else stack(15, 28, 8);
    }
  } else if (kind === 3) {
    if (side) {
      b.rect(6, 18, 44, 22, tint); b.rect(6, 34, 44, 6, dark); b.rect(8, 18, 40, 1, lite); b.rect(6, 27, 44, 2, C.gold); for (let x = 12; x < 44; x += 8) b.rect(x, 22, 3, 3, dark); stack(8, 16, 10);
      b.rect(32, 6, 16, 12, glass); b.rect(31, 5, 18, 2, C.white); b.rect(31, 7, 1, 11, dark); b.rect(47, 7, 2, 11, dark); b.line(35, 15, 41, 8, C.white); bulbs(8, 18, 38);
      // the santa hat on the cab
      b.rect(33, 2, 14, 3, C.red); b.rect(36, 0, 8, 2, C.red); b.rect(31, 4, 18, 2, C.white); b.disc(30, 2, 1.6, 1.6, C.white); b.rect(31, 1, 6, 1, C.dred);
      wheel(16, 40, 9); wheel(40, 42, 7); b.rect(50, 26, 4, 3, C.dgrey);
      b.rect(53, 18, 12, 26, C.lgrey); for (let y = 18; y < 44; y += 4) b.rect(54, y + frame * 2, 10, 2, ((y >> 2) & 1) ? C.red : C.white); b.rect(53, 18, 1, 26, C.dgrey); b.rect(64, 18, 1, 26, C.dgrey);
    } else {
      b.rect(16, 12, 34, 28, tint); b.rect(16, 34, 34, 6, dark); b.rect(18, 12, 30, 1, lite); b.rect(22, 3, 22, 11, glass); b.rect(21, 2, 24, 2, C.white); wheel(9, 32, 7); wheel(57, 32, 7);
      if (dir === 2) { b.rect(0, 38, W, 8, C.lgrey); for (let x = 2; x < W; x += 6) b.rect(x + frame * 2, 39, 3, 6, ((x / 6) | 0) % 2 ? C.red : C.white); wreathOn(33, 22); } else stack(26, 30, 12);
    }
  } else if (kind === 4) {
    const cy = 30;
    b.rect(30, cy - 9, 36, 18, tint); b.rect(30, cy + 4, 36, 5, dark); b.rect(34, cy - 9, 26, 1, lite); b.disc(62, cy - 1, 11, 10, tint); b.disc(66, cy - 3, 6, 6, glass); b.line(62, cy - 3, 69, cy - 7, C.white); b.px(73, cy + 1, C.red); b.rect(72, cy, 2, 3, C.red);
    b.rect(4, cy - 4, 28, 5, tint); b.rect(4, cy - 1, 28, 2, dark); b.rect(3, cy - 12, 5, 11, tint); b.rect(1, cy - 13 + frame * 2, 8, 2, C.lgrey); b.rect(44, cy - 13, 4, 5, C.dgrey);
    for (let x = 32; x < 62; x += 6) { b.rect(x, cy - 4, 3, 2, C.white); } antlers(62, cy - 11); bulbs(30, cy + 3, 30);
    if (frame) b.rect(4, cy - 15, 84, 1, C.lgrey); else { b.rect(22, cy - 16, 52, 1, C.lgrey); b.rect(40, cy - 18, 14, 3, C.grey); }
    b.rect(34, cy + 9, 26, 1, C.gold); b.rect(38, cy + 9, 1, 4, C.dgrey); b.rect(56, cy + 9, 1, 4, C.dgrey); b.rect(32, cy + 13, 30, 1, C.lgrey);
  }
  b.outline(RIM);
  c = (flip ? b.flip() : b).bake(); bCache.set(key, c); return c;
}

export function deerSprite(dir: number, frame: number) {
  const key = `d${dir}${frame}`; let c = bCache.get(key); if (c) return c;
  const b = new Buf(24, 25), x = 11, y = 11; reindeer(b, x, y, frame);
  for (let i = 0; i < 6; i++) for (let q = 0; q < 24; q++) b.d[(y + 10 + i) * b.w + q] = 0;
  for (const [q, s] of [[-8, 1], [-5, -1], [1, 1], [4, -1]] as const) { const o = frame ? s : 0; b.rect(x + q + o, y + 10, 2, 5, C.bark); b.rect(x + q + o, y + 15, 2, 1, C.ink); }
  b.outline(RIM); c = (dir === 3 ? b.flip() : b).bake(); bCache.set(key, c); return c;
}
export function dogSprite(dir: number, frame: number) {
  const key = `g${dir}${frame}`; let c = bCache.get(key); if (c) return c;
  const b = new Buf(16, 13); b.rect(3, 5, 9, 4, C.tan); b.rect(3, 8, 9, 1, C.brown); b.rect(10, 2, 4, 4, C.cream); b.rect(13, 4, 1, 1, C.ink); b.px(12, 3, C.ink); b.rect(10, 1, 2, 2, C.brown); b.rect(9, 5, 3, 2, C.red); b.px(8, 6, C.red); b.px(2, 4 + frame, C.tan); b.px(1, 3 + frame, C.tan);
  for (const [x, s] of [[3, 0], [5, 1], [9, 0], [11, 1]] as const) b.rect(x, 9, 1, 3 - (frame && s ? 1 : 0), C.brown);
  b.outline(RIM); c = (dir === 3 ? b.flip() : b).bake(); bCache.set(key, c); return c;
}
export function carSprite(col: string, tree: boolean, dir: number) {
  const key = `c${col}${tree}${dir}`; let c = bCache.get(key); if (c) return c;
  const b = new Buf(36, 22), dark = mix(col, C.ink, 0.42), lite = mix(col, C.white, 0.38), o = 3;
  b.rect(o + 1, 12, 29, 6, col); b.rect(o + 1, 17, 29, 1, dark); b.rect(o + 3, 12, 25, 1, lite); b.rect(o + 2, 14, 16, 2, '#a06c44'); b.rect(o + 2, 14, 16, 1, C.tan);
  b.rect(o + 4, 6, 19, 6, col); b.rect(o + 5, 7, 5, 4, C.ice); b.rect(o + 11, 7, 5, 4, C.ice); b.rect(o + 17, 7, 5, 4, C.ice); b.rect(o + 4, 6, 19, 1, lite); b.rect(o + 29, 14, 1, 2, C.lemon); b.px(o + 1, 14, C.red); b.px(o + 1, 15, C.red);
  for (const x of [o + 7, o + 24]) { b.disc(x, 18, 3, 3, C.ink); b.disc(x, 18, 1, 1, C.lgrey); }
  wreath(b, o + 27, 13, 2);
  if (tree) { b.rect(o + 3, 4, 3, 1, C.bark); for (let i = 0; i < 20; i++) { const h = 1 + Math.round((1 - i / 20) * 3); b.rect(o + 5 + i, 5 - h, 1, h, i % 3 ? C.pine : C.leaf); if (i % 4 === 1) b.px(o + 5 + i, 5 - h, C.white); } b.rect(o + 9, 1, 1, 5, C.tan); b.rect(o + 18, 2, 1, 4, C.tan); }
  else { b.rect(o + 6, 5, 15, 1, C.sn1); }
  b.outline(RIM); c = (dir === 3 ? b.flip() : b).bake(); bCache.set(key, c); return c;
}
export function thiefSprite(frame: number) { return person({ hat: C.plum, coat: C.purple, skin: '#9ad08a', pants: C.ink, kind: 'hood', trim: C.gold }, 3, frame, true); }

/** Santa, with nine reindeer's worth of confidence. Faces right. */
export function santaSleigh(frame: number, night = false) {
  const key = `ss${frame}${night}`; let c = bCache.get(key); if (c) return c;
  const W = 124, Hh = 36, b = new Buf(W, Hh), sil = night;
  const P = (col: string) => (sil ? '#141238' : col);
  for (let i = 0; i < 4; i++) {
    const x = 50 + i * 18, bob = ((frame + i) % 2), y = 16 + bob - (i % 2);
    b.rect(x, y, 12, 5, P(C.brown)); b.rect(x, y + 4, 12, 1, P(C.bark)); b.rect(x + 9, y - 4, 3, 5, P(C.brown)); b.rect(x + 9, y - 6, 6, 3, P(C.brown)); b.px(x + 15, y - 5, i === 3 ? C.red : P(C.tan)); b.line(x + 10, y - 7, x + 8, y - 11, P(C.tan)); b.line(x + 12, y - 7, x + 14, y - 11, P(C.tan));
    const f = (frame + i) % 2 ? 3 : -3; b.line(x + 1, y + 5, x + 1 - f, y + 9, P(C.bark)); b.line(x + 3, y + 5, x + 3 - f, y + 9, P(C.bark)); b.line(x + 9, y + 5, x + 9 + f, y + 9, P(C.bark)); b.line(x + 11, y + 5, x + 11 + f, y + 9, P(C.bark));
    b.line(x - 6, y + 3, x, y + 2, P(C.gold));
  }
  b.line(44, 22, 50, 20, P(C.gold));
  for (let x = 6; x < 46; x++) { const u = (x - 6) / 40, t = 16 + Math.round(Math.sin(u * 3.14) * 3 - (u > 0.8 ? (u - 0.8) * 30 : 0) - (u < 0.2 ? (0.2 - u) * 40 : 0)); b.rect(x, t, 1, 28 - t, P(C.red)); if (!sil) b.px(x, t, C.gold); }
  for (let x = 2; x < 50; x++) { const y = 31 + (x > 42 ? -Math.round(((x - 42) / 8) ** 2 * 5) : 0); b.px(x, y, P(C.gold)); } b.rect(12, 28, 2, 3, P(C.gold)); b.rect(34, 28, 2, 3, P(C.gold));
  b.rect(26, 9, 10, 9, P(C.red)); b.rect(26, 9, 10, 1, P(C.white)); b.rect(28, 4, 8, 6, P('#f0c8a0')); b.rect(27, 6, 9, 5, P(C.white)); b.rect(28, 1, 8, 3, P(C.red)); b.rect(27, 3, 10, 2, P(C.white)); b.px(26, 1, P(C.white));
  b.rect(8, 7, 14, 10, P('#9a6a3a')); b.disc(15, 7, 6, 3, P('#9a6a3a')); if (!sil) { b.px(12, 5, C.red); b.px(16, 4, C.gold); b.px(19, 6, C.aqua); }
  if (!sil) b.outline(RIM);
  c = b.bake(); bCache.set(key, c); return c;
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
    gift: ['.....rr.....', '...r.rr.r...', '...rrrrrr...', '.gggggrrggg.', '.gggggrrggg.', '.rrrrrrrrrr.', '.gggggrrggg.', '.gggggrrggg.', '.gggggrrggg.', '.gggggrrggg.', '............', '............'],
    wreath: ['....llll....', '..llllllll..', '.lll....lll.', '.ll......ll.', 'lll......lll', 'lll......lll', '.ll......ll.', '.lll.rr.lll.', '..lllrrlll..', '....rrrr....', '...rr..rr...', '............'],
    x: ['............', '.rr.....rr..', '..rr...rr...', '...rr.rr....', '....rrr.....', '...rr.rr....', '..rr...rr...', '.rr.....rr..', '............', '............', '............', '............'],
  };
  P(S[name] ?? S.tree);
  c = r.c; bCache.set(key, c); return c;
}


// ---- the big set pieces ---------------------------------------------------------------------------------
export function moonSprite(r: number) {
  return once(`moon${r}`, () => {
    const b = new Buf(r * 2 + 2, r * 2 + 2), c = r + 1; b.disc(c, c, r, r, '#fff6c8');
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.hypot(x, y) / r; if (d > 1) continue; if (x + y > r * 0.6 && d > 0.55) b.px(c + x, c + y, '#f2dc98'); if (x + y > r * 0.95) b.px(c + x, c + y, '#dcc080'); }
    for (const [x, y, q] of [[-0.3, -0.25, 0.24], [0.3, 0.18, 0.18], [-0.1, 0.45, 0.13], [0.42, -0.42, 0.1], [-0.55, 0.2, 0.09]]) { b.disc(c + x * r, c + y * r, q * r, q * r, '#ecd490'); b.disc(c + x * r - 1, c + y * r - 1, q * r * 0.7, q * r * 0.7, '#f8e8b0'); }
    return b.bake();
  });
}
/** the seat you get on Christmas Eve: the back of the sleigh, the team out ahead */
export function sleighBack(frame: number) {
  return once(`sb2${frame}`, () => {
    const W = 120, H = 96, b = new Buf(W, H), cx = W >> 1, sil = '#2a1a3e';
    // reindeer pairs, smaller as they go
    for (let i = 3; i >= 0; i--) {
      const sc = 0.5 + i * 0.17, y = 8 + i * 9 + ((frame + i) % 2), sp = 11 + i * 3.2;
      for (const s of [-1, 1]) {
        const x = cx + s * sp; b.disc(x, y + 3 * sc, 5 * sc, 4.5 * sc, C.brown); b.disc(x, y + 4.5 * sc, 4 * sc, 3 * sc, C.bark); b.px(x, y + 7 * sc, C.white); b.disc(x, y - 2 * sc, 2.6 * sc, 2.3 * sc, C.brown);
        b.line(x - 1, y - 3 * sc, x - 5 * sc, y - 8 * sc, C.tan); b.line(x + 1, y - 3 * sc, x + 5 * sc, y - 8 * sc, C.tan); b.px(x - 4 * sc, y - 5 * sc, C.tan); b.px(x + 4 * sc, y - 5 * sc, C.tan);
        b.rect(x - 4 * sc, y + 1, 8 * sc, 1, C.red); b.px(x, y + 2, C.gold); const leg = (frame + i) % 2 ? 1 : 0; b.rect(x - 3 * sc, y + 7 * sc, 1, 2 + leg, C.bark); b.rect(x + 2 * sc, y + 7 * sc, 1, 3 - leg, C.bark);
      }
    }
    for (const s of [-1, 1]) b.line(cx + s * 7, 56, cx + s * 13, 12, C.gold);
    // sack and gifts
    b.disc(cx - 30, 56, 14, 12, '#9a6a3a'); b.disc(cx - 33, 52, 8, 7, '#b88450'); b.rect(cx - 33, 42, 6, 3, C.gold);
    b.rect(cx + 18, 46, 13, 13, C.leaf); b.rect(cx + 24, 46, 2, 13, C.gold); b.rect(cx + 18, 52, 13, 2, C.gold); b.rect(cx + 29, 50, 11, 10, '#2f7ae0'); b.rect(cx + 34, 50, 2, 10, C.white); b.rect(cx + 24, 40, 10, 8, C.gold); b.rect(cx + 28, 40, 2, 8, C.red);
    // the man himself, from behind
    b.disc(cx, 52, 13, 13, C.red); b.disc(cx - 3, 49, 8, 8, '#f04a48'); b.rect(cx - 13, 44, 27, 3, C.white); b.rect(cx - 13, 46, 27, 1, C.sn3); b.disc(cx, 37, 7, 6, C.red); b.disc(cx, 33, 5, 4, C.red); b.rect(cx - 7, 41, 15, 3, C.white); b.line(cx + 2, 31, cx + 9, 36, C.red); b.line(cx + 3, 31, cx + 9, 37, C.dred); b.disc(cx + 10, 38, 2, 2, C.white); b.line(cx - 12, 49, cx - 8, 40, C.dred); b.line(cx + 12, 49, cx + 8, 40, C.dred);
    // the body of the sleigh
    for (let x = -46; x <= 46; x++) { const u = x / 46, top = 60 + Math.round(u * u * -11), bot = 86 - Math.round(u * u * 6); b.rect(cx + x, top, 1, bot - top, x < -8 ? '#e0363a' : x > 28 ? C.dred : C.red); b.px(cx + x, top, C.gold); b.px(cx + x, top + 1, C.lemon); b.px(cx + x, bot - 1, C.gold); b.px(cx + x, bot - 2, '#c07a10'); }
    for (const s of [-1, 1]) { for (let q = 0; q < 24; q++) { const a = q / 24 * 5.2, r = 3 + q * 0.28; b.px(cx + s * 30 + Math.cos(a) * r * s, 73 + Math.sin(a) * r, C.gold); } }
    wreath(b, cx, 72, 7);
    for (const s of [-1, 1]) { const x0 = cx + s * 40; for (let y = 78; y < 94; y++) b.rect(x0 - 1 + Math.round((y - 78) * 0.25 * s), y, 3, 1, y > 90 ? C.lemon : C.gold); b.rect(x0 - 12 * (s > 0 ? 1 : 0), 84, 12, 2, C.gold); }
    b.outline(sil); return b.bake();
  });
}
/** chubby candy-striped title lettering, built on the bitmap face so it stays in the family */
export function logoWord(mask: (x: number, y: number) => boolean, w: number, h: number, cell: number, fill: 'candy' | 'gold' | 'green') {
  const pad = 8, W = w * cell + pad * 2, H = h * cell + pad * 2 + 4, m = new Uint8Array(W * H), r = cell * 0.74;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask(x, y)) {
    const cx = pad + x * cell + cell / 2, cy = pad + y * cell + cell / 2;
    for (let j = -Math.ceil(r); j <= r; j++) for (let i = -Math.ceil(r); i <= r; i++) if (i * i + j * j <= r * r) m[Math.round(cy + j) * W + Math.round(cx + i)] = 1;
    // bridge orthogonal and diagonal neighbours so strokes stay fat and joined
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) if (mask(x + dx, y + dy)) for (let t = 0; t <= cell; t++) { const qx = cx + dx * t, qy = cy + dy * t; for (let j = -Math.ceil(r * 0.8); j <= r * 0.8; j++) for (let i = -Math.ceil(r * 0.8); i <= r * 0.8; i++) if (i * i + j * j <= r * r * 0.64) m[Math.round(qy + j) * W + Math.round(qx + i)] = 1; }
  }
  const b = new Buf(W, H), M = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!M(x, y)) continue; const edgeD = !M(x, y + 2), edgeR = !M(x + 2, y), edgeU = !M(x, y - 2);
    let c: string;
    if (fill === 'candy') { const s = ((x + y) % 14) < 7; c = s ? C.red : C.white; if (edgeD || edgeR) c = s ? C.dred : C.sn3; else if (edgeU) c = s ? '#ff6a60' : C.white; }
    else if (fill === 'green') { const t = (y - pad) / (H - pad * 2); c = t < 0.34 ? '#46c46a' : t < 0.68 ? C.leaf : C.pine; if (edgeD || edgeR) c = C.forest; else if (edgeU) c = C.lime; }
    else { const t = (y - pad) / (H - pad * 2); c = t < 0.3 ? C.lemon : t < 0.62 ? C.gold : C.orange; if (edgeD || edgeR) c = '#b0601a'; else if (edgeU) c = C.white; }
    b.px(x, y, c);
  }
  // snow on every top edge
  for (let x = 0; x < W; x++) { let wasIn = false; for (let y = 0; y < H; y++) { const on = M(x, y); if (on && !wasIn && M(x - 2, y + 1) && M(x + 2, y + 1)) { const d = 2 + Math.round((Math.sin(x * 0.55 + y) * 0.5 + 0.5) * cell * 0.55); for (let k = 0; k < d; k++) if (M(x, y + k)) b.px(x, y + k, k === d - 1 ? C.sn3 : k > d - 3 ? C.sn1 : C.sn0); } wasIn = on; } }
  const shadow = new Buf(W + 6, H + 6); shadow.blit(b, 2, 1); shadow.outline(C.ink, true); shadow.outline(C.ink); const o = new Buf(W + 6, H + 6);
  for (let k = 5; k >= 1; k--) for (let y = 0; y < shadow.h; y++) for (let x = 0; x < shadow.w; x++) if (shadow.get(x, y) && o.in(x + (k >> 1), y + k)) o.d[(y + k) * o.w + x + (k >> 1)] = 0xff3c1014;
  o.blit(shadow, 0, 0); return o;
}
