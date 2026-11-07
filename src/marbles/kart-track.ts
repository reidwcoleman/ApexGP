import * as THREE from 'three';

/**
 * The kart circuit as maths: a closed ribbon. Control points go through a centripetal Catmull-Rom
 * spline, get resampled every metre and framed (tangent, left, up, with the banking in the frame).
 * Karts drive on this directly, not on triangles: a wheel asks `at` where the surface is under it,
 * and because that search starts from where the kart already was, the road that passes under the
 * bridge and the road over it never get confused. The same samples build the mesh.
 */

/** a control point: where, how wide (half), banked how far (deg; none: from the curve), how far out the walls stand */
export interface TrackPoint {
  x: number;
  z: number;
  y: number;
  hw: number;
  bank?: number;
  /** clear ground beyond the kerb on the left and right */
  l?: number;
  r?: number;
  /** on stilts (the terrain doesn't rise to meet it) */
  up?: boolean;
  tunnel?: boolean;
}

export const Surf = { Road: 0, Kerb: 1, Grass: 2, Gravel: 3 } as const;
/** what each surface does to a tyre: grip, drag on the kart (per metre per second of speed, per unit load), how rough */
export const SURF = [
  { mu: 1, drag: 0, rough: 0.0015 },
  { mu: 0.94, drag: 0, rough: 0.012 },
  { mu: 0.62, drag: 0.026, rough: 0.022 },
  { mu: 0.55, drag: 0.075, rough: 0.03 },
];

export const KERB = 1.15;

/** a boost pad: from `s` for `len` metres, centred `lat` from the middle, `w` either side */
export interface Pad {
  s: number;
  len: number;
  lat: number;
  w: number;
}

/** what `at` answers with */
export interface Probe {
  /** nearest sample, and where along and across */
  i: number;
  s: number;
  lat: number;
  /** height above the road surface, along its normal */
  h: number;
  nx: number;
  ny: number;
  nz: number;
  mat: number;
  /** the walls here, left and right of the middle */
  wl: number;
  wr: number;
  /** across the frame (the wall's direction) */
  lx: number;
  ly: number;
  lz: number;
}
export const probe = (): Probe => ({ i: 0, s: 0, lat: 0, h: 0, nx: 0, ny: 1, nz: 0, mat: 0, wl: 9, wr: 9, lx: 1, ly: 0, lz: 0 });

export class KartTrack {
  /** samples, DS metres apart */
  readonly n: number;
  readonly length: number;
  readonly DS = 1;
  readonly P: Float32Array;
  readonly T: Float32Array;
  readonly L: Float32Array;
  readonly U: Float32Array;
  /** half width of the road, wall distances (left, right), signed curvature (+ left), bank (rad) */
  readonly hw: Float32Array;
  readonly wl: Float32Array;
  readonly wr: Float32Array;
  readonly curve: Float32Array;
  readonly bank: Float32Array;
  /** on stilts, in the tunnel */
  readonly raised: Uint8Array;
  readonly tunnel: Uint8Array;
  /** the fastest line: offset from the middle at each sample (+ left) */
  readonly line: Float32Array;

