import * as THREE from 'three';
import { MOVER } from './sun.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Person, loadPeople, setPeopleCore, setPeopleRest, type Look, type PeopleKit } from '../people/Humans.ts';
import { applyLF } from './lighting.ts';
import { BASE } from './world.ts';
import { F, WEAPONS, WEAPON_LIST, type WeaponId } from './shared.ts';
import type { Phys, Ragdoll } from './physics.ts';

const UP = new THREE.Vector3(0, 1, 0);

export interface Gun {
  group: THREE.Group;
  dot: THREE.Mesh | null;
  id: WeaponId;
  mag: THREE.Object3D | null;
  action: THREE.Object3D | null;
  actionRest: THREE.Vector3;
  magRest: THREE.Vector3;
}

const PARTS: Record<WeaponId, string[]> = {
  carbine: ['carbine', 'carbine_lens', 'carbine_mag'],
  shotgun: ['shotgun', 'shotgun_pump'],
  rifle: ['rifle', 'rifle_bolt', 'rifle_trigger', 'rifle_scope'],
  pistol: ['pistol', 'pistol_slide', 'pistol_mag', 'pistol_hammer', 'pistol_trigger'],
};
const MAG: Partial<Record<WeaponId, string>> = { carbine: 'carbine_mag', pistol: 'pistol_mag' };
const ACTION: Partial<Record<WeaponId, string>> = { shotgun: 'shotgun_pump', rifle: 'rifle_bolt', pistol: 'pistol_slide' };

let template: Map<string, THREE.Object3D> | null = null;

export async function loadGuns() {
  const g = await new GLTFLoader().loadAsync(BASE + 'guns.glb');
  template = new Map();
  const seen = new Set<THREE.Material>();
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = false;
      m.castShadow = false;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        // the made-up guns are baked without any surface: give them the fine grain of real finish (stippled
        // polymer, bead-blasted and parkerised steel), and the dull sheen of it rather than a plastic gloss
        const made = !mat.normalMap;
        applyLF(mat, { spec: made ? 0.3 : 0.38, view: 1 });
        mat.metalness *= made ? 0.5 : 0.7;
        mat.roughness *= made ? 1.6 : 1.1;
        if (made) mat.color.multiplyScalar(1.18);
        if (made) {
          mat.normalMap = grain();
          mat.normalScale.set(0.16, 0.16);
        }
        if (mat.map) mat.map.anisotropy = 8;
        worn(mat);
      }
    }
  });
  for (const c of g.scene.children) template.set(c.name, c);
}

/**
 * A gun that has been carried: the finish gone to bare metal along its edges and corners, scuffs and scratches along
 * its length, dust settled where nothing rubs. Laid over whatever the model came with.
 */
function worn(mat: THREE.MeshStandardMaterial) {
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey?.() ?? '';
  mat.onBeforeCompile = (s, r) => {
    prev?.call(mat, s, r);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGunP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGunP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGunP;
float gWear;
float gunH( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float gunN( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( gunH( i ), gunH( i + vec3( 1, 0, 0 ) ), f.x ), mix( gunH( i + vec3( 0, 1, 0 ) ), gunH( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( gunH( i + vec3( 0, 0, 1 ) ), gunH( i + vec3( 1, 0, 1 ) ), f.x ), mix( gunH( i + vec3( 0, 1, 1 ) ), gunH( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  // how sharply the surface turns here: an edge or a corner is where the finish goes first
  float turn = length( fwidth( normalize( vNormal ) ) ) / max( length( fwidth( vViewPosition ) ), 1e-5 );
  float edge = smoothstep( 45.0, 190.0, turn );
  float n1 = gunN( vGunP * 260.0 ), n2 = gunN( vGunP * vec3( 46.0, 46.0, 9.0 ) ), n3 = gunN( vGunP * vec3( 300.0, 300.0, 14.0 ) + 9.0 );
  float scuff = smoothstep( 0.66, 0.86, n2 ) * ( 0.35 + 0.65 * n1 ) * 0.55 + smoothstep( 0.9, 0.97, n3 ) * 0.5;
  gWear = clamp( edge * ( 0.35 + 0.65 * n1 ) + scuff, 0.0, 1.0 );
  float dust = smoothstep( 0.45, 0.8, gunN( vGunP * 21.0 + 4.0 ) ) * ( 1.0 - gWear ) * 0.22;
  diffuseColor.rgb = mix( diffuseColor.rgb * ( 0.85 + 0.3 * n1 ), vec3( 0.3, 0.3, 0.31 ), gWear * 0.6 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.15, 0.13 ), dust );
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.34, gWear * 0.8 );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.9, gWear * 0.7 );');
  };
  mat.customProgramCacheKey = () => key + 'worn';
}

/** a tiling height field of fine grain, as a normal map: a few octaves of value noise, wrapped */
let grainTex: THREE.Texture | null = null;
function grain() {
  if (grainTex) return grainTex;
  const N = 256;
  const h = new Float32Array(N * N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [cells, amp] of [[64, 0.55], [128, 0.35], [32, 0.25], [16, 0.12]] as const) {
    const g = new Float32Array(cells * cells).map(() => rnd());
    const k = N / cells;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const fx = x / k, fy = y / k;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => g[((j % cells) * cells + (i % cells))];
        const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
        h[y * N + x] += v * amp;
      }
  }
  const d = new Uint8Array(N * N * 4);
  const H = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const nx = (H(x - 1, y) - H(x + 1, y)) * 2.2, ny = (H(x, y - 1) - H(x, y + 1)) * 2.2;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return (grainTex = t);
}

export function buildGun(id: WeaponId): Gun {
  const group = new THREE.Group();
  let mag: THREE.Object3D | null = null, action: THREE.Object3D | null = null;
  for (const n of PARTS[id]) {
    const t = template!.get(n);
    if (!t) continue;
    const c = t.clone();
    group.add(c);
    if (n === MAG[id]) mag = c;
    if (n === ACTION[id]) action = c;
  }
  let dot: THREE.Mesh | null = null;
  if (id === 'carbine') {
    // the optic's glass and the dot it throws out in front
    group.traverse((o) => {
      if (/lens/.test(o.name) && (o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.material = new THREE.MeshBasicMaterial({ color: 0x1a2a2e, transparent: true, opacity: 0.08, depthWrite: false });
      }
    });
    dot = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(46, 2.2, 1.6), depthTest: false, depthWrite: false, transparent: true }));
    dot.position.set(0, 0.112, 1.15);
    dot.renderOrder = 12;
    dot.visible = false;
    group.add(dot);
  }
  return { group, id, dot, mag, action, actionRest: action?.position.clone() ?? new THREE.Vector3(), magRest: mag?.position.clone() ?? new THREE.Vector3() };
}

