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

const R = ARENA.R;
// the arena shrunk by R: an octagon in xy, z in [R, Z - R]
const SX = ARENA.X - R;
const SY = ARENA.Y - R;
const SC = ARENA.CORNER - R * Math.SQRT2;
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


/** exact signed distance to the shrunk octagon in 2D (negative inside) */
function sdOct(x: number, y: number): number {
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

function goalFree(x: number, y: number, z: number): number {
  const ay = Math.abs(y);
  return Math.min(GW - Math.abs(x), z, GH - z, ay - GY0, GY1 - ay);
}

function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  let t = ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / (ex * ex + ey * ey + ez * ez);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  const dz = pz - (az + ez * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** the post / crossbar edges of the goal mouth on this end (sy = ±1) */
function mouthDist(x: number, y: number, z: number): number {
  const wy = ARENA.Y * Math.sign(y || 1);
  return Math.min(segDist(x, y, z, -GW, wy, 0, -GW, wy, GH), segDist(x, y, z, GW, wy, 0, GW, wy, GH), segDist(x, y, z, -GW, wy, GH, GW, wy, GH));
}

/** signed distance to the nearest surface, positive in the open air */
export function sdf(x: number, y: number, z: number): number {
  const a = arenaFree(x, y, z);
  if (Math.abs(y) < GY0 - 400) return a;
  const g = goalFree(x, y, z);
  const u = Math.max(a, g);
  // the mouth's edges are convex corners of the solid; the union alone would miss them
  if (Math.abs(x) < GW + 400 && z < GH + 400 && Math.abs(Math.abs(y) - ARENA.Y) < 400) return Math.min(u, mouthDist(x, y, z));
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
