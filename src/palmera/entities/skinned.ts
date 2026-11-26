import * as THREE from 'three';
import { Person, loadPeople, setPeopleCore, setPeopleRest, type Look, type PeopleKit } from '../../people/Humans.ts';
import type { Human } from './humans';

/**
 * The people up close: Rocketbox scans (the same kit ApexGP's garages use), animated by their own
 * walk / jog / sprint clips at the speed the human moves. The nearest humans (you always) get one;
 * everyone farther off stays on the light instanced figures. An arm is turned onto the aim (or a
 * punch) after the clip has posed it, a gun is held in the right hand, and the down and the dead
 * are laid out on the ground.
 */

const STREET = ['Male_Adult_08', 'Male_Adult_01', 'Male_Adult_05', 'Male_Adult_14', 'Sports_Male_01', 'Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'];
const HAIR = [0x2a1d14, 0x4a3020, 0x111111, 0x8a6a3a, 0x6b4a2e];

let kit: PeopleKit | null = null;

export async function loadSkinnedKit(): Promise<void> {
  try {
    setPeopleCore([...STREET, 'Pilot_Male_03', 'Pilot_Female_02']);
    setPeopleRest(false);
    kit = await loadPeople();
  } catch (e) {
    console.warn('palmera: people failed to load, using the blocky ones', e);
    kit = null;
  }
}

interface Slot {
  h: Human;
  p: Person;
  anim: string;
  gun: THREE.Mesh | null;
  lastUsed: number;
}

