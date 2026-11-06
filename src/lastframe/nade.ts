import type { World } from './collide.ts';

export interface NadeSim {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rest: boolean;
}

/** a thrown can: flies, bounces off boxes, rolls to a stop. Everyone runs the same maths. */
export function stepNade(w: World, n: NadeSim, dt: number): number {
  if (n.rest) return 0;
  n.vy -= 11 * dt;
  const s = Math.hypot(n.vx, n.vy, n.vz);
  if (s < 1e-4) return 0;
  const dx = n.vx / s, dy = n.vy / s, dz = n.vz / s, d = s * dt;
  const h = w.ray(n.x, n.y, n.z, dx, dy, dz, d + 0.05);
  if (!h) {
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    n.z += n.vz * dt;
    return 0;
  }
  const t = Math.max(0, h.t - 0.05);
  n.x += dx * t;
  n.y += dy * t;
  n.z += dz * t;
  const vn = n.vx * h.nx + n.vy * h.ny + n.vz * h.nz;
  n.vx = (n.vx - 1.45 * vn * h.nx) * 0.55;
  n.vy = n.vy - 1.45 * vn * h.ny;
  n.vz = (n.vz - 1.45 * vn * h.nz) * 0.55;
  if (h.ny > 0.5) n.vy *= 0.5;
  if (Math.hypot(n.vx, n.vy, n.vz) < 0.7) n.rest = true;
  return Math.abs(vn);
}
