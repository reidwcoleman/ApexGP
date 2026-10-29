import { V3 } from './math.ts';

/**
 * The standard pitch, to the real game's published measurements (cm, RLBot / RLGym game values):
 * side walls at x = ±4096, back walls at y = ±5120, the ceiling at 2044, the four corners cut 1152
 * along each wall (|x| + |y| = 8064), the ramps up the walls 256 high (every edge is rounded with
 * that radius; the ceiling's isn't published, so it shares it). Goals 892.755 either side of
 * centre, 642.775 tall, back of the net at 6000.
 *
 * Collision runs on a signed distance (positive in the open air) built from exact pieces: the
 * rounded arena interior, the goal boxes, and the goal mouth's posts and crossbar as segments.
 */

/** Bullet's collision margin on the arena mesh: bodies touch it this far out (the ball rests at
 * 93.15, not at its radius of 91.25); the wheels' raycasts hit the bare surface */
export const ARENA_MARGIN = 1.9;

export const ARENA = {
  X: 4096,
  Y: 5120,
  Z: 2048, // (RocketSim's ceiling plane; RLGym quotes 2044 for where things meet it)
  CORNER: 8064,
  R: 256,
  GOAL_W: 892.755, // half width
  GOAL_H: 642.775,
  GOAL_D: 880,
} as const;

/** the inside of each goal, seen from the side: the floor runs back and ramps up into the back
 * wall like the arena's own ramps, and the back wall curves over into the roof */
export const GOAL_BACK_R = 256;
export const GOAL_TOP_R = 128;
/** that profile as (depth behind the goal line, z) from the floor at the mouth round to the roof at the mouth */
export function goalProfile(arcSteps = 12): [number, number][] {
  const D = ARENA.GOAL_D;
  const H = ARENA.GOAL_H;
  const p: [number, number][] = [[0, 0]];
  for (let k = 0; k <= arcSteps; k++) {
    const a = -Math.PI / 2 + (k / arcSteps) * (Math.PI / 2);
    p.push([D - GOAL_BACK_R + GOAL_BACK_R * Math.cos(a), GOAL_BACK_R + GOAL_BACK_R * Math.sin(a)]);
  }
  for (let k = 0; k <= arcSteps; k++) {
    const a = (k / arcSteps) * (Math.PI / 2);
    p.push([D - GOAL_TOP_R + GOAL_TOP_R * Math.cos(a), H - GOAL_TOP_R + GOAL_TOP_R * Math.sin(a)]);
  }
  p.push([0, H]);
  return p;
}

/** the goal box's inside edges (each side into the back and the roof) are rounded on this radius,
 * fading in from nothing along the floor's ramp, so the sides meet the floor square */
export const GOAL_EDGE_R = 128;
/** the posts and the crossbar are rounded on this radius where the back wall turns into the goal:
 * the hole in the back wall is that much wider and taller than the goal itself */
export const GOAL_POST_R = 64;

export interface TriMesh {
  v: number[];
  t: number[];
}

