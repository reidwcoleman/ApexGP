import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { BASIN, LAKE, MTL_WATER_Y, SITES, montrealGeo } from './montrealLand.ts';

/**
 * Circuit Gilles Villeneuve's layout: where the stands, fans, paths, the basin's banks and
 * the landmark sites go. The main grandstands line the start/finish straight opposite the
 * pits (left), round the Senna S and at the hairpin, with the big "Grandstand 1" facing the
 * final chicane; the rest of the lap is walls, fences and fans on the flat grass behind
 * them. The paddock sits between the pit garages and the Olympic basin.
 */

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

export function planMontreal(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t13 = corner('Turn 13');
  const t1 = corner('Turn 1');
  const t2 = corner('Virage Senna');
  const t3 = corner('Turn 3');
  const t6 = corner('Turn 6');
  const t8 = corner('Turn 8');
  const hp = corner("L'Épingle");

  // ---------------------------------------------------------------- grandstands
  // Grandstand 1: the big covered stand facing the final chicane and the Wall of Champions
  addStand('Grandstand 1', t13.sStart - 190, t13.sStart - 12, L, 24, 'covered', 7, 70);
  // the start/finish straight, opposite the pits
  addStand('Grandstand 12', 300, 470, L, 24, 'covered', 7, 70);
  addStand('Grandstand Principale', 480, 720, L, 28, 'centrale', 7, 95);
  addStand('Grandstand 11', 730, t1.sStart - 12, L, 22, 'covered', 7, 70);
  // the Senna S: outside of the hairpin-like Turn 2
  addStand('Grandstand 15', t2.sStart - 20, t2.sEnd + 10, L, 20, 'covered', 7, 60);
  addStand('Grandstand 21', t3.sStart - 120, t3.sStart - 10, L, 14, 'open', 7, 60);
  // L'Épingle: all round the outside of the hairpin, and the braking zone
  addStand('Grandstand 34', hp.sStart - 150, hp.sStart - 10, L, 20, 'covered', 7, 70);
  addStand('Grandstand 33', hp.sStart - 5, hp.sEnd + 20, L, 16, 'open', 7, 50);
  // the Casino straight, before the chicane
  addStand('Grandstand 31', 3980, t13.sStart - 205, L, 16, 'open', 7, 70);

  // ---------------------------------------------------------------- general admission (flat grass, low banks)
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
  addBank(t3.sEnd + 20, t3.sEnd + 170, L, 0.8, 0.6, 5, 14);
  addBank(t6.sStart - 150, t6.sStart - 20, R, 0.8, 0.65, 5, 14);
  addBank(t6.sEnd + 60, t6.sEnd + 330, L, 0.9, 0.55, 5, 14);
  addBank(t8.sStart - 170, t8.sStart - 20, L, 1.0, 0.7, 5, 16);
  addBank(t8.sEnd + 40, t8.sEnd + 260, R, 0.8, 0.5, 5, 14);
  addBank(hp.sStart - 170, hp.sStart - 20, R, 0.8, 0.6, 5, 14);
  addBank(hp.sEnd + 60, hp.sEnd + 300, L, 0.9, 0.55, 5, 14);
  addBank(3700, 3960, L, 0.9, 0.55, 5, 14);

  // ---------------------------------------------------------------- open ground
  // the paddock (between the garages and the basin) and the hospitality lawns along the basin
  for (let s = 460; s <= 860; s += 40) { const q = at(s, 120); clear(q.x, q.z, 46, 24, 0.05); }
  // concourse and the service road behind the main stands
  for (let s = 260; s <= 900; s += 50) { const q = at(s, -(track.barrierAt(s, -1) + 48)); clear(q.x, q.z, 30, 18, 0.2); }
  // the Casino's forecourt and the Québec pavilion's plaza
  clear(SITES.casino.x, SITES.casino.z, 105, 40, 0.05);
  clear(SITES.quebecPavilion.x, SITES.quebecPavilion.z, 50, 25, 0.05);
  // its lawns run down to the hairpin approach: the Casino shows from the track and the hairpin
  for (const s of [2960, 3080, 3200, 3300]) {
    const a = at(s, -(track.barrierAt(s, -1) + 14));
    for (let t = 0; t <= 1; t += 0.2) clear(a.x + (SITES.casino.x - a.x) * t, a.z + (SITES.casino.z - a.z) * t, 34, 24, 0.12);
  }
  // the beach and its lawn
  clear(LAKE.x, LAKE.z, Math.max(LAKE.rx, LAKE.rz) + 30, 25, 0.15);
  // open lawns in the infield (Jardins des Floralies)
  for (const [x, z, r] of [[-170, -120, 60], [-60, 700, 50], [-250, 420, 55], [-120, -560, 40]] as const) clear(x, z, r, 40, 0.2);

  // ---------------------------------------------------------------- the Olympic basin
  {
    const B = BASIN;
    const dx = B.bx - B.ax, dz = B.bz - B.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const cx = (B.ax + B.bx) / 2, cz = (B.az + B.bz) / 2;
    // the water: a sharp-edged pad so the concrete banks stay vertical at the fine resolution
    map.worldPads.push({ cx, cz, halfW: B.half, halfL: len / 2, angle: Math.atan2(ux, uz), h: MTL_WATER_Y - 3.4, blend: 2.5 });
    // no trees in it, nor on the promenades
    map.exclusions.push({ cx, cz, halfW: B.half + 6, halfL: len / 2 + 6, angle: Math.atan2(ux, uz) });
    // the promenades along both banks (the paddock side is paved), maples lining the far one
    for (const sd of [-1, 1]) {
      const off = B.half + 7;
      const pts: V2[] = [];
      for (let d = -len / 2 - 6; d <= len / 2 + 6; d += 20) pts.push({ x: cx + ux * d - uz * off * sd, z: cz + uz * d + ux * off * sd });
      map.paths.push({ pts, width: sd > 0 ? 9 : 6, kind: sd > 0 ? 2 : 1 });
    }
  }
  const avenueTrees: V2[] = [];
  {
    const B = BASIN;
    const dx = B.bx - B.ax, dz = B.bz - B.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const cx = (B.ax + B.bx) / 2, cz = (B.az + B.bz) / 2;
    // the west bank's tree line (the east bank is the paddock's promenade)
    const off = B.half + 14;
    for (let d = -len / 2 + 8; d < len / 2 - 8; d += 12) avenueTrees.push({ x: cx + ux * d + uz * off, z: cz + uz * d - ux * off });
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
  // service road behind the start/finish grandstands
  map.paths.push({ pts: trackLine(t13.sStart - 200 + track.n, track.n + t1.sStart, (s) => -(track.barrierAt(s, -1) + 44), 12), width: 7, kind: 2 });
  // spectator walkways behind the fences round the back of the island
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2 * Math.sin(s * 0.013)), 9), width: 3.4, kind: 1 });
  };
  walk(t2.sEnd + 30, t3.sStart - 20, L, 16);
  walk(t3.sEnd + 30, t6.sStart - 40, R, 20);
  walk(t6.sEnd + 30, t8.sStart - 30, L, 26);
  walk(t8.sEnd + 30, hp.sStart - 40, L, 18);
  walk(hp.sEnd + 30, 4000, R, 16);
  // the beach: a sand band round the lake's east shore
  {
    const pts: V2[] = [];
    for (let a = -1.2; a <= 1.6; a += 0.1) pts.push({ x: LAKE.x + Math.cos(a) * (LAKE.rx + 8), z: LAKE.z + Math.sin(a) * (LAKE.rz + 8) });
    map.paths.push({ pts, width: 16, kind: 1 });
  }
  // the Casino's forecourt and access road
  map.paths.push({ pts: [{ x: SITES.casino.x + 20, z: SITES.casino.z + 60 }, { x: SITES.quebecPavilion.x + 10, z: SITES.quebecPavilion.z + 40 }, { x: -230, z: -420 }], width: 12, kind: 2 });

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
  screenAt(t1.sStart + 30, R, 700, L, 40, 14, 8, 26);
  screenAt(t2.sEnd + 40, R, t2.sApex, L, 40);
  screenAt(hp.sStart - 40, R, hp.sStart - 80, L, 40);
  screenAt(t13.sStart - 40, R, t13.sStart - 110, L, 40, 12, 7, 14);

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

  // ---------------------------------------------------------------- landmark sites (built by montrealScenery.ts)
  const reserve = (x: number, z: number, hw: number, hl: number, angle: number, r: number) => {
    map.exclusions.push({ cx: x, cz: z, halfW: hw, halfL: hl, angle });
    clear(x, z, r, 30, 0.05);
  };
  reserve(SITES.casino.x, SITES.casino.z, 62, 50, 0.3, 90);
  reserve(SITES.quebecPavilion.x, SITES.quebecPavilion.z, 30, 30, 0.3, 40);
  reserve(SITES.biosphere.x, SITES.biosphere.z, 48, 48, 0, 70);
  reserve(SITES.habitat.x, SITES.habitat.z, 170, 45, 0.5, 120);
  // pads: the Casino and pavilion stand on level plazas
  for (const [s, hw, hl] of [[SITES.casino, 70, 58], [SITES.quebecPavilion, 34, 34], [SITES.biosphere, 52, 52]] as const) {
    const y = Math.max(MTL_WATER_Y + 1.2, map.naturalExact(s.x, s.z));
    map.worldPads.push({ cx: s.x, cz: s.z, halfW: hw, halfL: hl, angle: 0.3, h: y, blend: 16, paved: true });
  }

  // ---------------------------------------------------------------- hospitality & TV towers
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[3600, -1], [3800, -1]], 40);
  addCameraTowers(track, map, landmarks, ['Turn 1', 'Virage Senna', 'Turn 3', 'Turn 6', 'Turn 8', "L'Épingle", 'Turn 13']);
  // (drop any that fell in the water)
  for (let i = landmarks.length - 1; i >= 0; i--) if (montrealGeo(map, landmarks[i].x, landmarks[i].z).coast < 8) landmarks.splice(i, 1);

  const pit = track.pit;
  const pitSpec = {
    sA: pit.sStart,
    sB: pit.sEnd,
    side: pit.side,
    front: pit.garageOffset + 0.5,
    depth: 26,
    paddockTo: 128,
    y0: track.heightAt(pit.sStart),
    y1: track.heightAt(pit.sEnd),
  };
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees, villages: [], landmarks };
}

