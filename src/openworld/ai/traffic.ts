import * as THREE from 'three';
import { LANE_W, signalState, type Network, type REdge } from '../roads.ts';
import { Fleet, MODELS, PAINTS, type FleetSlot, type ModelId, type ModelSpec } from '../vehicles/fleet.ts';
import { CarBody, type CarSpec } from '../sim/car.ts';
import type { CollisionWorld } from '../sim/collide.ts';
import { rng } from '../city/build.ts';

/**
 * The city's traffic. Cars drive the network's lanes on the right, stop at red lights and stop
 * signs, follow each other with the intelligent driver model, take curved paths through the
 * junctions (right turns from the kerb lane, lefts from the inside), slow for the player, honk when
 * blocked; a car the player hits becomes a physics body (it spins, slides, stops) and, once it has
 * come to rest on a road, rejoins the traffic. Cars are spawned in a ring round the player and
 * retired behind it, so ~70 are always about.
 */

export type CarState = 'lane' | 'junction' | 'dynamic' | 'parked' | 'player';

export interface AICar {
  id: number;
  slot: FleetSlot;
  spec: ModelSpec;
  state: CarState;
  e: number;
  dir: 1 | -1;
  lane: number;
  s: number;
  v: number;
  vmax: number;
  /** next lane chosen at the end of this one */
  next: { e: number; dir: 1 | -1; lane: number } | null;
  /** the junction path (Hermite) */
  jp0: THREE.Vector3;
  jt0: THREE.Vector3;
  jp1: THREE.Vector3;
  jt1: THREE.Vector3;
  jLen: number;
  jU: number;
  pos: THREE.Vector3;
  yaw: number;
  steer: number;
  spin: number;
  brake: number;
  body: CarBody | null;
  rest: number;
  wait: number;
  honk: number;
  police: boolean;
  /** a scared / stolen / wrecked flag for the game */
  flags: number;
  key: string;
  /** the driver's temperament (speed factor) */
  temper: number;
  /** damage left (100 new; bullets and blasts take it; 0 burns, then blows up) */
  hp?: number;
  /** a parked car's tilt (as the fleet draws it): one left on its roof or side */
  tp?: number;
  tr?: number;
  /** a lane change: the offset from the new lane, easing out; seconds stuck behind something that won't move */
  offX?: number;
  offZ?: number;
  blockT?: number;
}

/** something in the road that isn't driving: a wreck, an abandoned car, a cruiser, a roadblock */
export interface Blocker {
  x: number;
  y: number;
  z: number;
  hl: number;
  hw: number;
}

/** flags: 1 chasing (police), 2 in the water, 4 left by the player, 8 a burnt-out wreck, 16 fleeing */
export const WRECK = 8;
export const FLEE = 16;
/** rolled onto its roof or side: never drives on */
export const OVER = 32;

const tmpP = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };

export function laneLat(e: REdge, dir: number, lane: number) {
  return dir * (e.spec.median + (lane + 0.5) * LANE_W);
}
export function laneSpan(e: REdge, dir: number): [number, number] {
  const s0 = dir > 0 ? e.trimA : e.trimB;
  const s1 = e.len - (dir > 0 ? e.trimB : e.trimA);
  return [s0, s1];
}
/** a lane point: travelled distance s along the lane (from the start node of travel) */
export function lanePoint(net: Network, e: REdge, dir: number, lane: number, s: number, out: typeof tmpP) {
  const u = dir > 0 ? s : e.len - s;
  net.point(e, u, laneLat(e, dir, lane), out);
  if (dir < 0) {
    out.tx = -out.tx;
    out.tz = -out.tz;
  }
  return out;
}

const MIX: [ModelId, number][] = [
  ['sedan', 22],
  ['suv', 19],
  ['compact', 12],
  ['pickup', 8],
  ['gwagon', 6],
  ['coupe', 6],
  ['cyber', 4],
  ['van', 5],
  ['taxi', 7],
  ['bus', 2],
  ['police', 2],
];

export function carSpecOf(m: ModelSpec): CarSpec {
  const hb = m.wb / 2;
  return {
    mass: m.mass,
    a: hb,
    b: hb,
    cgH: m.H * 0.38,
    izK: 1.1,
    power: m.power,
    maxForce: m.mass * 9.81 * 0.9,
    frontDrive: m.id === 'cyber' || m.id === 'suv' || m.id === 'gwagon' ? 0.45 : 0,
    mu: m.id === 'coupe' ? 1.15 : 1.0,
    cornerB: 8,
    cdA: m.W * m.H * 0.34,
    clA: 0.05,
    fan: 0,
    maxSteer: 0.6,
    brakeG: 1.0,
    hl: m.L / 2,
    hw: m.W / 2,
    height: m.H,
    wheelR: m.wheelR,
    vmax: m.id === 'bus' ? 26 : m.id === 'coupe' ? 85 : 60,
    vrev: 10,
  };
}

