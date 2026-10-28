import { ARENA, PADS } from './arena.ts';
import { Ball, BALL } from './ball.ts';
import { CAR, noInput, type Input } from './car.ts';
import { clamp, V3 } from './math.ts';
import { TICK, type World } from './world.ts';

/**
 * Bots. Each team rotates like players do: a first man who keeps the ball until a teammate is
 * clearly better placed (and rotates out round the back post after a touch), a second man behind
 * the play on the far side from the first, and a last man deep and central who drops into the net
 * when the ball's dangerous; nobody parks on a teammate, and they defer to a human on the ball.
 * The first man picks the first point on the predicted ball path it can reach in time (up the walls
 * too), lines up for a shot (a centre from the corners, a clear when it can't get goal-side, straight
 * through a 50/50), boosts when it's pointed, jumps or dodges through the ball, and flies for aerials. In the air it
 * rights itself to land on its wheels. Skill (0..1) sets the reaction time, the boost discipline,
 * the shot accuracy and whether it'll fly.
 */

interface BallPt {
  t: number;
  x: number;
  y: number;
  z: number;
}

let pathTick = -1;
let path: BallPt[] = [];

/** the ball's next 3 s (shared by every bot, refreshed every few ticks) */
function ballPath(w: World): BallPt[] {
  if (w.tick - pathTick < 4 && path.length) return path;
  pathTick = w.tick;
  const b = new Ball();
  b.pos.copy(w.ball.pos);
  b.vel.copy(w.ball.vel);
  b.w.copy(w.ball.w);
  path = [];
  const frozen = w.phase !== 'play';
  for (let k = 0; k <= 180; k++) {
    if (k % 2 === 0) path.push({ t: k * TICK * 2, x: b.pos.x, y: b.pos.y, z: b.pos.z });
    if (!frozen) {
      b.step(TICK * 2);
    }
  }
  return path;
}

type Move = 'none' | 'jump' | 'gap' | 'dodge' | 'aerial' | 'djump';

export class Bot {
  private move: Move = 'none';
  private moveT = 0;
  private dodgeDir = { x: 1, y: 0 };
  private think = 0;
  private plan: { tx: number; ty: number; tz: number; t: number; role: 'attack' | 'support' | 'goal'; boost: boolean } = { tx: 0, ty: 0, tz: 0, t: 0, role: 'attack', boost: false };
  private last: Input = noInput();
  private kickDodge = false;
  private stuckT = 0;
  /** when to dodge into the kickoff: varies kickoff to kickoff */
  private kickDist = 650;
  private backT = 0;

  constructor(
    readonly idx: number,
    public skill: number,
  ) {}

