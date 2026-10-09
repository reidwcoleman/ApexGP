import * as THREE from 'three';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import { TEAMS } from '../../race/Teams.ts';
import { canvas2d, canvasTexture } from './textures.ts';
import { printWear } from '../brands.ts';
import { drawCreative } from '../adCreative.ts';
import { roster } from '../partners.ts';

/**
 * Canvas-drawn boards: grandstand fascia sponsors, team name boards for the pit
 * building, the race-control logo. All brands are fictional. Textures are drawn
 * immediately with a fallback font and redrawn once Titillium Web has loaded.
 */

/**
 * The fascia boards (grandstands, the banking, the landmarks take them in turn): the circuit's
 * partners (partners.ts), the promoter's local partners on every other board — the stands are the
 * promoter's to sell (docs/F1_ADVERTISING.md §1, §5) — between the title partner, the big series
 * contracts and the series' own board. Keys into the roster; 'series' is the series' own board.
 */
const FASCIA: string[] = [
  'title', '@0', 'lager', '@1', 'timing', '@2', 'logistics', '@3', 'series',
  '@4', 'airline', '@5', 'energy', 'title', 'tyres', '@0', 'cruise', 'champagne',
];
const SERIES_BOARD = { name: 'APEX GP', bg: '#111317', fg: '#ffffff', accent: '#e10600' };

const ATLAS_W = 2048;
const BOARD_H = 128;
const BOARDS_PER_ROW = 2;
export const SPONSOR_ROWS = Math.ceil(FASCIA.length / BOARDS_PER_ROW);

let _sponsor: THREE.CanvasTexture | null = null;
/** the circuit whose partners the fascia atlas shows */
let _sponsorFor = '';
let _teams: THREE.CanvasTexture | null = null;

function font(size: number, weight = 900) {
  return `${weight} ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
}

function drawBoard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: typeof SERIES_BOARD) {
  ctx.fillStyle = s.bg;
  ctx.fillRect(x, y, w, h);
  if (s.accent) {
    ctx.fillStyle = s.accent;
    ctx.fillRect(x, y + h - 14, w, 14);
  }
  ctx.fillStyle = s.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = h * 0.72;
  ctx.font = font(size);
  while (ctx.measureText(s.name).width > w * 0.86 && size > 20) {
    size -= 4;
    ctx.font = font(size);
  }
  ctx.fillText(s.name, x + w / 2, y + h / 2 + 4);
}

function drawSponsors(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const w = ATLAS_W / BOARDS_PER_ROW;
  const R = roster();
  _sponsorFor = R.id;
  FASCIA.forEach((key, i) => {
    const col = i % BOARDS_PER_ROW;
    const row = Math.floor(i / BOARDS_PER_ROW);
    // (the series' own board keeps its livery; the rest are the circuit's partners, as long bands)
    if (key === 'series') drawBoard(ctx, col * w, row * BOARD_H, w, BOARD_H, SERIES_BOARD);
    else drawCreative(ctx, col * w, row * BOARD_H, w, BOARD_H, R.b(key[0] === '@' ? R.local[Number(key.slice(1)) % R.local.length] : key), i % 3);
    printWear(ctx, col * w, row * BOARD_H, w, BOARD_H, 211 + i, 0.8);
  });
}

/** Sponsor atlas: 2 boards per row, 128 px tall. UV of board k via sponsorUV(). */
export function sponsorTexture(): THREE.CanvasTexture {
  if (_sponsor) {
    // (kept across circuit switches: repainted with the new circuit's partners)
    if (_sponsorFor !== roster().id) {
      drawSponsors(_sponsor.image as HTMLCanvasElement);
      _sponsor.needsUpdate = true;
    }
    return _sponsor;
  }
  const { canvas } = canvas2d(ATLAS_W, SPONSOR_ROWS * BOARD_H);
  drawSponsors(canvas);
  _sponsor = canvasTexture(canvas, true, 8);
  whenFonts(() => {
    drawSponsors(canvas);
    _sponsor!.needsUpdate = true;
  });
  return _sponsor;
}

export function sponsorUV(k: number): [number, number, number, number] {
  const i = ((k % FASCIA.length) + FASCIA.length) % FASCIA.length;
  const col = i % BOARDS_PER_ROW;
  const row = Math.floor(i / BOARDS_PER_ROW);
  const u0 = col / BOARDS_PER_ROW, u1 = (col + 1) / BOARDS_PER_ROW;
  const H = SPONSOR_ROWS;
  // canvas row 0 is at the top → v = 1
  const v1 = 1 - row / H, v0 = 1 - (row + 1) / H;
  return [u0 + 0.002, v0 + 0.004, u1 - 0.002, v1 - 0.004];
}

function drawTeams(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const h = 128;
  TEAMS.forEach((t, i) => {
    const y = i * h;
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(0, y, 1024, h);
    ctx.fillStyle = t.primary;
    ctx.fillRect(0, y, 1024, 14);
    ctx.fillRect(0, y + h - 10, 1024, 10);
    ctx.fillStyle = t.accent;
    ctx.fillRect(0, y + 14, 36, h - 24);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font(70);
    ctx.fillText(t.name.toUpperCase(), 64, y + h / 2 + 3);
    ctx.font = font(40, 700);
    ctx.textAlign = 'right';
    ctx.fillStyle = t.primary === '#0d0f12' || t.primary === '#061a40' ? t.secondary : t.primary;
    ctx.fillText(t.sponsor, 1000, y + h / 2 + 3);
  });
}

/** Team boards: one 1024×128 row per team (TEAMS order). */
export function teamBoardTexture(): THREE.CanvasTexture {
  if (_teams) return _teams;
  const { canvas } = canvas2d(1024, 128 * TEAMS.length);
  drawTeams(canvas);
  _teams = canvasTexture(canvas, true, 8);
  whenFonts(() => {
    drawTeams(canvas);
    _teams!.needsUpdate = true;
  });
  return _teams;
}

export function teamUV(i: number): [number, number, number, number] {
  const n = TEAMS.length;
  return [0, 1 - (i + 1) / n + 0.002, 1, 1 - i / n - 0.002];
}

let fontsReady: Promise<unknown> | null = null;
function whenFonts(fn: () => void) {
  if (typeof document === 'undefined' || !document.fonts) return;
  if (!fontsReady) fontsReady = Promise.all([document.fonts.load(font(64)), document.fonts.load(font(64, 700))]);
  fontsReady.then(fn).catch(() => {});
}
