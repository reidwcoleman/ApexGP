// AI traffic following the road graph, traffic lights, parked cars.
import * as THREE from 'three';
import { box, cyl, merge } from '../core/geo';
import { clamp, pick, wrapAngle } from '../core/math';
import type { CarType } from '../entities/carModels';
import { Vehicle, type CarAI } from '../entities/vehicle';
import { LANE_OFF, ROAD_HALF, type CityMap, type RNode } from '../world/map';
import type { Game } from './game';

export const LIGHT_CYCLE = 22;
export function lightState(n: RNode, ns: boolean, t: number): 'g' | 'y' | 'r' {
  const c = (t + n.phase) % LIGHT_CYCLE;
  if (ns) return c < 9 ? 'g' : c < 11 ? 'y' : 'r';
  return c >= 11 && c < 20 ? 'g' : c >= 20 ? 'y' : 'r';
}

/** Computes a steering target along lanes from -> to -> next. */
export function laneTarget(map: CityMap, from: number, to: number, next: number, x: number, z: number, look: number, laneOff = LANE_OFF) {
  const A = map.nodes[from], B = map.nodes[to];
  const len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
  const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
  const rx = -dz, rz = dx;
  const s = (x - A.x) * dx + (z - A.z) * dz;
  const remaining = len - s;
  let tx: number, tz: number, turnDot = 1, d2x = dx, d2z = dz;
  if (next >= 0) {
    const C = map.nodes[next];
    const l2 = Math.hypot(C.x - B.x, C.z - B.z) || 1;
    d2x = (C.x - B.x) / l2;
    d2z = (C.z - B.z) / l2;
    turnDot = dx * d2x + dz * d2z;
  }
  if (remaining < look && next >= 0) {
    const r2x = -d2z, r2z = d2x;
    const k = look - remaining;
    tx = B.x + r2x * laneOff + d2x * k;
    tz = B.z + r2z * laneOff + d2z * k;
  } else {
    tx = A.x + rx * laneOff + dx * (s + look);
    tz = A.z + rz * laneOff + dz * (s + look);
  }
  return { tx, tz, remaining, turnDot, dx, dz, len, s };
}

export function steerTo(v: Vehicle, tx: number, tz: number): number {
  const ang = Math.atan2(tx - v.pos.x, tz - v.pos.z);
  const diff = wrapAngle(ang - v.heading);
  return clamp(diff * 2.4, -1, 1);
}

export class TrafficAI implements CarAI {
  next = -1;
  cruise: number;
  panic = 0;
  blockedT = 0;
  reverseT = 0;
  honkT = 0;
  busT = 10 + Math.random() * 15;
  constructor(public game: Game, public from: number, public to: number) {
    this.cruise = 10 + Math.random() * 4;
    this.next = this.choose(to, from);
  }

  choose(at: number, came: number): number {
    const map = this.game.map;
    const n = map.nodes[at];
    const opts: number[] = [];
    for (const eid of n.edges) {
      const o = map.otherEnd(map.edges[eid], at);
      if (o !== came) opts.push(o);
    }
    if (!opts.length) return came;
    if (this.panic > 0) {
      // prefer roads leading away from the player
      const p = this.game.player.pos;
      opts.sort((a, b) => {
        const A = map.nodes[a], B = map.nodes[b];
        return Math.hypot(B.x - p.x, B.z - p.z) - Math.hypot(A.x - p.x, A.z - p.z);
      });
      return opts[0];
    }
    return pick(opts);
  }

