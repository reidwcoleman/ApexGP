import * as THREE from 'three';
import { normalAt, sdf } from '../sim/arena.ts';
import { V3 } from '../sim/math.ts';
import { S } from './stage.ts';

/**
 * The chase camera, built like the real game's: a rig pivoting on the car (distance back, height
 * up, a few degrees of downward angle) that turns to face a heading and tilts by a pitch.
 *
 * Car cam: the heading is the bonnet while the wheels are down (on a wall or the ceiling the rig's
 * "up" becomes the surface, so the car stays upright on screen), and the direction of travel in
 * the air (the rig returns to the world's up), with no pitch. Ball cam: the heading and the pitch
 * both point at the ball, so the rig swings round and dips under a high ball, keeping the car at
 * the bottom of the frame and the ball over its roof. Stiffness lets the camera fall back a little
 * at speed, transition speed sets how fast the two cams blend. Kept inside the arena; shakes on
 * goals and demolitions. Positions are in the simulation frame (cm, z up).
 */

export const CAM = { FOV: 110, DIST: 270, HEIGHT: 100, ANGLE: -4, STIFF: 0.45, TRANS: 1.2 };

export interface CamTarget {
  pos: V3; // car origin (smoothed)
  f: V3;
  u: V3;
  vel: V3;
  onGround: boolean;
  ball: V3;
}

const tA = new V3();
const tB = new V3();
const tC = new V3();
const tD = new V3();

/** rotate v about the unit axis k by angle a (Rodrigues), in place */
function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k.dot(v) * (1 - c);
  const x = v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d;
  const y = v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d;
  const z = v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d;
  return v.set(x, y, z);
}

/** the signed angle from a to b about the axis k (a and b both perpendicular to k) */
function angleAbout(a: V3, b: V3, k: V3): number {
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  return Math.atan2(cx * k.x + cy * k.y + cz * k.z, a.dot(b));
}

/** a unit vector in the plane perpendicular to n (n unit); falls back when v is along n */
function flat(v: V3, n: V3, out: V3, fallback: V3): V3 {
  out.copy(v).addScaled(n, -v.dot(n));
  if (out.len2() < 1e-6) out.copy(fallback).addScaled(n, -fallback.dot(n));
  if (out.len2() < 1e-6) out.set(Math.abs(n.z) < 0.9 ? 0 : 1, 0, Math.abs(n.z) < 0.9 ? 1 : 0).addScaled(n, Math.abs(n.z) < 0.9 ? -n.z : -n.x);
  return out.norm();
}

export class ChaseCam {
  pos = new V3(0, -6000, 800);
  look = new V3();
  /** the rig's up: the car's surface while grounded, the world's in the air */
  up = new V3(0, 0, 1);
  /** where the rig faces, perpendicular to up */
  heading = new V3(0, 1, 0);
  /** the rig's tilt toward a high (or low) ball, radians */
  pitch = 0;
  ballCam = true;
  private ballK = 1;
  private shakeT = 0;
  private shakeA = 0;
  /** smoothed extra distance from stiffness */
  private lag = 0;
  private airT = 0;
  fov = CAM.FOV;

  shake(a: number, t = 0.5): void {
    this.shakeA = Math.max(this.shakeA, a);
    this.shakeT = Math.max(this.shakeT, t);
  }

  snap(t: CamTarget): void {
    this.ballK = this.ballCam ? 1 : 0;
    this.up.set(0, 0, 1);
    if (t.onGround) this.up.copy(t.u);
    const [h, p] = this.aim(t);
    this.heading.copy(h);
    this.pitch = p;
    this.lag = 0;
    this.compute(t, 1, true);
  }

  /** the heading and pitch this frame wants (blended car cam / ball cam) */
  private aim(t: CamTarget): [V3, number] {
    const up = this.up;
    // car cam: the bonnet on a surface; the direction of travel in the air (the bonnet when slow)
    const hc = tA;
    tD.copy(t.vel).addScaled(up, -t.vel.dot(up));
    if (t.onGround || tD.len() < 500) flat(t.f, up, hc, this.heading);
    else hc.copy(tD).norm();
    // ball cam: straight at the ball, pitch included
    const d = tB.subVectors(t.ball, t.pos);
    const along = d.dot(up);
    const hb = flat(d, up, tC, hc);
    const horiz = Math.sqrt(Math.max(0, d.len2() - along * along));
    // close underneath the ball its bearing swings wildly: lean on the car's heading there
    const sure = Math.min(1, horiz / 260);
    hb.scale(sure).addScaled(hc, 1 - sure).norm();
    const pb = Math.max(-0.3, Math.min(1.0, Math.atan2(along - 40, Math.max(1, horiz)) * 0.85));
    const k = this.ballK;
    const h = new V3().copy(hc).scale(1 - k).addScaled(hb, k);
    if (h.len2() < 1e-4) h.copy(k > 0.5 ? hb : hc);
    return [h.norm(), pb * k];
  }

