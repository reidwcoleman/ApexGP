/**
 * Circuit generator.
 *
 * A circuit is authored the way a track designer talks about it: a list of
 * straights and corners (angle + radius). We turn that into a curvature
 * profile κ(s) sampled every metre, smooth it (three box passes ≈ Gaussian, so
 * every corner gets clothoid-like entry and exit spirals), then integrate
 * heading and position.
 *
 * Closure is exact by construction:
 *  - heading: κ is rescaled so ∑κ·ds = ±2π,
 *  - position: every straight long enough to have a flat middle gets a
 *    weighted least-norm length correction (Lagrange, 2 constraints) so the
 *    lap ends where it started; `flex` says how willing each one is to move.
 *
 * No imports — this file also runs under plain Node (type stripping) for the
 * track-plot tool.
 */

export type RunoffKind = 'grass' | 'gravel' | 'asphalt';

export interface SegDef {
  type: 'straight' | 'corner';
  /** straight length (m). For free straights this is the base length. */
  length?: number;
  free?: boolean;
  /** corner turn in degrees, + = left, − = right */
  angle?: number;
  radius?: number;
  name?: string;
  /** outside-of-corner runoff surface */
  runoff?: RunoffKind;
  /** outside runoff depth before the barrier (m) */
  runoffDepth?: number;
  /** how willing this straight is to change length for closure (default 1, free = 3) */
  flex?: number;
}

export interface CircuitDef {
  id: string;
  name: string;
  country: string;
  segments: SegDef[];
  halfWidth: number;
  /** distance of the start/finish line from the beginning of segment 0 (m) */
  startOffset: number;
  /** [fraction of lap from segment 0 start, height m], periodic */
  elevation: [number, number][];
  /** pit lane side along segment 0: 1 = right, −1 = left */
  pitSide: 1 | -1;
  /** sector boundaries as fractions of the lap measured from the start line */
  sectors: [number, number];
  /** DRS zones: [detection, activation, end] as segment index + fraction within it */
  drs: { detect: [number, number]; start: [number, number]; end: [number, number] }[];
}

export interface CornerInfo {
  name: string;
  /** −1 right, 1 left */
  dir: number;
  radius: number;
  sStart: number;
  sApex: number;
  sEnd: number;
  peak: number;
  runoff: RunoffKind;
  runoffDepth: number;
}

export interface CircuitData {
  def: CircuitDef;
  n: number;
  ds: number;
  length: number;
  x: Float64Array;
  z: Float64Array;
  y: Float64Array;
  heading: Float64Array;
  kappa: Float64Array;
  seg: Int16Array;
  /** start of each segment in s (after closure) */
  segStart: number[];
  segLen: number[];
  corners: CornerInfo[];
}

const DEG = Math.PI / 180;

