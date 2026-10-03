import * as THREE from 'three';
import { perlin2, rng } from './noise.ts';
import type { Venue } from './worldmap.ts';
import type { SceneryLight } from './scenery.ts';
import { cloudShadowA, cloudShadowB } from './lightShadows.ts';
import { CLOUD_FIELD_GLSL } from './skyClouds.ts';

/**
 * Distant horizon: a parametric backdrop ring of mountain ranges, hills, dunes,
 * tree lines and city skylines around a venue, beyond the far terrain (> 15 km).
 *
 * ── API (for the track / venue agents) ──────────────────────────────────────
 *
 *   HORIZON_PRESETS[venue]   a HorizonSpec per Venue; scenery.ts builds the one
 *                            for `map.venue` automatically. To tune your venue,
 *                            edit only its entry (or call `setHorizonPreset`
 *                            before the scenery is built).
 *
 *   HorizonLayer = {
 *     kind:   'ridge'  mountains / hills (rows of a lit heightfield face with
 *                      gullies, forest → rock → snow by height)
 *             'dunes'  low rolling sand hills with marram grass
 *             'forest' a tree line (bumpy dark silhouette)
 *             'city'   a skyline of lit blocks with window bands; set
 *                      `center`/`spread` for a downtown cluster of towers
 *             'volcano' one lone cone (Popocatépetl): summit at bearing `center`,
 *                      base half-width `spread` (deg), snow cap; `rough` 0 dome … 1 steep cone
 *     dist:   distance from the circuit centre, metres (any: 1 500 … 60 000)
 *     height: crest / tallest-building height above `base`, metres
 *     from, to: compass arc in degrees (0 = north = −Z, 90 = east = +X), default 0 … 360
 *     base:   height of the layer's foot above the circuit's ground level (m), default 0
 *     rough:  ridge: 0 rolling … 1 jagged alpine;  city: building density 0 … 1
 *     scale:  horizontal feature size (m), default ≈ 3.5 × height
 *     snow:   ridge: fraction of the layer's max height above which snow lies (0 = none)
 *     haze:   aerial-perspective multiplier (1 = physical; < 1 clearer, > 1 paler)
 *     color:  base albedo (linear RGB) — forest for ridges, sand, foliage, concrete
 *     center, spread: city: compass bearing (deg) of downtown and its half-width (deg)
 *     seed:   noise seed
 *     fields: ridge: share of the gentle lower slopes cleared for pasture / fields, 0 … 1
 *   }
 *
 * Layers are drawn far → near in one draw call. The ring is compressed toward
 * the camera (so it never hits the far plane) and written at the back of the
 * depth range, after the world's opaque meshes (whatever hides it costs nothing)
 * and before the sky, so everything in the world stays in front of it and the sky
 * never draws over it; its haze uses the scene's aerial fog at the layer's true distance.
 *
 * The mesh only carries the shapes. Everything that makes a 30 km hillside read as
 * land rather than a cut-out is per pixel: a noise relief that bends the normals
 * (spurs and gullies the sun picks out), stands of darker and lighter trees, hedged
 * parcels of pasture and crops on the gentle lower slopes (`fields`), rock on the
 * steep faces and crests, a snow line broken by the gullies, single tree crowns cut
 * into the tree lines' tops (discard), and a milkier foot on every range (the air
 * between one ridge and the next). Every noise octave fades out before it is
 * smaller than a pixel, so nothing shimmers. Cost: one draw, ~100 k triangles, no
 * shadows.
 */

export type HorizonKind = 'ridge' | 'dunes' | 'forest' | 'city' | 'volcano';

export interface HorizonLayer {
  kind: HorizonKind;
  dist: number;
  height: number;
  from?: number;
  to?: number;
  base?: number;
  rough?: number;
  scale?: number;
  snow?: number;
  haze?: number;
  color?: [number, number, number];
  center?: number;
  spread?: number;
  seed?: number;
  /** ridge: 0 … 1 share of the gentle lower slopes cleared for pasture and fields (hedged parcels) */
  fields?: number;
}

export interface HorizonSpec {
  layers: HorizonLayer[];
}

const FOREST: [number, number, number] = [0.045, 0.07, 0.035];
const DRY: [number, number, number] = [0.2, 0.19, 0.11];

