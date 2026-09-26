import * as THREE from 'three';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { fbm2, hash2i } from '../noise.ts';
import { MX_SITES } from './mexicoLand.ts';

/**
 * Mexico City round the Magdalena Mixiuhca, for the TV, helicopter and blimp cameras and the
 * glimpses over the stands: the endless carpet of flat-roofed two- and three-storey houses
 * (render painted every colour — pink, ochre, terracotta, sky blue, lime — or left as bare
 * grey block), wall to wall along a street grid that turns district by district, the black
 * water tanks (tinacos) on the roofs, the long five-storey blocks of the unidades
 * habitacionales, and a scatter of apartment towers. Beyond ~1.8 km the terrain's own roof
 * pattern and the horizon's skyline carry it on.
 *
 * Cost: one unit box instanced per building, in 1.5 km tiles (culled), one tank mesh per tile;
 * windows and roofs drawn in the shader; no shadows cast.
 */

export interface CityBuild {
  group: THREE.Group;
  count: number;
}

const C = (h: number) => new THREE.Color(h);
// painted render (saturated, sun-faded), bare block, white
const WALLS = [
  0xe8a0a8, 0xd9707a, 0xe7c26a, 0xd89a4a, 0xc86a44, 0x9fc5d8, 0x6fa7c8, 0xb8d078, 0x8cc3a4, 0xf0e6d2, 0xece8e0, 0xd8d2c4,
  0xa9a49b, 0x9a958c, 0xb7b1a6, 0xe4b390, 0xcf8f6c, 0xf2d7a0, 0xb7a6c9, 0xd2c09a,
].map(C);
// flat roofs: grey slab, red-oxide waterproofing, white-painted, tar
const ROOFS = [0x8e8a84, 0x7d7a75, 0x9c9891, 0xa04a36, 0xb05a40, 0x8e3e2e, 0xdedbd4, 0x55524e].map(C);
const BLOCKS = [0xe6ddc8, 0xd8cbb0, 0xc9b28c, 0xe0c9a6, 0xbfb6a8, 0xd9a07a].map(C);

interface Bld { x: number; y: number; z: number; w: number; d: number; h: number; rot: number; wall: THREE.Color; roof: THREE.Color; tank: boolean }

function cityMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRoof;\nvarying vec3 vRoof;\nvarying vec3 vCW;\nvarying vec3 vCN;\nvarying vec3 vCL;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvRoof = aRoof;\nvCW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\nvCN = normalize( mat3( modelMatrix * instanceMatrix ) * objectNormal );\nvCL = transformed;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoof;\nvarying vec3 vCW;\nvarying vec3 vCN;\nvarying vec3 vCL;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float up = step( 0.5, vCN.y );
  float side = 1.0 - up;
  // storeys of 2.9 m; windows (dark, barred) in bays along the facade
  float fl = fract( vCW.y / 2.9 );
  float along = abs( vCN.x ) > abs( vCN.z ) ? vCW.z : vCW.x;
  float bay = fract( along / 3.6 );
  float win = step( 0.38, fl ) * step( fl, 0.82 ) * step( 0.28, bay ) * step( bay, 0.72 );
  vec3 wallC = mix( diffuseColor.rgb, vec3( 0.07, 0.075, 0.08 ), win * 0.8 * side );
  // a parapet line round the roof's edge
  float edge = smoothstep( 0.47, 0.5, max( abs( vCL.x ), abs( vCL.z ) ) );
  vec3 roofC = mix( vRoof, vRoof * 0.7, edge );
  diffuseColor.rgb = mix( wallC, roofC, up );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-mx-city-v1';
  return mat;
}

