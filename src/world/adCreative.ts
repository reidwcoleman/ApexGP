import { drawBrand, drawWordmark, type Brand } from './brands.ts';
import { SERIES } from './partners.ts';

/**
 * The partners' advertising, not just their logos: a Grand Prix's boards carry the brands'
 * campaigns (docs/F1_ADVERTISING.md §6). Three creatives per brand, drawn at any board proportion:
 *
 *   0  the logo board      the lockup in the brand's colour block (brands.ts' drawBrand)
 *   1  the campaign        a campaign line in heavy type, the product drawn on a slanted slab of the
 *                          accent colour, the logo and a web address or hashtag at the end — the
 *                          lager's drink-driving line, the airline's tail fin, the timekeeper's watch
 *   2  the programme       the contract itself as the headline ("OFFICIAL TIMEKEEPER", "FASTEST PIT
 *                          STOP AWARD", "RACE INSIGHTS powered by …") over the brand's pattern — the
 *                          luxury house's monogram, the freight company's speed stripes, the tyre
 *                          maker's stretched name, the cloud's data grid
 *
 * Every line is written for the game's fictional brands in the manner of the real campaigns, never
 * quoting one.
 */

const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';
export const CREATIVES = 3;

type Product =
  | 'bottle' | 'champagne' | 'can' | 'watch' | 'tyre' | 'plane' | 'ship' | 'laptop' | 'card' | 'phone' | 'chart' | 'drop'
  | 'trunk' | 'cup' | 'car' | 'landscape' | 'bar' | 'coin';
type Motif = 'stripes' | 'monogram' | 'repeat' | 'grid' | 'hex' | 'mark' | 'rays';

interface Copy {
  /** the campaign line */
  line: string;
  /** the programme the contract buys (official title, award, "powered by" feature) */
  prog: string;
  product: Product;
  motif: Motif;
  /** address or hashtag (the brand's name fills `$`) */
  cta?: string;
}

/** the series partners: one contract each, their own campaigns */
const SERIES_COPY: Record<string, Copy> = {
  timing: { line: 'EVERY THOUSANDTH COUNTS', prog: 'OFFICIAL TIMEKEEPER', product: 'watch', motif: 'rays', cta: '$.com' },
  tyres: { line: 'GRIP THAT GOES THE DISTANCE', prog: 'OFFICIAL TYRE SUPPLIER', product: 'tyre', motif: 'repeat', cta: '#$Grip' },
  logistics: { line: 'DELIVERING THE GRID TO EVERY RACE', prog: 'FASTEST PIT STOP AWARD', product: 'plane', motif: 'stripes', cta: '$.com/racing' },
  lager: { line: 'DRIVING? MAKE IT 0.0', prog: 'OFFICIAL BEER · ENJOY RESPONSIBLY', product: 'bottle', motif: 'rays', cta: '#ZeroWhenYouDrive' },
  champagne: { line: 'RAISED ON THE PODIUM', prog: 'OFFICIAL CHAMPAGNE', product: 'champagne', motif: 'monogram', cta: 'ENJOY RESPONSIBLY' },
  'energy drink': { line: 'FUEL THE RUSH', prog: 'OFFICIAL ENERGY DRINK', product: 'can', motif: 'stripes', cta: '#$Rush' },
  airline: { line: 'FLY FURTHER, TOGETHER', prog: 'OFFICIAL AIRLINE', product: 'plane', motif: 'rays', cta: '$.com' },
  bank: { line: 'BANKING AT RACE PACE', prog: 'OFFICIAL BANKING PARTNER', product: 'card', motif: 'mark', cta: '$.com' },
  cloud: { line: 'EVERY CAR. EVERY LAP. EVERY DATA POINT.', prog: 'RACE INSIGHTS', product: 'chart', motif: 'grid', cta: '$.cloud/racing' },
  energy: { line: 'ENERGY FOR WHAT COMES NEXT', prog: 'OFFICIAL ENERGY PARTNER', product: 'drop', motif: 'rays', cta: 'LOW-CARBON FUELS' },
  luxury: { line: 'THE ART OF THE JOURNEY', prog: 'OFFICIAL TROPHY TRUNK', product: 'trunk', motif: 'monogram' },
  crypto: { line: 'THE BOLD MOVE FIRST', prog: 'OFFICIAL CRYPTO PARTNER', product: 'coin', motif: 'hex', cta: '$.app' },
  cruise: { line: 'THE WORLD, AT SEA', prog: 'OFFICIAL CRUISE PARTNER', product: 'ship', motif: 'rays', cta: '$.com' },
  tech: { line: 'TECH THAT KEEPS PACE', prog: 'OFFICIAL TECHNOLOGY PARTNER', product: 'laptop', motif: 'grid', cta: '$.com' },
};

