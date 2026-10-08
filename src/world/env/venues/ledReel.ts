import * as THREE from 'three';
import { canvas2d, canvasTexture } from '../textures.ts';
import { BRAND_FONTS, drawBrand, type Brand } from '../../brands.ts';
import type { Roster } from '../../partners.ts';

/**
 * The LED perimeter boards' content: a reel of slides (one partner each) the boards roll through
 * together, as the real ones do — F1 sells the LED boards by rotation rather than by the metre,
 * so a run of boards belongs to one brand at a time and the whole run changes to the next
 * (docs/F1_ADVERTISING.md §3, §5).
 *
 * One canvas per venue, a column of slides; every LED face is mapped to a slide (its first) and the
 * texture's own offset rolls the column on — the boards hold a slide for `HOLD` seconds, then roll
 * up to the next in `ROLL` (RepeatWrapping does the wrap, so the UVs stay continuous: no seams in
 * the mips). The roll is wall-clock time and the same for every board, so all of a venue's LED
 * boards change together. The title partner holds a quarter of the slides (its airtime share).
 */

export type SlideDraw = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;

/** seconds a slide is held, seconds the roll to the next takes */
const HOLD = 8;
const ROLL = 0.45;

/** a partner's slide: its board as the LED shows it */
export const brandSlide = (b: Brand, invert = false): SlideDraw => (g, x, y, w, h) => drawBrand(g, x, y, w, h, b, invert);

/**
 * A venue's rotation from its partners: the title partner every fourth slide (the presenting
 * partner where the race has no title), the big series contracts and the promoter's partners
 * between; `extra` slides (the event's own boards) go in after the title partner's.
 */
export function rotation(R: Roster, extra: [string, SlideDraw][] = []): [string, SlideDraw][] {
  const L = (n: number) => R.local[n % R.local.length];
  const order = ['title', 'timing', L(0), 'logistics', 'title', 'lager', L(1), 'energy', 'title', 'tyres', L(2), 'airline'];
  const out: [string, SlideDraw][] = [];
  order.forEach((k, i) => {
    out.push([out.some((o) => o[0] === k) ? `${k}#${i}` : k, brandSlide(R.b(k))]);
    if (i === 0) out.push(...extra);
  });
  return out;
}

export class LedReel {
  readonly texture: THREE.CanvasTexture;
  readonly count: number;
  private readonly rows = new Map<string, number>();
  private readonly cw: number;
  private readonly ch: number;

  constructor(slides: [string, SlideDraw][], cw = 512, ch = 128) {
    this.cw = cw;
    this.ch = ch;
    this.count = slides.length;
    slides.forEach(([name], i) => this.rows.set(name, i));
    const { canvas, ctx } = canvas2d(cw, ch * slides.length);
    const draw = () => {
      slides.forEach(([, paint], i) => {
        const y = i * ch;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y, cw, ch);
        ctx.clip();
        paint(ctx, 0, y, cw, ch);
        // the diode grid and the black seam between modules
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgba(40,40,46,0.5)';
        for (let k = 0; k < cw; k += 4) ctx.fillRect(k, y, 1, ch);
        for (let k = 0; k < ch; k += 4) ctx.fillRect(0, y + k, cw, 1);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#050506';
        ctx.fillRect(0, y, cw, 2);
        ctx.fillRect(0, y + ch - 2, cw, 2);
        ctx.restore();
      });
    };
    draw();
    this.texture = canvasTexture(canvas, true, 8);
    this.texture.wrapT = THREE.RepeatWrapping;
    if (typeof document !== 'undefined' && document.fonts && !BRAND_FONTS.every((f) => document.fonts.check(f)))
      Promise.all(BRAND_FONTS.map((f) => document.fonts.load(f)))
        .then(() => {
          draw();
          this.texture.needsUpdate = true;
        })
        .catch(() => {});
  }

  has(name: string) {
    return this.rows.has(name);
  }

  /** [u0, v0, u1, v1] of a slide by name or index (v up: the canvas's row 0 is v = 1) */
  uv(slide: string | number): [number, number, number, number] {
    const i = typeof slide === 'number' ? ((slide % this.count) + this.count) % this.count : this.rows.get(slide) ?? 0;
    const H = this.ch * this.count;
    const y0 = i * this.ch + 1.5, y1 = (i + 1) * this.ch - 1.5;
    return [2 / this.cw, 1 - y1 / H, 1 - 2 / this.cw, 1 - y0 / H];
  }

  /** roll the reel on whenever `mesh` is drawn */
  attach(mesh: THREE.Object3D) {
    mesh.onBeforeRender = () => this.tick();
  }

  private tick() {
    const t = performance.now() / 1000;
    const k = Math.floor(t / HOLD);
    const f = (t - k * HOLD) / ROLL;
    const roll = f >= 1 ? 1 : f * f * (3 - 2 * f);
    // (a lower v is the next slide down the canvas: the content rolls up)
    this.texture.offset.y = -(((k % this.count) + roll - 1) / this.count);
  }
}
