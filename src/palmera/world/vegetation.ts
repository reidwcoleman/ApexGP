// Plants: a field of grass tufts that follows the camera across every lawn, park and the swamp
// (masked by a 1 px-per-metre map of where grass actually grows, so none comes up through roads,
// sidewalks, drives, pools or houses), plus shrubs, hedges and flower beds round houses and parks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAIN, SIDEWALK, type CityMap } from './map';

const X0 = MAIN.x0, Z0 = MAIN.z0, W = 820, H = MAIN.z1 - MAIN.z0; // the grass lives west of x = 100
const PATCH = 80; // the tiled field around the camera (m)
const GRID = 160; // tufts per side of the patch

/** the grass map: R = how thick, G = how tall (the swamp's reeds) */
function grassMask(map: CityMap): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  const rect = (x0: number, z0: number, x1: number, z1: number) => c.fillRect(x0 - X0, z0 - Z0, x1 - x0, z1 - z0);
  // the swamp: tall and patchy
  c.fillStyle = 'rgb(200,190,0)';
  rect(MAIN.x0, MAIN.z0, -480, MAIN.z1);
  // lawns: suburban block interiors
  // (B: mown - short, even turf; the parks and the swamp grow long)
  c.fillStyle = 'rgb(250,0,255)';
  for (const b of map.blocks) if (b.region === 'suburb') rect(b.x0 + SIDEWALK + 0.4, b.z0 + SIDEWALK + 0.4, b.x1 - SIDEWALK - 0.4, b.z1 - SIDEWALK - 0.4);
  for (const f of map.flats) if (f.kind === 'grass') {
    c.fillStyle = 'rgb(255,30,0)';
    rect(f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2);
  }
  // and everything that isn't grass
  c.fillStyle = '#000';
  for (const f of map.flats) {
    if (f.kind === 'grass') continue;
    const m = f.kind === 'pool' ? 1.2 : 0.4;
    rect(f.x - f.w / 2 - m, f.z - f.d / 2 - m, f.x + f.w / 2 + m, f.z + f.d / 2 + m);
  }
  for (const b of map.buildings) rect(b.x - b.w / 2 - 0.5, b.z - b.d / 2 - 0.5, b.x + b.w / 2 + 0.5, b.z + b.d / 2 + 0.5);
  for (const p of map.parking) rect(p.x - 3.2, p.z - 3.2, p.x + 3.2, p.z + 3.2);
  for (const r of map.paved) rect(r.x0 - 0.4, r.z0 - 0.4, r.x1 + 0.4, r.z1 + 0.4);
  // swamp roads
  c.strokeStyle = '#000';
  c.lineWidth = 11;
  c.lineCap = 'round';
  for (const e of map.edges) {
    const a = map.nodes[e.a], b = map.nodes[e.b];
    if (Math.min(a.x, b.x) > -470) continue;
    c.beginPath();
    c.moveTo(a.x - X0, a.z - Z0);
    c.lineTo(b.x - X0, b.z - Z0);
    c.stroke();
  }
  // soften the edges by a metre so tufts thin out toward curbs
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** one tuft: five tapered, slightly curved blades round a point, unit height */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let b = 0; b < 10; b++) {
    const a = (b / 10) * Math.PI * 2 + b * 0.7;
    const r = 0.03 + (b % 4) * 0.05;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const lean = 0.18 + (b % 2) * 0.12;
    const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
    const px = -Math.sin(a), pz = Math.cos(a);
    const w = 0.019;
    const base = pos.length / 3;
    const ring = (h: number, wd: number, bend: number) => {
      pos.push(ox + dx * bend - px * wd, h, oz + dz * bend - pz * wd, ox + dx * bend + px * wd, h, oz + dz * bend + pz * wd);
    };
    ring(0, w, 0);
    ring(0.5, w * 0.7, 0.3);
    pos.push(ox + dx, 1, oz + dz);
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly mesh: THREE.Mesh;
  private readonly u = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uMask: { value: null as THREE.Texture | null }, uBox: { value: new THREE.Vector4(X0, Z0, W, H) } };

  constructor(scene: THREE.Scene, map: CityMap) {
    this.u.uMask.value = grassMask(map);
    const base = tuftGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    const n = GRID * GRID;
    const off = new Float32Array(n * 2), rnd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const gx = i % GRID, gz = Math.floor(i / GRID);
      off[i * 2] = ((gx + Math.random()) / GRID) * PATCH;
      off[i * 2 + 1] = ((gz + Math.random()) / GRID) * PATCH;
      rnd[i * 3] = Math.random();
      rnd[i * 3 + 1] = Math.random();
      rnd[i * 3 + 2] = Math.random();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
    g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 3));
    g.instanceCount = n;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 aOff; attribute vec3 aRnd;