/** the promoters' partners, by what they sell */
const LOCAL_COPY: Record<string, Copy> = {
  telecom: { line: 'THE FASTEST NETWORK IN THE PADDOCK', prog: 'OFFICIAL CONNECTIVITY PARTNER', product: 'phone', motif: 'stripes', cta: '$.com' },
  bank: { line: 'YOUR BANK, AT FULL SPEED', prog: 'OFFICIAL BANK', product: 'card', motif: 'mark', cta: '$.com' },
  beer: { line: 'BREWED FOR RACE DAY', prog: 'OFFICIAL BEER · DRINK RESPONSIBLY', product: 'bottle', motif: 'rays', cta: 'DRINK RESPONSIBLY' },
  airline: { line: 'FLY IN FOR THE RACE', prog: 'OFFICIAL AIRLINE', product: 'plane', motif: 'rays', cta: '$.com' },
  tourism: { line: 'COME FOR THE RACE. STAY FOR MORE.', prog: 'HOST REGION', product: 'landscape', motif: 'mark', cta: '#Visit$' },
  water: { line: 'PURE FROM THE SOURCE', prog: 'OFFICIAL WATER', product: 'bottle', motif: 'rays' },
  energy: { line: 'POWERING THE HOME RACE', prog: 'OFFICIAL ENERGY PARTNER', product: 'drop', motif: 'rays', cta: '$.com' },
  'car maker': { line: 'BORN ON THE ROAD', prog: 'OFFICIAL CAR', product: 'car', motif: 'stripes', cta: '$.com' },
  coffee: { line: 'THE FIRST LAP OF THE DAY', prog: 'OFFICIAL COFFEE', product: 'cup', motif: 'mark' },
  spirits: { line: 'CELEBRATE RESPONSIBLY', prog: 'OFFICIAL SPIRIT', product: 'bottle', motif: 'monogram' },
  payments: { line: 'TAP. PAY. GO.', prog: 'OFFICIAL PAYMENTS PARTNER', product: 'card', motif: 'stripes', cta: '$.com' },
  insurance: { line: 'COVERED AT EVERY TURN', prog: 'OFFICIAL INSURANCE PARTNER', product: 'card', motif: 'mark', cta: '$.com' },
  hospitality: { line: 'YOUR SEAT AT THE RACE', prog: 'OFFICIAL HOSPITALITY', product: 'landscape', motif: 'monogram', cta: '$.com' },
  wine: { line: 'POURED FOR THE PODIUM', prog: 'OFFICIAL WINE · ENJOY RESPONSIBLY', product: 'champagne', motif: 'monogram' },
  supermarket: { line: 'EVERYTHING FOR RACE WEEKEND', prog: 'OFFICIAL SUPERMARKET', product: 'bar', motif: 'stripes', cta: '$.com' },
  streaming: { line: 'EVERY SESSION. LIVE.', prog: 'OFFICIAL BROADCASTER', product: 'phone', motif: 'grid', cta: 'STREAM NOW' },
  'soft drink': { line: 'ICE COLD AT THE TRACK', prog: 'OFFICIAL SOFT DRINK', product: 'can', motif: 'rays' },
  property: { line: 'BUILDING WHAT COMES NEXT', prog: 'OFFICIAL PARTNER', product: 'landscape', motif: 'grid', cta: '$.com' },
  lottery: { line: 'PLAY RESPONSIBLY', prog: 'OFFICIAL LOTTERY', product: 'coin', motif: 'rays', cta: '18+ ONLY' },
  industry: { line: 'ENGINEERED TO LAST', prog: 'OFFICIAL PARTNER', product: 'drop', motif: 'grid', cta: '$.com' },
  food: { line: 'THE TASTE OF THE HOME RACE', prog: 'OFFICIAL FOOD PARTNER', product: 'bar', motif: 'mark' },
  fashion: { line: 'DRESSED FOR THE PADDOCK', prog: 'OFFICIAL OUTFITTER', product: 'trunk', motif: 'monogram' },
  electronics: { line: 'SEE EVERY DETAIL', prog: 'OFFICIAL DISPLAY PARTNER', product: 'laptop', motif: 'grid', cta: '$.com' },
  chocolate: { line: 'A PODIUM IN EVERY BITE', prog: 'OFFICIAL CHOCOLATE', product: 'bar', motif: 'monogram' },
};
const DEFAULT_COPY: Copy = { line: 'PROUD PARTNER OF THE RACE', prog: 'OFFICIAL PARTNER', product: 'landscape', motif: 'mark', cta: '$.com' };

/** the series' own partners (the same Brand objects every roster carries) */
// (by name: a hot-reloaded module may hold its own copies of the objects)
const SERIES_SET = new Set<string>(Object.values(SERIES).map((b) => b.name));

function copyFor(b: Brand, series?: boolean): Copy {
  const cat = b.cat ?? '';
  const s = series ?? SERIES_SET.has(b.name);
  return (s ? SERIES_COPY[cat] : undefined) ?? LOCAL_COPY[cat] ?? SERIES_COPY[cat] ?? DEFAULT_COPY;
}

function slug(b: Brand) {
  return b.name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}
function cap(b: Brand) {
  const w = b.name.split(/[^A-Za-z0-9]+/).filter(Boolean)[0] ?? b.name;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}