const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.35, metalness: 0.7 });
function gunGeo(smg: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.BoxGeometry(0.035, 0.11, smg ? 0.34 : 0.19);
  body.translate(0, 0.02, smg ? 0.1 : 0.05);
  parts.push(body);
  const grip = new THREE.BoxGeometry(0.03, 0.12, 0.045);
  grip.rotateX(0.25);
  grip.translate(0, -0.06, -0.01);
  parts.push(grip);
  if (smg) {
    const mag = new THREE.BoxGeometry(0.03, 0.16, 0.04);
    mag.translate(0, -0.1, 0.12);
    parts.push(mag);
  }
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [];
  for (const p of parts) {
    const q = p.toNonIndexed();
    pos.push(...(q.getAttribute('position').array as Float32Array));
    nor.push(...(q.getAttribute('normal').array as Float32Array));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
const GUNS = { pistol: gunGeo(false), smg: gunGeo(true) };

export class SkinnedCrowd {
  /** humans drawn here this frame (the instanced renderer skips them) */
  readonly taken = new Set<number>();
  private slots = new Map<number, Slot>();
  private t = 0;
  private reassignT = 0;
  private readonly max = 22;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();

  constructor(private scene: THREE.Scene) {}

  get ready() {
    return !!kit;
  }

  private lookFor(h: Human): Look {
    const r = Math.random;
    const shirt = '#' + h.shirt.getHexString();
    const pants = '#' + h.pants.getHexString();
    if (h.kind === 'player')
      return { female: false, tone: 0.4, body: 'Male_Adult_08', hair: 'none', hairColor: 0x2a1d14, top: 'tshirt', topColor: shirt, tint: 0.85, bottom: 'jeans', bottomColor: 0x2d3f63, height: 1.0 };
    if (h.kind === 'cop') {
      const female = r() < 0.25;
      return { female, tone: r(), top: 'polo', topColor: 0x2c4a78, top2: 0x2c4a78, accent: 0x0d0e10, bottom: 'trousers', bottomColor: 0x1d2433, shoeColor: 0x0b0b0c, cap: 0x1d2433, hair: 'none', hairColor: 0x1a120c };
    }
    const names = STREET.filter((n) => n !== 'Male_Adult_08');
    const body = names[(h.id * 7 + 3) % names.length];
    const female = body.includes('Female');
    return {
      female, tone: (h.id * 0.37) % 1, body, hair: 'none', hairColor: HAIR[h.id % HAIR.length],
      top: 'tshirt', topColor: shirt, tint: h.id % 5 === 0 ? 0 : 0.6 + ((h.id * 0.13) % 0.4),
      bottom: 'jeans', bottomColor: pants, height: 0.95 + ((h.id * 0.071) % 0.1), build: 0.97 + ((h.id * 0.053) % 0.07),
    };
  }

  private make(h: Human): Slot {
    const p = new Person(kit!, this.lookFor(h));
    p.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    this.scene.add(p.root);
    return { h, p, anim: '', gun: null, lastUsed: this.t };
  }

  update(dt: number, humans: Human[], cam: THREE.Vector3) {
    this.t += dt;
    this.taken.clear();
    if (!kit) return;
    this.reassignT -= dt;
    // who gets a scan: you, then the nearest on foot (re-picked four times a second)
    if (this.reassignT <= 0) {
      this.reassignT = 0.25;
      const cands = humans
        .filter((h) => !h.hidden && !h.vehicle)
        .map((h) => ({ h, d: h.kind === 'player' ? -1 : (h.pos.x - cam.x) ** 2 + (h.pos.z - cam.z) ** 2 }))
        .filter((c) => c.d < 70 * 70)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.max);
      const keep = new Set(cands.map((c) => c.h.id));
      for (const [id, s] of this.slots) {
        if (!keep.has(id)) {
          s.p.root.visible = false;
          if (s.gun) s.gun.visible = false;
        }
      }
      for (const c of cands) if (!this.slots.has(c.h.id)) this.slots.set(c.h.id, this.make(c.h));
      // forget the ones long unused (keep a few spares so turning round doesn't rebuild them)
      if (this.slots.size > this.max + 14) {
        const old = [...this.slots.values()].filter((s) => !keep.has(s.h.id)).sort((a, b) => a.lastUsed - b.lastUsed);
        for (const s of old.slice(0, this.slots.size - this.max - 10)) {
          this.scene.remove(s.p.root);
          if (s.gun) this.scene.remove(s.gun);
          s.p.dispose();
          this.slots.delete(s.h.id);
        }
      }
      for (const s of this.slots.values()) if (keep.has(s.h.id)) s.lastUsed = this.t;
    }
    for (const s of this.slots.values()) {
      const h = s.h;
      const on = s.lastUsed === this.t || (this.t - s.lastUsed < 0.3 && s.p.root.visible);
      if (!on || h.hidden || h.vehicle) {
        s.p.root.visible = false;
        if (s.gun) s.gun.visible = false;
        continue;
      }
      this.taken.add(h.id);
      this.pose(s, dt);
    }
  }

  private pose(s: Slot, dt: number) {
    const h = s.h, p = s.p;
    p.root.visible = true;
    const sp = h.animSpeed;
    let a = sp < 0.25 ? 'idle' : sp < 2.1 ? 'walk' : sp < 4.6 ? 'jog' : 'run';
    if (!h.onGround && !h.swimming) a = 'jog';
    if (a !== s.anim) {
      p.play(a, { fade: 0.25, offset: (h.id * 0.31) % 1 });
      s.anim = a;
    }
    if (a !== 'idle') {
      const clipSpeed = kit!.speed.get(a) ?? (a === 'walk' ? 1.4 : a === 'jog' ? 3.2 : 5.8);
      const act = (p as unknown as { current: THREE.AnimationAction | null }).current;
      if (act) act.timeScale = THREE.MathUtils.clamp(sp / clipSpeed, 0.5, 1.6);
    }
    const lie = h.fall;
    p.root.position.set(h.pos.x, h.pos.y + lie * 0.12 + (h.swimming ? -1.1 : 0), h.pos.z);
    p.root.rotation.set(-lie * 1.5, h.yaw, 0, 'YXZ');
    p.update(dt);
    // the arm on the aim, or thrown in a punch
    const armed = h.weapon !== 'fist' && !h.dead && lie < 0.3;
    const aimW = armed ? Math.max(h.aim, 0.25) : 0;
    const punch = h.punchT > 0 ? Math.sin(Math.min(1, (0.35 - h.punchT) / 0.35) * Math.PI) : 0;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const cp = Math.cos(h.aimPitch);
    const want = this.v1.set(fx * cp, Math.sin(h.aimPitch), fz * cp).normalize();
    if (armed && aimW > 0.01) {
      this.aimArm(p, 'r', want, aimW);
      if (h.weapon === 'smg') this.aimArm(p, 'l', this.v2.copy(want).addScaledVector(new THREE.Vector3(-fz, 0, fx), -0.35).normalize(), aimW * 0.9);
    } else if (punch > 0.01) {
      this.aimArm(p, 'r', this.v2.set(fx, 0.15, fz).normalize(), punch);
    }
    p.root.updateMatrixWorld(true);
    // the gun in the hand, along the aim
    if (armed) {
      if (!s.gun) {
        s.gun = new THREE.Mesh(GUNS.pistol, gunMat);
        s.gun.castShadow = true;
        this.scene.add(s.gun);
      }
      s.gun.geometry = h.weapon === 'smg' ? GUNS.smg : GUNS.pistol;
      s.gun.visible = true;
      const hand = p.bones['hand_r'];
      if (hand) hand.getWorldPosition(s.gun.position);
      s.gun.lookAt(this.v2.copy(s.gun.position).addScaledVector(want, 2));
    } else if (s.gun) s.gun.visible = false;
  }

  /** turn upper arm and forearm (in world space) so the arm points along dir, by weight w */
  private aimArm(p: Person, side: 'l' | 'r', dir: THREE.Vector3, w: number) {
    const up = p.bones[`upperarm_${side}`], lo = p.bones[`lowerarm_${side}`], hand = p.bones[`hand_${side}`];
    if (!up || !lo || !hand) return;
    for (const [b, tip] of [[up, lo], [lo, hand]] as [THREE.Bone, THREE.Bone][]) {
      b.updateWorldMatrix(true, true);
      const a = b.getWorldPosition(new THREE.Vector3());
      const c = tip.getWorldPosition(new THREE.Vector3());
      const cur = c.sub(a).normalize();
      this.q1.setFromUnitVectors(cur, dir);
      this.q1.slerp(this.q3.identity(), 1 - w);
      b.getWorldQuaternion(this.q2);
      const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      b.quaternion.copy(pq.multiply(this.q1.multiply(this.q2)));
      b.updateWorldMatrix(false, true);
    }
  }
}
