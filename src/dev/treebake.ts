import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptSimplifier } from 'meshoptimizer';

/**
 * The tree bake, run in headless Chrome by tools/bake_trees.mjs (offline only).
 *
 * Source: Poly Haven's scanned / sculpted CC0 trees (tools/trees_fetch.py → assets-src/trees/),
 * hundreds of thousands to millions of triangles each — far too heavy for the game. From each
 * one this page makes what the game actually draws (src/world/env/treeproto.ts loads it):
 *
 *   impostor frames   the full-resolution tree rendered from 8 directions around it (albedo +
 *                     coverage, view-space normal + crown AO), 256 px a frame, super-sampled 4×
 *                     and edge-dilated so the mips don't bleed. Everything beyond ~100 m.
 *   leaf sprays       a few real sprays of the tree's own leaves per scan (every leaf and twig of
 *                     one k-means cell of the crown — a branch tip, a stretch of fir bough — seen
 *                     face-on): the textures of the near trees' leaf cards.
 *   near geometry     three LODs per tree (treeproto.ts decodes them): the scanned trunk + limbs
 *                     decimated with meshoptimizer (vertex colour = the scan's own bark albedo), and
 *                     one leaf card per k-means cell of the real leaves — hundreds of small sprays,
 *                     each lying in its cell's own plane along its own axis (PCA), so the crown
 *                     keeps the scan's shape, gaps, layered boughs and all. Wind weights (trunk bend,
 *                     limb sway, phase) are shared by wood and cards so leaves stay on their limbs.
 *   bark              a tile of the jacaranda's trunk scan (normal + albedo), the near trunks'
 *                     detail texture.
 *
 * Crown AO everywhere comes from a Beer–Lambert estimate over a leaf-area-density grid of the
 * scan: how much foliage lies between a point and the sky.
 */

export interface ProtoSpec {
  id: string;
  asset: string;
  /** which root node of the glTF (several trees share a file) */
  node: number;
  species: string;
  /** target height in metres */
  H: number;
  /** source metres cut off the bottom (a rock / sand base) */
  sink?: number;
  /** extra non-uniform scale after normalising (a poplar from a round crown) */
  stretch?: [number, number, number];
  /** leaf sprays (cards) for LOD0 / LOD1 / LOD2 (LOD2 is also every near tree's shadow caster) */
  K: [number, number, number];
  /** how far the leaf cards turn toward the camera about their own axis (0 = fixed planes, 1 = axial billboards) */
  bb?: number;
  /** spray textures baked for the atlas (per source asset) */
  sprays?: number;
  /** cards a little bigger than their cells: fills a sparse scan out (the firs: a spruce plantation
   *  edge is a dark wall, the fir scan is airy) */
  cardScale?: number;
  /** leaf size on the cards relative to the (height-normalised) scan: < 1 when normalising blew a small
   *  tree's leaves up — the textures then come from proportionally bigger cells */
  leafScale?: number;
  /** trunk + limbs triangle budgets for LOD0 / LOD1 / LOD2 */
  wood: [number, number, number];
  /** alpha cut-off for the leaf masks (lower = fuller foliage; thin conifer twigs need it) */
  cut?: number;
  /** coverage gain on the baked frames / clumps: needles cover a texel only partly, and the game's
   *  alpha test at 0.5 would thin a spruce to a skeleton */
  alphaGain?: number;
}

const SRC = '/assets-src/trees/';
const W = window as unknown as Record<string, unknown>;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(512, 512);
document.body.appendChild(renderer.domElement);
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};

// ------------------------------------------------------------------------------------ loading

interface Part {
  kind: 'leaf' | 'wood';
  name: string;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
  map: THREE.Texture | null;
  alpha: THREE.Texture | null;
  normal: THREE.Texture | null;
  /** the colour map, small, for sampling vertex colours */
  px: { data: Uint8ClampedArray; w: number; h: number } | null;
  /** fraction of a leaf card's area that is leaf (alpha coverage) */
  cover: number;
  /** alpha cut-off */
  cut: number;
}

const gltfs = new Map<string, Promise<{ gltf: GLTF; json: { materials: { name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[]; textures: { source: number }[]; images: { uri: string }[] } }>>();
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
function loadAsset(asset: string) {
  let p = gltfs.get(asset);
  if (!p) {
    p = (async () => {
      const gltf = await loader.loadAsync(`${SRC}${asset}/${asset}.gltf`);
      const json = gltf.parser.json;
      return { gltf, json };
    })();
    gltfs.set(asset, p);
  }
  return p;
}

const alphaCache = new Map<string, Promise<THREE.Texture | null>>();
function loadAlpha(url: string): Promise<THREE.Texture | null> {
  let p = alphaCache.get(url);
  if (!p) {
    p = fetch(url, { method: 'HEAD' }).then((r) =>
      r.ok && (r.headers.get('content-type') ?? '').startsWith('image')
        ? texLoader.loadAsync(url).then((t) => {
            t.colorSpace = THREE.NoColorSpace;
            t.flipY = false;
            return t;
          })
        : null,
    );
    alphaCache.set(url, p);
  }
  return p;
}

function samplePixels(tex: THREE.Texture | null, size = 256) {
  if (!tex?.image) return null;
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(tex.image as CanvasImageSource, 0, 0, size, size);
  return { data: g.getImageData(0, 0, size, size).data, w: size, h: size };
}

/** average coverage of an alpha mask (the share of a leaf card that is leaf) */
function coverage(tex: THREE.Texture | null): number {
  const px = samplePixels(tex, 128);
  if (!px) return 1;
  let s = 0;
  for (let i = 0; i < px.data.length; i += 4) s += px.data[i] > 127 ? 1 : 0;
  return Math.max(0.15, s / (px.data.length / 4));
}

async function loadParts(spec: ProtoSpec): Promise<Part[]> {
  const { gltf, json } = await loadAsset(spec.asset);
  const root = gltf.scene.children[spec.node];
  if (!root) throw new Error(`${spec.asset}: no node ${spec.node}`);
  const parts: Part[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    const name = mat.name;
    const leaf = /leaves|twig/i.test(name) && !/dead/i.test(name);
    // the colour map's uri → the separately downloaded cut-out mask (trees_fetch.py)
    const jm = json.materials.find((x) => x.name === name);
    const ti = jm?.pbrMetallicRoughness?.baseColorTexture?.index;
    const uri = ti !== undefined ? json.images[json.textures[ti].source].uri : '';
    const aUrl = `${SRC}${spec.asset}/${uri.replace(/_diff_1k\.jpg$/, '_alpha_1k.png')}`;
    const alpha = uri ? await loadAlpha(aUrl) : null;
    const g = m.geometry;
    // (a mesh under a translated child would need its matrix: these files keep geometry in the node's space)
    m.updateMatrixWorld(true);
    const rel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(m.matrixWorld);
    const pa = g.attributes.position as THREE.BufferAttribute;
    const na = g.attributes.normal as THREE.BufferAttribute;
    const ua = g.attributes.uv as THREE.BufferAttribute;
    const n = pa.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(rel);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(rel);
      pos.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      nor.set([v.x, v.y, v.z], i * 3);
      if (ua) uv.set([ua.getX(i), ua.getY(i)], i * 2);
    }
    const idx = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: n }, (_, i) => i);
    parts.push({ kind: leaf ? 'leaf' : 'wood', name, pos, nor, uv, idx, map: mat.map, alpha, normal: mat.normalMap, px: samplePixels(mat.map), cover: alpha ? coverage(alpha) : 1, cut: leaf ? (spec.cut ?? 0.5) : 0.5 });
  }
  return parts;
}

