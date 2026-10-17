import * as THREE from 'three';
import { buildRoadster, type RoadsterRig, type Trim } from './roadster.ts';
import { CarBody, ROADSTER_SPEC } from '../sim/car.ts';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Drivable, HudInfo, WorldCtx } from './drivable.ts';
import { makeSurf } from '../roads.ts';
import type { Contact } from '../sim/collide.ts';

/**
 * The player's Tesla Roadster: the model, the road physics and the SpaceX package.
 *
 *  Performance — 1 MW, rear-drive with torque vectoring, the suction fan's downforce from rest.
 *  Thrust — four rear cold-gas thrusters (Shift): ~2 g more, 0–60 mph in about 0.8 s, from a
 *           200 L nitrogen tank the electric pump refills while driving.
 *  Rocket — ten thrusters round the car (T lifts off): it flies like a drone — W/S tip it forward
 *           and back, A/D turn, Space climbs, X sinks, Q/E bank, Shift fires the rear boosters.
 *           600 L of gas, ~70 s of hover; empty, it falls. K: the kickflip from the reveal.
 */

const G = 9.81;

export class RoadsterCar implements Drivable {
  readonly kind = 'roadster' as const;
  name = 'Tesla Roadster';
  readonly rig: RoadsterRig;
  readonly car = new CarBody(ROADSTER_SPEC);
  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  occupied = false;
  impact = 0;
  health = 1;
  trim: Trim;
  /** 0..1 battery and cold-gas tank */
  battery = 0.92;
  gas = 1;
  /** flying (Rocket) */
  flying = false;
  private readonly q = new THREE.Quaternion();
  private readonly w = new THREE.Vector3();
  private readonly fv = new THREE.Vector3();
  private doorOpen = 0;
  doorTarget = 0;
  private kick = 0;
  private kickT = 0;
  private wingRise = 0;
  private boostLevel = 0;
  private surf = makeSurf();
  private contacts: Contact[] = [];
  /** for the audio */
  motorLoad = 0;
  thrustLevel = 0;
  braking = 0;

  constructor(trim: Trim, color?: THREE.ColorRepresentation) {
    this.trim = trim;
    this.rig = buildRoadster(trim, color);
    this.root = this.rig.root;
    this.name = trim === 'performance' ? 'Roadster' : trim === 'thrust' ? 'Roadster Thrust' : 'Roadster Rocket';
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.car.place(x, y, z, yaw);
    this.flying = false;
    this.sync(0);
  }

  get tankSize() {
    return this.trim === 'rocket' ? 1 : 0.4;
  }

  drive(dt: number, pad: Pad | null, ctx: WorldCtx) {
    this.impact = 0;
    const p = pad;
    const thrusters = this.trim !== 'performance';
    // ---- the doors (open when stopped with nobody in, or while getting in/out)
    this.doorOpen += THREE.MathUtils.clamp(this.doorTarget - this.doorOpen, -dt * 1.6, dt * 1.6);
    // ---- take off / land
    if (p?.flight && this.trim === 'rocket') {
      if (!this.flying && this.gas > 0.05) this.liftOff();
      else if (this.flying) this.flying = false; // cut the lift: it drops and lands on its wheels
    }
    if (p?.kick && (this.flying || !this.car.onGround) && this.kickT <= 0) this.kickT = 0.85;
    if (this.flying) this.fly(dt, p, ctx);
    else {
      // boost: the rear cold-gas nozzles
      const boosting = !!p?.boost && thrusters && this.gas > 0.01 && this.car.onGround;
      this.boostLevel += ((boosting ? 1 : 0) - this.boostLevel) * Math.min(1, dt * 12);
      const thrust = this.boostLevel * this.car.spec.mass * G * (this.trim === 'thrust' ? 2.0 : 1.5);
      if (boosting) this.gas = Math.max(0, this.gas - (dt / 12) / this.tankSize * 0.4);
      else if (thrusters) this.gas = Math.min(1, this.gas + dt * 0.012);
      this.car.step(
        dt,
        p
          ? { throttle: p.throttle, brake: p.brake, steer: p.steer, handbrake: p.handbrake, thrust }
          : { throttle: 0, brake: this.occupied ? 0 : 0.4, steer: 0, handbrake: !this.occupied, thrust: 0 },
        ctx.net,
        ctx.world,
      );
      this.impact = this.car.impact;
      this.motorLoad = p ? Math.max(p.throttle, this.car.reverse ? p.brake : 0) : 0;
      this.braking = p ? (this.car.reverse ? p.throttle : p.brake) : 0;
      this.battery = Math.max(0.05, this.battery - dt * this.motorLoad * this.car.speed * 1.2e-6);
      for (const th of this.rig.thrusters) th.level = th.kind === 'boost' ? this.boostLevel : th.level * Math.max(0, 1 - dt * 6);
      this.thrustLevel = this.boostLevel;
    }
    // the kickflip: a full roll in the air (body only while driving; the flight body rolls itself)
    if (this.kickT > 0) {
      this.kickT -= dt;
      const k = 1 - Math.max(0, this.kickT) / 0.85;
      this.kick = Math.PI * 2 * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      if (this.kickT <= 0) this.kick = 0;
    }
    if (this.impact > 6) this.health = Math.max(0, this.health - (this.impact - 6) * 0.01);
    this.sync(dt, ctx.t, ctx.night, p);
  }

