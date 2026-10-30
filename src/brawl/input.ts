/**
 * Every device (two keyboard layouts, the mouse's two buttons for the hands, any number of
 * gamepads) reads into the same named buttons, so the game never cares which one a player holds.
 */

export type Btn = 'jump' | 'punch' | 'kick' | 'grabL' | 'grabR' | 'lift' | 'run' | 'confirm' | 'back' | 'start' | 'up' | 'down' | 'left' | 'right' | 'prev' | 'next' | 'any';
const BTNS: Btn[] = ['jump', 'punch', 'kick', 'grabL', 'grabR', 'lift', 'run', 'confirm', 'back', 'start', 'up', 'down', 'left', 'right', 'prev', 'next', 'any'];
type State = Record<Btn, boolean> & { lx: number; ly: number };
const blank = (): State => {
  const s = { lx: 0, ly: 0 } as State;
  for (const b of BTNS) s[b] = false;
  return s;
};

interface Layout {
  label: string;
  move: { up: string; down: string; left: string; right: string };
  jump: string[];
  punch: string[];
  kick: string[];
  grab: string[];
  lift: string[];
  run: string[];
  confirm: string[];
  back: string[];
  start: string[];
  prev: string[];
  next: string[];
}

const KB: Record<string, Layout> = {
  kb1: {
    label: 'Keyboard',
    move: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
    jump: ['Space'], punch: ['KeyJ'], kick: ['KeyL'], grab: ['KeyK'], lift: ['KeyI'], run: ['ShiftLeft'],
    confirm: ['Space', 'Enter'], back: ['Escape', 'Backspace'], start: ['Enter', 'Escape'], prev: ['KeyQ'], next: ['KeyE'],
  },
  kb2: {
    label: 'Keyboard 2',
    move: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    jump: ['Numpad0', 'Slash'], punch: ['Numpad1', 'Period'], kick: ['Numpad3', 'Quote'], grab: ['Numpad2', 'Comma'], lift: ['Numpad5', 'Semicolon'], run: ['ShiftRight'],
    confirm: ['Numpad0', 'Slash'], back: ['NumpadDecimal', 'Backslash'], start: [], prev: [], next: [],
  },
};

export class Device {
  cur = blank();
  prev = blank();
  connected = true;
  pad: Gamepad | null = null;
  constructor(readonly id: string, readonly kind: 'kb' | 'pad', readonly label: string) {}
  pressed(b: Btn) {
    return this.cur[b] && !this.prev[b];
  }
  held(b: Btn) {
    return this.cur[b];
  }
  rumble(strong = 0.6, weak = 0.4, ms = 120) {
    const a = (this.pad as unknown as { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } })?.vibrationActuator;
    if (!a?.playEffect) return;
    try {
      a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
    } catch {
      /* not supported */
    }
  }
}

export class Input {
  keys = new Set<string>();
  /** keys that went down since the last poll (a tap shorter than a frame still counts) */
  private taps = new Set<string>();
  private tapped = new Set<string>();
  mouse = { l: false, r: false };
  devices = new Map<string, Device>();
  lastKind: 'kb' | 'pad' = 'kb';
  /** scripted input for tests: forced.set('kb1', { lx: 1, punch: true }) holds until cleared */
  forced = new Map<string, Partial<State>>();

