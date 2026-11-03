import type { Input } from './sim.ts';

/** keyboard + gamepad. Edges (restart, respawn, camera, pause) are read once per frame. */
export class Controls {
  keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!e.repeat) {
        this.pressed.add(e.code);
        // modifiers are captured with the key, so a quick Ctrl+Z between two frames still counts
        if (e.ctrlKey || e.metaKey) this.pressed.add('Mod+' + e.code);
        if (e.shiftKey) this.pressed.add('Shift+' + e.code);
      }
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) e.preventDefault();
      this.keys.add(e.code);
      if (this.enabled && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** did this key go down since the last frame */
  hit(...codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }

  private pad(): Gamepad | null {
    const ps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of ps) if (p && p.connected) return p;
    return null;
  }

  /** button edges from the pad, merged into key edges */
  poll() {
    const p = this.pad();
    if (!p) return;
    const map: [number, string][] = [[3, 'KeyR'], [1, 'Enter'], [9, 'Escape'], [2, 'KeyC'], [0, 'PadA'], [12, 'PadUp'], [13, 'PadDown']];
    for (const [b, code] of map) {
      const down = !!p.buttons[b]?.pressed;
      if (down && !this.padPrev[b]) this.pressed.add(code);
      this.padPrev[b] = down;
    }
  }

  endFrame() {
    this.pressed.clear();
  }

  read(): Input {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let hand = k.has('Space');
    const p = this.pad();
    if (p) {
      const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      const x = p.axes[0] ?? 0;
      if (Math.abs(x) > 0.12) steer = Math.sign(x) * ((Math.abs(x) - 0.12) / 0.88) ** 1.4;
      if (p.buttons[0]?.pressed || p.buttons[5]?.pressed) hand = true;
    }
    return { throttle, brake, steer: Math.max(-1, Math.min(1, steer)), hand };
  }
}