export function preparePeople(): Promise<PeopleKit> {
  setPeopleCore(['Gardener_Male_01', 'Male_Adult_07', 'Male_Adult_10', 'Male_Adult_12', 'Sports_Male_02', 'Sports_Male_01']);
  setPeopleRest(false);
  return loadPeople();
}

const FACES = ['Sports_Male_01', 'Sports_Male_02', 'Male_Adult_07', 'Male_Adult_10', 'Male_Adult_12'];
const CREW_TOP = ['#57513a', '#54402f', '#47403a', '#624b34', '#4a4e38'];

export function lookFor(team: number, slot: number): Look {
  const head = FACES[(slot + team * 2) % FACES.length];
  if (team === 0) {
    return { female: false, tone: 0.3, hair: 'buzzed', hairColor: '#1a1612', top: 'jacket', topColor: '#3a3e48', top2: '#32363f', accent: '#262a32', bottom: 'trousers', bottomColor: '#343842', shoeColor: '#1c1c20', gloves: '#26272c', body: 'Gardener_Male_01', head };
  }
  const c = CREW_TOP[slot % CREW_TOP.length];
  return { female: false, tone: 0.4, hair: 'buzzed', hairColor: '#1a1612', top: 'jacket', topColor: c, top2: c, accent: '#101010', bottom: 'trousers', bottomColor: '#34383f', shoeColor: '#24211d', gloves: '#2c2a24', body: 'Gardener_Male_01', head };
}

// ---- kit worn over the avatar: modelled to its measurements in gear.py, a part per bone
const WEAR: Record<string, string> = {
  helmet: 'Bip01_Head', glasses: 'Bip01_Head', beanie: 'Bip01_Head', hood: 'Bip01_Spine2', vest: 'Bip01_Spine2', rig: 'Bip01_Spine2', pack: 'Bip01_Spine2', satchel: 'Bip01_Spine2',
  belt: 'Bip01_Pelvis', holster: 'Bip01_R_Thigh', kneeL: 'Bip01_L_Calf', kneeR: 'Bip01_R_Calf',
};
const OUTFIT: string[][] = [
  ['helmet', 'glasses', 'vest', 'belt', 'holster', 'kneeL', 'kneeR'],
  ['helmet', 'glasses', 'vest', 'belt', 'holster', 'kneeL', 'kneeR', 'pack'],
  ['beanie', 'hood', 'rig', 'belt'],
  ['beanie', 'hood', 'rig', 'satchel', 'kneeL', 'kneeR'],
];
const parts = new Map<string, THREE.BufferGeometry>();
const outfits = new Map<number, THREE.BufferGeometry>();

export async function loadGear() {
  const g = await new GLTFLoader().loadAsync(BASE + 'gear.glb');
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && WEAR[m.name]) parts.set(m.name, m.geometry);
  });
}

