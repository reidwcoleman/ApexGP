import * as THREE from 'three';
import { FAR_CELL, FINE_CELL, MID_CELL, WorldMap } from './worldmap.ts';
import { detailNormalTexture, noiseTexture } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';
import type { ParkMasks } from './parkmask.ts';

/**
 * Terrain meshes: 4 m chunks around the circuit, 16 m chunks over the 6 km
 * square, 256 m far ring (plain + Prealps). Grids are stitched (boundary
 * vertices lie on the coarser edge). One splat shader for all of it: mown
 * lawns with mowing stripes, September meadow, leaf litter under the woods,
 * gravel paths and asphalt from the park masks, farmland and villages outside
 * the park. Rain darkens soil and grass, makes everything glossier and fills
 * puddles on the paths.
 */

export interface TerrainBuild {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
  setMasks(m: ParkMasks): void;
}

const lin = (hex: number) => new THREE.Color(hex);

export function createTerrainMaterial(maxAniso: number): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform> } {
  const noise = noiseTexture();
  const detail = detailNormalTexture();
  noise.anisotropy = maxAniso;
  detail.anisotropy = maxAniso;
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  const uniforms: Record<string, THREE.IUniform> = {
    uNoise: { value: noise },
    uDetailN: { value: detail },
    uMaskFine: { value: blank },
    uMaskCoarse: { value: blank },
    uMaskTrack: { value: blank },
    uFineO: { value: new THREE.Vector2() },
    uFineS: { value: new THREE.Vector2(1, 1) },
    uSqO: { value: new THREE.Vector2() },
    uSqS: { value: new THREE.Vector2(1, 1) },
    uCenter: { value: new THREE.Vector2() },
    uLawn: { value: lin(0x5a6f3a) },
    uMeadow: { value: lin(0x6b7043) },
    uStraw: { value: lin(0x958a5a) },
    uGrassDark: { value: lin(0x3e4f28) },
    uLitter: { value: lin(0x4e3d2a) },
    uLitterDark: { value: lin(0x2e261c) },
    uMoss: { value: lin(0x46562a) },
    uGravel: { value: lin(0xb4a78b) },
    uGravelDark: { value: lin(0x857a65) },
    uAsphalt: { value: lin(0x4d4f52) },
    uEarth: { value: lin(0x7d664c) },
    uCanopy: { value: lin(0x33462a) },
    uRoof: { value: lin(0x9a5a3e) },
    /** 1 = the city goes on to the horizon beyond the square (São Paulo), 0 = towns ringed by farmland */
    uCity: { value: 0 },
    uWetness: weatherUniforms.uWetness,
    uRain: weatherUniforms.uRain,
    uWTime: weatherUniforms.uWeatherTime,
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNoise;
uniform sampler2D uDetailN;
uniform sampler2D uMaskFine;
uniform sampler2D uMaskCoarse;
uniform sampler2D uMaskTrack;
uniform vec2 uFineO, uFineS, uSqO, uSqS, uCenter;
uniform vec3 uLawn, uMeadow, uStraw, uGrassDark, uLitter, uLitterDark, uMoss, uGravel, uGravelDark, uAsphalt, uEarth, uCanopy, uRoof;
uniform float uWetness, uRain, uWTime;
uniform float uCity;
varying vec3 vWPos;
varying vec3 vWNormal;
float tRough;
float tAO;
vec3 tDetailN;
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
`,
      )
      .replace(
        '#include <map_fragment>',
        `
{
  vec2 p = vWPos.xz;
  float camDist = length( vWPos - cameraPosition );
  float m1 = texture2D( uNoise, p * 0.00093 + vec2( 0.13, 0.71 ) ).r;
  float m2 = texture2D( uNoise, p * 0.0041 + vec2( 0.37, 0.19 ) ).g;
  float m3 = texture2D( uNoise, p * 0.019 ).b;
  float d1 = texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 0.121 ).a;
  float d2 = texture2D( uNoise, p * 0.43 + vec2( 0.5 ) ).g;
  float d3 = texture2D( uNoise, p * 1.37 + vec2( 0.21, 0.77 ) ).b;
  float nearF = 1.0 - smoothstep( 25.0, 220.0, camDist );
  float farF = smoothstep( 260.0, 1400.0, camDist );

  // ---- masks
  vec2 fuv = ( p - uFineO ) / uFineS;
  vec2 fe = min( fuv, 1.0 - fuv );
  float inFine = smoothstep( 0.0, 0.015, min( fe.x, fe.y ) );
  vec4 mf = texture2D( uMaskFine, clamp( fuv, 0.001, 0.999 ) );
  vec2 cuv = ( p - uSqO ) / uSqS;
  vec2 ce = min( cuv, 1.0 - cuv );
  float inSq = smoothstep( 0.0, 0.03, min( ce.x, ce.y ) );
  vec4 mc = texture2D( uMaskCoarse, clamp( cuv, 0.001, 0.999 ) );
  // outside the square: procedural woods + farmland
  float procF = smoothstep( 0.6, 0.72, m1 * 0.6 + m2 * 0.4 );
  float coarseForest = mix( procF * 0.7, mc.r, inSq );
  float park = mix( 0.0, mc.g, inSq );
  float forest = mix( coarseForest * 0.9, clamp( mf.r * 1.25, 0.0, 1.0 ), inFine );
  // track-aligned: R mowing band, G verge, B run-off wear (parkmask.ts)
  vec4 mt = texture2D( uMaskTrack, clamp( fuv, 0.001, 0.999 ) ) * inFine;
  float verge = mt.g;
  float lawn = max( mf.g * inFine, verge );
  float gravel = mf.b * inFine;
  float paved = mf.a * inFine;

  // ---- grass: rough September meadow ↔ mown lawn with stripes
  // very large scale: whole fields drift between fresh green, blue-green and sun-bleached
  float m0 = texture2D( uNoise, p * 0.00031 + vec2( 0.61, 0.27 ) ).g;
  float hueF = ( m0 - 0.5 ) * 2.0;
  vec3 macroTint = vec3( 1.0 + 0.1 * hueF, 1.0 + 0.02 * hueF, 1.0 - 0.14 * hueF ) * ( 0.94 + 0.12 * m1 );
  float dry = smoothstep( 0.38, 0.78, m2 * 0.55 + m3 * 0.45 );
  vec3 meadow = mix( uMeadow, uStraw, dry * 0.75 );
  meadow = mix( meadow, uGrassDark, smoothstep( 0.55, 0.85, d1 ) * 0.4 );
  // clumps of darker, lusher tussock and pale seed heads
  meadow = mix( meadow, uGrassDark * 0.85, smoothstep( 0.62, 0.8, d2 ) * 0.35 * ( 0.4 + 0.6 * nearF ) );
  meadow = mix( meadow, uStraw * 1.1, smoothstep( 0.78, 0.92, d3 ) * 0.25 * nearF );
  meadow *= 0.86 + 0.26 * d2 * ( 0.5 + 0.5 * nearF ) + 0.08 * m1;
  vec3 lawnC = uLawn * ( 0.88 + 0.16 * m3 + 0.06 * d1 );
  // lawns: slightly patchy (clover, drier crowns where the soil is thin)
  lawnC = mix( lawnC, mix( uLawn, uStraw, 0.4 ), smoothstep( 0.6, 0.85, m2 * 0.6 + d1 * 0.4 ) * 0.35 );
  lawnC = mix( lawnC, uGrassDark, smoothstep( 0.6, 0.9, d2 ) * 0.18 );
  {
    // mowing stripes: the mower follows long gentle curves (the direction varies smoothly,
    // no seams), the contrast is the light/dark of grass laid toward and away from the eye
    // one direction per venue (a direction varying with position swirls: the stripe phase is dot(p, dir))
    float ang = 0.35 + fract( uCenter.x * 0.00137 + uCenter.y * 0.00071 ) * 3.0;
    vec2 dir = vec2( cos( ang ), sin( ang ) );
    float u = dot( p, dir ) / 6.2 + m2 * 0.8;
    float aa = fwidth( u );
    float st = smoothstep( 0.5 - aa * 1.5, 0.5 + aa * 1.5, abs( fract( u ) - 0.5 ) * 2.0 );
    // how the laid blades read depends on which way we look along the stripe
    vec3 vdir = normalize( vWPos - cameraPosition );
    float along = abs( dot( normalize( vdir.xz + 1e-4 ), dir ) );
    float amp = 0.045 + 0.035 * along;
    // along the circuit the verges are mown in bands across the track, following every curve
    float stT = smoothstep( 0.3, 0.7, mt.r / max( verge, 0.05 ) );
    st = mix( st, stT, verge );
    amp = mix( amp, 0.075, verge );
    lawnC *= mix( 1.0, mix( 1.0 - amp, 1.0 + amp, st ), ( 1.0 - smoothstep( 0.2, 0.55, aa ) * ( 1.0 - verge ) ) * ( 1.0 - farF ) );
    // white clover patches in the sward, a bluer, darker green
    float clover = smoothstep( 0.64, 0.72, d1 * 0.55 + m3 * 0.45 ) * ( 0.5 + 0.5 * nearF );
    lawnC = mix( lawnC, lawnC * vec3( 0.86, 0.98, 0.95 ), clover * 0.6 );
  }
  meadow *= macroTint;
  lawnC *= mix( vec3( 1.0 ), macroTint, 0.6 );
  vec3 grass = mix( meadow, lawnC, lawn );
  // run-off wear: where cars run wide the grass is scuffed, dusty and dry
  float wear = mt.b * smoothstep( 0.35, 0.7, d1 * 0.5 + d2 * 0.5 + mt.b * 0.3 );
  grass = mix( grass, mix( uStraw, uEarth, 0.5 ) * ( 0.85 + 0.2 * d3 ), wear * 0.7 );
  // hollows in the verge where rain stands: flattened, muddy grass (puddles when wet)
  float mudK = verge * smoothstep( 0.74, 0.8, d1 * 0.6 + m2 * 0.4 );
  grass = mix( grass, uEarth * 0.55, mudK * 0.55 );
  // wild flowers: daisies and clover heads in the lawns, buttercups and knapweed in meadow
  float fFade = 1.0 - smoothstep( 7.0, 28.0, camDist );
  if ( fFade > 0.0 ) {
    vec2 fc = p * 2.6;
    vec2 fi = floor( fc );
    vec2 ff = fract( fc ) - 0.5;
    float fh = h21( fi );
    float fk = h21( fi + 5.3 );
    vec2 fo = vec2( h21( fi + 1.7 ), h21( fi + 4.1 ) ) - 0.5;
    float dens = mix( 0.1, 0.035, lawn ) * smoothstep( 0.3, 0.7, m3 * 0.6 + d1 * 0.4 ) * ( 1.0 - forest ) * ( 1.0 - wear );
    float disc = 1.0 - smoothstep( 0.05, 0.1, length( ff - fo * 0.7 ) );
    vec3 fcol = fk < 0.55 ? vec3( 0.78, 0.78, 0.72 ) : fk < 0.82 ? vec3( 0.8, 0.62, 0.06 ) : vec3( 0.42, 0.22, 0.5 );
    grass = mix( grass, fcol, step( fh, dens ) * disc * fFade );
  }
  // trampled / worn grass near paths and stands
  float worn = smoothstep( 0.02, 0.3, gravel ) * ( 1.0 - smoothstep( 0.5, 0.9, gravel ) );
  grass = mix( grass, uEarth * ( 0.8 + 0.3 * d2 ), worn * 0.6 );

  // ---- forest floor: leaf litter, moss, bare soil, fallen yellow leaves
  vec3 floorC = mix( uLitter, uLitterDark, smoothstep( 0.3, 0.8, d1 ) );
  floorC = mix( floorC, uMoss, smoothstep( 0.55, 0.8, m3 ) * 0.55 );
  floorC *= 0.8 + 0.35 * d2;
  float fleck = step( 0.82, d3 ) * nearF;
  floorC = mix( floorC, vec3( 0.42, 0.28, 0.07 ), fleck * 0.5 );
  // from afar the woods read as canopy, not floor
  floorC = mix( floorC, uCanopy * ( 0.75 + 0.5 * m3 ), farF * ( 1.0 - inFine * 0.4 ) );
  vec3 col = mix( grass, floorC, forest );

  // ---- outside the park: towns ringing the park wall, farmland and copses beyond
  float rc = length( p - uCenter );
  float procUrban = ( 1.0 - smoothstep( 3500.0, 7000.0, rc ) ) * smoothstep( 0.55, 0.7, m1 * 0.7 + m2 * 0.3 ) + smoothstep( 0.66, 0.78, m1 ) * 0.7;
  procUrban = mix( procUrban, smoothstep( 0.3, 0.42, m1 * 0.55 + m2 * 0.45 ), uCity );
  float urban = mix( procUrban * ( 1.0 - park ), mc.b, inSq ) * ( 1.0 - inFine * 0.0 );
  float mtn = smoothstep( 90.0, 320.0, vWPos.y );
  float farm = ( 1.0 - park ) * ( 1.0 - forest ) * ( 1.0 - urban ) * ( 1.0 - mtn );
  if ( farm > 0.01 ) {
    vec2 wp = p + ( vec2( m1, m2 ) - 0.5 ) * 260.0;
    vec2 fs = vec2( 320.0, 210.0 );
    vec2 cell = floor( wp / fs );
    float h1 = h21( cell );
    float h2 = h21( cell + 17.3 );
    vec2 fc = fract( wp / fs );
    float edge = smoothstep( 0.0, 0.025, min( min( fc.x, 1.0 - fc.x ), min( fc.y, 1.0 - fc.y ) ) );
    // late-summer Lombardy: maize, stubble, pasture, ploughed — muted
    vec3 fieldCol = h1 < 0.3 ? mix( uMeadow, uLawn, 0.5 )
                  : h1 < 0.5 ? mix( uStraw, uMeadow, 0.45 )
                  : h1 < 0.72 ? mix( uLawn, uGrassDark, 0.35 )
                  : h1 < 0.86 ? mix( uEarth, uStraw, 0.35 ) * 0.9
                  : mix( uMeadow, uStraw, 0.25 );
    float stripe = 0.96 + 0.04 * sin( dot( p, vec2( 0.8, 0.6 ) * ( 1.3 + h2 ) ) );
    fieldCol *= stripe * ( 0.9 + 0.2 * d1 ) * ( 0.92 + 0.16 * m3 );
    fieldCol = mix( uGrassDark * 0.75, fieldCol, edge );
    col = mix( col, fieldCol, farm );
  }
  // towns: blocks of terracotta and grey roofs, streets, courtyards
  if ( urban > 0.01 ) {
    float ang = floor( m1 * 4.0 ) * 0.4 + 0.2;
    mat2 rot = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) );
    vec2 q = rot * p;
    vec2 bs = vec2( 64.0, 46.0 );
    vec2 bc = floor( q / bs );
    vec2 bf = fract( q / bs ) * bs;
    float street = 1.0 - step( 7.0, bf.x ) * step( 7.0, bf.y );
    vec2 lc = floor( ( bf - 7.0 ) / vec2( 14.0, 13.0 ) );
    float hb = h21( bc * 7.1 + lc );
    vec3 roof = hb < 0.55 ? uRoof * ( 0.8 + 0.4 * h21( lc + bc ) ) : hb < 0.82 ? vec3( 0.26, 0.25, 0.24 ) : vec3( 0.55, 0.53, 0.5 );
    // pitched roofs: light/dark halves
    roof *= 0.82 + 0.3 * step( 0.5, fract( ( bf.y - 7.0 ) / 13.0 ) );
    vec3 yard = mix( uLawn, uGrassDark, 0.4 ) * ( 0.8 + 0.3 * d1 );
    vec3 townC = h21( bc + lc * 3.3 ) < 0.14 ? yard : roof;
    townC = mix( townC, vec3( 0.22, 0.22, 0.23 ), street );
    col = mix( col, townC, urban * ( 1.0 - forest * 0.6 ) );
  }
  // mountains: wooded slopes, bare rock and scree higher up
  if ( mtn > 0.01 ) {
    vec3 wood = mix( uCanopy, uGrassDark, m3 * 0.5 ) * ( 0.8 + 0.3 * m2 );
    vec3 rockC = mix( vec3( 0.32, 0.3, 0.28 ), vec3( 0.46, 0.44, 0.4 ), m3 );
    vec3 mcol = mix( wood, rockC, smoothstep( 700.0, 1150.0, vWPos.y + ( m2 - 0.5 ) * 300.0 ) );
    col = mix( col, mcol, mtn );
  }

  // ---- paths and paving
  vec3 grav = mix( uGravel, uGravelDark, d1 * 0.6 + m3 * 0.4 ) * ( 0.88 + 0.24 * d3 );
  col = mix( col, grav, smoothstep( 0.35, 0.75, gravel ) );
  vec3 asph = uAsphalt * ( 0.82 + 0.3 * d1 ) * ( 0.94 + 0.12 * d3 );
  float pv = smoothstep( 0.3, 0.7, paved );
  col = mix( col, asph, pv );

  // ---- rain: darker, glossier, puddles on paths / paving / hollows
  float wet = uWetness;
  float soil = max( max( gravel, pv ), forest * 0.6 );
  col *= mix( 1.0, mix( 0.8, 0.58, soil ), wet );
  float pud = smoothstep( 0.6, 0.66, d1 * 0.55 + m3 * 0.45 + wet * 0.22 ) * smoothstep( 0.3, 0.9, wet );
  pud *= max( smoothstep( 0.4, 0.8, gravel ), pv * 0.9 ) + 0.25 * lawn * step( 0.72, m2 ) + mudK * 1.4;
  col = mix( col, col * 0.32 + vec3( 0.004 ), pud );

  diffuseColor.rgb *= col;
  // sky occlusion: under the canopy the ground sees little sky (and the trees' own green bounce)
  tAO = 1.0 - 0.6 * clamp( forest * 1.2, 0.0, 1.0 ) * ( 1.0 - farF * 0.5 );
  tRough = mix( 0.93, 0.97, forest );
  tRough = mix( tRough, 0.86, lawn * ( 1.0 - forest ) );
  tRough = mix( tRough, 0.82, pv );
  tRough = mix( tRough, tRough * mix( 0.75, 0.45, soil ), wet );
  tRough = mix( tRough, 0.06, pud );
  float dStr = nearF * ( 0.6 + 0.4 * ( 1.0 - pv ) ) * ( 1.0 - pud );
  vec3 dn1 = texture2D( uDetailN, p * 0.31 ).rgb * 2.0 - 1.0;
  vec3 dn2 = texture2D( uDetailN, mat2( 0.6, 0.8, -0.8, 0.6 ) * p * 0.083 ).rgb * 2.0 - 1.0;
  tDetailN = vec3( dn1.x + dn2.x * 0.8, 0.0, dn1.y + dn2.y * 0.8 ) * ( 0.45 + 0.35 * forest ) * dStr;
  // rain rings in the puddles
  if ( pud > 0.01 && uRain > 0.01 ) {
    vec2 rp = p * 1.6;
    vec2 ci = floor( rp );
    vec2 cf = fract( rp ) - 0.5;
    float ph = fract( uWTime * 0.9 + h21( ci ) );
    float r = length( cf - ( vec2( h21( ci + 3.1 ), h21( ci + 7.7 ) ) - 0.5 ) * 0.4 );
    float ring = sin( ( r - ph * 0.5 ) * 60.0 ) * smoothstep( 0.5, 0.0, r ) * ( 1.0 - ph );
    tDetailN += vec3( cf.x, 0.0, cf.y ) * ring * 0.9 * pud * uRain;
  }
}
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = tRough;`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= tAO * mix( vec3( 1.0 ), vec3( 0.9, 1.05, 0.8 ), 1.0 - tAO );
reflectedLight.indirectSpecular *= tAO * tAO;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 nW = normalize( vWNormal + tDetailN );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      );
  };
  material.customProgramCacheKey = () => 'apex-park-terrain-v4';
  return { material, uniforms };
}

interface GridSource {
  heights: Float32Array;
  W: number;
  H: number;
  x0: number;
  z0: number;
  cell: number;
}

function buildChunk(
  map: WorldMap,
  g: GridSource,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  skipCell: (x: number, z: number) => boolean,
  skirt: { x0?: boolean; x1?: boolean; z0?: boolean; z1?: boolean },
): THREE.BufferGeometry | null {
  const nx = i1 - i0 + 1;
  const nz = j1 - j0 + 1;
  const vcount = nx * nz;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const C = g.cell;
  const hAt = (i: number, j: number) => {
    if (i >= 0 && j >= 0 && i < g.W && j < g.H) return g.heights[j * g.W + i];
    return map.height(g.x0 + i * C, g.z0 + j * C);
  };
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const v = (j - j0) * nx + (i - i0);
      pos[v * 3] = g.x0 + i * C;
      pos[v * 3 + 1] = g.heights[j * g.W + i];
      pos[v * 3 + 2] = g.z0 + j * C;
      const hx = hAt(i + 1, j) - hAt(i - 1, j);
      const hz = hAt(i, j + 1) - hAt(i, j - 1);
      const L = Math.hypot(hx, 2 * C, hz);
      nor[v * 3] = -hx / L;
      nor[v * 3 + 1] = (2 * C) / L;
      nor[v * 3 + 2] = -hz / L;
    }
  const idx: number[] = [];
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const x = g.x0 + (i + 0.5) * C, z = g.z0 + (j + 0.5) * C;
      if (skipCell(x, z)) continue;
      const a = (j - j0) * nx + (i - i0);
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, d, b, a, c, d);
    }
  if (idx.length === 0) return null;
  const extraPos: number[] = [];
  const extraNor: number[] = [];
  let next = vcount;
  const addSkirt = (verts: number[], flip: boolean) => {
    for (let q = 0; q < verts.length - 1; q++) {
      const va = verts[q], vb = verts[q + 1];
      for (const v of [va, vb]) {
        extraPos.push(pos[v * 3], pos[v * 3 + 1] - 3, pos[v * 3 + 2]);
        extraNor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
      }
      const sa = next++, sb = next++;
      if (flip) idx.push(va, sb, vb, va, sa, sb);
      else idx.push(va, vb, sb, va, sb, sa);
    }
  };
  if (skirt.z0) addSkirt(Array.from({ length: nx }, (_, i) => i), false);
  if (skirt.z1) addSkirt(Array.from({ length: nx }, (_, i) => (nz - 1) * nx + i), true);
  if (skirt.x0) addSkirt(Array.from({ length: nz }, (_, j) => j * nx), true);
  if (skirt.x1) addSkirt(Array.from({ length: nz }, (_, j) => j * nx + nx - 1), false);

  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(pos.length + extraPos.length);
  P.set(pos);
  P.set(extraPos, pos.length);
  const Nn = new Float32Array(nor.length + extraNor.length);
  Nn.set(nor);
  Nn.set(extraNor, nor.length);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  geo.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function buildTerrain(map: WorldMap, maxAniso: number): TerrainBuild {
  const { SQUARE, FINE, FAR } = map;
  const group = new THREE.Group();
  group.name = 'Terrain';
  const { material, uniforms } = createTerrainMaterial(maxAniso);

  const addMesh = (geo: THREE.BufferGeometry | null, name: string) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    group.add(m);
  };

  // fine chunks (4 m, 250 cells = 1 km)
  {
    const g: GridSource = { heights: map.fine, W: map.fineW, H: map.fineH, x0: FINE.x0, z0: FINE.z0, cell: FINE_CELL };
    const CH = 250;
    for (let j0 = 0; j0 < g.H - 1; j0 += CH)
      for (let i0 = 0; i0 < g.W - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, g.W - 1);
        const j1 = Math.min(j0 + CH, g.H - 1);
        addMesh(buildChunk(map, g, i0, j0, i1, j1, () => false, { x0: i0 === 0, x1: i1 === g.W - 1, z0: j0 === 0, z1: j1 === g.H - 1 }), `terrain_fine_${i0}_${j0}`);
      }
  }
  // mid chunks (16 m, 128 cells = 2 km), skipping the fine region
  {
    const g: GridSource = { heights: map.mid, W: map.midW, H: map.midH, x0: SQUARE.x0, z0: SQUARE.z0, cell: MID_CELL };
    const CH = 128;
    const inFine = (x: number, z: number) => x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1;
    for (let j0 = 0; j0 < g.H - 1; j0 += CH)
      for (let i0 = 0; i0 < g.W - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, g.W - 1);
        const j1 = Math.min(j0 + CH, g.H - 1);
        addMesh(buildChunk(map, g, i0, j0, i1, j1, inFine, {}), `terrain_mid_${i0}_${j0}`);
      }
  }
  // far ring (256 m)
  {
    const g: GridSource = { heights: map.far, W: map.farW, H: map.farH, x0: FAR.x0, z0: FAR.z0, cell: FAR_CELL };
    const inSquare = (x: number, z: number) => x > SQUARE.x0 && x < SQUARE.x1 && z > SQUARE.z0 && z < SQUARE.z1;
    addMesh(buildChunk(map, g, 0, 0, g.W - 1, g.H - 1, inSquare, {}), 'terrain_far');
  }
  return {
    group,
    material,
    uniforms,
    setMasks(m: ParkMasks) {
      uniforms.uMaskFine.value = m.fine;
      uniforms.uMaskTrack.value = m.track;
      uniforms.uMaskCoarse.value = m.coarse;
      (uniforms.uFineO.value as THREE.Vector2).set(m.fineBounds.x0, m.fineBounds.z0);
      (uniforms.uFineS.value as THREE.Vector2).set(m.fineBounds.x1 - m.fineBounds.x0, m.fineBounds.z1 - m.fineBounds.z0);
      (uniforms.uSqO.value as THREE.Vector2).set(m.coarseBounds.x0, m.coarseBounds.z0);
      (uniforms.uSqS.value as THREE.Vector2).set(m.coarseBounds.x1 - m.coarseBounds.x0, m.coarseBounds.z1 - m.coarseBounds.z0);
      (uniforms.uCenter.value as THREE.Vector2).set((m.coarseBounds.x0 + m.coarseBounds.x1) / 2, (m.coarseBounds.z0 + m.coarseBounds.z1) / 2);
    },
  };
}