export function buildMexicoCity(map: WorldMap, layout: Layout): CityBuild {
  void layout;
  const group = new THREE.Group();
  group.name = 'MexicoCity';
  const S = map.SQUARE;
  const TILE = 1536;
  const tiles = new Map<number, Bld[]>();
  const push = (b: Bld) => {
    const k = Math.floor((b.x - S.x0) / TILE) * 64 + Math.floor((b.z - S.z0) / TILE);
    let a = tiles.get(k);
    if (!a) tiles.set(k, (a = []));
    a.push(b);
  };
  let count = 0;
  // districts: each ~700 m patch has its own grid angle (mostly the city's north–south grid)
  const angleAt = (x: number, z: number) => {
    const hx = Math.floor(x / 700), hz = Math.floor(z / 700);
    const h = hash2i(hx, hz, 41);
    return h < 0.55 ? 0.03 : h < 0.75 ? -0.08 : h < 0.9 ? 0.26 : -0.35;
  };
  const CELL = 17;
  const seen = new Set<number>();
  for (let gz = S.z0 + 60; gz < S.z1 - 60; gz += CELL)
    for (let gx = S.x0 + 60; gx < S.x1 - 60; gx += CELL) {
      const pd = map.parkDistance(gx, gz);
      if (pd < 20 || pd > 1900) continue;
      const u = map.urban(gx, gz);
      if (u < 0.3) continue;
      // further out: sparser (the terrain's roofs fill in)
      const far = pd > 800;
      const ix = Math.round(gx / CELL), iz = Math.round(gz / CELL);
      if (far && hash2i(ix, iz, 3) > 0.55) continue;
      // local street grid: blocks of 5 × 3 lots with streets between
      const ang = angleAt(gx, gz);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const lx = gx * ca - gz * sa, lz = gx * sa + gz * ca;
      const bx = ((lx % 96) + 96) % 96, bz = ((lz % 62) + 62) % 62;
      if (bx < 12 || bz < 10) continue;
      // snap the lot to the local grid so neighbours line up wall to wall
      const cx = Math.floor(lx / 96) * 96 + 12 + Math.floor((bx - 12) / 16.8) * 16.8 + 8.4;
      const cz = Math.floor(lz / 62) * 62 + 10 + Math.floor((bz - 10) / 13) * 13 + 6.5;
      const x = cx * ca + cz * sa, z = -cx * sa + cz * ca;
      if (map.urban(x, z) < 0.3) continue;
      const key = Math.round(x) * 100003 + Math.round(z);
      if (seen.has(key)) continue;
      seen.add(key);
      const h1 = hash2i(ix, iz, 7), h2 = hash2i(ix, iz, 8), h3 = hash2i(ix, iz, 9);
      const via = Math.abs(z - MX_SITES.viaductoZ(x));
      // storeys: mostly 2–3, the odd 4–5; towers here and there, more toward the centre (north-west)
      const nw = Math.max(0, Math.min(1, (-x - z) / 5000));
      const tower = h1 > 0.9975 - 0.004 * nw && via > 60;
      const block = !tower && h1 > 0.975;
      let w: number, d: number, h: number;
      if (tower) { w = 20 + h2 * 10; d = 18 + h3 * 8; h = 36 + h2 * 50 + nw * 30; }
      else if (block) { w = 15.5; d = 12; h = 14.5; }
      else { w = 16.6; d = 12.8; h = 2.9 * (1 + Math.floor(h2 * h2 * 3.2)) + 0.6; }
      const pal = tower || block ? BLOCKS : WALLS;
      const wall = pal[Math.floor(hash2i(ix, iz, 14) * pal.length)].clone().multiplyScalar(0.86 + 0.2 * h3);
      const roof = ROOFS[Math.floor(hash2i(ix, iz, 15) * ROOFS.length)].clone().multiplyScalar(0.85 + 0.25 * h2);
      push({ x, y: map.height(x, z) - 0.4, z, w: w - 0.2, d: d - 0.2, h, rot: ang, wall, roof, tank: !tower && hash2i(ix, iz, 17) < 0.7 });
      count++;
    }

  const mat = cityMaterial();
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.55, metalness: 0 });
  const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.4, 8);
  tankGeo.translate(0, 0.7, 0);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [k, list] of tiles) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const roofs = new Float32Array(list.length * 3);
    list.forEach((b, i) => roofs.set([b.roof.r, b.roof.g, b.roof.b], i * 3));
    geo.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roofs, 3));
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const tanks = list.filter((b) => b.tank);
    const tm = new THREE.InstancedMesh(tankGeo, tankMat, Math.max(1, tanks.length));
    let nt = 0;
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      p.set(b.x, b.y, b.z);
      sc.set(b.w, b.h, b.d);
      M.compose(p, q, sc);
      im.setMatrixAt(i, M);
      im.setColorAt(i, b.wall);
      if (b.tank) {
        // a tank or two at a back corner of the roof
        const ox = b.w * 0.32, oz = -b.d * 0.3;
        const c = Math.cos(b.rot), s = Math.sin(b.rot);
        p.set(b.x + ox * c + oz * s, b.y + b.h, b.z - ox * s + oz * c);
        sc.set(1, 1, 1);
        M.compose(p, q, sc);
        tm.setMatrixAt(nt++, M);
      }
    });
    tm.count = nt;
    for (const m of [im, tm]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
    }
    im.name = `mx_city_${k}`;
    tm.name = `mx_tanks_${k}`;
    group.add(im);
    if (nt) group.add(tm);
  }
  void fbm2;
  return { group, count };
}
