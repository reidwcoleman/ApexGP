import '@fontsource/titillium-web/300.css';
import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/600-italic.css';
import '@fontsource/titillium-web/700-italic.css';
import '@fontsource/titillium-web/900.css';

/**
 * The paddock's sponsors: one registry for every board, banner, fascia and bridge, so a brand looks
 * the same wherever it appears. All fictional. Each has a sector, a word mark (weight, case,
 * tracking, slant), a simple logo mark, brand colours and a tagline — drawn as a lockup at the
 * board's own proportions, then weathered like printed vinyl (grain, a dirty bottom edge, rain
 * streaks, seams on long banners), so the boards read as printed things rather than text on a fill.
 */

export type BrandMark = 'ring' | 'wing' | 'shield' | 'bars' | 'dot' | 'diamond' | 'wave' | 'none';

export interface Brand {
  name: string;
  tag: string;
  /** board background, word mark, accent (mark / rule) */
  bg: string;
  fg: string;
  accent: string;
  mark: BrandMark;
  weight: 300 | 400 | 600 | 700 | 900;
  italic?: boolean;
  /** extra tracking, as a fraction of the font size */
  track?: number;
  /** horizontal stretch of the word mark (extended faces) */
  sx?: number;
  lower?: boolean;
}

export const BRANDS: Brand[] = [
  { name: 'MARLOWE & PIERCE', tag: 'PRIVATE BANKING SINCE 1868', bg: '#0f2342', fg: '#f3efe6', accent: '#c9a45c', mark: 'shield', weight: 300, track: 0.14 },
  { name: 'TERRANO', tag: 'ENERGY · LOW-CARBON FUELS', bg: '#ffffff', fg: '#0b6b3a', accent: '#f2b705', mark: 'dot', weight: 900, italic: true },
  { name: 'KESSLER', tag: 'CHRONOGRAPHE · GENÈVE', bg: '#0b0b0c', fg: '#e9e4d8', accent: '#b8975a', mark: 'none', weight: 300, track: 0.32 },
  { name: 'HOLLIS', tag: 'GLOBAL FREIGHT PARTNER', bg: '#f4f4f2', fg: '#c1121f', accent: '#1d1d1f', mark: 'bars', weight: 900, sx: 1.18 },
  { name: 'Aurelia', tag: 'ESPRESSO ITALIANO', bg: '#3b1f14', fg: '#f5e6c8', accent: '#d9a441', mark: 'ring', weight: 600, italic: true, lower: true },
  { name: 'NORVIK', tag: 'TELECOM · 5G', bg: '#5a1e8c', fg: '#ffffff', accent: '#ff6fb5', mark: 'wave', weight: 700 },
  { name: 'CASTELLAN', tag: 'PERFORMANCE TYRES', bg: '#141414', fg: '#ffd21f', accent: '#ffd21f', mark: 'diamond', weight: 900, italic: true, sx: 1.1 },
  { name: 'SABLE AIRWAYS', tag: 'FLY FURTHER', bg: '#ffffff', fg: '#10284f', accent: '#d71920', mark: 'wing', weight: 600, track: 0.04 },
  { name: 'cirrusnet', tag: 'CLOUD · DATA · AI', bg: '#0a1624', fg: '#5ee2ff', accent: '#5ee2ff', mark: 'dot', weight: 400, lower: true, track: 0.02 },
  { name: 'VIREO', tag: 'NATURAL SPRING WATER', bg: '#e8f4fb', fg: '#0a4c8c', accent: '#47a9e0', mark: 'wave', weight: 600, track: 0.1 },
  { name: 'OAKRIDGE', tag: 'ENGINEERED LUBRICANTS', bg: '#1b1b1b', fg: '#ff7a00', accent: '#ff7a00', mark: 'bars', weight: 900, italic: true },
  { name: 'MAISON DUVAL', tag: 'CHAMPAGNE · REIMS', bg: '#0e2a1f', fg: '#e8d6a8', accent: '#e8d6a8', mark: 'none', weight: 300, track: 0.22 },
  { name: 'FERRANT', tag: 'INSURANCE GROUP', bg: '#ffffff', fg: '#0033a0', accent: '#00a3e0', mark: 'ring', weight: 700 },
  { name: 'RIDGEWAY', tag: 'PAYMENTS', bg: '#111827', fg: '#ffffff', accent: '#22c55e', mark: 'diamond', weight: 600, track: 0.06 },
  { name: 'HALDEN', tag: 'PRECISION TOOLS', bg: '#e30613', fg: '#ffffff', accent: '#1d1d1f', mark: 'bars', weight: 900, sx: 1.15 },
  { name: 'LUMEN', tag: 'OPTICS & EYEWEAR', bg: '#f5f3ee', fg: '#1a1a1a', accent: '#d4a017', mark: 'ring', weight: 300, track: 0.3 },
  { name: 'PARRISH & VALE', tag: 'LONDON', bg: '#1c1c1c', fg: '#f1ede4', accent: '#8a1c2b', mark: 'none', weight: 400, track: 0.18 },
  { name: 'KOSEI', tag: 'ELECTRONICS', bg: '#0050b5', fg: '#ffffff', accent: '#ffffff', mark: 'wing', weight: 700, italic: true },
];

