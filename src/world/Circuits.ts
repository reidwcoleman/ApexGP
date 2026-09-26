import type { CircuitDef } from './CircuitGen.ts';
import { MONZA_LINE } from './circuits/monzaLine.ts';
import { SPA_LINE } from './circuits/spaLine.ts';
import { SILVERSTONE_LINE } from './circuits/silverstoneLine.ts';
import { SUZUKA_LINE } from './circuits/suzukaLine.ts';
import { INTERLAGOS } from './circuits/interlagos.ts';
import { SPIELBERG } from './circuits/spielberg.ts';
import { AUSTIN } from './circuits/austin.ts';
import { ZANDVOORT } from './circuits/zandvoort.ts';
import { MONTREAL } from './circuits/montreal.ts';

/**
 * Autodromo Nazionale Monza — the Temple of Speed. 5.79 km, clockwise, 11
 * turns. The real centreline (see circuits/monzaLine.ts); s = 0 is at the
 * exit of the Parabolica, so the pit lane never wraps.
 *
 * Lap, in s:
 *    550  start/finish line, pit lane on the right from 120 to 960
 *   1177  T1/T2  Variante del Rettifilo (right–left, 2nd gear)
 *   1673  T3     Curva Grande (flat out)
 *   2391  T4/T5  Variante della Roggia (left–right)
 *   2842  T6     Lesmo 1
 *   3127  T7     Lesmo 2, then the Serraglio straight under the old banking
 *   4196  T8–T10 Variante Ascari (left–right–left)
 *   5386  T11    Parabolica (Curva Alboreto)
 */
export const MONZA: CircuitDef = {
  id: 'monza',
  name: 'Autodromo Nazionale Monza',
  short: 'Monza',
  country: 'ITA',
  centerline: { points: MONZA_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 1', at: 1177, dir: -1, runoff: 'asphalt', runoffDepth: 62, front: 'tecpro', chicane: true, brake: 1, brakeLen: 150, boards: true, wideExit: false },
    { name: 'Turn 2', at: 1216, dir: 1, runoff: 'asphalt', runoffDepth: 30, front: 'tecpro', chicane: true, wideExit: true, boards: false, brake: 0 },
    { name: 'Curva Grande', at: 1673, dir: -1, runoff: 'gravel', runoffDepth: 46, span: [1300, 2010], front: 'tyres', chicane: false, boards: false, wideExit: false, brake: 0 },
    { name: 'Roggia', at: 2391, dir: 1, runoff: 'asphalt', runoffDepth: 42, front: 'tecpro', chicane: true, brake: 0.9, brakeLen: 120, boards: true, wideExit: false },
    { name: 'Turn 5', at: 2433, dir: -1, runoff: 'gravel', runoffDepth: 30, front: 'tyres', chicane: true, wideExit: true, boards: false, brake: 0 },
    { name: 'Lesmo 1', at: 2842, dir: -1, runoff: 'gravel', runoffDepth: 38, front: 'tyres', chicane: false, brake: 0.55, brakeLen: 80, boards: true, wideExit: false },
    { name: 'Lesmo 2', at: 3127, dir: -1, runoff: 'gravel', runoffDepth: 34, front: 'tyres', chicane: false, brake: 0.3, brakeLen: 50, boards: false, wideExit: false },
    { name: 'Ascari', at: 4196, dir: 1, runoff: 'gravel', runoffDepth: 36, front: 'tecpro', chicane: true, brake: 0.85, brakeLen: 110, boards: true, wideExit: false },
    { name: 'Turn 9', at: 4310, dir: -1, runoff: 'gravel', runoffDepth: 40, front: 'tyres', chicane: false, boards: false, wideExit: false, brake: 0 },
    { name: 'Turn 10', at: 4387, dir: 1, runoff: 'asphalt', runoffDepth: 32, front: 'tecpro', chicane: true, wideExit: true, boards: false, brake: 0 },
    { name: 'Parabolica', at: 5386, dir: -1, runoff: 'gravel', runoffDepth: 40, front: 'tyres', chicane: false, brake: 0.8, brakeLen: 110, boards: true, wideExit: true },
  ],
  trackside: {
    barrier: 'armco',
    armcoBoards: true,
    runs: [
      // the main straight, grandstand side: concrete wall with a tall fence (the Tribuna Centrale is behind it)
      { from: 5670, to: 1150, side: -1, kind: 'concrete', fence: 2 },
    ],
  },
  halfWidth: 6.3,
  startOffset: 550,
  // the park is nearly flat: a gentle rise to the Lesmos, down again toward Ascari
  elevation: [
    [0.0, 0],
    [0.1, 0],
    [0.2, 0.4],
    [0.28, 2.4],
    [0.36, 4.8],
    [0.45, 6.3],
    [0.52, 5.6],
    [0.6, 3.6],
    [0.7, 2.2],
    [0.8, 1.2],
    [0.9, 0.3],
  ],
  pitSide: 1,
  pit: { start: 120, end: 960 },
  sectors: [0.294, 0.682],
  drs: [
    { detect: 3200, start: 4480, end: 5290 },
    { detect: 5250, start: 670, end: 1080 },
  ],
};