uniform vec3 uCam; uniform float uTime; uniform sampler2D uMask; uniform vec4 uBox;
varying float vH; varying vec3 vTint;`)
        .replace('#include <begin_vertex>', `
vec2 cell = aOff + ${PATCH.toFixed(1)} * floor((uCam.xz - aOff) / ${PATCH.toFixed(1)} + 0.5);
vec2 muv = (cell - uBox.xy) / uBox.zw;
vec4 mk = (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0) ? textureLod(uMask, muv, 0.0) : vec4(0.0);
float mown = step(0.5, mk.b);
float patchy = mix(0.75 + 0.25 * sin(cell.x * 0.21 + sin(cell.y * 0.17) * 2.0), 1.0, mown);
float keep = step(aRnd.x, mk.r * patchy);
float dist = length(cell - uCam.xz);
float fade = 1.0 - smoothstep(12.0, 37.0, dist);
fade = fade * fade * (1.0 - mk.g * 0.35 * smoothstep(8.0, 30.0, dist));
float hgt = mix(mix(0.13, 0.3, aRnd.y), mix(0.06, 0.11, aRnd.y), mown) * (1.0 + mk.g * 3.2) * keep * fade;
float ang = aRnd.z * 6.2832;
float cs = cos(ang), sn = sin(ang);
vec3 transformed = position;
transformed.xz *= keep * (0.6 + 0.5 * aRnd.y) * (1.0 + mk.g) * mix(1.0, 0.55, mown);
transformed.y *= hgt;
transformed.xz = vec2(cs * transformed.x - sn * transformed.z, sn * transformed.x + cs * transformed.z);
float wind = sin(uTime * 1.7 + cell.x * 0.31 + cell.y * 0.23) * 0.6 + sin(uTime * 3.3 + cell.x * 1.7 + cell.y) * 0.25;
transformed.x += wind * 0.16 * position.y * position.y * hgt * 2.0;
transformed.z += wind * 0.07 * position.y * position.y * hgt * 2.0;
transformed.xz += cell;
transformed.y += 0.02;
vH = position.y;
float dry = smoothstep(0.55, 0.95, sin(cell.x * 0.09 + 1.3) * sin(cell.y * 0.11) * 0.5 + 0.5 + aRnd.y * 0.25);
vTint = mix(mix(vec3(0.85, 1.0, 0.85), vec3(1.08, 1.04, 0.8), aRnd.z), vec3(1.3, 1.05, 0.6), dry * 0.25);
vTint = mix(vTint, vec3(0.95, 0.85, 0.5), mk.g * 0.75);
// mown turf: greener and even, the cut tips a touch paler
vTint = mix(vTint, vec3(0.95, 1.05, 0.85) * (0.92 + 0.12 * aRnd.z), mown * 0.8);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vTint;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4(mix(vec3(0.065, 0.14, 0.03), vec3(0.17, 0.33, 0.075), vH) * vTint, 1.0);')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n// lit mostly like the lawn they grow from: thin blades facing sideways went near black whenever the sun was not behind you\nnormal = normalize(mix(normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.78));');
    };
    // no depth write: the AO pass reads depth, and thousands of thin blades read as deep crevices (near-black grass at dusk).
    // Drawn after everything opaque, so they still hide behind and in front of the right things; blade-vs-blade order doesn't show.
    mat.depthWrite = false;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  update(cam: THREE.Vector3, t: number) {
    this.u.uCam.value.copy(cam);
    this.u.uTime.value = t;
    // nothing to draw over downtown / the island or from high up
    this.mesh.visible = cam.x < 130 && cam.y < 90;
  }
}

