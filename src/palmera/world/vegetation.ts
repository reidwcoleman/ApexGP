// Plants: a field of grass tufts that follows the camera across every lawn, park and the swamp
// (masked by a 1 px-per-metre map of where grass actually grows, so none comes up through roads,
// sidewalks, drives, pools or houses), plus shrubs, hedges and flower beds round houses and parks.
import * as THREE from 'three';
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
  c.fillStyle = 'rgb(85,255,0)';
  rect(MAIN.x0, MAIN.z0, -480, MAIN.z1);
  // lawns: suburban block interiors
  c.fillStyle = 'rgb(235,40,0)';
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
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + b * 0.7;
    const r = 0.03 + (b % 4) * 0.05;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const lean = 0.18 + (b % 2) * 0.12;
    const dx = Math.cos(a) * lean, dz = Math.sin(a) * lean;
    const px = -Math.sin(a), pz = Math.cos(a);
    const w = 0.028;
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
float patchy = 0.75 + 0.25 * sin(cell.x * 0.21 + sin(cell.y * 0.17) * 2.0);
float keep = step(aRnd.x, mk.r * patchy);
float dist = length(cell - uCam.xz);
float fade = 1.0 - smoothstep(12.0, 37.0, dist);
fade = fade * fade * (1.0 - mk.g * 0.35 * smoothstep(8.0, 30.0, dist));
float hgt = mix(0.13, 0.3, aRnd.y) * (1.0 + mk.g * 3.2) * keep * fade;
float ang = aRnd.z * 6.2832;
float cs = cos(ang), sn = sin(ang);
vec3 transformed = position;
transformed.xz *= keep * (0.6 + 0.5 * aRnd.y) * (1.0 + mk.g);
transformed.y *= hgt;
transformed.xz = vec2(cs * transformed.x - sn * transformed.z, sn * transformed.x + cs * transformed.z);
float wind = sin(uTime * 1.7 + cell.x * 0.31 + cell.y * 0.23) * 0.6 + sin(uTime * 3.3 + cell.x * 1.7 + cell.y) * 0.25;
transformed.x += wind * 0.16 * position.y * position.y * hgt * 2.0;
transformed.z += wind * 0.07 * position.y * position.y * hgt * 2.0;
transformed.xz += cell;
transformed.y += 0.02;
vH = position.y;
float dry = smoothstep(0.55, 0.95, sin(cell.x * 0.09 + 1.3) * sin(cell.y * 0.11) * 0.5 + 0.5 + aRnd.y * 0.25);
vTint = mix(mix(vec3(0.85, 1.0, 0.8), vec3(1.0, 1.0, 0.75), aRnd.z), vec3(1.3, 1.1, 0.6), dry * 0.45);
vTint = mix(vTint, vec3(0.72, 0.8, 0.52), mk.g * 0.7);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vTint;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4(mix(vec3(0.045, 0.075, 0.02), vec3(0.17, 0.25, 0.07), vH) * vTint, 1.0);')
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    this.mesh = new THREE.Mesh(g, mat);
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
function lobed(lobes: number, seed: number, cols: [number, number]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const lo = new THREE.Color(cols[0]), hi = new THREE.Color(cols[1]);
  for (let i = 0; i < lobes; i++) {
    const g = new THREE.IcosahedronGeometry(0.32 + r() * 0.2, 2).toNonIndexed();
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
  return lobed(11, 7, [0x172a0e, 0x4f6e26]);
}
export function hedgeGeometry(): THREE.BufferGeometry {
  return lobed(8, 19, [0x15260c, 0x3f5e1e]);
}
/** a cluster of blossoms (white, tinted per instance) that sits on a small mound */
export function blossomGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const g = new THREE.IcosahedronGeometry(0.035 + r() * 0.03, 0).toNonIndexed();
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