/**
 * Circuit de Spa-Francorchamps — 7.0 km through the Ardennes forest, clockwise,
 * 19 turns and ~95 m of elevation. The real centreline (see circuits/spaLine.ts);
 * s = 0 is on the run from Blanchimont to the Bus Stop, so the pit lane never wraps.
 *
 * Lap, in s:
 *    200  T18/T19 Bus Stop chicane
 *    560  start/finish line (grid back to the Bus Stop exit), pit lane on the left from 300 to 760
 *    834  T1   La Source (hairpin)
 *   1493  T2   Eau Rouge, T3 Raidillon (the climb), T4 at the crest
 *   2867  T5–T7 Les Combes, Malmedy at the end of the Kemmel straight
 *   3522  T8   Rivage (hairpin)
 *   4321  T10/T11 Pouhon (double-apex left)
 *   4976  T12–T13 Fagnes, Campus
 *   5386  T14–T15 Stavelot, Paul Frère — the lowest point
 *   6645  T17  Blanchimont (flat out)
 */
export const SPA: CircuitDef = {
  id: 'spa',
  name: 'Circuit de Spa-Francorchamps',
  short: 'Spa',
  country: 'BEL',
  centerline: { points: SPA_LINE, smooth: 3 },
  corners: [
    { name: 'Bus Stop', at: 200, dir: -1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Turn 19', at: 244, dir: 1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'La Source', at: 834, dir: -1, runoff: 'asphalt', runoffDepth: 48 },
    { name: 'Eau Rouge', at: 1493, dir: 1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Raidillon', at: 1573, dir: -1, runoff: 'asphalt', runoffDepth: 44 },
    { name: 'Turn 4', at: 1723, dir: 1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Les Combes', at: 2867, dir: -1, runoff: 'asphalt', runoffDepth: 50 },
    { name: 'Turn 6', at: 2952, dir: 1, runoff: 'asphalt', runoffDepth: 34 },
    { name: 'Malmedy', at: 3107, dir: -1, runoff: 'gravel', runoffDepth: 36 },
    { name: 'Rivage', at: 3522, dir: -1, runoff: 'asphalt', runoffDepth: 44 },
    { name: 'Turn 9', at: 3737, dir: 1, runoff: 'gravel', runoffDepth: 34 },
    { name: 'Pouhon', at: 4321, dir: 1, runoff: 'gravel', runoffDepth: 52 },
    { name: 'Turn 11', at: 4456, dir: 1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Fagnes', at: 4976, dir: -1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Campus', at: 5106, dir: 1, runoff: 'gravel', runoffDepth: 36 },
    { name: 'Stavelot', at: 5386, dir: -1, runoff: 'gravel', runoffDepth: 44 },
    { name: 'Paul Frère', at: 5645, dir: -1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Turn 16', at: 6390, dir: 1, runoff: 'grass', runoffDepth: 30 },
    { name: 'Blanchimont', at: 6645, dir: 1, runoff: 'gravel', runoffDepth: 46 },
  ],
  halfWidth: 6.0,
  startOffset: 560,
  // the Ardennes: down from La Source into Eau Rouge, 35 m straight up Raidillon, on up the
  // Kemmel straight to Les Combes, then all the way down through Pouhon to Stavelot and back up
  elevation: [
    [0.0, -4],
    [0.035, -3],
    [0.063, 0],
    [0.119, 2.5],
    [0.17, -9],
    [0.205, -19],
    [0.213, -20],
    [0.228, -7],
    [0.246, 13],
    [0.27, 22],
    [0.33, 34],
    [0.406, 46],
    [0.444, 38],
    [0.503, 27],
    [0.534, 19],
    [0.58, 8],
    [0.627, -4],
    [0.711, -20],
    [0.77, -37],
    [0.807, -44],
    [0.85, -38],
    [0.913, -22],
    [0.96, -10],
  ],
  pitSide: -1,
  pit: { start: 300, end: 760 },
  sectors: [0.33, 0.72],
  drs: [
    { detect: 60, start: 320, end: 760 },
    { detect: 1350, start: 1850, end: 2790 },
  ],
  // armco through the forest with sponsor boards on the straights; a concrete wall with a tall
  // fence in front of the grandstands opposite the pits
  trackside: {
    barrier: 'armco',
    armcoBoards: true,
    runs: [{ from: 330, to: 800, side: 1, kind: 'concrete', fence: 2 }],
  },
};

/**
 * Silverstone — the home of British motor racing, on a wartime airfield. 5.89 km,
 * clockwise, 18 turns, flat and fast. s = 0 sits between the two rights of Club.
 *
 * Lap, in s:
 *    370  start/finish line on the Hamilton Straight, pits on the right (the Wing) 185–600
 *    645  Abbey (T1, flat-out right) · 890 Farm · 1144 Village · 1290 The Loop · 1494 Aintree
 *   1540–2150  Wellington Straight
 *   2169  Brooklands · 2424 Luffield · 2698 Woodcote, the National Pits Straight
 *   3278  Copse
 *   3858  Maggotts → Becketts → Chapel (4443), then the Hangar Straight
 *   5253  Stowe · 5767 Vale · 5847 / 135 Club
 */
export const SILVERSTONE: CircuitDef = {
  id: 'silverstone',
  name: 'Silverstone Circuit',
  short: 'Silverstone',
  country: 'GBR',
  centerline: { points: SILVERSTONE_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 18', at: 135, dir: -1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Abbey', at: 645, dir: -1, runoff: 'asphalt', runoffDepth: 52 },
    { name: 'Farm', at: 890, dir: 1, runoff: 'asphalt', runoffDepth: 34 },
    { name: 'Village', at: 1144, dir: -1, runoff: 'asphalt', runoffDepth: 46 },
    { name: 'The Loop', at: 1290, dir: 1, runoff: 'asphalt', runoffDepth: 44 },
    { name: 'Aintree', at: 1494, dir: 1, runoff: 'asphalt', runoffDepth: 34 },
    { name: 'Brooklands', at: 2169, dir: 1, runoff: 'asphalt', runoffDepth: 50, span: [2110, 2300] },
    { name: 'Luffield', at: 2424, dir: -1, runoff: 'asphalt', runoffDepth: 44, span: [2360, 2560] },
    { name: 'Woodcote', at: 2698, dir: -1, runoff: 'asphalt', runoffDepth: 40, span: [2640, 2860] },
    { name: 'Copse', at: 3278, dir: -1, runoff: 'gravel', runoffDepth: 56, span: [3200, 3440] },
    { name: 'Maggotts', at: 3858, dir: 1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Becketts', at: 3963, dir: -1, runoff: 'gravel', runoffDepth: 46 },
    { name: 'Turn 12', at: 4138, dir: 1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Turn 13', at: 4268, dir: -1, runoff: 'gravel', runoffDepth: 38 },
    { name: 'Chapel', at: 4443, dir: 1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Stowe', at: 5253, dir: -1, runoff: 'gravel', runoffDepth: 58, span: [5180, 5400] },
    { name: 'Vale', at: 5767, dir: 1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Club', at: 5847, dir: -1, runoff: 'asphalt', runoffDepth: 44 },
  ],
  halfWidth: 6.5,
  startOffset: 370,
  // an airfield: almost flat, a gentle fall from Copse down to Becketts and the Hangar Straight
  elevation: [
    [0.0, 0],
    [0.1, 0.8],
    [0.2, 1.8],
    [0.32, 2.4],
    [0.42, 1.6],
    [0.52, 3.2],
    [0.6, 1.2],
    [0.68, -0.6],
    [0.76, -1.8],
    [0.86, -1.0],
    [0.94, -0.4],
  ],
  pitSide: 1,
  pit: { start: 185, end: 600 },
  sectors: [0.33, 0.67],
  drs: [
    { detect: 1420, start: 1570, end: 2080 },
    { detect: 4330, start: 4560, end: 5150 },
    { detect: 5700, start: 190, end: 560 },
  ],
  // the airfield: astroturf beyond the painted run-off, concrete + tall fence along the
  // grandstands opposite the Wing, floodlight masts along the Wellington straight
  trackside: {
    barrier: 'armco',
    runoffPaint: 'astroturf',
    armcoBoards: true,
    runs: [{ from: 120, to: 640, side: -1, kind: 'concrete', fence: 2 }],
    lights: [{ from: 1560, to: 2080, side: 1, spacing: 75 }],
  },
};

/**
 * Suzuka — Honda's figure of eight in the hills above Ise Bay. 5.80 km, 18 turns:
 * clockwise through the first half, anticlockwise through the second, the back
 * straight crossing the Degner–Hairpin run on a bridge. s = 0 is just past the
 * Casio Triangle, so the pit lane never wraps.
 *
 * Lap, in s:
 *    160  T18 the last curve onto the main straight (downhill), pits on the right 300–880
 *    400  start/finish line
 *   1045  T1/T2 First Curve · 1440–1945 the S Curves (uphill) · 2200 Dunlop
 *   2629  Degner 1 · 2789 Degner 2 · 2880 under the bridge · 3109 T10 · 3249 Hairpin
 *   3335–3950  the long right (200R) · 4160 Spoon · 4330–5260 back straight over the bridge
 *   5303  130R · 5723 Casio Triangle
 */
export const SUZUKA: CircuitDef = {
  id: 'suzuka',
  name: 'Suzuka International Racing Course',
  short: 'Suzuka',
  country: 'JPN',
  centerline: { points: SUZUKA_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 18', at: 160, dir: -1, runoff: 'asphalt', runoffDepth: 34, span: [70, 240] },
    { name: 'Turn 1', at: 1045, dir: -1, runoff: 'gravel', runoffDepth: 58 },
    { name: 'Turn 2', at: 1215, dir: -1, runoff: 'gravel', runoffDepth: 44 },
    { name: 'S Curves', at: 1440, dir: 1, runoff: 'grass', runoffDepth: 30 },
    { name: 'Turn 4', at: 1560, dir: -1, runoff: 'grass', runoffDepth: 30 },
    { name: 'Turn 5', at: 1707, dir: 1, runoff: 'gravel', runoffDepth: 32 },
    { name: 'Turn 6', at: 1890, dir: -1, runoff: 'gravel', runoffDepth: 34, span: [1800, 1995] },
    { name: 'Dunlop', at: 2150, dir: 1, runoff: 'gravel', runoffDepth: 40, span: [2040, 2420] },
    { name: 'Degner 1', at: 2629, dir: -1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Degner 2', at: 2789, dir: -1, runoff: 'gravel', runoffDepth: 34 },
    { name: 'Turn 10', at: 3109, dir: -1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Hairpin', at: 3249, dir: 1, runoff: 'asphalt', runoffDepth: 38 },
    { name: 'Turn 12', at: 3544, dir: -1, runoff: 'gravel', runoffDepth: 40, span: [3335, 3950] },
    { name: 'Spoon', at: 4160, dir: 1, runoff: 'gravel', runoffDepth: 50 },
    { name: 'Spoon Exit', at: 4300, dir: 1, runoff: 'gravel', runoffDepth: 40 },
    { name: '130R', at: 5303, dir: 1, runoff: 'asphalt', runoffDepth: 44 },
    { name: 'Casio Triangle', at: 5723, dir: -1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Turn 17', at: 5778, dir: 1, runoff: 'asphalt', runoffDepth: 30 },
  ],
  halfWidth: 6.0,
  startOffset: 400,
  // Downhill from the line into Turn 1 (the low point), up through the S Curves and Dunlop to
  // Degner, down under the bridge to the Hairpin, climbing again through the long right to
  // Spoon; the back straight runs level and crosses the Degner–Hairpin run ~10 m up, then
  // falls through 130R and the Casio Triangle back to the line.
  elevation: [
    [0.0, 6],
    [0.038, 5],
    [0.069, 3.5],
    [0.12, 0.2],
    [0.18, -3],
    [0.206, -4],
    [0.248, -2],
    [0.293, 3],
    [0.335, 7],
    [0.384, 12],
    [0.422, 15],
    [0.453, 16],
    [0.48, 14],
    [0.496, 12],
    [0.513, 12],
    [0.536, 10.5],
    [0.56, 9.5],
    [0.603, 12],
    [0.655, 17],
    [0.717, 21],
    [0.742, 22],
    [0.793, 22.5],
    [0.853, 22.5],
    [0.906, 22],
    [0.914, 21.6],
    [0.948, 16],
    [0.986, 9],
  ],
  pitSide: 1,
  pit: { start: 300, end: 880 },
  sectors: [0.345, 0.74],
  drs: [{ detect: 5660, start: 270, end: 950 }],
  // armco and tyre walls in the hills; the main grandstand wall is painted red/white
  trackside: {
    barrier: 'armco',
    armcoBoards: true,
    runs: [{ from: 260, to: 980, side: -1, kind: 'concrete', fence: 2, art: 'ads' }],
  },
};

export const CIRCUITS: CircuitDef[] = [MONZA, SPA, SILVERSTONE, SUZUKA, MONTREAL, SPIELBERG, ZANDVOORT, AUSTIN, INTERLAGOS];
