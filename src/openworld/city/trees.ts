import * as THREE from 'three';
import { loadTreeKit, PROTO_INFO, type TreeKit } from '../../world/env/treeproto.ts';
import { createTreeUniforms, impostorMaterial, setLeafFill, treeDepthMaterial, treeMaterial, type TreeUniforms } from '../../world/env/treematerial.ts';
import { aerialSunDir } from '../../world/env/fog.ts';
import { makeSurf, type Network } from '../roads.ts';
import type { CollisionWorld, Contact, Solid } from '../sim/collide.ts';
import { WORLD } from '../geo.ts';
import type { LawnMask } from './lawnmask.ts';

/**
 * Miami's shade trees: the race game's scanned trees (Poly Haven scans baked to leaf-card LODs and
 * impostor frames, world/env/treeproto.ts) planted in the city's open ground — the bayfront parks,
 * the lawns, the medians and the lots between the towers — as live oaks and banyans (the dome and
 * the gnarled broadleaf), jacarandas, poinciana-like umbrella crowns, and sea-grape shrubs. The
 * royal palms along the streets stay the props' own.
 *
 * Every tree is an impostor card (one instanced draw for the lot); the ones within ~60 m of the
 * camera are swapped for their 3D tree (one instanced mesh per prototype, re-picked a few times a
 * second as you move), the impostor dissolving out as the tree appears. The 3D trees cast shadows.
 */

interface T {
  x: number;
  y: number;
  z: number;
  proto: number;
  s: number;
  rot: number;
  flip: boolean;
}

const ID = (id: string) => PROTO_INFO.findIndex((p) => p.id === id);
const NEAR = 62;

export interface TreesBuild {
  group: THREE.Group;
  solids: Solid[];
  count: number;
  update(cam: THREE.Vector3, t: number, sunShare: number): void;
}

