// Builds all static city meshes from the CityMap: ground, roads, buildings, props, bridge and docks.
import * as THREE from 'three';
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cyl, merge, prep } from '../core/geo';
import { Rng, clamp } from '../core/math';
import {
  BEACH, BRIDGE, CityMap, ISLAND, MAIN, ROAD_HALF, SIDEWALK, WATER_Y, bridgeDeckY, groundAt, groundBase, pondShape,
  type BuildingSpec, type PropSpec,
} from './map';
import * as T from './textures';
import { addDetail as D } from '../render/detail';
import { palmKit } from './palms';
import { Grass, moundGeometry, crownGeometry, leafTexture, trunkGeometry, blossomGeometry, hedgeGeometry, placePlants, shrubGeometry } from './vegetation';
import { furnitureGeometry, placeFurniture, type FurnitureKind } from './furniture';

// ------------------------------------------------------------ simple mesh builder
class MB {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
    // a-b-c-d counter clockwise when seen from the front
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const [p, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]] as [number[], number[]][]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(u[0], u[1]);
    }
  }
  /** horizontal rectangle facing up, world-space uv scaled by rep */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, rep: number) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0 / rep, -z1 / rep], [x1 / rep, -z1 / rep], [x1 / rep, -z0 / rep], [x0 / rep, -z0 / rep]);
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------ chunking
interface Chunk {
  mesh: THREE.Object3D;
  lod?: THREE.Object3D;
  x: number;
  z: number;
  r: number;
  far: number;
  lodDist: number;
}

export class ChunkManager {
  chunks: Chunk[] = [];
  update(cam: THREE.Vector3) {
    for (const c of this.chunks) {
      const d = Math.hypot(cam.x - c.x, cam.z - c.z) - c.r;
      const vis = d < c.far;
      if (c.lod) {
        const near = d < c.lodDist;
        c.mesh.visible = vis && near;
        c.lod.visible = vis && !near;
      } else c.mesh.visible = vis;
    }
  }
}

interface Inst {
  m: THREE.Matrix4;
  c?: THREE.Color;
  a?: number[];
}

const CHUNK = 280;

