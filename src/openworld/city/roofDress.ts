import * as THREE from 'three';
import type { BuildingsBuild, RoofDeck } from './buildings.ts';
import { rng } from './build.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODELS, PAINTS, type ModelId, type ModelSpec } from '../vehicles/fleet.ts';

/**
 * What the city looks like from a helicopter: the podium decks of Brickell and Downtown dressed —
 * cars parked in the striped bays on the open tops of the garages, loungers and umbrellas round
 * the pools, palms in the planters (those go to the palm instancing) — and the tower tops: rooftop
 * AC plant, antenna masts with blinking red aviation lights, helipads.
 */

interface Item {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx?: number;
  sy?: number;
  sz?: number;
  c?: THREE.Color;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Item[], name: string, cast = true): THREE.Object3D | null {
  if (!list.length) return null;
  // in 500 m cells, so the distance culling (props.cull, by name) can drop the far ones
  const cells = new Map<string, Item[]>();
  for (const it of list) {
    const k = `${Math.floor(it.x / 500)}:${Math.floor(it.z / 500)}`;
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(it);
  }
  const g = new THREE.Group();
  g.name = name + 'Cells';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  for (const items of cells.values()) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.yaw, 0));
      s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
      p.set(it.x, it.y, it.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
      if (it.c) im.setColorAt(i, it.c);
    });
    im.castShadow = cast;
    im.receiveShadow = true;
    im.name = name;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

/** a point in a deck's frame → world */
function at(d: RoofDeck, u: number, v: number) {
  return { x: d.ox + u * d.ux - v * d.uz, z: d.oz + u * d.uz + v * d.ux };
}

let padTex: THREE.CanvasTexture | null = null;
function helipadTexture() {
  if (padTex) return padTex;
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#3a3c40';
  g.beginPath();
  g.arc(N / 2, N / 2, N / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f2c230';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(N / 2, N / 2, N / 2 - 16, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(N / 2, N / 2, N / 2 - 4, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 130px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', N / 2, N / 2 + 6);
  padTex = new THREE.CanvasTexture(cv);
  padTex.colorSpace = THREE.SRGBColorSpace;
  padTex.anisotropy = 4;
  return padTex;
}

