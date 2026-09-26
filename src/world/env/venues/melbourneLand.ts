import * as THREE from 'three';
import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, lerp, smoothstep } from '../noise.ts';

/**
 * Albert Park's land and water. The circuit runs round Albert Park Lake on the park's own
 * roads, 3 km south of Melbourne's CBD: up Aughtie Drive on the west side (the pit straight,
 * the aquatic centre at Turn 3), across the north end by the marina, and back down Lakeside
 * Drive on the east. Inside the loop: the lake (with its rowing sheds, the palm-lined
 * promenade and a small island), the paddock between the pit lane and the water, and the
 * golf course in the south-east lobe. Outside: lawns, sports ovals and tree-lined avenues,
 * then the low-rise Victorian suburbs (Middle Park, Albert Park, South Melbourne, St Kilda),
 * the apartment towers of Queens Road and the offices of St Kilda Road to the east, the CBD
 * and Southbank's towers to the north, and Port Phillip Bay 1.2 km to the south-west.
 *
 * Circuit frame: x = east, z = south, heights in metres (the lap is 1 … 3.6 m).
 */

/** the lake's surface and Port Phillip Bay's */
export const MEL_LAKE_Y = 0.9;
export const MEL_SEA_Y = -0.6;

/**
 * The lake: a chain of discs along its long axis (x, z, radius), blended into one body, then
 * kept clear of the track and the paddock. North tip by the marina (Turn 6), south end short
 * of the pit straight's paddock.
 */
export const LAKE_CHAIN: [number, number, number][] = [
  [-270, -700, 105],
  [-260, -560, 185],
  [-225, -420, 230],
  [-200, -255, 230],
  [-175, -85, 190],
  [-110, 80, 140],
  [-10, 200, 105],
  [90, 320, 80],
  [180, 450, 56],
];
/** Gunn Island, off the west shore */
export const ISLAND = { x: -330, z: -470, rx: 34, rz: 22 };

/** landmark sites (world, circuit frame) */
export const MEL_SITES = {
  /** the CBD's centre (Collins / Swanston), and its grid's rotation (the Hoddle Grid runs ENE) */
  cbd: { x: -640, z: -3420, rot: -0.33 },
  /** Southbank (Eureka, Australia 108) across the Yarra */
  southbank: { x: -860, z: -2760 },
  /** the Arts Centre spire */
  spire: { x: -470, z: -2930 },
  /** the Shrine of Remembrance on its mound in the Kings Domain */
  shrine: { x: -40, z: -1760 },
  /** the aquatic centre (MSAC) and Lakeside Stadium, west of Turn 3 */
  msac: { x: -900, z: -470 },
  stadium: { x: -900, z: -170 },
};

/** Queens Road: the park's eastern edge (apartment towers), St Kilda Road 260 m further east */
export const QUEENS = { ax: 360, az: -1500, bx: 1020, bz: 1100 };
const qU = (() => {
  const dx = QUEENS.bx - QUEENS.ax, dz = QUEENS.bz - QUEENS.az;
  const L = Math.hypot(dx, dz);
  return { ux: dx / L, uz: dz / L, L };
})();
/** signed distance east of Queens Road (m, > 0 = east of it, on the St Kilda Road side) */
export function eastOfQueens(x: number, z: number): number {
  // (heading south-south-east, east is on the left: the normal (uz, −ux))
  return (x - QUEENS.ax) * qU.uz - (z - QUEENS.az) * qU.ux;
}

/** Port Phillip Bay: a straight coast 1.2 km south-west of the pit straight; > 0 = out at sea */
const SEA_P = { x: -1150, z: 1250 };
const SEA_N = { x: -Math.sin((36 * Math.PI) / 180), z: Math.cos((36 * Math.PI) / 180) };
export function seaDistance(x: number, z: number): number {
  return (x - SEA_P.x) * SEA_N.x + (z - SEA_P.z) * SEA_N.z + 45 * fbm2(x / 900 + 3.3, z / 900 - 1.2, 2);
}

// ------------------------------------------------------------------ helpers

const loopCache = new WeakMap<object, { x0: number; z0: number; c: number; w: number; h: number; g: Float32Array }>();

