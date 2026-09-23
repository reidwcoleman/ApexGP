/**
 * Shared layout constants for the car: dimensions, texture-atlas regions and palette slots.
 * Geometry (carGeometry.ts) writes UVs against these; textures (Livery.ts, carTextures.ts) paint them.
 */
import type { V2 } from './carMath.ts';

// ---------------------------------------------------------------- dimensions (metres, car local space)
export const WHEELBASE = 3.4;
export const Z_FRONT_AXLE = WHEELBASE / 2;
export const Z_REAR_AXLE = -WHEELBASE / 2;
export const WHEEL_R = 0.36;
export const RIM_R = 0.2286; // 18" bead seat
export const TYRE_W_F = 0.3;
export const TYRE_W_R = 0.4;
export const TRACK_F = 1.6; // wheel centre to centre
export const TRACK_R = 1.5;
export const CAR_WIDTH = 1.9;
export const CAR_LENGTH = 5.5; // front wing LE to rear wing TE

// ---------------------------------------------------------------- paint atlas (per team)
export const PAINT_W = 2048;
export const PAINT_H = 1536;
/** hull unwrap occupies rows [0, HULL_ROWS); top centre line at HULL_ROWS/2 */
export const HULL_ROWS = 1152;
export const HULL_Z0 = -2.44;
export const HULL_Z1 = 3.04;
export const MASK_SCALE = 0.5; // mask texture is half resolution

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** flat paint cells (64×64 each) in the strip at the top of the misc area */
export const PAINT_CELL = 64;
export const PC = {
  primary: 0,
  secondary: 1,
  accent: 2,
  ink: 3,
  black: 4,
  white: 5,
  inlet: 6,
  carbon: 7,
  halo: 8,
  mirror: 9,
  airbox: 10,
  fwFlap: 11,
  fwFlap2: 12,
  endplateIn: 13,
  primaryDark: 14,
  chrome: 15,
} as const;
export const R_PAL: Rect = { x: 0, y: 1152, w: 1024, h: 64 };
export const R_FLAP: Rect = { x: 1024, y: 1152, w: 1024, h: 128 };
export const R_MAIN: Rect = { x: 1024, y: 1280, w: 1024, h: 128 };
export const R_FWING: Rect = { x: 1024, y: 1408, w: 1024, h: 128 };
/** rear-wing endplates: outer-left, outer-right, inner (both), halo strip */
export const R_EP_OL: Rect = { x: 0, y: 1216, w: 320, h: 256 };
export const R_EP_OR: Rect = { x: 320, y: 1216, w: 320, h: 256 };
export const R_EP_IN: Rect = { x: 640, y: 1216, w: 384, h: 256 };
export const R_FIN_L: Rect = { x: 0, y: 1472, w: 512, h: 64 };
export const R_FIN_R: Rect = { x: 512, y: 1472, w: 512, h: 64 };

export function paintCellUV(i: number): V2 {
  const x = R_PAL.x + (i + 0.5) * PAINT_CELL;
  const y = R_PAL.y + PAINT_CELL / 2;
  return [x / PAINT_W, 1 - y / PAINT_H];
}
/** map (a,b) ∈ [0,1]² into a paint-atlas rect; a → +x (canvas right), b → canvas UP */
export function rectUV(r: Rect, a: number, b: number, W = PAINT_W, H = PAINT_H): V2 {
  const x = r.x + 1 + a * (r.w - 2);
  const y = r.y + r.h - 1 - b * (r.h - 2);
  return [x / W, 1 - y / H];
}

