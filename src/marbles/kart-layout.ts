import type { Pad, TrackPoint } from './kart-track.ts';

/**
 * Bean Bay Circuit, a figure of eight. The start straight, a tight hairpin, the esses down past the
 * funfair and under the bridge, round the far end, the Big Bowl (banked hard, flat out), up the hill
 * and over the Hump on the bridge (at speed you take off), into the Light Tunnel and the Kink, and
 * back onto the straight.
 */
const RAW: TrackPoint[] = [
  { x: -60, z: -112, y: 0, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: 20, z: -112, y: 0, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: 72, z: -112, y: -0.6, hw: 7.5, l: 12, r: 4 },
  // the hairpin: a true half circle, radius 24 (22 once it's scaled)
  { x: 98, z: -112, y: -1, hw: 7.5, l: 15, r: 1.5 },
  { x: 110, z: -108.8, y: -1, hw: 7.6, l: 16, r: 1.2 },
  { x: 118.8, z: -100, y: -1, hw: 7.8, l: 16, r: 1.2 },
  { x: 122, z: -88, y: -1, hw: 8, l: 16, r: 1.2 },
  { x: 118.8, z: -76, y: -1, hw: 7.8, l: 16, r: 1.2 },
  { x: 110, z: -67.2, y: -0.9, hw: 7.6, l: 15, r: 1.2 },
  { x: 98, z: -64, y: -0.6, hw: 7.5, l: 12, r: 1.5 },
  { x: 74, z: -64, y: 0.6, hw: 6.8, l: 7, r: 6 },
  // the esses
  { x: 46, z: -70, y: 2.2, hw: 6.2, l: 5, r: 5 },
  { x: 18, z: -62, y: 3.4, hw: 6.2, l: 5, r: 5 },
  { x: 10, z: -40, y: 3.9, hw: 6.2, l: 5, r: 5 },
  { x: 32, z: -20, y: 3.8, hw: 6.2, l: 5, r: 5 },
  { x: 30, z: 2, y: 3.0, hw: 6.2, l: 5, r: 5 },
  { x: 8, z: 14, y: 1.6, hw: 6.2, l: 4, r: 4 },
  // under the bridge
  { x: 3, z: 34, y: 0.3, hw: 6.2, l: 2, r: 2 },
  { x: 4, z: 58, y: -0.4, hw: 6.2, l: 3, r: 3 },
  // the funfair corners
  { x: 6, z: 86, y: -0.2, hw: 6.5, l: 6, r: 6 },
  { x: 18, z: 112, y: 0.4, hw: 6.8, l: 6, r: 6 },
  { x: 46, z: 122, y: 1, hw: 6.6, l: 6, r: 6 },
  { x: 66, z: 108, y: 1.6, hw: 6.6, l: 5, r: 5 },
  { x: 88, z: 112, y: 2, hw: 7, l: 5, r: 5 },
  // the Big Bowl
  { x: 122, z: 124, y: 2.8, hw: 8.5, bank: 12, l: 6, r: 3 },
  { x: 152, z: 96, y: 3.4, hw: 8.5, bank: 22, l: 6, r: 2 },
  { x: 156, z: 58, y: 4, hw: 8.5, bank: 22, l: 6, r: 2 },
  { x: 128, z: 30, y: 4.8, hw: 8, bank: 10, l: 7, r: 4 },
  // the climb to the Hump
  { x: 84, z: 32, y: 6.4, hw: 7, l: 5, r: 5, bank: 0 },
  { x: 46, z: 38, y: 8, hw: 6.5, l: 2, r: 2, up: true, bank: 0 },
  { x: 14, z: 42, y: 9.5, hw: 6.5, l: 1, r: 1, up: true, bank: 0 },
  { x: -6, z: 43, y: 10.2, hw: 6.5, l: 1, r: 1, up: true, bank: 0 },
  { x: -18, z: 43, y: 8.7, hw: 6.5, l: 1, r: 1, up: true, bank: 0 },
  { x: -36, z: 42, y: 4.6, hw: 6.5, l: 2, r: 2, up: true, bank: 0 },
  { x: -60, z: 38, y: 2.4, hw: 7, l: 6, r: 6 },
  { x: -84, z: 32, y: 1.6, hw: 7, l: 5, r: 6 },
  // the Light Tunnel: a long left-hander you can't see the end of
  { x: -110, z: 18, y: 1.2, hw: 6.8, l: 1, r: 1, tunnel: true },
  { x: -138, z: -10, y: 1, hw: 6.5, l: 1, r: 1, tunnel: true },
  { x: -150, z: -44, y: 1, hw: 6.5, l: 1, r: 1, tunnel: true },
  { x: -147, z: -64, y: 0.9, hw: 6.6, l: 1, r: 1, tunnel: true },
  // the Kink, and home
  { x: -148, z: -76, y: 0.8, hw: 6.8, l: 6, r: 5, bank: 0 },
  { x: -158, z: -92, y: 0.6, hw: 7, l: 8, r: 3, bank: 0 },
  { x: -152, z: -107.5, y: 0.4, hw: 7.2, l: 9, r: 2, bank: 0 },
  { x: -136, z: -114, y: 0.2, hw: 7.5, l: 9, r: 3, bank: 0 },
  { x: -112, z: -113, y: 0.1, hw: 7.5, l: 6, r: 8, bank: 0 },
  // the Kicker: a crest in front of the stands, so every lap ends in the air
  { x: -95, z: -112.6, y: 0.2, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: -84, z: -112.4, y: 1, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: -76, z: -112.3, y: 2.1, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: -69, z: -112.2, y: 0.9, hw: 7.5, l: 6, r: 8, bank: 0 },
];

