import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { PICNIC, type Item } from './course-picnic.ts';
import { dodge } from './course-strikes.ts';

/**
 * Sticky Picnic: it goes for the best food it can reach, runs from anything big enough to pick it
 * up, chases what it could pick up, and goes round whatever's still too big to eat. A good bot
 * weighs food by what it's worth; a poor one takes whatever's nearest.
 */
export class PicnicBrain {
  private food: Item | null = null;
  private prey: Marble | null = null;
  private think = 0;
  private wander = 0;
  /** where it was at the last check, and the sidestep it's on if it's wedged */
  private lx = 0;
  private lz = 0;
  private lt = 0;
  private free = 0;
  private fa = 0;
  private skip: Item | null = null;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {
    this.wander = rnd() * 6.28;
  }

  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const A = c.picnic!, m = this.m, x = t - c.state.go, q = A.ball(m.id);
    if (q.stuck > t) return;
    const cx = A.center.x, cz = A.center.z, y0 = A.center.y;
    const R = A.size(q.mass), lim = R * PICNIC.eat;
    const px = m.pos.x - cx, pz = m.pos.z - cz, pr = Math.hypot(px, pz) || 0.01;
    // off the edge: boost for home
    if (pr > A.R + 0.2 || m.pos.y < y0 - 0.6) {
      m.input.set(-px / pr, 0, -pz / pr);
      if (q.cd <= 0 && this.rnd() < 0.25 + this.skill * 0.6) m.dash = true;
      return;
    }
    // a tomato coming down
    const out = dodge(A.strikes, m, x, 0.5 + (1 - this.skill) * 0.9 + ease * 0.4);
    if (out) {
      m.input.set(out[0], 0, out[1]);
      return;
    }
    // the edge comes first
    const edge = A.R - 3.5 - this.skill * 2;
    if (pr > edge && (m.vel.x * px + m.vel.z * pz) / pr > 0) {
      m.input.set(-px / pr, 0, -pz / pr);
      return;
    }
    // anything that could pick it up
    let fx = 0, fz = 0, scared = 1e9;
    for (const o of all) {
      if (o === m || !o.active) continue;
      const oq = A.ball(o.id);
      if (oq.ghost > t || oq.stuck > t) continue;
      const ro = A.size(oq.mass);
      if (ro < R * PICNIC.gulp) continue;
      const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z, d = Math.hypot(dx, dz) || 0.01, gap = d - ro - R;
      if (gap > 5 + this.skill * 7) continue;
      fx += dx / d / Math.max(0.6, gap);
      fz += dz / d / Math.max(0.6, gap);
      scared = Math.min(scared, gap);
    }
    // wedged against something: back off to one side and try for something else
    if (t >= this.lt) {
      const moved = Math.hypot(m.pos.x - this.lx, m.pos.z - this.lz);
      if (this.lt > 0 && moved < 1.2 && t >= this.free) {
        this.free = t + 0.7 + this.rnd() * 0.5;
        this.skip = this.food;
        this.food = null;
        let bx = 0, bz = 0;
        A.near(m.pos.x, m.pos.z, R + 2, (it) => {
          if (it.gone || it.r <= lim || it.at > x) return;
          bx += m.pos.x - it.x;
          bz += m.pos.z - it.z;
        });
        const away = bx || bz ? Math.atan2(bx, bz) : Math.atan2(-px, -pz);
        this.fa = away + (this.rnd() < 0.5 ? -1 : 1) * (0.5 + this.rnd() * 0.7);
      }
      this.lx = m.pos.x;
      this.lz = m.pos.z;
      this.lt = t + 0.6;
    }
    if (t < this.free) {
      m.input.set(Math.sin(this.fa), 0, Math.cos(this.fa));
      return;
    }
    if (t >= this.think) {
      this.think = t + 0.3 + this.rnd() * 0.4;
      this.pick(c, all, t, x, R, lim);
    }
    let dx: number, dz: number;
    const p = this.prey, f = this.food;
    if (scared < 1e8) {
      const l = Math.hypot(fx, fz) || 1;
      dx = fx / l;
      dz = fz / l;
      if (scared < 3 && q.cd <= 0 && this.rnd() < 0.05 + 0.12 * this.skill) m.dash = true;
    } else if (p && p.active && A.ball(p.id).ghost <= t) {
      dx = p.pos.x + p.vel.x * 0.3 - m.pos.x;
      dz = p.pos.z + p.vel.z * 0.3 - m.pos.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d - R < 7 && q.cd <= 0 && this.rnd() < 0.03 * this.aggr * (1 - 0.5 * ease)) m.dash = true;
    } else if (f && !f.gone) {
      dx = f.x - m.pos.x;
      dz = f.z - m.pos.z;
    } else {
      this.wander += 0.01;
      dx = Math.cos(this.wander) * A.R * 0.5 - px;
      dz = Math.sin(this.wander) * A.R * 0.5 - pz;
    }
    const l = Math.hypot(dx, dz) || 0.01;
    dx /= l;
    dz /= l;
    // round whatever's too big, by the nearest way that's clear
    const a0 = Math.atan2(dx, dz);
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const a = a0 + off, ux = Math.sin(a), uz = Math.cos(a);
      if (this.clear(c, ux, uz, R, lim, x)) {
        dx = ux;
        dz = uz;
        break;
      }
    }
    m.input.set(dx, 0, dz).multiplyScalar(1 - 0.28 * ease);
  }

  private clear(c: Course, ux: number, uz: number, R: number, lim: number, x: number) {
    const A = c.picnic!, m = this.m, ax = m.pos.x + ux * (R + 2.2), az = m.pos.z + uz * (R + 2.2);
    let ok = true;
    A.near(ax, az, R + 1, (it) => {
      if (!ok || it.gone || it.r <= lim || it.at > x) return;
      if (Math.hypot(it.x - ax, it.z - az) < it.r * 0.82 + R + 0.5) ok = false;
    });
    return ok;
  }

  private pick(c: Course, all: Marble[], t: number, x: number, R: number, lim: number) {
    const A = c.picnic!, m = this.m;
    this.prey = null;
    let best = 1e9;
    for (const o of all) {
      if (o === m || !o.active) continue;
      const oq = A.ball(o.id), ro = A.size(oq.mass);
      if (oq.ghost > t || oq.stuck > t || R < ro * PICNIC.gulp) continue;
      const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) - R - ro;
      if (d < 11 * this.aggr && d < best) {
        best = d;
        this.prey = o;
      }
    }
    // a poor bot takes what's nearest, a good one what's worth the trip
    let top = -1e9;
    this.food = null;
    const greed = 0.1 + this.skill * 1.4;
    A.near(m.pos.x, m.pos.z, 20 + R, (it) => {
      if (it.gone || it.r > lim || it.at > x || it === this.skip) return;
      const d = Math.hypot(it.x - m.pos.x, it.z - m.pos.z);
      const v = (greed * Math.log(1 + it.r * it.r * it.r * 8) * 6 - d) + this.rnd() * 3;
      if (v > top && Math.hypot(it.x - A.center.x, it.z - A.center.z) < A.R - 2.5) {
        top = v;
        this.food = it;
      }
    });
  }
}