export const HORIZON_PRESETS: Record<Venue, HorizonSpec> = {
  // Monza: the Brianza hills and the Prealps to the north (the Grigne, Resegone), the Alps
  // (Monte Rosa, snow) far to the north-west, the Milan towers to the south, poplar lines all round
  park: {
    layers: [
      { kind: 'ridge', dist: 52000, height: 3600, from: 285, to: 330, rough: 0.9, snow: 0.55, haze: 0.55, seed: 3 },
      { kind: 'ridge', dist: 30000, height: 1900, from: 315, to: 60, rough: 0.8, snow: 0.9, haze: 0.8, seed: 7, base: 100 },
      { kind: 'ridge', dist: 20000, height: 650, from: 300, to: 75, rough: 0.45, haze: 0.9, seed: 11, base: 60, fields: 0.45 },
      { kind: 'city', dist: 16000, height: 230, from: 165, to: 215, center: 188, spread: 6, rough: 0.8, seed: 5 },
      { kind: 'forest', dist: 5000, height: 40, rough: 0.5, seed: 13 },
      // (tree lines stand on the real terrain inside 15 km: layer on layer of poplar rows and copses
      // across the plain, each a little paler, so the flat land recedes instead of stopping)
      { kind: 'forest', dist: 8200, height: 26, rough: 0.8, seed: 14, from: 220, to: 150 },
      { kind: 'forest', dist: 12000, height: 24, rough: 0.7, seed: 15, from: 225, to: 150 },
    ],
  },
  // the Ardennes: forested ridges fold on fold
  ardennes: {
    layers: [
      { kind: 'ridge', dist: 26000, height: 420, rough: 0.35, haze: 1, seed: 21, fields: 0.4 },
      { kind: 'ridge', dist: 18000, height: 330, rough: 0.4, seed: 22, fields: 0.5 },
      { kind: 'forest', dist: 15500, height: 30, rough: 0.6, seed: 23 },
      // spruce fringes on the crests of the nearer folds
      { kind: 'forest', dist: 5200, height: 30, rough: 0.7, seed: 24 },
      { kind: 'forest', dist: 9000, height: 30, rough: 0.6, seed: 25 },
      { kind: 'forest', dist: 12500, height: 30, rough: 0.6, seed: 26 },
    ],
  },
  // Silverstone: gently rolling Northamptonshire, woods and hedgerow trees on every horizon
  airfield: {
    layers: [
      { kind: 'ridge', dist: 24000, height: 90, rough: 0.15, seed: 31, color: [0.07, 0.09, 0.045], fields: 0.95 },
      { kind: 'forest', dist: 6000, height: 40, rough: 0.7, seed: 32 },
      { kind: 'forest', dist: 3200, height: 28, rough: 0.8, seed: 33, from: 200, to: 80 },
      // hedgerow oaks and spinneys, field after field to the horizon
      { kind: 'forest', dist: 4600, height: 22, rough: 0.9, seed: 34 },
      { kind: 'forest', dist: 8800, height: 24, rough: 0.8, seed: 35 },
      { kind: 'forest', dist: 12800, height: 24, rough: 0.7, seed: 36 },
    ],
  },
  // Suzuka: the Suzuka range to the west, wooded hills north, Ise Bay's coastal plain to the east
  suzuka: {
    layers: [
      { kind: 'ridge', dist: 30000, height: 1150, from: 200, to: 350, rough: 0.7, seed: 41 },
      { kind: 'ridge', dist: 18000, height: 420, from: 300, to: 60, rough: 0.5, seed: 42, fields: 0.25 },
      { kind: 'city', dist: 9000, height: 60, from: 60, to: 170, rough: 0.35, seed: 43 },
      { kind: 'forest', dist: 16000, height: 26, from: 170, to: 300, seed: 44 },
      // cedar and cypress on the hills north and west
      { kind: 'forest', dist: 5200, height: 28, from: 200, to: 60, rough: 0.7, seed: 45 },
      { kind: 'forest', dist: 9500, height: 28, from: 190, to: 70, rough: 0.6, seed: 46 },
    ],
  },
  // Interlagos: São Paulo all round (towers north towards the centre), the Serra do Mar to the south
  // (the city itself, its towers and the Guarapiranga / Billings reservoirs are real geometry out to ~13 km:
  // venues/interlagosCity.ts). Beyond: the Serra da Cantareira behind the centre (north, ~30 km,
  // +350 m), the centre's skyline (Paulista, Sé) NNE at ~16 km, Greater São Paulo sprawling to the
  // horizon all round, and the low wooded hills of the Serra do Mar's plateau edge to the south.
  interlagos: {
    layers: [
      { kind: 'ridge', dist: 32000, height: 360, from: 300, to: 75, rough: 0.45, seed: 51, base: 20 },
      { kind: 'ridge', dist: 36000, height: 190, from: 120, to: 250, rough: 0.35, seed: 54, base: 10 },
      { kind: 'city', dist: 16500, height: 175, from: 330, to: 70, center: 18, spread: 15, rough: 1, seed: 52 },
      { kind: 'city', dist: 21000, height: 60, rough: 0.8, seed: 53 },
    ],
  },
  // Montréal: the downtown skyline across the St Lawrence, Mont Royal behind it
  montreal: {
    layers: [
      // (the downtown towers, Mont Royal, the bridges and the south shore are real geometry:
      // venues/montrealCity.ts; this is only what lies beyond the 15 km terrain)
      // the Laurentians, low and blue far to the north
      { kind: 'ridge', dist: 56000, height: 480, from: 295, to: 45, rough: 0.35, haze: 1.1, seed: 61, scale: 9000 },
      // the Monteregian hills rising out of the plain to the east: Saint-Hilaire, Rougemont, Saint-Bruno
      { kind: 'ridge', dist: 32000, height: 400, from: 70, to: 84, rough: 0.55, seed: 65, scale: 4200, fields: 0.5 },
      { kind: 'ridge', dist: 40000, height: 360, from: 86, to: 96, rough: 0.5, seed: 66, scale: 4000 },
      { kind: 'ridge', dist: 16500, height: 190, from: 92, to: 104, rough: 0.3, seed: 67, scale: 3000 },
      // suburbs all round: Laval and the West Island, Longueuil and Brossard
      { kind: 'city', dist: 17000, height: 34, from: 190, to: 60, rough: 0.55, seed: 62 },
      { kind: 'city', dist: 17000, height: 26, from: 60, to: 190, rough: 0.4, seed: 63 },
    ],
  },
  // Zandvoort: the North Sea to the west (open horizon), the coastal dunes running north
  // (Bloemendaal, the IJmuiden steelworks' stacks on the skyline) and south (the Waterleidingduinen),
  // the Kennemer woods and Haarlem inland to the east
  zandvoort: {
    layers: [
      { kind: 'dunes', dist: 3800, height: 24, from: 8, to: 62, seed: 71 },
      { kind: 'dunes', dist: 3400, height: 22, from: 140, to: 215, seed: 74 },
      { kind: 'forest', dist: 5200, height: 22, from: 40, to: 160, rough: 0.6, seed: 72 },
      { kind: 'city', dist: 8500, height: 55, from: 75, to: 115, center: 96, spread: 6, rough: 0.7, seed: 73 },
      { kind: 'city', dist: 11500, height: 110, from: 9, to: 19, center: 14, spread: 3, rough: 0.35, seed: 75 },
    ],
  },
  // Red Bull Ring: the Styrian Alps all round, forested slopes, snow on the high peaks
  spielberg: {
    layers: [
      // (the terrain itself carries the valley, the Seckau Alps and the Gleinalpe out to ~15 km)
      // the Niedere Tauern far to the north-west and north, snow on the crests
      { kind: 'ridge', dist: 42000, height: 2300, from: 250, to: 30, rough: 1, snow: 0.86, haze: 0.6, seed: 81 },
      // the Seetal Alps (Zirbitzkogel) to the south-west, a little snow on the top
      { kind: 'ridge', dist: 24000, height: 1700, from: 200, to: 250, rough: 0.7, snow: 0.93, haze: 0.7, seed: 84 },
      // the Stub-, Glein- and Koralpe south and south-east, the Fischbach Alps east: rounded, wooded
      { kind: 'ridge', dist: 26000, height: 1300, from: 60, to: 205, rough: 0.55, haze: 0.7, seed: 82, fields: 0.3 },
      // the Seckau and Wölz Tauern behind the terrain's own mountains, north-west to north-east
      { kind: 'ridge', dist: 20000, height: 1250, from: 250, to: 60, rough: 0.85, haze: 0.75, seed: 83, fields: 0.15 },
      // spruce on the valley's own slopes and crests
      { kind: 'forest', dist: 6000, height: 32, rough: 0.6, seed: 85, color: [0.035, 0.055, 0.03] },
      { kind: 'forest', dist: 11000, height: 32, rough: 0.6, seed: 86, color: [0.035, 0.055, 0.03] },
    ],
  },
  // COTA: the Texas hill country to the west, prairie tree lines (the Austin skyline itself is
  // modelled at its real distance, ~12 km NW, by venues/austinScenery.ts)
  austin: {
    layers: [
      { kind: 'ridge', dist: 30000, height: 180, from: 200, to: 340, rough: 0.25, seed: 91, color: [0.1, 0.1, 0.055], fields: 0.45 },
      { kind: 'forest', dist: 6000, height: 14, rough: 0.8, seed: 93, color: DRY },
      // live-oak mottes and creek-bottom pecans: low, broken lines across the prairie
      { kind: 'forest', dist: 3600, height: 12, rough: 0.9, seed: 94, color: [0.06, 0.07, 0.035] },
      { kind: 'forest', dist: 9500, height: 14, rough: 0.8, seed: 95, color: [0.08, 0.08, 0.045] },
      { kind: 'forest', dist: 13500, height: 13, rough: 0.7, seed: 96, color: DRY },
    ],
  },
  // starting points for the new venues (their track agents tune bearings and layers)
  // Melbourne: the suburbs run flat to the horizon all round except over Port Phillip Bay (south-west);
  // the Dandenong Ranges blue to the east, Mount Macedon and the Great Dividing Range's foothills to
  // the north-west and north, the You Yangs across the bay (the CBD, Southbank and St Kilda Road are
  // real geometry: venues/melbourneScenery.ts)
  melbourne: {
    layers: [
      { kind: 'ridge', dist: 52000, height: 420, from: 315, to: 40, rough: 0.35, haze: 1.1, seed: 104, scale: 9000 },
      { kind: 'ridge', dist: 62000, height: 900, from: 308, to: 330, rough: 0.5, haze: 1.05, seed: 105, scale: 5000 },
      { kind: 'ridge', dist: 36000, height: 560, from: 62, to: 118, rough: 0.45, haze: 0.95, seed: 103, scale: 6000, fields: 0.35 },
      { kind: 'ridge', dist: 50000, height: 330, from: 244, to: 262, rough: 0.75, haze: 1.05, seed: 106, scale: 2600 },
      { kind: 'city', dist: 9000, height: 30, from: 300, to: 195, rough: 0.5, seed: 101 },
      { kind: 'city', dist: 5200, height: 60, from: 330, to: 20, rough: 0.35, seed: 102 },
    ],
  },
  // Sakhir: the flat stony desert of southern Bahrain, the low broken rim of the island's central
  // depression all round (Jebel ad-Dukhan itself is terrain: venues/sakhirLand.ts), Riffa and Isa
  // Town sprawling low to the north, Manama's towers far off beyond them
  sakhir: {
    layers: [
      { kind: 'ridge', dist: 17000, height: 45, rough: 0.3, scale: 2600, seed: 111, color: [0.3, 0.24, 0.15] },
      { kind: 'city', dist: 16000, height: 38, from: 320, to: 55, rough: 0.5, haze: 1.2, seed: 113 },
      { kind: 'city', dist: 27000, height: 200, from: 340, to: 22, center: 2, spread: 7, rough: 0.9, haze: 1.3, seed: 115 },
    ],
  },
  // Yas Marina: the Abu Dhabi skyline (the Corniche, Etihad Towers) ~26 km to the south-west, the
  // mainland's low sprawl (Khalifa City, Al Raha) to the south, desert dunes inland to the south-east;
  // open Gulf to the north (Al Raha's shore towers and the Aldar HQ are real geometry: yasmarinaScenery.ts)
  yasmarina: {
    layers: [
      { kind: 'city', dist: 26000, height: 290, from: 208, to: 252, center: 229, spread: 9, rough: 0.9, haze: 1.1, seed: 121 },
      { kind: 'city', dist: 17000, height: 55, from: 130, to: 235, rough: 0.45, haze: 1.1, seed: 125 },
      { kind: 'dunes', dist: 24000, height: 30, from: 95, to: 190, rough: 0.3, seed: 123, color: DRY },
    ],
  },
  // Mexico City, 2,240 m up in its valley ringed by mountains: Popocatépetl's snow cone (65 km
  // SE) and the long Iztaccíhuatl (53 km, the sleeping woman: head, chest and feet) behind the
  // Sierra de Santa Catarina's small volcanoes; the Ajusco to the south-west, the Sierra de las
  // Cruces west, the Sierra de Guadalupe north; the towers of Reforma and the centre WNW and the
  // city's mid-rise carpet on every side. Everything pale in the thin, hazy highland air.
  mexico: {
    layers: [
      // (heights a little exaggerated, as the long lenses see them)
      // (heights a little exaggerated, as the long lenses see them)
      { kind: 'volcano', dist: 65000, height: 4100, center: 131, spread: 9.5, rough: 0.7, snow: 0.7, haze: 0.3, seed: 133 },
      { kind: 'ridge', dist: 58000, height: 900, from: 100, to: 150, rough: 0.45, haze: 0.4, seed: 134 },
      // Iztaccíhuatl: a long snowy massif, the head (north), the chest and the feet on top of it
      { kind: 'volcano', dist: 53600, height: 3250, center: 113.4, spread: 2.3, rough: 0.2, snow: 0.7, haze: 0.33, seed: 137 },
      { kind: 'volcano', dist: 53400, height: 3380, center: 116.6, spread: 2.7, rough: 0.2, snow: 0.7, haze: 0.33, seed: 136 },
      { kind: 'volcano', dist: 53800, height: 3060, center: 119.8, spread: 2.5, rough: 0.25, snow: 0.74, haze: 0.33, seed: 138 },
      { kind: 'volcano', dist: 54200, height: 3000, center: 116.4, spread: 6.8, rough: 0.12, snow: 0.8, haze: 0.33, seed: 139 },
      { kind: 'ridge', dist: 30000, height: 1650, from: 185, to: 245, rough: 0.6, haze: 0.7, seed: 140 },
      { kind: 'ridge', dist: 32000, height: 1250, from: 240, to: 325, rough: 0.55, haze: 0.75, seed: 141 },
      { kind: 'ridge', dist: 17000, height: 620, from: 320, to: 40, rough: 0.5, haze: 0.8, seed: 142 },
      { kind: 'ridge', dist: 13000, height: 430, from: 95, to: 165, rough: 0.45, haze: 0.85, seed: 143 },
      { kind: 'ridge', dist: 6500, height: 200, from: 165, to: 200, rough: 0.35, seed: 144 },
      { kind: 'city', dist: 8500, height: 230, from: 250, to: 330, center: 292, spread: 9, rough: 0.9, seed: 131 },
      { kind: 'city', dist: 5200, height: 45, rough: 0.55, haze: 1.1, seed: 132 },
    ],
  },
  // Hungaroring: the Gödöllő Hills roll on round the valley (the terrain carries the near ones),
  // the Börzsöny and the Pilis far to the north and north-west, the Mátra east-north-east,
  // Budapest's haze-softened skyline 18 km south-west, the flat Great Plain to the south-east;
  // everything pale in the July heat haze
  hungaroring: {
    layers: [
      { kind: 'ridge', dist: 58000, height: 780, from: 45, to: 80, rough: 0.55, haze: 1.25, seed: 141, color: FOREST },
      { kind: 'ridge', dist: 42000, height: 640, from: 330, to: 20, rough: 0.6, haze: 1.3, seed: 142, color: FOREST },
      { kind: 'ridge', dist: 30000, height: 420, from: 285, to: 330, rough: 0.5, haze: 1.3, seed: 144, color: FOREST },
      { kind: 'ridge', dist: 26000, height: 260, from: 255, to: 290, rough: 0.35, haze: 1.3, seed: 145, color: FOREST, fields: 0.6 },
      { kind: 'city', dist: 18000, height: 60, from: 220, to: 252, center: 236, spread: 7, rough: 0.55, haze: 1.5, seed: 146 },
      { kind: 'ridge', dist: 21000, height: 150, from: 10, to: 150, rough: 0.35, haze: 1.2, seed: 147, color: FOREST, fields: 0.7 },
      { kind: 'forest', dist: 16500, height: 18, from: 110, to: 260, rough: 0.8, haze: 1.2, seed: 143, color: FOREST },
      // acacia windbreaks and oak woods on the hills round the valley
      { kind: 'forest', dist: 4200, height: 20, rough: 0.8, seed: 148, color: [0.05, 0.065, 0.03] },
      { kind: 'forest', dist: 8500, height: 20, rough: 0.7, haze: 1.1, seed: 149, color: [0.05, 0.065, 0.03] },
    ],
  },
};

