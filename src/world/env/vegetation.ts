import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import { WorldMap } from './worldmap.ts';
import { fbm2, hash2i, rng, smoothstep } from './noise.ts';

/**
 * Mediterranean vegetation: umbrella pines, cypresses, olive trees (in orchard rows),
 * palms along the promenades and the harbour, macchia shrubs.
 *
 * All procedural geometry (lumpy lat-long canopies with outward normals + tapered
 * trunks), 2–3 variants per species, 3 LODs. Two BatchedMeshes:
 *   near  — within ~450 m of the track: per-instance frustum culling, casts shadows,
 *           LOD0/LOD1 switched by camera distance every few frames
 *   far   — the hills beyond: static LOD2, no culling cost, no shadows
 * Wind sway + back-lit leaf translucency are patched into MeshStandardMaterial.
 */

export type Species = 'pine' | 'cypress' | 'olive' | 'palm' | 'shrub';

export interface VegetationBuild {
  group: THREE.Group;
  uniforms: { uTime: THREE.IUniform; uSunDir: THREE.IUniform; uSunCol: THREE.IUniform; uWind: THREE.IUniform };
  update(camera: THREE.Camera): void;
  count: number;
  nearCount: number;
}

interface Proto {
  lods: THREE.BufferGeometry[];
}

// ---------------------------------------------------------------- geometry

const PINE_LEAF = srgb(0x3b5230);
const PINE_BARK = srgb(0x6e4c3a);
const PINE_BARK_FAR = srgb(0x3f362e);
const CYP_LEAF = srgb(0x2b4121);
const OLIVE_LEAF = srgb(0x6c775a);
const OLIVE_BARK = srgb(0x5e554a);
const PALM_LEAF = srgb(0x5c7a30);
const PALM_BARK = srgb(0x8c7862);
const SHRUB_LEAF = [srgb(0x4b5e2e), srgb(0x6a6d3e), srgb(0x3d5130)];

function umbrellaPine(seed: number, lod: number): MeshBuilder {
  const r = rng(seed * 7919 + 13);
  const mb = new MeshBuilder();
  // Pinus pinea: stout, often leaning trunk (~60 % of the height), broad dense dome
  const H = 7.2 + r() * 2.2;
  const total = H + 4.2;
  const lean = (r() - 0.5) * 2.2;
  const leanZ = (r() - 0.5) * 1.6;
  const wind = (y: number) => Math.pow(Math.max(0, y / total), 2);
  const sides = lod === 0 ? 7 : lod === 1 ? 5 : 3;
  const segs = lod === 0 ? 5 : 2;
  const bark = lod === 0 ? PINE_BARK : PINE_BARK_FAR;
  const path: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const bend = Math.sin(t * Math.PI) * 0.5 * (r() - 0.5);
    path.push([lean * t * t + bend, -0.4 + t * (H + 0.4), leanZ * t * t, (lod === 2 ? 0.5 : 0.42) * (1 - t * 0.45)]);
  }
  mb.tube(path, sides, bark, wind);
  const top = path[path.length - 1];
  if (lod === 0) {
    // limbs fanning into the umbrella
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + r();
      const L = 2.4 + r() * 1.4;
      mb.tube(
        [
          [top[0], top[1] - 1.2, top[2], 0.22],
          [top[0] + Math.cos(a) * L * 0.55, top[1] + 0.3, top[2] + Math.sin(a) * L * 0.55, 0.14],
          [top[0] + Math.cos(a) * L, top[1] + 1.1, top[2] + Math.sin(a) * L, 0.08],
        ],
        4,
        bark,
        wind,
      );
    }
  }
  const cy = top[1] + 1.9;
  const R = 5.4 + r() * 1.6;
  const leaf = PINE_LEAF;
  const opts = (s: number, lumps: number) => ({ lumps, seed: s, wind, flatTop: 0.3, shade: [0.34, 1.25] as [number, number], normalUp: 0.55 });
  if (lod === 0) {
    // dense umbrella of clumps: a core dome, a ring of big clumps, small tufts on the rim
    mb.blob(top[0], cy + 0.2, top[2], R * 0.72, 2.2, R * 0.68, 16, 7, leaf, opts(seed + 0.3, 0.2));
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + r() * 0.6;
      const d = R * (0.52 + r() * 0.18);
      const rr = R * (0.36 + r() * 0.1);
      mb.blob(top[0] + Math.cos(a) * d, cy - 0.3 + r() * 0.6, top[2] + Math.sin(a) * d, rr, 1.5 + r() * 0.5, rr, 9, 5, leaf, opts(seed + k * 1.7, 0.3));
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + r() * 0.9 + 0.4;
      const d = R * (0.86 + r() * 0.12);
      const rr = R * (0.18 + r() * 0.06);
      mb.blob(top[0] + Math.cos(a) * d, cy - 0.5 + r() * 0.5, top[2] + Math.sin(a) * d, rr, 0.9, rr, 7, 4, leaf, opts(seed + k * 2.9, 0.3));
    }
  } else if (lod === 1) {
    mb.blob(top[0], cy, top[2], R * 1.12, 2.5, R * 1.05, 12, 6, leaf, opts(seed, 0.26));
  } else {
    // far: a fuller mass sitting lower on the trunk so hillsides read as forest, not lollipops
    mb.blob(top[0], cy - 1.6, top[2], R * 1.15, 3.6, R * 1.1, 7, 4, leaf, opts(seed, 0.22));
  }
  return mb;
}

