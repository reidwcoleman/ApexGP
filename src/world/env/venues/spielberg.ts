import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { clamp, fbm2, lerp, ridged2, smoothstep } from '../noise.ts';

/**
 * The Red Bull Ring's land: Styria's Aichfeld, the broad floor of the upper Mur valley.
 * The circuit climbs the valley's north-western flank (the pit straight at the bottom, Remus
 * at the top), with spruce and larch forest on the hills behind it, meadows and car parks
 * round it, farmland and the towns of Spielberg, Zeltweg and Knittelfeld on the valley floor,
 * the Seckau Alps (rock, a little snow) on the northern horizon and the rounded, forested
 * Gleinalpe / Stubalpe range to the south.
 *
 * Everything is in the circuit's frame: x = east, z = south, heights relative to the lowest
 * point of the lap (the last corner ≈ 0; Remus ≈ +65).
 */

// the Mur valley: its axis runs SW → NE some 3–4 km south-east of the circuit; the circuit's
// own hillside falls the same way (a plane fitted to the lap: 5.7 % toward (0.66, 0.75))
const AX = { x: 0, z: 3800 };
/** across the valley (toward the south-east, downhill) */
const NX = 0.66, NZ = 0.75;
/** along it (north-east, the way the Mur flows) */
const TX = 0.75, TZ = -0.66;

/** the valley towns (circuit frame): Spielberg, Knittelfeld, Zeltweg, Fohnsdorf, Judenburg, Flatschach */
const TOWNS: { x: number; z: number; r: number }[] = [
  { x: 2300, z: 650, r: 720 },
  { x: 5400, z: 300, r: 1300 },
  { x: -700, z: 3350, r: 950 },
  { x: -6000, z: 1400, r: 950 },
  { x: -7600, z: 5500, r: 1100 },
  { x: 1500, z: -900, r: 260 },
];

/** piecewise-linear envelope, smoothed */
function env(table: [number, number][], v: number): number {
  if (v <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [a, ha] = table[i - 1], [b, hb] = table[i];
    if (v <= b) {
      const t = (v - a) / (b - a);
      return ha + (hb - ha) * t * t * (3 - 2 * t);
    }
  }
  return table[table.length - 1][1];
}

// north-western flank, by distance w (m) uphill from the circuit's centre
const NW_FLANK: [number, number][] = [
  [-1100, -14], [-800, -12], [-400, 8], [0, 30], [600, 64], [1400, 150], [2600, 330], [4200, 560],
  [6500, 700], [9000, 930], [11500, 1120], [13500, 1220], [16000, 1150],
];
// south-eastern flank, by distance beyond the valley floor
const SE_FLANK: [number, number][] = [[0, -14], [700, 30], [1800, 220], [3500, 560], [6000, 930], [9000, 1150], [12000, 1100]];

export interface SpielbergGeo {
  /** across-valley coordinate: negative toward the circuit's hillside */
  dAx: number;
  /** along-valley coordinate */
  t: number;
  /** uphill distance from the circuit's centre (NW flank) */
  w: number;
}

export function spielbergGeo(map: WorldMap, x: number, z: number): SpielbergGeo {
  const c = map.A.center;
  const X = x - c.x - AX.x, Z = z - c.z - AX.z;
  const dAx = X * NX + Z * NZ;
  const t = X * TX + Z * TZ;
  return { dAx, t, w: -dAx - 2850 };
}

/** the Mur: lateral offset of the river from the valley axis at along-valley t */
function murOffset(t: number): number {
  return 500 + 260 * Math.sin(t / 1300 + 0.7) + 120 * Math.sin(t / 470 - 1.3);
}

