import type { CircuitDef } from '../CircuitGen.ts';
import { YASMARINA_LINE } from './yasmarinaLine.ts';

/**
 * Yas Marina Circuit — Yas Island, Abu Dhabi. The 2009–2020 Grand Prix layout (this is
 * what the TUMFTM survey traces): 5.55 km, anticlockwise, 21 turns, dead flat. A twilight
 * race: it starts at sunset and finishes under the floodlights. The real centreline (see
 * circuits/yasmarinaLine.ts); s = 0 is on the short run from Turn 20 to Turn 21, so the
 * pit lane never wraps.
 *
 * Map (x = east, z = south): the main straight runs east across the middle of the site,
 * the infield and the hairpin are to the north (Ferrari World's red roof beyond), the
 * back straight comes down the west side, and the second straight runs south-east to the
 * marina, where the lap winds round the harbour and under the W Yas Marina hotel.
 *
 * Lap, in s:
 *    145  T21 the last right onto the main straight
 *    200–625  pit lane on the right (south, the marina side); 440 start/finish line
 *    705  T1 (left) — the pit exit dives through a tunnel under it
 *    955  T2 (left) · 1060 T3 / 1240 T4 the long double right
 *   1635  T5/T6 chicane · 1824 T7 the hairpin, then the 1.2 km back straight (DRS)
 *   3069  T8/T9 chicane · 3283 T10 the long left onto the second straight (DRS)
 *   4098  T11–T13 the chicane at the marina · 4353 T14
 *   4642  T15 · 4803 T16 · 4932 T17 along the harbour
 *   5047  T18 · 5162 T19: under the hotel's bridge between them · 5462 T20
 */