function cypress(seed: number, lod: number): MeshBuilder {
  const r = rng(seed * 104729 + 7);
  const mb = new MeshBuilder();
  const H = 13 + r() * 5;
  const wind = (y: number) => Math.pow(Math.max(0, y / H), 1.6) * 0.8;
  if (lod === 0) mb.tube([[0, -0.4, 0, 0.35], [0, 1.2, 0, 0.3]], 5, PINE_BARK);
  const lon = lod === 0 ? 10 : lod === 1 ? 7 : 5;
  const lat = lod === 0 ? 10 : lod === 1 ? 6 : 4;
  // flame-shaped spindle: blob stretched, narrowed toward the tip
  const start = mb.vertexCount;
  mb.blob(0, H * 0.52, 0, 1.55 + r() * 0.35, H * 0.5, 1.5 + r() * 0.3, lon, lat, CYP_LEAF, { lumps: 0.12, seed, wind, shade: [0.5, 1.1], normalUp: 0.15 });
  for (let v = start; v < mb.vertexCount; v++) {
    const y = mb.pos[v * 3 + 1];
    const t = Math.max(0, Math.min(1, (y - 0.5) / H));
    const k = t < 0.25 ? 0.75 + t : Math.pow(1 - (t - 0.25) / 0.75, 0.7) * 1.0 + 0.02;
    mb.pos[v * 3] *= k;
    mb.pos[v * 3 + 2] *= k;
  }
  return mb;
}

function olive(seed: number, lod: number): MeshBuilder {
  const r = rng(seed * 15485863 + 3);
  const mb = new MeshBuilder();
  const H = 4.2 + r() * 1.5;
  const wind = (y: number) => Math.pow(Math.max(0, y / H), 2) * 0.7;
  const sides = lod === 0 ? 6 : 3;
  // gnarled split trunk
  const forks = lod === 0 ? 2 : 1;
  for (let k = 0; k < forks; k++) {
    const a = r() * Math.PI * 2;
    const d = forks > 1 ? 0.25 : 0;
    mb.tube(
      [
        [Math.cos(a) * d * 0.3, -0.3, Math.sin(a) * d * 0.3, 0.32],
        [Math.cos(a) * d + (r() - 0.5) * 0.4, 1.2, Math.sin(a) * d + (r() - 0.5) * 0.4, 0.24],
        [Math.cos(a) * (d + 0.7), 2.4, Math.sin(a) * (d + 0.7), 0.14],
      ],
      sides,
      OLIVE_BARK,
      wind,
    );
  }
  const cy = H * 0.72;
  if (lod === 0) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + r();
      mb.blob(Math.cos(a) * 0.9, cy + r() * 0.5, Math.sin(a) * 0.9, 1.6 + r() * 0.4, 1.2 + r() * 0.3, 1.6 + r() * 0.4, 10, 5, OLIVE_LEAF, { lumps: 0.32, seed: seed + k * 3, wind, shade: [0.45, 1.1], normalUp: 0.35 });
    }
  } else {
    mb.blob(0, cy + 0.2, 0, 2.5, 1.6, 2.5, lod === 1 ? 8 : 6, lod === 1 ? 4 : 3, OLIVE_LEAF, { lumps: 0.25, seed, wind, shade: [0.45, 1.08], normalUp: 0.35 });
  }
  return mb;
}

