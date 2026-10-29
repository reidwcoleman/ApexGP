import * as THREE from 'three';
import { makeSurf, type Network, type Surf } from '../roads.ts';
import { WATER_Y } from '../geo.ts';
import type { CollisionWorld, Contact } from './collide.ts';
import { weatherUniforms } from '../../world/weatherUniforms.ts';

/**
 * A road vehicle, tuned to drive like a street-racing game rather than a test rig: planted, quick to
 * answer the wheel, happy to slide when you ask for it (the handbrake, a lift mid-corner) and
 * easy to catch.
 *
 * Driving (the planar model): a bicycle model with an axle of tyres front and rear. Each axle's
 * load comes from the weight, the downforce and the transfer under braking and power; each tyre
 * curve rises to a peak at `alphaP` of slip and settles to 85 % sliding; the drive and the brakes
 * share the grip with cornering (a friction circle per axle) and the assists keep what's left for
 * the steering (ABS, traction control). Stability control trims the yaw back toward what the
 * steering asks unless the handbrake is up, so a spin needs intent. Steering lock falls with speed.
 *
 * The ground: each wheel reads the road, sidewalk or land under it, but only up to STEP_UP above
 * the car (a curb is climbed, a ramp's side or a deck overhead is not). The car rides the plane
 * through its wheels; going over a crest faster than gravity can follow it flies, keeping the
 * vertical speed the slope gave it. Bodywork pitch, roll and heave are a sprung display layer.
 *
 * Tumbling: only a blast or a heavy ram (`kick()`) turns the car into a free rigid body (orientation
 * q, angular velocity w, sprung wheels and body points against the ground, walls as impulses). It
 * hands back once it's on its wheels; on its roof it stays there (overturned) until autoRight.
 */

export interface CarSpec {
  mass: number;
  /** cg to front / rear axle (m) */
  a: number;
  b: number;
  cgH: number;
  /** yaw inertia factor (Iz = k·m·a·b) */
  izK: number;
  power: number;
  /** max tractive force at the wheels (N) */
  maxForce: number;
  /** share of drive to the front axle */
  frontDrive: number;
  mu: number;
  cornerB: number;
  cdA: number;
  /** downforce = clA·v² (N), plus a fixed amount */
  clA: number;
  fan: number;
  maxSteer: number;
  brakeG: number;
  /** body half-length / half-width / height for collisions */
  hl: number;
  hw: number;
  height: number;
  wheelR: number;
  /** top speed limiter (m/s) */
  vmax: number;
  /** reverse limit (m/s) */
  vrev: number;
  /** false: never goes into the rigid-body tumble (the bike) */
  tumble?: boolean;
  /** half the track (m); default hw − 0.12 */
  track?: number;
  /** ride frequency of the springs (Hz) and the dampers' share of critical (the display body) */
  rideHz?: number;
  damping?: number;
  /** front share of the roll stiffness (more = more understeer at the limit) */
  rollF?: number;
  /** the tyres: peak slip angle (rad) and peak slip ratio */
  alphaP?: number;
  kappaP?: number;
  /** an automatic gearbox (ratios, final drive, redline rpm); none = an EV's single speed */
  gears?: number[];
  finalDrive?: number;
  redline?: number;
  /** viscous limited-slip (kept for the specs; the axle model has none) */
  lsd?: number;
  /** front share of the braking */
  brakeBias?: number;
  /** extra yaw help toward what the steering asks (a sports car's agility), share of Iz·rad/s² */
  vector?: number;
}

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /** extra forward thrust (N) this step */
  thrust: number;
}

const G = 9.81;
/** the highest step a wheel climbs (m): a curb, a driveway lip. Anything taller is not under it */
const STEP_UP = 0.42;
/** the tyres' static compression in the rigid-body mode (m) */
const SAG = 0.08;
const EU = new THREE.Euler();
const QI = new THREE.Quaternion();
const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const V4 = new THREE.Vector3();
const VF = new THREE.Vector3();
const VT = new THREE.Vector3();
const AX = new THREE.Vector3();
const AZ = new THREE.Vector3();
const UP = new THREE.Vector3();

/** the tyre's force (share of μ·Fz) at a slip x (1 = the peak): a smooth rise, 85 % sliding */
function tyre(x: number) {
  const s = Math.abs(x);
  const f = s < 1 ? 1.5 * s - 0.5 * s * s * s : 1 - 0.15 * Math.min(1, (s - 1) / 2.5);
  return x < 0 ? -f : f;
}