// ------------------------------------------------------------------------------------ normalise

interface Tree {
  parts: Part[];
  H: number;
  /** max horizontal reach from the trunk */
  radius: number;
  bmin: THREE.Vector3;
  bmax: THREE.Vector3;
  crownC: THREE.Vector3;
  crownR: THREE.Vector3;
  ao: AOField;
}

function normalise(parts: Part[], spec: ProtoSpec): Omit<Tree, 'ao'> {
  // pivot: the trunk's foot
  let minY = Infinity, maxY = -Infinity;
  for (const p of parts)
    for (let i = 1; i < p.pos.length; i += 3) {
      if (p.kind === 'wood') minY = Math.min(minY, p.pos[i]);
      maxY = Math.max(maxY, p.pos[i]);
    }
  let sx = 0, sz = 0, sn = 0;
  for (const p of parts) {
    if (p.kind !== 'wood') continue;
    for (let i = 0; i < p.pos.length; i += 3)
      if (p.pos[i + 1] < minY + (maxY - minY) * 0.04 + (spec.sink ?? 0)) {
        sx += p.pos[i];
        sz += p.pos[i + 2];
        sn++;
      }
  }
  const px = sn ? sx / sn : 0, pz = sn ? sz / sn : 0;
  const baseY = minY + (spec.sink ?? 0);
  const s = spec.H / (maxY - baseY);
  const [kx, ky, kz] = spec.stretch ?? [1, 1, 1];
  const bmin = new THREE.Vector3(Infinity, Infinity, Infinity), bmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let radius = 0;
  for (const p of parts) {
    for (let i = 0; i < p.pos.length; i += 3) {
      const x = (p.pos[i] - px) * s * kx, y = (p.pos[i + 1] - baseY) * s * ky, z = (p.pos[i + 2] - pz) * s * kz;
      p.pos[i] = x;
      p.pos[i + 1] = y;
      p.pos[i + 2] = z;
      let nx = p.nor[i] / kx, ny = p.nor[i + 1] / ky, nz = p.nor[i + 2] / kz;
      const l = Math.hypot(nx, ny, nz) || 1;
      p.nor[i] = nx / l;
      p.nor[i + 1] = ny / l;
      p.nor[i + 2] = nz / l;
      if (y > -0.05) {
        bmin.min(new THREE.Vector3(x, y, z));
        bmax.max(new THREE.Vector3(x, y, z));
        radius = Math.max(radius, Math.hypot(x, z));
      }
    }
    // drop what is now underground (a rock or sand base)
    if (spec.sink) {
      const keep: number[] = [];
      for (let t = 0; t < p.idx.length; t += 3) {
        const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2];
        if (Math.max(p.pos[a * 3 + 1], p.pos[b * 3 + 1], p.pos[c * 3 + 1]) > -0.02) keep.push(a, b, c);
      }
      p.idx = Uint32Array.from(keep);
    }
  }
  bmin.y = 0;
  // (the frame's width: the 99.5th percentile of the horizontal reach, so one stray twig can't shrink the tree in it)
  {
    const rs: number[] = [];
    for (const p of parts) for (let i = 0; i < p.pos.length; i += 3 * 7) if (p.pos[i + 1] > -0.05) rs.push(Math.hypot(p.pos[i], p.pos[i + 2]));
    rs.sort((a, b) => a - b);
    radius = rs[Math.floor(rs.length * 0.995)] ?? radius;
  }
  // crown: the leaves' extent
  const lmin = new THREE.Vector3(Infinity, Infinity, Infinity), lmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  for (const p of parts) {
    if (p.kind !== 'leaf') continue;
    for (let i = 0; i < p.pos.length; i += 3) {
      v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
      lmin.min(v);
      lmax.max(v);
    }
  }
  const crownC = lmin.clone().add(lmax).multiplyScalar(0.5);
  const crownR = lmax.clone().sub(lmin).multiplyScalar(0.5);
  return { parts, H: bmax.y, radius, bmin, bmax, crownC, crownR };
}

// ------------------------------------------------------------------------------------ AO field

interface AOField {
  n: [number, number, number];
  o: THREE.Vector3;
  cell: number;
  ao: Float32Array;
  at(x: number, y: number, z: number): number;
}

/**
 * Sky visibility through the foliage: leaf area density on a grid (one-sided leaf area per m³,
 * cards weighted by their alpha coverage), then for every cell the transmittance toward 20 sky
 * directions, T = exp(−G · LAD · path) with G = 0.5 (randomly oriented leaves), cosine-weighted.
 */
function aoField(parts: Part[], bmin: THREE.Vector3, bmax: THREE.Vector3): AOField {
  const ext = bmax.clone().sub(bmin);
  const cell = Math.max(ext.x, ext.y, ext.z) / 40;
  const o = bmin.clone().addScalar(-cell);
  const n: [number, number, number] = [Math.ceil(ext.x / cell) + 3, Math.ceil(ext.y / cell) + 3, Math.ceil(ext.z / cell) + 3];
  const [nx, ny, nz] = n;
  const dens = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (const p of parts) {
    const P = p.pos;
    const w = p.kind === 'leaf' ? p.cover : 0.6;
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const i = Math.floor(((P[a] + P[b] + P[c]) / 3 - o.x) / cell);
      const j = Math.floor(((P[a + 1] + P[b + 1] + P[c + 1]) / 3 - o.y) / cell);
      const k = Math.floor(((P[a + 2] + P[b + 2] + P[c + 2]) / 3 - o.z) / cell);
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
      dens[id(i, j, k)] += area * w;
    }
  }
  const vol = cell * cell * cell;
  for (let i = 0; i < dens.length; i++) dens[i] /= vol;
  // sky directions: a golden spiral over the upper hemisphere plus a ring just below the horizon
  const dirs: [number, number, number, number][] = [];
  const N = 20;
  for (let q = 0; q < N; q++) {
    const y = q < 16 ? 1 - (q + 0.5) / 16 : -0.15;
    const r = Math.sqrt(1 - y * y);
    const th = q * 2.39996;
    dirs.push([Math.cos(th) * r, y, Math.sin(th) * r, Math.max(0.12, y)]);
  }
  const ao = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let sum = 0, wsum = 0;
        for (const [dx, dy, dz, w] of dirs) {
          let x = i + 0.5 + dx * 0.5, y = j + 0.5 + dy * 0.5, z = k + 0.5 + dz * 0.5;
          let tau = 0;
          for (let s = 0; s < 80; s++) {
            x += dx;
            y += dy;
            z += dz;
            const ii = Math.floor(x), jj = Math.floor(y), kk = Math.floor(z);
            if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) break;
            tau += dens[id(ii, jj, kk)] * cell * 0.5;
          }
          sum += Math.exp(-tau) * w;
          wsum += w;
        }
        ao[id(i, j, k)] = sum / wsum;
      }
  const at = (x: number, y: number, z: number) => {
    const fx = (x - o.x) / cell - 0.5, fy = (y - o.y) / cell - 0.5, fz = (z - o.z) / cell - 0.5;
    const i0 = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(ny - 2, Math.floor(fy))), k0 = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i0)), ty = Math.max(0, Math.min(1, fy - j0)), tz = Math.max(0, Math.min(1, fz - k0));
    let r = 0;
    for (let c = 0; c < 8; c++) {
      const a = c & 1, b = (c >> 1) & 1, d = (c >> 2) & 1;
      r += ao[id(i0 + a, j0 + b, k0 + d)] * (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (d ? tz : 1 - tz);
    }
    return r;
  };
  return { n, o, cell, ao, at };
}

