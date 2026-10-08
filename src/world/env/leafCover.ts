/** the alpha the coverage is kept at (the leaf cards' cut lies around it: treematerial leafTune) */
export const COVER_T = 0.42;

/**
 * Coverage-preserving alpha for the leaf atlas (Castaño, "Computing Alpha Mipmaps", 2010 — what
 * Witcher 3's and Fortnite's foliage use). A mip averages a leaf's opaque texels with the sky
 * between the leaves, so at mip 3 a spray that was 40 % leaf is a haze of 0.2–0.4 alpha and an
 * alpha test at a fixed cut wipes most of it out: distant crowns thinned to a few blobs, and the
 * hashed alpha that papered over it speckled and crawled (worst in the rain, when the glossier
 * leaves sparkle too). Instead, per atlas cell and mip level, the gain that makes the share of
 * texels above the cut what it is at full resolution: a distant spray keeps exactly its near
 * coverage, cut cleanly, and the TAA's jitter resolves its edges.
 *
 * `px`: the atlas's RGBA bytes (GL orientation), w × h, cols × rows cells. Returns the gains,
 * x = cell (row-major from the bottom), y = mip level (box-filtered, as the GPU's own mips).
 */
export function leafCoverGains(px: Uint8ClampedArray, w: number, h: number, cols: number, rows: number): { gain: Float32Array; levels: number } {
  let a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3] / 255;
  const cs = Math.floor(w / cols);
  const levels = Math.round(Math.log2(cs)) + 1;
  const cells = cols * rows;
  const gain = new Float32Array(cells * levels).fill(1);
  const target = new Float32Array(cells);
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  let lw = w;
  for (let L = 0; L < levels; L++) {
    const c = cs >> L;
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const ci = cy * cols + cx;
        const n = c * c;
        if (L === 0) {
          let k = 0;
          for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) if (a[(cy * c + y) * lw + cx * c + x] >= COVER_T) k++;
          target[ci] = k / n;
          continue;
        }
        // the alpha of the texel at the target rank (counted down from the most opaque): every
        // texel at or above it should pass the cut
        const want = Math.round(target[ci] * n);
        if (want <= 0) continue;
        hist.fill(0);
        for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) hist[Math.min(BINS - 1, Math.floor(a[(cy * c + y) * lw + cx * c + x] * BINS))]++;
        let acc = 0, b = BINS - 1;
        for (; b > 0; b--) {
          acc += hist[b];
          if (acc >= want) break;
        }
        gain[L * cells + ci] = Math.min(4, Math.max(1, COVER_T / Math.max(b / BINS, 1e-3)));
      }
    if (L === levels - 1) break;
    // the next mip (2 × 2 box)
    const nw = lw >> 1, nh = (h >> L) >> 1;
    const next = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const i = y * 2 * lw + x * 2;
        next[y * nw + x] = (a[i] + a[i + 1] + a[i + lw] + a[i + lw + 1]) * 0.25;
      }
    a = next;
    lw = nw;
  }
  return { gain, levels };
}
