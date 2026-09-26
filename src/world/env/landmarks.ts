import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import type { Layout, Landmark } from './layout.ts';
import type { Track } from '../Track.ts';
import type { WorldMap } from './worldmap.ts';
import { sponsorTexture, sponsorUV } from './signage.ts';
import { rng } from './noise.ts';

/**
 * Venue landmarks that make a circuit recognisable from the TV and helicopter
 * cameras: Suzuka's Ferris wheel and roller coaster on the hill behind the main
 * straight, the circuit hotel, the figure-of-eight crossover bridge with its
 * walled underpass, glass hospitality pavilions behind the stands and scaffold
 * TV camera towers at the big corners (every circuit).
 *
 * Everything is merged into four meshes (concrete/paint, steel, glass, printed
 * boards): a handful of draw calls for the whole set.
 */

export interface LandmarksBuild {
  group: THREE.Group;
  count: number;
}

const CONCRETE = srgb(0xc2beb5);
const CONCRETE_DARK = srgb(0x8f8b84);
const WHITE = srgb(0xeeeeea);
const STEEL = srgb(0xdfe2e6);
const STEEL_DARK = srgb(0x4d5157);

const B = new THREE.Vector3();
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** square-section beam from a to b (w × h cross-section; `h` along the world-up-ish side) */
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

/** local frame: origin (x, y, z), yaw `rot` (local +z → (sin rot, 0, cos rot)) */
class Local {
  readonly m = new THREE.Matrix4();
  constructor(x: number, y: number, z: number, rot: number) {
    this.m.makeRotationY(rot).setPosition(x, y, z);
  }
  p(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.m);
  }
}

