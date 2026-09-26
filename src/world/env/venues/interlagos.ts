import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { clamp, fbm2, lerp, ridged2, smoothstep } from '../noise.ts';

/**
 * Interlagos: the land. The circuit lies in a natural bowl in São Paulo's zona sul, between
 * the Guarapiranga reservoir (west) and the arms of the Billings (east) — "inter lagos".
 * The grandstand hill rises steeply behind the main straight, the land falls to the little
 * lake inside the Descida do Lago, and the city (red-tiled houses, favela slopes, apartment
 * towers) covers every hill beyond the circuit wall.
 *
 * World frame: x = east, z = south, the circuit's bounding box centred on the origin. The
 * main straight runs down the west side (north → south), the S do Senna at the south end,
 * the Reta Oposta up the east side to the lake.
 */

// ---------------------------------------------------------------- water

export interface LakeDef {
  name: string;
  /** water surface height (absolute, m; the circuit's lowest point is 0) */
  level: number;
  /** centre chain: [x, z, radius] relative to the circuit centre (capsules between successive points) */
  pts: [number, number, number][];
  /** extra chains (bays and arms) */
  arms?: [number, number, number][][];
  /** shoreline wobble amplitude (m) and its scale */
  wobble: number;
  wobbleScale: number;
  /** width of the shore blend on land (m) */
  shore: number;
  /** maximum depth under the surface (m) */
  depth: number;
}

export const INTERLAGOS_LAKES: LakeDef[] = [
  {
    // the lake inside the circuit, at the bottom of the Descida do Lago
    name: 'Lago',
    level: -1.3,
    pts: [[228, -128, 36], [206, -70, 30], [196, -28, 20]],
    wobble: 7,
    wobbleScale: 60,
    shore: 16,
    depth: 3,
  },
  {
    // a smaller pond in the infield inside the Curva do Sol
    name: 'Lagoa do Sol',
    level: 8,
    pts: [[92, 262, 26], [70, 300, 20]],
    wobble: 5,
    wobbleScale: 40,
    shore: 14,
    depth: 2.5,
  },
  {
    // Represa de Guarapiranga: a long, branching reservoir 1.5 km west of the main straight
    name: 'Guarapiranga',
    level: -13,
    pts: [[-2500, -3600, 420], [-2250, -2300, 560], [-2350, -1000, 700], [-2750, 400, 900], [-3200, 1900, 1100], [-3500, 3600, 1250], [-3900, 5600, 1300], [-4300, 7800, 1200], [-4600, 10500, 1100]],
    arms: [
      [[-2600, 900, 500], [-1900, 1500, 320], [-1500, 2050, 200]],
      [[-3100, 2800, 600], [-2200, 3600, 380], [-1700, 4300, 240]],
      [[-3700, -200, 380], [-4600, -700, 360], [-5500, -600, 300]],
    ],
    wobble: 160,
    wobbleScale: 700,
    shore: 260,
    depth: 14,
  },
  {
    // Represa Billings: its western arms reach within 3 km to the south-east
    name: 'Billings',
    level: -9,
    pts: [[3300, -2600, 380], [3050, -1200, 460], [3350, 300, 620], [4000, 1700, 820], [5000, 2900, 950], [6500, 3800, 1150], [8500, 4300, 1300], [10500, 4600, 1300]],
    arms: [
      [[3350, 300, 500], [2500, 1300, 320], [2000, 2150, 230], [1750, 2900, 170]],
      [[5000, 2900, 700], [4700, 4500, 520], [4500, 6200, 420]],
    ],
    wobble: 150,
    wobbleScale: 650,
    shore: 240,
    depth: 12,
  },
];

function segDist(px: number, pz: number, a: [number, number, number], b: [number, number, number]): number {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const L2 = vx * vx + vz * vz || 1;
  let t = ((px - a[0]) * vx + (pz - a[1]) * vz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - a[0] - vx * t, pz - a[1] - vz * t) - (a[2] + (b[2] - a[2]) * t);
}

/** signed distance to a lake's shoreline (negative on the water), relative to the circuit centre (cx, cz) */
export function lakeSdf(L: LakeDef, x: number, z: number, cx: number, cz: number): number {
  const px = x - cx, pz = z - cz;
  let d = Infinity;
  const chains = L.arms ? [L.pts, ...L.arms] : [L.pts];
  for (const ch of chains) {
    if (ch.length === 1) d = Math.min(d, Math.hypot(px - ch[0][0], pz - ch[0][1]) - ch[0][2]);
    for (let i = 0; i < ch.length - 1; i++) d = Math.min(d, segDist(px, pz, ch[i], ch[i + 1]));
  }
  if (d > L.wobble * 2.5 + 400) return d;
  const w = L.wobbleScale;
  return d + L.wobble * (fbm2(x / w + 3.7, z / w - 1.3, 4) + 0.35 * fbm2(x / (w * 0.3) - 2.1, z / (w * 0.3) + 4.4, 2));
}

