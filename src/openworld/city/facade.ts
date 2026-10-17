import * as THREE from 'three';
import { noiseTexture } from '../../world/env/textures.ts';
import { weatherUniforms } from '../../world/weatherUniforms.ts';

/**
 * One material for every building wall in Miami. Walls are plain quads (a tower's whole height is
 * one quad per side); the facade is drawn per pixel from the wall's own coordinates:
 *
 *   aFUV   u = metres along the building's perimeter, v = metres above its base
 *   aFac   style, floor height, bay width, seed
 *   aFPal  wall colour index, glass colour index, ground-floor height, height of the roof
 *
 * Styles: 0 condo (floor-to-ceiling glass, white slab edges and glass balcony rails — Miami's
 * signature), 1 office curtain wall (mullions, spandrels), 2 punched windows in stucco/concrete,
 * 3 art deco (pastel, eyebrow ledges, glass-block strips), 4 parking garage (open decks), 5 shop
 * fronts (one floor of glass, a sign band), 6 vertical fins, 7 blank (mechanical, podium sides),
 * 8 house (stucco, a few windows with frames).
 *
 * Behind every window is a room (interior mapping: the view ray traced through a box the size of
 * the bay × floor × 7 m), its walls, floor and ceiling a colour of their own; after dark a share of
 * them are lit — warm, cool, the blue flicker of a television — and a tower's crown can carry an
 * LED band. The glass itself reflects the sky (and the captured city) through three's own IBL with a
 * coated-glass Fresnel.
 */

export const WALL_PAL = [
  [0.86, 0.85, 0.82], // 0 white concrete
  [0.78, 0.76, 0.72], // 1 light grey
  [0.55, 0.55, 0.54], // 2 mid grey
  [0.82, 0.74, 0.62], // 3 sand stucco
  [0.9, 0.82, 0.68], // 4 cream
  [0.62, 0.84, 0.78], // 5 deco mint
  [0.95, 0.72, 0.74], // 6 deco pink
  [0.98, 0.88, 0.55], // 7 deco yellow
  [0.72, 0.78, 0.95], // 8 deco periwinkle
  [0.95, 0.95, 0.93], // 9 deco white
  [0.45, 0.6, 0.78], // 10 deco blue
  [0.74, 0.55, 0.42], // 11 terracotta
  [0.25, 0.26, 0.28], // 12 charcoal (office frames)
  [0.8, 0.64, 0.86], // 13 deco lavender
  [0.94, 0.62, 0.44], // 14 deco coral
  [0.66, 0.7, 0.66], // 15 sage
];
export const GLASS_PAL = [
  [0.1, 0.2, 0.24], // 0 blue-green (the Miami condo glass)
  [0.08, 0.13, 0.2], // 1 deep blue
  [0.16, 0.18, 0.19], // 2 grey
  [0.22, 0.24, 0.24], // 3 silver (reflective)
  [0.06, 0.08, 0.08], // 4 dark
  [0.12, 0.22, 0.2], // 5 green
  [0.24, 0.2, 0.14], // 6 bronze
  [0.18, 0.26, 0.3], // 7 light aqua
];

export const facadeUniforms = {
  uNight: { value: 0 },
  uDay: { value: 1 },
  uFTime: { value: 0 },
};

function palUniform(p: number[][]) {
  return p.map((c) => new THREE.Vector3(c[0], c[1], c[2]));
}

