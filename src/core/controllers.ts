/**
 * Controller set-up, the way ACC's Controls screen does it: steering wheels and pedals are bound
 * by moving them (no vendor table to keep up to date — the browser's Gamepad API reports a wheel
 * base, a pedal set and a button box as separate devices with arbitrary axis numbers, and pedals
 * often rest at +1 and travel to −1), then mapped with a calibrated rest / full position, a
 * hardware steering rotation and linearity (gamma) curves. Pads get a deadzone, a linearity curve,
 * an adaptive filter and speed sensitivity — the four knobs ACC's gamepad page exposes.
 *
 * Everything here is plain data and pure functions (plus the Binder state machine), so
 * tools/controlstest.mjs can check it without a browser.
 */

/** the input device driving the car this frame */
export type Device = 'keyboard' | 'pad' | 'wheel';

/** an analog axis: which device, which axis, and the raw values at rest and at full travel */
export interface AxisCal {
  dev: string;
  axis: number;
  rest: number;
  full: number;
}

/** the steering axis: raw value with the wheel centred, and the sign that makes left positive */
export interface SteerCal {
  dev: string;
  axis: number;
  center: number;
  sign: 1 | -1;
}

export interface ButtonBind {
  dev: string;
  button: number;
}

export interface WheelBinding {
  steer: SteerCal;
  throttle?: AxisCal;
  brake?: AxisCal;
  shiftUp?: ButtonBind;
  shiftDown?: ButtonBind;
  /** the wheel base's name as the browser reports it (for the settings screen) */
  name: string;
}

export interface ControlPrefs {
  /** gamepad: stick deadzone (share of the stick's travel) */
  padDeadzone: number;
  /** gamepad: steering linearity (gamma; 1 = linear, higher = finer near centre) */
  padLinearity: number;
  /** gamepad: steering filter 0 … 1 (0 = raw stick) */
  padFilter: number;
  /** gamepad: speed sensitivity 0 … 1 — how much the steering range narrows toward the grip limit at speed */
  padSpeedSens: number;
  /** gamepad vibration strength 0 … 1.5 (0 = off) */
  vibration: number;
  /** steering wheel: the wheel base's rotation, lock to lock (degrees) */
  wheelRotation: number;
  /** steering wheel: steering linearity (1 = the car's wheel turns exactly as yours does) */
  wheelLinearity: number;
  /** pedals and triggers: brake linearity (gamma; >1 = finer at the top of the travel) */
  brakeLinearity: number;
  /** pedals: deadzone at each end of the travel (a worn pot still reaches 0 and 100 %) */
  pedalDeadzone: number;
  /** keyboard: steering speed multiplier */
  kbSteerSpeed: number;
  /** the bound wheel and pedals (none: a recognised wheel still steers on axis 0) */
  wheel?: WheelBinding;
}

export const DEFAULT_CONTROLS: ControlPrefs = {
  // modern Xbox / DualSense sticks rest within ~5 % of centre; 0.15 (the old fixed value) threw away
  // the first sixth of the stick, which is where every straight-line correction lives
  padDeadzone: 0.08,
  padLinearity: 1.2,
  padFilter: 0.7,
  padSpeedSens: 0.5,
  vibration: 1,
  // the common direct-drive / belt default; the game maps the car's own lock 1:1 inside it
  wheelRotation: 900,
  wheelLinearity: 1,
  brakeLinearity: 1,
  pedalDeadzone: 0.03,
  kbSteerSpeed: 1,
};

/**
 * Steering-wheel rotation of a 2026 F1 car, lock to lock (degrees). F1 racks are quick: onboards at
 * the tightest hairpins (Monaco's Loews, Montréal's T10) show the drivers at roughly half a turn
 * each way with their hands still on the grips. With CarPhysics' 0.42 rad of road-wheel lock that is
 * a ~7.5:1 ratio. As in ACC, a wheel base set to more rotation than this is mapped 1:1 — the game's
 * wheel turns exactly as the player's does and simply runs out of lock at ±180°.
 */
