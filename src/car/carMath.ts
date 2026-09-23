import * as THREE from 'three';

/**
 * Small math + mesh-building toolkit for the procedural car.
 * Everything here is allocation-light and deterministic so the geometry
 * can be built once per detail level and shared by every car on the grid.
 */

export type V2 = [number, number];
export type V3 = [number, number, number];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp2 = (a: V2, b: V2, t: number): V2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a: V3): V3 => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Monotone cubic (Fritsch–Carlson) interpolant through (xs[i], ys[i]); xs ascending. */
export function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    i = lo;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

/**
 * Smooth open 2D curve through control points using local Hermite segments.
 * Tangent direction at P_k = P_{k+1} - P_{k-1}; magnitude = the segment's own chord × tension[k]
 * (tension 0 → a crisp corner). `before`/`after` are phantom neighbours of the end points.
 */
export function hermiteSeg(P: V2[], k: number, t: number, tension: number[], before: V2, after: V2): V2 {
  const p0 = P[k];
  const p1 = P[k + 1];
  const pm = k > 0 ? P[k - 1] : before;
  const pp = k + 2 < P.length ? P[k + 2] : after;
  const cx = p1[0] - p0[0];
  const cy = p1[1] - p0[1];
  const chord = Math.hypot(cx, cy);
  let d0x = p1[0] - pm[0];
  let d0y = p1[1] - pm[1];
  let l = Math.hypot(d0x, d0y) || 1;
  d0x /= l;
  d0y /= l;
  let d1x = pp[0] - p0[0];
  let d1y = pp[1] - p0[1];
  l = Math.hypot(d1x, d1y) || 1;
  d1x /= l;
  d1y /= l;
  const m0 = chord * (tension[k] ?? 1);
  const m1 = chord * (tension[k + 1] ?? 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [h00 * p0[0] + h10 * m0 * d0x + h01 * p1[0] + h11 * m1 * d1x, h00 * p0[1] + h10 * m0 * d0y + h01 * p1[1] + h11 * m1 * d1y];
}

/** Catmull-Rom through 3D points (uniform), used for tube paths. */
export function crPath(pts: V3[], samples: number): V3[] {
  const out: V3[] = [];
  const n = pts.length;
  for (let i = 0; i < samples; i++) {
    const f = (i / (samples - 1)) * (n - 1);
    const k = Math.min(n - 2, Math.floor(f));
    const t = f - k;
    const p0 = pts[Math.max(0, k - 1)];
    const p1 = pts[k];
    const p2 = pts[k + 1];
    const p3 = pts[Math.min(n - 1, k + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), c(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}

export interface UVFn {
  (i: number, j: number): V2;
}

/**
 * Accumulating mesh builder. Everything is indexed; attributes: position, normal, uv
 * and optionally `cuv` (metric carbon-weave coordinates, used by the paint shader).
 */
export class MB {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  cuv: number[] = [];
  idx: number[] = [];
  constructor(readonly withCuv = false) {}

  get count() {
    return this.pos.length / 3;
  }

  vert(p: V3, n: V3, uv: V2, cuv: V2 = [0, 0]) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    if (this.withCuv) this.cuv.push(cuv[0], cuv[1]);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /**
   * Grid of rows × cols points. Faces wind so that the normal = (P[i+1][j]-P[i][j]) × (P[i][j+1]-P[i][j])
   * (flip reverses). Normals are area-weighted face normals (wrapping honoured) with a robust fallback.
   */
  grid(
    P: V3[][],
    uvf: UVFn,
    opts: { flip?: boolean; wrapCols?: boolean; wrapRows?: boolean; cuvf?: UVFn; normals?: V3[][]; orient?: boolean } = {},
  ) {
    const rows = P.length;
    const cols = P[0].length;
    const base = this.count;
    let flip = !!opts.flip;
    let N: V3[][] = opts.normals ?? gridNormals(P, !!opts.wrapCols, !!opts.wrapRows, flip);
    if (opts.orient && !opts.normals) {
      // outward test against each row's centroid
      let score = 0;
      for (let i = 0; i < rows; i++) {
        const c: V3 = [0, 0, 0];
        for (let j = 0; j < cols; j++) {
          c[0] += P[i][j][0] / cols;
          c[1] += P[i][j][1] / cols;
          c[2] += P[i][j][2] / cols;
        }
        for (let j = 0; j < cols; j++) score += dot3(N[i][j], sub3(P[i][j], c));
      }
      if (score < 0) {
        flip = !flip;
        N = gridNormals(P, !!opts.wrapCols, !!opts.wrapRows, flip);
      }
    }
    opts = { ...opts, flip };
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) this.vert(P[i][j], N[i][j], uvf(i, j), opts.cuvf ? opts.cuvf(i, j) : [0, 0]);
    const cmax = opts.wrapCols ? cols : cols - 1;
    const rmax = opts.wrapRows ? rows : rows - 1;
    for (let i = 0; i < rmax; i++) {
      const i1 = (i + 1) % rows;
      for (let j = 0; j < cmax; j++) {
        const j1 = (j + 1) % cols;
        const a = base + i * cols + j;
        const b = base + i1 * cols + j;
        const c = base + i1 * cols + j1;
        const d = base + i * cols + j1;
        if (opts.flip) {
          this.tri(a, d, b);
          this.tri(b, d, c);
        } else {
          this.tri(a, b, d);
          this.tri(b, c, d);
        }
      }
    }
    return base;
  }

  /** Flat-shaded fan cap over a closed ring (centroid fan); winding auto-matches `normal`. */
  cap(ring: V3[], normal: V3, uv: V2 | ((p: V3) => V2), _flip = false, cuv?: (p: V3) => V2) {
    // Newell normal of the ring decides the winding
    const nw: V3 = [0, 0, 0];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      nw[0] += (a[1] - b[1]) * (a[2] + b[2]);
      nw[1] += (a[2] - b[2]) * (a[0] + b[0]);
      nw[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const flip = dot3(nw, normal) < 0;
    const c: V3 = [0, 0, 0];
    for (const p of ring) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    c[0] /= ring.length;
    c[1] /= ring.length;
    c[2] /= ring.length;
    const uvOf = (p: V3): V2 => (typeof uv === 'function' ? uv(p) : uv);
    const ci = this.vert(c, normal, uvOf(c), cuv ? cuv(c) : [0, 0]);
    const first = this.count;
    for (const p of ring) this.vert(p, normal, uvOf(p), cuv ? cuv(p) : [0, 0]);
    for (let k = 0; k < ring.length; k++) {
      const a = first + k;
      const b = first + ((k + 1) % ring.length);
      if (flip) this.tri(ci, b, a);
      else this.tri(ci, a, b);
    }
  }

  /** Append a three.js geometry (converted to indexed), optional transform and uv override. */
  addGeometry(g: THREE.BufferGeometry, m?: THREE.Matrix4, uv?: V2 | ((p: V3, n: V3, uv: V2) => V2), cuv?: (p: V3) => V2) {
    const geo = g.index ? g : g;
    const pa = geo.getAttribute('position');
    const na = geo.getAttribute('normal');
    const ua = geo.getAttribute('uv');
    const base = this.count;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      n.fromBufferAttribute(na, i);
      if (m) {
        v.applyMatrix4(m);
        n.applyMatrix3(nm!).normalize();
      }
      const p: V3 = [v.x, v.y, v.z];
      const nn: V3 = [n.x, n.y, n.z];
      const u0: V2 = ua ? [ua.getX(i), ua.getY(i)] : [0, 0];
      const uu: V2 = uv === undefined ? u0 : typeof uv === 'function' ? uv(p, nn, u0) : uv;
      this.vert(p, nn, uu, cuv ? cuv(p) : [0, 0]);
    }
    if (geo.index) {
      const ia = geo.index;
      for (let i = 0; i < ia.count; i++) this.idx.push(base + ia.getX(i));
    } else {
      for (let i = 0; i < pa.count; i++) this.idx.push(base + i);
    }
    // mirrored transforms flip winding
    if (m && m.determinant() < 0) {
      for (let i = this.idx.length - (geo.index ? geo.index.count : pa.count); i < this.idx.length; i += 3) {
        const t = this.idx[i + 1];
        this.idx[i + 1] = this.idx[i + 2];
        this.idx[i + 2] = t;
      }
    }
    return base;
  }

  /** Transform vertices [from, count) in place. */
  transform(from: number, m: THREE.Matrix4) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    for (let i = from; i < this.count; i++) {
      v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(m);
      this.pos[i * 3] = v.x;
      this.pos[i * 3 + 1] = v.y;
      this.pos[i * 3 + 2] = v.z;
      v.set(this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
      this.nor[i * 3] = v.x;
      this.nor[i * 3 + 1] = v.y;
      this.nor[i * 3 + 2] = v.z;
    }
  }

  /** Copy vertices/indices [fromVert..] mirrored in X (x → −x), fixing winding. uvMap may remap uvs of the copy. */
  mirrorX(fromVert: number, fromIdx: number, uvMap?: (uv: V2, p: V3) => V2) {
    const nv = this.count;
    const base = this.count;
    for (let i = fromVert; i < nv; i++) {
      const p: V3 = [-this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
      const n: V3 = [-this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]];
      const uv: V2 = [this.uv[i * 2], this.uv[i * 2 + 1]];
      const cuv: V2 = this.withCuv ? [this.cuv[i * 2], this.cuv[i * 2 + 1]] : [0, 0];
      this.vert(p, n, uvMap ? uvMap(uv, p) : uv, cuv);
    }
    const ni = this.idx.length;
    for (let i = fromIdx; i < ni; i += 3) {
      const a = this.idx[i] - fromVert + base;
      const b = this.idx[i + 1] - fromVert + base;
      const c = this.idx[i + 2] - fromVert + base;
      this.idx.push(a, c, b);
    }
  }

  get triangles() {
    return this.idx.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withCuv) g.setAttribute('cuv', new THREE.Float32BufferAttribute(this.cuv, 2));
    const n = this.count;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Area-weighted normals of a quad grid (same winding convention as MB.grid). */
export function gridNormals(P: V3[][], wrapCols: boolean, wrapRows: boolean, flip: boolean): V3[][] {
  const rows = P.length;
  const cols = P[0].length;
  const N: V3[][] = [];
  for (let i = 0; i < rows; i++) {
    N.push([]);
    for (let j = 0; j < cols; j++) N[i].push([0, 0, 0]);
  }
  const acc = (i: number, j: number, n: V3) => {
    const t = N[i][j];
    t[0] += n[0];
    t[1] += n[1];
    t[2] += n[2];
  };
  const cmax = wrapCols ? cols : cols - 1;
  const rmax = wrapRows ? rows : rows - 1;
  for (let i = 0; i < rmax; i++) {
    const i1 = (i + 1) % rows;
    for (let j = 0; j < cmax; j++) {
      const j1 = (j + 1) % cols;
      const a = P[i][j];
      const b = P[i1][j];
      const c = P[i1][j1];
      const d = P[i][j1];
      // two triangles (a,b,d) (b,c,d)
      let n1 = cross3(sub3(b, a), sub3(d, a));
      let n2 = cross3(sub3(c, b), sub3(d, b));
      if (flip) {
        n1 = scl3(n1, -1);
        n2 = scl3(n2, -1);
      }
      acc(i, j, n1);
      acc(i1, j, n1);
      acc(i, j1, n1);
      acc(i1, j, n2);
      acc(i1, j1, n2);
      acc(i, j1, n2);
    }
  }
  // normalise with fallback to neighbours for degenerate spots
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const n = N[i][j];
      const l = len3(n);
      if (l > 1e-12) N[i][j] = [n[0] / l, n[1] / l, n[2] / l];
      else N[i][j] = [0, 0, 0];
    }
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        if (len3(N[i][j]) > 0.5) continue;
        let s: V3 = [0, 0, 0];
        for (const [di, dj] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= rows || jj >= cols) continue;
          s = add3(s, N[ii][jj]);
        }
        if (len3(s) > 1e-6) N[i][j] = norm3(s);
      }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (len3(N[i][j]) < 0.5) N[i][j] = [0, 1, 0];
  return N;
}

/** NACA-4-like airfoil (inverted camber for downforce), closed TE. Returns points (x along chord 0..1 from LE, y). */
export function airfoil(n: number, thick: number, camber: number, camberPos = 0.45): V2[] {
  // walk: TE upper → LE → TE lower (n points per surface, cosine spaced)
  const pts: V2[] = [];
  const surf = (x: number, upper: boolean): V2 => {
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const p = camberPos;
    const yc = x < p ? (camber / (p * p)) * (2 * p * x - x * x) : (camber / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x);
    // inverted camber: suction side is below
    return [x, -yc + (upper ? yt : -yt)];
  };
  for (let i = 0; i < n; i++) {
    const b = (i / (n - 1)) * Math.PI;
    const x = 0.5 * (1 + Math.cos(b)); // 1 → 0
    pts.push(surf(x, true));
  }
  for (let i = 1; i < n - 1; i++) {
    const b = (i / (n - 1)) * Math.PI;
    const x = 0.5 * (1 - Math.cos(b)); // 0 → 1
    pts.push(surf(x, false));
  }
  return pts;
}
