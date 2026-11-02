import * as THREE from 'three';
import type { Course } from './courses.ts';
import type { Marble } from './physics.ts';

/**
 * The team round: a bot picks a patch of floor that isn't its team's colour (other teams' paint
 * first, the nearer the better, a little nudge toward places its teammates aren't), runs there and
 * paints its way across; now and then it dives into a rival close ahead. It steers round the
 * turntable's fins and the bumpers only by luck, like a bean would.
 */

const P = new THREE.Vector3();

export class TeamBrain {
  private tgt = new THREE.Vector3();
  private has = false;
  private nextPick = 0;
  private stuckT = 0;
  private diveCD = 1;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    readonly aggr: number,
  ) {}

  update(dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m, A = c.team!;
    const team = A.of.get(m.id) ?? 0;
    if (!this.has || t > this.nextPick || Math.hypot(this.tgt.x - m.pos.x, this.tgt.z - m.pos.z) < 0.8) {
      // a few looks round: the best tile to go and paint
      let best = -1e9;
      for (let k = 0; k < 18; k++) {
        const a = this.rnd() * Math.PI * 2, r = 1.5 + this.rnd() * (3 + 6 * this.skill);
        const x = m.pos.x + Math.cos(a) * r, z = m.pos.z + Math.sin(a) * r;
        const i = A.cellAt(x, z);
        if (i < 0) continue;
        const cx = x - A.center.x, cz = z - A.center.z;
        if (cx * cx + cz * cz < 4.2 * 4.2) continue;
        const v = A.cells[i];
        let sc = v === team + 1 ? -2 : v === 0 ? 1 : 1.3 + 0.4 * this.skill;
        // (patches around it of other colours are worth more)
        for (const [dx, dz] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) {
          const j = A.cellAt(x + dx, z + dz);
          if (j >= 0 && A.cells[j] !== team + 1) sc += 0.25;
        }
        sc -= r * 0.07;
        // (away from the walls)
        if (Math.abs(cx) > A.half - 1 || Math.abs(cz) > A.half - 1) sc -= 0.8;
        sc += (this.rnd() - 0.5) * (1.2 - this.skill);
        if (sc > best) {
          best = sc;
          this.tgt.set(x, A.center.y, z);
          this.has = true;
        }
      }
      this.nextPick = t + 0.7 + this.rnd() * (1.6 - this.skill);
    }
    P.set(this.tgt.x - m.pos.x, 0, this.tgt.z - m.pos.z);
    const d = P.length();
    if (d > 0.01) P.multiplyScalar(1 / d);
    const pace = 0.82 + 0.18 * this.skill;
    m.input.copy(P).multiplyScalar(pace * Math.min(1, 0.4 + d));
    // stuck against something: hop
    const sp = Math.hypot(m.vel.x, m.vel.z);
    this.stuckT = sp < 0.8 && d > 1 ? this.stuckT + dt : 0;
    if (this.stuckT > 0.6) {
      m.jump = true;
      this.stuckT = 0;
      this.nextPick = t;
    }
    // a rival right in front: dive into it now and then
    this.diveCD -= dt;
    if (this.diveCD <= 0) {
      this.diveCD = 0.5;
      for (const o of all) {
        if (o === m || !o.active || (A.of.get(o.id) ?? 0) === team) continue;
        const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
        const od = Math.hypot(ox, oz);
        if (od < 2.4 && (ox * P.x + oz * P.z) / (od || 1) > 0.7 && this.rnd() < 0.25 * this.aggr + 0.05) {
          m.input.set(ox / od, 0, oz / od);
          m.dash = true;
          this.diveCD = 2.5;
          break;
        }
      }
    }
  }
}
