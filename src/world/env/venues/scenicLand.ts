import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, lerp, ridged2, smoothstep } from '../noise.ts';
import { hungaroringInside as insideLap } from './hungaroringLand.ts';

/**
 * The land of the scenic circuits (circuits/scenic.ts): three places built round wherever the lap
 * lies, in the circuit's frame (x = east, z = south, heights relative to s = 0 of the lap).
 *
 *  riviera  Capo Serena: a headland. The sea wraps the east and south of the lap ~40 m below the
 *           clifftop road, a promontory with the lighthouse past Faro, a cove and a harbour village
 *           to the north-east; inland the hills climb steeply to the Ligurian-style mountains, olive
 *           terraces, umbrella pines and cypresses.
 *  alpine   Bergsee: the floor of a glacial valley. The lake runs the length of the valley along the
 *           pit straight; the walls rise 2 000–2 600 m to rock and snow, spruce and larch up to the
 *           treeline, hay meadows and two villages on the floor.
 *  canyon   Red Mesa: a high desert valley. A sandstone escarpment walls the west, buttes and mesas
 *           stand out of the plain all round, and the lap drops into a wash cut 30 m into the floor.
 *
 * Sharp features (sea cliffs, mesa walls, the wash's rims) are applied exactly by `scenicCarve`, on
 * top of the smooth land the 32 m natural grid holds, so they keep their edges at every resolution.
 */

export type ScenicVenue = 'riviera' | 'alpine' | 'canyon';

export const SCENIC_VENUE: Record<string, ScenicVenue> = { serena: 'riviera', bergsee: 'alpine', redmesa: 'canyon' };

/** the sea's surface (Capo Serena) and the lake's (Bergsee), world y */
export const RIVIERA_SEA = -38;
export const ALPINE_LAKE = -2.2;

// ------------------------------------------------------------------------------------------ shared

/** compass bearing (deg, 0 = north = −z, 90 = east) of (x, z) from the circuit's centre */
function bearing(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  const b = (Math.atan2(x - c.x, -(z - c.z)) * 180) / Math.PI;
  return b < 0 ? b + 360 : b;
}

/** the lap's outline in polar form round its centre: the farthest point of the road in each degree */
const polarCache = new WeakMap<WorldMap, Float32Array>();
function trackRadius(map: WorldMap, b: number): number {
  let R = polarCache.get(map);
  if (!R) {
    const t = map.track, c = map.A.center;
    const raw = new Float32Array(360).fill(0);
    for (let i = 0; i < t.n; i += 2) {
      const dx = t.px[i] - c.x, dz = t.pz[i] - c.z;
      let a = (Math.atan2(dx, -dz) * 180) / Math.PI;
      if (a < 0) a += 360;
      const k = Math.floor(a) % 360;
      raw[k] = Math.max(raw[k], Math.hypot(dx, dz));
    }
    // a road seen from its centre covers every degree, but fill any gap and take the max over ±4°
    R = new Float32Array(360);
    for (let k = 0; k < 360; k++) {
      let m = 0;
      for (let d = -4; d <= 4; d++) m = Math.max(m, raw[(k + d + 360) % 360]);
      R[k] = m;
    }
    polarCache.set(map, R);
  }
  const f = b - Math.floor(b), k = Math.floor(b) % 360;
  return lerp(R[k], R[(k + 1) % 360], f);
}

/** angular distance (deg) */
const adiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// ------------------------------------------------------------------------------------------ riviera

/** the sea arc (compass degrees): east round to south-south-west */
const SEA_FROM = 18, SEA_TO = 238;

/** 0 = land side of the cape … 1 = sea side, by bearing */
function seaSide(b: number): number {
  // (the arc runs clockwise from SEA_FROM to SEA_TO)
  const inArc = ((b - SEA_FROM + 360) % 360) <= ((SEA_TO - SEA_FROM + 360) % 360);
  const d = Math.min(adiff(b, SEA_FROM), adiff(b, SEA_TO));
  return inArc ? smoothstep(0, 22, d) : 0;
}

