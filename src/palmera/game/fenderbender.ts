// Fender benders: now and then, somewhere down the road out of sight, one car has run into the back of
// another. Both sit in the lane with their hazards going - a crumpled tail, a crumpled nose and a
// bumper hanging off - while the two drivers have it out on the sidewalk, and the traffic edges round.
// After a couple of minutes they've swapped details and the cars are just cars again.
import * as THREE from 'three';
import { Human } from '../entities/humans';
import { Vehicle } from '../entities/vehicle';
import { groundAt, ROAD_HALF } from '../world/map';
import type { CarType } from '../entities/carModels';
import type { Game } from './game';

const TYPES: CarType[] = ['sedan', 'sedan', 'taxi', 'suv', 'pickup', 'van', 'sports'];

interface Scene {
  cars: Vehicle[];
  drivers: Human[];
  t: number;
  debris: THREE.InstancedMesh;
}

const SHARDS = 26;
const shardGeo = new THREE.CircleGeometry(0.05, 3).rotateX(-Math.PI / 2);
const shardMat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide });

export class FenderBenders {
  scene: Scene | null = null;
  t = 90 + Math.random() * 90;

  constructor(private game: Game) {}

  update(dt: number) {
    const g = this.game;
    const s = this.scene;
    if (s) {
      s.t -= dt;
      const f = g.focus;
      const far = s.cars.every((c) => Math.hypot(c.pos.x - f.x, c.pos.z - f.z) > 260);
      // someone drove off in one, or it's over
      if (s.t <= 0 || far || s.cars.some((c) => c.driver === 'player' || c.wrecked || !g.vehicles.includes(c))) this.end();
      return;
    }
    this.t -= dt;
    if (this.t > 0) return;
    const p = g.player;
    const free = !g.missions.active && g.wanted.level === 0 && !p.dead && !g.interiors.inside && !g.chopper.camera();
    if (!free || !this.stage()) this.t = 20;
  }

  private end() {
    const s = this.scene!;
    for (const c of s.cars) {
      c.persistent = false;
      c.hazard = false;
    }
    for (const h of s.drivers) {
      if (h.state === 'chat') h.stateT = Math.min(h.stateT, 2);
      h.texting = false;
    }
    this.game.scene.remove(s.debris);
    s.debris.dispose();
    this.scene = null;
    this.t = 160 + Math.random() * 140;
  }

  /** two cars nose to tail in a lane 50-140 m off, out of view */
  private stage(): boolean {
    const g = this.game;
    const map = g.map;
    const f = g.focus;
    const near = map.nodes.filter((n) => {
      const d = Math.hypot(n.x - f.x, n.z - f.z);
      return d > 50 && d < 140 && n.edges.length >= 2 && n.x > -470;
    });
    for (let k = 0; k < 25 && near.length; k++) {
      const A = near[Math.floor(Math.random() * near.length)];
      const e = map.edges[A.edges[Math.floor(Math.random() * A.edges.length)]];
      const B = map.nodes[map.otherEnd(e, A.id)];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if (len < 60) continue;
      const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
      // right-hand lane, mid-block
      const lane = (t: number, off = 3) => ({ x: A.x + dx * t - dz * off, z: A.z + dz * t + dx * off });
      const mid = lane(len * 0.5);
      if (g.inView(mid.x, 1, mid.z) && Math.hypot(mid.x - f.x, mid.z - f.z) < 120) continue;
      const lead = new Vehicle(TYPES[Math.floor(Math.random() * TYPES.length)]);
      const back = new Vehicle(TYPES[Math.floor(Math.random() * TYPES.length)]);
      const t1 = len * 0.5 + 3;
      const t2 = t1 - (lead.spec.len + back.spec.len) / 2 - 0.15;
      const p1 = lane(t1), p2 = lane(t2, 2.8);
      if (g.vehicles.some((u) => Math.hypot(u.pos.x - p1.x, u.pos.z - p1.z) < 12 || Math.hypot(u.pos.x - p2.x, u.pos.z - p2.z) < 12)) continue;
      const h = Math.atan2(dx, dz);
      lead.place(p1.x, p1.z, h + (Math.random() - 0.5) * 0.06);
      back.place(p2.x, p2.z, h + 0.1 + Math.random() * 0.08);
      for (const c of [lead, back]) {
        c.persistent = true;
        c.hazard = true;
        c.input.hand = true;
        g.addVehicle(c);
      }
      // the crumple: the lead car's tail, the other's nose, its bumper hanging by one corner
      const rearL = lead.spec.len / 2, frontB = back.spec.len / 2;
      lead.dent(lead.pos.x - lead.fwdX() * rearL, lead.pos.y + 0.55, lead.pos.z - lead.fwdZ() * rearL, 11);
      back.dent(back.pos.x + back.fwdX() * frontB, back.pos.y + 0.6, back.pos.z + back.fwdZ() * frontB, 13);
      back.sagBumper(0, Math.random() < 0.5 ? 1 : -1);
      // glass and tail-light shards and bits of black trim where they met
      const hit = lane((t1 + t2) / 2 + 0.2, 2.9);
      const debris = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      for (let i = 0; i < SHARDS; i++) {
        const r = Math.sqrt(Math.random()) * 1.6, a = Math.random() * Math.PI * 2;
        const x = hit.x + Math.cos(a) * r * 0.7 + dx * Math.sin(a) * r * 0.5, z = hit.z + Math.sin(a) * r * 0.7 + dz * Math.sin(a) * r * 0.5;
        const sz = 0.5 + Math.random() * 1.4;
        m4.compose(new THREE.Vector3(x, groundAt(x, z) + 0.015, z), q.setFromAxisAngle(up, Math.random() * 6.28), new THREE.Vector3(sz, 1, sz * (0.5 + Math.random())));
        debris.setMatrixAt(i, m4);
        const k = Math.random();
        debris.setColorAt(i, k < 0.55 ? col.setRGB(0.82, 0.86, 0.88) : k < 0.8 ? col.setRGB(0.75, 0.06, 0.05) : col.setRGB(0.06, 0.06, 0.07));
      }
      debris.receiveShadow = true;
      g.scene.add(debris);
      // the drivers, out on the sidewalk between the two cars: one having it out, one taking pictures
      const side = lane((t1 + t2) / 2, ROAD_HALF + 1.4);
      const drivers: Human[] = [];
      for (const s of [-1, 1]) {
        const x = side.x + dx * s * 0.6, z = side.z + dz * s * 0.6;
        const d = new Human('ped');
        d.pos.set(x, groundAt(x, z), z);
        d.state = 'chat';
        d.stateT = 130;
        d.clip = 'talk';
        d.health = d.maxHealth = 60;
        d.target.set(side.x, 0, side.z);
        d.yaw = Math.atan2(side.x - x, side.z - z);
        g.addNpc(d);
        drivers.push(d);
      }
      // the second turns to the damage with a phone out
      const ph = drivers[1];
      ph.clip = 'idle';
      ph.texting = true;
      ph.yaw = Math.atan2(hit.x - ph.pos.x, hit.z - ph.pos.z);
      ph.target.set(hit.x, 0, hit.z);
      this.scene = { cars: [lead, back], drivers, t: 120, debris };
      return true;
    }
    return false;
  }
}
