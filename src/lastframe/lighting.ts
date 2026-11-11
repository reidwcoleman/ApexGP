import * as THREE from 'three';

/**
 * All surfaces share one lighting model, spliced into three's physical material. The world's own
 * light comes from the Cycles bake: a lightmap on the architecture, and a volume of ambient cubes
 * (six colours a cell) for everything else, so a prop or a person is lit by the room it stands in.
 * Reflections read the same cubes, and spot lights (flashlights) stay three's own.
 */

/** tiling fractal noise, 32 cells across */
function noiseTile() {
  const S = 256, C = 32;
  const lat = (n: number, seed: number) => {
    const a = new Float32Array(n * n);
    let h = seed;
    for (let i = 0; i < a.length; i++) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      a[i] = h / 4294967296;
    }
    return a;
  };
  const oct = [[C, 0.55], [C * 2, 0.3], [C * 4, 0.15]] as const;
  const grids = oct.map(([n], i) => lat(n, 91 + i * 17));
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    oct.forEach(([n, w], i) => {
      const fx = (x / S) * n, fy = (y / S) * n;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const g = grids[i];
      const at = (a: number, b: number) => g[(b % n) * n + (a % n)];
      v += w * (at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty);
    });
    const o = (y * S + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = v * 255;
    d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export const LF = {
  lm: { value: null as THREE.Texture | null },
  /** the kit's own atlas */
  lm2: { value: null as THREE.Texture | null },
  lm3: { value: null as THREE.Texture | null },
  vol: { value: null as THREE.Data3DTexture | null },
  /** the six faces averaged: what a mote of dust in that cell is lit by */
  volAvg: { value: null as THREE.Data3DTexture | null },
  /** the lamps nearest the camera: xyz, radius / rgb. The bake holds their light, not their glint */
  lampP: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -99, 0, 0)) },
  lampC: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
  /** lamps that can't make up their minds: xyz, reach / how far down they are this frame. Their light is in the bake, so it's taken away */
  flickP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -99, 0, 0)) },
  flickA: { value: [0, 0, 0, 0, 0, 0, 0, 0] },
  /** lightning in the sky: how bright, this frame */
  skyFlash: { value: 0 },
  volMin: { value: new THREE.Vector3() },
  volInv: { value: new THREE.Vector3(1, 1, 1) },
  volDim: { value: new THREE.Vector3(1, 1, 1) },
  lmK: { value: new THREE.Vector2(11, 64) },
  time: { value: 0 },
  worldLight: { value: 1 },
  /** lightning through the windows: a cold lift over everything for a blink */
  flash: { value: new THREE.Vector3() },
  planar: { value: null as THREE.Texture | null },
  planarVP: { value: new THREE.Matrix4() },
  planarK: { value: 0 },
  noise: { value: noiseTile() },
  /** 1 under open sky */
  rain: { value: 1 },
  /** a map in daylight: the sun is drawn live and the bake holds only the sky and the bounce (see sun.ts) */
  // the cove is the only sunlit location, and it's out of the rotation while every map is indoors (world.ts OUTDOOR)
  sunOn: false as boolean,
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunC: { value: new THREE.Vector3() },
  sunVP: { value: new THREE.Matrix4() },
  dynVP: { value: new THREE.Matrix4() },
  sunMap: { value: null as THREE.Texture | null },
  dynMap: { value: null as THREE.Texture | null },
  cloud: { value: new THREE.Vector2() },
  /** the sky as a picture, for anything that mirrors it */
  sky: { value: null as THREE.Texture | null },
  skyK: { value: 1 },
  /** 0 while the light volume is captured: the cubes mustn't hold the sun twice */
  disc: { value: 1 },
};

/** the sky in a direction: an equirect picture on the lightmap's log curve */
export const SKY_GLSL = /* glsl */ `
vec3 lfSky( sampler2D t, vec2 k, vec3 n ) {
  float u = atan( n.z, n.x ) / 6.2831853 + 0.5, v = asin( clamp( n.y, -1.0, 1.0 ) ) / 3.14159265 + 0.5;
  return ( exp2( texture2D( t, vec2( u, v ) ).rgb * k.x ) - 1.0 ) / k.y;
}`;

