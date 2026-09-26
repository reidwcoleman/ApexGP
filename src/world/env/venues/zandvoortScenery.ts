import * as THREE from 'three';
import { MeshBuilder, srgb } from '../geom.ts';
import { hash2i, rng } from '../noise.ts';
import { aerialUniforms } from '../fog.ts';
import { buildWater, seaPolygon } from '../water.ts';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import type { TerrainBuild } from '../terrain.ts';
import type { SceneryLight } from '../scenery.ts';
import type { ZandvoortLayout } from './zandvoort.ts';
import { COAST_OFF, SEA_Y, coastCoords, coastPoint, zandvoortGeo } from './zandvoortLand.ts';

/**
 * Zandvoort's scenery beyond the circuit:
 *
 *   the North Sea    the shared water.ts sea (seaPolygon at SEA_Y west of the waterline) plus a
 *                    surf strip of our own: breaker lines over the sand bars, lace, swash
 *   the beach        pavilions (strandpaviljoens) on stilts along the sand
 *   the town         the boulevard's apartment slabs and towers, the old water tower on its dune
 *                    (the town's houses come from villages.ts with the Dutch palette)
 *   the dunes        marram grass tussocks round the circuit (one instanced draw, wind sway,
 *                    faded out beyond ~190 m) and the sand/marram terrain look
 *   the Orange Army  orange smoke flares drifting off the stands (one instanced draw)
 *   offshore         a wind farm and a few ships on the horizon
 *
 * Draw calls: sea 1 + surf 1, buildings 3, tussocks 1, flares 1, offshore 1.
 */

export interface ZandvoortSceneryBuild {
  group: THREE.Group;
  update(elapsed: number, camera: THREE.Camera): void;
  setLight(l: SceneryLight): void;
  stats: Record<string, number>;
}

// ---------------------------------------------------------------------------- terrain look

const DUNE_ANCHOR = 'vec3 col = mix( grass, floorC, forest );';

const DUNE_GLSL = /* glsl */ `
if ( uDuneOn > 0.5 ) {
  // dunes and beach all the way round: no farmland
  park = 1.0;
  float cIn = uCoastOff - dot( p - uCoastP, uCoastN );
  float slopeD = 1.0 - clamp( normalize( vWNormal ).y, 0.0, 1.0 );
  // pale dry sand with wind ripples; wet and dark along the water's edge; a drift line of shells
  float rip = sin( dot( p, vec2( 0.83, 0.55 ) ) * 2.4 + d1 * 5.0 ) * 0.5 + 0.5;
  vec3 sandC = uSand * ( 0.9 + 0.12 * d2 + 0.1 * m3 ) * ( 1.0 - 0.07 * rip * nearF );
  sandC = mix( sandC, uSandWet * ( 0.9 + 0.12 * d1 ), smoothstep( 18.0, -8.0, cIn ) );
  sandC *= 1.0 - 0.14 * ( 1.0 - smoothstep( 0.0, 2.5, abs( cIn - 26.0 - 7.0 * m2 ) ) ) * step( 0.35, d2 );
  // marram grass: grey-green tussocks with straw tips, the sand showing between them
  float tuft = smoothstep( 0.38, 0.72, d3 * 0.65 + d2 * 0.35 );
  vec3 marram = mix( uMarram, uMarramDry, smoothstep( 0.35, 0.8, m2 * 0.6 + d1 * 0.4 ) ) * ( 0.8 + 0.32 * d2 );
  // grey dunes: older, mossy and lichen-covered hollows, darker than the young marram
  marram = mix( marram, vec3( 0.045, 0.055, 0.035 ), smoothstep( 0.5, 0.75, m1 * 0.7 + m3 * 0.3 ) * 0.55 );
  float cover = smoothstep( 0.12, 0.42, m1 * 0.45 + m3 * 0.35 + d1 * 0.2 + 0.05 );
  // bare blowouts: the steep faces, wind-scoured patches, the beach and the foredune's sea face
  cover *= 1.0 - smoothstep( 0.16, 0.36, slopeD );
  float blow = smoothstep( 0.58, 0.64, m2 * 0.55 + m3 * 0.3 + d1 * 0.15 );
  cover *= 1.0 - blow * 0.92;
  cover *= smoothstep( 92.0, 175.0, cIn );
  float grassAmt = cover * mix( mix( 0.72, 1.0, tuft ), 0.92, farF );
  vec3 dune = mix( sandC, marram, grassAmt );
  float duneW = ( 1.0 - lawn * 0.65 ) * ( 1.0 - smoothstep( 0.3, 0.7, paved ) ) * ( 1.0 - forest * 0.75 );
  col = mix( col, dune, duneW );
}
`;