  private liftOff() {
    this.flying = true;
    const c = this.car;
    this.q.setFromEuler(new THREE.Euler(-c.groundPitch, c.yaw, c.groundRoll, 'YXZ'));
    this.fv.set(c.vx, Math.max(c.vy, 2.5), c.vz);
    this.w.set(0, 0, 0);
  }

  private readonly e = new THREE.Euler();
  private fly(dt: number, p: Pad | null, ctx: WorldCtx) {
    const c = this.car;
    const m = c.spec.mass;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    const up = p?.up ? 1 : 0, down = p?.down ? 1 : 0;
    const fwdIn = p ? p.moveY : 0;
    const yawIn = p ? p.steer : 0;
    const rollIn = p ? (p.rollR ? 1 : 0) - (p.rollL ? 1 : 0) : 0;
    const boost = p?.boost && this.gas > 0.01 ? 1 : 0;
    let lift = 0;
    for (let i = 0; i < n; i++) {
      this.e.setFromQuaternion(this.q, 'YXZ');
      const pitch = this.e.x, roll = this.e.z, yaw = this.e.y;
      // attitude assist: aim pitch/roll at the stick, turn at a rate
      const tp = fwdIn * 0.42, tr = rollIn * 0.5;
      const kp = 9, kd = 4.2;
      const pitchAcc = kp * (tp - pitch) - kd * this.w.x;
      const rollAcc = kp * (tr - roll) - kd * this.w.z;
      const yawAcc = 4 * (yawIn * 1.5 - this.w.y);
      this.w.x += pitchAcc * h;
      this.w.z += rollAcc * h;
      this.w.y += yawAcc * h;
      // integrate orientation (w in the yaw-pitch-roll rates, close enough for an assisted flyer)
      this.e.set(pitch + this.w.x * h, yaw + this.w.y * h, roll + this.w.z * h, 'YXZ');
      this.q.setFromEuler(this.e);
      // lift: hold altitude, climb on Space, sink on X; tilt-compensated
      const tilt = Math.max(0.55, Math.cos(this.e.x) * Math.cos(this.e.z));
      let T = (1 + 0.85 * up - 0.75 * down) / tilt;
      if (!up && !down) T += -this.fv.y * 0.35;
      T = THREE.MathUtils.clamp(T, 0, 2.2);
      if (this.gas <= 0) T = 0;
      lift = T;
      const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
      const fwdV = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
      const F = upV.multiplyScalar(T * m * G).addScaledVector(fwdV, boost * m * G * 1.4);
      F.y -= m * G;
      // drag: a car is no wing
      const sp = this.fv.length();
      F.addScaledVector(this.fv, -0.5 * 1.2 * 1.6 * sp);
      F.y -= 0.5 * 1.2 * 3.0 * Math.abs(this.fv.y) * this.fv.y;
      this.fv.addScaledVector(F, h / m);
      c.pos.addScaledVector(this.fv, h);
      this.gas = Math.max(0, this.gas - h * (T * 0.55 + boost * 0.9) / 70 / this.tankSize);
      // collisions with the city
      const C = ctx.world.boxContacts(c.pos.x, c.pos.z, this.e.y, c.spec.hl, c.spec.hw, c.pos.y + 0.1, c.pos.y + c.spec.height, this.contacts);
      for (const ct of C) {
        c.pos.x += ct.nx * ct.depth;
        c.pos.z += ct.nz * ct.depth;
        const vn = this.fv.x * ct.nx + this.fv.z * ct.nz;
        if (vn < 0) {
          this.impact = Math.max(this.impact, -vn);
          this.fv.x -= 1.3 * vn * ct.nx;
          this.fv.z -= 1.3 * vn * ct.nz;
        }
      }
      // roofs and decks below: land on them
      const s = ctx.net.surface(c.pos.x, c.pos.z, c.pos.y + 0.5, this.surf);
      let gy = s.y;
      const roof = this.roofUnder(c.pos.x, c.pos.z, c.pos.y, ctx);
      if (roof > gy) gy = roof;
      if (c.pos.y < gy) {
        c.pos.y = gy;
        if (this.fv.y < 0) {
          this.impact = Math.max(this.impact, -this.fv.y * 0.6);
          this.fv.y = 0;
        }
        // touching down level and slow enough: back on the wheels
        if (!up && Math.abs(this.e.x) < 0.35 && Math.abs(this.e.z) < 0.35 && !s.water) {
          this.land(gy);
          break;
        }
      }
    }
    c.yaw = new THREE.Euler().setFromQuaternion(this.q, 'YXZ').y;
    c.vx = this.fv.x;
    c.vz = this.fv.z;
    c.vy = this.fv.y;
    // the nozzles: all ten breathe with the lift; the attitude moves gas fore/aft and side to side
    for (const th of this.rig.thrusters) {
      if (th.kind === 'boost') th.level = boost ? 1 : 0.15 * lift;
      else {
        const fore = th.pos.z > 0 ? 1 : -1, side = th.pos.x > 0 ? 1 : -1;
        th.level = THREE.MathUtils.clamp(lift * 0.62 + this.w.x * 0.25 * fore * -1 + this.w.z * 0.25 * side, 0, 1.2);
      }
    }
    this.thrustLevel = Math.max(lift * 0.6, boost);
    this.motorLoad = 0;
  }

