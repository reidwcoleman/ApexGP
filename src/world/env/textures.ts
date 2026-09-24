import * as THREE from 'three';
import { perlin2, tileFbm } from './noise.ts';

/**
 * Shared procedural data textures (all tileable, linear/NoColorSpace, mipmapped).
 * Built once per page and cached.
 */

let _noise: THREE.DataTexture | null = null;
let _detailNormal: THREE.DataTexture | null = null;

export function finish(tex: THREE.DataTexture, aniso = 8) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/**
 * RGBA noise: R = low-frequency fbm (4 cells), G = mid fbm (8 cells),
 * B = high fbm (16 cells), A = billowy/cellular-ish (6 cells). All in [0,1].
 */
export function noiseTexture(): THREE.DataTexture {
  if (_noise) return _noise;
  const N = 256;
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
  _noise = finish(new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType));
  return _noise;
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

/** ground detail normal (RGB = normal, A = height) — clumpy grass/soil bumps */
export function detailNormalTexture(): THREE.DataTexture {
  if (_detailNormal) return _detailNormal;
  const N = 256;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const a = tileFbm(u, v, 8, 5, 0.55, 11);
      const b = 1 - Math.abs(perlin2(u * 32 + 3.3, v * 32 + 1.1, 32, 32));
      h[j * N + i] = a * 0.8 + b * b * 0.35;
    }
  _detailNormal = finish(new THREE.DataTexture(heightToNormal(h, N, 2.2), N, N, THREE.RGBAFormat, THREE.UnsignedByteType));
  return _detailNormal;
}

/** Canvas helper: returns a 2D context of the requested size. */
export function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

export function canvasTexture(canvas: HTMLCanvasElement, srgb = true, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
