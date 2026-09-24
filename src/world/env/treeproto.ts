import * as THREE from 'three';
import { perlin2, rng, tileFbm } from './noise.ts';
import { finish, heightToNormal } from './textures.ts';

/**
 * Parco di Monza tree species, built from code:
 *   plane      Platanus × hispanica — tall clear bole, mottled cream/olive bark, broad crown
 *   oak        Quercus robur — short bole, wide irregular crown, dark furrowed bark
 *   chestnut   Aesculus hippocastanum — dense dark dome (a little leaf-miner browning in September)
 *   poplar     Populus nigra 'Italica' — the Lombardy poplar, a narrow column
 *   shrub      hazel / bramble understorey at the woodland edge
 *
 * Each prototype = a branch skeleton (tapered tubes: trunk, scaffold limbs,
 * branches) + clumped leaf-cluster cards around branch ends. Cards carry
 * "volume" normals (mix of crown-sphere and clump normals) so a crown shades
 * like a lumpy mass with lit tops and dark undersides, plus an AO term for
 * depth inside the crown. Two LODs share one skeleton: LOD1 drops the small
 * branches and keeps half the cards, enlarged.
 *
 * Vertex layout (shared by every prototype so they batch together):
 *   position, normal, uv, color (linear tint),
 *   aTree = (wind weight, kind, ao, phase) with kind 1 = leaf, 0 = bark, −1 = mottled plane bark.
 */

export type SpeciesId = 'plane' | 'oak' | 'chestnut' | 'poplar' | 'shrub';

export interface TreeProto {
  index: number;
  species: SpeciesId;
  variant: number;
  lods: THREE.BufferGeometry[];
  height: number;
  /** max horizontal extent from the trunk */
  radius: number;
  crownR: number;
  crownY: number;
}

export interface TreeKit {
  protos: TreeProto[];
  bySpecies: Record<SpeciesId, number[]>;
  leafMap: THREE.DataTexture;
  leafNormal: THREE.DataTexture;
  bark: THREE.DataTexture;
  /** average foliage colour (linear) — used for halos and far colour */
  foliageAvg: THREE.Color;
  timings: Record<string, number>;
}

// ---------------------------------------------------------------- leaf atlas

const CELL = 512;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
/** atlas cell index per species variant (col + row * 4) */
const LEAF_CELLS: Record<SpeciesId, number[]> = { plane: [0, 4], oak: [1, 5], chestnut: [2, 6], poplar: [3], shrub: [7] };

type LeafShape = (ctx: CanvasRenderingContext2D, len: number, r: () => number) => void;

const outline = (ctx: CanvasRenderingContext2D, len: number, hw: (t: number) => number, N = 18) => {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    ctx.lineTo(-hw(t) * len, -t * len);
  }
  for (let i = N - 1; i >= 1; i--) {
    const t = i / N;
    ctx.lineTo(hw(t) * len, -t * len);
  }
  ctx.closePath();
};

const SHAPES: Record<SpeciesId, LeafShape> = {
  plane: (ctx, len) => {
    // palmate, 5 lobes
    const lobes = [
      [-1.4, 0.62], [-0.7, 0.9], [0, 1], [0.7, 0.9], [1.4, 0.62],
    ];
    ctx.beginPath();
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const th = -1.95 + (3.9 * i) / N;
      let rr = 0.55;
      for (const [a, L] of lobes) rr = Math.max(rr, L * (0.62 + 0.38 * Math.exp(-(((th - a) / 0.2) ** 2))));
      const x = Math.sin(th) * rr * len * 0.6, y = -Math.cos(th) * rr * len * 0.6 - len * 0.3;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(0, -len * 0.2);
    ctx.closePath();
  },
  oak: (ctx, len) => outline(ctx, len, (t) => 0.3 * Math.pow(Math.sin(Math.PI * t), 0.65) * (0.7 + 0.42 * Math.abs(Math.sin(t * 4.6 * Math.PI))) * (0.75 + 0.35 * t), 30),
  chestnut: (ctx, len, r) => {
    // palmate compound: 5–7 obovate leaflets from one point
    const n = r() < 0.5 ? 7 : 5;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = ((k / (n - 1)) - 0.5) * 2.5;
      const L = len * (1 - Math.abs(a) * 0.22);
      ctx.save();
      ctx.rotate(a);
      const N = 12;
      ctx.moveTo(0, 0);
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        ctx.lineTo(-0.3 * Math.pow(t, 0.8) * Math.pow(1 - t, 0.4) * L * 1.35, -t * L);
      }
      for (let i = N - 1; i >= 0; i--) {
        const t = i / N;
        ctx.lineTo(0.3 * Math.pow(t, 0.8) * Math.pow(1 - t, 0.4) * L * 1.35, -t * L);
      }
      ctx.restore();
    }
  },
  poplar: (ctx, len) => outline(ctx, len, (t) => 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.5)), 0.9) * Math.pow(1 - t, 0.5), 16),
  shrub: (ctx, len) => outline(ctx, len, (t) => 0.4 * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.25 * t), 16),
};