/** replace a venue's horizon (call before the scenery is built) */
export function setHorizonPreset(venue: Venue, spec: HorizonSpec) {
  HORIZON_PRESETS[venue] = spec;
}

/** how much the ring is squeezed toward the camera (keeps it inside any far plane) */
const SQUEEZE = 24;

export interface Horizon {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera): void;
  setLight(l: SceneryLight): void;
}

const DEG = Math.PI / 180;

/**
 * Per-vertex data: position (true world metres; the ring is squeezed by the model matrix),
 * base albedo, aInfo = (metres along the ring, row: 0 foot … 1 crest / metres above the foot,
 * kind, h01 or building hash), aHaze, aEx = (feature scale m, fields 0 … 1, rough, snow line).
 * kinds: 0 ridge, 1 tree line, 2 dunes, 3 building, 4 glass tower
 */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  info: number[] = [];
  haze: number[] = [];
  ex: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number, c: readonly number[], u: number, vv: number, kind: number, h: number, hz: number, ex: readonly number[] = EX0) {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    this.info.push(u, vv, kind, h);
    this.haze.push(hz);
    this.ex.push(ex[0], ex[1], ex[2], ex[3]);
    return this.pos.length / 3 - 1;
  }
}
const EX0 = [600, 0, 0.5, 0] as const;

