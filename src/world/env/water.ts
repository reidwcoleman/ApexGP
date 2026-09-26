import * as THREE from 'three';
import { tileFbm } from './noise.ts';
import { finish, heightToNormal } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Water surfaces: sea, lakes, rivers, harbour basins.
 *
 * ── API (for the track / venue agents) ──────────────────────────────────────
 *
 *   const w = buildWater({
 *     outline: [{ x, z }, …],   // closed polygon (world metres), either winding
 *     y: 1.2,                   // surface height (world y) — keep the terrain below it
 *     kind: 'sea' | 'lake' | 'river' | 'basin',   // sets waves, colour and shore foam
 *     flow?: { x, z },          // river current (m/s): the ripples drift with it
 *     deep?, shallow?: [r, g, b] (linear) — override the colours
 *     shore?: number,           // width (m) of the shallow/foam band along the outline (0 = none)
 *   });
 *   scene or group .add(w.mesh);   // one call per frame: w.update(elapsedSeconds)
 *   (or pass `elapsed` from Scenery.update; see buildWaters() for a list helper)
 *
 *   seaPolygon(p, bearing, reach?)   → outline of the half-plane of sea beyond a straight
 *                                      coast through p, the sea lying toward compass
 *                                      `bearing` (deg: 0 = north = −Z, 90 = east = +X),
 *                                      `reach` metres out (default 30 km, fades into the haze).
 *   ribbonPolygon(points, width)     → outline of a river / canal of constant width along a
 *                                      polyline.
 *
 * Shading: a PBR surface (MeshStandardMaterial) reflecting the scene's sky env map
 * with real Fresnel, two scrolling ripple normal maps + a slow swell, sun glitter
 * from the directional light (it blooms), roughness that grows with distance
 * (no sparkle aliasing), darker/glossier in rain with rain rings, a shallow
 * tint and foam along the shore. Receives shadows. 1–2 draw calls per body.
 */

export type WaterKind = 'sea' | 'lake' | 'river' | 'basin';

export interface WaterSpec {
  outline: { x: number; z: number }[];
  y: number;
  kind?: WaterKind;
  flow?: { x: number; z: number };
  deep?: [number, number, number];
  shallow?: [number, number, number];
  shore?: number;
  /**
   * optional depth map for coasts the outline doesn't follow (islands standing out of one big
   * sheet): R = water depth / `range` m over the world rect [x0, z0] … [x1, z1]; the shallow tint
   * and the foam then follow the real banks (0 depth) as well as the outline
   */
  depth?: { map: THREE.Texture; x0: number; z0: number; x1: number; z1: number; range?: number };
}

export interface Water {
  mesh: THREE.Group;
  update(elapsed: number): void;
}

const KIND: Record<WaterKind, { waves: number; deep: [number, number, number]; shallow: [number, number, number]; shore: number; scale: number }> = {
  sea: { waves: 1, deep: [0.012, 0.03, 0.04], shallow: [0.05, 0.1, 0.09], shore: 14, scale: 1 },
  lake: { waves: 0.4, deep: [0.012, 0.022, 0.02], shallow: [0.04, 0.06, 0.04], shore: 5, scale: 0.6 },
  river: { waves: 0.3, deep: [0.016, 0.026, 0.022], shallow: [0.05, 0.065, 0.045], shore: 3, scale: 0.5 },
  basin: { waves: 0.25, deep: [0.014, 0.028, 0.03], shallow: [0.03, 0.05, 0.05], shore: 0, scale: 0.45 },
};

let _ripples: THREE.DataTexture | null = null;
/** tileable ripple normals (RGB = normal x, z, y as in textures.ts heightToNormal) */
function rippleTexture(): THREE.DataTexture {
  if (_ripples) return _ripples;
  const N = 256;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      // wind ripples: stretched cells, sharp crests
      const a = tileFbm(u, v, 6, 4, 0.5, 71);
      const b = tileFbm(u * 1 + 0.3, v, 12, 3, 0.5, 72);
      h[j * N + i] = (1 - Math.abs(a)) * 0.7 + b * 0.35;
    }
  _ripples = finish(new THREE.DataTexture(heightToNormal(h, N, 3.2), N, N, THREE.RGBAFormat, THREE.UnsignedByteType), 8);
  return _ripples;
}

const DEG = Math.PI / 180;

