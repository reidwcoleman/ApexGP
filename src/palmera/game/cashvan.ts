// Cash van: now and then (when you're free and clean) a Strongbox Couriers armoured van does its
// rounds somewhere near you - a white $ on the minimap. It's a slab of steel on wheels: ram it or
// shoot it until it limps to a stop (or hold up the crew with a gun while it's stuck), and the two
// guards climb out shooting while the back doors spill the cash bags. Grab the bags - walk or drive
// over them - and get away: it's three stars the moment the van stops. Leave it alone and it finishes
// its round and drives off the map.
import * as THREE from 'three';
import { Human } from '../entities/humans';
import { Vehicle } from '../entities/vehicle';
import { TrafficAI } from './traffic';
import { groundAt } from '../world/map';
import type { Blip } from './missions';
import type { Game } from './game';

type Stage = 'rounds' | 'looted';

interface Bag {
  mesh: THREE.Group;
  x: number;
  z: number;
  value: number;
  vy: number;
  y: number;
  vx: number;
  vz: number;
}

export class CashVan {
  van: Vehicle | null = null;
  private stage: Stage = 'rounds';
  private t = 150 + Math.random() * 90;
  private life = 0;
  private maxH = 1;
  private held = 0;
  private bags: Bag[] = [];
  private bagT = 0;
  private bagGeo: THREE.BufferGeometry;
  private bagMat: THREE.MeshStandardMaterial;
  private tieMat: THREE.MeshStandardMaterial;
  private taken = 0;

