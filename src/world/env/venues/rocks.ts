import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm2, hash2i, rng } from '../noise.ts';
import { noiseTexture } from '../textures.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import type { WorldMap } from '../worldmap.ts';

/**
 * Rock for the scenic venues: broken boulders, cliff blocks and talus, all from a few fractured
 * shapes and one stone shader.
 *
 *  - shape: a lumpy sphere cut by a handful of planes (the flat faces a rock breaks along: joints
 *    and bedding), each cut a little rough; the blocky kinds are cut along near-square planes, so a
 *    sandstone or limestone block reads as a block and a granite boulder as a rounded lump
 *  - stone: triplanar noise in world space (so neighbouring rocks never repeat), the kind's beds
 *    (sandstone's red and buff layers, limestone's bedding planes), dark crevices, lichen on the
 *    tops, desert varnish streaked down the faces, soil and dust round the foot where it sits in
 *    the ground, a bump from the same noise for the grain, wet and dark in the rain
 */

export type RockKind = 'limestone' | 'granite' | 'sandstone';

interface RockLook {
  /** two stone tones (linear), the bed colour, lichen, the foot's soil */
  a: number[];
  b: number[];
  bed: number[];
  lichen: number[];
  soil: number[];
  /** bed spacing (m) and contrast, lichen cover, varnish streaks, crevice depth */
  bedM: number;
  bedK: number;
  lichenK: number;
  varnishK: number;
  creviceK: number;
}

const LOOKS: Record<RockKind, RockLook> = {
  // Ligurian limestone: warm cream and pale grey, ochre stains, black and orange lichen near the sea
  limestone: { a: [0.42, 0.39, 0.33], b: [0.62, 0.58, 0.5], bed: [0.5, 0.42, 0.3], lichen: [0.16, 0.15, 0.12], soil: [0.2, 0.16, 0.11], bedM: 1.7, bedK: 0.18, lichenK: 0.35, varnishK: 0.25, creviceK: 0.5 },
  // alpine granite and gneiss: speckled grey, pale green-grey lichen crusts
  granite: { a: [0.2, 0.2, 0.19], b: [0.38, 0.37, 0.35], bed: [0.3, 0.3, 0.29], lichen: [0.36, 0.38, 0.3], soil: [0.12, 0.1, 0.08], bedM: 3.5, bedK: 0.05, lichenK: 0.55, varnishK: 0.1, creviceK: 0.45 },
  // Colorado Plateau sandstone: deep red-orange with paler buff beds, black-brown varnish streaks
  sandstone: { a: [0.36, 0.11, 0.045], b: [0.52, 0.21, 0.09], bed: [0.6, 0.34, 0.17], lichen: [0.24, 0.2, 0.12], soil: [0.46, 0.2, 0.09], bedM: 0.9, bedK: 0.3, lichenK: 0.12, varnishK: 0.7, creviceK: 0.55 },
};