function triMesh(): TriMesh & { vert(x: number, y: number, z: number): number; tri(a: number, b: number, c: number, fx: number, fy: number, fz: number): void } {
  const v: number[] = [];
  const t: number[] = [];
  const key = new Map<string, number>();
  return {
    v,
    t,
    vert(x, y, z) {
      const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      let i = key.get(k);
      if (i === undefined) {
        i = v.length / 3;
        v.push(x, y, z);
        key.set(k, i);
      }
      return i;
    },
    /** a triangle wound so its normal points along (fx, fy, fz), the open air's side */
    tri(a, b, c, fx, fy, fz) {
      if (a === b || b === c || a === c) return;
      const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2];
      const ux = v[b * 3] - ax, uy = v[b * 3 + 1] - ay, uz = v[b * 3 + 2] - az;
      const wx = v[c * 3] - ax, wy = v[c * 3 + 1] - ay, wz = v[c * 3 + 2] - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      if (nx * nx + ny * ny + nz * nz < 1e-6) return;
      if (nx * fx + ny * fy + nz * fz >= 0) t.push(a, b, c);
      else t.push(a, c, b);
    },
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** the mouth's outline where the goal's own walls start (GOAL_POST_R behind the back wall), from the
 * left post's foot up over the crossbar and down the right post: (x, z) and the outward normal */
function mouthOutline(arc: number): [number, number, number, number][] {
  const W = ARENA.GOAL_W;
  const H = ARENA.GOAL_H;
  const r = GOAL_EDGE_R;
  const o: [number, number, number, number][] = [];
  for (let k = 0; k <= 4; k++) o.push([-W, ((H - r) * k) / 4, -1, 0]);
  for (let k = 1; k <= arc; k++) {
    const a = Math.PI - (k / arc) * (Math.PI / 2);
    o.push([-(W - r) + r * Math.cos(a), H - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]);
  }
  for (let k = 1; k < 8; k++) o.push([-(W - r) + (2 * (W - r) * k) / 8, H, 0, 1]);
  for (let k = 0; k <= arc; k++) {
    const a = Math.PI / 2 - (k / arc) * (Math.PI / 2);
    o.push([W - r + r * Math.cos(a), H - r + r * Math.sin(a), Math.cos(a), Math.sin(a)]);
  }
  for (let k = 1; k <= 4; k++) o.push([W, H - r - ((H - r) * k) / 4, 1, 0]);
  return o;
}

/**
 * The goal on end s (±1), in simulation cm, every triangle facing the open air:
 * - `inner`: the box: its floor ramping up into the curved back, over into the roof, and the flat
 *   sides, joined to the back and the roof by rounded edges (GOAL_EDGE_R)
 * - `frame`: the posts and crossbar, rounded (GOAL_POST_R) from the back wall into the goal's walls
 * - `corners`: what's left of the back wall round the mouth's rounded top corners
 * - `ramps`: the two faces where the arena's floor ramp stops either side of the mouth
 */
export function goalSurfaces(s: 1 | -1, arc = 12, round = 6): { inner: TriMesh; frame: TriMesh; corners: TriMesh; ramps: TriMesh } {
  const W = ARENA.GOAL_W;
  const H = ARENA.GOAL_H;
  const D = ARENA.GOAL_D;
  const Y = ARENA.Y;
  const RS = GOAL_EDGE_R;
  const RP = GOAL_POST_R;
  const at = (x: number, d: number) => [x, s * (Y + d)] as const;
  // the profile from the floor at the mouth round to the roof at the mouth: (d, z), the inward
  // normal, and how round the side edges are there
  const prof: { d: number; z: number; nd: number; nz: number; r: number }[] = [{ d: 0, z: 0, nd: 0, nz: 1, r: 0 }];
  for (let k = 0; k <= arc; k++) {
    const a = -Math.PI / 2 + (k / arc) * (Math.PI / 2);
    prof.push({ d: D - GOAL_BACK_R + GOAL_BACK_R * Math.cos(a), z: GOAL_BACK_R + GOAL_BACK_R * Math.sin(a), nd: -Math.cos(a), nz: -Math.sin(a), r: RS * smooth(k / arc) });
  }
  for (let k = 0; k <= arc; k++) {
    const a = (k / arc) * (Math.PI / 2);
    prof.push({ d: D - GOAL_TOP_R + GOAL_TOP_R * Math.cos(a), z: H - GOAL_TOP_R + GOAL_TOP_R * Math.sin(a), nd: -Math.cos(a), nz: -Math.sin(a), r: RS });
  }
  prof.push({ d: RP, z: H, nd: 0, nz: -1, r: RS });

  const inner = triMesh();
  // (the box is convex: every face looks toward a point in the middle of it)
  const mid = [0, s * (Y + D * 0.5), H * 0.5];
  const quadIn = (a: number, b: number, c: number, d: number) => {
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      const v = inner.v;
      const cx = (v[p * 3] + v[q * 3] + v[r * 3]) / 3;
      const cy = (v[p * 3 + 1] + v[q * 3 + 1] + v[r * 3 + 1]) / 3;
      const cz = (v[p * 3 + 2] + v[q * 3 + 2] + v[r * 3 + 2]) / 3;
      inner.tri(p, q, r, mid[0] - cx, mid[1] - cy, mid[2] - cz);
    }
  };
  // a point on the rounded edge: profile point i, theta 0 (on the floor / back / roof) … 90° (on the side)
  const edge = (i: number, sx: number, th: number) => {
    const p = prof[i];
    const k = p.r * (1 - Math.cos(th));
    const [x, y] = at(sx * (W - p.r + p.r * Math.sin(th)), p.d + p.nd * k);
    return inner.vert(x, y, p.z + p.nz * k);
  };
  for (let i = 0; i < prof.length - 1; i++) {
    // across the middle
    quadIn(edge(i, -1, 0), edge(i, 1, 0), edge(i + 1, 1, 0), edge(i + 1, -1, 0));
    // round each edge onto the sides
    for (const sx of [-1, 1])
      for (let j = 0; j < round; j++) {
        const t0 = (j / round) * (Math.PI / 2);
        const t1 = ((j + 1) / round) * (Math.PI / 2);
        quadIn(edge(i, sx, t0), edge(i, sx, t1), edge(i + 1, sx, t1), edge(i + 1, sx, t0));
      }
  }
  // the flat sides: from the post's line (RP back) round the inset profile
  for (const sx of [-1, 1]) {
    const poly: [number, number][] = [[RP, 0]];
    for (let i = 1; i < prof.length; i++) poly.push([prof[i].d + prof[i].nd * prof[i].r, prof[i].z + prof[i].nz * prof[i].r]);
    let cd = 0;
    let cz = 0;
    for (const [d, z] of poly) (cd += d), (cz += z);
    const [ccx, ccy] = at(sx * W, cd / poly.length);
    const c = inner.vert(ccx, ccy, cz / poly.length);
    for (let k = 0; k < poly.length; k++) {
      const [d0, z0] = poly[k];
      const [d1, z1] = poly[(k + 1) % poly.length];
      const [x0, y0] = at(sx * W, d0);
      const [x1, y1] = at(sx * W, d1);
      inner.tri(c, inner.vert(x0, y0, z0), inner.vert(x1, y1, z1), -sx, 0, 0);
    }
  }

  // the rounded posts and crossbar: each outline point swept on a quarter circle from the goal's
  // wall (RP back) out to the back wall
  const frame = triMesh();
  const out = mouthOutline(arc);
  const fp = (k: number, ph: number) => {
    const [ox, oz, mx, mz] = out[k];
    const e = RP * (1 - Math.cos(ph));
    const [x, y] = at(ox + mx * e, RP * (1 - Math.sin(ph)));
    return frame.vert(x, y, oz + mz * e);
  };
  for (let k = 0; k < out.length - 1; k++)
    for (let j = 0; j < round; j++) {
      const p0 = (j / round) * (Math.PI / 2);
      const p1 = ((j + 1) / round) * (Math.PI / 2);
      const a = fp(k, p0);
      const b = fp(k + 1, p0);
      const c = fp(k + 1, p1);
      const d = fp(k, p1);
      // (facing away from the fillet's centre line)
      const [, , mx, mz] = out[k];
      const pm = (p0 + p1) / 2;
      const fx = -mx * Math.cos(pm);
      const fz = -mz * Math.cos(pm);
      const fy = -s * Math.sin(pm);
      frame.tri(a, b, c, fx, fy, fz);
      frame.tri(a, c, d, fx, fy, fz);
    }

  // the back wall's corners above the rounded mouth, and the faces where the floor's ramp stops
  const wall = triMesh();
  const ramps = triMesh();
  for (const sx of [-1, 1]) {
    const [qx, qy] = at(sx * (W + RP), 0);
    const q = wall.vert(qx, qy, H + RP);
    let prev = -1;
    for (let k = 0; k <= arc; k++) {
      const a = (k / arc) * (Math.PI / 2);
      const [x, y] = at(sx * (W - RS + (RS + RP) * Math.cos(a)), 0);
      const p = wall.vert(x, y, H - RS + (RS + RP) * Math.sin(a));
      if (prev >= 0) wall.tri(q, prev, p, 0, -s, 0);
      prev = p;
    }
    for (let k = 0; k < arc; k++) {
      const a0 = -Math.PI / 2 + (k / arc) * (Math.PI / 2);
      const a1 = -Math.PI / 2 + ((k + 1) / arc) * (Math.PI / 2);
      const y0 = s * (Y - ARENA.R + ARENA.R * Math.cos(a0));
      const y1 = s * (Y - ARENA.R + ARENA.R * Math.cos(a1));
      const x = sx * (W + RP);
      const v = [ramps.vert(x, y0, 0), ramps.vert(x, y1, 0), ramps.vert(x, y1, ARENA.R + ARENA.R * Math.sin(a1)), ramps.vert(x, y0, ARENA.R + ARENA.R * Math.sin(a0))];
      ramps.tri(v[0], v[1], v[2], -sx, 0, 0);
      ramps.tri(v[0], v[2], v[3], -sx, 0, 0);
    }
  }
  return { inner, frame, corners: wall, ramps };
}

