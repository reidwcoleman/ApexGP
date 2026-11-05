import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { STORM, type Strike } from './course-storm.ts';
import { dodge } from './course-strikes.ts';

/**
 * The bot for Storm Deck.
 *
 * Storm Deck: it keeps a spot of its own (in from the edge, away from the others) and watches the
 * rings: any strike due soon whose blast would reach it, it runs out of (the shortest way, never
 * toward the edge). A weaker bot sees a ring later and misjudges a big one now and then.
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
    // the wave: a hop as it gets here
    const wv = A.wave(x + 0.2);
    if (wv && m.grounded && Math.abs(px * wv.ux + pz * wv.uz - wv.d) < 1.5 && this.rnd() < 0.25 + 0.6 * this.skill) m.jump = true;
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