/** coastal colours for the verges and paths, and the sand/marram dune look on the terrain */
export function zandvoortTerrainLook(t: TerrainBuild, map: WorldMap) {
  const u = t.uniforms;
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x5e7340);
  set('uMeadow', 0x7c8456);
  set('uStraw', 0xb4a778);
  set('uGrassDark', 0x505c38);
  set('uGravel', 0xd2c19b);
  set('uGravelDark', 0xa99776);
  set('uEarth', 0xb29b75);
  set('uLitter', 0x6d5a40);
  set('uLitterDark', 0x3f3527);
  set('uMoss', 0x57603a);
  set('uCanopy', 0x2f4029);
  set('uRoof', 0x6a3a2c);
  const g = zandvoortGeo(map);
  const du: Record<string, THREE.IUniform> = {
    uDuneOn: { value: 1 },
    uCoastP: { value: new THREE.Vector2(g.px, g.pz) },
    uCoastN: { value: new THREE.Vector2(g.nx, g.nz) },
    uCoastOff: { value: COAST_OFF },
    uSand: { value: srgb(0xd6c49c) },
    uSandWet: { value: srgb(0x9a876a) },
    uMarram: { value: srgb(0x43552f) },
    uMarramDry: { value: srgb(0x7b7a52) },
  };
  const mat = t.material;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (!sh.fragmentShader.includes(DUNE_ANCHOR)) {
      console.warn('[zandvoort] terrain shader anchor not found — no dune look');
      return;
    }
    Object.assign(sh.uniforms, du);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uDuneOn, uCoastOff;\nuniform vec2 uCoastP, uCoastN;\nuniform vec3 uSand, uSandWet, uMarram, uMarramDry;\nvoid main() {')
      .replace(DUNE_ANCHOR, DUNE_ANCHOR + DUNE_GLSL);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '-zandvoort-dunes';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------- the sea

/**
 * The North Sea: the shared water surface (water.ts: Fresnel sky, glitter, ripples, rain rings,
 * the swash lapping along its edge) over the half-plane beyond the waterline, plus a surf strip
 * of our own on top: breaker lines rolling in over the sand bars, broken up along the beach.
 */
function buildSea(map: WorldMap, uTime: THREE.IUniform): { group: THREE.Group; update(t: number): void } {
  const g = zandvoortGeo(map);
  const group = new THREE.Group();
  group.name = 'zandvoort_sea';
  const edge = coastPoint(map, 0, 2);
  const bearing = (Math.atan2(g.nx, -g.nz) * 180) / Math.PI;
  const water = buildWater({ outline: seaPolygon(edge, bearing, 30000), y: SEA_Y, kind: 'sea', shore: 16, deep: [0.01, 0.024, 0.03], shallow: [0.045, 0.08, 0.07] });
  group.add(water.mesh);

  // the surf strip: c from −170 (the outer bar) to −7 (just past the waterline), 12 km along the beach
  const pos: number[] = [];
  const idx: number[] = [];
  const NA = 60;
  for (let k = 0; k <= NA; k++) {
    const a = -6000 + (12000 * k) / NA;
    for (const c of [-170, -1]) {
      const q = coastPoint(map, a, c);
      pos.push(q.x, SEA_Y + 0.02, q.z);
    }
    if (k < NA) {
      const b = k * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
  geo.setIndex(idx);
  // make every triangle face up
  {
    const P = geo.attributes.position as THREE.BufferAttribute;
    const I = geo.index!;
    for (let t = 0; t < I.count; t += 3) {
      const a = I.getX(t), b = I.getX(t + 1), c = I.getX(t + 2);
      const cr = (P.getX(b) - P.getX(a)) * (P.getZ(c) - P.getZ(a)) - (P.getZ(b) - P.getZ(a)) * (P.getX(c) - P.getX(a));
      if (cr > 0) { I.setX(t + 1, c); I.setX(t + 2, b); }
    }
  }
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe9ece6, roughness: 0.85, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const su: Record<string, THREE.IUniform> = {
    uSeaTime: uTime,
    uCoastP: { value: new THREE.Vector2(g.px, g.pz) },
    uCoastN: { value: new THREE.Vector2(g.nx, g.nz) },
    uCoastT: { value: new THREE.Vector2(g.tx, g.tz) },
    uCoastOff: { value: COAST_OFF },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, su);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSeaW;
uniform float uSeaTime, uCoastOff;
uniform vec2 uCoastP, uCoastN, uCoastT;
float sh21( vec2 q ) { return fract( sin( dot( q, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float sNoise( vec2 q ) {
  vec2 i = floor( q ), f = fract( q );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sh21( i ), sh21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( sh21( i + vec2( 0.0, 1.0 ) ), sh21( i + vec2( 1.0 ) ), f.x ), f.y );
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 P = vSeaW.xz;
  float t = uSeaTime;
  float dist = length( vSeaW - cameraPosition );
  float cIn = uCoastOff - dot( P - uCoastP, uCoastN );
  float along = dot( P - uCoastP, uCoastT );
  // breaker lines rolling in toward the beach, a little wavy along it
  float jitter = sNoise( vec2( along * 0.03, 3.1 ) ) * 6.0 + sNoise( vec2( along * 0.11, 7.7 ) ) * 2.5;
  float ph = ( cIn + jitter ) / 38.0 + t * 0.04;
  float fp = fract( ph );
  // a sharp front and a trail of dissolving foam behind it
  float band = smoothstep( 0.8, 0.975, fp ) * ( 1.0 - smoothstep( 0.975, 1.0, fp ) );
  float surf = smoothstep( -150.0, -55.0, cIn );
  // broken up along the beach: each line breaks in its own stretches
  float streak = smoothstep( 0.4, 0.75, sNoise( vec2( along * 0.035 + floor( ph ) * 7.3, floor( ph ) * 1.7 ) ) * 0.75 + sNoise( vec2( along * 0.2, cIn * 0.4 ) ) * 0.25 );
  // foam lace left behind on the water between the lines
  vec2 lq = vec2( along * 0.09, cIn * 0.16 ) + vec2( t * 0.03, -t * 0.08 );
  float lace = smoothstep( 0.6, 0.85, sNoise( lq ) * 0.6 + sNoise( lq * 2.7 + 3.3 ) * 0.4 );
  float a = band * surf * streak + lace * surf * 0.16 * ( 1.0 - fp );
  a *= smoothstep( -170.0, -130.0, cIn ) * ( 1.0 - smoothstep( 900.0, 2600.0, dist ) );
  diffuseColor.a *= clamp( a, 0.0, 0.92 );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'zandvoort-surf-v1';
  const surfMesh = new THREE.Mesh(geo, mat);
  surfMesh.name = 'zandvoort_surf';
  surfMesh.renderOrder = 2;
  surfMesh.receiveShadow = true;
  group.add(surfMesh);
  return { group, update: (t) => water.update(t) };
}

// ---------------------------------------------------------------------------- helpers

class Local {
  readonly m = new THREE.Matrix4();
  constructor(x: number, y: number, z: number, rot: number) {
    this.m.makeRotationY(rot).setPosition(x, y, z);
  }
}

function localBox(mb: MeshBuilder, L: Local, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) {
  const lm = new MeshBuilder();
  lm.aabb(x0, y0, z0, x1, y1, z1, c);
  lm.transform(L.m);
  mb.append(lm);
}

/** n-sided frustum (flat-shaded) from y0 (radius r0) to y1 (radius r1), in local space */
function frustum(mb: MeshBuilder, L: Local, n: number, y0: number, r0: number, y1: number, r1: number, c: THREE.Color, cap = true, rot = Math.PI / 8) {
  const lm = new MeshBuilder();
  const P = (a: number, y: number, r: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  for (let i = 0; i < n; i++) {
    const a0 = rot + (i / n) * Math.PI * 2, a1 = rot + ((i + 1) / n) * Math.PI * 2;
    lm.quad4(P(a1, y0, r0), P(a0, y0, r0), P(a0, y1, r1), P(a1, y1, r1), c);
  }
  if (cap && r1 > 0.01) {
    const ci = lm.vertex(0, y1, 0, 0, 1, 0, c);
    const ids: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ids.push(lm.vertex(Math.cos(a) * r1, y1, Math.sin(a) * r1, 0, 1, 0, c));
    }
    for (let i = 0; i < n; i++) lm.idx.push(ci, ids[i + 1], ids[i]);
  }
  lm.transform(L.m);
  mb.append(lm);
}

/** building facades: floors of windows and balcony bands, in world space along the coast */
function facadeMaterial(tx: number, tz: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFacT = { value: new THREE.Vector2(tx, tz) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;\nvarying vec3 vFN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvFN = normalize( mat3( modelMatrix ) * objectNormal );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;\nvarying vec3 vFN;\nuniform vec2 uFacT;\nfloat facWin;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float wall = 1.0 - abs( vFN.y );
  float fl = fract( vFW.y / 2.95 );
  vec2 fn = normalize( vFN.xz + 1e-4 );
  // the horizontal coordinate along whichever face this is
  float u = abs( fn.x * uFacT.y - fn.y * uFacT.x ) > 0.5 ? dot( vFW.xz, uFacT ) : dot( vFW.xz, vec2( -uFacT.y, uFacT.x ) );
  float cl = fract( u / 3.3 );
  facWin = step( 0.28, fl ) * step( fl, 0.86 ) * step( 0.16, cl ) * step( cl, 0.84 ) * wall;
  float balcony = step( fl, 0.12 ) * wall;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.12 + 0.03, balcony * 0.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.07, 0.09 ), facWin * 0.82 );
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.12, facWin );');
  };
  m.customProgramCacheKey = () => 'zandvoort-facade-v1';
  return m;
}

// ---------------------------------------------------------------------------- landmarks

function buildTown(map: WorldMap, solid: MeshBuilder, facade: MeshBuilder, r: () => number) {
  const g = zandvoortGeo(map);
  const coastYaw = Math.atan2(g.tx, g.tz);
  const H = (x: number, z: number) => map.height(x, z);

  // -- the boulevard: apartment slabs and towers along the top of the beach (Boulevard Paulus Loot,
  //    Boulevard Barnaart), long sides facing the sea
  const CREAM = [0xece6d6, 0xe2dccb, 0xf2efe6, 0xd9d1bf, 0xc9c2b3, 0xb8b2a6].map(srgb);
  const BRICK = [0x8a4a35, 0x7a4030, 0x9a5a42].map(srgb);
  const slabs: [number, number, number, number, number][] = [
    // a, c (inland), length, depth, height
    [-820, 128, 46, 14, 24], [-920, 132, 60, 14, 33], [-1030, 126, 40, 13, 27], [-1140, 136, 52, 14, 39],
    [-1270, 140, 30, 22, 58], [-1390, 132, 56, 14, 30], [-1500, 128, 44, 14, 36], [-1610, 136, 62, 15, 27],
    [-1730, 130, 38, 14, 45], [-1850, 138, 58, 14, 24], [-1990, 132, 50, 14, 33], [-2130, 128, 44, 14, 21],
    [-2260, 136, 60, 14, 27], [-2400, 132, 40, 13, 18],
  ];
  for (const [a, c, len, dep, h] of slabs) {
    const q = coastPoint(map, a, c);
    const y0 = Math.min(H(q.x - 8, q.z), H(q.x + 8, q.z), H(q.x, q.z - 8), H(q.x, q.z + 8)) - 0.5;
    const L = new Local(q.x, y0, q.z, coastYaw);
    const col = h > 50 ? srgb(0xd8d6cf) : r() < 0.2 ? BRICK[Math.floor(r() * BRICK.length)] : CREAM[Math.floor(r() * CREAM.length)];
    localBox(facade, L, -dep / 2, 0, -len / 2, dep / 2, h, len / 2, col);
    // plinth of shops, the roof plant room
    localBox(solid, L, -dep / 2 - 0.6, 0, -len / 2 - 0.3, dep / 2 + 0.6, 3.4, len / 2 + 0.3, srgb(0x6f6a62));
    localBox(solid, L, -dep / 4, h, -len / 5, dep / 4, h + 2.6, len / 5, srgb(0x9a968e));
  }

  // -- the old water tower (1897) on its dune in the town: an octagonal brick shaft, the tank
  //    storey with its round-arched windows, a steep slate roof, lantern and spire
  {
    let best = { x: 0, z: 0, h: -1e9 };
    for (let k = 0; k < 40; k++) {
      const q = coastPoint(map, -1500 + (r() - 0.5) * 360, 760 + (r() - 0.5) * 300);
      const h = H(q.x, q.z);
      if (h > best.h) best = { x: q.x, z: q.z, h };
    }
    const y0 = best.h - 0.6;
    const L = new Local(best.x, y0, best.z, coastYaw);
    const brick = srgb(0x8b4632), brickL = srgb(0xa45a3e), stone = srgb(0xe4dccb), slate = srgb(0x34373d);
    frustum(solid, L, 8, 0, 5.6, 1.4, 5.6, stone, false);
    frustum(solid, L, 8, 1.4, 5.3, 29, 4.7, brick, false);
    // pilaster bands and the corbel ring
    for (const y of [9, 18.5]) frustum(solid, L, 8, y, 4.95, y + 0.5, 4.95, stone, false);
    frustum(solid, L, 8, 29, 4.7, 30.4, 6.3, stone, true);
    frustum(solid, L, 8, 30.4, 6.2, 37.2, 6.2, brickL, false);
    frustum(solid, L, 8, 36.2, 6.3, 37.4, 6.5, stone, true);
    // tall arched windows of the tank storey (dark insets on each face)
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2 + Math.PI / 8;
      const lm = new MeshBuilder();
      lm.aabb(-0.7, 31.4, -0.1, 0.7, 35.6, 0.1, srgb(0x1c1f24));
      lm.transform(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(Math.cos(a) * 5.95, 0, Math.sin(a) * 5.95));
      lm.transform(L.m);
      solid.append(lm);
      // narrow slit windows up the shaft
      const lm2 = new MeshBuilder();
      lm2.aabb(-0.28, 11, -0.1, 0.28, 15, 0.1, srgb(0x1c1f24));
      lm2.aabb(-0.28, 21, -0.1, 0.28, 25, 0.1, srgb(0x1c1f24));
      lm2.transform(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(Math.cos(a) * 4.8, 0, Math.sin(a) * 4.8));
      lm2.transform(L.m);
      solid.append(lm2);
    }
    frustum(solid, L, 8, 37.4, 6.6, 45.5, 1.6, slate, false);
    frustum(solid, L, 8, 45.5, 1.5, 48, 1.5, stone, true);
    frustum(solid, L, 8, 48, 1.7, 51.5, 0.08, slate, false);
    map.exclusions.push({ cx: best.x, cz: best.z, halfW: 8, halfL: 8, angle: 0 });
  }

  // -- beach pavilions on stilts along the sand, with their terraces and windbreaks
  const WOOD = [0x8a6a4a, 0x9c7b56, 0x6f5540, 0xe9e6de, 0xf2f0ea].map(srgb);
  const ACC = [0xff7b00, 0x21468b, 0x2f7d5b, 0xc8102e, 0x2a9fd6, 0xf2c200].map(srgb);
  for (let a = -3000; a <= 2600; a += 150 + r() * 110) {
    const c = 46 + r() * 8;
    const q = coastPoint(map, a, c);
    const gy = H(q.x, q.z);
    const L = new Local(q.x, gy, q.z, coastYaw);
    const w = 11 + r() * 5, len = 20 + r() * 10, deck = 1.4 + r() * 0.5;
    const wood = WOOD[Math.floor(r() * WOOD.length)];
    const acc = ACC[Math.floor(r() * ACC.length)];
    for (const sx of [-w / 2 + 0.4, w / 2 - 0.4]) for (let sz = -len / 2 + 0.5; sz <= len / 2; sz += 4) localBox(solid, L, sx - 0.15, -1, sz - 0.15, sx + 0.15, deck, sz + 0.15, srgb(0x5a4a3a));
    localBox(solid, L, -w / 2 - 3, deck, -len / 2, w / 2 + 1, deck + 0.3, len / 2, srgb(0x7a6a58));
    localBox(solid, L, -w / 2 + 2.5, deck + 0.3, -len / 2 + 1, w / 2 - 0.5, deck + 4.2, len / 2 - 1, wood);
    localBox(solid, L, -w / 2 + 2, deck + 4.2, -len / 2 + 0.5, w / 2, deck + 4.6, len / 2 - 0.5, acc);
    // glass front toward the sea (dark band)
    localBox(solid, L, -w / 2 + 2.4, deck + 1.2, -len / 2 + 1.5, -w / 2 + 2.5, deck + 3.6, len / 2 - 1.5, srgb(0x243038));
    // terrace windbreak screens
    localBox(solid, L, -w / 2 - 3, deck + 0.3, -len / 2, -w / 2 - 2.9, deck + 1.5, len / 2, srgb(0xdfe3e6));
  }

  // -- a lifeguard post and the beach poles
  for (let a = -2400; a <= 2400; a += 800) {
    const q = coastPoint(map, a + 60, 30);
    const L = new Local(q.x, H(q.x, q.z), q.z, coastYaw);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) localBox(solid, L, sx * 1.2 - 0.1, -0.5, sz * 1.2 - 0.1, sx * 1.2 + 0.1, 4.2, sz * 1.2 + 0.1, srgb(0xf0f0ee));
    localBox(solid, L, -1.5, 4.2, -1.5, 1.5, 6.4, 1.5, srgb(0xe9731a));
    localBox(solid, L, -1.7, 6.4, -1.7, 1.7, 6.7, 1.7, srgb(0xf4f4f2));
  }
}

function buildOffshore(map: WorldMap, mb: MeshBuilder, r: () => number) {
  const g = zandvoortGeo(map);
  const yaw = Math.atan2(g.tx, g.tz);
  const WHITE = srgb(0xe8eaec);
  // a wind farm off IJmuiden, 11–15 km out to the north-west
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 7; j++) {
      const q = coastPoint(map, 2500 + j * 1050 + (i % 2) * 520, -11000 - i * 800);
      const L = new Local(q.x, SEA_Y, q.z, yaw + 0.9);
      frustum(mb, L, 6, 0, 3.2, 105, 2.0, WHITE, false);
      localBox(mb, L, -2, 103, -6, 2, 108, 5, WHITE);
      const hub = new THREE.Vector3(0, 105.5, -6.2);
      const a0 = r() * Math.PI * 2;
      for (let b = 0; b < 3; b++) {
        const a = a0 + (b / 3) * Math.PI * 2;
        const lm = new MeshBuilder();
        lm.aabb(-1.1, 0, -0.3, 1.1, 58, 0.3, WHITE);
        lm.transform(new THREE.Matrix4().makeRotationZ(a).setPosition(hub));
        lm.transform(L.m);
        mb.append(lm);
      }
    }
  // ships on the horizon
  for (const [a, c, len] of [[-6000, -8000, 190], [4000, -9500, 240], [-1500, -14000, 300]] as const) {
    const q = coastPoint(map, a, c);
    const L = new Local(q.x, SEA_Y, q.z, yaw + 0.2);
    localBox(mb, L, -len * 0.08, -1, -len / 2, len * 0.08, 11, len / 2, srgb(0x2c3036));
    localBox(mb, L, -len * 0.07, 11, -len / 2 + 6, len * 0.07, 18, -len / 2 + 28, srgb(0xe6e6e2));
    for (let k = 0; k < 6; k++) localBox(mb, L, -len * 0.07, 11, -len / 2 + 34 + k * len * 0.12, len * 0.07, 17 + ((k * 7) % 5), -len / 2 + 30 + (k + 1) * len * 0.12, [srgb(0x8c2f28), srgb(0x2f5f8c), srgb(0x6a6e2a)][k % 3]);
  }
}

// ---------------------------------------------------------------------------- marram grass

function buildMarram(map: WorldMap, track: Track): { mesh: THREE.InstancedMesh; count: number; uniforms: Record<string, THREE.IUniform> } {
  // one tussock: 13 thin arching blades (a single triangle each) fanning up and out, grey-green at
  // the root, straw at the tips
  const mb = new MeshBuilder();
  const base = srgb(0x55623f), tip = srgb(0xc2b98a);
  const rr = rng(77);
  for (let b = 0; b < 13; b++) {
    const a = (b / 13) * Math.PI * 2 + rr() * 0.6;
    const lean = 0.18 + rr() * 0.55;
    const h = 0.5 + rr() * 0.55;
    const dx = Math.cos(a), dz = Math.sin(a);
    const w = 0.018 + rr() * 0.012;
    const px = -dz * w, pz = dx * w;
    const r0 = rr() * 0.12;
    const bx = dx * r0, bz = dz * r0;
    const tx = bx + dx * lean * h, tz = bz + dz * lean * h;
    const nx = dx * 0.35, nz = dz * 0.35;
    const i0 = mb.vertex(bx - px, 0, bz - pz, nx, 1, nz, base, 0);
    const i1 = mb.vertex(bx + px, 0, bz + pz, nx, 1, nz, base, 0);
    const i2 = mb.vertex(tx, h, tz, nx, 1, nz, tip, 1);
    mb.idx.push(i0, i1, i2);
  }
  const geo = mb.geometry(true);

  // placement: a jittered 3 m grid in the dunes 1–70 m beyond the barriers, thinning with distance
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  const C = 3.1;
  for (const side of [-1, 1]) {
    for (let s = 0; s < track.n; s += C) {
      const bar = track.barrierAt(s, side);
      for (let d = 1.5; d < 72; d += C) {
        const is = Math.floor(s / C), id = Math.floor(d / C);
        const h = hash2i(is * 2 + (side > 0 ? 1 : 0), id, 101);
        const keep = 0.5 * (1 - d / 90);
        if (h > keep) continue;
        const js = (hash2i(is, id, 102 + side) - 0.5) * C, jd = (hash2i(is, id, 104 + side) - 0.5) * C;
        track.point(s + js, side * (bar + d + jd), 0, p);
        if (map.trackClearance(p.x, p.z) < 1.2) continue;
        if (map.excluded(p.x, p.z, 1.5) || map.inPitZone(p.x, p.z, 4) || map.pathDistance(p.x, p.z).d < 0.8) continue;
        const { c } = coastCoords(map, p.x, p.z);
        if (c < 95) continue;
        if (map.forest(p.x, p.z) > 0.5) continue;
        // blowouts and steep faces are bare sand
        if (map.slope(p.x, p.z) < 0.9) continue;
        const y = map.height(p.x, p.z) - 0.05;
        const hs = hash2i(is, id, 107);
        q.setFromAxisAngle(up, hs * Math.PI * 2);
        const s0 = 0.75 + hash2i(is, id, 108) * 0.75;
        sc.set(s0 * (0.9 + hs * 0.3), s0 * (0.85 + hash2i(is, id, 109) * 0.45), s0);
        p.set(p.x, y, p.z);
        mats.push(new THREE.Matrix4().compose(p.clone(), q.clone(), sc.clone()));
        const k = 0.86 + hash2i(is, id, 110) * 0.26;
        const dry = hash2i(is, id, 111);
        cols.push(new THREE.Color(k * (1 + dry * 0.12), k * (1 + dry * 0.05), k * (1 - dry * 0.1)));
      }
    }
  }
  const uniforms: Record<string, THREE.IUniform> = {
    uGTime: { value: 0 },
    uGWind: { value: new THREE.Vector2(3, 1) },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWind;\nuniform float uGTime;\nuniform vec2 uGWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 wo = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  float camD = length( wo.xyz - cameraPosition );
  // fade out beyond ~190 m (collapsed to the root: nothing rasterised)
  float keep = 1.0 - smoothstep( 150.0, 190.0, camD );
  float gust = sin( uGTime * 1.9 + wo.x * 0.21 + wo.z * 0.17 ) * 0.5 + sin( uGTime * 3.3 + wo.x * 0.5 ) * 0.25;
  vec2 bend = ( normalize( uGWind + 1e-3 ) * ( 0.12 + 0.03 * length( uGWind ) ) ) * ( 0.7 + 0.6 * gust ) * aWind * aWind;
  transformed.xz += bend * transformed.y * 1.4;
  transformed *= keep;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'zandvoort-marram-v1';
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, cols[i]);
  });
  mesh.count = mats.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'zandvoort_marram';
  return { mesh, count: mats.length, uniforms };
}

