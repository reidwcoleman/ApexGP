import type { CircuitDef } from '../CircuitGen.ts';

/**
 * The scenic circuits: fictional road courses laid out by hand (straights and corners, see
 * CircuitGen) in places no Grand Prix goes — a clifftop headland over the sea, the shore of an
 * alpine lake under the glaciers, a red-rock desert among the mesas. Each has its own land
 * (venues/scenic*.ts): the geography is built round wherever the lap ends up, so the layouts
 * can be tuned freely.
 */

/**
 * Capo Serena — a clifftop road course on a Mediterranean headland. 5.2 km, clockwise. The pit
 * straight runs along the cliff edge with the sea below on the left, the lap swings round the
 * lighthouse at the tip of the cape, climbs through the olive terraces and umbrella pines to the
 * ridge and drops back through the cypress avenue to the harbour hairpin.
 */
export const SERENA: CircuitDef = {
  id: 'serena',
  name: 'Circuito di Capo Serena',
  short: 'Capo Serena',
  country: 'ITA',
  segments: [
    { type: 'straight', length: 850, free: true },
    { type: 'corner', angle: -90, radius: 40, name: 'Faro', runoff: 'asphalt', runoffDepth: 44 },
    { type: 'straight', length: 200 },
    { type: 'corner', angle: 35, radius: 140, name: 'Scogliera', runoff: 'gravel', runoffDepth: 30 },
    { type: 'corner', angle: -45, radius: 220, name: 'Turn 3', runoff: 'grass', runoffDepth: 26 },
    { type: 'straight', length: 320, free: true },
    { type: 'corner', angle: -50, radius: 150, name: 'Belvedere', runoff: 'gravel', runoffDepth: 36 },
    { type: 'corner', angle: 40, radius: 100, name: 'Turn 5', runoff: 'gravel', runoffDepth: 30 },
    { type: 'straight', length: 150 },
    { type: 'corner', angle: -75, radius: 55, name: 'Cala', runoff: 'asphalt', runoffDepth: 36 },
    { type: 'corner', angle: 60, radius: 60, name: 'Turn 7', runoff: 'asphalt', runoffDepth: 34 },
    { type: 'corner', angle: -70, radius: 70, name: 'Turn 8', runoff: 'gravel', runoffDepth: 30 },
    { type: 'straight', length: 300, free: true },
    { type: 'corner', angle: 30, radius: 200, name: 'Uliveto', runoff: 'gravel', runoffDepth: 32 },
    { type: 'straight', length: 220 },
    { type: 'corner', angle: -75, radius: 70, name: 'Turn 10', runoff: 'gravel', runoffDepth: 34 },
    { type: 'straight', length: 400, free: true },
    { type: 'corner', angle: -160, radius: 30, name: 'Tornante', runoff: 'asphalt', runoffDepth: 40 },
    { type: 'straight', length: 210 },
    { type: 'corner', angle: 160, radius: 35, name: 'Tornante Alto', runoff: 'asphalt', runoffDepth: 36 },
    { type: 'straight', length: 300 },
    { type: 'corner', angle: 40, radius: 90, name: 'Le Esse', runoff: 'gravel', runoffDepth: 30 },
    { type: 'corner', angle: -50, radius: 85, name: 'Turn 15', runoff: 'gravel', runoffDepth: 30 },
    { type: 'corner', angle: -50, radius: 330, name: 'Cipressi', runoff: 'gravel', runoffDepth: 36 },
    { type: 'straight', length: 450, free: true },
    { type: 'corner', angle: -30, radius: 70, name: 'Marina', runoff: 'asphalt', runoffDepth: 40 },
    { type: 'straight', length: 150 },
  ],
  halfWidth: 6.0,
  startOffset: 290,
  elevation: [
    [0.0, 0],
    [0.06, -0.8],
    [0.13, -2.5],
    [0.2, -2],
    [0.28, 0.5],
    [0.35, 3],
    [0.42, 8],
    [0.47, 12],
    [0.53, 21],
    [0.58, 31],
    [0.62, 38],
    [0.66, 40],
    [0.7, 36],
    [0.725, 31],
    [0.75, 26],
    [0.79, 20],
    [0.84, 13],
    [0.9, 6],
    [0.95, 2],
  ],
  pitSide: 1,
  pit: { start: 30, end: 540 },
  sectors: [0.33, 0.66],
  drs: [{ detect: 4700, start: 90, end: 560 }],
  trackside: {
    barrier: 'armco',
    fence: 1,
    armcoBoards: true,
    runoffPaint: 'bands',
    runs: [{ from: 20, to: 560, side: -1, kind: 'concrete', fence: 2, art: 'ads' }],
  },
};

