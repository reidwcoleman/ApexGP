/**
 * Where the mower can go: the lawn's tiles (2 m squares), the things standing on them, and a flood
 * fill of what the mower can actually reach (so every blade the player is asked to cut can be cut).
 * Everything here is in metres, the lawn centred on the origin.
 */

export const TS = 2;

export interface Circle {
  t: 0;
  x: number;
  z: number;
  r: number;
}
export interface Box {
  t: 1;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
export type Shape = Circle | Box;

export interface Hit {
  nx: number;
  nz: number;
  depth: number;
}

/** Widest body the game ever drives; reach is judged with it so no mower is promised a blade it can't get. */
export const REACH_BODY = 0.66;
/** Narrowest deck half-width: a cell within this of a reachable spot is a cell every mower can cut. */
export const REACH_DECK = 0.28;
export const COARSE = 0.25;

export function shapeGap(a: Shape, b: Shape): number {
  if (a.t === 0 && b.t === 0) return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  if (a.t === 0 && b.t === 1) return circleBox(a, b);
  if (a.t === 1 && b.t === 0) return circleBox(b, a);
  const bx = a as Box;
  const cx = b as Box;
  const dx = Math.max(0, Math.max(bx.x0 - cx.x1, cx.x0 - bx.x1));
  const dz = Math.max(0, Math.max(bx.z0 - cx.z1, cx.z0 - bx.z1));
  return Math.hypot(dx, dz);
}
function circleBox(c: Circle, b: Box): number {
  const px = Math.max(b.x0, Math.min(c.x, b.x1));
  const pz = Math.max(b.z0, Math.min(c.z, b.z1));
  return Math.hypot(c.x - px, c.z - pz) - c.r;
}

export class Nav {
  readonly shapes: Shape[];
  readonly walls: Box[] = [];
  readonly cw: number;
  readonly ch: number;
  readonly width: number;
  readonly depth: number;
  private reach: Uint8Array = new Uint8Array(0);
  private cover: Uint8Array = new Uint8Array(0);

  constructor(
    readonly tiles: Uint8Array,
    readonly w: number,
    readonly h: number,
    obstacles: Shape[],
  ) {
    this.shapes = obstacles;
    this.width = w * TS;
    this.depth = h * TS;
    // boundary: every void tile (and the ring outside the grid) that touches a playable one is a wall
    for (let j = -1; j <= h; j++) {
      for (let i = -1; i <= w; i++) {
        if (this.tile(i, j)) continue;
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (this.tile(i + di, j + dj)) near = true;
        if (near) {
          const x0 = i * TS - this.width / 2;
          const z0 = j * TS - this.depth / 2;
          this.walls.push({ t: 1, x0, z0, x1: x0 + TS, z1: z0 + TS });
        }
      }
    }
    this.cw = Math.ceil(this.width / COARSE);
    this.ch = Math.ceil(this.depth / COARSE);
  }

  tile(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.tiles[j * this.w + i] === 1;
  }
  /** Is this point over a playable tile? */
  playable(x: number, z: number): boolean {
    return this.tile(Math.floor((x + this.width / 2) / TS), Math.floor((z + this.depth / 2) / TS));
  }

