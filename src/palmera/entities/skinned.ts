import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Person, loadPeople, setPeopleCore, setPeopleRest, type Look, type PeopleKit } from '../../people/Humans.ts';
import { LONG_GUNS, type Human, type WeaponId } from './humans';
import type { Vehicle } from './vehicle';
import { reactionArms } from '../game/reactions';

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
  umb?: THREE.Mesh;
  lastUsed: number;
}

const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.35, metalness: 0.7 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.55 });
function boxes(list: [number, number, number, number, number, number][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [];
  for (const [w, h, d, x, y, z] of list) {
    const q = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    q.translate(x, y, z);
    pos.push(...(q.getAttribute('position').array as Float32Array));
    nor.push(...(q.getAttribute('normal').array as Float32Array));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
// +z is the muzzle, the grip at the origin
const GUNS: Partial<Record<WeaponId, { geo: THREE.BufferGeometry; mat: THREE.Material }>> = {
  pistol: { geo: boxes([[0.035, 0.05, 0.19, 0, 0.03, 0.05], [0.03, 0.12, 0.045, 0, -0.04, -0.01]]), mat: gunMat },
  smg: { geo: boxes([[0.04, 0.07, 0.34, 0, 0.03, 0.1], [0.03, 0.12, 0.045, 0, -0.05, -0.01], [0.03, 0.16, 0.04, 0, -0.08, 0.12], [0.02, 0.02, 0.12, 0, 0.04, 0.32]]), mat: gunMat },
  shotgun: { geo: boxes([[0.045, 0.06, 0.72, 0, 0.03, 0.22], [0.05, 0.05, 0.22, 0, -0.01, 0.3], [0.04, 0.1, 0.26, 0, -0.02, -0.18]]), mat: gunMat },
  rifle: { geo: boxes([[0.045, 0.08, 0.62, 0, 0.03, 0.2], [0.03, 0.14, 0.05, 0, -0.06, 0.0], [0.03, 0.18, 0.05, 0, -0.09, 0.14], [0.04, 0.09, 0.24, 0, 0.0, -0.2], [0.02, 0.06, 0.04, 0, 0.1, 0.12], [0.015, 0.015, 0.2, 0, 0.04, 0.6]]), mat: gunMat },
  sniper: { geo: boxes([[0.04, 0.07, 0.78, 0, 0.03, 0.24], [0.035, 0.035, 0.3, 0, 0.11, 0.12], [0.03, 0.12, 0.05, 0, -0.05, 0.0], [0.045, 0.1, 0.3, 0, -0.01, -0.22], [0.012, 0.012, 0.3, 0, 0.04, 0.75]]), mat: gunMat },
  bat: { geo: (() => { const c = new THREE.CylinderGeometry(0.035, 0.018, 0.84, 10); c.rotateX(Math.PI / 2); c.translate(0, 0, 0.36); return c; })(), mat: woodMat },
  grenade: { geo: new THREE.SphereGeometry(0.06, 10, 8), mat: new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6 }) },
};

export class SkinnedCrowd {
  /** humans drawn here this frame (the instanced renderer skips them) */
  readonly taken = new Set<number>();
  private slots = new Map<number, Slot>();
  private t = 0;
  private reassignT = 0;
  private readonly max = 72;
  private frame = 0;
  private readonly lastCam = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();

  constructor(private scene: THREE.Scene) {}

  get ready() {
    return !!kit;
  }

  /** people sitting in the cars near you: the driver (you, too), and two officers in a cruiser */
  private seated = new Map<Vehicle, { p: Person[]; key: string }>();
  private seatT = 0;

  updateDrivers(dt: number, vehicles: Vehicle[], cam: THREE.Vector3, player: Human) {
    if (!kit) return;
    this.seatT -= dt;
    if (this.seatT <= 0) {
      this.seatT = 0.3;
      const cands = vehicles
        .filter((v) => v.seat && !v.wrecked && (!v.isBoat || v.type === 'jetski') && (v.driver === 'npc' || v.driver === 'player' || v.occupants > 0))
        .map((v) => ({ v, d: (v.pos.x - cam.x) ** 2 + (v.pos.z - cam.z) ** 2 }))
        .filter((c) => c.d < 55 * 55 || c.v.driver === 'player')
        .sort((a, b) => a.d - b.d)
        .slice(0, 10);
      const keep = new Map(cands.map((c) => [c.v, (c.v.driver === 'player' ? 'P' : c.v.police ? 'C' : 'N') + (c.v.police && c.v.occupants > 1 ? '2' : '1')]));
      for (const [v, s] of this.seated) {
        if (keep.get(v) !== s.key) {
          for (const p of s.p) {
            v.root.remove(p.root);
            p.dispose();
          }
          this.seated.delete(v);
        }
      }
      for (const [v, key] of keep) {
        if (this.seated.has(v)) continue;
        const ps: Person[] = [];
        const n = key.endsWith('2') ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const fake = { kind: key[0] === 'P' ? 'player' : key[0] === 'C' ? 'cop' : 'ped', id: v.vid + i * 7, shirt: key[0] === 'P' ? player.shirt : new THREE.Color().setHSL(((v.vid + i) % 97) / 97, 0.45, 0.5), pants: new THREE.Color(0x2d3f63) } as unknown as Human;
          const p = new Person(kit, this.lookFor(fake));
          p.root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) m.castShadow = false;
          });
          p.root.position.copy(v.seat!);
          if (i === 1) p.root.position.x *= -1;
          // inside a cabin: a touch lower and smaller, or the head pokes up through the roof (it cleared it by 0.1 m too little in every type)
          if (v.type !== 'bike' && v.type !== 'jetski' && v.type !== 'bus') {
            p.root.position.y -= 0.1;
            p.root.scale.multiplyScalar(0.92);
          }
          p.play('sit', { offset: (v.vid % 100) / 100 });
          (v.type === 'bike' || v.type === 'jetski' ? v.body : v.root).add(p.root);
          ps.push(p);
        }
        this.seated.set(v, { p: ps, key });
      }
    }
    for (const s of this.seated.values()) for (const p of s.p) p.update(dt);
  }

  private lookFor(h: Human): Look {
    const r = Math.random;
    const shirt = '#' + h.shirt.getHexString();
    const pants = '#' + h.pants.getHexString();
    if (h.kind === 'player') {
      const o = h.outfit;
      if (o)
        return { female: false, tone: 0.4, body: 'Male_Adult_08', hair: 'none', hairColor: 0x2a1d14, top: o.top, topColor: o.topColor, top2: o.top2, accent: 0x111111, tint: 0.85, bottom: o.bottom, bottomColor: o.bottomColor, shoeColor: 0x1b1b1d, cap: o.cap ?? null, height: 1.0 };
      return { female: false, tone: 0.4, body: 'Male_Adult_08', hair: 'none', hairColor: 0x2a1d14, top: 'tshirt', topColor: shirt, tint: 0.85, bottom: 'jeans', bottomColor: 0x2d3f63, height: 1.0 };
    }
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

  /** rebuild someone's figure (new clothes): the slot is dropped and made again next update */
  restyle(h: Human) {
    const s = this.slots.get(h.id);
    if (!s) return;
    this.scene.remove(s.p.root);
    if (s.gun) this.scene.remove(s.gun);
    if (s.umb) this.scene.remove(s.umb);
    s.p.dispose();
    this.slots.delete(h.id);
    this.reassignT = 0;
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

  update(dt: number, humans: Human[], cam: THREE.Vector3, camFwd?: THREE.Vector3) {
    this.t += dt;
    this.frame++;
    this.lastCam.copy(cam);
    if (camFwd) this.camFwd.set(camFwd.x, 0, camFwd.z).normalize();
    this.taken.clear();
    if (!kit) return;
    this.reassignT -= dt;
    // who gets a scan: you, then the nearest on foot (re-picked four times a second)
    if (this.reassignT <= 0) {
      this.reassignT = 0.25;
      const cands = humans
        .filter((h) => !h.hidden && !h.vehicle)
        .map((h) => {
          if (h.kind === 'player') return { h, d: -1 };
          const dx = h.pos.x - cam.x, dz = h.pos.z - cam.z, d2 = dx * dx + dz * dz;
          // people behind the camera count as further away: the scans go where you're looking
          const behind = dx * this.camFwd.x + dz * this.camFwd.z < -4;
          return { h, d: behind ? d2 * 4 : d2 };
        })
        .filter((c) => c.d < 110 * 110)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.max);
      const keep = new Set(cands.map((c) => c.h.id));
      for (const [id, s] of this.slots) {
        if (!keep.has(id)) {
          s.p.root.visible = false;
          if (s.gun) s.gun.visible = false;
        if (s.umb) s.umb.visible = false;
          if (s.umb) s.umb.visible = false;
        }
      }
      for (const c of cands) if (!this.slots.has(c.h.id)) this.slots.set(c.h.id, this.make(c.h));
      // forget the ones long unused (keep a few spares so turning round doesn't rebuild them)
      if (this.slots.size > this.max + 14) {
        const old = [...this.slots.values()].filter((s) => !keep.has(s.h.id)).sort((a, b) => a.lastUsed - b.lastUsed);
        for (const s of old.slice(0, this.slots.size - this.max - 10)) {
          this.scene.remove(s.p.root);
          if (s.gun) this.scene.remove(s.gun);
          if (s.umb) this.scene.remove(s.umb);
    if (s.umb) this.scene.remove(s.umb);
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
        if (s.umb) s.umb.visible = false;
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
    let a = sp < 0.25 ? h.clip || 'idle' : sp < 2.1 ? 'walk' : sp < 4.6 ? 'jog' : 'run';
    // in cover: down behind it, standing only to aim
    if (h.inCover && h.aim < 0.5 && sp < 2.4) a = 'crouch';
    if (!h.onGround && !h.swimming) a = h.sky ? 'idle' : 'jog';
    if (a !== s.anim) {
      p.play(a, { fade: 0.25, offset: (h.id * 0.31) % 1 });
      s.anim = a;
    }
    if (a !== 'idle') {
      const clipSpeed = kit!.speed.get(a) ?? (a === 'walk' ? 1.4 : a === 'jog' ? 3.2 : 5.8);
      const act = (p as unknown as { current: THREE.AnimationAction | null }).current;
      if (act) act.timeScale = THREE.MathUtils.clamp(sp / clipSpeed, 0.5, 1.6);
    }
    // sunbathers lie fully flat on their towels (fall settles a little short of 1 elsewhere)
    const towel = h.state === 'towel' && !h.dead;
    const lie = towel ? 1 : h.fall;
    const lounge = h.state === 'lounge' ? 1 : 0;
    p.root.position.set(h.pos.x - Math.sin(h.yaw) * lounge * 0.25, h.pos.y + lie * 0.12 + (h.swimming ? -1.15 : 0) + lounge * 0.38, h.pos.z - Math.cos(h.yaw) * lounge * 0.25);
    p.root.rotation.set(towel ? -Math.PI / 2 : -lie * 1.5 - lounge * 0.75, h.yaw, 0, 'YXZ');
    // vaulting: lean into it, and roll onto a hip across a car bonnet
    if (h.sky === 1) p.root.rotation.x += 1.25;
    if (h.vaultU >= 0) {
      const k = Math.sin(h.vaultU * Math.PI);
      p.root.rotation.x += 0.35 * k;
      p.root.rotation.z = h.vaultRoll * k;
    }
    // past 45 m the skeleton is updated every other frame (twice the step), which nobody can see
    const far = h.kind !== 'player' && s.p.root.position.distanceToSquared(this.lastCam) > 45 * 45;
    // people lying or sitting still (towels, loungers, benches) barely move: a quarter of the frames
    const still = h.state === 'towel' || h.state === 'lounge' || h.state === 'bench';
    if (still) {
      if ((this.frame + h.id) % 4 === 0) p.update(dt * 4);
    } else if (!far) p.update(dt);
    else if ((this.frame + h.id) % 2 === 0) p.update(dt * 2);
    // the arm on the aim, or thrown in a punch (or a swing of the bat)
    const gunHeld = h.weapon !== 'fist' && h.weapon !== 'bat' && h.weapon !== 'grenade';
    const armed = gunHeld && !h.dead && lie < 0.3;
    const aimW = armed ? Math.max(h.aim, 0.25) : 0;
    const punch = h.punchT > 0 ? Math.sin(Math.min(1, (0.38 - h.punchT) / 0.38) * Math.PI) : 0;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const cp = Math.cos(h.aimPitch);
    const want = this.v1.set(fx * cp, Math.sin(h.aimPitch), fz * cp).normalize();
    if (armed && aimW > 0.01) {
      this.aimArm(p, 'r', want, aimW);
      if (LONG_GUNS.has(h.weapon)) this.aimArm(p, 'l', this.v2.copy(want).addScaledVector(new THREE.Vector3(-fz, 0, fx), -0.35).normalize(), aimW * 0.9);
    } else if (reactionArms(h)) {
      const ra = reactionArms(h)!;
      if (ra.r) this.aimArm(p, 'r', ra.r, 1);
      if (ra.l) this.aimArm(p, 'l', ra.l, 1);
    } else if (punch > 0.01) {
      const swing = h.weapon === 'bat' ? this.v2.set(fx + -fz * (1 - punch) * 0.8, 0.35 - punch * 0.4, fz + fx * (1 - punch) * 0.8).normalize() : this.v2.set(fx, 0.15, fz).normalize();
      this.aimArm(p, 'r', swing, punch);
    }
    p.root.updateMatrixWorld(true);
    // an umbrella in the right hand, canopy level above the head
    if (h.umbrella !== null && !h.dead && lie < 0.3) {
      if (!s.umb) {
        s.umb = new THREE.Mesh(umbrellaGeo(), umbrellaMat(h.umbrella));
        s.umb.castShadow = true;
        this.scene.add(s.umb);
      }
      s.umb.material = umbrellaMat(h.umbrella);
      s.umb.visible = true;
      // the handle at chest height, a little forward and to the right, where the forearm reaches
      const rx = -fz, rz = fx;
      s.umb.position.set(h.pos.x + fx * 0.3 + rx * 0.2, h.pos.y + 1.02, h.pos.z + fz * 0.3 + rz * 0.2);
      s.umb.rotation.set(0, h.yaw, 0);
    } else if (s.umb) s.umb.visible = false;
    // what's in the hand
    const held = !h.dead && lie < 0.3 && h.weapon !== 'fist' ? GUNS[h.weapon] : undefined;
    if (held) {
      if (!s.gun) {
        s.gun = new THREE.Mesh(held.geo, held.mat);
        s.gun.castShadow = true;
        this.scene.add(s.gun);
      }
      s.gun.geometry = held.geo;
      s.gun.material = held.mat;
      s.gun.visible = true;
      const hand = p.bones['hand_r'];
      if (hand) hand.getWorldPosition(s.gun.position);
      if (gunHeld) s.gun.lookAt(this.v2.copy(s.gun.position).addScaledVector(want, 2));
      else if (h.weapon === 'bat') {
        // the bat follows the forearm
        const lo = p.bones['lowerarm_r'];
        if (lo) {
          const e = lo.getWorldPosition(new THREE.Vector3());
          const d = s.gun.position.clone().sub(e).normalize();
          s.gun.lookAt(s.gun.position.clone().add(d.add(new THREE.Vector3(0, 0.9, 0)).normalize()));
        }
      }
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

/** an umbrella standing on its handle: a hooked grip at the origin, the shaft, an eight-panel canopy */
let umbGeo: THREE.BufferGeometry | null = null;
function umbrellaGeo(): THREE.BufferGeometry {
  if (umbGeo) return umbGeo;
  const shaft = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 6);
  shaft.translate(0, 0.5, 0);
  const canopy = new THREE.ConeGeometry(0.5, 0.22, 8, 1, true);
  canopy.translate(0, 1.0, 0);
  const tip = new THREE.CylinderGeometry(0.008, 0.012, 0.12, 5);
  tip.translate(0, 1.15, 0);
  const parts = [shaft, canopy, tip].map((g) => g.toNonIndexed());
  // vertex colour: white on the canopy (tinted by the material), dark on the shaft and tip
  const colored = parts.map((g, i) => {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3).fill(i === 1 ? 1 : 0.12);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    return g;
  });
  umbGeo = mergeGeometries(colored)!;
  return umbGeo;
}
const umbMats = new Map<number, THREE.MeshStandardMaterial>();
function umbrellaMat(c: number) {
  let m = umbMats.get(c);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
    umbMats.set(c, m);
  }
  return m;
}
