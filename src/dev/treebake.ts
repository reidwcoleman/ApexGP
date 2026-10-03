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
 *   leaf clumps       a few real clumps of the tree's own leaves (every leaf within a sphere
 *                     around a branch-end cluster, rendered from outside the crown): the
 *                     texture of the near trees' camera-facing leaf cards.
 *   near geometry     two LODs per tree in the game's tree vertex layout (treeproto.ts): the
 *                     scanned trunk + limbs decimated with meshoptimizer (vertex colour = the
 *                     scan's own bark albedo), and one leaf card per k-means cluster of the
 *                     real leaves (so the crown keeps the scan's shape, gaps and all).
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
  /** leaf clusters (cards) for LOD0 / LOD1 */
  K0: number;
  K1: number;
  /** trunk + limbs triangle budgets for LOD0 / LOD1 */
  wood0: number;
  wood1: number;
  /** leaf clumps baked for the card atlas */
  clumps?: number;
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
void main() {
  vUv = uv;
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
varying vec2 vUv;
varying vec3 vN;
varying vec3 vVP;
varying float vAO;
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
    gl_FragColor = vec4( n * 0.5 + 0.5, vAO );
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

// ------------------------------------------------------------------------------------ leaf clusters

function rngOf(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Cluster {
  c: THREE.Vector3;
  w: number;
  rms: number;
}

/** leaf sample points (triangle centroids, picked by area) */
function leafSamples(tree: Tree, N: number, r: () => number): Float32Array {
  const tris: { p: Part; t: number; a: number }[] = [];
  let total = 0;
  for (const p of tree.parts) {
    if (p.kind !== 'leaf') continue;
    const P = p.pos;
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      total += area;
      tris.push({ p, t, a: total });
    }
  }
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const x = r() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tris[m].a < x) lo = m + 1;
      else hi = m;
    }
    const { p, t } = tris[lo];
    const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = (p.pos[a + k] + p.pos[b + k] + p.pos[c + k]) / 3;
  }
  return out;
}

