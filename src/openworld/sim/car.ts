import * as THREE from 'three';
import { makeSurf, type Network, type Surf } from '../roads.ts';
import { WATER_Y } from '../geo.ts';
import type { CollisionWorld, Contact } from './collide.ts';
import { weatherUniforms } from '../../world/weatherUniforms.ts';

/**
 * A road vehicle: a planar two-axle model (bicycle model with load transfer) for the handling,
 * plus a vertical body over the ground (jumps off ramps, landings, the curb's bump), a sprung
 * body (pitch and roll from the accelerations, for the look) and collisions with the city.
 *
 * Tyres: lateral force = μ·Fz·sin(1.6·atan(B·α)) (a Pacejka-shaped curve peaking near 7° of slip),
 * shared with the longitudinal force through the friction circle; load moves to the front under
 * braking and to the rear under power. The motor is power-limited (P / v) and traction-limited
 * with a traction control; the handbrake locks the rears for a drift. Aero: drag and downforce
 * (the Roadster's suction fan adds a fixed downforce from standstill).
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
  /** downforce = clA·v² (N), plus a fixed amount (suction fan) */
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
}

export const ROADSTER_SPEC: CarSpec = {
  mass: 1750,
  a: 1.36,
  b: 1.465,
  cgH: 0.42,
  izK: 1.05,
  power: 1_000_000,
  maxForce: 26000,
  frontDrive: 0,
  mu: 1.32,
  cornerB: 9,
  cdA: 0.52,
  clA: 1.15,
  fan: 5200,
  maxSteer: 0.6,
  brakeG: 1.5,
  hl: 2.29,
  hw: 1.0,
  height: 1.12,
  wheelR: 0.36,
  vmax: 112,
  vrev: 14,
};

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /** extra forward thrust (N) this step: the cold-gas thrusters */
  thrust: number;
}

