import * as THREE from 'three';
import { makeGroundTextures, ASPHALT_TILE, GRASS_TILE } from '../../world/trackside/textures.ts';
import { noiseTexture } from '../../world/env/textures.ts';
import { weatherUniforms } from '../../world/weatherUniforms.ts';

/**
 * The city's ground materials. All are MeshStandardMaterials patched in onBeforeCompile (so they
 * keep three's lighting, the cascaded sun shadows, the aerial fog, the race game's headlight and
 * the city's streetlight terms), textured in world space so nothing ever shows a seam:
 *
 *   road      — the Poly Haven asphalt scan (the race tracks' road), sun-bleached and patched, with
 *               the lane paint drawn from the ribbon's own coordinates (double yellow, dashed lane
 *               lines, edge lines, stop lines, continental crosswalks at every junction), worn in the
 *               wheel tracks; wet: darker, glossy, puddles in the dips
 *   sidewalk  — poured concrete slabs with sawn joints, a curb, stains; Brickell's pavers
 *   lawn      — the ambientCG grass scan, lush and dry patches
 *   sand      — fine white Miami Beach sand, rippled, wet near the water
 */

const shared = {
  uNoise: { value: null as THREE.Texture | null },
};

let tex: ReturnType<typeof makeGroundTextures> | null = null;
function T() {
  if (!tex) {
    tex = makeGroundTextures(8);
    shared.uNoise.value = noiseTexture();
  }
  return tex;
}

const WORLD_VARYINGS = /* glsl */ `
varying vec3 vCW;
`;

