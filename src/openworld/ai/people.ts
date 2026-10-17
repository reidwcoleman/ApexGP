import * as THREE from 'three';
import { loadPeople, setPeopleCore, type PeopleKit } from '../../people/Humans.ts';
import { Extras, type ExtraSpec } from '../../people/Extras.ts';
import { signalState, type Network, type REdge } from '../roads.ts';
import type { CollisionWorld, Contact } from '../sim/collide.ts';
import { rng } from '../city/build.ts';
import { BEACH_OCEAN_SHORE, ll } from '../geo.ts';
import { BEACH_W } from '../city/ground.ts';
import { makeSurf } from '../roads.ts';

/**
 * Miami on foot: the people on the sidewalks, the beach and the plazas, and the player when out
 * of a vehicle. They are the race game's Rocketbox avatars (instanced and baked through
 * people/Extras.ts), in street clothes dyed in Miami colours.
 *
 * Walkers follow the sidewalks block to block, turn the corners, cross at the crosswalks when the
 * cars on that street have the red; some stand about (a phone, a chat). A fast car coming at them
 * makes them run; one that hits them knocks them flat — they lie a moment, get up and run.
 */

export const ACT = { IDLE: 0, WALK: 1, RUN: 2, PHONE: 3, TALK: 4, LOOK: 5, SIT: 6, WAVE: 7 } as const;
const CLIPS = ['idle', 'walk', 'run', 'phone', 'talk', 'look_around', 'sit', 'wave'];
const BODIES_M = ['Male_Adult_01', 'Male_Adult_05', 'Male_Adult_08', 'Male_Adult_14', 'Male_Adult_07', 'Male_Adult_10', 'Sports_Male_02'];
const BODIES_F = ['Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'];
const PLAYER_BODY = 'Male_Adult_10';
const SHIRTS = [0xffffff, 0xf3f0e6, 0x57e8ff, 0xff3f8e, 0xffb547, 0x2a6fdb, 0x1e1e22, 0x7fd18b, 0xe8d3b0, 0xc93a3a, 0x8a5ad6, 0x3ab0a0, 0xf28cb1, 0x0f2a52];

type PState = 'walk' | 'stand' | 'cross' | 'flee' | 'down' | 'off';

interface Ped {
  m: number;
  state: PState;
  e: number;
  side: 1 | -1;
  s: number;
  dir: 1 | -1;
  lat: number;
  speed: number;
  pos: THREE.Vector3;
  yaw: number;
  t: number;
  vel: THREE.Vector3;
  tilt: number;
  /** crossing: from → to */
  cx0: THREE.Vector3;
  cx1: THREE.Vector3;
  beach: boolean;
}

export interface PlayerFoot {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  vy: number;
  onGround: boolean;
}

