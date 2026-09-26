import * as THREE from 'three';
import { MeshBuilder, srgb } from '../geom.ts';
import type { WorldMap } from '../worldmap.ts';
import { SPIELBERG_SPOTS } from './spielberg.ts';

/**
 * The Red Bull Ring's own landmarks, built from the spots planSpielberg chose:
 *
 *  - the giant steel bull charging down the hillside behind the Niki Lauda Kurve
 *    (lofted, flat-shaded steel plates: one mesh);
 *  - the paddock's glass-and-steel hangar domes behind the pit building;
 *  - Styrian farmsteads on the valley floor (white-rendered house with a dark timber upper
 *    floor and balcony under a big gabled roof, a timber barn beside it): three instanced
 *    variants, one draw call each;
 *  - white village churches with onion-domed towers.
 */

export function buildSpielbergScenery(map: WorldMap): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SpielbergLandmarks';
  const spots = SPIELBERG_SPOTS;
  if (spots.bull) group.add(bull(spots.bull));
  if (spots.hangars.length) group.add(hangars(spots.hangars));
  if (spots.farms.length) for (const m of farms(spots.farms)) group.add(m);
  if (spots.churches.length) group.add(churches(spots.churches));
  if (spots.lots.length) for (const m of lots(spots.lots, map)) group.add(m);
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  return group;
}

/**
 * Styria in early summer: lush green meadows and hay fields (not the parched late-summer straw
 * of the Lombardy defaults), dark spruce forest floor and canopy, dark-brown / red-brown roofs.
 */
export function spielbergTerrainLook(u: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x557a36);
  set('uMeadow', 0x61793a);
  set('uStraw', 0x8a8a4e);
  set('uGrassDark', 0x3a5424);
  set('uLitter', 0x4a3c2a);
  set('uLitterDark', 0x2a241b);
  set('uMoss', 0x415a28);
  set('uCanopy', 0x28391f);
  set('uRoof', 0x6e4432);
}

// ---------------------------------------------------------------------------- the bull

/** loft through sections (x, cy, ry, rz) with `sides` segments round; flat-shaded by the material */
function loft(mb: MeshBuilder, secs: [number, number, number, number][], sides: number, c: THREE.Color, sag = 0) {
  const rings: number[][] = [];
  for (const [x, cy, ry, rz] of secs) {
    const ring: number[] = [];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      // squarer than an ellipse (a bull is boxy), belly sagging
      const ca = Math.cos(a), sa = Math.sin(a);
      const sq = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.78);
      const y = cy + ry * sq(sa) - (sa < 0 ? sag * -sa : 0);
      const z = rz * sq(ca);
      ring.push(mb.vertex(x, y, z, 0, sa, ca, c));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < sides; k++) {
      const a = rings[i][k], b = rings[i][k + 1], d = rings[i + 1][k], e = rings[i + 1][k + 1];
      mb.idx.push(a, d, b, b, d, e);
    }
  // end caps
  for (const [ri, flip] of [[0, true], [rings.length - 1, false]] as const) {
    const [x, cy] = secs[ri];
    const ci = mb.vertex(x, cy, 0, flip ? -1 : 1, 0, 0, c);
    const r = rings[ri];
    for (let k = 0; k < sides; k++) flip ? mb.idx.push(ci, r[k], r[k + 1]) : mb.idx.push(ci, r[k + 1], r[k]);
  }
}

/** catmull-rom resample of sections for a smooth silhouette */
function resample(secs: [number, number, number, number][], per: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const n = secs.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = secs[Math.max(0, i - 1)], p1 = secs[i], p2 = secs[i + 1], p3 = secs[Math.min(n - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const v = [0, 1, 2, 3].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
      out.push(v as [number, number, number, number]);
    }
  }
  out.push(secs[n - 1]);
  return out;
}

