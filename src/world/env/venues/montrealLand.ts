import type { WorldMap } from '../worldmap.ts';
import { clamp, fbm2, lerp, smoothstep } from '../noise.ts';

/**
 * Montréal's land and water. The circuit fills Île Notre-Dame, a man-made island in the
 * St Lawrence (Expo 67): flat parkland and tree lines inside the loop, the Olympic rowing
 * basin running down the paddock side, a small beach lake to the west. Across the Le Moyne
 * channel to the north-west is Île Sainte-Hélène (wooded, a rocky hill, the Biosphère),
 * beyond the main channel to the west the Cité du Havre peninsula (Habitat 67) and the city
 * itself (Old Montréal, the downtown towers, Mont Royal behind). To the east the Seaway dyke
 * and the low south shore (Longueuil, Saint-Lambert).
 *
 * Circuit frame: x = east, z = south, heights in metres relative to the lap (≈ 0 … 1.2).
 * Everything is one signed "coast" distance (m, > 0 land, < 0 water) shaped from simple
 * pieces, plus the basin, which is cut with a sharp-edged pad so its concrete banks stay
 * vertical at the fine terrain resolution.
 */

/** the river's surface (and the basin's: they are both a metre or two below the island) */
export const MTL_WATER_Y = -1.3;

/** the Olympic basin: centreline A → B (world), half width */
export const BASIN = { ax: -127, az: -240, bx: 44, bz: 640, half: 55 };
/** the beach lake (Plage Jean-Doré) */
export const LAKE = { x: -208, z: 115, rx: 46, rz: 110 };
/** landmark sites (world, circuit frame) */
export const SITES = {
  casino: { x: -336, z: -700 },
  quebecPavilion: { x: -300, z: -560 },
  biosphere: { x: -770, z: -1490 },
  habitat: { x: -1640, z: 150 },
  /** Île Sainte-Hélène (ellipse, rotated by `rot` about the vertical) */
  helene: { x: -840, z: -1780, rx: 330, rz: 680, rot: 0.33 },
  /** Mont Royal */
  royal: { x: -5100, z: -900, r: 1250, h: 205 },
};

// ------------------------------------------------------------------ helpers

const loopCache = new WeakMap<object, { x0: number; z0: number; c: number; w: number; h: number; g: Float32Array }>();