interface LeafStyle {
  cols: string[];
  len: [number, number];
  count: number;
  twig: string;
  brown?: number;
  yellow?: number;
}

const STYLES: Record<SpeciesId, LeafStyle> = {
  plane: { cols: ['#7c9a3e', '#8eab4a', '#6d8a34', '#9aae52', '#78963c'], len: [36, 50], count: 300, twig: '#6b5a44', yellow: 0.08 },
  oak: { cols: ['#5f7c30', '#6c8a38', '#557230', '#768c3a', '#62803a'], len: [24, 34], count: 420, twig: '#5a4a3a', yellow: 0.03 },
  chestnut: { cols: ['#4f7630', '#5a8236', '#466c2a', '#65893a', '#557c32'], len: [46, 62], count: 150, twig: '#5d4a38', brown: 0.14 },
  poplar: { cols: ['#86a540', '#95b24c', '#779838', '#a2b855', '#8aa846'], len: [20, 28], count: 420, twig: '#6f6555', yellow: 0.08 },
  shrub: { cols: ['#62803a', '#6e8e42', '#577434', '#7a944a'], len: [26, 36], count: 300, twig: '#5a4a38', yellow: 0.05 },
};

function jitterColor(hex: string, r: () => number, amt: number): [number, number, number] {
  const c = new THREE.Color(hex);
  const k = 1 + (r() - 0.5) * amt;
  const h = (r() - 0.5) * 0.06;
  return [Math.min(1, c.r * k * (1 + h)), Math.min(1, c.g * k), Math.min(1, c.b * k * (1 - h))];
}