// ---------------------------------------------------------------- trim palette (per car, 512×256, 16px cells)
export const TRIM_W = 512;
export const TRIM_H = 256;
export const TRIM_CELL = 16;
export const TC = {
  blackGloss: 0,
  blackSatin: 1,
  darkMetal: 2,
  titanium: 3,
  exhaust: 4,
  disc: 5,
  discEdge: 6,
  caliper: 7,
  tcam: 8,
  visor: 9,
  mirrorGlass: 10,
  suit: 11,
  suit2: 12,
  hans: 13,
  belts: 14,
  rainLight: 15,
  wheelBody: 16,
  grip: 17,
  btnRed: 18,
  btnYellow: 19,
  btnBlue: 20,
  btnGreen: 21,
  inletDark: 22,
  skid: 23,
  helmet: 24,
  helmet2: 25,
  rubber: 26,
  accent: 27,
  primary: 28,
  plank: 29,
  gold: 30,
  glove: 31,
  secondary: 32,
  ductBlack: 33,
  padding: 34,
  ink: 35,
  halo: 36,
} as const;
/** roughness, metalness, emissive masks (r: brake heat, g: rain light, b: self-lit/display) */
export const TRIM_PROPS: Record<number, [number, number, number, number, number]> = {
  [TC.blackGloss]: [0.22, 0.0, 0, 0, 0],
  [TC.blackSatin]: [0.55, 0.0, 0, 0, 0],
  [TC.darkMetal]: [0.38, 0.85, 0, 0, 0],
  [TC.titanium]: [0.28, 1.0, 0, 0, 0],
  [TC.exhaust]: [0.32, 1.0, 0, 0, 0],
  [TC.disc]: [0.78, 0.0, 0.85, 0, 0],
  [TC.discEdge]: [0.7, 0.0, 1.0, 0, 0],
  [TC.caliper]: [0.35, 0.4, 0.12, 0, 0],
  [TC.tcam]: [0.3, 0.0, 0, 0, 0.12],
  [TC.visor]: [0.04, 0.9, 0, 0, 0],
  [TC.mirrorGlass]: [0.02, 1.0, 0, 0, 0],
  [TC.suit]: [0.85, 0.0, 0, 0, 0],
  [TC.suit2]: [0.85, 0.0, 0, 0, 0],
  [TC.hans]: [0.35, 0.1, 0, 0, 0],
  [TC.belts]: [0.8, 0.0, 0, 0, 0],
  [TC.rainLight]: [0.2, 0.0, 0, 1, 0],
  [TC.wheelBody]: [0.35, 0.1, 0, 0, 0],
  [TC.grip]: [0.92, 0.0, 0, 0, 0],
  [TC.btnRed]: [0.3, 0.0, 0, 0, 0.35],
  [TC.btnYellow]: [0.3, 0.0, 0, 0, 0.35],
  [TC.btnBlue]: [0.3, 0.0, 0, 0, 0.35],
  [TC.btnGreen]: [0.3, 0.0, 0, 0, 0.35],
  [TC.inletDark]: [0.9, 0.0, 0, 0, 0],
  [TC.skid]: [0.32, 1.0, 0, 0, 0],
  [TC.helmet]: [0.18, 0.0, 0, 0, 0],
  [TC.helmet2]: [0.18, 0.0, 0, 0, 0],
  [TC.rubber]: [0.88, 0.0, 0, 0, 0],
  [TC.accent]: [0.25, 0.0, 0, 0, 0],
  [TC.primary]: [0.25, 0.0, 0, 0, 0],
  [TC.plank]: [0.75, 0.0, 0, 0, 0],
  [TC.gold]: [0.3, 1.0, 0, 0, 0],
  [TC.glove]: [0.8, 0.0, 0, 0, 0],
  [TC.secondary]: [0.25, 0.0, 0, 0, 0],
  [TC.ductBlack]: [0.45, 0.0, 0, 0, 0],
  [TC.padding]: [0.95, 0.0, 0, 0, 0],
  [TC.ink]: [0.25, 0.0, 0, 0, 0],
  [TC.halo]: [0.3, 0.0, 0, 0, 0],
};
export function trimUV(i: number): V2 {
  const cols = TRIM_W / TRIM_CELL;
  const cx = (i % cols) + 0.5;
  const cy = Math.floor(i / cols) + 0.5;
  return [(cx * TRIM_CELL) / TRIM_W, 1 - (cy * TRIM_CELL) / TRIM_H];
}
/** steering-wheel display image region inside the trim texture */
export const R_DISPLAY: Rect = { x: 256, y: 128, w: 128, h: 64 };
export const R_LEDS: Rect = { x: 256, y: 208, w: 128, h: 16 };

// ---------------------------------------------------------------- wheel atlas (shared, 2048×512)
export const WHEEL_TEX_W = 2048;
export const WHEEL_TEX_H = 512;
export const R_SIDEWALL: Rect = { x: 0, y: 0, w: 2048, h: 256 };
export const R_TREAD: Rect = { x: 0, y: 256, w: 2048, h: 96 };
export const R_RIMFACE: Rect = { x: 0, y: 352, w: 160, h: 160 }; // blurred rim image (far LOD face)
export const WHEEL_CELL = 32;
export const WC = {
  rimMetal: 0,
  rimLip: 1,
  nut: 2,
  hub: 3,
  barrel: 4,
  valve: 5,
  rubber: 6,
} as const;
export const WHEEL_PROPS: Record<number, [number, number]> = {
  [WC.rimMetal]: [0.42, 0.75],
  [WC.rimLip]: [0.22, 1.0],
  [WC.nut]: [0.3, 1.0],
  [WC.hub]: [0.4, 0.8],
  [WC.barrel]: [0.5, 0.7],
  [WC.valve]: [0.3, 1.0],
  [WC.rubber]: [0.85, 0.0],
};
export function wheelCellUV(i: number): V2 {
  const x = 192 + (i + 0.5) * WHEEL_CELL;
  const y = 352 + WHEEL_CELL / 2;
  return [x / WHEEL_TEX_W, 1 - y / WHEEL_TEX_H];
}
export const SIDEWALL_R0 = RIM_R + 0.004;
export const SIDEWALL_R1 = WHEEL_R - 0.018;

// ---------------------------------------------------------------- driver texture (per driver, 512×256)
export const DRV_W = 512;
export const DRV_H = 256;
export const R_HELMET: Rect = { x: 0, y: 0, w: 256, h: 256 };
export const R_NUM_NOSE: Rect = { x: 256, y: 0, w: 128, h: 64 };
export const R_NUM_FIN_L: Rect = { x: 384, y: 0, w: 128, h: 64 };
export const R_NUM_FIN_R: Rect = { x: 256, y: 64, w: 128, h: 64 };
export const R_TCAM_NUM: Rect = { x: 384, y: 64, w: 128, h: 48 };
export const R_CODE_L: Rect = { x: 256, y: 128, w: 256, h: 32 };
export const R_CODE_R: Rect = { x: 256, y: 160, w: 256, h: 32 };
/** flat colour cells in the driver sheet (16×16 at y = 224) */
export const DC = { visor: 0, suit: 1, suit2: 2, hans: 3, glove: 4, belts: 5 } as const;
export function drvCellUV(i: number): V2 {
  return [(256 + i * 16 + 8) / DRV_W, 1 - (224 + 8) / DRV_H];
}
