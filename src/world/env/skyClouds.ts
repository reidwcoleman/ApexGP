import * as THREE from 'three';
import type { QualityLevel } from '../../core/Renderer.ts';

/**
 * Volumetric clouds, ray-marched into a sky panorama.
 *
 * The upper hemisphere around the camera is stored in an RGBA16F texture
 * (u = azimuth, v = sqrt(elevation / 90°) so the horizon, where a racing game
 * looks, gets most of the texels): rgb = light scattered toward the camera by
 * the clouds (already faded into the horizon haze), a = transmittance.
 * The sky dome composites it over the atmosphere (`sky·a + rgb`) at full
 * resolution, and the same panorama feeds the environment map, so reflections
 * show the same clouds.
 *
 * Each frame only one 2×2 quad of every 4×2 quads is re-marched (high; every
 * other quad-pair on ultra) with a fresh jitter and blended into a running
 * average (ping-pong targets), the rest keep last frame's value — clouds move
 * slowly, so a refresh every 8 frames is invisible, the average removes the
 * step noise, and a camera cut just switches the averaging off until every
 * texel has been re-marched (no frame hitch).
 *
 * The march: a curved slab (cloud base … top) over a 6360 km planet, adaptive
 * steps (coarse through clear air, fine inside cloud), Perlin-Worley shape noise
 * shaped by a coverage field and a height profile, Worley erosion, a 1–2 tap
 * light march toward the sun with multiple-scattering octaves and a two-lobe
 * phase (silver linings), sky ambient occluded from above, a lumpy textured
 * underside for closed rain decks, energy-conserving integration, aerial
 * perspective, cirrus at 8 km and rain shafts toward the horizon.
 */

/** Large-scale cloud coverage field shared with the ground cloud shadows (x, z in metres). */
export const CLOUD_FIELD_GLSL = /* glsl */ `
float cf_hash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float cf_noise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = cf_hash( i );
  float b = cf_hash( i + vec2( 1.0, 0.0 ) );
  float c = cf_hash( i + vec2( 0.0, 1.0 ) );
  float d = cf_hash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// 0 … 1, features ~6-15 km
float cloudField( vec2 xz ) {
  vec2 p = xz * ( 1.0 / 9000.0 );
  float n = cf_noise( p ) * 0.6 + cf_noise( p * 2.3 + 5.2 ) * 0.28 + cf_noise( p * 5.1 + 1.7 ) * 0.12;
  return n;
}
// local coverage for a global coverage 0 … 1
float localCoverage( float field, float coverage ) {
  return clamp( coverage * 1.12 + ( field - 0.5 ) * mix( 1.0, 0.25, coverage * coverage ), 0.0, 1.0 );
}
`;

const VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

uniform sampler3D uNoise;
uniform sampler2D uPrev;
uniform float uBlend;
uniform int uFrame;
uniform vec2 uRes;
uniform int uPhase;
uniform int uPhases;
uniform int uSteps;
uniform int uMaxIter;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uTime;
uniform float uCoverage;
uniform float uBase;
uniform float uThick;
uniform float uExt;
uniform float uDark;
uniform float uFloor;
uniform float uHaze;
uniform float uCirrus;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbTop;
uniform vec3 uAmbBase;
uniform vec3 uCirrusCol;
uniform float uRain;
uniform vec3 uRainCol;

#define PI 3.141592653589793
#define R_EARTH 6360000.0
#define T_MAX 45000.0

${CLOUD_FIELD_GLSL}

float remap( float x, float a, float b, float c, float d ) {
  return c + ( x - a ) / ( b - a ) * ( d - c );
}

// far intersection of a ray from radius r0 (direction cosine mu) with a sphere of radius rs > r0
float shellT( float r0, float mu, float rs ) {
  float D = ( rs - r0 ) * ( rs + r0 );
  float b = r0 * mu;
  return D / ( b + sqrt( b * b + D ) );
}

