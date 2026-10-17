import * as THREE from 'three';
import type { Network, REdge } from '../roads.ts';
import { CarBody } from '../sim/car.ts';
import type { CollisionWorld } from '../sim/collide.ts';
import { MODELS, type Fleet, type FleetSlot, type ModelId } from '../vehicles/fleet.ts';
import { carSpecOf, obbOverlap, type Traffic } from './traffic.ts';
import { Helicopter } from '../vehicles/Helicopter.ts';
import type { DynLight } from '../city/cityLights.ts';
import type { WorldCtx } from '../vehicles/drivable.ts';

/**
 * Miami PD. Crimes raise the wanted level (one to five stars); cruisers are dispatched from out of
 * sight and route to the player over the road graph (A*), switch to a direct chase — aiming ahead
 * of the player, ramming — once they have eyes on, and back up when they get stuck. From three
 * stars the interceptors join and the helicopter comes over, its searchlight on you at night. Out
 * of sight long enough and the stars flash, then clear. Stop near a cruiser with stars and you're
 * BUSTED.
 */

export type Crime = 'hitCar' | 'hitPed' | 'steal' | 'hitCop' | 'speeding' | 'stealCop';

export interface Suspect {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  hl: number;
  hw: number;
  mass: number;
  onFoot: boolean;
  /** flying (cruisers can only watch) */
  flying: boolean;
  onImpulse(jx: number, jz: number): void;
}

interface Cop {
  slot: FleetSlot;
  id: ModelId;
  body: CarBody;
  path: THREE.Vector3[];
  pi: number;
  repath: number;
  stuck: number;
  reverse: number;
  sees: boolean;
  /** leaving (the stars are gone) */
  leaving: boolean;
  /** seconds without eyes on the player */
  lost: number;
  hl: number;
  hw: number;
  mass: number;
}

const COPS_FOR = [0, 2, 3, 5, 6, 8];
const tmpP = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };

export class Police {
  wanted = 0;
  /** seconds since a cop last saw the player */
  unseen = 0;
  readonly cops: Cop[] = [];
  heli: Helicopter | null = null;
  readonly group = new THREE.Group();
  /** events for the game this frame */
  readonly events: ('busted' | 'escaped' | 'up')[] = [];
  private bustT = 0;
  private spawnT = 0;
  private t = 0;
  private lastCrime = new Map<Crime, number>();
  private readonly lights: DynLight[] = [];

  constructor(
    private readonly net: Network,
    private readonly world: CollisionWorld,
    private readonly fleet: Fleet,
    private readonly traffic: Traffic,
  ) {
    for (let i = 0; i < 10; i++) this.lights.push({ pos: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, radius: 20 });
  }

  /** a crime the police know about: witnessed ones count more */
  report(c: Crime, at: THREE.Vector3) {
    const last = this.lastCrime.get(c) ?? -99;
    if (this.t - last < (c === 'hitCar' ? 2.5 : 1)) return;
    this.lastCrime.set(c, this.t);
    const copNear = this.cops.some((k) => k.body.pos.distanceTo(at) < 90) || this.traffic.cars.some((k) => k.police && k.pos.distanceTo(at) < 70);
    const before = this.wanted;
    switch (c) {
      case 'hitPed':
        this.wanted = Math.max(this.wanted + 1, 2);
        break;
      case 'hitCop':
        this.wanted = Math.max(this.wanted + 1, 2);
        break;
      case 'stealCop':
        this.wanted = Math.max(this.wanted, 3);
        break;
      case 'steal':
        if (copNear || Math.random() < 0.35) this.wanted = Math.max(this.wanted, 1);
        break;
      case 'hitCar':
        if (copNear) this.wanted = Math.max(this.wanted, 1);
        else if (this.wanted > 0) this.unseen = 0;
        break;
      case 'speeding':
        if (copNear) this.wanted = Math.max(this.wanted, 1);
        break;
    }
    this.wanted = Math.min(5, this.wanted);
    if (this.wanted > before) {
      this.unseen = 0;
      this.events.push('up');
      // the nearest traffic cruiser joins the chase
      for (const k of this.traffic.cars) if (k.police) k.flags |= 1;
    }
  }

