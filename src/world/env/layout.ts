import * as THREE from 'three';
import type { Track } from '../Track.ts';
import { WorldMap, type V2 } from './worldmap.ts';
import { planOval, type OvalPath } from './ovalpath.ts';
import { fbm2, rng } from './noise.ts';

/**
 * Where everything goes in the Parco di Monza. Computed from the track (corner
 * names and s ranges) before the terrain is baked, so stands get flat pads,
 * spectator banks get raised, and trees keep clear of stands, paths, the old
 * oval and the pit complex.
 */

export type StandStyle = 'centrale' | 'covered' | 'open';

export interface GrandstandSpec {
  name: string;
  sA: number;
  sB: number;
  /** side of the track (−1 left, +1 right) */
  side: number;
  /** lateral distance of the front edge from the centreline */
  front: number;
  rows: number;
  roof: boolean;
  style: StandStyle;
  /** floor-plan centre (world) */
  center: THREE.Vector3;
  /** unit vector pointing from the stand toward the track */
  facing: THREE.Vector3;
  length: number;
  depth: number;
  height: number;
  /** base height (absolute) of the stand's front edge */
  y0: number;
  /** stand group id: segments of one stand share seats colours */
  group: number;
}

/** raised grass bank with standing/sitting fans */
export interface SpectatorBank {
  sA: number;
  sB: number;
  side: number;
  latA: number;
  latB: number;
  rise: number;
  density: number;
}

export interface ScreenSpec {
  x: number;
  z: number;
  y: number;
  /** facing angle (rotation.y; local +Z faces the viewers) */
  rot: number;
  w: number;
  h: number;
}

export interface Layout {
  grandstands: GrandstandSpec[];
  banks: SpectatorBank[];
  screens: ScreenSpec[];
  /** Monza's old banked oval (null elsewhere) */
  oval: OvalPath | null;
  /** pit complex band (kept free for the pit agent's buildings) */
  pit: { sA: number; sB: number; side: number; front: number; depth: number; paddockTo: number; y0: number; y1: number };
  /** tall flagpoles with big flags (world points) */
  flagpoles: V2[];
  /** rows of Lombardy poplars along avenues (world points, spacing done) */
  poplarRows: V2[];
  /** plane-tree avenues (world points) */
  avenueTrees: V2[];
  /** village clusters beyond the park (centre + radius) */
  villages: { x: number; z: number; r: number; seed: number }[];
}

const ROW_DEPTH = 0.86;
const ROW_RISE = 0.46;

