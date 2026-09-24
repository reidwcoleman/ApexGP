import * as THREE from 'three';
import { EVENT } from '../event.ts';
import { TEAMS } from '../../race/Teams.ts';
import { Rng } from './noise.ts';

/**
 * Canvas atlases for everything printed trackside.
 *
 *  - `PrintAtlas` 2048² in 512×128 cells (4:1): sponsor boards (fictional brands),
 *    conveyor-belt tyre-wall covers, tyre tops/sides, concrete, chevrons,
 *    distance boards, signs, timing screen, gantry banner, team plates.
 *  - `DecalAtlas` 1024² with transparent background: grid numbers, "PIT", "80",
 *    chequer, white, launch-streak.
 *
 * Both are drawn once with a fallback font and redrawn when Titillium Web has loaded.
 */

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';

/** Fictional sponsors — deliberately made-up names. [text, bg, fg, style, accent] */
export const SPONSORS: [string, string, string, number, string][] = [
  ['VELOCE', '#c8102e', '#ffffff', 0, '#ffd400'],
  ['SOLMARA AIR', '#0b2a5b', '#ffffff', 1, '#f5b700'],
  ['QUANTA', '#101214', '#00d2be', 2, '#00d2be'],
  ['ZEPHYRA', '#ffffff', '#12305f', 3, '#e4002b'],
  ['TERRAVOLT', '#00843d', '#ffffff', 0, '#c6ff00'],
  ['LUMERA', '#1a1a1a', '#d8b56a', 4, '#d8b56a'],
  ['APEX GP', '#e10600', '#ffffff', 5, '#15151e'],
  ['CORALUX', '#ff6b00', '#ffffff', 1, '#1b1b1b'],
  ['VANTORO', '#ffd400', '#111111', 2, '#111111'],
  ['ORBELLE', '#5b2a86', '#ffffff', 3, '#ff9bd2'],
  ['QUINTARA BANK', '#00205b', '#ffffff', 0, '#00a3e0'],
  ['HALCYA', '#e8e8e8', '#0a0a0a', 4, '#e10600'],
  ['NORTHWIND', '#0e3b43', '#ffffff', 1, '#7fd1c7'],
  ['MIRAFLO', '#00a3e0', '#ffffff', 5, '#ffffff'],
  ['VALTREO TYRES', '#111111', '#ffd400', 2, '#ffd400'],
  ['VERDANO', '#f2a900', '#0b2a5b', 3, '#0b2a5b'],
  ['BRAVANTE', '#8a0f2e', '#ffffff', 0, '#e8c07a'],
  ['ARBOR', '#2d5a27', '#f1f1e6', 4, '#a5d86e'],
];

export const BELTS = ['belt_red', 'belt_blue', 'belt_white', 'belt_yellow', 'belt_black', 'belt_redwhite'] as const;