function bull(b: { x: number; z: number; y: number; rot: number }): THREE.Object3D {
  const mb = new MeshBuilder();
  const steel = srgb(0x62656a);
  const dark = srgb(0x3e4145);
  // body: tail (−x) to muzzle (+x), head lowered, charging; local x = the way it looks
  const body: [number, number, number, number][] = [
    [-13.6, 12.6, 2.2, 2.2],
    [-12.8, 12.4, 4.4, 4.0],
    [-10.5, 12.3, 5.4, 5.0],
    [-6.5, 12.0, 5.5, 5.2],
    [-2.0, 12.3, 5.9, 5.6],
    [2.0, 13.4, 6.7, 5.9],
    [5.0, 13.6, 6.6, 5.5],
    [7.6, 12.0, 6.0, 4.6],
    [9.8, 10.8, 4.6, 3.8],
    [11.6, 10.2, 3.6, 3.3],
    [13.2, 9.0, 2.9, 2.7],
    [14.4, 8.0, 2.2, 2.2],
    [15.1, 7.5, 1.6, 1.8],
  ];
  loft(mb, resample(body, 3), 14, steel, 0.9);
  // legs: tapered tubes with the knee / hock, hooves at ground level (y = 0)
  const leg = (pts: number[][]) => mb.tube(pts, 9, steel, () => 0, true);
  for (const z of [-2.9, 2.9]) {
    // fore legs, the near one striding forward
    const fw = z > 0 ? 1.8 : -0.6;
    leg([[4.2, 11.0, z, 3.1], [4.6 + fw * 0.5, 6.0, z * 1.04, 1.95], [5.0 + fw, 2.4, z * 1.04, 1.4], [5.1 + fw, 1.0, z * 1.04, 1.45], [5.2 + fw, -0.4, z * 1.04, 1.65]]);
    // hind legs, pushing off
    const bw = z > 0 ? -1.4 : 0.6;
    leg([[-9.6, 11.5, z, 3.5], [-11.4 + bw * 0.3, 6.4, z * 1.04, 2.1], [-10.6 + bw, 2.6, z * 1.04, 1.4], [-10.2 + bw, 1.0, z * 1.04, 1.4], [-10.1 + bw, -0.4, z * 1.04, 1.6]]);
  }
  // horns: out from the poll, sweeping forward and up
  for (const s of [-1, 1]) {
    mb.tube([[11.4, 12.2, s * 2.0, 1.1], [11.5, 12.9, s * 3.9, 0.92], [11.9, 14.3, s * 5.5, 0.7], [13.0, 15.7, s * 6.1, 0.46], [14.6, 16.4, s * 5.6, 0.24], [15.9, 16.3, s * 4.6, 0.05]], 8, srgb(0xb9bab6), () => 0);
    // ears
    mb.tube([[11.3, 11.0, s * 2.6, 0.55], [11.0, 11.4, s * 3.8, 0.4], [10.9, 11.3, s * 4.4, 0.12]], 6, dark, () => 0);
  }
  // tail, swishing, with a tuft
  mb.tube([[-13.4, 13.6, 0, 0.6], [-14.8, 14.8, 0.3, 0.45], [-16.2, 16.4, 0.8, 0.35], [-17.0, 18.2, 1.2, 0.3], [-17.2, 19.2, 1.4, 0.55], [-17.3, 20.2, 1.5, 0.08]], 6, dark, () => 0);
  // nostrils / muzzle plate, eyes
  mb.aabb(15.3, 6.6, -1.0, 15.9, 7.8, 1.0, dark);
  for (const s of [-1, 1]) mb.aabb(12.4, 10.6, s * 2.6 - 0.3, 13.2, 11.2, s * 2.6 + 0.3, srgb(0x2a2b2c));
  // plinth: a low rough stone base on the hillside
  mb.aabb(-17, -3.5, -7, 19, 0.1, 7, srgb(0x77736b));
  const geo = mb.geometry(false);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.5, flatShading: true });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'spielberg_bull';
  m.castShadow = true;
  m.receiveShadow = true;
  // local +x = its gaze; rot is the yaw of that gaze (atan2(x, z) convention)
  m.position.set(b.x, b.y, b.z);
  m.rotation.y = b.rot - Math.PI / 2;
  return m;
}

// ---------------------------------------------------------------------------- hangar domes