export function planLayout(track: Track, map: WorldMap): Layout {
  const monza = track.def.id !== 'spa';
  const oval = monza ? planOval(track, (x, z) => map.naturalExact(x, z)) : null;
  if (oval) map.setOval(oval);
  const p = new THREE.Vector3();
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;

  // ---------------------------------------------------------------- grandstands
  const gs: GrandstandSpec[] = [];
  let groupId = 0;
  const addStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap = 7, segLen = 70) => {
    const group = groupId++;
    const total = track.delta(sA, sB);
    const nSeg = Math.max(1, Math.round(total / segLen));
    const depth = rows * ROW_DEPTH + 3.2;
    for (let k = 0; k < nSeg; k++) {
      const a = sA + (total * k) / nSeg + (k > 0 ? 1.5 : 0);
      const b = sA + (total * (k + 1)) / nSeg - (k < nSeg - 1 ? 1.5 : 0);
      let bar = 0;
      for (let s = a; s <= b; s += 2) bar = Math.max(bar, track.barrierAt(s, side));
      let front = bar + gap;
      // push out until the straight chord clears barrier + gap everywhere along the range
      for (let it = 0; it < 6; it++) {
        const A = track.point(a, side * front, 0, new THREE.Vector3());
        const B = track.point(b, side * front, 0, new THREE.Vector3());
        const vx = B.x - A.x, vz = B.z - A.z;
        const L = Math.hypot(vx, vz);
        let worst = Infinity;
        for (let s = a - 20; s <= b + 20; s += 2) {
          const i = Math.floor(track.wrap(s));
          const qx = track.px[i], qz = track.pz[i];
          let t = ((qx - A.x) * vx + (qz - A.z) * vz) / (L * L);
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(qx - A.x - vx * t, qz - A.z - vz * t);
          worst = Math.min(worst, d - track.barrierAt(s, side));
        }
        if (worst >= gap - 0.5) break;
        front += gap - worst + 0.5;
      }
      const A = track.point(a, side * front, 0, new THREE.Vector3());
      const B = track.point(b, side * front, 0, new THREE.Vector3());
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const length = A.distanceTo(B);
      const along = B.clone().sub(A).normalize();
      const facing = new THREE.Vector3(-along.z, 0, along.x);
      const f = track.frame((a + b) / 2);
      const toTrack = f.pos.clone().sub(mid);
      toTrack.y = 0;
      if (facing.dot(toTrack) < 0) facing.negate();
      const center = mid.clone().addScaledVector(facing, -depth / 2);
      const y0 = track.heightAt((a + b) / 2) - 0.05;
      const roof = style !== 'open';
      gs.push({ name, sA: a, sB: b, side, front, rows, roof, style, center, facing, length, depth, height: rows * ROW_RISE + 1.8, y0, group });
      const ang = Math.atan2(facing.x, facing.z);
      map.worldPads.push({ cx: center.x, cz: center.z, halfW: length / 2 + 3, halfL: depth / 2 + 4, angle: ang, h: y0, blend: 14, paved: true });
      map.exclusions.push({ cx: center.x, cz: center.z, halfW: length / 2 + 5, halfL: depth / 2 + 6, angle: ang });
      map.clearings.push({ x: center.x - facing.x * 6, z: center.z - facing.z * 6, r: Math.max(length, depth) / 2 + 8, soft: 22, keep: 0 });
    }
  };
  const L = -1, R = 1;
  if (!oval) return planSpa(track, map, addStand, gs);
  // main straight: west side, opposite the pits
  addStand('Tribuna Centrale', 452, 660, L, 28, 'centrale', 8, 105);
  addStand('Laterale Nord', 668, 880, L, 22, 'covered', 7, 72);
  addStand('Laterale Sud', 236, 444, L, 22, 'covered', 7, 72);
  // Rettifilo: the outside of the braking zone and across the escape road
  addStand('Prima Variante', 950, 1140, L, 20, 'covered', 7, 64);
  addStand('Variante Nord', 1168, 1236, L, 16, 'open', 8, 70);
  // Roggia
  const rog = corner('Roggia');
  addStand('Roggia', rog.sStart - 150, rog.sStart - 8, R, 16, 'open', 7, 72);
  addStand('Roggia Esterna', rog.sStart - 70, rog.sEnd + 12, L, 12, 'open', 7, 60);
  // Lesmos (small)
  const l1 = corner('Lesmo 1');
  addStand('Lesmo', l1.sStart - 60, l1.sApex - 10, L, 12, 'open', 7, 60);
  const l2 = corner('Lesmo 2');
  addStand('Lesmo 2', l2.sStart - 58, l2.sStart + 4, L, 10, 'open', 7, 62);
  // Ascari: the braking zone (outside of the first left) and the outside of the right
  const asc = corner('Ascari');
  addStand('Ascari', asc.sStart - 150, asc.sStart - 10, R, 18, 'covered', 7, 70);
  const t9 = corner('Turn 9');
  addStand('Ascari Uscita', t9.sStart + 6, t9.sEnd - 8, L, 16, 'open', 7, 60);
  // Parabolica: all round the outside
  const par = corner('Parabolica');
  addStand('Parabolica Ingresso', par.sStart - 210, par.sStart - 16, L, 20, 'covered', 8, 66);
  addStand('Parabolica', par.sStart + 20, par.sStart + 170, L, 18, 'open', 7, 50);
  addStand('Parabolica Uscita', par.sEnd - 150, par.sEnd - 12, L, 16, 'open', 7, 50);

  // ---------------------------------------------------------------- spectator banks (prato)
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
  const cg = corner('Curva Grande');
  addBank(cg.sStart + 520, cg.sEnd - 30, L, 1.6, 0.8, 5, 18);
  addBank(l2.sEnd + 20, l2.sEnd + 110, R, 1.4, 0.7, 5, 14);
  addBank(asc.sEnd + 100, asc.sEnd + 200, L, 1.5, 0.75, 5, 16);
  addBank(par.sStart + 60, par.sStart + 250, R, 1.3, 0.6, 6, 20);
  addBank(l1.sEnd + 30, l1.sEnd + 110, R, 1.2, 0.55, 5, 14);

  // ---------------------------------------------------------------- open lawns / meadows
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  // Ascari: open grass inside the chicane and on the outside of the exit
  { const q = at(asc.sApex + 60, 70); clear(q.x, q.z, 55, 40, 0.1); }
  { const q = at(t9.sApex, -80); clear(q.x, q.z, 45, 35, 0.15); }
  // Parabolica: the big lawn inside the curve, open grass outside behind the stands
  { const q = at(par.sApex + 120, 95); clear(q.x, q.z, 90, 50, 0.08); }
  { const q = at(par.sApex + 40, 175); clear(q.x, q.z, 80, 50, 0.2); }
  // T1: open area around the chicane stands and escape road
  { const q = at(1190, -95); clear(q.x, q.z, 55, 35, 0.12); }
  { const q = at(1150, 70); clear(q.x, q.z, 50, 35, 0.25); }
  // Roggia & Lesmo: a little open grass around the stands
  { const q = at(rog.sApex, 80); clear(q.x, q.z, 40, 30, 0.35); }
  // behind the main stands: service road, hospitality lawn, car parks
  for (let s = 230; s <= 890; s += 40) { const q = at(s, -125); clear(q.x, q.z, 48, 28, 0.15); }
  // Villa Reale gardens and the big meadows in the south of the park
  {
    const cx = map.A.center.x, cz = map.A.center.z;
    clear(cx + 120, cz + 1900, 420, 180, 0.05);
    clear(cx - 700, cz + 1400, 260, 150, 0.1);
    clear(cx + 850, cz + 900, 240, 140, 0.15);
    clear(cx - 850, cz - 250, 200, 140, 0.2);
    clear(cx + 950, cz - 1500, 230, 160, 0.12);
    // golf course north of the circuit
    clear(cx - 150, cz - 1650, 300, 150, 0.12);
  }

  // ---------------------------------------------------------------- sightlines to the old banking
  // meadows between the circuit and the Sopraelevata so its concrete wall shows through the park
  const sightline = (sTrack: number, side: number, r0: number) => {
    const q = at(sTrack, side * (track.barrierAt(sTrack, side) + 12));
    let bi = 0, bd = Infinity;
    for (let i = 0; i < oval.n; i += 2) {
      const d = (oval.x[i] - q.x) ** 2 + (oval.z[i] - q.z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const mx = (q.x + oval.x[bi]) / 2, mz = (q.z + oval.z[bi]) / 2;
    clear(mx, mz, r0, 26, 0.04);
    clear(oval.x[bi], oval.z[bi], r0 * 0.8, 20, 0.1);
  };
  sightline(2030, R, 48);
  sightline(1880, R, 40);
  sightline(3560, R, 34);
  sightline(par.sApex + 60, L, 44);

  // ---------------------------------------------------------------- paths & roads
  const r = rng(771);
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // service road behind the main stands
  map.paths.push({ pts: trackLine(150, 1000, (s) => -(track.barrierAt(s, -1) + 58), 12), width: 7, kind: 2 });
  // spectator walkways through the woods, parallel to the fences
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(cg.sStart + 40, cg.sEnd + 60, L, 16);
  walk(cg.sStart + 60, cg.sEnd - 40, R, 20);
  walk(2060, rog.sStart - 160, L, 14);
  walk(l1.sEnd + 20, l2.sStart - 20, R, 15);
  walk(l2.sEnd + 40, 3620, L, 15);
  walk(3790, asc.sStart - 170, R, 15);
  walk(t9.sEnd + 30, par.sStart - 230, R, 16);
  walk(t9.sEnd + 60, par.sStart - 240, L, 17);
  // meandering gravel paths in the park
  const meander = (x0: number, z0: number, heading: number, len: number) => {
    const pts: V2[] = [];
    let x = x0, z = z0, h = heading;
    for (let d = 0; d < len; d += 12) {
      pts.push({ x, z });
      h += (fbm2(x / 300 + d * 0.001, z / 300, 2)) * 0.12 + (r() - 0.5) * 0.05;
      x += Math.sin(h) * 12;
      z += Math.cos(h) * 12;
    }
    map.paths.push({ pts, width: 3.6, kind: 1 });
  };
  const C = map.A.center;
  meander(C.x - 900, C.z + 600, 0.3, 1400);
  meander(C.x + 700, C.z + 1600, -2.6, 1500);
  meander(C.x + 350, C.z - 150, 2.2, 900);
  meander(C.x - 350, C.z + 1900, 1.4, 1200);
  meander(C.x + 1000, C.z - 900, 3.4, 900);
  // straight avenues (viali) lined with plane trees / poplars
  const avenueTrees: V2[] = [];
  const poplarRows: V2[] = [];
  const avenue = (x0: number, z0: number, x1: number, z1: number, width: number, poplars: boolean) => {
    map.paths.push({ pts: [{ x: x0, z: z0 }, { x: x1, z: z1 }], width, kind: width > 6 ? 2 : 1 });
    const Ln = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / Ln, uz = (z1 - z0) / Ln;
    const off = width / 2 + 3.5;
    const step = poplars ? 7 : 11;
    for (let d = 6; d < Ln - 6; d += step)
      for (const sd of [-1, 1]) {
        const q = { x: x0 + ux * d - uz * off * sd, z: z0 + uz * d + ux * off * sd };
        (poplars ? poplarRows : avenueTrees).push(q);
      }
  };
  avenue(C.x - 1150, C.z + 2350, C.x - 1250, C.z - 450, 7, false); // Viale Cavriga (west)
  avenue(C.x + 1100, C.z + 2600, C.x + 1180, C.z - 700, 6, true); // eastern poplar avenue
  avenue(C.x - 1150, C.z + 2100, C.x + 1050, C.z + 2250, 8, false); // Viale Mirabello (south)
  avenue(C.x - 80, C.z + 1500, C.x + 140, C.z + 2700, 5, true);
  // poplar lines along field edges outside the park
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2;
    const R0 = 3000 + r() * 1800;
    const x0 = C.x + Math.cos(a) * R0, z0 = C.z + 400 + Math.sin(a) * R0 * 1.1;
    const h = r() * Math.PI;
    const Ln = 200 + r() * 400;
    for (let d = 0; d < Ln; d += 8) poplarRows.push({ x: x0 + Math.cos(h) * d, z: z0 + Math.sin(h) * d });
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
    map.clearings.push({ x: q.x, z: q.z, r: 12, soft: 10, keep: 0.2 });
  };
  screenAt(918, L, 520, L, 30, 14, 8, 30);
  screenAt(1075, R, 1040, L, 40);
  screenAt(asc.sStart - 60, L, asc.sStart - 80, R, 40);
  screenAt(par.sApex + 40, R, par.sApex + 60, L, 60, 14, 8);
  screenAt(rog.sStart - 80, L, rog.sStart - 80, R, 40, 10, 6);

  // ---------------------------------------------------------------- flagpoles (tifosi)
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

  // ---------------------------------------------------------------- villages beyond the park wall
  const villages: Layout['villages'] = [];
  {
    const spots: [number, number, number][] = [
      [-2600, -1400, 420], [-2900, 900, 380], [2500, -1900, 520], [2800, 400, 360], [-800, -3600, 600],
      [1500, -3800, 500], [-3200, 3200, 480], [300, 4600, 700], [3300, 3000, 420], [-1900, -3100, 360],
    ];
    spots.forEach(([dx, dz, rr], i) => villages.push({ x: C.x + dx, z: C.z + dz, r: rr, seed: 17 + i * 31 }));
    for (const v of villages) map.clearings.push({ x: v.x, z: v.z, r: v.r, soft: 80, keep: 0 });
  }

  // ---------------------------------------------------------------- pit complex (reserved)
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

  return { grandstands: gs, banks, screens, oval, pit: pitSpec, flagpoles, poplarRows, avenueTrees, villages };
}