export class PrintAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly names = new Map<string, number>();
  private readonly cw = 512;
  private readonly ch = 128;
  private readonly cols = 4;
  private readonly size = 2048;

  constructor(aniso: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = aniso;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.register();
    this.draw();
  }

  private register() {
    const list: string[] = [];
    SPONSORS.forEach((_, i) => list.push('ad' + i));
    list.push(...BELTS, 'belt_logo0', 'belt_logo1', 'belt_logo2');
    list.push('tyre_top', 'tyre_side', 'concrete', 'concrete_paint', 'chevron', 'boards', 'signs', 'screen', 'gantry', 'monitor', 'glass', 'pitwall', 'signs2', 'posts0', 'posts1', 'posts2');
    TEAMS.forEach((t) => list.push('team_' + t.id));
    list.forEach((n, i) => this.names.set(n, i));
    if (list.length > (this.size / this.cw) * (this.size / this.ch)) throw new Error('atlas overflow');
  }

  /** UV rectangle of a whole cell (inset to avoid bleeding). */
  cell(name: string): UVRect {
    const i = this.names.get(name);
    if (i === undefined) throw new Error('no atlas cell ' + name);
    const cx = (i % this.cols) * this.cw;
    const cy = Math.floor(i / this.cols) * this.ch;
    const pad = 3;
    return {
      u0: (cx + pad) / this.size,
      u1: (cx + this.cw - pad) / this.size,
      // CanvasTexture has flipY: canvas row 0 is v = 1
      v0: 1 - (cy + this.ch - pad) / this.size,
      v1: 1 - (cy + pad) / this.size,
    };
  }

  /** Sub-rectangle of a cell: fractions (x0..x1, y0..y1) with y measured from the cell bottom. */
  sub(name: string, x0: number, x1: number, y0: number, y1: number): UVRect {
    const c = this.cell(name);
    const du = c.u1 - c.u0, dv = c.v1 - c.v0;
    return { u0: c.u0 + du * x0, u1: c.u0 + du * x1, v0: c.v0 + dv * y0, v1: c.v0 + dv * y1 };
  }

  private origin(name: string): [number, number] {
    const i = this.names.get(name)!;
    return [(i % this.cols) * this.cw, Math.floor(i / this.cols) * this.ch];
  }

  draw() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#777';
    ctx.fillRect(0, 0, this.size, this.size);
    const W = this.cw, H = this.ch;
    SPONSORS.forEach((sp, i) => {
      const [x, y] = this.origin('ad' + i);
      drawAd(ctx, x, y, W, H, sp);
    });
    const beltCols: Record<string, string[]> = {
      belt_red: ['#b3121f'],
      belt_blue: ['#16408f'],
      belt_white: ['#e9e9e6'],
      belt_yellow: ['#f2c200'],
      belt_black: ['#1b1b1d'],
      belt_redwhite: ['#b3121f', '#e9e9e6'],
    };
    for (const b of BELTS) {
      const [x, y] = this.origin(b);
      drawBelt(ctx, x, y, W, H, beltCols[b], null);
    }
    for (let k = 0; k < 3; k++) {
      const [x, y] = this.origin('belt_logo' + k);
      const sp = SPONSORS[[0, 6, 14][k]];
      drawBelt(ctx, x, y, W, H, [sp[1]], sp);
    }
    {
      const [x, y] = this.origin('tyre_top');
      drawTyreTop(ctx, x, y, W, H);
    }
    {
      const [x, y] = this.origin('tyre_side');
      drawTyreSide(ctx, x, y, W, H);
    }
    {
      const [x, y] = this.origin('concrete');
      drawConcrete(ctx, x, y, W, H, '#8d8b86', 1);
      const [x2, y2] = this.origin('concrete_paint');
      drawConcrete(ctx, x2, y2, W, H, '#d9d7d0', 2);
    }
    {
      const [x, y] = this.origin('chevron');
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, W, H);
      ctx.clip();
      ctx.fillStyle = '#f2c200';
      ctx.fillRect(x, y, W, H);
      ctx.fillStyle = '#141414';
      for (let k = -4; k < 12; k++) {
        ctx.beginPath();
        const x0 = x + k * 64;
        ctx.moveTo(x0, y + H);
        ctx.lineTo(x0 + 32, y + H);
        ctx.lineTo(x0 + 32 + H, y);
        ctx.lineTo(x0 + H, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    {
      // braking boards: 150 / 100 / 50 / 200 — each 128×128, white with a sponsor strip
      const [x, y] = this.origin('boards');
      ['150', '100', '50', '200'].forEach((t, k) => {
        const bx = x + k * 128;
        ctx.fillStyle = '#f4f4f2';
        ctx.fillRect(bx, y, 128, 128);
        ctx.fillStyle = '#c8102e';
        ctx.fillRect(bx, y + 100, 128, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = `italic 700 20px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('VELOCE', bx + 64, y + 115);
        ctx.fillStyle = '#111111';
        ctx.font = `700 ${t.length > 2 ? 58 : 70}px ${FONT}`;
        ctx.save();
        ctx.translate(bx + 64, y + 54);
        ctx.scale(t.length > 2 ? 0.86 : 1, 1);
        ctx.fillText(t, 0, 0);
        ctx.restore();
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 4;
        ctx.strokeRect(bx + 2, y + 2, 124, 124);
      });
    }
    {
      // signs: DRS (activation), DRS detection, PIT, 80
      const [x, y] = this.origin('signs');
      const sign = (k: number, bg: string, fg: string, t: string, sz: number, t2?: string) => {
        const bx = x + k * 128;
        ctx.fillStyle = bg;
        ctx.fillRect(bx, y, 128, 128);
        ctx.strokeStyle = fg;
        ctx.lineWidth = 6;
        ctx.strokeRect(bx + 8, y + 8, 112, 112);
        ctx.fillStyle = fg;
        ctx.font = `700 ${sz}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, bx + 64, y + (t2 ? 54 : 66));
        if (t2) {
          ctx.font = `700 20px ${FONT}`;
          ctx.fillText(t2, bx + 64, y + 94);
        }
      };
      sign(0, '#0a3d91', '#ffffff', 'DRS', 50);
      sign(1, '#ffffff', '#0a3d91', 'DRS', 46, 'DETECTION');
      sign(2, '#0a3d91', '#ffffff', 'PIT', 52);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 384, y, 128, 128);
      ctx.strokeStyle = '#d0021b';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(x + 448, y + 64, 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = `700 52px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('80', x + 448, y + 68);
    }
    {
      const [x, y] = this.origin('screen');
      drawScreen(ctx, x, y, W, H);
    }
    {
      const [x, y] = this.origin('gantry');
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(x, y, W, H);
      const g = ctx.createLinearGradient(x, y, x + W, y);
      g.addColorStop(0, '#e10600');
      g.addColorStop(1, '#8a0400');
      ctx.fillStyle = g;
      ctx.fillRect(x, y + H - 22, W, 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = `italic 700 50px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(EVENT.gp, x + W / 2, y + 44, W - 30);
      ctx.font = `700 20px ${FONT}`;
      ctx.fillText(`${EVENT.place}  ·  APEX GP`, x + W / 2, y + H - 11);
    }
    {
      const [x, y] = this.origin('monitor');
      ctx.fillStyle = '#05070a';
      ctx.fillRect(x, y, W, H);
      const rng = new Rng(5);
      for (let k = 0; k < 4; k++) {
        const mx = x + 6 + k * 126;
        ctx.fillStyle = '#0b1a2a';
        ctx.fillRect(mx, y + 8, 116, 112);
        for (let r = 0; r < 9; r++) {
          ctx.fillStyle = r % 2 ? '#1f5f8f' : '#2aa4d6';
          ctx.fillRect(mx + 6, y + 14 + r * 11, 20 + rng.next() * 80, 6);
        }
        ctx.strokeStyle = '#39ff8f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let t = 0; t < 100; t += 4) ctx.lineTo(mx + 8 + t, y + 100 - Math.sin(t * 0.13 + k) * 10 - rng.next() * 6);
        ctx.stroke();
      }
    }
    {
      const [x, y] = this.origin('glass');
      const g = ctx.createLinearGradient(x, y, x, y + H);
      g.addColorStop(0, '#5a6b7a');
      g.addColorStop(1, '#1b2229');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let k = 0; k < 6; k++) ctx.fillRect(x + k * 90 + 20, y, 14, H);
    }
    {
      const [x, y] = this.origin('pitwall');
      ctx.fillStyle = '#e9e9e6';
      ctx.fillRect(x, y, W, H);
      ctx.fillStyle = '#e10600';
      ctx.fillRect(x, y + H - 26, W, 26);
      ctx.fillStyle = '#15151e';
      ctx.font = `italic 700 58px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('APEX GP', x + W / 2, y + 50);
    }
    {
      // sector boards S1/S2/S3 + a marshal-post header
      const [x, y] = this.origin('signs2');
      ['S1', 'S2', 'S3'].forEach((t, k) => {
        const bx = x + k * 128;
        ctx.fillStyle = '#15151e';
        ctx.fillRect(bx, y, 128, 128);
        ctx.fillStyle = ['#e10600', '#ffd400', '#00a3e0'][k];
        ctx.fillRect(bx, y + 104, 128, 24);
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 64px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, bx + 64, y + 54);
      });
      ctx.fillStyle = '#e8641c';
      ctx.fillRect(x + 384, y, 128, 128);
      ctx.fillStyle = '#111';
      ctx.font = `700 34px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('POST', x + 448, y + 64);
    }
    for (let c = 0; c < 3; c++) {
      // marshal post numbers: 8 per cell, 64×128 each, white on orange
      const [x, y] = this.origin('posts' + c);
      for (let k = 0; k < 8; k++) {
        const bx = x + k * 64;
        ctx.fillStyle = '#e8641c';
        ctx.fillRect(bx, y, 64, 128);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx + 4, y + 4, 56, 120);
        ctx.fillStyle = '#111111';
        const num = String(c * 8 + k + 1);
        ctx.font = `700 ${num.length > 1 ? 44 : 60}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num, bx + 32, y + 66);
      }
    }
    TEAMS.forEach((t) => {
      const [x, y] = this.origin('team_' + t.id);
      ctx.fillStyle = t.primary;
      ctx.fillRect(x, y, W, H);
      ctx.fillStyle = t.secondary;
      ctx.fillRect(x, y + H - 24, W, 24);
      ctx.fillStyle = t.accent;
      ctx.fillRect(x, y + H - 30, W, 6);
      ctx.fillStyle = t.ink;
      ctx.font = `italic 700 54px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.name.toUpperCase(), x + W / 2, y + 50, W - 30);
    });
    this.texture.needsUpdate = true;
  }
}

