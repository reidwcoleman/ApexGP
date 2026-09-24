import * as THREE from 'three';
import type { WorldMap } from './worldmap.ts';
import type { Layout } from './layout.ts';
import { hash2i, rng } from './noise.ts';

/**
 * The towns around the park wall (Monza, Villasanta, Biassono, Vedano…) as
 * low-cost silhouettes for the TV and aerial cameras: instanced Lombard houses
 * and apartment blocks (ochre / cream / terracotta render, tiled pitched roofs
 * or flat roofs) laid out along local street grids, plus campanili. Two draw
 * calls, no shadows — the trees hide all of it from the circuit itself.
 */

export interface VillagesBuild {
  group: THREE.Group;
  count: number;
}

const WALLS = [0xd8c7a0, 0xddd0b4, 0xcdb48a, 0xe3dccb, 0xd2ab86, 0xc4b69c, 0xe6ddca, 0xc9a07e].map((h) => new THREE.Color(h));
const ROOFS = [0x9a4a30, 0x8a3f28, 0xa95a3a, 0x7d3a26, 0x6e6a66];

export function buildVillages(map: WorldMap, layout: Layout): VillagesBuild {
  const S = map.SQUARE;
  const r = rng(515);
  type B = { x: number; z: number; y: number; w: number; d: number; h: number; rot: number; wall: THREE.Color; roof: THREE.Color; flat: boolean };
  const list: B[] = [];
  const C = 26;
  for (let z = S.z0 + 60; z < S.z1 - 60; z += C)
    for (let x = S.x0 + 60; x < S.x1 - 60; x += C) {
      const ix = Math.floor(x / C), iz = Math.floor(z / C);
      const u = map.urban(x, z);
      if (u < 0.35) continue;
      const pd = map.parkDistance(x, z);
      if (pd < 30 || pd > 2200) continue;
      if (hash2i(ix, iz, 3) > u * 0.42 * (1 - pd / 3000)) continue;
      // local street grid orientation (matches the ground pattern's blocks roughly)
      const ang = Math.floor(hash2i(Math.floor(x / 500), Math.floor(z / 500), 9) * 4) * 0.4 + 0.2;
      const jx = (hash2i(ix, iz, 5) - 0.5) * 6, jz = (hash2i(ix, iz, 6) - 0.5) * 6;
      const px = x + jx, pz = z + jz;
      const big = hash2i(ix, iz, 7);
      const block = big > 0.8; // condominio
      const w = block ? 22 + big * 12 : 11 + hash2i(ix, iz, 8) * 10;
      const d = block ? 13 + hash2i(ix, iz, 10) * 6 : 9 + hash2i(ix, iz, 11) * 7;
      const h = block ? 14 + hash2i(ix, iz, 12) * 13 : 6 + hash2i(ix, iz, 13) * 5;
      list.push({
        x: px, z: pz, y: map.height(px, pz) - 0.3, w, d, h, rot: -ang,
        wall: WALLS[Math.floor(hash2i(ix, iz, 14) * WALLS.length)].clone().multiplyScalar(0.85 + r() * 0.2),
        roof: new THREE.Color(ROOFS[Math.floor(hash2i(ix, iz, 15) * ROOFS.length)]).multiplyScalar(0.85 + r() * 0.25),
        flat: block ? hash2i(ix, iz, 16) < 0.6 : hash2i(ix, iz, 16) < 0.12,
      });
    }
  // campanili at the village centres
  for (const v of layout.villages) {
    const u = map.urban(v.x, v.z);
    if (u < 0.3 || v.x < S.x0 || v.x > S.x1 || v.z < S.z0 || v.z > S.z1) continue;
    list.push({ x: v.x, z: v.z, y: map.height(v.x, v.z) - 0.3, w: 5.5, d: 5.5, h: 38 + r() * 12, rot: r(), wall: new THREE.Color(0xc79a78), roof: new THREE.Color(0x8a3f28), flat: false });
  }

  // geometry: unit box (walls) and unit gable prism (roof) — scaled per instance
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const roof = new THREE.BufferGeometry();
  {
    // ridge along x; base at y=0, apex at y=1, overhang handled by instance scale
    const P = [
      [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 1, 0], [-0.5, 1, 0],
      [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [0.5, 1, 0],
      [-0.5, 0, 0.5], [-0.5, 0, -0.5], [-0.5, 1, 0],
      [0.5, 0, -0.5], [0.5, 0, 0.5], [0.5, 1, 0],
    ];
    const idx = [0, 3, 2, 0, 2, 1, 4, 7, 6, 4, 6, 5, 8, 10, 9, 11, 13, 12];
    roof.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
    roof.setIndex(idx);
    roof.computeVertexNormals();
  }
  const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  // windows: darker bands on the walls from world height (cheap)
  wallMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVW;\nvarying vec3 vVN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvVW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\nvVN = normalize( mat3( modelMatrix * instanceMatrix ) * objectNormal );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVW;\nvarying vec3 vVN;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float side = 1.0 - abs( vVN.y );
  float fl = fract( vVW.y / 3.1 );
  float col = fract( ( vVW.x + vVW.z ) / 3.4 );
  float win = step( 0.35, fl ) * step( fl, 0.8 ) * step( 0.3, col ) * step( col, 0.7 ) * side * step( 1.5, vVW.y - 0.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.06, 0.07, 0.08 ), win * 0.85 );
}`,
      );
  };
  wallMat.customProgramCacheKey = () => 'apex-village-walls';
  const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const walls = new THREE.InstancedMesh(box, wallMat, Math.max(1, list.length));
  const roofs = new THREE.InstancedMesh(roof, roofMat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let nr = 0;
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    p.set(b.x, b.y, b.z);
    s.set(b.w, b.h, b.d);
    m.compose(p, q, s);
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, b.wall);
    if (!b.flat) {
      const tower = b.w < 6;
      p.set(b.x, b.y + b.h, b.z);
      s.set(b.w + (tower ? 0.3 : 1.0), tower ? 5 : Math.min(b.d, b.w) * 0.32, b.d + (tower ? 0.3 : 1.0));
      m.compose(p, q, s);
      roofs.setMatrixAt(nr, m);
      roofs.setColorAt(nr, b.roof);
      nr++;
    }
  });
  walls.count = list.length;
  roofs.count = nr;
  for (const im of [walls, roofs]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = false;
    im.receiveShadow = false;
  }
  walls.name = 'village_walls';
  roofs.name = 'village_roofs';
  const group = new THREE.Group();
  group.name = 'Villages';
  group.add(walls, roofs);
  return { group, count: list.length };
}