/** how much sun reaches a point, for anything with a world position */
export const SUN_GLSL = /* glsl */ `
uniform vec3 lfSunDir;
uniform vec3 lfSunC;
uniform mat4 lfSunVP;
uniform mat4 lfDynVP;
uniform highp sampler2D lfSunMap;
uniform highp sampler2D lfDynMap;
uniform vec2 lfCloud;
float lfIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
float lfCloudAt( sampler2D n, vec2 p ) {
  float c = texture2D( n, p * 0.00022 + lfCloud ).r + 0.5 * ( texture2D( n, p * 0.0009 + lfCloud * 3.0 ).r - 0.5 );
  return mix( 0.28, 1.0, smoothstep( 0.385, 0.455, c ) );
}
float lfMapVis( highp sampler2D m, vec3 s, float r, float a, float bias ) {
  vec2 d = vec2( cos( a ), sin( a ) ) * r, e = vec2( -d.y, d.x ) * 0.6;
  float z = s.z - bias, v = 0.0;
  v += step( z, texture2D( m, s.xy + d ).r );
  v += step( z, texture2D( m, s.xy - d ).r );
  v += step( z, texture2D( m, s.xy + e ).r );
  v += step( z, texture2D( m, s.xy - e ).r );
  return v * 0.25;
}
float lfInMap( vec3 s ) { return step( 0.002, min( min( s.x, s.y ), 1.0 - max( s.x, s.y ) ) ) * step( s.z, 1.0 ); }
/** the two shadow maps; noise turns the taps a little every pixel and the temporal pass averages them */
float lfSunVis( vec3 P, vec3 N, float a ) {
  vec3 q = P + N * 0.09 + lfSunDir * 0.05;
  vec3 s = ( lfSunVP * vec4( q, 1.0 ) ).xyz * 0.5 + 0.5;
  float v = 1.0;
  if ( lfInMap( s ) > 0.5 ) v = lfMapVis( lfSunMap, s, 1.5 / 4096.0, a, 0.00004 );
  vec3 t = ( lfDynVP * vec4( q, 1.0 ) ).xyz * 0.5 + 0.5;
  if ( lfInMap( t ) > 0.5 ) v *= lfMapVis( lfDynMap, t, 1.4 / 1024.0, a + 1.3, 0.0002 );
  return v;
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vLfW;
varying vec3 vLfN;
#ifdef LF_LM
attribute vec2 uvLM;
varying vec2 vLfLM;
#endif
#ifdef LF_TILE
attribute vec4 aTile;
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
    #ifdef LF_TILE
    // a kit module: its unwrap lands on this instance's own tile of the atlas (glTF stores v flipped)
    vLfLM = vec2( uvLM.x, 1.0 - uvLM.y ) * aTile.zw + aTile.xy;
    #else
    vLfLM = uvLM;
    #endif
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
uniform vec3 lfFlash;
uniform vec4 lfLampP[6];
uniform vec3 lfLampC[6];
uniform vec4 lfFlickP[8];
uniform float lfFlickA[8];
float lfFlickDim( vec3 p ) {
  float k = 1.0;
  for ( int i = 0; i < 8; i++ ) {
    float r = lfFlickP[i].w;
    if ( r <= 0.0 ) continue;
    float d = distance( p, lfFlickP[i].xyz );
    k *= 1.0 - lfFlickA[i] * ( 1.0 - smoothstep( r * 0.3, r, d ) );
  }
  return k;
}
#ifdef LF_SUN
${SUN_GLSL}
#endif
#ifdef LF_LM
varying vec2 vLfLM;
uniform sampler2D lfLM;
#endif
#ifdef LF_WET
uniform float lfWet;
uniform sampler2D lfPlanar;
uniform mat4 lfPlanarVP;
uniform float lfPlanarK;
uniform float lfRain;
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
uniform sampler2D lfNoiseT;
/** a tile of fractal noise: one lookup where it used to be a dozen sines */
float lfFbm( vec2 p ) { return texture2D( lfNoiseT, p * 0.03125 ).r; }
/** the glint of a lamp: the bake has its light, only the specular is missing */
vec3 lfGlint( vec3 P, vec3 N, vec3 V, float rough, vec3 f0 ) {
  vec3 o = vec3( 0.0 );
  float a = max( rough * rough, 0.035 );
  float a2 = a * a;
  float nv = clamp( dot( N, V ), 0.02, 1.0 );
  for ( int i = 0; i < 4; i++ ) {
    vec3 l = lfLampP[i].xyz - P;
    float d2 = dot( l, l );
    float reach = lfLampP[i].w;
    if ( d2 > reach * reach ) continue;
    l *= inversesqrt( d2 );
    vec3 h = normalize( l + V );
    float nl = clamp( dot( N, l ), 0.0, 1.0 ), nh = clamp( dot( N, h ), 0.0, 1.0 ), vh = clamp( dot( V, h ), 0.0, 1.0 );
    float dd = nh * nh * ( a2 - 1.0 ) + 1.0;
    float D = a2 / ( 3.14159 * dd * dd );
    vec3 F = f0 + ( 1.0 - f0 ) * pow( 1.0 - vh, 5.0 );
    float G = 0.25 / max( 0.05, mix( nl * nv * 4.0, 1.0, a ) );
    float fall = 1.0 - smoothstep( 0.2, 1.0, sqrt( d2 ) / reach );
    o += lfLampC[i] * ( D * G * nl * fall / ( d2 + 1.0 ) ) * F;
  }
  return min( o, vec3( 12.0 ) );
}
/** rain on standing water: rings that open and fade, a few to a cell, in two sizes */
vec2 lfRipple( vec2 p, float t ) {
  vec2 acc = vec2( 0.0 );
  for ( int k = 0; k < 2; k++ ) {
    float sc = k == 0 ? 2.1 : 3.7;
    vec2 g = p * sc + float( k ) * 5.3;
    vec2 id = floor( g );
    for ( int j = 0; j <= 1; j++ ) for ( int i = 0; i <= 1; i++ ) {
      vec2 c = id + vec2( float( i ), float( j ) ) - 0.5 * 0.0;
      float h = lfHash( c + 2.3 );
      float ph = fract( t * ( 0.8 + h * 0.5 ) + h * 7.0 );
      vec2 ctr = c + 0.5 * vec2( lfHash( c ), lfHash( c + 9.1 ) ) + 0.25 - 0.5;
      vec2 d = g - ctr;
      float r = length( d );
      float ring = sin( ( r - ph * 0.85 ) * 34.0 ) * smoothstep( 0.07, 0.0, abs( r - ph * 0.85 ) ) * ( 1.0 - ph ) * ( 1.0 - ph );
      acc += d / ( r + 1e-3 ) * ring;
    }
  }
  return acc;
}
`;