  drive(v: Vehicle, dt: number) {
    const g = this.game;
    const map = g.map;
    if (this.panic > 0) this.panic -= dt;
    const sp = v.forwardSpeed;
    const look = 5 + Math.abs(sp) * 0.45;
    let L = laneTarget(map, this.from, this.to, this.next, v.pos.x, v.pos.z, look);
    const B = map.nodes[this.to];
    const dB = Math.hypot(B.x - v.pos.x, B.z - v.pos.z);
    if (L.remaining < LANE_OFF + 2 || dB < 6.5) {
      const prev = this.from;
      this.from = this.to;
      this.to = this.next;
      this.next = this.choose(this.to, this.from);
      void prev;
      L = laneTarget(map, this.from, this.to, this.next, v.pos.x, v.pos.z, look);
    }
    // buses: slower, and they stop at the curb now and then to let people on and off
    if (v.type === 'bus') {
      this.cruise = 8.5;
      this.busT -= dt;
      if (this.busT < 0 && this.busT > -7 && this.panic <= 0) {
        L = { ...L, tx: L.tx - L.dz * 2.4, tz: L.tz + L.dx * 2.4 };
        v.signal = 1;
        v.input.steer = steerTo(v, L.tx, L.tz);
        v.input.thr = clamp((Math.max(0, this.busT + 5.5) * 1.5 - v.forwardSpeed) * 0.4, -1, 1);
        v.input.hand = v.forwardSpeed < 0.3 && this.busT < -1.5;
        if (v.input.hand) v.input.thr = 0;
        return;
      }
      if (this.busT <= -7) this.busT = 18 + Math.random() * 14;
    }
    const cruise = this.panic > 0 ? 21 : this.cruise;
    let target = cruise;
    // indicate before a turn
    const An = map.nodes[this.from], Bt = map.nodes[this.to], Cn = map.nodes[this.next];
    const cr = (Bt.x - An.x) * (Cn.z - Bt.z) - (Bt.z - An.z) * (Cn.x - Bt.x);
    v.signal = L.turnDot < 0.6 && L.remaining < 38 && this.panic <= 0 ? (cr > 0 ? 1 : -1) : 0;
    // a siren coming up behind: pull to the curb and wait for it to pass
    let pull = 0;
    if (this.panic <= 0) {
      for (const u of g.vehicles) {
        if (u === v || !u.siren || u.wrecked) continue;
        const ox = u.pos.x - v.pos.x, oz = u.pos.z - v.pos.z;
        if (Math.abs(ox) > 70 || Math.abs(oz) > 70) continue;
        const along = ox * v.fwdX() + oz * v.fwdZ();
        const lat = ox * -v.fwdZ() + oz * v.fwdX();
        if (along < 6 && along > -65 && Math.abs(lat) < 7) {
          pull = 1;
          break;
        }
      }
    }
    if (pull) {
      L = { ...L, tx: L.tx - L.dz * 2.6, tz: L.tz + L.dx * 2.6 };
      target = Math.min(target, 1.5);
      v.signal = 1;
    }
    const Bn = map.nodes[this.to];
    if (L.turnDot < 0.5 && L.remaining < 30) target = Math.min(target, 6 + Math.max(0, L.remaining - 8) * 0.35);
    // traffic lights
    if (Bn.light && this.panic <= 0) {
      const ns = Math.abs(L.dz) > Math.abs(L.dx);
      const st = lightState(Bn, ns, g.elapsed);
      const stop = L.remaining - (ROAD_HALF + 4.5);
      if (stop > -0.5 && (st === 'r' || (st === 'y' && stop > 10))) target = Math.min(target, Math.max(0, stop - 0.5) * 0.7);
    }
    // obstacles ahead
    const fx = v.fwdX(), fz = v.fwdZ();
    const rx = -fz, rz = fx;
    let blockedByPlayer = false;
    for (const u of g.vehicles) {
      if (u === v) continue;
      const ox = u.pos.x - v.pos.x, oz = u.pos.z - v.pos.z;
      if (Math.abs(ox) > 30 || Math.abs(oz) > 30) continue;
      const along = ox * fx + oz * fz;
      if (along <= 0) continue;
      const lat = ox * rx + oz * rz;
      if (Math.abs(lat) > 2.3) continue;
      const gap = along - (v.spec.len + u.spec.len) / 2;
      target = Math.min(target, Math.max(0, gap - 2.5) * 0.8);
      if (u.driver === 'player' && gap < 8) blockedByPlayer = true;
    }
    for (const h of g.humans) {
      if (h.vehicle || h.dead || h.hidden) continue;
      const ox = h.pos.x - v.pos.x, oz = h.pos.z - v.pos.z;
      if (Math.abs(ox) > 18 || Math.abs(oz) > 18) continue;
      const along = ox * fx + oz * fz;
      if (along <= 0) continue;
      const lat = ox * rx + oz * rz;
      if (Math.abs(lat) > 1.8) continue;
      const gap = along - v.spec.len / 2;
      target = Math.min(target, Math.max(0, gap - 2) * 0.9);
      if (h === g.player) blockedByPlayer = true;
    }
    // blocked: reverse out after a while
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.input.thr = -0.7;
      v.input.steer = -steerTo(v, L.tx, L.tz);
      v.input.hand = false;
      return;
    }
    if (Math.abs(sp) < 0.6 && target < 1) {
      this.blockedT += dt;
      if (blockedByPlayer && this.blockedT > 2.5 && this.honkT <= 0) {
        this.honkT = 2 + Math.random() * 3;
        g.honkAt(v);
      }
      if (!blockedByPlayer && this.blockedT > 12) {
        this.blockedT = 0;
        this.reverseT = 1.5;
      }
    } else if (Math.abs(sp) < 0.5 && target > 3) {
      this.blockedT += dt;
      if (this.blockedT > 3) {
        this.blockedT = 0;
        this.reverseT = 1.4;
      }
    } else this.blockedT = 0;
    if (this.honkT > 0) this.honkT -= dt;
    v.input.steer = steerTo(v, L.tx, L.tz);
    const err = target - sp;
    v.input.thr = clamp(err * 0.4, -1, 1);
    v.input.hand = target < 0.3 && Math.abs(sp) < 1.0;
    if (v.input.hand) v.input.thr = 0;
  }
}

