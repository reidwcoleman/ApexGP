import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { CAR } from './course-bumper.ts';

/** The bots for Bumper Bash. */

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Bumper Bash: it picks someone near (best of all someone near the edge, or the leader), comes at
 * them from the middle's side so the hit sends them out, and boosts once it's lined up. Near the
 * edge it worries about itself first; off the edge it boosts for home.
 */
export class BumpBrain {
  private target: Marble | null = null;
  private think = 0;
  private rest = 0;
  private wander = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {
    this.wander = rnd() * 6.28;
  }
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.bump!;
    const x = t - c.state.go, cx = A.center.x, cz = A.center.z, y0 = A.center.y;
    const R = A.radius(x);
    const nx = A.next(x);
    // (with a ring about to go, it's already moving in)
    const safe = nx && nx.at - x < 2.5 ? CAR.rings[nx.ring - 1]?.r ?? R : R;
    const px = m.pos.x - cx, pz = m.pos.z - cz, pr = Math.hypot(px, pz) || 0.01;
    const car = A.car(m.id);
    // off the edge: turn for home and boost
    if (pr > R + 0.3 || m.pos.y < y0 - 0.5) {
      m.input.set(-px / pr, 0, -pz / pr);
      if (car.cd <= 0 && this.rnd() < 0.25 + this.skill * 0.6) m.dash = true;
      return;
    }
    if (t >= this.think) {
      this.think = t + 0.5 + this.rnd() * 0.7;
      // (not every bot is hunting all the time: a rink of perfect hitmen is no fun to be on)
      if (t >= this.rest) {
        this.pick(c, all, t, safe);
        if (this.rnd() < 0.2 + 0.25 * ease) {
          this.rest = t + 1.2 + this.rnd() * 2;
          this.target = null;
        }
      }
    }
    // the edge: in, first
    const out = (m.vel.x * px + m.vel.z * pz) / pr;
    if (pr > safe - 3.2 - this.skill * 1.4 && (out > 1 || pr > safe - 2.2)) {
      m.input.set(-px / pr, 0, -pz / pr);
      if (pr > safe - 2.4 && out > 7 && car.cd <= 0 && this.rnd() < 0.5) m.dash = true;
      return;
    }
    const o = this.target;
    if (!o) {
      // nobody near: cruise round the middle of what's left
      this.wander += 0.012;
      const r = safe * 0.5;
      const dx = Math.cos(this.wander) * r - px, dz = Math.sin(this.wander) * r - pz, l = Math.hypot(dx, dz) || 1;
      m.input.set(dx / l, 0, dz / l);
      return;
    }
    // aim where they'll be, a little to the middle's side of them
    const ox = o.pos.x - cx, oz = o.pos.z - cz, orr = Math.hypot(ox, oz) || 0.01;
    const d0 = Math.hypot(ox - px, oz - pz);
    const lead = Math.min(0.5, d0 / 22);
    const side = d0 > 7 ? 2.6 : 0;
    const tx = ox + o.vel.x * lead - (ox / orr) * side, tz = oz + o.vel.z * lead - (oz / orr) * side;
    const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz) || 0.01;
    m.input.set(dx / d, 0, dz / d).multiplyScalar(1 - 0.2 * ease);
    // lined up and in range: go
    const off = Math.abs(wrap(Math.atan2(dx, dz) - car.yaw));
    if (car.cd <= 0 && d < 9 + this.skill * 3 && d > 2.2 && off < 0.42 && m.groundT < 0.1 && this.rnd() < (0.02 + 0.08 * this.skill) * this.aggr * (1 - 0.5 * ease)) m.dash = true;
    // someone boosting straight at it: a hop over them, if it's quick enough
    for (const q of all) {
      if (q === m || !q.active) continue;
      const qx = q.pos.x - m.pos.x, qz = q.pos.z - m.pos.z, qd = Math.hypot(qx, qz);
      if (qd > 5 || qd < 0.1) continue;
      const come = -(q.vel.x * qx + q.vel.z * qz) / qd;
      if (come > CAR.top + 4 && m.groundT < 0.1 && this.rnd() < 0.05 + 0.2 * this.skill) m.jump = true;
    }
  }

  private pick(c: Course, all: Marble[], t: number, R: number) {
    const m = this.m, A = c.bump!;
    let best = -1e9;
    this.target = null;
    for (const o of all) {
      if (o === m || !o.active || o.frozen || A.car(o.id).ghost > t) continue;
      const d = o.pos.distanceTo(m.pos);
      if (d > 26) continue;
      const orr = Math.hypot(o.pos.x - A.center.x, o.pos.z - A.center.z);
      const sc = -d + orr * 0.5 - Math.max(0, orr - R) * 3 + A.car(o.id).dmg * 5 + (this.rnd() - 0.5) * 8;
      if (sc > best) {
        best = sc;
        this.target = o;
      }
    }
  }
}
