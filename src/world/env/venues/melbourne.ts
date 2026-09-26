import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { MEL_SITES, lakeContour, lakeDistance, melbourneGeo } from './melbourneLand.ts';

/**
 * Albert Park's layout: where the stands, fans, paths and the landmark sites go. The big
 * Fangio and Brabham stands line the start/finish straight opposite the pits (left), the
 * Jones stand wraps round Turns 1–2, more stands at Turn 3 (by the aquatic centre), Marina,
 * the fast Turn 9/10 chicane on Lakeside Drive and the Ascari–Stewart–Prost sequence; the
 * rest of the lap is concrete walls and debris fences with fans on the grass behind them.
 * The paddock sits between the pit garages and the lake; a promenade rings the water.
 */

const hash = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

export function planMelbourne(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t13 = corner('Turn 13');
  const t14 = corner('Prost');
  const t1 = corner('Jones');
  const t2 = corner('Brabham');
  const t3 = corner('Sports Centre');
  const t4 = corner('Whiteford');
  const t6 = corner('Marina');
  const t7 = corner('Lauda');
  const t9 = corner('Turn 9');
  const t10 = corner('Turn 10');
  const t11 = corner('Ascari');
  const t12 = corner('Stewart');
  const pit = track.pit;

  // ---------------------------------------------------------------- grandstands
  // (stands on the infield side must keep their feet dry: skip one whose back row would reach the lake)
  const dry = (sA: number, sB: number, side: number, rows: number) => {
    for (let s = sA; s <= sB; s += 10) {
      const q = at(s, side * (track.barrierAt(s, side) + 7 + rows * 0.86 + 5));
      if (lakeDistance(map, q.x, q.z) < 5) return false;
    }
    return true;
  };
  const stand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap = 7, segLen = 70) => {
    if (dry(sA, sB, side, rows)) addStand(name, sA, sB, side, rows, style, gap, segLen);
  };
  // the start/finish straight, opposite the pits: Brabham, the big Fangio stand over the grid, Jones at T1
  stand('Prost Stand', t14.sEnd + 10, 470, L, 20, 'covered', 7, 70);
  stand('Fangio Stand', 480, 760, L, 30, 'centrale', 7, 95);
  stand('Brabham Stand', 770, t1.sStart - 30, L, 24, 'covered', 7, 70);
  stand('Jones Stand', t1.sStart - 20, t1.sEnd + 30, L, 22, 'covered', 7, 60);
  stand('Whiteford Stand', t2.sStart + 10, t2.sEnd - 10, R, 16, 'open', 7, 60);
  // Turn 3: the heavy stop by the aquatic centre, the stand round its outside
  stand('Clark Stand', t3.sStart - 150, t3.sStart - 8, L, 20, 'covered', 7, 70);
  stand('Hill Stand', t4.sStart - 10, t4.sEnd + 20, R, 14, 'open', 7, 55);
  // Marina and Lauda at the lake's north end
  stand('Lauda Stand', t6.sStart - 130, t6.sStart - 8, L, 16, 'covered', 7, 65);
  stand('Marina Stand', t7.sStart - 5, t7.sEnd + 20, R, 12, 'open', 7, 55);
  // the fast chicane on Lakeside Drive
  stand('Waite Stand', t9.sStart - 140, t9.sStart - 6, R, 18, 'covered', 7, 70);
  stand('Hill Stand East', t10.sStart - 20, t10.sEnd + 30, L, 14, 'open', 7, 55);
  // Ascari, the braking zone and round the outside
  stand('Moss Stand', t11.sStart - 160, t11.sStart - 8, L, 20, 'covered', 7, 70);
  stand('Stewart Stand', t12.sStart - 10, t12.sEnd + 10, L, 16, 'open', 7, 55);
  // Turn 13 / Prost, where the lap turns for home
  stand('Senna Stand', t13.sStart - 120, t13.sStart - 8, R, 18, 'covered', 7, 65);

  // ---------------------------------------------------------------- general admission (flat grass, low mounds)
  const banks: SpectatorBank[] = [];
  const addBank = (sA: number, sB: number, side: number, rise: number, density: number, gap = 5, width = 16) => {
    let bar = 0;
    for (let s = sA; s <= sB; s += 3) bar = Math.max(bar, track.barrierAt(s, side));
    const latA = side * (bar + gap), latB = side * (bar + gap + width);
    // (not into the lake)
    const mid = at((sA + sB) / 2, (latA + latB) / 2);
    if (lakeDistance(map, mid.x, mid.z) < width) return;
    banks.push({ sA, sB, side, latA, latB, rise, density });
    map.trackPads.push({ sA, sB, latA, latB, offset: rise, blend: 9 });
    for (let s = sA; s <= sB; s += 18) {
      track.point(s, (latA + latB) / 2, 0, p);
      map.clearings.push({ x: p.x, z: p.z, r: width * 0.75, soft: 10, keep: 0.05 });
    }
  };
  addBank(t2.sEnd + 30, t2.sEnd + 230, L, 1.0, 0.6, 5, 16);
  addBank(t3.sEnd + 20, t4.sStart - 10, L, 0.8, 0.55, 5, 14);
  addBank(t4.sEnd + 30, t4.sEnd + 200, L, 0.9, 0.5, 5, 14);
  addBank(t7.sEnd + 30, t7.sEnd + 220, L, 1.0, 0.55, 5, 16);
  addBank(t9.sStart - 320, t9.sStart - 160, R, 0.8, 0.5, 5, 14);
  addBank(t10.sEnd + 40, t10.sEnd + 300, R, 0.9, 0.55, 5, 16);
  addBank(t12.sEnd + 20, t13.sStart - 130 + track.length, R, 0.8, 0.5, 5, 14);

  // ---------------------------------------------------------------- open ground
  // the paddock (between the garages and the lake) and the team hospitality along the water
  for (let s = pit.sStart + 20; s <= pit.sEnd - 20; s += 40) { const q = at(s, pit.side * 90); clear(q.x, q.z, 50, 24, 0.04); }
  // concourse and the service road behind the main stands (Aughtie Drive's lawns)
  for (let s = 260; s <= 1080; s += 50) { const q = at(s, -(track.barrierAt(s, -1) + 52)); clear(q.x, q.z, 32, 18, 0.2); }
  // the aquatic centre, Lakeside Stadium, the Shrine
  clear(MEL_SITES.msac.x, MEL_SITES.msac.z, 120, 40, 0.05);
  clear(MEL_SITES.stadium.x, MEL_SITES.stadium.z, 120, 40, 0.05);
  clear(MEL_SITES.shrine.x, MEL_SITES.shrine.z, 150, 60, 0.1);
  // sports ovals in the park (cricket and footy grounds) north of the circuit and in the west
  const ovals: { x: number; z: number; r: number }[] = [];
  for (const [x, z, r] of [[-560, -1060, 70], [-330, -1080, 65], [-900, 120, 70], [-960, -780, 65], [190, -1050, 60]] as const) {
    const g = melbourneGeo(map, x, z);
    if (g.out > 60 || map.distToTrack(x, z) < r + 40) continue;
    ovals.push({ x, z, r });
    clear(x, z, r + 20, 20, 0.02);
  }
  // open lawns inside the loop: the lake's banks
  for (const [x, z, r] of [[-470, 70, 50], [-120, -620, 50]] as const) clear(x, z, r, 35, 0.2);
  // the golf course: mown fairways (a jittered 55 m grid over the south-east lobe), the forest
  // function keeps tree lines between them
  for (let z = -200; z <= 900; z += 55)
    for (let x = 100; x <= 800; x += 55) {
      const jx = x + (hash(x, z) - 0.5) * 30, jz = z + (hash(z, x) - 0.5) * 30;
      if (melbourneGeo(map, jx, jz).golf < 0.6) continue;
      clear(jx, jz, 26 + hash(x + 1, z) * 12, 14, 0.3);
    }

  // ---------------------------------------------------------------- paths & roads
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // the lakeside promenade: a gravel path all the way round the water, a few metres up the bank
  {
    const ring = lakeContour(map, 9, 8);
    if (ring.length > 8) map.paths.push({ pts: [...ring, ring[0]], width: 4.2, kind: 1 });
  }
  // the service road behind the start/finish grandstands
  map.paths.push({ pts: trackLine(t14.sEnd, t1.sEnd + 40, (s) => -(track.barrierAt(s, -1) + 46), 12), width: 7, kind: 2 });
  // spectator walkways behind the fences round the lap
  const walk = (sA: number, sB: number, side: number, off: number) => {
    const pts = trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2 * Math.sin(s * 0.013)), 9).filter((q) => lakeDistance(map, q.x, q.z) > 3);
    if (pts.length > 3) map.paths.push({ pts, width: 3.4, kind: 1 });
  };
  walk(t2.sEnd + 30, t3.sStart - 30, L, 18);
  walk(t4.sEnd + 30, t6.sStart - 40, L, 20);
  walk(t7.sEnd + 30, t9.sStart - 40, L, 22);
  walk(t10.sEnd + 30, t11.sStart - 40, L, 18);
  walk(t12.sEnd + 30, t13.sStart - 20 + track.length, L, 16);

  // ---------------------------------------------------------------- avenues of plane trees and elms
  const avenueTrees: V2[] = [];
  const avenue = (pts: V2[], spacing: number, off: number) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (let t = 0; t < len; t += spacing)
        for (const sd of [-1, 1]) {
          const x = a.x + ((b.x - a.x) * t) / len + nx * off * sd, z = a.z + ((b.z - a.z) * t) / len + nz * off * sd;
          if (map.trackClearance(x, z) > 5 && lakeDistance(map, x, z) > 6) avenueTrees.push({ x, z });
        }
    }
  };
  // along the road behind the main stands (Aughtie Drive's avenue)
  avenue(trackLine(t14.sEnd + 20, t1.sStart, (s) => -(track.barrierAt(s, -1) + 46), 30), 14, 7);
  // the outer side of Lakeside Drive (the back straight) and round the north end by the marina
  avenue(trackLine(t7.sEnd + 60, t9.sStart - 60, (s) => -(track.barrierAt(s, -1) + 12), 30), 16, 0.01);

  // ---------------------------------------------------------------- big screens
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, side: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 6) => {
    const lat = side * (track.barrierAt(s, side) + back);
    const q = at(s, lat);
    if (lakeDistance(map, q.x, q.z) < 6) return;
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.heightAt(s), rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
    map.clearings.push({ x: q.x, z: q.z, r: 12, soft: 10, keep: 0.2 });
  };
  screenAt(t1.sStart + 40, R, 800, L, 40, 14, 8, 30);
  screenAt(t3.sStart - 40, R, t3.sStart - 100, L, 40);
  screenAt(t6.sStart - 30, R, t6.sStart - 90, L, 40);
  screenAt(t9.sStart - 60, L, t9.sStart - 120, R, 40);
  screenAt(t11.sStart - 40, R, t11.sStart - 100, L, 40);
  screenAt(t13.sStart - 30 + track.length, L, t13.sStart - 90 + track.length, R, 40, 12, 7, 12);

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

  // ---------------------------------------------------------------- landmark sites (built by melbourneScenery.ts)
  const reserve = (x: number, z: number, hw: number, hl: number, angle: number, r: number) => {
    map.exclusions.push({ cx: x, cz: z, halfW: hw, halfL: hl, angle });
    clear(x, z, r, 30, 0.05);
  };
  reserve(MEL_SITES.msac.x, MEL_SITES.msac.z, 75, 55, 0.35, 90);
  reserve(MEL_SITES.stadium.x, MEL_SITES.stadium.z, 95, 60, 0.35, 90);
  reserve(MEL_SITES.shrine.x, MEL_SITES.shrine.z, 60, 60, 0, 90);
  for (const [s, hw, hl, ang] of [[MEL_SITES.msac, 80, 60, 0.35], [MEL_SITES.stadium, 100, 64, 0.35]] as const) {
    const y = map.naturalExact(s.x, s.z);
    map.worldPads.push({ cx: s.x, cz: s.z, halfW: hw, halfL: hl, angle: ang, h: y, blend: 16, paved: true });
  }
  for (const o of ovals) map.worldPads.push({ cx: o.x, cz: o.z, halfW: o.r, halfL: o.r * 0.85, angle: 0.3, h: map.naturalExact(o.x, o.z), blend: 20 });

  // ---------------------------------------------------------------- hospitality & TV towers
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[t3.sEnd + 180, -1], [t10.sEnd + 150, 1], [t11.sStart - 260, -1]], 40);
  addCameraTowers(track, map, landmarks, ['Jones', 'Sports Centre', 'Marina', 'Turn 9', 'Ascari', 'Stewart', 'Turn 13']);
  // (drop any that fell in the water)
  for (let i = landmarks.length - 1; i >= 0; i--) if (lakeDistance(map, landmarks[i].x, landmarks[i].z) < 8) landmarks.splice(i, 1);

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
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees, villages: [], landmarks };
}