function patchWorld(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvCW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`);
}

const HASH = /* glsl */ `
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
`;

// ------------------------------------------------------------------------------------------ road

/**
 * Road ribbons carry aRUV (lateral m, along m), aRSpec (lanes per direction, half median, parking,
 * shoulder) and aREnd (length, crosswalk at the start, at the end, 1 = highway paint).
 * Junction pads pass lanes = 0: plain asphalt.
 */
export function roadMaterial(): THREE.MeshStandardMaterial {
  const t = T();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -4;
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, {
      uAsph: { value: t.asphalt },
      uAsphMean: { value: t.asphaltMean },
      uMacro: { value: t.macro },
      uNoise: shared.uNoise,
      uWet: weatherUniforms.uWetness,
      uRain: weatherUniforms.uRain,
      uWTime: weatherUniforms.uWeatherTime,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aRUV;\nattribute vec4 aRSpec;\nattribute vec4 aREnd;\nvarying vec2 vRUV;\nvarying vec4 vRSpec;\nvarying vec4 vREnd;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRUV = aRUV;\nvRSpec = aRSpec;\nvREnd = aREnd;`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uAsph;
uniform vec2 uAsphMean;
uniform sampler2D uMacro;
uniform sampler2D uNoise;
uniform float uWet, uRain, uWTime;
varying vec2 vRUV;
varying vec4 vRSpec;
varying vec4 vREnd;
${HASH}
float band( float x, float c, float w ) { float aa = fwidth( x ) * 0.75 + 1e-4; return smoothstep( w * 0.5 + aa, w * 0.5 - aa, abs( x - c ) ); }
float dashes( float s, float on, float period ) { float aa = fwidth( s ) + 1e-3; float f = mod( s, period ); return smoothstep( 0.0, aa, f ) * smoothstep( on + aa, on, f ); }
vec4 roadPaint;
float roadRough;
vec3 roadN;`,
      )
      .replace(
        '#include <map_fragment>',
        `
vec2 aw = vCW.xz / ${ASPHALT_TILE.toFixed(2)};
vec4 a1 = texture2D( uAsph, aw );
vec4 a2 = texture2D( uAsph, mat2( 0.6, -0.8, 0.8, 0.6 ) * aw * 0.73 + 0.31 );
// histogram-preserving blend of two scales (the scan never tiles)
float bw = texture2D( uNoise, vCW.xz * 0.011 ).g;
float albR = mix( a1.r, a2.r, bw );
float hgt = mix( a1.g, a2.g, bw );
roadN = vec3( mix( a1.ba, a2.ba, bw ) * 2.0 - 1.0, 1.0 );
float alb = albR * albR * 0.16;
// sun-bleached city asphalt: lighter, greyer than a racing surface; patches, repairs, oil
vec4 mac = texture2D( uMacro, vCW.xz * 0.0137 );
vec4 mac2 = texture2D( uMacro, vCW.xz * 0.061 + 0.4 );
float age = smoothstep( 0.25, 0.75, mac.r );
// (Miami's streets are bleached grey by the sun: aged asphalt sits near 0.12-0.16 albedo)
alb = alb * mix( 1.7, 2.6, age ) + 0.034;
// the aggregate catches the light: a fine speckle of lighter stones
alb += 0.05 * smoothstep( 0.72, 0.95, hgt ) * smoothstep( 0.4, 0.9, texture2D( uNoise, vCW.xz * 2.7 ).r );
// patched trenches and repairs: darker newer blacktop in rectangles
vec2 cell = floor( vCW.xz / vec2( 11.0, 7.0 ) );
float rp = h21( cell );
if ( rp > 0.93 ) alb *= 0.62;
// sealed cracks
alb *= 1.0 - 0.45 * smoothstep( 0.55, 0.85, mac2.g );
vec3 col = vec3( alb ) * vec3( 1.0, 0.99, 0.965 );
roadRough = 0.9 - 0.12 * hgt;
roadPaint = vec4( 0.0 );
float lanes = vRSpec.x;
if ( lanes > 0.5 ) {
  float x = vRUV.x, s = vRUV.y, ax = abs( x );
  float med = vRSpec.y, park = vRSpec.z, shoulder = vRSpec.w;
  float hw = med + lanes * ${(3.4).toFixed(2)} + park + shoulder;
  float hwy = vREnd.w;
  float len = vREnd.x;
  // the wheel tracks: darker, polished, oil in the middle of each lane
  float lp = fract( ( ax - med ) / 3.4 );
  float wheel = exp( -pow( ( lp - 0.25 ) * 9.0, 2.0 ) ) + exp( -pow( ( lp - 0.75 ) * 9.0, 2.0 ) );
  float oil = exp( -pow( ( lp - 0.5 ) * 7.0, 2.0 ) ) * smoothstep( 0.35, 0.8, mac2.b );
  if ( ax > med && ax < med + lanes * 3.4 ) {
    col *= 1.0 - 0.1 * wheel - 0.22 * oil;
    roadRough -= 0.08 * wheel;
  }
  float paintW = 0.0, paintY = 0.0;
  // centre: double yellow (no median), or yellow edge lines either side of a median
  if ( med < 0.05 ) paintY = max( band( x, -0.17, 0.11 ), band( x, 0.17, 0.11 ) );
  else paintY = band( ax, med - 0.25, 0.14 );
  // lane lines
  for ( int k = 1; k < 4; k ++ ) {
    if ( float( k ) >= lanes ) break;
    float c = med + float( k ) * 3.4;
    paintW = max( paintW, band( ax, c, 0.12 ) * ( hwy > 0.5 ? dashes( s + 7.0 * float( k ), 3.0, 12.0 ) : dashes( s + 3.0, 3.0, 9.0 ) ) );
  }
  // edge line (the parking lane / shoulder starts here)
  float edgeC = med + lanes * 3.4 + 0.12;
  if ( park + shoulder > 0.2 ) paintW = max( paintW, band( ax, edgeC, hwy > 0.5 ? 0.18 : 0.12 ) );
  // parking bays: a tick every 6.5 m
  if ( park > 0.5 && ax > edgeC && ax < hw - 0.3 ) paintW = max( paintW, band( mod( s, 6.5 ), 0.1, 0.1 ) * 0.9 );
  // junction ends: the stop line on the arriving side, then the crosswalk across the whole road
  float c0 = vREnd.y, c1 = vREnd.z;
  float stopW = 0.45;
  if ( c0 > 0.5 ) {
    // arriving at the start = travelling b → a, on the left (x < 0)
    paintW = max( paintW, band( s, 5.2, stopW ) * step( x, -med ) * step( -hw + park + shoulder, x ) );
    float cw = band( s, 2.6, 3.0 ) * step( 0.2, mod( x + 30.0, 1.2 ) ) * step( mod( x + 30.0, 1.2 ), 0.8 ) * step( ax, hw - 0.2 );
    paintW = max( paintW, cw );
    yellowOff: ;
  }
  if ( c1 > 0.5 ) {
    paintW = max( paintW, band( len - s, 5.2, stopW ) * step( med, x ) * step( x, hw - park - shoulder ) );
    float cw = band( len - s, 2.6, 3.0 ) * step( 0.2, mod( x + 30.0, 1.2 ) ) * step( mod( x + 30.0, 1.2 ), 0.8 ) * step( ax, hw - 0.2 );
    paintW = max( paintW, cw );
  }
  // the paint wears: thinner in the wheel tracks, flecked everywhere
  float wear = smoothstep( 0.25, 0.65, texture2D( uNoise, vCW.xz * 0.9 ).b + 0.2 * wheel );
  paintW *= 1.0 - 0.55 * wear;
  paintY *= 1.0 - 0.4 * wear;
  // no paint on the crosswalk where the yellow would run through it
  if ( ( c0 > 0.5 && s < 4.4 ) || ( c1 > 0.5 && len - s < 4.4 ) ) paintY = 0.0;
  col = mix( col, vec3( 0.62, 0.62, 0.6 ), paintW );
  col = mix( col, vec3( 0.62, 0.42, 0.06 ), paintY );
  roadRough = mix( roadRough, 0.62, max( paintW, paintY ) );
  roadPaint = vec4( paintW, paintY, 0.0, 0.0 );
}
// wet: darker, glossy, standing water in the dips
float puddle = smoothstep( 0.55, 0.75, mac.b + ( 1.0 - hgt ) * 0.15 ) * smoothstep( 0.2, 0.7, uWet );
col *= mix( 1.0, 0.55, smoothstep( 0.0, 0.5, uWet ) );
roadRough = mix( roadRough, 0.22, smoothstep( 0.0, 0.6, uWet ) );
roadRough = mix( roadRough, 0.03, puddle );
diffuseColor.rgb *= col;
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * roadRough;`)
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec3 nW = normalize( vec3( roadN.x * 0.9, 1.0, roadN.y * 0.9 ) );
  nW = normalize( mix( nW, vec3( 0.0, 1.0, 0.0 ), max( roadPaint.x, roadPaint.y ) * 0.6 + smoothstep( 0.4, 0.9, uWet ) * 0.5 ) );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      )
      .replace('yellowOff: ;', '');
  };
  m.customProgramCacheKey = () => 'ow-road-v2';
  return m;
}

// ------------------------------------------------------------------------------------------ sidewalk

/** aSUV: across (m from the curb), along (m); aSKind: 0 concrete, 1 pavers, 2 curb face */
export function sidewalkMaterial(): THREE.MeshStandardMaterial {
  T();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, { uNoise: shared.uNoise, uWet: weatherUniforms.uWetness, uMacro: { value: T().macro } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aSUV;\nattribute float aSKind;\nvarying vec2 vSUV;\nvarying float vSKind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSUV = aSUV;\nvSKind = aSKind;`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNoise;
uniform sampler2D uMacro;
uniform float uWet;
varying vec2 vSUV;
varying float vSKind;
${HASH}
float swR;
vec3 swN;`,
      )
      .replace(
        '#include <map_fragment>',
        `
vec2 q = vSUV;
// corner pads have no ribbon coordinates: the world's
if ( q.x < -50.0 ) q = vCW.xz;
vec4 nz = texture2D( uNoise, vCW.xz * 0.05 );
vec4 nz2 = texture2D( uNoise, vCW.xz * 0.31 );
vec4 mac = texture2D( uMacro, vCW.xz * 0.02 );
vec3 col;
swR = 0.86;
swN = vec3( 0.0, 1.0, 0.0 );
if ( vSKind > 1.5 ) {
  // curb: a painted face, darker grime at the gutter
  col = vec3( 0.55, 0.54, 0.51 ) * ( 0.82 + 0.25 * nz2.b );
} else if ( vSKind > 0.5 ) {
  // Brickell's pavers: terracotta and sand herringbone-ish bricks
  vec2 b = q / vec2( 0.2, 0.1 );
  b.x += floor( b.y ) * 0.5;
  vec2 f = fract( b );
  float joint = smoothstep( 0.0, 0.08, f.x ) * smoothstep( 1.0, 0.92, f.x ) * smoothstep( 0.0, 0.14, f.y ) * smoothstep( 1.0, 0.86, f.y );
  float tone = h21( floor( b ) );
  col = mix( vec3( 0.5, 0.42, 0.36 ), vec3( 0.66, 0.6, 0.52 ), step( 0.55, tone ) ) * ( 0.85 + 0.25 * tone );
  col *= mix( 0.55, 1.0, joint );
  swN = normalize( vec3( ( f.x - 0.5 ) * ( 1.0 - joint ) * 0.6, 1.0, ( f.y - 0.5 ) * ( 1.0 - joint ) * 0.6 ) );
} else {
  // poured concrete: 1.5 m slabs with sawn joints, each slab its own tone
  vec2 sl = q / vec2( 1.5, 1.5 );
  vec2 f = fract( sl );
  float jx = smoothstep( 0.0, 0.012, f.x ) * smoothstep( 1.0, 0.988, f.x );
  float jy = smoothstep( 0.0, 0.012, f.y ) * smoothstep( 1.0, 0.988, f.y );
  float tone = h21( floor( sl ) );
  col = vec3( 0.6, 0.585, 0.55 ) * ( 0.86 + 0.14 * tone ) * ( 0.88 + 0.22 * nz2.g );
  col *= mix( 0.6, 1.0, jx * jy );
  // gum spots and stains, darker by the curb
  col *= 1.0 - 0.25 * smoothstep( 0.62, 0.8, nz.a );
  col *= 1.0 - 0.18 * smoothstep( 1.2, 0.0, q.x ) * ( q.x > -50.0 ? 1.0 : 0.0 );
  swN = normalize( vec3( ( 1.0 - jx ) * 0.3, 1.0, ( 1.0 - jy ) * 0.3 ) );
}
col *= mix( 1.0, 0.62, smoothstep( 0.0, 0.5, uWet ) );
swR = mix( 0.86, 0.35, smoothstep( 0.1, 0.8, uWet ) );
diffuseColor.rgb *= col;
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = swR;`)
      .replace(
        '#include <normal_fragment_maps>',
        `if ( vSKind < 1.5 ) normal = normalize( ( viewMatrix * vec4( swN, 0.0 ) ).xyz );`,
      );
  };
  m.customProgramCacheKey = () => 'ow-sidewalk-v1';
  return m;
}

// ------------------------------------------------------------------------------------------ lawn

export function lawnMaterial(): THREE.MeshStandardMaterial {
  const t = T();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, { uGrass: { value: t.grassAlbedo }, uGrassN: { value: t.grassNormal }, uNoise: shared.uNoise, uWet: weatherUniforms.uWetness, uMacro: { value: t.macro } });
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uGrass, uGrassN, uNoise, uMacro;
uniform float uWet;
vec3 lawnN;`,
      )
      .replace(
        '#include <map_fragment>',
        `
vec2 gw = vCW.xz / ${GRASS_TILE.toFixed(2)};
vec3 g1 = texture2D( uGrass, gw ).rgb;
vec3 g2 = texture2D( uGrass, mat2( 0.8, 0.6, -0.6, 0.8 ) * gw * 0.37 ).rgb;
vec4 nz = texture2D( uNoise, vCW.xz * 0.004 );
vec4 nz2 = texture2D( uNoise, vCW.xz * 0.03 );
vec3 g = mix( g1, g2, 0.25 );
// the scan's own light / dark blotches read as camouflage at this scale: keep its blade detail,
// pull its large-scale colour to a single St. Augustine green
vec3 gMean = texture2D( uGrass, gw * 0.13, 10.0 ).rgb;
float gl = dot( g - gMean, vec3( 0.3, 0.55, 0.15 ) );
g = vec3( 0.2, 0.3, 0.1 ) * 1.05 + vec3( 0.8, 1.0, 0.55 ) * gl * 0.55;
g *= 0.9 + 0.2 * texture2D( uNoise, vCW.xz * 0.05 ).g;
// St. Augustine lawns: deep green, yellowed patches in the sun, bare sandy earth where people walk
float dry = smoothstep( 0.45, 0.95, nz.r * 0.85 + nz2.g * 0.15 );
g *= mix( vec3( 0.94, 1.0, 0.86 ), vec3( 1.03, 1.02, 0.86 ), dry * 0.4 );
float bare = smoothstep( 0.78, 0.92, nz2.a ) * ( 1.0 - smoothstep( 60.0, 400.0, length( vCW - cameraPosition ) ) );
g = mix( g, vec3( 0.36, 0.3, 0.22 ), bare * 0.12 );
g *= 0.96 + 0.06 * nz2.b;
g *= mix( 1.0, 0.7, smoothstep( 0.0, 0.6, uWet ) );
lawnN = texture2D( uGrassN, gw ).xyz * 2.0 - 1.0;
diffuseColor.rgb *= g;
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  float fade = 1.0 - smoothstep( 20.0, 140.0, length( vCW - cameraPosition ) );
  vec3 nW = normalize( vec3( lawnN.x * 0.8 * fade, 1.0, lawnN.y * 0.8 * fade ) );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      );
  };
  m.customProgramCacheKey = () => 'ow-lawn-v4';
  return m;
}

// ------------------------------------------------------------------------------------------ sand

/** aShoreD: metres from the waterline (negative = under water) */
export function sandMaterial(): THREE.MeshStandardMaterial {
  T();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, { uNoise: shared.uNoise, uWet: weatherUniforms.uWetness, uMacro: { value: T().macro } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aShoreD;\nvarying float vShoreD;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvShoreD = aShoreD;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uNoise, uMacro;\nuniform float uWet;\nvarying float vShoreD;\nfloat sandR;\nvec3 sandN;`)
      .replace(
        '#include <map_fragment>',
        `
vec4 nz = texture2D( uNoise, vCW.xz * 0.02 );
vec4 nz2 = texture2D( uNoise, vCW.xz * 0.37 );
vec4 nz3 = texture2D( uNoise, vCW.xz * 2.3 );
vec3 col = vec3( 0.86, 0.8, 0.68 ) * ( 0.9 + 0.12 * nz.g ) * ( 0.94 + 0.1 * nz3.b );
// footprints and raked sand: tiny dark dimples; wind ripples further back
float rip = sin( vCW.x * 2.6 + nz.r * 9.0 + vCW.z * 0.8 ) * 0.5 + 0.5;
sandN = normalize( vec3( ( nz3.r - 0.5 ) * 0.35 + ( rip - 0.5 ) * 0.12, 1.0, ( nz3.g - 0.5 ) * 0.35 ) );
// wet sand near the water: darker, glossy; the wash line
float wet = 1.0 - smoothstep( 0.0, 14.0, vShoreD + nz2.r * 4.0 );
col *= mix( 1.0, 0.58, wet );
col = mix( col, col * vec3( 0.95, 0.96, 0.97 ), wet );
// seaweed line at the high-water mark
float weed = smoothstep( 0.6, 0.0, abs( vShoreD - 16.0 - nz.b * 6.0 ) ) * smoothstep( 0.5, 0.8, nz2.a );
col = mix( col, vec3( 0.18, 0.13, 0.07 ), weed * 0.6 );
sandR = mix( 0.95, 0.38, wet );
col *= mix( 1.0, 0.75, smoothstep( 0.0, 0.6, uWet ) );
diffuseColor.rgb *= col;
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = sandR;`)
      .replace('#include <normal_fragment_maps>', `normal = normalize( ( viewMatrix * vec4( sandN, 0.0 ) ).xyz );`);
  };
  m.customProgramCacheKey = () => 'ow-sand-v1';
  return m;
}

