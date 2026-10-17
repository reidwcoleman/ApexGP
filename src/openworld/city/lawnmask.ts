import * as THREE from 'three';
import { WORLD } from '../geo.ts';
import type { Network } from '../roads.ts';
import type { BuildingsBuild } from './buildings.ts';

/**
 * Where the city is lawn: a 4 m raster over the world — land, not the beach, not a road or its
 * sidewalks, not a building's footprint, not a paved lot or plaza. The trees are planted in it and
 * the grass blades grow from it (uploaded as a texture the blade shader reads).
 */
export interface LawnMask {
  readonly C: number;
  readonly W: number;
  readonly H: number;
  readonly data: Uint8Array;
  lawn(x: number, z: number): boolean;
  texture(): THREE.DataTexture;
}

export function buildLawnMask(net: Network, bld: BuildingsBuild, beachX: (z: number) => number): LawnMask {
  const C = 4;
  const W = Math.ceil((WORLD.x1 - WORLD.x0) / C), H = Math.ceil((WORLD.z1 - WORLD.z0) / C);
  const data = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const z = WORLD.z0 + (j + 0.5) * C;
    const bx = beachX(z) - 6;
    for (let i = 0; i < W; i++) {
      const x = WORLD.x0 + (i + 0.5) * C;
      if (x < bx && net.mask.land(x, z)) data[j * W + i] = 255;
    }
  }
  const clearDisc = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r - WORLD.x0) / C), i1 = Math.floor((x + r - WORLD.x0) / C);
    const j0 = Math.floor((z - r - WORLD.z0) / C), j1 = Math.floor((z + r - WORLD.z0) / C);
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) data[j * W + i] = 0;
  };
  // roads and sidewalks
  for (const e of net.edges) {
    const r = e.hw + e.spec.sidewalk + 0.5;
    for (let k = 0; k + 1 < e.px.length; k++) {
      const ax = e.px[k], az = e.pz[k], bx = e.px[k + 1], bz = e.pz[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s <= n; s++) clearDisc(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, r);
    }
  }
  for (const nd of net.nodes) clearDisc(nd.x, nd.z, 14);
  // a triangle (xz) cleared
  const clearTri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - WORLD.x0) / C)), i1 = Math.min(W - 1, Math.floor((Math.max(ax, bx, cx) - WORLD.x0) / C));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - WORLD.z0) / C)), j1 = Math.min(H - 1, Math.floor((Math.max(az, bz, cz) - WORLD.z0) / C));
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) return;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = WORLD.x0 + (i + 0.5) * C, z = WORLD.z0 + (j + 0.5) * C;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        // (a cell's width of slack: the edges of a lot are paved too)
        if (l1 >= -0.08 && l2 >= -0.08 && 1 - l1 - l2 >= -0.08) data[j * W + i] = 0;
      }
  };
  for (const c of bld.colliders) {
    const p = c.poly;
    for (let k = 1; k + 1 < p.length; k++) clearTri(p[0].x, p[0].z, p[k].x, p[k].z, p[k + 1].x, p[k + 1].z);
  }
  // the paved lots and plazas (their own meshes)
  bld.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name !== 'lots') return;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      clearTri(pos.getX(a), pos.getZ(a), pos.getX(b), pos.getZ(b), pos.getX(c), pos.getZ(c));
    }
  });
  let tex: THREE.DataTexture | null = null;
  return {
    C, W, H, data,
    lawn(x, z) {
      const i = Math.floor((x - WORLD.x0) / C), j = Math.floor((z - WORLD.z0) / C);
      return i >= 0 && j >= 0 && i < W && j < H && data[j * W + i] > 0;
    },
    texture() {
      if (tex) return tex;
      tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    },
  };
}
