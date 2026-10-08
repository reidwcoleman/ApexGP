import * as THREE from 'three';
import { HL_MAX, headlightUniforms } from './headlights.ts';
import { floodTex, floodUniforms } from './night.ts';

/**
 * Aerial perspective for every material in the scene.
 *
 * three's fog chunks are replaced (globally, at import time) with an analytic
 * height fog: density ρ(h) = d0·exp(−k·(h − h0)) integrated exactly along the
 * view ray, extinction exp(−∫ρ), in-scatter = haze colour with a forward-scatter
 * lobe toward the sun (warm glow when looking into a low sun, blue-grey away). Fog, mist and
 * the steam off a drying track add a second, shallow exponential under it (`aerialGround`):
 * a layer tens of metres deep anchored to the circuit's level, drifting in banks, with the
 * strong forward glow of water droplets round the sun.
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
/**
 * x = haze density scale for the lens in use (1; a long lens thins it, set by the Game);
 * y = colour of the air 0 … 1 (Environment): clear air scatters blue out of a view ray faster than
 * red, so a hill a few kilometres off turns blue-grey long before it melts into the horizon — the
 * layering of ridges in real footage. 0 = grey droplets (fog, rain), which take every colour alike.
 */
export const aerialLens = { x: 1, y: 0 };
/** fog banks: x = patchiness 0 … 1 (0 = off), y = 1 / bank size (1/m), zw = drift offset (m) */
export const aerialBanks = { x: 0, y: 1 / 380, z: 0, w: 0 };
/**
 * The ground layer: radiation fog, morning mist, steam off a drying track. Real fog is a layer tens of
 * metres deep lying in the hollows (a TV tower or the helicopter looks over its top at the trees and
 * stands poking out of it), not the kilometre-tall haze above — so it gets its own exponential on top
 * of the haze, anchored at an absolute height (the circuit's mean level), which makes it thicker
 * wherever the land is lower: valley fog. It keeps thickening only down to `w` below the anchor.
 * x = density at the anchor (1/m, 0 = off), y = height falloff (1/m), z = anchor height (m), w = depth
 * of the floor below the anchor (m).
 */
export const aerialGround = { x: 0, y: 1 / 40, z: 0, w: 40 };
/**
 * The ground layer's sunlit glow: droplets scatter forward far more strongly than clear air (fog's phase
 * function has g ≈ 0.85), so looking toward the sun the whole murk brightens round it — the white glare
 * of a foggy morning, even once the disc itself is gone. Linear, premultiplied by strength.
 */
export const aerialFogSun = { r: 0, g: 0, b: 0 };
/**
 * The cars' headlights lighting the murk (night and twilight): x = how strongly (0 = off: by day and in
 * clear air it costs one branch), y = the most lamps to march (the nearest the camera, from the
 * headlights' own list). Driving at night in fog the beams are a glowing white wedge in the air ahead
 * and a car coming the other way is a ball of light long before it is a car — a single haze colour
 * can't be lit by lamps, so the beams' in-scattered light is integrated along each view ray.
 */
export const aerialLampFog = { x: 0, y: 3 };
/** how many beams to march at most (each one costs ~8 taps on every fogged pixel) */
const LAMP_FOG_MAX = 3;

/**
 * The ground layer's optical depth along a view ray (shared with the particles, which evaluate it per
 * sprite corner): the exact integral of ρ(h) = d0·exp(−k(h − h0)) with both ends of the ray held above
 * the layer's floor, times the banks — slow value noise in world x/z sampled near and far along the ray,
 * so the hollow ahead can be thick while the next straight is clearer, drifting with the wind.
 */
