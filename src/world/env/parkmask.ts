import * as THREE from 'three';
import type { WorldMap, Bounds } from './worldmap.ts';
import type { Layout } from './layout.ts';

/**
 * Ground masks for the terrain shader, drawn with canvas 2D (anti-aliased paths,
 * soft lawns) over the fine region at ~1.3 m per texel:
 *   R  forest floor (leaf litter under the canopy, drawn from the real trees)
 *   G  mown lawn (vs. rougher meadow)
 *   B  gravel paths / worn earth
 *   A  asphalt / paved (roads, stand pads)
 * plus a coarse forest-density texture over the whole 6 km square for the
 * distant terrain.
 */

export interface ParkMasks {
  fine: THREE.DataTexture;
  fineBounds: Bounds;
  /**
   * track-aligned ground detail over the fine bounds (half the fine resolution):
   *   R  mowing stripe (1 = the light band): bands across the track, following every curve
   *   G  verge (mown ground between the circuit and just beyond its barriers)
   *   B  run-off wear: the strip beside the kerbs where cars run wide
   */
  track: THREE.DataTexture;
  coarse: THREE.DataTexture;
  coarseBounds: Bounds;
  /** CPU lookups (0..1) for placement: lawn, gravel, paved */
  lawnAt(x: number, z: number): number;
  pathAt(x: number, z: number): number;
  pavedAt(x: number, z: number): number;
  timings: Record<string, number>;
}

export interface TreeShade {
  x: number;
  z: number;
  r: number;
}

const TEXEL = 1.45;