/** the lighthouse promontory past Faro, and the harbour cove north-east of the line (circuit frame) */
export interface RivieraSpots {
  cape: { x: number; z: number; b: number };
  cove: { x: number; z: number; b: number };
  village: { x: number; z: number; r: number };
  hillTown: { x: number; z: number; r: number };
}
const spotCache = new WeakMap<WorldMap, RivieraSpots>();
export function rivieraSpots(map: WorldMap): RivieraSpots {
  let s = spotCache.get(map);
  if (s) return s;
  const c = map.A.center, bb = map.A.bb;
  // the cape: out past the south-east corner of the lap (Faro)
  const capeB = bearing(map, bb.x1 + 120, bb.z1 + 120);
  // (the lighthouse stands near the end of the promontory, a few tens of metres back from the edge)
  const capeR = trackRadius(map, capeB) + 112 + 46 * fbm2(capeB / 9 + 3.7, 0.4, 3) + 260 - 55;
  const cape = { x: c.x + Math.sin((capeB * Math.PI) / 180) * capeR, z: c.z - Math.cos((capeB * Math.PI) / 180) * capeR, b: capeB };
  // the cove: north-east, where the coast turns inland
  const coveB = 34;
  const coveR = trackRadius(map, coveB) + 190;
  const cove = { x: c.x + Math.sin((coveB * Math.PI) / 180) * coveR, z: c.z - Math.cos((coveB * Math.PI) / 180) * coveR, b: coveB };
  s = {
    cape,
    cove,
    // the harbour village climbs the slope above the cove; a hill town on the ridge to the north-west
    village: { x: cove.x - 260, z: cove.z - 300, r: 420 },
    hillTown: { x: c.x - 1500, z: c.z - 1900, r: 380 },
  };
  spotCache.set(map, s);
  return s;
}

const sbCache = new WeakMap<WorldMap, number>();
/** the bearing of the middle of the pit straight from the lap's centre */
function straightBearing(map: WorldMap): number {
  let b = sbCache.get(map);
  if (b === undefined) {
    const t = map.track, s = (t.pit.sStart + t.pit.sEnd) / 2, i = Math.floor(s) % t.n;
    b = bearing(map, t.px[i], t.pz[i]);
    sbCache.set(map, b);
  }
  return b;
}

/** how far out from the road the cliff edge runs (m), by bearing: points, coves, the cape */
function coastGap(map: WorldMap, b: number, x: number, z: number): number {
  const sp = rivieraSpots(map);
  let g = 112 + 46 * fbm2(b / 9 + 3.7, 0.4, 3) + 22 * fbm2(x / 140 - 1.3, z / 140 + 2.2, 2);
  g += 260 * Math.exp(-((adiff(b, sp.cape.b) / 7) ** 2));
  // the harbour cove bites in a little (but never toward the road: the gap stays ≥ 80 m)
  g -= 30 * Math.exp(-((adiff(b, sp.cove.b) / 6) ** 2));
  // room for the main grandstand on the clifftop beside the pit straight
  g += 70 * Math.exp(-((adiff(b, straightBearing(map)) / 16) ** 2));
  return Math.max(84, g);
}

/** signed distance (m) seaward of the cliff edge (negative inland), ±∞ off the sea arc */
export function rivieraCoast(map: WorldMap, x: number, z: number): number {
  const b = bearing(map, x, z);
  const w = seaSide(b);
  if (w < 0.002) return -1e5;
  const c = map.A.center;
  const r = Math.hypot(x - c.x, z - c.z);
  const Rc = trackRadius(map, b) + coastGap(map, b, x, z) / Math.max(w, 0.002) + (1 - w) * 400;
  // the lap's own infield is never sea
  if (r < Rc - 600) return r - Rc;
  return (r - Rc) * (1 - insideLap(map, x, z));
}

function rivieraRegional(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  const X = x - c.x, Z = z - c.z;
  // inland = toward the north-west
  const u = X * -0.62 + Z * -0.78;
  const R = Math.hypot(X, Z);
  let h = 6 + 8 * fbm2(X / 900 + 1.3, Z / 900 - 0.6, 3);
  // the coastal hills, then the mountains (to ~900 m) a few kilometres inland
  const rise = smoothstep(-300, 2600, u);
  const rid = ridged2(X / 2100 + 0.7, Z / 2100 - 2.9, 5, 2.05, 0.5);
  const mass = 0.7 + 0.4 * (fbm2(X / 5200 + 3.3, Z / 5200 + 0.7, 3) * 0.5 + 0.5);
  h += rise * (60 + 420 * rid * mass) + smoothstep(1500, 6000, u) * (380 * mass + 260 * rid * rid);
  // valleys running down to the sea between the spurs
  const v = fbm2(X / 1800 - 4.1, Z / 1800 + 2.6, 3);
  h -= rise * 140 * (1 - smoothstep(0, 0.16, Math.abs(v))) * smoothstep(400, 1800, u);
  // the cape's spine: a low ridge behind the lap so the land rises away from the road
  h += smoothstep(200, 1100, R) * (1 - rise) * 22 * (fbm2(X / 600, Z / 600 + 7.7, 2) * 0.5 + 0.6);
  return h;
}

