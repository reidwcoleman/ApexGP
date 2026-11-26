import * as THREE from 'three';
import { clamp, damp, pick } from '../core/math';
import { WATER_Y, groundAt, groundBase, isWater, type Box, type ColliderGrid } from '../world/map';
import { waveHeight } from '../world/water';
import { SPECS, carMats, carModel, paintMat, type CarSpec, type CarType } from './carModels';
import { alloyWheel, kitModel } from './carKit';

const wheelCache = new Map<string, THREE.BufferGeometry>();
function wheelFor(r: number, wid: number) {
  const k = r.toFixed(3) + ':' + wid;
  let g = wheelCache.get(k);
  if (!g) wheelCache.set(k, (g = alloyWheel(r, wid > 1.95 ? 0.3 : 0.25)));
  return g;
}

export interface VehicleInput {
  thr: number; // -1..1
  steer: number; // -1..1 (positive = left)
  hand: boolean;
}

export interface CarAI {
  drive(v: Vehicle, dt: number): void;
}

export interface VehicleEvents {
  onImpact(v: Vehicle, speed: number, x: number, y: number, z: number, other: Vehicle | null): void;
  onSink(v: Vehicle): void;
}

const tmpBoxes: Box[] = [];
let nextId = 1;

export class Vehicle {
  id = nextId++;
  spec: CarSpec;
  type: CarType;
  root = new THREE.Group();
  body: THREE.Mesh;
  wheels: THREE.Mesh[] = [];
  paint: THREE.MeshStandardMaterial;
  color: number;
  pos = new THREE.Vector3();
  heading = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  yawRate = 0;
  steerAngle = 0;
  wheelSpin = 0;
  pitch = 0;
  roll = 0;
  input: VehicleInput = { thr: 0, steer: 0, hand: false };
  health: number;
  wrecked = false;
  burnTimer = 0;
  sinking = 0;
  sunk = false;
  /** who is driving: 'player', 'npc' (ped/cop inside), or null */
  driver: 'player' | 'npc' | null = null;
  ai: CarAI | null = null;
  police = false;
  siren = false;
  persistent = false;
  missionTag = '';
  lastPlayerHit = 0;
  airborne = false;
  slip = 0;
  rpm = 0;
  gear = 1;
  despawnable = true;
  occupants = 0; // npc occupants (cops)
  sirenRed: THREE.Mesh | null = null;
  sirenBlue: THREE.Mesh | null = null;
  beam: THREE.Mesh | null = null;
  smokeT = 0;
  stuckT = 0;
  age = 0;

  private sirenPos: THREE.Vector3[] | null = null;
  /** the driver's seat in the car's frame (null: nobody shown) */
  seat: THREE.Vector3 | null = null;
  vid = Math.floor(Math.random() * 1e9);

  constructor(type: CarType, color?: number) {
    this.type = type;
    this.spec = SPECS[type];
    this.health = this.spec.health;
    this.color = color ?? pick(this.spec.colors);
    this.paint = paintMat(this.color);
    const kitM = kitModel(type, this.spec, Math.floor(Math.random() * 16));
    const model = carModel(type);
    this.body = new THREE.Mesh(kitM ? kitM.geo : model.geo, [this.paint, carMats.detail, carMats.lamps, carMats.glass]);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.root.add(this.body);
    if (kitM) this.seat = kitM.seat;
    if (kitM) {
      model.sirenRed && (this.sirenPos = [new THREE.Vector3(-0.3, kitM.roofY + 0.07, -0.25), new THREE.Vector3(0.3, kitM.roofY + 0.07, -0.25)]);
    }
    const wheelGeo = kitM ? wheelFor(kitM.wheelR, this.spec.wid) : model.wheelGeo;
    if (wheelGeo) {
      for (const w of kitM ? kitM.wheels : model.wheels) {
        const m = new THREE.Mesh(wheelGeo, carMats.wheel);
        m.position.copy(w);
        m.castShadow = true;
        this.body.add(m);
        this.wheels.push(m);
      }
    }
    if (model.sirenRed && model.sirenBlue) {
      const g = new THREE.BoxGeometry(0.5, 0.14, 0.26);
      this.sirenRed = new THREE.Mesh(g, carMats.sirenOff);
      this.sirenRed.position.copy(this.sirenPos ? this.sirenPos[0] : model.sirenRed);
      this.sirenBlue = new THREE.Mesh(g, carMats.sirenOffB);
      this.sirenBlue.position.copy(this.sirenPos ? this.sirenPos[1] : model.sirenBlue);
      this.body.add(this.sirenRed, this.sirenBlue);
      this.police = type === 'police';
    }
    this.root.userData.vehicle = this;
  }

