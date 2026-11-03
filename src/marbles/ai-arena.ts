import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { STORM, type Strike } from './course-storm.ts';
import { TIDE } from './course-tide.ts';

/**
 * Bots for the two arena survivals.
 *
 * Storm Deck: it keeps a spot of its own (in from the edge, away from the others) and watches the
 * rings: any strike due soon whose blast would reach it, it runs out of (the shortest way, never
 * toward the edge). A weaker bot sees a ring later and misjudges a big one now and then.
 *
 * High Tide: it climbs. It picks the highest column it can get to that isn't crowded (a little
 * lower if it's much nearer), runs at it and hops each step on the way; on top it holds the
 * middle and, if it's an aggressive one, shoves a neighbour toward the edge now and then.
 */

const LIVE: Strike[] = [];

export class StormBrain {
  private tx = 0;
  private tz = 0;
  private nextThink = 0;
  private react: number;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {
    this.react = 0.55 - 0.4 * skill + rnd() * 0.15;
  }

  update(_dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    const A = c.storm!;
    const cx = A.center.x, cz = A.center.z;
    const x = t - c.state.go;
    // the strikes it has seen coming (its reaction time late) that land within a beat
    A.between(x, x + STORM.warn - this.react, LIVE);
    const px = m.pos.x - cx, pz = m.pos.z - cz;
    let danger = 0, fx = 0, fz = 0;
    for (const s of LIVE) {
      const r = s.r + 0.9 + (s.r > 3 && this.rnd() < 0.002 ? -1.5 : 0);
      const dx = px - s.x, dz = pz - s.z;
      const d = Math.hypot(dx, dz);
      if (d > r) continue;
      const k = (r - d) / r;
      danger += k;
      fx += (d > 0.1 ? dx / d : 1) * k;
      fz += (d > 0.1 ? dz / d : 0) * k;
    }
    if (danger > 0) {
      // out of the ring: away from its middle, bent in from the edge
      const pr = Math.hypot(px, pz);
      if (pr > A.R - 4) {
        const out = (fx * px + fz * pz) / (pr || 1);
        if (out > 0) (fx -= (px / pr) * out * 1.4), (fz -= (pz / pr) * out * 1.4);
      }
      const l = Math.hypot(fx, fz) || 1;
      m.input.set(fx / l, 0, fz / l);
      // (a quick one dives clear when it's deep in)
      if (danger > 0.55 && this.rnd() < 0.04 * this.skill) m.dash = true;
      return;
    }
    if (t >= this.nextThink) {
      this.nextThink = t + 0.6 + this.rnd() * 0.8;
      this.pick(c, all);
    }
    const dx = this.tx - px, dz = this.tz - pz;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) m.input.set(0, 0, 0);
    else m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 2.5) * 0.85);
  }

  /** a spot: not near the edge, not near the others, not under a ring */
  private pick(c: Course, all: Marble[]) {
    const A = c.storm!;
    const m = this.m;
    let best = -1e9;
    for (let k = 0; k < 10; k++) {
      const a = this.rnd() * Math.PI * 2, r = (A.R - 4.5 + this.skill) * Math.sqrt(this.rnd());
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let crowd = 0;
      for (const o of all) {
        if (o === m || !o.active) continue;
        const d = Math.hypot(o.pos.x - A.center.x - x, o.pos.z - A.center.z - z);
        if (d < 3.5) crowd += (3.5 - d) / 3.5;
      }
      const far = Math.hypot(m.pos.x - A.center.x - x, m.pos.z - A.center.z - z);
      const sc = -crowd * 2 - far * 0.12 - Math.max(0, r - (A.R - 6)) * 1.5 + this.rnd();
      if (sc > best) (best = sc), (this.tx = x), (this.tz = z);
    }
  }
}

export class TideBrain {
  private target = -1;
  private nextThink = 0;
  private pushCD = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {}