// ---------------------------------------------------------------- fans & flags

/** the crowd: green and gold, papaya for the local hero, Ferrari red, team kit */
export const MELBOURNE_FAN_COLOURS = ['#00843d', '#1a7a3a', '#ffcd00', '#f5c400', '#ff8000', '#00247d', '#ffffff', '#101010'];

/** flags 0–3: the Australian flag, a green-and-gold AUSSIE banner, a papaya 81 banner, a MELBOURNE banner */
export function drawMelbourneFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number) {
  const txt = (x: number, y: number, s: string, size: number, col: string) => {
    ctx.fillStyle = col;
    ctx.font = `900 ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  // 0: the Australian flag: the Union Jack in the canton, the Commonwealth Star below it, the Southern Cross
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#012169';
    ctx.fillRect(x, y, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, S / 2, S / 2);
    ctx.clip();
    const w = S / 2, h = S / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = S * 0.06;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.strokeStyle = '#c8102e';
    ctx.lineWidth = S * 0.02;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + w / 2 - S * 0.05, y, S * 0.1, h);
    ctx.fillRect(x, y + h / 2 - S * 0.05, w, S * 0.1);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x + w / 2 - S * 0.03, y, S * 0.06, h);
    ctx.fillRect(x, y + h / 2 - S * 0.03, w, S * 0.06);
    ctx.restore();
    star(ctx, x + S * 0.25, y + S * 0.75, S * 0.1, 7);
    for (const [u, v, r] of [[0.75, 0.84, 0.05], [0.6, 0.47, 0.05], [0.75, 0.18, 0.05], [0.88, 0.4, 0.05], [0.81, 0.56, 0.028]] as const) star(ctx, x + u * S, y + v * S, S * r, u > 0.8 && v > 0.5 ? 5 : 7);
  }
  // 1: green and gold AUSSIE banner
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#00843d';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffcd00';
    ctx.fillRect(x, y + S * 0.36, S, S * 0.28);
    txt(x + S / 2, y + S * 0.5, 'AUSSIE', 64, '#00843d');
  }
  // 2: papaya 81
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#ff8000';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(x, y + S * 0.76, S, S * 0.08);
    txt(x + S / 2, y + S * 0.42, '81', 130, '#ffffff');
  }
  // 3: MELBOURNE banner, navy and white
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#00247d';
    ctx.fillRect(x, y, S, S * 0.22);
    ctx.fillRect(x, y + S * 0.78, S, S * 0.22);
    txt(x + S / 2, y + S * 0.5, 'MELBOURNE', 40, '#00247d');
  }
}

/** a white star of `n` points (the Commonwealth Star has seven), outer radius r */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number) {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / n;
    const rr = k % 2 ? r * 0.45 : r;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (k) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