function chunked(
  scene: THREE.Scene, cm: ChunkManager, items: Inst[], geo: THREE.BufferGeometry, mat: THREE.Material,
  opt: { far: number; shadow?: boolean; receive?: boolean; lodGeo?: THREE.BufferGeometry; lodDist?: number; attr?: { name: string; size: number } },
) {
  const buckets = new Map<string, Inst[]>();
  const v = new THREE.Vector3();
  for (const it of items) {
    v.setFromMatrixPosition(it.m);
    const k = `${Math.floor(v.x / CHUNK)},${Math.floor(v.z / CHUNK)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const out: THREE.InstancedMesh[] = [];
  for (const list of buckets.values()) {
    const make = (g: THREE.BufferGeometry, shared?: THREE.InstancedMesh) => {
      let gg = g;
      if (opt.attr) {
        gg = g.clone();
        const arr = new Float32Array(list.length * opt.attr.size);
        list.forEach((it, i) => it.a && arr.set(it.a, i * opt.attr!.size));
        gg.setAttribute(opt.attr.name, new THREE.InstancedBufferAttribute(arr, opt.attr.size));
      }
      const im = new THREE.InstancedMesh(gg, mat, list.length);
      if (shared) {
        im.instanceMatrix = shared.instanceMatrix;
        if (shared.instanceColor) im.instanceColor = shared.instanceColor;
      } else {
        list.forEach((it, i) => {
          im.setMatrixAt(i, it.m);
          if (it.c) im.setColorAt(i, it.c);
        });
      }
      im.castShadow = !!opt.shadow;
      im.receiveShadow = opt.receive !== false;
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      scene.add(im);
      return im;
    };
    const mesh = make(geo);
    const lod = opt.lodGeo ? make(opt.lodGeo, mesh) : undefined;
    if (lod) lod.castShadow = false;
    const bs = mesh.boundingSphere!;
    cm.chunks.push({ mesh, lod, x: bs.center.x, z: bs.center.z, r: bs.radius, far: opt.far, lodDist: opt.lodDist ?? 0 });
    out.push(mesh);
  }
  return out;
}

// ------------------------------------------------------------ building material
export const cityUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
  uWind: { value: 1 },
};

function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = cityUniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aStyle;
varying vec3 vBN; varying vec3 vLP; varying vec3 vBS; varying vec2 vStyle; varying vec3 vBW;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 bScale = vec3(1.0);
vec3 bNorm = objectNormal;
vec4 bW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
bScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
bNorm = mat3(instanceMatrix) * objectNormal;
bW = instanceMatrix * bW;
#endif
vBW = (modelMatrix * bW).xyz;
vBN = normalize(bNorm);
vLP = position * bScale;
vBS = bScale;
vStyle = aStyle;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
varying vec3 vBN; varying vec3 vLP; varying vec3 vBS; varying vec2 vStyle; varying vec3 vBW;
float bhash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
// a room behind the glass: the ray from the eye carried into a box the size of the window's cell
vec3 bRoom(vec2 pin, vec2 cellSz, float depth, vec3 rd, float seed, float office, out float tHit, out float lampK) {
  vec3 ro = vec3(pin * cellSz, 0.0);
  vec3 bmax = vec3(cellSz, depth);
  vec3 t1 = (vec3(0.0) - ro) / rd, t2 = (bmax - ro) / rd;
  vec3 tf = max(t1, t2);
  float t = min(min(tf.x, tf.y), tf.z);
  vec3 h = ro + rd * t;
  tHit = t;
  // the room's light: a lamp under the ceiling, part way back
  vec3 lp = vec3(cellSz.x * (0.35 + 0.3 * fract(seed * 5.3)), cellSz.y * 0.9, depth * 0.55);
  vec3 dl = h - lp;
  lampK = 1.0 / (1.0 + dot(dl, dl) * 0.32);
  vec3 wall = office > 0.5 ? vec3(0.62, 0.64, 0.66) : mix(vec3(0.78, 0.7, 0.6), vec3(0.62, 0.72, 0.76), step(0.5, fract(seed * 7.1)));
  vec3 col;
  if (t == tf.z) {
    col = wall * 0.85;
    // a picture or a doorway on the back wall
    vec2 q = h.xy / cellSz;
    if (office < 0.5 && abs(q.x - (0.3 + fract(seed * 3.7) * 0.4)) < 0.12 && abs(q.y - 0.55) < 0.12) col = mix(vec3(0.2, 0.3, 0.4), vec3(0.6, 0.35, 0.25), fract(seed * 11.0));
  } else if (t == tf.y) {
    if (rd.y < 0.0) col = office > 0.5 ? vec3(0.32, 0.33, 0.35) : vec3(0.36, 0.24, 0.15) * (0.85 + 0.3 * step(0.5, fract(h.x * 1.5)));
    else {
      col = vec3(0.86, 0.85, 0.82);
      if (office > 0.5) col += vec3(1.2, 1.2, 1.1) * step(abs(fract(h.z * 0.4) - 0.5), 0.12) * step(abs(h.x / cellSz.x - 0.5), 0.3);
    }
  } else {
    col = wall * 0.7;
  }
  // furniture silhouettes low in the room
  if (office < 1.5 && h.y < cellSz.y * 0.32 && t != tf.y && h.z > depth * 0.35) col *= 0.45;
  // a shop: stocked shelving round the walls, a tiled floor, a strip light
  if (office > 1.5) {
    if (t == tf.y && rd.y < 0.0) {
      vec2 tl = floor(h.xz * 1.6);
      col = mix(vec3(0.72, 0.72, 0.7), vec3(0.58, 0.6, 0.6), mod(tl.x + tl.y, 2.0));
    } else if (t != tf.y && h.y < 1.9 && h.y > 0.12) {
      float along = t == tf.z ? h.x : h.z;
      float row = floor(h.y / 0.4);
      float band = fract(h.y / 0.4);
      float slot = fract(along * 6.0);
      if (band < 0.08) col = vec3(0.78, 0.79, 0.8);
      else if (band > 0.72 || slot < 0.1 || slot > 0.92) col = vec3(0.16, 0.17, 0.18);
      else {
        // runs of one product: the colour changes every few facings
        float k = bhash(vec3(floor(along * 1.5), row, seed * 31.0));
        vec3 prod = 0.5 + 0.5 * cos(6.2832 * (k + vec3(0.0, 0.33, 0.67)));
        col = mix(vec3(0.55), prod, 0.5) * 0.85;
      }
    }
  }
  return col * mix(1.0, 0.55, clamp(t / (depth * 1.4), 0.0, 1.0));
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 bn = normalize(vBN);
float bStyle = vStyle.x;
float wmask = 0.0; float wlit = 0.0; vec3 bInterior = vec3(0.0); float bFrame = 0.0; float bLamp = 0.0;
vec3 litCol = vec3(1.0, 0.78, 0.5);
if (bn.y > 0.5) {
  diffuseColor.rgb *= 0.72;
} else if (bn.y > -0.5 && bStyle < 3.5) {
  bool sideX = abs(bn.x) > 0.5;
  float u = sideX ? vLP.z : vLP.x;
  float halfW = sideX ? vBS.z * 0.5 : vBS.x * 0.5;
  float face = sideX ? sign(bn.x) : 2.0 * sign(bn.z);
  float v = vLP.y;
  vec2 cell = vec2(3.6, 3.2); vec2 fr = vec2(0.55, 0.5); float y0 = 0.8;
  if (bStyle < 0.5) { cell = vec2(3.0, 3.6); fr = vec2(0.9, 0.8); y0 = 0.3; }
  else if (bStyle < 1.5) { cell = vec2(3.4, 3.3); fr = vec2(0.5, 0.56); y0 = 1.2; }
  else if (bStyle < 2.5) { cell = vec2(3.6, 3.0); fr = vec2(0.36, 0.44); y0 = 0.3; }
  // the street floor of shops and hotels: tall shopfronts
  bool shop = (bStyle > 0.5 && bStyle < 1.5 || bStyle > 2.5) && v < 4.2;
  if (shop) { cell = vec2(4.6, 4.4); fr = vec2(0.82, 0.66); y0 = -0.75; }
  float nCols = max(floor((2.0 * halfW - 1.2) / cell.x), 0.0);
  float off = (2.0 * halfW - nCols * cell.x) * 0.5;
  float uu = (u + halfW - off) / cell.x;
  float vv = (v - y0) / cell.y;
  vec2 f = fract(vec2(uu, vv));
  vec2 id = floor(vec2(uu, vv));
  vec2 hw = fr * 0.5;
  vec2 d = abs(f - 0.5);
  float inCols = step(0.0, uu) * step(uu, nCols) * step(0.0, vv) * step(v, vBS.y - 0.9);
  float inside = step(d.x, hw.x) * step(d.y, hw.y) * inCols;
  // frame: a band just inside the opening; sill: a ledge under it
  float fw = bStyle < 0.5 ? 0.012 : 0.03;
  bFrame = inside * (1.0 - step(d.x, hw.x - fw) * step(d.y, hw.y - fw * 1.3));
  float sill = (1.0 - inside) * inCols * step(d.x, hw.x + 0.03) * step(f.y, 0.5 - hw.y) * step(0.5 - hw.y - 0.035, f.y) * step(0.5, bStyle) * (shop ? 0.0 : 1.0);
  wmask = inside * (1.0 - bFrame);
  float r = bhash(vec3(id, face * 7.0 + vStyle.y * 91.0));
  float litP = bStyle < 0.5 ? 0.35 : 0.42;
  if (shop) litP = 0.9;
  wlit = step(r, litP) * wmask;
  litCol = r < 0.06 ? vec3(0.55, 0.75, 1.0) : (r < 0.16 ? vec3(1.0, 0.85, 0.6) : vec3(1.0, 0.66, 0.34));
  // the room behind the window
  if (wmask > 0.5) {
    vec3 T = sideX ? vec3(0.0, 0.0, sign(bn.x)) : vec3(-sign(bn.z), 0.0, 0.0);
    vec3 V = normalize(vBW - cameraPosition);
    vec3 rd = vec3(dot(V, T), dot(V, vec3(0.0, 1.0, 0.0)), -dot(V, bn));
    rd.z = max(rd.z, 0.05);
    vec2 pin = (f - (0.5 - hw)) / (2.0 * hw);
    float tHit;
    float office = shop ? 2.0 : bStyle < 0.5 ? 1.0 : 0.0;
    float lampK;
    vec3 room = bRoom(pin, cell * fr * 1.6, shop ? 8.0 : bStyle < 0.5 ? 6.0 : 4.0, normalize(rd), r, office, tHit, lampK);
    bLamp = lampK;
    // blinds: some windows half shut
    float blind = step(0.55, fract(r * 13.3)) * (0.25 + 0.6 * fract(r * 5.1));
    if (!shop && pin.y > 1.0 - blind) room = mix(vec3(0.85, 0.8, 0.68), vec3(0.6, 0.66, 0.7), step(0.7, fract(r * 3.3))) * (0.7 + 0.12 * step(0.5, fract(pin.y * 18.0)));
    bInterior = room;
  }
  vec3 glassCol = bStyle < 0.5 ? vec3(0.06, 0.1, 0.12) : vec3(0.02, 0.025, 0.03);
  // every tower its own glass: blue-green, deep blue, bronze, emerald, graphite, silver
  float gk = fract(vStyle.y * 7.31);
  if (bStyle < 0.5) {
    glassCol = gk < 0.25 ? vec3(0.06, 0.1, 0.12) : gk < 0.42 ? vec3(0.03, 0.06, 0.13) : gk < 0.56 ? vec3(0.11, 0.08, 0.05)
      : gk < 0.68 ? vec3(0.04, 0.1, 0.08) : gk < 0.84 ? vec3(0.04, 0.045, 0.05) : vec3(0.12, 0.14, 0.16);
  }
  vec3 frameCol = bStyle < 0.5 ? vec3(0.55, 0.58, 0.6) : (bStyle < 1.5 ? vec3(0.95, 0.94, 0.9) : vec3(0.92, 0.9, 0.86));
  if (shop) frameCol = vec3(0.12, 0.12, 0.13);
  // towers: mullions and spandrel bands
  if (bStyle < 0.5) {
    float mull = step(0.95, fract(uu * 2.0));
    glassCol = mix(glassCol, vec3(0.3, 0.32, 0.35), mull);
    float band = step(abs(f.y - 0.5), 0.5) * (1.0 - step(abs(f.y - 0.5), hw.y));
    // spandrels: dark tinted glass too, so a tower reads as one sheet of glass from afar
    diffuseColor.rgb = mix(diffuseColor.rgb, glassCol * 1.8 + diffuseColor.rgb * 0.06, band * inCols);
    // a third of the glass towers are all curtain wall: the piers go dark glass as well
    if (fract(vStyle.y * 3.77) < 0.34) diffuseColor.rgb = mix(diffuseColor.rgb, glassCol * 2.1 + vec3(0.02), step(1.0, v) * 0.85);
    wmask = max(wmask, band * inCols * 0.85);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, wmask);
  diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, bFrame);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.88), sill);
  // the opening's reveal: a shadow along the top and one side of each window
  float reveal = inside * (smoothstep(hw.y - 0.07, hw.y, f.y - 0.5) * 0.5 + smoothstep(hw.x - 0.05, hw.x, f.x - 0.5) * 0.3);
  diffuseColor.rgb *= 1.0 - reveal * (1.0 - wmask * 0.6);
  if (bStyle > 0.5 && bStyle < 1.5) {
    float band = step(fract(vv), 0.09) * step(0.0, vv) * (shop ? 0.0 : 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.95, 0.9), band * (1.0 - wmask));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.97, 0.94), step(vBS.y - 0.9, v));
    float edge = halfW - abs(u);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98), step(edge, 0.6) * step(0.35, edge) * (1.0 - wmask));
  }
  // awnings' shade line and a darker plinth on shops
  if (shop && v > 3.5 && v < 4.2) diffuseColor.rgb *= 0.8;
  if (bStyle > 2.5 && v < 0.7) diffuseColor.rgb *= 0.55;
  // grime toward the ground, a little lighter up high
  diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 2.5, v)) * mix(1.0, 1.04, smoothstep(10.0, 40.0, v));
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.04, wmask);
roughnessFactor = mix(roughnessFactor, 0.45, bFrame);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, bStyle < 0.5 ? 0.62 : 0.0, wmask);
metalnessFactor = mix(metalnessFactor, bStyle < 0.5 ? 0.8 : 0.0, bFrame);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float dayLight = 1.0 - uNight;
  // the room as the daylight shows it, and lamps on in some rooms at night
  totalEmissiveRadiance += bInterior * wmask * (dayLight * (bStyle < 0.5 ? 0.22 : 0.32) + uNight * 0.04);
  // lit rooms at night: the lamp falls off across walls, floor and furniture, so it reads as a room
  totalEmissiveRadiance += bInterior * litCol * wlit * uNight * (0.28 + bLamp * 1.35);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'palmera-building-v5';
  return mat;
}

function swayMaterial(base: THREE.MeshStandardMaterial, height: number): THREE.MeshStandardMaterial {
  base.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = cityUniforms.uTime;
    sh.uniforms.uWind = cityUniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uWind;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float sw = clamp(transformed.y / ${height.toFixed(1)}, 0.0, 1.5); sw *= sw;
vec3 ip = vec3(0.0);
#ifdef USE_INSTANCING
ip = instanceMatrix[3].xyz;
#endif
float ph = ip.x * 0.13 + ip.z * 0.07;
float gust = sin(uTime * 0.6 + ip.x * 0.01) * 0.5 + 0.5;
transformed.x += (sin(uTime * 1.3 + ph) * 0.16 + 0.22 * gust) * sw * uWind;
transformed.z += cos(uTime * 1.05 + ph * 1.3) * 0.12 * sw * uWind;
if (transformed.y > ${(height * 0.85).toFixed(1)}) transformed.y += sin(uTime * 3.2 + ph + transformed.x * 1.7 + transformed.z * 1.3) * 0.07 * length(transformed.xz) * uWind;`,
      );
  };
  base.customProgramCacheKey = () => 'palmera-sway-' + height;
  return base;
}

// ------------------------------------------------------------ prop geometries
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export function palmGeometry(detail: boolean): THREE.BufferGeometry {
  const H = 8;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.15, 0.27, H, detail ? 7 : 4, detail ? 8 : 2, true);
  trunk.translate(0, H / 2, 0);
  const tp = trunk.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    tp.setX(i, tp.getX(i) + 0.9 * (y / H) ** 2);
  }
  trunk.computeVertexNormals();
  parts.push(prep(trunk, (_x, y) => C(0.5, 0.4, 0.29).multiplyScalar(0.8 + 0.2 * Math.sin(y * 7))));
  const topX = 0.9;
  const n = detail ? 10 : 6;
  const segs = detail ? 5 : 2;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.2;
    const lift = (k % 3) * 0.35;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pos: number[] = [];
    const rows: number[][][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = 0.15 + t * 3.5;
      const y = H + 0.2 + (1.0 + lift) * t - (2.7 + lift) * t * t;
      const w = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)) + 0.04;
      const cx = topX + ca * r, cz = sa * r;
      rows.push([
        [cx - sa * w, y - 0.22 * w, cz + ca * w],
        [cx, y, cz],
        [cx + sa * w, y - 0.22 * w, cz - ca * w],
      ]);
    }
    for (let s = 0; s < segs; s++) {
      for (let j = 0; j < 2; j++) {
        const a0 = rows[s][j], a1 = rows[s][j + 1], b0 = rows[s + 1][j], b1 = rows[s + 1][j + 1];
        pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(prep(g, (x, _y, z) => {
      const d = Math.hypot(x - topX, z) / 3.6;
      return C(0.2 + 0.18 * d, 0.42 + 0.12 * d, 0.12 + 0.05 * d);
    }));
  }
  if (detail) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.IcosahedronGeometry(0.16, 0);
      g.translate(topX + Math.cos(i * 2.1) * 0.22, H - 0.1, Math.sin(i * 2.1) * 0.22);
      parts.push(prep(g, 0x5a4a22));
    }
  }
  return merge(parts);
}

