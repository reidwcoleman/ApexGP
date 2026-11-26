// What people do when they aren't walking somewhere: knots of friends talking on the sidewalk,
// sunbathers on loungers and towels, swimmers in the surf, joggers along the sand, someone dancing
// to a speaker. They break up and run when trouble starts (the peds' flee takes over).
import * as THREE from 'three';
import { Human } from '../entities/humans';
import { BEACH, ISLAND, groundAt, isWater } from '../world/map';
import { placeFurniture } from '../world/furniture';
import type { Game } from './game';
import { PIER } from '../world/pier';

const TOWEL_COLS = [0xff6f61, 0x29b6c4, 0xffd23f, 0x7b6cff, 0xff8fc4, 0x5fd38a, 0xffffff];

export class Life {
  private t = 0;
  private towels: THREE.InstancedMesh;
  private towelSlots: { h: Human; x: number; z: number; r: number; c: THREE.Color }[] = [];
  private loungers: { x: number; z: number; r: number; used: Human | null }[];
  private readonly m4 = new THREE.Matrix4();
  /** seats on the city's benches (two each) and spots under the bus shelters */
  private seats: { x: number; z: number; yaw: number; used: Human | null }[] = [];
  private stops: { x: number; z: number; yaw: number; n: number }[] = [];
  private readonly q = new THREE.Quaternion();

