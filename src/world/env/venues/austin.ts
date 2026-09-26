import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';

/**
 * Circuit of the Americas: where everything goes.
 *
 *   Main Grandstand  opposite the pits (right of the straight; the paddock is in the infield),
 *                    under its white canopy (venues/austinScenery.ts)
 *   Turn 1           the big stand on the crest outside the hairpin, general admission on the
 *                    hillside both sides of the climb
 *   the esses        fans on the slopes, an open stand at T9
 *   Turn 12          the big stand at the end of the back straight
 *   the stadium      stands round T12–T15; the Observation Tower and the amphitheatre in the
 *                    infield between the stadium and the esses
 *   T16–T20          stands at T15, T19 and T20, fans on the banks outside the triple apex
 *
 * The extra sites (tower, amphitheatre, skyline) ride on the returned layout as `austin`.
 */

export interface AustinSites {
  tower: { x: number; z: number; y: number; rot: number };
  amph: { x: number; z: number; y: number; rot: number };
  /** the Main Grandstand segments (canopy) */
  main: GrandstandSpec[];
  /** big flags (the Texas and US flags on tall masts) */
  masts: { x: number; z: number; texas: boolean }[];
}

export type AustinLayout = Layout & { austin: AustinSites };

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

export function planAustin(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): AustinLayout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t1 = corner('Turn 1'), t9 = corner('Turn 9'), t11 = corner('Turn 11'), t12 = corner('Turn 12');
  const t13 = corner('Turn 13'), t15 = corner('Turn 15'), t16 = corner('Turn 16'), t18 = corner('Turn 18');
  const t19 = corner('Turn 19'), t20 = corner('Turn 20'), t3 = corner('Turn 3'), t6 = corner('Turn 6');

  // ---------------------------------------------------------------- grandstands
  // main straight: the Main Grandstand opposite the pits (its canopy is built separately)
  addStand('Main Grandstand', 370, 770, R, 32, 'open', 8, 80);
  const mainSegs = gs.filter((g) => g.name === 'Main Grandstand');
  // Turn 1: the stand on the crest outside the hairpin
  addStand('Turn 1', t1.sStart - 120, t1.sStart - 4, R, 24, 'covered', 8, 60);
  // T3 (the first of the esses): an open stand on the slope outside
  addStand('Turn 3', t3.sStart - 120, t3.sStart - 10, R, 14, 'open', 7, 60);
  addStand('Turn 6', t6.sStart + 10, t6.sStart + 110, L, 14, 'open', 7, 55);
  addStand('Turn 9', t9.sEnd + 10, t9.sEnd + 120, R, 14, 'open', 7, 55);
  addStand('Turn 11', t11.sStart - 115, t11.sStart - 5, R, 14, 'open', 8, 55);
  // Turn 12: the big stand at the end of the back straight
  addStand('Turn 12', t12.sStart - 200, t12.sStart - 5, R, 24, 'covered', 8, 66);
  addStand('Turn 13', t13.sStart - 110, t13.sStart + 5, R, 18, 'covered', 8, 60);
  addStand('Turn 15', t15.sStart - 10, t15.sStart + 110, R, 18, 'covered', 8, 60);
  addStand('Turn 16', t16.sStart - 20, t16.sEnd + 10, L, 14, 'open', 8, 60);
  addStand('Turn 19', t19.sStart - 110, t19.sStart - 5, R, 16, 'covered', 8, 60);
  addStand('Turn 20', t20.sStart - 110, t20.sStart - 5, R, 14, 'open', 8, 55);

  // ---------------------------------------------------------------- general admission banks
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
  // the Turn 1 hill: fans all the way up the climb on the outside and round the crest inside
  addBank(t1.sStart + 5, t1.sEnd + 60, L, 2.2, 0.9, 6, 22);
  addBank(t1.sEnd + 60, corner('Turn 2').sApex, L, 1.6, 0.7, 5, 18);
  addBank(corner('Turn 2').sEnd, t3.sStart - 30, L, 1.8, 0.7, 6, 18);
  addBank(corner('Turn 4').sStart, corner('Turn 5').sEnd, R, 1.6, 0.6, 5, 16);
  addBank(corner('Turn 7').sEnd + 20, corner('Turn 8').sStart - 10, L, 1.5, 0.55, 5, 14);
  addBank(t11.sEnd + 30, t11.sEnd + 180, L, 1.4, 0.55, 5, 14);
  addBank(t16.sEnd + 20, t18.sEnd - 20, L, 1.8, 0.7, 6, 18);
  addBank(t19.sEnd + 10, t19.sEnd + 90, R, 1.4, 0.55, 5, 14);

  // ---------------------------------------------------------------- the Tower and the amphitheatre
  // In the infield between the stadium section (T12–T14) and the esses: pick the most open
  // spot near the aim point, then turn the veil and the stage toward the stadium.
  const best = (ax: number, az: number, need: number, rad: number, avoid: V2[] = []) => {
    let bx = ax, bz = az, bs = -Infinity;
    for (let dx = -rad; dx <= rad; dx += 6)
      for (let dz = -rad; dz <= rad; dz += 6) {
        const x = ax + dx, z = az + dz;
        let c = map.trackClearance(x, z);
        for (const q of avoid) c = Math.min(c, Math.hypot(x - q.x, z - q.z) - need * 1.6);
        const score = Math.min(c, need + 12) - Math.hypot(dx, dz) * 0.08;
        if (score > bs) { bs = score; bx = x; bz = z; }
      }
    return { x: bx, z: bz };
  };
  // aim: inside T12/T13, up against the back straight
  const a12 = at(t12.sApex + 70, -60);
  const tw = best(a12.x, a12.z, 34, 72);
  const tl = at(t13.sApex, 0);
  const towerRot = Math.atan2(tl.x - tw.x, tl.z - tw.z);
  const ty = map.naturalExact(tw.x, tw.z);
  const tower = { x: tw.x, z: tw.z, y: ty, rot: towerRot };
  map.worldPads.push({ cx: tw.x, cz: tw.z, halfW: 40, halfL: 40, angle: towerRot, h: ty, blend: 24, paved: true });
  map.exclusions.push({ cx: tw.x, cz: tw.z, halfW: 38, halfL: 38, angle: towerRot });
  clear(tw.x, tw.z, 60, 40, 0.05);
  // the amphitheatre beside it, the stage backing onto the esses, the bowl rising toward the tower
  const dirx = Math.sin(towerRot + Math.PI / 2), dirz = Math.cos(towerRot + Math.PI / 2);
  const am0 = best(tw.x + dirx * 105, tw.z + dirz * 105, 42, 60, [{ x: tw.x, z: tw.z }]);
  const amRot = Math.atan2(tw.x - am0.x, tw.z - am0.z);
  const ay = map.naturalExact(am0.x, am0.z);
  const amph = { x: am0.x, z: am0.z, y: ay, rot: amRot };
  map.worldPads.push({ cx: am0.x, cz: am0.z, halfW: 46, halfL: 42, angle: amRot, h: ay, blend: 22, paved: false });
  map.exclusions.push({ cx: am0.x, cz: am0.z, halfW: 46, halfL: 44, angle: amRot });
  clear(am0.x, am0.z, 70, 40, 0.05);
  // the Grand Plaza: a wide paved promenade between them
  map.paths.push({ pts: [{ x: tw.x, z: tw.z }, { x: am0.x, z: am0.z }], width: 16, kind: 2 });

  // ---------------------------------------------------------------- open ground
  // paddock behind the pits, the car parks behind the Main Grandstand, the lawns of the infield
  for (let s = 260; s <= 880; s += 40) { const q = at(s, -125); clear(q.x, q.z, 50, 28, 0.08); }
  for (let s = 300; s <= 860; s += 60) { const q = at(s, 125); clear(q.x, q.z, 48, 26, 0.1); }
  { const q = at(t1.sApex, 150); clear(q.x, q.z, 90, 50, 0.15); }
  { const q = at(t15.sApex, -120); clear(q.x, q.z, 80, 50, 0.2); }

  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // service road behind the Main Grandstand, walkways along the banks
  map.paths.push({ pts: trackLine(300, 900, (s) => track.barrierAt(s, 1) + 70, 12), width: 8, kind: 2 });
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(t1.sEnd + 40, t3.sStart - 40, L, 30);
  walk(t16.sStart, t18.sEnd, L, 32);

  // ---------------------------------------------------------------- big screens
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
  screenAt(t1.sStart - 30, L, t1.sStart - 60, R, 50, 14, 8, 8);
  screenAt(t12.sStart - 40, L, t12.sStart - 100, R, 40, 14, 8);
  screenAt(t15.sApex + 10, L, t15.sStart, R, 40);
  screenAt(t19.sStart - 60, L, t19.sStart - 60, R, 40, 12, 7);

  // ---------------------------------------------------------------- flagpoles
  const flagpoles: V2[] = [];
  for (const g of gs) {
    if (g.style === 'open' && g.name !== 'Main Grandstand') continue;
    const n = Math.max(2, Math.round(g.length / 24));
    for (let k = 0; k <= n; k++) {
      const t = k / n - 0.5;
      const along = new THREE.Vector3(g.facing.z, 0, -g.facing.x);
      flagpoles.push({ x: g.center.x + along.x * t * g.length - g.facing.x * (g.depth / 2 + 1.5), z: g.center.z + along.z * t * g.length - g.facing.z * (g.depth / 2 + 1.5) });
    }
  }
  // giant flags: the Stars and Stripes on the Turn 1 crest and at the Tower, the Lone Star flag beside them
  const masts: AustinSites['masts'] = [];
  {
    // on the crest behind the Turn 1 stand (outside the hairpin), clear of the stand and the fences
    let texas = false;
    for (const [ds, off] of [[-20, 30], [25, 30], [-20, 45], [25, 45], [0, 60], [50, 50]]) {
      if (masts.length >= 2) break;
      const s = t1.sApex + ds;
      const q = at(s, track.barrierAt(s, 1) + off);
      if (map.trackClearance(q.x, q.z) < 8 || map.excluded(q.x, q.z, 4) || masts.some((m) => Math.hypot(m.x - q.x, m.z - q.z) < 20)) continue;
      masts.push({ x: q.x, z: q.z, texas });
      texas = !texas;
    }
    masts.push({ x: am0.x + (tw.x - am0.x) * 0.5 + dirz * 30, z: am0.z + (tw.z - am0.z) * 0.5 - dirx * 30, texas: false });
    for (const m of masts) map.exclusions.push({ cx: m.x, cz: m.z, halfW: 3, halfL: 3, angle: 0 });
  }

  // ---------------------------------------------------------------- towns
  // Austin's south-eastern subdivisions and Del Valle; the ranch land stays open
  const villages: Layout['villages'] = [];
  {
    const P = map.park;
    const spots: [number, number, number][] = [[-1.35, -0.9, 520], [-1.6, 0.35, 420], [-0.4, -1.55, 460], [1.45, 1.1, 300], [0.3, 1.7, 340]];
    spots.forEach(([u, v, rr], i) => villages.push({ x: P.cx + u * P.rx, z: P.cz + v * P.rz, r: rr, seed: 91 + i * 43 }));
    for (const v of villages) map.clearings.push({ x: v.x, z: v.z, r: v.r, soft: 80, keep: 0 });
  }

  // ---------------------------------------------------------------- landmarks
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[t1.sApex + 90, -1], [t12.sStart - 120, 1], [t19.sStart - 40, 1]], 70);
  addCameraTowers(track, map, landmarks, ['Turn 1', 'Turn 3', 'Turn 11', 'Turn 12', 'Turn 15', 'Turn 19']);

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
  return {
    grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages, landmarks,
    austin: { tower, amph, main: mainSegs, masts },
  };
}
