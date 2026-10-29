import { BODIES, unpackLoadout } from '../loadout.ts';
import { ARENA, inGoal, KICKOFFS, PADS, type Team } from './arena.ts';
import { Ball, BALL } from './ball.ts';
import { Car, noInput, type Input } from './car.ts';
import { rng, V3 } from './math.ts';
import { BS, CS, K, RSArena, spinIn, spinOut, vecIn, vecOut } from './rocketsim.ts';

/**
 * One match: the cars, the ball, the 34 boost pads, the clock and the rules (kickoff countdown,
 * goals, golden-goal overtime, demolitions and respawns, stats). Fixed 120 Hz ticks like the real
 * game. The physics is RocketSim itself (see rocketsim.ts): every tick the inputs go in, one
 * RocketSim tick runs (cars, ball, wheels, contacts, bumps and demos, boost pads, respawns), and the
 * cars and the ball come back out into the plain objects the renderer, the bots and the HUD read.
 * The online host runs the rules (`authority`); a client runs the same physics to predict, and takes
 * the score, clock and phase from the host's snapshots, which carry RocketSim's whole state.
 */

export const TICK = 1 / 120;
/** how long a goal replay runs (the director in game.ts fits its cuts into this) */
export const REPLAY_T = 7;
export type Phase = 'countdown' | 'play' | 'goal' | 'replay' | 'end';
export const PHASES: Phase[] = ['countdown', 'play', 'goal', 'replay', 'end'];

export interface Player {
  name: string;
  team: Team;
  bot: boolean;
  /** bot skill 0..1 */
  skill: number;
  /** paint (hex) */
  color: number;
  /** who drives it: 'local', a peer id, or 'bot' */
  owner: string;
}

export interface Stats {
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  touches: number;
  score: number;
}
const newStats = (): Stats => ({ goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, touches: 0, score: 0 });

export type WEvent =
  | { t: 'hit'; car: number; power: number }
  | { t: 'goal'; team: Team; scorer: number; assist: number; speed: number; x: number; y: number; z: number }
  | { t: 'demo'; by: number; car: number; x: number; y: number; z: number }
  | { t: 'pad'; car: number; pad: number }
  | { t: 'jump'; car: number }
  | { t: 'dodge'; car: number }
  | { t: 'reset'; car: number }
  | { t: 'bounce'; speed: number }
  | { t: 'bump'; car: number; power: number }
  | { t: 'count'; n: number }
  | { t: 'go' }
  | { t: 'save'; car: number }
  | { t: 'shot'; car: number }
  /** points the way the arena game hands them out (shown as a pop-up for that player) */
  | { t: 'award'; car: number; what: string; pts: number }
  | { t: 'end' }
  | { t: 'overtime' };

export interface MatchOpts {
  minutes: number;
  /** free play: no clock, no kickoff countdown after goals */
  freeplay: boolean;
  unlimitedBoost: boolean;
}

export class World {
  cars: Car[] = [];
  players: Player[] = [];
  stats: Stats[] = [];
  ball = new Ball();
  /** seconds until each pad is back (0 = live) */
  pads = new Float32Array(PADS.length);
  score: [number, number] = [0, 0];
  clock = 300;
  overtime = false;
  phase: Phase = 'countdown';
  phaseT = 3;
  tick = 0;
  authority = true;
  events: WEvent[] = [];
  /** who touched the ball, most recent first: [car, tick] */
  touches: [number, number][] = [];
  lastGoal: Extract<WEvent, { t: 'goal' }> | null = null;
  seed = 1;
  opts: MatchOpts = { minutes: 5, freeplay: false, unlimitedBoost: false };
  /** RocketSim's arena and each car's id in it */
  readonly rs = new RSArena();
  private rsId: number[] = [];
  /** our pad k is RocketSim's pad padMap[k] */
  private padMap: number[] = [];
  private st = new Float64Array(CS);
  private prevHit: number[] = [];
  private prevFlags: number[] = [];
  private prevBallVz = 0;
  /** what each car (and the ball) looked like when it last came out of RocketSim: an edit made
   * outside (a teleport, a test's setup) shows as a difference and is sent back in */
  private seen: Float64Array[] = [];
  private seenBall = new Float64Array(9);
  private padActive: boolean[] = [];
  private shotCheck = -99;
  private countShown = 4;
  /** ticks since the clock ran out while the ball was in the air */
  private zeroWait = false;
  /** a shot is on frame toward this team's goal (0/1), else -1 */
  private shotOn: Team | -1 = -1;
  /** whose touch has been credited as the shot now heading in (−1: none) */
  private shooter = -1;
  private touchCtx: ({ aerial: boolean; backwards: boolean; long: boolean; bicycle: boolean; turtle: boolean } | undefined)[] = [];
  private lastTouchPts: number[] = [];
  private lastStyle: number[] = [];
  /** teammates who've celebrated this goal with the scorer */
  private fived = new Set<number>();

