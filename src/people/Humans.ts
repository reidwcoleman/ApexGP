import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { NOISE_GLSL, SHAPE_GLSL, BUMP_GLSL, LIGHT_GLOBALS, SKIN_GLSL, FABRIC_GLSL, CLOTH_WHITE_MAX, peopleLightsChunk, skinColor, eyeMaterial } from './shading.ts';

/**
 * People built on Quaternius's Universal Base Characters (CC0): a sculpted, rigged
 * male and female body (UE-mannequin skeleton, 65 bones), their eyes and brows,
 * five hairstyles and a beard, and the Universal Animation Library's clips (idle,
 * talking, walking, kneeling repairs, dancing, sitting …). See tools/build_people.py.
 *
 * The base bodies are "superheroes"; in the vertex shader they become ordinary people
 * (SHAPE_GLSL: slimmer shoulders and arms, a waist, a weight axis from slim to heavy).
 * The skin is re-toned from a palette of real skin albedos and lit with wrapped,
 * red-bleeding diffuse, a second oily specular lobe and pores; the face gets stubble,
 * a real eye (iris, pupil, limbal ring, lid shadow) and flattened, thinned brows; the
 * hair Kajiya-Kay strand highlights.
 *
 * The bodies come in underwear, so clothes are painted on in the shader from each
 * vertex's rest (T-pose) position and normal: race suits with side panels, collar,
 * belt and printed sponsors, T-shirts, polos, hoodies, overalls, trousers, shorts,
 * boots and gloves — the cloth pushed out a few millimetres, its muscle detail
 * flattened, with folds, creases and seams as bump. Caps, headsets and hand-held props
 * are rigid meshes skinned to one bone, built in bind space, so they follow the
 * animation (and work in the instanced crowd).
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'models/people/';

export type HairId = 'buzzed' | 'buzzedfemale' | 'simpleparted' | 'long' | 'buns' | 'none';
export type TopKind = 'none' | 'tshirt' | 'polo' | 'longsleeve' | 'tank' | 'hoodie' | 'jacket' | 'suit';
export type BottomKind = 'none' | 'trousers' | 'jeans' | 'shorts' | 'suit';

export const TOP_ID: Record<TopKind, number> = { none: 0, tshirt: 1, polo: 2, longsleeve: 3, tank: 4, hoodie: 5, jacket: 6, suit: 7 };
export const BOTTOM_ID: Record<BottomKind, number> = { none: 0, trousers: 1, jeans: 2, shorts: 3, suit: 4 };

export interface Look {
  female: boolean;
  /** skin: 0 fair … 1 deep (a palette of real skin albedos) */
  tone: number;
  /** a skin colour (as a palette shows it) instead of `tone` */
  skin?: THREE.ColorRepresentation;
  /** −1 pink … +1 olive / golden */
  undertone?: number;
  hair: HairId;
  hairColor: THREE.ColorRepresentation;
  beard?: boolean;
  /** shaved shadow / short stubble on the jaw, 0 … 1 */
  stubble?: number;
  eyeColor?: THREE.ColorRepresentation;
  top: TopKind;
  topColor: THREE.ColorRepresentation;
  /** side panels / sleeves */
  top2?: THREE.ColorRepresentation;
  /** collar, belt, stripes */
  accent?: THREE.ColorRepresentation;
  bottom: BottomKind;
  bottomColor: THREE.ColorRepresentation;
  shoeColor?: THREE.ColorRepresentation;
  gloves?: THREE.ColorRepresentation | null;
  cap?: THREE.ColorRepresentation | null;
  capBack?: boolean;
  headset?: boolean;
  /** print: left half = chest, right half = back (2:1 texture) */
  logo?: THREE.Texture | null;
  /** 1 = the model's height (≈1.8 m male, 1.77 m female) */
  height?: number;
  /** girth */
  build?: number;
  /** −1 slim … 0 average … +1 heavy */
  weight?: number;
  /** 0 soft … 1 athletic (how much muscle relief shows) */
  muscle?: number;
  /** face: width, jaw width, length (1 = the model's) */
  face?: { width?: number; jaw?: number; length?: number };
}

/** GLSL: reshape the head in bind space (every mesh on the head uses the same map, so eyes, brows and hair stay put) */
export const FACE_GLSL = /* glsl */ `
uniform vec4 uFace; uniform vec4 uSkull;
vec3 faceShape( vec3 p ) {
  float w = smoothstep( uSkull.w - 0.02, uSkull.w + 0.03, p.y );
  if ( w <= 0.0 ) return p;
  vec3 r = p - uSkull.xyz;
  float jaw = smoothstep( 0.0, -0.08, r.y );
  r.x *= mix( 1.0, uFace.x * mix( 1.0, uFace.y, jaw ), w );
  if ( r.y < 0.0 ) r.y *= mix( 1.0, uFace.z, w );
  return uSkull.xyz + r;
}
`;

export function faceUniforms(lm: Landmarks, look: Look) {
  return {
    uFace: { value: new THREE.Vector4(look.face?.width ?? 1, look.face?.jaw ?? 1, look.face?.length ?? 1, 0) },
    uSkull: { value: new THREE.Vector4(lm.skull.x, lm.skull.y, lm.skull.z, lm.neckY + 0.02) },
  };
}

