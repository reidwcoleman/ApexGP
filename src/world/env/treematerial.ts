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
 *  bakeImpostors()   renders every prototype once (albedo, view-space normal + AO)
 *                    into two atlases at build time.
 *  impostorMaterial()   camera-facing cards that relight the baked normals, fade
 *                    in exactly where the 3D tree fades out.
 */

export interface TreeUniforms {
  uTime: THREE.IUniform<number>;
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
  return { uTime: { value: 0 }, uFade: { value: new THREE.Vector2(158, 182) }, uSunW: { value: new THREE.Vector3(0.4, 0.8, 0.4) }, uLeafFill: { value: FILL_SUN.clone() } };
}

const COMMON_VERT = /* glsl */ `
attribute vec4 aTree;
attribute vec4 aCard;
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
  float cr = cos( aCard.z ), sr = sin( aCard.z );
  up2 = vec2( up2.x * cr - up2.y * sr, up2.x * sr + up2.y * cr );
  vec2 off = vec2( up2.y, -up2.x ) * aCard.x + up2 * aCard.y;
  return ( camR * off.x + camU * off.y ) * sc;
}
uniform float uTime;
uniform vec2 uWind;
varying vec4 vTree;
varying vec2 vTUv;
varying float vFadeD;
vec3 treeWind( vec3 ip, vec3 p, vec4 t ) {
  float wlen = length( uWind );
  vec2 wd = wlen > 0.2 ? uWind / wlen : vec2( 0.8, 0.6 );
  float ws = 0.55 + wlen * 0.11;
  float ph = dot( ip.xz, vec2( 0.071, 0.053 ) );
  float gust = 0.55 + 0.45 * sin( uTime * 0.31 + ip.x * 0.006 + ip.z * 0.004 );
  float sway = ( sin( uTime * 0.83 + ph ) * 0.6 + sin( uTime * 1.73 + ph * 1.7 ) * 0.25 ) * gust * ws;
  float br = sin( uTime * 2.1 + t.w + ph ) * ws;
  float leafK = step( 0.5, t.y );
  float fl = sin( uTime * 8.3 + p.x * 2.1 + p.z * 1.7 + t.w * 3.0 ) * leafK * ws;
  float w = t.x;
  return vec3( wd.x, 0.0, wd.y ) * ( sway * 0.3 + 0.1 * ws ) * w
       + vec3( 0.2, 0.08, 0.16 ) * br * w * 0.45
       + vec3( 0.05, 0.035, -0.045 ) * fl;
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
`;

/** RE_Direct wrapper: thin-leaf transmission + crown self-shadowing */
const LEAF_LIGHT = /* glsl */ `
varying float vLeafL;
varying float vAOL;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  IncidentLight dl = directLight;
  dl.color *= mix( 1.0, mix( 0.62, 1.0, vAOL ), vLeafL );
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
    reflectedLight.directDiffuse += dl.color * dc * wrapL * 0.45 * RECIPROCAL_PI;
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
      uFade: u.uFade,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uLeafMap: { value: kit.leafMap },
      uLeafN: { value: kit.leafNormal },
      uBark: { value: kit.bark },
      uSunW: u.uSunW,
      uLeafFill: u.uLeafFill,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}\nvarying float vLeafL;\nvarying float vAOL;\nuniform vec3 uSunW;`)
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
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uLeafMap;
uniform sampler2D uLeafN;
uniform sampler2D uBark;
uniform vec2 uFade;
uniform float uWet;
uniform vec3 uLeafFill;
varying vec4 vTree;
varying vec2 vTUv;
varying float vFadeD;
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
if ( uFade.y > 0.0 ) {
  float f = smoothstep( uFade.x, uFade.y, vFadeD );
  if ( f > ign( gl_FragCoord.xy ) ) discard;
}
if ( leafK > 0.5 ) {
  vec4 lt = texture2D( uLeafMap, vTUv );
  vec2 dx = dFdx( vTUv * vec2( 2048.0, 1024.0 ) ), dy = dFdy( vTUv * vec2( 2048.0, 1024.0 ) );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
  // cards turning edge-on thin out instead of showing smeared leaves
  vec3 fN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
  float edgeOn = abs( dot( fN, normalize( vViewPosition ) ) );
  float thr = 0.5 + 0.55 * ( 1.0 - smoothstep( 0.16, 0.5, edgeOn ) );
  if ( lt.a * ( 1.0 + lod * 0.32 ) < thr ) discard;
  diffuseColor.rgb *= lt.rgb;
} else {
  vec4 bk = texture2D( uBark, vTUv );
  float alb = 0.45 + bk.a * 0.75;
  if ( vTree.y < -0.5 ) {
    // plane tree: flaking bark, cream / olive / grey camouflage patches
    float m = texture2D( uBark, vTUv * vec2( 0.23, 0.17 ) + vec2( 0.31, 0.62 ) ).a;
    float m2 = texture2D( uBark, vTUv * vec2( 0.51, 0.33 ) + vec2( 0.7, 0.1 ) ).a;
    vec3 cream = vec3( 0.37, 0.35, 0.27 ), olive = vec3( 0.19, 0.19, 0.13 ), grey = vec3( 0.28, 0.27, 0.23 );
    vec3 pc = mix( olive, grey, smoothstep( 0.45, 0.6, m2 ) );
    pc = mix( pc, cream, smoothstep( 0.58, 0.64, m ) );
    diffuseColor.rgb = pc * ( 0.62 + 0.26 * bk.a );
  } else {
    diffuseColor.rgb *= alb;
  }
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
    mapN.y = -mapN.y;
    mapN.xy *= 0.85;
  } else {
    mapN = texture2D( uBark, vTUv ).xyz * 2.0 - 1.0;
    mapN.xy *= 1.4;
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
  float ambientOcclusion = mix( mix( 0.45, 0.36, leafK ), 1.0, vTree.z );
  // leaves: sky light scattered through the outer foliage (the crown is not an opaque blob)
  reflectedLight.indirectDiffuse *= ambientOcclusion * mix( vec3( 1.0 ), uLeafFill, leafK );
  reflectedLight.indirectSpecular *= ambientOcclusion * ambientOcclusion * mix( 1.0, 0.3, leafK );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-3d-v3';
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
  mat.customProgramCacheKey = () => 'apex-tree-depth-v2';
  return mat;
}