/** the regional land (no circuit): the valley floor, its flanks and the mountains */
export function spielbergRegional(map: WorldMap, x: number, z: number): number {
  const { dAx, t, w } = spielbergGeo(map, x, z);
  const c = map.A.center;
  // valley floor: gentle undulation, terraces, fields
  let h = -14 + 2.2 * fbm2(x / 900 + 1.3, z / 900 - 0.6, 3) + 0.8 * fbm2(x / 220, z / 220, 2);
  // the river's shallow trough
  const dm = Math.abs(dAx - murOffset(t));
  h -= 4 * (1 - smoothstep(30, 260, dm));
  // north-western flank: the circuit's own hillside, then the forested hills and the Seckau Alps;
  // the massif rises and falls along the valley, side valleys cut deep into it
  const massif = 0.62 + 0.5 * (fbm2(t / 5200 + 3.3, 0.7, 3) * 0.5 + 0.5);
  const nw = env(NW_FLANK, w) * lerp(1, massif, smoothstep(1500, 5000, w));
  const nwNoise = smoothstep(300, 2500, w);
  const ridges = ridged2(x / 2400 + 0.7, z / 2400 - 2.9, 5, 2.05, 0.5);
  const side = fbm2(x / 1700 - 3.1, z / 1700 + 1.4, 4);
  let nwH = nw + nwNoise * (40 + 0.32 * nw) * (side * 1.1 + (ridges - 0.35) * 1.2);
  // the high Seckau Alps: rocky crests and single peaks far to the north
  const alps = smoothstep(7000, 10500, w);
  if (alps > 0) {
    const m = ridged2(x / 3000 + 5.1, z / 3000 - 0.3, 5, 2.1, 0.52);
    const peaks = Math.pow(fbm2(x / 4200 - 2.2, z / 4200 + 7.4, 3) * 0.5 + 0.5, 2);
    nwH += alps * (400 * m * m + 480 * peaks - 190);
  }
  // side valleys running up into the mountains (Pöls, Gaal / Ingering, Seckau)
  for (const [tv, wid] of [[-3600, 520], [6300, 620], [11200, 560], [-9800, 700]] as const) {
    const bend = 600 * Math.sin(w / 2600 + tv);
    const dv = (t - tv - bend) / (wid + 0.07 * Math.max(0, w));
    const cut = Math.exp(-dv * dv) * smoothstep(900, 2600, w);
    if (cut > 0.01) nwH = lerp(nwH, -14 + 0.07 * Math.max(0, w - 600) + 30 * side, cut * 0.85);
  }
  // south-eastern flank: Gleinalpe / Stubalpe, rounded and wooded
  const se = dAx - 2300;
  const seMass = 0.7 + 0.45 * (fbm2(t / 4800 - 1.9, 4.1, 3) * 0.5 + 0.5);
  let seH = env(SE_FLANK, se) * lerp(1, seMass, smoothstep(800, 3000, se)) + smoothstep(200, 2500, se) * (70 + 0.25 * env(SE_FLANK, se)) * (fbm2(x / 2100 + 7.7, z / 2100 - 4.2, 4) * 1.1 + (ridged2(x / 2800 - 1.9, z / 2800 + 6.1, 4) - 0.35) * 0.9);
  for (const [tv, wid] of [[900, 480], [-5200, 560], [8200, 520]] as const) {
    const dv = (t - tv - 500 * Math.sin(se / 2200 + tv)) / (wid + 0.06 * Math.max(0, se));
    const cut = Math.exp(-dv * dv) * smoothstep(300, 1800, se);
    if (cut > 0.01) seH = lerp(seH, -14 + 0.08 * Math.max(0, se - 300), cut * 0.8);
  }
  // blend: the higher of the two flanks wins (smoothly) over the valley floor
  const k = 30;
  const smax = (a: number, b: number) => {
    const d = a - b;
    return Math.abs(d) > k ? Math.max(a, b) : (a + b) / 2 + (d * d) / (4 * k) + k / 4;
  };
  h = smax(h, nwH);
  h = smax(h, seH);
  // the valley narrows west of Judenburg and bends away north-east past Knittelfeld
  const ends = smoothstep(7500, 13000, -t) * 500 + smoothstep(9000, 14000, t) * 380;
  h += ends * (0.7 + 0.3 * fbm2(x / 3000, z / 3000, 2)) * (1 - smoothstep(-2500, -500, -Math.abs(dAx - 200)) * 0.3);
  void c;
  return h;
}

/** natural land height at (x, z) for the venue (platform = blurred circuit heights) */
export function spielbergNatural(map: WorldMap, x: number, z: number, platform: number, dT: number): number {
  const reg = spielbergRegional(map, x, z);
  // near the circuit the land follows the lap's own heights (the platform), bumpy meadows between
  const near = 1 - smoothstep(140, 620, dT);
  const bumps = (0.35 + 0.65 * smoothstep(40, 300, dT)) * (3.2 * fbm2(x / 260 + 2.3, z / 260 - 4.1, 3) + 1.1 * fbm2(x / 70 - 3.3, z / 70 + 1.9, 2));
  return lerp(reg, platform, near) + bumps + smoothstep(40, 200, dT) * hillWest(map, x, z);
}

