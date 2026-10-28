/**
 * Arenas and times of day. A match picks one of each; every combination works. The arena decides the
 * dressing around the same pitch (stands, roof, floodlights, what stands beyond the bowl, the grass);
 * the time decides the light (sun or floodlights, sky, fog, the image light, bloom).
 *
 * Colours are linear. Directions are in three's frame (y up); the sim's +y end (orange) is three's −z.
 */

export type TimeId = 'morning' | 'day' | 'sunset' | 'night';
export type MapId = 'apex' | 'alpine' | 'harbor' | 'meadow';

export interface TimeLook {
  id: TimeId;
  name: string;
  /** 1 sunlit … 0 floodlit: every arena shader blends its day and night dressing by this */
  day: number;
  /** the floodlights are on (lamps blaze, beams in the haze) */
  floods: boolean;
  /** the key light (the sun, or the light rings at night): direction it comes from */
  keyDir: [number, number, number];
  keyCol: [number, number, number];
  keyI: number;
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  hemiI: number;
  fillCol: [number, number, number];
  fillI: number;
  fog: [number, number, number];
  fogDensity: number;
  envI: number;
  bloom: number;
  bloomThreshold: number;
  // the sky
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** a band of colour just over the horizon (dawn, dusk, a city's glow) */
  glow: [number, number, number];
  sunCol: [number, number, number];
  /** the sun disc's brightness (0 = none) */
  disc: number;
  /** cloud cover 0…1 and the clouds' lit and shaded colours */
  cloud: number;
  cloudLit: [number, number, number];
  cloudShade: [number, number, number];
  stars: number;
}

export interface MapLook {
  id: MapId;
  name: string;
  blurb: string;
  /** the canopy over the upper tier */
  roof: boolean;
  /** the stands: two tiers, or one low bank (the hills show over it) */
  tiers: 1 | 2;
  /** floodlights on the roof ring, or four masts at the corners */
  lights: 'ring' | 'masts';
  surround: 'none' | 'mountains' | 'city' | 'hills';
  /** multiplies the pitch's grass */
  grass: [number, number, number];
  /** snow on the roof, the concourse and the tops of things */
  snow: number;
  /** the concourse and the backs of the stands (day colour) */
  concourse: number;
}

const n3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const TIMES: Record<TimeId, TimeLook> = {
  // low sun from the east over the blue end: long shadows, a cool haze, warm light
  morning: {
    id: 'morning',
    name: 'Morning',
    day: 0.9,
    floods: false,
    keyDir: n3(0.85, 0.36, 0.35),
    keyCol: [1.0, 0.86, 0.68],
    keyI: 2.5,
    hemiSky: [0.62, 0.74, 0.95],
    hemiGround: [0.3, 0.36, 0.22],
    hemiI: 0.6,
    fillCol: [0.6, 0.72, 1.0],
    fillI: 0.45,
    fog: [0.66, 0.72, 0.8],
    fogDensity: 0.00024,
    envI: 0.6,
    bloom: 0.62,
    bloomThreshold: 0.9,
    zenith: [0.2, 0.38, 0.72],
    horizon: [0.78, 0.8, 0.84],
    glow: [1.0, 0.78, 0.55],
    sunCol: [1.0, 0.82, 0.6],
    disc: 34,
    cloud: 0.42,
    cloudLit: [1.08, 0.96, 0.86],
    cloudShade: [0.55, 0.6, 0.72],
    stars: 0,
  },
  // a high summer sun, fair-weather cumulus
  day: {
    id: 'day',
    name: 'Afternoon',
    day: 1,
    floods: false,
    keyDir: n3(0.25, 1, 0.35),
    keyCol: [1.0, 0.94, 0.86],
    keyI: 2.7,
    hemiSky: [0.66, 0.78, 1.0],
    hemiGround: [0.25, 0.33, 0.17],
    hemiI: 0.55,
    fillCol: [0.62, 0.74, 1.0],
    fillI: 0.55,
    fog: [0.66, 0.76, 0.87],
    fogDensity: 0.00016,
    envI: 0.6,
    bloom: 0.55,
    bloomThreshold: 0.92,
    zenith: [0.16, 0.36, 0.78],
    horizon: [0.66, 0.78, 0.92],
    glow: [0.75, 0.82, 0.92],
    sunCol: [1.0, 0.92, 0.78],
    disc: 40,
    cloud: 0.5,
    cloudLit: [1.05, 1.04, 1.0],
    cloudShade: [0.62, 0.66, 0.74],
    stars: 0,
  },
  // the sun just over the orange end: gold light, a pink and violet sky, the floodlights coming on
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    day: 0.55,
    floods: true,
    keyDir: n3(-0.15, 0.17, -1),
    keyCol: [1.0, 0.58, 0.3],
    keyI: 2.6,
    hemiSky: [0.55, 0.48, 0.68],
    hemiGround: [0.22, 0.18, 0.14],
    hemiI: 0.6,
    fillCol: [0.55, 0.62, 1.0],
    fillI: 0.6,
    fog: [0.62, 0.45, 0.42],
    fogDensity: 0.00036,
    envI: 0.65,
    bloom: 0.85,
    bloomThreshold: 0.85,
    zenith: [0.13, 0.15, 0.36],
    horizon: [1.0, 0.55, 0.32],
    glow: [1.0, 0.42, 0.22],
    sunCol: [1.0, 0.55, 0.25],
    disc: 26,
    cloud: 0.48,
    cloudLit: [1.25, 0.62, 0.42],
    cloudShade: [0.32, 0.24, 0.36],
    stars: 0.15,
  },
  // floodlit night under a deep sky
  night: {
    id: 'night',
    name: 'Night',
    day: 0,
    floods: true,
    keyDir: n3(0.25, 1, 0.35),
    keyCol: [0.95, 0.96, 1.0],
    keyI: 2.6,
    hemiSky: [0.56, 0.7, 1.0],
    hemiGround: [0.11, 0.23, 0.09],
    hemiI: 0.55,
    fillCol: [1.0, 0.88, 0.77],
    fillI: 0.7,
    fog: [0.04, 0.07, 0.16],
    fogDensity: 0.0009,
    envI: 0.75,
    bloom: 1.15,
    bloomThreshold: 0.78,
    zenith: [0.008, 0.014, 0.045],
    horizon: [0.07, 0.11, 0.24],
    glow: [0.25, 0.22, 0.35],
    sunCol: [0, 0, 0],
    disc: 0,
    cloud: 0.25,
    cloudLit: [0.1, 0.11, 0.16],
    cloudShade: [0.03, 0.035, 0.06],
    stars: 1,
  },
};