export class People {
  kit: PeopleKit | null = null;
  extras: Extras | null = null;
  readonly group = new THREE.Group();
  private peds: Ped[] = [];
  private R = rng(31337);
  target = 150;
  /** members: 0 is the player */
  private nMembers = 190;
  readonly player: PlayerFoot = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, vy: 0, onGround: true };
  playerVisible = false;
  private playerAct: number = ACT.IDLE;
  /** pedestrians struck this frame (for the wanted level) */
  readonly struck: THREE.Vector3[] = [];
  /** people on the crosswalks (for the traffic to stop for) */
  readonly crossing: THREE.Vector3[] = [];
  private surf = makeSurf();
  private contacts: Contact[] = [];
  private t = 0;
  ready = false;

  constructor(
    private readonly net: Network,
    private readonly world: CollisionWorld,
  ) {
    this.group.name = 'People';
    setPeopleCore([PLAYER_BODY, ...BODIES_M.filter((b) => b !== PLAYER_BODY), ...BODIES_F]);
  }

  /** start loading the avatars (resolves when the people are on the streets) */
  async load() {
    const kit = await loadPeople();
    this.kit = kit;
    const specs: ExtraSpec[] = [];
    const R = this.R;
    const bodies = [...BODIES_M, ...BODIES_F].filter((b) => kit.avatars.has(b));
    for (let i = 0; i < this.nMembers; i++) {
      const body = i === 0 ? PLAYER_BODY : bodies[Math.floor(R() * bodies.length)];
      specs.push({
        body,
        x: 0,
        y: -500,
        z: 0,
        yaw: 0,
        act: ACT.WALK,
        tint: i === 0 ? 0xf2f2f2 : SHIRTS[Math.floor(R() * SHIRTS.length)],
        tintAmount: i === 0 ? 0.0 : 0.75,
        cap: i > 0 && R() < 0.16 ? SHIRTS[Math.floor(R() * SHIRTS.length)] : null,
        prop: i > 0 && R() < 0.18 ? 'phone' : null,
        pace: 0.9 + R() * 0.25,
        scale: 0.94 + R() * 0.1,
        phase: R(),
      });
    }
    this.extras = new Extras(kit, specs, { name: 'miami_people', near: 30, far: 260, propFar: 40, shadows: true, bake: { key: 'miami', names: [PLAYER_BODY, ...bodies], clips: CLIPS } });
    this.group.add(this.extras.group);
    for (let i = 1; i < this.nMembers; i++) {
      this.peds.push({
        m: i, state: 'off', e: 0, side: 1, s: 0, dir: 1, lat: 0, speed: 1.3, pos: new THREE.Vector3(0, -500, 0), yaw: 0, t: 0, vel: new THREE.Vector3(), tilt: 0,
        cx0: new THREE.Vector3(), cx1: new THREE.Vector3(), beach: false,
      });
      this.extras.setVisible(i, false);
    }
    this.extras.setVisible(0, false);
    this.ready = true;
  }

  // ---------------------------------------------------------------- the walkers

  private walkLat(e: REdge, side: number, jitter: number) {
    return side * (e.hw + e.spec.sidewalk * (0.5 + jitter));
  }

  private spawn(p: Ped, center: THREE.Vector3, minD: number, maxD: number): boolean {
    const R = this.R;
    // a tenth of them on the beach (South Beach), the rest on the sidewalks
    const nearBeach = center.x > 5600;
    if (nearBeach && R() < 0.35) {
      const i = Math.floor(R() * (BEACH_OCEAN_SHORE.length - 1));
      const a = BEACH_OCEAN_SHORE[i], b = BEACH_OCEAN_SHORE[i + 1];
      const t = R();
      const z = a.z + (b.z - a.z) * t;
      const x = a.x + (b.x - a.x) * t - 6 - R() * (BEACH_W - 20);
      const d = Math.hypot(x - center.x, z - center.z);
      if (d < minD || d > maxD) return false;
      p.beach = true;
      p.state = R() < 0.55 ? 'stand' : 'walk';
      p.pos.set(x, 0.12, z);
      p.yaw = R() * Math.PI * 2;
      p.speed = 1.1 + R() * 0.4;
      p.t = 5 + R() * 20;
      this.show(p, p.state === 'stand' ? (R() < 0.5 ? ACT.TALK : R() < 0.5 ? ACT.PHONE : ACT.LOOK) : ACT.WALK);
      return true;
    }
    const ang = R() * Math.PI * 2;
    const dd = minD + R() * (maxD - minD);
    const px = center.x + Math.cos(ang) * dd, pz = center.z + Math.sin(ang) * dd;
    const near = this.net.near(px, pz);
    if (!near.length) return false;
    const e = this.net.edges[near[Math.floor(R() * near.length)]];
    if (e.spec.sidewalk < 2 || e.elevated || e.water.some((w) => w)) return false;
    const s0 = e.walkA + 1, s1 = e.len - e.walkB - 1;
    if (s1 - s0 < 6) return false;
    p.beach = false;
    p.e = e.id;
    p.side = R() < 0.5 ? 1 : -1;
    p.s = s0 + R() * (s1 - s0);
    p.dir = R() < 0.5 ? 1 : -1;
    p.lat = this.walkLat(e, p.side, (R() - 0.5) * 0.5);
    p.speed = 1.15 + R() * 0.45;
    const busy = e.kind === 'ocean' || e.kind === 'boulevard' ? 0.35 : 0.18;
    p.state = R() < busy ? 'stand' : 'walk';
    p.t = 6 + R() * 25;
    this.net.point(e, p.s, p.lat, TP);
    p.pos.set(TP.x, TP.y + 0.15, TP.z);
    p.yaw = Math.atan2(TP.tx * p.dir, TP.tz * p.dir);
    if (p.state === 'stand') {
      // facing the street or a friend
      p.yaw += (R() - 0.5) * 2.5;
      this.show(p, R() < 0.4 ? ACT.PHONE : R() < 0.6 ? ACT.TALK : ACT.IDLE);
    } else this.show(p, ACT.WALK);
    return true;
  }

  private show(p: Ped, act: number) {
    const ex = this.extras!;
    ex.setVisible(p.m, true);
    ex.setAct(p.m, act);
  }

  private hide(p: Ped) {
    p.state = 'off';
    this.extras!.setVisible(p.m, false);
    this.extras!.setTilt(p.m, 0);
    p.tilt = 0;
  }

  /** at the end of a block: round the corner, back along, or across the street */
  private corner(p: Ped, t: number) {
    const net = this.net;
    const e = net.edges[p.e];
    const nodeId = p.dir > 0 ? e.b : e.a;
    const node = net.nodes[nodeId];
    const R = this.R;
    const r = R();
    const others = node.edges.filter((id) => id !== e.id && net.edges[id].spec.sidewalk >= 2 && !net.edges[id].elevated);
    if (!others.length || r < 0.18) {
      p.dir = -p.dir as 1 | -1;
      return;
    }
    const f = net.edges[others[Math.floor(R() * others.length)]];
    const fFromHere = f.a === nodeId;
    // cross street f? only when its cars are held by a red (or there are none)
    if (r > 0.72 && node.signal >= 0) {
      const sig = net.signals[node.signal];
      const st = signalState(sig, sig.group[node.edges.indexOf(f.id)], t);
      if (st === 2) {
        const sAt = fFromHere ? f.trimA + 2.6 : f.len - f.trimB - 2.6;
        net.point(f, sAt, this.walkLat(f, 1, 0) * 0.98, TP);
        p.cx0.set(TP.x, TP.y + 0.15, TP.z);
        net.point(f, sAt, -this.walkLat(f, 1, 0) * 0.98, TP);
        p.cx1.set(TP.x, TP.y + 0.15, TP.z);
        // start from the nearer end
        if (p.cx0.distanceToSquared(p.pos) > p.cx1.distanceToSquared(p.pos)) {
          const tmp = p.cx0.clone();
          p.cx0.copy(p.cx1);
          p.cx1.copy(tmp);
        }
        p.state = 'cross';
        p.t = 0;
        // afterwards it walks on along f, on the far side
        p.e = f.id;
        p.side = (this.sideOf(f, p.cx1) as 1 | -1) || 1;
        p.dir = fFromHere ? 1 : -1;
        p.s = fFromHere ? f.walkA + 1 : f.len - f.walkB - 1;
        return;
      }
    }
    // round the corner onto f's sidewalk on our side
    p.e = f.id;
    p.dir = fFromHere ? 1 : -1;
    p.s = fFromHere ? f.walkA + 0.5 : f.len - f.walkB - 0.5;
    p.side = (this.sideOf(f, p.pos) as 1 | -1) || 1;
    p.lat = this.walkLat(f, p.side, (R() - 0.5) * 0.5);
  }

  private sideOf(e: REdge, q: THREE.Vector3): number {
    const pr = this.net.project(e, q.x, q.z, PR);
    return pr ? Math.sign(pr.lat) : 1;
  }

  update(dt: number, t: number, center: THREE.Vector3, camera: THREE.Camera, vehicles: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; hl: number; hw: number }[], panic: number) {
    if (!this.extras) return;
    this.t = t;
    this.struck.length = 0;
    this.crossing.length = 0;
    const net = this.net;
    const ex = this.extras;
    let live = 0;
    for (const p of this.peds) {
      if (p.state === 'off') continue;
      if (Math.hypot(p.pos.x - center.x, p.pos.z - center.z) > 300) this.hide(p);
      else live++;
    }
    for (let k = 0, made = 0; k < this.peds.length && live < this.target && made < 8; k++) {
      const p = this.peds[k];
      if (p.state !== 'off') continue;
      if (this.spawn(p, center, live < this.target * 0.4 ? 30 : 120, 260)) {
        live++;
        made++;
      }
    }
    const fleeFrom = (p: Ped, from: THREE.Vector3) => {
      p.state = 'flee';
      p.t = 3 + this.R() * 3;
      const a = Math.atan2(p.pos.x - from.x, p.pos.z - from.z) + (this.R() - 0.5) * 0.8;
      p.yaw = a;
      ex.setAct(p.m, ACT.RUN);
    };
    for (const p of this.peds) {
      if (p.state === 'off') continue;
      p.t -= dt;
      // ---- danger: a vehicle bearing down, or one hitting
      for (const v of vehicles) {
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 400 || Math.abs(p.pos.y - v.pos.y) > 2.5) continue;
        const sp = Math.hypot(v.vel.x, v.vel.z);
        const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
        const along = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
        // inside the box: struck
        if (p.state !== 'down' && Math.abs(along) < v.hl + 0.3 && lat < v.hw + 0.3 && sp > 2.2) {
          p.state = 'down';
          p.t = 4 + this.R() * 2;
          p.vel.set(v.vel.x * 0.75 + (this.R() - 0.5) * 2, Math.min(7, 2 + sp * 0.18), v.vel.z * 0.75 + (this.R() - 0.5) * 2);
          ex.setAct(p.m, ACT.IDLE);
          this.struck.push(p.pos.clone());
          continue;
        }
        if ((p.state === 'walk' || p.state === 'stand' || p.state === 'cross') && sp > 7 && along < -2 && along > -sp * 1.6 && lat < v.hw + 2.2) fleeFrom(p, v.pos);
      }
      if (panic > 0 && p.state !== 'down' && p.state !== 'flee' && this.R() < panic * dt * 0.4) fleeFrom(p, center);
      // ---- move
      if (p.state === 'walk' && !p.beach) {
        const e = net.edges[p.e];
        p.s += p.dir * p.speed * dt;
        const s0 = e.walkA + 0.3, s1 = e.len - e.walkB - 0.3;
        if (p.s > s1 || p.s < s0) {
          p.s = THREE.MathUtils.clamp(p.s, s0, s1);
          this.corner(p, t);
          if ((p.state as string) === 'cross') continue;
        }
        const e2 = net.edges[p.e];
        net.point(e2, p.s, p.lat, TP);
        const ty = Math.atan2(TP.tx * p.dir, TP.tz * p.dir);
        p.yaw += Math.atan2(Math.sin(ty - p.yaw), Math.cos(ty - p.yaw)) * Math.min(1, dt * 6);
        p.pos.set(TP.x, TP.y + 0.15, TP.z);
        if (p.t < 0) {
          p.t = 10 + this.R() * 30;
          if (this.R() < 0.25) {
            p.state = 'stand';
            p.t = 3 + this.R() * 8;
            ex.setAct(p.m, this.R() < 0.5 ? ACT.PHONE : ACT.LOOK);
          }
        }
      } else if (p.state === 'walk' && p.beach) {
        p.pos.x += Math.sin(p.yaw) * p.speed * dt;
        p.pos.z += Math.cos(p.yaw) * p.speed * dt;
        if (p.t < 0 || !net.mask.land(p.pos.x + Math.sin(p.yaw) * 3, p.pos.z + Math.cos(p.yaw) * 3)) {
          p.yaw += Math.PI * (0.6 + this.R() * 0.8);
          p.t = 8 + this.R() * 20;
        }
      } else if (p.state === 'stand') {
        if (p.t < 0) {
          p.state = 'walk';
          p.t = 10 + this.R() * 30;
          ex.setAct(p.m, ACT.WALK);
        }
      } else if (p.state === 'cross') {
        const L = p.cx0.distanceTo(p.cx1);
        p.t += dt;
        const k = Math.min(1, (p.t * p.speed * 1.15) / Math.max(L, 0.1));
        p.pos.lerpVectors(p.cx0, p.cx1, k);
        p.yaw = Math.atan2(p.cx1.x - p.cx0.x, p.cx1.z - p.cx0.z);
        this.crossing.push(p.pos);
        if (k >= 1) {
          const e = net.edges[p.e];
          p.lat = this.walkLat(e, p.side, (this.R() - 0.5) * 0.5);
          p.state = 'walk';
          p.t = 10 + this.R() * 20;
        }
      } else if (p.state === 'flee') {
        const sp = 4.6;
        const nx = p.pos.x + Math.sin(p.yaw) * sp * dt, nz = p.pos.z + Math.cos(p.yaw) * sp * dt;
        if (net.mask.land(nx, nz)) {
          p.pos.x = nx;
          p.pos.z = nz;
        } else p.yaw += Math.PI * 0.7;
        p.pos.y = net.surface(p.pos.x, p.pos.z, p.pos.y + 0.5, this.surf).y;
        this.pushOut(p.pos, 0.3);
        if (p.t < 0) {
          // calm down: rejoin the nearest sidewalk
          const hit = net.nearestEdge(p.pos.x, p.pos.z, p.pos.y, 30);
          if (hit && hit.e.spec.sidewalk >= 2 && !hit.e.elevated) {
            p.e = hit.e.id;
            p.side = (Math.sign(hit.pr.lat) || 1) as 1 | -1;
            p.lat = this.walkLat(hit.e, p.side, 0);
            p.s = THREE.MathUtils.clamp(hit.pr.s, hit.e.walkA + 0.5, hit.e.len - hit.e.walkB - 0.5);
            p.state = 'walk';
            ex.setAct(p.m, ACT.WALK);
          } else this.hide(p);
        }
      } else if (p.state === 'down') {
        // thrown, then lying flat, then up and running
        p.vel.y -= 9.81 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const gy = net.surface(p.pos.x, p.pos.z, p.pos.y + 0.5, this.surf).y;
        if (p.pos.y < gy) {
          p.pos.y = gy;
          p.vel.multiplyScalar(0.4);
          p.vel.y = 0;
        }
        this.pushOut(p.pos, 0.3);
        const lying = p.t > 1.2;
        p.tilt += ((lying ? -Math.PI / 2 : 0) - p.tilt) * Math.min(1, dt * (lying ? 9 : 3));
        ex.setTilt(p.m, p.tilt);
        if (p.t < 0) {
          ex.setTilt(p.m, 0);
          p.tilt = 0;
          fleeFrom(p, center);
        }
      }
      ex.setPlace(p.m, p.pos.x, p.pos.y + (p.state === 'down' && p.tilt < -0.5 ? 0.15 : 0), p.pos.z, p.yaw);
    }
    // the player avatar
    if (this.playerVisible) {
      const P = this.player;
      ex.setVisible(0, true);
      ex.setAct(0, this.playerAct);
      ex.setPlace(0, P.pos.x, P.pos.y, P.pos.z, P.yaw);
    } else ex.setVisible(0, false);
    ex.update(t, camera);
  }

  private pushOut(p: THREE.Vector3, r: number) {
    for (const c of this.world.circleContacts(p.x, p.z, r, p.y + 0.9, this.contacts)) {
      p.x += c.nx * c.depth;
      p.z += c.nz * c.depth;
    }
  }

  /** the player on foot: camera-relative WASD, Shift runs, Space jumps */
  movePlayer(dt: number, moveX: number, moveY: number, run: boolean, jump: boolean, camYaw: number) {
    const P = this.player;
    const net = this.net;
    const len = Math.hypot(moveX, moveY);
    const speed = run ? 5.6 : 1.75;
    let tx = 0, tz = 0;
    if (len > 0.1) {
      // forward = away from the camera
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      const rx = -fz, rz = fx;
      tx = (fx * moveY + rx * -moveX) / Math.max(1, len);
      tz = (fz * moveY + rz * -moveX) / Math.max(1, len);
      const ty = Math.atan2(tx, tz);
      P.yaw += Math.atan2(Math.sin(ty - P.yaw), Math.cos(ty - P.yaw)) * Math.min(1, dt * 10);
    }
    const k = Math.min(1, dt * 8);
    P.vel.x += (tx * speed - P.vel.x) * k;
    P.vel.z += (tz * speed - P.vel.z) * k;
    const nx = P.pos.x + P.vel.x * dt, nz = P.pos.z + P.vel.z * dt;
    const s = net.surface(nx, nz, P.pos.y + 0.6, this.surf);
    if (!s.water) {
      P.pos.x = nx;
      P.pos.z = nz;
    } else {
      P.vel.x = P.vel.z = 0;
    }
    // ground (and the roofs, for a Rocket pilot who parks up top)
    let gy = s.water ? P.pos.y : s.y;
    const roof = this.roofAt(P.pos.x, P.pos.z, P.pos.y);
    if (roof > gy) gy = roof;
    if (jump && P.onGround) {
      P.vy = 4.6;
      P.onGround = false;
    }
    P.vy -= 9.81 * dt;
    P.pos.y += P.vy * dt;
    if (P.pos.y <= gy) {
      // a step up of a curb is fine, a wall isn't (the collision pushes)
      P.pos.y = gy;
      P.vy = 0;
      P.onGround = true;
    } else if (P.pos.y > gy + 0.05) P.onGround = false;
    this.pushOut(P.pos, 0.35);
    const sp = Math.hypot(P.vel.x, P.vel.z);
    this.playerAct = !P.onGround ? ACT.IDLE : sp > 3 ? ACT.RUN : sp > 0.4 ? ACT.WALK : ACT.IDLE;
  }

  private nearS: import('../sim/collide.ts').Solid[] = [];
  private roofAt(x: number, z: number, y: number): number {
    let best = -Infinity;
    for (const s of this.world.query(x, z, 1, this.nearS)) {
      if (s.circle !== undefined || s.y1 > y + 0.6 || s.kind !== 'building') continue;
      let inside = false;
      const P = s.poly;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i], b = P[j];
        if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      if (inside) best = Math.max(best, s.y1);
    }
    return best;
  }

  /** a frightened driver jumps out of a car the player takes */
  ejectDriver(pos: THREE.Vector3, from: THREE.Vector3) {
    const p = this.peds.find((q) => q.state === 'off');
    if (!p) return;
    p.pos.copy(pos);
    p.beach = false;
    this.show(p, ACT.RUN);
    p.state = 'flee';
    p.t = 5;
    p.yaw = Math.atan2(pos.x - from.x, pos.z - from.z);
  }
}

const TP = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
const PR = { s: 0, lat: 0, y: 0, tx: 0, tz: 0, off: false, i: 0, t: 0 };
void ll;
