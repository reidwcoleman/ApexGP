import * as THREE from 'three';
import type { CarRig } from '../car/CarModel.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import type { Track } from '../world/Track.ts';

/**
 * Copies a CarPhysics state onto a CarRig: pose on the track surface,
 * chassis pitch/roll/heave, wheels, steering, brakes, DRS, LOD by distance.
 */
export class CarView {
  readonly rig: CarRig;
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private detail: 0 | 1 | 2 = 0;
  private first = true;

  constructor(rig: CarRig) {
    this.rig = rig;
  }

  sync(car: CarPhysics, track: Track, dt: number, camPos: THREE.Vector3, isPlayer: boolean, rainLight: boolean) {
    const rig = this.rig;
    const f = track.frame(car.s);
    // road plane height under the car
    track.point(car.s, car.lateral, 0, this.pos);
    this.pos.x = car.x;
    this.pos.z = car.z;
    this.up.copy(f.up);
    if (this.first) {
      this.smoothedUp.copy(this.up);
      this.first = false;
    } else this.smoothedUp.lerp(this.up, Math.min(1, dt * 12)).normalize();

    this.fwd.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    this.fwd.addScaledVector(this.smoothedUp, -this.fwd.dot(this.smoothedUp)).normalize();
    this.left.crossVectors(this.smoothedUp, this.fwd).normalize();
    this.m.makeBasis(this.left, this.smoothedUp, this.fwd);
    this.q.setFromRotationMatrix(this.m);
    rig.root.position.copy(this.pos);
    rig.root.quaternion.copy(this.q);

    rig.body.rotation.x = car.pitch;
    rig.body.rotation.z = -car.roll;
    rig.body.position.y = car.heave;

    rig.setSteer(car.steer);
    rig.setWheelSpin(car.wheelAngleF, car.wheelAngleR);
    rig.setWheelSpeed(Math.abs(car.vx));
    rig.setBrakeGlow(car.brakeHeat);
    rig.setDrs(car.drsAnim);
    rig.setRainLight(rainLight);

    const d = camPos.distanceTo(this.pos);
    const want: 0 | 1 | 2 = isPlayer || d < 28 ? 0 : d < 90 ? 1 : 2;
    if (want !== this.detail) {
      this.detail = want;
      rig.setDetail(want);
    }
    rig.update(dt);
  }
}
