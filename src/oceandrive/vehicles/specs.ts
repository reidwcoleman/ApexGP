/** car model specs (from the old Miami fleet): sizes and shape parameters for the loft in carmodel.ts */
export type ModelId = 'sedan' | 'compact' | 'suv' | 'gwagon' | 'pickup' | 'coupe' | 'super' | 'muscle' | 'van' | 'bus' | 'cyber' | 'taxi' | 'police' | 'policeSuv';

export interface ModelSpec {
  id: ModelId;
  L: number;
  W: number;
  H: number;
  wb: number;
  wheelR: number;
  /** z of the windscreen base, roof front, roof back, rear glass foot (fraction of half length) */
  cowl: number;
  roofF: number;
  roofR: number;
  deck: number;
  hoodH: number;
  beltH: number;
  deckH: number;
  clear: number;
  /** squareness 0 (round) .. 1 (box) */
  box: number;
  tumble: number;
  mass: number;
  power: number;
}

export const MODELS: Record<ModelId, ModelSpec> = {
  sedan: { id: 'sedan', L: 4.85, W: 1.84, H: 1.45, wb: 2.83, wheelR: 0.33, cowl: 0.42, roofF: 0.12, roofR: -0.42, deck: -0.7, hoodH: 0.82, beltH: 0.96, deckH: 0.98, clear: 0.15, box: 0.3, tumble: 0.16, mass: 1550, power: 150000 },
  compact: { id: 'compact', L: 4.3, W: 1.78, H: 1.46, wb: 2.64, wheelR: 0.31, cowl: 0.4, roofF: 0.12, roofR: -0.58, deck: -0.92, hoodH: 0.8, beltH: 0.95, deckH: 1.0, clear: 0.15, box: 0.35, tumble: 0.15, mass: 1300, power: 110000 },
  suv: { id: 'suv', L: 4.95, W: 1.98, H: 1.78, wb: 2.95, wheelR: 0.38, cowl: 0.45, roofF: 0.2, roofR: -0.82, deck: -0.97, hoodH: 1.08, beltH: 1.18, deckH: 1.2, clear: 0.22, box: 0.55, tumble: 0.12, mass: 2100, power: 220000 },
  gwagon: { id: 'gwagon', L: 4.85, W: 1.98, H: 1.97, wb: 2.89, wheelR: 0.39, cowl: 0.42, roofF: 0.3, roofR: -0.9, deck: -0.97, hoodH: 1.16, beltH: 1.24, deckH: 1.3, clear: 0.24, box: 0.95, tumble: 0.02, mass: 2500, power: 310000 },
  pickup: { id: 'pickup', L: 5.9, W: 2.03, H: 1.95, wb: 3.68, wheelR: 0.42, cowl: 0.5, roofF: 0.3, roofR: -0.12, deck: -0.15, hoodH: 1.25, beltH: 1.33, deckH: 1.28, clear: 0.26, box: 0.75, tumble: 0.08, mass: 2400, power: 300000 },
  coupe: { id: 'coupe', L: 4.52, W: 1.9, H: 1.3, wb: 2.45, wheelR: 0.34, cowl: 0.32, roofF: 0.0, roofR: -0.4, deck: -0.78, hoodH: 0.76, beltH: 0.88, deckH: 0.86, clear: 0.12, box: 0.25, tumble: 0.2, mass: 1500, power: 330000 },
  super: { id: 'super', L: 4.62, W: 2.02, H: 1.14, wb: 2.7, wheelR: 0.36, cowl: 0.56, roofF: 0.14, roofR: -0.22, deck: -0.86, hoodH: 0.7, beltH: 0.8, deckH: 0.9, clear: 0.1, box: 0.18, tumble: 0.26, mass: 1450, power: 470000 },
  muscle: { id: 'muscle', L: 4.92, W: 1.96, H: 1.34, wb: 2.86, wheelR: 0.36, cowl: 0.2, roofF: -0.06, roofR: -0.46, deck: -0.84, hoodH: 0.93, beltH: 0.99, deckH: 0.98, clear: 0.13, box: 0.5, tumble: 0.17, mass: 1750, power: 360000 },
  van: { id: 'van', L: 5.9, W: 2.0, H: 2.55, wb: 3.66, wheelR: 0.36, cowl: 0.72, roofF: 0.6, roofR: -0.98, deck: -0.995, hoodH: 1.1, beltH: 1.2, deckH: 2.3, clear: 0.2, box: 0.8, tumble: 0.05, mass: 2600, power: 140000 },
  bus: { id: 'bus', L: 12.2, W: 2.55, H: 3.2, wb: 6.2, wheelR: 0.5, cowl: 0.985, roofF: 0.97, roofR: -0.985, deck: -0.995, hoodH: 0.9, beltH: 1.0, deckH: 3.0, clear: 0.3, box: 0.92, tumble: 0.02, mass: 12000, power: 220000 },
  cyber: { id: 'cyber', L: 5.68, W: 2.03, H: 1.79, wb: 3.81, wheelR: 0.42, cowl: 0.3, roofF: 0.06, roofR: -0.06, deck: -0.98, hoodH: 1.12, beltH: 1.18, deckH: 1.3, clear: 0.28, box: 1.0, tumble: 0.18, mass: 3100, power: 600000 },
  taxi: { id: 'taxi', L: 4.85, W: 1.84, H: 1.48, wb: 2.83, wheelR: 0.33, cowl: 0.42, roofF: 0.12, roofR: -0.42, deck: -0.7, hoodH: 0.82, beltH: 0.96, deckH: 0.98, clear: 0.15, box: 0.3, tumble: 0.16, mass: 1550, power: 150000 },
  police: { id: 'police', L: 5.1, W: 1.9, H: 1.48, wb: 3.05, wheelR: 0.35, cowl: 0.4, roofF: 0.1, roofR: -0.42, deck: -0.72, hoodH: 0.88, beltH: 1.0, deckH: 1.02, clear: 0.14, box: 0.4, tumble: 0.15, mass: 1900, power: 290000 },
  policeSuv: { id: 'policeSuv', L: 5.05, W: 2.0, H: 1.8, wb: 3.02, wheelR: 0.38, cowl: 0.45, roofF: 0.2, roofR: -0.82, deck: -0.97, hoodH: 1.08, beltH: 1.18, deckH: 1.2, clear: 0.22, box: 0.55, tumble: 0.12, mass: 2200, power: 300000 },
};

/** paint colours (linear-ish sRGB hex), weighted like Miami's streets: white, black, greys, then colour */
export const PAINTS = [
  // what's really parked on Ocean Drive: white, black, silver and grey mostly
  0xf2f2f0, 0xf2f2f0, 0xeeeeea, 0xe8e6e0, 0x101114, 0x15161a, 0x0c0d10, 0x8e9196, 0x6b6e73, 0xb9bcc0, 0xa7aaae, 0x3a3d42,
  0x1e3a6e, 0x16233f, 0x7a0f14, 0xb3121b, 0x1f3d2c, 0xd4c7a8, 0x5b4636,
  // and a few of Miami's own
  0x16c4d4, 0xff6f9e, 0x2a8fbf,
];

/** the sports cars wear the loud ones */
export const SPORT_PAINT = [0xff3f8e, 0x12c6d6, 0xff6a1a, 0x7b3cff, 0xc40d16, 0xe0b21d, 0xf1efe9, 0x0b0c0e, 0x0b0c0e, 0xf1efe9, 0x00a383, 0x9aa0a6];

