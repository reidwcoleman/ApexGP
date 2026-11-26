// Wanted level, police pursuit in cars and officers on foot.
import * as THREE from 'three';
import { clamp, wrapAngle } from '../core/math';
import { Human } from '../entities/humans';
import { Vehicle, type CarAI } from '../entities/vehicle';
import { LANE_OFF, groundAt } from '../world/map';
import type { Game } from './game';
import { TrafficAI, laneTarget, steerTo } from './traffic';

export type Crime = 'assault' | 'kill' | 'jack' | 'steal' | 'copAssault' | 'copKill' | 'copCar' | 'shots' | 'vehicle' | 'mission';
const HEAT: Record<Crime, number> = { assault: 0.6, kill: 1.6, jack: 1.0, steal: 0.5, copAssault: 2.5, copKill: 4, copCar: 1.2, shots: 0.4, vehicle: 0.4, mission: 0 };
const THRESH = [1, 3, 6.5, 11, 17];

export class Wanted {
  heat = 0;
  level = 0;
  unseen = 0;
  lastKnown = new THREE.Vector3();
  flash = false;
  spawnT = 0;
  maxSeen = 0;
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor(private game: Game) {}

  get searchTime() {
    return 9 + this.level * 4;
  }

  crime(kind: Crime, x: number, z: number, witnessed = true) {
    if (!witnessed && !this.copsNear(x, z, 60)) return;
    const before = this.level;
    this.heat += HEAT[kind];
    if (kind === 'copAssault' || kind === 'copKill' || kind === 'copCar') this.heat = Math.max(this.heat, THRESH[1]);
    this.recompute();
    this.unseen = 0;
    this.lastKnown.set(x, 0, z);
    if (this.level > before) {
      this.game.audio.cue('wanted');
      this.game.hud.flashStars();
    }
  }

  setLevel(n: number) {
    n = clamp(n, 0, 5);
    this.heat = n === 0 ? 0 : THRESH[n - 1] + 0.01;
    this.recompute();
    this.unseen = 0;
    this.lastKnown.copy(this.game.player.pos);
  }

  private recompute() {
    let l = 0;
    for (const t of THRESH) if (this.heat >= t) l++;
    this.level = Math.min(5, l);
    this.maxSeen = Math.max(this.maxSeen, this.level);
  }

  /** roadblocks set up ahead of you at three stars and up: two cruisers across the road, officers behind */
  roadblocks: { cars: Vehicle[]; cops: Human[]; x: number; z: number }[] = [];
  private roadblockT = 8;

