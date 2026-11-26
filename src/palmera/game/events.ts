// Street events: every minute or two, when you're free (no job, no heat), something happens near
// you. A bag snatch: someone walks up to a passer-by, grabs their bag and runs. Knock the thief
// down (fists, a bat, a bumper) and the bag drops; pick it up and take it back for a reward. Leave
// it and he's gone in under a minute.
import * as THREE from 'three';
import type { Human } from '../entities/humans';
import { Vehicle } from '../entities/vehicle';
import { FleeAI } from './traffic';
import { groundAt } from '../world/map';
import type { Blip } from './missions';
import type { Game } from './game';

type Stage = 'approach' | 'run' | 'dropped' | 'carry';

/** the getaway car: picks its own turns (not just away from you) and leaves a trail of them */
class GetawayAI extends FleeAI {
  trail: Map<number, number> | undefined;
  choose(at: number, came: number): number {
    const p = this.panic;
    this.panic = 0;
    const n = super.choose(at, came);
    this.panic = p;
    this.trail?.set(at, n);
    return n;
  }
}

/** the squad car: takes the same turns the getaway car took */
class ChaserAI extends FleeAI {
  trail: Map<number, number> | undefined;
  choose(at: number, came: number): number {
    const n = this.trail?.get(at);
    if (n !== undefined && n !== came) return n;
    return super.choose(at, came);
  }
}

interface Chase {
  car: Vehicle;
  cop: Vehicle;
  t: number;
  seen: boolean;
  stall: number;
}

const REWARD = 250;

export class StreetEvents {
  private t = 50;
  private stage: Stage | null = null;
  private thief: Human | null = null;
  private victim: Human | null = null;
  private timer = 0;
  gap = 0;
  private readonly bag: THREE.Mesh;
  private readonly bagPos = new THREE.Vector3();
  chase: Chase | null = null;