/** add the head reshape to any material worn on the head */
export function patchFace(mat: THREE.Material, u: ReturnType<typeof faceUniforms>) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
${FACE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = faceShape( transformed );`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '+face';
}

/** bind-pose landmarks of a body (metres, mesh space: y up, facing +z, T-pose) */
export interface Landmarks {
  shoulderX: number;
  elbowX: number;
  wristX: number;
  armY: number;
  neckY: number;
  chestY: number;
  waistY: number;
  kneeY: number;
  ankleY: number;
  headY: number;
  headTop: number;
  /** centre of the skull (bbox of the head vertices) and its half-size */
  skull: THREE.Vector3;
  skullR: THREE.Vector3;
  /** bone index by name */
  joint: Record<string, number>;
  /** bind world position by bone name */
  pos: Record<string, THREE.Vector3>;
  /** the left eyeball: centre (x > 0; the right one mirrors it) and radius */
  eye?: THREE.Vector4;
}

export interface BodyAsset {
  template: THREE.Object3D;
  bodyName: string;
  light: THREE.Texture;
  dark: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
  lm: Landmarks;
  /** the body mesh's geometry (for the crowd) */
  geometry: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  brows: THREE.BufferGeometry;
  /** inverse bind matrices, bone order */
  boneInverses: THREE.Matrix4[];
  bindMatrix: THREE.Matrix4;
  /** mean colour (linear) of the painted light skin: the skin shader divides it out */
  skinMean?: THREE.Color;
  /** bind-pose (rest) rotation of every finger bone, by name */
  fingerRest?: Record<string, THREE.Quaternion>;
}

export interface PeopleKit {
  male: BodyAsset;
  female: BodyAsset;
  hair: Record<Exclude<HairId, 'none'> | 'beard', THREE.BufferGeometry>;
  hairMap: [THREE.Texture, THREE.Texture];
  hairNormal: [THREE.Texture, THREE.Texture];
  eyeMap: THREE.Texture;
  eyeNormal: THREE.Texture;
  clips: Map<string, THREE.AnimationClip>;
  /** panels, seams and stitching for the caps */
  capMap?: THREE.Texture;
}

let kitPromise: Promise<PeopleKit> | null = null;
let kitReady: PeopleKit | null = null;

/** the loaded kit, or null before loadPeople() has finished */
export function peopleKit(): PeopleKit | null {
  return kitReady;
}

export function loadPeople(): Promise<PeopleKit> {
  return (kitPromise ??= load().then((k) => (kitReady = k)));
}

/** vertex attributes the glTFs carry that nothing reads (every one is fetched per vertex, per instance) */
const UNUSED_ATTRS = ['uv1', 'uv2', 'uv3', 'texcoord_4', 'color', 'color_1', 'color_2'];

async function load(): Promise<PeopleKit> {
  const gl = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const tex = (name: string, srgb: boolean) =>
    tl.loadAsync(BASE + name).then((t) => {
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      return t;
    });
  const [male, female, anims, ...rest] = await Promise.all([
    gl.loadAsync(BASE + 'male.gltf'),
    gl.loadAsync(BASE + 'female.gltf'),
    gl.loadAsync(BASE + 'anims.glb'),
    gl.loadAsync(BASE + 'hair_buzzed.gltf'),
    gl.loadAsync(BASE + 'hair_buzzedfemale.gltf'),
    gl.loadAsync(BASE + 'hair_simpleparted.gltf'),
    gl.loadAsync(BASE + 'hair_long.gltf'),
    gl.loadAsync(BASE + 'hair_buns.gltf'),
    gl.loadAsync(BASE + 'hair_beard.gltf'),
  ]);
  const [mL, mD, mN, mR, fL, fD, fN, fR, h1, h1n, h2, h2n, ec, en] = await Promise.all([
    tex('male_light.jpg', true), tex('male_dark.jpg', true), tex('male_n.jpg', false), tex('male_r.jpg', false),
    tex('female_light.jpg', true), tex('female_dark.jpg', true), tex('female_n.jpg', false), tex('female_r.jpg', false),
    tex('hair1_c.jpg', true), tex('hair1_n.jpg', false), tex('hair2_c.jpg', true), tex('hair2_n.jpg', false),
    tex('eye_c.jpg', true), tex('eye_n.jpg', false),
  ]);
  const body = (g: { scene: THREE.Object3D }, light: THREE.Texture, dark: THREE.Texture, normal: THREE.Texture, rough: THREE.Texture): BodyAsset => {
    const skinned: THREE.SkinnedMesh[] = [];
    g.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    // the body is the big one; the eyes use the eye material; the rest are the brows
    skinned.sort((a, b) => b.geometry.getAttribute('position').count - a.geometry.getAttribute('position').count);
    const bodyMesh = skinned[0];
    const eyes = skinned.find((m) => (m.material as THREE.Material).name.includes('Eye'))!;
    const brows = skinned.find((m) => m !== bodyMesh && m !== eyes)!;
    for (const m of skinned) for (const a of UNUSED_ATTRS) m.geometry.deleteAttribute(a);
    g.scene.updateMatrixWorld(true);
    shortenNeck(bodyMesh.geometry, [eyes.geometry, brows.geometry], bodyMesh.skeleton.bones.find((b) => b.name === 'neck_01')!.getWorldPosition(new THREE.Vector3()).y);
    const sk = bodyMesh.skeleton;
    const joint: Record<string, number> = {};
    const pos: Record<string, THREE.Vector3> = {};
    const fingerRest: Record<string, THREE.Quaternion> = {};
    sk.bones.forEach((b, i) => {
      joint[b.name] = i;
      pos[b.name] = b.getWorldPosition(new THREE.Vector3());
      if (/^(thumb|index|middle|ring|pinky)_0[123]_/.test(b.name)) fingerRest[b.name] = b.quaternion.clone();
    });
    const bb = new THREE.Box3().setFromBufferAttribute(bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute);
    const hb = new THREE.Box3();
    {
      const pa = bodyMesh.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        if (v.y > pos.Head.y + 0.04 && Math.abs(v.x) < 0.14) hb.expandByPoint(v);
      }
    }
    addSmoothed(bodyMesh.geometry, pos.neck_01.y - 0.02);
    // the left eyeball
    const eye = new THREE.Vector4();
    {
      const pa = eyes.geometry.getAttribute('position');
      const eb = new THREE.Box3();
      const v = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) if (pa.getX(i) > 0) eb.expandByPoint(v.fromBufferAttribute(pa, i));
      const r = (eb.max.x - eb.min.x) / 2;
      eye.set((eb.max.x + eb.min.x) / 2, (eb.max.y + eb.min.y) / 2, eb.max.z - r, r);
    }
    const lm: Landmarks = {
      shoulderX: pos.upperarm_l.x,
      elbowX: pos.lowerarm_l.x,
      wristX: pos.hand_l.x,
      armY: pos.upperarm_l.y,
      neckY: pos.neck_01.y,
      chestY: pos.spine_03.y,
      waistY: (pos.spine_01.y + pos.pelvis.y) / 2 + 0.03,
      kneeY: pos.calf_l.y,
      ankleY: pos.foot_l.y,
      headY: pos.Head.y,
      headTop: bb.max.y,
      skull: hb.getCenter(new THREE.Vector3()),
      skullR: hb.getSize(new THREE.Vector3()).multiplyScalar(0.5),
      joint,
      pos,
      eye,
    };
    refineBrows(brows.geometry, bodyMesh.geometry, eye);
    return {
      template: g.scene,
      bodyName: bodyMesh.name,
      light, dark, normal, rough, lm,
      geometry: bodyMesh.geometry,
      eyes: eyes.geometry,
      brows: brows.geometry,
      boneInverses: sk.boneInverses.map((m) => m.clone()),
      bindMatrix: bodyMesh.bindMatrix.clone(),
      skinMean: meanSkin(light),
      fingerRest,
    };
  };
  const M = body(male, mL, mD, mN, mR);
  const F = body(female, fL, fD, fN, fR);
  // hair: re-index each hair mesh's joints onto the body skeleton's order
  const hairGeo = (g: { scene: THREE.Object3D }): THREE.BufferGeometry => {
    let mesh: THREE.SkinnedMesh | null = null;
    g.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
    });
    const m = mesh as unknown as THREE.SkinnedMesh;
    const geo = m.geometry.clone();
    for (const a of UNUSED_ATTRS) geo.deleteAttribute(a);
    geo.translate(0, -NECK_DROP, 0);
    const si = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
    const map = m.skeleton.bones.map((b) => M.lm.joint[b.name] ?? 0);
    for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) si.setComponent(i, c, map[si.getComponent(i, c)]);
    return geo;
  };
  const [hBuzz, hBuzzF, hParted, hLong, hBuns, hBeard] = rest.map(hairGeo);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of anims.animations) {
    // rotation tracks (and the pelvis' height) only: the bodies are a little taller than the mannequin
    c.tracks = c.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
    clips.set(c.name, c);
  }
  return {
    male: M,
    female: F,
    hair: { buzzed: hBuzz, buzzedfemale: hBuzzF, simpleparted: hParted, long: hLong, buns: hBuns, beard: hBeard },
    hairMap: [h1, h2],
    hairNormal: [h1n, h2n],
    eyeMap: ec,
    eyeNormal: en,
    clips,
    capMap: capTexture(),
  };
}

/** the base's necks are long (a superhero's traps meet the ears): the head sits this much lower */
const NECK_DROP = 0.016;

function shortenNeck(body: THREE.BufferGeometry, onHead: THREE.BufferGeometry[], neckY: number) {
  const pa = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i);
    pa.setY(i, y - NECK_DROP * THREE.MathUtils.smoothstep(y, neckY - 0.07, neckY + 0.06));
  }
  pa.needsUpdate = true;
  for (const g of onHead) g.translate(0, -NECK_DROP, 0);
}

/** hairstyles are authored on one body; worn on the other they move with its head */
const HAIR_OWNER: Record<Exclude<HairId, 'none'> | 'beard', 'male' | 'female'> = {
  buzzed: 'male', simpleparted: 'male', beard: 'male', buzzedfemale: 'female', long: 'female', buns: 'female',
};
const hairFits = new WeakMap<THREE.BufferGeometry, Map<BodyAsset, THREE.BufferGeometry>>();
/** a hairstyle's geometry for a body (moved and scaled onto that body's head when it was made for the other) */
export function hairFor(kit: PeopleKit, style: Exclude<HairId, 'none'> | 'beard', asset: BodyAsset): THREE.BufferGeometry {
  const g = kit.hair[style];
  const owner = kit[HAIR_OWNER[style]];
  if (owner === asset) return g;
  let m = hairFits.get(g);
  if (!m) hairFits.set(g, (m = new Map()));
  let out = m.get(asset);
  if (!out) {
    out = g.clone();
    const a = owner.lm, b = asset.lm;
    const k = b.skullR.x / a.skullR.x;
    out.translate(-a.skull.x, -a.skull.y, -a.skull.z);
    out.scale(k, k, k);
    out.translate(b.skull.x, b.skull.y, b.skull.z);
    m.set(asset, out);
  }
  return out;
}

/** the painted skin's mean colour (linear), over the skin-coloured texels */
function meanSkin(t: THREE.Texture): THREE.Color {
  const out = new THREE.Color(0.55, 0.32, 0.22);
  try {
    const img = t.image as CanvasImageSource;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    let r = 0, gg = 0, b = 0, n = 0;
    const lin = (v: number) => THREE.MathUtils.clamp(new THREE.Color().setRGB(v / 255, 0, 0, THREE.SRGBColorSpace).r, 0, 1);
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx < 40 || (mx - mn) / mx < 0.15) continue;
      r += lin(d[i]);
      gg += lin(d[i + 1]);
      b += lin(d[i + 2]);
      n++;
    }
    if (n > 50) out.setRGB(r / n, gg / n, b / n);
  } catch {
    /* keep the default */
  }
  return out;
}

/**
 * The base's brows are thick slabs standing off the skin. Press them onto it (a third
 * of the height), thin them around each brow's centre line, and mark the lash lines
 * (the part of the mesh round the eye) so they can be drawn dark.
 */
function refineBrows(brows: THREE.BufferGeometry, bodyGeo: THREE.BufferGeometry, eye: THREE.Vector4) {
  const pa = brows.getAttribute('position') as THREE.BufferAttribute;
  const bp = bodyGeo.getAttribute('position') as THREE.BufferAttribute;
  // the skin near the brows
  const skin: number[] = [];
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i), z = bp.getZ(i);
    if (Math.abs(y - eye.y) < 0.07 && z > eye.z - 0.05 && Math.abs(bp.getX(i)) < 0.09) skin.push(bp.getX(i), y, z);
  }
  const n = pa.count;
  const lash = new Float32Array(n);
  // the brow's centre line: mean height per 5 mm of x (brow vertices only)
  const bins = new Map<number, [number, number]>();
  const isLash = (i: number) => {
    const dx = Math.abs(pa.getX(i)) - eye.x, dy = pa.getY(i) - eye.y;
    return dy < eye.w * 1.25 && Math.abs(dx) < eye.w * 1.9;
  };
  for (let i = 0; i < n; i++) {
    if (isLash(i)) continue;
    const k = Math.round(pa.getX(i) / 0.005);
    const b = bins.get(k) ?? [0, 0];
    b[0] += pa.getY(i);
    b[1]++;
    bins.set(k, b);
  }
  for (let i = 0; i < n; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    // nearest skin point
    let best = 1e9, sx = x, sy = y, sz = z;
    for (let j = 0; j < skin.length; j += 3) {
      const d = (skin[j] - x) ** 2 + (skin[j + 1] - y) ** 2 + (skin[j + 2] - z) ** 2;
      if (d < best) { best = d; sx = skin[j]; sy = skin[j + 1]; sz = skin[j + 2]; }
    }
    if (isLash(i)) {
      lash[i] = 1;
      continue;
    }
    // onto the skin: keep 40 % of the stand-off (plus a hair's breadth)
    const d = Math.sqrt(best);
    const k = d > 1e-5 ? (0.0009 + d * 0.4) / d : 1;
    let nx = sx + (x - sx) * k, ny = sy + (y - sy) * k;
    const nz = sz + (z - sz) * k;
    // thinner: toward the centre line
    const b = bins.get(Math.round(x / 0.005));
    if (b) ny = b[0] / b[1] + (ny - b[0] / b[1]) * 0.5;
    nx = nx + 0; // x stays
    pa.setXYZ(i, nx, ny, nz);
  }
  pa.needsUpdate = true;
  brows.setAttribute('aLash', new THREE.BufferAttribute(lash, 1));
  brows.computeVertexNormals();
}

/**
 * Clothes don't show a six-pack: a heavily smoothed copy of the body (positions and
 * normals, below the neck) that the shader blends to wherever there is cloth.
 */
function addSmoothed(geo: THREE.BufferGeometry, neckY: number) {
  const pa = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pa.count;
  // weld the UV seams: one id per position
  const id = new Int32Array(n);
  const map = new Map<string, number>();
  let m = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pa.getX(i) * 2e4)},${Math.round(pa.getY(i) * 2e4)},${Math.round(pa.getZ(i) * 2e4)}`;
    let j = map.get(k);
    if (j === undefined) map.set(k, (j = m++));
    id[i] = j;
  }
  const P = new Float32Array(m * 3);
  for (let i = 0; i < n; i++) P.set([pa.getX(i), pa.getY(i), pa.getZ(i)], id[i] * 3);
  const idx = geo.index!.array;
  const nb: Set<number>[] = Array.from({ length: m }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3) {
    const a = id[idx[t]], b = id[idx[t + 1]], c = id[idx[t + 2]];
    nb[a].add(b).add(c);
    nb[b].add(a).add(c);
    nb[c].add(a).add(b);
  }
  const adj = nb.map((s) => Int32Array.from(s));
  const relax = (src: Float32Array, dim: number, iters: number, lam: number, frozen: (i: number) => boolean) => {
    let a = src.slice(), b = new Float32Array(src.length);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < m; i++) {
        const nb2 = adj[i];
        if (!nb2.length || frozen(i)) { for (let d = 0; d < dim; d++) b[i * dim + d] = a[i * dim + d]; continue; }
        for (let d = 0; d < dim; d++) {
          let acc = 0;
          for (let k = 0; k < nb2.length; k++) acc += a[nb2[k] * dim + d];
          b[i * dim + d] = a[i * dim + d] + lam * (acc / nb2.length - a[i * dim + d]);
        }
      }
      [a, b] = [b, a];
    }
    return a;
  };
  const above = (i: number) => P[i * 3 + 1] > neckY + 0.06;
  // Laplacian: the muscle relief melts away …
  let cur = relax(P, 3, 90, 0.6, above);
  const normalsOf = (X: Float32Array) => {
    const N = new Float32Array(m * 3);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      const a = id[idx[t]], b = id[idx[t + 1]], c = id[idx[t + 2]];
      e1.set(X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]);
      e2.set(X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]);
      fn.crossVectors(e1, e2);
      for (const v of [a, b, c]) { N[v * 3] += fn.x; N[v * 3 + 1] += fn.y; N[v * 3 + 2] += fn.z; }
    }
    for (let i = 0; i < m; i++) {
      const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
      N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
    }
    return N;
  };
  // … and the volume it took is given back at low frequency (the offset along the normal, heavily blurred)
  let N = normalsOf(cur);
  const off = new Float32Array(m);
  for (let i = 0; i < m; i++) off[i] = (P[i * 3] - cur[i * 3]) * N[i * 3] + (P[i * 3 + 1] - cur[i * 3 + 1]) * N[i * 3 + 1] + (P[i * 3 + 2] - cur[i * 3 + 2]) * N[i * 3 + 2];
  const offS = relax(off, 1, 60, 0.6, () => false);
  for (let i = 0; i < m; i++) {
    if (above(i)) continue;
    const o = Math.max(0, offS[i]) * 0.9;
    cur[i * 3] += N[i * 3] * o; cur[i * 3 + 1] += N[i * 3 + 1] * o; cur[i * 3 + 2] += N[i * 3 + 2] * o;
  }
  cur = relax(cur, 3, 6, 0.5, above);
  N = normalsOf(cur);
  const fn = new THREE.Vector3();
  const sp = new Float32Array(n * 3), sn = new Float32Array(n * 3);
  const na = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const j = id[i];
    sp.set([cur[j * 3], cur[j * 3 + 1], cur[j * 3 + 2]], i * 3);
    fn.set(N[j * 3], N[j * 3 + 1], N[j * 3 + 2]);
    if (fn.lengthSq() < 1e-6) fn.fromBufferAttribute(na, i);
    fn.normalize();
    sn.set([fn.x, fn.y, fn.z], i * 3);
  }
  geo.setAttribute('aSmooth', new THREE.BufferAttribute(sp, 3));
  geo.setAttribute('aSmoothN', new THREE.BufferAttribute(sn, 3));
}

