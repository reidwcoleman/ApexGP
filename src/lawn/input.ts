/** One floating joystick for touch and mouse, WASD / arrows, or a gamepad stick. */

export interface Stick {
  x: number;
  y: number;
  /** 0..1 */
  mag: number;
}

export class Input {
  private keys = new Set<string>();
  private pid = -1;
  private ox = 0;
  private oy = 0;
  private px = 0;
  private py = 0;
  active = false;
  /** Where the on-screen ring sits. */
  readonly ring = { x: 0, y: 0, nx: 0, ny: 0, show: false };
  enabled = false;
  onFirstMove: (() => void) | null = null;
  private moved = false;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pid !== -1) return;
      this.pid = e.pointerId;
      el.setPointerCapture(e.pointerId);
      this.ox = this.px = e.clientX;
      this.oy = this.py = e.clientY;
      this.active = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      this.px = e.clientX;
      this.py = e.clientY;
      // the stick follows the finger when you drag past its edge, so a reversal is instant
      const dx = this.px - this.ox;
      const dy = this.py - this.oy;
      const d = Math.hypot(dx, dy);
      const R = 90;
      if (d > R) {
        this.ox = this.px - (dx / d) * R;
        this.oy = this.py - (dy / d) * R;
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pid) return;
      this.pid = -1;
      this.active = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pid = -1;
      this.active = false;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '].includes(k)) {
        this.keys.add(k);
        if (k.startsWith('arrow') || k === ' ') e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  read(): Stick {
    let x = 0;
    let y = 0;
    this.ring.show = false;
    if (this.active) {
      const dx = this.px - this.ox;
      const dy = this.py - this.oy;
      const d = Math.hypot(dx, dy);
      const dead = 10;
      const full = 62;
      const mag = d < dead ? 0 : Math.min(1, (d - dead) / (full - dead));
      if (d > 0) {
        x = (dx / d) * mag;
        y = (dy / d) * mag;
      }
      this.ring.show = true;
      this.ring.x = this.ox;
      this.ring.y = this.oy;
      this.ring.nx = Math.max(-1, Math.min(1, dx / 90));
      this.ring.ny = Math.max(-1, Math.min(1, dy / 90));
    }
    const k = this.keys;
    const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const ky = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      x = kx / l;
      y = ky / l;
    }
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const gx = p.axes[0] ?? 0;
      const gy = p.axes[1] ?? 0;
      const gm = Math.hypot(gx, gy);
      if (gm > 0.22) {
        const m = Math.min(1, (gm - 0.22) / 0.7);
        x = (gx / gm) * m;
        y = (gy / gm) * m;
      }
      break;
    }
    const mag = Math.hypot(x, y);
    if (mag > 0.05 && !this.moved) {
      this.moved = true;
      this.onFirstMove?.();
    }
    return { x, y, mag: Math.min(1, mag) };
  }
}