  constructor(private game: Game) {
    const g = new THREE.BoxGeometry(0.34, 0.26, 0.14);
    g.translate(0, 0.13, 0);
    this.bag = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb0302f, roughness: 0.55 }));
    this.bag.castShadow = true;
    this.bag.visible = false;
    game.scene.add(this.bag);
  }

  get active() {
    return this.stage !== null || this.chase !== null;
  }

  /**
   * A police chase: a getaway car and a squad car with its siren going, on a road 80-150 m away
   * heading your way. Both run red lights at speed; everyone else pulls over for the siren.
   */
  triggerChase(): boolean {
    const g = this.game;
    const map = g.map;
    const f = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
    const near = map.nodes.filter((n) => {
      const d = Math.hypot(n.x - f.x, n.z - f.z);
      return d > 80 && d < 150 && n.edges.length >= 2;
    });
    for (let k = 0; k < 20 && near.length; k++) {
      const A = near[Math.floor(Math.random() * near.length)];
      // the road out of A that heads closest towards you
      let best = -1, bd = 1e9;
      for (const eid of A.edges) {
        const o = map.nodes[map.otherEnd(map.edges[eid], A.id)];
        const d = Math.hypot(o.x - f.x, o.z - f.z);
        if (d < bd) (bd = d), (best = o.id);
      }
      const B = map.nodes[best];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if (len < 45 || bd > Math.hypot(A.x - f.x, A.z - f.z)) continue;
      const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
      const lane = (t: number) => ({ x: A.x + dx * t - dz * 3, z: A.z + dz * t + dx * 3 });
      const p1 = lane(30), p0 = lane(12);
      if (g.vehicles.some((u) => Math.hypot(u.pos.x - p1.x, u.pos.z - p1.z) < 8 || Math.hypot(u.pos.x - p0.x, u.pos.z - p0.z) < 8)) continue;
      const trail = new Map<number, number>();
      const car = new Vehicle(Math.random() < 0.5 ? 'sports' : 'sedan');
      car.place(p1.x, p1.z, Math.atan2(dx, dz));
      car.driver = 'npc';
      const ai = new GetawayAI(g, A.id, B.id, 21);
      ai.trail = trail;
      trail.set(B.id, ai.next);
      car.ai = ai;
      car.urgent = true;
      const cop = new Vehicle('police');
      cop.place(p0.x, p0.z, Math.atan2(dx, dz));
      cop.driver = 'npc';
      cop.occupants = 2;
      const cai = new ChaserAI(g, A.id, B.id, 21);
      cai.trail = trail;
      cai.next = trail.get(B.id) ?? cai.next;
      cop.ai = cai;
      cop.siren = true;
      for (const v of [car, cop]) {
        v.persistent = true;
        v.vx = dx * 16;
        v.vz = dz * 16;
        g.addVehicle(v);
      }
      this.chase = { car, cop, t: 70, seen: false, stall: 0 };
      return true;
    }
    return false;
  }

  private endChase() {
    const c = this.chase;
    if (!c) return;
    c.car.persistent = c.cop.persistent = false;
    c.car.urgent = false;
    if (!c.cop.wrecked) c.cop.siren = false;
    this.chase = null;
    this.t = 70 + Math.random() * 60;
  }

  private updateChase(dt: number) {
    const g = this.game;
    const c = this.chase!;
    c.t -= dt;
    const me = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
    const d = Math.hypot(c.car.pos.x - me.x, c.car.pos.z - me.z);
    if (!c.seen && d < 60) c.seen = true;
    // you stopped the getaway car: a reward from a grateful police department
    if ((c.car.wrecked || c.car.health < c.car.spec.health * 0.25) && d < 50) {
      g.addCash(400);
      g.hud.bigMessage('GETAWAY STOPPED', '+$400 from Palmera PD', '#4da6ff');
      g.audio.cue('pass');
      return this.endChase();
    }
    if (c.t <= 0 || !g.vehicles.includes(c.car) || !g.vehicles.includes(c.cop) || (c.seen && d > 260)) return this.endChase();
    // stopped for good (boxed in behind traffic, crashed): the squad car has it, the chase is over
    c.stall = Math.abs(c.car.speed) < 1.5 ? c.stall + dt : 0;
    if (c.stall > 6) {
      if (d < 70) g.hud.toast('The police have the getaway car boxed in');
      return this.endChase();
    }
    // you took one of the cars: the chase is off
    if (g.player.vehicle === c.car || g.player.vehicle === c.cop) return this.endChase();
  }

  get blips(): Blip[] {
    if (this.chase) return [{ x: this.chase.car.pos.x, z: this.chase.car.pos.z, color: '#ff4d4d', label: '', kind: 'car' }];
    if (!this.stage) return [];
    if (this.stage === 'run' && this.thief) return [{ x: this.thief.pos.x, z: this.thief.pos.z, color: '#ff4d4d', label: '', kind: 'car' }];
    if (this.stage === 'dropped') return [{ x: this.bagPos.x, z: this.bagPos.z, color: '#ffd23f', label: '', kind: 'dest' }];
    if (this.stage === 'carry' && this.victim) return [{ x: this.victim.pos.x, z: this.victim.pos.z, color: '#5cff8a', label: '', kind: 'dest' }];
    return [];
  }

  /** start a bag snatch now near the player, if there's a pair of walkers to use (tests and the timer) */
  trigger(): boolean {
    const g = this.game;
    const f = g.player.pos;
    const walkers = g.npcs.filter((h) => h.kind === 'ped' && h.state === 'walk' && !h.dead && !h.hidden && !g.dogs.dogs.some((d) => d.owner === h));
    // a passer-by 12-70 m off, the ones you can see first
    const victims = walkers
      .filter((h) => {
        const d = Math.hypot(h.pos.x - f.x, h.pos.z - f.z);
        return d > 12 && d < 70;
      })
      .sort((a, b) => (g.inView(b.pos.x, 1, b.pos.z) ? 1 : 0) - (g.inView(a.pos.x, 1, a.pos.z) ? 1 : 0));
    for (const v of victims) {
      const th = walkers.find((h) => {
        if (h === v) return false;
        const dx = v.pos.x - h.pos.x, dz = v.pos.z - h.pos.z, d = Math.hypot(dx, dz);
        // close, and nothing (a building) between them
        return d > 5 && d < 30 && !g.map.colliders.raycast(h.pos.x, h.pos.y + 1, h.pos.z, dx / d, 0, dz / d, d);
      });
      if (!th) continue;
      this.victim = v;
      this.thief = th;
      this.stage = 'approach';
      this.timer = 20;
      th.state = 'event';
      return true;
    }
    return false;
  }

  private end(msg?: string) {
    const g = this.game;
    if (msg) g.hud.toast(msg);
    if (this.victim && !this.victim.dead && (this.victim.state === 'wait' || this.victim.state === 'event')) this.victim.state = 'walk';
    if (this.thief && !this.thief.dead && this.thief.state === 'event') this.thief.state = 'walk';
    this.stage = null;
    this.thief = this.victim = null;
    this.bag.visible = false;
    this.t = 70 + Math.random() * 60;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    if (this.chase) return this.updateChase(dt);
    if (!this.stage) {
      this.t -= dt;
      if (this.t > 0) return;
      const free = !g.missions.active && g.wanted.level === 0 && !p.dead && !g.interiors.inside && !g.chopper.camera();
      // by day either; after dark only chases
      const snatch = g.sky.day > 0.3 && Math.random() < 0.5;
      if (!free || !(snatch ? this.trigger() : this.triggerChase())) this.t = 12;
      return;
    }
    const th = this.thief!, vi = this.victim!;
    if (vi.dead || !g.npcs.includes(vi)) return this.end();
    this.timer -= dt;
    const me = p.vehicle ? p.vehicle.pos : p.pos;
    if (this.stage === 'approach') {
      // the walking code may switch him to crossing at a corner; only a real fright calls it off
      if (th.dead || !g.npcs.includes(th) || ['flee', 'cower', 'handsup', 'fight', 'phone'].includes(th.state) || this.timer <= 0) return this.end();
      th.state = 'event';
      const dx = vi.pos.x - th.pos.x, dz = vi.pos.z - th.pos.z, d = Math.hypot(dx, dz);
      g.setDesired(th, (dx / d) * 3.2, (dz / d) * 3.2);
      this.gap = d;
      if (d < 1.1) {
        // the grab
        this.stage = 'run';
        this.timer = 45;
        g.peds.scare(th, vi.pos.x, vi.pos.z, 60, true);
        vi.state = 'wait';
        vi.yaw = Math.atan2(th.pos.x - vi.pos.x, th.pos.z - vi.pos.z);
        vi.flinch = 1;
        if (Math.hypot(vi.pos.x - me.x, vi.pos.z - me.z) < 60) {
          g.hud.subtitle('PASSER-BY: Hey! My bag! Somebody stop him!');
          g.audio.cue('wanted');
        }
      }
      return;
    }
    if (this.stage === 'run') {
      if (!g.npcs.includes(th)) return this.end('The bag thief got away');
      // he runs from whoever is chasing him
      const chase = Math.hypot(th.pos.x - me.x, th.pos.z - me.z);
      if (th.state === 'flee') {
        th.stateT = Math.max(th.stateT, 5);
        if (chase < 35) th.fleeFrom.set(me.x, 0, me.z);
      }
      this.bag.visible = !th.dead && th.down <= 0;
      if (this.bag.visible) {
        const rx = Math.cos(th.yaw), rz = -Math.sin(th.yaw);
        this.bag.position.set(th.pos.x + rx * 0.3, th.pos.y + 0.62, th.pos.z + rz * 0.3);
        this.bag.rotation.y = th.yaw;
      }
      if (th.dead || th.down > 0) {
        // down he goes, and the bag with him
        this.stage = 'dropped';
        this.bagPos.set(th.pos.x + 0.6, 0, th.pos.z + 0.4);
        this.bagPos.y = groundAt(this.bagPos.x, this.bagPos.z);
        this.bag.position.copy(this.bagPos);
        this.bag.visible = true;
        this.timer = 60;
        g.hud.toast('The thief dropped the bag');
        return;
      }
      if (this.timer <= 0 || chase > 110) return this.end('The bag thief got away');
      return;
    }
    if (this.stage === 'dropped') {
      this.bag.rotation.y += dt * 1.5;
      const reach = p.vehicle ? 3.2 : 1.5;
      if (Math.hypot(this.bagPos.x - me.x, this.bagPos.z - me.z) < reach) {
        this.stage = 'carry';
        this.bag.visible = false;
        this.timer = 90;
        g.audio.cue('pickup');
        g.hud.toast('Got the bag · take it back to its owner');
      } else if (this.timer <= 0) return this.end();
      return;
    }
    // carrying it back
    vi.state = 'wait';
    if (Math.hypot(vi.pos.x - me.x, vi.pos.z - me.z) < (p.vehicle ? 4 : 2.2)) {
      g.addCash(REWARD);
      g.hud.bigMessage('BAG RETURNED', `+$${REWARD}`, '#5cff8a');
      g.hud.subtitle('PASSER-BY: Oh, thank you! Here, take this.');
      g.audio.cue('pass');
      return this.end();
    }
    if (this.timer <= 0) return this.end();
    g.hud.prompt('Take the bag back to its owner');
  }
}
