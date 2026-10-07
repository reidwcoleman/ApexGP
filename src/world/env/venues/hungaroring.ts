import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { fbm2 } from '../noise.ts';
import { HUNGARORING_TOWNS, hungaroringM3, hungaroringUrban } from './hungaroringLand.ts';
import { planHungaroringDress } from './hungaroringDress.ts';

/**
 * The Hungaroring's stands, banks and landmarks (the land itself is in hungaroringLand.ts).
 *
 * The real thing: the covered Super Gold grandstand opposite the pits, the Gold stands round
 * the outside of Turn 1, the Silver stands at Turns 2–3 and the Bronze stands out on the hill,
 * and between them the grass hillsides that make the valley a natural amphitheatre, crowded
 * with fans on blankets and under parasols. Car parks and campsites on the fields round the
 * estate, the M3 motorway to the south, Mogyoród's red roofs to the north-west.
 */

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

export function planHungaroring(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t1 = corner('Turn 1');
  const t2 = corner('Turn 2');
  const t3 = corner('Turn 3');
  const t4 = corner('Turn 4');
  const t5 = corner('Turn 5');
  const t6 = corner('Turn 6');
  const t9 = corner('Turn 9');
  const t11 = corner('Turn 11');
  const t12 = corner('Turn 12');
  const t13 = corner('Turn 13');
  const t14 = corner('Turn 14');

  // the pit straight: the covered Super Gold grandstand opposite the pits
  addStand('Super Gold', 430, 900, L, 26, 'centrale', 8, 94);
  // Turn 1: the Gold stands round the outside of the braking zone and the hairpin
  addStand('Gold', 912, t1.sApex - 6, L, 22, 'covered', 8, 64);
  // Turn 2: the Silver stands on the outside of the braking zone, another at Turn 3's exit
  addStand('Silver', t2.sStart - 150, t2.sStart - 6, R, 18, 'covered', 8, 72);
  addStand('Silver 3', t3.sEnd + 10, t3.sEnd + 110, L, 14, 'open', 8, 50);
  // out on the hill: Bronze at the Turn 4 crest and the chicane
  addStand('Bronze', t4.sStart - 120, t4.sStart - 6, R, 14, 'open', 8, 60);
  addStand('Bronze 2', t6.sStart - 140, t6.sStart - 6, L, 16, 'covered', 8, 70);
  // the end of the back straight: Turn 12, Turn 13
  addStand('Red', t12.sStart - 150, t12.sStart - 6, L, 18, 'covered', 8, 72);
  addStand('Platinum', t13.sStart - 100, t13.sApex - 10, R, 14, 'open', 8, 60);

  // the valley's grass hillsides: one great natural grandstand
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
  // Turn 1's exit and the long drop to Turn 2: the hillside on the outside
  addBank(t1.sEnd + 40, t2.sStart - 70, L, 2.6, 0.9, 6, 24);
  // round Turn 2 and on to Turn 3 (outside of the hairpin)
  addBank(t2.sApex + 20, t3.sStart - 12, R, 2.2, 0.8, 5, 18);
  // the back straight: the big western hillside, and the infield opposite
  addBank(t3.sEnd + 130, t4.sStart - 40, L, 2.6, 0.85, 6, 26);
  addBank(t3.sEnd + 60, t4.sStart - 30, R, 1.8, 0.6, 5, 16);
  // over the Turn 4 crest to the top of the hill, round the outside of Turn 5
  addBank(t4.sEnd + 20, t5.sStart - 10, R, 2.0, 0.7, 5, 18);
  addBank(t5.sStart + 10, t5.sEnd - 10, L, 2.4, 0.8, 6, 22);
  // the S and Turn 9, Turn 11's hillside
  addBank(t6.sEnd + 60, t9.sStart - 20, R, 1.8, 0.6, 5, 16);
  addBank(t9.sStart + 10, t9.sEnd + 40, L, 2.0, 0.7, 6, 18);
  addBank(t11.sStart - 60, t11.sEnd + 20, L, 2.2, 0.75, 6, 20);
  // the back straight down to Turn 12: the infield knoll
  addBank(t11.sEnd + 60, t12.sStart - 40, R, 1.8, 0.6, 5, 18);
  // Turn 14 onto the straight (inside)
  addBank(t14.sStart + 10, t14.sEnd - 20, R, 1.6, 0.55, 5, 14);

  // open ground: the paddock behind the pits, behind the Super Gold, the infield lawns
  for (let s = 460; s <= 920; s += 40) { const q = at(s, 70); clear(q.x, q.z, 34, 20, 0.1); }
  for (let s = 420; s <= 900; s += 60) { const q = at(s, -(track.barrierAt(s, -1) + 70)); clear(q.x, q.z, 46, 26, 0.12); }
  for (const [s, lat, r] of [[t1.sApex, -110, 50], [t2.sApex, 90, 45], [t5.sApex, -100, 50], [t12.sApex, -90, 45]] as const) {
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
  // service road behind the Super Gold, spectator walkways along the banks
  map.paths.push({ pts: trackLine(330, 1000, (s) => -(track.barrierAt(s, -1) + 58), 12), width: 7, kind: 2 });
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(t1.sEnd + 30, t2.sStart - 60, L, 36);
  walk(t3.sEnd + 120, t4.sStart - 30, L, 38);
  walk(t5.sStart, t5.sEnd, L, 34);
  walk(t11.sStart - 60, t11.sEnd + 40, L, 32);
  // the M3 motorway along the valley south of the circuit, and the road up to the circuit
  {
    const c = map.A.center;
    const m3: V2[] = [];
    for (let x = -3000; x <= 3000; x += 40) m3.push({ x: c.x + x, z: c.z + hungaroringM3(x) });
    map.paths.push({ pts: m3, width: 30, kind: 2 });
    // the access road from the M3 junction up past the car parks to the main gate behind the Super Gold
    const gate = at(640, -(track.barrierAt(640, -1) + 58));
    const pts: V2[] = [];
    const jx = gate.x - c.x - 250;
    const j = { x: c.x + jx, z: c.z + hungaroringM3(jx) - 20 };
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const bend = Math.sin(t * Math.PI) * 90;
      pts.push({ x: j.x + (gate.x - j.x) * t + bend * 0.6, z: j.z + (gate.z - j.z) * t });
    }
    map.paths.push({ pts, width: 9, kind: 2 });
    // the old road north to Mogyoród
    const mog = HUNGARORING_TOWNS[0];
    const from = at(t5.sApex, -(track.barrierAt(t5.sApex, -1) + 60));
    const road: V2[] = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      road.push({ x: from.x + (c.x + mog.x - from.x) * t + 70 * Math.sin(t * 5.2), z: from.z + (c.z + mog.z - from.z) * t });
    }
    map.paths.push({ pts: road, width: 7, kind: 2 });
  }

  // big screens facing the stands and banks
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
  screenAt(t1.sEnd + 40, R, t1.sApex - 60, L, 40, 12, 7, 10);
  screenAt(t2.sStart - 40, L, t2.sStart - 80, R, 40);
  screenAt(t4.sStart + 20, L, t4.sStart - 60, R, 40);
  screenAt(t6.sApex + 30, R, t6.sStart - 70, L, 40, 10, 6);
  screenAt(t12.sStart + 10, R, t12.sStart - 80, L, 40);

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

  // villages: Mogyoród and its neighbours (houses come from the urban mask; these are the centres)
  const villages: Layout['villages'] = [];
  {
    const c = map.A.center;
    HUNGARORING_TOWNS.forEach((T, i) => villages.push({ x: c.x + T.x, z: c.z + T.z, r: T.r * 0.6, seed: 141 + i * 37 }));
  }

  // landmarks
  const landmarks: Landmark[] = [];
  // the venue's own footbridges (hungaroringDress.ts): their ground reserved before the hospitality and the trees
  planHungaroringDress(track, map, gs, banks);
  addHospitality(track, map, landmarks, [[470, -1], [700, -1], [t1.sStart - 30, -1]], 92);
  addCameraTowers(track, map, landmarks, ['Turn 1', 'Turn 2', 'Turn 4', 'Turn 5', 'Turn 6', 'Turn 9', 'Turn 11', 'Turn 12', 'Turn 13', 'Turn 14']);
  planHungaroringSpots(track, map, HUNGARORING_SPOTS);

  const pit = track.pit;
  const pitSpec = {
    sA: pit.sStart,
    sB: pit.sEnd,
    side: pit.side,
    front: pit.garageOffset + 0.5,
    depth: 26,
    paddockTo: pit.paddock,
    y0: track.heightAt(pit.sStart),
    y1: track.heightAt(pit.sEnd),
  };
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages, landmarks };
}

