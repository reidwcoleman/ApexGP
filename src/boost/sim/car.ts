import { normalAt, sdf, type Team } from './arena.ts';
import { Basis, clamp, curve, V3 } from './math.ts';

/**
 * A car: the real game's numbers where they're known (RLBot wiki / RocketSim): Octane hitbox,
 * throttle and steering curves, 2300 top speed, boost 991.7 uu/s² burning 33.3/s, jump 291.7 + 1458
 * held for 0.2 s, double jump / dodge within 1.25 s, dodge impulses scaled by forward speed, the
 * flip's z-damping, the air-control torques and dampers, 5.5 rad/s spin cap, sticky wheels.
 *
 * The wheels are four springs onto the arena's distance field, so ramps, walls and landings fall
 * out of the same code; the driving forces then act in the car's own plane.
 */

export interface Input {
  throttle: number; // -1..1
  steer: number; // -1..1 (+ right)
  pitch: number; // -1..1 (+ nose up)
  yaw: number; // -1..1 (+ right)
  roll: number; // -1..1 (+ right)
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
}
export const noInput = (): Input => ({ throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false });

export const CAR = {
  MASS: 180,
  MAX_SPEED: 2300,
  SUPERSONIC: 2200,
  BOOST_ACCEL: 991.667,
  BOOST_USE: 100 / 3,
  AIR_THROTTLE: 66.667,
  BRAKE: 3500,
  COAST: 525,
  JUMP_IMPULSE: 291.667,
  JUMP_HOLD: 1458.333,
  JUMP_HOLD_T: 0.2,
  FLIP_WINDOW: 1.25,
  DODGE_IMPULSE: 500,
  FLIP_TIME: 0.65,
  MAX_W: 5.5,
  // hitbox (Octane) half extents and offset from the car origin
  HX: 59.0037,
  HY: 42.0997,
  HZ: 18.0796,
  OX: 13.8757,
  OZ: 20.755,
  REST_Z: 17,
} as const;

const GRAVITY = 650;
const THROTTLE_CURVE: [number, number][] = [
  [0, 1600],
  [1400, 160],
  [1410, 0],
  [2300, 0],
];
const CURVATURE: [number, number][] = [
  [0, 0.0069],
  [500, 0.00398],
  [1000, 0.00235],
  [1500, 0.001375],
  [1750, 0.0011],
  [2300, 0.00088],
];
// air control (per input / per rad/s), RLBot's measured values
const T_ROLL = 36.08;
const T_PITCH = 12.15;
const T_YAW = 8.92;
const D_ROLL = -4.47;
const D_PITCH = -2.8;
const D_YAW = -1.89;

// wheels: local x, |y|, radius
const WHEELS: [number, number, number][] = [
  [51.25, 25.9, 12.5],
  [51.25, -25.9, 12.5],
  [-33.75, 29.5, 15],
  [-33.75, -29.5, 15],
];
const SUSP_REST = 12;
const SUSP_K = 180; // per unit compression, as acceleration of the whole car shared by four
const SUSP_C = 16;
const STATIC_X = (1.5 * GRAVITY) / SUSP_K; // gravity plus the sticky pull
const conn = (r: number) => SUSP_REST - STATIC_X + r - CAR.REST_Z; // local z of each suspension's top

// inertia of the hitbox (diagonal, local)
const IXX = (CAR.MASS / 12) * ((2 * CAR.HY) ** 2 + (2 * CAR.HZ) ** 2);
const IYY = (CAR.MASS / 12) * ((2 * CAR.HX) ** 2 + (2 * CAR.HZ) ** 2);
const IZZ = (CAR.MASS / 12) * ((2 * CAR.HX) ** 2 + (2 * CAR.HY) ** 2);

// sample points of the hitbox for body-vs-arena contacts (local, relative to origin)
const BODY_PTS: V3[] = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) BODY_PTS.push(new V3(CAR.OX + x * CAR.HX, y * CAR.HY, CAR.OZ + z * CAR.HZ));