  /** the flat roof of a building under (x, z), if the car is above it */
  private roofUnder(x: number, z: number, y: number, ctx: WorldCtx): number {
    let best = -Infinity;
    for (const s of ctx.world.query(x, z, 2, this.near)) {
      if (s.circle !== undefined || s.y1 > y + 0.6) continue;
      if (inPoly(x, z, s.poly)) best = Math.max(best, s.y1);
    }
    return best;
  }
  private near: import('../sim/collide.ts').Solid[] = [];

  private land(gy: number) {
    const c = this.car;
    this.flying = false;
    c.pos.y = gy;
    c.vy = 0;
    c.yawRate = 0;
    c.onGround = true;
  }

  private readonly tq = new THREE.Quaternion();
  private sync(dt: number, t = 0, night = 0, p: Pad | null = null) {
    const c = this.car;
    const r = this.rig;
    this.pos.copy(c.pos);
    this.vel.set(c.vx, c.vy, c.vz);
    this.yaw = c.yaw;
    r.root.position.copy(c.pos);
    if (this.flying) {
      r.root.quaternion.copy(this.q);
      r.body.rotation.set(0, 0, 0);
    } else {
      r.root.rotation.set(-c.groundPitch, c.yaw, c.groundRoll, 'YXZ');
      r.body.rotation.set(c.pitch, 0, -c.roll);
      r.body.position.y = 0;
    }
    if (this.kick) r.body.rotation.z += this.kick;
    r.setSteer(c.steer);
    r.spinWheels(dt * (c.vLong / ROADSTER_SPEC.wheelR));
    r.setBrake(this.braking > 0.05 ? Math.min(1, this.braking * 1.5) : 0);
    r.setHeadlights(night > 0.3 ? 1 : 0);
    r.setDoors(this.doorOpen);
    // the wing: rises over ~110 km/h, stands up as an air brake under hard braking
    const sp = c.speed;
    const want = this.flying ? 0.6 : sp > 30 ? 1 : sp < 20 ? 0 : (sp - 20) / 10;
    this.wingRise += (want - this.wingRise) * Math.min(1, dt * 2);
    const airbrake = !this.flying && this.braking > 0.6 && sp > 25 ? 1 : 0;
    r.setWing(this.wingRise, 0.12 * this.wingRise + airbrake * 0.9);
    r.update(t);
    void p;
    void this.tq;
  }

  subject(): CamSubject {
    return {
      pos: this.pos,
      yaw: this.yaw,
      vel: this.vel,
      quat: this.flying ? this.q : undefined,
      body: this.rig.body,
      eye: this.rig.eye,
      hood: new THREE.Vector3(0, 1.02, 0.95),
      size: 4.6,
      kind: this.flying ? 'flight' : 'car',
    };
  }

  hud(): HudInfo {
    const g: HudInfo['gauges'] = [{ label: 'Battery', value: this.battery, color: '#3ee08f' }];
    if (this.trim !== 'performance') g.push({ label: this.trim === 'rocket' ? 'Cold gas' : 'Nitrogen', value: this.gas, color: '#57e8ff' });
    return {
      name: this.name,
      speed: this.flying ? this.fv.length() : Math.abs(this.car.vLong),
      gauges: g,
      altitude: this.flying ? this.car.pos.y : undefined,
      mode: this.flying ? 'FLIGHT' : this.boostLevel > 0.5 ? 'THRUST' : undefined,
      gear: this.flying ? 'F' : this.car.reverse ? 'R' : 'D',
    };
  }

  exitPoint(out: THREE.Vector3): THREE.Vector3 {
    const c = this.car;
    return out.set(c.pos.x + Math.cos(c.yaw) * 1.6, c.pos.y, c.pos.z - Math.sin(c.yaw) * 1.6);
  }
}

function inPoly(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
