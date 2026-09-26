import * as THREE from 'three';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { fbm2, hash2i, rng, smoothstep } from '../noise.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import { INTERLAGOS_LAKES, estateDistance, lakeSdf, nearestWater, type LakeDef } from './interlagos.ts';
import { buildWaters, type Water } from '../water.ts';

/**
 * São Paulo round Interlagos, for the TV, helicopter and blimp cameras (and the glimpses
 * over the circuit wall): the zona sul's sea of small houses (whitewashed and pastel
 * render or bare brick under red ceramic tiles and grey concrete slabs, laid out on
 * street grids that change direction district by district), the favelas packed onto the
 * slopes and valleys (bare orange brick, a few painted fronts, flat roofs with blue water
 * tanks), the apartment towers standing in clusters over everything and thickening north
 * toward the centre, the Guarapiranga and Billings reservoirs and the lakes inside the
 * circuit, and queen palms.
 *
 * Cost: every building is one instance of one mesh (walls + a gable whose height is an
 * instance attribute), in 1 km tiles so the far ones can be culled and the low houses of
 * distant tiles dropped (the terrain's roof pattern carries on under them); towers in one
 * mesh; water one mesh per lake; palms two meshes. No shadows cast.
 */

export interface CityBuild {
  group: THREE.Group;
  count: number;
}

const C = (h: number) => new THREE.Color(h);
// render and paint: white, cream, pale yellow, salmon, sky, mint, grey; bare brick and block
const HOUSE_WALLS = [0xf1ede4, 0xe9e1cf, 0xefe3b8, 0xe8c9a8, 0xd7b28c, 0xc9d6dc, 0xcfe0cf, 0xbdb9b1, 0xf3e7d0, 0xb86b48, 0xe6d4a6, 0xd2a18a].map(C);
const HOUSE_ROOFS = [0xa5472c, 0x9b3f26, 0xb3563a, 0x8e3a22, 0xa94f33, 0xbd6446].map(C);
const SLAB_ROOFS = [0x8f8c86, 0x7c7a75, 0xa29e96, 0x6d6b67].map(C);
const FAVELA_WALLS = [0xb35f3b, 0xa9552f, 0xbe6a44, 0x9c4c2c, 0xb86a4a, 0x8f8b84, 0x9a958c, 0xd8c36a, 0x6f9fc0, 0xc97a7a, 0x86b27d, 0xe7e1d4, 0xc0703f].map(C);
const FAVELA_ROOFS = [0x7d7a74, 0x6a6863, 0x8c8880, 0x5c5a56, 0x8a5a44, 0x757f86].map(C);
const TOWER_WALLS = [0xeeeae2, 0xe4ddd0, 0xd9d4cb, 0xcfc6b6, 0xe8dcc4, 0xb8bec4, 0xd9c7b0, 0xc8d2d8, 0xa9b3ba, 0xf2efe8, 0xd6c0a6, 0x9fb0bf].map(C);

interface Bld {
  x: number; y: number; z: number;
  w: number; d: number; h: number;
  rot: number;
  wall: THREE.Color;
  roof: THREE.Color;
  /** gable rise (m); 0 = flat */
  rise: number;
  /** 0 house, 1 favela, 2 tower */
  kind: number;
}

// ---------------------------------------------------------------- geometry