/**
 * Bergsee — a lakeside circuit on the floor of a glacial valley. 4.9 km, anticlockwise. The pit
 * straight runs along the shore, the far end climbs into the spruce forest on the moraine and
 * comes back down through the meadows past the village church, with 2 500 m peaks on every side.
 */
export const BERGSEE: CircuitDef = {
  id: 'bergsee',
  name: 'Bergsee Ring',
  short: 'Bergsee',
  country: 'SUI',
  segments: [
    { type: 'straight', length: 950, free: true },
    { type: 'corner', angle: 85, radius: 45, name: 'Seekurve', runoff: 'asphalt', runoffDepth: 46 },
    { type: 'straight', length: 220 },
    { type: 'corner', angle: -35, radius: 160, name: 'Turn 2', runoff: 'grass', runoffDepth: 26 },
    { type: 'corner', angle: 50, radius: 120, name: 'Moräne', runoff: 'gravel', runoffDepth: 32 },
    { type: 'straight', length: 300 },
    { type: 'corner', angle: 90, radius: 55, name: 'Waldkehre', runoff: 'gravel', runoffDepth: 36 },
    { type: 'corner', angle: -70, radius: 70, name: 'Turn 5', runoff: 'gravel', runoffDepth: 30 },
    { type: 'corner', angle: 45, radius: 80, name: 'Turn 6', runoff: 'gravel', runoffDepth: 30 },
    { type: 'straight', length: 350 },
    { type: 'corner', angle: -45, radius: 250, name: 'Lärchen', runoff: 'gravel', runoffDepth: 34 },
    { type: 'corner', angle: 65, radius: 110, name: 'Turn 8', runoff: 'gravel', runoffDepth: 30 },
    { type: 'straight', length: 500, free: true },
    { type: 'corner', angle: 120, radius: 35, name: 'Kapelle', runoff: 'asphalt', runoffDepth: 40 },
    { type: 'straight', length: 280 },
    { type: 'corner', angle: -60, radius: 90, name: 'Turn 10', runoff: 'grass', runoffDepth: 28 },
    { type: 'corner', angle: 60, radius: 85, name: 'Turn 11', runoff: 'grass', runoffDepth: 28 },
    { type: 'straight', length: 420, free: true },
    { type: 'corner', angle: 30, radius: 300, name: 'Wiese', runoff: 'grass', runoffDepth: 30 },
    { type: 'corner', angle: -40, radius: 140, name: 'Turn 13', runoff: 'gravel', runoffDepth: 30 },
    { type: 'corner', angle: 75, radius: 75, name: 'Bootshaus', runoff: 'asphalt', runoffDepth: 40 },
    { type: 'straight', length: 160 },
  ],
  halfWidth: 6.2,
  startOffset: 300,
  elevation: [
    [0.0, 0],
    [0.1, 0],
    [0.17, 0.5],
    [0.24, 3],
    [0.3, 8],
    [0.36, 15],
    [0.42, 22],
    [0.5, 30],
    [0.58, 36],
    [0.65, 39],
    [0.7, 37],
    [0.76, 30],
    [0.82, 20],
    [0.88, 10],
    [0.93, 3.5],
    [0.97, 0.6],
  ],
  pitSide: -1,
  pit: { start: 30, end: 560 },
  sectors: [0.33, 0.68],
  drs: [{ detect: 4350, start: 80, end: 580 }],
  trackside: {
    barrier: 'armco',
    fence: 1,
    armcoBoards: true,
    runoffPaint: 'plain',
    kerb: ['#c8261e', '#ecece8'],
    runs: [{ from: 20, to: 580, side: 1, kind: 'concrete', fence: 2, art: 'ads' }],
  },
};