/** A fleeing driver (mission target): fast, ignores lights, turns away from the player. */
export class FleeAI extends TrafficAI {
  constructor(game: Game, from: number, to: number, speed: number) {
    super(game, from, to);
    this.panic = 1e9;
    this.cruise = speed;
  }
  drive(v: Vehicle, dt: number) {
    super.drive(v, dt);
    // keep it fast even when panic speed is used
    const sp = v.forwardSpeed;
    if (this.reverseT <= 0 && v.input.thr > 0) v.input.thr = clamp((this.cruise - sp) * 0.5, -1, 1);
  }
}

// ---------------------------------------------------------------- manager
const TYPES: [CarType, number][] = [['sedan', 34], ['suv', 18], ['pickup', 12], ['taxi', 14], ['sports', 10], ['van', 9], ['bus', 4], ['police', 5]];
function randomType(): CarType {
  const tot = TYPES.reduce((a, b) => a + b[1], 0);
  let r = Math.random() * tot;
  for (const [t, w] of TYPES) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'sedan';
}

export class Traffic {
  maxCars = 34;
  radius = 230;
  private parked = new Map<number, Vehicle>();
  private parkT = 0;
  private lightT = 0;
  private poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private lampSlots: { node: RNode; ns: boolean; x: number; y: number; z: number }[] = [];
  private lampCols = { g: new THREE.Color(0.2, 3, 0.6), y: new THREE.Color(3, 2, 0.2), r: new THREE.Color(3, 0.2, 0.15) };

