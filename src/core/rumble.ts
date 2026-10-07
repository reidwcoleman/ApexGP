import { SURF } from '../world/Track.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';

/**
 * Force-feedback-like vibration for gamepads (GamepadHapticActuator). A browser can't drive a
 * steering wheel's motor, but a pad's rumble can carry what ACC's FFB tells a wheel user: the
 * kerbs, the surface going off, the tyres letting go. Mapped the way console racers split them:
 *
 *  - the big, low-frequency motor (strong) — the heavy things: impacts, grass and gravel, the hit
 *    of a kerb's leading edge;
 *  - the small, high-frequency motor (weak) — texture: kerb chatter, lock-up judder, wheelspin
 *    buzz, and a faint scrub when the front tyres run past their peak slip (understeer — what a
 *    wheel conveys by going light);
 *  - impulse triggers (Xbox pads on Chrome / Edge, 'trigger-rumble'): the brake trigger pulses
 *    with a lock-up or the ABS working, the throttle trigger buzzes with wheelspin or TC cutting in.
 *
 * Effects are re-issued every ~50 ms with a 100 ms duration so they overlap (no gaps, no queue) and
 * stop by themselves if the game stops feeding them (a pause, a menu, a lost frame).
 */

export interface RumbleOut {
  strong: number;
  weak: number;
  left: number;
  right: number;
}

/** what the car is doing → motor levels (0 … 1, before the player's strength) */
export class RumbleMix {
  /** the last impact's level, decaying */
  private hit = 0;
  /** the leading-edge thump when a wheel climbs a kerb or leaves the road */
  private edge = 0;
  private prevKerb = false;
  private prevOff = false;
  /** ABS / TC pulse phase */
  private t = 0;
  readonly out: RumbleOut = { strong: 0, weak: 0, left: 0, right: 0 };

  reset() {
    this.hit = this.edge = this.t = 0;
    this.prevKerb = this.prevOff = false;
  }

  update(dt: number, car: CarPhysics): RumbleOut {
    this.t += dt;
    const v = Math.max(0, car.vx);
    const fast = Math.min(1, v / 40);
    // impacts since last frame (read before CarEffects clears them): ~11 m/s into a wall is a full jolt
    this.hit *= Math.exp(-dt / 0.12);
    for (const imp of car.impacts) this.hit = Math.max(this.hit, Math.min(1, 0.25 + imp.speed / 15));
    if (car.contact.wallHit > 0) this.hit = Math.max(this.hit, Math.min(1, 0.25 + car.contact.wallHit / 15));

    let gravel = 0;
    let grass = 0;
    for (let i = 0; i < 4; i++) {
      const s = car.surface[i];
      if (s === SURF.GRAVEL) gravel += 0.25;
      else if (s === SURF.GRASS) grass += 0.25;
    }
    const kerb = car.onKerb && v > 5;
    const off = gravel + grass > 0 && v > 3;
    if ((kerb && !this.prevKerb) || (off && !this.prevOff)) this.edge = Math.max(this.edge, 0.35 + 0.45 * fast);
    this.prevKerb = kerb;
    this.prevOff = off;
    this.edge *= Math.exp(-dt / 0.06);

    // kerb chatter follows the road input the chassis feels (CarPhysics.roadVel, m/s RMS)
    const chatter = kerb ? Math.min(0.75, 0.3 + car.roadVel * 1.2) * (0.4 + 0.6 * fast) : 0;
    const rough = (gravel * 0.75 + grass * 0.4) * Math.min(1, v / 25);
    // understeer: front tyres past their peak (slipFront 1 = peak) at speed
    const scrub = v > 12 ? Math.min(0.22, Math.max(0, car.slipFront - 1.08) * 0.6) : 0;
    const lock = v > 3 ? car.lockup : 0;
    const spin = v > 1 ? car.wheelspin : 0;
    // ABS / TC: a ~14 Hz pulse, the way the pedal or the cut feels
    const pulse = Math.sin(this.t * 2 * Math.PI * 14) > 0 ? 1 : 0.2;

    const o = this.out;
    o.strong = Math.min(1, Math.max(this.hit, this.edge, rough, kerb ? chatter * 0.45 : 0));
    o.weak = Math.min(1, Math.max(this.hit * 0.7, chatter, rough * 0.6, lock * 0.7, spin * 0.45, scrub));
    o.left = Math.min(1, Math.max(lock * 0.9, car.absActive && v > 3 ? 0.35 * pulse : 0));
    o.right = Math.min(1, Math.max(spin * 0.8, car.tcActive ? 0.3 * pulse : 0));
    return o;
  }
}

interface Haptics {
  effects?: readonly string[];
  type?: string;
  playEffect(type: string, params: Record<string, number>): Promise<unknown>;
  reset?(): Promise<unknown>;
}

/** sends RumbleOut to a pad's actuator at a steady ~20 Hz */
export class RumbleOutput {
  private since = 1;
  private live = false;
  private lastKey = '';

  /** the actuator of a pad, if the browser exposes one */
  static actuator(pad: Gamepad | null): Haptics | null {
    const a = pad ? (pad as unknown as { vibrationActuator?: Haptics | null }).vibrationActuator : null;
    return a && typeof a.playEffect === 'function' ? a : null;
  }

  send(dt: number, act: Haptics | null, o: RumbleOut | null, strength: number) {
    this.since += dt;
    if (!act) return;
    const k = Math.min(1, strength);
    const strong = o ? Math.min(1, o.strong * strength) : 0;
    const weak = o ? Math.min(1, o.weak * strength) : 0;
    const left = o ? o.left * k : 0;
    const right = o ? o.right * k : 0;
    const quiet = strong < 0.02 && weak < 0.02 && left < 0.02 && right < 0.02;
    if (quiet) {
      if (this.live) this.stop(act);
      return;
    }
    // a new impact goes out straight away; otherwise refresh at 20 Hz
    const key = `${(strong * 8) | 0}`;
    if (this.since < 0.05 && !(key !== this.lastKey && strong > 0.5)) return;
    this.since = 0;
    this.lastKey = key;
    this.live = true;
    const trig = (act.effects?.includes('trigger-rumble') ?? false) && (left > 0.02 || right > 0.02);
    const p = trig
      ? act.playEffect('trigger-rumble', { duration: 100, strongMagnitude: strong, weakMagnitude: weak, leftTrigger: left, rightTrigger: right })
      : act.playEffect('dual-rumble', { duration: 100, strongMagnitude: strong, weakMagnitude: Math.max(weak, left * 0.6, right * 0.5) });
    // ('preempted' when the next one replaces it — expected)
    p?.catch?.(() => {});
  }

  stop(act: Haptics | null) {
    this.live = false;
    this.lastKey = '';
    if (!act) return;
    const p = act.reset ? act.reset() : act.playEffect('dual-rumble', { duration: 0, strongMagnitude: 0, weakMagnitude: 0 });
    p?.catch?.(() => {});
  }

  get active() {
    return this.live;
  }
}
