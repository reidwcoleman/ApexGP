import * as THREE from 'three';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/700-italic.css';
import '@fontsource/titillium-web/400.css';
import '@fontsource/jetbrains-mono/700.css';
import { TEAMS, type Team } from '../../race/Teams.ts';
import type { UVRect } from './geo.ts';
import { rng } from './geo.ts';

/**
 * Canvas-drawn textures for the pit complex (all fictional branding):
 *   PrintAtlas — fascia boards, garage back walls, sponsors, screens, truck liveries
 *   DecalAtlas — paint on the ground: team names, emblems, 80 km/h, PIT EXIT, arrows
 *   noise      — tiling RGBA value noise for the ground shader
 *   fence      — chain-link mesh (alpha)
 */

const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';
const MONO = '"JetBrains Mono", Menlo, monospace';

export const SPONSORS = ['VELOCE', 'QUANTA', 'KRAFT ENERGY', 'ORBIT', 'ARBOR', 'CIELO', 'NORTHWIND', 'IRONCLAD', 'PULSAR', 'AXIOM', 'APEX GP', 'MONZA'];

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

abstract class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  protected cells = new Map<string, Cell>();
  constructor(w: number, h: number, aniso: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = aniso;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  protected cell(name: string, x: number, y: number, w: number, h: number) {
    this.cells.set(name, { x, y, w, h });
  }
  /** uv rect of a named cell (inset by `pad` px) */
  uv(name: string, pad = 1.5): UVRect {
    const c = this.cells.get(name);
    if (!c) throw new Error('atlas cell ' + name);
    const W = this.canvas.width, H = this.canvas.height;
    return [(c.x + pad) / W, 1 - (c.y + c.h - pad) / H, (c.x + c.w - pad) / W, 1 - (c.y + pad) / H];
  }
  /** sub-rect of a cell in 0..1 cell coordinates (y down) */
  sub(name: string, u0: number, v0: number, u1: number, v1: number): UVRect {
    const c = this.cells.get(name)!;
    const W = this.canvas.width, H = this.canvas.height;
    return [(c.x + c.w * u0) / W, 1 - (c.y + c.h * v1) / H, (c.x + c.w * u1) / W, 1 - (c.y + c.h * v0) / H];
  }
  abstract draw(): void;
}

// ------------------------------------------------------------------ helpers

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
/** a light colour that reads on the team's primary */
function inkOn(t: Team) {
  return t.ink;
}

function fitText(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, px: number) {
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > maxW) {
    px = Math.floor((px * maxW) / w);
    g.font = font(px);
  }
  return px;
}

