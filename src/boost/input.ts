import { noInput, type Input } from './sim/car.ts';

/**
 * Keyboard + mouse + gamepad into the car's controls, through rebindable actions. The defaults are
 * the genre's PC layout: W/S drive (S/W pitch in the air), A/D steer and yaw, right mouse jump,
 * left mouse boost, Left Shift powerslide and air roll, Q/E air roll left/right, Space ball cam,
 * Tab scoreboard. A controller uses the console layout: R2/L2 drive, Cross jump, Circle boost,
 * Square powerslide and air roll, Triangle ball cam, R3 look behind, Options pause, the touchpad
 * scoreboard. PlayStation pads are read through the standard mapping, or their raw HID layout where
 * the browser gives no standard one; DualSense / DualShock rumble on hits, demos and goals.
 *
 * The right stick swings the camera round the car; the d-pad (or 1–4) opens quick chat, a second
 * press picks the line. A jump or boost tap shorter than a physics tick is held for one tick so it
 * still counts. Holding air roll turns left/right into roll (yaw stops), as in the real game. Away from the car
 * (menus, the lobby, pause) the pad's d-pad / stick moves a focus ring, Cross presses, Circle backs out.
 */

export type Act =
  | 'forward'
  | 'reverse'
  | 'left'
  | 'right'
  | 'pitchUp'
  | 'pitchDown'
  | 'jump'
  | 'boost'
  | 'slide'
  | 'airRoll'
  | 'rollLeft'
  | 'rollRight'
  | 'ballCam'
  | 'behind'
  | 'board'
  | 'reset'
  | 'pause'
  | 'chat1'
  | 'chat2'
  | 'chat3'
  | 'chat4';

export const ACTS: { id: Act; name: string; pad: boolean }[] = [
  { id: 'forward', name: 'Drive forward', pad: true },
  { id: 'reverse', name: 'Reverse', pad: true },
  { id: 'left', name: 'Steer left', pad: false },
  { id: 'right', name: 'Steer right', pad: false },
  { id: 'pitchUp', name: 'Pitch up (nose up)', pad: false },
  { id: 'pitchDown', name: 'Pitch down', pad: false },
  { id: 'jump', name: 'Jump', pad: true },
  { id: 'boost', name: 'Boost', pad: true },
  { id: 'slide', name: 'Powerslide', pad: true },
  { id: 'airRoll', name: 'Air roll', pad: true },
  { id: 'rollLeft', name: 'Air roll left', pad: true },
  { id: 'rollRight', name: 'Air roll right', pad: true },
  { id: 'ballCam', name: 'Ball cam', pad: true },
  { id: 'behind', name: 'Look behind', pad: true },
  { id: 'board', name: 'Scoreboard', pad: true },
  { id: 'reset', name: 'Reset ball (free play) · skip replay', pad: true },
  { id: 'pause', name: 'Pause', pad: true },
  { id: 'chat1', name: 'Quick chat: information', pad: true },
  { id: 'chat2', name: 'Quick chat: compliments', pad: true },
  { id: 'chat3', name: 'Quick chat: reactions', pad: true },
  { id: 'chat4', name: 'Quick chat: apologies', pad: true },
];

export type KeyBinds = Record<Act, [string, string]>;
export type PadBinds = Record<Act, number>;

export const DEFAULT_KEYS: KeyBinds = {
  forward: ['KeyW', 'ArrowUp'],
  reverse: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  jump: ['Mouse2', ''],
  boost: ['Mouse0', ''],
  slide: ['ShiftLeft', ''],
  airRoll: ['ShiftLeft', ''],
  rollLeft: ['KeyQ', ''],
  rollRight: ['KeyE', ''],
  ballCam: ['Space', ''],
  behind: ['Mouse1', ''],
  board: ['Tab', ''],
  reset: ['Enter', 'Backspace'],
  pause: ['Escape', ''],
  chat1: ['Digit1', ''],
  chat2: ['Digit2', ''],
  chat3: ['Digit3', ''],
  chat4: ['Digit4', ''],
};

