/**
 * Team livery: a 2048×1536 paint atlas (sRGB) + a half-res mask (R = bare carbon) per team.
 *
 * The hull region is painted texel-by-texel from 3D: every texel is mapped back onto the loft
 * (z, signed arc length → x, y, feature parameter) and the team's pattern is evaluated there,
 * so stripes follow the bodywork and nothing is mirrored between the two sides. Wordmarks are
 * drawn column-by-column along feature lines of the body (left side rotated 180° in the atlas so
 * it reads correctly from the left).
 */
import * as THREE from 'three';
import type { Team } from '../race/Teams.ts';
import {
  PAINT_W, PAINT_H, HULL_ROWS, HULL_Z0, HULL_Z1, MASK_SCALE, PAINT_CELL, PC, R_PAL, R_FLAP, R_MAIN, R_FWING,
  R_EP_OL, R_EP_OR, R_EP_IN, R_FIN_L, R_FIN_R, type Rect,
} from './carLayout.ts';
import {
  profileAt, profileAtS, profileAtParam, cockpitWeight, podWeight, sAtParam, HULL_ROW0, HULL_RHO, HULL_PX_PER_M,
  hullAtlasX, HULL_FRONT, HULL_REAR, type Profile,
} from './hull.ts';
import { FONT, canvas, ctx2d, paintWithFonts, contrastOn, fontsAreReady } from './carTextures.ts';
import { clamp, smooth } from './carMath.ts';

type RGB = [number, number, number];
/** paint albedo cap: nothing on the car is brighter than ~0.85 linear (sRGB ≈ 238) */
const MAXC = 238;
const rgb = (hex: string): RGB => {
  const c = new THREE.Color(hex); // hex is sRGB; Color stores linear → convert back for canvas bytes
  c.convertLinearToSRGB();
  const v: RGB = [c.r * 255, c.g * 255, c.b * 255];
  const m = Math.max(v[0], v[1], v[2]);
  const k = m > MAXC ? MAXC / m : 1;
  return [Math.round(v[0] * k), Math.round(v[1] * k), Math.round(v[2] * k)];
};
/** hex → albedo-capped hex (for canvas text/fills) */
export const safe = (hex: string) => hexOf(rgb(hex));
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const hexOf = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

const SPONSORS = ['HELIX', 'NORDVOLT', 'ARCLINE', 'MERIDIAN', 'OKTA', 'LUMEN', 'PRAXIS', 'SOLACE', 'TANGENT', 'VANTA', 'KORU', 'ZENITH'];

/** per-texel context handed to the pattern functions */
interface Tx {
  z: number;
  x: number; // signed (+ = left)
  y: number;
  s: number; // signed arc length
  kt: number; // feature parameter
  nx: number; // |profile normal x| (1 = vertical side)
  ny: number; // profile normal y (1 = facing up)
  pod: number;
}

interface Pal {
  P: RGB;
  S: RGB;
  A: RGB;
  I: RGB;
  K: RGB; // black
  W: RGB; // white
}

const PXM = 1 / HULL_PX_PER_M; // metres per texel (≈ 2.7 mm)
/** coverage of a soft edge: d < 0 inside */
const cov = (d: number, w = PXM * 1.2) => clamp(0.5 - d / w);

// ------------------------------------------------------------------------------------ patterns
type Pattern = (t: Tx, p: Pal) => RGB;

function sweep(t: Tx, p: Pal): RGB {
  // swoosh band rising from the lower nose to the top of the engine cover
  const base = 0.17 + 0.56 * smooth(2.3, -1.25, t.z);
  const slope = Math.max(0.2, t.nx);
  const d0 = (base - t.y) / slope; // <0 above lower edge
  const d1 = (t.y - (base + 0.11 + 0.03 * smooth(1, -1, t.z))) / slope;
  let c = p.P;
  const inBand = Math.min(cov(d0), cov(d1));
  c = mix(c, p.S, inBand);
  const acc = Math.min(cov((t.y - base) / slope), cov((base - 0.024 - t.y) / slope));
  c = mix(c, p.A, acc);
  // lower body in secondary behind the sidepod inlet
  const low = cov((t.y - (0.2 + 0.06 * smooth(0.3, -1.2, t.z))) / slope) * smooth(0.45, 0.3, t.z);
  c = mix(c, p.S, low);
  return c;
}

function split(t: Tx, p: Pal): RGB {
  const slope = Math.max(0.2, t.nx);
  const yl = 0.2 + 0.1 * smooth(2.8, 0.3, t.z) + 0.2 * smooth(0.3, -1.5, t.z);
  let c = p.P;
  c = mix(c, p.S, cov((t.y - yl) / slope));
  // accent pinstripe on the split
  c = mix(c, p.A, Math.min(cov((yl - t.y) / slope), cov((t.y - yl - 0.016) / slope)));
  // rear of the engine cover + fin area in secondary
  c = mix(c, p.S, cov(-(-1.25 - t.z + (t.y - 0.5) * 0.9)));
  // nose tip secondary
  c = mix(c, p.S, cov(2.62 - t.z));
  c = mix(c, p.A, Math.min(cov(2.6 - t.z), cov(t.z - 2.62)));
  return c;
}

