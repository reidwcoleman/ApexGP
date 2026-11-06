import * as THREE from 'three';

/**
 * All surfaces share one lighting model, spliced into three's physical material. The world's own
 * light comes from the Cycles bake: a lightmap on the architecture, and a volume of ambient cubes
 * (six colours a cell) for everything else, so a prop or a person is lit by the room it stands in.
 * Reflections read the same cubes, and spot lights (flashlights) stay three's own.
 */

export const LF = {
  lm: { value: null as THREE.Texture | null },
  vol: { value: null as THREE.Data3DTexture | null },
  volMin: { value: new THREE.Vector3() },
  volInv: { value: new THREE.Vector3(1, 1, 1) },
  volDim: { value: new THREE.Vector3(1, 1, 1) },
  lmK: { value: new THREE.Vector2(11, 64) },
  time: { value: 0 },
  worldLight: { value: 1 },
  planar: { value: null as THREE.Texture | null },
  planarVP: { value: new THREE.Matrix4() },
  planarK: { value: 0 },
};

const VERT_PARS = /* glsl */ `
varying vec3 vLfW;
varying vec3 vLfN;
#ifdef LF_LM
attribute vec2 uvLM;
varying vec2 vLfLM;
#endif
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 lfP = vec4( transformed, 1.0 );
  vec3 lfNo = objectNormal;
  #ifdef USE_INSTANCING
    lfP = instanceMatrix * lfP;
    lfNo = mat3( instanceMatrix ) * lfNo;
  #endif
  vLfW = ( modelMatrix * lfP ).xyz;
  vLfN = normalize( mat3( modelMatrix ) * lfNo );
  #ifdef LF_LM
    vLfLM = uvLM;
  #endif
}
`;
const FRAG_PARS = /* glsl */ `
varying vec3 vLfW;
varying vec3 vLfN;
uniform highp sampler3D lfVol;
uniform vec3 lfVolMin;
uniform vec3 lfVolInv;
uniform vec3 lfVolDim;
uniform vec2 lfK;
uniform float lfTime;
uniform float lfWorldLight;
#ifdef LF_LM
varying vec2 vLfLM;
uniform sampler2D lfLM;
#endif
#ifdef LF_WET
uniform float lfWet;
uniform sampler2D lfPlanar;
uniform mat4 lfPlanarVP;
uniform float lfPlanarK;
#endif
vec3 lfDecode( vec3 e ) { return ( exp2( e * lfK.x ) - 1.0 ) / lfK.y; }
vec3 lfFace( vec3 uvw, float f ) {
  // six stacked volumes along z; clamp inside this face's slab so filtering never crosses
  float d = lfVolDim.z;
  float z = clamp( uvw.z * d, 0.5, d - 0.5 ) + f * d;
  return lfDecode( texture( lfVol, vec3( uvw.xy, z / ( d * 6.0 ) ) ).rgb );
}
vec3 lfCube( vec3 p, vec3 n ) {
  vec3 uvw = ( p - lfVolMin ) * lfVolInv;
  vec3 w = n * n;
  vec3 c = vec3( 0.0 );
  c += w.x * lfFace( uvw, n.x > 0.0 ? 0.0 : 1.0 );
  c += w.y * lfFace( uvw, n.y > 0.0 ? 2.0 : 3.0 );
  c += w.z * lfFace( uvw, n.z > 0.0 ? 4.0 : 5.0 );
  return c;
}
float lfHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float lfNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( lfHash( i ), lfHash( i + vec2( 1, 0 ) ), f.x ), mix( lfHash( i + vec2( 0, 1 ) ), lfHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float lfFbm( vec2 p ) { return lfNoise( p ) * 0.55 + lfNoise( p * 2.3 + 7.1 ) * 0.3 + lfNoise( p * 5.1 + 3.3 ) * 0.15; }
`;

