/**
 * Canvas-generated textures for the car: carbon weave (shared), wheel/tyre atlas (shared),
 * motion-blur disc (shared), per-car trim palette + emissive masks, per-driver helmet/decal sheet.
 */
import * as THREE from 'three';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import type { Team, Driver } from '../race/Teams.ts';
import {
  TRIM_W, TRIM_H, TRIM_CELL, TC, TRIM_PROPS, R_DISPLAY, R_LEDS,
  WHEEL_TEX_W, WHEEL_TEX_H, R_SIDEWALL, R_TREAD, R_RIMFACE, WC, WHEEL_PROPS, WHEEL_CELL,
  SIDEWALL_R0, SIDEWALL_R1, RIM_R, WHEEL_R,
  DRV_W, DRV_H, R_HELMET, R_NUM_NOSE, R_NUM_FIN_L, R_NUM_FIN_R, R_CODE_L, R_CODE_R, type Rect,
} from './carLayout.ts';

export const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';

// ------------------------------------------------------------------------------------ font readiness
let fontsReady = false;
const repaintQueue: (() => void)[] = [];
export const fontsLoaded: Promise<void> = (typeof document !== 'undefined' && document.fonts
  ? Promise.all([document.fonts.load(`900 64px "Titillium Web"`), document.fonts.load(`700 64px "Titillium Web"`)]).then(() => undefined)
  : Promise.resolve()
).then(
  () => {
    fontsReady = true;
    for (const f of repaintQueue.splice(0)) f();
  },
  () => {
    fontsReady = true;
  },
);
export function fontsAreReady() {
  return fontsReady;
}
/** paint now; if the webfont wasn't ready yet, paint again once it is */
export function paintWithFonts(paint: () => void) {
  paint();
  if (!fontsReady) repaintQueue.push(paint);
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
export function ctx2d(c: HTMLCanvasElement) {
  return c.getContext('2d', { willReadFrequently: false })!;
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat = false, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// deterministic hash noise
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 10000) / 10000;
}

// ------------------------------------------------------------------------------------ carbon weave
export interface CarbonSet {
  map: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
}
let carbonCache: CarbonSet | null = null;
export function carbonTextures(): CarbonSet {
  if (carbonCache) return carbonCache;
  const S = 512;
  const TOWS = 12;
  const tw = S / TOWS;
  const col = canvas(S, S);
  const nor = canvas(S, S);
  const rou = canvas(S, S);
  const ic = new ImageData(S, S);
  const inn = new ImageData(S, S);
  const ir = new ImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = Math.floor(x / tw);
      const j = Math.floor(y / tw);
      const fx = x / tw - i;
      const fy = y / tw - j;
      const warp = ((i + j) & 3) < 2; // 2×2 twill
      // across-tow coordinate (0..1) and along-tow
      const across = warp ? fx : fy;
      const along = warp ? fy : fx;
      const bulge = Math.sin(Math.PI * across);
      const fibre = hash(warp ? x : y, warp ? Math.floor(y / 3) : Math.floor(x / 3)) * 0.5 + hash(warp ? x : y, 7) * 0.5;
      // crossing points darken the ends of each float
      const seg = warp ? ((j + i) & 3) : ((i + j + 2) & 3);
      const endDark = 1 - 0.18 * Math.pow(Math.abs((seg + along) / 2 - 1), 4);
      let b = (warp ? 0.2 : 0.13) + 0.06 * bulge + 0.03 * fibre;
      b *= endDark;
      const edge = Math.min(across, 1 - across);
      if (edge < 0.05) b *= 0.55 + 9 * edge;
      const o = (y * S + x) * 4;
      const v = Math.round(Math.min(1, b) * 255);
      ic.data[o] = v;
      ic.data[o + 1] = Math.round(v * 1.02);
      ic.data[o + 2] = Math.round(v * 1.1);
      ic.data[o + 3] = 255;
      // normal: tow cylinder cross-section
      const slope = Math.cos(Math.PI * across) * 0.45;
      const nx = warp ? slope : 0;
      const ny = warp ? 0 : slope;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      inn.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      inn.data[o + 1] = Math.round((-ny * 0.5 + 0.5) * 255);
      inn.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      inn.data[o + 3] = 255;
      const r = 0.32 + 0.12 * (1 - bulge) + 0.08 * fibre;
      ir.data[o] = 0;
      ir.data[o + 1] = Math.round(r * 255);
      ir.data[o + 2] = 0;
      ir.data[o + 3] = 255;
    }
  }
  ctx2d(col).putImageData(ic, 0, 0);
  ctx2d(nor).putImageData(inn, 0, 0);
  ctx2d(rou).putImageData(ir, 0, 0);
  carbonCache = { map: tex(col, true, true, 16), normal: tex(nor, false, true, 16), rough: tex(rou, false, true, 16) };
  return carbonCache;
}