/**
 * The grassy hill west of the climb from Turn 1 to Remus (the bull's hill, the natural
 * grandstand): a ridge parallel to the straight, some 350 m out, rising up to ~40 m over it.
 */
const ridgeCache = new WeakMap<WorldMap, { ax: number; az: number; ux: number; uz: number; len: number }>();
function hillWest(map: WorldMap, x: number, z: number): number {
  let r = ridgeCache.get(map);
  if (!r) {
    const tr = map.track;
    const a = tr.point(960, -360, 0), b = tr.point(1760, -330, 0);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    r = { ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len, len };
    ridgeCache.set(map, r);
  }
  const dx = x - r.ax, dz = z - r.az;
  const along = dx * r.ux + dz * r.uz;
  const perp = dx * -r.uz + dz * r.ux;
  const win = smoothstep(-420, 0, along) * (1 - smoothstep(r.len - 100, r.len + 380, along));
  const rise = 0.75 + 0.25 * smoothstep(0, r.len, along);
  return 40 * rise * win * Math.exp(-((perp / 300) ** 2)) * (0.85 + 0.3 * fbm2(x / 400 + 9.1, z / 400 - 3.3, 2));
}

/** the circuit's estate: meadows, car parks and campsites all round it */
export function spielbergPark(map: WorldMap): { cx: number; cz: number; rx: number; rz: number } {
  const { bb, center } = map.A;
  return { cx: center.x + 60, cz: center.z + 80, rx: (bb.x1 - bb.x0) / 2 + 760, rz: (bb.z1 - bb.z0) / 2 + 800 };
}

/** built-up density 0..1: the valley towns */
export function spielbergUrban(map: WorldMap, x: number, z: number): number {
  const c = map.A.center;
  let u = 0;
  const n = fbm2(x / 380 + 7.3, z / 380 - 3.9, 3) * 0.5 + 0.5;
  for (const T of TOWNS) {
    const d = Math.hypot(x - c.x - T.x, z - c.z - T.z);
    if (d > T.r * 1.3) continue;
    u = Math.max(u, (1 - smoothstep(T.r * 0.35, T.r * 1.15, d + (n - 0.5) * T.r * 0.5)));
  }
  // not on the circuit estate, not up the mountains
  u *= 1 - smoothstep(-0.05, 0.1, -map.parkDistance(x, z) / 300);
  const { dAx } = spielbergGeo(map, x, z);
  u *= 1 - smoothstep(-3300, -4200, dAx) * 0.8;
  return clamp(smoothstep(0.3, 0.6, u), 0, 1);
}

/**
 * Forest density 0..1: spruce and larch on the hills behind the circuit and on every
 * mountainside up to the treeline, open meadows and car parks on the circuit estate, fields
 * on the valley floor with copses, hedgerows and the alders along the Mur.
 */