const tmpA = new V3();
const tmpB = new V3();
const tmpC = new V3();
const tmpN = new V3();
const tmpL = new V3();

export class Car {
  pos = new V3();
  vel = new V3();
  w = new V3(); // world angular velocity
  rot = new Basis();
  boost = 33.3;
  team: Team;
  // state
  wheelContact = [false, false, false, false];
  wheelComp = [0, 0, 0, 0]; // compression for the renderer
  onGround = false;
  jumped = false;
  jumpTime = 0; // time holding the first jump
  jumping = false;
  doubleJumped = false;
  flipped = false;
  flipTime = 0;
  flipping = false;
  dodgeX = 0; // dodge direction, local forward
  dodgeY = 0; // local right
  airTimeSinceJump = 0;
  lastJump = false;
  boosting = false;
  boostHold = 0; // boost stays on at least 0.1 s
  supersonic = false;
  demoTimer = 0; // > 0 while demolished
  handbrake = 0; // smoothed 0..1
  surfaceN = new V3(0, 0, 1);
  input: Input = noInput();
  /** time since leaving the ground (for the renderer / bots) */
  airTime = 0;
  /** the hitbox touched a wall last tick (on its roof, side...) */
  bodyTouch = false;
  /** seconds since the hitbox last touched a wall */
  bodyAgo = 9;

  constructor(team: Team) {
    this.team = team;
  }

  get alive(): boolean {
    return this.demoTimer <= 0;
  }

  speed(): number {
    return this.vel.len();
  }

  place(x: number, y: number, yaw: number): void {
    this.pos.set(x, y, CAR.REST_Z);
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.rot.fromEuler(yaw);
    this.jumped = this.jumping = this.doubleJumped = this.flipped = this.flipping = false;
    this.jumpTime = this.flipTime = this.airTimeSinceJump = 0;
    this.onGround = true;
    this.wheelContact.fill(true);
    this.supersonic = false;
    this.boosting = false;
    this.demoTimer = 0;
  }

  /** apply an impulse J (mass × velocity) at world point p */
  impulse(J: V3, p: V3): void {
    this.vel.addScaled(J, 1 / CAR.MASS);
    tmpA.subVectors(p, this.pos);
    tmpB.crossVectors(tmpA, J); // torque impulse, world
    this.rot.toLocal(tmpB, tmpC);
    tmpC.set(tmpC.x / IXX, tmpC.y / IYY, tmpC.z / IZZ);
    this.rot.toWorld(tmpC.x, tmpC.y, tmpC.z, tmpB);
    this.w.add(tmpB);
  }

  /** inverse effective mass along n for a contact at world point p (for impulse solves) */
  invMassAt(p: V3, n: V3): number {
    tmpA.subVectors(p, this.pos);
    tmpB.crossVectors(tmpA, n);
    this.rot.toLocal(tmpB, tmpC);
    tmpC.set(tmpC.x / IXX, tmpC.y / IYY, tmpC.z / IZZ);
    this.rot.toWorld(tmpC.x, tmpC.y, tmpC.z, tmpL);
    tmpN.crossVectors(tmpL, tmpA);
    return 1 / CAR.MASS + tmpN.dot(n);
  }

  /** velocity of a point attached to the car */
  pointVel(p: V3, out: V3): V3 {
    tmpA.subVectors(p, this.pos);
    return out.crossVectors(this.w, tmpA).add(this.vel);
  }

  /** the hitbox centre, world */
  center(out: V3): V3 {
    return this.rot.toWorld(CAR.OX, 0, CAR.OZ, out).add(this.pos);
  }