function palm(seed: number, lod: number): MeshBuilder {
  const r = rng(seed * 32452843 + 11);
  const mb = new MeshBuilder();
  const H = 9 + r() * 4;
  const bendX = (r() - 0.5) * 2.2;
  const wind = (y: number) => Math.pow(Math.max(0, y / H), 2.5);
  const segs = lod === 0 ? 8 : 3;
  const path: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push([bendX * t * t, -0.3 + t * (H + 0.3), 0, 0.3 - t * 0.1 + (i === 0 ? 0.12 : 0)]);
  }
  mb.tube(path, lod === 0 ? 7 : 4, (t) => PALM_BARK.clone().multiplyScalar(0.8 + 0.3 * t), wind);
  const top = path[path.length - 1];
  const fronds = lod === 0 ? 13 : 7;
  const fl = new THREE.Color();
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + r() * 0.3;
    const up = 0.35 + r() * 0.5;
    const L = 3.6 + r() * 1.2;
    const segsF = lod === 0 ? 6 : 3;
    const dirx = Math.cos(a), dirz = Math.sin(a);
    const sx = -dirz, sz = dirx;
    const ids: number[][] = [];
    for (let i = 0; i <= segsF; i++) {
      const t = i / segsF;
      const x = top[0] + dirx * L * t;
      const z = top[2] + dirz * L * t;
      const y = top[1] + up * L * t - 2.4 * t * t * L * 0.35;
      const w = Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * 0.75 + 0.05;
      fl.copy(PALM_LEAF).multiplyScalar(0.75 + 0.35 * t);
      // V-shaped cross section (reads as leaflets from both sides)
      const droop = 0.18 * w;
      const row = [
        mb.vertex(x - sx * w, y - droop, z - sz * w, 0, 1, 0, fl, wind(y), 1),
        mb.vertex(x, y + 0.04, z, 0, 1, 0, fl, wind(y), 1),
        mb.vertex(x + sx * w, y - droop, z + sz * w, 0, 1, 0, fl, wind(y), 1),
      ];
      ids.push(row);
    }
    for (let i = 0; i < segsF; i++) {
      const a0 = ids[i], a1 = ids[i + 1];
      // both faces
      mb.idx.push(a0[0], a1[0], a0[1], a0[1], a1[0], a1[1], a0[1], a1[1], a0[2], a0[2], a1[1], a1[2]);
      mb.idx.push(a0[0], a0[1], a1[0], a0[1], a1[1], a1[0], a0[1], a0[2], a1[1], a0[2], a1[2], a1[1]);
    }
  }
  if (lod === 0) mb.blob(top[0], top[1] - 0.2, top[2], 0.55, 0.6, 0.55, 6, 3, PALM_BARK.clone().multiplyScalar(0.7), { lumps: 0.2, seed, wind });
  return mb;
}

function shrub(seed: number, lod: number): MeshBuilder {
  const r = rng(seed * 49979687 + 5);
  const mb = new MeshBuilder();
  const c = SHRUB_LEAF[seed % SHRUB_LEAF.length];
  const wind = (y: number) => Math.max(0, y / 2) * 0.35;
  if (lod === 0) {
    mb.blob(0, 0.55, 0, 1.3 + r() * 0.4, 0.9, 1.2 + r() * 0.4, 9, 4, c, { lumps: 0.3, seed, wind, shade: [0.55, 1.1], normalUp: 0.5 });
    mb.blob(0.9, 0.4, 0.5, 0.9, 0.7, 0.9, 7, 3, c, { lumps: 0.3, seed: seed + 1, wind, shade: [0.55, 1.1], normalUp: 0.5 });
  } else {
    mb.blob(0.3, 0.5, 0.2, 1.7, 0.9, 1.5, 6, 3, c, { lumps: 0.25, seed, wind, shade: [0.55, 1.1], normalUp: 0.5 });
  }
  return mb;
}

const MAKERS: Record<Species, (seed: number, lod: number) => MeshBuilder> = {
  pine: umbrellaPine,
  cypress,
  olive,
  palm,
  shrub,
};
const VARIANTS: Record<Species, number> = { pine: 3, cypress: 2, olive: 2, palm: 2, shrub: 3 };

