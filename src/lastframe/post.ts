import * as THREE from 'three';
import { LF } from './lighting.ts';
import { AIR } from './fx.ts';

/**
 * The camera on the vest: a wide cheap lens on a small sensor.
 *
 * The scene is drawn once, with a sub-pixel jitter. Three small layers come from its depth: occlusion at
 * half size (the corners the bake is too coarse for, and the ground under a person's feet), the air at
 * quarter size (a short march through the light volume, so fog lights up round a lamp and the flashlight
 * has a beam) and smoke, dust and rain at half size. One resolve puts those on the picture and blends it
 * with the last frames, which is the anti-aliasing. Then shutter blur, bloom, slow auto exposure, and a
 * composite that bends it through a fisheye, fringes the edges, grades it hard, and adds what a recording
 * does: sharpening, grain, compression, and in the rain, water on the lens.
 */

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const DEPTH = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 nf;
uniform vec2 pInv;
float lin( float d ) { return nf.x * nf.y / ( nf.y - d * ( nf.y - nf.x ) ); }
vec3 viewAt( vec2 uv ) {
  float z = lin( texture2D( tDepth, uv ).r );
  return vec3( ( uv * 2.0 - 1.0 ) * pInv * z, -z );
}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
`;

/** ambient occlusion in the depth, and the soft dark under each body, which is no part of any bake */
const AO_MAX = 14;
const AO = /* glsl */ `
varying vec2 vUv;
${DEPTH}
uniform vec2 px;
uniform float frame;
uniform mat4 camW;
uniform vec4 capA[${AO_MAX}];
uniform vec4 capB[${AO_MAX}];
uniform int capN;
void main() {
  float d0 = texture2D( tDepth, vUv ).r;
  vec3 P = viewAt( vUv );
  float z = -P.z;
  if ( d0 >= 1.0 || z < 0.85 ) { gl_FragColor = vec4( 1.0 ); return; }
  vec3 l = viewAt( vUv - vec2( px.x, 0.0 ) ), r = viewAt( vUv + vec2( px.x, 0.0 ) ), b = viewAt( vUv - vec2( 0.0, px.y ) ), t = viewAt( vUv + vec2( 0.0, px.y ) );
  vec3 dx = abs( l.z - P.z ) < abs( r.z - P.z ) ? P - l : r - P;
  vec3 dy = abs( b.z - P.z ) < abs( t.z - P.z ) ? P - b : t - P;
  vec3 N = normalize( cross( dx, dy ) );
  float R = 0.62;
  float rad = min( 0.12, R / ( z * pInv.y * 2.0 ) );
  float n = ign( gl_FragCoord.xy + frame * 5.588238 ) * 6.2832;
  float occ = 0.0;
  for ( int i = 0; i < 8; i++ ) {
    float fi = ( float( i ) + 0.5 ) / 8.0;
    float a = n + fi * 15.5;
    vec2 o = vec2( cos( a ), sin( a ) ) * rad * sqrt( fi );
    o.x *= pInv.y / pInv.x;
    vec3 v = viewAt( vUv + o ) - P;
    float d2 = dot( v, v );
    float w = 1.0 - smoothstep( 0.2 * R * R, R * R * 1.4, d2 );
    occ += max( 0.0, dot( N, v ) * inversesqrt( d2 + 1e-4 ) - 0.1 ) * w;
  }
  float ao = 1.0 - clamp( occ / 8.0 * 2.5, 0.0, 0.85 );
  // bodies
  vec3 W = ( camW * vec4( P, 1.0 ) ).xyz;
  vec3 Nw = normalize( mat3( camW ) * N );
  for ( int i = 0; i < ${AO_MAX}; i++ ) {
    if ( i >= capN ) break;
    vec3 A = capA[i].xyz, B = capB[i].xyz;
    float rr = capA[i].w;
    vec3 ab = B - A;
    float h = clamp( dot( W - A, ab ) / dot( ab, ab ), 0.0, 1.0 );
    vec3 q = W - ( A + ab * h );
    float dist = length( q );
    if ( dist < 0.02 + rr * 0.8 && Nw.y < 0.5 ) continue;
    float o = clamp( ( rr * rr * 2.0 ) / ( dist * dist + 1e-3 ), 0.0, 1.0 ) * ( 0.55 - 0.45 * dot( Nw, q / ( dist + 1e-4 ) ) );
    // from above: the patch of ground it keeps the lamp off
    float flat2 = length( ( W - A ).xz );
    float up = clamp( Nw.y, 0.0, 1.0 ) * smoothstep( rr * 3.8, rr * 0.7, flat2 ) * smoothstep( 1.3, 0.0, abs( W.y - A.y ) );
    ao *= 1.0 - clamp( max( o * 0.75, up * 0.72 ), 0.0, 0.85 );
  }
  gl_FragColor = vec4( ao, ao, ao, 1.0 );
}
`;

/** a small blur that stops at edges */
const AOBLUR = /* glsl */ `
varying vec2 vUv;
${DEPTH}
uniform sampler2D tAO;
uniform vec2 px;
void main() {
  float z0 = lin( texture2D( tDepth, vUv ).r );
  float s = 0.0, w = 0.0;
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    vec2 uv = vUv + vec2( float( i ), float( j ) ) * px * 1.5;
    float k = exp( -abs( lin( texture2D( tDepth, uv ).r ) - z0 ) * 7.0 / ( 0.3 + z0 * 0.06 ) ) + 1e-4;
    s += texture2D( tAO, uv ).r * k;
    w += k;
  }
  gl_FragColor = vec4( vec3( s / w ), 1.0 );
}
`;

/** the air: in-scattered light on the way to each pixel, and how much of the pixel still gets through */
const FOG = /* glsl */ `
varying vec2 vUv;
${DEPTH}
uniform highp sampler3D tVol;
uniform vec3 volMin;
uniform vec3 volInv;
uniform vec2 lmK;
uniform mat4 camW;
uniform float frame;
uniform float time;
uniform float density;
uniform vec4 spark;
uniform vec4 beamP;
uniform vec3 beamD;
uniform vec4 lfFlickP[8];
uniform float lfFlickA[8];
float flickDim( vec3 p ) {
  float k = 1.0;
  for ( int i = 0; i < 8; i++ ) {
    float r = lfFlickP[i].w;
    if ( r <= 0.0 ) continue;
    k *= 1.0 - lfFlickA[i] * ( 1.0 - smoothstep( r * 0.3, r, distance( p, lfFlickP[i].xyz ) ) );
  }
  return k;
}
void main() {
  vec3 P = viewAt( vUv );
  float dist = length( P );
  vec3 o = camW[3].xyz;
  vec3 dir = mat3( camW ) * ( P / dist );
  // the gun is on the lens's side of all this: march on past it, so its outline doesn't stamp the fog
  float maxT = min( dist < 1.2 ? 6.0 : dist, 60.0 );
  float jit = ign( gl_FragCoord.xy );
  vec3 acc = vec3( 0.0 );
  float T = 1.0;
  float prev = 0.0;
  for ( int i = 0; i < 10; i++ ) {
    float f = ( float( i ) + jit ) / 10.0;
    float t = f * f * maxT;
    float ds = t - prev;
    prev = t;
    vec3 p = o + dir * t;
    vec3 e = texture( tVol, ( p - volMin ) * volInv ).rgb;
    vec3 L = ( exp2( e * lmK.x ) - 1.0 ) / lmK.y * flickDim( p );
    float wisp = 0.72 + 0.28 * sin( p.x * 0.31 + time * 0.13 ) * sin( p.z * 0.27 - time * 0.09 + p.y * 0.4 );
    float rho = density * wisp * ( 0.45 + 0.55 * exp( -max( p.y, 0.0 ) * 0.16 ) );
    // the beam and any flash
    vec3 b = p - beamP.xyz;
    float bl = length( b ) + 1e-3;
    float cone = smoothstep( 0.82, 0.93, dot( b / bl, beamD ) );
    L += vec3( 1.0, 0.93, 0.82 ) * beamP.w * cone / ( bl * bl + 2.0 ) * 0.14;
    vec3 sd = p - spark.xyz;
    L += vec3( 1.0, 0.68, 0.38 ) * spark.w / ( dot( sd, sd ) + 0.6 );
    acc += T * L * rho * ds;
    T *= exp( -rho * ds );
  }
  gl_FragColor = vec4( acc * 1.3, T );
}
`;

const FOGBLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 px;
void main() {
  vec4 s = vec4( 0.0 );
  for ( int j = -1; j <= 2; j++ ) for ( int i = -1; i <= 2; i++ ) s += texture2D( tSrc, vUv + ( vec2( float( i ), float( j ) ) - 0.5 ) * px );
  gl_FragColor = s / 16.0;
}
`;