  step(dt: number, inp: Input): void {
    if (this.demoTimer > 0) return;
    this.input = inp;
    const r = this.rot;
    this.handbrake += ((inp.handbrake ? 1 : 0) - this.handbrake) * Math.min(1, dt * (inp.handbrake ? 12 : 5));

    // --- suspension ---
    let contacts = 0;
    const nAvg = tmpN.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const [wx, wy, wr] = WHEELS[i];
      const cp = r.toWorld(wx, wy, conn(wr), new V3()).add(this.pos);
      const d = sdf(cp.x, cp.y, cp.z);
      const len = d - wr;
      this.wheelContact[i] = false;
      this.wheelComp[i] = 0;
      if (len < SUSP_REST + 4) {
        const n = normalAt(cp.x, cp.y, cp.z, new V3());
        // only push when the wheel faces the surface (no spring through the roof)
        if (n.dot(r.u) > 0.3) {
          const x = SUSP_REST - len;
          if (len < SUSP_REST + 1.5) {
            this.wheelContact[i] = true;
            contacts++;
            nAvg.add(n);
          }
          if (x > 0) {
            this.wheelComp[i] = x;
            const pv = this.pointVel(cp, tmpB);
            const vn = pv.dot(n);
            let a = SUSP_K * x - SUSP_C * vn;
            if (a < 0) a = 0;
            // (a quarter of the car's mass per wheel)
            const J = n.clone().scale((a * CAR.MASS * dt) / 4);
            this.impulse(J, cp);
          }
        }
      }
    }
    const grounded = contacts >= 3;
    if (contacts > 0) this.surfaceN.copy(nAvg.norm());

    // landing resets the jump state
    if (grounded && !this.jumping) {
      if (this.jumped || this.flipped || this.doubleJumped) {
        if (this.airTime > 0.05 || this.vel.dot(this.surfaceN) <= 0) {
          this.jumped = this.doubleJumped = this.flipped = false;
          this.airTimeSinceJump = 0;
        }
      }
      if (!this.flipping) this.flipTime = 0;
    }
    this.onGround = grounded;
    this.airTime = grounded ? 0 : this.airTime + dt;

    // --- gravity ---
    this.vel.z -= GRAVITY * dt;

