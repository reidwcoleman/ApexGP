import { CarPhysics } from '../sim/CarPhysics.ts';
import type { Race } from '../race/Race.ts';

/**
 * Records the whole race — every car's visual state plus its timing — and plays
 * it back through stand-in CarPhysics objects ("ghosts"), so the normal
 * CarView/Cameras code renders a replay without knowing it's one.
 *
 * Memory is bounded: frames live in fixed-size chunks of compact records
 * (3 floats + 16 quantized int16 per car ≈ 44 bytes), recorded at 15 Hz. When
 * the recording reaches its budget, every other frame is dropped and the rate
 * halves, so a race of any length fits. Positions are interpolated with cubic
 * Hermite curves from the recorded velocities, headings with the yaw rate, so
 * a 15 Hz recording plays back smoothly.
 *
 * The recorder also notices the moments worth watching (overtakes, crashes,
 * spins, pit stops, fastest laps, retirements, the start and the flag): the
 * replay timeline shows them and the TV director cuts to them.
 */

const HZ = 15;
const CHUNK = 256; // frames per chunk
const NF = 3; // float32 channels per car: x, z, s
const NI = 16; // int16 channels per car
const NM = 4; // float32 per frame: race.time, raceTime, leaderLaps, phase/lights
/** recording budget (bytes); past it the recording is thinned to half the rate */
const BUDGET = 24 * 1024 * 1024;
const MAX_EVENTS = 3000;

// int16 channel layout
const I_YAW = 0, I_LAT = 1, I_VX = 2, I_VY = 3, I_R = 4, I_STEER = 5, I_PITCH = 6, I_ROLL = 7, I_HEAVE = 8, I_RPM = 9, I_THR = 10, I_BRK = 11, I_DRS = 12, I_GAP = 13, I_LAPS = 14, I_POS = 15;

/** per-car flags (high byte of the position channel) */
export const RF = { retired: 1, finished: 2, pit: 4, removed: 8, fastest: 16, destroyed: 32 } as const;

export type ReplayEventKind = 'start' | 'overtake' | 'lead' | 'crash' | 'spin' | 'retired' | 'pit' | 'fastest' | 'finish' | 'vsc';

export interface ReplayEvent {
  t: number;
  kind: ReplayEventKind;
  /** the car it's about (the passer for an overtake) */
  car: number;
  /** the other car (the one passed), −1 if none */
  other: number;
  /** the position gained / lap time / impact size */
  value: number;
}

export interface LapMark {
  t: number;
  lap: number;
}