/** the world-space normal in the fragment shader (normal is in view space) */
const FRAG_LIGHT = /* glsl */ `
{
  vec3 lfNw = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 lfVw = normalize( ( vec4( geometryViewDir, 0.0 ) * viewMatrix ).xyz );
  vec3 lfR = reflect( - lfVw, lfNw );
  #ifdef LF_LM
    vec3 lfBaked = max( lfDecode( texture2D( lfLM, vLfLM ).rgb ), vec3( 0.0055, 0.0065, 0.0095 ) ) * lfFlickDim( vLfW );
    // the lightmap has no idea about the normal map. The cubes know where this spot's light comes from:
    // ask them how much more or less a bump tilted this way sees, and lean the bake on that
    vec3 lfGn = normalize( vLfN );
    vec3 lfUvw = ( vLfW + lfGn * 0.35 - lfVolMin ) * lfVolInv;
    vec3 lfX0 = lfFace( lfUvw, 0.0 ), lfX1 = lfFace( lfUvw, 1.0 ), lfY0 = lfFace( lfUvw, 2.0 ), lfY1 = lfFace( lfUvw, 3.0 ), lfZ0 = lfFace( lfUvw, 4.0 ), lfZ1 = lfFace( lfUvw, 5.0 );
    #define LF_PICK( n ) ( ( n ).x * ( n ).x * ( ( n ).x > 0.0 ? lfX0 : lfX1 ) + ( n ).y * ( n ).y * ( ( n ).y > 0.0 ? lfY0 : lfY1 ) + ( n ).z * ( n ).z * ( ( n ).z > 0.0 ? lfZ0 : lfZ1 ) )
    vec3 lfCa = LF_PICK( lfNw ) + 0.004, lfCb = LF_PICK( lfGn ) + 0.004;
    float lfRelief = clamp( dot( lfCa, vec3( 0.3, 0.6, 0.1 ) ) / dot( lfCb, vec3( 0.3, 0.6, 0.1 ) ), 0.35, 1.8 );
    lfRelief = mix( lfRelief, 1.0, 0.15 );
    irradiance += lfBaked * PI * lfRelief * lfWorldLight + lfFlash * PI * lfRelief;
    float lfLum = dot( lfBaked, vec3( 0.3, 0.6, 0.1 ) );
    vec3 lfRn = normalize( mix( lfR, lfNw, roughnessFactor * roughnessFactor ) );
    vec3 lfSpec = LF_PICK( lfRn );
    // the lightmap knows the shadows the cubes are too coarse to hold
    float lfOcc = clamp( lfLum / max( 1e-3, dot( lfSpec, vec3( 0.3, 0.6, 0.1 ) ) ), 0.2, 1.0 );
    vec3 lfRad = lfSpec * lfOcc;
    // a lamp shows in whatever it actually reaches: the bake says what that is
    float lfReach = smoothstep( 0.002, 0.05, lfLum );
    vec3 lfF0 = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
    radiance += lfGlint( vLfW, lfNw, lfVw, roughnessFactor, lfF0 ) * lfReach * lfWorldLight / RECIPROCAL_PI * 0.11;
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
    irradiance += max( lfCube( vLfW + lfNw * 0.36, lfNw ), vec3( 0.009, 0.0105, 0.014 ) ) * PI * lfWorldLight * lfFlickDim( vLfW ) + lfFlash * PI;
    radiance += lfCube( vLfW + lfNw * 0.36, lfR ) * lfWorldLight * LF_SPEC;
    #ifdef LF_PERSON
    {
      // people never sink into the black: a floor of light on them, and an edge of it where they turn away from the lens
      float lfRim = pow( 1.0 - clamp( dot( lfNw, lfVw ), 0.0, 1.0 ), 2.5 );
      irradiance += ( vec3( 0.02, 0.02, 0.021 ) + vec3( 0.06, 0.06, 0.064 ) * lfRim ) * PI;
    }
    #endif
    #ifdef LF_VIEW
    {
      // the room as seen from the gun: average light, picked up by anything turned toward the wearer
      vec3 lfAmb = lfCube( vLfW, normalize( lfVw + vec3( 0.0, 0.6, 0.0 ) ) );
      float lfFace = pow( clamp( dot( lfNw, lfVw ) * 0.6 + 0.4, 0.0, 1.0 ), 1.5 );
      irradiance += lfAmb * PI * lfFace * 0.4 + vec3( 0.006, 0.0065, 0.0075 ) * PI;
      radiance += lfAmb * 0.08 * ( 1.0 - roughnessFactor * 0.6 );
    }
    #endif
    vec3 lfF0 = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
    radiance += lfGlint( vLfW, lfNw, lfVw, roughnessFactor, lfF0 ) * lfWorldLight * LF_SPEC / RECIPROCAL_PI * 0.11;
  #endif
  #ifdef LF_SUN
  {
    float lfA = lfIGN( gl_FragCoord.xy + fract( lfTime * 7.13 ) * 67.0 ) * 6.2831853;
    float lfVis = lfSunVis( vLfW, normalize( vLfN ), lfA ) * lfCloudAt( lfNoiseT, vLfW.xz );
    if ( lfVis > 0.003 ) {
      IncidentLight lfDi;
      lfDi.direction = normalize( ( viewMatrix * vec4( lfSunDir, 0.0 ) ).xyz );
      lfDi.color = lfSunC * lfVis * lfWorldLight;
      lfDi.visible = true;
      RE_Direct( lfDi, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      #ifdef LF_LEAF
      // leaves let the sun through: lit from behind they glow
      reflectedLight.directDiffuse += diffuseColor.rgb * lfSunC * lfVis * 0.11 * ( 0.35 + pow( clamp( dot( -lfVw, lfSunDir ), 0.0, 1.0 ), 2.0 ) ) * clamp( -dot( lfNw, lfSunDir ) + 0.4, 0.0, 1.0 );
      #endif
    }
  }
  #endif
}
`;