// ------------------------------------------------------------------------------------ clothes shader
/**
 * GLSL shared by the single-person material and the instanced crowd. The CL_* macros
 * name where each parameter comes from (uniforms here, per-instance varyings there).
 */
export const CLOTH_GLSL = /* glsl */ `
float clHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float clNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( clHash( i ), clHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( clHash( i + vec3( 0, 1, 0 ) ), clHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( clHash( i + vec3( 0, 0, 1 ) ), clHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( clHash( i + vec3( 0, 1, 1 ) ), clHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// landmarks: J0 = (shoulderX, elbowX, wristX, neckY), J1 = (chestY, waistY, kneeY, ankleY), J2 = (armY, headY, thighX, armZ)
// kinds: K = (top, bottom, gloves 0/1, boots 0/1)
float clTop = 0.0;   // set by clothAt: how much of the result is the top (for the sprite mask)
float clPart = 0.0;  // set by clothAt: 0 skin, 1 top, 2 bottom, 3 shoe, 4 glove
float clEdge = 1.0;  // set by clothAt: 1 well inside the cloth … 0 at an edge that meets skin (the thickness fades there)
// returns coverage (0 skin … 1 cloth) and writes colour + roughness + how much to inflate
float clothAt( vec3 r, vec3 n, vec4 J0, vec4 J1, vec4 J2, vec4 K, vec3 cTop, vec3 cTop2, vec3 cAcc, vec3 cBot, vec3 cShoe, vec3 cGlove, out vec3 col, out float rough, out float puff, out vec2 logoUv ) {
  float ax = abs( r.x );
  float top = K.x, bot = K.y;
  float suit = step( 6.5, top );
  logoUv = vec2( -1.0 );
  clTop = 0.0;
  clPart = 0.0;
  clEdge = 1.0;
  // the arms (T-pose: out along x at shoulder height)
  float arm = step( J0.x - 0.02, ax ) * step( J2.x - 0.2, r.y );
  float cover = 0.0;
  col = cTop; rough = 0.82; puff = 0.0;
  // ---- sleeves
  float sleeveEnd = top < 0.5 ? 0.0 : top < 2.5 ? mix( J0.x, J0.y, 0.42 ) : top < 3.5 ? J0.z - 0.012 : top < 4.5 ? J0.x - 0.05 : J0.z - 0.012;
  float onSleeve = arm * ( 1.0 - smoothstep( sleeveEnd - 0.004, sleeveEnd + 0.004, ax ) );
  // ---- torso: waist to neckline
  float neck = J0.w - 0.005;
  if ( top > 0.5 && top < 2.5 ) neck -= 0.03 * smoothstep( 0.0, 0.09, r.z ) * max( 0.0, 1.0 - pow( ax / 0.09, 2.0 ) );   // a round crew / placket
  if ( top > 3.5 && top < 4.5 ) neck -= 0.08 * smoothstep( 0.02, 0.1, abs( r.z ) ) + 0.06 * smoothstep( 0.1, 0.16, ax );  // vest
  float neckR = J0.x * 0.3 + 0.006 + 0.022 * smoothstep( 0.02, 0.09, r.z ) * step( top, 2.5 );
  float rn = length( vec2( r.x, ( r.z + 0.03 ) * 0.9 ) );
  float torso = ( 1.0 - arm ) * step( J1.y - 0.03, r.y ) * ( 1.0 - smoothstep( neck - 0.004, neck + 0.004, r.y ) );
  // hoodie / jacket / suit: a collar standing round the neck (a tube: it doesn't swallow the jaw)
  if ( top > 4.5 ) {
    float tube = 1.0 - smoothstep( neckR + 0.02, neckR + 0.035, rn );
    float collarTop = J0.w + mix( 0.02, suit > 0.5 ? 0.045 : 0.02, tube );
    torso = max( torso, ( 1.0 - arm ) * ( 1.0 - smoothstep( 0.0, 0.006, r.y - collarTop ) ) * step( J0.w - 0.1, r.y ) * step( rn, 0.2 ) );
  }
  if ( top < 0.5 ) torso = 0.0;
  float onTop = max( onSleeve, torso );
  // how far inside the top's edges (neckline, sleeve end): the cloth closes onto the skin there
  float inNeck = top > 4.5 ? smoothstep( J0.w + ( suit > 0.5 ? 0.045 : 0.02 ), J0.w - 0.01, r.y ) : smoothstep( neck, neck - 0.03, r.y );
  float inSleeve = arm > 0.5 ? smoothstep( sleeveEnd, sleeveEnd - 0.03, ax ) : 1.0;
  clEdge = onTop > 0.0 ? min( ( 1.0 - arm ) > 0.5 ? inNeck : 1.0, inSleeve ) : 1.0;
  // ---- legs
  float legLow = bot < 0.5 ? 1e3 : bot > 2.5 && bot < 3.5 ? J1.z + 0.07 : J1.w + 0.03;
  float onBot = ( 1.0 - arm ) * step( legLow, r.y ) * ( 1.0 - step( J1.y + 0.015, r.y ) );
  // ---- feet, hands
  float onShoe = ( 1.0 - arm ) * ( 1.0 - smoothstep( J1.w + 0.02 + K.w * 0.07, J1.w + 0.03 + K.w * 0.07, r.y ) );
  float onGlove = arm * K.z * smoothstep( J0.z - 0.02, J0.z - 0.012, ax );
  // fabric grain and a few soft folds
  float grain = clNoise( r * 260.0 ) * 0.5 + clNoise( r * 90.0 ) * 0.5;
  float folds = clNoise( vec3( r.x * 9.0, r.y * 5.0, r.z * 9.0 ) );
  if ( onTop > 0.0 ) {
    vec3 c = cTop;
    if ( suit > 0.5 || top > 5.5 ) {
      // race suit / team kit: side panels, sleeve stripe, collar and belt in the accents
      float side = smoothstep( 0.62, 0.78, abs( n.x ) ) * ( 1.0 - arm );
      c = mix( c, cTop2, side );
      c = mix( c, cTop2, arm * smoothstep( 0.72, 0.9, n.y ) );
      c = mix( c, cAcc, ( 1.0 - arm ) * step( J0.w + 0.03, r.y ) );
      c = mix( c, cAcc, ( 1.0 - arm ) * step( J1.y - 0.005, r.y ) * step( r.y, J1.y + 0.03 ) );
      c = mix( c, cAcc, arm * step( J0.z - 0.06, ax ) );
      // piping: a thin accent line where the side panels meet the body
      if ( suit > 0.5 ) c = mix( c, cAcc, ( 1.0 - arm ) * ( 1.0 - smoothstep( 0.0, 0.012, abs( abs( n.x ) - 0.62 ) ) ) * 0.8 );
    } else if ( top > 4.5 && top < 5.5 ) {
      // hoodie: ribbed cuffs and hem, a kangaroo pocket line
      c *= 1.0 - 0.12 * ( arm * step( J0.z - 0.05, ax ) + ( 1.0 - arm ) * step( r.y, J1.y + 0.04 ) );
      c *= 1.0 - 0.1 * ( 1.0 - arm ) * step( 0.04, r.z ) * ( 1.0 - smoothstep( 0.0, 0.004, abs( r.y - J1.y - 0.13 ) ) ) * step( ax, 0.09 );
    } else if ( top > 1.5 && top < 2.5 ) {
      c = mix( c, cTop2, ( 1.0 - arm ) * step( J0.w - 0.045, r.y ) );   // polo collar
      c = mix( c, cTop2, onSleeve * step( sleeveEnd - 0.02, ax ) );
    }
    // chest and back print
    if ( suit > 0.5 || top > 1.5 ) {
      vec2 f = vec2( r.x / 0.34 + 0.5, ( r.y - ( J1.x - 0.05 ) ) / 0.17 );
      vec2 b = vec2( -r.x / 0.34 + 0.5, ( r.y - ( J1.x - 0.1 ) ) / 0.2 );
      if ( torso > 0.5 && r.z > 0.02 && n.z > 0.2 && f.x > 0.0 && f.x < 1.0 && f.y > 0.0 && f.y < 1.0 ) logoUv = vec2( f.x * 0.5, 1.0 - f.y );
      if ( torso > 0.5 && r.z < -0.02 && n.z < -0.2 && b.x > 0.0 && b.x < 1.0 && b.y > 0.0 && b.y < 1.0 ) logoUv = vec2( 0.5 + b.x * 0.5, 1.0 - b.y );
    }
    col = c;
    cover = onTop;
    clTop = onTop;
    clPart = 1.0;
    rough = suit > 0.5 ? 0.7 : top > 5.5 ? 0.62 : 0.86;
    puff = suit > 0.5 ? 0.005 : top > 4.5 ? 0.017 : 0.011;
    // a real shirt hangs off the shoulders: short sleeves flare, the hem stands off the belly
    if ( suit < 0.5 ) {
      puff += onSleeve * ( top < 2.5 ? 0.005 : 0.003 ) * smoothstep( J0.x, sleeveEnd, ax );
      puff += ( 1.0 - arm ) * 0.008 * ( 1.0 - smoothstep( J1.y - 0.03, J1.y + 0.12, r.y ) );
    }
  }
  if ( onBot > 0.0 && cover < 0.5 ) {
    clTop = 0.0;
    clPart = 2.0;
    clEdge = bot > 2.5 && bot < 3.5 ? smoothstep( legLow, legLow + 0.03, r.y ) : 1.0;
    vec3 c = bot > 3.5 ? cTop : cBot;
    if ( bot > 3.5 ) c = mix( c, cTop2, smoothstep( 0.7, 0.85, abs( n.x ) ) );
    if ( bot > 1.5 && bot < 2.5 ) c *= 0.9 + 0.2 * clNoise( vec3( r.x * 900.0, r.y * 60.0, r.z * 900.0 ) );   // denim
    col = c;
    cover = onBot;
    rough = bot > 3.5 ? 0.7 : 0.88;
    puff = bot > 3.5 ? 0.005 : 0.012 + 0.006 * ( 1.0 - smoothstep( J1.w, J1.z, r.y ) );
  }
  if ( onShoe > 0.0 ) {
    clTop = 0.0;
    clPart = 3.0;
    clEdge = 1.0;
    col = mix( cShoe, vec3( 0.92 ), step( r.y, J1.w - 0.055 ) * ( 1.0 - K.w ) );   // trainers: white sole
    cover = 1.0;
    rough = 0.55;
    puff = 0.009;
  }
  if ( onGlove > 0.0 ) {
    clTop = 0.0;
    clPart = 4.0;
    clEdge = 1.0;
    col = cGlove;
    cover = 1.0;
    rough = 0.6;
    puff = 0.003;
  }
  col *= 0.96 + 0.06 * grain + 0.03 * ( folds - 0.5 );
  return cover;
}
`;