// standard-mapping button numbers
export const DEFAULT_PAD: PadBinds = {
  forward: 7,
  reverse: 6,
  left: -1,
  right: -1,
  pitchUp: -1,
  pitchDown: -1,
  jump: 0,
  boost: 1,
  slide: 2,
  airRoll: 2,
  // (air roll left / right have no default on a controller in the genre's layout: hold Square instead)
  rollLeft: -1,
  rollRight: -1,
  ballCam: 3,
  behind: 11,
  board: 17,
  reset: 8,
  pause: 9,
  chat1: 12,
  chat2: 14,
  chat3: 15,
  chat4: 13,
};
/** the pad defaults before they matched the genre's exactly (profiles still on them are moved over) */
export const OLD_PAD_ROLL = [4, 5];

export interface PadSettings {
  deadzone: number;
  steerSens: number;
  airSens: number;
  rumble: boolean;
}

const PS_NAMES = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'PS', 'Touchpad'];
const XB_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Guide', 'Share'];

export function padName(n: number, ps: boolean): string {
  if (n < 0) return '—';
  return (ps ? PS_NAMES : XB_NAMES)[n] ?? `Button ${n}`;
}

export function keyName(code: string): string {
  if (!code) return '—';
  const m: Record<string, string> = {
    Mouse0: 'Left mouse',
    Mouse1: 'Middle mouse',
    Mouse2: 'Right mouse',
    Mouse3: 'Mouse 4',
    Mouse4: 'Mouse 5',
    Space: 'Space',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    AltLeft: 'L Alt',
    AltRight: 'R Alt',
    MetaLeft: 'L Cmd',
    MetaRight: 'R Cmd',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Backspace: 'Backspace',
    CapsLock: 'Caps',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

/** a pad's state in the standard layout, whatever the browser's mapping */
interface PadState {
  b: number[];
  ax: number[];
  ps: boolean;
  pad: Gamepad;
}

function isPlayStation(id: string): boolean {
  return /054c|dualsense|dualshock|playstation|wireless controller/i.test(id);
}

function readPad(p: Gamepad): PadState {
  const ps = isPlayStation(p.id);
  // (triggers are analog; a digital button reports pressed with a value of 0 on some browsers)
  const val = (x: GamepadButton | undefined) => (!x ? 0 : x.value > 0 ? x.value : x.pressed ? 1 : 0);
  if (p.mapping === 'standard' || !ps) {
    return { b: p.buttons.map(val), ax: [p.axes[0] ?? 0, p.axes[1] ?? 0, p.axes[2] ?? 0, p.axes[3] ?? 0], ps, pad: p };
  }
  // a PlayStation pad in its raw HID layout (Firefox, some Safari builds): Square Cross Circle Triangle
  // L1 R1 L2 R2 Create Options L3 R3 PS Touchpad; the triggers also come as axes 3 and 4 (-1..1),
  // which sit at exactly 0 until first touched; the d-pad is a hat on axis 9
  const r = p.buttons.map(val);
  const trig = (a: number | undefined, btn: number) => Math.max(btn, a === undefined || a === 0 ? 0 : (a + 1) / 2);
  const b = new Array(18).fill(0);
  b[0] = r[1] ?? 0;
  b[1] = r[2] ?? 0;
  b[2] = r[0] ?? 0;
  b[3] = r[3] ?? 0;
  b[4] = r[4] ?? 0;
  b[5] = r[5] ?? 0;
  b[6] = trig(p.axes[3], r[6] ?? 0);
  b[7] = trig(p.axes[4], r[7] ?? 0);
  b[8] = r[8] ?? 0;
  b[9] = r[9] ?? 0;
  b[10] = r[10] ?? 0;
  b[11] = r[11] ?? 0;
  b[16] = r[12] ?? 0;
  b[17] = r[13] ?? 0;
  const hat = p.axes[9];
  if (hat !== undefined && hat >= -1.01 && hat <= 1.01) {
    // the hat runs -1 (up) clockwise in steps of 2/7; out of range when centred
    const k = Math.round((hat + 1) * 3.5);
    b[12] = k === 0 || k === 1 || k === 7 ? 1 : 0;
    b[13] = k >= 3 && k <= 5 ? 1 : 0;
    b[14] = k >= 5 && k <= 7 ? 1 : 0;
    b[15] = k >= 1 && k <= 3 ? 1 : 0;
  }
  return { b, ax: [p.axes[0] ?? 0, p.axes[1] ?? 0, p.axes[2] ?? 0, p.axes[5] ?? 0], ps, pad: p };
}

type ActionEvent = 'ballcam' | 'pause' | 'board' | 'boardUp' | 'skip' | 'skipReplay' | 'chat1' | 'chat2' | 'chat3' | 'chat4';
const CHATS = ['chat1', 'chat2', 'chat3', 'chat4'] as const;

export class Controls {
  private keys = new Set<string>();
  /** presses since the last read, so a tap shorter than a tick still jumps (or boosts) */
  private tapJump = false;
  private tapBoost = false;
  /** edge events for the game */
  onAction: (a: ActionEvent) => void = () => {};
  /** a bind being captured: the next key, mouse button or pad button goes to it */
  onCapture: ((kind: 'key' | 'pad', code: string | number) => void) | null = null;
  enabled = true;
  /** the last thing touched was a pad (the HUD and menus show its buttons) */
  lastPad = false;
  /** the connected pad is a PlayStation one */
  padPS = false;
  padName = '';
  keyBinds: KeyBinds = structuredClone(DEFAULT_KEYS);
  padBinds: PadBinds = { ...DEFAULT_PAD };
  pad: PadSettings = { deadzone: 0.1, steerSens: 1, airSens: 1, rumble: true };
  /** menus are open: the pad drives the focus ring instead of the car */
  menuMode = true;
  private prevB: number[] = [];
  private prevNav = { x: 0, y: 0 };
  private navRepeat = 0;
  private state: PadState | null = null;
  onPadChange: () => void = () => {};

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.onCapture) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this.onCapture('key', e.code);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down(e.code);
    }, true);
    window.addEventListener('keyup', (e) => this.up(e.code));
    window.addEventListener('blur', () => {
      for (const k of [...this.keys]) this.up(k);
    });
    window.addEventListener(
      'mousedown',
      (e) => {
        if (this.onCapture) {
          // (clicks on the capture prompt's own buttons pass through)
          if ((e.target as HTMLElement).closest('[data-cap-ui]')) return;
          e.preventDefault();
          e.stopPropagation();
          this.onCapture('key', 'Mouse' + e.button);
          return;
        }
        if (e.target !== target) return;
        this.down('Mouse' + e.button);
      },
      true,
    );
    window.addEventListener('mouseup', (e) => this.up('Mouse' + e.button));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('contextmenu', (e) => this.onCapture && e.preventDefault());
    target.addEventListener('auxclick', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', () => this.onPadChange());
    window.addEventListener('gamepaddisconnected', () => this.onPadChange());
  }

  private down(code: string): void {
    this.keys.add(code);
    this.lastPad = false;
    if (code === 'Escape' || this.bound('pause', code)) this.onAction('pause');
    if (this.menuMode) return;
    if (this.bound('ballCam', code)) this.onAction('ballcam');
    if (this.bound('board', code)) this.onAction('board');
    if (this.bound('reset', code)) this.onAction('skip');
    if (this.bound('jump', code)) this.tapJump = true;
    if (this.bound('boost', code)) {
      this.tapBoost = true;
      // (boost skips a replay, as in the real game)
      this.onAction('skipReplay');
    }
    for (const c of CHATS) if (this.bound(c, code)) this.onAction(c);
  }
  private up(code: string): void {
    if (!this.keys.delete(code)) return;
    if (this.bound('board', code)) this.onAction('boardUp');
  }

  private bound(a: Act, code: string): boolean {
    const b = this.keyBinds[a];
    return !!code && (b[0] === code || b[1] === code);
  }
  private held(a: Act): boolean {
    const b = this.keyBinds[a];
    return (!!b[0] && this.keys.has(b[0])) || (!!b[1] && this.keys.has(b[1]));
  }
  private padV(a: Act): number {
    const n = this.padBinds[a];
    return n >= 0 && this.state ? (this.state.b[n] ?? 0) : 0;
  }

  /** the first connected pad, sampled now */
  private sample(): PadState | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return readPad(p);
    return null;
  }

  /** once per frame: pad edges (actions, menus, bind capture) */
  poll(dt: number): void {
    const s = (this.state = this.sample());
    if (!s) {
      if (this.padName) {
        this.padName = '';
        this.onPadChange();
      }
      return;
    }
    if (s.pad.id !== this.padName) {
      this.padName = s.pad.id;
      this.padPS = s.ps;
      this.onPadChange();
    }
    const b = s.b;
    const press = (n: number) => n >= 0 && (b[n] ?? 0) > 0.5 && !((this.prevB[n] ?? 0) > 0.5);
    const release = (n: number) => n >= 0 && !((b[n] ?? 0) > 0.5) && (this.prevB[n] ?? 0) > 0.5;
    const dz = this.pad.deadzone;
    const moved = Math.abs(s.ax[0]) > Math.max(0.3, dz) || Math.abs(s.ax[1]) > Math.max(0.3, dz) || b.some((v) => v > 0.5);
    if (moved && !this.lastPad) {
      this.lastPad = true;
      this.onPadChange();
    }
    if (this.onCapture) {
      for (let n = 0; n < b.length; n++)
        if (press(n)) {
          this.onCapture('pad', n);
          break;
        }
      this.prevB = b.slice();
      return;
    }
    if (press(this.padBinds.pause)) this.onAction('pause');
    if (this.menuMode) this.menuNav(s, press, dt);
    else {
      if (press(this.padBinds.ballCam)) this.onAction('ballcam');
      if (press(this.padBinds.board)) this.onAction('board');
      if (release(this.padBinds.board)) this.onAction('boardUp');
      if (press(this.padBinds.reset)) this.onAction('skip');
      if (press(this.padBinds.jump)) this.tapJump = true;
      if (press(this.padBinds.boost)) this.onAction('skipReplay');
      for (const c of CHATS) if (press(this.padBinds[c])) this.onAction(c);
    }
    this.prevB = b.slice();
  }

  /** the right stick: the camera swung round the car (x left/right, y up/down, −1…1) */
  get look(): { x: number; y: number } {
    const s = this.state;
    if (!s || !this.enabled || this.menuMode || !this.lastPad) return { x: 0, y: 0 };
    const dz = Math.max(0.15, this.pad.deadzone);
    const dead = (x: number) => (Math.abs(x) < dz ? 0 : (x - Math.sign(x) * dz) / (1 - dz));
    return { x: dead(s.ax[2]), y: dead(s.ax[3]) };
  }

  /** look behind is held (key or pad) */
  get behind(): boolean {
    return this.enabled && !this.menuMode && (this.held('behind') || this.padV('behind') > 0.5);
  }

  read(): Input {
    const i = noInput();
    if (!this.enabled) return i;
    const h = (a: Act) => (this.held(a) ? 1 : 0);
    // keyboard
    let throttle = h('forward') - h('reverse');
    let steer = h('right') - h('left');
    let pitch = h('pitchUp') - h('pitchDown');
    let roll = h('rollRight') - h('rollLeft');
    let jump = this.held('jump') || this.tapJump;
    let boost = this.held('boost') || this.tapBoost;
    this.tapJump = this.tapBoost = false;
    let slide = this.held('slide');
    let airRoll = this.held('airRoll');
    // pad (analog values fresh for this tick)
    const s = (this.state = this.sample() ?? this.state);
    if (s && this.lastPad) {
      const dz = this.pad.deadzone;
      const dead = (x: number) => (Math.abs(x) < dz ? 0 : (x - Math.sign(x) * dz) / (1 - dz));
      const lx = dead(s.ax[0]);
      const ly = dead(s.ax[1]);
      const th = this.padV('forward') - this.padV('reverse');
      if (Math.abs(th) > Math.abs(throttle)) throttle = th;
      if (Math.abs(lx) > Math.abs(steer)) steer = lx;
      if (Math.abs(ly) > Math.abs(pitch)) pitch = ly;
      const pr = (this.padV('rollRight') > 0.5 ? 1 : 0) - (this.padV('rollLeft') > 0.5 ? 1 : 0);
      if (pr) roll = pr;
      jump ||= this.padV('jump') > 0.5;
      boost ||= this.padV('boost') > 0.5;
      slide ||= this.padV('slide') > 0.5;
      airRoll ||= this.padV('airRoll') > 0.5;
      // sensitivities stretch the stick before the clamp, as the game's settings do
      i.steer = Math.max(-1, Math.min(1, steer * this.pad.steerSens));
      const air = this.pad.airSens;
      steer = Math.max(-1, Math.min(1, steer * air));
      pitch = Math.max(-1, Math.min(1, pitch * air));
    } else i.steer = steer;
    i.throttle = throttle;
    i.pitch = pitch;
    i.yaw = steer;
    i.roll = roll;
    // free air roll: left/right rolls instead of yawing
    if (airRoll) {
      if (!roll) i.roll = steer;
      i.yaw = 0;
    }
    i.jump = jump;
    i.boost = boost;
    i.handbrake = slide;
    return i;
  }

  /** a short rumble on the pad (ignored without one or with rumble off) */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.pad.rumble || !this.lastPad) return;
    const p = this.state?.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | undefined;
    try {
      void p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch(() => {});
    } catch {
      /* not supported */
    }
  }

  // ------------------------------------------------------------ menus on a pad
  private menuNav(s: PadState, press: (n: number) => boolean, dt: number): void {
    if (this.lastPad && !this.focused()) {
      const all = this.targets();
      if (all.length) this.setFocus(all.find((e) => e.classList.contains('primary')) ?? all[0]);
    }
    const b = s.b;
    const x = (b[15] > 0.5 ? 1 : 0) - (b[14] > 0.5 ? 1 : 0) || (Math.abs(s.ax[0]) > 0.55 ? Math.sign(s.ax[0]) : 0);
    const y = (b[13] > 0.5 ? 1 : 0) - (b[12] > 0.5 ? 1 : 0) || (Math.abs(s.ax[1]) > 0.55 ? Math.sign(s.ax[1]) : 0);
    const fresh = x !== this.prevNav.x || y !== this.prevNav.y;
    this.navRepeat -= dt;
    if ((x || y) && (fresh || this.navRepeat <= 0)) {
      this.navRepeat = fresh ? 0.4 : 0.12;
      this.focusMove(x, y);
    }
    this.prevNav = { x, y };
    if (press(0)) this.focusPress();
    if (press(1)) {
      const back = this.visible('.mbtn.back, #p-resume, [data-pad-back]').pop();
      back?.click();
    }
  }

  private visible(sel: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
      if ((el as HTMLButtonElement).disabled) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      return el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions) : el.offsetParent !== null;
    });
  }

  private focused(): HTMLElement | null {
    const el = document.querySelector<HTMLElement>('.padfocus');
    return el && this.visible('.padfocus').length ? el : null;
  }

  private setFocus(el: HTMLElement | null): void {
    document.querySelectorAll('.padfocus').forEach((e) => e.classList.remove('padfocus'));
    if (!el) return;
    el.classList.add('padfocus');
    el.scrollIntoView({ block: 'nearest' });
    if (el.tagName === 'INPUT') el.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private targets(): HTMLElement[] {
    // the topmost layer only: an open overlay hides what's behind it
    const layers = ['#o-binds', '#o-end', '#o-pause', '#m-lobby', '#m-menu'];
    for (const l of layers) {
      const root = document.querySelector<HTMLElement>(l);
      if (root && !root.hidden && this.visible(l).length) return this.visible(`${l} button, ${l} input`);
    }
    return [];
  }

  private focusMove(dx: number, dy: number): void {
    const all = this.targets();
    if (!all.length) return;
    const cur = this.focused();
    if (!cur || !all.includes(cur)) {
      this.setFocus(all.find((e) => e.classList.contains('primary')) ?? all[0]);
      return;
    }
    // a focused slider takes left/right
    if (dx && cur.tagName === 'INPUT' && (cur as HTMLInputElement).type === 'range') {
      const r = cur as HTMLInputElement;
      if (dx > 0) r.stepUp();
      else r.stepDown();
      r.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const along = dx ? (ex - ax) * dx : (ey - ay) * dy;
      if (along <= 4) continue;
      const across = dx ? Math.abs(ey - ay) : Math.abs(ex - ax);
      const d = along + across * 2.2;
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    if (best) this.setFocus(best);
  }

  private focusPress(): void {
    const cur = this.focused();
    if (!cur) {
      this.focusMove(0, 1);
      return;
    }
    if (cur.tagName === 'INPUT') cur.focus();
    else cur.click();
  }

  /** put the focus ring on the screen's main button (when a pad is in use) */
  focusDefault(): void {
    if (!this.lastPad) return;
    requestAnimationFrame(() => {
      const all = this.targets();
      this.setFocus(all.find((e) => e.classList.contains('primary')) ?? all[0] ?? null);
    });
  }
}