function hangars(list: { x: number; z: number; y: number; rot: number; len: number; span: number }[]): THREE.Object3D {
  const glass = new MeshBuilder();
  const steel = new MeshBuilder();
  const solid = new MeshBuilder();
  const W = new THREE.Color(1, 1, 1);
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), R = new THREE.Vector3(), S = new THREE.Vector3();
  for (const h of list) {
    const m = new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, h.y, h.z);
    const half = h.span / 2, H = h.span * 0.42, L2 = h.len / 2;
    const N = 18;
    // the arch cross-section (x across, y up), an ellipse flattened toward the crown
    const arch = (k: number, z: number, out: THREE.Vector3) => {
      const a = Math.PI * (k / N);
      return out.set(-Math.cos(a) * half, 0.6 + Math.pow(Math.sin(a), 0.85) * H, z).applyMatrix4(m);
    };
    const g = new MeshBuilder();
    // glass shell: in 6 m bays, ends tapering (the dome's lens shape: shorter at the base)
    const bays = Math.round(h.len / 6);
    for (let i = 0; i < bays; i++) {
      const z0 = -L2 + (h.len * i) / bays, z1 = -L2 + (h.len * (i + 1)) / bays;
      for (let k = 0; k < N; k++) {
        g.quad4(arch(k, z1, P).clone(), arch(k, z0, Q).clone(), arch(k + 1, z0, R).clone(), arch(k + 1, z1, S).clone(), W);
      }
    }
    glass.append(g);
    // ribs every bay, and the crown and base rails
    const s = new MeshBuilder();
    for (let i = 0; i <= bays; i++) {
      const z = -L2 + (h.len * i) / bays;
      const path: number[][] = [];
      for (let k = 0; k <= N; k++) {
        arch(k, z, P);
        const up = new THREE.Vector3(0, 0, 0);
        void up;
        path.push([P.x, P.y, P.z, 0.32]);
      }
      s.tube(path, 5, srgb(0xe8eaec));
    }
    for (const k of [0, N / 2, N, N / 4, (3 * N) / 4]) {
      arch(k, -L2, P);
      arch(k, L2, Q);
      s.tube([[P.x, P.y, P.z, 0.28], [Q.x, Q.y, Q.z, 0.28]], 5, srgb(0xe8eaec));
    }
    steel.append(s);
    // end walls: glass fans with a mullion grid
    for (const z of [-L2, L2]) {
      const c = new THREE.Vector3(0, 0.6, z).applyMatrix4(m);
      for (let k = 0; k < N; k++) {
        arch(k, z, P);
        arch(k + 1, z, Q);
        const v0 = glass.vertex(c.x, c.y, c.z, 0, 0, 1, W);
        const v1 = glass.vertex(P.x, P.y, P.z, 0, 0, 1, W);
        const v2 = glass.vertex(Q.x, Q.y, Q.z, 0, 0, 1, W);
        glass.idx.push(v0, v1, v2, v0, v2, v1);
      }
    }
    // concrete base ring, a red Red-Bull-ish fascia band at the doors
    const base = new MeshBuilder();
    base.aabb(-half - 1.2, -1.5, -L2 - 1.2, half + 1.2, 0.6, L2 + 1.2, srgb(0xbdb8ae));
    base.aabb(-6, 0.6, L2 - 0.2, 6, 4.2, L2 + 0.4, srgb(0x1e2a4a));
    base.aabb(-6, 4.2, L2 - 0.2, 6, 5.0, L2 + 0.4, srgb(0xdb0a40));
    base.aabb(-6, 0.6, -L2 - 0.4, 6, 4.2, -L2 + 0.2, srgb(0x1e2a4a));
    base.transform(m);
    solid.append(base);
  }
  const grp = new THREE.Group();
  const add = (mb: MeshBuilder, mat: THREE.Material, cast: boolean) => {
    const mesh = new THREE.Mesh(mb.geometry(false), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    grp.add(mesh);
  };
  add(glass, new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.82, side: THREE.DoubleSide }), false);
  add(steel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 }), true);
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), true);
  grp.name = 'spielberg_hangars';
  return grp;
}

