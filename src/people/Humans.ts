import * as THREE from 'three';
import { NOISE_GLSL, LIGHT_GLOBALS, CLOTH_WHITE_MAX, peopleLightsChunk, skinColor } from './shading.ts';
import { rbIndex, loadAvatar, loadAnims, retarget, atlasHalf, mergeParts, type RbAvatar, type RbClips, type AvatarMeta } from './rocketbox.ts';

/**
 * People built on the Microsoft Rocketbox avatars (MIT): scanned-look adults with 2K
 * textures, rigged on a 3ds Max Biped skeleton, and the library's own animations (see
 * tools/build_rocketbox.mjs and rocketbox.ts).
 *
 * A person is a body (an avatar's mesh below the neck, its clothes) wearing a head (an
 * avatar's face, neck and hair; by default its own). Drivers wear a pilot's uniform
 * re-dyed as their team's race suit, the pit crews a work jacket and trousers in the
 * team kit, engineers a shirt in team colours; fans wear their own clothes, a share of
 * them with the shirt dyed toward their team's colour. Dyeing keeps the fabric: the new
 * colour is modulated by the texture's own high-pass luminance, under its normal map.
 *
 * The skeleton's bones answer to their Biped names and to the old UE-mannequin names
 * (upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, spine_02, neck_01, Head,
 * pelvis …), so the procedural posing (poses.ts) and its callers work unchanged.
 */

// ------------------------------------------------------------------------------------ looks
export type HairId = 'buzzed' | 'buzzedfemale' | 'simpleparted' | 'long' | 'buns' | 'none';
export type TopKind = 'none' | 'tshirt' | 'polo' | 'longsleeve' | 'tank' | 'hoodie' | 'jacket' | 'suit';
export type BottomKind = 'none' | 'trousers' | 'jeans' | 'shorts' | 'suit';


export interface Look {
  female: boolean;
  /** skin: 0 fair … 1 deep (chooses among the heads) */
  tone: number;
  /** a skin colour (as a palette shows it) instead of `tone` */
  skin?: THREE.ColorRepresentation;
  undertone?: number;
  /** (kept for the callers: the hair comes with the head) */
  hair: HairId;
  hairColor: THREE.ColorRepresentation;
  beard?: boolean;
  stubble?: number;
  eyeColor?: THREE.ColorRepresentation;
  /** 'suit' race suit / crew overall, 'jacket' crew kit, 'polo' team shirt; anything else: the avatar's own clothes */
  top: TopKind;
  topColor: THREE.ColorRepresentation;
  /** side panels / sleeves */
  top2?: THREE.ColorRepresentation;
  /** collar, belt, cuffs */
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
  /** 1 = the avatar's own height */
  height?: number;
  /** girth */
  build?: number;
  weight?: number;
  muscle?: number;
  face?: { width?: number; jaw?: number; length?: number };
  /** the Rocketbox avatar whose body (and clothes) this person wears (default: from `top`) */
  body?: string;
  /** whose head (face, neck, hair) (default: the body's own, or one matching `tone` for uniforms) */
  head?: string;
  /** fans: 0 their own shirt … 1 their shirt dyed fully in topColor */
  tint?: number;
  /** a racing driver (a young face) */
  driver?: boolean;
}

/** bind-pose landmarks of a body (metres, y up, facing +z) */
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
  /** bone index by name (Biped and UE names) */
  joint: Record<string, number>;
  /** bind world position by bone name (Biped and UE names) */
  pos: Record<string, THREE.Vector3>;
  /** the left eye: centre (x > 0) and radius */
  eye?: THREE.Vector4;
  /** half the head's width at the ears, and the ears' height and depth */
  ear?: THREE.Vector3;
}

/** a body wearing a head: geometry in bind space, its skeleton's rest pose, textures */
export interface BodyAsset {
  key: string;
  female: boolean;
  body: RbAvatar;
  head: RbAvatar;
  lm: Landmarks;
  /** skin (body + head) geometry, with aPart */
  geometry: THREE.BufferGeometry;
  hair: THREE.BufferGeometry | null;
  boneInverses: THREE.Matrix4[];
  bindMatrix: THREE.Matrix4;
  /** the head's skin colour (linear) */
  skinRef: THREE.Color;
  /** the root bone's rest position (the clips' root track is an offset from it) */
  rootRest: THREE.Vector3;
}

export interface PeopleKit {
  /** the default bodies (the crowd's bake reference) */
  male: BodyAsset;
  female: BodyAsset;
  /** male clips (by our names and the old ones); clipsF the female */
  clips: Map<string, THREE.AnimationClip>;
  clipsF: Map<string, THREE.AnimationClip>;
  speed: Map<string, number>;
  /** a body wearing a head (both must be loaded: see ROSTER) */
  asset(body: string, head?: string): BodyAsset;
  /** the avatars loaded, by name */
  avatars: Map<string, RbAvatar>;
  capMap?: THREE.Texture;
  /** every avatar in the ROSTER has loaded (the fans come in behind the CORE) */
  complete: boolean;
  whenAll: Promise<void>;
}

// ------------------------------------------------------------------------------------ the roster
/**
 * The avatars in use. loadPeople() waits for the CORE ones (≈ 6.2 MB with the clips: the
 * uniforms and the faces they wear) and brings the fans in behind (≈ 6.8 MB); a fan picks
 * among the bodies loaded.
 */
export const ROSTER = {
  /** race suit (drivers) */
  suit: 'Gardener_Male_01',
  /** crew kit: work jacket, trousers, gloves */
  crew: 'Gardener_Male_01',
  crewF: 'Pilot_Female_01',
  /** team shirt (engineers) */
  shirt: 'Pilot_Male_03',
  shirtF: 'Pilot_Female_02',
  /** fans in their own clothes (and the crowd's bodies) */
  fansM: ['Male_Adult_01', 'Male_Adult_14', 'Male_Adult_05', 'Male_Adult_08', 'Male_Adult_09', 'Male_Adult_15', 'Delivery_Male_01'],
  fansF: ['Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'],
  /** faces for the uniforms (short hair: they go under caps and helmets) */
  headsM: ['Sports_Male_01', 'Sports_Male_02', 'Male_Adult_07', 'Male_Adult_10', 'Male_Adult_12', 'Gardener_Male_01'],
  headsF: ['Pilot_Female_01', 'Pilot_Female_02'],
  /** the drivers' faces: the young ones */
  driverHeads: ['Sports_Male_01', 'Sports_Male_02', 'Male_Adult_07', 'Male_Adult_10', 'Male_Adult_11', 'Male_Adult_12', 'Male_Adult_16'],
};
const ALL = [...new Set([ROSTER.suit, ROSTER.crew, ROSTER.crewF, ROSTER.shirt, ROSTER.shirtF, ...ROSTER.fansM, ...ROSTER.fansF, ...ROSTER.headsM, ...ROSTER.headsF, ...ROSTER.driverHeads])];
/** the uniforms and every face they wear load first: a driver or a mechanic looks the same wherever they appear */
const CORE = [...new Set([ROSTER.suit, ROSTER.crew, ROSTER.crewF, ROSTER.shirt, ROSTER.shirtF, ...ROSTER.headsM, ...ROSTER.headsF, ...ROSTER.driverHeads])];
/** CORE avatars in their own everyday clothes: the fans until the fans' own avatars have loaded */
const CASUAL_M = ['Male_Adult_07', 'Male_Adult_12', 'Male_Adult_10', 'Male_Adult_16', 'Male_Adult_11', 'Sports_Male_02'];
const CASUAL_F = ['Pilot_Female_02'];