// ---------------------------------------------------------------------------- venue spots

/** where the venue's own landmarks go (filled in by planHungaroring, read by the scenery builder) */
export interface HungaroringSpots {
  /** whitewashed farmsteads with red-tile roofs out in the fields */
  farms: { x: number; z: number; y: number; rot: number; size: number }[];
  /** village churches (white tower, dark spire) */
  churches: { x: number; z: number; y: number; rot: number }[];
  /** car parks and campsites on the fields round the estate (centre, yaw, half sizes) */
  lots: { x: number; z: number; rot: number; hw: number; hl: number; camp: boolean }[];
}

export const HUNGARORING_SPOTS: HungaroringSpots = { farms: [], churches: [], lots: [] };

/** a parasol on the hillside banks (ground height; `c` seeds its colour) */
export interface Parasol { x: number; z: number; y: number; c: number }

function planHungaroringSpots(track: Track, map: WorldMap, out: HungaroringSpots) {
  out.farms.length = 0;
  out.churches.length = 0;
  out.lots.length = 0;
  const c = map.A.center;
  const yawAt = (s: number) => {
    const f = track.frame(s);
    return Math.atan2(f.tangent.x, f.tangent.z);
  };
  // farmsteads (tanya): scattered over the farmland, never on the estate or in the villages
  {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let tries = 0;
    while (out.farms.length < 46 && tries++ < 4000) {
      const x = c.x + (rnd() - 0.5) * 5800, z = c.z + (rnd() - 0.5) * 5800;
      if (map.parkDistance(x, z) < 80) continue;
      if (hungaroringUrban(map, x, z) > 0.05) continue;
      if (Math.abs(z - c.z - hungaroringM3(x - c.x)) < 120) continue;
      if (map.excluded(x, z, 30)) continue;
      if (map.pathDistance(x, z).d < 20) continue;
      if (out.farms.some((f) => (f.x - x) ** 2 + (f.z - z) ** 2 < 220 * 220)) continue;
      const y = map.naturalExact(x, z);
      const rot = Math.round(fbm2(x / 900, z / 900, 2) * 3) * 0.5 + rnd() * 0.2;
      const size = 0.85 + rnd() * 0.35;
      out.farms.push({ x, z, y, rot, size });
      map.worldPads.push({ cx: x, cz: z, halfW: 22 * size, halfL: 16 * size, angle: rot, h: y, blend: 16 });
      map.exclusions.push({ cx: x, cz: z, halfW: 20 * size, halfL: 14 * size, angle: rot });
      map.clearings.push({ x, z, r: 30, soft: 20, keep: 0.1 });
    }
  }
  // car parks and campsites: the flat fields 140–600 m out
  {
    let seed = 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const P = new THREE.Vector3();
    for (let tries = 0; tries < 1000 && out.lots.length < 10; tries++) {
      const s = rnd() * track.length;
      const side = rnd() < 0.5 ? -1 : 1;
      const d = 140 + rnd() * 460;
      track.point(s, side * (track.barrierAt(s, side) + d), 0, P);
      if (map.distToTrack(P.x, P.z) < 120 || map.inPitZone(P.x, P.z, 60)) continue;
      const camp = out.lots.length % 3 === 1;
      const hw = camp ? 70 : 55, hl = camp ? 95 : 80;
      const rot = yawAt(s) + (rnd() - 0.5) * 0.4;
      const ca = Math.cos(rot), sa = Math.sin(rot);
      let ok = true, lo = Infinity, hi = -Infinity;
      for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const x = P.x + u * hw * ca + v * hl * sa, z = P.z - u * hw * sa + v * hl * ca;
        if (map.excluded(x, z, 20) || map.distToTrack(x, z) < 80 || map.forest(x, z) > 0.05 || map.pathDistance(x, z).d < 6) { ok = false; break; }
        const h = map.naturalExact(x, z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (!ok || hi - lo > 12) continue;
      if (out.lots.some((l) => (l.x - P.x) ** 2 + (l.z - P.z) ** 2 < 240 * 240)) continue;
      out.lots.push({ x: P.x, z: P.z, rot, hw, hl, camp });
      map.exclusions.push({ cx: P.x, cz: P.z, halfW: hw + 4, halfL: hl + 4, angle: rot });
    }
  }
  // village churches: Mogyoród, Kerepes, Szada, Fót
  for (const k of [0, 2, 4, 1]) {
    const T = HUNGARORING_TOWNS[k];
    const x = c.x + T.x + 40, z = c.z + T.z - 30;
    const y = map.naturalExact(x, z);
    out.churches.push({ x, z, y, rot: 0.25 + k * 0.4 });
    map.worldPads.push({ cx: x, cz: z, halfW: 16, halfL: 26, angle: 0.25 + k * 0.4, h: y, blend: 14 });
    map.exclusions.push({ cx: x, cz: z, halfW: 20, halfL: 30, angle: 0.25 + k * 0.4 });
  }
}

/** parasols on the banks: called by the scenery once heights are baked (the banks' pads are in) */
export function hungaroringParasols(track: Track, map: WorldMap, banks: SpectatorBank[]): Parasol[] {
  const out: Parasol[] = [];
  let seed = 29;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const P = new THREE.Vector3();
  for (const b of banks) {
    const len = track.delta(b.sA, b.sB);
    const n = Math.round((len / 9) * b.density);
    for (let k = 0; k < n; k++) {
      const s = b.sA + rnd() * len;
      const lat = b.latA + (b.latB - b.latA) * (0.25 + rnd() * 0.9);
      track.point(s, lat, 0, P);
      if (map.excluded(P.x, P.z, 1)) continue;
      out.push({ x: P.x, z: P.z, y: map.height(P.x, P.z), c: Math.floor(rnd() * 1e6) });
    }
  }
  return out;
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

// ---------------------------------------------------------------------------- flags & fans

/**
 * Flag atlas slots 0–3 for the Hungarian GP: the red-white-green tricolour, a HAJRÁ banner
 * (Hungarian: "go!"), the Dutch orange army's ORANJE banner and the Finnish blue cross (the
 * Finns have made the Hungaroring their home race for decades).
 */
export function drawHungaroringFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number, txt: (x: number, y: number, s: string, size: number, col: string) => void) {
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#ce2939';
    ctx.fillRect(x, y, S, S / 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S / 3, S, S / 3);
    ctx.fillStyle = '#477050';
    ctx.fillRect(x, y + (2 * S) / 3, S, S / 3 + 1);
  }
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#ce2939';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S * 0.3, S, S * 0.4);
    txt(x + S / 2, y + S * 0.5, 'HAJRÁ', 64, '#ce2939');
  }
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#ff7b00';
    ctx.fillRect(x, y, S, S);
    txt(x + S / 2, y + S * 0.48, 'ORANJE', 58, '#ffffff');
  }
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#002f6c';
    ctx.fillRect(x + S * 0.28, y, S * 0.18, S);
    ctx.fillRect(x, y + S * 0.41, S, S * 0.18);
  }
}

/** Hungarian crowd: red-white-green, the Dutch orange army, the Finns' blue and white */
export const HUNGARORING_FAN_COLOURS = {
  hungary: ['#ce2939', '#e03a48', '#ffffff', '#f4f4f4', '#477050', '#3a6443'],
  oranje: ['#ff7b00', '#ff8c1a', '#f26b00', '#ff9933', '#e86a10'],
  finland: ['#002f6c', '#ffffff', '#1a4a8a'],
};
