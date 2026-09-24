import * as THREE from 'three';
import type { GeoBuilder } from './builder.ts';
import type { Ctx } from './context.ts';
import type { DecalAtlas, UVRect } from './atlas.ts';
import { Rng } from './noise.ts';

/**
 * Painted markings as decals on the road plane: start/finish line (chequer),
 * the 20 F1-style grid brackets with numbers and launch marks, DRS detection
 * and activation lines, pit entry/exit lines and pit-lane lines + speed-limit
 * markings. Edge lines are drawn analytically in the asphalt shader instead.
 */

const LIFT = 0.006;
const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3();
const UP = new THREE.Vector3();

export function buildMarkings(ctx: Ctx, atlas: DecalAtlas) {
  const t = ctx.track;
  const cs = ctx.cs;
  const white = atlas.white;

  const B = (s: number) => cs.get(s, 'decal');

  /** quad in (s, lat) space: corners at s0..s1 × l0..l1, uv mapped with u ← lateral, v ← s */
  const PAINT = [0.74, 0.74, 0.72];
  const rect = (s0: number, s1: number, l0: number, l1: number, uv: UVRect, rgb = PAINT, rot = false) => {
    const b = B(s0);
    b.rgb(rgb[0], rgb[1], rgb[2]);
    b.mat(rgb[0] < 0.2 ? 0.86 : 0.6, 0, 0);
    t.point(s0, l0, LIFT, P0);
    t.point(s0, l1, LIFT, P1);
    t.point(s1, l1, LIFT, P2);
    t.point(s1, l0, LIFT, P3);
    upAt(s0);
    // default: u ← lateral, v ← s (text reads from a car driving +s); rot: u ← s, v ← lateral
    const a = b.v(P0.x, P0.y, P0.z, UP.x, UP.y, UP.z, uv.u0, uv.v0);
    const c = b.v(P1.x, P1.y, P1.z, UP.x, UP.y, UP.z, rot ? uv.u0 : uv.u1, rot ? uv.v1 : uv.v0);
    const d = b.v(P2.x, P2.y, P2.z, UP.x, UP.y, UP.z, uv.u1, uv.v1);
    const e = b.v(P3.x, P3.y, P3.z, UP.x, UP.y, UP.z, rot ? uv.u1 : uv.u0, rot ? uv.v0 : uv.v1);
    b.quadN(a, c, d, e, UP.x, UP.y, UP.z);
  };
  const upAt = (s: number) => {
    const k = ctx.wrap(Math.floor(s));
    UP.set(t.ux[k], t.uy[k], t.uz[k]);
  };
  /** line along s at lateral lat(s), width w, from s0 to s1 (1 m pieces) */
  const lineAlong = (s0: number, s1: number, lat: (s: number) => number, w: number, dash = 0, gap = 0) => {
    const step = 1;
    for (let s = s0; s < s1 - 1e-6; s += step) {
      const e = Math.min(s1, s + step);
      if (dash > 0) {
        const ph = ((s - s0) % (dash + gap));
        if (ph >= dash) continue;
      }
      const la = lat(s), lb = lat(e);
      const b = B(s);
      b.rgb(PAINT[0], PAINT[1], PAINT[2]).mat(0.6, 0, 0);
      t.point(s, la - w / 2, LIFT, P0);
      t.point(s, la + w / 2, LIFT, P1);
      t.point(e, lb + w / 2, LIFT, P2);
      t.point(e, lb - w / 2, LIFT, P3);
      upAt(s);
      const cu = (white.u0 + white.u1) / 2, cv = (white.v0 + white.v1) / 2;
      const a = b.v(P0.x, P0.y, P0.z, UP.x, UP.y, UP.z, cu, cv);
      const c = b.v(P1.x, P1.y, P1.z, UP.x, UP.y, UP.z, cu, cv);
      const d = b.v(P2.x, P2.y, P2.z, UP.x, UP.y, UP.z, cu, cv);
      const f = b.v(P3.x, P3.y, P3.z, UP.x, UP.y, UP.z, cu, cv);
      b.quadN(a, c, d, f, UP.x, UP.y, UP.z);
    }
  };
  /** line across the track at s, from lateral l0 to l1, width w (along s) */
  const lineAcross = (s: number, l0: number, l1: number, w: number, dash = 0, gap = 0) => {
    if (dash <= 0) {
      rect(s - w / 2, s + w / 2, l0, l1, white);
      return;
    }
    for (let l = l0; l < l1; l += dash + gap) rect(s - w / 2, s + w / 2, l, Math.min(l1, l + dash), white);
  };

  // ---------------------------------------------------------------- start / finish
  {
    const s = t.startS;
    const hw = t.halfWidthAt(s);
    const ch = atlas.chequer;
    // 2 rows × 16 squares per quad → 4 quads across ≈ 0.23 m squares
    const pieces = 4;
    for (let k = 0; k < pieces; k++) {
      const l0 = -hw + (2 * hw * k) / pieces, l1 = -hw + (2 * hw * (k + 1)) / pieces;
      rect(s - 0.235, s + 0.235, l0, l1, ch);
    }
    lineAcross(s - 0.36, -hw, hw, 0.12);
    lineAcross(s + 0.36, -hw, hw, 0.12);
  }

  // ---------------------------------------------------------------- grid
  const rng = new Rng(2024);
  for (let k = 0; k < 20; k++) {
    const g = t.gridSlot(k);
    const s = g.s;
    const lat = g.lateral;
    const front = s + 2.95; // just ahead of the nose
    const half = 1.2;
    const w = 0.12;
    // bracket: front bar + two legs going back along the car
    rect(front - w, front, lat - half, lat + half, white);
    rect(front - 1.3, front - w, lat - half, lat - half + w, white);
    rect(front - 1.3, front - w, lat + half - w, lat + half, white);
    // position number ahead of the box, text reading toward +s
    const num = atlas.number(k + 1);
    rect(front + 0.35, front + 1.55, lat - 0.62, lat + 0.62, num);
    // launch marks: rear tyres at ±0.8 m, several starts' worth
    for (let rep = 0; rep < 2; rep++) {
      const jit = rng.range(-0.1, 0.1);
      const len = rng.range(3.5, 7);
      const st = s - 1.75 + rng.range(-0.2, 0.2);
      const dark = [0.024, 0.024, 0.026];
      for (const side of [-1, 1]) {
        const cl = lat + side * 0.8 + jit;
        rect(st, st + len, cl - 0.17, cl + 0.17, atlas.streak, dark, true);
      }
    }
  }

  // ---------------------------------------------------------------- DRS
  for (const z of t.drs) {
    const hwD = t.halfWidthAt(z.detect);
    lineAcross(z.detect, -hwD, hwD, 0.15, 0.9, 0.6);
    const hwA = t.halfWidthAt(z.start);
    lineAcross(z.start, -hwA, hwA, 0.2);
  }

  // ---------------------------------------------------------------- pit entry / exit lines on the main road
  // (the lane-side lines beyond the road edge belong to the pit module)
  const pit = t.pit;
  const sd = pit.side;
  const ease = (x: number) => x * x * (3 - 2 * x);
  {
    // entry: a solid line peeling off the road toward the edge where the entry lane leaves
    const s1 = pit.sStart - 70, s0 = s1 - 70;
    const hwE = t.halfWidthAt(s1);
    lineAlong(s0, s1, (s) => sd * (hwE - 1.6 + 1.4 * ease((s - s0) / (s1 - s0))), 0.2);
    // exit: the blend line keeps the car on the right until the lane has merged
    const e0 = pit.sEnd + 60, e1 = pit.sEnd + 170;
    lineAlong(e0, e0 + 40, (s) => sd * (t.halfWidthAt(s) - 0.2 - 1.3 * ease((s - e0) / 40)), 0.2);
    lineAlong(e0 + 40, e1, (s) => sd * (t.halfWidthAt(s) - 1.5), 0.2);
  }

  // ---------------------------------------------------------------- sponsor logos painted on the big tarmac run-offs
  // (read from the TV cameras / aerials: text runs along the track)
  const logoAt = (name: string, _ds: number, k: number) => {
    const c = t.corners.find((x) => x.name === name);
    if (!c) return;
    const side = c.dir;
    const P = ctx.side(side);
    // the widest 16 m of tarmac run-off around the corner
    let s0 = c.sStart, best = -1;
    for (let ds = -20; ds <= 70; ds += 2) {
      let m = Infinity;
      for (let q = 0; q <= 16; q += 2) {
        const j = ctx.wrap(Math.floor(c.sStart + ds + q));
        m = Math.min(m, P.runoff[j] === 2 ? P.bar[j] : 0);
      }
      if (m > best) { best = m; s0 = c.sStart + ds; }
    }
    const i = ctx.wrap(Math.floor(s0));
    const i1 = ctx.wrap(Math.floor(s0 + 16));
    const inner = t.halfWidth[i] + P.kerb[i] + 1.5 + 3.4;
    const room = Math.min(P.bar[i], P.bar[i1]) - inner - 2;
    if (room < 5 || P.runoff[i] !== 2 || P.runoff[i1] !== 2) return;
    const w = Math.min(4.5, room);
    const l0 = side * inner, l1 = side * (inner + w);
    const uv = atlas.logo(k);
    // rot: u runs along s, v across; oriented to read upright for someone on the track looking out at it
    const u = side > 0 ? { u0: uv.u0, u1: uv.u1, v0: uv.v1, v1: uv.v0 } : { u0: uv.u1, u1: uv.u0, v0: uv.v0, v1: uv.v1 };
    rect(s0, s0 + 16, Math.min(l0, l1), Math.max(l0, l1), u, [0.8, 0.8, 0.78], true);
  };
  logoAt('Turn 1', 18, 0);
  logoAt('Roggia', 10, 1);
  logoAt('Turn 10', 8, 0);

  // ---------------------------------------------------------------- timing loops (sealed saw cuts across the road)
  const loops: number[] = [t.startS - 0.9, t.sectorS[0], t.sectorS[1], pit.sStart - 40, pit.sEnd + 40];
  for (let s = 180; s < t.length; s += 370) loops.push(s);
  for (const z of t.drs) loops.push(z.detect + 1.4, z.start + 1.4);
  const dark = [0.02, 0.02, 0.022];
  for (const s of loops) {
    const hwL = t.halfWidthAt(s);
    for (const off of [0, 0.55]) rect(s + off - 0.022, s + off + 0.022, -hwL + 0.25, hwL - 0.25, white, dark);
  }
}

export type { GeoBuilder };