  get isBoat() {
    return this.type === 'boat';
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  get forwardSpeed() {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }
  fwdX() {
    return Math.sin(this.heading);
  }
  fwdZ() {
    return Math.cos(this.heading);
  }

  place(x: number, z: number, heading: number) {
    this.pos.set(x, this.isBoat ? WATER_Y : groundAt(x, z), z);
    this.heading = heading;
    this.vx = this.vz = this.vy = this.yawRate = 0;
    this.syncMesh(0);
  }

  /** world position of the driver door (left side) */
  doorPos(out: THREE.Vector3): THREE.Vector3 {
    const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
    const side = -(this.spec.wid / 2 + 0.7);
    return out.set(this.pos.x + rx * side + this.fwdX() * 0.3, this.pos.y, this.pos.z + rz * side + this.fwdZ() * 0.3);
  }

  damage(amount: number) {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      if (this.burnTimer === 0) this.burnTimer = 0.001;
    }
  }

  wreck() {
    this.wrecked = true;
    this.health = 0;
    this.body.material = [carMats.burnt, carMats.burnt, carMats.burnt];
    this.siren = false;
    for (const w of this.wheels) w.material = carMats.burnt;
  }

  /** Physics step. */
  update(dt: number, colliders: ColliderGrid, events: VehicleEvents, elapsed: number) {
    this.age += dt;
    const s = this.spec;
    const inp = this.input;
    if (this.wrecked || this.sunk || this.burnTimer > 0) {
      inp.thr = 0;
      inp.hand = true;
      inp.steer = 0;
    }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * rx + this.vz * rz;
    const onGround = !this.airborne;

    // ---- engine and brakes
    if (onGround && !this.sinking) {
      const thr = inp.thr;
      if (thr > 0.01) {
        if (vLong < -0.5) vLong += s.brake * thr * dt;
        else {
          const f = 1 - clamp(vLong / s.maxSpeed, 0, 1) ** 2;
          vLong += s.accel * thr * f * dt * (this.isBoat ? 1 : 1);
        }
      } else if (thr < -0.01) {
        if (vLong > 0.5) vLong += s.brake * thr * dt;
        else {
          const maxRev = this.isBoat ? 8 : 13;
          vLong += s.accel * 0.6 * thr * (1 - clamp(-vLong / maxRev, 0, 1)) * dt;
        }
      } else {
        // rolling resistance
        const rr = this.isBoat ? 1.6 : 1.1;
        vLong = Math.abs(vLong) < rr * dt ? 0 : vLong - Math.sign(vLong) * rr * dt;
      }
      if (inp.hand && !this.isBoat) {
        const hb = 7.5 * dt;
        vLong = Math.abs(vLong) < hb ? 0 : vLong - Math.sign(vLong) * hb;
      }
      // aerodynamic drag
      vLong -= vLong * Math.abs(vLong) * (this.isBoat ? 0.004 : 0.0009) * dt;
    }

    // ---- steering (speed sensitive)
    const sp = Math.abs(vLong);
    const maxSteer = s.steer / (1 + sp / 17);
    this.steerAngle = damp(this.steerAngle, inp.steer * maxSteer, 9, dt);
    let yawTarget: number;
    if (this.isBoat) yawTarget = inp.steer * 0.9 * clamp(sp / 6, 0, 1) * Math.sign(vLong || 1);
    else yawTarget = (vLong * Math.tan(this.steerAngle)) / s.wheelbase;
    let grip = s.grip;
    let yawGrip = 9;
    if (inp.hand && !this.isBoat && sp > 4) {
      grip = 1.1;
      yawGrip = 3.5;
      yawTarget *= 1.55;
    }
    // slip angle reduces grip a little when already sliding (lets drifts carry)
    const slipNow = Math.abs(vLat);
    if (!inp.hand && slipNow > 4) grip *= 0.6;
    if (!onGround) {
      grip = 0;
      yawGrip = 0.3;
    }
    if (this.sinking) {
      grip = 2;
      yawTarget = 0;
    }
    this.yawRate += (yawTarget - this.yawRate) * clamp(yawGrip * dt, 0, 1);
    vLat *= Math.exp(-grip * dt);
    this.slip = Math.abs(vLat);

    this.vx = fx * vLong + rx * vLat;
    this.vz = fz * vLong + rz * vLat;
    this.heading += this.yawRate * dt;

    // ---- integrate
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // ---- vertical
    if (this.isBoat) {
      if (!isWater(this.pos.x, this.pos.z)) {
        // beached: stop against the land
        this.pos.x = px;
        this.pos.z = pz;
        const imp = this.speed;
        this.vx *= -0.2;
        this.vz *= -0.2;
        if (imp > 3) events.onImpact(this, imp, this.pos.x, this.pos.y, this.pos.z, null);
      }
      const wh = waveHeight(this.pos.x, this.pos.z, elapsed) * 0.5;
      this.pos.y = damp(this.pos.y, WATER_Y + wh + 0.05 + Math.min(0.25, sp * 0.01), 6, dt);
      this.airborne = false;
    } else {
      const g = groundAt(this.pos.x, this.pos.z, this.pos.y + 1.0);
      if (this.pos.y > g + 0.06) {
        this.airborne = true;
        this.vy -= 20 * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= g) {
          if (this.vy < -7) events.onImpact(this, -this.vy * 0.6, this.pos.x, this.pos.y, this.pos.z, null);
          this.pos.y = g;
          this.vy = 0;
          this.airborne = false;
        }
      } else {
        const nvy = (g - this.pos.y) / Math.max(dt, 1e-4);
        this.vy = clamp(nvy, -2, 14);
        this.pos.y = g;
        this.airborne = false;
      }
      // water
      if (groundBase(this.pos.x, this.pos.z) < WATER_Y - 0.4 && this.pos.y < WATER_Y + 0.3) {
        if (!this.sinking) {
          this.sinking = 0.001;
          events.onSink(this);
        }
      }
      if (this.sinking) {
        this.sinking += dt;
        this.airborne = false;
        this.pos.y = Math.max(this.pos.y - dt * 0.8, WATER_Y - 1.6);
        this.vx *= Math.exp(-2.5 * dt);
        this.vz *= Math.exp(-2.5 * dt);
        if (this.sinking > 3 && !this.sunk) {
          this.sunk = true;
          this.wrecked = true;
        }
      }
    }

