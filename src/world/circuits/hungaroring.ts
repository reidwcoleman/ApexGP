import type { CircuitDef } from '../CircuitGen.ts';
import { HUNGARORING_LINE } from './hungaroringLine.ts';

const LAP = 4376.9;

/**
 * Hungaroring, Mogyoród — the Hungarian Grand Prix, 18 km north-east of Budapest. 4.381 km,
 * clockwise, 14 turns in a valley bowl among rolling hills: ~35 m between the bottom of the
 * valley (Turn 2) and the top of the hill (the Turn 6/7 chicane). The real centreline (see
 * hungaroringLine.ts); s = 0 is on the short run from Turn 13 to Turn 14, so the pit lane
 * (along the main straight, right side) never wraps.
 *
 * Lap, in s:
 *     70–300  T14 (the long right onto the pit straight), pits on the right 360–1010
 *    680  start/finish line, the straight running downhill to
 *   1090  T1  (the downhill right hairpin), the long curving drop to
 *   1600  T2  (the left hairpin at the bottom of the valley) · 1800 T3 (the right)
 *   2280  T4  (the blind, uphill fast left over the crest)
 *   2530  T5  (the long right at the top of the hill)
 *   2840  T6/T7 the chicane (the highest point) · 3060 T8 · 3190 T9 (the left-right S)
 *   3395  T10 (fast left kink) · 3585 T11 (the fast downhill right)
 *   3995  T12 (the heavy stop at the end of the back straight) · 4260 T13 (left hairpin)
 */
export const HUNGARORING: CircuitDef = {
  id: 'hungaroring',
  name: 'Hungaroring',
  short: 'Hungaroring',
  country: 'HUN',
  centerline: { points: HUNGARORING_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 14', at: 150, dir: -1, runoff: 'asphalt', runoffDepth: 34, span: [70, 300], wideExit: true, brake: 0.4, brakeLen: 60 },
    { name: 'Turn 1', at: 1090, dir: -1, runoff: 'asphalt', runoffDepth: 62, front: 'tecpro', boards: true, wideExit: true, brake: 1, brakeLen: 140 },
    { name: 'Turn 2', at: 1600, dir: 1, runoff: 'gravel', runoffDepth: 44, front: 'tyres', boards: true, brake: 0.75, brakeLen: 100 },
    { name: 'Turn 3', at: 1800, dir: -1, runoff: 'asphalt', runoffDepth: 30, brake: 0.35, brakeLen: 50 },
    { name: 'Turn 4', at: 2280, dir: 1, runoff: 'gravel', runoffDepth: 36, front: 'tyres' },
    { name: 'Turn 5', at: 2530, dir: -1, runoff: 'gravel', runoffDepth: 40, span: [2445, 2700], front: 'tyres', brake: 0.6, brakeLen: 80 },
    { name: 'Turn 6', at: 2840, dir: -1, runoff: 'asphalt', runoffDepth: 30, chicane: true, front: 'tecpro', boards: true, brake: 0.85, brakeLen: 110 },
    { name: 'Turn 7', at: 2890, dir: 1, runoff: 'grass', runoffDepth: 22, chicane: true },
    { name: 'Turn 8', at: 3060, dir: 1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Turn 9', at: 3190, dir: -1, runoff: 'gravel', runoffDepth: 34, front: 'tyres', brake: 0.4, brakeLen: 60 },
    { name: 'Turn 10', at: 3395, dir: 1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Turn 11', at: 3585, dir: -1, runoff: 'gravel', runoffDepth: 42, front: 'tyres', wideExit: true },
    { name: 'Turn 12', at: 3995, dir: -1, runoff: 'asphalt', runoffDepth: 44, front: 'tecpro', boards: true, wideExit: true, brake: 0.9, brakeLen: 120 },
    { name: 'Turn 13', at: 4260, dir: 1, runoff: 'gravel', runoffDepth: 34, front: 'tyres', brake: 0.6, brakeLen: 80 },
  ],
  halfWidth: 5.6,
  // the pit straight is ~13 m wide and fans out into the Turn 1 braking zone
  widen: [
    { from: 300, to: 1040, extra: 0.7 },
    { from: 1030, to: 1130, extra: 1.8 },
  ],
  // armco and debris fence round the hills, tyre walls in the gravel, TecPro at the heavy
  // stops; the concrete grandstand wall with its tall fence down the pit straight (the Super
  // Gold and Gold stands) and round Turn 1; red-and-white kerbs, blue-and-white run-off paint
  trackside: {
    barrier: 'armco',
    fence: 1,
    art: 'ads',
    runoffPaint: 'bands',
    kerb: ['#d0202a', '#efefeb'],
    armcoBoards: true,
    runs: [
      { from: 300, to: 1040, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 1040, to: 1200, side: -1, fence: 2 },
    ],
  },
  startOffset: 680,
  // the valley bowl: down the pit straight to Turn 1 and on down the long curve to Turn 2 at
  // the bottom of the valley, up the back straight over the Turn 4 crest to the top of the
  // hill (Turn 5 and the chicane), then falling away through the S, T10 and the fast downhill
  // Turn 11 to Turn 12, and level round T13/T14 back on to the straight
  elevation: (
    [
      [0, 14], [150, 15], [300, 15.5], [500, 14.2], [680, 12], [850, 9], [1000, 5.5], [1090, 3.6],
      [1220, 2.2], [1340, 1.2], [1600, 0], [1800, 1.4], [2000, 5.6], [2150, 11.5], [2280, 19.5],
      [2400, 25], [2530, 29], [2700, 33], [2860, 35], [2960, 34.6], [3060, 33.4], [3190, 31],
      [3395, 27], [3585, 22.5], [3800, 17.2], [3995, 13.6], [4150, 13], [4260, 13.1],
    ] as [number, number][]
  ).map(([s, h]) => [s / LAP, h]),
  pitSide: 1,
  // (the infield behind the pits is hemmed in by T13/T14 and the T1–T2 run: a shallower paddock)
  pit: { start: 360, end: 1010, building: [450, 930], paddock: 78 },
  sectors: [0.37, 0.68],
  drs: [
    { detect: 4080, start: 330, end: 1010 },
    { detect: 960, start: 1170, end: 1480 },
  ],
};
