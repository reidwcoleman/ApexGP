import type { Track } from '../world/Track.ts';
import type { CarPhysics, DriveInput } from './CarPhysics.ts';
import type { RacingProfile } from './RacingProfile.ts';

/**
 * Turns raw controller input into driver commands, the way the F1 games do:
 *
 *  - Full steering input maps to the angle where the front tyres make peak
 *    grip at the current speed (never beyond it), so a pad or keyboard can't
 *    ask for an angle that just scrubs or snaps the car.
 *  - Keyboard steering ramps like a thumb on a stick: fast at low speed,
 *    progressive at high speed, quick to centre.
 *  - Pad: small low-pass and a response curve for precision near centre.
 *  - Steering assist (optional): nudges toward the racing line and keeps the
 *    car from running off the road.
 *  - Braking assist (optional): brakes for corners from the racing profile.
 */

export type BrakingAssist = 'off' | 'low' | 'medium' | 'high';

export interface ControlAids {
  steeringAssist: boolean;
  brakingAssist: BrakingAssist;
  /**
   * 'rate': the input asks for a share of the car's maximum cornering rate and a
   * controller finds the wheel angle (keyboard default — releasing a key
   * straightens the car, slides get caught automatically).
   * 'direct': the input is the wheel angle (pad default, the "sim" feel).
   */
  steeringMode: 'rate' | 'direct';
}

export interface RawControls {
  /** −1..1, + = left. For the keyboard this is the key direction (−1/0/1). */
  steer: number;
  throttle: number;
  brake: number;
  usingPad: boolean;
  ers: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
}

const BRAKE_MARGIN: Record<BrakingAssist, number> = { off: 0, low: 1.08, medium: 1.02, high: 0.96 };

export class PlayerControl {
  aids: ControlAids = { steeringAssist: false, brakingAssist: 'off', steeringMode: 'rate' };
  private u = 0; // filtered steering −1..1
  private delta = 0; // road-wheel angle actually commanded
  private prevLat = 0;
  /** exposed for the HUD / steering-wheel visuals */
  steerInput = 0;
  brakeAssisting = false;
  readonly out: DriveInput = { throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false };

  reset() {
    this.u = 0;
    this.delta = 0;
    this.prevLat = 0;
  }

