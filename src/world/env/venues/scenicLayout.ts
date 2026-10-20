import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import { addCameraTowers, addHospitality, type GrandstandSpec, type Landmark, type Layout, type ScreenSpec, type SpectatorBank, type StandStyle } from '../layout.ts';
import { alpineLake, rivieraCoast, rivieraSpots } from './scenicLand.ts';

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

/**
 * The scenic road courses' stands, banks and landmarks (the land is scenicLand.ts): a road course
 * crowd, smaller than a Grand Prix's — the main grandstand opposite the pits, covered stands at the
 * heavy stops, grass banks on the hillsides, big screens, hospitality behind the main stand. Nothing
 * is built where the land falls away (the sea cliffs, the lake shore): those corners get their
 * stands on the inside instead.
 */
export function planScenic(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  /** solid, buildable ground at (x, z) */
  const solid = (x: number, z: number) =>
    map.scenic === 'riviera' ? rivieraCoast(map, x, z) < -55 : map.scenic === 'alpine' ? alpineLake(map, x, z) < -45 : true;
  const sideOk = (sA: number, sB: number, side: number, reach: number) => {
    for (let s = sA; s <= sB; s += 15) {
      track.point(s, side * (track.barrierAt(s, side) + reach), 0, p);
      if (!solid(p.x, p.z)) return false;
    }
    return true;
  };
  const pit = track.pit;
  const opp = -pit.side;
  const len = pit.sEnd - pit.sStart;

  // the main grandstand, opposite the pits (on solid ground; a cliff or the shore keeps it to the pit side's ends)
  const mA = pit.sStart + len * 0.22, mB = pit.sStart + len * 0.82;
  if (sideOk(mA, mB, opp, 46)) addStand('Main Grandstand', mA, mB, opp, 22, 'centrale', 8, 90);
  else if (sideOk(mA, mB, opp, 30)) addStand('Main Grandstand', mA, mB, opp, 12, 'covered', 7, 80);

  // covered stands at the heavy stops: the first corner and the two tightest others
  const after = track.corners.filter((c) => c.sApex > pit.sEnd);
  const first = after[0] ?? track.corners[0];
  const tight = track.corners.filter((c) => c !== first && c.radius < 70).sort((a, b) => a.radius - b.radius).slice(0, 2);
  for (const c of [first, ...tight]) {
    const out = c.dir;
    const sA = c.sStart - 150, sB = c.sApex - 6;
    if (sideOk(sA, sB, out, 40)) addStand(c.name, sA, sB, out, 16, 'covered', 8, 60);
    else if (sideOk(sA, sB, -out, 40)) addStand(c.name, sA, sB, -out, 12, 'open', 8, 55);
  }

  // grass banks on the outside of the other corners, where there's ground for them
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
  track.corners.forEach((c, i) => {
    if (c === first || tight.includes(c) || i % 2) return;
    const sA = c.sStart - 30, sB = c.sEnd + 30;
    if (sideOk(sA, sB, c.dir, 34)) addBank(sA, sB, c.dir, 2.0, 0.7, 6, 18);
    else if (sideOk(sA, sB, -c.dir, 30)) addBank(sA, sB, -c.dir, 1.6, 0.55, 5, 14);
  });

  // big screens facing the main stand and the first corner
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, side: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 8) => {
    const q = at(s, side * (track.barrierAt(s, side) + back));
    if (!solid(q.x, q.z)) return;
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.heightAt(s), rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
    map.clearings.push({ x: q.x, z: q.z, r: 12, soft: 10, keep: 0.2 });
  };
  screenAt(pit.sStart + len * 0.5, pit.side, pit.sStart + len * 0.5, opp, 50, 14, 8, 22);
  screenAt(first.sEnd + 40, -first.dir, first.sApex - 60, first.dir, 40);

  // open ground round the paddock and behind the main stand
  for (let s = pit.sStart + 40; s <= pit.sEnd - 40; s += 50) {
    const q = at(s, opp * (track.barrierAt(s, opp) + 66));
    if (solid(q.x, q.z)) map.clearings.push({ x: q.x, z: q.z, r: 40, soft: 24, keep: 0.12 });
  }

  // a service road behind the main stand
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  if (sideOk(mA - 60, mB + 60, opp, 62)) map.paths.push({ pts: trackLine(mA - 60, mB + 60, (s) => opp * (track.barrierAt(s, opp) + 56), 12), width: 7, kind: 2 });

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

  const villages: Layout['villages'] = [];
  if (map.scenic === 'riviera') {
    const sp = rivieraSpots(map);
    villages.push({ x: sp.village.x, z: sp.village.z, r: sp.village.r * 0.6, seed: 401 }, { x: sp.hillTown.x, z: sp.hillTown.z, r: sp.hillTown.r * 0.6, seed: 433 });
  }

  const landmarks: Landmark[] = [];
  const hosp: [number, number][] = [];
  for (const s of [pit.sStart + len * 0.35, pit.sStart + len * 0.65]) {
    const q = at(s, opp * (track.barrierAt(s, opp) + 92));
    if (solid(q.x, q.z)) hosp.push([s, opp]);
  }
  if (hosp.length) addHospitality(track, map, landmarks, hosp, 92);
  addCameraTowers(track, map, landmarks, track.corners.filter((_, i) => i % 2 === 0).map((c) => c.name));

  return {
    grandstands: gs,
    banks,
    screens,
    oval: null,
    pit: { sA: pit.sStart, sB: pit.sEnd, side: pit.side, front: pit.garageOffset + 0.5, depth: 26, paddockTo: pit.paddock, y0: track.heightAt(pit.sStart), y1: track.heightAt(pit.sEnd) },
    flagpoles,
    poplarRows: [],
    avenueTrees: [],
    villages,
    landmarks,
  };
}
