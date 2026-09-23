import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import { WorldMap } from './worldmap.ts';
import type { Layout } from './layout.ts';
import { perlin2, rng } from './noise.ts';

/**
 * Harbour at the hairpin (rubble-mound moles with crown walls, stone quays,
 * pontoons with ~150 moored boats that gently bob), a few yachts at anchor in the
 * bay, and the Faro lighthouse on the cliff at Turn 1.
 */

export interface HarbourBuild {
  group: THREE.Group;
  update(t: number): void;
  boats: number;
}

const ROCK = srgb(0x9d968a);
const ROCK_DARK = srgb(0x55544c);
const CONCRETE = srgb(0xc8c3b8);
const STONE = srgb(0xb49f82);
const DECK = srgb(0x8a6a4c);

// ---------------------------------------------------------------- boats

function hull(mb: MeshBuilder, L: number, B: number, F: number, Dr: number, hullCol: THREE.Color, deckCol: THREE.Color) {
  const N = 12;
  const secs: { z: number; w: number; top: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 stern → 1 bow
    const w = (B / 2) * (t < 0.55 ? 0.88 + 0.12 * Math.sin((t / 0.55) * Math.PI * 0.5) : Math.pow(Math.cos(((t - 0.55) / 0.45) * Math.PI * 0.5), 0.75));
    secs.push({ z: -L / 2 + t * L, w: Math.max(w, 0.02), top: F + t * t * 0.35 });
  }
  const boot = srgb(0x1c2a3a);
  const ring = (s: { z: number; w: number; top: number }) => [
    [-s.w, s.top],
    [-s.w * 0.96, 0.12],
    [-s.w * 0.55, -Dr * 0.6],
    [0, -Dr],
    [s.w * 0.55, -Dr * 0.6],
    [s.w * 0.96, 0.12],
    [s.w, s.top],
  ];
  const tmp = new THREE.Color();
  const rings: number[][] = [];
  for (const s of secs) {
    const r = ring(s);
    const ids: number[] = [];
    for (let k = 0; k < r.length; k++) {
      const [x, y] = r[k];
      const nx = x === 0 ? 0 : Math.sign(x) * 0.9, ny = y > 0 ? 0.1 : -0.6;
      tmp.copy(y < 0.18 && y > -0.1 ? boot : y <= -0.1 ? srgb(0x3a4a52) : hullCol);
      ids.push(mb.vertex(x, y, s.z, nx, ny, 0, tmp));
    }
    rings.push(ids);
  }
  for (let i = 0; i < N; i++)
    for (let k = 0; k < 6; k++) {
      const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k], d = rings[i + 1][k + 1];
      mb.idx.push(a, b, c, b, d, c);
    }
  // deck
  for (let i = 0; i < N; i++) {
    const s0 = secs[i], s1 = secs[i + 1];
    mb.quad4(
      new THREE.Vector3(s0.w, s0.top, s0.z), new THREE.Vector3(-s0.w, s0.top, s0.z),
      new THREE.Vector3(-s1.w, s1.top, s1.z), new THREE.Vector3(s1.w, s1.top, s1.z), deckCol,
    );
  }
  // transom
  const s0 = secs[0];
  mb.quad4(new THREE.Vector3(s0.w, -Dr * 0.5, s0.z), new THREE.Vector3(-s0.w, -Dr * 0.5, s0.z), new THREE.Vector3(-s0.w, s0.top, s0.z), new THREE.Vector3(s0.w, s0.top, s0.z), hullCol);
}

function sailBoat(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  hull(mb, 11, 3.6, 1.1, 1.6, srgb(0xf4f4f2), srgb(0xd8d2c4));
  mb.aabb(-1.1, 1.1, -2.2, 1.1, 1.9, 1.4, srgb(0xf0f0ee));
  mb.aabb(-1.12, 1.45, -1.8, 1.12, 1.7, 1.0, srgb(0x1b2229));
  mb.tube([[0, 1.1, 1.5, 0.09], [0, 16, 1.5, 0.06]], 4, srgb(0xd9dcdf));
  mb.tube([[0, 2.6, 1.5, 0.06], [0, 2.6, -3.6, 0.05]], 3, srgb(0xd9dcdf));
  // furled sail on the boom
  mb.tube([[0, 2.85, 1.3, 0.2], [0, 2.8, -3.2, 0.14]], 5, srgb(0x2a4a7a));
  return mb.geometry(false);
}