export class CarBody {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  /** world velocity (x, z), vertical speed */
  vx = 0;
  vz = 0;
  vy = 0;
  yawRate = 0;
  steer = 0;
  /** visual: body pitch (nose down +) and roll (left down +), wheel spin angle, suspension heave */
  pitch = 0;
  roll = 0;
  pitchV = 0;
  rollV = 0;
  heave = 0;
  spin = 0;
  /** ground under the car */
  onGround = true;
  airTime = 0;
  surf: Surf = makeSurf();
  groundY = 0;
  groundPitch = 0;
  groundRoll = 0;
  /** how much the tyres are sliding (0..1+) — for squeal and smoke */
  slip = 0;
  /** the strongest hit this frame (m/s into the wall) and what it hit */
  impact = 0;
  impactSolid: Contact['solid'] | null = null;
  inWater = false;
  /** longitudinal / lateral acceleration (m/s², car frame) for the look and the audio */
  ax = 0;
  ay = 0;
  /** reverse gear engaged */
  reverse = false;
  /** assists: 1 on (more is firmer), 0 off */
  stability = 1;
  /** how hard stability control worked last step (0..1) */
  rsc = 0;
  private contacts: Contact[] = [];
  private s2 = makeSurf();
  /** rigid-body mode (see the top): orientation, angular velocity (world), centre of mass */
  free = false;
  /** resting on its roof or side */
  overturned = false;
  /** the player's car: rights itself after a moment overturned */
  autoRight = false;
  /** burst tyres (bits: 1 front-left, 2 front-right, 4 rear-left, 8 rear-right) and the ones that just went */
  flats = 0;
  popped = 0;
  readonly q = new THREE.Quaternion();
  readonly w = new THREE.Vector3();
  readonly com = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private freeT = 0;
  private restT = 0;
  private rightT = -1;
  private wheelsDown = 0;
  private readonly q0 = new THREE.Quaternion();
  /**
   * The four corners (0 front-left, 1 front-right, 2 rear-left, 3 rear-right; x left, z forward):
   * each wheel's spin (rad/s), the load on its tyre (N), how hard it's sliding (combined slip, 1 =
   * the peak), and where it sits (m, up, in the chassis frame: over a curb, hanging off a crest).
   */
  readonly wSpin = [0, 0, 0, 0];
  readonly wLoad = [0, 0, 0, 0];
  readonly wSlip = [0, 0, 0, 0];
  readonly wDrop = [0, 0, 0, 0];
  /**
   * Crash damage: up to four dents, each a point on the body (car frame: x left, y up from the
   * ground, z forward) and how deep it's pushed in (m) — [x, y, z, depth] × 4; dentVer counts changes.
   */
  readonly dents = new Float32Array(16);
  dentVer = 0;
  /** the gearbox: gear (−1 reverse, 1..n) and the engine's rpm (0 for an EV) */
  gear = 1;
  rpm = 0;
  /** the tyres' grip under each wheel (1 tarmac, less on grass and sand) */
  readonly wGrip = [1, 1, 1, 1];
  private readonly wx: number[];
  private readonly wz: number[];
  private readonly ws = [makeSurf(), makeSurf(), makeSurf(), makeSurf()];
  private readonly wg = [0, 0, 0, 0];
  private readonly rs = [0, 0, 0, 0];
  private readonly rsP = [0, 0, 0, 0];
  private heaveV = 0;
  private shiftT = 0;
  /** the rear's grip coming back after the handbrake (0 = none, 1 = all) */
  private hbK = 1;
  /** smoothed longitudinal acceleration for the load transfer */
  private axS = 0;
  private readonly pts: { x: number; y: number; z: number; wheel: boolean }[];
  private readonly iInv: THREE.Vector3;
  private readonly h0: number;
  private readonly iz: number;

