/**
 * Race grime on the bodywork (paint + carbon, per car) and metallic flake for the paint.
 *
 * uGrime: x road film (builds with distance), y rubber flecks sprayed off the tyres (marbles),
 *         z dirt / grass dust after offs, w unused.
 * Masks come from body-space position (low bodywork, the wake behind the front wheels on the
 * sidepod fronts and floor edges, the diffuser / crash structure behind the rears) and a metric
 * uv for the pattern (film streaked along the airflow, flecks from the tyre detail blobs).
 */
import * as THREE from 'three';
import { tyreDetailTexture } from './carTyres.ts';

export interface GrimeUniforms {
  uGrime: { value: THREE.Vector4 };
}
export function grimeUniforms(): GrimeUniforms {
  return { uGrime: { value: new THREE.Vector4(0, 0, 0, 0) } };
}

export const GRIME_VERT_PARS = /* glsl */ `
varying vec3 vGrimePos;
`;
export const GRIME_VERT = /* glsl */ `
vGrimePos = position;
`;

export const GRIME_PARS = /* glsl */ `
uniform vec4 uGrime;
uniform sampler2D grimeTex;
varying vec3 vGrimePos;
// (film, flecks, dirt) coverage at this texel; muv = metric uv (1 unit ≈ 6 cm)
vec3 carGrime( vec2 muv ) {
  if ( uGrime.x + uGrime.y + uGrime.z < 0.003 ) return vec3( 0.0 );
  vec3 p = vGrimePos;
  float ax = abs( p.x );
  float low = 1.0 - smoothstep( 0.08, 0.42, p.y );
  // wake of the front tyres: sidepod fronts, floor edges, bargeboard area
  float wakeF = smoothstep( 1.5, 1.05, p.z ) * smoothstep( -0.6, 0.1, p.z ) * smoothstep( 0.28, 0.55, ax ) * ( 1.0 - smoothstep( 0.3, 0.75, p.y ) );
  // behind the rears: diffuser, crash structure, beam wing, endplate feet
  float wakeR = smoothstep( -1.95, -2.25, p.z ) * ( 1.0 - smoothstep( 0.55, 0.95, p.y ) );
  // the front wing and nose catch the car ahead's spray
  float front = smoothstep( 2.4, 2.9, p.z ) * ( 1.0 - smoothstep( 0.12, 0.3, p.y ) );
  vec4 st = texture2D( grimeTex, muv * vec2( 0.02, 0.11 ) + vec2( 0.13, 0.41 ) );
  float streak = st.a;
  float zone = clamp( low * 0.75 + wakeF * 0.7 + wakeR * 0.8 + front * 0.5, 0.0, 1.0 );
  float film = uGrime.x * zone * smoothstep( 0.2, 0.7, streak + zone * 0.25 );
  // flecks: stretched by the airflow (along u)
  vec4 fl = texture2D( grimeTex, muv * vec2( 0.03, 0.075 ) + vec2( 0.51, 0.23 ) );
  float fz = clamp( wakeF * 1.1 + wakeR + low * 0.12 + front * 0.3, 0.0, 1.0 );
  float flecks = smoothstep( 0.1, 0.5, fl.g ) * step( fl.b, uGrime.y * fz * 0.4 );
  float dirt = uGrime.z * clamp( low + wakeF * 0.6, 0.0, 1.0 ) * smoothstep( 0.35, 0.65, streak );
  return vec3( film, flecks, dirt );
}
vec3 carGrimeColour( vec3 base, vec3 g ) {
  base = mix( base, vec3( 0.105, 0.095, 0.082 ), g.x * 0.55 );
  base = mix( base, vec3( 0.12, 0.1, 0.065 ), g.z * 0.7 );
  base = mix( base, vec3( 0.012, 0.011, 0.01 ), g.y );
  return base;
}
`;

export function grimeShaderUniforms(sh: { uniforms: Record<string, THREE.IUniform> }, g: GrimeUniforms) {
  sh.uniforms.uGrime = g.uGrime;
  sh.uniforms.grimeTex = { value: tyreDetailTexture() };
}

// ------------------------------------------------------------------------------------ metallic flake
let flakeTex: THREE.DataTexture | null = null;
/** random flake normals (RG, 0.5 biased); a flake is ~1 mm on the paint */
export function flakeTexture(): THREE.DataTexture {
  if (flakeTex) return flakeTex;
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < S * S; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.7);
    data[i * 4] = Math.round((Math.cos(a) * r * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((Math.sin(a) * r * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  flakeTex = t;
  return t;
}