function treeGeometry(detail: boolean): THREE.BufferGeometry {
  const parts = [cyl(0.18, 0.28, 3.2, detail ? 6 : 4, 0, 1.6, 0, 0x6b5139)];
  const blobs: [number, number, number, number][] = detail
    ? [[0, 4.3, 0, 2.2], [1.1, 3.8, 0.5, 1.5], [-1.0, 3.9, -0.4, 1.6], [0.2, 5.0, -0.6, 1.4]]
    : [[0, 4.3, 0, 2.5]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, detail ? 1 : 0);
    g.translate(x, y, z);
    parts.push(prep(g, (_x, yy) => C(0.24, 0.42 + 0.06 * (yy - 3), 0.16)));
  }
  return merge(parts);
}

function cypressGeometry(): THREE.BufferGeometry {
  const parts = [cyl(0.2, 0.55, 2, 6, 0, 1, 0, 0x5e5243), cyl(0.12, 0.22, 7, 5, 0, 5, 0, 0x6a5c4b)];
  const blobs: [number, number, number, number, number][] = [[0, 7.5, 0, 2.2, 0.6], [0.8, 6.0, 0.3, 1.6, 0.55], [-0.6, 8.8, -0.2, 1.5, 0.6]];
  for (const [x, y, z, r, sy] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    parts.push(prep(g, C(0.27, 0.36, 0.2)));
  }
  // hanging moss
  for (let i = 0; i < 3; i++) {
    const g = new THREE.ConeGeometry(0.4, 1.6, 4);
    g.rotateX(Math.PI);
    g.translate(Math.cos(i * 2) * 1.2, 6.0, Math.sin(i * 2) * 1.2);
    parts.push(prep(g, C(0.55, 0.58, 0.5)));
  }
  return merge(parts);
}

function bushGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.3, 0.8, 1.2);
  g.translate(0, 0.6, 0);
  return merge([prep(g, C(0.3, 0.42, 0.2))]);
}

function lampGeometry(): THREE.BufferGeometry {
  return merge([
    cyl(0.09, 0.14, 7.2, 6, 0, 3.6, 0, 0x4a5056),
    box(0.08, 0.08, 1.7, 0, 7.15, 0.8, 0x4a5056),
    box(0.4, 0.15, 0.7, 0, 7.05, 1.6, 0x3a3f44),
    cyl(0.22, 0.26, 0.4, 6, 0, 0.2, 0, 0x3a3f44),
  ]);
}

function umbrellaGeometry(): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(1.5, 0.55, 8, 1, true);
  cone.translate(0, 2.35, 0);
  return merge([cyl(0.03, 0.03, 2.3, 4, 0, 1.15, 0, 0xdddddd), prep(cone, (x, _y, z) => {
    const a = Math.atan2(z, x);
    return Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8 + 0.5) % 2 === 0 ? C(1, 1, 1) : C(0.75, 0.75, 0.75);
  })]);
}

function loungerGeometry(): THREE.BufferGeometry {
  const back = new THREE.BoxGeometry(0.62, 0.06, 0.7);
  back.rotateX(-0.7);
  back.translate(0, 0.55, -0.9);
  return merge([box(0.62, 0.06, 1.4, 0, 0.32, 0.15, 0xffffff), prep(back, 0xffffff), box(0.05, 0.3, 0.05, 0.27, 0.15, 0.7, 0xcccccc), box(0.05, 0.3, 0.05, -0.27, 0.15, 0.7, 0xcccccc)]);
}

function lifeguardGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.15, 2.2, 0.15, sx * 1.1, 1.1, sz * 1.1, 0xf5f5f0));
  p.push(box(3, 0.15, 3, 0, 2.25, 0, 0xf5f5f0));
  p.push(box(2.2, 1.8, 2.2, 0, 3.2, 0, 0xffffff));
  const roof = new THREE.ConeGeometry(2.0, 0.9, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 4.55, 0);
  p.push(prep(roof, 0xffffff));
  const ramp = new THREE.BoxGeometry(0.9, 0.08, 3.2);
  ramp.rotateX(0.75);
  ramp.translate(0, 1.15, 2.2);
  p.push(prep(ramp, 0xe8e0d0));
  return merge(p);
}