export function spielbergForest(map: WorldMap, x: number, z: number): number {
  const { dAx, t, w } = spielbergGeo(map, x, z);
  const dT = map.distToTrack(x, z);
  const n1 = fbm2(x / 520 + 11.3, z / 520 - 7.7, 4);
  const n2 = fbm2(x / 170 - 2.3, z / 170 + 6.1, 3);
  // the hillside forest begins a few hundred metres up behind the circuit, with pasture clearings
  const hill = smoothstep(250, 650, w + 420 * n1 + 110 * n2);
  const pasture = smoothstep(0.62, 0.75, fbm2(x / 640 - 4.4, z / 640 + 2.2, 3) * 0.5 + 0.5) * (1 - smoothstep(2500, 5000, w));
  let f = hill * smoothstep(0.28, 0.46, 0.55 + 0.4 * n1 + 0.14 * n2) * (1 - pasture * 0.9);
  // the southern mountains
  f = Math.max(f, smoothstep(2500, 3200, dAx + 200 * n1) * smoothstep(0.25, 0.42, 0.55 + 0.4 * n1 + 0.12 * n2));
  // treeline (~1850 m above the sea, +1150 here)
  if (w > 5000 || dAx > 5000) f *= 1 - smoothstep(1060, 1240, spielbergRegional(map, x, z) + 120 * n2);
  // valley floor and the circuit estate: copses and hedgerows, the alder belt along the river
  const copse = smoothstep(0.69, 0.73, fbm2(x / 300 + 1.9, z / 300 - 4.4, 3) * 0.5 + 0.5 + 0.08 * n2);
  const river = 1 - smoothstep(40, 110, Math.abs(dAx - murOffset(t)));
  // tree lines along the field edges and lanes (only where real trees get planted: inside the square)
  const S = map.SQUARE;
  const inSq = x > S.x0 + 60 && x < S.x1 - 60 && z > S.z0 + 60 && z < S.z1 - 60;
  const hedge = inSq ? smoothstep(0.972, 0.99, 1 - Math.abs(fbm2(x / 520 - 6.1, z / 520 + 3.3, 2))) * 0.8 * smoothstep(-0.2, 0.2, fbm2(x / 900 + 2.2, z / 900, 2)) : 0;
  f = Math.max(f, copse * 0.85, river * 0.85, hedge);
  // the estate right round the track: mostly open (fences, banks, car parks), a few wooded patches
  const estate = 1 - smoothstep(-40, 160, map.parkDistance(x, z));
  f = lerp(f, Math.max(f * 0.5, smoothstep(0.76, 0.8, 0.5 + 0.45 * n1 + 0.2 * n2) * 0.8), estate * (1 - hill));
  // open grass round the track (the woods only come close on the outside of the run along the top)
  f *= Math.max(smoothstep(34, 105, dT) * smoothstep(750, 1000, w), smoothstep(70, 190, dT));
  f *= map.clearingKeep(x, z);
  f *= 1 - smoothstep(0.15, 0.45, spielbergUrban(map, x, z));
  // woods and copses, not a savanna: no thin scatter of lone trees over the meadows
  return f < 0.22 ? 0 : clamp(f, 0, 1);
}

/**
 * Tree species: spruce (with the larch) on the hillsides and mountains, beech stands (the
 * chestnut crowns stand in) mixed in; ash, lime and oak in the valley copses, poplars and
 * alders along the Mur.
 */
export function spielbergSpecies(map: WorldMap, x: number, z: number, n: number, n2: number, h: number): 'plane' | 'oak' | 'chestnut' | 'poplar' | 'spruce' {
  const { dAx, t, w } = spielbergGeo(map, x, z);
  const hill = Math.max(smoothstep(250, 650, w), smoothstep(2400, 2900, dAx));
  if (Math.abs(dAx - murOffset(t)) < 120) return h > 0.4 ? 'poplar' : 'plane';
  if (h < hill * 0.8 || n < -0.3 + 0.5 * hill) return 'spruce';
  return n2 > 0.1 ? 'chestnut' : n2 > -0.2 ? 'oak' : 'plane';
}

// ---------------------------------------------------------------------------- layout

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

/**
 * Stands, banks and landmarks: the Start-Ziel grandstand opposite the pits on the climb to
 * Turn 1, the big stand on the outside of the Niki Lauda Kurve and the grass hillside behind
 * it with the steel bull, the Steiermark stand at Remus, the Schlossgold stand, fans on the
 * natural banks all round the top of the hill and down through Rauch and Würth, the Red Bull
 * stand at the last corner; the paddock's hangar domes behind the pits.
 */
