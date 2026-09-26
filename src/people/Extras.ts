import * as THREE from 'three';
import { headsetGeometry, mergeSimple, capMaterial, capGeometry, ROSTER, fanPool, type PeopleKit } from './Humans.ts';
import { bakeSet, crowdMaterial, PROP_HAND, PROP_HEAD, type AvatarBake, type Baked } from './Crowd.ts';

/**
 * The extras: people around the circuit doing their jobs (marshals, photographers, the pit
 * wall, people walking the paddock and the concourses). Rocketbox avatars on the crowd's
 * baked clips (one bone texture, every one instanced), but unlike the crowd each has a
 * handle: its act, place and prop can change (a marshal picks up the yellow flag, a walker
 * moves on). Every frame only the ones near the camera and in view are written into the
 * instance buffers, the closest with the fine mesh: the rest cost nothing.
 */

/** the extras' clips, by act */
export const EX = { IDLE: 0, LOOK: 1, WAVE: 2, PHOTO: 3, WALK: 4, SIT: 5, TALK: 6, LISTEN: 7, PHONE: 8, CLAP: 9, CHEER: 10, JUMP: 11, WAIT: 12 } as const;
const EX_CLIPS = ['idle', 'look_around', 'wave', 'photo', 'walk', 'sit', 'talk', 'listen', 'phone', 'clap', 'cheer', 'cheer3', 'waiting'];

export type ExtraProp = 'flag' | 'phone' | 'camera' | 'headset' | null;

export interface ExtraSpec {
  /** an avatar of the extras' set (EXTRA_BODIES) */
  body: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  act: number;
  /** dye colour; how much (0..1); over all the clothes (overalls) or only the shirt */
  tint?: THREE.ColorRepresentation;
  tintAmount?: number;
  dyeAll?: boolean;
  cap?: THREE.ColorRepresentation | null;
  prop?: ExtraProp;
  propColor?: THREE.ColorRepresentation;
  scale?: number;
  phase?: number;
  /** clip speed factor */
  pace?: number;
}

/** the avatars the extras are made of: the uniforms, and a few everyday ones */
export function extraBodies(kit: PeopleKit): { crew: string; shirt: string; casualM: string[]; casualF: string[] } {
  const m = fanPool(kit, false), f = fanPool(kit, true);
  return { crew: ROSTER.crew, shirt: ROSTER.shirt, casualM: m.slice(0, 3), casualF: f.slice(0, 2) };
}

function bakeExtras(kit: PeopleKit): Baked {
  const b = extraBodies(kit);
  return bakeSet(kit, { key: 'extras', names: [b.crew, b.shirt, ...b.casualM, ...b.casualF], clips: EX_CLIPS });
}

interface Member {
  spec: ExtraSpec;
  bake: AvatarBake;
  pos: THREE.Vector3;
  yaw: number;
  act: number;
  tint: THREE.Color;
  tintA: number;
  cap: THREE.Color | null;
  prop: ExtraProp;
  propColor: THREE.Color;
  propOn: boolean;
  scale: number;
  phase: number;
  pace: number;
  visible: boolean;
}

/** an instanced mesh whose slots are filled every frame */
interface Slotted {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute | null;
  fit: THREE.InstancedBufferAttribute | null;
  n: number;
}

export class Extras {
  readonly group = new THREE.Group();
  readonly members: Member[] = [];
  private readonly shared = { uTime: { value: 0 }, uCalm: { value: 0 } };
  private readonly owned: { dispose(): void }[] = [];
  private readonly bodies = new Map<string, { near: Slotted; far: Slotted; hair: Slotted | null; hairFar: Slotted | null; cap: Slotted | null }>();
  private readonly props = new Map<string, Slotted>();
  private readonly baked: Baked;
  private readonly frustum = new THREE.Frustum();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sph = new THREE.Sphere();
  private readonly up = new THREE.Vector3(0, 1, 0);
  near: number;
  far: number;
  propFar: number;