  /** Push a disc of radius R out of everything solid. Returns the deepest push, if any. */
  resolve(p: { x: number; z: number }, R: number): Hit | null {
    let best: Hit | null = null;
    const n = this.shapes.length + this.walls.length;
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (let k = 0; k < n; k++) {
        const s = k < this.shapes.length ? this.shapes[k] : this.walls[k - this.shapes.length];
        let nx = 0;
        let nz = 0;
        let depth = 0;
        if (s.t === 0) {
          const dx = p.x - s.x;
          const dz = p.z - s.z;
          const m = R + s.r;
          if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
          const d = Math.hypot(dx, dz);
          if (d >= m) continue;
          if (d < 1e-6) {
            nx = 1;
          } else {
            nx = dx / d;
            nz = dz / d;
          }
          depth = m - d;
        } else {
          if (p.x < s.x0 - R || p.x > s.x1 + R || p.z < s.z0 - R || p.z > s.z1 + R) continue;
          const cx = Math.max(s.x0, Math.min(p.x, s.x1));
          const cz = Math.max(s.z0, Math.min(p.z, s.z1));
          const dx = p.x - cx;
          const dz = p.z - cz;
          const d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d > 1e-6) {
            nx = dx / d;
            nz = dz / d;
            depth = R - d;
          } else {
            // centre inside the box: leave by the nearest face
            const l = p.x - s.x0;
            const r = s.x1 - p.x;
            const t = p.z - s.z0;
            const b = s.z1 - p.z;
            const m = Math.min(l, r, t, b);
            if (m === l) nx = -1;
            else if (m === r) nx = 1;
            else if (m === t) nz = -1;
            else nz = 1;
            depth = m + R;
          }
        }
        p.x += nx * depth;
        p.z += nz * depth;
        any = true;
        if (!best || depth > best.depth) best = { nx, nz, depth };
      }
      if (!any) break;
    }
    return best;
  }

  /** Is a disc of radius R at (x, z) touching anything? */
  blocked(x: number, z: number, R: number): boolean {
    for (const s of this.shapes) {
      if (s.t === 0) {
        if (Math.hypot(x - s.x, z - s.z) < R + s.r) return true;
      } else {
        const cx = Math.max(s.x0, Math.min(x, s.x1));
        const cz = Math.max(s.z0, Math.min(z, s.z1));
        if (Math.hypot(x - cx, z - cz) < R) return true;
      }
    }
    for (const s of this.walls) {
      if (x < s.x0 - R || x > s.x1 + R || z < s.z0 - R || z > s.z1 + R) continue;
      const cx = Math.max(s.x0, Math.min(x, s.x1));
      const cz = Math.max(s.z0, Math.min(z, s.z1));
      if (Math.hypot(x - cx, z - cz) < R) return true;
    }
    return false;
  }

  /** Flood fill from the start: which coarse cells can the (widest) mower body reach? */
  computeReach(sx: number, sz: number) {
    const { cw, ch } = this;
    const free = new Uint8Array(cw * ch);
    const ox = -this.width / 2;
    const oz = -this.depth / 2;
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const x = ox + (i + 0.5) * COARSE;
        const z = oz + (j + 0.5) * COARSE;
        if (this.playable(x, z) && !this.blocked(x, z, REACH_BODY)) free[j * cw + i] = 1;
      }
    }
    const reach = new Uint8Array(cw * ch);
    const si = Math.floor((sx - ox) / COARSE);
    const sj = Math.floor((sz - oz) / COARSE);
    const stack: number[] = [];
    // the start may sit a hair inside a blocked cell: begin at the nearest free one
    let found = -1;
    for (let r = 0; r < 16 && found < 0; r++) {
      for (let dj = -r; dj <= r && found < 0; dj++) {
        for (let di = -r; di <= r; di++) {
          const i = si + di;
          const j = sj + dj;
          if (i >= 0 && j >= 0 && i < cw && j < ch && free[j * cw + i]) {
            found = j * cw + i;
            break;
          }
        }
      }
    }
    if (found >= 0) {
      stack.push(found);
      reach[found] = 1;
    }
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % cw;
      const j = (k / cw) | 0;
      const nb = [i > 0 ? k - 1 : -1, i < cw - 1 ? k + 1 : -1, j > 0 ? k - cw : -1, j < ch - 1 ? k + cw : -1];
      for (const n of nb) {
        if (n >= 0 && free[n] && !reach[n]) {
          reach[n] = 1;
          stack.push(n);
        }
      }
    }
    this.reach = reach;
    // cover: coarse cells within the narrowest deck of a reachable cell
    const cover = new Uint8Array(cw * ch);
    const rr = Math.ceil(REACH_DECK / COARSE) + 1;
    const lim = REACH_DECK + COARSE * 0.75;
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        let ok = 0;
        for (let dj = -rr; dj <= rr && !ok; dj++) {
          for (let di = -rr; di <= rr; di++) {
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a >= cw || b >= ch || !reach[b * cw + a]) continue;
            if (Math.hypot(di, dj) * COARSE <= lim) {
              ok = 1;
              break;
            }
          }
        }
        cover[j * cw + i] = ok;
      }
    }
    this.cover = cover;
  }

  private coarseIndex(x: number, z: number): number {
    const i = Math.floor((x + this.width / 2) / COARSE);
    const j = Math.floor((z + this.depth / 2) / COARSE);
    if (i < 0 || j < 0 || i >= this.cw || j >= this.ch) return -1;
    return j * this.cw + i;
  }
  reachable(x: number, z: number): boolean {
    const k = this.coarseIndex(x, z);
    return k >= 0 && this.reach[k] === 1;
  }
  /** Can a mower's deck get to this ground? */
  coverable(x: number, z: number): boolean {
    const k = this.coarseIndex(x, z);
    return k >= 0 && this.cover[k] === 1;
  }
  /** Is this point inside an obstacle (grass doesn't grow there)? */
  solidAt(x: number, z: number, pad = 0): boolean {
    for (const s of this.shapes) {
      if (s.t === 0) {
        if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
      } else if (x > s.x0 - pad && x < s.x1 + pad && z > s.z0 - pad && z < s.z1 + pad) return true;
    }
    return false;
  }
}
