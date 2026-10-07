/**
 * The driver's arms and gloved hands (nearest level of detail): what every onboard picture has in
 * it. One skinned mesh for both arms, six bones: upper arm (from the shoulder), forearm (from the
 * elbow) and hand (riding the steering wheel) on each side. The hands are modelled round the
 * wheel's real grips — palm cupped round the outside of the grip, fingers wrapped round its back
 * and resting on the shift paddles, thumbs flat on the face beside the top buttons, as the drivers
 * hold a 2026 wheel — so they sit on the grips at every steering angle (they turn with the wheel;
 * nothing to line up per frame). The elbows are a two-bone IK from the shoulders (CarModel), and the
 * glove's gauntlet blends from the hand to the forearm, so the wrist bends instead of the arms
 * stretching like the old rigid links did.
 *
 * Everything here is built once and shared by every car (the rig and the materials are per car).
 */
import * as THREE from 'three';
import { MB, type V2, type V3, add3, sub3, scl3, cross3, norm3, dot3, len3, lerp, lerp3, crPath, smooth, clamp, gridNormals } from './carMath.ts';
import { GLOVE_W, GLOVE_H, R_GL_BACK, R_GL_PALM, R_GL_FINGER, R_GL_THUMB, R_GL_CUFF, DC, drvCellUV, rectUV, type Rect } from './carLayout.ts';

// ------------------------------------------------------------------------------------ the wheel (pivot-local)
/** steering wheel pivot (car space) and its rake: rotation about X, top toward the driver */
export const STEER_PIVOT: V3 = [0, 0.605, 0.5];
export const STEER_TILT = -0.42;
/**
 * The left grip's centreline (the right mirrors x) and its radius along it: bent, fatter in the
 * middle where the palm sits. Wheel-local: wheel plane XY, the driver looks along +Z at its face.
 */
export const GRIP_PTS: V3[] = [
  [0.126, 0.064, 0.006],
  [0.141, 0.032, 0.008],
  [0.145, -0.01, 0.01],
  [0.134, -0.052, 0.01],
];
export const gripRadius = (t: number) => 0.019 + 0.005 * Math.sin(Math.PI * t);
/** the face panel's front surface (z), the wheel body's back and the shift paddles' back faces */
export const WHEEL_FACE_Z = -0.0175;
const BODY_BACK_Z = 0.017;
const PADDLE_BACK_Z = 0.03;

const GF = crPath(GRIP_PTS, 129);
interface GripFrame {
  /** centre, radius, axis (up the grip), outward (+x side) and back (+z, away from the driver) */
  c: V3;
  r: number;
  t: V3;
  o: V3;
  f: V3;
}
/** the left grip's cross-section at height y (wheel-local) */
function gripFrame(y: number): GripFrame {
  let k = 0;
  while (k < GF.length - 2 && GF[k + 1][1] > y) k++;
  const a = GF[k];
  const b = GF[k + 1];
  const f = clamp((a[1] - y) / (a[1] - b[1] || 1), 0, 1);
  const c = lerp3(a, b, f);
  const r = gripRadius((k + f) / (GF.length - 1));
  const t = norm3(sub3(a, b));
  const o = norm3(sub3([1, 0, 0], scl3(t, t[0])));
  return { c, r, t, o, f: norm3(cross3(o, t)) };
}
/** a point in a grip frame: o outward, f back, along the grip axis by dt */
const gp = (g: GripFrame, o: number, f: number, dt = 0): V3 => add3(g.c, add3(scl3(g.o, o), add3(scl3(g.f, f), scl3(g.t, dt))));
const deg = Math.PI / 180;