export function seaPolygon(p: { x: number; z: number }, bearing: number, reach = 30000): { x: number; z: number }[] {
  const fx = Math.sin(bearing * DEG), fz = -Math.cos(bearing * DEG);
  const tx = -fz, tz = fx;
  const W = reach * 2;
  return [
    { x: p.x + tx * W, z: p.z + tz * W },
    { x: p.x - tx * W, z: p.z - tz * W },
    { x: p.x - tx * W + fx * reach, z: p.z - tz * W + fz * reach },
    { x: p.x + tx * W + fx * reach, z: p.z + tz * W + fz * reach },
  ];
}

export function ribbonPolygon(points: { x: number; z: number }[], width: number): { x: number; z: number }[] {
  const L: { x: number; z: number }[] = [];
  const R: { x: number; z: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    L.push({ x: points[i].x - dz * width * 0.5, z: points[i].z + dx * width * 0.5 });
    R.push({ x: points[i].x + dz * width * 0.5, z: points[i].z - dx * width * 0.5 });
  }
  return [...L, ...R.reverse()];
}

let _noDepth: THREE.DataTexture | null = null;
function makeMaterial(k: (typeof KIND)[WaterKind], deep: [number, number, number], shallow: [number, number, number], flow: { x: number; z: number }, uTime: { value: number }, depth?: WaterSpec['depth']) {
  if (!_noDepth) {
    _noDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    _noDepth.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(deep[0], deep[1], deep[2]), roughness: 0.05, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uRip: { value: rippleTexture() },
      uWTime: uTime,
      uWaves: { value: k.waves },
      uScale: { value: k.scale },
      uFlow: { value: new THREE.Vector2(flow.x, flow.z) },
      uShallow: { value: new THREE.Color(shallow[0], shallow[1], shallow[2]) },
      uDepthMap: { value: depth?.map ?? _noDepth },
      uDepthRect: { value: depth ? new THREE.Vector4(depth.x0, depth.z0, 1 / (depth.x1 - depth.x0), 1 / (depth.z1 - depth.z0)) : new THREE.Vector4(0, 0, 0, 0) },
      // depth (m) that counts as "a full shore band away" from the bank
      uDepthK: { value: depth ? (depth.range ?? 8) / 2.5 : 0 },
      uRain: weatherUniforms.uRain,
      uWind: weatherUniforms.uWind,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aShore;\nvarying float vShore;\nvarying vec3 vWP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvShore = aShore;\nvWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uRip;
uniform float uWTime, uWaves, uScale, uRain;
uniform vec2 uFlow, uWind;
uniform vec3 uShallow;
uniform sampler2D uDepthMap;
uniform vec4 uDepthRect;
uniform float uDepthK;
varying float vShore;
varying vec3 vWP;
float wh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float wDist = length( vWP - cameraPosition );
// shallow water near the shore, foam where it laps the edge
float wShore = vShore;
if ( uDepthK > 0.0 ) {
  vec2 dUv = ( vWP.xz - uDepthRect.xy ) * uDepthRect.zw;
  if ( dUv.x > 0.0 && dUv.y > 0.0 && dUv.x < 1.0 && dUv.y < 1.0 ) wShore = min( wShore, texture2D( uDepthMap, dUv ).r * uDepthK );
}
float sh = 1.0 - smoothstep( 0.0, 1.0, wShore );
diffuseColor.rgb = mix( diffuseColor.rgb, uShallow, sh * 0.8 );
float foamN = texture2D( uRip, vWP.xz * 0.07 + uWTime * 0.01 ).a;
float foam = smoothstep( 0.35, 0.0, wShore + 0.18 * sin( uWTime * 0.9 + vWP.x * 0.05 + vWP.z * 0.04 ) - 0.12 * foamN ) * step( 0.001, uWaves - 0.26 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.58, 0.58 ), foam * 0.7 );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix( 0.035, 0.16, smoothstep( 40.0, 2500.0, wDist ) ) + foam * 0.5;
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.7, uRain );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  // two ripple layers drifting with the wind (and the current), a slow swell underneath
  vec2 wv = uWind * 0.02 + uFlow * 0.08;
  vec2 p = vWP.xz / uScale;
  vec3 n1 = texture2D( uRip, p * 0.045 + wv * uWTime * 0.3 + vec2( uWTime * 0.012, uWTime * 0.007 ) ).xzy * 2.0 - 1.0;
  vec3 n2 = texture2D( uRip, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 0.13 - vec2( uWTime * 0.021, -uWTime * 0.016 ) + wv * uWTime ).xzy * 2.0 - 1.0;
  vec3 n3 = texture2D( uRip, p * 0.006 + vec2( uWTime * 0.004, 0.0 ) ).xzy * 2.0 - 1.0;
  // ripples fade with distance (they alias), the swell stays
  float fadeR = 1.0 - smoothstep( 60.0, 1400.0, wDist ) * 0.8;
  vec2 slope = ( n1.xz * 0.55 + n2.xz * 0.45 ) * fadeR * uWaves * 0.55 + n3.xz * uWaves * 0.35;
  // rain rings
  if ( uRain > 0.02 && wDist < 120.0 ) {
    vec2 rp = vWP.xz * 1.3;
    vec2 ci = floor( rp );
    vec2 cf = fract( rp ) - 0.5;
    float ph = fract( uWTime * 1.1 + wh( ci ) );
    vec2 o = cf - ( vec2( wh( ci + 3.1 ), wh( ci + 7.7 ) ) - 0.5 ) * 0.5;
    float r = length( o );
    float ring = sin( ( r - ph * 0.45 ) * 55.0 ) * smoothstep( 0.45, 0.0, r ) * ( 1.0 - ph );
    slope += o / max( r, 1e-3 ) * ring * 0.35 * uRain;
  }
  vec3 nW = normalize( vec3( slope.x, 1.0, slope.y ) );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-water-v1';
  return mat;
}