// ---------------------------------------------------------------- shrubs and flowers
/**
 * Leaf-card shrubs from Blender (tools/palmera/foliage.py): a rendered leaf atlas (leaves.webp,
 * alpha-cut) on quads around each bush's shell, normals pointing out from the bush's middle so the
 * whole bush shades as one soft volume. Falls back to the lumpy icosahedra below.
 */
const foliageKit = new Map<string, THREE.BufferGeometry>();
let leafTex: THREE.Texture | null = null;

export async function loadFoliageKit(): Promise<void> {
  const base = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'palmera/';
  try {
    const [gl, tex] = await Promise.all([new GLTFLoader().loadAsync(base + 'foliage.glb'), new THREE.TextureLoader().loadAsync(base + 'leaves.webp')]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    leafTex = tex;
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const r = /^fol_(\w+)$/.exec(o.name);
      if (!m.isMesh || !r) return;
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const p = g.getAttribute('position');
      const src = g.getAttribute('color');
      const n = p.count;
      const col = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      g.computeBoundingBox();
      const cy = (g.boundingBox!.min.y + g.boundingBox!.max.y) * 0.5;
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        col.set(src ? [src.getX(i), src.getY(i), src.getZ(i)] : [1, 1, 1], i * 3);
        v.set(p.getX(i), (p.getY(i) - cy) * 1.4 + 0.3, p.getZ(i)).normalize();
        nor.set([v.x, v.y, v.z], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
      g.computeBoundingSphere();
      foliageKit.set(r[1], g);
    });
  } catch (e) {
    console.warn('palmera: foliage kit failed, using the lumpy shrubs', e);
  }
}

/** the leaf-card version of a shrub kind (or its _lod), if the kit loaded */
export function foliageGeometry(name: string): THREE.BufferGeometry | null {
  const g = foliageKit.get(name);
  return g ? g.clone() : null;
}

let foliageMat: THREE.MeshStandardMaterial | null = null;
/** alpha-cut leaves, lit from both sides as the bush's volume (no back-face normal flip) */
export function foliageMaterial(): THREE.MeshStandardMaterial | null {
  if (!leafTex) return null;
  if (foliageMat) return foliageMat;
  const m = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => 'palmera-foliage-v1';
  foliageMat = m;
  return m;
}
function lobed(lobes: number, seed: number, cols: [number, number]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const lo = new THREE.Color(cols[0]), hi = new THREE.Color(cols[1]);
  for (let i = 0; i < lobes; i++) {
    const g = new THREE.IcosahedronGeometry(0.32 + r() * 0.2, 1);
    const a = (i / lobes) * Math.PI * 2 * 2.3 + r();
    const d = i === 0 ? 0 : 0.25 + r() * 0.45;
    g.translate(Math.cos(a) * d, 0.35 + r() * 0.45 + (i === 0 ? 0.3 : 0) - d * 0.3, Math.sin(a) * d);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = Math.sin(x * 17.1 + z * 13.3) * Math.sin(y * 15.7 + x * 9.1) + 0.5 * Math.sin(x * 31.0 - y * 27.0 + z * 23.0);
      p.setXYZ(k, x * (1 + n * 0.07), Math.max(0, y * (1 + n * 0.06)), z * (1 + n * 0.07));
      const hsh = Math.abs(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5) % 1;
      c.copy(lo).lerp(hi, THREE.MathUtils.clamp(y / 1.2 + n * 0.2, 0, 1)).multiplyScalar(0.7 + hsh * 0.5);
      col.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const m = mergeVertices(g, 1e-3);
    m.computeVertexNormals();
    parts.push(m);
  }
  return mergeGeometries(parts)!;
}