/** the world-space normal in the fragment shader (normal is in view space) */
const FRAG_LIGHT = /* glsl */ `
{
  vec3 lfNw = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 lfVw = normalize( ( vec4( geometryViewDir, 0.0 ) * viewMatrix ).xyz );
  vec3 lfR = reflect( - lfVw, lfNw );
  #ifdef LF_LM
    vec3 lfBaked = max( lfDecode( texture2D( lfLM, vLfLM ).rgb ), vec3( 0.0055, 0.0065, 0.0095 ) );
    // the lightmap has no idea about the normal map: lean it on the scan's relief
    float lfRelief = clamp( 1.0 + dot( lfNw - normalize( vLfN ), vec3( 0.55, 0.9, 0.35 ) ) * 0.8, 0.45, 1.5 );
    irradiance += lfBaked * PI * lfRelief * lfWorldLight;
    float lfLum = dot( lfBaked, vec3( 0.3, 0.6, 0.1 ) );
    vec3 lfSpec = lfCube( vLfW + lfNw * 0.25, normalize( mix( lfR, lfNw, roughnessFactor * roughnessFactor ) ) );
    // the lightmap knows the shadows the cubes are too coarse to hold
    float lfOcc = clamp( lfLum / max( 1e-3, dot( lfSpec, vec3( 0.3, 0.6, 0.1 ) ) ), 0.2, 1.0 );
    vec3 lfRad = lfSpec * lfOcc;
    #ifdef LF_WET
    {
      // the street's mirror: last pass of the world seen from under the plane, stirred by the surface
      vec4 pc = lfPlanarVP * vec4( vLfW, 1.0 );
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      vec2 wob = ( lfNw.xz - vLfN.xz ) * ( 0.05 + roughnessFactor * 0.1 );
      float s = roughnessFactor * 0.018;
      vec3 mir = texture2D( lfPlanar, puv + wob ).rgb * 0.4;
      mir += texture2D( lfPlanar, puv + wob + vec2( s, s * 3.0 ) ).rgb * 0.2;
      mir += texture2D( lfPlanar, puv + wob + vec2( -s, -s * 3.0 ) ).rgb * 0.2;
      mir += texture2D( lfPlanar, puv + wob + vec2( s * 0.5, -s * 5.0 ) ).rgb * 0.2;
      lfRad = mix( lfRad, min( mir, vec3( 3.5 ) ), clamp( vLfN.y, 0.0, 1.0 ) * lfPlanarK );
    }
    #endif
    radiance += lfRad * lfWorldLight;
  #else
    irradiance += max( lfCube( vLfW + lfNw * 0.36, lfNw ), vec3( 0.0055, 0.0065, 0.0095 ) ) * PI * lfWorldLight;
    radiance += lfCube( vLfW + lfNw * 0.36, lfR ) * lfWorldLight * LF_SPEC;
  #endif
}
`;

const FRAG_WET = /* glsl */ `
#ifdef LF_WET
{
  float lfUp = clamp( vLfN.y, 0.0, 1.0 );
  vec2 lfP = vLfW.xz;
  float big = lfFbm( lfP * 0.24 + 11.0 );
  float small = lfFbm( lfP * 1.3 );
  float pud = smoothstep( 0.52, 0.66, big + ( small - 0.5 ) * 0.22 );
  float damp = 0.55 + 0.45 * smoothstep( 0.25, 0.5, big );
  float wet = mix( damp * 0.75, 1.0, pud ) * lfWet * lfUp;
  // walls run dark under the rain, more toward the foot
  float side = ( 1.0 - lfUp ) * lfWet * ( 0.25 + 0.5 * smoothstep( 0.35, 0.65, lfFbm( vec2( vLfW.x + vLfW.z, vLfW.y * 0.35 ) * 0.9 ) ) );
  wet = max( wet, side );
  diffuseColor.rgb *= mix( 1.0, 0.55, wet );
  roughnessFactor = mix( roughnessFactor, mix( 0.34, 0.05, pud * lfUp ), wet );
  lfPuddle = pud * lfUp * lfWet;
  lfPuddleK = pud;
}
#endif
`;

export interface LfOpts {
  lightmap?: boolean;
  wet?: number;
  /** held objects sit in shadow the coarse cubes can't see: scale what they mirror */
  spec?: number;
}

export function applyLF<T extends THREE.MeshStandardMaterial>(m: T, o: LfOpts = {}): T {
  m.defines = { ...(m.defines ?? {}) };
  if (o.lightmap) m.defines.LF_LM = 1;
  if (o.wet) m.defines.LF_WET = 1;
  m.defines.LF_SPEC = (o.spec ?? 1).toFixed(2);
  const wet = { value: o.wet ?? 0 };
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.() ?? '';
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.uniforms.lfLM = LF.lm;
    s.uniforms.lfVol = LF.vol;
    s.uniforms.lfVolMin = LF.volMin;
    s.uniforms.lfVolInv = LF.volInv;
    s.uniforms.lfVolDim = LF.volDim;
    s.uniforms.lfK = LF.lmK;
    s.uniforms.lfTime = LF.time;
    s.uniforms.lfWorldLight = LF.worldLight;
    s.uniforms.lfWet = wet;
    s.uniforms.lfPlanar = LF.planar;
    s.uniforms.lfPlanarVP = LF.planarVP;
    s.uniforms.lfPlanarK = LF.planarK;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS);
    s.vertexShader = s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat lfPuddle = 0.0;\nfloat lfPuddleK = 0.0;\n' + FRAG_WET);
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifdef LF_WET\nnormal = normalize( mix( normal, nonPerturbedNormal, lfPuddle ) );\n#endif\n');
    s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + FRAG_LIGHT);
  };
  m.customProgramCacheKey = () => `${prevKey}lf${o.lightmap ? 1 : 0}${o.wet ? 1 : 0}${o.spec ?? 1}`;
  return m;
}