function drawCluster(ca: CanvasRenderingContext2D, cn: CanvasRenderingContext2D, ox: number, oy: number, sp: SpeciesId, seed: number) {
  const r = rng(seed);
  const st = STYLES[sp];
  const S = CELL;
  // twig skeleton: main stem from the bottom centre up, side twigs
  const twigs: { x0: number; y0: number; x1: number; y1: number; w: number }[] = [];
  const upright = sp === 'poplar';
  const topY = upright ? 0.05 : 0.1;
  const mainBend = (r() - 0.5) * 0.2;
  const mx0 = 0.5, my0 = 0.99, mx1 = 0.5 + mainBend, my1 = topY;
  twigs.push({ x0: mx0, y0: my0, x1: mx1, y1: my1, w: 5 });
  // side twigs fan out to fill the card, each with a couple of sub-twigs
  const nSide = upright ? 9 : 8;
  for (let k = 0; k < nSide; k++) {
    const t = 0.14 + (0.78 * (k + r() * 0.6)) / nSide;
    const bx = mx0 + (mx1 - mx0) * t, by = my0 + (my1 - my0) * t;
    const side = k % 2 ? 1 : -1;
    const ang = (upright ? 0.3 + r() * 0.2 : 0.7 + r() * 0.5) * side;
    const L = (upright ? 0.2 : 0.42) * (1 - t * 0.5) * (0.85 + r() * 0.3);
    const ex = bx + Math.sin(ang) * L, ey = by - Math.cos(ang) * L;
    twigs.push({ x0: bx, y0: by, x1: ex, y1: ey, w: 3 });
    if (!upright)
      for (let q = 0; q < 2; q++) {
        const tt = 0.35 + q * 0.3 + r() * 0.1;
        const sx = bx + (ex - bx) * tt, sy = by + (ey - by) * tt;
        const a2 = ang + (q === 0 ? -0.6 : 0.5) * side + (r() - 0.5) * 0.3;
        const L2 = L * (0.45 + r() * 0.2);
        twigs.push({ x0: sx, y0: sy, x1: Math.min(0.97, Math.max(0.03, sx + Math.sin(a2) * L2)), y1: Math.max(0.03, sy - Math.cos(a2) * L2), w: 2 });
      }
  }
  const px = (u: number) => ox + u * S;
  const py = (v: number) => oy + v * S;
  // leaves: along twigs, both sides, alternating angles
  type Leaf = { x: number; y: number; a: number; len: number; col: [number, number, number]; nx: number; ny: number; fold: number; brown: boolean; fs: number };
  const leaves: Leaf[] = [];
  const perTwig = Math.round(st.count / twigs.length);
  for (const tw of twigs) {
    const dx = tw.x1 - tw.x0, dy = tw.y1 - tw.y0;
    const base = Math.atan2(dx, -dy);
    for (let k = 0; k < perTwig; k++) {
      const t = 0.12 + 0.88 * ((k + r() * 0.8) / perTwig);
      const x = tw.x0 + dx * t, y = tw.y0 + dy * t;
      const side = k % 2 ? 1 : -1;
      const spread = sp === 'poplar' ? 0.5 : 0.9;
      const a = base + side * (0.35 + r() * spread) + (r() - 0.5) * 0.3;
      const len = st.len[0] + r() * (st.len[1] - st.len[0]);
      let hex = st.cols[Math.floor(r() * st.cols.length)];
      const yel = r() < (st.yellow ?? 0);
      if (yel) hex = r() < 0.5 ? '#a39a44' : '#b08d3a';
      const col = jitterColor(hex, r, 0.24);
      // top of the cluster catches more light
      const lift = 1 + (1 - y) * 0.12;
      col[0] *= lift; col[1] *= lift; col[2] *= lift;
      leaves.push({ x, y, a, len, col, nx: (r() - 0.5) * 1.1, ny: (r() - 0.5) * 1.1, fold: 0.25 + r() * 0.35, brown: r() < (st.brown ?? 0), fs: 0.45 + r() * 0.55 });
    }
  }
  // terminal leaves at the twig tips
  for (const tw of twigs) {
    const a = Math.atan2(tw.x1 - tw.x0, -(tw.y1 - tw.y0));
    const len = st.len[1] * (0.9 + r() * 0.2);
    leaves.push({ x: tw.x1, y: tw.y1, a, len, col: jitterColor(st.cols[1], r, 0.2), nx: (r() - 0.5) * 0.6, ny: (r() - 0.5) * 0.6, fold: 0.3, brown: false, fs: 0.8 });
  }
  // shuffle so overlaps look random
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
  }
  // clip to the cell
  for (const c of [ca, cn]) {
    c.save();
    c.beginPath();
    c.rect(ox + 1, oy + 1, S - 2, S - 2);
    c.clip();
  }
  // twigs
  ca.lineCap = 'round';
  cn.lineCap = 'round';
  for (const tw of twigs) {
    ca.strokeStyle = st.twig;
    ca.lineWidth = tw.w;
    ca.beginPath();
    ca.moveTo(px(tw.x0), py(tw.y0));
    ca.lineTo(px(tw.x1), py(tw.y1));
    ca.stroke();
    cn.strokeStyle = 'rgb(128,128,255)';
    cn.lineWidth = tw.w;
    cn.beginPath();
    cn.moveTo(px(tw.x0), py(tw.y0));
    cn.lineTo(px(tw.x1), py(tw.y1));
    cn.stroke();
  }
  const shape = SHAPES[sp];
  const enc = (nx: number, ny: number) => {
    const l = Math.hypot(nx, ny, 1);
    return `rgb(${Math.round((nx / l * 0.5 + 0.5) * 255)},${Math.round((ny / l * 0.5 + 0.5) * 255)},${Math.round((1 / l * 0.5 + 0.5) * 255)})`;
  };
  for (const lf of leaves) {
    const X = px(lf.x), Y = py(lf.y);
    // petiole
    ca.strokeStyle = st.twig;
    ca.lineWidth = 1.5;
    const pl = lf.len * 0.18;
    const ex = X + Math.sin(lf.a) * pl, ey = Y - Math.cos(lf.a) * pl;
    ca.beginPath();
    ca.moveTo(X, Y);
    ca.lineTo(ex, ey);
    ca.stroke();
    // blade — albedo
    ca.save();
    ca.translate(ex, ey);
    ca.rotate(lf.a);
    ca.scale(lf.fs, 1);
    const [cr, cg, cb] = lf.col;
    const grad = ca.createLinearGradient(0, 0, 0, -lf.len);
    const rgb = (k: number) => `rgb(${Math.round(Math.min(1, cr * k) * 255)},${Math.round(Math.min(1, cg * k) * 255)},${Math.round(Math.min(1, cb * k) * 255)})`;
    grad.addColorStop(0, rgb(0.82));
    grad.addColorStop(0.6, rgb(1.0));
    grad.addColorStop(1, rgb(1.08));
    ca.fillStyle = grad;
    shape(ca, lf.len, r);
    ca.fill();
    if (lf.brown) {
      ca.save();
      ca.clip();
      ca.fillStyle = 'rgba(122,86,44,0.7)';
      for (let q = 0; q < 2; q++) {
        ca.beginPath();
        ca.ellipse((r() - 0.5) * lf.len * 0.6, -lf.len * (0.3 + r() * 0.6), lf.len * (0.12 + r() * 0.18), lf.len * (0.1 + r() * 0.12), r() * 3, 0, Math.PI * 2);
        ca.fill();
      }
      ca.restore();
    }
    // midrib
    ca.strokeStyle = `rgba(210,220,150,0.35)`;
    ca.lineWidth = 1;
    ca.beginPath();
    ca.moveTo(0, 0);
    ca.lineTo(0, -lf.len * 0.85);
    ca.stroke();
    ca.restore();
    // blade — normal (two folded halves)
    cn.save();
    cn.translate(ex, ey);
    cn.rotate(lf.a);
    cn.scale(lf.fs, 1);
    const ca2 = Math.cos(lf.a), sa2 = Math.sin(lf.a);
    const half = (sgn: number) => {
      // fold tilts each half about the midrib; rotate the tilt into canvas space
      const lx = lf.nx + sgn * lf.fold, ly = lf.ny;
      const wx = lx * ca2 - ly * sa2, wy = lx * sa2 + ly * ca2;
      return enc(wx, -wy);
    };
    shape(cn, lf.len, r);
    cn.save();
    cn.clip();
    cn.fillStyle = half(-1);
    cn.fillRect(-lf.len, -lf.len * 1.2, lf.len, lf.len * 1.3);
    cn.fillStyle = half(1);
    cn.fillRect(0, -lf.len * 1.2, lf.len, lf.len * 1.3);
    cn.restore();
    cn.restore();
  }
  ca.restore();
  cn.restore();
}

