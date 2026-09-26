import * as THREE from 'three';
import { MeshBuilder, srgb } from '../geom.ts';
import { canvas2d, canvasTexture } from '../textures.ts';
import { rng } from '../noise.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout, GrandstandSpec } from '../layout.ts';
import type { AustinLayout } from './austin.ts';
import { AUSTIN_DOWNTOWN } from './austinLand.ts';

/**
 * The Circuit of the Americas' landmarks, merged into a handful of meshes:
 *
 *   the Observation Tower  77 m: a slender concrete core in a steel stair cage, the round
 *                          glass-floored deck at 70 m under a canopy disc, and the red steel
 *                          "veil" — dozens of tubes cascading from the canopy rim and flaring
 *                          out to the plaza like a tent, longest toward the amphitheatre
 *   the amphitheatre       the stage under its sweeping white canopy, a fan of seats and lawn
 *   the Main Grandstand    a row of white tensile sails on raked masts over the seats
 *   giant flags            the Stars and Stripes and the Lone Star flag on 36 m masts
 *   the Austin skyline     ~12 km to the north-west: the downtown towers and the Capitol dome
 */

export interface AustinSceneryBuild {
  group: THREE.Group;
}

const RED = srgb(0xc62026);
const WHITE = srgb(0xf1f1ee);
const CONCRETE = srgb(0xc9c6bf);
const STEEL = srgb(0xd8dbdf);
const DARK = srgb(0x3a3d42);

class Local {
  readonly m = new THREE.Matrix4();
  constructor(x: number, y: number, z: number, rot: number) {
    this.m.makeRotationY(rot).setPosition(x, y, z);
  }
  p(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.m);
  }
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
function beam(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, c: THREE.Color) {
  _z.subVectors(b, a);
  const L = _z.length();
  if (L < 1e-4) return;
  _z.multiplyScalar(1 / L);
  _x.set(0, 1, 0).cross(_z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x.multiplyScalar(w), _y.multiplyScalar(h), _z.multiplyScalar(L));
  _m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mb.box(_m, c);
}

function localBox(mb: MeshBuilder, L: Local, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) {
  const lm = new MeshBuilder();
  lm.aabb(x0, y0, z0, x1, y1, z1, c);
  lm.transform(L.m);
  mb.append(lm);
}

/** flat disc (both faces) of n segments at local height y */
function disc(mb: MeshBuilder, L: Local, r: number, y: number, n: number, c: THREE.Color, thick = 0.5) {
  const P = (a: number, yy: number, rr = r) => L.p(Math.cos(a) * rr, yy, Math.sin(a) * rr);
  const top = mb.vertex(...L.p(0, y + thick, 0).toArray() as [number, number, number], 0, 1, 0, c);
  const bot = mb.vertex(...L.p(0, y, 0).toArray() as [number, number, number], 0, -1, 0, c);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const t0 = P(a0, y + thick), t1 = P(a1, y + thick), b0 = P(a0, y), b1 = P(a1, y);
    const i0 = mb.vertex(t0.x, t0.y, t0.z, 0, 1, 0, c), i1 = mb.vertex(t1.x, t1.y, t1.z, 0, 1, 0, c);
    mb.idx.push(top, i1, i0);
    const j0 = mb.vertex(b0.x, b0.y, b0.z, 0, -1, 0, c), j1 = mb.vertex(b1.x, b1.y, b1.z, 0, -1, 0, c);
    mb.idx.push(bot, j0, j1);
    mb.quad4(b0, b1, t1, t0, c);
  }
}

