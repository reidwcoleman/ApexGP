import { inGoal, KICKOFFS, PADS, RESPAWNS, type Team } from './arena.ts';
import { Ball, BALL } from './ball.ts';
import { Car, CAR, noInput, type Input } from './car.ts';
import { curve, rng, V3 } from './math.ts';

/**
 * One match: the cars, the ball, the 34 boost pads, the clock and the rules (kickoff countdown,
 * goals, golden-goal overtime, demolitions and respawns, stats). Fixed 120 Hz ticks like the real
 * game. The online host runs the rules (`authority`); a client runs the same physics to predict,
 * and takes the score, clock and phase from the host's snapshots.
 */

export const TICK = 1 / 120;
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
  | { t: 'bounce'; speed: number }
  | { t: 'bump'; car: number; power: number }
  | { t: 'count'; n: number }
  | { t: 'go' }
  | { t: 'save'; car: number }
  | { t: 'shot'; car: number }
  | { t: 'end' }
  | { t: 'overtime' };

const tA = new V3();
const tB = new V3();
const tC = new V3();
const tN = new V3();
const tP = new V3();
const EXTRA_CURVE: [number, number][] = [
  [0, 0.65],
  [500, 0.65],
  [2300, 0.55],
  [4600, 0.3],
];
const BUMP_GROUND: [number, number][] = [
  [0, 0],
  [1400, 1100],
  [2200, 1530],
];
const BUMP_AIR: [number, number][] = [
  [0, 0],
  [1400, 1390],
  [2200, 1945],
];
const BUMP_UP: [number, number][] = [
  [0, 0],
  [1400, 278],
  [2200, 417],
];

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
  private lastExtra: number[] = [];
  private bumpCool = new Map<number, number>();
  private countShown = 4;
  /** ticks since the clock ran out while the ball was in the air */
  private zeroWait = false;
  /** a shot is on frame toward this team's goal (0/1), else -1 */
  private shotOn: Team | -1 = -1;

  addCar(p: Player): number {
    const c = new Car(p.team);
    this.cars.push(c);
    this.players.push(p);
    this.stats.push(newStats());
    this.lastExtra.push(-10);
    return this.cars.length - 1;
  }

  removeCar(i: number): void {
    this.cars.splice(i, 1);
    this.players.splice(i, 1);
    this.stats.splice(i, 1);
    this.lastExtra.splice(i, 1);
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
      });
    }
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
        this.ball.reset();
        this.setPhase('play', 0);
      } else {
        if (this.endCheck()) return;
        this.setPhase('replay', 5);
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

    // cars
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (!c.alive) {
        c.demoTimer -= dt;
        if (c.demoTimer <= 0) this.respawn(i);
        continue;
      }
      const inp = frozen ? noInput() : (inputs[i] ?? noInput());
      const wasJ = c.jumped;
      const wasF = c.flipped;
      c.step(dt, inp);
      if (this.opts.unlimitedBoost) c.boost = 100;
      if (!wasJ && c.jumped) this.events.push({ t: 'jump', car: i });
      if (!wasF && c.flipped) this.events.push({ t: 'dodge', car: i });
    }

    // ball (frozen during the countdown, gone after a goal)
    if (this.phase === 'play' || (this.phase === 'countdown' && this.opts.freeplay)) {
      this.ball.step(dt);
      if (this.ball.bounce > 150) this.events.push({ t: 'bounce', speed: this.ball.bounce });
    }
    if (this.phase === 'play' || this.phase === 'countdown') {
      // alternate who's resolved first, so a dead-even 50/50 doesn't always break the same way
      const n = this.cars.length;
      for (let k = 0; k < n; k++) this.carBall(this.tick & 1 ? n - 1 - k : k);
    }
    this.carCars();
    this.padsStep(dt);

    if (this.phase === 'play' && this.authority) {
      const g = inGoal(this.ball.pos, BALL.R);
      if (g !== -1) this.goal(g);
    }
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
    if (scorer >= 0) {
      const a = this.touches.find(([c, t]) => c !== scorer && this.players[c]?.team === team && this.tick - t < 120 * 5);
      if (a) assist = a[0];
      this.stats[scorer].goals++;
      this.stats[scorer].score += 100;
      if (assist >= 0) {
        this.stats[assist].assists++;
        this.stats[assist].score += 50;
      }
    }
    const b = this.ball.pos;
    const ev = { t: 'goal' as const, team, scorer, assist, speed: this.ball.vel.len(), x: b.x, y: b.y, z: b.z };
    this.lastGoal = ev;
    this.events.push(ev);
    this.setPhase('goal', this.opts.freeplay ? 1.6 : 3);
  }

  private respawn(i: number): void {
    const c = this.cars[i];
    const team = this.players[i].team;
    const s = RESPAWNS[(i + this.tick) % RESPAWNS.length];
    const sx = team === 0 ? s.x : -s.x;
    const sy = team === 0 ? s.y : -s.y;
    c.place(sx, sy, team === 0 ? Math.PI / 2 : -Math.PI / 2);
    c.pos.z = 40;
    c.boost = this.opts.unlimitedBoost ? 100 : 33.3;
  }

  private padsStep(dt: number): void {
    for (let k = 0; k < PADS.length; k++) {
      if (this.pads[k] > 0) {
        this.pads[k] = Math.max(0, this.pads[k] - dt);
        continue;
      }
      const p = PADS[k];
      const rad = p.big ? 208 : 144;
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        if (!c.alive || c.boost >= 100 || c.pos.z > 165) continue;
        const dx = c.pos.x - p.x;
        const dy = c.pos.y - p.y;
        if (dx * dx + dy * dy < rad * rad) {
          c.boost = Math.min(100, c.boost + (p.big ? 100 : 12));
          this.pads[k] = p.big ? 10 : 4;
          this.events.push({ t: 'pad', car: i, pad: k });
          break;
        }
      }
    }
  }

  /** ball vs one car's hitbox (an oriented box) */
  private carBall(i: number): void {
    const c = this.cars[i];
    if (!c.alive) return;
    const b = this.ball;
    const ctr = c.center(tA);
    const rel = tB.subVectors(b.pos, ctr);
    const lx = rel.dot(c.rot.f);
    const ly = rel.dot(c.rot.l);
    const lz = rel.dot(c.rot.u);
    const cx = Math.max(-CAR.HX, Math.min(CAR.HX, lx));
    const cy = Math.max(-CAR.HY, Math.min(CAR.HY, ly));
    const cz = Math.max(-CAR.HZ, Math.min(CAR.HZ, lz));
    let nx = lx - cx;
    let ny = ly - cy;
    let nz = lz - cz;
    let dist = Math.hypot(nx, ny, nz);
    if (dist >= BALL.R) return;
    let pen: number;
    if (dist < 1e-6) {
      // centre inside the box: out along the shallowest face
      const px = CAR.HX - Math.abs(lx);
      const py = CAR.HY - Math.abs(ly);
      const pz = CAR.HZ - Math.abs(lz);
      nx = ny = nz = 0;
      if (px < py && px < pz) nx = Math.sign(lx) || 1;
      else if (py < pz) ny = Math.sign(ly) || 1;
      else nz = Math.sign(lz) || 1;
      dist = 0;
      pen = BALL.R + Math.min(px, py, pz);
    } else {
      nx /= dist;
      ny /= dist;
      nz /= dist;
      pen = BALL.R - dist;
    }
    // Psyonix's extra hit impulse from the velocities before contact, at most every other tick
    let extra: V3 | null = null;
    let extraS = 0;
    if (this.tick > this.lastExtra[i] + 1) {
      const rs = Math.min(new V3().subVectors(b.vel, c.vel).len(), 4600);
      if (rs > 0) {
        const hd = new V3().subVectors(b.pos, c.pos);
        hd.z *= 0.35;
        hd.norm();
        const fd = hd.dot(c.rot.f) * 0.35;
        hd.addScaled(c.rot.f, -fd).norm();
        extra = hd.scale(rs * curve(EXTRA_CURVE, rs));
        extraS = rs;
      }
    }
    const n = c.rot.toWorld(nx, ny, nz, tN);
    const P = c.rot.toWorld(cx, cy, cz, tP).add(ctr);
    // push the ball out (the car is six times heavier)
    b.pos.addScaled(n, pen * (6 / 7));
    c.pos.addScaled(n, -pen * (1 / 7));
    // relative velocity at the contact (ball surface point minus car point)
    const vb = tC.crossVectors(b.w, n).scale(-BALL.R).add(b.vel);
    const vc = c.pointVel(P, tA);
    const vr = vb.sub(vc);
    const vn = vr.dot(n);
    let hit = false;
    if (vn < 0) {
      const imC = c.invMassAt(P, n);
      const jn = -vn / (1 / BALL.MASS + imC);
      const J = new V3().copy(n).scale(jn);
      // friction (μ 2): the ball grips the car's paint
      const vt = vr.clone().addScaled(n, -vn);
      const vtl = vt.len();
      if (vtl > 1e-3) {
        const tdir = vt.clone().scale(1 / vtl);
        const jt = Math.min(vtl / (3.5 / BALL.MASS + c.invMassAt(P, tdir)), 2 * jn);
        J.addScaled(tdir, -jt);
      }
      b.vel.addScaled(J, 1 / BALL.MASS);
      // spin: r = −R n
      const k = 1 / (0.4 * BALL.MASS * BALL.R);
      b.w.x += (-n.y * J.z + n.z * J.y) * k;
      b.w.y += (-n.z * J.x + n.x * J.z) * k;
      b.w.z += (-n.x * J.y + n.y * J.x) * k;
      c.impulse(J.scale(-1), P);
      hit = true;
    }
    if (extra) {
      b.vel.add(extra);
      this.lastExtra[i] = this.tick;
      this.touch(i, extraS);
    } else if (hit) this.lastExtra[i] = this.tick;
  }

  private touch(i: number, power: number): void {
    const st = this.stats[i];
    if (!st) return;
    const prevOn = this.shotOn;
    const team = this.players[i].team;
    if (!this.touches.length || this.touches[0][0] !== i || this.tick - this.touches[0][1] > 30) st.touches++;
    this.touches = [[i, this.tick] as [number, number], ...this.touches.filter(([c]) => c !== i)].slice(0, 6);
    this.events.push({ t: 'hit', car: i, power });
    if (!this.authority || this.phase !== 'play') return;
    // after the touch: is it on frame?
    const on = this.predictGoal();
    if (prevOn === team && on !== team) {
      st.saves++;
      st.score += 50;
      this.events.push({ t: 'save', car: i });
    }
    if (on === 1 - team && prevOn !== on) {
      st.shots++;
      st.score += 20;
      this.events.push({ t: 'shot', car: i });
    }
    this.shotOn = on;
  }

  /** run a copy of the ball 2.5 s ahead: whose goal does it end up in? */
  predictGoal(): Team | -1 {
    const b = new Ball();
    b.pos.copy(this.ball.pos);
    b.vel.copy(this.ball.vel);
    b.w.copy(this.ball.w);
    for (let k = 0; k < 300; k++) {
      b.step(TICK);
      const g = inGoal(b.pos, BALL.R);
      if (g !== -1) return g;
      if (b.vel.len2() < 100) break;
    }
    return -1;
  }

  /** car vs car: capsules for contact, bumps and demolitions on top */
  private carCars(): void {
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const a = this.cars[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.cars[j];
        if (!b.alive) continue;
        const ca = a.center(tA);
        const cb = b.center(tB);
        if (ca.dist(cb) > 160) continue;
        // closest points between the two capsule segments (along each car's length)
        const half = CAR.HX - 30;
        const rad = 38;
        const [pa, pb] = closestSegs(ca, a.rot.f, cb, b.rot.f, half);
        const d = pa.dist(pb);
        if (d >= rad * 2) continue;
        const nrm = new V3().subVectors(pb, pa);
        if (nrm.len() < 1e-4) nrm.set(0, 0, 1);
        nrm.norm();
        const pen = rad * 2 - d;
        a.pos.addScaled(nrm, -pen / 2);
        b.pos.addScaled(nrm, pen / 2);
        const vrel = new V3().subVectors(b.vel, a.vel);
        const vn = vrel.dot(nrm);
        if (vn < 0) {
          const jn = (-1.1 * vn) / (2 / CAR.MASS);
          a.vel.addScaled(nrm, -jn / CAR.MASS);
          b.vel.addScaled(nrm, jn / CAR.MASS);
        }
        // who did the hitting: the car whose nose is into the other, moving at it faster (host only)
        if (!this.authority) continue;
        const key = i * 64 + j;
        const cool = this.bumpCool.get(key) ?? -999;
        if (this.tick - cool < 30) continue;
        for (const [hi, vi, dir] of [
          [i, j, 1],
          [j, i, -1],
        ] as [number, number, number][]) {
          const h = this.cars[hi];
          const v = this.cars[vi];
          const to = new V3().copy(nrm).scale(dir);
          const lf = to.dot(h.rot.f);
          const closing = h.vel.dot(to) - v.vel.dot(to);
          if (lf > 0.6 && closing > 200) {
            this.bumpCool.set(key, this.tick);
            if (h.supersonic && this.players[hi].team !== this.players[vi].team) {
              v.demoTimer = 3;
              this.stats[hi].demos++;
              this.stats[hi].score += 10;
              this.events.push({ t: 'demo', by: hi, car: vi, x: v.pos.x, y: v.pos.y, z: v.pos.z });
            } else {
              const spd = h.vel.len();
              const flat = new V3(to.x, to.y, 0).norm();
              const amt = curve(v.onGround ? BUMP_GROUND : BUMP_AIR, spd);
              v.vel.addScaled(flat, amt).addScaled(v.rot.u, curve(BUMP_UP, spd));
              v.vel.clampLen(CAR.MAX_SPEED);
              this.events.push({ t: 'bump', car: vi, power: spd });
            }
            break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ snapshots
  static readonly HEAD = 12;
  static readonly CARF = 38;
  snapSize(): number {
    return World.HEAD + 9 + PADS.length + this.cars.length * World.CARF;
  }

  /** everything the physics needs to carry on, as floats */
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
    w(0);
    const b = this.ball;
    w(b.pos.x), w(b.pos.y), w(b.pos.z), w(b.vel.x), w(b.vel.y), w(b.vel.z), w(b.w.x), w(b.w.y), w(b.w.z);
    for (let k = 0; k < PADS.length; k++) w(this.pads[k]);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      w(c.pos.x), w(c.pos.y), w(c.pos.z), w(c.vel.x), w(c.vel.y), w(c.vel.z), w(c.w.x), w(c.w.y), w(c.w.z);
      w(c.rot.f.x), w(c.rot.f.y), w(c.rot.f.z), w(c.rot.u.x), w(c.rot.u.y), w(c.rot.u.z);
      w(c.boost);
      const bits =
        (c.onGround ? 1 : 0) |
        (c.jumped ? 2 : 0) |
        (c.jumping ? 4 : 0) |
        (c.doubleJumped ? 8 : 0) |
        (c.flipped ? 16 : 0) |
        (c.flipping ? 32 : 0) |
        (c.lastJump ? 64 : 0) |
        (c.supersonic ? 128 : 0) |
        (c.boosting ? 256 : 0) |
        (c.bodyTouch ? 512 : 0);
      w(bits);
      w(c.jumpTime), w(c.flipTime), w(c.dodgeX), w(c.dodgeY), w(c.airTimeSinceJump), w(c.boostHold), w(c.demoTimer), w(c.handbrake), w(c.airTime);
      const inp = c.input;
      w(inp.throttle), w(inp.steer), w(inp.pitch), w(inp.yaw), w(inp.roll), w(inp.jump ? 1 : 0), w(inp.boost ? 1 : 0), w(inp.handbrake ? 1 : 0);
      w(acks[i] ?? 0);
      w(0), w(0);
    }
    return out;
  }

  /** restore from write(); returns the per-car acks */
  read(src: Float32Array, full = true): number[] {
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
    r();
    const b = this.ball;
    b.pos.set(r(), r(), r());
    b.vel.set(r(), r(), r());
    b.w.set(r(), r(), r());
    for (let k = 0; k < PADS.length; k++) this.pads[k] = r();
    const acks: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.cars[i];
      if (!c) {
        o += World.CARF;
        continue;
      }
      c.pos.set(r(), r(), r());
      c.vel.set(r(), r(), r());
      c.w.set(r(), r(), r());
      c.rot.f.set(r(), r(), r());
      c.rot.u.set(r(), r(), r());
      c.rot.ortho();
      c.boost = r();
      const bits = r();
      c.onGround = !!(bits & 1);
      c.jumped = !!(bits & 2);
      c.jumping = !!(bits & 4);
      c.doubleJumped = !!(bits & 8);
      c.flipped = !!(bits & 16);
      c.flipping = !!(bits & 32);
      c.lastJump = !!(bits & 64);
      c.supersonic = !!(bits & 128);
      c.boosting = !!(bits & 256);
      c.bodyTouch = !!(bits & 512);
      c.jumpTime = r();
      c.flipTime = r();
      c.dodgeX = r();
      c.dodgeY = r();
      c.airTimeSinceJump = r();
      c.boostHold = r();
      c.demoTimer = r();
      c.handbrake = r();
      c.airTime = r();
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
      r(), r();
      void full;
    }
    return acks;
  }
}

/** closest points of two segments c ± d·h */
function closestSegs(c1: V3, d1: V3, c2: V3, d2: V3, h: number): [V3, V3] {
  const r = new V3().subVectors(c1, c2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const b = d1.dot(d2);
  const c = d1.dot(r);
  const den = a * e - b * b;
  let s = den > 1e-6 ? (b * f - c * e) / den : 0;
  s = Math.max(-h, Math.min(h, s));
  let t = (b * s + f) / e;
  t = Math.max(-h, Math.min(h, t));
  s = Math.max(-h, Math.min(h, (b * t - c) / a));
  return [new V3().copy(c1).addScaled(d1, s), new V3().copy(c2).addScaled(d2, t)];
}