/** (laid out on paper a little big: this is the size that makes two laps about a minute and a half) */
export const BEAN_BAY: TrackPoint[] = RAW.map((p) => ({ ...p, x: p.x * 0.92, z: p.z * 0.92 }));

/** the boost pads: the exit of the hairpin, under the bridge, high on the Bowl, the run up to the Hump, the tunnel's inside, onto the Kicker */
export const BEAN_PADS: Pad[] = [
  { s: 216, len: 7, lat: -2.4, w: 1.7 },
  { s: 420, len: 7, lat: 2.6, w: 1.7 },
  { s: 636, len: 7, lat: -4.6, w: 1.8 },
  { s: 752, len: 7, lat: 0, w: 1.7 },
  { s: 936, len: 7, lat: -2.8, w: 1.6 },
  { s: 1092, len: 7, lat: 2.2, w: 1.7 },
];

/** a spot on a circuit given on the map (it's found on the ribbon once that's built) or by its distance round */
export type Where = number | [number, number];
/** everything that makes one circuit that circuit */
export interface KartLayout {
  id: string;
  /** over the gantry, and the first hoarding */
  sign: string;
  tag: string;
  points: TrackPoint[];
  /** the boost pads: where, how far off the middle, how wide */
  pads: { at: Where; lat: number; w: number }[];
  /** the arches over the road: where, what they say, the board's colours and the legs' */
  arches: [Where, string, string, string, number][];
  /** the funfair and the lighthouse (map) */
  fair: [number, number];
  light: [number, number];
}

export const BEAN_BAY_GP: KartLayout = {
  id: 'beanbaygp',
  sign: 'BEAN BAY GP',
  tag: 'Two laps. No mercy.',
  points: BEAN_BAY,
  pads: BEAN_PADS.map((p) => ({ at: p.s, lat: p.lat, w: p.w })),
  arches: [
    [1116, 'BIG AIR!', '#ffc21f', '#17182a', 0xff4f8f],
    [806, 'THE HUMP', '#e6332f', '#ffffff', 0xffc21f],
    [566, 'BIG BOWL', '#22c08a', '#10242a', 0x2f6ad8],
    [136, 'DRIFT ZONE', '#ff4f8f', '#ffffff', 0x2fb8ff],
  ],
  fair: [76, 70],
  light: [-250, -170],
};

/**
 * Sundae Speedway: quicker and more open than Bean Bay. Off the line into the Scoop (a banked half
 * circle you can take flat), a kink onto the run to the Cherry (a crest that throws you in the
 * air), the long Swirl, the Candy Tunnel, the Sprinkles (esses, the one place to brake) and the
 * Cone, a tight hairpin back onto the straight.
 */
