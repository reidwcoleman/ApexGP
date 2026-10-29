/**
 * The open world's controls: keyboard and a standard-mapping gamepad merged into one state.
 *
 * Driving: W/S or ↑/↓ throttle / brake-reverse, A/D or ←/→ steer, Space handbrake, H horn
 * (the siren in a cruiser).
 * Flying (helicopter): W/S pitch forward/back, A/D yaw, Space up, X down,
 * Q/E roll, Shift boost. Plane: W/S pitch, A/D roll, Q/E rudder, Shift/X throttle up/down.
 * On foot: WASD move, Shift run, Space jump.
 * Anywhere: F enter/exit a vehicle (or steal one), C camera,
 * R recover, M map, Esc menu. Mouse drag looks around.
 */
export interface Pad {
  throttle: number;
  brake: number;
  steer: number;
  /** -1 … 1 (forward/back on foot or pitch in the air) */
  moveX: number;
  moveY: number;
  handbrake: boolean;
  boost: boolean;
  up: boolean;
  down: boolean;
  rollL: boolean;
  rollR: boolean;
  horn: boolean;
  enter: boolean;
  flight: boolean;
  kick: boolean;
  camera: boolean;
  recover: boolean;
  map: boolean;
  pause: boolean;
  usingPad: boolean;
  /** mouse look deltas this frame (px) */
  lookX: number;
  lookY: number;
  dragging: boolean;
  /** combat: trigger and aim held (mouse, or the pad's triggers on foot) */
  fire: boolean;
  aim: boolean;
  padFire: boolean;
  padAim: boolean;
  /** a weapon slot pressed this frame (0 holster, 1-6), -1 none */
  slot: number;
  /** mouse wheel / pad bumper steps this frame */
  cycle: number;
  /** the mouse is captured */
  locked: boolean;
  /** the capture was lost this frame (Esc): the menu opens */
  lockLost: boolean;
}

const EDGES = ['enter', 'flight', 'kick', 'camera', 'recover', 'map', 'pause'] as const;
type Edge = (typeof EDGES)[number];

