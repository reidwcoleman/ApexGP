import type { Track } from '../world/Track.ts';
import type { CarPhysics, DriveInput } from './CarPhysics.ts';
import type { RacingProfile } from './RacingProfile.ts';
import { DEFAULT_CONTROLS, OneEuro, type ControlPrefs, type Device } from '../core/controllers.ts';

/**
 * Turns raw controller input into driver commands, the way the F1 games do:
 *
 *  - Full steering input maps to a little past the angle where the front
 *    tyres make peak grip at the current speed, never less than 0.3 rad.
 *  - Keyboard steering: a press kicks straight to a small input and then ramps
 *    like a thumb on a stick, progressive at speed — a quick tap is a crisp,
 *    proportional correction (never nothing), a hold builds smoothly to the
 *    full cornering rate, and letting go straightens the car.
 *  - Pad: an adaptive (1€) filter that smooths a thumb's tremor but lets a quick
 *    flick straight through, tighter at speed; the response curve is in Input.
 *  - Wheel: the player's wheel angle is the car's, 1:1 (Input maps the hardware
 *    rotation onto the car's lock): no speed limit, no filter, no assist — ACC's
 *    rule that a wheel is never second-guessed.
 *  - Braking assist (optional): brakes for corners from the racing profile.
 */

export type BrakingAssist = 'off' | 'low' | 'medium' | 'high';

export interface ControlAids {
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
  /** the device (missing: keyboard, or a pad when usingPad) */
  device?: Device;
  ers: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
}

const KB_MAX_LAT = 70;
/** keyboard steering feel: ramp rates (1/s) at parking and at racing speed, release rate */
const KB_ON_LO = 10;
const KB_ON_HI = 3.0;
const KB_OFF = 12;
/** the input a key press jumps to straight away, at low and at racing speed */
const KB_KICK_LO = 0.3;
const KB_KICK_HI = 0.25;
/** a tap shorter than this still steers for this long (s) */
const TAP_MIN = 0.07;
/** response curve exponent at racing speed (1 = linear): progressive, but not so much that taps vanish */
const KB_EXPO_HI = 1.45;
/** the pad's steering range at speed, as a multiple of the peak-grip angle: at 0 / 1 speed sensitivity */
const PAD_RANGE_LO = 2.25;
const PAD_RANGE_HI = 1.25;
/** the keyboard's (fixed) range in direct mode */
const KB_RANGE = 1.75;
/** steering rack speed at the road wheels (rad/s): pad and keyboard (≈ 85°/s), and a wheel (the player's hands are the limit) */
const RACK = 1.5;
const RACK_WHEEL = 8;
const BRAKE_MARGIN: Record<BrakingAssist, number> = { off: 0, low: 1.08, medium: 1.02, high: 0.96 };

export class PlayerControl {
  aids: ControlAids = { brakingAssist: 'off', steeringMode: 'rate' };
  private u = 0; // filtered steering −1..1
  private delta = 0; // road-wheel angle actually commanded
  private lastKey = 0;
  private tapTimer = 0;
  private tapDir = 0;
  private euro = new OneEuro();
  /** Settings → Controls: pad filter and speed sensitivity, keyboard steering speed */
  prefs: Pick<ControlPrefs, 'padFilter' | 'padSpeedSens' | 'kbSteerSpeed'> = { ...DEFAULT_CONTROLS };
  /** exposed for the HUD / steering-wheel visuals */
  steerInput = 0;
  brakeAssisting = false;
  readonly out: DriveInput = { throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false };

  reset() {
    this.u = 0;
    this.delta = 0;
    this.lastKey = 0;
    this.tapTimer = 0;
    this.euro.reset();
  }

