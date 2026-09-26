import * as THREE from 'three';
import { Person, fanLook, fanPool, capGeometry, capMaterial, mergeSimple, ROSTER, RB_SURFACE_GLSL, type BodyAsset, type Look, type PeopleKit } from './Humans.ts';
import { LIGHT_GLOBALS, peopleLightsChunk, CLOTH_WHITE_MAX } from './shading.ts';
import { ACT, ACT_CLIP, ACT_COUNT, actPose, aimArm, turnHead } from './poses.ts';
import { TEAMS } from '../race/Teams.ts';

/**
 * Hundreds of fans on the Rocketbox avatars: every act (cheering, clapping, waving, a flag,
 * filming, fist pumps, jumping, dancing, chatting, standing) is baked once per avatar from
 * the library's own clips into one bone-matrix texture (half floats; the fingers folded
 * into the hands, the eyes into the head: 23 bones, plus the right hand's and the head's
 * world frames for the props). One instanced mesh per avatar and level of detail skins
 * itself on the GPU from that texture, each fan with their own act, phase and shirt dye;
 * caps, flags and phones are shared meshes carried in those two frames.
 */

export { ACT } from './poses.ts';

export interface FanSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** team index (TEAMS) whose colours they wear */
  team: number;
  act?: number;
  excite?: number;
}

/** the crowd's bones: the Biped without fingers, eyes and lids */
const CROWD_SKIP = /Finger|Eye/;
/** extra columns: the right hand's and the head's world frames (props ride on them) */
const PROP_HAND = 0, PROP_HEAD = 1;

interface AvatarBake {
  name: string;
  asset: BodyAsset;
  /** per act: first row, frames, loop seconds */
  acts: [number, number, number][];
  body: THREE.BufferGeometry;
  bodyFar: THREE.BufferGeometry;
  hair: THREE.BufferGeometry | null;
  hairFar: THREE.BufferGeometry | null;
  /** the head frame's offset to this avatar's skull (cap fit) relative to the reference */
  capFit: THREE.Vector4;
}

interface Baked {
  tex: THREE.DataTexture;
  /** crowd bone columns (skin bones + 2 prop frames) */
  cols: number;
  avatars: Map<string, AvatarBake>;
  /** the shared props, in the frame of the bone that carries them */
  cap: THREE.BufferGeometry;
  capBack: THREE.BufferGeometry;
  flag: THREE.BufferGeometry;
  phone: THREE.BufferGeometry;
}

const bakes = new WeakMap<PeopleKit, Baked>();

/** the crowd bone each of the 57 Biped bones folds into */
function crowdBones(names: string[]): { map: Int16Array; src: number[] } {
  const src: number[] = [];
  const map = new Int16Array(names.length);
  names.forEach((n, i) => {
    if (!CROWD_SKIP.test(n)) {
      map[i] = src.length;
      src.push(i);
    }
  });
  names.forEach((n, i) => {
    if (!CROWD_SKIP.test(n)) return;
    const to = /Eye/.test(n) ? 'Bip01_Head' : n.startsWith('Bip01_L') ? 'Bip01_L_Hand' : 'Bip01_R_Hand';
    map[i] = map[names.indexOf(to)];
  });
  return { map, src };
}

/** a geometry with its skin indices folded onto the crowd bones */
function foldSkin(g: THREE.BufferGeometry, map: Int16Array): THREE.BufferGeometry {
  const out = g.clone();
  const si = out.getAttribute('skinIndex') as THREE.BufferAttribute;
  const sw = out.getAttribute('skinWeight') as THREE.BufferAttribute;
  for (let i = 0; i < si.count; i++) {
    // merge weights that now land on the same bone
    const acc = new Map<number, number>();
    for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c);
      if (w <= 0) continue;
      const b = map[si.getComponent(i, c)];
      acc.set(b, (acc.get(b) ?? 0) + w);
    }
    let c = 0;
    for (const [b, w] of acc) {
      si.setComponent(i, c, b);
      sw.setComponent(i, c, w);
      c++;
    }
    for (; c < 4; c++) {
      si.setComponent(i, c, 0);
      sw.setComponent(i, c, 0);
    }
  }
  return out;
}