const FRAG_GRIME = /* glsl */ `
#if defined( LF_LM ) && !defined( LF_LAND )
{
  // no wall is one colour. Big soft patches break the tile; damp climbs the foot of a wall; what the rain
  // washes off the ledges runs down in streaks
  float lfUpN = abs( vLfN.y );
  vec2 lfQ = lfUpN > 0.5 ? vLfW.xz : vec2( vLfW.x + vLfW.z, vLfW.y );
  float macro = lfFbm( lfQ * 0.17 + 3.0 );
  float fine = lfFbm( lfQ * 0.9 + 11.0 );
  #ifdef LF_OUT
  float tone = 0.86 + macro * 0.28;
  #else
  float tone = 0.74 + macro * 0.52;
  #endif
  diffuseColor.rgb *= mix( vec3( tone ), vec3( tone ) * vec3( 1.05, 0.98, 0.9 ), fine );
  #ifdef LF_OUT
  if ( lfUpN < 0.5 ) {
    // salt and weather: rain runs down from under the eaves and the sills in long faint streaks
    float run = lfFbm( vec2( ( vLfW.x + vLfW.z ) * 2.7, vLfW.y * 0.11 ) );
    diffuseColor.rgb *= 1.0 - 0.2 * smoothstep( 0.47, 0.68, run );
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.86, 0.9, 0.78 ), smoothstep( 0.5, 0.72, lfFbm( lfQ * 0.4 + 21.0 ) ) );
  } else if ( vLfN.y > 0.3 ) {
    // lichen on the slates, in rounds of pale gold
    float li = smoothstep( 0.58, 0.66, lfFbm( lfQ * 3.7 + 31.0 ) ) * smoothstep( 0.44, 0.62, lfFbm( lfQ * 0.3 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.32, 0.12 ), li * 0.4 );
  }
  #elif defined( LF_WET )
  if ( lfUpN < 0.5 ) {
    float foot = 1.0 - smoothstep( 0.05, 1.3 + macro * 1.1, vLfW.y );
    float run = lfFbm( vec2( ( vLfW.x + vLfW.z ) * 3.1, vLfW.y * 0.16 ) );
    float streak = smoothstep( 0.48, 0.7, run ) * smoothstep( 1.0, 3.2, vLfW.y );
    diffuseColor.rgb *= 1.0 - clamp( foot * 0.5 + streak * 0.34, 0.0, 0.7 );
  } else {
    // oil and tyre tracks on anything you can stand on
    diffuseColor.rgb *= 0.86 + 0.14 * smoothstep( 0.25, 0.6, lfFbm( lfQ * vec2( 0.3, 1.6 ) + 5.0 ) );
  }
  #else
  if ( lfUpN < 0.5 ) {
    // the wear a room gets from people: scuffed at hip height, dark where the wall meets the floor
    float h = fract( vLfW.y / 3.2 ) * 3.2;
    float foot = 1.0 - smoothstep( 0.0, 0.55, h );
    diffuseColor.rgb *= 1.0 - foot * 0.3 * ( 0.5 + macro );
    // a building left to itself: water from above runs brown down the walls, mould comes up from the floor
    float run = lfFbm( vec2( ( vLfW.x + vLfW.z ) * 2.3, vLfW.y * 0.12 ) + 7.0 );
    float leak = smoothstep( 0.55, 0.72, run ) * smoothstep( 0.48, 0.72, lfFbm( lfQ * 0.25 + 41.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.48, 0.34 ), leak * 0.75 );
    float mould = smoothstep( 0.58, 0.74, lfFbm( lfQ * 1.6 + 51.0 ) ) * ( 1.0 - smoothstep( 0.15, 1.3, h ) ) * smoothstep( 0.4, 0.6, macro );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.05, 0.035 ), mould * 0.6 );
  } else if ( vLfN.y > 0.5 ) {
    // floors: dust where nobody walks, grime in drifts
    float dirt = smoothstep( 0.42, 0.7, lfFbm( lfQ * 0.5 + 61.0 ) );
    diffuseColor.rgb *= 1.0 - dirt * 0.32;
  }
  #endif
}
#endif
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

/**
 * Window glass with a room behind it. No geometry: the view ray is walked into a box the size of a
 * room, and whichever wall it lands on is painted. Each window gets its own room from a hash of where it
 * is: most dark, some with a lamp on, some with the blind half down. The street's reflection goes on top.
 */
export function roomGlass() {
  return new THREE.ShaderMaterial({
    defines: LF.sunOn ? { DAY: 1 } : {},
    uniforms: { lfVol: LF.vol, lfVolMin: LF.volMin, lfVolInv: LF.volInv, lfVolDim: LF.volDim, lfK: LF.lmK, lit: { value: 1 }, tSky: LF.sky, skyK: LF.skyK },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 p = vec4( position, 1.0 );
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3( instanceMatrix ) * n;
        #endif
        vec4 w = modelMatrix * p;
        vW = w.xyz;
        vN = normalize( mat3( modelMatrix ) * n );
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      uniform highp sampler3D lfVol; uniform vec3 lfVolMin; uniform vec3 lfVolInv; uniform vec3 lfVolDim; uniform vec2 lfK;
      uniform sampler2D tSky; uniform float skyK;
      ${SKY_GLSL}
      float h1( vec2 p ) { return fract( sin( dot( p, vec2( 41.3, 289.1 ) ) ) * 43758.5453 ); }
      vec3 skyAt( vec3 p, vec3 d ) {
        vec3 uvw = ( p - lfVolMin ) * lfVolInv;
        float face = d.y > 0.0 ? 2.0 : 3.0;
        float dz = lfVolDim.z;
        float z = clamp( uvw.z * dz, 0.5, dz - 0.5 ) + face * dz;
        vec3 e = texture( lfVol, vec3( uvw.xy, z / ( dz * 6.0 ) ) ).rgb;
        return ( exp2( e * lfK.x ) - 1.0 ) / lfK.y;
      }
      void main() {
        vec3 n = normalize( vN );
        // the wall's own frame: glass always faces along an axis of the block
        vec3 r = abs( n.x ) > abs( n.z ) ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
        vec3 v = normalize( vW - cameraPosition );
        float along = dot( vW, r );
        vec2 cell = vec2( floor( along / 3.0 ), floor( vW.y / 3.0 ) );
        vec2 f = vec2( fract( along / 3.0 ), fract( vW.y / 3.0 ) );
        float seed = h1( cell + floor( dot( vW, n ) * 0.2 ) );
        vec3 d = vec3( dot( v, r ), v.y, -dot( v, n ) );
        d.z = max( d.z, 0.05 );
        vec3 size = vec3( 3.0, 3.0, 3.2 + seed * 2.0 );
        vec3 o = vec3( f * 3.0, 0.0 );
        float tx = ( d.x > 0.0 ? size.x - o.x : -o.x ) / ( abs( d.x ) < 1e-4 ? 1e-4 : d.x );
        float ty = ( d.y > 0.0 ? size.y - o.y : -o.y ) / ( abs( d.y ) < 1e-4 ? 1e-4 : d.y );
        float tz = size.z / d.z;
        float t = min( tx, min( ty, tz ) );
        vec3 hit = o + d * t;
        // what it's made of: wallpaper, a floor, a ceiling
        vec3 wallC = mix( vec3( 0.34, 0.3, 0.25 ), vec3( 0.2, 0.24, 0.26 ), h1( cell + 3.0 ) );
        vec3 c = t == ty ? ( d.y > 0.0 ? vec3( 0.42, 0.4, 0.36 ) : vec3( 0.16, 0.11, 0.08 ) ) : wallC;
        if ( t == tz && abs( hit.x - 1.5 ) < 0.8 && hit.y < 1.4 ) c *= 0.5;      // furniture against the back wall
        float on = step( 0.8, seed );
        vec3 lamp = mix( vec3( 1.0, 0.72, 0.42 ), vec3( 0.85, 0.92, 1.0 ), step( 0.93, seed ) );
        float glow = 1.6 / ( 1.0 + dot( hit - vec3( 1.5, 2.4, size.z * 0.5 ), hit - vec3( 1.5, 2.4, size.z * 0.5 ) ) * 0.16 );
        vec3 room = c * mix( vec3( 0.006, 0.007, 0.009 ), lamp * glow * 1.4, on );
        // a blind, down some of the way, and curtains drawn in from the sides
        float blind = h1( cell + 9.0 );
        float bh = 3.0 - blind * blind * 1.7;
        if ( o.y > bh ) room = mix( vec3( 0.3, 0.27, 0.22 ), lamp, 0.3 ) * ( 0.012 + on * 0.34 ) * ( 0.9 + 0.1 * sin( o.y * 90.0 ) );
        float fres = 0.05 + 0.95 * pow( 1.0 - clamp( dot( -v, n ), 0.0, 1.0 ), 4.0 );
        #ifdef DAY
        // by day a window is the sky it faces, old glass bending it a little, with a dim room behind
        vec3 rd = reflect( v, normalize( n + 0.012 * vec3( sin( vW.y * 9.0 + along * 3.0 ), 0.0, sin( along * 7.0 ) ) ) );
        rd.y = abs( rd.y ) * 0.9 + 0.02;
        float fd = 0.09 + 0.91 * pow( 1.0 - clamp( dot( -v, n ), 0.0, 1.0 ), 4.0 );
        vec3 sk = lfSky( tSky, lfK, normalize( rd ) ) * skyK;
        vec3 dim = c * ( 0.05 + 0.08 * h1( cell + 5.0 ) ) * vec3( 1.0, 0.94, 0.86 );
        // net curtains in the lower half of some
        if ( h1( cell + 2.0 ) > 0.45 && o.y < 1.7 ) dim = mix( dim, vec3( 0.34, 0.33, 0.3 ), 0.72 );
        gl_FragColor = vec4( mix( dim, sk, fd ), 1.0 );
        #else
        vec3 refl = skyAt( vW + n * 0.5, reflect( v, n ) );
        gl_FragColor = vec4( mix( room, refl * 1.1, fres ), 1.0 );
        #endif
      }`,
  });
}