export function shrubGeometry(): THREE.BufferGeometry {
  return foliageGeometry('shrub') ?? lobed(7, 7, [0x172a0e, 0x4f6e26]);
}
export function hedgeGeometry(): THREE.BufferGeometry {
  return foliageGeometry('hedge') ?? lobed(5, 19, [0x15260c, 0x3f5e1e]);
}
/** a cluster of blossoms (white, tinted per instance) that sits on a small mound */
/** the low mound under a flower bed */
export function moundGeometry(): THREE.BufferGeometry {
  return foliageGeometry('mound') ?? lobed(3, 23, [0x15260c, 0x3f5e1e]);
}
export function blossomGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 30; i++) {
    const g = new THREE.OctahedronGeometry(0.04 + r() * 0.03, 0);
    g.deleteAttribute('uv');
    g.scale(1, 0.55, 1);
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.5;
    g.translate(Math.cos(a) * d, 0.3 + r() * 0.08 - d * 0.18, Math.sin(a) * d);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

const FLOWER_COLS = [0xff5f8f, 0xffd23f, 0xffffff, 0xff7b3a, 0xc77dff, 0xff3b4f];

export interface PlantInst {
  m: THREE.Matrix4;
  c?: THREE.Color;
}

/** where the shrubs, hedges and flower beds go */
export function placePlants(map: CityMap): { shrubs: PlantInst[]; hedges: PlantInst[]; mounds: PlantInst[]; blossoms: PlantInst[] } {
  const shrubs: PlantInst[] = [], hedges: PlantInst[] = [], mounds: PlantInst[] = [], blossoms: PlantInst[] = [];
  let s = 4242;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const put = (list: PlantInst[], x: number, z: number, sc: number, sy = sc, c?: THREE.Color) => {
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    // not across a front path or a driveway (world/houses.ts lays them before the plants go in)
    for (const pv of map.paved) if (x > pv.x0 - 0.8 && x < pv.x1 + 0.8 && z > pv.z0 - 0.8 && z < pv.z1 + 0.8) return;
    list.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 0.03, z), q, new THREE.Vector3(sc, sy, sc)), c });
  };
  const bed = (x: number, z: number) => {
    const col = new THREE.Color(FLOWER_COLS[Math.floor(r() * FLOWER_COLS.length)]);
    const sc = 0.7 + r() * 0.4;
    put(mounds, x, z, sc * 0.6, sc * 0.32);
    put(blossoms, x, z, sc, sc, col);
  };
  const free = (x: number, z: number) => {
    for (const p of map.parking) if (Math.abs(p.x - x) < 3.5 && Math.abs(p.z - z) < 3.5) return false;
    return true;
  };
  for (const b of map.buildings) {
    if (b.style !== 2 || b.y0 !== 0) continue;
    // a hedge or a row of shrubs along some sides, flowers in front of them
    const sides = [
      { x0: b.x - b.w / 2, z0: b.z - b.d / 2 - 1.1, x1: b.x + b.w / 2, z1: b.z - b.d / 2 - 1.1, ox: 0, oz: -1 },
      { x0: b.x - b.w / 2, z0: b.z + b.d / 2 + 1.1, x1: b.x + b.w / 2, z1: b.z + b.d / 2 + 1.1, ox: 0, oz: 1 },
      { x0: b.x - b.w / 2 - 1.1, z0: b.z - b.d / 2, x1: b.x - b.w / 2 - 1.1, z1: b.z + b.d / 2, ox: -1, oz: 0 },
      { x0: b.x + b.w / 2 + 1.1, z0: b.z - b.d / 2, x1: b.x + b.w / 2 + 1.1, z1: b.z + b.d / 2, ox: 1, oz: 0 },
    ];
    for (const sd of sides) {
      if (r() < 0.45) continue;
      const len = Math.hypot(sd.x1 - sd.x0, sd.z1 - sd.z0);
      const hedge = r() < 0.4;
      const step = hedge ? 1.0 : 2.2 + r();
      for (let t = 0.8; t < len - 0.8; t += step) {
        const x = sd.x0 + ((sd.x1 - sd.x0) * t) / len, z = sd.z0 + ((sd.z1 - sd.z0) * t) / len;
        if (!free(x, z)) continue;
        if (hedge) put(hedges, x, z, 0.62, 0.7 + r() * 0.1);
        else put(shrubs, x, z, 0.45 + r() * 0.3);
        if (!hedge && r() < 0.6) bed(x + sd.ox * 1.0, z + sd.oz * 1.0);
      }
    }
  }
  // parks: shrubs round the edge, beds scattered
  for (const f of map.flats) {
    if (f.kind !== 'grass') continue;
    const x0 = f.x - f.w / 2 + 1.8, x1 = f.x + f.w / 2 - 1.8, z0 = f.z - f.d / 2 + 1.8, z1 = f.z + f.d / 2 - 1.8;
    for (let x = x0; x < x1; x += 3.5 + r() * 2) {
      put(shrubs, x, z0, 0.5 + r() * 0.35);
      put(shrubs, x, z1, 0.5 + r() * 0.35);
    }
    for (let z = z0; z < z1; z += 3.5 + r() * 2) {
      put(shrubs, x0, z, 0.5 + r() * 0.35);
      put(shrubs, x1, z, 0.5 + r() * 0.35);
    }
    for (let i = 0; i < (f.w * f.d) / 90; i++) {
      const cx = x0 + 3 + r() * (x1 - x0 - 6), cz = z0 + 3 + r() * (z1 - z0 - 6);
      for (let k = 0; k < 3 + r() * 4; k++) bed(cx + (r() - 0.5) * 3, cz + (r() - 0.5) * 3);
    }
  }
  return { shrubs, hedges, mounds, blossoms };
}