function hash(x: number, z: number, k: number) {
  const h = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, 0), b = hash(xi + 1, zi, 0), c = hash(xi, zi + 1, 0), d = hash(xi + 1, zi + 1, 0);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function buildTrees(net: Network, world: CollisionWorld, beachX: (z: number) => number, lawn?: LawnMask): TreesBuild {
  const group = new THREE.Group();
  group.name = 'Trees';
  const t0 = performance.now();
  // ---- where the roads and sidewalks are: a 3 m raster, so the planting test is a lookup
  const C = 3;
  const W = Math.ceil((WORLD.x1 - WORLD.x0) / C), H = Math.ceil((WORLD.z1 - WORLD.z0) / C);
  const paved = new Uint8Array(W * H);
  const mark = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r - WORLD.x0) / C), i1 = Math.floor((x + r - WORLD.x0) / C);
    const j0 = Math.floor((z - r - WORLD.z0) / C), j1 = Math.floor((z + r - WORLD.z0) / C);
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) paved[j * W + i] = 1;
  };
  for (const e of net.edges) {
    const r = e.hw + e.spec.sidewalk + 1.5;
    for (let k = 0; k + 1 < e.px.length; k++) {
      const ax = e.px[k], az = e.pz[k], bx = e.px[k + 1], bz = e.pz[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s <= n; s++) mark(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, r);
    }
  }
  const isPaved = (x: number, z: number) => {
    const i = Math.floor((x - WORLD.x0) / C), j = Math.floor((z - WORLD.z0) / C);
    return i < 0 || j < 0 || i >= W || j >= H || paved[j * W + i] === 1;
  };
  // ---- planting: a jittered 9 m grid, thinned by a park-scale noise
  const trees: T[] = [];
  const solids: Solid[] = [];
  const tmp: Contact[] = [];
  const surf = makeSurf();
  const broad = [ID('dome'), ID('dome'), ID('gnarl'), ID('jacaranda'), ID('umbrella'), ID('umbrella')];
  const shrubs = [ID('shrub_a'), ID('shrub_b'), ID('shrub_c')];
  const G = 9;
  for (let z = WORLD.z0 + G / 2; z < WORLD.z1; z += G)
    for (let x = WORLD.x0 + G / 2; x < WORLD.x1; x += G) {
      const h = hash(x, z, 1);
      const px = x + (hash(x, z, 2) - 0.5) * G * 0.9, pz = z + (hash(x, z, 3) - 0.5) * G * 0.9;
      // groves and open lawn: denser in some places than others
      const n = vnoise(px / 140, pz / 140) * 0.65 + vnoise(px / 37, pz / 37) * 0.35;
      const dens = 0.12 + THREE.MathUtils.smoothstep(n, 0.32, 0.66) * 0.7;
      if (h > dens) continue;
      if (!net.mask.land(px, pz)) continue;
      // keep off the beach and back from the water's edge
      if (px > beachX(pz) - 35) continue;
      if (!net.mask.land(px + 7, pz) || !net.mask.land(px - 7, pz) || !net.mask.land(px, pz + 7) || !net.mask.land(px, pz - 7)) continue;
      if (isPaved(px, pz) || (lawn && !lawn.lawn(px, pz))) continue;
      const shrub = hash(x, z, 4) < 0.22;
      if (world.circleContacts(px, pz, shrub ? 1.4 : 3.2, 1, tmp).length) continue;
      const proto = shrub ? shrubs[Math.floor(hash(x, z, 5) * 3)] : broad[Math.floor(hash(x, z, 6) * broad.length)];
      const info = PROTO_INFO[proto];
      // Miami's shade trees are smaller than the scans: 8-14 m
      const s = shrub ? 0.8 + hash(x, z, 7) * 0.6 : (8 + hash(x, z, 7) * 6) / info.height;
      const y = net.surface(px, pz, 5, surf).y;
      trees.push({ x: px, y, z: pz, proto, s, rot: hash(x, z, 8) * Math.PI * 2, flip: hash(x, z, 9) > 0.5 });
      if (!shrub) {
        const so: Solid = { poly: [], y0: y, y1: y + 6, cx: px, cz: pz, r: 0.6, circle: 0.35 * Math.max(0.8, s * 1.4), kind: 'palm' };
        solids.push(so);
      }
    }
  const build: TreesBuild = { group, solids, count: trees.length, update() {} };
  const u: TreeUniforms = createTreeUniforms();
  // ---- the render, once the scans have arrived
  void loadTreeKit().then((kit: TreeKit) => {
    if (!kit.ready || !kit.protos.length) return;
    // impostors: every tree
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    const N = trees.length;
    const iPos = new Float32Array(N * 4), iInfo = new Float32Array(N * 4), iTint = new Float32Array(N * 3), iFade = new Float32Array(N * 2);
    trees.forEach((t, i) => {
      iPos.set([t.x, t.y, t.z, t.s], i * 4);
      iInfo.set([t.proto, t.flip ? 1 : 0, 1, t.rot], i * 4);
      // (a touch deeper, more tropical green than the European scans)
      iTint.set([0.86, 1.0, 0.84], i * 3);
      iFade[i * 2 + 1] = 1;
    });
    base.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
    base.setAttribute('iInfo', new THREE.InstancedBufferAttribute(iInfo, 4));
    base.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
    const fadeA = new THREE.InstancedBufferAttribute(iFade, 2);
    fadeA.setUsage(THREE.DynamicDrawUsage);
    base.setAttribute('iFade', fadeA);
    base.instanceCount = N;
    base.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const imp = new THREE.Mesh(base, impostorMaterial(kit, u));
    imp.name = 'trees_impostors';
    imp.frustumCulled = false;
    imp.renderOrder = 1;
    group.add(imp);
    // the near 3D trees: one instanced mesh per prototype (LOD1), shadows from the same
    const mat = treeMaterial(kit, u);
    const depth = treeDepthMaterial(kit, u);
    const MAXN = 160;
    const near = kit.protos.map((p) => {
      const im = new THREE.InstancedMesh(p.lods[Math.min(1, p.lods.length - 1)], mat, MAXN);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.customDepthMaterial = depth;
      im.frustumCulled = false;
      im.name = 'trees_near';
      group.add(im);
      return im;
    });
    // a grid over the trees for the near query
    const CELL = 64;
    const cells = new Map<number, number[]>();
    trees.forEach((t, i) => {
      const k = Math.floor((t.x - WORLD.x0) / CELL) * 4096 + Math.floor((t.z - WORLD.z0) / CELL);
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(i);
    });
    const shown = new Set<number>();
    let next = new Set<number>();
    const lastAt = new THREE.Vector3(1e9, 0, 0);
    let lastT = -1;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    build.update = (cam, t, sunShare) => {
      u.uTime.value = t;
      u.uFrame.value = (u.uFrame.value + 1) % 64;
      u.uSunW.value.set(aerialSunDir.x, aerialSunDir.y, aerialSunDir.z).normalize();
      setLeafFill(u, sunShare);
      u.uShade.value.set(cam.x, cam.z, NEAR + 10, NEAR + 20);
      if (cam.distanceToSquared(lastAt) < 16 && t - lastT < 0.5) return;
      lastAt.copy(cam);
      lastT = t;
      // the trees in range, nearest first
      next = new Set();
      const ci = Math.floor((cam.x - WORLD.x0) / CELL), cj = Math.floor((cam.z - WORLD.z0) / CELL);
      const cand: [number, number][] = [];
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const l = cells.get((ci + a) * 4096 + cj + b);
          if (!l) continue;
          for (const i of l) {
            const d = Math.hypot(trees[i].x - cam.x, trees[i].z - cam.z);
            if (d < NEAR && cam.y - trees[i].y < 140) cand.push([d, i]);
          }
        }
      cand.sort((a, b) => a[0] - b[0]);
      const counts = new Array(near.length).fill(0);
      for (const [, i] of cand) {
        const p = trees[i].proto;
        if (counts[p] >= MAXN) continue;
        counts[p]++;
        next.add(i);
      }
      // swap: the impostors of the trees coming in dissolve out; those leaving come back
      const fa = fadeA.array as Float32Array;
      let dirty = false;
      for (const i of next)
        if (!shown.has(i)) {
          fa[i * 2] = Math.max(1e-3, t);
          fa[i * 2 + 1] = 0;
          dirty = true;
        }
      for (const i of shown)
        if (!next.has(i)) {
          fa[i * 2] = Math.max(1e-3, t);
          fa[i * 2 + 1] = 1;
          dirty = true;
        }
      if (dirty) fadeA.needsUpdate = true;
      shown.clear();
      for (const i of next) shown.add(i);
      // the 3D instances
      counts.fill(0);
      for (const i of next) {
        const tr = trees[i];
        const im = near[tr.proto];
        q.setFromAxisAngle(up, tr.rot);
        sv.set(tr.s * (tr.flip ? -1 : 1), tr.s * (0.94 + ((tr.rot * 13.7) % 1) * 0.12), tr.s);
        pv.set(tr.x, tr.y, tr.z);
        im.setMatrixAt(counts[tr.proto]++, m4.compose(pv, q, sv));
      }
      near.forEach((im, k) => {
        im.count = counts[k];
        im.instanceMatrix.needsUpdate = true;
      });
    };
    console.log(`[trees] ${N} trees placed in ${Math.round(performance.now() - t0)} ms`);
  });
  return build;
}
