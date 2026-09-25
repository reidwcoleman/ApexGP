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

/**
 * A broadcast camera position: a tower on the outside of a braking zone (sees the
 * car arrive, brake and turn in), a low apex camera on the inside kerb (the car
 * sweeps past close), an exit camera, or a panning camera on a straight.
 */
type ShotKind = 'tower' | 'apex' | 'exit' | 'pan';
interface TvCam {
  s: number;
  pos: THREE.Vector3;
  kind: ShotKind;
  /** track distance this camera covers (s, wrapped: from → to) */
  from: number;
  to: number;
  /** metres of scene the operator frames around the car (the zoom) */
  frame: number;
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
  private readonly chaseLook = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, track: Track) {
    this.camera = camera;
    this.buildTv(track);
  }

  /** place the broadcast cameras around the lap from the corners, then fill the straights */
  private buildTv(track: Track) {
    const L = track.length;
    const add = (s: number, side: number, lat: number, h: number, kind: ShotKind, from: number, to: number, frame: number) => {
      s = track.wrap(s);
      // never on the pit-wall side of the pit straight
      if (track.inPit(s)) side = -track.pit.side;
      const hw = track.halfWidthAt(s);
      const bar = track.barrierAt(s, side);
      const l = Math.max(hw + 1.6, Math.min(bar - 1.4, lat));
      const pos = track.point(s, side * l, h);
      this.tv.push({ s, pos, kind, from: track.wrap(from), to: track.wrap(to), frame });
    };
    const covered: [number, number][] = [];
    for (const c of track.corners) {
      const outside = -c.dir;
      const slow = c.radius < 90;
      // tower on the outside before the braking zone, looking back up the straight
      add(c.sStart - 55, outside, track.halfWidthAt(c.sStart) + 14, slow ? 9 : 7, 'tower', c.sStart - 230, c.sApex + 10, slow ? 10 : 12);
      // low camera on the inside at the apex (tight corners: the car sweeps right past)
      if (c.radius < 260) add(c.sApex, c.dir, track.halfWidthAt(c.sApex) + 2.6, 0.75, 'apex', c.sApex - 45, c.sApex + 28, 0);
      // exit: outside, a little up, watching it put the power down
      add(c.sEnd + 45, outside, track.halfWidthAt(c.sEnd) + 8, 3.6, 'exit', c.sApex + 10, c.sEnd + 150, 7.5);
      covered.push([c.sStart - 230, c.sEnd + 150]);
    }
    // straights the corner cameras don't reach: panning cameras every ~230 m
    const inCover = (s: number) => covered.some(([a, b]) => track.delta(a, s) >= 0 && track.delta(s, b) >= 0);
    let flip = 1;
    for (let s = 0; s < L; s += 230) {
      if (inCover(s + 60)) continue;
      add(s, flip, track.halfWidthAt(s) + 9, 3.2 + (flip > 0 ? 1.5 : 0), 'pan', s - 170, s + 150, 6.5);
      flip = -flip;
    }
    this.tv.sort((a, b) => a.s - b.s);
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
      // spring the camera's offset from the car (not its world position): a world-space spring
      // trails a car at 300 km/h by ~2v/ω ≈ 12 m; the offset only lags the car's turns and surges
      const want = this.v3.set(-Math.sin(this.camYaw) * dist, height, -Math.cos(this.camYaw) * dist);
      if (!this.initialized) {
        this.camPos.copy(want);
        this.camVel.set(0, 0, 0);
      }
      spring(this.camPos, this.camVel, want, far ? 11 : 14, far ? 7 : 8.5, dt);
      this.v4.copy(carPos).add(this.camPos);
      // keep above the road surface
      const ground = track.point(car.s, car.lateral).y;
      this.v4.y = Math.max(this.v4.y, ground + 0.9);
      // look a touch into the corner (from the yaw rate), easing in and out
      const leadT = speed > 8 && !this.lookBack ? THREE.MathUtils.clamp(car.r * 0.16, -0.14, 0.14) : 0;
      this.lead += (leadT - this.lead) * Math.min(1, dt * 3);
      const ly = this.camYaw + this.lead;
      const look = this.v3.set(carPos.x + Math.sin(ly) * 3.4, carPos.y + (far ? 0.75 : 0.88), carPos.z + Math.cos(ly) * 3.4);
      if (this.lookBack) look.set(carPos.x + Math.sin(this.camYaw) * 3.0, carPos.y + 0.9, carPos.z + Math.cos(this.camYaw) * 3.0);
      // (also relative to the car, or it trails v/20 m behind at speed)
      look.sub(carPos);
      if (!this.initialized) this.chaseLook.copy(look);
      this.chaseLook.lerp(look, Math.min(1, dt * 20));
      this.camLook.copy(carPos).add(this.chaseLook);
      cam.position.copy(this.v4);
      cam.position.x += sx;
      cam.position.y += sy;
      cam.lookAt(this.camLook);
      this.setFov((far ? 54 : 56) + Math.min(1, kmh / 330) * 12, dt, !this.initialized);
      this.initialized = true;
      return;
    }

    if (this.mode === 'tv') {
      this.tvShot(dt, car, carPos, fwdCar, speed, track);
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

  /** TV director + operator: cut between the cameras that cover the car, frame and follow like a person on a long lens */
  private tvShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number, track: Track) {
    const cam = this.camera;
    this.tvAge += dt;
    const covers = (c: TvCam) => track.delta(c.from, car.s) >= 0 && track.delta(car.s, c.to) >= 0;
    const cur = this.tvIndex >= 0 ? this.tv[this.tvIndex] : null;
    // hold a shot at least ~2.5 s; cut when the car leaves it, or to a fresher angle after a while
    let pick = this.tvIndex;
    const stale = !cur || !covers(cur) || (this.tvAge > 7.5 && cur.kind !== 'apex');
    if (stale || this.tvAge > 2.5) {
      let best = -1;
      let bestScore = -Infinity;
      this.tv.forEach((c, i) => {
        if (!covers(c)) return;
        // the camera the car is heading toward (least of its coverage used), with a bonus for the dramatic ones
        const used = track.delta(c.from, car.s) / Math.max(1, track.delta(c.from, c.to));
        const dAhead = track.delta(car.s, c.s);
        let score = -used + (c.kind === 'apex' && dAhead > 8 && dAhead < 40 ? 0.6 : 0) + (c.kind === 'tower' ? 0.15 : 0);
        if (i === this.tvIndex) score += stale ? -5 : 0.35;
        const d = c.pos.distanceTo(carPos);
        if (d > 420) score -= 2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best < 0) {
        // nothing covers this bit: nearest camera ahead
        let bd = Infinity;
        this.tv.forEach((c, i) => {
          const dd = track.delta(car.s, c.s);
          if (dd > -30 && dd < bd) {
            bd = dd;
            best = i;
          }
        });
      }
      if (best >= 0 && (stale || best !== this.tvIndex)) pick = best;
    }
    if (pick !== this.tvIndex) {
      this.tvIndex = pick;
      this.tvAge = 0;
      this.initialized = false;
    }
    const tc = this.tv[Math.max(0, this.tvIndex)];
    const dist = tc.pos.distanceTo(carPos);
    // the operator leads the car a little and trails its moves by a beat
    const look = this.v3.copy(carPos).addScaledVector(fwdCar, Math.min(tc.kind === 'apex' ? 2 : 6, speed * 0.06));
    look.y += tc.kind === 'apex' ? 0.45 : 0.55;
    const t = this.shakeT;
    const hand = tc.kind === 'apex' ? 0 : dist * 0.0018;
    look.x += (Math.sin(t * 0.83) + Math.sin(t * 2.1) * 0.35) * hand;
    look.y += Math.sin(t * 1.27 + 1) * hand * 0.7;
    look.z += Math.sin(t * 0.61 + 2) * hand * 0.6;
    if (!this.initialized) {
      this.camLook.copy(look);
      this.tvLookV.set(0, 0, 0);
    }
    // a critically damped pan: smooth starts and stops, a slight lag on a fast car
    spring(this.camLook, this.tvLookV, look, tc.kind === 'apex' ? 14 : 8.5, 8.5, dt);
    cam.position.copy(tc.pos);
    // the platform sways in the wind; the apex camera shakes as the car thunders past
    const pass = tc.kind === 'apex' ? Math.max(0, 1 - dist / 25) * Math.min(1, speed / 60) : 0;
    cam.position.x += Math.sin(t * 0.7) * 0.02 + Math.sin(t * 47) * 0.012 * pass;
    cam.position.y += Math.sin(t * 0.9 + 2) * 0.015 + Math.sin(t * 59) * 0.012 * pass;
    cam.lookAt(this.camLook);
    // zoom: hold the car at a set size in frame (apex cam: fixed wide lens)
    const aspect = Math.max(0.5, cam.aspect);
    const fov = tc.kind === 'apex' ? 46 : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tc.frame / (2 * dist * aspect))), 2.2, 50);
    this.setFov(fov, dt * 0.6, !this.initialized);
    this.initialized = true;
    // focus pull on the car; a long lens has a shallow depth of field
    this.tvFocus.copy(carPos);
    this.tvFocus.y += 0.5;
    this.tvDof = tc.kind === 'apex' ? 0.5 : THREE.MathUtils.clamp(8 / Math.max(3, this.fov), 0.5, 2.4);
    this.tvRange = Math.max(4, dist * 0.1);
  }
  private tvAge = 0;
  private readonly tvLookV = new THREE.Vector3();
  /** TV camera focus (for the game's depth of field) */
  readonly tvFocus = new THREE.Vector3();
  tvDof = 1;
  tvRange = 5;

  private setFov(target: number, dt: number, snap: boolean) {
    this.fov = snap ? target : this.fov + (target - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