const earlyBakes = new WeakMap<PeopleKit, { n: number; b: Baked }>();
function bake(kit: PeopleKit): Baked {
  const hit = bakes.get(kit);
  if (hit) return hit;
  const early = earlyBakes.get(kit);
  if (early && early.n === kit.avatars.size) return early.b;
  // (eight bodies at most: every one is four draws)
  const names = [...new Set([...fanPool(kit, false).slice(0, 5), ...fanPool(kit, true).slice(0, 3)])];
  const ref = kit.asset(names[0]);
  const { map, src } = crowdBones(ref.body.names);
  const cols = src.length + 2;
  const rows: Float32Array[] = [];
  const avatars = new Map<string, AvatarBake>();
  const m4 = new THREE.Matrix4();
  const refSkull = ref.lm.skull.clone().applyMatrix4(ref.body.boneInverses[ref.lm.joint.Head]);
  for (const name of names) {
    const look: Look = { female: kit.avatars.get(name)!.meta.female, tone: 0, body: name, head: name, hair: 'none', hairColor: 0, top: 'tshirt', topColor: 0xffffff, bottom: 'jeans', bottomColor: 0 };
    const p = new Person(kit, look);
    const asset = p.asset;
    const acts: [number, number, number][] = [];
    const hand = asset.lm.joint.hand_r, head = asset.lm.joint.Head;
    for (let a = 0; a < ACT_COUNT; a++) {
      const clip = p.clip(ACT_CLIP[a]) ?? p.clip('idle')!;
      // long clips: a five-second window, its end cross-faded into its start
      const L = clip.duration > 5.6 ? 5 : clip.duration;
      const F = clip.duration > 5.6 ? 0.6 : 0;
      const frames = Math.max(20, Math.min(60, Math.round(L * 12)));
      acts.push([rows.length, frames, L]);
      p.mixer.stopAllAction();
      p.mixer.uncacheRoot(p.mixer.getRoot());
      const A = p.mixer.clipAction(clip);
      const B = F > 0 ? p.mixer.clipAction(clip.clone()) : null;
      A.play();
      B?.play();
      for (let f = 0; f < frames; f++) {
        const t = (f / frames) * L;
        const k = F > 0 && t < F ? t / F : 1;
        const s = k * k * (3 - 2 * k);
        A.time = t;
        A.weight = s;
        if (B) {
          B.time = L + t;
          B.weight = 1 - s;
        }
        p.mixer.update(0);
        p.settle(t, 1, ACT_CLIP[a]);
        p.root.updateMatrixWorld(true);
        actPose(p, a, f / frames);
        p.root.updateMatrixWorld(true);
        const row = new Float32Array(cols * 16);
        src.forEach((bi, j) => {
          m4.multiplyMatrices(p.skeleton.bones[bi].matrixWorld, asset.boneInverses[bi]);
          row.set(m4.elements, j * 16);
        });
        row.set(p.skeleton.bones[hand].matrixWorld.elements, (src.length + PROP_HAND) * 16);
        row.set(p.skeleton.bones[head].matrixWorld.elements, (src.length + PROP_HEAD) * 16);
        rows.push(row);
      }
    }
    p.dispose();
    const lm = asset.lm;
    const fine = (x: number, y: number) => (y > lm.neckY + 0.03 ? 0.4 : Math.abs(x) > lm.wristX - 0.02 && y < lm.armY - 0.2 ? 0.7 : 1);
    const fold = foldSkin(asset.geometry, map);
    const body = decimate(fold, 0.042, fine);
    const bodyFar = decimate(fold, 0.1, (x, y) => (y > lm.neckY + 0.03 ? 0.45 : 1));
    fold.dispose();
    let hair: THREE.BufferGeometry | null = null, hairFar: THREE.BufferGeometry | null = null;
    if (asset.hair && asset.head.hairMap) {
      hair = foldSkin(asset.hair, map);
      // far away short hair is the painted scalp; long hair keeps its big shapes
      if (asset.female) {
        hairFar = decimate(hair, 0.035);
        if (hairFar.index!.count < 30) hairFar = null;
      }
    }
    // the cap (made for the reference skull) scaled about it onto this one: p' = p·s + (skull − refSkull·s)
    const skull = lm.skull.clone().applyMatrix4(asset.boneInverses[head]);
    const sc = lm.skullR.x / ref.lm.skullR.x;
    avatars.set(name, { name, asset, acts, body, bodyFar, hair, hairFar, capFit: new THREE.Vector4(skull.x - refSkull.x * sc, skull.y - refSkull.y * sc, skull.z - refSkull.z * sc, sc) });
  }
  // one texture, half floats: row = frame, 4 texels per column
  const W = cols * 4, H = rows.length;
  const data = new Uint16Array(W * H * 4);
  rows.forEach((r, y) => {
    for (let i = 0; i < r.length; i++) data[y * W * 4 + i] = THREE.DataUtils.toHalfFloat(r[i]);
  });
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.needsUpdate = true;
  // the props in the frames that carry them (the reference avatar's bind pose)
  const headInv = ref.body.boneInverses[ref.lm.joint.Head];
  const handInv = ref.body.boneInverses[ref.lm.joint.hand_r];
  const cap = capGeometry(ref, false, true).applyMatrix4(headInv);
  const capBack = capGeometry(ref, true, true).applyMatrix4(headInv);
  const hp = ref.lm.pos.hand_r;
  const flag = flagGeometry(hp).applyMatrix4(handInv);
  const ph = new THREE.BoxGeometry(0.075, 0.15, 0.009);
  ph.translate(hp.x - 0.06, hp.y - 0.04, hp.z + 0.05);
  const phone = mergeSimple([ph]).applyMatrix4(handInv);
  const out: Baked = { tex, cols, avatars, cap, capBack, flag, phone };
  // (only once every fan has loaded: before that the bake is of the stand-ins)
  if (kit.complete) bakes.set(kit, out);
  else earlyBakes.set(kit, { n: kit.avatars.size, b: out });
  return out;
}