  constructor(private game: Game) {
    // a canvas money sack: a lathed bulb pinched at the neck
    // bottom to top: a closed base, the fat bulb, pinched at the neck, then the tied-off tuft
    const prof: [number, number][] = [[0, 0], [0.12, 0.01], [0.2, 0.06], [0.23, 0.14], [0.22, 0.23], [0.17, 0.31], [0.08, 0.37], [0.045, 0.4], [0.07, 0.44], [0.08, 0.47], [0.04, 0.49], [0, 0.495]];
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    this.bagGeo = new THREE.LatheGeometry(pts, 16);
    this.bagGeo.computeVertexNormals();
    this.bagMat = new THREE.MeshStandardMaterial({ color: 0xb9a27a, roughness: 0.95 });
    this.tieMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.8 });
  }

  get blips(): Blip[] {
    const out: Blip[] = [];
    if (this.van && this.stage === 'rounds') out.push({ x: this.van.pos.x, z: this.van.pos.z, color: '#ffffff', label: '$', kind: 'mission' });
    for (const b of this.bags) out.push({ x: b.x, z: b.z, color: '#ffd23f', label: '', kind: 'dest' });
    return out;
  }

  /** a van onto a road 140-260 m away, heading along it */
  private spawn(): boolean {
    const g = this.game;
    const p = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
    const map = g.map;
    const near = map.nodes.filter((n) => {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      return d > 140 && d < 260 && n.edges.length >= 2 && n.x > -470;
    });
    for (let k = 0; k < 20 && near.length; k++) {
      const A = near[Math.floor(Math.random() * near.length)];
      const e = map.edges[A.edges[Math.floor(Math.random() * A.edges.length)]];
      const B = map.nodes[map.otherEnd(e, A.id)];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if (len < 40) continue;
      const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
      const x = A.x + dx * 18 - dz * 3, z = A.z + dz * 18 + dx * 3;
      if (g.vehicles.some((u) => Math.hypot(u.pos.x - x, u.pos.z - z) < 9)) continue;
      const v = new Vehicle('van', 0x5d646c);
      v.place(x, z, Math.atan2(dx, dz));
      v.driver = 'npc';
      const ai = new TrafficAI(g, A.id, B.id);
      ai.cruise = 9;
      v.ai = ai;
      v.persistent = true;
      // armour plate: two and a half times a van's toughness
      v.health *= 2.5;
      this.maxH = v.health;
      g.addVehicle(v);
      this.van = v;
      this.stage = 'rounds';
      this.life = 150;
      this.held = 0;
      g.hud.toast('A Strongbox Couriers cash van is on its rounds nearby ($ on the map)');
      return true;
    }
    return false;
  }

  private release() {
    if (this.van) this.van.persistent = false;
    this.van = null;
    this.t = 240 + Math.random() * 180;
  }

  /** the van gives up: it stops dead, the guards come out shooting, the back doors spill the bags */
  private crack() {
    const g = this.game;
    const v = this.van!;
    this.stage = 'looted';
    v.persistent = false;
    const mine = g.player.vehicle === v;
    if (!mine) {
      v.ai = null;
      v.driver = null;
      v.input.thr = 0;
      v.input.hand = true;
      // the driver stamps on the brake
      v.vx *= 0.25;
      v.vz *= 0.25;
    }
    const fx = v.fwdX(), fz = v.fwdZ();
    const rx = -fz, rz = fx;
    const half = v.spec.len / 2;
    // two guards, one out of each cab door
    if (!v.wrecked) {
      for (const s of mine ? [1] : [-1, 1]) {
        const h = new Human('cop');
        h.guard = true;
        const x = v.pos.x + fx * (half - 1.2) + rx * s * (v.spec.wid / 2 + 0.7), z = v.pos.z + fz * (half - 1.2) + rz * s * (v.spec.wid / 2 + 0.7);
        h.pos.set(x, groundAt(x, z, v.pos.y + 1), z);
        h.yaw = v.heading;
        h.weapon = 'pistol';
        h.state = 'chase';
        h.health = h.maxHealth = 90;
        g.addNpc(h);
      }
    }
    // the bags tumble out of the back
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Group();
      const sack = new THREE.Mesh(this.bagGeo, this.bagMat);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 12), this.tieMat);
      tie.rotation.x = Math.PI / 2;
      tie.position.y = 0.4;
      tie.scale.setScalar(0.75);
      sack.castShadow = true;
      // slumped over on its side, squashed a little under its own weight
      const body = new THREE.Group();
      body.add(sack, tie);
      body.scale.set(1, 1, 0.8);
      body.rotation.z = Math.PI / 2 - 0.25 + Math.random() * 0.3;
      body.position.y = 0.19;
      mesh.add(body);
      const x = v.pos.x - fx * (half + 0.3) + rx * (i - (n - 1) / 2) * 0.35;
      const z = v.pos.z - fz * (half + 0.3) + rz * (i - (n - 1) / 2) * 0.35;
      const sp = 0.8 + Math.random() * 1.4;
      const side = (Math.random() - 0.5) * 1.6;
      const b: Bag = { mesh, x, z, y: v.pos.y + 1.0, vy: 2 + Math.random() * 1.5, vx: -fx * sp + rx * side, vz: -fz * sp + rz * side, value: 450 + Math.floor(Math.random() * 9) * 50 };
      mesh.position.set(x, b.y, z);
      mesh.rotation.y = Math.random() * 6.28;
      g.scene.add(mesh);
      this.bags.push(b);
    }
    this.bagT = 75;
    this.taken = 0;
    g.wanted.setLevel(Math.max(g.wanted.level, 3));
    g.audio.cue('wanted');
    g.hud.bigMessage('CASH VAN', `${n} bags out the back · grab them and get away`, '#ffd23f');
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.updateBags(dt);
    const v = this.van;
    if (!v) {
      this.t -= dt;
      if (this.t > 0) return;
      const free = !g.missions.active && !g.activities.active && !g.delivery?.active && g.wanted.level === 0 && !p.dead && !g.interiors.inside && !g.chopper.camera();
      if (!free || !this.spawn()) this.t = 20;
      return;
    }
    if (this.stage !== 'rounds') {
      this.van = null;
      this.t = 240 + Math.random() * 180;
      return;
    }
    if (v.sunk || !g.vehicles.includes(v)) return this.release();
    if (p.vehicle === v) {
      // you took it: the cash is still locked in the back
      return this.crack();
    }
    const me = p.vehicle ? p.vehicle.pos : p.pos;
    const d = Math.hypot(v.pos.x - me.x, v.pos.z - me.z);
    this.life -= dt;
    if ((this.life <= 0 && d > 160) || d > 420) return this.release();
    if (v.wrecked || v.burnTimer > 0 || v.health < this.maxH * 0.55) return this.crack();
    // a gun on the crew while the van's boxed in or waiting at a light
    const aiming = !p.vehicle && p.weapon !== 'fist' && p.weapon !== 'bat' && g.playerCtl.aiming;
    if (aiming && d < 9 && Math.abs(v.speed) < 1) {
      this.held += dt;
      if (this.held > 1.2) g.hud.prompt(`Holding up the cash van… ${Math.max(0, Math.ceil(3 - this.held))}`);
      if (this.held > 3) return this.crack();
    } else this.held = Math.max(0, this.held - dt * 2);
  }

  private updateBags(dt: number) {
    if (!this.bags.length) return;
    const g = this.game;
    const p = g.player;
    const me = p.vehicle ? p.vehicle.pos : p.pos;
    const reach = p.vehicle ? 2.6 : 1.4;
    this.bagT -= dt;
    for (let i = this.bags.length - 1; i >= 0; i--) {
      const b = this.bags[i];
      // tumbling out, then a slide to rest
      const gy = groundAt(b.x, b.z, b.y + 0.5);
      if (b.y > gy + 0.001 || b.vy > 0) {
        b.vy -= 18 * dt;
        b.y += b.vy * dt;
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        if (b.y <= gy) {
          b.y = gy;
          b.vy = b.vy < -3 ? -b.vy * 0.25 : 0;
          b.vx *= 0.5;
          b.vz *= 0.5;
        }
        b.mesh.position.set(b.x, b.y, b.z);
      }
      if (p.dead) continue;
      if (Math.hypot(b.x - me.x, b.z - me.z) < reach && b.vy === 0) {
        g.scene.remove(b.mesh);
        (b.mesh.children[0].children[1] as THREE.Mesh).geometry.dispose();
        this.bags.splice(i, 1);
        g.addCash(b.value);
        this.taken += b.value;
        g.audio.cue('cash');
        g.hud.toast(`+$${b.value}${this.bags.length ? ` · ${this.bags.length} more` : ` · $${this.taken.toLocaleString()} from the van`}`);
      } else if (this.bagT <= 0) {
        // left lying too long: the bank's people picked them up
        g.scene.remove(b.mesh);
        this.bags.splice(i, 1);
      }
    }
  }
}