/** unit building: walls (x, z ∈ ±0.5, y 0 … 1) + gable (ridge along x, lifted by aMisc.x in the shader) */
function buildingGeometry(): THREE.InstancedBufferGeometry {
  const pos: number[] = [], nor: number[] = [], part: number[] = [];
  const idx: number[] = [];
  const quad = (p: number[][], n: number[], roof: number, ridge: number[]) => {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      pos.push(...p[k]);
      nor.push(...n);
      part.push(roof, ridge[k]);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const tri = (p: number[][], n: number[], ridge: number[]) => {
    const b = pos.length / 3;
    for (let k = 0; k < 3; k++) {
      pos.push(...p[k]);
      nor.push(...n);
      part.push(0, ridge[k]);
    }
    idx.push(b, b + 1, b + 2);
  };
  const h = 0.5;
  const z4 = [0, 0, 0, 0];
  // walls (counter-clockwise seen from outside)
  quad([[-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h]], [0, 0, 1], 0, z4);
  quad([[h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h]], [0, 0, -1], 0, z4);
  quad([[h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h]], [1, 0, 0], 0, z4);
  quad([[-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h]], [-1, 0, 0], 0, z4);
  // (no flat top: a gable with no rise is the slab, overhanging a little)
  // gable: two slopes (roof) from the eaves (a little overhang) to the ridge, two end triangles (wall)
  const o = 0.56;
  const sn = 0.6, cn = 0.8;
  quad([[-o, 1, o], [o, 1, o], [o, 1, 0], [-o, 1, 0]], [0, cn, sn], 1, [0, 0, 1, 1]);
  quad([[o, 1, -o], [-o, 1, -o], [-o, 1, 0], [o, 1, 0]], [0, cn, -sn], 1, [0, 0, 1, 1]);
  tri([[h, 1, h], [h, 1, -h], [h, 1, 0]], [1, 0, 0], [0, 0, 1]);
  tri([[-h, 1, -h], [-h, 1, h], [-h, 1, 0]], [-1, 0, 0], [0, 0, 1]);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Lit building material: wall colour and roof colour per instance, the gable lifted by the
 * instance's rise, windows / balconies / floor slabs drawn from world position by kind.
 */
function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aPart;
attribute vec3 aWall;
attribute vec4 aRoof;
attribute vec4 aMisc;
varying vec3 vBCol;
varying vec3 vBW;
varying vec3 vBN;
varying float vBKind;
varying float vBRoof;
varying vec3 vBLocal;
varying vec3 vBSize;
varying vec3 vBLN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed.y += aPart.y * aMisc.x;
vBCol = mix( aWall, aRoof.rgb, aPart.x );
vBLN = normal;
vBKind = aMisc.y;
vBRoof = aPart.x;
vBLocal = transformed;
vBSize = vec3( aRoof.w, aMisc.zw );`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vBW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
vBN = normalize( mat3( modelMatrix * instanceMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBCol;
varying vec3 vBW;
varying vec3 vBN;
varying float vBKind;
varying float vBRoof;
varying vec3 vBLocal;
varying vec3 vBSize;
varying vec3 vBLN;
float bh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  diffuseColor.rgb = vBCol;
  float side = ( 1.0 - abs( vBN.y ) ) * ( 1.0 - vBRoof );
  // along-the-wall coordinate: local x or z scaled back to metres (instance scale in vBSize.yz)
  float useX = step( abs( vBLN.z ), abs( vBLN.x ) );
  float u = mix( vBLocal.x * vBSize.y, vBLocal.z * vBSize.z, useX );
  float y = vBLocal.y * vBSize.x;
  vec2 cellId = floor( vec2( u, y ) / vec2( 3.1, 2.9 ) );
  float lit = bh( cellId + floor( vBW.xz * 0.05 ) );
  vec3 glass = mix( vec3( 0.05, 0.06, 0.075 ), vec3( 0.16, 0.19, 0.23 ), lit );
  if ( vBKind > 1.5 ) {
    // towers: a window band on every floor, balcony slabs, a plain ground floor and top
    float fl = fract( y / 2.9 );
    float col = fract( u / 3.1 );
    float win = step( 0.28, fl ) * step( fl, 0.86 ) * step( 0.12, col ) * step( col, 0.88 );
    float slab = step( fl, 0.09 );
    float body = step( 3.5, y ) * step( y, vBSize.x - 2.0 );
    diffuseColor.rgb = mix( diffuseColor.rgb, glass, win * body * side * 0.9 );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.03, slab * body * side );
  } else {
    // houses and favela shacks: one or two windows per floor, a dark doorway band at the foot
    float fl = fract( y / 2.8 );
    float col = fract( u / mix( 4.2, 3.2, vBKind ) + 0.3 );
    float win = step( 0.4, fl ) * step( fl, 0.8 ) * step( 0.35, col ) * step( col, 0.72 ) * step( 1.0, y );
    diffuseColor.rgb = mix( diffuseColor.rgb, glass, win * side * 0.85 );
    // grime at the foot of the walls
    diffuseColor.rgb *= mix( 1.0, 0.8 + 0.2 * smoothstep( 0.0, 1.2, y ), side );
  }
  // roofs: tile courses on the gables, stained concrete on the slabs
  if ( vBRoof > 0.5 ) {
    float tile = fract( ( vBW.x * 0.37 + vBW.z * 0.61 ) * 3.0 );
    diffuseColor.rgb *= 0.9 + 0.12 * step( 0.5, tile ) + 0.08 * ( bh( floor( vBW.xz * 0.5 ) ) - 0.5 );
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-interlagos-buildings-v1';
  return mat;
}

function makeBuildingMesh(list: Bld[], geo: THREE.InstancedBufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const g = new THREE.InstancedBufferGeometry();
  for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
  g.setIndex(geo.index);
  const n = list.length;
  const m0 = new Float32Array(n * 4), m1 = new Float32Array(n * 4), m2 = new Float32Array(n * 4), m3 = new Float32Array(n * 4);
  const wall = new Float32Array(n * 3), roof = new Float32Array(n * 4), misc = new Float32Array(n * 4);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity, y0 = Infinity;
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    p.set(b.x, b.y, b.z);
    s.set(b.w, b.h, b.d);
    M.compose(p, q, s);
    const e = M.elements;
    m0.set([e[0], e[1], e[2], e[3]], i * 4);
    m1.set([e[4], e[5], e[6], e[7]], i * 4);
    m2.set([e[8], e[9], e[10], e[11]], i * 4);
    m3.set([e[12], e[13], e[14], e[15]], i * 4);
    wall.set([b.wall.r, b.wall.g, b.wall.b], i * 3);
    roof.set([b.roof.r, b.roof.g, b.roof.b, b.h], i * 4);
    // rise in unit-height space, kind, and the metre sizes the window pattern needs
    misc.set([b.rise / b.h, b.kind, b.w, b.d], i * 4);
    x0 = Math.min(x0, b.x - b.w); x1 = Math.max(x1, b.x + b.w);
    z0 = Math.min(z0, b.z - b.w); z1 = Math.max(z1, b.z + b.w);
    y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.h + b.rise);
  });
  // the shader's instanceMatrix comes from these four columns
  g.setAttribute('iM0', new THREE.InstancedBufferAttribute(m0, 4));
  g.setAttribute('iM1', new THREE.InstancedBufferAttribute(m1, 4));
  g.setAttribute('iM2', new THREE.InstancedBufferAttribute(m2, 4));
  g.setAttribute('iM3', new THREE.InstancedBufferAttribute(m3, 4));
  g.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 3));
  g.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 4));
  g.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
  g.instanceCount = n;
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------- placement

export function buildInterlagosCity(map: WorldMap, layout: Layout): CityBuild {
  void layout;
  const S = map.SQUARE;
  const c = map.A.center;
  const r = rng(9151);
  const houses: Bld[] = [];
  const towers: Bld[] = [];
  const wet = (x: number, z: number, m: number) => nearestWater(map, x, z).d < m;
  // foot of a building on a slope: the lowest corner (the walls run down into the ground)
  const foot = (x: number, z: number, r: number) => Math.min(map.height(x - r, z - r), map.height(x + r, z - r), map.height(x - r, z + r), map.height(x + r, z + r), map.height(x, z));

  // favela field: patches on the valley sides and near the water, 300 m – 3 km out
  const favela = (x: number, z: number, pd: number) => {
    const n = fbm2(x / 520 + 5.1, z / 520 - 8.3, 3) * 0.5 + 0.5;
    const valley = smoothstep(0.994, 0.975, map.slope(x, z, 8));
    return smoothstep(0.66, 0.72, n + 0.08 * valley) * smoothstep(150, 320, pd) * (1 - smoothstep(1500, 2200, pd));
  };
  // tower clusters (condomínios): thicker to the north, toward the centre of São Paulo
  const towerField = (x: number, z: number) => {
    const n = fbm2(x / 800 - 3.7, z / 800 + 1.9, 3) * 0.5 + 0.5;
    const north = smoothstep(0, -9000, z - c.z);
    return smoothstep(0.6 - 0.12 * north, 0.72 - 0.1 * north, n);
  };

  // ---- houses and favelas on the square
  {
    const G = 12;
    for (let z = S.z0 + 40; z < S.z1 - 40; z += G)
      for (let x = S.x0 + 40; x < S.x1 - 40; x += G) {
        const ix = Math.floor(x / G), iz = Math.floor(z / G);
        const pd = estateDistance(map, x, z);
        if (pd < 18) continue;
        const u = map.urban(x, z);
        if (u < 0.3) continue;
        // denser close to the circuit (what the cameras see), thinning further out (the terrain's roof
        // pattern carries on under the gaps)
        const keep = u * (pd < 900 ? 0.58 : pd < 2000 ? 0.26 : 0.1);
        const fv = favela(x, z, pd);
        if (fv > 0.5) {
          // favela: two shacks per cell (of the four 6 m plots), packed, twisted a little to the slope
          const base = hash2i(Math.floor(x / 96), Math.floor(z / 96), 4) * Math.PI;
          for (let a = 0; a < 2; a++)
            for (let b = 0; b < 2; b++) {
              const hh = hash2i(ix * 2 + a, iz * 2 + b, 21);
              if (hh > 0.5) continue;
              const px = x + (a - 0.5) * 6 + (hash2i(ix * 2 + a, iz * 2 + b, 22) - 0.5) * 1.6;
              const pz = z + (b - 0.5) * 6 + (hash2i(ix * 2 + a, iz * 2 + b, 23) - 0.5) * 1.6;
              if (map.excluded(px, pz, 2) || wet(px, pz, 8)) continue;
              const floors = 1 + Math.floor(hash2i(ix * 2 + a, iz * 2 + b, 24) * 3.2);
              houses.push({
                x: px, z: pz, y: foot(px, pz, 2.6) - 0.3,
                w: 4 + hash2i(ix * 2 + a, iz * 2 + b, 25) * 2.4, d: 4.2 + hash2i(ix * 2 + a, iz * 2 + b, 26) * 2.2,
                h: floors * 2.7 + 0.5, rot: base + (hash2i(ix * 2 + a, iz * 2 + b, 27) - 0.5) * 0.5,
                wall: FAVELA_WALLS[Math.floor(hash2i(ix * 2 + a, iz * 2 + b, 28) * FAVELA_WALLS.length)].clone().multiplyScalar(0.85 + r() * 0.25),
                roof: FAVELA_ROOFS[Math.floor(hash2i(ix * 2 + a, iz * 2 + b, 29) * FAVELA_ROOFS.length)].clone().multiplyScalar(0.8 + r() * 0.3),
                rise: 0, kind: 1,
              });
            }
          continue;
        }
        if (hash2i(ix, iz, 3) > keep) continue;
        // district street grids: the orientation changes every ~450 m; streets every 4–5 plots
        const ang = hash2i(Math.floor(x / 450), Math.floor(z / 450), 9) * Math.PI;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const lu = x * ca - z * sa, lv = x * sa + z * ca;
        const fu = ((lu % 62) + 62) % 62, fv2 = ((lv % 44) + 44) % 44;
        if (fu < 9 || fv2 < 8) continue;
        const px = x + (hash2i(ix, iz, 5) - 0.5) * 3, pz = z + (hash2i(ix, iz, 6) - 0.5) * 3;
        if (map.excluded(px, pz, 3) || wet(px, pz, 10)) continue;
        const big = hash2i(ix, iz, 7);
        const shop = big > 0.93; // a sobrado shop, a school, a small block of flats
        const floors = shop ? 3 + Math.floor(hash2i(ix, iz, 8) * 3) : big > 0.55 ? 2 : 1;
        const gable = !shop && hash2i(ix, iz, 16) < 0.62;
        const w = shop ? 14 + hash2i(ix, iz, 10) * 8 : 7.5 + hash2i(ix, iz, 11) * 3.5;
        const d = shop ? 12 + hash2i(ix, iz, 12) * 6 : 8 + hash2i(ix, iz, 13) * 3.5;
        houses.push({
          x: px, z: pz, y: foot(px, pz, Math.min(w, d) * 0.45) - 0.3,
          w, d, h: floors * 2.9 + 0.4, rot: -ang + (hash2i(ix, iz, 14) < 0.5 ? 0 : Math.PI / 2),
          wall: HOUSE_WALLS[Math.floor(hash2i(ix, iz, 15) * HOUSE_WALLS.length)].clone().multiplyScalar(0.86 + r() * 0.18),
          roof: (gable ? HOUSE_ROOFS[Math.floor(hash2i(ix, iz, 17) * HOUSE_ROOFS.length)] : SLAB_ROOFS[Math.floor(hash2i(ix, iz, 18) * SLAB_ROOFS.length)]).clone().multiplyScalar(0.85 + r() * 0.25),
          rise: gable ? Math.min(w, d) * 0.22 : 0, kind: 0,
        });
      }
  }

  // ---- towers: in the square (clear of the circuit's surroundings) and out to the horizon
  const addTower = (x: number, z: number, seed: number, tall: number) => {
    const hA = hash2i(Math.floor(x), Math.floor(z), seed);
    const floors = Math.round(9 + hA * 16 + tall * 10 * hash2i(Math.floor(x), Math.floor(z), seed + 1));
    const w = 16 + hash2i(Math.floor(x), Math.floor(z), seed + 2) * 12;
    const d = 14 + hash2i(Math.floor(x), Math.floor(z), seed + 3) * 10;
    const y = foot(x, z, Math.min(w, d) * 0.45) - 0.5;
    const rot = hash2i(Math.floor(x / 300), Math.floor(z / 300), seed + 4) * Math.PI + (hash2i(Math.floor(x), Math.floor(z), seed + 5) - 0.5) * 0.3;
    const wall = TOWER_WALLS[Math.floor(hash2i(Math.floor(x), Math.floor(z), seed + 6) * TOWER_WALLS.length)].clone().multiplyScalar(0.88 + r() * 0.16);
    const h = floors * 2.9 + 1.5;
    towers.push({ x, z, y, w, d, h, rot, wall, roof: SLAB_ROOFS[Math.floor(r() * SLAB_ROOFS.length)].clone(), rise: 0, kind: 2 });
    // the roof house: lift machinery and the water tanks
    towers.push({ x, z, y: y + h, w: w * 0.38, d: d * 0.45, h: 3.2 + r() * 2, rot, wall: wall.clone().multiplyScalar(0.92), roof: SLAB_ROOFS[0].clone(), rise: 0, kind: 0 });
  };
  {
    const G = 52;
    for (let z = S.z0 + 60; z < S.z1 - 60; z += G)
      for (let x = S.x0 + 60; x < S.x1 - 60; x += G) {
        const ix = Math.floor(x / G), iz = Math.floor(z / G);
        const px = x + (hash2i(ix, iz, 41) - 0.5) * G * 0.6, pz = z + (hash2i(ix, iz, 42) - 0.5) * G * 0.6;
        const pd = estateDistance(map, px, pz);
        if (pd < 260) continue;
        const tf = towerField(px, pz);
        if (tf < 0.05 || hash2i(ix, iz, 43) > tf * 0.55) continue;
        if (map.urban(px, pz) < 0.4 || wet(px, pz, 30) || map.excluded(px, pz, 16)) continue;
        // clear the houses under it
        addTower(px, pz, 51, smoothstep(600, 2600, pd));
      }
    // beyond the square: the city goes on to the horizon, the towers thickening toward the centre
    const F = map.FAR;
    const G2 = 150;
    for (let z = F.z0 + 1500; z < F.z1 - 1500; z += G2)
      for (let x = F.x0 + 1500; x < F.x1 - 1500; x += G2) {
        if (x > S.x0 - 100 && x < S.x1 + 100 && z > S.z0 - 100 && z < S.z1 + 100) continue;
        const ix = Math.floor(x / G2), iz = Math.floor(z / G2);
        const px = x + (hash2i(ix, iz, 61) - 0.5) * G2 * 0.8, pz = z + (hash2i(ix, iz, 62) - 0.5) * G2 * 0.8;
        const R = Math.hypot(px - c.x, pz - c.z);
        if (R > 13500) continue;
        const tf = towerField(px, pz);
        const north = smoothstep(2000, -11000, pz - c.z);
        const p = tf * (0.35 + 0.5 * north) * (1 - smoothstep(9000, 13500, R) * 0.6);
        if (hash2i(ix, iz, 63) > p) continue;
        if (wet(px, pz, 40)) continue;
        addTower(px, pz, 71, 0.4 + north);
        // downtown: a few more, taller, on the same block
        if (north > 0.7 && hash2i(ix, iz, 64) < 0.5) addTower(px + 45, pz - 30, 81, 1.4);
      }
  }
  // no houses under towers
  if (towers.length) {
    const hashT = new Set<number>();
    for (const t of towers) if (t.kind === 2) hashT.add(Math.floor(t.x / 20) * 100003 + Math.floor(t.z / 20));
    for (let i = houses.length - 1; i >= 0; i--) {
      const h = houses[i];
      let hit = false;
      for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1 && !hit; b++) hit = hashT.has((Math.floor(h.x / 20) + a) * 100003 + Math.floor(h.z / 20) + b);
      if (hit) houses[i] = houses[houses.length - 1], houses.pop();
    }
  }

  const group = new THREE.Group();
  group.name = 'SaoPaulo';
  const geo = buildingGeometry();
  const mat = buildingMaterial();
  patchInstanceMatrix(mat);
  // houses in 1 km tiles: whole tiles are culled by the frustum, and dropped beyond ~2.8 km
  const TILE = 1024;
  const tiles = new Map<number, Bld[]>();
  for (const b of houses) {
    const k = (Math.floor(b.x / TILE) + 64) * 128 + Math.floor(b.z / TILE) + 64;
    let a = tiles.get(k);
    if (!a) tiles.set(k, (a = []));
    a.push(b);
  }
  const houseMeshes: { mesh: THREE.Mesh; cx: number; cz: number }[] = [];
  for (const [k, list] of tiles) {
    const mesh = makeBuildingMesh(list, geo, mat, `houses_${k}`);
    group.add(mesh);
    houseMeshes.push({ mesh, cx: (Math.floor(k / 128) - 64 + 0.5) * TILE, cz: ((k % 128) - 64 + 0.5) * TILE });
  }
  if (towers.length) group.add(makeBuildingMesh(towers, geo, mat, 'towers'));

  // water
  const water = buildLakes(map);
  group.add(water.mesh);
  // palms
  const palms = buildPalms(map);
  group.add(palms);

  // distance culling of the low-house tiles (a zero-size helper that is always "rendered")
  const probe = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  probe.geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  probe.geometry.setDrawRange(0, 0);
  probe.frustumCulled = false;
  probe.name = 'city_lod_probe';
  let frame = 0;
  probe.onBeforeRender = (_r, _s, cam) => {
    water.update(weatherUniforms.uWeatherTime.value);
    if (frame++ % 10) return;
    const reach = 2900 + Math.max(0, cam.position.y - 60) * 4;
    for (const h of houseMeshes) {
      const d = Math.hypot(h.cx - cam.position.x, h.cz - cam.position.z);
      h.mesh.visible = d < reach;
    }
  };
  group.add(probe);
  return { group, count: houses.length + towers.length };
}

/** the building shader takes its instance matrix from four attributes (no InstancedMesh needed) */
function patchInstanceMatrix(mat: THREE.MeshStandardMaterial) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute vec4 iM0;
attribute vec4 iM1;
attribute vec4 iM2;
attribute vec4 iM3;
#define instanceMatrix mat4( iM0, iM1, iM2, iM3 )`,
    );
    // three only multiplies by instanceMatrix when USE_INSTANCING is on: do it ourselves
    sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3( instanceMatrix ) * ( objectNormal / vec3( dot( iM0.xyz, iM0.xyz ), dot( iM1.xyz, iM1.xyz ), dot( iM2.xyz, iM2.xyz ) ) );')
      .replace('#include <project_vertex>', 'transformed = ( instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\n#include <project_vertex>')
      .replace(
        'vBW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\nvBN = normalize( mat3( modelMatrix * instanceMatrix ) * objectNormal );',
        'vBW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvBN = normalize( mat3( modelMatrix ) * objectNormal );',
      );
  };
}