/** what a hard floor gives back: lamps, a lit doorway, the pool of the weapon light, laid along the floor toward the lens.
 *  Marched in the depth at half size, coloured from last frame's picture; only floors, and mostly at a low angle, as on any lino */
const SSR = /* glsl */ `
varying vec2 vUv;
${DEPTH}
uniform sampler2D tHist;
uniform vec2 px;
uniform float frame;
uniform mat4 camW;
vec2 toUv( vec3 p ) { return ( p.xy / -p.z ) / pInv * 0.5 + 0.5; }
void main() {
  float d0 = texture2D( tDepth, vUv ).r;
  vec3 P = viewAt( vUv );
  float z = -P.z;
  gl_FragColor = vec4( 0.0 );
  if ( d0 >= 1.0 || z < 1.3 || z > 34.0 ) return;
  vec3 l = viewAt( vUv - vec2( px.x, 0.0 ) ), r = viewAt( vUv + vec2( px.x, 0.0 ) ), b = viewAt( vUv - vec2( 0.0, px.y ) ), t = viewAt( vUv + vec2( 0.0, px.y ) );
  vec3 dx = abs( l.z - P.z ) < abs( r.z - P.z ) ? P - l : r - P;
  vec3 dy = abs( b.z - P.z ) < abs( t.z - P.z ) ? P - b : t - P;
  vec3 N = normalize( cross( dx, dy ) );
  vec3 Nw = mat3( camW ) * N;
  if ( Nw.y < 0.94 ) return;
  vec3 V = normalize( P );
  float n1 = ign( gl_FragCoord.xy + frame * 5.588238 ), n2 = ign( gl_FragCoord.yx + frame * 3.17 + 19.0 );
  // a worn floor is no mirror: each ray leaves a little off true, and the frames average it into a smear
  vec3 R = normalize( reflect( V, N ) + ( vec3( n1, n2, n1 * n2 ) - 0.5 ) * 0.045 );
  float cosV = max( dot( -V, N ), 0.0 );
  float F = 0.035 + 0.965 * pow( 1.0 - cosV, 5.0 );
  if ( F < 0.045 || R.z > -0.02 ) return;
  float step_ = 0.16, travelled = 0.0;
  vec3 p = P + N * 0.03;
  vec2 hit = vec2( -1.0 );
  for ( int i = 0; i < 20; i++ ) {
    float ds = step_ * ( 0.6 + n1 * 0.8 );
    p += R * ds;
    travelled += ds;
    step_ *= 1.19;
    vec2 uv = toUv( p );
    if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) break;
    float zs = lin( texture2D( tDepth, uv ).r );
    float behind = -p.z - zs;
    if ( behind > 0.0 ) {
      if ( behind < 0.35 + ds * 1.5 ) {
        // back along the ray to where it went in
        vec3 a = p - R * ds, q = p;
        for ( int k = 0; k < 4; k++ ) {
          vec3 m = ( a + q ) * 0.5;
          if ( -m.z - lin( texture2D( tDepth, toUv( m ) ).r ) > 0.0 ) q = m; else a = m;
        }
        hit = toUv( q );
      }
      break;
    }
  }
  if ( hit.x < 0.0 ) return;
  vec2 e = smoothstep( vec2( 0.0 ), vec2( 0.08 ), hit ) * smoothstep( vec2( 0.0 ), vec2( 0.08 ), 1.0 - hit );
  float fade = e.x * e.y * smoothstep( 16.0, 6.0, travelled ) * smoothstep( 34.0, 22.0, z ) * smoothstep( 1.3, 2.2, z );
  vec3 c = min( texture2D( tHist, hit ).rgb, vec3( 14.0 ) );
  gl_FragColor = vec4( c * F * fade, 1.0 );
}
`;

