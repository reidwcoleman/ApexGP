import type { CarPhysics } from '../sim/CarPhysics.ts';
import { controlPrefs, findDev, isWheelId, padSteer, pedal, wheelSteer, type ControlPrefs, type Device, type SteerCal } from './controllers.ts';
import { RumbleMix, RumbleOutput } from './rumble.ts';

/**
 * Keyboard + gamepad + steering wheel, merged into one analog control state.
 *
 * Keyboard steering is the raw key direction (PlayerControl ramps it); gamepads pass the stick
 * through a deadzone and a linearity curve (Settings → Controls); a steering wheel is bound and
 * calibrated in the same screen (see controllers.ts) and maps 1:1 onto the car's own steering lock.
 * Triggers on a standard-mapping pad are buttons 6 (brake) and 7 (throttle).
 *
 * The device that drives is the one last used: steering never mixes between two of them (a pad's
 * resting stick must not fight a wheel), while the pedals take the most pressed of all of them, so a
 * wheel with no pedals bound still drives on the keyboard's or the pad's.
 */

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) .. 1 (left)
  shiftUp: boolean; // edge
  shiftDown: boolean; // edge
  drs: boolean; // edge
  ers: boolean; // held: overtake mode
  camera: boolean; // edge
  lookBack: boolean; // held
  pause: boolean; // edge
  reset: boolean; // edge (flashback)
  pit: boolean; // edge (box request)
  /** an analog device (pad or wheel) is driving */
  usingPad: boolean;
  device: Device;
}

type Bind = 'up' | 'down' | 'left' | 'right' | 'shiftUp' | 'shiftDown' | 'drs' | 'ers' | 'camera' | 'lookBack' | 'pause' | 'reset' | 'pit' | 'accept' | 'back';

const KEYMAP: Record<string, Bind> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyE: 'shiftUp',
  ShiftRight: 'shiftUp',
  KeyQ: 'shiftDown',
  ControlRight: 'shiftDown',
  Space: 'drs',
  KeyF: 'ers',
  ShiftLeft: 'ers',
  KeyC: 'camera',
  KeyB: 'lookBack',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'reset',
  KeyI: 'pit',
  Enter: 'accept',
  Backspace: 'back',
};

/** a pad takes over from the keyboard only on a deliberate input (a worn stick's drift must not steal the car) */
const PAD_TAKEOVER = 0.25;