// ------------------------------------------------------------------------------------------ concrete & rock

/** board-formed / poured concrete in world space (decks, pillars, seawalls, barriers) */
export function concreteMaterial(tint = 0xcfcac0, rough = 0.85, stains = true): THREE.MeshStandardMaterial {
  T();
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: rough, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, { uNoise: shared.uNoise, uWet: weatherUniforms.uWetness });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uNoise;\nuniform float uWet;`)
      .replace(
        '#include <map_fragment>',
        `
vec4 cn = texture2D( uNoise, vCW.xz * 0.05 + vCW.y * 0.03 );
vec4 cn2 = texture2D( uNoise, vec2( vCW.x + vCW.z, vCW.y ) * 0.21 );
float tone = 0.86 + 0.18 * cn.g + 0.08 * cn2.b;
${stains ? `// rain streaks run down from every ledge; algae at the waterline
float streak = smoothstep( 0.55, 0.85, texture2D( uNoise, vec2( ( vCW.x + vCW.z ) * 0.35, vCW.y * 0.02 ) ).r );
tone *= 1.0 - 0.22 * streak;
float alg = smoothstep( ${(-0.2).toFixed(1)}, -1.6, vCW.y ) * smoothstep( -3.5, -1.2, vCW.y );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.18, 0.2, 0.12 ), alg * 0.75 );` : ''}
diffuseColor.rgb *= tone * mix( 1.0, 0.7, smoothstep( 0.0, 0.6, uWet ) );
`,
      );
  };
  m.customProgramCacheKey = () => `ow-concrete-${stains}`;
  return m;
}

/** rip-rap (the causeways' rock armour) */
export function rockMaterial(): THREE.MeshStandardMaterial {
  T();
  const m = new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, { uNoise: shared.uNoise });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uNoise;\nvec3 rkN;`)
      .replace(
        '#include <map_fragment>',
        `
vec4 r1 = texture2D( uNoise, vCW.xz * 0.6 + vCW.y * 0.3 );
vec4 r2 = texture2D( uNoise, vCW.xz * 0.15 );
float boulder = smoothstep( 0.35, 0.75, r1.a );
diffuseColor.rgb *= ( 0.55 + 0.6 * boulder ) * ( 0.85 + 0.25 * r2.g );
float wetline = smoothstep( -0.4, -1.3, vCW.y );
diffuseColor.rgb *= mix( 1.0, 0.45, wetline );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.14, 0.08 ), wetline * 0.5 );
rkN = normalize( vec3( ( r1.r - 0.5 ) * 1.6, 1.0, ( r1.g - 0.5 ) * 1.6 ) );
`,
      )
      .replace('#include <normal_fragment_maps>', `normal = normalize( normal + ( viewMatrix * vec4( rkN - vec3( 0.0, 1.0, 0.0 ), 0.0 ) ).xyz * 0.8 );`);
  };
  m.customProgramCacheKey = () => 'ow-rock-v1';
  return m;
}

