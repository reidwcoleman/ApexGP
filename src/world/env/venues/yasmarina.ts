import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { MARINA, YAS_SITES, YAS_WATER_Y, yasGeo } from './yasmarinaLand.ts';

/**
 * Yas Marina's layout: where the stands, the paths and the pads for the landmarks go.
 *
 *   Main Grandstand   the big covered stand along the start/finish straight, opposite the pits
 *   North Grandstand  over the T5/T6 chicane and the braking zone of the T7 hairpin (east side)
 *   West Grandstand   the braking zone of the T8/T9 chicane at the end of the back straight
 *   South Grandstand  the braking zone of the T11 chicane
 *   Marina Grandstand the T14–T15 run, its back to the harbour
 *   Turn 20           a smaller stand on the run from under the hotel to the last corners
 * The marina basin is cut out of the land with a sharp-edged pad (vertical quays); the hotel's
 * two wings, Ferrari World and the marina promenades get flat pads and keep the palms out.
 */

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

/** the hotel's footprint (world): the two wings either side of the T18–T19 run */
export interface HotelPlan {
  /** s range of the run under the bridge, and the s of the bridge */
  sA: number;
  sB: number;
  sBridge: number;
  /** wing centres, half sizes (x across the track, z along it) and yaw (rotation.y of the long axis) */
  wings: { x: number; z: number; hw: number; hl: number; yaw: number }[];
}

export function hotelPlan(track: Track): HotelPlan {
  // the run heads north under the bridge (s ≈ 5075–5135); the wings stand either side of it
  const sBridge = 5104;
  const f = track.frame(sBridge);
  const yaw = Math.atan2(f.tangent.x, f.tangent.z);
  const east = track.point(sBridge, 42, 0, new THREE.Vector3());
  const west = track.point(sBridge, -38, 0, new THREE.Vector3());
  return {
    sA: 5070,
    sB: 5140,
    sBridge,
    // (the marina wing runs on well past both corners along the quay; the circuit wing fills the
    // pocket between the T17–T18 and T19–T20 runs)
    wings: [
      { x: east.x, z: east.z - 2, hw: 12, hl: 64, yaw },
      { x: west.x, z: west.z + 2, hw: 11, hl: 30, yaw },
    ],
  };
}

/**
 * The pit-exit tunnel: the lane dives under the track at Turn 1 and comes up on the left of the
 * run to Turn 2. (The race's own pit exit merges on the right as everywhere else; this is the
 * real tunnel's mouth and ramp, behind the barrier.) s range of the ramp and its lateral offset.
 */
export function pitTunnelPlan(track: Track): { s0: number; s1: number; lat: number } {
  let bar = 0;
  for (let s = 770; s <= 900; s += 4) bar = Math.max(bar, track.barrierAt(s, -1));
  return { s0: 790, s1: 885, lat: -(bar + 10) };
}

