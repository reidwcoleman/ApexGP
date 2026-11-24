/** keyboard + mouse (pointer lock) + gamepad, polled once a frame */
export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  mdx = 0;
  mdy = 0;
  /** mouse buttons held (0 left, 2 right), and pressed this frame */
  readonly buttons = new Set<number>();
  private clicked = new Set<number>();
  wheel = 0;
  locked = false;
  private dragging = false;

  constructor(readonly el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    el.addEventListener('click', () => {
      if (!this.locked) el.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === el));
    addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) {
        this.mdx += e.movementX;
        this.mdy += e.movementY;
      }
    });
    el.addEventListener('mousedown', (e) => {
      this.dragging = true;
      // the click that captures the mouse doesn't also fire
      if (!this.locked && e.button === 0 && !this.freeFire) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    addEventListener('mouseup', (e) => {
      this.dragging = false;
      this.buttons.delete(e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  /** fire without the mouse captured (tests, touch) */
  freeFire = false;

  /** a mouse button pressed this frame */
  click(b: number): boolean {
    return this.clicked.has(b);
  }

  mouse(b: number): boolean {
    return this.buttons.has(b);
  }

  /** true once per key press */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** movement axes (-1..1): x right, y forward */
  move(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const gp = navigator.getGamepads?.()[0];
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      x += dz(gp.axes[0] ?? 0);
      y -= dz(gp.axes[1] ?? 0);
      this.mdx += dz(gp.axes[2] ?? 0) * 14;
      this.mdy += dz(gp.axes[3] ?? 0) * 10;
    }
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.mdx = this.mdy = 0;
    this.wheel = 0;
  }
}