/** vertex clustering (seams kept apart by UV) for the crowd's levels of detail */
export function decimate(src: THREE.BufferGeometry, cell: number, fine?: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const pa = src.getAttribute('position') as THREE.BufferAttribute;
  const idx = src.index!.array;
  const n = pa.count;
  // UV islands (connected through shared vertices): clusters never merge across a seam
  const par = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]);
    par[find(idx[t + 1])] = a;
    par[find(idx[t + 2])] = a;
  }
  const rep = new Int32Array(n);
  const map = new Map<string, number>();
  const cellOf = new Map<string, number>();
  const keep: number[] = [];
  const posFrom: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = fine ? cell * fine(pa.getX(i), pa.getY(i), pa.getZ(i)) : cell;
    const ck = `${Math.floor(pa.getX(i) / c)},${Math.floor(pa.getY(i) / c)},${Math.floor(pa.getZ(i) / c)},${c}`;
    let cp = cellOf.get(ck);
    if (cp === undefined) cellOf.set(ck, (cp = i));
    // UV seams keep separate vertices (the atlas halves and islands), but share the cell's position
    const k = `${ck},${find(i)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = keep.length;
      map.set(k, j);
      keep.push(i);
      posFrom.push(cp);
    }
    rep[i] = j;
  }
  const tris: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = rep[idx[t]], b = rep[idx[t + 1]], c = rep[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const at = src.getAttribute(name) as THREE.BufferAttribute;
    const sz = at.itemSize;
    const Arr = at.array.constructor as new (n: number) => Float32Array;
    const arr = new Arr(keep.length * sz);
    const spatial = name === 'position' || name === 'normal';
    keep.forEach((i, j) => {
      const from = spatial ? posFrom[j] : i;
      for (let c = 0; c < sz; c++) arr[j * sz + c] = at.array[from * sz + c];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, sz, at.normalized));
  }
  out.setIndex(tris);
  return out;
}

// ------------------------------------------------------------------------------------ shaders
const SKIN_PARS = /* glsl */ `
uniform highp sampler2D uBones;
uniform float uTime; uniform float uCalm; uniform vec3 uIdle;
attribute vec4 aAnim; // first row, frames, loop seconds, phase
mat4 crowdBone( float b, float row ) {
  int x = int( b ) * 4; int y = int( row );
  return mat4( texelFetch( uBones, ivec2( x, y ), 0 ), texelFetch( uBones, ivec2( x + 1, y ), 0 ), texelFetch( uBones, ivec2( x + 2, y ), 0 ), texelFetch( uBones, ivec2( x + 3, y ), 0 ) );
}
mat4 crowdPose( vec4 bw, vec4 bi, vec3 A, float ph ) {
  float f = fract( uTime / A.z + ph ) * A.y;
  float f0 = floor( f ); float k = f - f0; float f1 = mod( f0 + 1.0, A.y );
  mat4 m = mat4( 0.0 );
  for ( int i = 0; i < 4; i ++ ) {
    float w = bw[ i ];
    if ( w <= 0.0 ) continue;
    m += w * ( crowdBone( bi[ i ], A.x + f0 ) * ( 1.0 - k ) + crowdBone( bi[ i ], A.x + f1 ) * k );
  }
  return m;
}
mat4 crowdMatrix( vec4 bw, vec4 bi ) {
  mat4 S = crowdPose( bw, bi, aAnim.xyz, aAnim.w );
  if ( uCalm > 0.001 ) S = S * ( 1.0 - uCalm ) + crowdPose( bw, bi, uIdle, aAnim.w ) * uCalm;
  return S;
}
`;

type CrowdKind = 'body' | 'hair' | 'prop';

/**
 * kind 'body': the avatar's skin with its shirt dyed per instance (aTint: colour, amount);
 * 'hair': alpha-tested cards; 'prop': a rigid mesh in the frame of prop column `col`
 * (per-instance aFit: offset in that frame + scale).
 */
function crowdMaterial(baked: Baked, idle: [number, number, number], shared: { uTime: THREE.IUniform; uCalm: THREE.IUniform }, kind: CrowdKind, base: THREE.MeshStandardMaterialParameters, extra: { asset?: BodyAsset; col?: number } = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(base);
  const a = extra.asset;
  const u: Record<string, THREE.IUniform> = {
    uBones: { value: baked.tex },
    uTime: shared.uTime,
    uCalm: shared.uCalm,
    uIdle: { value: new THREE.Vector3(idle[0], idle[1], idle[2]) },
  };
  if (a) {
    const sm = a.body.meta.shirt;
    Object.assign(u, {
      uMask: { value: a.body.mask },
      uShirtMean: { value: new THREE.Color(sm[0], sm[1], sm[2]) },
      uSkinRef: { value: a.skinRef },
      uWaist: { value: a.lm.waistY },
    });
  }
  const propCol = (baked.cols - 2 + (extra.col ?? 0)).toFixed(1);
  const patch = (sh: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, depth: boolean) => {
    Object.assign(sh.uniforms, u);
    let vs = sh.vertexShader.replace('#include <common>', `#include <common>
