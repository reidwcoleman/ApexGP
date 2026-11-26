import type { CircuitDef } from '../CircuitGen.ts';
import { ZANDVOORT_LINE } from './zandvoortLine.ts';

/**
 * Circuit Zandvoort — the Dutch Grand Prix, in the dunes behind the North Sea beach.
 * 4.26 km (4.32 on the survey), clockwise, 14 turns, ~14 m of dune elevation and two
 * steeply banked corners. s = 0 is between Kumhobocht and the banked final corner, so
 * the pit lane (along the main straight) never wraps.
 *
 * Lap, in s:
 *     55–300  T14 Arie Luyendijkbocht (banked 18°, DRS open through it)
 *    635  start/finish line, pits on the left 420–850
 *   1045  T1 Tarzanbocht (the big right hairpin at the end of the straight)
 *   1365  T2 Gerlachbocht · 1535 T3 Hugenholtzbocht (banked 19°, the bowl)
 *   1805  T4 Hunserug (up the dune) · 1975 T5 Rob Slotemakerbocht (blind crest)
 *   2135  T6 · 2415 T7 Scheivlak (fast, downhill, blind)
 *   2740  T8 Mastersbocht · 2865 T9 · 2975 T10 · 3235 T11
 *   3820  T12/T13 Hans Ernstbocht (chicane) · 4235 Kumhobocht
 */
export const ZANDVOORT: CircuitDef = {
  id: 'zandvoort',
  name: 'Circuit Zandvoort',
  short: 'Zandvoort',
  country: 'NED',
  centerline: { points: ZANDVOORT_LINE, smooth: 3 },
  corners: [
    { name: 'Arie Luyendijkbocht', at: 170, dir: -1, runoff: 'asphalt', runoffDepth: 16, span: [55, 305] },
    { name: 'Tarzanbocht', at: 1045, dir: -1, runoff: 'gravel', runoffDepth: 46, front: 'tyres', brake: 1, brakeLen: 140, boards: true },
    { name: 'Gerlachbocht', at: 1365, dir: -1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Hugenholtzbocht', at: 1535, dir: 1, runoff: 'asphalt', runoffDepth: 17, front: 'tecpro', brake: 0.6, brakeLen: 70 },
    { name: 'Hunserug', at: 1805, dir: -1, runoff: 'grass', runoffDepth: 26 },
    { name: 'Rob Slotemakerbocht', at: 1975, dir: 1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Turn 6', at: 2135, dir: -1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Scheivlak', at: 2415, dir: -1, runoff: 'gravel', runoffDepth: 40, span: [2300, 2525] },
    { name: 'Mastersbocht', at: 2740, dir: -1, runoff: 'gravel', runoffDepth: 40, brake: 0.7, brakeLen: 90, boards: true },
    { name: 'Turn 9', at: 2865, dir: -1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Turn 10', at: 2975, dir: -1, runoff: 'gravel', runoffDepth: 34 },
    { name: 'Turn 11', at: 3235, dir: 1, runoff: 'gravel', runoffDepth: 32, brake: 0.55, brakeLen: 70 },
    { name: 'Hans Ernstbocht', at: 3820, dir: -1, runoff: 'gravel', runoffDepth: 34, front: 'tecpro', chicane: true, brake: 0.9, brakeLen: 120, boards: true },
    { name: 'Turn 13', at: 3895, dir: 1, runoff: 'asphalt', runoffDepth: 28, chicane: true, wideExit: true },
    { name: 'Kumhobocht', at: 4235, dir: -1, runoff: 'gravel', runoffDepth: 34, brake: 0.6, brakeLen: 80 },
  ],
  // armco and tyre walls in the dunes, concrete walls with tall fences in front of the big stands
  // (the Hoofdtribune, both banked corners, Tarzan and the Arena), red-and-white kerbs
  trackside: {
    barrier: 'armco',
    fence: 1,
    art: 'ads',
    runoffPaint: 'bands',
    kerb: ['#d0211c', '#efefea'],
    armcoBoards: true,
    runs: [
      { from: 430, to: 990, side: 1, kind: 'concrete', fence: 2 },
      { from: 0, to: 330, side: -1, kind: 'concrete', fence: 2 },
      { from: 1440, to: 1650, side: 1, kind: 'concrete', fence: 2 },
      { from: 930, to: 1120, side: -1, fence: 2 },
      { from: 3640, to: 3830, side: -1, fence: 2 },
      { from: 4090, to: 4300, side: -1, fence: 2 },
    ],
  },
  halfWidth: 6.0,
  startOffset: 635,
  // the dunes: down the straight to Tarzan, the Hugenholtz bowl, up the Hunserug to the blind
  // crest at Slotemaker (the highest point), down through Scheivlak to Mastersbocht (the lowest),
  // then a slow climb along the back of the circuit to Kumho and the banking
  elevation: [
    [0.0, 6.5],
    [0.039, 5.5],
    [0.074, 4.6],
    [0.147, 3.4],
    [0.209, 2.2],
    [0.242, 1.4],
    [0.278, 1.8],
    [0.316, 3],
    [0.356, 2.2],
    [0.385, 4.2],
    [0.418, 9],
    [0.447, 13.5],
    [0.461, 14.6],
    [0.487, 12.6],
    [0.51, 9.8],
    [0.56, 5],
    [0.602, 2.2],
    [0.635, 0.8],
    [0.664, 1.2],
    [0.689, 2],
    [0.75, 3],
    [0.811, 4.2],
    [0.885, 5.2],
    [0.938, 6.3],
    [0.981, 7],
  ],
  // (the real pit building stands east of the straight; here the Hugenholtz loop comes within
  // ~30 m of the straight's east side, too close for the paddock module, so the pits and the
  // paddock sit on the west side between the straight and the foredune)
  pitSide: -1,
  pit: { start: 420, end: 850 },
  sectors: [0.3, 0.64],
  drs: [
    { detect: 4180, start: 60, end: 990 },
    { detect: 2900, start: 3290, end: 3760 },
  ],
  banking: [
    { start: 1485, end: 1595, deg: 19, ramp: 45 },
    { start: 40, end: 235, deg: 18, ramp: 50 },
  ],
};
