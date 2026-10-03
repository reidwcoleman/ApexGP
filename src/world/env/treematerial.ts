import * as THREE from 'three';
import type { TreeKit, TreeProto } from './treeproto.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Tree materials.
 *
 *  treeMaterial()    3D trees (BatchedMesh): leaf atlas + normal map / bark, crown
 *                    "volume" normals from the geometry, wind (whole-tree sway, branch
 *                    bob, leaf flutter), light through the leaves when back-lit (shadowed
 *                    properly because it rides on the directional light's shadowed
 *                    colour), crown-depth AO, rain gloss, and a dithered fade-out
 *                    at the 3D → impostor distance.
 *  treeDepthMaterial()  the same wind + leaf alpha for the shadow map.
 *  impostorMaterial()   camera-facing cards showing the scanned tree's baked frames (8 views
 *                    around it, blended by the camera's bearing), relit from the baked
 *                    normals; they fade in exactly where the 3D tree fades out.
 */

export interface TreeUniforms {
  uTime: THREE.IUniform<number>;
  /** frame counter: the 3D/impostor hand-over dither moves every frame (a fixed one showed as hatching) */
  uFrame: THREE.IUniform<number>;
  /** 3D fade band (start, end) in metres from the camera */
  uFade: THREE.IUniform<THREE.Vector2>;
  /** world direction toward the sun (for the leaf shadow offset) */
  uSunW: THREE.IUniform<THREE.Vector3>;
  /**
   * sky fill multiplier on foliage: light scattered leaf to leaf through a sunlit crown
   * (strong in sunshine, near 1 under a grey deck where the sky already lights everything)
   */
  uLeafFill: THREE.IUniform<THREE.Vector3>;
}

const FILL_SUN = new THREE.Vector3(3.4, 3.55, 2.8);
const FILL_GREY = new THREE.Vector3(1.35, 1.4, 1.2);
/** set the foliage fill from how much of the light is direct sun (0 … 1) */
export function setLeafFill(u: TreeUniforms, sunShare: number) {
  u.uLeafFill.value.copy(FILL_GREY).lerp(FILL_SUN, Math.min(1, Math.max(0, sunShare)));
}

export function createTreeUniforms(): TreeUniforms {
  return { uTime: { value: 0 }, uFrame: { value: 0 }, uFade: { value: new THREE.Vector2(158, 182) }, uSunW: { value: new THREE.Vector3(0.4, 0.8, 0.4) }, uLeafFill: { value: FILL_SUN.clone() } };
}

const COMMON_VERT = /* glsl */ `
attribute vec4 aTree;
attribute vec4 aCard;
uniform float uTime;
uniform vec2 uWind;
// camera-facing leaf card: spread the corner in the view plane (of whatever camera is
// drawing — the sun's in the shadow pass), the texture's "up" turned toward the clump's
// outward direction on screen. Returns a world-space offset for a tree of scale sc.
vec3 treeCard( vec3 nW, float sc ) {
  vec3 camR = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 camU = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  vec2 od = vec2( dot( nW, camR ), dot( nW, camU ) );
  float ol = length( od );
  vec2 up2 = vec2( 0.0, 1.0 );
  if ( ol > 1e-3 ) up2 = normalize( mix( up2, od / ol, smoothstep( 0.1, 0.6, ol ) * 0.7 ) );
  // leaves flutter: each card twists a little about its centre (in the wind, faster and further)
  float wl = length( uWind );
  float spin = sin( uTime * ( 4.1 + wl * 0.35 ) + aTree.w * 7.0 + aCard.z * 11.0 ) * ( 0.07 + min( wl, 14.0 ) * 0.012 ) * step( 0.5, aTree.y );
  float cr = cos( aCard.z + spin ), sr = sin( aCard.z + spin );
  up2 = vec2( up2.x * cr - up2.y * sr, up2.x * sr + up2.y * cr );
  vec2 off = vec2( up2.y, -up2.x ) * aCard.x + up2 * aCard.y;
  return ( camR * off.x + camU * off.y ) * sc;
}
varying vec4 vTree;
varying vec2 vTUv;
varying float vFadeD;
vec3 treeWind( vec3 ip, vec3 p, vec4 t ) {
  float wlen = length( uWind );
  vec2 wd = wlen > 0.2 ? uWind / wlen : vec2( 0.8, 0.6 );
  float ws = 0.55 + wlen * 0.11;
  float ph = dot( ip.xz, vec2( 0.071, 0.053 ) );
  // gusts roll through the woods downwind: a wave along the wind direction, so neighbouring trees
  // bend one after another instead of all at once
  float gx = dot( ip.xz, wd ) * 0.028 - uTime * ( 0.55 + wlen * 0.09 );
  float gust = 0.5 + 0.32 * sin( gx ) + 0.18 * sin( gx * 2.3 + 1.7 + dot( ip.xz, vec2( -wd.y, wd.x ) ) * 0.01 );
  float sway = ( sin( uTime * 0.83 + ph ) * 0.6 + sin( uTime * 1.73 + ph * 1.7 ) * 0.25 ) * gust * ws;
  float br = sin( uTime * 2.1 + t.w + ph ) * ws * ( 0.6 + 0.6 * gust );
  float leafK = step( 0.5, t.y );
  float fl = sin( uTime * 8.3 + p.x * 2.1 + p.z * 1.7 + t.w * 3.0 ) * leafK * ws;
  float w = t.x;
  // branches bob with the wind (and lift a little); leaf flutter is mostly the cards' twist
  return vec3( wd.x, 0.0, wd.y ) * ( sway * 0.3 + 0.1 * ws * ( 0.5 + gust ) ) * w
       + vec3( wd.x, 0.35, wd.y ) * br * w * 0.22
       + vec3( 0.05, 0.035, -0.045 ) * fl * 0.5;
}
`;