// ---------------------------------------------------------------- material

function vegMaterial(uniforms: VegetationBuild['uniforms'], depth = false): THREE.Material {
  const mat = depth
    ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aWind;
attribute float aLeaf;
uniform float uTime;
uniform vec2 uWind;
varying float vLeaf;
varying vec3 vVegW;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  #ifdef USE_BATCHING
    mat4 bm = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
  #else
    mat4 bm = mat4( 1.0 );
  #endif
  vec3 ip = bm[ 3 ].xyz;
  float ph = dot( ip.xz, vec2( 0.071, 0.053 ) );
  float gust = 0.6 + 0.4 * sin( uTime * 0.37 + ip.x * 0.004 );
  float sway = ( sin( uTime * 1.25 + ph ) * 0.7 + sin( uTime * 2.9 + ph * 1.7 ) * 0.3 ) * gust;
  float flutter = sin( uTime * 7.0 + position.x * 3.1 + position.z * 2.3 + ph ) * 0.05 * aLeaf;
  vec3 wd = vec3( uWind.x, 0.0, uWind.y ) * ( sway * 0.45 * aWind ) + vec3( flutter, flutter * 0.4, flutter * 0.7 ) * aWind;
  float s2 = max( dot( bm[ 0 ].xyz, bm[ 0 ].xyz ), 1e-4 );
  transformed += ( transpose( mat3( bm ) ) * wd ) / s2;
  vLeaf = aLeaf;
  vVegW = ( bm * vec4( transformed, 1.0 ) ).xyz;
}`,
      );
    if (!depth) {
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uSunDir;
uniform vec3 uSunCol;
varying float vLeaf;
varying vec3 vVegW;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  // light shining through the needles when the sun is behind the canopy
  vec3 V = normalize( cameraPosition - vVegW );
  float back = pow( max( dot( -V, uSunDir ), 0.0 ), 6.0 );
  totalEmissiveRadiance += diffuseColor.rgb * uSunCol * ( back * 0.22 + 0.015 ) * vLeaf;
}`,
        );
    }
  };
  mat.customProgramCacheKey = () => (depth ? 'apex-veg-depth' : 'apex-veg');
  return mat;
}

// ---------------------------------------------------------------- placement

interface Inst {
  sp: Species;
  v: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
  col: THREE.Color;
}

export interface VegOptions {
  /** explicit palm lines (world points, spacing handled by caller) */
  palms: { x: number; z: number }[];
  /** cypress rows */
  cypresses: { x: number; z: number }[];
}