/**
 * The real terrain under the ring (inside the far terrain's ±15 km), set while building: tree lines
 * stand on the land they are drawn over (a line at 4 km on a rise is not buried by it), and ranges
 * beyond the terrain's edge rise from the edge's own height, not from the circuit's.
 */
let groundAt: ((x: number, z: number) => number) | null = null;
const footAt = (x: number, z: number, base: number) => (groundAt ? Math.max(base, groundAt(x, z) - 12) : base);

/** compass arc → list of azimuths (radians, compass) */
function arc(L: HorizonLayer, step: number): number[] {
  const a0 = (L.from ?? 0) * DEG;
  let a1 = (L.to ?? 360) * DEG;
  if (a1 <= a0) a1 += Math.PI * 2;
  const n = Math.max(2, Math.ceil((a1 - a0) / step));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a0 + ((a1 - a0) * i) / n);
  return out;
}

/** 0 at the arc ends, 1 inside (full circles: 1 everywhere) */
function arcFade(L: HorizonLayer, az: number): number {
  const a0 = (L.from ?? 0) * DEG;
  let a1 = (L.to ?? 360) * DEG;
  if (a1 <= a0) a1 += Math.PI * 2;
  if (a1 - a0 >= Math.PI * 2 - 1e-3) return 1;
  const w = Math.min(14 * DEG, (a1 - a0) * 0.3);
  const t = Math.min(az - a0, a1 - az) / w;
  const s = Math.max(0, Math.min(1, t));
  return s * s * (3 - 2 * s);
}

function ridgeNoise(x: number, z: number, rough: number): number {
  // ridged fbm: sharp crests (rough → 1) or rolling domes (rough → 0)
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < 6; o++) {
    const n = perlin2(x * f, z * f);
    const ridge = 1 - Math.abs(n);
    const v = rough * ridge * ridge + (1 - rough) * (n * 0.5 + 0.5);
    sum += v * a;
    norm += a;
    a *= 0.5 + rough * 0.05;
    f *= 2.03;
  }
  return sum / norm;
}

