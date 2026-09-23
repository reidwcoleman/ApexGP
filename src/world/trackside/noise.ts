/**
 * Small, fast, deterministic noise helpers for procedural textures.
 * Everything here is tileable on a square texture of `size` pixels.
 */

export function hash32(a: number): number {
  a |= 0;
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  a ^= a >>> 16;
  return a >>> 0;
}

/** 0..1 hash of an integer lattice point. */
export function hash2(x: number, y: number, seed: number): number {
  return hash32(Math.imul(x, 73856093) ^ hash32(Math.imul(y, 19349663) + Math.imul(seed, 83492791))) / 4294967296;
}

/** mulberry32 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** Smooth (quintic) value noise with `period` lattice cells across the texture; tileable. Values 0..1. */
export function tileNoise(size: number, period: number, seed: number): Float32Array {
  const lat = new Float32Array(period * period);
  for (let y = 0; y < period; y++) for (let x = 0; x < period; x++) lat[y * period + x] = hash2(x, y, seed);
  const ix0 = new Int32Array(size);
  const ix1 = new Int32Array(size);
  const fx = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const g = (x * period) / size;
    const i = Math.floor(g);
    const f = g - i;
    ix0[x] = i % period;
    ix1[x] = (i + 1) % period;
    fx[x] = f * f * f * (f * (f * 6 - 15) + 10);
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const r0 = ix0[y] * period;
    const r1 = ix1[y] * period;
    const fy = fx[y];
    for (let x = 0; x < size; x++) {
      const a = lat[r0 + ix0[x]];
      const b = lat[r0 + ix1[x]];
      const c = lat[r1 + ix0[x]];
      const d = lat[r1 + ix1[x]];
      const f = fx[x];
      const top = a + (b - a) * f;
      const bot = c + (d - c) * f;
      out[y * size + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Tileable fBm, normalised to 0..1. */
export function tileFbm(size: number, basePeriod: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves && period <= size; o++) {
    const n = tileNoise(size, period, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= gain;
    period *= 2;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const v = out[i] / total;
    out[i] = v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const k = 1 / Math.max(1e-6, mx - mn);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}

/** Tangent-space normal map (RGBA8) from a tileable height field. */
export function normalFromHeight(h: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (h[yc + xp] - h[yc + xm]) * 0.5 * strength;
      const dy = (h[yp + x] - h[ym + x]) * 0.5 * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = 1 / Math.hypot(nx, ny, nz);
      nx *= l; ny *= l; nz *= l;
      const o = (yc + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

export function linToSrgb8(v: number): number {
  v = v <= 0 ? 0 : v >= 1 ? 1 : v;
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** Lookup table for linear 0..1 → sRGB byte (4096 steps), much faster than pow per pixel. */
const LUT = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) LUT[i] = linToSrgb8(i / 4096);
export function srgb8(v: number): number {
  const i = (v * 4096) | 0;
  return LUT[i < 0 ? 0 : i > 4096 ? 4096 : i];
}

/** Separable wrap-around box blur (in place), `r` pixels. */
export function blurWrap(src: Float32Array, size: number, r: number): Float32Array {
  const tmp = new Float32Array(size * size);
  const w = 2 * r + 1;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + ((k + size) % size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = acc / w;
      acc += src[row + ((x + r + 1) % size)] - src[row + ((x - r + size) % size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + size) % size) * size + x];
    for (let y = 0; y < size; y++) {
      src[y * size + x] = acc / w;
      acc += tmp[((y + r + 1) % size) * size + x] - tmp[((y - r + size) % size) * size + x];
    }
  }
  return src;
}