export function planSpielberg(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t10 = corner('Red Bull Mobile');
  const t1 = corner('Niki Lauda');
  const t3 = corner('Remus');
  const t4 = corner('Schlossgold');
  const t6 = corner('Rauch');
  const t7 = corner('Würth');
  const t8 = corner('Turn 8');
  const t9 = corner('Jochen Rindt');

  // the pit straight: Start-Ziel grandstand opposite the pits, climbing toward Turn 1
  addStand('Start-Ziel', 360, 790, L, 26, 'centrale', 8, 90);
  // Turn 1: the Red Bull grandstand on the outside of the Niki Lauda Kurve
  addStand('Red Bull', t1.sStart - 150, t1.sApex - 6, L, 22, 'covered', 8, 70);
  // Remus, the top hairpin: the Steiermark stand in the braking zone
  addStand('Steiermark', t3.sStart - 170, t3.sStart - 8, L, 20, 'covered', 8, 70);
  // Schlossgold
  addStand('Schlossgold', t4.sStart - 140, t4.sStart - 6, L, 18, 'covered', 8, 70);
  // Rauch / Würth: open stands on the hillside outside the lefts
  addStand('Rauch', t6.sStart - 120, t6.sApex - 10, R, 14, 'open', 8, 60);
  addStand('Würth', t7.sStart - 60, t7.sApex + 20, R, 14, 'open', 8, 60);
  // the last two corners
  addStand('Jochen Rindt', t9.sStart - 140, t9.sStart - 10, L, 16, 'covered', 8, 70);
  addStand('Red Bull Mobile', t10.sEnd + 20, t10.sEnd + 60, L, 16, 'open', 8, 50);

  // natural grandstands: the hillsides are one big spectator bank
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
  // the climb from Turn 1 to Remus: the long hillside bank on the outside, and the infield
  addBank(t1.sEnd + 40, t1.sEnd + 330, L, 2.6, 0.9, 6, 22);
  addBank(t1.sEnd + 420, t3.sStart - 200, L, 2.2, 0.75, 6, 20);
  addBank(t1.sEnd + 60, t1.sEnd + 400, R, 1.8, 0.6, 5, 16);
  // round the top of the hill: behind Remus, and the run along the top to Schlossgold
  addBank(t3.sEnd + 30, t3.sEnd + 330, L, 2.4, 0.8, 6, 20);
  addBank(t3.sEnd + 420, t4.sStart - 170, L, 2.0, 0.65, 6, 18);
  addBank(t3.sEnd + 80, t3.sEnd + 420, R, 1.6, 0.55, 5, 16);
  // Schlossgold exit and the long right down to Rauch
  addBank(t4.sEnd + 10, t4.sEnd + 220, L, 2.0, 0.7, 6, 18);
  addBank(t6.sEnd + 20, t7.sStart - 40, R, 1.8, 0.6, 5, 16);
  addBank(t7.sEnd + 10, t8.sStart - 10, L, 1.6, 0.55, 5, 14);
  // Turn 8 to Rindt: the valley bank
  addBank(t8.sEnd + 40, t8.sEnd + 330, L, 1.8, 0.6, 6, 18);
  addBank(t9.sEnd + 10, t10.sStart - 10, L, 1.8, 0.7, 6, 16);

  // open ground: paddock behind the pits, car parks and campsites, the infield meadows
  for (let s = 300; s <= 840; s += 40) { const q = at(s, 128); clear(q.x, q.z, 48, 28, 0.1); }
  for (let s = 340; s <= 820; s += 60) { const q = at(s, -112); clear(q.x, q.z, 46, 26, 0.12); }
  for (const [s, lat, r] of [[t1.sApex, -120, 50], [t3.sApex, -110, 45], [t4.sApex, -100, 45], [t9.sApex, -100, 45]] as const) {
    const q = at(s, lat);
    clear(q.x, q.z, r, 30, 0.2);
  }

  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // service road behind the Start-Ziel stand, spectator walkways along the banks
  map.paths.push({ pts: trackLine(300, 900, (s) => -(track.barrierAt(s, -1) + 60), 12), width: 7, kind: 2 });
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(t1.sEnd + 30, t3.sStart - 180, L, 34);
  walk(t3.sEnd + 20, t4.sStart - 150, L, 32);
  walk(t6.sEnd, t8.sStart, R, 28);
  // the old Zeltweg airbase runway on the valley floor (Hinterstoisser air base)
  {
    const c = map.A.center;
    const ang = -0.28;
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const pts: V2[] = [];
    for (let d = -1300; d <= 1300; d += 50) pts.push({ x: c.x - 1300 + ux * d, z: c.z + 2150 + uz * d });
    map.paths.push({ pts, width: 44, kind: 2 });
    const taxi: V2[] = [];
    for (let d = -1100; d <= 1100; d += 50) taxi.push({ x: c.x - 1300 + ux * d - uz * 180, z: c.z + 2150 + uz * d + ux * 180 });
    map.paths.push({ pts: taxi, width: 16, kind: 2 });
  }

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
  screenAt(870, R, 580, L, 40, 14, 8, 30);
  screenAt(t1.sEnd + 60, R, t1.sEnd + 150, L, 40);
  screenAt(t3.sStart - 60, R, t3.sStart - 80, L, 40);
  screenAt(t4.sStart - 60, R, t4.sStart - 80, L, 40);
  screenAt(t6.sApex + 40, L, t6.sApex + 60, R, 40, 10, 6);
  screenAt(t9.sStart - 70, R, t9.sStart - 80, L, 40, 10, 6);

  const flagpoles: V2[] = [];
  for (const g of gs) {
    if (g.style === 'open') continue;
    const n = Math.max(2, Math.round(g.length / 24));
    for (let k = 0; k <= n; k++) {
      const tt = k / n - 0.5;
      const along = new THREE.Vector3(g.facing.z, 0, -g.facing.x);
      flagpoles.push({ x: g.center.x + along.x * tt * g.length - g.facing.x * (g.depth / 2 + 1.5), z: g.center.z + along.z * tt * g.length - g.facing.z * (g.depth / 2 + 1.5) });
    }
  }

  // villages: Spielberg, Flatschach and the farming hamlets on the valley floor round the circuit
  const villages: Layout['villages'] = [];
  {
    const c = map.A.center;
    const spots: [number, number, number][] = [[2300, 650, 520], [1500, -900, 220], [-700, 2900, 480], [1300, 1900, 240], [-2300, 900, 200], [2900, -1600, 220]];
    spots.forEach(([dx, dz, rr], i) => villages.push({ x: c.x + dx, z: c.z + dz, r: rr, seed: 83 + i * 41 }));
    for (const v of villages) map.clearings.push({ x: v.x, z: v.z, r: v.r, soft: 80, keep: 0 });
  }

  // landmarks
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[330, -1], [560, -1], [760, -1]], 96);
  addCameraTowers(track, map, landmarks, ['Niki Lauda', 'Remus', 'Schlossgold', 'Rauch', 'Würth', 'Jochen Rindt', 'Red Bull Mobile']);
  planSpielbergLandmarks(track, map, SPIELBERG_SPOTS);

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
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages, landmarks };
}

