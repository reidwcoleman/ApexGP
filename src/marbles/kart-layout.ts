import type { TrackPoint } from './kart-track.ts';

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
  { x: -148, z: -76, y: 0.8, hw: 6.8, l: 6, r: 5 },
  { x: -158, z: -92, y: 0.6, hw: 7, l: 8, r: 3 },
  { x: -152, z: -107.5, y: 0.4, hw: 7.2, l: 9, r: 2 },
  { x: -136, z: -114, y: 0.2, hw: 7.5, l: 9, r: 3 },
  { x: -112, z: -113, y: 0.1, hw: 7.5, l: 6, r: 8, bank: 0 },
];

/** (laid out on paper a little big: this is the size that makes two laps about a minute and a half) */
export const BEAN_BAY: TrackPoint[] = RAW.map((p) => ({ ...p, x: p.x * 0.92, z: p.z * 0.92 }));