const q = (v: number, k: number) => Math.max(-32767, Math.min(32767, Math.round(v * k)));
const wrapPi = (a: number) => {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

interface Chunk {
  f: Float32Array;
  i: Int16Array;
  m: Float32Array;
}

/** what the recorder remembers of each car between samples (to spot events) */
interface Prev {
  pos: number;
  pit: boolean;
  retired: boolean;
  finished: boolean;
  integrity: number;
  spinT: number;
  crashT: number;
}

export class ReplayBuffer {
  private cars = 0;
  private chunks: Chunk[] = [];
  /** frames recorded */
  private count = 0;
  /** seconds between recorded frames (doubles when the budget is reached) */
  private interval = 1 / HZ;
  private acc = 0;
  private prev: Prev[] = [];
  private primed = false;
  private bestLapCar = -1;
  private leaderLaps = 0;
  private lastPhase = '';
  /** stand-ins the views read from during playback */
  readonly ghosts: CarPhysics[] = [];
  /** recorded timing per car at the applied time: position, gap to the leader (s; −n = laps down), laps, RF flags */
  readonly pos: Int16Array = new Int16Array(0);
  readonly gap: Float32Array = new Float32Array(0);
  readonly laps: Int16Array = new Int16Array(0);
  readonly flags: Uint8Array = new Uint8Array(0);
  /** race clock / leader's laps at the applied time */
  raceTime = 0;
  leaderLap = 0;
  /** race phase at the applied time (0 grid, 1 lights, 2 racing, 3 finished) and the start lights lit */
  phase = 0;
  lightsLit = 0;
  /** the moments worth watching, in time order (bounded) */
  readonly events: ReplayEvent[] = [];
  /** moments recorded since the game last took them (for live banners) */
  readonly fresh: ReplayEvent[] = [];
  /** when the leader started each lap */
  readonly lapMarks: LapMark[] = [];
  private lastApplyT = NaN;
  /** passes waiting to be confirmed (held for a couple of seconds, so side-by-side swaps don't count twice) */
  private pending: { t: number; car: number; other: number; pos: number }[] = [];

  reset(race: Race) {
    this.pending.length = 0;
    this.fresh.length = 0;
    this.cars = race.cars.length;
    this.chunks.length = 0;
    this.count = 0;
    this.interval = 1 / HZ;
    this.acc = 0;
    this.primed = false;
    this.bestLapCar = -1;
    this.leaderLaps = 0;
    this.lastPhase = '';
    this.events.length = 0;
    this.lapMarks.length = 0;
    this.lastApplyT = NaN;
    this.ghosts.length = 0;
    for (const c of race.cars) this.ghosts.push(new CarPhysics(c.car.spec));
    const n = this.cars;
    (this as { pos: Int16Array }).pos = new Int16Array(n);
    (this as { gap: Float32Array }).gap = new Float32Array(n);
    (this as { laps: Int16Array }).laps = new Int16Array(n);
    (this as { flags: Uint8Array }).flags = new Uint8Array(n);
    this.prev = race.cars.map(() => ({ pos: 0, pit: false, retired: false, finished: false, integrity: 1, spinT: -99, crashT: -99 }));
  }

  get duration(): number {
    return this.count < 2 ? 0 : this.endTime - this.startTime;
  }

  get startTime(): number {
    return this.count ? this.timeAt(0) : 0;
  }

  get endTime(): number {
    return this.count ? this.timeAt(this.count - 1) : 0;
  }

  /** bytes held by the recording */
  get bytes(): number {
    return this.chunks.length * this.chunkBytes();
  }

  /** frames per second being recorded now */
  get rate(): number {
    return 1 / this.interval;
  }

  private chunkBytes() {
    return CHUNK * (this.cars * (NF * 4 + NI * 2) + NM * 4);
  }

  private timeAt(i: number): number {
    return this.chunks[i >> 8].m[(i & 255) * NM];
  }

  private newChunk(): Chunk {
    return { f: new Float32Array(CHUNK * this.cars * NF), i: new Int16Array(CHUNK * this.cars * NI), m: new Float32Array(CHUNK * NM) };
  }

  record(dt: number, race: Race) {
    if (!this.cars) return;
    // the virtual safety car (on the step it's called: events only last one step)
    for (const e of race.events) if ((e.kind as string) === 'vsc') this.addEvent('vsc', race.time, e.car);
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = Math.min(this.acc - this.interval, this.interval);
    if (this.count >= this.chunks.length * CHUNK) {
      if ((this.chunks.length + 1) * this.chunkBytes() > BUDGET && this.count > 64) this.thin();
      if (this.count >= this.chunks.length * CHUNK) this.chunks.push(this.newChunk());
    }
    const idx = this.count;
    const ch = this.chunks[idx >> 8];
    const slot = idx & 255;
    const m = ch.m;
    const mo = slot * NM;
    m[mo] = race.time;
    m[mo + 1] = race.raceTime;
    m[mo + 2] = race.leaderLaps;
    m[mo + 3] = (race.phase === 'grid' ? 0 : race.phase === 'lights' ? 1 : race.phase === 'racing' ? 2 : 3) * 8 + race.lightsLit;
    const n = this.cars;
    for (let k = 0; k < n; k++) {
      const c = race.cars[k];
      const car = c.car;
      const fo = (slot * n + k) * NF;
      ch.f[fo] = car.x;
      ch.f[fo + 1] = car.z;
      ch.f[fo + 2] = car.s;
      const io = (slot * n + k) * NI;
      const I = ch.i;
      I[io + I_YAW] = q(wrapPi(car.yaw), 10000);
      I[io + I_LAT] = q(car.lateral, 100);
      I[io + I_VX] = q(car.vx, 100);
      I[io + I_VY] = q(car.vy, 100);
      I[io + I_R] = q(car.r, 1000);
      I[io + I_STEER] = q(car.steer, 30000);
      I[io + I_PITCH] = q(car.pitch, 30000);
      I[io + I_ROLL] = q(car.roll, 30000);
      I[io + I_HEAVE] = q(car.heave, 10000);
      I[io + I_RPM] = q(car.rpm, 1);
      I[io + I_THR] = q(car.throttle, 30000);
      I[io + I_BRK] = q(Math.min(1, car.brakeHeat), 30000);
      I[io + I_DRS] = q(car.drsAnim, 30000);
      I[io + I_GAP] = q(c.gapLeader, 100);
      I[io + I_LAPS] = c.laps;
      const fl =
        (c.retired ? RF.retired : 0) |
        (c.finished ? RF.finished : 0) |
        (c.pit.phase !== 'none' ? RF.pit : 0) |
        (c.removed ? RF.removed : 0) |
        (c.id === race.bestLapCar ? RF.fastest : 0) |
        (car.destroyed ? RF.destroyed : 0);
      I[io + I_POS] = (c.position & 255) | (fl << 8);
    }
    this.count++;
    this.detect(race);
  }

  /** drop every other frame: half the memory, half the rate */
  private thin() {
    const n = this.cars;
    const keep = Math.ceil(this.count / 2);
    for (let j = 0; j < keep; j++) {
      const src = j * 2;
      const a = this.chunks[src >> 8], sa = src & 255;
      const b = this.chunks[j >> 8], sb = j & 255;
      b.f.set(a.f.subarray(sa * n * NF, (sa + 1) * n * NF), sb * n * NF);
      b.i.set(a.i.subarray(sa * n * NI, (sa + 1) * n * NI), sb * n * NI);
      b.m.set(a.m.subarray(sa * NM, (sa + 1) * NM), sb * NM);
    }
    this.count = keep;
    this.chunks.length = Math.max(1, Math.ceil(keep / CHUNK));
    this.interval *= 2;
  }

  private addEvent(kind: ReplayEventKind, t: number, car: number, other = -1, value = 0) {
    if (this.events.length >= MAX_EVENTS) {
      // keep the dramatic ones: drop the oldest spin/pit/overtake first
      const i = this.events.findIndex((e) => e.kind === 'spin' || e.kind === 'pit' || e.kind === 'overtake');
      this.events.splice(i >= 0 ? i : 0, 1);
    }
    const e = { t, kind, car, other, value };
    // (a confirmed pass is dated back to when it happened: keep the list in time order)
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > t) i--;
    this.events.splice(i, 0, e);
    this.fresh.push(e);
    if (this.fresh.length > 64) this.fresh.shift();
  }

  /** compare with the last sample: who passed whom, who crashed, who pitted… */
  private detect(race: Race) {
    const t = race.time;
    const racing = race.phase === 'racing' || race.phase === 'finished';
    if (race.phase !== this.lastPhase) {
      if (race.phase === 'racing' && this.lastPhase === 'lights') this.addEvent('start', t, race.cars.find((c) => c.position === 1)?.id ?? 0);
      this.lastPhase = race.phase;
    }
    if (race.leaderLaps > this.leaderLaps || this.lapMarks.length === 0) {
      if (racing || this.lapMarks.length === 0) {
        this.leaderLaps = race.leaderLaps;
        this.lapMarks.push({ t, lap: race.leaderLaps + 1 });
      }
    }
    if (race.bestLapCar !== this.bestLapCar) {
      if (race.bestLapCar >= 0 && this.primed) this.addEvent('fastest', t, race.bestLapCar, -1, race.bestLap);
      this.bestLapCar = race.bestLapCar;
    }
    const L = race.track.length;
    for (const c of race.cars) {
      const p = this.prev[c.id];
      const car = c.car;
      const inPit = c.pit.phase !== 'none';
      if (this.primed && racing && !race.isTimeTrial) {
        // an overtake on the road: gained a place from a car that's right there (not a pit-stop shuffle)
        if (c.position < p.pos && !inPit && !c.retired && !c.finished) {
          const passed = race.cars.find((o) => o.position === c.position + 1);
          if (passed && passed.pit.phase === 'none' && !passed.retired) {
            const d = Math.abs(race.track.delta(car.s, passed.car.s));
            if (d < 60 && Math.abs(c.raceDist - passed.raceDist) < L * 0.5 && this.pending.length < 40) this.pending.push({ t, car: c.id, other: passed.id, pos: c.position });
          }
        }
        if (inPit && !p.pit) this.addEvent('pit', t, c.id);
        if (c.retired && !p.retired) this.addEvent('retired', t, c.id, -1, car.destroyed ? 1 : 0);
        if (c.finished && !p.finished) this.addEvent('finish', t, c.id, -1, c.position);
        // a big hit: integrity drops
        const hit = p.integrity - car.integrity;
        if (hit > 0.06 && t - p.crashT > 6) {
          p.crashT = t;
          this.addEvent('crash', t, c.id, -1, hit);
        }
        // a spin at speed
        if (Math.abs(car.r) > 1.6 && Math.abs(car.vy) > 6 && t - p.spinT > 10 && t - p.crashT > 3) {
          p.spinT = t;
          this.addEvent('spin', t, c.id);
        }
      }
      p.pos = c.position;
      p.pit = inPit;
      p.retired = c.retired;
      p.finished = c.finished;
      p.integrity = car.integrity;
    }
    // a pass counts once it has stuck for 2.5 s
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (t - p.t < 2.5) continue;
      this.pending.splice(i, 1);
      const a = race.cars[p.car], b = race.cars[p.other];
      if (a && b && a.position <= p.pos && b.position > a.position && !a.retired) this.addEvent(p.pos === 1 ? 'lead' : 'overtake', p.t, p.car, p.other, p.pos);
    }
    this.primed = true;
  }

  /** forget every frame recorded after session time t (after a flashback) */
  truncate(t: number) {
    while (this.count > 0 && this.timeAt(this.count - 1) > t) this.count--;
    while (this.events.length && this.events[this.events.length - 1].t > t) this.events.pop();
    while (this.lapMarks.length > 1 && this.lapMarks[this.lapMarks.length - 1].t > t) this.lapMarks.pop();
    this.leaderLaps = this.lapMarks.length ? this.lapMarks[this.lapMarks.length - 1].lap - 1 : 0;
    this.chunks.length = Math.max(this.count ? 1 : 0, Math.ceil(this.count / CHUNK));
    // re-learn the car states from the next sample (the race was restored)
    this.primed = false;
    this.lastApplyT = NaN;
    this.pending.length = 0;
  }

  /** index of the last frame at or before t (0 if t is before the start) */
  private frameAt(t: number): number {
    let lo = 0;
    let hi = this.count - 1;
    if (t <= this.timeAt(0)) return 0;
    if (t >= this.timeAt(hi)) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** set the ghosts (and the timing arrays) to the recorded state at absolute session time t */
  apply(t: number, trackLength: number) {
    if (this.count < 2) return;
    const ia = Math.min(this.frameAt(t), this.count - 2);
    const ib = ia + 1;
    const ca = this.chunks[ia >> 8], sa = ia & 255;
    const cb = this.chunks[ib >> 8], sb = ib & 255;
    const ta = ca.m[sa * NM];
    const tb = cb.m[sb * NM];
    const h = Math.max(1e-4, tb - ta);
    const f = Math.min(1, Math.max(0, (t - ta) / h));
    // cubic Hermite basis
    const f2 = f * f, f3 = f2 * f;
    const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
    const n = this.cars;
    const lerp = (a: number, b: number) => a + (b - a) * f;
    // the nearer frame's timing (discrete values don't interpolate)
    const near = f < 0.5 ? ca : cb, sn = f < 0.5 ? sa : sb;
    this.raceTime = lerp(ca.m[sa * NM + 1], cb.m[sb * NM + 1]);
    this.leaderLap = near.m[sn * NM + 2];
    const pl = near.m[sn * NM + 3];
    this.phase = Math.floor(pl / 8);
    this.lightsLit = pl - this.phase * 8;
    const wheelDt = isFinite(this.lastApplyT) && Math.abs(t - this.lastApplyT) < 0.5 ? t - this.lastApplyT : 0;
    this.lastApplyT = t;
    for (let k = 0; k < n; k++) {
      const fa = (sa * n + k) * NF, fb = (sb * n + k) * NF;
      const A = (sa * n + k) * NI, B = (sb * n + k) * NI;
      const ai = ca.i, bi = cb.i;
      const g = this.ghosts[k];
      const yawA = ai[A + I_YAW] / 10000, yawB = bi[B + I_YAW] / 10000;
      const vxA = ai[A + I_VX] / 100, vxB = bi[B + I_VX] / 100;
      const vyA = ai[A + I_VY] / 100, vyB = bi[B + I_VY] / 100;
      const rA = ai[A + I_R] / 1000, rB = bi[B + I_R] / 1000;
      // world velocities (the car's body frame: +x forward along yaw, vy to the left)
      const sA = Math.sin(yawA), cA = Math.cos(yawA), sB = Math.sin(yawB), cB = Math.cos(yawB);
      const wxA = vxA * sA + vyA * cA, wzA = vxA * cA - vyA * sA;
      const wxB = vxB * sB + vyB * cB, wzB = vxB * cB - vyB * sB;
      const xA = ca.f[fa], zA = ca.f[fa + 1], xB = cb.f[fb], zB = cb.f[fb + 1];
      // a teleport (reset / pit release / removal) mustn't be curved through
      const jump = (xB - xA) ** 2 + (zB - zA) ** 2 > (Math.max(Math.abs(vxA), Math.abs(vxB)) * h * 2 + 5) ** 2;
      if (jump) {
        g.x = f < 0.5 ? xA : xB;
        g.z = f < 0.5 ? zA : zB;
      } else {
        g.x = h00 * xA + h10 * h * wxA + h01 * xB + h11 * h * wxB;
        g.z = h00 * zA + h10 * h * wzA + h01 * zB + h11 * h * wzB;
      }
      let dy = yawB - yawA;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.yaw = jump ? (f < 0.5 ? yawA : yawB) : yawA + h10 * h * rA + h01 * dy + h11 * h * rB;
      let ds = cb.f[fb + 2] - ca.f[fa + 2];
      if (ds < -trackLength / 2) ds += trackLength;
      if (ds > trackLength / 2) ds -= trackLength;
      g.s = jump ? (f < 0.5 ? ca.f[fa + 2] : cb.f[fb + 2]) : (ca.f[fa + 2] + ds * f + trackLength) % trackLength;
      g.hint = Math.floor(g.s);
      g.lateral = lerp(ai[A + I_LAT], bi[B + I_LAT]) / 100;
      g.vx = lerp(vxA, vxB);
      g.vy = lerp(vyA, vyB);
      g.r = lerp(rA, rB);
      g.ax = (vxB - vxA) / h;
      g.ay = g.vx * g.r;
      g.steer = lerp(ai[A + I_STEER], bi[B + I_STEER]) / 30000;
      g.pitch = lerp(ai[A + I_PITCH], bi[B + I_PITCH]) / 30000;
      g.roll = lerp(ai[A + I_ROLL], bi[B + I_ROLL]) / 30000;
      g.heave = lerp(ai[A + I_HEAVE], bi[B + I_HEAVE]) / 10000;
      g.rpm = lerp(ai[A + I_RPM], bi[B + I_RPM]);
      g.throttle = lerp(ai[A + I_THR], bi[B + I_THR]) / 30000;
      g.brakeHeat = lerp(ai[A + I_BRK], bi[B + I_BRK]) / 30000;
      g.drsAnim = lerp(ai[A + I_DRS], bi[B + I_DRS]) / 30000;
      g.lastShift = 0;
      // wheels turn with the car's speed (their angle isn't recorded)
      const spin = (g.vx / g.spec.wheelR) * wheelDt;
      g.wheelAngleF = (g.wheelAngleF + spin) % (Math.PI * 2);
      g.wheelAngleR = (g.wheelAngleR + spin) % (Math.PI * 2);
      const N = near.i, NO = (sn * n + k) * NI;
      const pf = N[NO + I_POS];
      this.pos[k] = pf & 255;
      this.flags[k] = (pf >> 8) & 255;
      this.gap[k] = N[NO + I_GAP] / 100;
      this.laps[k] = N[NO + I_LAPS];
    }
  }

  /** the first recorded moment after t (or before, backwards) */
  nextEvent(t: number, dir: 1 | -1, minGap = 0.5): ReplayEvent | null {
    const ev = this.events;
    if (dir > 0) {
      for (const e of ev) if (e.t > t + minGap && e.kind !== 'finish') return e;
      return null;
    }
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t < t - minGap && ev[i].kind !== 'finish') return ev[i];
    return null;
  }
}
