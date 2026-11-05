// One locked palette for the whole cartridge. Art, UI and the fake CRT all draw from these.
export const C = {
  ink: '#12121c', night: '#1b2340', dusk: '#2c3a6b', blue: '#3f6fb0', sky: '#7fb7e0', ice: '#c9e8f2', white: '#f7f5ea',
  cream: '#f2e4bd', tan: '#d3b37d', brown: '#96663e', bark: '#5e3b2a', dbrown: '#3a2520',
  red: '#c8332d', dred: '#7f1f2b', pink: '#f08a7a', orange: '#e8873a', gold: '#f4c542', lemon: '#fbe88c',
  lime: '#b4d45a', grass: '#6ea846', leaf: '#3f8743', pine: '#25633f', forest: '#17433a', deep: '#102c2f',
  teal: '#2f8f8a', aqua: '#62c7b0', purple: '#6a4a8c', plum: '#3f2a55', grey: '#8b8c9a', lgrey: '#b9bac4', dgrey: '#4c4d5e',
} as const;
export type ColorName = keyof typeof C;
export const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
export function hash(x: number, y: number, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); const g = c.getContext('2d', { willReadFrequently: false })!; g.imageSmoothingEnabled = false; return { c, g }; }
