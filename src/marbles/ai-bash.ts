import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { CAR } from './course-bumper.ts';
import { STOMP } from './course-stomp.ts';

/** The bots for Bumper Bash and Stomp Town. */

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

/** a way to go from (x, z) that isn't straight into a house: the nearest to `a` that's clear */
function around(c: Course, x: number, z: number, a: number, look: number) {
  const A = c.stomp!;
  for (const d of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2, 3.14]) {
    const u = a + d;
    if (!A.blocked(x + Math.sin(u) * look, z + Math.cos(u) * look, 0.8) && !A.blocked(x + Math.sin(u) * look * 0.5, z + Math.cos(u) * look * 0.5, 0.8)) return u;
  }
  return a;
}

/**
 * Stomp Town. As a giant it goes for the nearest bean it can flatten, leaps when they're at a
 * leap's length, and flops into a crowd. Small, it keeps running: away from the nearest giant, or
 * from where one's about to land, round the houses and not into a corner.
 */
export class StompBrain {
  private prey: Marble | null = null;
  private think = 0;
  private dir = 0;
  private stuck = 0;
  private turnT = 0;
  private last = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {
    this.dir = rnd() * 6.28;
  }

  update(dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const A = c.stomp!, m = this.m, x = t - c.state.go;
    if (m.frozen) return;
    if (A.isGiant(m.id, x)) this.giant(t, c, all, x, ease);
    else this.small(dt, t, c, all, x, ease);
  }

  private giant(t: number, c: Course, all: Marble[], x: number, ease: number) {
    const A = c.stomp!, m = this.m;
    if (t >= this.think) {
      this.think = t + 0.4 + this.rnd() * 0.4;
      let best = 1e9;
      this.prey = null;
      for (const o of all) {
        if (o === m || !o.active || o.frozen || A.isGiant(o.id, x) || (A.safe.get(o.id) ?? 0) > t + 0.6) continue;
        const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) + this.rnd() * 7;
        if (d < best) {
          best = d;
          this.prey = o;
        }
      }
    }
    const o = this.prey;
    if (!o) return void m.input.set(0, 0, 0);
    const tx = o.pos.x + o.vel.x * 0.3 - m.pos.x, tz = o.pos.z + o.vel.z * 0.3 - m.pos.z, d = Math.hypot(tx, tz) || 0.01;
    m.input.set(tx / d, 0, tz / d).multiplyScalar(1 - 0.22 * ease);
    if (m.groundT > 0.1) return;
    const r = this.rnd();
    const k = (0.4 + 0.6 * this.skill) * (1 - 0.5 * ease);
    if (d > 13 && d < 21 && m.dashCD <= 0 && r < 0.05 * k) m.dash = true;
    else if (d > 7 && d < 14 && r < 0.09 * k) m.jump = true;
  }

  private small(dt: number, t: number, c: Course, all: Marble[], x: number, ease: number) {
    const A = c.stomp!, m = this.m;
    const see = 15 + this.skill * 8;
    let fx = 0, fz = 0, near = 1e9;
    for (const o of all) {
      // (the ones about to grow as well: everyone can see the rings)
      if (o === m || !o.active || (!A.isGiant(o.id, x) && !A.isGiant(o.id, x + 1.2))) continue;
      // (a giant in the air: it's where it'll land that matters)
      const air = o.groundT > 0.12 ? 0.55 : 0.1;
      const dx = m.pos.x - (o.pos.x + o.vel.x * air), dz = m.pos.z - (o.pos.z + o.vel.z * air), d = Math.hypot(dx, dz) || 0.01;
      near = Math.min(near, d);
      if (d > see) continue;
      const k = (see - d) / see;
      fx += (dx / d) * k * k;
      fz += (dz / d) * k * k;
    }
    // walls and corners push it back toward the town
    const px = m.pos.x - A.center.x, pz = m.pos.z - A.center.z, lim = A.H - 7;
    if (Math.abs(px) > lim) fx -= Math.sign(px) * ((Math.abs(px) - lim) / 7) * 0.9;
    if (Math.abs(pz) > lim) fz -= Math.sign(pz) * ((Math.abs(pz) - lim) / 7) * 0.9;
    // stuck on a corner: pick a new way
    const sp = Math.hypot(m.vel.x, m.vel.z);
    this.stuck = sp < 2.2 ? this.stuck + dt : 0;
    if (this.stuck > 0.45) {
      this.stuck = 0;
      this.dir = this.rnd() * 6.28;
      this.turnT = t + 0.8;
      if (m.groundT < 0.1) m.jump = true;
    }
    let a: number;
    if (t < this.turnT) a = this.dir;
    else if (fx * fx + fz * fz > 0.0004) a = Math.atan2(fx, fz);
    else {
      // nothing near: keep moving, turning now and then
      if (t > this.last) {
        this.last = t + 1.4 + this.rnd() * 2;
        this.dir += (this.rnd() - 0.5) * 2.4;
      }
      a = this.dir;
    }
    a = around(c, m.pos.x, m.pos.z, a, 3.4);
    const run = near < see ? 1 - 0.1 * ease : 0.72;
    m.input.set(Math.sin(a) * run, 0, Math.cos(a) * run);
    if (near < STOMP.hit + 2.5 && m.grounded && this.rnd() < (0.02 + 0.1 * this.skill) * (1 - 0.5 * ease)) m.dash = true;
  }
}