// ---------------------------------------------------------------- water

/**
 * A lake's shoreline as one closed polygon: the zero contour of its distance field
 * (marching squares on a grid, segments chained into loops, the biggest loop kept —
 * islands and stray puddles are left to the terrain).
 */
export function lakeOutline(map: WorldMap, L: LakeDef): { x: number; z: number }[] {
  const c = map.A.center;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const ch of L.arms ? [L.pts, ...L.arms] : [L.pts])
    for (const [x, z, rr] of ch) {
      x0 = Math.min(x0, x - rr); x1 = Math.max(x1, x + rr);
      z0 = Math.min(z0, z - rr); z1 = Math.max(z1, z + rr);
    }
  const pad = L.wobble * 2.2 + 30;
  x0 += c.x - pad; x1 += c.x + pad; z0 += c.z - pad; z1 += c.z + pad;
  const cell = L.wobble > 50 ? 40 : 2;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const sd = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
      sd[j * nx + i] = edge ? 1 : lakeSdf(L, x0 + i * cell, z0 + j * cell, c.x, c.z);
    }
  // edge points keyed by the grid edge they sit on; each cell links its crossing points in pairs
  const key = (i: number, j: number, h: number) => (j * nx + i) * 2 + h;
  const pt = new Map<number, { x: number; z: number }>();
  const nb = new Map<number, number[]>();
  const at = (i: number, j: number, h: number) => {
    const k = key(i, j, h);
    if (!pt.has(k)) {
      const a = sd[j * nx + i], b = h ? sd[(j + 1) * nx + i] : sd[j * nx + i + 1];
      const t = a / (a - b);
      pt.set(k, h ? { x: x0 + i * cell, z: z0 + (j + t) * cell } : { x: x0 + (i + t) * cell, z: z0 + j * cell });
    }
    return k;
  };
  const link = (a: number, b: number) => {
    (nb.get(a) ?? nb.set(a, []).get(a)!).push(b);
    (nb.get(b) ?? nb.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const v0 = sd[j * nx + i] < 0, v1 = sd[j * nx + i + 1] < 0, v2 = sd[(j + 1) * nx + i + 1] < 0, v3 = sd[(j + 1) * nx + i] < 0;
      const cut: number[] = [];
      if (v0 !== v1) cut.push(at(i, j, 0));
      if (v1 !== v2) cut.push(at(i + 1, j, 1));
      if (v2 !== v3) cut.push(at(i, j + 1, 0));
      if (v3 !== v0) cut.push(at(i, j, 1));
      if (cut.length === 2) link(cut[0], cut[1]);
      else if (cut.length === 4) {
        link(cut[0], cut[1]);
        link(cut[2], cut[3]);
      }
    }
  const seen = new Set<number>();
  let best: { x: number; z: number }[] = [];
  let bestA = 0;
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const loop: { x: number; z: number }[] = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(pt.get(cur)!);
      const n = nb.get(cur)!;
      const next = n[0] !== prev ? n[0] : n[1];
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    let area = 0;
    for (let k = 0; k < loop.length; k++) {
      const p = loop[k], q = loop[(k + 1) % loop.length];
      area += p.x * q.z - q.x * p.z;
    }
    if (Math.abs(area) > bestA) { bestA = Math.abs(area); best = loop; }
  }
  // thin the polyline (every 2 m on the ponds is far more than they need)
  const out: { x: number; z: number }[] = [];
  const minStep = L.wobble > 50 ? 30 : 2.5;
  for (const q of best) if (!out.length || Math.hypot(q.x - out[out.length - 1].x, q.z - out[out.length - 1].z) >= minStep) out.push(q);
  return out;
}