export function buildVegetation(map: WorldMap, opts: VegOptions): VegetationBuild {
  const { SQUARE } = map;
  const r = rng(424242);
  const near: Inst[] = [];
  const far: Inst[] = [];

  const ok = (x: number, z: number, clearance: number, minH = 1.2) => {
    if (x < SQUARE.x0 + 40 || x > SQUARE.x1 - 40 || z < SQUARE.z0 + 40 || z > SQUARE.z1 - 40) return false;
    const h = map.height(x, z);
    if (h < minH) return false;
    if (map.excluded(x, z, 2)) return false;
    if (map.trackClearance(x, z) < clearance) return false;
    return true;
  };
  const push = (sp: Species, x: number, z: number, scale: number, colJitter: number, farOnly = false) => {
    const y = map.height(x, z);
    const slopeY = map.slope(x, z, 2);
    if (slopeY < 0.72 && sp !== 'shrub') return;
    const d = map.distToTrack(x, z);
    const v = Math.floor(r() * VARIANTS[sp]);
    const c = new THREE.Color();
    const j = (r() - 0.5) * colJitter;
    c.setRGB(1 + j + (r() - 0.5) * 0.05, 1 + j, 1 + j - (r() - 0.5) * 0.06);
    const inst: Inst = { sp, v, x, y: y - 0.05, z, rot: r() * Math.PI * 2, s: scale, col: c };
    // near set (culled per instance, shadows, LOD0/1) only close to the track
    if (!farOnly && d < 330) near.push(inst);
    else far.push(inst);
  };

  // pines: jittered grid, forest density; denser + bigger on hills, sparse far out
  {
    const C = 13;
    for (let z = SQUARE.z0 + 60; z < SQUARE.z1 - 60; z += C)
      for (let x = SQUARE.x0 + 60; x < SQUARE.x1 - 60; x += C) {
        const hx = hash2i(Math.floor(x / C), Math.floor(z / C), 1);
        const hz = hash2i(Math.floor(x / C), Math.floor(z / C), 2);
        const px = x + (hx - 0.5) * C * 0.9;
        const pz = z + (hz - 0.5) * C * 0.9;
        const f = map.forest(px, pz);
        if (f < 0.05) continue;
        const d = map.distToTrack(px, pz);
        // far away only the canopy mass matters: thin it out
        const keep = d < 470 ? 0.62 : d < 1300 ? 0.2 : 0.08;
        if (hash2i(Math.floor(px), Math.floor(pz), 3) > f * keep) continue;
        if (!ok(px, pz, 12, 2.5)) continue;
        const sc = (d < 470 ? 0.85 : 1.05) + hash2i(Math.floor(px), Math.floor(pz), 4) * 0.45;
        push('pine', px, pz, d < 1300 ? sc : sc * 1.35, 0.22);
      }
  }
  // lone pines on open ground near the track (silhouettes against the sky)
  for (let k = 0; k < 900; k++) {
    const x = SQUARE.x0 + 1800 + r() * 2600;
    const z = SQUARE.z0 + 1600 + r() * 3000;
    if (map.distToTrack(x, z) > 380) continue;
    if (map.town(x, z) > 0.2) continue;
    if (!ok(x, z, 12, 2.5)) continue;
    push('pine', x, z, 0.95 + r() * 0.4, 0.2);
  }
  // olive orchards: rows in noise-masked patches
  {
    const C = 8.5;
    for (let z = SQUARE.z0 + 60; z < SQUARE.z1 - 60; z += C)
      for (let x = SQUARE.x0 + 60; x < SQUARE.x1 - 60; x += C) {
        const d = map.distToTrack(x, z);
        if (d > 1600) continue;
        const grove = fbm2(x / 380 + 3.3, z / 380 - 8.1, 3) * 0.5 + 0.5;
        if (grove < 0.6) continue;
        if (map.forest(x, z) > 0.35 || map.town(x, z) > 0.15) continue;
        const px = x + (hash2i(Math.floor(x), Math.floor(z), 5) - 0.5) * 1.2;
        const pz = z + (hash2i(Math.floor(x), Math.floor(z), 6) - 0.5) * 1.2;
        if (hash2i(Math.floor(x), Math.floor(z), 7) < 0.12) continue; // gaps
        if (d > 470 && hash2i(Math.floor(x), Math.floor(z), 8) > 0.45) continue;
        // keep orchards off the seafront so the sea stays visible from the track
        if (map.coastExact(px, pz).dc < 240) continue;
        if (!ok(px, pz, 22, 3)) continue;
        push('olive', px, pz, 0.85 + hash2i(Math.floor(x), Math.floor(z), 9) * 0.35, 0.15);
      }
  }
  // shrubs (macchia) scattered on open land + forest edges
  {
    const C = 11;
    for (let z = SQUARE.z0 + 60; z < SQUARE.z1 - 60; z += C)
      for (let x = SQUARE.x0 + 60; x < SQUARE.x1 - 60; x += C) {
        const d = map.distToTrack(x, z);
        if (d > 1500) continue;
        const px = x + (hash2i(Math.floor(x / C), Math.floor(z / C), 11) - 0.5) * C;
        const pz = z + (hash2i(Math.floor(x / C), Math.floor(z / C), 12) - 0.5) * C;
        const f = map.forest(px, pz);
        const patch = fbm2(px / 90 - 1.1, pz / 90 + 5.5, 2) * 0.5 + 0.5;
        const p = (0.16 + 0.4 * Math.min(1, f * 2.5) * (1 - f)) * smoothstep(0.3, 0.65, patch) * (d < 470 ? 1 : 0.55);
        if (hash2i(Math.floor(px), Math.floor(pz), 13) > p) continue;
        if (map.town(px, pz) > 0.4) continue;
        if (!ok(px, pz, 7, 1.5)) continue;
        push('shrub', px, pz, 0.7 + hash2i(Math.floor(px), Math.floor(pz), 14) * 0.9, 0.25);
      }
  }
  // cypress: explicit rows + around the towns
  for (const p of opts.cypresses) if (ok(p.x, p.z, 8, 1.5)) push('cypress', p.x, p.z, 0.85 + r() * 0.3, 0.12);
  for (let k = 0; k < 2600; k++) {
    const x = SQUARE.x0 + 1500 + r() * 3600;
    const z = SQUARE.z0 + 1000 + r() * 3600;
    const t = map.town(x, z);
    if (t < 0.12 || t > 0.75) continue;
    if (!ok(x, z, 10, 2)) continue;
    push('cypress', x, z, 0.8 + r() * 0.35, 0.12);
  }
  // palms
  for (const p of opts.palms) if (ok(p.x, p.z, 6, 0.8)) push('palm', p.x, p.z, 0.85 + r() * 0.35, 0.15);

  // ---------------------------------------------------------------- batches
  const uniforms: VegetationBuild['uniforms'] = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uWind: { value: new THREE.Vector2(0.8, 0.6) },
  };
  const material = vegMaterial(uniforms);
  const depthMat = vegMaterial(uniforms, true);

  const species: Species[] = ['pine', 'cypress', 'olive', 'palm', 'shrub'];
  const protos = new Map<string, Proto>();
  for (const sp of species)
    for (let v = 0; v < VARIANTS[sp]; v++) {
      const lods: THREE.BufferGeometry[] = [];
      for (let l = 0; l < 3; l++) lods.push(MAKERS[sp](v + 1, l).geometry());
      protos.set(sp + v, { lods });
    }

  const makeBatch = (list: Inst[], lodSet: number[], name: string) => {
    let maxV = 0, maxI = 0;
    for (const p of protos.values())
      for (const l of lodSet) {
        maxV += p.lods[l].attributes.position.count;
        maxI += p.lods[l].index!.count;
      }
    const bm = new THREE.BatchedMesh(Math.max(1, list.length), maxV, maxI, material);
    bm.name = name;
    const ids = new Map<string, number>();
    for (const [key, p] of protos) for (const l of lodSet) ids.set(key + ':' + l, bm.addGeometry(p.lods[l]));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const instGeo: number[][] = [];
    for (const it of list) {
      const geos = lodSet.map((l) => ids.get(it.sp + it.v + ':' + l)!);
      const id = bm.addInstance(geos[0]);
      q.setFromAxisAngle(up, it.rot);
      sv.setScalar(it.s);
      pv.set(it.x, it.y, it.z);
      m.compose(pv, q, sv);
      bm.setMatrixAt(id, m);
      bm.setColorAt(id, it.col);
      instGeo.push(geos);
    }
    bm.computeBoundingBox();
    bm.computeBoundingSphere();
    return { bm, instGeo };
  };

  const group = new THREE.Group();
  group.name = 'Vegetation';
  const nearB = makeBatch(near, [0, 1], 'veg_near');
  nearB.bm.castShadow = true;
  nearB.bm.receiveShadow = true;
  nearB.bm.customDepthMaterial = depthMat;
  nearB.bm.sortObjects = false;
  nearB.bm.perObjectFrustumCulled = true;
  group.add(nearB.bm);
  const farB = makeBatch(far, [2], 'veg_far');
  farB.bm.castShadow = false;
  farB.bm.receiveShadow = true;
  farB.bm.sortObjects = false;
  farB.bm.perObjectFrustumCulled = false;
  group.add(farB.bm);

  // LOD switching for the near batch
  const lodNow = new Uint8Array(near.length);
  let frame = 0;
  const camPos = new THREE.Vector3();
  const LOD0 = 175 * 175;
  const update = (camera: THREE.Camera) => {
    frame++;
    if (frame % 6 !== 1) return;
    camera.getWorldPosition(camPos);
    for (let i = 0; i < near.length; i++) {
      const it = near[i];
      const dx = it.x - camPos.x, dz = it.z - camPos.z;
      const l = dx * dx + dz * dz < LOD0 ? 0 : 1;
      if (l !== lodNow[i]) {
        lodNow[i] = l;
        nearB.bm.setGeometryIdAt(i, nearB.instGeo[i][l]);
      }
    }
  };
  // start everyone at LOD1 so the first frame isn't all LOD0
  for (let i = 0; i < near.length; i++) {
    lodNow[i] = 1;
    nearB.bm.setGeometryIdAt(i, nearB.instGeo[i][1]);
  }

  return { group, uniforms, update, count: near.length + far.length, nearCount: near.length };
}