export function buildLandmarks(layout: Layout, track: Track, map: WorldMap): LandmarksBuild {
  const solid = new MeshBuilder();
  const steel = new MeshBuilder();
  const glass = new MeshBuilder();
  const boards = new MeshBuilder();
  const r = rng(8088);
  let count = 0;
  let sponsorK = 5;

  const box = (mb: MeshBuilder, L: Local, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) => {
    const lm = new MeshBuilder();
    lm.aabb(x0, y0, z0, x1, y1, z1, c);
    lm.transform(L.m);
    mb.append(lm);
  };
  /** printed board on the local plane z = zc, facing −z (dir −1) or +z (dir 1) */
  const board = (L: Local, x0: number, x1: number, y0: number, y1: number, zc: number, dir: 1 | -1) => {
    const uv = sponsorUV(sponsorK++);
    const a = dir < 0 ? x1 : x0, b = dir < 0 ? x0 : x1;
    boards.quad4(L.p(a, y0, zc), L.p(b, y0, zc), L.p(b, y1, zc), L.p(a, y1, zc), new THREE.Color(1, 1, 1), uv);
  };

  for (const lm of layout.landmarks ?? []) {
    count++;
    if (lm.kind === 'ferris') ferrisWheel(lm);
    else if (lm.kind === 'coaster') coaster(lm);
    else if (lm.kind === 'hotel') hotel(lm);
    else if (lm.kind === 'hospitality') hospitality(lm);
    else if (lm.kind === 'cameraTower') cameraTower(lm);
  }
  for (const c of track.crossings) {
    crossover(c.lower, c.upper);
    count++;
  }

  // ---------------------------------------------------------------- Ferris wheel
  function ferrisWheel(lm: Landmark) {
    // the wheel's plane faces the straight: its axle runs along local z (toward the track)
    const L = new Local(lm.x, lm.y, lm.z, lm.rot + Math.PI / 2);
    const R = lm.size, hub = R + 4.5, half = 2.6;
    const N = 48, SP = 24, CARS = 32;
    const rim = srgb(0xf4f4f2), spoke = srgb(0xd9dde2);
    const ring = (i: number, rr: number, z: number, out: THREE.Vector3) => {
      const a = (i / N) * Math.PI * 2;
      return L.p(Math.cos(a) * rr, hub + Math.sin(a) * rr, z, out);
    };
    const P = new THREE.Vector3(), Q = new THREE.Vector3();
    for (const z of [-half, half]) {
      for (let i = 0; i < N; i++) {
        beam(steel, ring(i, R, z, P), ring(i + 1, R, z, Q), 0.55, 0.55, rim);
        beam(steel, ring(i, R - 1.6, z, P), ring(i + 1, R - 1.6, z, Q), 0.3, 0.3, rim);
        if (i % 2 === 0) beam(steel, ring(i, R, z, P), ring(i + 1, R - 1.6, z, Q), 0.18, 0.18, rim);
      }
      for (let k = 0; k < SP; k++) {
        const i = (k * N) / SP;
        beam(steel, L.p(0, hub, z * 0.4, P), ring(i, R - 1.6, z, Q), 0.22, 0.22, spoke);
      }
    }
    for (let i = 0; i < N; i += 2) beam(steel, ring(i, R, -half, P), ring(i, R, half, Q), 0.2, 0.2, rim);
    // hub and axle
    beam(steel, L.p(0, hub, -half - 1.2), L.p(0, hub, half + 1.2), 1.8, 1.8, STEEL_DARK);
    // A-frame legs, both sides
    for (const z of [-half - 1.6, half + 1.6]) {
      for (const x of [-R * 0.55, R * 0.55]) beam(steel, L.p(x, 0, z * 1.9), L.p(0, hub, z), 1.1, 1.1, spoke);
      beam(steel, L.p(-R * 0.3, hub * 0.45, z * 1.45), L.p(R * 0.3, hub * 0.45, z * 1.45), 0.5, 0.5, spoke);
    }
    // gondolas: hanging below rim points, bright colours
    const cols = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xffffff, 0xec407a, 0xfb8c00, 0x8e24aa].map(srgb);
    for (let k = 0; k < CARS; k++) {
      const a = (k / CARS) * Math.PI * 2;
      const cx = Math.cos(a) * (R + 0.2), cy = hub + Math.sin(a) * (R + 0.2);
      box(solid, L, cx - 1.1, cy - 3.3, -1.1, cx + 1.1, cy - 1.2, 1.1, cols[k % cols.length]);
      box(glass, L, cx - 1.12, cy - 2.7, -1.12, cx + 1.12, cy - 1.7, 1.12, WHITE);
      box(steel, L, cx - 0.08, cy - 1.2, -0.08, cx + 0.08, cy, 0.08, STEEL_DARK);
    }
    // boarding station
    box(solid, L, -9, 0, -7, 9, 3.6, 7, WHITE);
    box(solid, L, -10, 3.6, -8, 10, 4.1, 8, srgb(0xd23b3b));
  }

  // ---------------------------------------------------------------- roller coaster
  function coaster(lm: Landmark) {
    const L = new Local(lm.x, lm.y, lm.z, lm.rot);
    const a = lm.size, b = lm.size * 0.36;
    const N = 180;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const x = Math.cos(t) * a + Math.sin(t * 3) * 6;
      const z = Math.sin(t) * b + Math.sin(t * 2 + 0.6) * 5;
      const h = 3 + 16 * Math.pow(Math.max(0, Math.sin(t * 2 + 0.3)), 1.6) + 6 * Math.max(0, Math.sin(t * 5)) ;
      pts.push(L.p(x, h, z));
    }
    const railC = srgb(0xe53935), postC = srgb(0xf2f2f2);
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[(i + 1) % N];
      beam(steel, p, q, 1.4, 0.35, railC);
      if (i % 3 === 0) {
        B.set(p.x, map.height(p.x, p.z) - 0.2, p.z);
        beam(steel, B, p, 0.28, 0.28, postC);
      }
    }
    // station and a few ride buildings, bright roofs
    const roofs = [0x1e88e5, 0xfdd835, 0x43a047, 0xec407a].map(srgb);
    for (let k = 0; k < 5; k++) {
      const x = -a * 0.8 + k * a * 0.4 + (r() - 0.5) * 8, z = (r() - 0.5) * b * 0.8;
      const w = 8 + r() * 10, d = 6 + r() * 8, h = 4 + r() * 5;
      box(solid, L, x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, WHITE);
      box(solid, L, x - w / 2 - 0.6, h, z - d / 2 - 0.6, x + w / 2 + 0.6, h + 0.5, z + d / 2 + 0.6, roofs[k % roofs.length]);
    }
  }

  // ---------------------------------------------------------------- hotel
  function hotel(lm: Landmark) {
    const L = new Local(lm.x, lm.y, lm.z, lm.rot);
    const W = lm.size, D = 16, floors = 5, FH = 3.4;
    box(solid, L, -W / 2, -1, -D / 2, W / 2, floors * FH + 0.6, D / 2, WHITE);
    for (let f = 0; f < floors; f++) {
      const y = 1.2 + f * FH;
      for (const z of [-D / 2 - 0.05, D / 2 + 0.05]) box(glass, L, -W / 2 + 1, y, z - 0.02, W / 2 - 1, y + 1.8, z + 0.02, WHITE);
      box(solid, L, -W / 2 - 0.4, y + 2.2, -D / 2 - 1.2, W / 2 + 0.4, y + 2.4, D / 2 + 1.2, WHITE);
    }
    box(solid, L, -W / 2 - 1, floors * FH + 0.6, -D / 2 - 1, W / 2 + 1, floors * FH + 1.1, D / 2 + 1, srgb(0x5a6068));
  }

  // ---------------------------------------------------------------- hospitality pavilion
  function hospitality(lm: Landmark) {
    const L = new Local(lm.x, lm.y, lm.z, lm.rot);
    const W = lm.size, D = 16;
    box(solid, L, -W / 2, -0.8, -D / 2, W / 2, 0.4, D / 2, CONCRETE);
    box(glass, L, -W / 2 + 0.6, 0.4, -D / 2 + 0.6, W / 2 - 0.6, 7.6, D / 2 - 0.6, WHITE);
    box(solid, L, -W / 2 - 0.2, 3.9, -D / 2 - 0.2, W / 2 + 0.2, 4.3, D / 2 + 0.2, WHITE);
    box(solid, L, -W / 2 - 1.8, 7.6, -D / 2 - 1.8, W / 2 + 1.8, 8.3, D / 2 + 1.8, WHITE);
    for (let x = -W / 2 + 0.5; x <= W / 2 - 0.5; x += 5.5) for (const z of [-D / 2 + 0.5, D / 2 - 0.5]) box(steel, L, x - 0.12, 0.4, z - 0.12, x + 0.12, 7.6, z + 0.12, STEEL);
    // fascia boards both long sides
    const n = Math.max(1, Math.round(W / 14));
    for (let k = 0; k < n; k++) {
      const xa = -W / 2 - 1.6 + ((W + 3.2) * k) / n, xb = xa + (W + 3.2) / n;
      board(L, xa + 0.1, xb - 0.1, 7.55, 8.35, -D / 2 - 1.85, -1);
      board(L, xa + 0.1, xb - 0.1, 7.55, 8.35, D / 2 + 1.85, 1);
    }
  }

  // ---------------------------------------------------------------- TV camera tower
  function cameraTower(lm: Landmark) {
    const y = map.height(lm.x, lm.z);
    const L = new Local(lm.x, y, lm.z, lm.rot);
    const H = lm.size, w = 1.1;
    for (const x of [-w, w]) for (const z of [-w, w]) box(steel, L, x - 0.05, -0.5, z - 0.05, x + 0.05, H + 1.1, z + 0.05, STEEL);
    for (let hh = 1; hh < H; hh += 1.4) {
      box(steel, L, -w, hh, -w - 0.03, w, hh + 0.06, -w + 0.03, STEEL);
      box(steel, L, -w, hh, w - 0.03, w, hh + 0.06, w + 0.03, STEEL);
      box(steel, L, -w - 0.03, hh, -w, -w + 0.03, hh + 0.06, w, STEEL);
      box(steel, L, w - 0.03, hh, -w, w + 0.03, hh + 0.06, w, STEEL);
    }
    box(solid, L, -w - 0.3, H, -w - 0.3, w + 0.3, H + 0.12, w + 0.3, srgb(0x6b5a44));
    // camera (facing local +z, toward the corner) and operator
    box(solid, L, -0.3, H + 1.25, 0.2, 0.3, H + 1.6, 0.9, srgb(0x1b1c1e));
    box(solid, L, -0.08, H + 0.12, 0.4, 0.08, H + 1.25, 0.56, srgb(0x1b1c1e));
    box(solid, L, -0.25, H + 0.12, -0.6, 0.25, H + 1.2, -0.2, srgb(0x20252c));
    box(solid, L, -0.14, H + 1.2, -0.52, 0.14, H + 1.48, -0.26, srgb(0xc58d6b));
    // umbrella / sun cover
    box(solid, L, -1.5, H + 2.5, -1.5, 1.5, H + 2.56, 1.5, srgb(0x1d4f9c));
    box(steel, L, -0.03, H + 1.2, -1.2, 0.03, H + 2.5, -1.14, STEEL_DARK);
  }

  // ---------------------------------------------------------------- figure-of-eight crossover
  function crossover(lower: number, upper: number) {
    const P = new THREE.Vector3();
    const upperPlaneAt = (x: number, z: number) => {
      const u = map.sectionAt(x, z, upper);
      return { y: u.plane, inside: Math.abs(u.lat) < u.bar + 1.4 };
    };
    // retaining walls lining the lower road's cut (they carry the bridge where it crosses)
    for (const side of [-1, 1]) {
      let prev: { a: THREE.Vector3; b: THREE.Vector3; top: number; y0: number } | null = null;
      let wasOn = false;
      // stations every 2 m: ground behind the wall (max over the block's depth), smoothed along
      const st: { a: THREE.Vector3; b: THREE.Vector3; ground: number; cap: number; road: number }[] = [];
      for (let d = -70; d <= 70; d += 2) {
        const s = lower + d;
        const bar = track.barrierAt(s, side);
        const a = track.point(s, side * (bar + 0.35), 0, new THREE.Vector3());
        const b = track.point(s, side * (bar + 6.2), 0, new THREE.Vector3());
        let ground = -Infinity;
        for (const off of [0.6, 2, 4, 6, 7, 8.5, 10]) {
          track.point(s, side * (bar + off), 0, P);
          ground = Math.max(ground, map.height(P.x, P.z));
        }
        let cap = Infinity;
        for (const q of [a, b, P.addVectors(a, b).multiplyScalar(0.5)]) {
          const up = upperPlaneAt(q.x, q.z);
          if (up.inside) cap = Math.min(cap, up.y - 1.75);
        }
        st.push({ a, b, ground, cap, road: a.y });
      }
      const g2 = st.map((_, i) => Math.max(...st.slice(Math.max(0, i - 2), i + 3).map((q) => q.ground)));
      for (let i = 0; i < st.length; i++) {
        const { a, b, road } = st[i];
        let sum = 0, n = 0;
        for (let k = Math.max(0, i - 2); k <= Math.min(st.length - 1, i + 2); k++) { sum += g2[k]; n++; }
        const top = Math.min(sum / n + 0.45, st[i].cap);
        const cur = { a, b, top, y0: road - 0.8 };
        const cap = (st: { a: THREE.Vector3; b: THREE.Vector3; top: number; y0: number }) =>
          solid.quad4(new THREE.Vector3(st.a.x, st.y0, st.a.z), new THREE.Vector3(st.b.x, st.y0, st.b.z), new THREE.Vector3(st.b.x, st.top, st.b.z), new THREE.Vector3(st.a.x, st.top, st.a.z), CONCRETE);
        const on = !!prev && (prev.top - road > 0.7 || top - road > 0.7);
        if (on && !wasOn) cap(prev!);
        if (!on && wasOn && prev) cap(prev);
        wasOn = on;
        if (prev && on) {
          // one wall panel between the two stations (front face toward the road, top, back)
          const c = CONCRETE;
          const p0 = prev.a, p1 = cur.a, q0 = prev.b, q1 = cur.b;
          const face = (u0: THREE.Vector3, u1: THREE.Vector3, t0: number, t1: number, flip: boolean) => {
            const v0 = new THREE.Vector3(u0.x, prev!.y0, u0.z), v1 = new THREE.Vector3(u1.x, cur.y0, u1.z);
            const w1 = new THREE.Vector3(u1.x, t1, u1.z), w0 = new THREE.Vector3(u0.x, t0, u0.z);
            if (flip) solid.quad4(v1, v0, w0, w1, c);
            else solid.quad4(v0, v1, w1, w0, c);
          };
          // orientation: front faces the road (−side), so wind the quad accordingly
          face(p0, p1, prev.top, cur.top, side > 0);
          face(q0, q1, prev.top, cur.top, side < 0);
          solid.quad4(
            new THREE.Vector3(p0.x, prev.top, p0.z),
            new THREE.Vector3(p1.x, cur.top, p1.z),
            new THREE.Vector3(q1.x, cur.top, q1.z),
            new THREE.Vector3(q0.x, prev.top, q0.z),
            CONCRETE_DARK,
          );
        }
        prev = cur;
      }
    }

    // the bridge: a concrete deck under the upper road, parapet fascias with sponsor boards
    const span = 34;
    const deckC = srgb(0xb9b5ac);
    for (let d = -span; d < span; d += 1) {
      const s0 = upper + d, s1 = s0 + 1;
      for (const side of [-1, 1]) {
        const w0 = track.barrierAt(s0, side) + 0.9, w1 = track.barrierAt(s1, side) + 0.9;
        // underside (faces down) and outer fascia (faces out)
        const i0 = track.point(s0, 0, -1.8, new THREE.Vector3()), i1 = track.point(s1, 0, -1.8, new THREE.Vector3());
        const o0 = track.point(s0, side * w0, -1.8, new THREE.Vector3()), o1 = track.point(s1, side * w1, -1.8, new THREE.Vector3());
        if (side > 0) solid.quad4(i1, i0, o0, o1, deckC);
        else solid.quad4(i0, i1, o1, o0, deckC);
        const t0 = track.point(s0, side * w0, 1.05, new THREE.Vector3()), t1 = track.point(s1, side * w1, 1.05, new THREE.Vector3());
        if (side > 0) solid.quad4(o0, o1, t1, t0, deckC);
        else solid.quad4(o1, o0, t0, t1, deckC);
        // inner face of the parapet (above the road-side barrier) and its cap
        const ii0 = track.point(s0, side * (w0 - 0.5), 1.05, new THREE.Vector3()), ii1 = track.point(s1, side * (w1 - 0.5), 1.05, new THREE.Vector3());
        solid.quad4(side > 0 ? t0 : t1, side > 0 ? t1 : t0, side > 0 ? ii1 : ii0, side > 0 ? ii0 : ii1, CONCRETE_DARK);
      }
    }
    // printed boards on both fascias, over the lower road
    for (const side of [-1, 1]) {
      for (let d = -12; d < 12; d += 6) {
        const s0 = upper + d, s1 = s0 + 5.6;
        const w0 = track.barrierAt(s0, side) + 0.95, w1 = track.barrierAt(s1, side) + 0.95;
        const a0 = track.point(s0, side * w0, -1.6, new THREE.Vector3()), a1 = track.point(s1, side * w1, -1.6, new THREE.Vector3());
        const b0 = track.point(s0, side * w0, 0.2, new THREE.Vector3()), b1 = track.point(s1, side * w1, 0.2, new THREE.Vector3());
        const uv = sponsorUV(sponsorK++);
        if (side > 0) boards.quad4(a0, a1, b1, b0, new THREE.Color(1, 1, 1), uv);
        else boards.quad4(a1, a0, b0, b1, new THREE.Color(1, 1, 1), uv);
      }
    }
  }

  // ---------------------------------------------------------------- meshes
  const group = new THREE.Group();
  group.name = 'Landmarks';
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.vertexCount === 0) return;
    const m = new THREE.Mesh(mb.geometry(false), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }), 'landmarks_solid', true);
  add(steel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 }), 'landmarks_steel', true);
  add(glass, new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.08, metalness: 0.85 }), 'landmarks_glass', false);
  const tex = sponsorTexture();
  add(boards, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.14, side: THREE.DoubleSide }), 'landmarks_boards', false);
  return { group, count };
}
