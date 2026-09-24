/**
 * Procedural textures for the particle / spray system (generated once, shared).
 *
 *   puffAtlas()  2×2 atlas of lumpy cloud puffs, 256 px cells:
 *                RG = pseudo normal (xy, 0.5-biased), B = detail noise, A = density.
 *                Lit in the shader like a tiny volume (sun wrap + sky + forward scatter);
 *                density is eroded with age so old puffs break up into wisps.
 *   mistNoise()  256² tiling fBm (R) for the camera spray veil.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------------------------ noise
function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** tiling value noise: period p (integer lattice cells) */
function vnoise(x: number, y: number, p: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a: number) => ((a % p) + p) % p;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, base: number, oct: number, seed: number) {
  let n = 0, amp = 0.5, f = base, norm = 0;
  for (let o = 0; o < oct; o++) {
    n += vnoise(x * f, y * f, f, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return n / norm;
}

// ------------------------------------------------------------------------------------ puff atlas
let puffTex: THREE.Texture | null = null;
export function puffAtlas(): THREE.Texture {
  if (puffTex) return puffTex;
  const C = 256; // cell
  const S = C * 2;
  const data = new Uint8Array(S * S * 4);
  const h = new Float32Array(C * C);
  const dens = new Float32Array(C * C);
  const det = new Float32Array(C * C);
  for (let cell = 0; cell < 4; cell++) {
    const seed = 11 + cell * 101;
    const ox = (cell % 2) * C;
    const oy = Math.floor(cell / 2) * C;
    // soft gaussian core with low-contrast turbulence inside and a slightly ragged edge:
    // spray/mist, not cauliflower smoke (erosion with age adds the wisps)
    const ax = 0.85 + hash2(cell, 1, 3) * 0.3;
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C, v = (y + 0.5) / C;
        const px = (u * 2 - 1) * ax, py = (v * 2 - 1) / ax;
        const n = fbm(u, v, 3, 5, seed);
        const n2 = fbm(u + 3.1, v + 1.7, 7, 4, seed + 3);
        const r = Math.hypot(px, py) * (1 + (n - 0.5) * 0.5);
        const core = Math.exp(-r * r * 3.2);
        const edge = Math.max(0, 1 - Math.hypot(u * 2 - 1, v * 2 - 1)); // keep inside the quad
        let d = core * (0.55 + 0.75 * n + 0.3 * (n2 - 0.5));
        d = Math.max(0, Math.min(1, d * 1.15)) * Math.min(1, edge * 3.5);
        const i = y * C + x;
        dens[i] = d;
        det[i] = n2;
        // height for the pseudo normal: a dome where it's dense, plus billows
        h[i] = Math.sqrt(Math.max(0, 1 - px * px - py * py)) * 0.6 + d * 0.5 + (n - 0.5) * 0.35;
      }
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const i = y * C + x;
        const hx = h[y * C + Math.min(C - 1, x + 1)] - h[y * C + Math.max(0, x - 1)];
        const hy = h[Math.min(C - 1, y + 1) * C + x] - h[Math.max(0, y - 1) * C + x];
        const k = C * 0.16;
        let nx = -hx * k, ny = -hy * k;
        const l = Math.hypot(nx, ny, 1);
        nx /= l;
        ny /= l;
        // texture rows go up in v (flipY = false, we write rows bottom-up ↔ v)
        const o = ((oy + y) * S + ox + x) * 4;
        data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(det[i] * 255);
        data[o + 3] = Math.round(dens[i] * 255);
      }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  puffTex = t;
  return t;
}

// ------------------------------------------------------------------------------------ mist noise
let mistTex: THREE.Texture | null = null;
export function mistNoise(): THREE.Texture {
  if (mistTex) return mistTex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const a = fbm(u, v, 4, 5, 71);
      const b = fbm(u, v, 8, 4, 93);
      const o = (y * S + x) * 4;
      data[o] = Math.round(a * 255);
      data[o + 1] = Math.round(b * 255);
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  mistTex = t;
  return t;
}
