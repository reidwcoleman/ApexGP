import * as THREE from 'three';

/**
 * The block's surfaces. The GLB carries flat placeholder materials named od_*; each is swapped here
 * for a physically based one built on a Poly Haven scan (CC0) at true size (UV0 is in metres), with:
 *  - no visible tiling: two offset lookups blended by a low-frequency noise (Quilez "technique 3")
 *  - the Cycles lightmap (UV1) as the indirect light, gamma-decoded; the sky's diffuse is left out where
 *    the map is present (the map already holds it, occlusion included) and the sky's reflection is
 *    occluded by the map too, so porches and alleys don't glow
 *  - weathering: grime where the bake says light is scarce (corners, under ledges), rising damp at the
 *    foot of walls, sun-faded variation across big surfaces
 * Window glass shows rooms behind it (interior mapping: ray against the room box per window bay), with
 * curtains, ceiling lights and a Fresnel reflection of the sky on top.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

export interface LightmapInfo {
  size: number;
  scale: number;
  gamma: number;
}

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
let maxAniso = 8;
export function setAnisotropy(n: number) {
  maxAniso = n;
}
function tex(file: string, srgb: boolean, repeat = true): THREE.Texture {
  const key = file + srgb;
  let t = texCache.get(key);
  if (!t) {
    t = loader.load(BASE + 'tex/' + file);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    texCache.set(key, t);
  }
  return t;
}

export const LAMPS = 24;

/** shared uniforms (time, wetness of the sand, night) */
export const U = {
  uTime: { value: 0 },
  uSea: { value: -1.5 },
  uSwash: { value: 0 },
  uNight: { value: 0 },
  /** the baked light's colour and level (1 by day; dimmed and blued at dusk) */
  uLmTint: { value: new THREE.Vector3(1.55, 1.52, 1.5) },
  uSunDir: { value: new THREE.Vector3(0.6, 0.33, 0.45).normalize() },
  /** the sun's irradiance (0 when it's down or behind cloud) */
  uSunCol: { value: new THREE.Vector3(9.18, 7.38, 5.23) },
  /** daylight from the sky, 1 on a clear afternoon */
  uSkyK: { value: 1 },
  /** how wet everything is (0..1), and how hard it's raining */
  uWet: { value: 0 },
  uRain: { value: 0 },
  /** wind strength (palms) */
  uWind: { value: 0.3 },
  /** the street lamps, shop windows and headlights nearest the camera: xyz, intensity */
  uLamps: { value: Array.from({ length: LAMPS }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uLampK: { value: 0 },
};

// ------------------------------------------------------------------------------- shader pieces
const COMMON = /* glsl */ `
#define OD_LAMPS ${LAMPS}
uniform float uTime;
uniform float uSea;
uniform float uSwash;
uniform float uNight;
uniform vec3 uLmTint;
uniform vec3 uSunCol;
uniform float uWet;
uniform float uRain;
uniform float uSkyK;
uniform vec4 uLamps[ ${LAMPS} ];
uniform float uLampK;
varying vec3 vOdWorld;
varying vec3 vOdNormalW;
float odHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float odNoise( vec2 x ) {
  vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( odHash12( i ), odHash12( i + vec2( 1, 0 ) ), f.x ), mix( odHash12( i + vec2( 0, 1 ) ), odHash12( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float odFbm( vec2 x ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 4; i ++ ) { s += a * odNoise( x ); x = x * 2.03 + 17.1; a *= 0.5; } return s; }
// texture lookups that never show their tile: two offset copies blended by a slow noise
vec4 odTex( sampler2D s, vec2 uv ) {
  float k = odNoise( uv * 0.37 );
  vec2 dx = dFdx( uv ), dy = dFdy( uv );
  float l = k * 8.0; float f = fract( l ); float ia = floor( l ); float ib = ia + 1.0;
  vec2 oa = sin( vec2( 3.0, 7.0 ) * ia ); vec2 ob = sin( vec2( 3.0, 7.0 ) * ib );
  vec4 a = textureGrad( s, uv + oa, dx, dy ); vec4 b = textureGrad( s, uv + ob, dx, dy );
  return mix( a, b, smoothstep( 0.2, 0.8, f - 0.1 * dot( a.rgb - b.rgb, vec3( 1.0 ) ) ) );
}
// light from the lamps, shop windows and headlights (warm, falling off with distance)
vec3 odLamps( vec3 p, vec3 n ) {
  vec3 e = vec3( 0.0 );
  if ( uLampK <= 0.0 ) return e;
  for ( int i = 0; i < OD_LAMPS; i ++ ) {
    vec4 l = uLamps[ i ];
    vec3 d = l.xyz - p;
    float r2 = dot( d, d );
    if ( r2 > 900.0 || l.w <= 0.0 ) continue;
    float nl = max( dot( n, d * inversesqrt( r2 ) ), 0.0 ) * 0.85 + 0.15;
    e += l.w * nl / ( r2 + 1.5 ) * ( 1.0 - smoothstep( 300.0, 900.0, r2 ) );
  }
  return e * vec3( 1.0, 0.74, 0.46 ) * uLampK;
}
// their reflections on wet and glossy ground: a glossy lobe per light (the long glints on a wet street)
vec3 odLampSpec( vec3 p, vec3 n, vec3 v, float rough ) {
  vec3 e = vec3( 0.0 );
  if ( uLampK <= 0.0 ) return e;
  float a = max( rough * rough, 0.002 );
  float sh = clamp( 2.0 / ( a * a ) - 2.0, 2.0, 4000.0 );
  for ( int i = 0; i < OD_LAMPS; i ++ ) {
    vec4 l = uLamps[ i ];
    vec3 d = l.xyz - p;
    float r2 = dot( d, d );
    if ( l.w <= 0.0 || r2 > 3600.0 ) continue;
    vec3 L = d * inversesqrt( r2 );
    vec3 H = normalize( L + v );
    float nl = max( dot( n, L ), 0.0 );
    float F = 0.04 + 0.96 * pow( 1.0 - max( dot( v, H ), 0.0 ), 5.0 );
    e += l.w * F * pow( max( dot( n, H ), 0.0 ), sh ) * ( sh + 8.0 ) * 0.0398 * nl / ( r2 + 1.0 );
  }
  return e * vec3( 1.0, 0.76, 0.5 ) * uLampK;
}
`;

interface OdOpts {
  name: string;
  diff?: string;
  nor?: string;
  rough?: string;
  /** metres per texture tile */
  tile?: number;
  roughness?: number;
  metalness?: number;
  color?: THREE.ColorRepresentation;
  normalScale?: number;
  vertexColors?: boolean;
  /** weathering amount (0 off) */
  grime?: number;
  /** 'wall' | 'ground' | 'sand' | 'far' | 'paint' | 'none' */
  kind?: string;
  side?: THREE.Side;
  alphaTest?: number;
  transparent?: boolean;
  emissive?: THREE.ColorRepresentation;
}

/** a scanned-surface material; lightmap (UV1) optional */
export function odMaterial(o: OdOpts, lm: { tex: THREE.Texture; info: LightmapInfo } | null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    name: o.name,
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    vertexColors: o.vertexColors ?? true,
    side: o.side ?? THREE.FrontSide,
    alphaTest: o.alphaTest ?? 0,
    transparent: o.transparent ?? false,
    // canvas canopies are thin shells modelled as back-to-back faces on shared vertices: smoothed
    // normals cancel out there, so they shade by their faces
    flatShading: o.name === 'od_fabric',
  });
  const tile = o.tile ?? 1;
  const rep = 1 / tile;
  if (o.diff) {
    m.map = tex(o.diff, true).clone();
    m.map.repeat.set(rep, rep);
    m.map.needsUpdate = true;
  }
  if (o.nor) {
    m.normalMap = tex(o.nor, false).clone();
    m.normalMap.repeat.set(rep, rep);
    m.normalMap.needsUpdate = true;
    const ns = o.normalScale ?? 1;
    m.normalScale.set(ns, -ns);
  }
  if (o.rough) {
    m.roughnessMap = tex(o.rough, false).clone();
    m.roughnessMap.repeat.set(rep, rep);
    m.roughnessMap.needsUpdate = true;
  }
  if (o.emissive) m.emissive.set(o.emissive);
  if (lm) {
    m.lightMap = lm.tex;
    m.lightMapIntensity = Math.PI * lm.info.scale;
  }
  const kind = o.kind ?? 'none';
  const grime = o.grime ?? 0;
  if (/paint|bikelane/.test(o.name)) {
    // markings lie a few mm over the asphalt: pull them forward in depth so they never fight it
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -4;
  }
  m.userData.od = { kind, grime };
  m.customProgramCacheKey = () => `od:${kind}:${grime > 0}:${!!lm}:${!!o.diff}:${!!o.nor}:${!!o.rough}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.uniforms.uGrime = { value: grime };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdWorld;\nvarying vec3 vOdNormalW;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 odWp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          odWp = instanceMatrix * odWp;
        #endif
        odWp = modelMatrix * odWp;
        vOdWorld = odWp.xyz;
        vOdNormalW = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    let f = sh.fragmentShader;
    // three expands #include chunks only after this hook: expand the ones patched below
    for (const c of ['map_fragment', 'normal_fragment_maps', 'roughnessmap_fragment'] as const) f = f.replace(`#include <${c}>`, THREE.ShaderChunk[c] + `\n//OD_END_${c}`);
    f = f.replace('#include <common>', '#include <common>\n' + COMMON + '\nuniform float uGrime;');
    f = f.replace('vec4 sampledDiffuseColor = texture2D( map, vMapUv );', 'vec4 sampledDiffuseColor = odTex( map, vMapUv );');
    f = f.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = odTex( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;');
    f = f.replace('vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );', 'vec4 texelRoughness = odTex( roughnessMap, vRoughnessMapUv );');
    // weathering + per-kind albedo tweaks, after the map
    let albedo = '';
    if (kind === 'wall' || kind === 'far') {
      albedo = /* glsl */ `
      {
        float h = vOdWorld.y;
        // rising damp and splash at the foot of the walls
        float damp = 1.0 - smoothstep( 0.15, 0.9 + 0.3 * odNoise( vOdWorld.xz * 0.7 + vOdWorld.y ), h );
        // streaks: vertical, slow
        float streak = odFbm( vec2( ( vOdWorld.x + vOdWorld.z ) * 1.7, h * 0.08 ) );
        float fade = odFbm( vec2( vOdWorld.x + vOdWorld.z, h ) * 0.12 );
        diffuseColor.rgb *= mix( 1.0, 0.82, damp * uGrime );
        diffuseColor.rgb *= mix( 0.94, 1.03, fade );
        diffuseColor.rgb *= 1.0 - uGrime * 0.08 * smoothstep( 0.55, 0.8, streak );
      }`;
    } else if (kind === 'grass') {
      albedo = /* glsl */ `
      {
        // a mown lawn: broad stripes from the mower, drier and lusher patches, darker under the palms' feet
        float v = odFbm( vOdWorld.xz * 0.045 );
        float dry = smoothstep( 0.45, 0.75, odFbm( vOdWorld.xz * 0.11 + 7.0 ) );
        float stripe = step( 0.5, fract( ( vOdWorld.x * 0.86 + vOdWorld.z * 0.5 ) / 3.2 ) );
        vec3 lush = vec3( 0.86, 0.95, 0.7 );
        vec3 hay = vec3( 1.1, 1.0, 0.62 );
        diffuseColor.rgb *= mix( lush, hay, dry * 0.8 );
        diffuseColor.rgb *= mix( 0.95, 1.03, stripe ) * mix( 0.8, 1.08, v );
      }`;
    } else if (kind === 'ground') {
      albedo = /* glsl */ `
      {
        float v = odFbm( vOdWorld.xz * 0.06 );
        float s = odFbm( vOdWorld.xz * 0.9 + 3.0 );
        diffuseColor.rgb *= mix( 0.86, 1.1, v );
        diffuseColor.rgb *= 1.0 - uGrime * 0.12 * smoothstep( 0.55, 0.75, s );
      }`;
    } else if (kind === 'sand') {
      albedo = /* glsl */ `
      {
        float v = odFbm( vOdWorld.xz * 0.05 );
        // Miami Beach sand is pale (quartz and shell): lift the scan toward a bright warm beige
        float sl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        diffuseColor.rgb = ( mix( vec3( sl ), diffuseColor.rgb, 0.35 ) * 0.55 + vec3( 0.36, 0.32, 0.26 ) ) * vec3( 1.2, 1.13, 0.99 );
        diffuseColor.rgb *= mix( 0.9, 1.08, v );
        // churned: trodden, darker, grainier where people walk (patches, thicker toward the water's edge)
        float trod = smoothstep( 0.45, 0.8, odFbm( vOdWorld.xz * 0.07 + 11.0 ) );
        // footprints: little dimples in loose sand, scattered in walking lines
        vec2 fc = vOdWorld.xz * vec2( 1.7, 3.1 );
        vec2 fi = floor( fc );
        float fh = odHash12( fi + floor( vOdWorld.xz * 0.05 ) * 13.0 );
        vec2 ff = fract( fc ) - 0.5 + ( vec2( odHash12( fi + 1.3 ), odHash12( fi + 7.1 ) ) - 0.5 ) * 0.4;
        float foot = step( 0.55, fh ) * ( 1.0 - smoothstep( 0.12, 0.22, length( ff * vec2( 1.0, 0.55 ) ) ) ) * trod;
        diffuseColor.rgb *= 1.0 - 0.1 * trod - 0.12 * foot;
        // wet sand: below the swash line, darker and glossy
        float wl = uSea + 0.06 + uSwash + 0.05 * odNoise( vOdWorld.xz * 0.3 );
        float wet = 1.0 - smoothstep( wl - 0.1, wl + 0.55 + 0.25 * odNoise( vOdWorld.xz * 0.11 ), vOdWorld.y );
        wet = wet * wet * ( 3.0 - 2.0 * wet );
        diffuseColor.rgb *= mix( 1.0, 0.8, wet );
        vOdWet = wet;
      }`;
    }
    if (kind === 'awning') {
      // canvas stripes: the mask picks the awning's colour (vertex colour) or the white
      albedo = 'diffuseColor.rgb = mix( vec3( 0.86, 0.85, 0.82 ) * mix( 0.92, 1.0, sampledDiffuseColor.g ), vColor.rgb * mix( 0.92, 1.0, sampledDiffuseColor.g ), step( 0.5, sampledDiffuseColor.r ) );';
    }
    f = f.replace('#include <color_fragment>', '#include <color_fragment>\n' + (kind === 'sand' ? 'float vOdWet = 0.0;\n' : '') + albedo);
    if (kind === 'awning' || o.name === 'od_fabric') {
      // canvas lets the sun through: from underneath it glows in its own colour
      f = f.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSunCol * 0.16 * smoothstep( 0.1, -0.5, normalize( vOdNormalW ).y );',
      );
    }
    if (kind === 'sand') {
      f = f.replace('//OD_END_roughnessmap_fragment', '//OD_END_roughnessmap_fragment\nroughnessFactor = mix( roughnessFactor, 0.18, vOdWet );\n//OD_WET');
    }
    // the rain: everything darkens and turns glossy; puddles collect in the low spots of the street
    // and the sidewalk (flat, mirror-like, rippled by the drops); walls get wet only near the ground
    // and in streaks
    const roughEnd = kind === 'sand' ? '//OD_WET' : '//OD_END_roughnessmap_fragment';
    if (kind === 'ground' || kind === 'grass' || kind === 'sand' || kind === 'wall' || kind === 'far') {
      const horiz = kind === 'ground' || kind === 'grass' || kind === 'sand';
      f = f.replace(
        roughEnd,
        roughEnd +
          /* glsl */ `
        float odPuddle = 0.0;
        if ( uWet > 0.0 ) {
          float up = smoothstep( 0.6, 0.9, vOdNormalW.y );
          ${horiz
            ? `float pn = odFbm( vOdWorld.xz * 0.16 ) + 0.25 * odNoise( vOdWorld.xz * 1.3 );
          odPuddle = up * smoothstep( 0.64 - 0.2 * uWet, 0.72 - 0.2 * uWet, pn ) * uWet ${kind === 'sand' ? '* 0.0' : ''};
          float wetA = uWet * ${kind === 'sand' ? '0.6' : '1.0'};`
            : `float wetA = uWet * ( 0.35 + 0.65 * max( 1.0 - smoothstep( 0.2, 2.5, vOdWorld.y ), smoothstep( 0.5, 0.75, odFbm( vec2( ( vOdWorld.x + vOdWorld.z ) * 2.3, vOdWorld.y * 0.1 ) ) ) ) );`}
          diffuseColor.rgb *= mix( 1.0, 0.6, wetA ) * mix( 1.0, 0.8, odPuddle );
          roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.22 + 0.05, wetA );
          roughnessFactor = mix( roughnessFactor, 0.025, odPuddle );
        }`,
      );
      if (horiz) {
        // puddles are flat (the asphalt's bumps drown) and ring with the falling drops
        f = f.replace(
          '//OD_END_normal_fragment_maps',
          `//OD_END_normal_fragment_maps
          if ( odPuddle > 0.0 ) {
            vec2 cell = floor( vOdWorld.xz * 1.6 );
            vec2 rip = vec2( 0.0 );
            for ( int k = 0; k < 2; k ++ ) {
              vec2 c = cell + vec2( float( k ), 0.0 );
              float ph = fract( uTime * 1.3 + odHash12( c ) );
              vec2 dv = vOdWorld.xz * 1.6 - c - vec2( odHash12( c + 3.1 ), odHash12( c + 7.7 ) );
              float rr = length( dv );
              rip += dv / max( rr, 1e-3 ) * sin( ( rr - ph ) * 40.0 ) * ( 1.0 - ph ) * smoothstep( ph + 0.15, ph, rr );
            }
            vec3 flatN = normalize( ( viewMatrix * vec4( vec3( rip.x * 0.12 * uRain, 1.0, rip.y * 0.12 * uRain ), 0.0 ) ).xyz );
            normal = normalize( mix( normal, flatN, odPuddle ) );
          }`,
        );
      }
    }
    if (kind === 'far') {
      // background facades: windows drawn from the world position (the bays are 3 m, floors 3.3 m)
      f = f.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 n = normalize( vOdNormalW );
          if ( abs( n.y ) < 0.5 ) {
            float u = abs( n.x ) > abs( n.z ) ? vOdWorld.z : vOdWorld.x;
            float h = vOdWorld.y - 0.15;
            vec2 c = vec2( u / 3.0, h / 3.3 );
            vec2 fc = fract( c ); vec2 ic = floor( c );
            float win = step( 0.22, fc.x ) * step( fc.x, 0.78 ) * step( 0.3, fc.y ) * step( fc.y, 0.82 ) * step( 1.0, ic.y );
            float r = odHash12( ic + floor( vOdWorld.xz * 0.05 ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.035, 0.04 ) + 0.03 * r, win );
            float r2 = odHash12( ic * 1.37 + 5.1 );
            totalEmissiveRadiance += win * uNight * step( 0.62, r ) * mix( vec3( 1.0, 0.72, 0.42 ), vec3( 0.9, 0.92, 1.0 ), step( 0.6, r2 ) ) * ( 0.6 + r2 );
          }
        }`,
      );
    }
    if (lm) {
      // three expands its #include chunks after this hook: expand this one here so it can be patched
      f = f.replace('#include <lights_fragment_maps>', '//OD_MAPS\n' + THREE.ShaderChunk.lights_fragment_maps);
      // decode the gamma-stored map; keep the sky's diffuse out (the map holds it); grime where light is scarce
      f = f.replace(
        'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
        `vec3 lightMapIrradiance = pow( lightMapTexel.rgb, vec3( ${lm.info.gamma.toFixed(2)} ) ) * lightMapIntensity * uLmTint + odLamps( vOdWorld + vOdNormalW * 0.05, normalize( vOdNormalW ) );
        // the bake runs short of bounce light in the street canyons: the sunlit facades across the street
        // lift what's in shade (a warm fill, strongest where the map is darkest)
        {
          float odLmL = dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) );
          float odSunL = dot( uSunCol, vec3( 0.2126, 0.7152, 0.0722 ) ) + 1e-3;
          lightMapIrradiance += uSunCol * vec3( 1.0, 0.94, 0.86 ) * 0.13 * ( 1.0 - smoothstep( 0.08, 0.5, odLmL / odSunL ) );
        }`,
      );
      f = f.replace(
        /#if defined\( USE_ENVMAP \) && defined\( ENVMAP_TYPE_CUBE_UV \)\s*\n\s*#if defined\( STANDARD \) \|\| defined\( LAMBERT \) \|\| defined\( PHONG \)\s*\n\s*iblIrradiance \+= getIBLIrradiance\( geometryNormal \);\s*\n\s*#endif\s*\n\s*#endif/,
        '',
      );
      f = f.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directSpecular += odLampSpec( vOdWorld, normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ), normalize( cameraPosition - vOdWorld ), material.roughness );`,
      );
      // specular occlusion from the map: compare with an open-sky value
      f = f.replace('radiance += iblRadiance;', 'radiance += iblRadiance * odSpecOcc;');
      f = f.replace(
        '//OD_MAPS',
        `float odSpecOcc = 1.0;
        {
          vec3 lmT = pow( texture2D( lightMap, vLightMapUv ).rgb, vec3( ${lm.info.gamma.toFixed(2)} ) ) * ${lm.info.scale.toFixed(3)};
          float l = dot( lmT, vec3( 0.2126, 0.7152, 0.0722 ) );
          odSpecOcc = smoothstep( 0.04, 0.42, l );
        }`,
      );
      if (grime > 0) {
        f = f.replace(
          '#include <lights_fragment_begin>',
          `{
            vec3 lmG = pow( texture2D( lightMap, vLightMapUv ).rgb, vec3( ${lm.info.gamma.toFixed(2)} ) ) * ${lm.info.scale.toFixed(3)};
            float occ = 1.0 - smoothstep( 0.05, 0.38, dot( lmG, vec3( 0.2126, 0.7152, 0.0722 ) ) );
            float n = odNoise( vOdWorld.xz * 2.1 + vOdWorld.y * 1.3 );
            material.diffuseColor *= 1.0 - uGrime * 0.32 * occ * ( 0.6 + 0.4 * n );
          }
          #include <lights_fragment_begin>`,
        );
      }
    }
    sh.fragmentShader = f;
  };
  return m;
}

