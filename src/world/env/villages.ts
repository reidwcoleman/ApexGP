import * as THREE from 'three';
import type { WorldMap } from './worldmap.ts';
import type { Layout } from './layout.ts';
import { hash2i, rng } from './noise.ts';
import { US_ROOFS, US_WALLS } from './venues/austinLand.ts';
import { buildInterlagosCity } from './venues/interlagosCity.ts';
import { buildMontrealCity } from './venues/montrealCity.ts';
import { buildMexicoCity } from './venues/mexicoCity.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

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

// English villages: red brick and honey-coloured Northamptonshire stone under slate and tile
const WALLS_UK = [0x9a4f38, 0xa55a3f, 0x8c4632, 0xc9a66b, 0xbf9a62, 0xd8c9a8, 0xb06448].map((h) => new THREE.Color(h));
const ROOFS_UK = [0x4a4d52, 0x3d4045, 0x5a4a42, 0x7a3e2c, 0x44474c];

// Japanese towns: pale render, white and grey siding, dark brown timber under blue-grey kawara tile
const WALLS_JP = [0xe9e6de, 0xd9d6cf, 0xc8c4bb, 0xb9a891, 0xe2dccd, 0x8d8378, 0xf0eee8, 0xa7a39b].map((h) => new THREE.Color(h));
const ROOFS_JP = [0x3a4150, 0x2f3542, 0x4a5262, 0x55504a, 0x3b3f46, 0x6a4a3a];

// Styrian towns: white and pale-yellow render (Maria-Theresa yellow), dark-brown, red-brown and slate-grey roofs
const WALLS_AT = [0xf1eee6, 0xe9e4d6, 0xeadba8, 0xf0e2b8, 0xe4e0d8, 0xd9d3c6, 0xf3f0ea, 0xe8d5a0].map((h) => new THREE.Color(h));
const ROOFS_AT = [0x5a4436, 0x7b3a28, 0x4a4c50, 0x6a3024, 0x3f4145, 0x8a4a30];

// Dutch seaside town: dark red-brown brick, white-rendered villas, black glazed and red pantile roofs
const WALLS_NL = [0x8b4a36, 0x7a4231, 0x9c5a42, 0x6e3a2c, 0xa8664a, 0xefece4, 0xe4dfd2, 0x8b4a36].map((h) => new THREE.Color(h));
const ROOFS_NL = [0x2e2f33, 0x3a3b40, 0x9c4a30, 0x7a3b2a, 0x44464b, 0x8a4430];

// Mogyoród and the villages round the Hungaroring: white, cream, ochre and pale-yellow render, red clay tiles
const WALLS_HU = [0xf2efe7, 0xeee6cf, 0xe8d49a, 0xf1e3b4, 0xe9e1d2, 0xdcd3c1, 0xf5f2ec, 0xe2c98c].map((h) => new THREE.Color(h));
const ROOFS_HU = [0xa4482c, 0xb4532f, 0x8e3f28, 0x9c4a30, 0xb85c38, 0x6e3a2a];

// Melbourne's inner suburbs: Victorian terraces in red and cream brick, painted weatherboard and
// render, under grey corrugated iron, terracotta tile and slate
const WALLS_AU = [0x9a5a44, 0xa8674c, 0xd9ccb0, 0xe8e2d4, 0xc9b79a, 0xf1eee6, 0x8e4f3c, 0xbfae95].map((h) => new THREE.Color(h));
const ROOFS_AU = [0x8c9094, 0x7a7e82, 0x9fa3a6, 0xa4553a, 0x964a32, 0x4a4d52];