// ------------------------------------------------------------------------------------ lofting
interface Ring {
  o: V3;
  /** section axes: a along d (× sx), b along u (× sy) */
  d: V3;
  u: V3;
  sx: number;
  sy: number;
}
/** rings along a path: d = ref projected ⟂ the path, u = tangent × d */
function ringsAlong(path: V3[], ref: (i: number) => V3, sx: (i: number) => number, sy: (i: number) => number): Ring[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const t = norm3(sub3(b, a));
    let r = ref(i);
    r = sub3(r, scl3(t, dot3(r, t)));
    if (len3(r) < 1e-6) r = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const d = norm3(r);
    return { o: p, d, u: norm3(cross3(t, d)), sx: sx(i), sy: sy(i) };
  });
}
function ellipseSec(n: number, square = 1): V2[] {
  const out: V2[] = [];
  for (let j = 0; j < n; j++) {
    const a = (j / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // (square < 1: a superellipse, flatter faces with rounded edges — a palm's section)
    out.push([Math.sign(c) * Math.abs(c) ** square, Math.sign(s) * Math.abs(s) ** square]);
  }
  return out;
}
/**
 * Loft a closed section through rings, smooth all round. The section is cut into strips at `cuts`
 * (section indices) so each can map to its own region of the glove sheet (a glove's own seams: the
 * back of the hand and the palm, the underside of a finger); the strips share the positions and
 * normals of their edges, so the cut never shows in the shading.
 */
function loft(mb: MB, rings: Ring[], sec: V2[], uv: (strip: number, i: number, f: number) => V2, cuts: number[] = [0]) {
  const n = sec.length;
  const P = rings.map((r) => sec.map(([a, b]) => add3(r.o, add3(scl3(r.d, a * r.sx), scl3(r.u, b * r.sy)))));
  let flip = false;
  let N = gridNormals(P, true, false, flip);
  let score = 0;
  P.forEach((row, i) => {
    const c = scl3(row.reduce((s, p) => add3(s, p), [0, 0, 0] as V3), 1 / n);
    row.forEach((p, j) => (score += dot3(N[i][j], sub3(p, c))));
  });
  if (score < 0) {
    flip = true;
    N = gridNormals(P, true, false, flip);
  }
  const first = mb.count;
  cuts.forEach((c0, s) => {
    const c1 = s + 1 < cuts.length ? cuts[s + 1] : cuts[0] + n;
    const cols: number[] = [];
    for (let j = c0; j <= c1; j++) cols.push(j % n);
    const P2 = P.map((row) => cols.map((j) => row[j]));
    const N2 = N.map((row) => cols.map((j) => row[j]));
    mb.grid(P2, (i, jj) => uv(s, i, jj / (cols.length - 1)), { normals: N2, flip });
  });
  return first;
}
/** close a lofted end with a small fan (fingertips: their last ring is already tiny) */
function capEnd(mb: MB, ring: Ring, sec: V2[], dir: V3, uv: V2) {
  const pts = sec.map(([a, b]) => add3(ring.o, add3(scl3(ring.d, a * ring.sx), scl3(ring.u, b * ring.sy))));
  mb.cap(pts, dir, uv);
}
/** stations rounding off a tube's end like a fingertip: radius cos θ, pushed out sin θ along `dir` */
function domeEnd(path: V3[], scale: number[], dir: V3, r: number, steps = [25, 48, 66, 80]) {
  const tip = path[path.length - 1];
  for (const a of steps) {
    path.push(add3(tip, scl3(dir, r * Math.sin(a * deg))));
    scale.push(Math.cos(a * deg));
  }
}

// ------------------------------------------------------------------------------------ the hand (left, wheel-local)
function gloveUV(r: Rect, a: number, b: number): V2 {
  return rectUV(r, clamp(a), clamp(b), GLOVE_W, GLOVE_H);
}
/** an occluder for the baked glove AO: a capsule, tagged with the part it belongs to */
interface Cap {
  a: V3;
  b: V3;
  r: number;
  part: number;
}

/** the palm's path (knuckles → wrist) in the hand's grip frame, and its proportions */
const HAND_Y = 0.002;
/**
 * How far the hand is turned round the grip toward the driver (deg): the forearms come up from
 * low and outboard, so the wrists are turned in — the back of the hand faces out and back at the
 * driver's eye (the glove's logo reads in the onboard shots), the knuckles on the grip's outer edge.
 */
const HAND_ROLL = -22;
const PALM = (() => {
  const H = gripFrame(HAND_Y);
  const rho = H.r + 0.0125;
  const pts: { o: number; f: number; n: V2; dt: number }[] = [];
  // round the outside of the grip (the palm cupped on it) …
  for (const a0 of [40, 36, 32, 22, 10, -2, -14, -24]) {
    const a = a0 + HAND_ROLL;
    const c = Math.cos(a * deg);
    const s = Math.sin(a * deg);
    pts.push({ o: rho * c, f: rho * s, n: [c, s], dt: 0 });
  }
  // … then on toward the wrist, leaving it as the heel of the hand does: turning out of the grip's
  // tangent toward the forearm (back at the driver, outboard), the heel dropping toward it
  const e = pts[pts.length - 1];
  const ea = (-24 + HAND_ROLL) * deg;
  const tan: V2 = [Math.sin(ea), -Math.cos(ea)];
  const fa: V2 = [0.42, -1];
  let dir: V2 = [tan[0] + fa[0] * 0.75, tan[1] + fa[1] * 0.75];
  const dl = Math.hypot(dir[0], dir[1]);
  dir = [dir[0] / dl, dir[1] / dl];
  // (the section's outward normal turns with it: ⟂ the new heading, on the back's side)
  let n2: V2 = [-dir[1], dir[0]];
  if (n2[0] * e.n[0] + n2[1] * e.n[1] < 0) n2 = [-n2[0], -n2[1]];
  const L = [0.012, 0.024, 0.036, 0.047];
  for (const s of L) {
    const k = s / L[L.length - 1];
    const nn: V2 = [lerp(e.n[0], n2[0], Math.min(1, k * 1.6)), lerp(e.n[1], n2[1], Math.min(1, k * 1.6))];
    const nl = Math.hypot(nn[0], nn[1]);
    pts.push({ o: e.o + dir[0] * s, f: e.f + dir[1] * s, n: [nn[0] / nl, nn[1] / nl], dt: -0.011 * k * k });
  }
  const last = pts[pts.length - 1];
  return { H, pts, wrist: gp(H, last.o, last.f, last.dt) };
})();
/** the glove's wrist (wheel-local, left hand): where the hand bone sits and the gauntlet starts */
export const WRIST_LOCAL: V3 = PALM.wrist;

/** the left hand, wheel-local: palm, four fingers, thumb (glove sheet uvs); AO occluders appended to caps */
function leftHand(mb: MB, caps: Cap[], partOf: number[]) {
  const H = PALM.H;
  const mark = (part: number, from: number) => {
    for (let v = from; v < mb.count; v++) partOf[v] = part;
  };
  // the grip itself (occluder only: the wheel's own mesh draws it)
  for (let i = 0; i + 8 < GF.length; i += 8) caps.push({ a: GF[i], b: GF[i + 8], r: gripRadius((i + 4) / (GF.length - 1)), part: -1 });

  // ---- palm + back of the hand: a flattened superellipse section, wider at the knuckles
  {
    const P = PALM.pts;
    const m = P.length;
    // (station 0, 1: the rounded knuckle end; 2: the knuckle line; m − 1: the wrist)
    const along = (i: number) => clamp((i - 2) / (m - 3));
    const width = (i: number) => (i < 2 ? [0.056, 0.07][i] : lerp(0.077, 0.057, smooth(0, 1, along(i))));
    const thick = (i: number) => (i < 2 ? [0.012, 0.019][i] : 0.023 + 0.006 * Math.sin(Math.PI * Math.min(1, along(i) * 1.25)) - 0.002 * along(i));
    const rings: Ring[] = P.map((q, i) => {
      const o = gp(H, q.o, q.f, 0.0015 + q.dt);
      const u = norm3(add3(scl3(H.o, q.n[0]), scl3(H.f, q.n[1])));
      return { o, d: H.t, u, sx: width(i) / 2, sy: thick(i) / 2 };
    });
    const sec = ellipseSec(24, 0.62);
    const v0 = mb.count;
    // strips: the back (+u: index side → over the back → little-finger side), the palm
    loft(mb, rings, sec, (s, i, f) => {
      const b = 1 - i / (m - 1);
      return s === 0 ? gloveUV(R_GL_BACK, 1 - f, b) : gloveUV(R_GL_PALM, f, b);
    }, [0, 12]);
    capEnd(mb, rings[0], sec, norm3(sub3(rings[0].o, rings[1].o)), gloveUV(R_GL_BACK, 0.5, 0.99));
    mark(0, v0);
    for (const dt of [-0.024, 0, 0.024]) {
      for (let i = 2; i + 3 < m; i += 3) caps.push({ a: add3(rings[i].o, scl3(H.t, dt)), b: add3(rings[i + 3].o, scl3(H.t, dt)), r: 0.012, part: 0 });
    }
  }

  // ---- fingers: index (top) to little finger, each wrapped round the back of the grip from its
  // knuckle; the top three lie on to the shift paddle behind the grip, the little finger curls
  // round under it against the back of the wheel
  const FY = [0.0285, 0.0093, -0.0097, -0.0275];
  const FW = [0.0192, 0.0202, 0.0192, 0.0172];
  const FL = [
    [0.043, 0.026, 0.021],
    [0.047, 0.029, 0.023],
    [0.044, 0.027, 0.022],
    [0.035, 0.021, 0.019],
  ];
  const fsec = ellipseSec(16);
  FY.forEach((y, k) => {
    const G = gripFrame(y);
    const hw = FW[k] / 2;
    const ht = hw * 0.9;
    const onCircle = (rho: number, a: number) => gp(G, rho * Math.cos(a * deg), rho * Math.sin(a * deg));
    const mcpA = 34 + HAND_ROLL;
    const root = onCircle(G.r + 0.0115, 18 + HAND_ROLL);
    const mcp = onCircle(G.r + 0.0125, mcpA);
    const rho = G.r + ht + 0.0007;
    const floor = (k < 3 ? PADDLE_BACK_Z : BODY_BACK_Z) + ht + 0.0007;
    let ang = mcpA;
    // the next joint L along: round the grip while there is room behind it, else on along the paddle
    const next = (from: V3, L: number): V3 => {
      for (let a = ang; a < ang + 120; a += 0.5) {
        const q = onCircle(rho, a);
        if (len3(sub3(q, from)) >= L) {
          if (q[2] >= floor) {
            ang = a;
            return q;
          }
          break;
        }
      }
      ang = 999;
      const q = add3(from, scl3(norm3([-1, -0.04, -0.1]), L));
      q[2] = Math.max(q[2], floor);
      return q;
    };
    const pip = next(mcp, FL[k][0]);
    const dip = next(pip, FL[k][1]);
    const tip = next(dip, FL[k][2]);
    const path = crPath([root, mcp, pip, dip, tip], 17);
    const scale = path.map(() => 1);
    const tipDir = norm3(sub3(tip, dip));
    domeEnd(path, scale, tipDir, ht);
    // knuckles a touch proud, the phalanges a touch slimmer between them, the pad at the tip
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + len3(sub3(path[i], path[i - 1])));
    const total = cum[cum.length - 1];
    const sJ = [len3(sub3(mcp, root)), len3(sub3(mcp, root)) + FL[k][0], len3(sub3(mcp, root)) + FL[k][0] + FL[k][1]];
    const bulge = (s: number) => 1 + 0.07 * Math.exp(-(((s - sJ[0]) / 0.007) ** 2)) + 0.05 * Math.exp(-(((s - sJ[1]) / 0.006) ** 2)) + 0.03 * Math.exp(-(((s - sJ[2]) / 0.005) ** 2)) - 0.03;
    const rings = ringsAlong(path, () => G.t, (i) => hw * scale[i] * bulge(cum[i]), (i) => ht * scale[i] * bulge(cum[i]));
    const v0 = mb.count;
    // (u runs root → tip; round the finger the strip starts and ends on its underside — +u, toward
    // the grip — and the back of the finger is at 0.5)
    loft(mb, rings, fsec, (_s, i, f) => gloveUV(R_GL_FINGER, cum[i] / total, f), [fsec.length / 4]);
    capEnd(mb, rings[rings.length - 1], fsec, tipDir, gloveUV(R_GL_FINGER, 0.995, 0.5));
    mark(1 + k, v0);
    const J = [mcp, pip, dip, tip];
    for (let j = 0; j < 3; j++) caps.push({ a: J[j], b: J[j + 1], r: ht, part: 1 + k });
  });

  // ---- thumb: from the heel of the hand (its base makes the ball of the thumb) along the face,
  // pad down on it beside the top buttons
  {
    const T = gripFrame(0.018);
    const P0 = PALM.pts[PALM.pts.length - 3];
    const r0 = gp(H, P0.o - 0.012, P0.f + 0.004, 0.012);
    // (angled up toward the top buttons, its joint lifting it a touch off the face, the pad down on it)
    const t1: V3 = [T.c[0] - 0.005, 0.0195, WHEEL_FACE_Z - 0.0094];
    const t2: V3 = [T.c[0] - 0.021, 0.0265, WHEEL_FACE_Z - 0.0093];
    const t3: V3 = [T.c[0] - 0.033, 0.0335, WHEEL_FACE_Z - 0.0082];
    const path = crPath([r0, lerp3(r0, t1, 0.55), t1, t2, t3], 15);
    // (the ball of the thumb: thick at its root in the heel of the hand, the joint a touch proud)
    const scale = path.map((_, i) => 1 + 0.9 * (1 - smooth(0, 0.55, i / 14)) + 0.05 * Math.exp(-(((i / 14 - 0.72) / 0.07) ** 2)));
    const dir = norm3(sub3(t3, t2));
    domeEnd(path, scale, dir, 0.0086);
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + len3(sub3(path[i], path[i - 1])));
    const total = cum[cum.length - 1];
    // section: a along the face normal (thickness), b across (width)
    const rings = ringsAlong(path, () => [0, 0, 1], (i) => 0.0086 * scale[i], (i) => 0.0106 * scale[i]);
    const tsec = ellipseSec(14);
    const v0 = mb.count;
    // (the pad faces +z, the face: the strip starts and ends there, the nail side at 0.5)
    loft(mb, rings, tsec, (_s, i, f) => gloveUV(R_GL_THUMB, cum[i] / total, f), [0]);
    capEnd(mb, rings[rings.length - 1], tsec, dir, gloveUV(R_GL_THUMB, 0.995, 0.5));
    mark(5, v0);
    caps.push({ a: r0, b: t1, r: 0.013, part: 5 }, { a: t1, b: t2, r: 0.0105, part: 5 }, { a: t2, b: t3, r: 0.0095, part: 5 });
  }
}

