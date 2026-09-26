import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Geo, TrackSpace, type UVRect } from './geo.ts';
import { L, GARAGE_W, type PitPlan } from './layout.ts';
import { Z } from './materials.ts';
import type { DecalAtlas } from './textures.ts';

/**
 * Pit-side ground from the road edge outward: verge, pit lane, service apron,
 * entry/exit spur lanes and their gores, grass beside the spurs, the paddock
 * slab, garage floors — plus all the paint on it (lane lines, box markings,
 * team names and emblems, hatching, limiter lines).
 */

class GroundGeo {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  g: number[] = [];
  idx: number[] = [];
  geometry() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aG', new THREE.Float32BufferAttribute(this.g, 4));
    geo.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

const COL: Record<number, THREE.Color> = {
  [Z.LANE]: new THREE.Color(0.043, 0.044, 0.047),
  [Z.VERGE]: new THREE.Color(0.066, 0.066, 0.066),
  [Z.APRON]: new THREE.Color(0.25, 0.255, 0.26),
  [Z.EPOXY]: new THREE.Color(0.42, 0.43, 0.44),
  [Z.PADDOCK]: new THREE.Color(0.075, 0.074, 0.072),
  [Z.GRASS]: new THREE.Color(0.075, 0.12, 0.04),
  [Z.CONCRETE]: new THREE.Color(0.2, 0.2, 0.2),
  [Z.WORK]: new THREE.Color(0.07, 0.071, 0.074),
};

export function buildGround(plan: PitPlan, ts: TrackSpace): THREE.BufferGeometry {
  const gg = new GroundGeo();
  const P = new THREE.Vector3();
  const strip = (sA: number, sB: number, l0: (s: number) => number, l1: (s: number) => number, zone: number, lift: number, ds = 2, color?: THREE.Color) => {
    if (sB <= sA) return;
    const n = Math.max(1, Math.ceil((sB - sA) / ds));
    const c = color ?? COL[zone];
    let maxW = 0;
    for (let k = 0; k <= n; k++) {
      const s = sA + ((sB - sA) * k) / n;
      maxW = Math.max(maxW, l1(s) - l0(s));
    }
    const m = Math.max(1, Math.ceil(maxW / 6));
    const base = gg.pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const s = sA + ((sB - sA) * k) / n;
      const a = l0(s), b = Math.max(a, l1(s));
      for (let j = 0; j <= m; j++) {
        const l = a + ((b - a) * j) / m;
        ts.P(s, l, lift, P);
        gg.pos.push(P.x, P.y, P.z);
        gg.nor.push(0, 1, 0);
        gg.col.push(c.r, c.g, c.b);
        gg.g.push(s, l, zone, lift);
      }
    }
    // winding so the face points up
    const up = ts.side > 0;
    for (let k = 0; k < n; k++)
      for (let j = 0; j < m; j++) {
        const i0 = base + k * (m + 1) + j, i1 = i0 + 1, i2 = i0 + m + 1, i3 = i2 + 1;
        // (s, l) → with l to the right of +s when side = +1: (i0, i2, i1) is CCW from above
        if (up) gg.idx.push(i0, i1, i2, i1, i3, i2);
        else gg.idx.push(i0, i2, i1, i1, i2, i3);
      }
  };
  const k = (v: number) => () => v;
  const p = plan;
  const lift = 0.02;

  // along the pit wall
  strip(p.sStart, p.sEnd, k(p.road), k(L.wall), Z.VERGE, lift);
  strip(p.sStart, p.sEnd, k(L.wall + L.wallT - 0.05), k(L.divider), Z.LANE, lift);
  // the working lane in front of the garages is a smoother, sealed (lighter) surface
  strip(p.sStart, p.sEnd, k(L.divider), k(L.laneOuter), Z.WORK, lift);
  strip(p.sStart, p.sEnd, k(L.laneOuter), (s) => Math.max(L.laneOuter, p.outer(s)), Z.APRON, lift);
  // entry: gore + lane
  // (s < s0 lies over the trackside's verge/grass, hence the extra lift)
  strip(p.entryS, p.s0, k(p.road), (s) => p.entryLine(s), Z.VERGE, 0.035);
  strip(p.entryS, p.s0, (s) => p.entryLine(s), (s) => p.outer(s), Z.LANE, 0.035);
  strip(p.s0, p.sStart, k(p.road), (s) => p.entryLine(s), Z.VERGE, lift);
  strip(p.s0, p.sStart, (s) => p.entryLine(s), (s) => p.outer(s), Z.LANE, lift);
  // exit
  strip(p.sEnd, p.s1, k(p.road), (s) => p.exitLine(s), Z.VERGE, lift);
  strip(p.sEnd, p.s1, (s) => p.exitLine(s), (s) => p.outer(s), Z.LANE, lift);
  // grass beside the spur lanes (behind their outer walls)
  const gEnd = 46;
  strip(p.s0, p.sStart + 30, (s) => p.outer(s) + 0.45, k(gEnd), Z.GRASS, 0.05, 3);
  strip(p.sEnd - 30, p.s1, (s) => p.outer(s) + 0.45, k(gEnd), Z.GRASS, 0.05, 3);
  // paddock slab
  const padA = p.sStart + 30, padB = p.sEnd - 30;
  strip(padA, p.bldgS0, (s) => p.outer(s) + 0.45, k(p.paddockEnd), Z.PADDOCK, 0.05, 6);
  strip(p.bldgS0, p.bldgS1, k(L.bldgBack - 0.2), k(p.paddockEnd), Z.PADDOCK, 0.05, 6);
  strip(p.bldgS1, padB, (s) => p.outer(s) + 0.45, k(p.paddockEnd), Z.PADDOCK, 0.05, 6);
  // building floor (service garages, corridors) and the team garages' epoxy
  strip(p.bldgS0, p.bldgS1, k(L.front - 0.2), k(L.bldgBack), Z.CONCRETE, 0.04, 6);
  for (let t = 0; t < TEAMS.length; t++) {
    const g0 = p.teamS0 + t * GARAGE_W;
    strip(g0 + 0.35, g0 + GARAGE_W - 0.35, k(L.front + 0.1), k(L.garageBack), Z.EPOXY, 0.06, 3, new THREE.Color(0.2, 0.205, 0.215));
  }
  return gg.geometry();
}

