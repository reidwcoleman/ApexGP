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
  /** multiplier on the direct light only (twilight: the sky still glows, the sun has set); default 1 */
  direct?: number;
  /** circuit floodlights 0 … 1 (see env/night.ts); default 0 */
  flood?: number;
  /** 0 … 1 night sky: stars, the city's glow on the horizon, the moon in place of the sun; default 0 */
  night?: number;
}

export const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
  dawn: {
    azimuth: 96,
    elevation: 4.5,
    mie: 1.9,
    g: 0.82,
    ms: 0.42,
    sunIntensity: 3.3,
    skyBoost: 2.1,
    sunDisc: 20,
    cirrus: 0.5,
    fogDensity: 1.9e-4,
    fogFalloff: 1 / 700,
    fogLobe: 1.4,
    exposure: 0.92,
    saturation: 1.18,
    contrast: 1.1,
    tint: [1.0, 0.9, 0.8],
    shadowTint: [0.94, 0.95, 1.06],
    bloom: 1.05,
    bloomThreshold: 1.0,
    // (the radial blur of the bright low sky smeared a white glare down over the land below the sun)
    shafts: 0.55,
  },
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
    fogDensity: 1.7e-4,
    fogFalloff: 1 / 900,
    fogLobe: 0.8,
    exposure: 1.1,
    saturation: 1.0,
    contrast: 1.07,
    tint: [1.0, 0.985, 0.955],
    shadowTint: [0.95, 0.99, 1.06],
    bloom: 0.8,
    bloomThreshold: 1.1,
    shafts: 0.45,
  },
  midday: {
    azimuth: 186,
    elevation: 60,
    mie: 1.0,
    g: 0.76,
    ms: 0.33,
    sunIntensity: 4.8,
    skyBoost: 1.65,
    sunDisc: 32,
    cirrus: 0.25,
    fogDensity: 1.0e-4,
    fogFalloff: 1 / 1400,
    fogLobe: 0.3,
    exposure: 1.03,
    saturation: 1.0,
    contrast: 1.13,
    tint: [1.0, 0.995, 0.98],
    shadowTint: [0.95, 0.98, 1.05],
    bloom: 0.6,
    bloomThreshold: 1.2,
    shafts: 0.1,
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
    fogDensity: 1.2e-4,
    fogFalloff: 1 / 1200,
    fogLobe: 0.45,
    // (daytime onboard footage is exposed for the shade more than the sky: mid-grey ~0.3, colour muted)
    exposure: 1.05,
    saturation: 0.98,
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
    exposure: 0.9,
    // (golden-hour footage — the Spa long lens — is orange through and through: the light, the shade
    // the low sun fills, even the asphalt; sRGB r/g ≈ 1.6 in the shadows, saturation ≈ 0.55)
    saturation: 1.42,
    contrast: 1.22,
    tint: [1.04, 0.83, 0.56],
    shadowTint: [1.3, 0.87, 0.52],
    bloom: 1.0,
    bloomThreshold: 1.05,
    shafts: 0.55,
  },
  sunset: {
    azimuth: 274,
    elevation: 3.5,
    mie: 1.8,
    g: 0.82,
    ms: 0.42,
    sunIntensity: 3.1,
    skyBoost: 2.3,
    sunDisc: 18,
    cirrus: 0.55,
    fogDensity: 1.6e-4,
    fogFalloff: 1 / 900,
    fogLobe: 1.5,
    exposure: 0.86,
    saturation: 1.42,
    contrast: 1.14,
    tint: [1.0, 0.8, 0.58],
    shadowTint: [1.08, 0.9, 0.72],
    bloom: 1.15,
    bloomThreshold: 1.0,
    shafts: 0.65,
  },
  // blue hour, the sun just gone: an orange band in the west under a deep blue sky, the first
  // stars, and the floodlights taking over (Abu Dhabi)
  dusk: {
    azimuth: 282,
    elevation: 0.6,
    mie: 1.6,
    g: 0.8,
    ms: 0.5,
    sunIntensity: 2.6,
    skyBoost: 1.35,
    sunDisc: 0,
    cirrus: 0.5,
    fogDensity: 1.3e-4,
    fogFalloff: 1 / 900,
    fogLobe: 0.9,
    exposure: 0.74,
    saturation: 1.0,
    contrast: 1.1,
    // (blue hour footage is slate blue-grey, the orange only a thin band where the sun went down)
    tint: [0.86, 0.97, 1.12],
    shadowTint: [0.84, 0.93, 1.22],
    bloom: 1.2,
    bloomThreshold: 0.95,
    shafts: 0,
    direct: 0.05,
    flood: 0.75,
    night: 0.35,
  },
  // a floodlit night race (Singapore, Bahrain, Las Vegas): the moon stands in for the sun
  night: {
    azimuth: 140,
    elevation: 38,
    mie: 1.2,
    g: 0.78,
    ms: 0.35,
    // (a faint moon, like night footage from Le Mans: barely more than silhouettes beyond the
    // headlights' pool; the lights round the track, the cars' rain lights and the headlights carry it)
    sunIntensity: 0.11,
    skyBoost: 0.05,
    sunDisc: 26,
    cirrus: 0.2,
    fogDensity: 1.0e-4,
    fogFalloff: 1 / 800,
    fogLobe: 0,
    exposure: 0.92,
    saturation: 1.06,
    contrast: 1.1,
    tint: [1.0, 0.98, 0.96],
    // (night onboard footage: the dark is a greenish brown-black under the sodium and LED lights, not navy)
    shadowTint: [0.94, 1.0, 0.9],
    bloom: 1.8,
    bloomThreshold: 0.75,
    shafts: 0,
    flood: 1,
    night: 1,
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

/**
 * The post chain tone-maps with Khronos PBR Neutral, which keeps base colours true and only
 * rolls off the highlights; a light touch of broadcast-camera punch on top. The per-time
 * values above stay relative to each other.
 */
const TONE_SAT = 0.88;
const TONE_CONTRAST = 1.0;
/**
 * The game's look on top of the physical light: a touch darker than a straight exposure, deeper
 * shade (less sky fill, so sunlit and shadowed surfaces separate), cool clean shadows and warm-
 * neutral highlights — a graded broadcast/cinematic image rather than a flat capture. (Shadows only a
 * touch cool: footage's low-sun shade is a warm near-black, not the navy of a game's skylight.)
 */
const LOOK_EXPOSURE = 0.84;
const LOOK_FILL = 0.74;
const LOOK_SHADOW: [number, number, number] = [0.96, 0.99, 1.04];
const LOOK_HIGH: [number, number, number] = [1.04, 1.0, 0.95];

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
  // dense fog: the ground layer eats the view and most of the sun
  const thick = smooth(0.7, 1, fog);
  // direct sun: survives broken cumulus, dies under a deck, gone in rain from a full deck
  // (a shower from broken cloud keeps the sun: a sun shower)
  const sunVis = (1 - smooth(0.6, 0.94, cloud)) * (1 - 0.9 * smooth(0.03, 0.35, rain) * smooth(0.45, 0.85, cloud)) * (1 - 0.75 * thick);
  const overcast = smooth(0.62, 0.95, cloud);
  const dim = 1 - sunVis;

  // cloud layer: fair-weather cumulus at ~1.4 km, lowering and thickening into a rain deck
  const cloudBase = mix(mix(1500, 1050, overcast), 520, wetK);
  const cloudThick = mix(mix(700, 1300, smooth(0.25, 0.8, cloud)), 2600, wetK);
  const coverage = cloud;
  const cloudExt = mix(0.035, 0.03, overcast) * (1 + wetK * 0.4);
  const cloudDark = clamp01(wetK * 0.85 + overcast * 0.2);
  const deckLight = mix(1, mix(0.62, 0.3, wetK), overcast);

  // grey gradient visibility: 25 km clear → ~2 km drizzle → ~0.6 km downpour (trees across the
  // track already greyed by the rain, as in wet onboard footage)
  // fog 1: ~200 m to half-visibility, ~650 m to nothing
  // (×1.25, and never crisper than ~15 km: a summer broadcast's soft depth sells the scale;
  // dawn and dusk already carry their own thick haze)
  // (the floor is the air of real footage: even a clear day softens the far side of a circuit)
  // (a clear day's floor kept low enough that the land layers into the distance — ridge behind ridge,
  // each bluer and paler — instead of melting into a flat band; the colour shift does the depth)
  const fogDensity = Math.max(P.fogDensity, 1.2e-4) * (1 + overcast * 0.6) + fog * 3.2e-4 + smooth(0.5, 0.9, fog) * 1.3e-3 + rain * rain * 3.2e-3 + thick * 3.2e-3;
  const fogFalloff = mix(P.fogFalloff, 1 / 420, Math.max(wetK, fog * 0.6));
  const cloudHaze = mix(32000, 9000, Math.max(wetK, fog * 0.7));

  // grade: filmic sun, flat grey overcast, dark desaturated rain
  // eye adaptation to the light level is applied by the Environment; this is the mood on top
  const exposure = P.exposure * mix(1, 0.86, wetK) * mix(1, 1.06, overcast * (1 - wetK)) * LOOK_EXPOSURE;
  const saturation = mix(P.saturation, mix(0.93, 0.78, wetK), dim) * (1 - 0.12 * fog - 0.14 * thick) * TONE_SAT;
  const contrast = mix(P.contrast, mix(1.02, 1.08, wetK), dim) * (1 - 0.08 * thick) * TONE_CONTRAST;
  const tintK = dim;
  const tint: [number, number, number] = [mix(P.tint[0], 0.975, tintK) * LOOK_HIGH[0], mix(P.tint[1], 0.99, tintK) * LOOK_HIGH[1], mix(P.tint[2], 1.02, tintK) * LOOK_HIGH[2]];
  const shadowTint: [number, number, number] = [
    mix(P.shadowTint[0], 0.93, tintK) * LOOK_SHADOW[0],
    mix(P.shadowTint[1], 0.975, tintK) * LOOK_SHADOW[1],
    mix(P.shadowTint[2], 1.06, tintK) * LOOK_SHADOW[2],
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
    // (clear air never quite swallows a hillside: its silhouette stays readable against the sky)
    fogMax: mix(0.93, 1, Math.max(wetK, smooth(0.3, 0.8, fog), overcast * 0.5)),
    fogLobe: P.fogLobe * sunVis,
    cloudHaze,
    // (in the sun the shade is darker than the sky alone would make it; under cloud the fill is the light)
    envIntensity: mix(LOOK_FILL, 0.92, dim),
    hemi: mix(0.06, 0.16, dim),
    shadowRadius: mix(2.6, 6, smooth(0.3, 0.9, dim)),
    exposure,
    saturation,
    contrast,
    tint,
    shadowTint,
    // bloom is veiling glare, not a glow effect: kept low (highlights, wet reflections, the sun)
    bloom: mix(P.bloom * 0.7, 0.85, wetK),
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