export function buildRoofDress(bld: BuildingsBuild, addPalm: (x: number, z: number, y: number, kind: number) => void) {
  const group = new THREE.Group();
  group.name = 'RoofDress';
  const R = rng(9091);

  // ---- the garages' open tops: cars in the bays (the same striping as the roof shader)
  const cars = new Map<ModelId, Item[]>();
  const loungers: Item[] = [];
  const umbrellas: Item[] = [];
  const cabanas: Item[] = [];
  for (const d of bld.decks) {
    if (d.kind === 'parking') {
      const m = 1.6;
      for (let v0 = m; v0 + 5.4 <= d.D - m; v0 += 18) {
        for (const [vs, face] of [[v0 + 2.7, 1], [v0 + 15.3, -1]] as const) {
          if (vs + 2.7 > d.D - m) continue;
          for (let u = m + 1.3; u + 1.3 <= d.W - m; u += 2.6) {
            if (R() > 0.55) continue;
            const r = R();
            const id: ModelId = r < 0.45 ? 'sedan' : r < 0.8 ? 'suv' : r < 0.92 ? 'compact' : 'pickup';
            const p = at(d, u, vs);
            // along the bay (the deck's v axis), nose in or backed in
            const yaw = Math.atan2(-d.uz, d.ux) + (face > 0 ? 0 : Math.PI) + (R() < 0.25 ? Math.PI : 0) + (R() - 0.5) * 0.06;
            let l = cars.get(id);
            if (!l) cars.set(id, (l = []));
            l.push({ x: p.x, y: d.y, z: p.z, yaw, c: new THREE.Color(PAINTS[Math.floor(R() * PAINTS.length)]) });
          }
        }
      }
    } else {
      // the amenity deck: loungers either side of the pool, umbrellas between, cabanas, palms
      const pool = d.pool;
      if (pool) {
        const c = Math.cos(pool.yaw), s = Math.sin(pool.yaw);
        for (const side of [1, -1]) {
          const off = pool.d / 2 + 1.6;
          for (let x = -pool.w / 2 + 0.8; x <= pool.w / 2 - 0.8; x += 1.35) {
            const lx = x, lz = side * off;
            const px = pool.cx + lx * c - lz * s, pz = pool.cz + lx * s + lz * c;
            loungers.push({ x: px, y: d.y, z: pz, yaw: pool.yaw + (side > 0 ? 0 : Math.PI) });
            if (Math.round((x + pool.w / 2) / 1.35) % 2 === 1) {
              const lz2 = side * (off + 1.2);
              umbrellas.push({ x: pool.cx + lx * c - lz2 * s, y: d.y, z: pool.cz + lx * s + lz2 * c, yaw: 0, c: new THREE.Color([0xffffff, 0xf2e4c8, 0x1e5f74][Math.floor(R() * 3)]) });
            }
          }
        }
      }
      // cabanas along the far edge
      for (let u = 4; u < d.W - 4; u += 7) {
        if (R() < 0.5) continue;
        const p = at(d, u, d.D - 3.2);
        cabanas.push({ x: p.x, y: d.y, z: p.z, yaw: Math.atan2(d.ux, d.uz) });
      }
      // palms in the planters: the corners and along the long sides
      const pts: [number, number][] = [
        [0.9, 0.9],
        [d.W - 0.9, 0.9],
        [0.9, d.D - 0.9],
        [d.W - 0.9, d.D - 0.9],
      ];
      for (let u = 8; u < d.W - 8; u += 9 + R() * 5) pts.push([u, 0.9], [u, d.D - 0.9]);
      for (const [u, v] of pts) {
        if (R() < 0.35) continue;
        const p = at(d, u, v);
        addPalm(p.x, p.z, d.y, R() < 0.5 ? 1 : 0);
      }
    }
  }
  // seen from the air, so a low car: body, glasshouse, wheels in one vertex-coloured mesh
  // (the instance colour paints it; the dark parts stay dark)
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.4 });
  for (const [id, list] of cars) {
    const im = instanced(lowCar(MODELS[id]), carMat, list, 'roofCars', false);
    if (im) group.add(im);
  }
  // loungers (a white frame and cushion), umbrellas (pole + canopy), cabanas (posts + canvas roof)
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
  const loungerGeo = new THREE.BoxGeometry(0.7, 0.32, 1.95);
  loungerGeo.translate(0, 0.16, 0);
  const lm = instanced(loungerGeo, white, loungers, 'loungers');
  if (lm) group.add(lm);
  const canopy = new THREE.ConeGeometry(1.4, 0.5, 8);
  canopy.translate(0, 2.45, 0);
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6);
  pole.translate(0, 1.2, 0);
  const umbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
  const um = instanced(canopy, umbMat, umbrellas, 'umbrellas');
  if (um) group.add(um);
  const pm = instanced(pole, white, umbrellas.map((u) => ({ ...u, c: undefined })), 'umbrellaPoles', false);
  if (pm) group.add(pm);
  const cabGeo = new THREE.BoxGeometry(3.2, 0.12, 3.2);
  cabGeo.translate(0, 2.6, 0);
  const cm = instanced(cabGeo, new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.85 }), cabanas, 'cabanas');
  if (cm) group.add(cm);
  const postGeo = new THREE.BoxGeometry(0.1, 2.6, 0.1);
  postGeo.translate(0, 1.3, 0);
  const posts: Item[] = [];
  for (const c of cabanas) {
    const cc = Math.cos(c.yaw), ss = Math.sin(c.yaw);
    for (const [a, b] of [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) posts.push({ x: c.x + a * cc + b * ss, y: c.y, z: c.z - a * ss + b * cc, yaw: c.yaw });
  }
  const postM = instanced(postGeo, white, posts, 'cabanaPosts', false);
  if (postM) group.add(postM);
  // daybeds under the cabanas
  const bedGeo = new THREE.BoxGeometry(2.2, 0.45, 2.0);
  bedGeo.translate(0, 0.22, 0);
  const bedM = instanced(bedGeo, new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 }), cabanas, 'daybeds');
  if (bedM) group.add(bedM);

  // ---- tower tops: AC plant on every flat roof, masts and helipads on the crowns
  const ac: Item[] = [];
  for (const r of bld.roofs) {
    const n = Math.min(9, Math.max(2, Math.round((r.w * r.d) / 220)));
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    for (let i = 0; i < n; i++) {
      let lx = (R() - 0.5) * r.w * 0.85, lz = (R() - 0.5) * r.d * 0.85;
      // keep off the middle (the crown / the stair tower)
      if (Math.abs(lx) < r.w * 0.25 && Math.abs(lz) < r.d * 0.28) lx += Math.sign(lx || 1) * r.w * 0.28;
      const sx = 1.6 + R() * 1.6, sz = 1.2 + R() * 1.2;
      ac.push({ x: r.x + lx * c - lz * s, y: r.y, z: r.z + lx * s + lz * c, yaw: r.yaw, sx, sy: 1 + R() * 0.8, sz });
    }
  }
  const acGeo = new THREE.BoxGeometry(1, 1.2, 1);
  acGeo.translate(0, 0.6, 0);
  const acM = instanced(acGeo, new THREE.MeshStandardMaterial({ color: 0xb4b8bc, metalness: 0.55, roughness: 0.45 }), ac, 'roofAC');
  if (acM) group.add(acM);
  // fan discs on top of the units
  const fanGeo = new THREE.CircleGeometry(0.38, 14);
  fanGeo.rotateX(-Math.PI / 2);
  const fans = ac.map((a) => ({ ...a, y: a.y + 1.2 * (a.sy ?? 1) + 0.01, sx: 1, sy: 1, sz: 1 }));
  const fanM = instanced(fanGeo, new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.7 }), fans, 'roofFans', false);
  if (fanM) group.add(fanM);

  const pads: Item[] = [];
  const masts: Item[] = [];
  const beacons: Item[] = [];
  for (const c of bld.crowns) {
    const m = Math.min(c.w, c.d);
    if (c.tall > 120 && m > 11 && R() < 0.4) pads.push({ x: c.x, y: c.y + 0.06, z: c.z, yaw: c.yaw, sx: m * 0.92, sy: 1, sz: m * 0.92 });
    else if (c.tall > 80 && R() < 0.45) {
      const h = 8 + R() * 16;
      masts.push({ x: c.x, y: c.y, z: c.z, yaw: 0, sy: h });
      beacons.push({ x: c.x, y: c.y + h, z: c.z, yaw: 0 });
    }
    // every crown corner of a tall tower carries an obstruction light
    if (c.tall > 100) {
      const cc = Math.cos(c.yaw), ss = Math.sin(c.yaw);
      for (const [a, b] of [[1, 1], [-1, -1]]) {
        const lx = (a * c.w) / 2, lz = (b * c.d) / 2;
        beacons.push({ x: c.x + lx * cc - lz * ss, y: c.y + 0.3, z: c.z + lx * ss + lz * cc, yaw: 0 });
      }
    }
  }
  const padGeo = new THREE.CircleGeometry(0.5, 40);
  padGeo.rotateX(-Math.PI / 2);
  const padM = instanced(padGeo, new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.75 }), pads, 'helipads', false);
  if (padM) group.add(padM);
  const mastGeo = new THREE.CylinderGeometry(0.12, 0.25, 1, 6);
  mastGeo.translate(0, 0.5, 0);
  const mastM = instanced(mastGeo, new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.7, roughness: 0.4 }), masts, 'masts');
  if (mastM) group.add(mastM);
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.1, 0.05) });
  const beaconM = instanced(new THREE.SphereGeometry(0.35, 8, 6), beaconMat, beacons, 'beacons', false);
  if (beaconM) group.add(beaconM);

  return {
    group,
    update(t: number, night: number) {
      // the red obstruction lights pulse (about once every 1.5 s), brighter at night
      const on = Math.sin(t * 4.2) > 0.2 ? 1 : 0.08;
      beaconMat.color.setRGB(4 * on * (0.3 + night), 0.1 * on, 0.05 * on);
    },
  };
}