  private updateRoadblocks(dt: number) {
    const g = this.game;
    const p = g.player;
    const ref = p.vehicle ? p.vehicle.pos : p.pos;
    // tear down ones far behind (or all, once you're clear)
    this.roadblocks = this.roadblocks.filter((rb) => {
      const far = Math.hypot(rb.x - ref.x, rb.z - ref.z) > 260;
      if (this.level > 0 && !far) return true;
      for (const v of rb.cars) if (g.vehicles.includes(v) && v.driver !== 'player') g.removeVehicle(v);
      for (const h of rb.cops) if (g.npcs.includes(h) && !h.dead) g.removeNpc(h);
      return false;
    });
    if (this.level < 3 || !p.vehicle || p.vehicle.isBoat || p.vehicle.speed < 8) return;
    this.roadblockT -= dt;
    if (this.roadblockT > 0 || this.roadblocks.length >= 2) return;
    this.roadblockT = 22 + Math.random() * 10;
    const v = p.vehicle;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    // a junction well ahead, roughly on the road you're on, out of sight
    let best: { n: typeof g.map.nodes[number]; along: number } | null = null;
    for (const n of g.map.nodes) {
      const ox = n.x - v.pos.x, oz = n.z - v.pos.z;
      const along = ox * fx + oz * fz, lat = Math.abs(ox * -fz + oz * fx);
      if (along < 120 || along > 230 || lat > 14 || n.edges.length < 2) continue;
      if (this.canSee(n.x, 1.5, n.z, 400) && along < 150) continue;
      if (!best || along < best.along) best = { n, along };
    }
    if (!best) return;
    // on the road leading in from your side, 16 m short of the junction
    const n = best.n;
    let dx = -fx, dz = -fz;
    let bestDot = -2;
    for (const eid of n.edges) {
      const o = g.map.nodes[g.map.otherEnd(g.map.edges[eid], n.id)];
      const ex = o.x - n.x, ez = o.z - n.z, el = Math.hypot(ex, ez) || 1;
      const dot = (ex * -fx + ez * -fz) / el;
      if (dot > bestDot) (bestDot = dot), (dx = ex / el), (dz = ez / el);
    }
    if (bestDot < 0.7) return;
    const cx = n.x + dx * 16, cz = n.z + dz * 16;
    const across = Math.atan2(-dz, dx); // heading pointing across the road
    const cars: Vehicle[] = [], cops: Human[] = [];
    for (const s of [-1, 1]) {
      const x = cx + -dz * s * 2.9, z = cz + dx * s * 2.9;
      const c = g.spawnCar('police', x + dx * s * 0.8, z + dz * s * 0.8, across + s * 0.35 + (s < 0 ? Math.PI : 0));
      c.siren = true;
      c.occupants = 0;
      c.despawnable = false;
      cars.push(c);
    }
    const lvl = this.level;
    for (let i = 0; i < 3; i++) {
      const h = new Human('cop');
      const o = (i - 1) * 2.6;
      const x = cx - dx * 3.2 + -dz * o, z = cz - dz * 3.2 + dx * o;
      h.pos.set(x, groundAt(x, z), z);
      h.yaw = Math.atan2(dx, dz);
      h.weapon = lvl >= 4 ? 'rifle' : i === 1 ? 'shotgun' : 'smg';
      if (lvl >= 4) h.armor = 100;
      h.state = 'chase';
      h.post = h.pos.clone();
      g.addNpc(h);
      cops.push(h);
    }
    this.roadblocks.push({ cars, cops, x: cx, z: cz });
    g.hud.toast('Roadblock ahead');
  }

  clear() {
    this.heat = 0;
    this.level = 0;
    this.unseen = 0;
    this.flash = false;
    const g = this.game;
    for (const v of g.vehicles) {
      if (v.police && v.ai instanceof PursuitAI) {
        const n = g.map.nearestNode(v.pos.x, v.pos.z);
        const e = g.map.edges[n.edges[0]];
        v.ai = new TrafficAI(g, n.id, g.map.otherEnd(e, n.id));
        v.siren = false;
        v.despawnable = true;
      }
    }
    for (const h of g.npcs) if (h.kind === 'cop' && !h.dead) h.state = 'patrol';
  }

  copsNear(x: number, z: number, r: number): boolean {
    const g = this.game;
    for (const v of g.vehicles) if (v.police && v.occupants > 0 && Math.hypot(v.pos.x - x, v.pos.z - z) < r) return true;
    for (const h of g.npcs) if (h.kind === 'cop' && !h.dead && Math.hypot(h.pos.x - x, h.pos.z - z) < r) return true;
    return false;
  }