export interface ClothParams {
  J0: THREE.Vector4;
  J1: THREE.Vector4;
  J2: THREE.Vector4;
  K: THREE.Vector4;
  cTop: THREE.Color;
  cTop2: THREE.Color;
  cAcc: THREE.Color;
  cBot: THREE.Color;
  cShoe: THREE.Color;
  cGlove: THREE.Color;
}

export function landmarkVectors(lm: Landmarks): { J0: THREE.Vector4; J1: THREE.Vector4; J2: THREE.Vector4 } {
  return {
    J0: new THREE.Vector4(lm.shoulderX, lm.elbowX, lm.wristX, lm.neckY),
    J1: new THREE.Vector4(lm.chestY, lm.waistY, lm.kneeY, lm.ankleY),
    J2: new THREE.Vector4(lm.armY, lm.headY, lm.pos.thigh_l?.x ?? 0.11, lm.pos.upperarm_l?.z ?? -0.06),
  };
}

export function clothParams(lm: Landmarks, look: Look): ClothParams {
  const { J0, J1, J2 } = landmarkVectors(lm);
  const top = new THREE.Color(look.topColor);
  return {
    J0, J1, J2,
    K: new THREE.Vector4(TOP_ID[look.top], BOTTOM_ID[look.bottom], look.gloves ? 1 : 0, look.top === 'suit' ? 1 : 0),
    cTop: top,
    cTop2: new THREE.Color(look.top2 ?? look.topColor),
    cAcc: new THREE.Color(look.accent ?? look.top2 ?? look.topColor),
    cBot: new THREE.Color(look.bottomColor),
    cShoe: new THREE.Color(look.shoeColor ?? 0x1b1c1f),
    cGlove: new THREE.Color(look.gloves ?? 0x111111),
  };
}

/** shape parameters for SHAPE_GLSL: (weight, muscle, female, 0) */
export function shapeVector(look: Look, out = new THREE.Vector4()): THREE.Vector4 {
  return out.set(THREE.MathUtils.clamp(look.weight ?? 0, -1, 1), THREE.MathUtils.clamp(look.muscle ?? 0.25, 0, 1), look.female ? 1 : 0, 0);
}

/** the skin albedo a look asks for (linear) */
export function lookSkin(look: Look, out = new THREE.Color()): THREE.Color {
  // an explicit skin is a display colour (as a palette shows it): real skin reflects ~70 % of that
  if (look.skin === undefined) return skinColor(look.tone, look.undertone ?? 0, out);
  out.set(look.skin);
  // a palette shows skin brighter and paler than it reflects: darker, and a touch more saturated
  const l = (out.r + out.g + out.b) / 3;
  out.r = (l + (out.r - l) * 1.4) * 0.7;
  out.g = (l + (out.g - l) * 1.4) * 0.67;
  out.b = (l + (out.b - l) * 1.4) * 0.64;
  return out;
}

/**
 * GLSL (vertex): the rest position a body vertex is drawn at — cloth over the smoothed
 * body, skin below the neck softened by `muscle`, then the ordinary-person reshape. Needs
 * CLOTH_GLSL and SHAPE_GLSL; `base` is the incoming position (after any face reshape).
 */
export const BODY_REST_GLSL = /* glsl */ `
// where the clothes' patterns are read: the smoothed body, except the hands and feet (the smoothing melts the fingers and toes)
float patternRaw( vec3 p, vec4 J0, vec4 J1 ) {
  return max( smoothstep( J0.z - 0.07, J0.z - 0.035, abs( p.x ) ) * step( J1.x, p.y ), 1.0 - smoothstep( J1.w + 0.02, J1.w + 0.07, p.y ) );
}
float bodySoft( vec3 p, vec4 J0, vec4 J1 ) {
  return ( 1.0 - smoothstep( J0.w - 0.02, J0.w + 0.06, p.y ) ) * ( 1.0 - smoothstep( J0.z - 0.08, J0.z - 0.03, abs( p.x ) ) ) * smoothstep( J1.w + 0.02, J1.w + 0.08, p.y );
}
`;

/** per hairstyle: hairline height over the eyes at the front and at the nape (m), tint strength */
const SCALP: Partial<Record<HairId, [number, number, number]>> = {
  buzzed: [0.058, -0.1, 0.8], buzzedfemale: [0.06, -0.095, 0.75], simpleparted: [0.058, -0.1, 0.75], long: [0.06, -0.1, 0.8], buns: [0.06, -0.1, 0.8],
};

/** the skin + clothes material for one person */
export function bodyMaterial(asset: BodyAsset, look: Look): THREE.MeshPhysicalMaterial {
  const p = clothParams(asset.lm, look);
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'person-body',
    map: asset.light,
    normalMap: asset.normal,
    roughnessMap: asset.rough,
    roughness: 1,
    metalness: 0,
    ior: 1.4,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(1, 1, 1),
  });
  const lm = asset.lm;
  const eye = lm.eye ?? new THREE.Vector4(0.034, lm.headY + 0.1, 0.066, 0.015);
  const stub = new THREE.Color(look.hairColor);
  const u = {
    uDark: { value: asset.dark },
    uTone: { value: look.tone },
    uLogo: { value: look.logo ?? blankLogo() },
    uJ0: { value: p.J0 }, uJ1: { value: p.J1 }, uJ2: { value: p.J2 }, uK: { value: p.K },
    uTopC: { value: p.cTop }, uTop2C: { value: p.cTop2 }, uAccC: { value: p.cAcc }, uBotC: { value: p.cBot }, uShoeC: { value: p.cShoe }, uGloveC: { value: p.cGlove },
    uShape: { value: shapeVector(look) },
    uSkinT: { value: lookSkin(look) },
    uSkinMean: { value: asset.skinMean ?? new THREE.Color(0.55, 0.32, 0.22) },
    uEyeC: { value: eye },
    uStub: { value: new THREE.Vector4(stub.r, stub.g, stub.b, look.female ? 0 : look.beard ? 0.9 : (look.stubble ?? 0)) },
    uScalp: { value: new THREE.Vector4(stub.r * 0.9, stub.g * 0.9, stub.b * 0.9, SCALP[look.hair]?.[2] ?? 0) },
    uScalp2: { value: new THREE.Vector4(SCALP[look.hair]?.[0] ?? 1, SCALP[look.hair]?.[1] ?? 1, 0, 0) },
  };
  mat.userData.cloth = u;
  const maskMode = { value: 0 };
  mat.userData.maskMode = maskMode;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uMaskMode: maskMode });
    sh.vertexShader = patchBodyVertex(sh.vertexShader, true);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uLogo; uniform float uMaskMode; float gTop;
uniform vec4 uJ0; uniform vec4 uJ1; uniform vec4 uJ2; uniform vec4 uK;
uniform vec3 uTopC; uniform vec3 uTop2C; uniform vec3 uAccC; uniform vec3 uBotC; uniform vec3 uShoeC; uniform vec3 uGloveC;
uniform vec3 uSkinT; uniform vec3 uSkinMean; uniform vec4 uEyeC; uniform vec4 uStub; uniform vec4 uScalp; uniform vec4 uScalp2; uniform vec4 uShape;
varying vec3 vRest; varying vec3 vRestN;
float gCloth; float gRough; float gBumpH; float gAO; float gSheen; vec3 gClothC; float gLip; float gRelief;
${LIGHT_GLOBALS}
${NOISE_GLSL}
${CLOTH_GLSL}
${SKIN_GLSL}
${FABRIC_GLSL}
${BUMP_GLSL}
${FACE_DETAIL_GLSL}
${SCALP_GLSL}
${BODY_AO_GLSL}`)
      .replace('#include <lights_physical_pars_fragment>', peopleLightsChunk())
      .replace('#include <map_fragment>', `
{
  vec4 a = texture2D( map, vMapUv );
  vec3 cc; float rr; float pf; vec2 lu;
  gCloth = clothAt( vRest, normalize( vRestN ), uJ0, uJ1, uJ2, uK, uTopC, uTop2C, uAccC, uBotC, uShoeC, uGloveC, cc, rr, pf, lu );
  gRough = rr;
  gTop = clTop * gCloth;
  if ( lu.x >= 0.0 ) { vec4 lg = texture2D( uLogo, lu ); cc = mix( cc, lg.rgb, lg.a ); }
  float seam;
  float fh = fabricHeight( vRest, normalize( vRestN ), uJ0, uJ1, uJ2, clPart, uK.x, seam );
  cc *= 1.0 - 0.18 * seam;
  cc = min( cc, vec3( ${CLOTH_WHITE_MAX.toFixed(2)} ) );
  gClothC = cc;
  gSheen = clPart < 2.5 ? ( uK.w > 0.5 ? 0.35 : 0.45 ) : 0.15;
  // skin: the painted texture as detail over a real skin albedo (grey texels are the underwear)
  // (the underwear is grey paint; so is the scalp, which is skin)
  float sat = max( ( max( a.r, max( a.g, a.b ) ) - min( a.r, min( a.g, a.b ) ) ) / max( a.r, 1e-3 ), smoothstep( uJ1.x + 0.08, uJ1.x + 0.16, vRest.y ) );
  // the base's painted and normal-mapped six-pack, taken down to an ordinary body's relief
  gRelief = mix( 1.0, 0.35 + 0.4 * uShape.y, smoothstep( uJ0.w + 0.02, uJ0.w - 0.04, vRest.y ) * ( 1.0 - smoothstep( uJ0.z - 0.08, uJ0.z - 0.02, abs( vRest.x ) ) ) );
  vec3 sk = skinAlbedo( mix( uSkinMean, a.rgb, gRelief ), uSkinMean, uSkinT, vRest );
  sk = mix( a.rgb, sk, smoothstep( 0.08, 0.2, sat ) );
  float lipW; float faceH;
  sk = faceDetail( sk, vRest, uEyeC, uJ0, uStub, lipW, faceH );
  sk = scalpTint( sk, vRest, uEyeC, uScalp, uScalp2 );
  gLip = lipW;
  diffuseColor.rgb = mix( sk, cc, gCloth );
  gSkin = ( 1.0 - gCloth ) * smoothstep( 0.08, 0.2, sat );
  // pores (faded out once a pixel covers more than a millimetre) and cloth relief
  float px = length( fwidth( vRest ) );
  float pore = ( apNoise( vRest * 1300.0 ) * 0.6 + apNoise( vRest * 2700.0 ) * 0.4 - 0.5 ) * 0.00005 * ( 1.0 - smoothstep( 0.0005, 0.0016, px ) );
  gBumpH = mix( pore + faceH, fh * ( 1.0 - smoothstep( 0.004, 0.012, px ) * 0.7 ), gCloth );
  gAO = bodyAO( vRest, normalize( vRestN ), uJ0, uJ1, uJ2, uEyeC );
  // the shadowed gap under a sleeve's end
  float sEnd = uK.x < 0.5 ? -1.0 : uK.x < 2.5 ? mix( uJ0.x, uJ0.y, 0.42 ) : uK.x > 3.5 && uK.x < 4.5 ? -1.0 : -1.0;
  if ( sEnd > 0.0 ) gAO *= 1.0 - 0.45 * ( 1.0 - gCloth ) * ( 1.0 - smoothstep( 0.0, 0.025, abs( vRest.x ) - sEnd ) ) * step( sEnd, abs( vRest.x ) ) * step( uJ2.x - 0.2, vRest.y );
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( mix( clamp( roughnessFactor * 1.05, 0.42, 0.78 ), 0.3, gLip ), gRough, gCloth );`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * ( 1.0 - gCloth ) * gRelief;') + `
normal = apBump( - vViewPosition, normal, gBumpH, faceDirection );`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.sheenColor = ( gClothC * 0.6 + 0.05 ) * gCloth * gSheen;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= gAO * mix( vec3( 1.0 ), vec3( 1.1, 0.96, 0.9 ), gSkin );
reflectedLight.indirectSpecular *= gAO;
reflectedLight.directDiffuse *= mix( 1.0, gAO, 0.35 );`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if ( uMaskMode > 0.5 ) gl_FragColor = vec4( vec3( step( 0.5, gTop ) ), 1.0 );`);
  };
  mat.customProgramCacheKey = () => 'apex-person-v2';
  return mat;
}

/**
 * Vertex splice for the body (Person material and its shadow depth material): cloth over
 * the smoothed body, softened skin, the reshape and the cloth's thickness. Expects the
 * uniforms uJ0..uJ2, uK, uShape.
 */
function patchBodyVertex(vs: string, withNormal: boolean): string {
  vs = vs.replace('#include <common>', `#include <common>
uniform vec4 uJ0; uniform vec4 uJ1; uniform vec4 uJ2; uniform vec4 uK; uniform vec4 uShape;
attribute vec3 aSmooth; attribute vec3 aSmoothN;
varying vec3 vRest; varying vec3 vRestN;
${CLOTH_GLSL}
${SHAPE_GLSL}
${BODY_REST_GLSL}`);
  const cov = `float gCov; float gPuff;
{
  vec3 cc; float rr; vec2 lu;
  // patterns live on the smoothed body (the same field the fragment shader reads: no jagged edges)
  float pr = patternRaw( position, uJ0, uJ1 );
  gCov = clothAt( mix( aSmooth, position, pr ), normalize( mix( aSmoothN, normal, pr ) ), uJ0, uJ1, uJ2, uK, vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), cc, rr, gPuff, lu );
}
float gSoftK = max( gCov, ( 0.9 - 0.25 * uShape.y ) * bodySoft( position, uJ0, uJ1 ) );`;
  if (withNormal) {
    vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${cov}
objectNormal = normalize( mix( objectNormal, aSmoothN, gSoftK ) );`);
  }
  vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
