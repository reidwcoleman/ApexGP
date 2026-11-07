import type { World } from './collide.ts';

export interface NadeSim {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rest: boolean;
  acc?: number;
}

/**
 * A thrown can: flies, bounces, and on the ground it rolls out rather than stops. A fixed step and the
 * same boxes mean every browser agrees where it went; `spin` is only for looking at.
 */
const H = 1 / 120;

export function stepNade(w: World, n: NadeSim, dt: number): number {
  if (n.rest) return 0;
  n.acc = (n.acc ?? 0) + dt;
  let hit = 0;
  while (n.acc >= H && !n.rest) {
    n.acc -= H;
    hit = Math.max(hit, sub(w, n));
  }
  return hit;
}

function sub(w: World, n: NadeSim): number {
  n.vy -= 9.81 * H;
  // air
  const k = 1 - 0.12 * H;
  n.vx *= k;
  n.vz *= k;
  const s = Math.hypot(n.vx, n.vy, n.vz);
  if (s < 1e-4) return 0;
  const dx = n.vx / s, dy = n.vy / s, dz = n.vz / s, d = s * H;
  const h = w.ray(n.x, n.y, n.z, dx, dy, dz, d + 0.045);
  if (!h) {
    n.x += n.vx * H;
    n.y += n.vy * H;
    n.z += n.vz * H;
    return 0;
  }
  const t = Math.max(0, h.t - 0.045);
  n.x += dx * t;
  n.y += dy * t;
  n.z += dz * t;
  const vn = n.vx * h.nx + n.vy * h.ny + n.vz * h.nz;
  // bounce: glass and plaster soak it up, steel gives it back
  const hard = /steel|tin|cont_|rack|grate|dumpster/.test(h.box.mat) || h.box.tag === 'post' ? 0.5 : h.box.pen ? 0.22 : 0.36;
  const e = Math.abs(vn) < 1.2 ? 0 : hard;
  n.vx -= (1 + e) * vn * h.nx;
  n.vy -= (1 + e) * vn * h.ny;
  n.vz -= (1 + e) * vn * h.nz;
  // scrub off some of what runs along the surface
  const f = Math.abs(vn) > 1.2 ? 0.74 : h.ny > 0.5 ? 1 - 2.2 * H : 0.9;
  if (h.ny > 0.5) {
    n.vx *= f;
    n.vz *= f;
  } else {
    n.vy *= h.ny < -0.5 ? 1 : f;
    if (h.nx) n.vz *= f;
    if (h.nz) n.vx *= f;
  }
  if (h.ny > 0.5 && Math.hypot(n.vx, n.vz) < 0.22 && Math.abs(n.vy) < 0.5) {
    n.rest = true;
    n.vx = n.vy = n.vz = 0;
  }
  return Math.abs(vn);
}