  update(dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    const A = c.tide!;
    const L = A.level(t);
    this.pushCD -= dt;
    const here = this.colAt(c, m.pos.x, m.pos.z);
    if (t >= this.nextThink || this.target < 0 || A.cols[this.target].y < L + 0.5) {
      this.nextThink = t + 0.5 + (1 - this.skill) * 0.8 + this.rnd() * 0.5;
      this.target = this.pick(c, all, L);
    }
    if (this.target < 0) return;
    const tg = A.cols[this.target];
    let dx = tg.x - m.pos.x, dz = tg.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    // on it: hold the middle (and an aggressive one shoves a neighbour off)
    if (d < 1.0 && here === this.target) {
      if (this.aggr > 0.5 && this.pushCD <= 0) {
        for (const o of all) {
          if (o === m || !o.active || Math.abs(o.pos.y - m.pos.y) > 0.8) continue;
          const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z, od = Math.hypot(ox, oz);
          if (od < 1.6 && od > 0.2 && this.rnd() < 0.02 * this.aggr) {
            m.input.set(ox / od, 0, oz / od);
            m.dash = true;
            this.pushCD = 3 + this.rnd() * 3;
            return;
          }
        }
      }
      m.input.set(dx, 0, dz).multiplyScalar(d > 0.25 ? 0.6 / d : 0);
      return;
    }
    // the way there, a column at a time: the neighbour no more than a step up that gets nearest
    let wx = tg.x, wz = tg.z;
    if (here >= 0 && here !== this.target) {
      const hy = A.cols[here].y;
      let bw = Infinity;
      for (let i = 0; i < A.cols.length; i++) {
        const k = A.cols[i];
        if (i === here || Math.hypot(k.x - A.cols[here].x, k.z - A.cols[here].z) > TIDE.pitch * 1.15) continue;
        if (k.y > hy + TIDE.step + 0.05 || k.y < L + 0.3) continue;
        const sc = Math.hypot(tg.x - k.x, tg.z - k.z) - (k.y - hy) * 0.8;
        if (sc < bw) (bw = sc), (wx = k.x), (wz = k.z);
      }
      // (nowhere better than here: stay)
      if (bw >= Math.hypot(tg.x - A.cols[here].x, tg.z - A.cols[here].z)) (wx = A.cols[here].x), (wz = A.cols[here].z);
    }
    dx = wx - m.pos.x;
    dz = wz - m.pos.z;
    const dw = Math.hypot(dx, dz) || 1;
    dx /= dw;
    dz /= dw;
    m.input.set(dx, 0, dz).multiplyScalar(dw < 0.4 ? 0 : 0.75 + 0.25 * this.skill);
    // the next column on the way: a step up, hop it
    if (m.grounded) {
      const hereY = here >= 0 ? A.cols[here].y : m.pos.y - 0.5;
      const ahead = this.colAt(c, m.pos.x + dx * 1.8, m.pos.z + dz * 1.8);
      if (ahead >= 0 && ahead !== here && A.cols[ahead].y > hereY + 0.3 && this.rnd() < 0.35 + 0.6 * this.skill) m.jump = true;
    }
  }

  private colAt(c: Course, x: number, z: number) {
    const A = c.tide!;
    let best = -1, bd = TIDE.pitch * 0.58;
    for (let i = 0; i < A.cols.length; i++) {
      const d = Math.hypot(A.cols[i].x - x, A.cols[i].z - z);
      if (d < bd) (bd = d), (best = i);
    }
    return best;
  }

  private pick(c: Course, all: Marble[], L: number) {
    const A = c.tide!;
    const m = this.m;
    let best = -1, bs = -1e9;
    for (let i = 0; i < A.cols.length; i++) {
      const k = A.cols[i];
      if (k.y < L + 0.6) continue;
      const d = Math.hypot(k.x - m.pos.x, k.z - m.pos.z);
      let crowd = 0;
      for (const o of all) {
        if (o === m || !o.active) continue;
        const od = Math.hypot(o.pos.x - k.x, o.pos.z - k.z);
        if (od < 1.8 && Math.abs(o.pos.y - 0.5 - k.y) < 1) crowd++;
      }
      const sc = (k.y - L) * (1.3 + this.skill) - d * 0.35 - crowd * (1.6 - this.aggr * 0.8) + this.rnd() * (1.6 - this.skill);
      if (sc > bs) (bs = sc), (best = i);
    }
    return best;
  }
}