/** 1 inside the lap's loop (the infield), 0 outside; soft over one 10 m cell */
export function insideLoop(map: WorldMap, x: number, z: number): number {
  let L = loopCache.get(map.track);
  if (!L) {
    const t = map.track;
    const c = 10;
    const bb = map.A.bb;
    const x0 = bb.x0 - 20, z0 = bb.z0 - 20;
    const w = Math.ceil((bb.x1 - bb.x0 + 40) / c) + 1, h = Math.ceil((bb.z1 - bb.z0 + 40) / c) + 1;
    const g = new Float32Array(w * h);
    const px: number[] = [], pz: number[] = [];
    for (let i = 0; i < t.n; i += 4) { px.push(t.px[i]); pz.push(t.pz[i]); }
    const m = px.length;
    const xs: number[] = [];
    for (let j = 0; j < h; j++) {
      const zz = z0 + j * c;
      xs.length = 0;
      for (let a = 0; a < m; a++) {
        const b = (a + 1) % m;
        const za = pz[a], zb = pz[b];
        if ((za <= zz && zb > zz) || (zb <= zz && za > zz)) xs.push(px[a] + ((zz - za) / (zb - za)) * (px[b] - px[a]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / c)), i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / c));
        for (let i = i0; i <= i1; i++) g[j * w + i] = 1;
      }
    }
    L = { x0, z0, c, w, h, g };
    loopCache.set(map.track, L);
  }
  const gx = (x - L.x0) / L.c, gz = (z - L.z0) / L.c;
  if (gx < 0 || gz < 0 || gx >= L.w - 1 || gz >= L.h - 1) return 0;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * L.w + i;
  const g = L.g;
  return (g[k] * (1 - fx) + g[k + 1] * fx) * (1 - fz) + (g[k + L.w] * (1 - fx) + g[k + L.w + 1] * fx) * fz;
}

/** smooth minimum (polynomial, radius k) */
function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

const pitCache = new WeakMap<object, { ax: number; az: number; bx: number; bz: number }>();
/** the paddock's axis: a segment 70 m inside the pit lane, from its entry to its exit */
function paddockAxis(map: WorldMap) {
  let P = pitCache.get(map.track);
  if (!P) {
    const t = map.track;
    const p = t.pit;
    const a = t.point(p.sStart + 40, p.side * 70, 0, new THREE.Vector3());
    const b = t.point(p.sEnd - 40, p.side * 70, 0, new THREE.Vector3());
    P = { ax: a.x, az: a.z, bx: b.x, bz: b.z };
    pitCache.set(map.track, P);
  }
  return P;
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(x - ax - vx * t, z - az - vz * t);
}

/** the lake's own shape (no track clearance): signed distance, negative on the water */
function lakeShape(x: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i + 1 < LAKE_CHAIN.length; i++) {
    const [ax, az, ar] = LAKE_CHAIN[i], [bx, bz, br] = LAKE_CHAIN[i + 1];
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const di = Math.hypot(x - ax - vx * t, z - az - vz * t) - lerp(ar, br, t);
    d = smin(d, di, 40);
  }
  // a natural, slightly scalloped shoreline
  return d + 10 * fbm2(x / 170 + 2.1, z / 170 - 5.3, 3);
}

/** signed distance to the lake's shore (m): negative on the water */
export function lakeDistance(map: WorldMap, x: number, z: number, dT = map.distToTrack(x, z)): number {
  let d = lakeShape(x, z);
  // never closer than ~42 m to the circuit's centreline, nor into the paddock
  d = Math.max(d, 42 - dT);
  const P = paddockAxis(map);
  d = Math.max(d, 118 - segDist(x, z, P.ax, P.az, P.bx, P.bz));
  // Gunn Island
  const iu = (x - ISLAND.x) / ISLAND.rx, iv = (z - ISLAND.z) / ISLAND.rz;
  d = Math.max(d, (1 - Math.hypot(iu, iv)) * Math.min(ISLAND.rx, ISLAND.rz));
  return d;
}

export interface MelGeo {
  /** signed lake distance (m, < 0 on the lake) */
  lake: number;
  /** signed sea distance (m, > 0 out in the bay) */
  sea: number;
  /** 1 inside the lap's loop */
  inLoop: number;
  /** 0 … 1: the golf course (the south-east lobe of the infield) */
  golf: number;
  /** metres beyond the park's edge (negative inside the park) */
  out: number;
}
const G: MelGeo = { lake: 0, sea: 0, inLoop: 0, golf: 0, out: 0 };

