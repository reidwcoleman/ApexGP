import type { Track } from '../world/Track.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';

/**
 * Tyres and pit stops, F1-game style.
 *
 *  - Three dry compounds trading grip for life.
 *  - Pit assist: once a stop is requested, crossing the pit-entry point hands
 *    the car to a scripted drive — slow to the 80 km/h limiter, run down the
 *    fast lane, swing into the team's box, a ~2.5 s stop with fresh tyres, then
 *    back out and released to the physics after the pit exit.
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

/** fresh tyres: out of the blankets (~80 °C for slicks) */
export function fitTyres(car: CarPhysics, c: Compound) {
  const k = COMPOUNDS[c];
  car.compoundGrip = k.grip;
  car.compoundWear = k.wear;
  car.tyreType = k.type;
  car.tyreOpt = k.tOpt;
  for (let i = 0; i < 4; i++) {
    car.wear[i] = 0;
    car.tyreTemp[i] = k.type === 0 ? 80 : 60;
  }
}

export type PitPhase = 'none' | 'in' | 'stop' | 'out';

export interface PitState {
  phase: PitPhase;
  /** s along the lap while in the pit (continuous, may exceed the lap length) */
  s: number;
  v: number;
  timer: number;
  stopTime: number;
  fromLat: number;
  boxS: number;
  next: Compound;
}

const LIMIT = 80 / 3.6;

export class PitLane {
  readonly track: Track;
  readonly side: number;
  /** pit assist takes over here (absolute s, may be negative = before s 0) */
  readonly takeoverS: number;
  readonly limiterStart: number;
  readonly limiterEnd: number;
  /** car is handed back to the physics here */
  readonly releaseS: number;
  readonly fastLat: number;
  readonly boxLat: number;
  private readonly mid: number;

  constructor(track: Track) {
    this.track = track;
    const p = track.pit;
    this.side = p.side;
    // the limiter zone covers the garages (the long lane ends run at pit-entry speed),
    // which keeps the time lost to a stop near the real ~21 s
    this.limiterStart = p.sStart + 150;
    this.limiterEnd = p.sEnd - 150;
    this.takeoverS = p.sStart - 170;
    this.releaseS = p.sEnd + 120;
    this.fastLat = p.side * (p.laneInner + 3.2);
    this.boxLat = p.side * (p.laneOuter - 3.2);
    this.mid = (p.sStart + p.sEnd) / 2;
  }

  /** box position for the team at index k of TEAMS (matches the garages) */
  boxFor(teamIndex: number): number {
    return this.mid + (teamIndex - 4.5) * 18;
  }

  /** lap distance at which a car must be (entering) to be taken into the pits */
  get takeoverLapDist(): number {
    return this.track.lapDistance(this.track.wrap(this.takeoverS));
  }

  begin(ps: PitState, car: CarPhysics, boxS: number, next: Compound) {
    ps.phase = 'in';
    // continuous s from the takeover point (unwrap across the lap start)
    ps.s = this.takeoverS + this.track.delta(this.track.wrap(this.takeoverS), car.s);
    ps.v = Math.max(8, car.vx);
    ps.timer = 0;
    ps.fromLat = car.lateral;
    ps.boxS = boxS;
    ps.next = next;
  }

  /** lateral of the pit path at continuous s */
  private lateralAt(ps: PitState, s: number): number {
    const sm = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const p = this.track.pit;
    let lat: number;
    if (s < p.sStart + 20) lat = ps.fromLat + (this.fastLat - ps.fromLat) * sm(this.takeoverS + 30, p.sStart + 20, s);
    else if (s <= p.sEnd - 20) lat = this.fastLat;
    else lat = this.fastLat + (this.side * 3.5 - this.fastLat) * sm(p.sEnd - 20, this.releaseS - 20, s);
    // swing into the box and back out
    const d = s - ps.boxS;
    if (d > -34 && d < 30) {
      const w = d < 0 ? sm(-34, -8, d) : 1 - sm(4, 30, d);
      lat += (this.boxLat - this.fastLat) * w;
    }
    return lat;
  }

  /** advance a car on the pit path; returns true when it's released to the physics */
  update(dt: number, ps: PitState, car: CarPhysics, onStop: () => void): boolean {
    const track = this.track;
    // target speed along the path
    let vt: number;
    if (ps.phase === 'stop') {
      ps.timer += dt;
      ps.v = 0;
      if (ps.timer >= ps.stopTime) {
        ps.phase = 'out';
      }
    } else {
      const toLimiter = this.limiterStart - ps.s;
      const toBox = ps.boxS - ps.s;
      if (ps.phase === 'in' && toBox <= 0.5) {
        ps.phase = 'stop';
        ps.v = 0;
        ps.timer = 0;
        onStop();
      }
      if (ps.phase === 'in') {
        // brake to the limiter by the pit entry line, then to a stop at the box
        const vLim = toLimiter > 0 ? Math.sqrt(LIMIT * LIMIT + 2 * 26 * toLimiter) : LIMIT;
        const vBox = Math.sqrt(2 * 9 * Math.max(0, toBox));
        vt = Math.min(vLim, vBox);
        if (ps.v > vt) ps.v = Math.max(vt, ps.v - 30 * dt);
        else ps.v = Math.min(vt, ps.v + 6 * dt);
      } else if (ps.phase === 'out') {
        vt = ps.s < this.limiterEnd ? LIMIT : ps.s < this.track.pit.sEnd ? 36 : 62;
        ps.v = Math.min(vt, ps.v + (ps.s < this.limiterEnd ? 7 : 11) * dt);
      }
    }
    const ds = ps.v * dt;
    const s0 = ps.s;
    ps.s += ds;
    // pose from the path
    const lat = this.lateralAt(ps, ps.s);
    const latB = this.lateralAt(ps, ps.s + 1.5);
    const sw = track.wrap(ps.s);
    const f = track.frame(sw);
    const p = track.point(sw, lat);
    const yawNew = f.heading - Math.atan2(latB - lat, 1.5);
    const dyaw = yawNew - car.yaw;
    car.x = p.x;
    car.z = p.z;
    car.y = p.y;
    car.r = dt > 0 ? Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) / dt : 0;
    car.yaw = yawNew;
    car.s = sw;
    car.hint = Math.floor(sw);
    car.lateral = lat;
    car.relYaw = yawNew - f.heading;
    car.vx = ps.v;
    car.vy = 0;
    for (let i = 0; i < 4; i++) car.omega[i] = ps.v / car.spec.wheelR;
    car.wheelAngleF += (ps.v / car.spec.wheelR) * dt;
    car.wheelAngleR += (ps.v / car.spec.wheelR) * dt;
    car.steer = Math.max(-0.3, Math.min(0.3, -Math.atan2(latB - lat, 1.5) * 3));
    car.throttle = ps.phase === 'out' ? 0.6 : 0.15;
    car.brake = ps.phase === 'in' && ps.v > 23 ? 0.6 : 0;
    const gearFor = ps.v < 12 ? 1 : ps.v < 22 ? 2 : ps.v < 32 ? 3 : 4;
    car.gear = gearFor;
    car.rpm = Math.max(car.spec.rpmIdle, (ps.v / (2 * Math.PI * car.spec.wheelR)) * 60 * car.overallRatio(gearFor));
    car.limiter = false;
    car.drsOpen = false;
    car.ax = 0;
    car.ay = 0;
    car.offTrack = false;
    car.onKerb = false;
    void s0;
    if (ps.phase === 'out' && ps.s >= this.releaseS) {
      ps.phase = 'none';
      car.setSpeed(ps.v);
      return true;
    }
    return false;
  }
}