function kmeans(pts: Float32Array, K: number, r: () => number, iters = 12): Cluster[] {
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
      for (let k = 0; k < K; k++) {
        const dx = pts[i * 3] - C[k * 3], dy = pts[i * 3 + 1] - C[k * 3 + 1], dz = pts[i * 3 + 2] - C[k * 3 + 2];
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
  const out: Cluster[] = [];
  const acc = new Float64Array(K * 2);
  for (let i = 0; i < N; i++) {
    const k = asg[i];
    const dx = pts[i * 3] - C[k * 3], dy = pts[i * 3 + 1] - C[k * 3 + 1], dz = pts[i * 3 + 2] - C[k * 3 + 2];
    acc[k * 2] += dx * dx + dy * dy + dz * dz;
    acc[k * 2 + 1]++;
  }
  for (let k = 0; k < K; k++) {
    if (acc[k * 2 + 1] < 3) continue;
    out.push({ c: new THREE.Vector3(C[k * 3], C[k * 3 + 1], C[k * 3 + 2]), w: acc[k * 2 + 1] / N, rms: Math.sqrt(acc[k * 2] / acc[k * 2 + 1]) });
  }
  return out;
}

/** a clump: every leaf (and twig) triangle with its centroid within R of c, seen from outside the crown */
function bakeClump(tree: Tree, cl: Cluster, R: number, col: Img, nrm: Img, ox: number, oy: number, cell: number, gain = 1) {
  const scene = new THREE.Scene();
  const disp: { dispose(): void }[] = [];
  for (const p of tree.parts) {
    const keep: number[] = [];
    const P = p.pos;
    for (let t = 0; t < p.idx.length; t += 3) {
      const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
      const x = (P[a] + P[b] + P[c]) / 3 - cl.c.x, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - cl.c.y, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - cl.c.z;
      if (x * x + y * y + z * z < R * R) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
    }
    if (!keep.length) continue;
    const g = partGeometry(p, tree.ao, Uint32Array.from(keep));
    const mA = bakeMaterial(p, 0), mN = bakeMaterial(p, 1);
    const m = new THREE.Mesh(g, mA);
    m.userData.mats = [mA, mN];
    m.frustumCulled = false;
    scene.add(m);
    disp.push(g, mA, mN);
  }
  const o = cl.c.clone().sub(tree.crownC);
  o.y *= 0.6;
  if (o.lengthSq() < 1e-4) o.set(0, 0, 1);
  o.normalize();
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, R * 6);
  cam.position.copy(cl.c).addScaledVector(o, R * 3);
  cam.up.set(0, 1, 0);
  cam.lookAt(cl.c);
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

/** the game's tree vertex layout (treeproto.ts) */
class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  dat: number[] = [];
  card: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  v(p: ArrayLike<number>, n: ArrayLike<number>, uv: ArrayLike<number>, c: ArrayLike<number>, dat: ArrayLike<number>, card: ArrayLike<number>) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c[0], c[1], c[2]);
    this.dat.push(dat[0], dat[1], dat[2], dat[3]);
    this.card.push(card[0], card[1], card[2], card[3]);
    return this.count - 1;
  }
  /** pack: pos f32×3 | nor i8×4 | uv f32×2 | col u8×4 | aTree u8×4 | aCard i16×4 | idx u16 */
  pack(): { bytes: Uint8Array; v: number; i: number } {
    const V = this.count, I = this.idx.length;
    const size = V * (12 + 4 + 8 + 4 + 4 + 8) + I * 2 + 4;
    const buf = new ArrayBuffer(Math.ceil(size / 4) * 4);
    let off = 0;
    const f32 = new Float32Array(buf, off, V * 3);
    f32.set(this.pos);
    off += V * 12;
    const i8 = new Int8Array(buf, off, V * 4);
    for (let i = 0; i < V; i++) for (let k = 0; k < 3; k++) i8[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, this.nor[i * 3 + k])) * 127);
    off += V * 4;
    new Float32Array(buf, off, V * 2).set(this.uv);
    off += V * 8;
    const u8 = new Uint8Array(buf, off, V * 4);
    for (let i = 0; i < V; i++) for (let k = 0; k < 3; k++) u8[i * 4 + k] = Math.round(Math.max(0, Math.min(1, this.col[i * 3 + k])) * 255);
    off += V * 4;
    const d8 = new Uint8Array(buf, off, V * 4);
    // aTree: wind (0…1.5), kind (0 bark / 1 leaf), ao, phase (0…2π)
    for (let i = 0; i < V; i++) {
      d8[i * 4] = Math.round(Math.max(0, Math.min(1, this.dat[i * 4] / 1.5)) * 255);
      d8[i * 4 + 1] = this.dat[i * 4 + 1] > 0.5 ? 255 : 0;
      d8[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, this.dat[i * 4 + 2])) * 255);
      d8[i * 4 + 3] = Math.round(((this.dat[i * 4 + 3] / (Math.PI * 2)) % 1) * 255);
    }
    off += V * 4;
    // aCard: corner x, y (mm), rotation (mrad)
    const i16 = new Int16Array(buf, off, V * 4);
    for (let i = 0; i < V * 4; i++) i16[i] = Math.round(Math.max(-32767, Math.min(32767, this.card[i] * 1000)));
    off += V * 8;
    new Uint16Array(buf, off, I).set(this.idx);
    return { bytes: new Uint8Array(buf), v: V, i: I };
  }
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

