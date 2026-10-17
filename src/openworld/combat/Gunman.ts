import * as THREE from 'three';
import { Person, type Look, type PeopleKit } from '../../people/Humans.ts';
import { buildGun, WEAPONS, type GunModel, type WeaponId } from './weapons.ts';

/**
 * A person with a gun: the player on foot, and the officers who get out of their cruisers. One
 * skinned Rocketbox avatar playing the walk / jog / run clips under an upper body posed by hand:
 * the spine turns and bends toward the aim, and two-bone IK puts the hands on the gun — a rifle's
 * stock in the shoulder pocket and the support hand on the fore-end, a pistol out in front in both
 * hands. Not aiming, a long gun is carried at the low ready and a pistol hangs in the right hand.
 * Shot dead, they fall.
 */

const UP = new THREE.Vector3(0, 1, 0);

export class Gunman {
  readonly person: Person;
  readonly root: THREE.Group;
  gun: GunModel | null = null;
  weapon: WeaponId | null = null;
  /** 0 relaxed … 1 aiming (eased) */
  aim = 0;
  aiming = false;
  readonly aimDir = new THREE.Vector3(0, 0, 1);
  /** recoil kick (decays) */
  kick = 0;
  /** seconds since death (-1 alive) */
  dead = -1;
  private fallYaw = 0;
  private fallDir = 1;
  private clip = '';
  private readonly gunHolder = new THREE.Group();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly guns = new Map<WeaponId, GunModel>();

  constructor(kit: PeopleKit, look: Look) {
    this.person = new Person(kit, look);
    this.person.lively = true;
    this.root = new THREE.Group();
    this.root.add(this.person.root);
    this.root.add(this.gunHolder);
    this.person.play('idle');
  }

  setWeapon(id: WeaponId | null) {
    if (id === this.weapon) return;
    if (this.gun) this.gunHolder.remove(this.gun.group);
    this.weapon = id;
    this.gun = null;
    if (!id) return;
    let g = this.guns.get(id);
    if (!g) this.guns.set(id, (g = buildGun(id)));
    this.gun = g;
    this.gunHolder.add(g.group);
  }

  revive() {
    this.dead = -1;
    this.person.root.rotation.set(0, 0, 0);
  }

  /** shot dead: fall away from the shot */
  kill(from: THREE.Vector3) {
    if (this.dead >= 0) return;
    this.dead = 0;
    const p = this.person.root.position;
    this.fallYaw = Math.atan2(p.x - from.x, p.z - from.z);
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.aiming = false;
  }