export const MAPS: Record<MapId, MapLook> = {
  apex: {
    id: 'apex',
    name: 'Apex Stadium',
    blurb: 'The home bowl: two tiers under a canopy',
    roof: true,
    tiers: 2,
    lights: 'ring',
    surround: 'none',
    grass: [1, 1, 1],
    snow: 0,
    concourse: 0x2a2e36,
  },
  alpine: {
    id: 'alpine',
    name: 'Frostpeak',
    blurb: 'Open to the sky, snow peaks all round',
    roof: false,
    tiers: 2,
    lights: 'masts',
    surround: 'mountains',
    grass: [0.92, 1.0, 1.02],
    snow: 1,
    concourse: 0x8a9098,
  },
  harbor: {
    id: 'harbor',
    name: 'Neon Harbor',
    blurb: 'Downtown towers over the roof line',
    roof: true,
    tiers: 2,
    lights: 'ring',
    surround: 'city',
    grass: [0.95, 0.98, 1.0],
    snow: 0,
    concourse: 0x24262c,
  },
  meadow: {
    id: 'meadow',
    name: 'Greenvale Park',
    blurb: 'One low bank of seats, hills and woods beyond',
    roof: false,
    tiers: 1,
    lights: 'masts',
    surround: 'hills',
    grass: [1.04, 1.06, 0.92],
    snow: 0,
    concourse: 0x3a3d33,
  },
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const TIME_IDS = Object.keys(TIMES) as TimeId[];
export const asMap = (v: unknown): MapId => (MAP_IDS.includes(v as MapId) ? (v as MapId) : 'apex');
export const asTime = (v: unknown): TimeId => (TIME_IDS.includes(v as TimeId) ? (v as TimeId) : 'day');
