import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Layout, Landmark } from '../layout.ts';
import type { WorldMap } from '../worldmap.ts';
import { rng } from '../noise.ts';
import { Plain } from './monzaScenery.ts';

/**
 * Silverstone on a Grand Prix weekend, beyond the circuit (planSilverstone places it all):
 *
 *   car parks         the big grass car parks out on the airfield, row on row of cars nose to nose
 *   campsites         tents of every colour, gazebos and motorhomes on the fields by the corners
 *   T2 hangars        the wartime hangars beside the Hangar Straight (the straight's name): long
 *                     steel sheds under a shallow gable, the frame's stanchions down the sides, the
 *                     sliding doors across each end
 *   control tower     the airfield's old two-storey watch office, its glazed control room on the roof
 *
 * Cars, tents and motorhomes are instanced (one draw call each); hangars and the tower are one
 * vertex-colour mesh. Nothing casts a shadow.
 */

const C = (h: number) => new THREE.Color(h);

const PAINT = [0xf2f2f0, 0xe9e9e6, 0x1c1d1f, 0x2a2b2e, 0x9a9da1, 0xb7babd, 0x6c7075, 0x1f2f4f, 0x7a1d1d, 0x2e5a8c, 0x404a3c, 0xc8c2b2].map(C);
const TENT = [0x3f6b3a, 0x2c5a8c, 0xd06a2a, 0x8a8f94, 0xa8322a, 0xd8b13a, 0x26304a, 0x5a7a3a, 0x7a8a96].map(C);

/** a hatchback-ish car, 4.3 m: the body (white, tinted per instance) and the dark glasshouse */
function carGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, k: number) => {
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(k), 3));
    return g;
  };
  const body = new THREE.BoxGeometry(1.8, 0.72, 4.3).translate(0, 0.58, 0);
  // (the glasshouse dark, its roof painted: from the air a car park is a mosaic of paint)
  const cabin = new THREE.BoxGeometry(1.6, 0.42, 2.3).translate(0, 1.15, -0.25);
  const roof = new THREE.BoxGeometry(1.5, 0.08, 2.0).translate(0, 1.4, -0.3);
  const wheels = new THREE.BoxGeometry(1.86, 0.5, 3.1).translate(0, 0.25, 0);
  const g = mergeGeometries([paint(body.toNonIndexed(), 1), paint(cabin.toNonIndexed(), 0.12), paint(roof.toNonIndexed(), 1), paint(wheels.toNonIndexed(), 0.06)]);
  g.computeVertexNormals();
  return g;
}

