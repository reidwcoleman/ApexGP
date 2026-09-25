import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * People built on Quaternius's Universal Base Characters (CC0): a sculpted, rigged
 * male and female body (UE-mannequin skeleton, 65 bones), their eyes and brows,
 * five hairstyles and a beard, and the Universal Animation Library's clips (idle,
 * talking, walking, kneeling repairs, dancing, sitting …). See tools/build_people.py.
 *
 * The bodies come in underwear, so clothes are painted on in the shader from each
 * vertex's rest (T-pose) position and normal: race suits with side panels, collar,
 * belt and printed sponsors, T-shirts, polos, hoodies, overalls, trousers, shorts,
 * boots and gloves — the cloth pushed out a few millimetres and its muscle detail
 * flattened. Caps, headsets and hand-held props are rigid meshes skinned to one bone,
 * built in bind space, so they follow the animation (and work in the instanced crowd).
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'models/people/';

export type HairId = 'buzzed' | 'buzzedfemale' | 'simpleparted' | 'long' | 'buns' | 'none';
export type TopKind = 'none' | 'tshirt' | 'polo' | 'longsleeve' | 'tank' | 'hoodie' | 'jacket' | 'suit';
export type BottomKind = 'none' | 'trousers' | 'jeans' | 'shorts' | 'suit';

export const TOP_ID: Record<TopKind, number> = { none: 0, tshirt: 1, polo: 2, longsleeve: 3, tank: 4, hoodie: 5, jacket: 6, suit: 7 };
export const BOTTOM_ID: Record<BottomKind, number> = { none: 0, trousers: 1, jeans: 2, shorts: 3, suit: 4 };