// ------------------------------------------------------------------ paint

export function buildPaint(plan: PitPlan, ts: TrackSpace, atlas: DecalAtlas): Geo {
  const g = new Geo();
  const p = plan;
  const white = atlas.uv('white', 4);
  let lift = 0.021;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const paintWhite = () => g.rgb(0.78, 0.78, 0.76).mat(0.55, 1, 0, 1);
  const paintYellow = () => g.rgb(0.8, 0.55, 0.02).mat(0.55, 1, 0, 1);

  /** band along s between laterals l(s) ± w/2 */
  const line = (sA: number, sB: number, l: (s: number) => number, w: number, ds = 3, uv: UVRect = white) => {
    const n = Math.max(1, Math.ceil((sB - sA) / ds));
    for (let i = 0; i < n; i++) {
      const s0 = sA + ((sB - sA) * i) / n, s1 = sA + ((sB - sA) * (i + 1)) / n;
      ts.P(s0, l(s0) - w / 2, lift, A);
      ts.P(s1, l(s1) - w / 2, lift, B);
      ts.P(s1, l(s1) + w / 2, lift, C);
      ts.P(s0, l(s0) + w / 2, lift, D);
      g.quad(A, B, C, D, UP, uv);
    }
  };
  /** rectangle [s0,s1]×[l0,l1] */
  const rect = (s0: number, s1: number, l0: number, l1: number, uv: UVRect = white) => {
    ts.P(s0, l0, lift, A);
    ts.P(s1, l0, lift, B);
    ts.P(s1, l1, lift, C);
    ts.P(s0, l1, lift, D);
    g.quad(A, B, C, D, UP, uv);
  };
  /**
   * image on the ground centred at (s, l), `along` metres in s (image up = +s,
   * i.e. upright for a driver heading down the lane) × `across` metres
   */
  const image = (s: number, l: number, along: number, across: number, uv: UVRect) => {
    // the driver's right = +l when side = +1
    const r = ts.side > 0 ? 1 : -1;
    ts.P(s - along / 2, l - (r * across) / 2, lift, A);
    ts.P(s - along / 2, l + (r * across) / 2, lift, B);
    ts.P(s + along / 2, l + (r * across) / 2, lift, C);
    ts.P(s + along / 2, l - (r * across) / 2, lift, D);
    g.quad(A, B, C, D, UP, uv);
  };
  const k = (v: number) => () => v;

  // ---------------------------------------------------------------- lane lines
  paintWhite();
  line(p.sStart + 1, p.sEnd - 1, k(L.standLine), 0.12, 4);
  line(p.sStart + 25, p.sEnd - 25, k(L.divider), 0.12, 4);
  line(p.sStart + 18, p.sEnd - 12, k(L.laneOuter), 0.15, 4);
  // spur edge lines along the outer walls
  lift = 0.037;
  line(p.entryS + 25, p.s0, (s) => p.outer(s) - 0.55, 0.15, 3);
  line(p.entryS, p.s0, (s) => p.entryLine(s), 0.2, 3);
  image(p.entryS + 55, (p.entryLine(p.entryS + 55) + p.outer(p.entryS + 55)) / 2 + 0.2, 2.2, 3.6, atlas.uv('pit'));
  lift = 0.021;
  line(p.s0, p.sStart + 18, (s) => p.outer(s) - 0.55, 0.15, 3);
  line(p.sEnd - 12, p.s1 - 2, (s) => p.outer(s) - 0.55, 0.15, 3);
  // pit entry / exit lines (continue the trackside's on-road lines out to the wall noses)
  line(p.s0, p.sStart, (s) => p.entryLine(s), 0.2, 2);
  line(p.sEnd, p.exitLineEnd, (s) => p.exitLine(s), 0.2, 2);

  // gore hatching (chevrons pointing the way)
  const hatch = (sA: number, sB: number, edge: (s: number) => number, dir: 1 | -1) => {
    for (let s = sA; s < sB; s += 2.6) {
      const w = edge(s) - p.road;
      if (w < 0.9) continue;
      const lA = p.road + 0.25, lB = edge(s) - 0.2;
      const sk = dir * (lB - lA) * 0.9;
      ts.P(s, lA, lift, A);
      ts.P(s + 0.45, lA, lift, B);
      ts.P(s + 0.45 + sk, lB, lift, C);
      ts.P(s + sk, lB, lift, D);
      g.quad(A, B, C, D, UP, white);
    }
  };
  hatch(p.s0 + 40, p.sStart - 2, p.entryLine, 1);
  hatch(p.sEnd + 2, p.exitLineEnd - 8, p.exitLine, -1);

  // ---------------------------------------------------------------- speed limit lines
  for (const [s, isStart] of [[p.limitStart, true], [p.limitEnd, false]] as [number, boolean][]) {
    paintWhite();
    rect(s - 0.2, s + 0.2, L.wall + L.wallT, L.laneOuter);
    rect(s + (isStart ? 0.5 : -0.9), s + (isStart ? 0.9 : -0.5), L.wall + L.wallT, L.laneOuter);
    if (isStart) {
      image(s + 6, L.fast, 3.4, 4.2, atlas.uv('lim80'));
      image(s + 12, L.fast, 2.4, 4.6, atlas.uv('pit'));
    }
  }
  paintWhite();
  image(p.s0 + 60, (p.entryLine(p.s0 + 60) + p.outer(p.s0 + 60)) / 2, 2.4, 5.2, atlas.uv('pitentry'));
  image(p.sEnd + 8, 14.5, 2.4, 5.2, atlas.uv('pitexit'));
  for (const s of [p.sEnd - 30, p.sEnd + 22]) image(s, 14.5, 2.4, 1.3, atlas.uv('arrow'));

  // ---------------------------------------------------------------- team boxes
  TEAMS.forEach((team, t) => {
    const bs = p.boxS(t);
    const g0 = p.teamS0 + t * GARAGE_W;
    const prim = new THREE.Color(team.primary);
    const ink = new THREE.Color(team.ink);
    const lightPrim = prim.clone();
    // very dark primaries read better with a lift toward the secondary
    if (lightPrim.r + lightPrim.g + lightPrim.b < 0.1) lightPrim.lerp(new THREE.Color(team.secondary), 0.35);
    // apron in team colour with the emblem
    g.color(lightPrim, 0.9).mat(0.5, 0.12, 0, 1);
    rect(g0 + 0.6, g0 + GARAGE_W - 0.6, L.laneOuter + 0.2, L.front - 0.1);
    g.color(ink, 0.9).mat(0.5, 0.15, 0, 1);
    image(bs + 4.8, (L.laneOuter + L.front) / 2, 2.5, 2.5, atlas.uv('logo' + t, 2));
    image(bs - 4.8, (L.laneOuter + L.front) / 2, 2.5, 2.5, atlas.uv('logo' + t, 2));
    // yellow box outline
    paintYellow();
    const b0 = bs - 3.9, b1 = bs + 3.9, l0 = L.box - 1.85, l1 = L.box + 1.85;
    rect(b0, b1, l0, l0 + 0.1);
    rect(b0, b1, l1 - 0.1, l1);
    rect(b0, b0 + 0.1, l0, l1);
    rect(b1 - 0.1, b1, l0, l1);
    // team-colour nose bar and name in front of the box
    g.color(lightPrim, 1).mat(0.5, 0.4, 0, 1);
    rect(bs + 3.2, bs + 3.45, l0 + 0.25, l1 - 0.25);
    g.rgb(0.78, 0.78, 0.76).mat(0.55, 0.7, 0, 1);
    image(bs + 5.9, L.box, 1.35, 3.8, atlas.uv('name' + t, 3));
    // wheel position marks
    paintWhite();
    for (const ds of [-1.8, 1.8])
      for (const dl of [-1, 1]) {
        const lw = L.box + dl * 1.05;
        rect(bs + ds - 0.04, bs + ds + 0.04, lw - 0.3, lw + 0.3);
        rect(bs + ds - 0.3, bs + ds + 0.3, lw + dl * 0.26 - 0.04, lw + dl * 0.26 + 0.04);
      }
    // garage threshold line
    g.rgb(0.7, 0.7, 0.68).mat(0.55, 0.3, 0, 1);
    rect(g0 + 0.4, g0 + GARAGE_W - 0.4, L.front - 0.1, L.front + 0.08);
  });
  return g;
}
