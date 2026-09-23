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

  // ---------------------------------------------------------------- pit lines
  const pit = t.pit;
  const sd = pit.side;
  const hw = t.halfWidthAt(pit.sStart);
  const ease = (x: number) => x * x * (3 - 2 * x);
  // entry: from the road edge diverging to the pit wall nose
  const entryLen = 90;
  lineAlong(pit.sStart - entryLen, pit.sStart, (s) => sd * (hw + 0.1 + (pit.wallOffset - 0.25 - hw - 0.1) * ease((s - (pit.sStart - entryLen)) / entryLen)), 0.2);
  // exit: from the pit wall end converging back to the road edge
  const exitLen = 100;
  lineAlong(pit.sEnd, pit.sEnd + exitLen, (s) => sd * (pit.wallOffset - 0.25 - (pit.wallOffset - 0.25 - hw - 0.1) * ease((s - pit.sEnd) / exitLen)), 0.2);
  // lane lines
  const fastEdge = pit.laneInner + (pit.laneOuter - pit.laneInner) * 0.5;
  // (the three long lane lines are drawn analytically by the asphalt shader)
  // speed-limit lines across the lane with PIT / 80
  const limIn = pit.sStart + 28, limOut = pit.sEnd - 28;
  const l0 = sd > 0 ? pit.laneInner : -pit.laneOuter;
  const l1 = sd > 0 ? pit.laneOuter : -pit.laneInner;
  lineAcross(limIn, l0, l1, 0.3);
  lineAcross(limOut, l0, l1, 0.3);
  const laneMid = sd * (pit.laneInner + fastEdge) * 0.5;
  rect(limIn + 2.2, limIn + 4.2, laneMid - 2.0, laneMid + 2.0, atlas.pit);
  rect(limIn + 5.0, limIn + 7.0, laneMid - 1.0, laneMid + 1.0, atlas.eighty);
  rect(limOut - 7.0, limOut - 5.0, laneMid - 1.0, laneMid + 1.0, atlas.eighty);
  // pit box stop marks in the working lane (a white T per team slot)
  const mid = (pit.sStart + pit.sEnd) / 2;
  const work = sd * (fastEdge + (pit.laneOuter - fastEdge) * 0.5);
  for (let k = 0; k < 10; k++) {
    const s = mid + (k - 4.5) * 18;
    rect(s - 0.06, s + 0.06, work - 1.1, work + 1.1, white);
    rect(s - 2.4, s + 2.4, work - 0.05, work + 0.05, white, [0.6, 0.6, 0.58]);
  }
}

export type { GeoBuilder };