/** the bodies a fan can have right now: the fans loaded, else the casual CORE ones */
export function fanPool(kit: PeopleKit, female: boolean): string[] {
  const own = (female ? ROSTER.fansF : ROSTER.fansM).filter((n) => kit.avatars.has(n));
  if (own.length) return own;
  const casual = (female ? CASUAL_F : CASUAL_M).filter((n) => kit.avatars.has(n));
  return casual.length ? casual : [firstLoaded(kit, [])];
}
function isFanBody(n: string): boolean {
  return ROSTER.fansM.includes(n) || ROSTER.fansF.includes(n) || CASUAL_M.includes(n) || CASUAL_F.includes(n);
}

/** the old clip names → the Rocketbox clips */
export const CLIP_ALIAS: Record<string, string> = {
  Idle_Loop: 'idle',
  Idle_Talking_Loop: 'talk',
  Crouch_Idle_Loop: 'crouch',
  Fixing_Kneeling: 'crouch_work',
  Push_Loop: 'trolley',
  Walk_Loop: 'walk',
  Walk_Formal_Loop: 'walk',
  Jog_Fwd_Loop: 'jog',
  Sprint_Loop: 'run',
  Sitting_Idle_Loop: 'sit',
  Sitting_Talking_Loop: 'sit',
  Dance_Loop: 'dance',
  Jump_Loop: 'cheer3',
  Interact: 'work',
  PickUp_Table: 'work_table',
  Idle_Listening_Loop: 'listen',
};

// ------------------------------------------------------------------------------------ bones
const FINGER_UE = ['thumb', 'index', 'middle', 'ring', 'pinky'];
/** UE-mannequin name → Biped name */
export const BONE_ALIAS: Record<string, string> = (() => {
  const m: Record<string, string> = {
    root: 'Bip01', pelvis: 'Bip01_Pelvis', spine_01: 'Bip01_Spine', spine_02: 'Bip01_Spine1', spine_03: 'Bip01_Spine2', neck_01: 'Bip01_Neck', Head: 'Bip01_Head',
  };
  for (const [s, S] of [['l', 'L'], ['r', 'R']]) {
    Object.assign(m, {
      [`clavicle_${s}`]: `Bip01_${S}_Clavicle`, [`upperarm_${s}`]: `Bip01_${S}_UpperArm`, [`lowerarm_${s}`]: `Bip01_${S}_Forearm`, [`hand_${s}`]: `Bip01_${S}_Hand`,
      [`thigh_${s}`]: `Bip01_${S}_Thigh`, [`calf_${s}`]: `Bip01_${S}_Calf`, [`foot_${s}`]: `Bip01_${S}_Foot`, [`ball_${s}`]: `Bip01_${S}_Toe0`,
    });
    FINGER_UE.forEach((f, k) => {
      for (let j = 1; j <= 3; j++) m[`${f}_0${j}_${s}`] = `Bip01_${S}_Finger${k}${j === 1 ? '' : j - 1}`;
    });
  }
  return m;
})();

/** body part of a Biped bone: 0 head, 1 neck, 2 torso, 3 upper arm, 4 forearm, 5 hand, 6 thigh, 7 calf, 8 foot */
function partOf(name: string): number {
  if (/Head|Eye/.test(name)) return 0;
  if (/Neck/.test(name)) return 1;
  if (/UpperArm/.test(name)) return 3;
  if (/Forearm/.test(name)) return 4;
  if (/Hand|Finger/.test(name)) return 5;
  if (/Thigh/.test(name)) return 6;
  if (/Calf/.test(name)) return 7;
  if (/Foot|Toe/.test(name)) return 8;
  return 2;
}

// ------------------------------------------------------------------------------------ the kit
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
  await rbIndex();
  const [avs, m, f] = await Promise.all([Promise.all(CORE.map((n) => loadAvatar(n))), loadAnims('m'), loadAnims('f')]);
  const avatars = new Map(avs.map((a) => [a.meta.name, a]));
  const cache = new Map<string, BodyAsset>();
  const withAliases = (c: RbClips) => {
    const out = new Map(c.clips);
    for (const [k, v] of Object.entries(CLIP_ALIAS)) if (c.clips.has(v)) out.set(k, c.clips.get(v)!);
    return out;
  };
  const kit: PeopleKit = {
    avatars,
    clips: withAliases(m),
    clipsF: withAliases(f),
    speed: m.speed,
    asset(body: string, head?: string) {
      const key = `${body}+${head ?? body}`;
      let a = cache.get(key);
      if (!a) {
        const B = avatars.get(body), H = avatars.get(head ?? body);
        if (!B || !H) throw new Error(`people: ${!B ? body : head} is not loaded`);
        cache.set(key, (a = compose(B, H)));
      }
      return a;
    },
    male: null as unknown as BodyAsset,
    female: null as unknown as BodyAsset,
    capMap: capTexture(),
    complete: false,
    whenAll: Promise.resolve(),
  };
  kit.male = kit.asset(firstLoaded(kit, ROSTER.fansM));
  kit.female = kit.asset(firstLoaded(kit, ROSTER.fansF));
  // the rest behind
  const rest = ALL.filter((n) => !avatars.has(n)).map((n) => loadAvatar(n).then((a) => void avatars.set(n, a)).catch((e) => console.warn('people:', n, e)));
  kit.whenAll = Promise.all(rest).then(() => void (kit.complete = true));
  return kit;
}

/** a body wearing a head: the body half of one mesh, the head half (and hair) of the other moved onto its skeleton */
function compose(B: RbAvatar, H: RbAvatar): BodyAsset {
  let geometry: THREE.BufferGeometry, hair: THREE.BufferGeometry | null;
  if (B === H) {
    geometry = B.skin.clone();
    hair = B.hair ? B.hair.clone() : null;
  } else {
    const hs = retarget(H.skin, H, B);
    geometry = mergeParts([{ g: B.skin, tris: atlasHalf(B.skin, false) }, { g: hs, tris: atlasHalf(hs, true) }]);
    hs.dispose();
    hair = H.hair ? retarget(H.hair, H, B) : null;
  }
  // the dominant bone's body part, per vertex
  const si = geometry.getAttribute('skinIndex'), sw = geometry.getAttribute('skinWeight');
  const part = new Float32Array(si.count);
  const partOfBone = B.names.map(partOf);
  for (let i = 0; i < si.count; i++) {
    let best = 0, bw = -1;
    for (let c = 0; c < 4; c++) if (sw.getComponent(i, c) > bw) { bw = sw.getComponent(i, c); best = si.getComponent(i, c); }
    part[i] = partOfBone[best];
  }
  geometry.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  geometry.computeBoundingSphere();
  const lm = landmarks(B, geometry);
  const s = H.meta.skin;
  return {
    key: `${B.meta.name}+${H.meta.name}`,
    female: B.meta.female,
    body: B,
    head: H,
    lm,
    geometry,
    hair,
    boneInverses: B.boneInverses,
    bindMatrix: new THREE.Matrix4(),
    skinRef: new THREE.Color(s[0], s[1], s[2]),
    rootRest: B.local[0].p.clone(),
  };
}