function polygonGeometry(outline: { x: number; z: number }[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.z)));
  const g = new THREE.ShapeGeometry(shape, 1);
  // ShapeGeometry lies in x/y: move to x/z at height y, facing up
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), y, pos.getY(i));
  const idx = g.index!;
  // make every triangle face up
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const ax = pos.getX(a), az = pos.getZ(a);
    const cross = (pos.getX(b) - ax) * (pos.getZ(c) - az) - (pos.getZ(b) - az) * (pos.getX(c) - ax);
    if (cross > 0) {
      idx.setX(t + 1, c);
      idx.setX(t + 2, b);
    }
  }
  g.deleteAttribute('uv');
  const n = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) n[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('aShore', new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1));
  g.computeBoundingSphere();
  return g;
}

/** a band along the outline, inside the water, carrying the shore coordinate 0 (edge) → 1 */
function shoreGeometry(outline: { x: number; z: number }[], y: number, width: number): THREE.BufferGeometry {
  // signed area → which side is inside
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    area += a.x * b.z - b.x * a.z;
  }
  const inward = area > 0 ? 1 : -1;
  const pos: number[] = [];
  const shore: number[] = [];
  const idx: number[] = [];
  const n = outline.length;
  for (let i = 0; i <= n; i++) {
    const p = outline[i % n];
    const a = outline[(i - 1 + n) % n], b = outline[(i + 1) % n];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // inward normal of the edge direction
    const nx = -dz * inward, nz = dx * inward;
    pos.push(p.x, y + 0.004, p.z, p.x + nx * width, y + 0.004, p.z + nz * width);
    shore.push(0, 1);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nn = new Float32Array(pos.length);
  for (let i = 1; i < nn.length; i += 3) nn[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildWater(spec: WaterSpec): Water {
  const kind = spec.kind ?? 'lake';
  const k = KIND[kind];
  const uTime = { value: 0 };
  const mat = makeMaterial(k, spec.deep ?? k.deep, spec.shallow ?? k.shallow, spec.flow ?? { x: 0, z: 0 }, uTime, spec.depth);
  mat.side = THREE.DoubleSide;
  const group = new THREE.Group();
  group.name = `water_${kind}`;
  const body = new THREE.Mesh(polygonGeometry(spec.outline, spec.y), mat);
  body.receiveShadow = true;
  body.name = 'water_body';
  group.add(body);
  const shoreW = spec.shore ?? k.shore;
  if (shoreW > 0) {
    const shoreMat = mat.clone();
    shoreMat.onBeforeCompile = mat.onBeforeCompile;
    shoreMat.customProgramCacheKey = mat.customProgramCacheKey;
    shoreMat.polygonOffset = true;
    shoreMat.polygonOffsetFactor = -1;
    shoreMat.polygonOffsetUnits = -2;
    const band = new THREE.Mesh(shoreGeometry(spec.outline, spec.y, shoreW), shoreMat);
    band.receiveShadow = true;
    band.name = 'water_shore';
    group.add(band);
  }
  return {
    mesh: group,
    update(elapsed) {
      uTime.value = elapsed;
    },
  };
}

/** build several bodies; one update() drives them all */
export function buildWaters(specs: WaterSpec[]): Water {
  const group = new THREE.Group();
  group.name = 'Water';
  const all = specs.map((s) => buildWater(s));
  for (const w of all) group.add(w.mesh);
  return { mesh: group, update: (t) => all.forEach((w) => w.update(t)) };
}