// ---------------------------------------------------------------- fans & flags

/** the crowd: Canadian red and white, Ferrari red for Gilles, Québec blue, team kit */
export const MONTREAL_FAN_COLOURS = ['#d52b1e', '#e8322a', '#ffffff', '#f2f2f2', '#003da5', '#1b4fa0', '#c8102e', '#101010'];

/** flags 0–3: the Maple Leaf, the Fleurdelisé, a GILLES #27 banner, a MONTRÉAL banner */
export function drawMontrealFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number) {
  const txt = (x: number, y: number, s: string, size: number, col: string) => {
    ctx.fillStyle = col;
    ctx.font = `900 ${size}px "Titillium Web", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  };
  // 0: the Maple Leaf (red–white–red, 1:2:1, the eleven-point leaf)
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#d52b1e';
    ctx.fillRect(x, y, S * 0.25, S);
    ctx.fillRect(x + S * 0.75, y, S * 0.25, S);
    mapleLeaf(ctx, x + S / 2, y + S * 0.53, S * 0.4);
  }
  // 1: the Fleurdelisé (Québec): white cross on blue, a fleur-de-lis in each quarter
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#003da5';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + S * 0.44, y, S * 0.12, S);
    ctx.fillRect(x, y + S * 0.44, S, S * 0.12);
    for (const [u, v] of [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78]]) fleurDeLis(ctx, x + u * S, y + v * S, S * 0.16);
  }
  // 2: GILLES 27 (the Ferrari red of the tifosi's Québécois hero)
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S * 0.72, S, S * 0.07);
    txt(x + S / 2, y + S * 0.34, 'GILLES', 66, '#ffffff');
    txt(x + S / 2, y + S * 0.56, '27', 72, '#ffd400');
  }
  // 3: MONTRÉAL banner, red and white
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#d52b1e';
    ctx.fillRect(x, y, S, S * 0.22);
    ctx.fillRect(x, y + S * 0.78, S, S * 0.22);
    txt(x + S / 2, y + S * 0.5, 'MONTRÉAL', 44, '#d52b1e');
  }
}

/** the eleven-point maple leaf, centred at (cx, cy), about `r` from the centre to the top point */
export function mapleLeaf(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // outline in unit coordinates (x right, y down), from the official construction, simplified
  const P: [number, number][] = [
    [0, -1], [0.14, -0.72], [0.3, -0.8], [0.25, -0.34], [0.52, -0.62], [0.58, -0.48], [0.86, -0.54], [0.78, -0.26], [0.92, -0.2],
    [0.5, 0.14], [0.56, 0.3], [0.06, 0.24], [0.06, 0.62], [-0.06, 0.62], [-0.06, 0.24], [-0.56, 0.3], [-0.5, 0.14], [-0.92, -0.2],
    [-0.78, -0.26], [-0.86, -0.54], [-0.58, -0.48], [-0.52, -0.62], [-0.25, -0.34], [-0.3, -0.8], [-0.14, -0.72],
  ];
  ctx.fillStyle = '#d52b1e';
  ctx.beginPath();
  P.forEach(([u, v], i) => (i ? ctx.lineTo(cx + u * r, cy + v * r) : ctx.moveTo(cx + u * r, cy + v * r)));
  ctx.closePath();
  ctx.fill();
}

/** a simple heraldic fleur-de-lis, white, centred at (cx, cy), height ≈ 2h */
function fleurDeLis(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number) {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // central petal
  ctx.moveTo(cx, cy - h);
  ctx.quadraticCurveTo(cx + h * 0.32, cy - h * 0.45, cx + h * 0.1, cy + h * 0.2);
  ctx.lineTo(cx - h * 0.1, cy + h * 0.2);
  ctx.quadraticCurveTo(cx - h * 0.32, cy - h * 0.45, cx, cy - h);
  ctx.fill();
  // side petals
  for (const sd of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sd * h * 0.08, cy + h * 0.12);
    ctx.quadraticCurveTo(cx + sd * h * 0.95, cy - h * 0.55, cx + sd * h * 0.62, cy + h * 0.02);
    ctx.quadraticCurveTo(cx + sd * h * 0.5, cy + h * 0.3, cx + sd * h * 0.2, cy + h * 0.32);
    ctx.fill();
  }
  // band and foot
  ctx.fillRect(cx - h * 0.42, cy + h * 0.2, h * 0.84, h * 0.14);
  ctx.beginPath();
  ctx.moveTo(cx - h * 0.1, cy + h * 0.34);
  ctx.lineTo(cx + h * 0.1, cy + h * 0.34);
  ctx.lineTo(cx + h * 0.18, cy + h * 0.72);
  ctx.lineTo(cx - h * 0.18, cy + h * 0.72);
  ctx.fill();
}