${kind === 'prop' ? 'attribute vec4 aFit;' : 'attribute vec4 skinIndex; attribute vec4 skinWeight;'}
${SKIN_PARS}
${kind === 'body' ? `attribute float aPart; attribute vec4 aTint;
varying vec3 vRest; varying float vPart; varying vec4 vTint;` : ''}`);
    const M = kind === 'prop' ? `crowdMatrix( vec4( 1.0, 0.0, 0.0, 0.0 ), vec4( ${propCol}, 0.0, 0.0, 0.0 ) )` : 'crowdMatrix( skinWeight, skinIndex )';
    const P = kind === 'prop' ? 'position * aFit.w + aFit.xyz' : 'position';
    if (!depth) {
      vs = vs.replace('#include <beginnormal_vertex>', `mat4 crowdM = ${M};
vec3 objectNormal = normalize( mat3( crowdM ) * normal );
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`);
    }
    vs = vs.replace('#include <begin_vertex>', `${depth ? `mat4 crowdM = ${M};` : ''}
vec3 transformed = ( crowdM * vec4( ${P}, 1.0 ) ).xyz;
${kind === 'body' ? 'vRest = position; vPart = aPart; vTint = aTint;' : ''}
#ifdef USE_ALPHAHASH
vPosition = vec3( position );
#endif`);
    sh.vertexShader = vs;
    if (depth) return;
    let fs = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', peopleLightsChunk()).replace('#include <common>', `#include <common>
