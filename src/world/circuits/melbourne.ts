import type { CircuitDef } from '../CircuitGen.ts';
import { MELBOURNE_LINE } from './melbourneLine.ts';

/** lap length of the resampled centreline (m): elevation keys below are written in s */
const LAP = 5246;

/**
 * Albert Park, Melbourne — 5.28 km, clockwise, 14 turns (the 2022+ layout: the old slow
 * Turn 9/10 chicane is gone, a flat-out sweep in its place). Public park roads round Albert
 * Park Lake, 3 km south of the city: concrete walls and debris fences close to the road, gravel
 * traps at the slow corners, the lake inside the lap. s = 0 is on the run from Turn 12 to
 * Turn 13, so the pit lane never wraps. The lap runs up the west side of the lake and back
 * down the east side.
 *
 * Lap, in s:
 *     88  T13 (left) · 240 T14 (right) onto the start/finish straight, pits on the right 330–1000
 *    699  start/finish line: the main grandstand on the left, the pit building and paddock on the
 *         right between the track and the lake
 *   1078  T1 Jones (right) · 1180 T2 Brabham (left) · 1300–1760 the run to
 *   1805  T3 Sports Centre, the heavy stop by the aquatic centre · 1950 T4 Whiteford · 2168 T5
 *   2200–2560 Lakeside Drive · 2590 T6 Marina (right) · 2680 T7 Lauda (left)
 *   2870  T8, the long flat-out right · 3050–3950 the back straight along the lake (DRS)
 *   4015  T9/T10 the fast left-right · 4200–4760 (DRS) to
 *   4825  T11 (right, Ascari) · 5085 T12 Stewart (right)
 */
export const MELBOURNE: CircuitDef = {
  id: 'melbourne',
  name: 'Albert Park Circuit',
  short: 'Melbourne',
  country: 'AUS',
  centerline: { points: MELBOURNE_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 13', at: 88, dir: 1, runoff: 'gravel', runoffDepth: 22, span: [55, 125], front: 'tyres', brake: 0.7, brakeLen: 90, boards: true },
    { name: 'Prost', at: 240, dir: -1, runoff: 'asphalt', runoffDepth: 16, span: [180, 310], front: 'tecpro', wideExit: true },
    { name: 'Jones', at: 1078, dir: -1, runoff: 'gravel', runoffDepth: 34, span: [1050, 1105], front: 'tecpro', brake: 1, brakeLen: 150, boards: true },
    { name: 'Brabham', at: 1180, dir: 1, runoff: 'gravel', runoffDepth: 28, span: [1110, 1265], front: 'tyres', wideExit: true },
    { name: 'Sports Centre', at: 1805, dir: -1, runoff: 'gravel', runoffDepth: 36, span: [1775, 1840], front: 'tecpro', brake: 1, brakeLen: 150, boards: true },
    { name: 'Whiteford', at: 1950, dir: 1, runoff: 'asphalt', runoffDepth: 14, span: [1915, 1985], front: 'tyres', wideExit: true },
    { name: 'Albert Road', at: 2168, dir: -1, runoff: 'grass', runoffDepth: 14, span: [2140, 2195], front: 'tyres' },
    { name: 'Marina', at: 2590, dir: -1, runoff: 'gravel', runoffDepth: 30, span: [2565, 2615], front: 'tecpro', brake: 0.8, brakeLen: 110, boards: true },
    { name: 'Lauda', at: 2680, dir: 1, runoff: 'gravel', runoffDepth: 22, span: [2618, 2725], front: 'tyres', wideExit: true },
    { name: 'Turn 8', at: 2870, dir: -1, runoff: 'grass', runoffDepth: 16, span: [2735, 3010], front: 'none' },
    { name: 'Turn 9', at: 4015, dir: 1, runoff: 'gravel', runoffDepth: 30, span: [3985, 4050], front: 'tecpro', brake: 0.6, brakeLen: 90, boards: true },
    { name: 'Turn 10', at: 4145, dir: -1, runoff: 'gravel', runoffDepth: 24, span: [4120, 4170], front: 'tyres', wideExit: true },
    { name: 'Ascari', at: 4825, dir: -1, runoff: 'gravel', runoffDepth: 30, span: [4800, 4850], front: 'tecpro', brake: 0.9, brakeLen: 130, boards: true },
    { name: 'Stewart', at: 5085, dir: -1, runoff: 'gravel', runoffDepth: 26, span: [5030, 5140], front: 'tyres', wideExit: true },
  ],
  halfWidth: 6.3,
  // Marina (T6) was widened for 2022, and the run out of T10 opens up
  widen: [
    { from: 2560, to: 2680, extra: 1.2 },
    { from: 4180, to: 4360, extra: 1.4 },
  ],
  // park roads: concrete blocks topped with debris fences, red-and-white kerbs, the main
  // grandstand and the pit wall walls along the straight
  trackside: {
    barrier: 'concrete',
    fence: 1,
    art: 'ads',
    runoffPaint: 'plain',
    kerb: ['#d42a22', '#eeeeea'],
    runs: [
      // grandstand walls: tall fences in front of the stands
      { from: 330, to: 1040, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 1110, to: 1300, side: -1, kind: 'concrete', fence: 2 },
      { from: 1760, to: 1860, side: 1, kind: 'concrete', fence: 2 },
      { from: 4790, to: 4880, side: 1, kind: 'concrete', fence: 2 },
      { from: 4950, to: 5200, side: 1, kind: 'concrete', fence: 2, art: 'ads' },
    ],
    lights: [{ from: 380, to: 1000, side: -1, spacing: 60 }],
  },
  startOffset: 699,
  // flat parkland at the lake's edge: two or three metres of rise and fall round the lap
  elevation: (
    [
      [0, 3.2], [240, 3.0], [699, 2.4], [1078, 2.0], [1500, 2.6], [1805, 3.4], [2168, 3.0], [2590, 1.6],
      [2870, 1.2], [3400, 1.0], [4015, 1.6], [4400, 2.4], [4825, 3.4], [5085, 3.6],
    ] as [number, number][]
  ).map(([s, h]) => [s / LAP, h]),
  pitSide: 1,
  pit: { start: 330, end: 1000 },
  sectors: [0.33, 0.69],
  drs: [
    { detect: 150, start: 400, end: 1020 },
    { detect: 1090, start: 1300, end: 1740 },
    { detect: 2900, start: 3060, end: 3940 },
    { detect: 4170, start: 4210, end: 4760 },
  ],
  // concrete walls a little further back than a true street circuit
  walls: { straight: 5.5, inside: 4.2, wobble: 0.4 },
};