function rivieraNatural(map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  const reg = rivieraRegional(map, x, z);
  const near = 1 - smoothstep(110, 520, dT);
  // terraces: the hillsides are stepped (olive terraces, dry-stone walls) — gentle steps, 3–4 m
  let h = lerp(reg, platform, near);
  const ter = smoothstep(120, 320, dT) * smoothstep(25, 60, h - platform);
  if (ter > 0) {
    const step = 3.6;
    const q = h / step;
    const f = q - Math.floor(q);
    h = lerp(h, (Math.floor(q) + smoothstep(0.3, 0.95, f)) * step, ter * 0.45);
  }
  const bumps = (0.35 + 0.65 * smoothstep(30, 240, dT)) * (0.8 * fbm2(x / 320 + 2.3, z / 320 - 4.1, 3) + 0.15 * fbm2(x / 70 - 3.3, z / 70 + 1.9, 2));
  // the cape's tip rises a little (the lighthouse knoll)
  const sp = rivieraSpots(map);
  const dc = Math.hypot(x - sp.cape.x, z - sp.cape.z);
  return h + bumps + 9 * (1 - smoothstep(30, 150, dc));
}

/** the cliffs: the clifftop runs out to the edge, then a rock face drops to a ledge, the sea and the bed */
function rivieraCarve(map: WorldMap, x: number, z: number, h: number): number {
  const cd = rivieraCoast(map, x, z);
  if (cd < -40) return h;
  // a ragged edge: buttresses and gullies along the face, a few sea stacks off the points
  const jag = 7 * fbm2(x / 38 + 0.3, z / 38 - 1.7, 3) + 3 * fbm2(x / 11, z / 11, 2);
  const e = cd + jag;
  const sea = RIVIERA_SEA;
  // the face: steep, with a ledge of fallen rock at its foot just above the water
  const top = h;
  const ledge = sea + 1.2 + 2.5 * (fbm2(x / 30 - 2.2, z / 30 + 4.4, 2) * 0.5 + 0.5);
  const face = smoothstep(-4, 16, e);
  let y = lerp(top, ledge, face);
  // then the sea bed shelving away
  y = lerp(y, sea - 4 - 30 * smoothstep(40, 420, e), smoothstep(16, 34, e));
  // sea stacks: rock pillars standing off the cliff (only just offshore)
  const st = fbm2(x / 40 + 9.1, z / 40 - 3.3, 2) + 0.09 * fbm2(x / 9 - 2.2, z / 9 + 1.7, 2);
  if (e > 22 && e < 110 && st > 0.5) y = Math.max(y, sea + (18 + 26 * (fbm2(x / 90, z / 90 + 3.3, 2) * 0.5 + 0.5)) * smoothstep(0.5, 0.56, st) * (1 - smoothstep(70, 110, e)) + 4 * fbm2(x / 9, z / 9, 2));
  return Math.min(h, y);
}

function rivieraUrban(map: WorldMap, x: number, z: number): number {
  const sp = rivieraSpots(map);
  const n = fbm2(x / 260 + 7.3, z / 260 - 3.9, 3) * 0.5 + 0.5;
  let u = 0;
  for (const T of [sp.village, sp.hillTown]) {
    const d = Math.hypot(x - T.x, z - T.z);
    if (d > T.r * 1.4) continue;
    u = Math.max(u, 1 - smoothstep(T.r * 0.3, T.r * 1.1, d + (n - 0.5) * T.r * 0.6));
  }
  // not in the sea, not on the circuit
  u *= 1 - smoothstep(-90, -30, rivieraCoast(map, x, z));
  u *= smoothstep(120, 220, map.distToTrack(x, z));
  return clamp(smoothstep(0.3, 0.6, u), 0, 1);
}

function rivieraForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 420 + 11.3, z / 420 - 7.7, 4);
  const n2 = fbm2(x / 140 - 2.3, z / 140 + 6.1, 3);
  const c = map.A.center;
  const u = (x - c.x) * -0.62 + (z - c.z) * -0.78;
  // pine woods and macchia on the hills, olive groves (open, regular) on the terraces, open
  // grass on the clifftops by the road
  let f = smoothstep(0.5, 0.56, 0.42 + 0.36 * n1 + 0.14 * n2 + 0.2 * smoothstep(0, 2200, u)) * 0.92;
  f *= smoothstep(34, 90, dT);
  // nothing grows on the cliff face or in the sea
  f *= 1 - smoothstep(-55, -18, rivieraCoast(map, x, z));
  f *= map.clearingKeep(x, z);
  f *= 1 - smoothstep(0.15, 0.45, rivieraUrban(map, x, z)) * 0.8;
  return f < 0.12 ? 0 : clamp(f, 0, 1);
}

// ------------------------------------------------------------------------------------------ alpine