const SUNDAE_RAW: TrackPoint[] = [
  // the start straight
  { x: -100, z: -100, y: 0, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: -40, z: -100, y: 0, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: 30, z: -100, y: 0, hw: 7.5, l: 6, r: 8, bank: 0 },
  { x: 58, z: -100, y: 0.2, hw: 8, l: 6, r: 4, bank: 0 },
  // the Scoop: a banked half circle, climbing
  { x: 82.5, z: -94, y: 0.6, hw: 8.5, bank: -12, l: 6, r: 3 },
  { x: 99, z: -77.5, y: 1.2, hw: 8.5, bank: -20, l: 6, r: 2 },
  { x: 105, z: -55, y: 1.8, hw: 8.5, bank: -22, l: 6, r: 2 },
  { x: 99, z: -32.5, y: 2.4, hw: 8.5, bank: -20, l: 6, r: 2 },
  { x: 82.5, z: -16, y: 2.9, hw: 8.5, bank: -12, l: 6, r: 3 },
  { x: 60, z: -10, y: 3.1, hw: 7.5, l: 6, r: 6, bank: 0 },
  // the back straight, and the kink
  { x: 34, z: -10, y: 3, hw: 7, l: 6, r: 6, bank: 0 },
  { x: 16, z: -5, y: 2.8, hw: 6.8, l: 5, r: 5 },
  { x: 10, z: 10, y: 2.6, hw: 6.8, l: 5, r: 5 },
  // the Cherry: a crest you leave the ground over
  { x: 10, z: 22, y: 2.8, hw: 6.8, l: 6, r: 6, bank: 0 },
  { x: 10, z: 31, y: 3.9, hw: 6.8, l: 6, r: 6, bank: 0 },
  { x: 10, z: 38, y: 4.9, hw: 6.8, l: 6, r: 6, bank: 0 },
  { x: 10, z: 45, y: 3.4, hw: 6.8, l: 6, r: 6, bank: 0 },
  { x: 10, z: 58, y: 1.4, hw: 7, l: 7, r: 7, bank: 0 },
  // the Swirl: a long half circle
  { x: -0.3, z: 84.7, y: 1.0, hw: 7.2, l: 6, r: 6 },
  { x: -25, z: 95, y: 0.8, hw: 7.2, l: 6, r: 6 },
  { x: -49.7, z: 84.7, y: 0.6, hw: 7.2, l: 6, r: 6 },
  { x: -60, z: 60, y: 0.5, hw: 6.8, l: 3, r: 3, bank: 0 },
  // the Candy Tunnel
  { x: -60, z: 48, y: 0.4, hw: 6.6, l: 1, r: 1, tunnel: true, bank: 0 },
  { x: -60, z: 36, y: 0.3, hw: 6.6, l: 1, r: 1, tunnel: true, bank: 0 },
  { x: -60, z: 24, y: 0.3, hw: 6.6, l: 1, r: 1, tunnel: true, bank: 0 },
  // the Sprinkles: esses
  { x: -58, z: 10, y: 0.2, hw: 6.4, l: 4, r: 4 },
  { x: -48, z: -6, y: 0.2, hw: 6.2, l: 4, r: 4 },
  { x: -64, z: -24, y: 0.1, hw: 6.2, l: 4, r: 4 },
  { x: -62, z: -40, y: 0, hw: 6.4, l: 5, r: 5 },
  // round to the hairpin
  { x: -72, z: -52, y: 0, hw: 6.8, l: 6, r: 5 },
  { x: -92, z: -56, y: -0.2, hw: 7.2, l: 10, r: 3 },
  // the Cone: a tight hairpin
  { x: -110, z: -56, y: -0.4, hw: 7.5, l: 14, r: 1.5 },
  { x: -125.6, z: -62.4, y: -0.5, hw: 7.7, l: 16, r: 1.2 },
  { x: -132, z: -78, y: -0.5, hw: 7.9, l: 16, r: 1.2 },
  { x: -125.6, z: -93.6, y: -0.4, hw: 7.7, l: 16, r: 1.2 },
  { x: -112, z: -100, y: -0.2, hw: 7.5, l: 12, r: 3 },
];
const K2 = 1.25;
const at2 = (x: number, z: number): [number, number] => [x * K2, z * K2];
export const SUNDAE_SPEEDWAY: KartLayout = {
  id: 'sundaespeedway',
  sign: 'SUNDAE SPEEDWAY',
  tag: 'Two laps. Extra sprinkles.',
  points: SUNDAE_RAW.map((p) => ({ ...p, x: p.x * K2, z: p.z * K2 })),
  pads: [
    { at: at2(4, -100), lat: 2.6, w: 1.7 },
    { at: at2(105, -55), lat: 4.4, w: 1.8 },
    { at: at2(46, -10), lat: -2, w: 1.7 },
    { at: at2(10, 14), lat: 0, w: 1.7 },
    { at: at2(-25, 95), lat: 0, w: 1.7 },
    { at: at2(-60, 36), lat: 0, w: 1.6 },
  ],
  arches: [
    [at2(42, -100), 'THE SCOOP', '#22c08a', '#10242a', 0x2f6ad8],
    [at2(10, 18), 'BIG AIR!', '#ffc21f', '#17182a', 0xff4f8f],
    [at2(-59, 14), 'THE SPRINKLES', '#ff4f8f', '#ffffff', 0x2fb8ff],
    [at2(-90, -56), 'THE CONE', '#e6332f', '#ffffff', 0xffc21f],
  ],
  fair: at2(58, -55),
  light: at2(-158, 84),
};