/** abstract team emblem (fictional): a shape + the team's initial */
export function drawEmblem(g: CanvasRenderingContext2D, t: Team, k: number, cx: number, cy: number, r: number, fill: string, ink: string, outline?: string) {
  g.save();
  g.translate(cx, cy);
  g.beginPath();
  const shape = k % 6;
  if (shape === 0) {
    // shield
    g.moveTo(-r * 0.8, -r * 0.85);
    g.lineTo(r * 0.8, -r * 0.85);
    g.lineTo(r * 0.8, r * 0.1);
    g.quadraticCurveTo(r * 0.7, r * 0.75, 0, r);
    g.quadraticCurveTo(-r * 0.7, r * 0.75, -r * 0.8, r * 0.1);
    g.closePath();
  } else if (shape === 1) {
    g.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  } else if (shape === 2) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    }
    g.closePath();
  } else if (shape === 3) {
    g.moveTo(0, -r);
    g.lineTo(r, 0);
    g.lineTo(0, r);
    g.lineTo(-r, 0);
    g.closePath();
  } else if (shape === 4) {
    // chevron badge
    g.moveTo(-r, -r * 0.6);
    g.lineTo(0, -r * 0.1);
    g.lineTo(r, -r * 0.6);
    g.lineTo(r, r * 0.35);
    g.lineTo(0, r);
    g.lineTo(-r, r * 0.35);
    g.closePath();
  } else {
    // rounded square
    const q = r * 0.85;
    g.roundRect(-q, -q, q * 2, q * 2, r * 0.3);
  }
  g.fillStyle = fill;
  g.fill();
  if (outline) {
    g.lineWidth = r * 0.1;
    g.strokeStyle = outline;
    g.stroke();
  }
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 700 ${Math.round(r * 1.15)}px ${FONT}`;
  g.fillText(t.short[0], 0, r * 0.06);
  g.restore();
}

// ------------------------------------------------------------------ print atlas

export class PrintAtlas extends Atlas {
  constructor(aniso: number) {
    super(2048, 2560, aniso);
    TEAMS.forEach((_, k) => this.cell('fascia' + k, (k % 2) * 1024, Math.floor(k / 2) * 128, 1024, 128));
    for (let k = 0; k < 12; k++) this.cell('back' + k, (k % 4) * 512, 640 + Math.floor(k / 4) * 256, 512, 256);
    SPONSORS.forEach((_, k) => this.cell('sp' + k, (k % 4) * 512, 1408 + Math.floor(k / 4) * 128, 512, 128));
    const scr = ['mon0', 'mon1', 'mon2', 'mon3', 'tv', 'sign80', 'signEnd', 'light'];
    scr.forEach((n, k) => this.cell(n, k * 256, 1792, 256, 256));
    TEAMS.forEach((_, k) => this.cell('truck' + k, (k % 4) * 512, 2048 + Math.floor(k / 4) * 128, 512, 128));
    ['pitexit', 'podium', 'paddock', 'timing'].forEach((n, k) => this.cell(n, 1024 + (k % 2) * 512, 2048 + 256 + Math.floor(k / 2) * 128, 512, 128));
    this.cell('pitin', 0, 2432, 512, 128);
    // back10 = podium backdrop, back11 = big timing screen
    this.draw();
  }

  draw() {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.fillStyle = '#202226';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    TEAMS.forEach((t, k) => {
      this.fascia(t, k);
      this.back(t, k);
      this.truck(t, k);
    });
    SPONSORS.forEach((s, k) => this.sponsor(s, k));
    for (let k = 0; k < 4; k++) this.monitor(k);
    this.tv();
    this.sign80(false);
    this.sign80(true);
    this.lightCell();
    this.banner('pitexit', 'PIT EXIT', '#101216', '#ffffff', true);
    this.banner('pitin', 'PIT IN', '#101216', '#ffffff', true);
    this.banner('podium', 'GRAN PREMIO · MONZA', '#b0001e', '#ffffff', false);
    this.banner('paddock', 'PADDOCK CLUB', '#15181d', '#e8e8e8', false);
    this.banner('timing', 'LIVE TIMING', '#050608', '#ffd21f', false);
    this.podiumBackdrop();
    this.timingBoard();
    this.texture.needsUpdate = true;
  }

  private at(name: string) {
    return this.cells.get(name)!;
  }

  private fascia(t: Team, k: number) {
    const c = this.at('fascia' + k);
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    const grd = g.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
    grd.addColorStop(0, t.primary);
    grd.addColorStop(1, hexA(t.primary, 0.82));
    g.fillStyle = '#0c0d10';
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = grd;
    g.fillRect(c.x, c.y, c.w, c.h);
    // secondary sweep
    g.fillStyle = t.secondary;
    g.beginPath();
    g.moveTo(c.x + c.w * 0.64, c.y + c.h);
    g.lineTo(c.x + c.w * 0.72, c.y);
    g.lineTo(c.x + c.w, c.y);
    g.lineTo(c.x + c.w, c.y + c.h);
    g.fill();
    g.fillStyle = t.accent;
    g.beginPath();
    g.moveTo(c.x + c.w * 0.62, c.y + c.h);
    g.lineTo(c.x + c.w * 0.7, c.y);
    g.lineTo(c.x + c.w * 0.715, c.y);
    g.lineTo(c.x + c.w * 0.635, c.y + c.h);
    g.fill();
    drawEmblem(g, t, k, c.x + 70, c.y + c.h / 2, 44, t.secondary === t.primary ? '#ffffff' : t.secondary, t.accent, t.ink);
    g.fillStyle = inkOn(t);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    fitText(g, t.name.toUpperCase(), (px) => `italic 700 ${px}px ${FONT}`, c.w * 0.5, 74);
    g.fillText(t.name.toUpperCase(), c.x + 132, c.y + c.h / 2 + 4);
    // sponsor on the sweep
    g.fillStyle = lum(t.secondary) > 0.55 ? '#111' : '#fff';
    g.textAlign = 'center';
    fitText(g, t.sponsor, (px) => `700 ${px}px ${FONT}`, c.w * 0.24, 52);
    g.fillText(t.sponsor, c.x + c.w * 0.86, c.y + c.h / 2 + 3);
    g.restore();
  }

  private back(t: Team, k: number) {
    const c = this.at('back' + k);
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    // dark partition panels with the team colour washing across
    const grd = g.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
    grd.addColorStop(0, t.primary);
    grd.addColorStop(0.55, hexA(t.primary, 0.9));
    grd.addColorStop(1, t.secondary);
    g.fillStyle = grd;
    g.fillRect(c.x, c.y, c.w, c.h);
    // panel joints
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < c.w; x += 64) g.fillRect(c.x + x, c.y, 2, c.h);
    g.fillRect(c.x, c.y + c.h * 0.72, c.w, 2);
    // accent slashes
    g.fillStyle = t.accent;
    for (let i = 0; i < 3; i++) {
      const x0 = c.x + c.w * (0.66 + i * 0.06);
      g.beginPath();
      g.moveTo(x0, c.y + c.h * 0.72);
      g.lineTo(x0 + 36, c.y);
      g.lineTo(x0 + 48, c.y);
      g.lineTo(x0 + 12, c.y + c.h * 0.72);
      g.fill();
    }
    drawEmblem(g, t, k, c.x + 92, c.y + 90, 58, t.secondary, t.accent, t.ink);
    g.fillStyle = t.ink;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    fitText(g, t.short, (px) => `italic 700 ${px}px ${FONT}`, c.w * 0.5, 70);
    g.fillText(t.short, c.x + 170, c.y + 74);
    g.font = `700 22px ${FONT}`;
    g.fillStyle = hexA(t.ink, 0.8);
    g.fillText('FORMULA ONE TEAM', c.x + 172, c.y + 118);
    // partner strip
    g.fillStyle = 'rgba(8,9,11,0.82)';
    g.fillRect(c.x, c.y + c.h * 0.72, c.w, c.h * 0.28);
    g.fillStyle = '#e9ebee';
    g.textAlign = 'center';
    const partners = [t.sponsor, SPONSORS[(k + 3) % 10], SPONSORS[(k + 6) % 10]];
    partners.forEach((p, i) => {
      fitText(g, p, (px) => `700 ${px}px ${FONT}`, c.w / 3 - 20, 30);
      g.fillText(p, c.x + (c.w / 3) * (i + 0.5), c.y + c.h * 0.86);
    });
    g.restore();
  }

  private truck(t: Team, k: number) {
    const c = this.at('truck' + k);
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    g.fillStyle = t.primary;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = t.secondary;
    g.beginPath();
    g.moveTo(c.x, c.y + c.h);
    g.lineTo(c.x + c.w * 0.55, c.y + c.h);
    g.lineTo(c.x + c.w * 0.35, c.y + c.h * 0.55);
    g.lineTo(c.x, c.y + c.h * 0.55);
    g.fill();
    g.fillStyle = t.accent;
    g.fillRect(c.x, c.y + c.h * 0.5, c.w * 0.37, 4);
    g.fillStyle = t.ink;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    fitText(g, t.name.toUpperCase(), (px) => `italic 700 ${px}px ${FONT}`, c.w * 0.55, 44);
    g.fillText(t.name.toUpperCase(), c.x + c.w - 22, c.y + c.h * 0.36);
    g.font = `700 22px ${FONT}`;
    g.fillStyle = hexA(t.ink, 0.85);
    g.fillText(t.sponsor, c.x + c.w - 24, c.y + c.h * 0.72);
    drawEmblem(g, t, k, c.x + 50, c.y + c.h * 0.3, 26, t.secondary, t.accent);
    g.restore();
  }

  private sponsor(name: string, k: number) {
    const c = this.at('sp' + k);
    const g = this.ctx;
    const palettes = [
      ['#c8102e', '#ffffff'], ['#0d0f12', '#00d2be'], ['#ffcc00', '#1b2552'], ['#101216', '#ff7a00'], ['#00574b', '#cedc00'],
      ['#0a5cc2', '#ffffff'], ['#061a40', '#00a3e0'], ['#f2f2f2', '#141414'], ['#1434cb', '#ffffff'], ['#0a0a0a', '#ff2a1f'],
      ['#101216', '#ffffff'], ['#008c45', '#ffffff'],
    ];
    const [bg, fg] = palettes[k % palettes.length];
    g.save();
    g.fillStyle = bg;
    g.fillRect(c.x, c.y, c.w, c.h);
    if (name === 'MONZA') {
      // tricolore band
      g.fillStyle = '#008c45';
      g.fillRect(c.x, c.y, c.w / 3, c.h);
      g.fillStyle = '#f4f5f0';
      g.fillRect(c.x + c.w / 3, c.y, c.w / 3, c.h);
      g.fillStyle = '#cd212a';
      g.fillRect(c.x + (2 * c.w) / 3, c.y, c.w / 3, c.h);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(c.x, c.y + c.h * 0.18, c.w, c.h * 0.64);
    }
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, name, (px) => `italic 700 ${px}px ${FONT}`, c.w - 50, 84);
    g.fillText(name, c.x + c.w / 2, c.y + c.h / 2 + 4);
    g.restore();
  }

  private monitor(k: number) {
    const c = this.at('mon' + k);
    const g = this.ctx;
    const r = rng(77 + k * 13);
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    g.fillStyle = '#05070b';
    g.fillRect(c.x, c.y, c.w, c.h);
    if (k === 0 || k === 2) {
      // telemetry traces
      const cols = ['#27e36b', '#ff3b3b', '#ffd21f', '#3fa7ff'];
      for (let row = 0; row < 3; row++) {
        const y0 = c.y + 18 + row * 78;
        g.strokeStyle = 'rgba(120,140,170,0.35)';
        g.lineWidth = 1;
        g.strokeRect(c.x + 8, y0, c.w - 16, 66);
        g.strokeStyle = cols[(row + k) % 4];
        g.lineWidth = 2;
        g.beginPath();
        let v = 0.5;
        for (let x = 0; x <= c.w - 20; x += 3) {
          v += (r() - 0.5) * 0.18;
          if (row === 0) v = 0.5 + 0.4 * Math.sin(x * 0.05 + k) * Math.sign(Math.sin(x * 0.013));
          v = Math.max(0.05, Math.min(0.95, v));
          const yy = y0 + 62 - v * 58;
          if (x === 0) g.moveTo(c.x + 10 + x, yy);
          else g.lineTo(c.x + 10 + x, yy);
        }
        g.stroke();
      }
    } else if (k === 1) {
      // timing list
      g.font = `700 17px ${MONO}`;
      g.textBaseline = 'top';
      const order = [2, 0, 3, 1, 4, 6, 5, 8, 7, 9];
      order.forEach((ti, i) => {
        const t = TEAMS[ti];
        const y = c.y + 8 + i * 24;
        g.fillStyle = i % 2 ? '#0b1018' : '#0f1520';
        g.fillRect(c.x + 4, y - 2, c.w - 8, 22);
        g.fillStyle = t.primary;
        g.fillRect(c.x + 36, y, 5, 18);
        g.fillStyle = '#e8ecf2';
        g.fillText(String(i + 1).padStart(2, ' '), c.x + 8, y + 1);
        g.fillText(t.drivers[i % 2].code, c.x + 48, y + 1);
        g.fillStyle = i === 0 ? '#b36bff' : i < 4 ? '#27e36b' : '#ffd21f';
        g.fillText(i === 0 ? '1:21.046' : '+' + (i * 1.83 + r()).toFixed(3), c.x + 118, y + 1);
      });
    } else {
      // track map + sector bars
      g.strokeStyle = '#e8ecf2';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(c.x + 60, c.y + 210);
      g.lineTo(c.x + 60, c.y + 60);
      g.quadraticCurveTo(c.x + 70, c.y + 30, c.x + 120, c.y + 36);
      g.lineTo(c.x + 200, c.y + 60);
      g.quadraticCurveTo(c.x + 226, c.y + 90, c.x + 190, c.y + 120);
      g.lineTo(c.x + 150, c.y + 170);
      g.quadraticCurveTo(c.x + 120, c.y + 226, c.x + 60, c.y + 210);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        g.fillStyle = TEAMS[i].primary;
        g.beginPath();
        g.arc(c.x + 60 + ((i * 37) % 140), c.y + 60 + ((i * 53) % 140), 7, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#27e36b';
      g.fillRect(c.x + 10, c.y + 10, 70, 10);
      g.fillStyle = '#b36bff';
      g.fillRect(c.x + 86, c.y + 10, 70, 10);
      g.fillStyle = '#ffd21f';
      g.fillRect(c.x + 162, c.y + 10, 70, 10);
    }
    // bezel glow
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 6;
    g.strokeRect(c.x + 3, c.y + 3, c.w - 6, c.h - 6);
    g.restore();
  }

  private tv() {
    const c = this.at('tv');
    const g = this.ctx;
    g.save();
    const sky = g.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
    sky.addColorStop(0, '#6da3dc');
    sky.addColorStop(0.45, '#cfe2f2');
    sky.addColorStop(0.46, '#3c5d2a');
    sky.addColorStop(1, '#2e4a21');
    g.fillStyle = sky;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = '#3b3d42';
    g.beginPath();
    g.moveTo(c.x, c.y + c.h);
    g.lineTo(c.x + c.w * 0.44, c.y + c.h * 0.47);
    g.lineTo(c.x + c.w * 0.56, c.y + c.h * 0.47);
    g.lineTo(c.x + c.w, c.y + c.h);
    g.fill();
    g.fillStyle = '#c8102e';
    g.fillRect(c.x + c.w * 0.44, c.y + c.h * 0.68, 34, 16);
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(c.x + 8, c.y + 8, 110, 26);
    g.fillStyle = '#fff';
    g.font = `700 16px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText('LAP 23 / 53', c.x + 16, c.y + 21);
    g.restore();
  }

  private sign80(end: boolean) {
    const c = this.at(end ? 'signEnd' : 'sign80');
    const g = this.ctx;
    g.save();
    g.fillStyle = '#f4f4f2';
    g.fillRect(c.x, c.y, c.w, c.h);
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    g.beginPath();
    g.arc(cx, cy, 112, 0, Math.PI * 2);
    g.fillStyle = end ? '#f4f4f2' : '#d10f1c';
    g.fill();
    g.beginPath();
    g.arc(cx, cy, end ? 112 : 88, 0, Math.PI * 2);
    g.fillStyle = '#f4f4f2';
    g.fill();
    if (end) {
      g.lineWidth = 6;
      g.strokeStyle = '#222';
      g.stroke();
    }
    g.fillStyle = end ? '#555' : '#111';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 104px ${FONT}`;
    g.fillText('80', cx, cy + 6);
    if (end) {
      g.strokeStyle = '#222';
      g.lineWidth = 14;
      for (const d of [-26, 0, 26]) {
        g.beginPath();
        g.moveTo(cx - 80 + d, cy + 80 + d);
        g.lineTo(cx + 80 + d, cy - 80 + d);
        g.stroke();
      }
    }
    g.restore();
  }

  private lightCell() {
    // soft round lamp: used for light fixtures seen from below and signal lamps
    const c = this.at('light');
    const g = this.ctx;
    g.save();
    g.fillStyle = '#000';
    g.fillRect(c.x, c.y, c.w, c.h);
    const grd = g.createRadialGradient(c.x + c.w / 2, c.y + c.h / 2, 4, c.x + c.w / 2, c.y + c.h / 2, c.w / 2);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.55, '#f2f2f2');
    grd.addColorStop(0.75, '#555');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.restore();
  }

  private banner(name: string, text: string, bg: string, fg: string, arrow: boolean) {
    const c = this.at(name);
    const g = this.ctx;
    g.save();
    g.fillStyle = bg;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, text, (px) => `italic 700 ${px}px ${FONT}`, c.w - (arrow ? 140 : 40), 76);
    g.fillText(text, c.x + c.w / 2 - (arrow ? 40 : 0), c.y + c.h / 2 + 4);
    if (arrow) {
      g.beginPath();
      const ax = c.x + c.w - 80, ay = c.y + c.h / 2;
      g.moveTo(ax - 30, ay - 34);
      g.lineTo(ax + 20, ay);
      g.lineTo(ax - 30, ay + 34);
      g.lineTo(ax - 30, ay + 14);
      g.lineTo(ax - 60, ay + 14);
      g.lineTo(ax - 60, ay - 14);
      g.lineTo(ax - 30, ay - 14);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  private podiumBackdrop() {
    const c = this.at('back10');
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    const grd = g.createLinearGradient(c.x, c.y, c.x + c.w, c.y);
    grd.addColorStop(0, '#8e0016');
    grd.addColorStop(1, '#d0102a');
    g.fillStyle = grd;
    g.fillRect(c.x, c.y, c.w, c.h);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = -4; i < 12; i++) {
      g.beginPath();
      g.moveTo(c.x + i * 60, c.y + c.h);
      g.lineTo(c.x + i * 60 + 120, c.y);
      g.lineTo(c.x + i * 60 + 150, c.y);
      g.lineTo(c.x + i * 60 + 30, c.y + c.h);
      g.fill();
    }
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 700 88px ${FONT}`;
    g.fillText('MONZA', c.x + c.w / 2, c.y + 100);
    g.font = `700 30px ${FONT}`;
    g.fillText('GRAN PREMIO D’ITALIA', c.x + c.w / 2, c.y + 170);
    g.fillStyle = '#008c45';
    g.fillRect(c.x + c.w / 2 - 90, c.y + 200, 60, 10);
    g.fillStyle = '#f4f5f0';
    g.fillRect(c.x + c.w / 2 - 30, c.y + 200, 60, 10);
    g.fillStyle = '#cd212a';
    g.fillRect(c.x + c.w / 2 + 30, c.y + 200, 60, 10);
    g.restore();
  }

  private timingBoard() {
    const c = this.at('back11');
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    g.fillStyle = '#030406';
    g.fillRect(c.x, c.y, c.w, c.h);
    g.font = `700 19px ${MONO}`;
    g.textBaseline = 'top';
    const order = [4, 0, 6, 2, 1, 3, 10, 7, 5, 8, 12, 14, 9, 11, 16, 13, 15, 18, 17, 19];
    order.forEach((ei, i) => {
      const t = TEAMS[Math.floor(ei / 2)];
      const d = t.drivers[ei % 2];
      const col = Math.floor(i / 10), row = i % 10;
      const x = c.x + 8 + col * 252, y = c.y + 8 + row * 24.5;
      g.fillStyle = row % 2 ? '#0a0d13' : '#0e131b';
      g.fillRect(x, y - 1, 244, 23);
      g.fillStyle = '#ffd21f';
      g.fillText(String(i + 1).padStart(2, ' '), x + 4, y + 1);
      g.fillStyle = t.primary;
      g.fillRect(x + 32, y + 1, 5, 19);
      g.fillStyle = '#f2f4f8';
      g.fillText(d.code, x + 44, y + 1);
      g.fillStyle = i === 0 ? '#f2f4f8' : '#b8c0cc';
      g.fillText(i === 0 ? 'LAP 23' : '+' + (i * 1.61 + 0.3 * Math.sin(i * 7)).toFixed(3), x + 110, y + 1);
    });
    g.restore();
  }
}