${withNormal ? '' : cov}
{
  // (on the head aSmooth is the position itself, and the face reshape carries through)
  float prv = patternRaw( position, uJ0, uJ1 );
  vRest = mix( aSmooth, position, prv ) + ( transformed - position );
  vRestN = normalize( mix( aSmoothN, normal, prv ) );
  transformed = mix( transformed, aSmooth, gSoftK );
  transformed = bodyShape( transformed, uJ0, uJ1, uJ2, uShape );
  transformed += aSmoothN * ( gPuff + 0.006 ) * gCov * clEdge;
}`);
  return vs;
}

/**
 * GLSL (fragment): the face's own detail on the skin albedo — jaw stubble / shaved
 * shadow, a flush over the cheeks, nose and ears, the eye sockets; lipW marks the lips
 * (glossier), bumpH is the stubble's relief. E = the left eye (x, y, z, radius).
 */
/**
 * GLSL (fragment): the scalp under the hair tinted with the hair's colour, with a
 * soft, broken hairline, so the hair mesh's hard edge melts into the skin. S = colour + amount,
 * shape: S2.x = hairline height above the eyes at the front, S2.y = at the nape.
 */
export const SCALP_GLSL = /* glsl */ `
vec3 scalpTint( vec3 c, vec3 r, vec4 E, vec4 S, vec4 S2 ) {
  if ( S.w <= 0.0 ) return c;
  vec3 q = r - vec3( 0.0, E.y, E.z );
  float back = smoothstep( -0.02, -0.12, q.z );
  float line = mix( S2.x, S2.y, back );
  // round the sides: above the ears
  line += 0.025 * smoothstep( 0.05, 0.075, abs( r.x ) ) * ( 1.0 - back );
  float n = apNoise( r * 260.0 ) * 0.6 + apNoise( r * 90.0 ) * 0.4;
  float m = smoothstep( line - 0.008, line + 0.018, q.y + ( n - 0.5 ) * 0.01 );
  float hairs = smoothstep( 0.45, 0.8, apNoise( r * 2200.0 ) );
  // fine hairs over skin at the hairline, denser further in
  return mix( c, mix( c * 0.8, S.rgb, 0.5 + 0.5 * m ) * ( 0.7 + 0.45 * hairs ), m * S.w );
}
`;

export const FACE_DETAIL_GLSL = /* glsl */ `
vec3 faceDetail( vec3 c, vec3 r, vec4 E, vec4 J0, vec4 stub, out float lipW, out float bumpH ) {
  lipW = 0.0; bumpH = 0.0;
  float head = smoothstep( J0.w + 0.02, J0.w + 0.05, r.y );
  if ( head <= 0.0 ) return c;
  float ax = abs( r.x );
  vec3 q = r - vec3( 0.0, E.y, 0.0 );
  float front = smoothstep( E.z - 0.1, E.z - 0.06, r.z );
  // lips: the mouth sits ~75 mm below the eyes
  float lip = ( 1.0 - smoothstep( 0.019, 0.027, ax ) ) * smoothstep( -0.093, -0.087, q.y ) * ( 1.0 - smoothstep( -0.064, -0.058, q.y ) ) * smoothstep( E.z - 0.0, E.z + 0.02, r.z );
  lipW = lip;
  c = mix( c, c * vec3( 1.02, 0.78, 0.8 ), lip * 0.6 );
  // a flush: cheeks, nose tip, ears
  float cheek = exp( - pow( ( ax - 0.042 ) / 0.02, 2.0 ) - pow( ( q.y + 0.035 ) / 0.02, 2.0 ) ) * front;
  float nose = exp( - pow( ax / 0.012, 2.0 ) - pow( ( q.y + 0.045 ) / 0.012, 2.0 ) ) * front;
  float ear = smoothstep( 0.065, 0.075, ax ) * smoothstep( E.z - 0.1, E.z - 0.07, r.z ) * ( 1.0 - smoothstep( E.z - 0.05, E.z - 0.03, r.z ) ) * exp( - pow( q.y / 0.035, 2.0 ) );
  c *= mix( vec3( 1.0 ), vec3( 1.08, 0.9, 0.88 ), clamp( cheek * 0.9 + nose * 0.8 + ear * 0.7, 0.0, 1.0 ) );
  // the eye sockets: a little darker and cooler
  vec2 ed = vec2( ax - E.x, ( q.y + 0.003 ) * 1.35 ) / E.w;
  float sock = 1.0 - smoothstep( 1.3, 2.8, length( ed ) );
  c *= mix( vec3( 1.0 ), vec3( 0.8, 0.77, 0.8 ), sock * front );
  // stubble: jaw, chin, upper lip, up the cheeks to the sideburns
  float amt = stub.w;
  if ( amt > 0.001 ) {
    float line = -0.057 + 0.045 * smoothstep( 0.025, 0.07, ax );          // where it stops on the cheek
    float m = smoothstep( line + 0.004, line - 0.006, q.y );
    m *= smoothstep( -0.165, -0.135, q.y );                                  // down under the jaw
    m *= smoothstep( E.z - 0.13, E.z - 0.1, r.z );                            // forward of the ears
    m *= 1.0 - lip;
    // broken edge
    m *= smoothstep( 0.25, 0.55, apNoise( r * 180.0 ) + m * 0.6 );
    float dots = smoothstep( 0.5, 0.78, apNoise( r * 2600.0 ) );
    vec3 hc = min( stub.rgb * 0.7 + 0.01, c * 0.75 );
    float k = m * amt;
    // the shaved shadow: darker and a little blue-grey, then the hairs themselves
    c *= mix( vec3( 1.0 ), vec3( 0.74, 0.76, 0.8 ), k * 0.6 );
    c = mix( c, hc, k * dots * 0.7 );
    bumpH = k * dots * 0.00004;
  }
  return c;
}
`;

/**
 * GLSL (fragment): cheap analytic occlusion from the rest pose — under the chin, the
 * armpits and the sides the arms hang against, between the legs, the eye sockets.
 */
export const BODY_AO_GLSL = /* glsl */ `
float bodyAO( vec3 r, vec3 n, vec4 J0, vec4 J1, vec4 J2, vec4 E ) {
  float ax = abs( r.x );
  float armY = J2.x;
  float arm = smoothstep( J0.x - 0.03, J0.x + 0.01, ax ) * step( armY - 0.2, r.y );
  float ao = 1.0;
  // the neck under the jaw
  float neck = smoothstep( J0.w - 0.05, J0.w + 0.0, r.y ) * ( 1.0 - smoothstep( J0.w + 0.05, J0.w + 0.075, r.y ) );
  ao -= 0.35 * neck * ( 1.0 - arm );
  // the torso's sides and the insides of the arms (they face each other when the arms are down)
  float sideT = ( 1.0 - arm ) * smoothstep( 0.4, 0.9, abs( n.x ) ) * smoothstep( J1.y - 0.1, J1.y + 0.05, r.y ) * ( 1.0 - smoothstep( armY - 0.02, armY + 0.02, r.y ) );
  float innerA = arm * smoothstep( 0.2, 0.8, - n.y ) * ( 1.0 - smoothstep( J0.y, J0.z, ax ) );
  ao -= 0.3 * sideT + 0.25 * innerA;
  // armpits
  ao -= 0.3 * ( 1.0 - arm ) * exp( - pow( ( ax - J0.x + 0.03 ) / 0.04, 2.0 ) - pow( ( r.y - armY + 0.07 ) / 0.05, 2.0 ) );
  // between the legs
  float legs = ( 1.0 - smoothstep( J1.y - 0.15, J1.y - 0.08, r.y ) ) * step( J1.w, r.y );
  ao -= 0.35 * legs * smoothstep( 0.1, 0.7, - n.x * sign( r.x ) );
  // toward the ground
  ao *= mix( 0.7, 1.0, smoothstep( 0.0, 0.35, r.y ) );
  return clamp( ao, 0.35, 1.0 );
}
`;

let _blank: THREE.Texture | null = null;
function blankLogo(): THREE.Texture {
  if (_blank) return _blank;
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return (_blank = t);
}

/** a chest + back print: sponsor and team on the front, a name/number on the back */
export function printTexture(front: { text: string; color: string; sub?: string; num?: string }, back: { text: string; color: string; num?: string }, font = '"Titillium Web", Arial, sans-serif'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = front.color;
  g.font = `italic 900 92px ${font}`;
  g.fillText(front.text, 256, 150, 420);
  if (front.sub) {
    g.font = `700 34px ${font}`;
    g.fillText(front.sub, 150, 50, 200);
  }
  if (front.num) {
    g.font = `italic 900 50px ${font}`;
    g.fillText(front.num, 400, 50, 120);
  }
  g.fillStyle = back.color;
  g.font = `900 70px ${font}`;
  g.fillText(back.text, 768, 70, 440);
  if (back.num) {
    g.font = `italic 900 120px ${font}`;
    g.fillText(back.num, 768, 180, 300);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------------------------ hair
/**
 * Hair, beard and brows: the base's sculpted clumps with strand streaks along the
 * growth direction and Kajiya-Kay highlights. mode 0 scalp, 1 beard, 2 brows.
 */
export function hairMaterial(kit: PeopleKit, color: THREE.ColorRepresentation, lm: Landmarks, mode: 0 | 1 | 2, long = false, tuck?: ReturnType<typeof capTuckUniforms>): THREE.MeshStandardMaterial {
  const k = long ? 1 : 0;
  const base = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({
    map: mode === 2 ? null : kit.hairMap[k],
    normalMap: mode === 2 ? null : kit.hairNormal[k],
    color: mode === 2 ? base.clone().multiplyScalar(0.8) : base.clone().multiplyScalar(2.0),
    roughness: 0.6,
    metalness: 0,
    side: THREE.DoubleSide,
    name: 'person-hair',
  });
  if (mode === 2) {
    m.transparent = true;
    m.depthWrite = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  const crown = new THREE.Vector3(lm.skull.x, lm.headTop - 0.03, lm.skull.z - 0.03);
  const u = { uCrown: { value: crown }, uHairMode: { value: mode }, uEyeC: { value: lm.eye ?? new THREE.Vector4() } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, tuck ?? {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${tuck ? 'transformed = tuckHair( transformed, 1.0 );' : ''}`)
      .replace('#include <common>', `#include <common>
${tuck ? TUCK_GLSL : ''}
uniform vec3 uCrown; uniform float uHairMode;
varying vec3 vHairT; varying vec3 vHairP;
${mode === 2 ? 'attribute float aLash; varying float vLash;' : ''}`)
      .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
{
  vec3 tb = uHairMode > 0.5 ? vec3( 0.0, -1.0, 0.25 ) : position - uCrown;
  if ( uHairMode > 1.5 ) tb = vec3( sign( position.x ), 0.15, 0.0 );
  tb = tb - normal * dot( tb, normal );
  if ( dot( tb, tb ) < 1e-8 ) tb = vec3( 0.0, -1.0, 0.0 );
  #ifdef USE_SKINNING
  tb = ( skinMatrix * vec4( tb, 0.0 ) ).xyz;
  #endif
  vHairT = normalize( normalMatrix * tb );
  vHairP = position;
  ${mode === 2 ? 'vLash = aLash;' : ''}
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uCrown; uniform float uHairMode; uniform vec4 uEyeC;
varying vec3 vHairT; varying vec3 vHairP;
${mode === 2 ? 'varying float vLash;' : ''}
${LIGHT_GLOBALS}
${NOISE_GLSL}`)
      .replace('#include <lights_physical_pars_fragment>', peopleLightsChunk())
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 p = vHairP - uCrown;
  float str;
  if ( uHairMode < 0.5 ) {
    // strands run from the crown: vary fast across (azimuth), slowly along (height)
    float az = atan( p.x, p.z );
    str = apNoise( vec3( az * 70.0, vHairP.y * 7.0, 0.5 ) ) * 0.55 + apNoise( vec3( az * 260.0, vHairP.y * 20.0, 3.0 ) ) * 0.45;
  } else {
    str = apNoise( vec3( vHairP.x * 900.0, vHairP.y * 50.0, vHairP.z * 900.0 ) ) * 0.6 + apNoise( vec3( vHairP.x * 2400.0, vHairP.y * 90.0, vHairP.z * 2400.0 ) ) * 0.4;
  }
  // the clumps' baked shading reads as depth between locks; strands streak along them
  diffuseColor.rgb *= 0.5 + 0.95 * str;
  gHairShift = ( str - 0.5 ) * 0.35;
  gHairTint = diffuseColor.rgb * 1.4;
  gHair = uHairMode > 1.5 ? 0.4 : 1.0;
  ${mode === 2 ? `
  // brows: sparse hairs, soft edges; the lash lines dark
  diffuseColor.a = ( 0.55 + 0.45 * smoothstep( 0.35, 0.65, str ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.018, 0.014, 0.012 ), vLash );
  diffuseColor.a = mix( diffuseColor.a * 0.85, 0.92, vLash );` : ''}
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
gHairT = normalize( vHairT - normal * dot( vHairT, normal ) );`);
  };
  m.customProgramCacheKey = () => `apex-hair-v1-${mode}${tuck ? '-tuck' : ''}`;
  return m;
}

