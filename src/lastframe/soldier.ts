import * as THREE from 'three';
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
        applyLF(mat, { spec: 0.42, view: 1 });
        mat.metalness *= 0.7;
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
const gearMat = [0x4a5264, 0x6e5e44].map((c) => {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, normalMap: nylon, vertexColors: true });
  m.normalScale.set(0.7, 0.7);
  return applyLF(m);
});

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
  private rag: Ragdoll | null = null;
  private spin = 0;
  private gq = new THREE.Quaternion();
  private v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly head = new THREE.Vector3();
  private hitK = 0;
  private hitZone = 1;
  private hitDir = new THREE.Vector3();
  /** from inside, only the arms and legs are drawn */
  private fpHide = { value: 0 };

  constructor(kit: PeopleKit, readonly team: number, slot: number) {
    this.person = new Person(kit, lookFor(team, slot));
    this.person.lively = true;
    this.root.add(this.person.root);
    this.root.add(this.holder);
    const gm = gearMat[team] ?? gearMat[0];
    const P0 = this.person;
    const worn = new THREE.SkinnedMesh(outfitGeometry(team * 2 + (slot % 2), P0), gm);
    worn.bind(P0.skeleton, P0.body.bindMatrix);
    worn.frustumCulled = false;
    worn.castShadow = true;
    worn.userData.gear = true;
    P0.body.parent!.add(worn);
    this.person.body.traverse((o) => (o.castShadow = true));
    for (const o of this.root.children) o.traverse((m) => ((m as THREE.Mesh).isMesh && applyPeople((m as THREE.Mesh).material as THREE.MeshStandardMaterial)));
        const bm = this.person.body.material as THREE.MeshStandardMaterial;
    const before = bm.onBeforeCompile, key = bm.customProgramCacheKey();
    const hide = this.fpHide;
    const mask = { value: team === 0 ? new THREE.Vector4(0.015, 0.016, 0.02, 1) : new THREE.Vector4(0.07, 0.05, 0.035, 2) };
    bm.onBeforeCompile = (s, r) => {
      before.call(bm, s, r);
      s.uniforms.lfFP = hide;
      s.uniforms.lfMask = mask;
      s.fragmentShader = s.fragmentShader.replace('void main() {', 'uniform float lfFP;\nuniform vec4 lfMask;\nvoid main() {\n  if ( lfFP > 0.5 && vPart < 2.5 ) discard;');
      // the head's own mesh, dyed: a balaclava that fits because it is the face. An eye slot, or a scarf to the nose
      s.fragmentShader = s.fragmentShader.replace('diffuseColor.rgb *= col;', `if ( part < 0.5 ) {
    float slot = abs( vRest.y - 1.703 ) - 0.021;
    float cover = lfMask.w > 1.5 ? smoothstep( 0.0, 0.006, 1.662 - vRest.y ) : smoothstep( 0.0, 0.005, slot );
    col = mix( col, lfMask.rgb * ( 0.9 + 0.2 * apNoise( vRest * 300.0 ) ), cover );
    gCloth = max( gCloth, cover );
    cloth = max( cloth, cover );
  }
  diffuseColor.rgb *= col;`);
    };
    bm.customProgramCacheKey = () => key + 'fp2';
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
    const g = this.gun;
    if (g) {
      // the hands open: it goes its own way
      g.group.updateMatrixWorld(true);
      const held = new THREE.Group();
      const c = g.group.clone();
      c.position.set(0, 0, 0);
      c.quaternion.identity();
      held.add(c);
      c.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(c);
      const mid = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      sz.x = Math.max(0.02, Math.min(sz.x, 0.05));
      this.root.parent?.add(held);
      const p = g.group.getWorldPosition(new THREE.Vector3()), q = g.group.getWorldQuaternion(new THREE.Quaternion());
      ph.drop(held, [sz.x, Math.max(0.03, sz.y * 0.7), sz.z], mid, p, q, v.clone().addScaledVector(dir, 0.7).add(new THREE.Vector3(0, 0.6, 0)), 5, 3.2, 14);
      g.group.visible = false;
    }
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
