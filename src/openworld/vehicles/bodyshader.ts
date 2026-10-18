import * as THREE from 'three';
import type { ModelSpec } from './fleet.ts';

/**
 * The traffic's bodywork, past the paint: crash damage, panel gaps and road grime, all in the shader
 * so a hundred instanced cars cost nothing extra.
 *
 * Damage: each car carries four dents as instance attributes (aDent0..3: a point on the body in the
 * car's frame and how deep it's pushed in). Within a radius that grows with the depth the skin is
 * pushed toward the middle of the car, crumpled (a ripple, so it reads as bent metal rather than a
 * smooth bowl), its normals tilted into the crater; the paint there is scuffed through to primer and
 * bare steel. Glass near a dent crazes white.
 *
 * Panel gaps: the door shut lines down the sides (front door, B-pillar, rear door), the hood's line
 * across the cowl and along both fenders, the boot lid's — dark hairlines antialiased with fwidth.
 * Grime: the sills and lower panels dusty, some cars filthier than others (by instance).
 */

export const DENT_ATTRS = ['aDent0', 'aDent1', 'aDent2', 'aDent3'] as const;

const VERT_HEAD = /* glsl */ `
attribute vec4 aDent0;
attribute vec4 aDent1;
attribute vec4 aDent2;
attribute vec4 aDent3;
varying vec3 vObjP;
varying vec3 vObjN;
varying float vDent;
varying float vInst;
void dentOne( vec4 D, vec3 p, inout vec3 off, inout vec3 tilt, inout float amt ) {
  if ( D.w <= 0.0 ) return;
  float r = 0.42 + D.w * 2.4;
  vec3 dp = p - D.xyz;
  float d = length( dp );
  float t = clamp( d / r, 0.0, 1.0 );
  float f = 1.0 - t * t * ( 3.0 - 2.0 * t );
  if ( f <= 0.0 ) return;
  // toward the middle of the car (a side hit goes in, a roof landing goes down)
  vec3 n = normalize( vec3( 0.0, 0.62, 0.0 ) - D.xyz );
  float wr = 0.7 + 0.3 * sin( p.x * 23.0 + p.y * 31.0 + p.z * 17.0 ) * sin( p.z * 13.0 - p.x * 7.0 + p.y * 5.0 );
  off += n * D.w * f * wr;
  float slope = D.w * 6.0 * t * ( 1.0 - t ) / r;
  tilt += -dp / max( d, 1e-3 ) * slope * 1.4 + vec3( sin( p.y * 41.0 + p.z * 9.0 ), sin( p.x * 37.0 + p.z * 3.0 ), sin( p.z * 29.0 + p.y * 11.0 ) ) * f * D.w * 1.6;
  amt += D.w * f;
}
`;