  constructor(pts: TrackPoint[], origin: THREE.Vector3, readonly pads: Pad[] = []) {
    // ---- the spline: dense, then resampled by arc length
    const m = pts.length;
    const dense: { x: number; y: number; z: number; k: number }[] = [];
    const STEPS = 48;
    const V = (p: TrackPoint) => new THREE.Vector3(p.x, p.y, p.z);
    for (let i = 0; i < m; i++) {
      const p0 = V(pts[(i + m - 1) % m]), p1 = V(pts[i]), p2 = V(pts[(i + 1) % m]), p3 = V(pts[(i + 2) % m]);
      const t1 = Math.sqrt(p0.distanceTo(p1)), t2 = t1 + Math.sqrt(p1.distanceTo(p2)), t3 = t2 + Math.sqrt(p2.distanceTo(p3));
      for (let k = 0; k < STEPS; k++) {
        const t = t1 + ((t2 - t1) * k) / STEPS;
        const mix = (a: THREE.Vector3, b: THREE.Vector3, ta: number, tb: number) => a.clone().multiplyScalar((tb - t) / (tb - ta)).addScaledVector(b, (t - ta) / (tb - ta));
        const A1 = mix(p0, p1, 0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
        const B1 = mix(A1, A2, 0, t2), B2 = mix(A2, A3, t1, t3);
        const C = mix(B1, B2, t1, t2);
        dense.push({ x: C.x, y: C.y, z: C.z, k: i + k / STEPS });
      }
    }
    let total = 0;
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      cum.push(total);
    }
    const n = (this.n = Math.round(total));
    this.length = n;
    const f = (k: number) => new Float32Array(k);
    this.P = f(n * 3);
    this.T = f(n * 3);
    this.L = f(n * 3);
    this.U = f(n * 3);
    this.hw = f(n);
    this.wl = f(n);
    this.wr = f(n);
    this.curve = f(n);
    this.bank = f(n);
    this.raised = new Uint8Array(n);
    this.tunnel = new Uint8Array(n);
    this.line = f(n);
    const key = new Float32Array(n);
    const X = f(n), Y = f(n), Z = f(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const want = (i / n) * total;
      while (cum[j + 1] < want) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length], u = (want - cum[j]) / (cum[j + 1] - cum[j] || 1);
      X[i] = a.x + (b.x - a.x) * u;
      Y[i] = a.y + (b.y - a.y) * u;
      Z[i] = a.z + (b.z - a.z) * u;
      key[i] = a.k + (b.k < a.k ? 0 : (b.k - a.k) * u);
    }
    // ---- smooth: the plan a little, the heights a little more
    const blur = (A: Float32Array, r: number, passes: number) => {
      const B = new Float32Array(n);
      for (let p = 0; p < passes; p++) {
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let d = -r; d <= r; d++) s += A[(i + d + n) % n];
          B[i] = s / (2 * r + 1);
        }
        A.set(B);
      }
    };
    blur(X, 3, 2);
    blur(Z, 3, 2);
    blur(Y, 3, 2);
    // ---- what each sample inherits from the points
    const lerpKey = (i: number, g: (p: TrackPoint) => number) => {
      const k = key[i], a = Math.floor(k) % m, b = (a + 1) % m, u = k - Math.floor(k);
      const e = u * u * (3 - 2 * u);
      return g(pts[a]) * (1 - e) + g(pts[b]) * e;
    };
    const autoBank = new Float32Array(n);
    // curvature in plan
    const W = 4;
    for (let i = 0; i < n; i++) {
      const a = (i - W + n) % n, b = (i + W) % n;
      const h0 = Math.atan2(X[i] - X[a], Z[i] - Z[a]), h1 = Math.atan2(X[b] - X[i], Z[b] - Z[i]);
      let d = h1 - h0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // (heading = atan2(x, z) grows to the left)
      this.curve[i] = d / W;
    }
    blur(this.curve, 3, 2);
    for (let i = 0; i < n; i++) {
      this.hw[i] = lerpKey(i, (p) => p.hw);
      const given = lerpKey(i, (p) => (p.bank === undefined ? NaN : p.bank));
      const g = pts[Math.floor(key[i]) % m].bank !== undefined && pts[(Math.floor(key[i]) + 1) % m].bank !== undefined;
      autoBank[i] = g ? (given * Math.PI) / 180 : THREE.MathUtils.clamp(this.curve[i] * 1.6, -0.12, 0.12);
      const a = pts[Math.floor(key[i]) % m], b = pts[(Math.floor(key[i]) + 1) % m];
      this.raised[i] = a.up && b.up ? 1 : 0;
      this.tunnel[i] = a.tunnel && b.tunnel ? 1 : 0;
      let wl = this.hw[i] + KERB + lerpKey(i, (p) => p.l ?? 7);
      let wr = this.hw[i] + KERB + lerpKey(i, (p) => p.r ?? 7);
      // (the inside of a tight bend can't reach past the bend's own middle)
      const c = this.curve[i];
      if (c > 0.004) wl = Math.min(wl, Math.max(this.hw[i] + KERB + 0.5, 0.82 / c));
      if (c < -0.004) wr = Math.min(wr, Math.max(this.hw[i] + KERB + 0.5, 0.82 / -c));
      this.wl[i] = wl;
      this.wr[i] = wr;
    }
    blur(autoBank, 6, 3);
    blur(this.wl, 4, 2);
    blur(this.wr, 4, 2);
    blur(this.hw, 4, 1);
    // (again after the blur, or a bend's inside wall folds over itself)
    for (let i = 0; i < n; i++) {
      let cl = 0, cr = 0;
      for (let d = -8; d <= 8; d++) {
        const c = this.curve[(i + d + n) % n];
        cl = Math.max(cl, c);
        cr = Math.max(cr, -c);
      }
      const min = this.hw[i] + KERB + 0.4;
      if (cl > 0.004) this.wl[i] = Math.min(this.wl[i], Math.max(min, 0.8 / cl));
      if (cr > 0.004) this.wr[i] = Math.min(this.wr[i], Math.max(min, 0.8 / cr));
    }
    this.bank.set(autoBank);
    // ---- the frames
    const t = new THREE.Vector3(), l = new THREE.Vector3(), u = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      t.set(X[b] - X[a], Y[b] - Y[a], Z[b] - Z[a]).normalize();
      l.crossVectors(up, t).normalize();
      u.crossVectors(t, l).normalize();
      const c = Math.cos(this.bank[i]), s = Math.sin(this.bank[i]);
      // (a left-hander leans left: the left edge goes down)
      const ux = u.x * c + l.x * s, uy = u.y * c + l.y * s, uz = u.z * c + l.z * s;
      const lx = l.x * c - u.x * s, ly = l.y * c - u.y * s, lz = l.z * c - u.z * s;
      const o = i * 3;
      this.P[o] = X[i] + origin.x;
      this.P[o + 1] = Y[i] + origin.y;
      this.P[o + 2] = Z[i] + origin.z;
      this.T[o] = t.x;
      this.T[o + 1] = t.y;
      this.T[o + 2] = t.z;
      this.L[o] = lx;
      this.L[o + 1] = ly;
      this.L[o + 2] = lz;
      this.U[o] = ux;
      this.U[o + 1] = uy;
      this.U[o + 2] = uz;
    }
    this.solveLine();
  }

  /** wrap a sample index */
  idx(i: number) {
    const n = this.n;
    return ((i % n) + n) % n;
  }

  /** a world point on the ribbon */
  point(s: number, lat: number, up: number, out: THREE.Vector3) {
    const n = this.n, f = s - Math.floor(s), a = this.idx(Math.floor(s)) * 3, b = this.idx(Math.floor(s) + 1) * 3;
    const { P, L, U } = this;
    const q = (A: Float32Array, k: number) => A[a + k] + (A[b + k] - A[a + k]) * f;
    void n;
    return out.set(q(P, 0) + q(L, 0) * lat + q(U, 0) * up, q(P, 1) + q(L, 1) * lat + q(U, 1) * up, q(P, 2) + q(L, 2) * lat + q(U, 2) * up);
  }

  /** the heading (atan2(x, z)) along the road at s */
  heading(s: number) {
    const o = this.idx(Math.round(s)) * 3;
    return Math.atan2(this.T[o], this.T[o + 2]);
  }

  /** where a world point is, starting the search from sample `hint` */
  at(x: number, y: number, z: number, hint: number, q: Probe) {
    const { P, T, L, U, n } = this;
    let i = hint, o = i * 3, d = 0;
    for (let k = 0; k < 64; k++) {
      o = i * 3;
      d = (x - P[o]) * T[o] + (y - P[o + 1]) * T[o + 1] + (z - P[o + 2]) * T[o + 2];
      if (d > 0.5) i = i + 1 === n ? 0 : i + 1;
      else if (d < -0.5) i = i === 0 ? n - 1 : i - 1;
      else break;
    }
    const b = (d >= 0 ? (i + 1 === n ? 0 : i + 1) : i === 0 ? n - 1 : i - 1) * 3, f = Math.abs(d);
    // (the frame between this sample and the next, so a bank eases in instead of stepping)
    const lx = L[o] + (L[b] - L[o]) * f, ly = L[o + 1] + (L[b + 1] - L[o + 1]) * f, lz = L[o + 2] + (L[b + 2] - L[o + 2]) * f;
    const ux = U[o] + (U[b] - U[o]) * f, uy = U[o + 1] + (U[b + 1] - U[o + 1]) * f, uz = U[o + 2] + (U[b + 2] - U[o + 2]) * f;
    const px = P[o] + (P[b] - P[o]) * f, py = P[o + 1] + (P[b + 1] - P[o + 1]) * f, pz = P[o + 2] + (P[b + 2] - P[o + 2]) * f;
    const rx = x - px, ry = y - py, rz = z - pz;
    const lat = rx * lx + ry * ly + rz * lz;
    q.i = i;
    q.s = i + d;
    q.lat = lat;
    const a = Math.abs(lat), hw = this.hw[i];
    let lift = 0, mat: number = Surf.Road;
    if (a > hw) {
      if (a < hw + KERB) {
        mat = Surf.Kerb;
        // (a low rumble strip, its ribs a bit under a metre apart)
        const e = (a - hw) / KERB;
        lift = 0.055 * Math.sin(e * Math.PI) * (0.72 + 0.28 * Math.sin((i + d) * 7));
      } else {
        const wall = lat > 0 ? this.wl[i] : this.wr[i];
        mat = wall - a < 3.2 && wall - hw > 7 ? Surf.Gravel : Surf.Grass;
      }
    }
    const rough = SURF[mat].rough;
    if (rough) lift += rough * (Math.sin((i + d) * 2.3 + lat * 1.7) + Math.sin((i + d) * 5.1 - lat * 2.9));
    q.h = rx * ux + ry * uy + rz * uz - lift;
    q.nx = ux;
    q.ny = uy;
    q.nz = uz;
    q.mat = mat;
    q.wl = this.wl[i];
    q.wr = this.wr[i];
    q.lx = lx;
    q.ly = ly;
    q.lz = lz;
    return q;
  }

  /** the line that bends least: an elastic band pulled tight between the kerbs */
  private solveLine() {
    const { n, P, L, hw } = this;
    const o = this.line;
    const lim = (i: number) => hw[i] - 1.25;
    const x = new Float64Array(n), z = new Float64Array(n);
    const lx = new Float64Array(n), lz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const h = Math.hypot(L[i * 3], L[i * 3 + 2]) || 1;
      lx[i] = L[i * 3] / h;
      lz[i] = L[i * 3 + 2] / h;
    }
    const pass = (stride: number, iters: number) => {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          x[i] = P[i * 3] + lx[i] * o[i];
          z[i] = P[i * 3 + 2] + lz[i] * o[i];
        }
        for (let i = 0; i < n; i++) {
          const a = (i - stride + n) % n, b = (i + stride) % n;
          const mx = (x[a] + x[b]) / 2, mz = (z[a] + z[b]) / 2;
          const want = (mx - P[i * 3]) * lx[i] + (mz - P[i * 3 + 2]) * lz[i];
          o[i] += (want - o[i]) * 0.6;
          const m = lim(i);
          if (o[i] > m) o[i] = m;
          else if (o[i] < -m) o[i] = -m;
        }
      }
    };
    pass(40, 60);
    pass(22, 120);
    pass(10, 160);
    // (a little smoothing: the band's corners off)
    const B = new Float32Array(n);
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let d = -4; d <= 4; d++) s += o[(i + d + n) % n];
        B[i] = s / 9;
      }
      o.set(B);
    }
  }

  /**
   * How fast a line can be driven: corner speed from its curvature and the grip, then eased
   * backwards for the braking and forwards for the acceleration. `out` is one speed per sample.
   */
  speeds(line: Float32Array, grip: number, brake: number, accel: number, top: number, out: Float32Array) {
    const { n, P, L, curve } = this;
    const g = 12;
    const W = 5;
    for (let i = 0; i < n; i++) {
      const a = (i - W + n) % n, b = (i + W) % n;
      const ax = P[a * 3] + L[a * 3] * line[a], az = P[a * 3 + 2] + L[a * 3 + 2] * line[a];
      const cx = P[i * 3] + L[i * 3] * line[i], cz = P[i * 3 + 2] + L[i * 3 + 2] * line[i];
      const bx = P[b * 3] + L[b * 3] * line[b], bz = P[b * 3 + 2] + L[b * 3 + 2] * line[b];
      let d = Math.atan2(bx - cx, bz - cz) - Math.atan2(cx - ax, cz - az);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const k = Math.abs(d) / Math.max(1, Math.hypot(bx - cx, bz - cz));
      // (a bank leaning into the bend is worth a lot; one leaning out of it costs)
      const lean = Math.sign(curve[i] || 1) * this.bank[i];
      const gain = (grip + Math.tan(Math.max(-0.3, Math.min(0.6, lean)))) / (1 - grip * Math.tan(Math.max(-0.3, Math.min(0.6, lean))) * 0.5);
      out[i] = Math.min(top, Math.sqrt((gain * g) / Math.max(k, 1e-4)));
    }
    // (twice round each way: a slow bend's braking reaches back past the start line)
    for (let p = 0; p < 2; p++) {
      for (let i = n - 1; i >= 0; i--) {
        const nx = out[(i + 1) % n];
        const v = Math.sqrt(nx * nx + 2 * brake);
        if (v < out[i]) out[i] = v;
      }
      for (let i = 0; i < n; i++) {
        const pv = out[(i + n - 1) % n];
        const a = accel * Math.max(0.15, 1 - pv / top);
        const v = Math.sqrt(pv * pv + 2 * a);
        if (v < out[i]) out[i] = v;
      }
    }
    return out;
  }
}