/** a fractured rock, unit radius: `blocky` 0 (a rounded lump) … 1 (a squared-off block) */
export function rockShape(seed: number, blocky: number, detail = 3): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const r = rng(seed * 7919 + 13);
  // the cut planes: random for a lump, near the box's six faces (plus a couple of oblique ones) for a block
  const cuts: { n: THREE.Vector3; d: number; rough: number }[] = [];
  const nCuts = 5 + Math.floor(r() * 4);
  for (let k = 0; k < nCuts; k++) {
    const n = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    if (k < 6 && r() < blocky) {
      const ax = k % 3;
      const s = k < 3 ? 1 : -1;
      n.set(ax === 0 ? s : 0, ax === 1 ? s : 0, ax === 2 ? s : 0).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.35)).normalize();
    }
    cuts.push({ n, d: 0.5 + r() * 0.32 - blocky * 0.08, rough: 0.025 + r() * 0.04 });
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.22 * fbm2(v.x * 1.6 + seed, v.z * 1.6 + v.y * 1.2 - seed, 3) + 0.06 * fbm2(v.x * 4.7 - seed, v.y * 4.7 + v.z + seed, 2);
    v.multiplyScalar(n);
    for (const c of cuts) {
      const d = v.dot(c.n);
      // (a broken face isn't a mirror: a ripple of its own over the plane)
      const lim = c.d + c.rough * fbm2(v.x * 3.3 + c.d * 9, v.y * 3.3 + v.z * 2.1, 2);
      if (d > lim) v.addScaledVector(c.n, lim - d);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // recentre, sitting on y = -0.15 or so (instances are buried by their scale)
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  g.computeVertexNormals();
  return g;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** the stone shader (vertex colours and instance colours multiply in, so a Plain mesh can wear it) */
export function rockMaterial(kind: RockKind, vertexColors = false): THREE.MeshStandardMaterial {
  const key = kind + (vertexColors ? '-vc' : '');
  const hit = matCache.get(key);
  if (hit) return hit;
  const L = LOOKS[kind];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRkNoise = { value: noiseTexture() };
    sh.uniforms.uRkWet = weatherUniforms.uWetness;
    const v3 = (c: number[]) => `vec3( ${c.map((x) => x.toFixed(3)).join(', ')} )`;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkW;\nvarying vec3 vRkN;\nvarying float vRkY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 rw = vec4( transformed, 1.0 );
  vec3 rn = objectNormal;
#ifdef USE_INSTANCING
  rw = instanceMatrix * rw;
  rn = mat3( instanceMatrix ) * rn;
#endif
  vRkW = ( modelMatrix * rw ).xyz;
  vRkN = normalize( mat3( modelMatrix ) * rn );
  vRkY = transformed.y;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uRkNoise;
uniform float uRkWet;
varying vec3 vRkW;
varying vec3 vRkN;
varying float vRkY;
float rkH;
vec4 rkTri( vec3 p, vec3 w, float s ) {
  return texture2D( uRkNoise, p.yz * s ) * w.x + texture2D( uRkNoise, p.xz * s + 0.37 ) * w.y + texture2D( uRkNoise, p.xy * s + 0.71 ) * w.z;
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 N = normalize( vRkN );
  vec3 w = pow( abs( N ), vec3( 4.0 ) );
  w /= w.x + w.y + w.z;
  vec3 P = vRkW;
  vec4 n1 = rkTri( P, w, 0.031 );
  vec4 n2 = rkTri( P, w, 0.17 );
  vec4 n3 = rkTri( P, w, 0.83 );
  float camD = length( vRkW - cameraPosition );
  float nearK = 1.0 - smoothstep( 60.0, 260.0, camD );
  vec3 col = mix( ${v3(L.a)}, ${v3(L.b)}, smoothstep( 0.3, 0.72, n1.g * 0.55 + n2.r * 0.45 ) );
  // beds: bands in height, warped, each its own shade; a paler bed now and then
  float bu = P.y / ${L.bedM.toFixed(2)} + ( n1.r - 0.5 ) * 2.2 + ( n2.g - 0.5 ) * 0.5;
  float bh = fract( sin( floor( bu ) * 91.7 ) * 4375.85 );
  col = mix( col, ${v3(L.bed)}, ${L.bedK.toFixed(2)} * smoothstep( 0.55, 0.95, bh ) );
  col *= 1.0 - ${L.bedK.toFixed(2)} * 0.6 * smoothstep( 0.86, 0.98, fract( bu ) );
  // grain and speckle
  col *= 0.82 + 0.3 * n3.b + 0.1 * ( n2.b - 0.5 );
  // crevices and cracks: dark where the cellular noise dips
  float crev = 1.0 - smoothstep( 0.12, 0.34, n2.a * 0.7 + n3.a * 0.3 );
  col *= 1.0 - ${L.creviceK.toFixed(2)} * crev;
  // desert varnish / rain streaks down the faces (vertical, on the steep sides)
  float side = 1.0 - smoothstep( 0.35, 0.75, abs( N.y ) );
  float stv = texture2D( uRkNoise, vec2( ( P.x + P.z ) * 0.11, P.y * 0.012 ) ).g;
  col = mix( col, col * vec3( 0.28, 0.24, 0.22 ), ${L.varnishK.toFixed(2)} * side * smoothstep( 0.5, 0.75, stv ) );
  // lichen on the upward faces, in crusty patches
  float lich = smoothstep( 0.2, 0.7, N.y ) * smoothstep( 0.55, 0.7, n2.g * 0.6 + n3.r * 0.4 );
  col = mix( col, ${v3(L.lichen)} * ( 0.8 + 0.4 * n3.g ), ${L.lichenK.toFixed(2)} * lich );
  // dust on the tops, soil splashed up round the foot where it sits in the ground
  col = mix( col, ${v3(L.soil)} * 1.2, 0.25 * smoothstep( 0.75, 0.95, N.y ) );
  col = mix( col, ${v3(L.soil)}, 0.6 * ( 1.0 - smoothstep( -0.42, -0.12, vRkY + ( n2.b - 0.5 ) * 0.15 ) ) );
  // wet: darker, and a sheen (roughness below)
  col *= 1.0 - 0.42 * uRkWet;
  diffuseColor.rgb *= col;
  rkH = ( n2.b * 0.5 + n3.b * 0.35 + crev * -0.3 ) * nearK;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.42, uRkWet * 0.8 );')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // the grain as a bump: the height's screen-space slope tilts the normal (view space)
  vec3 vp = -vViewPosition;
  vec3 dpx = dFdx( vp ), dpy = dFdy( vp );
  vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
  float det = dot( dpx, r1 );
  vec3 grad = sign( det ) * ( dFdx( rkH ) * r1 + dFdy( rkH ) * r2 ) * 0.09;
  if ( abs( det ) > 1e-9 ) normal = normalize( abs( det ) * normal - grad );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-rock-' + key;
  matCache.set(key, mat);
  return mat;
}

export interface RockSpot {
  x: number;
  /** the base: the rock's centre sits at y + h·sink (so `sink` < 0.5 buries the foot) */
  y: number;
  z: number;
  /** size: width, height, depth (m) */
  w: number;
  h: number;
  d: number;
  /** yaw, and a lean (rad) about the rock's own x and z */
  rot: number;
  tx?: number;
  tz?: number;
  /** brightness (instance colour) */
  k?: number;
}

/**
 * One instanced draw per shape: spots are dealt round `shapes` variants (by hash) so a field of
 * hundreds never shows the same rock twice side by side.
 */
export function rockMeshes(spots: RockSpot[], kind: RockKind, name: string, opts: { blocky: number; detail?: number; shapes?: number; seed?: number; shadows?: boolean }): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const nShapes = opts.shapes ?? 4;
  const buckets: RockSpot[][] = Array.from({ length: nShapes }, () => []);
  for (const s of spots) buckets[Math.floor(hash2i(Math.floor(s.x * 3), Math.floor(s.z * 3), 311) * nShapes) % nShapes].push(s);
  const mat = rockMaterial(kind);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  buckets.forEach((list, b) => {
    if (!list.length) return;
    const geo = rockShape((opts.seed ?? 1) * 31 + b, opts.blocky, opts.detail ?? 3);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = `${name}_${b}`;
    mesh.castShadow = opts.shadows ?? true;
    mesh.receiveShadow = true;
    list.forEach((s, i) => {
      e.set(s.tx ?? 0, s.rot, s.tz ?? 0, 'YXZ');
      q.setFromEuler(e);
      v.set(s.x, s.y, s.z);
      sc.set(s.w / 2, s.h / 2, s.d / 2);
      m.compose(v, q, sc);
      mesh.setMatrixAt(i, m);
      col.setScalar(s.k ?? 1);
      mesh.setColorAt(i, col);
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

/**
 * Boulders lying on the ground round (x, z) points: each half buried, a little tilted, its long
 * axis random. `size` [min, max] metres across, skewed to the small end.
 */
export function boulders(map: WorldMap, pts: { x: number; z: number }[], size: [number, number], seed: number, k: [number, number] = [0.8, 1.15]): RockSpot[] {
  const r = rng(seed);
  return pts.map((pt) => {
    const s = size[0] + (size[1] - size[0]) * Math.pow(r(), 2.4);
    const w = s * (0.8 + r() * 0.5), d = s * (0.7 + r() * 0.5), h = s * (0.45 + r() * 0.35);
    return { x: pt.x, z: pt.z, y: map.height(pt.x, pt.z) + h * (0.18 + r() * 0.12), w, h, d, rot: r() * 6.283, tx: (r() - 0.5) * 0.35, tz: (r() - 0.5) * 0.35, k: k[0] + (k[1] - k[0]) * r() };
  });
}
