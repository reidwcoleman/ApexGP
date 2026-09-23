/**
 * Small, fast noise toolkit for the world builder (CPU side).
 *
 *  - `rng(seed)`            deterministic PRNG (mulberry32)
 *  - `perlin2(x, z)`        gradient noise in [-1, 1], optionally periodic (for tileable textures)
 *  - `fbm2`, `ridged2`      fractal sums
 *  - `hash2i(ix, iz)`       integer lattice hash in [0, 1)
 */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2i(ix: number, iz: number, seed = 0): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 12 gradient directions, evenly spaced (avoids axis-aligned artefacts)
const GX = new Float32Array(16);
const GZ = new Float32Array(16);
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2 + 0.3;
  GX[i] = Math.cos(a);
  GZ[i] = Math.sin(a);
}

const PERM = new Uint8Array(512);
{
  const r = rng(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 2D gradient noise, roughly in [-1, 1].
 * With `px`/`pz` > 0 the lattice wraps with that period (tileable).
 */
export function perlin2(x: number, z: number, px = 0, pz = 0): number {
  let ix = Math.floor(x);
  let iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  let ix1 = ix + 1;
  let iz1 = iz + 1;
  if (px > 0) {
    ix = ((ix % px) + px) % px;
    ix1 = ((ix1 % px) + px) % px;
  }
  if (pz > 0) {
    iz = ((iz % pz) + pz) % pz;
    iz1 = ((iz1 % pz) + pz) % pz;
  }
  ix &= 255; ix1 &= 255; iz &= 255; iz1 &= 255;
  const g00 = PERM[PERM[ix] + iz] & 15;
  const g10 = PERM[PERM[ix1] + iz] & 15;
  const g01 = PERM[PERM[ix] + iz1] & 15;
  const g11 = PERM[PERM[ix1] + iz1] & 15;
  const n00 = GX[g00] * fx + GZ[g00] * fz;
  const n10 = GX[g10] * (fx - 1) + GZ[g10] * fz;
  const n01 = GX[g01] * fx + GZ[g01] * (fz - 1);
  const n11 = GX[g11] * (fx - 1) + GZ[g11] * (fz - 1);
  const u = fade(fx);
  const v = fade(fz);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.414;
}

/** fractal Brownian motion, result roughly in [-1, 1] */
export function fbm2(x: number, z: number, octaves = 5, lac = 2.03, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    // rotate each octave a little to break lattice alignment
    const c = 0.8, s = 0.6;
    const rx = x * f;
    const rz = z * f;
    sum += amp * perlin2(rx * c - rz * s + o * 17.3, rx * s + rz * c - o * 9.1);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** ridged multifractal in [0, 1] — sharp crests for mountains/hills */
export function ridged2(x: number, z: number, octaves = 5, lac = 2.1, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(perlin2(x * f + o * 31.7, z * f - o * 12.9));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** tileable fbm over a [0,1)² domain: `cells` = base lattice period */
export function tileFbm(u: number, v: number, cells: number, octaves: number, gain = 0.5, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = cells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin2(u * p + seed * 13.1, v * p + seed * 7.7, p, p);
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
