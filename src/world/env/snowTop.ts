import * as THREE from 'three';

/**
 * Snow (and a frost's rime) on the tops of things: the barrier rails, the stands' roofs and seat rows,
 * the gantries, the village roofs. A patched `lights_fragment_begin` whitens the material where its
 * world normal faces up, patchy at first and closing as the cover deepens, before any light is
 * computed — so it is lit, shadowed and fogged like the surface it lies on.
 *
 * Opt-in: a material takes part with `defines.SNOW_TOP` (`snowTop(m)`); the road, the verges, the
 * terrain and the trees draw their own snow, and the cars and the people none. The uniform is shared
 * by reference from ShaderLib (the floodlights' trick, env/night.ts), so one write reaches them all.
 */

/** x: cover 0 … 1 (weatherUniforms.uSnowCover, copied each frame by the Environment) */
export const snowTopUniform = { x: 0, y: 0, z: 0, w: 0 };

const PARS = /* glsl */ `
uniform vec4 snowTopK;
`;

const TOP = /* glsl */ `
#ifdef SNOW_TOP
if ( snowTopK.x > 0.002 ) {
  vec3 stN = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
  vec3 stP = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
  // patchy where it is thin: a cheap value noise over the world, a couple of metres across
  vec2 stQ = stP.xz * 0.6 + stP.y * 0.4;
  vec2 stI = floor( stQ );
  vec2 stF = fract( stQ );
  stF = stF * stF * ( 3.0 - 2.0 * stF );
  float stH00 = fract( sin( dot( stI, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  float stH10 = fract( sin( dot( stI + vec2( 1.0, 0.0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  float stH01 = fract( sin( dot( stI + vec2( 0.0, 1.0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  float stH11 = fract( sin( dot( stI + vec2( 1.0, 1.0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  float stNz = mix( mix( stH00, stH10, stF.x ), mix( stH01, stH11, stF.x ), stF.y );
  float stK = smoothstep( 0.45, 0.8, stN.y ) * smoothstep( 0.0, 0.3, snowTopK.x * 1.4 - 0.55 * stNz );
  // (a frost or a first dusting is a pale rime over the colour, not a white sheet)
  stK *= mix( 0.55, 1.0, smoothstep( 0.2, 0.7, snowTopK.x ) );
  material.diffuseColor = mix( material.diffuseColor, vec3( 0.8, 0.83, 0.88 ), stK );
  material.diffuseContribution = mix( material.diffuseContribution, vec3( 0.8, 0.83, 0.88 ), stK );
  material.metalness = mix( material.metalness, 0.0, stK );
  material.roughness = mix( material.roughness, 0.8, stK );
  material.specularColor = mix( material.specularColor, vec3( 0.04 ), stK );
  material.specularColorBlended = mix( material.specularColorBlended, vec3( 0.04 ), stK );
}
#endif
`;

let installed = false;
export function installSnowTop() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin + PARS;
  THREE.ShaderChunk.lights_fragment_begin = TOP + THREE.ShaderChunk.lights_fragment_begin;
  for (const key of ['standard', 'physical']) {
    const sh = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key];
    if (sh?.uniforms) sh.uniforms.snowTopK = { value: snowTopUniform };
  }
}
installSnowTop();

/** let snow settle on this material's upward faces */
export function snowTop<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.defines = { ...(m.defines ?? {}), SNOW_TOP: '' };
  return m;
}