export class Traffic {
  readonly cars: AICar[] = [];
  private lanes = new Map<string, AICar[]>();
  private nextId = 1;
  private R = rng(777);
  target = 70;
  /** honks this frame (positions) for the audio */
  readonly honks: THREE.Vector3[] = [];
  /** stopped things in the road this frame (traffic's own wrecks, plus what the police add for the next frame) */
  readonly blockers: Blocker[] = [];
  /** player-vs-traffic impacts this frame */
  readonly hits: { car: AICar; speed: number }[] = [];
  private parkedOn = new Map<number, AICar>();

  constructor(
    private readonly net: Network,
    readonly fleet: Fleet,
    private readonly world: CollisionWorld,
    private readonly parking: { x: number; y: number; z: number; yaw: number }[],
  ) {}

  private pickModel(e: REdge): ModelId {
    const total = MIX.reduce((a, [, w]) => a + w, 0);
    for (let tries = 0; tries < 6; tries++) {
      let r = this.R() * total;
      for (const [id, w] of MIX) {
        r -= w;
        if (r <= 0) {
          if (id === 'bus' && e.kind !== 'avenue' && e.kind !== 'boulevard') break;
          if (this.fleet.available(id) > 0) return id;
          break;
        }
      }
    }
    return 'sedan';
  }