/** everything onto the picture, blended with what this pixel was last frame */
const RESOLVE = /* glsl */ `
varying vec2 vUv;
${DEPTH}
uniform sampler2D tSrc;
uniform sampler2D tHist;
uniform sampler2D tAO;
uniform sampler2D tFog;
uniform sampler2D tAir;
uniform sampler2D tSSR;
uniform float ssrK;
uniform mat4 reproj;
uniform vec2 px;
uniform float cut;
uniform vec2 jit;
// five taps of a Catmull-Rom filter: history resampled every frame stays sharp instead of melting
vec3 histAt( vec2 uv ) {
  vec2 pos = uv / px, c = floor( pos - 0.5 ) + 0.5, f = pos - c;
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
  vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
  vec2 w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2, o = w2 / w12;
  vec2 t0 = ( c - 1.0 ) * px, t3 = ( c + 2.0 ) * px, t12 = ( c + o ) * px;
  vec3 r = texture2D( tHist, vec2( t12.x, t0.y ) ).rgb * ( w12.x * w0.y );
  r += texture2D( tHist, vec2( t0.x, t12.y ) ).rgb * ( w0.x * w12.y );
  r += texture2D( tHist, t12 ).rgb * ( w12.x * w12.y );
  r += texture2D( tHist, vec2( t3.x, t12.y ) ).rgb * ( w3.x * w12.y );
  r += texture2D( tHist, vec2( t12.x, t3.y ) ).rgb * ( w12.x * w3.y );
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max( r / ws, vec3( 0.0 ) );
}
void main() {
  vec2 uv = vUv;
  float z = lin( texture2D( tDepth, uv ).r );
  // depth runs out of steps far away and the occlusion turns into contour lines: it's a near effect anyway
  float ao = z < 0.85 ? 1.0 : mix( texture2D( tAO, uv ).r, 1.0, smoothstep( 28.0, 70.0, z ) );
  vec4 fog = z < 1.2 ? vec4( 0.0, 0.0, 0.0, 1.0 ) : texture2D( tFog, uv );
  vec4 air = texture2D( tAir, uv );
  float A = ao * fog.a * ( 1.0 - air.a );
  vec3 B = fog.rgb * ( 1.0 - air.a ) + air.rgb;
  if ( ssrK > 0.0 && z > 1.3 ) {
    // four taps across the half-size layer: the stipple of single rays becomes the smear a scuffed floor gives
    vec2 o = px * 2.2;
    vec3 rf = texture2D( tSSR, uv + vec2( o.x, o.y * 0.4 ) ).rgb + texture2D( tSSR, uv - vec2( o.x, o.y * 0.4 ) ).rgb + texture2D( tSSR, uv + vec2( -o.x * 0.4, o.y ) ).rgb + texture2D( tSSR, uv - vec2( -o.x * 0.4, o.y ) ).rgb;
    B += rf * 0.25 * ssrK * fog.a * ( 1.0 - air.a );
  }
  vec2 uc = uv + jit;
  vec3 c = min( texture2D( tSrc, uc ).rgb, vec3( 40.0 ) );
  vec3 n = min( texture2D( tSrc, uc + vec2( 0.0, px.y ) ).rgb, vec3( 40.0 ) ), s = min( texture2D( tSrc, uc - vec2( 0.0, px.y ) ).rgb, vec3( 40.0 ) );
  vec3 e = min( texture2D( tSrc, uc + vec2( px.x, 0.0 ) ).rgb, vec3( 40.0 ) ), w = min( texture2D( tSrc, uc - vec2( px.x, 0.0 ) ).rgb, vec3( 40.0 ) );
  // a glint one pixel wide on chrome is brighter than the lamp it came from: hold it to a few times what's round it
  c = min( c, ( n + s + e + w ) * 0.8 + 0.6 );
  vec3 cur = c * A + B;
  vec3 mn = min( c, min( min( n, s ), min( e, w ) ) ) * A + B;
  vec3 mx = max( c, max( max( n, s ), max( e, w ) ) ) * A + B;
  // the mean and spread are a tighter box than min and max: fewer ghosts behind a moving body
  vec3 mean = ( c + n + s + e + w ) * 0.2 * A + B;
  vec3 prev = uv.xyy;
  vec2 pu = uv;
  if ( z > 1.1 ) {
    vec4 q = reproj * vec4( uv * 2.0 - 1.0, texture2D( tDepth, uv ).r * 2.0 - 1.0, 1.0 );
    pu = q.xy / q.w * 0.5 + 0.5;
  }
  vec3 h = histAt( pu );
  vec3 box = ( mx - mn ) * 0.5 + 0.002;
  h = clamp( h, max( mn, mean - box * 1.2 ), min( mx, mean + box * 1.2 ) );
  float out_ = step( 0.0, pu.x ) * step( pu.x, 1.0 ) * step( 0.0, pu.y ) * step( pu.y, 1.0 );
  float k = cut > 0.5 ? 1.0 : mix( 1.0, z < 1.1 ? 0.3 : 0.13, out_ );
  gl_FragColor = vec4( mix( h, cur, k ), 1.0 );
}
`;

const DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 px;
uniform float first;
vec3 q( vec2 uv ) {
  vec3 c = min( texture2D( tSrc, uv ).rgb, vec3( 60.0 ) );
  return c;
}
void main() {
  vec3 a = q( vUv + px * vec2( -1, -1 ) ), b = q( vUv + px * vec2( 1, -1 ) ), c = q( vUv + px * vec2( -1, 1 ) ), d = q( vUv + px * vec2( 1, 1 ) );
  vec3 s = ( a + b + c + d ) * 0.25;
  gl_FragColor = vec4( s, 1.0 );
}
`;

const UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tAdd;
uniform vec2 px;
uniform float k;
void main() {
  vec3 s = vec3( 0.0 );
  s += texture2D( tSrc, vUv + px * vec2( -1, -1 ) ).rgb;
  s += texture2D( tSrc, vUv + px * vec2( 1, -1 ) ).rgb;
  s += texture2D( tSrc, vUv + px * vec2( -1, 1 ) ).rgb;
  s += texture2D( tSrc, vUv + px * vec2( 1, 1 ) ).rgb;
  s += texture2D( tSrc, vUv ).rgb * 4.0;
  gl_FragColor = vec4( s / 8.0 * k + texture2D( tAdd, vUv ).rgb, 1.0 );
}
`;