export const AERIAL_GROUND = /* glsl */ `
  float aerialHash( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
  float aerialNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = p - i;
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( aerialHash( i ), aerialHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( aerialHash( i + vec2( 0.0, 1.0 ) ), aerialHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  float aerialBank( vec2 xz ) {
    vec2 bp = ( xz + aerialBanks.zw ) * aerialBanks.y;
    return aerialNoise( bp ) * 0.65 + aerialNoise( bp * 2.7 + 5.3 ) * 0.35;
  }
  // a droplet's phase function: a broad brightening over the sun's half of the sky and a tight, bright
  // core round the sun itself
  float aerialFogLobe( float mu ) {
    float m2 = mu * mu;
    return m2 * 0.3 + m2 * m2 * m2 * 0.55 + pow( mu, 48.0 ) * 1.5;
  }
  float aerialGroundOd( vec3 cam, vec3 ray, float dist ) {
    if ( aerialGround.x <= 0.0 ) return 0.0;
    float k = aerialGround.y;
    float floorH = aerialGround.z - aerialGround.w;
    float h0 = max( cam.y, floorH );
    float h1 = max( cam.y + ray.y, floorH );
    float x = clamp( k * ( h1 - h0 ), -40.0, 40.0 );
    float f = abs( x ) > 1e-3 ? ( 1.0 - exp( - x ) ) / x : 1.0 - 0.5 * x;
    float od = aerialGround.x * exp( - k * ( h0 - aerialGround.z ) ) * dist * f;
    // (a long lens thins the clear-day haze for contrast; fog is the subject, so only a little of it)
    od *= mix( 1.0, aerialLens.x, 0.3 );
    if ( aerialBanks.x > 0.0 ) {
      // two points on the ray, the nearer one inside the first ~100 m; fading to the mean far away,
      // where a ray has crossed many banks
      float tn = min( 1.0, 90.0 / max( dist, 1.0 ) );
      float bn = aerialBank( cam.xz + ray.xz * ( 0.5 * tn ) ) * 0.5 + aerialBank( cam.xz + ray.xz * 0.85 ) * 0.5;
      od *= max( 0.0, 1.0 + aerialBanks.x * ( bn * 2.0 - 1.0 ) * 1.3 * exp( - dist * aerialBanks.y * 0.2 ) );
    }
    return od;
  }
`;

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
  uniform vec4 aerialBanks;
  uniform vec2 aerialLens;
  uniform vec4 aerialGround;
  uniform vec3 aerialFogSun;
  uniform vec2 aerialLampFog;
  uniform vec4 aerialLampPos[ ${HL_MAX} ];
  uniform vec4 aerialLampDir[ ${HL_MAX} ];
  uniform vec4 aerialLampInfo;
  uniform vec3 aerialLampCol;
  uniform sampler2D aerialFloodMap;
  uniform vec4 aerialFloodXf;
  uniform vec4 aerialFloodP;
  uniform vec4 aerialFloodH;
  uniform vec3 aerialFloodCol;