export function melbourneGeo(map: WorldMap, x: number, z: number, dT = map.distToTrack(x, z)): MelGeo {
  G.inLoop = insideLoop(map, x, z);
  G.lake = lakeDistance(map, x, z, dT);
  G.sea = seaDistance(x, z);
  // the golf course: the infield south-east of the lake (east of the paddock)
  G.golf = G.inLoop * smoothstep(-60, 40, x - 300 + 0.45 * (z - 300)) * smoothstep(10, 60, dT) * smoothstep(20, 60, G.lake);
  // the park: the loop and a margin of lawns and ovals round it (wider to the north and west: the
  // aquatic centre, Lakeside Stadium and the ovals by Albert Road); Queens Road bounds it to the east
  const margin = 140 + 70 * smoothstep(0, -600, z) + 230 * smoothstep(-350, -850, x) * smoothstep(250, -100, z) + 40 * fbm2(x / 400 - 1.1, z / 400 + 2.2, 2);
  let out = G.inLoop > 0.5 ? -100 : dT - margin;
  out = Math.max(out, eastOfQueens(x, z) + 10);
  G.out = out;
  return G;
}

// ------------------------------------------------------------------ the worldmap hooks

/** the "park" is Albert Park itself: the circuit and its lawns */
export function melbournePark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const c = map.A.center;
  const bb = map.A.bb;
  return { cx: c.x - 40, cz: c.z - 60, rx: (bb.x1 - bb.x0) / 2 + 180, rz: (bb.z1 - bb.z0) / 2 + 160 };
}

export function melbourneNatural(map: WorldMap, x: number, z: number, platform: number, dT: number, far: number): number {
  const g = melbourneGeo(map, x, z, dT);
  // parkland: flat reclaimed swamp round the lake, a metre of landscaped rise and fall
  let land = platform + (0.2 + 0.8 * far) * (0.6 * fbm2(x / 300 + 5.2, z / 300 - 2.4, 3) + 0.15 * fbm2(x / 70 - 1.3, z / 70 + 7.1, 2));
  // the golf course's gentle mounds
  land += g.golf * 1.3 * (fbm2(x / 90 + 9.1, z / 90 - 3.3, 2) * 0.5 + 0.5);
  // beyond the park: the city rises gently to the north (South Melbourne, the Kings Domain's
  // hill with the Shrine, the CBD on its low ridge), falls to the bay to the south-west
  const outK = smoothstep(0, 400, g.out);
  const north = smoothstep(-900, -3400, z);
  land += outK * (2.5 * fbm2(x / 900 + 1.7, z / 900 - 0.4, 3) + 14 * north);
  const S = MEL_SITES.shrine;
  land += 9 * Math.exp(-((Math.hypot(x - S.x, z - S.z) / 230) ** 2));
  // the bay: a sandy foreshore, then the sea bed
  if (g.sea > -140) {
    const beach = smoothstep(-140, 0, g.sea);
    land = lerp(land, MEL_SEA_Y + 0.4, beach);
    if (g.sea > 0) land = lerp(MEL_SEA_Y + 0.4, MEL_SEA_Y - 9, smoothstep(0, 400, g.sea));
  }
  // the lake: grass banks down to the water, a shallow bed (it is ~2 m deep)
  const W = MEL_LAKE_Y;
  if (g.lake < 14) {
    if (g.lake >= 0) return lerp(W + 0.35, land, smoothstep(0, 14, g.lake));
    return lerp(W + 0.35, W - 2.6, smoothstep(0, 26, -g.lake));
  }
  return land;
}

export function melbourneForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const g = melbourneGeo(map, x, z, dT);
  if (g.lake < 10 || g.sea > -70) return 0;
  const n1 = fbm2(x / 260 + 11.3, z / 260 - 7.7, 3);
  const n2 = fbm2(x / 90 - 2.3, z / 90 + 6.1, 2);
  let f: number;
  if (g.out < 0) {
    // parkland: groves of gums, elms and planes between open lawns; trees lining the circuit's
    // roads behind the fences for much of the lap
    const belt = (1 - smoothstep(26, 60, dT)) * smoothstep(12, 22, dT) * 0.7 * smoothstep(0.42, 0.62, 0.5 + 0.7 * fbm2(x / 210 - 3.1, z / 210 + 4.4, 2));
    const grove = smoothstep(0.5, 0.68, 0.5 + 0.6 * n1 + 0.22 * n2) * 0.85;
    f = Math.max(belt, grove);
    // the golf course: fairways open, tree lines between the holes
    if (g.golf > 0) f = lerp(f, smoothstep(0.52, 0.7, 0.5 + 0.7 * fbm2(x / 120 - 4.2, z / 120 + 1.7, 2)) * 0.8, g.golf);
    // the lake shore is open lawn (the palms are placed separately)
    f *= smoothstep(12, 45, g.lake);
  } else {
    // the suburbs: street trees and back gardens
    f = 0.035 + 0.05 * smoothstep(0.3, 0.7, 0.5 + n2);
    f *= 1 - smoothstep(-2600, -3200, z) * 0.9;
  }
  return clamp(f * map.clearingKeep(x, z), 0, 1);
}