const GET_TANGENT_FRAME = /* glsl */ `
mat3 treeTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
  vec3 q0 = dFdx( eye_pos.xyz );
  vec3 q1 = dFdy( eye_pos.xyz );
  vec2 st0 = dFdx( uv.st );
  vec2 st1 = dFdy( uv.st );
  vec3 N = surf_norm;
  vec3 q1perp = cross( q1, N );
  vec3 q0perp = cross( N, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, N );
}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
// (offset by the frame: the hand-over reads as a blend in motion instead of a fixed hatch)
uniform float uFrame;
float ignF( vec2 p ) { return ign( p + 5.588238 * mod( uFrame, 64.0 ) ); }
`;

/** RE_Direct wrapper: thin-leaf transmission + crown self-shadowing */
const LEAF_LIGHT = /* glsl */ `
varying float vLeafL;
varying float vAOL;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  IncidentLight dl = directLight;
  // (sun on the outside of a crown is strong — the bright, warm tops the footage shows — and the
  // inside sits in its own shade)
  dl.color *= mix( 1.0, mix( 0.5, 1.35, vAOL ), vLeafL );
  RE_Direct_Physical( dl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( vLeafL > 0.5 ) {
    float VL = saturate( dot( -geometryViewDir, directLight.direction ) );
    // thin leaves: diffuse transmission through the lit-from-behind side of the crown
    // (wrapped, so the terminator is soft) plus the bright forward-scatter glow around
    // the sun when the crown is back-lit
    float back = saturate( dot( -geometryNormal, directLight.direction ) * 0.6 + 0.4 );
    float through = pow( VL, 6.0 ) * 0.85 + 0.3 * back * back;
    // light through a leaf comes out a saturated yellow-green (albedo squared, renormalised)
    vec3 dc = material.diffuseColor;
    vec3 tc = dc * dc / max( max( dc.r, dc.g ), 1e-3 );
    reflectedLight.directDiffuse += dl.color * tc * vec3( 1.0, 1.0, 0.5 ) * through * 0.62;
    // soft wrap on the lit side: a leafy mass never shows a hard N·L terminator
    float wrapL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.35 ) / 1.35 ) - saturate( dot( geometryNormal, directLight.direction ) );
    reflectedLight.directDiffuse += dl.color * dc * wrapL * 0.25 * RECIPROCAL_PI;
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`;