/** where the venue's own landmarks go (filled in by planSpielberg, read by the scenery builder) */
export interface SpielbergSpots {
  /** the steel bull on the hillside behind Turn 1 (ground height, facing yaw) */
  bull: { x: number; z: number; y: number; rot: number } | null;
  /** the paddock's hangar domes behind the pits */
  hangars: { x: number; z: number; y: number; rot: number; len: number; span: number }[];
  /** farmsteads on the valley floor and the lower slopes */
  farms: { x: number; z: number; y: number; rot: number; size: number }[];
  /** onion-domed village churches */
  churches: { x: number; z: number; y: number; rot: number }[];
  /** the fans' car parks and campsites on the meadows round the estate (centre, yaw, half sizes) */
  lots: { x: number; z: number; rot: number; hw: number; hl: number; camp: boolean }[];
}

export const SPIELBERG_SPOTS: SpielbergSpots = { bull: null, hangars: [], farms: [], churches: [], lots: [] };

function planSpielbergLandmarks(track: Track, map: WorldMap, out: SpielbergSpots) {
  out.bull = null;
  out.hangars.length = 0;
  out.farms.length = 0;
  out.churches.length = 0;
  out.lots.length = 0;
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const yawAt = (s: number) => {
    const f = track.frame(s);
    return Math.atan2(f.tangent.x, f.tangent.z);
  };
  // the bull: on the grass hillside outside the climb out of Turn 1, looking down at the track
  {
    const s = 1010;
    const q = at(s, -(track.barrierAt(s, -1) + 70));
    // side-on to the grid: it charges across the hillside, so the pit straight sees its profile
    const grid = at(620, 0);
    const toGrid = Math.atan2(grid.x - q.x, grid.z - q.z);
    const rot = toGrid + Math.PI / 2 + 0.35;
    const y = map.naturalExact(q.x, q.z) + 3;
    out.bull = { x: q.x, z: q.z, y, rot };
    map.worldPads.push({ cx: q.x, cz: q.z, halfW: 16, halfL: 16, angle: rot, h: y, blend: 26 });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 14, halfL: 14, angle: rot });
    map.clearings.push({ x: q.x, z: q.z, r: 34, soft: 30, keep: 0.05 });
  }
  // the hangar domes in the paddock, behind the pit building (flat ground carved into the hill)
  {
    const pit = track.pit;
    for (const [s, len, span] of [[440, 62, 34], [640, 78, 40]] as const) {
      const q = at(s, pit.side * (146 + span / 2));
      const rot = yawAt(s);
      const y = track.heightAt(s) - 0.1;
      out.hangars.push({ x: q.x, z: q.z, y, rot, len, span });
      map.worldPads.push({ cx: q.x, cz: q.z, halfW: span / 2 + 6, halfL: len / 2 + 6, angle: rot, h: y, blend: 30, paved: true });
      map.exclusions.push({ cx: q.x, cz: q.z, halfW: span / 2 + 4, halfL: len / 2 + 4, angle: rot });
      map.clearings.push({ x: q.x, z: q.z, r: len / 2 + 20, soft: 20, keep: 0.05 });
    }
  }
  // farmsteads: scattered over the valley floor and the lower meadows (never on the estate or in town)
  {
    const c = map.A.center;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let tries = 0;
    while (out.farms.length < 70 && tries++ < 4000) {
      const x = c.x + (rnd() - 0.5) * 5800, z = c.z + (rnd() - 0.5) * 5800;
      if (map.parkDistance(x, z) < 60) continue;
      if (spielbergUrban(map, x, z) > 0.1) continue;
      const { dAx, w } = spielbergGeo(map, x, z);
      if (w > 2600 || dAx > 2600) continue;
      if (map.excluded(x, z, 30)) continue;
      if (map.pathDistance(x, z).d < 20) continue;
      if (out.farms.some((f) => (f.x - x) ** 2 + (f.z - z) ** 2 < 170 * 170)) continue;
      const y = map.naturalExact(x, z);
      const rot = Math.round(fbm2(x / 900, z / 900, 2) * 3) * 0.5 + rnd() * 0.2;
      const size = 0.85 + rnd() * 0.4;
      out.farms.push({ x, z, y, rot, size });
      map.worldPads.push({ cx: x, cz: z, halfW: 22 * size, halfL: 16 * size, angle: rot, h: y, blend: 16 });
      map.exclusions.push({ cx: x, cz: z, halfW: 20 * size, halfL: 14 * size, angle: rot });
      map.clearings.push({ x, z, r: 30, soft: 20, keep: 0.1 });
    }
  }
  // car parks and campsites: flat-ish open meadows 150–650 m from the track (the Austrian GP's
  // famous camping), spaced out, never in the woods or on the stands' pads
  {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const P = new THREE.Vector3();
    for (let tries = 0; tries < 900 && out.lots.length < 9; tries++) {
      const s = rnd() * track.length;
      const side = rnd() < 0.5 ? -1 : 1;
      const d = 150 + rnd() * 500;
      track.point(s, side * (track.barrierAt(s, side) + d), 0, P);
      if (map.distToTrack(P.x, P.z) < 130 || map.inPitZone(P.x, P.z, 60)) continue;
      const camp = out.lots.length % 3 === 1;
      const hw = camp ? 70 : 55, hl = camp ? 95 : 80;
      const rot = yawAt(s) + (rnd() - 0.5) * 0.4;
      const ca = Math.cos(rot), sa = Math.sin(rot);
      let ok = true, lo = Infinity, hi = -Infinity;
      for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const x = P.x + u * hw * ca + v * hl * sa, z = P.z - u * hw * sa + v * hl * ca;
        if (map.excluded(x, z, 20) || map.distToTrack(x, z) < 90 || map.forest(x, z) > 0.05 || map.pathDistance(x, z).d < 6) { ok = false; break; }
        const h = map.naturalExact(x, z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (!ok || hi - lo > 14) continue;
      if (out.lots.some((l) => (l.x - P.x) ** 2 + (l.z - P.z) ** 2 < 260 * 260)) continue;
      out.lots.push({ x: P.x, z: P.z, rot, hw, hl, camp });
      map.exclusions.push({ cx: P.x, cz: P.z, halfW: hw + 4, halfL: hl + 4, angle: rot });
    }
  }
  // village churches: Spielberg, Flatschach, Zeltweg
  {
    const c = map.A.center;
    for (const [dx, dz] of [[2250, 600], [1500, -880], [-650, 3200]] as const) {
      const x = c.x + dx, z = c.z + dz;
      const y = map.naturalExact(x, z);
      out.churches.push({ x, z, y, rot: 0.3 });
      map.worldPads.push({ cx: x, cz: z, halfW: 16, halfL: 26, angle: 0.3, h: y, blend: 14 });
      map.exclusions.push({ cx: x, cz: z, halfW: 18, halfL: 28, angle: 0.3 });
    }
  }
}