  private spawnOne(center: THREE.Vector3, camFwd: THREE.Vector3, minD: number, maxD: number): boolean {
    const R = this.R;
    // a point in the ring, mostly behind or beside the camera
    const ang = Math.atan2(camFwd.x, camFwd.z) + Math.PI + (R() - 0.5) * Math.PI * 1.6;
    const d = minD + R() * (maxD - minD);
    const px = center.x + Math.sin(ang) * d, pz = center.z + Math.cos(ang) * d;
    const near = this.net.near(px, pz);
    if (!near.length) return false;
    const e = this.net.edges[near[Math.floor(R() * near.length)]];
    if (e.kind === 'lane' || e.len < 30) return false;
    const dir: 1 | -1 = R() < 0.5 ? 1 : -1;
    const lane = Math.floor(R() * e.spec.lanes);
    const [s0, s1] = laneSpan(e, dir);
    if (s1 - s0 < 20) return false;
    const s = s0 + 5 + R() * (s1 - s0 - 15);
    const key = `${e.id}:${dir}:${lane}`;
    const list = this.lanes.get(key);
    if (list && list.some((c) => Math.abs(c.s - s) < 14)) return false;
    lanePoint(this.net, e, dir, lane, s, tmpP);
    if (Math.hypot(tmpP.x - center.x, tmpP.z - center.z) < minD * 0.8) return false;
    const model = this.pickModel(e);
    const paint = model === 'taxi' ? 0xf2c41b : model === 'police' || model === 'policeSuv' ? 0xf4f5f7 : model === 'bus' ? 0xf0f0ee : PAINTS[Math.floor(R() * PAINTS.length)];
    const slot = this.fleet.alloc(model, paint);
    if (!slot) return false;
    const spec = MODELS[model];
    const car: AICar = {
      id: this.nextId++,
      slot,
      spec,
      state: 'lane',
      e: e.id,
      dir,
      lane,
      s,
      v: e.spec.speed * 0.8,
      vmax: e.spec.speed,
      next: null,
      jp0: new THREE.Vector3(),
      jt0: new THREE.Vector3(),
      jp1: new THREE.Vector3(),
      jt1: new THREE.Vector3(),
      jLen: 0,
      jU: 0,
      pos: new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z),
      yaw: Math.atan2(tmpP.tx, tmpP.tz),
      steer: 0,
      spin: 0,
      brake: 0,
      body: null,
      rest: 0,
      wait: 0,
      honk: 0,
      police: model === 'police' || model === 'policeSuv',
      flags: 0,
      key,
      temper: 0.85 + R() * 0.3,
    };
    this.cars.push(car);
    return true;
  }

  /** remove a car from the traffic (and its slot) */
  retire(c: AICar) {
    const i = this.cars.indexOf(c);
    if (i >= 0) this.cars.splice(i, 1);
    this.fleet.free(c.slot);
  }

  /** the player is taking this car: it leaves the traffic logic */
  take(c: AICar) {
    c.state = 'player';
  }

  private chooseNext(c: AICar, e: REdge) {
    const net = this.net;
    const nodeId = c.dir > 0 ? e.b : e.a;
    const node = net.nodes[nodeId];
    const inDir = new THREE.Vector2(c.dir > 0 ? 1 : -1, 0);
    const d0 = net.dirAt(e, nodeId);
    // incoming travel direction = -d0 (d0 points out of the node along e)
    inDir.set(-d0.x, -d0.z);
    const cands: { e: REdge; dir: 1 | -1; w: number; turn: number }[] = [];
    for (const id of node.edges) {
      if (id === e.id && node.edges.length > 1) continue;
      const f = net.edges[id];
      if (f.kind === 'lane') continue;
      const fdir: 1 | -1 = f.a === nodeId ? 1 : -1;
      const out = net.dirAt(f, nodeId);
      const cross = inDir.x * out.z - inDir.y * out.x;
      const dot = inDir.x * out.x + inDir.y * out.z;
      // turn: 0 straight, + right (in x-east / z-south a positive cross is a right turn), - left
      const turn = Math.abs(dot) > 0.7 ? 0 : cross > 0 ? 1 : -1;
      const w = (turn === 0 ? 3 : turn > 0 ? 1.4 : 1) * (f.kind === 'highway' || f.kind === 'causeway' ? 1.5 : 1);
      cands.push({ e: f, dir: fdir, w, turn: id === e.id ? 2 : turn });
    }
    if (!cands.length) return null;
    let r = this.R() * cands.reduce((a, c2) => a + c2.w, 0);
    let pick = cands[0];
    for (const c2 of cands) {
      r -= c2.w;
      if (r <= 0) {
        pick = c2;
        break;
      }
    }
    const nl = pick.e.spec.lanes;
    const lane = pick.turn === 1 ? nl - 1 : pick.turn === -1 ? 0 : Math.min(c.lane, nl - 1);
    return { e: pick.e.id, dir: pick.dir, lane };
  }

  private enterJunction(c: AICar) {
    const net = this.net;
    const e = net.edges[c.e];
    const [, s1] = laneSpan(e, c.dir);
    lanePoint(net, e, c.dir, c.lane, s1, tmpP);
    c.jp0.set(tmpP.x, tmpP.y, tmpP.z);
    c.jt0.set(tmpP.tx, 0, tmpP.tz);
    const n = c.next!;
    const f = net.edges[n.e];
    const [f0] = laneSpan(f, n.dir);
    lanePoint(net, f, n.dir, n.lane, f0, tmpP);
    c.jp1.set(tmpP.x, tmpP.y, tmpP.z);
    c.jt1.set(tmpP.tx, 0, tmpP.tz);
    const d = c.jp0.distanceTo(c.jp1);
    c.jLen = Math.max(1, d * (1 + 0.25 * (1 - Math.abs(c.jt0.dot(c.jt1)))));
    c.jU = 0;
    c.state = 'junction';
  }

  private junctionPoint(c: AICar, u: number, out: THREE.Vector3, tan: THREE.Vector3) {
    const t = THREE.MathUtils.clamp(u / c.jLen, 0, 1);
    const k = c.jp0.distanceTo(c.jp1) * 0.9;
    const t2 = t * t, t3 = t2 * t;
    const h1 = 2 * t3 - 3 * t2 + 1, h2 = t3 - 2 * t2 + t, h3 = -2 * t3 + 3 * t2, h4 = t3 - t2;
    out.set(0, 0, 0).addScaledVector(c.jp0, h1).addScaledVector(c.jt0, h2 * k).addScaledVector(c.jp1, h3).addScaledVector(c.jt1, h4 * k);
    const d1 = 6 * t2 - 6 * t, d2 = 3 * t2 - 4 * t + 1, d3 = -6 * t2 + 6 * t, d4 = 3 * t2 - 2 * t;
    tan.set(0, 0, 0).addScaledVector(c.jp0, d1).addScaledVector(c.jt0, d2 * k).addScaledVector(c.jp1, d3).addScaledVector(c.jt1, d4 * k);
    tan.y = 0;
    tan.normalize();
  }

  private readonly jp = new THREE.Vector3();
  private readonly jt = new THREE.Vector3();
  private readonly playerFwd = new THREE.Vector3();

  update(dt: number, t: number, center: THREE.Vector3, camFwd: THREE.Vector3, night: number, player: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; hl: number; hw: number; mass: number; onImpulse: (jx: number, jz: number, px: number, pz: number) => void } | null) {
    const net = this.net;
    this.honks.length = 0;
    this.hits.length = 0;
    // spawn / retire
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.state === 'player') continue;
      const d = Math.hypot(c.pos.x - center.x, c.pos.z - center.z);
      if (d > 720 && (c.state !== 'parked' || c.flags & 4)) this.retire(c);
    }
    let live = this.cars.filter((c) => c.state === 'lane' || c.state === 'junction' || c.state === 'dynamic').length;
    for (let k = 0; k < 6 && live < this.target; k++) if (this.spawnOne(center, camFwd, live < this.target * 0.5 ? 120 : 260, 560)) live++;
    this.updateParked(center);

    // lane occupancy
    this.lanes.clear();
    for (const c of this.cars) {
      if (c.state !== 'lane') continue;
      c.key = `${c.e}:${c.dir}:${c.lane}`;
      let l = this.lanes.get(c.key);
      if (!l) this.lanes.set(c.key, (l = []));
      l.push(c);
    }
    for (const l of this.lanes.values()) l.sort((a, b) => a.s - b.s);
    // junction cars ahead of a lane: by the lane they came from
    const leaving = new Map<string, AICar[]>();
    for (const c of this.cars) {
      if (c.state !== 'junction') continue;
      let l = leaving.get(c.key);
      if (!l) leaving.set(c.key, (l = []));
      l.push(c);
    }
    if (player) this.playerFwd.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
    // what's stopped in the road (the police add their cruisers)
    const B = this.blockers;
    for (const c of this.cars)
      if (c.state === 'dynamic' || (c.state === 'parked' && c.flags & (4 | WRECK | OVER)))
        B.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, hl: c.spec.L / 2, hw: c.spec.W / 2 });

    for (const c of this.cars) {
      if (c.state === 'parked' || c.state === 'player') continue;
      if (c.state === 'dynamic') {
        this.stepDynamic(c, dt, t);
        continue;
      }
      const e = net.edges[c.e];
      const [, s1] = laneSpan(e, c.dir);
      // ---- the gap to whatever is ahead
      let gap = 1e9, vLead = 0;
      if (c.state === 'lane') {
        const l = this.lanes.get(c.key)!;
        const i = l.indexOf(c);
        if (i + 1 < l.length) {
          gap = l[i + 1].s - c.s - (c.spec.L + l[i + 1].spec.L) / 2;
          vLead = l[i + 1].v;
        } else {
          const lv = leaving.get(c.key);
          if (lv && lv.length) {
            let best = lv[0];
            for (const o of lv) if (o.jU < best.jU) best = o;
            gap = s1 - c.s + best.jU - (c.spec.L + best.spec.L) / 2;
            vLead = best.v;
          }
          // the next lane's last car, if we've chosen it
          if (c.next) {
            const nl = this.lanes.get(`${c.next.e}:${c.next.dir}:${c.next.lane}`);
            if (nl && nl.length) {
              const f = net.edges[c.next.e];
              const [f0] = laneSpan(f, c.next.dir);
              const g2 = s1 - c.s + 8 + (nl[0].s - f0) - (c.spec.L + nl[0].spec.L) / 2;
              if (g2 < gap) {
                gap = g2;
                vLead = nl[0].v;
              }
            }
          }
        }
        // signals and stop signs: a virtual stopped car at the stop line
        const nodeId = c.dir > 0 ? e.b : e.a;
        const node = net.nodes[nodeId];
        const toLine = s1 - 1.2 - c.s;
        if (node.signal >= 0) {
          const sig = net.signals[node.signal];
          const st = signalState(sig, sig.group[node.edges.indexOf(e.id)], t);
          const stopDist = (c.v * c.v) / (2 * 4.5);
          if (st === 2 || (st === 1 && toLine > stopDist + 2)) {
            if (toLine > -0.5 && toLine < gap) {
              gap = Math.max(0.01, toLine);
              vLead = 0;
            }
          }
        } else if (node.edges.length >= 3 && node.from !== 'route' && e.kind === 'street') {
          if (toLine < 1.5 && c.v < 0.6) c.wait += dt;
          if (c.wait < 1.1 && toLine > -0.5 && toLine < gap) {
            gap = Math.max(0.01, toLine);
            vLead = 0;
          }
        }
      } else {
        // in a junction: only the player (below)
      }
      // ---- a wreck, an abandoned car, a cruiser across the lane
      let blocked = false;
      {
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        for (const o of B) {
          const dx = o.x - c.pos.x, dz = o.z - c.pos.z;
          const along = dx * fx + dz * fz;
          if (along <= 0.5 || along > 50 || Math.abs(o.y - c.pos.y) > 3) continue;
          const lat = -dx * fz + dz * fx;
          if (Math.abs(lat) > o.hw + c.spec.W / 2 + 0.25) continue;
          const g = along - c.spec.L / 2 - o.hl;
          if (g < gap) {
            gap = g;
            vLead = 0;
            blocked = true;
          }
        }
      }
      // round it: a free lane alongside, signalled and eased into
      if (blocked && gap < 22 && c.state === 'lane' && e.spec.lanes > 1 && s1 - c.s > 30) {
        for (const L of [c.lane - 1, c.lane + 1]) {
          if (L < 0 || L >= e.spec.lanes) continue;
          lanePoint(net, e, c.dir, L, c.s, tmpP);
          const px = tmpP.x, pz = tmpP.z, tx = tmpP.tx, tz = tmpP.tz;
          let free = true;
          for (const o of B) {
            const dx = o.x - px, dz = o.z - pz;
            const along = dx * tx + dz * tz;
            if (along > -6 && along < 30 && Math.abs(-dx * tz + dz * tx) < o.hw + c.spec.W / 2 + 0.3) free = false;
          }
          const nl = this.lanes.get(`${c.e}:${c.dir}:${L}`);
          if (nl) for (const o of nl) if (Math.abs(o.s - c.s) < 10 + Math.max(0, o.v - c.v) * 1.5) free = false;
          if (!free) continue;
          c.offX = (c.offX ?? 0) + c.pos.x - px;
          c.offZ = (c.offZ ?? 0) + c.pos.z - pz;
          c.lane = L;
          c.key = `${c.e}:${c.dir}:${L}`;
          (nl ?? this.lanes.set(c.key, []).get(c.key)!).push(c);
          nl?.sort((a, b) => a.s - b.s);
          gap = 1e9;
          blocked = false;
          break;
        }
      }
      // nowhere to go: wait (and lean on the horn); a long wait out of sight and they've turned off
      if (blocked && c.v < 0.5) {
        c.blockT = (c.blockT ?? 0) + dt;
        c.honk += dt * 0.6;
        if (c.honk > 1.6) {
          c.honk = -3 - this.R() * 4;
          this.honks.push(c.pos.clone());
        }
        if (c.blockT > 9 && (!player || Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z) > 70)) {
          this.retire(c);
          continue;
        }
      } else c.blockT = 0;
      // ---- the player in our way
      if (player) {
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
        const along = dx * fx + dz * fz;
        const lat = -dx * fz + dz * fx;
        if (along > 0 && along < 45 && Math.abs(lat) < 2.4 + player.hw && Math.abs(player.pos.y - c.pos.y) < 3) {
          const g = along - c.spec.L / 2 - player.hl;
          if (g < gap) {
            gap = g;
            vLead = player.vel.x * fx + player.vel.z * fz;
            if (g < 6 && c.v < 1) {
              c.honk += dt;
              if (c.honk > 1.6) {
                c.honk = -2 - this.R() * 3;
                this.honks.push(c.pos.clone());
              }
            }
          }
        }
      }
      // ---- IDM
      const v0 = (c.state === 'junction' ? (Math.abs(c.jt0.dot(c.jt1)) > 0.8 ? 11 : 6.5) : c.vmax) * c.temper;
      const A = 2.2, Bc = 3.2, s0 = 2.2, T = 1.25;
      const sStar = s0 + c.v * T + (c.v * (c.v - vLead)) / (2 * Math.sqrt(A * Bc));
      let acc = A * (1 - Math.pow(c.v / Math.max(v0, 0.1), 4) - Math.pow(Math.max(0, sStar) / Math.max(gap, 0.1), 2));
      acc = THREE.MathUtils.clamp(acc, -9, A);
      c.brake = acc < -0.8 ? Math.min(1, -acc / 5) : c.v < 0.2 ? 0.6 : 0;
      c.v = Math.max(0, c.v + acc * dt);
      const ds = c.v * dt;
      // ---- move
      if (c.state === 'lane') {
        c.s += ds;
        if (!c.next && c.s > s1 - 40) c.next = this.chooseNext(c, e);
        if (c.s >= s1 - 0.05) {
          if (!c.next) c.next = this.chooseNext(c, e);
          if (!c.next) {
            this.retire(c);
            continue;
          }
          c.wait = 0;
          this.enterJunction(c);
        } else {
          lanePoint(net, e, c.dir, c.lane, c.s, tmpP);
          let ox = 0, oz = 0, yaw = Math.atan2(tmpP.tx, tmpP.tz);
          if (c.offX || c.offZ) {
            // easing across into the new lane, nosed toward it
            const k = Math.exp(-dt * 1.1);
            c.offX! *= k;
            c.offZ! *= k;
            if (Math.abs(c.offX!) + Math.abs(c.offZ!) < 0.02) c.offX = c.offZ = 0;
            ox = c.offX!;
            oz = c.offZ!;
            const sideV = -(ox * tmpP.tz - oz * tmpP.tx) * 1.1;
            yaw += Math.atan2(sideV, Math.max(c.v, 2)) * 0.9;
          }
          this.place(c, tmpP.x + ox, tmpP.y, tmpP.z + oz, yaw, dt);
        }
      }
      if (c.state === 'junction') {
        c.jU += c.state === 'junction' && c.s >= s1 - 0.05 ? ds : 0;
        if (c.jU >= c.jLen) {
          const n = c.next!;
          c.e = n.e;
          c.dir = n.dir;
          c.lane = n.lane;
          const f = net.edges[n.e];
          c.s = laneSpan(f, n.dir)[0] + (c.jU - c.jLen);
          c.vmax = f.spec.speed;
          c.next = null;
          c.state = 'lane';
          lanePoint(net, f, c.dir, c.lane, c.s, tmpP);
          this.place(c, tmpP.x, tmpP.y, tmpP.z, Math.atan2(tmpP.tx, tmpP.tz), dt);
        } else {
          this.junctionPoint(c, c.jU, this.jp, this.jt);
          this.place(c, this.jp.x, this.jp.y, this.jp.z, Math.atan2(this.jt.x, this.jt.z), dt);
        }
      }
    }
    // ---- contact with the player (every car: moving, parked, wrecked)
    if (player) this.collide(player);
    // draw
    for (const c of this.cars) {
      if (c.state === 'player') continue;
      const lit = night > 0.3 ? 1 : 0;
      const flash = c.police && (c.flags & 1) !== 0;
      const ph = Math.floor(t * 6) % 2;
      this.fleet.set(c.slot, c.pos.x, c.pos.y, c.pos.z, c.yaw, c.body ? c.body.pitch - c.body.groundPitch : c.tp ?? 0, c.body ? -c.body.roll + c.body.groundRoll : c.tr ?? 0, c.steer, c.spin, lit, c.brake, flash ? ph : 0, flash ? 1 - ph : 0);
    }
    this.blockers.length = 0;
  }

  private place(c: AICar, x: number, y: number, z: number, yaw: number, dt: number) {
    const dyaw = Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw));
    c.steer = THREE.MathUtils.clamp((dyaw / Math.max(dt, 1e-3)) * c.spec.wb / Math.max(c.v, 1), -0.6, 0.6) * 0.8 + c.steer * 0.2;
    c.pos.set(x, y + 0.03, z);
    c.yaw = yaw;
    c.spin += (c.v / c.spec.wheelR) * dt;
  }

  /** a body (the player's car, a cruiser) against every traffic car near it */
  collide(p: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; hl: number; hw: number; mass: number; onImpulse: (jx: number, jz: number, px: number, pz: number) => void }) {
    for (const c of this.cars) if (c.state !== 'player') this.contact(c, p);
  }

  /** box vs box with the player: push apart, exchange the impulse, the AI car goes physical */
  private contact(c: AICar, p: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; hl: number; hw: number; mass: number; onImpulse: (jx: number, jz: number, px: number, pz: number) => void }) {
    const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z;
    if (dx * dx + dz * dz > 100 || Math.abs(c.pos.y - p.pos.y) > 1.6) return;
    const hit = obbOverlap(p.pos.x, p.pos.z, p.yaw, p.hl, p.hw, c.pos.x, c.pos.z, c.yaw, c.spec.L / 2, c.spec.W / 2);
    if (!hit) return;
    // become a body with the lane speed
    if (!c.body) this.makeDynamic(c);
    const b = c.body!;
    const m1 = p.mass, m2 = c.spec.mass;
    // separate
    p.pos.x -= hit.nx * hit.depth * (m2 / (m1 + m2));
    p.pos.z -= hit.nz * hit.depth * (m2 / (m1 + m2));
    b.pos.x += hit.nx * hit.depth * (m1 / (m1 + m2));
    b.pos.z += hit.nz * hit.depth * (m1 / (m1 + m2));
    const rvx = b.vx - p.vel.x, rvz = b.vz - p.vel.z;
    const vn = rvx * hit.nx + rvz * hit.nz;
    if (vn >= 0) return;
    const j = (-(1 + 0.25) * vn) / (1 / m1 + 1 / m2);
    if (j / m2 > 8 || b.free) {
      // a heavy hit (or one already tumbling): into the rigid body, struck low at the bumper line
      b.kick(j * hit.nx, j * 0.04, j * hit.nz, hit.px, b.pos.y + 0.35, hit.pz);
    } else {
      // (struck off-centre it spins: the lever arm)
      b.shove((j * hit.nx) / m2, (j * hit.nz) / m2, hit.px, hit.pz);
    }
    p.onImpulse((-j * hit.nx) / m1, (-j * hit.nz) / m1, hit.px, hit.pz);
    this.hits.push({ car: c, speed: -vn });
  }

  makeDynamic(c: AICar) {
    const b = new CarBody(carSpecOf(c.spec));
    b.placeTilted(c.pos.x, c.pos.y, c.pos.z, c.tp ?? 0, c.yaw, c.tr ?? 0);
    b.vx = Math.sin(c.yaw) * c.v;
    b.vz = Math.cos(c.yaw) * c.v;
    c.body = b;
    c.state = 'dynamic';
    c.rest = 0;
  }

  private stepDynamic(c: AICar, dt: number, t: number) {
    const b = c.body!;
    b.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: false, thrust: 0 }, this.net, this.world);
    c.pos.copy(b.pos);
    c.yaw = b.yaw;
    c.v = b.speed;
    c.spin = b.spin;
    c.steer = 0;
    c.brake = 1;
    if (b.speed < 0.4) c.rest += dt;
    else c.rest = 0;
    if (b.inWater) c.flags |= 2;
    if (b.overturned) c.flags |= OVER;
    else if (!b.free) c.flags &= ~OVER;
    // one the player left (or a wreck, or rolled over): parked where it stops, as it lies
    if (c.flags & (4 | WRECK | OVER) && c.rest > 0.8 && (!b.free || b.overturned)) {
      c.state = 'parked';
      c.tp = b.pitch - b.groundPitch;
      c.tr = -b.roll + b.groundRoll;
      c.body = null;
      c.v = 0;
      return;
    }
    // back into the traffic once it's sitting on a lane, facing roughly along it
    if (c.rest > 3 && !b.free && !(c.flags & (2 | WRECK | OVER))) {
      const hit = this.net.nearestEdge(b.pos.x, b.pos.z, b.pos.y, 6);
      if (hit && hit.e.kind !== 'lane') {
        const e = hit.e;
        const fwd = Math.atan2(hit.pr.tx, hit.pr.tz);
        const dYaw = Math.abs(Math.atan2(Math.sin(b.yaw - fwd), Math.cos(b.yaw - fwd)));
        const dir: 1 | -1 = dYaw < Math.PI / 2 ? 1 : -1;
        const lane = THREE.MathUtils.clamp(Math.floor((Math.abs(hit.pr.lat) - e.spec.median) / LANE_W), 0, e.spec.lanes - 1);
        if (Math.sign(hit.pr.lat) === dir) {
          c.e = e.id;
          c.dir = dir;
          c.lane = lane;
          c.s = dir > 0 ? hit.pr.s : e.len - hit.pr.s;
          c.v = 0;
          c.state = 'lane';
          c.body = null;
          c.next = null;
          c.vmax = e.spec.speed;
        }
      }
    }
    void t;
  }

  // ---- parked cars: only near the player (deterministic per spot)
  private updateParked(center: THREE.Vector3) {
    const R2 = 210 * 210;
    for (const [i, c] of this.parkedOn) {
      const p = this.parking[i];
      if ((p.x - center.x) ** 2 + (p.z - center.z) ** 2 > R2 * 1.4 && c.state === 'parked') {
        this.retire(c);
        this.parkedOn.delete(i);
      }
    }
    let budget = 30;
    for (let i = 0; i < this.parking.length && budget > 0; i++) {
      if (this.parkedOn.has(i)) continue;
      const p = this.parking[i];
      if ((p.x - center.x) ** 2 + (p.z - center.z) ** 2 > R2) continue;
      const h = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const r = Math.abs(h);
      const model: ModelId = r < 0.3 ? 'sedan' : r < 0.52 ? 'suv' : r < 0.66 ? 'compact' : r < 0.74 ? 'pickup' : r < 0.82 ? 'gwagon' : r < 0.88 ? 'coupe' : r < 0.92 ? 'cyber' : 'van';
      if (this.fleet.available(model) < 4) continue;
      const slot = this.fleet.alloc(model, PAINTS[Math.floor(r * 997) % PAINTS.length]);
      if (!slot) continue;
      budget--;
      const spec = MODELS[model];
      const c: AICar = {
        id: this.nextId++, slot, spec, state: 'parked', e: -1, dir: 1, lane: 0, s: 0, v: 0, vmax: 0, next: null,
        jp0: new THREE.Vector3(), jt0: new THREE.Vector3(), jp1: new THREE.Vector3(), jt1: new THREE.Vector3(), jLen: 0, jU: 0,
        pos: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw, steer: 0, spin: 0, brake: 0, body: null, rest: 0, wait: 0, honk: 0, police: false, flags: 0, key: '', temper: 1,
      };
      this.cars.push(c);
      this.parkedOn.set(i, c);
      this.fleet.set(slot, p.x, p.y, p.z, p.yaw, 0, 0, 0, 0, 0, 0);
    }
  }

  /** a car delivered to the player (parked, no driver; retired once left far behind) */
  spawnParked(model: ModelId, x: number, y: number, z: number, yaw: number, paint: THREE.ColorRepresentation): AICar | null {
    const slot = this.fleet.alloc(model, paint);
    if (!slot) return null;
    const spec = MODELS[model];
    const c: AICar = {
      id: this.nextId++, slot, spec, state: 'parked', e: -1, dir: 1, lane: 0, s: 0, v: 0, vmax: 0, next: null,
      jp0: new THREE.Vector3(), jt0: new THREE.Vector3(), jp1: new THREE.Vector3(), jt1: new THREE.Vector3(), jLen: 0, jU: 0,
      pos: new THREE.Vector3(x, y, z), yaw, steer: 0, spin: 0, brake: 0, body: null, rest: 0, wait: 0, honk: 0,
      police: model === 'police' || model === 'policeSuv', flags: 4, key: '', temper: 1,
    };
    this.cars.push(c);
    return c;
  }

  /** the nearest car to a point (for stealing), within r */
  nearest(x: number, z: number, r: number): AICar | null {
    let best: AICar | null = null, bd = r;
    for (const c of this.cars) {
      if (c.state === 'player' || c.flags & WRECK) continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }
}