export interface Look {
  female: boolean;
  /** skin: 0 fair … 1 dark (blends the two painted skin textures) */
  tone: number;
  hair: HairId;
  hairColor: THREE.ColorRepresentation;
  beard?: boolean;
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
    g.scene.updateMatrixWorld(true);
    const sk = bodyMesh.skeleton;
    const joint: Record<string, number> = {};
    const pos: Record<string, THREE.Vector3> = {};
    sk.bones.forEach((b, i) => {
      joint[b.name] = i;
      pos[b.name] = b.getWorldPosition(new THREE.Vector3());
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
    };
    return {
      template: g.scene,
      bodyName: bodyMesh.name,
      light, dark, normal, rough, lm,
      geometry: bodyMesh.geometry,
      eyes: eyes.geometry,
      brows: brows.geometry,
      boneInverses: sk.boneInverses.map((m) => m.clone()),
      bindMatrix: bodyMesh.bindMatrix.clone(),
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
  };
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
// landmarks: J0 = (shoulderX, elbowX, wristX, neckY), J1 = (chestY, waistY, kneeY, ankleY), J2 = (armY, headY, 0, 0)
// kinds: K = (top, bottom, gloves 0/1, boots 0/1)
float clTop = 0.0;   // set by clothAt: how much of the result is the top (for the sprite mask)
// returns coverage (0 skin … 1 cloth) and writes colour + roughness + how much to inflate
float clothAt( vec3 r, vec3 n, vec4 J0, vec4 J1, vec4 J2, vec4 K, vec3 cTop, vec3 cTop2, vec3 cAcc, vec3 cBot, vec3 cShoe, vec3 cGlove, out vec3 col, out float rough, out float puff, out vec2 logoUv ) {
  float ax = abs( r.x );
  float top = K.x, bot = K.y;
  float suit = step( 6.5, top );
  logoUv = vec2( -1.0 );
  clTop = 0.0;
  // the arms (T-pose: out along x at shoulder height)
  float arm = step( J0.x - 0.02, ax ) * step( J2.x - 0.2, r.y );
  float cover = 0.0;
  col = cTop; rough = 0.82; puff = 0.0;
  // ---- sleeves
  float sleeveEnd = top < 0.5 ? 0.0 : top < 2.5 ? mix( J0.x, J0.y, 0.42 ) : top < 3.5 ? J0.z - 0.012 : top < 4.5 ? J0.x - 0.05 : J0.z - 0.012;
  float onSleeve = arm * ( 1.0 - smoothstep( sleeveEnd - 0.004, sleeveEnd + 0.004, ax ) );
  // ---- torso: waist to neckline
  float neck = J0.w - 0.005;
  if ( top > 0.5 && top < 2.5 ) neck -= 0.035 * smoothstep( 0.02, 0.09, r.z ) * ( 1.0 - smoothstep( 0.03, 0.07, ax ) );   // crew / placket
  if ( top > 3.5 && top < 4.5 ) neck -= 0.08 * smoothstep( 0.02, 0.1, abs( r.z ) ) + 0.06 * smoothstep( 0.1, 0.16, ax );  // vest
  if ( top > 4.5 ) neck = J0.w + ( suit > 0.5 ? 0.055 : 0.015 );                                                                   // hoodie / jacket / suit collar
  float torso = ( 1.0 - arm ) * step( J1.y - 0.03, r.y ) * ( 1.0 - smoothstep( neck - 0.004, neck + 0.004, r.y ) );
  if ( top < 0.5 ) torso = 0.0;
  float onTop = max( onSleeve, torso );
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
    } else if ( top > 4.5 && top < 5.5 ) {
      // hoodie: ribbed cuffs and hem, a kangaroo pocket line
      c *= 1.0 - 0.12 * ( arm * step( J0.z - 0.05, ax ) + ( 1.0 - arm ) * step( r.y, J1.y + 0.04 ) );
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
    rough = top > 5.5 ? 0.62 : 0.86;
    puff = suit > 0.5 ? 0.004 : top > 4.5 ? 0.016 : 0.008;
  }
  if ( onBot > 0.0 && cover < 0.5 ) {
    clTop = 0.0;
    vec3 c = bot > 3.5 ? cTop : cBot;
    if ( bot > 3.5 ) c = mix( c, cTop2, smoothstep( 0.7, 0.85, abs( n.x ) ) );
    if ( bot > 1.5 && bot < 2.5 ) c *= 0.9 + 0.2 * clNoise( vec3( r.x * 900.0, r.y * 60.0, r.z * 900.0 ) );   // denim
    col = c;
    cover = onBot;
    rough = 0.88;
    puff = bot > 3.5 ? 0.004 : 0.009;
  }
  if ( onShoe > 0.0 ) {
    clTop = 0.0;
    col = mix( cShoe, vec3( 0.92 ), step( r.y, J1.w - 0.055 ) * ( 1.0 - K.w ) );   // trainers: white sole
    cover = 1.0;
    rough = 0.55;
    puff = 0.006;
  }
  if ( onGlove > 0.0 ) {
    clTop = 0.0;
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
    J2: new THREE.Vector4(lm.armY, lm.headY, 0, 0),
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
    sheen: 0.35,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0.35, 0.3, 0.3),
  });
  const u = {
    uDark: { value: asset.dark },
    uTone: { value: look.tone },
    uLogo: { value: look.logo ?? blankLogo() },
    uJ0: { value: p.J0 }, uJ1: { value: p.J1 }, uJ2: { value: p.J2 }, uK: { value: p.K },
    uTopC: { value: p.cTop }, uTop2C: { value: p.cTop2 }, uAccC: { value: p.cAcc }, uBotC: { value: p.cBot }, uShoeC: { value: p.cShoe }, uGloveC: { value: p.cGlove },
  };
  mat.userData.cloth = u;
  const maskMode = { value: 0 };
  mat.userData.maskMode = maskMode;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uMaskMode: maskMode });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec4 uJ0; uniform vec4 uJ1; uniform vec4 uJ2; uniform vec4 uK;
