import * as THREE from 'three';
import { WORLD } from '../geo.ts';
// the flood + headlight chunks go in first (this one is appended after them)
import '../../world/weatherUniforms.ts';

/**
 * The city's street lighting after dark, as one analytic light patched into every lit material
 * (the race game's floodlights work the same way, env/night.ts): thousands of cobra-head lamps,
 * the highway masts and the neon of Ocean Drive are splatted into a light map over the whole
 * world (5 m texels): per texel the lamp irradiance (warm sodium / cool LED / neon pink) and the
 * offset to the nearest lamp, so the light comes FROM the lamp — a wet street throws back long
 * glossy streaks under each one, a car's flank catches the lamp beside it.
 *
 * Also a handful of small dynamic lights (police light bars, thruster glow, a burning car) as an
 * analytic point-light array: fixed size, so switching one on never recompiles a shader.
 */

export const CITY_TEX = 5;
const W = Math.ceil((WORLD.x1 - WORLD.x0) / CITY_TEX);
const H = Math.ceil((WORLD.z1 - WORLD.z0) / CITY_TEX);

const lightData = new Uint8Array(W * H * 4);
const dirData = new Uint8Array(W * H * 4);
const lightTex = new THREE.DataTexture(lightData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
lightTex.magFilter = THREE.LinearFilter;
lightTex.minFilter = THREE.LinearFilter;
lightTex.generateMipmaps = false;
const dirTex = new THREE.DataTexture(dirData, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
dirTex.magFilter = THREE.LinearFilter;
dirTex.minFilter = THREE.LinearFilter;
dirTex.generateMipmaps = false;

export const DYN_MAX = 8;
const dynPos = new Float32Array(DYN_MAX * 4);
const dynCol = new Float32Array(DYN_MAX * 4);

export const cityUniforms = {
  cityMap: { value: lightTex as THREE.Texture },
  cityDir: { value: dirTex as THREE.Texture },
  /** x0, z0, 1/width, 1/height of the map in world metres */
  cityRect: { value: new THREE.Vector4(WORLD.x0, WORLD.z0, 1 / (W * CITY_TEX), 1 / (H * CITY_TEX)) },
  /** x: overall level (0 by day … 1 at night), y: lamp height, z: wet gloss boost */
  cityParams: { value: new THREE.Vector4(0, 8.5, 1, 0) },
  cityWarm: { value: new THREE.Color(1.0, 0.62, 0.3) },
  cityCool: { value: new THREE.Color(0.82, 0.9, 1.0) },
  cityNeon: { value: new THREE.Color(1.0, 0.25, 0.65) },
  dynPos: { value: dynPos },
  dynCol: { value: dynCol },
};

const PARS = /* glsl */ `
uniform sampler2D cityMap;
uniform sampler2D cityDir;
uniform vec4 cityRect;
uniform vec4 cityParams;
uniform vec3 cityWarm;
uniform vec3 cityCool;
uniform vec3 cityNeon;
uniform vec4 dynPos[ ${DYN_MAX} ];
uniform vec4 dynCol[ ${DYN_MAX} ];
`;

const LIGHT = /* glsl */ `
#if defined( RE_Direct )
{
  vec3 cWp = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
  if ( cityParams.x > 0.002 ) {
    vec2 cUv = ( cWp.xz - cityRect.xy ) * cityRect.zw;
    if ( cUv.x > 0.0 && cUv.y > 0.0 && cUv.x < 1.0 && cUv.y < 1.0 ) {
      vec4 cL = texture2D( cityMap, cUv );
      float cE = cL.r + cL.g + cL.b;
      if ( cE > 0.004 ) {
        vec4 cD = texture2D( cityDir, cUv );
        vec2 off = ( cD.xy - 0.5 ) * 48.0;
        // the lamps hang at ~8.5 m over the street (the decks carry their own: cD.z = lamp base height / 40)
        float base = cD.z * 40.0;
        float h = cWp.y - base;
        float up = cityParams.y + base * 0.0 - h;
        // above the lamps nothing is lit; a roof or a deck far below them neither
        float hk = smoothstep( -1.5, 1.5, up ) * ( 1.0 - smoothstep( 9.0, 18.0, -h ) );
        if ( hk > 0.0 ) {
          vec3 toL = vec3( off.x, max( up, 0.6 ), off.y );
          IncidentLight cl;
          cl.visible = true;
          cl.direction = normalize( mat3( viewMatrix ) * toL );
          vec3 col = cityWarm * cL.r + cityCool * cL.g + cityNeon * cL.b;
          cl.color = col * ( cityParams.x * hk * 3.2 );
          RE_Direct( cl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          // the light bounced off the pavement and the walls round it
          #if defined( RE_IndirectDiffuse )
          irradiance += col * ( cityParams.x * hk * 0.35 );
          #endif
        }
      }
    }
  }
  // the dynamic lights: police bars, thrusters, fires (inverse-square with a soft core)
  for ( int i = 0; i < ${DYN_MAX}; i ++ ) {
    vec4 dp = dynPos[ i ];
    vec4 dc = dynCol[ i ];
    if ( dc.w <= 0.0 ) continue;
    vec3 tL = dp.xyz - cWp;
    float d2 = dot( tL, tL );
    float r = dp.w;
    if ( d2 > r * r ) continue;
    float d = sqrt( d2 );
    float fall = 1.0 / ( 1.0 + d2 * 0.18 ) * ( 1.0 - smoothstep( r * 0.6, r, d ) );
    IncidentLight dl;
    dl.visible = true;
    dl.direction = normalize( mat3( viewMatrix ) * ( tL / max( d, 1e-3 ) ) );
    dl.color = dc.rgb * dc.w * fall;
    RE_Direct( dl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
#endif
`;

let installed = false;
export function installCityLights() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin + PARS;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin + LIGHT;
  for (const key of Object.keys(THREE.ShaderLib)) {
    const sh = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key];
    if (sh && sh.uniforms && 'directionalLights' in sh.uniforms) {
      for (const [k, v] of Object.entries(cityUniforms)) sh.uniforms[k] = v as THREE.IUniform;
    }
  }
}
installCityLights();

