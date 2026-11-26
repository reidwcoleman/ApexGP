// How people react to you: hands up when a gun is pointed at them, cowering when shots land close,
// some swing back when you punch them, and a witness with a phone calls the police on you.
import * as THREE from 'three';
import type { Human } from '../entities/humans';
import type { Game } from './game';

export class Reactions {
  private aimT = 0;
  private callCd = 0;

  constructor(private game: Game) {}

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.callCd -= dt;
    // a gun pointed at someone: hands up while it stays on them
    this.aimT -= dt;
    if (this.aimT <= 0 && !p.vehicle && p.weapon !== 'fist' && p.weapon !== 'bat' && g.playerCtl.aiming) {
      this.aimT = 0.15;
      const fx = Math.sin(g.playerCtl.camYaw), fz = Math.cos(g.playerCtl.camYaw);
      for (const h of g.npcs) {
        if (h.kind !== 'ped' || h.dead || h.down > 0) continue;
        const dx = h.pos.x - p.pos.x, dz = h.pos.z - p.pos.z, d = Math.hypot(dx, dz);
        if (d > 28 || d < 0.5) continue;
        if ((dx * fx + dz * fz) / d < 0.985) continue;
        if (h.state !== 'handsup') {
          h.state = 'handsup';
          h.clip = 'idle';
          h.swimming = false;
        }
        h.stateT = 1.2;
      }
    }
  }

  /** someone saw what you did: if nobody is after you yet, one of them calls it in */
  witness(x: number, z: number) {
    const g = this.game;
    if (this.callCd > 0 || g.wanted.level > 0) return;
    let best: Human | null = null, bd = 1e9;
    for (const h of g.npcs) {
      if (h.kind !== 'ped' || h.dead || h.state === 'phone') continue;
      const d = Math.hypot(h.pos.x - x, h.pos.z - z);
      if (d > 10 && d < 50 && d < bd) {
        best = h;
        bd = d;
      }
    }
    if (!best) return;
    this.callCd = 20;
    best.state = 'phone';
    best.clip = 'talk';
    best.stateT = 5 + Math.random() * 2;
  }

  /** punched: most run, some swing back */
  punched(h: Human) {
    if (h.kind !== 'ped' || h.dead) return;
    if (Math.random() < 0.3 && h.health > 25) {
      h.state = 'fight';
      h.clip = '';
      h.stateT = 12;
      h.fireT = 0.5;
    }
  }

  /** a near miss: some drop and cower instead of running */
  cower(h: Human, x: number, z: number): boolean {
    if (Math.hypot(h.pos.x - x, h.pos.z - z) > 11 || Math.random() > 0.4) return false;
    h.state = 'cower';
    h.clip = 'crouch';
    h.stateT = 4 + Math.random() * 4;
    h.fleeFrom.set(x, 0, z);
    return true;
  }

  /** true when the state is one of ours */
  think(h: Human, dt: number): boolean {
    const g = this.game;
    const p = g.player;
    switch (h.state) {
      case 'handsup':
      case 'cower': {
        h.stateT -= dt;
        g.setDesired(h, 0, 0);
        const ty = Math.atan2(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
        if (h.state === 'handsup') h.yaw += Math.atan2(Math.sin(ty - h.yaw), Math.cos(ty - h.yaw)) * Math.min(1, dt * 5);
        if (h.stateT <= 0) {
          // then they run
          g.peds.scare(h, p.pos.x, p.pos.z, 8, true);
        }
        return true;
      }
      case 'phone': {
        h.stateT -= dt;
        g.setDesired(h, 0, 0);
        if (h.stateT <= 0) {
          h.clip = '';
          h.state = 'walk';
          if (g.wanted.level === 0 && !h.dead) {
            g.wanted.setLevel(1);
            g.hud.toast('A witness called the police');
          }
          return false;
        }
        return true;
      }
      case 'fight': {
        h.stateT -= dt;
        h.fireT -= dt;
        const dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z, d = Math.hypot(dx, dz) || 1;
        h.yaw = Math.atan2(dx, dz);
        const armed = p.weapon !== 'fist' && p.weapon !== 'bat';
        if (h.stateT <= 0 || p.vehicle || p.dead || armed || d > 25) {
          g.peds.scare(h, p.pos.x, p.pos.z, 8, true);
          return true;
        }
        if (d > 1.1) g.setDesired(h, (dx / d) * 4.2, (dz / d) * 4.2);
        else {
          g.setDesired(h, 0, 0);
          if (h.fireT <= 0) {
            h.fireT = 0.9 + Math.random() * 0.5;
            h.punchT = 0.38;
            g.audio.punch();
            const killed = p.hurt(9, h.pos.x, h.pos.z, 2);
            g.onHumanHurt(p, h, killed, 'punch');
          }
        }
        return true;
      }
    }
    return false;
  }
}

/** the arms for a reaction (the scanned person's pose): up for hands-up, a hand to the ear for a call */
export function reactionArms(h: Human): { r?: THREE.Vector3; l?: THREE.Vector3 } | null {
  const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
  const rx = -fz, rz = fx;
  if (h.state === 'handsup') return { r: new THREE.Vector3(fx * 0.15 - rx * 0.25, 1, fz * 0.15 - rz * 0.25).normalize(), l: new THREE.Vector3(fx * 0.15 + rx * 0.25, 1, fz * 0.15 + rz * 0.25).normalize() };
  if (h.state === 'phone') return { l: new THREE.Vector3(fx * 0.5 + rx * 0.35, 0.6, fz * 0.5 + rz * 0.35).normalize() };
  return null;
}