// ---------------------------------------------------------------------------- farmsteads

const RENDER = srgb(0xefece4);
const TIMBER = srgb(0x5b3d26);
const TIMBER_OLD = srgb(0x6e5a48);
const STONE = srgb(0x9c968a);
const WINDOW = srgb(0x23272c);
const SHUTTER = srgb(0x6b2c20);

/** gabled roof over x0..x1 (ridge along x), eaves at yE over z ±d, ridge height yR; both slopes + gable ends */
function gable(mb: MeshBuilder, x0: number, x1: number, d: number, yE: number, yR: number, roof: THREE.Color, wall: THREE.Color, over = 1.1) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const e = over;
  // slopes (a little overhang past the walls and gables)
  mb.quad4(V(x1 + e, yE - 0.35, d + e), V(x0 - e, yE - 0.35, d + e), V(x0 - e, yR, 0), V(x1 + e, yR, 0), roof);
  mb.quad4(V(x0 - e, yE - 0.35, -d - e), V(x1 + e, yE - 0.35, -d - e), V(x1 + e, yR, 0), V(x0 - e, yR, 0), roof);
  // undersides (the roof is visible from below on the slopes)
  mb.quad4(V(x0 - e, yE - 0.5, d + e), V(x1 + e, yE - 0.5, d + e), V(x1 + e, yR - 0.15, 0), V(x0 - e, yR - 0.15, 0), roof.clone().multiplyScalar(0.5));
  mb.quad4(V(x1 + e, yE - 0.5, -d - e), V(x0 - e, yE - 0.5, -d - e), V(x0 - e, yR - 0.15, 0), V(x1 + e, yR - 0.15, 0), roof.clone().multiplyScalar(0.5));
  // gable triangles (walls)
  for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
    const a = mb.vertex(x, yE, -d, s, 0, 0, wall);
    const b = mb.vertex(x, yE, d, s, 0, 0, wall);
    const c = mb.vertex(x, yR - 0.1, 0, s, 0, 0, wall);
    if (s > 0) mb.idx.push(a, c, b);
    else mb.idx.push(a, b, c);
  }
}

function farmProto(roof: THREE.Color, variant: number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  // the farmhouse: 16 × 10 m, white render below, dark timber upper floor with a balcony
  const hx = 8, hz = 5;
  mb.aabb(-hx, -1.5, -hz, hx, 3.2, hz, RENDER);
  mb.aabb(-hx, 3.2, -hz, hx, 6.0, hz, variant === 2 ? RENDER : TIMBER);
  gable(mb, -hx, hx, hz, 6.0, 9.6, roof, variant === 2 ? RENDER : TIMBER, 1.3);
  // balcony along the south side, with flower boxes (red geraniums)
  mb.aabb(-hx + 0.6, 3.4, hz, hx - 0.6, 3.6, hz + 1.3, TIMBER);
  mb.aabb(-hx + 0.6, 3.6, hz + 1.15, hx - 0.6, 4.5, hz + 1.3, TIMBER);
  mb.aabb(-hx + 0.8, 4.5, hz + 1.1, hx - 0.8, 4.8, hz + 1.4, srgb(0xc0252a));
  // windows with shutters
  for (const z of [-hz - 0.05, hz + 0.05]) {
    for (const x of [-5.5, -2, 2, 5.5]) {
      mb.aabb(x - 0.55, 1.1, z - 0.06, x + 0.55, 2.3, z + 0.06, WINDOW);
      mb.aabb(x - 1.05, 1.05, z - 0.08, x - 0.6, 2.35, z + 0.08, SHUTTER);
      mb.aabb(x + 0.6, 1.05, z - 0.08, x + 1.05, 2.35, z + 0.08, SHUTTER);
      mb.aabb(x - 0.5, 4.0, z - 0.06, x + 0.5, 5.0, z + 0.06, WINDOW);
    }
  }
  // chimney
  mb.aabb(3, 7.5, -1.8, 3.9, 10.6, -0.9, RENDER);
  // the barn: at right angles, stone plinth, weathered timber, a bigger roof
  const bx0 = 10, bx1 = 34, bz = 6.5;
  const barn = new MeshBuilder();
  barn.aabb(bx0, -1.5, -bz, bx1, 2.4, bz, STONE);
  barn.aabb(bx0, 2.4, -bz, bx1, 6.5, bz, TIMBER_OLD);
  gable(barn, bx0, bx1, bz, 6.5, 11.8, roof.clone().multiplyScalar(0.9), TIMBER_OLD, 1.4);
  // big barn door and a ramp
  barn.aabb(bx0 + 9, 0, bz - 0.1, bx0 + 14, 5.2, bz + 0.12, srgb(0x3e2c1f));
  if (variant === 1) {
    // L: the barn turned along z behind the house
    barn.transform(new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(-10, 0, 12));
  } else barn.transform(new THREE.Matrix4().makeTranslation(-2, 0, -16));
  mb.append(barn);
  // a small wood store / shed
  mb.aabb(-15, -1, 7, -10, 2.6, 11, TIMBER_OLD);
  gable(mb, -15, -10, 2, 2.6, 4.2, roof, TIMBER_OLD, 0.4);
  return mb.geometry(false);
}