${AERIAL_GROUND}

  // the floodlit air (twilight): in fog or mist the light of the lamp rows round the circuit is scattered
  // by the droplets it crosses, so the air over the track glows — the bright dome a floodlit stadium
  // wears on a foggy evening — and darkens away from it, instead of one flat grey. Six taps along the
  // first few hundred metres of the ray, each lit by both rows as the surfaces are (night.ts: the
  // distance to the centreline from the flood field, ~1/r from each row, the reach fading off the track)
  vec3 aerialFlood( vec3 dir, float dist, float sig ) {
    float tMax = min( dist, 360.0 );
    float dt = tMax / 6.0;
    float fr0 = length( aerialFloodP.yz );
    float s = 0.0;
    for ( int i = 0; i < 6; i ++ ) {
      float t = ( float( i ) + 0.5 ) * dt;
      vec3 q = cameraPosition + dir * t;
      vec2 uv = ( q.xz - aerialFloodXf.xy ) * aerialFloodXf.zw;
      if ( uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0 ) continue;
      vec4 fm = texture2D( aerialFloodMap, uv );
      float fd = fm.r * 255.0;
      if ( fd >= aerialFloodP.w ) continue;
      float above = q.y - ( aerialFloodH.x + fm.a * aerialFloodH.y );
      float r1 = length( vec2( fd - aerialFloodP.y, aerialFloodP.z - above ) );
      float r2 = length( vec2( fd + aerialFloodP.y, aerialFloodP.z - above ) );
      float e = fr0 / max( r1, 5.0 ) + 0.5 * fr0 / max( r2, 5.0 );
      e *= ( 1.0 - smoothstep( aerialFloodP.w * 0.5, aerialFloodP.w, fd ) ) * exp( - max( fd - aerialFloodP.y - 8.0, 0.0 ) / 55.0 );
      // (the lamps aim down: above their heads only spill reaches the air)
      e *= 1.0 - 0.75 * smoothstep( aerialFloodP.z, aerialFloodP.z + 40.0, above );
      s += e * exp( - sig * t );
    }
    // (isotropic phase, 1 / 4π)
    return aerialFloodCol * ( aerialFloodP.x * s * dt * sig * 0.0796 * aerialLampFog.x );
  }

  // the headlight beams' light scattered toward the camera by the air along the view ray (σ: the mean
  // extinction along it, 1/m). Eight taps over the stretch of the ray the beam can reach; each tap is lit
  // by the lamp's own pattern (wide and flat, cut off just above its axis — headlights.ts) with the same
  // gentle fall-off the road gets, and droplets' phase: a strong forward lobe (a car coming at the
  // camera is a blazing ball in fog) over a weak back-scatter (the wall of grey glare ahead of your own)
  vec3 aerialLamps( vec3 dir, float dist, float sig ) {
    vec3 acc = vec3( 0.0 );
    int n = int( min( aerialLampInfo.x, aerialLampFog.y ) );
    for ( int k = 0; k < ${LAMP_FOG_MAX}; k ++ ) {
      if ( k >= n ) break;
      vec4 P = aerialLampPos[ k ];
      if ( P.w <= 0.0 ) continue;
      vec3 fw = aerialLampDir[ k ].xyz;
      vec3 rel = P.xyz - cameraPosition;
      float tP = dot( rel, dir );
      float tE = dot( rel + fw * 70.0, dir );
      float tA = clamp( min( tP, tE ) - 25.0, 0.0, dist );
      float tB = clamp( max( tP, tE ) + 25.0, 0.0, dist );
      if ( tB - tA < 0.5 ) continue;
      vec3 lf = normalize( vec3( fw.z, 0.0, -fw.x ) + vec3( 1e-5 ) );
      vec3 lu = cross( fw, lf );
      float dt = ( tB - tA ) / 8.0;
      float s = 0.0;
      for ( int i = 0; i < 8; i ++ ) {
        float t = tA + ( float( i ) + 0.5 ) * dt;
        vec3 lq = cameraPosition + dir * t - P.xyz;
        float along = dot( lq, fw );
        if ( along < 0.4 ) continue;
        float ex = dot( lq, lf ) / along * aerialLampInfo.y;
        float ey = dot( lq, lu ) / along * aerialLampInfo.z;
        ey *= ey > 0.0 ? 3.2 : 1.0;
        float e = ex * ex + ey * ey;
        if ( e >= 1.0 ) continue;
        float d = length( lq );
        float cone = 1.0 - smoothstep( 0.1, 1.0, e );
        float fall = 1.0 - smoothstep( aerialLampInfo.w * 0.45, aerialLampInfo.w, d );
        float mu = dot( lq / d, - dir );
        float ph = 0.06 + 0.5 * pow( max( mu, 0.0 ), 6.0 ) + 2.5 * pow( max( mu, 0.0 ), 40.0 );
        s += cone * fall * ph / ( ( d + 2.5 ) * ( 1.0 + d / 35.0 ) ) * exp( - sig * ( t + d ) );
      }
      acc += P.w * s * dt;
    }
    return acc * sig * aerialLampFog.x * aerialLampCol;
  }

  vec3 applyAerial( vec3 col ) {
    float dist = length( vFogRay );
    vec3 dir = vFogRay / max( dist, 1e-4 );
    float fogA;
    vec3 fogA3 = vec3( 0.0 );
    vec3 haze = fogColor;
    float sigMean = 0.0;
    if ( aerialParams.x > 0.0 ) {
      float k = aerialParams.y;
      float camH = cameraPosition.y - aerialParams.z;
      float x = k * vFogRay.y;
      float f = abs( x ) > 1e-3 ? ( 1.0 - exp( - x ) ) / x : 1.0 - 0.5 * x;
      float od = aerialParams.x * aerialLens.x * exp( - k * max( camH, -50.0 ) ) * dist * f;
      // the ground layer (fog, mist, steam): grey droplets, lying in drifting banks
      float odG = aerialGroundOd( cameraPosition, vFogRay, dist );
      sigMean = ( od + odG ) / max( dist, 1.0 );
      // per channel: blue is lost first (aerialLens.y), so distance reads as a colour shift, not just
      // a fade — near ridges stay dark and green, the next ones blue-grey, the last ones pale
      vec3 odc = od * ( 1.0 + aerialLens.y * vec3( -0.2, 0.0, 0.26 ) ) + odG;
      fogA3 = min( 1.0 - exp( - odc ), vec3( aerialParams.w ) );
      fogA = fogA3.g;
      float mu = max( dot( dir, aerialSunDir ), 0.0 );
      // the glow round a low sun is the whole atmosphere's forward scatter: it builds over kilometres of
      // air, so a car a few hundred metres down a long lens isn't veiled in it (the sunset wash)
      float lobe = ( pow( mu, 5.0 ) * 0.55 + pow( mu, 24.0 ) * 0.9 ) * ( 1.0 - exp( - dist / 1800.0 ) );
      // (in fog the glow is a share of the murk itself, reached within metres, not of the distance)
      float wG = odG / max( od + odG, 1e-6 );
      haze += aerialSunColor * lobe * ( 1.0 - wG ) + aerialFogSun * ( aerialFogLobe( mu ) * wG );
    } else {
      #ifdef FOG_EXP2
        fogA = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        fogA = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
      fogA3 = vec3( fogA );
    }
    vec3 lit = mix( col, haze, fogA3 );
    if ( aerialLampFog.x > 0.0 && aerialLampInfo.x > 0.5 ) lit += aerialLamps( dir, dist, sigMean );
    if ( aerialLampFog.x > 0.0 && aerialFloodP.x > 0.0 ) lit += aerialFlood( dir, dist, sigMean );
    return lit;
  }
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAerial( gl_FragColor.rgb );
#endif
`;

/** the headlights' own arrays, by reference (headlights.ts fills them each frame, nearest first) */
const lampUniforms = (): Record<string, THREE.IUniform> => ({
  aerialLampFog: { value: aerialLampFog },
  aerialLampPos: { value: headlightUniforms.pos },
  aerialLampDir: { value: headlightUniforms.dir },
  aerialLampInfo: { value: headlightUniforms.info },
  aerialLampCol: { value: headlightUniforms.color },
  aerialFloodMap: { value: floodTex },
  aerialFloodXf: { value: floodUniforms.xform },
  aerialFloodP: { value: floodUniforms.params },
  aerialFloodH: { value: floodUniforms.height },
  aerialFloodCol: { value: floodUniforms.color },
});

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
      sh.uniforms.aerialBanks = { value: aerialBanks };
      sh.uniforms.aerialLens = { value: aerialLens };
      sh.uniforms.aerialGround = { value: aerialGround };
      sh.uniforms.aerialFogSun = { value: aerialFogSun };
      Object.assign(sh.uniforms, lampUniforms());
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
    aerialBanks: { value: aerialBanks },
    aerialLens: { value: aerialLens },
    aerialGround: { value: aerialGround },
    aerialFogSun: { value: aerialFogSun },
    ...lampUniforms(),
  };
}

/** Same maths on the CPU (for colours of far impostors, debugging). */
export function aerialOpacity(dist: number, dirY: number, camY: number): number {
  const k = aerialParams.y;
  const x = k * dirY * dist;
  const f = Math.abs(x) > 1e-3 ? (1 - Math.exp(-x)) / x : 1 - 0.5 * x;
  // (the green channel's opacity: the middle of the per-channel fade)
  const od = aerialParams.x * Math.exp(-k * Math.max(camY - aerialParams.z, -50)) * dist * f;
  return Math.min(1 - Math.exp(-od), aerialParams.w);
}

installAerialFog();
