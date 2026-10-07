import type { CircuitDef } from '../CircuitGen.ts';
import { SAKHIR_LINE } from './sakhirLine.ts';

/** lap length of the surveyed centreline (m): elevation keys below are written in s */
const LAP = 5406;

/**
 * Bahrain International Circuit, Sakhir — 5.412 km, clockwise, 15 turns: the Grand Prix
 * layout in the desert south of Manama, raced at night under the floodlights. The real
 * centreline (see circuits/sakhirLine.ts); s = 0 is on the short run from Turn 14 to
 * Turn 15, so the pit lane (entry inside Turn 15, exit before Turn 1) never wraps.
 * Heading north up the main straight the pits, the paddock and the Sakhir Tower are on
 * the right (the infield, between the main straight and the Turn 10–11 back straight),
 * the main grandstand on the left.
 *
 * Lap, in s:
 *     40  T15 onto the main straight; pits on the right 170–880
 *    830  start line (the grid runs back toward Turn 15), DRS 3
 *   1175  T1  the big right hairpin at the end of the straight, the wide painted run-off
 *   1275  T2 (left) · 1390 T3 (flat-out right kink) · DRS 1 down to
 *   1975  T4  the 120° right, run-off all round the outside
 *   2250  T5 · 2330 T6 · 2455 T7: the fast left-right-left esses
 *   2705  T8  the right hairpin · the climb to
 *   3090  T9  (long left, on the crest) · 3170 T10 the blind, downhill left, a lock-up magnet
 *   3200–3850  the back straight (DRS 2), past the paddock and the Tower, to
 *   3890  T11 (long left) · 4280 T12 (fast right) · 4570 T13 (right)
 *   4630–5330  the straight to T14 · 5370 T14 (right) · 40 T15
 */
export const SAKHIR: CircuitDef = {
  id: 'sakhir',
  name: 'Bahrain International Circuit',
  short: 'Sakhir',
  country: 'BHR',
  centerline: { points: SAKHIR_LINE, smooth: 3 },
  corners: [
    { name: 'Turn 15', at: 40, dir: -1, runoff: 'asphalt', runoffDepth: 34, span: [0, 90], front: 'tecpro' },
    { name: 'Turn 1', at: 1175, dir: -1, runoff: 'asphalt', runoffDepth: 62, span: [1120, 1230], front: 'tecpro', brake: 1, brakeLen: 160, boards: true },
    { name: 'Turn 2', at: 1275, dir: 1, runoff: 'asphalt', runoffDepth: 40 },
    { name: 'Turn 3', at: 1390, dir: -1, runoff: 'asphalt', runoffDepth: 36, span: [1350, 1430] },
    { name: 'Turn 4', at: 1975, dir: -1, runoff: 'asphalt', runoffDepth: 60, span: [1935, 2040], front: 'tecpro', brake: 0.9, brakeLen: 130, boards: true, wideExit: true },
    { name: 'Turn 5', at: 2250, dir: 1, runoff: 'asphalt', runoffDepth: 34, span: [2220, 2280] },
    { name: 'Turn 6', at: 2330, dir: -1, runoff: 'asphalt', runoffDepth: 36, wideExit: true },
    { name: 'Turn 7', at: 2455, dir: 1, runoff: 'asphalt', runoffDepth: 34, wideExit: true },
    { name: 'Turn 8', at: 2705, dir: -1, runoff: 'asphalt', runoffDepth: 48, span: [2665, 2745], front: 'tecpro', brake: 0.85, brakeLen: 120, boards: true },
    { name: 'Turn 9', at: 3090, dir: 1, runoff: 'asphalt', runoffDepth: 36, span: [3030, 3140] },
    { name: 'Turn 10', at: 3170, dir: 1, runoff: 'asphalt', runoffDepth: 52, span: [3150, 3200], front: 'tecpro', brake: 1, brakeLen: 110, boards: true },
    { name: 'Turn 11', at: 3890, dir: 1, runoff: 'asphalt', runoffDepth: 46, span: [3850, 4110], front: 'tecpro', brake: 0.8, brakeLen: 110, boards: true },
    { name: 'Turn 12', at: 4280, dir: -1, runoff: 'asphalt', runoffDepth: 40, span: [4170, 4390] },
    { name: 'Turn 13', at: 4570, dir: -1, runoff: 'asphalt', runoffDepth: 44, span: [4470, 4630], front: 'tecpro', brake: 0.8, brakeLen: 100, boards: true },
    { name: 'Turn 14', at: 5370, dir: -1, runoff: 'asphalt', runoffDepth: 50, span: [5330, 5400], front: 'tecpro', brake: 0.95, brakeLen: 130, boards: true },
  ],
  halfWidth: 6.8,
  // the braking zones of T1, T4, T10 and T14 fan out
  widen: [
    { from: 1100, to: 1215, extra: 2.4 },
    { from: 1900, to: 2000, extra: 2.0 },
    { from: 3120, to: 3185, extra: 1.6 },
    { from: 5310, to: 5390, extra: 1.6 },
  ],
  // armco and debris fences round the desert, tall fences and a concrete wall along the main
  // straight (the grandstand on the left, the pit wall on the right), red-and-white kerbs,
  // huge painted asphalt run-offs; and light masts round the whole lap (it is a night race:
  // the floodlight rows themselves come from env/night.ts after dark)
  trackside: {
    barrier: 'armco',
    fence: 1,
    runoffPaint: 'bands',
    kerb: ['#d2231c', '#ecece8'],
    armcoBoards: true,
    ground: 'desert',
    runs: [
      { from: 60, to: 1130, side: -1, kind: 'concrete', fence: 2, art: 'ads' },
      { from: 1130, to: 1260, fence: 2 },
      { from: 3200, to: 3850, side: 1, fence: 2 },
    ],
    // (the real lap is lined with ~500 light poles on both sides: a pole every ~50 m a side)
    lights: [
      { from: 60, to: 1120, side: -1, spacing: 50 },
      { from: 1240, to: 5330, side: -1, spacing: 55 },
      { from: 1240, to: 5330, side: 1, spacing: 55 },
    ],
  },
  startOffset: 830,
  // Flat-ish desert: the main straight in the lowest part, a gentle climb through T4–T8 to the
  // crest of T9/T10 (T10 itself is taken going downhill), the back straight falling away to
  // T11, a small rise over T12 and down again through T13–T15.
  elevation: (
    [
      [0, 3.2], [300, 2.6], [830, 2.2], [1175, 1.6], [1400, 2.4], [1700, 3.6], [1975, 5], [2330, 7.2], [2705, 9.6],
      [2900, 12.2], [3090, 15], [3150, 15.6], [3220, 14.6], [3500, 12.4], [3850, 10.2], [4100, 10.4], [4280, 11.2],
      [4570, 8.6], [4900, 6.2], [5370, 4],
    ] as [number, number][]
  ).map(([s, h]) => [s / LAP, h]),
  pitSide: 1,
  pit: { start: 170, end: 880 },
  sectors: [0.327, 0.707],
  drs: [
    { detect: 1100, start: 1450, end: 1880 },
    { detect: 3120, start: 3260, end: 3780 },
    { detect: 5300, start: 130, end: 1060 },
  ],
};