export const F1_WHEEL_LOCK = 360;

export function controlPrefs(p?: Partial<ControlPrefs> | null): ControlPrefs {
  return { ...DEFAULT_CONTROLS, ...(p ?? {}) };
}

/**
 * Steering wheels and pedals the browser exposes as generic HID devices. Wheels never get the
 * 'standard' (Xbox-layout) mapping — except Xbox-mode wheels through XInput, which then work as a pad
 * until the player binds them. Names as Chrome / Firefox report them: "Logitech G29 Driving Force
 * Racing Wheel (Vendor: 046d Product: c24f)", "FANATEC CSL Elite Wheel Base", "MOZA R5 Base" …
 */
const WHEEL_RE = /wheel|racing|driving force|\bg2[579]\b|\bg9[02]\d\b|\bg pro\b|thrustmaster|\bt(?:150|248|300|500|818|gt|mx|s-?pc|s-?xw)\b|fanatec|clubsport|\bcsl\b|podium|simucube|simagic|\bmoza\b|cammus|asetek|heusinkveld|pedals?\b|vendor: (?:0eb7|346e|16d0|2433|3670)/i;

export function isWheelId(id: string): boolean {
  return WHEEL_RE.test(id);
}

/** a gamepad as this module needs it (Gamepad, or a plain object in the tests) */
export interface PadLike {
  id: string;
  connected?: boolean;
  mapping?: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value?: number }[];
}

