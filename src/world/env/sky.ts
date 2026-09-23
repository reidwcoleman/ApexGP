import * as THREE from 'three';
import { noiseTexture } from './textures.ts';

/**
 * Sky dome: atmosphere LUT + sun disc + two procedural cloud layers
 * (cumulus deck with self-shadowing, and high streaky cirrus), slowly drifting.
 *
 * The dome is a unit sphere that follows the camera and is written at the far
 * plane (gl_Position.z = w), so it works with any camera near/far. A second
 * material instance with `uEnv = 1` (no sun disc, ground below the horizon) is
 * used to render the PMREM environment map.
 */

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform sampler2D uLut;
uniform float uSkyScale;
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform float uSunRadius;
uniform float uTime;
uniform sampler2D uNoise;
uniform vec4 uCloud;      // x coverage overhead, y coverage toward horizon, z cirrus, w opacity
uniform vec3 uCloudSun;   // radiance of a sunlit cloud facing the sun
uniform vec3 uCloudAmb;   // ambient radiance on clouds
uniform vec3 uCloudDark;  // darkest cloud base (overcast)
uniform vec3 uGround;     // env mode: ground radiance
uniform float uEnv;
uniform vec2 uWind;

#define PI 3.141592653589793

vec3 skyLut( vec3 d ) {
  float el = asin( clamp( d.y, -1.0, 1.0 ) );
  vec2 dh = d.xz;
  float lh = length( dh );
  vec2 sh = normalize( uSunDir.xz + vec2( 1e-5 ) );
  float cphi = lh > 1e-4 ? dot( dh / lh, sh ) : 1.0;
  float u = acos( clamp( cphi, -1.0, 1.0 ) ) / PI;
  float e = sqrt( min( 1.0, abs( el ) / ( PI * 0.5 ) ) );
  float v = el >= 0.0 ? 0.5 + 0.5 * e : 0.5 - 0.5 * e;
  return texture2D( uLut, vec2( u, v ) ).rgb * uSkyScale;
}

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// distance (km) to a spherical shell at altitude H (km) above a 6360 km planet
float shellDist( float sy, float H ) {
  float R = 6360.0;
  return -R * sy + sqrt( R * R * sy * sy + 2.0 * R * H + H * H );
}

float cumulusNoise( vec2 p ) {
  float n = texture2D( uNoise, p * 0.045 ).r * 0.55
          + texture2D( uNoise, p * 0.13 + vec2( 0.31, 0.72 ) ).g * 0.28
          + texture2D( uNoise, p * 0.41 + vec2( 0.12, 0.43 ) ).b * 0.17;
  float billow = texture2D( uNoise, p * 0.09 + vec2( 0.5, 0.2 ) ).a;
  return n * 0.8 + billow * 0.2;
}
float cumulusDensity( vec2 p, float cov ) {
  return smoothstep( 1.0 - cov, 1.0 - cov + 0.22, cumulusNoise( p ) );
}