/** the baked occlusion of the glove's own folds (between the fingers, the palm on the grip): aOcc */
function gloveAO(mb: MB, caps: Cap[], partOf: number[]) {
  const occ = new Float32Array(mb.count);
  for (let v = 0; v < mb.count; v++) {
    const p: V3 = [mb.pos[v * 3], mb.pos[v * 3 + 1], mb.pos[v * 3 + 2]];
    const n: V3 = [mb.nor[v * 3], mb.nor[v * 3 + 1], mb.nor[v * 3 + 2]];
    let o = 0;
    for (const c of caps) {
      if (c.part === partOf[v]) continue;
      const ab = sub3(c.b, c.a);
      const t = clamp(dot3(sub3(p, c.a), ab) / Math.max(1e-9, dot3(ab, ab)));
      const d = sub3(add3(c.a, scl3(ab, t)), p);
      const L = Math.max(len3(d), c.r * 1.05);
      const ct = dot3(n, d) / L;
      // (a sphere's occlusion of a point: its solid angle × the cosine; a capsule, near enough)
      if (ct > 0) o += ct * (c.r / L) ** 2;
    }
    occ[v] = clamp(o * 0.55, 0, 0.8);
  }
  return occ;
}

// ------------------------------------------------------------------------------------ the arm (left, car space)
/** shoulder joint (car space, left; inside the shoulder's padding), arm lengths, elbow pole */
export const ARM = {
  shoulder: [0.19, 0.585, 0.05] as V3,
  upper: 0.26,
  fore: 0.255,
  /** the elbows hang down and a little out (the cockpit is narrow) */
  pole: norm3([0.22, -1, -0.12]),
};
const PIVOT_M = new THREE.Matrix4().makeRotationX(STEER_TILT).setPosition(STEER_PIVOT[0], STEER_PIVOT[1], STEER_PIVOT[2]);
const toCar = (p: V3): V3 => {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(PIVOT_M);
  return [v.x, v.y, v.z];
};
/**
 * Two-bone IK: the elbow for a shoulder S and wrist W, bent toward `pole`. Out of reach the arm
 * straightens toward the wrist (the caller stretches the forearm to meet it).
 */
