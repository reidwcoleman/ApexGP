import * as THREE from 'three';
import type { CollisionWorld } from './sim/collide.ts';

/**
 * The open world's camera: a chase camera that trails the direction of travel (not just the
 * nose, so a drift shows the car sideways), pulls back and widens with speed, swings round with the
 * mouse or the right stick and drifts back behind; a far chase; the bonnet; the cockpit (from the
 * driver's eyes, looking round with the mouse); a flight chase that banks with the aircraft; and an
 * over-the-shoulder camera on foot. It never goes through a building: the line from the subject is
 * tested against the city and the camera comes in.
 */

export type CamMode = 'chase' | 'far' | 'hood' | 'cockpit';
export const CAM_MODES: CamMode[] = ['chase', 'far', 'hood', 'cockpit'];

export interface CamSubject {
  pos: THREE.Vector3;
  yaw: number;
  /** velocity (world) */
  vel: THREE.Vector3;
  /** an aircraft's full orientation (flight cams bank with it) */
  quat?: THREE.Quaternion;
  /** the body (for the cockpit / bonnet views): eye in body space */
  body?: THREE.Object3D;
  eye?: THREE.Vector3;
  hood?: THREE.Vector3;
  /** size: the chase distance scales with it */
  size: number;
  kind: 'car' | 'bike' | 'flight' | 'plane' | 'foot';
}

export class CameraRig {
  mode: CamMode = 'chase';
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private heading = 0;
  private yawOff = 0;
  private pitchOff = 0.12;
  private idle = 0;
  private shake = 0;
  private first = true;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  fov = 60;
  /** on foot with the mouse captured: the camera is yours (no drifting back behind) */
  freeAim = false;
  /** 0 … 1 aiming down the sights (eased by the caller) */
  aim = 0;
  /** aimed field of view (the gun's), and the scope (first person) */
  aimFov = 46;
  scope = false;
  /** the camera's pitch on foot (rad, + up) */
  footPitch = 0.05;
  /** recoil: the view kicks up */
  kick(pitch: number, yaw: number) {
    this.footPitch = THREE.MathUtils.clamp(this.footPitch + pitch, -1.25, 1.25);
    this.yawOff += yaw;
  }

  constructor(private readonly cam: THREE.PerspectiveCamera) {}

  cut() {
    this.first = true;
  }

  bump(k: number) {
    this.shake = Math.min(1.2, this.shake + k);
  }

  /** mouse / stick look (px) */
  look2(dx: number, dy: number, dragging: boolean) {
    if (Math.abs(dx) + Math.abs(dy) > 0 || dragging) this.idle = 0;
    const sens = this.freeAim ? 0.0024 * (1 - this.aim * 0.45) * (this.scope ? 0.25 : 1) : 0.005;
    this.yawOff -= dx * sens;
    this.pitchOff = THREE.MathUtils.clamp(this.pitchOff + dy * 0.004, -0.5, 1.2);
    this.footPitch = THREE.MathUtils.clamp(this.footPitch - dy * sens, -1.25, 1.25);
  }