// ---------------------------------------------------------------------------- orange smoke flares

const FLARE_VS = /* glsl */ `
attribute vec3 aOrigin;
attribute vec4 aInfo; // x: particle phase, y: plume seed, z: particle seed, w: size scale
uniform float uFTime;
uniform vec2 uFWind;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
#include <fog_pars_vertex>
void main() {
  const float LIFE = 12.0;
  const float CYCLE = 75.0;
  float seed = aInfo.y;
  // each flare burns for a while, then the stand waits for the next one
  float age01 = fract( uFTime / LIFE + aInfo.x );
  float birth = uFTime - age01 * LIFE;
  float cyc = fract( ( birth + seed * CYCLE ) / CYCLE );
  float burning = step( cyc, 0.42 );
  float t = age01 * LIFE;
  vec2 drift = uFWind * ( 0.45 + 0.1 * aInfo.z );
  vec3 c = aOrigin;
  // a dense column rising off the flare, spreading and leaning downwind as it cools
  c.y += 0.8 + 2.2 * t - 0.045 * t * t;
  c.xz += drift * t * ( 0.6 + 0.08 * t ) + vec2( sin( aInfo.z * 40.0 ), cos( aInfo.z * 31.0 ) ) * ( 0.25 + 0.42 * t );
  float size = ( 0.7 + 0.95 * t ) * aInfo.w * burning;
  vAlpha = smoothstep( 0.0, 0.06, age01 ) * ( 1.0 - smoothstep( 0.35, 1.0, age01 ) ) * 0.5;
  vHeat = 1.0 - smoothstep( 0.0, 0.18, age01 );
  vec4 mv = modelViewMatrix * vec4( c, 1.0 );
  float rot = aInfo.z * 6.28 + t * 0.2;
  vec2 corner = mat2( cos( rot ), -sin( rot ), sin( rot ), cos( rot ) ) * ( position.xy * size );
  mv.xy += corner;
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}
`;