// ------------------------------------------------------------------------------------ wheel atlas
export const COMPOUNDS = {
  soft: '#e8242c',
  medium: '#f5c400',
  hard: '#f0f0f0',
  inter: '#3fb83f',
  wet: '#1f6fe0',
} as const;
export type Compound = keyof typeof COMPOUNDS;

export interface WheelSet {
  map: THREE.Texture;
  orm: THREE.Texture;
  blur: THREE.Texture;
}
const wheelCache = new Map<string, WheelSet>();
export function wheelTextures(compound: Compound = 'soft'): WheelSet {
  const hit = wheelCache.get(compound);
  if (hit) return hit;
  const band = COMPOUNDS[compound];
  const c = canvas(WHEEL_TEX_W, WHEEL_TEX_H);
  const o = canvas(WHEEL_TEX_W, WHEEL_TEX_H);
  const bl = canvas(512, 512);
  const set: WheelSet = { map: tex(c, true), orm: tex(o, false), blur: tex(bl, true) };
  set.map.anisotropy = 8;
  const paint = () => {
    const g = ctx2d(c);
    const go = ctx2d(o);
    // base rubber
    g.fillStyle = '#131313';
    g.fillRect(0, 0, WHEEL_TEX_W, WHEEL_TEX_H);
    go.fillStyle = 'rgb(0, 214, 0)';
    go.fillRect(0, 0, WHEEL_TEX_W, WHEEL_TEX_H);
    // sidewall: moulded rings + band + lettering. v=0 at the bead (bottom row), v=1 near the shoulder (top)
    const sw = R_SIDEWALL;
    const rowOf = (r: number) => sw.y + sw.h - ((r - SIDEWALL_R0) / (SIDEWALL_R1 - SIDEWALL_R0)) * sw.h;
    const grd = g.createLinearGradient(0, sw.y, 0, sw.y + sw.h);
    grd.addColorStop(0, '#1a1a1a');
    grd.addColorStop(0.5, '#151515');
    grd.addColorStop(1, '#101010');
    g.fillStyle = grd;
    g.fillRect(sw.x, sw.y, sw.w, sw.h);
    // fine moulded rings
    for (const r of [0.238, 0.248, 0.334]) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(sw.x, rowOf(r) - 1, sw.w, 2);
    }
    // compound band ring
    const bandR0 = 0.254;
    const bandR1 = 0.262;
    g.fillStyle = band;
    g.fillRect(sw.x, rowOf(bandR1), sw.w, rowOf(bandR0) - rowOf(bandR1));
    go.fillStyle = 'rgb(0, 150, 0)';
    go.fillRect(sw.x, rowOf(bandR1), sw.w, rowOf(bandR0) - rowOf(bandR1));
    // lettering: circumference ≈ 2π·0.3 m ↔ 2048 px; radial 0.11 m ↔ 256 px → squash x
    const pxPerMu = sw.w / (2 * Math.PI * 0.3);
    const pxPerMv = sw.h / (SIDEWALL_R1 - SIDEWALL_R0);
    const sq = pxPerMu / pxPerMv;
    const text = (s: string, u: number, rMid: number, hM: number, color: string, weight = 900, track = 0.08) => {
      const fontPx = hM * pxPerMv;
      g.save();
      g.translate(sw.x + u * sw.w, rowOf(rMid));
      g.scale(sq, 1);
      g.font = `${weight} ${fontPx}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${fontPx * track}px`;
      g.fillStyle = color;
      g.fillText(s, 0, 0);
      g.restore();
      go.save();
      go.translate(sw.x + u * sw.w, rowOf(rMid));
      go.scale(sq, 1);
      go.font = `${weight} ${fontPx}px ${FONT}`;
      go.textAlign = 'center';
      go.textBaseline = 'middle';
      go.fillStyle = 'rgb(0, 140, 0)';
      go.fillText(s, 0, 0);
      go.restore();
    };
    for (const u of [0.25, 0.75]) {
      text('VELTRA', u, 0.297, 0.052, '#e9e9e9', 900, 0.1);
    }
    for (const u of [0.0, 0.5, 1.0]) {
      text('CORSA', u, 0.297, 0.052, band, 900, 0.06);
    }
    for (const u of [0.125, 0.375, 0.625, 0.875]) text(compound.toUpperCase(), u, 0.279, 0.016, '#bdbdbd', 700, 0.3);
    // tread: slight scuffing/graining
    const tr = R_TREAD;
    g.fillStyle = '#161616';
    g.fillRect(tr.x, tr.y, tr.w, tr.h);
    for (let i = 0; i < 2400; i++) {
      const x = hash(i, 3) * tr.w;
      const y = tr.y + hash(i, 5) * tr.h;
      g.fillStyle = `rgba(${hash(i, 9) > 0.5 ? '40,40,40' : '8,8,8'},0.5)`;
      g.fillRect(x, y, 2 + hash(i, 11) * 10, 1);
    }
    go.fillStyle = 'rgb(0, 190, 0)';
    go.fillRect(tr.x, tr.y, tr.w, tr.h);
    // metal palette cells
    const cells: Record<number, string> = {
      [WC.rimMetal]: '#26282c',
      [WC.rimLip]: '#9a9ea5',
      [WC.nut]: '#d8252b',
      [WC.hub]: '#303338',
      [WC.barrel]: '#1b1c1f',
      [WC.valve]: '#c9c9c9',
      [WC.rubber]: '#121212',
    };
    for (const k of Object.keys(cells)) {
      const i = Number(k);
      const x = 192 + i * WHEEL_CELL;
      g.fillStyle = cells[i];
      g.fillRect(x, 352, WHEEL_CELL, WHEEL_CELL);
      const [r, m] = WHEEL_PROPS[i];
      go.fillStyle = `rgb(0, ${Math.round(r * 255)}, ${Math.round(m * 255)})`;
      go.fillRect(x, 352, WHEEL_CELL, WHEEL_CELL);
    }
    // blurred rim face (far LOD): radial rings
    const rf = R_RIMFACE;
    const cx = rf.x + rf.w / 2;
    const cy = rf.y + rf.h / 2;
    const R = rf.w / 2;
    const rr = (r: number) => (r / (RIM_R + 0.006)) * R;
    const ring = (r0: number, r1: number, col: string) => {
      g.beginPath();
      g.arc(cx, cy, rr(r1), 0, Math.PI * 2);
      g.arc(cx, cy, rr(r0), 0, Math.PI * 2, true);
      g.fillStyle = col;
      g.fill();
    };
    ring(0, RIM_R + 0.006, '#1a1b1e');
    ring(0.06, RIM_R - 0.006, '#2e3034');
    ring(RIM_R - 0.006, RIM_R + 0.006, '#8c9097');
    ring(0, 0.062, '#34373c');
    ring(0, 0.035, '#b52024');
    go.fillStyle = 'rgb(0, 110, 180)';
    go.fillRect(rf.x, rf.y, rf.w, rf.h);

    // ------------------------------------------ blur disc (transparent), radius ↔ WHEEL_R − 0.006
    const b = ctx2d(bl);
    b.clearRect(0, 0, 512, 512);
    const BR = WHEEL_R - 0.006;
    const br = (r: number) => (r / BR) * 256;
    const bring = (r0: number, r1: number, col: string) => {
      b.beginPath();
      b.arc(256, 256, br(r1), 0, Math.PI * 2);
      b.arc(256, 256, br(r0), 0, Math.PI * 2, true);
      b.fillStyle = col;
      b.fill();
    };
    // spokes smeared: ~30% coverage of dark anthracite
    const sg = b.createRadialGradient(256, 256, br(0.06), 256, 256, br(RIM_R - 0.004));
    sg.addColorStop(0, 'rgba(40,42,46,0.55)');
    sg.addColorStop(0.5, 'rgba(38,40,44,0.32)');
    sg.addColorStop(1, 'rgba(36,38,42,0.3)');
    b.fillStyle = sg;
    b.beginPath();
    b.arc(256, 256, br(RIM_R - 0.004), 0, Math.PI * 2);
    b.arc(256, 256, br(0.064), 0, Math.PI * 2, true);
    b.fill();
    // sidewall smear: rubber + text ring + band
    bring(RIM_R + 0.004, 0.346, 'rgba(22,22,22,1)');
    bring(0.254, 0.262, band);
    const tg = b.createRadialGradient(256, 256, br(0.272), 256, 256, br(0.323));
    tg.addColorStop(0, 'rgba(120,120,120,0.0)');
    tg.addColorStop(0.5, 'rgba(150,150,150,0.55)');
    tg.addColorStop(1, 'rgba(120,120,120,0.0)');
    b.beginPath();
    b.arc(256, 256, br(0.323), 0, Math.PI * 2);
    b.arc(256, 256, br(0.272), 0, Math.PI * 2, true);
    b.fillStyle = tg;
    b.fill();
    // band-colour haze of the CORSA text
    b.globalAlpha = 0.25;
    bring(0.28, 0.315, band);
    b.globalAlpha = 1;
    // soft outer edge
    const eg = b.createRadialGradient(256, 256, br(0.338), 256, 256, br(0.352));
    eg.addColorStop(0, 'rgba(22,22,22,1)');
    eg.addColorStop(1, 'rgba(22,22,22,0)');
    b.beginPath();
    b.arc(256, 256, br(0.352), 0, Math.PI * 2);
    b.arc(256, 256, br(0.338), 0, Math.PI * 2, true);
    b.fillStyle = eg;
    b.fill();
    set.map.needsUpdate = true;
    set.orm.needsUpdate = true;
    set.blur.needsUpdate = true;
  };
  paintWithFonts(paint);
  wheelCache.set(compound, set);
  return set;
}

