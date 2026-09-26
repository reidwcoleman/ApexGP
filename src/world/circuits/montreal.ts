import type { CircuitDef } from '../CircuitGen.ts';
import { MONTREAL_LINE } from './montrealLine.ts';

/**
 * Circuit Gilles Villeneuve — Île Notre-Dame, in the St Lawrence opposite downtown
 * Montréal. 4.36 km, clockwise, 14 turns: a semi-street circuit through the Parc
 * Jean-Drapeau, concrete walls close to the road all round, long straights joined by
 * slow chicanes and one hairpin. s = 0 is halfway down the Casino straight, so the pit
 * lane never wraps.
 *
 * Lap, in s:
 *    233  T13/T14 the final chicane, the Wall of Champions on the exit (right)
 *    660  start/finish line, pits on the right 450–850 (paddock and the Olympic basin behind)
 *    941  T1 / 1033 T2 Virage Senna (the Senna S)
 *   1418  T3/T4 chicane · 1690 T5 · 1945 T6/T7
 *   2000–2680  the back leg along the west of the island · 2698 T8/T9 chicane
 *   3380  L'Épingle, the hairpin (T10), by the Casino
 *   3450–4300  Droit du Casino, the Casino straight · 3901 T12 kink
 */
export const MONTREAL: CircuitDef = {
  id: 'montreal',
  name: 'Circuit Gilles Villeneuve',
  short: 'Montréal',
  country: 'CAN',
  centerline: { points: MONTREAL_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 13', at: 233, dir: -1, runoff: 'asphalt', runoffDepth: 20, front: 'tecpro', chicane: true, brake: 1, brakeLen: 150, boards: true },
    { name: 'Wall of Champions', at: 263, dir: 1, runoff: 'asphalt', runoffDepth: 4, front: 'none', chicane: true },
    { name: 'Turn 1', at: 941, dir: 1, runoff: 'asphalt', runoffDepth: 24, front: 'tecpro', brake: 0.9, brakeLen: 120, boards: true },
    { name: 'Virage Senna', at: 1033, dir: -1, runoff: 'asphalt', runoffDepth: 22, front: 'tecpro', wideExit: true },
    { name: 'Turn 3', at: 1418, dir: -1, runoff: 'grass', runoffDepth: 12, front: 'tyres', chicane: true, brake: 0.75, brakeLen: 100, boards: true },
    { name: 'Turn 4', at: 1476, dir: 1, runoff: 'grass', runoffDepth: 10, front: 'tyres', chicane: true, wideExit: true },
    { name: 'Turn 5', at: 1690, dir: -1, runoff: 'grass', runoffDepth: 8, span: [1640, 1760], front: 'none' },
    { name: 'Turn 6', at: 1945, dir: 1, runoff: 'asphalt', runoffDepth: 14, front: 'tecpro', chicane: true, brake: 0.6, brakeLen: 80, boards: true },
    { name: 'Turn 7', at: 1998, dir: -1, runoff: 'grass', runoffDepth: 10, front: 'tyres', chicane: true, wideExit: true },
    { name: 'Turn 8', at: 2698, dir: -1, runoff: 'asphalt', runoffDepth: 20, front: 'tecpro', chicane: true, brake: 0.85, brakeLen: 120, boards: true },
    { name: 'Turn 9', at: 2733, dir: 1, runoff: 'grass', runoffDepth: 12, front: 'tyres', chicane: true, wideExit: true },
    { name: "L'Épingle", at: 3380, dir: -1, runoff: 'asphalt', runoffDepth: 30, front: 'tecpro', brake: 1, brakeLen: 150, boards: true },
    { name: 'Turn 11', at: 3445, dir: -1, runoff: 'asphalt', runoffDepth: 8, front: 'none' },
    { name: 'Turn 12', at: 3901, dir: -1, runoff: 'grass', runoffDepth: 6, span: [3850, 3950], front: 'none' },
  ],
  // a semi-street circuit: concrete walls and debris fences all round, red-and-white kerbs,
  // the Wall of Champions ("Bienvenue au Québec") on the right at the exit of the final chicane
  trackside: {
    barrier: 'concrete',
    fence: 1,
    // white-painted concrete (the sponsors hang on the fences and the grandstand walls)
    art: 'plain',
    runoffPaint: 'bands',
    kerb: ['#d52b1e', '#ecece8'],
    runs: [
      { from: 262, to: 338, side: 1, kind: 'concrete', art: 'champions', fence: 1 },
      // grandstand walls: tall fences in front of the stands
      { from: 280, to: 920, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 990, to: 1110, side: -1, kind: 'concrete', fence: 2 },
      { from: 3250, to: 3420, side: -1, kind: 'concrete', fence: 2 },
      { from: 4000, to: 225, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
    ],
    lights: [{ from: 300, to: 900, side: -1, spacing: 55 }],
  },
  halfWidth: 5.8,
  startOffset: 660,
  // an island in the river: flat, a metre or so of rise and fall round the lap
  elevation: [
    [0.0, 0.4],
    [0.08, 0.2],
    [0.2, 0.5],
    [0.3, 1.1],
    [0.4, 0.9],
    [0.5, 0.3],
    [0.6, 0.6],
    [0.72, 1.2],
    [0.8, 1.0],
    [0.9, 0.6],
  ],
  pitSide: 1,
  // (the lane opens just past the Wall of Champions; the paddock stops short of the basin)
  pit: { start: 450, end: 850, building: [440, 860], paddock: 128 },
  sectors: [0.28, 0.65],
  drs: [
    { detect: 1880, start: 2070, end: 2600 },
    { detect: 3200, start: 3520, end: 4250 },
    { detect: 4150, start: 330, end: 860 },
  ],
  // concrete walls a few metres from the road almost everywhere
  walls: { straight: 4.2, inside: 3.4, wobble: 0.25 },
};
