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
  /** volleyball nets: Blender x, y, ground z, rotation */
  nets?: [number, number, number, number][];
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
function foliage(name: string, map: THREE.Texture, normal: THREE.Texture | null, tint: number, atlas = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name, map, normalMap: normal ?? undefined, alphaTest: atlas ? 0.38 : 0.42, side: THREE.DoubleSide, roughness: atlas ? 0.55 : 0.62, color: tint, vertexColors: atlas });
  m.customProgramCacheKey = () => (atlas ? 'od-foliage-atlas' : 'od-foliage');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunDir = U.uSunDir;
    sh.uniforms.uSunCol = U.uSunCol;
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uWind = U.uWind;
    // wind: the crowns sway together, each leaf flutters on its own; more in a storm
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          mat3 odM = mat3( modelMatrix );
          vec4 wp0 = modelMatrix * vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wp0 = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
            odM = odM * mat3( instanceMatrix );
          #endif
          float hgt = smoothstep( 3.0, 12.0, wp0.y );
          float ph = dot( wp0.xz, vec2( 0.11, 0.07 ) );
          float gust = 0.6 + 0.4 * sin( uTime * 0.37 + ph * 0.3 );
          vec3 sway = vec3( sin( uTime * 1.1 + ph ) + 0.6, 0.0, cos( uTime * 0.9 + ph * 1.3 ) * 0.5 ) * 0.16 * uWind * gust * hgt;
          vec3 flut = vec3( sin( uTime * 7.0 + wp0.x * 3.1 + wp0.y * 2.3 ), sin( uTime * 6.1 + wp0.z * 2.7 ) * 0.6, cos( uTime * 7.7 + wp0.y * 3.3 ) ) * 0.035 * ( 0.3 + uWind ) * hgt;
          ${atlas ? `// the atlas fronds: base (v ~ 1 in the glTF's flipped v) holds still, the tip flutters and bounces
          float tipK = clamp( 1.0 - uv.y, 0.0, 1.0 );
          flut *= 0.3 + 2.2 * tipK * tipK;
          flut.y += sin( uTime * 2.3 + ph * 2.0 + tipK * 2.0 ) * 0.09 * tipK * tipK * ( 0.4 + uWind ) * hgt;` : ''}
          vec3 off = sway + flut;
          // world offset back into the model's frame (palms are only translated/rotated/scaled uniformly)
          transformed += inverse( odM ) * off;
        }`,
      );
    if (atlas)
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // a crown lights like a soft volume: every leaf's normal leans toward the sky
        normal = normalize( normal + ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz * 0.75 );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunCol;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // translucency: the leaf glows yellow-green when the sun is behind it
          vec3 Vv = normalize( vViewPosition );
          vec3 Lv = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          float back = pow( max( dot( Vv, Lv ), 0.0 ), 3.0 );
          totalEmissiveRadiance += diffuseColor.rgb * vec3( 1.0, 1.05, 0.55 ) * back * 2.2 * ( uSunCol.g / 7.38 );
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
  const lms = await loadLightmaps(meta.lightmaps, tl);
  progress(0.35, 'Laying out Ocean Drive');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(BASE + 'block.glb', (e) => {
    if (e.total) progress(0.35 + 0.45 * (e.loaded / e.total), 'Laying out Ocean Drive');
  });
  progress(0.82, 'Planting palms');
  const root = gltf.scene;
  const S = shared(tl);
  let sea: THREE.ShaderMaterial | null = null;
  skin(root, lms, env, S, (name, mesh) => {
    if (name !== 'od_water') return null;
    sea = makeSea(meta.water_x, meta.sea, env.hdr!, new THREE.Color(9.18 / 9.18, 7.38 / 9.18, 5.23 / 9.18).multiplyScalar(9.18));
    mesh.renderOrder = 2;
    return sea;
  });
  if (!sea) throw new Error('no sea in the block');
  const windows = (probe: THREE.Texture | null, k = 1) => {
    if (!probe) return;
    for (const g of [S.glass, S.shop]) {
      g.envMap = probe;
      g.envMapIntensity = k;
      g.needsUpdate = true;
    }
  };
  return { root, meta, neon: S.neon, sea, lamps: S.lamps, windows };
}

/** what both scenes share: the window glass, the palms' leaves, the neon, the awnings, the scanned materials */
export interface Shared {
  glass: THREE.MeshPhysicalMaterial;
  shop: THREE.MeshPhysicalMaterial;
  frondMat: THREE.MeshStandardMaterial;
  dryMat: THREE.MeshStandardMaterial;
  bushMat: THREE.MeshStandardMaterial;
  leafMat: THREE.MeshStandardMaterial;
  neonMat: THREE.MeshBasicMaterial;
  neon: THREE.MeshBasicMaterial[];
  lamps: THREE.MeshStandardMaterial[];
  awningTex: THREE.Texture;
  cache: Map<string, THREE.Material>;
}
let SHARED: Shared | null = null;
export function shared(tl = new THREE.TextureLoader()): Shared {
  if (SHARED) return SHARED;
  const frond = tl.load(BASE + 'tex/palm_frond.webp');
  frond.colorSpace = THREE.SRGBColorSpace;
  frond.anisotropy = 8;
  const frondN = tl.load(BASE + 'tex/palm_frond_n.webp');
  const dry = tl.load(BASE + 'tex/palm_frond_dry.webp');
  dry.colorSpace = THREE.SRGBColorSpace;
  // the modelled leaf atlas (foliage/frond_atlas.py): glTF convention, no flip
  const atlas = tl.load(BASE + 'tex/palm_atlas.webp');
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = false;
  atlas.anisotropy = 8;
  const atlasN = tl.load(BASE + 'tex/palm_atlas_n.webp');
  atlasN.flipY = false;
  const grape = tl.load(BASE + 'tex/seagrape.webp');
  grape.colorSpace = THREE.SRGBColorSpace;
  const neonMat = new THREE.MeshBasicMaterial({ name: 'od_neon', vertexColors: true, color: new THREE.Color(3.2, 3.2, 3.2), fog: true });
  SHARED = {
    glass: glassMaterial(false),
    shop: glassMaterial(true),
    frondMat: foliage('od_frond', frond, frondN, 0xffffff),
    dryMat: foliage('od_frond_dry', dry, null, 0xffffff),
    bushMat: foliage('od_bush', grape, null, 0xffffff),
    leafMat: (() => {
      const m = foliage('od_palmleaf', atlas, atlasN, 0xffffff, true);
      // the atlas was rendered with +y toward the frond's tip; the glTF's flipped v runs the other way
      m.normalScale.set(1, -1);
      // sunlit Florida green: a touch warmer and brighter than the atlas
      m.color.setRGB(1.06, 1.1, 0.94);
      return m;
    })(),
    neonMat,
    neon: [neonMat],
    lamps: [],
    awningTex: makeStripes(),
    cache: new Map(),
  };
  return SHARED;
}

export type LmMap = Map<string, { tex: THREE.Texture; info: LightmapInfo }>;

/** swap the GLB's flat od_* placeholders for the real materials (lightmapped where baked) */
export function skin(root: THREE.Object3D, lms: LmMap, env: Env, S: Shared, special: (name: string, mesh: THREE.Mesh, lm: { tex: THREE.Texture; info: LightmapInfo } | null) => THREE.Material | null) {
  const lmOf = (o: THREE.Object3D): string | null => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name.startsWith('lm_')) return p.name.replace(/_\d+$/, '').replace(/\.\d+$/, '');
    return null;
  };
  const { cache } = S;
  root.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const name = (src.name || '').replace(/\.\d+$/, '');
    const lmName = lmOf(mesh);
    const lm = lmName && mesh.geometry.getAttribute('uv1') ? lms.get(lmName) ?? null : null;
    let mat: THREE.Material | null = special(name, mesh, lm);
    if (mat) {
      // (the caller's)
    } else if (name === 'od_glass') mat = S.glass;
    else if (name === 'od_shopglass') mat = S.shop;
    else if (name === 'od_neon') mat = S.neonMat;
    else if (name === 'od_frond') mat = S.frondMat;
    else if (name === 'od_frond_dry') mat = S.dryMat;
    else if (name === 'od_bush') mat = S.bushMat;
    else if (name === 'od_palmleaf') mat = S.leafMat;
    else if (name === 'od_awning') {
      const key = 'awning' + (lm ? lmName : '');
      mat = cache.get(key) ?? null;
      if (!mat) {
        const m = odMaterial({ name: 'od_awning', tile: 1, roughness: 0.9, kind: 'awning' }, lm);
        m.map = S.awningTex;
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
      if (/street_lamp_01_(bulb|glass)/.test(name) && !S.lamps.includes(src)) S.lamps.push(src);
    }
    mesh.material = mat;
    // shadows: everything casts except the sea, the horizon plane and neon; ground and walls receive
    const isGround = !!lmName && /gnear|gfar|dtg/.test(lmName);
    mesh.castShadow = !(name === 'od_water' || name === 'od_bay' || name === 'od_far' && mesh.name.startsWith('horizon') || name === 'od_neon' || isGround || name === 'od_farground');
    mesh.receiveShadow = name !== 'od_neon' && name !== 'od_water' && name !== 'od_bay';
    if (mesh.name.startsWith('horizon')) {
      mesh.castShadow = false;
    }
    env.prep(mat);
  });
  for (const m of [S.frondMat, S.dryMat, S.bushMat, S.leafMat]) env.prep(m);
  instanceRepeats(root);
}

/** lightmaps listed in a manifest, from lm/ */
export async function loadLightmaps(manifest: Record<string, LightmapInfo>, tl = new THREE.TextureLoader()): Promise<LmMap> {
  const lms: LmMap = new Map();
  await Promise.all(
    Object.entries(manifest).map(async ([name, info]) => {
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
  return lms;
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

/** the volleyball nets: a 10 cm mesh of dark cord (a tiling texture, alpha-tested), white tapes round it */
export function makeNets(meta: SceneMeta): THREE.Group {
  const g = new THREE.Group();
  if (!meta.nets?.length) return g;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 64, 64);
  x.fillStyle = '#1b1b1b';
  x.fillRect(0, 0, 64, 5);
  x.fillRect(0, 0, 5, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(98, 8.8);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
  const tape = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 });
  const netGeo = new THREE.PlaneGeometry(9.8, 0.88);
  const topGeo = new THREE.BoxGeometry(9.8, 0.07, 0.012);
  const botGeo = new THREE.BoxGeometry(9.8, 0.05, 0.01);
  const sideGeo = new THREE.BoxGeometry(0.05, 0.95, 0.01);
  for (const [bx, by, bz, rot] of meta.nets) {
    const n = new THREE.Group();
    n.position.set(bx, bz, -by);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    n.rotation.y = Math.atan2(cs, -sn);
    const net = new THREE.Mesh(netGeo, mesh);
    net.position.y = 1.99;
    const top = new THREE.Mesh(topGeo, tape);
    top.position.y = 2.43;
    const bot = new THREE.Mesh(botGeo, tape);
    bot.position.y = 1.55;
    n.add(net, top, bot);
    for (const s of [-1, 1]) {
      const sd = new THREE.Mesh(sideGeo, tape);
      sd.position.set(s * 4.9, 1.99, 0);
      n.add(sd);
    }
    g.add(n);
  }
  return g;
}
