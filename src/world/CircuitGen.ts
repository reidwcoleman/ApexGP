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

/** A real circuit: a surveyed centreline plus where its named corners are. */
export interface CenterlineDef {
  /** flat [x0, z0, x1, z1, …] in world metres, in driving order, closed (last joins first) */
  points: number[];
  /** box radius (m) of the curvature smoothing, three passes (default 3) */
  smooth?: number;
}

export interface CornerDef {
  name: string;
  /** approximate apex, in s (metres from the first centreline point) */
  at: number;
  /** −1 right, 1 left */
  dir: 1 | -1;
  runoff?: RunoffKind;
  runoffDepth?: number;
  /** explicit [start, end] in s, for long multi-radius bends the detector would clip */
  span?: [number, number];
  // ---- trackside dressing (all optional: trackside/context.ts derives sensible defaults
  //      from the corner's radius, run-off and the straight before it)
  /** impact layer in front of the barrier on the corner's outside */
  front?: ImpactLayer;
  /** chicane: yellow sausage kerbs behind the inside kerb */
  chicane?: boolean;
  /** braking zone strength 0..1 (baked lock-up streaks) and its length (m) */
  brake?: number;
  brakeLen?: number;
  /** 150/100/50 m braking boards before the corner */
  boards?: boolean;
  /** wide exit kerb with an outer green band */
  wideExit?: boolean;
}

/**
 * Trackside dressing: what the barriers, fences and painted run-off look like.
 * Everything is optional; a circuit with no `trackside` gets armco + debris fence,
 * tyre walls / TecPro on corner outsides and white/blue painted run-off. How to set it:
 *
 *   trackside: {
 *     barrier: 'armco',            // default barrier: 'armco' (parkland) | 'concrete' (street / modern)
 *     fence: 1,                    // default debris fence: 0 none, 1 standard 4 m, 2 tall 6 m
 *     art: 'ads',                  // what concrete walls wear: 'ads' | 'plain' | 'stripes' | 'champions'
 *     runoffPaint: 'bands',        // painted tarmac run-off: 'bands' (white+blue) | 'astroturf' | 'stripes' | 'plain'
 *     kerb: ['#c8261e', '#ecece8'],// kerb block colours
 *     armcoBoards: true,           // sponsor boards bolted to the armco along the straights
 *     runs: [                      // per-segment overrides, applied in order (later wins)
 *       { from: 5670, to: 1140, side: -1, kind: 'concrete', fence: 2 },          // grandstand wall
 *       { from: 3100, to: 3400, kind: 'concrete', art: 'champions', fence: 1 },  // both sides
 *       { from: 1180, to: 1300, side: 1, front: 'tecpro' },
 *     ],
 *     lights: [{ from: 200, to: 900, side: -1, spacing: 45 }],                    // light poles
 *   }
 *
 * `from`/`to` are s in metres (a run may wrap past s = 0: from > to). `side` is
 * −1 left / 1 right of the direction of travel; omit it for both sides. Per-corner
 * extras (front, chicane, boards, wideExit, brake) go on the CornerDef.
 */
export type BarrierKind = 'armco' | 'concrete' | 'none';
export type ImpactLayer = 'none' | 'tyres' | 'tecpro';
export type WallArt = 'ads' | 'plain' | 'stripes' | 'champions';
export type RunoffPaint = 'bands' | 'astroturf' | 'stripes' | 'plain';

export interface BarrierRun {
  from: number;
  to: number;
  side?: 1 | -1;
  kind?: BarrierKind;
  front?: ImpactLayer;
  fence?: 0 | 1 | 2;
  art?: WallArt;
  /** sponsor boards on this stretch of armco */
  boards?: boolean;
}

export interface LightRun {
  from: number;
  to: number;
  side: 1 | -1;
  /** metres between poles (default 50) */
  spacing?: number;
}

export interface TracksideDef {
  barrier?: BarrierKind;
  fence?: 0 | 1 | 2;
  art?: WallArt;
  runoffPaint?: RunoffPaint;
  kerb?: [string, string];
  armcoBoards?: boolean;
  runs?: BarrierRun[];
  lights?: LightRun[];
}