// ---------------------------------------------------------------- broadleaf trees
/** a square of leaves on transparent ground: many small rotated leaves, a dense middle */
export function leafTexture(): THREE.Texture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const leaf = (x: number, y: number, len: number, a: number, l: number) => {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    const g = Math.floor(95 + l * 90), rr = Math.floor(45 + l * 45), b = Math.floor(25 + l * 25);
    c.fillStyle = `rgb(${rr},${g},${b})`;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0);
    c.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0);
    c.fill();
    c.strokeStyle = `rgba(20,40,10,0.35)`;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(len, 0);
    c.stroke();
    c.restore();
  };
  // twigs
  c.strokeStyle = 'rgb(70,55,38)';
  c.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    c.moveTo(S / 2, S / 2);
    const a = r() * Math.PI * 2;
    c.lineTo(S / 2 + Math.cos(a) * S * 0.4, S / 2 + Math.sin(a) * S * 0.4);
    c.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * S * 0.44;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    leaf(x, y, 16 + r() * 16, a + (r() - 0.5) * 1.4, r());
  }
  // a solid core so the filler (uv 0.5,0.5) is opaque
  for (let i = 0; i < 30; i++) leaf(S / 2 + (r() - 0.5) * 20, S / 2 + (r() - 0.5) * 20, 18, r() * 6.3, r());
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface CrownOpts {
  cy: number;
  rx: number;
  ry: number;
  cards: number;
  size: number;
  seed: number;
  tint: number;
  filler: boolean;
}

