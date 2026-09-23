import * as THREE from 'three';
import type { Track } from '../Track.ts';
import { WorldMap, type V2 } from './worldmap.ts';

/**
 * Where the big things go. Computed from the track (corner names, segment
 * ranges, anchors) before the terrain is baked so every building gets a flat
 * pad and vegetation keeps clear of it. Nothing here uses absolute s values or
 * coordinates, so a re-tuned circuit layout keeps a sensible world.
 */

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
  center: THREE.Vector3;
  /** unit vector pointing from the stand toward the track */
  facing: THREE.Vector3;
  length: number;
  depth: number;
  height: number;
}

export interface Landmark {
  x: number;
  z: number;
  y: number;
  rot: number;
}

export interface Layout {
  grandstands: GrandstandSpec[];
  pit: { sA: number; sB: number; side: number; front: number; depth: number; paddockTo: number; y0: number; y1: number };
  lighthouse: Landmark;
  hotel: Landmark;
  wheel: Landmark;
  church: Landmark;
  castle: Landmark;
  palms: V2[];
  cypresses: V2[];
  moles: V2[][];
  /** s of sponsor footbridges over the track */
  bridges: number[];
}

const ROW_DEPTH = 0.85;
const ROW_RISE = 0.44;

export function planLayout(track: Track, map: WorldMap): Layout {
  const A = map.A;
  const f = track.frame(0);
  const p = new THREE.Vector3();
  const segs = track.data.def.segments;
  const segIdx = (name: string, fallback: number) => {
    const i = segs.findIndex((s) => s.name === name);
    return i >= 0 ? i : fallback;
  };
  const segRange = (i: number): [number, number] => [track.data.segStart[i], track.data.segStart[i] + track.data.segLen[i]];
  const corner = (name: string, fallback: number) =>
    track.corners.find((c) => c.name === name) ?? track.corners[Math.min(fallback, track.corners.length - 1)];

  // ---------------------------------------------------------------- grandstands
  const gs: GrandstandSpec[] = [];
  const addStand = (name: string, sA: number, sB: number, side: number, rows: number, gap = 5, roof = true) => {
    let bar = 0;
    for (let s = sA; s <= sB; s += 2) bar = Math.max(bar, track.barrierAt(s, side));
    const front = bar + gap;
    const depth = rows * ROW_DEPTH + 3;
    const sm = (sA + track.delta(sA, sB) / 2 + track.n) % track.n;
    track.frame(sm, f);
    // straight stand along the chord of the s range
    const a = track.point(sA, side * front, 0, new THREE.Vector3());
    const b = track.point(sB, side * front, 0, new THREE.Vector3());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const length = a.distanceTo(b);
    const along = b.clone().sub(a).normalize();
    const facing = new THREE.Vector3(-along.z, 0, along.x);
    const toTrack = f.pos.clone().sub(mid);
    toTrack.y = 0;
    if (facing.dot(toTrack) < 0) facing.negate();
    const center = mid.clone().addScaledVector(facing, -depth / 2);
    gs.push({ name, sA, sB, side, front, rows, roof, center, facing, length, depth, height: rows * ROW_RISE + 1.4 });
    map.trackPads.push({ sA: sA - 6, sB: sB + 6, latA: side * (front - 2), latB: side * (front + depth + 4), offset: -0.05, blend: 16, paved: true });
    map.exclusions.push({ cx: center.x, cz: center.z, halfW: length / 2 + 4, halfL: depth / 2 + 3, angle: Math.atan2(facing.x, facing.z) });
  };
  {
    const [s0a, s0b] = segRange(0);
    const a = Math.max(s0a + 50, track.startS - 170);
    const b = Math.min(s0b - 70, track.startS + 118);
    addStand('Tribuna Principal', a, b, -1, 22, 6);
    const faro = corner('Faro', 0);
    addStand('Tribuna Faro', faro.sStart - 92, faro.sStart - 4, -1, 16, 6);
    const hp = track.corners.find((c) => c.name.startsWith('Horquilla')) ?? corner('', 3);
    addStand('Tribuna Puerto', hp.sStart - 100, hp.sStart - 6, hp.dir, 14, 6);
    const bus = corner('Bus Stop', 10);
    addStand('Tribuna Bus Stop', bus.sStart - 90, bus.sStart - 6, bus.dir, 14, 6);
    const par = corner('Parabólica', 12);
    addStand('Tribuna Parabólica', par.sApex - 45, par.sApex + 35, par.dir, 12, 6, false);
  }

  // ---------------------------------------------------------------- pit building + paddock
  const pit = track.pit;
  const pitSpec = {
    sA: pit.sStart,
    sB: pit.sEnd,
    side: pit.side,
    front: pit.garageOffset + 0.5,
    depth: 26,
    paddockTo: 132,
    y0: track.heightAt(pit.sStart),
    y1: track.heightAt(pit.sEnd),
  };
  {
    const a = track.point(pit.sStart, pit.side * 80, 0, new THREE.Vector3());
    const b = track.point(pit.sEnd, pit.side * 80, 0, new THREE.Vector3());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    map.exclusions.push({ cx: mid.x, cz: mid.z, halfW: 58, halfL: a.distanceTo(b) / 2 + 40, angle: ang });
  }

  // ---------------------------------------------------------------- landmarks
  const land = (x: number, z: number, rot: number, padR: number, blend: number, paved = false, minY = -Infinity): Landmark => {
    const y = Math.max(minY, map.naturalExact(x, z));
    map.worldPads.push({ cx: x, cz: z, halfW: padR, halfL: padR, angle: rot, h: y, blend, paved });
    map.exclusions.push({ cx: x, cz: z, halfW: padR + 4, halfL: padR + 4, angle: rot });
    return { x, z, y, rot };
  };
  const T = A.t1, H = A.hairpin;
  // lighthouse on the cape beyond Faro: plateau height of the pit straight end
  const lighthouse = land(T.x + 109, T.z + 126, 0.4, 9, 12, false, track.heightAt(corner('Faro', 0).sStart) - 3);
  const hotel = land(A.paseo.x - 215, A.paseo.z - 60, 0.05, 36, 24, true);
  const wheel = land(H.x - 44, H.z - 143, -0.35, 14, 14, true);
  const church = land(A.center.x + 400, A.bb.z0 - 554, 0.15, 14, 16, true);
  const castle = land(A.center.x + 940, A.bb.z0 - 469, 0.3, 30, 30);

  // ---------------------------------------------------------------- palms & cypresses
  const palms: V2[] = [];
  const line = (sA: number, sB: number, latFn: (s: number) => number, step: number, out: V2[]) => {
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      out.push({ x: p.x, z: p.z });
    }
  };
  {
    const [a, b] = segRange(segIdx('Paseo', 10));
    line(a + 15, b - 15, (s) => -(track.barrierAt(s, -1) + 11), 13, palms);
    line(a + 21, b - 9, (s) => -(track.barrierAt(s, -1) + 23), 13, palms);
  }
  {
    const [a, b] = segRange(segIdx('Bajada', 6));
    line(a + 40, b - 30, (s) => -(track.barrierAt(s, -1) + 16), 16, palms);
  }
  {
    const [a, b] = segRange(segIdx('Puerto', 8));
    line(a + 20, b - 10, (s) => track.barrierAt(s, 1) + 12, 14, palms);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    palms.push({ x: hotel.x + Math.cos(a) * 48, z: hotel.z + Math.sin(a) * 30 });
  }
  // harbour promenade along the quays (a few metres inland)
  {
    const q = map.coast.filter((c) => c.quay > 0.9);
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
      // inland normal: test which side is higher
      let nx = -tz, nz = tx;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (map.coastExact(mx + nx * 10, mz + nz * 10).dc < 0) { nx = -nx; nz = -nz; }
      for (let d = 6; d < L; d += 15) palms.push({ x: a.x + tx * d + nx * 9, z: a.z + tz * d + nz * 9 });
    }
  }

  const cypresses: V2[] = [];
  // avenue along the paddock access road (behind the pit building)
  line(pit.sStart + 50, pit.sEnd - 30, () => pit.side * 150, 11, cypresses);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    cypresses.push({ x: church.x + Math.cos(a) * 26, z: church.z + Math.sin(a) * 22 });
  }
  for (let k = 0; k < 22; k++) {
    const t = k / 21;
    cypresses.push({ x: castle.x - 260 + t * 200 + Math.sin(t * 9) * 20, z: castle.z + 180 - t * 120 });
  }
  for (let k = 0; k < 16; k++) cypresses.push({ x: A.bb.x1 + 380 + (k % 4) * 9, z: A.bb.z0 + 610 + Math.floor(k / 4) * 9 });

  // ---------------------------------------------------------------- footbridges
  const bridges: number[] = [];
  {
    const [a, b] = segRange(segIdx('Paseo', 10));
    bridges.push(a + (b - a) * 0.55);
    const [c, d] = segRange(segIdx('Recta del Sol', 20));
    bridges.push(c + (d - c) * 0.5);
  }
  for (const s of bridges) {
    for (const side of [-1, 1]) {
      const lat = side * (track.barrierAt(s, side) + 3.5);
      track.point(s, lat, 0, p);
      map.trackPads.push({ sA: s - 4, sB: s + 4, latA: lat - 3, latB: lat + 3, offset: -0.05, blend: 6 });
      map.exclusions.push({ cx: p.x, cz: p.z, halfW: 6, halfL: 6, angle: 0 });
    }
  }
  return { grandstands: gs, pit: pitSpec, lighthouse, hotel, wheel, church, castle, palms, cypresses, moles: map.moles, bridges };
}

export const STAND_ROW_DEPTH = ROW_DEPTH;
export const STAND_ROW_RISE = ROW_RISE;
