import type { CircuitDef } from '../CircuitGen.ts';
import { AUSTIN_LINE } from './austinLine.ts';

/** lap length of the resampled centreline (m): elevation keys below are written in s */
const LAP = 5508;

/**
 * Circuit of the Americas, Austin — 5.51 km, anticlockwise, 20 turns, 41 m of
 * elevation. The real centreline (see circuits/austinLine.ts); s = 0 is on the
 * short run from Turn 19 to Turn 20, so the pit lane never wraps.
 *
 * Lap, in s:
 *    184  T20 onto the main straight; pits on the left (the paddock is in the infield) 250–870
 *    577  start/finish line, then the steep climb (≈11 %) to
 *    996  T1  the hairpin left on the crest, the famous wide braking zone
 *   1190  T2 (downhill right) · T3–T6 the esses 1495–1940 · T7 2053 · T8/T9 2199–2306
 *   2515  T10 (blind fast left on a crest) · 2923 T11 hairpin
 *   2960–4050  the back straight (DRS), down to
 *   4111  T12 · T13/T14 4349/4441 · T15 4626: the stadium section under the Tower
 *   4850–5160  T16–T18 the triple-apex right · 5378 T19
 */
export const AUSTIN: CircuitDef = {
  id: 'austin',
  name: 'Circuit of the Americas',
  short: 'Austin',
  country: 'USA',
  centerline: { points: AUSTIN_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 20', at: 184, dir: 1, runoff: 'asphalt', runoffDepth: 34, span: [120, 250] },
    { name: 'Turn 1', at: 996, dir: 1, runoff: 'asphalt', runoffDepth: 62, span: [890, 1070] },
    { name: 'Turn 2', at: 1190, dir: -1, runoff: 'asphalt', runoffDepth: 46, span: [1120, 1320] },
    { name: 'Turn 3', at: 1495, dir: 1, runoff: 'gravel', runoffDepth: 34 },
    { name: 'Turn 4', at: 1600, dir: -1, runoff: 'gravel', runoffDepth: 34 },
    { name: 'Turn 5', at: 1693, dir: 1, runoff: 'gravel', runoffDepth: 32 },
    { name: 'Turn 6', at: 1776, dir: -1, runoff: 'gravel', runoffDepth: 40, span: [1730, 1950] },
    { name: 'Turn 7', at: 2053, dir: 1, runoff: 'asphalt', runoffDepth: 36 },
    { name: 'Turn 8', at: 2199, dir: -1, runoff: 'asphalt', runoffDepth: 32, span: [2165, 2270] },
    { name: 'Turn 9', at: 2306, dir: 1, runoff: 'asphalt', runoffDepth: 34 },
    { name: 'Turn 10', at: 2515, dir: 1, runoff: 'grass', runoffDepth: 36 },
    { name: 'Turn 11', at: 2923, dir: 1, runoff: 'asphalt', runoffDepth: 56 },
    { name: 'Turn 12', at: 4111, dir: 1, runoff: 'asphalt', runoffDepth: 60 },
    { name: 'Turn 13', at: 4349, dir: -1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Turn 14', at: 4441, dir: -1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Turn 15', at: 4626, dir: 1, runoff: 'asphalt', runoffDepth: 38, span: [4480, 4665] },
    { name: 'Turn 16', at: 4850, dir: -1, runoff: 'asphalt', runoffDepth: 36 },
    { name: 'Turn 17', at: 4940, dir: -1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Turn 18', at: 5085, dir: -1, runoff: 'asphalt', runoffDepth: 44, span: [5010, 5170] },
    { name: 'Turn 19', at: 5378, dir: 1, runoff: 'asphalt', runoffDepth: 40 },
  ],
  halfWidth: 7.2,
  // the run to Turn 1 fans out to ~24 m, the braking zones of T11 and T12 are wide too
  widen: [
    { from: 912, to: 1075, extra: 3.6 },
    { from: 2840, to: 2950, extra: 2.0 },
    { from: 4020, to: 4130, extra: 1.6 },
  ],
  // big painted asphalt run-offs in red/white/blue-ish stripes, armco with boards,
  // tall debris fences at the Turn 1 hill and along the main straight (the grandstands)
  trackside: {
    barrier: 'armco',
    fence: 1,
    runoffPaint: 'stripes',
    kerb: ['#c8261e', '#ecece8'],
    armcoBoards: true,
    runs: [
      { from: 300, to: 900, side: 1, kind: 'concrete', fence: 2 },
      { from: 850, to: 1150, fence: 2 },
    ],
    lights: [{ from: 350, to: 880, side: 1, spacing: 80 }],
  },
  startOffset: 577,
  // The start/finish straight in the valley, the 11 % climb to Turn 1 on the crest (the
  // highest point), down through the esses to T7, up again through T8/T9 to the T10 crest,
  // T11 and the long gentle descent of the back straight to T12, the lowest point: the
  // stadium section is nearly flat, the T16–T18 right climbs a little, T19–T20 level.
  elevation: (
    [
      [0, 7], [184, 6.2], [360, 6.4], [577, 8], [700, 13.5], [800, 22.5], [900, 32.5], [960, 38.6], [1010, 40.6], [1070, 40.2],
      [1190, 35.5], [1310, 30.5], [1495, 26], [1693, 22], [1840, 19.5], [2053, 16], [2200, 16.8], [2306, 19], [2515, 22],
      [2700, 19.5], [2923, 16], [3150, 13.5], [3450, 11], [3750, 6.5], [4000, 2.4], [4111, 1.2], [4349, 0.4], [4441, 0.6],
      [4626, 1.6], [4850, 3], [4940, 4], [5085, 5.6], [5250, 6.6], [5378, 7.2],
    ] as [number, number][]
  ).map(([s, h]) => [s / LAP, h]),
  pitSide: -1,
  pit: { start: 250, end: 870 },
  sectors: [0.333, 0.745],
  drs: [
    { detect: 2860, start: 3010, end: 3990 },
    { detect: 5330, start: 280, end: 860 },
  ],
};
