import type { CircuitDef } from '../CircuitGen.ts';
import { MEXICO_LINE } from './mexicoLine.ts';

/** lap length of the resampled centreline (m): elevation keys below are written in s */
const LAP = 4297;

/**
 * Autódromo Hermanos Rodríguez — the Magdalena Mixiuhca sports city, Mexico City, 2,240 m
 * up. 4.30 km, clockwise, 17 turns. The real centreline (see circuits/mexicoLine.ts); s = 0
 * is inside the Foro Sol between Turns 14 and 15, just before the pit entry, so the pit lane
 * (right of the main straight, the paddock in the infield) never wraps.
 *
 * Lap, in s:
 *     15  T15 · 95 T16: out of the stadium bowl onto
 *    110–330  T17, the remnant of the Peraltada (slightly banked) — then the 1.2 km straight
 *    690  start/finish line, pits on the right 400–1060: the longest run to Turn 1 in F1
 *   1585  T1 (right) · 1665 T2 (left) · 1725 T3 (right)
 *   1760–2340  the straight to T4 (DRS) · 2425 T4 (left) · 2495 T5 · 2640 T6 (right hairpin)
 *   2985–3465  the esses, T7–T11 · 3680–3990 the back straight (DRS)
 *   4030  T12 (right) · 4205 T13 (left), into the Foro Sol · 4265 T14 (right)
 */
export const MEXICO: CircuitDef = {
  id: 'mexico',
  name: 'Autódromo Hermanos Rodríguez',
  short: 'Mexico City',
  country: 'MEX',
  centerline: { points: MEXICO_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 15', at: 18, dir: 1, runoff: 'asphalt', runoffDepth: 10, front: 'tecpro' },
    { name: 'Turn 16', at: 92, dir: -1, runoff: 'asphalt', runoffDepth: 14, front: 'tecpro', brake: 0.4, brakeLen: 50 },
    { name: 'Peraltada', at: 215, dir: -1, runoff: 'asphalt', runoffDepth: 26, span: [125, 335], front: 'tecpro', boards: false, brake: 0 },
    { name: 'Turn 1', at: 1585, dir: -1, runoff: 'asphalt', runoffDepth: 60, front: 'tecpro', brake: 1, brakeLen: 160, boards: true },
    { name: 'Turn 2', at: 1665, dir: 1, runoff: 'asphalt', runoffDepth: 30, chicane: true },
    { name: 'Turn 3', at: 1728, dir: -1, runoff: 'asphalt', runoffDepth: 34, wideExit: true },
    { name: 'Turn 4', at: 2428, dir: 1, runoff: 'asphalt', runoffDepth: 44, front: 'tecpro', brake: 0.9, brakeLen: 130, boards: true },
    { name: 'Turn 5', at: 2495, dir: -1, runoff: 'asphalt', runoffDepth: 30, wideExit: true },
    { name: 'Turn 6', at: 2645, dir: -1, runoff: 'asphalt', runoffDepth: 36, front: 'tyres', brake: 0.7, brakeLen: 80, boards: true },
    { name: 'Turn 7', at: 2985, dir: 1, runoff: 'grass', runoffDepth: 30, brake: 0.4, brakeLen: 60 },
    { name: 'Turn 8', at: 3085, dir: -1, runoff: 'grass', runoffDepth: 28 },
    { name: 'Turn 9', at: 3180, dir: 1, runoff: 'grass', runoffDepth: 28 },
    { name: 'Turn 10', at: 3365, dir: -1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Turn 11', at: 3465, dir: 1, runoff: 'asphalt', runoffDepth: 30, wideExit: true },
    { name: 'Turn 12', at: 4030, dir: -1, runoff: 'asphalt', runoffDepth: 34, front: 'tecpro', brake: 0.95, brakeLen: 140, boards: true },
    { name: 'Turn 13', at: 4210, dir: 1, runoff: 'asphalt', runoffDepth: 14, front: 'tecpro', brake: 0.6, brakeLen: 70, boards: true },
    { name: 'Turn 14', at: 4268, dir: -1, runoff: 'asphalt', runoffDepth: 12, front: 'tecpro', chicane: true },
  ],
  halfWidth: 6.2,
  // the long main straight is wide (~14 m) and fans out into the Turn 1 braking zone; T4 too
  widen: [
    { from: 380, to: 1520, extra: 0.6 },
    { from: 1520, to: 1620, extra: 2.0 },
    { from: 2390, to: 2470, extra: 1.6 },
  ],
  // armco with sponsor boards and tyre walls round the park; concrete walls with tall
  // fences in front of the grandstands (the main straight, Turn 1, the whole stadium),
  // red-and-white kerbs, green-and-white painted run-off
  trackside: {
    barrier: 'armco',
    fence: 1,
    art: 'ads',
    runoffPaint: 'bands',
    kerb: ['#c8261e', '#ecece8'],
    armcoBoards: true,
    runs: [
      // the main straight: the long run of grandstands on the left (north)
      { from: 330, to: 1520, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      // Turn 1 – Turn 3 grandstands
      { from: 1500, to: 1760, kind: 'concrete', fence: 2 },
      // the Foro Sol: walls and tall fences all round, T12 to the Peraltada
      { from: 4150, to: 130, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 3960, to: 4150, side: -1, fence: 2 },
    ],
    lights: [{ from: 420, to: 1480, side: -1, spacing: 70 }],
  },
  startOffset: 690,
  // the old lake bed of Texcoco: dead flat, a metre or so of rise and fall round the lap
  elevation: (
    [
      [0, 0.6], [300, 0.4], [700, 0.2], [1200, 0.1], [1600, 0.3], [2000, 0.8], [2450, 1.1], [2700, 1.3],
      [3000, 1.2], [3400, 0.9], [3800, 0.8], [4100, 0.7],
    ] as [number, number][]
  ).map(([s, h]) => [s / LAP, h]),
  pitSide: 1,
  pit: { start: 400, end: 1060 },
  sectors: [0.34, 0.72],
  drs: [
    { detect: 4290, start: 420, end: 1470 },
    { detect: 1640, start: 1790, end: 2330 },
    { detect: 3420, start: 3700, end: 3960 },
  ],
  // the Peraltada remnant: a few degrees of banking
  banking: [{ start: 130, end: 320, deg: 3, ramp: 40 }],
};