function buildLeafAtlas(): { map: THREE.DataTexture; normal: THREE.DataTexture; avg: THREE.Color } {
  const W = CELL * ATLAS_COLS, H = CELL * ATLAS_ROWS;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c.getContext('2d', { willReadFrequently: true })!;
  };
  const ca = mk();
  const cn = mk();
  const order: SpeciesId[] = ['plane', 'oak', 'chestnut', 'poplar', 'plane', 'oak', 'chestnut', 'shrub'];
  order.forEach((sp, k) => {
    const col = k % ATLAS_COLS, row = Math.floor(k / ATLAS_COLS);
    drawCluster(ca, cn, col * CELL, row * CELL, sp, 1000 + k * 77);
  });
  const a = ca.getImageData(0, 0, W, H).data;
  const nrm = cn.getImageData(0, 0, W, H).data;
  // dilate colour into transparent texels (no dark halos in the mips): per-cell average
  const out = new Uint8Array(W * H * 4);
  const nout = new Uint8Array(W * H * 4);
  let tr = 0, tg = 0, tb = 0, tn = 0;
  for (let k = 0; k < ATLAS_COLS * ATLAS_ROWS; k++) {
    const cx = (k % ATLAS_COLS) * CELL, cy = Math.floor(k / ATLAS_COLS) * CELL;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let j = cy; j < cy + CELL; j += 2)
      for (let i = cx; i < cx + CELL; i += 2) {
        const q = (j * W + i) * 4;
        if (a[q + 3] > 200) { sr += a[q]; sg += a[q + 1]; sb += a[q + 2]; n++; }
      }
    sr /= Math.max(1, n); sg /= Math.max(1, n); sb /= Math.max(1, n);
    tr += sr; tg += sg; tb += sb; tn++;
    for (let j = cy; j < cy + CELL; j++)
      for (let i = cx; i < cx + CELL; i++) {
        const q = (j * W + i) * 4;
        const al = a[q + 3];
        const f = al / 255;
        out[q] = Math.round(a[q] * f + sr * (1 - f));
        out[q + 1] = Math.round(a[q + 1] * f + sg * (1 - f));
        out[q + 2] = Math.round(a[q + 2] * f + sb * (1 - f));
        out[q + 3] = al;
        const fa = nrm[q + 3] / 255;
        nout[q] = Math.round(nrm[q] * fa + 128 * (1 - fa));
        nout[q + 1] = Math.round(nrm[q + 1] * fa + 128 * (1 - fa));
        nout[q + 2] = Math.round(nrm[q + 2] * fa + 255 * (1 - fa));
        nout[q + 3] = 255;
      }
  }
  const map = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  finish(map, 8);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const normal = new THREE.DataTexture(nout, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  finish(normal, 8);
  normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  const avg = new THREE.Color().setRGB(tr / tn / 255, tg / tn / 255, tb / tn / 255, THREE.SRGBColorSpace);
  return { map, normal, avg };
}