// ------------------------------------------------------------------------------------ props
/** bake a geometry rigidly onto one bone: skinIndex = bone, weight 1 (positions already in bind space) */
export function rigid(geo: THREE.BufferGeometry, bone: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

/** the cap's cloth: six crown panels with stitched seams, eyelets, a top button, a stitched brim (u around, v: 0..0.5 crown top→rim, 0.5..1 brim) */
function capTexture(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 256);
  // twill
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * 512, Math.random() * 128, 2, 1);
  }
  // crown seams (six panels, one at the front centre), with stitch rows either side
  for (let k = 0; k < 6; k++) {
    const x = (k / 6) * 512;
    for (const xx of [x, x + 512]) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(xx - 1.5, 0, 3, 128);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 4; y < 124; y += 5) {
        g.fillRect(xx - 6, y, 1.5, 3);
        g.fillRect(xx + 4.5, y, 1.5, 3);
      }
    }
    // eyelet
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.arc(x + 512 / 12, 44, 3, 0, Math.PI * 2);
    g.fill();
  }
  // top button area
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 512, 6);
  // brim: rows of stitching parallel to the edge
  g.fillStyle = '#ffffff';
  g.fillRect(0, 128, 512, 128);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  for (const v of [0.55, 0.64, 0.73, 0.82]) for (let x = 2; x < 512; x += 6) g.fillRect(x, v * 256, 3, 1.5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * A baseball cap in bind space: a six-panel dome fitted over the skull (the rim tilted:
 * low at the back, just above the brows at the front), a button, and a curved brim with
 * a darker underside. Has uv (for the cap texture) and colour (brim underside).
 */
export function capGeometry(asset: BodyAsset, back = false, low = false): THREE.BufferGeometry {
  const lm = asset.lm;
  const geo = asset.geometry;
  const pa = geo.getAttribute('position') as THREE.BufferAttribute;
  const c = lm.skull, top = lm.headTop;
  const eyeY = lm.eye?.y ?? lm.headY + 0.1;
  // the rim: front just above the brows, back low on the head
  const frontY = eyeY + 0.036, backY = eyeY - 0.012;
  // the cranium above the ears sets the dome's size
  const pts: THREE.Vector3[] = [];
  let zMin = Infinity, zMax = -Infinity, ax = 0;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    if (y < eyeY + 0.035 || Math.abs(x) > 0.085) continue;
    pts.push(new THREE.Vector3(x, y, z));
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    ax = Math.max(ax, Math.abs(x - c.x));
  }
  const cz = (zMin + zMax) / 2;
  const rimY = (frontY + backY) / 2;
  let az = (zMax - zMin) / 2;
  const slope = (frontY - backY) / (2 * az);
  let ay = top - rimY - slope * 0;
  // grow the dome until the cranium is inside (a little), then stand it off for hair and fabric
  let worst = 0;
  for (const p of pts) {
    const h0 = THREE.MathUtils.clamp((p.y - rimY) / ay, 0, 1);
    const lx = (p.x - c.x) / ax, lz = (p.z - cz) / az, ly = (p.y - rimY - slope * (p.z - cz) * (1 - h0 * h0)) / ay;
    if (ly < 0) continue;
    worst = Math.max(worst, lx * lx + ly * ly + lz * lz);
  }
  const s = THREE.MathUtils.clamp(Math.sqrt(worst), 1, 1.08);
  ax = ax * s + 0.01;
  ay = ay * s * 0.9 + 0.006;
  az = az * s + 0.01;
  const NU = low ? 24 : 48, NV = low ? 6 : 12;
  const P: number[] = [], UV: number[] = [], C: number[] = [], I: number[] = [];
  const dome = (th: number, ph: number, o = 0) => {
    // a cap crown is a dome, a little fuller at the front panels
    const sp = Math.sin(ph), cp = Math.cos(ph);
    const fr = 1 + 0.05 * Math.max(0, Math.cos(th)) * sp;
    const x = (ax + o) * sp * Math.sin(th);
    const z = (az + o) * sp * Math.cos(th) * fr;
    // steeper walls than an ellipsoid (a cap, not a bowl), the front panels a little taller
    const y = (ay + o) * (1 + 0.04 * Math.max(0, Math.cos(th))) * Math.pow(cp, 0.75) + 0.012 * Math.pow(Math.sin(th), 2) * Math.pow(sp, 4);
    // the rim is tilted (low at the back); the tilt fades toward the crown
    return new THREE.Vector3(c.x + x, rimY + y + slope * z * sp * sp, cz + z);
  };
  for (let j = 0; j <= NV; j++) {
    for (let i = 0; i <= NU; i++) {
      const th = (i / NU) * Math.PI * 2 + (back ? Math.PI : 0);
      const ph = (j / NV) * (Math.PI / 2);
      const p = dome(th, ph);
      P.push(p.x, p.y, p.z);
      UV.push(i / NU + 1 / 12, 1 - (j / NV) * 0.5);
      C.push(1, 1, 1);
    }
  }
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, d = a + NU + 1, e = d + 1;
      I.push(a, d, b, b, d, e);
    }
  // the brim: from the rim at the front, a rounded D, dipping at the sides, pitched down a little
  const base = P.length / 3;
  const NB = low ? 10 : 24, NR = low ? 2 : 5;
  const thB = 1.0;
  const rimAt = (th: number) => dome(th + (back ? Math.PI : 0), Math.PI / 2);
  const brimPt = (i: number, r: number, below: boolean) => {
    const th = -thB + (i / NB) * 2 * thB;
    const p = rimAt(th);
    const out = new THREE.Vector3(Math.sin(th + (back ? Math.PI : 0)), 0, Math.cos(th + (back ? Math.PI : 0)));
    const len = 0.08 * Math.pow(Math.max(0, Math.cos((th / thB) * (Math.PI / 2))), 0.42);
    const d = r * len;
    const q = p.clone().addScaledVector(out, d);
    // side droop and a slight downward pitch, curling more toward the edge
    q.y -= 0.022 * Math.pow(th / thB, 2) * r + 0.06 * d + 0.06 * d * d / 0.08;
    if (below) q.y -= 0.005;
    return q;
  };
  for (const below of [false, true])
    for (let r = 0; r <= NR; r++)
      for (let i = 0; i <= NB; i++) {
        const q = brimPt(i, r / NR, below);
        P.push(q.x, q.y, q.z);
        UV.push(i / NB, 0.5 - (r / NR) * 0.5);
        const k = below ? 0.45 : 1;
        C.push(k, k, k * 0.97);
      }
  const row = NB + 1, layer = row * (NR + 1);
  for (let r = 0; r < NR; r++)
    for (let i = 0; i < NB; i++) {
      const a = base + r * row + i, b = a + 1, d = a + row, e = d + 1;
      I.push(a, d, b, b, d, e);
      I.push(a + layer, b + layer, d + layer, b + layer, e + layer, d + layer);
    }
  // the brim's edge
  for (let i = 0; i < NB; i++) {
    const a = base + NR * row + i, b = a + 1;
    I.push(a, b, a + layer, b, b + layer, a + layer);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  // the button on top
  const btn = new THREE.SphereGeometry(0.008, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  btn.scale(1, 0.5, 1);
  const tp = dome(0, 0);
  btn.translate(tp.x, tp.y - 0.001, tp.z);
  const bn = btn.getAttribute('position').count;
  btn.setAttribute('color', new THREE.Float32BufferAttribute(new Array(bn * 3).fill(1), 3));
  const buv = new Float32Array(bn * 2).fill(0.01);
  btn.setAttribute('uv', new THREE.BufferAttribute(buv, 2));
  const out = mergeKeep([g, btn]);
  out.userData.capFit = { center: new THREE.Vector3(c.x, rimY, cz), radii: new THREE.Vector3(ax, ay, az), slope };
  return out;
}

/** GLSL: keep hair inside a cap's dome (uCapC = centre + on/off, uCapR = radii + tilt) */
export const TUCK_GLSL = /* glsl */ `
uniform vec4 uCapC; uniform vec4 uCapR;
vec3 tuckHair( vec3 p, float on ) {
  if ( on < 0.5 ) return p;
  vec3 d = p - uCapC.xyz;
  float above = smoothstep( -0.012, 0.004, d.y - uCapR.w * d.z );
  vec3 R = uCapR.xyz - vec3( 0.013, 0.011, 0.013 );
  vec3 dd = vec3( d.x, d.y - uCapR.w * d.z * 0.6, d.z );
  float e = length( dd / R );
  if ( e <= 1.0 ) return p;
  vec3 inside = uCapC.xyz + d / e;
  return mix( p, inside, above );
}
`;

const capFits = new WeakMap<BodyAsset, { center: THREE.Vector3; radii: THREE.Vector3; slope: number }>();
/** the uniforms TUCK_GLSL reads, for a body's cap */
export function capTuckUniforms(asset: BodyAsset) {
  let fit = capFits.get(asset);
  if (!fit) {
    const g = capGeometry(asset);
    fit = g.userData.capFit as { center: THREE.Vector3; radii: THREE.Vector3; slope: number };
    g.dispose();
    capFits.set(asset, fit);
  }
  return {
    uCapC: { value: new THREE.Vector4(fit.center.x, fit.center.y, fit.center.z, 1) },
    uCapR: { value: new THREE.Vector4(fit.radii.x, fit.radii.y, fit.radii.z, fit.slope) },
  };
}

/** merge (non-indexed) keeping position, normal, uv and colour */
function mergeKeep(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color'];
  const acc: Record<string, number[]> = { position: [], normal: [], uv: [], color: [] };
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const n of names) acc[n].push(...(g.getAttribute(n).array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(acc.position, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normal, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(acc.color, 3));
  return out;
}

/** a radio headset: band over the head, two cups, a boom mic */
export function headsetGeometry(lm: Landmarks): THREE.BufferGeometry {
  const top = lm.headTop;
  const hw = lm.skullR.x + 0.02;
  const band = new THREE.TorusGeometry(hw, 0.009, 6, 24, Math.PI);
  band.translate(lm.skull.x, top - hw + 0.012, lm.skull.z);
  const parts: THREE.BufferGeometry[] = [band];
  for (const s of [-1, 1]) {
    const cup = new THREE.CylinderGeometry(0.042, 0.042, 0.035, 18);
    cup.rotateZ(Math.PI / 2);
    cup.translate(lm.skull.x + s * (hw - 0.004), lm.skull.y - 0.005, lm.skull.z);
    parts.push(cup);
  }
  const mic = new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6);
  mic.rotateX(Math.PI / 2 - 0.35);
  mic.rotateY(0.5);
  mic.translate(-0.075, top - 0.165, 0.06);
  parts.push(mic);
  return mergeSimple(parts);
}

export function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ps: number[] = [], ns: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    g.computeVertexNormals();
    ps.push(...(g.getAttribute('position').array as Float32Array));
    ns.push(...(g.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
  return out;
}

/** a cap's material: the panel/stitch texture over the cap colour, brim underside darker */
export function capMaterial(kit: PeopleKit | null, color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.92), map: kit?.capMap ?? null, vertexColors: true, roughness: 0.82, name: 'person-cap' });
}