  step(w: World): Input {
    const c = w.cars[this.idx];
    const me = w.players[this.idx];
    if (!c || !c.alive) return noInput();
    const team = me.team;
    const dirY = team === 0 ? 1 : -1; // toward the goal we attack
    const ownY = -dirY * ARENA.Y;
    const inp = noInput();

    // --- a move in progress (jumps and dodges are timed in ticks) ---
    if (this.move !== 'none') {
      this.moveT += TICK;
      if (this.runMove(w, inp)) return inp;
    }

    // --- decide (reaction time by skill) ---
    this.think -= 1;
    if (this.think <= 0) {
      this.think = Math.round(2 + (1 - this.skill) * 10);
      this.decide(w);
    }
    const p = this.plan;

    if (!c.onGround) {
      this.recover(w, inp);
      inp.throttle = 1;
      // turtled or on a side: hop back over
      if (c.bodyAgo < 0.1 && c.rot.u.dot(c.surfaceN) < 0.5) inp.jump = (w.tick & 15) < 4;
      return inp;
    }

    // --- drive to the plan ---
    const lx = (p.tx - c.pos.x) * c.rot.f.x + (p.ty - c.pos.y) * c.rot.f.y + (p.tz - c.pos.z) * c.rot.f.z;
    const ly = (p.tx - c.pos.x) * c.rot.l.x + (p.ty - c.pos.y) * c.rot.l.y + (p.tz - c.pos.z) * c.rot.l.z;
    const ang = Math.atan2(ly, lx);
    const dist = Math.hypot(lx, ly);
    const speed = c.vel.dot(c.rot.f);
    inp.steer = clamp(-ang * (2.2 + this.skill * 1.6), -1, 1);
    inp.throttle = 1;
    if (Math.abs(ang) > 1.7 && speed > 600 && dist > 300) inp.handbrake = true;
    // target behind and little speed (in a goal, off a wall): a reversing three-point turn
    if (Math.abs(ang) > 2.1 && speed < 450 && dist > 350 && p.role !== 'goal') {
      inp.throttle = -1;
      inp.steer = Math.sign(ang) || 1;
      this.last = inp;
      return inp;
    }
    // arrive on time: ease off when early
    const need = dist / Math.max(900, speed);
    if (p.role !== 'goal' && p.t > 0.3 && need < p.t * 0.6 && dist < 2500) inp.throttle = clamp(need / (p.t * 0.6), 0.25, 1);
    if (p.role === 'goal' && dist < 250) {
      // in goal: stop and face the ball
      inp.throttle = clamp(-speed / 500, -1, 1);
      const bx = w.ball.pos.x - c.pos.x;
      const by = w.ball.pos.y - c.pos.y;
      const fa = Math.atan2(bx * c.rot.l.x + by * c.rot.l.y, bx * c.rot.f.x + by * c.rot.f.y);
      if (Math.abs(fa) > 0.4) {
        inp.throttle = 0.6;
        inp.steer = clamp(-fa * 2, -1, 1);
      }
    }
    // pinned against a wall or a post: back off, turning the other way
    if (inp.throttle > 0.3 && Math.abs(speed) < 150 && w.phase === 'play') this.stuckT += TICK;
    else this.stuckT = Math.max(0, this.stuckT - TICK * 2);
    if (this.stuckT > 0.45) {
      this.backT = 0.8;
      this.stuckT = 0;
    }
    if (this.backT > 0) {
      this.backT -= TICK;
      inp.throttle = -1;
      inp.steer = -inp.steer || 1;
      inp.handbrake = false;
      return inp;
    }
    // boost when pointed and it helps
    const useBoost = p.boost && Math.abs(ang) < 0.3 && speed < 2250 && c.boost > (this.skill > 0.5 ? 0 : 20);
    inp.boost = useBoost && (dist > 900 || p.role === 'attack') && !(inp.throttle < 1);

    // --- touches: jumps for high balls, dodges for power ---
    const b = w.ball.pos;
    const bd = Math.hypot(b.x - c.pos.x, b.y - c.pos.y);
    const toBall = Math.atan2((b.x - c.pos.x) * c.rot.l.x + (b.y - c.pos.y) * c.rot.l.y, (b.x - c.pos.x) * c.rot.f.x + (b.y - c.pos.y) * c.rot.f.y);
    const kickoff = w.ball.vel.len2() < 1 && Math.abs(b.x) < 1 && Math.abs(b.y) < 1;
    if (kickoff && p.role === 'attack') {
      inp.boost = true;
      inp.throttle = 1;
      if (bd < this.kickDist + speed * 0.08 && !this.kickDodge && speed > 1100) {
        this.kickDodge = true;
        this.start('jump', toBall);
      }
    } else {
      if (this.kickDodge || this.kickDist === 650) this.kickDist = 560 + Math.random() * 220;
      this.kickDodge = false;
    }
    if (p.role === 'attack' && !kickoff && c.onGround) {
      const closing = bd / Math.max(300, speed);
      if (b.z > 160 && b.z < 330 && bd < 260 + speed * 0.12 && Math.abs(toBall) < 0.5) this.start('jump', 0, true);
      else if (b.z >= 330 && b.z < 560 && closing < 0.42 && bd < 900 && Math.abs(toBall) < 0.35) this.start('djump', 0);
      else if (b.z < 150 && bd < 330 && speed > 700 && Math.abs(toBall) < 0.35 && this.skill > 0.25) this.start('jump', toBall);
      else if (this.skill > 0.5 && b.z > 600 && b.z < 1700 && c.boost > 30 && bd < 1400 && Math.abs(toBall) < 0.3 && w.ball.vel.z < 400) this.start('aerial', 0);
    }
    void ownY;
    this.last = inp;
    return inp;
  }

  private start(m: Move, aimAng: number, single = false): void {
    this.move = m;
    this.moveT = 0;
    // dodge toward the ball: forward plus a side component
    this.dodgeDir = { x: Math.cos(aimAng), y: -Math.sin(aimAng) };
    if (single) this.move = 'jump', (this.dodgeDir = { x: 0, y: 0 });
  }

