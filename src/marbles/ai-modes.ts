import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import * as THREE from 'three';
import { BELT, CALL, shownTiles, type BeltRow } from './course-modes.ts';
import { Pop, popValue, type Balloon } from './course-bounce.ts';
import { dodge } from './course-strikes.ts';
import { KEEP, type KeepArena } from './course-crown.ts';

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
    // (a switch is a new call: it can't know until it's made, and it's slow off the mark like anyone)
    const swapped = call.fake >= 0 && x >= call.swap + this.react + ease * 0.4;
    const key = call.i * 2 + (swapped ? 1 : 0);
    if (key !== this.seen && x > call.t0 + this.react + ease * 0.55 + this.rnd() * 0.25) {
      this.seen = key;
      this.k = this.pick(shownTiles(call, swapped ? call.swap + 1e-3 : x), A.xz, all);
      // (a bean in a panic runs for the wrong colour now and then: more as the calls come faster)
      if (this.rnd() < ease * (0.2 - 0.14 * this.skill) * Math.min(1, call.i / 24)) this.k = Math.floor(this.rnd() * CALL.n * CALL.n);
    }
    if (this.k < 0) {
      // (between calls: back toward the middle)
      const d = Math.hypot(A.center.x - m.pos.x, A.center.z - m.pos.z);
      if (d > 4) m.input.set((A.center.x - m.pos.x) / d, 0, (A.center.z - m.pos.z) / d).multiplyScalar(0.6);
      return;
    }
    if (this.seen >> 1 !== call.i) return;
    const [tx, tz] = A.xz(this.k);
    const dx = tx - m.pos.x, dz = tz - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      // on it, a good one might shove a neighbour off
      if (this.aggr > 0.6 && call.i >= 6 && x > call.drop - 1 && x < call.drop) {
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

/**
 * Bounce House: it picks the balloon that's worth the steering, keeps clear of the thunder ones, and
 * times a super bounce for a high one (how often it gets that right is how good it is).
 */
export class BounceBrain {
  private target: Balloon | null = null;
  private next = 0;
  private hx: number;
  private hz: number;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {
    const a = rnd() * Math.PI * 2, r = 3 + rnd() * 9;
    this.hx = Math.cos(a) * r;
    this.hz = Math.sin(a) * r;
  }
  update(_dt: number, t: number, c: Course, live: Balloon[], popped: Set<number>, ease: number) {
    const m = this.m, A = c.bounce!;
    const x = t - c.state.go;
    if (t >= this.next || !this.target || popped.has(this.target.k)) {
      this.next = t + 0.3 + (1 - this.skill) * 0.5 + ease * 0.5;
      let bs = -Infinity;
      this.target = null;
      for (const q of live) {
        if (q.kind === Pop.Thunder || popped.has(q.k) || q.t + 0.5 > x) continue;
        A.at(q, x, BP);
        const d = Math.hypot(BP.x - m.pos.x, BP.z - m.pos.z);
        const sc = popValue(q.kind) ** 0.6 / (d + 2.5) + this.rnd() * (0.14 - 0.1 * this.skill);
        if (sc > bs) (bs = sc), (this.target = q);
      }
    }
    let gx = A.center.x + this.hx, gz = A.center.z + this.hz, high = false;
    if (this.target) {
      A.at(this.target, x, BP);
      gx = BP.x;
      gz = BP.z;
      high = this.target.h > 3.3;
    }
    let dx = gx - m.pos.x, dz = gz - m.pos.z;
    // (round a thunder balloon in the way)
    for (const q of live) {
      if (q.kind !== Pop.Thunder || popped.has(q.k)) continue;
      A.at(q, x, BP);
      const ox = m.pos.x - BP.x, oz = m.pos.z - BP.z, od = Math.hypot(ox, oz);
      if (od < 2.6 && Math.abs(m.pos.y - BP.y) < 2.4 && this.rnd() < 0.4 + 0.6 * this.skill) {
        dx += (ox / (od + 0.1)) * 5;
        dz += (oz / (od + 0.1)) * 5;
      }
    }
    const d = Math.hypot(dx, dz);
    if (d > 0.2) m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 2 + 0.2));
    // the super bounce: pressed on the way down, as it nears the floor
    if (high && m.vel.y < -6 && m.pos.y - A.center.y < 2.2 && this.rnd() < (0.1 + 0.3 * this.skill) * (1 - 0.5 * ease)) m.jump = true;
  }
}
const BP = new THREE.Vector3();

