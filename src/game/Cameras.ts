import * as THREE from 'three';
import type { CarRig } from '../car/CarModel.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import type { Track } from '../world/Track.ts';

export type CameraMode = 'chase' | 'far' | 'tcam' | 'cockpit' | 'nose' | 'wheel' | 'heli' | 'tv';
export const CAMERA_ORDER: CameraMode[] = ['chase', 'far', 'tcam', 'cockpit', 'nose', 'wheel', 'heli', 'tv'];
export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: 'Chase',
  far: 'Chase far',
  tcam: 'T-cam',
  cockpit: 'Cockpit',
  nose: 'Nose',
  wheel: 'Wheel',
  heli: 'Helicopter',
  tv: 'TV',
};
/** cameras mounted on the car (audio hears the car from inside, the lens gets wet) */
export const ONBOARD: Partial<Record<CameraMode, true>> = { tcam: true, cockpit: true, nose: true, wheel: true };

/** critically damped spring toward a target, per axis (stable for w·dt < ~1) */
function spring(x: THREE.Vector3, v: THREE.Vector3, t: THREE.Vector3, w: number, wy: number, dt: number) {
  const h = Math.min(dt, 1 / 30);
  v.x += (w * w * (t.x - x.x) - 2 * w * v.x) * h;
  v.z += (w * w * (t.z - x.z) - 2 * w * v.z) * h;
  v.y += (wy * wy * (t.y - x.y) - 2 * wy * v.y) * h;
  x.addScaledVector(v, h);
}

interface TvCam {
  s: number;
  pos: THREE.Vector3;
}

/**
 * Race cameras. All of them read the car's rendered pose (rig.root) so they
 * never disagree with what's on screen.
 */
export class Cameras {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  lookBack = false;
  /** extra shake requested by the game (contacts) */
  impulse = 0;

  private camYaw = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private initialized = false;
  private fov = 60;
  private shakeT = 0;
  private tv: TvCam[] = [];
  private tvIndex = -1;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private headX = 0;
  private headY = 0;
  private headRoll = 0;
  private lead = 0;
  private camVel = new THREE.Vector3();
  private lookQ = new THREE.Quaternion();
  private orbitT = 0;

  constructor(camera: THREE.PerspectiveCamera, track: Track) {
    this.camera = camera;
    // TV cameras: alternate sides every ~170 m, on platforms just inside the
    // barriers (Monza's woods grow right up to the fences behind them)
    const n = Math.floor(track.length / 170);
    for (let i = 0; i < n; i++) {
      const s = track.wrap(track.startS + i * 170 + 40);
      const k = track.kappaAt(s + 60);
      // prefer the outside of the next corner; never the pit-wall side of the straight
      let side = Math.abs(k) > 1 / 400 ? (k > 0 ? 1 : -1) : i % 2 === 0 ? 1 : -1;
      if (track.inPit(s) || track.inPit(s + 60)) side = -track.pit.side;
      const bar = track.barrierAt(s, side);
      const lat = Math.max(track.halfWidthAt(s) + 4, Math.min(bar - 2.2, track.halfWidthAt(s) + 22));
      const pos = track.point(s, side * lat, 4.2 + (i % 3) * 1.2);
      this.tv.push({ s, pos });
    }
  }