    // ---- static collisions (three circles along the body)
    if (!this.sinking) this.collideStatic(colliders, events);

    // ---- burning / explosion handled by game; drive the visual
    this.syncMesh(dt);
  }

  circles(out: { x: number; z: number; r: number }[]): { x: number; z: number; r: number }[] {
    const s = this.spec;
    const r = s.wid / 2;
    const off = s.len / 2 - r;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    out.length = 0;
    out.push({ x: this.pos.x + fx * off, z: this.pos.z + fz * off, r }, { x: this.pos.x, z: this.pos.z, r }, { x: this.pos.x - fx * off, z: this.pos.z - fz * off, r });
    return out;
  }

  private circ: { x: number; z: number; r: number }[] = [];
  private collideStatic(colliders: ColliderGrid, events: VehicleEvents) {
    const cs = this.circles(this.circ);
    const y0 = this.pos.y + (this.isBoat ? -0.5 : 0.25), y1 = this.pos.y + this.spec.hgt;
    for (let k = 0; k < 3; k++) {
      const c = cs[k];
      const res = colliders.resolveCircle(c.x, c.z, c.r, y0, y1, tmpBoxes);
      if (!res) continue;
      const dx = res.x - c.x, dz = res.z - c.z;
      this.pos.x += dx;
      this.pos.z += dz;
      for (const o of cs) { o.x += dx; o.z += dz; }
      const offx = c.x - this.pos.x, offz = c.z - this.pos.z;
      // velocity of the contact point
      const vpx = this.vx + this.yawRate * offz, vpz = this.vz - this.yawRate * offx;
      const vn = vpx * res.nx + vpz * res.nz;
      if (vn < 0) {
        const e = 0.25;
        this.vx -= (1 + e) * vn * res.nx;
        this.vz -= (1 + e) * vn * res.nz;
        // tangential scrub
        this.vx *= 0.97;
        this.vz *= 0.97;
        const torque = offx * res.nz - offz * res.nx;
        this.yawRate += torque * vn * 0.08;
        this.yawRate *= 0.8;
        const imp = -vn;
        if (imp > 2) {
          this.damage((imp - 2) * 14);
          events.onImpact(this, imp, c.x - res.nx * c.r, this.pos.y + 0.6, c.z - res.nz * c.r, null);
        }
      }
    }
  }

  syncMesh(dt: number) {
    const s = this.spec;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    // pitch from terrain and acceleration, roll from cornering
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let tp = 0;
    if (!this.isBoat && !this.airborne) {
      const h = s.len * 0.45;
      const gf = groundAt(this.pos.x + fx * h, this.pos.z + fz * h, this.pos.y + 1.5);
      const gb = groundAt(this.pos.x - fx * h, this.pos.z - fz * h, this.pos.y + 1.5);
      tp = -Math.atan2(gf - gb, h * 2);
    }
    const vLong = this.forwardSpeed;
    const accelPitch = clamp(this.input.thr * 0.02 * (Math.abs(vLong) < s.maxSpeed * 0.9 ? 1 : 0), -0.03, 0.03);
    const rollT = clamp(this.yawRate * vLong * 0.004, -0.09, 0.09);
    if (this.isBoat) tp -= clamp(Math.abs(vLong) * 0.006, 0, 0.12);
    if (dt > 0) {
      this.pitch = damp(this.pitch, tp - accelPitch, 10, dt);
      this.roll = damp(this.roll, rollT, 6, dt);
    } else {
      this.pitch = tp;
    }
    this.body.rotation.set(this.pitch, 0, this.roll, 'YXZ');
    if (this.sinking) this.body.rotation.x += Math.min(0.5, this.sinking * 0.2);
    // wheels
    if (this.wheels.length) {
      this.wheelSpin += (vLong / s.wheelR) * dt;
      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        w.rotation.set(this.wheelSpin, i < 2 ? this.steerAngle : 0, 0, 'YXZ');
      }
    }
    // rpm for audio
    const frac = clamp(Math.abs(vLong) / s.maxSpeed, 0, 1);
    const gears = 5;
    this.gear = Math.min(gears, 1 + Math.floor(frac * gears * 0.999));
    const within = frac * gears - (this.gear - 1);
    const target = 0.18 + 0.72 * within + Math.abs(this.input.thr) * 0.1;
    this.rpm = dt > 0 ? damp(this.rpm, target, 8, dt) : target;
  }

  setSirenVisual(t: number) {
    if (!this.sirenRed || !this.sirenBlue) return;
    const on = this.siren && !this.wrecked;
    const a = Math.floor(t * 6) % 2 === 0;
    this.sirenRed.material = on && a ? carMats.sirenRed : carMats.sirenOff;
    this.sirenBlue.material = on && !a ? carMats.sirenBlue : carMats.sirenOffB;
  }
}

