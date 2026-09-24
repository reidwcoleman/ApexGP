import type { CircuitDef } from './CircuitGen.ts';
import { MONZA_LINE } from './circuits/monzaLine.ts';

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

export const CIRCUITS: CircuitDef[] = [MONZA];