  /** timed sequences; true = the move owns this tick's input */
  private runMove(w: World, inp: Input): boolean {
    const c = w.cars[this.idx];
    const t = this.moveT;
    inp.throttle = 1;
    switch (this.move) {
      case 'jump':
        // hold the jump, then (unless single) flip toward the ball
        if (t < 0.09) {
          inp.jump = true;
          return true;
        }
        if (this.dodgeDir.x === 0 && this.dodgeDir.y === 0) {
          if (t < 0.2) {
            inp.jump = true;
            return true;
          }
          this.move = 'none';
          return false;
        }
        if (t < 0.13) return true;
        if (t < 0.18) {
          inp.jump = true;
          inp.pitch = -this.dodgeDir.x;
          inp.yaw = this.dodgeDir.y;
          return true;
        }
        if (t < 0.9 && !c.onGround) {
          inp.pitch = -this.dodgeDir.x;
          return true;
        }
        this.move = 'none';
        return false;
      case 'djump':
        if (t < 0.2) inp.jump = true;
        else if (t < 0.25) inp.jump = false;
        else if (t < 0.3) inp.jump = true;
        else {
          this.move = 'none';
          return false;
        }
        return true;
      case 'aerial': {
        if (t < 0.22) {
          inp.jump = true;
          inp.pitch = 1;
          return true;
        }
        if (t > 2.5 || c.onGround || c.boost <= 0) {
          this.move = 'none';
          return false;
        }
        // fly at where the ball will be
        const pth = ballPath(w);
        let tgt = pth[pth.length - 1];
        for (const q of pth) {
          const d = Math.hypot(q.x - c.pos.x, q.y - c.pos.y, q.z - c.pos.z);
          if (d / 1500 <= q.t) {
            tgt = q;
            break;
          }
        }
        const goalY = (w.players[this.idx].team === 0 ? 1 : -1) * (ARENA.Y + 400);
        const off = new V3(tgt.x, tgt.y - goalY, tgt.z).norm();
        const aim = new V3(tgt.x + off.x * 90 - c.pos.x, tgt.y + off.y * 90 - c.pos.y, tgt.z + off.z * 60 - c.pos.z + 120);
        const al = aim.len();
        aim.scale(1 / Math.max(1, al));
        this.aim(c, aim, inp);
        inp.boost = aim.dot(c.rot.f) > 0.8;
        if (al < 220 && !c.flipped) {
          inp.jump = true;
          inp.pitch = -1;
        }
        return true;
      }
      default:
        this.move = 'none';
        return false;
    }
  }

  /** point the nose along dir (world), keep the roof roughly up */
  private aim(c: World['cars'][number], dir: V3, inp: Input): void {
    const f = dir.dot(c.rot.f);
    const l = dir.dot(c.rot.l);
    const u = dir.dot(c.rot.u);
    const wl = c.rot.toLocal(c.w, new V3());
    // pitch: target above the nose → nose up (+)
    inp.pitch = clamp(Math.atan2(u, f) * 3.5 + wl.y * 0.35, -1, 1);
    // yaw: target to the left → yaw left (−)
    inp.yaw = clamp(-Math.atan2(l, f) * 3.5 + wl.z * 0.35, -1, 1);
    // roll the roof up
    inp.roll = clamp(-c.rot.l.z * 2.5 - wl.x * 0.25, -1, 1);
  }

  /** in the air: wheels toward the floor (or the nearest wall) by landing */
  private recover(w: World, inp: Input): void {
    const c = w.cars[this.idx];
    const tgtUp = new V3(0, 0, 1);
    const tl = c.rot.toLocal(tgtUp, new V3());
    const wl = c.rot.toLocal(c.w, new V3());
    inp.roll = clamp(-tl.y * 3 - wl.x * 0.3, -1, 1);
    inp.pitch = clamp(-tl.x * 3 + wl.y * 0.35, -1, 1);
    // face where it's going
    const v = new V3(c.vel.x, c.vel.y, 0);
    if (v.len() > 300) {
      v.norm();
      const a = Math.atan2(v.dot(c.rot.l), v.dot(c.rot.f));
      inp.yaw = clamp(-a * 2 + wl.z * 0.3, -1, 1);
    }
  }

