// Hold-ups: a handful of corner stores downtown and by the harbour, each with a clerk minding the
// door. Hold a gun on the clerk and the till empties into your pocket over a few seconds; lower it
// too soon and they hit the alarm. Either way the police hear about it.
import * as THREE from 'three';
import { Human } from '../entities/humans';
import { groundAt, type BuildingSpec } from '../world/map';
import type { Blip } from './missions';
import type { Game } from './game';

const NAMES = ['Gull Mart', 'Corner Pantry', 'Sunny Stop', 'Night Owl Deli', 'Tidewater Market', 'Bayside Bodega', 'Pelican Snacks'];

interface Store {
  name: string;
  pos: THREE.Vector3;
  face: number; // yaw the clerk faces (out of the door)
  clerk: Human | null;
  cooldown: number;
  progress: number;
  robbing: boolean;
}

export class Robbery {
  stores: Store[] = [];
  private t = 0;

  constructor(private game: Game) {
    const map = game.map;
    const cands = map.buildings.filter((b) => b.style === 3 && b.y0 === 0 && b.collide);
    const pickFrom = (region: string, n: number) => {
      const list = cands.filter((b) => map.blocks.some((k) => k.region === region && inside(k, b)));
      const step = Math.max(1, Math.floor(list.length / n));
      for (let i = 0; i < list.length && this.stores.filter((s) => s.name).length < 99; i += step) {
        if (this.stores.length >= NAMES.length) break;
        const b = list[i];
        const f = front(map, b);
        if (!f) continue;
        if (this.stores.some((s) => s.pos.distanceTo(f.p) < 120)) continue;
        this.stores.push({ name: NAMES[this.stores.length], pos: f.p, face: f.yaw, clerk: null, cooldown: 0, progress: 0, robbing: false });
        if (this.stores.length >= n + (region === 'harbor' ? 4 : 0)) break;
      }
    };
    pickFrom('downtown', 4);
    pickFrom('harbor', 3);
  }

  get blips(): Blip[] {
    return this.stores.filter((s) => s.cooldown <= 0).map((s) => ({ x: s.pos.x, z: s.pos.z, color: '#7dff9a', label: '$', kind: 'mission' as const }));
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.t -= dt;
    for (const s of this.stores) {
      if (s.cooldown > 0) s.cooldown -= dt;
      const d = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
      // the clerk comes and goes with you
      if (s.clerk && (!g.npcs.includes(s.clerk) || s.clerk.dead)) s.clerk = null;
      if (!s.clerk && d < 90 && d > 30 && s.cooldown <= 0) {
        const h = new Human('ped');
        h.pos.set(s.pos.x, groundAt(s.pos.x, s.pos.z), s.pos.z);
        h.yaw = s.face;
        h.state = 'wait';
        h.clip = 'idle';
        h.stateT = 1e9;
        h.health = h.maxHealth = 60;
        h.shirt.setRGB(0.15, 0.45, 0.32);
        g.addNpc(h);
        s.clerk = h;
      } else if (s.clerk && d > 160 && s.clerk.state === 'wait') {
        g.removeNpc(s.clerk);
        s.clerk = null;
      }
      const c = s.clerk;
      if (!c || s.cooldown > 0) continue;
      if (c.state === 'wait') {
        c.yaw += Math.atan2(Math.sin(s.face - c.yaw), Math.cos(s.face - c.yaw)) * Math.min(1, dt * 3);
        if (d < 14 && !p.vehicle && g.wanted.level === 0) g.hud.prompt(`${s.name} — aim a gun at the clerk to rob the till`);
      }
      // a gun on the clerk: the reactions put their hands up; while they stay up, the till empties
      const held = c.state === 'handsup' && d < 14 && !p.vehicle;
      if (held) {
        if (!s.robbing) {
          s.robbing = true;
          g.hud.subtitle(['CLERK: Okay, okay! Take it!', 'CLERK: Don’t shoot! It’s all yours!', 'CLERK: Easy… the drawer’s opening.'][Math.floor(Math.random() * 3)], 3);
        }
        s.progress += dt / 5;
        g.hud.prompt(`Emptying the till… <b>${Math.min(100, Math.round(s.progress * 100))}%</b>`);
        if (s.progress >= 1) {
          const cash = 300 + Math.floor(Math.random() * 600);
          g.addCash(cash);
          g.hud.bigMessage('STORE ROBBED', `+$${cash}  ·  ${s.name}`, '#7dff9a');
          g.audio.cue('cash');
          g.wanted.setLevel(Math.max(2, g.wanted.level));
          this.end(s, 240);
        }
      } else if (s.robbing && s.progress > 0) {
        // they got their hands down before it was done: the alarm
        g.hud.toast(`${s.name}: the clerk hit the silent alarm`);
        g.wanted.setLevel(Math.max(1, g.wanted.level));
        this.end(s, 120);
      }
    }
  }

  private end(s: Store, cooldown: number) {
    s.robbing = false;
    s.progress = 0;
    s.cooldown = cooldown;
    const c = s.clerk;
    if (c && !c.dead) this.game.peds.scare(c, this.game.player.pos.x, this.game.player.pos.z, 10, true);
    s.clerk = null;
  }
}

function inside(k: { x0: number; z0: number; x1: number; z1: number }, b: BuildingSpec) {
  return b.x > k.x0 && b.x < k.x1 && b.z > k.z0 && b.z < k.z1;
}

/** the side of the building facing its block's edge (the street), and a spot just outside it */
function front(map: Game['map'], b: BuildingSpec): { p: THREE.Vector3; yaw: number } | null {
  const k = map.blocks.find((q) => inside(q, b));
  if (!k) return null;
  const sides = [
    { d: b.x - b.w / 2 - k.x0, x: b.x - b.w / 2 - 1.4, z: b.z, yaw: -Math.PI / 2 },
    { d: k.x1 - (b.x + b.w / 2), x: b.x + b.w / 2 + 1.4, z: b.z, yaw: Math.PI / 2 },
    { d: b.z - b.d / 2 - k.z0, x: b.x, z: b.z - b.d / 2 - 1.4, yaw: Math.PI },
    { d: k.z1 - (b.z + b.d / 2), x: b.x, z: b.z + b.d / 2 + 1.4, yaw: 0 },
  ].sort((a, c) => a.d - c.d);
  const f = sides[0];
  return { p: new THREE.Vector3(f.x, 0, f.z), yaw: f.yaw };
}