  update(dt: number, raw: RawControls, car: CarPhysics, track: Track, profile: RacingProfile): DriveInput {
    const v = Math.max(0, car.vx);
    const kmh = v * 3.6;

    // ---- steering input shaping
    if (raw.usingPad) {
      // pad: gentle low-pass (≈12 Hz) — the curve is applied in Input
      this.u += (raw.steer - this.u) * Math.min(1, dt * 22);
    } else {
      // keyboard: ramp toward the key direction; slower as speed rises
      const target = raw.steer;
      const t = Math.min(1, kmh / 260);
      const onRate = 9.5 - 4.3 * t; // 9.5/s at a standstill → 5.2/s at 260 km/h
      const offRate = 8.5;
      const reversing = target !== 0 && Math.sign(target) !== Math.sign(this.u) && this.u !== 0;
      const rate = target === 0 ? offRate : reversing ? offRate + onRate : onRate;
      const d = target - this.u;
      this.u += Math.max(-rate * dt, Math.min(rate * dt, d));
    }
    this.steerInput = this.u;

    // ---- map to a road-wheel angle: full input = peak-grip angle at this speed
    const limit = car.gripSteerLimit(v) * 1.45;
    // when the rear is sliding, countersteer may go as far as the slide needs
    // (the wheels have to point where the car is going). Rear slip angle > 0 →
    // the rear is stepping out to the left → countersteer left.
    const aR = Math.atan2(car.vy - car.spec.b * car.r, Math.max(3, car.vx));
    const counterRoom = Math.min(car.spec.maxSteer, Math.max(0, Math.abs(aR) - 0.09) * 1.4);
    const limitFor = (d: number) => limit + (Math.sign(d) === Math.sign(aR) ? counterRoom : 0);
    let delta = this.u * limitFor(this.u);
    if (this.aids.steeringMode === 'rate' && v > 4) {
      // yaw-rate command: input → share of the maximum sustainable yaw rate
      const L = car.spec.a + car.spec.b;
      const rMax = Math.min(car.lateralGrip(v) * 1.3 / v, (v * Math.tan(car.spec.maxSteer)) / L);
      const rDes = this.u * rMax;
      const load = Math.min(1, Math.abs(rDes) / rMax);
      const ff = Math.atan((L * rDes) / v) + Math.sign(rDes) * 0.05 * load * load;
      const fb = (2.2 / Math.max(v, 8)) * (rDes - car.r);
      const d = ff + fb;
      delta = Math.max(-limitFor(-1) * 1.1, Math.min(limitFor(1) * 1.1, d));
      // blend to direct steering at parking speeds so the car still turns from a standstill
      const w = Math.min(1, (v - 4) / 6);
      delta = delta * w + this.u * limit * (1 - w);
    }

    // ---- steering assist: only keeps the car on the road (no pull toward the racing line)
    if (this.aids.steeringAssist && v > 5) {
      // edge guard: heading off the road → steer back in
      const hw = track.halfWidthAt(car.s);
      const edge = Math.abs(car.lateral) - (hw - 1.4);
      if (edge > 0) {
        const outward = Math.sign(car.lateral) === Math.sign(-Math.sin(car.relYaw)) ? 1 : 0;
        // lateral + = right; steering + = left → push toward the centre
        delta += Math.sign(car.lateral) * Math.min(limit * 0.6, edge * 0.05 * (1 + outward));
      }
    }

    // ---- steering rack speed (≈ 60°/s at the wheels at low speed, less at high)
    const rack = 1.5 - 0.7 * Math.min(1, kmh / 250);
    this.delta += Math.max(-rack * dt, Math.min(rack * dt, delta - this.delta));
    const o = this.out;
    o.steer = Math.max(-car.spec.maxSteer, Math.min(car.spec.maxSteer, this.delta));

    // ---- pedals
    o.throttle = raw.throttle;
    o.brake = raw.brake;
    this.brakeAssisting = false;
    if (this.aids.brakingAssist !== 'off' && v > 12) {
      const m = BRAKE_MARGIN[this.aids.brakingAssist];
      // the profile already contains braking curves: compare slightly ahead
      const target = Math.min(profile.atGrip(car.s + v * 0.12, car.gripFactor), profile.atGrip(car.s + v * 0.3, car.gripFactor)) * m;
      if (v > target + 0.5) {
        const need = Math.min(1, (v - target) * 0.22);
        o.brake = Math.max(o.brake, need);
        o.throttle = Math.min(o.throttle, 0.1);
        this.brakeAssisting = need > 0.05;
      }
    }
    // run-off guard (part of the steering assist): drifting toward the edge faster
    // than the steering can pull it back → lift, then brush the brakes
    if (this.aids.steeringAssist && v > 20) {
      const side = car.lateral >= 0 ? 1 : -1;
      const outward = ((car.lateral - this.prevLat) / Math.max(dt, 1e-3)) * side;
      const room = track.halfWidthAt(car.s) + track.kerbAt(car.s, side) - Math.abs(car.lateral) - 0.6;
      if (outward > 0.8 && room < outward * 1.1) {
        const k = Math.min(1, (outward * 1.1 - room) / Math.max(1.5, outward));
        o.throttle = Math.min(o.throttle, 1 - k);
        if (k > 0.5 && car.slipFront > 0.95) o.brake = Math.max(o.brake, (k - 0.5) * 0.5);
      }
    }
    this.prevLat = car.lateral;
    o.ers = raw.ers;
    o.shiftUp = raw.shiftUp;
    o.shiftDown = raw.shiftDown;
    return o;
  }
}