  private decide(w: World): void {
    const c = w.cars[this.idx];
    const team = w.players[this.idx].team;
    const dirY = team === 0 ? 1 : -1;
    const ownY = -dirY * ARENA.Y;
    const pth = ballPath(w);
    const b = w.ball.pos;
    // when can each teammate reach the ball? (being goal-side of it counts for a lot)
    const eta = (ci: number) => {
      const cc = w.cars[ci];
      if (!cc.alive) return 99;
      const sp = Math.max(1200, cc.vel.len()) + (cc.boost > 20 ? 400 : 0);
      for (const q of pth) {
        const d = Math.hypot(q.x - cc.pos.x, q.y - cc.pos.y) - 150;
        const wrongSide = (cc.pos.y - q.y) * dirY > 200 ? 0.6 : 0;
        if (q.z < 300 && d / sp + wrongSide <= q.t) return q.t + wrongSide;
      }
      return 5;
    };
    const mates = w.players.map((p, i) => (p.team === team ? i : -1)).filter((i) => i >= 0);
    const m = teamMind(w, team);
    // (a human teammate gets the ball when it's close to even: bots don't double-commit on you)
    const etas = new Map(mates.map((i) => [i, eta(i) - (w.players[i].bot ? 0 : 0.35)]));
    const best = mates.reduce((a, i) => (etas.get(i)! < etas.get(a)! ? i : a), mates[0]);
    // the first man keeps the ball until a teammate is clearly better placed (no flip-flopping, no
    // two cars on one ball); whoever gives it up rotates out the back
    if (m.tick !== w.tick) {
      m.tick = w.tick;
      const cur = m.first;
      if (!mates.includes(cur) || !w.cars[cur]?.alive) m.first = best;
      else if (best !== cur && etas.get(best)! < etas.get(cur)! - 0.45) {
        m.first = best;
        m.out.set(cur, w.tick + Math.round(1.6 / TICK));
      }
      // a touch also sends the toucher round the back once the ball's away
      const lt = w.touches[0];
      if (lt && lt[1] > m.seen) {
        m.seen = lt[1];
        if (lt[0] === cur && mates.length > 1) m.touched = lt[1];
      }
      if (m.touched > 0 && w.tick - m.touched > 50 && m.first === cur && best !== cur && mates.length > 1) {
        m.first = best;
        m.out.set(cur, w.tick + Math.round(1.4 / TICK));
        m.touched = 0;
      }
    }
    const first = m.first;
    const kickoff = w.ball.vel.len2() < 1 && Math.abs(b.x) < 1 && Math.abs(b.y) < 1;
    // the others: the one nearer the play is second man, the rest stay deep
    const rest = mates.filter((i) => i !== first);
    const outUntil = m.out.get(this.idx) ?? 0;
    const rotating = outUntil > w.tick && this.idx !== first;
    const depth = (i: number) => (w.cars[i].pos.y - ownY) * dirY - ((m.out.get(i) ?? 0) > w.tick ? 4000 : 0);
    rest.sort((a, bb) => depth(bb) - depth(a));
    const slot = this.idx === first ? 0 : 1 + rest.indexOf(this.idx);
    // the ball near our goal, or coming at it fast (distances measured up the field from our line)
    const fromGoal = (b.y - ownY) * dirY;
    const danger = (fromGoal < 2600 && Math.abs(b.x) < 2600) || (w.ball.vel.y * -dirY > 900 && fromGoal < 5000);
    const p = this.plan;
    p.boost = true;
    p.tz = 0;
    p.t = 0;
    const lastMan = slot === mates.length - 1 && mates.length > 1;
    if (kickoff && slot > 0) {
      // kickoff: second man cheats up a little, the last one fetches the back corner boost
      if (slot === 1 && mates.length > 2) {
        p.role = 'support';
        p.tx = clamp(c.pos.x * 0.3, -800, 800);
        p.ty = ownY + dirY * 3300;
        p.boost = false;
      } else {
        const sx = Math.sign(c.pos.x) || 1;
        const pad = PADS.findIndex((q) => q.big && Math.sign(q.x) === sx && (q.y - ownY) * -dirY > -1 && Math.abs(q.y - ownY) < 1500);
        p.role = 'support';
        p.tx = pad >= 0 && c.boost < 90 ? PADS[pad].x : clamp(c.pos.x, -700, 700);
        p.ty = pad >= 0 && c.boost < 90 ? PADS[pad].y : ownY + dirY * 600;
      }
      return;
    }
    if (slot === 0 || mates.length === 1) {
      p.role = 'attack';
      this.attackPlan(w, pth, dirY, mates.length > 1);
      return;
    }
    // the shot's coming in and we're last back: save it
    const on = w.predictGoal();
    if (on === team && (lastMan || rankNear(w, this.idx, team))) {
      for (const q of pth)
        if ((q.y - ownY) * -dirY < 1300 && q.z < 400) {
          p.tx = q.x;
          p.ty = q.y;
          p.role = 'attack';
          return;
        }
    }
    const fx = w.cars[first].pos.x;
    if (rotating) {
      // back-post rotation: away from the ball's side, down toward our goal, through any boost
      p.role = 'support';
      const sx = b.x > 0 ? -1 : 1;
      p.tx = sx * 1600;
      p.ty = ownY + dirY * 1700;
      p.boost = Math.abs(c.pos.y - p.ty) > 3000;
      if (c.boost < 70) this.grabBoost(w, p.tx, p.ty, 3000);
    } else if (slot === 1 && !(lastMan && danger)) {
      // second man: behind the play on the far side from the first man, ready for the pass / rebound
      p.role = 'support';
      const side = fx > b.x ? -1 : 1;
      const back = mates.length > 2 ? 1900 : 2600;
      p.tx = clamp(b.x * 0.4 + side * 1300, -ARENA.X + 600, ARENA.X - 600);
      p.ty = b.y - dirY * back;
      // never behind our own goal line area, never past the ball's side of midfield by much
      if ((p.ty - ownY) * dirY < 900) p.ty = ownY + dirY * 900;
      p.boost = Math.hypot(p.tx - c.pos.x, p.ty - c.pos.y) > 2200;
      if (c.boost < 50) this.grabBoost(w, p.tx, p.ty, 2600);
    } else {
      // last man: deep and central, sliding with the ball; in the net when it's dangerous
      if (danger) {
        p.role = 'goal';
        p.tx = clamp(b.x * 0.35, -650, 650);
        p.ty = ownY + dirY * 250;
        p.boost = Math.abs(c.pos.y - p.ty) > 2500;
      } else {
        p.role = 'support';
        const deep = clamp((b.y - ownY) * dirY * 0.38, 900, 3400);
        p.tx = clamp(b.x * 0.3, -1400, 1400);
        p.ty = ownY + dirY * deep;
        p.boost = Math.abs(c.pos.y - p.ty) > 2800;
        if (c.boost < 60) this.grabBoost(w, p.tx, p.ty, 2400);
      }
    }
    // keep apart: never park on top of a teammate
    for (const i of mates) {
      if (i === this.idx) continue;
      const o = w.cars[i].pos;
      const dx = p.tx - o.x;
      const dy = p.ty - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 900 && p.role !== 'goal') {
        const k = (900 - d) / Math.max(1, d);
        p.tx = clamp(p.tx + (d > 1 ? dx * k : 900), -ARENA.X + 400, ARENA.X - 400);
        p.ty = clamp(p.ty + (d > 1 ? dy * k : 0), -ARENA.Y + 400, ARENA.Y - 400);
      }
    }
  }

  /** a big pad (or a small one) near the way to (x, y), if worth the detour */
  private grabBoost(w: World, x: number, y: number, reach: number): void {
    const c = w.cars[this.idx];
    let best = -1;
    let bd = 1e9;
    for (let k = 0; k < PADS.length; k++) {
      if (w.pads[k] > 0) continue;
      const q = PADS[k];
      const d = Math.hypot(q.x - c.pos.x, q.y - c.pos.y) + Math.hypot(q.x - x, q.y - y) * 0.6 - (q.big ? 900 : 0);
      if (d < bd) ((bd = d), (best = k));
    }
    if (best >= 0 && bd < reach) {
      this.plan.tx = PADS[best].x;
      this.plan.ty = PADS[best].y;
    }
  }

  /** the first man: the first reachable point on the ball's path (up the wall too), lined up for a
   * shot, a centre, or just a clear when it can't get goal-side; straight in when it's a 50/50 */
  private attackPlan(w: World, pth: BallPt[], dirY: number, hasMates: boolean): void {
    const c = w.cars[this.idx];
    const p = this.plan;
    const team = w.players[this.idx].team;
    const ownY = -dirY * ARENA.Y;
    const sp = Math.max(1100, c.vel.len()) + (c.boost > 15 ? 600 * this.skill : 0);
    const onWall = (q: BallPt) => Math.abs(q.x) > ARENA.X - 450 || (Math.abs(q.y) > ARENA.Y - 450 && Math.abs(q.x) > ARENA.GOAL_W + 200);
    let pick = pth[pth.length - 1];
    for (const q of pth) {
      const d = Math.hypot(q.x - c.pos.x, q.y - c.pos.y) - 120 + (onWall(q) ? q.z * 0.8 : 0);
      const zMax = onWall(q) ? 1150 : 260 + this.skill * 200;
      if (q.z < zMax && d / sp <= q.t) {
        pick = q;
        break;
      }
    }
    const wall = onWall(pick) && pick.z > 250;
    // the shot: the far goal, a little inside the posts; deep in the corner with a teammate up, a
    // centre in front of goal instead (a pass for the second man)
    let gx = clamp(pick.x * 0.25, -500, 500) * (1 - this.skill * 0.5);
    let gy = dirY * (ARENA.Y + 300);
    const deep = pick.y * dirY > 3300 && Math.abs(pick.x) > 1900;
    if (deep && hasMates && (this.idx + (w.tick >> 9)) % 3 !== 0) {
      gx = 0;
      gy = dirY * (ARENA.Y - 1200);
    }
    const dirTo = (x: number, y: number): [number, number] => {
      const l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    };
    // how far goal-side of the ball we are for an aim (negative = behind it, good)
    const relFor = (a: [number, number]) => (c.pos.x - pick.x) * a[0] + (c.pos.y - pick.y) * a[1];
    let aim = dirTo(gx - pick.x, gy - pick.y);
    let rel = relFor(aim);
    if (rel > -100) {
      // can't shoot from here: anything that sends it away from our goal will do
      const clear = dirTo(pick.x - 0, pick.y - ownY);
      const side = dirTo(Math.sign(pick.x || 1), 0.35 * dirY);
      for (const a of [clear, side]) {
        if (relFor(a) < rel - 150 && relFor(a) < 50) {
          aim = a;
          rel = relFor(a);
          break;
        }
      }
    }
    const [ax, ay] = aim;
    const back = BALL.R + CAR.HX + 20;
    let tx = pick.x - ax * back;
    let ty = pick.y - ay * back;
    const dd = Math.hypot(c.pos.x - pick.x, c.pos.y - pick.y);
    // a 50/50: an opponent's about to get there, so go straight through the ball
    let rival = 1e9;
    w.cars.forEach((o, i) => {
      if (w.players[i].team !== team && o.alive) rival = Math.min(rival, Math.hypot(o.pos.x - w.ball.pos.x, o.pos.y - w.ball.pos.y));
    });
    const challenge = rival < 900 && dd < 1300 && relFor(dirTo(pick.x - 0, pick.y - ownY)) < 200;
    if (challenge || wall) {
      tx = pick.x - ax * 60;
      ty = pick.y - ay * 60;
    } else if (rel > -100) {
      // swing round the ball toward our own side
      const sd = Math.sign((c.pos.x - pick.x) * ay - (c.pos.y - pick.y) * ax) || 1;
      tx = pick.x - ax * 520 + sd * ay * 380;
      ty = pick.y - ay * 520 - sd * ax * 380;
    } else {
      // the closer we get, the more we commit to the ball itself
      const k = clamp(1 - dd / 1600, 0, 0.8);
      tx += (pick.x - tx) * k;
      ty += (pick.y - ty) * k;
    }
    const lim = wall ? 60 : 200;
    p.tx = clamp(tx, -ARENA.X + lim, ARENA.X - lim);
    p.ty = clamp(ty, -ARENA.Y + lim, ARENA.Y - lim);
    p.tz = wall ? pick.z : 0;
    p.t = pick.t;
  }
}

interface TeamMind {
  first: number;
  tick: number;
  touched: number;
  /** the last touch already looked at */
  seen: number;
  /** players rotating out, until which tick */
  out: Map<number, number>;
}
const minds = new WeakMap<World, TeamMind[]>();
function teamMind(w: World, team: number): TeamMind {
  let m = minds.get(w);
  if (!m) minds.set(w, (m = [0, 1].map(() => ({ first: -1, tick: -1, touched: 0, seen: -1, out: new Map() }))));
  return m[team];
}

/** the teammate nearest our goal handles the save */
function rankNear(w: World, idx: number, team: number): boolean {
  const ownY = team === 0 ? -ARENA.Y : ARENA.Y;
  let best = idx;
  let bd = 1e9;
  w.cars.forEach((c, i) => {
    if (w.players[i].team !== team || !c.alive) return;
    const d = Math.hypot(c.pos.x, c.pos.y - ownY);
    if (d < bd) ((bd = d), (best = i));
  });
  return best === idx;
}