function woodLOD(tree: Tree, target: number, geo: Geo, windAt: (x: number, y: number, z: number) => number) {
  // merge the wood parts
  const parts = tree.parts.filter((p) => p.kind === 'wood');
  let V = 0, I = 0;
  for (const p of parts) {
    V += p.pos.length / 3;
    I += p.idx.length;
  }
  const pos = new Float32Array(V * 3);
  const idx = new Uint32Array(I);
  const owner: { p: Part; base: number }[] = [];
  let vo = 0, io = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    owner.push({ p, base: vo });
    vo += p.pos.length / 3;
    io += p.idx.length;
  }
  let [out] = MeshoptSimplifier.simplify(idx, pos, 3, target * 3, 0.02, ['Prune']);
  if (out.length > target * 3 * 1.3) [out] = MeshoptSimplifier.simplifySloppy(out, pos, 3, null, target * 3, 0.05);
  const map = new Map<number, number>();
  const ownerOf = (vi: number) => {
    for (let k = owner.length - 1; k >= 0; k--) if (vi >= owner[k].base) return owner[k];
    return owner[0];
  };
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
      // (the near trunk's albedo is the scan's own; the bark tile adds the detail around it)
      ni = geo.v([x, y, z], [p.nor[li * 3], p.nor[li * 3 + 1], p.nor[li * 3 + 2]], [u * 2, v * 2], [alb[0] * 1.6, alb[1] * 1.6, alb[2] * 1.6], [windAt(x, y, z), 0, Math.min(1, 0.25 + ao), 0], [0, 0, 0, 0]);
      map.set(vi, ni);
    }
    geo.idx.push(ni);
  }
  return out.length / 3;
}

/**
 * A leaf card covers its cluster out to CLUMP_R × the cluster's RMS radius (the clump texture is the
 * leaves within that sphere). Neighbouring cards overlap anyway; much more than ~1.1 and the near
 * trees' cost is all overdraw of transparent card corners (fill, in the camera and the shadow maps).
 */
const CLUMP_R = 1.1;

function cardsLOD(tree: Tree, clusters: Cluster[], cells: { u0: number; v0: number; du: number; dv: number }[], geo: Geo, windAt: (x: number, y: number, z: number) => number, r: () => number, scale: number) {
  const up = new THREE.Vector3(0, 1, 0);
  for (const cl of clusters) {
    const o = cl.c.clone().sub(tree.crownC);
    o.y *= 0.7;
    o.normalize();
    const n = o.clone().addScaledVector(up, 0.3).normalize();
    const ao = tree.ao.at(cl.c.x, cl.c.y, cl.c.z);
    const s = Math.max(0.5, cl.rms * CLUMP_R * 2 * scale);
    const cell = cells[Math.floor(r() * cells.length)];
    const tint = 0.9 + r() * 0.2;
    const rot = (r() - 0.5) * 0.9;
    const phase = r() * Math.PI * 2;
    const w = windAt(cl.c.x, cl.c.y, cl.c.z);
    const ids: number[] = [];
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      ids.push(geo.v([cl.c.x, cl.c.y, cl.c.z], [n.x, n.y, n.z], [cell.u0 + (a * 0.996 + 0.002) * cell.du, cell.v0 + (b * 0.996 + 0.002) * cell.dv], [tint, tint, tint], [w + b * 0.05, 1, ao, phase], [(a - 0.5) * s, (b - 0.5) * s, rot, 0]));
    }
    geo.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
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
  lods: { v: number; i: number; off: number; bytes: number; wood: number; cards: number }[];
}

