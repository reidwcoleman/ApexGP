import * as THREE from 'three';
import { normalAt, sdf } from '../sim/arena.ts';
import { V3 } from '../sim/math.ts';
import { S } from './stage.ts';

/**
 * The chase camera, with the real game's default settings: 110° horizontal FOV, 270 back, 100 up,
 * −4° angle, stiffness 0.45, swivel. Car cam follows the car's heading on the ground (tilting with it
 * up the walls) and its velocity in the air; ball cam keeps the ball in frame behind the car. Kept
 * inside the arena; shakes on goals and demolitions. Positions are in the simulation frame.
 */

export const CAM = { FOV: 110, DIST: 270, HEIGHT: 100, ANGLE: -4, STIFF: 0.45 };

export interface CamTarget {
  pos: V3; // car origin (smoothed)
  f: V3;
  u: V3;
  vel: V3;
  onGround: boolean;
  ball: V3;
}

const tV = new V3();

export class ChaseCam {
  pos = new V3(0, -6000, 800);
  look = new V3();
  up = new V3(0, 0, 1);
  heading = new V3(0, 1, 0);
  ballCam = true;
  private ballK = 1;
  private shakeT = 0;
  private shakeA = 0;
  fov = CAM.FOV;

  shake(a: number, t = 0.5): void {
    this.shakeA = Math.max(this.shakeA, a);
    this.shakeT = Math.max(this.shakeT, t);
  }

  snap(t: CamTarget): void {
    this.heading.set(t.f.x, t.f.y, 0).norm();
    if (this.ballCam) this.heading.set(t.ball.x - t.pos.x, t.ball.y - t.pos.y, 0).norm();
    this.up.set(0, 0, 1);
    this.compute(t, 1, true);
  }

  update(t: CamTarget, dt: number): void {
    this.ballK += ((this.ballCam ? 1 : 0) - this.ballK) * Math.min(1, dt * 5);
    // the camera's up: the car's on walls, the world's in the air
    const wantUp = t.onGround ? t.u : tV.set(0, 0, 1);
    this.up.x += (wantUp.x - this.up.x) * Math.min(1, dt * 4);
    this.up.y += (wantUp.y - this.up.y) * Math.min(1, dt * 4);
    this.up.z += (wantUp.z - this.up.z) * Math.min(1, dt * 4);
    this.up.norm();
    // car-cam heading: the bonnet on the ground, the velocity in the air
    const h = new V3();
    if (t.onGround || t.vel.len() < 300) h.copy(t.f);
    else h.copy(t.vel);
    h.addScaled(this.up, -h.dot(this.up));
    if (h.len2() < 1e-4) h.copy(this.heading);
    h.norm();
    // ball-cam heading: toward the ball
    const hb = new V3().subVectors(t.ball, t.pos);
    hb.addScaled(this.up, -hb.dot(this.up));
    if (hb.len2() > 1) hb.norm();
    else hb.copy(h);
    const want = h.scale(1 - this.ballK).addScaled(hb, this.ballK).norm();
    const k = Math.min(1, dt * (this.ballCam ? 9 : 6));
    this.heading.x += (want.x - this.heading.x) * k;
    this.heading.y += (want.y - this.heading.y) * k;
    this.heading.z += (want.z - this.heading.z) * k;
    this.heading.addScaled(this.up, -this.heading.dot(this.up)).norm();
    this.compute(t, dt, false);
  }

  private compute(t: CamTarget, dt: number, snap: boolean): void {
    const want = new V3().copy(t.pos).addScaled(this.heading, -CAM.DIST).addScaled(this.up, CAM.HEIGHT);
    // keep it inside the walls
    const d = sdf(want.x, want.y, want.z);
    if (d < 40) {
      const n = normalAt(want.x, want.y, want.z, new V3());
      want.addScaled(n, 40 - d);
    }
    if (snap) this.pos.copy(want);
    else {
      // stiffness: a little lag behind the car, tighter at speed
      const k = 1 - Math.exp(-dt * (12 + CAM.STIFF * 30));
      this.pos.x += (want.x - this.pos.x) * k;
      this.pos.y += (want.y - this.pos.y) * k;
      this.pos.z += (want.z - this.pos.z) * k;
    }
    // where it looks: ahead of the car (car cam) or at the ball, pitch-limited (ball cam)
    const ahead = new V3().copy(t.pos).addScaled(this.up, CAM.HEIGHT * 0.62).addScaled(this.heading, 200);
    const toBall = new V3().subVectors(t.ball, this.pos);
    const bl = toBall.len();
    const lookBall = new V3().copy(this.pos).addScaled(toBall, Math.min(1, 1200 / Math.max(1, bl)));
    // don't tip up past ~35° looking at a high ball, keep the car in frame
    const look = ahead.scale(1 - this.ballK).addScaled(lookBall, this.ballK);
    const dirL = new V3().subVectors(look, this.pos);
    const upC = dirL.dot(this.up) / Math.max(1, dirL.len());
    if (upC > 0.55) look.addScaled(this.up, -(upC - 0.55) * dirL.len());
    if (upC < -0.35) look.addScaled(this.up, (-0.35 - upC) * dirL.len());
    this.look.copy(look);
  }

  apply(cam: THREE.PerspectiveCamera, dt: number): void {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeA * Math.max(0, this.shakeT);
      sx = (Math.random() - 0.5) * a;
      sy = (Math.random() - 0.5) * a;
      sz = (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeA = 0;
    }
    cam.position.set((this.pos.x + sx) * S, (this.pos.z + sz) * S, -(this.pos.y + sy) * S);
    cam.up.set(this.up.x, this.up.z, -this.up.y);
    cam.lookAt(this.look.x * S, this.look.z * S, -this.look.y * S);
  }
}

/** free cameras for replays, the kickoff intro and spectating */
export function placeCam(cam: THREE.PerspectiveCamera, pos: V3, look: V3): void {
  cam.position.set(pos.x * S, pos.z * S, -pos.y * S);
  cam.up.set(0, 1, 0);
  cam.lookAt(look.x * S, look.z * S, -look.y * S);
}