// ------------------------------------------------------------------ ground paint atlas

export class DecalAtlas extends Atlas {
  constructor(aniso: number) {
    super(2048, 1024, aniso);
    TEAMS.forEach((_, k) => this.cell('name' + k, (k % 4) * 512, Math.floor(k / 4) * 128, 512, 128));
    this.cell('white', 1024 + 8, 256 + 8, 48, 48);
    this.cell('lim80', 1024 + 64, 256, 256, 128);
    this.cell('pit', 1024 + 320, 256, 512, 128);
    TEAMS.forEach((_, k) => this.cell('logo' + k, k * 128, 384, 128, 128));
    this.cell('arrow', 1280, 384, 128, 128);
    this.cell('hatch', 1408, 384, 128, 128);
    this.cell('pitexit', 0, 512, 512, 128);
    this.cell('pitentry', 512, 512, 512, 128);
    this.draw();
  }

  draw() {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    TEAMS.forEach((t, k) => {
      const c = this.cells.get('name' + k)!;
      g.save();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, t.short, (px) => `italic 700 ${px}px ${FONT}`, c.w - 30, 118);
      g.fillText(t.short, c.x + c.w / 2, c.y + c.h / 2 + 6);
      g.restore();
      const l = this.cells.get('logo' + k)!;
      // emblem in white (tinted by vertex colour) — drawn as a solid shape with the initial knocked out
      g.save();
      drawEmblem(g, t, k, l.x + 64, l.y + 64, 58, '#ffffff', 'rgba(0,0,0,1)');
      g.restore();
    });
    // knock out the emblem initials (destination-out) so paint shows the tarmac
    g.save();
    g.globalCompositeOperation = 'destination-out';
    TEAMS.forEach((t, k) => {
      const l = this.cells.get('logo' + k)!;
      g.fillStyle = '#000';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `italic 700 ${Math.round(58 * 1.15)}px ${FONT}`;
      g.fillText(t.short[0], l.x + 64, l.y + 64 + 58 * 0.06);
    });
    g.restore();
    const w = this.cells.get('white')!;
    g.fillStyle = '#fff';
    g.fillRect(w.x - 8, w.y - 8, w.w + 16, w.h + 16);
    {
      const c = this.cells.get('lim80')!;
      g.save();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 120px ${FONT}`;
      g.fillText('80', c.x + c.w / 2, c.y + c.h / 2 + 8);
      g.restore();
    }
    for (const [n, txt] of [['pit', 'PIT'], ['pitexit', 'PIT EXIT'], ['pitentry', 'PIT ENTRY']] as const) {
      const c = this.cells.get(n)!;
      g.save();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, txt, (px) => `700 ${px}px ${FONT}`, c.w - 20, 120);
      g.fillText(txt, c.x + c.w / 2, c.y + c.h / 2 + 8);
      g.restore();
    }
    {
      const c = this.cells.get('arrow')!;
      g.save();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(c.x + 64, c.y + 6);
      g.lineTo(c.x + 120, c.y + 62);
      g.lineTo(c.x + 84, c.y + 62);
      g.lineTo(c.x + 84, c.y + 122);
      g.lineTo(c.x + 44, c.y + 122);
      g.lineTo(c.x + 44, c.y + 62);
      g.lineTo(c.x + 8, c.y + 62);
      g.closePath();
      g.fill();
      g.restore();
    }
    {
      const c = this.cells.get('hatch')!;
      g.save();
      g.beginPath();
      g.rect(c.x, c.y, c.w, c.h);
      g.clip();
      g.fillStyle = '#fff';
      for (let i = -2; i < 4; i++) {
        g.beginPath();
        g.moveTo(c.x + i * 64, c.y + c.h);
        g.lineTo(c.x + i * 64 + 128, c.y);
        g.lineTo(c.x + i * 64 + 128 + 26, c.y);
        g.lineTo(c.x + i * 64 + 26, c.y + c.h);
        g.fill();
      }
      g.restore();
    }
    this.texture.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ noise + fence

/** tiling RGBA value-noise: r fine grain, g medium blotches, b large patches, a another medium octave set */
export function noiseTexture(): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const lattice = (period: number, seed: number) => {
    const r = rng(seed);
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) v[i] = r();
    return (x: number, y: number) => {
      const fx = (x / N) * period, fy = (y / N) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => v[((j % period + period) % period) * period + ((i % period + period) % period)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    };
  };
  const fbm = (periods: number[], seed: number) => {
    const fs = periods.map((p, i) => lattice(p, seed + i * 101));
    return (x: number, y: number) => {
      let s = 0, w = 0, a = 1;
      for (const f of fs) {
        s += f(x, y) * a;
        w += a;
        a *= 0.55;
      }
      return s / w;
    };
  };
  const fine = fbm([64, 128, 256], 11);
  const med = fbm([8, 16, 32, 64], 23);
  const big = fbm([2, 4, 8, 16], 37);
  const alt = fbm([4, 8, 16, 32], 53);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, (fine(x, y) - 0.5) * 1.8 + 0.5)) * 255);
      data[i + 1] = Math.round(Math.min(1, Math.max(0, (med(x, y) - 0.5) * 1.9 + 0.5)) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, (big(x, y) - 0.5) * 2.0 + 0.5)) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, (alt(x, y) - 0.5) * 2.0 + 0.5)) * 255);
    }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function fenceTexture(aniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  // diamond chain-link: two diagonal families, 2 cells per tile
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64 + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(i * 64 + 128, 0);
    g.lineTo(i * 64, 128);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** redraw once the display fonts have loaded */
export function whenFontsReady(fn: () => void) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const ok = document.fonts.check(`italic 700 64px "Titillium Web"`) && document.fonts.check(`700 64px "Titillium Web"`);
  if (ok) return;
  Promise.all([
    document.fonts.load(`700 64px "Titillium Web"`),
    document.fonts.load(`italic 700 64px "Titillium Web"`),
    document.fonts.load(`700 16px "JetBrains Mono"`),
  ])
    .then(fn)
    .catch(() => {});
}