  update(t: CamTarget, dt: number): void {
    // transition speed 1..2: about a third of a second at 1.2
    this.ballK += ((this.ballCam ? 1 : 0) - this.ballK) * Math.min(1, dt * 4.5 * CAM.TRANS);
    // the rig's up follows the surface quickly on the way onto a wall, rights itself more slowly in the air
    this.airT = t.onGround ? 0 : this.airT + dt;
    const wantUp = t.onGround ? t.u : tD.set(0, 0, 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, this.up.dot(wantUp))));
    if (ang > 1e-4) {
      const rate = t.onGround ? 9 : this.airT < 0.15 ? 0 : 3.2;
      const step = ang * (1 - Math.exp(-dt * rate));
      const axis = new V3(this.up.y * wantUp.z - this.up.z * wantUp.y, this.up.z * wantUp.x - this.up.x * wantUp.z, this.up.x * wantUp.y - this.up.y * wantUp.x);
      if (axis.len2() < 1e-8) axis.copy(this.heading);
      axis.norm();
      rotate(this.up, axis, step).norm();
      // carry the heading round with the up so a wall ride doesn't swing the camera
      rotate(this.heading, axis, step);
    }
    this.heading.addScaled(this.up, -this.heading.dot(this.up));
    if (this.heading.len2() < 1e-6) flat(t.f, this.up, this.heading, t.vel);
    this.heading.norm();
    // turn toward the wanted heading (swivel): quicker in ball cam, like the real thing
    const [h, p] = this.aim(t);
    const da = angleAbout(this.heading, h, this.up);
    const turn = 1 - Math.exp(-dt * (10 + 2 * this.ballK));
    rotate(this.heading, this.up, da * turn).norm();
    this.pitch += (p - this.pitch) * (1 - Math.exp(-dt * 7));
    this.compute(t, dt, false);
  }

  private compute(t: CamTarget, dt: number, snap: boolean): void {
    const up = this.up;
    const h = this.heading;
    // the rig tilted by the pitch: its back and its up
    const side = tA.set(h.y * up.z - h.z * up.y, h.z * up.x - h.x * up.z, h.x * up.y - h.y * up.x).norm();
    const fw = new V3().copy(h).scale(Math.cos(this.pitch)).addScaled(up, Math.sin(this.pitch));
    const rup = new V3().copy(up).scale(Math.cos(this.pitch)).addScaled(h, -Math.sin(this.pitch));
    // stiffness: the camera drops back a little as the car pulls away from it
    const away = Math.max(0, t.vel.dot(fw));
    const wantLag = (1 - CAM.STIFF) * away * 0.075;
    this.lag = snap ? wantLag : this.lag + (wantLag - this.lag) * (1 - Math.exp(-dt * 3));
    const dist = CAM.DIST + this.lag;
    const want = new V3().copy(t.pos).addScaled(fw, -dist).addScaled(rup, CAM.HEIGHT);
    // keep it inside the arena: slide along the surface (the floor under a high ball, a wall behind)
    for (let k = 0; k < 2; k++) {
      const d = sdf(want.x, want.y, want.z);
      if (d >= 45) break;
      const n = normalAt(want.x, want.y, want.z, tB);
      want.addScaled(n, 45 - d);
    }
    if (snap) this.pos.copy(want);
    else {
      // tight on the rig: the lag lives in the swivel and the stiffness
      const k = 1 - Math.exp(-dt * 30);
      this.pos.x += (want.x - this.pos.x) * k;
      this.pos.y += (want.y - this.pos.y) * k;
      this.pos.z += (want.z - this.pos.z) * k;
    }
    // look along the rig, angled down a few degrees
    const a = (CAM.ANGLE * Math.PI) / 180;
    const dir = new V3().copy(fw).scale(Math.cos(a)).addScaled(rup, Math.sin(a));
    // pushed off a surface: tip down far enough to keep the car in frame
    const toCar = tC.subVectors(t.pos, this.pos);
    const cl = toCar.len();
    if (cl > 1) {
      toCar.scale(1 / cl);
      const vHalf = 0.5 * 2 * Math.atan(Math.tan((CAM.FOV * Math.PI) / 360) / (16 / 9));
      const below = Math.asin(Math.max(-1, Math.min(1, -toCar.dot(rup)))) - Math.asin(Math.max(-1, Math.min(1, -dir.dot(rup))));
      const over = below - (vHalf - 0.12);
      if (over > 0) rotate(dir, side, -over);
    }
    this.look.copy(this.pos).addScaled(dir, 1000);
    // the camera's own up, for the renderer
    this.camUp.copy(rup);
  }
  private camUp = new V3(0, 0, 1);

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
    cam.up.set(this.camUp.x, this.camUp.z, -this.camUp.y);
    cam.lookAt(this.look.x * S, this.look.z * S, -this.look.y * S);
  }
}

/** free cameras for replays, the kickoff intro and spectating */
export function placeCam(cam: THREE.PerspectiveCamera, pos: V3, look: V3): void {
  cam.position.set(pos.x * S, pos.z * S, -pos.y * S);
  cam.up.set(0, 1, 0);
  cam.lookAt(look.x * S, look.z * S, -look.y * S);
}