  update(dt: number, raw: RawControls, car: CarPhysics, track: Track, profile: RacingProfile): DriveInput {
    const v = Math.max(0, car.vx);

    // ---- steering input shaping
    const device: Device = raw.device ?? (raw.usingPad ? 'pad' : 'keyboard');
    if (device === 'wheel') {
      this.u = raw.steer;
      this.euro.reset(raw.steer);
    } else if (device === 'pad') {
      // pad: 1€ filter. The resting cutoff falls with speed (≈4.8 Hz in a hairpin, ≈1.9 Hz at
      // 290 km/h at the default strength 0.7) — on a straight a thumb's tremor would weave the car —
      // while the speed term lets a deliberate move through: 90 % of a sudden half-stick input arrives
      // in ~33 ms (a small correction ~67 ms) against ~100 ms for the old fixed 3.5 Hz low-pass (the
      // "floaty" feel), with less tremor left at every speed and about the same lag on a slow, steady
      // turn-in (tools/controlstest.mjs). Note kbbot's PAD=1 bot, a delayed P-controller stepping its
      // stick at 20 Hz, laps the arcade presets ~1 % faster with heavier smoothing (filter 1.0 ≈ the
      // old figures); with no assists it is quicker and spins less at the default.
      const f = this.prefs.padFilter;
      if (f <= 0) this.u = raw.steer;
      else {
        const hi = Math.min(1, v / 80);
        const minCutoff = (1 - 0.75 * f) * (10 - 6 * hi);
        this.u = this.euro.filter(raw.steer, dt, minCutoff, 6 * (1.2 - f));
      }
    } else {
      // keyboard: a press kicks straight to a small input (so a tap is a crisp,
      // proportional correction), then ramps toward full lock — gentler at speed,
      // so a hold still builds smoothly. A very short tap is stretched to a
      // minimum pulse so it always does something.
      const key = Math.sign(raw.steer);
      if (key !== 0 && key !== this.lastKey) {
        this.tapTimer = TAP_MIN;
        this.tapDir = key;
      }
      this.lastKey = key;
      this.tapTimer = Math.max(0, this.tapTimer - dt);
      const target = key !== 0 ? key : this.tapTimer > 0 ? this.tapDir : 0;
      const hi = Math.min(1, v / 70);
      const k = this.prefs.kbSteerSpeed;
      const onRate = (KB_ON_LO - (KB_ON_LO - KB_ON_HI) * hi) * k;
      const offRate = KB_OFF * k;
      const reversing = target !== 0 && Math.sign(target) !== Math.sign(this.u) && this.u !== 0;
      const rate = target === 0 ? offRate : reversing ? offRate + onRate : onRate;
      const d = target - this.u;
      this.u += Math.max(-rate * dt, Math.min(rate * dt, d));
      // the kick: once the input is on the key's side, it starts at least here
      const kick = KB_KICK_LO - (KB_KICK_LO - KB_KICK_HI) * hi;
      if (target !== 0 && Math.sign(this.u) !== -target && Math.abs(this.u) < kick) this.u = target * kick;
    }
    this.steerInput = this.u;

    // ---- map to a road-wheel angle: full input = past the peak-grip angle at this speed
    // (the pad's range is its speed sensitivity: narrower at speed = finer, but must stay past the peak)
    const range = device === 'pad' ? PAD_RANGE_LO + (PAD_RANGE_HI - PAD_RANGE_LO) * this.prefs.padSpeedSens : KB_RANGE;
    // (above ~100 km/h the 0.3 rad floor is the range — 3× the peak-grip angle at 200 km/h — so speed
    // sensitivity scales it too: 0.3 at the default, 0.15 at full sensitivity)
    const floor = device === 'pad' ? 0.3 * (1.5 - this.prefs.padSpeedSens) : 0.3;
    const limit = Math.min(car.spec.maxSteer, Math.max(floor, car.gripSteerLimit(v) * range));
    // when the rear is sliding, countersteer may go as far as the slide needs
    // (the wheels have to point where the car is going). Rear slip angle > 0 →
    // the rear is stepping out to the left → countersteer left.
    const aR = Math.atan2(car.vy - car.spec.b * car.r, Math.max(3, car.vx));
    const counterRoom = Math.min(car.spec.maxSteer, Math.max(0, Math.abs(aR) - 0.09) * 1.4);
    const limitFor = (d: number) => limit + (Math.sign(d) === Math.sign(aR) ? counterRoom : 0);
    let delta = this.u * limitFor(this.u);
    if (device === 'wheel') {
      // a wheel is the car's wheel: full lock is full lock at any speed, countersteer included
      delta = this.u * car.spec.maxSteer;
    } else if (this.aids.steeringMode === 'rate' && v > 4) {
      // yaw-rate command: input → share of the maximum sustainable yaw rate
      const L = car.spec.a + car.spec.b;
      // capped at ~7 g: no corner needs more at speed, and it keeps small inputs calm on the straights
      const rMax = Math.min(car.lateralGrip(v) * 1.45 / v, (v * Math.tan(car.spec.maxSteer)) / L, KB_MAX_LAT / v);
      // progressive at speed: a tap is a small correction, a hold is still the full rate
      const expo = 1 + (KB_EXPO_HI - 1) * Math.min(1, Math.max(0, (v - 20) / 50));
      const rDes = Math.sign(this.u) * Math.pow(Math.abs(this.u), expo) * rMax;
      const load = Math.min(1, Math.abs(rDes) / rMax);
      const ff = Math.atan((L * rDes) / v) + Math.sign(rDes) * 0.05 * load * load;
      const fb = (2.2 / Math.max(v, 8)) * (rDes - car.r);
      const d = ff + fb;
      delta = Math.max(-limitFor(-1) * 1.1, Math.min(limitFor(1) * 1.1, d));
      // blend to direct steering at parking speeds so the car still turns from a standstill
      const w = Math.min(1, (v - 4) / 6);
      delta = delta * w + this.u * limit * (1 - w);
    }

    // ---- steering rack speed (at the road wheels, at any speed)
    const rack = device === 'wheel' ? RACK_WHEEL : RACK;
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
    o.ers = raw.ers;
    o.shiftUp = raw.shiftUp;
    o.shiftDown = raw.shiftDown;
    return o;
  }
}