function fade(t: Tx, p: Pal): RGB {
  // diagonal fade coordinate: 0 = primary, 1 = secondary
  const f = smooth(0.35, -1.25, t.z + (t.y - 0.45) * 0.9);
  // halftone dots in the transition, on an isometric grid in atlas space (z, s)
  const cell = 0.015;
  const gu = t.z / cell;
  const gv = t.s / cell + (Math.floor(gu) & 1 ? 0.5 : 0);
  const du = gu - Math.floor(gu) - 0.5;
  const dv = gv - Math.floor(gv) - 0.5;
  const d = Math.hypot(du, dv) * cell;
  const r = Math.sqrt(f) * cell * 0.62;
  let c = mix(p.P, p.S, f > 0.97 ? 1 : cov(d - r, PXM * 1.5));
  // accent pinstripe along the lower edge of the body (sidepod crease)
  const slope = Math.max(0.2, t.nx);
  const ya = 0.26 + 0.18 * smooth(1.6, -1.3, t.z);
  c = mix(c, p.A, Math.min(cov((ya - t.y) / slope), cov((t.y - ya - 0.014) / slope)) * smooth(2.9, 2.4, t.z + 0.4));
  // dark lower body
  c = mix(c, p.S, cov((t.y - (ya - 0.06)) / slope));
  return c;
}

function stripe(t: Tx, p: Pal): RGB {
  let c = p.P;
  // central racing stripe on top, flanked by thin secondary lines
  const as = Math.abs(t.s);
  const w = 0.055;
  c = mix(c, p.S, cov(as - (w + 0.018)));
  c = mix(c, p.A, cov(as - w));
  // side stripe on the sidepod
  const slope = Math.max(0.2, t.nx);
  const ys = 0.44 + 0.13 * smooth(0.2, -1.3, t.z) - 0.2 * smooth(0.5, 2.6, t.z);
  const d = Math.abs(t.y - ys) / slope;
  c = mix(c, p.A, cov(d - 0.018));
  c = mix(c, p.S, cov((t.y - (ys - 0.07)) / slope));
  return c;
}

function block(t: Tx, p: Pal): RGB {
  let c = p.P;
  const slope = Math.max(0.2, t.nx);
  // big sidepod block: parallelogram in side view
  const inZ = Math.min(cov(t.z - 0.42 + (t.y - 0.3) * 0.5), cov(-1.05 - t.z + (t.y - 0.3) * 0.5));
  const inY = cov((t.y - 0.6) / slope);
  c = mix(c, p.S, inZ * inY);
  // nose block
  c = mix(c, p.S, cov(2.05 - t.z - (t.y - 0.3) * 0.4));
  // engine cover top block + accent slash
  const top = cov(-(t.y - 0.72) / slope) * cov(t.z + 0.25) * cov(-1.9 - t.z);
  c = mix(c, p.S, top);
  const slash = Math.min(cov(t.z - (-1.2) + (t.y - 0.5) * 0.6), cov(-1.28 - t.z - (t.y - 0.5) * 0.6));
  c = mix(c, p.A, slash);
  const slash2 = Math.min(cov(t.z - 0.52 + (t.y - 0.3) * 0.5), cov(0.47 - t.z - (t.y - 0.3) * 0.5));
  c = mix(c, p.A, slash2 * cov((t.y - 0.62) / slope));
  return c;
}

function arrow(t: Tx, p: Pal): RGB {
  let c = p.P;
  const slope = Math.max(0.2, t.nx);
  // thick forward-pointing chevron along the sidepod/engine cover, V-notched tail
  const tipZ = 0.66;
  const tipY = 0.44;
  const dz = tipZ - t.z; // > 0 behind the tip
  const mid = tipY + dz * 0.03;
  const up = tipY + dz * 0.2;
  const lo = tipY - dz * 0.14;
  const tail = -1.3 + Math.abs(t.y - mid) * 1.35;
  const body = Math.min(cov(-dz), cov((t.y - up) / slope), cov((lo - t.y) / slope), cov(tail - t.z));
  c = mix(c, p.S, body);
  // accent outline
  const edge = Math.min(Math.abs(t.y - up) / slope, Math.abs(t.y - lo) / slope, Math.abs(t.z - tail));
  c = mix(c, p.A, cov(edge - 0.008) * cov(-dz + 0.005) * cov(tail - 0.012 - t.z + 0.02) * cov(Math.max((t.y - up - 0.01) / slope, (lo - 0.01 - t.y) / slope)));
  // secondary pinstripe along the nose and accent nose tip
  const ys = 0.2 + 0.36 * smooth(2.9, 0.9, t.z);
  c = mix(c, p.S, cov(Math.abs(t.y - ys) / slope - 0.01) * cov(t.z - 0.66) * cov(2.62 - t.z));
  c = mix(c, p.A, cov(2.64 - t.z));
  return c;
}