  /**
   * Place and pose. `speed` picks the gait; `yaw` faces; `aimDir` (world) when aiming.
   */
  update(dt: number, pos: THREE.Vector3, yaw: number, speed: number, onGround: boolean) {
    const P = this.person;
    // ---- the gait
    let clip = 'idle', rate = 1;
    if (this.dead >= 0) clip = 'idle';
    else if (!onGround) clip = 'jog';
    else if (speed > 4.2) {
      clip = 'run';
      rate = speed / 5.6;
    } else if (speed > 2.2) {
      clip = 'jog';
      rate = speed / 3.4;
    } else if (speed > 0.25) {
      clip = 'walk';
      rate = Math.max(0.5, speed / 1.45);
    }
    if (clip !== this.clip) {
      P.play(clip, { fade: 0.25 });
      this.clip = clip;
    }
    const act = (P as unknown as { current: THREE.AnimationAction | null }).current;
    if (act) act.timeScale = rate;
    P.root.position.copy(pos);
    if (this.dead >= 0) {
      // the fall: over backwards (or sideways) in half a second, then still
      this.dead += dt;
      const k = Math.min(1, this.dead / 0.55);
      const e = k * k;
      P.root.rotation.set(-e * 1.45, this.fallYaw + Math.PI, e * 0.25 * this.fallDir, 'YXZ');
      P.root.position.y = pos.y + e * 0.12;
      P.update(this.dead < 0.6 ? dt : 0);
      if (this.gun) this.gun.group.visible = false;
      return;
    }
    P.root.rotation.set(0, yaw, 0);
    if (this.gun) this.gun.group.visible = true;
    P.update(dt);
    this.aim += ((this.aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    this.kick = Math.max(0, this.kick - dt * 9);
    if (!this.gun || !this.weapon) return;
    this.pose(yaw);
  }

  private pose(yaw: number) {
    const P = this.person;
    const spec = WEAPONS[this.weapon!];
    const g = this.gun!;
    const fwd = this.v1.set(Math.sin(yaw), 0, Math.cos(yaw));
    const right = this.v2.set(-Math.cos(yaw), 0, Math.sin(yaw));
    // the aim: blend from the low ready (forward and down) to the aim direction
    const low = this.v3.copy(fwd).multiplyScalar(spec.long ? 0.75 : 0.45).addScaledVector(UP, spec.long ? -0.62 : -0.9).normalize();
    const dir = this.v4.copy(low).lerp(this.aimDir, this.aim).normalize();
    // ---- the torso turns and bends toward the aim
    const pitch = Math.asin(THREE.MathUtils.clamp(this.aimDir.y, -0.95, 0.95)) * this.aim;
    const ay = Math.atan2(this.aimDir.x, this.aimDir.z);
    const dyaw = Math.atan2(Math.sin(ay - yaw), Math.cos(ay - yaw)) * this.aim;
    P.rotateWorld('Bip01_Spine1', UP, dyaw * 0.5);
    P.rotateWorld('Bip01_Spine2', UP, dyaw * 0.5);
    const rAxis = right.clone().applyAxisAngle(UP, dyaw);
    P.rotateWorld('Bip01_Spine1', rAxis, -pitch * 0.35 - this.kick * 0.15);
    P.rotateWorld('Bip01_Spine2', rAxis, -pitch * 0.35);
    P.rotateWorld('Bip01_Head', rAxis, -pitch * 0.2);
    // ---- where the gun is: from the right shoulder (rifle) or out in front (pistol)
    const sR = P.worldOf('Bip01_R_UpperArm', new THREE.Vector3());
    const sL = P.worldOf('Bip01_L_UpperArm', new THREE.Vector3());
    const chest = sR.clone().add(sL).multiplyScalar(0.5);
    const rr = rAxis.clone();
    const grip = new THREE.Vector3();
    if (spec.long) {
      // shouldered: the grip ~22 cm ahead of the shoulder pocket, a little low and inboard
      grip.copy(sR).addScaledVector(dir, 0.2 - this.kick * 0.05).addScaledVector(UP, -0.1 + this.aim * 0.055).addScaledVector(rr, -0.06);
      if (this.aim < 0.5) grip.addScaledVector(fwd, 0.08 * (1 - this.aim));
    } else {
      // pistol: arms out, both hands together under the eye line
      const reach = 0.12 + 0.36 * this.aim - this.kick * 0.05;
      grip.copy(this.aim > 0.05 ? chest : sR).addScaledVector(dir, reach).addScaledVector(UP, -0.06 - 0.1 * (1 - this.aim));
      if (this.aim < 1) grip.addScaledVector(rr, 0.1 * (1 - this.aim));
    }
    // orient the gun: forward along dir (kicked up by the recoil), up as near world up as it goes
    const gdir = dir.clone().addScaledVector(UP, this.kick * 0.25).normalize();
    const side = new THREE.Vector3().crossVectors(UP, gdir).normalize();
    const gup = new THREE.Vector3().crossVectors(gdir, side).normalize();
    this.m.makeBasis(side, gup, gdir);
    g.group.quaternion.setFromRotationMatrix(this.m);
    g.group.position.copy(grip);
    g.group.updateMatrixWorld(true);
    // ---- the hands onto it
    this.reach('R', grip, rr, 1);
    const support = g.support.clone().applyMatrix4(g.group.matrixWorld);
    if (spec.long || this.aim > 0.3) this.reach('L', support, rr.clone().negate(), spec.long ? 1 : this.aim);
    P.root.updateMatrixWorld(true);
  }

  /** two-bone IK: the arm's hand to `target`, the elbow out and down toward `out` */
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
    // the pole: down and out, square to the shoulder→hand line
    const pole = out.clone().multiplyScalar(0.6).addScaledVector(UP, -1);
    pole.addScaledVector(dn, -pole.dot(dn)).normalize();
    const E = S.clone().addScaledVector(dn, a * cosA).addScaledVector(pole, a * sinA);
    P.aim(ua, fa, E.clone().sub(S));
    const E1 = P.worldOf(fa, new THREE.Vector3());
    P.aim(fa, ha, T.clone().sub(E1));
  }

  /** the muzzle in the world */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return this.person.worldOf('Bip01_R_Hand', out);
    return out.copy(this.gun.muzzle).applyMatrix4(this.gun.group.matrixWorld);
  }

  eject(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return out.set(0, -999, 0);
    return out.copy(this.gun.eject).applyMatrix4(this.gun.group.matrixWorld);
  }

  /** the gun's barrel direction */
  barrel(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return out.copy(this.aimDir);
    return out.set(0, 0, 1).applyQuaternion(this.gun.group.getWorldQuaternion(this.q));
  }

  dispose() {
    this.person.dispose();
    this.root.removeFromParent();
  }
}