export function treeMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: u.uTime,
      uFrame: u.uFrame,
      uFade: u.uFade,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uLeafMap: { value: kit.leafMap },
      uLeafN: { value: kit.leafNormal },
      uBark: { value: kit.bark },
      uLeafSize: { value: kit.leafSize },
      uSunW: u.uSunW,
      uLeafFill: u.uLeafFill,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}\nvarying float vLeafL;\nvarying float vAOL;\nvarying float vShadowOnly;\nuniform vec3 uSunW;`)
      .replace('#include <shadowmap_vertex>', `#ifdef USE_SHADOWMAP\n  worldPosition.xyz += uSunW * ( 0.45 * step( 0.5, aTree.y ) );\n#endif\n#include <shadowmap_vertex>`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  #ifdef USE_BATCHING
    mat4 tm = batchingMatrix;
  #elif defined( USE_INSTANCING )
    mat4 tm = instanceMatrix;
  #else
    mat4 tm = mat4( 1.0 );
  #endif
  vec3 ip = ( modelMatrix * vec4( tm[ 3 ].xyz, 1.0 ) ).xyz;
  vec3 disp = treeWind( ip, position, aTree );
  mat3 m3 = mat3( tm );
  float s2 = max( dot( m3[ 0 ], m3[ 0 ] ), 1e-4 );
  if ( aCard.x != 0.0 || aCard.y != 0.0 ) disp += treeCard( normalize( mat3( modelMatrix ) * m3 * normal ), sqrt( s2 ) );
  transformed += ( transpose( m3 ) * disp ) / s2;
  vTree = aTree;
  vTUv = uv;
  vLeafL = step( 0.5, aTree.y );
  vAOL = aTree.z;
  vFadeD = distance( cameraPosition, ip );
  // (shadow-only instance, flagged in its instance colour: out of the camera's view entirely)
  vShadowOnly = 0.0;
  #ifdef USE_BATCHING_COLOR
  if ( getBatchingColor( getIndirectIndex( gl_DrawID ) ).r > 20.0 ) {
    vShadowOnly = 1.0;
    transformed = vec3( 0.0, -1e5, 0.0 );
  }
  #endif
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uLeafMap;
uniform sampler2D uLeafN;
uniform sampler2D uBark;
uniform vec2 uLeafSize;
uniform vec2 uFade;
uniform float uWet;
uniform vec3 uLeafFill;
varying vec4 vTree;
varying vec2 vTUv;
varying float vFadeD;
varying float vShadowOnly;
${GET_TANGENT_FRAME}`,
      )
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LEAF_LIGHT}`)
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
// leaves: a soft waxy sheen, never a mirror-like grazing sky reflection
material.specularColor *= mix( 1.0, 0.35, leafK );
material.specularF90 = mix( material.specularF90, 0.22, leafK );`,
      )
      .replace(
        '#include <map_fragment>',
        `
float leafK = step( 0.5, vTree.y );
// (a tree drawn only into the shadow maps — vegetation.ts conifers)
if ( vShadowOnly > 0.5 ) discard;
if ( uFade.y > 0.0 ) {
  float f = smoothstep( uFade.x, uFade.y, vFadeD );
  if ( f > ignF( gl_FragCoord.xy ) ) discard;
}
if ( leafK > 0.5 ) {
  vec4 lt = texture2D( uLeafMap, vTUv );
  vec2 dx = dFdx( vTUv * uLeafSize ), dy = dFdy( vTUv * uLeafSize );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
  // cards turning edge-on thin out instead of showing smeared leaves
  vec3 fN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
  float edgeOn = abs( dot( fN, normalize( vViewPosition ) ) );
  // (a little more sky through the crowns: real foliage is full of holes, not a solid lump)
  float thr = 0.5 + 0.5 * ( 1.0 - smoothstep( 0.16, 0.5, edgeOn ) );
  if ( lt.a * ( 1.0 + lod * 0.32 ) < thr ) discard;
  // foliage as camera footage shows it: a dark olive mass, not a bright game green (the clumps are the
  // scans' own leaves; a touch of desaturation and warmth matches them to the graded footage)
  vec3 lc = lt.rgb;
  lc = mix( vec3( dot( lc, vec3( 0.2126, 0.7152, 0.0722 ) ) ), lc, 0.8 ) * vec3( 0.93, 0.92, 0.84 );
  diffuseColor.rgb *= lc;
} else {
  // the scan's own bark colour is in the vertex colour; the bark tile adds the detail around it
  vec4 bk = texture2D( uBark, vTUv );
  diffuseColor.rgb *= 0.45 + bk.a * 1.1;
  diffuseColor.rgb *= mix( 1.0, 0.55, uWet );
}
`,
      )
      .replace('normal *= faceDirection;', 'normal *= mix( faceDirection, 1.0, step( 0.5, vTree.y ) );')
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec3 mapN;
  if ( vTree.y > 0.5 ) {
    mapN = texture2D( uLeafN, vTUv ).xyz * 2.0 - 1.0;
    mapN.xy *= 0.85;
  } else {
    mapN = texture2D( uBark, vTUv ).xyz * 2.0 - 1.0;
    mapN.xy *= 1.2;
  }
  mat3 tbnT = treeTangentFrame( - vViewPosition, normal, vTUv );
  normal = normalize( tbnT * normalize( mapN ) );
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix( 0.86, 0.72, leafK );
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, uWet );`,
      )
      .replace(
        '#include <aomap_fragment>',
        `{
  // (the inside of a crown is deep in shade: little sky reaches it)
  float ambientOcclusion = mix( mix( 0.45, 0.24, leafK ), 1.0, pow( vTree.z, 1.25 ) );
  // leaves: sky light scattered through the outer foliage (the crown is not an opaque blob)
  reflectedLight.indirectDiffuse *= ambientOcclusion * mix( vec3( 1.0 ), uLeafFill, leafK );
  reflectedLight.indirectSpecular *= ambientOcclusion * ambientOcclusion * mix( 1.0, 0.3, leafK );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-3d-v5';
  return mat;
}

export function treeDepthMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: u.uTime, uWind: weatherUniforms.uWind, uLeafMap: { value: kit.leafMap } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${COMMON_VERT}`).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
  #ifdef USE_BATCHING
    mat4 tm = batchingMatrix;
  #elif defined( USE_INSTANCING )
    mat4 tm = instanceMatrix;
  #else
    mat4 tm = mat4( 1.0 );
  #endif
  vec3 ip = ( modelMatrix * vec4( tm[ 3 ].xyz, 1.0 ) ).xyz;
  vec3 disp = treeWind( ip, position, aTree );
  mat3 m3 = mat3( tm );
  float s2 = max( dot( m3[ 0 ], m3[ 0 ] ), 1e-4 );
  if ( aCard.x != 0.0 || aCard.y != 0.0 ) disp += treeCard( normalize( mat3( modelMatrix ) * m3 * normal ), sqrt( s2 ) );
  transformed += ( transpose( m3 ) * disp ) / s2;
  vTree = aTree;
  vTUv = uv;
}`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uLeafMap;\nvarying vec4 vTree;\nvarying vec2 vTUv;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif ( vTree.y > 0.5 && texture2D( uLeafMap, vTUv ).a < 0.5 ) discard;`);
  };
  mat.customProgramCacheKey = () => 'apex-tree-depth-v3';
  return mat;
}