function motorBoat(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  hull(mb, 15, 4.6, 1.6, 1.3, srgb(0xf6f6f4), srgb(0xe9e4da));
  mb.aabb(-1.9, 1.6, -4.5, 1.9, 3.3, 2.8, srgb(0xf7f7f5));
  mb.aabb(-1.92, 2.2, -4.0, 1.92, 3.0, 2.6, srgb(0x141b22));
  mb.aabb(-1.6, 3.3, -3.8, 1.6, 4.2, 0.6, srgb(0xf0f0ee));
  mb.aabb(-1.62, 3.55, -3.4, 1.62, 4.05, 0.3, srgb(0x141b22));
  mb.tube([[0, 4.2, -1.2, 0.05], [0, 6.2, -1.6, 0.04]], 3, srgb(0xcccccc));
  return mb.geometry(false);
}

function superYacht(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  hull(mb, 34, 7.4, 2.6, 2.2, srgb(0x1a2433), srgb(0xd8cdb9));
  const W = srgb(0xf7f7f5), G = srgb(0x0e141a);
  mb.aabb(-3.2, 2.6, -12, 3.2, 5.2, 9, W);
  mb.aabb(-3.22, 3.4, -11, 3.22, 4.8, 8.5, G);
  mb.aabb(-2.8, 5.2, -9, 2.8, 7.6, 5.5, W);
  mb.aabb(-2.82, 5.9, -8.5, 2.82, 7.2, 5.0, G);
  mb.aabb(-2.2, 7.6, -6, 2.2, 9.2, 2.0, W);
  mb.aabb(-2.22, 8.1, -5.5, 2.22, 8.9, 1.6, G);
  mb.tube([[0, 9.2, -2, 0.12], [0, 13, -2.6, 0.08]], 4, srgb(0xdddddd));
  return mb.geometry(false);
}

function boatMaterial(uniforms: { uTime: THREE.IUniform }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float id = float( gl_InstanceID );
  float roll = sin( uTime * 0.9 + id * 1.7 ) * 0.035;
  float pitch = sin( uTime * 0.7 + id * 2.3 ) * 0.012;
  transformed.y += transformed.x * roll + transformed.z * pitch + sin( uTime * 1.1 + id ) * 0.05;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-boat';
  return mat;
}

// ---------------------------------------------------------------- harbour structures