export function solveElbow(S: THREE.Vector3, W: THREE.Vector3, pole: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const a = ARM.upper;
  const b = ARM.fore;
  const dx = W.x - S.x;
  const dy = W.y - S.y;
  const dz = W.z - S.z;
  const d = Math.max(1e-5, Math.hypot(dx, dy, dz));
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  // the pole ⟂ the shoulder-wrist line
  const pd = pole.x * ux + pole.y * uy + pole.z * uz;
  let px = pole.x - ux * pd;
  let py = pole.y - uy * pd;
  let pz = pole.z - uz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  const dd = Math.min(d, (a + b) * 0.9995);
  const ca = (a * a + dd * dd - b * b) / (2 * a * dd);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  return out.set(S.x + a * (ux * ca + px * sa), S.y + a * (uy * ca + py * sa), S.z + a * (uz * ca + pz * sa));
}
/** the rest pose (car space, left arm): shoulder, elbow, wrist */
export const ARM_REST = (() => {
  const S = new THREE.Vector3(...ARM.shoulder);
  const W = new THREE.Vector3(...toCar(WRIST_LOCAL));
  const E = solveElbow(S, W, new THREE.Vector3(...ARM.pole), new THREE.Vector3());
  return { S: S.toArray() as V3, E: E.toArray() as V3, W: W.toArray() as V3 };
})();