const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';

/** every face the brand boards use (boot waits for these before painting the atlases) */
export const BRAND_FONTS = ['300', '400', '600', '700', '900', 'italic 600', 'italic 700'].map((f) => `${f} 20px "Titillium Web"`);

/** a brand by index (wraps) */
export const brandAt = (k: number): Brand => BRANDS[((k % BRANDS.length) + BRANDS.length) % BRANDS.length];

function setTrack(g: CanvasRenderingContext2D, px: number) {
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px.toFixed(1)}px`;
}

function drawMark(g: CanvasRenderingContext2D, b: Brand, cx: number, cy: number, r: number) {
  g.save();
  g.fillStyle = b.accent;
  g.strokeStyle = b.accent;
  switch (b.mark) {
    case 'ring':
      g.lineWidth = r * 0.28;
      g.beginPath();
      g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'wing':
      g.beginPath();
      g.moveTo(cx - r, cy + r * 0.55);
      g.quadraticCurveTo(cx - r * 0.1, cy + r * 0.2, cx + r, cy - r * 0.75);
      g.quadraticCurveTo(cx + r * 0.2, cy + r * 0.05, cx - r * 0.2, cy + r * 0.2);
      g.quadraticCurveTo(cx + r * 0.1, cy + r * 0.35, cx + r * 0.7, cy - r * 0.15);
      g.quadraticCurveTo(cx, cy + r * 0.75, cx - r, cy + r * 0.55);
      g.fill();
      break;
    case 'shield':
      g.lineWidth = r * 0.12;
      g.beginPath();
      g.moveTo(cx - r * 0.75, cy - r * 0.85);
      g.lineTo(cx + r * 0.75, cy - r * 0.85);
      g.lineTo(cx + r * 0.75, cy - r * 0.1);
      g.quadraticCurveTo(cx + r * 0.7, cy + r * 0.65, cx, cy + r);
      g.quadraticCurveTo(cx - r * 0.7, cy + r * 0.65, cx - r * 0.75, cy - r * 0.1);
      g.closePath();
      g.stroke();
      g.font = `300 ${Math.round(r * 0.95)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.name[0], cx, cy - r * 0.02);
      break;
    case 'bars':
      for (let k = 0; k < 3; k++) {
        const x = cx - r + k * r * 0.72;
        g.beginPath();
        g.moveTo(x + r * 0.35, cy - r * 0.8);
        g.lineTo(x + r * 0.75, cy - r * 0.8);
        g.lineTo(x + r * 0.4, cy + r * 0.8);
        g.lineTo(x, cy + r * 0.8);
        g.closePath();
        g.fill();
      }
      break;
    case 'dot':
      g.beginPath();
      g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
      g.fill();
      break;
    case 'diamond':
      g.beginPath();
      g.moveTo(cx, cy - r * 0.9);
      g.lineTo(cx + r * 0.9, cy);
      g.lineTo(cx, cy + r * 0.9);
      g.lineTo(cx - r * 0.9, cy);
      g.closePath();
      g.fill();
      g.fillStyle = b.bg;
      g.beginPath();
      g.moveTo(cx, cy - r * 0.4);
      g.lineTo(cx + r * 0.4, cy);
      g.lineTo(cx, cy + r * 0.4);
      g.lineTo(cx - r * 0.4, cy);
      g.closePath();
      g.fill();
      break;
    case 'wave':
      g.lineWidth = r * 0.22;
      g.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const y = cy - r * 0.25 + k * r * 0.5;
        g.beginPath();
        g.moveTo(cx - r * 0.9, y);
        g.bezierCurveTo(cx - r * 0.4, y - r * 0.45, cx + r * 0.1, y + r * 0.45, cx + r * 0.9, y - r * 0.1);
        g.stroke();
      }
      break;
    default:
      break;
  }
  g.restore();
}

/**
 * Draw a brand's board into (x, y, w, h), laid out for the board's own proportions: a long, thin
 * band gets mark · word mark · tagline in one line; a squarer board stacks the tagline under the
 * word mark. `invert` swaps to the brand's light-on-dark (or dark-on-light) alternate.
 */