function drawAd(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number, sp: [string, string, string, number, string]) {
  const [text, bg, fg, style, accent] = sp;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, W, H);
  ctx.clip();
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let tx = x + W / 2;
  const ty = y + H / 2 + 3;
  switch (style) {
    case 1: {
      // accent swoosh at the left
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(x, y + H);
      ctx.lineTo(x + 70, y + H);
      ctx.lineTo(x + 130, y);
      ctx.lineTo(x + 60, y);
      ctx.closePath();
      ctx.fill();
      tx = x + W / 2 + 40;
      break;
    }
    case 2: {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 10, y + 10, W - 20, H - 20);
      break;
    }
    case 3: {
      ctx.fillStyle = accent;
      ctx.fillRect(x, y + H - 16, W, 16);
      ctx.fillRect(x, y, W, 8);
      break;
    }
    case 4: {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x + 58, y + H / 2, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(x + 58, y + H / 2, 22, 0, Math.PI * 2);
      ctx.fill();
      tx = x + W / 2 + 36;
      break;
    }
    case 5: {
      // chevrons both ends
      ctx.fillStyle = accent;
      for (const side of [0, 1]) {
        for (let k = 0; k < 2; k++) {
          const bx = side ? x + W - 40 - k * 26 : x + 14 + k * 26;
          ctx.beginPath();
          const d = side ? -1 : 1;
          ctx.moveTo(bx, y + 24);
          ctx.lineTo(bx + 14 * d, y + H / 2);
          ctx.lineTo(bx, y + H - 24);
          ctx.lineTo(bx + 10 * d, y + H - 24);
          ctx.lineTo(bx + 24 * d, y + H / 2);
          ctx.lineTo(bx + 10 * d, y + 24);
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    }
    default:
      break;
  }
  ctx.fillStyle = fg;
  const size = text.length > 10 ? 58 : 76;
  ctx.font = `italic 700 ${size}px ${FONT}`;
  ctx.fillText(text, tx, ty, W - (style === 1 || style === 4 ? 150 : 50));
  ctx.restore();
}