/**
 * Crown Keeper. With it: get up to the throne if the way's clear (its clock runs double), else keep
 * away from them all. Without it: go and get it, by the way that's actually there: a carpet from
 * the outer courtyard, a hop pad from the inner one. Everyone watches the bars, the cannon rings and
 * the flagstones about to go.
 */
export class KeepBrain {
  private wander = 0;
  private wx = 0;
  private wz = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {}
  /** which carpet a spot is on (its angle), if any */
  private carpet(A: KeepArena, x: number, z: number) {
    const px = x - A.center.x, pz = z - A.center.z;
    for (const a of A.ramps) {
      const along = px * Math.cos(a) + pz * Math.sin(a), side = Math.abs(-px * Math.sin(a) + pz * Math.cos(a));
      if (side <= KEEP.rampW / 2 + 0.2 && along >= KEEP.keepR - 0.4 && along <= KEEP.foot + 0.3) return a;
    }
    return null;
  }
  /** run for (x, z, y) by a way that's there: a carpet from its foot, a hop pad from the inner courtyard */
  private go(A: KeepArena, x: number, y: number, z: number) {
    const m = this.m, c = A.center;
    const px = m.pos.x - c.x, pz = m.pos.z - c.z, pr = Math.hypot(px, pz);
    // (beside a carpet isn't on it: its sides are walls)
    const on = m.pos.y > A.groundAt(m.pos.x, m.pos.z) + 0.25 && m.pos.y > c.y + 0.7;
    const mine = on ? this.carpet(A, m.pos.x, m.pos.z) : null, theirs = this.carpet(A, x, z);
    const top = A.onTop(m.pos);
    let gx = x, gz = z;
    if (theirs !== null && theirs !== mine && !top) {
      // (it's on a carpet: in by the foot, the sides are walls)
      gx = c.x + Math.cos(theirs) * (KEEP.foot + 0.8);
      gz = c.z + Math.sin(theirs) * (KEEP.foot + 0.8);
      if (pr < KEEP.foot - 0.4 && y > c.y + 1.2) {
        // (or from above, if we're nearer a hop)
        ({ gx, gz } = this.hop(A, gx, gz));
      }
    } else if (y > c.y + 1.6 && !top && mine === null) {
      if (pr > KEEP.foot - 0.4) {
        let best = Infinity;
        for (const a of A.ramps) {
          const fx = c.x + Math.cos(a) * (KEEP.foot + 0.6), fz = c.z + Math.sin(a) * (KEEP.foot + 0.6);
          const d = Math.hypot(fx - m.pos.x, fz - m.pos.z);
          if (d < best) {
            best = d;
            gx = d < 1.6 ? c.x : fx;
            gz = d < 1.6 ? c.z : fz;
          }
        }
      } else ({ gx, gz } = this.hop(A, gx, gz));
    } else if (y > c.y + 1.6 && mine !== null && !top) {
      // (on a carpet already: straight up it)
      gx = c.x;
      gz = c.z;
    }
    const dx = gx - m.pos.x, dz = gz - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.1) m.input.set(dx / d, 0, dz / d);
  }
  private hop(A: KeepArena, gx: number, gz: number) {
    const m = this.m;
    let best = Infinity;
    for (const p of A.pads) {
      if (p.kind !== 'hop') continue;
      const d = Math.hypot(p.x - m.pos.x, p.z - m.pos.z);
      if (d < best) {
        best = d;
        gx = p.x;
        gz = p.z;
      }
    }
    return { gx, gz };
  }
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.keep!;
    const x = t - c.state.go;
    const px = m.pos.x - A.center.x, pz = m.pos.z - A.center.z, pr = Math.hypot(px, pz);
    // the bars: a hop as one comes round (they only reach the outer courtyard)
    const a = A.bar(x + 0.22);
    if (a !== null && m.grounded && pr > KEEP.foot - 0.5) {
      const side = Math.abs(px * Math.sin(a) + pz * Math.cos(a));
      if (side < 1.1 && this.rnd() < 0.3 + 0.6 * this.skill) m.jump = true;
    }
    const mine = A.holder === m.id;
    if (mine) {
      // run from whoever's near; with nobody near, up to the throne
      let fx = 0, fz = 0, closest = Infinity;
      for (const o of all) {
        if (o === m || !o.active) continue;
        const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z, d = Math.hypot(dx, dz) || 1;
        closest = Math.min(closest, d);
        if (d < 9) (fx += (dx / d) * (9 - d)), (fz += (dz / d) * (9 - d));
      }
      const lim = A.onTop(m.pos) ? KEEP.keepR - 1.4 : KEEP.rim - 1;
      // (the throne's only worth it while it's hot, or about to be)
      const hot = A.hot(x + 2.2);
      if (hot && A.onTop(m.pos) && closest > 3.2) {
        // (sitting pretty: stay near the middle and let the clock run)
        if (pr > 1.5) m.input.set(-px / pr, 0, -pz / pr).multiplyScalar(0.6);
      } else if (hot && closest > 5.5 - 2 * ease) this.go(A, A.center.x, A.center.y + KEEP.top, A.center.z);
      else {
        if (pr > lim) {
          const k = (pr - lim) * 3;
          fx -= (px / pr) * k;
          fz -= (pz / pr) * k;
        }
        const l = Math.hypot(fx, fz);
        if (l > 0.05) m.input.set(fx / l, 0, fz / l);
        // (nobody near: a lap of the inner courtyard, so it isn't a sitting duck)
        else if (pr > 0.5) m.input.set(-pz / pr, 0, px / pr).multiplyScalar(0.7);
      }
    } else {
      let tx = A.x, tz = A.z, ty = A.groundAt(A.x, A.z);
      const h = A.holder >= 0 ? all.find((o) => o.id === A.holder) : null;
      if (h) {
        // (it leads a runner, a better one by more)
        const lead = 0.15 + 0.3 * this.skill;
        tx = h.pos.x + h.vel.x * lead;
        tz = h.pos.z + h.vel.z * lead;
        ty = h.pos.y;
      }
      // (not everyone piles straight in: some come round the side, so a scrum has somewhere to go)
      if (t > this.wander) {
        this.wander = t + 1.4 + this.rnd() * 1.6;
        const q = this.rnd() * Math.PI * 2, w = this.rnd() < 0.5 ? 0 : 1.5 + 3 * ease;
        this.wx = Math.cos(q) * w;
        this.wz = Math.sin(q) * w;
      }
      const d0 = Math.hypot(tx - m.pos.x, tz - m.pos.z);
      if (d0 > 5) (tx += this.wx), (tz += this.wz);
      this.go(A, tx, ty, tz);
      if (h && d0 < 3.6 && d0 > 0.9 && m.grounded && this.rnd() < (0.09 + 0.16 * this.skill) * (1 - 0.6 * ease)) m.dash = true;
      // (a crown in the air: a hop as it goes over)
      if (!h && d0 < 2 && m.grounded && this.rnd() < 0.1) m.jump = true;
    }
    // the floor: in from the edge and off anything about to go
    const ahead = 1.2 + 1.4 * this.skill;
    if (!A.onTop(m.pos) && m.pos.y < A.center.y + 1 && pr > KEEP.rim - 1 && !A.solid(m.pos.x + m.input.x * 2.2, m.pos.z + m.input.z * 2.2, t + ahead)) {
      m.input.set(-px / pr, 0, -pz / pr);
      return;
    }
    if (pr > KEEP.R - 1.4 && pr > 0) {
      m.input.set(-px / pr, 0, -pz / pr);
      return;
    }
    // the cannon rings: out of them, if it's seen them
    const away = dodge(A.blast, m, x, 1.3 - 0.9 * this.skill) ?? dodge(A.shots, m, x, 0.5 - 0.35 * this.skill);
    if (away) m.input.set(away[0], 0, away[1]);
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
