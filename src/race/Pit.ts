import { Vector3 } from 'three';
import type { Track } from '../world/Track.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import { L as PL, makePlan, type PitPlan } from '../world/pitlane/layout.ts';

/**
 * Tyres and pit stops, F1-game style.
 *
 *  - Three dry compounds trading grip for life.
 *  - Pit assist: once a stop is requested, crossing the pit-entry point hands
 *    the car to a scripted drive along a precomputed path: onto the entry spur,
 *    braking (curvature- and limiter-capped, jerk-limited) down the fast lane,
 *    a smooth swing into the team's box and a constant-deceleration stop exactly
 *    on the marks. The stop itself follows STOP (jacks up, wheels off, new wheels
 *    on, jacks down, green light), the car pulls away with a little wheelspin,
 *    swings back into the fast lane, accelerates after the limiter line and runs
 *    along the pit side of the track until it is handed back to the physics.
 *  - Cars in the pit lane queue behind each other (never through), and a car is
 *    held in its box while another is coming down the fast lane (safe release).
 */

export type Compound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
/** dry slicks, softest first */
export const DRY_COMPOUNDS: Compound[] = ['soft', 'medium', 'hard'];
/** every compound, in menu order */
export const COMPOUND_ORDER: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

/**
 * grip: peak μ multiplier on a dry track at working temperature; wear: wear
 * rate multiplier; type: 0 slick, 1 intermediate, 2 full wet (the physics
 * looks up wet-track grip by type); tOpt: centre of the working window (°C).
 */
export const COMPOUNDS: Record<Compound, { label: string; short: string; color: string; grip: number; wear: number; type: 0 | 1 | 2; tOpt: number }> = {
  soft: { label: 'Soft', short: 'S', color: '#ff2d3c', grip: 1.0, wear: 1.6, type: 0, tOpt: 98 },
  medium: { label: 'Medium', short: 'M', color: '#ffd21f', grip: 0.983, wear: 1.0, type: 0, tOpt: 104 },
  hard: { label: 'Hard', short: 'H', color: '#eeeeee', grip: 0.966, wear: 0.62, type: 0, tOpt: 110 },
  inter: { label: 'Intermediate', short: 'I', color: '#35c95a', grip: 1.0, wear: 1.15, type: 1, tOpt: 80 },
  wet: { label: 'Wet', short: 'W', color: '#2f8cff', grip: 1.0, wear: 0.9, type: 2, tOpt: 65 },
};

export const isDry = (c: Compound) => COMPOUNDS[c].type === 0;

/**
 * The tyre the conditions call for at a given water level under the racing
 * line (crossovers from the physics' grip tables: slick/inter ≈ 0.2,
 * inter/wet ≈ 0.72).
 */
export function tyreTypeFor(wetOnLine: number): 0 | 1 | 2 {
  return wetOnLine < 0.2 ? 0 : wetOnLine < 0.72 ? 1 : 2;
}

/** fresh tyres: a brand-new set out of the blankets (100 % life, ~80 °C slicks / 60 °C wets) */
export function fitTyres(car: CarPhysics, c: Compound) {
  const k = COMPOUNDS[c];
  car.compoundGrip = k.grip;
  car.compoundWear = k.wear;
  car.tyreType = k.type;
  car.tyreOpt = k.tOpt;
  for (let i = 0; i < 4; i++) {
    car.wear[i] = 0;
    car.tyreTemp[i] = k.type === 0 ? 80 : 60;
    car.slipPowL[i] = 0;
    car.slipPowT[i] = 0;
  }
}

// ------------------------------------------------------------------------------------ the stop

/**
 * Choreography of a stop, seconds from the moment the car is stationary (a
 * ~2.3 s F1 stop). Wheel order FL FR RL RR; each crew works a few hundredths
 * apart. A "slow" stop is a sticky wheel nut: that gunner finishes late and the
 * jacks wait for him.
 */
