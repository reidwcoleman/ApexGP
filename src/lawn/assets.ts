/**
 * The files Apex Lawn loads: scanned PBR textures, CC0 models (Poly Haven, packed by
 * tools/fetch_lawn_assets.mjs) and HDR skies. Everything is cached and fetched on demand.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const BASE = `${import.meta.env.BASE_URL}lawn/`;

const texCache = new Map<string, Promise<THREE.Texture>>();
let maxAniso = 8;
export function setAnisotropy(n: number) {
  maxAniso = n;
}

/** a webp from public/lawn/tex, repeating, mipmapped */
export function loadTexture(file: string, srgb: boolean, url?: string): Promise<THREE.Texture> {
  const key = `${url ?? file}:${srgb}`;
  let p = texCache.get(key);
  if (!p) {
    p = fetch(url ?? `${BASE}tex/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${file}: ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' }))
      .then((bmp) => {
        const t = new THREE.Texture(bmp);
        t.flipY = false;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = maxAniso;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.needsUpdate = true;
        return t;
      });
    texCache.set(key, p);
  }
  return p;
}

/** the scanned turf (ambientCG Grass001) the race game already ships: colour and normal */
export const loadTurfNormal = () => loadTexture('turf_n', false, `${import.meta.env.BASE_URL}textures/grass_n.webp`);
export const loadTurfColour = () => loadTexture('turf_c', true, `${import.meta.env.BASE_URL}textures/grass_c.webp`);

export interface Pbr {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture | null;
}
const pbrCache = new Map<string, Promise<Pbr>>();
/** the scanned set `key_c / key_n / key_r` */
export function loadPbr(key: string): Promise<Pbr> {
  let p = pbrCache.get(key);
  if (!p) {
    p = Promise.all([loadTexture(`${key}_c.webp`, true), loadTexture(`${key}_n.webp`, false), loadTexture(`${key}_r.webp`, false).catch(() => null)]).then(([map, normalMap, roughnessMap]) => ({ map, normalMap, roughnessMap }));
    pbrCache.set(key, p);
  }
  return p;
}

/** a material from a scanned set; `repeat` is how many metres one texture covers (applied to the uv you build) */
export async function pbrMaterial(key: string, opts: { color?: THREE.ColorRepresentation; roughness?: number; normalScale?: number; envMapIntensity?: number } = {}): Promise<THREE.MeshStandardMaterial> {
  const t = await loadPbr(key);
  return new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    roughnessMap: t.roughnessMap ?? undefined,
    roughness: opts.roughness ?? 1,
    color: opts.color ?? 0xffffff,
    metalness: 0,
    envMapIntensity: opts.envMapIntensity ?? 1,
  });
}

let gltf: GLTFLoader | null = null;
const modelCache = new Map<string, Promise<THREE.Group>>();
export function loadModel(id: string): Promise<THREE.Group> {
  let p = modelCache.get(id);
  if (!p) {
    gltf ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = gltf.loadAsync(`${BASE}models/${id}.glb`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.map) mat.map.anisotropy = maxAniso;
        }
      });
      return g.scene;
    });
    modelCache.set(id, p);
  }
  return p;
}

/** a loaded model fitted to a real size: scaled so its largest horizontal extent is `size` (or its height `height`), standing on y = 0 */
export function fitted(model: THREE.Group, opts: { size?: number; height?: number }): THREE.Group {
  const inst = model.clone(true);
  const box = new THREE.Box3().setFromObject(inst);
  const s = box.getSize(new THREE.Vector3());
  const k = opts.height ? opts.height / Math.max(1e-3, s.y) : (opts.size ?? 1) / Math.max(1e-3, Math.max(s.x, s.z));
  inst.scale.multiplyScalar(k);
  inst.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(inst);
  const c = b2.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  inst.position.set(-c.x, -b2.min.y, -c.z);
  wrap.add(inst);
  wrap.userData.size = b2.getSize(new THREE.Vector3());
  return wrap;
}

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
export function loadHdri(key: string): Promise<THREE.DataTexture> {
  let p = hdrCache.get(key);
  if (!p) {
    p = new HDRLoader().loadAsync(`${BASE}hdri/${key}.hdr`).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    hdrCache.set(key, p);
  }
  return p;
}

/** the compass bearing (radians, atan2(z, x)) and elevation of the brightest part of an equirect sky */
export function sunOf(t: THREE.DataTexture): { az: number; el: number } {
  const w = t.image.width;
  const h = t.image.height;
  const d = t.image.data as Float32Array | Uint16Array;
  const half = d instanceof Uint16Array;
  const dec = (v: number) => (half ? THREE.DataUtils.fromHalfFloat(v) : v);
  let best = -1;
  let bi = 0;
  let bj = 0;
  // sum a small window so a single hot pixel doesn't win
  for (let j = 2; j < h - 2; j += 2) {
    for (let i = 0; i < w; i += 2) {
      const k = (j * w + i) * 4;
      const l = dec(d[k]) * 0.3 + dec(d[k + 1]) * 0.59 + dec(d[k + 2]) * 0.11;
      if (l > best) {
        best = l;
        bi = i;
        bj = j;
      }
    }
  }
  const u = (bi + 0.5) / w;
  const v = (bj + 0.5) / h;
  // three's equirect convention: u = atan2(dir.z, dir.x) / 2π + 0.5, v from the top
  const az = (u - 0.5) * Math.PI * 2;
  const el = (0.5 - v) * Math.PI;
  return { az, el };
}

/** the sky's average colour near the horizon, for the haze */
export function horizonColour(t: THREE.DataTexture): THREE.Color {
  const w = t.image.width;
  const h = t.image.height;
  const d = t.image.data as Float32Array | Uint16Array;
  const half = d instanceof Uint16Array;
  const dec = (v: number) => (half ? THREE.DataUtils.fromHalfFloat(v) : v);
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  const j0 = Math.floor(h * 0.44);
  const j1 = Math.floor(h * 0.5);
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < w; i += 4) {
      const k = (j * w + i) * 4;
      c.r += Math.min(dec(d[k]), 4);
      c.g += Math.min(dec(d[k + 1]), 4);
      c.b += Math.min(dec(d[k + 2]), 4);
      n++;
    }
  }
  return c.multiplyScalar(1 / Math.max(1, n));
}