const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
vec3 dOff = vec3( 0.0 );
vec3 dTilt = vec3( 0.0 );
float dAmt = 0.0;
dentOne( aDent0, position, dOff, dTilt, dAmt );
dentOne( aDent1, position, dOff, dTilt, dAmt );
dentOne( aDent2, position, dOff, dTilt, dAmt );
dentOne( aDent3, position, dOff, dTilt, dAmt );
objectNormal = normalize( objectNormal + dTilt );
vObjP = position;
vObjN = normal;
vDent = dAmt;
#ifdef USE_INSTANCING
vInst = float( gl_InstanceID );
#else
vInst = 0.0;
#endif
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vObjP;
varying vec3 vObjN;
varying float vDent;
varying float vInst;
float bsHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
float bsNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( bsHash( i ), bsHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( bsHash( i + vec3( 0, 1, 0 ) ), bsHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( bsHash( i + vec3( 0, 0, 1 ) ), bsHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( bsHash( i + vec3( 0, 1, 1 ) ), bsHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
`;

/** per model: where its panels meet (car frame, m) */
export interface Seams {
  /** door shut lines (z), up to four, 99 = none */
  doors: [number, number, number, number];
  /** the hood's rear edge (z) and the boot lid's front edge (z); 99 / −99 = none */
  cowl: number;
  deck: number;
  /** half the hood's / lid's width */
  lidW: number;
  /** the doors run from the sill to the belt (y) */
  sill: number;
  belt: number;
}

export function seamsOf(m: ModelSpec): Seams {
  const hl = m.L / 2, hw = m.W / 2;
  const cowl = m.cowl * hl, roofF = m.roofF * hl, roofR = m.roofR * hl;
  const wz = m.wb / 2, archR = m.wheelR + 0.075;
  const zf = Math.min(cowl - 0.04, wz - archR - 0.06);
  const zr = -wz + archR + 0.06;
  const bp = (roofF + roofR) / 2 + 0.05;
  const N = 99;
  let doors: Seams['doors'] = [zf, bp, zr, N];
  if (m.id === 'coupe') doors = [zf, bp - 0.1, N, N];
  else if (m.id === 'pickup') doors = [zf, (cowl + roofR) / 2 - 0.1, roofR - 0.02, N];
  else if (m.id === 'van') doors = [zf, zf - 0.95, zf - 1.05, zf - 2.3];
  else if (m.id === 'bus') doors = [N, N, N, N];
  const lidded = m.id === 'sedan' || m.id === 'taxi' || m.id === 'police' || m.id === 'coupe';
  return {
    doors,
    cowl: m.id === 'bus' || m.id === 'van' ? N : cowl + 0.03,
    deck: lidded ? m.deck * hl - 0.03 : -N,
    lidW: hw * 0.78,
    sill: m.clear + 0.1,
    belt: m.beltH + 0.01,
  };
}

/** the paint (or the stainless truck's bare steel): dents, panel gaps, grime, scuffs */
export function bodyMaterial(base: THREE.MeshPhysicalMaterial, seams: Seams): THREE.MeshPhysicalMaterial {
  const mat = base.clone();
  const u = {
    uSeamZ: { value: new THREE.Vector4(...seams.doors) },
    uSeamA: { value: new THREE.Vector4(seams.cowl, seams.deck, seams.lidW, 0) },
    uSeamY: { value: new THREE.Vector2(seams.sill, seams.belt) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += dOff;`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${FRAG_HEAD}
uniform vec4 uSeamZ;
uniform vec4 uSeamA;
uniform vec2 uSeamY;
float bsLine( float v, float c ) {
  float w = fwidth( v ) * 0.9 + 0.0022;
  return 1.0 - smoothstep( w * 0.5, w * 1.6, abs( v - c ) );
}
float bsSeam = 0.0;
float bsDirt = 0.0;
float bsScuff = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 n = normalize( vObjN );
  float side = smoothstep( 0.5, 0.8, abs( n.x ) );
  float top = smoothstep( 0.4, 0.75, n.y );
  float doorY = step( uSeamY.x, vObjP.y ) * step( vObjP.y, uSeamY.y );
  bsSeam += side * doorY * ( bsLine( vObjP.z, uSeamZ.x ) + bsLine( vObjP.z, uSeamZ.y ) + bsLine( vObjP.z, uSeamZ.z ) + bsLine( vObjP.z, uSeamZ.w ) );
  float inLid = step( abs( vObjP.x ), uSeamA.z );
  bsSeam += top * ( bsLine( vObjP.z, uSeamA.x ) * inLid + step( uSeamA.x, vObjP.z ) * bsLine( abs( vObjP.x ), uSeamA.z ) );
  bsSeam += top * ( bsLine( vObjP.z, uSeamA.y ) * inLid + step( vObjP.z, uSeamA.y ) * bsLine( abs( vObjP.x ), uSeamA.z ) );
  bsSeam = clamp( bsSeam, 0.0, 1.0 );
  diffuseColor.rgb *= 1.0 - 0.8 * bsSeam;
  // road grime: dust on the sills and the lower doors, some cars filthier than others
  float dirtK = fract( sin( vInst * 12.9898 + 4.1 ) * 43758.5453 );
  float low = 1.0 - smoothstep( 0.1, 0.62, vObjP.y );
  if ( low > 0.0 ) {
    // (splashes: a cheap smooth mottle, it's on every car's lower half)
    float mot = sin( vObjP.x * 7.0 + vObjP.z * 3.0 ) * sin( vObjP.z * 5.3 + vObjP.y * 19.0 );
    bsDirt = low * ( 0.15 + 0.5 * dirtK * dirtK ) * ( 0.7 + 0.3 * mot );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.115, 0.1 ), bsDirt );
  }
  // crash damage: scuffed through to primer, bare metal at the deepest
  // (scrapes run along the car: long hairlines; where it's crushed, patches through to primer and steel)
  if ( vDent > 0.02 ) {
    float crush = smoothstep( 0.02, 0.16, vDent );
    float streak = smoothstep( 0.62, 0.9, bsNoise( vObjP * vec3( 1.5, 160.0, 1.5 ) + vec3( 0.0, 0.0, vObjP.z * 2.0 ) ) );
    float bare = smoothstep( 0.45, 0.62, bsNoise( vObjP * 7.0 ) + crush * 0.25 );
    bsScuff = crush * max( streak * 0.9, bare );
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.34, 0.34, 0.33 ), vec3( 0.6, 0.6, 0.62 ), streak ), bsScuff * 0.85 );
  }
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp( roughnessFactor + bsDirt * 0.5 + bsScuff * 0.45 + bsSeam * 0.4, 0.0, 1.0 );`,
      );
  };
  mat.customProgramCacheKey = () => 'ow-body-v2';
  return mat;
}

/** the glass: crazed white where it's been hit */
export function glassMaterial(base: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  const mat = base.clone();
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += dOff * 0.8;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_HEAD}\nfloat bsCraze = 0.0;`).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  // glass at a glancing angle is a mirror: the cabin shows head-on, the sky along the slope
  float fres = pow( 1.0 - abs( dot( normalize( vViewPosition ), normalize( vNormal ) ) ), 3.0 );
  diffuseColor.a = mix( diffuseColor.a, 1.0, fres * 0.85 );
  // a web of cracks (the noise's contour lines, two scales) over a milky haze of crushed glass
  if ( vDent > 0.015 ) {
    float n1 = bsNoise( vObjP * 9.0 ), n2 = bsNoise( vObjP * 23.0 + 3.7 );
    float web = max( 1.0 - smoothstep( 0.0, 0.035, abs( n1 - 0.5 ) ), 0.7 * ( 1.0 - smoothstep( 0.0, 0.05, abs( n2 - 0.5 ) ) ) );
    float k = smoothstep( 0.015, 0.08, vDent );
    bsCraze = k * max( web, 0.25 + 0.3 * k );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.64, 0.66 ), bsCraze );
    diffuseColor.a = max( diffuseColor.a, bsCraze );
  }
}`,
    ).replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = clamp( roughnessFactor + bsCraze * 0.7, 0.0, 1.0 );`,
    );
  };
  mat.customProgramCacheKey = () => 'ow-glass-v2';
  return mat;
}

/** lamps and decals: they move with the panel they're on; a smashed lamp goes out */
export function dentedMaterial<T extends THREE.Material>(mat: T, lamp: boolean): T {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 dOff = vec3( 0.0 );
vec3 dTilt = vec3( 0.0 );
float dAmt = 0.0;
dentOne( aDent0, position, dOff, dTilt, dAmt );
dentOne( aDent1, position, dOff, dTilt, dAmt );
dentOne( aDent2, position, dOff, dTilt, dAmt );
dentOne( aDent3, position, dOff, dTilt, dAmt );
transformed += dOff;
vDent = dAmt;`);
    if (lamp)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vDent;`)
        .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.94 * smoothstep( 0.03, 0.09, vDent );`);
  };
  mat.customProgramCacheKey = () => 'ow-dented-v1-' + (lamp ? 'lamp' : 'decal');
  return mat;
}
