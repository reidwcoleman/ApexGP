import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Person, loadPeople, setPeopleCore, setPeopleRest, type Look, type PeopleKit } from '../people/Humans.ts';
import { applyLF } from './lighting.ts';
import { BASE } from './world.ts';
import { F, WEAPONS, WEAPON_LIST, type WeaponId } from './shared.ts';
import type { World } from './collide.ts';

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
        applyLF(mat, { spec: 0.32 });
        mat.metalness *= 0.3;
        mat.roughness = 1.25;
        mat.color.multiplyScalar(0.62);
        if (mat.map) mat.map.anisotropy = 8;
      }
    }
  });
  for (const c of g.scene.children) template.set(c.name, c);
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
const CREW_TOP = ['#2c2a1c', '#2a1e16', '#1e1a18', '#33261a', '#232618'];

export function lookFor(team: number, slot: number): Look {
  const head = FACES[(slot + team * 2) % FACES.length];
  if (team === 0) {
    return { female: false, tone: 0.3, hair: 'buzzed', hairColor: '#1a1612', top: 'jacket', topColor: '#0d1422', top2: '#0a101c', accent: '#080c16', bottom: 'trousers', bottomColor: '#0b0f18', shoeColor: '#08080a', gloves: '#0b0c0e', body: 'Gardener_Male_01', head };
  }
  const c = CREW_TOP[slot % CREW_TOP.length];
  return { female: false, tone: 0.4, hair: 'buzzed', hairColor: '#1a1612', top: 'jacket', topColor: c, top2: c, accent: '#101010', bottom: 'trousers', bottomColor: '#14161a', shoeColor: '#0e0d0c', gloves: '#141310', body: 'Gardener_Male_01', head };
}

// ---- kit worn over the avatar: built once per team in bind space
function vest(p: Person, team: number) {
  const lm = p.asset.lm;
  const yTop = lm.chestY + 0.09, yBot = lm.waistY - 0.02;
  const cy = (yTop + yBot) / 2, h = yTop - yBot;
  const body = lm.pos.spine_03 ?? new THREE.Vector3(0, cy, 0);
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, hh: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, hh, d, 2, 2, 2);
    g.translate(x, y, z);
    parts.push(g);
  };
  const z0 = body.z;
  add(0.3, h, 0.05, 0, cy, z0 + 0.128);    // front plate
  add(0.3, h, 0.05, 0, cy, z0 - 0.125);    // back plate
  add(0.05, h * 0.62, 0.24, 0.165, cy - h * 0.14, z0); // cummerbund
  add(0.05, h * 0.62, 0.24, -0.165, cy - h * 0.14, z0);
  for (const x of [-0.1, 0, 0.1]) add(0.082, 0.14, 0.045, x, yBot + 0.075, z0 + 0.168);   // mag pouches
  add(0.06, 0.1, 0.04, 0.09, yTop - 0.08, z0 + 0.166);                                   // radio
  add(0.065, 0.085, 0.03, -0.075, yTop - 0.09, z0 + 0.166);                              // a camera on the chest
  for (const x of [-0.11, 0.11]) add(0.05, 0.02, 0.26, x, yTop + 0.03, z0);              // shoulder straps
  return merge(parts);
}

function helmet(p: Person) {
  const lm = p.asset.lm;
  const s = lm.skull, r = lm.skullR;
  const g = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
  g.scale(r.x * 1.24, r.y * 1.06, r.z * 1.24);
  g.translate(s.x, s.y + r.y * 0.16, s.z - 0.006);
  return g;
}

function hood(p: Person) {
  const lm = p.asset.lm;
  const s = lm.skull, r = lm.skullR;
  const g = new THREE.SphereGeometry(1, 18, 12);
  g.scale(r.x * 1.08, r.y * 1.14, r.z * 1.12);
  g.translate(s.x, s.y - r.y * 0.02, s.z);
  return g;
}

function merge(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const a = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += a.count;
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  o.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  o.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  o.setIndex(idx);
  return o;
}