function landmarks(B: RbAvatar, geo: THREE.BufferGeometry): Landmarks {
  const joint: Record<string, number> = {};
  const pos: Record<string, THREE.Vector3> = {};
  B.names.forEach((n, i) => {
    joint[n] = i;
    pos[n] = new THREE.Vector3().setFromMatrixPosition(B.bindW[i]);
  });
  for (const [ue, bip] of Object.entries(BONE_ALIAS)) {
    if (joint[bip] === undefined) continue;
    joint[ue] = joint[bip];
    pos[ue] = pos[bip];
  }
  const head = joint.Bip01_Head;
  const pa = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const hb = new THREE.Box3(), v = new THREE.Vector3();
  let top = -Infinity;
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i);
    top = Math.max(top, v.y);
    let onHead = 0;
    for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === head) onHead += sw.getComponent(i, c);
    if (onHead > 0.8 && v.y > pos.Head.y + 0.05) hb.expandByPoint(v);
  }
  const le = pos.Bip01_LEye ?? new THREE.Vector3(0.032, pos.Head.y + 0.1, 0.09);
  // the ears: the widest head vertices a little below the eyes, behind them
  const ear = new THREE.Vector3(0.075, le.y - 0.02, le.z - 0.09);
  {
    let best = 0;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i), z = pa.getZ(i), x = Math.abs(pa.getX(i));
      if (y < le.y - 0.045 || y > le.y + 0.005 || z > le.z - 0.04) continue;
      if (x > best) {
        best = x;
        ear.set(x, y, z);
      }
    }
  }
  return {
    shoulderX: pos.upperarm_l.x,
    elbowX: pos.lowerarm_l.x,
    wristX: pos.hand_l.x,
    armY: pos.upperarm_l.y,
    neckY: pos.neck_01.y,
    chestY: pos.spine_03.y,
    waistY: pos.spine_01.y,
    kneeY: pos.calf_l.y,
    ankleY: pos.foot_l.y,
    headY: pos.Head.y,
    headTop: top,
    skull: hb.getCenter(new THREE.Vector3()),
    skullR: hb.getSize(new THREE.Vector3()).multiplyScalar(0.5),
    joint,
    pos,
    eye: new THREE.Vector4(le.x, le.y, le.z + 0.006, 0.0125),
    ear,
  };
}

// ------------------------------------------------------------------------------------ choosing avatars
function firstLoaded(kit: PeopleKit, pool: string[]): string {
  return pool.find((n) => kit.avatars.has(n)) ?? [...kit.avatars.keys()][0];
}