/** a parked car for the roofs: ~80 triangles (body, glasshouse, four wheels), vertex coloured */
const lowCars = new Map<string, THREE.BufferGeometry>();
function lowCar(m: ModelSpec): THREE.BufferGeometry {
  const hit = lowCars.get(m.id);
  if (hit) return hit;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, shade: number) => {
    g.translate(x, y, z);
    const g2 = g.index ? g.toNonIndexed() : g;
    const n = g2.getAttribute('position').count;
    const c = new Float32Array(n * 3).fill(shade);
    g2.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g2.deleteAttribute('uv');
    parts.push(g2);
  };
  const L = m.L, W = m.W, H = m.H;
  const bodyH = Math.max(0.5, H * 0.5);
  add(new THREE.BoxGeometry(W, bodyH, L), 0, m.wheelR * 0.55 + bodyH / 2, 0, 1);
  // the glasshouse: tapered in plan toward the roof
  const cab = new THREE.CylinderGeometry(0.5, 0.62, H - bodyH - m.wheelR * 0.55, 4, 1);
  cab.rotateY(Math.PI / 4);
  cab.scale(W * 1.25, 1, L * 0.62);
  add(cab, 0, m.wheelR * 0.55 + bodyH + (H - bodyH - m.wheelR * 0.55) / 2, -L * 0.05, 0.12);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.22, m.wheelR * 2, m.wheelR * 1.8), sx * (W / 2 - 0.1), m.wheelR, sz * m.wb * 0.5, 0.05);
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  lowCars.set(m.id, merged);
  return merged;
}