export class Input {
  readonly state: Controls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    shiftUp: false,
    shiftDown: false,
    drs: false,
    ers: false,
    camera: false,
    lookBack: false,
    pause: false,
    reset: false,
    pit: false,
    usingPad: false,
    device: 'keyboard',
  };

  /** Settings → Controls (Game applies them with the other settings) */
  prefs: ControlPrefs = controlPrefs();
  /** the pad / wheel in use (for the settings screen) */
  padName = '';
  wheelName = '';

  private held = new Set<Bind>();
  /** queued key presses; each frame consumes at most one per binding */
  private pressed = new Map<Bind, number>();
  private kbSteer = 0;
  private kbThrottle = 0;
  private kbBrake = 0;
  private padPrev: boolean[] = [];
  private centred = new Set<string>();
  private wheelPrevSteer = 0;
  private wheelBtnPrev = { up: false, down: false };
  /** menu navigation edges, consumed by UI */
  readonly nav = { up: false, down: false, left: false, right: false, accept: false, back: false };
  private padNavCooldown = 0;
  /** gamepad vibration */
  private pad: Gamepad | null = null;
  private rumbleMix = new RumbleMix();
  private rumbleOut = new RumbleOutput();
  private fed = false;

  constructor() {
    addEventListener('keydown', (e) => {
      const b = KEYMAP[e.code];
      if (!b) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      const navRepeat = e.repeat && (b === 'up' || b === 'down' || b === 'left' || b === 'right');
      if (!this.held.has(b) || navRepeat) this.pressed.set(b, Math.min(4, (this.pressed.get(b) ?? 0) + 1));
      this.held.add(b);
    });
    addEventListener('keyup', (e) => {
      const b = KEYMAP[e.code];
      if (b) this.held.delete(b);
    });
    addEventListener('blur', () => this.held.clear());
  }

  setPrefs(p?: Partial<ControlPrefs> | null) {
    this.prefs = controlPrefs(p);
  }

  update(dt: number) {
    const s = this.state;
    const P = this.prefs;
    const edge = (b: Bind) => (this.pressed.get(b) ?? 0) > 0;

    // the rumble runs only while the game feeds it (a race frame): stop it in menus, pauses, replays
    if (!this.fed && this.rumbleOut.active) this.rumbleOut.stop(RumbleOutput.actuator(this.pad));
    this.fed = false;

    // keyboard: steering is the raw key direction (PlayerControl ramps it with
    // speed); pedals get a short ramp so a tap isn't a full stamp
    const left = this.held.has('left') ? 1 : 0;
    const right = this.held.has('right') ? 1 : 0;
    this.kbSteer = left - right;
    this.kbThrottle = approach(this.kbThrottle, this.held.has('up') ? 1 : 0, (this.held.has('up') ? 6 : 10) * dt);
    this.kbBrake = approach(this.kbBrake, this.held.has('down') ? 1 : 0, (this.held.has('down') ? 8 : 12) * dt);
    // (only the driving keys take the car back: pressing C for a camera mid-corner must not drop the wheel)
    const kbActive = left + right > 0 || this.held.has('up') || this.held.has('down');

    let throttle = this.kbThrottle;
    let brake = this.kbBrake;
    let shiftUp = edge('shiftUp');
    let shiftDown = edge('shiftDown');
    let drs = edge('drs');
    let ers = this.held.has('ers');
    let camera = edge('camera');
    let lookBack = this.held.has('lookBack');
    let pause = edge('pause');
    let reset = edge('reset');
    let pit = edge('pit');

    this.nav.up = edge('up');
    this.nav.down = edge('down');
    this.nav.left = edge('left');
    this.nav.right = edge('right');
    this.nav.accept = edge('accept') || edge('drs');
    this.nav.back = edge('back') || edge('pause');

    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];

    // ---- steering wheel: the bound one, else a recognised wheel base steering on axis 0
    const wb = P.wheel;
    let wheel: Gamepad | null = wb ? findDev(pads, wb.steer.dev) : null;
    let steerCal: SteerCal | undefined = wb?.steer;
    if (!wheel) {
      wheel = pads.find((p) => p && p.connected && p.mapping !== 'standard' && isWheelId(p.id)) ?? null;
      // (wheel axes: + is to the right, like a stick)
      if (wheel) steerCal = { dev: wheel.id, axis: 0, center: 0, sign: -1 };
    }
    // every device the wheel set-up owns (base, pedals, shifter): never read as a pad
    const owned = new Set<string>();
    if (wheel) owned.add(wheel.id);
    if (wb) for (const b of [wb.throttle, wb.brake, wb.shiftUp, wb.shiftDown]) if (b) owned.add(b.dev);
    let wheelSteerIn = 0;
    let wheelActive = false;
    if (wheel && steerCal) {
      wheelSteerIn = wheelSteer(wheel.axes[steerCal.axis] ?? steerCal.center, steerCal, P);
      const thrDev = wb?.throttle ? findDev(pads, wb.throttle.dev) : null;
      const brkDev = wb?.brake ? findDev(pads, wb.brake.dev) : null;
      const wThr = thrDev && wb?.throttle ? pedal(thrDev.axes[wb.throttle.axis] ?? wb.throttle.rest, wb.throttle, P.pedalDeadzone) : 0;
      const wBrk = brkDev && wb?.brake ? pedal(brkDev.axes[wb.brake.axis] ?? wb.brake.rest, wb.brake, P.pedalDeadzone, P.brakeLinearity) : 0;
      throttle = Math.max(throttle, wThr);
      brake = Math.max(brake, wBrk);
      const btn = (b?: { dev: string; button: number }) => (b ? findDev(pads, b.dev)?.buttons[b.button]?.pressed ?? false : false);
      const up = btn(wb?.shiftUp);
      const down = btn(wb?.shiftDown);
      shiftUp ||= up && !this.wheelBtnPrev.up;
      shiftDown ||= down && !this.wheelBtnPrev.down;
      this.wheelBtnPrev.up = up;
      this.wheelBtnPrev.down = down;
      // a wheel at rest sits centred: turned, turning, or a pedal down means someone is driving it
      wheelActive = Math.abs(wheelSteerIn) > 0.03 || Math.abs(wheelSteerIn - this.wheelPrevSteer) > 0.004 || wThr > 0.05 || wBrk > 0.05 || up || down;
      this.wheelPrevSteer = wheelSteerIn;
    }
    this.wheelName = wheel ? wheel.id : '';

    // ---- gamepad: a standard-mapping pad first, else any other device that isn't part of the wheel set
    const pad =
      pads.find((p) => p && p.connected && p.mapping === 'standard' && !owned.has(p.id)) ??
      pads.find((p) => p && p.connected && !owned.has(p.id) && !isWheelId(p.id)) ??
      null;
    this.pad = pad;
    this.padName = pad ? pad.id : '';
    let padSteerIn = 0;
    let padActive = false;
    if (pad) {
      const btn = (i: number) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const pressedNow = (i: number) => (pad.buttons[i] ? pad.buttons[i].pressed : false);
      const pEdge = (i: number) => pressedNow(i) && !this.padPrev[i];
      // an unknown (non-standard) device steers only once its axis 0 has been seen centred: an
      // unbound pedal set resting at ±1 must not read as a stick held at full lock
      if (pad.mapping === 'standard' || Math.abs(pad.axes[0] ?? 1) < 0.1) this.centred.add(pad.id);
      const ax = this.centred.has(pad.id) ? pad.axes[0] ?? 0 : 0;
      padSteerIn = padSteer(ax, P);
      const padThrottle = btn(7);
      const padBrake = btn(6);
      padActive = Math.abs(ax) > Math.max(PAD_TAKEOVER, P.padDeadzone) || padThrottle > 0.1 || padBrake > 0.1 || pad.buttons.some((b) => b.pressed);
      // (once the pad is driving, any stick movement keeps it)
      if (s.device === 'pad' && padSteerIn !== 0) padActive = true;
      throttle = Math.max(throttle, padThrottle);
      brake = Math.max(brake, P.brakeLinearity === 1 ? padBrake : Math.pow(padBrake, P.brakeLinearity));
      shiftUp ||= pEdge(5) || pEdge(1);
      shiftDown ||= pEdge(4) || pEdge(2);
      drs ||= pEdge(3);
      ers ||= pressedNow(0);
      camera ||= pEdge(12);
      lookBack ||= pressedNow(10) || pressedNow(11);
      pause ||= pEdge(9);
      reset ||= pEdge(8);
      pit ||= pEdge(13);

      // menu navigation from the pad (the stick only on a standard layout: a pedal set or a
      // flight stick reporting as an unknown device may rest at ±1 on any axis)
      const stickNav = pad.mapping === 'standard';
      this.padNavCooldown -= dt;
      const ay = stickNav ? pad.axes[1] ?? 0 : 0;
      const axn = stickNav ? ax : 0;
      const navUp = pEdge(12) || (ay < -0.6 && this.padNavCooldown <= 0);
      const navDown = pEdge(13) || (ay > 0.6 && this.padNavCooldown <= 0);
      const navLeft = pEdge(14) || (axn < -0.6 && this.padNavCooldown <= 0);
      const navRight = pEdge(15) || (axn > 0.6 && this.padNavCooldown <= 0);
      if (navUp || navDown || navLeft || navRight) this.padNavCooldown = 0.22;
      if (Math.abs(ay) < 0.3 && Math.abs(axn) < 0.3) this.padNavCooldown = 0;
      this.nav.up ||= navUp;
      this.nav.down ||= navDown;
      this.nav.left ||= navLeft;
      this.nav.right ||= navRight;
      this.nav.accept ||= pEdge(0);
      this.nav.back ||= pEdge(1) || pEdge(9);

      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

    // ---- which device steers: the current one while it's in use, else whichever was just used
    const busy = (d: Device) => (d === 'wheel' ? wheelActive : d === 'pad' ? padActive : kbActive);
    if (!busy(s.device) || (s.device === 'wheel' && !wheel) || (s.device === 'pad' && !pad)) {
      const next: Device | null = wheelActive ? 'wheel' : padActive ? 'pad' : kbActive ? 'keyboard' : null;
      if (next) s.device = next;
      else if ((s.device === 'wheel' && !wheel) || (s.device === 'pad' && !pad)) s.device = 'keyboard';
    }
    if (s.device !== 'pad' && this.rumbleOut.active) this.rumbleOut.stop(RumbleOutput.actuator(pad));
    const steer = s.device === 'wheel' ? wheelSteerIn : s.device === 'pad' ? padSteerIn : this.kbSteer;

    s.usingPad = s.device !== 'keyboard';
    s.steer = clamp(steer, -1, 1);
    s.throttle = clamp(throttle, 0, 1);
    s.brake = clamp(brake, 0, 1);
    s.shiftUp = shiftUp;
    s.shiftDown = shiftDown;
    s.drs = drs;
    s.ers = ers;
    s.camera = camera;
    s.lookBack = lookBack;
    s.pause = pause;
    s.reset = reset;
    s.pit = pit;

    for (const [b, n] of this.pressed) {
      if (n <= 1) this.pressed.delete(b);
      else this.pressed.set(b, n - 1);
    }
  }

  /**
   * Force-feedback-like rumble from the player's car (call after the physics stepped, before the
   * effects consume car.impacts). Only for a pad that is driving and has an actuator.
   */
  feedback(dt: number, car: CarPhysics) {
    if (this.state.device !== 'pad' || this.prefs.vibration <= 0) return;
    const act = RumbleOutput.actuator(this.pad);
    if (!act) return;
    this.fed = true;
    this.rumbleOut.send(dt, act, this.rumbleMix.update(dt, car), this.prefs.vibration);
  }

  /** Drop any held keys (e.g. when a menu opens). */
  releaseAll() {
    this.held.clear();
    this.pressed.clear();
    this.kbSteer = 0;
    this.kbThrottle = 0;
    this.kbBrake = 0;
    this.rumbleMix.reset();
  }
}

function approach(v: number, t: number, d: number) {
  return v < t ? Math.min(t, v + d) : Math.max(t, v - d);
}
function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