/**
 * Spa-Francorchamps: the circuit runs through spruce forest on the valley sides, with
 * grandstands where the real ones are and fans on the grass banks all round
 * (Raidillon's hillside, the Kemmel straight, Pouhon, Blanchimont).
 */
function planSpa(
  track: Track,
  map: WorldMap,
  addStand: (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void,
  gs: GrandstandSpec[],
): Layout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  // start/finish straight: the main grandstand opposite the pits (pit wall on the left)
  addStand('Tribune Principale', 440, 700, R, 26, 'centrale', 8, 100);
  const bus = corner('Bus Stop');
  addStand('Bus Stop', bus.sStart - 150, bus.sStart - 10, L, 18, 'covered', 8, 70);
  const ls = corner('La Source');
  addStand('La Source', ls.sStart - 140, ls.sApex, L, 20, 'covered', 8, 70);
  addStand('La Source Sortie', ls.sEnd + 10, ls.sEnd + 120, R, 14, 'open', 7, 60);
  const er = corner('Eau Rouge');
  addStand('Eau Rouge', er.sStart - 130, er.sStart - 5, R, 20, 'covered', 8, 65);
  const lc = corner('Les Combes');
  addStand('Les Combes', lc.sStart - 130, lc.sApex, L, 16, 'open', 7, 65);
  const rv = corner('Rivage');
  addStand('Rivage', rv.sStart - 30, rv.sApex + 10, L, 14, 'open', 7, 55);
  const po = corner('Pouhon');
  addStand('Pouhon', po.sStart - 40, po.sApex + 40, R, 16, 'open', 7, 60);
  const st = corner('Stavelot');
  addStand('Stavelot', st.sStart - 110, st.sStart - 5, L, 14, 'open', 7, 60);
  const bl = corner('Blanchimont');
  addStand('Blanchimont', bl.sStart - 60, bl.sApex + 20, R, 14, 'open', 7, 60);

  // grass banks: fans on the hillsides
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
  const rd = corner('Raidillon');
  addBank(rd.sStart - 20, rd.sEnd + 60, L, 3.2, 0.95, 5, 22);
  addBank(er.sEnd + 10, rd.sEnd + 30, R, 2.4, 0.85, 6, 18);
  addBank(rd.sEnd + 150, rd.sEnd + 520, L, 1.6, 0.6, 5, 16);
  addBank(lc.sStart - 380, lc.sStart - 150, R, 1.4, 0.5, 5, 14);
  addBank(po.sStart - 160, po.sStart - 50, R, 2.0, 0.75, 5, 18);
  addBank(po.sApex, corner('Turn 11').sEnd, L, 1.8, 0.7, 6, 20);
  addBank(corner('Fagnes').sStart - 80, corner('Fagnes').sApex, L, 1.5, 0.55, 5, 14);
  addBank(bl.sStart - 220, bl.sStart - 70, R, 1.6, 0.6, 5, 16);
  addBank(bus.sStart - 240, bus.sStart - 160, L, 1.4, 0.55, 5, 14);

  // open ground: the paddock and car parks behind the main stand, the valley floor at Eau Rouge
  for (let s = 420; s <= 720; s += 40) { const q = at(s, 120); clear(q.x, q.z, 48, 28, 0.15); }
  { const q = at(er.sApex, -70); clear(q.x, q.z, 55, 35, 0.25); }
  { const q = at(po.sApex + 60, -110); clear(q.x, q.z, 70, 45, 0.2); }
  { const q = at(ls.sApex, 70); clear(q.x, q.z, 50, 30, 0.2); }

  // service road behind the main stands, walkways along the banks
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  map.paths.push({ pts: trackLine(420, 740, (s) => track.barrierAt(s, 1) + 60, 12), width: 7, kind: 2 });
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(rd.sEnd + 60, lc.sStart - 160, L, 24);
  walk(po.sStart - 300, po.sEnd + 150, R, 26);
  walk(bl.sStart - 400, bl.sEnd + 80, R, 20);

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
  screenAt(740, L, 570, R, 30, 14, 8, 30);
  screenAt(er.sStart - 60, L, er.sStart - 70, R, 40);
  screenAt(po.sStart - 80, L, po.sStart - 60, R, 40);
  screenAt(bus.sStart - 90, R, bus.sStart - 80, L, 40, 10, 6);

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
  return { grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages: [] };
}

export const STAND_ROW_DEPTH = ROW_DEPTH;
export const STAND_ROW_RISE = ROW_RISE;