function hashOf(look: Look): number {
  let h = 0;
  for (const ch of JSON.stringify([look.tone, look.skin, look.hairColor, look.topColor, look.height, look.female, look.beard, look.bottomColor])) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** a head from the pool whose skin is nearest the look's (among the three nearest, by hash) */
function pickHead(kit: PeopleKit, look: Look, pool: string[], h: number): string {
  const want = look.skin !== undefined ? lum(new THREE.Color(look.skin).toArray()) * 0.55 : lum(skinColor(look.tone).toArray());
  const cands = pool.filter((n) => kit.avatars.has(n)).map((n) => ({ n, d: Math.abs(lum(kit.avatars.get(n)!.meta.skin) - want) }));
  cands.sort((a, b) => a.d - b.d);
  const near = cands.filter((c) => c.d <= cands[0].d + 0.04).slice(0, 3);
  // a beard asks for a bearded head where there is one
  if (look.beard) {
    const b = near.find((c) => /Gardener|Sports_Male_01/.test(c.n));
    if (b) return b.n;
  }
  return near[h % near.length].n;
}

/** which body and head a look wears */
export function resolveLook(kit: PeopleKit, look: Look): { body: string; head: string } {
  const h = hashOf(look);
  const F = look.female;
  let body = look.body;
  let uniform = true;
  if (!body) {
    if (look.top === 'suit') body = F ? ROSTER.crewF : look.gloves ? ROSTER.crew : ROSTER.suit;
    else if (look.top === 'jacket') body = F ? ROSTER.crewF : ROSTER.crew;
    else if (look.top === 'polo') body = F ? ROSTER.shirtF : ROSTER.shirt;
    else {
      const pool = fanPool(kit, F);
      body = pool[h % pool.length];
      uniform = false;
    }
  } else uniform = !isFanBody(body);
  if (!kit.avatars.has(body)) {
    const pool = fanPool(kit, F);
    body = pool[h % pool.length];
    uniform = false;
  }
  let head = look.head ?? (uniform ? pickHead(kit, look, F ? ROSTER.headsF : look.driver ? ROSTER.driverHeads : ROSTER.headsM, h >> 3) : body);
  if (!kit.avatars.has(head) || kit.avatars.get(head)!.meta.female !== kit.avatars.get(body)!.meta.female) head = body;
  return { body, head };
}

// ------------------------------------------------------------------------------------ the skin + clothes material
/**
 * GLSL (fragment): the surface of a person. Needs uniforms map (the body's atlas), uHeadMap,
 * uMask; varyings vMapUv, vRest (bind position), vRestN, vPart. rbBase() samples the atlas
 * halves; rbDetail() is the fabric's own relief (its luminance over a blurred copy).
 */
export const RB_SURFACE_GLSL = /* glsl */ `
const vec3 RB_LUM = vec3( 0.2126, 0.7152, 0.0722 );
vec4 rbBase( sampler2D bodyMap, sampler2D headMap, vec2 uv ) {
  vec4 b = texture2D( bodyMap, uv ), h = texture2D( headMap, uv );
  return uv.x < 0.5 ? b : h;
}
float rbDetail( sampler2D bodyMap, vec2 uv, vec3 c ) {
  vec3 lo = texture2D( bodyMap, uv, 4.5 ).rgb;
  return clamp( ( dot( c, RB_LUM ) + 0.004 ) / ( dot( lo, RB_LUM ) + 0.004 ), 0.55, 1.4 );
}
// how much a colour looks like the reference skin (painted hair, brows, lips, clothes: less)
float rbSkinLike( vec3 c, vec3 ref ) {
  float s = dot( c, vec3( 1.0 ) ) + 1e-3, r = dot( ref, vec3( 1.0 ) ) + 1e-3;
  vec2 dc = c.rg / s - ref.rg / r;
  float dl = abs( log( s / r ) );
  return 1.0 - smoothstep( 0.05, 0.11, length( dc ) ) * 0.9 - smoothstep( 0.9, 1.6, dl ) * 0.8;
}
`;

/**
 * GLSL (fragment): a uniform in team colours over the avatar's clothes. part: 1 neck …
 * 8 foot; r, n: bind position and normal; K = (style 0 suit / 1 jacket / 2 shirt, gloves,
 * 0, 0); L0 = (neckY, chestY, waistY, 0); L1 = the left wrist. Writes the colour, the
 * roughness and the print's uv (−1: none).
 */
export const RB_UNIFORM_GLSL = /* glsl */ `
vec3 rbUniform( float part, vec3 r, vec3 n, vec4 K, vec4 L0, vec3 L1, vec3 cTop, vec3 cTop2, vec3 cAcc, vec3 cBot, vec3 cShoe, vec3 cGlove, vec3 orig, float det, out float rough, out vec2 logoUv ) {
  float ax = abs( r.x );
  float style = K.x;
  float neckY = L0.x, chestY = L0.y, waistY = L0.z;
  logoUv = vec2( -1.0 );
  vec3 c = cTop;
  rough = style < 0.5 ? 0.6 : style < 1.5 ? 0.8 : 0.85;
  bool legs = part > 5.5 && part < 7.5;
  bool arms = part > 2.5 && part < 4.5;
  if ( part > 7.5 ) {
    // shoes / boots
    rough = 0.5;
    return cShoe * mix( 1.0, det, 0.7 );
  }
  if ( part > 4.5 && part < 5.5 ) {
    rough = 0.65;
    return K.y > 0.5 ? cGlove * mix( 1.0, det, 0.6 ) : orig;
  }
  if ( style < 0.5 ) {
    // race suit: side panels, a stripe along the top of the sleeves, collar, belt and cuffs in the accents
    float side = smoothstep( 0.6, 0.65, abs( n.x ) ) * ( arms ? 0.0 : 1.0 );
    c = mix( c, cTop2, side );
    if ( arms ) c = mix( c, cTop2, smoothstep( 0.55, 0.6, dot( n, normalize( vec3( sign( r.x ) * 0.6, 0.8, 0.0 ) ) ) ) );
    c = mix( c, cAcc, step( neckY - 0.012, r.y ) * ( arms ? 0.0 : 1.0 ) );
    c = mix( c, cAcc, ( 1.0 - smoothstep( 0.012, 0.018, abs( r.y - waistY + 0.03 ) ) ) * ( arms || legs ? 0.0 : 1.0 ) );
    if ( arms ) c = mix( c, cAcc, 1.0 - smoothstep( 0.05, 0.065, distance( vec3( ax, r.y, r.z ), L1 ) ) );
  } else {
    // crew jacket / team shirt over darker trousers
    float low = legs || ( !arms && r.y < waistY - 0.05 ) ? 1.0 : 0.0;
    c = mix( c, cBot, low );
    c = mix( c, cTop2, ( 1.0 - low ) * step( neckY - 0.03, r.y ) * ( arms ? 0.0 : 1.0 ) );
    if ( style < 1.5 ) {
      if ( arms ) c = mix( c, cAcc, 1.0 - smoothstep( 0.06, 0.075, distance( vec3( ax, r.y, r.z ), L1 ) ) );
      c = mix( c, cTop2, ( 1.0 - low ) * smoothstep( 0.6, 0.8, abs( n.x ) ) * ( arms ? 0.0 : 1.0 ) );
    }
    rough = mix( rough, 0.82, low );
  }
  // chest and back print
  if ( !arms && !legs && r.y > waistY ) {
    vec2 f = vec2( r.x / 0.3 + 0.5, ( r.y - ( chestY - 0.1 ) ) / 0.15 );
    vec2 b = vec2( -r.x / 0.34 + 0.5, ( r.y - ( chestY - 0.13 ) ) / 0.19 );
    if ( r.z > 0.02 && n.z > 0.25 && f.x > 0.0 && f.x < 1.0 && f.y > 0.0 && f.y < 1.0 ) logoUv = vec2( f.x * 0.5, 1.0 - f.y );
    if ( r.z < -0.02 && n.z < -0.25 && b.x > 0.0 && b.x < 1.0 && b.y > 0.0 && b.y < 1.0 ) logoUv = vec2( 0.5 + b.x * 0.5, 1.0 - b.y );
  }
  return c * mix( 1.0, det, 0.65 );
}
`;

const MODE = { native: 0, tint: 1, uniform: 2 };

function uniformStyle(look: Look): number {
  return look.top === 'suit' ? 0 : look.top === 'jacket' ? 1 : 2;
}

/** the skin + clothes material for one person */
export function bodyMaterial(asset: BodyAsset, look: Look): THREE.MeshPhysicalMaterial {
  const uni = look.top === 'suit' || look.top === 'jacket' || look.top === 'polo';
  const tint = !uni && (look.tint ?? 0) > 0 ? look.tint! : 0;
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'person-body',
    map: asset.body.map,
    normalMap: asset.body.normal,
    roughness: 1,
    metalness: 0,
    ior: 1.4,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(1, 1, 1),
  });
  const lm = asset.lm;
  const shirt = asset.body.meta.shirt;
  const u = {
    uHeadMap: { value: asset.head.map },
    uHeadN: { value: asset.head.normal },
    uMask: { value: asset.body.mask },
    uLogo: { value: look.logo ?? blankLogo() },
    uMode: { value: uni ? MODE.uniform : tint > 0 ? MODE.tint : MODE.native },
    uTint: { value: tint },
    // (the crew body wears work gloves: they are always dyed, dark if the look has none)
    uK: { value: new THREE.Vector4(uniformStyle(look), look.gloves || (uni && asset.body.meta.name === ROSTER.crew) ? 1 : 0, 0, 0) },
    uL0: { value: new THREE.Vector4(lm.neckY, lm.chestY, lm.waistY, 0) },
    uL1: { value: lm.pos.hand_l.clone() },
    uTopC: { value: new THREE.Color(look.topColor) },
    uTop2C: { value: new THREE.Color(look.top2 ?? look.topColor) },
    uAccC: { value: new THREE.Color(look.accent ?? look.top2 ?? look.topColor) },
    uBotC: { value: new THREE.Color(look.bottomColor) },
    uShoeC: { value: new THREE.Color(look.shoeColor ?? 0x18181a) },
    uGloveC: { value: new THREE.Color(look.gloves ?? 0x2a2b2e) },
    uShirtMean: { value: new THREE.Color(shirt[0], shirt[1], shirt[2]) },
    uSkinRef: { value: asset.skinRef },
  };
  mat.userData.cloth = u;
  const maskMode = { value: 0 };
  mat.userData.maskMode = maskMode;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uMaskMode: maskMode });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPart;
