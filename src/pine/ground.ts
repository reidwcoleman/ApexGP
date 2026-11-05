// The ground is shaded per pixel, once, into a cached layer: snow with real drift shape, wobbled terrain
// edges so nothing reads as a tile, packed-snow roads with ruts, a frozen pond, boulders under snow caps.
import { C, u32, hash, bayer } from './pal';
import { MW, MH, PS, PW, T_ROAD, T_WATER, T_ROCK, T_WILD, T_BRIDGE, type Sim } from './sim.ts';

const NS = 512;
function table(cell: number, seed: number) {
  const t = new Float32Array(NS * NS), n = NS / cell, L = (x: number, y: number) => hash(((x % n) + n) % n, ((y % n) + n) % n, seed), sm = (v: number) => v * v * (3 - 2 * v);
  for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = sm(x / cell - gx), fy = sm(y / cell - gy);
    const a = L(gx, gy), b = L(gx + 1, gy), c = L(gx, gy + 1), d = L(gx + 1, gy + 1);
    t[y * NS + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  return t;
}
const A = table(16, 1), B = table(64, 2), D = table(32, 3), E = table(128, 4);
const n = (t: Float32Array, x: number, y: number) => t[((y & (NS - 1)) * NS) + (x & (NS - 1))];

const SN = [C.sn0, C.sn1, C.sn2, C.sn3, C.sn4].map(u32);
const WILD = ['#dbe6f8', '#c6d6f2', '#b0c3ea', '#98abde', '#8294d2'].map(u32);
const GRASS = ['#a9d17c', '#7fbb68', '#5fa45f', '#478a58'].map(u32), DRY = ['#d8cc84', '#c0b06c', '#a8945c', '#8a7850'].map(u32);
const ROAD = ['#e6dfe6', '#d9d0dc', '#c6bbcc', '#ab9eb4', '#8e80a0'].map(u32);
const ICE = ['#e6f5ff', '#bfe4fb', '#93cdf4', '#6fb2ea', '#5392dc'].map(u32), SEA = ['#a4dcf6', '#5fb4ea', '#3e8ede', '#2f6ccc', '#2650ae'].map(u32);
const ROCK = ['#a8a8c6', '#7f7fa8', '#5c5c88', '#40406a'].map(u32), PLANK = ['#c49060', '#a06c44', '#7c4e34', '#54342a'].map(u32);
const FLOWER = [u32(C.red), u32('#ff7a7a'), u32(C.gold)];

export interface GroundEnv { snow: number; dry: boolean }
export class Ground {
  constructor(private sim: Sim) {}
  private T(x: number, y: number) { const tx = x >> 4, ty = y >> 4; if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return T_WATER; return this.sim.terr[ty * MW + tx]; }
  private own(x: number, y: number) { const tx = x >> 4, ty = y >> 4; if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return 0; return this.sim.s.owned[((ty / PS) | 0) * PW + ((tx / PS) | 0)]; }

  private snow(wx: number, wy: number, ramp: number[]) {
    const h0 = n(B, wx - 3, wy - 3) + n(D, wx - 3, wy - 3) * 0.55 + n(A, wx - 3, wy - 3) * 0.16, h1 = n(B, wx + 3, wy + 3) + n(D, wx + 3, wy + 3) * 0.55 + n(A, wx + 3, wy + 3) * 0.16;
    const v = 0.56 + (h1 - h0) * 3.4 + (bayer(wx, wy) - 0.5) * 0.12;
    const k = v > 0.84 ? 0 : v > 0.42 ? 1 : v > 0.12 ? 2 : 3;
    if (k < 3 && hash(wx, wy, 11) > 0.9972) return ramp[0];
    return ramp[k];
  }

  pixel(wx: number, wy: number, env: GroundEnv) {
    const w1 = n(A, wx, wy) - 0.5, w2 = n(A, wx + 137, wy + 71) - 0.5, sx = (wx + w1 * 7) | 0, sy = (wy + w2 * 7) | 0;
    const t = this.T(sx, sy); let c: number;
    if (t === T_WATER) {
      const frozen = env.snow >= 1, R = frozen ? ICE : SEA, e4 = this.T(sx - 5, sy) !== T_WATER || this.T(sx + 5, sy) !== T_WATER || this.T(sx, sy - 5) !== T_WATER || this.T(sx, sy + 5) !== T_WATER;
      if (e4) { const upper = this.T(sx, sy - 5) !== T_WATER; c = upper ? u32(C.sn5) : R[0]; }
      else {
        const v = n(D, wx, wy) + n(A, wx + 40, wy) * 0.4 + (bayer(wx, wy) - 0.5) * 0.1;
        c = v > 0.98 ? R[1] : v > 0.72 ? R[2] : R[3];
        if (frozen) {
          // skate marks, and snow blown across the ice
          if (n(B, wx, wy + 90) > 0.62 && n(A, wx, wy) > 0.46) c = R[0];
          const q = Math.sin(wx * 0.11 + Math.sin(wy * 0.09) * 3 + wy * 0.05); if (q > 0.985 && hash(wx >> 2, wy >> 2, 3) > 0.35) c = R[0];
          if (hash(wx, wy, 5) > 0.9985) c = u32(C.white);
        } else if ((wy % 7) === 0 && hash(wx >> 3, wy, 7) > 0.84) c = R[1];
      }
    } else if (t === T_BRIDGE) {
      const lx = wx & 31, ly = wy & 31, across = this.T(wx, wy - 40) === T_BRIDGE || this.T(wx, wy + 40) === T_BRIDGE;
      const seam = across ? (wy & 7) === 0 : (wx & 7) === 0, grain = hash(across ? wy >> 3 : wx >> 3, 1, 3);
      c = PLANK[seam ? 3 : grain > 0.6 ? 0 : 1]; if (hash(wx >> 1, wy >> 1, 8) > 0.86) c = PLANK[2];
      if (n(D, wx, wy) > 0.56) c = SN[n(A, wx, wy) > 0.5 ? 1 : 2]; void lx; void ly;
    } else if (t === T_ROAD) {
      const h = this.T(sx - 22, sy) === T_ROAD && this.T(sx + 22, sy) === T_ROAD, v = this.T(sx, sy - 22) === T_ROAD && this.T(sx, sy + 22) === T_ROAD;
      const edgeU = this.T(sx, sy - 4) !== T_ROAD, edgeD = this.T(sx, sy + 4) !== T_ROAD, edgeL = this.T(sx - 4, sy) !== T_ROAD, edgeR = this.T(sx + 4, sy) !== T_ROAD;
      let k = n(D, wx, wy) + (bayer(wx, wy) - 0.5) * 0.18 > 0.56 ? 0 : 1;
      if (hash(wx >> 1, wy >> 1, 4) > 0.93) k = 2;
      const q = h && !v ? (wy + 3) & 31 : v && !h ? (wx + 3) & 31 : -1;
      if (q === 8 || q === 9 || q === 10 || q === 23 || q === 24 || q === 25) k = q === 9 || q === 24 ? 3 : 2;
      c = ROAD[k];
      if (edgeU || edgeL) c = u32(C.sn3); else if (edgeD || edgeR) c = SN[0];
    } else if (t === T_ROCK) {
      const lx = (wx & 15) - 8, ly = (wy & 15) - 9, sq = hash(wx >> 4, wy >> 4), rx = 5.5 + sq * 2.5, ry = 5 + sq * 2;
      const d = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) + (n(A, wx, wy) - 0.5) * 0.4;
      if (d < 1) { const cap = ly < -1.6 + (n(A, wx * 2, wy) - 0.5) * 6 + (lx > 2 ? 1 : 0); c = cap ? (lx > 3 ? SN[2] : d < 0.45 ? SN[0] : SN[1]) : ROCK[lx + ly < -2 ? 0 : lx + ly < 2 ? 1 : d > 0.75 ? 3 : 2]; }
      else if (d < 1.25 && lx + ly > 1) c = SN[3]; else c = this.snow(wx, wy, SN);
    } else {
      c = this.snow(wx, wy, t === T_WILD ? WILD : SN);
      const cover = env.dry ? 0.62 : [0.56, 0.33, 0.12, -1][env.snow], p = n(E, wx, wy) * 0.7 + n(D, wx, wy) * 0.3;
      if (p < cover && t !== T_WILD) {
        const R = env.dry ? DRY : GRASS, r = hash(wx >> 1, (wy + (wx >> 2)) >> 2, 1);
        c = p > cover - 0.012 ? u32(C.sn3) : R[r > 0.8 ? 0 : r > 0.42 ? 1 : r > 0.12 ? 2 : 3];
        const f = hash(wx >> 3, wy >> 3, 9);
        if (f > 0.975 && p < cover - 0.03) { const lx = (wx & 7) - 3, ly = (wy & 7) - 3; if (Math.abs(lx) + Math.abs(ly) < 2) c = lx === 0 && ly === 0 ? FLOWER[2] : FLOWER[f > 0.99 ? 1 : 0]; }
      } else if (p < cover + 0.018 && t !== T_WILD) c = u32(C.sn3);
    }
    if (!this.own(wx, wy) && t !== T_WATER) { const r = (c & 255) * 0.78, g = ((c >> 8) & 255) * 0.8, b = ((c >> 16) & 255) * 0.92; c = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0; }
    return c;
  }

  /** paints tiles [tx0,tx1) x [ty0,ty1) of a chunk at zoom z; dx,dy is the chunk's world tile origin */
  paint(g: CanvasRenderingContext2D, ox: number, oy: number, tx0: number, ty0: number, tx1: number, ty1: number, z: number, env: GroundEnv) {
    const w = (tx1 - tx0) * z, h = (ty1 - ty0) * z, im = g.createImageData(w, h), d = new Uint32Array(im.data.buffer), st = 16 / z;
    for (let y = 0; y < h; y++) { const wy = ((oy + ty0) * 16 + y * st) | 0; for (let x = 0; x < w; x++) d[y * w + x] = this.pixel(((ox + tx0) * 16 + x * st) | 0, wy, env); }
    g.putImageData(im, tx0 * z, ty0 * z);
  }
}