/** hospitality suites: two-storey glass pavilions behind the stands, at (s, side) `back` m beyond the barrier */
function addHospitality(track: Track, map: WorldMap, out: Landmark[], spots: [number, number][], back: number) {
  for (const [s, side] of spots) {
    const q = track.point(s, side * (track.barrierAt(s, side) + back), 0, new THREE.Vector3());
    const f = track.frame(s);
    const yaw = Math.atan2(f.tangent.x, f.tangent.z) + Math.PI / 2;
    if (map.excluded(q.x, q.z, 6) || map.trackClearance(q.x, q.z) < 20 || map.inPitZone(q.x, q.z, 30)) continue;
    const y = map.naturalExact(q.x, q.z);
    out.push({ kind: 'hospitality', x: q.x, z: q.z, y, rot: yaw, size: 44 });
    map.worldPads.push({ cx: q.x, cz: q.z, halfW: 25, halfL: 11, angle: yaw, h: y, blend: 14, paved: true });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 26, halfL: 12, angle: yaw });
    map.clearings.push({ x: q.x, z: q.z, r: 30, soft: 16, keep: 0.1 });
  }
}

/** scaffold TV towers on the outside of the named corners, well back from the fence */
function addCameraTowers(track: Track, map: WorldMap, out: Landmark[], names: string[]) {
  for (const name of names) {
    const c = track.corners.find((k) => k.name === name);
    if (!c) continue;
    let q: THREE.Vector3 | null = null;
    for (const [side, ds, back] of [[c.dir, -25, 14], [-c.dir, -10, 12], [c.dir, -60, 20], [-c.dir, -50, 18]] as const) {
      const s = c.sStart + ds;
      const pp = track.point(s, side * (track.barrierAt(s, side) + back), 0, new THREE.Vector3());
      if (map.excluded(pp.x, pp.z, 3) || map.trackClearance(pp.x, pp.z) < 8 || map.inPitZone(pp.x, pp.z, 10)) continue;
      q = pp;
      break;
    }
    if (!q) continue;
    const look = track.point(c.sApex, 0, 0, new THREE.Vector3());
    out.push({ kind: 'cameraTower', x: q.x, z: q.z, y: 0, rot: Math.atan2(look.x - q.x, look.z - q.z), size: 9 });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 3, halfL: 3, angle: 0 });
    map.clearings.push({ x: q.x, z: q.z, r: 8, soft: 6, keep: 0.2 });
  }
}