varying vec3 vRest; varying vec3 vRestN; varying float vPart;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = position; vRestN = normal; vPart = aPart;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uHeadMap; uniform sampler2D uHeadN; uniform sampler2D uMask; uniform sampler2D uLogo;
uniform float uMode; uniform float uTint; uniform float uMaskMode;
uniform vec4 uK; uniform vec4 uL0; uniform vec3 uL1;
uniform vec3 uTopC; uniform vec3 uTop2C; uniform vec3 uAccC; uniform vec3 uBotC; uniform vec3 uShoeC; uniform vec3 uGloveC;
uniform vec3 uShirtMean; uniform vec3 uSkinRef;
varying vec3 vRest; varying vec3 vRestN; varying float vPart;
float gCloth; float gRough; float gSheen; float gShirt; vec4 gNS; float gNScale;
${LIGHT_GLOBALS}
${NOISE_GLSL}
${RB_SURFACE_GLSL}
${RB_UNIFORM_GLSL}`)
      .replace('#include <lights_physical_pars_fragment>', peopleLightsChunk())
      .replace('#include <map_fragment>', `
{
  vec2 uv = vMapUv;
  vec4 a = rbBase( map, uHeadMap, uv );
  vec4 ns = rbBase( normalMap, uHeadN, uv );
  gNS = ns;
  bool bodyHalf = uv.x < 0.5;
  float cloth = bodyHalf ? texture2D( uMask, uv ).r : 0.0;
  float part = floor( vPart + 0.5 );
  vec3 col = a.rgb;
  float det = bodyHalf ? rbDetail( map, uv, a.rgb ) : 1.0;
  gRough = mix( 0.88, 0.5, ns.b );
  gShirt = 0.0;
  gSheen = 0.3;
  gNScale = 1.0;
  // a uniform closes over the head's chest and the base of the neck (the head's own V is skin or its own shirt)
  bool chest = !bodyHalf && part > 0.5 && vRest.y < uL0.x + ( uK.x < 0.5 ? 0.03 : -0.015 );
  if ( uMode > 1.5 && chest ) { cloth = 1.0; det = 1.0; }
  // a race suit covers everything but the hands and feet (the crew body is clothed all over: its shirt collar too)
  if ( uMode > 1.5 && uK.x < 0.5 && bodyHalf && part > 0.5 && part < 7.5 && ( part < 4.5 || part > 5.5 ) ) cloth = 1.0;
  // gloves: the work gloves (or bare hands) dyed
  if ( uMode > 1.5 && bodyHalf && part > 4.5 && part < 5.5 && uK.y > 0.5 ) cloth = 1.0;
  if ( uMode > 1.5 && uK.x < 0.5 && ( bodyHalf || chest ) ) {
    // a race suit is smooth: only the big folds of the uniform underneath survive (no lapels, pockets, buttons)
    vec3 m3 = texture2D( map, uv, 3.0 ).rgb, m6 = texture2D( map, uv, 6.5 ).rgb;
    det = bodyHalf ? clamp( ( dot( m3, RB_LUM ) + 0.004 ) / ( dot( m6, RB_LUM ) + 0.004 ), 0.82, 1.12 ) : 1.0;
    gNScale = mix( 1.0, 0.3, cloth );
  }
  if ( uMode > 1.5 && ( bodyHalf || chest ) && ( cloth > 0.02 || part > 7.5 ) ) {
    float rr; vec2 lu;
    vec3 u = rbUniform( part, vRest, normalize( vRestN ), uK, uL0, uL1, uTopC, uTop2C, uAccC, uBotC, uShoeC, uGloveC, a.rgb, det, rr, lu );
    if ( lu.x >= 0.0 ) { vec4 lg = texture2D( uLogo, lu ); u = mix( u, lg.rgb, lg.a ); }
    float k = part > 7.5 ? max( cloth, 0.6 ) : cloth;
    col = mix( col, min( u, vec3( ${CLOTH_WHITE_MAX.toFixed(2)} ) ), k );
    gRough = mix( gRough, rr, k );
    gShirt = k * step( 0.5, part ) * step( part, 4.5 );
  } else if ( uMode > 0.5 && bodyHalf ) {
    // a fan's shirt dyed toward their team: the new colour at the old one's relative brightness
    float shirt = cloth * step( 0.5, part ) * step( part, 4.5 ) * step( uL0.z - 0.08, vRest.y );
    float rel = clamp( ( dot( a.rgb, RB_LUM ) + 0.01 ) / ( dot( uShirtMean, RB_LUM ) + 0.01 ), 0.35, 1.6 );
    vec3 dyed = min( uTopC * mix( 1.0, rel, 0.55 ), vec3( ${CLOTH_WHITE_MAX.toFixed(2)} ) );
    col = mix( col, dyed, shirt * uTint );
    gShirt = shirt;
  }
  gCloth = cloth;
  // real white fabric reflects ~70 % (a texture white of 1.0 blooms like a lamp): cap the cloth, soften its sheen on light colours
  float wl = dot( col, RB_LUM );
  col = mix( col, col * min( 1.0, ${CLOTH_WHITE_MAX.toFixed(2)} * 0.86 / max( wl, 1e-3 ) ), cloth );
  gSheen = cloth * mix( 0.45, 0.15, smoothstep( 0.4, 0.75, wl ) );
  diffuseColor.rgb *= col;
  gSkin = ( 1.0 - cloth ) * clamp( rbSkinLike( a.rgb, uSkinRef ), 0.0, 1.0 );
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec3 mapN = vec3( ( gNS.xy * 2.0 - 1.0 ) * gNScale, 0.0 );
mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );`))
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.sheenColor = ( diffuseColor.rgb * 0.6 + 0.05 ) * gSheen;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if ( uMaskMode > 0.5 ) gl_FragColor = vec4( vec3( step( 0.5, gShirt ) ), 1.0 );`);
  };
  mat.customProgramCacheKey = () => 'apex-rb-person-v1';
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

// ------------------------------------------------------------------------------------ hair
/**
 * The hair cards (and lashes, brows): alpha-tested, both sides, a strand highlight
 * (Kajiya-Kay along the texture's u, the direction the strands are painted). `soft` is the
 * second pass: only the thin ends, blended over the opaque core (no sorting problems:
 * the core has written its depth).
 */
export function hairMaterial(asset: BodyAsset, soft = false, tuck?: ReturnType<typeof capTuckUniforms>): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: asset.head.hairMap,
    roughness: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: soft ? 0.02 : 0.5,
    transparent: soft,
    depthWrite: !soft,
    name: soft ? 'person-hair-soft' : 'person-hair',
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, tuck ?? {});
    if (tuck) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
