import * as THREE from 'three';

/**
 * Scanned surfaces (Poly Haven, CC0) laid over the city's own materials in world space: albedo
 * variation (divided by the texture's mean, so a material keeps its own colour), a normal map and
 * a roughness map. Projected along the surface's main axis (ground from above, walls from the
 * side), at two scales blended by low-frequency noise so the tiling doesn't show.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'palmera/tex/';

export type SurfaceName =
  | 'asphalt_02' | 'coast_sand_01' | 'concrete_floor_01' | 'concrete_pavement' | 'coral_stone_wall'
  | 'leafy_grass' | 'terrazzo_tiles' | 'weathered_planks' | 'white_plaster_02' | 'white_stucco_02' | 'palm_tree_bark';

interface Surface { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture }
const cache = new Map<SurfaceName, Surface>();
const loader = new THREE.TextureLoader();
let maxAniso = 8;
export function setDetailAnisotropy(n: number) {
  maxAniso = n;
}

function tex(file: string, srgb: boolean): THREE.Texture {
  const t = loader.load(BASE + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function surface(name: SurfaceName): Surface {
  let s = cache.get(name);
  if (!s) {
    s = { diff: tex(name + '_diff.webp', true), nor: tex(name + '_nor.webp', false), rough: tex(name + '_rough.webp', false) };
    cache.set(name, s);
  }
  return s;
}

export interface DetailOpts {
  /** metres per tile */
  scale: number;
  /** 0..1 how much of the scan's albedo variation shows */
  albedo?: number;
  /** normal strength */
  normal?: number;
  /** roughness range the rough map maps to (omit to leave roughness alone) */
  rough?: [number, number];
  /** only patch surfaces facing this way: 'all' | 'up' (ground) | 'side' (walls) */
  faces?: 'all' | 'up' | 'side';
}

let nextId = 0;

export function addDetail<M extends THREE.MeshStandardMaterial>(mat: M, name: SurfaceName, o: DetailOpts): M {
  const s = surface(name);
  const id = nextId++;
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  const faces = o.faces ?? 'all';
  const rough = o.rough;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.dDiff = { value: s.diff };
    sh.uniforms.dNor = { value: s.nor };
    sh.uniforms.dRough = { value: s.rough };
    sh.uniforms.dScale = { value: o.scale };
    sh.uniforms.dAlb = { value: o.albedo ?? 0.8 };
    sh.uniforms.dNorK = { value: o.normal ?? 1 };
    sh.uniforms.dRoughR = { value: new THREE.Vector2(rough?.[0] ?? 0, rough?.[1] ?? 1) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDW; varying vec3 vDN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 dW4 = vec4(transformed, 1.0);
vec3 dN3 = objectNormal;
#ifdef USE_INSTANCING
dW4 = instanceMatrix * dW4;
dN3 = mat3(instanceMatrix) * dN3;
#endif
vDW = (modelMatrix * dW4).xyz;
vDN = normalize(mat3(modelMatrix) * dN3);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D dDiff; uniform sampler2D dNor; uniform sampler2D dRough;
uniform float dScale; uniform float dAlb; uniform float dNorK; uniform vec2 dRoughR;
varying vec3 vDW; varying vec3 vDN;
float dHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(dHash(i), dHash(i+vec2(1,0)), f.x), mix(dHash(i+vec2(0,1)), dHash(i+vec2(1,1)), f.x), f.y); }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
vec3 dAn = abs(vDN);
vec2 dUv; vec3 dT; vec3 dB; vec3 dAx;
bool dUp = dAn.y > dAn.x && dAn.y > dAn.z;
if (dUp) { dUv = vDW.xz; dT = vec3(1.0, 0.0, 0.0); dB = vec3(0.0, 0.0, 1.0); dAx = vec3(0.0, sign(vDN.y), 0.0); }
else if (dAn.x > dAn.z) { dUv = vec2(vDW.z * sign(vDN.x), vDW.y); dT = vec3(0.0, 0.0, sign(vDN.x)); dB = vec3(0.0, 1.0, 0.0); dAx = vec3(sign(vDN.x), 0.0, 0.0); }
else { dUv = vec2(-vDW.x * sign(vDN.z), vDW.y); dT = vec3(-sign(vDN.z), 0.0, 0.0); dB = vec3(0.0, 1.0, 0.0); dAx = vec3(0.0, 0.0, sign(vDN.z)); }
float dOn = ${faces === 'up' ? 'dUp ? 1.0 : 0.0' : faces === 'side' ? 'dUp ? 0.0 : 1.0' : '1.0'};
dUv /= dScale;
vec2 dUv2 = mat2(0.8, -0.6, 0.6, 0.8) * dUv * 0.63 + vec2(0.37, 0.71);
float dW = smoothstep(0.32, 0.68, dNoise(dUv * 0.21 + 3.1));
vec3 dMean = textureLod(dDiff, vec2(0.5), 14.0).rgb;
vec3 dCol = mix(texture2D(dDiff, dUv).rgb, texture2D(dDiff, dUv2).rgb, dW) / max(dMean, vec3(0.02));
float dRo = mix(texture2D(dRough, dUv).g, texture2D(dRough, dUv2).g, dW);
vec3 dTn = mix(texture2D(dNor, dUv).xyz, texture2D(dNor, dUv2).xyz, dW) * 2.0 - 1.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), clamp(dCol, 0.0, 2.5), dAlb * dOn);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 dWn = normalize(vDN + (dT * dTn.x + dB * dTn.y) * dNorK * dOn);
  normal = normalize((viewMatrix * vec4(dWn, 0.0)).xyz);
  #ifdef DOUBLE_SIDED
  normal *= faceDirection;
  #endif
}`,
      );
    if (rough)
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, mix(dRoughR.x, dRoughR.y, dRo), dOn);`,
      );
  };
  mat.customProgramCacheKey = () => prevKey() + '|detail' + id;
  return mat;
}
