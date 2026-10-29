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
 * the air (the rig returns to the world's up), with no pitch. Ball cam: the heading points at the
 * ball and the view stays level, as the real one does (a ball on the roof, or a fair way up, needs
 * no tilt at all); a ball climbing out of the top of the frame tilts the view up just enough to keep
 * it in, and only once the car would drop out of the bottom does the rig swing down under the ball.
 * Stiffness lets the camera fall back a little
 * at speed, transition speed sets how fast the two cams blend. Kept inside the arena; shakes on
 * goals and demolitions. Positions are in the simulation frame (cm, z up).
 */

/** the car's half height from behind, wheels and all, for keeping it in frame */
const CAR_H = 45;

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
  /** the view's own tilt on top of the angle setting, radians */
  view = 0;
  ballCam = true;
  /** look behind (held): the rig turns to face back past the car's tail, no ball tracking */
  behind = false;
  /** the right stick swinging the camera round the car (−1…1 each way): a full push looks back */
  orbit = { x: 0, y: 0 };
  private wasBehind = false;
  private ballK = 1;
  private shakeT = 0;
  private shakeA = 0;
  /** smoothed extra distance from stiffness */
  private lag = 0;
  private airT = 0;
  /** how far the camera's pivot trails the car along the rig's up (a jump lifts the car in the
   * frame before the camera follows), and where the car was last frame */
  private lagUp = 0;
  private prevPos = new V3();
  private havePrev = false;
  fov = CAM.FOV;

  shake(a: number, t = 0.5): void {
    this.shakeA = Math.max(this.shakeA, a);
    this.shakeT = Math.max(this.shakeT, t);
  }

  snap(t: CamTarget): void {
    this.ballK = this.ballCam ? 1 : 0;
    this.up.set(0, 0, 1);
    if (t.onGround) this.up.copy(t.u);
    const [h, p, v] = this.aim(t);
    this.heading.copy(h);
    this.pitch = p;
    this.view = v;
    this.lag = 0;
    this.lagUp = 0;
    this.prevPos.copy(t.pos);
    this.havePrev = true;
    this.compute(t, 1, true);
  }

  /** the heading, the rig's pitch and the view's tilt this frame wants (blended car cam / ball cam) */
  private aim(t: CamTarget): [V3, number, number] {
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
    // the tilt is worked out from where the camera sits (back and up from the car), not from the car:
    // the view the ball wants so its top (or bottom) just fits inside the frame...
    const vHalf = Math.atan(Math.tan((CAM.FOV * Math.PI) / 360) / (16 / 9));
    const bx = horiz + CAM.DIST;
    const by = along - CAM.HEIGHT;
    const br = Math.atan2(92, Math.hypot(bx, by));
    const elev = Math.atan2(by, bx);
    const a0 = (CAM.ANGLE * Math.PI) / 180;
    let v = Math.max(a0, elev + br - vHalf + 0.12);
    v = Math.min(v, elev - br + vHalf - 0.05);
    // ...and how far the view can go before the car falls out of the bottom (or the top): past
    // that the rig swings round the car instead
    const vMax = Math.max(a0, vHalf - Math.atan2(CAM.HEIGHT, CAM.DIST) - Math.atan2(CAR_H, Math.hypot(CAM.HEIGHT, CAM.DIST)) - 0.04);
    const vMin = Math.min(a0, -vHalf + 0.25);
    const pb = v > vMax ? Math.min(1, v - vMax) : v < vMin ? Math.max(-0.3, v - vMin) : 0;
    const vb = v - pb - a0;
    if (this.behind) {
      const hr = new V3();
      flat(t.f, up, hr, this.heading);
      return [hr.scale(-1), 0, 0];
    }
    const ox = this.orbit.x;
    const oy = this.orbit.y;
    if (Math.abs(ox) > 0.02 || Math.abs(oy) > 0.02) {
      const hr = new V3();
      flat(t.f, up, hr, this.heading);
      rotate(hr, up, -ox * Math.PI).norm();
      return [hr, Math.max(-0.3, Math.min(0.9, oy * 0.8)), 0];
    }
    const k = this.ballK;
    const h = new V3().copy(hc).scale(1 - k).addScaled(hb, k);
    if (h.len2() < 1e-4) h.copy(k > 0.5 ? hb : hc);
    return [h.norm(), pb * k, vb * k];
  }

  update(t: CamTarget, dt: number): void {
    // transition speed 1..2: about a third of a second at 1.2
    this.ballK += ((this.ballCam ? 1 : 0) - this.ballK) * Math.min(1, dt * 4.5 * CAM.TRANS);
    // the rig's up follows the surface quickly on the way onto a wall, rights itself more slowly in the air
    this.airT = t.onGround ? 0 : this.airT + dt;
    const wantUp = t.onGround ? t.u : tD.set(0, 0, 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, this.up.dot(wantUp))));
    if (ang > 1e-4) {
      // (held a moment after leaving a surface, so wall taps and jumps don't swing it)
      const rate = t.onGround ? 13 : this.airT < 0.1 ? 0 : 4.5;
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
    const [h, p, v] = this.aim(t);
    if (this.behind !== this.wasBehind) {
      // the rear view cuts straight round (and back), as the real one does
      this.wasBehind = this.behind;
      this.heading.copy(h);
      this.pitch = p;
      this.view = v;
      this.lag = 0;
    }
    const da = angleAbout(this.heading, h, this.up);
    const free = Math.abs(this.orbit.x) > 0.02 || Math.abs(this.orbit.y) > 0.02;
    const turn = 1 - Math.exp(-dt * (this.behind ? 30 : free ? 16 : 10 + 2 * this.ballK));
    rotate(this.heading, this.up, da * turn).norm();
    this.pitch += (p - this.pitch) * (1 - Math.exp(-dt * 7));
    this.view += (v - this.view) * (1 - Math.exp(-dt * 7));
    // the pivot trails the car's moves along up (jumps, landings, climbs), catching up in ~0.15 s;
    // a teleport (kickoff, respawn) resets it
    if (this.havePrev && this.prevPos.dist(t.pos) < 400) {
      const du = (this.prevPos.x - t.pos.x) * this.up.x + (this.prevPos.y - t.pos.y) * this.up.y + (this.prevPos.z - t.pos.z) * this.up.z;
      this.lagUp = Math.max(-140, Math.min(140, (this.lagUp + du) * Math.exp(-dt * 7)));
    } else this.lagUp = 0;
    this.prevPos.copy(t.pos);
    this.havePrev = true;
    this.compute(t, dt, false);
  }

  private compute(t: CamTarget, dt: number, snap: boolean): void {
    const up = this.up;
    const pivot = new V3(t.pos.x + up.x * this.lagUp, t.pos.y + up.y * this.lagUp, t.pos.z + up.z * this.lagUp);
    const h = this.heading;
    const side = tA.set(h.y * up.z - h.z * up.y, h.z * up.x - h.x * up.z, h.x * up.y - h.y * up.x).norm();
    // the rig tilted by a pitch: its forward and its up
    const fw = new V3();
    const rup = new V3();
    const tilt = (p: number) => {
      fw.copy(h).scale(Math.cos(p)).addScaled(up, Math.sin(p));
      rup.copy(up).scale(Math.cos(p)).addScaled(h, -Math.sin(p));
    };
    // stiffness: the camera drops back a little as the car pulls away from it
    const away = Math.max(0, t.vel.dot(h));
    const wantLag = (1 - CAM.STIFF) * away * 0.075;
    this.lag = snap ? wantLag : this.lag + (wantLag - this.lag) * (1 - Math.exp(-dt * 3));
    const dist = CAM.DIST + this.lag;
    const want = new V3();
    const place = (p: number) => {
      tilt(p);
      want.copy(pivot).addScaled(fw, -dist).addScaled(rup, CAM.HEIGHT);
      return sdf(want.x, want.y, want.z) >= 45;
    };
    // a high ball dips the rig under it until the floor (or the wall behind) stops it; the view
    // still tilts up the full amount below, so the camera keeps its distance and looks up
    if (!place(this.pitch) && this.pitch > 0) {
      let lo = 0;
      let hi = this.pitch;
      if (place(0)) {
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (place(m)) lo = m;
          else hi = m;
        }
      }
      place(lo);
    }
    // blocked even level (riding into the ceiling, falling just under it, a wall right behind):
    // swing the boom round, over or under the car, to the nearest clear spot at full length
    if (sdf(want.x, want.y, want.z) < 45) {
      const p0 = Math.min(0, this.pitch);
      let ok = false;
      for (let k = 1; k <= 9 && !ok; k++) ok = place(Math.max(-1.35, p0 - k * 0.15)) || place(Math.min(1.2, p0 + k * 0.15));
      if (!ok) place(p0);
    }
    // still against something: the boom pulls in toward the car (never closer than 140), then
    // slides out along the surface as a last resort
    for (let k = 0; k < 10 && sdf(want.x, want.y, want.z) < 45 && want.dist(pivot) > 140; k++) {
      want.x = pivot.x + (want.x - pivot.x) * 0.85;
      want.y = pivot.y + (want.y - pivot.y) * 0.85;
      want.z = pivot.z + (want.z - pivot.z) * 0.85;
    }
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
    // look along the full pitch, angled down a few degrees (and tilted on toward a high ball)
    tilt(this.pitch);
    const a = (CAM.ANGLE * Math.PI) / 180 + this.view;
    const dir = new V3().copy(fw).scale(Math.cos(a)).addScaled(rup, Math.sin(a));
    rup.copy(rup).scale(Math.cos(a)).addScaled(fw, -Math.sin(a));
    const vHalf = Math.atan(Math.tan((CAM.FOV * Math.PI) / 360) / (16 / 9));
    // ball cam, from where the camera really ended up: a ball still over the top of the frame (clear
    // of the scoreboard) or under the bottom turns the view toward it by just the excess
    const toBall = tD.subVectors(t.ball, this.pos);
    const bl = toBall.len();
    const ahead = toBall.dot(dir);
    if (this.ballK > 0.01 && bl > 1 && ahead > 0) {
      const e = Math.atan2(toBall.dot(rup), ahead);
      const br = Math.atan2(92, bl);
      const over = e + br - (vHalf - 0.12);
      const under = e - br + (vHalf - 0.06);
      const turn = (over > 0 ? over : under < 0 ? under : 0) * this.ballK;
      if (turn !== 0) {
        const axis = new V3(dir.y * rup.z - dir.z * rup.y, dir.z * rup.x - dir.x * rup.z, dir.x * rup.y - dir.y * rup.x).norm();
        rotate(dir, axis, turn).norm();
        rotate(rup, axis, turn).norm();
      }
    }
    // keep the whole car in frame wherever it is (below, above, off to a side, even behind): turn
    // the view toward it by just enough that it sits inside the frame's height, with a margin
    const toCar = tC.subVectors(t.pos, this.pos);
    const cl = toCar.len();
    if (cl > 1) {
      toCar.scale(1 / cl);
      // (the car's own half height, seen from here, plus a margin)
      const allowed = vHalf - Math.atan2(CAR_H, cl) - 0.04;
      const th = Math.acos(Math.max(-1, Math.min(1, dir.dot(toCar))));
      if (th > allowed) {
        const axis = new V3(dir.y * toCar.z - dir.z * toCar.y, dir.z * toCar.x - dir.x * toCar.z, dir.x * toCar.y - dir.y * toCar.x);
        if (axis.len2() < 1e-8) axis.copy(side);
        axis.norm();
        rotate(dir, axis, th - allowed).norm();
        rotate(rup, axis, th - allowed);
        rup.addScaled(dir, -rup.dot(dir)).norm();
      }
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