/** bark: RGB = normal (x, y, z), A = albedo brightness. Tiles 1.6 m around × 2.4 m along. */
function buildBark(): THREE.DataTexture {
  const N = 256, M = 256;
  const h = new Float32Array(N * M);
  for (let j = 0; j < M; j++)
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / M;
      // vertical furrows with plates between them
      const furrow = 1 - Math.abs(tileFbm(u * 1, v * 0.25, 9, 3, 0.55, 5));
      const plates = tileFbm(u, v, 5, 4, 0.5, 9);
      const fine = perlin2(u * 48, v * 24, 48, 24);
      h[j * N + i] = Math.pow(furrow, 3) * 0.9 + plates * 0.35 + fine * 0.08;
    }
  const d = heightToNormal(h, N, 3.2, M);
  // A = albedo: furrows darker
  for (let k = 0; k < N * M; k++) d[k * 4 + 3] = Math.max(0, Math.min(255, 150 + h[k] * 90));
  const t = new THREE.DataTexture(d, N, M, THREE.RGBAFormat, THREE.UnsignedByteType);
  return finish(t, 8);
}

// ---------------------------------------------------------------- geometry builder

class TB {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  dat: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, vv: number, c: THREE.Color, wind: number, kind: number, ao: number, ph: number) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, vv);
    this.col.push(c.r, c.g, c.b);
    this.dat.push(wind, kind, ao, ph);
    return this.pos.length / 3 - 1;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.dat, 4));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

interface Params {
  H: [number, number];
  bole: [number, number];
  crownR: [number, number];
  /** vertical crown radius factor (× half the crown height) */
  crownRy: number;
  lump: number;
  trunkR: [number, number];
  limbs: [number, number];
  limbElev: [number, number];
  clusters: number;
  cards: number;
  cardSize: [number, number];
  spread: number;
  bark: THREE.Color;
  barkKind: number;
  leafTint: THREE.Color;
  column?: boolean;
}

const P: Record<SpeciesId, Params> = {
  plane: {
    H: [24, 30], bole: [0.3, 0.38], crownR: [7.5, 9.5], crownRy: 1.02, lump: 0.22, trunkR: [0.42, 0.55], limbs: [5, 7], limbElev: [0.75, 1.05],
    clusters: 22, cards: 10, cardSize: [2.3, 2.9], spread: 0.36, bark: new THREE.Color(0xb0a98c), barkKind: -1, leafTint: new THREE.Color(1, 1, 1),
  },
  oak: {
    H: [18, 24], bole: [0.2, 0.27], crownR: [8.5, 10.5], crownRy: 0.98, lump: 0.34, trunkR: [0.48, 0.62], limbs: [5, 7], limbElev: [0.35, 0.7],
    clusters: 22, cards: 10, cardSize: [2.1, 2.7], spread: 0.34, bark: new THREE.Color(0x4f473f), barkKind: 0, leafTint: new THREE.Color(1, 1, 1),
  },
  chestnut: {
    H: [17, 22], bole: [0.16, 0.22], crownR: [6.8, 8.2], crownRy: 1.06, lump: 0.16, trunkR: [0.42, 0.52], limbs: [5, 6], limbElev: [0.6, 0.9],
    clusters: 22, cards: 11, cardSize: [2.2, 2.7], spread: 0.42, bark: new THREE.Color(0x5b534a), barkKind: 0, leafTint: new THREE.Color(1, 1, 1),
  },
  poplar: {
    H: [24, 30], bole: [0.06, 0.1], crownR: [2.6, 3.3], crownRy: 1.0, lump: 0.14, trunkR: [0.36, 0.46], limbs: [12, 16], limbElev: [1.15, 1.35],
    clusters: 20, cards: 8, cardSize: [1.6, 2.0], spread: 0.3, bark: new THREE.Color(0x5d5852), barkKind: 0, leafTint: new THREE.Color(1, 1, 1), column: true,
  },
  shrub: {
    H: [2.6, 3.8], bole: [0.05, 0.1], crownR: [1.9, 2.6], crownRy: 0.95, lump: 0.25, trunkR: [0.05, 0.07], limbs: [4, 5], limbElev: [0.9, 1.2],
    clusters: 6, cards: 7, cardSize: [1.2, 1.6], spread: 0.45, bark: new THREE.Color(0x4d4236), barkKind: 0, leafTint: new THREE.Color(1, 1, 1),
  },
};

