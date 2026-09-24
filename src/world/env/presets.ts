import type { TimeOfDay, WeatherState } from '../Weather.ts';

/**
 * Lighting presets for the three race times at Monza (45.6° N, early September),
 * plus `weatherLook()`, which blends a time preset with the live weather
 * (cloud, rain, mist) into every number the Environment and the post chain need.
 *
 * Azimuths are compass degrees: 0 = north (−Z), 90 = east (+X), 180 = south (+Z).
 * The main straight runs north, so the afternoon sun (SW) sits behind-left of a car
 * on the straight and the golden-hour sun (W) rakes straight across it, throwing the
 * Tribuna Centrale and the park's plane trees long across the asphalt.
 */
export interface TimePreset {
  /** compass azimuth of the sun (deg) */
  azimuth: number;
  /** sun elevation (deg) */
  elevation: number;
  /** atmosphere: Mie haze multiplier, Mie asymmetry, crude multiple scattering */
  mie: number;
  g: number;
  ms: number;
  /** clear-sky DirectionalLight intensity (colour comes from atmospheric transmittance) */
  sunIntensity: number;
  /** multiplier on the physically matched sky radiance */
  skyBoost: number;
  /** sun disc radiance multiplier */
  sunDisc: number;
  /** cirrus amount in clear weather */
  cirrus: number;
  /** aerial haze at ground level (1/m) and its height falloff (1/m) */
  fogDensity: number;
  fogFalloff: number;
  /** forward-scatter glow of the haze toward the sun */
  fogLobe: number;
  /** grade in clear weather */
  exposure: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  shadowTint: [number, number, number];
  bloom: number;
  bloomThreshold: number;
  /** god-ray strength when the sun is in view (0 = none) */
  shafts: number;
}

export const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
  morning: {
    azimuth: 112,
    elevation: 30,
    mie: 1.7,
    g: 0.8,
    ms: 0.4,
    sunIntensity: 4.0,
    skyBoost: 1.75,
    sunDisc: 26,
    cirrus: 0.35,
    fogDensity: 1.25e-4,
    fogFalloff: 1 / 900,
    fogLobe: 0.8,
    exposure: 1.02,
    saturation: 1.04,
    contrast: 1.07,
    tint: [1.0, 0.985, 0.955],
    shadowTint: [0.95, 0.99, 1.06],
    bloom: 0.8,
    bloomThreshold: 1.1,
    shafts: 0.45,
  },
  afternoon: {
    azimuth: 222,
    elevation: 48,
    mie: 1.2,
    g: 0.78,
    ms: 0.35,
    sunIntensity: 4.5,
    skyBoost: 1.7,
    sunDisc: 30,
    cirrus: 0.3,
    fogDensity: 0.85e-4,
    fogFalloff: 1 / 1200,
    fogLobe: 0.45,
    exposure: 0.97,
    saturation: 1.07,
    contrast: 1.1,
    tint: [1.0, 0.99, 0.97],
    shadowTint: [0.95, 0.985, 1.06],
    bloom: 0.7,
    bloomThreshold: 1.15,
    shafts: 0.25,
  },
  golden: {
    azimuth: 268,
    elevation: 7.5,
    mie: 1.5,
    g: 0.8,
    ms: 0.38,
    sunIntensity: 3.9,
    skyBoost: 1.95,
    sunDisc: 22,
    cirrus: 0.45,
    fogDensity: 1.4e-4,
    fogFalloff: 1 / 1000,
    fogLobe: 1.2,
    exposure: 0.88,
    saturation: 1.16,
    contrast: 1.1,
    tint: [1.0, 0.93, 0.8],
    shadowTint: [0.88, 0.95, 1.12],
    bloom: 1.0,
    bloomThreshold: 1.05,
    shafts: 1.0,
  },
};