// ------------------------------------------------------------------------ the lamps

export interface Lamp {
  x: number;
  z: number;
  /** ground under it (decks) */
  base: number;
  /** 0 warm sodium, 1 cool LED, 2 neon */
  kind: number;
  power: number;
  radius: number;
}

/** splat every lamp into the light map: intensity per channel, and the offset to the strongest lamp */
export function bakeCityLights(lamps: Lamp[]) {
  const best = new Float32Array(W * H);
  lightData.fill(0);
  dirData.fill(128);
  const acc = new Float32Array(W * H * 3);
  for (const L of lamps) {
    const r = L.radius;
    const i0 = Math.max(0, Math.floor((L.x - r - WORLD.x0) / CITY_TEX)), i1 = Math.min(W - 1, Math.ceil((L.x + r - WORLD.x0) / CITY_TEX));
    const j0 = Math.max(0, Math.floor((L.z - r - WORLD.z0) / CITY_TEX)), j1 = Math.min(H - 1, Math.ceil((L.z + r - WORLD.z0) / CITY_TEX));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = WORLD.x0 + (i + 0.5) * CITY_TEX, z = WORLD.z0 + (j + 0.5) * CITY_TEX;
        const dx = L.x - x, dz = L.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        // a cobra head's pool: bright under the lamp, a long soft skirt
        const k = L.power / (1 + d2 / 40) * (1 - Math.sqrt(d2) / r) ** 1.5;
        const p = j * W + i;
        acc[p * 3 + L.kind] += k;
        if (k > best[p]) {
          best[p] = k;
          dirData[p * 4] = Math.max(0, Math.min(255, Math.round((dx / 48 + 0.5) * 255)));
          dirData[p * 4 + 1] = Math.max(0, Math.min(255, Math.round((dz / 48 + 0.5) * 255)));
          dirData[p * 4 + 2] = Math.max(0, Math.min(255, Math.round((L.base / 40) * 255)));
        }
      }
  }
  for (let p = 0; p < W * H; p++) {
    lightData[p * 4] = Math.min(255, Math.round(Math.sqrt(acc[p * 3]) * 160));
    lightData[p * 4 + 1] = Math.min(255, Math.round(Math.sqrt(acc[p * 3 + 1]) * 160));
    lightData[p * 4 + 2] = Math.min(255, Math.round(Math.sqrt(acc[p * 3 + 2]) * 160));
  }
  // (sqrt stored: decoded below by squaring in the shader would cost; the map is used as is — the
  // sqrt just compresses the range so the pools keep a soft skirt at 8 bits)
  lightTex.needsUpdate = true;
  dirTex.needsUpdate = true;
}

/** the city's night level 0 … 1 (from the time of day) and the wet gloss */
export function setCityNight(level: number) {
  cityUniforms.cityParams.value.x = level;
}

// ------------------------------------------------------------------------ dynamic lights

export interface DynLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  radius: number;
}

/** the frame's dynamic lights (nearest the camera first; the rest are dropped) */
export function setDynLights(list: DynLight[], cam: THREE.Vector3) {
  const sorted = list.filter((l) => l.intensity > 0).sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
  for (let i = 0; i < DYN_MAX; i++) {
    const l = sorted[i];
    if (!l) {
      dynCol[i * 4 + 3] = 0;
      continue;
    }
    dynPos[i * 4] = l.pos.x;
    dynPos[i * 4 + 1] = l.pos.y;
    dynPos[i * 4 + 2] = l.pos.z;
    dynPos[i * 4 + 3] = l.radius;
    dynCol[i * 4] = l.color.r;
    dynCol[i * 4 + 1] = l.color.g;
    dynCol[i * 4 + 2] = l.color.b;
    dynCol[i * 4 + 3] = l.intensity;
  }
}