export function buildHarbour(map: WorldMap, layout: Layout): HarbourBuild {
  const group = new THREE.Group();
  group.name = 'Harbour';
  const HP = map.A.hairpin;
  const r = rng(515);
  const rocks = new MeshBuilder();
  const struct = new MeshBuilder();
  const lights = new MeshBuilder();

  // moles: rubble mound + crown wall + walkway
  for (const line of layout.moles) {
    const pts = line.map((p) => new THREE.Vector2(p.x, p.z));
    // resample every 4 m
    const samples: { p: THREE.Vector2; t: THREE.Vector2 }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = a.distanceTo(b);
      const n = Math.max(1, Math.round(L / 4));
      const t = b.clone().sub(a).normalize();
      for (let k = 0; k < n; k++) samples.push({ p: a.clone().lerp(b, k / n), t });
    }
    samples.push({ p: pts[pts.length - 1].clone(), t: samples[samples.length - 1].t });
    // sea side: the side away from the harbour basin centre
    const basin = new THREE.Vector2(HP.x - 139, HP.z + 72);
    // cross-section (lateral from centreline, height); + lateral = sea side
    const prof: [number, number, number][] = [
      // [lateral, y, rockiness]
      [-12, -7, 1], [-8.5, -2.5, 1], [-6, 0.6, 1], [-4.2, 2.3, 0.4],
      [-3.2, 2.5, 0], [3.0, 2.5, 0], [3.0, 5.4, 0], [4.6, 5.4, 0], [4.6, 3.2, 0.3],
      [7.0, 1.2, 1], [10, -2.0, 1], [14, -7, 1],
    ];
    const rows: number[][] = [];
    const tmp = new THREE.Color();
    samples.forEach((sm, si) => {
      const nrm = new THREE.Vector2(-sm.t.y, sm.t.x);
      const toBasin = basin.clone().sub(sm.p);
      if (nrm.dot(toBasin) > 0) nrm.negate(); // + lateral → sea
      const row: number[] = [];
      const endCap = si === samples.length - 1 ? 1 : 0;
      for (let k = 0; k < prof.length; k++) {
        const [lat, y, rk] = prof[k];
        const n1 = perlin2(sm.p.x * 0.35 + k * 3.1, sm.p.y * 0.35 - k * 1.7);
        const n2 = perlin2(sm.p.x * 1.1 - k, sm.p.y * 1.1 + k * 2.2);
        const j = rk * (n1 * 1.1 + n2 * 0.45);
        const x = sm.p.x + nrm.x * (lat + j * 0.6);
        const z = sm.p.y + nrm.y * (lat + j * 0.6);
        const yy = y + rk * j * 0.5 + endCap * 0;
        const wet = yy < 0.6 ? 0.55 : 1;
        if (rk > 0.5) tmp.copy(ROCK).lerp(ROCK_DARK, 0.3 + 0.3 * n2).multiplyScalar(wet * (0.85 + 0.25 * (n1 * 0.5 + 0.5)));
        else tmp.copy(k >= 6 && k <= 7 ? CONCRETE.clone().multiplyScalar(0.92) : CONCRETE);
        row.push(rocks.vertex(x, yy, z, 0, 1, 0, tmp));
      }
      rows.push(row);
    });
    for (let i = 0; i < rows.length - 1; i++)
      for (let k = 0; k < prof.length - 1; k++) {
        const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
        rocks.idx.push(a, b, c, b, d, c);
        rocks.idx.push(a, c, b, b, c, d); // double-sided (orientation depends on mole direction)
      }
    // head: harbour light
    const end = samples[samples.length - 1].p;
    const green = line === layout.moles[1];
    const lh = new MeshBuilder();
    lh.tube([[0, 2.4, 0, 1.6], [0, 11, 0, 1.2]], 10, srgb(0xf4f4f2), () => 0, true);
    lh.tube([[0, 11, 0, 1.25], [0, 13.5, 0, 1.1]], 10, green ? srgb(0x1f8a3c) : srgb(0xc21d24), () => 0, true);
    lh.transform(new THREE.Matrix4().makeTranslation(end.x, 0, end.y));
    struct.append(lh);
    const bulb = new MeshBuilder();
    bulb.blob(end.x, 14.1, end.y, 0.45, 0.45, 0.45, 6, 3, green ? new THREE.Color(1, 12, 2) : new THREE.Color(14, 1.2, 1), { lumps: 0, leaf: 0 });
    lights.append(bulb);
  }

  // quay walls along the harbour coast segment (quay-type vertices)
  {
    const q = map.coast.filter((c) => c.quay > 0.45);
    for (let i = 0; i < q.length - 1; i++) {
      const a = new THREE.Vector2(q[i].x, q[i].z), b = new THREE.Vector2(q[i + 1].x, q[i + 1].z);
      const t = b.clone().sub(a).normalize();
      let n = new THREE.Vector2(-t.y, t.x);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      // push toward the water
      if (map.height(mid.x + n.x * 6, mid.y + n.y * 6) > map.height(mid.x - n.x * 6, mid.y - n.y * 6)) n = n.negate();
      const L = a.distanceTo(b);
      const off = 0.4;
      const P = (s: number, w: number, y: number) => new THREE.Vector3(a.x + t.x * s + n.x * w, y, a.y + t.y * s + n.y * w);
      // water-facing wall: winding chosen so the normal points along n
      const face = (s0: number, s1: number, w: number, y0: number, y1: number, c: THREE.Color) => {
        const p0 = P(s0, w, y0), p1 = P(s1, w, y0), p2 = P(s1, w, y1), p3 = P(s0, w, y1);
        const nrm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0));
        if (nrm.x * n.x + nrm.z * n.y > 0) struct.quad4(p0, p1, p2, p3, c);
        else struct.quad4(p1, p0, p3, p2, c);
      };
      face(-0.2, L + 0.2, off, -6, 2.35, STONE);
      face(-0.2, L + 0.2, off + 0.12, 2.35, 2.6, CONCRETE);
      // coping on top
      {
        const p0 = P(-0.2, off + 0.12, 2.6), p1 = P(L + 0.2, off + 0.12, 2.6), p2 = P(L + 0.2, off - 1.4, 2.6), p3 = P(-0.2, off - 1.4, 2.6);
        const nrm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0));
        if (nrm.y > 0) struct.quad4(p0, p1, p2, p3, CONCRETE);
        else struct.quad4(p1, p0, p3, p2, CONCRETE);
      }
      for (let k = 3; k < L - 1; k += 9) {
        const p = P(k, off - 0.6, 0);
        struct.tube([[p.x, 2.5, p.z, 0.18], [p.x, 3.1, p.z, 0.2]], 5, srgb(0x2b2b2b), () => 0, true);
      }
    }
  }

  // pontoons + moored boats
  const sail: THREE.Matrix4[] = [];
  const motor: THREE.Matrix4[] = [];
  const yacht: THREE.Matrix4[] = [];
  const hullTint: THREE.Color[][] = [[], [], []];
  const tints = [0xffffff, 0xffffff, 0xffffff, 0xf2f0ea, 0xdfe7ee, 0x9fb3c8].map((h) => new THREE.Color(h));
  const addBoat = (list: THREE.Matrix4[], tl: THREE.Color[], x: number, z: number, heading: number) => {
    list.push(new THREE.Matrix4().makeRotationY(heading).setPosition(x, 0, z));
    tl.push(tints[Math.floor(r() * tints.length)]);
  };
  const pontoonZ = [-133, -88, -43, 2, 47].map((d) => HP.z + d);
  for (const pz of pontoonZ) {
    // quay line x at this z
    let qx = HP.x - 99;
    for (let x = HP.x - 55; x > HP.x - 170; x -= 1) if (map.height(x, pz) < 1) { qx = x; break; }
    const len = 84;
    struct.aabb(qx - len, 0.25, pz - 1.5, qx + 1, 0.75, pz + 1.5, DECK);
    for (let k = 4; k < len; k += 8) struct.aabb(qx - k - 0.2, -2, pz - 1.7, qx - k + 0.2, 1.1, pz - 1.3, srgb(0x444444));
    for (let k = 5; k < len - 4; k += 5.2) {
      for (const sd of [-1, 1]) {
        if (r() < 0.12) continue;
        const kind = r();
        const x = qx - k;
        if (kind < 0.55) addBoat(sail, hullTint[0], x, pz + sd * 7.2, sd > 0 ? 0 : Math.PI);
        else addBoat(motor, hullTint[1], x, pz + sd * 9.2, sd > 0 ? 0 : Math.PI);
      }
    }
  }
  // superyachts stern-to along the inside of the south mole
  {
    const m = layout.moles[0];
    for (let k = 0; k < 5; k++) {
      const t = 0.25 + k * 0.14;
      const i = Math.min(m.length - 2, Math.floor(t * (m.length - 1)));
      const f = t * (m.length - 1) - i;
      const x = m[i].x + (m[i + 1].x - m[i].x) * f;
      const z = m[i].z + (m[i + 1].z - m[i].z) * f;
      const dir = Math.atan2(m[i + 1].x - m[i].x, m[i + 1].z - m[i].z);
      // perpendicular toward the basin; stern at the mole, bow into the basin
      let px = Math.cos(dir), pz = -Math.sin(dir);
      if (px * (HP.x - 139 - x) + pz * (HP.z + 72 - z) < 0) { px = -px; pz = -pz; }
      const bx = x + px * 26, bz = z + pz * 26;
      addBoat(yacht, hullTint[2], bx, bz, Math.atan2(px, pz));
    }
  }
  // boats at anchor / sailing in the bay (some in the golden glitter)
  const anchored = [
    [-459, 402, 0.4], [-659, 202, 1.2], [141, 432, 2.2], [641, 472, 0.9], [-259, 652, 2.8], [-959, -148, 1.6],
    [1191, 402, 0.2], [441, 702, 1.1], [-859, 452, 2.0],
  ].map(([dx, dz, h]) => [HP.x + dx, HP.z + dz, h]);
  anchored.forEach(([x, z, h], i) => {
    if (map.height(x, z) > -3) return;
    if (i % 3 === 0) addBoat(yacht, hullTint[2], x, z, h);
    else if (i % 3 === 1) addBoat(motor, hullTint[1], x, z, h);
    else addBoat(sail, hullTint[0], x, z, h);
  });

  const uniforms = { uTime: { value: 0 } };
  const bmat = boatMaterial(uniforms);
  let boats = 0;
  ([[sailBoat(), sail, hullTint[0]], [motorBoat(), motor, hullTint[1]], [superYacht(), yacht, hullTint[2]]] as [THREE.BufferGeometry, THREE.Matrix4[], THREE.Color[]][]).forEach(([g, list, tl]) => {
    if (!list.length) return;
    g.computeVertexNormals();
    const im = new THREE.InstancedMesh(g, bmat, list.length);
    list.forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, tl[i]);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
    boats += list.length;
  });

  // ---------------------------------------------------------------- Faro lighthouse
  {
    const L = layout.lighthouse;
    const mb = new MeshBuilder();
    const W = srgb(0xf5f3ee);
    // keeper's house
    mb.aabb(-9, -3, -5, 5, 4.2, 5, W);
    mb.prismX([[-5.6, 4.2], [5.6, 4.2], [0, 6.8]], -9.3, 5.3, srgb(0xb45a38));
    // tower
    mb.tube([[8, -3, 0, 3.3], [8, 22, 0, 2.3]], 16, (t) => (t > 0.45 && t < 0.62 ? srgb(0xb52a26) : W));
    // gallery
    mb.tube([[8, 22, 0, 3.2], [8, 22.6, 0, 3.2]], 16, srgb(0x2d3136), () => 0, true);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      mb.tube([[8 + Math.cos(a) * 3.1, 22.6, Math.sin(a) * 3.1, 0.05], [8 + Math.cos(a) * 3.1, 23.7, Math.sin(a) * 3.1, 0.05]], 3, srgb(0x2d3136));
    }
    // lantern room + cupola
    mb.tube([[8, 22.6, 0, 1.9], [8, 25.4, 0, 1.9]], 12, srgb(0x2a3a44));
    mb.blob(8, 25.4, 0, 2.1, 1.5, 2.1, 12, 6, srgb(0x6a3a2a), { lumps: 0, leaf: 0, shade: [0.9, 1.1], normalUp: 0 });
    mb.transform(new THREE.Matrix4().makeRotationY(L.rot).setPosition(L.x, L.y, L.z));
    struct.append(mb);
    const lamp = new MeshBuilder();
    lamp.blob(0, 0, 0, 0.9, 1.1, 0.9, 8, 4, new THREE.Color(18, 15, 9), { lumps: 0, leaf: 0 });
    lamp.transform(new THREE.Matrix4().makeRotationY(L.rot).setPosition(L.x, L.y + 24, L.z).multiply(new THREE.Matrix4().makeTranslation(8, 0, 0)));
    lights.append(lamp);
  }

  const rm = new THREE.Mesh(rocks.geometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true, side: THREE.FrontSide }));
  rm.geometry.computeVertexNormals();
  rm.name = 'moles';
  rm.receiveShadow = true;
  rm.castShadow = true;
  group.add(rm);
  const sm = new THREE.Mesh(struct.geometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  sm.name = 'harbour_structures';
  sm.castShadow = true;
  sm.receiveShadow = true;
  group.add(sm);
  const lmesh = new THREE.Mesh(lights.geometry(false), new THREE.MeshBasicMaterial({ vertexColors: true }));
  lmesh.name = 'harbour_lights';
  group.add(lmesh);

  return {
    group,
    boats,
    update(t: number) {
      uniforms.uTime.value = t;
    },
  };
}