${LIGHT_GLOBALS}`);
    if (kind === 'body') {
      fs = fs
        .replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform vec3 uShirtMean; uniform vec3 uSkinRef; uniform float uWaist;
varying vec3 vRest; varying float vPart; varying vec4 vTint;
float gRough; vec2 gN;
${RB_SURFACE_GLSL}`)
        .replace('#include <map_fragment>', `
{
  vec4 a = texture2D( map, vMapUv );
  vec4 ns = texture2D( normalMap, vMapUv );
  gN = ns.xy;
  gRough = mix( 0.88, 0.5, ns.b );
  float cloth = vMapUv.x < 0.5 ? texture2D( uMask, vMapUv ).r : 0.0;
  float part = floor( vPart + 0.5 );
  float shirt = cloth * step( 0.5, part ) * step( part, 4.5 ) * step( uWaist - 0.08, vRest.y );
  float rel = clamp( ( dot( a.rgb, RB_LUM ) + 0.01 ) / ( dot( uShirtMean, RB_LUM ) + 0.01 ), 0.35, 1.6 );
  vec3 dyed = min( vTint.rgb * mix( 1.0, rel, 0.55 ), vec3( ${CLOTH_WHITE_MAX.toFixed(2)} ) );
  diffuseColor.rgb *= mix( a.rgb, dyed, shirt * vTint.a );
  gSkin = ( 1.0 - cloth ) * clamp( rbSkinLike( a.rgb, uSkinRef ), 0.0, 1.0 );
}`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec3 mapN = vec3( gN * 2.0 - 1.0, 0.0 );
mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );`));
    }
    sh.fragmentShader = fs;
  };
  mat.onBeforeCompile = (sh) => patch(sh, false);
  mat.customProgramCacheKey = () => `apex-rb-crowd-${kind}-${propCol}-v1`;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: kind === 'hair' ? base.map ?? null : null, alphaTest: kind === 'hair' ? 0.5 : 0 });
  depthMat.onBeforeCompile = (sh) => patch(sh, true);
  depthMat.customProgramCacheKey = () => `apex-rb-crowd-depth-${kind}-${propCol}-v1`;
  mat.userData.depth = depthMat;
  return mat;
}

// ------------------------------------------------------------------------------------ the crowd
interface Member {
  spot: FanSpot;
  look: Look;
  act: number;
  phase: number;
}

export class FanCrowd {
  readonly group = new THREE.Group();
  private readonly shared = { uTime: { value: 0 }, uCalm: { value: 0 } };
  private readonly owned: { dispose(): void }[] = [];

  /**
   * lodDistance: fans further than this from the group's origin (metres, in x/z) get the
   * far level of detail (the podium's crowd: close-ups are at the podium, the back rows
   * are only ever seen small)
   */
  constructor(kit: PeopleKit, spots: FanSpot[], opts: { shadows?: boolean; seed?: number; lodDistance?: number } = {}) {
    this.group.name = 'fan-crowd';
    let seed = opts.seed ?? 1234;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const baked = bake(kit);
    const names = [...baked.avatars.keys()];
    const members: Member[] = spots.map((s) => {
      const t = TEAMS[s.team % TEAMS.length];
      const look = fanLook(rand, t);
      // spread evenly over the avatars (the look picked one of its gender; any will do)
      const pool = names.filter((n) => baked.avatars.get(n)!.asset.female === look.female);
      look.body = pool[Math.floor(rand() * pool.length)] ?? names[0];
      const r = rand();
      const act = s.act ?? (r < 0.2 ? ACT.CHEER : r < 0.36 ? ACT.CLAP : r < 0.46 ? ACT.WAVE : r < 0.56 ? ACT.PHONE : r < 0.66 ? ACT.FIST : r < 0.74 ? ACT.JUMP : r < 0.8 ? ACT.DANCE : r < 0.9 ? ACT.TALK : ACT.CHEER);
      return { spot: s, look, act, phase: rand() };
    });
    const lodD = opts.lodDistance ?? 12;
    const isFar = (m: Member) => Math.hypot(m.spot.x, m.spot.z) > lodD;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const bakeOf = (m: Member) => baked.avatars.get(m.look.body!)!;
    const inst = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, who: Member[], per?: (g: THREE.BufferGeometry, who: Member[]) => void, color?: (m: Member) => THREE.ColorRepresentation) => {
      if (!who.length) return;
      const g = geo.clone();
      const anim = new Float32Array(who.length * 4);
      who.forEach((m, i) => {
        const a = bakeOf(m).acts[m.act];
        anim.set([a[0], a[1], a[2] / (0.85 + (m.spot.excite ?? 0.8) * 0.3), m.phase], i * 4);
      });
      g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4));
      per?.(g, who);
      const mesh = new THREE.InstancedMesh(g, mat, who.length);
      who.forEach((m, i) => {
        const h = m.look.height ?? 1, b = m.look.build ?? 1;
        q.setFromAxisAngle(up, m.spot.yaw);
        m4.compose(new THREE.Vector3(m.spot.x, m.spot.y, m.spot.z), q, new THREE.Vector3(b * h, h, b * h));
        mesh.setMatrixAt(i, m4);
        if (color) mesh.setColorAt(i, new THREE.Color(color(m)));
      });
      mesh.customDepthMaterial = mat.userData.depth;
      mesh.castShadow = !!opts.shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.owned.push(g, mat, mat.userData.depth);
    };
    const idleOf = (b: AvatarBake) => b.acts[ACT.IDLE];
    for (const name of names) {
      const B = baked.avatars.get(name)!;
      const list = members.filter((m) => m.look.body === name);
      if (!list.length) continue;
      const tint = (g: THREE.BufferGeometry, who: Member[]) => {
        const arr = new Float32Array(who.length * 4);
        const c = new THREE.Color();
        who.forEach((m, i) => {
          c.set(m.look.topColor);
          arr.set([c.r, c.g, c.b, m.look.tint ?? 0], i * 4);
        });
        g.setAttribute('aTint', new THREE.InstancedBufferAttribute(arr, 4));
      };
      const bodyMat = () => crowdMaterial(baked, idleOf(B), this.shared, 'body', { map: B.asset.body.map, normalMap: B.asset.body.normal, roughness: 1, metalness: 0 }, { asset: B.asset });
      inst(B.body, bodyMat(), list.filter((m) => !isFar(m)), tint);
      inst(B.bodyFar, bodyMat(), list.filter(isFar), tint);
      if (B.hair) {
        const hairMat = () => crowdMaterial(baked, idleOf(B), this.shared, 'hair', { map: B.asset.head.hairMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
        inst(B.hair, hairMat(), list.filter((m) => !isFar(m)));
        if (B.hairFar) inst(B.hairFar, hairMat(), list.filter(isFar));
      }
    }
    // props, shared by every avatar: carried in the head / right-hand frame
    const idle = baked.avatars.get(names[0])!.acts[ACT.IDLE];
    const fit = (g: THREE.BufferGeometry, who: Member[], head: boolean) => {
      const arr = new Float32Array(who.length * 4);
      who.forEach((m, i) => arr.set(head ? bakeOf(m).capFit.toArray() : [0, 0, 0, 1], i * 4));
      g.setAttribute('aFit', new THREE.InstancedBufferAttribute(arr, 4));
    };
    const caps = members.filter((m) => m.look.cap);
    for (const back of [false, true]) {
      const who = caps.filter((m) => !!m.look.capBack === back);
      if (!who.length) continue;
      const cm = capMaterial(kit, 0xffffff);
      inst(back ? baked.capBack : baked.cap, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.82, map: cm.map, vertexColors: true }, { col: PROP_HEAD }), who, (g, w) => fit(g, w, true), (m) => new THREE.Color(m.look.cap!).multiplyScalar(0.92));
      cm.dispose();
    }
    const flags = members.filter((m) => m.act === ACT.FLAG);
    inst(baked.flag, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.85, side: THREE.DoubleSide, vertexColors: true }, { col: PROP_HAND }), flags, (g, w) => fit(g, w, false), (m) => TEAMS[m.spot.team % TEAMS.length].primary);
    const phones = members.filter((m) => m.act === ACT.PHONE);
    inst(baked.phone, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.3, metalness: 0.4 }, { col: PROP_HAND }), phones, (g, w) => fit(g, w, false), () => 0x1a1b1e);
  }

  update(t: number, calm = 0) {
    this.shared.uTime.value = t;
    this.shared.uCalm.value = calm;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }
}

/** a hand-held flag on a pole, in bind space at the right hand (the pole along the fist, up when the arm is raised) */
function flagGeometry(hand: THREE.Vector3): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.008, 0.008, 1.1, 6);
  pole.translate(hand.x - 0.02, hand.y - 0.05 + 0.45, hand.z + 0.02);
  const cloth = new THREE.PlaneGeometry(0.62, 0.42, 8, 4);
  cloth.rotateY(Math.PI / 2);
  cloth.translate(hand.x - 0.02, hand.y + 0.72, hand.z + 0.02 - 0.32);
  const g = mergeSimple([pole, cloth]);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const poleN = pole.index ? pole.index.count : pole.getAttribute('position').count;
  const pa = g.getAttribute('position');
  for (let i = 0; i < n; i++) {
    if (i < poleN) col.set([0.75, 0.75, 0.75], i * 3);
    else {
      const band = Math.abs(pa.getY(i) - (hand.y + 0.72)) < 0.05 ? 1 : 0;
      col.set(band ? [3, 3, 3] : [1, 1, 1], i * 3);
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------------------------ sprite atlas
export const ATLAS_COLS = 10;

/**
 * The grandstand crowd's atlas: ten fans rendered from the Rocketbox people, sitting
 * (row 0: hands in the lap, clapping, filming) and sitting up cheering (row 1). Shirts
 * come out near-white (≥ 236) so the grandstand shader can dye them per person; nothing
 * else is that bright.
 */
export function renderFanAtlas(kit: PeopleKit, cw = 128, ch = 256): HTMLCanvasElement {
  const memo = `${cw}x${ch}`;
  const known = fanAtlasMemo.get(kit)?.get(memo);
  if (known) return known;
  const made = renderFanAtlasNow(kit, cw, ch);
  if (made.width > 0 && kit.complete) {
    if (!fanAtlasMemo.has(kit)) fanAtlasMemo.set(kit, new Map());
    fanAtlasMemo.get(kit)!.set(memo, made);
  }
  return made;
}
const fanAtlasMemo = new WeakMap<PeopleKit, Map<string, HTMLCanvasElement>>();

/** the arms for an atlas pose (sitting) */
function seatedArms(p: Person, act: number, u: number) {
  const TAU = Math.PI * 2;
  switch (act) {
    case ACT.CHEER: {
      const b = Math.sin(u * TAU * 3) * 0.5 + 0.5;
      aimArm(p, 'l', [0.45, 0.86, 0.18], [0.25 + 0.1 * b, 0.95, 0.12]);
      aimArm(p, 'r', [0.45, 0.86, 0.18], [0.25 + 0.1 * b, 0.95, 0.12]);
      turnHead(p, 0, -0.18);
      break;
    }
    case ACT.CLAP: {
      const c = Math.pow(Math.abs(Math.sin(u * TAU * 5)), 0.6);
      aimArm(p, 'l', [0.28, -0.45, 0.85], [-0.55 + 0.35 * c, 0.42, 0.72]);
      aimArm(p, 'r', [0.28, -0.45, 0.85], [-0.55 + 0.35 * c, 0.42, 0.72]);
      break;
    }
    case ACT.PHONE:
      aimArm(p, 'r', [0.05, 0.3, 0.95], [-0.1, 0.72, 0.68]);
      turnHead(p, -0.08, 0.08);
      break;
    case ACT.FIST:
      aimArm(p, 'r', [0.35, 0.9, 0.35], [0.1, 0.96, 0.2]);
      turnHead(p, 0, -0.12);
      break;
  }
}

function renderFanAtlasNow(kit: PeopleKit, cw: number, ch: number): HTMLCanvasElement {
  const COLS = ATLAS_COLS, ROWS = 2;
  const canvas = document.createElement('canvas');
  canvas.width = cw * COLS;
  canvas.height = ch * ROWS;
  const out = canvas.getContext('2d')!;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return canvas;
  }
  const RW = cw * 2, RH = ch * 2;
  renderer.setPixelRatio(1);
  renderer.setSize(RW, RH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.6, 1.4, 2);
  scene.add(key);
  const cam = new THREE.OrthographicCamera(-0.31, 0.31, 1.24, 0, 0.1, 20);
  cam.position.set(0, 0.62, 6);
  const grab = () => {
    const c = document.createElement('canvas');
    c.width = RW;
    c.height = RH;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(renderer!.domElement, 0, 0);
    return g.getImageData(0, 0, RW, RH);
  };
  let seed = 97;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const fans = [...new Set([...fanPool(kit, false), ...fanPool(kit, true)])];
  for (let col = 0; col < COLS; col++) {
    const base = fanLook(rand, TEAMS[col % TEAMS.length]);
    base.body = fans[col % fans.length];
    base.female = kit.avatars.get(base.body)!.meta.female;
    for (let row = 0; row < ROWS; row++) {
      // shirts dyed white for the grandstand's own dye, everything else as it is
      const look: Look = { ...base, topColor: 0xffffff, tint: 1, cap: base.cap ? 0xffffff : null };
      const p = new Person(kit, look);
      p.lively = false;
      p.play('sit');
      p.mixer.setTime(0.4 + col * 0.37);
      p.root.updateMatrixWorld(true);
      const act = row === 0 ? (col % 3 === 0 ? ACT.CLAP : col % 3 === 1 ? ACT.PHONE : -1) : col % 2 ? ACT.CHEER : ACT.FIST;
      if (act >= 0) seatedArms(p, act, 0.13 + col * 0.07);
      p.root.rotation.y = -0.12 + (col % 3) * 0.12;
      p.root.updateMatrixWorld(true);
      scene.add(p.root);
      // the posed figure's extent, from its bones (the geometry's box is the standing bind pose)
      const box = new THREE.Box3();
      for (const b of p.skeleton.bones) if (!/Arm|Forearm|Hand|Finger/.test(b.name)) box.expandByPoint(b.getWorldPosition(new THREE.Vector3()));
      box.max.y += 0.14;
      box.min.y -= 0.05;
      const sc = Math.min(1.15, 1.2 / Math.max(0.9, box.max.y - box.min.y));
      p.root.scale.setScalar(sc);
      p.root.position.y = -box.min.y * sc;
      p.root.updateMatrixWorld(true);
      renderer.render(scene, cam);
      const img = grab();
      // mask: shirt (and cap) white, everything else black
      const bodyMat = p.body.material as THREE.MeshPhysicalMaterial;
      const saved = new Map<THREE.Mesh, THREE.Material>();
      p.root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && m !== p.body) {
          saved.set(m, m.material as THREE.Material);
          m.material = (m.material as THREE.Material).name === 'person-cap' ? white : black;
        }
      });
      bodyMat.userData.maskMode.value = 1;
      renderer.render(scene, cam);
      const mask = grab().data;
      bodyMat.userData.maskMode.value = 0;
      for (const [m, mat] of saved) m.material = mat;
      scene.remove(p.root);
      p.dispose();
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        if (mask[i] > 127) {
          const L = (d[i] + d[i + 1] + d[i + 2]) / 3;
          const v = 236 + (Math.min(255, L) / 255) * 19;
          d[i] = d[i + 1] = d[i + 2] = v;
        } else {
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          if (mn > 212) {
            const k = 212 / mn;
            d[i] *= k;
            d[i + 1] *= k;
            d[i + 2] *= k;
          }
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = RW;
      tmp.height = RH;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      out.drawImage(tmp, col * cw, row * ch, cw, ch);
    }
  }
  black.dispose();
  white.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return canvas;
}