/** distance to the nearest water (negative on it) and that lake */
export function nearestWater(map: WorldMap, x: number, z: number): { d: number; lake: LakeDef | null } {
  const c = map.A.center;
  let d = Infinity;
  let lake: LakeDef | null = null;
  for (const L of INTERLAGOS_LAKES) {
    const v = lakeSdf(L, x, z, c.x, c.z);
    if (v < d) { d = v; lake = L; }
  }
  return { d, lake };
}

// ---------------------------------------------------------------- land

/** the circuit estate (inside = the circuit's own grounds; the city starts at its wall) */
export function interlagosPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  return { cx: center.x - 10, cz: center.z + 10, rx: (bb.x1 - bb.x0) / 2 + 190, rz: (bb.z1 - bb.z0) / 2 + 170 };
}

/** natural height at (x, z): P is the blurred circuit platform, dT the distance to the track */
export function interlagosNatural(map: WorldMap, x: number, z: number, P: number, dT: number, far: number): number {
  const c = map.A.center;
  const dx = x - c.x, dz = z - c.z;
  const R = Math.hypot(dx, dz);
  let h = P;
  // folds and lumps of the bowl's slopes
  h += (0.3 + 0.7 * far) * (4.5 * fbm2(x / 360 + 2.3, z / 360 - 4.1, 4) + 1.5 * fbm2(x / 110 - 3.3, z / 110 + 1.9, 2));
  // the bowl: the land climbs away from the circuit on every side, steepest and highest
  // behind the main straight (the grandstand hill, west) and above Junção (north)
  const west = smoothstep(-120, -520, dx);
  const north = smoothstep(-250, -800, dz);
  const east = smoothstep(150, 600, dx);
  // (south: the Interlagos hillside rising behind the S do Senna, houses on it — the view from the grid)
  const south = smoothstep(380, 720, dz);
  const rimH = 12 + 17 * west + 8 * north + 5 * east + 16 * south + 5 * fbm2(x / 650 + 1.1, z / 650 - 0.4, 2);
  const rim = smoothstep(26, lerp(640, 360, Math.max(west, south)), dT);
  h += rim * rimH;
  // the zona sul beyond: ridges and valleys, the city over all of it
  const reg = smoothstep(800, 2800, R);
  h += reg * (16 * fbm2(x / 1700 + 0.7, z / 1700 - 2.9, 4) + 20 * Math.pow(ridged2(x / 2600 - 1.9, z / 2600 + 3.3, 3, 2.0, 0.5), 1.4) - 8);
  // far off, the plateau rises a little toward the centre of São Paulo (north)
  h += smoothstep(3000, 12000, -dz) * 18;
  return carveWater(map, x, z, h);
}

function carveWater(map: WorldMap, x: number, z: number, h: number): number {
  const c = map.A.center;
  for (const L of INTERLAGOS_LAKES) {
    const d = lakeSdf(L, x, z, c.x, c.z);
    if (d > L.shore) continue;
    if (d >= 0) {
      // the shore: meets the water just above its level
      const t = smoothstep(0, L.shore, d);
      h = lerp(L.level + 0.7, Math.max(h, L.level + 0.7), t);
    } else {
      const bottom = L.level - L.depth;
      h = lerp(L.level + 0.7, bottom, smoothstep(0, Math.min(L.shore * 0.6, 90), -d));
    }
  }
  return h;
}

/**
 * Metres outside the circuit estate (negative inside): the grounds hug the circuit — the city
 * starts ~115 m from the track behind the stands and the Reta Oposta — but the whole infield is
 * inside (a tight ellipse round the lap).
 */
export function estateDistance(map: WorldMap, x: number, z: number): number {
  const wob = 14 * fbm2(x / 260 + 0.7, z / 260 - 5.1, 2);
  return Math.min(map.parkDistance(x, z) + 150, map.distToTrack(x, z) - 118) + wob;
}