// ------------------------------------------------------------------------------------ rendering

const BAKE_VERT = /* glsl */ `
attribute float aAO;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vVP;
varying float vAO;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  vAO = aAO;
  vN = normalize( normalMatrix * normal );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vVP = - mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BAKE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uAlpha;
uniform sampler2D uNorm;
uniform float uHasMap;
uniform float uHasAlpha;
uniform float uCut;
uniform float uHasNorm;
uniform float uMode;
uniform vec3 uTint;
// a spray bake: the normal pass's alpha is how far toward the spray's front face (e3) a leaf lies
// (front 1 … back 0) instead of the crown AO — the game shades the leaves behind darker
uniform vec4 uSpray;
uniform vec3 uSprayN;
uniform float uSprayK;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vVP;
varying float vAO;
varying vec3 vP;
mat3 tangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
  vec3 q0 = dFdx( eye_pos.xyz );
  vec3 q1 = dFdy( eye_pos.xyz );
  vec2 st0 = dFdx( uv.st );
  vec2 st1 = dFdy( uv.st );
  vec3 N = surf_norm;
  vec3 q1perp = cross( q1, N );
  vec3 q0perp = cross( N, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, N );
}
void main() {
  if ( uHasAlpha > 0.5 && texture2D( uAlpha, vUv ).r < uCut ) discard;
  if ( uMode < 0.5 ) {
    // albedo, sRGB-encoded (the map is decoded to linear on sampling)
    vec3 c = uHasMap > 0.5 ? texture2D( uMap, vUv ).rgb : vec3( 0.3 );
    c *= uTint;
    gl_FragColor = vec4( pow( clamp( c, 0.0, 1.0 ), vec3( 1.0 / 2.2 ) ), 1.0 );
  } else {
    vec3 n = normalize( vN );
    if ( ! gl_FrontFacing ) n = - n;
    if ( uHasNorm > 0.5 ) {
      vec3 mapN = texture2D( uNorm, vUv ).xyz * 2.0 - 1.0;
      mapN.xy *= 0.8;
      n = normalize( tangentFrame( - vVP, n, vUv ) * mapN );
    }
    float a = uSprayK > 0.5 ? clamp( 0.5 + 0.5 * dot( vP - uSpray.xyz, uSprayN ) / uSpray.w, 0.02, 1.0 ) : vAO;
    gl_FragColor = vec4( n * 0.5 + 0.5, a );
  }
}`;

function bakeMaterial(p: Part, mode: 0 | 1, tint = new THREE.Color(1, 1, 1)) {
  return new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: p.map },
      uAlpha: { value: p.alpha },
      uNorm: { value: p.normal },
      uHasMap: { value: p.map ? 1 : 0 },
      uHasAlpha: { value: p.alpha ? 1 : 0 },
      uCut: { value: p.cut },
      uHasNorm: { value: p.normal ? 1 : 0 },
      uMode: { value: mode },
      uTint: { value: tint },
      uSpray: { value: new THREE.Vector4() },
      uSprayN: { value: new THREE.Vector3(0, 0, 1) },
      uSprayK: { value: 0 },
    },
  });
}

function partGeometry(p: Part, ao: AOField, idx = p.idx): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
  const a = new Float32Array(p.pos.length / 3);
  for (let i = 0; i < a.length; i++) a[i] = ao.at(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
  g.setAttribute('aAO', new THREE.BufferAttribute(a, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** an RGBA image under construction (top row first) */
class Img {
  data: Uint8ClampedArray;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  async png(): Promise<string> {
    const c = new OffscreenCanvas(this.w, this.h);
    c.getContext('2d')!.putImageData(new ImageData(this.data as unknown as Uint8ClampedArray<ArrayBuffer>, this.w, this.h), 0, 0);
    const b = await c.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
}

const SS = 4;
const rtCache = new Map<number, THREE.WebGLRenderTarget>();
function rtOf(size: number) {
  let rt = rtCache.get(size);
  if (!rt) {
    rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, colorSpace: THREE.NoColorSpace });
    rtCache.set(size, rt);
  }
  return rt;
}

/**
 * Render a scene with an orthographic camera into a cell×cell frame of `img` at (ox, oy),
 * super-sampled SS×: coverage → alpha, colour averaged over the covered samples.
 */
function renderFrame(scene: THREE.Scene, cam: THREE.Camera, img: Img, ox: number, oy: number, cell: number, clear: [number, number, number, number]) {
  const S = cell * SS;
  const rt = rtOf(S);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), clear[3]);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
  const buf = new Uint8Array(S * S * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
  renderer.setRenderTarget(null);
  // the clear alpha marks "empty" (0); every drawn sample writes alpha > 0 (albedo: 1, normal: AO ≥ 1/255)
  for (let y = 0; y < cell; y++)
    for (let x = 0; x < cell; x++) {
      let r = 0, g = 0, b = 0, a2 = 0, n = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          // (GL rows run bottom-up: flip into the top-down image)
          const o = ((S - 1 - (y * SS + sy)) * S + x * SS + sx) * 4;
          if (buf[o + 3] === 0) continue;
          r += buf[o];
          g += buf[o + 1];
          b += buf[o + 2];
          a2 += buf[o + 3];
          n++;
        }
      const o = ((oy + y) * img.w + ox + x) * 4;
      if (n === 0) {
        img.data[o + 3] = 0;
        continue;
      }
      img.data[o] = r / n;
      img.data[o + 1] = g / n;
      img.data[o + 2] = b / n;
      img.data[o + 3] = clear[3] === 0 ? Math.round((255 * n) / (SS * SS)) : Math.max(1, a2 / n);
    }
}

/** fill the empty texels of a frame from their covered neighbours (so mips / bilinear never pull in black) */
function dilate(img: Img, ox: number, oy: number, w: number, h: number, mask: Uint8Array, passes = 12) {
  const at = (x: number, y: number) => ((oy + y) * img.w + ox + x) * 4;
  const filled = mask.slice();
  for (let it = 0; it < passes; it++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (filled[y * w + x]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !filled[yy * w + xx]) continue;
            const o = at(xx, yy);
            r += img.data[o];
            g += img.data[o + 1];
            b += img.data[o + 2];
            n++;
          }
        if (!n) continue;
        const o = at(x, y);
        img.data[o] = r / n;
        img.data[o + 1] = g / n;
        img.data[o + 2] = b / n;
        next[y * w + x] = 1;
      }
    filled.set(next);
  }
  // whatever is still empty: the frame's mean
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++)
    if (mask[i]) {
      const o = at(i % w, Math.floor(i / w));
      r += img.data[o];
      g += img.data[o + 1];
      b += img.data[o + 2];
      n++;
    }
  for (let i = 0; i < w * h; i++)
    if (!filled[i]) {
      const o = at(i % w, Math.floor(i / w));
      img.data[o] = n ? r / n : 128;
      img.data[o + 1] = n ? g / n : 128;
      img.data[o + 2] = n ? b / n : 128;
    }
}

