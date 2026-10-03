import { perlin2, tileFbm } from './noise.ts';

/**
 * The shared env data textures' pixels (textures.ts wraps them), as plain arrays: no three.js here,
 * so the ground worker (src/world/groundWorker.ts) can make them off the main thread during the
 * boot. Deterministic: the worker and the main-thread fallback give the same bytes.
 */

/** the RGBA noise texture's size */
export const NOISE_N = 256;

/**
 * RGBA noise: R = low-frequency fbm (4 cells), G = mid fbm (8 cells),
 * B = high fbm (16 cells), A = billowy/cellular-ish (6 cells). All in [0,1].
 */
export function noiseData(): Uint8Array {
  const N = NOISE_N;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const v = j / N;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const r = tileFbm(u, v, 4, 5, 0.5, 1);
      const g = tileFbm(u, v, 8, 4, 0.5, 2);
      const b = tileFbm(u, v, 16, 3, 0.5, 3);
      const a = 1 - Math.abs(tileFbm(u, v, 6, 4, 0.55, 4));
      const k = (j * N + i) * 4;
      data[k] = Math.max(0, Math.min(255, (r * 0.5 + 0.5) * 255));
      data[k + 1] = Math.max(0, Math.min(255, (g * 0.5 + 0.5) * 255));
      data[k + 2] = Math.max(0, Math.min(255, (b * 0.5 + 0.5) * 255));
      data[k + 3] = Math.max(0, Math.min(255, a * a * 255));
    }
  }
  return data;
}

export function heightToNormal(h: Float32Array, N: number, strength: number, M = N): Uint8Array {
  const data = new Uint8Array(N * M * 4);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const l = h[j * N + ((i - 1 + N) % N)];
      const r = h[j * N + ((i + 1) % N)];
      const d = h[((j - 1 + M) % M) * N + i];
      const u = h[((j + 1) % M) * N + i];
      let nx = (l - r) * strength;
      let nz = (d - u) * strength;
      let ny = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const k = (j * N + i) * 4;
      // stored as tangent-space-ish (x = +u, y = +v, z = up) so the shader can use .xzy
      data[k] = (nx * 0.5 + 0.5) * 255;
      data[k + 1] = (nz * 0.5 + 0.5) * 255;
      data[k + 2] = (ny * 0.5 + 0.5) * 255;
      data[k + 3] = Math.max(0, Math.min(255, (h[j * N + i] * 0.5 + 0.5) * 255));
    }
  }
  return data;
}

/** the ground detail normal's size */
export const DETAIL_N = 256;

/** ground detail normal (RGB = normal, A = height) — clumpy grass/soil bumps */
export function detailNormalData(): Uint8Array {
  const N = DETAIL_N;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const a = tileFbm(u, v, 8, 5, 0.55, 11);
      const b = 1 - Math.abs(perlin2(u * 32 + 3.3, v * 32 + 1.1, 32, 32));
      h[j * N + i] = a * 0.8 + b * b * 0.35;
    }
  return heightToNormal(h, N, 2.2);
}
