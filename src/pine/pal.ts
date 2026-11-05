// One locked palette for the whole cartridge. Art, UI and the fake CRT all draw from these.
export const C = {
  ink: '#16122a', night: '#1a1d52', dusk: '#2f3488', blue: '#3a6cd0', sky: '#79bcf2', ice: '#cfe9fb', white: '#fdfcf6',
  cream: '#fbeccb', tan: '#e0b67a', brown: '#a8683a', bark: '#6a3d2a', dbrown: '#3f2322',
  red: '#e0262f', dred: '#94152f', pink: '#ff8f86', orange: '#f58a2c', gold: '#ffc92e', lemon: '#fff09a',
  lime: '#bfe254', grass: '#5fae48', leaf: '#279050', pine: '#166a44', forest: '#0f4640', deep: '#0b2b38',
  teal: '#1f9490', aqua: '#58d2b8', purple: '#7a48a8', plum: '#44285e', grey: '#8f92ac', lgrey: '#c0c4d8', dgrey: '#4d4f70',
  // the snow ramp: every shadow in this world is blue-violet, never grey
  sn0: '#ffffff', sn1: '#eef5fe', sn2: '#d8e6fa', sn3: '#b9cdf2', sn4: '#93a8e2', sn5: '#6c7cc8',
} as const;
export type ColorName = keyof typeof C;
export const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
export function hash(x: number, y: number, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); const g = c.getContext('2d', { willReadFrequently: false })!; g.imageSmoothingEnabled = false; return { c, g }; }

// ---- a pixel buffer: sprites are painted here, then outlined and baked to a canvas ------------------------
const U = new Map<string, number>();
export const u32 = (c: string) => { let v = U.get(c); if (v === undefined) { const [r, g, b] = hex(c); v = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0; U.set(c, v); } return v; };
export class Buf {
  d: Uint32Array;
  constructor(public w: number, public h: number) { this.w = Math.ceil(w); this.h = Math.ceil(h); this.d = new Uint32Array(this.w * this.h); }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x: number, y: number) { return this.in(x, y) ? this.d[y * this.w + x] : 0; }
  px(x: number, y: number, c: string | number) { x = Math.round(x); y = Math.round(y); if (this.in(x, y)) this.d[y * this.w + x] = typeof c === 'string' ? u32(c) : c; }
  /** only over what is already painted */
  over(x: number, y: number, c: string) { x = Math.round(x); y = Math.round(y); if (this.get(x, y)) this.px(x, y, c); }
  rect(x: number, y: number, w: number, h: number, c: string) { x = Math.round(x); y = Math.round(y); const v = u32(c); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (this.in(x + i, y + j)) this.d[(y + j) * this.w + x + i] = v; }
  disc(cx: number, cy: number, rx: number, ry: number, c: string) { for (let y = Math.floor(-ry); y <= ry; y++) for (let x = Math.floor(-rx); x <= rx; x++) if ((x * x) / (rx * rx + 0.01) + (y * y) / (ry * ry + 0.01) <= 1) this.px(cx + x, cy + y, c); }
  line(x0: number, y0: number, x1: number, y1: number, c: string) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) this.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); }
  /** string art: each char keys a colour, '.' is clear */
  map(rows: string[], x: number, y: number, key: Record<string, string>, flip = false) { for (let j = 0; j < rows.length; j++) { const r = rows[j]; for (let i = 0; i < r.length; i++) { const k = r[i]; if (k === '.' || k === ' ') continue; const c = key[k]; if (c) this.px(flip ? x + r.length - 1 - i : x + i, y + j, c); } } }
  /** a 1px rim round the silhouette; rim() may recolour it from the pixel it touches */
  outline(col: string | ((touch: number) => string), diag = false) {
    const { w, h, d } = this, src = d.slice(), f = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? src[y * w + x] : 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      const t = f(x, y + 1) || f(x, y - 1) || f(x - 1, y) || f(x + 1, y) || (diag ? f(x - 1, y - 1) || f(x + 1, y - 1) || f(x - 1, y + 1) || f(x + 1, y + 1) : 0);
      if (t && (t >>> 24) === 255) d[y * w + x] = u32(typeof col === 'string' ? col : col(t));
    }
    return this;
  }
  blit(o: Buf, x: number, y: number) { for (let j = 0; j < o.h; j++) for (let i = 0; i < o.w; i++) { const v = o.d[j * o.w + i]; if (v && this.in(x + i, y + j)) this.d[(y + j) * this.w + x + i] = v; } }
  flip() { const o = new Buf(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) o.d[y * this.w + this.w - 1 - x] = this.d[y * this.w + x]; return o; }
  bake() { const r = canvas(this.w, this.h), im = r.g.createImageData(this.w, this.h); new Uint32Array(im.data.buffer).set(this.d); r.g.putImageData(im, 0, 0); return r.c; }
}