  constructor(kit: PeopleKit, specs: ExtraSpec[], opts: { name?: string; near?: number; far?: number; propFar?: number; shadows?: boolean } = {}) {
    this.group.name = opts.name ?? 'extras';
    this.near = opts.near ?? 28;
    this.far = opts.far ?? 380;
    this.propFar = opts.propFar ?? 160;
    const baked = (this.baked = bakeExtras(kit));
    const names = [...baked.avatars.keys()];
    for (const s of specs) {
      const bk = baked.avatars.get(s.body) ?? baked.avatars.get(names.find((n) => baked.avatars.get(n)!.asset.female === baked.avatars.get(s.body)?.asset.female) ?? names[0])!;
      this.members.push({
        spec: s,
        bake: bk,
        pos: new THREE.Vector3(s.x, s.y, s.z),
        yaw: s.yaw,
        act: s.act,
        tint: new THREE.Color(s.tint ?? 0xffffff),
        tintA: s.tint !== undefined ? (s.tintAmount ?? 1) + (s.dyeAll ? 2 : 0) : 0,
        cap: s.cap != null ? new THREE.Color(s.cap).multiplyScalar(0.92) : null,
        prop: s.prop ?? null,
        propColor: new THREE.Color(s.propColor ?? 0x1a1b1e),
        propOn: true,
        scale: s.scale ?? 1,
        phase: s.phase ?? Math.random(),
        pace: s.pace ?? 1,
        visible: true,
      });
    }
    const shadows = !!opts.shadows;
    const slotted = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, cap: number, kind: 'body' | 'hair' | 'prop', cast: boolean): Slotted => {
      const g = geo.clone();
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aAnim', anim);
      let tint: THREE.InstancedBufferAttribute | null = null, fit: THREE.InstancedBufferAttribute | null = null;
      if (kind === 'body') {
        tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
        tint.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aTint', tint);
      }
      if (kind === 'prop') {
        fit = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
        fit.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aFit', fit);
      }
      const mesh = new THREE.InstancedMesh(g, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (kind === 'prop') mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.count = 0;
      mesh.customDepthMaterial = mat.userData.depth;
      mesh.castShadow = shadows && cast;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.owned.push(g, mat, mat.userData.depth);
      return { mesh, anim, tint, fit, n: 0 };
    };
    const cm = capMaterial(kit, 0xffffff);
    for (const name of names) {
      const B = baked.avatars.get(name)!;
      const cap = this.members.filter((m) => m.bake === B).length;
      if (!cap) continue;
      const idle = B.acts[0];
      // caps made for each head (in its head bone's frame)
      const nCap = this.members.filter((m) => m.bake === B && m.cap).length;
      let capS: Slotted | null = null;
      if (nCap) {
        const geo = capGeometry(B.asset, false, true).applyMatrix4(B.asset.body.boneInverses[B.asset.lm.joint.Head]);
        capS = slotted(geo, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.82, map: cm.map, vertexColors: true }, { col: PROP_HEAD }), nCap, 'prop', true);
        geo.dispose();
      }
      const bodyMat = () => crowdMaterial(baked, idle, this.shared, 'body', { map: B.asset.body.map, normalMap: B.asset.body.normal, roughness: 1, metalness: 0 }, { asset: B.asset });
      const hairMat = () => crowdMaterial(baked, idle, this.shared, 'hair', { map: B.asset.head.hairMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
      this.bodies.set(name, {
        near: slotted(B.body, bodyMat(), cap, 'body', true),
        far: slotted(B.bodyFar, bodyMat(), cap, 'body', false),
        hair: B.hair ? slotted(B.hair, hairMat(), cap, 'hair', true) : null,
        hairFar: B.hairFar ? slotted(B.hairFar, hairMat(), cap, 'hair', false) : null,
        cap: capS,
      });
    }
    cm.dispose();
    // the props, each in the frame of the bone that carries it (the reference avatar's bind pose)
    const idle = baked.avatars.get(names[0])!.acts[0];
    const ref = baked.ref;
    const headInv = ref.body.boneInverses[ref.lm.joint.Head];
    const handInv = ref.body.boneInverses[ref.lm.joint.hand_r];
    const hp = ref.lm.pos.hand_r;
    const count = (f: (m: Member) => boolean) => this.members.filter(f).length;
    const n = (p: ExtraProp) => count((m) => m.prop === p);
    if (n('flag')) this.props.set('flag', slotted(baked.flag, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.85, side: THREE.DoubleSide, vertexColors: true }, { col: PROP_HAND }), n('flag'), 'prop', true));
    if (n('phone')) this.props.set('phone', slotted(baked.phone, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.3, metalness: 0.4 }, { col: PROP_HAND }), n('phone'), 'prop', false));
    if (n('camera')) {
      // a DSLR with a long lens, held up to the eye
      const body = new THREE.BoxGeometry(0.14, 0.1, 0.075);
      const lens = new THREE.CylinderGeometry(0.036, 0.04, 0.2, 12);
      lens.rotateX(Math.PI / 2);
      lens.translate(0, -0.005, 0.13);
      const g = mergeSimple([body, lens]);
      g.translate(hp.x - 0.07, hp.y - 0.01, hp.z + 0.06);
      const geo = g.applyMatrix4(handInv);
      this.props.set('camera', slotted(geo, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.4, metalness: 0.3 }, { col: PROP_HAND }), n('camera'), 'prop', false));
      g.dispose();
    }
    if (n('headset')) {
      const geo = headsetGeometry(ref.lm).applyMatrix4(headInv);
      this.props.set('headset', slotted(geo, crowdMaterial(baked, idle, this.shared, 'prop', { roughness: 0.45, metalness: 0.2 }, { col: PROP_HEAD }), n('headset'), 'prop', false));
      geo.dispose();
    }
  }

  // ---------------------------------------------------------------- handles
  setAct(i: number, act: number, phase?: number) {
    const m = this.members[i];
    m.act = act;
    if (phase !== undefined) m.phase = phase;
  }
  setPlace(i: number, x: number, y: number, z: number, yaw: number) {
    const m = this.members[i];
    m.pos.set(x, y, z);
    m.yaw = yaw;
  }
  /** the prop shown or not, and its colour */
  setProp(i: number, on: boolean, color?: THREE.ColorRepresentation) {
    const m = this.members[i];
    m.propOn = on;
    if (color !== undefined) m.propColor.set(color);
  }
  setVisible(i: number, on: boolean) {
    this.members[i].visible = on;
  }
  /** a walking clip's speed, metres per second at pace 1 */
  get walkSpeed(): number {
    return 1.3;
  }

  // ---------------------------------------------------------------- per frame
  update(t: number, camera: THREE.Camera) {
    this.shared.uTime.value = t;
    camera.updateMatrixWorld();
    // (members are placed in the group's space: the camera and the frustum are taken into it)
    this.group.updateWorldMatrix(true, false);
    const W = this.group.matrixWorld;
    const cam = camera.getWorldPosition(this.v).clone().applyMatrix4(this.m4.copy(W).invert());
    this.m4.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse).multiply(W);
    this.frustum.setFromProjectionMatrix(this.m4);
    for (const b of this.bodies.values()) {
      b.near.n = b.far.n = 0;
      if (b.hair) b.hair.n = 0;
      if (b.hairFar) b.hairFar.n = 0;
      if (b.cap) b.cap.n = 0;
    }
    for (const p of this.props.values()) p.n = 0;
    const far2 = this.far * this.far, near2 = this.near * this.near, prop2 = this.propFar * this.propFar;
    for (const m of this.members) {
      if (!m.visible) continue;
      const d2 = m.pos.distanceToSquared(cam);
      if (d2 > far2) continue;
      this.sph.center.copy(m.pos);
      this.sph.center.y += 0.9 * m.scale;
      this.sph.radius = 1.3 * m.scale;
      if (!this.frustum.intersectsSphere(this.sph)) continue;
      const B = this.bodies.get(m.bake.name)!;
      const isNear = d2 < near2;
      const a = m.bake.acts[m.act] ?? m.bake.acts[0];
      this.q.setFromAxisAngle(this.up, m.yaw);
      this.m4.compose(m.pos, this.q, this.v.set(m.scale, m.scale, m.scale));
      const put = (s: Slotted | null, fill?: (s: Slotted, k: number) => void) => {
        if (!s) return;
        const k = s.n++;
        s.mesh.setMatrixAt(k, this.m4);
        s.anim.setXYZW(k, a[0], a[1], a[2] / m.pace, m.phase);
        fill?.(s, k);
      };
      const tint = (s: Slotted, k: number) => s.tint!.setXYZW(k, m.tint.r, m.tint.g, m.tint.b, m.tintA);
      put(isNear ? B.near : B.far, tint);
      // (the hair goes under the cap)
      if (!m.cap || d2 > prop2) put(isNear ? B.hair : B.hairFar);
      if (d2 > prop2) continue;
      if (m.cap)
        put(B.cap, (s, k) => {
          s.fit!.setXYZW(k, 0, 0, 0, 1);
          s.mesh.setColorAt(k, m.cap!);
        });
      if (m.prop && m.propOn)
        put(this.props.get(m.prop)!, (s, k) => {
          if (m.prop === 'headset') s.fit!.setXYZW(k, m.bake.capFit.x, m.bake.capFit.y, m.bake.capFit.z, m.bake.capFit.w);
          else s.fit!.setXYZW(k, 0, 0, 0, 1);
          s.mesh.setColorAt(k, m.propColor);
        });
    }
    const flush = (s: Slotted | null) => {
      if (!s) return;
      s.mesh.count = s.n;
      if (!s.n) return;
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.instanceMatrix.clearUpdateRanges();
      s.mesh.instanceMatrix.addUpdateRange(0, s.n * 16);
      for (const at of [s.anim, s.tint, s.fit]) {
        if (!at) continue;
        at.needsUpdate = true;
        at.clearUpdateRanges();
        at.addUpdateRange(0, s.n * 4);
      }
      if (s.mesh.instanceColor) {
        s.mesh.instanceColor.needsUpdate = true;
        s.mesh.instanceColor.clearUpdateRanges();
        s.mesh.instanceColor.addUpdateRange(0, s.n * 3);
      }
    };
    for (const b of this.bodies.values()) {
      flush(b.near);
      flush(b.far);
      flush(b.hair);
      flush(b.hairFar);
      flush(b.cap);
    }
    for (const p of this.props.values()) flush(p);
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }
}
