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
 *
 * Rollover: the planar model can't tip, so a car that trips (sliding sideways into a curb), takes a
 * blast or a big side hit, or is in the air for a while switches to a full rigid body ("free"): a
 * box with the car's inertia, its orientation q and angular velocity w, sprung wheels (grip across
 * the tread only, so a sideways slide over grippy tyres rolls it), body points on the sills, the
 * belt line and the roof that dig in and scrape, the walls as 3D impulses. It hands back to the
 * planar model once it sits on its wheels again; on its roof or side it stays there (overturned)
 * until autoRight (the player's car) rights it.
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
  /** false: never goes into the rigid-body tumble (the bike) */
  tumble?: boolean;
  /** half the track (m); default hw − 0.12 */
  track?: number;
  /** ride frequency of the springs (Hz) and the dampers' share of critical */
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
  /** viscous limited-slip across the driven axles (N·m per rad/s) */
  lsd?: number;
  /** front share of the braking */
  brakeBias?: number;
}

export const ROADSTER_SPEC: CarSpec = {
  mass: 1750,
  a: 1.36,
  b: 1.465,
  cgH: 0.42,
  izK: 1.05,
  power: 1_000_000,
  maxForce: 26000,
  // (three motors: one on the front axle, two on the rear)
  frontDrive: 0.35,
  mu: 1.32,
  cornerB: 9,
  cdA: 0.52,
  clA: 1.15,
  fan: 5200,
  maxSteer: 0.6,
  brakeG: 1.5,
  rideHz: 1.9,
  damping: 0.38,
  rollF: 0.56,
  track: 0.86,
  alphaP: 0.105,
  kappaP: 0.11,
  lsd: 60,
  brakeBias: 0.6,
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
/** the tyre curve: F = μ·Fz·sin(TC·atan(TB·s)), s the combined slip (1 at the peak; ~80 % of it sliding) */
const TC = 1.4;
const TB = Math.tan(Math.PI / (2 * TC));
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
  private readonly kS: number[];
  private readonly c0: number[];
  private readonly dS: number[];
  private readonly kArb: number[];
  private readonly fz0: number[];
  private readonly iw: number[];
  private readonly ip: number;
  private readonly ir: number;
  private heaveV = 0;
  private aGround = 0;
  private vyP = 0;
  private shiftT = 0;
  private liftT = 0;
  private readonly tpk: number;
  private readonly pts: { x: number; y: number; z: number; wheel: boolean }[];
  private readonly iInv: THREE.Vector3;
  private readonly h0: number;

  constructor(public spec: CarSpec) {
    const S = spec;
    this.h0 = S.cgH;
    const W = 2 * S.hw, L = 2 * S.hl, H = S.height;
    // a box's inertia (local x across, y up, z along)
    this.iInv = new THREE.Vector3(12 / (S.mass * (H * H + L * L)), 12 / (S.mass * (W * W + L * L)), 12 / (S.mass * (W * W + H * H)));
    const y0 = -this.h0, yt = H - this.h0;
    const tw = S.track ?? S.hw - 0.12;
    // ---- the suspension: a spring and damper at each corner, anti-roll bars, the wheels' inertia
    this.wx = [tw, -tw, tw, -tw];
    this.wz = [S.a, S.a, -S.b, -S.b];
    const Lw = S.a + S.b;
    const mf = (S.mass * S.b) / Lw / 2, mr = (S.mass * S.a) / Lw / 2;
    const om = 2 * Math.PI * (S.rideHz ?? 1.45);
    const kf = mf * om * om, kr = mr * om * om;
    this.kS = [kf, kf, kr, kr];
    this.fz0 = [mf * G, mf * G, mr * G, mr * G];
    this.c0 = this.fz0.map((f, i) => f / this.kS[i]);
    const z = S.damping ?? 0.32;
    this.dS = [0, 1, 2, 3].map((i) => 2 * z * Math.sqrt(this.kS[i] * (i < 2 ? mf : mr)));
    // the bars: the roll stiffness half as much again as the springs give, split front / rear
    const kRoll = 2 * tw * tw * (kf + kr) * 1.6;
    const rf = S.rollF ?? 0.6;
    const arbF = Math.max(0, (rf * kRoll) / (2 * tw * tw) - kf) / 2;
    const arbR = Math.max(0, ((1 - rf) * kRoll) / (2 * tw * tw) - kr) / 2;
    this.kArb = [arbF, arbF, arbR, arbR];
    this.ip = (S.mass * (L * L + H * H)) / 12;
    this.ir = (S.mass * (W * W + H * H)) / 12;
    // a wheel and tyre ~1.1 kg·m²; a driven one carries its share of the motor / engine and gearing
    const fd = S.frontDrive;
    const eng = S.gears ? 0.14 * (S.gears[0] * (S.finalDrive ?? 3.6)) ** 2 * 0.35 : 0.06 * 81;
    this.iw = [0, 1, 2, 3].map((i) => 1.1 * (S.wheelR / 0.34) ** 2 + (eng * (i < 2 ? fd : 1 - fd)) / 2);
    // the engine's peak torque from its power (peak power at the redline, the curve below)
    this.tpk = S.gears ? S.power / (0.818 * ((S.redline ?? 6500) * Math.PI) / 30) : 0;
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
        // (the sills tuck in under the doors: the body is widest at the belt)
        this.pts.push({ x: sx * S.hw * 0.84, y: y0 + 0.28, z: sz * S.hl, wheel: false });
        this.pts.push({ x: sx * S.hw, y: y0 + H * 0.6, z: sz * S.hl * 0.92, wheel: false });
        this.pts.push({ x: sx * S.hw * 0.72, y: yt, z: sz * S.hl * 0.42, wheel: false });
      }
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
    this.gear = 1;
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
    const S = this.spec;
    this.impact = 0;
    this.impactSolid = null;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    if (this.free) {
      this.freeStep(dt, n, inp, net, world);
      return;
    }
    for (let i = 0; i < n; i++) {
      this.sub(h, inp, net, world);
      if (this.free) {
        // it tripped / took off for good: the rest of the frame as a rigid body
        this.freeStep(h * (n - i - 1), n - i - 1, inp, net, world);
        return;
      }
    }
    void S;
  }

  private sub(dt: number, inp: CarInput, net: Network, world: CollisionWorld) {
    const S = this.spec;
    const m = S.mass;
    const R = S.wheelR;
    const Lw = S.a + S.b;
    const tw = this.wx[0];
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward f = (sy, cy); left l = (cy, -sy)
    let vL = this.vx * sy + this.vz * cy;
    let vT = this.vx * cy - this.vz * sy;
    const speed = Math.hypot(vL, vT);
    // ---- the ground under the car and under each wheel
    const surf = net.surface(this.pos.x, this.pos.z, this.pos.y + 0.3, this.surf);
    for (let i = 0; i < 4; i++) {
      const lx = this.wx[i], lz = this.wz[i];
      const g = net.surface(this.pos.x + sy * lz + cy * lx, this.pos.z + cy * lz - sy * lx, this.pos.y + 0.6, this.ws[i]);
      // (off an edge — a deck, the seawall — the wheel hangs: it isn't a slope to follow)
      this.wg[i] = g.water ? this.pos.y - 1 : THREE.MathUtils.clamp(g.y, this.pos.y - 0.6, this.pos.y + 0.6);
      const k = g.water ? 0 : g.grass ? 0.62 : g.sand ? 0.5 : g.sidewalk ? 0.95 : 1;
      this.wGrip[i] = k * (1 - (g.grass ? 0.25 : 0.3) * weatherUniforms.uWetness.value);
    }
    const wg = this.wg;
    const gf = (wg[0] + wg[1]) / 2, gr = (wg[2] + wg[3]) / 2;
    const slopeP = Math.atan2(gf - gr, Lw);
    const slopeR = Math.atan2((wg[0] + wg[2]) / 2 - (wg[1] + wg[3]) / 2, 2 * tw);
    let gy = surf.y;
    if (!surf.water) gy = Math.max(gy, gr + ((gf - gr) * S.b) / Lw - 0.05);
    this.groundY = gy;
    const wasGround = this.onGround;
    // ---- vertical
    if (this.pos.y > gy + 0.06 || this.vy > 0.5) {
      this.onGround = false;
      this.vy -= G * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (this.pos.y <= gy) {
        // landing: the springs take what the tyres don't
        if (this.vy < -3) this.impact = Math.max(this.impact, -this.vy * 0.5);
        this.heaveV = Math.min(this.heaveV, this.vy * 0.55);
        this.pos.y = gy;
        this.vy = 0;
        this.onGround = true;
      }
    } else {
      // follow the ground: a rise becomes vertical speed (so cresting a ramp launches the car)
      const rise = (gy - this.pos.y) / dt;
      this.vy = wasGround ? THREE.MathUtils.clamp(rise, -30, 30) : 0;
      this.pos.y = gy;
      this.onGround = true;
      this.airTime = 0;
    }
    // the ground's own vertical acceleration (a crest, a dip): the body feels it through the springs
    this.aGround += (THREE.MathUtils.clamp((this.vy - this.vyP) / dt, -40, 40) - this.aGround) * Math.min(1, dt * 25);
    this.vyP = this.vy;
    // (in the air it keeps the attitude it took off with)
    if (this.onGround) {
      this.groundPitch += (slopeP - this.groundPitch) * Math.min(1, dt * 20);
      this.groundRoll += (slopeR - this.groundRoll) * Math.min(1, dt * 20);
    }
    if (this.spec.tumble !== false && !surf.water) {
      // a long flight: the rigid body takes it (it lands nose- or tail-first, as it left the ramp)
      if (!this.onGround && this.airTime > 0.3) {
        this.enterFree();
        return;
      }
      // the trip: sliding sideways into a curb at speed, the tyres catch it and the body goes over
      if (this.onGround && Math.abs(vT) > 5.5) {
        const side = Math.sign(vT);
        const kx = this.pos.x + cy * side * (S.hw + 0.2), kz = this.pos.z - sy * side * (S.hw + 0.2);
        const ks = net.surface(kx, kz, this.pos.y + 0.6, this.s2);
        const rise = ks.y - gy;
        if (ks.sidewalk && !surf.sidewalk && rise > 0.1 && rise < 0.5) {
          this.enterFree();
          // the curb face stops the lower edge: the impulse that kills its sideways speed (less the
          // tyre's give) — both a shove and a roll, the rigid body decides whether it goes over
          const ex = this.pos.x + cy * side * S.hw * 0.9, ez = this.pos.z - sy * side * S.hw * 0.9, ey = gy + 0.12;
          const nx = -cy * side, nz = sy * side;
          const rx = ex - this.com.x, ry = ey - this.com.y, rz = ez - this.com.z;
          V3.set(rx, ry, rz);
          const vpn = (this.vel.x + this.w.y * rz - this.w.z * ry) * nx + (this.vel.z + this.w.x * ry - this.w.y * rx) * nz;
          if (vpn < 0) {
            V2.set(nx, 0, nz);
            V4.copy(V3).cross(V2);
            this.invI(V4).cross(V3);
            const k = 1 / S.mass + V4.dot(V2);
            const j = (-vpn / k) * 0.72;
            this.impulse(V1.set(nx * j, 0, nz * j), ex, ey, ez);
            this.impact = Math.max(this.impact, -vpn * 0.6);
          }
          this.sync();
          return;
        }
      }
    }
    // water: the car goes in
    this.inWater = surf.water && this.pos.y < WATER_Y + 0.4;
    // ---- the suspension: the sprung body (heave, pitch, roll) on four springs over the wheels.
    // The tyres' loads are the springs' forces, so the load moves with the body: forward under
    // braking, back under power, to the outside in a turn — and off a wheel that's in the air.
    const ground = this.onGround && !this.inWater;
    const noRoll = S.tumble === false;
    const down = ground ? S.clA * speed * speed + S.fan : 0;
    {
      const tp = Math.tan(this.groundPitch), tr = Math.tan(this.groundRoll);
      let Fs = 0, Mp = 0, Mr = 0;
      const comp = V1.set(0, 0, 0);
      const c = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const x = this.wx[i], z = this.wz[i];
        // the ground under the wheel against the chassis plane (a curb under one wheel, a pothole)
        const rr = ground ? THREE.MathUtils.clamp(wg[i] - (this.pos.y + z * tp + x * tr), -0.3, 0.3) : -0.3;
        this.rsP[i] = this.rs[i];
        // (the tyre and the wheel's own mass round off a step)
        this.rs[i] += (rr - this.rs[i]) * Math.min(1, dt * 45);
        const u = this.heave - this.pitch * z - (noRoll ? 0 : this.roll * x);
        c[i] = this.c0[i] + this.rs[i] - u;
      }
      void comp;
      for (let i = 0; i < 4; i++) {
        const x = this.wx[i], z = this.wz[i];
        const uV = this.heaveV - this.pitchV * z - (noRoll ? 0 : this.rollV * x);
        const cV = (this.rs[i] - this.rsP[i]) / dt - uV;
        let f = 0;
        if (c[i] > 0) {
          f = this.kS[i] * c[i] + this.dS[i] * cV;
          // the bump stop
          const over = c[i] - this.c0[i] - 0.1;
          if (over > 0) f += 7 * this.kS[i] * over;
          // the anti-roll bar: the other side's compression
          if (!noRoll) f += this.kArb[i] * (c[i] - Math.max(0, c[i ^ 1]));
          f = Math.max(0, f);
        }
        this.wLoad[i] = f;
        Fs += f;
        Mp -= f * z;
        Mr -= f * x;
        // where the wheel sits: on the ground, or hanging at full droop under a lifted body
        const u = this.heave - this.pitch * z - (noRoll ? 0 : this.roll * x);
        this.wDrop[i] = Math.max(this.rs[i], u - this.c0[i] - 0.03);
      }
      const h = S.cgH;
      const gz = G * Math.cos(this.groundPitch) * Math.cos(this.groundRoll) + (ground ? this.aGround : 0);
      // (the downforce acts a little ahead of the middle: 45 % on the front)
      const zcp = 0.45 * Lw - S.b;
      const aH = (Fs - down) / m - gz;
      const aP = (Mp - m * this.ax * h * 0.75 + down * zcp + m * G * h * this.pitch) / this.ip;
      const aR = noRoll ? 0 : (Mr - m * this.ay * h + m * G * h * this.roll) / this.ir;
      if (ground) {
        this.heaveV += aH * dt;
        this.pitchV += aP * dt;
        this.rollV += aR * dt;
      } else {
        // in the air the wheels drop to their stops and the body rides level on them
        const k = Math.min(1, dt * 8);
        this.heaveV += (-this.heave * 60 - this.heaveV * 10) * dt;
        this.pitchV *= 1 - k;
        this.rollV *= 1 - k;
        this.pitch *= 1 - k * 0.5;
        this.roll *= 1 - k * 0.5;
      }
      this.heave = THREE.MathUtils.clamp(this.heave + this.heaveV * dt, -0.2, 0.25);
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.pitchV * dt, -0.12, 0.12);
      this.roll = THREE.MathUtils.clamp(this.roll + this.rollV * dt, -0.16, 0.16);
      // two wheels off the ground on one side and the roll still growing: it goes over (the rigid body)
      const liftL = this.wLoad[0] + this.wLoad[2] < 1, liftR = this.wLoad[1] + this.wLoad[3] < 1;
      this.liftT = ground && !noRoll && (liftL || liftR) && speed > 4 ? this.liftT + dt : 0;
      if (this.liftT > 0.12 && Math.abs(this.ay) > (G * tw) / h && !surf.water) {
        this.liftT = 0;
        this.enterFree();
        // (the roll it already has, and the lateral slide the tyres keep pushing against)
        this.sync();
        return;
      }
    }
    // ---- steering: speed-sensitive lock, a quick but not instant rack
    const lockK = 1 / (1 + (speed * speed) / 900);
    const want = inp.steer * S.maxSteer * (0.35 + 0.65 * lockK);
    this.steer += THREE.MathUtils.clamp(want - this.steer, -3.2 * dt, 3.2 * dt);
    // ---- forces (car frame: L forward, T left)
    let FL = 0, FT = 0, Mz = 0;
    const kin = 1 - THREE.MathUtils.smoothstep(speed, 1.0, 3.5);
    if (ground) {
      // flat tyres: a rim on the road grips a third as well, drags, and pulls toward its side
      const fl = this.flats;
      // drive: reverse when braking from (near) standstill, D otherwise
      // (only from (near) standstill: sliding backwards out of a spin, the brake pedal still brakes)
      if (speed < 1.5 && vL < 0.6 && inp.brake > 0.1 && inp.throttle < 0.05) this.reverse = true;
      if (inp.throttle > 0.1 && vL > -0.6) this.reverse = false;
      const pedal = this.reverse ? inp.brake : inp.throttle;
      const brake = this.reverse ? inp.throttle : inp.brake;
      // ---- the powertrain: the torque at the driven wheels (N·m, all of them)
      const fd = S.frontDrive;
      const wDrv = Math.abs(fd * (this.wSpin[0] + this.wSpin[1]) + (1 - fd) * (this.wSpin[2] + this.wSpin[3])) / 2;
      let Td = 0;
      const limited = (!this.reverse && vL > S.vmax) || (this.reverse && vL < -S.vrev);
      if (S.gears) {
        const gs = S.gears, fdr = S.finalDrive ?? 3.6, red = S.redline ?? 6500, idle = 800;
        if (this.reverse) this.gear = -1;
        else if (this.gear < 1) this.gear = 1;
        const ratio = (this.gear < 0 ? gs[0] : gs[this.gear - 1]) * fdr;
        // the clutch slips at a launch: the engine holds its revs until the wheels catch up
        const wheelRpm = (wDrv * ratio * 30) / Math.PI;
        this.rpm = Math.max(wheelRpm, idle + pedal * red * 0.28 * (1 - THREE.MathUtils.smoothstep(wheelRpm, idle, red * 0.4)));
        this.shiftT -= dt;
        if (this.gear > 0 && this.shiftT <= 0) {
          // the automatic: up near the redline flat out, early when cruising; down when it bogs
          const up = red * (0.42 + 0.53 * pedal);
          if (wheelRpm > up && this.gear < gs.length) {
            this.gear++;
            this.shiftT = 0.28;
          } else if (this.gear > 1 && this.rpm * (gs[this.gear - 2] / gs[this.gear - 1]) < red * 0.9 && this.rpm < red * (0.25 + 0.22 * pedal)) {
            this.gear--;
            this.shiftT = 0.2;
          }
        }
        const x = this.rpm / red;
        let Te = pedal * this.tpk * (1 - 0.9 * (x - 0.55) ** 2);
        if (x > 1 || this.shiftT > 0.05 || limited) Te = 0;
        // off the throttle the engine brakes
        if (pedal < 0.05 && wheelRpm > idle * 1.3) Te = -0.16 * this.tpk * x;
        Td = Te * ratio * 0.9 * (this.gear < 0 ? -1 : 1);
      } else {
        this.rpm = 0;
        this.gear = this.reverse ? -1 : 1;
        // an EV: full torque from standstill, then power-limited; it regenerates off the throttle
        Td = pedal * Math.min(S.maxForce * R, S.power / Math.max(wDrv, 2.5 / R));
        if (this.reverse) Td = -Td * 0.5;
        if (limited) Td = 0;
        if (pedal < 0.05 && Math.abs(vL) > 3) Td = -0.05 * m * G * R * Math.sign(vL);
      }
      // ---- brakes (ABS), the handbrake on the rears
      const bias = S.brakeBias ?? 0.64;
      const Tb = brake * S.brakeG * m * G * R;
      // ---- steering geometry (Ackermann: the inside wheel turns tighter)
      const st = this.steer;
      let dL = st, dR = st;
      if (Math.abs(st) > 1e-4) {
        const Rt = Lw / Math.tan(st);
        dL = Math.atan(Lw / (Rt - tw));
        dR = Math.atan(Lw / (Rt + tw));
      }
      const kp = S.kappaP ?? 0.12, ap = S.alphaP ?? 0.13;
      const abs = true, tcs = !inp.handbrake && this.stability > 0;
      const yr = this.yawRate;
      let sMax = 0;
      // the limited-slip: torque from the faster driven wheel to the slower
      const lsdR = fd < 1 ? (S.lsd ?? 0) * (this.wSpin[2] - this.wSpin[3]) : 0;
      const lsdF = fd > 0 ? (S.lsd ?? 0) * (this.wSpin[0] - this.wSpin[1]) : 0;
      let rr = 0;
      for (let i = 0; i < 4; i++) {
        const front = i < 2;
        const x = this.wx[i], z = this.wz[i];
        const d = front ? (i === 0 ? dL : dR) : 0;
        const cs = Math.cos(d), sn = Math.sin(d);
        const v0 = vL - yr * x, v1 = vT + yr * z;
        const vx = v0 * cs + v1 * sn, vy = -v0 * sn + v1 * cs;
        const Fz = this.wLoad[i];
        const flat = (fl >> i) & 1;
        // grip: the surface, a flat, and the load (a tyre grips less per newton the harder it's pressed)
        const mu = S.mu * this.wGrip[i] * (flat ? 0.34 : 1) * THREE.MathUtils.clamp(1 - 0.12 * (Fz / this.fz0[i] - 1), 0.8, 1.12);
        rr += Fz * (this.wGrip[i] < 0.7 ? 0.06 : 0.012) + (flat ? (0.035 + 0.004 * speed) * this.fz0[i] * 2 : 0);
        let Td_i = (Td * (front ? S.frontDrive : 1 - S.frontDrive)) / 2;
        if (front) Td_i += i === 0 ? -lsdF / 2 : lsdF / 2;
        else Td_i += i === 2 ? -lsdR / 2 : lsdR / 2;
        let Tb_i = Tb * (front ? bias : 1 - bias) * 0.5;
        const hb = inp.handbrake && !front;
        if (hb) Tb_i += m * G * R;
        const vd = Math.max(Math.abs(vx), 1);
        let w = this.wSpin[i];
        const Iw = this.iw[i];
        if (Fz <= 0) {
          // in the air: the drive spins it up, the brakes stop it
          w += (Td_i / Iw) * dt;
          w = Math.abs(w) < (Tb_i / Iw) * dt ? 0 : w - Math.sign(w) * (Tb_i / Iw) * dt;
          this.wSpin[i] = w;
          this.wSlip[i] = 0;
          continue;
        }
        // the tyre at the wheel's present spin (combined slip: one budget for driving and cornering)
        const alpha = Math.atan(vy / vd);
        let kappa = (w * R - vx) / vd;
        let sx = kappa / kp, syy = alpha / ap;
        let s = Math.hypot(sx, syy);
        let F = mu * Fz * Math.sin(TC * Math.atan(TB * s));
        let Fx = s > 1e-6 ? (F * sx) / s : 0;
        // the wheel: torque in, the tyre's reaction (taken implicitly: a stiff spring at low speed)
        const Kx = (mu * Fz * TB * TC) / kp / (1 + (TB * s) ** 2);
        const den = Iw + (dt * R * R * Kx) / vd;
        w += (dt * (Td_i - R * Fx)) / den;
        if (Tb_i > 0) {
          const dw = (dt * Tb_i) / den;
          w = Math.abs(w) <= dw ? 0 : w - Math.sign(w) * dw;
        }
        // ABS holds a braked wheel just short of locking; traction control a driven one short of spinning
        if (abs && !hb && Tb_i > 0 && Math.abs(vx) > 1.5) {
          const lim = (vx - Math.sign(vx) * kp * 0.85 * vd) / R;
          w = vx > 0 ? Math.max(w, lim) : Math.min(w, lim);
        }
        if (tcs && (Td_i * Math.sign(vx || 1) > 0 || Math.abs(vx) < 0.5)) {
          const k = kp * (1.1 + 0.6 * (1 - Math.min(1, this.stability)));
          const lim = (vx + Math.sign(Td_i) * k * vd) / R;
          w = Td_i > 0 ? Math.min(w, Math.max(lim, vx / R)) : Math.max(w, Math.min(lim, vx / R));
        }
        if (hb) w = 0;
        this.wSpin[i] = w;
        kappa = (w * R - vx) / vd;
        sx = kappa / kp;
        syy = alpha / ap;
        s = Math.hypot(sx, syy);
        F = mu * Fz * Math.sin(TC * Math.atan(TB * s));
        Fx = s > 1e-6 ? (F * sx) / s : 0;
        let Fy = s > 1e-6 ? (-F * syy) / s : 0;
        // (never more than closes the slip this step: no jitter at parking speeds)
        const capY = (Math.abs(vy) * m * 0.25) / dt;
        if (Math.abs(Fy) > capY) Fy = Math.sign(Fy) * capY;
        const capX = (Math.abs(w * R - vx) * m * 0.25) / dt;
        if (Math.abs(Fx) > capX) Fx = Math.sign(Fx) * capX;
        this.wSlip[i] = s;
        sMax = Math.max(sMax, s);
        const fxl = Fx * cs - Fy * sn, fyl = Fx * sn + Fy * cs;
        FL += fxl;
        FT += fyl;
        Mz += z * fyl - x * fxl;
      }
      // squeal and smoke: past the peak
      this.slip = THREE.MathUtils.clamp((sMax - 0.9) * 1.6 + (inp.handbrake && speed > 5 ? 0.5 : 0), 0, 1.5) * (1 - kin);
      // ---- stability control: brakes the yaw back toward what the steering asks (the grip allows)
      const Iz = S.izK * m * S.a * S.b;
      if (!inp.handbrake && this.stability > 0 && speed > 6) {
        const muG = S.mu * G * 1.05;
        let rRef = (vL * Math.tan(st)) / (Lw * (1 + (vL * vL) / 900));
        rRef = THREE.MathUtils.clamp(rRef, -muG / speed, muG / speed);
        const err = yr - rRef;
        const over = Math.abs(err) - 0.06;
        if (over > 0 && (Math.abs(yr) > Math.abs(rRef) || Math.sign(yr) !== Math.sign(rRef))) {
          Mz -= Math.sign(err) * Math.min(over * 7, 2.5) * Iz * this.stability;
          // (the brake it uses to do it)
          FL -= Math.sign(vL) * Math.min(over * 0.25, 0.25) * m * G * this.stability;
        }
      }
      // ---- the air, the rolling tyres
      const drag = 0.5 * 1.2 * S.cdA * speed * speed + rr;
      if (speed > 0.01) {
        FL -= (drag * vL) / speed;
        FT -= (drag * vT) / speed;
      }
      // gravity along the slope
      FL -= m * G * Math.sin(this.groundPitch);
      FT += m * G * Math.sin(this.groundRoll);
      FL += inp.thrust;
      const axL = FL / m, ayT = FT / m;
      this.ax = axL;
      this.ay = ayT;
      // integrate in the car frame (with the rotating-frame terms)
      vL += (axL + this.yawRate * vT) * dt;
      vT += (ayT - this.yawRate * vL) * dt;
      this.yawRate += (Mz / Iz) * dt;
      // a bike's rider keeps it from swapping ends: the yaw follows the line the front tyre asks for
      if (noRoll && !inp.handbrake) {
        const k = Math.min(1, dt * 3 * this.stability) * (1 - kin);
        const rLine = (vL * Math.tan(st)) / Lw;
        const rMax = (0.85 * S.mu * G) / Math.max(speed, 1);
        this.yawRate += (THREE.MathUtils.clamp(rLine, -rMax, rMax) - this.yawRate) * k;
        // (and leans into it rather than sliding)
        vT *= 1 - k * 0.4;
      }
      if (kin > 0) {
        const wantYaw = (vL * Math.tan(this.steer)) / Lw;
        this.yawRate += (wantYaw - this.yawRate) * kin * Math.min(1, dt * 14);
        vT *= 1 - kin * Math.min(1, dt * 10);
        // standing still: no creep; the brakes hold it
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
    } else {
      // airborne: only drag (and the thrusters); the wheels coast
      const drag = 0.5 * 1.2 * S.cdA * speed;
      vL -= (drag * vL * dt) / S.mass;
      vT -= (drag * vT * dt) / S.mass;
      vL += (inp.thrust / S.mass) * dt;
      this.ax = this.ay = 0;
      this.slip = 0;
      for (let i = 0; i < 4; i++) {
        this.wSpin[i] *= inp.brake > 0.2 || (inp.handbrake && i > 1) ? 1 - Math.min(1, dt * 8) : 1 - dt * 0.2;
        this.wSlip[i] = 0;
      }
    }
    // back to world
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
    this.liftT = 0;
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