export function buildVillages(map: WorldMap, layout: Layout): VillagesBuild {
  if (map.venue === 'interlagos') return buildInterlagosCity(map, layout);
  if (map.venue === 'montreal') return buildMontrealCity(map);
  if (map.venue === 'mexico') return buildMexicoCity(map, layout);
  const uk = map.venue === 'airfield';
  const jp = map.venue === 'suzuka';
  const us = map.venue === 'austin';
  const at = map.venue === 'spielberg';
  const nl = map.venue === 'zandvoort';
  // Hungarian villages: whitewashed and pastel-rendered houses under red clay tiles
  const hu = map.venue === 'hungaroring';
  const au = map.venue === 'melbourne';
  const wallPal = au ? WALLS_AU : hu ? WALLS_HU : nl ? WALLS_NL : at ? WALLS_AT : us ? US_WALLS.map((h) => new THREE.Color(h)) : uk ? WALLS_UK : jp ? WALLS_JP : WALLS;
  const roofPal = au ? ROOFS_AU : hu ? ROOFS_HU : nl ? ROOFS_NL : at ? ROOFS_AT : us ? US_ROOFS : uk ? ROOFS_UK : jp ? ROOFS_JP : ROOFS;
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
      const block = big > (au ? 0.9 : hu ? 0.97 : at ? 0.94 : us ? 0.97 : uk ? 0.95 : jp ? 0.88 : 0.8); // condominio / mansion block
      const w = block ? 22 + big * 12 : 11 + hash2i(ix, iz, 8) * 10;
      const d = block ? 13 + hash2i(ix, iz, 10) * 6 : 9 + hash2i(ix, iz, 11) * 7;
      const h = block ? 14 + hash2i(ix, iz, 12) * 13 : hu ? 4 + hash2i(ix, iz, 13) * 3 : 6 + hash2i(ix, iz, 13) * 5; // (Hungarian village houses: one storey)
      list.push({
        x: px, z: pz, y: map.height(px, pz) - 0.3, w, d, h, rot: -ang,
        wall: wallPal[Math.floor(hash2i(ix, iz, 14) * wallPal.length)].clone().multiplyScalar(0.85 + r() * 0.2),
        roof: new THREE.Color(roofPal[Math.floor(hash2i(ix, iz, 15) * roofPal.length)]).multiplyScalar(0.85 + r() * 0.25),
        flat: block ? hash2i(ix, iz, 16) < 0.6 : hash2i(ix, iz, 16) < 0.12,
      });
    }
  // campanili at the village centres (no bell towers in Japan)
  for (const v of jp || us || at || hu ? [] : layout.villages) {
    const u = map.urban(v.x, v.z);
    if (u < 0.3 || v.x < S.x0 || v.x > S.x1 || v.z < S.z0 || v.z > S.z1) continue;
    list.push({ x: v.x, z: v.z, y: map.height(v.x, v.z) - 0.3, w: uk ? 6.5 : 5.5, d: uk ? 6.5 : 5.5, h: uk ? 20 + r() * 6 : 38 + r() * 12, rot: r(), wall: new THREE.Color(uk ? 0xb89a70 : 0xc79a78), roof: new THREE.Color(uk ? 0x4a4d52 : 0x8a3f28), flat: uk });
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
  /**
   * The façades, laid out per house in its own metres (not world stripes): storeys of 3 m, the
   * width split into whole window bays centred on each face, a deeper ground floor with a door in
   * one bay, sills; on many houses shutters either side of each window (green, brown or grey,
   * per house); a band of grime at the foot. The panes are dark glass that catches a little sky;
   * after dark a scatter of rooms is lit. Where a bay is smaller than a pixel or two the pattern
   * fades to its average, so a hillside of houses doesn't shimmer.
   */
  wallMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSignGlow = weatherUniforms.uSignGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\nvarying vec3 vSz;\nvarying vec3 vNl;\nvarying float vSeed;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
  vSz = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
  vLoc = transformed * vSz;
  vNl = objectNormal;
  vSeed = fract( instanceMatrix[ 3 ].x * 0.1311 + instanceMatrix[ 3 ].z * 0.0719 );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSignGlow;\nvarying vec3 vLoc;\nvarying vec3 vSz;\nvarying vec3 vNl;\nvarying float vSeed;\nvec3 vgLit = vec3( 0.0 );')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float side = 1.0 - smoothstep( 0.5, 0.9, abs( vNl.y ) );
  bool xFace = abs( vNl.x ) > 0.5;
  float along = xFace ? vLoc.z : vLoc.x;
  float wide = xFace ? vSz.z : vSz.x;
  float H = vSz.y, y = vLoc.y;
  float nb = max( 1.0, floor( wide / 3.3 ) );
  float bw = wide / nb;
  float ub = ( along + wide * 0.5 ) / bw;
  float u = fract( ub );
  float g0 = 3.6;
  float above = max( y - g0, 0.0 );
  float fl = y < g0 ? y / g0 : fract( above / 3.0 );
  float fi = y < g0 ? 0.0 : 1.0 + floor( above / 3.0 );
  float inside = side * step( 0.25, y ) * step( y, H - 0.9 );
  // windows: 40 % of the bay, 1.5 m tall; the ground floor's taller, a door in one bay
  float door = step( 0.5, fi < 0.5 ? 1.0 : 0.0 ) * step( abs( floor( ub ) - floor( nb * vSeed ) ), 0.5 );
  float win = step( 0.3, u ) * step( u, 0.7 ) * ( y < g0 ? step( door > 0.5 ? 0.0 : 0.3, fl ) * step( fl, 0.82 ) : step( 0.3, fl ) * step( fl, 0.82 ) ) * inside;
  float sill = step( 0.27, u ) * step( u, 0.73 ) * step( fl, 0.3 ) * step( 0.24, fl ) * ( 1.0 - door ) * inside * step( g0, y + 1.0 );
  float shut = step( 0.45, fract( vSeed * 7.3 ) ) * ( step( 0.15, u ) * step( u, 0.29 ) + step( 0.71, u ) * step( u, 0.85 ) ) * step( 0.3, fl ) * step( fl, 0.82 ) * inside * ( 1.0 - door ) * step( g0, y + 0.01 );
  vec3 shutC = fract( vSeed * 13.1 ) < 0.45 ? vec3( 0.12, 0.2, 0.13 ) : fract( vSeed * 13.1 ) < 0.75 ? vec3( 0.22, 0.14, 0.09 ) : vec3( 0.32, 0.33, 0.33 );
  // fade to the average where a bay is under ~2 pixels
  float fw = max( fwidth( ub ), fwidth( y / 3.0 ) );
  float k = 1.0 - smoothstep( 0.25, 0.6, fw );
  float room = floor( ub ) * 7.0 + fi * 3.0 + floor( vSeed * 97.0 );
  float lit = step( 0.62, fract( sin( room * 12.9898 ) * 43758.5453 ) );
  vec3 glassC = vec3( 0.05, 0.06, 0.075 ) + vec3( 0.03, 0.04, 0.05 ) * smoothstep( 0.4, 0.9, fl );
  vec3 c = diffuseColor.rgb;
  c = mix( c, c * 1.08, sill * k );
  c = mix( c, shutC, shut * 0.9 * k );
  c = mix( c, glassC, win * k );
  // (the far average: windows darken the wall by their share of it)
  c = mix( c, c * 0.8, ( 1.0 - k ) * inside * 0.9 );
  // grime at the foot, the eaves' shadow along the top
  c *= 1.0 - 0.18 * side * ( 1.0 - smoothstep( 0.0, 1.0, y ) );
  c *= 1.0 - 0.3 * side * smoothstep( H - 0.6, H - 0.05, y );
  // flat roofs are bitumen and gravel, not the wall's render
  c = mix( c, vec3( 0.2, 0.2, 0.19 ) * ( 0.85 + 0.3 * vSeed ), smoothstep( 0.5, 0.9, vNl.y ) );
  diffuseColor.rgb = c;
  float night = clamp( ( uSignGlow - 0.12 ) / 0.88, 0.0, 1.0 );
  vgLit = vec3( 1.0, 0.78, 0.5 ) * night * ( win * k * lit + ( 1.0 - k ) * inside * 0.12 ) * 0.7;
}`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vgLit;');
  };
  wallMat.customProgramCacheKey = () => 'apex-village-walls-v2';
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
