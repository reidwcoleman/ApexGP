/**
 * Procedural geometry for the car, built ONCE per detail level and shared by every car
 * (only materials/textures differ per team/driver). Static parts are accumulated per material
 * so each level renders in a handful of draw calls.
 */
import * as THREE from 'three';
import {
  MB, type V2, type V3, add3, sub3, scl3, cross3, norm3, dot3, lerp, lerp3, crPath, airfoil, smooth,
} from './carMath.ts';
import {
  PC, TC, WC, paintCellUV, trimUV, wheelCellUV, rectUV,
  R_FLAP, R_MAIN, R_FWING, R_EP_OL, R_EP_OR, R_EP_IN, R_FIN_L, R_FIN_R,
  R_HELMET, R_NUM_NOSE, R_NUM_FIN_L, R_NUM_FIN_R, R_TCAM_NUM, R_CODE_L, R_CODE_R, DRV_W, DRV_H,
  DC, drvCellUV, R_DISPLAY, R_LEDS, TRIM_W, TRIM_H, R_SIDEWALL, R_TREAD, R_RIMFACE, WHEEL_TEX_W, WHEEL_TEX_H,
  WHEEL_R, RIM_R, TYRE_W_F, TYRE_W_R, TRACK_F, TRACK_R, Z_FRONT_AXLE, Z_REAR_AXLE, SIDEWALL_R0, SIDEWALL_R1,
  type Rect,
} from './carLayout.ts';
import { hullSlices, halfRing, hullUV, hullPoint, profileAt, sAtParam, HULL_FRONT, HULL_REAR } from './hull.ts';

export const CARBON_TILE = 0.06;

type Level = 0 | 1 | 2;

// ------------------------------------------------------------------------------------------------ helpers
const cuvPlanar = (p: V3, n: V3): V2 => {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [p[2] / CARBON_TILE, p[1] / CARBON_TILE];
  if (ay >= az) return [p[2] / CARBON_TILE, p[0] / CARBON_TILE];
  return [p[0] / CARBON_TILE, p[1] / CARBON_TILE];
};

function drvUV(r: Rect, a: number, b: number): V2 {
  return rectUV(r, a, b, DRV_W, DRV_H);
}
function trimRectUV(r: Rect, a: number, b: number): V2 {
  return rectUV(r, a, b, TRIM_W, TRIM_H);
}
function wheelRectUV(r: Rect, a: number, b: number): V2 {
  return rectUV(r, a, b, WHEEL_TEX_W, WHEEL_TEX_H);
}

interface SweepSt {
  o: V3;
  d: V3;
  u: V3;
  sx: number;
  sy: number;
}

/**
 * Sweep a closed 2D section (points (a,b) in the station frame d/u) through stations.
 * uvf(i, j, p) supplies uvs; caps close both ends.
 */
function sweep(
  mb: MB,
  st: SweepSt[],
  sec: V2[],
  uvf: (i: number, j: number, p: V3) => V2,
  opts: { caps?: boolean; capUV?: V2 | ((p: V3) => V2); cuv?: (p: V3, n: V3) => V2 } = {},
) {
  const P: V3[][] = st.map((s) => sec.map(([a, b]) => add3(s.o, add3(scl3(s.d, a * s.sx), scl3(s.u, b * s.sy)))));
  const base = mb.grid(P, (i, j) => uvf(i, j, P[i][j]), { wrapCols: true, orient: true });
  if (opts.cuv) {
    for (let v = base; v < mb.count; v++) {
      const p: V3 = [mb.pos[v * 3], mb.pos[v * 3 + 1], mb.pos[v * 3 + 2]];
      const n: V3 = [mb.nor[v * 3], mb.nor[v * 3 + 1], mb.nor[v * 3 + 2]];
      const c = opts.cuv(p, n);
      mb.cuv[v * 2] = c[0];
      mb.cuv[v * 2 + 1] = c[1];
    }
  }
  if (opts.caps !== false) {
    const capUV = opts.capUV ?? ((p: V3) => uvf(0, 0, p));
    const d0 = norm3(sub3(st[0].o, st[1].o));
    const d1 = norm3(sub3(st[st.length - 1].o, st[st.length - 2].o));
    const cu = opts.cuv ? (p: V3) => opts.cuv!(p, d0) : undefined;
    mb.cap(P[0], d0, capUV, false, cu);
    mb.cap(P[P.length - 1], d1, capUV, false, cu);
  }
  return base;
}

function ellipse(n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}
/** streamlined tube section (teardrop-ish ellipse) — a along chord */
function aeroSection(n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a);
    const y = Math.sin(a) * (x > 0 ? 1 - 0.35 * x * x : 1);
    out.push([x, y]);
  }
  return out;
}
function roundedRect(n: number, r = 0.35): V2[] {
  // superellipse
  const out: V2[] = [];
  const e = 2 / Math.max(0.05, r) ;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([Math.sign(c) * Math.abs(c) ** (2 / e), Math.sign(s) * Math.abs(s) ** (2 / e)]);
  }
  return out;
}

/** frames along a path: d = reference projected ⟂ tangent, u = t × d */
function framesAlong(path: V3[], ref: (i: number, t: V3) => V3): { d: V3; u: V3; t: V3 }[] {
  const out: { d: V3; u: V3; t: V3 }[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const t = norm3(sub3(b, a));
    let r = ref(i, t);
    r = sub3(r, scl3(t, dot3(r, t)));
    if (Math.hypot(r[0], r[1], r[2]) < 1e-5) r = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const d = norm3(r);
    const u = norm3(cross3(t, d));
    out.push({ d, u, t });
  }
  return out;
}

/** aero-profiled arm between a and b (chord oriented with the airflow, +Z) */
function arm(mb: MB, a: V3, b: V3, chord: number, thick: number, n: number, uv: (p: V3) => V2) {
  const path = [a, lerp3(a, b, 0.5), b];
  const fr = framesAlong(path, () => [0, 0, 1]);
  const st: SweepSt[] = path.map((p, i) => ({ o: p, d: fr[i].d, u: fr[i].u, sx: chord / 2, sy: thick / 2 }));
  sweep(mb, st, aeroSection(n), (_i, _j, p) => uv(p));
}
const metricUV = (p: V3): V2 => [(p[2] + p[0] * 0.5) / CARBON_TILE, (p[1] + p[0] * 0.5) / CARBON_TILE];

function tube(mb: MB, path: V3[], r: number | ((i: number) => number), n: number, uv: V2 | ((i: number, j: number) => V2), ref: V3 = [0, 1, 0], caps = true, cuv?: (p: V3, n: V3) => V2) {
  const fr = framesAlong(path, () => ref);
  const st: SweepSt[] = path.map((p, i) => {
    const rr = typeof r === 'number' ? r : r(i);
    return { o: p, d: fr[i].d, u: fr[i].u, sx: rr, sy: rr };
  });
  sweep(mb, st, ellipse(n), (i, j) => (typeof uv === 'function' ? uv(i, j) : uv), { caps, cuv });
}

function box(mb: MB, c: V3, s: V3, uv: V2, rot?: THREE.Euler) {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...c), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
  mb.addGeometry(g, m, uv, mb.withCuv ? (p) => cuvPlanar(p, [0, 1, 0]) : undefined);
  g.dispose();
}
function ellipsoid(mb: MB, c: V3, r: V3, ws: number, hs: number, uv: V2 | ((p: V3, n: V3, uv: V2) => V2), rot?: THREE.Euler) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...c), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(...r));
  mb.addGeometry(g, m, uv, mb.withCuv ? (p) => cuvPlanar(p, [0, 1, 0]) : undefined);
  g.dispose();
}
function cylinderX(mb: MB, c: V3, r: number, len: number, seg: number, uv: V2, open = false) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  g.rotateZ(Math.PI / 2);
  g.translate(c[0], c[1], c[2]);
  mb.addGeometry(g, undefined, uv);
  g.dispose();
}

/** how far a plate's rim normals lean toward its faces (tan of the lean; 0.8 ≈ 39°) */
const BEVEL = 0.8;
/** extruded flat plate: outline in (a,b) coordinates of plane (o, ea, eb), thickness along en */
function plate(
  mb: MB,
  outline: V2[],
  o: V3,
  ea: V3,
  eb: V3,
  thick: number,
  uvf: (a: number, b: number, face: 1 | -1 | 0) => V2,
  cuv?: (p: V3, n: V3) => V2,
) {
  const en = norm3(cross3(ea, eb));
  const P = (a: number, b: number, t: number): V3 => add3(o, add3(scl3(ea, a), add3(scl3(eb, b), scl3(en, t))));
  const n = outline.length;
  // faces
  for (const side of [1, -1] as const) {
    const ring = outline.map(([a, b]) => P(a, b, (side * thick) / 2));
    const nn = scl3(en, side);
    mb.cap(ring, nn, (p) => {
      const q = sub3(p, o);
      return uvf(dot3(q, ea), dot3(q, eb), side);
    }, false, cuv ? (p) => cuv(p, nn) : undefined);
  }
  // rim
  for (let k = 0; k < n; k++) {
    const [a0, b0] = outline[k];
    const [a1, b1] = outline[(k + 1) % n];
    const p0 = P(a0, b0, thick / 2);
    const p1 = P(a1, b1, thick / 2);
    const p2 = P(a1, b1, -thick / 2);
    const p3 = P(a0, b0, -thick / 2);
    let nrm = norm3(cross3(sub3(p1, p0), en));
    // outward: away from outline centroid
    const cx = outline.reduce((s, q) => s + q[0], 0) / n;
    const cy = outline.reduce((s, q) => s + q[1], 0) / n;
    const mid = [(a0 + a1) / 2 - cx, (b0 + b1) / 2 - cy];
    const out3 = add3(scl3(ea, mid[0]), scl3(eb, mid[1]));
    let flip = false;
    if (dot3(nrm, out3) < 0) {
      nrm = scl3(nrm, -1);
      flip = true;
    }
    const uv = uvf((a0 + a1) / 2, (b0 + b1) / 2, 0);
    const c = cuv ? cuv(p0, nrm) : ([0, 0] as V2);
    // the rim shades as a rounded edge: its normals lean toward each face, so a moulded part's
    // edge catches a thin highlight instead of a machined 90° step (no extra triangles)
    const nTop = norm3(add3(nrm, scl3(en, BEVEL)));
    const nBot = norm3(add3(nrm, scl3(en, -BEVEL)));
    const i0 = mb.vert(p0, nTop, uv, c);
    const i1 = mb.vert(p1, nTop, uv, c);
    const i2 = mb.vert(p2, nBot, uv, c);
    const i3 = mb.vert(p3, nBot, uv, c);
    if (!flip) {
      mb.tri(i0, i3, i1);
      mb.tri(i1, i3, i2);
    } else {
      mb.tri(i0, i1, i3);
      mb.tri(i1, i2, i3);
    }
  }
}

/** rounded polygon outline (corner radius r) → smooth closed outline */
function roundPoly(pts: V2[], r: number | number[], seg = 4): V2[] {
  const out: V2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const rr = Array.isArray(r) ? r[i] : r;
    const da = norm3([a[0] - p[0], a[1] - p[1], 0]);
    const db = norm3([b[0] - p[0], b[1] - p[1], 0]);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const rad = Math.min(rr, la * 0.45, lb * 0.45);
    if (rad < 1e-4 || seg < 1) {
      out.push(p);
      continue;
    }
    const s: V2 = [p[0] + da[0] * rad, p[1] + da[1] * rad];
    const e: V2 = [p[0] + db[0] * rad, p[1] + db[1] * rad];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      // quadratic bezier s → p → e
      const x = (1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p[0] + t * t * e[0];
      const y = (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p[1] + t * t * e[1];
      out.push([x, y]);
    }
  }
  return out;
}