// ------------------------------------------------------------------------------------------ block ground

/** aLot: x, y = metres along the lot's own axes, z = kind (0 concrete plaza, 1 car park, 2 pavers) */
export function lotMaterial(): THREE.MeshStandardMaterial {
  const t = T();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  m.onBeforeCompile = (sh) => {
    patchWorld(sh);
    Object.assign(sh.uniforms, { uNoise: shared.uNoise, uAsph: { value: t.asphalt }, uMacro: { value: t.macro }, uWet: weatherUniforms.uWetness });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aLot;\nvarying vec3 vLot;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLot = aLot;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uNoise, uAsph, uMacro;\nuniform float uWet;\nvarying vec3 vLot;\n${HASH}\nfloat lotR;`)
      .replace(
        '#include <map_fragment>',
        `
vec2 q = vLot.xy;
vec4 nz = texture2D( uNoise, vCW.xz * 0.04 );
vec3 col;
lotR = 0.86;
if ( vLot.z < 0.5 ) {
  // plaza: big light stone slabs
  vec2 f = fract( q / 3.0 );
  float j = smoothstep( 0.0, 0.01, f.x ) * smoothstep( 1.0, 0.99, f.x ) * smoothstep( 0.0, 0.01, f.y ) * smoothstep( 1.0, 0.99, f.y );
  col = vec3( 0.66, 0.64, 0.6 ) * ( 0.9 + 0.12 * h21( floor( q / 3.0 ) ) ) * mix( 0.7, 1.0, j );
  lotR = 0.7;
} else if ( vLot.z < 1.5 ) {
  // car park: the asphalt scan, stall lines every 2.7 m in rows 5.5 m deep
  vec4 a = texture2D( uAsph, vCW.xz / 2.0 );
  col = vec3( a.r * a.r * 0.16 * 1.6 + 0.02 );
  vec2 st = vec2( mod( q.x, 2.7 ), mod( q.y, 13.0 ) );
  float line = smoothstep( 0.08, 0.04, abs( st.x - 0.05 ) ) * step( st.y, 5.4 ) + smoothstep( 0.08, 0.04, abs( st.x - 0.05 ) ) * step( 7.6, st.y );
  col = mix( col, vec3( 0.7 ), clamp( line, 0.0, 1.0 ) * 0.85 );
  col *= 1.0 - 0.3 * smoothstep( 0.6, 0.85, texture2D( uMacro, vCW.xz * 0.05 ).b );
  lotR = 0.9;
} else {
  vec2 b = q / vec2( 0.4, 0.2 );
  b.x += floor( b.y ) * 0.5;
  vec2 f = fract( b );
  float joint = smoothstep( 0.0, 0.06, f.x ) * smoothstep( 1.0, 0.94, f.x ) * smoothstep( 0.0, 0.12, f.y ) * smoothstep( 1.0, 0.88, f.y );
  col = vec3( 0.74, 0.68, 0.6 ) * ( 0.85 + 0.2 * h21( floor( b ) ) ) * mix( 0.6, 1.0, joint );
}
col *= 0.9 + 0.15 * nz.g;
col *= mix( 1.0, 0.62, smoothstep( 0.0, 0.5, uWet ) );
lotR = mix( lotR, 0.3, smoothstep( 0.1, 0.8, uWet ) );
diffuseColor.rgb *= col;
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = lotR;`);
  };
  m.customProgramCacheKey = () => 'ow-lot-v1';
  return m;
}