export function buildParkMasks(map: WorldMap, layout: Layout, trees: TreeShade[]): ParkMasks {
  const timings: Record<string, number> = {};
  let tl = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    timings[k] = Math.round(n - tl);
    tl = n;
  };
  const F = map.FINE;
  const W = Math.ceil((F.x1 - F.x0) / TEXEL);
  const H = Math.ceil((F.z1 - F.z0) / TEXEL);
  const sx = W / (F.x1 - F.x0), sz = H / (F.z1 - F.z0);
  const X = (x: number) => (x - F.x0) * sx;
  const Z = (z: number) => (z - F.z0) * sz;

  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    return { c, ctx };
  };
  const A = mk();
  const B = mk();
  const track = map.track;

  // ---------------------------------------------------------------- R: forest floor from the trees (CPU raster)
  const shadeR = new Float32Array(W * H);
  for (const t of trees) {
    if (t.x < F.x0 - 20 || t.x > F.x1 + 20 || t.z < F.z0 - 20 || t.z > F.z1 + 20) continue;
    const rr = t.r * 1.15;
    const cx = X(t.x), cz = Z(t.z);
    const rx = rr * sx, rz = rr * sz;
    const i0 = Math.max(0, Math.floor(cx - rx)), i1 = Math.min(W - 1, Math.ceil(cx + rx));
    const j0 = Math.max(0, Math.floor(cz - rz)), j1 = Math.min(H - 1, Math.ceil(cz + rz));
    for (let j = j0; j <= j1; j++) {
      const dz = (j + 0.5 - cz) / rz;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5 - cx) / rx;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        shadeR[j * W + i] += 0.5 * (1 - d2 * d2);
      }
    }
  }
  lap('shade');
  // ---------------------------------------------------------------- G: mown lawns
  {
    const ctx = A.ctx;
    ctx.fillStyle = 'rgb(0,255,0)';
    // verge strip behind the barriers all round the lap
    ctx.strokeStyle = 'rgb(0,200,0)';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const p = new THREE.Vector3();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let s = 0; s <= track.n; s += 6) {
        track.point(s, side * (track.barrierAt(s, side) + 5), 0, p);
        if (s === 0) ctx.moveTo(X(p.x), Z(p.z));
        else ctx.lineTo(X(p.x), Z(p.z));
      }
      ctx.lineWidth = 12 * sx;
      ctx.stroke();
    }
    // stands' surroundings
    for (const g of layout.grandstands) {
      ctx.save();
      ctx.translate(X(g.center.x), Z(g.center.z));
      ctx.rotate(-Math.atan2(g.facing.x, g.facing.z));
      ctx.fillRect((-g.length / 2 - 18) * sx, (-g.depth / 2 - 26) * sz, (g.length + 36) * sx, (g.depth + 40) * sz);
      ctx.restore();
    }
    // clearings close to the circuit are mown; far ones are meadow
    for (const c of map.clearings) {
      if (map.distToTrack(c.x, c.z) > 260) continue;
      ctx.beginPath();
      ctx.ellipse(X(c.x), Z(c.z), (c.r + c.soft * 0.4) * sx, (c.r + c.soft * 0.4) * sz, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // spectator banks
    for (const b of layout.banks) {
      ctx.beginPath();
      for (let s = b.sA; s <= b.sB; s += 5) {
        track.point(s, (b.latA + b.latB) / 2, 0, p);
        if (s === b.sA) ctx.moveTo(X(p.x), Z(p.z));
        else ctx.lineTo(X(p.x), Z(p.z));
      }
      ctx.lineWidth = Math.abs(b.latB - b.latA) * sx + 8;
      ctx.strokeStyle = 'rgb(0,255,0)';
      ctx.stroke();
    }
  }

  lap('lawn');
  // ---------------------------------------------------------------- B: gravel paths / A: asphalt
  {
    for (const path of map.paths) {
      const ctx = path.kind === 1 ? A.ctx : B.ctx;
      ctx.strokeStyle = path.kind === 1 ? 'rgb(0,0,255)' : 'rgb(255,0,0)';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = path.width * sx;
      ctx.beginPath();
      path.pts.forEach((q, i) => (i === 0 ? ctx.moveTo(X(q.x), Z(q.z)) : ctx.lineTo(X(q.x), Z(q.z))));
      ctx.stroke();
      // worn shoulders
      if (path.kind === 1) {
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = (path.width + 3) * sx;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // stand pads + concourses behind them (paved), screens
    const ctx = B.ctx;
    ctx.fillStyle = 'rgb(255,0,0)';
    for (const g of layout.grandstands) {
      ctx.save();
      ctx.translate(X(g.center.x), Z(g.center.z));
      ctx.rotate(-Math.atan2(g.facing.x, g.facing.z));
      ctx.fillRect((-g.length / 2 - 2) * sx, (-g.depth / 2 - 7) * sz, (g.length + 4) * sx, (g.depth + 8) * sz);
      ctx.restore();
    }
    // worn earth in front of spectator banks (where people walk)
    const actx = A.ctx;
    actx.globalAlpha = 0.45;
    actx.strokeStyle = 'rgb(0,0,255)';
    const p = new THREE.Vector3();
    for (const b of layout.banks) {
      actx.beginPath();
      for (let s = b.sA; s <= b.sB; s += 5) {
        track.point(s, b.latA - b.side * 1.5, 0, p);
        if (s === b.sA) actx.moveTo(X(p.x), Z(p.z));
        else actx.lineTo(X(p.x), Z(p.z));
      }
      actx.lineWidth = 4 * sx;
      actx.stroke();
    }
    actx.globalAlpha = 1;
  }

  lap('paths');
  const da = A.ctx.getImageData(0, 0, W, H).data;
  const db = B.ctx.getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H * 4);
  // soften the lawn edges (box blur, radius 3, two passes) — cheaper than canvas filters
  const g = new Float32Array(W * H);
  for (let i = 0, n = W * H; i < n; i++) g[i] = da[i * 4 + 1];
  boxBlur(g, W, H, 3);
  boxBlur(g, W, H, 3);
  for (let i = 0, n = W * H; i < n; i++) {
    data[i * 4] = Math.min(255, shadeR[i] * 255);
    data[i * 4 + 1] = g[i];
    data[i * 4 + 2] = da[i * 4 + 2];
    data[i * 4 + 3] = db[i * 4];
  }
  const fine = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  fine.colorSpace = THREE.NoColorSpace;
  fine.wrapS = fine.wrapT = THREE.ClampToEdgeWrapping;
  fine.magFilter = THREE.LinearFilter;
  fine.minFilter = THREE.LinearMipmapLinearFilter;
  fine.generateMipmaps = true;
  fine.anisotropy = 8;
  fine.needsUpdate = true;

  lap('read');
  const track2 = trackMask(map);
  lap('track');
  // coarse forest density over the square (12 m texels)
  const S = map.SQUARE;
  const CW = 512, CH = 512;
  const cd = new Uint8Array(CW * CH * 4);
  for (let j = 0; j < CH; j++)
    for (let i = 0; i < CW; i++) {
      const x = S.x0 + ((i + 0.5) / CW) * (S.x1 - S.x0);
      const z = S.z0 + ((j + 0.5) / CH) * (S.z1 - S.z0);
      const k = (j * CW + i) * 4;
      cd[k] = Math.round(map.forest(x, z) * 255);
      cd[k + 1] = Math.round((1 - map.outsidePark(x, z)) * 255);
      cd[k + 2] = Math.round(map.urban(x, z) * 255);
      cd[k + 3] = 255;
    }
  const coarse = new THREE.DataTexture(cd, CW, CH, THREE.RGBAFormat, THREE.UnsignedByteType);
  coarse.colorSpace = THREE.NoColorSpace;
  coarse.magFilter = THREE.LinearFilter;
  coarse.minFilter = THREE.LinearMipmapLinearFilter;
  coarse.generateMipmaps = true;
  coarse.needsUpdate = true;

  const sample = (ch: number) => (x: number, z: number) => {
    const i = Math.floor(X(x)), j = Math.floor(Z(z));
    if (i < 0 || j < 0 || i >= W || j >= H) return 0;
    return data[(j * W + i) * 4 + ch] / 255;
  };
  return {
    fine,
    fineBounds: { ...F },
    track: track2,
    coarse,
    coarseBounds: { ...S },
    timings: (lap('coarse'), timings),
    lawnAt: sample(1),
    pathAt: sample(2),
    pavedAt: sample(3),
  };
}

function boxBlur(a: Float32Array, W: number, H: number, r: number) {
  const tmp = new Float32Array(a.length);
  const win = 2 * r + 1;
  for (let j = 0; j < H; j++) {
    const row = j * W;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += a[row + Math.min(W - 1, Math.max(0, k))];
    for (let i = 0; i < W; i++) {
      tmp[row + i] = acc / win;
      acc += a[row + Math.min(W - 1, i + r + 1)] - a[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < W; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(H - 1, Math.max(0, k)) * W + i];
    for (let j = 0; j < H; j++) {
      a[j * W + i] = acc / win;
      acc += tmp[Math.min(H - 1, j + r + 1) * W + i] - tmp[Math.max(0, j - r) * W + i];
    }
  }
}

/** mowing stripes across the track, the verge and the run-off wear (see ParkMasks.track) */
function trackMask(map: WorldMap): THREE.DataTexture {
  const F = map.FINE;
  const T = TEXEL * 2;
  const W = Math.ceil((F.x1 - F.x0) / T);
  const H = Math.ceil((F.z1 - F.z0) / T);
  const sx = W / (F.x1 - F.x0), sz = H / (F.z1 - F.z0);
  const X = (x: number) => (x - F.x0) * sx;
  const Z = (z: number) => (z - F.z0) * sz;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const track = map.track;
  const n = track.n;
  const p = new THREE.Vector3();
  const reach = (s: number, side: number) => Math.min(track.barrierAt(s, side) + 7, 48);
  const band = (s0: number, s1: number, lat0: (s: number, side: number) => number, lat1: (s: number, side: number) => number, side: number) => {
    ctx.beginPath();
    let first = true;
    for (let s = s0; s <= s1 + 1e-3; s += Math.max(0.5, (s1 - s0) / 6)) {
      track.point(((s % n) + n) % n, side * lat0(s, side), 0, p);
      if (first) ctx.moveTo(X(p.x), Z(p.z));
      else ctx.lineTo(X(p.x), Z(p.z));
      first = false;
    }
    for (let s = s1; s >= s0 - 1e-3; s -= Math.max(0.5, (s1 - s0) / 6)) {
      track.point(((s % n) + n) % n, side * lat1(s, side), 0, p);
      ctx.lineTo(X(p.x), Z(p.z));
    }
    ctx.closePath();
    ctx.fill();
  };
  const edge = (s: number) => track.halfWidth[Math.floor(((s % n) + n) % n)] ?? 6;
  // G: the verge on both sides
  ctx.fillStyle = 'rgb(0,255,0)';
  for (let s = 0; s < n; s += 24) for (const side of [-1, 1]) band(s - 0.5, s + 24.5, (q) => edge(q) - 0.5, reach, side);
  // R: light bands, 9 m long every 18 m, whole width of the verge
  const P = 18;
  ctx.fillStyle = 'rgb(255,0,0)';
  for (let s = 0; s < n; s += P) for (const side of [-1, 1]) band(s, s + P / 2, (q) => edge(q) - 0.5, reach, side);
  // B: run-off wear beside the kerbs (strongest right at the edge)
  for (const [w, a] of [[3, 0.45], [6, 0.3], [9, 0.25]] as [number, number][]) {
    ctx.fillStyle = `rgba(0,0,255,${a})`;
    for (let s = 0; s < n; s += 24) for (const side of [-1, 1]) band(s - 0.5, s + 24.5, (q) => edge(q) - 0.5, (q) => edge(q) + w, side);
  }
  const d = ctx.getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H * 4);
  for (let i = 0, N = W * H; i < N; i++) {
    data[i * 4] = d[i * 4];
    data[i * 4 + 1] = d[i * 4 + 1];
    data[i * 4 + 2] = d[i * 4 + 2];
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