function ctaText(c: Copy, b: Brand) {
  if (!c.cta) return '';
  return c.cta.includes('$.') ? c.cta.replace('$', slug(b)) : c.cta.replace('$', cap(b));
}

function setTrack(g: CanvasRenderingContext2D, px: number) {
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px.toFixed(1)}px`;
}

/** the largest size ≤ `size` at which `text` fits `maxW` in the given face */
function fit(g: CanvasRenderingContext2D, text: string, face: string, size: number, maxW: number, track = 0, min = 8) {
  for (;;) {
    g.font = `${face} ${Math.round(size)}px ${FONT}`;
    setTrack(g, size * track);
    if (g.measureText(text).width <= maxW || size <= min) return size;
    size *= 0.94;
  }
}

/** luminance of a #rrggbb colour, 0 … 1 */
function lum(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
/** the accent if it stands out from the background, else the word-mark colour */
function pop(b: Brand) {
  return Math.abs(lum(b.accent) - lum(b.bg)) > 0.18 ? b.accent : b.fg;
}

/**
 * Draw creative `v` (0 … CREATIVES-1) of a brand into (x, y, w, h). `series` overrides whether the
 * brand is read as a series partner (the copy it gets).
 */
export function drawCreative(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: Brand, v: number, series?: boolean) {
  const k = ((v % CREATIVES) + CREATIVES) % CREATIVES;
  if (k === 0) return drawBrand(g, x, y, w, h, b);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  if (k === 1) campaign(g, x, y, w, h, b, copyFor(b, series));
  else programme(g, x, y, w, h, b, copyFor(b, series));
  g.restore();
}

// ---------------------------------------------------------------- 1: the campaign

function campaign(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: Brand, c: Copy) {
  const slab = pop(b);
  // the brand's colour, a soft light from the top (printed gradients, not flat fills)
  const gr = g.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, b.bg);
  gr.addColorStop(1, shade(b.bg, -0.18));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  // the slanted slab the product stands on
  const sw = Math.min(w * 0.2, h * 1.25);
  const lean = h * 0.24;
  g.fillStyle = slab;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + sw + lean, y);
  g.lineTo(x + sw - lean * 0.1, y + h);
  g.lineTo(x, y + h);
  g.closePath();
  g.fill();
  // (a thin second stripe trailing it: the speed lines every motorsport campaign borrows)
  g.globalAlpha = 0.55;
  g.beginPath();
  g.moveTo(x + sw + lean + h * 0.1, y);
  g.lineTo(x + sw + lean + h * 0.17, y);
  g.lineTo(x + sw + h * 0.07, y + h);
  g.lineTo(x + sw, y + h);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  // the product on the slab (drawn in the board's own colours against the accent)
  drawProduct(g, c.product, x + sw * 0.5 + lean * 0.15, y + h * 0.53, Math.min(h * 0.38, sw * 0.36), b, slab);
  // the logo at the end
  const lw = Math.min(w * 0.22, h * 2.2);
  const lx = x + w - lw - h * 0.1;
  drawWordmark(g, lx, y + h * 0.2, lw, h * (c.cta ? 0.42 : 0.6), b, b.fg);
  const cta = ctaText(c, b);
  if (cta) {
    const cs = fit(g, cta, '600', h * 0.14, lw * 0.95, 0.06);
    g.fillStyle = b.fg;
    g.globalAlpha = 0.8;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${Math.round(cs)}px ${FONT}`;
    setTrack(g, cs * 0.06);
    g.fillText(cta, lx + lw / 2, y + h * 0.77);
    g.globalAlpha = 1;
  }
  // the campaign line: as big as the space between allows, one line on a long board, two on a short one
  const tx = x + sw + lean + h * 0.2;
  const tw = lx - tx - h * 0.14;
  const words = c.line.split(' ');
  const face = 'italic 900';
  const one = fit(g, c.line, face, h * 0.46, tw, 0.01);
  g.fillStyle = b.fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  if (one >= h * 0.3 || words.length < 2) {
    g.font = `${face} ${Math.round(one)}px ${FONT}`;
    setTrack(g, one * 0.01);
    g.fillText(c.line, tx, y + h * 0.53);
  } else {
    // (two lines, the break nearest the middle)
    let best = 1, bd = Infinity;
    for (let i = 1; i < words.length; i++) {
      const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
      if (d < bd) (bd = d), (best = i);
    }
    const a = words.slice(0, best).join(' '), z = words.slice(best).join(' ');
    const s = Math.min(fit(g, a, face, h * 0.38, tw, 0.01), fit(g, z, face, h * 0.38, tw, 0.01));
    g.font = `${face} ${Math.round(s)}px ${FONT}`;
    setTrack(g, s * 0.01);
    g.fillText(a, tx, y + h * 0.5 - s * 0.52);
    g.fillStyle = slab === b.fg ? b.fg : slab;
    g.fillText(z, tx, y + h * 0.5 + s * 0.52);
  }
}