/** built-up density outside the circuit: city everywhere, but parks, wooded hilltops and the shores */
export function interlagosUrban(map: WorldMap, x: number, z: number): number {
  const out = smoothstep(-10, 25, estateDistance(map, x, z));
  if (out <= 0) return 0;
  const w = nearestWater(map, x, z).d;
  if (w < 10) return 0;
  const shore = smoothstep(10, 140, w);
  const n = fbm2(x / 1100 + 7.3, z / 1100 - 3.9, 3) * 0.5 + 0.5;
  const parks = smoothstep(0.64, 0.74, n);
  return out * shore * (1 - parks * 0.92);
}

/**
 * Tree cover: the circuit grounds are open grass with clumps of tipuanas and palms and
 * wooded banks; the city has street trees and back gardens, the parks and hilltops are woods.
 */
export function interlagosForest(map: WorldMap, x: number, z: number): number {
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 420 + 11.3, z / 420 - 7.7, 4);
  const n2 = fbm2(x / 130 - 2.3, z / 130 + 6.1, 3);
  let f = smoothstep(0.58, 0.76, 0.5 + 0.45 * n1 + 0.2 * n2 + 0.08 * (1 - smoothstep(60, 220, dT))) * smoothstep(30, 70, dT);
  f *= map.clearingKeep(x, z);
  const out = smoothstep(-10, 25, estateDistance(map, x, z));
  if (out > 0) {
    const u = map.urban(x, z);
    const street = 0.035 + 0.045 * (n2 * 0.5 + 0.5);
    const woods = (1 - u) * 0.85;
    f = lerp(f, Math.max(street * u, woods), out);
  }
  const w = nearestWater(map, x, z).d;
  if (w < 12) f *= smoothstep(4, 12, w);
  return clamp(f, 0, 1);
}

// ---------------------------------------------------------------- layout

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

/**
 * Interlagos: the huge Setor A grandstands on the hillside outside the main straight and
 * round the Arquibancadas curve, Setor G at Junção, stands at the S do Senna, the Curva do
 * Sol, the Descida do Lago and round the infield (Ferradura, Laranjinha, Bico de Pato,
 * Mergulho), fans on the grass banks everywhere else. The paddock is inside the straight.
 */