export const STOP = {
  /** jacks under and up */
  jackF: [0.0, 0.2],
  jackR: [0.05, 0.25],
  /** guns on the nuts */
  gun: 0.2,
  /** old wheels pulled off (0 → removed) */
  off: [0.3, 0.6],
  /** the car's tyres are the new set from here (every old wheel is off) */
  swap: 0.72,
  /** new wheels pushed on (removed → 0) */
  on: [0.78, 1.04],
  /** guns tightened, gunner's hand up */
  tight: 1.28,
  /** jacks down, relative to the end of the stop */
  dropF: [-0.44, -0.24],
  dropR: [-0.5, -0.3],
  /** release light green, relative to the end */
  green: -0.12,
  /** the shortest stop the choreography fits in */
  min: 2.05,
};
const WHEEL_LAG = [0.0, 0.05, 0.03, 0.07];

const ramp = (a: number, b: number, t: number) => (t <= a ? 0 : t >= b ? 1 : ((t - a) / (b - a)) ** 2 * (3 - 2 * (t - a) / (b - a)));

export interface StopPose {
  /** jack lift 0 … 1 at the front and rear */
  liftF: number;
  liftR: number;
  /** per wheel: 0 fitted, 1 removed (in between: sliding off / on along the axle) */
  wheel: [number, number, number, number];
  /** the wheels on (or going on) the car are the new set */
  fresh: boolean;
  /** per wheel: the wheel gun's nut is done up (the gunner raises a hand) */
  tight: [boolean, boolean, boolean, boolean];
}

/** the pose of the stop `t` seconds in, for a stop planned at `T` seconds with a slow wheel (−1: none) */
export function stopPose(t: number, T: number, slow: number, out: StopPose): StopPose {
  const end = Math.max(STOP.min, T);
  out.liftF = ramp(STOP.jackF[0], STOP.jackF[1], t) * (1 - ramp(end + STOP.dropF[0], end + STOP.dropF[1], t));
  out.liftR = ramp(STOP.jackR[0], STOP.jackR[1], t) * (1 - ramp(end + STOP.dropR[0], end + STOP.dropR[1], t));
  out.fresh = t >= STOP.swap;
  for (let i = 0; i < 4; i++) {
    const d = WHEEL_LAG[i];
    out.wheel[i] = t < STOP.swap ? ramp(STOP.off[0] + d, STOP.off[1] + d, t) : 1 - ramp(STOP.on[0] + d, STOP.on[1] + d, t);
    const tight = i === slow ? end - 0.62 : STOP.tight + d;
    out.tight[i] = t >= tight;
  }
  return out;
}

export function newStopPose(): StopPose {
  return { liftF: 0, liftR: 0, wheel: [0, 0, 0, 0], fresh: false, tight: [false, false, false, false] };
}

// ------------------------------------------------------------------------------------ the pit lane

export type PitPhase = 'none' | 'in' | 'stop' | 'out';

/** a car's trip through the pits (plain numbers: flashbacks snapshot it) */
export interface PitState {
  phase: PitPhase;
  /** s along the lap while in the pit (continuous from the takeover, may exceed the lap length) */
  s: number;
  v: number;
  /** longitudinal acceleration (jerk-limited) */
  a: number;
  /** seconds stationary in the box */
  timer: number;
  /** planned stationary time */
  stopTime: number;
  fromLat: number;
  boxS: number;
  next: Compound;
  /** the compound coming off */
  prev: Compound;
  /** wheel with a sticky nut (−1 none) */
  slow: number;
  /** the new tyres are on (physics) */
  swapped: boolean;
  /** held in the box for traffic in the fast lane */
  held: boolean;
  /** release light is green */
  green: boolean;
  /** seconds since pulling away from the box (wheelspin, the crew stepping back) */
  launch: number;
  /** current lateral offset (signed) */
  lat: number;
  /** seconds spent waiting at the end of the lane for a gap in the traffic */
  wait: number;
}

export function newPitState(): PitState {
  return { phase: 'none', s: 0, v: 0, a: 0, timer: 0, stopTime: 2.4, fromLat: 0, boxS: 0, next: 'medium', prev: 'medium', slow: -1, swapped: false, held: false, green: false, launch: 0, lat: 0, wait: 0 };
}

const LIMIT = 80 / 3.6;
/** speed through the entry spur and the lane ends outside the limiter zone */
const LANE_V = 30;
/** constant deceleration of the final stop on the marks */
const A_BOX = 5.2;
/** accel after the limiter line */
const A_EXIT = 11;
/** lateral acceleration allowed on the scripted path */
const A_LAT = 15;
/** downforce: lateral grip grows with v² (a_lat = A_LAT + AERO_LAT · v²) */
const AERO_LAT = 0.0045;
/** jerk limit (m/s³) */
const JERK = 45;
/** nose-to-nose gap kept behind a car in the pit lane (m) */
const GAP = 8.6;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const smoother = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export interface PitNeighbour {
  id: number;
  ps: PitState;
}