const gearMat = [
  applyLF(new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.82 })),
  applyLF(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.9 })),
];

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
  /** seconds since death, -1 alive */
  dead = -1;
  private clip = '';
  private legYaw = 0;
  private rag: Rag | null = null;
  private gq = new THREE.Quaternion();
  private v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly head = new THREE.Vector3();
  /** from inside, only the arms and legs are drawn */
  private fpHide = { value: 0 };

  constructor(kit: PeopleKit, readonly team: number, slot: number) {
    this.person = new Person(kit, lookFor(team, slot));
    this.person.lively = true;
    this.root.add(this.person.root);
    this.root.add(this.holder);
    const gm = gearMat[team] ?? gearMat[0];
    if (team === 0) {
      this.person.attachProp(vest(this.person, team), 'spine_03', gm, true).userData.gear = true;
      this.person.attachProp(helmet(this.person), 'Head', gm, true).userData.gear = true;
    } else {
      this.person.attachProp(hood(this.person), 'Head', gm, true).userData.gear = true;
    }
    this.person.body.traverse((o) => (o.castShadow = true));
    for (const o of this.root.children) o.traverse((m) => ((m as THREE.Mesh).isMesh && applyPeople((m as THREE.Mesh).material as THREE.MeshStandardMaterial)));
    (this.person.body.material as THREE.MeshStandardMaterial).color.setScalar(0.72);
    const bm = this.person.body.material as THREE.MeshStandardMaterial;
    const before = bm.onBeforeCompile, key = bm.customProgramCacheKey();
    const hide = this.fpHide;
    bm.onBeforeCompile = (s, r) => {
      before.call(bm, s, r);
      s.uniforms.lfFP = hide;
      s.fragmentShader = s.fragmentShader.replace('void main() {', 'uniform float lfFP;\nvoid main() {\n  if ( lfFP > 0.5 && vPart < 2.5 ) discard;');
    };
    bm.customProgramCacheKey = () => key + 'fp';
    this.person.play('idle');
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

  revive() {
    this.dead = -1;
    this.rag = null;
    this.person.root.rotation.set(0, 0, 0);
    this.person.root.position.set(0, 0, 0);
    if (this.gun) this.gun.group.visible = true;
  }

  kill(dir: THREE.Vector3) {
    if (this.dead >= 0) return;
    this.dead = 0;
    this.rag = new Rag(this.person, dir);
    if (this.gun) this.gun.group.visible = false;
  }

  /** place and pose. `flags` as in the packet; moveYaw world heading of travel; speed m/s */
  update(dt: number, x: number, y: number, z: number, yaw: number, pitch: number, lean: number, flags: number, speed: number, moveYaw: number) {
    const P = this.person;
    const crouched = (flags & F.crouch) !== 0;
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    this.aim += (((flags & F.ads) ? 1 : 0) - this.aim) * Math.min(1, dt * 11);
    this.lean += (lean - this.lean) * Math.min(1, dt * 10);
    this.kick = Math.max(0, this.kick - dt * 8);
    // facing: yaw 0 looks down -z; the avatar faces +z
    const face = yaw + Math.PI;
    if (this.dead >= 0) {
      this.dead += dt;
      if (this.dead < 3.2) this.rag?.step(dt, P);
      this.head.copy(this.rag?.headAt ?? this.head);
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
    this.legYaw += (THREE.MathUtils.clamp(rel, -1.2, 1.2) - this.legYaw) * Math.min(1, dt * 9);
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
      const lowK = 1 - Math.min(1, this.aim + 0.55);
      dir.addScaledVector(UP, -0.35 * lowK).normalize();
      const sR = P.worldOf('Bip01_R_UpperArm', this.v[4]);
      const sL = P.worldOf('Bip01_L_UpperArm', this.v[5]);
      const grip = tmp;
      if (long) {
        grip.copy(sR).addScaledVector(dir, 0.2 - this.kick * 0.05).addScaledVector(UP, -0.09).addScaledVector(right, -0.05);
      } else {
        grip.copy(sR).add(sL).multiplyScalar(0.5).addScaledVector(dir, 0.42 - this.kick * 0.04).addScaledVector(UP, -0.06);
      }
      const gdir = new THREE.Vector3().copy(dir).addScaledVector(UP, this.kick * 0.2).normalize();
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
    this.reach('L', sup, new THREE.Vector3().copy(right).negate(), 1);
    this.hold('L', L(-0.62, -0.08, 0.78).normalize(), L(0, pistol ? -0.5 : 0, -1).normalize(), pistol ? 0.9 : 0.72);
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

/** a body with nobody in it: points on sticks falling through the map's boxes, the bones follow */
const RAG_BONES = ['Bip01_Pelvis', 'Bip01_Spine2', 'Bip01_Head', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', 'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot'];
const RAG_LINKS = [[0, 1], [1, 2], [1, 3], [1, 6], [3, 4], [4, 5], [6, 7], [7, 8], [0, 9], [0, 12], [9, 10], [10, 11], [12, 13], [13, 14], [3, 6], [9, 12], [3, 0], [6, 0], [2, 3], [2, 6], [1, 9], [1, 12], [9, 11], [12, 14]];
export const ragWorld: { w: World | null } = { w: null };

class Rag {
  private p: THREE.Vector3[] = [];
  private q: THREE.Vector3[] = [];
  private len: number[] = [];
  readonly headAt = new THREE.Vector3();
  private floor = 0;
  constructor(P: Person, dir: THREE.Vector3) {
    P.root.updateMatrixWorld(true);
    const kick = dir.clone().setY(0).normalize().multiplyScalar(0.016 + Math.random() * 0.02);
    RAG_BONES.forEach((b, i) => {
      const v = P.worldOf(b, new THREE.Vector3());
      this.p.push(v);
      // the top of the body takes the hit, the feet stay behind
      const k = i === 2 ? 2 : i < 2 ? 1.2 : i >= 9 ? 0.25 : 1;
      this.q.push(v.clone().addScaledVector(kick, -k));
    });
    this.len = RAG_LINKS.map(([a, b]) => this.p[a].distanceTo(this.p[b]));
    this.headAt.copy(this.p[2]);
    this.floor = ragWorld.w?.floorAt(this.p[0].x, this.p[0].y, this.p[0].z, 0.1) ?? 0;
  }
  step(dt: number, P: Person) {
    const w = ragWorld.w;
    const h = Math.min(dt, 1 / 40);
    const { p, q } = this;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = q[i];
      const vx = (a.x - b.x) * 0.985, vy = (a.y - b.y) * 0.985, vz = (a.z - b.z) * 0.985;
      b.copy(a);
      a.x += vx;
      a.y += vy - 13 * h * h;
      a.z += vz;
    }
    for (let it = 0; it < 7; it++) {
      RAG_LINKS.forEach(([x, y], i) => {
        const a = p[x], b = p[y];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const f = ((d - this.len[i]) / d) * 0.5;
        a.x += dx * f;
        a.y += dy * f;
        a.z += dz * f;
        b.x -= dx * f;
        b.y -= dy * f;
        b.z -= dz * f;
      });
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = q[i];
        const r = i === 2 ? 0.11 : 0.07;
        const fl = w ? w.floorAt(a.x, a.y + 0.3, a.z, 0.02) : this.floor;
        if (a.y < fl + r) {
          a.y = fl + r;
          b.x = a.x - (a.x - b.x) * 0.55;
          b.z = a.z - (a.z - b.z) * 0.55;
        }
        if (w && w.blocked(a.x, a.y, a.z, 0.04, 0.04)) {
          a.x = b.x;
          a.z = b.z;
        }
      }
    }
    // pose the skeleton through the points, from the hips outward
    const root = P.root;
    const pelvis = P.worldOf('Bip01_Pelvis', new THREE.Vector3());
    root.position.add(p[0].clone().sub(pelvis));
    root.updateMatrixWorld(true);
    const aim = (bone: string, child: string, a: number, b: number) => P.aim(bone, child, p[b].clone().sub(p[a]));
    aim('Bip01_Spine', 'Bip01_Spine2', 0, 1);
    aim('Bip01_Spine2', 'Bip01_Neck', 1, 2);
    aim('Bip01_Neck', 'Bip01_Head', 1, 2);
    aim('Bip01_L_UpperArm', 'Bip01_L_Forearm', 3, 4);
    aim('Bip01_L_Forearm', 'Bip01_L_Hand', 4, 5);
    aim('Bip01_R_UpperArm', 'Bip01_R_Forearm', 6, 7);
    aim('Bip01_R_Forearm', 'Bip01_R_Hand', 7, 8);
    aim('Bip01_L_Thigh', 'Bip01_L_Calf', 9, 10);
    aim('Bip01_L_Calf', 'Bip01_L_Foot', 10, 11);
    aim('Bip01_R_Thigh', 'Bip01_R_Calf', 12, 13);
    aim('Bip01_R_Calf', 'Bip01_R_Foot', 13, 14);
    root.updateMatrixWorld(true);
    this.headAt.copy(p[2]);
  }
}

const seenMat = new Set<THREE.Material>();
function applyPeople(m: THREE.MeshStandardMaterial) {
  if (!m || seenMat.has(m) || gearMat.includes(m as never)) return;
  seenMat.add(m);
  applyLF(m);
}

export function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export { WEAPON_LIST };
