import * as THREE from 'three';

/**
 * Cut-out textures (leaves, bushes, crowd sprites) are drawn on a transparent canvas, so every empty
 * texel is black. The GPU's mipmaps and bilinear filter average those blacks into the colour at each
 * shape's edge, and an alpha-tested cut-out then wears a dark ink outline that thickens with distance.
 * This fills the colour under the empty texels from the nearest solid ones (push-pull: a pyramid of
 * weighted averages, filled back down), leaving the alpha exactly as drawn.
 */
const made = new WeakMap<HTMLCanvasElement, THREE.DataTexture>();
/** (the same canvas filled once: a later call shares the texture) */
export function bleedAlpha(cv: HTMLCanvasElement, cut = 128): THREE.DataTexture {
  const known = made.get(cv);
  if (known) return known;
  const t = bleedNow(cv, cut);
  made.set(cv, t);
  return t;
}

function bleedNow(cv: HTMLCanvasElement, cut: number): THREE.DataTexture {
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  bleed(d, W, H, cut);
  // (a canvas keeps its colour premultiplied: a fully transparent texel's colour can't survive the
  // round trip, so the result goes up as data — rows bottom-up, as a canvas texture's flipY uploads them)
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) out.set(d.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function bleed(d: Uint8ClampedArray, W: number, H: number, cut: number) {
  // level 0: colour × weight and the weight (solid = 1), then 2×2 sums up to a single texel
  type Lv = { w: number; h: number; c: Float32Array; k: Float32Array };
  const n = W * H;
  const c0 = new Float32Array(n * 3);
  const k0 = new Float32Array(n);
  let empty = 0;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const o = i * 4;
    if (d[o + 3] >= cut) {
      k0[i] = 1;
      c0[j] = d[o];
      c0[j + 1] = d[o + 1];
      c0[j + 2] = d[o + 2];
    } else empty++;
  }
  if (!empty || empty === n) return;
  const levels: Lv[] = [{ w: W, h: H, c: c0, k: k0 }];
  for (let p = levels[0]; p.w > 1 || p.h > 1; p = levels[levels.length - 1]) {
    const w = Math.max(1, p.w >> 1), h = Math.max(1, p.h >> 1);
    const c = new Float32Array(w * h * 3);
    const k = new Float32Array(w * h);
    const pw = p.w, ph = p.h, pc = p.c, pk = p.k;
    for (let y = 0; y < h; y++) {
      const y0 = Math.min(ph - 1, y * 2) * pw, y1 = Math.min(ph - 1, y * 2 + 1) * pw;
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(pw - 1, x * 2), x1 = Math.min(pw - 1, x * 2 + 1);
        const a = y0 + x0, b = y0 + x1, e = y1 + x0, f = y1 + x1;
        const kk = pk[a] + pk[b] + pk[e] + pk[f];
        const o = y * w + x;
        k[o] = kk;
        if (kk === 0) continue;
        const o3 = o * 3, a3 = a * 3, b3 = b * 3, e3 = e * 3, f3 = f * 3;
        c[o3] = pc[a3] + pc[b3] + pc[e3] + pc[f3];
        c[o3 + 1] = pc[a3 + 1] + pc[b3 + 1] + pc[e3 + 1] + pc[f3 + 1];
        c[o3 + 2] = pc[a3 + 2] + pc[b3 + 2] + pc[e3 + 2] + pc[f3 + 2];
      }
    }
    levels.push({ w, h, c, k });
  }
  // pull: a texel with weight keeps its own average (blended toward the coarser fill while its weight
  // is under one), an empty one takes the coarser level's
  const top = levels[levels.length - 1];
  const tk = Math.max(1e-6, top.k[0]);
  let fill = Float32Array.from([top.c[0] / tk, top.c[1] / tk, top.c[2] / tk]);
  let fw = 1, fh = 1;
  for (let li = levels.length - 2; li >= 0; li--) {
    const L = levels[li];
    const next = new Float32Array(L.w * L.h * 3);
    for (let y = 0; y < L.h; y++) {
      const uy = Math.min(fh - 1, y >> 1) * fw;
      for (let x = 0; x < L.w; x++) {
        const o = y * L.w + x, o3 = o * 3;
        const u3 = (uy + Math.min(fw - 1, x >> 1)) * 3;
        const kk = L.k[o];
        if (kk === 0) {
          next[o3] = fill[u3];
          next[o3 + 1] = fill[u3 + 1];
          next[o3 + 2] = fill[u3 + 2];
        } else {
          const a = kk < 1 ? kk : 1, inv = 1 / kk, b = 1 - a;
          next[o3] = L.c[o3] * inv * a + fill[u3] * b;
          next[o3 + 1] = L.c[o3 + 1] * inv * a + fill[u3 + 1] * b;
          next[o3 + 2] = L.c[o3 + 2] * inv * a + fill[u3 + 2] * b;
        }
      }
    }
    fill = next;
    fw = L.w;
    fh = L.h;
  }
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const o = i * 4;
    if (d[o + 3] >= cut) continue;
    d[o] = fill[j];
    d[o + 1] = fill[j + 1];
    d[o + 2] = fill[j + 2];
  }
}