attribute vec3 aSmooth; attribute vec3 aSmoothN;
varying vec3 vRest; varying vec3 vRestN;
${CLOTH_GLSL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
vec3 restNormal = objectNormal;
float gCov; float gPuff;
{
  vec3 cc; float rr; vec2 lu;
  gCov = clothAt( position, normal, uJ0, uJ1, uJ2, uK, vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), cc, rr, gPuff, lu );
  // skin below the neck is a little less sculpted too
  float body = ( 1.0 - step( uJ0.w + 0.03, position.y ) ) * ( 1.0 - step( uJ0.z - 0.03, abs( position.x ) ) ) * step( uJ1.w + 0.04, position.y );
  float k = max( gCov, 0.4 * body );
  objectNormal = normalize( mix( objectNormal, aSmoothN, k ) );
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRestN = aSmoothN;
{
  float body = ( 1.0 - step( uJ0.w + 0.03, position.y ) ) * ( 1.0 - step( uJ0.z - 0.03, abs( position.x ) ) ) * step( uJ1.w + 0.04, position.y );
  float k = max( gCov, 0.4 * body );
  transformed = mix( position, aSmooth, k );
  vRest = transformed;
  transformed += aSmoothN * ( gPuff + 0.006 ) * gCov;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDark; uniform float uTone; uniform sampler2D uLogo; uniform float uMaskMode; float gTop;
uniform vec4 uJ0; uniform vec4 uJ1; uniform vec4 uJ2; uniform vec4 uK;
uniform vec3 uTopC; uniform vec3 uTop2C; uniform vec3 uAccC; uniform vec3 uBotC; uniform vec3 uShoeC; uniform vec3 uGloveC;
varying vec3 vRest; varying vec3 vRestN;
float gCloth; float gRough;
${CLOTH_GLSL}`)
      .replace('#include <map_fragment>', `
{
  vec4 a = texture2D( map, vMapUv );
  vec4 b = texture2D( uDark, vMapUv );
  diffuseColor *= mix( a, b, uTone );
  vec3 cc; float rr; float pf; vec2 lu;
  gCloth = clothAt( vRest, normalize( vRestN ), uJ0, uJ1, uJ2, uK, uTopC, uTop2C, uAccC, uBotC, uShoeC, uGloveC, cc, rr, pf, lu );
  gRough = rr;
  gTop = clTop * gCloth;
  if ( lu.x >= 0.0 ) { vec4 lg = texture2D( uLogo, lu ); cc = mix( cc, lg.rgb, lg.a ); }
  diffuseColor.rgb = mix( diffuseColor.rgb, cc, gCloth );
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor * 0.9, gRough, gCloth );`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * ( 1.0 - gCloth );'))
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.sheenColor *= gCloth;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if ( uMaskMode > 0.5 ) gl_FragColor = vec4( vec3( step( 0.5, gTop ) ), 1.0 );`);
  };
  mat.customProgramCacheKey = () => 'apex-person-v1';
  return mat;
}

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