function buildLayer(b: Builder, L: HorizonLayer, cx: number, cz: number, groundY: number) {
  const r = rng(L.seed ?? 1);
  const base = groundY + (L.base ?? 0);
  const hz = L.haze ?? 1;
  const D = L.dist;
  const dir = (az: number) => [Math.sin(az), -Math.cos(az)] as const;
  if (L.kind === 'city') {
    buildCity(b, L, cx, cz, base, hz, r);
    return;
  }
  if (L.kind === 'volcano') {
    buildVolcano(b, L, cx, cz, base, hz);
    return;
  }
  if (L.kind === 'forest') {
    // a tree line: broad masses (copses, gaps, a field showing through) along the ring; the single
    // crowns (~ 9–14 m) are cut per pixel in the shader, so the silhouette is a real fringe of
    // tree tops, not a smooth band. Two staggered rows give it depth (the back row paler).
    const step = Math.min(0.6 * DEG, 40 / D);
    const col = L.color ?? FOREST;
    const azs = arc(L, step);
    const ox = r() * 100, oz = r() * 100;
    for (let row = 1; row >= 0; row--) {
      const Dr = D + row * 140;
      const rows: number[][] = [];
      for (const az of azs) {
        const [sx, sz] = dir(az);
        const fade = arcFade(L, az);
        const mass = perlin2((sx * Dr) / 900 + ox + row * 7, (sz * Dr) / 900 + oz) * 0.5 + 0.5;
        const gap = perlin2((sx * Dr) / 260 - oz, (sz * Dr) / 260 + ox + row * 3);
        const h = L.height * fade * Math.max(0, Math.min(1, 0.2 + mass * 1.15)) * (gap < -0.42 + row * 0.1 ? 0.15 : 1) * (row ? 1.12 : 1);
        const x = cx + sx * Dr, z = cz + sz * Dr;
        const x2 = cx + sx * (Dr - 60), z2 = cz + sz * (Dr - 60);
        const k = row ? 1.12 : 1;
        const foot = groundAt ? groundAt(x, z) + (L.base ?? 0) : base;
        const c = [col[0] * (0.85 + 0.3 * mass) * k, col[1] * (0.85 + 0.3 * mass) * k, col[2] * (0.9 + 0.2 * mass) * k];
        const ex = [12 + row * 2, 0, L.rough ?? 0.6, 0];
        // aInfo.y: metres above the foot; aInfo.w: this column's crown height
        rows.push([b.v(x2, foot - 14, z2, c, az * Dr, -14, 1, h, hz, ex), b.v(x, foot + h * 1.08 + 2, z, c, az * Dr, h * 1.08 + 2, 1, h, hz, ex)]);
      }
      for (let i = 0; i < rows.length - 1; i++) b.idx.push(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][0], rows[i + 1][1], rows[i][1]);
    }
    return;
  }
  // ridge / dunes: a lit heightfield band from (D − depth) to the crest at D. Colour (forest,
  // pasture, rock, snow) is decided per pixel in the shader from aEx; the vertices carry the
  // shape and the layer's base albedo.
  const dunes = L.kind === 'dunes';
  const rough = dunes ? 0.1 : (L.rough ?? 0.5);
  const scale = L.scale ?? Math.max(dunes ? 220 : 600, L.height * (dunes ? 9 : 3.5));
  const depth = Math.min(D * 0.45, Math.max(scale * 1.6, L.height * 5));
  // (rows and columns where they show: a low far ridge is a few pixels tall, a big range needs them)
  const K = dunes ? 5 : L.height > 500 ? 11 : 7;
  const step = Math.max(0.07 * DEG, Math.min(0.32 * DEG, scale / 14 / D));
  const azs = arc(L, step);
  const ox = r() * 100, oz = r() * 100;
  const forest = L.color ?? (dunes ? ([0.34, 0.3, 0.2] as [number, number, number]) : FOREST);
  const fields = L.fields ?? 0;
  const ex = [scale, fields, rough, L.snow ?? 0];
  const grid: number[][] = [];
  for (const az of azs) {
    const fade = arcFade(L, az);
    const [sx, sz] = dir(az);
    const col: number[] = [];
    const foot = footAt(cx + sx * (D - depth), cz + sz * (D - depth), base);
    for (let k = 0; k <= K; k++) {
      const u = k / K;
      const d = D - depth * (1 - u);
      const px = sx * d, pz = sz * d;
      // crest height along this azimuth, and the slope's own spurs and gullies (they run down
      // the face, so the lit/shaded ribs read like real mountainsides, not a smooth sheet)
      const crest = ridgeNoise(px / scale + ox, pz / scale + oz, rough);
      const rib = perlin2(px / (scale * 0.22) - oz, pz / (scale * 0.22) + ox);
      const rib2 = perlin2(px / (scale * 0.07) + oz, pz / (scale * 0.07) - ox);
      const prof = dunes ? Math.pow(u, 0.8) : u * u * (3 - 2 * u) * 0.65 + Math.pow(u, 1.6) * 0.35;
      let h01 = crest * prof + (dunes ? 0 : (0.16 * rib + 0.05 * rib2) * u * (1 - u) * 4 * (0.35 + 0.65 * rough));
      h01 = Math.max(0, h01) * fade;
      const y = foot - (u === 0 ? 60 : 0) + L.height * h01;
      const jit = 0.92 + 0.16 * (perlin2(px / 1700 + 3.3, pz / 1700 - 1.1) * 0.5 + 0.5);
      col.push(b.v(cx + px, y, cz + pz, [forest[0] * jit, forest[1] * jit, forest[2] * jit], az * d, u, dunes ? 2 : 0, h01, hz, ex));
    }
    grid.push(col);
  }
  for (let i = 0; i < grid.length - 1; i++)
    for (let k = 0; k < K; k++) {
      const a = grid[i][k], bb = grid[i + 1][k], c = grid[i + 1][k + 1], d = grid[i][k + 1];
      b.idx.push(a, bb, c, a, c, d);
    }
}

/** a lone volcanic cone: concave flanks rising to a small flat crater rim, gullied, snow on top */
function buildVolcano(b: Builder, L: HorizonLayer, cx: number, cz: number, base: number, hz: number) {
  const D = L.dist;
  const c = (L.center ?? 0) * DEG;
  const half = (L.spread ?? 10) * DEG;
  const rough = L.rough ?? 0.5;
  const depth = Math.min(D * 0.3, L.height * 5);
  const K = 10;
  const n = 200;
  const forest = L.color ?? FOREST;
  const ex = [Math.max(800, L.height * 0.9), 0, Math.max(0.6, rough), L.snow ?? 0];
  const grid: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const az = c + (i / n - 0.5) * 2.6 * half;
    const t = Math.abs(az - c) / half;
    // the cone (concave flanks), a flat crater rim, the apron of foothills round it
    // (rough: 0 a rounded dome … 1 a steep, concave-flanked cone)
    const cone = Math.pow(Math.max(0, 1 - t), 0.5 + 1.5 * rough);
    const apron = 0.1 * Math.max(0, 1 - Math.abs(t - 0.9) / 0.45);
    const gully = perlin2(az * 60 + (L.seed ?? 0), 0.5) * 0.04 * rough * Math.min(1, t * 4);
    const crest = Math.min(0.97, Math.max(cone, apron) + gully * cone);
    const col: number[] = [];
    const sx = Math.sin(az), sz = -Math.cos(az);
    const foot = footAt(cx + sx * (D - depth), cz + sz * (D - depth), base);
    for (let k = 0; k <= K; k++) {
      const u = k / K;
      const d = D - depth * (1 - u);
      const rib = perlin2(az * 140 - 3.1, u * 3 + (L.seed ?? 0));
      const h01 = Math.max(0, crest * Math.pow(u, 1.25) + 0.03 * rib * u * (1 - u) * 4 * rough);
      const y = foot - (u === 0 ? 60 : 0) + L.height * h01;
      col.push(b.v(cx + sx * d, y, cz + sz * d, forest, az * d, u, 0, h01, hz, ex));
    }
    grid.push(col);
  }
  for (let i = 0; i < grid.length - 1; i++)
    for (let k = 0; k < K; k++) {
      const a = grid[i][k], bb = grid[i + 1][k], cc = grid[i + 1][k + 1], d = grid[i][k + 1];
      b.idx.push(a, bb, cc, a, cc, d);
    }
}