function farms(list: { x: number; z: number; y: number; rot: number; size: number }[]): THREE.Object3D[] {
  const roofs = [srgb(0x4a4b4f), srgb(0x7b3a28), srgb(0x5c4535)];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const out: THREE.Object3D[] = [];
  for (let v = 0; v < 3; v++) {
    const mine = list.filter((_, i) => i % 3 === v);
    if (!mine.length) continue;
    const geo = farmProto(roofs[v], v);
    const im = new THREE.InstancedMesh(geo, mat, mine.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    mine.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot);
      s.setScalar(f.size);
      p.set(f.x, f.y, f.z);
      im.setMatrixAt(i, m.compose(p, q, s));
    });
    im.instanceMatrix.needsUpdate = true;
    // far out on the valley floor: no shadow-map cost
    im.castShadow = false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'spielberg_farms_' + v;
    out.push(im);
  }
  return out;
}

// ---------------------------------------------------------------------------- churches

function churches(list: { x: number; z: number; y: number; rot: number }[]): THREE.Object3D {
  const all = new MeshBuilder();
  for (const c of list) {
    const mb = new MeshBuilder();
    // nave (along x), steep dark roof, apse
    mb.aabb(-13, -1.5, -6, 13, 10, 6, RENDER);
    gable(mb, -13, 13, 6, 10, 17, srgb(0x5a3a2c), RENDER, 0.6);
    mb.aabb(13, -1.5, -4, 17, 8.5, 4, RENDER);
    // tall windows
    for (const z of [-6.06, 6.06]) for (const x of [-8, -3, 2, 7]) mb.aabb(x - 0.8, 3, z - 0.05, x + 0.8, 8, z + 0.05, WINDOW);
    // tower at the west end with its onion dome, lantern and cross
    mb.aabb(-19, -1.5, -3.5, -12, 27, 3.5, RENDER);
    mb.aabb(-19.2, 23, -3.7, -11.8, 23.6, 3.7, srgb(0xd9d2c2));
    for (const [x, z] of [[-15.5, -3.56], [-15.5, 3.56], [-19.06, 0], [-11.94, 0]] as const) {
      const dx = Math.abs(z) > 1 ? 0.7 : 0.05, dz = Math.abs(z) > 1 ? 0.05 : 0.7;
      mb.aabb(x - dx, 18.5, z - dz, x + dx, 21.5, z + dz, WINDOW);
      mb.aabb(x - dx * 0.8, 24.8, z - dz * 0.8, x + dx * 0.8, 26.2, z + dz * 0.8, srgb(0xd9b24a));
    }
    // the onion: lathe profile (radius, y)
    const prof: [number, number][] = [[3.6, 27], [4.4, 28.2], [4.6, 29.4], [3.9, 30.8], [2.2, 32.0], [1.0, 32.8], [0.9, 33.6], [1.6, 34.4], [1.4, 35.3], [0.5, 36.2], [0.12, 38.2]];
    const ring: number[][] = [];
    const G = srgb(0x3d4a3f);
    const sides = 12;
    for (const [r, y] of prof) {
      const row: number[] = [];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        row.push(mb.vertex(-15.5 + Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), 0.3, Math.sin(a), G));
      }
      ring.push(row);
    }
    for (let i = 0; i < ring.length - 1; i++)
      for (let k = 0; k < sides; k++) mb.idx.push(ring[i][k], ring[i + 1][k], ring[i][k + 1], ring[i][k + 1], ring[i + 1][k], ring[i + 1][k + 1]);
    mb.aabb(-15.6, 38, -0.08, -15.4, 40.4, 0.08, srgb(0xd9b24a));
    mb.aabb(-15.6, 39.3, -0.7, -15.4, 39.5, 0.7, srgb(0xd9b24a));
    mb.transform(new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, c.y, c.z));
    all.append(mb);
  }
  const geo = all.geometry(false);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, flatShading: true, side: THREE.DoubleSide }));
  m.castShadow = false;
  m.receiveShadow = true;
  m.name = 'spielberg_churches';
  return m;
}