export interface LfOpts {
  lightmap?: boolean;
  /** the ground's own lightmap */
  terrain?: boolean;
  wet?: number;
  /** held objects sit in shadow the coarse cubes can't see: scale what they mirror */
  spec?: number;
  /** a kit module: instanced, with a tile of the second atlas */
  tile?: boolean;
  /** what's held up to the lens: a little light off the wearer's own chest, so a dark gun isn't a hole in the picture */
  view?: number;
  /** a body or what it wears: lifted off the dark so it can be picked out */
  person?: boolean;
  /** out in the weather rather than in a room */
  outdoor?: boolean;
  /** lets the sun through from behind */
  leaf?: boolean;
}

export function applyLF<T extends THREE.MeshStandardMaterial>(m: T, o: LfOpts = {}): T {
  m.defines = { ...(m.defines ?? {}) };
  if (o.lightmap) m.defines.LF_LM = 1;
  if (o.wet) m.defines.LF_WET = 1;
  m.defines.LF_SPEC = (o.spec ?? 1).toFixed(2);
  if (o.view) m.defines.LF_VIEW = 1;
  if (o.person) m.defines.LF_PERSON = 1;
  if (o.tile) m.defines.LF_TILE = 1;
  if (o.outdoor) m.defines.LF_OUT = 1;
  if (o.terrain) m.defines.LF_LAND = 1;
  if (o.leaf) m.defines.LF_LEAF = 1;
  if (LF.sunOn) m.defines.LF_SUN = 1;
  const wet = { value: o.wet ?? 0 };
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.() ?? '';
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.uniforms.lfLM = o.terrain ? LF.lm3 : o.tile ? LF.lm2 : LF.lm;
    s.uniforms.lfVol = LF.vol;
    s.uniforms.lfVolMin = LF.volMin;
    s.uniforms.lfVolInv = LF.volInv;
    s.uniforms.lfVolDim = LF.volDim;
    s.uniforms.lfK = LF.lmK;
    s.uniforms.lfTime = LF.time;
    s.uniforms.lfWorldLight = LF.worldLight;
    s.uniforms.lfFlash = LF.flash;
    s.uniforms.lfLampP = LF.lampP;
    s.uniforms.lfLampC = LF.lampC;
    s.uniforms.lfFlickP = LF.flickP;
    s.uniforms.lfFlickA = LF.flickA;
    s.uniforms.lfRain = LF.rain;
    s.uniforms.lfNoiseT = LF.noise;
    s.uniforms.lfWet = wet;
    s.uniforms.lfPlanar = LF.planar;
    s.uniforms.lfPlanarVP = LF.planarVP;
    s.uniforms.lfPlanarK = LF.planarK;
    if (LF.sunOn) {
      s.uniforms.lfSunDir = LF.sunDir;
      s.uniforms.lfSunC = LF.sunC;
      s.uniforms.lfSunVP = LF.sunVP;
      s.uniforms.lfDynVP = LF.dynVP;
      s.uniforms.lfSunMap = LF.sunMap;
      s.uniforms.lfDynMap = LF.dynMap;
      s.uniforms.lfCloud = LF.cloud;
    }
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS);
    s.vertexShader = s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_MAIN);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
#if defined( LF_MONO ) && defined( USE_MAP )
diffuseColor.rgb = diffuse * mix( 1.0, dot( sampledDiffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) ) / LF_MONO, 0.55 );
#endif
`);
    s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat lfPuddle = 0.0;\nfloat lfPuddleK = 0.0;\n' + FRAG_GRIME + FRAG_WET);
    s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef LF_WET
normal = normalize( mix( normal, nonPerturbedNormal, lfPuddle ) );
if ( lfPuddle > 0.02 && lfRain > 0.0 ) {
  vec2 rp = lfRipple( vLfW.xz, lfTime ) * 0.5 * lfPuddle * lfRain;
  normal = normalize( normal + ( viewMatrix * vec4( rp.x, 0.0, rp.y, 0.0 ) ).xyz );
}
#endif
`);
    s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + FRAG_LIGHT);
  };
  m.customProgramCacheKey = () => `${prevKey}lf${o.lightmap ? 1 : 0}${o.wet ? 1 : 0}${o.spec ?? 1}${o.view ?? 0}${o.tile ? 1 : 0}${o.outdoor ? 1 : 0}${o.leaf ? 1 : 0}${LF.sunOn ? 1 : 0}`;
  return m;
}