// ---------------------------------------------------------------- impostors

/**
 * Camera-facing cards showing the baked frames of the scanned tree (tools/bake_trees.mjs): eight
 * views around it; the two frames either side of the camera's bearing (in the tree's own, rotated
 * and maybe mirrored, frame) are blended, so a tree turns as you drive round it instead of
 * following you. The baked normals are relit like the 3D trees; they fade in exactly where the 3D
 * tree fades out.
 *
 * Instance attributes: iPos (x, y, z, scale), iInfo (prototype, mirrored, near (has a 3D tree), yaw),
 * iTint (rgb).
 */
export function impostorMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0 });
  // per prototype: (card width, card height (m), atlas row, 0)
  const protos: THREE.Vector4[] = kit.protos.map((p: TreeProto, i: number) => new THREE.Vector4(p.W, p.Hc, kit.impRow[i], 0));
  while (protos.length < 16) protos.push(new THREE.Vector4());
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uFade: u.uFade,
      uTime: u.uTime,
      uFrame: u.uFrame,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uImpA: { value: kit.impC },
      uImpN: { value: kit.impN },
      uProtos: { value: protos },
      uLeafFill: u.uLeafFill,
      uImpGrid: { value: new THREE.Vector2(kit.frames, kit.impRows) },
      uImpSize: { value: new THREE.Vector2(kit.frames * 256, kit.impRows * 256) },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 iPos;
