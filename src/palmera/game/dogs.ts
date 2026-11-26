// Dog walkers: a few of the people strolling near you have a dog on a lead, trotting along beside
// and a little behind them, tail going. If the owner bolts (a fight, gunfire) or goes down, the dog
// runs off. Simple low-poly dogs with legs that swing with their pace.
import * as THREE from 'three';
import type { Human } from '../entities/humans';
import { groundAt } from '../world/map';
import type { Game } from './game';

const COATS = [0x8a5a2b, 0x1c1a19, 0xe9e2d4, 0xc8954a, 0x6b6560, 0xa0522d, 0xf2efe8];

interface Dog {
  root: THREE.Group;
  legs: THREE.Object3D[];
  tail: THREE.Object3D;
  leash: THREE.Mesh;
  owner: Human | null;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  phase: number;
  size: number;
  runT: number;
}

function makeDog(coat: number, size: number): Omit<Dog, 'owner' | 'pos' | 'yaw' | 'speed' | 'phase' | 'size' | 'runT' | 'leash'> {
  const root = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.38, 4, 8), fur);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0.42, 0);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), fur);
  chest.position.set(0, 0.45, 0.2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), fur);
  head.position.set(0, 0.62, 0.34);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.12), fur);
  snout.position.set(0, 0.59, 0.45);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), dark);
  nose.position.set(0, 0.61, 0.51);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.015, 6, 14), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.5 }));
  collar.position.set(0, 0.55, 0.27);
  collar.rotation.x = Math.PI / 2.4;
  root.add(body, chest, head, snout, nose, collar);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 5), fur);
    ear.position.set(s * 0.06, 0.72, 0.31);
    ear.rotation.z = -s * 0.3;
    root.add(ear);
  }
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.08, 0.2], [0.08, 0.2], [-0.08, -0.2], [0.08, -0.2]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.38, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.36, 6), fur);
    leg.position.y = -0.18;
    hip.add(leg);
    root.add(hip);
    legs.push(hip);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.32);
  const tm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, 0.24, 5), fur);
  tm.position.y = 0.11;
  tail.add(tm);
  tail.rotation.x = -0.7;
  root.add(tail);
  root.scale.setScalar(size);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { root, legs, tail };
}

export class Dogs {
  dogs: Dog[] = [];
  private t = 0;
  private readonly leashMat = new THREE.MeshBasicMaterial({ color: 0x2a1c14 });
  private readonly leashGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 4);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(private game: Game) {
    this.leashGeo.translate(0, 0.5, 0);
  }

  private adopt(owner: Human) {
    const size = 0.75 + Math.random() * 0.55;
    const d = makeDog(COATS[Math.floor(Math.random() * COATS.length)], size);
    const leash = new THREE.Mesh(this.leashGeo, this.leashMat);
    leash.frustumCulled = false;
    this.game.scene.add(d.root, leash);
    const pos = owner.pos.clone();
    pos.x -= Math.sin(owner.yaw) * 1.4;
    pos.z -= Math.cos(owner.yaw) * 1.4;
    this.dogs.push({ ...d, leash, owner, pos, yaw: owner.yaw, speed: 0, phase: Math.random() * 6, size, runT: 0 });
  }

  private drop(d: Dog) {
    this.game.scene.remove(d.root, d.leash);
    d.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }

  update(dt: number) {
    const g = this.game;
    const f = g.focus;
    // keep up to 8 (3 at night) among the walkers near you
    this.t -= dt;
    const want = g.sky.day > 0.4 ? 8 : 3;
    if (this.t <= 0) {
      this.t = 1.2;
      const owned = new Set(this.dogs.map((d) => d.owner));
      if (this.dogs.length < want) {
        for (const h of g.npcs) {
          if (h.kind !== 'ped' || h.state !== 'walk' || owned.has(h) || h.dead || h.hidden) continue;
          const dd = Math.hypot(h.pos.x - f.x, h.pos.z - f.z);
          if (dd < 30 || dd > 90 || g.inView(h.pos.x, 1, h.pos.z)) continue;
          if (Math.random() < 0.35) {
            this.adopt(h);
            break;
          }
        }
      }
    }
    for (let i = this.dogs.length - 1; i >= 0; i--) {
      const d = this.dogs[i];
      const o = d.owner;
      const gone = !o || o.dead || !g.npcs.includes(o) || o.state === 'flee' || o.state === 'cower';
      if (gone && d.owner) {
        // off it goes
        d.owner = null;
        d.runT = 6;
        d.yaw += (Math.random() - 0.5) * 2;
      }
      let tx: number, tz: number, maxSp: number;
      if (d.owner) {
        const ow = d.owner;
        const fx = Math.sin(ow.yaw), fz = Math.cos(ow.yaw);
        tx = ow.pos.x - fx * 1.3 + fz * 0.55;
        tz = ow.pos.z - fz * 1.3 - fx * 0.55;
        maxSp = 6;
      } else {
        tx = d.pos.x + Math.sin(d.yaw) * 10;
        tz = d.pos.z + Math.cos(d.yaw) * 10;
        maxSp = 7;
        d.runT -= dt;
      }
      const dx = tx - d.pos.x, dz = tz - d.pos.z, dist = Math.hypot(dx, dz);
      const want = dist < 0.25 ? 0 : Math.min(maxSp, dist * 2.2);
      d.speed += (want - d.speed) * Math.min(1, dt * 5);
      if (dist > 0.05 && d.speed > 0.2) {
        const ty = Math.atan2(dx, dz);
        d.yaw += Math.atan2(Math.sin(ty - d.yaw), Math.cos(ty - d.yaw)) * Math.min(1, dt * 6);
      }
      d.pos.x += Math.sin(d.yaw) * d.speed * dt;
      d.pos.z += Math.cos(d.yaw) * d.speed * dt;
      d.pos.y = groundAt(d.pos.x, d.pos.z);
      d.phase += dt * (2 + d.speed * 3.2) / d.size;
      const sw = Math.min(0.75, d.speed * 0.22);
      d.legs.forEach((l, k) => (l.rotation.x = Math.sin(d.phase + (k === 0 || k === 3 ? 0 : Math.PI)) * sw));
      d.tail.rotation.z = Math.sin(g.elapsed * 12 + d.phase) * 0.5;
      d.root.position.copy(d.pos);
      d.root.position.y += Math.abs(Math.sin(d.phase)) * 0.02 * d.speed;
      d.root.rotation.y = d.yaw;
      // the lead from the owner's hand to the collar
      if (d.owner) {
        const ow = d.owner;
        const rx = Math.cos(ow.yaw), rz = -Math.sin(ow.yaw);
        this.a.set(ow.pos.x + rx * 0.28, ow.pos.y + 0.9, ow.pos.z + rz * 0.28);
        this.b.set(d.pos.x + Math.sin(d.yaw) * 0.27 * d.size, d.pos.y + 0.55 * d.size, d.pos.z + Math.cos(d.yaw) * 0.27 * d.size);
        const len = this.a.distanceTo(this.b);
        d.leash.visible = true;
        d.leash.position.copy(this.b);
        d.leash.scale.set(1, len, 1);
        d.leash.quaternion.setFromUnitVectors(this.up, this.a.sub(this.b).normalize());
      } else d.leash.visible = false;
      const far = Math.hypot(d.pos.x - f.x, d.pos.z - f.z) > 140;
      if (far || (!d.owner && d.runT <= 0)) {
        this.drop(d);
        this.dogs.splice(i, 1);
      }
    }
  }
}
