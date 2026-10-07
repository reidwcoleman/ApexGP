import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { reserveVenueAds } from './venueAdPlans.ts';

/**
 * Bahrain International Circuit: where everything goes. Heading north up the main straight:
 *
 *   Main Grandstand   on the left, opposite the pits, under its row of white tent roofs
 *                     (venues/sakhirScenery.ts)
 *   the paddock       on the right, between the pit building and the Turn 10–11 back straight;
 *                     the Sakhir Tower (the VIP tower with the sail roof) at its northern end,
 *                     the team buildings and the paddock club in beige stone round it
 *   Turn 1            the big stand outside the hairpin; stands outside T4, T10, T11 and T14
 *
 * The extra sites ride on the returned layout as `sakhir`.
 */

export interface SakhirSites {
  /** the Sakhir Tower: ground centre, yaw (local +z faces the main straight) */
  tower: { x: number; z: number; y: number; rot: number };
  /** Main Grandstand segments (the tent roofs) */
  main: GrandstandSpec[];
  /** beige low buildings: centre, half sizes, yaw, height */
  blocks: { x: number; z: number; y: number; hw: number; hl: number; rot: number; h: number }[];
  /** irrigated lawns (palms, green grass): centre and radius */
  oases: { x: number; z: number; r: number }[];
  /** big flag masts (the Bahrain flag) */
  masts: V2[];
}

export type SakhirLayout = Layout & { sakhir: SakhirSites };

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