function drawBelt(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number, cols: string[], sp: [string, string, string, number, string] | null) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, W, H);
  ctx.clip();
  // horizontal belt strips (each ~ 1/3 of the height), alternate colours if two
  const strips = 3;
  for (let k = 0; k < strips; k++) {
    ctx.fillStyle = cols[k % cols.length];
    ctx.fillRect(x, y + (k * H) / strips, W, H / strips + 1);
  }
  // rubber texture: subtle horizontal streaks
  const rng = new Rng(x * 7 + y);
  for (let k = 0; k < 120; k++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rng.next() * 0.06})`;
    ctx.fillRect(x + rng.next() * W, y + rng.next() * H, 20 + rng.next() * 120, 1 + rng.next() * 2);
  }
  // seams between strips + bolts
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let k = 1; k < strips; k++) ctx.fillRect(x, y + (k * H) / strips - 1, W, 3);
  for (let k = 0; k < strips; k++) {
    const by = y + ((k + 0.5) * H) / strips;
    for (let bx = x + 16; bx < x + W; bx += 64) {
      ctx.fillStyle = '#9a9a9a';
      ctx.beginPath();
      ctx.arc(bx, by - 12, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx - 1, by - 12, 3, 3);
    }
  }
  if (sp) {
    ctx.fillStyle = sp[2];
    ctx.font = `italic 700 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sp[0], x + W / 2, y + H / 2 + 3, W - 40);
  }
  // scuffs from impacts, darker at the bottom
  const g = ctx.createLinearGradient(x, y, x, y + H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.05)');
  g.addColorStop(1, 'rgba(20,16,10,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, W, H);
  for (let k = 0; k < 10; k++) {
    ctx.fillStyle = `rgba(10,10,10,${0.1 + rng.next() * 0.2})`;
    ctx.fillRect(x + rng.next() * W, y + H * (0.35 + rng.next() * 0.5), 20 + rng.next() * 60, 2 + rng.next() * 4);
  }
  ctx.restore();
}

