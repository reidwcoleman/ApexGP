// Pedestrians walking the sidewalks around blocks, crossing streets and fleeing from danger.
import { Human } from '../entities/humans';
import { pick } from '../core/math';
import { BEACH, ISLAND, groundAt, isWater, type Block } from '../world/map';
import type { Game } from './game';

interface Path {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  beach: boolean;
}

export class Peds {
  paths: Path[] = [];
  spawnT = 0;

  constructor(private game: Game) {
    for (const b of game.map.blocks) if (b.walk) this.paths.push(this.pathOf(b));
    this.paths.push({ x0: BEACH.x0 + 10, z0: ISLAND.z0 + 30, x1: BEACH.x0 + 46, z1: ISLAND.z1 - 30, beach: true });
  }

  private pathOf(b: Block): Path {
    return { x0: b.x0 + 2, z0: b.z0 + 2, x1: b.x1 - 2, z1: b.z1 - 2, beach: false };
  }

  private corner(p: Path, i: number): [number, number] {
    switch (((i % 4) + 4) % 4) {
      case 0: return [p.x0, p.z0];
      case 1: return [p.x1, p.z0];
      case 2: return [p.x1, p.z1];
      default: return [p.x0, p.z1];
    }
  }

  get count() {
    let n = 0;
    for (const h of this.game.npcs) if (h.kind === 'ped' && !h.dead) n++;
    return n;
  }

  spawn(minD: number, maxD: number): Human | null {
    const g = this.game;
    const p = g.focus;
    for (let a = 0; a < 16; a++) {
      const pi = Math.floor(Math.random() * this.paths.length);
      const path = this.paths[pi];
      const cx = (path.x0 + path.x1) / 2, cz = (path.z0 + path.z1) / 2;
      if (Math.abs(cx - p.x) > maxD + 200 || Math.abs(cz - p.z) > maxD + 700) continue;
      const side = Math.floor(Math.random() * 4);
      const [ax, az] = this.corner(path, side), [bx, bz] = this.corner(path, side + 1);
      const t = Math.random();
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < minD || d > maxD) continue;
      if (d < 90 && g.inView(x, 1, z)) continue;
      const h = new Human('ped');
      h.pos.set(x, groundAt(x, z), z);
      h.blockId = pi;
      h.dir = Math.random() < 0.5 ? 1 : -1;
      h.corner = h.dir > 0 ? side + 1 : side;
      h.state = 'walk';
      h.health = h.maxHealth = 60;
      g.addNpc(h);
      return h;
    }
    return null;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.focus;
    // despawn
    for (let i = g.npcs.length - 1; i >= 0; i--) {
      const h = g.npcs[i];
      if (h.kind !== 'ped' && !(h.kind === 'cop' && g.wanted.level === 0)) continue;
      const d = Math.hypot(h.pos.x - p.x, h.pos.z - p.z);
      if ((d > 170 && !g.inView(h.pos.x, h.pos.y + 1, h.pos.z)) || d > 260 || (h.dead && h.deadT > 40)) g.removeNpc(h);
    }
    const target = g.sky.night > 0.6 ? 28 : 58;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.count < target) {
      this.spawnT = g.settled ? 0.05 : 0;
      this.spawn(g.settled ? 55 : 6, 140);
    }
    for (const h of g.npcs) if (h.kind === 'ped') this.think(h, dt);
  }

  /** React to danger at (x,z). */
  scare(h: Human, x: number, z: number, t = 8) {
    if (h.dead || h.kind !== 'ped') return;
    h.state = 'flee';
    h.clip = '';
    h.swimming = false;
    h.stateT = t + Math.random() * 4;
    h.fleeFrom.set(x, 0, z);
  }

  private think(h: Human, dt: number) {
    const g = this.game;
    if (h.dead) {
      h.deadT += dt;
      g.setDesired(h, 0, 0);
      return;
    }
    if (h.down > 0) {
      h.down -= dt;
      g.setDesired(h, 0, 0);
      if (h.down <= 0 && h.state !== 'flee') this.scare(h, h.pos.x - Math.sin(h.yaw), h.pos.z - Math.cos(h.yaw));
      return;
    }
    if (g.life.think(h, dt)) return;
    if (h.clip && h.state !== 'flee') h.clip = '';
    if (h.state === 'flee') {
      h.stateT -= dt;
      let dx = h.pos.x - h.fleeFrom.x, dz = h.pos.z - h.fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      // wobble so they don't all run in straight lines
      const w = Math.sin(g.elapsed * 1.3 + h.id) * 0.5;
      let vx = dx * Math.cos(w) - dz * Math.sin(w), vz = dx * Math.sin(w) + dz * Math.cos(w);
      if (isWater(h.pos.x + vx * 4, h.pos.z + vz * 4)) {
        const t = vx;
        vx = -vz;
        vz = t;
      }
      const sp = 5.4;
      g.setDesired(h, vx * sp, vz * sp);
      if (h.stateT <= 0) this.rejoin(h);
      return;
    }
    // walking around a block
    const path = this.paths[h.blockId];
    if (!path) {
      this.rejoin(h);
      return;
    }
    const [tx, tz] = h.state === 'cross' ? [h.target.x, h.target.z] : this.corner(path, h.corner);
    const dx = tx - h.pos.x, dz = tz - h.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) {
      if (h.state === 'cross') {
        h.state = 'walk';
        h.blockId = h.target.y;
        h.corner = this.nearestCorner(this.paths[h.blockId], h.pos.x, h.pos.z);
        h.corner += h.dir;
      } else if (!path.beach && Math.random() < 0.3) {
        // cross the street to a neighbouring block
        const opts: [number, number][] = [];
        for (const [ox, oz] of [[16, 0], [-16, 0], [0, 16], [0, -16]] as [number, number][]) {
          const nx = tx + ox, nz = tz + oz;
          const bi = this.pathAt(nx, nz);
          if (bi >= 0 && bi !== h.blockId) opts.push([bi, 0]);
        }
        if (opts.length) {
          const [bi] = pick(opts);
          const np = this.paths[bi];
          const c = this.nearestCorner(np, tx, tz);
          const [cx, cz] = this.corner(np, c);
          h.target.set(cx, bi, cz);
          h.state = 'cross';
        } else h.corner += h.dir;
      } else h.corner += h.dir;
      return;
    }
    const sp = h.state === 'cross' ? 1.9 : 1.35 + (h.id % 5) * 0.06;
    g.setDesired(h, (dx / d) * sp, (dz / d) * sp);
  }

  private pathAt(x: number, z: number): number {
    for (let i = 0; i < this.paths.length; i++) {
      const p = this.paths[i];
      if (x >= p.x0 - 1 && x <= p.x1 + 1 && z >= p.z0 - 1 && z <= p.z1 + 1) return i;
    }
    return -1;
  }

  private nearestCorner(p: Path, x: number, z: number): number {
    let best = 0, bd = 1e9;
    for (let i = 0; i < 4; i++) {
      const [cx, cz] = this.corner(p, i);
      const d = Math.hypot(cx - x, cz - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private rejoin(h: Human) {
    // walk to the nearest sidewalk loop
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.paths.length; i++) {
      const p = this.paths[i];
      const cx = Math.max(p.x0, Math.min(p.x1, h.pos.x)), cz = Math.max(p.z0, Math.min(p.z1, h.pos.z));
      const d = Math.hypot(cx - h.pos.x, cz - h.pos.z);
      if (d < bd) { bd = d; best = i; }
    }
    h.blockId = best;
    h.state = 'walk';
    if (best >= 0) h.corner = this.nearestCorner(this.paths[best], h.pos.x, h.pos.z);
  }
}