function roofGeometry(): THREE.BufferGeometry {
  // unit gable prism, ridge along x, base at y=0
  const pos = [
    // front slope (z+)
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    // back slope
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    // gables
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ city
export class City {
  chunks = new ChunkManager();
  lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x999988 });
  poolMat: THREE.MeshBasicMaterial;
  neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
  signMat = neonSignMaterial();
  palmMats: THREE.MeshStandardMaterial[] = [];
  private beaconMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });

  constructor(private scene: THREE.Scene, public map: CityMap) {
    this.poolMat = new THREE.MeshBasicMaterial({ map: T.glowTexture(), color: 0xffa860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.buildGround();
    this.buildRoads();
    this.buildSidewalks();
    this.buildFlats();
    this.buildBuildings();
    this.buildProps();
    this.buildFurniture();
    this.buildBridge();
    this.buildDocks();
    this.buildLandmarks();
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false, receive = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    this.scene.add(m);
    return m;
  }

  private buildGround() {
    const grass = T.grassTexture(), sand = T.sandTexture(), mud = T.mudTexture(), conc = T.concreteTexture();
    const g1 = new MB();
    g1.flat(-480, MAIN.z0, 80, MAIN.z1, 0, 24);
    this.add(g1.geo(), D(new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }), 'leafy_grass', { scale: 2.5, albedo: 0.9, normal: 0.9, rough: [0.75, 1] }));
    const g2 = new MB();
    g2.flat(80, MAIN.z0, MAIN.x1, MAIN.z1, 0, 8);
    g2.flat(ISLAND.x0, ISLAND.z0, BEACH.x0, ISLAND.z1, 0, 8);
    this.add(g2.geo(), D(new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, color: 0xf2ece2 }), 'concrete_pavement', { scale: 4, albedo: 0.8, normal: 0.8, rough: [0.6, 0.95] }));
    const g3 = new MB();
    g3.flat(MAIN.x0, MAIN.z0, -480, MAIN.z1, 0, 20);
    // the marsh: wet olive-brown, not lawn
    this.add(g3.geo(), D(new THREE.MeshStandardMaterial({ map: mud, roughness: 0.9, color: 0x9c946a }), 'leafy_grass', { scale: 3, albedo: 0.45, normal: 0.8 }));
    // beach: flat sand then a slope into the sea
    const b = new MB();
    const xs = [BEACH.x0, ISLAND.x1, 735, 770, 860];
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i], xb = xs[i + 1];
      const ya = groundBase(xa, 0) + 0.01, yb = groundBase(Math.min(xb, 859), 0) + 0.01;
      b.quad([xa, ya, ISLAND.z1], [xb, yb, ISLAND.z1], [xb, yb, ISLAND.z0], [xa, ya, ISLAND.z0], [xa / 16, -ISLAND.z1 / 16], [xb / 16, -ISLAND.z1 / 16], [xb / 16, -ISLAND.z0 / 16], [xa / 16, -ISLAND.z0 / 16]);
    }
    // sand around the island tips
    b.flat(ISLAND.x0, ISLAND.z1 - 1, BEACH.x0, ISLAND.z1, 0.005, 16);
    this.add(b.geo(), D(new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }), 'coast_sand_01', { scale: 3, albedo: 0.9, normal: 1.0, rough: [0.8, 1] }));
    // seawalls
    const sw: THREE.BufferGeometry[] = [];
    const wall = (x0: number, z0: number, x1: number, z1: number) => sw.push(box(Math.max(0.6, x1 - x0), 5, Math.max(0.6, z1 - z0), (x0 + x1) / 2, -2.5, (z0 + z1) / 2, 0xbdb5a6));
    wall(MAIN.x0, MAIN.z0 - 0.3, MAIN.x1, MAIN.z0 + 0.3);
    wall(MAIN.x0, MAIN.z1 - 0.3, MAIN.x1, MAIN.z1 + 0.3);
    wall(MAIN.x0 - 0.3, MAIN.z0, MAIN.x0 + 0.3, MAIN.z1);
    wall(MAIN.x1 - 0.3, MAIN.z0, MAIN.x1 + 0.3, MAIN.z1);
    wall(ISLAND.x0 - 0.3, ISLAND.z0, ISLAND.x0 + 0.3, ISLAND.z1);
    wall(ISLAND.x0, ISLAND.z0 - 0.3, ISLAND.x1, ISLAND.z0 + 0.3);
    wall(ISLAND.x0, ISLAND.z1 - 0.3, ISLAND.x1, ISLAND.z1 + 0.3);
    // bayfront railing
    // railing with gaps for the causeway and the marina boardwalk
    const gaps: [number, number][] = [[BRIDGE.z - BRIDGE.half - 1, BRIDGE.z + BRIDGE.half + 1], [96, 364]];
    const runs: [number, number][] = [];
    let z0 = MAIN.z0;
    for (const [a, b] of gaps) {
      runs.push([z0, a]);
      z0 = b;
    }
    runs.push([z0, MAIN.z1]);
    for (const [a, b] of runs) {
      for (let z = a; z <= b; z += 4) sw.push(box(0.1, 1.0, 0.1, MAIN.x1 - 0.3, 0.5, z, 0xffffff));
      sw.push(box(0.12, 0.08, b - a, MAIN.x1 - 0.3, 1.0, (a + b) / 2, 0xffffff));
      this.map.colliders.add(MAIN.x1 - 0.5, a, MAIN.x1 - 0.1, b, -0.5, 1.1);
    }
    this.add(merge(sw), D(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'coral_stone_wall', { scale: 2.5, albedo: 0.8, normal: 1 }));
  }

  private buildRoads() {
    const roadTex = T.roadTexture();
    const roads = new MB(), swamp = new MB(), inter = new MB(), cross = new MB();
    const m = this.map;
    for (const e of m.edges) {
      if (e.bridge) continue;
      const A = m.nodes[e.a], B = m.nodes[e.b];
      const rx = -e.dz * ROAD_HALF, rz = e.dx * ROAD_HALF;
      const sx = A.x + e.dx * ROAD_HALF, sz = A.z + e.dz * ROAD_HALF;
      const ex = B.x - e.dx * ROAD_HALF, ez = B.z - e.dz * ROAD_HALF;
      const L = e.len - ROAD_HALF * 2;
      const y = 0.02;
      const mb = e.swamp ? swamp : roads;
      // left = -right; u: 0 at left, 1 at right
      mb.quad([sx - rx, y, sz - rz], [sx + rx, y, sz + rz], [ex + rx, y, ez + rz], [ex - rx, y, ez - rz], [0, 0], [1, 0], [1, L / 24], [0, L / 24]);
    }
    for (const n of m.nodes) {
      const h = ROAD_HALF;
      inter.flat(n.x - h, n.z - h, n.x + h, n.z + h, 0.021, 12);
      if (!n.light) continue;
      for (const eid of n.edges) {
        const e = m.edges[eid];
        let dx = e.dx, dz = e.dz;
        if (e.b === n.id) { dx = -dx; dz = -dz; }
        const cx = n.x + dx * (ROAD_HALF + 1.8), cz = n.z + dz * (ROAD_HALF + 1.8);
        const rx = -dz * ROAD_HALF, rz = dx * ROAD_HALF;
        const fx = dx * 1.5, fz = dz * 1.5, y = 0.03;
        cross.quad([cx - rx - fx, y, cz - rz - fz], [cx + rx - fx, y, cz + rz - fz], [cx + rx + fx, y, cz + rz + fz], [cx - rx + fx, y, cz - rz + fz], [0, 0], [1, 0], [1, 1], [0, 1]);
      }
    }
    const asph = { scale: 6, albedo: 0.7, normal: 0.9, rough: [0.55, 0.95] as [number, number] };
    this.add(roads.geo(), D(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 }), 'asphalt_02', asph));
    this.add(swamp.geo(), D(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 1, color: 0xb8a888 }), 'asphalt_02', asph));
    this.add(inter.geo(), D(new THREE.MeshStandardMaterial({ map: T.intersectionTexture(), roughness: 0.92 }), 'asphalt_02', asph));
    const cw = this.add(cross.geo(), new THREE.MeshStandardMaterial({ map: T.crosswalkTexture(), transparent: true, roughness: 0.9, depthWrite: false }));
    cw.renderOrder = 1;
  }

  private buildSidewalks() {
    const mb = new MB();
    const y = 0.12;
    const side = (x0: number, z0: number, x1: number, z1: number) => {
      mb.flat(x0, z0, x1, z1, y, 4);
      // curb faces
      mb.quad([x0, 0, z1], [x1, 0, z1], [x1, y, z1], [x0, y, z1], [0, 0], [1, 0], [1, 0.03], [0, 0.03]);
      mb.quad([x1, 0, z0], [x0, 0, z0], [x0, y, z0], [x1, y, z0], [0, 0], [1, 0], [1, 0.03], [0, 0.03]);
      mb.quad([x1, 0, z1], [x1, 0, z0], [x1, y, z0], [x1, y, z1], [0, 0], [1, 0], [1, 0.03], [0, 0.03]);
      mb.quad([x0, 0, z0], [x0, 0, z1], [x0, y, z1], [x0, y, z0], [0, 0], [1, 0], [1, 0.03], [0, 0.03]);
    };
    for (const b of this.map.blocks) {
      const s = SIDEWALK;
      side(b.x0, b.z0, b.x1, b.z0 + s);
      side(b.x0, b.z1 - s, b.x1, b.z1);
      side(b.x0, b.z0 + s, b.x0 + s, b.z1 - s);
      side(b.x1 - s, b.z0 + s, b.x1, b.z1 - s);
    }
    this.add(mb.geo(), D(new THREE.MeshStandardMaterial({ map: T.concreteTexture(), roughness: 0.88, color: 0xe9e3d8 }), 'concrete_floor_01', { scale: 2.2, albedo: 0.8, normal: 1, rough: [0.55, 0.95] }));
  }

  private buildFlats() {
    const kinds: Record<string, { mb: MB; mat: THREE.Material; y: number; rep: number }> = {
      pool: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ color: 0x38c6e6, roughness: 0.05, metalness: 0.1, emissive: 0x0a3a48 }), y: 0.07, rep: 4 },
      rim: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8 }), y: 0.05, rep: 4 },
      pond: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ color: 0x1c2213, roughness: 0.22, metalness: 0.2 }), y: 0.04, rep: 8 },
      court: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ map: T.courtTexture(), roughness: 0.9 }), y: 0.04, rep: 1 },
      lot: { mb: new MB(), mat: D(new THREE.MeshStandardMaterial({ map: T.lotTexture(), roughness: 0.92 }), 'asphalt_02', { scale: 6, albedo: 0.7, normal: 0.9, rough: [0.55, 0.95] }), y: 0.03, rep: 10 },
      plaza: { mb: new MB(), mat: D(new THREE.MeshStandardMaterial({ map: T.concreteTexture(), color: 0xf7e2c8, roughness: 0.85 }), 'terrazzo_tiles', { scale: 3, albedo: 0.8, normal: 0.6, rough: [0.3, 0.7] }), y: 0.04, rep: 3 },
      grass: { mb: new MB(), mat: D(new THREE.MeshStandardMaterial({ map: T.grassTexture(), roughness: 0.95 }), 'leafy_grass', { scale: 2.5, albedo: 0.9, normal: 0.9, rough: [0.75, 1] }), y: 0.035, rep: 20 },
    };
    for (const f of this.map.flats) {
      const k = kinds[f.kind];
      const x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
      if (f.kind === 'court') {
        k.mb.quad([x0, k.y, z1], [x1, k.y, z1], [x1, k.y, z0], [x0, k.y, z0], [0, 0], [1, 0], [1, 1], [0, 1]);
      } else if (f.kind === 'pond') {
        // a lumpy oval, not a rectangle
        const N = 32, c = [f.x, k.y, f.z];
        const pt = (i: number) => {
          const a = (i / N) * Math.PI * 2, r = pondShape(f, a);
          return [f.x + Math.cos(a) * (f.w / 2) * r, k.y, f.z - Math.sin(a) * (f.d / 2) * r];
        };
        for (let i = 0; i < N; i++) {
          const p = pt(i), q = pt(i + 1);
          k.mb.quad(c, p, q, q, [0, 0], [0, 0], [0, 0], [0, 0]);
        }
      } else k.mb.flat(x0, z0, x1, z1, k.y, k.rep);
      if (f.kind === 'pool') kinds.rim.mb.flat(x0 - 0.8, z0 - 0.8, x1 + 0.8, z1 + 0.8, kinds.rim.y, 4);
    }
    for (const k of Object.values(kinds)) if (k.mb.pos.length) this.add(k.mb.geo(), k.mat);
  }

  private buildBuildings() {
    const mat = D(buildingMaterial(), 'white_stucco_02', { scale: 3.5, albedo: 0.55, normal: 0.8, faces: 'side' });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const big: Inst[] = [], small: Inst[] = [], roofs: Inst[] = [], neon: Inst[] = [];
    const neonCols = [0xff5fa2, 0x29e0d0, 0xb57bff, 0xffb347, 0x5fd3ff];
    const rng = new Rng(77);
    const q = new THREE.Quaternion();
    // the skyline's landmarks: the two tallest towers twist, the next ones step back and carry spires
    const towers = this.map.buildings.filter((b) => b.style === 0 && b.y0 === 0 && b.h > 30).sort((a, b) => b.h - a.h);
    const twisted = new Set(towers.slice(0, 2));
    const spires: Inst[] = [], beacons: Inst[] = [], pads: Inst[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of this.map.buildings) {
      const col = new THREE.Color(b.color);
      if (twisted.has(b)) {
        this.landmarks.add(b);
        const fl = 3.6, n = Math.floor(b.h / fl);
        const turn = (Math.PI / 2) * (b.seed > 0.5 ? 1 : -1);
        for (let k = 0; k < n; k++) {
          const qa = new THREE.Quaternion().setFromAxisAngle(up, (k / n) * turn);
          big.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, k * fl, b.z), qa, new THREE.Vector3(b.w * 0.86, fl - 0.02, b.d * 0.86)), c: col, a: [0, b.seed + k * 0.013] });
        }
        spires.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, n * fl, b.z), q, new THREE.Vector3(1, 26, 1)), c: new THREE.Color(0xc8ccd0) });
        beacons.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, n * fl + 26.4, b.z), q, new THREE.Vector3(0.7, 0.7, 0.7)) });
        continue;
      }
      if (towers.includes(b) && b.h > 38 && (towers.indexOf(b) < 7 || rng.next() < 0.45)) {
        // setbacks: a base, a narrower middle, a crown
        this.landmarks.add(b);
        const h1 = b.h * 0.66, h2 = b.h * 0.22, h3 = b.h * 0.12;
        big.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, h1, b.d)), c: col, a: [0, b.seed] });
        big.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, h1, b.z), q, new THREE.Vector3(b.w * 0.76, h2, b.d * 0.76)), c: col, a: [0, b.seed + 0.31] });
        big.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, h1 + h2, b.z), q, new THREE.Vector3(b.w * 0.5, h3, b.d * 0.5)), c: col.clone().offsetHSL(0, 0, -0.08), a: [0, b.seed + 0.57] });
        // ledges where it steps in
        const lc = col.clone().lerp(new THREE.Color(0xffffff), 0.6);
        this.ledges.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, h1 - 0.2, b.z), q, new THREE.Vector3(b.w + 0.4, 0.5, b.d + 0.4)), c: lc });
        this.ledges.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, h1 + h2 - 0.2, b.z), q, new THREE.Vector3(b.w * 0.76 + 0.4, 0.5, b.d * 0.76 + 0.4)), c: lc });
        if (towers.indexOf(b) < 7) {
          const sh = 10 + rng.next() * 14;
          spires.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.h, b.z), q, new THREE.Vector3(0.8, sh, 0.8)), c: new THREE.Color(0xc8ccd0) });
          beacons.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.h + sh + 0.3, b.z), q, new THREE.Vector3(0.6, 0.6, 0.6)) });
        }
        continue;
      }
      // a pad on the clear part of the roof: none where a setback tier covers it, beside the plant room where there is one
      if (b.style === 0 && b.h > 30 && rng.next() < 0.35) {
        const on = this.map.buildings.find((o) => o !== b && Math.abs(o.y0 - (b.y0 + b.h)) < 0.5 && Math.abs(o.x - b.x) < (b.w + o.w) / 2 && Math.abs(o.z - b.z) < (b.d + o.d) / 2);
        let cx = b.x, cz = b.z, size = Math.min(b.w, b.d) * 0.7;
        if (on && on.w * on.d < 0.15 * b.w * b.d) {
          if (Math.abs(on.x - b.x) >= Math.abs(on.z - b.z)) {
            cx = b.x + Math.sign(b.x - on.x || 1) * b.w * 0.25;
            size = Math.min(b.w * 0.42, b.d * 0.8);
          } else {
            cz = b.z + Math.sign(b.z - on.z || 1) * b.d * 0.25;
            size = Math.min(b.d * 0.42, b.w * 0.8);
          }
        }
        if (!on || on.w * on.d < 0.15 * b.w * b.d) {
          this.helipads.add(b);
          this.padAt.set(b, { x: cx, z: cz });
          pads.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(cx, b.h + 0.06, cz), q, new THREE.Vector3(size, 1, size)) });
        }
      }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      const it: Inst = { m, c: col, a: [b.style, b.seed] };
      (b.h + b.y0 > 18 || b.style === 0 ? big : small).push(it);
      if (b.roof) this.pushRoof(b, roofs);
      if (b.style === 1 && b.y0 === 0 && b.h > 10) {
        // neon strip on the ocean-facing facade
        const nm = new THREE.Matrix4().compose(new THREE.Vector3(b.x + b.w / 2 + 0.12, b.h - 1.6, b.z), q, new THREE.Vector3(0.15, 0.35, b.d * 0.7));
        neon.push({ m: nm, c: new THREE.Color(rng.pick(neonCols)) });
        const nm2 = new THREE.Matrix4().compose(new THREE.Vector3(b.x + b.w / 2 + 0.12, 4.2, b.z), q, new THREE.Vector3(0.15, 0.25, b.d * 0.9));
        neon.push({ m: nm2, c: new THREE.Color(rng.pick(neonCols)) });
      }
    }
    this.buildBuildingDetail();
    // spires (a slim tapered mast), aircraft-warning lights, helipads
    const spG = new THREE.CylinderGeometry(0.08, 0.6, 1, 8);
    spG.translate(0, 0.5, 0);
    chunked(this.scene, this.chunks, spires, spG, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.9 }), { far: 2400, shadow: true });
    chunked(this.scene, this.chunks, beacons, new THREE.SphereGeometry(0.5, 8, 6), this.beaconMat, { far: 2600, shadow: false, receive: false });
    const padG = new THREE.CircleGeometry(0.5, 32);
    padG.rotateX(-Math.PI / 2);
    chunked(this.scene, this.chunks, pads, padG, new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), { far: 1600, shadow: false });
    const attr = { name: 'aStyle', size: 2 };
    chunked(this.scene, this.chunks, big, geo, mat, { far: 2200, shadow: true, attr });
    chunked(this.scene, this.chunks, small, geo, mat, { far: 750, shadow: true, attr });
    const roofMat = D(new THREE.MeshStandardMaterial({ roughness: 0.9 }), 'concrete_floor_01', { scale: 3, albedo: 0.8, normal: 1 });
    chunked(this.scene, this.chunks, roofs, roofGeometry(), roofMat, { far: 700, shadow: true });
    const ng = new THREE.BoxGeometry(1, 1, 1);
    chunked(this.scene, this.chunks, neon, ng, this.neonMat, { far: 1500, shadow: false, receive: false });
  }

  /** what gives a box a building's silhouette: cornices and parapets, balconies, rooftop plant, awnings */
  /** towers reshaped (twisted, set back): no box cornice or parapet on them */
  grass: Grass | null = null;
  private landmarks = new Set<BuildingSpec>();
  readonly helipads = new Set<BuildingSpec>();
  /** where on each helipad roof the pad is painted */
  readonly padAt = new Map<BuildingSpec, { x: number; z: number }>();
  private ledges: Inst[] = [];

  private buildBuildingDetail() {
    const trim: Inst[] = [], balc: Inst[] = [], rail: Inst[] = [], plant: Inst[] = [], awn: Inst[] = [], signs: Inst[] = [];
    const tanks: Inst[] = [], acs: Inst[] = [], vents: Inst[] = [], masts: Inst[] = [];
    const roofThing = (list: Inst[], x: number, y: number, z: number, yaw: number, s = 1) =>
      list.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s)) });
    const rng = new Rng(4242);
    const q0 = new THREE.Quaternion();
    const put = (list: Inst[], x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color, q = q0) =>
      list.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)), c });
    const awnCols = [0x1f8a8a, 0xd8574a, 0x2b5fa8, 0xf2c14e, 0x3f8f5a, 0xe8e2d0, 0xc0477a];
    const white = new THREE.Color(0xf3f0ea), grey = new THREE.Color(0x9a9a96), dark = new THREE.Color(0x5a5c5e);
    for (const l of this.ledges) trim.push(l);
    for (const b of this.map.buildings) {
      if (this.landmarks.has(b)) continue;
      const top = b.y0 + b.h;
      const base = new THREE.Color(b.color);
      const light = base.clone().lerp(white, 0.75);
      if (!b.roof && b.style !== 2) {
        // cornice slab and a parapet round the roof
        put(trim, b.x, top - 0.25, b.z, b.w + 0.5, 0.42, b.d + 0.5, light);
        const t = 0.25, ph = b.style === 0 ? 1.4 : 1.0;
        put(trim, b.x, top + ph / 2, b.z - b.d / 2 + t / 2, b.w, ph, t, light);
        put(trim, b.x, top + ph / 2, b.z + b.d / 2 - t / 2, b.w, ph, t, light);
        put(trim, b.x - b.w / 2 + t / 2, top + ph / 2, b.z, t, ph, b.d - 2 * t, light);
        put(trim, b.x + b.w / 2 - t / 2, top + ph / 2, b.z, t, ph, b.d - 2 * t, light);
        // rooftop plant
        if (this.helipads.has(b)) {
          // the pad keeps the roof clear
        } else if (b.style === 0 && b.h > 25) {
          put(plant, b.x + (rng.next() - 0.5) * b.w * 0.2, top + 1.8, b.z + (rng.next() - 0.5) * b.d * 0.2, b.w * 0.42, 3.6, b.d * 0.42, grey);
          if (rng.chance(0.5)) put(plant, b.x, top + 3.6 + 3, b.z, 0.25, 6, 0.25, dark);
          // a bank of condensers round the plant room, and often a mast
          const rx = b.w / 2 - 2.2, rz = b.d / 2 - 2.2;
          for (let i = 0; i < 4; i++) {
            const side = i % 2 ? 1 : -1;
            if (rng.chance(0.5)) roofThing(acs, b.x + side * rx * 0.8, top, b.z + (rng.next() - 0.5) * rz, rng.int(0, 3) * Math.PI / 2);
            else roofThing(acs, b.x + (rng.next() - 0.5) * rx, top, b.z + side * rz * 0.8, rng.int(0, 3) * Math.PI / 2);
          }
          if (rng.chance(0.65)) roofThing(masts, b.x + rx * 0.7 * (rng.chance(0.5) ? 1 : -1), top, b.z + rz * 0.7 * (rng.chance(0.5) ? 1 : -1), 0, 0.8 + rng.next() * 0.7);
        } else if (b.w > 6 && b.d > 6) {
          const n = 1 + Math.floor(rng.next() * 3);
          for (let i = 0; i < n; i++)
            put(plant, b.x + (rng.next() - 0.5) * (b.w - 4), top + 0.55, b.z + (rng.next() - 0.5) * (b.d - 4), 1.4 + rng.next(), 1.1, 1.2 + rng.next(), rng.chance(0.5) ? grey : white);
          // condensers, vent stacks and, on the taller ones, a water tank on legs
          const nAc = Math.min(6, 1 + Math.floor((b.w * b.d) / 90));
          for (let i = 0; i < nAc; i++) roofThing(acs, b.x + (rng.next() - 0.5) * (b.w - 3), top, b.z + (rng.next() - 0.5) * (b.d - 3), rng.int(0, 3) * Math.PI / 2);
          const nV = rng.int(1, 3);
          for (let i = 0; i < nV; i++) roofThing(vents, b.x + (rng.next() - 0.5) * (b.w - 2), top, b.z + (rng.next() - 0.5) * (b.d - 2), 0);
          if (b.h > 12 && rng.chance(0.4)) roofThing(tanks, b.x + (rng.next() - 0.5) * (b.w - 5), top, b.z + (rng.next() - 0.5) * (b.d - 5), rng.next() * 6.28, 0.85 + rng.next() * 0.35);
        }
      }
      // the long faces get the balconies and awnings
      const alongZ = b.d >= b.w;
      const len = alongZ ? b.d : b.w;
      if ((b.style === 1 || b.style === 3) && b.h > 9 && b.y0 === 0 && len > 8) {
        const y0 = b.style === 1 ? 1.2 : 0.8, cy = b.style === 1 ? 3.3 : 3.2;
        const bl = len * (b.style === 1 ? 0.62 : 0.78);
        for (const sgn of [-1, 1]) {
          for (let k = 1; y0 + k * cy < b.h - 2.2; k++) {
            if (b.style === 3 && k === 1) continue; // shops below
            const y = y0 + k * cy - 0.12;
            const off = (alongZ ? b.w : b.d) / 2;
            if (alongZ) {
              put(balc, b.x + sgn * (off + 0.65), y, b.z, 1.3, 0.18, bl, light);
              put(rail, b.x + sgn * (off + 1.27), y + 0.5, b.z, 0.07, 0.95, bl, white);
            } else {
              put(balc, b.x, y, b.z + sgn * (off + 0.65), bl, 0.18, 1.3, light);
              put(rail, b.x, y + 0.5, b.z + sgn * (off + 1.27), bl, 0.95, 0.07, white);
            }
          }
        }
      }
      // deco: eyebrow sunshades over each window row, and a fin up the middle rising past the roof
      if (b.style === 1 && b.y0 === 0 && b.h > 8 && len > 8) {
        const off = (alongZ ? b.w : b.d) / 2;
        const accent = base.clone().offsetHSL(0.02, 0.15, -0.12);
        for (const sgn of [-1, 1]) {
          for (let k = 1; 1.2 + (k + 1) * 3.3 < b.h - 0.8; k++) {
            const y = 1.2 + k * 3.3 + 3.3 * 0.5 + 3.3 * 0.28 + 0.12;
            if (alongZ) put(trim, b.x + sgn * (off + 0.28), y, b.z, 0.56, 0.09, len * 0.96, light);
            else put(trim, b.x, y, b.z + sgn * (off + 0.28), len * 0.96, 0.09, 0.56, light);
          }
          if (len > 14 && rng.chance(0.7)) {
            const fh = b.h + 2.5 + rng.next() * 3;
            if (alongZ) put(trim, b.x + sgn * (off + 0.3), fh / 2, b.z, 0.6, fh, 1.3, accent);
            else put(trim, b.x, fh / 2, b.z + sgn * (off + 0.3), 1.3, fh, 0.6, accent);
            // the hotel's name in neon down the fin
            const sh = Math.min(9, b.h * 0.55), sy = b.h - sh / 2 - 0.6;
            const yaw = alongZ ? (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) : sgn > 0 ? 0 : Math.PI;
            const pos = alongZ ? new THREE.Vector3(b.x + sgn * (off + 0.62), sy, b.z) : new THREE.Vector3(b.x, sy, b.z + sgn * (off + 0.62));
            signs.push({ m: new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1.15, sh, 1)), a: [Math.floor(rng.next() * NEON_NAMES.length)] });
          }
        }
      }
      // apartments: window air conditioners here and there
      if (b.style === 3 && b.y0 === 0 && b.h > 7) {
        const cell = 3.6, cy = 3.2, y0 = 0.8;
        for (const [axisZ, sgn] of [[true, 1], [true, -1], [false, 1], [false, -1]] as [boolean, number][]) {
          const half = (axisZ ? b.d : b.w) / 2, off = (axisZ ? b.w : b.d) / 2;
          const nCols = Math.max(0, Math.floor((2 * half - 1.2) / cell));
          const o = (2 * half - nCols * cell) / 2;
          for (let k = 1; y0 + (k + 1) * cy < b.h - 0.9; k++) {
            for (let i = 0; i < nCols; i++) {
              if (!rng.chance(0.18)) continue;
              const u = -half + o + (i + 0.5) * cell;
              const y = y0 + (k + 0.5) * cy - cy * 0.25 - 0.2;
              if (axisZ) put(plant, b.x + sgn * (off + 0.25), y, b.z + u, 0.5, 0.42, 0.68, white);
              else put(plant, b.x + u, y, b.z + sgn * (off + 0.25), 0.68, 0.42, 0.5, white);
            }
          }
        }
      }
      // shop awnings over the street floor
      if ((b.style === 3 || b.style === 1) && b.y0 === 0 && len > 6) {
        const c = new THREE.Color(rng.pick(awnCols));
        const depth = 1.5 + rng.next() * 0.5;
        for (const sgn of [-1, 1]) {
          // fixed to the wall at the top, sloping out over the pavement (local +z points away from the wall)
          const off = (alongZ ? b.w : b.d) / 2 + 0.02;
          const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongZ ? sgn * Math.PI / 2 : sgn > 0 ? 0 : Math.PI);
          if (alongZ) put(awn, b.x + sgn * off, 4.05, b.z, len * 0.9, 1, depth, c, face);
          else put(awn, b.x, 4.05, b.z + sgn * off, len * 0.9, 1, depth, c, face);
        }
      }
    }
    const box1 = new THREE.BoxGeometry(1, 1, 1);
    const stucco = D(new THREE.MeshStandardMaterial({ roughness: 0.85 }), 'white_stucco_02', { scale: 3, albedo: 0.5, normal: 0.7 });
    chunked(this.scene, this.chunks, trim, box1, stucco, { far: 1400, shadow: true });
    chunked(this.scene, this.chunks, balc, box1, stucco, { far: 600, shadow: true });
    chunked(this.scene, this.chunks, rail, box1, stucco, { far: 450, shadow: true });
    const metal = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.5 });
    chunked(this.scene, this.chunks, plant, box1, metal, { far: 900, shadow: true });
    const kit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 });
    chunked(this.scene, this.chunks, acs, roofKitGeometry('ac'), kit, { far: 700, shadow: true });
    chunked(this.scene, this.chunks, vents, roofKitGeometry('vent'), kit, { far: 500, shadow: false });
    chunked(this.scene, this.chunks, tanks, roofKitGeometry('tank'), kit, { far: 1100, shadow: true });
    chunked(this.scene, this.chunks, masts, roofKitGeometry('mast'), kit, { far: 1400, shadow: false });
    chunked(this.scene, this.chunks, awn, awningGeometry(), awningMaterial(), { far: 420, shadow: true });
    chunked(this.scene, this.chunks, signs, new THREE.PlaneGeometry(1, 1), this.signMat, { far: 1500, shadow: false, receive: false, attr: { name: 'aCell', size: 1 } });
  }

  private pushRoof(b: BuildingSpec, out: Inst[]) {
    const alongX = b.w >= b.d;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? 0 : Math.PI / 2);
    const sx = (alongX ? b.w : b.d) + 0.6, sz = (alongX ? b.d : b.w) + 1.0;
    m.compose(new THREE.Vector3(b.x, b.y0 + b.h, b.z), q, new THREE.Vector3(sx, Math.min(2.6, sz * 0.3), sz));
    out.push({ m, c: new THREE.Color(b.roofColor) });
  }

  private buildProps() {
    const groups = new Map<PropSpec['kind'], Inst[]>();
    const lampHeads: Inst[] = [], pools: Inst[] = [];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const p of this.map.props) {
      const y = groundAt(p.x, p.z);
      q.setFromAxisAngle(up, p.r);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      let list = groups.get(p.kind);
      if (!list) groups.set(p.kind, (list = []));
      list.push({ m, c: p.color !== undefined ? new THREE.Color(p.color) : undefined });
      if (p.kind === 'lamp') {
        const hx = p.x + Math.sin(p.r) * 1.6, hz = p.z + Math.cos(p.r) * 1.6;
        lampHeads.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(hx, y + 6.95, hz), q, new THREE.Vector3(0.34, 0.06, 0.6)) });
        const px = p.x + Math.sin(p.r) * 2.6, pz = p.z + Math.cos(p.r) * 2.6;
        const pq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        pools.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(px, groundAt(px, pz) + 0.16, pz), pq, new THREE.Vector3(15, 15, 1)) });
      }
    }
    const std = (o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...o });
    const palmMat = swayMaterial(std({ side: THREE.DoubleSide }), 8);
    const palmMatFar = swayMaterial(std({ side: THREE.DoubleSide }), 8);
    this.palmMats.push(palmMat, palmMatFar);
    const palms = groups.get('palm') ?? [];
    // near and far LOD share instance buffers
    const pk = palmKit();
    const tm = swayMaterial(pk.trunkMat, 8), fm = swayMaterial(pk.frondMat, 8), dm = swayMaterial(pk.dryMat, 8);
    this.palmMats.push(tm, fm, dm);
    chunked(this.scene, this.chunks, palms, pk.trunk, tm, { far: 520, shadow: true, lodGeo: pk.trunkLo, lodDist: 140 });
    chunked(this.scene, this.chunks, palms, pk.crown, [fm, dm] as unknown as THREE.Material, { far: 520, shadow: true, lodGeo: pk.crownLo, lodDist: 140 });
    void palmMat;
    // broadleaf trees and swamp cypress: branching trunks under canopies of leaf cards
    const leafTex = leafTexture();
    const leafMat = () => swayMaterial(std({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }), 6);
    const tLeaf = leafMat(), cLeaf = leafMat();
    this.palmMats.push(tLeaf, cLeaf);
    const trees = groups.get('tree') ?? [], cyp = groups.get('cypress') ?? [];
    chunked(this.scene, this.chunks, trees, trunkGeometry(2.6, 0.22, 4, 5, 4.2, 2.4), std({ roughness: 0.95 }), { far: 420, shadow: true });
    chunked(this.scene, this.chunks, trees, crownGeometry({ cy: 4.5, rx: 2.7, ry: 1.9, cards: 70, size: 1.7, seed: 9, tint: 0xd8ecc0, filler: true }), tLeaf, { far: 420, shadow: true, lodGeo: crownGeometry({ cy: 4.5, rx: 2.6, ry: 1.8, cards: 18, size: 2.6, seed: 9, tint: 0xd8ecc0, filler: true }), lodDist: 110 });
    chunked(this.scene, this.chunks, cyp, trunkGeometry(5.5, 0.3, 5, 21, 7.2, 1.6, 0x6a5c4b), std({ roughness: 0.95 }), { far: 420, shadow: true });
    const cypCrown = () => {
      const parts = [crownGeometry({ cy: 6.6, rx: 1.7, ry: 1.6, cards: 34, size: 1.4, seed: 31, tint: 0xc4d4a4, filler: true }), crownGeometry({ cy: 8.6, rx: 1.3, ry: 1.4, cards: 26, size: 1.3, seed: 57, tint: 0xc4d4a4, filler: true })];
      const side = ni(crownGeometry({ cy: 6.0, rx: 1.0, ry: 0.9, cards: 14, size: 1.2, seed: 83, tint: 0xc4d4a4, filler: false }));
      side.translate(1.3, 0, 0.4);
      parts.push(side);
      return mergeGeometries(parts)!;
    };
    chunked(this.scene, this.chunks, cyp, cypCrown(), cLeaf, { far: 420, shadow: true });
    void treeGeometry;
    void cypressGeometry;
    chunked(this.scene, this.chunks, groups.get('bush') ?? [], shrubGeometry(), std(), { far: 250, shadow: false });
    // shrubs, hedges and flower beds round houses and parks; the grass field
    const pl = placePlants(this.map);
    chunked(this.scene, this.chunks, pl.shrubs, shrubGeometry(), std({ roughness: 0.9 }), { far: 170, shadow: false, lodGeo: bushGeometry(), lodDist: 45 });
    chunked(this.scene, this.chunks, pl.hedges, hedgeGeometry(), std({ roughness: 0.9 }), { far: 150, shadow: false, lodGeo: bushGeometry(), lodDist: 45 });
    chunked(this.scene, this.chunks, pl.mounds, moundGeometry(), std({ roughness: 0.9 }), { far: 90, shadow: false });
    chunked(this.scene, this.chunks, pl.blossoms, blossomGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.7 }), { far: 90, shadow: false });
    this.grass = new Grass(this.scene, this.map);
    chunked(this.scene, this.chunks, groups.get('lamp') ?? [], lampGeometry(), std({ roughness: 0.5, metalness: 0.5 }), { far: 380, shadow: true });
    chunked(this.scene, this.chunks, lampHeads, new THREE.BoxGeometry(1, 1, 1), this.lampHeadMat, { far: 600, shadow: false, receive: false });
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    const pm = chunked(this.scene, this.chunks, pools, poolGeo, this.poolMat, { far: 260, shadow: false, receive: false });
    pm.forEach((m) => (m.renderOrder = 2));
    chunked(this.scene, this.chunks, groups.get('umbrella') ?? [], umbrellaGeometry(), std({ side: THREE.DoubleSide }), { far: 300, shadow: true });
    chunked(this.scene, this.chunks, groups.get('lounger') ?? [], loungerGeometry(), std(), { far: 160, shadow: false });
    chunked(this.scene, this.chunks, groups.get('tower') ?? [], lifeguardGeometry(), std(), { far: 600, shadow: true });
  }

  private buildFurniture() {
    const items = placeFurniture(this.map);
    const by = new Map<FurnitureKind, Inst[]>();
    for (const it of items) {
      let l = by.get(it.kind);
      if (!l) by.set(it.kind, (l = []));
      l.push({ m: it.m });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    const glassy = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });
    // solid street furniture: you bump into planters, bins, hydrants and news boxes (and can vault them)
    const SOLID: Partial<Record<FurnitureKind, [number, number]>> = { planter: [0.5, 1.0], bin: [0.3, 0.95], hydrant: [0.2, 0.75], news: [0.3, 1.15] };
    const pv = new THREE.Vector3();
    for (const it of items) {
      const sz = SOLID[it.kind];
      if (!sz) continue;
      pv.setFromMatrixPosition(it.m);
      const r = sz[0];
      this.map.colliders.add(pv.x - r, pv.z - r, pv.x + r, pv.z + r, pv.y - 0.2, pv.y + sz[1], true);
    }
    for (const [kind, list] of by) {
      chunked(this.scene, this.chunks, list, furnitureGeometry(kind), kind === 'shelter' ? glassy : mat, { far: kind === 'shelter' || kind === 'sign' ? 380 : 220, shadow: true });
    }
  }

  private buildBridge() {
    const deck = new MB();
    const sides = new MB();
    const x0 = 388 + ROAD_HALF, x1 = 600 - ROAD_HALF;
    const N = 60;
    const z0 = BRIDGE.z - ROAD_HALF, z1 = BRIDGE.z + ROAD_HALF;
    const zw0 = BRIDGE.z - BRIDGE.half, zw1 = BRIDGE.z + BRIDGE.half;
    for (let i = 0; i < N; i++) {
      const xa = x0 + ((x1 - x0) * i) / N, xb = x0 + ((x1 - x0) * (i + 1)) / N;
      const ya = groundAt(xa, BRIDGE.z) + 0.02, yb = groundAt(xb, BRIDGE.z) + 0.02;
      const va = (xa - x0) / 24, vb = (xb - x0) / 24;
      // road surface, u across (0 = north edge)
      deck.quad([xa, ya, z1], [xb, yb, z1], [xb, yb, z0], [xa, ya, z0], [1, va], [1, vb], [0, vb], [0, va]);
      if (xb > BRIDGE.x0 && xa < BRIDGE.x1) {
        const da = Math.max(ya - 1.3, WATER_Y), db = Math.max(yb - 1.3, WATER_Y);
        // walkway strips
        sides.quad([xa, ya + 0.1, zw1], [xb, yb + 0.1, zw1], [xb, yb + 0.1, z1], [xa, ya + 0.1, z1], [0, 0], [1, 0], [1, 1], [0, 1]);
        sides.quad([xa, ya + 0.1, z0], [xb, yb + 0.1, z0], [xb, yb + 0.1, zw0], [xa, ya + 0.1, zw0], [0, 0], [1, 0], [1, 1], [0, 1]);
        // outer faces and underside
        sides.quad([xa, da, zw1], [xb, db, zw1], [xb, yb + 0.1, zw1], [xa, ya + 0.1, zw1], [0, 0], [1, 0], [1, 1], [0, 1]);
        sides.quad([xb, db, zw0], [xa, da, zw0], [xa, ya + 0.1, zw0], [xb, yb + 0.1, zw0], [0, 0], [1, 0], [1, 1], [0, 1]);
        sides.quad([xa, da, zw0], [xb, db, zw0], [xb, db, zw1], [xa, da, zw1], [0, 0], [1, 0], [1, 1], [0, 1]);
      }
    }
    this.add(deck.geo(), D(new THREE.MeshStandardMaterial({ map: T.roadTexture(), roughness: 0.9 }), 'asphalt_02', { scale: 6, albedo: 0.7, normal: 0.9, rough: [0.55, 0.95] }));
    const sideMat = new THREE.MeshStandardMaterial({ map: T.concreteTexture(), color: 0xf3efe8, roughness: 0.8, side: THREE.DoubleSide });
    this.add(sides.geo(), sideMat, true);
    // railings, pillars, pylons
    const parts: THREE.BufferGeometry[] = [];
    for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 2) {
      const y = bridgeDeckY(x + 1);
      const slope = Math.atan2(bridgeDeckY(x + 2) - bridgeDeckY(x), 2);
      for (const s of [-1, 1]) {
        const rail = new THREE.BoxGeometry(2.05, 0.12, 0.12);
        rail.rotateZ(slope);
        rail.translate(x + 1, y + 1.15, BRIDGE.z + s * (BRIDGE.half - 0.2));
        parts.push(prep(rail, 0xffffff));
        parts.push(box(0.1, 1.05, 0.1, x, y + 0.6, BRIDGE.z + s * (BRIDGE.half - 0.2), 0xffffff));
      }
    }
    for (let x = BRIDGE.x0 + 20; x < BRIDGE.x1 - 10; x += 30) {
      const y = bridgeDeckY(x);
      for (const s of [-1, 1]) parts.push(cyl(1.0, 1.2, y + 5.5, 8, x, (y - 6) / 2 - 0.4, BRIDGE.z + s * 4, 0xe7e1d6));
    }
    const px = (BRIDGE.x0 + BRIDGE.x1) / 2, pyTop = bridgeDeckY(px) + 34;
    for (const s of [-1, 1]) {
      const pz = BRIDGE.z + s * (BRIDGE.half + 1.2);
      parts.push(box(1.8, pyTop + 6, 1.8, px, (pyTop - 6) / 2, pz, 0xf7f5f0));
      parts.push(box(2.4, 1.2, 2.4, px, pyTop, pz, 0x29c7c0));
    }
    parts.push(box(1.4, 1.2, BRIDGE.half * 2 + 4, px, pyTop - 4, BRIDGE.z, 0xf7f5f0));
    this.add(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), true);
    // stay cables
    const lines: number[] = [];
    for (const s of [-1, 1]) {
      const pz = BRIDGE.z + s * (BRIDGE.half + 1.2);
      for (let k = 1; k <= 7; k++) {
        for (const dir of [-1, 1]) {
          const cx = px + dir * k * 10;
          lines.push(px, pyTop - 1 - k * 1.5, pz, cx, bridgeDeckY(cx) + 1.2, BRIDGE.z + s * (BRIDGE.half - 0.2));
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const cables = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xf0f0f0 }));
    this.scene.add(cables);
    // aircraft beacons on the pylons
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), this.beaconMat);
      b.position.set(px, pyTop + 1, BRIDGE.z + s * (BRIDGE.half + 1.2));
      this.scene.add(b);
    }
  }

  private buildDocks() {
    const parts: THREE.BufferGeometry[] = [];
    for (const d of this.map.docks) {
      parts.push(box(d.x1 - d.x0, 0.35, d.z1 - d.z0, (d.x0 + d.x1) / 2, d.y - 0.175, (d.z0 + d.z1) / 2, 0xa98b67));
      const long = d.x1 - d.x0 > d.z1 - d.z0;
      const len = long ? d.x1 - d.x0 : d.z1 - d.z0;
      for (let t = 2; t < len; t += 6) {
        for (const s of [0, 1]) {
          const x = long ? d.x0 + t : s ? d.x1 - 0.2 : d.x0 + 0.2;
          const z = long ? (s ? d.z1 - 0.2 : d.z0 + 0.2) : d.z0 + t;
          parts.push(cyl(0.16, 0.16, 3.6, 5, x, -1.3, z, 0x6f5a43));
        }
      }
    }
    this.add(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), true);
  }

  private buildLandmarks() {
    // lighthouse at the south tip of Coquina Key
    const parts: THREE.BufferGeometry[] = [];
    const lx = 700, lz = ISLAND.z1 - 14;
    for (let i = 0; i < 6; i++) {
      const r0 = 3.2 - i * 0.3, r1 = 3.2 - (i + 1) * 0.3;
      parts.push(cyl(r1, r0, 4, 12, lx, 2 + i * 4, lz, i % 2 ? 0xd94b4b : 0xfaf8f2));
    }
    parts.push(cyl(1.9, 1.9, 0.4, 12, lx, 24.2, lz, 0x333333));
    parts.push(cyl(1.0, 1.6, 1.2, 8, lx, 27.4, lz, 0xd94b4b));
    this.add(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), true);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 10), this.beaconMat);
    lamp.position.set(lx, 25.6, lz);
    this.scene.add(lamp);
    this.map.colliders.add(lx - 3.2, lz - 3.2, lx + 3.2, lz + 3.2, -1, 30);
    // water tower in Sabal Heights
    const wt: THREE.BufferGeometry[] = [];
    const wx = -280, wz = 210;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) wt.push(cyl(0.25, 0.3, 22, 6, wx + sx * 3, 11, wz + sz * 3, 0x9aa5ad));
    wt.push(cyl(5.5, 5.5, 7, 16, wx, 25, wz, 0x8fd3e8));
    const cap = new THREE.ConeGeometry(5.6, 2.5, 16);
    cap.translate(wx, 29.7, wz);
    wt.push(prep(cap, 0x8fd3e8));
    this.add(merge(wt), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), true);
    this.map.colliders.add(wx - 3.5, wz - 3.5, wx + 3.5, wz + 3.5, -1, 30);
  }

  update(cam: THREE.Vector3, night: number, elapsed: number) {
    this.chunks.update(cam);
    this.grass?.update(cam, elapsed);
    cityUniforms.uNight.value = night;
    cityUniforms.uTime.value = elapsed;
    const k = 0.55 + night * 2.4;
    this.lampHeadMat.color.setRGB(k, k * 0.88, k * 0.66);
    this.poolMat.opacity = clamp(night * 0.32, 0, 0.32);
    const n = 0.7 + night * 1.8;
    this.neonMat.color.setRGB(n, n, n);
    const sn = 0.55 + night * 3.2;
    this.signMat.color.setRGB(sn, sn, sn);
    const blink = Math.sin(elapsed * 3) > 0 ? 1 : 0.2;
    const bk = (0.6 + night * 3) * blink;
    this.beaconMat.color.setRGB(bk * 1.0, bk * 0.25, bk * 0.2);
  }
}