/** a ray against a car's box (its footprint, from the sills to the roof); t or -1, and the face normal */
export function rayCar(c: { pos: THREE.Vector3; yaw: number; spec: { L: number; W: number; H: number } }, o: THREE.Vector3, d: THREE.Vector3, maxT: number, n?: THREE.Vector3): number {
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  // into the car's frame: x left, z forward
  const px = o.x - c.pos.x, py = o.y - c.pos.y, pz = o.z - c.pos.z;
  const lx = px * cs - pz * sn, lz = px * sn + pz * cs;
  const dx = d.x * cs - d.z * sn, dz = d.x * sn + d.z * cs;
  const lo = [-c.spec.W / 2, 0.25, -c.spec.L / 2], hi = [c.spec.W / 2, c.spec.H * 0.97, c.spec.L / 2];
  const P = [lx, py, lz], D = [dx, d.y, dz];
  let t0 = 0, t1 = maxT, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) {
      if (P[k] < lo[k] || P[k] > hi[k]) return -1;
      continue;
    }
    let a = (lo[k] - P[k]) / D[k], b = (hi[k] - P[k]) / D[k];
    let sg = -1;
    if (a > b) {
      const q = a;
      a = b;
      b = q;
      sg = 1;
    }
    if (a > t0) {
      t0 = a;
      axis = k;
      sign = sg;
    }
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  if (axis < 0) return -1;
  if (n) {
    const l = [0, 0, 0];
    l[axis] = sign;
    // back to the world
    n.set(l[0] * cs + l[2] * sn, l[1], -l[0] * sn + l[2] * cs);
  }
  return t0;
}