function boxSmoothCircular(src: Float64Array, radius: number, passes: number): Float64Array {
  const n = src.length;
  let a = Float64Array.from(src);
  let b = new Float64Array(n);
  const w = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += a[(k + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = acc / w;
      acc += a[(i + radius + 1) % n] - a[(i - radius + n) % n];
    }
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

function buildKappa(segs: SegDef[], lengths: number[]) {
  const total = lengths.reduce((s, l) => s + l, 0);
  const k = new Float64Array(total);
  const seg = new Int16Array(total);
  let i = 0;
  segs.forEach((sd, si) => {
    const L = lengths[si];
    const kv = sd.type === 'corner' ? (Math.sign(sd.angle!) / sd.radius!) : 0;
    for (let j = 0; j < L; j++, i++) {
      k[i] = kv;
      seg[i] = si;
    }
  });
  return { k, seg };
}

function segLength(sd: SegDef): number {
  if (sd.type === 'straight') return Math.max(1, Math.round(sd.length ?? 100));
  return Math.max(1, Math.round(Math.abs(sd.angle! * DEG) * sd.radius!));
}

function integrate(k: Float64Array) {
  const n = k.length;
  const heading = new Float64Array(n + 1);
  const x = new Float64Array(n + 1);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const th0 = heading[i];
    const th1 = th0 + k[i];
    heading[i + 1] = th1;
    const tm = (th0 + th1) * 0.5;
    x[i + 1] = x[i] + Math.sin(tm);
    z[i + 1] = z[i] + Math.cos(tm);
  }
  return { heading, x, z };
}

function periodicCatmull(keys: [number, number][], f: number): number {
  const n = keys.length;
  f = ((f % 1) + 1) % 1;
  let i = n - 1;
  for (let j = 0; j < n; j++) {
    if (keys[j][0] > f) {
      i = j - 1;
      break;
    }
  }
  if (i < 0) i = n - 1;
  const k0 = keys[(i - 1 + n) % n];
  const k1 = keys[i];
  const k2 = keys[(i + 1) % n];
  const k3 = keys[(i + 2) % n];
  const unwrap = (a: number, ref: number) => {
    while (a < ref - 0.5) a += 1;
    while (a > ref + 0.5) a -= 1;
    return a;
  };
  const x1 = k1[0];
  let x2 = unwrap(k2[0], x1);
  if (x2 <= x1) x2 += 1;
  let ff = unwrap(f, x1);
  if (ff < x1) ff += 1;
  const t = (ff - x1) / (x2 - x1);
  const p0 = k0[1], p1 = k1[1], p2 = k2[1], p3 = k3[1];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function generateCircuit(def: CircuitDef): CircuitData {
  const SMOOTH_R = 7;
  const PASSES = 3;
  const segs = def.segments;

  // Straights long enough to have a κ=0 middle after smoothing can flex.
  const flex = segs.map((s) => {
    if (s.type !== 'straight') return 0;
    if ((s.length ?? 0) < 60) return 0;
    return s.flex ?? (s.free ? 3 : 1);
  });
  const lens = segs.map(segLength);

  let k: Float64Array = new Float64Array(0);
  let seg = new Int16Array(0);
  let n = 0;
  for (let iter = 0; iter < 8; iter++) {
    const L = lens.map((v) => Math.max(1, Math.round(v)));
    const built = buildKappa(segs, L);
    k = boxSmoothCircular(built.k, SMOOTH_R, PASSES);
    seg = built.seg;
    n = k.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += k[i];
    const scale = (Math.sign(sum) * Math.PI * 2) / sum;
    for (let i = 0; i < n; i++) k[i] *= scale;
    const integ = integrate(k);
    const ex = integ.x[n];
    const ez = integ.z[n];
    if (Math.hypot(ex, ez) < 0.6) break;
    // Weighted least-norm correction: min Σ ΔL²/f  s.t.  Σ ΔL·d = −E
    let acc = 0;
    const cols: { i: number; dx: number; dz: number; f: number }[] = [];
    for (let si = 0; si < segs.length; si++) {
      if (flex[si] > 0) {
        const mid = acc + Math.floor(L[si] / 2);
        const th = integ.heading[mid];
        cols.push({ i: si, dx: Math.sin(th), dz: Math.cos(th), f: flex[si] * Math.max(L[si], 60) });
      }
      acc += L[si];
    }
    let a = 0, b = 0, c = 0;
    for (const col of cols) {
      a += col.f * col.dx * col.dx;
      b += col.f * col.dx * col.dz;
      c += col.f * col.dz * col.dz;
    }
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-9) throw new Error('closure system is singular');
    const lx = (-ex * c - b * -ez) / det;
    const lz = (a * -ez - b * -ex) / det;
    for (const col of cols) {
      lens[col.i] = Math.max(40, lens[col.i] + col.f * (col.dx * lx + col.dz * lz));
    }
  }
  const finalLens = lens.map((v) => Math.max(1, Math.round(v)));
  {
    const built = buildKappa(segs, finalLens);
    k = boxSmoothCircular(built.k, SMOOTH_R, PASSES);
    seg = built.seg;
    n = k.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += k[i];
    const scale = (Math.sign(sum) * Math.PI * 2) / sum;
    for (let i = 0; i < n; i++) k[i] *= scale;
  }

  const fin = integrate(k);
  // Distribute the sub-metre rounding residual linearly.
  const rx = fin.x[n];
  const rz = fin.z[n];
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    x[i] = fin.x[i] - rx * t;
    z[i] = fin.z[i] - rz * t;
    heading[i] = fin.heading[i];
  }

  // Elevation.
  const y = new Float64Array(n);
  const segStart: number[] = [];
  {
    let a = 0;
    for (const L of finalLens) {
      segStart.push(a);
      a += L;
    }
  }
  for (let i = 0; i < n; i++) y[i] = periodicCatmull(def.elevation, i / n);

  // Corners, measured on the smoothed profile.
  const corners: CornerInfo[] = [];
  segs.forEach((sd, si) => {
    if (sd.type !== 'corner') return;
    const s0 = segStart[si];
    const L = finalLens[si];
    const dir = Math.sign(sd.angle!);
    let peak = 0;
    let apex = s0 + L / 2;
    for (let j = s0 - 30; j < s0 + L + 30; j++) {
      const v = k[((j % n) + n) % n] * dir;
      if (v > peak) {
        peak = v;
        apex = j;
      }
    }
    // centre of the plateau rather than its first sample
    let a0 = apex, a1 = apex;
    while (k[((a0 - 1) % n + n) % n] * dir > peak * 0.985 && a0 > apex - L) a0--;
    while (k[((a1 + 1) % n + n) % n] * dir > peak * 0.985 && a1 < apex + L) a1++;
    apex = Math.round((a0 + a1) / 2);
    let st = apex, en = apex;
    while (k[((st - 1) % n + n) % n] * dir > peak * 0.18 && st > s0 - 60) st--;
    while (k[((en + 1) % n + n) % n] * dir > peak * 0.18 && en < s0 + L + 60) en++;
    corners.push({
      name: sd.name ?? `Turn ${corners.length + 1}`,
      dir,
      radius: sd.radius!,
      sStart: (st + n) % n,
      sApex: (apex + n) % n,
      sEnd: (en + n) % n,
      peak,
      runoff: sd.runoff ?? 'grass',
      runoffDepth: sd.runoffDepth ?? (sd.radius! < 60 ? 28 : sd.radius! < 150 ? 34 : 42),
    });
  });

  return { def, n, ds: 1, length: n, x, z, y, heading, kappa: k, seg, segStart, segLen: finalLens, corners };
}
