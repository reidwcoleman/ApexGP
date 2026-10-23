import { noInput, type Input } from './sim/car.ts';

/**
 * Keyboard + mouse + gamepad into the car's controls. Keyboard: W/S drive (and pitch in the air),
 * A/D steer (yaw), Space jump, Shift boost, X powerslide / air roll, Q/E air roll left/right, C ball
 * cam. Mouse: left boost, right jump. The classic layout is the genre's PC default instead: mouse
 * jump and boost, Shift powerslide / air roll, Space ball cam. A pad uses the real game's layout: RT/LT, A jump, B boost,
 * X powerslide, Y ball cam, LB/RB directional air roll.
 */

export class Controls {
  private keys = new Set<string>();
  private mouse = new Set<number>();
  ballCamToggled = false;
  /** edge events for the game: 'ballcam', 'pause', 'board' */
  onAction: (a: 'ballcam' | 'pause' | 'board' | 'boardUp' | 'skip') => void = () => {};
  private padPrev: boolean[] = [];
  enabled = true;
  lastPad = false;
  classic = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.lastPad = false;
      if (e.code === 'KeyC' || (this.classic && e.code === 'Space')) this.onAction('ballcam');
      if (e.code === 'Escape') this.onAction('pause');
      if (e.code === 'Tab') this.onAction('board');
      if (e.code === 'Enter') this.onAction('skip');
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.onAction('boardUp');
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.clear();
    });
    target.addEventListener('mousedown', (e) => {
      this.mouse.add(e.button);
      this.lastPad = false;
    });
    window.addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private k(...codes: string[]): number {
    for (const c of codes) if (this.keys.has(c)) return 1;
    return 0;
  }

  read(): Input {
    const i = noInput();
    if (!this.enabled) return i;
    const fwd = this.k('KeyW', 'ArrowUp');
    const back = this.k('KeyS', 'ArrowDown');
    const left = this.k('KeyA', 'ArrowLeft');
    const right = this.k('KeyD', 'ArrowRight');
    i.throttle = fwd - back;
    i.steer = right - left;
    i.pitch = back - fwd;
    i.yaw = right - left;
    i.roll = this.k('KeyE') - this.k('KeyQ');
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    i.jump = (!this.classic && this.keys.has('Space')) || this.mouse.has(2);
    i.boost = (!this.classic && shift) || this.mouse.has(0);
    i.handbrake = (this.classic && shift) || this.keys.has('KeyX') || this.keys.has('ControlRight');
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = (n: number) => p.buttons[n]?.pressed ?? false;
      const v = (n: number) => p.buttons[n]?.value ?? 0;
      const dz = (x: number) => (Math.abs(x) < 0.12 ? 0 : (x - Math.sign(x) * 0.12) / 0.88);
      const lx = dz(p.axes[0] ?? 0);
      const ly = dz(p.axes[1] ?? 0);
      const any = Math.abs(lx) + Math.abs(ly) + v(7) + v(6) > 0.05 || p.buttons.some((x) => x.pressed);
      if (any) this.lastPad = true;
      if (!this.lastPad) continue;
      const thr = v(7) - v(6);
      if (Math.abs(thr) > Math.abs(i.throttle)) i.throttle = thr;
      if (Math.abs(lx) > Math.abs(i.steer)) i.steer = lx;
      if (Math.abs(lx) > Math.abs(i.yaw)) i.yaw = lx;
      if (Math.abs(ly) > Math.abs(i.pitch)) i.pitch = ly;
      if (b(4)) i.roll = -1;
      if (b(5)) i.roll = 1;
      i.jump ||= b(0);
      i.boost ||= b(1);
      i.handbrake ||= b(2);
      const edge = (n: number) => b(n) && !this.padPrev[n];
      if (edge(3)) this.onAction('ballcam');
      if (edge(9)) this.onAction('pause');
      if (edge(8)) this.onAction('board');
      if (!b(8) && this.padPrev[8]) this.onAction('boardUp');
      this.padPrev = p.buttons.map((x) => x.pressed);
      break;
    }
    return i;
  }
}