  constructor(target: HTMLElement) {
    this.devices.set('kb1', new Device('kb1', 'kb', KB.kb1.label));
    this.devices.set('kb2', new Device('kb2', 'kb', KB.kb2.label));
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      this.taps.add(e.code);
      this.lastKind = 'kb';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.l = this.mouse.r = false;
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.l = true;
      if (e.button === 2) this.mouse.r = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.l = false;
      if (e.button === 2) this.mouse.r = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  poll() {
    for (const d of this.devices.values()) {
      const t = d.prev;
      d.prev = d.cur;
      d.cur = t;
      for (const k in d.cur) (d.cur as unknown as Record<string, number | boolean>)[k] = k === 'lx' || k === 'ly' ? 0 : false;
    }
    this.tapped = this.taps;
    this.taps = new Set();
    this.readKeyboard('kb1');
    this.readKeyboard('kb2');
    const kb1 = this.devices.get('kb1')!.cur;
    if (this.mouse.l) kb1.grabL = true;
    if (this.mouse.r) kb1.grabR = true;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set<string>();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const id = 'pad' + p.index;
      seen.add(id);
      let d = this.devices.get(id);
      if (!d) {
        d = new Device(id, 'pad', padLabel(p.id));
        this.devices.set(id, d);
      }
      d.connected = true;
      d.pad = p;
      this.readPad(d, p);
    }
    for (const d of this.devices.values()) if (d.kind === 'pad' && !seen.has(d.id)) d.connected = false;
    for (const [id, f] of this.forced) {
      const d = this.devices.get(id);
      if (d) Object.assign(d.cur, f);
    }
  }

  private readKeyboard(id: string) {
    const L = KB[id], d = this.devices.get(id)!, s = d.cur;
    const k = { has: (c: string) => this.keys.has(c) || this.tapped.has(c) };
    const any = (codes: string[]) => codes.some((c) => k.has(c));
    s.lx = (k.has(L.move.right) ? 1 : 0) - (k.has(L.move.left) ? 1 : 0);
    s.ly = (k.has(L.move.down) ? 1 : 0) - (k.has(L.move.up) ? 1 : 0);
    if (s.lx && s.ly) {
      s.lx *= Math.SQRT1_2;
      s.ly *= Math.SQRT1_2;
    }
    s.jump = any(L.jump);
    s.punch = any(L.punch);
    s.kick = any(L.kick);
    s.grabL = s.grabR = any(L.grab);
    s.lift = any(L.lift);
    s.run = any(L.run);
    s.confirm = any(L.confirm);
    s.back = any(L.back);
    s.start = any(L.start);
    s.prev = any(L.prev);
    s.next = any(L.next);
    s.up = k.has(L.move.up);
    s.down = k.has(L.move.down);
    s.left = k.has(L.move.left);
    s.right = k.has(L.move.right);
    s.any = s.jump || s.punch || s.kick || s.grabL || s.lift || s.confirm;
  }

  private readPad(d: Device, p: Gamepad) {
    const s = d.cur;
    const b = (i: number) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.35));
    let x = p.axes[0] || 0, y = p.axes[1] || 0;
    const m = Math.hypot(x, y);
    if (m < 0.2) {
      x = 0;
      y = 0;
    } else {
      const k = Math.min(1, (m - 0.2) / 0.75) / m;
      x *= k;
      y *= k;
    }
    s.lx = x;
    s.ly = y;
    s.jump = b(0);
    s.kick = b(1);
    s.punch = b(2);
    s.lift = b(3) || b(5);
    s.run = b(4) || b(10);
    s.grabL = b(6);
    s.grabR = b(7);
    s.confirm = b(0);
    s.back = b(1);
    s.start = b(9);
    s.up = b(12) || y < -0.6;
    s.down = b(13) || y > 0.6;
    s.left = b(14) || x < -0.6;
    s.right = b(15) || x > 0.6;
    s.prev = b(4);
    s.next = b(5);
    s.any = p.buttons.some((q, i) => i < 8 && q && q.pressed);
    if (s.any || m > 0.5) this.lastKind = 'pad';
  }

  /** a key held now or tapped since the last poll */
  key(code: string) {
    return this.keys.has(code) || this.tapped.has(code);
  }
  /** every key that counts as down this frame */
  active() {
    return new Set([...this.keys, ...this.tapped]);
  }

  list() {
    return [...this.devices.values()].filter((d) => d.connected);
  }
  get(id: string) {
    return this.devices.get(id);
  }
}

function padLabel(id: string) {
  const s = id.toLowerCase();
  if (s.includes('dualsense') || (s.includes('054c') && s.includes('0ce6'))) return 'DualSense';
  if (s.includes('dualshock') || s.includes('054c')) return 'DualShock';
  if (s.includes('xbox') || s.includes('045e')) return 'Xbox pad';
  return 'Controller';
}
