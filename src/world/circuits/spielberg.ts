import type { CircuitDef } from '../CircuitGen.ts';
import { SPIELBERG_LINE } from './spielbergLine.ts';

/**
 * Red Bull Ring, Spielberg — the Austrian Grand Prix. 4.318 km, clockwise, 10 turns on a
 * hillside above the Mur valley in Styria, ~65 m between the lowest and the highest point.
 * The real centreline (see spielbergLine.ts); s = 0 is on the short run from Turn 9 down
 * to the last corner, so the pit lane never wraps.
 *
 * Lap, in s:
 *    140  T10 Red Bull Mobile (the last corner, the low point), pits on the right 300–830
 *    590  start/finish line, the straight climbing hard to
 *    910  T1  Niki Lauda Kurve (tight uphill right)
 *   1610  T2  the flat-out left kink on the climb
 *   1855  T3  Remus (the top hairpin, highest point)
 *   2670  T4  Schlossgold (downhill right) · 2880 T5 (the long right sweep)
 *   3210  T6  Rauch · 3500 T7 Würth (the fast downhill lefts)
 *   3690  T8  · 4255 T9 Jochen Rindt (fast rights in the valley)
 */
export const SPIELBERG: CircuitDef = {
  id: 'spielberg',
  name: 'Red Bull Ring',
  short: 'Spielberg',
  country: 'AUT',
  centerline: { points: SPIELBERG_LINE, smooth: 3 },
  corners: [
    { name: 'Red Bull Mobile', at: 140, dir: -1, runoff: 'gravel', runoffDepth: 44, span: [110, 290], front: 'tecpro', wideExit: true, brake: 0.7 },
    { name: 'Niki Lauda', at: 910, dir: -1, runoff: 'asphalt', runoffDepth: 56, front: 'tecpro', boards: true, wideExit: true, brake: 1, brakeLen: 130 },
    { name: 'Turn 2', at: 1612, dir: 1, runoff: 'grass', runoffDepth: 22 },
    { name: 'Remus', at: 1855, dir: -1, runoff: 'asphalt', runoffDepth: 64, front: 'tecpro', boards: true, wideExit: true, brake: 1, brakeLen: 150 },
    { name: 'Schlossgold', at: 2670, dir: -1, runoff: 'asphalt', runoffDepth: 52, front: 'tyres', boards: true, wideExit: true, brake: 0.9, brakeLen: 120 },
    { name: 'Turn 5', at: 2880, dir: -1, runoff: 'grass', runoffDepth: 30, span: [2760, 2990] },
    { name: 'Rauch', at: 3210, dir: 1, runoff: 'gravel', runoffDepth: 44, front: 'tyres', wideExit: true, brake: 0.5 },
    { name: 'Würth', at: 3500, dir: 1, runoff: 'gravel', runoffDepth: 42, front: 'tyres', wideExit: true, brake: 0.4 },
    { name: 'Turn 8', at: 3690, dir: -1, runoff: 'grass', runoffDepth: 32 },
    { name: 'Jochen Rindt', at: 4255, dir: -1, runoff: 'gravel', runoffDepth: 46, front: 'tyres', wideExit: true, brake: 0.5 },
  ],
  halfWidth: 6.1,
  startOffset: 590,
  // Styria: the pit straight climbs from the last corner (the low point) steeply up to the
  // Niki Lauda Kurve, the climb goes on (over the T2 kink) to Remus at the top of the hill,
  // then it's downhill all the way: Schlossgold, the Rauch/Würth lefts, down into the valley
  // for Turn 8, Rindt and the last corner.
  elevation: [
    [0.0, 2.2],
    [0.032, 0.6],
    [0.06, 0.4],
    [0.09, 1.8],
    [0.12, 5.2],
    [0.15, 10.5],
    [0.18, 18],
    [0.2, 25],
    [0.212, 29.5],
    [0.225, 32],
    [0.26, 38],
    [0.31, 45],
    [0.36, 52],
    [0.395, 58],
    [0.425, 63.5],
    [0.44, 66],
    [0.46, 66.5],
    [0.5, 63.5],
    [0.56, 57],
    [0.618, 50],
    [0.66, 42],
    [0.7, 35],
    [0.745, 28],
    [0.79, 21],
    [0.84, 14],
    [0.89, 9],
    [0.94, 5.5],
    [0.975, 3.4],
  ],
  // armco and debris fence round the hills, TecPro on the outside of the heavy stops, the
  // grandstand wall down the pit straight; red-and-white kerbs, blue-and-white painted run-off
  trackside: {
    barrier: 'armco',
    fence: 1,
    art: 'ads',
    runoffPaint: 'bands',
    kerb: ['#d0202a', '#efefeb'],
    armcoBoards: true,
    runs: [
      { from: 300, to: 870, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 1790, to: 1900, side: -1, front: 'tecpro' },
    ],
  },
  pitSide: 1,
  pit: { start: 300, end: 830 },
  sectors: [0.3, 0.68],
  drs: [
    { detect: 4180, start: 330, end: 840 },
    { detect: 700, start: 1000, end: 1780 },
    { detect: 1760, start: 1960, end: 2570 },
  ],
};