// ------------------------------------------------------------------------------------ the real teams' layouts
// Each follows how that team's current car is painted (blocks of colour, where the
// dark lower bodywork starts, the pinstripes) — no logos.
/** height of the dark lower bodywork along the car (sidepod undercut rising to the engine cover) */
const lowLine = (z: number, a = 0.24, b = 0.08) => a + b * smooth(0.4, -1.4, z);
/** a thin line at height yl (pinstripe), width w (m) */
const line = (t: Tx, yl: number, w: number) => cov(Math.abs(t.y - yl) / Math.max(0.2, t.nx) - w);

function ferrari(t: Tx, p: Pal): RGB {
  // red, black lower flanks, a white line along the sidepod shoulder into the engine cover
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  c = mix(c, p.K, cov((t.y - lowLine(t.z, 0.25, 0.1)) / slope) * smooth(2.2, 1.6, t.z));
  const yl = 0.48 + 0.16 * smooth(0.2, -1.7, t.z);
  c = mix(c, p.W, line(t, yl, 0.011) * smooth(0.55, 0.35, t.z) * smooth(-2.1, -1.8, t.z));
  // white on the nose tip
  c = mix(c, p.W, cov(2.72 - t.z));
  return c;
}

function mercedes(t: Tx, p: Pal): RGB {
  // silver on top and above the shoulder line, black flanks and lower body, a teal line between
  const slope = Math.max(0.2, t.nx);
  const ys = 0.46 + 0.14 * smooth(0.3, -1.4, t.z) - 0.1 * smooth(0.8, 2.4, t.z);
  // the silver spine: nose, cockpit surround, engine cover; the sidepods are black
  const top = t.ny > 0.42 && t.y > 0.36 && Math.abs(t.x) < 0.3 ? 1 : 0;
  let c = mix(p.S, p.P, Math.max(top, cov((ys - t.y) / slope) * (Math.abs(t.x) < 0.42 ? 1 : 0)));
  c = mix(c, p.A, line(t, ys, 0.008) * (1 - top));
  // teal washing across the back of the engine cover
  c = mix(c, p.A, smooth(-1.55, -2.05, t.z) * top * 0.6);
  return c;
}

function redbull(t: Tx, p: Pal): RGB {
  // matte navy; a red flash along the engine cover, red and yellow on the nose, red floor line
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  const band = Math.min(cov(-1.95 - t.z), cov(t.z + 0.25)) * Math.min(cov((0.5 + 0.06 * (t.z + 1) - t.y) / slope), cov((t.y - 0.78) / slope));
  c = mix(c, p.S, band * smooth(0.3, 0.6, t.nx));
  c = mix(c, p.S, cov(2.25 - t.z) * cov((t.y - 0.34) / slope));
  c = mix(c, p.A, cov(2.7 - t.z));
  c = mix(c, p.S, line(t, lowLine(t.z, 0.2, 0.05), 0.012) * smooth(1.6, 1.2, t.z));
  return c;
}

function mclaren(t: Tx, p: Pal): RGB {
  // papaya top and nose, anthracite sidepods and lower body, papaya engine-cover fin
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  const ys = 0.52 + 0.12 * smooth(0.3, -1.5, t.z);
  const dark = cov((t.y - ys) / slope) * smooth(1.3, 0.8, t.z) * (t.ny > 0.55 ? 0.15 : 1);
  c = mix(c, p.S, dark);
  // papaya line along the top of the dark section
  c = mix(c, p.P, line(t, ys, 0.009) * smooth(1.3, 0.8, t.z));
  return c;
}

function aston(t: Tx, p: Pal): RGB {
  // racing green, lime pinstripe along the sidepod into the nose, black lower body
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  c = mix(c, p.S, cov((t.y - lowLine(t.z, 0.26, 0.1)) / slope));
  const ys = 0.42 + 0.2 * smooth(0.3, -1.6, t.z) - 0.18 * smooth(0.6, 2.7, t.z);
  c = mix(c, p.A, line(t, ys, 0.012) * smooth(-2.0, -1.7, t.z));
  // lime along the centre of the nose
  c = mix(c, p.A, cov(Math.abs(t.s) - 0.012) * smooth(0.9, 1.3, t.z));
  return c;
}

function alpine(t: Tx, p: Pal): RGB {
  // blue at the front, a diagonal into pink along the sidepods and engine cover, black lower
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  const diag = cov(t.z - 0.1 + (t.y - 0.45) * 1.1);
  c = mix(c, p.S, diag);
  c = mix(c, p.W, cov(Math.abs(t.z - 0.1 + (t.y - 0.45) * 1.1) - 0.012) * smooth(0.25, 0.5, t.y));
  c = mix(c, p.K, cov((t.y - lowLine(t.z, 0.24, 0.08)) / slope));
  return c;
}