// ---------------------------------------------------------------------------- car parks & campsites

const CAR_COLS = [0xe8e8e6, 0xd9dadb, 0x1c1d20, 0x2b2d31, 0x8c9096, 0xa8acb0, 0x6d7278, 0x1f3a6b, 0x7a1b1b, 0xb42a26, 0x2f4f3a, 0x3a3f58, 0xc9c1a8, 0xf0f0ee, 0x404448];
const TENT_COLS = [0xe8612a, 0x2f6fc2, 0x3f8a3a, 0xd9c23a, 0xc8102e, 0x7c8c96, 0xf07e1e, 0x1f4d8a, 0x5e7d34, 0xeeeeee, 0xff7b00, 0x9b2335];

/** fans' cars in rows on the meadows, tents, caravans and gazebos on the campsites (instanced) */
function lots(list: { x: number; z: number; rot: number; hw: number; hl: number; camp: boolean }[], map: WorldMap): THREE.Object3D[] {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  type I = { x: number; z: number; yaw: number; c: THREE.Color; s: number };
  const cars: I[] = [], tents: I[] = [], vans: I[] = [], gazebos: I[] = [];
  for (const L of list) {
    const ca = Math.cos(L.rot), sa = Math.sin(L.rot);
    const at = (u: number, v: number) => ({ x: L.x + u * ca + v * sa, z: L.z - u * sa + v * ca });
    if (!L.camp) {
      // rows across the lot, nose to nose, an aisle every two rows
      for (let u = -L.hw + 3; u < L.hw - 3; u += 12) {
        for (const du of [0, 5.2]) {
          for (let v = -L.hl + 2; v < L.hl - 2; v += 2.7) {
            if (rnd() < 0.18) continue;
            const p = at(u + du, v + (rnd() - 0.5) * 0.3);
            cars.push({ ...p, yaw: L.rot + Math.PI / 2 + (du ? Math.PI : 0) + (rnd() - 0.5) * 0.12, c: new THREE.Color(CAR_COLS[Math.floor(rnd() * CAR_COLS.length)]), s: 0.92 + rnd() * 0.16 });
          }
        }
      }
    } else {
      // pitches: a tent or two, a car or a caravan, the odd gazebo; loose, organic grid
      for (let u = -L.hw + 5; u < L.hw - 5; u += 9) {
        for (let v = -L.hl + 5; v < L.hl - 5; v += 9) {
          if (rnd() < 0.12) continue;
          const j = at(u + (rnd() - 0.5) * 5, v + (rnd() - 0.5) * 5);
          const yaw = L.rot + (rnd() - 0.5) * 1.2;
          const k = rnd();
          if (k < 0.2) vans.push({ ...j, yaw, c: new THREE.Color(k < 0.1 ? 0xf2f2f0 : 0xdcd8cc), s: 0.9 + rnd() * 0.25 });
          else {
            tents.push({ ...j, yaw, c: new THREE.Color(TENT_COLS[Math.floor(rnd() * TENT_COLS.length)]), s: 0.8 + rnd() * 0.7 });
            if (rnd() < 0.5) tents.push({ x: j.x + 2.6 * Math.cos(yaw), z: j.z - 2.6 * Math.sin(yaw), yaw: yaw + 0.3, c: new THREE.Color(TENT_COLS[Math.floor(rnd() * TENT_COLS.length)]), s: 0.7 + rnd() * 0.5 });
            if (rnd() < 0.45) cars.push({ x: j.x - 3.6 * Math.sin(yaw), z: j.z - 3.6 * Math.cos(yaw), yaw: yaw + Math.PI / 2, c: new THREE.Color(CAR_COLS[Math.floor(rnd() * CAR_COLS.length)]), s: 1 });
          }
          if (rnd() < 0.08) gazebos.push({ x: j.x + 3, z: j.z + 3, yaw, c: new THREE.Color(rnd() < 0.5 ? 0xffffff : TENT_COLS[Math.floor(rnd() * TENT_COLS.length)]), s: 1 });
        }
      }
    }
  }
  const W = new THREE.Color(1, 1, 1);
  // car: body + glasshouse (local x across, z along), ~4.4 × 1.8
  const car = new MeshBuilder();
  car.aabb(-0.9, 0.25, -2.2, 0.9, 0.95, 2.2, W);
  car.aabb(-0.8, 0.95, -1.2, 0.8, 1.45, 0.9, new THREE.Color(0.35, 0.37, 0.4));
  // dome tent: a low four-sided pyramid with a rounded ridge
  const tent = new MeshBuilder();
  {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const a = V(-1.3, 0, -1.3), b = V(1.3, 0, -1.3), c = V(1.3, 0, 1.3), d = V(-1.3, 0, 1.3), t1 = V(0, 1.35, -0.35), t2 = V(0, 1.35, 0.35);
    tent.quad4(d, c, t2, t2, W);
    tent.quad4(b, a, t1, t1, W);
    tent.quad4(a, d, t2, t1, W);
    tent.quad4(c, b, t1, t2, W);
  }
  // caravan / camper van
  const van = new MeshBuilder();
  van.aabb(-1.15, 0.35, -3.2, 1.15, 2.6, 3.2, W);
  van.aabb(-1.17, 1.4, -2.6, 1.17, 1.9, 2.0, new THREE.Color(0.25, 0.27, 0.3));
  // gazebo: four legs and a pyramid roof
  const gz = new MeshBuilder();
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]]) gz.aabb(x - 0.04, 0, z - 0.04, x + 0.04, 2.1, z + 0.04, new THREE.Color(0.8, 0.8, 0.8));
  {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const a = V(-1.5, 2.1, -1.5), b = V(1.5, 2.1, -1.5), c = V(1.5, 2.1, 1.5), d = V(-1.5, 2.1, 1.5), t = V(0, 2.9, 0);
    gz.quad4(d, c, t, t, W);
    gz.quad4(b, a, t, t, W);
    gz.quad4(a, d, t, t, W);
    gz.quad4(c, b, t, t, W);
  }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const out: THREE.Object3D[] = [];
  const inst = (mb: MeshBuilder, items: I[], m: THREE.Material, name: string, shadow: boolean) => {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(mb.geometry(false), m, items.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      p.set(it.x, map.height(it.x, it.z) - 0.05, it.z);
      q.setFromAxisAngle(up, it.yaw);
      sc.setScalar(it.s);
      im.setMatrixAt(i, M.compose(p, q, sc));
      im.setColorAt(i, it.c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.name = name;
    out.push(im);
  };
  inst(car, cars, mat, 'spielberg_parked_cars', false);
  inst(tent, tents, cloth, 'spielberg_tents', false);
  inst(van, vans, mat, 'spielberg_caravans', false);
  inst(gz, gazebos, cloth, 'spielberg_gazebos', false);
  return out;
}
