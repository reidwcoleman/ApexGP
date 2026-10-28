import { ARENA_MARGIN, normalAt, sdf } from './arena.ts';
import { V3 } from './math.ts';

/**
 * The ball: radius 91.25 (resting at 93.15 on the arena's collision margin), mass 30, 6000 uu/s and 6 rad/s caps, a little air drag, bounces off the
 * arena with restitution 0.6 and Coulomb friction 0.35 on a solid sphere (so it rolls, spins up off
 * walls and carries its spin into the next bounce).
 */

export const BALL = {
  R: 91.25,
  MASS: 30,
  MAX_SPEED: 6000,
  MAX_W: 6,
  DRAG: 0.03,
  E: 0.6,
  MU: 0.35,
  REST_Z: 91.25 + ARENA_MARGIN,
} as const;

const GRAVITY = 650;
const tN = new V3();
const tA = new V3();
const tS = new V3();

export class Ball {
  pos = new V3(0, 0, BALL.REST_Z);
  vel = new V3();
  w = new V3();
  /** set when the ball bounced this tick (impact speed, for sound) */
  bounce = 0;

  reset(): void {
    this.pos.set(0, 0, BALL.REST_Z);
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
  }

  step(dt: number): void {
    this.bounce = 0;
    this.vel.z -= GRAVITY * dt;
    this.vel.scale(Math.pow(1 - BALL.DRAG, dt));
    this.vel.clampLen(BALL.MAX_SPEED);
    this.w.clampLen(BALL.MAX_W);
    this.pos.addScaled(this.vel, dt);
    this.collide();
  }

  collide(): void {
    const p = this.pos;
    const d = sdf(p.x, p.y, p.z) - ARENA_MARGIN;
    if (d >= BALL.R) return;
    const n = normalAt(p.x, p.y, p.z, tN);
    p.addScaled(n, BALL.R - d);
    const vn = this.vel.dot(n);
    if (vn >= 0) return;
    this.bounce = -vn;
    // (Bullet's restitution threshold: 0.2 bullet units = 10 uu/s)
    const e = -vn < 10 ? 0 : BALL.E;
    // normal
    this.vel.addScaled(n, -(1 + e) * vn);
    // contact slip: v_t − R (w × n)
    const vt = tA.copy(this.vel).addScaled(n, -this.vel.dot(n));
    const slip = tS.crossVectors(this.w, n).scale(-BALL.R).add(vt);
    const sl = slip.len();
    if (sl > 1e-6) {
      // impulse per unit mass along −slip, solid sphere: Δslip = 3.5 J/m
      const jn = (1 + e) * -vn;
      const j = Math.min(sl / 3.5, BALL.MU * jn);
      const jx = (-slip.x / sl) * j;
      const jy = (-slip.y / sl) * j;
      const jz = (-slip.z / sl) * j;
      this.vel.x += jx;
      this.vel.y += jy;
      this.vel.z += jz;
      // Δw = (r × J) / I with r = −R n, I = 0.4 m R²
      const k = 1 / (0.4 * BALL.R);
      const rx = -n.x;
      const ry = -n.y;
      const rz = -n.z;
      this.w.x += (ry * jz - rz * jy) * k;
      this.w.y += (rz * jx - rx * jz) * k;
      this.w.z += (rx * jy - ry * jx) * k;
    }
  }
}