/** Resolve overlaps and momentum between vehicles. */
export function collideVehicles(list: Vehicle[], events: VehicleEvents) {
  const ca: { x: number; z: number; r: number }[] = [], cb: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.sinking) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.sinking || a.isBoat !== b.isBoat) continue;
      const dx0 = b.pos.x - a.pos.x, dz0 = b.pos.z - a.pos.z;
      const lim = (a.spec.len + b.spec.len) / 2 + 0.5;
      if (dx0 * dx0 + dz0 * dz0 > lim * lim) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
      a.circles(ca);
      b.circles(cb);
      for (const p of ca)
        for (const q of cb) {
          const dx = q.x - p.x, dz = q.z - p.z;
          const rr = p.r + q.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          const pen = rr - d;
          const ma = a.spec.mass * (a.wrecked && !a.persistent ? 1.5 : 1), mb = b.spec.mass;
          const wa = mb / (ma + mb), wb = ma / (ma + mb);
          a.pos.x -= nx * pen * wa;
          a.pos.z -= nz * pen * wa;
          b.pos.x += nx * pen * wb;
          b.pos.z += nz * pen * wb;
          const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rv < 0) {
            const e = 0.3;
            const jimp = (-(1 + e) * rv) / (1 / ma + 1 / mb);
            a.vx -= (jimp / ma) * nx;
            a.vz -= (jimp / ma) * nz;
            b.vx += (jimp / mb) * nx;
            b.vz += (jimp / mb) * nz;
            a.yawRate += (Math.random() - 0.5) * -rv * 0.05;
            b.yawRate += (Math.random() - 0.5) * -rv * 0.05;
            const imp = -rv;
            if (imp > 2.5) {
              a.damage((imp - 2.5) * 10 * (mb / ma));
              b.damage((imp - 2.5) * 10 * (ma / mb));
              events.onImpact(a, imp, (p.x + q.x) / 2, a.pos.y + 0.6, (p.z + q.z) / 2, b);
            }
          }
        }
    }
  }
}