  clear() {
    this.wanted = 0;
    this.unseen = 0;
    this.bustT = 0;
    for (const c of this.cops) c.leaving = true;
    for (const k of this.traffic.cars) k.flags &= ~1;
  }

  update(dt: number, s: Suspect, ctx: WorldCtx, camPos: THREE.Vector3, camFwd: THREE.Vector3, night: number) {
    this.t += dt;
    this.events.length = 0;
    // ---- dispatch
    const want = COPS_FOR[this.wanted];
    const active = this.cops.filter((c) => !c.leaving).length;
    this.spawnT -= dt;
    if (active < want && this.spawnT <= 0) {
      if (this.spawn(s.pos, camPos, camFwd)) this.spawnT = 2.2;
      else this.spawnT = 0.4;
    }
    // ---- drive
    let anySees = false;
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const c = this.cops[i];
      const d = Math.hypot(c.body.pos.x - s.pos.x, c.body.pos.z - s.pos.z);
      if (c.leaving) {
        const inView = camFwd.x * (c.body.pos.x - camPos.x) + camFwd.z * (c.body.pos.z - camPos.z) > 0;
        if (d > 160 || (!inView && d > 50) || c.body.inWater) {
          this.retire(i);
          continue;
        }
        c.body.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: false, thrust: 0 }, ctx.net, ctx.world);
      } else {
        c.lost = c.sees ? 0 : c.lost + dt;
        if (d > 700 || c.body.inWater || (c.lost > 22 && d > 220)) {
          this.retire(i);
          continue;
        }
        this.drive(c, dt, s, d, ctx);
      }
      if (c.sees) anySees = true;
      const b = c.body;
      const ph = Math.floor(this.t * 6 + i) % 2;
      const flash = c.leaving ? 0 : 1;
      this.fleet.set(c.slot, b.pos.x, b.pos.y + 0.03, b.pos.z, b.yaw, b.pitch - b.groundPitch, -b.roll + b.groundRoll, b.steer, b.spin, night > 0.3 ? 1 : 0, b.vLong < 0.5 ? 0.6 : 0, flash * ph, flash * (1 - ph));
    }
    // ---- cop vs cop, cop vs the suspect, cop vs the traffic
    for (let i = 0; i < this.cops.length; i++) {
      const a = this.cops[i];
      for (let j = i + 1; j < this.cops.length; j++) this.pair(a, this.cops[j]);
      if (!s.flying) this.hitSuspect(a, s);
      const b = a.body;
      this.traffic.collide({ pos: b.pos, vel: new THREE.Vector3(b.vx, 0, b.vz), yaw: b.yaw, hl: a.hl, hw: a.hw, mass: a.mass, onImpulse: (jx, jz) => { b.vx += jx; b.vz += jz; } });
    }
    // ---- the helicopter
    if (this.wanted >= 3 && !this.heli) {
      const h = (this.heli = new Helicopter('police'));
      const a = Math.random() * Math.PI * 2;
      h.place(s.pos.x + Math.sin(a) * 700, Math.max(140, s.pos.y + 120), s.pos.z + Math.cos(a) * 700, a + Math.PI);
      h.rpm = 1;
      h.grounded = false;
      h.aiTarget = new THREE.Vector3();
      this.group.add(h.root);
    }
    if (this.heli) {
      const h = this.heli;
      if (this.wanted >= 3) {
        const ang = this.t * 0.25;
        h.aiTarget!.set(s.pos.x + Math.sin(ang) * 45, s.pos.y, s.pos.z + Math.cos(ang) * 45);
      } else h.aiTarget!.set(h.pos.x + Math.sin(h.yaw) * 2000, 200, h.pos.z + Math.cos(h.yaw) * 2000);
      h.drive(dt, null, ctx);
      const hd = Math.hypot(h.pos.x - s.pos.x, h.pos.z - s.pos.z);
      if (this.wanted >= 3 && hd < 260) anySees = true;
      if (this.wanted < 3 && hd > 1500) {
        this.group.remove(h.root);
        this.heli = null;
      }
    }
    // ---- seen / evading / busted
    if (this.wanted > 0) {
      if (anySees) this.unseen = 0;
      else this.unseen += dt;
      if (this.unseen > 9 + this.wanted * 3.5) {
        this.clear();
        this.events.push('escaped');
      }
      const sp = Math.hypot(s.vel.x, s.vel.z);
      let close = false;
      for (const c of this.cops) if (!c.leaving && c.body.pos.distanceTo(s.pos) < (s.onFoot ? 8.5 : 11) && c.body.speed < 4) close = true;
      if (close && sp < (s.onFoot ? 2.5 : 1.5) && !s.flying) this.bustT += dt;
      else this.bustT = Math.max(0, this.bustT - dt * 2);
      if (this.bustT > (s.onFoot ? 1.2 : 2.5)) {
        this.events.push('busted');
        this.clear();
      }
    }
  }

  /** red/blue light bars and the searchlight, for the city light pass */
  dynLights(night: number, suspect: THREE.Vector3): DynLight[] {
    const out: DynLight[] = [];
    let k = 0;
    const ph = Math.floor(this.t * 6) % 2;
    for (const c of this.cops) {
      if (c.leaving || k >= 8) continue;
      const L = this.lights[k++];
      L.pos.set(c.body.pos.x, c.body.pos.y + 2.2, c.body.pos.z);
      L.color.setRGB(ph ? 1 : 0.05, 0.05, ph ? 0.05 : 1);
      L.intensity = 0.35 + night * 5;
      L.radius = 16;
      out.push(L);
    }
    for (const t of this.traffic.cars) {
      if (!t.police || !(t.flags & 1) || k >= 9) continue;
      const L = this.lights[k++];
      L.pos.set(t.pos.x, t.pos.y + 2.2, t.pos.z);
      L.color.setRGB(ph ? 0.05 : 1, 0.05, ph ? 1 : 0.05);
      L.intensity = 0.35 + night * 5;
      L.radius = 16;
      out.push(L);
    }
    if (this.heli && this.wanted >= 3 && night > 0.3) {
      const L = this.lights[9];
      L.pos.set(suspect.x, suspect.y + 14, suspect.z);
      L.color.setRGB(1, 0.97, 0.9);
      L.intensity = 14 * night;
      L.radius = 26;
      out.push(L);
    }
    return out;
  }

  /** positions of the active sirens */
  sirens(out: THREE.Vector3[]) {
    out.length = 0;
    for (const c of this.cops) if (!c.leaving) out.push(c.body.pos);
    for (const t of this.traffic.cars) if (t.police && t.flags & 1) out.push(t.pos);
    return out;
  }

  // ------------------------------------------------------------------ dispatch

  private spawn(target: THREE.Vector3, camPos: THREE.Vector3, camFwd: THREE.Vector3): boolean {
    const R = Math.random;
    const ang = Math.atan2(camFwd.x, camFwd.z) + Math.PI + (R() - 0.5) * 2.4;
    const d = 140 + R() * 120;
    const px = target.x + Math.sin(ang) * d, pz = target.z + Math.cos(ang) * d;
    const hit = this.net.nearestEdge(px, pz, 0, 120);
    if (!hit || hit.e.kind === 'lane' || hit.e.kind === 'highway' || hit.e.kind === 'causeway' || hit.e.kind === 'ramp') return false;
    const e = hit.e;
    if (e.py.some((y) => y > 1)) return false;
    const lat = (R() < 0.5 ? 1 : -1) * (e.spec.median + 1.7);
    this.net.point(e, THREE.MathUtils.clamp(hit.pr.s, e.trimA + 2, e.len - e.trimB - 2), lat, tmpP);
    // not right in front of the camera
    const vx = tmpP.x - camPos.x, vz = tmpP.z - camPos.z;
    if (Math.hypot(vx, vz) < 120 && vx * camFwd.x + vz * camFwd.z > 0) return false;
    const id: ModelId = this.wanted >= 3 && R() < 0.5 ? 'policeSuv' : 'police';
    if (this.fleet.available(id) < 1) return false;
    const slot = this.fleet.alloc(id, 0xf4f5f7);
    if (!slot) return false;
    const spec = carSpecOf(MODELS[id]);
    // a pursuit-tuned cruiser: more power, more grip than the traffic
    spec.power *= 2.2;
    spec.maxForce *= 1.25;
    spec.mu = 1.15;
    spec.vmax = 62;
    const body = new CarBody(spec);
    const yaw = Math.atan2(target.x - tmpP.x, target.z - tmpP.z);
    body.place(tmpP.x, tmpP.y, tmpP.z, Math.atan2(tmpP.tx, tmpP.tz) + (Math.cos(Math.atan2(tmpP.tx, tmpP.tz) - yaw) < 0 ? Math.PI : 0));
    this.cops.push({ slot, id, body, path: [], pi: 0, repath: 0, stuck: 0, reverse: 0, sees: false, leaving: false, lost: 0, hl: spec.hl, hw: spec.hw, mass: spec.mass });
    return true;
  }

  private retire(i: number) {
    const c = this.cops[i];
    this.fleet.free(c.slot);
    this.cops.splice(i, 1);
  }

  // ------------------------------------------------------------------ driving

  private drive(c: Cop, dt: number, s: Suspect, d: number, ctx: WorldCtx) {
    const b = c.body;
    // eyes on: close, and nothing solid between
    c.sees = d < 160 && this.world.segmentHits(b.pos.x, b.pos.z, s.pos.x, s.pos.z, b.pos.y + 1.2) >= 1;
    const direct = c.sees && d < 55 && !s.flying && Math.abs(s.pos.y - b.pos.y) < 4;
    let tx: number, tz: number;
    if (direct) {
      // aim ahead of the suspect
      const lead = Math.min(1.2, d / 30);
      tx = s.pos.x + s.vel.x * lead;
      tz = s.pos.z + s.vel.z * lead;
    } else {
      c.repath -= dt;
      if (c.repath <= 0 || c.pi >= c.path.length) {
        c.repath = 4.5 + Math.random() * 1.5;
        this.route(c, s.pos);
      }
      // drop the points we've passed; pursue the first point a lookahead distance down the path
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      while (c.pi < c.path.length - 1) {
        const q = c.path[c.pi];
        const qx = q.x - b.pos.x, qz = q.z - b.pos.z;
        const qd = Math.hypot(qx, qz);
        // (behind us only counts close by: a route that U-turns has its whole way back behind)
        if (qd < 6 || (qx * fx + qz * fz < 0 && qd < 18)) c.pi++;
        else break;
      }
      const ld = 9 + Math.abs(b.vLong) * 0.55;
      let k = c.pi;
      while (k < c.path.length - 1 && Math.hypot(c.path[k].x - b.pos.x, c.path[k].z - b.pos.z) < ld) k++;
      const p = c.path[k] ?? s.pos;
      tx = p.x;
      tz = p.z;
    }
    const want = Math.atan2(tx - b.pos.x, tz - b.pos.z);
    const err = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
    const v = b.vLong;
    // speed: flat out on a straight, slow for the turn ahead; match the suspect's pace up close
    const turn = Math.min(1, Math.abs(err) / 1.1);
    let vWant = 55 * (1 - turn * 0.6);
    if (!direct) {
      // brake for the bends down the route: at each waypoint the turn it makes allows a speed,
      // and we must be able to slow to it (≈7 m/s²) by the time we get there
      let dist = Math.hypot(c.path[c.pi]?.x - b.pos.x, c.path[c.pi]?.z - b.pos.z) || 0;
      let px = b.pos.x, pz = b.pos.z;
      for (let j = c.pi; j + 1 < c.path.length && dist < 80; j++) {
        const q = c.path[j], r = c.path[j + 1];
        const a1 = Math.atan2(q.x - px, q.z - pz), a2 = Math.atan2(r.x - q.x, r.z - q.z);
        const bend = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
        const vc = 7 + 45 * Math.max(0, 1 - bend / 1.2) ** 2;
        vWant = Math.min(vWant, Math.sqrt(vc * vc + 2 * 7 * dist));
        if (j > c.pi) dist += Math.hypot(r.x - q.x, r.z - q.z);
        else dist += Math.hypot(r.x - q.x, r.z - q.z);
        px = q.x;
        pz = q.z;
      }
      // off the route (overshot a turn): plan again from here
      const q = c.path[c.pi];
      if (q && Math.hypot(q.x - b.pos.x, q.z - b.pos.z) > 30 && c.repath > 1) c.repath = 0.6;
    }
    if (direct) {
      // close in at the suspect's pace plus a little; on a stopped suspect, pull up beside them
      const ss = Math.hypot(s.vel.x, s.vel.z);
      const box = 4 + c.hl + s.hl;
      vWant = ss > 6 ? Math.min(62, ss + THREE.MathUtils.clamp((d - box) * 0.6, -6, 10)) : THREE.MathUtils.clamp((d - box) * 0.9, 0, 30);
    }
    // don't drive into the cruiser ahead
    for (const o of this.cops) {
      if (o === c) continue;
      const ox = o.body.pos.x - b.pos.x, oz = o.body.pos.z - b.pos.z;
      const along = ox * Math.sin(b.yaw) + oz * Math.cos(b.yaw);
      const lat = Math.abs(-ox * Math.cos(b.yaw) + oz * Math.sin(b.yaw));
      if (along > 0 && along < 14 && lat < 3) vWant = Math.min(vWant, Math.max(0, o.body.vLong * 0.8 + (along - 8) * 0.5));
    }
    let throttle = v < vWant ? 1 : 0;
    let brake = v > vWant + 3 ? Math.min(1, (v - vWant) / 8) : 0;
    // pure pursuit: the steer angle that arcs onto the target point
    const L = b.spec.a + b.spec.b;
    const dT = Math.max(4, Math.hypot(tx - b.pos.x, tz - b.pos.z));
    // (behind us: full lock round toward it — pure pursuit's sin() would go straight on)
    const delta = Math.abs(err) > Math.PI / 2 ? Math.sign(err) * b.spec.maxSteer : Math.atan((2 * L * Math.sin(err)) / dT);
    // (the rack's speed-sensitive lock scales the input down: undo it)
    const lock = 0.35 + 0.65 / (1 + (b.speed * b.speed) / 900);
    let steer = THREE.MathUtils.clamp(delta / (b.spec.maxSteer * lock), -1, 1);
    // stuck: back off, turn the other way
    if (c.reverse > 0) {
      c.reverse -= dt;
      throttle = 0;
      brake = Math.abs(v) > 6 ? 0 : 0.45;
      steer = -Math.sign(err || 1);
      b.reverse = true;
    } else {
      b.reverse = false;
      if (Math.abs(v) < 1.2 && throttle > 0) c.stuck += dt;
      else c.stuck = Math.max(0, c.stuck - dt);
      if (c.stuck > 1.4) {
        c.stuck = 0;
        c.reverse = 1.3;
      }
    }
    // a big angle at low speed: a handbrake turn
    const hb = Math.abs(err) > 1.4 && v > 8 && v < 25;
    b.step(dt, { throttle, brake, steer, handbrake: hb, thrust: 0 }, ctx.net, ctx.world);
  }

  /** A* over the road graph from the cop to the node nearest the target */
  private route(c: Cop, to: THREE.Vector3) {
    const net = this.net;
    const b = c.body;
    const drivable = (e: REdge) => e.kind !== 'lane';
    const from = net.nearestEdge(b.pos.x, b.pos.z, b.pos.y, 80, drivable);
    const goal = net.nearestEdge(to.x, to.z, to.y, 160, drivable) ?? net.nearestEdge(to.x, to.z, 0, 300, drivable);
    c.path.length = 0;
    c.pi = 0;
    if (!from || !goal) return;
    const fwd = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
    // start at the end of our edge we're heading toward
    const ea = net.nodes[from.e.a], eb = net.nodes[from.e.b];
    const start = (eb.x - ea.x) * fwd.x + (eb.z - ea.z) * fwd.z > 0 ? eb.id : ea.id;
    const goals = new Set([goal.e.a, goal.e.b]);
    const n = net.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevE = new Int32Array(n).fill(-1);
    const open: [number, number][] = [];
    const h = (i: number) => Math.hypot(net.nodes[i].x - to.x, net.nodes[i].z - to.z);
    g[start] = 0;
    open.push([h(start), start]);
    let end = -1;
    let iters = 0;
    while (open.length && iters++ < 4000) {
      // (a small binary heap)
      const [, u] = heapPop(open);
      if (goals.has(u)) {
        end = u;
        break;
      }
      for (const eid of net.nodes[u].edges) {
        const e = net.edges[eid];
        if (e.kind === 'lane') continue;
        const w = e.a === u ? e.b : e.a;
        const ng = g[u] + e.len;
        if (ng < g[w]) {
          g[w] = ng;
          prev[w] = u;
          prevE[w] = eid;
          heapPush(open, [ng + h(w), w]);
        }
      }
    }
    if (end < 0) {
      c.path.push(new THREE.Vector3(to.x, to.y, to.z));
      return;
    }
    const chain: { e: REdge; fwd: boolean }[] = [];
    for (let u = end; prev[u] >= 0; u = prev[u]) {
      const e = net.edges[prevE[u]];
      chain.push({ e, fwd: e.b === u });
    }
    chain.reverse();
    // the rest of our own edge first
    const pts = c.path;
    const lane = (e: REdge, dir: number) => dir * (e.spec.median + 1.7);
    const ownDir = start === from.e.b ? 1 : -1;
    for (let s = from.pr.s; ownDir > 0 ? s < from.e.len : s > 0; s += ownDir * 10) {
      net.point(from.e, s, lane(from.e, ownDir), tmpP);
      pts.push(new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z));
    }
    for (const { e, fwd: f } of chain) {
      const dir = f ? 1 : -1;
      const n2 = Math.max(2, Math.ceil(e.len / 10));
      for (let k = 1; k <= n2; k++) {
        const s = f ? (k / n2) * e.len : e.len - (k / n2) * e.len;
        net.point(e, s, lane(e, dir), tmpP);
        pts.push(new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z));
      }
    }
    // and along the goal edge to the point beside the target
    const ge = goal.e;
    const fromA = end === ge.a;
    const gdir = fromA ? 1 : -1;
    for (let s = fromA ? 10 : ge.len - 10; fromA ? s < goal.pr.s : s > goal.pr.s; s += gdir * 10) {
      net.point(ge, s, lane(ge, gdir), tmpP);
      pts.push(new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z));
    }
    pts.push(new THREE.Vector3(to.x, to.y, to.z));
  }

  // ------------------------------------------------------------------ contact

  private pair(a: Cop, c: Cop) {
    const A = a.body, B = c.body;
    if (Math.abs(A.pos.x - B.pos.x) > 8 || Math.abs(A.pos.z - B.pos.z) > 8) return;
    const hit = obbOverlap(A.pos.x, A.pos.z, A.yaw, a.hl, a.hw, B.pos.x, B.pos.z, B.yaw, c.hl, c.hw);
    if (!hit) return;
    A.pos.x -= hit.nx * hit.depth * 0.5;
    A.pos.z -= hit.nz * hit.depth * 0.5;
    B.pos.x += hit.nx * hit.depth * 0.5;
    B.pos.z += hit.nz * hit.depth * 0.5;
    const vn = (B.vx - A.vx) * hit.nx + (B.vz - A.vz) * hit.nz;
    if (vn >= 0) return;
    const j = (-1.2 * vn) / 2;
    A.vx -= j * hit.nx;
    A.vz -= j * hit.nz;
    B.vx += j * hit.nx;
    B.vz += j * hit.nz;
  }

  private hitSuspect(c: Cop, s: Suspect) {
    const B = c.body;
    if (Math.abs(B.pos.x - s.pos.x) > 9 || Math.abs(B.pos.z - s.pos.z) > 9 || Math.abs(B.pos.y - s.pos.y) > 2) return;
    const hit = obbOverlap(s.pos.x, s.pos.z, s.yaw, s.hl, s.hw, B.pos.x, B.pos.z, B.yaw, c.hl, c.hw);
    if (!hit) return;
    const m1 = s.mass, m2 = c.mass;
    s.pos.x -= hit.nx * hit.depth * (m2 / (m1 + m2));
    s.pos.z -= hit.nz * hit.depth * (m2 / (m1 + m2));
    B.pos.x += hit.nx * hit.depth * (m1 / (m1 + m2));
    B.pos.z += hit.nz * hit.depth * (m1 / (m1 + m2));
    const vn = (B.vx - s.vel.x) * hit.nx + (B.vz - s.vel.z) * hit.nz;
    if (vn >= 0) return;
    const j = (-1.25 * vn) / (1 / m1 + 1 / m2);
    B.vx += (j * hit.nx) / m2;
    B.vz += (j * hit.nz) / m2;
    s.onImpulse((-j * hit.nx) / m1, (-j * hit.nz) / m1);
    B.impact = Math.max(B.impact, -vn);
  }
}

function heapPush(h: [number, number][], x: [number, number]) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h: [number, number][]): [number, number] {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