export function buildAustinScenery(layout: Layout, track: Track, map: WorldMap): AustinSceneryBuild {
  const group = new THREE.Group();
  group.name = 'AustinLandmarks';
  const sites = (layout as AustinLayout).austin;
  if (!sites) return { group };
  const solid = new MeshBuilder(); // matte: concrete, paint, membranes
  const metal = new MeshBuilder(); // painted steel
  const glass = new MeshBuilder();
  const membrane = new MeshBuilder(); // tensile fabric (translucent white)
  const far = new MeshBuilder(); // skyline (no shadows)
  const r = rng(1836);

  // ---------------------------------------------------------------- the Observation Tower
  {
    const T = sites.tower;
    const y0 = map.height(T.x, T.z) - 0.3;
    // local +z points toward the amphitheatre (the long side of the veil)
    const toAmph = Math.atan2(sites.amph.x - T.x, sites.amph.z - T.z);
    const L = new Local(T.x, y0, T.z, toAmph);
    const H = 77, DECK = 70, CAN = 75.5;
    // plaza paving ring and the entry pavilion
    disc(solid, L, 26, 0, 40, srgb(0xd7d2c6), 0.35);
    localBox(solid, L, -7, 0, -14, 7, 4.2, -6, CONCRETE);
    localBox(glass, L, -6.6, 0.4, -14.05, 6.6, 3.8, -6, WHITE);
    // the core: elevator shaft
    localBox(solid, L, -2.6, 0, -2.6, 2.6, DECK + 1, 2.6, CONCRETE);
    // the stair cage wrapped round it: four corner columns and a band every storey
    const C = 5.2;
    for (const [cx, cz] of [[-C, -C], [C, -C], [C, C], [-C, C]]) localBox(metal, L, cx - 0.3, 0, cz - 0.3, cx + 0.3, DECK, cz + 0.3, STEEL);
    for (let y = 3.2; y < DECK - 1; y += 3.2) {
      localBox(metal, L, -C, y, -C - 0.12, C, y + 0.25, -C + 0.12, STEEL);
      localBox(metal, L, -C, y, C - 0.12, C, y + 0.25, C + 0.12, STEEL);
      localBox(metal, L, -C - 0.12, y, -C, -C + 0.12, y + 0.25, C, STEEL);
      localBox(metal, L, C - 0.12, y, -C, C + 0.12, y + 0.25, C, STEEL);
      // the flights zig-zag up the cage
      const P = new THREE.Vector3(), Q = new THREE.Vector3();
      const k = Math.round(y / 3.2) % 4;
      const side = [[-C, -C, C, -C], [C, -C, C, C], [C, C, -C, C], [-C, C, -C, -C]][k];
      beam(metal, L.p(side[0] * 0.92, y, side[1] * 0.92, P), L.p(side[2] * 0.92, y + 3.2, side[3] * 0.92, Q), 1.1, 0.25, STEEL);
    }
    // the observation deck: round floor, glass balustrade, the canopy disc above
    disc(solid, L, 9.5, DECK, 36, CONCRETE, 1.1);
    {
      const n = 36;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const p0 = L.p(Math.cos(a0) * 9.3, DECK + 1.1, Math.sin(a0) * 9.3), p1 = L.p(Math.cos(a1) * 9.3, DECK + 1.1, Math.sin(a1) * 9.3);
        const q0 = p0.clone(), q1 = p1.clone();
        q0.y += 1.25; q1.y += 1.25;
        glass.quad4(p0, p1, q1, q0, WHITE);
        glass.quad4(p1, p0, q0, q1, WHITE);
      }
      // enclosed centre (the lift lobby) and the columns carrying the canopy
      localBox(glass, L, -4, DECK + 1.1, -4, 4, CAN - 0.6, 4, WHITE);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        localBox(metal, L, Math.cos(a) * 7.5 - 0.2, DECK + 1.1, Math.sin(a) * 7.5 - 0.2, Math.cos(a) * 7.5 + 0.2, CAN, Math.sin(a) * 7.5 + 0.2, STEEL);
      }
    }
    disc(solid, L, 10.6, CAN, 40, WHITE, 0.9);
    disc(metal, L, 3.2, CAN + 0.9, 16, RED, H - CAN - 0.9);
    // the veil: red steel tubes from the canopy rim, cascading down and flaring out like a tent
    {
      const N = 44;
      for (let i = 0; i < N; i++) {
        // leave the back (the entry pavilion) open
        const u = i / (N - 1);
        const a = Math.PI / 2 + (u - 0.5) * Math.PI * 1.15; // centred on +z (the amphitheatre)
        const ca = Math.cos(a), sa = Math.sin(a);
        // the reach grows toward the front: 18 m at the sides, 40 m toward the amphitheatre
        const front = Math.max(0, sa);
        const R1 = 16 + 30 * Math.pow(front, 1.6);
        const r0 = 10.2;
        const path: number[][] = [];
        const M = 22;
        for (let k = 0; k <= M; k++) {
          const t = k / M;
          // steep under the canopy, sweeping out low over the plaza
          const rr = r0 + (R1 - r0) * Math.pow(t, 2.1);
          const yy = CAN + 0.4 - (CAN + 0.4) * (1 - Math.pow(1 - t, 1.35));
          const q = L.p(ca * rr, Math.max(0.2, yy), sa * rr);
          path.push([q.x, q.y, q.z, 0.28]);
        }
        metal.tube(path, 5, RED);
        // anchor block where the tube meets the ground
        const e = path[path.length - 1];
        const lm = new MeshBuilder();
        lm.aabb(e[0] - 0.5, y0 - 0.2, e[2] - 0.5, e[0] + 0.5, y0 + 0.8, e[2] + 0.5, CONCRETE);
        solid.append(lm);
      }
      // two rings binding the veil
      for (const t of [0.35, 0.62]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          const a = Math.PI / 2 + (u - 0.5) * Math.PI * 1.15;
          const front = Math.max(0, Math.sin(a));
          const R1 = 16 + 30 * Math.pow(front, 1.6);
          const rr = 10.2 + (R1 - 10.2) * Math.pow(t, 2.1);
          const yy = (CAN + 0.4) * Math.pow(1 - t, 1.35);
          pts.push(L.p(Math.cos(a) * rr, yy, Math.sin(a) * rr));
        }
        for (let i = 0; i < N - 1; i++) beam(metal, pts[i], pts[i + 1], 0.22, 0.22, RED);
      }
    }
  }

  // ---------------------------------------------------------------- the amphitheatre
  {
    const A = sites.amph;
    const y0 = map.height(A.x, A.z) - 0.2;
    // local +z points from the stage toward the audience (the tower side)
    const L = new Local(A.x, y0, A.z, A.rot);
    const SZ = -30; // stage front edge
    // stage house: platform, back wall, wings
    localBox(solid, L, -22, 0, SZ - 18, 22, 2.2, SZ, srgb(0x3b3a38));
    localBox(solid, L, -20, 0, SZ - 22, 20, 11, SZ - 18, srgb(0x8d8a84));
    for (const sx of [-1, 1]) localBox(solid, L, Math.min(sx * 19, sx * 24), 0, SZ - 22, Math.max(sx * 19, sx * 24), 8, SZ - 4, srgb(0x9c9891));
    // the white canopy: a saddle membrane sweeping up toward the audience, on four masts
    {
      const NX = 16, NZ = 10;
      const X0 = -34, X1 = 34, Z0 = SZ - 22, Z1 = SZ + 20;
      const hAt = (x: number, z: number) => {
        const u = x / 34, v = Math.max(0, (z - Z0) / (Z1 - Z0));
        return 13 + 13 * Math.pow(v, 1.7) + 5 * u * u - 2 * Math.sin(v * Math.PI) * (1 - u * u);
      };
      const verts: number[][] = [];
      const P = new THREE.Vector3();
      for (let j = 0; j <= NZ; j++) {
        const row: number[] = [];
        for (let i = 0; i <= NX; i++) {
          const x = X0 + ((X1 - X0) * i) / NX;
          const z = Z0 + ((Z1 - Z0) * j) / NZ;
          // plan: the front edge bows out in the middle
          const zz = z + (j === NZ ? 6 * (1 - (x / 34) ** 2) : 0);
          L.p(x, hAt(x, zz), zz, P);
          // normal from the surface slope (local), turned into world space
          const e = 0.5;
          const nx = -(hAt(x + e, zz) - hAt(x - e, zz)) / (2 * e), nz = -(hAt(x, zz + e) - hAt(x, zz - e)) / (2 * e);
          const nl = Math.hypot(nx, 1, nz);
          const nw = new THREE.Vector3(nx / nl, 1 / nl, nz / nl).transformDirection(L.m);
          row.push(membrane.vertex(P.x, P.y, P.z, nw.x, nw.y, nw.z, WHITE));
        }
        verts.push(row);
      }
      for (let j = 0; j < NZ; j++)
        for (let i = 0; i < NX; i++) {
          const a = verts[j][i], b = verts[j][i + 1], c = verts[j + 1][i], d = verts[j + 1][i + 1];
          membrane.idx.push(a, c, b, b, c, d);
        }
      // edge cable beams and masts
      for (const [mx, mz] of [[-30, SZ - 20], [30, SZ - 20], [-36, SZ + 14], [36, SZ + 14]]) {
        const top = L.p(mx * 1.05, hAt(Math.max(-34, Math.min(34, mx)), mz) + 6, mz);
        beam(metal, L.p(mx, 0, mz), top, 0.7, 0.7, STEEL);
        beam(metal, top, L.p(mx * 0.9, hAt(mx * 0.9, mz), mz + (mz > SZ ? 6 : 0)), 0.12, 0.12, DARK);
      }
    }
    // the bowl: fixed seats in front, the lawn behind, rising away from the stage
    {
      const A0 = -0.95, A1 = 0.95, NA = 18;
      const rows = 34;
      const rad = (k: number) => 12 + k * 1.35;
      const hgt = (k: number) => 0.2 + k * 0.36;
      const P = (a: number, rr: number, y: number) => L.p(Math.sin(a) * rr, y, SZ + Math.cos(a) * rr);
      for (let k = 0; k < rows; k++) {
        const seat = k < 18;
        const c = seat ? (k % 2 ? srgb(0x2f4f7a) : srgb(0x34588a)) : srgb(0x6d7f3c).multiplyScalar(0.92 + 0.08 * (k % 2));
        for (let i = 0; i < NA; i++) {
          const a0 = A0 + ((A1 - A0) * i) / NA, a1 = A0 + ((A1 - A0) * (i + 1)) / NA;
          const r0 = rad(k), r1 = rad(k + 1), h = hgt(k), hp = k > 0 ? hgt(k - 1) : 0;
          // tread
          solid.quad4(P(a1, r0, h), P(a0, r0, h), P(a0, r1, h), P(a1, r1, h), c);
          // riser
          solid.quad4(P(a0, r0, hp), P(a1, r0, hp), P(a1, r0, h), P(a0, r0, h), seat ? CONCRETE : c);
        }
      }
      // back wall and the fan's side walls
      const hb = hgt(rows - 1);
      for (let i = 0; i < NA; i++) {
        const a0 = A0 + ((A1 - A0) * i) / NA, a1 = A0 + ((A1 - A0) * (i + 1)) / NA;
        solid.quad4(P(a1, rad(rows), 0), P(a0, rad(rows), 0), P(a0, rad(rows), hb), P(a1, rad(rows), hb), CONCRETE);
      }
      for (const [a, s] of [[A0, 1], [A1, -1]] as const)
        for (let k = 0; k < rows; k++) {
          const q0 = P(a, rad(k), 0), q1 = P(a, rad(k + 1), 0), q2 = P(a, rad(k + 1), hgt(k)), q3 = P(a, rad(k), hgt(k));
          if (s > 0) solid.quad4(q1, q0, q3, q2, CONCRETE);
          else solid.quad4(q0, q1, q2, q3, CONCRETE);
        }
    }
  }

  // ---------------------------------------------------------------- the Main Grandstand's white sails
  for (const g of sites.main) mainCanopy(g);
  function mainCanopy(g: GrandstandSpec) {
    // local frame of the stand: x along, −z toward the track (as grandstands.ts builds it)
    const front = g.center.clone().addScaledVector(g.facing, g.depth / 2);
    const zAxis = g.facing.clone().negate();
    const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
    const M = new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), zAxis).setPosition(front.x, g.y0, front.z);
    const lp = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    const rows = g.rows;
    const top = 1.9 + rows * 0.46;
    const depth = rows * 0.86 + 0.8;
    const n = Math.max(2, Math.round(g.length / 13));
    const bay = g.length / n;
    const mastTop = top + 16, back = depth + 1.2;
    const P = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const x = -g.length / 2 + k * bay;
      // raked mast behind the stand, a back-stay and the boom reaching over the seats
      beam(metal, lp(x, -1, back + 4), lp(x, mastTop, back), 0.6, 0.6, WHITE);
      beam(metal, lp(x, mastTop, back), lp(x, 0, back + 16), 0.07, 0.07, STEEL);
      beam(metal, lp(x, top + 7.5, back - 0.5), lp(x, top + 4.5, -5), 0.35, 0.5, WHITE);
      beam(metal, lp(x, mastTop, back), lp(x, top + 4.6, -4.5), 0.06, 0.06, STEEL);
    }
    // one saddle membrane per bay: high at the masts, sagging between them, lifting at the front
    const NU = 8, NV = 8;
    for (let k = 0; k < n; k++) {
      const xa = -g.length / 2 + k * bay;
      const ids: number[][] = [];
      for (let j = 0; j <= NV; j++) {
        const v = j / NV; // 0 back … 1 front
        const row: number[] = [];
        for (let i = 0; i <= NU; i++) {
          const u = i / NU;
          const x = xa + u * bay;
          const z = back - 0.5 + (-5 - (back - 0.5)) * v;
          const edge = 1 - Math.pow(Math.sin(u * Math.PI), 1.2); // 1 at the masts
          const yBack = top + 7.5 - 3 * (1 - edge);
          const yFront = top + 4.6 + 1.2 * edge - 1.6 * (1 - edge);
          const y = yBack + (yFront - yBack) * v - 1.1 * Math.sin(v * Math.PI) * (1 - edge * 0.6);
          P.copy(lp(x, y, z));
          row.push(membrane.vertex(P.x, P.y, P.z, 0, 1, 0, WHITE));
        }
        ids.push(row);
      }
      for (let j = 0; j < NV; j++)
        for (let i = 0; i < NU; i++) {
          const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
          membrane.idx.push(a, c, b, b, c, d);
        }
    }
    void P;
  }

  // ---------------------------------------------------------------- giant flags
  const flagMB = new MeshBuilder();
  for (const m of sites.masts) {
    const y = map.height(m.x, m.z) - 0.2;
    const Hm = 36;
    const lm = new MeshBuilder();
    lm.tube([[m.x, y, m.z, 0.42], [m.x, y + Hm, m.z, 0.2]], 8, WHITE);
    metal.append(lm);
    const ball = new MeshBuilder();
    ball.blob(m.x, y + Hm + 0.4, m.z, 0.5, 0.5, 0.5, 8, 5, srgb(0xd4af37), { lumps: 0, leaf: 0 });
    metal.append(ball);
    // flag plane: along the wind (+x in local), hoisted at the mast
    const W = 15, Hf = 9;
    const rot = r() * 0.4 + 0.6; // prevailing south-easterly
    const ux = Math.cos(rot), uz = -Math.sin(rot);
    const nU = 12, nV = 4;
    const base = flagMB.vertexCount;
    for (let j = 0; j <= nV; j++)
      for (let i = 0; i <= nU; i++) {
        const u = i / nU, v = j / nV;
        const px = m.x + ux * (u * W + 0.5), pz = m.z + uz * (u * W + 0.5), py = y + Hm - 0.6 - Hf + v * Hf;
        // uv: the design half of the texture (US on the left, Texas on the right)
        flagMB.vertex(px, py, pz, -uz, 0, ux, WHITE, u, 0, (m.texas ? 0.5 : 0) + u * 0.5, v);
      }
    for (let j = 0; j < nV; j++)
      for (let i = 0; i < nU; i++) {
        const a = base + j * (nU + 1) + i, b = a + 1, c = a + nU + 1, d = c + 1;
        flagMB.idx.push(a, b, c, b, d, c);
      }
  }

  // ---------------------------------------------------------------- the Austin skyline
  {
    const c = map.A.center;
    const cx = c.x + AUSTIN_DOWNTOWN.dx, cz = c.z + AUSTIN_DOWNTOWN.dz;
    const gy = map.height(cx, cz);
    // the view from the circuit: the city spreads across the line of sight
    const toward = Math.atan2(cx - c.x, cz - c.z);
    const ax = Math.cos(toward), az = -Math.sin(toward); // across the view
    const bx = Math.sin(toward), bz = Math.cos(toward); // away from the circuit
    const glassCols = [0x6f8196, 0x5d6f84, 0x8795a4, 0x4f5f70, 0x9aa6b0, 0x7a8a78].map((h) => srgb(h));
    const stoneCols = [0xb9ad98, 0xc9bfae, 0xa89a86, 0xd8d2c6].map((h) => srgb(h));
    const tower = (u: number, v: number, w: number, d: number, h: number, col: THREE.Color, crown: 'flat' | 'spire' | 'frost' | 'step' | 'jenga' = 'flat') => {
      const x = cx + ax * u + bx * v, z = cz + az * u + bz * v;
      const m = new THREE.Matrix4().makeRotationY(toward + (r() - 0.5) * 0.5);
      const lb = new MeshBuilder();
      if (crown === 'jenga') {
        // The Independent: stacked, shifted boxes
        for (let k = 0; k < 5; k++) lb.aabb(-w / 2 + (k % 2) * 3, (h * k) / 5, -d / 2 - (k % 3) * 2, w / 2 + (k % 2) * 3, (h * (k + 1)) / 5, d / 2 - (k % 3) * 2, col);
      } else lb.aabb(-w / 2, 0, -d / 2, w / 2, h, d / 2, col);
      if (crown === 'step') lb.aabb(-w * 0.35, h, -d * 0.35, w * 0.35, h * 1.08, d * 0.35, col);
      if (crown === 'spire') lb.aabb(-0.8, h, -0.8, 0.8, h * 1.18, 0.8, srgb(0xcfd3d6));
      if (crown === 'frost') {
        // Frost Bank Tower: the faceted pointed crown
        const lm = new MeshBuilder();
        lm.tube([[0, h, 0, w * 0.62], [0, h * 1.12, 0, w * 0.3], [0, h * 1.24, 0, 0.3]], 4, col);
        lb.append(lm);
      }
      lb.transform(m.setPosition(x, gy - 2, z));
      far.append(lb);
    };
    // the landmarks, tallest first (heights a touch generous: they are 12 km away)
    tower(0, 0, 26, 26, 312, glassCols[2], 'spire'); // Waterline
    tower(-160, 60, 30, 30, 270, glassCols[0], 'step'); // Sixth and Guadalupe
    tower(80, -60, 32, 26, 211, glassCols[3], 'jenga'); // The Independent
    tower(-60, -110, 26, 26, 208, glassCols[1], 'step'); // The Austonian
    tower(170, 40, 24, 24, 170, glassCols[4], 'flat'); // 360 Condominiums
    tower(-230, -40, 30, 30, 157, glassCols[5], 'frost'); // Frost Bank Tower
    tower(240, 150, 28, 22, 180, glassCols[0], 'flat');
    tower(-320, 120, 34, 24, 150, stoneCols[0], 'flat');
    // the rest of downtown and the Rainey Street towers
    for (let k = 0; k < 46; k++) {
      const u = (r() - 0.5) * 1300, v = (r() - 0.5) * 700;
      const core = Math.exp(-(u * u) / (2 * 380 * 380));
      const h = 40 + r() * 70 + core * r() * 120;
      tower(u, v, 18 + r() * 22, 16 + r() * 20, h, r() < 0.65 ? glassCols[Math.floor(r() * glassCols.length)] : stoneCols[Math.floor(r() * stoneCols.length)], r() < 0.2 ? 'step' : 'flat');
    }
    // the Texas Capitol on its hill north of downtown: the dome and the long wings
    {
      const x = cx + bx * 900 - ax * 150, z = cz + bz * 900 - az * 150;
      const lb = new MeshBuilder();
      const pink = srgb(0xd9b8a2);
      lb.aabb(-90, 0, -30, 90, 28, 30, pink);
      lb.tube([[0, 28, 0, 22], [0, 52, 0, 21], [0, 58, 0, 19], [0, 70, 0, 14], [0, 78, 0, 7], [0, 84, 0, 2.5], [0, 94, 0, 0.8]], 14, pink, undefined, true);
      lb.transform(new THREE.Matrix4().makeRotationY(toward + Math.PI / 2).setPosition(x, map.height(x, z) - 1, z));
      far.append(lb);
    }
  }

  // ---------------------------------------------------------------- meshes
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.vertexCount === 0) return;
    const m = new THREE.Mesh(mb.geometry(false), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), 'austin_solid', true);
  add(metal, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }), 'austin_steel', true);
  add(membrane, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, emissive: 0x5a5955, side: THREE.DoubleSide }), 'austin_membrane', true);
  add(glass, new THREE.MeshStandardMaterial({ color: 0x24313d, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.72, side: THREE.DoubleSide }), 'austin_glass', false);
  {
    const m = new THREE.Mesh(far.geometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 }));
    m.name = 'austin_skyline';
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (flagMB.vertexCount) {
    const g = flagMB.geometry(true);
    const mat = new THREE.MeshStandardMaterial({ map: flagsTexture(), roughness: 0.8, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWT = weatherUniforms.uWeatherTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWT;\nattribute float aWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  float k = aWind;
  float ph = uWT * 2.4 - k * 5.0 + position.x * 0.01;
  vec3 nrm = normalize( vec3( normal.x, 0.0, normal.z ) );
  transformed += nrm * sin( ph ) * 0.7 * k;
  transformed.y += ( sin( ph * 0.6 ) * 0.25 - 0.6 * k * k ) * k;
}`,
        );
    };
    mat.customProgramCacheKey = () => 'austin-flag-v1';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'austin_flags';
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  void track;
  return { group };
}

/**
 * October in central Texas: sun-cured golden prairie with green where it is watered or
 * shaded, pale caliche soil, the dull dark green of live oak and cedar.
 */
export function austinTerrainLook(u: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x6b7a3a);
  set('uMeadow', 0x8f8a4c);
  set('uStraw', 0xbba466);
  set('uGrassDark', 0x535a30);
  set('uEarth', 0x9c8262);
  set('uLitter', 0x6a5a40);
  set('uLitterDark', 0x3e3426);
  set('uMoss', 0x5d6134);
  set('uCanopy', 0x3e4a2c);
  set('uRoof', 0x5a5650);
}

/** the Stars and Stripes (left half) and the Lone Star flag (right half) */
function flagsTexture(): THREE.CanvasTexture {
  const W = 1024, H = 320;
  const { canvas, ctx } = canvas2d(W, H);
  drawUSFlag(ctx, 0, 0, W / 2, H);
  drawTexasFlag(ctx, W / 2, 0, W / 2, H);
  return canvasTexture(canvas, true, 8);
}

export function drawUSFlag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#b22234';
    ctx.fillRect(x, y + (i * h) / 13, w, h / 13 + 1);
  }
  const cw = w * 0.4, ch = (h * 7) / 13;
  ctx.fillStyle = '#3c3b6e';
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < (r % 2 ? 5 : 6); c++) {
      const sx = x + (cw / 12) * (1 + 2 * c + (r % 2)), sy = y + (ch / 10) * (1 + r);
      star(ctx, sx, sy, Math.min(cw, ch) * 0.035);
    }
}

export function drawTexasFlag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h / 2);
  ctx.fillStyle = '#bf0a30';
  ctx.fillRect(x, y + h / 2, w, h / 2);
  ctx.fillStyle = '#002868';
  ctx.fillRect(x, y, w / 3, h);
  ctx.fillStyle = '#ffffff';
  star(ctx, x + w / 6, y + h / 2, h * 0.19);
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.4 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** fan shirt colours: red, white and blue, Longhorn burnt orange, denim, cowboy-hat tan */
export const AUSTIN_FANS = ['#b22234', '#ffffff', '#3c3b6e', '#bf5700', '#f2f2f2', '#1f3a68', '#c8102e', '#bf5700', '#4a6a8a', '#d2b48c'];

/** crowd/hand flag designs 0–3 for grandstands.ts: US flag, Texas flag, AUSTIN banner, burnt-orange USGP */
export function drawAustinFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number, txt: (x: number, y: number, s: string, size: number, col: string) => void) {
  {
    const [x, y] = at(0);
    drawUSFlag(ctx, x, y + S * 0.12, S, S * 0.76);
    ctx.fillStyle = '#b22234';
    ctx.fillRect(x, y, S, S * 0.12);
    ctx.fillRect(x, y + S * 0.88, S, S * 0.12);
  }
  {
    const [x, y] = at(1);
    drawTexasFlag(ctx, x, y, S, S);
  }
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#0d1b36';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#b22234';
    ctx.fillRect(x, y + S * 0.7, S, S * 0.09);
    ctx.fillStyle = '#ffffff';
    star(ctx, x + S / 2, y + S * 0.22, S * 0.1);
    txt(x + S / 2, y + S * 0.5, 'AUSTIN', 60, '#ffffff');
  }
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#bf5700';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S * 0.7, S, S * 0.06);
    txt(x + S / 2, y + S * 0.44, 'USGP', 76, '#ffffff');
  }
}