interface Tube {
  pts: [number, number, number, number][];
  sides: number;
  level: number;
  phase: number;
}
interface Card {
  c: THREE.Vector3;
  o: THREE.Vector3;
  n: THREE.Vector3;
  light: THREE.Vector3;
  size: number;
  rot: number;
  ao: number;
  tint: THREE.Color;
  cell: number;
  phase: number;
  keep1: boolean;
}

function makeTree(sp: SpeciesId, variant: number, index: number): TreeProto {
  const p = P[sp];
  const r = rng(9173 + index * 7919 + variant * 131);
  const R = (a: [number, number]) => a[0] + r() * (a[1] - a[0]);
  const H = R(p.H);
  const boleY = H * R(p.bole);
  const crownR = R(p.crownR);
  const crownH = H - boleY;
  const cy = boleY + crownH * (p.column ? 0.5 : 0.5);
  const ry = (crownH / 2) * p.crownRy;
  const rx = crownR * (0.92 + r() * 0.16), rz = crownR * (0.92 + r() * 0.16);
  const lumpSeed = r() * 100;
  const center = new THREE.Vector3(0, cy, 0);
  // crown envelope radius in a direction
  const env = (d: THREE.Vector3) => {
    let ex = rx, ey = ry, ez = rz;
    if (p.column) {
      // spindle: widest at 35 % height, tapering to a point
      const t = (d.y + 1) / 2;
      const w = Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)), 0.8);
      ex *= 0.35 + 0.75 * w;
      ez *= 0.35 + 0.75 * w;
    } else if (d.y < 0) ey *= 0.78;
    const k = 1 / Math.sqrt((d.x / ex) ** 2 + (d.y / ey) ** 2 + (d.z / ez) ** 2);
    const n = Math.sin(d.x * 3.1 + lumpSeed) * Math.sin(d.y * 2.7 - lumpSeed * 0.7) + Math.sin(d.z * 3.7 + d.x * 1.3 + lumpSeed * 1.3) * 0.6;
    return k * (1 + p.lump * n * 0.6);
  };
  const lean = new THREE.Vector3((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);

  const tubes: Tube[] = [];
  // trunk (leader up into the crown)
  const trunkR = R(p.trunkR);
  const topY = p.column ? H * 0.94 : cy + ry * 0.25;
  {
    const pts: [number, number, number, number][] = [];
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = -0.3 + t * (topY + 0.3);
      const flare = i === 0 ? 1.45 : i === 1 ? 1.12 : 1;
      const wob = Math.sin(t * 5 + lumpSeed) * 0.12 * t;
      pts.push([lean.x * y + wob, y, lean.z * y + wob * 0.5, trunkR * flare * (1 - t * (p.column ? 0.85 : 0.62))]);
    }
    tubes.push({ pts, sides: 9, level: 0, phase: 0 });
  }
  const trunkAt = (y: number) => new THREE.Vector3(lean.x * y, y, lean.z * y);

  // cluster centres on the crown shell
  const K = p.clusters;
  const clusters: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < K; k++) {
    const yy = 1 - (2 * (k + 0.5)) / K;
    if (!p.column && yy < -0.62) continue;
    const rr = Math.sqrt(1 - yy * yy);
    const th = k * ga + r() * 0.5;
    const d = new THREE.Vector3(Math.cos(th) * rr, yy, Math.sin(th) * rr).normalize();
    d.x += (r() - 0.5) * 0.25;
    d.z += (r() - 0.5) * 0.25;
    d.normalize();
    clusters.push(center.clone().addScaledVector(d, env(d) * (0.64 + r() * 0.14)));
  }

  // limbs from the trunk; each cluster is fed by a branch off the nearest limb
  const nL = Math.round(R(p.limbs));
  const limbs: { a: THREE.Vector3; b: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  for (let k = 0; k < nL; k++) {
    const az = k * 2.39996 + r() * 0.5;
    const y0 = p.column ? boleY + ((k + r()) / nL) * (H * 0.82 - boleY) : boleY + (r() * 0.45 + 0.05 * k / nL) * (cy - boleY);
    const el = R(p.limbElev);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    const a = trunkAt(y0);
    const Lr = (p.column ? 0.9 : 0.62) * env(dir.clone());
    const b = a.clone().addScaledVector(dir, Lr);
    // keep limb ends inside the crown
    const rel = b.clone().sub(center);
    const e = env(rel.clone().normalize());
    if (rel.length() > e * 0.8) b.copy(center).addScaledVector(rel.normalize(), e * 0.8);
    limbs.push({ a, b, dir });
    const m = a.clone().lerp(b, 0.5).add(new THREE.Vector3((r() - 0.5) * 0.8, 0.4 + r() * 0.4, (r() - 0.5) * 0.8));
    const r0 = trunkR * (p.column ? 0.22 : 0.48) * (0.8 + r() * 0.3);
    tubes.push({ pts: [[a.x, a.y, a.z, r0], [m.x, m.y, m.z, r0 * 0.7], [b.x, b.y, b.z, r0 * 0.4]], sides: 6, level: 1, phase: r() * 6.28 });
  }
  for (const c of clusters) {
    let best = limbs[0], bd = Infinity;
    for (const l of limbs) {
      const d = l.b.distanceTo(c);
      if (d < bd) { bd = d; best = l; }
    }
    const a = best.a.clone().lerp(best.b, 0.55 + r() * 0.4);
    const end = a.clone().lerp(c, 0.85);
    const m = a.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.3 + r() * 0.5, 0));
    const r0 = trunkR * (p.column ? 0.1 : 0.2) * (0.8 + r() * 0.3);
    tubes.push({ pts: [[a.x, a.y, a.z, r0], [m.x, m.y, m.z, r0 * 0.65], [end.x, end.y, end.z, r0 * 0.3]], sides: 4, level: 2, phase: r() * 6.28 });
  }

  // cards around cluster centres
  const cards: Card[] = [];
  const cells = LEAF_CELLS[sp];
  const up = new THREE.Vector3(0, 1, 0);
  const gauss = () => Math.max(-1.6, Math.min(1.6, (r() + r() + r() - 1.5) * 1.15));
  const avgR = (rx + rz) / 2;
  clusters.forEach((cc, ci) => {
    const clumpR = avgR * p.spread * (0.85 + r() * 0.3);
    const tint = p.leafTint.clone().multiplyScalar(0.9 + r() * 0.2);
    if (r() < 0.12) tint.multiply(new THREE.Color(1.08, 1.04, 0.86));
    const phase = r() * 6.28;
    const cell = cells[Math.floor(r() * cells.length)];
    const nC = Math.round(p.cards * (0.8 + r() * 0.4));
    for (let k = 0; k < nC; k++) {
      const c = cc.clone().add(new THREE.Vector3(gauss() * clumpR, gauss() * clumpR * 0.75, gauss() * clumpR));
      // keep inside the envelope
      const rel = c.clone().sub(center);
      const dl = rel.length();
      const dir = rel.clone().divideScalar(dl || 1);
      const e = env(dir);
      if (dl > e * 0.96) c.copy(center).addScaledVector(dir, e * (0.9 + r() * 0.06));
      const o = c.clone().sub(center).normalize();
      const clumpN = c.clone().sub(cc).normalize();
      const light = o.clone().multiplyScalar(0.55).addScaledVector(clumpN, 0.45).addScaledVector(up, 0.18).normalize();
      const n = o.clone().multiplyScalar(0.55).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.5)).normalize();
      const relD = c.distanceTo(center) / env(o);
      const ao = Math.min(1, (0.3 + 0.7 * Math.max(0, (relD - 0.3) / 0.7)) * (0.72 + 0.28 * (o.y * 0.5 + 0.5)) * (0.8 + 0.2 * Math.max(0, clumpN.y)));
      cards.push({ c, o, n, light, size: R(p.cardSize), rot: (r() - 0.5) * 0.8, ao, tint, cell, phase, keep1: k % 2 === 0 });
    }
  });

  // ------------------------------------------------ emit two LODs
  const bark = p.bark;
  const windAt = (x: number, y: number, z: number) => {
    const h = Math.max(0, (y - boleY * 0.4) / H);
    return Math.min(1.2, h * h * 1.4 + Math.hypot(x, z) / (avgR * 3));
  };
  const lods: THREE.BufferGeometry[] = [];
  for (let lod = 0; lod < 2; lod++) {
    const b = new TB();
    for (const t of tubes) {
      if (lod === 1 && t.level >= 2) continue;
      const sides = lod === 0 ? t.sides : Math.max(3, Math.round(t.sides * 0.55));
      emitTube(b, t, sides, bark, p.barkKind, windAt, (y) => (y < boleY ? 0.85 : 0.55));
    }
    for (const c of cards) {
      if (lod === 1 && !c.keep1) continue;
      const s = c.size * (lod === 1 ? 1.38 : 1);
      emitCard(b, c, s, windAt);
    }
    lods.push(b.geometry());
  }
  let radius = 0;
  const pa = lods[0].attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) radius = Math.max(radius, Math.hypot(pa.getX(i), pa.getZ(i)));
  const bb = lods[0].boundingBox!;
  return { index, species: sp, variant, lods, height: bb.max.y, radius, crownR: avgR, crownY: cy };
}