function buildCity(b: Builder, L: HorizonLayer, cx: number, cz: number, base: number, hz: number, r: () => number) {
  const D = L.dist;
  const a0 = (L.from ?? 0) * DEG;
  let a1 = (L.to ?? 360) * DEG;
  if (a1 <= a0) a1 += Math.PI * 2;
  const density = L.rough ?? 0.6;
  const depthBand = Math.min(D * 0.25, 1400);
  const centre = L.center !== undefined ? L.center * DEG : null;
  const spread = (L.spread ?? 8) * DEG;
  // back rows first so nearer blocks overdraw them (one draw call, painter's order)
  const rows = 4;
  for (let row = rows - 1; row >= 0; row--) {
    const dRow = D + (row / (rows - 1) - 0.5) * depthBand;
    let az = a0;
    while (az < a1) {
      const w = 22 + r() * 70;
      const dAz = w / dRow;
      const gap = (1 - density) * r() * 3 * dAz;
      const mid = az + dAz / 2;
      const fade = arcFade(L, mid);
      let dt = 0;
      if (centre !== null) {
        let da = mid - centre;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        dt = Math.exp(-(da * da) / (2 * spread * spread));
      }
      // mid-rise everywhere, towers in the downtown cluster; a few slabs and tall chimneys break
      // the run of similar boxes (a skyline is never a comb)
      const rr = r();
      let h = L.height * (centre !== null ? 0.12 + 0.2 * rr + dt * (0.35 + 0.65 * Math.pow(r(), 0.7)) : 0.3 + 0.7 * rr * rr * rr);
      h *= fade * (row === 0 ? 1 : 0.85 + 0.1 * row);
      if (h > 6 && r() < 0.35 + 0.65 * density) {
        const slim = dt > 0.5 && r() < 0.3;
        addBlock(b, cx, cz, mid, dRow + (r() - 0.5) * 120, w * (slim ? 0.45 : 0.75 + (dt > 0.5 ? 0.1 : 0.2) * r()), w * (0.6 + 0.8 * r()), base, h * (slim ? 1.25 : 1), r(), hz);
      }
      // low roofs between the blocks: the city's carpet, so the skyline stands on something
      if (row === 0 && fade > 0.05) addBlock(b, cx, cz, mid + dAz * 0.5, dRow - 80 - r() * 200, w * 1.8, 60, base, (6 + 10 * r()) * fade, 0.1 + 0.3 * r(), hz);
      az += dAz + gap;
    }
  }
}

function addBlock(b: Builder, cx: number, cz: number, az: number, d: number, w: number, depth: number, base: number, h: number, hash: number, hz: number) {
  const fx = Math.sin(az), fz = -Math.cos(az); // outward
  const tx = Math.cos(az), tz = Math.sin(az); // along the ring
  const px = cx + fx * d, pz = cz + fz * d;
  base = footAt(px, pz, base);
  const tone = 0.75 + 0.5 * hash;
  const glassy = hash > 0.55 && h > 60;
  // muted, weathered façades: concrete, render, brick; glass towers take the sky
  const c = glassy ? [0.1 * tone, 0.12 * tone, 0.14 * tone] : hash < 0.2 ? [0.38 * tone, 0.33 * tone, 0.28 * tone] : hash < 0.4 ? [0.3 * tone, 0.29 * tone, 0.27 * tone] : [0.34 * tone, 0.33 * tone, 0.31 * tone];
  const kind = glassy ? 4 : 3;
  const P = (s: number, q: number, y: number) => [px + tx * s * w * 0.5 + fx * q * depth * 0.5, y, pz + tz * s * w * 0.5 + fz * q * depth * 0.5] as const;
  const quad = (a: readonly number[], bb: readonly number[], cc: readonly number[], dd: readonly number[], uw: number) => {
    const i0 = b.v(a[0], a[1], a[2], c, 0, a[1] - base, kind, hash, hz);
    const i1 = b.v(bb[0], bb[1], bb[2], c, uw, bb[1] - base, kind, hash, hz);
    const i2 = b.v(cc[0], cc[1], cc[2], c, uw, cc[1] - base, kind, hash, hz);
    const i3 = b.v(dd[0], dd[1], dd[2], c, 0, dd[1] - base, kind, hash, hz);
    b.idx.push(i0, i1, i2, i0, i2, i3);
  };
  const y0 = base - 30, y1 = base + h;
  // front (facing the circuit), both sides, roof
  quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), w);
  quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), depth);
  quad(P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1), depth);
  quad(P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1), 0);
}

export function buildHorizon(
  spec: HorizonSpec,
  center: { x: number; z: number },
  groundY: number,
  ground?: { height(x: number, z: number): number; FAR: { x0: number; x1: number; z0: number; z1: number } },
): Horizon {
  const b = new Builder();
  if (ground) {
    // (clamped just inside the far terrain: beyond it, its edge's height carries on)
    const F = ground.FAR, m = 400;
    groundAt = (x, z) => ground.height(Math.min(F.x1 - m, Math.max(F.x0 + m, x)), Math.min(F.z1 - m, Math.max(F.z0 + m, z)));
  }
  // painter's order: farthest layer first
  const layers = [...spec.layers].sort((a, c) => c.dist - a.dist);
  try {
    for (const L of layers) buildLayer(b, L, center.x, center.z, groundY);
  } finally {
    groundAt = null;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(b.info, 4));
  g.setAttribute('aHaze', new THREE.Float32BufferAttribute(b.haze, 1));
  g.setAttribute('aEx', new THREE.Float32BufferAttribute(b.ex, 4));
  g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
  g.computeVertexNormals();

  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
    uSunCol: { value: new THREE.Color(4, 3.9, 3.7) },
    uSkyCol: { value: new THREE.Color(0.5, 0.6, 0.8) },
    // (the circuit centre: noise coordinates stay small, so the hashes keep their precision)
    uOrigin: { value: new THREE.Vector3(center.x, groundY, center.z) },
    // the broken-cumulus ground shadows (shared with every lit material, lightShadows.ts): the
    // same clouds dapple the far hills, the surest sign the backdrop is land under this sky
    uCloudA: { value: cloudShadowA },
    uCloudB: { value: cloudShadowB },
  };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aInfo;