/** the valley: its axis runs north–south through the lap; the lake fills its west side */
function alpineFrame(map: WorldMap, x: number, z: number) {
  const bb = map.A.bb;
  // the lake's east shore follows the pit straight (the lap's west edge), a little out from the wall
  const X = x - bb.x0, Z = z - (bb.z0 + bb.z1) / 2;
  return { X, Z };
}

/** the lake's shores in the valley frame: east / west shore X at Z, the south end's Z at X */
function lakeShores(Z: number, X: number) {
  return {
    east: -110 - 30 * (fbm2(Z / 420 + 2.1, 0.3, 3) * 0.5 + 0.5) - 160 * smoothstep(900, 2600, -Z),
    west: -1350 + 140 * fbm2(Z / 900 - 1.2, 4.4, 3),
    south: 980 + 120 * fbm2(X / 500 + 3.3, 1.1, 2),
    north: -7400,
  };
}

/** signed distance (m) into the lake (negative on land) */
export function alpineLake(map: WorldMap, x: number, z: number): number {
  const { X, Z } = alpineFrame(map, x, z);
  // the shore wanders a little; the lake is ~1.3 km wide and 9 km long, its south end just past
  // Seekurve, its north end far up the valley
  const L = lakeShores(Z, X);
  const dx = Math.min(L.east - X, X - L.west);
  const dz = Math.min(L.south - Z, Z - L.north);
  const d = Math.min(dx, dz);
  // the road keeps its gravel and barriers dry
  const dT = map.distToTrack(x, z);
  return Math.min(d, dT - 70);
}

/** the lake's outline (world), pushed `margin` m out under the land so the banks decide the waterline */
export function alpineLakeOutline(map: WorldMap, margin: number): { x: number; z: number }[] {
  const bb = map.A.bb, z0 = (bb.z0 + bb.z1) / 2;
  const out: { x: number; z: number }[] = [];
  const N = -7400 - margin, S = 1100 + margin;
  // down the east shore, across the south end, up the west shore
  for (let Z = N; Z < S; Z += 40) out.push({ x: bb.x0 + lakeShores(Z, 0).east + margin, z: z0 + Z });
  out.push({ x: bb.x0 + lakeShores(S, 0).east + margin, z: z0 + S });
  out.push({ x: bb.x0 + lakeShores(S, 0).west - margin, z: z0 + S });
  for (let Z = S - 40; Z > N; Z -= 40) out.push({ x: bb.x0 + lakeShores(Z, 0).west - margin, z: z0 + Z });
  out.push({ x: bb.x0 + lakeShores(N, 0).west - margin, z: z0 + N });
  return out;
}

function alpineRegional(map: WorldMap, x: number, z: number): number {
  const { X, Z } = alpineFrame(map, x, z);
  const lap = map.A.bb.x1 - map.A.bb.x0;
  // the valley floor: from the far lake shore (X ≈ −1 400) to ~800 m east of the lap
  const wd = X < 0 ? -X - 1450 : X - (lap + 850);
  const wall = Math.max(0, wd + 160 * fbm2(Z / 1400 + 1.7, X / 1400, 3));
  let h = 6 + 4 * fbm2(x / 700 + 1.3, z / 700 - 0.6, 3);
  // the moraine: the lap's east side climbs a long wooded rise
  h += smoothstep(lap * 0.35, lap * 0.9, X) * (1 - smoothstep(lap + 300, lap + 900, X)) * 26 * (0.7 + 0.3 * fbm2(z / 600, 2.2, 2));
  // the valley walls: steep at the foot, rising to rock and snow; spurs and side valleys
  const rid = ridged2(x / 2300 + 0.7, z / 2300 - 2.9, 5, 2.1, 0.52);
  const peaks = Math.pow(fbm2(x / 3400 - 2.2, z / 3400 + 7.4, 3) * 0.5 + 0.5, 1.6);
  const prof = 1 - Math.exp(-wall / 1500);
  let mtn = prof * (1500 + 900 * rid + 700 * peaks) + Math.min(wall, 300) * 0.35;
  // side valleys cut back into the walls
  const sv = fbm2(Z / 2600 + 3.1, Math.sign(X) * 2.3, 2);
  mtn *= 1 - 0.45 * (1 - smoothstep(0, 0.2, Math.abs(sv))) * smoothstep(300, 1600, wall) * (1 - smoothstep(4500, 9000, wall));
  h += mtn;
  // the valley closes in a cirque to the north and opens toward the south
  const northEnd = smoothstep(-6500, -10500, Z);
  h += northEnd * (1300 + 700 * rid);
  h -= smoothstep(2500, 9000, Z) * smoothstep(0, 600, wall) * 300;
  return h;
}

