import * as THREE from 'three';
import { perlin2, rng } from './noise.ts';
import type { Venue } from './worldmap.ts';
import type { SceneryLight } from './scenery.ts';

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
 *   }
 *
 * Layers are drawn far → near in one draw call. The ring is compressed toward
 * the camera (so it never hits the far plane) and written at the back of the
 * depth range, so everything in the world draws over it and the sky never
 * does; its haze uses the scene's aerial fog at the layer's true distance.
 * Cost: one draw, a few thousand triangles, no shadows.
 */

export type HorizonKind = 'ridge' | 'dunes' | 'forest' | 'city';

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
      { kind: 'ridge', dist: 20000, height: 650, from: 300, to: 75, rough: 0.45, haze: 0.9, seed: 11, base: 60 },
      { kind: 'city', dist: 16000, height: 230, from: 165, to: 215, center: 188, spread: 6, rough: 0.8, seed: 5 },
      { kind: 'forest', dist: 5000, height: 40, rough: 0.5, seed: 13 },
    ],
  },
  // the Ardennes: forested ridges fold on fold
  ardennes: {
    layers: [
      { kind: 'ridge', dist: 26000, height: 420, rough: 0.35, haze: 1, seed: 21 },
      { kind: 'ridge', dist: 18000, height: 330, rough: 0.4, seed: 22 },
      { kind: 'forest', dist: 15500, height: 30, rough: 0.6, seed: 23 },
    ],
  },
  // Silverstone: gently rolling Northamptonshire, woods and hedgerow trees on every horizon
  airfield: {
    layers: [
      { kind: 'ridge', dist: 24000, height: 90, rough: 0.15, seed: 31, color: [0.07, 0.09, 0.045] },
      { kind: 'forest', dist: 6000, height: 40, rough: 0.7, seed: 32 },
      { kind: 'forest', dist: 3200, height: 28, rough: 0.8, seed: 33, from: 200, to: 80 },
    ],
  },
  // Suzuka: the Suzuka range to the west, wooded hills north, Ise Bay's coastal plain to the east
  suzuka: {
    layers: [
      { kind: 'ridge', dist: 30000, height: 1150, from: 200, to: 350, rough: 0.7, seed: 41 },
      { kind: 'ridge', dist: 18000, height: 420, from: 300, to: 60, rough: 0.5, seed: 42 },
      { kind: 'city', dist: 9000, height: 60, from: 60, to: 170, rough: 0.35, seed: 43 },
      { kind: 'forest', dist: 16000, height: 26, from: 170, to: 300, seed: 44 },
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
      { kind: 'ridge', dist: 32000, height: 400, from: 70, to: 84, rough: 0.55, seed: 65, scale: 4200 },
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
      { kind: 'ridge', dist: 42000, height: 2300, from: 250, to: 30, rough: 1, snow: 0.88, haze: 0.85, seed: 81 },
      // the Seetal Alps (Zirbitzkogel) to the south-west, a little snow on the top
      { kind: 'ridge', dist: 24000, height: 1700, from: 200, to: 250, rough: 0.7, snow: 0.93, seed: 84 },
      // the Stub-, Glein- and Koralpe south and south-east, the Fischbach Alps east: rounded, wooded
      { kind: 'ridge', dist: 26000, height: 1300, from: 60, to: 205, rough: 0.55, haze: 0.9, seed: 82 },
      // the Seckau and Wölz Tauern behind the terrain's own mountains, north-west to north-east
      { kind: 'ridge', dist: 20000, height: 1250, from: 250, to: 60, rough: 0.85, seed: 83 },
    ],
  },
  // COTA: the Texas hill country to the west, prairie tree lines (the Austin skyline itself is
  // modelled at its real distance, ~12 km NW, by venues/austinScenery.ts)
  austin: {
    layers: [
      { kind: 'ridge', dist: 30000, height: 180, from: 200, to: 340, rough: 0.25, seed: 91, color: [0.1, 0.1, 0.055] },
      { kind: 'forest', dist: 6000, height: 14, rough: 0.8, seed: 93, color: DRY },
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

class Builder {
  pos: number[] = [];
  col: number[] = [];
  info: number[] = [];
  haze: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number, c: [number, number, number], u: number, vv: number, kind: number, h: number, hz: number) {
    this.pos.push(x, y, z);
    this.col.push(c[0], c[1], c[2]);
    this.info.push(u, vv, kind, h);
    this.haze.push(hz);
    return this.pos.length / 3 - 1;
  }
}

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
  for (let o = 0; o < 5; o++) {
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
  if (L.kind === 'forest') {
    // a tree line: fine bumps (single crowns ~ 12 m) on broad masses (copses and gaps)
    const step = Math.min(1.2 * DEG, 14 / D);
    const col = L.color ?? FOREST;
    const azs = arc(L, step);
    const ox = r() * 100, oz = r() * 100;
    const rows: number[][] = [];
    for (const az of azs) {
      const [sx, sz] = dir(az);
      const fade = arcFade(L, az);
      const mass = perlin2((sx * D) / 900 + ox, (sz * D) / 900 + oz) * 0.5 + 0.5;
      const crowns = Math.abs(perlin2((sx * D) / 11 + ox, (sz * D) / 11 - oz));
      const h = L.height * fade * Math.max(0, Math.min(1, 0.25 + mass * 1.1)) * (0.72 + 0.28 * Math.sqrt(1 - crowns));
      const x = cx + sx * D, z = cz + sz * D;
      const x2 = cx + sx * (D - 60), z2 = cz + sz * (D - 60);
      const c: [number, number, number] = [col[0] * (0.85 + 0.3 * mass), col[1] * (0.85 + 0.3 * mass), col[2] * (0.9 + 0.2 * mass)];
      rows.push([b.v(x2, base - 40, z2, c, 0, 0, 1, 0, hz), b.v(x, base + h, z, c, 0, 1, 1, 1, hz)]);
    }
    for (let i = 0; i < rows.length - 1; i++) b.idx.push(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][0], rows[i + 1][1], rows[i][1]);
    return;
  }
  // ridge / dunes: a lit heightfield band from (D − depth) to the crest at D
  const dunes = L.kind === 'dunes';
  const rough = dunes ? 0.1 : (L.rough ?? 0.5);
  const scale = L.scale ?? Math.max(dunes ? 220 : 600, L.height * (dunes ? 9 : 3.5));
  const depth = Math.min(D * 0.45, Math.max(scale * 1.6, L.height * 5));
  const K = dunes ? 4 : 8;
  const step = Math.min(0.5 * DEG, scale / 10 / D);
  const azs = arc(L, step);
  const ox = r() * 100, oz = r() * 100;
  const forest = L.color ?? (dunes ? ([0.34, 0.3, 0.2] as [number, number, number]) : FOREST);
  const rock: [number, number, number] = [0.17, 0.16, 0.15];
  const snow: [number, number, number] = [0.78, 0.8, 0.84];
  const grid: number[][] = [];
  for (const az of azs) {
    const fade = arcFade(L, az);
    const [sx, sz] = dir(az);
    const col: number[] = [];
    for (let k = 0; k <= K; k++) {
      const u = k / K;
      const d = D - depth * (1 - u);
      const px = sx * d, pz = sz * d;
      // crest height along this azimuth, and the slope's own ribs and gullies
      const crest = ridgeNoise(px / scale + ox, pz / scale + oz, rough);
      const rib = perlin2(px / (scale * 0.22) - oz, pz / (scale * 0.22) + ox);
      const prof = Math.pow(u, dunes ? 0.8 : 1.25);
      let h01 = crest * prof + (dunes ? 0 : 0.14 * rib * u * (1 - u) * 4 * rough);
      h01 = Math.max(0, h01) * fade;
      const y = base - (u === 0 ? 60 : 0) + L.height * h01;
      // colour: forest low, rock high, snow on top (by absolute height fraction), ribs catch it
      let c: [number, number, number] = [forest[0], forest[1], forest[2]];
      if (!dunes) {
        const rockK = Math.max(0, Math.min(1, (h01 - 0.45 - 0.12 * rib) / 0.25)) * (0.3 + 0.7 * rough);
        c = [c[0] + (rock[0] - c[0]) * rockK, c[1] + (rock[1] - c[1]) * rockK, c[2] + (rock[2] - c[2]) * rockK];
        if (L.snow) {
          const sk = Math.max(0, Math.min(1, (h01 - L.snow - 0.08 * rib) / 0.06));
          c = [c[0] + (snow[0] - c[0]) * sk, c[1] + (snow[1] - c[1]) * sk, c[2] + (snow[2] - c[2]) * sk];
        }
      } else {
        // marram grass on the lee slopes
        const g = Math.max(0, rib) * 0.6;
        c = [c[0] * (1 - g) + 0.16 * g, c[1] * (1 - g) + 0.17 * g, c[2] * (1 - g) + 0.08 * g];
      }
      const jit = 0.9 + 0.2 * (perlin2(px / 700 + 3.3, pz / 700 - 1.1) * 0.5 + 0.5);
      col.push(b.v(cx + px, y, cz + pz, [c[0] * jit, c[1] * jit, c[2] * jit], 0, u, dunes ? 2 : 0, h01, hz));
    }
    grid.push(col);
  }
  for (let i = 0; i < grid.length - 1; i++)
    for (let k = 0; k < K; k++) {
      const a = grid[i][k], bb = grid[i + 1][k], c = grid[i + 1][k + 1], d = grid[i][k + 1];
      b.idx.push(a, bb, c, a, c, d);
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
      // mid-rise everywhere, towers in the downtown cluster
      const rr = r();
      let h = L.height * (centre !== null ? 0.12 + 0.2 * rr + dt * (0.35 + 0.65 * Math.pow(r(), 0.7)) : 0.35 + 0.65 * rr * rr);
      h *= fade * (row === 0 ? 1 : 0.85 + 0.1 * row);
      if (h > 6 && r() < 0.35 + 0.65 * density) addBlock(b, cx, cz, mid, dRow + (r() - 0.5) * 120, w * (0.75 + (dt > 0.5 ? 0.1 : 0.2) * r()), w * (0.6 + 0.8 * r()), base, h, r(), hz);
      az += dAz + gap;
    }
  }
}

