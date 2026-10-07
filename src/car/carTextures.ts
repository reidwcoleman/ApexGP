/**
 * Canvas-generated textures for the car: carbon weave (shared), wheel/tyre atlas (shared),
 * motion-blur disc (shared), per-car trim palette + emissive masks, per-driver helmet/decal sheet.
 */
import * as THREE from 'three';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import type { Team, Driver } from '../race/Teams.ts';
import {
  TRIM_W, TRIM_H, TRIM_CELL, TC, TRIM_PROPS,
  DASH_W, DASH_H, R_SCREEN, R_SHIFT, SHIFT_N, SHIFT_CELL, FACE_W, FACE_H, FACE_SPAN_X, FACE_SPAN_Y, FACE_CY, WHEEL_BUTTONS, WHEEL_ROTARIES,
  GLOVE_W, GLOVE_H, R_GL_BACK, R_GL_PALM, R_GL_FINGER, R_GL_THUMB, R_GL_CUFF,
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
  /**
   * anisotropy (MeshPhysicalMaterial.anisotropyMap): RG the direction the highlight stretches in,
   * across each tow (a fibre bundle is a cylinder: its sheen runs perpendicular to it), B strength.
   * The warp and weft tows stretch it at right angles — the checker of sheen that flips as the
   * light moves, the look of real carbon under its lacquer.
   */
  aniso: THREE.Texture;
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
  const ani = canvas(S, S);
  const ic = new ImageData(S, S);
  const inn = new ImageData(S, S);
  const ir = new ImageData(S, S);
  const ia = new ImageData(S, S);
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
      // a warp tow runs along v: its highlight stretches along u, and the weft's the other way;
      // strongest on the crown of each tow, gone in the resin between them
      ia.data[o] = warp ? 255 : 128;
      ia.data[o + 1] = warp ? 128 : 255;
      ia.data[o + 2] = Math.round((0.35 + 0.65 * bulge) * Math.min(1, edge * 12) * 255);
      ia.data[o + 3] = 255;
    }
  }
  ctx2d(col).putImageData(ic, 0, 0);
  ctx2d(nor).putImageData(inn, 0, 0);
  ctx2d(rou).putImageData(ir, 0, 0);
  ctx2d(ani).putImageData(ia, 0, 0);
  carbonCache = { map: tex(col, true, true, 16), normal: tex(nor, false, true, 16), rough: tex(rou, false, true, 16), aniso: tex(ani, false, true, 16) };
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
  /** tangent-space normals: moulded sidewall lettering, tread grooves (inters/wets) */
  normal: THREE.Texture;
  blur: THREE.Texture;
}
// (a fictional tyre maker and its fictional ranges — never a real maker's names or marks)
const COMPOUND_LINE: Record<Compound, string> = { soft: 'VX-18', medium: 'VX-18', hard: 'VX-18', inter: 'TORRENTA', wet: 'TORRENTA' };
const COMPOUND_NAME: Record<Compound, string> = { soft: 'SOFT', medium: 'MEDIUM', hard: 'HARD', inter: 'INTERMEDIATE', wet: 'FULL WET' };
const wheelCache = new Map<string, WheelSet>();
export function wheelTextures(compound: Compound = 'soft'): WheelSet {
  const hit = wheelCache.get(compound);
  if (hit) return hit;
  const band = COMPOUNDS[compound];
  const c = canvas(WHEEL_TEX_W, WHEEL_TEX_H);
  const o = canvas(WHEEL_TEX_W, WHEEL_TEX_H);
  const bl = canvas(512, 512);
  const hc = canvas(WHEEL_TEX_W, 352);
  const nc = canvas(WHEEL_TEX_W, WHEEL_TEX_H);
  const set: WheelSet = { map: tex(c, true), orm: tex(o, false), normal: tex(nc, false), blur: tex(bl, true) };
  set.map.anisotropy = 8;
  set.normal.anisotropy = 8;
  const paint = () => {
    const g = ctx2d(c);
    const go = ctx2d(o);
    const gh = ctx2d(hc);
    // height field (sidewall + tread rows only): 200 = rubber, 255 = moulded relief, 0 = groove floor
    gh.fillStyle = 'rgb(200,200,200)';
    gh.fillRect(0, 0, WHEEL_TEX_W, 352);
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
      gh.save();
      gh.translate(sw.x + u * sw.w, rowOf(rMid));
      gh.scale(sq, 1);
      gh.font = `${weight} ${fontPx}px ${FONT}`;
      gh.textAlign = 'center';
      gh.textBaseline = 'middle';
      (gh as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${fontPx * track}px`;
      gh.fillStyle = 'rgb(236,236,236)';
      gh.fillText(s, 0, 0);
      gh.restore();
    };
    // moulded rings in the height map too
    for (const r of [0.238, 0.248, 0.334]) {
      gh.fillStyle = 'rgb(226,226,226)';
      gh.fillRect(sw.x, rowOf(r) - 1, sw.w, 2);
    }
    for (const u of [0.25, 0.75]) {
      text('VELTRA', u, 0.297, 0.052, '#e9e9e9', 900, 0.1);
    }
    for (const u of [0.0, 0.5, 1.0]) {
      text(COMPOUND_LINE[compound], u, 0.297, 0.052, band, 900, 0.06);
    }
    for (const u of [0.125, 0.375, 0.625, 0.875]) text(COMPOUND_NAME[compound], u, 0.279, 0.016, '#bdbdbd', 700, 0.3);
    // moulded technical markings (black on black: they read only in the relief, as the light rakes across)
    {
      const rain = compound === 'inter' || compound === 'wet';
      const marks = ['280 · 375 R18 RADIAL', 'TUBELESS · RACING USE ONLY', rain ? 'ROTATION →' : 'MADE FOR COMPETITION', 'NOT FOR HIGHWAY USE'];
      const fontPx = 0.0065 * pxPerMv;
      marks.forEach((m, k) => {
        const u = 0.0625 + k * 0.25;
        for (const [ctx, col] of [[gh, 'rgb(222,222,222)'], [g, 'rgba(255,255,255,0.035)']] as [CanvasRenderingContext2D, string][]) {
          ctx.save();
          ctx.translate(sw.x + u * sw.w, rowOf(0.3285));
          ctx.scale(sq, 1);
          ctx.font = `700 ${fontPx}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${fontPx * 0.12}px`;
          ctx.fillStyle = col;
          ctx.fillText(m, 0, 0);
          ctx.restore();
        }
      });
    }
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
    if (compound === 'inter' || compound === 'wet') treadGrooves(compound, g, go, gh);
    normalFromHeight(hc, nc);
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
    // 2022+ wheel cover (near LODs map their cover disc here, the far LOD its flat face):
    // lacquered carbon, near black, the five spokes behind it only a faint shadow in the moulding, a
    // machined rim lip, the nut. (It was a satin metal with the spokes painted on at a third: in the sun
    // the satin lobe lit the whole flat face as one grey plate and the spokes read as pie slices.)
    g.save();
    g.beginPath();
    g.rect(rf.x, rf.y, rf.w, rf.h);
    g.clip();
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, rr(RIM_R));
    cg.addColorStop(0, '#16171a');
    cg.addColorStop(0.55, '#1e2023');
    cg.addColorStop(1, '#2a2c30');
    g.fillStyle = cg;
    g.beginPath();
    g.arc(cx, cy, rr(RIM_R + 0.006), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(70,74,80,0.14)';
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a - 0.2) * rr(0.05), cy + Math.sin(a - 0.2) * rr(0.05));
      g.lineTo(cx + Math.cos(a - 0.16) * rr(RIM_R - 0.02), cy + Math.sin(a - 0.16) * rr(RIM_R - 0.02));
      g.arc(cx, cy, rr(RIM_R - 0.02), a - 0.16, a + 0.16);
      g.lineTo(cx + Math.cos(a + 0.2) * rr(0.05), cy + Math.sin(a + 0.2) * rr(0.05));
      g.closePath();
      g.fill();
    }
    g.restore();
    ring(RIM_R - 0.016, RIM_R - 0.012, '#3a3d42');
    ring(RIM_R - 0.006, RIM_R + 0.006, '#8c9097');
    ring(0, 0.05, '#101113');
    ring(0, 0.035, '#b52024');
    // cover: dielectric under its lacquer (roughness ~0.25: the dished cover gathers the sun into a
    // curved glint instead of glowing all over); lip: machined metal, satin rather than chrome (a 0.22
    // mirror ring sparkled round every wheel in motion)
    go.fillStyle = 'rgb(0, 64, 0)';
    go.fillRect(rf.x, rf.y, rf.w, rf.h);
    go.beginPath();
    go.arc(cx, cy, rr(RIM_R + 0.006), 0, Math.PI * 2);
    go.arc(cx, cy, rr(RIM_R - 0.006), 0, Math.PI * 2, true);
    go.fillStyle = 'rgb(0, 80, 255)';
    go.fill();

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
    // (inside the rim the wheel cover shows through: rotationally symmetric, needs no smear)
    // sidewall smear: rubber + text ring + band
    bring(RIM_R + 0.004, WHEEL_R - 0.014, 'rgba(22,22,22,1)');
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
    // band-colour haze of the range name
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
    set.normal.needsUpdate = true;
    set.blur.needsUpdate = true;
  };
  paintWithFonts(paint);
  wheelCache.set(compound, set);
  return set;
}

/**
 * Rain-tyre tread: directional chevron grooves (full wet: deep, wide, sweeping from a
 * centre zig-zag to the shoulders; intermediate: shallower, narrower, more numerous
 * slots with sipes). u (x) runs round the tyre, v (y) across the tread.
 */
function treadGrooves(compound: Compound, g: CanvasRenderingContext2D, go: CanvasRenderingContext2D, gh: CanvasRenderingContext2D) {
  const tr = R_TREAD;
  const wet = compound === 'wet';
  const period = wet ? 2048 / 28 : 2048 / 40;
  const lw = wet ? 7 : 4.5;
  const mid = tr.y + tr.h / 2;
  const draw = (fn: (c: CanvasRenderingContext2D) => void) => {
    for (const [ctx, col] of [
      [g, '#050505'],
      [go, 'rgb(0, 245, 0)'],
      [gh, 'rgb(0,0,0)'],
    ] as [CanvasRenderingContext2D, string][]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tr.x, tr.y, tr.w, tr.h);
      ctx.clip();
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      fn(ctx);
      ctx.restore();
    }
  };
  draw((ctx) => {
    for (let k = -1; k <= 2048 / period + 1; k++) {
      const u = tr.x + k * period;
      for (const side of [-1, 1]) {
        // chevron arm: from near the centre sweeping back to the shoulder
        ctx.lineWidth = lw;
        ctx.beginPath();
        const y0 = mid + side * (wet ? 5 : 12);
        const y1 = mid + side * (tr.h / 2 + 4);
        ctx.moveTo(u, y0);
        ctx.bezierCurveTo(u + period * 0.25, y0 + side * 10, u + period * 0.55, y1 - side * 14, u + period * (wet ? 0.95 : 0.75), y1);
        ctx.stroke();
        if (!wet) {
          // sipes between the slots
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(u + period * 0.45, mid + side * 6);
          ctx.lineTo(u + period * 0.7, mid + side * 22);
          ctx.stroke();
        }
      }
      if (wet) {
        // centre zig-zag
        ctx.lineWidth = lw * 0.8;
        ctx.beginPath();
        ctx.moveTo(u, mid - 5);
        ctx.lineTo(u + period * 0.5, mid + 5);
        ctx.lineTo(u + period, mid - 5);
        ctx.stroke();
      }
    }
    if (wet) {
      // two circumferential channels
      ctx.lineWidth = 5;
      for (const f of [0.27, 0.73]) {
        ctx.beginPath();
        ctx.moveTo(tr.x, tr.y + tr.h * f);
        ctx.lineTo(tr.x + tr.w, tr.y + tr.h * f);
        ctx.stroke();
      }
    }
  });
}

/** Sobel the height canvas (rows 0‥352 of the atlas) into a tangent-space normal map */
function normalFromHeight(hc: HTMLCanvasElement, nc: HTMLCanvasElement) {
  const W = hc.width;
  const H = hc.height;
  const blur = canvas(W, H);
  const gb = ctx2d(blur);
  gb.filter = 'blur(0.8px)';
  gb.drawImage(hc, 0, 0);
  const src = gb.getImageData(0, 0, W, H).data;
  const out = new ImageData(W, WHEEL_TEX_H);
  const k = 2.2 / 255;
  const h = (x: number, y: number) => src[(Math.min(H - 1, Math.max(0, y)) * W + ((x + W) % W)) * 4];
  for (let y = 0; y < WHEEL_TEX_H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (y >= H) {
        out.data[o] = 128;
        out.data[o + 1] = 128;
        out.data[o + 2] = 255;
        out.data[o + 3] = 255;
        continue;
      }
      // canvas y runs down, texture v runs up
      const nx = -(h(x + 1, y) - h(x - 1, y)) * k;
      const ny = (h(x, y + 1) - h(x, y - 1)) * k;
      const l = Math.hypot(nx, ny, 1);
      out.data[o] = Math.round((nx / l) * 127 + 128);
      out.data[o + 1] = Math.round((ny / l) * 127 + 128);
      out.data[o + 2] = Math.round((1 / l) * 127 + 128);
      out.data[o + 3] = 255;
    }
  ctx2d(nc).putImageData(out, 0, 0);
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
      [TC.sideLight]: '#39d8ff',
      [TC.wheelFace]: '#26282c',
      [TC.dial]: '#7c828c',
      [TC.btnWhite]: '#e9ecef',
    };
    for (const k of Object.keys(col)) {
      const i = Number(k);
      const { x, y } = cellRect(i);
      g.fillStyle = col[i];
      g.fillRect(x, y, TRIM_CELL, TRIM_CELL);
    }
    t.needsUpdate = true;
  };
  paintWithFonts(paint);
  return t;
}

// ------------------------------------------------------------------------------------ steering-wheel screen
/** what the steering wheel's screen and shift lights show */
export interface DashState {
  gear: number;
  kmh: number;
  /** 0 … 1 through the rev range (idle → limiter): drives the shift lights */
  rpm: number;
  /** live lap delta (s), NaN when there isn't one */
  delta: number;
  /** 2026 straight mode (active aero open: "X-mode"; closed for the corners: "Z-mode") */
  straight: boolean;
  /** battery state 0 … 1 */
  ers: number;
  code: string;
  /** shift lights live (false on a parked car: a static preview, LEDs dark) */
  lights: boolean;
  /** laps: the one being run (1-based) and the race's; race position */
  lap?: number;
  laps?: number;
  pos?: number;
  /** brake balance: the front's share 0 … 1 */
  bias?: number;
  /** deploying the overtake boost */
  deploy?: boolean;
  /** tyre temperatures (°C, FL FR RL RR) and the compound's working temperature */
  tyres?: readonly number[];
  tyreOpt?: number;
  /** last lap time (s), NaN / 0 when none yet */
  last?: number;
}

const DASH_LABEL = '#8d99a6';
const DASH_LINE = '#262b31';
function lapTime(t: number) {
  if (!(t > 0) || !isFinite(t)) return 'NO TIME';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/**
 * Paint the wheel's screen and shift lights (the dash texture). Laid out like the 2026 cars'
 * screens and Assetto Corsa Competizione's dashes: black glass, the gear huge in the middle, speed
 * and tyre temperatures on the left, brake balance and the battery on the right, the lap delta
 * across the top in a green / red box, the aero mode and the last lap along the bottom. Every value
 * is sized to stay legible from the driver's eye (~300 px wide at 1080p: the smallest values are
 * ~20 px there, the labels ~10 px).
 */
export function paintDash(g: CanvasRenderingContext2D, s: DashState) {
  const S = R_SCREEN;
  const X = (u: number) => S.x + u;
  const Y = (v: number) => S.y + v;
  g.save();
  g.fillStyle = '#000';
  g.fillRect(S.x, S.y, S.w, S.h);
  g.textBaseline = 'alphabetic';
  const text = (t: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left', weight = 900) => {
    g.font = `${weight} ${px}px ${FONT}`;
    g.textAlign = align;
    g.fillStyle = color;
    g.fillText(t, X(x), Y(y));
  };
  const label = (t: string, x: number, y: number, align: CanvasTextAlign = 'left') => text(t, x, y, 34, DASH_LABEL, align, 700);
  // panel rules
  g.fillStyle = DASH_LINE;
  g.fillRect(X(0), Y(112), S.w, 4);
  g.fillRect(X(0), Y(474), S.w, 4);
  g.fillRect(X(300), Y(116), 4, 358);
  g.fillRect(X(720), Y(116), 4, 358);

  // ---- top: lap, delta, position
  label('LAP', 22, 46);
  text(s.lap ? `${s.lap}/${s.laps ?? '–'}` : '–', 22, 98, 54, '#ffffff');
  label('POS', 1002, 46, 'right');
  text(s.pos ? `P${s.pos}` : '–', 1002, 98, 54, '#ffffff', 'right');
  {
    const has = isFinite(s.delta);
    const up = has && s.delta > 0;
    g.fillStyle = !has ? '#15181c' : up ? '#5a0f12' : '#0b4423';
    roundRect(g, X(262), Y(12), 500, 92, 14);
    g.fill();
    if (has) {
      // the bar grows from the middle with the delta (±1 s full)
      const k = Math.min(1, Math.abs(s.delta)) * 236;
      g.fillStyle = up ? '#c21f26' : '#18a24a';
      g.fillRect(X(512) - (up ? 0 : k), Y(94), k, 7);
    }
    text(has ? `${s.delta <= 0 ? '−' : '+'}${Math.abs(s.delta).toFixed(3)}` : 'DELTA', 512, 82, 74, has ? (up ? '#ff7d7d' : '#7dffaa') : '#56606b', 'center');
  }

  // ---- left: speed and the tyres (coloured by temperature against the compound's window, as the HUD)
  label('KM/H', 22, 160);
  text(String(Math.round(s.kmh)), 280, 246, 96, '#ffffff', 'right');
  label('TYRES', 22, 300);
  const opt = s.tyreOpt ?? 100;
  for (let i = 0; i < 4; i++) {
    const T = s.tyres?.[i];
    const col = T === undefined ? '#22272d' : T < opt - 22 ? '#2f6fe0' : T <= opt + 14 ? '#1fae4f' : T <= opt + 26 ? '#e0a81a' : '#e0322a';
    // (FL top-left as the driver looks at the car: its left is the screen's left)
    const bx = 22 + (i % 2) * 136;
    const by = 318 + Math.floor(i / 2) * 76;
    g.fillStyle = col;
    roundRect(g, X(bx), Y(by), 124, 66, 10);
    g.fill();
    if (T !== undefined) text(`${Math.round(T)}°`, bx + 62, by + 50, 44, '#050607', 'center');
  }

  // ---- centre: the gear
  {
    const gear = s.gear <= 0 ? 'N' : String(s.gear);
    const shift = s.lights && s.rpm > 0.94;
    text(gear, 512, 442, 360, shift ? '#5aa9ff' : '#ffffff', 'center');
  }

  // ---- right: brake balance, battery, deployment
  label('BBAL', 744, 160);
  text(s.bias !== undefined ? (s.bias * 100).toFixed(1) : '–', 1002, 222, 66, '#ffffff', 'right');
  label('ERS', 744, 286);
  {
    const e = Math.max(0, Math.min(1, s.ers));
    text(`${Math.round(e * 100)}%`, 1002, 286, 44, '#ffffff', 'right', 900);
    // ten cells, like the battery gauges on the wheels
    const col = e > 0.25 ? '#ffd23c' : '#ff5a3c';
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i < Math.round(e * 10) ? col : '#1d2126';
      g.fillRect(X(744 + i * 26), Y(304), 21, 52);
    }
    const mode = s.deploy ? 'OVERTAKE' : 'BALANCED';
    g.fillStyle = s.deploy ? '#b0168f' : '#15181c';
    roundRect(g, X(744), Y(380), 258, 72, 10);
    g.fill();
    text(mode, 873, 432, 44, s.deploy ? '#ffffff' : '#7f8b97', 'center');
  }

  // ---- bottom: last lap, the aero mode
  label('LAST', 22, 540);
  text(lapTime(s.last ?? NaN), 116, 542, 54, (s.last ?? 0) > 0 ? '#ffffff' : '#56606b', 'left');
  {
    const x = s.straight;
    g.fillStyle = x ? '#0f8f45' : '#15181c';
    roundRect(g, X(744), Y(490), 258, 72, 10);
    g.fill();
    text(x ? 'X-MODE' : 'Z-MODE', 873, 543, 48, x ? '#ffffff' : '#7f8b97', 'center');
  }
  g.restore();

  // ---- shift lights: green → red → blue across the top, the whole row flashing blue at the
  // limiter; a dark LED still shows its lens's tint (black with a hint of colour, not grey)
  const l = R_SHIFT;
  g.fillStyle = '#000';
  g.fillRect(l.x, l.y, l.w, l.h);
  const lit = s.lights ? Math.round(Math.max(0, Math.min(1, (s.rpm - 0.55) / 0.4)) * SHIFT_N) : 0;
  const flash = s.lights && s.rpm > 0.965;
  const third = SHIFT_N / 3;
  for (let i = 0; i < SHIFT_N; i++) {
    const on = flash || i < lit;
    const rgb = flash ? [60, 120, 255] : i < third ? [40, 255, 80] : i < 2 * third ? [255, 36, 36] : [60, 110, 255];
    const cx = l.x + (i + 0.5) * SHIFT_CELL;
    const cy = l.y + SHIFT_CELL / 2;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, SHIFT_CELL * 0.5);
    if (on) {
      gr.addColorStop(0, `rgb(${rgb[0] * 0.6 + 100},${rgb[1] * 0.6 + 100},${rgb[2] * 0.6 + 100})`);
      gr.addColorStop(0.35, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
      gr.addColorStop(1, `rgb(${rgb[0] * 0.55},${rgb[1] * 0.55},${rgb[2] * 0.55})`);
    } else {
      gr.addColorStop(0, `rgb(${rgb[0] * 0.07 + 6},${rgb[1] * 0.07 + 6},${rgb[2] * 0.07 + 6})`);
      gr.addColorStop(1, `rgb(${rgb[0] * 0.03 + 3},${rgb[1] * 0.03 + 3},${rgb[2] * 0.03 + 3})`);
    }
    g.fillStyle = gr;
    g.fillRect(l.x + i * SHIFT_CELL, l.y, SHIFT_CELL, SHIFT_CELL);
  }
}

function dashTex(c: HTMLCanvasElement) {
  // mipmapped and anisotropic: the screen leans back ~25° from the eye and shrinks to a quarter
  // of its texels on screen, so a plain bilinear lookup aliased the strokes into a shimmer
  const t = tex(c, true, false, 16);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}
/** a car's own live screen (only the cars a camera rides in need one: CarModel makes it on demand) */
export function createDashTexture(): { tex: THREE.Texture; paint: (s: DashState) => void } {
  const c = canvas(DASH_W, DASH_H);
  const g = ctx2d(c);
  const t = dashTex(c);
  let last: DashState | null = null;
  const paint = (s: DashState) => {
    last = s;
    paintDash(g, s);
    t.needsUpdate = true;
  };
  paint({ gear: 0, kmh: 0, rpm: 0, delta: NaN, straight: false, ers: 1, code: '', lights: false });
  // (the webfont may land after the first paint)
  if (!fontsAreReady()) fontsLoaded.then(() => last && paint(last));
  return { tex: t, paint };
}
let staticDash: THREE.Texture | null = null;
/** the screen every other car shows: neutral, on the pit-lane defaults (shared) */
export function sharedDashTexture(): THREE.Texture {
  if (staticDash) return staticDash;
  const c = canvas(DASH_W, DASH_H);
  staticDash = dashTex(c);
  const t = staticDash;
  paintWithFonts(() => {
    paintDash(ctx2d(c), { gear: 0, kmh: 0, rpm: 0, delta: NaN, straight: false, ers: 1, code: '', lights: false, bias: 0.57 });
    t.needsUpdate = true;
  });
  return t;
}

// ------------------------------------------------------------------------------------ the wheel's face
let faceTex: THREE.Texture | null = null;
/**
 * The face panel's print (shared): a fine carbon twill under the lacquer, the legend under each
 * button, position ticks round each rotary with its function beside it, as the real wheels print
 * them — white on carbon, condensed capitals a few millimetres tall.
 */
export function wheelFaceTexture(): THREE.Texture {
  if (faceTex) return faceTex;
  const c = canvas(FACE_W, FACE_H);
  faceTex = tex(c, true, false, 16);
  const t = faceTex;
  const kx = FACE_W / FACE_SPAN_X;
  const ky = FACE_H / FACE_SPAN_Y;
  // wheel-local metres → canvas px (u runs to the driver's right: −x)
  const PX = (x: number) => (0.5 - x / FACE_SPAN_X) * FACE_W;
  const PY = (y: number) => (0.5 - (y - FACE_CY) / FACE_SPAN_Y) * FACE_H;
  paintWithFonts(() => {
    const g = ctx2d(c);
    g.fillStyle = '#1d1f23';
    g.fillRect(0, 0, FACE_W, FACE_H);
    // 2×2 twill, ~3 mm tows, very low contrast (it is under the face's satin lacquer)
    const tw = 0.003 * kx;
    g.fillStyle = '#212328';
    for (let j = 0; j * tw < FACE_H; j++) for (let i = 0; i * tw < FACE_W; i++) if (((i + j) & 3) < 2) g.fillRect(i * tw, j * tw, tw - 0.6, tw - 0.6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const legend = (s: string, x: number, y: number, mm = 3.4, col = '#e9ecef') => {
      g.font = `700 ${(mm / 1000) * ky * 1.36}px ${FONT}`;
      g.fillStyle = col;
      g.fillText(s, PX(x), PY(y));
    };
    WHEEL_BUTTONS.forEach((b, i) => {
      // under the top four; beside the lower pair (the rotaries sit under them)
      if (i < 4) legend(b.label, b.x, b.y - 0.0148);
      else legend(b.label, b.x + Math.sign(b.x) * 0.0205, b.y);
    });
    for (const r of WHEEL_ROTARIES) {
      // nine detents over 270°, the first and last longer
      g.strokeStyle = '#d9dde2';
      g.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const a = (-135 + k * 33.75) * (Math.PI / 180);
        const long = k === 0 || k === 8 || k === 4;
        const r0 = 0.0121;
        const r1 = long ? 0.0142 : 0.0135;
        // (+x is the canvas's left: mirror the ticks' x as the legends are)
        g.lineWidth = 0.00055 * kx;
        g.beginPath();
        g.moveTo(PX(r.x - Math.sin(a) * r0), PY(r.y + Math.cos(a) * r0));
        g.lineTo(PX(r.x - Math.sin(a) * r1), PY(r.y + Math.cos(a) * r1));
        g.stroke();
      }
      const upper = r.y > -0.045;
      if (upper) legend(r.label, r.x - Math.sign(r.x) * 0.0185, r.y - 0.005, 3.0);
      else legend(r.label, r.x + Math.sign(r.x) * 0.0195, r.y, 3.0);
    }
    // the toggles' legend and the maker's mark at the foot of the face
    legend('–     OK     +', 0, -0.0395, 2.6, '#c9ced4');
    legend('APEX', 0, -0.0625, 3.2, '#6b7078');
    t.needsUpdate = true;
  });
  return t;
}

// ------------------------------------------------------------------------------------ gloves
/**
 * Race gloves (FIA 8856-2018 type: Nomex knit backs, suede palms): the colour sheet per team, and
 * one shared normal map — stitching, the padded knuckle panel, the sponsor patch's raised border,
 * the silicone grip print on the palm and fingertips, the knit's grain.
 */
const gloveCache = new Map<string, { t: THREE.Texture; refs: number }>();
let gloveNormalTex: THREE.Texture | null = null;

/** the glove sheet's layout in canvas px (shared by the colour and height passes) */
function gloveLayout(g: CanvasRenderingContext2D, ink: { base: string; panel: string; palm: string; stitch: string; patch: string; patchInk: string; strap: string; strapInk: string; binding: string }, sponsor: string, height: boolean) {
  const B = R_GL_BACK;
  const P = R_GL_PALM;
  const F = R_GL_FINGER;
  const T = R_GL_THUMB;
  const C = R_GL_CUFF;
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const stitch = (pts: [number, number][], col: string, dash = 5) => {
    g.save();
    g.strokeStyle = col;
    g.lineWidth = height ? 2 : 1.1;
    g.setLineDash([dash, dash * 0.75]);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.restore();
  };
  // ---- back of the hand (x: little finger 0 → index 1, y: knuckles at the top → wrist)
  rect(B.x, B.y, B.w, B.h, ink.base);
  // the padded knuckle panel across the top
  rect(B.x, B.y, B.w, 30, ink.panel);
  stitch([[B.x + 2, B.y + 32], [B.x + B.w - 2, B.y + 32]], ink.stitch);
  // the outline seam from the wrist up the thumb side
  stitch([[B.x + B.w - 6, B.y + B.h], [B.x + B.w - 26, B.y + 70], [B.x + B.w - 10, B.y + 36]], ink.stitch);
  stitch([[B.x + 6, B.y + B.h], [B.x + 8, B.y + 36]], ink.stitch);
  // the sponsor's patch
  roundRect(g, B.x + 70, B.y + 54, 116, 30, 6);
  g.fillStyle = ink.patch;
  g.fill();
  if (!height) {
    g.save();
    g.font = `900 21px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = g.measureText(sponsor).width;
    g.translate(B.x + 128, B.y + 70);
    g.scale(Math.min(1, 100 / Math.max(1, w)), 1);
    g.fillStyle = ink.patchInk;
    g.fillText(sponsor, 0, 0);
    g.restore();
  }
  stitch([[B.x + 67, B.y + 51], [B.x + 189, B.y + 51], [B.x + 189, B.y + 87], [B.x + 67, B.y + 87], [B.x + 67, B.y + 51]], ink.stitch, 3);
  // ---- palm: suede, a reinforced heel, silicone grip print
  rect(P.x, P.y, P.w, P.h, ink.palm);
  rect(P.x, P.y + P.h - 34, P.w, 34, height ? '#707070' : shade(ink.palm, 0.85));
  for (let y = P.y + 8; y < P.y + P.h - 38; y += 12)
    for (let x = P.x + 8 + ((y / 12) % 2) * 6; x < P.x + P.w - 4; x += 12) {
      g.fillStyle = height ? '#d0d0d0' : shade(ink.palm, 1.35);
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  // ---- fingers (x: root → tip, y: round it — its back in the middle row)
  const finger = (R: typeof F, panel: boolean) => {
    rect(R.x, R.y, R.w, R.h, ink.base);
    // the underside (the grip side) and the fingertip are suede, like the palm
    rect(R.x, R.y, R.w, R.h * 0.2, ink.palm);
    rect(R.x, R.y + R.h * 0.8, R.w, R.h * 0.2, ink.palm);
    rect(R.x + R.w * 0.86, R.y, R.w * 0.14, R.h, ink.palm);
    // a padded panel over the first knuckle
    if (panel) {
      roundRect(g, R.x + R.w * 0.06, R.y + R.h * 0.3, R.w * 0.36, R.h * 0.4, 6);
      g.fillStyle = ink.panel;
      g.fill();
    }
    // the side seams (outseams: the stitching shows) and round the tip
    stitch([[R.x, R.y + R.h * 0.22], [R.x + R.w * 0.86, R.y + R.h * 0.22]], ink.stitch);
    stitch([[R.x, R.y + R.h * 0.78], [R.x + R.w * 0.86, R.y + R.h * 0.78]], ink.stitch);
    stitch([[R.x + R.w * 0.86, R.y + 2], [R.x + R.w * 0.86, R.y + R.h - 2]], ink.stitch);
  };
  finger(F, true);
  finger(T, false);
  // ---- gauntlet (x: round it, the top at the middle; y: the open end at the top → the wrist)
  rect(C.x, C.y, C.w, C.h, ink.base);
  // the bound edge at the open end, the wrist strap with the maker's name
  rect(C.x, C.y, C.w, 4, ink.binding);
  rect(C.x, C.y + 36, C.w, 18, ink.strap);
  stitch([[C.x, C.y + 35], [C.x + C.w, C.y + 35]], ink.stitch, 3);
  if (!height) {
    g.save();
    g.font = `900 12px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = ink.strapInk;
    // (upside down in the sheet: the driver reads it from the elbow's side, looking down the forearm)
    g.translate(C.x + C.w * 0.5, C.y + 45.5);
    g.rotate(Math.PI);
    g.fillText('APEX', 0, 0);
    g.restore();
  }
}
function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  const h = (v: number) => Math.round(Math.min(255, v * 255 * k)).toString(16).padStart(2, '0');
  c.convertLinearToSRGB();
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

/** the team's glove colours (refcounted with the cars using them) */
export function acquireGloveTexture(teamIn: Team): THREE.Texture {
  const key = `${teamIn.id}:${teamIn.primary}:${teamIn.secondary}:${teamIn.sponsor}`;
  const hit = gloveCache.get(key);
  if (hit) {
    hit.refs++;
    return hit.t;
  }
  const base = capHex(teamIn.secondary, 225);
  const panel = capHex(teamIn.primary, 225);
  const accent = capHex(teamIn.accent, 225);
  const c = canvas(GLOVE_W, GLOVE_H);
  const t = tex(c, true, false, 8);
  paintWithFonts(() => {
    const g = ctx2d(c);
    // (the palm: dark suede; on a light glove a mid grey, as the real ones)
    const light = luminance(base) > 0.35;
    // the patch contrasts with the glove; its lettering in the team's colour where that reads on it
    const patch = light ? '#16171a' : '#e6e7e9';
    const patchInk = Math.abs(luminance(panel) - luminance(patch)) > 0.25 ? panel : Math.abs(luminance(accent) - luminance(patch)) > 0.25 ? accent : contrastOn(patch);
    gloveLayout(g, {
      base,
      panel,
      palm: light ? '#55575c' : '#2a2b2e',
      // (tonal thread, a shade off the knit: the seams read in the light without drawing lines on it)
      stitch: light ? '#6a6d73' : '#7d838b',
      patch,
      patchInk,
      strap: '#121315',
      strapInk: '#a9aeb5',
      binding: panel,
    }, teamIn.sponsor, false);
    t.needsUpdate = true;
  });
  gloveCache.set(key, { t, refs: 1 });
  return t;
}
export function releaseGloveTexture(t: THREE.Texture) {
  for (const [k, v] of gloveCache)
    if (v.t === t && --v.refs <= 0) {
      t.dispose();
      gloveCache.delete(k);
    }
}
/** the gloves' relief (shared): stitching sunk into the knit, padded panels, the grip print */
export function gloveNormalTexture(): THREE.Texture {
  if (gloveNormalTex) return gloveNormalTex;
  const h = canvas(GLOVE_W, GLOVE_H);
  const g = ctx2d(h);
  gloveLayout(g, { base: '#808080', panel: '#a8a8a8', palm: '#7a7a7a', stitch: '#383838', patch: '#9a9a9a', patchInk: '#9a9a9a', strap: '#8c8c8c', strapInk: '#8c8c8c', binding: '#a0a0a0' }, '', true);
  const src = g.getImageData(0, 0, GLOVE_W, GLOVE_H).data;
  const H = new Float32Array(GLOVE_W * GLOVE_H);
  for (let i = 0; i < H.length; i++) H[i] = src[i * 4] / 255 + (hash(i % GLOVE_W, (i / GLOVE_W) | 0) - 0.5) * 0.05;
  // (soften the steps: a stitch is a groove, a panel's edge a rounded seam, not a cliff)
  const blur = new Float32Array(H.length);
  for (let y = 0; y < GLOVE_H; y++)
    for (let x = 0; x < GLOVE_W; x++) {
      let s = 0;
      for (let k = -1; k <= 1; k++) s += H[y * GLOVE_W + Math.min(GLOVE_W - 1, Math.max(0, x + k))];
      blur[y * GLOVE_W + x] = s / 3;
    }
  const out = canvas(GLOVE_W, GLOVE_H);
  const go = ctx2d(out);
  const img = go.createImageData(GLOVE_W, GLOVE_H);
  const at = (x: number, y: number) => blur[Math.min(GLOVE_H - 1, Math.max(0, y)) * GLOVE_W + Math.min(GLOVE_W - 1, Math.max(0, x))];
  const k = 2.2;
  for (let y = 0; y < GLOVE_H; y++)
    for (let x = 0; x < GLOVE_W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * GLOVE_W + x) * 4;
      // (tangent space, +y up the texture: canvas y runs down)
      img.data[i] = Math.round((-dx / l) * 127.5 + 127.5);
      img.data[i + 1] = Math.round((dy / l) * 127.5 + 127.5);
      img.data[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
      img.data[i + 3] = 255;
    }
  go.putImageData(img, 0, 0);
  gloveNormalTex = tex(out, false, false, 8);
  return gloveNormalTex;
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
    // (the nose patch stretches the cell's 128 × 64 px over 15 × 20 cm: x-scale 2.67 keeps the
    // digits upright, ~12 cm tall — they read as a skinny "1" whatever the number without it)
    drawInRect(g, R_NUM_NOSE, String(driver.number), numCol, numOut, 0.62, 2.67);
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
