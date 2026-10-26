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

// wheels: local x, |y|, radius
export const WHEELS: [number, number, number][] = [
  [51.25, 25.9, 12.5],
  [51.25, -25.9, 12.5],
  [-33.75, 29.5, 15],
  [-33.75, -29.5, 15],
];
const SUSP_REST = 12;
const SUSP_K = 600; // per unit compression, as acceleration of the whole car shared by four
const SUSP_C = 38;
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
    // the powerslide is analog: it rises at 5/s and falls at 2/s
    this.handbrake = clamp(this.handbrake + (inp.handbrake ? 5 : -2) * dt, 0, 1);
    // boosting (with charge) holds the throttle down
    const realThrottle = inp.boost && this.boost > 0 ? 1 : inp.throttle;

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
    this.onGround = grounded;
    this.airTime = grounded ? 0 : this.airTime + dt;
    const jumpPressed = inp.jump && !this.lastJump;
    this.lastJump = inp.jump;
    const vfwd = this.vel.dot(r.f);

    // --- gravity ---
    this.vel.z -= GRAVITY * dt;

    // --- sticky wheels (any wheel down): half a gravity into the surface, and on a wall or the
    // ceiling, while driving, as much again as the surface's tilt takes away from gravity
    if (contacts > 0) {
      const up = this.surfaceN;
      const full = realThrottle !== 0 || Math.abs(vfwd) > 25;
      const k = 0.5 + (full ? 1 - Math.abs(up.z) : 0);
      this.vel.addScaled(up, -k * GRAVITY * dt);
    }

    // --- driving or flying ---
    if (grounded && !this.jumping) {
      this.flipping = false;
      this.drive(dt, inp, realThrottle);
    } else {
      if (grounded) this.flipping = false;
      else this.air(dt, inp, contacts === 0);
    }

    // --- the jump (RocketSim Car::_UpdateJump) ---
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
      this.vel.addScaled(r.u, CAR.JUMP_HOLD * (this.jumpTime < CAR.JUMP_MIN_T ? 0.62 : 1) * dt);
    }
    if (this.jumping || this.jumped) this.jumpTime += dt;

    // --- turtle auto-flip: jump while lying on the roof (Car::_UpdateAutoFlip) ---
    if (jumpPressed && this.bodyAgo < 0.05 && this.surfaceN.z > Math.SQRT1_2 && r.u.z < Math.cos(2.8)) {
      // roll whichever way brings the wheels round to the ground quicker
      const side = tmpA.crossVectors(r.f, r.u).z >= 0 ? 1 : -1;
      const roll = Math.acos(clamp(r.u.z, -1, 1));
      this.autoFlip = side * Math.max(1e-3, (0.4 * roll) / Math.PI);
      this.vel.addScaled(r.u, -200);
    }
    if (this.autoFlip !== 0) {
      const left = Math.abs(this.autoFlip) - dt;
      this.w.addScaled(r.f, 50 * Math.sign(this.autoFlip) * dt);
      this.autoFlip = left <= 0 ? 0 : Math.sign(this.autoFlip) * left;
    }

    // --- double jump or dodge (Car::_UpdateDoubleJumpOrFlip) ---
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
      if (this.flipTime <= FLIP_TORQUE_TIME && this.flipTime >= 0.15 && (this.vel.z < 0 || this.flipTime < 0.21)) this.vel.z *= Math.pow(0.65, dt * 120);
    } else if (this.flipped) this.flipTime += dt;

    // --- auto-roll: throttle with some wheels (or the body) on a surface eases the car flat onto it ---
    if (realThrottle !== 0 && ((contacts > 0 && contacts < 4) || this.bodyAgo < 0.02)) {
      const gUp = this.surfaceN;
      this.vel.addScaled(gUp, -100 * dt);
      const ax = tmpA.crossVectors(r.u, gUp);
      const al = ax.len();
      if (al > 1e-4) this.w.addScaled(ax, (80 * Math.min(1, 1 - clamp(r.u.dot(gUp), 0, 1) + al * 0.5) * dt) / al);
    }

    // --- boost (Car::_UpdateBoost): 0.1 s minimum, more push in the air ---
    if (this.boost > 0) {
      if (this.boosting) this.boosting = inp.boost || this.boostHold < 0.1;
      else this.boosting = inp.boost;
    } else this.boosting = false;
    this.boostHold = this.boosting ? this.boostHold + dt : 0;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - CAR.BOOST_USE * dt);
      this.vel.addScaled(r.f, (grounded ? CAR.BOOST_ACCEL : CAR.BOOST_ACCEL_AIR) * dt);
    }

    // speed caps
    this.vel.clampLen(CAR.MAX_SPEED);
    this.w.clampLen(CAR.MAX_W);
    // supersonic from 2200; held down to 2100 for at most a second
    const s2 = this.vel.len2();
    if (this.supersonic && this.supersonicTime < 1) this.supersonic = s2 >= 2100 * 2100;
    else this.supersonic = s2 >= CAR.SUPERSONIC * CAR.SUPERSONIC;
    this.supersonicTime = this.supersonic ? this.supersonicTime + dt : 0;

    // integrate
    this.pos.addScaled(this.vel, dt);
    r.integrate(this.w, dt);

    this.collideArena();
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

  private drive(dt: number, inp: Input, thr: number): void {
    const r = this.rot;
    const u = r.u;
    const vf = this.vel.dot(r.f);
    const vl = this.vel.dot(r.l);
    const speed = Math.abs(vf);
    const hb = this.handbrake;
    // throttle / brake / coast (Car::_UpdateWheels): driving against the motion brakes, with nothing
    // pressed the car coasts on 15 % brake, and under 25 uu/s it stops
    let a = 0;
    if (Math.abs(thr) >= 0.001) {
      if (!inp.handbrake && speed > 25 && Math.sign(thr) !== Math.sign(vf)) a = Math.sign(thr) * CAR.BRAKE;
      else a = thr * curve(THROTTLE_CURVE, speed);
    } else if (!inp.handbrake && speed > 0) {
      a = -Math.sign(vf) * (speed < 25 ? CAR.BRAKE : CAR.COAST);
      if (Math.abs(a * dt) > speed) a = -vf / dt;
    }
    this.vel.addScaled(r.f, a * dt);
    // lateral grip: the powerslide takes it down to a tenth; with no throttle on a wall it lets go
    let grip = 22 * (1 + (0.1 - 1) * hb);
    if (thr === 0) grip *= curve(NON_STICKY, this.surfaceN.z);
    this.vel.addScaled(r.l, -vl * (1 - Math.exp(-grip * dt)));
    // steering: a yaw rate from the turning-circle curve, widened by the powerslide's steering angle
    let k = curve(CURVATURE, speed);
    if (hb > 0) {
      const sa = curve(STEER_ANGLE, speed);
      const ps = sa + (curve(SLIDE_STEER_ANGLE, speed) - sa) * hb;
      k *= Math.tan(ps) / Math.tan(sa);
    }
    let yaw = -inp.steer * k * vf;
    // turning on the spot isn't a thing; a little rate below walking pace
    if (speed < 20) yaw *= speed / 20;
    // angular velocity: keep the yaw we want, damp the rest (the springs align the car)
    const wu = this.w.dot(u);
    this.w.addScaled(u, (yaw - wu) * Math.min(1, dt * (18 - 12 * hb)));
    const wOther = tmpB.copy(this.w).addScaled(u, -this.w.dot(u));
    this.w.addScaled(wOther, -Math.min(1, dt * 10));
    // and the suspension holds the car on: rebound off a ramp or a wall is soaked up
    const away = this.vel.dot(this.surfaceN);
    if (away > 0 && this.surfaceN.z > -0.5) this.vel.addScaled(this.surfaceN, -away * Math.min(1, dt * 14));
  }

  /** in the air (or on fewer than three wheels): the flip's torque, else air control (only with no wheel down) */
  private air(dt: number, inp: Input, control: boolean): void {
    const r = this.rot;
    if (Math.abs(inp.throttle) > 0.001) this.vel.addScaled(r.f, inp.throttle * CAR.AIR_THROTTLE * dt);
    const loc = r.toLocal(this.w, tmpB);
    // (local: x roll about forward (+ right), y about left = nose down, z about up = turn left)
    let roll = inp.roll;
    let yaw = inp.yaw;
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
        loc.x += this.dodgeY * FLIP_TORQUE_X * dt;
        loc.y += this.dodgeX * pitchScale * FLIP_TORQUE_Y * dt;
      }
    }
    if (doControl && control && this.autoFlip === 0) {
      // no pitch during the flip and for 0.3 s after it
      const pitchScale = this.flipping || (this.flipped && this.flipTime < FLIP_TORQUE_TIME + FLIP_PITCHLOCK_EXTRA) ? 0 : 1;
      const p = inp.pitch * pitchScale;
      loc.x += (T_ROLL * roll + D_ROLL * loc.x) * dt;
      loc.y += (-T_PITCH * p + D_PITCH * loc.y * (1 - Math.abs(p))) * dt;
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