export interface CircuitDef {
  id: string;
  name: string;
  /** short name for menus and radio ("Monza") */
  short: string;
  country: string;
  /** authored layout (fictional circuits) … */
  segments?: SegDef[];
  /** … or a surveyed one (real circuits), with its corners */
  centerline?: CenterlineDef;
  corners?: CornerDef[];
  halfWidth: number;
  /** optional wider stretches (s range, extra half-width in m, eased in/out over ~40 m) */
  widen?: { from: number; to: number; extra: number }[];
  /** s of the start/finish line (m) */
  startOffset: number;
  /** [fraction of lap from s = 0, height m], periodic */
  elevation: [number, number][];
  /** pit lane side of the main straight: 1 = right, −1 = left */
  pitSide: 1 | -1;
  /**
   * pit lane (wall) extent in s; must not wrap past s = 0. Optional, for tight sites: `building`,
   * the pit building's s range (default: ~500 m centred on the lane; the garages sit in it), and
   * `paddock`, how far (|lateral| from the centreline) the paddock behind it reaches (default 125).
   */
  pit: { start: number; end: number; building?: [number, number]; paddock?: number };
  /** sector boundaries as fractions of the lap measured from the start line */
  sectors: [number, number];
  /** DRS zones: detection, activation and end points, in s */
  drs: { detect: number; start: number; end: number }[];
  /**
   * Semi-street circuits (Montréal): walls close to the road. `straight` = barrier distance
   * from the road edge on the straights (default 13, with a ±4 m wobble scaled by `wobble`,
   * default 1), `inside` = on the inside of corners (default 9). Corner run-off still
   * follows each corner's `runoffDepth`.
   */
  walls?: { straight: number; inside?: number; wobble?: number };
  /**
   * Banked corners (Zandvoort): over [start, end] (s, m) the road tilts down toward the
   * inside of the bend by `deg`, easing in and out over `ramp` m (default 40) either side.
   * Used by the road frames (so the mesh, kerbs and barriers), the physics and the AI.
   */
  banking?: { start: number; end: number; deg: number; ramp?: number }[];
  /** barriers, fences, wall art, run-off paint, kerb colours, light poles (see TracksideDef) */
  trackside?: TracksideDef;
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
  if (def.centerline) return fromCenterline(def);
  return fromSegments(def);
}