function gainAlpha(img: Img, ox: number, oy: number, w: number, h: number, k: number) {
  if (k === 1) return;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = ((oy + y) * img.w + ox + x) * 4 + 3;
      img.data[o] = Math.min(255, img.data[o] * k);
    }
}

function frameMask(img: Img, ox: number, oy: number, w: number, h: number) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = img.data[((oy + y) * img.w + ox + x) * 4 + 3] > 0 ? 1 : 0;
  return m;
}

// ------------------------------------------------------------------------------------ impostors

export const FRAMES = 8;

/**
 * The frame spans the tree's own width × height (not a square): every texel of the cell is used,
 * stretched as needed. Returns the card's world size: width W, height Hc (from the trunk's foot).
 */
function bakeImpostor(tree: Tree, col: Img, nrm: Img, row: number, cell: number, gain = 1): { W: number; Hc: number } {
  const W = tree.radius * 2 * 1.04;
  const Hf = tree.H * 1.03;
  const scene = new THREE.Scene();
  const meshes: [THREE.Mesh, THREE.ShaderMaterial, THREE.ShaderMaterial][] = [];
  for (const p of tree.parts) {
    const g = partGeometry(p, tree.ao);
    const mA = bakeMaterial(p, 0), mN = bakeMaterial(p, 1);
    const m = new THREE.Mesh(g, mA);
    m.frustumCulled = false;
    scene.add(m);
    meshes.push([m, mA, mN]);
  }
  // (2 % below the foot, so the trunk's base isn't clipped by bilinear filtering: the card starts at v = 0.02)
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, Hf * 0.98, -Hf * 0.02, 0.1, 400);
  for (let f = 0; f < FRAMES; f++) {
    const th = (f / FRAMES) * Math.PI * 2;
    cam.position.set(Math.sin(th) * 200, 0, Math.cos(th) * 200);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    for (const [m, mA] of meshes) m.material = mA;
    renderFrame(scene, cam, col, f * cell, row * cell, cell, [0, 0, 0, 0]);
    gainAlpha(col, f * cell, row * cell, cell, cell, gain);
    for (const [m, , mN] of meshes) m.material = mN;
    renderFrame(scene, cam, nrm, f * cell, row * cell, cell, [0.5, 0.5, 1, 0]);
    const mask = frameMask(col, f * cell, row * cell, cell, cell);
    dilate(col, f * cell, row * cell, cell, cell, mask);
    dilate(nrm, f * cell, row * cell, cell, cell, mask);
    // (normal alpha = AO where covered; the dilated rim keeps a mid AO)
    for (let i = 0; i < mask.length; i++) if (!mask[i]) nrm.data[((row * cell + Math.floor(i / cell)) * nrm.w + f * cell + (i % cell)) * 4 + 3] = 160;
  }
  for (const [m, mA, mN] of meshes) {
    m.geometry.dispose();
    mA.dispose();
    mN.dispose();
  }
  return { W, Hc: Hf * 0.98 };
}

// ------------------------------------------------------------------------------------ leaf sprays

function rngOf(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * A spray: one k-means cell of the scan's real leaves (a branch tip with its leaves — a twig of
 * needles along a fir bough), with its principal axes: e1 along the spray (toward its tip, away
 * from the trunk), e3 across its flattest dimension (the plane the leaves lie in, turned outward /
 * upward), e2 = e1 × e3; ext = half extents along e1, e2, e3 (m).
 */
interface Spray {
  c: THREE.Vector3;
  e1: THREE.Vector3;
  e2: THREE.Vector3;
  e3: THREE.Vector3;
  ext: [number, number, number];
  /** share of the tree's leaf area */
  w: number;
  /** sample points of the cell (indices into the sample array) */
  members: number[];
}

/** leaf sample points (triangle centroids, picked by area) and the mean leaf triangle size */
function leafSamples(tree: Tree, N: number, r: () => number): { pts: Float32Array; leafR: number } {
  // (typed arrays: the big firs have four million leaf triangles)
  const leafParts = tree.parts.filter((p) => p.kind === 'leaf');
  const nT = leafParts.reduce((a, p) => a + p.idx.length / 3, 0);
  const cum = new Float64Array(nT), partOf = new Uint8Array(nT), triOf = new Uint32Array(nT);
  let total = 0, n = 0;
  leafParts.forEach((p, pi) => {
    const P = p.pos;
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      cum[n] = total;
      partOf[n] = pi;
      triOf[n++] = t;
    }
  });
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const x = r() * total;
    let lo = 0, hi = nT - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m] < x) lo = m + 1;
      else hi = m;
    }
    const p = leafParts[partOf[lo]], t = triOf[lo];
    const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
    // (a random point on the triangle, not its centroid: a leaf card's area is spread over it)
    let u = r(), v = r();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    for (let k = 0; k < 3; k++) out[i * 3 + k] = p.pos[a + k] + (p.pos[b + k] - p.pos[a + k]) * u + (p.pos[c + k] - p.pos[a + k]) * v;
  }
  return { pts: out, leafR: Math.sqrt((2 * total) / Math.max(1, nT)) * 0.5 };
}

function kmeans(pts: Float32Array, K: number, r: () => number, iters = 14): { C: Float32Array; asg: Int32Array } {
  const N = pts.length / 3;
  const C = new Float32Array(K * 3);
  // k-means++ seeding
  const d2 = new Float32Array(N).fill(Infinity);
  let pick = Math.floor(r() * N);
  for (let k = 0; k < K; k++) {
    C.set(pts.subarray(pick * 3, pick * 3 + 3), k * 3);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const dx = pts[i * 3] - C[k * 3], dy = pts[i * 3 + 1] - C[k * 3 + 1], dz = pts[i * 3 + 2] - C[k * 3 + 2];
      d2[i] = Math.min(d2[i], dx * dx + dy * dy + dz * dz);
      sum += d2[i];
    }
    let x = r() * sum;
    for (pick = 0; pick < N - 1; pick++) {
      x -= d2[pick];
      if (x <= 0) break;
    }
  }
  const asg = new Int32Array(N);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < N; i++) {
      let best = 0, bd = Infinity;
      const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
      for (let k = 0; k < K; k++) {
        const dx = px - C[k * 3], dy = py - C[k * 3 + 1], dz = pz - C[k * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      asg[i] = best;
    }
    const S = new Float64Array(K * 4);
    for (let i = 0; i < N; i++) {
      const k = asg[i];
      S[k * 4] += pts[i * 3];
      S[k * 4 + 1] += pts[i * 3 + 1];
      S[k * 4 + 2] += pts[i * 3 + 2];
      S[k * 4 + 3]++;
    }
    for (let k = 0; k < K; k++) if (S[k * 4 + 3] > 0) C.set([S[k * 4] / S[k * 4 + 3], S[k * 4 + 1] / S[k * 4 + 3], S[k * 4 + 2] / S[k * 4 + 3]], k * 3);
  }
  return { C, asg };
}