  constructor(private game: Game) {
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
    for (const it of placeFurniture(game.map)) {
      if (it.kind !== 'bench' && it.kind !== 'shelter') continue;
      it.m.decompose(v, q, sc);
      const yaw = e.setFromQuaternion(q, 'YXZ').y;
      const at = (lx: number, lz: number) => ({ x: v.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z: v.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz });
      if (it.kind === 'bench') for (const lx of [-0.45, 0.45]) this.seats.push({ ...at(lx, -0.06), yaw, used: null });
      else {
        for (const lx of [-0.9, -0.1]) this.seats.push({ ...at(lx, -0.5), yaw, used: null });
        this.stops.push({ ...at(0.6, 0.35), yaw, n: 0 });
      }
    }
    this.loungers = game.map.props.filter((p) => p.kind === 'lounger').map((p) => ({ x: p.x, z: p.z, r: p.r, used: null }));
    const tg = new THREE.PlaneGeometry(0.9, 1.9);
    tg.rotateX(-Math.PI / 2);
    this.towels = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ roughness: 0.95 }), 40);
    this.towels.count = 0;
    this.towels.receiveShadow = true;
    this.towels.frustumCulled = false;
    game.scene.add(this.towels);
  }

  private count(state: string) {
    let n = 0;
    for (const h of this.game.npcs) if (h.kind === 'ped' && !h.dead && h.state === state) n++;
    return n;
  }

  private newPed(x: number, z: number, state: string, clip: string, t: number): Human {
    const h = new Human('ped');
    h.pos.set(x, groundAt(x, z), z);
    h.state = state;
    h.stateT = t;
    h.clip = clip;
    h.health = h.maxHealth = 60;
    this.game.addNpc(h);
    return h;
  }

  update(dt: number) {
    const g = this.game;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.6;
      const day = g.sky.day > 0.4;
      const f = g.focus;
      // talkers on the sidewalks
      for (let i = 0; i < 3 && this.count('chat') < (day ? 22 : 10); i++) this.spawnGroup(f);
      // people on benches and waiting for the bus
      for (let i = 0; i < 2 && this.count('bench') < (day ? 12 : 4); i++) this.spawnSitter(f);
      for (let i = 0; i < 2 && this.count('busstop') < (day ? 8 : 3); i++) this.spawnWaiter(f);
      // the beach (by day)
      const nearBeach = Math.abs(f.x - (BEACH.x0 + 60)) < 260;
      if (day && nearBeach) {
        for (let i = 0; i < 3; i++) {
          if (this.count('lounge') < 18) this.spawnLounger(f);
          if (this.count('towel') < 40) this.spawnTowel(f);
          if (this.count('swim') < 20) this.spawnSwimmer(f);
          if (this.count('beachchat') < 12) this.spawnBeachGroup(f);
        }
        if (this.count('jog') < 6) this.spawnJogger(f);
      }
      // the pier, day and evening
      if (Math.hypot(f.x - (PIER.x0 + PIER.x1) / 2, f.z - PIER.z) < 220) {
        if (this.count('pierwalk') < (day ? 10 : 6)) this.spawnPierWalker(f);
        if (this.count('rail') < (day ? 12 : 7)) this.spawnRail(f);
        if (this.count('dance') < 5 && Math.random() < 0.4) this.spawnDancers(f);
      }
    }
    // free loungers whose sunbather left; draw the towels of those still lying on them
    for (const l of this.loungers) if (l.used && (l.used.state !== 'lounge' || !g.npcs.includes(l.used))) l.used = null;
    this.towelSlots = this.towelSlots.filter((s) => g.npcs.includes(s.h));
    let k = 0;
    for (const s of this.towelSlots) {
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r);
      this.m4.compose(new THREE.Vector3(s.x, groundAt(s.x, s.z) + 0.02, s.z), this.q, new THREE.Vector3(1, 1, 1));
      this.towels.setMatrixAt(k, this.m4);
      this.towels.setColorAt(k, s.c);
      k++;
    }
    this.towels.count = k;
    this.towels.instanceMatrix.needsUpdate = true;
    if (this.towels.instanceColor) this.towels.instanceColor.needsUpdate = true;
  }

  /** a spot out of sight between 25 and 110 m from you */
  private ok(x: number, z: number, f: THREE.Vector3, min = 25, max = 110) {
    const d = Math.hypot(x - f.x, z - f.z);
    return d > min && d < max && !(d < 70 && this.game.inView(x, 1, z));
  }

  /** two or three people standing on the sand talking, toward the water's edge */
  private spawnBeachGroup(f: THREE.Vector3) {
    for (let a = 0; a < 8; a++) {
      const x = BEACH.x0 + 28 + Math.random() * 17, z = f.z + (Math.random() - 0.5) * 160;
      if (z < ISLAND.z0 + 20 || z > ISLAND.z1 - 20 || isWater(x, z) || !this.ok(x, z, f, 10, 120)) continue;
      const n = 2 + Math.floor(Math.random() * 2);
      const life = 40 + Math.random() * 60;
      for (let i = 0; i < n; i++) {
        const a2 = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const h = this.newPed(x + Math.cos(a2) * 0.7, z + Math.sin(a2) * 0.7, 'beachchat', i === 0 ? 'talk' : Math.random() < 0.5 ? 'listen' : 'talk', life);
        h.yaw = Math.atan2(x - h.pos.x, z - h.pos.z);
        h.target.set(x, 0, z);
      }
      return;
    }
  }

  private spawnGroup(f: THREE.Vector3) {
    const paths = this.game.peds.paths.filter((p) => !p.beach && Math.abs((p.x0 + p.x1) / 2 - f.x) < 150 && Math.abs((p.z0 + p.z1) / 2 - f.z) < 150);
    if (!paths.length) return;
    for (let a = 0; a < 10; a++) {
      const p = paths[Math.floor(Math.random() * paths.length)];
      const side = Math.floor(Math.random() * 4), t = 0.15 + Math.random() * 0.7;
      const x = side === 0 ? p.x0 : side === 1 ? p.x1 : p.x0 + (p.x1 - p.x0) * t;
      const z = side === 2 ? p.z0 : side === 3 ? p.z1 : p.z0 + (p.z1 - p.z0) * t;
      if (!this.ok(x, z, f)) continue;
      const n = 2 + Math.floor(Math.random() * 2);
      const life = 25 + Math.random() * 50;
      for (let i = 0; i < n; i++) {
        const a2 = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const h = this.newPed(x + Math.cos(a2) * 0.65, z + Math.sin(a2) * 0.65, 'chat', i === 0 ? 'talk' : Math.random() < 0.5 ? 'listen' : 'talk', life);
        h.yaw = Math.atan2(x - h.pos.x, z - h.pos.z);
        h.target.set(x, 0, z);
      }
      return;
    }
  }

  private spawnSitter(f: THREE.Vector3) {
    for (const s of this.seats) if (s.used && (s.used.state !== 'bench' || !this.game.npcs.includes(s.used))) s.used = null;
    const free = this.seats.filter((s) => !s.used && this.ok(s.x, s.z, f, 15, 110));
    if (!free.length) return;
    const s = free[Math.floor(Math.random() * free.length)];
    const h = this.newPed(s.x, s.z, 'bench', 'sit', 40 + Math.random() * 90);
    h.yaw = s.yaw;
    h.texting = Math.random() < 0.3;
    s.used = h;
  }

  private spawnWaiter(f: THREE.Vector3) {
    const free = this.stops.filter((s) => s.n < 2 && this.ok(s.x, s.z, f, 15, 110));
    if (!free.length) return;
    const s = free[Math.floor(Math.random() * free.length)];
    const h = this.newPed(s.x + (Math.random() - 0.5) * 1.2, s.z + (Math.random() - 0.5) * 0.6, 'busstop', 'idle', 60 + Math.random() * 60);
    h.yaw = s.yaw + (Math.random() - 0.5) * 0.8;
    h.target.set(s.x, 0, s.z);
    s.n++;
    (h as Human & { stop?: typeof s }).stop = s;
  }

  private spawnLounger(f: THREE.Vector3) {
    const free = this.loungers.filter((l) => !l.used && this.ok(l.x, l.z, f, 8, 140));
    if (!free.length) return;
    const l = free[Math.floor(Math.random() * free.length)];
    const h = this.newPed(l.x, l.z, 'lounge', 'sit', 60 + Math.random() * 120);
    // back to the backrest (at the lounger's -z end), feet down the seat
    h.yaw = l.r;
    h.shirt.setHSL(Math.random(), 0.5, 0.55);
    l.used = h;
  }

  private spawnTowel(f: THREE.Vector3) {
    for (let a = 0; a < 8; a++) {
      // dry sand only: the surf runs up from x 724
      const x = BEACH.x0 + 22 + Math.random() * 23, z = f.z + (Math.random() - 0.5) * 150;
      if (z < ISLAND.z0 + 20 || z > ISLAND.z1 - 20 || isWater(x, z) || !this.ok(x, z, f, 8, 120)) continue;
      const h = this.newPed(x, z, 'towel', 'idle', 60 + Math.random() * 120);
      h.yaw = Math.random() * Math.PI * 2;
      h.fall = 1;
      this.towelSlots.push({ h, x: x - Math.sin(h.yaw) * 0.7, z: z - Math.cos(h.yaw) * 0.7, r: h.yaw, c: new THREE.Color(TOWEL_COLS[Math.floor(Math.random() * TOWEL_COLS.length)]) });
      return;
    }
  }

  private spawnSwimmer(f: THREE.Vector3) {
    for (let a = 0; a < 8; a++) {
      const z = f.z + (Math.random() - 0.5) * 150;
      let x = BEACH.x0 + 70;
      while (!isWater(x, z) && x < BEACH.x1 + 60) x += 2;
      x += 3 + Math.random() * 18;
      if (z < ISLAND.z0 + 20 || z > ISLAND.z1 - 20 || !this.ok(x, z, f, 15, 150)) continue;
      const h = this.newPed(x, z, 'swim', 'idle', 80 + Math.random() * 80);
      h.target.set(x, 0, z);
      h.yaw = Math.random() * 6;
      return;
    }
  }

  /** strolling the pier: out to the end and back, then off along the beach */
  private spawnPierWalker(f: THREE.Vector3) {
    const x = PIER.x0 + 4 + Math.random() * (PIER.x1 - PIER.x0 - 4), z = PIER.z + (Math.random() - 0.5) * (PIER.w - 3);
    if (!this.ok(x, z, f, 25, 200)) return;
    const n = Math.random() < 0.35 ? 2 : 1;
    const dir = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const h = this.newPed(x + i * 0.3, z + i * 0.75, 'pierwalk', '', 60 + Math.random() * 120);
      h.dir = dir;
      h.target.set(0, 0, z + i * 0.75);
      h.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  /** leaning on the rail, looking at the water (some in twos, chatting) */
  private spawnRail(f: THREE.Vector3) {
    const end = Math.random() < 0.3;
    let x: number, z: number, yaw: number;
    if (end) {
      // round the end platform, looking out to sea or along it
      const side = Math.floor(Math.random() * 3);
      if (side === 0) (x = PIER.endX - 0.8), (z = PIER.z + (Math.random() - 0.5) * 26), (yaw = Math.PI / 2);
      else (x = PIER.x1 + 2 + Math.random() * 22), (z = PIER.z + (side === 1 ? 1 : -1) * (PIER.endHalf - 0.8)), (yaw = side === 1 ? 0 : Math.PI);
    } else {
      const s = Math.random() < 0.5 ? 1 : -1;
      x = PIER.x0 + 8 + Math.random() * (PIER.x1 - PIER.x0 - 12);
      z = PIER.z + s * (PIER.w / 2 - 0.75);
      yaw = s > 0 ? 0 : Math.PI;
    }
    if (!this.ok(x, z, f, 25, 200)) return;
    const pair = Math.random() < 0.4;
    for (let i = 0; i < (pair ? 2 : 1); i++) {
      const ox = Math.cos(yaw) * 0.75 * i, oz = -Math.sin(yaw) * 0.75 * i;
      const h = this.newPed(x + ox, z + oz, 'rail', pair ? 'talk' : 'idle', 40 + Math.random() * 100);
      // a pair turn a little toward each other
      h.yaw = yaw + (pair ? (i ? -0.5 : 0.5) : (Math.random() - 0.5) * 0.4);
      h.target.set(x + ox, 0, z + oz);
    }
  }

  private spawnJogger(f: THREE.Vector3) {
    const x = BEACH.x0 + 28 + Math.random() * 14;
    const z = f.z + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 60);
    if (z < ISLAND.z0 + 20 || z > ISLAND.z1 - 20 || !this.ok(x, z, f, 30, 140)) return;
    const h = this.newPed(x, z, 'jog', '', 120);
    h.dir = Math.random() < 0.5 ? 1 : -1;
    h.target.set(x, 0, z);
  }

  private spawnDancers(f: THREE.Vector3) {
    const x = BEACH.x0 + 50 + Math.random() * 30, z = f.z + (Math.random() - 0.5) * 160;
    if (isWater(x, z) || !this.ok(x, z, f, 20, 120)) return;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const h = this.newPed(x + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 3, 'dance', Math.random() < 0.7 ? 'dance' : 'cheer3', 40 + Math.random() * 40);
      h.yaw = Math.random() * 6;
    }
  }

  /** the peds' brain hands these states here; true when handled */
  think(h: Human, dt: number): boolean {
    const g = this.game;
    switch (h.state) {
      case 'wait':
        g.setDesired(h, 0, 0);
        if (h.injured) h.fall = 1;
        return true;
      case 'bench': {
        h.stateT -= dt;
        g.setDesired(h, 0, 0);
        if (h.stateT <= 0) {
          h.state = 'walk';
          h.clip = '';
          return false;
        }
        return true;
      }
      case 'busstop': {
        h.stateT -= dt;
        g.setDesired(h, 0, 0);
        const stop = (h as Human & { stop?: { n: number } }).stop;
        // a bus pulls in: on they get
        for (const v of g.vehicles) {
          if (v.type === 'bus' && v.speed < 0.8 && Math.hypot(v.pos.x - h.pos.x, v.pos.z - h.pos.z) < 9) {
            if (stop) stop.n = Math.max(0, stop.n - 1);
            g.removeNpc(h);
            return true;
          }
        }
        if (h.stateT <= 0) {
          if (stop) stop.n = Math.max(0, stop.n - 1);
          h.state = 'walk';
          h.clip = '';
          return false;
        }
        return true;
      }
      case 'chat':
      case 'beachchat':
      case 'lounge':
      case 'towel':
      case 'dance': {
        h.stateT -= dt;
        g.setDesired(h, 0, 0);
        if (h.state === 'chat' || h.state === 'beachchat') {
          const ty = Math.atan2(h.target.x - h.pos.x, h.target.z - h.pos.z);
          h.yaw += Math.atan2(Math.sin(ty - h.yaw), Math.cos(ty - h.yaw)) * Math.min(1, dt * 4);
          // the talker changes now and then
          if (Math.random() < dt * 0.15) h.clip = h.clip === 'talk' ? 'listen' : 'talk';
        }
        if (h.state === 'towel') h.fall = 1;
        if (h.stateT <= 0) {
          h.state = 'walk';
          h.clip = '';
          h.fall = 0;
          return false;
        }
        return true;
      }
      case 'swim': {
        h.stateT -= dt;
        h.swimming = true;
        // drift about the spot, bobbing
        const a = g.elapsed * 0.3 + h.id;
        const tx = h.target.x + Math.cos(a) * 3, tz = h.target.z + Math.sin(a * 0.7) * 3;
        const dx = tx - h.pos.x, dz = tz - h.pos.z, d = Math.hypot(dx, dz) || 1;
        g.setDesired(h, (dx / d) * Math.min(1, d) * 0.8, (dz / d) * Math.min(1, d) * 0.8);
        if (h.stateT <= 0) g.removeNpc(h);
        return true;
      }
      case 'pierwalk': {
        h.stateT -= dt;
        const xEnd = h.dir > 0 ? PIER.x1 + 18 : PIER.x0 + 2;
        if (h.dir > 0 && h.pos.x > xEnd) h.dir = -1;
        // done strolling: off the landward end and back to the streets
        if (h.dir < 0 && h.pos.x < xEnd) {
          if (h.stateT <= 0) {
            h.state = 'walk';
            return false;
          }
          h.dir = 1;
        }
        g.setDesired(h, h.dir * 1.25, (h.target.z - h.pos.z) * 0.6);
        return true;
      }
      case 'rail': {
        h.stateT -= dt;
        g.setDesired(h, 0, 0);
        if (h.stateT <= 0) {
          h.state = 'pierwalk';
          h.clip = '';
          h.dir = -1;
          h.target.z = PIER.z + (Math.random() - 0.5) * (PIER.w - 4);
          h.stateT = 0;
        }
        return true;
      }
      case 'jog': {
        h.stateT -= dt;
        const zEnd = h.dir > 0 ? ISLAND.z1 - 30 : ISLAND.z0 + 30;
        if (Math.abs(h.pos.z - zEnd) < 3) h.dir = -h.dir;
        const dx = h.target.x - h.pos.x;
        g.setDesired(h, dx * 0.5, h.dir * 3.4);
        if (h.stateT <= 0) {
          h.state = 'walk';
          return false;
        }
        return true;
      }
    }
    return false;
  }
}
