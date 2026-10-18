import * as THREE from 'three';
import { CarBody } from '../sim/car.ts';
import { carSpecOf, type AICar, type Traffic } from '../ai/traffic.ts';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Drivable, HudInfo, WorldCtx } from './drivable.ts';
import { MODELS, type ModelId } from './fleet.ts';

/**
 * Any of the city's cars driven by the player: one taken from the traffic (the AI car stays in
 * the fleet's instances, its physics handed to the player) or one delivered from the menu.
 */
export class FleetCar implements Drivable {
  readonly kind = 'car' as const;
  name: string;
  readonly root = new THREE.Object3D();
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  yaw = 0;
  occupied = false;
  impact = 0;
  health = 1;
  police: boolean;
  readonly body: CarBody;
  /** police lights and siren (H toggles in a cruiser) */
  siren = false;
  private t = 0;
  private hornWas = false;

  constructor(
    readonly car: AICar,
    private readonly traffic: Traffic,
  ) {
    const spec = MODELS[car.spec.id as ModelId];
    this.body = new CarBody(carSpecOf(spec));
    if (car.body) {
      // (already a body: keep it, tumbling or on its roof as it is)
      this.body = car.body;
    } else this.body.placeTilted(car.pos.x, car.pos.y, car.pos.z, car.tp ?? 0, car.yaw, car.tr ?? 0);
    this.body.autoRight = true;
    car.tp = car.tr = 0;
    if (!car.body) {
      this.body.vx = Math.sin(car.yaw) * car.v;
      this.body.vz = Math.cos(car.yaw) * car.v;
    }
    this.pos = this.body.pos;
    this.police = car.police;
    this.name = NAMES[spec.id] ?? 'Car';
    traffic.take(car);
  }

  drive(dt: number, pad: Pad | null, ctx: WorldCtx) {
    this.t += dt;
    const b = this.body;
    b.step(dt, pad ? { throttle: pad.throttle, brake: pad.brake, steer: pad.steer, handbrake: pad.handbrake, thrust: 0 } : { throttle: 0, brake: 0.5, steer: 0, handbrake: true, thrust: 0 }, ctx.net, ctx.world);
    this.impact = b.impact;
    if (this.impact > 7) this.health = Math.max(0, this.health - (this.impact - 7) * 0.012);
    this.yaw = b.yaw;
    this.vel.set(b.vx, b.vy, b.vz);
    this.root.position.copy(b.pos);
    this.root.rotation.set(-b.groundPitch, b.yaw, b.groundRoll, 'YXZ');
    const c = this.car;
    c.pos.copy(b.pos);
    c.yaw = b.yaw;
    if (pad?.horn && !this.hornWas && this.police) this.siren = !this.siren;
    this.hornWas = !!pad?.horn;
    const brake = pad ? (b.reverse ? pad.throttle : pad.brake) : 0;
    const ph = Math.floor(this.t * 6) % 2;
    this.traffic.fleet.set(c.slot, b.pos.x, b.pos.y + 0.03, b.pos.z, b.yaw, -b.groundPitch, b.groundRoll, b.steer, b.spin, ctx.night > 0.3 ? 1 : 0, brake, this.siren ? ph : 0, this.siren ? 1 - ph : 0, b.pitch, -b.roll, b.heave, b.wDrop);
    if (c.dv !== b.dentVer) {
      c.dv = b.dentVer;
      this.traffic.fleet.dent(c.slot, b.dents);
    }
  }

  subject(): CamSubject {
    return { pos: this.pos, yaw: this.yaw, vel: this.vel, body: this.root, eye: new THREE.Vector3(0.38, this.car.spec.H * 0.78, 0.1), hood: new THREE.Vector3(0, this.car.spec.H * 0.75, 1.2), size: this.car.spec.L, kind: 'car' };
  }

  hud(): HudInfo {
    return { name: this.name, speed: Math.abs(this.body.vLong), gauges: [{ label: 'Damage', value: this.health, color: '#ffb547' }], gear: this.body.reverse ? 'R' : 'D', mode: this.siren ? 'SIREN' : undefined };
  }

  exitPoint(out: THREE.Vector3): THREE.Vector3 {
    const b = this.body;
    const w = this.car.spec.W / 2 + 0.7;
    return out.set(b.pos.x + Math.cos(b.yaw) * w, b.pos.y, b.pos.z - Math.sin(b.yaw) * w);
  }

  /** park it: back to the traffic as a parked car */
  release() {
    const c = this.car;
    c.flags |= 4;
    this.body.autoRight = false;
    c.body = this.body;
    c.state = 'dynamic';
    c.rest = 0;
  }
}

const NAMES: Partial<Record<ModelId, string>> = {
  sedan: 'Sedan',
  compact: 'Hatchback',
  suv: 'SUV',
  gwagon: 'G-Wagon',
  pickup: 'Pickup',
  coupe: 'Sports Coupe',
  van: 'Van',
  bus: 'Metrobus',
  cyber: 'Cyber Pickup',
  taxi: 'Taxi',
  police: 'Miami PD Cruiser',
  policeSuv: 'Miami PD Interceptor',
};