// ------------------------------------------------------------------------------- window glass
/**
 * Interior-mapped glass. The ray from the eye through the pane continues into a room box (bays of
 * 3 m along the facade, floors of 3.15 m, 4.5 m deep) laid out in the facade's own frame, found from
 * the world normal: so every window, on every building, opens onto its own room. Each room picks
 * a wall colour, curtains (drawn to a random width), sometimes blinds, and a light (on at night).
 */
export function glassMaterial(shop: boolean): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    name: shop ? 'od_shopglass' : 'od_glass',
    color: 0x000000,
    roughness: 0.04,
    metalness: 0,
    ior: 1.52,
    specularIntensity: 1,
    vertexColors: false,
  });
  m.customProgramCacheKey = () => (shop ? 'odshop' : 'odglass');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOdWorld;\nvarying vec3 vOdNormalW;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 odWp = modelMatrix * vec4( transformed, 1.0 );
        vOdWorld = odWp.xyz;
        vOdNormalW = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON).replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 N = normalize( vOdNormalW );
        vec3 T = normalize( cross( vec3( 0.0, 1.0, 0.0 ), N ) );
        vec3 V = normalize( vOdWorld - cameraPosition );
        // facade frame: u along, v up, w into the building
        vec3 p = vec3( dot( vOdWorld, T ), vOdWorld.y, -dot( vOdWorld, N ) );
        vec3 d = vec3( dot( V, T ), V.y, -dot( V, N ) );
        float RW = ${shop ? '6.0' : '2.9'}, RH = ${shop ? '4.0' : '3.15'}, RD = ${shop ? '6.0' : '4.2'};
        float y0 = ${shop ? '0.15' : '4.45'};
        vec3 cell = vec3( floor( p.x / RW ), floor( ( p.y - y0 ) / RH ), 0.0 );
        vec3 lo = vec3( cell.x * RW, y0 + cell.y * RH, p.z - 0.001 );
        vec3 hi = vec3( lo.x + RW, lo.y + RH, p.z + RD );
        vec3 tA = ( lo - p ) / d, tB = ( hi - p ) / d;
        vec3 tM = max( tA, tB );
        float t = min( min( tM.x, tM.y ), tM.z );
        vec3 hp = p + d * t;
        float r1 = odHash12( cell.xy + floor( vOdWorld.xz / 40.0 ) * 7.0 );
        float r2 = odHash12( cell.xy * 1.7 + 3.1 );
        float r3 = odHash12( cell.yx * 2.3 + 9.7 );
        vec3 wall = mix( vec3( 0.75, 0.72, 0.66 ), vec3( 0.62, 0.70, 0.74 ), r1 );
        wall = mix( wall, vec3( 0.80, 0.66, 0.62 ), step( 0.75, r2 ) );
        vec3 col;
        vec2 q;
        float shade = 1.0;
        if ( t == tM.z ) { // back wall: a picture, a door
          q = ( hp.xy - lo.xy ) / vec2( RW, RH );
          col = wall * 0.9;
          float pic = step( 0.3, q.x ) * step( q.x, 0.6 ) * step( 0.45, q.y ) * step( q.y, 0.7 ) * step( 0.4, r3 );
          col = mix( col, vec3( 0.25 + 0.5 * r2, 0.3, 0.35 + 0.3 * r1 ), pic );
          float door = step( 0.72, q.x ) * step( q.x, 0.9 ) * step( q.y, 0.68 ) * step( r3, 0.5 );
          col = mix( col, vec3( 0.36, 0.27, 0.2 ), door );
          shade = 0.55;
        } else if ( t == tM.y ) { // floor or ceiling
          if ( d.y < 0.0 ) {
            q = vec2( hp.x - lo.x, hp.z - p.z );
            col = mix( vec3( 0.32, 0.22, 0.15 ), vec3( 0.55, 0.52, 0.48 ), step( 0.5, r1 ) );
            col *= 0.85 + 0.15 * step( 0.5, fract( q.x * 1.4 ) );
            shade = 0.75 - 0.25 * clamp( ( hp.z - p.z ) / RD, 0.0, 1.0 );
          } else {
            col = vec3( 0.86, 0.85, 0.82 );
            float lamp = 1.0 - smoothstep( 0.1, 0.35, length( vec2( ( hp.x - lo.x ) / RW - 0.5, ( hp.z - p.z ) / RD - 0.55 ) ) );
            col += lamp * uNight * vec3( 2.0, 1.6, 1.1 ) * step( ${shop ? '0.0' : '0.68'}, r3 );
            shade = 0.5;
          }
        } else { // side walls
          col = wall;
          shade = 0.7 - 0.35 * clamp( ( hp.z - p.z ) / RD, 0.0, 1.0 );
        }
        // furniture silhouette: a low block across the back half
        float depth = ( hp.z - p.z ) / RD;
        ${shop ? 'float shelf = step( 0.5, fract( hp.y * 1.6 ) ) * step( 0.6, depth ); col = mix( col, vec3( 0.5 + 0.4 * r2, 0.45, 0.4 + 0.3 * r1 ), shelf * 0.6 );' : 'float bed = step( 0.55, depth ) * step( hp.y - lo.y, 0.75 ) * step( 0.35, r2 ); col = mix( col, vec3( 0.85, 0.83, 0.8 ) * ( 0.7 + 0.3 * r3 ), bed );'}
        // daylight inside: bright near the glass, falling off with depth; the warm lights at night
        float day = ( 1.0 - uNight ) * uSkyK;
        vec3 light = day * vec3( 0.55, 0.58, 0.62 ) * shade * ${shop ? '1.4' : '1.0'};
        // who's home: a third of the flats, each in its own light (warm lamps mostly, some cool LEDs, a TV)
        float on = step( ${shop ? '0.0' : '0.68'}, r3 );
        vec3 lampC = ${shop ? 'vec3( 1.0, 0.85, 0.65 )' : 'r1 < 0.55 ? vec3( 1.0, 0.74, 0.45 ) : r1 < 0.85 ? vec3( 0.95, 0.92, 0.85 ) : vec3( 0.55, 0.68, 1.0 )'};
        light += uNight * on * lampC * ${shop ? '1.8' : '1.0'} * ( 0.5 + 0.5 * shade ) * ${shop ? '1.0' : '( 0.5 + r2 )'};
        vec3 room = col * light;
        ${
          shop
            ? ''
            : `// curtains: from both sides, a random width, lit through from the room at night
        vec2 wq = vec2( fract( p.x / RW ), fract( ( p.y - y0 ) / RH ) );
        float cw = 0.12 + 0.35 * r1;
        float curt = step( wq.x, cw ) + step( 1.0 - cw, wq.x );
        float folds = 0.75 + 0.25 * sin( wq.x * 90.0 + r2 * 6.0 );
        vec3 cc = mix( vec3( 0.92, 0.9, 0.84 ), vec3( 0.75, 0.55, 0.5 ), step( 0.7, r2 ) );
        float blinds = step( 0.82, r3 ) * step( 0.5, fract( wq.y * 22.0 ) ) * step( 0.45, wq.y );
        room = mix( room, cc * folds * ( day * 0.55 + uNight * on * 0.9 ), clamp( curt, 0.0, 1.0 ) );
        room = mix( room, vec3( 0.8, 0.79, 0.76 ) * ( day * 0.5 + uNight * 0.6 * on ), blinds );`
        }
        totalEmissiveRadiance += room;
      }`,
    );
    sh.fragmentShader = sh.fragmentShader.replace('uniform vec3 emissive;', 'uniform vec3 emissive;');
  };
  return m;
}

// ------------------------------------------------------------------------------- the material table
export const TABLE: Record<string, OdOpts> = {
  od_stucco: { name: 'od_stucco', diff: 'white_stucco_02_diff.webp', nor: 'white_stucco_02_nor.webp', rough: 'white_stucco_02_rough.webp', tile: 2.6, kind: 'wall', grime: 1, normalScale: 0.9 },
  od_trim: { name: 'od_trim', diff: 'white_plaster_02_diff.webp', nor: 'white_plaster_02_nor.webp', rough: 'white_plaster_02_rough.webp', tile: 1.8, kind: 'wall', grime: 0.7, normalScale: 0.6 },
  od_terrazzo: { name: 'od_terrazzo', diff: 'terrazzo_tiles_diff.webp', nor: 'terrazzo_tiles_nor.webp', rough: 'terrazzo_tiles_rough.webp', tile: 1.6, kind: 'ground', grime: 0.6, vertexColors: false },
  od_sidewalk: { name: 'od_sidewalk', diff: 'concrete_pavement_diff.webp', nor: 'concrete_pavement_nor.webp', rough: 'concrete_pavement_rough.webp', tile: 3.0, kind: 'ground', grime: 1, vertexColors: false },
  od_curb: { name: 'od_curb', diff: 'concrete_floor_01_diff.webp', nor: 'concrete_floor_01_nor.webp', rough: 'concrete_floor_01_rough.webp', tile: 1.5, kind: 'ground', grime: 1, vertexColors: false },
  od_roof: { name: 'od_roof', diff: 'concrete_floor_01_diff.webp', nor: 'concrete_floor_01_nor.webp', rough: 'concrete_floor_01_rough.webp', tile: 3, kind: 'ground', grime: 1, vertexColors: false },
  od_asphalt: { name: 'od_asphalt', diff: 'asphalt_02_diff.webp', nor: 'asphalt_02_nor.webp', rough: 'asphalt_02_rough.webp', tile: 3.5, kind: 'ground', grime: 0.45, vertexColors: false, color: 0xffffff },
  od_paint: { name: 'od_paint', nor: 'asphalt_02_nor.webp', rough: 'asphalt_02_rough.webp', tile: 3.5, kind: 'ground', grime: 0.4, vertexColors: true, color: 0xd8d6cf, roughness: 1 },
  od_paintyel: { name: 'od_paintyel', nor: 'asphalt_02_nor.webp', tile: 3.5, kind: 'ground', color: 0xd9a21b, roughness: 0.6 },
  od_bikelane: { name: 'od_bikelane', diff: 'asphalt_02_diff.webp', nor: 'asphalt_02_nor.webp', rough: 'asphalt_02_rough.webp', tile: 3.5, kind: 'ground', grime: 0.9, color: 0x648a6c, vertexColors: false },
  od_grass: { name: 'od_grass', diff: 'leafy_grass_diff.webp', nor: 'leafy_grass_nor.webp', rough: 'leafy_grass_rough.webp', tile: 2.2, kind: 'grass', vertexColors: false, color: 0xbcd0a6 },
  od_sand: { name: 'od_sand', diff: 'coast_sand_01_diff.webp', nor: 'coast_sand_01_nor.webp', rough: 'coast_sand_01_rough.webp', tile: 3.6, kind: 'sand', vertexColors: false, color: 0xfff4e4 },
  od_coral: { name: 'od_coral', diff: 'coral_stone_wall_diff.webp', nor: 'coral_stone_wall_nor.webp', rough: 'coral_stone_wall_rough.webp', tile: 1.6, kind: 'wall', grime: 0.5, vertexColors: false },
  od_wood: { name: 'od_wood', diff: 'weathered_planks_diff.webp', nor: 'weathered_planks_nor.webp', rough: 'weathered_planks_rough.webp', tile: 2.0, kind: 'ground', vertexColors: false },
  od_bark: { name: 'od_bark', diff: 'palm_tree_bark_diff.webp', nor: 'palm_tree_bark_nor.webp', rough: 'palm_tree_bark_rough.webp', tile: 1.0, kind: 'none', vertexColors: true },
  od_far: { name: 'od_far', diff: 'white_stucco_02_diff.webp', nor: 'white_stucco_02_nor.webp', tile: 3.0, kind: 'far', grime: 0.8, roughness: 0.9 },
  od_frame: { name: 'od_frame', roughness: 0.32, kind: 'none', metalness: 0.0 },
  od_metal: { name: 'od_metal', roughness: 0.42, metalness: 0.55, kind: 'none' },
  od_fabric: { name: 'od_fabric', roughness: 0.85, kind: 'none', color: 0xb4b2ae },
  od_rubber: { name: 'od_rubber', roughness: 0.8, kind: 'none', color: 0x111111 },
  od_interior: { name: 'od_interior', roughness: 0.9, kind: 'none', color: 0x1a1612, vertexColors: false },
  od_lamp: { name: 'od_lamp', roughness: 0.3, kind: 'none' },
  od_signal: { name: 'od_signal', roughness: 0.4, kind: 'none' },
};

// ------------------------------------------------------------------------------- downtown facades
/**
 * Tower facades drawn in the shader from the world position (the GLB carries one quad per wall):
 *  - curtain: coated glass in 1.5 m panels on 3.9 m floors, aluminium mullions, a spandrel band at each
 *    floor slab; behind the vision glass, offices (interior mapping: ceiling grid lights, carpet, desks,
 *    the core wall), some lit at night, whole floors on for the cleaners; every panel sits a hair off
 *    true, so the reflections break up panel by panel as on a real tower
 *  - ribbon: concrete (the vertex colour) with bands of windows onto offices
 *  - garage: open decks between concrete parapets, the lights on inside at night
 *  - skycondo: residential glass with slab lines, for the skyline far off
 * The tint (vertex colour) colours the glass and its reflection.
 */
export type FacadeKind = 'curtain' | 'ribbon' | 'garage' | 'skycondo';
export function facadeMaterial(kind: FacadeKind, lm: { tex: THREE.Texture; info: LightmapInfo } | null): THREE.MeshPhysicalMaterial {
  const concrete = kind === 'ribbon' || kind === 'garage';
  const m = odMaterial(
    concrete
      ? { name: 'od_' + kind, diff: 'white_plaster_02_diff.webp', nor: 'white_plaster_02_nor.webp', rough: 'white_plaster_02_rough.webp', tile: 2.2, kind: 'none', grime: 0, normalScale: 0.5, roughness: 0.9 }
      : { name: 'od_' + kind, kind: 'none', roughness: 0.06 },
    lm,
  );
  const base = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => key + ':facade:' + kind;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    let f = sh.fragmentShader;
    const decl = /* glsl */ `
      float odIsGlass = 0.0; float odMetal = 0.0; float odRough = -1.0; vec3 odRoom = vec3( 0.0 ); vec2 odPanel = vec2( 0.0 ); float odTilt = 0.0;
      // an office behind the glass: a ray into a box (bay RW wide, floor RH high, RD deep)
      vec3 odOffice( vec3 p, vec3 d, float RW, float RH, float RD, float y0, vec2 salt, out float lit ) {
        vec3 cell = vec3( floor( p.x / RW ), floor( ( p.y - y0 ) / RH ), 0.0 );
        vec3 lo = vec3( cell.x * RW, y0 + cell.y * RH, p.z - 0.001 );
        vec3 hi = vec3( lo.x + RW, lo.y + RH, p.z + RD );
        vec3 tA = ( lo - p ) / d, tB = ( hi - p ) / d;
        vec3 tM = max( tA, tB );
        float t = min( min( tM.x, tM.y ), tM.z );
        vec3 hp = p + d * t;
        float r1 = odHash12( cell.xy + salt );
        float r2 = odHash12( cell.xy * 1.7 + salt + 3.1 );
        float rf = odHash12( vec2( cell.y, salt.x ) + 0.37 );   // the floor's own
        // who's in: by room, plus whole floors at night
        lit = step( 0.55, r1 ) * step( 0.3, rf ) + step( 0.88, rf );
        lit = clamp( lit, 0.0, 1.0 );
        vec3 col;
        float depth = clamp( ( hp.z - p.z ) / RD, 0.0, 1.0 );
        if ( t == tM.y && d.y > 0.0 ) {
          // ceiling: a grid of light panels
          vec2 q = vec2( hp.x - lo.x, hp.z - p.z );
          float pan = step( 0.62, fract( q.x / 1.5 ) ) * step( 0.55, fract( q.y / 1.8 ) );
          col = vec3( 0.78, 0.78, 0.76 ) + pan * ( 0.4 + 3.2 * lit * uNight );
        } else if ( t == tM.y ) {
          col = mix( vec3( 0.26, 0.27, 0.29 ), vec3( 0.36, 0.33, 0.3 ), step( 0.5, r2 ) );
        } else if ( t == tM.z ) {
          col = mix( vec3( 0.62, 0.62, 0.6 ), vec3( 0.5, 0.55, 0.6 ), r2 );
        } else {
          col = vec3( 0.66, 0.66, 0.64 );
        }
        // desks and screens across the floor
        float rel = hp.y - lo.y;
        float desk = step( rel, 0.78 ) * step( 0.68, rel ) * step( 0.15, depth ) * step( depth, 0.75 );
        col = mix( col, vec3( 0.2, 0.2, 0.21 ), desk * 0.8 );
        float shade = 0.45 + 0.55 * ( 1.0 - depth );
        float day = ( 1.0 - uNight ) * uSkyK;
        vec3 light = day * vec3( 0.42, 0.45, 0.5 ) * shade + uNight * lit * vec3( 0.95, 0.97, 1.0 ) * ( 0.55 + 0.45 * shade ) * 1.25;
        return col * light;
      }`;
    f = f.replace('uniform float uGrime;', 'uniform float uGrime;\n' + decl);
    let body = '';
    const frame = /* glsl */ `
      vec3 N = normalize( vOdNormalW );
      vec3 T = normalize( cross( vec3( 0.0, 1.0, 0.0 ), N ) );
      vec3 Vd = normalize( vOdWorld - cameraPosition );
      vec3 p = vec3( dot( vOdWorld, T ), vOdWorld.y, -dot( vOdWorld, N ) );
      vec3 d = vec3( dot( Vd, T ), Vd.y, -dot( Vd, N ) );
      bool wall = abs( N.y ) < 0.5;
      vec2 salt = floor( vOdWorld.xz / 50.0 ) * 7.13 + floor( dot( vOdWorld.xz, N.xz ) / 3.0 );
      vec3 tint = vColor.rgb;`;
    if (kind === 'curtain') {
      body = /* glsl */ `
      ${frame}
      if ( wall ) {
        float PW = 1.5, FH = 3.9, y0 = 0.15;
        float u = p.x / PW;
        float v = ( p.y - y0 ) / FH;
        vec2 fc = vec2( fract( u ), fract( v ) );
        odPanel = vec2( floor( u ), floor( v ) ) + salt;
        float fw = fwidth( u ) * 1.2 + 0.0001;
        float mull = 1.0 - smoothstep( 0.03, 0.03 + fw, fc.x ) * smoothstep( 0.03, 0.03 + fw, 1.0 - fc.x );
        float fv = fwidth( v ) * 1.2 + 0.0001;
        float spand = 1.0 - smoothstep( 0.24, 0.24 + fv, fc.y );
        float tran = 1.0 - smoothstep( 0.012, 0.012 + fv, abs( fc.y - 0.24 ) );
        mull = max( mull, tran );
        float lit;
        vec3 room = odOffice( p, d, 4.5, FH, 9.0, y0, salt, lit );
        // the glass: a tinted coating that reflects like a dull metal; the room through it
        odIsGlass = ( 1.0 - mull ) * ( 1.0 - spand );
        float trans = 0.22 + 0.25 * dot( tint, vec3( 0.33 ) );
        // at night the lit floors show through the coating far more than by day
        odRoom = room * mix( tint, vec3( 0.9 ), uNight * 0.5 ) * 1.6 * ( trans + uNight * 0.45 ) * odIsGlass;
        // the far ones blur into the coating (no shimmer)
        odRoom *= 1.0 - smoothstep( 260.0, 700.0, length( vOdWorld - cameraPosition ) ) * ( 0.6 - uNight * 0.35 );
        vec3 glassC = tint * 0.55 + 0.05;
        vec3 spandC = tint * 0.32 + 0.03;
        vec3 metalC = vec3( 0.55, 0.57, 0.6 );
        diffuseColor.rgb = mix( mix( glassC, spandC, spand ), metalC, mull );
        odMetal = mix( mix( 0.62, 0.7, spand ), 0.85, mull );
        odRough = mix( mix( 0.035, 0.1, spand ), 0.35, mull );
        odTilt = 1.0 - mull;
      } else {
        diffuseColor.rgb = vec3( 0.3 );
      }`;
    } else if (kind === 'ribbon') {
      body = /* glsl */ `
      ${frame}
      if ( wall ) {
        float FH = 3.9, y0 = 0.15;
        float v = ( p.y - y0 ) / FH;
        float fc = fract( v );
        float fv = fwidth( v ) * 1.2 + 0.0001;
        float win = smoothstep( 0.3, 0.3 + fv, fc ) * ( 1.0 - smoothstep( 0.82, 0.82 + fv, fc ) ) * step( 1.0, floor( v ) );
        float u = p.x / 1.6;
        float fw = fwidth( u ) * 1.2 + 0.0001;
        float mull = 1.0 - smoothstep( 0.04, 0.04 + fw, fract( u ) ) * smoothstep( 0.04, 0.04 + fw, 1.0 - fract( u ) );
        float g = win * ( 1.0 - mull );
        float lit;
        vec3 room = odOffice( p, d, 4.8, FH, 8.0, y0, salt, lit );
        odIsGlass = g;
        odRoom = room * vec3( 0.75, 0.8, 0.82 ) * 0.55 * g;
        diffuseColor.rgb = mix( diffuseColor.rgb * tint, vec3( 0.08, 0.1, 0.12 ), g );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.33, 0.34 ), win * mull );
        odMetal = mix( 0.0, 0.55, g );
        odRough = mix( -1.0, 0.05, g );
        odTilt = g;
      } else {
        diffuseColor.rgb *= tint;
      }`;
    } else if (kind === 'garage') {
      body = /* glsl */ `
      ${frame}
      diffuseColor.rgb *= tint;
      if ( wall ) {
        float FH = 3.05, y0 = 0.15;
        float v = ( p.y - y0 ) / FH;
        float fc = fract( v );
        float fv = fwidth( v ) * 1.2 + 0.0001;
        float open = smoothstep( 0.38, 0.38 + fv, fc ) * ( 1.0 - smoothstep( 0.9, 0.9 + fv, fc ) );
        float u = p.x / 8.4;
        float fw = fwidth( u ) * 1.2 + 0.0001;
        float col = 1.0 - smoothstep( 0.05, 0.05 + fw, fract( u ) ) * smoothstep( 0.05, 0.05 + fw, 1.0 - fract( u ) );
        open *= 1.0 - col;
        // inside the deck: dark, a row of fluorescent tubes under the slab above at night, a car or two
        float lamp = step( 0.8, fc ) * step( 0.6, fract( p.x / 4.2 ) ) * step( fract( p.x / 4.2 ), 0.8 );
        float car = step( fc, 0.6 ) * step( 0.5, odHash12( vec2( floor( p.x / 2.6 ), floor( v ) ) + salt ) );
        vec3 inside = mix( vec3( 0.05, 0.05, 0.055 ), vec3( 0.12, 0.12, 0.14 ) * ( 0.4 + odHash12( vec2( floor( p.x / 2.6 ), floor( v ) ) ) ), car );
        diffuseColor.rgb = mix( diffuseColor.rgb, inside, open );
        odRoom = open * lamp * uNight * vec3( 1.6, 1.7, 1.6 ) + open * uNight * vec3( 0.05, 0.06, 0.06 );
      }`;
    } else {
      body = /* glsl */ `
      ${frame}
      if ( wall ) {
        float FH = 3.15, y0 = 0.15;
        float v = ( p.y - y0 ) / FH;
        float fc = fract( v );
        float fv = fwidth( v ) * 1.2 + 0.0001;
        float slab = 1.0 - smoothstep( 0.1, 0.1 + fv, fc );
        vec2 c = vec2( floor( p.x / 3.0 ), floor( v ) ) + salt;
        float r = odHash12( c );
        diffuseColor.rgb = mix( vec3( 0.12, 0.15, 0.17 ) + tint * 0.12, tint * 0.95, slab );
        odMetal = mix( 0.5, 0.0, slab );
        odRough = mix( 0.06, 0.8, slab );
        float r2 = odHash12( c * 1.31 + 7.7 );
        float r3 = odHash12( c * 0.73 + 2.9 );
        // who's home: under a third of the flats, in a colour of their own (warm lamps, cool LEDs, a TV's blue)
        vec3 lampC = r2 < 0.5 ? vec3( 1.0, 0.72, 0.42 ) : r2 < 0.8 ? vec3( 0.95, 0.9, 0.8 ) : r2 < 0.93 ? vec3( 0.75, 0.85, 1.0 ) : vec3( 0.35, 0.5, 1.0 );
        float on = step( 0.7, r ) * ( 0.35 + 0.65 * r3 );
        odRoom = ( 1.0 - slab ) * ( ( 1.0 - uNight ) * uSkyK * vec3( 0.05, 0.055, 0.06 ) * r + uNight * on * lampC * 0.75 );
        odTilt = 1.0 - slab;
        odPanel = c;
      } else {
        diffuseColor.rgb *= tint;
      }`;
    }
    f = f.replace('#include <color_fragment>', '#include <color_fragment>\n{\n' + body + '\n}');
    f = f.replace('//OD_END_roughnessmap_fragment', '//OD_END_roughnessmap_fragment\nif ( odRough >= 0.0 ) roughnessFactor = mix( roughnessFactor, odRough, 1.0 );');
    f = f.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = max( metalnessFactor, odMetal );');
    f = f.replace(
      '//OD_END_normal_fragment_maps',
      `//OD_END_normal_fragment_maps
      if ( odTilt > 0.0 ) {
        // each pane a hair off true
        vec2 tl = vec2( odHash12( odPanel * 1.31 ), odHash12( odPanel * 2.17 + 5.0 ) ) - 0.5;
        vec3 Nw = normalize( vOdNormalW );
        vec3 Tw = normalize( cross( vec3( 0.0, 1.0, 0.0 ), Nw ) );
        vec3 tiltW = ( Tw * tl.x + vec3( 0.0, 1.0, 0.0 ) * tl.y ) * 0.028 * odTilt;
        normal = normalize( normal + ( viewMatrix * vec4( tiltW, 0.0 ) ).xyz );
      }`,
    );
    f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += odRoom;');
    sh.fragmentShader = f;
  };
  m.vertexColors = true;
  m.roughness = concrete ? 0.9 : 0.06;
  m.specularIntensity = 1;
  return m;
}