/** a canopy of leaf cards facing out from an ellipsoid, normals bent outward for soft round shading */
export function crownGeometry(o: CrownOpts): THREE.BufferGeometry {
  let s = o.seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const tint = new THREE.Color(o.tint);
  const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), rt = new THREE.Vector3(), u2 = new THREE.Vector3(), cpos = new THREE.Vector3(), sn = new THREE.Vector3();
  for (let i = 0; i < o.cards; i++) {
    // a point in the outer shell, biased upward
    const th = r() * Math.PI * 2, ph = Math.acos(1 - 2 * Math.pow(r(), 0.8));
    const k = 0.55 + r() * 0.45;
    n.set(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    cpos.set(n.x * o.rx * k, o.cy + n.y * o.ry * k, n.z * o.rx * k);
    // facing outward with a twist
    sn.copy(n).add(new THREE.Vector3((r() - 0.5) * 0.8, (r() - 0.2) * 0.6, (r() - 0.5) * 0.8)).normalize();
    rt.crossVectors(up, sn);
    if (rt.lengthSq() < 1e-3) rt.set(1, 0, 0);
    rt.normalize();
    u2.crossVectors(sn, rt).normalize();
    const tw = r() * Math.PI * 2, cs = Math.cos(tw), si = Math.sin(tw);
    const a = rt.clone().multiplyScalar(cs).addScaledVector(u2, si), b = rt.clone().multiplyScalar(-si).addScaledVector(u2, cs);
    const h = o.size * (0.75 + r() * 0.5) * 0.5;
    const base = pos.length / 3;
    const shade = 0.82 + 0.3 * (k - 0.55) / 0.45 + 0.12 * n.y;
    const hv = 0.9 + r() * 0.2;
    const sh = new THREE.Vector3(n.x * 0.75, n.y * 0.75 + 0.35, n.z * 0.75).normalize();
    for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(cpos.x + (a.x * p + b.x * q) * h, cpos.y + (a.y * p + b.y * q) * h, cpos.z + (a.z * p + b.z * q) * h);
      nor.push(sh.x, sh.y, sh.z);
      uv.push((p + 1) / 2, (q + 1) / 2);
      col.push(tint.r * shade * hv, tint.g * shade, tint.b * shade * (2 - hv));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  if (!o.filler) return g;
  // a dark core so the canopy doesn't look hollow
  const f = new THREE.IcosahedronGeometry(1, 1);
  f.scale(o.rx * 0.62, o.ry * 0.6, o.rx * 0.62);
  f.translate(0, o.cy, 0);
  const fu = f.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < fu.count; i++) fu.setXY(i, 0.5, 0.5);
  const fc = new Float32Array(fu.count * 3);
  for (let i = 0; i < fu.count; i++) fc.set([tint.r * 0.6, tint.g * 0.6, tint.b * 0.6], i * 3);
  f.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  return mergeGeometries([ni(g), f.index ? ni(f) : f])!;
}

/** a trunk splitting into branches that reach up into the canopy */
export function trunkGeometry(h: number, r0: number, branches: number, seed: number, crownY: number, crownR: number, color = 0x5b4634): THREE.BufferGeometry {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [];
  const seg = (a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number) => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(rb, ra, d.length(), 7, 2);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    g.deleteAttribute('uv');
    parts.push(ni(g));
  };
  const top = new THREE.Vector3((r() - 0.5) * 0.3, h, (r() - 0.5) * 0.3);
  seg(new THREE.Vector3(0, -0.2, 0), top, r0, r0 * 0.7);
  seg(top, new THREE.Vector3(top.x * 1.3, crownY + 0.5, top.z * 1.3), r0 * 0.7, r0 * 0.3);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + r();
    const from = new THREE.Vector3(top.x * (0.6 + r() * 0.4), h * (0.75 + r() * 0.3), top.z * (0.6 + r() * 0.4));
    const to = new THREE.Vector3(Math.cos(a) * crownR * (0.5 + r() * 0.3), crownY + (r() - 0.3) * 0.8, Math.sin(a) * crownR * (0.5 + r() * 0.3));
    seg(from, to, r0 * 0.42, r0 * 0.12);
  }
  const g = mergeGeometries(parts)!;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3), bc = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const v = 0.8 + 0.25 * Math.sin(p.getY(i) * 9 + p.getX(i) * 13);
    c.set([bc.r * v, bc.g * v, bc.b * v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