/** eigenvectors of a symmetric 3×3 (Jacobi), sorted by eigenvalue, largest first */
function eig3(m: number[][]): { val: number[]; vec: THREE.Vector3[] } {
  const a = m.map((r) => r.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-12) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { val: idx.map((i) => a[i][i]), vec: idx.map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize()) };
}

/** the crown's outward direction at a point (from the trunk axis, flattened a little vertically) */
function outwardAt(tree: Tree, c: THREE.Vector3): THREE.Vector3 {
  const o = new THREE.Vector3(c.x, (c.y - tree.crownC.y) * 0.6, c.z);
  if (o.lengthSq() < 1e-4) o.set(0, 1, 0);
  return o.normalize();
}

function sprays(tree: Tree, pts: Float32Array, K: number, r: () => number, leafR: number, conifer: boolean): Spray[] {
  // (conifers: heights count AY× in the clustering, so a cell is a flat stretch of one bough layer,
  // not a ball spanning two or three layers — its plane is then the bough's own, drooping)
  const AY = conifer ? 2.6 : 1;
  const sq = AY === 1 ? pts : pts.map((v, i) => (i % 3 === 1 ? v * AY : v));
  const { C, asg } = kmeans(sq, K, r);
  if (AY !== 1) for (let k = 0; k < K; k++) C[k * 3 + 1] /= AY;
  const N = pts.length / 3;
  const mem: number[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < N; i++) mem[asg[i]].push(i);
  const out: Spray[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < K; k++) {
    const m = mem[k];
    if (m.length < 4) continue;
    const c = new THREE.Vector3(C[k * 3], C[k * 3 + 1], C[k * 3 + 2]);
    const cov = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const i of m) {
      const d = [pts[i * 3] - c.x, pts[i * 3 + 1] - c.y, pts[i * 3 + 2] - c.z];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b];
    }
    const { vec } = eig3(cov);
    const e1 = vec[0], e3 = vec[2];
    const o = outwardAt(tree, c);
    // e1 toward the spray's tip (away from the trunk; up when it stands vertical)
    if (e1.dot(o) + e1.y * 0.25 < 0) e1.negate();
    // e3: the side the leaves face — outward, and up (a fir bough's top)
    if (e3.dot(o.clone().addScaledVector(up, conifer ? 1.5 : 0.4)) < 0) e3.negate();
    const e2 = new THREE.Vector3().crossVectors(e1, e3).normalize();
    // half extents: a high percentile of the cell's points along each axis, plus half a leaf
    const pr = [e1, e2, e3].map((e) => m.map((i) => Math.abs((pts[i * 3] - c.x) * e.x + (pts[i * 3 + 1] - c.y) * e.y + (pts[i * 3 + 2] - c.z) * e.z)).sort((a, b) => a - b));
    // (not the very last stray leaf: a card's empty corners are fill the GPU pays for in every pass)
    const q = (a: number[]) => a[Math.min(a.length - 1, Math.floor(a.length * 0.92))];
    const ext: [number, number, number] = [q(pr[0]) + leafR, q(pr[1]) + leafR, q(pr[2]) + leafR];
    out.push({ c, e1, e2, e3, ext, w: m.length / N, members: m });
  }
  return out;
}

/**
 * The texture of a spray: every leaf (and twig) triangle of its k-means cell (nearest centre, so the
 * cell's own ragged shape, not a sphere cut out of the crown), seen face-on from e3 with e1 up,
 * stretched over the whole atlas cell (the card restores the aspect).
 */
function bakeSpray(tree: Tree, sp: Spray, all: Spray[], col: Img, nrm: Img, ox: number, oy: number, cell: number, gain: number) {
  const R = Math.hypot(sp.ext[0], sp.ext[1], sp.ext[2]) * 1.3;
  // the neighbouring cells a triangle near this one could belong to instead
  const neigh = all.filter((s) => s !== sp && s.c.distanceTo(sp.c) < R + Math.hypot(s.ext[0], s.ext[1], s.ext[2]) * 1.3);
  const scene = new THREE.Scene();
  const disp: { dispose(): void }[] = [];
  for (const p of tree.parts) {
    // (leaves and the twigs that carry them: never the trunk)
    if (p.kind === 'wood' && /trunk/i.test(p.name)) continue;
    const keep: number[] = [];
    const P = p.pos;
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
      const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      const dx = x - sp.c.x, dy = y - sp.c.y, dz = z - sp.c.z;
      const d0 = dx * dx + dy * dy + dz * dz;
      if (d0 > R * R) continue;
      // inside the card's box
      if (Math.abs(dx * sp.e1.x + dy * sp.e1.y + dz * sp.e1.z) > sp.ext[0] || Math.abs(dx * sp.e2.x + dy * sp.e2.y + dz * sp.e2.z) > sp.ext[1]) continue;
      let mine = true;
      for (const s of neigh) {
        const ex = x - s.c.x, ey = y - s.c.y, ez = z - s.c.z;
        if (ex * ex + ey * ey + ez * ez < d0) {
          mine = false;
          break;
        }
      }
      if (mine) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
    }
    if (!keep.length) continue;
    const g = partGeometry(p, tree.ao, Uint32Array.from(keep));
    const mA = bakeMaterial(p, 0), mN = bakeMaterial(p, 1);
    mN.uniforms.uSpray.value.set(sp.c.x, sp.c.y, sp.c.z, Math.max(0.05, sp.ext[2]));
    mN.uniforms.uSprayN.value.copy(sp.e3);
    mN.uniforms.uSprayK.value = 1;
    const m = new THREE.Mesh(g, mA);
    m.userData.mats = [mA, mN];
    m.frustumCulled = false;
    scene.add(m);
    disp.push(g, mA, mN);
  }
  const D = R * 3;
  const cam = new THREE.OrthographicCamera(-sp.ext[1], sp.ext[1], sp.ext[0], -sp.ext[0], 0.01, D * 2);
  cam.position.copy(sp.c).addScaledVector(sp.e3, D);
  cam.up.copy(sp.e1);
  cam.lookAt(sp.c);
  cam.updateMatrixWorld();
  for (const pass of [0, 1] as const) {
    scene.traverse((x) => {
      if ((x as THREE.Mesh).isMesh) (x as THREE.Mesh).material = x.userData.mats[pass];
    });
    renderFrame(scene, cam, pass ? nrm : col, ox, oy, cell, pass ? [0.5, 0.5, 1, 0] : [0, 0, 0, 0]);
  }
  gainAlpha(col, ox, oy, cell, cell, gain);
  const mask = frameMask(col, ox, oy, cell, cell);
  dilate(col, ox, oy, cell, cell, mask);
  dilate(nrm, ox, oy, cell, cell, mask);
  for (const d of disp) d.dispose();
}

// ------------------------------------------------------------------------------------ near geometry