// ---------------------------------------------------------------- 2: the programme

function programme(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, b: Brand, c: Copy) {
  // the inverse block: the brand's dark or light alternate, its pattern faint over it
  const dark = lum(b.bg) < 0.5;
  const bg = dark ? b.bg : shade(b.bg, -0.06);
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  motif(g, c.motif, x, y, w, h, b);
  const lw = Math.min(w * 0.38, h * 3.2);
  // the programme on the left: a small series label over the title, an accent rule between
  const px = x + h * 0.28;
  const pw = w - lw - h * 0.7;
  const label = 'APEX GP';
  const ls = fit(g, label, '700', h * 0.13, pw, 0.3);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = b.fg;
  g.globalAlpha = 0.75;
  g.font = `700 ${Math.round(ls)}px ${FONT}`;
  setTrack(g, ls * 0.3);
  g.fillText(label, px, y + h * 0.27);
  g.globalAlpha = 1;
  g.fillStyle = pop(b);
  g.fillRect(px, y + h * 0.38, h * 0.55, Math.max(2, h * 0.035));
  const ts = fit(g, c.prog, '900', h * 0.3, pw, 0.02);
  g.fillStyle = b.fg;
  g.font = `900 ${Math.round(ts)}px ${FONT}`;
  setTrack(g, ts * 0.02);
  g.fillText(c.prog, px, y + h * 0.62);
  // the logo, "powered by" for a feature the brand runs
  const lx = x + w - lw - h * 0.2;
  // (a hairline divider)
  g.fillStyle = b.fg;
  g.globalAlpha = 0.3;
  g.fillRect(lx - h * 0.12, y + h * 0.22, Math.max(1, h * 0.012), h * 0.56);
  g.globalAlpha = 1;
  if (c.prog === 'RACE INSIGHTS') {
    const s = fit(g, 'powered by', '400', h * 0.15, lw, 0.04);
    g.font = `400 ${Math.round(s)}px ${FONT}`;
    g.textAlign = 'center';
    g.globalAlpha = 0.8;
    g.fillText('powered by', lx + lw / 2, y + h * 0.27);
    g.globalAlpha = 1;
    drawWordmark(g, lx, y + h * 0.38, lw, h * 0.46, b, b.fg);
  } else drawWordmark(g, lx, y + h * 0.22, lw, h * 0.56, b, b.fg);
}

