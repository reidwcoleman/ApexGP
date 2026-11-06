import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { ROCKET } from './course-rocket.ts';
import { CUP } from './course-soccer.ts';

/** The bots for Rocket Rumble and Bean Cup. */

/**
 * Rocket Rumble: it keeps an eye on the tank. Plenty in it, it goes hunting for a ring or a bean to
 * ram; low, it goes for the nearest pad or ring it can reach. It only burns when it has to.
 */
export class RocketBrain {
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private next = 0;
  private ram = 0;
  private rest = 0;
  private P = new THREE.Vector3();
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {}
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.rocket!;
    const x = t - c.state.go;
    const tank = (A.fuel.get(m.id) ?? ROCKET.fuel) / ROCKET.fuel;
    const air = m.groundT > 0.1;
    m.jet = false;
    // (the pad under it is shaking: time to go, whatever's in the tank)
    let doomed = false;
    if (!air)
      for (const p of A.pads)
        if (x > p.out - ROCKET.warn && Math.hypot(A.center.x + p.x - m.pos.x, A.center.z + p.z - m.pos.z) < p.r + 0.6) doomed = true;
    if (doomed) this.rest = 0;
    if (t > this.next) {
      this.next = t + 0.35 + (1 - this.skill) * 0.5 + ease * 0.4;
      // somewhere to land that isn't about to go
      let bd = Infinity;
      let px = A.center.x, py = A.center.y, pz = A.center.z;
      for (const p of A.pads) {
        if (x > p.out - ROCKET.warn - 1.5) continue;
        const y = A.padY(p, x);
        if (y === null) continue;
        const wx = A.center.x + p.x, wz = A.center.z + p.z;
        const d = Math.hypot(wx - m.pos.x, wz - m.pos.z);
        if (d < bd) (bd = d), (px = wx), (py = y), (pz = wz);
      }
      // the nearest ring
      let rd = Infinity;
      for (let i = 0; i < A.rings.length; i++) {
        if (x >= A.rings[i].out) continue;
        A.ringAt(i, x + 0.5, this.P);
        const d = this.P.distanceTo(m.pos);
        if (d < rd) {
          rd = d;
          if (tank < 0.6 || (t > this.rest && tank > 0.5)) (this.tx = this.P.x), (this.ty = this.P.y), (this.tz = this.P.z);
        }
      }
      const home = tank < 0.55 ? bd < rd * 1.3 : t < this.rest;
      if (home || rd === Infinity) (this.tx = px), (this.ty = py + 0.6), (this.tz = pz);
      // a rest on a pad before the next trip
      if (!air && tank < 0.8 && t > this.rest) this.rest = t + 1.6 + this.rnd() * 1.8;
      if (!air && tank > 0.9) this.rest = 0;
    }
    const dx = this.tx - m.pos.x, dz = this.tz - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.5) m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 2 + 0.2));
    // (under a pad it can only bang its head: out past the rim first, then up and over)
    for (const p of A.pads) {
      const py = A.padY(p, x);
      if (py === null || m.pos.y > py - 0.1 || m.pos.y < py - 6) continue;
      const ox = m.pos.x - A.center.x - p.x, oz = m.pos.z - A.center.z - p.z, od = Math.hypot(ox, oz) || 1;
      if (od < p.r + 1.3) {
        m.input.set(ox / od, 0, oz / od);
        break;
      }
    }
    // round the mines
    for (const k of A.mines) {
      const ox = m.pos.x - k.pos.x, oy = m.pos.y - k.pos.y, oz = m.pos.z - k.pos.z;
      const od = Math.hypot(ox, oy, oz);
      if (od < 3.6 && this.rnd() < 0.3 + 0.6 * this.skill) m.input.x += (ox / od) * 1.4, (m.input.z += (oz / od) * 1.4);
    }
    if (m.input.lengthSq() > 1) m.input.normalize();
    if (m.mode === Mode.Tumble) return;
    // burn: to get off a pad, to get up to what it's after, and to stop a fall
    const fall = m.vel.y < -5;
    const below = m.pos.y + m.vel.y * 0.3 < this.ty + 0.8;
    if (!air) {
      if (t > this.rest && d > 2.5 && (tank > 0.25 || doomed)) {
        m.jump = true;
        m.jet = true;
      }
    } else if (below || fall) m.jet = true;
    // the ram: someone close by in the open air
    // (not in the opening stretch: everyone's still finding their feet)
    if (air && x > 12 && t > this.ram && m.dashCD <= 0 && tank > 0.25) {
      for (const o of all) {
        if (o === m || !o.active) continue;
        const ox = o.pos.x - m.pos.x, oy = o.pos.y - m.pos.y, oz = o.pos.z - m.pos.z, od = Math.hypot(ox, oz);
        if (od < 1 || od > 6 || Math.abs(oy) > 2.2) continue;
        this.ram = t + 2.6 + this.rnd() * 3.4;
        if (this.rnd() < this.aggr * (0.35 + 0.5 * this.skill) * (1 - 0.5 * ease)) {
          m.input.set(ox / od, 0, oz / od);
          m.dash = true;
        }
        break;
      }
    }
  }
}

