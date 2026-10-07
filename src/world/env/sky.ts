import * as THREE from 'three';

/**
 * Sky dome: physically based atmosphere LUT (clear sky), blended toward a grey
 * overcast gradient as the cloud deck closes, with the ray-marched cloud
 * panorama (see skyClouds.ts) composited over it, plus the sun disc/aureole,
 * lightning (a flash lighting the deck from inside, and a bolt), a rainbow
 * opposite the sun in a sun shower, and at night the moon, stars, the city's
 * glow on the horizon and the circuit's floodlights lighting the haze. In mist, fog and rain the
 * low sky is veiled by the same air (and colour) as the land (`uFogCol`, `uFogK`).
 *
 * The dome is a unit sphere that follows the camera and is written at the far
 * plane (gl_Position.z = w), so it works with any camera near/far. A second
 * material instance with `uEnv = 1` (no sun disc, ground below the horizon) is
 * rendered into the cube map the PMREM environment is filtered from.
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
uniform sampler2D uMieLut;
uniform float uMieG;
uniform float uMieK;
uniform float uSkyScale;
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform float uSunRadius;
uniform float uTime;
uniform sampler2D uPano;
uniform float uOvercast;
uniform vec3 uOvZenith;
uniform vec3 uOvHorizon;
uniform vec3 uGround;
uniform float uEnv;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform vec3 uFlashCol;
uniform float uBolt;
uniform float uBoltSeed;
uniform float uBoltTop;
uniform float uHalo;
uniform float uSkyComp;
uniform float uNight;
uniform float uStars;
uniform vec3 uCity;
uniform vec3 uFloodGlow;
uniform float uBow;
uniform vec3 uBowCol;
uniform float uBowEl;
uniform float uMilk;
uniform float uViewMilk;
uniform vec3 uMilkCol;
uniform vec3 uViewMilkCol;
uniform vec3 uFogCol;
uniform vec2 uFogK;
// the fog layer's glow round the sun (fog.ts aerialFogSun), so the murk and the sky meet in one glare
uniform vec3 uFogSun;

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
  // the Mie forward peak with the true sun angle (see atmosphere.ts: a baked peak smeared into a cone)
  float c = dot( d, uSunDir );
  float g2 = uMieG * uMieG;
  float pm = 0.1193662 * ( 1.0 - g2 ) * ( 1.0 + c * c ) / ( ( 2.0 + g2 ) * pow( max( 1.0 + g2 - 2.0 * uMieG * c, 1e-4 ), 1.5 ) );
  return ( texture2D( uLut, vec2( u, v ) ).rgb + texture2D( uMieLut, vec2( u, v ) ).rgb * pm * uMieK ) * uSkyScale;
}

vec3 skyBg( vec3 d ) {
  vec3 c = skyLut( d );
  if ( uOvercast > 0.001 ) {
    float k = pow( 1.0 - max( d.y, 0.0 ), 3.0 );
    c = mix( c, mix( uOvZenith, uOvHorizon, k ), uOvercast );
  }
  // haze: a milky, bleached sky, whitest toward the horizon
  float h = 1.0 - max( d.y, 0.0 );
  if ( uMilk > 0.001 ) c = mix( c, uMilkCol, uMilk * ( 0.3 + 0.7 * pow( h, 3.0 ) ) );
  // a sunny day's sky as a camera sees it (the visible dome only): the deep blue of the clear-air model
  // is only straight up — from ~40° down it pales through a soft, slightly milky blue to near white at
  // the horizon (aerosol in the boundary layer, which the single-layer model under-does)
  if ( uEnv < 0.5 && uViewMilk > 0.001 ) c = mix( c, uViewMilkCol, uViewMilk * ( 0.12 + 0.88 * pow( h, 2.5 ) ) );
  return c;
}

uniform vec2 uPanoSize;
// Catmull-Rom (5 bilinear taps): crisper cloud edges than plain bilinear magnification
vec4 panoCubic( vec2 uv ) {
  vec2 sp = uv * uPanoSize;
  vec2 tp = floor( sp - 0.5 ) + 0.5;
  vec2 f = sp - tp;
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
  vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
  vec2 w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2;
  vec2 tc0 = ( tp - 1.0 ) / uPanoSize;
  vec2 tc3 = ( tp + 2.0 ) / uPanoSize;
  vec2 tc12 = ( tp + w2 / w12 ) / uPanoSize;
  vec4 r = texture2D( uPano, vec2( tc12.x, tc0.y ) ) * ( w12.x * w0.y )
         + texture2D( uPano, vec2( tc0.x, tc12.y ) ) * ( w0.x * w12.y )
         + texture2D( uPano, vec2( tc12.x, tc12.y ) ) * ( w12.x * w12.y )
         + texture2D( uPano, vec2( tc3.x, tc12.y ) ) * ( w3.x * w12.y )
         + texture2D( uPano, vec2( tc12.x, tc3.y ) ) * ( w12.x * w3.y );
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max( r / wsum, 0.0 );
}

vec4 pano( vec3 d ) {
  float el = asin( clamp( d.y, 0.0, 1.0 ) );
  float u = atan( d.z, d.x ) * ( 0.5 / PI );
  float v = sqrt( el / ( PI * 0.5 ) );
  vec2 uv = vec2( fract( u ), v );
  if ( uEnv > 0.5 ) return texture2D( uPano, uv );
  vec4 c = panoCubic( uv );
  c.a = min( c.a, 1.0 );
  return c;
}

float hash11( float p ) {
  p = fract( p * 0.1031 );
  p *= p + 33.33;
  p *= p + p;
  return fract( p );
}
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float hash13( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float vnoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}

// stars: one candidate per cell of a fine grid over the sphere; denser along the Milky Way
vec3 stars( vec3 d ) {
  vec3 sp = d * 300.0;
  vec3 si = floor( sp );
  vec3 sf = fract( sp ) - 0.5;
  float h = hash13( si );
  float band = exp( -pow( dot( d, normalize( vec3( 0.35, 0.55, -0.76 ) ) ), 2.0 ) * 18.0 );
  float thr = 0.985 - 0.02 * band;
  if ( h < thr ) return vec3( 0.0 );
  vec3 o = vec3( hash13( si + 7.1 ), hash13( si + 3.3 ), hash13( si + 9.7 ) ) - 0.5;
  vec3 q = sf - o * 0.6;
  float r2 = dot( q, q );
  float mag = pow( ( h - thr ) / ( 1.0 - thr ), 3.0 );
  float tw = 0.75 + 0.25 * sin( uTime * ( 2.0 + 6.0 * hash13( si + 1.9 ) ) + h * 60.0 );
  // temperature: most stars white, some blue, some orange
  float tc = hash13( si + 5.5 );
  vec3 tint = tc < 0.2 ? vec3( 1.0, 0.8, 0.6 ) : tc > 0.8 ? vec3( 0.75, 0.85, 1.0 ) : vec3( 1.0 );
  return tint * ( exp( -r2 * 60.0 ) * ( 0.25 + 4.0 * mag ) * tw );
}

// a rainbow opposite the sun: the primary bow at 42°, the fainter reversed secondary at 51°,
// Alexander's dark band between them and the brighter sky inside the primary
vec3 spectral( float t ) {
  // t 0 = violet … 1 = red
  vec3 c = vec3(
    smoothstep( 0.45, 0.85, t ) + 0.35 * smoothstep( 0.25, 0.0, t ),
    smoothstep( 0.2, 0.5, t ) * smoothstep( 0.95, 0.6, t ),
    smoothstep( 0.55, 0.15, t ) );
  return c * smoothstep( 0.0, 0.08, t ) * smoothstep( 1.0, 0.9, t );
}
vec3 rainbow( vec3 d, out float dark ) {
  vec3 a = normalize( vec3( -uSunDir.x, 0.0, -uSunDir.z ) );
  a = normalize( a * cos( uBowEl ) + vec3( 0.0, sin( uBowEl ), 0.0 ) );
  float th = acos( clamp( dot( d, a ), -1.0, 1.0 ) ) * 57.2958;
  vec3 c = spectral( ( th - 40.4 ) / 2.2 ) * 1.0 + spectral( 1.0 - ( th - 50.0 ) / 3.4 ) * 0.38;
  dark = smoothstep( 41.5, 43.0, th ) * smoothstep( 51.0, 49.5, th );
  // the sky inside the bow is lit up a touch
  c += vec3( 0.05 ) * smoothstep( 41.0, 36.0, th ) * smoothstep( 20.0, 34.0, th );
  return c;
}

// jagged noise for the bolt: straight segments between random kinks (a real channel is a chain of
// short straight steps, not a smooth wave), a few octaves of them
float jag( float x, float s ) {
  float i = floor( x );
  return mix( hash11( i + s ), hash11( i + 1.0 + s ), x - i ) * 2.0 - 1.0;
}
float jag3( float y, float s ) {
  return jag( y * 6.0, s ) * 0.55 + jag( y * 17.0, s + 13.0 ) * 0.28 + jag( y * 47.0, s + 29.0 ) * 0.14;
}
// one filament: a crisp white core a pixel or two wide whatever the resolution, a tight violet glow,
// and a wide soft one around the channel's general line (wb: distance to a smoothed path, so the
// haze doesn't pick up the kinks as streaks)
vec3 filament( float w, float wb, float px, float k ) {
  float core = 1.0 - smoothstep( px * 0.6, px * 1.8 + 0.0004 * k, w );
  float glow = exp( -w / ( 0.004 + px ) ) * 0.28 + exp( -wb * wb / 6e-4 ) * 0.07;
  return vec3( 1.0, 0.98, 1.0 ) * core * 1.6 + vec3( 0.62, 0.7, 1.25 ) * glow;
}
// lightning bolt: a jagged channel at the flash azimuth from the cloud base to the ground, with a
// branching tree of forks off it, and the bright spot where it leaves the cloud
vec3 bolt( vec3 d ) {
  vec2 fd = normalize( uFlashDir.xz );
  vec2 dh = normalize( d.xz );
  float az = atan( dh.x * fd.y - dh.y * fd.x, dot( dh, fd ) );
  if ( abs( az ) > 0.35 ) return vec3( 0.0 );
  float el = asin( clamp( d.y, -1.0, 1.0 ) );
  if ( el < -0.002 || el > uBoltTop * 1.08 ) return vec3( 0.0 );
  float px = max( fwidth( az ), 1e-5 );
  float y = el / uBoltTop;   // 0 ground … 1 cloud base
  float sc = uBoltTop * 1.2; // sideways wander scales with how tall the bolt looks
  float x = jag3( y, uBoltSeed ) * 0.09 * sc;
  float xs = jag( y * 6.0, uBoltSeed ) * 0.55 * 0.09 * sc;
  vec3 c = filament( abs( az - x ), abs( az - xs ), px, 1.0 ) * ( 1.0 - smoothstep( 0.97, 1.0, y ) );
  // forks: each leaves the channel at its own height and heads down and out, thinning and fading
  for ( int i = 0; i < 5; i ++ ) {
    float fi = float( i );
    float h0 = mix( 0.35, 0.95, hash11( uBoltSeed * 1.7 + fi * 3.1 ) );
    if ( y > h0 + 0.01 || y < h0 - 0.5 ) continue;
    float t = max( h0 - y, 0.0 ) / 0.5;   // 0 at the fork … 1 at its tip
    float side = hash11( uBoltSeed + fi * 7.3 ) < 0.5 ? -1.0 : 1.0;
    float spread = ( 0.25 + 0.35 * hash11( uBoltSeed * 2.3 + fi ) ) * sc;
    float x0 = jag3( h0, uBoltSeed ) * 0.09 * sc;
    float bx = x0 + side * spread * t * ( 1.0 - 0.3 * t ) + jag3( y * 1.3, uBoltSeed + 40.0 + fi * 11.0 ) * 0.03 * sc;
    // (eased in at the fork and out at the tip, so no glow band starts or stops on a hard line)
    float fade = smoothstep( 0.0, 0.08, t ) * ( 1.0 - smoothstep( 0.35, 1.0, t ) ) * ( 0.75 - 0.1 * fi );
    float bxs = x0 + side * spread * t * ( 1.0 - 0.3 * t );
    c += filament( abs( az - bx ), abs( az - bxs ), px, 0.4 ) * fade;
  }
  // where the channel leaves the cloud: a bright, soft splash along the base
  vec2 q = vec2( ( az - jag3( 1.0, uBoltSeed ) * 0.09 * sc ) * 6.0, ( y - 1.0 ) * 9.0 );
  c += vec3( 0.75, 0.8, 1.2 ) * exp( -dot( q, q ) * 4.0 ) * 0.9;
  // (a soft window: nothing may end on the edge of the region this is evaluated in)
  return c * smoothstep( -0.02, 0.02, y ) * ( 1.0 - smoothstep( 1.02, 1.08, y ) ) * ( 1.0 - smoothstep( 0.2, 0.34, abs( az ) ) );
}

void main() {
  vec3 d = normalize( vDir );
  float sy = d.y;
  vec3 dUp = normalize( vec3( d.x, max( sy, 0.0015 ), d.z ) );
  vec3 col = skyBg( dUp );

  // sun disc + aureole (main view only; the direct light carries it in reflections)
  if ( uEnv < 0.5 && sy > -0.02 ) {
    float cs = dot( d, uSunDir );
    float ang = sqrt( max( 0.0, 2.0 * ( 1.0 - cs ) ) );
    float disc = 1.0 - smoothstep( uSunRadius * 0.9, uSunRadius * 1.05, ang );
    float r = clamp( ang / uSunRadius, 0.0, 1.0 );
    float limb = 0.4 + 0.6 * sqrt( max( 0.0, 1.0 - r * r ) );
    if ( uNight > 0.5 && disc > 0.0 ) {
      // the moon: flat-lit, with its grey seas
      vec3 t1 = normalize( cross( uSunDir, vec3( 0.0, 1.0, 0.0 ) ) );
      vec3 t2 = cross( t1, uSunDir );
      vec2 mp = vec2( dot( d, t1 ), dot( d, t2 ) ) / uSunRadius;
      float maria = vnoise2( mp * 2.2 + 3.0 ) * 0.6 + vnoise2( mp * 5.0 + 11.0 ) * 0.4;
      limb = 0.95 - 0.4 * smoothstep( 0.45, 0.7, maria ) - 0.1 * r * r;
    }
    col += uSunDisc * disc * limb;
    // aureole: the forward-scattering glow of haze around the sun (the LUT is too coarse for it)
    col += uSunDisc * uHalo * ( 0.012 * exp( -ang * 38.0 ) + 0.0035 * exp( -ang * 9.0 ) );
  }

  // the night sky behind the clouds: stars (main view only)
  if ( uStars > 0.001 && uEnv < 0.5 && sy > 0.0 ) {
    col += stars( d ) * uStars * smoothstep( 0.0, 0.12, sy );
  }

  vec4 cl = pano( dUp );
  col = col * cl.a + cl.rgb;

  // the sky seen through the mist: the same air that veils the land veils the low sky (and the clouds
  // in it), so the far hills and the horizon fade into one colour instead of a fogged band of land
  // under a clear-sky horizon (x = how much at the horizon, y = how fast it thins upward)
  if ( uFogK.x > 0.001 ) {
    // (the same droplet phase function as fog.ts aerialFogLobe)
    float fmu = max( dot( d, uSunDir ), 0.0 );
    float fm2 = fmu * fmu;
    vec3 fogC = uFogCol + uFogSun * ( fm2 * 0.3 + fm2 * fm2 * fm2 * 0.55 + pow( fmu, 48.0 ) * 1.5 );
    col = mix( col, fogC, uFogK.x * exp( -max( sy, 0.0 ) * uFogK.y ) );
  }

  // light in the low air: the city's sodium glow, and the circuit's own floodlights lighting the haze
  if ( uNight > 0.001 ) {
    float el = max( sy, 0.0 );
    float cityAz = 0.5 + 0.5 * dot( normalize( d.xz + vec2( 1e-4 ) ), normalize( vec2( -0.6, -0.8 ) ) );
    col += uCity * ( exp( -el * 9.0 ) * ( 0.35 + 0.65 * cityAz * cityAz ) + 0.08 * exp( -el * 2.0 ) );
    col += uFloodGlow * ( exp( -el * 5.0 ) + 0.25 * exp( -el * 1.5 ) );
  }
  if ( uBow > 0.001 && uEnv < 0.5 && sy > -0.01 ) {
    float dark;
    vec3 bow = rainbow( d, dark );
    col *= 1.0 - 0.12 * dark * uBow;
    col += uBowCol * bow * uBow * smoothstep( -0.01, 0.03, sy );
  }
  // the visible sky is held back a little on dim days (a graduated filter), the env map is not
  if ( uEnv < 0.5 ) col *= uSkyComp;

  if ( uFlash > 0.001 ) {
    // the whole deck lights up from inside, brightest round the strike: the cloud's own density
    // shows its shape (thick cells glow, thin gaps stay darker), and the clear sky above catches it too
    float fd = max( dot( dUp, uFlashDir ), 0.0 );
    float lobe = pow( fd, 16.0 ) * 1.1 + 0.45 * pow( fd, 4.0 ) + 0.35 * fd * fd;
    float dens = 1.0 - cl.a;
    float lit = ( 0.2 + 0.8 * dens ) * ( 0.55 + lobe ) * smoothstep( -0.05, 0.08, sy );
    col += uFlashCol * uFlash * lit;
    if ( uBolt > 0.001 && uEnv < 0.5 ) col += uFlashCol * uBolt * bolt( d ) * 10.0;
  }

  if ( sy < 0.0 && uEnv > 0.5 ) {
    col = mix( col, uGround, smoothstep( 0.0, -0.1, sy ) );
  }

  // dither (kills banding after tone mapping)
  col *= 1.0 + ( hash12( gl_FragCoord.xy + fract( uTime ) * 17.0 ) - 0.5 ) * 0.01;
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
    uMieLut: { value: null },
    uMieG: { value: 0.8 },
    /** strength of the visible Mie glow round the sun (1 = the physical single scattering) */
    uMieK: { value: 1 },
    uSkyScale: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDisc: { value: new THREE.Vector3(40, 30, 20) },
    uSunRadius: { value: 0.0095 },
    uTime: { value: 0 },
    uPano: { value: null },
    uPanoSize: { value: new THREE.Vector2(1792, 448) },
    uOvercast: { value: 0 },
    uOvZenith: { value: new THREE.Vector3(0.3, 0.3, 0.32) },
    uOvHorizon: { value: new THREE.Vector3(0.4, 0.4, 0.42) },
    uGround: { value: new THREE.Vector3(0.05, 0.05, 0.04) },
    uEnv: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(1, 0.2, 0).normalize() },
    uFlashCol: { value: new THREE.Vector3(0.8, 0.85, 1.0) },
    uBolt: { value: 0 },
    uBoltSeed: { value: 1 },
    uBoltTop: { value: 0.12 },
    uHalo: { value: 1 },
    uSkyComp: { value: 1 },
    uNight: { value: 0 },
    uStars: { value: 0 },
    uCity: { value: new THREE.Vector3() },
    uFloodGlow: { value: new THREE.Vector3() },
    uBow: { value: 0 },
    uBowCol: { value: new THREE.Vector3(1, 1, 1) },
    uBowEl: { value: -0.4 },
    uMilk: { value: 0 },
    /** extra milk on the visible dome only (a sunny day's pale horizon), not in the env map */
    uViewMilk: { value: 0 },
    uMilkCol: { value: new THREE.Vector3(1, 1, 1) },
    uViewMilkCol: { value: new THREE.Vector3(1, 1, 1) },
    uFogCol: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uFogK: { value: new THREE.Vector2(0, 8) },
    uFogSun: { value: new THREE.Vector3(0, 0, 0) },
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
    depthTest: false,
    fog: false,
  });
  const envMesh = new THREE.Mesh(geo, envMat);
  envMesh.frustumCulled = false;
  return { mesh, envMesh, uniforms };
}