/** 1 inside the lap's loop (the infield), 0 outside; soft over one 10 m cell */
function insideLoop(map: WorldMap, x: number, z: number): number {
  let L = loopCache.get(map.track);
  if (!L) {
    const t = map.track;
    const c = 10;
    const bb = map.A.bb;
    const x0 = bb.x0 - 20, z0 = bb.z0 - 20;
    const w = Math.ceil((bb.x1 - bb.x0 + 40) / c) + 1, h = Math.ceil((bb.z1 - bb.z0 + 40) / c) + 1;
    const g = new Float32Array(w * h);
    // scanline even-odd fill of the centreline polygon (every 4th sample)
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

/** signed distance to a capsule's surface (negative inside) */
function sdCapsule(x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number): number {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(x - ax - vx * t, z - az - vz * t) - r;
}

/** approximate signed distance to a rotated ellipse (negative inside) */
function sdEllipse(x: number, z: number, cx: number, cz: number, rx: number, rz: number, rot: number): number {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = x - cx, dz = z - cz;
  const u = dx * c - dz * s, v = dx * s + dz * c;
  const k = Math.hypot(u / rx, v / rz);
  return (k - 1) * Math.min(rx, rz);
}

/** the basin as an oriented rectangle: signed distance (negative inside the water) */
export function sdBasin(x: number, z: number): number {
  const B = BASIN;
  const dx = B.bx - B.ax, dz = B.bz - B.az;
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const px = x - (B.ax + B.bx) / 2, pz = z - (B.az + B.bz) / 2;
  const a = Math.abs(px * ux + pz * uz) - L / 2;
  const b = Math.abs(-px * uz + pz * ux) - B.half;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
}

/** Montréal's shore, x of the waterfront as a function of z (the river runs SSW → NNE here) */
// (Old Port ≈ 2.1 km west, Pointe-Saint-Charles closer in to the south-west)
const cityShoreX = (z: number) => -2150 + 0.25 * Math.max(0, z + 500) - 0.05 * Math.min(0, z + 500) + 50 * Math.sin(z / 700);
/** the south shore (Longueuil, Saint-Lambert) */
const southShoreX = (z: number) => 1450 + 0.12 * z + 50 * Math.sin(z / 900 + 1.1);
/** the St Lawrence Seaway's dyke, a long thin strip east of the islands */
const dykeX = (z: number) => 1030 + 0.12 * z;

export interface MtlGeo {
  /** signed coast distance (m): > 0 land, < 0 water (river, channels; the basin is separate) */
  coast: number;
  /** which land: 0 water, 1 Notre-Dame, 2 Sainte-Hélène, 3 city (west), 4 south shore, 5 dyke, 6 Cité du Havre */
  land: number;
  /** metres inland from the city/south-shore waterfront (0 elsewhere) */
  inland: number;
}
const G: MtlGeo = { coast: 0, land: 0, inland: 0 };

export function montrealGeo(map: WorldMap, x: number, z: number, dT = map.distToTrack(x, z)): MtlGeo {
  // Île Notre-Dame: the infield, and a band round the lap (wider on the west, the Floralies side)
  const inL = insideLoop(map, x, z);
  const R = 150 - 0.12 * x + 45 * fbm2(x / 380 + 1.3, z / 380 - 2.1, 3);
  let nd = lerp(R - dT, R + dT, inL);
  // the Casino's grounds at the north-west of the island, the south tip below the Senna S
  nd = Math.max(nd, 190 - Math.hypot(x - SITES.casino.x, (z - SITES.casino.z) * 0.8));
  // the island runs on south of the Senna S (car parks, the Pont de la Concorde road)
  nd = Math.max(nd, 260 - Math.hypot((x - 170) * 0.9, z - 1040));
  // the lake inside the loop
  const lk = sdEllipse(x, z, LAKE.x, LAKE.z, LAKE.rx, LAKE.rz, 0.2);
  nd = Math.min(nd, lk);
  const H = SITES.helene;
  const sh = -sdEllipse(x, z, H.x, H.z, H.rx, H.rz, H.rot) + 25 * fbm2(x / 260 - 4.4, z / 260 + 0.7, 2);
  const cdh = -sdCapsule(x, z, -2150, 1050, -1060, -640, 80);
  const city = cityShoreX(z) - x;
  const south = x - southShoreX(z);
  const dyke = z > -2800 && z < 3400 ? 32 - Math.abs(x - dykeX(z)) : -1e4;
  let coast = nd, land = 1, inland = 0;
  if (sh > coast) { coast = sh; land = 2; }
  if (cdh > coast) { coast = cdh; land = 6; }
  if (city > coast) { coast = city; land = 3; inland = city; }
  if (south > coast) { coast = south; land = 4; inland = south; }
  if (dyke > coast) { coast = dyke; land = 5; }
  if (coast < 0) land = 0;
  G.coast = coast;
  G.land = land;
  G.inland = Math.max(0, inland);
  return G;
}

// ------------------------------------------------------------------ the worldmap hooks

/** the "park" is the two islands: no farmland on them */
export function montrealPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const c = map.A.center;
  return { cx: c.x - 320, cz: c.z - 420, rx: 1050, rz: 1750 };
}

export function montrealNatural(map: WorldMap, x: number, z: number, platform: number, dT: number, far: number): number {
  const g = montrealGeo(map, x, z, dT);
  let land: number;
  if (g.land === 3) {
    // the city climbs gently from the waterfront to downtown, Mont Royal behind it
    const R = SITES.royal;
    const dr = Math.hypot(x - R.x, (z - R.z) * 1.25);
    land = 4 + 30 * smoothstep(0, 1800, g.inland) + R.h * Math.exp(-((dr / R.r) ** 2)) + 6 * fbm2(x / 900, z / 900, 2);
  } else if (g.land === 4) {
    land = 2.5 + 8 * smoothstep(0, 3000, g.inland) + 2 * fbm2(x / 700 + 3, z / 700, 2);
  } else if (g.land === 2) {
    // Sainte-Hélène: a wooded rocky hill in the middle of the island
    const H = SITES.helene;
    land = 1.2 + 19 * Math.exp(-((Math.hypot(x - (H.x - 60), z - (H.z - 180)) / 330) ** 2)) + 1.5 * fbm2(x / 150, z / 150, 2);
  } else {
    // the island: flat fill, a few landscaped mounds out in the parkland
    land = platform + (0.2 + 0.8 * far) * (0.5 * fbm2(x / 260 + 5.2, z / 260 - 2.4, 3) + 0.15 * fbm2(x / 70 - 1.3, z / 70 + 7.1, 2));
    land += 1.6 * smoothstep(0.35, 0.7, fbm2(x / 150 + 9.1, z / 150 - 3.3, 2)) * smoothstep(60, 140, dT);
  }
  // banks: a couple of metres of grass or rip-rap down to the water, then the river bed
  const W = MTL_WATER_Y;
  const c = g.coast;
  if (c >= 0) return lerp(W + 0.45, land, smoothstep(0, 22, c));
  return lerp(W + 0.45, W - 7, smoothstep(0, 30, -c));
}

export function montrealForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const g = montrealGeo(map, x, z, dT);
  if (g.coast < 6 || sdBasin(x, z) < 10) return 0;
  const n1 = fbm2(x / 300 + 11.3, z / 300 - 7.7, 3);
  const n2 = fbm2(x / 110 - 2.3, z / 110 + 6.1, 2);
  let f: number;
  switch (g.land) {
    case 1: {
      // maples and ash right behind the walls for most of the lap, parkland (lawns, groves) inside
      const belt = 1 - smoothstep(40, 90, dT);
      const park = smoothstep(0.42, 0.62, 0.5 + 0.55 * n1 + 0.2 * n2);
      f = Math.max(belt * smoothstep(10, 22, dT) * 0.92, park * 0.85);
      // open lawns by the water's edge
      f *= smoothstep(6, 26, g.coast);
      break;
    }
    case 2: f = smoothstep(0.25, 0.5, 0.55 + 0.5 * n1) * 0.95; break;
    case 6: f = 0.25 * smoothstep(0.4, 0.7, 0.5 + n2); break;
    case 5: f = 0.45 * smoothstep(0.3, 0.6, 0.5 + n2); break;
    case 3: {
      const R = SITES.royal;
      const dr = Math.hypot(x - R.x, (z - R.z) * 1.25);
      f = Math.max(0.06, 0.95 * (1 - smoothstep(R.r * 0.55, R.r * 0.9, dr)));
      break;
    }
    case 4: f = 0.22 * smoothstep(0.4, 0.7, 0.5 + n1); break;
    default: f = 0;
  }
  return clamp(f * map.clearingKeep(x, z), 0, 1);
}

export function montrealUrban(map: WorldMap, x: number, z: number): number {
  const g = montrealGeo(map, x, z);
  if (g.land === 3) {
    const R = SITES.royal;
    const dr = Math.hypot(x - R.x, (z - R.z) * 1.25);
    // the Old Port's quays are open; the mountain is a park
    return smoothstep(60, 220, g.inland) * 0.92 * smoothstep(R.r * 0.6, R.r * 0.95, dr);
  }
  if (g.land === 4) return smoothstep(40, 200, g.inland) * smoothstep(0.3, 0.55, 0.5 + 0.6 * fbm2(x / 900 - 2, z / 900 + 1, 2)) * 0.85;
  return 0;
}