  constructor(private game: Game) {
    const pole = merge([cyl(0.09, 0.11, 4.4, 6, 0, 2.2, 0, 0x3b4046), box(0.36, 1.05, 0.3, 0, 4.75, 0, 0x22262a), box(0.5, 1.2, 0.04, 0, 4.75, -0.17, 0x22262a)]);
    this.poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 120);
    this.poles.count = 0;
    this.poles.castShadow = true;
    this.poles.frustumCulled = false;
    this.lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 120);
    this.lamps.count = 0;
    this.lamps.frustumCulled = false;
    this.lamps.setColorAt(0, this.lampCols.g);
    game.scene.add(this.poles, this.lamps);
  }

  spawnOnRoad(minD: number, maxD: number, type?: CarType, attempts = 24): Vehicle | null {
    const g = this.game;
    const map = g.map;
    const p = g.focus;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const e = map.edges[Math.floor(Math.random() * map.edges.length)];
      const A = map.nodes[e.a], B = map.nodes[e.b];
      const t = 0.2 + Math.random() * 0.6;
      const mx = A.x + (B.x - A.x) * t, mz = A.z + (B.z - A.z) * t;
      const d = Math.hypot(mx - p.x, mz - p.z);
      if (d < minD || d > maxD) continue;
      const forward = Math.random() < 0.5;
      const from = forward ? e.a : e.b, to = forward ? e.b : e.a;
      const F = map.nodes[from], T = map.nodes[to];
      const dx = (T.x - F.x) / e.len, dz = (T.z - F.z) / e.len;
      const x = mx - dz * LANE_OFF, z = mz + dx * LANE_OFF;
      // in view and close? skip so cars don't pop in front of the camera
      if (d < 160 && g.inView(x, 1, z) && attempt < attempts * 0.7) continue;
      let clear = true;
      for (const u of g.vehicles) if (Math.abs(u.pos.x - x) < 12 && Math.abs(u.pos.z - z) < 12) { clear = false; break; }
      if (!clear) continue;
      const v = new Vehicle(type ?? randomType());
      v.place(x, z, Math.atan2(dx, dz));
      v.driver = 'npc';
      v.ai = new TrafficAI(g, from, to);
      if (v.police) v.occupants = 2;
      const sp = (v.ai as TrafficAI).cruise * 0.8;
      v.vx = Math.sin(v.heading) * sp;
      v.vz = Math.cos(v.heading) * sp;
      g.addVehicle(v);
      return v;
    }
    return null;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.focus;
    // despawn
    for (let i = g.vehicles.length - 1; i >= 0; i--) {
      const v = g.vehicles[i];
      if (v.driver === 'player' || v.persistent || !v.despawnable) continue;
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
      const far = d > (v.ai ? 290 : 240) || (v.sunk && d > 60) || (v.wrecked && d > 150);
      if (far && !g.inView(v.pos.x, v.pos.y + 1, v.pos.z)) g.removeVehicle(v);
      else if (d > 420) g.removeVehicle(v);
    }
    // spawn moving traffic
    let moving = 0;
    for (const v of g.vehicles) if (v.ai instanceof TrafficAI && !v.police) moving++;
    const target = Math.round(this.maxCars * (g.sky.night > 0.6 ? 0.6 : 1));
    if (moving < target) this.spawnOnRoad(g.settled ? 110 : 25, this.radius);
    // parked cars
    this.parkT -= dt;
    if (this.parkT <= 0) {
      this.parkT = 0.5;
      const spots = g.map.parking;
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        const cur = this.parked.get(i);
        if (cur) {
          const moved = Math.hypot(cur.pos.x - s.x, cur.pos.z - s.z) > 3 || cur.driver !== null || !g.vehicles.includes(cur);
          if (moved) {
            this.parked.delete(i);
            continue;
          }
          if (d > 210 && !g.inView(s.x, 1, s.z)) {
            g.removeVehicle(cur);
            this.parked.delete(i);
          }
        } else if (d < 150 && (d > 70 || !g.settled) && (!g.settled || !g.inView(s.x, 1, s.z))) {
          let clear = true;
          for (const u of g.vehicles) if (Math.abs(u.pos.x - s.x) < 5 && Math.abs(u.pos.z - s.z) < 5) { clear = false; break; }
          if (!clear) continue;
          const type: CarType = s.region === 'downtown' ? pick(['sedan', 'sports', 'suv', 'taxi', 'van'] as CarType[]) : s.region === 'swamp' ? pick(['pickup', 'pickup', 'suv'] as CarType[]) : pick(['sedan', 'suv', 'pickup', 'sports', 'sedan', 'van'] as CarType[]);
          const v = new Vehicle(type);
          v.place(s.x, s.z, s.h);
          g.addVehicle(v);
          this.parked.set(i, v);
        }
      }
    }
    this.updateLights(dt);
  }

  private updateLights(dt: number) {
    const g = this.game;
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.6;
      const p = g.camera.position;
      const near = g.map.nodes.filter((n) => n.light && Math.abs(n.x - p.x) < 260 && Math.abs(n.z - p.z) < 260);
      near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      let k = 0;
      this.lampSlots.length = 0;
      for (const n of near.slice(0, 28)) {
        for (const eid of n.edges) {
          if (k >= 120) break;
          const e = g.map.edges[eid];
          // approach direction (towards the node)
          let dx = e.dx, dz = e.dz;
          if (e.a === n.id) { dx = -dx; dz = -dz; }
          const rx = -dz, rz = dx;
          const x = n.x - dx * (ROAD_HALF + 1.2) + rx * (ROAD_HALF + 0.7);
          const z = n.z - dz * (ROAD_HALF + 1.2) + rz * (ROAD_HALF + 0.7);
          q.setFromAxisAngle(up, Math.atan2(-dx, -dz));
          m.compose(new THREE.Vector3(x, 0, z), q, one);
          this.poles.setMatrixAt(k, m);
          this.lampSlots.push({ node: n, ns: Math.abs(dz) > Math.abs(dx), x: x - dx * 0.2, y: 0, z: z - dz * 0.2 });
          k++;
        }
      }
      this.poles.count = k;
      this.poles.instanceMatrix.needsUpdate = true;
    }
    const m = new THREE.Matrix4();
    let i = 0;
    for (const s of this.lampSlots) {
      const st = lightState(s.node, s.ns, g.elapsed);
      const y = st === 'r' ? 5.1 : st === 'y' ? 4.75 : 4.4;
      m.makeTranslation(s.x, y, s.z);
      this.lamps.setMatrixAt(i, m);
      this.lamps.setColorAt(i, this.lampCols[st]);
      i++;
    }
    this.lamps.count = i;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