float hg( float c, float g ) {
  float g2 = g * g;
  return ( 1.0 - g2 ) / ( 4.0 * PI * pow( max( 1.0 + g2 - 2.0 * g * c, 1e-4 ), 1.5 ) );
}

// base shape density (no erosion)
float shapeDensity( vec3 p, float h01, float wc, float lod ) {
  if ( h01 <= 0.0 || h01 >= 1.0 ) return 0.0;
  vec4 n = textureLod( uNoise, p * vec3( 1.0 / 4600.0, 1.0 / 3200.0, 1.0 / 4600.0 ), lod );
  float fbm = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = remap( n.r, fbm - 1.0, 1.0, 0.0, 1.0 );
  // cumulus: soft flat base, rounded top that rises with coverage; decks are flatter
  float bottom = smoothstep( 0.0, mix( 0.07, 0.2, uDark ), h01 );
  float top = 1.0 - smoothstep( mix( 0.25, 0.7, wc ), 1.0, h01 );
  float hp = bottom * top;
  float d = clamp( remap( base * hp, 1.0 - wc, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
  // a solid deck when the sky is overcast: its underside hangs in lumps (lower where the
  // billow noise is high), so the base reads as a dark, textured ceiling rather than a sheet
  if ( uFloor > 0.0 ) {
    float lump = ( 1.0 - n.r ) * ( 1.0 - fbm * 0.5 );
    float b0 = lump * mix( 300.0, 480.0, uDark ) / uThick;
    float deckBottom = smoothstep( b0, b0 + 90.0 / uThick + 0.03, h01 );
    d = max( d, uFloor * deckBottom * top * ( 0.5 + 0.5 * base ) );
  }
  return d;
}

float detailErode( float d, vec3 p, float h01, float lod ) {
  vec4 n = textureLod( uNoise, p * ( 1.0 / 1100.0 ) + vec3( 0.37, 0.61 + uTime * 0.0004, 0.13 ), lod );
  float f = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  // wispy at the base, billowy (cauliflower) toward the top
  float m = mix( f, 1.0 - f, clamp( h01 * 3.0, 0.0, 1.0 ) );
  return clamp( remap( d, m * 0.55, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
}

void main() {
  // interleave whole 2×2 quads (GPUs shade quads: a lone live pixel per quad would cost the full quad);
  // texels not due this frame keep last frame's value
  ivec2 fc = ivec2( gl_FragCoord.xy );
  ivec2 px = fc >> 1;
  bool due = true;
  if ( uPhases == 8 ) due = ( px.x & 3 ) + 4 * ( px.y & 1 ) == uPhase;
  else if ( uPhases == 4 ) due = ( px.x & 1 ) + 2 * ( px.y & 1 ) == uPhase;
  else if ( uPhases == 2 ) due = ( ( px.x + px.y ) & 1 ) == uPhase;
  vec4 prev = texelFetch( uPrev, fc, 0 );
  if ( !due ) {
    outColor = prev;
    return;
  }

  vec2 uv = gl_FragCoord.xy / uRes;
  float el = uv.y * uv.y * ( PI * 0.5 );
  float az = uv.x * 2.0 * PI;
  vec3 d = vec3( cos( az ) * cos( el ), sin( el ), sin( az ) * cos( el ) );
  float mu = max( d.y, 0.0 );

  float hc = clamp( uCam.y, 0.0, 400.0 );
  float r0 = R_EARTH + hc;
  float tB = shellT( r0, mu, R_EARTH + uBase );
  float tT = shellT( r0, mu, R_EARTH + uBase + uThick );
  float t0 = tB;
  float t1 = min( tT, T_MAX );

  vec3 C = vec3( 0.0 );
  float T = 1.0;
  float tw = 0.0, wsum = 0.0;
  float cosT = dot( d, uSunDir );
  // two-lobe phase (silver lining toward the sun, some back-scatter), and a much flatter one
  // for the multiply scattered light
  float phase = mix( hg( cosT, 0.78 ), hg( cosT, -0.25 ), 0.4 );
  float phase2 = mix( hg( cosT, 0.3 ), hg( cosT, -0.15 ), 0.4 );
  float phase3 = 0.0795774715;

  // per-texel jitter that changes every update; the running average below turns it into smooth gradients
  float jitter = fract( cf_hash( gl_FragCoord.xy * 1.37 ) + float( uFrame ) * 0.61803399 );

  // structure of a closed deck's underside (2-5 km thicker/thinner patches): thin patches let
  // more light through, thick ones sag and darken — the texture of a rain sky
  float deckK = 1.0;
  if ( uFloor > 0.0 && t0 < T_MAX ) {
    vec2 bxz = uCam.xz + d.xz * t0 + uWind * 0.8;
    float lodB = clamp( log2( t0 / 3000.0 ) + 1.0, 0.0, 5.0 );
    vec4 sn = textureLod( uNoise, vec3( bxz.x / 11000.0, 0.31 + uTime * 0.00015, bxz.y / 11000.0 ), lodB );
    vec4 sn2 = textureLod( uNoise, vec3( bxz.x / 3800.0, 0.67, bxz.y / 3800.0 ), lodB );
    float s = sn.r * 0.6 + sn2.r * 0.25 + sn2.g * 0.15;
    deckK = mix( 1.0, mix( 1.55, 0.5, smoothstep( 0.2, 0.8, s ) ), clamp( uFloor * 1.8, 0.0, 1.0 ) );
  }

  if ( t0 < t1 && uCoverage > 0.005 ) {
    float path = t1 - t0;
    float dsCoarse = max( path / float( uSteps ), 120.0 );
    float t = t0 + dsCoarse * jitter;
    bool fine = false;
    int empty = 0;
    for ( int i = 0; i < uMaxIter; i++ ) {
      if ( t >= t1 || T < 0.03 ) break;
      float dsFine = clamp( max( dsCoarse * 0.3, t * 0.014 ), 40.0, 520.0 );
      float ds = fine ? dsFine : dsCoarse;
      float h = hc + t * mu + t * t * ( 1.0 - mu * mu ) / ( 2.0 * R_EARTH ) - uBase;
      float h01 = h / uThick;
      vec2 xz = uCam.xz + d.xz * t + uWind;
      float wc = localCoverage( cloudField( xz ), uCoverage );
      float lod = clamp( log2( ds / 70.0 ), 0.0, 5.0 );
      vec3 p = vec3( xz.x, h + uTime * 0.6, xz.y );
      float dens = shapeDensity( p, h01, wc, lod );
      if ( dens > 0.001 ) {
        if ( !fine ) {
          // step back and walk through the cloud finely
          fine = true;
          empty = 0;
          t = max( t0, t - dsCoarse + dsFine * jitter );
          continue;
        }
        empty = 0;
        // detail erosion fades out with distance (no visible switch-over line)
        float nearK = 1.0 - smoothstep( 11000.0, 17000.0, t );
        if ( nearK > 0.0 ) dens = mix( dens, detailErode( dens, p, h01, lod ), nearK );
        if ( dens > 0.001 ) {
          float sigma = dens * uExt;
          // light march toward the sun: one tap always, a second one close by (blended in)
          float hq1 = ( h + uSunDir.y * 90.0 ) / uThick;
          float d1 = hq1 < 1.0 ? shapeDensity( p + uSunDir * 90.0, hq1, wc, lod + 1.0 ) : 0.0;
          float tauFar = d1 * 90.0 * 1.4 + d1 * ( 1.0 - clamp( h01, 0.0, 1.0 ) ) * uThick * 0.3 / max( uSunDir.y, 0.2 );
          float tau = tauFar;
          float k2 = 1.0 - smoothstep( 5000.0, 9000.0, t );
          if ( k2 > 0.0 ) {
            float hq2 = ( h + uSunDir.y * 378.0 ) / uThick;
            float d2 = hq2 < 1.0 ? shapeDensity( p + uSunDir * 378.0, hq2, wc, lod + 1.0 ) : 0.0;
            tau = mix( tauFar, d1 * 90.0 * 1.4 + d2 * 288.0 * 1.8, k2 );
          }
          tau *= uExt * 0.6;
          // a closed deck: the rest of the layer above also stands between this point and the sun
          float hc01 = clamp( h01, 0.0, 1.0 );
          tau += uFloor * ( 1.0 - hc01 ) * uThick / max( uSunDir.y, 0.15 ) * uExt * 0.45;
          // Beer + two multiple-scattering octaves (softer, wider, less extinguished)
          // multiple scattering needs some depth to build up (powder): thin edges are lit by
          // single scattering (bright silver toward the sun), cores glow softly, flat-lit
          float powder = 1.0 - exp( -dens * 12.0 );
          vec3 sun = uSunCol * ( phase * exp( -tau ) + ( phase2 * 0.55 * exp( -tau * 0.25 ) + phase3 * 0.3 * exp( -tau * 0.08 ) ) * powder );
          // dark crevices near the tops, bright rims (in-scatter probability)
          float inscatter = 0.3 + 0.7 * pow( dens, clamp( remap( hc01, 0.3, 0.85, 0.5, 1.4 ), 0.5, 1.4 ) );
          // ambient: sky from above, occluded by the cloud over this point; dim bounce from below
          float up = shapeDensity( p + vec3( 0.0, 260.0, 0.0 ), h01 + 260.0 / uThick, wc, lod + 1.0 );
          float occ = exp( -up * 150.0 * uExt );
          vec3 amb = mix( uAmbBase, uAmbTop * mix( 0.3, 1.0, occ ), pow( hc01, 0.6 ) );
          if ( uFloor > 0.0 ) {
            // closed deck: light filtered down through it; lower-hanging lumps are darker
            float lumpShade = mix( 0.62, 1.2, smoothstep( 0.0, 0.2, hc01 ) );
            amb = mix( amb, uAmbBase * deckK * lumpShade, clamp( uFloor * 1.8, 0.0, 1.0 ) );
          } else {
            amb *= mix( 1.0, mix( 0.35, 1.0, occ ) * ( 1.15 - 0.5 * wc ), uDark );
          }
          vec3 S = sigma * ( sun * inscatter + amb );
          float Ts = exp( -sigma * ds );
          C += T * ( S - S * Ts ) / max( sigma, 1e-7 );
          float a = T * ( 1.0 - Ts );
          tw += a * t;
          wsum += a;
          T *= Ts;
        }
      } else if ( fine ) {
        empty++;
        if ( empty > 4 ) fine = false;
      }
      t += ds;
    }
  }

  // aerial perspective: distant cloud fades into the sky behind it
  float tMean = wsum > 1e-4 ? tw / wsum : T_MAX;
  float fogA = max( 1.0 - exp( -tMean / uHaze ), smoothstep( T_MAX * 0.55, T_MAX, tMean ) );
  C *= 1.0 - fogA;
  T = T + ( 1.0 - T ) * fogA;

  // cirrus (8 km), behind the cumulus
  if ( uCirrus > 0.002 && mu > 0.0 ) {
    float tc = shellT( r0, mu, R_EARTH + 8000.0 );
    vec2 xz = uCam.xz + d.xz * tc + uWind * 2.2;
    vec2 w = normalize( vec2( 0.85, 0.35 ) );
    vec2 q = vec2( dot( xz, w ), dot( xz, vec2( -w.y, w.x ) ) );
    float lodc = clamp( log2( tc / 9000.0 ) + 1.0, 0.0, 5.0 );
    vec4 n = textureLod( uNoise, vec3( q.x / 60000.0, 0.41, q.y / 14000.0 ), lodc );
    vec4 n2 = textureLod( uNoise, vec3( q.x / 16000.0, 0.73, q.y / 5000.0 ), lodc );
    float streak = n.r * 0.6 + n2.b * 0.4;
    float patchK = smoothstep( 0.35, 0.75, cloudField( xz * 0.3 + 4000.0 ) );
    float a = smoothstep( 0.42, 0.85, streak ) * uCirrus * patchK;
    a *= smoothstep( 0.0, 0.08, mu );
    float fogC = 1.0 - exp( -tc / ( uHaze * 1.4 ) );
    a *= 1.0 - fogC;
    vec3 cc = uCirrusCol * ( 0.6 + 2.5 * hg( cosT, 0.6 ) );
    C += T * cc * a * 0.9;
    T *= 1.0 - a * 0.9;
  }

  // rain shafts hanging below a wet deck toward the horizon
  if ( uRain > 0.02 && mu < 0.12 ) {
    float acc = 0.0;
    for ( int k = 0; k < 6; k++ ) {
      float tk = 2500.0 * pow( 1.75, float( k ) ) * ( 0.8 + 0.4 * jitter );
      float hk = hc + tk * mu;
      if ( hk > uBase ) break;
      vec2 xz = uCam.xz + d.xz * tk + uWind * 0.7;
      float f = cloudField( xz * 2.3 + 900.0 );
      float s = cf_noise( vec2( az * 180.0 / PI * 0.9 + float( k ) * 13.1, hk * 0.0006 ) );
      acc += smoothstep( 0.45, 0.8, f ) * ( 0.55 + 0.45 * s ) * 0.28;
    }
    float a = clamp( acc * uRain, 0.0, 0.85 ) * ( 1.0 - smoothstep( 0.02, 0.12, mu ) );
    C = C * ( 1.0 - a ) + uRainCol * a * T;
    T *= 1.0 - a;
  }

  vec4 cur = vec4( max( C, 0.0 ), clamp( T, 0.0, 1.0 ) );
  outColor = mix( prev, cur, uBlend );
}
`;

const QUALITY: Record<QualityLevel, { w: number; h: number; phases: 1 | 2 | 4 | 8; steps: number; iter: number }> = {
  low: { w: 1024, h: 256, phases: 8, steps: 10, iter: 18 },
  medium: { w: 1536, h: 384, phases: 8, steps: 14, iter: 24 },
  high: { w: 1792, h: 448, phases: 8, steps: 16, iter: 30 },
  ultra: { w: 2560, h: 640, phases: 4, steps: 22, iter: 44 },
};

export interface CloudPanorama {
  readonly texture: THREE.Texture;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** re-march part of the panorama for this camera position */
  update(dt: number, camPos: THREE.Vector3): void;
  /** force a full refresh on the next update (weather jump, camera cut) */
  invalidate(): void;
  setQuality(q: QualityLevel): void;
  dispose(): void;
}

export function createCloudPanorama(renderer: THREE.WebGLRenderer, noise: THREE.Texture, quality: QualityLevel): CloudPanorama {
  const uniforms: Record<string, THREE.IUniform> = {
    uNoise: { value: noise },
    uPrev: { value: null },
    uBlend: { value: 1 },
    uFrame: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uPhase: { value: 0 },
    uPhases: { value: 4 },
    uSteps: { value: 24 },
    uMaxIter: { value: 44 },
    uCam: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uCoverage: { value: 0.4 },
    uBase: { value: 1400 },
    uThick: { value: 900 },
    uExt: { value: 0.012 },
    uDark: { value: 0 },
    uFloor: { value: 0 },
    uHaze: { value: 30000 },
    uCirrus: { value: 0.3 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Vector3(10, 10, 10) },
    uAmbTop: { value: new THREE.Vector3(1, 1, 1) },
    uAmbBase: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uCirrusCol: { value: new THREE.Vector3(1, 1, 1) },
    uRain: { value: 0 },
    uRainCol: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
  };
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      in vec3 position;
      in vec2 uv;
      ${VERT}`,
    fragmentShader: FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ping-pong pair: read last frame's panorama, write this frame's (running average of jittered marches)
  const rts: THREE.WebGLRenderTarget[] = [];
  let cur = 0;
  let phases: 1 | 2 | 4 | 8 = 8;
  let frame = 0;
  let full = 2;
  let fresh = 0;
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  const alloc = (q: QualityLevel) => {
    const Q = QUALITY[q];
    phases = Q.phases;
    uniforms.uSteps.value = Q.steps;
    uniforms.uMaxIter.value = Q.iter;
    uniforms.uPhases.value = phases;
    if (rts.length && rts[0].width === Q.w && rts[0].height === Q.h) return;
    if (!rts.length) {
      for (let i = 0; i < 2; i++) {
        const rt = new THREE.WebGLRenderTarget(Q.w, Q.h, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          depthBuffer: false,
          generateMipmaps: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          wrapS: THREE.RepeatWrapping,
          wrapT: THREE.ClampToEdgeWrapping,
        });
        rt.texture.colorSpace = THREE.NoColorSpace;
        rts.push(rt);
      }
    } else {
      for (const rt of rts) rt.setSize(Q.w, Q.h);
    }
    (uniforms.uRes.value as THREE.Vector2).set(Q.w, Q.h);
    full = 2;
  };
  alloc(quality);

  const render = (target: THREE.WebGLRenderTarget, prev: THREE.WebGLRenderTarget) => {
    uniforms.uPrev.value = prev.texture;
    renderer.setRenderTarget(target);
    renderer.render(quad, cam);
  };

  return {
    get texture() {
      return rts[cur].texture;
    },
    uniforms,
    update(dt, camPos) {
      uniforms.uTime.value += dt;
      // a camera cut: don't re-march everything at once (a frame hitch) — just stop averaging
      // until every texel has been re-marched from the new position
      if (camPos.distanceToSquared(lastCam) > 150 * 150) fresh = phases;
      lastCam.copy(camPos);
      (uniforms.uCam.value as THREE.Vector3).copy(camPos);
      const prevTarget = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const prevXr = renderer.xr.enabled;
      renderer.autoClear = false;
      renderer.xr.enabled = false;
      if (full > 0 || phases === 1) {
        // everything, twice (second pass averages a second jitter in), into both buffers
        uniforms.uPhases.value = 1;
        uniforms.uBlend.value = 1;
        uniforms.uFrame.value = frame++;
        render(rts[1 - cur], rts[cur]);
        uniforms.uBlend.value = 0.5;
        uniforms.uFrame.value = frame++;
        render(rts[cur], rts[1 - cur]);
        uniforms.uPhases.value = phases;
        full = 0;
      } else {
        const order4 = [0, 3, 1, 2];
        const order8 = [0, 6, 3, 5, 1, 7, 2, 4];
        uniforms.uPhase.value = phases === 8 ? order8[frame % 8] : phases === 4 ? order4[frame % 4] : frame % 2;
        uniforms.uFrame.value = frame >> (phases === 8 ? 3 : phases === 4 ? 2 : 1);
        uniforms.uBlend.value = fresh > 0 ? 1 : 0.4;
        if (fresh > 0) fresh--;
        render(rts[1 - cur], rts[cur]);
        cur = 1 - cur;
        frame++;
      }
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
      renderer.xr.enabled = prevXr;
    },
    invalidate() {
      full = 2;
    },
    setQuality(q) {
      alloc(q);
    },
    dispose() {
      for (const rt of rts) rt.dispose();
      mat.dispose();
      quad.geometry.dispose();
    },
  };
}
