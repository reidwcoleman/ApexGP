import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { ROCKET } from './course-rocket.ts';

/** The bots for Rocket Rumble and the ball games (Bean Cup, Big Push, Over the Fence). */

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
  update(dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.cup!, CUP = A.cfg;
    if (CUP.rule === 'fence') return this.fence(dt, t, c, all, ease);
    if (CUP.rule === 'volley') return this.volley(dt, t, c, all, ease);
    const push = CUP.rule === 'push';
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
      this.keeper = !push && CUP.rule !== 'hoops' && this.n >= 4 && this.slot === 0;
      if (ball) {
        const mine = bd;
        let closer = 0;
        for (const o of mates) if (o !== m && o.pos.distanceToSquared(ball.pos) < mine) closer++;
        // (Big Push: it takes a crowd to move it, so most of the team piles in)
        this.chase = closer < (push ? Math.max(2, Math.ceil(this.n * 0.7)) : this.n >= 9 ? 3 : this.n >= 5 ? 2 : 1);
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
      // (on the wrong side of it: round, not through. Out to the side first, clear of it, then
      // past it; running straight at the spot behind would shove the ball at its own goal)
      const wrong = (ball.pos.z - m.pos.z) * dir < -0.5;
      if (wrong) {
        const room = CUP.HW - CUP.R * 2 - 2.5, off = ball.pos.x - A.center.x;
        const side = off > room ? -1 : off < -room ? 1 : m.pos.x > ball.pos.x ? 1 : -1;
        const clearX = ball.pos.x + side * (CUP.R + 2.1);
        if ((m.pos.x - ball.pos.x) * side < CUP.R + 1.4) W.set(clearX, y0, m.pos.z + dir * 0.5);
        else W.set(clearX, y0, ball.pos.z - dir * (CUP.R + 1.6));
      }
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
    // (Bean Hoops: it only goes up for one under the hoop it shoots at, for the tip-in)
    if (!push && (CUP.rule !== 'hoops' || Math.hypot(G.x - ball.pos.x, G.z - ball.pos.z) < 8) && bdist < 3.4 && height > 1.4 && height < 4.5 && this.rnd() < 0.2 * this.skill) m.jump = true;
    if (t < this.shotT || bdist > CUP.R + 1.7 || height > 1.6) return;
    // a shot or a clearance: heading at the ball, the ball's between it and somewhere useful
    const toGoal = Math.hypot(G.x - ball.pos.x, G.z - ball.pos.z);
    // (Bean Hoops: anywhere the ball is between it and the hoop will do: a rebound is a shot too)
    const lined = CUP.rule === 'hoops' ? bx * (G.x - m.pos.x) + bz * (G.z - m.pos.z) > bdist * 2 : bz * dir > 0.2 && Math.abs(bx) < CUP.R + 1 + 1.2 * this.skill;
    const panic = Math.abs(ball.pos.z - own) < 16;
    // (Bean Hoops: it shoots from as far out as it fancies itself; the better it is, the further.
    // Under its own hoop it just gets rid of it)
    const range = CUP.rule === 'hoops' ? toGoal < 10 + 9 * this.skill - ease * 4 : toGoal < 26 || panic;
    if (lined && range && this.rnd() < 0.3 + 0.5 * this.skill - ease * 0.2) {
      this.shotT = t + (push || CUP.rule === 'hoops' ? 0.9 : 1.6) + this.rnd() * 1.4;
      m.input.set(bx / (bdist || 1), 0, bz / (bdist || 1));
      m.dash = true;
    }
  }

  /**
   * Volley Folly: it works out where the ball's coming down. In its own yard, the two nearest go
   * and get under it (a weaker bot reads the flight less well and sets off later); the rest spread
   * out to cover the floor. Under it in time, it jumps or dives into it to send it back over.
   */
  private land = new THREE.Vector3();
  private err = new THREE.Vector3();
  private volley(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.cup!, C = A.cfg;
    const team = A.of.get(m.id) ?? 0, dir = team === 0 ? 1 : -1;
    const y0 = A.center.y, cz = A.center.z, b = A.balls[0];
    const floor = y0 + C.R;
    // where it comes down, and when
    let eta = 0;
    if (b.live) {
      const h = Math.max(0, b.pos.y - floor);
      eta = (b.vel.y + Math.sqrt(b.vel.y * b.vel.y + 2 * C.g * h)) / C.g;
      this.land.set(b.pos.x + b.vel.x * eta * 0.94, y0, b.pos.z + b.vel.z * eta * 0.94);
      this.land.x = THREE.MathUtils.clamp(this.land.x, A.center.x - C.HW + C.R, A.center.x + C.HW - C.R);
      this.land.z = THREE.MathUtils.clamp(this.land.z, cz - C.HL + C.R, cz + C.HL - C.R);
    }
    // (it takes a moment to read a ball that's just been hit: longer for a weaker bot)
    const read = t - b.kickT > 0.22 + (1 - this.skill) * 0.5 + ease * 0.35;
    const ours = b.live && read && (this.land.z - cz) * dir < 0;
    if (t > this.think) {
      this.think = t + 0.16 + (1 - this.skill) * 0.3 + ease * 0.25 + this.rnd() * 0.1;
      const mates = all.filter((o) => o.active && (A.of.get(o.id) ?? 0) === team).sort((p, q) => p.id - q.id);
      this.n = mates.length;
      this.slot = mates.indexOf(m);
      this.chase = false;
      if (ours) {
        const mine = Math.hypot(this.land.x - m.pos.x, this.land.z - m.pos.z);
        let closer = 0;
        for (const o of mates) if (o !== m && Math.hypot(this.land.x - o.pos.x, this.land.z - o.pos.z) < mine) closer++;
        // (the nearest goes; the next one too if that's a long run)
        this.chase = closer < 1 || (closer < 2 && mine < 7 && eta > 0.5);
        // (how well it reads the flight: a new guess every look)
        const off = (1 - this.skill) * 3.2 + ease * 2.2;
        this.err.set((this.rnd() - 0.5) * off, 0, (this.rnd() - 0.5) * off);
      }
    }
    if (ours && this.chase) {
      // under it, a step back from the net so it's hit going forward
      W.set(this.land.x + this.err.x, y0, this.land.z + this.err.z - dir * 0.7);
    } else {
      // the shape: two rows across the yard, leaning toward where the ball is
      const per = Math.max(1, Math.ceil(this.n / 2)), row = this.slot % 2, col = Math.floor(this.slot / 2);
      const lane = ((col + 0.5) / per - 0.5) * (C.HW * 1.7);
      const lean = b.live ? (b.pos.x - A.center.x) * 0.2 : 0;
      W.set(A.center.x + lane + lean, y0, cz - dir * C.HL * (row ? 0.3 : 0.68));
    }
    W.z = cz - dir * Math.max(1.4, (cz - W.z) * dir);
    const dx = W.x - m.pos.x, dz = W.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.45) m.input.set(dx / d, 0, dz / d).multiplyScalar(ours && this.chase ? 1 : Math.min(1, d / 3));
    else m.input.set(0, 0, 0);
    if (!b.live || m.mode !== Mode.Run || t < this.shotT || !ours) return;
    // the hit: it's nearly down and within a lunge
    const bx = b.pos.x - m.pos.x, bz = b.pos.z - m.pos.z, bd = Math.hypot(bx, bz);
    const up = b.pos.y - floor;
    if (b.vel.y > 1 || up > 3.6 || bd > C.R + 3.2) return;
    // (it doesn't always get its timing right: then the ball just comes off its head)
    if (this.rnd() > 0.42 + 0.45 * this.skill - ease * 0.25) {
      this.shotT = t + 0.7;
      return;
    }
    this.shotT = t + 0.9 + this.rnd() * 0.5;
    // (aimed over the net, off to a side it picks)
    const ax = (this.rnd() - 0.5) * 1.4;
    if (up > 1.5 && bd < C.R + 1.2) {
      m.input.set(ax, 0, dir).normalize();
      m.jump = true;
    } else if (bd > 1.2) {
      m.input.set(bx / bd + ax * 0.3, 0, bz / bd + dir * 0.5).normalize();
      m.dash = true;
    }
  }

  /**
   * Over the Fence: every ball in its own yard is a job. It takes the nearest one nobody else on the
   * team is closer to (two at most on any one), comes round behind it so the fence is on the far
   * side, and dives through it to lob it over. Nothing to do: it waits in its lane, half way back.
   */
  private target = -1;
  private fence(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.cup!, C = A.cfg;
    const team = A.of.get(m.id) ?? 0, dir = team === 0 ? 1 : -1;
    const y0 = A.center.y, cz = A.center.z;
    const mine = (z: number) => (z - cz) * dir < -C.R * 0.5;
    if (t > this.think) {
      this.think = t + 0.2 + (1 - this.skill) * 0.3 + ease * 0.25 + this.rnd() * 0.12;
      const mates = all.filter((o) => o.active && (A.of.get(o.id) ?? 0) === team).sort((p, q) => p.id - q.id);
      this.n = mates.length;
      this.slot = mates.indexOf(m);
      let best = -1, bd = Infinity;
      A.balls.forEach((b, i) => {
        if (!b.live || !mine(b.pos.z) || b.pos.y > y0 + C.R + 2.5) return;
        const d = b.pos.distanceToSquared(m.pos);
        let closer = 0;
        for (const o of mates) if (o !== m && o.pos.distanceToSquared(b.pos) < d) closer++;
        // (a weaker bot misjudges which is nearest now and then)
        const cost = d * (1 + closer * 1.5) + this.rnd() * (1 - this.skill) * 60;
        if (closer < 2 && cost < bd) (bd = cost), (best = i);
      });
      this.target = best;
    }
    const b = this.target >= 0 ? A.balls[this.target] : null;
    if (!b || !b.live || !mine(b.pos.z)) {
      const lanes = Math.max(1, this.n);
      const lane = ((this.slot + 0.5) / lanes - 0.5) * (C.HW * 1.6);
      W.set(A.center.x + lane, y0, cz - dir * C.HL * (this.slot % 2 ? 0.35 : 0.65));
      const dx = W.x - m.pos.x, dz = W.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.6) m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 3));
      else m.input.set(0, 0, 0);
      return;
    }
    // the spot behind it, on the side away from the fence (a touch off the wall if it's on one)
    const bx0 = THREE.MathUtils.clamp(b.pos.x, A.center.x - C.HW + 2, A.center.x + C.HW - 2);
    W.set(bx0, y0, b.pos.z - dir * (C.R + 1.1));
    const wrong = (b.pos.z - m.pos.z) * dir < -0.3;
    if (wrong) W.x += (m.pos.x > b.pos.x ? 1 : -1) * 2.8;
    const dW = Math.hypot(W.x - m.pos.x, W.z - m.pos.z);
    if (dW < 1.4 && !wrong) W.set(b.pos.x, y0, b.pos.z + dir * 3);
    const dx = W.x - m.pos.x, dz = W.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.4) m.input.set(dx / d, 0, dz / d);
    else m.input.set(0, 0, 0);
    if (m.mode !== Mode.Run || t < this.shotT) return;
    const bx = b.pos.x - m.pos.x, bz = b.pos.z - m.pos.z, bdist = Math.hypot(bx, bz);
    const height = b.pos.y - y0 - C.R;
    if (bdist > C.R + 1.6 || height > 1.4 || bz * dir < 0.2) return;
    if (this.rnd() < 0.35 + 0.45 * this.skill - ease * 0.2) {
      this.shotT = t + 1.2 + this.rnd() * 1.2;
      // (aimed over the fence, give or take)
      const ax = bx / (bdist || 1) + (this.rnd() - 0.5) * (1 - this.skill) * 0.6;
      m.input.set(ax, 0, dir * Math.max(0.5, Math.abs(bz / (bdist || 1))));
      m.dash = true;
    } else this.shotT = t + 0.4;
  }
}