/** lathe around the X axis: profile points (r, x); uvf(i along profile, j around) */
function latheX(mb: MB, prof: V2[], seg: number, uvf: (i: number, j: number) => V2, phase = 0, wrap = true) {
  const P: V3[][] = [];
  for (let j = 0; j <= seg; j++) {
    const a = phase + (j / seg) * Math.PI * 2;
    const row: V3[] = [];
    for (const [r, x] of prof) row.push([x, r * Math.cos(a), r * Math.sin(a)]);
    P.push(row);
  }
  // rows = angle, cols = profile (last row duplicates the first for uv seam)
  void wrap;
  return mb.grid(P, (j, i) => uvf(i, j), { orient: true });
}

// ================================================================================================ parts
interface Buckets {
  paint: MB;
  carbon: MB;
  trim: MB;
  driver: MB;
  /** helmet + visor, pivot-local around NECK_PIVOT (animated) */
  head: MB;
  decals: MB;
  /** parts that bend and break off in a crash (body space, own meshes) */
  parts: Record<PartId, PartMB>;
}

/** breakable parts: the two halves of the front wing and the rear wing (upper) */
export type PartId = 'fwL' | 'fwR' | 'rw';
export const PART_IDS: PartId[] = ['fwL', 'fwR', 'rw'];
interface PartMB {
  paint: MB;
  carbon: MB;
  trim: MB;
}
/** where each part hinges when it's bent (body space) */
export const PART_HINGE: Record<PartId, V3> = { fwL: [0.13, 0.11, 2.8], fwR: [-0.13, 0.11, 2.8], rw: [0, 0.72, -1.97] };

const CUV = (p: V3, n: V3) => cuvPlanar(p, n);

// ------------------------------------------------------------------------------------ hull
function buildHull(mb: MB, level: Level) {
  const zs = hullSlices(level);
  const rows: V3[][] = [];
  const S: number[][] = [];
  const Z: number[] = [];
  for (const z of zs) {
    const hr = halfRing(z, level);
    const n = hr.pts.length;
    const ring: V3[] = [];
    const ss: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      ring.push([-hr.pts[i][0], hr.pts[i][1], z]);
      ss.push(-hr.s[i]);
    }
    for (let i = 1; i < n; i++) {
      ring.push([hr.pts[i][0], hr.pts[i][1], z]);
      ss.push(hr.s[i]);
    }
    rows.push(ring);
    S.push(ss);
    Z.push(z);
  }
  mb.grid(
    rows,
    (i, j) => hullUV(Z[i], S[i][j]),
    { orient: true, cuvf: (i, j) => [Z[i] / CARBON_TILE, S[i][j] / CARBON_TILE] },
  );
  // front tip cap + rear face
  const front = rows[0];
  mb.cap(front, [0, 0, 1], hullUV(Z[0], 0), false, (p) => [p[0] / CARBON_TILE, p[1] / CARBON_TILE]);
  const rear = rows[rows.length - 1];
  mb.cap(rear, [0, 0, -1], paintCellUV(PC.black), false, (p) => [p[0] / CARBON_TILE, p[1] / CARBON_TILE]);
}

// ------------------------------------------------------------------------------------ wings
interface WingSt {
  x: number;
  z: number; // leading edge
  y: number;
  c: number; // chord
  a: number; // angle (deg), trailing edge up
  t?: number; // thickness ratio
  cam?: number;
}
/** wing element along +X stations (left half incl. centre); mirrored by the caller when needed */
function wingElement(mb: MB, st: WingSt[], nAf: number, uv: (spanT: number, chordT: number, p: V3) => V2, cuv?: (p: V3, n: V3) => V2, caps = true) {
  const thick = st[0].t ?? 0.1;
  const cam = st[0].cam ?? 0.06;
  const af = airfoil(nAf, thick, cam);
  // chord-wise arc param for uv
  const arc: number[] = [0];
  for (let j = 1; j < af.length; j++) arc.push(arc[j - 1] + Math.hypot(af[j][0] - af[j - 1][0], af[j][1] - af[j - 1][1]));
  const tot = arc[arc.length - 1] + Math.hypot(af[0][0] - af[af.length - 1][0], af[0][1] - af[af.length - 1][1]);
  const x0 = st[0].x;
  const x1 = st[st.length - 1].x;
  const stations: SweepSt[] = st.map((s) => {
    const a = (s.a * Math.PI) / 180;
    const d: V3 = [0, Math.sin(a), -Math.cos(a)];
    const u: V3 = [0, Math.cos(a), Math.sin(a)];
    return { o: [s.x, s.y, s.z], d, u, sx: s.c, sy: s.c };
  });
  sweep(
    mb,
    stations,
    af,
    (i, j, p) => uv((st[i].x - x0) / (x1 - x0 || 1), arc[j] / tot, p),
    { caps, cuv },
  );
}

function mirrorStations(st: WingSt[]): WingSt[] {
  // produce full-span stations from a half list that starts at x = 0
  const neg = st.slice(1).map((s) => ({ ...s, x: -s.x })).reverse();
  return [...neg, ...st];
}

/**
 * 2026 front wing: 100 mm narrower, a big carbon mainplane (raised neutral centre section the nose
 * sits on) and a two-element painted flap that is ACTIVE — it rotates flatter on the straights
 * (straight mode) and back to full angle for the corners. No tip "eyebrow" winglets any more; the
 * endplates carry the detail (footplate, outwash canard, a turned-out top edge).
 * The flaps are built separately in pivot-local space (frontFlap) so the rig can rotate them.
 */
export const FW_SPAN = 0.83;
export const FW_FLAP_PIVOT: V3 = [0, 0.165, 2.73];
/** the flap elements, left half (x ≥ 0), body space */
function fwFlapStations(level: Level): { e1: WingSt[]; e2: WingSt[] } {
  const xs2 = level === 2 ? [0.11, 0.48, FW_SPAN - 0.012] : [0.11, 0.2, 0.3, 0.4, 0.5, 0.6, 0.68, 0.75, 0.8, FW_SPAN - 0.012];
  const T = (x: number) => (x - 0.11) / (FW_SPAN - 0.12);
  const e1 = xs2.map((x) => {
    const t = T(x);
    // sweeps up toward the endplate, the chord growing outboard
    return { x, z: 2.745 - 0.05 * t * t, y: 0.148 + 0.075 * t ** 2.2, c: lerp(0.19, 0.205, t * t), a: lerp(15, 25, t), t: 0.1, cam: 0.075 };
  });
  const e2 = xs2.map((x) => {
    const t = T(x);
    return { x, z: 2.605 - 0.045 * t * t, y: 0.212 + 0.112 * t ** 2.2, c: lerp(0.15, 0.172, t * t), a: lerp(30, 44, t), t: 0.1, cam: 0.08 };
  });
  return { e1, e2 };
}

