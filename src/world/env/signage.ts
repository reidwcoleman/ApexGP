import * as THREE from 'three';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import { TEAMS } from '../../race/Teams.ts';
import { canvas2d, canvasTexture } from './textures.ts';

/**
 * Canvas-drawn boards: grandstand fascia sponsors, team name boards for the pit
 * building, the race-control logo. All brands are fictional. Textures are drawn
 * immediately with a fallback font and redrawn once Titillium Web has loaded.
 */

export const SPONSORS: { name: string; bg: string; fg: string; accent?: string }[] = [
  { name: 'VELOCE', bg: '#c8102e', fg: '#ffffff' },
  { name: 'QUANTA', bg: '#0d0f12', fg: '#00d2be' },
  { name: 'KRAFT ENERGY', bg: '#1b2552', fg: '#ffcc00' },
  { name: 'ORBIT', bg: '#ff7a00', fg: '#101216' },
  { name: 'ARBOR', bg: '#00574b', fg: '#cedc00' },
  { name: 'CIELO', bg: '#0a5cc2', fg: '#ffffff' },
  { name: 'NORTHWIND', bg: '#061a40', fg: '#00a3e0' },
  { name: 'IRONCLAD', bg: '#f2f2f2', fg: '#141414', accent: '#d40f1c' },
  { name: 'PULSAR', bg: '#f7f8fb', fg: '#1434cb' },
  { name: 'AXIOM', bg: '#0a0a0a', fg: '#ff2a1f' },
  { name: 'HELIX OIL', bg: '#ffd400', fg: '#1a1a1a' },
  { name: 'MAREA TELECOM', bg: '#5b2c83', fg: '#ffffff' },
  { name: 'AZURA TIME', bg: '#0b0b0d', fg: '#d9b56b' },
  { name: 'LAMBRO AIR', bg: '#e6f1fb', fg: '#0a4c8c' },
  { name: 'SOLARA', bg: '#ff4a1c', fg: '#fff5e0' },
  { name: 'APEX GP', bg: '#111317', fg: '#ffffff', accent: '#e10600' },
  { name: 'BRIANZA BANCA', bg: '#f4efe4', fg: '#1f3a5a' },
  { name: 'CAFFÈ VILLORESI', bg: '#1f3a5a', fg: '#f4efe4' },
];

const ATLAS_W = 2048;
const BOARD_H = 128;
const BOARDS_PER_ROW = 2;
export const SPONSOR_ROWS = Math.ceil(SPONSORS.length / BOARDS_PER_ROW);

let _sponsor: THREE.CanvasTexture | null = null;
let _teams: THREE.CanvasTexture | null = null;

function font(size: number, weight = 900) {
  return `${weight} ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
}

function drawBoard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: (typeof SPONSORS)[number]) {
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
  SPONSORS.forEach((s, i) => {
    const col = i % BOARDS_PER_ROW;
    const row = Math.floor(i / BOARDS_PER_ROW);
    drawBoard(ctx, col * w, row * BOARD_H, w, BOARD_H, s);
  });
}

/** Sponsor atlas: 2 boards per row, 128 px tall. UV of board k via sponsorUV(). */
export function sponsorTexture(): THREE.CanvasTexture {
  if (_sponsor) return _sponsor;
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
  const i = ((k % SPONSORS.length) + SPONSORS.length) % SPONSORS.length;
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
