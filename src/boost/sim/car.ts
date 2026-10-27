import { normalAt, sdf, type Team } from './arena.ts';
import { Basis, clamp, curve, V3 } from './math.ts';

/**
 * A car, ported from RocketSim (Car.cpp and its btVehicleRL), which matches the real game tick for
 * tick: the Octane's hitbox, inertia and wheels; four raycast suspensions with the game's stiffness,
 * damping, per-axle force scales and the extra push-back when a wheel bottoms out; per-wheel tyre
 * impulses (engine, brake, the lateral grip from the slip-ratio curves, the powerslide's curves,
 * the non-sticky scale with no throttle), applied with the one-tick lag the game has (friction,
 * engine, brake and steering set this tick act from the next); sticky forces; the jump (291.7 +
 * 1458 held 0.025–0.2 s), double jump and dodges within 1.25 s, flip torques, z-damping and cancel,
 * air control and damping, auto-roll, the turtle auto-flip, boost (0.1 s minimum), 2300 / 5.5 caps.
 *
 * RocketSim's frame has y to the right; this one has y to the left (l), so it is the mirror image:
 * polar vectors map across directly, and torques (axial) change sign about forward and up.
 * Bullet units are 50 uu; every formula below is unit-free in uu with the mass at 180, except where
 * noted (the brake's rolling-friction constant and the lateral impulse's 60 × dt factor).
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
  BOOST_ACCEL_AIR: 1058.333,
  BOOST_USE: 100 / 3,
  AIR_THROTTLE: 66.667,
  BRAKE: 3500,
  COAST: 525,
  JUMP_IMPULSE: 291.667,
  JUMP_HOLD: 1458.333,
  JUMP_HOLD_T: 0.2,
  JUMP_MIN_T: 0.025,
  FLIP_WINDOW: 1.25,
  DODGE_IMPULSE: 500,
  FLIP_TIME: 0.65,
  MAX_W: 5.5,
  // hitbox (Octane, RocketSim's sizes, which match the game's inertia) half extents and offset from the car origin
  HX: 60.2535,
  HY: 43.3497,
  HZ: 19.32955,
  OX: 13.8757,
  OZ: 20.755,
  REST_Z: 17,
} as const;

const GRAVITY = 650;
// air control: RocketSim's CAR_AIR_CONTROL_TORQUE (130, 95, 400) and _DAMPING (30, 20, 50), pitch /
// yaw / roll, times CAR_TORQUE_SCALE (2π / 65536 × 1000) = angular acceleration in rad/s² per input
const TORQUE_SCALE = ((2 * Math.PI) / 65536) * 1000;
const T_ROLL = 400 * TORQUE_SCALE;
const T_PITCH = 130 * TORQUE_SCALE;
const T_YAW = 95 * TORQUE_SCALE;
const D_ROLL = -50 * TORQUE_SCALE;
const D_PITCH = -30 * TORQUE_SCALE;
const D_YAW = -20 * TORQUE_SCALE;
// the flip: an angular acceleration about roll (left/right dodge) and pitch (front/back) for 0.65 s
const FLIP_TORQUE_X = 260;
const FLIP_TORQUE_Y = 224;
const FLIP_TORQUE_TIME = 0.65;
const FLIP_PITCHLOCK_EXTRA = 0.3;
// steering: the front wheels' angle at each forward speed, and the wider one a powerslide allows
const STEER_ANGLE: [number, number][] = [
  [0, 0.53356],
  [500, 0.3193],
  [1000, 0.18203],
  [1500, 0.1057],
  [1750, 0.08507],
  [3000, 0.03454],
];
const SLIDE_STEER_ANGLE: [number, number][] = [
  [0, 0.39235],
  [2500, 0.1261],
];
// no throttle: the tyres let go on walls and the ceiling (by the surface normal's z)
const NON_STICKY: [number, number][] = [
  [0, 0.1],
  [0.7075, 0.5],
  [1, 1],
];

// wheels: local x, |y|, radius (front pair, back pair) — the renderer and the flip-reset check use these
export const WHEELS: [number, number, number][] = [
  [51.25, 25.9, 12.5],
  [51.25, -25.9, 12.5],
  [-33.75, 29.5, 15],
  [-33.75, -29.5, 15],
];
// btVehicleRL, Octane: suspension tops at local z 20.755, rest length = config − max travel
const SUSP_TOP = 20.755;
const SUSP_TRAVEL = 12;
const SUSP_REST = [38.755 - SUSP_TRAVEL, 38.755 - SUSP_TRAVEL, 37.055 - SUSP_TRAVEL, 37.055 - SUSP_TRAVEL];
const SUSP_SCALE = [36 - 1 / 4, 36 - 1 / 4, 54 + 1 / 4 + 1.5 / 100, 54 + 1 / 4 + 1.5 / 100];
const SUSP_STIFF = 500;
const SUSP_DAMP_COMP = 25;
const SUSP_DAMP_RELAX = 40;
const SUSP_SUB = 0.05 * 50; // SUSPENSION_SUBTRACTION, 0.05 bullet units
const ERP = 0.2; // the solver's default, for the bottomed-out push-back
// tyre curves
const DRIVE_TORQUE: [number, number][] = [
  [0, 1],
  [1400, 0.1],
  [1410, 0],
];
const LAT_FRICTION: [number, number][] = [
  [0, 1],
  [1, 0.2],
];
const HB_LONG_FRICTION: [number, number][] = [
  [0, 0.5],
  [1, 0.9],
];
const HB_LAT_FRICTION = 0.1;
// bullet force units per wheel (the mass is 180 in both systems; lengths are /50)
const THROTTLE_TORQUE = (CAR.MASS * 400) / 50;
const BRAKE_TORQUE = (CAR.MASS * (14.25 + 1 / 3)) / 50;
const ROLLING_MAGIC = 113.73963;

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
const tmpF = new V3();
// the vehicle code's own scratch (impulse(), invMassAt() and pointVel() use the tmp* above)
const q1 = new V3();
const q2 = new V3();
const q3 = new V3();
const q4 = new V3();
const tmpT = new V3();
const tmpU = new V3();

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
  /** seconds supersonic (it holds down to 2100 uu/s for at most 1 s) */
  supersonicTime = 0;
  /** > 0 while the turtle auto-flip rights the car (seconds left, sign = roll direction) */
  autoFlip = 0;
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
  /** the surface normal at the hitbox's last wall contact */
  bodyN = new V3(0, 0, 1);
  // btVehicleRL state carried between ticks (set by _UpdateWheels, used from the next tick)
  steerAngle = 0;
  engine = 0;
  brake = 0;
  wheels = WHEELS.map(() => ({
    hard: new V3(),
    lat: new V3(),
    point: new V3(),
    n: new V3(0, 0, 1),
    imp: new V3(),
    contact: false,
    len: 0,
    relVel: 0,
    clipInv: 1,
    extra: 0,
    latF: 0,
    long: 0,
  }));

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
    this.supersonicTime = 0;
    this.autoFlip = 0;
    this.boosting = false;
    this.handbrake = 0;
    this.demoTimer = 0;
    this.steerAngle = this.engine = this.brake = 0;
    for (const W of this.wheels) {
      W.latF = W.long = 0;
      W.imp.set(0, 0, 0);
    }
  }

  /** four wheels on the ball count as landing: the jump and the dodge come back (a flip reset) */
  flipReset(): boolean {
    if (!this.jumped && !this.flipped && !this.doubleJumped) return false;
    this.jumped = this.doubleJumped = this.flipped = this.jumping = false;
    this.airTimeSinceJump = 0;
    return true;
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
    const jumpPressed = inp.jump && !this.lastJump;
    this.lastJump = inp.jump;

    // ---- btVehicleRL::updateVehicleFirst: wheel transforms (last tick's steering), raycasts, friction impulses
    this.raycastWheels();
    this.calcFriction(dt);

    let contacts = 0;
    let worldContact = false;
    for (let i = 0; i < 4; i++) {
      if (this.wheelContact[i]) contacts++;
      worldContact ||= this.wheelContact[i];
    }
    const grounded = contacts >= 3;
    this.onGround = grounded;
    this.airTime = grounded ? 0 : this.airTime + dt;
    const vfwd = this.vel.dot(r.f);
    if (contacts > 0) this.surfaceN.copy(this.wheelUp());

    // forces this tick (as accelerations), integrated with gravity after the impulses
    const acc = tmpF.set(0, 0, -GRAVITY);
    const ang = tmpT.set(0, 0, 0);

    // ---- Car::_UpdateWheels
    this.handbrake = clamp(this.handbrake + (inp.handbrake ? 5 : -2) * dt, 0, 1);
    const realThrottle = inp.boost && this.boost > 0 ? 1 : inp.throttle;
    this.updateWheels(inp, realThrottle, vfwd, contacts, worldContact, acc);

    // ---- air torque (fewer than three wheels down)
    if (contacts < 3) this.air(inp, contacts === 0, acc, ang);
    else this.flipping = false;

    // ---- the jump (Car::_UpdateJump)
    if (grounded && !this.jumping) {
      // (not straight away after a minimum jump: we may still be leaving the ground)
      if (!(this.jumped && this.jumpTime < CAR.JUMP_MIN_T + 0.025)) {
        this.jumped = false;
        this.jumpTime = 0;
      }
    }
    if (this.jumping) {
      if (!(this.jumpTime < CAR.JUMP_MIN_T || (inp.jump && this.jumpTime < CAR.JUMP_HOLD_T))) this.jumping = false;
    } else if (grounded && jumpPressed) {
      this.jumping = true;
      this.jumpTime = 0;
      this.vel.addScaled(r.u, CAR.JUMP_IMPULSE);
    }
    if (this.jumping) {
      this.jumped = true;
      acc.addScaled(r.u, CAR.JUMP_HOLD * (this.jumpTime < CAR.JUMP_MIN_T ? 0.62 : 1));
    }
    if (this.jumping || this.jumped) this.jumpTime += dt;

    // ---- turtle auto-flip: jump while lying on the roof (Car::_UpdateAutoFlip)
    if (jumpPressed && this.bodyTouch && this.bodyN.z > Math.SQRT1_2) {
      // the roll angle about forward in RocketSim's frame (mirrored): 0 upright, ±π on the roof
      const roll = Math.atan2(-r.l.z, r.u.z);
      if (Math.abs(roll) > 2.8) {
        this.autoFlip = (roll > 0 ? 1 : -1) * 0.4 * (Math.abs(roll) / Math.PI);
        this.vel.addScaled(r.u, -200);
      }
    }
    if (this.autoFlip !== 0) {
      // (RocketSim's +forward spin is −forward here)
      this.w.addScaled(r.f, -50 * Math.sign(this.autoFlip) * dt);
      const rest = Math.abs(this.autoFlip) - dt;
      this.autoFlip = rest <= 0 ? 0 : Math.sign(this.autoFlip) * rest;
    }

    // ---- double jump or dodge (Car::_UpdateDoubleJumpOrFlip)
    if (grounded) {
      this.doubleJumped = this.flipped = false;
      this.airTimeSinceJump = 0;
      this.flipTime = 0;
    } else {
      if (this.jumped && !this.jumping) this.airTimeSinceJump += dt;
      else this.airTimeSinceJump = 0;
      if (jumpPressed && this.airTimeSinceJump < CAR.FLIP_WINDOW && !this.doubleJumped && !this.flipped && this.autoFlip === 0) {
        if (Math.abs(inp.yaw) + Math.abs(inp.pitch) + Math.abs(inp.roll) >= 0.5) this.dodge(-inp.pitch, inp.yaw + inp.roll, vfwd);
        else {
          this.doubleJumped = true;
          this.vel.addScaled(r.u, CAR.JUMP_IMPULSE);
        }
      }
    }
    if (this.flipping) {
      this.flipTime += dt;
      // the flip holds the car's height: from 0.15 s, always until 0.21 s and while falling after
      if (this.flipTime <= FLIP_TORQUE_TIME && this.flipTime >= 0.15 && (this.vel.z < 0 || this.flipTime < 0.21)) this.vel.z *= 0.65;
    } else if (this.flipped) this.flipTime += dt;

    // ---- auto-roll (Car::_UpdateAutoRoll): throttle with some wheels, or the body, on a surface
    if (inp.throttle !== 0 && ((contacts > 0 && contacts < 4) || this.bodyTouch)) this.autoRoll(contacts, acc, ang);

    // ---- btVehicleRL::updateVehicleSecond: suspension, then the friction impulses worked out above
    this.applySuspension(dt);
    this.applyFriction(dt);

    // ---- boost (Car::_UpdateBoost): 0.1 s minimum, more push in the air
    if (this.boost > 0) {
      if (this.boosting) this.boosting = inp.boost || this.boostHold < 0.1;
      else this.boosting = inp.boost;
    } else this.boosting = false;
    this.boostHold = this.boosting ? this.boostHold + dt : 0;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - CAR.BOOST_USE * dt);
      acc.addScaled(r.f, grounded ? CAR.BOOST_ACCEL : CAR.BOOST_ACCEL_AIR);
    }

    // ---- the physics step: forces, then contacts, then positions
    this.vel.addScaled(acc, dt);
    this.w.addScaled(ang, dt);
    this.collideArena();
    this.pos.addScaled(this.vel, dt);
    r.integrate(this.w, dt);

    // ---- Car::_FinishPhysicsTick / _PostTickUpdate: caps, supersonic
    this.vel.clampLen(CAR.MAX_SPEED);
    this.w.clampLen(CAR.MAX_W);
    const s2 = this.vel.len2();
    if (this.supersonic && this.supersonicTime < 1) this.supersonic = s2 >= 2100 * 2100;
    else this.supersonic = s2 >= CAR.SUPERSONIC * CAR.SUPERSONIC;
    this.supersonicTime = this.supersonic ? this.supersonicTime + dt : 0;
  }

  // ------------------------------------------------------------------ btVehicleRL
  /** the wheels' world frames (the steering set last tick) and their suspension raycasts */
  private raycastWheels(): void {
    const r = this.rot;
    const a = this.steerAngle;
    for (let i = 0; i < 4; i++) {
      const W = this.wheels[i];
      const [wx, wy, wr] = WHEELS[i];
      r.toWorld(wx, wy, SUSP_TOP, W.hard).add(this.pos);
      // the axle: left, turned with the front wheels' steering (+ = right)
      const sa = i < 2 ? a : 0;
      W.lat.copy(r.l).scale(Math.cos(sa)).addScaled(r.f, Math.sin(sa));
      const rest = SUSP_REST[i];
      const rayLen = rest + SUSP_TRAVEL + wr - SUSP_SUB;
      // march down the suspension's line onto the arena
      let t = 0;
      let hit = false;
      if (sdf(W.hard.x, W.hard.y, W.hard.z) > 0) {
        for (let k = 0; k < 24 && t <= rayLen; k++) {
          q1.copy(W.hard).addScaled(r.u, -t);
          const d = sdf(q1.x, q1.y, q1.z);
          if (d < 0.02) {
            hit = true;
            break;
          }
          t += d;
        }
      }
      W.contact = hit && t <= rayLen;
      this.wheelContact[i] = W.contact;
      W.extra = 0;
      if (W.contact) {
        W.point.copy(W.hard).addScaled(r.u, -t);
        normalAt(W.point.x, W.point.y, W.point.z, W.n);
        const trace = t; // (hard point − contact) · up
        W.len = clamp(trace - wr, rest - SUSP_TRAVEL, rest + SUSP_TRAVEL);
        const denom = W.n.dot(r.u);
        this.pointVel(W.point, q2);
        const projVel = W.n.dot(q2);
        if (denom > 0.1) {
          W.relVel = projVel / denom;
          W.clipInv = 1 / denom;
        } else {
          W.relVel = 0;
          W.clipInv = 10;
        }
        // bottomed out: the solver's contact push-back, shared by the four wheels (computed, not applied)
        const thresh = rest + wr - SUSP_SUB;
        if (trace < thresh) {
          const dist = trace - thresh;
          const imp = ((ERP * -dist) / (1 / 120) - projVel) / this.invMassAt(W.point, W.n);
          W.extra = Math.max(0, imp) / 4;
        }
      } else {
        W.len = rest + SUSP_TRAVEL;
        W.relVel = 0;
        W.n.copy(r.u);
        W.clipInv = 1;
      }
      this.wheelComp[i] = rest - W.len;
    }
  }

  /** the average contact normal of the wheels that are down (else the car's up) */
  private wheelUp(): V3 {
    const n = tmpU.set(0, 0, 0);
    for (const W of this.wheels) if (W.contact) n.add(W.n);
    if (n.len2() < 1e-9) return n.copy(this.rot.u);
    return n.norm();
  }

  /** btVehicleRL::calcFrictionImpulses, with last tick's engine, brake and friction */
  private calcFriction(dt: number): void {
    const fs = CAR.MASS / 3;
    for (const W of this.wheels) {
      W.imp.set(0, 0, 0);
      if (!W.contact) continue;
      const axle = q1.copy(W.lat).addScaled(W.n, -W.lat.dot(W.n));
      if (axle.len2() < 1e-12) continue;
      axle.norm();
      // the wheel's forward along the surface
      const fwd = q2.crossVectors(axle, W.n).norm();
      // sideways: Bullet's resolveSingleBilateral, 0.2 of the slip each tick (bullet units: v / 50)
      const v = this.pointVel(W.point, q3);
      const side = (-0.2 * (v.dot(axle) / 50)) / this.invMassAt(W.point, axle);
      let rolling = 0;
      if (this.engine === 0) {
        if (this.brake) {
          const rel = v.dot(fwd) / 50;
          rolling = -clamp(rel * ROLLING_MAGIC, -this.brake, this.brake);
        }
      } else rolling = this.engine / fs;
      // (bullet impulse × 50 → uu)
      W.imp
        .copy(fwd)
        .scale(rolling * W.long * fs * dt * 50)
        .addScaled(axle, side * W.latF * fs * dt * 50);
    }
  }

  /** btVehicleRL::updateSuspension: spring and damper per wheel, never pulling */
  private applySuspension(dt: number): void {
    for (let i = 0; i < 4; i++) {
      const W = this.wheels[i];
      if (!W.contact) continue;
      let f = (SUSP_REST[i] - W.len) * SUSP_STIFF * W.clipInv;
      f -= (W.relVel < 0 ? SUSP_DAMP_COMP : SUSP_DAMP_RELAX) * W.relVel;
      f *= SUSP_SCALE[i];
      if (f < 0) f = 0;
      const j = f * dt + W.extra;
      if (j !== 0) this.impulse(q1.copy(W.n).scale(j), W.point);
    }
  }

  /** btVehicleRL::applyFrictionImpulses: at the contact, brought level with the car's centre */
  private applyFriction(_dt: number): void {
    const u = this.rot.u;
    for (const W of this.wheels) {
      if (W.imp.len2() === 0) continue;
      const off = q2.subVectors(W.point, this.pos);
      off.addScaled(u, -off.dot(u)).add(this.pos);
      this.impulse(q3.copy(W.imp), off);
    }
  }

  /** Car::_UpdateWheels: throttle and brake, steering, tyre friction, sticky forces */
  private updateWheels(inp: Input, realThrottle: number, vfwd: number, contacts: number, worldContact: boolean, acc: V3): void {
    const speed = Math.abs(vfwd);
    let realBrake = 0;
    let driveScale = curve(DRIVE_TORQUE, speed);
    let engineThrottle = realThrottle;
    if (!inp.handbrake) {
      if (Math.abs(realThrottle) >= 0.001) {
        if (speed > 25 && Math.sign(realThrottle) !== Math.sign(vfwd)) {
          // driving against the motion: full brake (and no throttle at the same time)
          realBrake = 1;
          if (speed > 0.01) engineThrottle = 0;
        }
      } else {
        // coasting: a light brake, a full one when nearly stopped
        engineThrottle = 0;
        realBrake = speed < 25 ? 1 : 0.15;
      }
    }
    if (contacts < 3) driveScale /= 4;
    this.engine = engineThrottle * THROTTLE_TORQUE * driveScale;
    this.brake = realBrake * BRAKE_TORQUE;
    // steering angle for next tick's wheel frames
    let sa = curve(STEER_ANGLE, speed);
    if (this.handbrake) sa += (curve(SLIDE_STEER_ANGLE, speed) - sa) * this.handbrake;
    this.steerAngle = sa * inp.steer;
    // tyre friction from the slip
    for (const W of this.wheels) {
      if (!W.contact) continue;
      const v = q3.subVectors(W.hard, this.pos);
      q1.crossVectors(this.w, v).add(this.vel);
      const lat = W.lat;
      const lon = q2.crossVectors(lat, W.n);
      const base = Math.abs(q1.dot(lat));
      let slip = 0;
      if (base > 5) slip = base / (Math.abs(q1.dot(lon)) + base);
      let latF = curve(LAT_FRICTION, slip);
      let longF = 1;
      if (this.handbrake) {
        latF *= (HB_LAT_FRICTION - 1) * this.handbrake + 1;
        longF *= (curve(HB_LONG_FRICTION, slip) - 1) * this.handbrake + 1;
      }
      if (realThrottle === 0) {
        const k = curve(NON_STICKY, W.n.z);
        latF *= k;
        longF *= k;
      }
      W.latF = latF;
      W.long = longF;
    }
    // sticky: half a gravity into the surface, more on walls and the ceiling while driving
    if (worldContact) {
      const up = this.wheelUp();
      const full = realThrottle !== 0 || speed > 25;
      const k = 0.5 + (full ? 1 - Math.abs(up.z) : 0);
      acc.addScaled(up, -k * GRAVITY);
    }
  }

  /** Car::_UpdateAutoRoll (mirrored into this frame) */
  private autoRoll(contacts: number, acc: V3, ang: V3): void {
    const r = this.rot;
    const gUp = contacts > 0 ? tmpU.copy(this.wheelUp()) : tmpU.copy(this.bodyN);
    const right = q1.copy(r.l).scale(-1);
    const crossRight = q2.crossVectors(r.f, gUp);
    const crossForward = q3.crossVectors(crossRight, q4.copy(gUp).scale(-1));
    const rightK = 1 - clamp(right.dot(crossRight), 0, 1);
    const forwardK = 1 - clamp(r.f.dot(crossForward), 0, 1);
    const tr = right.dot(gUp) >= 0 ? -1 : 1;
    const tf = r.f.dot(gUp) >= 0 ? 1 : -1;
    acc.addScaled(gUp, -100);
    // torque = forward·tr·rightK + right·tf·forwardK, an axial vector: negated in the mirror
    ang.addScaled(r.f, -tr * rightK * 80).addScaled(right, -tf * forwardK * 80);
  }

  /** a dodge (RocketSim, after RLUtilities): x = forward share, y = right share of the stick */
  private dodge(dx: number, dy: number, forwardSpeed: number): void {
    this.flipped = true;
    this.flipping = true;
    this.flipTime = 0;
    let x = dx;
    let y = dy;
    if (Math.abs(y) < 0.1 && Math.abs(x) < 0.1) x = y = 0;
    else {
      const l = Math.hypot(x, y);
      x /= l;
      y /= l;
    }
    // the torque it will spin with (zero: a stall)
    this.dodgeX = x;
    this.dodgeY = y;
    if (Math.abs(x) < 0.1) x = 0;
    if (Math.abs(y) < 0.1) y = 0;
    if (x === 0 && y === 0) return;
    const ratio = Math.abs(forwardSpeed) / CAR.MAX_SPEED;
    const backwards = Math.abs(forwardSpeed) < 100 ? x < 0 : x >= 0 !== forwardSpeed >= 0;
    let ix = x * 500 * ((backwards ? 2.5 : 1) - 1) * ratio + x * 500;
    const iy = y * 500 * ((1.9 - 1) * ratio + 1);
    if (backwards) ix *= 16 / 15;
    // along the car's heading on the ground plane
    const f2 = tmpA.set(this.rot.f.x, this.rot.f.y, 0);
    if (f2.len2() < 1e-6) f2.set(-this.rot.u.x, -this.rot.u.y, 0);
    f2.norm();
    // (right on the ground plane)
    const rx = f2.y;
    const ry = -f2.x;
    this.vel.x += f2.x * ix + rx * iy;
    this.vel.y += f2.y * ix + ry * iy;
  }

  /** Car::_UpdateAirTorque (fewer than three wheels down): the flip's torque, else air control
   * (only with no wheel down), as angular accelerations; and the air throttle */
  private air(inp: Input, control: boolean, acc: V3, ang: V3): void {
    const r = this.rot;
    const w = r.toLocal(this.w, tmpB);
    // local torques: x about forward (+ rolls right), y about left (+ nose down), z about up (+ turns left)
    const t = tmpC.set(0, 0, 0);
    let roll = inp.roll;
    let yaw = inp.yaw;
    // (the air-roll button turns the stick's yaw into roll)
    if (inp.handbrake && roll === 0) {
      roll = inp.yaw;
      yaw = 0;
    }
    if (this.flipping) this.flipping = this.flipped && this.flipTime < FLIP_TORQUE_TIME;
    let doControl = true;
    if (this.flipping) {
      if (this.dodgeX !== 0 || this.dodgeY !== 0) {
        // pulling the stick against the flip's pitch cancels it (and hands back air control)
        let pitchScale = 1;
        doControl = false;
        if (this.dodgeX !== 0 && inp.pitch !== 0 && Math.sign(this.dodgeX) === Math.sign(inp.pitch)) {
          pitchScale = 1 - Math.min(1, Math.abs(inp.pitch));
          doControl = true;
        }
        t.x += this.dodgeY * FLIP_TORQUE_X;
        t.y += this.dodgeX * pitchScale * FLIP_TORQUE_Y;
      }
    }
    if (doControl && control && this.autoFlip === 0) {
      // no pitch during the flip and for 0.3 s after it
      const pitchScale = this.flipping || (this.flipped && this.flipTime < FLIP_TORQUE_TIME + FLIP_PITCHLOCK_EXTRA) ? 0 : 1;
      const p = inp.pitch * pitchScale;
      t.x += T_ROLL * roll + D_ROLL * w.x;
      t.y += -T_PITCH * p + D_PITCH * w.y * (1 - Math.abs(p));
      t.z += -T_YAW * yaw + D_YAW * w.z * (1 - Math.abs(yaw));
    }
    ang.add(r.toWorld(t.x, t.y, t.z, tmpA));
    if (inp.throttle !== 0) acc.addScaled(r.f, inp.throttle * CAR.AIR_THROTTLE);
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
    this.bodyN.copy(dn);
    this.pos.addScaled(dn, -deepest);
    const pv = this.pointVel(dp, new V3());
    const vn = pv.dot(dn);
    if (vn < 0) {
      const e = 0.3;
      const im = this.invMassAt(dp, dn);
      const jn = (-(1 + e) * vn) / im;
      const J = dn.clone().scale(jn);
      // friction on the slide
      const vt = pv.clone().addScaled(dn, -vn);
      const vtl = vt.len();
      if (vtl > 1e-3) {
        const imt = this.invMassAt(dp, vt.clone().scale(1 / vtl));
        const jt = Math.min(vtl / imt, 0.3 * jn);
        J.addScaled(vt, -jt / vtl);
      }
      this.impulse(J, dp);
    }
  }
}