/** SAT between two oriented boxes in xz; the push for B away from A */
export function obbOverlap(ax: number, az: number, ayaw: number, ahl: number, ahw: number, bx: number, bz: number, byaw: number, bhl: number, bhw: number): { nx: number; nz: number; depth: number; px: number; pz: number } | null {
  const axes = [
    [Math.sin(ayaw), Math.cos(ayaw)],
    [Math.cos(ayaw), -Math.sin(ayaw)],
    [Math.sin(byaw), Math.cos(byaw)],
    [Math.cos(byaw), -Math.sin(byaw)],
  ];
  const dx = bx - ax, dz = bz - az;
  let best = Infinity, bnx = 0, bnz = 0;
  for (const [x, z] of axes) {
    const ra = ahl * Math.abs(x * axes[0][0] + z * axes[0][1]) + ahw * Math.abs(x * axes[1][0] + z * axes[1][1]);
    const rb = bhl * Math.abs(x * axes[2][0] + z * axes[2][1]) + bhw * Math.abs(x * axes[3][0] + z * axes[3][1]);
    const d = dx * x + dz * z;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      const s = d >= 0 ? 1 : -1;
      bnx = x * s;
      bnz = z * s;
    }
  }
  // the contact point: halfway between each box's support toward the other (a face's middle if it's flat on)
  const sup = (x: number, z: number, yaw: number, hl: number, hw: number, nx: number, nz: number, out: number[]) => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const df = nx * fx + nz * fz, dl = nx * lx + nz * lz;
    // (a side near-square to n: its middle, not a corner)
    const sf = Math.abs(df) < 0.15 ? 0 : Math.sign(df), sl = Math.abs(dl) < 0.15 ? 0 : Math.sign(dl);
    out[0] = x + fx * hl * sf + lx * hw * sl;
    out[1] = z + fz * hl * sf + lz * hw * sl;
  };
  sup(ax, az, ayaw, ahl, ahw, bnx, bnz, SA);
  sup(bx, bz, byaw, bhl, bhw, -bnx, -bnz, SB);
  return { nx: bnx, nz: bnz, depth: best, px: (SA[0] + SB[0]) / 2, pz: (SA[1] + SB[1]) / 2 };
}
const SA = [0, 0], SB = [0, 0];
