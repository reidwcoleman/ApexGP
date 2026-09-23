import * as THREE from 'three';
import { GRAVEL_EDGE, SURF, VERGE } from '../Track.ts';
import type { GeoBuilder } from './builder.ts';
import type { Ctx, SidePlan } from './context.ts';
import { Z_KERB, Z_PIT, Z_ROAD, Z_RUNOFF, Z_VERGE } from './materials.ts';

/**
 * Ground ribbons: road, kerbs, painted verge, run-off (tarmac / gravel / grass),
 * grass behind the barriers and a skirt that drops 1.5 m at the outer edge.
 *
 * Every quad spans one metre of centreline (sample i → i+1) and uses the
 * cross-section of sample i, exactly like Track.surfaceAt(), so what you see is
 * what the physics feels. Continuous quantities (barrier distance) are
 * interpolated between the two rows.
 */

const UP = new THREE.Vector3();

// kerb cross-section: fraction of width → height (m)
const KERB_X = [0, 0.05, 0.16, 0.32, 0.84, 0.93, 1.0];
const KERB_H = [0, 0.012, 0.036, 0.05, 0.05, 0.03, 0.0];

const GRASS_Y = -0.03;
const GRAVEL_Y = -0.012;

export function buildSurfaces(ctx: Ctx) {
  const t = ctx.track;
  const n = ctx.n;
  const cs = ctx.cs;

  const setRoadAttr = (b: GeoBuilder, k: number, zone: number, edge: number, paint: number) => {
    const i = ctx.wrap(k);
    b.s0[0] = t.racingLine[i];
    b.s0[1] = ctx.rubber[i];
    b.s0[2] = ctx.skid[i];
    b.s0[3] = ctx.marbles[i];
    b.s1[0] = zone;
    b.s1[1] = edge;
    b.s1[2] = paint;
    b.s1[3] = t.halfWidth[i];
  };

  /** flat band between signed laterals, rows i and i+1 (a0/b0 at row i, a1/b1 at row i+1) */
  const band = (b: GeoBuilder, i: number, a0: number, b0: number, a1: number, b1: number, y: number, attr?: (row: number) => void) => {
    attr?.(i);
    const A = ctx.gv(b, i, a0, y);
    const B = ctx.gv(b, i, b0, y);
    attr?.(i + 1);
    const C = ctx.gv(b, i + 1, b1, y);
    const D = ctx.gv(b, i + 1, a1, y);
    ctx.upOf(i, UP);
    b.quadN(A, B, C, D, UP.x, UP.y, UP.z);
  };

  // ---------------------------------------------------------------- road
  for (let i = 0; i < n; i++) {
    const b = cs.get(i, 'asphalt');
    const hw0 = t.halfWidth[i];
    const hw1 = t.halfWidth[(i + 1) % n];
    band(b, i, -hw0, hw0, -hw1, hw1, 0, (r) => setRoadAttr(b, r, Z_ROAD, 0, 0));
  }

  for (const P of [ctx.L, ctx.R]) {
    const sd = P.side;
    const ramp = kerbRamp(P, n);

    for (let i = 0; i < n; i++) {
      const i1 = i + 1;
      const hw = t.halfWidth[i];
      const kw = P.kerb[i];
      const ab = ctx.wrap(i1);

      // ------------------------------------------------ kerb
      if (kw > 0) {
        const b = cs.get(i, 'asphalt');
        const cols = KERB_X.length;
        const base = b.count;
        for (const [row, rp] of [[i, ramp[i]], [i1, ramp[ab]]] as [number, number][]) {
          setRoadAttr(b, row, Z_KERB, hw + kw, 0);
          const k = ctx.wrap(row);
          for (let c = 0; c < cols; c++) {
            const lat = sd * (hw + KERB_X[c] * kw);
            const h = KERB_H[c] * rp;
            // profile normal in the (outward, up) plane
            const cPrev = Math.max(0, c - 1), cNext = Math.min(cols - 1, c + 1);
            const dx = (KERB_X[cNext] - KERB_X[cPrev]) * kw;
            const dh = (KERB_H[cNext] - KERB_H[cPrev]) * rp;
            const l = Math.hypot(dx, dh) || 1;
            const nu = dx / l, no = -dh / l; // up and outward components
            const nx = t.ux[k] * nu + t.rx[k] * sd * no;
            const ny = t.uy[k] * nu + t.ry[k] * sd * no;
            const nz = t.uz[k] * nu + t.rz[k] * sd * no;
            b.v(
              t.px[k] + t.rx[k] * lat + t.ux[k] * h,
              t.py[k] + t.ry[k] * lat + t.uy[k] * h,
              t.pz[k] + t.rz[k] * lat + t.uz[k] * h,
              nx, ny, nz, lat, row * ctx.vScale,
            );
          }
        }
        ctx.upOf(i, UP);
        for (let c = 0; c < cols - 1; c++) b.quadN(base + c, base + c + 1, base + cols + c + 1, base + cols + c, UP.x, UP.y, UP.z);
      }

      // ------------------------------------------------ verge
      const vIn = hw + kw;
      const vOut = vIn + VERGE;
      const pitZ = P.pitZone[i] === 1;
      {
        const b = cs.get(i, 'asphalt');
        const zone = pitZ ? Z_PIT : Z_VERGE;
        band(b, i, sd * vIn, sd * vOut, sd * vIn, sd * vOut, 0, (r) => {
          setRoadAttr(b, r, zone, vIn, pitZ ? 0 : P.paint[i] && P.runoff[i] === SURF.ASPHALT ? 2 : 1);
          if (pitZ) { b.s0[0] = 99; b.s0[1] = 0; b.s0[2] = 0; b.s0[3] = 0; }
        });
      }

      // ------------------------------------------------ run-off
      const bar0 = Math.max(vOut, P.bar[i]);
      const bar1 = Math.max(vOut, P.bar[ab]);
      const ext0 = Math.max(bar0 + 0.1, P.ext[i]);
      const ext1 = Math.max(bar1 + 0.1, P.ext[ab]);
      const ro = P.runoff[i];
      const inPitLane = P.kind[i] === 'pitwall';
      let grassFrom0 = vOut, grassFrom1 = vOut;
      let grassEdge = 0; // lateral where grass wear starts (|m|), per-quad constant

      if (ro === SURF.ASPHALT || inPitLane) {
        const b = cs.get(i, 'asphalt');
        const zone = pitZ ? Z_PIT : Z_RUNOFF;
        band(b, i, sd * vOut, sd * bar0, sd * vOut, sd * bar1, 0, (r) => {
          setRoadAttr(b, r, zone, vOut, P.paint[i]);
          if (pitZ) { b.s0[0] = 99; b.s0[1] = 0; b.s0[2] = 0; b.s0[3] = 0; }
        });
        grassFrom0 = bar0;
        grassFrom1 = bar1;
        grassEdge = bar0;
      } else if (ro === SURF.GRAVEL) {
        const g0 = P.bar[i] - GRAVEL_EDGE;
        const g1 = P.bar[ab] - GRAVEL_EDGE;
        if (g0 > vOut + 0.3 && g1 > vOut + 0.3) {
          const b = cs.get(i, 'gravel');
          // gravel: vA1.y = distance to its outer edge
          // vA1.x = distance from its inner edge
          const A = ((b.s1[0] = 0), (b.s1[1] = g0 - vOut), ctx.gv(b, i, sd * vOut, GRAVEL_Y));
          const B = ((b.s1[0] = g0 - vOut), (b.s1[1] = 0), ctx.gv(b, i, sd * g0, GRAVEL_Y));
          const C = ((b.s1[0] = g1 - vOut), (b.s1[1] = 0), ctx.gv(b, i1, sd * g1, GRAVEL_Y));
          const D = ((b.s1[0] = 0), (b.s1[1] = g1 - vOut), ctx.gv(b, i1, sd * vOut, GRAVEL_Y));
          ctx.upOf(i, UP);
          b.quadN(A, B, C, D, UP.x, UP.y, UP.z);
          grassFrom0 = Math.max(vOut, g0 - 0.9);
          grassFrom1 = Math.max(vOut, g1 - 0.9);
          grassEdge = grassFrom0;
        } else {
          grassEdge = vOut;
        }
      } else {
        grassEdge = vOut;
      }

      // ------------------------------------------------ grass to the outer reach (+ skirt)
      if (!inPitLane) {
        const b = cs.get(i, 'grass');
        const w0 = grassFrom0 - grassEdge;
        const A = (b.s1[1] = Math.max(0, w0), ctx.gv(b, i, sd * grassFrom0, GRASS_Y));
        const B = (b.s1[1] = ext0 - grassEdge, ctx.gv(b, i, sd * ext0, GRASS_Y));
        const C = (b.s1[1] = ext1 - grassEdge, ctx.gv(b, i1, sd * ext1, GRASS_Y));
        const D = (b.s1[1] = Math.max(0, grassFrom1 - grassEdge), ctx.gv(b, i1, sd * grassFrom1, GRASS_Y));
        ctx.upOf(i, UP);
        b.quadN(A, B, C, D, UP.x, UP.y, UP.z);
        // skirt
        b.s1[1] = 9;
        const E = ctx.gv(b, i, sd * (ext0 + 0.35), GRASS_Y - 1.5);
        const F = ctx.gv(b, i1, sd * (ext1 + 0.35), GRASS_Y - 1.5);
        const k = ctx.wrap(i);
        const onx = t.rx[k] * sd, ony = 0.4, onz = t.rz[k] * sd;
        b.quadN(B, E, F, C, onx, ony, onz);
      }
    }
  }
}

/** 0 at kerb run ends rising to 1 over 1.6 m, per row (row i = start edge of sample i). */
function kerbRamp(P: SidePlan, n: number): Float32Array {
  const out = new Float32Array(n);
  const has = (i: number) => P.kerb[((i % n) + n) % n] > 0;
  const RAMP = 1.6;
  // distance (in rows) to the nearest boundary where kerb presence changes
  const dist = new Float32Array(n).fill(1e9);
  for (let pass = 0; pass < 2; pass++) {
    let last = -1e9;
    for (let s = -n; s < n; s++) {
      const r = pass === 0 ? s : -s;
      const boundary = pass === 0 ? has(r) !== has(r - 1) : has(r) !== has(r - 1);
      if (boundary) last = r;
      const i = ((r % n) + n) % n;
      const d = Math.abs(r - last);
      if (d < dist[i]) dist[i] = d;
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(1, dist[i] / RAMP);
  return out;
}