export function facadeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uWallPal: { value: palUniform(WALL_PAL) },
      uGlassPal: { value: palUniform(GLASS_PAL) },
      uNoise: { value: noiseTexture() },
      uWet: weatherUniforms.uWetness,
      ...facadeUniforms,
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aFUV;
attribute vec4 aFac;
attribute vec4 aFPal;
varying vec2 vFUV;
varying vec4 vFac;
varying vec4 vFPal;
varying vec3 vFW;
varying vec3 vFN;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vFUV = aFUV; vFac = aFac; vFPal = aFPal;
vFW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vFN = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uWallPal[ 16 ];
uniform vec3 uGlassPal[ 8 ];
uniform sampler2D uNoise;
uniform float uNight, uDay, uFTime, uWet;
varying vec2 vFUV;
varying vec4 vFac;
varying vec4 vFPal;
varying vec3 vFW;
varying vec3 vFN;
float fh1( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float fh3( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float boxStep( float x, float a, float b ) { float w = fwidth( x ) * 0.8 + 1e-4; return smoothstep( a - w, a + w, x ) * ( 1.0 - smoothstep( b - w, b + w, x ) ); }
vec3 facEmit;
float facRough, facMetal;
vec3 facNudge;
// a room behind the glass: the view ray through a box (bay x floor x depth)
vec3 roomColor( vec2 cellUv, vec2 cellId, vec2 size, float seed, float lit, out float glow ) {
  vec3 N = normalize( vFN );
  vec3 T = normalize( cross( vec3( 0.0, 1.0, 0.0 ), N ) );
  vec3 V = normalize( vFW - cameraPosition );
  vec3 rd = vec3( dot( V, T ), V.y, dot( V, -N ) );
  vec3 rs = vec3( size, 7.0 );
  rd /= rs;
  vec3 ro = vec3( cellUv, 0.0 );
  float tx = rd.x > 0.0 ? ( 1.0 - ro.x ) / rd.x : -ro.x / min( rd.x, -1e-5 );
  float ty = rd.y > 0.0 ? ( 1.0 - ro.y ) / rd.y : -ro.y / min( rd.y, -1e-5 );
  float tz = 1.0 / max( rd.z, 1e-4 );
  float t = min( min( tx, ty ), tz );
  vec3 hp = ro + rd * t;
  float r = fh1( cellId + seed );
  vec3 wallC = mix( vec3( 0.72, 0.68, 0.6 ), vec3( 0.55, 0.6, 0.66 ), step( 0.5, r ) ) * ( 0.7 + 0.5 * fh1( cellId * 1.7 + seed ) );
  vec3 c;
  if ( t == tz ) {
    c = wallC * 0.8;
    // a picture, a shelf, a door: blocks on the back wall
    float art = boxStep( hp.x, 0.3, 0.62 ) * boxStep( hp.y, 0.42, 0.7 ) * step( 0.55, fh1( cellId + 3.3 ) );
    c = mix( c, vec3( 0.25, 0.32, 0.4 ) * ( 0.6 + r ), art );
  } else if ( t == ty ) {
    c = rd.y < 0.0 ? vec3( 0.32, 0.26, 0.2 ) * ( 0.7 + 0.4 * r ) : vec3( 0.86, 0.84, 0.8 );
    // the ceiling's lamp
    if ( rd.y > 0.0 ) c += vec3( 1.2 ) * smoothstep( 0.18, 0.0, length( hp.xz - vec2( 0.5, 0.45 ) ) ) * lit;
  } else {
    c = wallC;
  }
  // furniture silhouettes: a sofa or a desk near the floor
  float furn = step( hp.y, 0.28 ) * step( 0.25, hp.z ) * step( hp.z, 0.75 ) * step( 0.4, fh1( cellId + 9.1 ) );
  c = mix( c, c * 0.35, furn );
  // deeper = darker (by day the room is lit only through its window)
  float depth = hp.z;
  c *= mix( 1.0, 0.45, depth );
  // curtains / blinds half drawn
  float blind = step( 0.62, fh1( cellId + 5.7 ) ) * step( 1.0 - fh1( cellId + 6.2 ) * 0.7, cellUv.y );
  c = mix( c, vec3( 0.85, 0.83, 0.78 ), blind * 0.9 );
  glow = blind;
  return c;
}`,
      )
      .replace(
        '#include <map_fragment>',
        `
float style = vFac.x;
float fh = max( vFac.y, 2.5 );
float bw = max( vFac.z, 0.8 );
float seed = vFac.w;
vec3 wallC = uWallPal[ int( vFPal.x + 0.5 ) ];
vec3 glassC = uGlassPal[ int( vFPal.y + 0.5 ) ];
float groundH = vFPal.z;
float topH = vFPal.w;
float u = vFUV.x, v = vFUV.y;
float gv = v - groundH;
float fl = floor( gv / fh ), fy = fract( gv / fh );
float bay = floor( u / bw ), fx = fract( u / bw );
vec2 cell = vec2( bay, fl );
float rnd = fh1( cell + seed );
vec4 nz = texture2D( uNoise, vec2( u * 0.013, v * 0.013 ) + seed );
float glass = 0.0;
vec3 col = wallC * ( 0.92 + 0.12 * nz.g );
facRough = 0.82;
facMetal = 0.0;
facEmit = vec3( 0.0 );
facNudge = vec3( 0.0 );
float lit = step( fh1( cell * 1.31 + seed * 3.7 ), 0.34 + 0.18 * sin( seed * 7.0 ) ) * uNight;
float litTone = fh1( cell + 17.0 + seed );
vec3 litC = litTone < 0.62 ? vec3( 1.0, 0.72, 0.45 ) : litTone < 0.9 ? vec3( 0.85, 0.92, 1.0 ) : vec3( 0.45, 0.6, 1.0 ) * ( 0.75 + 0.25 * sin( uFTime * 9.0 + rnd * 40.0 ) );
float roomK = 1.0;
bool ground = gv < 0.0;
if ( style < 0.5 ) {
  // condo: slab edge (white), glass rail band, floor-to-ceiling glass
  float slab = 1.0 - boxStep( fy, 0.1, 1.0 );
  float rail = boxStep( fy, 0.1, 0.36 );
  glass = 1.0 - slab;
  col = mix( col, wallC * 1.05, slab );
  // balconies wrap: a slight shadow under each slab
  col *= 1.0 - 0.25 * smoothstep( 0.1, 0.25, fy ) * ( 1.0 - smoothstep( 0.25, 0.4, fy ) ) * glass;
  facNudge.y = slab * 0.0;
  roomK = 1.0 - rail * 0.35;
  // the rails' frosted panels and posts
  float post = boxStep( fract( u / 1.6 ), 0.0, 0.03 ) * rail;
  col = mix( col, wallC, post );
  glass *= 1.0 - post;
} else if ( style < 1.5 ) {
  // curtain wall: vertical mullions, spandrel band over each slab
  float mull = 1.0 - boxStep( fx, 0.03, 0.97 );
  float span = 1.0 - boxStep( fy, 0.22, 1.0 );
  glass = ( 1.0 - mull );
  col = mix( wallC, glassC * 1.6, span );
  roomK = 1.0 - span;
  facNudge.x = mull * 0.4;
} else if ( style < 2.5 ) {
  // punched windows
  float w = boxStep( fx, 0.22, 0.78 ) * boxStep( fy, 0.28, 0.86 );
  glass = w;
  // reveals: the window sits back in the wall
  float rev = boxStep( fx, 0.19, 0.81 ) * boxStep( fy, 0.25, 0.89 ) * ( 1.0 - w );
  col *= 1.0 - 0.35 * rev;
  // sill
  col *= 1.0 + 0.1 * boxStep( fy, 0.23, 0.28 ) * boxStep( fx, 0.18, 0.82 );
} else if ( style < 3.5 ) {
  // art deco: grouped windows, eyebrow ledges throwing a shadow band, a glass-block strip per bay
  float pair = boxStep( fx, 0.12, 0.88 );
  float w = pair * boxStep( fy, 0.3, 0.8 ) * ( 1.0 - boxStep( fx, 0.48, 0.52 ) );
  glass = w;
  float brow = boxStep( fy, 0.82, 0.88 ) * boxStep( fx, 0.06, 0.94 );
  float browShadow = boxStep( fy, 0.74, 0.82 ) * boxStep( fx, 0.08, 0.92 ) * ( 1.0 - w );
  col = mix( col, wallC * 1.12, brow );
  col *= 1.0 - 0.22 * browShadow;
  // the racing stripes and the speed lines of streamline moderne
  float stripe = boxStep( fy, 0.9, 0.96 ) * step( 0.5, fract( seed * 3.1 ) );
  col = mix( col, uWallPal[ int( mod( vFPal.x + 5.0, 16.0 ) ) ] * 0.8, stripe );
  glassC = vec3( 0.1, 0.12, 0.13 );
} else if ( style < 4.5 ) {
  // parking garage: concrete bands, open decks with the dark inside and a car's glint
  float open = boxStep( fy, 0.32, 0.88 );
  float pier = 1.0 - boxStep( fx, 0.04, 0.96 );
  float o = open * ( 1.0 - pier );
  col = mix( col, vec3( 0.06, 0.06, 0.065 ), o );
  float car = o * step( fy, 0.6 ) * step( 0.45, fh1( cell + floor( u / 2.6 ) ) ) * boxStep( fract( u / 2.6 ), 0.1, 0.9 );
  col = mix( col, vec3( 0.18 + 0.3 * fh1( vec2( floor( u / 2.6 ), fl ) ) ), car * 0.8 );
  facEmit += vec3( 1.0, 0.85, 0.6 ) * o * uNight * 0.08 * step( 0.66, fy );
  roomK = 0.0;
} else if ( style < 5.5 ) {
  // shop fronts (the whole wall is the ground floor)
  ground = true;
} else if ( style < 6.5 ) {
  // fins: glass behind deep vertical blades every bay
  float fin = 1.0 - boxStep( fx, 0.08, 0.92 );
  float slab = 1.0 - boxStep( fy, 0.06, 1.0 );
  glass = ( 1.0 - fin ) * ( 1.0 - slab );
  col = mix( col, wallC * 1.05, max( fin, slab ) );
  facNudge.x = fin * 0.5;
} else if ( style < 7.5 ) {
  // blank: panels and joints, louvres near the top
  float joint = 1.0 - boxStep( fract( u / 3.0 ), 0.01, 0.99 ) * boxStep( fract( v / 3.0 ), 0.01, 0.99 );
  col *= 1.0 - 0.18 * joint;
  float louv = step( topH - 3.5, v ) * step( 0.5, fract( v * 4.0 ) );
  col *= 1.0 - 0.3 * louv;
  roomK = 0.0;
} else {
  // house: stucco, windows with white frames and shutters
  float w = boxStep( fx, 0.3, 0.7 ) * boxStep( fy, 0.3, 0.8 );
  float frame = boxStep( fx, 0.27, 0.73 ) * boxStep( fy, 0.27, 0.83 ) * ( 1.0 - w );
  glass = w * step( 0.3, rnd );
  col = mix( col, vec3( 0.92 ), frame * step( 0.3, rnd ) );
}
if ( ground && groundH > 0.5 ) {
  // the street level: a stone base, tall shop glass between piers, a sign band
  float gy = v / max( groundH, 1.0 );
  float pier = 1.0 - boxStep( fract( u / 6.0 ), 0.06, 0.94 );
  float sign = boxStep( gy, 0.82, 0.97 );
  float base = 1.0 - boxStep( gy, 0.05, 1.0 );
  glass = ( 1.0 - pier ) * ( 1.0 - sign ) * ( 1.0 - base ) * step( gy, 1.0 );
  col = mix( vec3( 0.32, 0.31, 0.3 ), wallC * 0.8, pier );
  float sCol = fh1( vec2( floor( u / 6.0 ), seed ) );
  col = mix( col, mix( vec3( 0.08, 0.08, 0.09 ), wallC, step( 0.5, sCol ) ), sign );
  facEmit += mix( vec3( 1.0, 0.85, 0.6 ), vec3( 0.4, 0.9, 1.0 ), step( 0.7, sCol ) ) * sign * uNight * 0.9 * step( 0.4, sCol );
  fl = -1.0;
  fy = gy;
  cell = vec2( floor( u / 6.0 ), -1.0 );
  fx = fract( u / 6.0 );
  bw = 6.0;
  fh = groundH;
  lit = uNight * step( 0.25, fh1( cell + seed ) );
  litC = vec3( 1.0, 0.86, 0.66 );
}
// the crown: an LED band round the top of some towers
float crown = step( topH - 2.2, v ) * step( v, topH - 0.6 ) * step( 0.55, fract( seed * 5.3 ) ) * step( 60.0, topH );
vec3 crownC = fract( seed * 11.0 ) < 0.4 ? vec3( 0.3, 0.75, 1.0 ) : fract( seed * 11.0 ) < 0.7 ? vec3( 0.9, 0.35, 1.0 ) : vec3( 1.0 );
facEmit += crownC * crown * uNight * 3.5;
// dirt: rain streaks from the window corners, darker near the ground
float streak = smoothstep( 0.6, 0.9, texture2D( uNoise, vec2( u * 0.21, v * 0.006 ) + seed ).r );
col *= 1.0 - 0.12 * streak * ( 1.0 - glass );
col *= 1.0 - 0.18 * ( 1.0 - smoothstep( 0.0, 3.0, v ) );
if ( glass > 0.01 ) {
  float glow;
  vec2 cellUv = vec2( fx, fy );
  vec3 room = roomColor( cellUv, cell, vec2( bw, fh ), seed, lit, glow ) * roomK;
  // looking in by day: the room lit by the window; by night its own lamps (or nothing)
  vec3 dayIn = room * 0.16 * uDay;
  vec3 nightIn = room * litC * lit * 1.8 + litC * glow * lit * 0.7;
  // coated glass: a tinted mirror (F0 ≈ the tint), little diffuse; the room shows through it
  vec3 gl = glassC * 1.7;
  col = mix( col, gl, glass );
  facEmit += ( dayIn + nightIn ) * glass * 0.6;
  facRough = mix( facRough, 0.035 + 0.04 * nz.b, glass );
  facMetal = mix( facMetal, 0.78, glass );
}
// wet facades darken
col *= mix( 1.0, 0.8, smoothstep( 0.2, 0.8, uWet ) * ( 1.0 - glass ) );
diffuseColor.rgb = col;
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = facRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = facMetal;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += facEmit;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
// glass panes aren't perfectly flat: a slight per-pane warp breaks the mirror into tiles
if ( glass > 0.01 ) {
  vec3 tw = vec3( fh1( cell + 1.7 ) - 0.5, fh1( cell + 2.9 ) - 0.5, 0.0 ) * 0.035;
  normal = normalize( normal + ( viewMatrix * vec4( tw.x, tw.y, tw.x, 0.0 ) ).xyz );
}`,
      );
  };
  m.customProgramCacheKey = () => 'ow-facade-v1';
  return m;
}

/** roofs: membrane / gravel / white TPO with seams, drains and stains (world space) */
export function roofMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uNoise: { value: noiseTexture() } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aRoof;\nvarying float vRoof;\nvarying vec3 vRW;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvRoof = aRoof;\nvRW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uNoise;\nvarying float vRoof;\nvarying vec3 vRW;`)
      .replace(
        '#include <map_fragment>',
        `
vec4 n1 = texture2D( uNoise, vRW.xz * 0.05 );
vec4 n2 = texture2D( uNoise, vRW.xz * 0.6 );
vec3 c;
if ( vRoof < 0.5 ) c = vec3( 0.72, 0.72, 0.7 ) * ( 0.85 + 0.2 * n2.b );          // white membrane
else if ( vRoof < 1.5 ) c = vec3( 0.42, 0.41, 0.4 ) * ( 0.8 + 0.4 * n2.a );        // gravel
else if ( vRoof < 2.5 ) c = vec3( 0.52, 0.3, 0.2 ) * ( 0.8 + 0.3 * n2.g );          // barrel tile
else c = vec3( 0.35, 0.36, 0.37 );                                                  // dark membrane
// seams every 1.8 m and ponding stains
float seam = smoothstep( 0.04, 0.0, abs( fract( vRW.x / 1.8 ) - 0.5 ) - 0.46 );
c *= 1.0 - 0.08 * seam * step( vRoof, 0.5 );
c *= 1.0 - 0.2 * smoothstep( 0.6, 0.85, n1.r );
// tiles: rows of barrels
if ( vRoof > 1.5 && vRoof < 2.5 ) c *= 0.75 + 0.25 * sin( vRW.x * 14.0 + vRW.z * 2.0 );
diffuseColor.rgb = c;
`,
      );
  };
  m.customProgramCacheKey = () => 'ow-roof-v1';
  return m;
}