function alpineNatural(map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  const reg = alpineRegional(map, x, z);
  const near = 1 - smoothstep(110, 480, dT);
  const h = lerp(reg, platform, near);
  const bumps = (0.3 + 0.7 * smoothstep(30, 240, dT)) * (2.4 * fbm2(x / 220 + 2.3, z / 220 - 4.1, 3) + 0.8 * fbm2(x / 60 - 3.3, z / 60 + 1.9, 2));
  return h + bumps;
}

function alpineCarve(map: WorldMap, x: number, z: number, h: number): number {
  const d = alpineLake(map, x, z);
  if (d < -30) return h;
  // a narrow shingle beach, then the bed shelving off steeply (a glacial lake is deep)
  const shore = ALPINE_LAKE + 0.4 - 2.2 * smoothstep(-6, 10, d);
  const bed = ALPINE_LAKE - 3 - 70 * smoothstep(20, 500, d);
  const y = lerp(shore, bed, smoothstep(6, 40, d));
  return Math.min(h, lerp(h, y, smoothstep(-30, 0, d)));
}

const ALPINE_TOWNS = [
  // the lake village at the south shore, a hamlet on the moraine north-east, the next village up the valley
  { dx: 300, dz: 1550, r: 430 },
  { dx: 1700, dz: -1500, r: 260 },
  { dx: 600, dz: -3600, r: 380 },
];
function alpineUrban(map: WorldMap, x: number, z: number): number {
  const bb = map.A.bb;
  const n = fbm2(x / 260 + 7.3, z / 260 - 3.9, 3) * 0.5 + 0.5;
  let u = 0;
  for (const T of ALPINE_TOWNS) {
    const d = Math.hypot(x - (bb.x0 + T.dx), z - ((bb.z0 + bb.z1) / 2 + T.dz));
    if (d > T.r * 1.4) continue;
    u = Math.max(u, 1 - smoothstep(T.r * 0.3, T.r * 1.1, d + (n - 0.5) * T.r * 0.6));
  }
  u *= 1 - smoothstep(-40, 0, alpineLake(map, x, z));
  u *= smoothstep(130, 230, map.distToTrack(x, z));
  return clamp(smoothstep(0.3, 0.6, u), 0, 1);
}

/** height above the valley floor where the forest thins out (m) */
const TREELINE = 850;

function alpineForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 480 + 11.3, z / 480 - 7.7, 4);
  const n2 = fbm2(x / 150 - 2.3, z / 150 + 6.1, 3);
  const reg = alpineRegional(map, x, z);
  // the slopes are forest from the foot to the treeline (avalanche tracks and pastures cut into it);
  // the floor is hay meadow with copses and trees along the streams and the shore
  const slope = smoothstep(30, 120, reg);
  let f = slope * smoothstep(0.3, 0.45, 0.5 + 0.3 * n1 + 0.15 * n2) * (1 - smoothstep(TREELINE - 150, TREELINE + 120 + 200 * n1, reg));
  const copse = smoothstep(0.62, 0.7, fbm2(x / 300 + 1.9, z / 300 - 4.4, 3) * 0.5 + 0.5 + 0.08 * n2) * 0.85;
  f = Math.max(f, copse * (1 - slope * 0.5));
  // the moraine behind the climb is wooded right down to the fences
  const bb = map.A.bb;
  const mor = smoothstep((bb.x1 - bb.x0) * 0.4, (bb.x1 - bb.x0) * 0.75, x - bb.x0) * smoothstep(0.35, 0.5, 0.5 + 0.35 * n1);
  f = Math.max(f, mor * 0.95);
  f *= smoothstep(30, 80, dT);
  f *= 1 - smoothstep(-25, 0, alpineLake(map, x, z));
  f *= map.clearingKeep(x, z);
  f *= 1 - smoothstep(0.12, 0.4, alpineUrban(map, x, z));
  return f < 0.2 ? 0 : clamp(f, 0, 1);
}

// ------------------------------------------------------------------------------------------ canyon

/** the buttes and mesas: centre offset from the circuit's centre (m), radius of the top, height */
const BUTTES: { x: number; z: number; r: number; h: number; e?: number }[] = [
  // the lone butte beside the long left-hander, and its fallen twin
  { x: -60, z: -1460, r: 120, h: 150 },
  // the infield butte the lap runs round, and the spire across the main straight
  { x: 80, z: -250, r: 105, h: 125, e: 1.4 },
  { x: 1100, z: 300, r: 70, h: 135 },
  { x: -1500, z: 1500, r: 160, h: 150, e: 0.8 },
  { x: 420, z: -1700, r: 50, h: 95 },
  // across the plain to the east and north
  { x: 2300, z: -900, r: 380, h: 210, e: 1.6 },
  { x: 1900, z: 1500, r: 160, h: 175 },
  { x: 3500, z: 2900, r: 650, h: 260, e: 0.7 },
  { x: 4800, z: -500, r: 520, h: 300, e: 1.3 },
  { x: 900, z: -3600, r: 700, h: 240, e: 2.1 },
  { x: -1500, z: -3200, r: 260, h: 190 },
  { x: 2600, z: -3900, r: 85, h: 170 },
  { x: 3100, z: 900, r: 70, h: 140 },
  { x: -400, z: 3600, r: 480, h: 220, e: 1.8 },
  { x: 1100, z: 2700, r: 110, h: 130 },
  { x: 6500, z: 3800, r: 900, h: 330, e: 0.6 },
  { x: -5000, z: 5600, r: 1100, h: 300 },
  { x: 7600, z: -4200, r: 1300, h: 360, e: 1.4 },
];