function addBlock(b: Builder, cx: number, cz: number, az: number, d: number, w: number, depth: number, base: number, h: number, hash: number, hz: number) {
  const fx = Math.sin(az), fz = -Math.cos(az); // outward
  const tx = Math.cos(az), tz = Math.sin(az); // along the ring
  const px = cx + fx * d, pz = cz + fz * d;
  const tone = 0.75 + 0.5 * hash;
  const glassy = hash > 0.55 && h > 60;
  const c: [number, number, number] = glassy ? [0.1 * tone, 0.125 * tone, 0.15 * tone] : hash < 0.2 ? [0.42 * tone, 0.36 * tone, 0.3 * tone] : [0.34 * tone, 0.33 * tone, 0.31 * tone];
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

export function buildHorizon(spec: HorizonSpec, center: { x: number; z: number }, groundY: number): Horizon {
  const b = new Builder();
  // painter's order: farthest layer first
  const layers = [...spec.layers].sort((a, c) => c.dist - a.dist);
  for (const L of layers) buildLayer(b, L, center.x, center.z, groundY);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(b.info, 4));
  g.setAttribute('aHaze', new THREE.Float32BufferAttribute(b.haze, 1));
  g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
  g.computeVertexNormals();

  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
    uSunCol: { value: new THREE.Color(4, 3.9, 3.7) },
    uSkyCol: { value: new THREE.Color(0.5, 0.6, 0.8) },
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
varying vec4 vInfo;
varying vec3 vHN;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
#ifdef USE_FOG
  // the ring is squeezed toward the camera: haze at the true distance
  vFogRay *= ${SQUEEZE.toFixed(1)} * aHaze;
#endif
vInfo = aInfo;
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
varying vec4 vInfo;
varying vec3 vHN;
float hh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 n = normalize( vHN );
  float kind = vInfo.z;
  if ( kind > 2.5 ) {
    // buildings: floors and window bands, glass towers reflect the sky
    float fl = fract( vInfo.y / 3.6 );
    float col = fract( vInfo.x / 3.2 );
    float win = step( 0.3, fl ) * step( 0.18, col ) * step( col, 0.82 );
    vec3 glass = mix( vec3( 0.05, 0.06, 0.07 ), uSkyCol * 0.25, 0.6 );
    float lit = hh( floor( vec2( vInfo.x / 3.2, vInfo.y / 3.6 ) ) + vInfo.w * 17.0 );
    diffuseColor.rgb = kind > 3.5 ? mix( diffuseColor.rgb, glass * ( 0.8 + 0.4 * lit ), 0.35 + 0.35 * win ) : mix( diffuseColor.rgb, glass * ( 0.7 + 0.5 * lit ), win * 0.55 );
    if ( n.y > 0.9 ) diffuseColor.rgb *= 0.8;
  }
  float ndl = max( dot( n, uSunDir ), 0.0 );
  // soft wrap on vegetated slopes (forest canopy scatters)
  float wrap = kind < 1.5 ? max( ( dot( n, uSunDir ) + 0.3 ) / 1.3, 0.0 ) : ndl;
  float sky = 0.55 + 0.45 * n.y;
  diffuseColor.rgb *= uSunCol * mix( ndl, wrap, 0.5 ) * RECIPROCAL_PI + uSkyCol * sky;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-horizon-v1';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'horizon';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -5;
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