// ------------------------------------------------------------------------------------ hands
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/**
 * How far each clip's finger pose is kept (1 = as animated). The idle clips are clenched
 * fists (superhero), a real resting hand is loosely curled.
 */
export const CLIP_HANDS: Record<string, number> = {
  Idle_Loop: 0.6, Idle_Talking_Loop: 0.65, Walk_Loop: 0.6, Walk_Formal_Loop: 0.6, Jog_Fwd_Loop: 0.7, Sitting_Idle_Loop: 0.6,
  Sitting_Talking_Loop: 0.65, Dance_Loop: 0.6, Jump_Loop: 0.65, Crouch_Idle_Loop: 0.6,
};

/** idle clips whose stance is corrected: arms in toward the body (radians), legs straightened under the hips (weight 0..1), back straightened (radians) */
export const IDLE_STANCE: Record<string, [number, number, number]> = { Idle_Loop: [0.2, 0.8, 0.09], Idle_Talking_Loop: [0.08, 0.7, 0.06] };

// ------------------------------------------------------------------------------------ a person
export class Person {
  readonly root: THREE.Group;
  readonly body: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  readonly bones: Record<string, THREE.Bone> = {};
  readonly mixer: THREE.AnimationMixer;
  readonly asset: BodyAsset;
  /** idle life (breathing, small head movement) and relaxed hands on top of the clip */
  lively = true;
  /** override how much of the clip's finger pose is kept (null: per clip, CLIP_HANDS) */
  handPose: number | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private readonly owned: THREE.Material[] = [];
  private readonly ownedGeo: THREE.BufferGeometry[] = [];
  private life = 0;
  private readonly seed: number;
  private readonly fingerBones: [THREE.Bone, THREE.Quaternion][] = [];
  private readonly lifeAxes: Record<string, THREE.Vector3> = {};
  private eyeU: { uBlink: THREE.IUniform } | null = null;
  private blinkAt = 0;