/** unit vector toward the sun for a preset (world: x = east, z = south) */
export function sunDirection(p: TimePreset, out: { x: number; y: number; z: number }) {
  const el = (p.elevation * Math.PI) / 180;
  const az = (p.azimuth * Math.PI) / 180;
  out.x = Math.sin(az) * Math.cos(el);
  out.y = Math.sin(el);
  out.z = -Math.cos(az) * Math.cos(el);
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Everything the weather does to the light, as plain numbers. Continuous in the
 * inputs so a forecast change (dry → rain) fades smoothly.
 */
export interface WeatherLook {
  time: TimeOfDay;
  /** 0 … 1 how much of the direct sun gets through the clouds */
  sunVis: number;
  /** 0 … 1 how much the sky dome is replaced by the grey overcast gradient */
  overcast: number;
  /** cloud layer */
  coverage: number;
  cloudBase: number;
  cloudThick: number;
  /** extinction (1/m) at density 1 */
  cloudExt: number;
  /** 0 … 1: rain darkening of cloud bases and more structure in the deck */
  cloudDark: number;
  cirrus: number;
  /** multiplier on the cloud ambient brightness */
  deckLight: number;
  rain: number;
  /** aerial haze density at the ground (1/m), falloff, max opacity, forward lobe */
  fogDensity: number;
  fogFalloff: number;
  fogMax: number;
  fogLobe: number;
  /** distance (m) over which cloud colours fade into the horizon haze */
  cloudHaze: number;
  /** env map intensity and hemisphere fill */
  envIntensity: number;
  hemi: number;
  /** shadow penumbra (texels) — softer when the sun is diffused */
  shadowRadius: number;
  /** grade */
  exposure: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  shadowTint: [number, number, number];
  bloom: number;
  bloomThreshold: number;
  shafts: number;
  /** extra grey haze close to the ground in rain (spray mist, low visibility) */
  mist: number;
}

export function weatherLook(w: WeatherState): WeatherLook {
  const P = TIME_PRESETS[w.time] ?? TIME_PRESETS.afternoon;
  const cloud = clamp01(w.cloud);
  const rain = clamp01(w.rain);
  const fog = clamp01(w.fog);
  const wetK = smooth(0.02, 0.7, rain);
  // direct sun: survives broken cumulus, dies under a deck, gone in rain
  const sunVis = (1 - smooth(0.6, 0.94, cloud)) * (1 - 0.9 * smooth(0.03, 0.35, rain));
  const overcast = smooth(0.62, 0.95, cloud);
  const dim = 1 - sunVis;

  // cloud layer: fair-weather cumulus at ~1.4 km, lowering and thickening into a rain deck
  const cloudBase = mix(mix(1500, 1050, overcast), 520, wetK);
  const cloudThick = mix(mix(700, 1300, smooth(0.25, 0.8, cloud)), 2600, wetK);
  const coverage = cloud;
  const cloudExt = mix(0.035, 0.03, overcast) * (1 + wetK * 0.4);
  const cloudDark = clamp01(wetK * 0.85 + overcast * 0.2);
  const deckLight = mix(1, mix(0.62, 0.3, wetK), overcast);

  // grey gradient visibility: 25 km clear → ~2.5 km drizzle → ~0.9 km downpour
  const fogDensity = P.fogDensity * (1 + overcast * 0.8) + fog * 3.2e-4 + rain * rain * 5.5e-4;
  const fogFalloff = mix(P.fogFalloff, 1 / 420, Math.max(wetK, fog * 0.6));
  const cloudHaze = mix(32000, 9000, Math.max(wetK, fog * 0.7));

  // grade: filmic sun, flat grey overcast, dark desaturated rain
  // eye adaptation to the light level is applied by the Environment; this is the mood on top
  const exposure = P.exposure * mix(1, 0.86, wetK) * mix(1, 1.06, overcast * (1 - wetK));
  const saturation = mix(P.saturation, mix(0.93, 0.78, wetK), dim);
  const contrast = mix(P.contrast, mix(1.02, 1.08, wetK), dim);
  const tintK = dim;
  const tint: [number, number, number] = [mix(P.tint[0], 0.975, tintK), mix(P.tint[1], 0.99, tintK), mix(P.tint[2], 1.02, tintK)];
  const shadowTint: [number, number, number] = [
    mix(P.shadowTint[0], 0.93, tintK),
    mix(P.shadowTint[1], 0.975, tintK),
    mix(P.shadowTint[2], 1.06, tintK),
  ];

  return {
    time: w.time,
    sunVis,
    overcast,
    coverage,
    cloudBase,
    cloudThick,
    cloudExt,
    cloudDark,
    cirrus: P.cirrus * (1 - overcast) * (1 - smooth(0.3, 0.7, cloud) * 0.5),
    deckLight,
    rain,
    fogDensity,
    fogFalloff,
    fogMax: 1,
    fogLobe: P.fogLobe * sunVis,
    cloudHaze,
    envIntensity: 1,
    hemi: mix(0.08, 0.18, dim),
    shadowRadius: mix(2.2, 6, smooth(0.3, 0.9, dim)),
    exposure,
    saturation,
    contrast,
    tint,
    shadowTint,
    bloom: mix(P.bloom, 1.15, wetK),
    bloomThreshold: mix(P.bloomThreshold, 0.9, wetK),
    shafts: P.shafts * sunVis,
    mist: clamp01(wetK * 0.8 + fog * 0.5),
  };
}

/** largest normalised difference between two looks (drives the env-map rebake) */
export function lookDelta(a: WeatherLook, b: WeatherLook): number {
  if (a.time !== b.time) return 1;
  return Math.max(
    Math.abs(a.sunVis - b.sunVis),
    Math.abs(a.overcast - b.overcast),
    Math.abs(a.coverage - b.coverage) * 0.8,
    Math.abs(a.rain - b.rain) * 0.7,
    Math.abs(a.deckLight - b.deckLight),
    Math.abs(a.cloudDark - b.cloudDark),
  );
}
