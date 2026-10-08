import '@fontsource/titillium-web/300.css';
import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/600-italic.css';
import '@fontsource/titillium-web/700-italic.css';
import '@fontsource/titillium-web/900.css';

/**
 * How a sponsor's board is drawn: one look for every board, banner, fascia and bridge, so a brand
 * looks the same wherever it appears. All fictional. Each has a category, a word mark (weight,
 * case, tracking, slant, stretch), a simple emblem, brand colours and a tagline — drawn as a lockup
 * at the board's own proportions, then weathered like printed vinyl (grain, a dirty bottom edge,
 * rain streaks, seams on long banners), so the boards read as printed things rather than text on a
 * fill. Which brands a circuit carries, and where, is partners.ts (docs/F1_ADVERTISING.md).
 */

export type BrandMark = 'ring' | 'wing' | 'shield' | 'bars' | 'dot' | 'diamond' | 'wave' | 'chevron' | 'star' | 'sun' | 'monogram' | 'globe' | 'leaf' | 'none';

export interface Brand {
  name: string;
  tag: string;
  /** what it sells (timing, tyres, logistics, bank…): which contract positions it holds (partners.ts) */
  cat?: string;
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

const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';

/** every face the brand boards use (boot waits for these before painting the atlases) */
export const BRAND_FONTS = ['300', '400', '600', '700', '900', 'italic 600', 'italic 700'].map((f) => `${f} 20px "Titillium Web"`);

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
    case 'chevron':
      // two forward chevrons (a speed mark)
      for (let k = 0; k < 2; k++) {
        const x = cx - r * 0.75 + k * r * 0.7;
        g.beginPath();
        g.moveTo(x, cy - r * 0.8);
        g.lineTo(x + r * 0.32, cy - r * 0.8);
        g.lineTo(x + r * 0.85, cy);
        g.lineTo(x + r * 0.32, cy + r * 0.8);
        g.lineTo(x, cy + r * 0.8);
        g.lineTo(x + r * 0.53, cy);
        g.closePath();
        g.fill();
      }
      break;
    case 'star':
      // an eight-point compass star
      g.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? r * 0.36 : k % 4 ? r * 0.62 : r * 0.95;
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    case 'sun':
      // a half sun rising over a rule
      g.beginPath();
      g.arc(cx, cy + r * 0.35, r * 0.48, Math.PI, 0);
      g.fill();
      g.lineWidth = r * 0.12;
      g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = Math.PI + (k / 6) * Math.PI;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r * 0.66, cy + r * 0.35 + Math.sin(a) * r * 0.66);
        g.lineTo(cx + Math.cos(a) * r * 0.95, cy + r * 0.35 + Math.sin(a) * r * 0.95);
        g.stroke();
      }
      g.fillRect(cx - r, cy + r * 0.45, r * 2, r * 0.14);
      break;
    case 'monogram':
      // the initials in a thin square frame (the luxury houses' device)
      g.lineWidth = r * 0.08;
      g.strokeRect(cx - r * 0.82, cy - r * 0.82, r * 1.64, r * 1.64);
      g.font = `300 ${Math.round(r * 1.05)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.name.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join(''), cx, cy + r * 0.04);
      break;
    case 'globe':
      g.lineWidth = r * 0.12;
      g.beginPath();
      g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(cx, cy, r * 0.36, r * 0.82, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - r * 0.82, cy);
      g.lineTo(cx + r * 0.82, cy);
      g.stroke();
      break;
    case 'leaf':
      g.beginPath();
      g.moveTo(cx - r * 0.8, cy + r * 0.8);
      g.quadraticCurveTo(cx - r * 0.7, cy - r * 0.7, cx + r * 0.85, cy - r * 0.85);
      g.quadraticCurveTo(cx + r * 0.7, cy + r * 0.7, cx - r * 0.8, cy + r * 0.8);
      g.fill();
      g.strokeStyle = b.bg;
      g.lineWidth = r * 0.08;
      g.beginPath();
      g.moveTo(cx - r * 0.6, cy + r * 0.6);
      g.lineTo(cx + r * 0.55, cy - r * 0.55);
      g.stroke();
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

/**
 * Just the lockup (emblem + word mark, no tagline, no background), centred in (x, y, w, h) in one
 * colour or the brand's own: the painted run-off logos (one colour of road paint) and the partner
 * block of an event title.
 */
export function drawWordmark(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: Brand, color?: string, withMark = true) {
  g.save();
  const hasMark = withMark && b.mark !== 'none';
  const markR = h * 0.34;
  const word = b.lower ? b.name : b.name.toUpperCase();
  const style = `${b.italic ? 'italic ' : ''}${b.weight}`;
  const sx = b.sx ?? 1;
  let size = h * 0.72;
  const avail = w * 0.94 - (hasMark ? markR * 2.7 : 0);
  const measure = (s: number) => {
    g.font = `${style} ${Math.round(s)}px ${FONT}`;
    setTrack(g, s * (b.track ?? 0));
    return g.measureText(word).width * sx;
  };
  while (size > 8 && measure(size) > avail) size *= 0.94;
  const wordW = measure(size);
  let cx = x + (w - wordW - (hasMark ? markR * 2.7 : 0)) / 2;
  const midY = y + h / 2;
  if (hasMark) {
    // (one colour: the emblem's cut-outs are left open rather than filled with the board colour)
    drawMark(g, color ? { ...b, accent: color, bg: 'rgba(0,0,0,0)' } : b, cx + markR, midY, markR);
    cx += markR * 2.7;
  }
  g.fillStyle = color ?? b.fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `${style} ${Math.round(size)}px ${FONT}`;
  setTrack(g, size * (b.track ?? 0));
  g.translate(cx, midY + size * 0.04);
  g.scale(sx, 1);
  g.fillText(word, 0, 0);
  g.restore();
}

export interface TitleStyle {
  /** the banner's ground, the Grand Prix's lettering, the rule along the bottom */
  bg: string;
  fg: string;
  accent: string;
  /** the host's colours as bands along the bottom instead of the rule */
  bands?: string[];
  italic?: boolean;
}

/**
 * The event's own banner, laid out like the real race titles ("FORMULA 1 <partner> <race name>",
 * docs/F1_ADVERTISING.md §2): the title partner's lockup in its own colour block at the left, then
 * the Grand Prix's name in the host's language filling the rest. Without a title partner (Mexico
 * City) the name has the whole banner. A squarer cell stacks the partner over the name.
 */
export function drawTitle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, partner: Brand | null, gp: string, st: TitleStyle) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = st.bg;
  g.fillRect(x, y, w, h);
  const ruleH = h * 0.12;
  if (st.bands) {
    const n = st.bands.length;
    st.bands.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(x + (i * w) / n, y + h - ruleH, w / n + 1, ruleH);
    });
  } else {
    g.fillStyle = st.accent;
    g.fillRect(x, y + h - ruleH, w, ruleH);
  }
  const inner = h - ruleH;
  const stacked = w / h < 3;
  let nx = x + w * 0.04, nw = w * 0.92, ny = y, nh = inner;
  if (partner) {
    if (stacked) {
      g.fillStyle = partner.bg;
      g.fillRect(x, y, w, inner * 0.42);
      drawWordmark(g, x + w * 0.08, y + inner * 0.06, w * 0.84, inner * 0.3, partner, undefined, false);
      ny = y + inner * 0.42;
      nh = inner * 0.58;
    } else {
      // (the partner's block: its own colours, a fixed share of the banner)
      const pw = Math.min(w * 0.34, h * 3);
      g.fillStyle = partner.bg;
      g.fillRect(x, y, pw, inner);
      // (the word mark alone: at this size the emblem would only shrink the name)
      drawWordmark(g, x + pw * 0.06, y + inner * 0.16, pw * 0.88, inner * 0.68, partner, undefined, false);
      nx = x + pw + w * 0.025;
      nw = w - pw - w * 0.05;
    }
  }
  let size = nh * 0.5;
  const set = () => {
    g.font = `${st.italic === false ? '' : 'italic '}900 ${Math.round(size)}px ${FONT}`;
    setTrack(g, 0);
  };
  set();
  while (size > 8 && g.measureText(gp).width > nw) {
    size *= 0.94;
    set();
  }
  g.fillStyle = st.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(gp, nx + nw / 2, ny + nh * 0.53);
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