/** the gauntlet's flare and the sleeve, out from the wrist along the forearm (s: metres from the wrist) */
const GAUNTLET = 0.064;
/** the glove's share of a point s along the forearm from the wrist (1 = moves with the hand) */
const handShare = (s: number) => 1 - smooth(0.004, 0.064, s);

export interface ArmsGeometry {
  /** both arms: group 0 the sleeves (driver material), group 1 the gloves (glove material) */
  geometry: THREE.BufferGeometry;
  triangles: number;
}
/**
 * Both arms as one skinned geometry in car space at rest (steering straight). Bones (skinIndex):
 * 0 left upper arm, 1 left forearm, 2 left hand, 3–5 the right's.
 */
export function buildArms(): ArmsGeometry {
  const { S, E, W } = ARM_REST;
  const toElbow = norm3(sub3(E, W));
  // ---- sleeve: shoulder → elbow → into the gauntlet (driver material, the suit's sleeve colour)
  const sleeve = new MB();
  const sleeveW: [number, number, number][] = []; // per vertex: bone a, bone b, weight of b
  {
    const sIn = add3(S, scl3(norm3(sub3(S, E)), 0.03));
    const wEnd = add3(W, scl3(toElbow, 0.034));
    const path = crPath([sIn, S, lerp3(S, E, 0.5), E, lerp3(E, wEnd, 0.45), wEnd], 34);
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + len3(sub3(path[i], path[i - 1])));
    const total = cum[cum.length - 1];
    let iE = 0;
    for (let i = 0; i < path.length; i++) if (len3(sub3(path[i], E)) < len3(sub3(path[iE], E))) iE = i;
    const sE = cum[iE];
    const radius = (s: number) => {
      const fromWrist = total - s;
      if (s < sE) return lerp(0.05, 0.045, smooth(0, sE, s));
      // the forearm: full below the elbow, slimming to the knitted cuff inside the glove's gauntlet
      return lerp(0.023, 0.045, smooth(0.0, 0.15, fromWrist)) * (1 + 0.04 * Math.exp(-(((s - sE - 0.06) / 0.05) ** 2)));
    };
    const rings = ringsAlong(path, () => [1, 0, 0], (i) => radius(cum[i]), (i) => radius(cum[i]) * 0.94);
    // folds in the sleeve where it bunches inside the elbow
    for (let i = 0; i < rings.length; i++) {
      const ds = cum[i] - sE;
      const fold = Math.exp(-((ds / 0.05) ** 2)) * 0.035 * Math.sin(ds / 0.011);
      rings[i].sx *= 1 + fold * 0.6;
      rings[i].sy *= 1 + fold;
    }
    const n = 16;
    loft(sleeve, rings, ellipseSec(n), () => drvCellUV(DC.suit2));
    // per ring (the loft's rows are n + 1 vertices): the elbow blends the upper arm into the
    // forearm; the end inside the gauntlet moves with the glove, as the gauntlet does
    for (let i = 0; i < rings.length; i++) {
      const h = handShare(dot3(sub3(path[i], W), toElbow));
      const w: [number, number, number] = h > 0.001 ? [1, 2, h] : [0, 1, smooth(sE - 0.04, sE + 0.04, cum[i])];
      for (let j = 0; j <= n; j++) sleeveW.push(w);
    }
  }

  // ---- glove: the hand (wheel-local → car), then the gauntlet along the forearm
  const glove = new MB();
  const caps: Cap[] = [];
  const partOf: number[] = [];
  leftHand(glove, caps, partOf);
  const occHand = gloveAO(glove, caps, partOf);
  const handVerts = glove.count;
  glove.transform(0, PIVOT_M);
  const gloveW: [number, number, number][] = [];
  for (let v = 0; v < handVerts; v++) gloveW.push([1, 2, 1]);
  {
    // the gauntlet: wrist strap, then the flared cuff over the sleeve, a rolled edge at its end;
    // its section is wider across the hand than through it, like the wrist inside it
    // (across = the hand's width, the grip's axis: the wheel's up, in car space)
    const across = norm3(sub3(toCar(add3(WRIST_LOCAL, [0, 1, 0])), toCar(WRIST_LOCAL)));
    const st = [-0.014, -0.004, 0.006, 0.014, 0.026, 0.036, 0.045, 0.054, 0.06, GAUNTLET, GAUNTLET + 0.0015];
    const rad = (s: number, i: number) =>
      i === st.length - 1 ? 0.0335 : s < 0 ? 0.0303 : s < 0.03 ? 0.0316 + (s > 0.008 && s < 0.028 ? 0.0009 : 0) : lerp(0.0316, 0.0366, smooth(0.03, GAUNTLET, s));
    const path = st.map((s) => add3(W, scl3(toElbow, s)));
    const rings = ringsAlong(path, () => across, (i) => rad(st[i], i) * 1.05, (i) => rad(st[i], i) * 0.9);
    const v0 = glove.count;
    // (the strip's cut along the underside, the top of the gauntlet — where its strap is lettered — at 0.5)
    loft(glove, rings, ellipseSec(18), (_s, i, f) => gloveUV(R_GL_CUFF, f, (st[i] - st[0]) / (GAUNTLET - st[0])), [9]);
    for (let v = v0; v < glove.count; v++) {
      const p: V3 = [glove.pos[v * 3], glove.pos[v * 3 + 1], glove.pos[v * 3 + 2]];
      gloveW.push([1, 2, handShare(dot3(sub3(p, W), toElbow))]);
    }
  }
  const occ = new Float32Array(glove.count);
  occ.set(occHand);

  // ---- both sides into one geometry: [left sleeve, right sleeve] [left glove, right glove]
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const ao: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  // (bones per vertex: a and b with b's weight; the right side's bones are 3 on; the right glove's
  // printed regions are mirrored back so its lettering reads the right way round)
  const unmirror = (u: number, v: number): V2 => {
    for (const r of [R_GL_BACK, R_GL_CUFF]) {
      const u0 = r.x / GLOVE_W;
      const u1 = (r.x + r.w) / GLOVE_W;
      const v0 = 1 - (r.y + r.h) / GLOVE_H;
      const v1 = 1 - r.y / GLOVE_H;
      if (u >= u0 && u <= u1 && v >= v0 && v <= v1) return [u0 + u1 - u, v];
    }
    return [u, v];
  };
  const emit = (mb: MB, w: [number, number, number][], o: Float32Array | null, mirror: boolean, printed: boolean) => {
    const base = pos.length / 3;
    for (let v = 0; v < mb.count; v++) {
      const sx = mirror ? -1 : 1;
      pos.push(mb.pos[v * 3] * sx, mb.pos[v * 3 + 1], mb.pos[v * 3 + 2]);
      nor.push(mb.nor[v * 3] * sx, mb.nor[v * 3 + 1], mb.nor[v * 3 + 2]);
      const t = mirror && printed ? unmirror(mb.uv[v * 2], mb.uv[v * 2 + 1]) : [mb.uv[v * 2], mb.uv[v * 2 + 1]];
      uv.push(t[0], t[1]);
      ao.push(o ? o[v] : 0);
      const [a, b, k] = w[v];
      const off = mirror ? 3 : 0;
      si.push(a + off, b + off, 0, 0);
      sw.push(1 - k, k, 0, 0);
    }
    for (let i = 0; i < mb.idx.length; i += 3) {
      const a = base + mb.idx[i];
      const b = base + mb.idx[i + 1];
      const c = base + mb.idx[i + 2];
      if (mirror) idx.push(a, c, b);
      else idx.push(a, b, c);
    }
  };
  emit(sleeve, sleeveW, null, false, false);
  emit(sleeve, sleeveW, null, true, false);
  const sleeveIdx = idx.length;
  emit(glove, gloveW, occ, false, true);
  emit(glove, gloveW, occ, true, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aOcc', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.addGroup(0, sleeveIdx, 0);
  g.addGroup(sleeveIdx, idx.length - sleeveIdx, 1);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, triangles: idx.length / 3 };
}