export function melbourneUrban(map: WorldMap, x: number, z: number): number {
  const g = melbourneGeo(map, x, z);
  if (g.out <= 0 || g.sea > -60) return 0;
  const k = smoothstep(20, 120, g.out) * (1 - smoothstep(-160, -60, g.sea));
  // the Kings Domain and the Botanic Gardens (north-east) are parkland too
  const dom = Math.exp(-((Math.hypot(x - 250, (z + 1950) * 0.8) / 520) ** 2));
  return k * 0.92 * (1 - 0.95 * dom);
}

// ------------------------------------------------------------------ the shoreline as a polygon

const contourCache = new WeakMap<object, Map<number, { x: number; z: number }[]>>();

/**
 * The lake's shoreline pushed out by `offset` m (0 = the water's edge) as one closed polygon:
 * the contour of lakeDistance (marching squares on a 5 m grid, the biggest loop kept — the
 * island's ring is dropped), thinned to ~`step` m.
 */
export function lakeContour(map: WorldMap, offset = 0, step = 6): { x: number; z: number }[] {
  let per = contourCache.get(map.track);
  if (!per) contourCache.set(map.track, (per = new Map()));
  const hit = per.get(offset * 1000 + step);
  if (hit) return hit;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z, r] of LAKE_CHAIN) {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r);
    z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r);
  }
  const pad = 60 + offset;
  x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  const cell = 5;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const sd = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      sd[j * nx + i] = edge ? 1 : lakeDistance(map, x0 + i * cell, z0 + j * cell) - offset;
    }
  const key = (i: number, j: number, h: number) => (j * nx + i) * 2 + h;
  const pt = new Map<number, { x: number; z: number }>();
  const nb = new Map<number, number[]>();
  const at = (i: number, j: number, h: number) => {
    const k = key(i, j, h);
    if (!pt.has(k)) {
      const a = sd[j * nx + i], b = h ? sd[(j + 1) * nx + i] : sd[j * nx + i + 1];
      const t = a / (a - b);
      pt.set(k, h ? { x: x0 + i * cell, z: z0 + (j + t) * cell } : { x: x0 + (i + t) * cell, z: z0 + j * cell });
    }
    return k;
  };
  const link = (a: number, b: number) => {
    (nb.get(a) ?? nb.set(a, []).get(a)!).push(b);
    (nb.get(b) ?? nb.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const v0 = sd[j * nx + i] < 0, v1 = sd[j * nx + i + 1] < 0, v2 = sd[(j + 1) * nx + i + 1] < 0, v3 = sd[(j + 1) * nx + i] < 0;
      const cut: number[] = [];
      if (v0 !== v1) cut.push(at(i, j, 0));
      if (v1 !== v2) cut.push(at(i + 1, j, 1));
      if (v2 !== v3) cut.push(at(i, j + 1, 0));
      if (v3 !== v0) cut.push(at(i, j, 1));
      if (cut.length === 2) link(cut[0], cut[1]);
      else if (cut.length === 4) {
        link(cut[0], cut[1]);
        link(cut[2], cut[3]);
      }
    }
  const seen = new Set<number>();
  let best: { x: number; z: number }[] = [];
  let bestA = 0;
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const loop: { x: number; z: number }[] = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(pt.get(cur)!);
      const n = nb.get(cur)!;
      const next = n[0] !== prev ? n[0] : n[1];
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    let area = 0;
    for (let k = 0; k < loop.length; k++) {
      const p = loop[k], q = loop[(k + 1) % loop.length];
      area += p.x * q.z - q.x * p.z;
    }
    if (Math.abs(area) > bestA) { bestA = Math.abs(area); best = loop; }
  }
  const out: { x: number; z: number }[] = [];
  for (const q of best) if (!out.length || Math.hypot(q.x - out[out.length - 1].x, q.z - out[out.length - 1].z) >= step) out.push(q);
  per.set(offset * 1000 + step, out);
  return out;
}