function emitTube(b: TB, t: Tube, sides: number, bark: THREE.Color, kind: number, windAt: (x: number, y: number, z: number) => number, aoAt: (y: number) => number) {
  const pts = t.pts;
  const rings: number[][] = [];
  const tan = new THREE.Vector3(), ax = new THREE.Vector3(), bx = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(1, 0, 0);
  let vAcc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const pn = pts[Math.min(pts.length - 1, i + 1)];
    const pp = pts[Math.max(0, i - 1)];
    tan.set(pn[0] - pp[0], pn[1] - pp[1], pn[2] - pp[2]).normalize();
    ax.crossVectors(Math.abs(tan.y) > 0.95 ? side : up, tan).normalize();
    bx.crossVectors(tan, ax).normalize();
    if (i > 0) vAcc += Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    const ring: number[] = [];
    const circ = 2 * Math.PI * p[3];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = ax.x * ca + bx.x * sa, ny = ax.y * ca + bx.y * sa, nz = ax.z * ca + bx.z * sa;
      const x = p[0] + nx * p[3], y = p[1] + ny * p[3], z = p[2] + nz * p[3];
      ring.push(b.v(x, y, z, nx, ny, nz, (s / sides) * Math.max(0.25, circ / 1.6), vAcc / 2.4, bark, windAt(x, y, z), kind, aoAt(y), t.phase));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let s = 0; s < sides; s++) {
      const r0 = rings[i], r1 = rings[i + 1];
      b.idx.push(r0[s], r1[s], r0[s + 1], r0[s + 1], r1[s], r1[s + 1]);
    }
}