const EXPO = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tFine;
uniform sampler2D tPrev;
uniform float dt;
uniform float cut;
uniform float key;
uniform float maxE;
uniform float hiKey;
void main() {
  float acc = 0.0, wsum = 0.0;
  for ( int j = 0; j < 7; j++ ) for ( int i = 0; i < 9; i++ ) {
    vec2 uv = ( vec2( float( i ), float( j ) ) + 0.5 ) / vec2( 9.0, 7.0 );
    vec2 c = uv - 0.5;
    float w = exp( -dot( c, c ) * 7.0 );
    float l = dot( texture2D( tSrc, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) );
    acc += log2( max( l, 1e-4 ) ) * w;
    wsum += w;
  }
  float avg = exp2( acc / wsum );
  // what a body camera's meter really does: it protects whatever is bright. A pool of torchlight on a wall is
  // exposed for itself and the room round it goes black; a bare bulb is too small to count (each sample is capped)
  float hi = 0.0, hw = 0.0;
  for ( int j = 0; j < 9; j++ ) for ( int i = 0; i < 16; i++ ) {
    vec2 uv = ( vec2( float( i ), float( j ) ) + 0.5 ) / vec2( 16.0, 9.0 );
    vec2 c = uv - 0.5;
    float w = exp( -dot( c, c ) * 3.2 );
    float l = min( dot( texture2D( tFine, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) ), 20.0 );
    hi += l * l * w;
    hw += w;
  }
  float rms = sqrt( hi / hw );
  // a small sensor: it opens slowly into the dark and shuts fast on the light
  float want = clamp( min( key / max( avg, 1e-4 ), hiKey / max( rms, 1e-4 ) ), 0.05, maxE );
  float prev = texture2D( tPrev, vec2( 0.5 ) ).r;
  float rate = want < prev ? 5.5 : 1.25;
  float e = cut > 0.5 ? want : exp( mix( log( prev ), log( want ), 1.0 - exp( -dt * rate ) ) );
  gl_FragColor = vec4( e, avg, 0.0, 1.0 );
}
`;

const BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform mat4 reproj;  // this frame's clip -> last frame's clip
uniform float amount;
void main() {
  float z = texture2D( tDepth, vUv ).r;
  vec4 p = vec4( vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0 );
  vec4 q = reproj * p;
  vec2 prev = q.xy / q.w * 0.5 + 0.5;
  vec2 v = ( vUv - prev ) * amount;
  float l = length( v );
  v *= min( 1.0, 0.05 / max( l, 1e-5 ) );
  vec3 c = vec3( 0.0 );
  float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
  for ( int i = 0; i < 6; i++ ) {
    float t = ( float( i ) + n + 0.5 ) / 6.0 - 0.5;
    c += min( texture2D( tSrc, vUv + v * t ).rgb, vec3( 40.0 ) );
  }
  gl_FragColor = vec4( c / 6.0, 1.0 );
}
`;

const FINAL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tBloom;
uniform sampler2D tHalf;
uniform sampler2D tBlock;
uniform sampler2D tExp;
uniform sampler2D tDepthF;
uniform vec2 nfF;
uniform vec2 res;
uniform float time;
uniform float tanHalf;
uniform float fish;
uniform vec3 wb;
uniform float whiteout;
uniform float hurt;
uniform float glitch;
uniform float feedCut;
uniform float grainK;
uniform float lensWet;
uniform float lensBlood;
uniform vec3 bloodSeed;
uniform vec2 shutter;
uniform vec3 flare;
uniform float caK;
uniform float satK;

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}

vec2 lens( vec2 p, float rho, float k, float aspect ) {
  float rd = sqrt( aspect * aspect + 1.0 );
  float thd = atan( rd * tanHalf );
  float th = rho / rd * thd;
  float rin = tan( th ) / tanHalf;
  float s = mix( 1.0, rin / max( rho, 1e-4 ), fish ) * k;
  // keep the frame filled: the corners land on the corners
  return p * s;
}

vec3 film( vec3 x ) {
  // filmic toe and shoulder, harder than a game: the sensor clips
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
}

/** beads of water on the housing's glass: a few cells hold one, and it bends what's behind it */
vec3 droplet( vec2 p, float scale, float t ) {
  vec2 g = p * scale;
  vec2 id = floor( g ), f = fract( g ) - 0.5;
  float r = hash( id );
  // each bead lands, sits and runs off in its own time
  float life = fract( t * ( 0.05 + r * 0.06 ) + r * 13.0 );
  float live = step( 0.86, hash( id + floor( t * ( 0.05 + r * 0.06 ) + r * 13.0 ) * 1.7 ) );
  vec2 c = ( vec2( hash( id + 3.1 ), hash( id + 7.7 ) ) - 0.5 ) * 0.5;
  c.y -= smoothstep( 0.72, 1.0, life ) * 0.9;
  float rad = 0.07 + r * 0.14;
  vec2 d = f - c;
  d.y *= 0.84 + r * 0.26;
  float m = smoothstep( rad, rad * 0.55, length( d ) ) * live * smoothstep( 0.0, 0.03, life );
  return vec3( d / rad, m );
}

/** blood on the housing's glass: out of focus, clustered where it came from, a few big spots and a mist of small, and with time it runs */
float splatter( vec2 q, float aspect ) {
  vec2 c0 = vec2( aspect * ( 0.22 + 0.56 * fract( bloodSeed.x * 0.37 ) ), 0.22 + 0.5 * fract( bloodSeed.y * 0.53 ) );
  float dd = dot( q - c0, q - c0 );
  float m = 0.0;
  for ( int k = 0; k < 3; k++ ) {
    float sc = k == 0 ? 5.0 : k == 1 ? 11.0 : 26.0;
    float dens = exp( -dd / ( k == 0 ? 0.045 : k == 1 ? 0.07 : 0.1 ) ) * ( k == 0 ? 0.8 : k == 1 ? 0.55 : 0.35 );
    vec2 g = q * sc + bloodSeed.xy * ( float( k ) + 1.0 );
    vec2 id = floor( g ), f = fract( g ) - 0.5;
    float r = hash( id + bloodSeed.xy );
    if ( r > dens ) continue;
    vec2 c = ( vec2( hash( id + 3.1 ), hash( id + 7.7 ) ) - 0.5 ) * 0.45;
    float rad = ( k == 0 ? 0.4 : k == 1 ? 0.3 : 0.2 ) * ( 0.35 + hash( id + 1.3 ) * 0.65 );
    vec2 d = f - c;
    float an = atan( d.y, d.x );
    float rr = rad * ( 1.0 + 0.07 * sin( an * 3.0 + r * 40.0 ) + 0.04 * sin( an * 7.0 + r * 13.0 ) );
    float blob = smoothstep( rr, rr * 0.5, length( d ) );
    // a run: a thin line down from the drop, longer as time goes on
    float run = clamp( bloodSeed.z * 0.05 * ( 0.4 + hash( id + 5.5 ) ), 0.0, 1.0 ) * ( k == 2 ? 0.0 : 1.0 );
    float trail = smoothstep( rad * 0.32, rad * 0.12, abs( d.x + d.y * 0.05 ) ) * step( -rad * ( 0.2 + run * 6.0 ), d.y ) * step( d.y, 0.0 ) * step( 0.35, hash( id + 9.9 ) );
    m = max( m, max( blob, trail * 0.85 ) * ( k == 2 ? 0.7 : 1.0 ) );
  }
  return m;
}