function drawTyreTop(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, W, H);
  ctx.clip();
  ctx.fillStyle = '#0c0c0d';
  ctx.fillRect(x, y, W, H);
  // 4 m × ~1.2 m: two staggered rows of 0.6 m tyres (≈ 77 px)
  const r = 37;
  for (let row = 0; row < 2; row++) {
    const cy = y + 32 + row * 64;
    for (let k = -1; k < 8; k++) {
      const cx = x + k * 74 + (row ? 37 : 0) + 30;
      const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
      g.addColorStop(0, '#050505');
      g.addColorStop(0.55, '#050505');
      g.addColorStop(0.6, '#2a2a2b');
      g.addColorStop(0.8, '#1e1e1f');
      g.addColorStop(1, '#0a0a0a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTyreSide(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, W, H);
  ctx.clip();
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(x, y, W, H);
  // 4 tyres high (each ~ 32 px), sidewalls seen edge-on as rounded bands
  for (let row = 0; row < 4; row++) {
    const ty = y + row * 32;
    for (let k = 0; k < 7; k++) {
      const tx = x + k * 77 + (row % 2 ? 38 : 0) - 20;
      const g = ctx.createLinearGradient(0, ty, 0, ty + 30);
      g.addColorStop(0, '#1d1d1e');
      g.addColorStop(0.5, '#2c2c2e');
      g.addColorStop(1, '#101011');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(tx, ty + 1, 74, 29, 12);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawConcrete(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number, base: string, seed: number) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, W, H);
  const rng = new Rng(seed * 31);
  for (let k = 0; k < 900; k++) {
    const l = rng.next();
    ctx.fillStyle = l < 0.5 ? `rgba(0,0,0,${0.03 + rng.next() * 0.05})` : `rgba(255,255,255,${0.02 + rng.next() * 0.04})`;
    ctx.fillRect(x + rng.next() * W, y + rng.next() * H, 1 + rng.next() * 3, 1 + rng.next() * 3);
  }
  // rain streaks + rubber scuffs near the bottom
  for (let k = 0; k < 18; k++) {
    ctx.fillStyle = `rgba(40,35,30,${0.05 + rng.next() * 0.08})`;
    ctx.fillRect(x + rng.next() * W, y, 2 + rng.next() * 6, H * (0.3 + rng.next() * 0.7));
  }
  if (seed === 2) {
    // tyre scuffs on the track-facing painted concrete
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `rgba(10,10,10,${0.08 + rng.next() * 0.14})`;
      ctx.fillRect(x + rng.next() * W, y + H * (0.6 + rng.next() * 0.3), 30 + rng.next() * 90, 1 + rng.next() * 3);
    }
  }
  // panel joints every 2 m (128 px)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = 0; k <= 4; k++) ctx.fillRect(x + k * 128 - 1, y, 2, H);
}

function drawScreen(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, H: number) {
  ctx.fillStyle = '#020304';
  ctx.fillRect(x, y, W, H);
  ctx.fillStyle = '#e10600';
  ctx.fillRect(x + 6, y + 6, 150, 26);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 20px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('LAP 1 / 58', x + 14, y + 20);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd400';
  ctx.fillText(EVENT.place, x + W - 10, y + 20);
  const rows = TEAMS.slice(0, 6);
  rows.forEach((t, k) => {
    const col = k % 2;
    const row = Math.floor(k / 2);
    const bx = x + 10 + col * 250;
    const by = y + 46 + row * 26;
    ctx.fillStyle = t.primary;
    ctx.fillRect(bx, by - 9, 6, 18);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(`${k + 1}  ${t.drivers[0].code}`, bx + 14, by);
    ctx.fillStyle = '#9fe870';
    ctx.textAlign = 'right';
    ctx.fillText(k === 0 ? '1:21.408' : `+${(k * 0.731 + 0.214).toFixed(3)}`, bx + 230, by);
  });
}

// ------------------------------------------------------------------ decals

export class DecalAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  static readonly SIZE = 1024;

  constructor(aniso: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = DecalAtlas.SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = aniso;
    this.texture.premultiplyAlpha = false;
    this.draw();
  }

  /** pixel rect → uv rect (flipY) */
  private rect(px: number, py: number, pw: number, ph: number, pad = 2): UVRect {
    const S = DecalAtlas.SIZE;
    return { u0: (px + pad) / S, u1: (px + pw - pad) / S, v0: 1 - (py + ph - pad) / S, v1: 1 - (py + pad) / S };
  }
  /** grid number 1..20: 128×128 cells, rows 0..2 */
  number(k: number): UVRect {
    const i = k - 1;
    return this.rect((i % 8) * 128, Math.floor(i / 8) * 128, 128, 128);
  }
  get pit(): UVRect {
    return this.rect(0, 384, 256, 128);
  }
  get eighty(): UVRect {
    return this.rect(256, 384, 128, 128);
  }
  get white(): UVRect {
    return this.rect(400, 400, 96, 96, 24);
  }
  get chequer(): UVRect {
    return this.rect(512, 384, 512, 64, 0);
  }
  get streak(): UVRect {
    return this.rect(512, 448, 512, 64, 2);
  }
  /** painted run-off logos (white on transparent, 4:1), k = 0..1 */
  logo(k: number): UVRect {
    return this.rect(0, 512 + k * 256, 1024, 256, 4);
  }

  draw() {
    const ctx = this.canvas.getContext('2d')!;
    const S = DecalAtlas.SIZE;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 1; k <= 20; k++) {
      const i = k - 1;
      const x = (i % 8) * 128, y = Math.floor(i / 8) * 128;
      ctx.font = `700 ${k >= 10 ? 104 : 118}px ${FONT}`;
      ctx.save();
      ctx.translate(x + 64, y + 68);
      ctx.scale(k >= 10 ? 0.78 : 0.9, 1);
      ctx.fillText(String(k), 0, 0);
      ctx.restore();
    }
    ctx.font = `700 118px ${FONT}`;
    ctx.fillText('PIT', 128, 384 + 70);
    ctx.font = `700 104px ${FONT}`;
    ctx.save();
    ctx.translate(320, 384 + 70);
    ctx.scale(0.8, 1);
    ctx.fillText('80', 0, 0);
    ctx.restore();
    ctx.fillRect(384, 384, 128, 128);
    // chequer: 16 × 2 squares of 32 px
    for (let cx = 0; cx < 16; cx++)
      for (let cy = 0; cy < 2; cy++) {
        ctx.fillStyle = (cx + cy) % 2 ? '#101010' : '#ffffff';
        ctx.fillRect(512 + cx * 32, 384 + cy * 32, 32, 32);
      }
    // launch streak: soft white band (tinted dark by vertex colour), fading along its length
    const sc = document.createElement('canvas');
    sc.width = 512;
    sc.height = 64;
    const c2 = sc.getContext('2d')!;
    const g = c2.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.06, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = g;
    c2.fillRect(0, 0, 512, 64);
    c2.globalCompositeOperation = 'destination-in';
    const gv = c2.createLinearGradient(0, 0, 0, 64);
    gv.addColorStop(0, 'rgba(0,0,0,0)');
    gv.addColorStop(0.3, 'rgba(0,0,0,1)');
    gv.addColorStop(0.7, 'rgba(0,0,0,1)');
    gv.addColorStop(1, 'rgba(0,0,0,0)');
    c2.fillStyle = gv;
    c2.fillRect(0, 0, 512, 64);
    ctx.drawImage(sc, 512, 448);
    // run-off logos: big italic sponsor names, painted white
    const logos: [string, string][] = [['VELOCE', 'swoosh'], ['APEX GP', 'chev']];
    logos.forEach(([text, style], k) => {
      const y = 512 + k * 256;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, 1024, 256);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 700 190px ${FONT}`;
      ctx.fillText(text, 512 + (style === 'swoosh' ? 60 : 0), y + 136, 880);
      if (style === 'swoosh') {
        ctx.beginPath();
        ctx.moveTo(40, y + 220);
        ctx.lineTo(150, y + 220);
        ctx.lineTo(250, y + 40);
        ctx.lineTo(140, y + 40);
        ctx.closePath();
        ctx.fill();
      } else {
        for (const side of [0, 1]) {
          const bx = side ? 1024 - 70 : 70;
          const d = side ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(bx, y + 50);
          ctx.lineTo(bx + 40 * d, y + 128);
          ctx.lineTo(bx, y + 206);
          ctx.lineTo(bx + 26 * d, y + 206);
          ctx.lineTo(bx + 66 * d, y + 128);
          ctx.lineTo(bx + 26 * d, y + 50);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    });
    this.texture.needsUpdate = true;
  }
}