function williams(t: Tx, p: Pal): RGB {
  // dark navy upper, bright blue sidepods sweeping up to the engine cover, white pinstripe
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  const ys = 0.36 + 0.3 * smooth(0.5, -1.6, t.z) - 0.1 * smooth(0.6, 2.5, t.z);
  c = mix(c, p.S, cov((t.y - ys) / slope) * (t.ny > 0.7 ? 0.2 : 1));
  c = mix(c, p.W, line(t, ys, 0.007) * smooth(-2.0, -1.7, t.z));
  c = mix(c, p.K, cov((t.y - lowLine(t.z, 0.2, 0.05)) / slope));
  return c;
}

function haas(t: Tx, p: Pal): RGB {
  // white front half, black rear half, a red slash where they meet
  const k = t.z + 0.1 + (t.y - 0.45) * 0.9;
  let c = mix(p.S, p.P, cov(-k));
  c = mix(c, p.A, cov(Math.abs(k + 0.03) - 0.028));
  return c;
}

function racingbulls(t: Tx, p: Pal): RGB {
  // white, a sweep of blue from the sidepod inlet up over the engine cover, red flash
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  const base = 0.2 + 0.5 * smooth(0.6, -1.5, t.z);
  c = mix(c, p.S, cov((t.y - base - 0.2) / slope) * smooth(0.9, 0.5, t.z));
  // blue under the nose
  c = mix(c, p.S, cov((t.y - 0.3) / slope) * smooth(0.9, 1.3, t.z));
  c = mix(c, p.A, line(t, base + 0.2, 0.01) * smooth(0.9, 0.5, t.z));
  return c;
}

function audi(t: Tx, p: Pal): RGB {
  // titanium front, black rear, lava-red line on the break and red around the airbox
  const k = t.z + 0.35 + (t.y - 0.45) * 0.6;
  let c = mix(p.S, p.P, cov(-k));
  c = mix(c, p.A, cov(Math.abs(k) - 0.013));
  c = mix(c, p.A, cov(-0.35 - t.z) * cov(t.z - 0.1) * (t.y > 0.8 ? 1 : 0));
  return c;
}

function cadillac(t: Tx, p: Pal): RGB {
  // black, a white band sweeping from the nose along the sidepods, a thin gold line
  const slope = Math.max(0.2, t.nx);
  let c = p.P;
  const ys = 0.34 + 0.24 * smooth(0.4, -1.6, t.z) - 0.12 * smooth(0.6, 2.6, t.z);
  const band = Math.min(cov((ys - t.y) / slope), cov((t.y - ys - 0.1) / slope));
  c = mix(c, p.S, band * smooth(-2.0, -1.6, t.z));
  c = mix(c, p.A, line(t, ys + 0.115, 0.006) * smooth(-2.0, -1.6, t.z));
  return c;
}

const PATTERNS: Record<Team['pattern'], Pattern> = {
  sweep, split, fade, stripe, block, arrow,
  ferrari, mercedes, redbull, mclaren, aston, alpine, williams, haas, racingbulls, audi, cadillac,
};

// ------------------------------------------------------------------------------------ hull text
interface HullTextOpts {
  text: string;
  zFront: number;
  zRear: number;
  side: 1 | -1;
  guide: { kt: number } | { y: number; ktMin: number; ktMax: number };
  height: number; // metres
  color: string;
  weight?: number;
  italic?: boolean;
  track?: number;
}

function sForY(pr: Profile, y: number, ktMin: number, ktMax: number): number {
  // walk the dense profile between the params and find y crossing (outer side)
  const a = profileAtParam(pr, ktMin);
  let best = a.s;
  let bestD = 1e9;
  for (let k = ktMin; k <= ktMax; k += 0.02) {
    const q = profileAtParam(pr, k);
    const d = Math.abs(q.y - y);
    if (d < bestD) {
      bestD = d;
      best = q.s;
    }
  }
  return best;
}