  constructor() {
    // match our pad list to RocketSim's by position
    const n = this.rs.padCount();
    const theirs = Array.from({ length: n }, (_, k) => this.rs.padInfo(k));
    this.padMap = PADS.map((p) => {
      let best = 0;
      let bd = Infinity;
      theirs.forEach((q, k) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      return best;
    });
    this.padActive = PADS.map(() => true);
  }

  addCar(p: Player): number {
    const c = new Car(p.team);
    this.cars.push(c);
    this.players.push(p);
    this.stats.push(newStats());
    this.rsId.push(this.rs.addCar(p.team, BODIES[unpackLoadout(p.color).body].preset));
    this.prevHit.push(-1);
    this.prevFlags.push(0);
    this.seen.push(new Float64Array(16).fill(NaN));
    return this.cars.length - 1;
  }

  // ------------------------------------------------------------ RocketSim in and out
  /** our car i (position, orientation, velocities, boost) into RocketSim, as a fresh start */
  pushCar(i: number): void {
    const c = this.cars[i];
    const st = this.st;
    this.rs.getCar(this.rsId[i], st);
    vecOut(c.pos, st, K.pos);
    vecOut(c.vel, st, K.vel);
    spinOut(c.w, st, K.ang);
    vecOut(c.rot.f, st, K.fwd);
    // (their right is our −left)
    st[K.right] = c.rot.l.x;
    st[K.right + 1] = -c.rot.l.y;
    st[K.right + 2] = -c.rot.l.z;
    vecOut(c.rot.u, st, K.up);
    st[K.boost] = c.boost;
    // (what the car has used of its jump and flip goes in as it stands; place() clears them)
    st[K.onGround] = c.onGround ? 1 : 0;
    st[K.hasJumped] = c.jumped ? 1 : 0;
    st[K.hasDoubleJumped] = c.doubleJumped ? 1 : 0;
    st[K.hasFlipped] = c.flipped ? 1 : 0;
    st[K.airTimeSinceJump] = c.airTimeSinceJump;
    for (const k of [K.isFlipping, K.isJumping, K.isAutoFlipping, K.isBoosting, K.isSupersonic]) st[k] = 0;
    st[K.jumpTime] = st[K.flipTime] = st[K.airTime] = st[K.supersonicTime] = 0;
    st[K.isDemoed] = c.demoTimer > 0 ? 1 : 0;
    st[K.demoTimer] = Math.max(0, c.demoTimer);
    this.rs.setCar(this.rsId[i], st);
    this.remember(i);
  }

  /** RocketSim's car i into our object */
  private pullCar(i: number): void {
    const c = this.cars[i];
    const st = this.st;
    this.rs.getCar(this.rsId[i], st);
    vecIn(st, K.pos, c.pos);
    vecIn(st, K.vel, c.vel);
    spinIn(st, K.ang, c.w);
    vecIn(st, K.fwd, c.rot.f);
    c.rot.l.set(st[K.right], -st[K.right + 1], -st[K.right + 2]);
    vecIn(st, K.up, c.rot.u);
    c.boost = st[K.boost];
    c.onGround = st[K.onGround] > 0.5;
    // (their wheels: front right-of-theirs first; ours: front left first)
    const wm = [1, 0, 3, 2];
    for (let w = 0; w < 4; w++) {
      c.wheelContact[w] = st[K.wheels + wm[w]] > 0.5;
      c.wheelComp[w] = c.wheelContact[w] ? 1.8 : 0;
    }
    c.jumped = st[K.hasJumped] > 0.5;
    c.doubleJumped = st[K.hasDoubleJumped] > 0.5;
    c.flipped = st[K.hasFlipped] > 0.5;
    c.flipping = st[K.isFlipping] > 0.5;
    c.jumping = st[K.isJumping] > 0.5;
    c.jumpTime = st[K.jumpTime];
    c.flipTime = st[K.flipTime];
    c.airTimeSinceJump = st[K.airTimeSinceJump];
    c.airTime = st[K.airTime];
    c.boosting = st[K.isBoosting] > 0.5;
    c.supersonic = st[K.isSupersonic] > 0.5;
    c.supersonicTime = st[K.supersonicTime];
    c.handbrake = st[K.handbrake];
    c.autoFlip = st[K.isAutoFlipping] > 0.5 ? st[K.autoFlipTimer] || 1e-3 : 0;
    c.bodyTouch = st[K.worldContact] > 0.5;
    c.bodyAgo = c.bodyTouch ? 0 : c.bodyAgo + TICK;
    if (c.bodyTouch) vecIn(st, K.contactNormal, c.bodyN);
    c.surfaceN.copy(c.onGround ? c.rot.u : c.bodyN);
    c.demoTimer = st[K.isDemoed] > 0.5 ? Math.max(1e-3, st[K.demoTimer]) : 0;
    this.remember(i);
  }

  private carKey(i: number, out: Float64Array): Float64Array {
    const c = this.cars[i];
    const v = [c.pos, c.vel, c.w, c.rot.f, c.rot.u];
    for (let k = 0; k < 5; k++) {
      out[k * 3] = v[k].x;
      out[k * 3 + 1] = v[k].y;
      out[k * 3 + 2] = v[k].z;
    }
    out[15] = c.boost;
    return out;
  }
  private remember(i: number): void {
    this.carKey(i, this.seen[i]);
  }
  private keyTmp = new Float64Array(16);
  /** cars or the ball changed outside since they came out of RocketSim: send them in */
  private pushEdits(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const k = this.carKey(i, this.keyTmp);
      const s0 = this.seen[i];
      let diff = false;
      for (let j = 0; j < 16 && !diff; j++) diff = k[j] !== s0[j];
      if (diff) {
        this.pushCar(i);
        this.remember(i);
      }
    }
    const b = this.ball;
    const bk = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.w.x, b.w.y, b.w.z];
    if (bk.some((v, j) => v !== this.seenBall[j])) this.pushBall();
  }

  /** our ball into RocketSim (a ball with no velocity at all is held in place, like the game's) */
  /** after editing cars or the ball directly (tools, tests): send them all into RocketSim */
  sync(): void {
    for (let i = 0; i < this.cars.length; i++) this.pushCar(i);
    this.pushBall();
  }

  /** put the ball somewhere (free play's reset): at rest, held there until touched */
  placeBall(x: number, y: number, z: number): void {
    this.ball.reset();
    this.ball.pos.set(x, y, z);
    this.pushBall();
  }

  private pushBall(): void {
    const b = this.ball;
    const st = this.st;
    this.rs.getBall(st);
    vecOut(b.pos, st, 0);
    vecOut(b.vel, st, 3);
    spinOut(b.w, st, 6);
    this.rs.setBall(st);
    this.rememberBall();
  }

  private pullBall(): void {
    const st = this.st;
    this.rs.getBall(st);
    vecIn(st, 0, this.ball.pos);
    vecIn(st, 3, this.ball.vel);
    spinIn(st, 6, this.ball.w);
    this.rememberBall();
  }
  private rememberBall(): void {
    const b = this.ball;
    this.seenBall.set([b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.w.x, b.w.y, b.w.z]);
  }

  start(opts: Partial<MatchOpts> = {}): void {
    Object.assign(this.opts, opts);
    this.score = [0, 0];
    this.clock = this.opts.minutes * 60;
    this.overtime = false;
    this.stats = this.players.map(() => newStats());
    this.kickoff();
  }

  kickoff(): void {
    this.ball.reset();
    this.pads.fill(0);
    this.touches = [];
    this.shotOn = -1;
    this.shooter = -1;
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    const r = rng(this.seed);
    // the same random set of spots for both teams, orange mirrored
    const order = [0, 1, 2, 3, 4].sort(() => r() - 0.5);
    const per: number[][] = [[], []];
    this.cars.forEach((_, i) => per[this.players[i].team].push(i));
    for (const team of [0, 1] as Team[]) {
      per[team].forEach((ci, k) => {
        const s = KICKOFFS[order[k % 5]];
        const sx = team === 0 ? s.x : -s.x;
        const sy = team === 0 ? s.y : -s.y;
        const c = this.cars[ci];
        c.place(sx, sy, Math.atan2(-sy, -sx));
        c.boost = this.opts.unlimitedBoost ? 100 : 33.3;
        this.pushCar(ci);
      });
    }
    this.pushBall();
    const pst = new Float64Array(this.rs.padCount() * 3);
    for (let k = 0; k < this.rs.padCount(); k++) pst[k * 3] = 1;
    this.rs.setPads(pst);
    this.padActive.fill(true);
    this.phase = 'countdown';
    this.phaseT = this.opts.freeplay ? 0.01 : 3;
    this.countShown = 4;
  }

  private setPhase(p: Phase, t: number): void {
    this.phase = p;
    this.phaseT = t;
  }

  step(inputs: Input[]): void {
    const dt = TICK;
    this.tick++;
    const frozen = this.phase === 'countdown' || this.phase === 'end';
    // rules clock
    this.phaseT -= dt;
    if (this.phase === 'countdown') {
      const n = Math.ceil(this.phaseT);
      if (n < this.countShown && n > 0 && !this.opts.freeplay) {
        this.countShown = n;
        this.events.push({ t: 'count', n });
      }
      if (this.phaseT <= 0 && this.authority) {
        this.setPhase('play', 0);
        this.events.push({ t: 'go' });
      }
    } else if (this.phase === 'goal' && this.phaseT <= 0 && this.authority) {
      if (this.opts.freeplay) {
        this.placeBall(0, 0, BALL.REST_Z);
        this.setPhase('play', 0);
      } else {
        if (this.endCheck()) return;
        this.setPhase('replay', REPLAY_T);
      }
    } else if (this.phase === 'replay' && this.phaseT <= 0 && this.authority) {
      if (this.endCheck()) return;
      this.kickoff();
    }
    if (this.phase === 'play' && !this.opts.freeplay && this.authority) {
      if (this.overtime) this.clock += dt;
      else if (this.clock > 0) {
        this.clock = Math.max(0, this.clock - dt);
      } else this.zeroWait = true;
      // at 0:00 the game ends the next time the ball hits the floor
      if (this.zeroWait && !this.overtime && this.ball.pos.z < BALL.R + 4) {
        this.zeroWait = false;
        if (this.score[0] !== this.score[1]) {
          this.setPhase('end', 0);
          this.events.push({ t: 'end' });
        } else {
          this.overtime = true;
          this.clock = 0;
          this.events.push({ t: 'overtime' });
          this.kickoff();
        }
        return;
      }
    }

    // ---- one RocketSim tick
    this.pushEdits();
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const inp = frozen || !c.alive ? noInput() : (inputs[i] ?? noInput());
      c.input = inp;
      c.lastJump = inp.jump;
      this.rs.controls(this.rsId[i], inp.throttle, inp.steer, inp.pitch, inp.yaw, inp.roll, inp.jump, inp.boost, inp.handbrake);
      if (this.opts.unlimitedBoost && c.alive && c.boost < 100) {
        this.rs.getCar(this.rsId[i], this.st);
        this.st[K.boost] = 100;
        this.rs.setCar(this.rsId[i], this.st);
      }
    }
    // (after a goal the ball is parked out of reach, held still, until the kickoff)
    const ballLive = this.phase === 'play' || this.phase === 'countdown';
    this.rs.step(1);
    const touched: [number, number][] = [];
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const wasAlive = c.alive;
      this.pullCar(i);
      const st = this.st;
      // events from the state's edges
      const flags = (c.jumped ? 1 : 0) | (c.flipped ? 2 : 0) | (c.onGround ? 4 : 0);
      const prev = this.prevFlags[i];
      if (c.jumped && !(prev & 1)) this.events.push({ t: 'jump', car: i });
      if (c.flipped && !(prev & 2)) this.events.push({ t: 'dodge', car: i });
      // a flip reset: the jump came back high up with the wheels on the ball
      if ((prev & 3) && !(flags & 3) && c.pos.z > 200) {
        const d = new V3().subVectors(this.ball.pos, c.pos);
        if (d.len() < 260 && d.dot(c.rot.u) < 0) this.events.push({ t: 'reset', car: i });
      }
      this.prevFlags[i] = flags;
      if (wasAlive && !c.alive) this.prevHit[i] = st[K.hitTick];
      // a touch of the ball: RocketSim stamps the tick of the car's latest hit
      const hit = st[K.hitTick];
      if (hit >= 0 && hit !== this.prevHit[i] && ballLive) {
        this.prevHit[i] = hit;
        const rel = new V3().subVectors(this.ballVelAfter(), c.vel);
        touched.push([i, rel.len()]);
      } else this.prevHit[i] = hit;
    }
    // where the ball was headed just before this tick's touches (so a save or a shot is judged on
    // the ball as it came to the car, not on a guess made at some earlier touch)
    const before = touched.length && this.authority && this.phase === 'play' ? this.predictGoal() : this.shotOn;
    if (ballLive) {
      this.pullBall();
      const vz = this.ball.vel.z;
      if (this.prevBallVz < -150 && vz > 0 && this.ball.pos.z < 200) this.events.push({ t: 'bounce', speed: -this.prevBallVz });
      this.prevBallVz = vz;
    }
    // (touches are judged on the ball as it leaves the car, so after it's been read back)
    for (const [i, power] of touched) this.touch(i, power, before);
    // boost pads: RocketSim picks them up and times them; we mirror the state and say who took one
    const pst = new Float64Array(this.rs.padCount() * 3);
    this.rs.getPads(pst);
    for (let k = 0; k < PADS.length; k++) {
      const q = this.padMap[k];
      const active = pst[q * 3] > 0.5;
      this.pads[k] = active ? 0 : Math.max(1e-3, pst[q * 3 + 1]);
      if (this.padActive[k] && !active) {
        // the nearest car took it
        let best = -1;
        let bd = Infinity;
        this.cars.forEach((c, i) => {
          const d = Math.hypot(c.pos.x - PADS[k].x, c.pos.y - PADS[k].y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best >= 0) this.events.push({ t: 'pad', car: best, pad: k });
      }
      this.padActive[k] = active;
    }
    // bumps and demolitions
    for (const [hid, vid, demo] of this.rs.events()) {
      const hi = this.rsId.indexOf(hid);
      const vi = this.rsId.indexOf(vid);
      if (hi < 0 || vi < 0) continue;
      const v = this.cars[vi];
      if (demo) {
        this.stats[hi].demos++;
        if (this.stats[hi].demos === 7) this.award(hi, 'Extermination', 20);
        this.events.push({ t: 'demo', by: hi, car: vi, x: v.pos.x, y: v.pos.y, z: v.pos.z });
      } else {
        this.events.push({ t: 'bump', car: vi, power: this.cars[hi].vel.len() });
        // celebrating: bump the scorer (both in the air: a high five)
        const lg = this.lastGoal;
        if (this.phase === 'goal' && lg && vi === lg.scorer && this.players[hi]?.team === lg.team && !this.fived.has(hi)) {
          this.fived.add(hi);
          const high = !this.cars[hi].onGround && !v.onGround;
          this.award(hi, high ? 'High five' : 'Low five', high ? 20 : 5);
        }
      }
    }

    if (this.phase === 'play' && this.authority) {
      const g = inGoal(this.ball.pos, BALL.R);
      if (g !== -1) {
        this.goal(g);
        this.parkBall();
      }
    }
  }

  private ballVelAfter(): V3 {
    this.rs.getBall(this.st);
    return vecIn(this.st, 3, new V3());
  }

  /** after a goal: the ball out of reach under the pitch, held still */
  private parkBall(): void {
    this.ball.pos.set(0, 0, -3000);
    this.ball.vel.set(0, 0, 0);
    this.ball.w.set(0, 0, 0);
    this.pushBall();
  }

  private endCheck(): boolean {
    if (this.opts.freeplay) return false;
    if (this.overtime && this.lastGoal) {
      this.setPhase('end', 0);
      this.events.push({ t: 'end' });
      return true;
    }
    if (!this.overtime && this.clock <= 0) {
      if (this.score[0] !== this.score[1]) {
        this.setPhase('end', 0);
        this.events.push({ t: 'end' });
        return true;
      }
      this.overtime = true;
      this.events.push({ t: 'overtime' });
    }
    return false;
  }

  /** the ball went into `into`'s net */
  private goal(into: Team): void {
    const team = (1 - into) as Team;
    this.score[team]++;
    const scorerT = this.touches.find(([c]) => this.players[c]?.team === team);
    const scorer = scorerT ? scorerT[0] : -1;
    let assist = -1;
    this.fived.clear();
    if (scorer >= 0) {
      // an assist: a teammate's touch shortly before the scorer's
      const sT = scorerT![1];
      const a = this.touches.find(([c, t]) => c !== scorer && this.players[c]?.team === team && sT - t < 120 * 3 && t <= sT);
      if (a) assist = a[0];
      const st = this.stats[scorer];
      // (every goal is a shot on goal, even one the prediction didn't see coming)
      if (this.shooter !== scorer) {
        st.shots++;
        this.award(scorer, 'Shot on goal', 10);
      }
      st.goals++;
      this.award(scorer, 'Goal', 100);
      // the flourishes: how the last touch was made
      const k = this.touchCtx[scorer];
      if (k) {
        const flourish = k.turtle ? 'Turtle goal' : k.bicycle ? 'Bicycle goal' : k.aerial ? 'Aerial goal' : k.backwards ? 'Backwards goal' : k.long ? 'Long goal' : '';
        if (flourish) this.award(scorer, flourish, 20);
      }
      if (this.overtime) this.award(scorer, 'Overtime goal', 25);
      if (st.goals === 3) this.award(scorer, 'Hat trick', 25);
      if (assist >= 0) {
        const sa = this.stats[assist];
        sa.assists++;
        this.award(assist, 'Assist', 50);
        if (sa.assists === 3) this.award(assist, 'Playmaker', 25);
      }
    }
    const b = this.ball.pos;
    // the explosion stops every car near it dead and blows it hard back, away from the ball, and up
    // into the air, tumbling: near full force over most of the blast, dropping off only at its edge
    // (picked up as an edit and sent into RocketSim next tick, which caps a car at 2300)
    const blast = 2400;
    for (let ci = 0; ci < this.cars.length; ci++) {
      const c = this.cars[ci];
      if (!c.alive) continue;
      const d = new V3().subVectors(c.pos, b);
      const dist = d.len();
      if (dist > blast) continue;
      const k = Math.min(1, 1.25 * Math.pow(1 - dist / blast, 0.35));
      let hx = d.x;
      let hy = d.y;
      const hl = Math.hypot(hx, hy);
      if (hl < 1) {
        hx = Math.cos(ci * 2.4);
        hy = Math.sin(ci * 2.4);
      } else {
        hx /= hl;
        hy /= hl;
      }
      const v = 2300 * k;
      c.vel.set(hx * v * 0.7, hy * v * 0.7, v * 0.72);
      // tumbling end over end away from the blast, with a twist
      c.w.set(-hy * 5.5 * k, hx * 5.5 * k, (ci % 2 ? 1 : -1) * 2.5 * k);
    }
    const ev = { t: 'goal' as const, team, scorer, assist, speed: this.ball.vel.len(), x: b.x, y: b.y, z: b.z };
    this.lastGoal = ev;
    this.events.push(ev);
    this.setPhase('goal', this.opts.freeplay ? 1.6 : 3);
  }

  private touch(i: number, power: number, before: Team | -1): void {
    const st = this.stats[i];
    if (!st) return;
    const prevOn = before;
    const team = this.players[i].team;
    // a contact that carries on (a dribble, a pinch) is one touch; where the ball's going is checked again now and then
    if (this.touches.length && this.touches[0][0] === i && this.tick - this.touches[0][1] < 8) {
      this.touches[0][1] = this.tick;
      if (this.tick - this.shotCheck < 6) return;
    } else {
      if (!this.touches.length || this.touches[0][0] !== i || this.tick - this.touches[0][1] > 30) {
        st.touches++;
        // a ball touch: 2 points, with a short cooldown
        if (this.authority && this.phase === 'play' && this.tick - (this.lastTouchPts[i] ?? -999) > 60) {
          st.score += 2;
          this.lastTouchPts[i] = this.tick;
        }
      }
      this.noteTouch(i);
      this.touches = [[i, this.tick] as [number, number], ...this.touches.filter(([c]) => c !== i)].slice(0, 6);
      this.events.push({ t: 'hit', car: i, power });
    }
    if (!this.authority || this.phase !== 'play') return;
    this.shotCheck = this.tick;
    // after the touch: is it on frame?
    const on = this.predictGoal();
    const b = this.ball;
    const dirY = team === 0 ? 1 : -1;
    const fromOwn = (b.pos.y + dirY * ARENA.Y) * dirY;
    if (prevOn === team && on !== team) {
      st.saves++;
      // an epic save: it was about to go in
      const epic = fromOwn < 650 && Math.abs(b.pos.x) < ARENA.GOAL_W + 250;
      this.award(i, epic ? 'Epic save' : 'Save', epic ? 75 : 50);
      this.events.push({ t: 'save', car: i });
      if (st.saves === 3) this.award(i, 'Savior', 25);
    } else if (on === 1 - team && prevOn !== on) {
      st.shots++;
      this.shooter = i;
      this.award(i, 'Shot on goal', 10);
      this.events.push({ t: 'shot', car: i });
    } else if (on === -1 && this.tick - (this.lastStyle[i] ?? -999) > 240) {
      // a clear out of our end, or a centre from the attacking corners
      const toward = b.vel.y * dirY;
      if (fromOwn < 2800 && toward > 900) {
        this.award(i, 'Clear ball', 20);
        this.lastStyle[i] = this.tick;
      } else if (fromOwn > ARENA.Y * 2 - 2800 && Math.abs(b.pos.x) > 1300 && b.vel.x * Math.sign(b.pos.x) < -600) {
        this.award(i, 'Center ball', 10);
        this.lastStyle[i] = this.tick;
      }
    }
    if (on !== 1 - team) this.shooter = -1;
    this.shotOn = on;
  }

  private award(i: number, what: string, pts: number): void {
    const st = this.stats[i];
    if (!st || !this.authority) return;
    st.score += pts;
    this.events.push({ t: 'award', car: i, what, pts });
  }

  /** how car i is touching the ball now (for the goal flourishes) */
  private noteTouch(i: number): void {
    const c = this.cars[i];
    const dirY = this.players[i].team === 0 ? 1 : -1;
    const toGoal = new V3(-c.pos.x * 0.3, dirY * ARENA.Y - c.pos.y, 0).norm();
    const air = !c.onGround && !c.bodyTouch;
    this.touchCtx[i] = {
      aerial: air && this.ball.pos.z > 300,
      backwards: c.rot.f.dot(toGoal) < -0.55 && c.vel.dot(c.rot.f) < -200,
      long: c.pos.y * dirY < 0,
      bicycle: air && c.rot.u.z < -0.25 && this.ball.pos.z > 200,
      turtle: c.rot.u.z < -0.7 && c.pos.z < 80,
    };
  }

  /** run a copy of the ball 2.5 s ahead: whose goal does it end up in? */
  predictGoal(): Team | -1 {
    const b = new Ball();
    b.pos.copy(this.ball.pos);
    b.vel.copy(this.ball.vel);
    b.w.copy(this.ball.w);
    for (let k = 0; k < 480; k++) {
      b.step(TICK);
      const g = inGoal(b.pos, BALL.R);
      if (g !== -1) return g;
      if (b.vel.len2() < 100) break;
    }
    return -1;
  }

  /** car vs car: capsules for contact, bumps and demolitions on top */
  // ------------------------------------------------------------ snapshots
  static readonly HEAD = 13;
  /** per car: RocketSim's state, the inputs, the ack */
  static readonly CARF = CS + 8 + 1;
  snapSize(): number {
    return World.HEAD + BS + this.rs.padCount() * 3 + this.cars.length * World.CARF;
  }

  /** everything the physics needs to carry on, as floats (RocketSim's state as it stands) */
  write(out: Float32Array, acks: number[] = []): Float32Array {
    let o = 0;
    const w = (v: number) => (out[o++] = v);
    w(this.tick);
    w(PHASES.indexOf(this.phase));
    w(this.phaseT);
    w(this.clock);
    w(this.score[0]);
    w(this.score[1]);
    w(this.overtime ? 1 : 0);
    w(this.cars.length);
    w(this.seed);
    w(this.touches[0]?.[0] ?? -1);
    w(this.countShown);
    w(this.rs.tick);
    w(0);
    this.rs.getBall(out, o);
    o += BS;
    this.rs.getPads(out, o);
    o += this.rs.padCount() * 3;
    for (let i = 0; i < this.cars.length; i++) {
      this.rs.getCar(this.rsId[i], out, o);
      o += CS;
      const inp = this.cars[i].input;
      w(inp.throttle), w(inp.steer), w(inp.pitch), w(inp.yaw), w(inp.roll), w(inp.jump ? 1 : 0), w(inp.boost ? 1 : 0), w(inp.handbrake ? 1 : 0);
      w(acks[i] ?? 0);
    }
    return out;
  }

  /** restore from write(); returns the per-car acks */
  read(src: Float32Array): number[] {
    let o = 0;
    const r = () => src[o++];
    this.tick = r();
    this.phase = PHASES[r()] ?? 'play';
    this.phaseT = r();
    this.clock = r();
    this.score[0] = r();
    this.score[1] = r();
    this.overtime = r() > 0;
    const n = r();
    this.seed = r();
    const lt = r();
    if (lt >= 0 && this.touches[0]?.[0] !== lt) this.touches = [[lt, this.tick]];
    this.countShown = r();
    this.rs.tick = r();
    r();
    this.rs.setBall(src, o);
    o += BS;
    this.pullBall();
    this.rs.setPads(src, o);
    for (let k = 0; k < PADS.length; k++) {
      const q = this.padMap[k];
      this.padActive[k] = src[o + q * 3] > 0.5;
      this.pads[k] = this.padActive[k] ? 0 : Math.max(1e-3, src[o + q * 3 + 1]);
    }
    o += this.rs.padCount() * 3;
    const acks: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      if (!c) {
        o += World.CARF;
        continue;
      }
      this.rs.setCar(this.rsId[i], src, o);
      o += CS;
      this.pullCar(i);
      this.prevHit[i] = this.st[K.hitTick];
      const inp = c.input;
      inp.throttle = r();
      inp.steer = r();
      inp.pitch = r();
      inp.yaw = r();
      inp.roll = r();
      inp.jump = r() > 0;
      inp.boost = r() > 0;
      inp.handbrake = r() > 0;
      acks.push(r());
    }
    return acks;
  }
}

/** closest points of two segments c ± d·h */