function emitCard(b: TB, c: Card, s: number, windAt: (x: number, y: number, z: number) => number) {
  // card plane: normal c.n; "up" (towards the twig tips) = outward direction projected
  const n = c.n;
  const upv = c.o.clone().addScaledVector(n, -c.o.dot(n));
  if (upv.lengthSq() < 1e-4) upv.set(0, 1, 0).addScaledVector(n, -n.y);
  upv.normalize();
  const right = new THREE.Vector3().crossVectors(upv, n).normalize();
  // in-plane rotation
  const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
  const U = upv.clone().multiplyScalar(cr).addScaledVector(right, sr);
  const Rv = right.clone().multiplyScalar(cr).addScaledVector(upv, -sr);
  const col = c.cell % ATLAS_COLS, row = Math.floor(c.cell / ATLAS_COLS);
  const u0 = col / ATLAS_COLS, du = 1 / ATLAS_COLS;
  const v0 = row / ATLAS_ROWS, dv = 1 / ATLAS_ROWS;
  const ids: number[] = [];
  for (const [a, bb] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const p = c.c.clone().addScaledVector(Rv, (a - 0.5) * s).addScaledVector(U, (bb - 0.35) * s);
    // canvas y grows downward and the twig base is at the bottom of the cell
    ids.push(b.v(p.x, p.y, p.z, c.light.x, c.light.y, c.light.z, u0 + (a * 0.996 + 0.002) * du, v0 + (1 - bb * 0.996 - 0.002) * dv, c.tint, windAt(p.x, p.y, p.z), 1, c.ao * (bb > 0 ? 1 : 0.88), c.phase));
  }
  b.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
}

// ---------------------------------------------------------------- kit

export const VARIANTS: Record<SpeciesId, number> = { plane: 3, oak: 3, chestnut: 3, poplar: 2, shrub: 2 };

let _kit: TreeKit | null = null;

export function buildTreeKit(): TreeKit {
  if (_kit) return _kit;
  const t0 = performance.now();
  const atlas = buildLeafAtlas();
  const t1 = performance.now();
  const protos: TreeProto[] = [];
  const bySpecies = { plane: [], oak: [], chestnut: [], poplar: [], shrub: [] } as Record<SpeciesId, number[]>;
  for (const sp of ['plane', 'oak', 'chestnut', 'poplar', 'shrub'] as SpeciesId[]) {
    for (let v = 0; v < VARIANTS[sp]; v++) {
      const t = makeTree(sp, v, protos.length);
      bySpecies[sp].push(protos.length);
      protos.push(t);
    }
  }
  const t2 = performance.now();
  const bark = buildBark();
  const t3 = performance.now();
  _kit = { protos, bySpecies, leafMap: atlas.map, leafNormal: atlas.normal, bark, foliageAvg: atlas.avg, timings: { atlas: Math.round(t1 - t0), protos: Math.round(t2 - t1), bark: Math.round(t3 - t2) } };
  return _kit;
}
