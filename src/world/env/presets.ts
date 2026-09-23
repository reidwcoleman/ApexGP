import type { TimeOfDay } from '../Environment.ts';

/**
 * Time-of-day presets. Sun azimuth: 0° = toward +Z (south), −90° = toward −X (west).
 * The pit straight runs toward +Z, so a south-westerly golden sun backlights it and
 * lays a glitter path on the sea beyond the lighthouse and the harbour.
 */
export interface Preset {
  sunAzimuth: number;
  sunElevation: number;
  /** atmosphere */
  mie: number;
  g: number;
  ms: number;
  /** DirectionalLight intensity (colour comes from atmospheric transmittance) */
  sunIntensity: number;
  /** multiplier on the physically matched sky radiance */
  skyBoost: number;
  /** sun disc radiance multiplier */
  sunDisc: number;
  /** clouds: coverage overhead, coverage toward horizon, cirrus, opacity */
  clouds: [number, number, number, number];
  /** grey out the sky toward the cloud colour (overcast) */
  overcast: number;
  /** aerial fog density at sea level (1/m) and height falloff (1/m) */
  fogDensity: number;
  fogFalloff: number;
  /** strength of the forward-scatter lobe in the haze */
  fogLobe: number;
  envIntensity: number;
  hemi: number;
  grade: { exposure: number; saturation: number; contrast: number; tint: number; shadowTint: number };
  bloom: number;
  bloomThreshold: number;
  /** water wave strength */
  waves: number;
}

export const PRESETS: Record<TimeOfDay, Preset> = {
  golden: {
    sunAzimuth: -48,
    sunElevation: 8.5,
    mie: 1.25,
    g: 0.8,
    ms: 0.35,
    sunIntensity: 3.6,
    skyBoost: 1.9,
    sunDisc: 22,
    clouds: [0.16, 0.5, 0.45, 1],
    overcast: 0,
    fogDensity: 1.5e-4,
    fogFalloff: 1 / 1100,
    fogLobe: 1,
    envIntensity: 1,
    hemi: 0.12,
    grade: { exposure: 1.08, saturation: 1.1, contrast: 1.08, tint: 0xfff0dc, shadowTint: 0xe6eefc },
    bloom: 1.05,
    bloomThreshold: 1.05,
    waves: 1,
  },
  day: {
    sunAzimuth: -25,
    sunElevation: 57,
    mie: 1.1,
    g: 0.78,
    ms: 0.35,
    sunIntensity: 4.2,
    skyBoost: 1.7,
    sunDisc: 30,
    clouds: [0.14, 0.4, 0.35, 1],
    overcast: 0,
    fogDensity: 0.9e-4,
    fogFalloff: 1 / 1300,
    fogLobe: 0.4,
    envIntensity: 1,
    hemi: 0.1,
    grade: { exposure: 0.98, saturation: 1.06, contrast: 1.06, tint: 0xfffaf2, shadowTint: 0xf0f4ff },
    bloom: 0.65,
    bloomThreshold: 1.15,
    waves: 1,
  },
  overcast: {
    sunAzimuth: -35,
    sunElevation: 38,
    mie: 3.2,
    g: 0.7,
    ms: 0.6,
    sunIntensity: 0.9,
    skyBoost: 3.2,
    sunDisc: 0,
    clouds: [0.93, 0.97, 0.0, 1],
    overcast: 1,
    fogDensity: 2.6e-4,
    fogFalloff: 1 / 900,
    fogLobe: 0.15,
    envIntensity: 1,
    hemi: 0.2,
    grade: { exposure: 1.2, saturation: 0.9, contrast: 1.0, tint: 0xf6f8ff, shadowTint: 0xf2f4f8 },
    bloom: 0.45,
    bloomThreshold: 1.2,
    waves: 1.35,
  },
};