/** a peaked cap on the head, in bind space: the skull's own surface above the brow line, pushed out, and a curved peak */
export function capGeometry(asset: BodyAsset, back = false): THREE.BufferGeometry {
  const lm = asset.lm;
  const geo = asset.geometry;
  const pa = geo.getAttribute('position') as THREE.BufferAttribute;
  const na = geo.getAttribute('normal') as THREE.BufferAttribute;
  const idx = geo.index!.array;
  const c = lm.skull, r = lm.skullR, top = lm.headTop;
  // the band: just above the brows at the front, over the ears, low on the back of the head
  const band = (z: number) => top - 0.088 + 0.03 * THREE.MathUtils.clamp((z - c.z) / r.z, -1, 1) * (back ? -1 : 1);
  const inCap = (i: number) => pa.getY(i) > band(pa.getZ(i)) && pa.getY(i) > lm.neckY + 0.1;
  const pos: number[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const a0 = idx[t], a1 = idx[t + 1], a2 = idx[t + 2];
    if (!inCap(a0) || !inCap(a1) || !inCap(a2)) continue;
    for (const i of [a0, a1, a2]) {
      v.fromBufferAttribute(pa, i);
      n.fromBufferAttribute(na, i);
      // clear the hair: thicker on the crown than at the band
      const lift = 0.016 + 0.012 * THREE.MathUtils.smoothstep(v.y, band(v.z), top);
      v.addScaledVector(n, lift);
      pos.push(v.x, v.y, v.z);
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const crownW = mergeVerticesSimple(crown);
  crownW.computeVertexNormals();
  // the peak: find the forehead at the band
  let zf = -Infinity;
  const yf = band(c.z + r.z) + 0.004;
  for (let i = 0; i < pa.count; i++) if (Math.abs(pa.getX(i)) < 0.03 && Math.abs(pa.getY(i) - yf) < 0.012) zf = Math.max(zf, pa.getZ(i));
  const brimS = new THREE.Shape();
  brimS.absellipse(0, 0, r.x * 0.95, 0.075, 0, Math.PI, false, 0);
  const brim = new THREE.ExtrudeGeometry(brimS, { depth: 0.005, bevelEnabled: false, curveSegments: 20 });
  brim.rotateX(Math.PI / 2);
  const bp = brim.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    bp.setY(i, bp.getY(i) - (x / (r.x * 0.95)) ** 2 * 0.022 - bp.getZ(i) * 0.1);
  }
  brim.computeVertexNormals();
  brim.translate(c.x, yf + 0.004, zf - 0.01);
  if (back) {
    brim.translate(-c.x, 0, -c.z);
    brim.rotateY(Math.PI);
    brim.translate(c.x, band(c.z - r.z) - yf, c.z);
  }
  return mergeSimple([crownW, brim]);
}

function mergeVerticesSimple(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = g.getAttribute('position');
  const map = new Map<string, number>();
  const out: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < pa.count; i++) {
    const k = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = out.length / 3;
      map.set(k, j);
      out.push(pa.getX(i), pa.getY(i), pa.getZ(i));
    }
    index.push(j);
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  r.setIndex(index);
  return r;
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

// ------------------------------------------------------------------------------------ a person
export class Person {
  readonly root: THREE.Group;
  readonly body: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  readonly bones: Record<string, THREE.Bone> = {};
  readonly mixer: THREE.AnimationMixer;
  readonly asset: BodyAsset;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private readonly owned: THREE.Material[] = [];
  private readonly ownedGeo: THREE.BufferGeometry[] = [];

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
    const hairCol = new THREE.Color(look.hairColor);
    const hairMat = (k: 0 | 1) => {
      const m = new THREE.MeshStandardMaterial({ map: kit.hairMap[k], normalMap: kit.hairNormal[k], color: hairCol.clone().multiplyScalar(2.2), roughness: 0.72, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.35 });
      this.owned.push(m);
      return m;
    };
    for (const o of others) {
      const isEyes = (o.material as THREE.Material).name.includes('Eye');
      if (isEyes) o.material = new THREE.MeshPhysicalMaterial({ map: kit.eyeMap, normalMap: kit.eyeNormal, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
      else o.material = hairMat(0);
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
    if (hair !== 'none') attach(kit.hair[hair], hairMat(hair === 'long' || hair === 'buns' ? 1 : 0));
    if (look.beard && !look.female) attach(kit.hair.beard, hairMat(0));
    const head = asset.lm.joint.Head;
    if (look.cap) {
      const g = rigid(capGeometry(asset, look.capBack), head);
      this.ownedGeo.push(g);
      const m = new THREE.MeshStandardMaterial({ color: look.cap, roughness: 0.8 });
      this.owned.push(m);
      attach(g, m);
    }
    if (look.headset) {
      const g = rigid(headsetGeometry(asset.lm), head);
      this.ownedGeo.push(g);
      const m = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.45, metalness: 0.3 });
      this.owned.push(m);
      attach(g, m);
    }
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false;
    if (look.face) {
      const fu = faceUniforms(asset.lm, look);
      this.body.parent!.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh) patchFace(m.material as THREE.Material, fu);
      });
    }
    this.mixer = new THREE.AnimationMixer(clone);
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
  }

  update(dt: number) {
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
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
    this.root.removeFromParent();
  }
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
  const hairColor = rand() < 0.12 ? 0x9a9a98 : HAIR_COLORS[Math.floor(rand() * (tone > 0.6 ? 3 : HAIR_COLORS.length))];
  return {
    female,
    tone,
    hair,
    hairColor,
    beard: !female && rand() < 0.3,
    top,
    topColor,
    top2: kitColours ? team.secondary : topColor,
    accent: kitColours ? team.accent : topColor,
    bottom,
    bottomColor: bottom === 'jeans' ? [0x2d3f63, 0x3a4f78, 0x1f2a40][Math.floor(rand() * 3)] : [0x2a2c30, 0x6b6150, 0x45484e, 0xc9bda3][Math.floor(rand() * 4)],
    shoeColor: [0xf0f0f0, 0x1c1c1e, 0x6b4a33, 0xf0f0f0][Math.floor(rand() * 4)],
    cap: rand() < 0.3 ? (kitColours ? team.primary : neutral) : null,
    capBack: rand() < 0.25,
    height: female ? 0.95 + rand() * 0.06 : 0.96 + rand() * 0.07,
    build: 0.97 + rand() * 0.1,
  };
}
