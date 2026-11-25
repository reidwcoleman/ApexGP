// Builds all static city meshes from the CityMap: ground, roads, buildings, props, bridge and docks.
import * as THREE from 'three';
import { box, cyl, merge, prep } from '../core/geo';
import { Rng, clamp } from '../core/math';
import {
  BEACH, BRIDGE, CityMap, ISLAND, MAIN, ROAD_HALF, SIDEWALK, WATER_Y, bridgeDeckY, groundAt, groundBase,
  type BuildingSpec, type PropSpec,
} from './map';
import * as T from './textures';

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
varying vec3 vBN; varying vec3 vLP; varying vec3 vBS; varying vec2 vStyle;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 bScale = vec3(1.0);
vec3 bNorm = objectNormal;
#ifdef USE_INSTANCING
bScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
bNorm = mat3(instanceMatrix) * objectNormal;
#endif
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
varying vec3 vBN; varying vec3 vLP; varying vec3 vBS; varying vec2 vStyle;
float bhash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 bn = normalize(vBN);
float bStyle = vStyle.x;
float wmask = 0.0; float wlit = 0.0; vec3 litCol = vec3(1.0, 0.78, 0.5);
if (bn.y > 0.5) {
  diffuseColor.rgb *= 0.7;
} else if (bn.y > -0.5 && bStyle < 3.5) {
  bool sideX = abs(bn.x) > 0.5;
  float u = sideX ? vLP.z : vLP.x;
  float halfW = sideX ? vBS.z * 0.5 : vBS.x * 0.5;
  float face = sideX ? sign(bn.x) : 2.0 * sign(bn.z);
  float v = vLP.y;
  vec2 cell = vec2(3.6, 3.2); vec2 fr = vec2(0.55, 0.5); float y0 = 0.8;
  if (bStyle < 0.5) { cell = vec2(3.0, 3.6); fr = vec2(0.9, 0.78); y0 = 0.3; }
  else if (bStyle < 1.5) { cell = vec2(3.4, 3.3); fr = vec2(0.48, 0.5); y0 = 1.2; }
  else if (bStyle < 2.5) { cell = vec2(3.6, 3.0); fr = vec2(0.34, 0.4); y0 = 0.3; }
  float nCols = max(floor((2.0 * halfW - 1.2) / cell.x), 0.0);
  float off = (2.0 * halfW - nCols * cell.x) * 0.5;
  float uu = (u + halfW - off) / cell.x;
  float vv = (v - y0) / cell.y;
  vec2 f = fract(vec2(uu, vv));
  vec2 id = floor(vec2(uu, vv));
  float inside = step(abs(f.x - 0.5), fr.x * 0.5) * step(abs(f.y - 0.5), fr.y * 0.5);
  inside *= step(0.0, uu) * step(uu, nCols) * step(0.0, vv) * step(v, vBS.y - 0.9);
  wmask = inside;
  float r = bhash(vec3(id, face * 7.0 + vStyle.y * 91.0));
  float litP = bStyle < 0.5 ? 0.3 : 0.4;
  if (v < 4.0 && bStyle > 0.5) litP = 0.85;
  wlit = step(r, litP) * inside;
  litCol = r < 0.06 ? vec3(0.55, 0.75, 1.0) : (r < 0.16 ? vec3(1.0, 0.85, 0.6) : vec3(1.0, 0.62, 0.3));
  vec3 glassCol = bStyle < 0.5 ? vec3(0.2, 0.32, 0.4) : vec3(0.13, 0.18, 0.22);
  // vertical mullion stripes on towers
  if (bStyle < 0.5) {
    float mull = step(0.92, fract(uu * 2.0));
    glassCol = mix(glassCol, diffuseColor.rgb * 0.8, mull);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, wmask);
  if (bStyle > 0.5 && bStyle < 1.5) {
    float band = step(fract(vv), 0.09) * step(0.0, vv);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.95, 0.9), band * (1.0 - wmask));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98, 0.97, 0.94), step(vBS.y - 0.9, v));
    // racing stripes near the corners
    float edge = halfW - abs(u);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.98), step(edge, 0.6) * step(0.35, edge) * (1.0 - wmask));
  }
  if (bStyle > 2.5 && v < 0.7) diffuseColor.rgb *= 0.55;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.06, wmask);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, bStyle < 0.5 ? 0.9 : 0.55, wmask);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += litCol * wlit * uNight * 1.05;`,
      );
  };
  mat.customProgramCacheKey = () => 'palmera-building';
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
    this.add(g1.geo(), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
    const g2 = new MB();
    g2.flat(80, MAIN.z0, MAIN.x1, MAIN.z1, 0, 8);
    g2.flat(ISLAND.x0, ISLAND.z0, BEACH.x0, ISLAND.z1, 0, 8);
    this.add(g2.geo(), new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, color: 0xf2ece2 }));
    const g3 = new MB();
    g3.flat(MAIN.x0, MAIN.z0, -480, MAIN.z1, 0, 20);
    this.add(g3.geo(), new THREE.MeshStandardMaterial({ map: mud, roughness: 1 }));
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
    this.add(b.geo(), new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }));
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
    this.add(merge(sw), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
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
    this.add(roads.geo(), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 }));
    this.add(swamp.geo(), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 1, color: 0xb8a888 }));
    this.add(inter.geo(), new THREE.MeshStandardMaterial({ map: T.intersectionTexture(), roughness: 0.92 }));
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
    this.add(mb.geo(), new THREE.MeshStandardMaterial({ map: T.concreteTexture(), roughness: 0.88, color: 0xe9e3d8 }));
  }

  private buildFlats() {
    const kinds: Record<string, { mb: MB; mat: THREE.Material; y: number; rep: number }> = {
      pool: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ color: 0x38c6e6, roughness: 0.05, metalness: 0.1, emissive: 0x0a3a48 }), y: 0.07, rep: 4 },
      rim: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8 }), y: 0.05, rep: 4 },
      pond: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ color: 0x2f3a22, roughness: 0.08, metalness: 0.3 }), y: 0.04, rep: 8 },
      court: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ map: T.courtTexture(), roughness: 0.9 }), y: 0.04, rep: 1 },
      lot: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ map: T.lotTexture(), roughness: 0.92 }), y: 0.03, rep: 10 },
      plaza: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ map: T.concreteTexture(), color: 0xf7e2c8, roughness: 0.85 }), y: 0.04, rep: 3 },
      grass: { mb: new MB(), mat: new THREE.MeshStandardMaterial({ map: T.grassTexture(), roughness: 0.95 }), y: 0.035, rep: 20 },
    };
    for (const f of this.map.flats) {
      const k = kinds[f.kind];
      const x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
      if (f.kind === 'court') {
        k.mb.quad([x0, k.y, z1], [x1, k.y, z1], [x1, k.y, z0], [x0, k.y, z0], [0, 0], [1, 0], [1, 1], [0, 1]);
      } else k.mb.flat(x0, z0, x1, z1, k.y, k.rep);
      if (f.kind === 'pool') kinds.rim.mb.flat(x0 - 0.8, z0 - 0.8, x1 + 0.8, z1 + 0.8, kinds.rim.y, 4);
    }
    for (const k of Object.values(kinds)) if (k.mb.pos.length) this.add(k.mb.geo(), k.mat);
  }

  private buildBuildings() {
    const mat = buildingMaterial();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const big: Inst[] = [], small: Inst[] = [], roofs: Inst[] = [], neon: Inst[] = [];
    const neonCols = [0xff5fa2, 0x29e0d0, 0xb57bff, 0xffb347, 0x5fd3ff];
    const rng = new Rng(77);
    const q = new THREE.Quaternion();
    for (const b of this.map.buildings) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      const it: Inst = { m, c: new THREE.Color(b.color), a: [b.style, b.seed] };
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
    const attr = { name: 'aStyle', size: 2 };
    chunked(this.scene, this.chunks, big, geo, mat, { far: 2200, shadow: true, attr });
    chunked(this.scene, this.chunks, small, geo, mat, { far: 750, shadow: true, attr });
    const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    chunked(this.scene, this.chunks, roofs, roofGeometry(), roofMat, { far: 700, shadow: true });
    const ng = new THREE.BoxGeometry(1, 1, 1);
    chunked(this.scene, this.chunks, neon, ng, this.neonMat, { far: 1500, shadow: false, receive: false });
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
    chunked(this.scene, this.chunks, palms, palmGeometry(true), palmMat, { far: 520, shadow: true, lodGeo: palmGeometry(false), lodDist: 140 });
    chunked(this.scene, this.chunks, groups.get('tree') ?? [], treeGeometry(true), std(), { far: 420, shadow: true, lodGeo: treeGeometry(false), lodDist: 120 });
    chunked(this.scene, this.chunks, groups.get('cypress') ?? [], cypressGeometry(), std(), { far: 420, shadow: true });
    chunked(this.scene, this.chunks, groups.get('bush') ?? [], bushGeometry(), std(), { far: 250, shadow: false });
    chunked(this.scene, this.chunks, groups.get('lamp') ?? [], lampGeometry(), std({ roughness: 0.5, metalness: 0.5 }), { far: 380, shadow: true });
    chunked(this.scene, this.chunks, lampHeads, new THREE.BoxGeometry(1, 1, 1), this.lampHeadMat, { far: 600, shadow: false, receive: false });
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    const pm = chunked(this.scene, this.chunks, pools, poolGeo, this.poolMat, { far: 260, shadow: false, receive: false });
    pm.forEach((m) => (m.renderOrder = 2));
    chunked(this.scene, this.chunks, groups.get('umbrella') ?? [], umbrellaGeometry(), std({ side: THREE.DoubleSide }), { far: 300, shadow: true });
    chunked(this.scene, this.chunks, groups.get('lounger') ?? [], loungerGeometry(), std(), { far: 160, shadow: false });
    chunked(this.scene, this.chunks, groups.get('tower') ?? [], lifeguardGeometry(), std(), { far: 600, shadow: true });
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
    this.add(deck.geo(), new THREE.MeshStandardMaterial({ map: T.roadTexture(), roughness: 0.9 }));
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
    cityUniforms.uNight.value = night;
    cityUniforms.uTime.value = elapsed;
    const k = 0.55 + night * 3.2;
    this.lampHeadMat.color.setRGB(k, k * 0.88, k * 0.66);
    this.poolMat.opacity = clamp(night * 0.95, 0, 0.95);
    const n = 0.7 + night * 2.6;
    this.neonMat.color.setRGB(n, n, n);
    const blink = Math.sin(elapsed * 3) > 0 ? 1 : 0.2;
    const bk = (0.6 + night * 3) * blink;
    this.beaconMat.color.setRGB(bk * 1.0, bk * 0.25, bk * 0.2);
  }
}