/** the escarpment: the rim of the high mesa that walls the valley's west side (x of the rim at z) */
function rimX(c: { x: number; z: number }, z: number): number {
  const Z = z - c.z;
  return c.x - 2400 - 650 * fbm2(Z / 2300 + 2.2, 0.7, 3) - 260 * fbm2(Z / 620, 3.1, 2) - 90 * fbm2(Z / 170, 7.7, 2) + 0.12 * Math.max(0, Z);
}

/** the wash: a dry channel that the lap drops into, running away south-west */
const WASH = [
  [-260, 1700],
  [-500, 1250],
  [-700, 870],
  [-1180, 560],
  [-1800, 1300],
  [-2350, 2350],
  [-2900, 3600],
  [-3600, 5200],
];
function washDist(c: { x: number; z: number }, x: number, z: number): { d: number; t: number } {
  let best = 1e9, bt = 0, acc = 0;
  for (let i = 0; i < WASH.length - 1; i++) {
    const ax = c.x + WASH[i][0], az = c.z + WASH[i][1];
    const bx = c.x + WASH[i + 1][0], bz = c.z + WASH[i + 1][1];
    const vx = bx - ax, vz = bz - az;
    const L = Math.hypot(vx, vz);
    const u = clamp(((x - ax) * vx + (z - az) * vz) / (L * L), 0, 1);
    const d = Math.hypot(x - ax - vx * u, z - az - vz * u);
    if (d < best) (best = d), (bt = acc + u * L);
    acc += L;
  }
  return { d: best, t: bt };
}

function canyonRegional(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  const X = x - c.x, Z = z - c.z;
  // the valley floor: nearly flat, slickrock swells and low benches
  let h = 3 * fbm2(X / 1200 + 1.3, Z / 1200 - 0.6, 3) + 1.2 * fbm2(X / 300, Z / 300, 2);
  // the floor falls gently toward the wash
  h -= 6 * smoothstep(0, 2500, -X + Z * 0.5);
  // beyond the escarpment the land is the high mesa top, rolling slightly
  const rx = rimX(c, z);
  if (x < rx + 400) h = lerp(h, 220 + 25 * fbm2(X / 1600, Z / 1600 + 3.3, 3), smoothstep(rx + 400, rx - 400, x) * 0.15);
  // far out the plain rises in long benches toward the horizon
  const R = Math.hypot(X, Z);
  h += smoothstep(4000, 12000, R) * 80 * (fbm2(X / 5000 + 7.7, Z / 5000 - 4.2, 3) * 0.5 + 0.5);
  return h;
}

function canyonNatural(map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  const reg = canyonRegional(map, x, z);
  const near = 1 - smoothstep(100, 460, dT);
  const bumps = (0.3 + 0.7 * smoothstep(30, 240, dT)) * (1.6 * fbm2(x / 180 + 2.3, z / 180 - 4.1, 3) + 0.5 * fbm2(x / 50 - 3.3, z / 50 + 1.9, 2));
  return lerp(reg, platform, near) + bumps;
}

