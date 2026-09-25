import * as THREE from 'three';
import { CLOTH_GLSL, Person, TOP_ID, BOTTOM_ID, fanLook, landmarkVectors, rigid, capGeometry, mergeSimple, type BodyAsset, type Look, type PeopleKit, type HairId } from './Humans.ts';
import { ACT, ACT_CLIP, ACT_COUNT, actPose } from './poses.ts';
import { TEAMS } from '../race/Teams.ts';

/**
 * Hundreds of fans on the real bodies: every act (cheering, clapping, waving, a flag,
 * filming, fist pumps, jumping, dancing, chatting, standing) is baked once per body into a
 * bone-matrix texture; one instanced mesh per body / hairstyle / prop skins itself on the
 * GPU from that texture, each fan with their own act, phase, clothes, skin and hair.
 * The bodies are decimated for the crowd (the silhouettes and faces hold up at a few metres).
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

interface Baked {
  tex: THREE.DataTexture;
  /** per act: first row, frames, loop seconds */
  acts: [number, number, number][];
  body: THREE.BufferGeometry;
}

const bakes = new WeakMap<BodyAsset, Baked>();

function bake(kit: PeopleKit, asset: BodyAsset): Baked {
  const hit = bakes.get(asset);
  if (hit) return hit;
  const look: Look = { female: asset === kit.female, tone: 0, hair: 'none', hairColor: 0, top: 'tshirt', topColor: 0xffffff, bottom: 'jeans', bottomColor: 0 };
  const p = new Person(kit, look);
  const nb = p.skeleton.bones.length;
  const acts: [number, number, number][] = [];
  const rows: Float32Array[] = [];
  for (let a = 0; a < ACT_COUNT; a++) {
    const clip = kit.clips.get(ACT_CLIP[a])!;
    const period = clip.duration;
    const frames = Math.min(96, Math.max(24, Math.round(period * 22)));
    acts.push([rows.length, frames, period]);
    p.mixer.stopAllAction();
    const action = p.mixer.clipAction(clip);
    action.reset().play();
    for (let f = 0; f < frames; f++) {
      const u = f / frames;
      p.mixer.setTime(u * period);
      p.root.updateMatrixWorld(true);
      actPose(p, a, u);
      p.root.updateMatrixWorld(true);
      p.skeleton.update();
      rows.push(p.skeleton.boneMatrices!.slice(0, nb * 16) as Float32Array);
    }
  }
  const W = nb * 4, H = rows.length;
  const data = new Float32Array(W * H * 4);
  rows.forEach((r, y) => data.set(r, y * W * 4));
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  p.dispose();
  const body = decimate(asset.geometry, 0.045);
  const out = { tex, acts, body };
  bakes.set(asset, out);
  return out;
}