const FLARE_FS = /* glsl */ `
uniform vec3 uFCol;
uniform vec3 uFLight;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv - 0.5;
  float r = length( q ) * 2.0;
  float puff = 1.0 - smoothstep( 0.35, 1.0, r + 0.18 * sin( q.x * 11.0 + q.y * 7.0 ) );
  float a = puff * vAlpha;
  if ( a < 0.01 ) discard;
  // lit from above: brighter crown, the burning core glowing at the root
  vec3 col = uFCol * uFLight * ( 0.72 + 0.4 * ( 0.5 - q.y ) ) + vec3( 1.0, 0.55, 0.2 ) * vHeat * 2.2;
  gl_FragColor = vec4( col, a );
  #include <fog_fragment>
}
`;

function buildFlares(sites: { x: number; y: number; z: number }[]): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const PER = 34;
  const n = sites.length * PER;
  const base = new THREE.InstancedBufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  const origin = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  const r = rng(3301);
  sites.forEach((s, i) => {
    const seed = r();
    for (let k = 0; k < PER; k++) {
      const j = i * PER + k;
      origin.set([s.x, s.y, s.z], j * 3);
      info.set([k / PER + r() * 0.02, seed, r(), 0.8 + r() * 0.5], j * 4);
    }
  });
  base.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
  base.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  base.instanceCount = n;
  base.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const uniforms: Record<string, THREE.IUniform> = {
    uFTime: { value: 0 },
    uFWind: { value: new THREE.Vector2(2, 0.5) },
    uFCol: { value: srgb(0xff6a10) },
    uFLight: { value: new THREE.Color(1, 1, 1) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: FLARE_VS,
    fragmentShader: FLARE_FS,
    uniforms: { ...aerialUniforms(), ...uniforms },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(base, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'zandvoort_flares';
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------- build

export function buildZandvoortScenery(layout: Layout, track: Track, map: WorldMap, terrain: TerrainBuild): ZandvoortSceneryBuild {
  const group = new THREE.Group();
  group.name = 'ZandvoortScenery';
  const r = rng(2020);
  zandvoortTerrainLook(terrain, map);
  const seaTime = { value: 0 };
  const sea = buildSea(map, seaTime);
  group.add(sea.group);

  const solid = new MeshBuilder();
  const facade = new MeshBuilder();
  const far = new MeshBuilder();
  buildTown(map, solid, facade, r);
  buildOffshore(map, far, r);
  const g = zandvoortGeo(map);
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, shadow: boolean) => {
    if (mb.vertexCount === 0) return;
    const m = new THREE.Mesh(mb.geometry(false), mat);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    group.add(m);
  };
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), 'zandvoort_town', false);
  add(facade, facadeMaterial(g.tx, g.tz), 'zandvoort_boulevard', false);
  add(far, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }), 'zandvoort_offshore', false);

  const marram = buildMarram(map, track);
  group.add(marram.mesh);

  const sites = (layout as ZandvoortLayout).zandvoort;
  const flares = sites && sites.flares.length ? buildFlares(sites.flares) : null;
  if (flares) group.add(flares.mesh);

  return {
    group,
    update(elapsed) {
      seaTime.value = elapsed;
      sea.update(elapsed);
      marram.uniforms.uGTime.value = elapsed;
      if (flares) flares.uniforms.uFTime.value = elapsed;
    },
    setLight(l) {
      (marram.uniforms.uGWind.value as THREE.Vector2).set(l.windX, l.windZ);
      if (flares) {
        (flares.uniforms.uFWind.value as THREE.Vector2).set(l.windX, l.windZ);
        // smoke is lit by the sun and the sky (a grey day dulls it)
        const L = flares.uniforms.uFLight.value as THREE.Color;
        L.copy(l.sunColor).multiplyScalar(0.16).add(new THREE.Color().copy(l.skyAmbient).multiplyScalar(0.9));
      }
    },
    stats: { marram: marram.count, flares: sites?.flares.length ?? 0 },
  };
}