${TUCK_GLSL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = tuckHair( transformed, 1.0 );`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${LIGHT_GLOBALS}`)
      .replace('#include <lights_physical_pars_fragment>', peopleLightsChunk())
      .replace('#include <alphatest_fragment>', soft ? `if ( diffuseColor.a >= 0.5 || diffuseColor.a < 0.03 ) discard;` : '#include <alphatest_fragment>')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // the strand direction: where u grows on screen
  vec3 q0 = dFdx( - vViewPosition ), q1 = dFdy( - vViewPosition );
  vec2 s0 = dFdx( vMapUv ), s1 = dFdy( vMapUv );
  vec3 T = q0 * s1.y - q1 * s0.y;
  T = T - normal * dot( T, normal );
  gHairT = dot( T, T ) > 1e-12 ? normalize( T ) : vec3( 0.0, 1.0, 0.0 );
  gHair = 1.0;
  gHairTint = diffuseColor.rgb * 1.3;
  gHairShift = 0.0;
}`);
  };
  m.customProgramCacheKey = () => `apex-rb-hair-v1${soft ? '-soft' : ''}${tuck ? '-tuck' : ''}`;
  return m;
}

function hairDepthMaterial(map: THREE.Texture | null): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
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
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * 512, Math.random() * 128, 2, 1);
  }
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
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.arc(x + 512 / 12, 44, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 512, 6);
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
  const frontY = eyeY + 0.036, backY = eyeY - 0.012;
  const pts: THREE.Vector3[] = [];
  let zMin = Infinity, zMax = -Infinity, ax = 0;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    if (y < eyeY + 0.035 || Math.abs(x - c.x) > 0.11) continue;
    pts.push(new THREE.Vector3(x, y, z));
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    ax = Math.max(ax, Math.abs(x - c.x));
  }
  const cz = (zMin + zMax) / 2;
  const rimY = (frontY + backY) / 2;
  let az = (zMax - zMin) / 2;
  const slope = (frontY - backY) / (2 * az);
  let ay = top - rimY;
  let worst = 0;
  for (const p of pts) {
    const h0 = THREE.MathUtils.clamp((p.y - rimY) / ay, 0, 1);
    const lx = (p.x - c.x) / ax, lz = (p.z - cz) / az, ly = (p.y - rimY - slope * (p.z - cz) * (1 - h0 * h0)) / ay;
    if (ly < 0) continue;
    worst = Math.max(worst, lx * lx + ly * ly + lz * lz);
  }
  const s = THREE.MathUtils.clamp(Math.sqrt(worst), 1, 1.08);
  ax = ax * s + 0.007;
  ay = ay * s * 0.88 + 0.008;
  az = az * s + 0.008;
  const NU = low ? 24 : 48, NV = low ? 6 : 12;
  const P: number[] = [], UV: number[] = [], C: number[] = [], I: number[] = [];
  const dome = (th: number, ph: number, o = 0) => {
    const sp = Math.sin(ph), cp = Math.cos(ph);
    const fr = 1 + 0.05 * Math.max(0, Math.cos(th)) * sp;
    const x = (ax + o) * sp * Math.sin(th);
    const z = (az + o) * sp * Math.cos(th) * fr;
    const y = (ay + o) * (1 + 0.04 * Math.max(0, Math.cos(th))) * Math.pow(cp, 0.9) + 0.008 * Math.pow(Math.sin(th), 2) * Math.pow(sp, 4);
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
    q.y -= 0.45 * d * Math.pow(th / thB, 2) + 0.08 * d + (0.1 * d * d) / 0.08;
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
  const btn = new THREE.SphereGeometry(0.008, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  btn.scale(1, 0.5, 1);
  const tp = dome(0, 0);
  btn.translate(tp.x, tp.y - 0.001, tp.z);
  const bn = btn.getAttribute('position').count;
  btn.setAttribute('color', new THREE.Float32BufferAttribute(new Array(bn * 3).fill(1), 3));
  btn.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bn * 2).fill(0.01), 2));
  const out = mergeKeep([g, btn]);
  out.userData.capFit = { center: new THREE.Vector3(c.x, rimY, cz), radii: new THREE.Vector3(ax, ay, az), slope };
  return out;
}

/** GLSL: keep hair inside a cap's dome (uCapC = centre + on/off, uCapR = radii + tilt) */
export const TUCK_GLSL = /* glsl */ `
uniform vec4 uCapC; uniform vec4 uCapR; uniform vec4 uSkC; uniform vec4 uSkR;
vec3 tuckHair( vec3 p, float on ) {
  if ( on < 0.5 ) return p;
  // under a cap the hair's volume is pressed flat against the head (above the ears; long hair still hangs below)
  vec3 s = p - uSkC.xyz;
  float es = length( s / uSkR.xyz );
  float k = smoothstep( uSkC.w - 0.03, uSkC.w + 0.01, p.y );
  if ( es > 1.0 ) p = mix( p, uSkC.xyz + s / es, k );
  // and inside the crown
  vec3 d = p - uCapC.xyz;
  float above = smoothstep( -0.03, 0.0, d.y - uCapR.w * d.z );
  vec3 R = uCapR.xyz - vec3( 0.012, 0.01, 0.012 );
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
  const lm = asset.lm;
  // the head's own ellipsoid (a little out, for the scalp's hair), from the ears up
  const ear = lm.ear ?? new THREE.Vector3(lm.skullR.x, lm.headY + 0.08, lm.skull.z);
  return {
    uCapC: { value: new THREE.Vector4(fit.center.x, fit.center.y, fit.center.z, 1) },
    uCapR: { value: new THREE.Vector4(fit.radii.x, fit.radii.y, fit.radii.z, fit.slope) },
    uSkC: { value: new THREE.Vector4(lm.skull.x, lm.skull.y, lm.skull.z, ear.y) },
    uSkR: { value: new THREE.Vector4(Math.min(lm.skullR.x, ear.x) + 0.012, lm.skullR.y + 0.01, lm.skullR.z + 0.008, 0) },
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
  const ear = lm.ear ?? new THREE.Vector3(lm.skullR.x, (lm.eye?.y ?? lm.headY + 0.1) - 0.02, lm.skull.z);
  // cups over the ears, the band over the crown pressing the hair
  const cx = ear.x + 0.018;
  const top = lm.headTop + 0.012;
  const cy = ear.y + 0.005, cz = ear.z;
  const rise = top - cy;
  const band = new THREE.TorusGeometry(1, 0.009 / cx, 6, 24, Math.PI);
  band.scale(cx, rise, cx);
  band.translate(lm.skull.x, cy, cz);
  const parts: THREE.BufferGeometry[] = [band];
  for (const s of [-1, 1]) {
    const cup = new THREE.CylinderGeometry(0.036, 0.038, 0.03, 18);
    cup.rotateZ(Math.PI / 2);
    cup.translate(lm.skull.x + s * cx, cy, cz);
    parts.push(cup);
  }
  // the boom from the left cup along the cheek to the mouth
  const mouth = new THREE.Vector3(lm.skull.x + 0.03, (lm.eye?.y ?? cy) - 0.085, (lm.eye?.z ?? cz + 0.09) + 0.015);
  const from = new THREE.Vector3(lm.skull.x - cx, cy - 0.01, cz + 0.01);
  const len = from.distanceTo(mouth);
  const mic = new THREE.CylinderGeometry(0.0035, 0.0035, len, 6);
  mic.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), mouth.clone().sub(from).normalize()));
  mic.translate((from.x + mouth.x) / 2, (from.y + mouth.y) / 2, (from.z + mouth.z) / 2);
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