/** the first connected device with this id */
export function findDev<T extends PadLike>(pads: readonly (T | null)[], id: string): T | null {
  for (const p of pads) if (p && p.connected !== false && p.id === id) return p;
  return null;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** the shaped stick: deadzone (rescaled so the output starts from 0) then the linearity curve */
export function padSteer(axis: number, prefs: ControlPrefs): number {
  const dz = prefs.padDeadzone;
  const a = Math.abs(axis);
  if (a <= dz) return 0;
  const x = Math.min(1, (a - dz) / (1 - dz));
  // + = left: the stick's + is right
  return -Math.sign(axis) * Math.pow(x, prefs.padLinearity);
}

/**
 * A wheel's axis → the car's steering input (−1 … 1 of the car's full lock, + = left).
 * The hardware's rotation is mapped 1:1 onto the car's (F1_WHEEL_LOCK) — a 900° base reaches full
 * lock at ±180°; a base with less rotation than the car stretches over the whole car lock.
 */
export function wheelSteer(raw: number, cal: SteerCal, prefs: ControlPrefs): number {
  // (the centre may sit off 0 on an odd device: each side is scaled to the axis end it has left)
  const off = (raw - cal.center) * cal.sign;
  const room = off >= 0 ? 1 - cal.center * cal.sign : 1 + cal.center * cal.sign;
  const x = clamp(off / Math.max(0.5, room), -1, 1);
  const deg = (x * prefs.wheelRotation) / 2;
  const half = Math.min(F1_WHEEL_LOCK, prefs.wheelRotation) / 2;
  const u = clamp(deg / half, -1, 1);
  return Math.sign(u) * Math.pow(Math.abs(u), prefs.wheelLinearity);
}

/** a calibrated pedal axis → 0 … 1, with a deadzone at each end and a gamma */
export function pedal(raw: number, cal: AxisCal, deadzone: number, gamma = 1): number {
  const span = cal.full - cal.rest;
  if (Math.abs(span) < 0.1) return 0;
  const x = clamp(((raw - cal.rest) / span - deadzone) / (1 - 2 * deadzone), 0, 1);
  return gamma === 1 ? x : Math.pow(x, gamma);
}

/**
 * Adaptive low-pass for the stick: the "1€ filter" (Casiez, Roussel & Vogel, CHI 2012). Its
 * cutoff rises with how fast the input moves, so a thumb's tremor at the straight-ahead is smoothed
 * hard while a deliberate flick passes with almost no lag — precise without the floaty feel a fixed
 * low-pass gives. minCutoff is in Hz, beta in Hz per (unit/s).
 */
export class OneEuro {
  private x = 0;
  private dx = 0;
  private init = false;
  /** cutoff of the speed estimate (Hz): quick enough that a flick opens the filter within a frame or two */
  dCutoff = 4;
  reset(v = 0) {
    this.x = v;
    this.dx = 0;
    this.init = false;
  }
  filter(v: number, dt: number, minCutoff: number, beta: number): number {
    if (!this.init || dt <= 0) {
      this.init = true;
      this.x = v;
      this.dx = 0;
      return v;
    }
    const a = (fc: number) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    const d = (v - this.x) / dt;
    this.dx += (d - this.dx) * a(this.dCutoff);
    const fc = minCutoff + beta * Math.abs(this.dx);
    this.x += (v - this.x) * a(fc);
    return this.x;
  }
}

// ----------------------------------------------------------------- binding

export type BindStep = 'steer' | 'throttle' | 'brake' | 'shiftUp' | 'shiftDown' | 'done';
export const BIND_STEPS: BindStep[] = ['steer', 'throttle', 'brake', 'shiftUp', 'shiftDown', 'done'];
export const BIND_PROMPT: Record<BindStep, string> = {
  steer: 'Centre the wheel, then turn it a quarter turn to the <b>left</b> and back',
  throttle: 'Press the <b>throttle</b> all the way down, then release it',
  brake: 'Press the <b>brake</b> all the way down, then release it',
  shiftUp: 'Pull the <b>gear-up</b> paddle',
  shiftDown: 'Pull the <b>gear-down</b> paddle',
  done: 'All set',
};

/**
 * Binds a wheel and pedals by watching every connected device's axes move, ACC style. Each step
 * snapshots the axes when it starts (so the pedals' rest positions and the wheel's centre are what
 * the hardware reports at rest, whatever the sign or the range), then takes the axis that moves the
 * most. A pedal step finishes when the pedal comes back up, so its full travel is recorded too —
 * this is the calibration as well as the binding, and inverted or combined-axis pedals just work.
 */
export class Binder {
  step: BindStep = 'steer';
  readonly result: Partial<WheelBinding> = {};
  private base = new Map<string, number[]>();
  private baseBtn = new Map<string, boolean[]>();
  /** the axis being pressed in this step: its device, index, rest and furthest value */
  private cand: { dev: string; axis: number; rest: number; peak: number } | null = null;
  /** the live value of the step's axis (0 … 1, for the meter) */
  level = 0;

  /** call with the device list every frame; returns true when the step changed */
  update(pads: readonly (PadLike | null)[]): boolean {
    if (this.step === 'done') return false;
    const live = pads.filter((p): p is PadLike => !!p && p.connected !== false);
    // a device that appears mid-step gets its own snapshot
    for (const p of live) {
      if (!this.base.has(p.id)) {
        this.base.set(p.id, Array.from(p.axes));
        this.baseBtn.set(p.id, p.buttons.map((b) => b.pressed));
      }
    }
    if (this.step === 'shiftUp' || this.step === 'shiftDown') {
      for (const p of live) {
        const was = this.baseBtn.get(p.id)!;
        for (let i = 0; i < p.buttons.length; i++) {
          if (p.buttons[i].pressed && !was[i]) {
            // (the other paddle may not reuse this one)
            const other = this.step === 'shiftDown' ? this.result.shiftUp : undefined;
            if (other && other.dev === p.id && other.button === i) continue;
            this.result[this.step] = { dev: p.id, button: i };
            return this.next();
          }
        }
        this.baseBtn.set(p.id, p.buttons.map((b) => b.pressed));
      }
      return false;
    }
    // the axis that has moved furthest from its rest value
    let best: { dev: string; axis: number; rest: number; v: number; d: number } | null = null;
    for (const p of live) {
      const b = this.base.get(p.id)!;
      for (let i = 0; i < p.axes.length; i++) {
        if (this.step !== 'steer' && this.result.steer && this.result.steer.dev === p.id && this.result.steer.axis === i) continue;
        const d = Math.abs(p.axes[i] - (b[i] ?? 0));
        if (!best || d > best.d) best = { dev: p.id, axis: i, rest: b[i] ?? 0, v: p.axes[i], d };
      }
    }
    if (this.step === 'steer') {
      // a quarter turn on a 900° base is half the axis; ask for at least ~0.15 so 270° pads-on-a-stand still bind
      if (!this.cand && best && best.d > 0.15) this.cand = { dev: best.dev, axis: best.axis, rest: best.rest, peak: best.v };
      if (!this.cand) {
        this.level = 0;
        return false;
      }
      const v = findDev(live, this.cand.dev)?.axes[this.cand.axis] ?? this.cand.rest;
      if (Math.abs(v - this.cand.rest) > Math.abs(this.cand.peak - this.cand.rest)) this.cand.peak = v;
      this.level = Math.min(1, Math.abs(v - this.cand.rest) / 0.5);
      // back near the centre: bound (the player turned left, so that direction is +)
      if (Math.abs(v - this.cand.rest) < 0.04 && Math.abs(this.cand.peak - this.cand.rest) > 0.15) {
        // wheel bases report their own mechanical centre as 0: a few hundredths off is the player's
        // hands, not the hardware, so snap to it (an odd device that rests elsewhere keeps its value)
        const center = Math.abs(this.cand.rest) < 0.1 ? 0 : this.cand.rest;
        this.result.steer = { dev: this.cand.dev, axis: this.cand.axis, center, sign: this.cand.peak > this.cand.rest ? 1 : -1 };
        this.result.name = this.cand.dev;
        return this.next();
      }
      return false;
    }
    // pedals: lock onto the first axis to travel half its range, record its furthest point
    if (!this.cand && best && best.d > 0.5) this.cand = { dev: best.dev, axis: best.axis, rest: best.rest, peak: best.v };
    if (!this.cand) {
      this.level = 0;
      return false;
    }
    const v = findDev(live, this.cand.dev)?.axes[this.cand.axis] ?? this.cand.rest;
    if (Math.abs(v - this.cand.rest) > Math.abs(this.cand.peak - this.cand.rest)) this.cand.peak = v;
    const travel = Math.abs(this.cand.peak - this.cand.rest);
    this.level = travel > 0 ? Math.abs(v - this.cand.rest) / travel : 0;
    // released (back within 15 % of the travel): calibrated
    if (Math.abs(v - this.cand.rest) < travel * 0.15) {
      this.result[this.step as 'throttle' | 'brake'] = { dev: this.cand.dev, axis: this.cand.axis, rest: this.cand.rest, full: this.cand.peak };
      return this.next();
    }
    return false;
  }

  /** skip this step (a wheel with no paddles, a pad-mounted wheel with no pedals) */
  skip(): boolean {
    if (this.step === 'done') return false;
    // steering is the one step that can't be skipped: without it there is nothing to bind
    if (this.step === 'steer') return false;
    return this.next();
  }

  private next(): boolean {
    this.step = BIND_STEPS[BIND_STEPS.indexOf(this.step) + 1];
    this.cand = null;
    this.level = 0;
    // fresh rest snapshots for the next step
    this.base.clear();
    this.baseBtn.clear();
    return true;
  }

  /** the finished binding (null until the steering is bound) */
  binding(): WheelBinding | null {
    const r = this.result;
    if (!r.steer) return null;
    return { name: r.name ?? r.steer.dev, steer: r.steer, throttle: r.throttle, brake: r.brake, shiftUp: r.shiftUp, shiftDown: r.shiftDown };
  }
}

/** a short display name for a device id ("Logitech G29 Driving Force Racing Wheel (Vendor: …)" → "Logitech G29 Driving Force Racing Wheel") */
export function deviceName(id: string, max = 42): string {
  const n = id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*$/i, '').replace(/\s*\(.*?\)\s*$/, '').trim();
  const s = n || id;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