// ---------------------------------------------------------------- impostors

export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** per prototype: (cell col, cell row, world size of the cell, 0) */
  cells: THREE.Vector4[];
  grid: number;
  rts: THREE.WebGLRenderTarget[];
}

const BAKE_VERT = /* glsl */ `
attribute vec4 aTree;
attribute vec4 aCard;
varying vec4 vTree;
varying vec2 vTUv;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vVP;
void main() {
  vTree = aTree;
  vTUv = uv;
  vCol = color;
  vN = normalize( normalMatrix * normal );
  vec3 p = position;
  if ( aCard.x != 0.0 || aCard.y != 0.0 ) {
    vec3 camR = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 camU = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
    vec2 od = vec2( dot( normal, camR ), dot( normal, camU ) );
    float ol = length( od );
    vec2 up2 = vec2( 0.0, 1.0 );
    if ( ol > 1e-3 ) up2 = normalize( mix( up2, od / ol, smoothstep( 0.1, 0.6, ol ) * 0.7 ) );
    float cr = cos( aCard.z ), sr = sin( aCard.z );
    up2 = vec2( up2.x * cr - up2.y * sr, up2.x * sr + up2.y * cr );
    vec2 off = vec2( up2.y, -up2.x ) * aCard.x + up2 * aCard.y;
    p += camR * off.x + camU * off.y;
  }
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  vVP = - mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const BAKE_FRAG = (mode: 'albedo' | 'normal') => /* glsl */ `
uniform sampler2D uLeafMap;
uniform sampler2D uLeafN;
uniform sampler2D uBark;
varying vec4 vTree;
varying vec2 vTUv;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vVP;
${GET_TANGENT_FRAME}
void main() {
  bool leaf = vTree.y > 0.5;
  vec3 alb;
  if ( leaf ) {
    vec4 lt = texture2D( uLeafMap, vTUv );
    if ( lt.a < 0.5 ) discard;
    alb = lt.rgb;
  } else {
    vec4 bk = texture2D( uBark, vTUv );
    alb = vec3( 0.45 + bk.a * 0.75 );
    if ( vTree.y < -0.5 ) alb = vec3( 0.27, 0.26, 0.2 ) / max( vCol, vec3( 0.05 ) );
  }
  alb *= vCol;
  ${
    mode === 'albedo'
      ? `gl_FragColor = vec4( sqrt( clamp( alb, 0.0, 1.0 ) ), 1.0 );`
      : `
  vec3 n = normalize( vN );
  if ( ! leaf && ! gl_FrontFacing ) n = -n;
  vec3 mapN = leaf ? texture2D( uLeafN, vTUv ).xyz * 2.0 - 1.0 : texture2D( uBark, vTUv ).xyz * 2.0 - 1.0;
  if ( leaf ) { mapN.y = -mapN.y; mapN.xy *= 0.85; }
  mat3 tbn = treeTangentFrame( - vVP, n, vTUv );
  n = normalize( tbn * normalize( mapN ) );
  gl_FragColor = vec4( n * 0.5 + 0.5, leaf ? vTree.z : 0.7 );`
  }
}
`;

export function bakeImpostors(renderer: THREE.WebGLRenderer, kit: TreeKit, cellPx = 512): ImpostorAtlas {
  const n = kit.protos.length;
  const grid = Math.ceil(Math.sqrt(n));
  const size = grid * cellPx;
  const mkRT = () =>
    new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      colorSpace: THREE.NoColorSpace,
    });
  const rtA = mkRT();
  const rtN = mkRT();
  const uniforms = { uLeafMap: { value: kit.leafMap }, uLeafN: { value: kit.leafNormal }, uBark: { value: kit.bark } };
  const matA = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG('albedo'), uniforms, vertexColors: true, side: THREE.DoubleSide });
  const matN = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG('normal'), uniforms, vertexColors: true, side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(new THREE.BufferGeometry(), matA);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const cells: THREE.Vector4[] = [];
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  const avg = kit.foliageAvg;
  kit.protos.forEach((p: TreeProto, i: number) => {
    const col = i % grid, row = Math.floor(i / grid);
    const S = Math.max(p.radius * 2, p.height) * 1.04;
    cells.push(new THREE.Vector4(col, row, S, 0));
    cam.left = -S / 2;
    cam.right = S / 2;
    cam.bottom = -S * 0.02;
    cam.top = S * 0.98;
    cam.position.set(0, 0, 200);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    mesh.geometry = p.lods[0];
    for (const [rt, mat, clear] of [
      [rtA, matA, [Math.sqrt(avg.r), Math.sqrt(avg.g), Math.sqrt(avg.b), 0]],
      [rtN, matN, [0.5, 0.5, 1.0, 1.0]],
    ] as [THREE.WebGLRenderTarget, THREE.ShaderMaterial, number[]][]) {
      mesh.material = mat;
      rt.viewport.set(col * cellPx, row * cellPx, cellPx, cellPx);
      rt.scissor.set(col * cellPx, row * cellPx, cellPx, cellPx);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), clear[3]);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
    }
  });
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  matA.dispose();
  matN.dispose();
  rtA.texture.anisotropy = 4;
  rtN.texture.anisotropy = 4;
  return { albedo: rtA.texture, normal: rtN.texture, cells, grid, rts: [rtA, rtN] };
}

export function impostorMaterial(atlas: ImpostorAtlas, u: TreeUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0 });
  const cells = atlas.cells.map((c) => c.clone());
  while (cells.length < 24) cells.push(new THREE.Vector4());
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uFade: u.uFade,
      uTime: u.uTime,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uImpA: { value: atlas.albedo },
      uImpN: { value: atlas.normal },
      uCells: { value: cells },
      uLeafFill: u.uLeafFill,
      uGrid: { value: atlas.grid },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 iPos;
attribute vec4 iInfo;
attribute vec3 iTint;
uniform vec4 uCells[ 24 ];
uniform float uGrid;
uniform vec2 uFade;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vIUv;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying float vIFade;
varying float vIFlip;
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
  vec4 cell = uCells[ int( iInfo.x + 0.5 ) ];
  float S = cell.z * iPos.w;
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
  transformed = P + right * ( c.x * S ) + up * ( c.y * S ) + right * sway * c.y * c.y * S * 0.02;
  if ( vIFade <= 0.0 ) transformed = vec3( 0.0, -1e5, 0.0 );
  vIUv = ( cell.xy + vec2( c.x * flip + 0.5, c.y * 0.98 + 0.02 ) ) / uGrid;
  vIR = right * flip;
  vIU = up;
  vIF = nrm;
  vITint = iTint;
  vIFlip = flip;
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
uniform float uWet;
uniform vec3 uLeafFill;
varying vec2 vIUv;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying float vIFade;
varying float vIFlip;
${GET_TANGENT_FRAME}`,
      )
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LEAF_LIGHT.replace('varying float vLeafL;\nvarying float vAOL;', 'varying float vLeafL;\nvarying float vAOL;\nfloat gImpAO = 1.0;').replace('mix( 0.62, 1.0, vAOL )', 'mix( 0.62, 1.0, gImpAO )')}`)
      .replace(
        '#include <map_fragment>',
        `
vec4 ia = texture2D( uImpA, vIUv );
{
  vec2 dx = dFdx( vIUv * 2048.0 ), dy = dFdy( vIUv * 2048.0 );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
  if ( ia.a * ( 1.0 + lod * 0.3 ) < 0.5 ) discard;
  if ( vIFade < 1.0 && vIFade <= ign( gl_FragCoord.xy ) ) discard;
}
diffuseColor.rgb = ia.rgb * ia.rgb * vITint;
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec4 inr = texture2D( uImpN, vIUv );
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
  mat.customProgramCacheKey = () => 'apex-tree-impostor-v2';
  return mat;
}