function buildLakes(map: WorldMap): Water {
  // the reservoirs: murky green-brown (algae), the circuit's ponds darker, clearer
  return buildWaters(
    INTERLAGOS_LAKES.map((L) => ({
      outline: lakeOutline(map, L),
      y: L.level,
      // (the ponds are still: no lapping foam, a muddy shallow edge)
      kind: L.wobble > 50 ? ('lake' as const) : ('basin' as const),
      deep: L.wobble > 50 ? ([0.016, 0.03, 0.026] as [number, number, number]) : ([0.012, 0.022, 0.017] as [number, number, number]),
      shallow: L.wobble > 50 ? ([0.05, 0.068, 0.042] as [number, number, number]) : ([0.045, 0.05, 0.03] as [number, number, number]),
      shore: L.wobble > 50 ? 0 : 5,
    })),
  );
}

// ---------------------------------------------------------------- palms

/** queen palms (jerivá): slender grey trunks, a crown of long arching feathery fronds */
function buildPalms(map: WorldMap): THREE.Group {
  const track = map.track;
  const spots: { x: number; z: number; s: number }[] = [];
  const r = rng(3311);
  const ok = (x: number, z: number) =>
    map.trackClearance(x, z) > 6 && !map.excluded(x, z, 2) && nearestWater(map, x, z).d > 3 && map.pathDistance(x, z).d > 1.5;
  const p = new THREE.Vector3();
  // along the service roads behind Setor A and the Curva do Sol
  for (const path of map.paths) {
    if (path.kind !== 2) continue;
    let acc = 0;
    for (let i = 0; i < path.pts.length - 1; i++) {
      const a = path.pts[i], b = path.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t < L; t += 1) {
        acc += 1;
        if (acc < 17) continue;
        acc = 0;
        const f = t / L;
        const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
        const side = r() < 0.5 ? -1 : 1;
        const off = path.width / 2 + 2.5;
        const x = a.x + (b.x - a.x) * f + nx * side * off, z = a.z + (b.z - a.z) * f + nz * side * off;
        if (ok(x, z)) spots.push({ x, z, s: 0.85 + r() * 0.35 });
      }
    }
  }
  // round the paddock and the lakes, clumps on the infield lawns and the city's streets
  const pit = track.pit;
  for (let s = pit.sStart; s <= pit.sEnd; s += 22) {
    track.point(s, pit.side * (138 + r() * 8), 0, p);
    if (ok(p.x, p.z)) spots.push({ x: p.x, z: p.z, s: 0.9 + r() * 0.3 });
  }
  const c = map.A.center;
  for (const L of INTERLAGOS_LAKES) {
    if (L.wobble > 50) continue;
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const [lx, lz, lr] = L.pts[Math.floor(r() * L.pts.length)];
      const x = c.x + lx + Math.cos(a) * (lr + 8 + r() * 10), z = c.z + lz + Math.sin(a) * (lr + 8 + r() * 10);
      if (ok(x, z) && lakeSdf(L, x, z, c.x, c.z) > 4) spots.push({ x, z, s: 0.8 + r() * 0.4 });
    }
  }
  for (let k = 0; k < 700; k++) {
    const s = r() * track.n;
    const side = r() < 0.5 ? -1 : 1;
    track.point(s, side * (track.barrierAt(s, side) + 14 + r() * 140), 0, p);
    if (map.forest(p.x, p.z) > 0.55) continue;
    if (fbm2(p.x / 160 + 2.2, p.z / 160 - 1.3, 2) < 0.15) continue;
    if (ok(p.x, p.z)) spots.push({ x: p.x, z: p.z, s: 0.75 + r() * 0.45 });
  }
  const S = map.SQUARE;
  for (let k = 0; k < 1400; k++) {
    const x = c.x + (r() - 0.5) * 3000, z = c.z + (r() - 0.5) * 3000;
    if (x < S.x0 || x > S.x1 || z < S.z0 || z > S.z1) continue;
    const pd = estateDistance(map, x, z);
    if (pd < 20 || map.urban(x, z) < 0.3) continue;
    if (hash2i(Math.floor(x / 9), Math.floor(z / 9), 91) > 0.5) continue;
    if (ok(x, z)) spots.push({ x, z, s: 0.8 + r() * 0.35 });
  }

  // geometry: trunk (8-sided taper, slight lean), crown of 11 fronds (arching strips, leaflet texture)
  const trunk = new THREE.CylinderGeometry(0.17, 0.24, 1, 5, 2, true);
  trunk.translate(0, 0.5, 0);
  const crown = frondCrown();
  const tex = frondTexture();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.95 });
  trunkMat.onBeforeCompile = (sh) => {
    // ring scars
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTY;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.86 + 0.14 * step( 0.5, fract( vTY * 34.0 ) );');
  };
  trunkMat.customProgramCacheKey = () => 'apex-palm-trunk';
  const leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.75, color: 0xffffff });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.35, side: THREE.DoubleSide });
  const n = spots.length;
  const tm = new THREE.InstancedMesh(trunk, trunkMat, Math.max(1, n));
  const cm = new THREE.InstancedMesh(crown, leafMat, Math.max(1, n));
  cm.customDepthMaterial = leafDepth;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const e = new THREE.Euler();
  const tint = new THREE.Color();
  spots.forEach((sp, i) => {
    const H = (10 + hash2i(Math.floor(sp.x * 3), Math.floor(sp.z * 3), 5) * 7) * sp.s;
    const y = map.height(sp.x, sp.z) - 0.2;
    const lean = (hash2i(Math.floor(sp.x * 3), Math.floor(sp.z * 3), 6) - 0.5) * 0.14;
    const yaw = hash2i(Math.floor(sp.x * 3), Math.floor(sp.z * 3), 7) * Math.PI * 2;
    e.set(lean, yaw, 0, 'YXZ');
    q.setFromEuler(e);
    ps.set(sp.x, y, sp.z);
    sc.set(sp.s, H, sp.s);
    M.compose(ps, q, sc);
    tm.setMatrixAt(i, M);
    // crown at the top of the (leaning) trunk
    const top = new THREE.Vector3(0, H, 0).applyQuaternion(q).add(ps);
    const cs = sp.s * (1.25 + hash2i(Math.floor(sp.x * 3), Math.floor(sp.z * 3), 8) * 0.3);
    sc.set(cs, cs, cs);
    M.compose(top, q, sc);
    cm.setMatrixAt(i, M);
    tint.setRGB(0.85 + r() * 0.25, 0.9 + r() * 0.2, 0.8 + r() * 0.2);
    cm.setColorAt(i, tint);
  });
  tm.count = cm.count = n;
  for (const m of [tm, cm]) {
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.receiveShadow = true;
  }
  if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  tm.castShadow = true;
  cm.castShadow = true;
  tm.name = 'palm_trunks';
  cm.name = 'palm_crowns';
  const g = new THREE.Group();
  g.name = 'Palms';
  g.add(tm, cm);
  return g;
}