/** a vertex of the trunk / limbs */
interface WoodV {
  p: [number, number, number];
  n: [number, number, number];
  uv: [number, number];
  c: [number, number, number];
  /** trunk bend weight, limb sway weight, ao, limb phase */
  w: [number, number, number, number];
}
/** a leaf card */
interface CardV {
  c: THREE.Vector3;
  e1: THREE.Vector3;
  e3: THREE.Vector3;
  /** lighting normal (the crown's surface there, not the card's plane) */
  ln: THREE.Vector3;
  /** width (along e2) × length (along e1), m */
  size: [number, number];
  cell: number;
  tint: number;
  ao: number;
  trunkW: number;
  limbW: number;
  phase: number;
  /** how far the card turns about e1 toward the camera (0 = a fixed plane, 1 = axial billboard) */
  bb: number;
}

/**
 * pack one LOD (treeproto.ts decodes it):
 *   wood:  pos f32×3 | nor i8×4 | uv f32×2 | albedo u8×4 | (trunkW, limbW, ao, phase) u8×4   per vertex, then idx u16
 *   cards: centre f32×3 | e1 i8×4 | e3 i8×4 | lighting normal i8×4 | width, length u16×2 (mm) |
 *          (atlas cell, tint, ao, trunkW, limbW, phase, bb, 0) u8×8                         per card
 */
function packLod(wood: WoodV[], idx: number[], cards: CardV[]): Uint8Array {
  const V = wood.length, I = idx.length, K = cards.length;
  const size = V * 32 + Math.ceil((I * 2) / 4) * 4 + K * 36;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  const f = (x: number) => (dv.setFloat32(o, x, true), (o += 4));
  const i8 = (x: number) => (dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, x)) * 127)), (o += 1));
  const u8 = (x: number) => (dv.setUint8(o, Math.round(Math.max(0, Math.min(1, x)) * 255)), (o += 1));
  const u16 = (x: number) => (dv.setUint16(o, Math.round(Math.max(0, Math.min(65535, x))), true), (o += 2));
  for (const v of wood) {
    v.p.forEach(f);
    v.n.forEach(i8);
    o++;
    v.uv.forEach(f);
    v.c.forEach(u8);
    o++;
    u8(v.w[0] / 1.5);
    u8(v.w[1] / 1.5);
    u8(v.w[2]);
    u8((((v.w[3] / (Math.PI * 2)) % 1) + 1) % 1);
  }
  for (const i of idx) u16(i);
  o = V * 32 + Math.ceil((I * 2) / 4) * 4;
  for (const k of cards) {
    f(k.c.x), f(k.c.y), f(k.c.z);
    for (const e of [k.e1, k.e3, k.ln]) {
      i8(e.x), i8(e.y), i8(e.z);
      o++;
    }
    u16(k.size[0] * 1000);
    u16(k.size[1] * 1000);
    dv.setUint8(o++, k.cell);
    u8((k.tint - 0.5) / 1);
    u8(k.ao);
    u8(k.trunkW / 1.5);
    u8(k.limbW / 1.5);
    u8((((k.phase / (Math.PI * 2)) % 1) + 1) % 1);
    u8(k.bb);
    o++;
  }
  return new Uint8Array(buf);
}

function srgbToLin(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** the albedo of a part's colour map around a uv (linear) */
function albedoAt(p: Part, u: number, v: number): [number, number, number] {
  if (!p.px) return [0.25, 0.22, 0.2];
  const { data, w, h } = p.px;
  let r = 0, g = 0, b = 0, n = 0;
  // (GLTFLoader textures are flipY=false: v = 0 is the image's top row)
  const cx = Math.floor((((u % 1) + 1) % 1) * w), cy = Math.floor((((v % 1) + 1) % 1) * h);
  for (let dy = -3; dy <= 3; dy += 2)
    for (let dx = -3; dx <= 3; dx += 2) {
      const x = (cx + dx + w) % w, y = (cy + dy + h) % h;
      const o = (y * w + x) * 4;
      r += srgbToLin(data[o]);
      g += srgbToLin(data[o + 1]);
      b += srgbToLin(data[o + 2]);
      n++;
    }
  return [r / n, g / n, b / n];
}

/**
 * Wind weights, shared by the wood and the leaf cards so the leaves stay on their branches:
 *   trunk   (height / H)² scaled by the tree's size (a 20 m tree's top moves 1 unit): the whole tree bends
 *   limb    how far out along a limb (horizontal distance from the trunk, relative to the crown) —
 *           branches swing about where they leave the trunk
 *   phase   continuous around the crown (azimuth × 2 + height), so a limb and its sprays move together
 *           and the far side of the crown is out of step with the near side
 */
function windOf(tree: Tree) {
  const R = Math.max(1, (tree.crownR.x + tree.crownR.z) / 2);
  return (x: number, y: number, z: number) => {
    const h = Math.max(0, y / tree.H);
    const r = Math.hypot(x, z);
    const trunkW = h * h * (tree.H / 20);
    const limbW = Math.min(1.45, Math.pow(Math.min(1.6, r / R), 1.4) * 0.9 + Math.max(0, h - 0.55) * 0.5);
    const phase = Math.atan2(z, x) * 2 + y * 0.31 + r * 0.45;
    return { trunkW, limbW, phase };
  };
}

function woodLOD(tree: Tree, target: number): { verts: WoodV[]; idx: number[]; tris: number } {
  // merge the wood parts
  const parts = tree.parts.filter((p) => p.kind === 'wood');
  let V = 0, I = 0;
  for (const p of parts) {
    V += p.pos.length / 3;
    I += p.idx.length;
  }
  const pos = new Float32Array(V * 3);
  const nrm = new Float32Array(V * 3);
  const idx = new Uint32Array(I);
  const owner: { p: Part; base: number }[] = [];
  let vo = 0, io = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    nrm.set(p.nor, vo * 3);
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    owner.push({ p, base: vo });
    vo += p.pos.length / 3;
    io += p.idx.length;
  }
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, target * 3, 0.02, ['Prune']);
  if (out.length > target * 3 * 1.3) [out] = MeshoptSimplifier.simplifySloppy(out, pos, 3, null, target * 3, 0.05);
  // a thin branch simplified away collapses into a big flat wedge — a dark shard in the crown. Its
  // corners keep their own (tube) normals, which then point every which way off the face: drop those
  // (a coarse but real tube's corners stay within ~60° of its faces)
  {
    const keep: number[] = [];
    for (let t = 0; t < out.length; t += 3) {
      const [a, b, c] = [out[t] * 3, out[t + 1] * 3, out[t + 2] * 3];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      const longest = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2));
      let agree = 0;
      for (const k of [a, b, c]) agree += Math.abs(fx * nrm[k] + fy * nrm[k + 1] + fz * nrm[k + 2]);
      if (agree / 3 < 0.45 && longest > 0.3 && pos[a + 1] > tree.H * 0.2) continue;
      keep.push(out[t], out[t + 1], out[t + 2]);
    }
    out = Uint32Array.from(keep);
  }
  const map = new Map<number, number>();
  const ownerOf = (vi: number) => {
    for (let k = owner.length - 1; k >= 0; k--) if (vi >= owner[k].base) return owner[k];
    return owner[0];
  };
  const wind = windOf(tree);
  const verts: WoodV[] = [];
  const ix: number[] = [];
  for (let t = 0; t < out.length; t++) {
    const vi = out[t];
    let ni = map.get(vi);
    if (ni === undefined) {
      const { p, base } = ownerOf(vi);
      const li = vi - base;
      const x = p.pos[li * 3], y = p.pos[li * 3 + 1], z = p.pos[li * 3 + 2];
      const u = p.uv[li * 2], v = p.uv[li * 2 + 1];
      const ao = tree.ao.at(x, y, z);
      const alb = albedoAt(p, u, v);
      const w = wind(x, y, z);
      // (the near trunk's albedo is the scan's own; the bark tile adds the detail around it)
      verts.push({ p: [x, y, z], n: [p.nor[li * 3], p.nor[li * 3 + 1], p.nor[li * 3 + 2]], uv: [u * 2, v * 2], c: [alb[0] * 1.6, alb[1] * 1.6, alb[2] * 1.6], w: [w.trunkW, w.limbW, Math.min(1, 0.25 + ao), w.phase] });
      ni = verts.length - 1;
      map.set(vi, ni);
    }
    ix.push(ni);
  }
  return { verts, idx: ix, tris: out.length / 3 };
}