attribute float aHaze;
attribute vec4 aEx;
uniform vec3 uOrigin;
varying vec4 vInfo;
varying vec4 vEx;
varying vec3 vHN;
varying vec3 vW;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
#ifdef USE_FOG
  // the ring is squeezed toward the camera: haze at the true distance
  vFogRay *= ${SQUEEZE.toFixed(1)} * aHaze;
#endif
vInfo = aInfo;
vEx = aEx;
vW = position - uOrigin;
vHN = normalize( mat3( modelMatrix ) * normal );
// behind everything in the world, in front of the sky (which sits exactly on the far plane)
gl_Position.z = gl_Position.w * 0.999995;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uOrigin;
uniform vec4 uCloudA;
uniform vec4 uCloudB;
varying vec4 vInfo;
varying vec4 vEx;
varying vec3 vHN;
varying vec3 vW;
${CLOUD_FIELD_GLSL}
float hzCloud( vec3 wp ) {
  if ( uCloudA.x <= 0.0 ) return 1.0;
  vec2 xz = wp.xz + uCloudB.xy * ( uCloudB.z - wp.y ) + uCloudA.zw;
  float wc = localCoverage( cloudField( xz ), uCloudA.y );
  float n = cf_noise( xz * ( 1.0 / 1300.0 ) ) * 0.6 + cf_noise( xz * ( 1.0 / 520.0 ) + 3.1 ) * 0.4;
  return 1.0 - uCloudA.x * smoothstep( 1.0 - wc, 1.0 - wc + 0.22, n );
}
float hh( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float vn( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hh( i ), hh( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hh( i + vec2( 0.0, 1.0 ) ), hh( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// octaves fade out as they shrink below ~2 px (no shimmer on a 30 km ridge)
// (and are not evaluated at all: most of a 20 km ring needs one or two)
float hzFbm( vec2 p, float px ) {
  float s = 0.0, a = 0.5;
  for ( int o = 0; o < 4; o++ ) {
    if ( px > 0.6 ) break;
    s += ( vn( p ) - 0.5 ) * a * ( 1.0 - smoothstep( 0.25, 0.6, px ) );
    p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 3.7;
    px *= 2.0;
    a *= 0.55;
  }
  return s / 1.009 + 0.5;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float hzFoot = 0.0;
{
  vec3 n = normalize( vHN );
  float kind = vInfo.z;
  // metres per pixel at this fragment (true scale)
  float mpp = max( length( fwidth( vW.xz ) ), 0.5 );
  if ( kind > 2.5 ) {
    // buildings: floors and window bands, glass towers reflect the sky
    float fl = fract( vInfo.y / 3.6 );
    float col = fract( vInfo.x / 3.2 );
    float win = step( 0.3, fl ) * step( 0.18, col ) * step( col, 0.82 );
    // window grids blur to an average once a floor is smaller than a pixel
    win = mix( win, 0.45, smoothstep( 1.5, 4.0, mpp ) );
    vec3 glass = mix( vec3( 0.05, 0.06, 0.07 ), uSkyCol * 0.25, 0.6 );
    float lit = hh( floor( vec2( vInfo.x / 3.2, vInfo.y / 3.6 ) ) + vInfo.w * 17.0 );
    diffuseColor.rgb = kind > 3.5 ? mix( diffuseColor.rgb, glass * ( 0.8 + 0.4 * lit ), 0.35 + 0.35 * win ) : mix( diffuseColor.rgb, glass * ( 0.7 + 0.5 * lit ), win * 0.55 );
    if ( n.y > 0.9 ) diffuseColor.rgb *= 0.8;
    // the lowest storeys sink into the city's own haze
    hzFoot = 1.0 - smoothstep( 0.0, 40.0, vInfo.y );
  } else if ( kind > 1.5 ) {
    // dunes: wind-sorted sand, darker hollows, marram tufts on the lee
    float S = vEx.x;
    float d = hzFbm( vW.xz / ( S * 0.18 ), mpp / ( S * 0.18 ) );
    float tuft = smoothstep( 0.55, 0.75, hzFbm( vW.xz / 40.0 + 7.1, mpp / 40.0 ) );
    diffuseColor.rgb *= 0.82 + 0.36 * d;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.14, 0.07 ), tuft * 0.45 * ( 1.0 - smoothstep( 0.6, 1.0, vInfo.w ) ) );
    hzFoot = 1.0 - smoothstep( 0.0, 0.6, vInfo.y );
  } else if ( kind > 0.5 ) {
    // tree line: the crowns cut per pixel against the column's height, a little ragged; the
    // trunks' dark band at the foot, sunlit tops
    float along = vInfo.x;
    float hc = vInfo.w;
    float cw = vEx.x;
    float fa = along / cw;
    float ci = floor( fa );
    float cf = fract( fa ) * 2.0 - 1.0;
    float h1 = hh( vec2( ci, 3.1 ) ), h2 = hh( vec2( ci, 8.7 ) );
    float crown = sqrt( max( 0.0, 1.0 - cf * cf ) );
    float fa2 = along / ( cw * 0.63 ) + 0.5;
    float cf2 = fract( fa2 ) * 2.0 - 1.0;
    float crown2 = sqrt( max( 0.0, 1.0 - cf2 * cf2 ) ) * ( 0.6 + 0.4 * hh( vec2( floor( fa2 ), 5.3 ) ) );
    float top = hc * ( 0.78 + 0.2 * h1 ) + cw * 0.55 * max( crown * ( 0.5 + 0.5 * h2 ), crown2 * 0.8 ) * ( 0.6 + 0.4 * vEx.z );
    // crowns narrower than ~1.5 px: a soft averaged fringe instead of aliasing teeth
    float aa = smoothstep( 0.6, 1.6, mpp / cw * 3.0 );
    top = mix( top, hc * 0.88 + cw * 0.3, aa );
    if ( vInfo.y > top ) discard;
    float t = clamp( vInfo.y / max( top, 1.0 ), 0.0, 1.0 );
    float mott = hzFbm( vec2( along / ( cw * 1.3 ), vInfo.y / ( cw * 0.9 ) ), mpp / ( cw * 1.3 ) );
    diffuseColor.rgb *= ( 0.55 + 0.45 * smoothstep( 0.0, 0.45, t ) ) * ( 0.8 + 0.45 * mott );
    // the sun catches the upper crowns
    n = normalize( n + vec3( 0.0, 0.6 * t, 0.0 ) );
    hzFoot = 1.0 - smoothstep( -10.0, hc * 0.6, vInfo.y );
  } else {
    // mountains and hills: a fragment-level relief (spurs, gullies, stands of trees) bends the
    // coarse mesh's normal; forest, pasture and fields, bare rock and snow by height, slope and noise
    float S = vEx.x;
    float fields = vEx.y;
    float rough = vEx.z;
    float snowL = vEx.w;
    float h01 = vInfo.w;
    vec2 q = vW.xz / ( S * 0.09 );
    float pxq = mpp / ( S * 0.09 );
    float r0 = hzFbm( q, pxq );
    {
      // bump from screen-space derivatives (one noise evaluation, not three): the relief as a
      // height in metres, its gradient across the pixel quad turned into a world normal tilt
      float H = r0 * S * 0.09 * ( 0.9 + 1.4 * rough );
      vec3 dpx = dFdx( vW ), dpy = dFdy( vW );
      vec3 r1 = cross( dpy, n ), r2 = cross( n, dpx );
      float det = dot( dpx, r1 );
      vec3 grad = sign( det ) * ( dFdx( H ) * r1 + dFdy( H ) * r2 );
      n = normalize( abs( det ) * n - grad );
    }
    float slope = 1.0 - n.y;
    vec3 forest = diffuseColor.rgb;
    // stands of trees: darker conifer blocks, lighter broadleaf, clearings
    float stands = hzFbm( vW.xz / 160.0 + 11.3, mpp / 160.0 );
    forest *= 0.72 + 0.6 * stands;
    vec3 c = forest;
    // pasture and fields on the gentle lower slopes (farmland venues): parcels with hedges
    if ( fields > 0.01 ) {
      float clear = smoothstep( 0.42, 0.56, hzFbm( vW.xz / 1500.0 + 4.2, mpp / 1500.0 ) + 0.25 * ( fields - 0.5 ) );
      clear *= ( 1.0 - smoothstep( 0.5, 0.85, h01 ) ) * ( 1.0 - smoothstep( 0.25, 0.5, slope ) ) * fields;
      float ang = floor( vn( vW.xz / 2600.0 ) * 4.0 ) * 0.6 + 0.3;
      vec2 fq = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) ) * vW.xz;
      vec2 cell = floor( fq / vec2( 230.0, 160.0 ) );
      vec2 ff = fract( fq / vec2( 230.0, 160.0 ) );
      float hc = hh( cell );
      vec3 fc = hc < 0.35 ? vec3( 0.075, 0.1, 0.035 ) : hc < 0.6 ? vec3( 0.1, 0.12, 0.045 ) : hc < 0.8 ? vec3( 0.19, 0.17, 0.08 ) : hc < 0.92 ? vec3( 0.15, 0.13, 0.06 ) : vec3( 0.12, 0.09, 0.06 );
      // (a dry venue's base albedo warms its fields too)
      fc *= mix( vec3( 1.0 ), clamp( forest / vec3( 0.045, 0.07, 0.035 ), 0.6, 1.7 ), 0.4 );
      float edgeW = min( 0.5, mpp / 230.0 * 1.2 + 0.03 );
      float hedge = 1.0 - smoothstep( 0.0, edgeW, min( min( ff.x, 1.0 - ff.x ), min( ff.y, 1.0 - ff.y ) * 1.4 ) );
      // parcels this small blur to their mean (no moiré from the hedges far off)
      float far = smoothstep( 25.0, 70.0, mpp );
      fc = mix( mix( fc, forest * 0.8, hedge * 0.7 ), vec3( 0.11, 0.115, 0.05 ), far );
      c = mix( c, fc, clear );
    }
    // bare rock on the high crests and the steep faces, scree streaks down the gullies
    float rockK = smoothstep( 0.42, 0.68, h01 + 0.35 * ( r0 - 0.5 ) + slope * 0.55 * rough ) * ( 0.2 + 0.8 * rough );
    vec3 rock = mix( vec3( 0.16, 0.15, 0.14 ), vec3( 0.25, 0.24, 0.22 ), stands ) * ( 0.85 + 0.3 * r0 );
    c = mix( c, rock, rockK );
    if ( snowL > 0.0 ) {
      // snow lies above the line, thinner on steep rock, longer down the gullies
      float sk = smoothstep( snowL - 0.03, snowL + 0.04, h01 + 0.22 * ( r0 - 0.5 ) - slope * 0.25 );
      c = mix( c, vec3( 0.8, 0.82, 0.86 ), sk * ( 1.0 - 0.45 * smoothstep( 0.45, 0.8, slope ) ) );
    }
    diffuseColor.rgb = c;
    // valley mist: the foot of each range sits in the air between it and the next
    hzFoot = 1.0 - smoothstep( 0.0, 0.42, vInfo.y * 0.6 + h01 * 0.6 );
  }
  float ndl = max( dot( n, uSunDir ), 0.0 );
  // soft wrap on vegetated slopes (forest canopy scatters)
  float wrap = kind < 1.5 ? max( ( dot( n, uSunDir ) + 0.3 ) / 1.3, 0.0 ) : ndl;
  float sky = 0.55 + 0.45 * n.y;
  float cloud = hzCloud( vW + uOrigin );
  diffuseColor.rgb *= uSunCol * mix( ndl, wrap, 0.5 ) * cloud * RECIPROCAL_PI + uSkyCol * sky;
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
  // layered depth: the low ground between ranges is milkier than the crests above it
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, hzFoot * 0.28 );
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-horizon-v3';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'horizon';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // after the world's opaque meshes (they are all nearer, so the depth test throws away every ring
  // pixel hidden behind trees, stands and hills before it is shaded), before the sky (10000)
  mesh.renderOrder = 5;
  const cam = new THREE.Vector3();
  const k = 1 / SQUEEZE;
  return {
    mesh,
    update(camera) {
      camera.getWorldPosition(cam);
      // world = cam + (P − cam) / SQUEEZE
      mesh.matrix.set(k, 0, 0, cam.x * (1 - k), 0, k, 0, cam.y * (1 - k), 0, 0, k, cam.z * (1 - k), 0, 0, 0, 1);
      mesh.matrixWorldNeedsUpdate = true;
    },
    setLight(l) {
      uniforms.uSunDir.value.copy(l.sunDir);
      uniforms.uSunCol.value.copy(l.sunColor);
      uniforms.uSkyCol.value.copy(l.skyAmbient);
    },
  };
}