/** true where the back wall is open into the goal (|x|, z on the wall's plane) */
export function inMouth(ax: number, z: number): boolean {
  const W = ARENA.GOAL_W;
  const H = ARENA.GOAL_H;
  if (ax >= W + GOAL_POST_R || z >= H + GOAL_POST_R) return false;
  const qx = ax - (W - GOAL_EDGE_R);
  const qz = z - (H - GOAL_EDGE_R);
  return qx <= 0 || qz <= 0 || Math.hypot(qx, qz) < GOAL_EDGE_R + GOAL_POST_R;
}

/** the radius of the vertical joints between the corner panels and the walls */
export const CORNER_R = 640;

/** the octagon shrunk by CORNER_R, counter-clockwise from the +x wall's −y end: offset outward by
 * CORNER_R − R (straight along the edges, fanned round the vertices) it is the arena shrunk by R */
export function octCore(): [number, number][] {
  const sx = ARENA.X - CORNER_R;
  const sy = ARENA.Y - CORNER_R;
  const sc = ARENA.CORNER - CORNER_R * Math.SQRT2;
  return [
    [sx, -(sc - sx)],
    [sx, sc - sx],
    [sc - sy, sy],
    [-(sc - sy), sy],
    [-sx, sc - sx],
    [-sx, -(sc - sx)],
    [-(sc - sy), -sy],
    [sc - sy, -sy],
  ];
}