export function drawBrand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: Brand, invert = false) {
  const bg = invert ? b.fg : b.bg;
  const fg = invert ? b.bg : b.fg;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  const wide = w / h >= 6;
  const margin = Math.min(w, h) * 0.16;
  const hasMark = b.mark !== 'none';
  const markR = h * (wide ? 0.3 : 0.2);
  const word = b.lower ? b.name : b.name.toUpperCase();
  const style = `${b.italic ? 'italic ' : ''}${b.weight}`;
  const sx = b.sx ?? 1;
  const track = b.track ?? 0;

  // word mark size: as big as fits, leaving room for the mark and (on wide boards) the tagline
  let size = h * (wide ? 0.5 : 0.46);
  let tagSize = Math.max(9, h * (wide ? 0.16 : 0.15));
  const tagFont = () => {
    g.font = `600 ${Math.round(tagSize)}px ${FONT}`;
    setTrack(g, tagSize * 0.18);
  };
  tagFont();
  // (stacked, the tagline has the board's whole width, less the margins)
  while (!wide && tagSize > 8 && g.measureText(b.tag).width > w - margin * 2) {
    tagSize *= 0.92;
    tagFont();
  }
  const tagW = wide ? g.measureText(b.tag).width + tagSize * 2.2 : 0;
  const avail = w - margin * 2 - (hasMark ? markR * 2.9 : 0) - tagW;
  const measure = (s: number) => {
    g.font = `${style} ${Math.round(s)}px ${FONT}`;
    setTrack(g, s * track);
    return g.measureText(word).width * sx;
  };
  while (size > 12 && measure(size) > avail) size *= 0.94;
  const wordW = measure(size);
  const blockW = (hasMark ? markR * 2.9 : 0) + wordW + tagW;
  let cx = x + (w - blockW) / 2;
  const midY = wide ? y + h / 2 : y + h * 0.43;
  if (hasMark) {
    drawMark(g, b, cx + markR, midY, markR);
    cx += markR * 2.9;
  }
  // word mark
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `${style} ${Math.round(size)}px ${FONT}`;
  setTrack(g, size * track);
  g.save();
  g.translate(cx, midY + size * 0.04);
  g.scale(sx, 1);
  g.fillText(word, 0, 0);
  g.restore();
  // tagline: after a thin rule on a wide band, or centred under the word mark
  tagFont();
  g.globalAlpha = 0.82;
  if (wide) {
    const tx = cx + wordW + tagSize * 1.1;
    g.fillStyle = b.accent === bg ? fg : b.accent;
    g.fillRect(tx - tagSize * 0.55, midY - h * 0.2, Math.max(1, h * 0.012), h * 0.4);
    g.fillStyle = fg;
    g.fillText(b.tag, tx, midY + 1);
  } else {
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.fillText(b.tag, x + w / 2, y + h * 0.8);
  }
  g.restore();
}

// ---------------------------------------------------------------- printed-vinyl wear

let grain: HTMLCanvasElement | null = null;
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 128);
  let s = 12345;
  for (let i = 0; i < 128 * 128; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const v = 118 + ((s >>> 16) % 20);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = c;
  return c;
}

/**
 * Weather a printed board in place: a fine print grain, a grimy bottom edge where spray and dust
 * settle, a few rain streaks down from the top, faint seams across long banners, and a slightly
 * faded print on some. `seed` varies it per board so neighbours don't match.
 */
export function printWear(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, amount = 1) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  // print grain
  const pat = g.createPattern(grainTile(), 'repeat');
  if (pat) {
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.22 * amount;
    g.fillStyle = pat;
    g.fillRect(x, y, w, h);
  }
  g.globalCompositeOperation = 'multiply';
  // grime along the bottom edge
  const gr = g.createLinearGradient(0, y + h, 0, y + h * 0.55);
  gr.addColorStop(0, `rgba(92,82,66,${(0.2 + 0.18 * rnd()) * amount})`);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalAlpha = 1;
  g.fillStyle = gr;
  g.fillRect(x, y + h * 0.55, w, h * 0.45);
  // rain streaks from the top edge
  const n = Math.round((w / h) * 0.8 * amount);
  for (let k = 0; k < n; k++) {
    const sx = x + rnd() * w;
    const len = h * (0.25 + 0.6 * rnd());
    const sg = g.createLinearGradient(0, y, 0, y + len);
    sg.addColorStop(0, `rgba(110,100,86,${0.15 * amount})`);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg;
    g.fillRect(sx, y, Math.max(1, h * (0.01 + 0.02 * rnd())), len);
  }
  // seams across long banners (panels welded every ~2.5 board-heights)
  if (w / h > 5) {
    g.fillStyle = `rgba(0,0,0,${0.12 * amount})`;
    for (let sxp = x + h * 2.5; sxp < x + w - h; sxp += h * (2.3 + rnd() * 0.5)) g.fillRect(sxp, y, Math.max(1, h * 0.012), h);
  }
  // sun-faded print on some boards
  if (rnd() < 0.35) {
    g.globalCompositeOperation = 'screen';
    g.fillStyle = `rgba(255,248,236,${0.06 + 0.06 * rnd()})`;
    g.fillRect(x, y, w, h);
  }
  g.restore();
}