void main() {
  vec3 d = normalize( vDir );
  float sy = d.y;
  vec3 dUp = normalize( vec3( d.x, max( sy, 0.0015 ), d.z ) );
  vec3 col = skyLut( dUp );
  vec3 horizon = col;

  float cs = dot( d, uSunDir );

  // ---------------- sun disc (main view only)
  if ( uEnv < 0.5 && sy > -0.02 ) {
    float ang = sqrt( max( 0.0, 2.0 * ( 1.0 - cs ) ) );
    float disc = 1.0 - smoothstep( uSunRadius * 0.92, uSunRadius * 1.04, ang );
    float r = clamp( ang / uSunRadius, 0.0, 1.0 );
    float limb = 0.45 + 0.55 * sqrt( max( 0.0, 1.0 - r * r ) );
    col += uSunDisc * disc * limb;
    // tight aureole the bloom can grab
    col += uSunDisc * 0.0025 * exp( - ang * 60.0 );
  }

  // ---------------- clouds
  if ( sy > 0.0 ) {
    float horizonFade = smoothstep( 0.0, 0.035, sy );
    // cirrus (8 km)
    if ( uCloud.z > 0.001 ) {
      float t = shellDist( sy, 8.0 );
      vec2 p = d.xz / max( length( d.xz ), 1e-4 ) * sqrt( max( 0.0, t * t - 64.0 ) ) + uWind * uTime * 0.6;
      vec2 w = normalize( vec2( 0.8, 0.35 ) );
      vec2 q = vec2( dot( p, w ), dot( p, vec2( -w.y, w.x ) ) * 3.5 );
      float n = texture2D( uNoise, q * 0.006 ).a * texture2D( uNoise, q * 0.017 + vec2( 0.2, 0.6 ) ).g;
      n += texture2D( uNoise, p * 0.02 ).r * 0.25;
      // patchy: cirrus only in some regions of the sky
      float patchK = smoothstep( 0.45, 0.7, texture2D( uNoise, p * 0.0023 + vec2( 0.61, 0.17 ) ).r );
      float a = smoothstep( 0.32, 0.75, n ) * uCloud.z * horizonFade * patchK;
      float ph = 0.35 + 1.6 * pow( max( cs, 0.0 ), 8.0 );
      vec3 cc = uCloudAmb * 1.1 + uCloudSun * 0.55 * ph;
      cc = mix( cc, horizon, 1.0 - exp( - t / 120.0 ) );
      col = mix( col, cc, a * 0.85 );
    }
    // cumulus (1.6 km)
    if ( uCloud.w > 0.001 ) {
      float t = shellDist( sy, 1.6 );
      vec2 dir2 = d.xz / max( length( d.xz ), 1e-4 );
      vec2 p = dir2 * sqrt( max( 0.0, t * t - 2.56 ) ) + uWind * uTime;
      float cov = mix( uCloud.x, uCloud.y, smoothstep( 4.0, 45.0, t ) );
      float nRaw = cumulusNoise( p );
      float dens = smoothstep( 1.0 - cov, 1.0 - cov + 0.22, nRaw );
      if ( dens > 0.002 ) {
        // light march toward the sun through the deck (2 taps)
        vec2 sd = normalize( uSunDir.xz + vec2( 1e-4 ) );
        float s1 = cumulusDensity( p + sd * 0.35, cov );
        float s2 = cumulusDensity( p + sd * 0.9, cov );
        float shade = exp( - ( s1 * 1.4 + s2 * 0.9 ) * ( 1.2 - uSunDir.y ) );
        float powder = 1.0 - exp( - dens * 3.0 );
        float ph = 0.55 + 2.2 * pow( max( cs, 0.0 ), 6.0 ) + 0.25 * pow( max( -cs, 0.0 ), 2.0 );
        vec3 lit = uCloudSun * shade * ph * mix( 0.6, 1.0, powder );
        // thick parts darker; in a full overcast the raw noise still shapes the deck
        float thick = smoothstep( 1.0 - cov, 1.0, nRaw );
        vec3 amb = mix( uCloudDark, uCloudAmb, clamp( 0.35 + 0.65 * ( 1.0 - dens ) + 0.55 * ( 1.0 - thick ) - 0.15, 0.0, 1.0 ) );
        vec3 cc = amb + lit;
        // aerial perspective on distant clouds
        cc = mix( cc, horizon, 1.0 - exp( - t / 160.0 ) );
        float a = clamp( dens * 1.25, 0.0, 1.0 ) * uCloud.w * horizonFade;
        col = mix( col, cc, a );
      }
    }
  }

  // ---------------- below the horizon
  if ( sy < 0.0 ) {
    if ( uEnv > 0.5 ) {
      float k = smoothstep( 0.0, -0.12, sy );
      col = mix( horizon, uGround, k );
    } else {
      col = horizon;
    }
  }

  // dither (kills banding after tone mapping)
  col *= 1.0 + ( hash12( gl_FragCoord.xy + fract( uTime ) * 17.0 ) - 0.5 ) * 0.012;
  gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
}
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  envMesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
}

export function createSkyDome(): SkyDome {
  const uniforms: Record<string, THREE.IUniform> = {
    uLut: { value: null },
    uSkyScale: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDisc: { value: new THREE.Vector3(40, 30, 20) },
    uSunRadius: { value: 0.0095 },
    uTime: { value: 0 },
    uNoise: { value: noiseTexture() },
    uCloud: { value: new THREE.Vector4(0.2, 0.5, 0.4, 1) },
    uCloudSun: { value: new THREE.Vector3(1, 1, 1) },
    uCloudAmb: { value: new THREE.Vector3(0.2, 0.25, 0.3) },
    uCloudDark: { value: new THREE.Vector3(0.1, 0.1, 0.12) },
    uGround: { value: new THREE.Vector3(0.05, 0.05, 0.04) },
    uEnv: { value: 0 },
    uWind: { value: new THREE.Vector2(0.012, 0.004) },
  };
  const geo = new THREE.SphereGeometry(1, 96, 48);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.name = 'SkyDome';

  const envMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uEnv: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const envMesh = new THREE.Mesh(geo, envMat);
  envMesh.frustumCulled = false;
  return { mesh, envMesh, uniforms };
}
