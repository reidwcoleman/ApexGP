import * as THREE from 'three';
import type { Terrain } from './collide.ts';
import { LF, applyLF } from './lighting.ts';
import { buildSea } from './water.ts';

export interface TerrainInfo {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  /** where the mesh runs at full detail: [x0, y0, x1, y1] */
  inner: number[];
  /** how far a body may go: [x0, z0, x1, z1] */
  limit: number[];
}

/** the land as a mesh: every metre where you can walk, every fourth beyond */
function landGeometry(t: Terrain, inner: number[]) {
  const pos: number[] = [], lm: number[] = [], idx: number[] = [];
  const W = (t.nx - 1) * t.step, H = (t.ny - 1) * t.step;
  const at = (i: number, j: number) => t.h[j * t.nx + i];
  const grid = (i0: number, j0: number, i1: number, j1: number, s: number, skip?: (i: number, j: number) => boolean) => {
    const cols = Math.floor((i1 - i0) / s) + 1, rows = Math.floor((j1 - j0) / s) + 1;
    const base = pos.length / 3;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = i0 + c * s, j = j0 + r * s;
      const x = t.x0 + i * t.step, y = t.y0 + j * t.step;
      pos.push(x, at(i, j), -y);
      lm.push((x - t.x0) / W, (y - t.y0) / H);
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      if (skip?.(i0 + c * s, j0 + r * s)) continue;
      const a = base + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  };
  const ii = (x: number) => Math.round((x - t.x0) / t.step), jj = (y: number) => Math.round((y - t.y0) / t.step);
  const [a, b, c, d] = [ii(inner[0]), jj(inner[1]), ii(inner[2]), jj(inner[3])];
  grid(a, b, c, d, 1);
  grid(0, 0, t.nx - 1, t.ny - 1, 4, (i, j) => i + 4 > a && i < c && j + 4 > b && j < d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uvLM', new THREE.Float32BufferAttribute(lm, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** pasture in June, as colour: shared with the blades that stand on it so that the two meet at a distance */
export const PASTURE = /* glsl */ `
float lfTile( sampler2D n, vec2 p ) { return texture2D( n, p * 0.03125 ).r; }
vec3 lfPasture( sampler2D n, vec2 p ) {
  float a = lfTile( n, p * 0.05 ), b = lfTile( n, p * 0.19 + 5.0 ), c = lfTile( n, p * 0.83 + 9.0 );
  vec3 col = mix( vec3( 0.062, 0.118, 0.026 ), vec3( 0.105, 0.155, 0.036 ), smoothstep( 0.4, 0.6, a ) );
  col = mix( col, vec3( 0.2, 0.205, 0.07 ), smoothstep( 0.5, 0.68, b ) * 0.62 );
  return col * ( 0.82 + 0.36 * c );
}`;

function landMaterial(tex: (n: string) => THREE.Texture | null, splat: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const u = {
    tGrass: { value: tex('leafy_grass_c') }, tRock: { value: tex('seaside_rock_c') }, tRock2: { value: tex('lichen_rock_c') }, tSand: { value: tex('coast_sand_rocks_02_c') }, tPeb: { value: tex('clean_pebbles_c') },
    tRoad: { value: tex('worn_asphalt_c') }, tGrassN: { value: tex('leafy_grass_n') }, tRockN: { value: tex('seaside_rock_n') }, tSplat: { value: splat },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tRock, tRock2, tSand, tPeb, tRoad, tGrassN, tRockN, tSplat;
${PASTURE}
vec2 lfRockUv( vec3 p, vec3 n ) {
  // cliffs take the scan from the side, or it would smear down them
  return abs( n.y ) > 0.6 ? p.xz : abs( n.x ) > abs( n.z ) ? vec2( p.z, p.y * 1.3 ) : vec2( p.x, p.y * 1.3 );
}
`);
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `
vec4 sp = texture2D( tSplat, vLfLM );
sp /= max( dot( sp, vec4( 1.0 ) ), 0.001 );
vec3 wN = normalize( vLfN );
vec2 lfP = vLfW.xz;
float lfY = vLfW.y;
vec2 uG = lfP / 2.8;
// ---- turf: the scan only brings its light and dark, the colour is the pasture's
vec3 tg = mix( texture2D( tGrass, uG ).rgb, texture2D( tGrass, uG * 0.17 + 0.31 ).rgb, 0.5 );
float gl = dot( tg, vec3( 0.3, 0.6, 0.1 ) ) / 0.23;
vec3 cG = lfPasture( lfNoiseT, lfP ) * clamp( 0.32 + 0.68 * gl, 0.25, 1.6 );
// tussocks: from a distance this is what a field is, thousands of small dark and light clumps
cG *= 0.66 + 0.68 * lfTile( lfNoiseT, lfP * 2.9 + 13.0 );
// rough ground: bracken and blackthorn darken the banks, gorse in flower in it, thrift along the cliff tops
float rough = smoothstep( 0.965, 0.82, wN.y );
float bush = smoothstep( 0.47, 0.6, lfTile( lfNoiseT, lfP * 0.1 + 3.0 ) );
cG = mix( cG, cG * vec3( 0.55, 0.78, 0.5 ), clamp( rough * 1.3, 0.0, 1.0 ) * bush );
float thrift = smoothstep( 0.6, 0.68, lfTile( lfNoiseT, lfP * 1.3 + 17.0 ) ) * clamp( sp.g * 3.0, 0.0, 1.0 ) * smoothstep( 7.0, 12.0, lfY );
cG = mix( cG, vec3( 0.56, 0.3, 0.38 ), thrift * 0.26 );
// ---- rock: blended from the sides, a second scan over it at a bigger size so no two faces match
vec3 w3 = wN * wN; w3 *= w3; w3 /= w3.x + w3.y + w3.z;
vec3 cR = texture2D( tRock, vec2( vLfW.z, lfY * 1.3 ) / 6.5 ).rgb * w3.x + texture2D( tRock, lfP / 6.5 ).rgb * w3.y + texture2D( tRock, vec2( vLfW.x, lfY * 1.3 ) / 6.5 ).rgb * w3.z;
vec3 cR2 = texture2D( tRock2, ( abs( wN.x ) > abs( wN.z ) ? vec2( vLfW.z, lfY ) : vec2( vLfW.x, lfY ) ) / 17.0 ).rgb;
cR = mix( cR, cR * cR2 * 3.2, 0.55 );
// tilted beds of slate, then the zones a sea cliff really has: black at the tide line, orange lichen above the spray, grey above that
float bed = lfTile( lfNoiseT, vec2( ( vLfW.x + vLfW.z ) * 0.035, ( lfY + vLfW.x * 0.11 ) * 1.1 ) );
cR *= 0.62 + 0.76 * bed;
float nz = lfTile( lfNoiseT, lfP * 0.3 ) - 0.5;
float tar = smoothstep( 2.9, 1.0, lfY + nz * 3.0 );
cR = mix( cR, vec3( 0.016, 0.018, 0.017 ), tar * 0.9 );
float orange = smoothstep( 0.5, 0.62, lfTile( lfNoiseT, vec2( ( vLfW.x + vLfW.z ) * 0.45, lfY * 0.5 ) ) ) * smoothstep( 2.0, 4.5, lfY ) * smoothstep( 15.0, 7.0, lfY );
cR = mix( cR, vec3( 0.48, 0.27, 0.05 ), orange * 0.72 );
float grey = smoothstep( 0.46, 0.6, lfTile( lfNoiseT, lfP * 0.5 + 41.0 ) ) * smoothstep( 8.0, 16.0, lfY );
cR = mix( cR, cR * vec3( 1.3, 1.35, 1.2 ), grey * 0.5 );
// ---- the beach: shingle over sand, dark and shining where the last wave reached
vec3 cS = mix( texture2D( tSand, lfP / 4.5 ).rgb * vec3( 0.46, 0.44, 0.42 ), texture2D( tPeb, lfP / 1.9 ).rgb * vec3( 0.4, 0.4, 0.42 ), smoothstep( 0.42, 0.58, lfTile( lfNoiseT, lfP * 0.16 ) + smoothstep( 1.2, 3.0, lfY ) * 0.3 ) );
float lap = sin( lfTime * 0.52 + vLfW.x * 0.012 ) * 0.1 + sin( lfTime * 0.21 ) * 0.06;
float damp = smoothstep( 0.95, 0.12, lfY - lap + nz * 0.5 );
cS *= mix( 1.0, 0.46, damp );
// ---- the lanes: old tarmac, moss creeping in from the edges
vec3 cD = texture2D( tRoad, lfP / 4.6 ).rgb * vec3( 0.6, 0.6, 0.6 );
float moss = smoothstep( 0.5, 0.2, sp.a + ( lfTile( lfNoiseT, lfP * 0.8 ) - 0.5 ) * 0.6 );
cD = mix( cD, cG * 0.55, moss );
diffuseColor.rgb = cG * sp.r + cR * sp.g + cS * sp.b + cD * sp.a;
// under the water the light still moves
if ( lfY < 0.1 ) {
  vec2 q = lfP * 0.7;
  float ca = lfTile( lfNoiseT, q * 2.0 + vec2( lfTime * 0.09, lfTime * 0.05 ) ) + lfTile( lfNoiseT, q * 2.6 - vec2( lfTime * 0.07, -lfTime * 0.06 ) );
  diffuseColor.rgb *= 0.78 + 1.2 * smoothstep( 0.82, 1.06, 1.94 - abs( ca - 1.0 ) * 4.0 - 0.0 ) * smoothstep( -8.0, 0.0, lfY );
}
`);
    s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.2, damp * sp.b * 0.9 );
roughnessFactor = mix( roughnessFactor, 0.34, tar * sp.g * 0.8 );
`);
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 uR = lfRockUv( vLfW, wN ) / 6.5;
  vec3 nR = texture2D( tRockN, uR ).xyz * 2.0 - 1.0, nG = texture2D( tGrassN, uG ).xyz * 2.0 - 1.0;
  vec2 tn = nR.xy * ( sp.g * 1.7 + sp.b * 0.5 ) + nG.xy * ( sp.r * 1.1 + sp.a * 0.5 );
  // the lie of the ground below what the heights can draw: hummocks and sheep tracks, so low sun has something to catch
  const float E = 0.4;
  float e0 = lfTile( lfNoiseT, ( lfP + vec2( E, 0.0 ) ) * 0.55 ) - lfTile( lfNoiseT, ( lfP - vec2( E, 0.0 ) ) * 0.55 );
  float e1 = lfTile( lfNoiseT, ( lfP + vec2( 0.0, E ) ) * 0.55 ) - lfTile( lfNoiseT, ( lfP - vec2( 0.0, E ) ) * 0.55 );
  float e2 = lfTile( lfNoiseT, ( lfP + vec2( E, 0.0 ) ) * 0.14 ) - lfTile( lfNoiseT, ( lfP - vec2( E, 0.0 ) ) * 0.14 );
  float e3 = lfTile( lfNoiseT, ( lfP + vec2( 0.0, E ) ) * 0.14 ) - lfTile( lfNoiseT, ( lfP - vec2( 0.0, E ) ) * 0.14 );
  tn += ( vec2( e0, e1 ) * 2.6 + vec2( e2, e3 ) * 7.0 ) * sp.r;
  vec3 tT = normalize( cross( wN, vec3( 0.0, 0.0, 1.0 ) ) ), tB = cross( wN, tT );
  normal = normalize( ( viewMatrix * vec4( normalize( wN + tT * tn.x + tB * tn.y ), 0.0 ) ).xyz );
}
`);
  };
  m.customProgramCacheKey = () => 'lf-land';
  return applyLF(m, { lightmap: true, terrain: true });
}

/** a wind through anything rooted to the ground */
export function sway(m: THREE.MeshStandardMaterial, k: number) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.uniforms.lfSwayT = LF.time;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float lfSwayT;').replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec2 root = instanceMatrix[3].xz;
  float t = lfSwayT * 1.5 + root.x * 0.21 + root.y * 0.17;
  transformed.xz += vec2( sin( t ) + 0.5 * sin( t * 2.3 ), cos( t * 0.8 ) ) * ${k.toFixed(3)} * transformed.y * transformed.y;
}
#endif
`);
  };
  const key = m.customProgramCacheKey?.() ?? '';
  m.customProgramCacheKey = () => key + 'sway';
}

export function buildLand(t: Terrain, info: TerrainInfo, tex: (n: string) => THREE.Texture | null, splat: THREE.Texture, hTex: THREE.Texture, near: THREE.Texture | null) {
  const g = new THREE.Group();
  g.name = 'land';
  const land = new THREE.Mesh(landGeometry(t, info.inner), landMaterial(tex, splat));
  land.frustumCulled = false;
  land.name = 'ground';
  g.add(land, buildSea(t, hTex, near));
  return g;
}
