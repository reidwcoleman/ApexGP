import * as THREE from 'three';

/**
 * Aerial perspective for every material in the scene.
 *
 * three's fog chunks are replaced (globally, at import time) with an analytic
 * height fog: density ρ(h) = d0·exp(−k·(h − h0)) integrated exactly along the
 * view ray, extinction exp(−∫ρ), in-scatter = haze colour with a forward-scatter
 * lobe toward the sun (warm glow when looking into a low sun, blue-grey away).
 *
 * The extra parameters reach *all* built-in materials — including ones other
 * modules create — through uniforms injected into ShaderLib whose values are
 * plain shared objects (UniformsUtils.clone copies those by reference), so a
 * change here is seen by every program without recompiling anything.
 * `scene.fog` must still be a THREE.Fog so USE_FOG is defined; its colour is the
 * haze colour and near/far are a fallback for ShaderMaterials that lack our uniforms.
 */

/** x = density at h0 (1/m), y = height falloff k (1/m), z = h0 (m), w = max opacity */
export const aerialParams = { x: 1.6e-4, y: 1 / 260, z: 0, w: 1 };
/** direction TO the sun (world) */
export const aerialSunDir = { x: -0.6, y: 0.15, z: 0.78 };
/** colour added toward the sun (linear, premultiplied by strength) */
export const aerialSunColor = { r: 0.5, g: 0.3, b: 0.1 };

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world-space camera → vertex vector (R^T · viewPos)
  vFogRay = mvPosition.xyz * mat3( viewMatrix );
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 aerialParams;
  uniform vec3 aerialSunDir;
  uniform vec3 aerialSunColor;

  vec3 applyAerial( vec3 col ) {
    float dist = length( vFogRay );
    vec3 dir = vFogRay / max( dist, 1e-4 );
    float fogA;
    vec3 haze = fogColor;
    if ( aerialParams.x > 0.0 ) {
      float k = aerialParams.y;
      float camH = cameraPosition.y - aerialParams.z;
      float x = k * vFogRay.y;
      float f = abs( x ) > 1e-3 ? ( 1.0 - exp( - x ) ) / x : 1.0 - 0.5 * x;
      float od = aerialParams.x * exp( - k * max( camH, -50.0 ) ) * dist * f;
      fogA = min( 1.0 - exp( - od ), aerialParams.w );
      float mu = max( dot( dir, aerialSunDir ), 0.0 );
      float lobe = pow( mu, 5.0 ) * 0.55 + pow( mu, 24.0 ) * 0.9;
      haze += aerialSunColor * lobe;
    } else {
      #ifdef FOG_EXP2
        fogA = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        fogA = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
    }
    return mix( col, haze, fogA );
  }
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAerial( gl_FragColor.rgb );
#endif
`;

let installed = false;

export function installAerialFog() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
  for (const key of Object.keys(THREE.ShaderLib)) {
    const sh = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key];
    if (sh && sh.uniforms && 'fogColor' in sh.uniforms) {
      sh.uniforms.aerialParams = { value: aerialParams };
      sh.uniforms.aerialSunDir = { value: aerialSunDir };
      sh.uniforms.aerialSunColor = { value: aerialSunColor };
    }
  }
}

/** uniforms to merge into custom ShaderMaterials that set `fog: true` */
export function aerialUniforms(): Record<string, THREE.IUniform> {
  return {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    aerialParams: { value: aerialParams },
    aerialSunDir: { value: aerialSunDir },
    aerialSunColor: { value: aerialSunColor },
  };
}

/** Same maths on the CPU (for colours of far impostors, debugging). */
export function aerialOpacity(dist: number, dirY: number, camY: number): number {
  const k = aerialParams.y;
  const x = k * dirY * dist;
  const f = Math.abs(x) > 1e-3 ? (1 - Math.exp(-x)) / x : 1 - 0.5 * x;
  const od = aerialParams.x * Math.exp(-k * Math.max(camY - aerialParams.z, -50)) * dist * f;
  return Math.min(1 - Math.exp(-od), aerialParams.w);
}

installAerialFog();
