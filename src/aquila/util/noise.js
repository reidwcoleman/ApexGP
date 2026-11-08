// Small deterministic noise + RNG helpers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h;
}

const GRAD = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

// 2D gradient noise in roughly [-1, 1]
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const g00 = GRAD[hash2(ix, iy, seed) & 7], g10 = GRAD[hash2(ix + 1, iy, seed) & 7];
  const g01 = GRAD[hash2(ix, iy + 1, seed) & 7], g11 = GRAD[hash2(ix + 1, iy + 1, seed) & 7];
  const n00 = g00[0] * fx + g00[1] * fy;
  const n10 = g10[0] * (fx - 1) + g10[1] * fy;
  const n01 = g01[0] * fx + g01[1] * (fy - 1);
  const n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return 1.4 * (n00 + u * (n10 - n00) + v * (n01 - n00) + u * v * (n00 - n10 - n01 + n11));
}

export function fbm(x, y, oct = 5, seed = 0) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function ridged(x, y, oct = 5, seed = 0) {
  let a = 0.5, f = 1, s = 0, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(noise2(x * f, y * f, seed + i * 31));
    v *= v; v *= w; w = Math.min(1, v * 2);
    s += a * v; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