export const YASMARINA: CircuitDef = {
  id: 'yasmarina',
  name: 'Yas Marina Circuit',
  short: 'Yas Marina',
  country: 'UAE',
  centerline: { points: YASMARINA_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 21', at: 145, dir: -1, runoff: 'asphalt', runoffDepth: 26, front: 'tecpro', span: [80, 195], brake: 0.5, brakeLen: 70 },
    { name: 'Turn 1', at: 705, dir: 1, runoff: 'asphalt', runoffDepth: 48, front: 'tecpro', brake: 1, brakeLen: 140, boards: true },
    { name: 'Turn 2', at: 955, dir: 1, runoff: 'asphalt', runoffDepth: 34, front: 'tecpro', wideExit: true },
    { name: 'Turn 3', at: 1080, dir: -1, runoff: 'asphalt', runoffDepth: 34, span: [1035, 1150], boards: false, brake: 0 },
    { name: 'Turn 4', at: 1240, dir: -1, runoff: 'asphalt', runoffDepth: 38, span: [1150, 1275], wideExit: true },
    { name: 'Turn 5', at: 1635, dir: 1, runoff: 'asphalt', runoffDepth: 40, front: 'tecpro', chicane: true, brake: 0.85, brakeLen: 110, boards: true },
    { name: 'Turn 6', at: 1690, dir: -1, runoff: 'asphalt', runoffDepth: 30, front: 'tecpro', chicane: true },
    { name: 'Turn 7', at: 1824, dir: 1, runoff: 'asphalt', runoffDepth: 52, front: 'tecpro', brake: 1, brakeLen: 120, boards: true, wideExit: true },
    { name: 'Turn 8', at: 3069, dir: 1, runoff: 'asphalt', runoffDepth: 56, front: 'tecpro', chicane: true, brake: 1, brakeLen: 150, boards: true },
    { name: 'Turn 9', at: 3143, dir: -1, runoff: 'asphalt', runoffDepth: 32, front: 'tecpro', chicane: true, wideExit: true },
    { name: 'Turn 10', at: 3283, dir: 1, runoff: 'asphalt', runoffDepth: 30, span: [3228, 3428], boards: false, brake: 0 },
    { name: 'Turn 11', at: 4098, dir: 1, runoff: 'asphalt', runoffDepth: 48, front: 'tecpro', chicane: true, brake: 1, brakeLen: 140, boards: true },
    { name: 'Turn 12', at: 4163, dir: -1, runoff: 'asphalt', runoffDepth: 20, front: 'tecpro', chicane: true },
    { name: 'Turn 13', at: 4208, dir: 1, runoff: 'asphalt', runoffDepth: 22, front: 'tecpro', chicane: true, wideExit: true },
    { name: 'Turn 14', at: 4353, dir: 1, runoff: 'asphalt', runoffDepth: 30, front: 'tecpro', brake: 0.7, brakeLen: 90, boards: true },
    { name: 'Turn 15', at: 4642, dir: -1, runoff: 'asphalt', runoffDepth: 16, span: [4612, 4697] },
    { name: 'Turn 16', at: 4803, dir: -1, runoff: 'asphalt', runoffDepth: 16, span: [4767, 4842] },
    { name: 'Turn 17', at: 4932, dir: -1, runoff: 'asphalt', runoffDepth: 22, front: 'tecpro', brake: 0.7, brakeLen: 80, boards: true },
    { name: 'Turn 18', at: 5047, dir: 1, runoff: 'asphalt', runoffDepth: 18, front: 'tecpro' },
    { name: 'Turn 19', at: 5162, dir: 1, runoff: 'asphalt', runoffDepth: 18, front: 'tecpro' },
    { name: 'Turn 20', at: 5462, dir: -1, runoff: 'asphalt', runoffDepth: 24, front: 'tecpro', brake: 0.6, brakeLen: 80, boards: true },
  ],
  halfWidth: 6.6,
  // the run to Turn 1 and the braking zones of the hairpin, T8 and T11 fan out
  widen: [
    { from: 600, to: 715, extra: 1.6 },
    { from: 1740, to: 1830, extra: 1.8 },
    { from: 2980, to: 3075, extra: 1.6 },
    { from: 4010, to: 4100, extra: 1.4 },
  ],
  // a modern Tilke circuit: concrete walls with debris fences all round, huge painted asphalt
  // run-offs, red/white kerbs; tall fences along the main straight's grandstands, and the
  // floodlight masts all the way round the lap (it is a twilight race)
  trackside: {
    barrier: 'concrete',
    fence: 1,
    art: 'ads',
    runoffPaint: 'bands',
    kerb: ['#c8261e', '#ecece8'],
    runs: [
      // the main grandstand wall (north, left), the pit wall side is the pit complex's
      { from: 180, to: 680, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      // the North grandstand at the hairpin, the West grandstand on the back straight
      { from: 1700, to: 1900, side: -1, kind: 'concrete', fence: 2 },
      { from: 2700, to: 3060, side: 1, kind: 'concrete', fence: 2 },
      // the marina: walls close to the road, fences in front of the harbour stands
      { from: 4280, to: 5250, kind: 'concrete', fence: 2 },
    ],
    lights: [
      { from: 20, to: 1700, side: 1, spacing: 60 },
      { from: 1700, to: 3000, side: 1, spacing: 60 },
      { from: 3000, to: 4600, side: 1, spacing: 60 },
      { from: 4600, to: 20, side: 1, spacing: 60 },
    ],
  },
  startOffset: 440,
  // reclaimed flat coastal land: a metre or so of rise and fall round the lap
  elevation: [
    [0.0, 0.4],
    [0.1, 0.3],
    [0.2, 0.6],
    [0.3, 0.9],
    [0.45, 0.6],
    [0.6, 0.3],
    [0.75, 0.2],
    [0.9, 0.3],
  ],
  pitSide: 1,
  // the pit building on the marina side; the paddock between it and the harbour
  pit: { start: 200, end: 625, building: [215, 610], paddock: 118 },
  sectors: [0.28, 0.69],
  drs: [
    { detect: 1760, start: 1900, end: 2960 },
    { detect: 3000, start: 3440, end: 3990 },
  ],
};