// ---------------------------------------------------------------------------- flags

/**
 * Flag atlas slots 0–3 for the Austrian GP: the red-white-red, the Styrian green and white,
 * the Dutch orange army's ORANJE banner and a SPIELBERG banner.
 */
export function drawSpielbergFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number, txt: (x: number, y: number, s: string, size: number, col: string) => void) {
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S / 3, S, S / 3);
  }
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#1f8a3a';
    ctx.fillRect(x, y + S / 2, S, S / 2);
  }
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#ff7b00';
    ctx.fillRect(x, y, S, S);
    txt(x + S / 2, y + S * 0.48, 'ORANJE', 58, '#ffffff');
  }
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S * 0.3, S, S * 0.4);
    txt(x + S / 2, y + S * 0.5, 'SPIELBERG', 44, '#c8102e');
  }
}

/** Austrian crowd: red-white-red, the Dutch orange army, Red Bull navy */
export const SPIELBERG_FAN_COLOURS = {
  austria: ['#c8102e', '#e0182d', '#ffffff', '#f4f4f4', '#a50d22'],
  oranje: ['#ff7b00', '#ff8c1a', '#f26b00', '#ff9933', '#e86a10'],
  redbull: ['#1e2a4a', '#223971', '#db0a40', '#ffcc00'],
};