// ------------------------------------------------------------------------------------ clips
/** per body, the clips with the root track put on that body's rest position (scaled to its hip height) */
const bodyClips = new WeakMap<RbAvatar, Map<THREE.AnimationClip, THREE.AnimationClip>>();
function clipFor(asset: BodyAsset, clip: THREE.AnimationClip): THREE.AnimationClip {
  let m = bodyClips.get(asset.body);
  if (!m) bodyClips.set(asset.body, (m = new Map()));
  let c = m.get(clip);
  if (!c) {
    const rest = asset.rootRest;
    const k = rest.y / 0.9;
    const tracks = clip.tracks.map((t) => {
      if (t.name !== 'Bip01.position') return t;
      const v = t.values.slice();
      for (let i = 0; i < v.length; i += 3) {
        v[i] = rest.x + v[i] * k;
        v[i + 1] = rest.y + v[i + 1] * k;
        v[i + 2] = rest.z + v[i + 2] * k;
      }
      return new THREE.VectorKeyframeTrack(t.name, t.times, v);
    });
    m.set(clip, (c = new THREE.AnimationClip(clip.name, clip.duration, tracks)));
  }
  return c;
}

// ------------------------------------------------------------------------------------ a person
export class Person {
  readonly root: THREE.Group;
  readonly body: THREE.SkinnedMesh;
  readonly skeleton: THREE.Skeleton;
  /** bones by Biped name and by UE-mannequin name */
  readonly bones: Record<string, THREE.Bone> = {};
  readonly mixer: THREE.AnimationMixer;
  readonly asset: BodyAsset;
  /** idle life (breathing, small head movement, blinks) on top of the clip */
  lively = true;
  /** override how much of the clip's finger pose is kept (null: as animated) */
  handPose: number | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private readonly owned: THREE.Material[] = [];
  private readonly ownedGeo: THREE.BufferGeometry[] = [];
  private life = 0;
  private readonly seed: number;
  private readonly lifeAxes: Record<string, THREE.Vector3> = {};
  private readonly clips: Map<string, THREE.AnimationClip>;
  private blinkAt = 0;
  private readonly lids: [THREE.Bone, THREE.Quaternion][] = [];

  constructor(readonly kit: PeopleKit, readonly look: Look) {
    const { body, head } = resolveLook(kit, look);
    const asset = (this.asset = kit.asset(body, head));
    this.clips = asset.female ? kit.clipsF : kit.clips;
    this.root = new THREE.Group();
    this.root.name = 'person';
    const inner = new THREE.Group();
    const h = look.height ?? 1, b = look.build ?? 1;
    inner.scale.set(b * h, h, b * h);
    this.root.add(inner);
    // the skeleton, in its bind pose
    const B = asset.body;
    const bones = B.names.map((n, i) => {
      const bone = new THREE.Bone();
      bone.name = n;
      bone.position.copy(B.local[i].p);
      bone.quaternion.copy(B.local[i].q);
      return bone;
    });
    B.parents.forEach((p, i) => (p >= 0 ? bones[p].add(bones[i]) : inner.add(bones[i])));
    for (const bone of bones) this.bones[bone.name] = bone;
    for (const [ue, bip] of Object.entries(BONE_ALIAS)) if (this.bones[bip]) this.bones[ue] = this.bones[bip];
    this.skeleton = new THREE.Skeleton(bones, asset.boneInverses);
    const bodyMat = bodyMaterial(asset, look);
    this.owned.push(bodyMat);
    this.body = new THREE.SkinnedMesh(asset.geometry, bodyMat);
    this.body.name = 'person-body';
    inner.add(this.body);
    this.body.bind(this.skeleton, asset.bindMatrix);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false;
    const attach = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bind(this.skeleton, asset.bindMatrix);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      inner.add(m);
      return m;
    };
    // hair: an alpha-tested core and a soft pass for the ends
    const tuck = look.cap ? capTuckUniforms(asset) : undefined;
    if (asset.hair && asset.head.hairMap) {
      const core = hairMaterial(asset, false, tuck), soft = hairMaterial(asset, true, tuck);
      this.owned.push(core, soft);
      const hm = attach(asset.hair, core);
      hm.name = 'person-hair';
      const dm = hairDepthMaterial(asset.head.hairMap);
      this.owned.push(dm);
      hm.customDepthMaterial = dm;
      const sm = attach(asset.hair, soft, false);
      sm.name = 'person-hair-soft';
      sm.renderOrder = 2;
    }
    const headBone = asset.lm.joint.Head;
    if (look.cap) {
      const g = rigid(capGeometry(asset, look.capBack), headBone);
      this.ownedGeo.push(g);
      const m = capMaterial(kit, look.cap);
      this.owned.push(m);
      attach(g, m).name = 'person-cap';
    }
    if (look.headset) {
      const g = rigid(headsetGeometry(asset.lm), headBone);
      this.ownedGeo.push(g);
      const m = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.45, metalness: 0.3 });
      this.owned.push(m);
      attach(g, m).name = 'person-headset';
    }
    this.mixer = new THREE.AnimationMixer(inner);
    let hs = 0;
    for (const ch of JSON.stringify([look.tone, look.hairColor, look.topColor, look.height, look.female])) hs = (hs * 31 + ch.charCodeAt(0)) | 0;
    this.seed = (Math.abs(hs) % 1000) / 1000;
    // the axes the idle life turns about (the person's own left / up, in each bone's frame)
    inner.updateMatrixWorld(true);
    // the feet's height in the bind pose (standing): ground() keeps a crouch or a kneel down there
    this.feet = ['Bip01_L_Foot', 'Bip01_R_Foot', 'Bip01_L_Toe0', 'Bip01_R_Toe0'].map((n) => this.bones[n]).filter(Boolean);
    if (this.feet.length) this.restFoot = this.lowestFoot(inner) - inner.getWorldPosition(this.fv).y;
    const q = new THREE.Quaternion();
    for (const [name, axis] of [['spine_02', [1, 0, 0]], ['spine_03', [1, 0, 0]], ['neck_01', [0, 1, 0]], ['Head', [1, 0, 0]], ['HeadY', [0, 1, 0]], ['clavicle_l', [0, 0, 1]], ['clavicle_r', [0, 0, 1]]] as [string, number[]][]) {
      const bone = this.bones[name === 'HeadY' ? 'Head' : name];
      if (!bone) continue;
      bone.getWorldQuaternion(q).invert();
      this.lifeAxes[name] = new THREE.Vector3(axis[0], axis[1], axis[2]).applyQuaternion(q).normalize();
    }
    // upper lids (blinks turn them down about the person's left axis)
    for (const n of ['Bip01_LEyeBlinkTop', 'Bip01_REyeBlinkTop']) {
      const lb = this.bones[n];
      if (!lb) continue;
      lb.getWorldQuaternion(q).invert();
      this.lids.push([lb, lb.quaternion.clone()]);
      this.lifeAxes[n] = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
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

  /** the clip for a name (ours, the old UE names, or a Rocketbox clip), on this body */
  clip(name: string): THREE.AnimationClip | null {
    const c = this.clips.get(name) ?? this.clips.get(CLIP_ALIAS[name] ?? '');
    return c ? clipFor(this.asset, c) : null;
  }

  /** cross-fade to a clip */
  play(name: string, opts: { fade?: number; speed?: number; offset?: number; once?: boolean } = {}) {
    const clip = this.clip(name);
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
    this.ground();
    this.root.updateMatrixWorld(true);
  }

  /**
   * Keep the feet on the floor: the clips keep only rotations (and the hips' sway), so in a
   * crouch or a kneel the body would hang in the air at standing height. Whatever the pose,
   * the lowest foot is brought back down to where it stands in the bind pose (never lifted:
   * a jump stays a jump).
   */
  private feet: THREE.Bone[] | null = null;
  private restFoot = 0;
  private readonly fv = new THREE.Vector3();
  private ground() {
    const inner = this.body.parent!;
    if (!this.feet) return;
    if (!this.feet.length || /Jump|cheer3/.test(this.currentName)) {
      inner.position.y = 0;
      return;
    }
    inner.position.y = 0;
    inner.updateMatrixWorld(true);
    const lift = this.lowestFoot(inner) - inner.getWorldPosition(this.fv).y - this.restFoot;
    // (in the root's units: the root carries no scale; the inner group does)
    if (lift > 0.005) inner.position.y = -lift / Math.max(1e-3, this.root.getWorldScale(this.fv).y);
  }
  private lowestFoot(inner: THREE.Object3D): number {
    let lo = Infinity;
    void inner;
    for (const b of this.feet!) lo = Math.min(lo, b.getWorldPosition(this.fv).y);
    return lo;
  }

  /** (the clips' hands are natural; kept for the callers) */
  relaxHands(keep: number) {
    void keep;
  }

  private readonly lq = new THREE.Quaternion();
  private turnLocal(name: string, angle: number) {
    const b = this.bones[name === 'HeadY' ? 'Head' : name], ax = this.lifeAxes[name];
    if (!b || !ax || !angle) return;
    b.quaternion.multiply(this.lq.setFromAxisAngle(ax, angle));
  }

  private applyLife() {
    this.settle(this.life, 1, this.currentName);
    // blinks: every 2-6 s, a sixth of a second, now and then a double
    const t = this.life;
    if (t > this.blinkAt + 0.18) {
      const r = Math.abs(Math.sin(t * 12.9898 + this.seed * 78.233) * 43758.5453) % 1;
      this.blinkAt = t + (r < 0.15 ? 0.25 : 2 + r * 4);
    }
    const k = (t - this.blinkAt) / 0.16;
    const shut = k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
    for (const [lb, rest] of this.lids) {
      lb.quaternion.copy(rest);
      if (shut > 0) lb.quaternion.multiply(this.lq.setFromAxisAngle(this.lifeAxes[lb.name], shut * 0.55));
    }
  }

  /**
   * The life layer at time t over whatever pose the bones hold now (after the mixer):
   * breathing and a drifting gaze. update() calls it; the crowd bake calls it per frame.
   */
  settle(t: number, handKeep: number, clip: string) {
    void handKeep;
    void clip;
    const s = this.seed;
    const br = Math.sin(t * (1.5 + s * 0.3));
    this.turnLocal('spine_02', -0.006 * br);
    this.turnLocal('spine_03', -0.01 * br);
    const n1 = Math.sin(t * 0.37 + s * 9) * 0.6 + Math.sin(t * 0.83 + s * 3) * 0.4;
    const n2 = Math.sin(t * 0.29 + s * 5) * 0.6 + Math.sin(t * 0.71 + s * 7) * 0.4;
    const glance = Math.sin(t * 0.13 + s * 11);
    this.turnLocal('HeadY', 0.04 * n1 + 0.1 * Math.max(0, glance - 0.6) * Math.sign(Math.sin(s * 40)));
    this.turnLocal('Head', 0.025 * n2);
  }

  // ---------------------------------------------------------------- procedural posing (after the mixer)
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  /**
   * The Biped hangs the clavicles off the neck: turning the neck would swing the arms with
   * it. Whatever turns the neck turns the clavicles back by the same world rotation.
   */
  private keepShoulders(name: string, worldRot: THREE.Quaternion) {
    if (this.bones[name] !== this.bones.Bip01_Neck) return;
    const inv = this.q3.copy(worldRot).invert();
    for (const c of ['Bip01_L_Clavicle', 'Bip01_R_Clavicle']) {
      const b = this.bones[c];
      if (!b) continue;
      // child's world W = P·L; after the neck turned by R, W' = R·W: restore W with L' = P'⁻¹·R⁻¹·P'·L
      b.parent!.getWorldQuaternion(this.q1);
      const pInv = this.q1.clone().invert();
      b.quaternion.premultiply(pInv.multiply(inv).multiply(this.q1));
    }
  }

  /** rotate a bone by `angle` about a world-space axis (keeps its children attached) */
  rotateWorld(name: string, axis: THREE.Vector3, angle: number) {
    const b = this.bones[name];
    if (!b || !angle) return;
    b.parent!.getWorldQuaternion(this.q1);
    this.q2.setFromAxisAngle(axis, angle);
    const pInv = this.q1.clone().invert();
    const R = this.q2.clone();
    b.quaternion.premultiply(pInv.multiply(this.q2).multiply(this.q1));
    b.updateMatrixWorld(true);
    this.keepShoulders(name, R);
    if (b === this.bones.Bip01_Neck) b.updateMatrixWorld(true);
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
    const R = delta.clone();
    b.parent!.getWorldQuaternion(this.q1);
    const pInv = this.q1.clone().invert();
    b.quaternion.premultiply(pInv.multiply(delta).multiply(this.q1));
    b.updateMatrixWorld(true);
    this.keepShoulders(name, R);
    if (b === this.bones.Bip01_Neck) b.updateMatrixWorld(true);
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
    this.skeleton.dispose();
    this.root.removeFromParent();
  }
}