function frontWing(b: Buckets, level: Level) {
  const nAf = [16, 10, 6][level];
  const xs = level === 2 ? [0, 0.3, 0.6, FW_SPAN - 0.005] : [0, 0.08, 0.16, 0.24, 0.3, 0.38, 0.48, 0.58, 0.68, 0.76, FW_SPAN - 0.005];
  const E = (fn: (x: number, t: number) => WingSt) => xs.map((x) => fn(x, x / FW_SPAN));
  const carbonUV = (_s: number, _c: number, p: V3): V2 => [p[0] / CARBON_TILE, (p[2] + p[1]) / CARBON_TILE];
  // mainplane: full span, long chord; the neutral centre section (|x| < 0.25) raised under the nose
  const e0 = E((x, t) => ({
    x,
    z: 3.03 - 0.07 * t * t,
    y: lerp(0.112, 0.068, smooth(0.2, 0.34, x)) + 0.012 * smooth(0.6, 1, t),
    c: lerp(0.37, 0.31, t),
    a: lerp(2.5, 6.5, t),
    t: 0.085,
    cam: 0.055,
  }));
  // each half is its own part (it can break off): split at the centreline
  const half = (st: WingSt[], side: number) => (side > 0 ? st : st.map((q) => ({ ...q, x: -q.x })).reverse());
  for (const side of [1, -1]) {
    const P = b.parts[side > 0 ? 'fwL' : 'fwR'];
    wingElement(P.carbon, half(e0, side), nAf, carbonUV);
    // endplate (carbon): rounded outline in (z, y); the top edge turns outboard
    const ep = roundPoly(
      [
        [3.05, 0.028],
        [2.46, 0.028],
        [2.41, 0.16],
        [2.44, 0.285],
        [2.52, 0.325],
        [2.62, 0.3],
        [2.8, 0.2],
        [2.96, 0.12],
        [3.06, 0.075],
      ],
      [0.02, 0.03, 0.05, 0.05, 0.05, 0.06, 0.08, 0.05, 0.03],
      level === 2 ? 1 : 3,
    );
    plate(P.carbon, ep, [(FW_SPAN + 0.006) * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
    if (level < 2) {
      // footplate: a horizontal strip along the endplate foot, curling outboard
      plate(P.carbon, roundPoly([[3.02, 0], [2.48, 0], [2.48, 0.07], [3.02, 0.085]], 0.02, 2), [(FW_SPAN - 0.03) * side, 0.03, 0], [0, 0, 1], [side, 0, 0], 0.006, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
      // turned-out top edge: a narrow plate leaning outboard along the endplate's upper rear edge
      plate(
        P.carbon,
        roundPoly([[2.47, 0], [2.72, 0], [2.64, 0.05], [2.47, 0.055]], 0.015, 2),
        [(FW_SPAN + 0.006) * side, 0.29, 0],
        [0, 0, 1],
        norm3([0.75 * side, 0.66, 0]),
        0.006,
        (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE],
      );
      // outwash canard on the endplate's outer face, low and forward
      wingElement(P.carbon, [
        { x: (FW_SPAN + 0.012) * side, z: 2.97, y: 0.1, c: 0.12, a: -8, t: 0.07 },
        { x: (FW_SPAN + 0.06) * side, z: 2.955, y: 0.108, c: 0.1, a: -10, t: 0.07 },
      ].sort((p, q) => p.x - q.x), 6, (_s, _c, p) => [p[0] / CARBON_TILE, p[2] / CARBON_TILE]);
      // flap adjuster fairing where the flaps meet the endplate (the actuator of the active aero)
      ellipsoid(P.carbon, [(FW_SPAN - 0.02) * side, 0.24, 2.66], [0.016, 0.04, 0.09], 8, 6, (p) => [p[2] / CARBON_TILE, p[1] / CARBON_TILE]);
    }
  }
  // the nose rides on the mainplane on two cranked pylons
  if (level < 2) {
    for (const side of [1, -1]) {
      const py = roundPoly([[2.85, 0.108], [2.72, 0.108], [2.7, 0.17], [2.84, 0.17]], 0.012, 2);
      plate(b.carbon, py, [0.052 * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.01, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
    }
  }
}

/** one side's active flap pair in pivot-local coordinates (rotates about FW_FLAP_PIVOT) */
function frontFlap(mb: MB, level: Level, side: 1 | -1) {
  const nAf = [14, 9, 6][level];
  const { e1, e2 } = fwFlapStations(level);
  const e1s = e1.map((q) => ({ ...q, x: q.x * side }));
  const e2s = e2.map((q) => ({ ...q, x: q.x * side }));
  if (side < 0) {
    e1s.reverse();
    e2s.reverse();
  }
  const fwuv = (st: number, c: number) => rectUV(R_FWING, side > 0 ? 0.5 + st * 0.5 : st * 0.5, c);
  const from = mb.count;
  wingElement(mb, e1s, nAf, (s, c) => fwuv(s, c * 0.5), CUV);
  wingElement(mb, e2s, nAf, (s, c) => fwuv(s, 0.5 + c * 0.5), CUV);
  // the flaps' own small end fences where they meet the endplate
  if (level < 2) {
    const x = (FW_SPAN - 0.004) * side;
    const q = roundPoly([[2.77, 0.2], [2.5, 0.29], [2.44, 0.35], [2.56, 0.36], [2.78, 0.25]], 0.015, 2);
    plate(mb, q, [x, 0, 0], [0, 0, 1], [0, 1, 0], 0.006, () => paintCellUV(PC.carbon), CUV);
  }
  mb.transform(from, new THREE.Matrix4().makeTranslation(-FW_FLAP_PIVOT[0], -FW_FLAP_PIVOT[1], -FW_FLAP_PIVOT[2]));
}

/**
 * 2026 rear wing: three elements — a fixed main plane and a two-element flap that opens on the
 * straights (straight mode, drsFlap) — with no beam wing underneath, simpler rounded endplates
 * carrying the new endplate lights, on twin pylons from the crash structure.
 */
function rearWing(b: Buckets, level: Level) {
  const nAf = [16, 10, 6][level];
  const xs = level === 2 ? [0, 0.25, 0.49] : [0, 0.08, 0.16, 0.24, 0.32, 0.39, 0.45, 0.49];
  // main plane: spoon shaped, tips rise into the endplates
  const main = xs.map((x) => {
    const t = x / 0.49;
    return { x, z: -1.845 + 0.02 * t * t, y: 0.708 + 0.05 * t ** 4, c: 0.3, a: 9 + 4 * t * t, t: 0.12, cam: 0.075 };
  });
  const P = b.parts.rw;
  wingElement(P.paint, mirrorStations(main), nAf, (s, c) => rectUV(R_MAIN, s, c), CUV);
  // (2026: no beam wing — the space under the main plane is open down to the crash structure)
  // endplates (paint), rounded outline in (z,y)
  const ep = roundPoly(
    [
      [-1.8, 0.56],
      [-1.79, 0.82],
      [-1.93, 0.962],
      [-2.38, 0.972],
      [-2.425, 0.9],
      [-2.41, 0.6],
      [-2.26, 0.49],
      [-2.0, 0.5],
    ],
    [0.03, 0.12, 0.05, 0.04, 0.05, 0.08, 0.06, 0.05],
    level === 2 ? 1 : 4,
  );
  const EZ0 = -2.42;
  const EZ1 = -1.79;
  const EY0 = 0.49;
  const EY1 = 0.97;
  for (const side of [1, -1]) {
    plate(
      P.paint,
      ep,
      [0.5 * side, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      0.014,
      (z, y, face) => {
        const bb = (y - EY0) / (EY1 - EY0);
        const outer = face * side < 0; // en = −X: face −1 → normal +X
        if (face === 0) return paintCellUV(PC.carbon);
        if (outer) {
          // readable from outside: left side reads rear→front? viewer on +X: screen right = −Z
          const a = side > 0 ? (EZ1 - z) / (EZ1 - EZ0) : (z - EZ0) / (EZ1 - EZ0);
          return rectUV(side > 0 ? R_EP_OL : R_EP_OR, a, bb);
        }
        return rectUV(R_EP_IN, (z - EZ0) / (EZ1 - EZ0), bb);
      },
      CUV,
    );
  }
  // pylons (twin, carbon) from crash structure up to the main plane
  for (const side of [1, -1]) {
    const x = 0.055 * side;
    const pts: V3[] = [
      [x, 0.37, -2.06],
      [x, 0.55, -2.02],
      [x, 0.715, -1.97],
    ];
    const st: SweepSt[] = pts.map((p) => ({ o: p, d: [0, 0, -1] as V3, u: [side, 0, 0] as V3, sx: 0.1, sy: 0.012 }));
    sweep(b.carbon, st, aeroSection(level === 2 ? 4 : 8), (_i, _j, p) => [p[2] / CARBON_TILE, p[1] / CARBON_TILE]);
  }
  // endplate lights (2026): tall LED strips down the endplates' trailing edges
  for (const side of [1, -1]) box(P.trim, [0.5 * side, 0.72, -2.419], [0.017, 0.24, 0.008], trimUV(TC.rainLight));
}

/** the active rear flap pair in pivot-local coordinates (pivot at the upper flap's trailing edge) */
export const FLAP_PIVOT: V3 = [0, 0.948, -2.276];
function drsFlap(mb: MB, level: Level) {
  const nAf = [16, 10, 6][level];
  const xs = level === 2 ? [0, 0.25, 0.492] : [0, 0.08, 0.16, 0.24, 0.32, 0.39, 0.45, 0.492];
  const f1 = xs.map((x) => {
    const t = x / 0.492;
    return { x, z: -2.085 + 0.015 * t * t, y: 0.79 + 0.03 * t ** 4, c: 0.165, a: 31, t: 0.1, cam: 0.08 };
  });
  const f2 = xs.map((x) => {
    const t = x / 0.492;
    return { x, z: -2.196 + 0.012 * t * t, y: 0.862 + 0.025 * t ** 4, c: 0.12, a: 45, t: 0.1, cam: 0.08 };
  });
  const from = mb.count;
  wingElement(mb, mirrorStations(f1), nAf, (s, c) => rectUV(R_FLAP, s, c * 0.55), CUV);
  wingElement(mb, mirrorStations(f2), nAf, (s, c) => rectUV(R_FLAP, s, 0.55 + c * 0.45), CUV);
  // move into pivot space
  const m = new THREE.Matrix4().makeTranslation(-FLAP_PIVOT[0], -FLAP_PIVOT[1], -FLAP_PIVOT[2]);
  mb.transform(from, m);
}

// ------------------------------------------------------------------------------------ floor + diffuser
function floorAndDiffuser(b: Buckets, level: Level) {
  // (2026: the floor is 100 mm narrower and flatter — shallow tunnels, the edge simpler)
  const half: V2[] = [
    [1.2, 0.3],
    [1.17, 0.5],
    [1.13, 0.68],
    [1.02, 0.712],
    [0.78, 0.715],
    [0.5, 0.715],
    [-0.62, 0.72],
    [-0.9, 0.695],
    [-1.1, 0.645],
    [-1.25, 0.575],
    [-1.36, 0.52],
    [-1.38, 0.5],
  ];
  const outline: V2[] = [...half.map(([z, x]) => [x, z] as V2), ...half.slice().reverse().map(([z, x]) => [-x, z] as V2)];
  const ol = roundPoly(outline, 0.02, level === 2 ? 0 : 1);
  plate(b.carbon, ol, [0, 0.0425, 0], [1, 0, 0], [0, 0, 1], 0.015, (x, z) => [x / CARBON_TILE, z / CARBON_TILE]);

  // floor edge wing: small curled lip along the outer edge
  if (level < 2) {
    for (const side of [1, -1]) {
      const zs = [0.45, 0.2, -0.1, -0.4, -0.7, -0.95];
      const st: WingSt[] = zs.map((z) => ({ x: z, z: 0, y: 0, c: 0.07, a: 0 }));
      // build as a sweep with stations along z
      const af = airfoil(8, 0.12, 0.06);
      const stations: SweepSt[] = zs.map((z) => {
        const xEdge = z > -0.6 ? 0.718 : lerp(0.718, 0.695, (-0.6 - z) / 0.35);
        return { o: [xEdge * side - 0.035 * side, 0.06, z] as V3, d: norm3([side * 0.8, 0.6, 0]), u: norm3([-side * 0.6, 0.8, 0]), sx: 0.07, sy: 0.07 };
      });
      void st;
      sweep(b.carbon, stations, af, (_i, _j, p) => [p[2] / CARBON_TILE, p[1] / CARBON_TILE]);
    }
  }
  // wheel-wake control boards (2026): at the front of the sidepods, three stacked horizontal
  // elements between an inner and an outer fence, turning the front tyres' wake inboard
  if (level < 2) {
    for (const side of [1, -1]) {
      const X0 = 0.44, X1 = 0.705;
      // inner fence: a tall sail; outer fence: a slim curved strip (so the elements read between them)
      const inner = roundPoly([[1.14, 0.055], [0.74, 0.055], [0.7, 0.28], [0.8, 0.42], [1.0, 0.39], [1.16, 0.26]], [0.02, 0.03, 0.06, 0.06, 0.05, 0.04], 3);
      plate(b.carbon, inner, [X0 * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.008, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
      const outer = roundPoly([[1.12, 0.055], [1.03, 0.055], [0.86, 0.4], [0.78, 0.4], [0.8, 0.34], [0.98, 0.1]], [0.02, 0.02, 0.03, 0.02, 0.03, 0.03], 3);
      plate(b.carbon, outer, [X1 * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.008, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
      const els: [number, number, number, number][] = [
        // y, leading-edge z, chord, angle (trailing edge down = in-wash)
        [0.15, 1.1, 0.34, -6],
        [0.25, 1.06, 0.28, -9],
        [0.35, 1.0, 0.22, -12],
      ];
      for (const [y, z, c, a] of els) {
        const st: WingSt[] = [X0 + 0.004, (X0 + X1) / 2, X1 - 0.004].map((x) => ({ x: x * side, z: z - (x - X0) * 0.18, y: y + (x - X0) * 0.1, c, a, t: 0.08, cam: 0.05 }));
        if (side < 0) st.reverse();
        wingElement(b.carbon, st, 8, (_s, _c, p) => [p[0] / CARBON_TILE, p[2] / CARBON_TILE]);
      }
    }
  } else {
    for (const side of [1, -1]) {
      const fence = roundPoly([[1.14, 0.055], [0.74, 0.055], [0.72, 0.3], [0.9, 0.44], [1.16, 0.3]], 0.03, 1);
      plate(b.carbon, fence, [0.6 * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.2, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
    }
  }
  // floor stays: a slim rod each side from the floor's edge up into the sidepod's undercut, holding
  // the edge down against the suction (the thin diagonal line under every car's flank)
  if (level < 2) for (const side of [1, -1]) tube(b.trim, [[0.665 * side, 0.052, -0.12], [0.56 * side, 0.12, -0.1], [0.452 * side, 0.205, -0.08]], 0.0055, 6, trimUV(TC.blackSatin), [0, 0, 1]);
  // plank + skid blocks
  box(b.trim, [0, 0.0265, -0.15], [0.3, 0.013, 2.1], trimUV(TC.plank));
  if (level < 2) for (const z of [0.55, -0.15, -0.85]) box(b.trim, [0, 0.0195, z], [0.09, 0.002, 0.14], trimUV(TC.skid));

  // diffuser roof (ramp), side walls, strakes
  const n = level === 2 ? 4 : 12;
  const roofY = (z: number) => 0.045 + 0.28 * Math.pow(smooth(-1.36, -2.3, z), 1.35);
  const W = 0.5;
  const rows: V3[][] = [];
  const cols = level === 2 ? 3 : 9;
  for (let i = 0; i <= n; i++) {
    const z = lerp(-1.36, -2.3, i / n);
    const row: V3[] = [];
    for (let j = 0; j <= cols; j++) {
      const x = lerp(-W, W, j / cols);
      // central channel slightly higher (under the gearbox)
      const bump = 0.05 * Math.exp(-((x / 0.14) ** 2)) * smooth(-1.4, -1.9, z);
      row.push([x, roofY(z) + bump, z]);
    }
    rows.push(row);
  }
  // underside (visible from behind: a dark satin cavity, like the real thing in its own shadow)
  // and top (carbon) — two grids facing opposite ways
  b.trim.grid(rows, () => trimUV(TC.blackSatin));
  const rowsTop = rows.map((r) => r.map((p) => [p[0], p[1] + 0.012, p[2]] as V3));
  b.carbon.grid(rowsTop, (i, j) => [rowsTop[i][j][0] / CARBON_TILE, rowsTop[i][j][2] / CARBON_TILE], { flip: true });
  // fix orientation: first grid should face down — check one normal
  // side walls
  for (const side of [1, -1]) {
    const wall: V2[] = [];
    for (let i = 0; i <= n; i++) {
      const z = lerp(-1.36, -2.3, i / n);
      wall.push([z, roofY(z) + 0.03]);
    }
    wall.push([-2.3, 0.035], [-1.36, 0.035]);
    plate(b.carbon, wall, [W * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, (a, bb) => [a / CARBON_TILE, bb / CARBON_TILE]);
  }
  if (level < 2) {
    // strakes: two per side, hanging from the roof and ending well above the road at the exit
    for (const xs of [0.17, 0.34]) {
      for (const side of [1, -1]) {
        const st: V2[] = [];
        for (let i = 2; i <= n; i++) {
          const z = lerp(-1.36, -2.3, i / n);
          st.push([z, roofY(z) + 0.004]);
        }
        st.push([-2.3, 0.05 + (roofY(-2.3) - 0.05) * 0.55], [lerp(-1.36, -2.3, 0.55), 0.052], [lerp(-1.36, -2.3, 2 / n), 0.05]);
        plate(b.trim, st, [xs * side, 0, 0], [0, 0, 1], [0, 1, 0], 0.008, () => trimUV(TC.blackSatin));
      }
    }
  }
}

// ------------------------------------------------------------------------------------ halo, airbox, fin, mirrors, details
const HALO_HALF: V3[] = [
  [0.305, 0.66, -0.075],
  [0.302, 0.735, 0.0],
  [0.29, 0.8, 0.12],
  [0.255, 0.83, 0.27],
  [0.18, 0.842, 0.405],
  [0.075, 0.846, 0.495],
  [0.0, 0.846, 0.515],
];
export function haloPath(samples: number): V3[] {
  const full: V3[] = [...HALO_HALF.map((p) => [-p[0], p[1], p[2]] as V3), ...HALO_HALF.slice(0, -1).reverse()];
  return crPath(full, samples);
}

function halo(b: Buckets, level: Level) {
  const n = [44, 24, 12][level];
  const path = haloPath(n);
  const fr = framesAlong(path, () => [0, 1, 0]);
  // section: flattened teardrop, wider than tall — the titanium hoop is bare carbon-wrapped
  // (what the driver sees from the cockpit), with a painted aero fairing over its top
  const st: SweepSt[] = path.map((p, i) => ({ o: p, d: fr[i].d, u: fr[i].u, sx: 0.022, sy: 0.03 }));
  // weave laid along the hoop (a planar projection smears it into long blocks across the front bar,
  // right where the cockpit camera looks)
  const arc: number[] = [0];
  for (let i = 1; i < path.length; i++) arc.push(arc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
  const ring = ellipse([14, 10, 6][level]);
  // (a finer weave than the bodywork's: the hoop is the car's closest surface to any camera)
  const HT = CARBON_TILE * 0.4;
  sweep(b.carbon, st, ring, (i, j) => [arc[i] / HT, (ring[j][0] * 0.022 + ring[j][1] * 0.03) / HT]);
  const top: V2[] = [];
  const nTop = [12, 8, 5][level];
  for (let k = 0; k <= nTop; k++) {
    // (the section's first axis, d, is up here)
    const a = -Math.PI / 2 + 0.5 + (k / nTop) * (Math.PI - 1.0);
    top.push([Math.cos(a) * 1.09 + 0.04, Math.sin(a) * 1.07]);
  }
  sweep(b.paint, st, top, () => paintCellUV(PC.halo), { cuv: CUV });
  // central pillar
  const pil = crPath([
    [0, 0.846, 0.505],
    [0, 0.815, 0.6],
    [0, 0.745, 0.7],
    [0, 0.672, 0.79],
  ], [8, 5, 3][level]);
  const pst: SweepSt[] = pil.map((p, i) => {
    const t = norm3(sub3(pil[Math.min(pil.length - 1, i + 1)], pil[Math.max(0, i - 1)]));
    const d = norm3(cross3([1, 0, 0], t));
    // (a slim blade edge-on to the driver: ~26 mm across, as it splits the onboard picture)
    return { o: p, d, u: [1, 0, 0] as V3, sx: 0.03, sy: 0.013 };
  });
  sweep(b.carbon, pst, aeroSection([10, 8, 5][level]), (_i, _j, p) => [p[2] / CARBON_TILE, p[1] / CARBON_TILE]);
}

function airboxAndFin(b: Buckets, level: Level) {
  // inlet cowl (elliptical mouth) on the roll hoop front face
  const seg = [20, 12, 6][level];
  const ring = ellipse(seg);
  const cy = 0.87;
  const rx = 0.078;
  const ry = 0.052;
  const zf = -0.108;
  const zb = -0.17;
  const outer: V3[][] = [];
  const inner: V3[][] = [];
  for (const [z, s] of [
    [zb, 1.02],
    [zf - 0.006, 1.02],
    [zf, 0.99],
  ] as [number, number][])
    outer.push(ring.map(([a, bb]) => [a * rx * s, cy + bb * ry * s, z] as V3));
  b.paint.grid(outer, () => paintCellUV(PC.airbox), { wrapCols: true, orient: true, cuvf: (i, j) => [outer[i][j][0] / CARBON_TILE, outer[i][j][1] / CARBON_TILE] });
  for (const [z, s] of [
    [zf, 0.94],
    [zb + 0.02, 0.8],
  ] as [number, number][])
    inner.push(ring.map(([a, bb]) => [a * rx * s, cy + bb * ry * s, z] as V3));
  // inner walls face inward: build then force flip by reversing orientation test (inward)
  const nrm = inner.map((r) => r.map((p) => norm3([-(p[0]) / rx, -(p[1] - cy) / ry, 0])));
  b.trim.grid(inner, () => trimUV(TC.inletDark), { wrapCols: true, normals: nrm, flip: true });
  // lip ring between outer front and inner front
  const lip = [outer[2], inner[0]];
  b.paint.grid(lip, () => paintCellUV(PC.black), { wrapCols: true, normals: lip.map((r) => r.map(() => [0, 0, 1] as V3)), cuvf: () => [0, 0], flip: true });
  b.trim.cap(inner[1], [0, 0, 1], trimUV(TC.inletDark));
  // make sure the inner grid winding faces inward: rebuild its triangles if needed (grid with normals keeps flip=false)

  // shark fin: thin plate on the engine cover spine
  const fin = roundPoly(
    [
      [-0.4, 0.9],
      [-0.5, 0.955],
      [-1.55, 0.85],
      [-1.8, 0.78],
      [-1.84, 0.47],
      [-1.3, 0.63],
      [-0.8, 0.78],
    ],
    [0.02, 0.04, 0.08, 0.06, 0.02, 0.02, 0.02],
    level === 2 ? 1 : 3,
  );
  const FZ0 = -1.84;
  const FZ1 = -0.4;
  const FY0 = 0.47;
  const FY1 = 0.955;
  plate(b.paint, fin, [0, 0, 0], [0, 0, 1], [0, 1, 0], 0.008, (z, y, face) => {
    const bb = (y - FY0) / (FY1 - FY0);
    if (face === 0) return paintCellUV(PC.primary);
    // face +1 → normal along cross(z,y) = −X ... en = cross(ea, eb) = (0,0,1)×(0,1,0) = (−1,0,0)
    const left = face < 0; // normal +X
    const a = left ? (FZ1 - z) / (FZ1 - FZ0) : (z - FZ0) / (FZ1 - FZ0);
    return rectUV(left ? R_FIN_L : R_FIN_R, a, bb);
  }, CUV);

  // T-cam: streamlined bar on top of the roll hoop
  if (level < 2) {
    const tc: V3 = [0, 0.972, -0.255];
    ellipsoid(b.trim, tc, [0.105, 0.02, 0.04], 14, 8, trimUV(TC.tcam));
    box(b.trim, [0, 0.955, -0.26], [0.02, 0.03, 0.05], trimUV(TC.tcam));
    // its lens windows, forward and back
    if (level === 0) for (const x of [0.05, -0.05]) for (const z of [-0.2205, -0.2895]) ellipsoid(b.trim, [x, 0.974, z], [0.0095, 0.0085, 0.004], 10, 6, trimUV(TC.blackGloss));
  } else {
    box(b.trim, [0, 0.968, -0.255], [0.2, 0.03, 0.07], trimUV(TC.tcam));
  }
}

function mirrors(b: Buckets, level: Level) {
  for (const side of [1, -1]) {
    const c: V3 = [0.515 * side, 0.715, 0.47];
    const ws = level === 0 ? 20 : 8;
    // aero housing: flattened, tapering rearwards; glass on the back face
    const hs: SweepSt[] = [];
    const nz = level === 0 ? 7 : 4;
    for (let i = 0; i <= nz; i++) {
      const t = i / nz;
      const z = c[2] + 0.055 - t * 0.075;
      const k = Math.sin(Math.min(1, t * 1.6 + 0.12) * Math.PI * 0.5);
      // (2026: bigger mirrors)
      hs.push({ o: [c[0], c[1], z], d: [1, 0, 0], u: [0, 1, 0], sx: 0.1 * k, sy: 0.036 * k });
    }
    sweep(b.paint, hs, roundedRect(ws, 0.35), () => paintCellUV(PC.mirror), { cuv: CUV });
    if (level < 2) {
      // glass (faces −Z)
      const g = new THREE.PlaneGeometry(0.178, 0.058);
      g.rotateY(Math.PI);
      g.translate(c[0], c[1], c[2] - 0.0205);
      // lateral safety light (2026) on the housing's outer tip
      box(b.trim, [c[0] + 0.1 * side, c[1], c[2] + 0.02], [0.006, 0.022, 0.05], trimUV(TC.sideLight));
      b.trim.addGeometry(g, undefined, trimUV(TC.mirrorGlass));
      g.dispose();
      // stalks
      arm(b.carbon, [0.47 * side, 0.7, 0.47], [0.355 * side, 0.64, 0.5], 0.045, 0.012, 6, metricUV);
      arm(b.carbon, [0.48 * side, 0.73, 0.47], [0.29 * side, 0.8, 0.15], 0.03, 0.01, 6, metricUV);
    }
  }
}

function noseDetails(b: Buckets, level: Level) {
  if (level === 2) return;
  // pitot
  tube(b.trim, [[0, 0.19, 2.85], [0, 0.192, 2.97]], 0.0045, 6, trimUV(TC.titanium), [0, 1, 0]);
  // nose cameras
  for (const side of [1, -1]) ellipsoid(b.trim, [0.125 * side, 0.36, 2.28], [0.018, 0.018, 0.05], 10, 6, trimUV(TC.blackGloss));
  // telemetry antenna on the chassis top ahead of the cockpit, off the centreline (it pokes up
  // beside the halo's pillar in the onboard), on a small carbon base
  box(b.carbon, [0.06, 0.631, 1.18], [0.022, 0.01, 0.034], [0.06 / CARBON_TILE, 1.18 / CARBON_TILE]);
  tube(b.trim, [[0.06, 0.632, 1.182], [0.06, 0.668, 1.177], [0.06, 0.7, 1.17]], (i) => 0.0034 - i * 0.0008, 6, trimUV(TC.blackSatin), [0, 0, 1]);
}

function exhaustAndLight(b: Buckets, level: Level) {
  const seg = [16, 10, 6][level];
  const path: V3[] = [
    [0, 0.43, -1.98],
    [0, 0.445, -2.12],
    [0, 0.458, -2.25],
  ];
  tube(b.trim, path, (i) => (i === 2 ? 0.046 : 0.042), seg, trimUV(TC.exhaust), [0, 1, 0], false);
  // dark inside
  const g = new THREE.CircleGeometry(0.04, seg);
  g.rotateY(Math.PI);
  g.translate(0, 0.458, -2.235);
  b.trim.addGeometry(g, undefined, trimUV(TC.blackSatin));
  g.dispose();
  // rain light on the crash-structure tail: a dark housing with the LED panel proud of it
  box(b.trim, [0, 0.318, -2.368], [0.13, 0.062, 0.014], trimUV(TC.blackGloss));
  box(b.trim, [0, 0.318, -2.377], [0.112, 0.046, 0.006], trimUV(TC.rainLight));
}

function cockpitBits(b: Buckets, level: Level) {
  if (level === 2) return;
  // headrest pads
  for (const side of [1, -1]) {
    ellipsoid(b.trim, [0.205 * side, 0.7, -0.01], [0.055, 0.05, 0.15], 10, 6, trimUV(TC.padding));
  }
  ellipsoid(b.trim, [0, 0.69, -0.085], [0.17, 0.06, 0.04], 10, 6, trimUV(TC.padding));
}

// ------------------------------------------------------------------------------------ driver
export const HELMET_C: V3 = [0, 0.758, 0.085];
export const HELMET_R: V3 = [0.124, 0.138, 0.148];
/** the driver's head turns and leans about this point (top of the neck) */
export const NECK_PIVOT: V3 = [0, 0.655, 0.055];
function driver(b: Buckets, level: Level) {
  const ws = [32, 18, 10][level];
  const hs = [24, 12, 7][level];
  // helmet shell, uv: longitude around (front = centre of texture), latitude
  // native sphere uv: u = 0 at the seam; rotate so the seam sits at the back → front = u 0.5, +X = 0.75
  const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, Math.PI * 0.8);
  g.rotateY(-Math.PI / 2);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...HELMET_C), new THREE.Quaternion(), new THREE.Vector3(...HELMET_R));
  if (level === 2) {
    b.trim.addGeometry(g, m, trimUV(TC.helmet));
  } else {
    m.premultiply(new THREE.Matrix4().makeTranslation(-NECK_PIVOT[0], -NECK_PIVOT[1], -NECK_PIVOT[2]));
    b.head.addGeometry(g, m, (_p, _n, uv) => drvUV(R_HELMET, uv[0], uv[1]));
  }
  g.dispose();
  // visor band (front), slightly proud
  if (level < 2) {
    const rows: V3[][] = [];
    const nu = 14;
    const nv = 4;
    for (let i = 0; i <= nv; i++) {
      const lat = lerp(-0.12, 0.3, i / nv);
      const row: V3[] = [];
      for (let j = 0; j <= nu; j++) {
        const lon = lerp(-1.0, 1.0, j / nu);
        const k = 1.012;
        row.push([
          HELMET_C[0] - NECK_PIVOT[0] + Math.sin(lon) * Math.cos(lat) * HELMET_R[0] * k,
          HELMET_C[1] - NECK_PIVOT[1] + Math.sin(lat) * HELMET_R[1] * k,
          HELMET_C[2] - NECK_PIVOT[2] + Math.cos(lon) * Math.cos(lat) * HELMET_R[2] * k,
        ]);
      }
      rows.push(row);
    }
    b.head.grid(rows, () => drvCellUV(DC.visor), { orient: true });
    // the helmet's own aero: a rear spoiler across the crown and a strip of tear-offs' tab at the
    // visor's edge (the helmet's paint, read off its unwrap at the same spot)
    const hp = (lon: number, lat: number, k = 1): V3 => [
      HELMET_C[0] - NECK_PIVOT[0] + Math.sin(lon) * Math.cos(lat) * HELMET_R[0] * k,
      HELMET_C[1] - NECK_PIVOT[1] + Math.sin(lat) * HELMET_R[1] * k,
      HELMET_C[2] - NECK_PIVOT[2] + Math.cos(lon) * Math.cos(lat) * HELMET_R[2] * k,
    ];
    const sp = [-0.55, -0.3, 0, 0.3, 0.55].map((d) => {
      // (along the crown at ~50° up behind the head; it kicks up off the shell toward its trailing edge)
      const lat = 0.86 - 0.12 * d * d;
      const p = hp(Math.PI + d * 1.5, lat, 0.985);
      return { x: p[0], z: p[2] + 0.012, y: p[1] + 0.006, c: 0.052, a: -18 - 6 * d * d, t: 0.16, cam: 0.02 };
    });
    wingElement(b.head, sp, level === 0 ? 8 : 5, () => drvUV(R_HELMET, 0.01, 0.86));
    // the chin bar under the visor, standing forward of the shell (a ball reads as a toy's head),
    // painted from the helmet's unwrap where it sits (the shell's sphere uv, seam at the back)
    const H: V3 = sub3(HELMET_C, NECK_PIVOT);
    const shellUV = (p: V3): V2 => {
      const d = norm3([(p[0] - H[0]) / HELMET_R[0], (p[1] - H[1]) / HELMET_R[1], (p[2] - H[2]) / HELMET_R[2]]);
      const theta = Math.acos(Math.max(-1, Math.min(1, d[1])));
      let phi = Math.atan2(d[0], d[2]) + Math.PI;
      if (phi >= Math.PI * 2) phi -= Math.PI * 2;
      // (the sphere was turned −90° about y: its native u runs from the back, front = 0.5, +x = 0.75)
      return drvUV(R_HELMET, phi / (Math.PI * 2), Math.max(0.01, 1 - theta / (Math.PI * 0.8)));
    };
    ellipsoid(b.head, add3(H, [0, -0.058, 0.04]), [0.1, 0.07, 0.115], ws, Math.max(6, hs >> 1), (p) => shellUV(p));
    if (level === 0)
      for (const side of [1, -1]) {
        const q = hp(1.02 * side, 0.12, 1.016);
        box(b.head, q, [0.008, 0.026, 0.012], drvCellUV(DC.hans), new THREE.Euler(0, 1.02 * side, 0));
      }
    // HANS collar + shoulders + arms (+ gloves: at the nearest level they ride the steering wheel, see hands)
    ellipsoid(b.driver, [0, 0.64, 0.01], [0.15, 0.04, 0.12], 12, 6, drvCellUV(DC.hans));
    for (const side of [1, -1]) {
      ellipsoid(b.driver, [0.165 * side, 0.595, 0.0], [0.1, 0.065, 0.13], 12, 8, drvCellUV(DC.suit));
      tube(b.driver, [[0.2 * side, 0.585, 0.06], [0.2 * side, 0.57, 0.28], [0.14 * side, 0.595, 0.47]], 0.042, 8, drvCellUV(DC.suit2), [0, 1, 0]);
      if (level > 0) ellipsoid(b.driver, [0.13 * side, 0.6, 0.49], [0.03, 0.04, 0.035], 8, 6, drvCellUV(DC.glove));
    }
  }
}

// ------------------------------------------------------------------------------------ steering wheel (pivot-local)
export const STEER_PIVOT: V3 = [0, 0.605, 0.5];
export const STEER_TILT = -0.42; // rotation about X (top toward the driver)
function steeringWheel(mb: MB) {
  // local: wheel plane XY, driver looks along +Z toward it (face at −Z). A 2026 wheel: a carbon
  // body wide at the grips with a flat top, a bevelled face panel carrying the screen, the shift
  // lights, dome buttons in bezels and anodised rotaries; paddles behind, a quick-release hub.
  const OUT: V2[] = [
    [-0.118, -0.062],
    [-0.142, -0.01],
    [-0.138, 0.05],
    [-0.1, 0.078],
    [0.1, 0.078],
    [0.138, 0.05],
    [0.142, -0.01],
    [0.118, -0.062],
    [0.055, -0.08],
    [-0.055, -0.08],
  ];
  const outline = roundPoly(OUT, [0.02, 0.02, 0.03, 0.02, 0.02, 0.03, 0.02, 0.02, 0.015, 0.015], 4);
  plate(mb, outline, [0, 0, 0.002], [1, 0, 0], [0, 1, 0], 0.03, () => trimUV(TC.wheelBody));
  // the face panel, proud of the body by a few mm: its step catches the light round the edge
  const FACE: V2[] = [
    [-0.094, -0.058],
    [-0.106, 0.0],
    [-0.1, 0.064],
    [0.1, 0.064],
    [0.106, 0.0],
    [0.094, -0.058],
    [0.045, -0.07],
    [-0.045, -0.07],
  ];
  plate(mb, roundPoly(FACE, 0.014, 3), [0, 0, -0.0145], [1, 0, 0], [0, 1, 0], 0.006, () => trimUV(TC.wheelFace));
  const FZ = -0.0175; // face surface
  // grips: bent, fatter at the bottom, a team-colour band where the thumbs rest
  for (const side of [1, -1]) {
    const path = crPath([
      [0.126 * side, 0.064, 0.006],
      [0.141 * side, 0.032, 0.008],
      [0.145 * side, -0.01, 0.01],
      [0.134 * side, -0.052, 0.01],
    ], 10);
    const n = path.length - 1;
    tube(mb, path, (i) => 0.019 + 0.005 * Math.sin((Math.PI * i) / n), 16, trimUV(TC.grip), [0, 0, 1]);
    // paddles behind the grips (their tips show past the body's top corners)
    const pad = roundPoly([[0, -0.03], [0.05, -0.02], [0.06, 0.03], [0.02, 0.05], [0, 0.04]], 0.008, 2).map(([x, y]) => [x * side + 0.075 * side, y] as V2);
    plate(mb, pad, [0, 0.02, 0.028], [1, 0, 0], [0, 1, 0], 0.004, () => trimUV(TC.blackGloss));
  }
  // display (faces −Z) + LED strip
  const quad = (cx: number, cy: number, w: number, h: number, z: number, uvf: (a: number, b: number) => V2) => {
    const p: V3[] = [
      [cx - w / 2, cy - h / 2, z],
      [cx + w / 2, cy - h / 2, z],
      [cx + w / 2, cy + h / 2, z],
      [cx - w / 2, cy + h / 2, z],
    ];
    // viewed from −Z (driver side): screen-right = −X → a = 1 at −X
    const i0 = mb.vert(p[0], [0, 0, -1], uvf(1, 0));
    const i1 = mb.vert(p[1], [0, 0, -1], uvf(0, 0));
    const i2 = mb.vert(p[2], [0, 0, -1], uvf(0, 1));
    const i3 = mb.vert(p[3], [0, 0, -1], uvf(1, 1));
    mb.tri(i0, i2, i1);
    mb.tri(i0, i3, i2);
  };
  // screen in a gloss bezel
  plate(mb, roundPoly([[-0.052, -0.017], [0.052, -0.017], [0.052, 0.043], [-0.052, 0.043]], 0.006, 2), [0, 0, FZ - 0.0015], [1, 0, 0], [0, 1, 0], 0.003, () => trimUV(TC.blackGloss));
  quad(0, 0.013, 0.094, 0.052, FZ - 0.0032, (a, bb) => trimRectUV(R_DISPLAY, a, bb));
  plate(mb, roundPoly([[-0.07, 0.049], [0.07, 0.049], [0.07, 0.061], [-0.07, 0.061]], 0.004, 2), [0, 0, FZ - 0.001], [1, 0, 0], [0, 1, 0], 0.002, () => trimUV(TC.blackGloss));
  quad(0, 0.055, 0.132, 0.009, FZ - 0.0022, (a, bb) => trimRectUV(R_LEDS, a, bb));
  // dome buttons in black bezels
  const btn = [TC.btnRed, TC.btnYellow, TC.btnBlue, TC.btnGreen, TC.btnWhite, TC.btnWhite];
  const BTN: [number, number][] = [
    [-0.078, 0.036],
    [0.078, 0.036],
    [-0.085, 0.008],
    [0.085, 0.008],
    [-0.066, -0.03],
    [0.066, -0.03],
  ];
  BTN.forEach(([x, y], k) => {
    const g = new THREE.CylinderGeometry(0.0095, 0.0105, 0.004, 16);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, FZ - 0.002);
    mb.addGeometry(g, undefined, trimUV(TC.blackGloss));
    g.dispose();
    ellipsoid(mb, [x, y, FZ - 0.004], [0.0072, 0.0072, 0.0032], 14, 7, trimUV(btn[k]));
  });
  // anodised rotaries: knurled drums with a pointer
  const ROT: [number, number, number][] = [
    [-0.036, -0.036, 0.4],
    [0.036, -0.036, -0.6],
    [-0.05, -0.058, 1.2],
    [0.05, -0.058, -0.2],
  ];
  for (const [x, y, ang] of ROT) {
    const g = new THREE.CylinderGeometry(0.0105, 0.0105, 0.009, 18);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, FZ - 0.0045);
    mb.addGeometry(g, undefined, trimUV(TC.dial));
    g.dispose();
    box(mb, [x + Math.sin(ang) * 0.005, y + Math.cos(ang) * 0.005, FZ - 0.0092], [0.0018, 0.0075, 0.0008], trimUV(TC.btnWhite), new THREE.Euler(0, 0, -ang));
  }
  // centre toggles under the screen
  for (const x of [-0.016, 0, 0.016]) box(mb, [x, -0.03, FZ - 0.004], [0.008, 0.013, 0.006], trimUV(TC.darkMetal));
  // quick-release hub
  const g = new THREE.CylinderGeometry(0.022, 0.026, 0.04, 16);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.035);
  mb.addGeometry(g, undefined, trimUV(TC.blackSatin));
  g.dispose();
}

/**
 * The driver's hands on the wheel (pivot-local like the wheel, so they turn with it): a gloved fist
 * round each grip, fingers over the front, the thumb on the face beside the rotaries, the cuff and
 * the first of the forearm toward the elbow. Driver material; drawn with the driver, and on its own
 * for the onboard cameras inside the cockpit (the driver's hands are in every onboard picture).
 */
function hands(mb: MB) {
  const glove = drvCellUV(DC.glove);
  const sleeve = drvCellUV(DC.suit2);
  for (const side of [1, -1]) {
    const X = (x: number) => x * side;
    // fist round the grip (its axis near vertical in the wheel's plane), knuckles over the front
    ellipsoid(mb, [X(0.142), 0.004, 0.012], [0.031, 0.05, 0.035], 14, 10, glove, new THREE.Euler(0, 0, -0.08 * side));
    ellipsoid(mb, [X(0.133), 0.0, 0.036], [0.03, 0.044, 0.016], 12, 8, glove, new THREE.Euler(0, 0, -0.08 * side));
    // thumb along the face toward the buttons
    ellipsoid(mb, [X(0.111), 0.024, -0.022], [0.024, 0.0105, 0.011], 10, 6, glove, new THREE.Euler(0, 0, 0.4 * side));
    // wrist, cuff and forearm heading back to the elbow (the arm's own tube meets it there)
    const wrist: V3 = [X(0.148), -0.004, -0.03];
    const elbow: V3 = [X(0.2), 0.058, -0.215];
    tube(mb, [wrist, lerp3(wrist, elbow, 0.12)], 0.03, 12, glove, [0, 1, 0]);
    tube(mb, [lerp3(wrist, elbow, 0.1), lerp3(wrist, elbow, 0.62)], (i) => (i === 0 ? 0.034 : 0.041), 12, sleeve, [0, 1, 0]);
  }
}

// ------------------------------------------------------------------------------------ decals (driver material)
function decals(mb: MB) {
  // nose number on the nose top, read from the front
  const patch = (zA: number, zB: number, sA: number, sB: number, nu: number, nv: number, uvf: (a: number, b: number) => V2, lift = 0.0025) => {
    const rows: V3[][] = [];
    const N: V3[][] = [];
    for (let i = 0; i <= nv; i++) {
      const z = lerp(zA, zB, i / nv);
      const pr = profileAt(z);
      const row: V3[] = [];
      const nr: V3[] = [];
      for (let j = 0; j <= nu; j++) {
        const s = lerp(sA, sB, j / nu);
        const h = hullPoint(z, s, pr);
        row.push(add3(h.p, scl3(h.n, lift)));
        nr.push(h.n);
      }
      rows.push(row);
      N.push(nr);
    }
    const base = mb.count;
    for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) mb.vert(rows[i][j], N[i][j], uvf(j / nu, i / nv));
    for (let i = 0; i < nv; i++)
      for (let j = 0; j < nu; j++) {
        const a = base + i * (nu + 1) + j;
        const bb = a + nu + 1;
        // orientation: check against normal
        const pa = rows[i][j];
        const pb = rows[i + 1][j];
        const pd = rows[i][j + 1];
        const fn = cross3(sub3(pb, pa), sub3(pd, pa));
        if (dot3(fn, N[i][j]) > 0) {
          mb.tri(a, bb, a + 1);
          mb.tri(bb, bb + 1, a + 1);
        } else {
          mb.tri(a, a + 1, bb);
          mb.tri(bb, a + 1, bb + 1);
        }
      }
  };
  // nose number: from the front, reading direction +X (s increasing), up = toward the rear (z decreasing)
  patch(2.55, 2.33, -0.085, 0.085, 6, 4, (a, b) => drvUV(R_NUM_NOSE, a, b));

  // fin numbers (both faces)
  const FZc = -1.2;
  const FYc = 0.79;
  const w = 0.3;
  const h = 0.15;
  for (const side of [1, -1]) {
    const x = 0.0055 * side;
    const p: V3[] = [
      [x, FYc - h / 2, FZc + w / 2],
      [x, FYc - h / 2, FZc - w / 2],
      [x, FYc + h / 2, FZc - w / 2],
      [x, FYc + h / 2, FZc + w / 2],
    ];
    const n: V3 = [side, 0, 0];
    // left (+X): reading toward −Z; right: toward +Z
    const r = side > 0 ? R_NUM_FIN_L : R_NUM_FIN_R;
    const ua = (z: number) => (side > 0 ? (FZc + w / 2 - z) / w : (z - (FZc - w / 2)) / w);
    const ids = p.map((q) => mb.vert(q, n, drvUV(r, ua(q[2]), (q[1] - (FYc - h / 2)) / h)));
    const fn = cross3(sub3(p[1], p[0]), sub3(p[2], p[0]));
    if (dot3(fn, n) > 0) {
      mb.tri(ids[0], ids[1], ids[2]);
      mb.tri(ids[0], ids[2], ids[3]);
    } else {
      mb.tri(ids[0], ids[2], ids[1]);
      mb.tri(ids[0], ids[3], ids[2]);
    }
  }
  // driver code on the outer faces of the halo side tubes (wrapped on the tube section)
  const n = 44;
  const path = haloPath(n);
  const fr = framesAlong(path, () => [0, 1, 0]);
  for (const side of [1, -1]) {
    const ids: number[] = [];
    const sel: number[] = [];
    for (let i = 0; i < n; i++) if (path[i][0] * side > 0.2 && path[i][2] > -0.03 && path[i][2] < 0.26) sel.push(i);
    if (sel.length < 2) continue;
    const zs = sel.map((i) => path[i][2]);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    const nv = 4;
    const base = mb.count;
    for (const i of sel) {
      const a = side > 0 ? (z1 - path[i][2]) / (z1 - z0) : (path[i][2] - z0) / (z1 - z0);
      const r = side > 0 ? R_CODE_L : R_CODE_R;
      for (let k = 0; k <= nv; k++) {
        const psi = lerp(-0.75, 0.75, k / nv);
        const off = add3(scl3(fr[i].d, Math.sin(psi) * 0.022 * 1.06), scl3(fr[i].u, Math.cos(psi) * 0.03 * 1.06));
        const nn = norm3(add3(scl3(fr[i].d, Math.sin(psi) / 0.022), scl3(fr[i].u, Math.cos(psi) / 0.03)));
        ids.push(mb.vert(add3(path[i], off), nn, drvUV(r, a, k / nv)));
      }
    }
    for (let q = 0; q < sel.length - 1; q++) {
      for (let k = 0; k < nv; k++) {
        const a = base + q * (nv + 1) + k;
        const b2 = a + nv + 1;
        const pa: V3 = [mb.pos[a * 3], mb.pos[a * 3 + 1], mb.pos[a * 3 + 2]];
        const pb: V3 = [mb.pos[b2 * 3], mb.pos[b2 * 3 + 1], mb.pos[b2 * 3 + 2]];
        const pc: V3 = [mb.pos[(a + 1) * 3], mb.pos[(a + 1) * 3 + 1], mb.pos[(a + 1) * 3 + 2]];
        const fn = cross3(sub3(pb, pa), sub3(pc, pa));
        if (fn[0] * side > 0) {
          mb.tri(a, b2, a + 1);
          mb.tri(a + 1, b2, b2 + 1);
        } else {
          mb.tri(a, a + 1, b2);
          mb.tri(a + 1, b2 + 1, b2);
        }
      }
    }
    void ids;
  }
}

// ------------------------------------------------------------------------------------ suspension
/**
 * The suspension links (left side; the right mirrors x). Each runs from a chassis pickup (body
 * space: it moves with the sprung body) to an upright pickup (wheel-centre local, +x outboard: it
 * moves with the corner, and at the front turns with the steering). Near cars draw them as live
 * instanced links (CarModel keeps both ends attached every frame); the far level merges them at rest.
 */
export interface SuspLeg {
  front: boolean;
  inner: V3;
  outer: V3;
  chord: number;
  thick: number;
}
export const SUSP_LEGS: SuspLeg[] = [
  // front: upper wishbone (wide A), lower wishbone, pushrod up to the rocker in the chassis top,
  // track rod in line with the upper wishbone's front leg
  { front: true, inner: [0.165, 0.515, 1.93], outer: [-0.085, 0.185, 0.016], chord: 0.05, thick: 0.014 },
  { front: true, inner: [0.215, 0.545, 1.4], outer: [-0.085, 0.185, -0.016], chord: 0.05, thick: 0.014 },
  { front: true, inner: [0.13, 0.215, 1.97], outer: [-0.07, -0.17, 0.016], chord: 0.055, thick: 0.016 },
  { front: true, inner: [0.2, 0.19, 1.33], outer: [-0.07, -0.17, -0.016], chord: 0.055, thick: 0.016 },
  { front: true, inner: [0.13, 0.555, 1.62], outer: [-0.09, -0.14, -0.03], chord: 0.04, thick: 0.022 },
  { front: true, inner: [0.16, 0.5, 1.83], outer: [-0.1, 0.16, 0.1], chord: 0.04, thick: 0.013 },
  // rear: upper and lower wishbones, pullrod down to the gearbox, toe link
  { front: false, inner: [0.16, 0.505, -1.42], outer: [-0.1, 0.178, 0.016], chord: 0.055, thick: 0.016 },
  { front: false, inner: [0.14, 0.49, -1.98], outer: [-0.1, 0.178, -0.016], chord: 0.055, thick: 0.016 },
  { front: false, inner: [0.2, 0.17, -1.38], outer: [-0.07, -0.18, 0.016], chord: 0.055, thick: 0.016 },
  { front: false, inner: [0.13, 0.19, -1.98], outer: [-0.07, -0.18, -0.016], chord: 0.055, thick: 0.016 },
  { front: false, inner: [0.15, 0.17, -1.56], outer: [-0.12, 0.155, 0.04], chord: 0.04, thick: 0.02 },
  { front: false, inner: [0.14, 0.3, -1.9], outer: [-0.09, 0.0, -0.13], chord: 0.04, thick: 0.014 },
];
/** a leg's upright pickup at rest, body/root space */
export function legOuterAtRest(l: SuspLeg, side: number): V3 {
  const wx = (l.front ? TRACK_F : TRACK_R) / 2;
  const wz = l.front ? Z_FRONT_AXLE : Z_REAR_AXLE;
  return [(wx + l.outer[0]) * side, WHEEL_R + l.outer[1], wz + l.outer[2]];
}
/**
 * One link of unit length along +Z (0 … 1), aero section: chord 1 along X, thickness 1 along Y
 * (the rig scales each instance to its leg's chord, thickness and length).
 */
function armUnit(mb: MB, level: Level) {
  const n = [10, 6][level] ?? 6;
  const sec = aeroSection(n);
  const st: SweepSt[] = [0, 0.5, 1].map((z) => ({ o: [0, 0, z] as V3, d: [1, 0, 0] as V3, u: [0, 1, 0] as V3, sx: 0.5, sy: 0.5 }));
  sweep(mb, st, sec, (_i, _j, p) => [p[2] * 12, p[0] * 0.8]);
}
function suspension(carbon: MB, trim: MB, level: Level) {
  const n = 4;
  for (const side of [1, -1]) {
    // (near levels draw the links live: CarModel)
    if (level === 2) {
      for (const l of SUSP_LEGS) {
        if (l.chord < 0.05) continue;
        const a: V3 = [l.inner[0] * side, l.inner[1], l.inner[2]];
        arm(carbon, a, legOuterAtRest(l, side), l.chord, l.thick, n, metricUV);
      }
    }
    // rear driveshaft
    if (level < 2) tube(trim, [[0.12 * side, 0.34, Z_REAR_AXLE], [0.62 * side, 0.34, Z_REAR_AXLE]], 0.024, 8, trimUV(TC.darkMetal), [0, 1, 0]);
  }
}

// ------------------------------------------------------------------------------------ wheels (local: +X outboard)
function tyreProfile(w: number): V2[] {
  const h = w / 2;
  const pts: V2[] = [];
  // inner bead → inner sidewall → tread → outer sidewall → outer bead   (r, x)
  const side = (sgn: number, rev: boolean) => {
    const s: V2[] = [
      [RIM_R + 0.004, sgn * (h - 0.012)],
      [WHEEL_R - 0.098, sgn * (h + 0.002)],
      [WHEEL_R - 0.06, sgn * (h + 0.006)],
      [WHEEL_R - 0.03, sgn * (h + 0.002)],
      [WHEEL_R - 0.013, sgn * (h - 0.012)],
      [WHEEL_R - 0.004, sgn * (h - 0.03)],
    ];
    return rev ? s.reverse() : s;
  };
  pts.push(...side(-1, false));
  const nT = 6;
  for (let i = 0; i <= nT; i++) pts.push([WHEEL_R, lerp(-(h - 0.048), h - 0.048, i / nT)]);
  pts.push(...side(1, true));
  return pts;
}

function wheelSpin(mb: MB, w: number, level: Level) {
  const seg = [72, 40, 20][level];
  const prof = tyreProfile(w);
  // uv per profile point
  const h = w / 2;
  const uvp = prof.map(([r, x]) => {
    if (r >= WHEEL_R - 0.001) return { kind: 1, t: (x + h) / w };
    return { kind: 0, t: (r - SIDEWALL_R0) / (SIDEWALL_R1 - SIDEWALL_R0) };
  });
  // lathe with angle rows; sidewall uv u = angle
  const P: V3[][] = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    P.push(prof.map(([r, x]) => [x, r * Math.cos(a), r * Math.sin(a)] as V3));
  }
  mb.grid(
    P,
    (j, i) => {
      const u = 1 - j / seg; // reading clockwise seen from outside (+X)
      const q = uvp[i];
      if (q.kind === 1) return wheelRectUV(R_TREAD, u, q.t);
      return wheelRectUV(R_SIDEWALL, u, Math.min(1, Math.max(0, q.t)));
    },
    { orient: true },
  );
  if (level === 2) {
    // flat face with a blurred-rim image (outer only) + inner dark disc
    const g = new THREE.CircleGeometry(RIM_R + 0.006, 16);
    g.rotateY(Math.PI / 2);
    g.translate(h - 0.01, 0, 0);
    mb.addGeometry(g, undefined, (p) => wheelRectUV(R_RIMFACE, 0.5 - p[2] / (2 * (RIM_R + 0.006)), 0.5 + p[1] / (2 * (RIM_R + 0.006))));
    g.dispose();
    const g2 = new THREE.CircleGeometry(RIM_R + 0.006, 12);
    g2.rotateY(-Math.PI / 2);
    g2.translate(-h + 0.01, 0, 0);
    mb.addGeometry(g2, undefined, wheelCellUV(WC.rubber));
    g2.dispose();
    return;
  }
  // rim barrel (visible inner surface), outer lip, spokes, hub, nut
  const rs = level === 0 ? 40 : 24;
  const barrel: V3[][] = [];
  for (let j = 0; j <= rs; j++) {
    const a = (j / rs) * Math.PI * 2;
    barrel.push([
      [h - 0.03, (RIM_R - 0.004) * Math.cos(a), (RIM_R - 0.004) * Math.sin(a)],
      [-h + 0.02, (RIM_R - 0.004) * Math.cos(a), (RIM_R - 0.004) * Math.sin(a)],
    ]);
  }
  const bn = barrel.map((r) => r.map((p) => norm3([0, -p[1], -p[2]])));
  mb.grid(barrel, () => wheelCellUV(WC.barrel), { normals: bn, orient: false });
  // lip: annulus facing +X plus inner step
  const lip: V3[][] = [];
  for (let j = 0; j <= rs; j++) {
    const a = (j / rs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    lip.push([
      [h - 0.012, (RIM_R + 0.01) * c, (RIM_R + 0.01) * s],
      [h - 0.008, (RIM_R - 0.002) * c, (RIM_R - 0.002) * s],
      [h - 0.03, (RIM_R - 0.006) * c, (RIM_R - 0.006) * s],
    ]);
  }
  mb.grid(lip, () => wheelCellUV(WC.rimLip));
  // 2022+ wheel cover: a shallow dished disc over the rim face, printed in the rim-face
  // image (same art as the far LOD), open in the middle round the wheel nut
  const spokeX = h - 0.045;
  {
    const R = RIM_R + 0.006;
    const prof: V2[] = [];
    const nr = level === 0 ? 7 : 4;
    for (let i = 0; i <= nr; i++) {
      const t = i / nr;
      const r = lerp(0.043, RIM_R - 0.002, t);
      prof.push([r, h - 0.036 + 0.02 * t * t]);
    }
    const cs = level === 0 ? 48 : 28;
    const P: V3[][] = [];
    for (let j = 0; j <= cs; j++) {
      const a = (j / cs) * Math.PI * 2;
      P.push(prof.map(([r, x]) => [x, r * Math.cos(a), r * Math.sin(a)] as V3));
    }
    mb.grid(P, (j, i) => {
      const p = P[j][i];
      return wheelRectUV(R_RIMFACE, 0.5 - p[2] / (2 * R), 0.5 + p[1] / (2 * R));
    }, { flip: true }); // (angle × radius winding faces inboard; flip → +X)
    // the nut well
    const well: V3[][] = [];
    for (let j = 0; j <= cs; j++) {
      const a = (j / cs) * Math.PI * 2;
      well.push([
        [h - 0.036, 0.043 * Math.cos(a), 0.043 * Math.sin(a)],
        [spokeX + 0.02, 0.043 * Math.cos(a), 0.043 * Math.sin(a)],
      ]);
    }
    mb.grid(well, () => wheelCellUV(WC.hub));
  }
  // hub + nut
  cylinderX(mb, [spokeX + 0.005, 0, 0], 0.062, 0.03, 20, wheelCellUV(WC.hub));
  const nut = new THREE.CylinderGeometry(0.034, 0.036, 0.04, 6);
  nut.rotateZ(Math.PI / 2);
  nut.translate(spokeX + 0.035, 0, 0);
  mb.addGeometry(nut, undefined, wheelCellUV(WC.nut));
  nut.dispose();
  cylinderX(mb, [spokeX + 0.057, 0, 0], 0.012, 0.012, 8, wheelCellUV(WC.valve));
}

/** non-spinning corner: upright, brake disc (glows), caliper, brake duct drum — trim material */
function cornerAssembly(mb: MB, w: number, front: boolean, level: Level) {
  const h = w / 2;
  const rO = front ? 0.166 : 0.142;
  const rI = front ? 0.1 : 0.092;
  const th0 = front ? 0.034 : 0.03;
  const dx = front ? 0.0 : -0.02;
  const seg = [40, 24, 12][level];
  // disc: two faces + outer edge (lathe)
  const prof: V2[] = [
    [rI, dx - th0 / 2],
    [rO, dx - th0 / 2],
    [rO, dx + th0 / 2],
    [rI, dx + th0 / 2],
  ];
  const P: V3[][] = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    P.push(prof.map(([r, x]) => [x, r * Math.cos(a), r * Math.sin(a)] as V3));
  }
  mb.grid(P, (_j, i) => trimUV(i === 1 || i === 2 ? TC.discEdge : TC.disc), { orient: true, wrapCols: true });
  // caliper: arc block clasping the disc (fronts: rear-top, rears: front-top). θ from +Y toward +Z
  const cal: V3[][] = [];
  const cs = level === 0 ? 8 : 4;
  const thc = front ? -0.85 : 0.85;
  for (let j = 0; j <= cs; j++) {
    const th = thc + (j / cs - 0.5) * 1.0;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const row: V3[] = [];
    for (const [r, x] of [
      [rO - 0.045, dx - th0 / 2 - 0.02],
      [rO + 0.022, dx - th0 / 2 - 0.02],
      [rO + 0.022, dx + th0 / 2 + 0.02],
      [rO - 0.045, dx + th0 / 2 + 0.02],
    ] as V2[])
      row.push([x, r * c, r * s]);
    cal.push(row);
  }
  mb.grid(cal, () => trimUV(TC.caliper), { orient: true, wrapCols: true });
  {
    const t0 = thc - 0.5;
    const t1 = thc + 0.5;
    mb.cap(cal[0], [0, Math.sin(t0), -Math.cos(t0)] as V3, trimUV(TC.caliper));
    mb.cap(cal[cal.length - 1], [0, -Math.sin(t1), Math.cos(t1)] as V3, trimUV(TC.caliper));
  }
  // upright: reaching up and down to the wishbone pickups
  box(mb, [-0.075, 0.0, 0], [0.05, 0.4, 0.085], trimUV(TC.darkMetal));
  box(mb, [-0.045, 0.0, 0], [0.05, 0.1, 0.1], trimUV(TC.darkMetal));
  // the links' clevis mounts, standing proud of the brake duct's inboard face so every link
  // visibly ends on the upright (the rig keeps the links' ends on these points)
  if (level < 2) {
    const ex = -h - 0.004;
    const legs = SUSP_LEGS.filter((l) => l.front === front);
    const seen = new Set<string>();
    for (const l of legs) {
      const key = `${l.outer[1].toFixed(2)}:${Math.round(l.outer[2] / 0.05)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pair = legs.filter((q) => Math.abs(q.outer[1] - l.outer[1]) < 0.005 && Math.abs(q.outer[2] - l.outer[2]) < 0.05);
      const zc = pair.reduce((a, q) => a + q.outer[2], 0) / pair.length;
      box(mb, [(ex + l.outer[0]) / 2, l.outer[1], zc], [Math.abs(ex - l.outer[0]) + 0.03, 0.032, pair.length > 1 ? 0.07 : 0.036], trimUV(TC.darkMetal));
    }
    if (front) {
      // steering arm: from the upright out to the track rod's pickup
      box(mb, [-0.09, 0.14, 0.05], [0.028, 0.03, 0.11], trimUV(TC.darkMetal));
    }
  }
  // brake duct drum (inboard) + inlet scoop
  if (level < 2) {
    const drum: V3[][] = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      drum.push([
        [-h + 0.02, 0.2 * c, 0.2 * s],
        [-0.05, 0.2 * c, 0.2 * s],
        [-0.03, 0.185 * c, 0.185 * s],
      ]);
    }
    mb.grid(drum, () => trimUV(TC.ductBlack), { flip: true });
    // inner face disc of the drum
    const g = new THREE.RingGeometry(0.07, 0.2, seg);
    g.rotateY(Math.PI / 2);
    g.translate(-h + 0.02, 0, 0);
    mb.addGeometry(g, undefined, trimUV(TC.ductBlack));
    g.dispose();
    if (front) {
      const sc: V3[][] = [];
      for (const [z, s] of [
        [0.34, 1.0],
        [0.2, 0.8],
      ] as V2[])
        sc.push(ellipse(10).map(([a, bb]) => [-h + 0.02 + a * 0.035 * s, -0.08 + bb * 0.06 * s, z] as V3));
      mb.grid(sc, () => trimUV(TC.ductBlack), { wrapCols: true, orient: true });
      mb.cap(sc[0], [0, 0, 1], trimUV(TC.inletDark));
    } else {
      // the rear duct's inlet: a tall scoop inboard of the wheel, ahead of the axle, mouth to the
      // airflow, its throat turning into the drum
      const sc: V3[][] = [];
      for (const [z, s, dx] of [
        [0.32, 1.0, 0],
        [0.23, 0.92, 0.004],
        [0.12, 0.7, 0.02],
      ] as V3[])
        sc.push(roundedRect(12, 0.5).map(([a, bb]) => [-h - 0.034 + dx + a * 0.026 * s, 0.07 + bb * 0.075 * s, z] as V3));
      mb.grid(sc, () => trimUV(TC.ductBlack), { wrapCols: true, orient: true });
      mb.cap(sc[0], [0, 0, 1], trimUV(TC.inletDark));
      mb.cap(sc[2], [0, 0, -1], trimUV(TC.ductBlack));
    }
  }
}

function blurDisc(mb: MB, w: number) {
  const g = new THREE.CircleGeometry(WHEEL_R - 0.006, 40);
  g.rotateY(Math.PI / 2); // normal +X
  g.translate(w / 2 + 0.009, 0, 0);
  const R = WHEEL_R - 0.006;
  // viewed from +X: screen right = −Z
  mb.addGeometry(g, undefined, (p) => [0.5 - p[2] / (2 * R), 0.5 + p[1] / (2 * R)]);
  g.dispose();
}

// ================================================================================================ public
export interface CarGeoLevel {
  body: { paint: THREE.BufferGeometry; carbon: THREE.BufferGeometry; trim: THREE.BufferGeometry; driver: THREE.BufferGeometry | null; head: THREE.BufferGeometry | null; decals: THREE.BufferGeometry | null };
  /** breakable parts, body space */
  parts: Record<PartId, { paint: THREE.BufferGeometry | null; carbon: THREE.BufferGeometry | null; trim: THREE.BufferGeometry | null }>;
  flap: THREE.BufferGeometry;
  /** one unit suspension link (near levels: the rig instances it per leg) */
  armUnit: THREE.BufferGeometry | null;
  /** the front wing's active flaps, left and right, pivot-local (FW_FLAP_PIVOT) */
  fwFlaps: [THREE.BufferGeometry, THREE.BufferGeometry];
  steer: THREE.BufferGeometry | null;
  /** the driver's gloved hands on the wheel, steering-pivot local (driver material; nearest level only) */
  hands: THREE.BufferGeometry | null;
  unsprung: { carbon: THREE.BufferGeometry; trim: THREE.BufferGeometry; blurRear: THREE.BufferGeometry | null };
  frontAssy: THREE.BufferGeometry | null;
  blurFront: THREE.BufferGeometry | null;
  wheelF: THREE.BufferGeometry | null;
  wheelR: THREE.BufferGeometry | null;
  spokesF: THREE.BufferGeometry | null;
  spokesR: THREE.BufferGeometry | null;
  wheelsMerged: THREE.BufferGeometry | null;
  triangles: number;
}

export function buildCarGeometry(level: Level): CarGeoLevel {
  const pm = (): PartMB => ({ paint: new MB(true), carbon: new MB(), trim: new MB() });
  const b: Buckets = { paint: new MB(true), carbon: new MB(), trim: new MB(), driver: new MB(), head: new MB(), decals: new MB(), parts: { fwL: pm(), fwR: pm(), rw: pm() } };
  buildHull(b.paint, level);
  frontWing(b, level);
  rearWing(b, level);
  floorAndDiffuser(b, level);
  halo(b, level);
  airboxAndFin(b, level);
  mirrors(b, level);
  noseDetails(b, level);
  exhaustAndLight(b, level);
  cockpitBits(b, level);
  driver(b, level);
  if (level < 2) decals(b.decals);

  const flap = new MB(true);
  drsFlap(flap, level);
  const fwFlapL = new MB(true);
  frontFlap(fwFlapL, level, 1);
  const fwFlapR = new MB(true);
  frontFlap(fwFlapR, level, -1);

  let steer: MB | null = null;
  let handsMB: MB | null = null;
  if (level === 0) {
    steer = new MB();
    steeringWheel(steer);
    handsMB = new MB();
    hands(handsMB);
  }

  const uc = new MB();
  const ut = new MB();
  suspension(uc, ut, level);
  // rear corners (static relative to the unsprung frame)
  let blurRear: MB | null = null;
  if (level < 2) {
    const rc = new MB();
    cornerAssembly(rc, TYRE_W_R, false, level);
    const rg = rc.build();
    for (const side of [1, -1]) {
      const m = new THREE.Matrix4().makeTranslation((TRACK_R / 2) * side, WHEEL_R, Z_REAR_AXLE);
      if (side < 0) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
      ut.addGeometry(rg, m);
    }
    rg.dispose();
    blurRear = new MB();
    const bd = new MB();
    blurDisc(bd, TYRE_W_R);
    const bg = bd.build();
    for (const side of [1, -1]) {
      const m = new THREE.Matrix4().makeTranslation((TRACK_R / 2) * side, WHEEL_R, Z_REAR_AXLE);
      if (side < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      blurRear.addGeometry(bg, m);
    }
    bg.dispose();
  }

  let frontAssy: MB | null = null;
  let blurFront: MB | null = null;
  let wheelF: MB | null = null;
  let wheelR: MB | null = null;
  let wheelsMerged: MB | null = null;
  if (level < 2) {
    frontAssy = new MB();
    cornerAssembly(frontAssy, TYRE_W_F, true, level);
    blurFront = new MB();
    blurDisc(blurFront, TYRE_W_F);
    wheelF = new MB();
    wheelSpin(wheelF, TYRE_W_F, level);
    wheelR = new MB();
    wheelSpin(wheelR, TYRE_W_R, level);
  } else {
    wheelsMerged = new MB();
    const wf = new MB();
    wheelSpin(wf, TYRE_W_F, 2);
    const wr = new MB();
    wheelSpin(wr, TYRE_W_R, 2);
    const gf = wf.build();
    const gr = wr.build();
    for (const [g, x, z] of [
      [gf, TRACK_F / 2, Z_FRONT_AXLE],
      [gr, TRACK_R / 2, Z_REAR_AXLE],
    ] as [THREE.BufferGeometry, number, number][]) {
      for (const side of [1, -1]) {
        const m = new THREE.Matrix4().makeTranslation(x * side, WHEEL_R, z);
        if (side < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        wheelsMerged.addGeometry(g, m);
      }
    }
    gf.dispose();
    gr.dispose();
  }

  // driver sheet: full (helmet + body + decals) and decals-only variant for setDriverVisible(false)
  let driverAll: THREE.BufferGeometry | null = null;
  let decalsOnly: THREE.BufferGeometry | null = null;
  if (b.driver.count) {
    const dAll = new MB();
    const g1 = b.driver.build();
    dAll.addGeometry(g1);
    g1.dispose();
    if (b.decals.count) {
      const g2 = b.decals.build();
      dAll.addGeometry(g2);
      decalsOnly = g2;
    }
    driverAll = dAll.build();
  }
  const out: CarGeoLevel = {
    body: { paint: b.paint.build(), carbon: b.carbon.build(), trim: b.trim.build(), driver: driverAll, head: b.head.count ? b.head.build() : null, decals: decalsOnly },
    parts: Object.fromEntries(
      PART_IDS.map((k) => {
        const q = b.parts[k];
        return [k, { paint: q.paint.count ? q.paint.build() : null, carbon: q.carbon.count ? q.carbon.build() : null, trim: q.trim.count ? q.trim.build() : null }];
      }),
    ) as CarGeoLevel['parts'],
    flap: flap.build(),
    fwFlaps: [fwFlapL.build(), fwFlapR.build()],
    armUnit: level < 2 ? (() => {
      const am = new MB();
      armUnit(am, level);
      return am.build();
    })() : null,
    steer: steer ? steer.build() : null,
    hands: handsMB ? handsMB.build() : null,
    unsprung: { carbon: uc.build(), trim: ut.build(), blurRear: blurRear ? blurRear.build() : null },
    frontAssy: frontAssy ? frontAssy.build() : null,
    blurFront: blurFront ? blurFront.build() : null,
    wheelF: wheelF ? wheelF.build() : null,
    wheelR: wheelR ? wheelR.build() : null,
    spokesF: null,
    spokesR: null,
    wheelsMerged: wheelsMerged ? wheelsMerged.build() : null,
    triangles: 0,
  };
  const tri = (g: THREE.BufferGeometry | null, k = 1) => (g ? ((g.index ? g.index.count : g.getAttribute('position').count) / 3) * k : 0);
  out.triangles =
    PART_IDS.reduce((n, k) => n + tri(out.parts[k].paint) + tri(out.parts[k].carbon) + tri(out.parts[k].trim), 0) +
    tri(out.body.paint) + tri(out.body.carbon) + tri(out.body.trim) + tri(out.body.driver) + tri(out.body.head) + tri(out.flap) + tri(out.fwFlaps[0]) + tri(out.fwFlaps[1]) + tri(out.steer) + tri(out.hands) +
    tri(out.unsprung.carbon) + tri(out.unsprung.trim) + tri(out.frontAssy, 2) + tri(out.wheelF, 2) + tri(out.wheelR, 2) + tri(out.spokesF, 2) + tri(out.spokesR, 2) + tri(out.wheelsMerged) + tri(out.blurFront, 2) + tri(out.unsprung.blurRear);
  return out;
}

export { HULL_FRONT, HULL_REAR };