export function planYasmarina(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t1 = corner('Turn 1');
  const t2 = corner('Turn 2');
  const t5 = corner('Turn 5');
  const t7 = corner('Turn 7');
  const t8 = corner('Turn 8');
  const t11 = corner('Turn 11');
  const t14 = corner('Turn 14');
  const t20 = corner('Turn 20');

  // ---------------------------------------------------------------- grandstands
  addStand('Main Grandstand West', 225, 330, L, 26, 'covered', 7, 60);
  addStand('Main Grandstand', 338, 580, L, 30, 'centrale', 7, 81);
  addStand('Main Grandstand East', 588, t1.sStart - 8, L, 24, 'covered', 7, 50);
  addStand('North Grandstand', t5.sStart - 170, t5.sStart - 10, R, 22, 'covered', 7, 55);
  addStand('North Grandstand Hairpin', t7.sStart - 110, t7.sStart - 8, R, 18, 'covered', 7, 50);
  addStand('West Grandstand', t8.sStart - 210, t8.sStart - 12, R, 24, 'covered', 7, 66);
  addStand('South Grandstand', t11.sStart - 190, t11.sStart - 14, R, 22, 'covered', 7, 60);
  addStand('Marina Grandstand', t14.sEnd + 40, t14.sEnd + 225, R, 16, 'covered', 7, 62);
  addStand('Turn 20', t20.sStart - 170, t20.sStart - 20, L, 14, 'open', 7, 50);

  // ---------------------------------------------------------------- general admission (landscaped mounds)
  const banks: SpectatorBank[] = [];
  const addBank = (sA: number, sB: number, side: number, rise: number, density: number, gap = 5, width = 16) => {
    let bar = 0;
    for (let s = sA; s <= sB; s += 3) bar = Math.max(bar, track.barrierAt(s, side));
    const latA = side * (bar + gap), latB = side * (bar + gap + width);
    banks.push({ sA, sB, side, latA, latB, rise, density });
    map.trackPads.push({ sA, sB, latA, latB, offset: rise, blend: 9 });
    for (let s = sA; s <= sB; s += 18) {
      track.point(s, (latA + latB) / 2, 0, p);
      clear(p.x, p.z, width * 0.75, 10, 0.02);
    }
  };
  // Abu Dhabi Hill: the grass bank round the outside of Turn 2 and the run to Turn 3
  addBank(t2.sStart - 40, t2.sEnd + 110, R, 1.6, 0.75, 5, 20);
  addBank(1300, 1520, L, 1.2, 0.55, 5, 16);
  addBank(2350, 2620, L, 1.0, 0.45, 5, 14);
  addBank(3450, 3700, L, 1.0, 0.5, 5, 14);

  // ---------------------------------------------------------------- the marina
  {
    const M = MARINA;
    const cx = (M.x0 + M.x1) / 2, cz = (M.z0 + M.z1) / 2;
    // the basin: a sharp-edged pad so the quay walls stay vertical at the fine resolution
    map.worldPads.push({ cx, cz, halfW: (M.x1 - M.x0) / 2, halfL: (M.z1 - M.z0) / 2, angle: 0, h: YAS_WATER_Y - 4.5, blend: 2.5 });
    map.exclusions.push({ cx, cz, halfW: (M.x1 - M.x0) / 2 + 5, halfL: (M.z1 - M.z0) / 2 + 5, angle: 0 });
    // promenades on the north quay (the yacht club, restaurants) and the west quay by the hotel
    map.paths.push({ pts: [{ x: M.x0 - 6, z: M.z0 - 9 }, { x: M.x1 - 60, z: M.z0 - 9 }], width: 14, kind: 2 });
    map.paths.push({ pts: [{ x: M.x0 - 9, z: M.z0 - 6 }, { x: M.x0 - 9, z: M.z1 + 4 }], width: 10, kind: 2 });
    for (let x = M.x0 + 20; x < M.x1 - 60; x += 45) clear(x, M.z0 - 40, 26, 12, 0.02);
  }

  // ---------------------------------------------------------------- the hotel
  const hotel = hotelPlan(track);
  for (const w of hotel.wings) {
    map.exclusions.push({ cx: w.x, cz: w.z, halfW: w.hw + 5, halfL: w.hl + 6, angle: w.yaw });
    const y = track.heightAt(hotel.sBridge) - 0.05;
    map.worldPads.push({ cx: w.x, cz: w.z, halfW: w.hw + 3, halfL: w.hl + 4, angle: w.yaw, h: y, blend: 10, paved: true });
    clear(w.x, w.z, 40, 14, 0.02);
  }

  // ---------------------------------------------------------------- the pit-exit tunnel's mouth
  {
    const tn = pitTunnelPlan(track);
    for (let s = tn.s0 - 10; s <= tn.s1 + 10; s += 10) {
      track.point(s, tn.lat, 0, p);
      map.exclusions.push({ cx: p.x, cz: p.z, halfW: 11, halfL: 11, angle: 0 });
    }
  }

  // ---------------------------------------------------------------- Ferrari World and the mall
  {
    const F = YAS_SITES.ferrari;
    const y = Math.max(YAS_WATER_Y + 1.5, map.naturalExact(F.x, F.z));
    map.worldPads.push({ cx: F.x, cz: F.z, halfW: F.r + 30, halfL: F.r + 30, angle: 0, h: y, blend: 40, paved: true });
    map.exclusions.push({ cx: F.x, cz: F.z, halfW: F.r + 10, halfL: F.r + 10, angle: 0 });
    clear(F.x, F.z, F.r + 60, 60, 0.02);
    const Mm = YAS_SITES.mall;
    map.exclusions.push({ cx: Mm.x, cz: Mm.z, halfW: 230, halfL: 110, angle: 0.25 });
    map.worldPads.push({ cx: Mm.x, cz: Mm.z, halfW: 250, halfL: 130, angle: 0.25, h: Math.max(0.6, map.naturalExact(Mm.x, Mm.z)), blend: 30, paved: true });
  }

  // ---------------------------------------------------------------- roads & walkways
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // the service road behind the Main Grandstand
  map.paths.push({ pts: trackLine(150, t1.sStart + 40, (s) => -(track.barrierAt(s, -1) + 52), 12), width: 12, kind: 2 });
  // the perimeter road round the outside of the lap (palm-lined), and the walkways inside the fences
  const ring = (sA: number, sB: number, side: number, off: number, width: number, kind: 1 | 2) =>
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 3 * Math.sin(s * 0.004)), 14), width, kind });
  ring(t2.sEnd + 60, t5.sStart - 190, R, 60, 12, 2);
  ring(t7.sEnd + 40, t8.sStart - 230, R, 70, 12, 2);
  ring(t8.sEnd + 40, t11.sStart - 210, R, 64, 12, 2);
  ring(1300, 1560, L, 34, 4, 1);
  ring(2100, 2900, L, 30, 4, 1);
  ring(3440, 3980, L, 30, 4, 1);
  // Yas's boulevards north of the circuit, toward Ferrari World and the mall
  {
    const F = YAS_SITES.ferrari, Mm = YAS_SITES.mall;
    map.paths.push({ pts: [{ x: -900, z: -1180 }, { x: -300, z: -1130 }, { x: 200, z: -1100 }, { x: 900, z: -1080 }], width: 22, kind: 2 });
    map.paths.push({ pts: [{ x: F.x - 240, z: F.z + 60 }, { x: Mm.x + 200, z: Mm.z + 140 }, { x: Mm.x + 260, z: Mm.z - 300 }], width: 18, kind: 2 });
    map.paths.push({ pts: [{ x: -700, z: -1300 }, { x: -720, z: -300 }, { x: -760, z: 600 }, { x: -700, z: 1100 }], width: 20, kind: 2 });
  }

  // ---------------------------------------------------------------- landscaped lawns
  // round the stands' concourses, the paddock gardens, the infield round the hairpin
  for (let s = 180; s <= 700; s += 45) { const q = at(s, -(track.barrierAt(s, -1) + 70)); clear(q.x, q.z, 30, 16, 0.02); }
  for (const [s, side, off, r] of [
    [1180, L, 60, 50], [2000, L, 70, 60], [2600, L, 80, 70], [3300, L, 90, 60], [4700, L, 40, 30], [5300, L, 45, 26], [900, L, 60, 40],
    [1500, L, 50, 45], [1750, L, 45, 40], [1900, L, 60, 50], [2300, R, 50, 40], [3900, L, 50, 45], [4200, L, 40, 40], [4950, R, 35, 30],
    [5450, L, 40, 36], [60, L, 50, 40], [780, R, 60, 50],
  ] as const) {
    const q = at(s, side * (track.barrierAt(s, side) + off));
    if (yasGeo(q.x, q.z).coast > 20) clear(q.x, q.z, r, 24, 0.05);
  }

  // ---------------------------------------------------------------- big screens
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, side: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 6) => {
    const lat = side * (track.barrierAt(s, side) + back);
    const q = at(s, lat);
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.heightAt(s), rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
    clear(q.x, q.z, 12, 10, 0.1);
  };
  screenAt(t1.sStart + 40, R, 450, L, 40, 16, 9, 22);
  screenAt(t7.sEnd + 30, L, t5.sStart - 90, R, 40);
  screenAt(t8.sEnd + 30, L, t8.sStart - 110, R, 40);
  screenAt(t11.sStart - 30, L, t11.sStart - 100, R, 40);

  // ---------------------------------------------------------------- flags
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

  // ---------------------------------------------------------------- hospitality & TV towers
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[2250, -1], [2500, -1], [3600, 1]], 40);
  addCameraTowers(track, map, landmarks, ['Turn 1', 'Turn 5', 'Turn 7', 'Turn 8', 'Turn 11', 'Turn 14', 'Turn 17', 'Turn 20']);
  // (drop any that fell in the water)
  for (let i = landmarks.length - 1; i >= 0; i--) if (yasGeo(landmarks[i].x, landmarks[i].z).coast < 8) landmarks.splice(i, 1);

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
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages: [], landmarks };
}