function fromSegments(def: CircuitDef): CircuitData {
  const SMOOTH_R = 7;
  const PASSES = 3;
  const segs = def.segments!;

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

/**
 * Real circuits: curvature is measured on the surveyed polyline (turn angle at
 * each vertex over the mean of its two chords), resampled every metre,
 * smoothed, rescaled to exactly one clockwise/anticlockwise revolution and
 * integrated again from the first point and heading. That keeps heading, κ
 * and position consistent with each other. The small position residual left
 * by smoothing is spread along the lap, mostly on the straights.
 */
function fromCenterline(def: CircuitDef): CircuitData {
  const P = def.centerline!.points;
  const m = P.length / 2;
  const px = (i: number) => P[((i % m) + m) % m * 2];
  const pz = (i: number) => P[((i % m) + m) % m * 2 + 1];
  const chord = new Float64Array(m);
  const cum = new Float64Array(m + 1);
  const th = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const dx = px(i + 1) - px(i), dz = pz(i + 1) - pz(i);
    chord[i] = Math.hypot(dx, dz);
    cum[i + 1] = cum[i] + chord[i];
    th[i] = Math.atan2(dx, dz);
  }
  const total = cum[m];
  const wrapA = (a: number) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  // curvature at each vertex
  const kv = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const prev = (i - 1 + m) % m;
    kv[i] = wrapA(th[i] - th[prev]) / ((chord[prev] + chord[i]) / 2);
  }
  const n = Math.round(total);
  const scaleS = total / n;
  let raw = new Float64Array(n);
  let v = 0;
  for (let j = 0; j < n; j++) {
    const sj = j * scaleS;
    while (v < m - 1 && cum[v + 1] <= sj) v++;
    const f = (sj - cum[v]) / chord[v];
    raw[j] = kv[v] * (1 - f) + kv[(v + 1) % m] * f;
  }
  const k = boxSmoothCircular(raw, def.centerline!.smooth ?? 3, 3);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += k[i];
  const turns = Math.round(sum / (Math.PI * 2));
  if (turns !== 0) {
    const sc = (turns * Math.PI * 2) / sum;
    for (let i = 0; i < n; i++) k[i] *= sc;
  } else {
    // a figure of eight (Suzuka) turns 0 in total: take the residual out in proportion to |κ|
    let abs = 0;
    for (let i = 0; i < n; i++) abs += Math.abs(k[i]);
    for (let i = 0; i < n; i++) k[i] -= (sum * Math.abs(k[i])) / abs;
  }

  const integ = integrate(k);
  const th0 = th[m - 1] + wrapA(th[0] - th[m - 1]) / 2;
  const c0 = Math.cos(th0), s0 = Math.sin(th0);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const heading = new Float64Array(n);
  // rotate the integrated path onto the survey: local (x, z) with heading 0 = +z
  const rot = (lx: number, lz: number): [number, number] => [lx * c0 + lz * s0, -lx * s0 + lz * c0];
  const [ex, ez] = rot(integ.x[n], integ.z[n]);
  // spread the closure residual, weighted toward straights
  const w = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) w[i + 1] = w[i] + (Math.abs(k[i]) < 1 / 600 ? 1 : 0.08);
  for (let i = 0; i < n; i++) {
    const [lx, lz] = rot(integ.x[i], integ.z[i]);
    const t = w[i] / w[n];
    x[i] = px(0) + lx - ex * t;
    z[i] = pz(0) + lz - ez * t;
    heading[i] = th0 + integ.heading[i];
  }

  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = periodicCatmull(def.elevation, i / n);

  const wrapI = (i: number) => ((i % n) + n) % n;
  const corners: CornerInfo[] = [];
  for (const cd of def.corners ?? []) {
    const at = Math.round(cd.at / scaleS);
    const dir = cd.dir;
    let peak = 0;
    let apex = at;
    for (let j = at - 35; j <= at + 35; j++) {
      const val = k[wrapI(j)] * dir;
      if (val > peak) {
        peak = val;
        apex = j;
      }
    }
    let a0 = apex, a1 = apex;
    while (k[wrapI(a0 - 1)] * dir > peak * 0.985 && a0 > apex - 60) a0--;
    while (k[wrapI(a1 + 1)] * dir > peak * 0.985 && a1 < apex + 60) a1++;
    apex = Math.round((a0 + a1) / 2);
    let st = apex, en = apex;
    while (k[wrapI(st - 1)] * dir > peak * 0.18 && st > apex - 300) st--;
    while (k[wrapI(en + 1)] * dir > peak * 0.18 && en < apex + 400) en++;
    if (cd.span) {
      st = Math.round(cd.span[0] / scaleS);
      en = Math.round(cd.span[1] / scaleS);
    }
    const radius = Math.round(1 / Math.max(peak, 1e-4));
    corners.push({
      name: cd.name,
      dir,
      radius,
      sStart: wrapI(st),
      sApex: wrapI(apex),
      sEnd: wrapI(en),
      peak,
      runoff: cd.runoff ?? 'grass',
      runoffDepth: cd.runoffDepth ?? (radius < 60 ? 28 : radius < 150 ? 34 : 42),
    });
  }

  // Straights and corners as segments, for code that likes to walk the lap that way.
  const label = new Int16Array(n).fill(-1);
  corners.forEach((c, ci) => {
    for (let j = c.sStart, cnt = 0; cnt <= wrapI(c.sEnd - c.sStart); j++, cnt++) label[wrapI(j)] = ci;
  });
  const seg = new Int16Array(n);
  const segStart: number[] = [];
  const segLen: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || label[i] !== label[i - 1]) {
      segStart.push(i);
      segLen.push(0);
    }
    segLen[segLen.length - 1]++;
    seg[i] = segStart.length - 1;
  }

  return { def, n, ds: 1, length: n, x, z, y, heading, kappa: k, seg, segStart, segLen, corners };
}