function motif(g: CanvasRenderingContext2D, m: Motif, x: number, y: number, w: number, h: number, b: Brand) {
  g.save();
  const ink = pop(b);
  switch (m) {
    case 'stripes': {
      // speed stripes raking across the right half
      g.fillStyle = ink;
      for (let i = 0; i < 5; i++) {
        const sx = x + w * 0.5 + i * h * 0.42;
        g.globalAlpha = 0.22 + i * 0.06;
        g.beginPath();
        g.moveTo(sx + h * 0.5, y);
        g.lineTo(sx + h * 0.66, y);
        g.lineTo(sx + h * 0.16, y + h);
        g.lineTo(sx, y + h);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'monogram': {
      // the house monogram repeated over the whole board in a half-drop, faint
      const ini = b.name.split(/[^A-Za-z]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || 'M';
      g.fillStyle = b.fg;
      g.globalAlpha = 0.09;
      const s = h * 0.24;
      g.font = `300 ${Math.round(s)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let r = 0; r < 5; r++)
        for (let q = 0; q * s * 1.6 < w + s * 2; q++) {
          const cx = x + q * s * 1.6 + (r % 2) * s * 0.8;
          const cy = y + r * s * 1.05;
          g.fillText((q + r) % 3 === 2 ? '✦' : ini, cx, cy);
        }
      break;
    }
    case 'repeat': {
      // the name stretched and repeated in rows, ghosted (the tyre maker's wall)
      g.fillStyle = b.fg;
      g.globalAlpha = 0.07;
      const s = h * 0.36;
      g.font = `italic 900 ${Math.round(s)}px ${FONT}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      for (let r = 0; r < 3; r++) {
        g.save();
        g.translate(x - (r % 2) * s * 1.5, y + s * 0.5 + r * s);
        g.scale(1.5, 1);
        for (let q = 0; q < 8; q++) g.fillText(b.name.toUpperCase() + ' ', q * g.measureText(b.name.toUpperCase() + ' ').width, 0);
        g.restore();
      }
      break;
    }
    case 'grid': {
      // a data grid and a telemetry trace under the programme
      g.strokeStyle = b.fg;
      g.globalAlpha = 0.08;
      g.lineWidth = 1;
      for (let gx = x; gx < x + w; gx += h * 0.16) {
        g.beginPath();
        g.moveTo(gx, y);
        g.lineTo(gx, y + h);
        g.stroke();
      }
      for (let gy = y; gy < y + h; gy += h * 0.16) {
        g.beginPath();
        g.moveTo(x, gy);
        g.lineTo(x + w, gy);
        g.stroke();
      }
      g.globalAlpha = 0.35;
      g.strokeStyle = ink;
      g.lineWidth = Math.max(1.5, h * 0.02);
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const yy = y + h * (0.78 - 0.22 * Math.sin(t * 9.1) * Math.sin(t * 3.3 + 1) - 0.12 * t);
        if (i === 0) g.moveTo(x + t * w, yy);
        else g.lineTo(x + t * w, yy);
      }
      g.stroke();
      break;
    }
    case 'hex': {
      g.strokeStyle = ink;
      g.globalAlpha = 0.14;
      g.lineWidth = Math.max(1, h * 0.012);
      const r = h * 0.14;
      for (let row = -1; row < h / (r * 1.5) + 1; row++)
        for (let col = 0; col * r * 1.73 < w + r * 2; col++) {
          const cx = x + col * r * 1.73 + (row % 2) * r * 0.87;
          const cy = y + row * r * 1.5;
          g.beginPath();
          for (let a = 0; a < 6; a++) {
            const an = Math.PI / 6 + (a * Math.PI) / 3;
            const px = cx + Math.cos(an) * r, py = cy + Math.sin(an) * r;
            if (a === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.stroke();
        }
      break;
    }
    case 'rays': {
      // a burst of light behind the logo end of the board
      const cx = x + w * 0.8, cy = y + h * 0.5;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.45);
      rg.addColorStop(0, hexA(ink, 0.32));
      rg.addColorStop(1, hexA(ink, 0));
      g.fillStyle = rg;
      g.fillRect(x, y, w, h);
      g.fillStyle = ink;
      g.globalAlpha = 0.08;
      for (let i = 0; i < 18; i++) {
        const a0 = (i / 18) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, w, a0, a0 + 0.08);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'mark': {
      // broad concentric arcs swept in from the logo end (the banks' and insurers' corporate curves)
      g.strokeStyle = ink;
      g.lineWidth = h * 0.09;
      for (let i = 0; i < 4; i++) {
        g.globalAlpha = 0.16 - i * 0.03;
        g.beginPath();
        g.arc(x + w * 1.02, y + h * 1.25, h * (1.0 + i * 0.32), Math.PI, Math.PI * 1.5);
        g.stroke();
      }
      break;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- products

/** a product drawing centred on (cx, cy), about 2r tall */
function drawProduct(g: CanvasRenderingContext2D, p: Product, cx: number, cy: number, r: number, b: Brand, back: string) {
  g.save();
  const body = lum(back) > 0.55 ? shade(b.bg, lum(b.bg) > 0.55 ? -0.55 : 0) : b.fg;
  const label = b.bg === back ? b.fg : b.bg;
  const dark = '#141416';
  const glass = '#1e3b22';
  g.lineJoin = 'round';
  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, rad);
  };
  // (a soft shadow so the product sits on the slab)
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = r * 0.25;
  g.shadowOffsetY = r * 0.06;
  switch (p) {
    case 'bottle':
    case 'champagne': {
      const champ = p === 'champagne';
      const bw = r * 0.5, bh = r * 1.9;
      g.fillStyle = champ ? '#16301f' : b.cat === 'water' ? 'rgba(220,240,255,0.95)' : glass;
      g.beginPath();
      g.moveTo(cx - bw / 2, cy + bh / 2);
      g.lineTo(cx - bw / 2, cy - bh * 0.05);
      g.quadraticCurveTo(cx - bw / 2, cy - bh * 0.22, cx - bw * 0.18, cy - bh * 0.3);
      g.lineTo(cx - bw * 0.16, cy - bh / 2);
      g.lineTo(cx + bw * 0.16, cy - bh / 2);
      g.lineTo(cx + bw * 0.18, cy - bh * 0.3);
      g.quadraticCurveTo(cx + bw / 2, cy - bh * 0.22, cx + bw / 2, cy - bh * 0.05);
      g.lineTo(cx + bw / 2, cy + bh / 2);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      // foil / cap, label, a highlight
      g.fillStyle = champ ? '#d9b66a' : b.accent;
      g.fillRect(cx - bw * 0.17, cy - bh / 2, bw * 0.34, bh * (champ ? 0.2 : 0.06));
      g.fillStyle = label;
      g.fillRect(cx - bw / 2, cy + bh * 0.02, bw, bh * 0.26);
      g.fillStyle = b.accent;
      g.fillRect(cx - bw / 2, cy + bh * 0.02, bw, bh * 0.035);
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(cx - bw * 0.36, cy - bh * 0.08, bw * 0.08, bh * 0.5);
      break;
    }
    case 'can': {
      const w = r * 0.78, hh = r * 1.6;
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      rr(cx - w / 2, cy - hh / 2, w, hh, w * 0.12);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = '#c9ccd2';
      g.fillRect(cx - w / 2, cy - hh / 2, w, hh * 0.07);
      g.fillRect(cx - w / 2, cy + hh / 2 - hh * 0.06, w, hh * 0.06);
      g.fillStyle = b.accent;
      g.beginPath();
      g.moveTo(cx - w / 2, cy + hh * 0.1);
      g.lineTo(cx + w / 2, cy - hh * 0.12);
      g.lineTo(cx + w / 2, cy + hh * 0.02);
      g.lineTo(cx - w / 2, cy + hh * 0.24);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(cx - w * 0.3, cy - hh * 0.4, w * 0.1, hh * 0.8);
      break;
    }
    case 'watch': {
      g.fillStyle = '#2a2b2e';
      g.fillRect(cx - r * 0.32, cy - r * 1.2, r * 0.64, r * 2.4);
      g.fillStyle = '#c9ccd1';
      g.beginPath();
      g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = b.bg === back ? '#0d0e10' : b.bg;
      g.beginPath();
      g.arc(cx, cy, r * 0.66, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#e9e5da';
      g.lineWidth = Math.max(1, r * 0.04);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52);
        g.lineTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
        g.stroke();
      }
      g.lineWidth = Math.max(1.5, r * 0.07);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + r * 0.28, cy - r * 0.26);
      g.moveTo(cx, cy);
      g.lineTo(cx - r * 0.1, cy - r * 0.48);
      g.stroke();
      g.strokeStyle = b.accent;
      g.lineWidth = Math.max(1, r * 0.035);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx - r * 0.3, cy + r * 0.38);
      g.stroke();
      g.fillStyle = '#c9ccd1';
      g.fillRect(cx + r * 0.8, cy - r * 0.1, r * 0.14, r * 0.2);
      break;
    }
    case 'tyre': {
      g.fillStyle = '#121214';
      g.beginPath();
      g.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
      g.fill();
      g.shadowColor = 'transparent';
      // the compound band and the stretched name round the sidewall
      g.strokeStyle = b.accent;
      g.lineWidth = r * 0.09;
      g.beginPath();
      g.arc(cx, cy, r * 0.74, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = b.bg;
      g.font = `italic 900 ${Math.round(r * 0.2)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const t = b.name.toUpperCase();
      for (const s of [-1, 1]) {
        g.save();
        g.translate(cx, cy);
        g.rotate(s < 0 ? 0 : Math.PI);
        const span = 1.2;
        for (let i = 0; i < t.length; i++) {
          const a = -Math.PI / 2 - span / 2 + (i + 0.5) * (span / t.length);
          g.save();
          g.rotate(a + Math.PI / 2);
          g.fillText(t[i], 0, -r * 0.86);
          g.restore();
        }
        g.restore();
      }
      g.fillStyle = '#3a3c40';
      g.beginPath();
      g.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1c1d20';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r * 0.18, cy + Math.sin(a) * r * 0.18);
        g.lineTo(cx + Math.cos(a + 0.18) * r * 0.56, cy + Math.sin(a + 0.18) * r * 0.56);
        g.lineTo(cx + Math.cos(a + 0.34) * r * 0.56, cy + Math.sin(a + 0.34) * r * 0.56);
        g.closePath();
        g.fill();
      }
      g.fillStyle = '#c9ccd1';
      g.beginPath();
      g.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'plane': {
      // a side view climbing out, the tail in the brand's colours
      g.translate(cx, cy);
      g.rotate(-0.16);
      g.fillStyle = '#f2f3f5';
      rr(-r * 1.25, -r * 0.16, r * 2.4, r * 0.32, r * 0.16);
      g.fill();
      g.shadowColor = 'transparent';
      g.beginPath();
      g.moveTo(r * 1.15, -r * 0.16);
      g.quadraticCurveTo(r * 1.45, -r * 0.05, r * 1.15, r * 0.16);
      g.fill();
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      g.beginPath();
      g.moveTo(-r * 0.95, -r * 0.14);
      g.lineTo(-r * 1.25, -r * 0.85);
      g.lineTo(-r * 0.98, -r * 0.85);
      g.lineTo(-r * 0.55, -r * 0.14);
      g.closePath();
      g.fill();
      g.fillStyle = '#c9ccd1';
      g.beginPath();
      g.moveTo(-r * 0.05, r * 0.02);
      g.lineTo(-r * 0.55, r * 0.6);
      g.lineTo(-r * 0.32, r * 0.6);
      g.lineTo(r * 0.35, r * 0.04);
      g.closePath();
      g.fill();
      g.fillStyle = '#2d3036';
      for (let i = 0; i < 9; i++) g.fillRect(-r * 0.7 + i * r * 0.2, -r * 0.07, r * 0.07, r * 0.07);
      break;
    }
    case 'ship': {
      g.fillStyle = '#f2f3f5';
      g.beginPath();
      g.moveTo(cx - r * 1.3, cy);
      g.lineTo(cx + r * 1.35, cy);
      g.lineTo(cx + r * 1.1, cy + r * 0.38);
      g.lineTo(cx - r * 1.15, cy + r * 0.38);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      g.fillRect(cx - r * 1.2, cy + r * 0.22, r * 2.4, r * 0.1);
      g.fillStyle = '#e6e8ec';
      for (let d = 0; d < 3; d++) g.fillRect(cx - r * (1.0 - d * 0.15), cy - r * (0.2 + d * 0.18), r * (1.9 - d * 0.4), r * 0.18);
      g.fillStyle = '#2d3036';
      for (let d = 0; d < 3; d++) for (let i = 0; i < 14 - d * 3; i++) g.fillRect(cx - r * (0.95 - d * 0.15) + i * r * 0.13, cy - r * (0.14 + d * 0.18), r * 0.07, r * 0.05);
      g.fillStyle = b.accent;
      g.fillRect(cx + r * 0.1, cy - r * 0.85, r * 0.26, r * 0.32);
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillRect(cx - r * 1.6, cy + r * 0.42, r * 3.2, r * 0.03);
      break;
    }
    case 'laptop': {
      g.fillStyle = '#2a2c31';
      rr(cx - r * 0.95, cy - r * 0.8, r * 1.9, r * 1.2, r * 0.06);
      g.fill();
      g.shadowColor = 'transparent';
      const sg = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r * 0.3);
      sg.addColorStop(0, b.accent);
      sg.addColorStop(1, b.bg === back ? b.fg : b.bg);
      g.fillStyle = sg;
      g.fillRect(cx - r * 0.86, cy - r * 0.72, r * 1.72, r * 1.04);
      g.fillStyle = '#c9ccd1';
      g.beginPath();
      g.moveTo(cx - r * 1.15, cy + r * 0.42);
      g.lineTo(cx + r * 1.15, cy + r * 0.42);
      g.lineTo(cx + r * 1.0, cy + r * 0.55);
      g.lineTo(cx - r * 1.0, cy + r * 0.55);
      g.closePath();
      g.fill();
      break;
    }
    case 'card':
    case 'coin': {
      if (p === 'coin') {
        g.fillStyle = '#d9b44a';
        g.beginPath();
        g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
        g.fill();
        g.shadowColor = 'transparent';
        g.strokeStyle = '#a8852d';
        g.lineWidth = r * 0.08;
        g.beginPath();
        g.arc(cx, cy, r * 0.64, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#8a6a1e';
        g.font = `900 ${Math.round(r * 0.8)}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.name[0], cx, cy + r * 0.04);
        break;
      }
      g.translate(cx, cy);
      g.rotate(-0.18);
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      rr(-r * 1.0, -r * 0.63, r * 2.0, r * 1.26, r * 0.12);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = '#d9b44a';
      rr(-r * 0.75, -r * 0.2, r * 0.36, r * 0.28, r * 0.05);
      g.fill();
      g.fillStyle = b.accent;
      g.fillRect(-r * 1.0, r * 0.22, r * 2.0, r * 0.08);
      g.fillStyle = 'rgba(255,255,255,0.65)';
      for (let i = 0; i < 4; i++) g.fillRect(-r * 0.75 + i * r * 0.36, r * 0.38, r * 0.28, r * 0.06);
      break;
    }
    case 'phone': {
      g.fillStyle = '#1a1b1f';
      rr(cx - r * 0.45, cy - r * 0.92, r * 0.9, r * 1.84, r * 0.12);
      g.fill();
      g.shadowColor = 'transparent';
      const sg = g.createLinearGradient(cx, cy - r, cx, cy + r);
      sg.addColorStop(0, b.accent);
      sg.addColorStop(1, b.bg === back ? b.fg : b.bg);
      g.fillStyle = sg;
      rr(cx - r * 0.38, cy - r * 0.84, r * 0.76, r * 1.68, r * 0.08);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(1.5, r * 0.07);
      g.lineCap = 'round';
      for (let i = 1; i <= 3; i++) {
        g.beginPath();
        g.arc(cx, cy + r * 0.2, r * 0.13 * i, -Math.PI * 0.8, -Math.PI * 0.2);
        g.stroke();
      }
      break;
    }
    case 'chart': {
      g.fillStyle = '#0e1620';
      rr(cx - r * 1.05, cy - r * 0.75, r * 2.1, r * 1.5, r * 0.08);
      g.fill();
      g.shadowColor = 'transparent';
      const cols = [b.accent, '#ffffff', '#7fb2ff'];
      cols.forEach((col, k) => {
        g.strokeStyle = col;
        g.lineWidth = Math.max(1.2, r * 0.05);
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const yy = cy + r * (0.45 - 0.5 * Math.abs(Math.sin(t * (4 + k) + k)) * (0.5 + t * 0.5));
          if (i === 0) g.moveTo(cx - r * 0.92 + t * r * 1.84, yy);
          else g.lineTo(cx - r * 0.92 + t * r * 1.84, yy);
        }
        g.stroke();
      });
      break;
    }
    case 'drop': {
      g.fillStyle = b.accent === back ? b.fg : b.accent;
      g.beginPath();
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r * 0.2, cy - r * 0.5, cx + r * 0.7, cy - r * 0.05, cx + r * 0.7, cy + r * 0.3);
      g.arc(cx, cy + r * 0.3, r * 0.7, 0, Math.PI);
      g.bezierCurveTo(cx - r * 0.7, cy - r * 0.05, cx - r * 0.2, cy - r * 0.5, cx, cy - r);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.ellipse(cx - r * 0.28, cy + r * 0.22, r * 0.1, r * 0.25, -0.3, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'trunk': {
      g.fillStyle = '#5a3d2b';
      rr(cx - r * 1.0, cy - r * 0.62, r * 2.0, r * 1.24, r * 0.06);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(232,214,173,0.25)';
      g.font = `300 ${Math.round(r * 0.22)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) g.fillText('✦', cx - r * 0.85 + i * r * 0.34, cy - r * 0.45 + j * r * 0.3);
      g.fillStyle = '#c9a45c';
      for (const sx of [-0.55, 0.55]) g.fillRect(cx + sx * r - r * 0.06, cy - r * 0.62, r * 0.12, r * 1.24);
      g.fillRect(cx - r * 1.0, cy - r * 0.08, r * 2.0, r * 0.08);
      g.fillRect(cx - r * 0.12, cy - r * 0.18, r * 0.24, r * 0.26);
      break;
    }
    case 'cup': {
      g.fillStyle = '#f5f2ea';
      g.beginPath();
      g.moveTo(cx - r * 0.6, cy - r * 0.35);
      g.lineTo(cx + r * 0.6, cy - r * 0.35);
      g.lineTo(cx + r * 0.45, cy + r * 0.55);
      g.lineTo(cx - r * 0.45, cy + r * 0.55);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = '#f5f2ea';
      g.lineWidth = r * 0.1;
      g.beginPath();
      g.arc(cx + r * 0.62, cy, r * 0.22, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      g.fillRect(cx - r * 0.55, cy - r * 0.1, r * 1.1, r * 0.3);
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = Math.max(1, r * 0.05);
      for (const sx of [-0.2, 0.1]) {
        g.beginPath();
        g.moveTo(cx + sx * r, cy - r * 0.45);
        g.bezierCurveTo(cx + (sx - 0.15) * r, cy - r * 0.65, cx + (sx + 0.15) * r, cy - r * 0.75, cx + sx * r, cy - r * 0.95);
        g.stroke();
      }
      break;
    }
    case 'car': {
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      g.beginPath();
      g.moveTo(cx - r * 1.3, cy + r * 0.25);
      g.lineTo(cx - r * 1.25, cy - r * 0.05);
      g.quadraticCurveTo(cx - r * 0.6, cy - r * 0.15, cx - r * 0.35, cy - r * 0.42);
      g.quadraticCurveTo(cx + r * 0.2, cy - r * 0.55, cx + r * 0.55, cy - r * 0.2);
      g.quadraticCurveTo(cx + r * 1.25, cy - r * 0.15, cx + r * 1.35, cy + r * 0.05);
      g.lineTo(cx + r * 1.3, cy + r * 0.25);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = '#20242a';
      g.beginPath();
      g.moveTo(cx - r * 0.3, cy - r * 0.36);
      g.quadraticCurveTo(cx + r * 0.15, cy - r * 0.47, cx + r * 0.45, cy - r * 0.2);
      g.lineTo(cx - r * 0.45, cy - r * 0.18);
      g.closePath();
      g.fill();
      for (const wx of [-0.8, 0.8]) {
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(cx + wx * r, cy + r * 0.25, r * 0.28, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#9aa0a8';
        g.beginPath();
        g.arc(cx + wx * r, cy + r * 0.25, r * 0.15, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'landscape': {
      g.shadowColor = 'transparent';
      g.fillStyle = b.accent === back ? b.fg : b.accent;
      g.beginPath();
      g.arc(cx + r * 0.45, cy - r * 0.35, r * 0.32, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(cx - r * 1.3, cy + r * 0.6);
      g.lineTo(cx - r * 0.55, cy - r * 0.35);
      g.lineTo(cx - r * 0.15, cy + r * 0.1);
      g.lineTo(cx + r * 0.3, cy - r * 0.15);
      g.lineTo(cx + r * 1.2, cy + r * 0.6);
      g.closePath();
      g.fill();
      break;
    }
    case 'bar': {
      g.translate(cx, cy);
      g.rotate(-0.25);
      g.fillStyle = b.bg === back ? b.fg : b.bg;
      rr(-r * 1.1, -r * 0.4, r * 2.2, r * 0.8, r * 0.06);
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = b.accent;
      g.fillRect(-r * 1.1, -r * 0.08, r * 2.2, r * 0.16);
      g.fillStyle = dark;
      g.globalAlpha = 0.18;
      for (let i = 1; i < 5; i++) g.fillRect(-r * 1.1 + i * r * 0.44, -r * 0.4, r * 0.03, r * 0.8);
      break;
    }
  }
  g.restore();
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  const r = f((n >> 16) & 255), gg = f((n >> 8) & 255), bb = f(n & 255);
  return `#${((r << 16) | (gg << 8) | bb).toString(16).padStart(6, '0')}`;
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