  /** Line of sight from a point to the player (buildings block it). */
  canSee(x: number, y: number, z: number, range: number): boolean {
    const g = this.game;
    const p = g.player;
    const tx = p.pos.x, ty = p.pos.y + 1.2, tz = p.pos.z;
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range) return false;
    if (d < 4) return true;
    const hit = g.map.colliders.raycast(x, y, z, dx / d, dy / d, dz / d, d - 1);
    return !hit;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    if (this.level === 0) {
      this.flash = false;
      if (this.roadblocks.length) this.updateRoadblocks(dt);
      // patrol cars notice crimes in progress only via crime(); nothing else to do
      return;
    }
    // sight check
    const range = 55 + this.level * 14;
    let seen = false;
    for (const v of g.vehicles) {
      if (!v.police || v.occupants <= 0 || v.wrecked) continue;
      if (this.canSee(v.pos.x, v.pos.y + 1.4, v.pos.z, range)) { seen = true; break; }
    }
    if (!seen) for (const h of g.npcs) {
      if (h.kind !== 'cop' || !h.canAct) continue;
      if (this.canSee(h.pos.x, h.pos.y + 1.6, h.pos.z, range * 0.8)) { seen = true; break; }
    }
    if (seen) {
      this.unseen = 0;
      this.lastKnown.copy(p.vehicle ? p.vehicle.pos : p.pos);
    } else this.unseen += dt;
    this.flash = this.unseen > 2.5;
    if (this.unseen > this.searchTime) {
      this.clear();
      g.hud.toast('You lost the cops');
      return;
    }
    // keep enough pursuers around
    const want = [0, 1, 2, 3, 4, 6][this.level];
    let have = 0;
    for (const v of g.vehicles) if (v.police && v.ai instanceof PursuitAI && !v.wrecked) have++;
    // patrol cars that see the player join in
    if (have < want) {
      for (const v of g.vehicles) {
        if (have >= want) break;
        if (v.police && v.ai instanceof TrafficAI && v.occupants > 0 && !v.wrecked && Math.hypot(v.pos.x - p.pos.x, v.pos.z - p.pos.z) < 120) {
          v.ai = new PursuitAI(g);
          v.siren = true;
          have++;
        }
      }
    }
    this.spawnT -= dt;
    if (have < want && this.spawnT <= 0) {
      this.spawnT = 1.5;
      const v = g.traffic.spawnOnRoad(80, 200, 'police', 80);
      if (v) {
        v.ai = new PursuitAI(g);
        v.siren = true;
        v.occupants = 2;
        v.despawnable = true;
      }
    }
    this.updateRoadblocks(dt);
    // foot cops limit
    for (const h of g.npcs) if (h.kind === 'cop') this.thinkCop(h, dt);
    this.v.set(0, 0, 0);
    void this.v2;
  }

  /** Officers leave their car near the player. */
  deploy(v: Vehicle) {
    const g = this.game;
    const n = v.occupants;
    v.occupants = 0;
    for (let i = 0; i < n; i++) {
      const h = new Human('cop');
      const side = i === 0 ? -1 : 1;
      const rx = -Math.cos(v.heading) * side * (v.spec.wid / 2 + 0.7), rz = Math.sin(v.heading) * side * (v.spec.wid / 2 + 0.7);
      h.pos.set(v.pos.x + rx, groundAt(v.pos.x + rx, v.pos.z + rz), v.pos.z + rz);
      h.yaw = v.heading;
      const lvl = g.wanted.level;
      h.weapon = lvl >= 4 ? 'rifle' : lvl >= 3 ? (i % 2 ? 'shotgun' : 'smg') : 'pistol';
      if (lvl >= 4) h.armor = 100;
      h.state = 'chase';
      h.car = v;
      g.addNpc(h);
    }
  }

  private thinkCop(h: Human, dt: number) {
    const g = this.game;
    const p = g.player;
    if (h.dead) {
      h.deadT += dt;
      g.setDesired(h, 0, 0);
      return;
    }
    if (h.down > 0) {
      h.down -= dt;
      g.setDesired(h, 0, 0);
      return;
    }
    if (this.level === 0 || h.state === 'patrol') {
      h.aim = Math.max(0, h.aim - dt * 3);
      g.setDesired(h, 0, 0);
      return;
    }
    const tp = p.vehicle ? p.vehicle.pos : p.pos;
    const dx = tp.x - h.pos.x, dz = tp.z - h.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const sees = this.canSee(h.pos.x, h.pos.y + 1.6, h.pos.z, 80);
    h.fireT -= dt;
    if (this.level >= 2 && sees && d < 40 && !p.dead) {
      // stop and shoot
      h.yaw = Math.atan2(dx, dz);
      h.aim = Math.min(1, h.aim + dt * 4);
      h.aimPitch = Math.atan2(tp.y + 1.0 - (h.pos.y + 1.5), d);
      const keep = h.post ? 0 : d > 14 ? 3.2 : d < 6 ? -1.5 : 0;
      g.setDesired(h, (dx / d) * keep, (dz / d) * keep);
      if (h.fireT <= 0 && h.aim > 0.8) {
        h.fireT = 0.7 + Math.random() * 0.7;
        const pv = p.vehicle;
        const sp = pv ? pv.speed : Math.hypot(p.vx, p.vz);
        const acc = clamp(0.6 - d * 0.012 - sp * 0.035, 0.08, 0.6);
        const aimAt = this.v.set(tp.x, tp.y + (pv ? 0.9 : 1.2), tp.z);
        g.weapons.npcFire(h, aimAt, acc);
      }
      return;
    }
    h.aim = Math.max(0, h.aim - dt * 3);
    // roadblock officers hold their spot unless you're on foot close by
    if (h.post && !(sees && d < 25 && !p.vehicle)) {
      const px = h.post.x - h.pos.x, pz = h.post.z - h.pos.z, pd = Math.hypot(px, pz);
      g.setDesired(h, pd > 0.8 ? (px / pd) * 3 : 0, pd > 0.8 ? (pz / pd) * 3 : 0);
      if (pd < 0.8) h.yaw = Math.atan2(dx, dz);
      return;
    }
    // run towards the player (or last known position)
    const goal = sees ? tp : this.lastKnown;
    const gx = goal.x - h.pos.x, gz = goal.z - h.pos.z;
    const gd = Math.hypot(gx, gz) || 1;
    if (gd > 1.4) {
      const sp = gd > 4 ? 5.6 : 2.5;
      g.setDesired(h, (gx / gd) * sp, (gz / gd) * sp);
    } else g.setDesired(h, 0, 0);
    // arrest at one star
    if (this.level === 1 && !p.vehicle && d < 1.8 && !p.dead) {
      h.arrestT += dt;
      h.yaw = Math.atan2(dx, dz);
      if (h.arrestT > 1.6 && Math.hypot(p.vx, p.vz) < 4) g.busted();
    } else if (this.level === 1 && p.vehicle && p.vehicle.speed < 1.5 && d < 3.5) {
      h.arrestT += dt;
      if (h.arrestT > 2.5) g.busted();
    } else h.arrestT = Math.max(0, h.arrestT - dt);
  }
}

