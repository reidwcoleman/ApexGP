import * as THREE from 'three';

/** chase camera with speed-scaled distance/FOV that follows the car's up axis through loops */
export class ChaseCam {
  pos = new THREE.Vector3();
  look = new THREE.Vector3();
  up = new THREE.Vector3(0, 1, 0);
  dir = new THREE.Vector3(0, 0, 1);
  mode = 0; // 0 chase, 1 far chase, 2 hood
  private fov = 70;
  private init = false;

  reset() { this.init = false; }

  update(cam: THREE.PerspectiveCamera, p: THREE.Vector3, q: THREE.Quaternion, vel: THREE.Vector3, grounded: boolean, dt: number) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const carUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const speed = vel.length();

    // the up the camera uses: world up, unless the car is on a loop/wall
    const wantUp = grounded && carUp.y < 0.85 ? carUp : new THREE.Vector3(0, 1, 0);
    // follow direction: car heading, leaning toward travel when moving fast
    const want = fwd.clone();
    if (speed > 6) want.lerp(vel.clone().normalize(), Math.min(0.5, (speed - 6) / 30));
    want.normalize();

    if (!this.init) {
      this.dir.copy(want);
      this.up.copy(wantUp);
      this.init = true;
    }
    const k = 1 - Math.exp(-dt * (this.mode === 2 ? 30 : 7));
    this.dir.lerp(want, k).normalize();
    this.up.lerp(wantUp, 1 - Math.exp(-dt * 5)).normalize();

    if (this.mode === 2) {
      this.pos.copy(p).addScaledVector(carUp, 0.62).addScaledVector(fwd, 0.25);
      this.look.copy(this.pos).addScaledVector(fwd, 10);
      cam.up.copy(carUp);
    } else {
      const far = this.mode === 1;
      const dist = (far ? 8.6 : 6.4) + Math.min(speed, 70) * 0.025;
      const height = far ? 3.4 : 2.3;
      const target = p.clone().addScaledVector(this.dir, -dist).addScaledVector(this.up, height);
      // keep the camera from dropping through the ground
      target.y = Math.max(target.y, 0.6);
      this.pos.lerp(target, 1 - Math.exp(-dt * 14));
      this.look.copy(p).addScaledVector(this.up, 1.0).addScaledVector(this.dir, 3);
      cam.up.copy(this.up);
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    const fovWant = 68 + Math.min(speed, 75) * 0.22;
    this.fov += (fovWant - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  snap(cam: THREE.PerspectiveCamera, p: THREE.Vector3, q: THREE.Quaternion) {
    this.init = false;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    this.pos.copy(p).addScaledVector(fwd, -6.4).add(new THREE.Vector3(0, 2.3, 0));
    this.update(cam, p, q, new THREE.Vector3(), true, 1);
  }
}