  constructor(readonly kit: PeopleKit, readonly look: Look) {
    const asset = (this.asset = look.female ? kit.female : kit.male);
    this.root = new THREE.Group();
    this.root.name = 'person';
    const clone = SkeletonUtils.clone(asset.template);
    const inner = new THREE.Group();
    inner.add(clone);
    const h = look.height ?? 1, b = look.build ?? 1;
    inner.scale.set(b * h, h, b * h);
    this.root.add(inner);
    let body: THREE.SkinnedMesh | null = null;
    const others: THREE.SkinnedMesh[] = [];
    clone.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        if (m.name === asset.bodyName) body = m;
        else others.push(m);
      }
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
    });
    this.body = body as unknown as THREE.SkinnedMesh;
    this.skeleton = this.body.skeleton;
    const bodyMat = bodyMaterial(asset, look);
    this.body.material = bodyMat;
    this.owned.push(bodyMat);
    this.body.customDepthMaterial = bodyDepthMaterial(bodyMat);
    this.owned.push(this.body.customDepthMaterial);
    const lm = asset.lm;
    const hairCol = new THREE.Color(look.hairColor);
    const tuck = look.cap ? capTuckUniforms(asset) : undefined;
    const hairMat = (mode: 0 | 1 | 2, long = false) => {
      const m = hairMaterial(kit, hairCol, lm, mode, long, mode === 0 ? tuck : undefined);
      this.owned.push(m);
      return m;
    };
    // a seeded variety for the eyes
    let hs = 0;
    for (const ch of JSON.stringify([look.tone, look.hairColor, look.topColor, look.height, look.female])) hs = (hs * 31 + ch.charCodeAt(0)) | 0;
    this.seed = (Math.abs(hs) % 1000) / 1000;
    for (const o of others) {
      const isEyes = (o.material as THREE.Material).name.includes('Eye');
      if (isEyes) {
        o.material = eyeMaterial(lm.eye ?? new THREE.Vector4(0.034, lm.headY + 0.1, 0.066, 0.015), new THREE.Color(look.eyeColor ?? defaultEyeColor(look, this.seed)), lookSkin(look));
        this.eyeU = (o.material as THREE.Material).userData.eye;
        o.renderOrder = 0;
      } else {
        o.material = hairMat(2);
        o.renderOrder = 1;
      }
      this.owned.push(o.material as THREE.Material);
      o.castShadow = false;
    }
    const attach = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bind(this.skeleton, this.body.bindMatrix);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.body.parent!.add(m);
      return m;
    };
    // under a cap the hair is cropped (long hair stays: it hangs below the cap)
    const hair: HairId = look.cap && (look.hair === 'simpleparted' || look.hair === 'buns') ? (look.female ? 'buzzedfemale' : 'buzzed') : look.hair;
    if (hair !== 'none') attach(hairFor(kit, hair, asset), hairMat(0, hair === 'long' || hair === 'buns'));
    if (look.beard && !look.female) attach(hairFor(kit, 'beard', asset), hairMat(1));
    const head = lm.joint.Head;
    if (look.cap) {
      const g = rigid(capGeometry(asset, look.capBack), head);
      this.ownedGeo.push(g);
      const m = capMaterial(kit, look.cap);
      this.owned.push(m);
      attach(g, m);
    }
    if (look.headset) {
      const g = rigid(headsetGeometry(lm), head);
      this.ownedGeo.push(g);
      const m = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.45, metalness: 0.3 });
      this.owned.push(m);
      attach(g, m);
    }
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false;
    if (look.face) {
      const fu = faceUniforms(lm, look);
      this.body.parent!.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh) patchFace(m.material as THREE.Material, fu);
      });
    }
    this.mixer = new THREE.AnimationMixer(clone);
    // fingers, and the axes the idle life turns about (the person's own left, in each bone's frame)
    for (const f of FINGERS)
      for (const s of ['l', 'r'])
        for (let k = 1; k <= 3; k++) {
          const name = `${f}_0${k}_${s}`;
          const bone = this.bones[name];
          const rest = asset.fingerRest?.[name];
          if (bone && rest) this.fingerBones.push([bone, rest]);
        }
    clone.updateMatrixWorld(true);
    const q = new THREE.Quaternion();
    for (const [name, axis] of [['spine_02', [1, 0, 0]], ['spine_03', [1, 0, 0]], ['neck_01', [0, 1, 0]], ['Head', [1, 0, 0]], ['HeadY', [0, 1, 0]], ['clavicle_l', [0, 0, 1]], ['clavicle_r', [0, 0, 1]],
      ['upperarm_l', [0, 0, 1]], ['upperarm_r', [0, 0, 1]], ['thigh_l', [0, 0, 1]], ['thigh_r', [0, 0, 1]], ['foot_l', [0, 0, 1]], ['foot_r', [0, 0, 1]]] as [string, number[]][]) {
      const bone = this.bones[name === 'HeadY' ? 'Head' : name];
      if (!bone) continue;
      bone.getWorldQuaternion(q).invert();
      this.lifeAxes[name] = new THREE.Vector3(axis[0], axis[1], axis[2]).applyQuaternion(q).normalize();
    }
    this.life = this.seed * 100;
  }

  /** attach a prop built in bind space to one bone */
  attachProp(geo: THREE.BufferGeometry, bone: string, mat: THREE.Material, shadow = true): THREE.SkinnedMesh {
    const g = rigid(geo, this.asset.lm.joint[bone]);
    this.ownedGeo.push(g);
    const m = new THREE.SkinnedMesh(g, mat);
    m.bind(this.skeleton, this.body.bindMatrix);
    m.castShadow = shadow;
    m.frustumCulled = false;
    this.body.parent!.add(m);
    return m;
  }

  /** cross-fade to a clip */
  play(name: string, opts: { fade?: number; speed?: number; offset?: number; once?: boolean } = {}) {
    const clip = this.kit.clips.get(name);
    if (!clip) return;
    let a = this.actions.get(name);
    if (!a) {
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    if (a === this.current) return;
    a.reset();
    a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = !!opts.once;
    a.timeScale = opts.speed ?? 1;
    a.time = (opts.offset ?? 0) * clip.duration;
    a.play();
    if (this.current) a.crossFadeFrom(this.current, opts.fade ?? 0.4, false);
    this.current = a;
    this.currentName = name;
  }

  update(dt: number) {
    this.mixer.update(dt);
    this.life += dt;
    if (this.lively) this.applyLife();
    this.root.updateMatrixWorld(true);
  }

  /**
   * Loosen the fingers toward their rest pose: 1 keeps the clip's pose, 0 is the flat
   * T-pose hand; ~0.4 turns the clips' clenched fists into a resting curl.
   */
  relaxHands(keep: number) {
    if (keep >= 1) return;
    for (const [bone, rest] of this.fingerBones) bone.quaternion.slerpQuaternions(rest, bone.quaternion, keep);
  }

  private readonly lq = new THREE.Quaternion();
  private readonly lv = new THREE.Vector3();
  private turnLocal(name: string, angle: number) {
    const b = this.bones[name === 'HeadY' ? 'Head' : name], ax = this.lifeAxes[name];
    if (!b || !ax || !angle) return;
    b.quaternion.multiply(this.lq.setFromAxisAngle(ax, angle));
  }

  /** breathing, a drifting gaze, loose hands: what stops an idle clip looking like a mannequin */
  private applyLife() {
    this.settle(this.life, this.handPose ?? CLIP_HANDS[this.currentName] ?? 1, this.currentName);
    // blinks: every 2-6 s, a sixth of a second, now and then a double
    if (this.eyeU) {
      const t = this.life;
      if (t > this.blinkAt + 0.18) {
        const r = Math.abs(Math.sin(t * 12.9898 + this.seed * 78.233) * 43758.5453) % 1;
        this.blinkAt = t + (r < 0.15 ? 0.25 : 2 + r * 4);
      }
      const k = (t - this.blinkAt) / 0.16;
      this.eyeU.uBlink.value = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
    }
  }

  /**
   * The life layer at time t over whatever pose the bones hold now (after the mixer):
   * hands loosened to `handKeep`, the idle stance of `clip` corrected, breathing and
   * gaze. update() calls it; the crowd bake calls it per frame.
   */
  settle(t: number, handKeep: number, clip: string) {
    const s = this.seed;
    this.relaxHands(handKeep);
    // the idle clips stand like a superhero: arms held out, feet wide. Bring them in.
    const st = IDLE_STANCE[clip];
    if (st) {
      this.turnLocal('upperarm_l', -st[0]);
      this.turnLocal('upperarm_r', st[0]);
      // stand up straight: the clip leans into a ready crouch, head pushed forward
      this.turnLocal('spine_02', -st[2]);
      this.turnLocal('spine_03', -st[2]);
      this.turnLocal('neck_01', -st[2] * 0.6);
      this.turnLocal('Head', st[2] * 1.2);
      // legs: under the hips, knees nearly straight, a little weight shifting from one to the other
      this.root.updateMatrixWorld(true);
      const shift = Math.sin(t * 0.21 + s * 6) * 0.5 + Math.sin(t * 0.13 + s * 2) * 0.5;
      for (const side of ['l', 'r'] as const) {
        const o = side === 'l' ? 1 : -1;
        const bend = 0.04 + 0.05 * Math.max(0, shift * o);
        this.aim(`thigh_${side}`, `calf_${side}`, this.dir(0.045 * o, -1, 0.02 + bend, this.lv), st[1]);
        this.aim(`calf_${side}`, `foot_${side}`, this.dir(0.02 * o, -1, -0.03 - bend * 0.6, this.lv), st[1]);
        // forearms hanging, elbows only a little bent (the clip holds them up like a boxer's)
        this.aim(`lowerarm_${side}`, `hand_${side}`, this.dir(0.04 * o, -1, 0.32 + 0.04 * Math.sin(t * 0.4 + s * 9 + o), this.lv), st[1] * 0.75);
      }
    }
    // breathing: ~15 a minute, chest rising, shoulders lifting a hair
    const br = Math.sin(t * (1.5 + s * 0.3));
    this.turnLocal('spine_02', -0.008 * br);
    this.turnLocal('spine_03', -0.014 * br);
    this.turnLocal('clavicle_l', 0.01 * br);
    this.turnLocal('clavicle_r', -0.01 * br);
    // the head: slow drift plus now-and-then glances
    const n1 = Math.sin(t * 0.37 + s * 9) * 0.6 + Math.sin(t * 0.83 + s * 3) * 0.4;
    const n2 = Math.sin(t * 0.29 + s * 5) * 0.6 + Math.sin(t * 0.71 + s * 7) * 0.4;
    const glance = Math.sin(t * 0.13 + s * 11);
    this.turnLocal('HeadY', 0.05 * n1 + 0.12 * Math.max(0, glance - 0.6) * Math.sign(Math.sin(s * 40)));
    this.turnLocal('Head', 0.03 * n2);
    this.turnLocal('neck_01', 0.02 * n1);
  }

  // ---------------------------------------------------------------- procedural posing (after the mixer)
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  /** rotate a bone by `angle` about a world-space axis (keeps its children attached) */
  rotateWorld(name: string, axis: THREE.Vector3, angle: number) {
    const b = this.bones[name];
    if (!b || !angle) return;
    b.parent!.getWorldQuaternion(this.q1);
    // local' = P⁻¹ · R · P · local
    this.q2.setFromAxisAngle(axis, angle);
    const pInv = this.q1.clone().invert();
    b.quaternion.premultiply(pInv.multiply(this.q2).multiply(this.q1));
    b.updateMatrixWorld(true);
  }

  /** swing a bone so the direction to `child` points along `dir` (world space), blended by w */
  aim(name: string, child: string, dir: THREE.Vector3, w = 1) {
    const b = this.bones[name], c = this.bones[child];
    if (!b || !c || w <= 0) return;
    b.updateMatrixWorld(true);
    const from = c.getWorldPosition(this.v1).sub(b.getWorldPosition(this.v2)).normalize();
    const to = this.v2.copy(dir).normalize();
    const delta = this.q2.setFromUnitVectors(from, to);
    if (w < 1) delta.slerp(this.q1.identity(), 1 - w);
    b.parent!.getWorldQuaternion(this.q1);
    const pInv = this.q1.clone().invert();
    b.quaternion.premultiply(pInv.multiply(delta).multiply(this.q1));
    b.updateMatrixWorld(true);
  }

  /** a world direction from the person's own frame (x = their left, y up, z forward) */
  dir(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.getWorldQuaternion(this.q1);
    return out.set(x, y, z).applyQuaternion(this.q1);
  }

  worldOf(bone: string, out = new THREE.Vector3()): THREE.Vector3 {
    return this.bones[bone].getWorldPosition(out);
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const m of this.owned) m.dispose();
    for (const g of this.ownedGeo) g.dispose();
    // each skinned mesh's skeleton owns a bone texture on the GPU
    this.root.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.dispose());
    this.root.removeFromParent();
  }
}

/** the shadow caster for a body: the same reshape, so the shadow matches the drawn body */
function bodyDepthMaterial(bodyMat: THREE.MeshPhysicalMaterial): THREE.MeshDepthMaterial {
  const u = bodyMat.userData.cloth as Record<string, THREE.IUniform>;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uJ0: u.uJ0, uJ1: u.uJ1, uJ2: u.uJ2, uK: u.uK, uShape: u.uShape });
    sh.vertexShader = patchBodyVertex(sh.vertexShader, false);
  };
  m.customProgramCacheKey = () => 'apex-person-depth-v2';
  return m;
}

function defaultEyeColor(look: Look, seed: number): number {
  // darker skins: brown eyes; fair: a mix of blue, grey, green, hazel, brown
  const dark = [0x3a2212, 0x2c1a0e, 0x4a2c16];
  const fair = [0x3d5f86, 0x5a7a92, 0x4f6b44, 0x5a4a2a, 0x4a2c16, 0x3a2212, 0x6a7a80];
  const list = look.tone > 0.45 ? dark : fair;
  return list[Math.floor(seed * list.length) % list.length];
}

// ------------------------------------------------------------------------------------ looks
const HAIR_COLORS = [0x1a120d, 0x2b1d14, 0x3d2a1b, 0x5a3e27, 0x7a5a38, 0xb08850, 0xc9a26a, 0x6e2f1c, 0x8a8a88];

/** a random fan's look: gender, skin, hair, clothes in a team's colours */
export function fanLook(rand: () => number, team: { primary: string; secondary: string; accent: string }): Look {
  const female = rand() < 0.42;
  const tone = Math.pow(rand(), 1.4);
  const kitColours = rand() < 0.62;
  const tops: TopKind[] = ['tshirt', 'tshirt', 'polo', 'hoodie', 'jacket', 'tshirt', 'longsleeve', female ? 'tank' : 'tshirt'];
  const top = tops[Math.floor(rand() * tops.length)];
  const neutral = [0xe8e6e1, 0x202226, 0x2b3a55, 0x6b6f76, 0x3f5a3a, 0x7a2b2b, 0x9aa3ad, 0x1c2c4a][Math.floor(rand() * 8)];
  const topColor = kitColours ? team.primary : neutral;
  const bottom: BottomKind = rand() < 0.5 ? 'jeans' : rand() < 0.55 ? 'shorts' : 'trousers';
  const hairOpts: HairId[] = female ? ['long', 'buns', 'long', 'buzzedfemale'] : ['buzzed', 'simpleparted', 'simpleparted', 'buzzed'];
  const hair = hairOpts[Math.floor(rand() * hairOpts.length)];
  const grey = rand() < 0.12;
  const hairColor = grey ? 0x9a9a98 : HAIR_COLORS[Math.floor(rand() * (tone > 0.6 ? 3 : HAIR_COLORS.length))];
  // bodies: most average, some slim, some heavier (older fans heavier more often)
  const wr = rand();
  const weight = (wr < 0.2 ? -0.4 - rand() * 0.5 : wr < 0.7 ? (rand() - 0.5) * 0.4 : 0.3 + rand() * 0.7) + (grey ? 0.2 : 0);
  return {
    female,
    tone,
    undertone: rand() * 2 - 1,
    hair,
    hairColor,
    beard: !female && rand() < 0.25,
    stubble: !female && rand() < 0.6 ? rand() * 0.7 : 0,
    top,
    topColor,
    top2: kitColours ? team.secondary : topColor,
    accent: kitColours ? team.accent : topColor,
    bottom,
    bottomColor: bottom === 'jeans' ? [0x2d3f63, 0x3a4f78, 0x1f2a40][Math.floor(rand() * 3)] : [0x2a2c30, 0x6b6150, 0x45484e, 0xc9bda3][Math.floor(rand() * 4)],
    shoeColor: [0xf0f0f0, 0x1c1c1e, 0x6b4a33, 0xf0f0f0][Math.floor(rand() * 4)],
    cap: rand() < 0.3 ? (kitColours ? team.primary : neutral) : null,
    capBack: rand() < 0.25,
    height: female ? 0.94 + rand() * 0.08 : 0.94 + rand() * 0.1,
    build: 0.98 + rand() * 0.05,
    weight: THREE.MathUtils.clamp(weight, -1, 1),
    muscle: rand() * 0.4,
    face: { width: 0.95 + rand() * 0.1, jaw: 0.94 + rand() * 0.12, length: 0.96 + rand() * 0.08 },
  };
}
