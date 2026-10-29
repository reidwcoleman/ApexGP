import { ballPath } from './bot.ts';
import { CAR, type Input } from './car.ts';
import { clamp, V3 } from './math.ts';
import { ARENA } from './arena.ts';
import type { World } from './world.ts';

const tD = new V3();
const tW = new V3();

/**
 * Aerial assist: in the air with boost held, the nose is eased toward the first point on the ball's
 * path the car can still get to under boost (a touch behind the ball, so the hit carries on toward
 * the other goal). Only pitch and yaw are helped, blended into the stick by k (0…1); roll, boost
 * and the jumps stay the player's. It lets go when the ball's out of reach, when it's well off the
 * nose (the player's doing something else), and through a dodge.
 */
export function aerialAssist(w: World, i: number, inp: Input, k: number): Input {
  const c = w.cars[i];
  if (k <= 0 || !c || !c.alive || c.onGround || !inp.boost || c.flipping || c.flipped || w.phase !== 'play') return inp;
  const b = w.ball.pos;
  if (b.z < 220 || Math.hypot(b.x - c.pos.x, b.y - c.pos.y, b.z - c.pos.z) > 3500) return inp;
  const team = w.players[i]?.team ?? 0;
  const goalY = (team === 0 ? 1 : -1) * (ARENA.Y + 400);
  // the earliest point on the path the boost can still close on (half a second of turning allowed for)
  let dir: V3 | null = null;
  for (const q of ballPath(w)) {
    const t = q.t;
    if (t < 0.15) continue;
    if (t > 2.6) break;
    // aim a little behind the ball, on the line from the other goal through it
    const ox = q.x;
    const oy = q.y - goalY;
    const ol = Math.hypot(ox, oy) || 1;
    const D = tD.set(q.x + (ox / ol) * 60 - c.pos.x - c.vel.x * t, q.y + (oy / ol) * 60 - c.pos.y - c.vel.y * t, q.z - 20 - c.pos.z - c.vel.z * t + 325 * t * t);
    const need = (2 * D.len()) / (t * t);
    const turn = Math.acos(clamp(D.dot(c.rot.f) / Math.max(1, D.len()), -1, 1)) / 3.5;
    if (need < CAR.BOOST_ACCEL_AIR * 0.92 * Math.max(0, 1 - turn / t)) {
      dir = D.norm();
      break;
    }
  }
  if (!dir || dir.dot(c.rot.f) < 0.25) return inp;
  // point the nose along it (as a bot would), damped by the spin
  const f = dir.dot(c.rot.f);
  const l = dir.dot(c.rot.l);
  const u = dir.dot(c.rot.u);
  const wl = c.rot.toLocal(c.w, tW);
  const ap = clamp(Math.atan2(u, f) * 3.5 + wl.y * 0.35, -1, 1);
  const ay = clamp(-Math.atan2(l, f) * 3.5 + wl.z * 0.35, -1, 1);
  return { ...inp, pitch: clamp(inp.pitch + (ap - inp.pitch) * k, -1, 1), yaw: clamp(inp.yaw + (ay - inp.yaw) * k, -1, 1) };
}
