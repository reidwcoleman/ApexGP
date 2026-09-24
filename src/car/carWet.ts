/**
 * Wet-weather shading for the car materials (onBeforeCompile snippets).
 *
 * Everything reads the shared `weatherUniforms` (uWetness / uRain), so one
 * update per frame reaches every car with no recompiles. Wet look:
 *   - paint: clearcoat → 1, near-mirror clearcoat roughness, slightly deeper colour,
 *     water beads + airflow-stretched rivulets perturbing the clearcoat normal
 *     (more drops appear as it rains harder)
 *   - carbon: darker, much glossier, same beads
 *   - tyres: darker, glossy rubber
 *   - trim: lower roughness
 */
import * as THREE from 'three';
import { weatherUniforms } from '../world/weatherUniforms.ts';

// ------------------------------------------------------------------------------------ bead texture
let beadTex: THREE.Texture | null = null;
/** RG = drop normal (0.5 biased), B = per-drop random id (coverage threshold), A = drop mask */
export function beadTexture(): THREE.Texture {
  if (beadTex) return beadTex;
  const S = 512;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = 128;
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 0;
  }
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const N = 650;
  for (let k = 0; k < N; k++) {
    const cx = rnd() * S;
    const cy = rnd() * S;
    // mostly small beads, a few big ones
    const r = 1.6 + Math.pow(rnd(), 3) * 6.5;
    const id = rnd();
    const ry = r * (0.85 + rnd() * 0.3);
    const R = Math.ceil(Math.max(r, ry)) + 1;
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const u = x / r;
        const v = y / ry;
        const d2 = u * u + v * v;
        if (d2 >= 1) continue;
        const px = ((Math.floor(cx) + x) % S + S) % S;
        const py = ((Math.floor(cy) + y) % S + S) % S;
        const o = (py * S + px) * 4;
        // spherical cap: normal leans outward, strongest at the rim
        const h = Math.sqrt(1 - d2);
        const nx = u * 0.85;
        const ny = v * 0.85;
        const l = Math.hypot(nx, ny, h + 0.15);
        data[o] = Math.round((nx / l) * 127 + 128);
        data[o + 1] = Math.round((ny / l) * 127 + 128);
        data[o + 2] = Math.round(id * 255);
        data[o + 3] = Math.round(Math.min(1, (1 - d2) * 3) * 255);
      }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  beadTex = t;
  return t;
}

// ------------------------------------------------------------------------------------ glsl
/** declarations: put after `#include <common>` in the fragment shader */
export const WET_PARS = /* glsl */ `
uniform float uWetness;
uniform float uRain;
uniform sampler2D wetBeads;
float carWetAmount() { return clamp( max( uRain * 1.8, uWetness * 0.7 ), 0.0, 1.0 ); }
mat3 wetTBN( vec3 N, vec3 p, vec2 uv ) {
  vec3 dp1 = dFdx( p );
  vec3 dp2 = dFdy( p );
  vec2 duv1 = dFdx( uv );
  vec2 duv2 = dFdy( uv );
  vec3 dp2perp = cross( dp2, N );
  vec3 dp1perp = cross( N, dp1 );
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float inv = det == 0.0 ? 0.0 : inversesqrt( det );
  return mat3( T * inv, B * inv, N );
}
// tangent-space normal offset of beads + rivulets stretched along u (the airflow)
vec2 wetBeadOffset( vec2 uv, float wet ) {
  vec4 b = texture2D( wetBeads, uv );
  float on = b.a * step( b.b, wet * 0.7 - 0.08 );
  vec2 suv = uv * vec2( 0.45, 2.1 ) + vec2( 0.31, 0.17 );
  vec4 s = texture2D( wetBeads, suv );
  float on2 = s.a * step( s.b, wet * 0.5 - 0.15 );
  return ( b.rg * 2.0 - 1.0 ) * on + ( s.rg * 2.0 - 1.0 ) * vec2( 0.45, 2.1 ) * 0.35 * on2;
}
`;

export function wetUniforms(sh: { uniforms: Record<string, THREE.IUniform> }) {
  sh.uniforms.uWetness = weatherUniforms.uWetness;
  sh.uniforms.uRain = weatherUniforms.uRain;
  sh.uniforms.wetBeads = { value: beadTexture() };
}

/**
 * clearcoat bead perturbation — put after `#include <clearcoat_normal_fragment_maps>`.
 * `uvExpr` is a metric uv (1 unit ≈ 6 cm), `wetExpr` the wet amount.
 */
export function wetClearcoatBeads(uvExpr: string, wetExpr: string, scale = 0.12, strength = 0.8) {
  return /* glsl */ `
  #ifdef USE_CLEARCOAT
  {
    float bw = ${wetExpr};
    if ( bw > 0.02 ) {
      vec2 buv = ( ${uvExpr} ) * ${scale.toFixed(3)};
      vec2 off = wetBeadOffset( buv, bw ) * ${strength.toFixed(3)};
      mat3 wt = wetTBN( clearcoatNormal, - vViewPosition, buv );
      clearcoatNormal = normalize( wt * vec3( off, 1.0 ) );
    }
  }
  #endif
  `;
}