const G = new THREE.Vector3(), W = new THREE.Vector3();

/**
 * Bean Cup: a team that plays like one. The two or three nearest the ball go for it, coming round
 * behind it so it goes the right way; the rest hold a shape that slides with the ball, and one
 * stays home in goal. Near enough, it dives through the ball for a shot, or to clear it.
 */
export class CupBrain {
  private think = 0;
  private chase = false;
  private keeper = false;
  private slot = 0;
  private n = 1;
  private shotT = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {}
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.cup!;
    const team = A.of.get(m.id) ?? 0, dir = team === 0 ? 1 : -1;
    const y0 = A.center.y;
    let ball = null, bd = Infinity;
    for (const b of A.balls) {
      if (!b.live) continue;
      const d = b.pos.distanceToSquared(m.pos);
      if (d < bd) (bd = d), (ball = b);
    }
    if (t > this.think) {
      this.think = t + 0.18 + (1 - this.skill) * 0.25 + ease * 0.2 + this.rnd() * 0.1;
      const mates = all.filter((o) => o.active && (A.of.get(o.id) ?? 0) === team).sort((p, q) => p.id - q.id);
      this.n = mates.length;
      this.slot = mates.indexOf(m);
      this.keeper = this.n >= 4 && this.slot === 0;
      if (ball) {
        const mine = bd;
        let closer = 0;
        for (const o of mates) if (o !== m && o.pos.distanceToSquared(ball.pos) < mine) closer++;
        this.chase = closer < (this.n >= 9 ? 3 : this.n >= 5 ? 2 : 1);
      }
    }
    A.goal(team, G);
    const own = A.center.z - dir * CUP.HL;
    if (!ball) {
      // (a goal's just gone in: back to the middle)
      W.set(A.center.x + (this.slot - this.n / 2) * 4, y0, A.center.z - dir * 10);
    } else if (this.keeper) {
      const x = THREE.MathUtils.clamp(ball.pos.x - A.center.x, -CUP.goalHalf + 1.5, CUP.goalHalf - 1.5) * 0.7;
      W.set(A.center.x + x, y0, own + dir * 3);
    }
    const near = !!ball && this.keeper && Math.abs(ball.pos.z - own) < 13 && Math.abs(ball.pos.x - A.center.x) < 13;
    if (!ball || (this.keeper && !near)) {
      // (set above)
    } else if (this.chase || near) {
      // the spot behind the ball, on the line from the goal through it
      W.subVectors(ball.pos, G).setY(0);
      const l = W.length() || 1;
      W.multiplyScalar((CUP.R + 1.1) / l).add(ball.pos);
      // (on the wrong side of it: round, not through)
      const wrong = (ball.pos.z - m.pos.z) * dir < -0.5;
      if (wrong) W.x += (m.pos.x > ball.pos.x ? 1 : -1) * 3.2;
      const dW = Math.hypot(W.x - m.pos.x, W.z - m.pos.z);
      // (lined up: straight through it at the goal)
      if (dW < 1.5 && !wrong) W.copy(G);
    } else {
      // the shape: spread across the pitch, sliding up and down behind the ball
      const lanes = Math.max(1, this.n - 1);
      const lane = ((this.slot + 0.5) / lanes - 0.5) * (CUP.HW * 1.6);
      const back = this.slot % 2 ? 6 : 15;
      const z = THREE.MathUtils.clamp(ball.pos.z - dir * back, A.center.z - CUP.HL + 5, A.center.z + CUP.HL - 5);
      W.set(A.center.x + lane + (ball.pos.x - A.center.x) * 0.35, y0, z);
    }
    const dx = W.x - m.pos.x, dz = W.z - m.pos.z, d = Math.hypot(dx, dz);
    const go = this.chase || this.keeper ? 1 : Math.min(1, d / 3);
    if (d > 0.5) m.input.set(dx / d, 0, dz / d).multiplyScalar(go);
    else m.input.set(0, 0, 0);
    if (!ball || m.mode !== Mode.Run) return;
    const bx = ball.pos.x - m.pos.x, bz = ball.pos.z - m.pos.z, bdist = Math.hypot(bx, bz);
    const height = ball.pos.y - y0 - CUP.R;
    if (bdist < 3.4 && height > 1.4 && height < 4.5 && this.rnd() < 0.2 * this.skill) m.jump = true;
    if (t < this.shotT || bdist > 3 || height > 1.6) return;
    // a shot or a clearance: heading at the ball, the ball's between it and somewhere useful
    const toGoal = Math.hypot(G.x - ball.pos.x, G.z - ball.pos.z);
    const lined = (bz * dir > 0.2 && Math.abs(bx) < 2.4 + 1.2 * this.skill);
    const panic = Math.abs(ball.pos.z - own) < 16;
    if (lined && (toGoal < 26 || panic) && this.rnd() < 0.3 + 0.5 * this.skill - ease * 0.2) {
      this.shotT = t + 1.6 + this.rnd() * 1.4;
      m.input.set(bx / (bdist || 1), 0, bz / (bdist || 1));
      m.dash = true;
    }
  }
}