// ------------------------------------------------------------------------------------ looks
const HAIR_COLORS = [0x1a120d, 0x2b1d14, 0x3d2a1b, 0x5a3e27, 0x7a5a38, 0xb08850, 0xc9a26a, 0x6e2f1c, 0x8a8a88];

/** a random fan's look: gender, one of the fans' avatars, their shirt dyed toward a team's colours for most */
export function fanLook(rand: () => number, team: { primary: string; secondary: string; accent: string }): Look {
  const female = rand() < 0.42;
  const tone = Math.pow(rand(), 1.4);
  const kitColours = rand() < 0.62;
  const pool = female ? ROSTER.fansF : ROSTER.fansM;
  const body = pool[Math.floor(rand() * pool.length) % pool.length];
  const neutral = [0xe8e6e1, 0x202226, 0x2b3a55, 0x6b6f76, 0x3f5a3a, 0x7a2b2b, 0x9aa3ad, 0x1c2c4a][Math.floor(rand() * 8)];
  const hairColor = HAIR_COLORS[Math.floor(rand() * HAIR_COLORS.length)];
  return {
    female,
    tone,
    body,
    hair: 'none',
    hairColor,
    top: 'tshirt',
    topColor: kitColours ? team.primary : neutral,
    top2: kitColours ? team.secondary : neutral,
    accent: kitColours ? team.accent : neutral,
    tint: kitColours ? 0.85 + rand() * 0.15 : 0,
    bottom: 'jeans',
    bottomColor: 0x2d3f63,
    cap: rand() < 0.22 ? (kitColours ? team.primary : neutral) : null,
    capBack: rand() < 0.25,
    height: 0.95 + rand() * 0.08,
    build: 0.98 + rand() * 0.05,
  };
}
