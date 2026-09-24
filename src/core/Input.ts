/**
 * Keyboard + gamepad, merged into one analog control state.
 *
 * Keyboard steering is rate-limited toward ±1 so a tap is a small correction
 * and a hold is full lock; gamepads pass analog values through a light curve.
 * Triggers on a standard-mapping pad are buttons 6 (brake) and 7 (throttle).
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
  usingPad: boolean;
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
  };

  private held = new Set<Bind>();
  /** queued key presses; each frame consumes at most one per binding */
  private pressed = new Map<Bind, number>();
  private kbSteer = 0;
  private kbThrottle = 0;
  private kbBrake = 0;
  private padPrev: boolean[] = [];
  /** menu navigation edges, consumed by UI */
  readonly nav = { up: false, down: false, left: false, right: false, accept: false, back: false };
  private padNavCooldown = 0;

  constructor() {
    addEventListener('keydown', (e) => {
      const b = KEYMAP[e.code];
      if (!b) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      const navRepeat = e.repeat && (b === 'up' || b === 'down' || b === 'left' || b === 'right');
      if (!this.held.has(b) || navRepeat) this.pressed.set(b, Math.min(4, (this.pressed.get(b) ?? 0) + 1));
      this.held.add(b);
      this.state.usingPad = false;
    });
    addEventListener('keyup', (e) => {
      const b = KEYMAP[e.code];
      if (b) this.held.delete(b);
    });
    addEventListener('blur', () => this.held.clear());
  }

  update(dt: number) {
    const s = this.state;
    const edge = (b: Bind) => (this.pressed.get(b) ?? 0) > 0;

    // keyboard: steering is the raw key direction (PlayerControl ramps it with
    // speed); pedals get a short ramp so a tap isn't a full stamp
    const left = this.held.has('left') ? 1 : 0;
    const right = this.held.has('right') ? 1 : 0;
    const target = left - right;
    this.kbSteer = target;
    this.kbThrottle = approach(this.kbThrottle, this.held.has('up') ? 1 : 0, (this.held.has('up') ? 6 : 10) * dt);
    this.kbBrake = approach(this.kbBrake, this.held.has('down') ? 1 : 0, (this.held.has('down') ? 8 : 12) * dt);

    let steer = this.kbSteer;
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

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected && p.mapping === 'standard') ?? Array.from(pads).find((p) => p && p.connected);
    if (pad) {
      const btn = (i: number) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const pressedNow = (i: number) => (pad.buttons[i] ? pad.buttons[i].pressed : false);
      const pEdge = (i: number) => pressedNow(i) && !this.padPrev[i];
      const ax = pad.axes[0] ?? 0;
      const dz = 0.15;
      const axd = Math.abs(ax) < dz ? 0 : (Math.sign(ax) * (Math.abs(ax) - dz)) / (1 - dz);
      const padSteer = -Math.sign(axd) * Math.pow(Math.abs(axd), 1.15);
      const padThrottle = btn(7);
      const padBrake = btn(6);
      const active = Math.abs(axd) > 0.02 || padThrottle > 0.02 || padBrake > 0.02 || pad.buttons.some((b) => b.pressed);
      if (active) s.usingPad = true;
      if (s.usingPad) {
        steer = padSteer || steer;
        throttle = Math.max(throttle, padThrottle);
        brake = Math.max(brake, padBrake);
      }
      shiftUp ||= pEdge(5) || pEdge(1);
      shiftDown ||= pEdge(4) || pEdge(2);
      drs ||= pEdge(3);
      ers ||= pressedNow(0);
      camera ||= pEdge(12);
      lookBack ||= pressedNow(10) || pressedNow(11);
      pause ||= pEdge(9);
      reset ||= pEdge(8);
      pit ||= pEdge(13);

      // menu navigation from the pad
      this.padNavCooldown -= dt;
      const ay = pad.axes[1] ?? 0;
      const navUp = pEdge(12) || (ay < -0.6 && this.padNavCooldown <= 0);
      const navDown = pEdge(13) || (ay > 0.6 && this.padNavCooldown <= 0);
      const navLeft = pEdge(14) || (ax < -0.6 && this.padNavCooldown <= 0);
      const navRight = pEdge(15) || (ax > 0.6 && this.padNavCooldown <= 0);
      if (navUp || navDown || navLeft || navRight) this.padNavCooldown = 0.22;
      if (Math.abs(ay) < 0.3 && Math.abs(ax) < 0.3) this.padNavCooldown = 0;
      this.nav.up ||= navUp;
      this.nav.down ||= navDown;
      this.nav.left ||= navLeft;
      this.nav.right ||= navRight;
      this.nav.accept ||= pEdge(0);
      this.nav.back ||= pEdge(1) || pEdge(9);

      this.padPrev = pad.buttons.map((b) => b.pressed);
    }

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

  /** Drop any held keys (e.g. when a menu opens). */
  releaseAll() {
    this.held.clear();
    this.pressed.clear();
    this.kbSteer = 0;
    this.kbThrottle = 0;
    this.kbBrake = 0;
  }
}

function approach(v: number, t: number, d: number) {
  return v < t ? Math.min(t, v + d) : Math.max(t, v - d);
}
function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
