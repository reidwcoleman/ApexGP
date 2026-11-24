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

/** shared uniforms (time, wetness of the sand, night) */
export const U = {
  uTime: { value: 0 },
  uSea: { value: -1.5 },
  uSwash: { value: 0 },
  uNight: { value: 0 },
  /** the baked light's colour and level (1 by day; dimmed and blued at dusk) */
  uLmTint: { value: new THREE.Vector3(1, 1, 1) },
  uSunDir: { value: new THREE.Vector3(0.6, 0.33, 0.45).normalize() },
};

// ------------------------------------------------------------------------------- shader pieces
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uSea;
uniform float uSwash;
uniform float uNight;
uniform vec3 uLmTint;
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
        diffuseColor.rgb = ( mix( vec3( sl ), diffuseColor.rgb, 0.35 ) * 0.55 + vec3( 0.36, 0.32, 0.26 ) ) * vec3( 1.32, 1.24, 1.08 );
        diffuseColor.rgb *= mix( 0.9, 1.08, v );
        // wet sand: below the swash line, darker and glossy
        float wl = uSea + 0.06 + uSwash + 0.05 * odNoise( vOdWorld.xz * 0.3 );
        float wet = 1.0 - smoothstep( wl - 0.02, wl + 0.16, vOdWorld.y );
        diffuseColor.rgb *= mix( 1.0, 0.58, wet );
        vOdWet = wet;
      }`;
    }
    if (kind === 'awning') {
      // canvas stripes: the mask picks the awning's colour (vertex colour) or the white
      albedo = 'diffuseColor.rgb = mix( vec3( 0.86, 0.85, 0.82 ) * mix( 0.92, 1.0, sampledDiffuseColor.g ), vColor.rgb * mix( 0.92, 1.0, sampledDiffuseColor.g ), step( 0.5, sampledDiffuseColor.r ) );';
    }
    f = f.replace('#include <color_fragment>', '#include <color_fragment>\n' + (kind === 'sand' ? 'float vOdWet = 0.0;\n' : '') + albedo);
    if (kind === 'sand') {
      f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.18, vOdWet );');
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
            totalEmissiveRadiance += win * uNight * step( 0.45, r ) * vec3( 1.0, 0.75, 0.45 ) * 1.6;
          }
        }`,
      );
    }
    if (lm) {
      // decode the gamma-stored map; keep the sky's diffuse out (the map holds it); grime where light is scarce
      f = f.replace(
        'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
        `vec3 lightMapIrradiance = pow( lightMapTexel.rgb, vec3( ${lm.info.gamma.toFixed(2)} ) ) * lightMapIntensity * uLmTint;`,
      );
      f = f.replace(
        /#if defined\( USE_ENVMAP \) && defined\( ENVMAP_TYPE_CUBE_UV \)\s*\n\s*#if defined\( STANDARD \) \|\| defined\( LAMBERT \) \|\| defined\( PHONG \)\s*\n\s*iblIrradiance \+= getIBLIrradiance\( geometryNormal \);\s*\n\s*#endif\s*\n\s*#endif/,
        '',
      );
      // specular occlusion from the map: compare with an open-sky value
      f = f.replace('radiance += iblRadiance;', 'radiance += iblRadiance * odSpecOcc;');
      f = f.replace(
        '#include <lights_fragment_maps>',
        `float odSpecOcc = 1.0;
        {
          vec3 lmT = pow( texture2D( lightMap, vLightMapUv ).rgb, vec3( ${lm.info.gamma.toFixed(2)} ) ) * ${lm.info.scale.toFixed(3)};
          float l = dot( lmT, vec3( 0.2126, 0.7152, 0.0722 ) );
          odSpecOcc = smoothstep( 0.04, 0.42, l );
        }
        #include <lights_fragment_maps>`,
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
            col += lamp * uNight * vec3( 2.0, 1.6, 1.1 );
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
        float day = 1.0 - uNight;
        vec3 light = day * vec3( 0.55, 0.58, 0.62 ) * shade * ${shop ? '1.4' : '1.0'};
        float on = step( ${shop ? '0.0' : '0.35'}, r3 );
        light += uNight * on * vec3( 1.0, 0.78, 0.5 ) * ${shop ? '1.8' : '1.1'} * ( 0.5 + 0.5 * shade );
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
  od_asphalt: { name: 'od_asphalt', diff: 'asphalt_02_diff.webp', nor: 'asphalt_02_nor.webp', rough: 'asphalt_02_rough.webp', tile: 3.5, kind: 'ground', grime: 0.6, vertexColors: false, color: 0xb8b8b8 },
  od_paint: { name: 'od_paint', nor: 'asphalt_02_nor.webp', rough: 'asphalt_02_rough.webp', tile: 3.5, kind: 'ground', grime: 0.4, vertexColors: true, color: 0xd8d6cf, roughness: 1 },
  od_paintyel: { name: 'od_paintyel', nor: 'asphalt_02_nor.webp', tile: 3.5, kind: 'ground', color: 0xd9a21b, roughness: 0.6 },
  od_bikelane: { name: 'od_bikelane', nor: 'asphalt_02_nor.webp', rough: 'asphalt_02_rough.webp', tile: 3.5, kind: 'ground', grime: 0.8, color: 0x2f7a46, vertexColors: false },
  od_grass: { name: 'od_grass', diff: 'leafy_grass_diff.webp', nor: 'leafy_grass_nor.webp', rough: 'leafy_grass_rough.webp', tile: 2.2, kind: 'ground', vertexColors: false, color: 0xe6f0d6 },
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