export function planInterlagos(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const ju = corner('Junção');
  const ss = corner('S do Senna');
  const t2 = corner('Turn 2');
  const sol = corner('Curva do Sol');
  const dl = corner('Descida do Lago');
  const fe = corner('Ferradura');
  const la = corner('Laranjinha');
  const bp = corner('Bico de Pato');
  const me = corner('Mergulho');

  // Setor A: the main grandstands up the hill outside the straight and round the Arquibancadas curve
  addStand('Setor A', 760, 1330, R, 32, 'centrale', 8, 95);
  addStand('Arquibancadas', 470, 745, R, 26, 'covered', 8, 70);
  // Setor G at Junção, the pit entry below it
  addStand('Setor G', ju.sStart - 110, ju.sEnd + 30, R, 22, 'covered', 8, 70);
  // the S do Senna: stands on the outside of the braking zone and the first left
  addStand('Setor B', ss.sStart - 130, ss.sStart - 6, R, 22, 'covered', 8, 65);
  addStand('Setor D', t2.sStart - 20, t2.sEnd + 40, L, 16, 'open', 8, 60);
  addStand('Curva do Sol', sol.sStart + 30, sol.sApex + 40, R, 14, 'open', 7, 60);
  // the Reta Oposta and the Descida do Lago
  addStand('Setor M', dl.sStart - 150, dl.sStart - 8, R, 20, 'covered', 8, 70);
  addStand('Reta Oposta', 2130, 2330, R, 12, 'open', 7, 65);
  // the infield
  addStand('Ferradura', fe.sStart - 110, fe.sStart - 6, L, 12, 'open', 7, 55);
  // (no stands on the outside of Laranjinha and Bico de Pato: that is the bank up to the pits)
  addStand('Mergulho', me.sStart + 10, me.sApex - 10, R, 12, 'open', 7, 55);

  // grass banks: the hillsides full of fans
  const banks: SpectatorBank[] = [];
  const addBank = (sA: number, sB: number, side: number, rise: number, density: number, gap = 5, width = 16) => {
    let bar = 0;
    for (let s = sA; s <= sB; s += 3) bar = Math.max(bar, track.barrierAt(s, side));
    const latA = side * (bar + gap), latB = side * (bar + gap + width);
    banks.push({ sA, sB, side, latA, latB, rise, density });
    map.trackPads.push({ sA, sB, latA, latB, offset: rise, blend: 9 });
    for (let s = sA; s <= sB; s += 18) {
      track.point(s, (latA + latB) / 2, 0, p);
      map.clearings.push({ x: p.x, z: p.z, r: width * 0.75, soft: 10, keep: 0.05 });
    }
  };
  addBank(ju.sEnd + 45, 440, R, 2.6, 0.85, 6, 20);
  addBank(sol.sApex + 60, sol.sEnd + 150, R, 2.0, 0.7, 6, 18);
  addBank(2360, 2440, R, 1.8, 0.6, 6, 16);
  addBank(dl.sEnd + 20, dl.sEnd + 110, R, 2.0, 0.65, 6, 16);
  addBank(fe.sEnd + 20, corner('Turn 7').sStart - 10, L, 1.6, 0.6, 5, 16);
  addBank(corner('Pinheirinho').sApex, corner('Pinheirinho').sEnd + 40, R, 1.8, 0.65, 5, 16);
  addBank(bp.sEnd + 30, me.sStart - 10, R, 1.8, 0.6, 5, 16);
  addBank(me.sEnd + 10, 4290, R, 2.2, 0.8, 6, 18);

  // open ground: the paddock inside the straight, car parks behind Setor A, the infield lawns
  for (let s = 560; s <= 1440; s += 40) { const q = at(s, -125); clear(q.x, q.z, 48, 28, 0.08); }
  for (let s = 520; s <= 1360; s += 60) { const q = at(s, 128); clear(q.x, q.z, 44, 24, 0.12); }
  { const q = at(ss.sApex, 110); clear(q.x, q.z, 70, 40, 0.2); }
  { const q = at(2300, -150); clear(q.x, q.z, 150, 60, 0.18); }
  { const q = at(3000, 120); clear(q.x, q.z, 90, 50, 0.3); }
  { const q = at(3700, 90); clear(q.x, q.z, 60, 40, 0.3); }
  // the lake shores stay open
  {
    const c = map.A.center;
    clear(c.x + 214, c.z - 80, 80, 30, 0.35);
    clear(c.x + 84, c.z + 280, 50, 20, 0.35);
  }

  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // the service road behind Setor A (Av. Senador Teotônio Vilela side), walkways round the infield
  map.paths.push({ pts: trackLine(480, 1480, (s) => track.barrierAt(s, 1) + 62, 12), width: 8, kind: 2 });
  map.paths.push({ pts: trackLine(1500, 2560, (s) => track.barrierAt(s, 1) + 42, 12), width: 6, kind: 2 });
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(1980, 2540, L, 22);
  walk(3050, 3480, R, 24);
  walk(3700, 3950, R, 22);

  // big screens facing the stands
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, side: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 6) => {
    const lat = side * (track.barrierAt(s, side) + back);
    const q = at(s, lat);
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.heightAt(s), rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
    map.clearings.push({ x: q.x, z: q.z, r: 12, soft: 10, keep: 0.2 });
  };
  screenAt(1470, L, 1200, R, 40, 14, 8, 26);
  screenAt(ss.sApex + 10, L, ss.sStart - 60, R, 40);
  screenAt(dl.sApex + 10, L, dl.sStart - 80, R, 40);
  screenAt(ju.sApex, L, ju.sStart - 40, R, 40);
  screenAt(3560, R, la.sStart - 30, L, 30, 10, 6);

  const flagpoles: V2[] = [];
  for (const g of gs) {
    if (g.style === 'open') continue;
    const n = Math.max(2, Math.round(g.length / 24));
    for (let k = 0; k <= n; k++) {
      const t = k / n - 0.5;
      const along = new THREE.Vector3(g.facing.z, 0, -g.facing.x);
      flagpoles.push({ x: g.center.x + along.x * t * g.length - g.facing.x * (g.depth / 2 + 1.5), z: g.center.z + along.z * t * g.length - g.facing.z * (g.depth / 2 + 1.5) });
    }
  }

  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[1880, -1], [2080, -1]], 70);
  addCameraTowers(track, map, landmarks, ['S do Senna', 'Curva do Sol', 'Descida do Lago', 'Ferradura', 'Bico de Pato', 'Junção']);

  const pit = track.pit;
  const pitSpec = {
    sA: pit.sStart,
    sB: pit.sEnd,
    side: pit.side,
    front: pit.garageOffset + 0.5,
    depth: 26,
    paddockTo: 125,
    y0: track.heightAt(pit.sStart),
    y1: track.heightAt(pit.sEnd),
  };
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages: [], landmarks };
}