/** sharp rock: the escarpment, the buttes (flat cap, sheer wall, talus apron) and the wash's rims */
function canyonCarve(map: WorldMap, x: number, z: number, h: number): number {
  const c = map.A.center;
  const dT = map.distToTrack(x, z);
  // keep everything off the circuit: the road's own blend zone stays as the platform made it
  const keep = smoothstep(70, 150, dT);
  let y = h;
  if (keep > 0) {
    // the escarpment: a 200 m wall with a bench half way (the Kayenta ledge) and talus at the foot
    const rx = rimX(c, z) + 14 * fbm2(z / 60, x / 60, 2);
    const e = rx - x;
    if (e > -260) {
      const talus = smoothstep(-260, 0, e) * 70;
      const lower = smoothstep(-6, 4, e) * 95;
      const bench = smoothstep(40, 52, e) * 105;
      y = Math.max(y, h + (talus + lower + bench) * keep);
    }
    for (const B of BUTTES) {
      const bx = c.x + B.x, bz = c.z + B.z;
      const dx = x - bx, dz = z - bz;
      const ex = B.e ?? 1;
      // elongated mesas (e ≠ 1), a ragged outline
      const ang = Math.atan2(dz, dx);
      const rr = Math.hypot(dx * Math.sqrt(ex), dz / Math.sqrt(ex));
      const R = B.r * (1 + 0.16 * Math.sin(ang * 3 + B.x) + 0.1 * Math.sin(ang * 7 + B.z) + 0.06 * fbm2(dx / 40, dz / 40, 2));
      if (rr > R + B.h * 1.6) continue;
      // the cap (slightly domed), the wall (vertical, with a break two-thirds down), the talus cone
      const wall = smoothstep(R + 5, R - 3, rr);
      const cone = (1 - smoothstep(R, R + B.h * 1.5, rr)) * B.h * 0.42;
      const step = smoothstep(R + 30, R + 18, rr) * B.h * 0.12;
      const top = B.h * (1 + 0.02 * (1 - rr / Math.max(R, 1)));
      const by = Math.max(cone + step, top * wall);
      y = Math.max(y, h + by * keep);
    }
  }
  // the wash: a flat sandy bed between low ledges, deepening downstream
  const w = washDist(c, x, z);
  const wd = w.d + 10 * fbm2(x / 70, z / 70 + 5.5, 2);
  if (wd < 70) {
    const depth = 7 + smoothstep(1500, 6000, w.t) * 22;
    const bed = h - depth * (1 - smoothstep(26, 60, wd));
    y = Math.min(y, lerp(h, bed, keep));
  }
  return y;
}

/**
 * Where rock has fallen from the walls (scenicScenery.ts piles boulders and slabs there): the foot
 * of every butte and mesa within `reach` m of the circuit's centre, and of the escarpment. Each
 * spot: position, outward direction (yaw, rad), how far out from the wall (m) and the wall's height.
 */
export function canyonWallFeet(map: WorldMap, reach: number, step: number, rand: () => number): { x: number; z: number; out: number; d: number; wallH: number }[] {
  const c = map.A.center;
  const out: { x: number; z: number; out: number; d: number; wallH: number }[] = [];
  for (const B of BUTTES) {
    if (Math.hypot(B.x, B.z) - B.r > reach) continue;
    const ex = B.e ?? 1;
    const n = Math.ceil((2 * Math.PI * B.r * Math.max(ex, 1 / ex)) / step);
    for (let k = 0; k < n; k++) {
      const ang = rand() * Math.PI * 2;
      const R = B.r * (1 + 0.16 * Math.sin(ang * 3 + B.x) + 0.1 * Math.sin(ang * 7 + B.z));
      const d = 2 + Math.pow(rand(), 1.8) * B.h * 0.75;
      // (rr is measured in the mesa's squashed frame: back out to the world)
      const rr = R + d;
      const x = c.x + B.x + (Math.cos(ang) * rr) / Math.sqrt(ex), z = c.z + B.z + Math.sin(ang) * rr * Math.sqrt(ex);
      out.push({ x, z, out: Math.atan2(Math.cos(ang) / Math.sqrt(ex), Math.sin(ang) * Math.sqrt(ex)), d, wallH: B.h });
    }
  }
  for (let z = c.z - reach; z < c.z + reach; z += step) {
    const zz = z + (rand() - 0.5) * step;
    const rx = rimX(c, zz) + 14 * fbm2(zz / 60, rimX(c, zz) / 60, 2);
    const d = 3 + Math.pow(rand(), 1.8) * 120;
    out.push({ x: rx + d, z: zz, out: Math.PI / 2, d, wallH: 95 });
  }
  return out;
}

function canyonForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 300 + 11.3, z / 300 - 7.7, 3);
  // pinyon–juniper scatter: in loose stands, bare sand between them, thicker along the wash
  let f = 0.14 * smoothstep(0.05, 0.45, n1);
  const c = map.A.center;
  const w = washDist(c, x, z);
  f += 0.25 * (1 - smoothstep(20, 120, w.d));
  f *= smoothstep(26, 60, dT);
  f *= map.clearingKeep(x, z);
  return clamp(f, 0, 1);
}

// ------------------------------------------------------------------------------------------ dispatch

export function scenicPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  // (the cape and the desert are open country right out: no hedged farm parcels near the lap)
  const m = map.scenic === 'alpine' ? 420 : 1300;
  return { cx: center.x, cz: center.z, rx: (bb.x1 - bb.x0) / 2 + m, rz: (bb.z1 - bb.z0) / 2 + m };
}