void main() {
  float aspect = res.x / res.y;
  vec2 uv = vUv;
  float wetEdge = 0.0;
  if ( lensWet > 0.0 ) {
    vec2 q = vec2( uv.x * aspect, uv.y );
    vec3 a = droplet( q, 9.0, time ), b = droplet( q + 3.7, 19.0, time * 1.3 );
    float m = max( a.z, b.z * 0.8 ) * lensWet * ( 0.45 + 0.55 * smoothstep( 0.1, 0.62, length( vUv - 0.5 ) ) );
    vec2 bend = ( a.z > b.z ? a.xy : b.xy ) * m;
    uv -= bend * vec2( 0.028 / aspect, 0.028 );
    wetEdge = m;
  }
  // a rolling shutter: the sensor reads top to bottom, so a fast turn leans everything upright
  uv.x += ( uv.y - 0.5 ) * shutter.x;
  uv.y += ( uv.x - 0.5 ) * shutter.y * 0.3;
  // a torn feed
  if ( glitch > 0.0 ) {
    float band = floor( uv.y * 24.0 + time * 13.0 );
    float r = hash( vec2( band, floor( time * 22.0 ) ) );
    uv.x += ( r - 0.5 ) * glitch * step( 0.62, r ) * 0.14;
  }
  vec2 p = ( uv - 0.5 ) * 2.0 * vec2( aspect, 1.0 );
  float rho = length( p );
  float rd = sqrt( aspect * aspect + 1.0 );
  float edge = rho / rd;

  float ca = 0.0005 + caK * edge * edge * edge;
  vec2 cr = lens( p, rho, 1.0 + ca, aspect ) / ( 2.0 * vec2( aspect, 1.0 ) ) + 0.5;
  vec2 cg = lens( p, rho, 1.0, aspect ) / ( 2.0 * vec2( aspect, 1.0 ) ) + 0.5;
  vec2 cb = lens( p, rho, 1.0 - ca, aspect ) / ( 2.0 * vec2( aspect, 1.0 ) ) + 0.5;

  vec3 c = vec3( texture2D( tSrc, cr ).r, texture2D( tSrc, cg ).g, texture2D( tSrc, cb ).b );
  // unsharp mask, as the camera's own processing does it
  vec3 soft = texture2D( tHalf, cg ).rgb;
  // a cheap wide lens is only sharp in the middle, and what's a hand's length from it (the wearer's own arms) is never in focus
  float zF = nfF.x * nfF.y / ( nfF.y - texture2D( tDepthF, cg ).r * ( nfF.y - nfF.x ) );
  float nearK = smoothstep( 0.5, 0.16, zF );
  float softK = clamp( smoothstep( 0.5, 1.0, edge ) * 0.8 + nearK * 0.85, 0.0, 1.0 );
  vec3 softer = texture2D( tBlock, cg ).rgb;
  // a glint a hand from the lens must not swell into a ball of light: the blur can't hold much more than the sharp picture did
  softer = min( softer, max( c, soft ) * 1.5 + 0.01 );
  c = max( c + ( c - soft ) * 1.05 * ( 1.0 - softK ), vec3( 0.0 ) );
  c = mix( c, mix( soft, softer, nearK * 0.5 ), softK );
  vec3 bloom = texture2D( tBloom, cg ).rgb;
  float expo = texture2D( tExp, vec2( 0.5 ) ).r;
  // grease and dust on the housing's window: nothing in the dark, a smeared glow round anything bright
  vec2 dq = vUv * vec2( aspect, 1.0 );
  float dirt = smoothstep( 0.42, 0.95, vnoise( dq * 3.1 + 7.0 ) * 0.65 + vnoise( dq * 7.3 ) * 0.35 ) + step( 0.9965, hash( floor( dq * 140.0 ) ) ) * 0.6;
  vec3 hdr = c + bloom * ( 0.085 + dirt * 0.32 ) + whiteout * 9.0;
  if ( flare.z > 0.003 ) {
    // the sun in a cheap plastic lens: a veil across the frame, the iris's star, and ghosts strung along the line through the centre
    vec2 A = vec2( aspect, 1.0 );
    vec2 dv = ( cg - flare.xy ) * A;
    float r = length( dv );
    vec3 fl = vec3( 1.0, 0.93, 0.8 ) * ( 0.0028 / ( 0.012 + r * r ) + 0.05 * exp( -r * 1.5 ) );
    float an = atan( dv.y, dv.x );
    fl += vec3( 1.0, 0.95, 0.86 ) * pow( abs( cos( an * 3.0 + 0.4 ) ), 160.0 ) * exp( -r * 6.0 ) * 0.22;
    vec2 ax = vec2( 0.5 ) - flare.xy;
    for ( int i = 0; i < 5; i++ ) {
      float t = i == 0 ? 0.55 : i == 1 ? 1.22 : i == 2 ? 1.6 : i == 3 ? 1.86 : 2.3;
      float rad = i == 0 ? 0.03 : i == 1 ? 0.075 : i == 2 ? 0.045 : i == 3 ? 0.13 : 0.2;
      vec3 tint = i == 0 ? vec3( 0.5, 0.75, 0.6 ) : i == 1 ? vec3( 0.75, 0.55, 0.3 ) : i == 2 ? vec3( 0.35, 0.6, 0.8 ) : i == 3 ? vec3( 0.5, 0.4, 0.65 ) : vec3( 0.3, 0.42, 0.34 );
      float d = length( ( cg - ( flare.xy + ax * t ) ) * A );
      fl += tint * smoothstep( rad, rad * 0.82, d ) * ( 0.35 + 0.65 * smoothstep( 0.0, rad, d ) ) * 0.05;
    }
    hdr += fl * flare.z * 1.5;
  }
  // macroblocks: the dark parts of a stream fall apart first
  vec2 blk = ( floor( cg * res / 10.0 ) + 0.5 ) * 10.0 / res;
  vec3 bl = texture2D( tBlock, blk ).rgb;
  float lum0 = dot( hdr * expo, vec3( 0.3, 0.6, 0.1 ) );
  float blum = dot( bl * expo, vec3( 0.3, 0.6, 0.1 ) );
  hdr = mix( hdr, bl, 0.18 * smoothstep( 0.1, 0.0, lum0 ) * smoothstep( 0.14, 0.03, blum ) );
  hdr *= expo;
  // white balance: night through a cheap sensor is grey, with sodium in it, not blue
  hdr *= wb;

  vec3 col = film( hdr * 0.92 );
  // a cheap sensor's colour: thin, cold shadows
  float l = dot( col, vec3( 0.3, 0.59, 0.11 ) );
  // a night sky through a small sensor goes grey-green, never violet: anything with green missing gets it back
  float vio = max( min( col.r, col.b ) - col.g, 0.0 );
  col.rb -= vio * 0.8;
  col = mix( vec3( l ), col, satK );
  col *= mix( vec3( 0.95, 1.0, 0.99 ), vec3( 1.03, 1.0, 0.95 ), smoothstep( 0.0, 0.5, l ) );
  // crushed blacks, hot highlights
  col = pow( col, vec3( 1.14 ) ) * 1.05;
  // lens falloff and the housing's rounded corners, with a coloured rim
  float vig = 1.0 - smoothstep( 0.5, 1.1, edge ) * 0.5;
  col *= vig;
  vec2 q = abs( p ) / vec2( aspect, 1.0 );
  float corner = length( max( q - vec2( 0.86, 0.8 ), 0.0 ) / vec2( 0.14, 0.2 ) );
  float rim = smoothstep( 0.86, 1.06, corner );
  col = mix( col, col * vec3( 1.12, 0.96, 0.86 ), smoothstep( 0.6, 1.0, corner ) * 0.5 );
  col *= 1.0 - rim;
  if ( lensBlood > 0.0 ) {
    float bm = splatter( vec2( vUv.x * aspect, vUv.y ), aspect ) * clamp( lensBlood * 1.3, 0.0, 1.0 );
    // seen through: what's behind goes dark red, and a lamp still shines through it
    col = mix( col, col * vec3( 0.42, 0.03, 0.025 ) + vec3( 0.03, 0.0, 0.0 ), bm * 0.88 );
  }
  // hurt: the world drains and the lens darkens
  float hl = dot( col, vec3( 0.3, 0.59, 0.11 ) );
  col = mix( col, vec3( hl ) * vec3( 1.05, 0.9, 0.88 ), hurt * 0.75 );
  col *= 1.0 - hurt * 0.3 * smoothstep( 0.2, 0.9, edge );
  col = mix( col, vec3( 0.0 ), feedCut );
  col = pow( max( col, 0.0 ), vec3( 1.0 / 2.2 ) );
  // sensor noise, in display space so the blacks don't turn to gravel
  vec2 gp = gl_FragCoord.xy;
  float g = hash( gp + fract( time ) * 91.7 ) - 0.5;
  float g2 = hash( gp * 1.7 + fract( time * 1.3 ) * 37.1 ) - 0.5;
  // the sensor gains up in the dark, and its noise comes up with it: finer grain, then blotches of colour a few pixels across
  float gain = clamp( expo / 1.1, 1.0, 3.2 );
  float gk = mix( 0.03, 0.016, smoothstep( 0.0, 0.42, l ) ) * grainK * ( 1.0 - feedCut ) * ( 0.7 + 0.42 * gain );
  col += vec3( g + g2 * 0.2, g, g - g2 * 0.2 ) * gk;
  vec2 cbk = floor( gp / 3.0 );
  float c1 = hash( cbk + fract( time * 0.97 ) * 53.0 ) - 0.5, c2 = hash( cbk * 1.3 + fract( time * 1.13 ) * 17.0 ) - 0.5;
  col += vec3( c1, -0.5 * ( c1 + c2 ), c2 ) * 0.014 * ( gain - 1.0 ) * ( 1.0 - smoothstep( 0.08, 0.5, l ) ) * ( 1.0 - feedCut );
  gl_FragColor = vec4( col, 1.0 );
}
`;

function pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

function target(w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType, filter: THREE.TextureFilter = THREE.LinearFilter) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type, minFilter: filter as THREE.MinificationTextureFilter, magFilter: filter as THREE.MagnificationTextureFilter, depthBuffer: false, generateMipmaps: false });
}

export class Post {
  scale = 1;
  scene!: THREE.WebGLRenderTarget;
  private blur!: THREE.WebGLRenderTarget;
  private hist: THREE.WebGLRenderTarget[] = [];
  private hi = 0;
  private aoA!: THREE.WebGLRenderTarget;
  private aoB!: THREE.WebGLRenderTarget;
  private fogT!: THREE.WebGLRenderTarget;
  private fogB!: THREE.WebGLRenderTarget;
  private airT!: THREE.WebGLRenderTarget;
  private ssrT!: THREE.WebGLRenderTarget;
  /** floors give back what stands on them */
  reflections = 1;
  private frame = 0;
  private liteDone = false;
  /** fog thickness, per metre */
  density = 0.007;
  /** x y z r per end of each body's capsule, written by the game */
  capA = Array.from({ length: AO_MAX }, () => new THREE.Vector4());
  capB = Array.from({ length: AO_MAX }, () => new THREE.Vector4());
  capN = 0;
  /** what floats: drawn by Fx */
  airScene: THREE.Scene | null = null;
  airScale: (s: number) => void = () => {};
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private exp = [target(1, 1, THREE.FloatType, THREE.NearestFilter), target(1, 1, THREE.FloatType, THREE.NearestFilter)];
  private ei = 0;
  private quad: THREE.Mesh;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private qs = new THREE.Scene();
  private mDown = pass(DOWN, { tSrc: { value: null }, px: { value: new THREE.Vector2() }, first: { value: 0 } });
  private mUp = pass(UP, { tSrc: { value: null }, tAdd: { value: null }, px: { value: new THREE.Vector2() }, k: { value: 1 } });
  private mExp = pass(EXPO, { tSrc: { value: null }, tFine: { value: null }, tPrev: { value: null }, dt: { value: 0 }, cut: { value: 1 }, key: { value: 0.115 }, maxE: { value: 8.5 }, hiKey: { value: 0.75 } });
  /** how bright the camera wants the scene: a night street and an overcast noon aren't metered alike */
  set exposureKey(k: number) {
    this.mExp.uniforms.key.value = k;
  }
  /** fresh blood on the lens: a new pattern, unless there's plenty there already */
  splat() {
    const u = this.mFinal.uniforms;
    if (u.lensBlood.value < 0.25) (u.bloodSeed.value as THREE.Vector3).set(Math.random() * 50, Math.random() * 50, 0);
  }
  /** how far the sensor will open: at night it gives up before the dark looks like day */
  set exposureMax(k: number) {
    this.mExp.uniforms.maxE.value = k;
  }
  private common = { tDepth: AIR.tDepth, nf: AIR.nf, pInv: { value: new THREE.Vector2() } };
  private camW = { value: new THREE.Matrix4() };
  private mAO = pass(AO, { ...this.common, px: { value: new THREE.Vector2() }, frame: { value: 0 }, camW: this.camW, capA: { value: this.capA }, capB: { value: this.capB }, capN: { value: 0 } });
  private mAOBlur = pass(AOBLUR, { ...this.common, tAO: { value: null }, px: { value: new THREE.Vector2() } });
  private mFog = pass(FOG, {
    ...this.common, tVol: LF.volAvg, volMin: LF.volMin, volInv: LF.volInv, lmK: LF.lmK, camW: this.camW, frame: { value: 0 }, time: { value: 0 }, density: { value: 0.02 }, spark: AIR.spark, beamP: AIR.beamP, beamD: AIR.beamD, lfFlickP: LF.flickP, lfFlickA: LF.flickA,
  });
  private mSSR = pass(SSR, { ...this.common, tHist: { value: null }, px: { value: new THREE.Vector2() }, frame: { value: 0 }, camW: this.camW });
  private mFogBlur = pass(FOGBLUR, { tSrc: { value: null }, px: { value: new THREE.Vector2() } });
  private mResolve = pass(RESOLVE, { ...this.common, tSrc: { value: null }, tHist: { value: null }, tAO: { value: null }, tFog: { value: null }, tAir: { value: null }, tSSR: { value: null }, ssrK: { value: 0 }, reproj: { value: new THREE.Matrix4() }, px: { value: new THREE.Vector2() }, cut: { value: 1 }, jit: { value: new THREE.Vector2() } });
  private mBlur = pass(BLUR, { tSrc: { value: null }, tDepth: { value: null }, reproj: { value: new THREE.Matrix4() }, amount: { value: 1 } });
  mFinal = pass(FINAL, {
    tSrc: { value: null }, tBloom: { value: null }, tHalf: { value: null }, tBlock: { value: null }, tExp: { value: null }, tDepthF: AIR.tDepth, nfF: AIR.nf, res: { value: new THREE.Vector2() }, time: { value: 0 },
    tanHalf: { value: 0.9 }, fish: { value: 0.85 }, wb: { value: new THREE.Vector3(1.03, 1, 0.88) }, whiteout: { value: 0 }, hurt: { value: 0 }, glitch: { value: 0 }, feedCut: { value: 0 }, grainK: { value: 1 }, lensWet: { value: 0 }, lensBlood: { value: 0 }, bloodSeed: { value: new THREE.Vector3() }, shutter: { value: new THREE.Vector2() }, flare: { value: new THREE.Vector3() }, caK: { value: 0.014 }, satK: { value: 0.82 },
  });
  private prevVP = new THREE.Matrix4();
  private curVP = new THREE.Matrix4();
  private hadPrev = false;
  /** a machine that can't keep up: no occlusion, no air, no shutter blur */
  lite = false;
  /** next frame jumps straight to the right exposure and forgets what it saw */
  cutExposure = true;
  motionBlur = true;

  constructor(private r: THREE.WebGLRenderer) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mFinal);
    this.quad.frustumCulled = false;
    this.qs.add(this.quad);
  }

  resize(w: number, h: number) {
    for (const t of [this.scene, this.blur, this.aoA, this.aoB, this.fogT, this.fogB, this.airT, this.ssrT, ...this.hist, ...this.down, ...this.up]) t?.dispose();
    const W = Math.round(w), H = Math.round(h);
    const depth = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth });
    this.scene.texture.minFilter = this.scene.texture.magFilter = THREE.LinearFilter;
    AIR.tDepth.value = depth;
    this.blur = target(W, H);
    this.hist = [target(W, H), target(W, H)];
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
    this.aoA = target(hw, hh, THREE.UnsignedByteType);
    this.aoB = target(hw, hh, THREE.UnsignedByteType);
    this.fogT = target(Math.ceil(W / 4), Math.ceil(H / 4));
    this.fogB = target(Math.ceil(W / 4), Math.ceil(H / 4));
    this.airT = target(hw, hh);
    this.ssrT = target(hw, hh);
    AIR.inv.value.set(1 / hw, 1 / hh);
    this.down = [];
    this.up = [];
    let a = W, b = H;
    for (let i = 0; i < 6; i++) {
      a = Math.ceil(a / 2);
      b = Math.ceil(b / 2);
      this.down.push(target(a, b));
      if (i < 5) this.up.push(target(a, b));
    }
    this.mFinal.uniforms.res.value.set(W, H);
    this.cutExposure = true;
    this.liteDone = false;
  }

  private draw(m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    this.r.setRenderTarget(to);
    this.r.render(this.qs, this.ortho);
  }

  render(scene: THREE.Scene, cam: THREE.PerspectiveCamera, dt: number, time: number) {
    const r = this.r;
    const W = this.scene.width, H = this.scene.height;
    this.frame = (this.frame + 1) & 1023;
    const P = cam.projectionMatrix;
    // ---- the scene, nudged a fraction of a pixel, a different fraction each frame
    const jx = (halton(this.frame % 8 + 1, 2) - 0.5), jy = (halton(this.frame % 8 + 1, 3) - 0.5);
    const e8 = P.elements[8], e9 = P.elements[9];
    P.elements[8] += (jx * 2) / W;
    P.elements[9] += (jy * 2) / H;
    r.setRenderTarget(this.scene);
    r.clear();
    r.render(scene, cam);
    P.elements[8] = e8;
    P.elements[9] = e9;
    let src = this.scene.texture;
    this.curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // ---- what the depth knows
    AIR.nf.value.set(cam.near, cam.far);
    this.common.pInv.value.set(1 / P.elements[0], 1 / P.elements[5]);
    this.camW.value.copy(cam.matrixWorld);
    const hw = this.aoA.width, hh = this.aoA.height;
    const uA = this.mAO.uniforms;
    uA.px.value.set(1 / hw, 1 / hh);
    uA.frame.value = this.frame;
    uA.capN.value = this.capN;
    if (!this.lite || !this.liteDone) {
      // in lite mode these run once, with nothing in them, and stay as they are
      this.liteDone = this.lite;
      uA.capN.value = this.lite ? 0 : this.capN;
      if (this.lite) {
        r.setRenderTarget(this.aoB);
        r.setClearColor(0xffffff, 1);
        r.clear();
        r.setRenderTarget(this.fogB);
        r.setClearColor(0x000000, 1);
        r.clear();
      } else {
        this.draw(this.mAO, this.aoA);
        const uB = this.mAOBlur.uniforms;
        uB.tAO.value = this.aoA.texture;
        uB.px.value.set(1 / hw, 1 / hh);
        this.draw(this.mAOBlur, this.aoB);
        const uF = this.mFog.uniforms;
        uF.frame.value = this.frame;
        uF.time.value = time;
        uF.density.value = this.density;
        this.draw(this.mFog, this.fogT);
        this.mFogBlur.uniforms.tSrc.value = this.fogT.texture;
        this.mFogBlur.uniforms.px.value.set(1 / this.fogT.width, 1 / this.fogT.height);
        this.draw(this.mFogBlur, this.fogB);
      }
    }
    // ---- what floats
    if (this.airScene) {
      this.airScale((hh * 0.9) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
      r.setClearAlpha(0);
      r.setRenderTarget(this.airT);
      r.clear();
      r.render(this.airScene, cam);
      r.setClearAlpha(1);
    }
    // ---- one resolve: all of it, onto the last frames
    const uR = this.mResolve.uniforms;
    const h0 = this.hist[this.hi], h1 = this.hist[1 - this.hi];
    const ssr = !this.lite && this.reflections > 0 && this.hadPrev;
    if (ssr) {
      const uS = this.mSSR.uniforms;
      uS.tHist.value = h0.texture;
      uS.px.value.set(1 / hw, 1 / hh);
      uS.frame.value = this.frame;
      this.draw(this.mSSR, this.ssrT);
    }
    uR.tSSR.value = this.ssrT.texture;
    uR.ssrK.value = ssr ? this.reflections : 0;
    uR.tSrc.value = src;
    uR.tHist.value = h0.texture;
    uR.tAO.value = this.aoB.texture;
    uR.tFog.value = this.fogB.texture;
    uR.tAir.value = this.airT.texture;
    uR.px.value.set(1 / W, 1 / H);
    uR.cut.value = this.cutExposure || !this.hadPrev ? 1 : 0;
    uR.jit.value.set(jx / W, jy / H);
    uR.reproj.value.copy(this.curVP).invert().premultiply(this.prevVP);
    this.draw(this.mResolve, h1);
    this.hi = 1 - this.hi;
    src = h1.texture;
    // ---- shutter blur from the camera's own motion
    if (this.motionBlur && !this.lite && this.hadPrev) {
      const u = this.mBlur.uniforms;
      u.tSrc.value = src;
      u.tDepth.value = this.scene.depthTexture;
      u.reproj.value.copy(uR.reproj.value);
      u.amount.value = Math.min(1, (1 / 90) / Math.max(dt, 1e-3));
      this.draw(this.mBlur, this.blur);
      src = this.blur.texture;
    }
    this.prevVP.copy(this.curVP);
    this.hadPrev = true;
    // ---- the downsample chain
    let s: THREE.Texture = src, sw = this.scene.width, sh = this.scene.height;
    for (const d of this.down) {
      this.mDown.uniforms.tSrc.value = s;
      this.mDown.uniforms.px.value.set(0.5 / sw, 0.5 / sh);
      this.draw(this.mDown, d);
      s = d.texture;
      sw = d.width;
      sh = d.height;
    }
    // ---- exposure
    const e0 = this.exp[this.ei], e1 = this.exp[1 - this.ei];
    this.mExp.uniforms.tSrc.value = this.down[this.down.length - 1].texture;
    this.mExp.uniforms.tFine.value = this.down[3].texture;
    this.mExp.uniforms.tPrev.value = e0.texture;
    this.mExp.uniforms.dt.value = dt;
    this.mExp.uniforms.cut.value = this.cutExposure ? 1 : 0;
    this.cutExposure = false;
    this.draw(this.mExp, e1);
    this.ei = 1 - this.ei;
    // ---- bloom back up
    let b: THREE.Texture = this.down[5].texture;
    for (let i = 4; i >= 0; i--) {
      const t = this.up[i];
      this.mUp.uniforms.tSrc.value = b;
      this.mUp.uniforms.tAdd.value = this.down[i].texture;
      this.mUp.uniforms.px.value.set(1 / t.width, 1 / t.height);
      this.mUp.uniforms.k.value = 0.9;
      this.draw(this.mUp, t);
      b = t.texture;
    }
    const f = this.mFinal.uniforms;
    f.tSrc.value = src;
    f.tBloom.value = b;
    f.tHalf.value = this.down[0].texture;
    f.tBlock.value = this.down[2].texture;
    f.tExp.value = e1.texture;
    f.time.value = time;
    f.tanHalf.value = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    this.draw(this.mFinal, null);
  }
}

function halton(i: number, b: number) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

/** the wet ground's reflection: the world drawn again from below the street, at half size */
export class Planar {
  rt: THREE.WebGLRenderTarget | null = null;
  private cam = new THREE.PerspectiveCamera();
  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private y = -0.06;
  private n = new THREE.Vector3();
  private t = new THREE.Vector3();
  private f = new THREE.Vector3();
  constructor(private r: THREE.WebGLRenderer) {
    this.black.needsUpdate = true;
    LF.planar.value = this.black;
  }
  resize(w: number, h: number) {
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(Math.round(w / 2.4), Math.round(h / 2.4), { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }
  render(scene: THREE.Scene, cam: THREE.PerspectiveCamera, hide: THREE.Object3D[], on: boolean) {
    LF.planarK.value = on ? 1 : 0;
    if (!on || !this.rt) {
      LF.planar.value = this.black;
      return;
    }
    const c = this.cam, y = this.y;
    c.fov = cam.fov;
    c.aspect = cam.aspect;
    c.near = 0.1;
    c.far = cam.far;
    c.projectionMatrix.copy(cam.projectionMatrix);
    c.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    c.position.copy(cam.position);
    c.position.y = 2 * y - c.position.y;
    this.f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.t.copy(cam.position).add(this.f);
    this.t.y = 2 * y - this.t.y;
    this.n.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.n.y = -this.n.y;
    c.up.copy(this.n);
    c.lookAt(this.t);
    c.updateMatrixWorld();
    LF.planar.value = this.black;
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const auto = this.r.shadowMap.autoUpdate;
    this.r.shadowMap.autoUpdate = false;
    this.r.setRenderTarget(this.rt);
    this.r.clear();
    this.r.render(scene, c);
    this.r.setRenderTarget(null);
    this.r.shadowMap.autoUpdate = auto;
    hide.forEach((o, i) => (o.visible = vis[i]));
    LF.planar.value = this.rt.texture;
    LF.planarVP.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  }
}
