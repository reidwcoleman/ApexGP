import * as THREE from 'three';
import { DETAIL_N, NOISE_N, detailNormalData, heightToNormal, noiseData } from './textureData.ts';

/**
 * Shared procedural data textures (all tileable, linear/NoColorSpace, mipmapped).
 * Built once per page and cached. Their pixels (textureData.ts) are usually made by the ground
 * worker during the boot (adoptNoisePixels); whatever hasn't arrived is made here, the same bytes.
 */

let _noise: THREE.DataTexture | null = null;
let _detailNormal: THREE.DataTexture | null = null;
let _noisePx: Uint8Array | null = null;
let _detailPx: Uint8Array | null = null;

/** the pixels the ground worker made (used if the textures aren't built yet) */
export function adoptNoisePixels(noise: Uint8Array | null, detail: Uint8Array | null) {
  if (noise && noise.length === NOISE_N * NOISE_N * 4) _noisePx = noise;
  if (detail && detail.length === DETAIL_N * DETAIL_N * 4) _detailPx = detail;
}

export { heightToNormal };

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
  const N = NOISE_N;
  _noise = finish(new THREE.DataTexture(_noisePx ?? noiseData(), N, N, THREE.RGBAFormat, THREE.UnsignedByteType));
  _noisePx = null;
  return _noise;
}

/**
 * texture2D( uNoise, uv ) on the CPU (repeat wrap, bilinear): lets placement code follow what the
 * terrain shader draws from the same noise (the farmland's warped field grid)
 */
export function sampleNoise(u: number, v: number, ch: 0 | 1 | 2 | 3): number {
  const d = noiseTexture().image.data as Uint8Array;
  const N = 256;
  const x = u * N - 0.5, y = v * N - 0.5;
  const i0 = Math.floor(x), j0 = Math.floor(y);
  const fx = x - i0, fy = y - j0;
  const i = ((i0 % N) + N) % N, j = ((j0 % N) + N) % N;
  const i1 = (i + 1) % N, j1 = (j + 1) % N;
  const at = (a: number, b: number) => d[(b * N + a) * 4 + ch];
  return ((at(i, j) * (1 - fx) + at(i1, j) * fx) * (1 - fy) + (at(i, j1) * (1 - fx) + at(i1, j1) * fx) * fy) / 255;
}

/** the farmland's warped coordinates (terrain.ts: wp = p + ( vec2( m1, m2 ) - 0.5 ) * 260.0) */
export function fieldWarp(x: number, z: number): [number, number] {
  const m1 = sampleNoise(x * 0.00093 + 0.13, z * 0.00093 + 0.71, 0);
  const m2 = sampleNoise(x * 0.0041 + 0.37, z * 0.0041 + 0.19, 1);
  return [x + (m1 - 0.5) * 260, z + (m2 - 0.5) * 260];
}

/** ground detail normal (RGB = normal, A = height) — clumpy grass/soil bumps */
export function detailNormalTexture(): THREE.DataTexture {
  if (_detailNormal) return _detailNormal;
  const N = DETAIL_N;
  _detailNormal = finish(new THREE.DataTexture(_detailPx ?? detailNormalData(), N, N, THREE.RGBAFormat, THREE.UnsignedByteType));
  _detailPx = null;
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
