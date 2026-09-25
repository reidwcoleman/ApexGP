import type { CircuitDef } from './CircuitGen.ts';
import { MONZA_LINE } from './circuits/monzaLine.ts';
import { SPA_LINE } from './circuits/spaLine.ts';
import { SILVERSTONE_LINE } from './circuits/silverstoneLine.ts';

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
    { name: 'Turn 1', at: 1177, dir: -1, runoff: 'asphalt', runoffDepth: 62 },
    { name: 'Turn 2', at: 1216, dir: 1, runoff: 'asphalt', runoffDepth: 30 },
    { name: 'Curva Grande', at: 1673, dir: -1, runoff: 'gravel', runoffDepth: 46, span: [1300, 2010] },
    { name: 'Roggia', at: 2391, dir: 1, runoff: 'asphalt', runoffDepth: 42 },
    { name: 'Turn 5', at: 2433, dir: -1, runoff: 'gravel', runoffDepth: 30 },
    { name: 'Lesmo 1', at: 2842, dir: -1, runoff: 'gravel', runoffDepth: 38 },
    { name: 'Lesmo 2', at: 3127, dir: -1, runoff: 'gravel', runoffDepth: 34 },
    { name: 'Ascari', at: 4196, dir: 1, runoff: 'gravel', runoffDepth: 36 },
    { name: 'Turn 9', at: 4310, dir: -1, runoff: 'gravel', runoffDepth: 40 },
    { name: 'Turn 10', at: 4387, dir: 1, runoff: 'asphalt', runoffDepth: 32 },
    { name: 'Parabolica', at: 5386, dir: -1, runoff: 'gravel', runoffDepth: 40 },
  ],
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
};

export const CIRCUITS: CircuitDef[] = [MONZA, SPA, SILVERSTONE];