const R = ARENA.R;
// the arena shrunk by R is the core octagon rounded by CORNER_R − R; z in [R, Z − R]
const SX = ARENA.X - CORNER_R;
const SY = ARENA.Y - CORNER_R;
const SC = ARENA.CORNER - CORNER_R * Math.SQRT2;
const RC = CORNER_R - R;
// octagon vertices (counter-clockwise)
const OCT: [number, number][] = [
  [SX, SC - SX],
  [SX, -(SC - SX)],
  [SC - SY, -SY],
  [-(SC - SY), -SY],
  [-SX, -(SC - SX)],
  [-SX, SC - SX],
  [-(SC - SY), SY],
  [SC - SY, SY],
];


/** exact signed distance to the arena shrunk by R in 2D (negative inside) */
function sdOct(x: number, y: number): number {
  return sdCore(x, y) - RC;
}

/** exact signed distance to the core octagon */
function sdCore(x: number, y: number): number {
  // inside test via max of plane distances; outside via nearest edge
  let inside = -Infinity;
  inside = Math.max(inside, x - SX, -x - SX, y - SY, -y - SY, (Math.abs(x) + Math.abs(y) - SC) / Math.SQRT2);
  if (inside <= 0) return inside;
  let best = Infinity;
  for (let i = 0; i < OCT.length; i++) {
    const [ax, ay] = OCT[i];
    const [bx, by] = OCT[(i + 1) % OCT.length];
    const ex = bx - ax;
    const ey = by - ay;
    let t = ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + ex * t);
    const dy = y - (ay + ey * t);
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** distance from the open air of the rounded arena to its walls (positive inside) */
function arenaFree(x: number, y: number, z: number): number {
  const d2 = sdOct(x, y);
  const dz = Math.max(R - z, z - (ARENA.Z - R));
  // extrusion sdf of the shrunk shape, then rounded by R
  const ox = Math.max(d2, 0);
  const oz = Math.max(dz, 0);
  const sd = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(d2, dz), 0);
  return R - sd;
}

const GW = ARENA.GOAL_W;
const GH = ARENA.GOAL_H;
const GY0 = ARENA.Y - R - 20; // the goal box starts in front of the wall ramp so the mouth is flat
const GY1 = ARENA.Y + ARENA.GOAL_D;

/** inside a concave edge between two faces (free distances a, b) rounded on radius r */
function roundIn(a: number, b: number, r: number): number {
  return a < r && b < r ? r - Math.hypot(r - a, r - b) : Math.min(a, b);
}

function goalFree(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  // in front of the back wall: the opening, as wide and tall as the rounded posts and crossbar leave it
  if (ay < ARENA.Y) return Math.min(GW + GOAL_POST_R - ax, z, GH + GOAL_POST_R - z, ay - GY0);
  const side = GW - ax;
  const roof = GH - z;
  const back = GY1 - ay;
  return Math.min(roundIn(side, roof, GOAL_EDGE_R), roundIn(side, back, GOAL_EDGE_R), roundIn(roof, back, GOAL_TOP_R), roundIn(z, back, GOAL_BACK_R));
}