// ------------------------------------------------------------------------------------ trim palette
export interface TrimSet {
  map: THREE.Texture;
}
let trimOrm: THREE.Texture | null = null;
let trimEmis: THREE.Texture | null = null;
function cellRect(i: number) {
  const cols = TRIM_W / TRIM_CELL;
  return { x: (i % cols) * TRIM_CELL, y: Math.floor(i / cols) * TRIM_CELL };
}
/** shared roughness/metalness (G/B) and emissive-mask (R heat, G rain light, B self-lit) textures */
export function trimShared(): { orm: THREE.Texture; emis: THREE.Texture } {
  if (trimOrm && trimEmis) return { orm: trimOrm, emis: trimEmis };
  const o = canvas(TRIM_W, TRIM_H);
  const e = canvas(TRIM_W, TRIM_H);
  const go = ctx2d(o);
  const ge = ctx2d(e);
  go.fillStyle = 'rgb(0,128,0)';
  go.fillRect(0, 0, TRIM_W, TRIM_H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, TRIM_W, TRIM_H);
  for (const k of Object.keys(TRIM_PROPS)) {
    const i = Number(k);
    const [r, m, eh, eg, eb] = TRIM_PROPS[i];
    const { x, y } = cellRect(i);
    go.fillStyle = `rgb(0, ${Math.round(r * 255)}, ${Math.round(m * 255)})`;
    go.fillRect(x, y, TRIM_CELL, TRIM_CELL);
    ge.fillStyle = `rgb(${Math.round(eh * 255)}, ${Math.round(eg * 255)}, ${Math.round(eb * 255)})`;
    ge.fillRect(x, y, TRIM_CELL, TRIM_CELL);
  }
  // display + leds: glossy glass, self-lit
  for (const r of [R_DISPLAY, R_LEDS]) {
    go.fillStyle = 'rgb(0, 20, 0)';
    go.fillRect(r.x, r.y, r.w, r.h);
    ge.fillStyle = 'rgb(0, 0, 255)';
    ge.fillRect(r.x, r.y, r.w, r.h);
  }
  trimOrm = tex(o, false, false, 1);
  trimEmis = tex(e, false, false, 1);
  trimOrm.generateMipmaps = trimEmis.generateMipmaps = false;
  trimOrm.minFilter = trimEmis.minFilter = THREE.LinearFilter;
  return { orm: trimOrm, emis: trimEmis };
}

