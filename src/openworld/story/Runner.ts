import * as THREE from 'three';
import type { Network } from '../roads.ts';
import type { Pad } from '../input.ts';
import type { WorldCtx } from '../vehicles/drivable.ts';
import type { FleetCar } from '../vehicles/FleetCar.ts';
import { planRoute } from '../ai/route.ts';
import { steerLock } from '../sim/car.ts';

/**
 * A car on the run: somebody the story sends you after. It plans a route over the road graph to a
 * point a long way off — away from whoever is chasing it — and drives it flat out, braking for the
 * bends it can see coming (the police driver's pure pursuit and corner speeds), backing out when it
 * gets stuck, and planning again when it gets there or gets knocked off its line.
 */
export class Runner {
  private readonly path: THREE.Vector3[] = [];
  private pi = 0;
  private repath = 0;
  private stuck = 0;
  private back = 0;
  private readonly pad = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false } as unknown as Pad;
  /** top speed it dares (m/s) */
  pace = 46;

  constructor(
    readonly car: FleetCar,
    private readonly net: Network,
  ) {}

  /** somewhere 700–1300 m off, away from the chaser */
  private destination(from: THREE.Vector3, chaser: THREE.Vector3) {
    const nodes = this.net.nodes;
    let best: { x: number; y: number; z: number } | null = null;
    let bs = -Infinity;
    const ax = from.x - chaser.x, az = from.z - chaser.z, al = Math.hypot(ax, az) || 1;
    for (let k = 0; k < 60; k++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      const dx = n.x - from.x, dz = n.z - from.z, d = Math.hypot(dx, dz);
      if (d < 500 || d > 1600) continue;
      const away = (dx * ax + dz * az) / (d * al);
      const s = away * 2 - Math.abs(d - 1000) / 600 + Math.random() * 0.5;
      if (s > bs) {
        bs = s;
        best = { x: n.x, y: 0, z: n.z };
      }
    }
    return best;
  }

  update(dt: number, ctx: WorldCtx, chaser: THREE.Vector3) {
    const b = this.car.body;
    this.repath -= dt;
    if (this.repath <= 0 || this.pi >= this.path.length - 2) {
      const to = this.destination(b.pos, chaser);
      if (to) planRoute(this.net, b.pos, b.yaw, to, this.path);
      this.pi = 0;
      this.repath = 25;
    }
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    while (this.pi < this.path.length - 1) {
      const q = this.path[this.pi];
      const qx = q.x - b.pos.x, qz = q.z - b.pos.z, qd = Math.hypot(qx, qz);
      if (qd < 6 || (qx * fx + qz * fz < 0 && qd < 18)) this.pi++;
      else break;
    }
    const v = b.vLong;
    const ld = 9 + Math.abs(v) * 0.55;
    let k = this.pi;
    while (k < this.path.length - 1 && Math.hypot(this.path[k].x - b.pos.x, this.path[k].z - b.pos.z) < ld) k++;
    const p = this.path[k] ?? b.pos;
    const want = Math.atan2(p.x - b.pos.x, p.z - b.pos.z);
    const err = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
    // speed: what the bends ahead allow (at ~7 m/s² of braking)
    let vWant = this.pace * (1 - Math.min(1, Math.abs(err) / 1.1) * 0.6);
    let dist = 0, px = b.pos.x, pz = b.pos.z;
    for (let j = this.pi; j + 1 < this.path.length && dist < 90; j++) {
      const q = this.path[j], r = this.path[j + 1];
      const a1 = Math.atan2(q.x - px, q.z - pz), a2 = Math.atan2(r.x - q.x, r.z - q.z);
      const bend = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
      const vc = 8 + 40 * Math.max(0, 1 - bend / 1.2) ** 2;
      vWant = Math.min(vWant, Math.sqrt(vc * vc + 2 * 7 * dist));
      dist += Math.hypot(r.x - q.x, r.z - q.z);
      px = q.x;
      pz = q.z;
    }
    // knocked off the line: plan again from here
    const q = this.path[this.pi];
    if (q && Math.hypot(q.x - b.pos.x, q.z - b.pos.z) > 35 && this.repath > 1.5) this.repath = 1.2;
    const L = b.spec.a + b.spec.b;
    const dT = Math.max(4, Math.hypot(p.x - b.pos.x, p.z - b.pos.z));
    const delta = Math.abs(err) > Math.PI / 2 ? Math.sign(err) * b.spec.maxSteer : Math.atan((2 * L * Math.sin(err)) / dT);
    const P = this.pad;
    P.steer = THREE.MathUtils.clamp(delta / (b.spec.maxSteer * steerLock(b.speed)), -1, 1);
    P.throttle = v < vWant ? 1 : 0;
    P.brake = v > vWant + 3 ? Math.min(1, (v - vWant) / 8) : 0;
    P.handbrake = Math.abs(err) > 1.4 && v > 8 && v < 25;
    // stuck against something: reverse out, turned the other way
    if (this.back > 0) {
      this.back -= dt;
      P.throttle = 0;
      P.brake = 1;
      P.steer = -Math.sign(err || 1);
      P.handbrake = false;
    } else {
      if (Math.abs(v) < 1.5 && P.throttle > 0) this.stuck += dt;
      else this.stuck = Math.max(0, this.stuck - dt);
      if (this.stuck > 1.2) {
        this.stuck = 0;
        this.back = 1.4;
      }
    }
    this.car.drive(dt, P, ctx);
  }
}