export class Input {
  readonly s: Pad = {
    throttle: 0, brake: 0, steer: 0, moveX: 0, moveY: 0, handbrake: false, boost: false, up: false, down: false, rollL: false, rollR: false, horn: false,
    enter: false, flight: false, kick: false, camera: false, recover: false, map: false, pause: false, usingPad: false, lookX: 0, lookY: 0, dragging: false,
    fire: false, aim: false, padFire: false, padAim: false, slot: -1, cycle: 0, locked: false, lockLost: false,
  };
  private fireHeld = false;
  private aimHeld = false;
  private slotPressed = -1;
  private wheel = 0;
  private lostFlag = false;
  private wantLock = false;
  private keys = new Set<string>();
  private pressed = new Set<Edge>();
  private kbSteer = 0;
  private kbThr = 0;
  private kbBrk = 0;
  private padPrev: boolean[] = [];
  private mx = 0;
  private my = 0;
  /** set by the UI while a menu is open: the game gets no input */
  blocked = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const map: Record<string, Edge> = { KeyF: 'enter', Enter: 'enter', KeyT: 'flight', KeyK: 'kick', KeyC: 'camera', KeyR: 'recover', KeyM: 'map', Escape: 'pause', KeyP: 'pause' };
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code) && /^Digit[0-6]$/.test(e.code)) this.slotPressed = Number(e.code.slice(5));
      if (!this.keys.has(e.code) && map[e.code]) this.pressed.add(map[e.code]);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // the mouse: a click captures it (pointer lock) for mouse-look; captured, left fires and right
    // aims. Uncaptured, dragging still looks around.
    canvas.addEventListener('mousedown', (e) => {
      if (this.blocked) return;
      if (!this.s.locked) {
        if (e.button === 0 || e.button === 2) this.s.dragging = true;
        this.lock();
        return;
      }
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.aimHeld = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mouseup', (e) => {
      this.s.dragging = false;
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.s.dragging && !this.s.locked) return;
      this.mx += e.movementX;
      this.my += e.movementY;
    });
    addEventListener(
      'wheel',
      (e) => {
        if (this.s.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.s.locked;
      this.s.locked = document.pointerLockElement === canvas;
      if (was && !this.s.locked) {
        this.fireHeld = this.aimHeld = false;
        if (!this.blocked) this.lostFlag = true;
      }
    });
  }

  /** capture the mouse (needs a user gesture: a click, a key) */
  lock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* not allowed now */
    }
    void this.wantLock;
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** a key held */
  has(code: string) {
    return this.keys.has(code);
  }

  update(dt: number) {
    const s = this.s;
    const k = this.keys;
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const fwd = k.has('KeyW') || k.has('ArrowUp');
    const back = k.has('KeyS') || k.has('ArrowDown');
    // keyboard ramps
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    const rate = target === 0 ? 5 : Math.sign(target) !== Math.sign(this.kbSteer) && this.kbSteer !== 0 ? 7 : 3.2;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    this.kbThr += Math.max(-6 * dt, Math.min(4 * dt, (fwd ? 1 : 0) - this.kbThr));
    this.kbBrk += Math.max(-8 * dt, Math.min(6 * dt, (back ? 1 : 0) - this.kbBrk));
    s.throttle = this.kbThr;
    s.brake = this.kbBrk;
    s.steer = this.kbSteer;
    s.moveX = target;
    s.moveY = (fwd ? 1 : 0) - (back ? 1 : 0);
    s.handbrake = k.has('Space');
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight');
    s.up = k.has('Space');
    s.down = k.has('KeyX') || k.has('ControlLeft');
    s.rollL = k.has('KeyQ');
    s.rollR = k.has('KeyE');
    s.horn = k.has('KeyH');
    for (const e of EDGES) s[e] = this.pressed.has(e);
    this.pressed.clear();
    s.fire = this.fireHeld;
    s.aim = this.aimHeld;
    s.padFire = s.padAim = false;
    s.slot = this.slotPressed;
    this.slotPressed = -1;
    s.cycle = this.wheel;
    this.wheel = 0;
    s.lockLost = this.lostFlag;
    this.lostFlag = false;
    s.lookX = this.mx;
    s.lookY = this.my;
    this.mx = this.my = 0;
    s.usingPad = false;

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = (i: number) => {
        const v = p.axes[i] ?? 0;
        return Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      };
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const val = (i: number) => p.buttons[i]?.value ?? 0;
      const rt = val(7), lt = val(6);
      const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
      const active = rt > 0.05 || lt > 0.05 || Math.abs(lx) > 0.1 || Math.abs(ly) > 0.1 || p.buttons.some((b) => b.pressed);
      if (active) s.usingPad = true;
      if (rt > s.throttle) s.throttle = rt;
      if (lt > s.brake) s.brake = lt;
      if (Math.abs(lx) > Math.abs(s.steer)) s.steer = -Math.sign(lx) * Math.pow(Math.abs(lx), 1.4);
      if (Math.abs(lx) > 0.1) s.moveX = -lx;
      if (Math.abs(ly) > 0.1) s.moveY = -ly;
      s.handbrake ||= btn(0);
      s.up ||= btn(0);
      s.down ||= btn(1);
      s.boost ||= btn(5);
      s.rollL ||= btn(4) && !btn(5);
      s.rollR ||= btn(14);
      s.horn ||= btn(10);
      const edge = (i: number) => btn(i) && !this.padPrev[i];
      s.enter ||= edge(3);
      s.flight ||= edge(2);
      s.camera ||= edge(8);
      s.pause ||= edge(9);
      s.recover ||= edge(12);
      s.map ||= edge(13);
      s.kick ||= edge(11);
      s.lookX += rx * 600 * dt;
      s.lookY += ry * 400 * dt;
      s.padFire = rt > 0.5;
      s.padAim = lt > 0.5;
      if (edge(15)) s.cycle += 1;
      this.padPrev = p.buttons.map((b) => b.pressed);
      break;
    }
    if (this.blocked) {
      s.throttle = s.brake = s.steer = s.moveX = s.moveY = 0;
      s.handbrake = s.boost = s.up = s.down = s.rollL = s.rollR = s.horn = false;
      s.fire = s.aim = s.padFire = s.padAim = false;
      s.slot = -1;
      s.cycle = 0;
      for (const e of EDGES) if (e !== 'pause' && e !== 'map') s[e] = false;
    }
  }
}