const G = 9.81;

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
  /** assists */
  stability = 1;
  private contacts: Contact[] = [];
  private s2 = makeSurf();

  constructor(public spec: CarSpec) {}

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
  }

  step(dt: number, inp: CarInput, net: Network, world: CollisionWorld) {
    const S = this.spec;
    this.impact = 0;
    this.impactSolid = null;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h, inp, net, world);
    // the look: body pitch/roll springs toward the load transfer
    const kp = 0.0042, kr = 0.0058;
    const tp = THREE.MathUtils.clamp(-this.ax * kp, -0.06, 0.06);
    const tr = THREE.MathUtils.clamp(-this.ay * kr, -0.07, 0.07);
    const w = 11, z = 0.55;
    this.pitchV += (w * w * (tp - this.pitch) - 2 * z * w * this.pitchV) * dt;
    this.rollV += (w * w * (tr - this.roll) - 2 * z * w * this.rollV) * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;
    void S;
  }

  private sub(dt: number, inp: CarInput, net: Network, world: CollisionWorld) {
    const S = this.spec;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward f = (sy, cy); left l = (cy, -sy)
    let vL = this.vx * sy + this.vz * cy;
    let vT = this.vx * cy - this.vz * sy;
    const speed = Math.hypot(vL, vT);
    // ---- the ground under the car
    const surf = net.surface(this.pos.x, this.pos.z, this.pos.y + 0.3, this.surf);
    let gy = surf.y;
    // the slope along and across the car (sampled at the axles and the sides)
    const fx = this.pos.x + sy * S.a, fz = this.pos.z + cy * S.a;
    const rx = this.pos.x - sy * S.b, rz = this.pos.z - cy * S.b;
    const yF = net.surface(fx, fz, this.pos.y + 0.6, this.s2).y;
    const yR = net.surface(rx, rz, this.pos.y + 0.6, this.s2).y;
    const lx = this.pos.x + cy * 0.8, lz = this.pos.z - sy * 0.8;
    const ux = this.pos.x - cy * 0.8, uz = this.pos.z + sy * 0.8;
    const yLft = net.surface(lx, lz, this.pos.y + 0.6, this.s2).y;
    const yRgt = net.surface(ux, uz, this.pos.y + 0.6, this.s2).y;
    if (!surf.water) gy = Math.max(gy, (yF + yR) / 2 - 0.05);
    const slopeP = Math.atan2(yF - yR, S.a + S.b);
    const slopeR = Math.atan2(yLft - yRgt, 1.6);
    this.groundY = gy;
    const wasGround = this.onGround;
    // ---- vertical
    if (this.pos.y > gy + 0.06 || this.vy > 0.5) {
      this.onGround = false;
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (this.pos.y <= gy) {
        // landing
        if (this.vy < -3) this.impact = Math.max(this.impact, -this.vy * 0.5);
        this.pos.y = gy;
        this.vy = 0;
        this.onGround = true;
      }
    } else {
      // follow the ground: a rise becomes vertical speed (so cresting a ramp launches the car)
      const rise = (gy - this.pos.y) / dt;
      if (gy - this.pos.y > 0.6 && !surf.water) {
        // a step taller than a curb: it's a wall (handled by the barrier logic below)
      }
      this.vy = wasGround ? THREE.MathUtils.clamp(rise, -30, 30) : 0;
      this.pos.y = gy;
      this.onGround = true;
      this.airTime = 0;
    }
    this.groundPitch += (slopeP - this.groundPitch) * Math.min(1, dt * 20);
    this.groundRoll += (slopeR - this.groundRoll) * Math.min(1, dt * 20);
    // water: the car goes in
    this.inWater = surf.water && this.pos.y < WATER_Y + 0.4;
    // ---- steering: speed-sensitive lock, a quick but not instant rack
    const lockK = 1 / (1 + speed * speed / 900);
    const want = inp.steer * S.maxSteer * (0.35 + 0.65 * lockK);
    this.steer += THREE.MathUtils.clamp(want - this.steer, -3.2 * dt, 3.2 * dt);
    // ---- forces (car frame: L forward, T left)
    let FL = 0, FT = 0, Mz = 0;
    if (this.onGround && !this.inWater) {
      const m = S.mass;
      const L = S.a + S.b;
      const down = S.clA * speed * speed + S.fan;
      // load transfer from last step's longitudinal acceleration
      const Fz = m * G * Math.cos(this.groundPitch) + down;
      let Fzf = (m * G * S.b) / L + down * 0.45 - (m * this.ax * S.cgH) / L;
      let Fzr = Fz - Fzf;
      Fzf = Math.max(Fzf, 0.15 * Fz);
      Fzr = Math.max(Fzr, 0.15 * Fz);
      const mu = S.mu * (surf.sidewalk ? 0.95 : 1) * (1 - 0.3 * weatherUniforms.uWetness.value);
      // drive: reverse when braking from (near) standstill, D otherwise
      if (vL < 0.6 && inp.brake > 0.1 && inp.throttle < 0.05) this.reverse = true;
      if (inp.throttle > 0.1 && vL > -0.6) this.reverse = false;
      const pedal = this.reverse ? inp.brake : inp.throttle;
      const brake = this.reverse ? inp.throttle : inp.brake;
      const vAbs = Math.max(Math.abs(vL), 2.5);
      let drive = pedal * Math.min(S.maxForce, S.power / vAbs);
      if (this.reverse) drive = -drive * 0.5;
      // the limiter
      if ((!this.reverse && vL > S.vmax) || (this.reverse && vL < -S.vrev)) drive = 0;
      let Fdf = drive * S.frontDrive;
      let Fdr = drive * (1 - S.frontDrive);
      // traction control: never more than the tyres take
      const tcF = mu * Fzf * 0.98, tcR = mu * Fzr * 0.98;
      Fdf = THREE.MathUtils.clamp(Fdf, -tcF, tcF);
      if (!inp.handbrake) Fdr = THREE.MathUtils.clamp(Fdr, -tcR, tcR * (1.04 - 0.1 * this.stability));
      // brakes (with ABS): 60 / 40
      const bF = brake * S.brakeG * m * G;
      let Bf = Math.min(bF * 0.6, mu * Fzf) * Math.sign(vL);
      let Br = Math.min(bF * 0.4, mu * Fzr) * Math.sign(vL);
      if (inp.handbrake) Br = Math.min(mu * Fzr * 0.8, bF * 0.4 + m * G * 0.6) * Math.sign(vL);
      if (Math.abs(vL) < 0.3) {
        Bf *= Math.abs(vL) / 0.3;
        Br *= Math.abs(vL) / 0.3;
      }
      const FxF = Fdf - Bf;
      const FxR = Fdr - Br;
      // slip angles
      const vlat = Math.max(Math.abs(vL), 0.5);
      const af = Math.atan2(vT + S.a * this.yawRate, vlat) - this.steer * Math.sign(vL || 1);
      const ar = Math.atan2(vT - S.b * this.yawRate, vlat);
      const lat = (alpha: number, Fz: number, Fx: number, grip: number) => {
        const max = Math.sqrt(Math.max(0, (mu * Fz * grip) ** 2 - Fx * Fx));
        return -max * Math.sin(1.6 * Math.atan(S.cornerB * alpha));
      };
      const rearGrip = inp.handbrake ? 0.38 : 1;
      let Fyf = lat(af, Fzf, FxF, 1);
      let Fyr = lat(ar, Fzr, FxR, rearGrip);
      // at walking pace the slip angles mean nothing: blend to a kinematic turn
      const kin = 1 - THREE.MathUtils.smoothstep(speed, 1.2, 4.5);
      this.slip = THREE.MathUtils.clamp((Math.max(Math.abs(af), Math.abs(ar)) - 0.08) * 6 + (inp.handbrake && speed > 5 ? 0.6 : 0), 0, 1.5) * (1 - kin);
      if (Math.abs(FxR) > tcR * 0.97 && speed > 3) this.slip = Math.max(this.slip, 0.7);
      const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
      FL = FxF * cs - Fyf * sn + FxR;
      FT = Fyf * cs + FxF * sn + Fyr;
      Mz = S.a * (Fyf * cs + FxF * sn) - S.b * Fyr;
      // aero drag and rolling
      const drag = 0.5 * 1.2 * S.cdA * speed * speed + 0.012 * m * G;
      if (speed > 0.01) {
        FL -= (drag * vL) / speed;
        FT -= (drag * vT) / speed;
      }
      // gravity along the slope
      FL -= m * G * Math.sin(this.groundPitch);
      FT += m * G * Math.sin(this.groundRoll) * 0.5;
      FL += inp.thrust;
      const Iz = S.izK * m * S.a * S.b;
      const axL = FL / m, ayT = FT / m;
      this.ax = axL;
      this.ay = ayT;
      // integrate in the car frame (with the rotating-frame terms)
      vL += (axL + this.yawRate * vT) * dt;
      vT += (ayT - this.yawRate * vL) * dt;
      this.yawRate += (Mz / Iz) * dt;
      // stability: yaw damping that fades out on the handbrake
      this.yawRate *= 1 - (inp.handbrake ? 0.2 : 1.6 * this.stability) * dt * (1 - kin);
      if (kin > 0) {
        const wantYaw = (vL * Math.tan(this.steer)) / L;
        this.yawRate += (wantYaw - this.yawRate) * kin * Math.min(1, dt * 14);
        vT *= 1 - kin * Math.min(1, dt * 10);
        // standing still: no creep
        if (pedal < 0.02 && speed < 0.3) {
          vL *= 1 - Math.min(1, dt * 6);
        }
      }
      void Fz;
      void ar;
    } else if (this.inWater) {
      // sinking: heavy damping
      vL *= 1 - Math.min(1, dt * 1.5);
      vT *= 1 - Math.min(1, dt * 1.5);
      this.yawRate *= 1 - Math.min(1, dt * 2);
      this.vy = Math.max(this.vy, -1.5);
      this.ax = this.ay = 0;
    } else {
      // airborne: only drag (and the thrusters)
      const drag = 0.5 * 1.2 * S.cdA * speed;
      vL -= (drag * vL * dt) / S.mass;
      vT -= (drag * vT * dt) / S.mass;
      vL += (inp.thrust / S.mass) * dt;
      this.ax = this.ay = 0;
      this.slip = 0;
    }
    // back to world
    this.vx = vL * sy + vT * cy;
    this.vz = vL * cy - vT * sy;
    this.yaw += this.yawRate * dt;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.spin += (vL / S.wheelR) * dt;
    // ---- collisions
    this.collide(dt, net, world);
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