/** vertex clustering (seams kept apart by UV) for the crowd's level of detail */
export function decimate(src: THREE.BufferGeometry, cell: number): THREE.BufferGeometry {
  const pa = src.getAttribute('position') as THREE.BufferAttribute;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute;
  const idx = src.index!.array;
  const n = pa.count;
  const rep = new Int32Array(n);
  const map = new Map<string, number>();
  const cellOf = new Map<string, number>();
  const keep: number[] = [];
  /** per output vertex: the source vertex whose position the whole spatial cell snaps to */
  const posFrom: number[] = [];
  for (let i = 0; i < n; i++) {
    // the face keeps its detail
    const c = pa.getY(i) > 1.55 ? cell * 0.45 : cell;
    const ck = `${Math.floor(pa.getX(i) / c)},${Math.floor(pa.getY(i) / c)},${Math.floor(pa.getZ(i) / c)}`;
    let cp = cellOf.get(ck);
    if (cp === undefined) cellOf.set(ck, (cp = i));
    // UV seams keep separate vertices, but they share the cell's position (no cracks)
    const k = `${ck},${Math.floor(uv.getX(i) * 8)},${Math.floor(uv.getY(i) * 8)}`;
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
    const spatial = name === 'position' || name === 'aSmooth';
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
uniform mat4 uBind; uniform mat4 uBindInv;
attribute vec4 aAnim; // first row, frames, loop seconds, phase
mat4 crowdBone( float b, float row ) {
  int x = int( b ) * 4; int y = int( row );
  return mat4( texelFetch( uBones, ivec2( x, y ), 0 ), texelFetch( uBones, ivec2( x + 1, y ), 0 ), texelFetch( uBones, ivec2( x + 2, y ), 0 ), texelFetch( uBones, ivec2( x + 3, y ), 0 ) );
}
mat4 crowdSkin( vec3 A, float ph ) {
  float f = fract( uTime / A.z + ph ) * A.y;
  float f0 = floor( f ); float k = f - f0; float f1 = mod( f0 + 1.0, A.y );
  mat4 m = mat4( 0.0 );
  for ( int i = 0; i < 4; i ++ ) {
    float w = skinWeight[ i ];
    if ( w <= 0.0 ) continue;
    float b = skinIndex[ i ];
    m += w * ( crowdBone( b, A.x + f0 ) * ( 1.0 - k ) + crowdBone( b, A.x + f1 ) * k );
  }
  return m;
}
mat4 crowdMatrix() {
  mat4 S = crowdSkin( aAnim.xyz, aAnim.w );
  if ( uCalm > 0.001 ) S = S * ( 1.0 - uCalm ) + crowdSkin( uIdle, aAnim.w ) * uCalm;
  return uBindInv * S * uBind;
}
`;

function skinnedCrowdMaterial(baked: Baked, asset: BodyAsset, shared: { uTime: THREE.IUniform; uCalm: THREE.IUniform }, opts: { cloth: boolean; base: THREE.MeshStandardMaterialParameters }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(opts.base);
  const idle = baked.acts[ACT.IDLE];
  const lmv = landmarkVectors(asset.lm);
  const u: Record<string, THREE.IUniform> = {
    uBones: { value: baked.tex },
    uTime: shared.uTime,
    uCalm: shared.uCalm,
    uIdle: { value: new THREE.Vector3(idle[0], idle[1], idle[2]) },
    uBind: { value: asset.bindMatrix },
    uBindInv: { value: asset.bindMatrix.clone().invert() },
    uJ0: { value: lmv.J0 }, uJ1: { value: lmv.J1 }, uJ2: { value: lmv.J2 },
    uDark: { value: asset.dark },
  };
  const cloth = opts.cloth;
  const patch = (sh: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, depth: boolean) => {
    Object.assign(sh.uniforms, u);
    let vs = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 skinIndex; attribute vec4 skinWeight;
${SKIN_PARS}
${cloth ? `uniform vec4 uJ0; uniform vec4 uJ1; uniform vec4 uJ2;
attribute vec3 aSmooth; attribute vec3 aSmoothN;
attribute vec4 aTop; attribute vec4 aTop2; attribute vec4 aAcc; attribute vec4 aBot;
varying vec3 vRest; varying vec3 vRestN; varying vec4 vTop; varying vec4 vTop2; varying vec4 vAcc; varying vec4 vBot;
${CLOTH_GLSL}` : ''}`);
    const skinBlock = cloth
      ? `mat4 crowdM = crowdMatrix();
float gCov; float gPuff;
{
  vec3 cc; float rr; vec2 lu;
  gCov = clothAt( position, normal, uJ0, uJ1, uJ2, vec4( aTop.w, aTop2.w, 0.0, 0.0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), vec3( 0 ), cc, rr, gPuff, lu );
}
float crowdK = max( gCov, 0.4 * ( 1.0 - step( uJ0.w + 0.03, position.y ) ) * ( 1.0 - step( uJ0.z - 0.03, abs( position.x ) ) ) * step( uJ1.w + 0.04, position.y ) );`
      : `mat4 crowdM = crowdMatrix();`;
    if (!depth) {
      vs = vs.replace('#include <beginnormal_vertex>', `${skinBlock}
vec3 objectNormal = normalize( mat3( crowdM ) * ${cloth ? 'normalize( mix( normal, aSmoothN, crowdK ) )' : 'normal'} );
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`);
    }
    vs = vs.replace('#include <begin_vertex>', `${depth ? skinBlock : ''}
${cloth ? `vec3 restP = mix( position, aSmooth, crowdK );
vRest = restP; vRestN = aSmoothN; vTop = aTop; vTop2 = aTop2; vAcc = aAcc; vBot = aBot;
vec3 transformed = ( crowdM * vec4( restP + aSmoothN * ( gPuff + 0.006 ) * gCov, 1.0 ) ).xyz;` : `vec3 transformed = ( crowdM * vec4( position, 1.0 ) ).xyz;`}
#ifdef USE_ALPHAHASH
vPosition = vec3( position );
#endif`);
    sh.vertexShader = vs;
    if (cloth && !depth) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uDark;
uniform vec4 uJ0; uniform vec4 uJ1; uniform vec4 uJ2;
varying vec3 vRest; varying vec3 vRestN; varying vec4 vTop; varying vec4 vTop2; varying vec4 vAcc; varying vec4 vBot;
float gCloth; float gRough;
${CLOTH_GLSL}`)
        .replace('#include <map_fragment>', `
{
  vec4 a = texture2D( map, vMapUv );
  vec4 b = texture2D( uDark, vMapUv );
  diffuseColor *= mix( a, b, vAcc.w );
  vec3 cc; float rr; float pf; vec2 lu;
  gCloth = clothAt( vRest, normalize( vRestN ), uJ0, uJ1, uJ2, vec4( vTop.w, vTop2.w, 0.0, 0.0 ), vTop.rgb, vTop2.rgb, vAcc.rgb, vBot.rgb, vec3( vBot.w ), vec3( 0.1 ), cc, rr, pf, lu );
  gRough = rr;
  diffuseColor.rgb = mix( diffuseColor.rgb, cc, gCloth );
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor * 0.9, gRough, gCloth );`)
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * ( 1.0 - gCloth );'));
    }
  };
  mat.onBeforeCompile = (sh) => patch(sh, false);
  mat.customProgramCacheKey = () => `apex-crowd-skin-${cloth ? 'cloth' : 'plain'}-v1`;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = (sh) => patch(sh, true);
  depthMat.customProgramCacheKey = () => `apex-crowd-depth-${cloth ? 'cloth' : 'plain'}-v1`;
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

  constructor(kit: PeopleKit, spots: FanSpot[], opts: { shadows?: boolean; seed?: number } = {}) {
    this.group.name = 'fan-crowd';
    let seed = opts.seed ?? 1234;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const members: Member[] = spots.map((s) => {
      const t = TEAMS[s.team % TEAMS.length];
      const look = fanLook(rand, t);
      const r = rand();
      const act = s.act ?? (r < 0.2 ? ACT.CHEER : r < 0.36 ? ACT.CLAP : r < 0.46 ? ACT.WAVE : r < 0.56 ? ACT.PHONE : r < 0.66 ? ACT.FIST : r < 0.74 ? ACT.JUMP : r < 0.8 ? ACT.DANCE : r < 0.9 ? ACT.TALK : ACT.CHEER);
      return { spot: s, look, act, phase: rand() };
    });
    for (const female of [false, true]) {
      const asset = female ? kit.female : kit.male;
      const list = members.filter((m) => m.look.female === female);
      if (!list.length) continue;
      const baked = bake(kit, asset);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const inst = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, who: Member[], color?: (m: Member) => THREE.ColorRepresentation, extra?: (geo: THREE.InstancedBufferGeometry | THREE.BufferGeometry, who: Member[]) => void) => {
        if (!who.length) return;
        const g = geo.clone();
        const anim = new Float32Array(who.length * 4);
        who.forEach((m, i) => {
          const a = baked.acts[m.act];
          anim.set([a[0], a[1], a[2] / (0.85 + (m.spot.excite ?? 0.8) * 0.3), m.phase], i * 4);
        });
        g.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 4));
        extra?.(g, who);
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
      // bodies (clothes per instance)
      const bodyMat = skinnedCrowdMaterial(baked, asset, this.shared, { cloth: true, base: { map: asset.light, normalMap: asset.normal, roughnessMap: asset.rough, roughness: 1, metalness: 0 } });
      inst(baked.body, bodyMat, list, undefined, (g, who) => {
        const top = new Float32Array(who.length * 4), top2 = new Float32Array(who.length * 4), acc = new Float32Array(who.length * 4), bot = new Float32Array(who.length * 4);
        const c = new THREE.Color();
        who.forEach((m, i) => {
          const L = m.look;
          c.set(L.topColor);
          top.set([c.r, c.g, c.b, TOP_ID[L.top]], i * 4);
          c.set(L.top2 ?? L.topColor);
          top2.set([c.r, c.g, c.b, BOTTOM_ID[L.bottom]], i * 4);
          c.set(L.accent ?? L.topColor);
          acc.set([c.r, c.g, c.b, L.tone], i * 4);
          c.set(L.bottomColor);
          const shoe = new THREE.Color(L.shoeColor ?? 0x222222);
          bot.set([c.r, c.g, c.b, (shoe.r + shoe.g + shoe.b) / 3], i * 4);
        });
        g.setAttribute('aTop', new THREE.InstancedBufferAttribute(top, 4));
        g.setAttribute('aTop2', new THREE.InstancedBufferAttribute(top2, 4));
        g.setAttribute('aAcc', new THREE.InstancedBufferAttribute(acc, 4));
        g.setAttribute('aBot', new THREE.InstancedBufferAttribute(bot, 4));
      });
      // hair by style
      const styles = new Set<HairId>(list.map((m) => (m.look.cap && m.look.hair !== 'long' ? (female ? 'buzzedfemale' : 'buzzed') : m.look.hair)));
      for (const st of styles) {
        if (st === 'none') continue;
        const who = list.filter((m) => (m.look.cap && m.look.hair !== 'long' ? (female ? 'buzzedfemale' : 'buzzed') : m.look.hair) === st);
        const k = st === 'long' || st === 'buns' ? 1 : 0;
        const mat = skinnedCrowdMaterial(baked, asset, this.shared, { cloth: false, base: { map: kit.hairMap[k], normalMap: kit.hairNormal[k], roughness: 0.72, side: THREE.DoubleSide, alphaTest: 0.35 } });
        inst(kit.hair[st], mat, who, (m) => new THREE.Color(m.look.hairColor).multiplyScalar(2.2));
      }
      const beards = list.filter((m) => m.look.beard && !female);
      if (beards.length) {
        const mat = skinnedCrowdMaterial(baked, asset, this.shared, { cloth: false, base: { map: kit.hairMap[0], normalMap: kit.hairNormal[0], roughness: 0.72, side: THREE.DoubleSide, alphaTest: 0.35 } });
        inst(kit.hair.beard, mat, beards, (m) => new THREE.Color(m.look.hairColor).multiplyScalar(2.2));
      }
      // caps
      const caps = list.filter((m) => m.look.cap);
      if (caps.length) {
        const head = asset.lm.joint.Head;
        const fwd = caps.filter((m) => !m.look.capBack), back = caps.filter((m) => m.look.capBack);
        for (const [who, b] of [[fwd, false], [back, true]] as [Member[], boolean][]) {
          if (!who.length) continue;
          const g = rigid(capGeometry(asset, b), head);
          this.owned.push(g);
          inst(g, skinnedCrowdMaterial(baked, asset, this.shared, { cloth: false, base: { roughness: 0.8 } }), who, (m) => m.look.cap!);
        }
      }
      // flags and phones in the right hand
      const hand = asset.lm.joint.hand_r;
      const hp = asset.lm.pos.hand_r;
      const flags = list.filter((m) => m.act === ACT.FLAG);
      if (flags.length) {
        const g = rigid(flagGeometry(hp), hand);
        this.owned.push(g);
        inst(g, skinnedCrowdMaterial(baked, asset, this.shared, { cloth: false, base: { roughness: 0.85, side: THREE.DoubleSide, vertexColors: true } }), flags, (m) => TEAMS[m.spot.team % TEAMS.length].primary);
      }
      const phones = list.filter((m) => m.act === ACT.PHONE);
      if (phones.length) {
        const ph = new THREE.BoxGeometry(0.075, 0.15, 0.009);
        ph.translate(hp.x - 0.1, hp.y, hp.z + 0.02);
        const g = rigid(mergeSimple([ph]), hand);
        this.owned.push(g);
        inst(g, skinnedCrowdMaterial(baked, asset, this.shared, { cloth: false, base: { roughness: 0.3, metalness: 0.4 } }), phones, () => 0x1a1b1e);
      }
    }
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

/** a hand-held flag on a pole, in bind space at the right hand (T-pose: the arm points along −x) */
function flagGeometry(hand: THREE.Vector3): THREE.BufferGeometry {
  // in the T-pose the hand's "up" when the arm is raised is along the arm (−x): the pole runs along it
  const pole = new THREE.CylinderGeometry(0.008, 0.008, 1.1, 6);
  pole.rotateZ(Math.PI / 2);
  pole.translate(hand.x - 0.08 - 0.45, hand.y, hand.z);
  // the cloth hangs off the top half of the pole
  const cloth = new THREE.PlaneGeometry(0.62, 0.42, 8, 4);
  cloth.translate(hand.x - 0.08 - 0.72, hand.y - 0.22, hand.z);
  const g = mergeSimple([pole, cloth]);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const poleN = pole.index ? pole.index.count : pole.getAttribute('position').count;
  const pa = g.getAttribute('position');
  for (let i = 0; i < n; i++) {
    if (i < poleN) col.set([0.75, 0.75, 0.75], i * 3);
    else {
      // a white band through the team colour
      const band = Math.abs(pa.getY(i) - (hand.y - 0.22)) < 0.05 ? 1 : 0;
      col.set(band ? [3, 3, 3] : [1, 1, 1], i * 3);
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------------------------ sprite atlas
export const ATLAS_COLS = 10;

/**
 * The grandstand crowd's atlas: ten fans rendered from the real bodies, sitting (row 0:
 * hands in the lap, clapping, filming) and sitting up cheering (row 1). Shirts come out
 * near-white (≥ 236) so the grandstand shader can dye them per person; nothing else is
 * that bright.
 */
export function renderFanAtlas(kit: PeopleKit, cw = 128, ch = 256): HTMLCanvasElement {
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
  for (let col = 0; col < COLS; col++) {
    const base = fanLook(rand, TEAMS[col % TEAMS.length]);
    for (let row = 0; row < ROWS; row++) {
      // shirts white for dyeing, everything else as it is
      const look: Look = { ...base, topColor: 0xffffff, top2: 0xffffff, accent: 0xffffff, top: base.top === 'tank' ? 'tshirt' : base.top, cap: base.cap ? 0xffffff : null };
      const p = new Person(kit, look);
      p.play('Sitting_Idle_Loop');
      p.mixer.setTime(0.4 + col * 0.37);
      p.root.updateMatrixWorld(true);
      const act = row === 0 ? (col % 3 === 0 ? ACT.CLAP : col % 3 === 1 ? ACT.PHONE : -1) : col % 2 ? ACT.CHEER : ACT.FIST;
      if (act >= 0) actPose(p, act, 0.13 + col * 0.07);
      p.root.rotation.y = -0.12 + (col % 3) * 0.12;
      p.root.updateMatrixWorld(true);
      scene.add(p.root);
      // fit: the seated head near the top of the card
      const box = new THREE.Box3();
      p.body.computeBoundingBox();
      box.copy(p.body.boundingBox!).applyMatrix4(p.body.matrixWorld);
      const sc = Math.min(1.15, 1.2 / Math.max(0.9, box.max.y - box.min.y));
      p.root.scale.setScalar(sc);
      p.root.position.y = -box.min.y * sc;
      p.root.updateMatrixWorld(true);
      renderer.render(scene, cam);
      const img = grab();
      // mask: shirt (and cap) white, everything else black
      const bodyMat = p.body.material as THREE.MeshPhysicalMaterial;
      const saved: THREE.Material[] = [];
      p.root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && m !== p.body) {
          saved.push(m.material as THREE.Material);
          const isCap = (m.material as THREE.MeshStandardMaterial).color?.getHex?.() === 0xffffff && !(m.material as THREE.MeshStandardMaterial).map;
          m.material = isCap ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : black;
        }
      });
      bodyMat.userData.maskMode.value = 1;
      renderer.render(scene, cam);
      const mask = grab().data;
      bodyMat.userData.maskMode.value = 0;
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
      void saved;
    }
  }
  black.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return canvas;
}