export function trimTexture(teamIn: Team, driverIn: Driver, seat: 0 | 1): THREE.Texture {
  const team: Team = { ...teamIn, primary: capHex(teamIn.primary), secondary: capHex(teamIn.secondary), accent: capHex(teamIn.accent), ink: capHex(teamIn.ink) };
  const driver: Driver = { ...driverIn, helmet: [capHex(driverIn.helmet[0]), capHex(driverIn.helmet[1])] };
  const c = canvas(TRIM_W, TRIM_H);
  const t = tex(c, true, false, 1);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  const paint = () => {
    const g = ctx2d(c);
    g.fillStyle = '#222';
    g.fillRect(0, 0, TRIM_W, TRIM_H);
    const col: Record<number, string> = {
      [TC.blackGloss]: '#0c0c0d',
      [TC.blackSatin]: '#141416',
      [TC.darkMetal]: '#4a4d52',
      [TC.titanium]: '#a3a6ab',
      [TC.exhaust]: '#8a7a66',
      [TC.disc]: '#2d2a28',
      [TC.discEdge]: '#3a3532',
      [TC.caliper]: '#2a2c31',
      [TC.tcam]: seat === 0 ? '#0e0e10' : '#d9ff00',
      [TC.visor]: '#1a1f2e',
      [TC.mirrorGlass]: '#d8dde3',
      [TC.suit]: team.primary,
      [TC.suit2]: team.secondary,
      [TC.hans]: '#18191b',
      [TC.belts]: team.accent,
      [TC.rainLight]: '#ff2010',
      [TC.wheelBody]: '#17181a',
      [TC.grip]: '#2a2b2d',
      [TC.btnRed]: '#e0201c',
      [TC.btnYellow]: '#ffd000',
      [TC.btnBlue]: '#1f7bff',
      [TC.btnGreen]: '#22d04a',
      [TC.inletDark]: '#050506',
      [TC.skid]: '#b8b9bb',
      [TC.helmet]: driver.helmet[0],
      [TC.helmet2]: driver.helmet[1],
      [TC.rubber]: '#101010',
      [TC.accent]: team.accent,
      [TC.primary]: team.primary,
      [TC.plank]: '#6b5a44',
      [TC.gold]: '#d9a441',
      [TC.glove]: team.secondary,
      [TC.secondary]: team.secondary,
      [TC.ductBlack]: '#101012',
      [TC.padding]: '#0d0d0e',
      [TC.ink]: team.ink,
      [TC.halo]: team.primary,
    };
    for (const k of Object.keys(col)) {
      const i = Number(k);
      const { x, y } = cellRect(i);
      g.fillStyle = col[i];
      g.fillRect(x, y, TRIM_CELL, TRIM_CELL);
    }
    // steering-wheel display
    const d: Rect = R_DISPLAY;
    g.fillStyle = '#05070a';
    g.fillRect(d.x, d.y, d.w, d.h);
    g.fillStyle = '#0a2a3a';
    g.fillRect(d.x + 4, d.y + 4, d.w - 8, d.h - 8);
    g.font = `900 40px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText('7', d.x + d.w / 2, d.y + d.h / 2 + 2);
    g.fillStyle = '#2cff6a';
    g.fillRect(d.x + 8, d.y + 10, 34, 8);
    g.fillStyle = '#ffcc00';
    g.fillRect(d.x + 8, d.y + 24, 26, 8);
    g.fillStyle = '#ff3b3b';
    g.fillRect(d.x + 8, d.y + 38, 18, 8);
    g.fillStyle = '#9ad7ff';
    g.font = `700 12px ${FONT}`;
    g.fillText('-0.214', d.x + d.w - 26, d.y + 16);
    g.fillText(driver.code, d.x + d.w - 26, d.y + 46);
    const l: Rect = R_LEDS;
    g.fillStyle = '#050505';
    g.fillRect(l.x, l.y, l.w, l.h);
    for (let i = 0; i < 15; i++) {
      g.fillStyle = i < 5 ? '#27ff4d' : i < 10 ? '#ff2a2a' : '#3a6bff';
      g.beginPath();
      g.arc(l.x + 5 + i * 8.4, l.y + l.h / 2, 3, 0, Math.PI * 2);
      g.fill();
    }
    t.needsUpdate = true;
  };
  paintWithFonts(paint);
  return t;
}

// ------------------------------------------------------------------------------------ driver sheet
function fitText(g: CanvasRenderingContext2D, s: string, maxW: number, px: number, weight = 900) {
  g.font = `${weight} ${px}px ${FONT}`;
  const w = g.measureText(s).width;
  return w > maxW ? maxW / w : 1;
}
function drawInRect(g: CanvasRenderingContext2D, r: Rect, s: string, color: string, outline: string | null, heightFrac: number, aspectFix = 1, weight = 900, italic = true) {
  const px = r.h * heightFrac;
  g.save();
  g.translate(r.x + r.w / 2, r.y + r.h / 2);
  const k = fitText(g, s, (r.w * 0.94) / aspectFix, px, weight);
  g.scale(k * aspectFix, 1);
  g.font = `${italic ? 'italic ' : ''}${weight} ${px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (outline) {
    g.lineJoin = 'round';
    g.lineWidth = px * 0.14;
    g.strokeStyle = outline;
    g.strokeText(s, 0, px * 0.04);
  }
  g.fillStyle = color;
  g.fillText(s, 0, px * 0.04);
  g.restore();
}

function luminance(hex: string) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
export function contrastOn(hex: string) {
  return luminance(hex) > 0.35 ? '#0d0f12' : '#ececec';
}
/** cap albedo so whites/brights don't read as emissive under a hard sun */
export function capHex(hex: string, max = 238) {
  const c = new THREE.Color(hex);
  c.convertLinearToSRGB();
  const m = Math.max(c.r, c.g, c.b) * 255;
  const k = m > max ? max / m : 1;
  const h = (v: number) => Math.round(v * 255 * k).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

export function driverTexture(teamIn: Team, driverIn: Driver): THREE.Texture {
  const team: Team = { ...teamIn, primary: capHex(teamIn.primary), secondary: capHex(teamIn.secondary), accent: capHex(teamIn.accent), ink: capHex(teamIn.ink) };
  const driver: Driver = { ...driverIn, helmet: [capHex(driverIn.helmet[0]), capHex(driverIn.helmet[1])] };
  const c = canvas(DRV_W, DRV_H);
  const t = tex(c, true, false, 8);
  const paint = () => {
    const g = ctx2d(c);
    g.clearRect(0, 0, DRV_W, DRV_H);
    // ---- helmet (u: back 0 → right .25 → front .5 → left .75 → back 1, v bottom .2 → top 1)
    const h = R_HELMET;
    const [h0, h1] = driver.helmet;
    const X = (u: number) => h.x + u * h.w;
    const Y = (v: number) => h.y + (1 - v) * h.h;
    g.fillStyle = h0;
    g.fillRect(h.x, h.y, h.w, h.h);
    // lower band + swoosh
    g.fillStyle = h1;
    g.fillRect(h.x, Y(0.44), h.w, Y(0.2) - Y(0.44));
    g.beginPath();
    for (const side of [0.25, 0.75]) {
      g.moveTo(X(side - 0.2), Y(0.44));
      g.quadraticCurveTo(X(side), Y(0.62), X(side + 0.2), Y(0.44));
    }
    g.fill();
    // crown design: chevrons
    g.fillStyle = h1;
    for (let k = 0; k < 4; k++) {
      const u = 0.125 + k * 0.25;
      g.beginPath();
      g.moveTo(X(u - 0.06), Y(0.82));
      g.lineTo(X(u), Y(0.94));
      g.lineTo(X(u + 0.06), Y(0.82));
      g.lineTo(X(u), Y(0.87));
      g.closePath();
      g.fill();
    }
    // stripe separating band
    g.fillStyle = contrastOn(h1) === '#ececec' ? '#ececec' : '#111111';
    g.fillRect(h.x, Y(0.452), h.w, 2);
    // brow strip above visor with sponsor
    g.fillStyle = '#0d0d0f';
    g.fillRect(X(0.36), Y(0.7), X(0.64) - X(0.36), Y(0.63) - Y(0.7));
    drawInRect(g, { x: X(0.37), y: Y(0.7), w: X(0.63) - X(0.37), h: Y(0.63) - Y(0.7) }, team.sponsor, '#ffffff', null, 0.8, 0.55, 900, false);
    // numbers on the sides
    for (const u of [0.25, 0.75]) {
      drawInRect(g, { x: X(u - 0.07), y: Y(0.7), w: X(u + 0.07) - X(u - 0.07), h: Y(0.5) - Y(0.7) }, String(driver.number), h1, contrastOn(h1), 0.85, 0.55);
    }
    drawInRect(g, { x: X(0.93), y: Y(0.72), w: X(1.0) - X(0.93), h: Y(0.56) - Y(0.72) }, driver.code, h1, null, 0.6, 0.5, 900, false);
    drawInRect(g, { x: X(0.0), y: Y(0.72), w: X(0.07) - X(0.0), h: Y(0.56) - Y(0.72) }, driver.code, h1, null, 0.6, 0.5, 900, false);

    // ---- decals (alpha-tested)
    const numCol = team.ink;
    const numOut = contrastOn(team.ink) === '#ececec' ? null : null;
    drawInRect(g, R_NUM_NOSE, String(driver.number), numCol, numOut, 0.9, 0.85);
    drawInRect(g, R_NUM_FIN_L, String(driver.number), numCol, null, 0.95, 1);
    drawInRect(g, R_NUM_FIN_R, String(driver.number), numCol, null, 0.95, 1);
    const code = `${driver.code}  ${driver.number}`;
    drawInRect(g, R_CODE_L, code, contrastOn(team.primary), null, 0.85, 1.4, 900, false);
    drawInRect(g, R_CODE_R, code, contrastOn(team.primary), null, 0.85, 1.4, 900, false);
    // flat cells: visor, suit, suit2, HANS, gloves, belts
    const cells = ['#121722', team.primary, team.secondary, '#18191b', team.secondary, team.accent];
    cells.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(256 + i * 16, 224, 16, 16);
    });
    t.needsUpdate = true;
  };
  paintWithFonts(paint);
  return t;
}

export function disposeTex(t: THREE.Texture | null | undefined) {
  if (t) t.dispose();
}
export { RIM_R, WHEEL_R };