function hullText(g: CanvasRenderingContext2D, m: CanvasRenderingContext2D | null, o: HullTextOpts) {
  const Lpx = Math.ceil((o.zFront - o.zRear) * HULL_PX_PER_M);
  const Hpx = Math.ceil(o.height * HULL_RHO * 1.35);
  const aspect = HULL_PX_PER_M / HULL_RHO; // canvas x-scale for physically square glyphs
  const fontPx = o.height * HULL_RHO;
  const render = (color: string) => {
    const off = canvas(Lpx, Hpx);
    const oc = ctx2d(off);
    oc.translate(Lpx / 2, Hpx / 2);
    if (o.side > 0) oc.rotate(Math.PI);
    oc.font = `${o.italic === false ? '' : 'italic '}${o.weight ?? 900} ${fontPx}px ${FONT}`;
    (oc as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${fontPx * (o.track ?? 0.02)}px`;
    const w = oc.measureText(o.text).width * aspect;
    const k = Math.min(1, (Lpx * 0.98) / w);
    oc.scale(aspect * k, 1);
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';
    oc.fillStyle = color;
    oc.fillText(o.text, 0, fontPx * 0.04);
    return off;
  };
  const off = render(o.color);
  const offM = m ? render('#000') : null;
  const x0 = Math.round(hullAtlasX(o.zRear));
  for (let c = 0; c < Lpx; c++) {
    const z = o.zRear + (c + 0.5) / HULL_PX_PER_M;
    const pr = profileAt(z);
    const s = 'kt' in o.guide ? profileAtParam(pr, o.guide.kt).s : sForY(pr, o.guide.y, o.guide.ktMin, o.guide.ktMax);
    const row = HULL_ROW0 - s * o.side * HULL_RHO;
    g.drawImage(off, c, 0, 1, Hpx, x0 + c, row - Hpx / 2, 1, Hpx);
    if (m && offM && (c & 1) === 0) {
      m.drawImage(offM, c, 0, 2, Hpx, (x0 + c) * MASK_SCALE, (row - Hpx / 2) * MASK_SCALE, 1, Hpx * MASK_SCALE);
    }
  }
}

// ------------------------------------------------------------------------------------ rect helpers
function rectText(g: CanvasRenderingContext2D, r: Rect, s: string, color: string, hFrac: number, opts: { rot180?: boolean; flipX?: boolean; flipY?: boolean; aspect?: number; weight?: number; italic?: boolean; cx?: number; cy?: number; wFrac?: number } = {}) {
  const px = r.h * hFrac;
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  g.translate(r.x + r.w * (opts.cx ?? 0.5), r.y + r.h * (opts.cy ?? 0.5));
  if (opts.rot180) g.rotate(Math.PI);
  if (opts.flipX) g.scale(-1, 1);
  if (opts.flipY) g.scale(1, -1);
  g.font = `${opts.italic === false ? '' : 'italic '}${opts.weight ?? 900} ${px}px ${FONT}`;
  const a = opts.aspect ?? 1;
  const w = g.measureText(s).width * a;
  const k = Math.min(1, (r.w * (opts.wFrac ?? 0.92)) / w);
  g.scale(a * k, 1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(s, 0, px * 0.04);
  g.restore();
}

// ------------------------------------------------------------------------------------ main
export interface LiverySet {
  map: THREE.Texture;
  mask: THREE.Texture;
}
const cache = new Map<string, { set: LiverySet; refs: number }>();

export function acquireLivery(team: Team): LiverySet {
  const hit = cache.get(team.id);
  if (hit) {
    hit.refs++;
    return hit.set;
  }
  const set = buildLivery(team);
  cache.set(team.id, { set, refs: 1 });
  return set;
}
export function releaseLivery(team: Team) {
  const hit = cache.get(team.id);
  if (!hit) return;
  if (--hit.refs <= 0) {
    hit.set.map.dispose();
    hit.set.mask.dispose();
    cache.delete(team.id);
  }
}

function buildLivery(team: Team): LiverySet {
  const c = canvas(PAINT_W, PAINT_H);
  const mc = canvas(PAINT_W * MASK_SCALE, PAINT_H * MASK_SCALE);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mask = new THREE.CanvasTexture(mc);
  mask.colorSpace = THREE.NoColorSpace;
  mask.anisotropy = 4;
  // the per-texel hull pass is font independent: keep it only until the webfont repaint has happened
  let hull: HullImg | null = null;
  let passes = 0;
  const paint = () => {
    if (!hull) hull = paintHull(team, palOf(team), PATTERNS[team.pattern]);
    paintLivery(team, ctx2d(c), ctx2d(mc), hull);
    map.needsUpdate = true;
    mask.needsUpdate = true;
    if (++passes >= 1 && fontsAreReady()) hull = null;
  };
  paintWithFonts(paint);
  return { map, mask };
}

interface HullImg {
  img: ImageData;
  mimg: ImageData;
}
function palOf(team: Team): Pal {
  return { P: rgb(team.primary), S: rgb(team.secondary), A: rgb(team.accent), I: rgb(team.ink), K: [14, 14, 16], W: [236, 236, 236] };
}

function paintLivery(teamIn: Team, g: CanvasRenderingContext2D, m: CanvasRenderingContext2D, hull: HullImg) {
  const team: Team = { ...teamIn, primary: safe(teamIn.primary), secondary: safe(teamIn.secondary), accent: safe(teamIn.accent), ink: safe(teamIn.ink) };
  const pal = palOf(team);
  const tIndex = Math.abs([...team.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  g.putImageData(hull.img, 0, 0);
  m.fillStyle = '#000';
  m.fillRect(0, 0, PAINT_W * MASK_SCALE, PAINT_H * MASK_SCALE);
  m.putImageData(hull.mimg, 0, 0);

  const sample = (z: number, kt: number, side: 1 | -1): RGB => {
    const s = sAtParam(z, kt) * side;
    const x = Math.round(hullAtlasX(z));
    const y = Math.round(HULL_ROW0 - s * HULL_RHO);
    const o = (y * PAINT_W + x) * 4;
    return [hull.img.data[o], hull.img.data[o + 1], hull.img.data[o + 2]];
  };
  const near = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60;
  const inkFor = (bg: RGB) => (near(bg, pal.P) ? team.ink : contrastOn(hexOf(bg)));

  // ---------------- wordmarks on the hull
  const small = SPONSORS[tIndex % SPONSORS.length];
  const small2 = SPONSORS[(tIndex + 5) % SPONSORS.length];
  for (const side of [1, -1] as const) {
    const sideCol = inkFor(sample(-0.3, 7.2, side));
    hullText(g, m, { text: team.sponsor, zFront: 0.2, zRear: -0.95, side, guide: { kt: 7.15 }, height: 0.1, color: sideCol });
    const coverCol = inkFor(sample(-0.85, 3.55, side));
    hullText(g, m, { text: team.sponsor, zFront: -0.42, zRear: -1.3, side, guide: { kt: 3.52 }, height: 0.058, color: coverCol });
    const noseCol = inkFor(sample(2.0, 3.7, side));
    hullText(g, m, { text: small, zFront: 2.3, zRear: 1.82, side, guide: { kt: 3.75 }, height: 0.04, color: noseCol, weight: 700 });
    const chCol = inkFor(sample(1.0, 5.2, side));
    hullText(g, m, { text: team.short, zFront: 1.2, zRear: 0.84, side, guide: { kt: 5.0 }, height: 0.038, color: chCol, weight: 700, italic: false, track: 0.12 });
    const lowCol = inkFor(sample(-1.7, 3.75, side));
    hullText(g, m, { text: small2, zFront: -1.5, zRear: -1.92, side, guide: { kt: 3.75 }, height: 0.034, color: lowCol, weight: 700 });
  }

  // ---------------- flat paint cells
  const cellCol: Record<number, string> = {
    [PC.primary]: team.primary,
    [PC.secondary]: team.secondary,
    [PC.accent]: team.accent,
    [PC.ink]: team.ink,
    [PC.black]: '#0e0e10',
    [PC.white]: '#ececec',
    [PC.inlet]: '#050506',
    [PC.carbon]: '#1b1c1f',
    [PC.halo]: team.pattern === 'split' || team.pattern === 'block' ? team.secondary : team.primary,
    [PC.mirror]: team.primary,
    [PC.airbox]: team.primary,
    [PC.fwFlap]: team.accent,
    [PC.fwFlap2]: team.primary,
    [PC.endplateIn]: team.secondary,
    [PC.primaryDark]: hexOf(shade(pal.P, 0.7)),
    [PC.chrome]: '#c9ccd1',
  };
  for (const k of Object.keys(cellCol)) {
    const i = Number(k);
    g.fillStyle = cellCol[i];
    g.fillRect(R_PAL.x + i * PAINT_CELL, R_PAL.y, PAINT_CELL, PAINT_CELL);
  }
  m.fillStyle = '#fff';
  m.fillRect((R_PAL.x + PC.carbon * PAINT_CELL) * MASK_SCALE, R_PAL.y * MASK_SCALE, PAINT_CELL * MASK_SCALE, PAINT_CELL * MASK_SCALE);

  const fillR = (r: Rect, col: string) => {
    g.fillStyle = col;
    g.fillRect(r.x, r.y, r.w, r.h);
  };
  const maskR = (r: Rect, on: boolean) => {
    m.fillStyle = on ? '#fff' : '#000';
    m.fillRect(r.x * MASK_SCALE, r.y * MASK_SCALE, r.w * MASK_SCALE, r.h * MASK_SCALE);
  };
  // rows of a rect for chord param b ∈ [b0,b1] (b up)
  const sub = (r: Rect, a0: number, a1: number, b0: number, b1: number): Rect => ({
    x: r.x + a0 * r.w,
    y: r.y + (1 - b1) * r.h,
    w: (a1 - a0) * r.w,
    h: (b1 - b0) * r.h,
  });

  // ---------------- rear wing. Chord param b: 0 = TE (upper) → 0.5 = LE → 1 = TE (lower); a = span −X → +X.
  // Upper surfaces face forward/up (read from the front: right = +X, up = toward TE → flipY);
  // lower surfaces face backward — that's what the chase cam sees (right = −X → flipX, up = toward TE).
  const flapLen = 0.98;
  const flapArc = 0.21;
  const aspFlap = ((R_FLAP.w / flapLen) / (R_FLAP.h / flapArc)) ** -1; // x-scale for square glyphs
  fillR(R_FLAP, team.primary);
  fillR(sub(R_FLAP, 0, 1, 0.0, 0.05), team.accent);
  fillR(sub(R_FLAP, 0, 1, 0.95, 1), team.accent);
  rectText(g, sub(R_FLAP, 0.1, 0.9, 0.09, 0.44), team.sponsor, team.ink, 0.85, { flipY: true, aspect: aspFlap });
  rectText(g, sub(R_FLAP, 0.08, 0.92, 0.56, 0.92), team.sponsor, team.ink, 0.85, { flipX: true, aspect: aspFlap });
  maskR(sub(R_FLAP, 0, 1, 0.46, 0.54), true);

  // main plane: upper = secondary with a primary TE band; lower = primary→secondary with a wordmark from behind
  const aspMain = ((R_MAIN.w / flapLen) / (R_MAIN.h / 0.62)) ** -1;
  fillR(R_MAIN, team.secondary);
  fillR(sub(R_MAIN, 0, 1, 0.0, 0.1), team.primary);
  fillR(sub(R_MAIN, 0, 1, 0.1, 0.13), team.accent);
  fillR(sub(R_MAIN, 0, 1, 0.62, 1), team.primary);
  fillR(sub(R_MAIN, 0, 1, 0.6, 0.62), team.accent);
  rectText(g, sub(R_MAIN, 0.2, 0.8, 0.66, 0.97), small, team.ink, 0.8, { flipX: true, aspect: aspMain, weight: 700 });
  rectText(g, sub(R_MAIN, 0.2, 0.8, 0.16, 0.44), team.short, contrastOn(team.secondary), 0.7, { flipY: true, aspect: aspMain, weight: 700, italic: false });
  maskR(sub(R_MAIN, 0, 1, 0.46, 0.58), true);

  // ---------------- rear-wing endplates (outer: readable from each side; inner: plain)
  for (const [r, _side] of [
    [R_EP_OL, 1],
    [R_EP_OR, -1],
  ] as [Rect, number][]) {
    fillR(r, team.primary);
    // lower third in secondary with an accent edge
    g.fillStyle = team.secondary;
    g.beginPath();
    g.moveTo(r.x, r.y + r.h * 0.62);
    g.lineTo(r.x + r.w, r.y + r.h * 0.5);
    g.lineTo(r.x + r.w, r.y + r.h);
    g.lineTo(r.x, r.y + r.h);
    g.fill();
    g.strokeStyle = team.accent;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(r.x, r.y + r.h * 0.62);
    g.lineTo(r.x + r.w, r.y + r.h * 0.5);
    g.stroke();
    rectText(g, sub(r, 0.08, 0.92, 0.6, 0.86), team.sponsor, team.ink, 0.8, { aspect: 0.9 });
    rectText(g, sub(r, 0.15, 0.85, 0.12, 0.36), team.short, contrastOn(team.secondary), 0.7, { aspect: 0.9, weight: 700, italic: false });
  }
  fillR(R_EP_IN, team.secondary);
  fillR(sub(R_EP_IN, 0, 1, 0.8, 1), team.primary);
  maskR(sub(R_EP_IN, 0, 1, 0, 0.35), true);

  // ---------------- front-wing upper flaps (a: right tip → centre | centre → left tip; b: e2 [0,.5], e3 [.5,1])
  fillR(R_FWING, team.primary);
  fillR(sub(R_FWING, 0, 1, 0.5, 1), team.accent === '#ffffff' ? team.secondary : team.accent);
  fillR(sub(R_FWING, 0, 0.12, 0, 1), team.secondary);
  fillR(sub(R_FWING, 0.88, 1, 0, 1), team.secondary);
  fillR(sub(R_FWING, 0, 1, 0.26, 0.5), team.secondary);
  // lower surfaces carbon
  maskR(sub(R_FWING, 0, 1, 0.26, 0.5), true);
  maskR(sub(R_FWING, 0, 1, 0.76, 1), true);

  // ---------------- shark fin sides
  for (const r of [R_FIN_L, R_FIN_R]) {
    fillR(r, team.primary);
    fillR(sub(r, 0, 1, 0.86, 1), team.accent);
  }
}

function paintHull(team: Team, pal: Pal, pattern: Pattern): HullImg {
  const W = PAINT_W;
  const H = HULL_ROWS;
  const img = new ImageData(W, H);
  const MW = W * MASK_SCALE;
  const MH = H * MASK_SCALE;
  const mimg = new ImageData(MW, MH);
  const d = img.data;
  const md = mimg.data;
  const carbonAmt = team.carbon;
  const inletCol: RGB = [6, 6, 7];
  const seatCol: RGB = [12, 12, 13];
  const carbonCol: RGB = [27, 28, 31];
  // panel lines as (kt, zFront, zRear)
  const panelKt: [number, number, number][] = [
    [4.02, 0.35, -1.45],
    [2.9, -0.2, -1.6],
  ];
  const panelZ: [number, number, number][] = [
    // (z, ktMin, ktMax)
    [1.95, 0, 10.5],
    [-1.47, 0, 10],
    [0.86, 2.8, 10],
  ];
  const tx: Tx = { z: 0, x: 0, y: 0, s: 0, kt: 0, nx: 0, ny: 0, pod: 0 };
  // sidepod-inlet transition: the lip/mouth faces forward, so it gets very few atlas columns (u = z).
  // Colour it by feature parameter only, sampled from the section just behind the lip.
  const ZT0 = 0.285;
  const ZT1 = 0.414;
  const prT = profileAt(ZT0);
  for (let px = 0; px < W; px++) {
    const z = HULL_Z0 + ((px + 0.5) / W) * (HULL_Z1 - HULL_Z0);
    const zc = Math.min(HULL_FRONT, Math.max(HULL_REAR, z));
    const pr = profileAt(zc);
    const cw = cockpitWeight(zc);
    const pw = podWeight(zc);
    const lineS = panelKt.filter((q) => z <= q[1] && z >= q[2]).map((q) => profileAtParam(pr, q[0]).s);
    const zLine = panelZ.find((q) => Math.abs(z - q[0]) < PXM * 0.9);
    // forward-facing test for the sidepod mouth: compare with a slice 12 mm ahead
    const prF = zc > 0.26 && zc < 0.42 ? profileAt(zc + 0.012) : null;
    const facesForward = (pf: Profile, q: { x: number; y: number; kt: number }) => {
      const a = profileAtParam(pf, q.kt);
      return Math.hypot(a.x - q.x, a.y - q.y) / 0.012 > 1.1;
    };
    for (const side of [1, -1]) {
      for (let k = 0; k < H / 2; k++) {
        const row = side > 0 ? HULL_ROW0 - 1 - k : HULL_ROW0 + k;
        const s = (k + 0.5) / HULL_RHO;
        const o = (row * W + px) * 4;
        let col: RGB;
        let carbon = 0;
        if (s >= pr.total) {
          col = carbonCol;
          carbon = 1;
        } else {
          const q = profileAtS(pr, s);
          tx.z = zc;
          tx.x = q.x * side;
          tx.y = q.y;
          tx.s = s * side;
          tx.kt = q.kt;
          tx.nx = Math.abs(q.nx);
          tx.ny = q.ny;
          tx.pod = pw;
          if (cw > 0.5 && q.kt < 2.02) {
            col = seatCol;
          } else if (prF && q.kt > 6.75 && q.kt < 8.2 && facesForward(prF, q)) {
            col = inletCol;
          } else {
            if (zc > ZT0 && zc < ZT1 && q.kt > 4.2 && q.kt < 9.95) {
              const a = profileAtParam(prT, q.kt);
              const qa = profileAtS(prT, a.s);
              tx.z = ZT0;
              tx.x = a.x * side;
              tx.y = a.y;
              tx.s = a.s * side;
              tx.nx = Math.abs(qa.nx);
              tx.ny = qa.ny;
            }
            col = pattern(tx, pal);
            // exposed carbon: underside + lower flanks, more with team.carbon
            const lowKt = 9.35 - carbonAmt * 2.4 + 0.5 * smooth(0.4, 1.4, zc) * (1 - pw);
            const cv = cov((lowKt - q.kt) * 0.05, 0.002);
            // noses of carbon-heavy cars: bare underside
            const noseUnder = carbonAmt > 0.3 ? cov((10.2 - carbonAmt * 1.5 - q.kt) * 0.05, 0.002) * smooth(1.4, 1.8, zc) : 0;
            // rear engine cover in carbon for carbon-heavy liveries
            const rearTop = carbonAmt > 0.42 ? smooth(-1.55, -1.75, zc) : 0;
            carbon = Math.max(cv, noseUnder, rearTop, q.kt > 10 ? 1 : 0);
            if (carbon > 0.5) col = carbonCol;
            // panel lines
            let pl = 0;
            for (const ls of lineS) if (Math.abs(s - ls) < PXM * 0.7) pl = 1;
            if (zLine && q.kt >= zLine[1] && q.kt <= zLine[2]) pl = 1;
            if (pl) col = shade(col, 0.55);
            else if (carbon < 0.5) {
              // quarter-turn fasteners beside the panel lines (~9 mm heads every 11 cm)
              const FP = 0.11;
              const R2 = (PXM * 1.7) ** 2;
              let fd = Infinity;
              for (const ls of lineS) {
                const ds = Math.abs(s - ls) - PXM * 4;
                const zz = ((z % FP) + FP) % FP;
                const dz = Math.min(zz, FP - zz);
                fd = Math.min(fd, ds * ds + dz * dz);
              }
              const zf = panelZ.find((p) => Math.abs(Math.abs(z - p[0]) - PXM * 4) < PXM * 2);
              if (zf && q.kt >= zf[1] && q.kt <= zf[2]) {
                const ss = ((s % FP) + FP) % FP;
                const dsv = Math.min(ss, FP - ss);
                const dz = Math.abs(z - zf[0]) - PXM * 4;
                fd = Math.min(fd, dsv * dsv + dz * dz);
              }
              if (fd < R2) col = shade(col, fd < R2 * 0.3 ? 0.5 : 0.72);
            }
            // cooling louvres on the sidepod downwash ramp
            if (zc < -0.28 && zc > -0.7 && q.kt > 5.15 && q.kt < 5.85) {
              const f = (zc + 10) / 0.024;
              if (f - Math.floor(f) < 0.34) col = [8, 8, 9];
            }
          }
        }
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
        if ((px & 1) === 0 && (row & 1) === 0) {
          const mo = ((row >> 1) * MW + (px >> 1)) * 4;
          const v = Math.round(carbon * 255);
          md[mo] = v;
          md[mo + 1] = v;
          md[mo + 2] = v;
          md[mo + 3] = 255;
        }
      }
    }
  }
  void MH;
  return { img, mimg };
}
