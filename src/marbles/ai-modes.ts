import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { BELT, CALL, GOLD, type BeltRow, type Coin } from './course-modes.ts';

/** The bots for the four party games (course-modes.ts). */

/** Colour Call: when a colour is called, off to the nearest tile of it that isn't crowded */
export class CallBrain {
  private k = -1;
  private seen = -1;
  private react: number;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {
    this.react = 0.75 - 0.6 * skill;
  }
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.call!;
    const x = t - c.state.go;
    const call = A.at(x);
    if (call.i !== this.seen && x > call.t0 + this.react + ease * 0.55 + this.rnd() * 0.25) {
      this.seen = call.i;
      this.k = this.pick(call.safe, A.xz, all);
      // (a bean in a panic runs for the wrong colour now and then)
      if (this.rnd() < ease * (0.2 - 0.14 * this.skill)) this.k = Math.floor(this.rnd() * CALL.n * CALL.n);
    }
    if (this.k < 0) {
      // (between calls: back toward the middle)
      const d = Math.hypot(A.center.x - m.pos.x, A.center.z - m.pos.z);
      if (d > 4) m.input.set((A.center.x - m.pos.x) / d, 0, (A.center.z - m.pos.z) / d).multiplyScalar(0.6);
      return;
    }
    if (call.i !== this.seen) return;
    const [tx, tz] = A.xz(this.k);
    const dx = tx - m.pos.x, dz = tz - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      // on it, a good one might shove a neighbour off
      if (this.aggr > 0.6 && x > call.drop - 1 && x < call.drop) {
        for (const o of all) {
          if (o === m || !o.active) continue;
          const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z, od = Math.hypot(ox, oz);
          if (od < 1.5 && od > 0.2 && this.rnd() < 0.015 * this.aggr) {
            m.input.set(ox / od, 0, oz / od);
            m.dash = true;
            return;
          }
        }
      }
      return;
    }
    m.input.set(dx / d, 0, dz / d).multiplyScalar(d < 1.6 ? Math.max(0.35, d / 1.6) : 1);
    // (late and a way off: a dive makes the difference)
    const left = call.drop - x;
    if (left < d / 9 + 0.3 && d > 2 && d < 5 && m.grounded && this.rnd() < 0.06 * this.skill) m.dash = true;
  }
  private pick(safe: number[], xz: (k: number) => [number, number], all: Marble[]) {
    const m = this.m;
    let best = -1, bs = Infinity;
    for (const k of safe) {
      const [x, z] = xz(k);
      let sc = Math.hypot(x - m.pos.x, z - m.pos.z);
      for (const o of all) {
        if (o === m || !o.active) continue;
        if (Math.hypot(o.pos.x - x, o.pos.z - z) < CALL.tile * 0.7) sc += 2.2;
      }
      sc += this.rnd() * (3.5 - 3 * this.skill);
      if (sc < bs) (bs = sc), (best = k);
    }
    return best;
  }
}

/** Hot Spud: with one, run down the nearest bean without one. Without, keep away from whoever has */
export class SpudBrain {
  private tx = 0;
  private tz = 0;
  private next = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {}
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.spud!;
    const hold = A.holders.has(m.id);
    let nx = 0, nz = 0, nd = Infinity;
    let fx = 0, fz = 0;
    for (const o of all) {
      if (o === m || !o.active) continue;
      const other = A.holders.has(o.id);
      const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      const far = d + (A.people.has(o.id) ? ease * 2.5 : 0);
      if (hold && !other && far < nd) (nd = far), (nx = dx / (d || 1)), (nz = dz / (d || 1));
      if (!hold && other && d < 9) {
        const k = (9 - d) / 9;
        fx -= (dx / (d || 1)) * k;
        fz -= (dz / (d || 1)) * k;
      }
    }
    if (hold) {
      if (nd === Infinity) return;
      // (it leads a runner a little)
      m.input.set(nx, 0, nz);
      if (nd < 3.2 && nd > 1.2 && this.rnd() < 0.05 + 0.1 * this.skill) m.dash = true;
      return;
    }
    // the wall and the drums push it off too, or it gets cornered
    const px = m.pos.x - A.center.x, pz = m.pos.z - A.center.z, pr = Math.hypot(px, pz);
    if (pr > A.R - 5) {
      const k = ((pr - (A.R - 5)) / 5) * (0.9 + this.skill);
      fx -= (px / pr) * k;
      fz -= (pz / pr) * k;
    }
    for (const p of A.posts) {
      const dx = m.pos.x - p.x, dz = m.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < p.r + 2) {
        fx += (dx / d) * 0.7;
        fz += (dz / d) * 0.7;
      }
    }
    const l = Math.hypot(fx, fz);
    if (l > 0.08) {
      m.input.set(fx / l, 0, fz / l).multiplyScalar(0.7 + 0.25 * this.skill);
      return;
    }
    if (t >= this.next) {
      this.next = t + 1 + this.rnd() * 1.4;
      const a = this.rnd() * Math.PI * 2, r = (A.R - 6) * Math.sqrt(this.rnd());
      this.tx = A.center.x + Math.cos(a) * r;
      this.tz = A.center.z + Math.sin(a) * r;
    }
    const dx = this.tx - m.pos.x, dz = this.tz - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.8) m.input.set(dx / d, 0, dz / d).multiplyScalar(0.7);
  }
}

