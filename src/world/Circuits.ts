import { generateCircuit, type CircuitDef } from './CircuitGen.ts';
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
 * The calendar is Monza alone (2026-11-10, Reid: every other circuit deleted, Monza rebuilt from the
 * ground up in world/monza). The earlier circuits are in git history.
 */
export const CIRCUITS: CircuitDef[] = [MONZA];

/**
 * The scenic road courses (circuits/scenic.ts): fictional circuits in places no Grand Prix goes. Not
 * part of the calendar (no career rounds, no unlocks): open from the start for quick races, time
 * trials and simulated races.
 */
export const SCENIC: CircuitDef[] = [];
export const ALL_CIRCUITS: CircuitDef[] = [...CIRCUITS, ...SCENIC];
export const isScenic = (id: string) => SCENIC.some((c) => c.id === id);

const _layout = new Map<string, number[]>();
/** the lap as flat [x0, z0, x1, z1, …] for drawing (the surveyed centreline, or the authored layout generated) */
export function layoutPoints(def: CircuitDef): number[] {
  if (def.centerline) return def.centerline.points;
  let pts = _layout.get(def.id);
  if (!pts) {
    const c = generateCircuit(def);
    pts = [];
    for (let i = 0; i < c.n; i += 8) pts.push(c.x[i], c.z[i]);
    _layout.set(def.id, pts);
  }
  return pts;
}