/** 11 arching fronds (+ 3 young upright ones) around the crown point, each a strip of 5 segments */
function frondCrown(): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const add = (yaw: number, pitch: number, len: number, width: number, droop: number) => {
    const seg = 4;
    const base = pos.length / 3;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // rachis: leaves the crown at elevation `pitch`, bending down by `droop` (rad) to the tip
    let rx = 0, ry = 0;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      if (k > 0) {
        const th = Math.max(-1.35, pitch - droop * (t - 0.5 / seg));
        rx += Math.cos(th) * (len / seg);
        ry += Math.sin(th) * (len / seg);
      }
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * 0.5;
      // leaflets hang: the strip's edges droop a little below the rachis (a shallow V)
      for (const sgn of [-1, 1]) {
        pos.push(dir.x * rx + side.x * w * sgn, ry - w * 0.35, dir.z * rx + side.z * w * sgn);
        nor.push(0, 1, 0);
        uv.push(sgn < 0 ? 0 : 1, t);
      }
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };
  // the old fronds hang low, the middle ones arch out, the young ones stand up in the centre
  const N = 12;
  for (let i = 0; i < N; i++) {
    const yaw = (i / N) * Math.PI * 2 + (i % 2) * 0.22;
    const tier = i % 3;
    add(yaw, [0.25, 0.55, 0.85][tier], [5.2, 5.0, 4.4][tier] + ((i * 7) % 5) * 0.12, 2.0, [1.55, 1.3, 1.0][tier]);
  }
  for (let i = 0; i < 3; i++) add((i / 3) * Math.PI * 2 + 0.5, 1.2, 3.0, 1.2, 0.45);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // bias the normals upward: crowns light like foliage, not like flat strips
  const nr = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nr.count; i++) {
    const v = new THREE.Vector3(nr.getX(i), Math.abs(nr.getY(i)) + 0.8, nr.getZ(i)).normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** a frond seen flat: central rachis, long narrow leaflets angled toward the tip, gaps between them */
function frondTexture(): THREE.CanvasTexture {
  const W = 128, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const r = rng(77);
  ctx.lineCap = 'round';
  for (let y = 10; y < H - 4; y += 4.2) {
    const t = y / H;
    const len = W * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.04)) * (0.8 + r() * 0.25);
    for (const sgn of [-1, 1]) {
      const g = 0.75 + r() * 0.35;
      // darker at the rachis, sun-bleached toward the leaflet tips
      const grad = ctx.createLinearGradient(W / 2, y, W / 2 + sgn * len, y + len * 0.7);
      grad.addColorStop(0, `rgb(${Math.round(38 * g)},${Math.round(84 * g)},${Math.round(26 * g)})`);
      grad.addColorStop(1, `rgb(${Math.round(92 * g)},${Math.round(138 * g)},${Math.round(52 * g)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      // leaflets arch forward and hang a little
      ctx.quadraticCurveTo(W / 2 + sgn * len * 0.55, y + len * 0.2, W / 2 + sgn * len, y + len * 0.72 + (r() - 0.5) * 6);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#5d5a34';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- terrain look

/** São Paulo in November: lush rainy-season grass, red earth, terracotta roofs over the far city */
export function tuneInterlagosTerrain(uniforms: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    if (uniforms[k]) (uniforms[k].value as THREE.Color).set(hex);
  };
  set('uLawn', 0x55812f);
  set('uMeadow', 0x628538);
  set('uStraw', 0x8f8f4d);
  set('uGrassDark', 0x3a5f22);
  set('uEarth', 0x8e4a2c);
  set('uLitter', 0x4f3a26);
  set('uLitterDark', 0x2f2419);
  set('uMoss', 0x4b6a2a);
  set('uCanopy', 0x2f4d25);
  set('uRoof', 0xa24a30);
  set('uGravel', 0xb49a7c);
  set('uGravelDark', 0x8a6e55);
  if (uniforms.uCity) uniforms.uCity.value = 1;
}