export class PitLane {
  readonly track: Track;
  readonly plan: PitPlan;
  readonly side: number;
  /** pit assist takes over here (absolute s, may be negative = before s 0) */
  readonly takeoverS: number;
  readonly limiterStart: number;
  readonly limiterEnd: number;
  /** car is handed back to the physics here */
  readonly releaseS: number;
  /** |lateral| of the fast lane, the box (car centre), the road edge lane at entry / exit */
  readonly fastL: number;
  readonly boxL: number;
  readonly edgeL: number;
  readonly exitL: number;
  /** signed laterals */
  readonly fastLat: number;
  readonly boxLat: number;
  /** per metre from takeoverS: standard |lateral| (no box swing, entry from the edge lane), speed cap, path metres per s-metre */
  private readonly baseL: Float32Array;
  private readonly cap: Float32Array;
  private readonly scale: Float32Array;
  private readonly n: number;

  constructor(track: Track) {
    this.track = track;
    const plan = (this.plan = makePlan(track));
    const p = track.pit;
    this.side = p.side;
    // the limiter zone covers the garages (the long lane ends run at pit-entry speed),
    // which keeps the time lost to a stop near the real ~21 s
    this.limiterStart = plan.limitStart;
    this.limiterEnd = plan.limitEnd;
    this.takeoverS = p.sStart - 240;
    this.releaseS = p.sEnd + 150;
    this.fastL = PL.fast;
    this.boxL = PL.box;
    const road = plan.road;
    this.edgeL = road - 1.05;
    this.exitL = road - 1.35;
    this.fastLat = p.side * this.fastL;
    this.boxLat = p.side * this.boxL;

    // the standard path, its curvature and the speed it allows
    // (the path runs on past the release along the pit side of the road, so the exit sees the next corner coming)
    const n = (this.n = Math.ceil(this.releaseS - this.takeoverS) + 260);
    this.baseL = new Float32Array(n);
    this.cap = new Float32Array(n);
    this.scale = new Float32Array(n);
    const xs = new Float32Array(n), zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.takeoverS + i;
      const l = this.stdL(s);
      this.baseL[i] = l;
      const pt = track.point(track.wrap(s), this.side * l);
      xs[i] = pt.x;
      zs[i] = pt.z;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      this.scale[i] = Math.hypot(xs[b] - xs[a], zs[b] - zs[a]) / Math.max(1, b - a);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, Math.min(n - 7, i - 3)), b = a + 6;
      const m = a + 3;
      const h0 = Math.atan2(xs[m] - xs[a], zs[m] - zs[a]);
      const h1 = Math.atan2(xs[b] - xs[m], zs[b] - zs[m]);
      let dh = h1 - h0;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const dist = Math.max(0.5, Math.hypot(xs[b] - xs[a], zs[b] - zs[a]) / 2);
      const k = Math.abs(dh) / dist;
      // grip for the corner: the tyres' own plus downforce (≈ v² · 0.0045 m/s² per (m/s)²)
      this.cap[i] = k > AERO_LAT + 1e-5 ? Math.min(95, Math.sqrt(A_LAT / (k - AERO_LAT))) : 95;
    }
  }

  /** curvature cap of this car's own path (the blend in from where it was at the takeover) */
  private ownCap(ps: PitState, s: number): number {
    const t = this.track;
    const a = t.point(t.wrap(s - 4), this.lateralAt(ps, s - 4), 0, this.pa);
    const m = t.point(t.wrap(s), this.lateralAt(ps, s), 0, this.pm);
    const b = t.point(t.wrap(s + 4), this.lateralAt(ps, s + 4), 0, this.pb);
    let dh = Math.atan2(b.x - m.x, b.z - m.z) - Math.atan2(m.x - a.x, m.z - a.z);
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const k = Math.abs(dh) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z) / 2);
    return k > AERO_LAT + 1e-5 ? Math.min(95, Math.sqrt(A_LAT / (k - AERO_LAT))) : 95;
  }
  private readonly pa = new Vector3();
  private readonly pm = new Vector3();
  private readonly pb = new Vector3();

  /**
   * The racing speed at a point of the lap (the race sets it from its speed profile): past the release
   * the car is driven again, so the exit plans its speed for the corner coming by that, not by the lane.
   */
  trackSpeed: ((s: number) => number) | null = null;

  /**
   * Is racing traffic about to reach the exit car before it's up to speed and released (seconds it
   * still needs to the release)? Set by the race; the exit car then waits for a gap at the end of the lane.
   */
  mergeBusy: ((ps: PitState, tRelease: number) => boolean) | null = null;
  /** the most a car waits at the end of the lane for a gap (s) */
  static readonly MAX_WAIT = 5;
  private exitT = -1;
  /** seconds from the end of the lane to the release, driving the exit's limits (slow corners right after it count) */
  private exitTime(): number {
    if (this.exitT >= 0) return this.exitT;
    const s0 = this.plan.sEnd - 14, n = Math.max(1, Math.ceil(this.releaseS - s0));
    const v = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) v[i] = Math.max(5, this.limitAt(s0 + i, true));
    // accelerating from lane speed, braking for what's ahead
    v[0] = Math.min(v[0], LIMIT);
    for (let i = 1; i <= n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * A_EXIT * 0.7));
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * 15));
    let t = 0;
    for (let i = 0; i < n; i++) t += 2 / (v[i] + v[i + 1]);
    return (this.exitT = t);
  }

  /** the speed allowed at continuous s on the way in / out: the path's curvature, the lane speed, the limiter */
  private limitAt(s: number, out: boolean, ps?: PitState): number {
    if (out && this.trackSpeed && s > this.releaseS - 25) return Math.min(88, this.trackSpeed(this.track.wrap(s)) * 0.92);
    let v = ps && s < this.plan.entryS + 6 ? this.ownCap(ps, s) : this.cap[this.idx(s)];
    if (!out) {
      if (s >= this.plan.sStart - 10) v = Math.min(v, LANE_V);
      if (s >= this.limiterStart) v = Math.min(v, LIMIT);
    } else {
      if (s < this.limiterEnd) v = Math.min(v, LIMIT);
      else if (s < this.plan.sEnd) v = Math.min(v, LANE_V + 12);
      v = Math.min(v, 88);
    }
    return v;
  }

  /** the steady deceleration that meets every limit in the next `horizon` metres (0: none needed) */
  private brakeNeed(s: number, v: number, out: boolean, horizon: number, ps?: PitState): number {
    let need = 0;
    const v2 = v * v;
    for (let k = 2; k <= horizon; k += 2) {
      const lim = this.limitAt(s + k, out, ps);
      if (lim < v) need = Math.max(need, (v2 - lim * lim) / (2 * k));
    }
    return need;
  }

  /** standard |lateral| of the pit path at continuous s (entry from the road-edge lane, no box swing) */
  private stdL(s: number): number {
    const p = this.plan;
    const { sStart, sEnd } = p;
    if (s < sStart + 10) {
      // road edge → onto the spur (clear of the painted entry line, which leaves the road edge at entryS + 50) → the fast lane
      const lineStart = p.entryS + 50;
      // (both ramps stay clear of the painted line: the lane is ≥ 1.15 m beyond it everywhere)
      let l = this.edgeL + (p.road + 1.6 - this.edgeL) * smooth(lineStart - 60, lineStart + 2, s);
      l += (this.fastL - p.road - 1.6) * smooth(lineStart - 6, sStart + 8, s);
      return l;
    }
    if (s <= sEnd - 12) return this.fastL;
    // fast lane → out past the painted exit line → along the pit side of the road
    let l = this.fastL + (this.exitL - this.fastL) * smoother(sEnd - 12, sEnd + 95, s);
    return l;
  }

  /** box position for the team at index k of TEAMS (matches the garages) */
  boxFor(teamIndex: number): number {
    return this.plan.boxS(teamIndex);
  }

  /** lap distance at which a car must be (entering) to be taken into the pits */
  get takeoverLapDist(): number {
    return this.track.lapDistance(this.track.wrap(this.takeoverS));
  }

  /** metres (along the lap) from s to the takeover point, in (−L/2, L/2]: > 0 = still to come */
  toTakeover(s: number): number {
    return this.track.delta(s, this.track.wrap(this.takeoverS));
  }

  begin(ps: PitState, car: CarPhysics, boxS: number, next: Compound) {
    ps.phase = 'in';
    // continuous s from the takeover point (unwrap across the lap start)
    ps.s = this.takeoverS + this.track.delta(this.track.wrap(this.takeoverS), car.s);
    ps.v = Math.max(8, car.vx);
    ps.a = 0;
    ps.timer = 0;
    ps.fromLat = car.lateral;
    ps.lat = car.lateral;
    ps.boxS = boxS;
    ps.next = next;
    ps.swapped = false;
    ps.held = false;
    ps.green = false;
    ps.launch = 0;
    ps.wait = 0;
  }

  private idx(s: number): number {
    return Math.max(0, Math.min(this.n - 1, Math.round(s - this.takeoverS)));
  }

  /** signed lateral of the pit path at continuous s for this car */
  lateralAt(ps: PitState, s: number): number {
    let l = this.baseL[this.idx(s)];
    // blend in from wherever the car was at the takeover
    const from = this.side * ps.fromLat;
    const w0 = 1 - smoother(this.takeoverS + 6, this.plan.entryS + 2, s);
    if (w0 > 0) l += (from - this.edgeL) * w0;
    // swing into the box and back out
    const d = s - ps.boxS;
    // (short enough to clear a car stopped in the box before / after: boxes are 18 m apart)
    if (d > -21 && d < 21) {
      const w = d < 0 ? smoother(-21, -3.5, d) : 1 - smoother(3.5, 21, d);
      l += (this.boxL - this.fastL) * w;
    }
    return this.side * l;
  }

  /**
   * Advance a car on the pit path. `others` are the other cars in the pits (for
   * queueing and the safe release). Hooks fire when the car stops, when the new
   * tyres go on and when it is released to the physics (return value true).
   */
  update(dt: number, ps: PitState, car: CarPhysics, others: PitNeighbour[], hooks: { onStop(): void; onTyres(): void; onRelease(): void }): boolean {
    const track = this.track;
    // ---- the car ahead in the lane (queue)
    let dQueue = Infinity;
    let vAhead = 0;
    for (const o of others) {
      const q = o.ps;
      if (q === ps || q.phase === 'none') continue;
      // (in path metres: the lane is offset from a curved centreline, so s-metres aren't road metres)
      const ds = (q.s - ps.s) * (this.scale[this.idx((q.s + ps.s) / 2)] || 1);
      if (ds <= 0 || ds > 70) continue;
      // same lane: where I'll be when I get there (a car pulling out of its box counts as in the lane a little earlier)
      const myThere = this.lateralAt(ps, q.s);
      const w = q.phase === 'out' ? 3.1 : 2.3;
      if (Math.abs(myThere - q.lat) > w) continue;
      if (ds - GAP < dQueue) {
        dQueue = ds - GAP;
        vAhead = q.v;
      }
    }

    if (ps.phase === 'stop') {
      ps.timer += dt;
      ps.v = 0;
      ps.a = 0;
      if (!ps.swapped && ps.timer >= STOP.swap) {
        ps.swapped = true;
        hooks.onTyres();
      }
      const due = ps.timer >= Math.max(STOP.min, ps.stopTime);
      // safe release: nobody coming down the lane past this box close behind (or alongside)
      let traffic = false;
      if (ps.timer >= Math.max(STOP.min, ps.stopTime) + STOP.dropF[0] - 0.2) {
        for (const o of others) {
          const q = o.ps;
          if (q === ps || q.phase === 'none' || q.phase === 'stop') continue;
          const ds = ps.s - q.s;
          // will it pass this box? (leaving a box upstream, or heading for one downstream)
          const passes = q.phase === 'out' || q.boxS > ps.s + 3;
          // (only moving cars: one stuck in a queue must never hold the car it's queueing for)
          if (passes && ds > -10 && ds < 50 && q.v > 1.5) traffic = true;
        }
      }
      ps.held = traffic;
      ps.green = !traffic && ps.timer >= Math.max(STOP.min, ps.stopTime) + STOP.green;
      if (due && !traffic) {
        ps.phase = 'out';
        ps.launch = 0;
        ps.green = true;
      }
    } else if (ps.phase === 'in') {
      const toBox = ps.boxS - ps.s;
      // steady braking from the takeover that meets every limit ahead: the entry's curves, lane speed at the pit entry, the limiter
      let vt = this.limitAt(ps.s, false, ps);
      const brake = ps.s < this.limiterStart + 5 ? this.brakeNeed(ps.s, ps.v, false, 320, ps) : 0;
      // the car in front: keep the gap (closing speed bleeds off as the gap shrinks)
      if (dQueue < Infinity) vt = Math.min(vt, dQueue > 0 ? vAhead + Math.sqrt(2 * 4 * dQueue) : Math.max(0, vAhead - 2));
      // stopping points ahead: the box, a stationary car in front
      const dStop = Math.min(toBox, vAhead < 0.5 ? dQueue : Infinity);
      // no speeding up again on the way in (only out of a queue, up to the limiter)
      let aWant = Math.max(-26, Math.min(ps.v < LIMIT ? 6 : 0, (vt - ps.v) * 2.5));
      if (brake > 0.4) aWant = Math.min(aWant, -Math.min(24, brake * 1.08));
      const need = (ps.v * ps.v) / (2 * Math.max(0.05, dStop));
      const exact = dStop < 90 && need > A_BOX * 0.8;
      if (exact) aWant = Math.min(aWant, -Math.min(need, 14));
      ps.a += Math.max(-JERK * dt, Math.min(JERK * dt, aWant - ps.a));
      // the last few metres: exactly the deceleration that stops on the marks (no jerk limit)
      if (exact && need > A_BOX) ps.a = Math.min(ps.a, -Math.min(need, 14));
      // never into the back of the car in front: the relative deceleration that holds the gap
      if (dQueue < 40 && ps.v > vAhead) ps.a = Math.min(ps.a, -((ps.v - vAhead) ** 2) / (2 * Math.max(0.3, dQueue + 2.5)));
      // two cars diving in together: the one behind brakes as hard as an F1 car can to drop in line
      if (dQueue < 0 && ps.v > 12) ps.a = Math.min(ps.a, -Math.min(45, 12 - dQueue * 4));
      ps.a = Math.max(ps.s < this.plan.sStart ? -45 : -28, ps.a);
      ps.v = Math.max(0, ps.v + ps.a * dt);
      if (ps.v === 0 && ps.a < 0) ps.a = 0;
      if (toBox < 0.05 && ps.v < 0.6) {
        // on the marks
        ps.s = ps.boxS;
        ps.phase = 'stop';
        ps.v = 0;
        ps.a = 0;
        ps.timer = 0;
        ps.green = false;
        hooks.onStop();
      }
    } else if (ps.phase === 'out') {
      ps.launch += dt;
      let vt = this.limitAt(ps.s, true);
      const brake = this.brakeNeed(ps.s, ps.v, true, 240);
      if (dQueue < Infinity) vt = Math.min(vt, dQueue > 0 ? vAhead + Math.sqrt(2 * 4 * dQueue) : Math.max(0, vAhead - 2));
      // the end of the lane: look for a gap in the traffic before joining (wait at the line if a car
      // on the track would catch this one before it's up to speed — for a few seconds at most)
      const holdS = this.plan.sEnd - 14;
      if (this.mergeBusy && ps.s > this.limiterEnd - 40 && ps.s < holdS && ps.wait < PitLane.MAX_WAIT) {
        const tRel = (holdS - ps.s) / Math.max(8, ps.v) + this.exitTime() + (ps.v < 6 ? 1 : 0);
        if (this.mergeBusy(ps, tRel)) {
          vt = Math.min(vt, Math.sqrt(2 * 5 * Math.max(0, holdS - ps.s - 1)));
          if (ps.v < 3) ps.wait += dt;
        }
      }
      // launch from the box: clutch bite, a little wheelspin, then the limiter
      const aMax = ps.s < this.limiterEnd ? Math.min(7.5, 2 + ps.launch * 14) : A_EXIT * Math.max(0.3, Math.min(1, (100 - ps.v) / 65));
      let aWant = Math.max(-18, Math.min(aMax, (vt - ps.v) * 2.5));
      if (brake > 0.4) aWant = Math.min(aWant, -Math.min(20, brake * 1.08));
      ps.a += Math.max(-JERK * dt, Math.min(JERK * dt, aWant - ps.a));
      if (dQueue < 40 && ps.v > vAhead) ps.a = Math.min(ps.a, -((ps.v - vAhead) ** 2) / (2 * Math.max(0.3, dQueue + 2.5)));
      ps.a = Math.max(-28, ps.a);
      ps.v = Math.max(0, ps.v + ps.a * dt);
      if (ps.v === 0 && ps.a < 0) ps.a = 0;
    }

    // ---- move along the path (s advances by path metres / path length per s-metre)
    const sc = this.scale[this.idx(ps.s)] || 1;
    if (ps.phase !== 'stop') ps.s += (ps.v * dt) / sc;
    if (ps.phase === 'in' && ps.s > ps.boxS) ps.s = ps.boxS;
    const lat = this.lateralAt(ps, ps.s);
    ps.lat = lat;
    const sw = track.wrap(ps.s);
    const f = track.frame(sw);
    const p = track.point(sw, lat);
    // heading from the path itself (the lane is offset from a curved centreline)
    const pa = track.point(track.wrap(ps.s - 0.8), this.lateralAt(ps, ps.s - 0.8));
    const pb = track.point(track.wrap(ps.s + 0.8), this.lateralAt(ps, ps.s + 0.8));
    const yawNew = Math.atan2(pb.x - pa.x, pb.z - pa.z);
    let dyaw = yawNew - car.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    car.x = p.x;
    car.z = p.z;
    car.y = p.y;
    car.r = dt > 0 ? dyaw / dt : 0;
    car.yaw = yawNew;
    car.s = sw;
    car.hint = Math.floor(sw);
    car.lateral = lat;
    let rel = yawNew - f.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    car.relYaw = rel;
    car.vx = ps.v;
    car.vy = 0;
    const wR = car.spec.wheelR;
    const spin = ps.phase === 'out' && ps.launch < 0.9 ? (1 - ps.launch / 0.9) * 9 : 0;
    for (let k = 0; k < 4; k++) car.omega[k] = (ps.v + (k >= 2 ? spin : 0)) / wR;
    car.wheelAngleF += (ps.v / wR) * dt;
    car.wheelAngleR += ((ps.v + spin) / wR) * dt;
    car.wheelspin = spin > 0 ? Math.min(1, spin / 9) * 0.5 : 0;
    // steering: the path's curvature (held while stationary)
    if (ps.v > 0.3) {
      const L = car.spec.a + car.spec.b;
      const want = Math.max(-0.35, Math.min(0.35, Math.atan((L * car.r) / Math.max(1, ps.v))));
      car.steer += (want - car.steer) * Math.min(1, dt * 10);
    }
    car.throttle = ps.phase === 'out' ? (ps.launch < 1.2 ? 0.55 : 0.9) : ps.phase === 'stop' ? 0 : ps.a > 0.3 ? 0.35 : 0.05;
    car.brake = ps.phase === 'stop' ? 1 : ps.a < -1 ? Math.min(1, -ps.a / 20) : 0;
    const gearFor = ps.v < 13 ? 1 : ps.v < 23 ? 2 : ps.v < 34 ? 3 : ps.v < 46 ? 4 : ps.v < 58 ? 5 : 6;
    car.gear = gearFor;
    const rpmT = ps.phase === 'stop' ? car.spec.rpmIdle + 600 : Math.max(car.spec.rpmIdle, ((ps.v + spin) / (2 * Math.PI * wR)) * 60 * car.overallRatio(gearFor));
    car.rpm += (rpmT - car.rpm) * Math.min(1, dt * 8);
    car.limiter = false;
    car.drsOpen = false;
    car.ax = ps.a;
    car.ay = ps.v * car.r;
    car.offTrack = false;
    car.onKerb = false;
    // chassis: nose dives under braking, squats on the launch, settles when stopped
    const kk = Math.min(1, dt * 9);
    car.pitch += (-ps.a * 0.0024 - car.pitch) * kk;
    car.roll += (-car.ay * 0.0017 - car.roll) * kk;
    car.heave += (0 - car.heave) * kk;
    if (ps.phase === 'out' && ps.s >= this.releaseS) {
      ps.phase = 'none';
      car.setSpeed(ps.v);
      hooks.onRelease();
      return true;
    }
    return false;
  }
}
