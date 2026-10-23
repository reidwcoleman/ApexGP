import { ARENA, PADS } from './arena.ts';
import { Ball, BALL } from './ball.ts';
import { CAR, noInput, type Input } from './car.ts';
import { clamp, V3 } from './math.ts';
import { TICK, type World } from './world.ts';

/**
 * Bots. Each tick a bot reads the world and decides: who on its team goes for the ball (the one
 * that gets there first), who supports, who keeps goal; the attacker picks the first point on the
 * predicted ball path it can reach in time, lines up behind it toward the far goal, boosts when it's
 * pointed, jumps or dodges through the ball, and goes up for an aerial at high skill. In the air it
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
      if (bd < 650 + speed * 0.08 && !this.kickDodge && speed > 1100) {
        this.kickDodge = true;
        this.start('jump', toBall);
      }
    } else this.kickDodge = false;
    if (p.role === 'attack' && !kickoff && c.onGround) {
      const closing = bd / Math.max(300, speed);
      if (b.z > 160 && b.z < 330 && bd < 260 + speed * 0.12 && Math.abs(toBall) < 0.5) this.start('jump', 0, true);
      else if (b.z >= 330 && b.z < 560 && closing < 0.42 && bd < 900 && Math.abs(toBall) < 0.35) this.start('djump', 0);
      else if (b.z < 150 && bd < 330 && speed > 700 && Math.abs(toBall) < 0.35 && this.skill > 0.25) this.start('jump', toBall);
      else if (this.skill > 0.72 && b.z > 650 && b.z < 1700 && c.boost > 30 && bd < 1400 && Math.abs(toBall) < 0.3 && w.ball.vel.z < 400) this.start('aerial', 0);
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
    // when can each teammate reach the ball?
    const eta = (ci: number) => {
      const cc = w.cars[ci];
      if (!cc.alive) return 99;
      const sp = Math.max(1200, cc.vel.len()) + (cc.boost > 20 ? 400 : 0);
      for (const q of pth) {
        const d = Math.hypot(q.x - cc.pos.x, q.y - cc.pos.y) - 150;
        // behind the ball counts for more
        const wrongSide = (cc.pos.y - q.y) * dirY > 200 ? 0.5 : 0;
        if (q.z < 300 && d / sp + wrongSide <= q.t) return q.t + wrongSide;
      }
      return 5;
    };
    const mates = w.players.map((p, i) => (p.team === team ? i : -1)).filter((i) => i >= 0);
    const order = mates.map((i) => ({ i, e: eta(i) })).sort((a, b) => a.e - b.e);
    const rank = order.findIndex((o) => o.i === this.idx);
    const b = w.ball.pos;
    // the ball heading into our net: whoever's nearest the goal defends
    const danger = (b.y - ownY) * -dirY < 3500 || (w.ball.vel.y * -dirY > 800 && (b.y - ownY) * -dirY < 6000);
    let role: 'attack' | 'support' | 'goal' = rank === 0 ? 'attack' : rank === 1 && mates.length > 2 ? 'support' : 'goal';
    if (mates.length === 1) role = 'attack';
    if (mates.length === 2 && rank === 1) role = danger ? 'goal' : 'support';
    const p = this.plan;
    p.role = role;
    p.boost = true;
    if (role === 'attack') {
      // the first reachable point on the ball's path
      const sp = Math.max(1100, c.vel.len()) + (c.boost > 15 ? 600 * this.skill : 0);
      let pick = pth[pth.length - 1];
      for (const q of pth) {
        const d = Math.hypot(q.x - c.pos.x, q.y - c.pos.y) - 120;
        if (q.z < 260 + this.skill * 200 && d / sp <= q.t) {
          pick = q;
          break;
        }
      }
      // aim: the far goal, a little inside the posts; skill tightens the aim
      const gx = clamp(pick.x * 0.25, -500, 500) * (1 - this.skill * 0.5);
      const gy = dirY * (ARENA.Y + 300);
      let ax = gx - pick.x;
      let ay = gy - pick.y;
      const al = Math.hypot(ax, ay);
      ax /= al;
      ay /= al;
      // behind the ball? if not, go round it (toward our own side)
      const rel = (c.pos.x - pick.x) * ax + (c.pos.y - pick.y) * ay;
      const back = BALL.R + CAR.HX + 20;
      let tx = pick.x - ax * back;
      let ty = pick.y - ay * back;
      if (rel > -100) {
        // swing wide around the ball toward our goal
        const side = Math.sign((c.pos.x - pick.x) * ay - (c.pos.y - pick.y) * ax) || 1;
        tx = pick.x - ax * 700 + side * ay * 500;
        ty = pick.y - ay * 700 - side * ax * 500;
      } else {
        // the closer we get, the more we commit to the ball itself
        const dd = Math.hypot(c.pos.x - pick.x, c.pos.y - pick.y);
        const k = clamp(1 - dd / 1600, 0, 0.75);
        tx += (pick.x - tx) * k;
        ty += (pick.y - ty) * k;
      }
      // keep the target inside the walls
      tx = clamp(tx, -ARENA.X + 200, ARENA.X - 200);
      ty = clamp(ty, -ARENA.Y + 200, ARENA.Y - 200);
      p.tx = tx;
      p.ty = ty;
      p.tz = 0;
      p.t = pick.t;
    } else if (role === 'support') {
      p.tx = b.x * 0.5;
      p.ty = b.y + (ownY - b.y) * 0.45;
      p.tz = 0;
      p.t = 0;
      p.boost = false;
      // top up on the way if low
      if (c.boost < 40) {
        let best = -1;
        let bd = 1e9;
        for (let k = 0; k < PADS.length; k++) {
          if (w.pads[k] > 0 || !PADS[k].big) continue;
          const d = Math.hypot(PADS[k].x - c.pos.x, PADS[k].y - c.pos.y) + Math.abs(PADS[k].y - p.ty) * 0.5;
          if (d < bd) ((bd = d), (best = k));
        }
        if (best >= 0 && bd < 3500) {
          p.tx = PADS[best].x;
          p.ty = PADS[best].y;
        }
      }
    } else {
      // goal: on the line between the ball and the middle of our goal
      const gy = ownY + dirY * 250;
      p.tx = clamp(b.x * 0.35, -650, 650);
      p.ty = gy;
      p.tz = 0;
      p.t = 0;
      p.boost = Math.abs(c.pos.y - gy) > 2500;
      // shot coming: go and meet it
      const on = w.predictGoal();
      if (on === team && rankNear(w, this.idx, team)) {
        for (const q of pth)
          if ((q.y - ownY) * -dirY < 1200 && q.z < 400) {
            p.tx = q.x;
            p.ty = q.y - dirY * 0;
            p.role = 'attack';
            p.boost = true;
            break;
          }
      }
    }
  }
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