export function planSakhir(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): SakhirLayout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t1 = corner('Turn 1'), t4 = corner('Turn 4'), t8 = corner('Turn 8'), t10 = corner('Turn 10');
  const t11 = corner('Turn 11'), t13 = corner('Turn 13'), t14 = corner('Turn 14'), t15 = corner('Turn 15');

  // ---------------------------------------------------------------- grandstands
  // the Main Grandstand opposite the pits (its tent roofs are built separately)
  addStand('Main Grandstand', 330, 1010, L, 30, 'open', 8, 85);
  const mainSegs = gs.filter((g) => g.name === 'Main Grandstand');
  // Turn 1: the big covered stand outside the hairpin, facing the braking zone
  addStand('Turn 1', t1.sStart - 150, t1.sStart - 6, L, 22, 'covered', 9, 72);
  // Turn 4: outside the long right, looking back up the straight from Turn 3
  addStand('Turn 4', t4.sStart - 130, t4.sStart - 8, L, 18, 'covered', 9, 65);
  // Turn 10: outside the downhill left at the top of the lap
  addStand('Turn 10', t10.sStart - 110, t10.sStart - 6, R, 14, 'covered', 9, 55);
  // Turn 11: at the end of the back straight
  addStand('Turn 11', t11.sStart - 140, t11.sStart - 10, R, 16, 'covered', 9, 70);
  // Turn 14 / 15: the last corners
  addStand('Turn 14', t14.sStart - 120, t14.sStart - 6, L, 14, 'open', 8, 60);

  // ---------------------------------------------------------------- spectator banks (sand, a little raised)
  const banks: SpectatorBank[] = [];
  const addBank = (sA: number, sB: number, side: number, rise: number, density: number, gap = 5, width = 16) => {
    let bar = 0;
    for (let s = sA; s <= sB; s += 3) bar = Math.max(bar, track.barrierAt(s, side));
    const latA = side * (bar + gap), latB = side * (bar + gap + width);
    banks.push({ sA, sB, side, latA, latB, rise, density });
    map.trackPads.push({ sA, sB, latA, latB, offset: rise, blend: 9 });
  };
  addBank(t8.sStart - 90, t8.sStart - 10, L, 1.4, 0.45, 6, 14);
  addBank(t13.sEnd + 10, t13.sEnd + 120, R, 1.2, 0.4, 6, 14);

  // ---------------------------------------------------------------- the paddock and the Sakhir Tower
  const best = (ax: number, az: number, need: number, rad: number, avoid: V2[] = []) => {
    let bx = ax, bz = az, bs = -Infinity;
    for (let dx = -rad; dx <= rad; dx += 6)
      for (let dz = -rad; dz <= rad; dz += 6) {
        const x = ax + dx, z = az + dz;
        let c = map.trackClearance(x, z);
        if (map.inPitZone(x, z, 4)) c = Math.min(c, 0);
        for (const q of avoid) c = Math.min(c, Math.hypot(x - q.x, z - q.z) - need * 1.6);
        const score = Math.min(c, need + 12) - Math.hypot(dx, dz) * 0.08;
        if (score > bs) { bs = score; bx = x; bz = z; }
      }
    return { x: bx, z: bz };
  };
  const pit = track.pit;
  const side = pit.side;
  // the tower: at the northern end of the paddock, behind the pit exit, facing the start line
  const aim = at(pit.sEnd - 10, side * 150);
  const tw = best(aim.x, aim.z, 22, 36);
  const face = at(pit.sEnd - 150, 0);
  const towerRot = Math.atan2(face.x - tw.x, face.z - tw.z);
  const ty = map.naturalExact(tw.x, tw.z);
  const tower = { x: tw.x, z: tw.z, y: ty, rot: towerRot };
  map.worldPads.push({ cx: tw.x, cz: tw.z, halfW: 34, halfL: 34, angle: towerRot, h: ty, blend: 22, paved: true });
  map.exclusions.push({ cx: tw.x, cz: tw.z, halfW: 34, halfL: 34, angle: towerRot });
  clear(tw.x, tw.z, 50, 30, 0);

  // beige buildings: the team and media buildings along the back of the paddock, the paddock club,
  // the administration and the entrance halls behind the Main Grandstand
  const blocks: SakhirSites['blocks'] = [];
  const oases: SakhirSites['oases'] = [];
  const f = (s: number) => track.frame(s);
  const addBlock = (s: number, lat: number, hl: number, hw: number, h: number, pad = 6) => {
    const q = at(s, lat);
    const t = f(s).tangent;
    const rot = Math.atan2(t.x, t.z);
    for (let k = -1; k <= 1; k++) {
      const p = at(s + k * hl * 0.9, lat);
      if (map.trackClearance(p.x, p.z) < hw + 8 || map.excluded(p.x, p.z, hw * 0.6)) return;
    }
    const y = map.naturalExact(q.x, q.z);
    blocks.push({ x: q.x, z: q.z, y, hw, hl, rot, h });
    map.worldPads.push({ cx: q.x, cz: q.z, halfW: hw + pad, halfL: hl + pad, angle: rot, h: y, blend: 16, paved: true });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: hw + 2, halfL: hl + 2, angle: rot });
  };
  for (let s = pit.sStart + 80; s < pit.sEnd - 90; s += 95) addBlock(s, side * 160, 38, 9, 10);
  addBlock(pit.sStart + 40, side * 175, 30, 12, 8);
  // behind the Main Grandstand: the administration / entrance halls
  for (const s of [420, 640, 860]) addBlock(s, -side * (track.barrierAt(s, -side) + 88), 40, 12, 12);
  // oases: palms and green lawns round the tower, the paddock and the main entrance
  oases.push({ x: tw.x, z: tw.z, r: 58 });
  for (let s = pit.sStart + 60; s < pit.sEnd; s += 120) { const q = at(s, side * 142); oases.push({ x: q.x, z: q.z, r: 22 }); }
  for (const s of [360, 530, 750, 950]) { const q = at(s, -side * (track.barrierAt(s, -side) + 62)); oases.push({ x: q.x, z: q.z, r: 26 }); }
  for (const o of oases) clear(o.x, o.z, o.r, 12, 0.15);

  // ---------------------------------------------------------------- roads
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    const p = new THREE.Vector3();
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // the service road behind the Main Grandstand, the paddock road behind the team buildings
  map.paths.push({ pts: trackLine(240, 1080, (s) => -side * (track.barrierAt(s, -side) + 64), 12), width: 10, kind: 2 });
  map.paths.push({ pts: trackLine(pit.sStart + 20, pit.sEnd - 20, () => side * 186, 12), width: 8, kind: 2 });

  // ---------------------------------------------------------------- big screens
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, sd: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 6) => {
    const lat = sd * (track.barrierAt(s, sd) + back);
    const q = at(s, lat);
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.heightAt(s), rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
  };
  screenAt(t1.sEnd + 30, R, t1.sStart - 60, L, 40, 14, 8, 10);
  screenAt(t4.sEnd + 20, R, t4.sStart - 80, L, 40);
  screenAt(t11.sEnd + 30, L, t11.sStart - 80, R, 40);
  screenAt(t15.sApex + 30, R, t14.sStart - 60, L, 40);

  // ---------------------------------------------------------------- flags
  const flagpoles: V2[] = [];
  for (const g of gs) {
    if (g.style === 'open' && g.name !== 'Main Grandstand') continue;
    const n = Math.max(2, Math.round(g.length / 26));
    for (let k = 0; k <= n; k++) {
      const t = k / n - 0.5;
      const along = new THREE.Vector3(g.facing.z, 0, -g.facing.x);
      flagpoles.push({ x: g.center.x + along.x * t * g.length - g.facing.x * (g.depth / 2 + 1.5), z: g.center.z + along.z * t * g.length - g.facing.z * (g.depth / 2 + 1.5) });
    }
  }
  // the giant Bahrain flags by the tower and at Turn 1
  const masts: V2[] = [];
  {
    const cand: THREE.Vector3[] = [at(pit.sEnd + 30, side * 60), at(t1.sApex - 40, -side * (track.barrierAt(t1.sApex - 40, -side) + 40))];
    for (const q of cand) {
      if (map.trackClearance(q.x, q.z) < 10 || map.excluded(q.x, q.z, 4)) continue;
      masts.push({ x: q.x, z: q.z });
      map.exclusions.push({ cx: q.x, cz: q.z, halfW: 3, halfL: 3, angle: 0 });
    }
  }

  // the race weekend's own hoardings and LED boards (venueAdPlans.ts): keep the scrub off them
  reserveVenueAds(track, map);

  // ---------------------------------------------------------------- landmarks
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[t1.sApex + 100, 1], [t4.sEnd + 60, -1], [t11.sEnd + 80, -1]], 60);
  addCameraTowers(track, map, landmarks, ['Turn 1', 'Turn 4', 'Turn 8', 'Turn 10', 'Turn 11', 'Turn 13', 'Turn 14']);

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
  return {
    grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages: [], landmarks,
    sakhir: { tower, main: mainSegs, blocks, oases, masts },
  };
}
