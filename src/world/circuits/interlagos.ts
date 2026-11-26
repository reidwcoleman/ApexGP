import type { CircuitDef } from '../CircuitGen.ts';
import { INTERLAGOS_LINE } from './interlagosLine.ts';

/**
 * Autódromo José Carlos Pace, Interlagos — São Paulo. 4.31 km, anticlockwise, 15 turns,
 * laid into a natural bowl between the Guarapiranga and Billings reservoirs, ~33 m from
 * the top of the pit straight down to the lake. The real centreline (see interlagosLine.ts);
 * s = 0 is at the bottom of Mergulho, so the pit lane (inside the main straight) never wraps.
 *
 * Lap, in s:
 *    165  T12 Junção, the pit entry on its exit (left)
 *    300–1000  Subida dos Boxes / Arquibancadas: the long curving climb; pits on the left 1080–1472
 *   1204  start/finish line, at the top of the hill
 *   1570  T1/T2 the S do Senna, plunging downhill · 1845 T3 Curva do Sol
 *   1965–2575  Reta Oposta (DRS), falling toward the lake
 *   2625  T4 Descida do Lago · 2805 T5, the lowest point
 *   3235  T6/T7 Ferradura · 3545 T8 Laranjinha · 3665 T9 Pinheirinho
 *   3970  T10 Bico de Pato (hairpin) · 4205 T11 Mergulho, diving down to Junção
 */
export const INTERLAGOS: CircuitDef = {
  id: 'interlagos',
  name: 'Autódromo José Carlos Pace',
  short: 'Interlagos',
  country: 'BRA',
  centerline: { points: INTERLAGOS_LINE, smooth: 3 },
  corners: [
    { name: 'Junção', at: 165, dir: 1, runoff: 'asphalt', runoffDepth: 40, front: 'tecpro', boards: true },
    { name: 'Subida dos Boxes', at: 300, dir: 1, runoff: 'asphalt', runoffDepth: 30, span: [250, 380], boards: false, brake: 0 },
    { name: 'Arquibancadas', at: 555, dir: 1, runoff: 'asphalt', runoffDepth: 30, span: [470, 660], boards: false, brake: 0 },
    { name: 'S do Senna', at: 1570, dir: 1, runoff: 'asphalt', runoffDepth: 62, front: 'tecpro', boards: true, brake: 1, brakeLen: 120 },
    { name: 'Turn 2', at: 1664, dir: -1, runoff: 'gravel', runoffDepth: 40, boards: false },
    { name: 'Curva do Sol', at: 1845, dir: 1, runoff: 'gravel', runoffDepth: 38, span: [1725, 1965], boards: false, brake: 0 },
    { name: 'Descida do Lago', at: 2625, dir: 1, runoff: 'gravel', runoffDepth: 56, front: 'tyres', boards: true, brake: 0.9 },
    { name: 'Turn 5', at: 2805, dir: 1, runoff: 'gravel', runoffDepth: 40, span: [2740, 2890], boards: false },
    { name: 'Ferradura', at: 3235, dir: -1, runoff: 'gravel', runoffDepth: 44 },
    { name: 'Turn 7', at: 3375, dir: -1, runoff: 'gravel', runoffDepth: 38, boards: false },
    { name: 'Laranjinha', at: 3545, dir: -1, runoff: 'gravel', runoffDepth: 36 },
    { name: 'Pinheirinho', at: 3665, dir: 1, runoff: 'asphalt', runoffDepth: 34 },
    { name: 'Bico de Pato', at: 3970, dir: -1, runoff: 'asphalt', runoffDepth: 34, front: 'tyres', brake: 0.8 },
    { name: 'Mergulho', at: 4205, dir: 1, runoff: 'gravel', runoffDepth: 40, span: [4085, 4265], boards: false, brake: 0.2 },
  ],
  halfWidth: 6.2,
  startOffset: 1204,
  // The bowl: the start line at the top of the hill, down through the S do Senna and Curva do
  // Sol, on down the Reta Oposta to the lake (Descida do Lago, the lowest point), climbing
  // back through Ferradura, Laranjinha and Pinheirinho to Bico de Pato, diving through
  // Mergulho to Junção, then the long climb of the Subida dos Boxes to the line.
  elevation: [
    [0 / 4305, 9],
    [165 / 4305, 7],
    [300 / 4305, 8],
    [450 / 4305, 11.5],
    [600 / 4305, 15],
    [800 / 4305, 21],
    [1000 / 4305, 26],
    [1100 / 4305, 29],
    [1204 / 4305, 32],
    [1290 / 4305, 33],
    [1440 / 4305, 29.5],
    [1570 / 4305, 20],
    [1664 / 4305, 15],
    [1845 / 4305, 10.5],
    [1965 / 4305, 9],
    [2300 / 4305, 5],
    [2575 / 4305, 2.5],
    [2700 / 4305, 0.8],
    [2830 / 4305, 0],
    [3000 / 4305, 3],
    [3235 / 4305, 10],
    [3375 / 4305, 19],
    [3472 / 4305, 22],
    [3545 / 4305, 22.5],
    [3665 / 4305, 22],
    [3800 / 4305, 20],
    [3970 / 4305, 18],
    [4090 / 4305, 15.5],
    [4205 / 4305, 12],
  ],
  pitSide: -1,
  // the paddock is squeezed between the straight and the infield (Laranjinha, Ferradura): a short
  // building at the bottom of the straight, where the gap opens up, and a shallow paddock
  pit: { start: 1080, end: 1472, building: [1110, 1446], paddock: 62 },
  sectors: [0.3, 0.685],
  drs: [
    { detect: 1650, start: 1975, end: 2570 },
    { detect: 300, start: 700, end: 1450 },
  ],
  // armco and tyre walls round the infield, tall catch fences; the concrete wall under Setor A
  // and the Arquibancadas, red-and-white kerbs, striped tarmac run-off
  trackside: {
    barrier: 'armco',
    fence: 1,
    art: 'ads',
    runoffPaint: 'stripes',
    kerb: ['#c8261e', '#ecece8'],
    armcoBoards: true,
    runs: [
      { from: 440, to: 1500, side: 1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 20, to: 240, side: 1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 1400, to: 1520, side: 1, front: 'tecpro', fence: 2 },
      { from: 2440, to: 2620, side: 1, fence: 2 },
    ],
  },
};