    // --- boost ---
    const wantBoost = inp.boost && this.boost > 0;
    if (wantBoost) this.boostHold = 0.1;
    else this.boostHold = Math.max(0, this.boostHold - dt);
    this.boosting = (wantBoost || this.boostHold > 0) && this.boost > 0;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - CAR.BOOST_USE * dt);
      this.vel.addScaled(r.f, CAR.BOOST_ACCEL * dt);
    }

    // --- jumping ---
    const jumpPressed = inp.jump && !this.lastJump;
    this.lastJump = inp.jump;
    if (grounded && jumpPressed && !this.jumped) {
      this.jumped = true;
      this.jumping = true;
      this.jumpTime = 0;
      this.airTimeSinceJump = 0;
      this.vel.addScaled(r.u, CAR.JUMP_IMPULSE);
    } else if (this.jumping) {
      this.jumpTime += dt;
      // the hold: at least a few ticks, at most 0.2 s
      if ((inp.jump || this.jumpTime < 0.025) && this.jumpTime < CAR.JUMP_HOLD_T) this.vel.addScaled(r.u, CAR.JUMP_HOLD * dt);
      else this.jumping = false;
    } else if (!grounded && jumpPressed && this.bodyAgo < 0.1 && contacts < 2 && r.u.dot(this.surfaceN) < 0.5) {
      // stuck on the roof or a side: a hop and a roll back onto the wheels
      this.vel.addScaled(this.surfaceN, 330);
      const loc = r.toLocal(this.w, tmpB);
      loc.x = (r.l.dot(this.surfaceN) > 0 ? -1 : 1) * CAR.MAX_W;
      r.toWorld(loc.x, loc.y, loc.z, this.w);
    } else if (!grounded && jumpPressed && !this.doubleJumped && !this.flipped && (!this.jumped || this.airTimeSinceJump < CAR.FLIP_WINDOW)) {
      const fx = -inp.pitch; // stick forward
      const fy = inp.yaw; // stick right
      if (Math.abs(fx) + Math.abs(fy) >= 0.5) this.dodge(fx, fy);
      else {
        this.doubleJumped = true;
        this.vel.addScaled(r.u, CAR.JUMP_IMPULSE);
      }
    }
    if (this.jumped && !grounded) this.airTimeSinceJump += dt;

    if (grounded && !this.jumping) this.drive(dt, inp, contacts);
    else this.air(dt, inp);

    // flip z damping: the first 0.21 s of a flip hold the car's height
    if (this.flipping) {
      this.flipTime += dt;
      if (this.flipTime < 0.21 && (this.vel.z < 0 || this.flipTime < 0.15)) this.vel.z *= 0.65;
      if (this.flipTime >= CAR.FLIP_TIME) this.flipping = false;
    }

    // speed caps
    this.vel.clampLen(CAR.MAX_SPEED);
    this.w.clampLen(CAR.MAX_W);
    const s = this.vel.len();
    if (s >= CAR.SUPERSONIC) this.supersonic = true;
    else if (s < 2100) this.supersonic = false;

    // integrate
    this.pos.addScaled(this.vel, dt);
    r.integrate(this.w, dt);

    this.collideArena();
  }

  private dodge(fx: number, fy: number): void {
    this.flipped = true;
    this.flipping = true;
    this.flipTime = 0;
    const l = Math.hypot(fx, fy);
    fx /= l;
    fy /= l;
    this.dodgeX = fx;
    this.dodgeY = fy;
    // forward on the ground plane
    const f2 = tmpA.set(this.rot.f.x, this.rot.f.y, 0);
    if (f2.len2() < 1e-4) f2.set(-this.rot.u.x, -this.rot.u.y, 0);
    f2.norm();
    const r2x = f2.y; // right on the ground plane
    const r2y = -f2.x;
    const fwdSpeed = this.vel.x * f2.x + this.vel.y * f2.y;
    const ratio = Math.min(1, Math.abs(fwdSpeed) / CAR.MAX_SPEED);
    const backwards = fx < 0;
    let ix = fx * CAR.DODGE_IMPULSE * (backwards ? (16 / 15 - 1) * ratio + 1 : 1);
    if (backwards) ix *= 1.0667;
    const iy = fy * CAR.DODGE_IMPULSE * ((1.9 - 1) * ratio + 1);
    this.vel.x += f2.x * ix + r2x * iy;
    this.vel.y += f2.y * ix + r2y * iy;
    if (this.vel.z < 0) this.vel.z = 0;
    // spin straight up to flip speed
    const loc = this.rot.toLocal(this.w, tmpB);
    loc.x = fy * CAR.MAX_W; // roll right for a right dodge
    loc.y = fx * CAR.MAX_W; // + about left = nose down for a front flip
    this.rot.toWorld(loc.x, loc.y, loc.z, this.w);
  }

  private drive(dt: number, inp: Input, contacts: number): void {
    const r = this.rot;
    const u = r.u;
    const vf = this.vel.dot(r.f);
    const vl = this.vel.dot(r.l);
    const speed = Math.abs(vf);
    // throttle / brake / coast
    const thr = this.boosting ? 1 : inp.throttle;
    let a = 0;
    if (Math.abs(thr) > 0.01) {
      if (vf * thr >= 0 || speed < 50) a = thr * curve(THROTTLE_CURVE, speed);
      else a = Math.sign(thr) * CAR.BRAKE;
    } else if (speed > 1) {
      a = -Math.sign(vf) * Math.min(CAR.COAST, speed / dt);
    }
    if (a !== 0 && Math.abs(thr) < 0.01 && Math.abs(a * dt) > speed) a = -vf / dt;
    this.vel.addScaled(r.f, a * dt);
    // lateral grip; the powerslide lets it go
    const grip = 22 * (1 - this.handbrake) + 1.6 * this.handbrake;
    this.vel.addScaled(r.l, -vl * (1 - Math.exp(-grip * dt)));
    // steering: a yaw rate from the turning-circle curve
    const k = curve(CURVATURE, speed);
    let yaw = -inp.steer * k * vf * (1 + 0.5 * this.handbrake);
    // turning on the spot isn't a thing; a little rate below walking pace
    if (speed < 20) yaw *= speed / 20;
    // angular velocity: keep the yaw we want, damp the rest (the springs align the car)
    const wu = this.w.dot(u);
    this.w.addScaled(u, (yaw - wu) * Math.min(1, dt * 18));
    const wOther = tmpB.copy(this.w).addScaled(u, -this.w.dot(u));
    this.w.addScaled(wOther, -Math.min(1, dt * 10));
    // sticky wheels: half a gravity into the surface
    if (contacts >= 3) this.vel.addScaled(this.surfaceN, -0.5 * GRAVITY * dt);
  }

  private air(dt: number, inp: Input): void {
    const r = this.rot;
    if (Math.abs(inp.throttle) > 0.01 && !this.boosting) this.vel.addScaled(r.f, inp.throttle * CAR.AIR_THROTTLE * dt);
    const loc = r.toLocal(this.w, tmpB);
    // (local: x roll about forward, y about left = nose down, z about up = turn left)
    let roll = inp.roll;
    let yaw = inp.yaw;
    if (inp.handbrake && roll === 0) {
      roll = inp.yaw;
      yaw = 0;
    }
    if (this.flipping) {
      // the flip owns pitch/roll; pulling against it cancels the flip
      const cancel = clamp(this.dodgeX * inp.pitch, 0, 1); // stick back during a front flip (pitch up)
      loc.x = this.dodgeY * CAR.MAX_W;
      loc.y = this.dodgeX * CAR.MAX_W * (1 - cancel);
      loc.z += (-T_YAW * yaw + D_YAW * loc.z * (1 - Math.abs(yaw))) * dt;
    } else {
      loc.x += (T_ROLL * roll + D_ROLL * loc.x) * dt;
      loc.y += (-T_PITCH * inp.pitch + D_PITCH * loc.y * (1 - Math.abs(inp.pitch))) * dt;
      loc.z += (-T_YAW * yaw + D_YAW * loc.z * (1 - Math.abs(yaw))) * dt;
    }
    r.toWorld(loc.x, loc.y, loc.z, this.w);
  }

  /** the hitbox against the walls: push out and kill the inward velocity */
  private collideArena(): void {
    const p = tmpC;
    let deepest = 0;
    let dn: V3 | null = null;
    let dp: V3 | null = null;
    for (const lp of BODY_PTS) {
      this.rot.toWorld(lp.x, lp.y, lp.z, p).add(this.pos);
      const d = sdf(p.x, p.y, p.z);
      if (d < deepest) {
        deepest = d;
        dp = p.clone();
        dn = normalAt(p.x, p.y, p.z, new V3());
      }
    }
    this.bodyTouch = !!dn;
    this.bodyAgo = dn ? 0 : this.bodyAgo + 1 / 120;
    if (!dn || !dp) return;
    if (this.airTime > 0) this.surfaceN.copy(dn);
    this.pos.addScaled(dn, -deepest);
    const pv = this.pointVel(dp, new V3());
    const vn = pv.dot(dn);
    if (vn < 0) {
      const e = 0.25;
      const im = this.invMassAt(dp, dn);
      const jn = (-(1 + e) * vn) / im;
      const J = dn.clone().scale(jn);
      // friction on the slide
      const vt = pv.clone().addScaled(dn, -vn);
      const vtl = vt.len();
      if (vtl > 1e-3) {
        const imt = this.invMassAt(dp, vt.clone().scale(1 / vtl));
        const jt = Math.min(vtl / imt, 0.6 * jn);
        J.addScaled(vt, -jt / vtl);
      }
      this.impulse(J, dp);
    }
  }
}