// ------------------------------------------------------------ neon hotel signs
const NEON_NAMES = ['SEABRIGHT', 'CORALINE', 'AZURA', 'SOLANA', 'LUNA MAR', 'PALMETTO', 'THE VESPER', 'MARISOL', 'TIDEWATER', 'BELLAMAR'];
const NEON_COLS = ['#ff4fa0', '#38e8ff', '#ffd23f', '#b57bff', '#5dff9e', '#ff7a3c'];

/** one atlas: each name lettered top to bottom in its own column, in a neon tube colour */
function neonSignMaterial(): THREE.MeshBasicMaterial {
  const n = NEON_NAMES.length, cw = 96, ch = 1024;
  const c = document.createElement('canvas');
  c.width = cw * n;
  c.height = ch;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0d0f14';
  x.fillRect(0, 0, c.width, ch);
  NEON_NAMES.forEach((name, i) => {
    const col = NEON_COLS[i % NEON_COLS.length];
    const letters = name.replace(/ /g, '').split('');
    const step = (ch - 60) / letters.length;
    x.font = `bold ${Math.min(84, step * 0.92)}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.shadowColor = col;
    x.shadowBlur = 18;
    x.fillStyle = col;
    letters.forEach((l, k) => x.fillText(l, i * cw + cw / 2, 30 + step * (k + 0.5)));
    x.shadowBlur = 0;
    x.fillStyle = '#fffaf0';
    x.font = `bold ${Math.min(84, step * 0.92) * 0.82}px system-ui, sans-serif`;
    letters.forEach((l, k) => x.fillText(l, i * cw + cw / 2, 30 + step * (k + 0.5)));
    x.strokeStyle = col;
    x.lineWidth = 5;
    x.strokeRect(i * cw + 6, 6, cw - 12, ch - 12);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv.x = (vMapUv.x + aCell) / ${n}.0;`);
  };
  m.customProgramCacheKey = () => 'palmera-neon-sign';
  return m;
}

function helipadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3a3d40';
  x.beginPath();
  x.arc(128, 128, 126, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#f2c14e';
  x.lineWidth = 10;
  x.beginPath();
  x.arc(128, 128, 104, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = '#f4f4f0';
  x.fillRect(84, 66, 22, 124);
  x.fillRect(150, 66, 22, 124);
  x.fillRect(100, 117, 56, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A shop awning in unit space: x across the shopfront (-0.5..0.5), z out from the wall (0..1), the
 * canopy sloping down 0.5 m to a valance whose hem is scalloped in the shader. aPart: 0 canopy,
 * 1 valance, 2 side cheeks (plain colour).
 */
function awningGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], part: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], k: number) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) part.push(k);
  };
  const drop = -0.5, hem = -0.78;
  quad([-0.5, 0, 0], [0.5, 0, 0], [0.5, drop, 1], [-0.5, drop, 1], 0);
  quad([-0.5, drop, 1], [0.5, drop, 1], [0.5, hem, 1], [-0.5, hem, 1], 1);
  for (const x of [-0.5, 0.5]) {
    pos.push(x, 0, 0, x, drop, 1, x, hem, 1);
    pos.push(x, 0, 0, x, hem, 1, x, hem * 0.35, 0.12);
    for (let i = 0; i < 6; i++) part.push(2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.computeVertexNormals();
  return g;
}

/** striped canvas: stripes ~0.45 m wide whatever the awning's length, white over the awning colour */
function awningMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.88, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;\nvarying float vU;\nvarying float vY;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPart = aPart;
vY = position.y;
#ifdef USE_INSTANCING
vU = position.x * length(instanceMatrix[0].xyz);
#else
vU = position.x;
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying float vU;\nvarying float vY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (vPart < 1.5) {
  // the hem: a scallop every stripe
  float s = fract(vU / 0.9);
  if (vPart > 0.5 && vY < -0.66 - 0.12 * sin(s * 3.14159)) discard;
  float stripe = step(0.5, fract(vU / 0.9));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.85), stripe);
}
// the underside in its own shade, a touch of light through the canvas
if (!gl_FrontFacing) diffuseColor.rgb *= 0.82;`,
      );
  };
  m.customProgramCacheKey = () => 'palmera-awning-v1';
  return m;
}

/** rooftop clutter, built standing on y = 0 */
function roofKitGeometry(kind: 'ac' | 'vent' | 'tank' | 'mast'): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  if (kind === 'ac') {
    // a condenser: a box on a low frame, a fan in a dark ring on top, grille slats on the face
    P.push(box(1.5, 0.08, 1.1, 0, 0.04, 0, 0x55585c));
    P.push(box(1.4, 0.85, 1.0, 0, 0.5, 0, 0xc9cbcd));
    P.push(cyl(0.4, 0.4, 0.05, 14, 0.25, 0.95, 0, 0x202224));
    P.push(cyl(0.08, 0.08, 0.07, 8, 0.25, 0.97, 0, 0x7a7d80));
    for (let i = 0; i < 5; i++) P.push(box(0.02, 0.6, 0.9, -0.71, 0.5, -0.36 + i * 0.18, 0x8d9094));
  } else if (kind === 'vent') {
    P.push(cyl(0.13, 0.13, 1.1, 10, 0, 0.55, 0, 0x8f9397));
    P.push(cyl(0.02, 0.3, 0.18, 10, 0, 1.2, 0, 0x6c7074));
  } else if (kind === 'tank') {
    // a timber water tank on a steel stand, banded, with a conical lid
    for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) P.push(box(0.14, 2.4, 0.14, x, 1.2, z, 0x3a3d40));
    P.push(box(2.3, 0.12, 2.3, 0, 2.42, 0, 0x3a3d40));
    P.push(cyl(1.15, 1.15, 2.4, 18, 0, 3.68, 0, 0x7d5c3e));
    for (const y of [2.9, 3.6, 4.3]) P.push(cyl(1.17, 1.17, 0.07, 18, 0, y, 0, 0x2a2b2d));
    P.push(cyl(0.05, 1.25, 0.8, 18, 0, 5.28, 0, 0x5b4330));
  } else {
    // a lattice antenna mast with a couple of dishes
    P.push(cyl(0.07, 0.09, 9, 6, 0, 4.5, 0, 0x2c2f33));
    for (let i = 1; i < 6; i++) P.push(box(0.9 - i * 0.1, 0.05, 0.05, 0, i * 1.5, 0, 0x2c2f33));
    P.push(cyl(0.32, 0.05, 0.12, 12, 0.3, 5.5, 0, 0xd8d9da, 'x'));
    P.push(cyl(0.25, 0.05, 0.1, 12, -0.26, 7, 0, 0xd8d9da, 'x'));
    P.push(box(0.12, 0.12, 0.12, 0, 9.05, 0, 0xc81e1e));
  }
  return merge(P);
}
