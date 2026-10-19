/**
 * The uncut meadow beyond the fences: coarse, tall, sun-dried tufts that grow right up to the
 * boards and the hedge roots, so the lawn stands in a real field instead of on a green sheet.
 * Same blades and wind as the lawn (grass.ts), always long, thinned with distance from the mower.
 */
import * as THREE from 'three';
import type { LevelDef } from './levels.ts';
import { TS } from './nav.ts';
import { CHUNK, LOD_FAR, makeGrassMaterial, tuftGeometry, type GrassU } from './grass.ts';
import { makeFlowerKinds } from './flowers.ts';
import { Rng } from './util.ts';

const RING = 20;
const DENSITY = 40;
/** how far from the lawn's edge a tuft keeps (the fence line itself, and a hair beyond) */
const KEEP = 0.34;

interface Chunk {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  n: number;
  cx: number;
  cz: number;
}

export class Meadow {
  readonly group = new THREE.Group();
  private material: THREE.MeshStandardMaterial;
  private chunks: Chunk[] = [];
  private shared = tuftGeometry();
  tufts = 0;
  private flowers: THREE.InstancedMesh[] = [];
  private flowerGeos: THREE.BufferGeometry[] = [];
  private flowerMats: THREE.Material[] = [];

  constructor(level: LevelDef, private u: GrassU) {
    this.material = makeGrassMaterial(u, true);
    const rng = new Rng(level.seed * 17 + 3);
    const { w, h, nav, house } = level;
    const W = w * TS;
    const H = h * TS;
    const s = 1 / Math.sqrt(DENSITY);
    const X0 = -W / 2 - RING;
    const Z0 = -H / 2 - RING;
    const nx = Math.ceil((W + RING * 2) / CHUNK);
    const nz = Math.ceil((H + RING * 2) / CHUNK);
    const ring: [number, number][] = [];
    for (let i = 0; i < 8; i++) ring.push([Math.cos((i / 8) * Math.PI * 2) * KEEP, Math.sin((i / 8) * Math.PI * 2) * KEEP]);
    // somewhere a plant may grow: off the lawn, clear of the boards, the house and its patio
    const free = (px: number, pz: number) => {
      if (nav.playable(px, pz)) return false;
      for (const [dx, dz] of ring) if (nav.playable(px + dx, pz + dz)) return false;
      if (house) {
        if (px > house.x0 - 0.6 && px < house.x1 + 0.6 && pz < house.z + 0.6 && pz > house.z - 10) return false;
        if (px > house.px0 - 0.5 && px < house.px1 + 0.5 && pz < house.pz1 + 0.5 && pz > house.z - 1) return false;
      }
      return true;
    };
    for (let cj = 0; cj < nz; cj++) {
      for (let ci = 0; ci < nx; ci++) {
        const x0 = X0 + ci * CHUNK;
        const z0 = Z0 + cj * CHUNK;
        const pts: number[] = [];
        for (let z = z0 + s / 2; z < z0 + CHUNK; z += s) {
          for (let x = x0 + s / 2; x < x0 + CHUNK; x += s) {
            const px = x + rng.range(-0.45, 0.45) * s;
            const pz = z + rng.range(-0.45, 0.45) * s;
            if (!free(px, pz)) continue;
            // fewer, the further from the lawn (a rough field fading into the haze)
            const d = Math.max(0, Math.abs(px) - W / 2, Math.abs(pz) - H / 2);
            if (rng.next() > 1.15 - d / RING) continue;
            pts.push(px, pz);
          }
        }
        const n = pts.length / 2;
        if (n < 8) continue;
        const order = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(rng.next() * (i + 1));
          const t = order[i];
          order[i] = order[j];
          order[j] = t;
        }
        const iPos = new Float32Array(n * 3);
        const iRnd = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const o = order[i];
          iPos[i * 3] = pts[o * 2];
          iPos[i * 3 + 1] = pts[o * 2 + 1];
          iPos[i * 3 + 2] = rng.range(0, Math.PI * 2);
          iRnd[i * 4] = rng.next();
          iRnd[i * 4 + 1] = rng.next();
          iRnd[i * 4 + 2] = rng.next();
          iRnd[i * 4 + 3] = (i + 0.5) / n;
        }
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', this.shared.position);
        geo.setAttribute('normal', this.shared.normal);
        geo.setAttribute('aT', this.shared.aT);
        geo.setAttribute('aW', this.shared.aW);
        geo.setAttribute('aLean', this.shared.aLean);
        geo.setIndex(this.shared.index);
        geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
        geo.setAttribute('iRnd', new THREE.InstancedBufferAttribute(iRnd, 4));
        geo.instanceCount = n;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, 0.3, z0 + CHUNK / 2), CHUNK * 0.75 + 0.8);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({ mesh, geo, n, cx: x0 + CHUNK / 2, cz: z0 + CHUNK / 2 });
        this.tufts += n;
      }
    }
    this.scatterFlowers(level, free, rng);
  }

  /** dandelions, daisies and clover standing over the long grass, a few to the square metre near the boards */
  private scatterFlowers(level: LevelDef, free: (x: number, z: number) => boolean, rng: Rng) {
    const W = level.w * TS;
    const H = level.h * TS;
    const kinds = makeFlowerKinds();
    const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
    const stemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    this.flowerMats.push(headMat, stemMat);
    const spots: { x: number; z: number; kind: number }[] = [];
    const area = (W + RING * 2) * (H + RING * 2);
    const tries = Math.floor(area * 0.55);
    for (let i = 0; i < tries; i++) {
      const x = rng.range(-W / 2 - RING, W / 2 + RING);
      const z = rng.range(-H / 2 - RING, H / 2 + RING);
      const d = Math.max(0, Math.abs(x) - W / 2, Math.abs(z) - H / 2);
      if (rng.next() > Math.max(0.05, 1 - d / 14) * 0.5) continue;
      if (!free(x, z)) continue;
      const r = rng.next();
      spots.push({ x, z, kind: r < 0.42 ? 1 : r < 0.82 ? 0 : 2 });
    }
    const blooms = level.theme.blooms;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();
    kinds.forEach((kd, kind) => {
      const list = spots.filter((f) => f.kind === kind);
      this.flowerGeos.push(kd.head, kd.stem);
      if (!list.length) return;
      const head = new THREE.InstancedMesh(kd.head, headMat, list.length);
      const stem = new THREE.InstancedMesh(kd.stem, stemMat, list.length);
      head.castShadow = stem.castShadow = false;
      head.receiveShadow = stem.receiveShadow = true;
      head.frustumCulled = stem.frustumCulled = false;
      list.forEach((f, i) => {
        const k = rng.range(1.5, 2.4);
        e.set(rng.range(-0.12, 0.12), rng.range(0, 6.28), rng.range(-0.12, 0.12));
        q.setFromEuler(e);
        p.set(f.x, 0, f.z);
        sc.set(k, k, k);
        m.compose(p, q, sc);
        head.setMatrixAt(i, m);
        stem.setMatrixAt(i, m);
        // dandelions stay yellow, daisies white, clover pink; the season tints a few
        c.set(kind === 1 ? '#ffd21c' : kind === 0 ? '#ffffff' : '#f0a6c4');
        if (rng.chance(0.18)) c.set(blooms[rng.int(0, blooms.length - 1)]);
        head.setColorAt(i, c);
      });
      this.flowers.push(head, stem);
      this.group.add(head, stem);
    });
  }

  update(fx: number, fz: number, densScale: number) {
    const R = CHUNK * 0.72;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.cx - fx, c.cz - fz) - R);
      const k = Math.max(0, Math.min(1, (LOD_FAR - d) / 18));
      const dens = k * Math.sqrt(k) * densScale;
      const count = Math.min(c.n, Math.ceil(c.n * dens + 0.5));
      c.geo.instanceCount = count;
      c.mesh.visible = count > 0 && d < LOD_FAR;
    }
  }

  dispose() {
    for (const c of this.chunks) {
      c.geo.deleteAttribute('iPos');
      c.geo.deleteAttribute('iRnd');
      c.geo.dispose();
    }
    this.material.dispose();
    this.flowers.forEach((f) => f.dispose());
    this.flowerGeos.forEach((g) => g.dispose());
    this.flowerMats.forEach((mm) => mm.dispose());
  }
}