// ---------------------------------------------------------------- fans & flags

/** the crowd: white kanduras and abayas' black, the UAE's green and red, team kit */
export const YAS_FAN_COLOURS = ['#f4f4f2', '#ffffff', '#ecebe6', '#00732f', '#0a8a3c', '#c8102e', '#101010', '#1c1c1c'];

/** flags 0–3: the UAE flag, an ABU DHABI banner, a YAS MARINA banner, Ferrari red */
export function drawYasmarinaFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number) {
  const txt = (x: number, y: number, s: string, size: number, col: string) => {
    ctx.fillStyle = col;
    ctx.font = `900 ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  // 0: the UAE: a red vertical band at the hoist, green / white / black
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#00732f';
    ctx.fillRect(x, y, S, S / 3 + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S / 3, S, S / 3 + 1);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y + (2 * S) / 3, S, S / 3);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(x, y, S * 0.26, S);
  }
  // 1: ABU DHABI, white on the UAE's green with a red rule
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#00732f';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(x, y + S * 0.74, S, S * 0.07);
    txt(x + S / 2, y + S * 0.34, 'ABU', 74, '#ffffff');
    txt(x + S / 2, y + S * 0.56, 'DHABI', 60, '#ffffff');
  }
  // 2: YAS MARINA: the circuit's deep blue and violet
  {
    const [x, y] = at(2);
    const gr = ctx.createLinearGradient(x, y, x + S, y + S);
    gr.addColorStop(0, '#1b2a8c');
    gr.addColorStop(1, '#6a2a9c');
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, S, S);
    txt(x + S / 2, y + S * 0.38, 'YAS', 92, '#ffffff');
    txt(x + S / 2, y + S * 0.62, 'MARINA', 50, '#9fe3ff');
  }
  // 3: Ferrari red with the yellow shield (Ferrari World is next door)
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.moveTo(x + S * 0.32, y + S * 0.22);
    ctx.lineTo(x + S * 0.68, y + S * 0.22);
    ctx.lineTo(x + S * 0.68, y + S * 0.55);
    ctx.quadraticCurveTo(x + S * 0.68, y + S * 0.72, x + S * 0.5, y + S * 0.8);
    ctx.quadraticCurveTo(x + S * 0.32, y + S * 0.72, x + S * 0.32, y + S * 0.55);
    ctx.closePath();
    ctx.fill();
    for (const [c, k] of [['#009246', 0], ['#ffffff', 1], ['#ce2b37', 2]] as const) {
      ctx.fillStyle = c;
      ctx.fillRect(x + S * (0.32 + k * 0.12), y + S * 0.22, S * 0.12, S * 0.05);
    }
    txt(x + S / 2, y + S * 0.53, 'SF', 58, '#141414');
  }
}
