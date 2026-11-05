// Immediate-mode pixel widgets. Two skins: the dark HUD and the cream almanac paper for windows.
import { C } from './pal';
import { text, bold, textW, center } from './font';
import { icon } from './art';
import type { Chip } from './audio';

type G = CanvasRenderingContext2D;
export class UI {
  g!: G; W = 480; H = 300; mx = -1; my = -1; down = false; pressed = false; released = false; rdown = false; wheel = 0;
  private blockers: number[][] = []; private next: number[][] = []; over = false; tip = ''; tipX = 0; tipY = 0; hoverKey = ''; private lastHover = '';
  constructor(public chip: Chip) {}
  begin(g: G, W: number, H: number) { this.g = g; this.W = W; this.H = H; this.blockers = this.next; this.next = []; this.over = this.blockers.some((b) => this.inside(b[0], b[1], b[2], b[3])); this.tip = ''; this.hoverKey = ''; }
  end() { if (this.hoverKey && this.hoverKey !== this.lastHover) this.chip.sfx('blip'); this.lastHover = this.hoverKey; this.pressed = false; this.released = false; this.wheel = 0; this.drawTip(); }
  inside(x: number, y: number, w: number, h: number) { return this.mx >= x && this.my >= y && this.mx < x + w && this.my < y + h; }
  block(x: number, y: number, w: number, h: number) { this.next.push([x, y, w, h]); }
  rect(c: string, x: number, y: number, w: number, h: number) { this.g.fillStyle = c; this.g.fillRect(x, y, w, h); }
  /** bevelled dark bar */
  bar(x: number, y: number, w: number, h: number) {
    this.block(x, y, w, h); this.rect(C.deep, x, y, w, h); this.rect(C.forest, x, y, w, 1); this.rect(C.ink, x, y + h - 1, w, 1);
  }
  paper(x: number, y: number, w: number, h: number) {
    this.block(x, y, w, h);
    this.rect(C.ink, x - 1, y + 1, w + 2, h); this.rect(C.ink, x + 1, y - 1, w - 2, h + 2); this.rect(C.ink, x + 2, y + h + 1, w, 2);
    this.rect(C.cream, x, y, w, h); this.rect(C.white, x + 1, y + 1, w - 2, 1); this.rect(C.tan, x, y + h - 1, w, 1); this.rect(C.tan, x + w - 1, y, 1, h);
  }
  window(w: number, h: number, title: string, close = true) {
    const x = Math.round((this.W - w) / 2), y = Math.max(20, Math.round((this.H - h) / 2) - 6), g = this.g;
    g.fillStyle = 'rgba(16,20,34,.55)'; g.fillRect(0, 0, this.W, this.H); this.block(0, 0, this.W, this.H);
    this.paper(x, y, w, h);
    this.rect(C.red, x, y, w, 15); this.rect(C.dred, x, y + 14, w, 1); this.rect(C.pink, x, y, w, 1);
    bold(g, title, x + 6, y + 3, C.white, 1, C.dred);
    let closed = false;
    if (close) closed = this.button(x + w - 15, y + 2, 12, 11, 'X', { dark: true, flat: true });
    return { x, y, closed };
  }
  button(x: number, y: number, w: number, h: number, label: string, o: { icon?: string; primary?: boolean; dark?: boolean; flat?: boolean; disabled?: boolean; sel?: boolean; tip?: string; key?: string; col?: string; center?: boolean } = {}) {
    const g = this.g, hov = !o.disabled && this.inside(x, y, w, h), press = hov && this.down;
    if (this.inside(x, y, w, h) && o.tip) { this.tip = o.tip; this.tipX = x; this.tipY = y; }
    if (hov) this.hoverKey = label + x + '.' + y;
    const dark = o.dark;
    const bg = o.disabled ? (dark ? C.forest : C.tan) : o.primary ? (hov ? C.orange : C.red) : o.sel ? (dark ? C.pine : C.gold) : dark ? (hov ? C.pine : C.forest) : hov ? C.white : '#e6d5a6';
    const fg = o.disabled ? (dark ? C.grey : C.brown) : o.primary ? C.white : o.sel ? (dark ? C.lemon : C.ink) : dark ? C.cream : C.ink;
    const oy = press ? 1 : 0;
    this.rect(dark ? C.ink : C.bark, x, y + 1, w, h);
    this.rect(bg, x, y + oy, w, h - oy);
    if (!o.flat && !press) { this.rect(o.primary ? C.pink : dark ? C.leaf : C.white, x, y, w, 1); }
    if (o.sel) { g.strokeStyle = dark ? C.gold : C.dred; g.lineWidth = 1; g.strokeRect(x + 0.5, y + oy + 0.5, w - 1, h - oy - 1); }
    if (o.icon) {
      const im = icon(o.icon, fg);
      if (label) { g.drawImage(im, x + 3, y + 2 + oy); text(g, label, x + 17, y + Math.floor((h - 8) / 2) + oy, fg); }
      else g.drawImage(im, x + Math.floor((w - 12) / 2), y + Math.floor((h - 12) / 2) + oy);
    } else if (label) { const lw = textW(label); text(g, label, o.center === false ? x + 4 : x + (w - lw) / 2, y + Math.floor((h - 8) / 2) + oy, fg); }
    if (o.key) { text(g, o.key, x + 2, y + 1 + oy, dark ? C.aqua : C.brown); }
    if (hov && this.pressed) { this.pressed = false; this.chip.sfx('click'); return true; }
    if (!hov && o.disabled && this.inside(x, y, w, h) && this.pressed) { this.pressed = false; this.chip.sfx('deny'); }
    return false;
  }
  private drawTip() {
    if (!this.tip) return; const w = textW(this.tip) + 8, x = Math.max(2, Math.min(this.W - w - 2, this.tipX)), y = this.tipY - 13 < 2 ? this.tipY + 22 : this.tipY - 13;
    this.rect(C.ink, x, y, w, 12); this.rect(C.lemon, x + 1, y + 1, w - 2, 10); text(this.g, this.tip, x + 4, y + 2, C.ink);
  }
  meter(x: number, y: number, w: number, h: number, v: number, col: string, back: string = C.ink) { this.rect(back, x, y, w, h); this.rect(col, x, y, Math.round(w * Math.max(0, Math.min(1, v))), h); }
  centerText(t: string, y: number, col: string) { center(this.g, t, this.W / 2, y, col); }
}