/**
 * Red Mesa — a desert road course among the buttes of the high plateau. 5.6 km, clockwise. A long
 * flat-out run across the valley floor, a plunge down into the wash below the rim, the climb back up
 * the switchbacks under a sandstone wall and a fast sweep past the lone butte to the line.
 */
export const REDMESA: CircuitDef = {
  id: 'redmesa',
  name: 'Red Mesa Raceway',
  short: 'Red Mesa',
  country: 'USA',
  segments: [
    { type: 'straight', length: 900, free: true },
    { type: 'corner', angle: -90, radius: 50, name: 'Rimrock', runoff: 'asphalt', runoffDepth: 52 },
    { type: 'straight', length: 350 },
    { type: 'corner', angle: -30, radius: 400, name: 'Turn 2', runoff: 'gravel', runoffDepth: 36 },
    { type: 'straight', length: 300 },
    { type: 'corner', angle: 70, radius: 100, name: 'The Wash', runoff: 'gravel', runoffDepth: 38 },
    { type: 'corner', angle: -100, radius: 70, name: 'Arroyo', runoff: 'gravel', runoffDepth: 36 },
    { type: 'straight', length: 450 },
    { type: 'corner', angle: 40, radius: 200, name: 'Turn 5', runoff: 'gravel', runoffDepth: 30 },
    { type: 'corner', angle: -160, radius: 32, name: 'Switchback', runoff: 'asphalt', runoffDepth: 38 },
    { type: 'straight', length: 320 },
    { type: 'corner', angle: 110, radius: 50, name: 'Turn 7', runoff: 'asphalt', runoffDepth: 34 },
    { type: 'straight', length: 260 },
    { type: 'corner', angle: -75, radius: 90, name: 'Juniper', runoff: 'gravel', runoffDepth: 34 },
    { type: 'corner', angle: 50, radius: 140, name: 'Turn 9', runoff: 'gravel', runoffDepth: 30 },
    { type: 'straight', length: 520, free: true },
    { type: 'corner', angle: -120, radius: 320, name: 'Butte', runoff: 'gravel', runoffDepth: 44 },
    { type: 'straight', length: 400, free: true },
    { type: 'corner', angle: -55, radius: 110, name: 'Turn 11', runoff: 'asphalt', runoffDepth: 36 },
    { type: 'straight', length: 220 },
  ],
  halfWidth: 6.4,
  startOffset: 450,
  elevation: [
    [0.0, 0],
    [0.12, -0.5],
    [0.2, -1.5],
    [0.26, -6],
    [0.32, -16],
    [0.38, -24],
    [0.44, -26],
    [0.5, -20],
    [0.56, -10],
    [0.62, -3],
    [0.7, 1],
    [0.8, 2],
    [0.9, 1],
  ],
  pitSide: 1,
  pit: { start: 120, end: 720 },
  sectors: [0.32, 0.64],
  drs: [
    { detect: 5500, start: 160, end: 1080 },
    { detect: 3800, start: 4000, end: 4560 },
  ],
  trackside: {
    barrier: 'armco',
    fence: 1,
    armcoBoards: true,
    runoffPaint: 'plain',
    ground: 'desert',
    runs: [{ from: 100, to: 760, side: -1, kind: 'concrete', fence: 2, art: 'ads' }],
  },
};

export const SCENIC: CircuitDef[] = [SERENA, BERGSEE, REDMESA];
