import type { Track } from '../world/Track.ts';
import type { CarPhysics, DriveInput } from './CarPhysics.ts';
import type { RacingProfile } from './RacingProfile.ts';

/**
 * AI driver. Pure-pursuit steering toward the racing line (plus a lateral
 * offset used for overtaking and avoiding), speed tracking against the
 * precomputed profile, simple racecraft: follow, pick a side, commit, return.
 */

export interface Neighbour {
  id: number;
  s: number;
  lateral: number;
  speed: number;
}

export class AIDriver {
  /** 0.9..1.0: fraction of the profile speed this driver can carry */
  pace: number;
  aggression: number;
  offset = 0;
  targetOffset = 0;
  private reaction: number;
  private startTimer = 0;
  private stuckTimer = 0;
  private wobblePhase = Math.random() * 100;
  private passSide = 0;
  private passTimer = 0;
  /** true once the race has started for this driver */
  launched = false;
  readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false };

  constructor(pace: number, aggression: number) {
    this.pace = pace;
    this.aggression = aggression;
    this.reaction = 0.16 + Math.random() * 0.22;
  }

  /** start from wherever the car is (e.g. a grid slot) and merge onto the line gradually */
  startFrom(car: CarPhysics, track: Track) {
    this.offset = this.targetOffset = car.lateral - track.racingLineAt(car.s);
  }

  /** returns true if the car should be reset onto the track */
  update(dt: number, car: CarPhysics, track: Track, profile: RacingProfile, racing: boolean, others: Neighbour[], selfId: number): boolean {
    const inp = this.input;
    if (!racing) {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = 0;
      inp.hold = true;
      this.startTimer = 0;
      return false;
    }
    inp.hold = false;
    this.startTimer += dt;
    if (this.startTimer < this.reaction) {
      inp.throttle = 0.55;
      inp.brake = 0;
      inp.hold = true;
      return false;
    }
    this.launched = true;

    const v = Math.max(0, car.vx);
    const L = car.spec.a + car.spec.b;
    const hw = track.halfWidthAt(car.s);

    // ---- racecraft: traffic ahead / alongside
    let followSpeed = Infinity;
    let blockL = false;
    let blockR = false;
    const myLat = car.lateral;
    for (const o of others) {
      if (o.id === selfId) continue;
      const ds = track.delta(car.s, o.s);
      const dl = o.lateral - myLat;
      // alongside: keep a car's width between us
      if (Math.abs(ds) < 6) {
        if (dl > 0 && dl < 2.6) blockR = true;
        if (dl < 0 && dl > -2.6) blockL = true;
      }
      if (ds > 0 && ds < 45 && Math.abs(dl) < 2.1) {
        const closing = v - o.speed;
        if (ds < 28 && closing > -1) {
          // decide a side once and commit for a while
          if (this.passTimer <= 0) {
            const roomL = o.lateral + hw;
            const roomR = hw - o.lateral;
            this.passSide = roomR > roomL ? 1 : -1;
            this.passTimer = 2.5 + Math.random();
          }
          const desired = o.lateral + this.passSide * 2.9 - track.racingLineAt(car.s + 10);
          this.targetOffset = desired;
        }
        // don't run into the back of it
        const tGap = ds / Math.max(1, v);
        if (tGap < 0.45 || ds < 9) followSpeed = Math.min(followSpeed, o.speed - (9 - ds) * 0.4);
      }
    }
    this.passTimer -= dt;
    if (this.passTimer <= 0) this.targetOffset *= Math.max(0, 1 - dt * 0.6);
    if (blockL) this.targetOffset = Math.max(this.targetOffset, myLat - track.racingLineAt(car.s) + 0.6);
    if (blockR) this.targetOffset = Math.min(this.targetOffset, myLat - track.racingLineAt(car.s) - 0.6);

    // lateral offset eases toward its target
    const maxRate = 2.2;
    this.offset += Math.max(-maxRate * dt, Math.min(maxRate * dt, this.targetOffset - this.offset));

    // ---- steering: curvature feedforward + Stanley feedback at the front axle
    const a = car.spec.a;
    const syaw = Math.sin(car.yaw);
    const cyaw = Math.cos(car.yaw);
    const fx = car.x + syaw * a;
    const fz = car.z + cyaw * a;
    const pf = track.project(fx, fz, car.hint);
    const sF = pf.s;
    // AI keeps ~0.6 m of margin off the extreme racing line (kerb to kerb)
    const pathLat = (ss: number) => {
      const hwS = track.halfWidthAt(ss);
      return Math.max(-hwS + 1.1, Math.min(hwS - 1.1, track.racingLineAt(ss) * 0.9 + this.offset));
    };
    const latP = pathLat(sF);
    const dlat = (pathLat(sF + 2) - pathLat(sF - 2)) / 4;
    // heading error relative to the path (path heading rel. track = −atan(dlat/ds))
    let rel = car.yaw - track.frame(sF).heading;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const headErr = -Math.atan(dlat) - rel;
    const crossErr = pf.lateral - latP; // + = car right of path → steer left
    const kPath = profile.lineK[Math.floor(track.wrap(sF + v * 0.08))] ?? 0;
    const ff = Math.atan(L * kPath) * (1 + 0.0002 * v * v);
    const fb = headErr + Math.atan2(2.2 * crossErr, v + 3);
    // yaw-rate damping against the path's expected yaw rate
    const damp = -0.035 * (car.r - v * kPath);
    let steer = ff + fb + damp;
    // countersteer toward the direction of travel when the car slides
    steer += 0.25 * Math.atan2(car.vy, Math.max(5, v));
    // small human wobble
    this.wobblePhase += dt;
    steer += Math.sin(this.wobblePhase * 1.7) * 0.002;
    // never steer past the front tyres' peak — more lock only plows the car wide —
    // except to countersteer a slide
    const lim = car.gripSteerLimit(v) * 1.04;
    // a sliding rear (rear slip angle past its peak) is what calls for countersteer
    const aR = Math.atan2(car.vy - car.spec.b * car.r, Math.max(3, v));
    const room = Math.min(0.3, Math.max(0, Math.abs(aR) - 0.09) * 1.4);
    const hiLim = lim + (aR > 0 ? room : 0);
    const loLim = lim + (aR < 0 ? room : 0);
    inp.steer = Math.max(-loLim, Math.min(hiLim, steer));

    // ---- speed
    const offLine = Math.abs(this.offset);
    const corner = Math.abs(track.kappaAt(car.s + v * 0.5)) > 1 / 300 ? 1 : 0;
    // dirty air costs downforce: carry less speed through corners when close behind someone
    const dirtyLoss = corner * car.dirty * 0.085;
    let vt = profile.at(car.s + v * 0.12) * this.pace * (1 - corner * Math.min(0.06, offLine * 0.012)) * (1 - dirtyLoss);
    vt = Math.min(vt, followSpeed);
    const err = vt - v;
    if (err > 0) {
      inp.throttle = Math.min(1, 0.35 + err * 0.3);
      inp.brake = 0;
      // running wide on the exit: ease off like a driver would to hold the line
      if (Math.abs(kPath) > 1 / 400) {
        const wide = crossErr * Math.sign(kPath);
        if (wide > 0.35) inp.throttle *= Math.max(0.15, 1 - (wide - 0.35) * 0.7);
      }
    } else {
      inp.throttle = err > -0.6 ? 0.25 : 0;
      inp.brake = err < -0.8 ? Math.min(1, -err * 0.22) : 0;
    }
    // ERS in the second half of straights when behind someone
    inp.ers = followSpeed < Infinity && corner === 0 && car.ers > 0.3;

    // ---- stuck / wrong way detection
    if (v < 2 || Math.abs(car.relYaw) > 1.8) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 2.5) {
      this.stuckTimer = 0;
      return true;
    }
    return false;
  }
}
