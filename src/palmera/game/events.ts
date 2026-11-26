// Street events: every minute or two, when you're free (no job, no heat), something happens near
// you. A bag snatch: someone walks up to a passer-by, grabs their bag and runs. Knock the thief
// down (fists, a bat, a bumper) and the bag drops; pick it up and take it back for a reward. Leave
// it and he's gone in under a minute.
import * as THREE from 'three';
import type { Human } from '../entities/humans';
import { groundAt } from '../world/map';
import type { Blip } from './missions';
import type { Game } from './game';

type Stage = 'approach' | 'run' | 'dropped' | 'carry';

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

  constructor(private game: Game) {
    const g = new THREE.BoxGeometry(0.34, 0.26, 0.14);
    g.translate(0, 0.13, 0);
    this.bag = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb0302f, roughness: 0.55 }));
    this.bag.castShadow = true;
    this.bag.visible = false;
    game.scene.add(this.bag);
  }

  get active() {
    return this.stage !== null;
  }

  get blips(): Blip[] {
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
    if (!this.stage) {
      this.t -= dt;
      if (this.t > 0) return;
      const free = !g.missions.active && g.wanted.level === 0 && !p.dead && !g.interiors.inside && !g.chopper.camera() && g.sky.day > 0.3;
      if (!free || !this.trigger()) this.t = 12;
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