async function bake(specs: ProtoSpec[], opts: { cell?: number; leafCell?: number; clumps?: number } = {}) {
  await MeshoptSimplifier.ready;
  log.length = 0;
  const cell = opts.cell ?? 256;
  const leafCell = opts.leafCell ?? 256;
  const nClumps = specs.reduce((a, s) => a + (s.clumps ?? opts.clumps ?? 5), 0);
  const LC = 8;
  const LR = Math.ceil(nClumps / LC);
  const impC = new Img(FRAMES * cell, specs.length * cell);
  const impN = new Img(FRAMES * cell, specs.length * cell);
  const leafC = new Img(LC * leafCell, LR * leafCell);
  const leafN = new Img(LC * leafCell, LR * leafCell);
  const protos: ProtoOut[] = [];
  const bins: Uint8Array[] = [];
  let binOff = 0;
  let clumpSlot = 0;
  for (let pi = 0; pi < specs.length; pi++) {
    const spec = specs[pi];
    const t0 = performance.now();
    const parts = await loadParts(spec);
    const base = normalise(parts, spec);
    const tree: Tree = { ...base, ao: aoField(parts, base.bmin, base.bmax) };
    const t1 = performance.now();
    const { W: cardW, Hc } = bakeImpostor(tree, impC, impN, pi, cell, spec.alphaGain ?? 1);
    const t2 = performance.now();
    const r = rngOf(9001 + pi * 7919);
    const pts = leafSamples(tree, 40000, r);
    const cl0 = kmeans(pts, spec.K0, r);
    const cl1 = kmeans(pts, spec.K1, r);
    // the clumps for the card atlas: outer-shell clusters of typical size
    const nc = spec.clumps ?? opts.clumps ?? 5;
    const med = [...cl0].sort((a, b) => a.rms - b.rms)[Math.floor(cl0.length / 2)].rms;
    const cand = cl0
      .map((c) => ({ c, score: tree.ao.at(c.c.x, c.c.y, c.c.z) - Math.abs(c.rms / med - 1) * 0.5 + r() * 0.15 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, nc);
    const cells: { u0: number; v0: number; du: number; dv: number }[] = [];
    for (const { c } of cand) {
      const col = clumpSlot % LC, row = Math.floor(clumpSlot / LC);
      clumpSlot++;
      bakeClump(tree, c, c.rms * CLUMP_R, leafC, leafN, col * leafCell, row * leafCell, leafCell, spec.alphaGain ?? 1);
      // (image rows run top-down; the game decodes the atlas flipped, so v = 0 is the bottom row)
      cells.push({ u0: col / LC, v0: 1 - (row + 1) / LR, du: 1 / LC, dv: 1 / LR });
    }
    const t3 = performance.now();
    const avgR = (tree.crownR.x + tree.crownR.z) / 2;
    const windAt = (x: number, y: number, z: number) => {
      const h = Math.max(0, y / tree.H - 0.08);
      return Math.min(1.2, h * h * 1.4 + Math.hypot(x, z) / (avgR * 3));
    };
    const lods: ProtoOut['lods'] = [];
    for (let lod = 0; lod < 2; lod++) {
      const g = new Geo();
      const wood = woodLOD(tree, lod ? spec.wood1 : spec.wood0, g, windAt);
      cardsLOD(tree, lod ? cl1 : cl0, cells, g, windAt, rngOf(77 + pi * 31 + lod), 1);
      const pk = g.pack();
      bins.push(pk.bytes);
      lods.push({ v: pk.v, i: pk.i, off: binOff, bytes: pk.bytes.length, wood, cards: lod ? cl1.length : cl0.length });
      binOff += pk.bytes.length;
    }
    protos.push({ id: spec.id, species: spec.species, height: +tree.H.toFixed(3), radius: +tree.radius.toFixed(3), crownR: +avgR.toFixed(3), crownY: +tree.crownC.y.toFixed(3), W: +cardW.toFixed(3), Hc: +Hc.toFixed(3), lods });
    say(`${spec.id}: H ${tree.H.toFixed(1)} m, R ${tree.radius.toFixed(1)} m, crown ${avgR.toFixed(1)} m; ${parts.map((p) => `${p.name} ${p.idx.length / 3}`).join(', ')}; lod0 ${lods[0].wood} wood tris + ${lods[0].cards} cards, lod1 ${lods[1].wood} + ${lods[1].cards}; load ${Math.round(t1 - t0)} ms, imp ${Math.round(t2 - t1)} ms, clumps ${Math.round(t3 - t2)} ms`);
  }
  // the near trunks' detail: a tile of the jacaranda's bark scan (normal xyz, albedo in alpha)
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
    version: 1,
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