/** the atlas sprays of one source asset: cell index + aspect (width / length) */
type SpraySet = { cell: number; aspect: number }[];

function cardsLOD(tree: Tree, list: Spray[], set: SpraySet, r: () => number, bb: number, scale: number): CardV[] {
  const wind = windOf(tree);
  const up = new THREE.Vector3(0, 1, 0);
  // outermost first (the cards are drawn in this order): seen from outside the crown the outer
  // sprays then fill the depth buffer first and most of the inner ones fail the depth test before
  // they are shaded — overdraw of lit, alpha-tested leaves is most of what a tree costs
  const shell = (sp: Spray) => -tree.ao.at(sp.c.x, sp.c.y, sp.c.z) - outwardAt(tree, sp.c).dot(new THREE.Vector3(sp.c.x, sp.c.y - tree.crownC.y, sp.c.z)) / Math.max(1, tree.radius) * 0.3;
  list = [...list].sort((a, b) => shell(a) - shell(b));
  // (a sparse cell on the crown's rim can span metres: its card would stretch a typical spray's leaves
  // to giant ones — no card more than ~1.35× the typical size; the gap that leaves is real sky)
  const med = (k: 0 | 1) => [...list].map((x) => x.ext[k]).sort((a, b) => a - b)[list.length >> 1];
  const cap0 = med(0) * 1.35, cap1 = med(1) * 1.35;
  return list.map((sp) => {
    const aspect = sp.ext[1] / sp.ext[0];
    // a texture of about the same shape (one of the nearest three)
    const near = [...set].sort((a, b) => Math.abs(Math.log(a.aspect / aspect)) - Math.abs(Math.log(b.aspect / aspect))).slice(0, 3);
    const pick = near[Math.floor(r() * near.length)];
    const o = outwardAt(tree, sp.c);
    const ln = o.clone().multiplyScalar(0.7).addScaledVector(sp.e3, 0.3).addScaledVector(up, 0.3).normalize();
    const w = wind(sp.c.x, sp.c.y, sp.c.z);
    return {
      c: sp.c,
      e1: sp.e1,
      e3: sp.e3,
      ln,
      size: [Math.min(sp.ext[1], cap1) * 2 * scale, Math.min(sp.ext[0], cap0) * 2 * scale],
      cell: pick.cell,
      tint: 0.9 + r() * 0.2,
      ao: tree.ao.at(sp.c.x, sp.c.y, sp.c.z),
      trunkW: w.trunkW,
      limbW: w.limbW,
      phase: w.phase,
      bb,
    };
  });
}

// ------------------------------------------------------------------------------------ the bake

interface ProtoOut {
  id: string;
  species: string;
  height: number;
  radius: number;
  crownR: number;
  crownY: number;
  /** impostor card width and height (m) */
  W: number;
  Hc: number;
  lods: { v: number; i: number; cards: number; off: number; bytes: number }[];
}

/** atlas sprays per source asset: near ones (LOD0's cell size) and far ones (LOD1's, for LOD1 + LOD2) —
 *  so a distant card's leaves are the size of real leaves, not blown up with the card */
const SPRAYS = 6;
const FAR_SPRAYS = 3;