attribute vec4 iInfo;
attribute vec3 iTint;
uniform vec4 uProtos[ 16 ];
uniform vec2 uImpGrid;
uniform vec2 uFade;
uniform float uTime;
uniform vec2 uWind;
varying vec4 vIUv;
varying float vIW;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying float vIFade;
varying float vLeafL;
varying float vAOL;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3( 0.0, 0.0, 1.0 );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( 1.0, 0.0, 0.0 );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed;
{
  vec4 pr = uProtos[ int( iInfo.x + 0.5 ) ];
  float S = pr.y * iPos.w;
  float Wc = pr.x * iPos.w;
  vec3 P = iPos.xyz;
  vec3 toCam = cameraPosition - P;
  float horiz = max( length( toCam.xz ), 1e-3 );
  vec3 fwd = vec3( toCam.x / horiz, 0.0, toCam.z / horiz );
  vec3 right = vec3( fwd.z, 0.0, -fwd.x );
  float elev = atan( toCam.y - S * 0.45, horiz );
  float tilt = clamp( elev, 0.0, 0.75 ) * 0.8;
  vec3 up = vec3( 0.0, cos( tilt ), 0.0 ) - fwd * sin( tilt );
  vec3 nrm = fwd * cos( tilt ) + vec3( 0.0, sin( tilt ), 0.0 );
  float flip = iInfo.y > 0.5 ? -1.0 : 1.0;
  float d = length( toCam );
  vIFade = iInfo.z > 0.5 ? smoothstep( uFade.x, uFade.y, d ) : 1.0;
  // gentle sway of the whole card
  float ph = dot( P.xz, vec2( 0.071, 0.053 ) );
  float sway = sin( uTime * 0.83 + ph ) * 0.12 * ( 0.55 + length( uWind ) * 0.1 );
  vec2 c = position.xy;
  transformed = P + right * ( c.x * Wc ) + up * ( c.y * S ) + right * sway * c.y * c.y * S * 0.02;
  if ( vIFade <= 0.0 ) transformed = vec3( 0.0, -1e5, 0.0 );
  // the camera's bearing in the tree's own frame (yaw undone, mirror undone) → the two frames around it
  float az = ( atan( toCam.x, toCam.z ) - iInfo.w ) * flip;
  float f = fract( az / 6.2831853 ) * uImpGrid.x;
  float f0 = floor( f );
  vIW = f - f0;
  float f1 = mod( f0 + 1.0, uImpGrid.x );
  float uu = c.x * flip + 0.5;
  float vv = ( uImpGrid.y - 1.0 - pr.z + c.y * 0.98 + 0.02 ) / uImpGrid.y;
  vIUv = vec4( ( f0 + uu ) / uImpGrid.x, vv, ( f1 + uu ) / uImpGrid.x, vv );
  vIR = right * flip;
  vIU = up;
  vIF = nrm;
  vITint = iTint;
  vLeafL = 1.0;
  vAOL = 1.0;
  objectNormal = nrm;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uImpA;
uniform sampler2D uImpN;
uniform vec2 uImpSize;
uniform float uWet;
uniform vec3 uLeafFill;
varying vec4 vIUv;
varying float vIW;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying float vIFade;
${GET_TANGENT_FRAME}`,
      )
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LEAF_LIGHT.replace('varying float vLeafL;\nvarying float vAOL;', 'varying float vLeafL;\nvarying float vAOL;\nfloat gImpAO = 1.0;').replace('mix( 0.5, 1.35, vAOL )', 'mix( 0.5, 1.35, gImpAO )')}`)
      .replace(
        '#include <map_fragment>',
        `
vec4 ia0 = texture2D( uImpA, vIUv.xy );
vec4 ia1 = texture2D( uImpA, vIUv.zw );
vec4 ia = mix( ia0, ia1, vIW );
{
  vec2 dx = dFdx( vIUv.xy * uImpSize ), dy = dFdy( vIUv.xy * uImpSize );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
  if ( ia.a * ( 1.0 + lod * 0.3 ) < 0.5 ) discard;
  if ( vIFade < 1.0 && vIFade <= ignF( gl_FragCoord.xy ) ) discard;
}
// (sRGB atlas: the colour arrives linear)
diffuseColor.rgb = ia.rgb * vITint;
// (the same footage foliage tint as the 3D trees, so near and far match)
diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.8 ) * vec3( 0.93, 0.92, 0.84 );
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  // (the nearer frame's normals: lighting doesn't need the blend, and it saves a fetch per fragment)
  vec4 inr = texture2D( uImpN, vIW < 0.5 ? vIUv.xy : vIUv.zw );
  vec3 nb = inr.xyz * 2.0 - 1.0;
  vec3 nW = normalize( vIR * nb.x + vIU * nb.y + vIF * nb.z );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
  gImpAO = inr.a;
}`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix( 0.74, 0.42, uWet );`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\nmaterial.specularColor *= 0.35;\nmaterial.specularF90 = 0.22;`)
      .replace(
        '#include <aomap_fragment>',
        `{
  reflectedLight.indirectDiffuse *= mix( 0.36, 1.0, gImpAO ) * uLeafFill;
  reflectedLight.indirectSpecular *= gImpAO * gImpAO * 0.3;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-impostor-v3';
  return mat;
}