/** a ridge tent: a triangular prism 2.6 m long, 2.2 m across, 1.3 m high, the ridge along z */
function tentGeometry(): THREE.BufferGeometry {
  const P = [
    [-1.1, 0, -1.3], [1.1, 0, -1.3], [0, 1.3, -1.3],
    [1.1, 0, 1.3], [-1.1, 0, 1.3], [0, 1.3, 1.3],
  ];
  const tri = (a: number, b: number, c: number) => [P[a], P[b], P[c]];
  const faces = [tri(0, 2, 1), tri(3, 5, 4), [P[1], P[2], P[5]], [P[1], P[5], P[3]], [P[4], P[5], P[2]], [P[4], P[2], P[0]]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

export function buildSilverstoneScenery(layout: Layout, map: WorldMap): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SilverstoneScenery';
  const r = rng(1948);
  const ground = (x: number, z: number) => map.height(x, z);
  type Inst = { x: number; z: number; y: number; rot: number; c: THREE.Color; s?: THREE.Vector3 };
  const cars: Inst[] = [], tents: Inst[] = [], vans: Inst[] = [];
  /** room for a parked thing here: off the circuit, the stands, the paths' pads and steep ground */
  const free = (x: number, z: number, m: number) => map.trackClearance(x, z) > 18 && !map.excluded(x, z, m) && !map.inPitZone(x, z, 20);
  const lms: Landmark[] = layout.landmarks ?? [];

  for (const lm of lms) {
    if (lm.kind === 'carpark') {
      // pairs of rows nose to nose (5 m), an aisle (7 m) between pairs, a car every 2.7 m
      const ca = Math.cos(lm.rot), sa = Math.sin(lm.rot);
      const R = lm.size * 0.85;
      for (let v = -R; v <= R; v += 17) {
        for (const off of [0, 5]) {
          for (let u = -R; u <= R; u += 2.7) {
            const lu = u, lv = v + off;
            if (lu * lu + lv * lv > R * R) continue;
            // (gaps: the car park is a little over two-thirds full, emptier at its edges)
            if (r() > 0.78 - 0.25 * Math.hypot(lu, lv) / R) continue;
            const x = lm.x + lu * ca + lv * sa, z = lm.z - lu * sa + lv * ca;
            if (!free(x, z, 2)) continue;
            cars.push({ x, z, y: ground(x, z), rot: lm.rot + (off ? Math.PI : 0) + (r() - 0.5) * 0.12, c: PAINT[Math.floor(r() * PAINT.length)] });
          }
        }
      }
    } else if (lm.kind === 'campsite') {
      // pitches in loose clusters, a car beside most, the odd motorhome; lanes kept open
      const R = lm.size * 0.85;
      for (let i = 0; i < lm.size * 7; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
        const x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
        if (Math.abs(((x - lm.x) * Math.cos(lm.rot) - (z - lm.z) * Math.sin(lm.rot)) % 40) < 4) continue;
        if (!free(x, z, 3)) continue;
        const rot = lm.rot + (r() - 0.5) * 0.9;
        const y = ground(x, z);
        const roll = r();
        if (roll < 0.035) vans.push({ x, z, y, rot, c: C([0xf1efe8, 0xe6e2d6, 0xd9d6cc][Math.floor(r() * 3)]) });
        else {
          const big = r();
          tents.push({ x, z, y, rot, c: TENT[Math.floor(r() * TENT.length)], s: new THREE.Vector3(big > 0.8 ? 1.6 : 1, big > 0.8 ? 1.3 : 1, big > 0.8 ? 1.7 : 1) });
          if (roll < 0.6) {
            const cx = x + Math.cos(rot) * 3.6, cz = z - Math.sin(rot) * 3.6;
            if (free(cx, cz, 2)) cars.push({ x: cx, z: cz, y: ground(cx, cz), rot: rot + (r() - 0.5) * 0.4, c: PAINT[Math.floor(r() * PAINT.length)] });
          }
        }
      }
    }
  }

  const up = new THREE.Vector3(0, 1, 0);
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], name: string, scale = new THREE.Vector3(1, 1, 1)) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3();
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot);
      p.set(it.x, it.y - 0.05, it.z);
      m.compose(p, q, it.s ?? scale);
      im.setMatrixAt(i, m);
      im.setColorAt(i, it.c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = false;
    im.receiveShadow = true;
    im.name = name;
    group.add(im);
  };
  instanced(carGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 }), cars, 'silverstone_parked_cars');
  instanced(tentGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide }), tents, 'silverstone_tents');
  instanced(new THREE.BoxGeometry(2.3, 2.8, 6.0).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 }), vans, 'silverstone_motorhomes');

  // ---------------------------------------------------------------- the airfield buildings
  const plain = new Plain();
  const CLAD = C(0x8a8f84), CLAD2 = C(0x7b8075), ROOF = C(0x8d908a), DOOR = C(0x676b62), RUST = C(0x7d6a55), WHITE = C(0xe2e0d8), GLASS = C(0x1d252b);
  for (const lm of lms) {
    const ca = Math.cos(lm.rot), sa = Math.sin(lm.rot);
    const at = (lx: number, lz: number) => ({ x: lm.x + lx * ca + lz * sa, z: lm.z - lx * sa + lz * ca });
    if (lm.kind === 'hangar') {
      // a T2: 36 m span × 74 m, 7.6 m to the eaves, the shallow gable along its length
      const y = Math.min(ground(lm.x, lm.z), lm.y) - 0.3;
      const W = 36, Lh = 74, E = 7.6;
      plain.box(lm.x, lm.z, y, y + E, W, Lh, lm.rot, CLAD);
      plain.gable(lm.x, lm.z, y + E, y + E + 3.6, W + 0.8, Lh + 0.6, lm.rot, ROOF);
      // the frame's stanchions down both long sides
      for (let k = -5; k <= 5; k++)
        for (const sx of [-1, 1]) {
          const q = at(sx * (W / 2 + 0.2), k * 6.7);
          plain.box(q.x, q.z, y, y + E + 0.2, 0.45, 0.5, lm.rot, CLAD2);
        }
      // the sliding doors across each end: leaves with seams, a rust stain at the foot, the gable
      // over them clad to the apex
      for (const sz of [-1, 1]) {
        for (let k = 0; k < 6; k++) {
          const q = at(-W / 2 + 3 + k * 6, sz * (Lh / 2 + 0.15));
          plain.box(q.x, q.z, y, y + 7.2, 5.85, 0.25, lm.rot, k % 2 ? DOOR : CLAD2);
          plain.box(q.x, q.z, y, y + 0.6, 5.85, 0.3, lm.rot, RUST);
        }
        const g = at(0, sz * (Lh / 2 + 0.1));
        plain.gable(g.x, g.z, y + E, y + E + 3.5, W, 0.2, lm.rot, CLAD2);
      }
    } else if (lm.kind === 'controlTower') {
      // the watch office: two rendered storeys, a band of windows on each, the railed roof and
      // the glazed visual control room on top
      const y = Math.min(ground(lm.x, lm.z), lm.y) - 0.3;
      plain.box(lm.x, lm.z, y, y + 7.4, 13, 11, lm.rot, WHITE);
      plain.box(lm.x, lm.z, y + 7.4, y + 7.8, 13.8, 11.8, lm.rot, C(0xcfccc3));
      for (const fy of [1.1, 4.6])
        for (const [lx, lz, w, d] of [[0, 5.52, 10, 0.1], [0, -5.52, 10, 0.1], [6.52, 0, 0.1, 8], [-6.52, 0, 0.1, 8]] as const) {
          const q = at(lx, lz);
          plain.box(q.x, q.z, y + fy, y + fy + 1.6, w, d, lm.rot, GLASS);
        }
      const t = at(-1.5, 0);
      plain.box(t.x, t.z, y + 7.8, y + 10.5, 5.2, 5.2, lm.rot, GLASS);
      plain.box(t.x, t.z, y + 10.5, y + 10.9, 5.8, 5.8, lm.rot, WHITE);
      // railing round the roof
      for (let k = -6; k <= 6; k += 1.5)
        for (const sz of [-1, 1]) {
          const q = at(k, sz * 5.7);
          plain.post(new THREE.Vector3(q.x, y + 7.8, q.z), new THREE.Vector3(q.x, y + 8.9, q.z), 0.06, C(0x2b2d2f));
        }
      for (const sz of [-1, 1]) {
        const a = at(-6.5, sz * 5.7), b = at(6.5, sz * 5.7);
        plain.post(new THREE.Vector3(a.x, y + 8.9, a.z), new THREE.Vector3(b.x, y + 8.9, b.z), 0.07, C(0x2b2d2f));
      }
      // the mast with its windsock
      const m = at(5, -4);
      plain.post(new THREE.Vector3(m.x, y + 7.8, m.z), new THREE.Vector3(m.x, y + 15, m.z), 0.12, WHITE);
      plain.box(m.x + 0.8, m.z, y + 14.2, y + 14.8, 1.6, 0.5, lm.rot, C(0xe0702a), 0.6);
    }
  }
  if (plain.pos.length) {
    const mesh = new THREE.Mesh(plain.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
    mesh.name = 'silverstone_airfield';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const m of group.children) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }
  return group;
}
