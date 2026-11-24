import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { odMaterial, glassMaterial, TABLE, U, setAnisotropy, type LightmapInfo } from './materials.ts';
import { makeSea } from './water.ts';
import type { Env } from './env.ts';

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

export interface SceneMeta {
  lightmaps: Record<string, LightmapInfo>;
  sea: number;
  water_x: number;
  sw: number;
  height: { x0: number; y0: number; res: number; nx: number; ny: number };
}

export interface World {
  root: THREE.Object3D;
  meta: SceneMeta;
  neon: THREE.MeshBasicMaterial[];
  sea: THREE.ShaderMaterial;
  /** the street lamps' bulbs and glass (lit at dusk) */
  lamps: THREE.MeshStandardMaterial[];
  /** give the window glass a reflection of the street */
  windows: (probe: THREE.Texture | null, k?: number) => void;
}

/** foliage: alpha-tested cards, two-sided, lit through from behind when the sun is beyond them */
function foliage(name: string, map: THREE.Texture, normal: THREE.Texture | null, tint: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name, map, normalMap: normal ?? undefined, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, color: tint });
  m.customProgramCacheKey = () => 'od-foliage';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunDir = U.uSunDir;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // translucency: the leaf glows yellow-green when the sun is behind it
          vec3 Vv = normalize( vViewPosition );
          vec3 Lv = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          float back = pow( max( dot( Vv, Lv ), 0.0 ), 3.0 );
          totalEmissiveRadiance += diffuseColor.rgb * vec3( 1.0, 1.05, 0.55 ) * back * 2.2;
        }`,
      );
  };
  return m;
}

export async function loadWorld(env: Env, renderer: THREE.WebGLRenderer, progress: (f: number, label: string) => void): Promise<World> {
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const meta: SceneMeta = await (await fetch(BASE + 'scene.json')).json();
  const tl = new THREE.TextureLoader();
  // lightmaps
  const lms = new Map<string, { tex: THREE.Texture; info: LightmapInfo }>();
  await Promise.all(
    Object.entries(meta.lightmaps).map(async ([name, info]) => {
      const t = await tl.loadAsync(BASE + 'lm/' + name + '.webp');
      t.channel = 1;
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = false;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = 4;
      lms.set(name, { tex: t, info });
    }),
  );
  progress(0.35, 'Laying out Ocean Drive');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(BASE + 'block.glb', (e) => {
    if (e.total) progress(0.35 + 0.45 * (e.loaded / e.total), 'Laying out Ocean Drive');
  });
  progress(0.82, 'Planting palms');
  const root = gltf.scene;
  const cache = new Map<string, THREE.Material>();
  const glass = glassMaterial(false);
  const shop = glassMaterial(true);
  const frond = tl.load(BASE + 'tex/palm_frond.webp');
  frond.colorSpace = THREE.SRGBColorSpace;
  frond.anisotropy = 8;
  const frondN = tl.load(BASE + 'tex/palm_frond_n.webp');
  const dry = tl.load(BASE + 'tex/palm_frond_dry.webp');
  dry.colorSpace = THREE.SRGBColorSpace;
  const grape = tl.load(BASE + 'tex/seagrape.webp');
  grape.colorSpace = THREE.SRGBColorSpace;
  const frondMat = foliage('od_frond', frond, frondN, 0xffffff);
  const dryMat = foliage('od_frond_dry', dry, null, 0xffffff);
  const bushMat = foliage('od_bush', grape, null, 0xffffff);
  const neon: THREE.MeshBasicMaterial[] = [];
  const neonMat = new THREE.MeshBasicMaterial({ name: 'od_neon', vertexColors: true, color: new THREE.Color(3.2, 3.2, 3.2), fog: true });
  neon.push(neonMat);
  const awningTex = makeStripes();
  let sea: THREE.ShaderMaterial | null = null;
  const lamps: THREE.MeshStandardMaterial[] = [];

  const lmOf = (o: THREE.Object3D): string | null => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith('lm_')) return p.name.replace(/_\d+$/, '').replace(/\.\d+$/, '');
    return null;
  };
  root.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const name = (src.name || '').replace(/\.\d+$/, '');
    const lmName = lmOf(mesh);
    const lm = lmName && mesh.geometry.getAttribute('uv1') ? lms.get(lmName) ?? null : null;
    let mat: THREE.Material | null = null;
    if (name === 'od_glass') mat = glass;
    else if (name === 'od_shopglass') mat = shop;
    else if (name === 'od_neon') mat = neonMat;
    else if (name === 'od_frond') mat = frondMat;
    else if (name === 'od_frond_dry') mat = dryMat;
    else if (name === 'od_bush') mat = bushMat;
    else if (name === 'od_water') {
      sea = makeSea(meta.water_x, meta.sea, env.hdr!, new THREE.Color(9.18 / 9.18, 7.38 / 9.18, 5.23 / 9.18).multiplyScalar(9.18));
      mat = sea;
      mesh.renderOrder = 2;
    } else if (name === 'od_awning') {
      const key = 'awning' + (lm ? lmName : '');
      mat = cache.get(key) ?? null;
      if (!mat) {
        const m = odMaterial({ name: 'od_awning', tile: 1, roughness: 0.9, kind: 'awning' }, lm);
        m.map = awningTex;
        cache.set(key, (mat = m));
      }
    } else if (name.startsWith('od_')) {
      const spec = TABLE[name] ?? { name, roughness: 0.8 };
      const key = name + '|' + (lm ? lmName : '');
      mat = cache.get(key) ?? null;
      if (!mat) cache.set(key, (mat = odMaterial(spec, lm)));
    } else {
      // Poly Haven props keep their own scanned materials
      if (src.map) src.map.anisotropy = 4;
      mat = src;
      if (/street_lamp_01_(bulb|glass)/.test(name) && !lamps.includes(src)) lamps.push(src);
    }
    mesh.material = mat;
    // shadows: everything casts except the sea, the horizon plane and neon; ground and walls receive
    const isGround = !!lmName && /gnear|gfar/.test(lmName);
    mesh.castShadow = !(name === 'od_water' || name === 'od_far' && mesh.name.startsWith('horizon') || name === 'od_neon' || isGround);
    mesh.receiveShadow = name !== 'od_neon' && name !== 'od_water';
    if (mesh.name.startsWith('horizon')) {
      mesh.castShadow = false;
    }
    env.prep(mat);
  });
  for (const m of [frondMat, dryMat, bushMat]) env.prep(m);
  instanceRepeats(root);
  if (!sea) throw new Error('no sea in the block');
  const windows = (probe: THREE.Texture | null, k = 1) => {
    if (!probe) return;
    for (const g of [glass, shop]) {
      g.envMap = probe;
      g.envMapIntensity = k;
      g.needsUpdate = true;
    }
  };
  return { root, meta, neon, sea, lamps, windows };
}

/** awning canvas: wide stripes, white and the awning's own colour (vertex colour multiplies) */
function makeStripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  // red = the stripe mask (awning colour vs white), green = weave
  g.fillStyle = '#00ffff';
  g.fillRect(0, 0, 256, 64);
  // u runs along the awning (metres): a stripe pair every 0.5 m -> the canvas covers 1 m
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 2; i++) g.fillRect(i * 128, 0, 64, 64);
  // a little fabric weave
  const d = g.getImageData(0, 0, 256, 64);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i + 1] = 200 + Math.random() * 55;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The exporter wrote every placed prop, palm and bush as its own node (sharing its mesh): fold every
 * group of meshes with the same geometry and material into one InstancedMesh, so 200 café tables
 * are one draw call (and one per shadow cascade) instead of 200.
 */
function instanceRepeats(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material)) return;
    const k = m.geometry.uuid + '|' + (m.material as THREE.Material).uuid;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(m);
  });
  let saved = 0;
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const first = list[0];
    const im = new THREE.InstancedMesh(first.geometry, first.material as THREE.Material, list.length);
    im.name = first.name + '_inst';
    im.castShadow = first.castShadow;
    im.receiveShadow = first.receiveShadow;
    im.renderOrder = first.renderOrder;
    list.forEach((m, i) => im.setMatrixAt(i, m.matrixWorld));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    for (const m of list) m.removeFromParent();
    root.add(im);
    saved += list.length - 1;
  }
  console.info('[oceandrive] instanced', saved, 'meshes away');
}