  constructor(public spec: CarSpec) {
    const S = spec;
    this.h0 = S.cgH;
    const W = 2 * S.hw, L = 2 * S.hl, H = S.height;
    // a box's inertia (local x across, y up, z along)
    this.iInv = new THREE.Vector3(12 / (S.mass * (H * H + L * L)), 12 / (S.mass * (W * W + L * L)), 12 / (S.mass * (W * W + H * H)));
    this.iz = S.izK * S.mass * S.a * S.b;
    const y0 = -this.h0, yt = H - this.h0;
    const tw = S.track ?? S.hw - 0.12;
    this.wx = [tw, -tw, tw, -tw];
    this.wz = [S.a, S.a, -S.b, -S.b];
    this.pts = [
      // the tyres' contact patches (sitting SAG below the hub line: the static compression)
      { x: tw, y: y0 - SAG, z: S.a, wheel: true },
      { x: -tw, y: y0 - SAG, z: S.a, wheel: true },
      { x: tw, y: y0 - SAG, z: -S.b, wheel: true },
      { x: -tw, y: y0 - SAG, z: -S.b, wheel: true },
    ];
    // the sills and bumpers, the belt line, the roof
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        this.pts.push({ x: sx * S.hw * 0.84, y: y0 + 0.28, z: sz * S.hl, wheel: false });
        this.pts.push({ x: sx * S.hw, y: y0 + H * 0.6, z: sz * S.hl * 0.92, wheel: false });
        this.pts.push({ x: sx * S.hw * 0.72, y: yt, z: sz * S.hl * 0.42, wheel: false });
      }
    const mg = (S.mass * G) / 4;
    for (let i = 0; i < 4; i++) this.wLoad[i] = mg;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  /** forward speed (signed, m/s) */
  get vLong() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.vx = this.vz = this.vy = this.yawRate = 0;
    this.pitch = this.roll = this.pitchV = this.rollV = 0;
    this.onGround = true;
    this.inWater = false;
    this.free = this.overturned = false;
    this.rightT = -1;
    this.flats = this.popped = 0;
    this.dents.fill(0);
    this.dentVer++;
    this.heave = this.heaveV = 0;
    this.groundPitch = this.groundRoll = 0;
    this.gear = 1;
    this.hbK = 1;
    this.axS = 0;
    for (let i = 0; i < 4; i++) this.wSpin[i] = this.rs[i] = this.rsP[i] = this.wDrop[i] = 0;
  }

  /** placed with a tilt (an Euler YXZ as the fleet draws it): a parked car left on its roof stays there */
  placeTilted(x: number, y: number, z: number, pitch: number, yaw: number, roll: number) {
    this.place(x, y, z, yaw);
    if (Math.abs(pitch) < 0.25 && Math.abs(roll) < 0.25) return;
    this.q.setFromEuler(EU.set(pitch, yaw, roll, 'YXZ'));
    this.com.set(0, this.h0, 0).applyQuaternion(this.q).add(this.pos);
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.free = true;
    this.freeT = 1;
    this.restT = 1;
    this.overturned = true;
  }

  /** an impulse (N·s) at a world point: a blast, a ram. It goes into the rigid body (the tumble) */
  kick(jx: number, jy: number, jz: number, px: number, py: number, pz: number) {
    if (this.spec.tumble === false) {
      this.vx += jx / this.spec.mass;
      this.vz += jz / this.spec.mass;
      this.vy = Math.max(this.vy, jy / this.spec.mass);
      return;
    }
    this.enterFree();
    this.impulse(V1.set(jx, jy, jz), px, py, pz);
    this.sync();
    this.dent(px, py, pz, (Math.hypot(jx, jz) / this.spec.mass) * 1.6);
  }

  /** a hit at a world point at an impact speed (m/s): the panel there is pushed in */
  dent(px: number, py: number, pz: number, dv: number) {
    if (dv < 3.5) return;
    const S = this.spec;
    const depth = Math.min(0.3, (dv - 3.5) * 0.013);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    let lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
    // onto the body's skin: the side or the end it struck
    if (Math.abs(lx) / S.hw > Math.abs(lz) / S.hl) lx = Math.sign(lx) * S.hw;
    else lz = Math.sign(lz) * S.hl;
    lx = THREE.MathUtils.clamp(lx, -S.hw, S.hw);
    lz = THREE.MathUtils.clamp(lz, -S.hl, S.hl);
    const ly = THREE.MathUtils.clamp(py - this.pos.y, 0.3, S.height * 0.9);
    this.addDent(lx, ly, lz, depth);
  }

  private addDent(x: number, y: number, z: number, depth: number) {
    const D = this.dents;
    let weak = 0;
    for (let k = 0; k < 4; k++) {
      const o = k * 4;
      if (D[o + 3] > 0 && Math.hypot(D[o] - x, D[o + 1] - y, D[o + 2] - z) < 0.55) {
        // the same panel again: deeper
        D[o + 3] = Math.min(0.34, Math.max(D[o + 3], depth) + depth * 0.35);
        this.dentVer++;
        return;
      }
      if (D[o + 3] < D[weak * 4 + 3]) weak = k;
    }
    if (D[weak * 4 + 3] >= depth) return;
    D.set([x, y, z, depth], weak * 4);
    this.dentVer++;
  }

  /** tyres gone (a spike strip, a bullet): the bits of the ones that weren't flat already */
  burst(mask: number) {
    const fresh = mask & ~this.flats;
    this.flats |= fresh;
    this.popped |= fresh;
    return fresh;
  }

  /** a velocity change (m/s) from a hit at a world point (x, z): the off-centre part spins it */
  shove(dvx: number, dvz: number, px: number, pz: number) {
    this.dent(px, this.pos.y + 0.6, pz, Math.hypot(dvx, dvz) * 1.7);
    if (this.free) {
      const m = this.spec.mass;
      this.impulse(V1.set(dvx * m, 0, dvz * m), px, this.com.y, pz);
      this.sync();
      return;
    }
    this.vx += dvx;
    this.vz += dvz;
    const S = this.spec;
    const rx = px - this.pos.x, rz = pz - this.pos.z;
    const Iz = S.izK * S.mass * S.a * S.b;
    this.yawRate += ((rz * dvx - rx * dvz) * S.mass) / Iz;
  }

  private enterFree() {
    if (this.free) return;
    this.free = true;
    this.overturned = false;
    this.freeT = 0;
    this.restT = 0;
    this.rightT = -1;
    this.q.setFromEuler(EU.set(-this.groundPitch + this.pitch, this.yaw, this.groundRoll - this.roll, 'YXZ'));
    this.com.set(0, this.h0, 0).applyQuaternion(this.q).add(this.pos);
    this.vel.set(this.vx, this.vy, this.vz);
    this.w.set(this.pitchV, 0, -this.rollV).applyQuaternion(this.q);
    this.w.y += this.yawRate;
  }

  /** the world inverse inertia applied to v (in place) */
  private invI(v: THREE.Vector3) {
    QI.copy(this.q).invert();
    v.applyQuaternion(QI).multiply(this.iInv).applyQuaternion(this.q);
    return v;
  }

  /** an impulse j at world point p on the rigid body */
  private impulse(j: THREE.Vector3, px: number, py: number, pz: number) {
    const m = this.spec.mass;
    this.vel.addScaledVector(j, 1 / m);
    V2.set(px - this.com.x, py - this.com.y, pz - this.com.z).cross(j);
    this.w.add(this.invI(V2));
  }

  /** the planar state (pos at the wheels' ground point, yaw, the tilt as groundPitch / groundRoll) from the rigid body */
  private sync() {
    EU.setFromQuaternion(this.q, 'YXZ');
    this.yaw = EU.y;
    this.groundPitch = -EU.x;
    this.groundRoll = EU.z;
    this.pitch = this.roll = this.pitchV = this.rollV = 0;
    this.pos.set(0, -this.h0, 0).applyQuaternion(this.q).add(this.com);
    this.vx = this.vel.x;
    this.vz = this.vel.z;
    this.vy = this.vel.y;
    this.yawRate = this.w.y;
  }

  step(dt: number, inp: CarInput, net: Network, world: CollisionWorld) {
    this.impact = 0;
    this.impactSolid = null;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    if (this.free) {
      this.freeStep(dt, n, inp, net, world);
      return;
    }
    for (let i = 0; i < n; i++) this.sub(h, inp, net, world);
  }

  private sub(dt: number, inp: CarInput, net: Network, world: CollisionWorld) {
    const S = this.spec;
    const m = S.mass;
    const R = S.wheelR;
    const Lw = S.a + S.b;
    const tw = this.wx[0];
    const noRoll = S.tumble === false;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward f = (sy, cy); left l = (cy, -sy)
    let vL = this.vx * sy + this.vz * cy;
    let vT = this.vx * cy - this.vz * sy;
    const speed = Math.hypot(vL, vT);

    // ---- the ground under each wheel (no higher than a curb above the car) and under the middle
    const hint = this.pos.y + STEP_UP - 1.4;
    const surf = net.surface(this.pos.x, this.pos.z, hint, this.surf);
    const wet = weatherUniforms.uWetness.value;
    let anyWater = false;
    for (let i = 0; i < 4; i++) {
      const lx = this.wx[i], lz = this.wz[i];
      const g = net.surface(this.pos.x + sy * lz + cy * lx, this.pos.z + cy * lz - sy * lx, hint, this.ws[i]);
      anyWater ||= g.water;
      this.wg[i] = g.water ? WATER_Y - 3 : g.y;
      const k = g.water ? 0 : g.grass ? 0.72 : g.sand ? 0.6 : 1;
      this.wGrip[i] = k * (1 - (g.grass ? 0.2 : 0.18) * wet);
    }
    const wg = this.wg;
    const gf = (wg[0] + wg[1]) / 2, gr = (wg[2] + wg[3]) / 2;
    // (a wheel hanging over the seawall doesn't tip the plane: the car pivots on what it stands on)
    const slopeP = THREE.MathUtils.clamp(Math.atan2(gf - gr, Lw), -0.45, 0.45);
    const slopeR = THREE.MathUtils.clamp(Math.atan2((wg[0] + wg[2]) / 2 - (wg[1] + wg[3]) / 2, 2 * tw), -0.35, 0.35);
    let gy = surf.water ? WATER_Y - 3 : (gf * S.b + gr * S.a) / Lw;
    if (!surf.water) gy = Math.max(gy, surf.y - 0.05);
    this.groundY = gy;

    // ---- vertical: riding the plane, or flying off it
    const wasGround = this.onGround;
    if (wasGround) {
      // where gravity alone would take it this step: if the ground falls away faster, it flies
      const ballistic = this.pos.y + this.vy * dt - 0.5 * G * dt * dt;
      if (gy >= ballistic - 0.004 || speed < 2) {
        // the vertical speed is the slope's (a curb under one axle is a bump, not a launch)
        this.vy = vL * Math.sin(slopeP);
        if (gy > this.pos.y + 0.02) this.heaveV -= Math.min(0.6, (gy - this.pos.y) * 4);
        this.pos.y = gy;
        this.airTime = 0;
      } else {
        this.onGround = false;
      }
    }
    if (!this.onGround) {
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (this.pos.y <= gy) {
        if (this.vy < -3) this.impact = Math.max(this.impact, -this.vy * 0.45);
        this.heaveV += Math.max(-1.6, this.vy * 0.35);
        this.pos.y = gy;
        this.vy = vL * Math.sin(slopeP);
        this.onGround = true;
        this.airTime = 0;
      }
    }
    if (this.onGround) {
      this.groundPitch += (slopeP - this.groundPitch) * Math.min(1, dt * 16);
      this.groundRoll += (slopeR - this.groundRoll) * Math.min(1, dt * 16);
    } else {
      // in the air the nose follows the arc a little, and the body levels
      const arc = THREE.MathUtils.clamp(Math.atan2(this.vy, Math.max(4, Math.abs(vL))) * 0.6, -0.5, 0.4);
      this.groundPitch += (arc - this.groundPitch) * Math.min(1, dt * 1.5);
      this.groundRoll *= 1 - Math.min(1, dt * 2);
    }
    this.inWater = (surf.water || anyWater) && this.pos.y < WATER_Y + 0.4;
    const ground = this.onGround && !this.inWater;

    // ---- steering: the lock falls with speed, a quick rack, quicker back to the middle
    const lockK = 1 / (1 + (speed / 19) ** 2);
    const want = inp.steer * S.maxSteer * Math.max(0.2, lockK);
    const back = Math.abs(want) < Math.abs(this.steer) ? 6 : 3.4;
    this.steer += THREE.MathUtils.clamp(want - this.steer, -back * dt, back * dt);

    // ---- drive or reverse (reverse only from (near) standstill: a brake pedal in a spin still brakes)
    if (speed < 1.5 && vL < 0.6 && inp.brake > 0.1 && inp.throttle < 0.05) this.reverse = true;
    if (inp.throttle > 0.1 && vL > -0.6) this.reverse = false;
    const pedal = this.reverse ? inp.brake : inp.throttle;
    const brake = this.reverse ? inp.throttle : inp.brake;
    // handbrake: the rears lock and let go; the grip comes back over half a second once it's down
    this.hbK = inp.handbrake ? 0 : Math.min(1, this.hbK + dt * 2.2);

    let FL = 0, FT = 0, Mz = 0;
    const kin = 1 - THREE.MathUtils.smoothstep(speed, 1.0, 4.0);
    if (ground) {
      // ---- loads: the weight, the downforce, the transfer under braking and power
      const down = S.clA * speed * speed + S.fan;
      const W = m * G * Math.cos(this.groundPitch) + down;
      const tr = (m * this.axS * S.cgH) / Lw;
      const Fzf = THREE.MathUtils.clamp((W * S.b) / Lw - tr, 0.15 * W, 0.85 * W);
      const Fzr = W - Fzf;
      // ---- the powertrain
      const fd = S.frontDrive;
      const limited = (!this.reverse && vL > S.vmax) || (this.reverse && vL < -S.vrev);
      let Fd = 0;
      if (S.gears) {
        const gs = S.gears, fdr = S.finalDrive ?? 3.6, red = S.redline ?? 6500, idle = 850;
        if (this.reverse) this.gear = -1;
        else if (this.gear < 1) this.gear = 1;
        const ratio = (this.gear < 0 ? gs[0] : gs[this.gear - 1]) * fdr;
        const wheelRpm = ((Math.abs(vL) / R) * ratio * 30) / Math.PI;
        this.rpm += (Math.max(idle + pedal * 1400 * kin, Math.min(red * 1.02, wheelRpm)) - this.rpm) * Math.min(1, dt * 18);
        this.shiftT -= dt;
        if (this.gear > 0 && this.shiftT <= 0) {
          const up = red * (0.4 + 0.52 * pedal);
          if (wheelRpm > up && this.gear < gs.length) {
            this.gear++;
            this.shiftT = 0.22;
          } else if (this.gear > 1 && wheelRpm * (gs[this.gear - 2] / gs[this.gear - 1]) < red * (0.55 + 0.3 * pedal)) {
            this.gear--;
            this.shiftT = 0.16;
          }
        }
        // the torque curve: fullest in the middle of the band, power-limited above
        const x = Math.max(this.rpm, idle) / red;
        const curve = 0.72 + 0.55 * x - 0.3 * x * x;
        Fd = pedal * Math.min(S.maxForce * 1.2, (S.power * 0.9) / Math.max(Math.abs(vL), 5)) * curve;
        if (this.shiftT > 0.08) Fd *= 0.35;
      } else {
        this.rpm = 0;
        this.gear = this.reverse ? -1 : 1;
        Fd = pedal * Math.min(S.maxForce, (S.power * 0.92) / Math.max(Math.abs(vL), 3));
      }
      if (limited) Fd = 0;
      if (this.reverse) Fd = -Fd * 0.6;
      // off the throttle: engine braking and rolling
      const coast = pedal < 0.05 && Math.abs(vL) > 0.5 ? -Math.sign(vL) * m * G * (S.gears ? 0.06 : 0.05) : 0;
      // ---- brakes, the handbrake on the rears
      const bias = S.brakeBias ?? 0.64;
      const Fb = brake * S.brakeG * m * G;
      const sgn = Math.sign(vL) || 1;
      // ---- the slip angles (low speeds regularised: the kinematic blend below takes over there)
      const vxr = Math.max(Math.abs(vL), 3);
      const dir = vL < -0.5 ? -1 : 1;
      const st = this.steer;
      const aF = Math.atan2(vT + this.yawRate * S.a, vxr) - st * dir;
      const aR = Math.atan2(vT - this.yawRate * S.b, vxr);
      const ap = S.alphaP ?? 0.12;
      const fl = this.flats;
      const flatF = (fl & 3 ? 0.55 : 1), flatR = (fl & 12 ? 0.55 : 1);
      const gripF = ((this.wGrip[0] + this.wGrip[1]) / 2) * flatF;
      const gripR = ((this.wGrip[2] + this.wGrip[3]) / 2) * flatR;
      const muF = S.mu * gripF * Fzf;
      // (the handbrake: a locked rear slides at a fraction of its grip)
      const muR = S.mu * gripR * Fzr * (0.42 + 0.58 * this.hbK);
      let Fyf = -muF * tyre(aF / ap);
      let Fyr = -muR * tyre(aR / (ap * 1.05));
      // ---- longitudinal demands on each axle
      let Fxf = (Fd + coast) * fd - Fb * bias * sgn;
      let Fxr = (Fd + coast) * (1 - fd) - Fb * (1 - bias) * sgn;
      if (inp.handbrake) Fxr -= sgn * Math.min(muR * 0.9, (Math.abs(vL) * m) / dt / 4);
      const assist = this.stability > 0;
      // the friction circle on each axle: the assists keep cornering grip, without them the
      // longitudinal wins and the axle slides (power oversteer, a locked front ploughing on)
      const circle = (Fx: number, Fy: number, mu: number, keep: boolean): [number, number, number] => {
        const need = Math.hypot(Fx, Fy);
        if (need <= mu || need < 1) return [Fx, Fy, need / Math.max(mu, 1)];
        const over = need / mu;
        if (keep) {
          const room = Math.sqrt(Math.max(mu * mu - Fy * Fy, (0.35 * mu) ** 2));
          const fx = Math.sign(Fx) * Math.min(Math.abs(Fx), room);
          const fy = Math.sign(Fy) * Math.min(Math.abs(Fy), Math.sqrt(Math.max(0, mu * mu - fx * fx)));
          return [fx, fy, Math.min(over, 1.05)];
        }
        const fx = (Fx / need) * mu, fy = (Fy / need) * mu * 0.92;
        return [fx, fy, over];
      };
      let sF: number, sR: number;
      [Fxf, Fyf, sF] = circle(Fxf, Fyf, muF, assist);
      [Fxr, Fyr, sR] = circle(Fxr, Fyr, muR, assist && !inp.handbrake);
      sF = Math.max(sF, Math.abs(aF) / ap);
      sR = Math.max(sR, Math.abs(aR) / ap, inp.handbrake && speed > 3 ? 1.6 : 0);
      // (never more lateral force than closes the slide this step: no jitter at parking speeds)
      const cs = Math.cos(st), sn = Math.sin(st);
      // (each axle's sideways speed in its tyres' frame: the force that would stop it in one step)
      const capF = (Math.abs((vT + this.yawRate * S.a) * cs - vL * sn) * m * 0.5) / dt + 1;
      const capR = (Math.abs(vT - this.yawRate * S.b) * m * 0.5) / dt + 1;
      Fyf = THREE.MathUtils.clamp(Fyf, -capF, capF);
      Fyr = THREE.MathUtils.clamp(Fyr, -capR, capR);
      FL = Fxf * cs - Fyf * sn + Fxr;
      FT = Fxf * sn + Fyf * cs + Fyr;
      Mz = S.a * (Fyf * cs + Fxf * sn) - S.b * Fyr;
      // ---- stability control: the yaw held to what the steering and the grip ask (not on the handbrake)
      const Iz = this.iz;
      this.rsc = 0;
      if (assist && !inp.handbrake && speed > 5 && this.hbK > 0.6) {
        const muG = S.mu * Math.min(gripF, gripR) * (G + down / m);
        let rRef = (vL * Math.tan(st)) / (Lw * (1 + (vL * vL) / 1400));
        rRef = THREE.MathUtils.clamp(rRef, -muG / speed, muG / speed);
        const err = this.yawRate - rRef;
        const beta = Math.atan2(vT, Math.abs(vL));
        // oversteer: yawing past what's asked, or the tail out beyond a few degrees
        if ((Math.abs(this.yawRate) > Math.abs(rRef) && Math.abs(err) > 0.05) || Math.abs(beta) > 0.1) {
          const k = Math.min(1, Math.abs(err) * 4 + Math.max(0, Math.abs(beta) - 0.1) * 3);
          Mz -= Math.sign(err) * k * 3.2 * Iz * Math.min(this.stability, 1.6) * this.hbK;
          // and some of the slide straightened out
          vT -= vT * Math.min(1, dt * 1.6 * k * this.stability * this.hbK);
          this.rsc = k;
        } else if (S.vector && Math.sign(this.yawRate) === Math.sign(rRef) && vL > 0) {
          // understeer: a sports car's torque vectoring tucks the nose in
          Mz -= Math.sign(err) * Math.min(Math.abs(err) * 6, 1.2) * Iz * S.vector;
        }
      }
      // ---- the air and the rolling tyres
      const drag = 0.5 * 1.2 * S.cdA * speed * speed + (speed > 0.3 ? 0.013 * m * G * (gripR < 0.8 ? 3 : 1) : 0);
      if (speed > 0.01) {
        FL -= (drag * vL) / speed;
        FT -= (drag * vT) / speed;
      }
      // gravity along the slope
      FL -= m * G * Math.sin(this.groundPitch);
      FT += m * G * Math.sin(this.groundRoll);
      FL += inp.thrust;
      // ---- the per-wheel picture for the renderers, the marks and the audio
      const ayN = FT / m;
      const dLat = (m * ayN * S.cgH) / (2 * tw);
      const rf = S.rollF ?? 0.6;
      this.wLoad[0] = Math.max(0, Fzf / 2 - dLat * rf);
      this.wLoad[1] = Math.max(0, Fzf / 2 + dLat * rf);
      this.wLoad[2] = Math.max(0, Fzr / 2 - dLat * (1 - rf));
      this.wLoad[3] = Math.max(0, Fzr / 2 + dLat * (1 - rf));
      this.wSlip[0] = this.wSlip[1] = sF;
      this.wSlip[2] = this.wSlip[3] = sR;
      const roll = vL / R;
      const spinUp = !assist && pedal > 0.5 && sR > 1.1 ? pedal * 30 : 0;
      for (let i = 0; i < 4; i++) {
        const locked = (inp.handbrake && i > 1) || (!assist && brake > 0.9 && speed > 3);
        this.wSpin[i] = locked ? 0 : roll + (i > 1 && fd < 1 ? spinUp : i < 2 && fd > 0 ? spinUp * fd : 0);
      }
      this.slip = THREE.MathUtils.clamp((Math.max(sF, sR) - 0.95) * 1.5 + (inp.handbrake && speed > 5 ? 0.45 : 0), 0, 1.5) * (1 - kin) * (noRoll ? THREE.MathUtils.smoothstep(speed, 4, 7) : 1);
      const axL = FL / m, ayT = FT / m;
      this.ax = axL;
      this.ay = ayT;
      this.axS += (axL - this.axS) * Math.min(1, dt * 10);
      // ---- integrate in the car frame (with the rotating-frame terms)
      vL += (axL + this.yawRate * vT) * dt;
      vT += (ayT - this.yawRate * vL) * dt;
      this.yawRate += (Mz / Iz) * dt;
      // a bike's rider keeps it from swapping ends: the yaw follows the line the front tyre asks for
      if (noRoll && !inp.handbrake) {
        const k = Math.min(1, dt * 3 * this.stability) * (1 - kin);
        const rLine = (vL * Math.tan(st)) / Lw;
        const rMax = (0.85 * S.mu * G) / Math.max(speed, 1);
        this.yawRate += (THREE.MathUtils.clamp(rLine, -rMax, rMax) - this.yawRate) * k;
        vT *= 1 - k * 0.4;
      }
      // ---- walking pace: the car goes where its wheels point (no slip model to jitter)
      if (kin > 0) {
        const wantYaw = (vL * Math.tan(this.steer)) / Lw;
        this.yawRate += (wantYaw - this.yawRate) * kin * Math.min(1, dt * 14);
        vT *= 1 - kin * Math.min(1, dt * 10);
        if (pedal < 0.02 && speed < 0.3) vL *= 1 - Math.min(1, dt * 6);
        const bk = Math.max(brake, inp.handbrake ? 0.6 : 0);
        if (bk > 0) vL -= Math.sign(vL) * Math.min(Math.abs(vL), bk * S.brakeG * G * dt * kin);
      }
    } else if (this.inWater) {
      // sinking: heavy damping
      vL *= 1 - Math.min(1, dt * 1.5);
      vT *= 1 - Math.min(1, dt * 1.5);
      this.yawRate *= 1 - Math.min(1, dt * 2);
      this.vy = Math.max(this.vy, -1.5);
      this.ax = this.ay = 0;
      this.slip = 0;
    } else {
      // airborne: only drag; the wheels coast, a touch of air control on the yaw
      const k = (0.6 * S.cdA * speed) / m;
      vL -= vL * k * dt;
      vT -= vT * k * dt;
      vL += (inp.thrust / m) * dt;
      this.yawRate += (inp.steer * 0.6 - this.yawRate) * Math.min(1, dt * 0.8);
      this.ax = this.ay = 0;
      this.slip = 0;
      for (let i = 0; i < 4; i++) {
        this.wLoad[i] = 0;
        this.wSlip[i] = 0;
        this.wSpin[i] *= inp.brake > 0.2 || (inp.handbrake && i > 1) ? 1 - Math.min(1, dt * 8) : 1 - dt * 0.2;
      }
    }

    // ---- the sprung body (display): pitch from braking and power, roll in the turns, heave
    {
      const om = 2 * Math.PI * (S.rideHz ?? 1.5);
      const z = S.damping ?? 0.35;
      const k = om * om, c = 2 * z * om;
      const tP = ground ? THREE.MathUtils.clamp(-this.ax * 0.0042, -0.07, 0.07) : 0;
      const tR = ground && !noRoll ? THREE.MathUtils.clamp(-this.ay * 0.0048 * (S.cgH / 0.55), -0.1, 0.1) : 0;
      this.pitchV += (k * (tP - this.pitch) - c * this.pitchV) * dt;
      this.rollV += (k * (tR - this.roll) - c * this.rollV) * dt;
      this.heaveV += (k * -this.heave - c * this.heaveV) * dt;
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.pitchV * dt, -0.12, 0.12);
      this.roll = THREE.MathUtils.clamp(this.roll + this.rollV * dt, -0.16, 0.16);
      this.heave = THREE.MathUtils.clamp(this.heave + this.heaveV * dt, -0.2, 0.25);
      // each wheel against the chassis plane: up over a curb, hanging at full droop in the air
      const tp = Math.tan(this.groundPitch), trr = Math.tan(this.groundRoll);
      for (let i = 0; i < 4; i++) {
        const rr = ground ? THREE.MathUtils.clamp(wg[i] - (this.pos.y + this.wz[i] * tp + this.wx[i] * trr), -0.22, 0.22) : -0.09;
        this.rsP[i] = this.rs[i];
        this.rs[i] += (rr - this.rs[i]) * Math.min(1, dt * 40);
        this.wDrop[i] = this.rs[i];
      }
    }

    // ---- back to world
    this.vx = vL * sy + vT * cy;
    this.vz = vL * cy - vT * sy;
    this.yaw += this.yawRate * dt;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    // (the wheels drawn as they turn: spinning up, locked)
    this.spin += ((this.wSpin[2] + this.wSpin[3]) / 2) * dt;
    // ---- collisions
    this.collide(dt, net, world);
  }

  // ---- the rigid body
  private freeStep(dt: number, n: number, inp: CarInput, net: Network, world: CollisionWorld) {
    if (n > 0) {
      const h = dt / n;
      if (this.rightT >= 0) this.righting(dt, net);
      else for (let i = 0; i < n; i++) this.freeSub(h, inp, net, world);
    }
    this.freeT += dt;
    this.sync();
    if (!this.free) return;
    UP.set(0, 1, 0).applyQuaternion(this.q);
    const spin = Math.hypot(this.w.x, this.w.z);
    this.slip = this.wheelsDown > 0 && this.vel.length() > 3 ? 0.8 : 0;
    this.onGround = this.wheelsDown > 0;
    this.airTime = this.onGround ? 0 : this.airTime + dt;
    // back on its wheels: the planar model again
    if (this.rightT < 0 && this.freeT > 0.2 && UP.y > 0.86 && this.wheelsDown >= 3 && spin < 1.1 && Math.abs(this.vel.y) < 2.5) {
      this.land();
      return;
    }
    // at rest on its roof or side
    if (UP.y < 0.6 && this.vel.length() < 0.7 && this.w.length() < 0.6) this.restT += dt;
    else this.restT = 0;
    this.overturned = this.restT > 0.6;
    if (this.overturned && this.autoRight && this.restT > 2.2 && this.rightT < 0) {
      this.rightT = 0;
      this.q0.copy(this.q);
    }
  }

  private land() {
    this.free = false;
    this.overturned = false;
    this.heave = this.heaveV = 0;
    const vl = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    for (let i = 0; i < 4; i++) {
      this.wSpin[i] = vl / this.spec.wheelR;
      this.rs[i] = this.rsP[i] = 0;
    }
    this.rightT = -1;
    this.onGround = true;
    this.airTime = 0;
    this.vy = 0;
    this.yawRate = this.w.y;
    this.pos.y = this.groundY = Math.max(this.groundY, this.pos.y);
  }

  /** the player's car back onto its wheels: lifted and turned upright over a second */
  private righting(dt: number, net: Network) {
    this.rightT = Math.min(1, this.rightT + dt / 1.1);
    const k = this.rightT, e = k * k * (3 - 2 * k);
    // facing: the yaw of its forward axis (or of its up axis, nose-down)
    VF.set(0, 0, 1).applyQuaternion(this.q0);
    const yaw = Math.hypot(VF.x, VF.z) > 0.3 ? Math.atan2(VF.x, VF.z) : Math.atan2(-UP.set(0, 1, 0).applyQuaternion(this.q0).x, -UP.z);
    QI.setFromEuler(EU.set(0, yaw, 0, 'YXZ'));
    this.q.slerpQuaternions(this.q0, QI, e);
    const gy = net.surface(this.com.x, this.com.z, this.com.y + 0.5, this.s2).y;
    this.com.y = gy + this.h0 + Math.sin(Math.PI * k) * 0.9 + (1 - k) * 0.2;
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    if (k >= 1) {
      this.sync();
      this.pos.y = gy;
      this.groundY = gy;
      this.land();
    }
  }

  private freeSub(dt: number, inp: CarInput, net: Network, world: CollisionWorld) {
    const S = this.spec, m = S.mass, q = this.q, c = this.com, v = this.vel, w = this.w;
    const surf = net.surface(c.x, c.z, c.y + 0.3, this.surf);
    this.inWater = surf.water && c.y < WATER_Y + 0.6;
    this.groundY = surf.water ? WATER_Y - 4 : surf.y;
    const F = V1.set(0, -m * G, 0);
    const T = V2.set(0, 0, 0);
    const sp = v.length();
    F.addScaledVector(v, -0.6 * S.cdA * sp);
    AX.set(1, 0, 0).applyQuaternion(q);
    AZ.set(0, 0, 1).applyQuaternion(q);
    F.addScaledVector(AZ, inp.thrust);
    let wheels = 0;
    const kw = (m * G) / (4 * SAG), cw = 0.9 * Math.sqrt(kw * m * 0.25);
    const kb = m * 60, cb = 1.3 * Math.sqrt(kb * m * 0.25);
    const fCap = (m * 0.25) / dt;
    for (const p of this.pts) {
      V3.set(p.x, p.y, p.z).applyQuaternion(q);
      const px = c.x + V3.x, py = c.y + V3.y, pz = c.z + V3.z;
      if (py > this.groundY + 1.6) continue;
      const g = net.surface(px, pz, py + 0.5, this.s2);
      const gy = g.water ? WATER_Y - 4 : g.y;
      const pen = Math.min(gy - py, 0.3);
      if (pen <= 0) continue;
      // the point's velocity: v + w × r
      VT.copy(w).cross(V3).add(v);
      let fn: number;
      if (p.wheel) {
        wheels++;
        fn = Math.max(0, kw * pen - cw * VT.y);
        // grip across the tread (a rolling tyre gives nothing along it but the brakes)
        const lx = AX.x, lz = AX.z, ll = Math.hypot(lx, lz) || 1;
        const vl = (VT.x * lx + VT.z * lz) / ll;
        const fl = THREE.MathUtils.clamp(-vl * fCap * 0.5, -S.mu * 0.9 * fn, S.mu * 0.9 * fn);
        const fx = AZ.x, fz = AZ.z, fll = Math.hypot(fx, fz) || 1;
        const vf = (VT.x * fx + VT.z * fz) / fll;
        const fb = THREE.MathUtils.clamp(-vf * fCap * 0.5, -(0.015 + 0.8 * Math.max(inp.brake, inp.handbrake ? 0.6 : 0)) * fn, (0.015 + 0.8 * Math.max(inp.brake, inp.handbrake ? 0.6 : 0)) * fn);
        VF.set((fl * lx) / ll + (fb * fx) / fll, fn, (fl * lz) / ll + (fb * fz) / fll);
      } else {
        fn = Math.max(0, kb * pen - cb * VT.y);
        if (VT.y < -3) {
          this.impact = Math.max(this.impact, -VT.y * 0.5);
          // (the roof, a pillar, a wing: crushed where it lands — in the car's own frame)
          if (VT.y < -4.5) {
            QI.copy(q).invert();
            V4.copy(V3).applyQuaternion(QI);
            this.addDent(V4.x, V4.y + this.h0, V4.z, Math.min(0.3, (-VT.y - 4) * 0.03));
          }
        }
        // metal on the road: it scrapes
        const vt = Math.hypot(VT.x, VT.z);
        const ft = vt > 1e-3 ? Math.min(0.55 * fn, (vt * fCap * 0.5)) / vt : 0;
        VF.set(-VT.x * ft, fn, -VT.z * ft);
      }
      F.add(VF);
      T.add(V4.copy(V3).cross(VF));
    }
    if (wheels > 0 && S.fan > 0) F.y -= S.fan;
    this.wheelsDown = wheels;
    v.addScaledVector(F, dt / m);
    w.addScaledVector(this.invI(T), dt);
    // the air and the body's own damping
    w.multiplyScalar(1 - Math.min(1, dt * 0.25));
    if (this.inWater) {
      v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      v.y = Math.max(v.y, -1.5);
      w.multiplyScalar(1 - Math.min(1, dt * 2));
    }
    c.addScaledVector(v, dt);
    // orientation: q += ½ (0, w) q dt
    QI.set(w.x, w.y, w.z, 0).multiply(q);
    q.set(q.x + QI.x * 0.5 * dt, q.y + QI.y * 0.5 * dt, q.z + QI.z * 0.5 * dt, q.w + QI.w * 0.5 * dt).normalize();
    // ---- the walls: the planar box at the body's height, resolved as 3D impulses
    EU.setFromQuaternion(q, 'YXZ');
    const C = world.boxContacts(c.x, c.z, EU.y, S.hl, S.hw, c.y - 0.35, c.y + 0.6, this.contacts);
    for (const k of C) {
      this.wall(k.nx, k.nz, k.depth, k.px, c.y, k.pz, k.solid.kind === 'palm' || k.solid.kind === 'pole' ? 0.15 : 0.25);
      if (this.lastImpact > this.impact) {
        this.impact = this.lastImpact;
        this.impactSolid = k.solid;
      }
    }
    if (surf.edge >= 0) {
      const e = net.edges[surf.edge];
      const elevated = e.elevated || e.kind === 'causeway' || e.kind === 'highway' || e.kind === 'ramp' || e.water.some((x) => x);
      if (elevated && c.y > 0.9 && c.y < surf.y + 2.2) {
        const lim = e.hw + (e.spec.sidewalk > 0 ? e.spec.sidewalk : 0) - S.hw * 0.9;
        if (Math.abs(surf.lat) > lim) {
          const side = Math.sign(surf.lat);
          this.wall(surf.tz * side, -surf.tx * side, Math.abs(surf.lat) - lim, c.x, c.y, c.z, 0.2);
          if (this.lastImpact > this.impact) this.impact = this.lastImpact;
        }
      }
    }
  }

  /** the rigid body against a wall: push out, an impulse at the contact (with the lever arm, in 3D), scrape */
  private wall(nx: number, nz: number, depth: number, px: number, py: number, pz: number, rest: number) {
    this.lastImpact = 0;
    const c = this.com, m = this.spec.mass;
    c.x += nx * depth;
    c.z += nz * depth;
    V3.set(px - c.x, py - c.y, pz - c.z);
    VT.copy(this.w).cross(V3).add(this.vel);
    const vn = VT.x * nx + VT.z * nz;
    if (vn >= 0) return;
    this.lastImpact = -vn;
    this.dent(px, py, pz, -vn);
    VF.set(nx, 0, nz);
    V4.copy(V3).cross(VF);
    this.invI(V4).cross(V3);
    const j = (-(1 + rest) * vn) / (1 / m + V4.dot(VF));
    // scrape along the wall
    const tx = -nz, tz = nx;
    const vt = VT.x * tx + VT.z * tz;
    const fr = Math.min(Math.abs(vt) * m * 0.5, j * 0.35) * Math.sign(vt);
    this.impulse(VF.set(nx * j - tx * fr, 0, nz * j - tz * fr), px, py, pz);
  }

  private collide(dt: number, net: Network, world: CollisionWorld) {
    const S = this.spec;
    const C = world.boxContacts(this.pos.x, this.pos.z, this.yaw, S.hl, S.hw, this.pos.y + 0.15, this.pos.y + S.height, this.contacts);
    for (const c of C) {
      this.resolve(c.nx, c.nz, c.depth, c.px, c.pz, c.solid.kind === 'palm' || c.solid.kind === 'pole' ? 0.15 : 0.25);
      if (this.lastImpact > this.impact) {
        this.impact = this.lastImpact;
        this.impactSolid = c.solid;
      }
    }
    // the decks' parapets and the highways' barriers: stay on an elevated road
    const s = this.surf;
    if (s.edge >= 0) {
      const e = net.edges[s.edge];
      const elevated = e.elevated || e.kind === 'causeway' || e.kind === 'highway' || e.kind === 'ramp' || e.water.some((w) => w);
      if (elevated && this.pos.y > 0.4) {
        const lim = e.hw + (e.spec.sidewalk > 0 ? e.spec.sidewalk : 0) - S.hw * 0.9;
        if (Math.abs(s.lat) > lim) {
          const side = Math.sign(s.lat);
          // the push back toward the road's centre: right of travel is (-tz, tx)
          const nx = s.tz * side, nz = -s.tx * side;
          this.resolve(nx, nz, Math.abs(s.lat) - lim, this.pos.x, this.pos.z, 0.2);
          if (this.lastImpact > this.impact) this.impact = this.lastImpact;
        }
      }
    }
    void dt;
  }

  private lastImpact = 0;
  /** push out along n by depth, kill (and bounce) the velocity into the wall, spin from the off-centre hit */
  private resolve(nx: number, nz: number, depth: number, px: number, pz: number, rest: number) {
    this.lastImpact = 0;
    this.pos.x += nx * depth;
    this.pos.z += nz * depth;
    // velocity of the contact point
    const rx = px - this.pos.x, rz = pz - this.pos.z;
    const cvx = this.vx - this.yawRate * rz, cvz = this.vz + this.yawRate * rx;
    const vn = cvx * nx + cvz * nz;
    if (vn >= 0) return;
    this.lastImpact = -vn;
    this.dent(px, this.pos.y + 0.55, pz, -vn);
    const m = this.spec.mass;
    const Iz = this.spec.izK * m * this.spec.a * this.spec.b;
    // impulse with the lever arm
    const rn = rx * nz - rz * nx;
    const j = (-(1 + rest) * vn) / (1 / m + (rn * rn) / Iz);
    this.vx += (j * nx) / m;
    this.vz += (j * nz) / m;
    this.yawRate -= (j * rn) / Iz;
    // scrape: friction along the wall
    const tx = -nz, tz = nx;
    const vt = this.vx * tx + this.vz * tz;
    const fr = Math.min(Math.abs(vt), (j * 0.35) / m);
    this.vx -= tx * fr * Math.sign(vt);
    this.vz -= tz * fr * Math.sign(vt);
  }
}