export function scenicNatural(v: ScenicVenue, map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  if (v === 'riviera') return rivieraNatural(map, x, z, platform, dT);
  if (v === 'alpine') return alpineNatural(map, x, z, platform, dT);
  return canyonNatural(map, x, z, platform, dT);
}

/** the exact sharp features over the smooth land (applied once, after the 32 m grid's smoothing) */
export function scenicCarve(v: ScenicVenue, map: WorldMap, x: number, z: number, h: number): number {
  if (v === 'riviera') return rivieraCarve(map, x, z, h);
  if (v === 'alpine') return alpineCarve(map, x, z, h);
  return canyonCarve(map, x, z, h);
}

export function scenicUrban(v: ScenicVenue, map: WorldMap, x: number, z: number): number {
  if (v === 'riviera') return rivieraUrban(map, x, z);
  if (v === 'alpine') return alpineUrban(map, x, z);
  return 0;
}

export function scenicForest(v: ScenicVenue, map: WorldMap, x: number, z: number): number {
  if (v === 'riviera') return rivieraForest(map, x, z);
  if (v === 'alpine') return alpineForest(map, x, z);
  return canyonForest(map, x, z);
}

/**
 * Tree species (the scan crowns standing in): Capo Serena — umbrella pines, cypresses (the poplar
 * crowns, darkened), holm oak (oak), olives (the bushes, silvered and grown to small trees);
 * Bergsee — spruce, larch (spruce, lighter), beech (chestnut) low down, maple and ash by the
 * villages; Red Mesa — juniper and pinyon (small dark spruce, bushes).
 */
export function scenicSpecies(v: ScenicVenue, map: WorldMap, x: number, z: number, n: number, n2: number, h: number): 'plane' | 'oak' | 'chestnut' | 'poplar' | 'spruce' | 'shrub' | 'umbrella' {
  if (v === 'riviera') {
    const dT = map.distToTrack(x, z);
    if (rivieraUrban(map, x, z) > 0.05) return h < 0.35 ? 'poplar' : h < 0.7 ? 'umbrella' : 'shrub';
    // cypress lines along the lanes and on the ridges, pines on the cape, olives on the terraces
    if (n2 > 0.32 && h < 0.5) return 'poplar';
    if (n < -0.05 || dT < 220) return h < 0.62 ? 'umbrella' : 'oak';
    return h < 0.55 ? 'shrub' : h < 0.8 ? 'oak' : 'umbrella';
  }
  if (v === 'alpine') {
    const reg = alpineRegional(map, x, z);
    if (alpineUrban(map, x, z) > 0.05) return h < 0.4 ? 'plane' : h < 0.75 ? 'chestnut' : 'spruce';
    if (reg < 60 && n2 > 0.15) return 'chestnut';
    return h < 0.12 ? 'shrub' : 'spruce';
  }
  // (junipers: low, round, dark — the oak crowns shrunk; sagebrush the bushes)
  return h < 0.78 ? 'shrub' : 'oak';
}

/** nothing grows on the cliff faces, in the sea or the lake */
export function scenicTreeOk(map: WorldMap, x: number, z: number): boolean {
  if (map.scenic === 'riviera') return rivieraCoast(map, x, z) < -12 && map.height(x, z) > RIVIERA_SEA + 6;
  if (map.scenic === 'alpine') return alpineLake(map, x, z) < -6;
  return true;
}

/** per-venue tree tint (multiplies the species tint) and scale */
export function scenicTreeLook(v: ScenicVenue, sp: string, h: number): { tint: [number, number, number]; scale: number } {
  if (v === 'riviera') {
    // cypress: near-black green, tall and narrow; olives: silver-grey; pines: deep green
    if (sp === 'poplar') return { tint: [0.55, 0.72, 0.6], scale: 1.05 };
    // (macchia: lentisk, myrtle, broom — dense, dark, glossy)
    if (sp === 'shrub') return { tint: [0.68, 0.94, 0.62], scale: 0.9 + h * 0.5 };
    if (sp === 'umbrella') return { tint: [0.86, 0.98, 0.78], scale: 1.08 };
    return { tint: [0.84, 0.94, 0.8], scale: 0.85 };
  }
  if (v === 'alpine') {
    // larch: lighter, yellower greens among the spruce
    if (sp === 'spruce') return h > 0.82 ? { tint: [1.35, 1.3, 0.85], scale: 1.0 } : { tint: [0.92, 0.98, 1.0], scale: 1.12 };
    return { tint: [1, 1.02, 0.92], scale: 1 };
  }
  // the desert: junipers small, dark and dusty; sagebrush low and silver-grey
  if (sp === 'oak') return { tint: [0.62, 0.7, 0.58], scale: 0.3 + h * 0.12 };
  return { tint: [1.3, 1.22, 0.98], scale: 0.38 + h * 0.3 };
}