/** one skinned mesh for a whole outfit: each part rides its bone */
function outfitGeometry(k: number, P: Person) {
  let g = outfits.get(k);
  if (g) return g;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [];
  for (const name of OUTFIT[k]) {
    const src = parts.get(name);
    if (!src) continue;
    const q = src.index ? src.toNonIndexed() : src;
    const joint = P.skeleton.bones.indexOf(P.bones[WEAR[name]]);
    const a = q.getAttribute('position'), n = q.getAttribute('normal'), u = q.getAttribute('uv'), c = q.getAttribute('color');
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      const v = name === 'glasses' ? 0.03 : c ? c.getX(i) : 1;
      col.push(v, v, v);
      si.push(joint, 0, 0, 0);
      sw.push(1, 0, 0, 0);
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  outfits.set(k, g);
  return g;
}

/** nylon: a tile of woven bumps, drawn once */
function weave() {
  const S = 128;
  const d = new Uint8Array(S * S * 4);
  const h = (x: number, y: number) => {
    const i = ((x % 8) + 8) % 8, j = ((y % 8) + 8) % 8;
    const over = (Math.floor(i / 4) + Math.floor(j / 4)) % 2 === 0;
    return over ? Math.sin(((i % 4) + 0.5) / 4 * Math.PI) : Math.sin(((j % 4) + 0.5) / 4 * Math.PI) * 0.7;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const o = (y * S + x) * 4;
    d[o] = 128 - dx * 90;
    d[o + 1] = 128 - dy * 90;
    d[o + 2] = 255;
    d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
const nylon = weave();
const GEAR_COLOR = [0x4a5264, 0x6e5e44];
const GEAR_NOISE = /* glsl */ `
float gearH( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float gearN( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( gearH( i ), gearH( i + vec3( 1, 0, 0 ) ), f.x ), mix( gearH( i + vec3( 0, 1, 0 ) ), gearH( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( gearH( i + vec3( 0, 0, 1 ) ), gearH( i + vec3( 1, 0, 1 ) ), f.x ), mix( gearH( i + vec3( 0, 1, 1 ) ), gearH( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`;
/** what's worn over the body, one material a soldier: it takes the blood of the wounds under it */
function gearMaterial(team: number, wounds: { value: THREE.Vector4[] }) {
  const m = new THREE.MeshStandardMaterial({ color: GEAR_COLOR[team] ?? GEAR_COLOR[0], roughness: 0.82, normalMap: nylon, vertexColors: true });
  m.normalScale.set(0.7, 0.7);
  m.userData.gear = true;
  m.onBeforeCompile = (s) => {
    s.uniforms.lfWound = wounds;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGearP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGearP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGearP;\nuniform vec4 lfWound[ 4 ];\nfloat gSoak;' + GEAR_NOISE)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  // nylon that has been worn for weeks: no bright new panels, the weave uneven, dust rubbed into it, darker in the seams
  float gn = gearN( vGearP * 16.0 ) * 0.55 + gearN( vGearP * 70.0 ) * 0.45;
  diffuseColor.rgb = min( diffuseColor.rgb, vec3( 0.13 ) ) * ( 0.6 + 0.6 * gn );
  float dust = smoothstep( 0.5, 0.85, gearN( vGearP * 8.0 + 4.0 ) ) * 0.4 + smoothstep( 0.6, 0.9, gearN( vGearP * 31.0 ) ) * 0.2;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.148, 0.128 ) * ( 0.7 + 0.5 * gn ), dust );
}
gSoak = 0.0;
for ( int wi = 0; wi < 4; wi++ ) {
  vec4 w = lfWound[ wi ];
  if ( w.w > 0.001 ) {
    // the nylon over a wound: a hole, and what comes up through the weave round it, further down than up
    vec3 dp = vGearP - w.xyz;
    dp.y *= dp.y > 0.0 ? 1.7 : 0.55;
    dp.z *= 0.45;
    float r = w.w * 1.25;
    float d = length( dp ) + ( gearN( vGearP * 48.0 ) - 0.5 ) * r * 0.7 + ( gearN( vGearP * 210.0 ) - 0.5 ) * 0.012;
    float soak = smoothstep( r, r * 0.5, d );
    float core = smoothstep( r * 0.42, r * 0.12, d );
    vec3 bc = mix( vec3( 0.075, 0.006, 0.006 ), vec3( 0.11, 0.003, 0.004 ), core );
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb * vec3( 0.5, 0.1, 0.09 ), bc, 0.6 + 0.3 * core ), soak * 0.94 );
    gSoak = max( gSoak, soak * ( 0.4 + 0.6 * core ) );
  }
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.22, gSoak );');
  };
  m.customProgramCacheKey = () => 'lfgear2';
  return applyLF(m, { person: true });
}