  next() {
    const i = CAMERA_ORDER.indexOf(this.mode);
    this.set(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
  }

  set(mode: CameraMode) {
    this.mode = mode;
    this.initialized = false;
    this.tvIndex = -1;
  }

  /** cinematic orbit used by menus and the pre-race grid */
  orbit(dt: number, target: THREE.Vector3, radius = 7.5, height = 1.5, speed = 0.12) {
    this.orbitT += dt * speed;
    const a = this.orbitT;
    this.camera.position.set(target.x + Math.sin(a) * radius, target.y + height + Math.sin(a * 0.7) * 0.25, target.z + Math.cos(a) * radius);
    this.camera.lookAt(target.x, target.y + 0.45, target.z);
    this.setFov(34, dt, true);
    this.initialized = false;
  }

  update(dt: number, car: CarPhysics, rig: CarRig, track: Track) {
    const cam = this.camera;
    const root = rig.root;
    root.updateMatrixWorld();
    const carPos = root.getWorldPosition(this.v1);
    const speed = Math.max(0, car.vx);
    const kmh = speed * 3.6;

    // shake: speed buzz + kerbs + off-track + impacts
    this.shakeT += dt;
    this.impulse = Math.max(0, this.impulse - dt * 2.5);
    const shakeAmp =
      Math.min(1, kmh / 330) * 0.004 + (car.onKerb ? 0.018 * Math.min(1, speed / 25) : 0) + (car.offTrack ? 0.03 * Math.min(1, speed / 20) : 0) + this.impulse * 0.12;
    const sx = (Math.sin(this.shakeT * 41.3) + Math.sin(this.shakeT * 67.1) * 0.6) * shakeAmp;
    const sy = (Math.sin(this.shakeT * 53.7) + Math.sin(this.shakeT * 29.9) * 0.5) * shakeAmp;

    const fwdCar = this.v2.set(0, 0, 1).applyQuaternion(root.quaternion);

    if (this.mode === 'heli') {
      // helicopter: high and off to one side, trailing the car on a long lens
      const side = this.v3.set(fwdCar.z, 0, -fwdCar.x);
      const want = this.v4.copy(carPos).addScaledVector(fwdCar, -30).addScaledVector(side, 9);
      want.y = carPos.y + 46;
      if (!this.initialized) {
        this.camPos.copy(want);
        this.camVel.set(0, 0, 0);
      }
      spring(this.camPos, this.camVel, want, 1.6, 1.2, dt);
      const look = this.v3.copy(carPos).addScaledVector(fwdCar, Math.min(10, speed * 0.12));
      if (!this.initialized) this.camLook.copy(look);
      this.camLook.lerp(look, Math.min(1, dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      const dist = cam.position.distanceTo(carPos);
      this.setFov(THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(11 / dist)), 12, 50), dt, !this.initialized);
      this.initialized = true;
      return;
    }

    if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      const [wx, wz] = car.worldVelocity();
      // F1-game chase cam: locked to the car's heading with a short lag, so a
      // slide shows as the car rotating in frame (only a hint of the travel direction)
      let target = car.yaw;
      if (speed > 6) {
        const velYaw = Math.atan2(wx, wz);
        let d = velYaw - car.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        target = car.yaw + d * 0.15;
      }
      if (this.lookBack) target += Math.PI;
      if (!this.initialized) this.camYaw = target;
      let dy = target - this.camYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.camYaw += dy * Math.min(1, dt * (far ? 7 : 10));

      // pulls back under acceleration, closes in under braking, stretches a little with speed
      const dist = (far ? 8.4 : 5.35) + Math.max(-0.5, Math.min(0.7, -car.ax * 0.028)) + speed * 0.003;
      const height = (far ? 2.5 : 1.42) + car.heave * 0.6;
      const want = this.v3.set(carPos.x - Math.sin(this.camYaw) * dist, carPos.y + height, carPos.z - Math.cos(this.camYaw) * dist);
      // keep above the road surface
      const ground = track.point(car.s, car.lateral).y;
      want.y = Math.max(want.y, ground + 0.9);
      if (!this.initialized) {
        this.camPos.copy(want);
        this.camVel.set(0, 0, 0);
      }
      spring(this.camPos, this.camVel, want, far ? 11 : 14, far ? 7 : 8.5, dt);
      // look a touch into the corner (from the yaw rate), easing in and out
      const leadT = speed > 8 && !this.lookBack ? THREE.MathUtils.clamp(car.r * 0.16, -0.14, 0.14) : 0;
      this.lead += (leadT - this.lead) * Math.min(1, dt * 3);
      const ly = this.camYaw + this.lead;
      const look = this.v3.set(carPos.x + Math.sin(ly) * 3.4, carPos.y + (far ? 0.75 : 0.88), carPos.z + Math.cos(ly) * 3.4);
      if (this.lookBack) look.set(carPos.x + Math.sin(this.camYaw) * 3.0, carPos.y + 0.9, carPos.z + Math.cos(this.camYaw) * 3.0);
      if (!this.initialized) this.camLook.copy(look);
      this.camLook.lerp(look, Math.min(1, dt * 20));
      cam.position.copy(this.camPos);
      cam.position.x += sx;
      cam.position.y += sy;
      cam.lookAt(this.camLook);
      this.setFov((far ? 54 : 56) + Math.min(1, kmh / 330) * 12, dt, !this.initialized);
      this.initialized = true;
      return;
    }

    if (this.mode === 'tv') {
      // choose the next camera that has the car in front of or just past it
      const L = track.length;
      let best = this.tvIndex;
      if (best < 0 || track.delta(this.tv[best].s, car.s) > 70) {
        let bd = Infinity;
        this.tv.forEach((c, i) => {
          const d = track.delta(car.s, c.s);
          if (d > -40 && d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best < 0) best = 0;
        void L;
      }
      if (best !== this.tvIndex) this.initialized = false;
      this.tvIndex = best;
      const tc = this.tv[best];
      cam.position.copy(tc.pos);
      const look = this.v3.copy(carPos).addScaledVector(fwdCar, Math.min(8, speed * 0.08));
      look.y += 0.6;
      const dist = cam.position.distanceTo(carPos);
      // a camera operator: pans a beat behind the car, with a little hand-held drift
      const t = this.shakeT;
      look.x += (Math.sin(t * 0.9) + Math.sin(t * 2.3) * 0.4) * dist * 0.0022;
      look.y += Math.sin(t * 1.3 + 1) * dist * 0.0016;
      if (!this.initialized) this.camLook.copy(look);
      this.camLook.lerp(look, Math.min(1, dt * 7));
      cam.lookAt(this.camLook);
      const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(5.5 / dist)), 7, 55);
      this.setFov(fov, dt, !this.initialized);
      this.initialized = true;
      return;
    }

    // onboard cameras ride on anchors (the wheel cam on a bracket off the sidepod)
    if (this.mode === 'wheel') {
      root.getWorldQuaternion(this.q);
      this.v3.set(0.66, 0.64, -0.1).applyMatrix4(root.matrixWorld);
    } else {
      const anchor = this.mode === 'cockpit' ? rig.anchors.cockpit : this.mode === 'tcam' ? rig.anchors.tcam : rig.anchors.nose;
      anchor.updateMatrixWorld();
      anchor.getWorldPosition(this.v3);
      anchor.getWorldQuaternion(this.q);
    }
    // the T-cam housing flexes: its view trails the chassis by a few milliseconds
    if (this.mode === 'tcam') {
      if (!this.initialized) this.lookQ.copy(this.q);
      this.lookQ.slerp(this.q, Math.min(1, dt * 22));
      this.q.copy(this.lookQ);
    }
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    const leftV = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    if (this.mode === 'cockpit') {
      // the head moves and tilts against the G-forces, and buzzes with the engine
      const hx = THREE.MathUtils.clamp(-car.ay * 0.0035, -0.06, 0.06);
      const hy = THREE.MathUtils.clamp(car.ax * 0.0018, -0.03, 0.03);
      const hr = THREE.MathUtils.clamp(-car.ay * 0.0028, -0.07, 0.07);
      this.headX += (hx - this.headX) * Math.min(1, dt * 8);
      this.headY += (hy - this.headY) * Math.min(1, dt * 8);
      this.headRoll += (hr - this.headRoll) * Math.min(1, dt * 6);
      const buzz = Math.sin(this.shakeT * car.rpm * 0.05) * 0.0006 * Math.min(1, car.rpm / 11000);
      this.v3.addScaledVector(leftV, this.headX).addScaledVector(up, this.headY + buzz);
      up.addScaledVector(leftV, this.headRoll).normalize();
    }
    if (this.mode === 'tcam') this.v3.addScaledVector(up, 0.14);
    const shakeK = this.mode === 'wheel' ? 0.8 : 0.4;
    cam.position.copy(this.v3);
    cam.position.addScaledVector(up, sy * shakeK).addScaledVector(leftV, sx * shakeK);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
    if (this.lookBack) f.negate();
    // look slightly into the corner in the cockpit
    if (this.mode === 'cockpit') f.addScaledVector(leftV, car.steer * 0.9).normalize();
    // the wheel cam toes in a touch so the front tyre sits in the corner of the frame
    if (this.mode === 'wheel') f.addScaledVector(leftV, -0.12).normalize();
    const look = this.v3.clone().addScaledVector(f, 20).addScaledVector(up, this.mode === 'tcam' ? -0.9 : this.mode === 'nose' ? 0.2 : this.mode === 'wheel' ? -0.6 : -0.35);
    cam.up.copy(up);
    cam.lookAt(look);
    cam.up.set(0, 1, 0);
    const baseFov = this.mode === 'cockpit' ? 74 : this.mode === 'tcam' ? 70 : this.mode === 'wheel' ? 78 : 72;
    this.setFov(baseFov + Math.min(1, kmh / 330) * 6, dt, !this.initialized);
    this.initialized = true;
  }

  private setFov(target: number, dt: number, snap: boolean) {
    this.fov = snap ? target : this.fov + (target - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
