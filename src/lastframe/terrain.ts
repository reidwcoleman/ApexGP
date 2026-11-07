import * as THREE from 'three';
import type { Terrain } from './collide.ts';
import { LF, applyLF } from './lighting.ts';

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

function landMaterial(tex: (n: string) => THREE.Texture | null, splat: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const u = {
    tGrass: { value: tex('leafy_grass_c') }, tRock: { value: tex('cliff_side_c') }, tSand: { value: tex('coast_sand_rocks_02_c') }, tDirt: { value: tex('grass_path_2_c') },
    tGrassN: { value: tex('leafy_grass_n') }, tRockN: { value: tex('cliff_side_n') }, tSplat: { value: splat },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tRock, tSand, tDirt, tGrassN, tRockN, tSplat;
float lfH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float lfN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( lfH( i ), lfH( i + vec2( 1, 0 ) ), f.x ), mix( lfH( i + vec2( 0, 1 ) ), lfH( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float lfF( vec2 p ) { return lfN( p ) * 0.55 + lfN( p * 2.3 + 4.1 ) * 0.3 + lfN( p * 5.1 + 9.7 ) * 0.15; }
vec2 lfRockUv( vec3 p, vec3 n ) {
  // cliffs take the scan from the side, or it would smear down them
  return abs( n.y ) > 0.6 ? p.xz : abs( n.x ) > abs( n.z ) ? vec2( p.z, p.y * 1.4 ) : vec2( p.x, p.y * 1.4 );
}
`);
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `
vec4 sp = texture2D( tSplat, vLfLM );
sp /= max( dot( sp, vec4( 1.0 ) ), 0.001 );
vec3 wN = normalize( vLfN );
vec2 uG = vLfW.xz / 3.4, uR = lfRockUv( vLfW, wN ) / 9.0;
// two scales of each, so nothing reads as a repeating tile from the hill
vec3 cG = mix( texture2D( tGrass, uG ).rgb, texture2D( tGrass, uG * 0.17 + 0.31 ).rgb, 0.55 );
vec3 cR = mix( texture2D( tRock, uR ).rgb, texture2D( tRock, uR * 0.31 + 0.13 ).rgb, 0.45 );
// pasture: wet Atlantic green, paler where it's grazed short
float pat = lfF( vLfW.xz * 0.021 );
vec3 lush = cG * vec3( 0.56, 1.12, 0.36 ) * 1.3, pale = cG * vec3( 0.86, 1.14, 0.46 ) * 1.5;
cG = mix( lush, pale, smoothstep( 0.42, 0.66, pat ) );
// dead bracken, in rust-red drifts on the rough ground above the cliffs
float rough = smoothstep( 0.97, 0.86, wN.y );
float brk = smoothstep( 0.57, 0.66, lfF( vLfW.xz * 0.034 + 7.0 ) + rough * 0.1 ) * smoothstep( 15.0, 22.0, vLfW.y );
// the frond texture comes from the grass scan itself, so a drift isn't a flat wash of colour
vec3 rust = vec3( 0.42, 0.15, 0.07 ) * ( 0.3 + 2.6 * dot( cG, vec3( 0.3, 0.5, 0.2 ) ) ) * ( 0.7 + 0.8 * lfF( vLfW.xz * 1.7 ) );
cG = mix( cG, rust, brk );
// gorse and scrub darken the steep ground between
cG *= 1.0 - 0.45 * rough * smoothstep( 0.44, 0.6, lfF( vLfW.xz * 0.09 + 3.0 ) );
cR *= vec3( 0.86, 0.87, 0.9 );
cR = mix( cR, cR * vec3( 0.72, 0.8, 0.5 ), smoothstep( 0.5, 0.66, lfF( vLfW.xz * 0.11 ) ) * smoothstep( 2.0, 8.0, vLfW.y ) );
vec3 cS = texture2D( tSand, vLfW.xz / 4.5 ).rgb * vec3( 0.84, 0.84, 0.86 );
vec3 cD = texture2D( tDirt, vLfW.xz / 3.0 ).rgb;
diffuseColor.rgb = cG * sp.r + cR * sp.g + cS * sp.b + cD * sp.a;
`);
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 nR = texture2D( tRockN, uR ).xyz * 2.0 - 1.0, nG = texture2D( tGrassN, uG ).xyz * 2.0 - 1.0;
  vec2 tn = nR.xy * ( sp.g + sp.b * 0.5 ) * 1.3 + nG.xy * ( sp.r + sp.a ) * 0.8;
  vec3 tT = normalize( cross( wN, vec3( 0.0, 0.0, 1.0 ) ) ), tB = cross( wN, tT );
  normal = normalize( ( viewMatrix * vec4( normalize( wN + tT * tn.x + tB * tn.y ), 0.0 ) ).xyz );
}
`);
  };
  m.customProgramCacheKey = () => 'lf-land';
  return applyLF(m, { lightmap: true, terrain: true });
}

/** the sea: depth from the heights, the colour of a Cornish cove, swell and foam */
function sea(t: Terrain) {
  const n = t.nx * t.ny;
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.max(0, Math.min(255, -t.h[i] * 14 + 8));
  const depth = new THREE.DataTexture(d, t.nx, t.ny, THREE.RedFormat, THREE.UnsignedByteType);
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  depth.needsUpdate = true;
  const W = (t.nx - 1) * t.step, H = (t.ny - 1) * t.step;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: { tD: { value: depth }, time: LF.time, area: { value: new THREE.Vector4(t.x0, t.y0, W, H) }, cam: { value: new THREE.Vector3() }, light: { value: 1 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
varying vec3 vW;
uniform sampler2D tD; uniform float time, light; uniform vec4 area; uniform vec3 cam;
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vn( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float fb( vec2 p ) { return vn( p ) * 0.5 + vn( p * 2.1 + 3.1 ) * 0.28 + vn( p * 4.3 + 7.7 ) * 0.14; }
float surf( vec2 p ) {
  float s = sin( dot( p, vec2( 0.21, 0.32 ) ) + time * 0.9 ) * 0.4 + sin( dot( p, vec2( -0.34, 0.27 ) ) + time * 1.3 ) * 0.25;
  s += sin( dot( p, vec2( 0.81, 0.53 ) ) + time * 2.1 ) * 0.1;
  return s + fb( p * 0.55 + time * 0.14 ) * 1.1 + fb( p * 1.9 - time * 0.21 ) * 0.34;
}
void main() {
  vec2 uv = vec2( ( vW.x - area.x ) / area.z, ( -vW.z - area.y ) / area.w );
  float e = texture2D( tD, uv ).r * 255.0;
  float depth = ( e - 8.0 ) / 14.0;
  if ( depth < -0.12 ) discard;
  depth = max( depth, 0.0 );
  vec2 p = vW.xz;
  float a = surf( p ), bx = surf( p + vec2( 0.25, 0.0 ) ), bz = surf( p + vec2( 0.0, 0.25 ) );
  // the far water calms down, or the fine waves alias into lines at a grazing angle
  float calm = 0.55 / ( 1.0 + distance( cam, vW ) / 32.0 );
  vec3 n = normalize( vec3( ( a - bx ) * calm, 1.0, ( a - bz ) * calm ) );
  vec3 v = normalize( cam - vW );
  float fr = 0.03 + 0.97 * pow( 1.0 - max( dot( n, v ), 0.0 ), 5.0 );
  vec3 r = reflect( -v, n );
  vec3 sky = mix( vec3( 0.66, 0.68, 0.66 ), vec3( 0.86, 0.87, 0.85 ), clamp( r.y * 1.6, 0.0, 1.0 ) );
  float k = 1.0 - exp( -depth * 0.32 );
  vec3 body = mix( vec3( 0.2, 0.47, 0.4 ), vec3( 0.022, 0.13, 0.16 ), k );
  // weed and rock showing through the shallows
  body *= 0.82 + 0.3 * fb( p * 0.22 );
  // sets of swell stand up as the bottom shelves, and break on the rocks
  float set = sin( depth * 2.6 + time * 0.95 + fb( p * 0.09 ) * 5.0 );
  float lip = smoothstep( 0.6, 1.0, set ) * smoothstep( 3.2, 0.4, depth );
  float lace = fb( p * 1.4 + vec2( time * 0.12, -time * 0.08 ) );
  float foam = smoothstep( 0.42, 0.72, lace + lip * 0.5 + smoothstep( 0.55, 0.0, depth ) * 0.42 ) * smoothstep( 4.0, 0.0, depth );
  foam = max( foam, smoothstep( 0.66, 0.8, fb( p * 0.8 + time * 0.05 ) ) * 0.16 );
  vec3 c = mix( body, sky, fr );
  c = mix( c, vec3( 0.92, 0.95, 0.93 ), foam );
  float alpha = max( mix( 0.5, 1.0, 1.0 - exp( -depth * 0.9 ) ), foam ) * smoothstep( -0.12, 0.05, depth + foam * 0.1 + ( a - 1.0 ) * 0.08 );
  gl_FragColor = vec4( c * light, alpha );
}`,
  });
  const g = new THREE.PlaneGeometry(1400, 1400, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(0, 0.0, 0);
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.onBeforeRender = (_r, _s, cam) => (mat.uniforms.cam.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
  return m;
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

export function buildLand(t: Terrain, info: TerrainInfo, tex: (n: string) => THREE.Texture | null, splat: THREE.Texture) {
  const g = new THREE.Group();
  const land = new THREE.Mesh(landGeometry(t, info.inner), landMaterial(tex, splat));
  land.frustumCulled = false;
  land.name = 'land';
  g.add(land, sea(t));
  return g;
}