/** a body: walks, turns, holds a gun, falls */
export class Soldier {
  readonly person: Person;
  readonly root = new THREE.Group();
  readonly holder = new THREE.Group();
  readonly guns = new Map<WeaponId, Gun>();
  gun: Gun | null = null;
  weapon: WeaponId | null = null;
  /** first person: the gun is placed by the view, the head is gone */
  firstPerson = false;
  crouch = 0;
  aim = 0;
  lean = 0;
  kick = 0;
  /** 0 on the fore-end ... 1 down at the magazine */
  magHand = 0;
  /** first person: the support hand leaves the gun and goes up to the camera on the chest, 0 to 1, and where that is */
  camHand = 0;
  readonly camAt = new THREE.Vector3();
  /** seconds since death, -1 alive */
  dead = -1;
  private clip = '';
  private legYaw = 0;
  /** where the feet point, standing: they stay planted until the turn gets too far, then shuffle round */
  private feetYaw = 0;
  private turning = false;
  private turnPh = 0;
  private sprintK = 0;
  private rag: Ragdoll | null = null;
  private spin = 0;
  private gq = new THREE.Quaternion();
  private v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly head = new THREE.Vector3();
  private hitK = 0;
  private hitZone = 1;
  private hitDir = new THREE.Vector3();
  /** from inside, only the arms and legs are drawn */
  private fpHide = { value: 0 };
  /** where rounds went in, in the body's own rest pose, and how far each has soaked: the cloth takes it up and it spreads */
  private wounds = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };
  private woundTo = [0, 0, 0, 0];
  private woundI = 0;
  private face = 0;
  private marks: { neckY: number; chestY: number; waistY: number; wrist: THREE.Vector3 } | null = null;

  constructor(kit: PeopleKit, readonly team: number, slot: number) {
    this.person = new Person(kit, lookFor(team, slot));
    this.person.lively = true;
    this.root.add(this.person.root);
    this.root.add(this.holder);
    const gm = gearMaterial(team, this.wounds);
    const P0 = this.person;
    const worn = new THREE.SkinnedMesh(outfitGeometry(team * 2 + (slot % 2), P0), gm);
    worn.bind(P0.skeleton, P0.body.bindMatrix);
    worn.frustumCulled = false;
    worn.castShadow = true;
    worn.userData.gear = true;
    P0.body.parent!.add(worn);
    this.person.body.traverse((o) => (o.castShadow = true));
    // the recording light on the chest camera: a steady green LED, and the little bloom of it that carries across a dark room
    {
      const bone = P0.bones.Bip01_Spine2, bi = P0.skeleton.bones.indexOf(bone);
      const cy = (P0.body.material as THREE.MeshStandardMaterial).userData.cloth?.uL0?.value?.y ?? 1.32;
      if (bone && bi >= 0) {
        const inv = P0.skeleton.boneInverses[bi];
        const led = new THREE.Mesh(LED_GEO, LED_MAT);
        led.position.set(0.075, cy - 0.02, 0.185).applyMatrix4(inv);
        led.scale.setScalar(new THREE.Vector3().setFromMatrixColumn(inv, 0).length());
        const halo = new THREE.Sprite(LED_HALO);
        halo.scale.setScalar(0.26);
        led.add(halo);
        led.userData.gear = halo.userData.gear = true;
        bone.add(led);
        // and the battery light on the back of the rig, so they can be picked out from behind as well
        const back = led.clone(true);
        back.position.set(-0.05, cy + 0.0, -0.2).applyMatrix4(inv);
        back.traverse((o) => (o.userData.gear = true));
        bone.add(back);
      }
    }
    for (const o of this.root.children) o.traverse((m) => ((m as THREE.Mesh).isMesh && applyPeople((m as THREE.Mesh).material as THREE.MeshStandardMaterial)));
        const bm = this.person.body.material as THREE.MeshStandardMaterial;
    const before = bm.onBeforeCompile, key = bm.customProgramCacheKey();
    const hide = this.fpHide;
    const wounds = this.wounds;
    const cl = bm.userData.cloth as { uL0: { value: THREE.Vector4 }; uL1: { value: THREE.Vector3 } } | undefined;
    if (cl) this.marks = { neckY: cl.uL0.value.x, chestY: cl.uL0.value.y, waistY: cl.uL0.value.z, wrist: cl.uL1.value };
    const mask = { value: team === 0 ? new THREE.Vector4(0.015, 0.016, 0.02, 1) : new THREE.Vector4(0.07, 0.05, 0.035, 2) };
    bm.onBeforeCompile = (s, r) => {
      before.call(bm, s, r);
      s.uniforms.lfFP = hide;
      s.uniforms.lfMask = mask;
      s.uniforms.lfWound = wounds;
      s.fragmentShader = s.fragmentShader.replace('void main() {', 'uniform float lfFP;\nuniform vec4 lfMask;\nuniform vec4 lfWound[ 4 ];\nfloat gBump;\nvoid main() {\n  if ( lfFP > 0.5 ) {\n    // from inside, the trunk is gone, and each sleeve ends in a clean ring a hand below the shoulder\n    vec3 fra = vec3( abs( vRest.x ), vRest.y, vRest.z );\n    vec3 fax = normalize( vec3( abs( uL1.x ) - 0.18, uL1.y - ( uL0.x - 0.06 ), 0.0 ) );\n    float fcut = 0.08 + 0.16 * fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );\n    if ( vPart < 2.5 || ( vPart < 4.5 && dot( fra - vec3( 0.18, uL0.x - 0.06, 0.0 ), fax ) < fcut ) ) discard;\n  }');
      // the head's own mesh, dyed: a balaclava that fits because it is the face. An eye slot, or a scarf to the nose
      s.fragmentShader = s.fragmentShader.replace('diffuseColor.rgb *= col;', `if ( part < 0.5 ) {
    float slot = abs( vRest.y - 1.703 ) - 0.021;
    float cover = lfMask.w > 1.5 ? smoothstep( 0.0, 0.006, 1.662 - vRest.y ) : smoothstep( 0.0, 0.005, slot );
    col = mix( col, lfMask.rgb * ( 0.9 + 0.2 * apNoise( vRest * 300.0 ) ), cover );
    gCloth = max( gCloth, cover );
    cloth = max( cloth, cover );
  }
  gBump = 0.0;
  // gloves in the hand: worn leather, paler where it creases and rubs, a fine grain all over
  if ( part > 4.5 && part < 5.5 && uK.y > 0.5 ) {
    float gr = apNoise( vRest * 1100.0 ) * 0.6 + apNoise( vRest * 380.0 ) * 0.4;
    float crease = apNoise( vRest * 170.0 );
    float wear = smoothstep( 0.98, 1.16, det ) * 0.5 + apNoise( vRest * 55.0 ) * 0.25;
    col = col * ( 0.8 + 0.3 * gr ) * ( 0.85 + 0.3 * crease ) + vec3( 0.05, 0.045, 0.04 ) * wear;
    gRough = mix( 0.46, 0.8, gr ) + wear * 0.1;
    gBump = gr * 0.00035 + crease * 0.0012;
    gSheen = 0.0;
  } else if ( cloth > 0.5 && part > 0.5 && part < 7.5 ) {
    // cloth that has been worn and slept in: it rucks up in folds across a limb, darker down in them, and the weave
    // shows this close. (The avatar's own cloth is as smooth as a balloon.)
    vec3 ra = vec3( abs( vRest.x ), vRest.y, vRest.z );
    bool arm = part > 2.5 && part < 4.5;
    vec3 ax = arm ? normalize( vec3( abs( uL1.x ) - 0.18, uL1.y - ( uL0.x - 0.06 ), 0.0 ) ) : vec3( 0.0, 1.0, 0.0 );
    float along = dot( ra, ax );
    vec3 q = ra + ax * along * ( arm ? 2.6 : part > 5.5 ? 1.6 : 0.4 );
    float f1 = apNoise( q * 9.0 ), f2 = apNoise( q * 23.0 + 7.0 ), f3 = apNoise( q * 61.0 + 3.0 );
    float fold = f1 * 0.55 + f2 * 0.3 + f3 * 0.15;
    float fine = apNoise( vRest * 1400.0 ) * 0.5 + 0.5 * ( 0.5 + 0.5 * sin( ( vRest.x + vRest.y * 0.6 + vRest.z ) * 5200.0 ) );
    float seen = 1.0 / ( 1.0 + length( fwidth( vRest ) ) * 2600.0 );
    col *= ( 0.7 + 0.46 * fold ) * mix( 1.0, 0.86 + 0.28 * fine, seen );
    // dust and wear lighten what sticks out
    col += vec3( 0.02, 0.019, 0.017 ) * smoothstep( 0.55, 0.9, fold );
    // lived in: darker where it has been sweated through and leant on, plaster dust up the shins and on the knees and cuffs
    float grime = apNoise( vRest * 6.5 ) * 0.6 + apNoise( vRest * 17.0 + 3.0 ) * 0.4;
    col *= 0.74 + 0.4 * smoothstep( 0.25, 0.75, grime );
    float low = smoothstep( 0.62, 0.08, vRest.y ) * ( 0.35 + 0.65 * apNoise( vRest * 23.0 ) );
    float dusty = clamp( low * 0.55 + smoothstep( 0.6, 0.9, apNoise( vRest * 11.0 + 9.0 ) ) * 0.2, 0.0, 1.0 );
    col = mix( col, vec3( 0.2, 0.185, 0.16 ) * ( 0.7 + 0.5 * fine ), dusty * 0.6 );
    gBump = fold * 0.006 + fine * 0.00022 * seen;
    gRough = min( 1.0, gRough + 0.1 );
    gSheen *= 0.3;
  }
  // rounds that went in: a dark wet patch where each did, soaked out through the cloth and run down from it
  for ( int wi = 0; wi < 4; wi++ ) {
    vec4 w = lfWound[ wi ];
    if ( w.w > 0.001 ) {
      vec3 dp = vRest - w.xyz;
      dp.y *= dp.y > 0.0 ? 1.7 : 0.55;
      dp.z *= 0.5;
      float d = length( dp ) + ( apNoise( vRest * 48.0 ) - 0.5 ) * w.w * 0.7 + ( apNoise( vRest * 210.0 ) - 0.5 ) * 0.012;
      float soak = smoothstep( w.w, w.w * 0.5, d );
      float core = smoothstep( w.w * 0.42, w.w * 0.12, d );
      // cloth that has drunk it goes dark and a dull red; only the middle, still coming, is wet and bright
      vec3 bc = mix( vec3( 0.075, 0.006, 0.006 ), vec3( 0.11, 0.003, 0.004 ), core ) * ( 0.85 + 0.3 * apNoise( vRest * 300.0 ) );
      col = mix( col, mix( col * vec3( 0.5, 0.1, 0.09 ), bc, 0.6 + 0.3 * core ), soak * 0.94 );
      gRough = mix( gRough, mix( 0.5, 0.16, core ), soak );
      gSheen *= 1.0 - soak;
    }
  }
  diffuseColor.rgb *= col;`);
      // that height, onto the normal
      s.fragmentShader = s.fragmentShader.replace('#include <lights_physical_fragment>', `{
  vec3 bsx = dFdx( -vViewPosition ), bsy = dFdy( -vViewPosition );
  vec3 br1 = cross( bsy, normal ), br2 = cross( normal, bsx );
  float bdet = dot( bsx, br1 );
  vec3 bgrad = sign( bdet ) * ( dFdx( gBump ) * br1 + dFdy( gBump ) * br2 );
  normal = normalize( abs( bdet ) * normal - bgrad );
}
#include <lights_physical_fragment>`);
    };
    bm.customProgramCacheKey = () => key + 'fp8';
    this.person.play('idle');
    this.root.traverse((o) => o.layers.enable(MOVER));
  }

  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    this.fpHide.value = on ? 1 : 0;
    this.person.root.traverse((o) => {
      if (/hair/.test(o.name) || o.userData.gear) o.visible = !on;
      (o as THREE.Mesh).castShadow = !on;
    });
    this.person.bones.Head.scale.setScalar(on ? 0.001 : 1);
  }

  setWeapon(id: WeaponId) {
    if (id === this.weapon) return;
    if (this.gun) this.holder.remove(this.gun.group);
    this.weapon = id;
    let g = this.guns.get(id);
    if (!g) this.guns.set(id, (g = buildGun(id)));
    this.gun = g;
    this.holder.add(g.group);
  }

  /** a round went in: `dir` the way it was going, `k` how bad. It shows on the body, and spreads */
  wound(zone: number, dir: THREE.Vector3, k = 1) {
    const M = this.marks;
    if (!M) return;
    const r = () => Math.random() - 0.5;
    // from the front if it was coming at where they face
    const front = dir.x * Math.sin(this.face) + dir.z * Math.cos(this.face) < 0 ? 1 : -1;
    const side = Math.random() < 0.5 ? 1 : -1;
    const at = new THREE.Vector3();
    if (zone === 0) at.set(r() * 0.1, M.neckY + 0.11 + Math.random() * 0.1, front * 0.07);
    else if (zone === 2) at.set(0.19, M.neckY - 0.06, -0.02).lerp(new THREE.Vector3(Math.abs(M.wrist.x), M.wrist.y, M.wrist.z), 0.2 + Math.random() * 0.6).multiply(new THREE.Vector3(side, 1, 1));
    else if (zone === 4) at.set(side * (0.08 + Math.random() * 0.05), 0.32 + Math.random() * 0.5, front * 0.05);
    else at.set(r() * 0.26, M.waistY + 0.04 + Math.random() * (M.chestY - M.waistY + 0.08), front * 0.09);
    const put = (p: THREE.Vector3, to: number) => {
      const i = this.woundI;
      this.woundI = (i + 1) % 4;
      this.wounds.value[i].set(p.x, p.y, p.z, 0.012);
      this.woundTo[i] = to;
    };
    put(at, (0.045 + Math.random() * 0.03) * k);
    // and out the other side, larger, when it had the power to go through
    if (k > 1.2 && zone !== 2) put(at.clone().setZ(-at.z * 1.1), (0.07 + Math.random() * 0.04) * k);
  }

  revive() {
    this.dead = -1;
    for (const w of this.wounds.value) w.set(0, 0, 0, 0);
    this.rag?.dispose();
    this.rag = null;
    this.person.root.rotation.set(0, 0, 0);
    this.person.root.position.set(0, 0, 0);
    if (this.gun) this.gun.group.visible = true;
  }

  /** gone: `v` how it was moving, `dir` and `power` the round that did it */
  kill(ph: Phys, v: THREE.Vector3, zone: number, dir: THREE.Vector3, power: number) {
    if (this.dead >= 0) return;
    this.dead = 0;
    this.rag = ph.ragdoll(this.person, v, zone, dir, power);
    this.letGo(ph, v, dir);
  }

  /** the hands open: it goes its own way, and stays there for whoever wants it */
  letGo(ph: Phys, v: THREE.Vector3, dir: THREE.Vector3) {
    const g = this.gun;
    if (!g) return;
    g.group.updateMatrixWorld(true);
    const held = new THREE.Group();
    const c = g.group.clone();
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.visible = true;
    held.add(c);
    c.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(c);
    const mid = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    sz.x = Math.max(0.02, Math.min(sz.x, 0.05));
    this.root.parent?.add(held);
    const p = g.group.getWorldPosition(new THREE.Vector3()), q = g.group.getWorldQuaternion(new THREE.Quaternion());
    ph.drop(held, [sz.x, Math.max(0.03, sz.y * 0.7), sz.z], mid, p, q, v.clone().addScaledVector(dir, 0.7).add(new THREE.Vector3(0, 0.6, 0)), 5, 3.2, 45, 'metal', this.weapon ?? undefined);
    g.group.visible = false;
  }

  /** hit but standing: the body gives, and comes back */
  flinch(zone: number, dir: THREE.Vector3) {
    this.hitK = 1;
    this.hitZone = zone;
    this.hitDir.copy(dir);
  }

  /** place and pose. `flags` as in the packet; moveYaw world heading of travel; speed m/s */
  update(dt: number, x: number, y: number, z: number, yaw: number, pitch: number, lean: number, flags: number, speed: number, moveYaw: number) {
    const P = this.person;
    const crouched = (flags & F.crouch) !== 0;
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    this.aim += (((flags & F.ads) ? 1 : 0) - this.aim) * Math.min(1, dt * 11);
    this.lean += (lean - this.lean) * Math.min(1, dt * 10);
    this.kick = Math.max(0, this.kick - dt * 8);
    this.hitK = Math.max(0, this.hitK - dt * 4.2);
    if (!this.firstPerson) this.magHand += (((flags & F.reload) ? 1 : 0) - this.magHand) * Math.min(1, dt * 7);
    // facing: yaw 0 looks down -z; the avatar faces +z
    const face = yaw + Math.PI;
    this.face = face;
    for (let i = 0; i < 4; i++) {
      const w = this.wounds.value[i];
      if (w.w > 0 && w.w < this.woundTo[i]) w.w = Math.min(this.woundTo[i], w.w + dt * (0.004 + (this.woundTo[i] - w.w) * 0.35));
    }
    if (this.dead >= 0) {
      this.dead += dt;
      this.head.copy(this.rag?.head ?? this.head);
      return;
    }
    // ---- gait
    let clip = 'idle', rate = 1;
    const moving = speed > 0.3;
    // legs turn toward the travel; backward walks run the clip in reverse
    let rel = moving ? angleDiff(moveYaw, yaw) : 0;
    let back = 1;
    if (Math.abs(rel) > Math.PI * 0.6) {
      back = -1;
      rel = angleDiff(rel + Math.PI, 0);
    }
    if (moving || this.firstPerson) {
      this.legYaw += (THREE.MathUtils.clamp(rel, -1.2, 1.2) - this.legYaw) * Math.min(1, dt * 9);
      this.feetYaw = face + this.legYaw;
      this.turning = false;
    } else {
      const off = angleDiff(this.feetYaw, face);
      if (Math.abs(off) > 0.8) this.turning = true;
      if (this.turning) {
        this.feetYaw = face + off * Math.exp(-dt * 7);
        this.turnPh += dt * 13;
        if (Math.abs(off) < 0.06) this.turning = false;
      }
      this.legYaw = THREE.MathUtils.clamp(angleDiff(this.feetYaw, face), -1.2, 1.2);
    }
    this.sprintK += (((flags & F.sprint) ? 1 : 0) - this.sprintK) * Math.min(1, dt * 7);
    if (crouched) {
      clip = moving ? 'walk' : 'crouch';
      rate = Math.max(0.6, speed / 1.2) * back;
    } else if (speed > 4.3) {
      clip = 'run';
      rate = (speed / 5.6) * back;
    } else if (speed > 2.2) {
      clip = 'jog';
      rate = (speed / 3.2) * back;
    } else if (moving) {
      clip = 'walk';
      rate = Math.max(0.55, speed / 1.45) * back;
    }
    if (clip !== this.clip) {
      P.play(clip, { fade: 0.18 });
      this.clip = clip;
    }
    const act = (P as unknown as { current: THREE.AnimationAction | null }).current;
    if (act) act.timeScale = rate;
    // seen from inside, the body sits ahead of the eye so the arms can reach the gun
    const fpK = this.firstPerson ? 0.13 : 0;
    P.root.position.set(x + Math.sin(face) * fpK, y, z + Math.cos(face) * fpK);
    P.root.rotation.set(0, face + this.legYaw, 0);
    P.update(dt);
    // a crouched walk: same clip, bent down
    if (crouched && moving) P.root.position.y = y - 0.32 * this.crouch;
    if (this.firstPerson && crouched) P.root.position.y -= 0.02;
    P.root.updateMatrixWorld(true);
    const right = this.v[0].set(-Math.cos(face), 0, Math.sin(face));
    if (crouched && moving) {
      const k = this.crouch;
      P.rotateWorld('Bip01_L_Thigh', right, 0.95 * k);
      P.rotateWorld('Bip01_R_Thigh', right, 0.95 * k);
      P.rotateWorld('Bip01_L_Calf', right, -1.3 * k);
      P.rotateWorld('Bip01_R_Calf', right, -1.3 * k);
    }
    if (this.turning && !this.firstPerson) {
      // a step round: one foot lifts and comes down, then the other
      const l = Math.max(0, Math.sin(this.turnPh)), r = Math.max(0, -Math.sin(this.turnPh));
      const fr = this.v[6].set(-Math.cos(face + this.legYaw), 0, Math.sin(face + this.legYaw));
      P.rotateWorld('Bip01_L_Thigh', fr, 0.32 * l);
      P.rotateWorld('Bip01_L_Calf', fr, -0.55 * l);
      P.rotateWorld('Bip01_R_Thigh', fr, 0.32 * r);
      P.rotateWorld('Bip01_R_Calf', fr, -0.55 * r);
    }
    this.pose(face, pitch);
    P.root.updateMatrixWorld(true);
    P.worldOf('Bip01_Head', this.head);
  }

  private pose(face: number, pitch: number) {
    const P = this.person;
    const [right, fwd, dir, tmp] = this.v;
    const twist = -this.legYaw;
    // the spine takes the difference back so the shoulders still square up to the aim
    P.rotateWorld('Bip01_Spine1', UP, twist * 0.5);
    P.rotateWorld('Bip01_Spine2', UP, twist * 0.5);
    fwd.set(Math.sin(face), 0, Math.cos(face));
    right.set(-Math.cos(face), 0, Math.sin(face));
    const pk = -pitch;
    P.rotateWorld('Bip01_Spine1', right, pk * 0.3);
    P.rotateWorld('Bip01_Spine2', right, pk * 0.34);
    if (!this.firstPerson) P.rotateWorld('Bip01_Head', right, pk * 0.28);
    if (this.hitK > 0) {
      // the upper body takes it along the line of the shot
      const k = Math.sin(this.hitK * Math.PI * 0.5) ** 2;
      const axis = tmp.crossVectors(this.hitDir, UP).normalize();
      const zk = this.hitZone === 0 ? 0.28 : this.hitZone === 2 ? 0.1 : 0.2;
      P.rotateWorld('Bip01_Spine1', axis, -k * zk);
      P.rotateWorld('Bip01_Spine2', axis, -k * zk);
      if (this.hitZone === 0 && !this.firstPerson) P.rotateWorld('Bip01_Head', axis, -k * 0.5);
    }
    if (this.lean) {
      P.rotateWorld('Bip01_Spine', fwd, this.lean * 0.16);
      P.rotateWorld('Bip01_Spine1', fwd, this.lean * 0.16);
      P.rotateWorld('Bip01_Spine2', fwd, this.lean * 0.14);
    }
    if (!this.gun || !this.weapon) return;
    const spec = WEAPONS[this.weapon];
    const long = this.weapon !== 'pistol';
    const g = this.gun.group;
    if (!this.firstPerson) {
      // aim direction
      dir.copy(fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch)).normalize();
      const lowK = Math.max(1 - Math.min(1, this.aim + 0.55), this.sprintK);
      dir.addScaledVector(UP, -0.35 * lowK - 0.3 * this.sprintK).addScaledVector(right, -0.55 * this.sprintK).normalize();
      const sR = P.worldOf('Bip01_R_UpperArm', this.v[4]);
      const sL = P.worldOf('Bip01_L_UpperArm', this.v[5]);
      const grip = tmp;
      if (long) {
        grip.copy(sR).addScaledVector(dir, 0.2 - this.kick * 0.05).addScaledVector(UP, -0.09).addScaledVector(right, -0.05);
      } else {
        grip.copy(sR).add(sL).multiplyScalar(0.5).addScaledVector(dir, 0.42 - this.kick * 0.04).addScaledVector(UP, -0.06);
      }
      const gdir = new THREE.Vector3().copy(dir).addScaledVector(UP, this.kick * 0.2 + this.magHand * 0.4).addScaledVector(right, this.magHand * 0.3).normalize();
      const side = new THREE.Vector3().crossVectors(UP, gdir).normalize();
      const gup = new THREE.Vector3().crossVectors(gdir, side).normalize();
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, gup, gdir));
      g.position.copy(grip);
    }
    g.updateMatrixWorld(true);
    const gq = g.getWorldQuaternion(this.gq);
    const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(gq);
    // the wrists sit behind and outside what the fingers hold
    const palm = new THREE.Vector3(-0.038, -0.03, -0.05).applyMatrix4(g.matrixWorld);
    this.reach('R', palm, right, 1);
    this.hold('R', L(0.8, 0, 0.6).normalize(), L(0, -1, 0), 1);
    const su = spec.support;
    const pistol = this.weapon === 'pistol';
    const mh = this.magHand;
    const sup = new THREE.Vector3(su[0] + (pistol ? 0.05 : 0.04), su[1] - (pistol ? 0.03 : 0.052) - mh * 0.14, su[2] - 0.06 - mh * (su[2] - 0.08)).applyMatrix4(g.matrixWorld);
    const ch = this.firstPerson ? this.camHand : 0;
    if (ch > 0) sup.lerp(this.camAt, ch * ch * (3 - 2 * ch));
    this.reach('L', sup, new THREE.Vector3().copy(right).negate(), 1);
    // on the gun the fingers wrap the fore-end; at the camera they come up open, thumb under it
    const hf = L(-0.62, -0.08, 0.78).normalize(), hs = L(0, pistol ? -0.5 : 0, -1).normalize();
    if (ch > 0) {
      hf.lerp(new THREE.Vector3(0, 1, 0).addScaledVector(right, 0.5).normalize(), ch).normalize();
      hs.lerp(fwd, ch).normalize();
    }
    this.hold('L', hf, hs, (pistol ? 0.9 : 0.72) * (1 - ch * 0.45));
  }

  /** aim a hand along `f`, turn it so index-to-little-finger runs along `side`, close the fingers */
  private hold(s: 'L' | 'R', f: THREE.Vector3, side: THREE.Vector3, curl: number) {
    const P = this.person;
    const H = `Bip01_${s}_Hand`;
    if (!P.bones[`Bip01_${s}_Finger2`]) return;
    P.aim(H, `Bip01_${s}_Finger2`, f);
    const a = P.worldOf(`Bip01_${s}_Finger1`, new THREE.Vector3()), b = P.worldOf(`Bip01_${s}_Finger4`, new THREE.Vector3());
    const cur = b.sub(a);
    cur.addScaledVector(f, -cur.dot(f)).normalize();
    const want = side.clone().addScaledVector(f, -side.dot(f)).normalize();
    const ang = Math.atan2(new THREE.Vector3().crossVectors(cur, want).dot(f), cur.dot(want));
    P.rotateWorld(H, f, ang);
    const axis = want.clone().multiplyScalar(s === 'R' ? -1 : 1);
    for (let k = 1; k < 5; k++) {
      P.rotateWorld(`Bip01_${s}_Finger${k}`, axis, 0.95 * curl);
      P.rotateWorld(`Bip01_${s}_Finger${k}1`, axis, 0.95 * curl);
      P.rotateWorld(`Bip01_${s}_Finger${k}2`, axis, 0.6 * curl);
    }
  }

  private reach(s: 'L' | 'R', target: THREE.Vector3, out: THREE.Vector3, w: number) {
    const P = this.person;
    const ua = `Bip01_${s}_UpperArm`, fa = `Bip01_${s}_Forearm`, ha = `Bip01_${s}_Hand`;
    if (!P.bones[ua] || !P.bones[fa] || !P.bones[ha]) return;
    const S = P.worldOf(ua, new THREE.Vector3());
    const E0 = P.worldOf(fa, new THREE.Vector3());
    const H0 = P.worldOf(ha, new THREE.Vector3());
    const a = S.distanceTo(E0), b = E0.distanceTo(H0);
    const T = target.clone();
    if (w < 1) T.lerp(H0, 1 - w);
    const toT = T.clone().sub(S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dn = toT.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pole = out.clone().multiplyScalar(0.7).addScaledVector(UP, -1);
    pole.addScaledVector(dn, -pole.dot(dn)).normalize();
    const E = S.clone().addScaledVector(dn, a * cosA).addScaledVector(pole, a * sinA);
    P.aim(ua, fa, E.clone().sub(S));
    const E1 = P.worldOf(fa, new THREE.Vector3());
    P.aim(fa, ha, T.clone().sub(E1));
  }

  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return out.copy(this.head);
    return out.set(...WEAPONS[this.weapon!].muzzle).applyMatrix4(this.gun.group.matrixWorld);
  }

  dispose() {
    this.person.dispose();
    this.root.removeFromParent();
  }
}

const LED_GEO = new THREE.SphereGeometry(0.012, 8, 6);
const LED_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 1.5, 0.4), toneMapped: false });
LED_MAT.userData.gear = true;
const LED_HALO = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(120,255,160,1)');
  gr.addColorStop(0.25, 'rgba(40,220,90,0.35)');
  gr.addColorStop(1, 'rgba(20,160,60,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, color: new THREE.Color(0.9, 0.9, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
})();

const seenMat = new Set<THREE.Material>();
function applyPeople(m: THREE.MeshStandardMaterial) {
  if (!m || seenMat.has(m) || m.userData.gear) return;
  seenMat.add(m);
  applyLF(m, { person: true });
}

export function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export { WEAPON_LIST };