  update(dt: number, S: CamSubject, world: CollisionWorld) {
    const cam = this.cam;
    this.idle += dt;
    const speed = S.vel.length();
    // the look offset drifts back behind once left alone (sooner when moving)
    if (this.idle > (speed > 4 ? 0.9 : 3) && !(S.kind === 'foot' && this.freeAim)) {
      const k = Math.min(1, dt * (speed > 4 ? 2.2 : 0.8));
      this.yawOff -= this.yawOff * k;
      this.pitchOff += (0.12 - this.pitchOff) * k;
    }
    this.yawOff = Math.atan2(Math.sin(this.yawOff), Math.cos(this.yawOff));
    // the heading the camera trails: the nose, eased toward the direction of travel at speed
    const velYaw = Math.atan2(S.vel.x, S.vel.z);
    let want = S.yaw;
    if (S.kind !== 'foot' && speed > 3) {
      const d = Math.atan2(Math.sin(velYaw - S.yaw), Math.cos(velYaw - S.yaw));
      // reversing: keep looking forward
      if (Math.abs(d) < 2.2) want = S.yaw + d * 0.55;
    }
    if (this.first) {
      // (into free aim: keep looking the same way)
      if (S.kind === 'foot' && this.freeAim) {
        const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
        this.heading = e.y + Math.PI;
        this.yawOff = 0;
      } else this.heading = want;
    }
    const dh = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
    if (!(S.kind === 'foot' && this.freeAim)) this.heading += dh * Math.min(1, dt * (S.kind === 'foot' ? 3 : 4.5));
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const jitter = () => (Math.random() - 0.5) * sh * 0.25;

    if ((this.mode === 'cockpit' || this.mode === 'hood') && S.body && S.kind !== 'foot') {
      const p = this.mode === 'cockpit' ? (S.eye ?? new THREE.Vector3(0.35, 1, -0.3)) : (S.hood ?? new THREE.Vector3(0, 1.0, 1.2));
      S.body.updateWorldMatrix(true, false);
      cam.position.copy(p).applyMatrix4(S.body.matrixWorld);
      const q = new THREE.Quaternion().setFromRotationMatrix(this.tmpM.extractRotation(S.body.matrixWorld));
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.pitchOff * 0.6 + 0.08, Math.PI + this.yawOff, 0, 'YXZ')));
      this.setFov(this.mode === 'cockpit' ? 68 + speed * 0.05 : 64 + speed * 0.12, dt);
      cam.position.x += jitter() * 0.3;
      cam.position.y += jitter() * 0.3;
      this.first = false;
      return;
    }

    // on foot with the mouse: an over-the-shoulder shooter's camera, pivoting at the shoulder
    if (S.kind === 'foot' && this.freeAim) {
      const yaw = this.heading + this.yawOff;
      const p = this.footPitch;
      const f = this.tmp.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      const a = this.aim;
      if (this.scope && a > 0.85) {
        // through the scope: at the eye
        cam.position.set(S.pos.x, S.pos.y + 1.62, S.pos.z).addScaledVector(right, 0.06).addScaledVector(f, 0.25);
        cam.up.set(0, 1, 0);
        cam.lookAt(this.look.copy(cam.position).add(f));
        this.setFov(this.aimFov, dt * 4);
        this.first = false;
        return;
      }
      const pivot = this.tmp2.set(S.pos.x, S.pos.y + 1.58 - a * 0.04, S.pos.z).addScaledVector(right, 0.55 + a * 0.15);
      const dist = THREE.MathUtils.lerp(3.1, 1.65, a) + Math.max(0, -p) * 0.6;
      const desired = new THREE.Vector3().copy(pivot).addScaledVector(f, -dist);
      // walls: pull in along the boom
      const t = world.segmentHits(pivot.x, pivot.z, desired.x, desired.z, Math.max(pivot.y, desired.y) - 0.3);
      if (t < 1) desired.lerpVectors(pivot, desired, Math.max(0.12, t - 0.08));
      if (desired.y < S.pos.y + 0.3) desired.y = S.pos.y + 0.3;
      cam.position.copy(desired);
      cam.position.x += jitter() * 0.4;
      cam.position.y += jitter() * 0.4;
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look.copy(pivot).addScaledVector(f, 30));
      this.setFov(THREE.MathUtils.lerp(58, this.aimFov, a), dt * 2);
      this.first = false;
      return;
    }

    // chase family
    const far = this.mode === 'far';
    const base = S.kind === 'foot' ? 3.4 : S.kind === 'bike' ? 4.6 : S.kind === 'flight' ? 8 : S.kind === 'plane' ? 16 : 5.6;
    const dist = base * (far ? 1.55 : 1) * (S.size / 4.6) ** 0.5 + Math.min(speed, 60) * (S.kind === 'foot' ? 0 : 0.035);
    const height = S.kind === 'foot' ? 1.75 : (far ? 2.6 : 1.75) * Math.max(0.8, (S.size / 4.6) ** 0.5);
    const yaw = this.heading + this.yawOff;
    const pitch = this.pitchOff + (S.kind === 'flight' || S.kind === 'plane' ? 0.05 : 0);
    const cp = Math.cos(pitch * 0.6);
    const desired = this.tmp.set(-Math.sin(yaw) * dist * cp, height + Math.sin(pitch * 0.6) * dist, -Math.cos(yaw) * dist * cp).add(S.pos);
    if (S.kind === 'foot') {
      // over the right shoulder
      desired.x += Math.cos(yaw) * -0.6;
      desired.z += -Math.sin(yaw) * -0.6;
    }
    // the city never comes between the camera and the subject
    const from = this.tmp2.copy(S.pos).add(new THREE.Vector3(0, S.kind === 'foot' ? 1.5 : 1.2, 0));
    const t = world.segmentHits(from.x, from.z, desired.x, desired.z, Math.max(from.y, desired.y) - 0.5);
    if (t < 1) desired.lerpVectors(from, desired, Math.max(0.15, t - 0.06));
    if (desired.y < S.pos.y + 0.4) desired.y = S.pos.y + 0.4;
    if (this.first) {
      this.pos.copy(desired);
      this.vel.set(0, 0, 0);
    } else {
      // a stiff spring (no lag at speed: the trail comes from the heading easing)
      const k = S.kind === 'foot' ? 60 : 140;
      const c = 2 * Math.sqrt(k) * 0.95;
      const ax = (desired.x - this.pos.x) * k - this.vel.x * c;
      const ay = (desired.y - this.pos.y) * k - this.vel.y * c;
      const az = (desired.z - this.pos.z) * k - this.vel.z * c;
      this.vel.x += ax * dt;
      this.vel.y += ay * dt;
      this.vel.z += az * dt;
      this.pos.addScaledVector(this.vel, dt);
      // and never too far behind (a teleport, a respawn)
      if (this.pos.distanceTo(desired) > dist * 3) this.pos.copy(desired);
    }
    cam.position.copy(this.pos);
    cam.position.x += jitter();
    cam.position.y += jitter();
    const lookAhead = S.kind === 'foot' ? 0 : Math.min(speed * 0.08, 4);
    this.look.set(S.pos.x + Math.sin(this.heading) * lookAhead, S.pos.y + (S.kind === 'foot' ? 1.55 : S.kind === 'plane' ? 1.5 : 1.05), S.pos.z + Math.cos(this.heading) * lookAhead);
    cam.up.set(0, 1, 0);
    if (S.quat && (S.kind === 'flight' || S.kind === 'plane')) {
      // bank a little with the aircraft
      const e = new THREE.Euler().setFromQuaternion(S.quat, 'YXZ');
      cam.up.set(Math.sin(e.z) * 0.35 * Math.cos(e.y), 1, -Math.sin(e.z) * 0.35 * Math.sin(e.y)).normalize();
    }
    cam.lookAt(this.look);
    const fov = S.kind === 'foot' ? 55 : 57 + Math.min(speed, 90) * 0.17 + (far ? -4 : 0);
    this.setFov(fov, dt);
    this.first = false;
  }

  private readonly tmpM = new THREE.Matrix4();

  private setFov(f: number, dt: number) {
    this.fov += (f - this.fov) * Math.min(1, dt * 3);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