/** Gold Rush: the best coin for the running (a big one's worth a detour), and clear of the edge */
export class GoldBrain {
  private target: Coin | null = null;
  private next = 0;
  private shoveCD = 0;
  /** its own patch of the beach (a pack of bots after one coin is no game) */
  private hx: number;
  private hz: number;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {
    const a = rnd() * Math.PI * 2, r = 4 + rnd() * 8;
    this.hx = Math.cos(a) * r;
    this.hz = Math.sin(a) * r;
  }
  update(dt: number, t: number, c: Course, all: Marble[], live: Coin[], taken: Set<number>, ease: number) {
    const m = this.m, A = c.gold!;
    this.shoveCD -= dt;
    const x = t - c.state.go;
    if (t >= this.next || !this.target || taken.has(this.target.k)) {
      this.next = t + 0.25 + (1 - this.skill) * 0.5 + ease * 0.45;
      let bs = -Infinity;
      this.target = null;
      for (const k of live) {
        if (taken.has(k.k) || k.t + GOLD.fly - x > 0.3 - ease * 0.45) continue;
        const d = Math.hypot(k.x - m.pos.x, k.z - m.pos.z);
        const away = Math.hypot(k.x - A.center.x - this.hx, k.z - A.center.z - this.hz);
        const sc = (k.v > 1 ? 2.5 : 1) / (d + 2.5) - away * 0.012 + this.rnd() * (0.12 - 0.09 * this.skill);
        if (sc > bs) (bs = sc), (this.target = k);
      }
    }
    const px = m.pos.x - A.center.x, pz = m.pos.z - A.center.z, pr = Math.hypot(px, pz);
    if (pr > A.R - 1.2) {
      m.input.set(-px / pr, 0, -pz / pr);
      return;
    }
    // a knock spills gold: a rough one goes for whoever is right next to it
    if (this.aggr > 0.45 && this.shoveCD <= 0 && m.grounded) {
      for (const o of all) {
        if (o === m || !o.active) continue;
        const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z, od = Math.hypot(ox, oz);
        if (od < 2.2 && od > 0.3 && this.rnd() < 0.03 * this.aggr) {
          m.input.set(ox / od, 0, oz / od);
          m.dash = true;
          this.shoveCD = 2.5 + this.rnd() * 2;
          return;
        }
      }
    }
    if (!this.target) {
      const hx = A.center.x + this.hx - m.pos.x, hz = A.center.z + this.hz - m.pos.z, hd = Math.hypot(hx, hz);
      if (hd > 1) m.input.set(hx / hd, 0, hz / hd).multiplyScalar(0.7);
      return;
    }
    const dx = this.target.x - m.pos.x, dz = this.target.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.15) m.input.set(dx / d, 0, dz / d);
    // (round the chest, not into it)
    const cd = Math.hypot(px, pz);
    if (cd < GOLD.chest + 1.2 && cd > 0.1) {
      const tx = -pz / cd, tz = px / cd;
      const side = tx * dx + tz * dz > 0 ? 1 : -1;
      m.input.set(tx * side + (px / cd) * 0.5, 0, tz * side + (pz / cd) * 0.5).normalize();
    }
  }
}

const ROWS: BeltRow[] = [];
/** Belt Rush: stay up the belt, in a lane that's free at the next row; hop the low ones */
export class BeltBrain {
  private lane = -1;
  private look = -1;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {}
  update(_dt: number, t: number, c: Course, _all: Marble[], ease: number) {
    const m = this.m, A = c.belt!;
    const x = t - c.state.go;
    A.rows(x, ROWS);
    // the next row coming at it (it's only as far-sighted as it is good)
    let row: BeltRow | null = null;
    const sight = 4 + (8 - 3.5 * ease) * this.skill;
    for (const r of ROWS) {
      if (r.z > m.pos.z - 1.6) continue;
      if (m.pos.z - r.z < sight) row = r;
      break;
    }
    const lx = (m.pos.x - A.laneX(0)) / A.lane;
    const mine = Math.max(0, Math.min(BELT.lanes - 1, Math.round(lx)));
    if (row && row.n !== this.look) {
      this.look = row.n;
      // the nearest lane it can get through; a low block is nearly as good
      let bs = Infinity;
      for (let l = 0; l < BELT.lanes; l++) {
        const sc = Math.abs(l - lx) + (row.kinds[l] === 2 ? 50 : row.kinds[l] === 1 ? 1.2 : 0) + this.rnd() * (1.5 - this.skill);
        if (sc < bs) (bs = sc), (this.lane = l);
      }
    }
    const tgtX = this.lane >= 0 ? A.laneX(this.lane) : m.pos.x;
    // hold a place about the middle of the belt, forward if pushed back
    const wantZ = A.center.z - 2 - this.skill * 4;
    const dz = wantZ - m.pos.z, dx = tgtX - m.pos.x;
    const ix = Math.max(-1, Math.min(1, dx * 1.1));
    // the belt runs at it: full ahead keeps it in place; a block dead ahead, wait to go round
    const v = A.speed(x);
    let iz = Math.max(-1, Math.min(1, (dz * 0.3 - v / 9.4)));
    const blocked = row && row.kinds[mine] === 2 && m.pos.z - row.z < 3.4 && Math.abs(dx) > 0.5;
    if (blocked) iz = Math.max(iz, -0.2);
    m.input.set(ix, 0, iz);
    const l = Math.hypot(ix, iz);
    if (l > 1) m.input.multiplyScalar(1 / l);
    m.input.multiplyScalar(1 - 0.12 * ease);
    if (row && row.kinds[mine] === 1 && m.grounded && m.pos.z - row.z < 2.9 + v * 0.1 && this.rnd() < (0.5 + 0.5 * this.skill) * (1 - 0.35 * ease)) m.jump = true;
    // (well down the belt with the edge coming: a dive forward)
    if (m.pos.z > A.center.z + 13 && m.grounded && this.rnd() < 0.05) m.dash = true;
  }
}