async function bake(specs: ProtoSpec[], opts: { cell?: number; leafCell?: number } = {}) {
  await MeshoptSimplifier.ready;
  log.length = 0;
  const cell = opts.cell ?? 256;
  const leafCell = opts.leafCell ?? 256;
  const assets = [...new Set(specs.map((s) => s.asset))];
  const nCells = assets.reduce((a, as) => a + (specs.find((s) => s.asset === as)!.sprays ?? SPRAYS) + FAR_SPRAYS, 0);
  const LC = 8;
  const LR = Math.ceil(nCells / LC);
  const impC = new Img(FRAMES * cell, specs.length * cell);
  const impN = new Img(FRAMES * cell, specs.length * cell);
  const leafC = new Img(LC * leafCell, LR * leafCell);
  const leafN = new Img(LC * leafCell, LR * leafCell);
  const protos: ProtoOut[] = [];
  const bins: Uint8Array[] = [];
  let binOff = 0;
  let slot = 0;
  const sets = new Map<string, SpraySet[]>();
  for (let pi = 0; pi < specs.length; pi++) {
    const spec = specs[pi];
    const conifer = spec.species === 'spruce';
    const t0 = performance.now();
    const parts = await loadParts(spec);
    const base = normalise(parts, spec);
    const tree: Tree = { ...base, ao: aoField(parts, base.bmin, base.bmax) };
    const t1 = performance.now();
    const { W: cardW, Hc } = bakeImpostor(tree, impC, impN, pi, cell, spec.alphaGain ?? 1);
    const t2 = performance.now();
    const r = rngOf(9001 + pi * 7919);
    const { pts, leafR } = leafSamples(tree, Math.max(20000, spec.K[0] * 90), r);
    const spL = spec.K.map((k) => sprays(tree, pts, k, r, leafR, conifer));
    const sp0 = spL[0];
    // the atlas sprays: once per source asset, from the first prototype that uses it — sprays from
    // the crown's outer shell (where they are seen), of typical size, spanning the shapes
    let sl = sets.get(spec.asset);
    if (!sl) sets.set(spec.asset, (sl = [0, 1].map((far) => {
      const set: SpraySet = [];
      const n = far ? FAR_SPRAYS : (spec.sprays ?? SPRAYS);
      const ls = spec.leafScale ?? 1;
      const kT = Math.max(n * 3, Math.round(spec.K[far] * ls * ls * ls));
      const spT = kT === spec.K[far] ? spL[far] : sprays(tree, pts, kT, r, leafR, conifer);
      const sz = spT.map((s) => s.ext[0] * s.ext[1]).sort((a, b) => a - b);
      const lo = sz[Math.floor(sz.length * 0.35)], hi = sz[Math.floor(sz.length * 0.8)];
      const aoS = spT.map((s) => tree.ao.at(s.c.x, s.c.y, s.c.z)).sort((a, b) => a - b);
      const aoMin = aoS[Math.floor(aoS.length * 0.5)];
      // (and not the densest: a solid mat of leaves reads as a pale square, not as foliage)
      const dens = (s: Spray) => s.members.length / (s.ext[0] * s.ext[1]);
      const dS = spT.map(dens).sort((a, b) => a - b);
      const dHi = dS[Math.floor(dS.length * 0.65)];
      let cand = spT.filter((s) => s.ext[0] * s.ext[1] >= lo && s.ext[0] * s.ext[1] <= hi && tree.ao.at(s.c.x, s.c.y, s.c.z) >= aoMin && dens(s) <= dHi);
      if (cand.length < n) cand = [...spT];
      cand.sort((a, b) => a.ext[1] / a.ext[0] - b.ext[1] / b.ext[0]);
      for (let k = 0; k < n; k++) {
        const s = cand[Math.min(cand.length - 1, Math.floor(((k + 0.5) / n) * cand.length))];
        const col = slot % LC, row = Math.floor(slot / LC);
        bakeSpray(tree, s, spT, leafC, leafN, col * leafCell, row * leafCell, leafCell, spec.alphaGain ?? 1);
        set.push({ cell: slot, aspect: s.ext[1] / s.ext[0] });
        slot++;
      }
      return set;
    })));
    const t3 = performance.now();
    const lods: ProtoOut['lods'] = [];
    for (let lod = 0; lod < 3; lod++) {
      const wood = woodLOD(tree, spec.wood[lod]);
      const cards = cardsLOD(tree, spL[lod], sl[lod ? 1 : 0], rngOf(77 + pi * 31 + lod), spec.bb ?? 0.6, spec.cardScale ?? 1);
      const bytes = packLod(wood.verts, wood.idx, cards);
      bins.push(bytes);
      lods.push({ v: wood.verts.length, i: wood.idx.length, cards: cards.length, off: binOff, bytes: bytes.length });
      binOff += bytes.length;
    }
    // (the scans are hundreds of MB each: drop one as soon as no later prototype needs it)
    if (!specs.slice(pi + 1).some((x) => x.asset === spec.asset)) {
      const g = await gltfs.get(spec.asset);
      g?.gltf.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      gltfs.delete(spec.asset);
    }
    const avgR = (tree.crownR.x + tree.crownR.z) / 2;
    protos.push({ id: spec.id, species: spec.species, height: +tree.H.toFixed(3), radius: +tree.radius.toFixed(3), crownR: +avgR.toFixed(3), crownY: +tree.crownC.y.toFixed(3), W: +cardW.toFixed(3), Hc: +Hc.toFixed(3), lods });
    const med = (a: Spray[]) => [...a].sort((x, y) => x.ext[0] - y.ext[0])[a.length >> 1];
    say(`${spec.id}: H ${tree.H.toFixed(1)} m, R ${tree.radius.toFixed(1)} m, crown ${avgR.toFixed(1)} m; ${parts.map((p) => `${p.name} ${p.idx.length / 3}`).join(', ')}; lod0 ${lods[0].i / 3} wood tris + ${lods[0].cards} cards (median ${(med(sp0).ext[1] * 2).toFixed(2)} × ${(med(sp0).ext[0] * 2).toFixed(2)} m), lod1 ${lods[1].i / 3} + ${lods[1].cards}, lod2 ${lods[2].i / 3} + ${lods[2].cards}; load ${Math.round(t1 - t0)} ms, imp ${Math.round(t2 - t1)} ms, sprays ${Math.round(t3 - t2)} ms`);
  }
  // the near trunks' detail: a tile of the jacaranda's bark scan (normal + albedo)
  const bark = await bakeBark();
  const bin = new Uint8Array(binOff);
  let o = 0;
  for (const b of bins) {
    bin.set(b, o);
    o += b.length;
  }
  let s = '';
  for (let i = 0; i < bin.length; i += 0x8000) s += String.fromCharCode(...bin.subarray(i, i + 0x8000));
  const manifest = {
    version: 2,
    impostor: { frames: FRAMES, rows: specs.length, cell },
    leaf: { cols: LC, rows: LR, cell: leafCell },
    protos,
  };
  return {
    files: { 'imp_c.png': await impC.png(), 'imp_n.png': await impN.png(), 'leaf_c.png': await leafC.png(), 'leaf_n.png': await leafN.png(), 'bark.png': bark, 'trees.bin': btoa(s) },
    manifest,
    log: [...log],
  };
}

async function bakeBark(): Promise<string> {
  const load = (f: string) => new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = `${SRC}jacaranda_tree/textures/${f}`;
  });
  const [c, n] = await Promise.all([load('jacaranda_tree_trunk_diff_1k.jpg'), load('jacaranda_tree_trunk_nor_gl_1k.jpg')]);
  const S = 512;
  const cv = new OffscreenCanvas(S, S);
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(c, 0, 0, S, S);
  const cd = g.getImageData(0, 0, S, S).data;
  g.drawImage(n, 0, 0, S, S);
  const nd = g.getImageData(0, 0, S, S).data;
  const out = new Img(S, S);
  let mean = 0;
  for (let i = 0; i < S * S; i++) mean += cd[i * 4] * 0.3 + cd[i * 4 + 1] * 0.55 + cd[i * 4 + 2] * 0.15;
  mean /= S * S;
  for (let i = 0; i < S * S; i++) {
    const l = cd[i * 4] * 0.3 + cd[i * 4 + 1] * 0.55 + cd[i * 4 + 2] * 0.15;
    out.data[i * 4] = nd[i * 4];
    out.data[i * 4 + 1] = nd[i * 4 + 1];
    out.data[i * 4 + 2] = nd[i * 4 + 2];
    // albedo relative to the mean (0.5 = average)
    out.data[i * 4 + 3] = Math.max(0, Math.min(255, (l / mean) * 0.5 * 255));
  }
  return out.png();
}

/** a quick look at one tree: the full scan lit from the side (for picking specs) */
async function preview(spec: ProtoSpec, size = 512): Promise<string> {
  const parts = await loadParts(spec);
  const base = normalise(parts, spec);
  const tree: Tree = { ...base, ao: aoField(parts, base.bmin, base.bmax) };
  const img = new Img(size * 2, size);
  const S = Math.max(tree.radius * 2, tree.H) * 1.04;
  const scene = new THREE.Scene();
  for (const p of tree.parts) {
    const m = new THREE.Mesh(partGeometry(p, tree.ao), bakeMaterial(p, 0));
    m.frustumCulled = false;
    scene.add(m);
  }
  const cam = new THREE.OrthographicCamera(-S / 2, S / 2, S * 0.98, -S * 0.02, 0.1, 400);
  cam.position.set(0, 0, 200);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  renderFrame(scene, cam, img, 0, 0, size, [0.6, 0.7, 0.8, 1]);
  cam.position.set(200, 0, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  renderFrame(scene, cam, img, size, 0, size, [0.5, 0.5, 1, 1]);
  say(`${spec.id}: H ${tree.H.toFixed(1)} R ${tree.radius.toFixed(1)} parts ${parts.map((p) => `${p.name}:${p.kind}:${p.idx.length / 3}:cover ${p.cover.toFixed(2)}`).join(' ')}`);
  return img.png();
}

Object.assign(W, { __treeBake: bake, __treePreview: preview, __treeLog: log });
W.__ready = true;