/** near the mouth: the rounded posts and crossbar, the goal's walls behind them and the back wall
 * round them, in the fillet's cross-section (u out from the goal's walls, dd behind the back wall) */
function mouthFree(ax: number, ay: number, z: number): number {
  const RP = GOAL_POST_R;
  const qx = ax - (GW - GOAL_EDGE_R);
  const qz = z - (GH - GOAL_EDGE_R);
  const u = qx > 0 && qz > 0 ? Math.hypot(qx, qz) - GOAL_EDGE_R : Math.max(ax - GW, z - GH);
  const dd = ay - ARENA.Y;
  const cu = u - RP;
  const cd = dd - RP;
  if (cu <= 0 && cd <= 0) return Math.hypot(cu, cd) - RP;
  if (cu > 0 && cd <= 0) return -dd;
  if (cu <= 0) return -u;
  return -Math.hypot(cu, cd);
}

/** signed distance to the nearest surface, positive in the open air */
export function sdf(x: number, y: number, z: number): number {
  const a = arenaFree(x, y, z);
  if (Math.abs(y) < GY0 - 400) return a;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const u = Math.max(a, goalFree(x, y, z));
  // the mouth's posts and crossbar are convex corners of the solid; the union alone would miss them
  if (ax < GW + GOAL_POST_R + 300 && z < GH + GOAL_POST_R + 300 && Math.abs(ay - ARENA.Y - GOAL_POST_R / 2) < 300) {
    const m = mouthFree(ax, ay, z);
    return ay >= ARENA.Y ? Math.min(m, z) : Math.min(u, m);
  }
  return u;
}

const E = 2;
/** outward-from-wall normal (the direction of increasing free distance) */
export function normalAt(x: number, y: number, z: number, out: V3): V3 {
  const dx = sdf(x + E, y, z) - sdf(x - E, y, z);
  const dy = sdf(x, y + E, z) - sdf(x, y - E, z);
  const dz = sdf(x, y, z + E) - sdf(x, y, z - E);
  return out.set(dx, dy, dz).norm();
}

export type Team = 0 | 1; // 0 blue (defends y < 0), 1 orange

/** true when the whole ball has crossed into this team's goal */
/** a goal, exactly as RocketSim (and the real game) score one: the ball's centre past the base
 * threshold (5124.25) plus its radius */
const GOAL_THRESHOLD_Y = 5124.25;
export function inGoal(p: V3, radius: number): Team | -1 {
  if (p.y < -(GOAL_THRESHOLD_Y + radius)) return 0;
  if (p.y > GOAL_THRESHOLD_Y + radius) return 1;
  return -1;
}

export interface Pad {
  x: number;
  y: number;
  big: boolean;
}

const SMALL: [number, number][] = [
  [0, -4240],
  [-1792, -4184],
  [1792, -4184],
  [-940, -3308],
  [940, -3308],
  [0, -2816],
  [-3584, -2484],
  [3584, -2484],
  [-1788, -2300],
  [1788, -2300],
  [-2048, -1036],
  [0, -1024],
  [2048, -1036],
  [-1024, 0],
  [1024, 0],
  [-2048, 1036],
  [0, 1024],
  [2048, 1036],
  [-1788, 2300],
  [1788, 2300],
  [-3584, 2484],
  [3584, 2484],
  [0, 2816],
  [-940, 3308],
  [940, 3308],
  [-1792, 4184],
  [1792, 4184],
  [0, 4240],
];
const BIG: [number, number][] = [
  [-3072, -4096],
  [3072, -4096],
  [-3584, 0],
  [3584, 0],
  [-3072, 4096],
  [3072, 4096],
];
export const PADS: Pad[] = [...BIG.map(([x, y]) => ({ x, y, big: true })), ...SMALL.map(([x, y]) => ({ x, y, big: false }))];

/** kickoff spots for blue (orange is the point reflection); yaw faces the ball */
export const KICKOFFS: { x: number; y: number }[] = [
  { x: -2048, y: -2560 },
  { x: 2048, y: -2560 },
  { x: -256, y: -3840 },
  { x: 256, y: -3840 },
  { x: 0, y: -4608 },
];
/** respawn spots after a demolition (blue side) */
export const RESPAWNS: { x: number; y: number }[] = [
  { x: -2304, y: -4608 },
  { x: 2304, y: -4608 },
  { x: -2688, y: -4608 },
  { x: 2688, y: -4608 },
];