/** Police car chasing the player: road pathing when far, direct ramming when close. */
export class PursuitAI implements CarAI {
  path: number[] = [];
  pi = 0;
  repath = 0;
  stuckT = 0;
  reverseT = 0;
  stopped = 0;
  constructor(private game: Game) {}

  drive(v: Vehicle, dt: number) {
    const g = this.game;
    const W = g.wanted;
    const p = g.player;
    const tgt = p.vehicle ? p.vehicle.pos : p.pos;
    const seen = W.unseen < 2;
    const goal = seen ? tgt : W.lastKnown;
    const dx = goal.x - v.pos.x, dz = goal.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = v.forwardSpeed;
    v.siren = true;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.input.thr = -1;
      v.input.steer = -steerTo(v, goal.x, goal.z);
      v.input.hand = false;
      return;
    }
    // stuck detection
    if (Math.abs(sp) < 1.2 && v.input.thr > 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 1.5) {
        this.stuckT = 0;
        this.reverseT = 1.1;
      }
    } else this.stuckT = 0;

    // on foot player nearby: pull over and deploy officers
    if (!p.vehicle && d < 16 && seen) {
      v.input.thr = sp > 0.5 ? -1 : 0;
      v.input.hand = true;
      v.input.steer = 0;
      if (Math.abs(sp) < 1 && v.occupants > 0) W.deploy(v);
      return;
    }
    if (v.occupants === 0 && v.driver === 'npc') {
      // officers are out on foot
      v.input.thr = 0;
      v.input.hand = true;
      return;
    }
    const losClear = d < 70 && !g.map.colliders.raycast(v.pos.x, v.pos.y + 1, v.pos.z, dx / (d || 1), 0, dz / (d || 1), d);
    if (d < 45 && losClear) {
      // ram: aim at predicted position
      const pv = p.vehicle;
      const lead = Math.min(1.0, d / 25);
      const ax = goal.x + (pv ? pv.vx * lead : 0), az = goal.z + (pv ? pv.vz * lead : 0);
      v.input.steer = steerTo(v, ax, az);
      const ang = Math.abs(wrapAngle(Math.atan2(ax - v.pos.x, az - v.pos.z) - v.heading));
      const desired = pv ? Math.max(pv.speed + 6, 14) : 10;
      v.input.thr = ang > 1.6 && sp > 8 ? -0.6 : clamp((desired - sp) * 0.5, -1, 1);
      v.input.hand = ang > 1.2 && sp > 12;
      return;
    }
    // road pathing
    this.repath -= dt;
    if (this.repath <= 0 || this.pi >= this.path.length - 1) {
      this.repath = 1.5;
      const from = g.map.nearestNode(v.pos.x + v.fwdX() * 10, v.pos.z + v.fwdZ() * 10);
      const to = g.map.nearestNode(goal.x, goal.z);
      this.path = g.map.path(from.id, to.id);
      this.pi = 0;
    }
    if (this.path.length < 2) {
      // same intersection as the target: drive via it unless we can already see the target
      const n = this.path.length ? g.map.nodes[this.path[0]] : null;
      const viaNode = n && Math.hypot(n.x - v.pos.x, n.z - v.pos.z) > 12 && !losClear;
      v.input.steer = viaNode ? steerTo(v, n!.x, n!.z) : steerTo(v, goal.x, goal.z);
      v.input.thr = clamp((18 - sp) * 0.3, -1, 1);
      v.input.hand = false;
      return;
    }
    // advance along path
    let a = this.path[this.pi], b = this.path[this.pi + 1];
    const B = g.map.nodes[b];
    if (Math.hypot(B.x - v.pos.x, B.z - v.pos.z) < 9 && this.pi < this.path.length - 2) {
      this.pi++;
      a = this.path[this.pi];
      b = this.path[this.pi + 1];
    }
    const c = this.pi + 2 < this.path.length ? this.path[this.pi + 2] : -1;
    const L = laneTarget(g.map, a, b, c, v.pos.x, v.pos.z, 7 + Math.abs(sp) * 0.5, LANE_OFF * 0.5);
    v.input.steer = steerTo(v, L.tx, L.tz);
    let target = 27;
    if (L.turnDot < 0.5 && L.remaining < 40) target = 11 + Math.max(0, L.remaining - 10) * 0.4;
    // avoid rear-ending others
    for (const u of g.vehicles) {
      if (u === v || u.driver === 'player') continue;
      const ox = u.pos.x - v.pos.x, oz = u.pos.z - v.pos.z;
      if (Math.abs(ox) > 25 || Math.abs(oz) > 25) continue;
      const along = ox * v.fwdX() + oz * v.fwdZ();
      const lat = ox * -v.fwdZ() + oz * v.fwdX();
      if (along > 0 && Math.abs(lat) < 2.2) target = Math.min(target, Math.max(4, along - 6));
    }
    v.input.thr = clamp((target - sp) * 0.4, -1, 1);
    v.input.hand = false;
  }
}
