import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Person } from '../people/Humans.ts';
import type { Door, MapData } from './world.ts';

/**
 * Everything that falls over. One Rapier world beside the game's box world: the map as fixed cuboids,
 * doors as kinematic slabs, people as kinematic capsules that shoulder things aside, and the rest
 * dynamic: ragdolls, loose props, brass, dropped guns and magazines, glass.
 *
 * Nothing here decides a match. Each browser runs its own from the same shots and blasts, so a chair
 * may land differently on two screens, and no bullet or body ever waits for it.
 */

const STEP = 1 / 80;
const G = { world: 1, rag: 2, prop: 4, debris: 8, actor: 16, door: 32 };
const groups = (member: number, filter: number) => (member << 16) | filter;
const GRP = {
  world: groups(G.world, 0xffff),
  door: groups(G.door, G.rag | G.prop | G.debris),
  rag: groups(G.rag, G.world | G.door | G.prop),
  prop: groups(G.prop, G.world | G.door | G.rag | G.prop | G.actor | G.debris),
  debris: groups(G.debris, G.world | G.door | G.prop),
  actor: groups(G.actor, G.prop),
  /** a shot only asks about what can move */
  rayLoose: groups(0xffff, G.rag | G.prop),
};

type Hit = { kind: 'rag'; rag: Ragdoll; part: number } | { kind: 'prop'; prop: Loose };

export interface LooseDef {
  kg: number;
  surf: string;
  shape: string;
  half: number[];
}

const SURFACE: Record<string, [number, number, number]> = {
  // friction, restitution, angular damping
  metal: [0.42, 0.22, 0.5], wood: [0.6, 0.12, 0.6], plastic: [0.5, 0.26, 0.5], card: [0.7, 0.06, 1.1], bag: [0.95, 0.01, 2.2], rubber: [0.9, 0.45, 0.4],
};

export class Loose {
  moved = false;
  speed = 0;
  constructor(readonly body: RAPIER.RigidBody, readonly obj: THREE.Object3D, readonly surf: string, readonly kg: number, readonly home: { p: THREE.Vector3; q: THREE.Quaternion }) {}
}

interface Drop {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  life: number;
  speed: number;
  surf: string;
  /** a gun on the ground can be picked up */
  gun?: string;
}

export interface Shard {
  body: RAPIER.RigidBody;
  life: number;
  speed: number;
  sx: number;
  sy: number;
}

export class Phys {
  readonly world: RAPIER.World;
  private acc = 0;
  private fixed: RAPIER.RigidBody;
  private owners = new Map<number, Hit>();
  readonly loose: Loose[] = [];
  private rags: Ragdoll[] = [];
  private drops: Drop[] = [];
  private doors: { d: Door; body: RAPIER.RigidBody }[] = [];
  private panes = new Map<number, RAPIER.Collider>();
  private actors = new Map<number, RAPIER.RigidBody>();
  /** brass and shards are pooled: bodies are made once */
  readonly brass: { body: RAPIER.RigidBody; speed: number; live: boolean }[] = [];
  private brassI = 0;
  readonly shards: Shard[] = [];
  private shardI = 0;
  /** a thing landed, hard enough to be heard */
  onKnock: (x: number, y: number, z: number, surf: string, v: number) => void = () => {};
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  static async create() {
    await RAPIER.init();
    return new Phys();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 4;
    this.fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (let i = 0; i < 44; i++) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -60, 0).setCanSleep(true).setAngularDamping(0.6).setLinearDamping(0.05));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.0065, 0.019, 0.0065).setDensity(1900).setFriction(0.5).setRestitution(0.42).setCollisionGroups(GRP.debris), body);
      body.sleep();
      this.brass.push({ body, speed: 0, live: false });
    }
    for (let i = 0; i < 96; i++) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -60, 0).setAngularDamping(0.4).setLinearDamping(0.1));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, 0.006, 0.05).setDensity(2400).setFriction(0.5).setRestitution(0.18).setCollisionGroups(GRP.debris), body);
      body.sleep();
      this.shards.push({ body, life: 0, speed: 0, sx: 0.1, sy: 0.1 });
    }
  }

  /** the map, once */
  addMap(map: MapData) {
    for (const c of map.colliders) {
      const hx = (c[3] - c[0]) / 2, hy = (c[4] - c[1]) / 2, hz = (c[5] - c[2]) / 2;
      if (hx < 0.004 || hy < 0.004 || hz < 0.004) continue;
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(c[0] + hx, c[1] + hy, c[2] + hz).setFriction(0.7).setCollisionGroups(GRP.world), this.fixed);
    }
    // the street sits lower than the kerb, and the cloth of a bag shouldn't fall through a seam
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(300, 1, 300).setTranslation(46, -1.6, -30).setFriction(0.7).setCollisionGroups(GRP.world), this.fixed);
  }

  addDoor(d: Door) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(d.width / 2, d.height / 2, 0.03).setFriction(0.5).setCollisionGroups(GRP.door), body);
    this.doors.push({ d, body });
    this.syncDoor(d, body);
  }

  private syncDoor(d: Door, body: RAPIER.RigidBody) {
    const c = d.leafCentre, q = d.leafQuat;
    body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
    body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  addPane(id: number, min: number[], max: number[]) {
    const hx = (max[0] - min[0]) / 2, hy = (max[1] - min[1]) / 2, hz = (max[2] - min[2]) / 2;
    this.panes.set(id, this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(min[0] + hx, min[1] + hy, min[2] + hz).setCollisionGroups(GRP.world), this.fixed));
  }

  breakPane(id: number) {
    this.panes.get(id)?.setEnabled(false);
  }

  resetPanes() {
    for (const c of this.panes.values()) c.setEnabled(true);
  }

  addLoose(obj: THREE.Object3D, def: LooseDef, x: number, y: number, z: number, rot: number) {
    const [hx, hzUp, hy] = [def.half[0], def.half[2], def.half[1]];
    const [fr, re, ad] = SURFACE[def.surf] ?? SURFACE.wood;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, rot);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + hzUp + 0.004, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setAngularDamping(ad).setLinearDamping(0.08).setCanSleep(true));
    const r = Math.max(hx, hy);
    const shape = def.shape === 'cyl' ? RAPIER.ColliderDesc.cylinder(hzUp, r) : RAPIER.ColliderDesc.cuboid(hx, hzUp, hy);
    const col = this.world.createCollider(shape.setMass(def.kg).setFriction(fr).setRestitution(re).setCollisionGroups(GRP.prop), body);
    body.sleep();
    const home = { p: new THREE.Vector3(x, y + hzUp + 0.004, z), q };
    const L = new Loose(body, obj, def.surf, def.kg, home);
    this.owners.set(col.handle, { kind: 'prop', prop: L });
    this.loose.push(L);
    obj.position.copy(home.p);
    obj.quaternion.copy(q);
    return L;
  }

  /** a new match starts on a tidy map */
  resetLoose() {
    for (const L of this.loose) {
      if (!L.moved) continue;
      L.moved = false;
      const { p, q } = L.home;
      L.body.setTranslation(p, true);
      L.body.setRotation(q, true);
      L.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      L.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      L.body.sleep();
      L.obj.position.copy(p);
      L.obj.quaternion.copy(q);
    }
    for (const d of this.drops) this.dropGone(d);
    this.drops.length = 0;
  }

  /** a kinematic stand-in for a walking body, so things get shoved out of the way */
  setActor(slot: number, x: number, y: number, z: number, h: number, alive: boolean) {
    let b = this.actors.get(slot);
    if (!b) {
      b = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, -40, z));
      this.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.26).setCollisionGroups(GRP.actor).setFriction(0.3), b);
      this.actors.set(slot, b);
    }
    b.setNextKinematicTranslation({ x, y: alive ? y + h * 0.5 : -40, z });
  }

  // ------------------------------------------------------------------ things let go of
  /** brass out of the port */
  shell(p: THREE.Vector3, v: THREE.Vector3, q: THREE.Quaternion) {
    const s = this.brass[this.brassI];
    this.brassI = (this.brassI + 1) % this.brass.length;
    s.live = true;
    s.speed = 0;
    const b = s.body;
    b.setTranslation(p, true);
    b.setRotation(q, true);
    b.setLinvel(v, true);
    b.setAngvel({ x: (Math.random() - 0.5) * 50, y: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 50 }, true);
    return this.brassI;
  }

  /** a magazine, a gun: any object with a box round it */
  drop(obj: THREE.Object3D, half: [number, number, number], off: THREE.Vector3, p: THREE.Vector3, q: THREE.Quaternion, v: THREE.Vector3, spin: number, kg: number, life: number, surf = 'metal', gun?: string) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinvel(v.x, v.y, v.z)
      .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin }).setAngularDamping(0.5).setLinearDamping(0.05));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(off.x, off.y, off.z).setMass(kg).setFriction(0.55).setRestitution(0.2).setCollisionGroups(GRP.debris), body);
    this.drops.push({ body, obj, life, speed: 0, surf, gun });
  }

  /** the nearest gun lying within reach, and how far along the look it is */
  gunNear(x: number, y: number, z: number, fx: number, fy: number, fz: number, reach: number) {
    let best: { i: number; gun: string } | null = null, bs = 0.55;
    this.drops.forEach((d, i) => {
      if (!d.gun) return;
      const t = d.body.translation();
      const dx = t.x - x, dy = t.y - y, dz = t.z - z, l = Math.hypot(dx, dy, dz);
      if (l > reach) return;
      const s = (dx * fx + dy * fy + dz * fz) / (l || 1);
      if (s > bs) {
        bs = s;
        best = { i, gun: d.gun };
      }
    });
    return best as { i: number; gun: string } | null;
  }

  takeGun(i: number) {
    const d = this.drops[i];
    if (!d) return;
    this.dropGone(d);
    this.drops.splice(i, 1);
  }

  private dropGone(d: Drop) {
    this.world.removeRigidBody(d.body);
    d.obj.removeFromParent();
  }

  /** the pane in pieces: `at` where it was hit, `push` the way it was going */
  shatter(min: THREE.Vector3, max: THREE.Vector3, at: THREE.Vector3, push: THREE.Vector3, n: number) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = this.shards[this.shardI];
      const idx = this.shardI;
      this.shardI = (this.shardI + 1) % this.shards.length;
      const x = THREE.MathUtils.lerp(min.x, max.x, Math.random()), y = THREE.MathUtils.lerp(min.y, max.y, Math.random()), z = THREE.MathUtils.lerp(min.z, max.z, Math.random());
      const dx = x - at.x, dy = y - at.y, dz = z - at.z;
      const near = 1 / (0.35 + Math.hypot(dx, dy, dz));
      s.life = 4 + Math.random() * 3;
      s.speed = 0;
      s.sx = 0.05 + Math.random() * 0.17;
      s.sy = 0.05 + Math.random() * 0.2;
      const b = s.body;
      b.setTranslation({ x, y, z }, true);
      Q.setFromEuler(E.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      b.setRotation(Q, true);
      b.setLinvel({ x: push.x * near * 2.2 + dx * near * 0.8, y: push.y * near * 2.2 + dy * near * 0.8 + 0.3, z: push.z * near * 2.2 + dz * near * 0.8 }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 24, z: (Math.random() - 0.5) * 24 }, true);
      out.push(idx);
    }
    return out;
  }

  // ------------------------------------------------------------------ forces
  /** a round through whatever it can move; returns what it touched first, for the dust or the blood */
  shot(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, impulse: number): { x: number; y: number; z: number; surf: string } | null {
    this.ray.origin.x = ox;
    this.ray.origin.y = oy;
    this.ray.origin.z = oz;
    this.ray.dir.x = dx;
    this.ray.dir.y = dy;
    this.ray.dir.z = dz;
    const h = this.world.castRay(this.ray, max, true, undefined, GRP.rayLoose);
    if (!h) return null;
    const o = this.owners.get(h.collider.handle);
    if (!o) return null;
    const t = h.timeOfImpact;
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const p = { x, y, z }, f = { x: dx * impulse, y: dy * impulse, z: dz * impulse };
    if (o.kind === 'prop') {
      o.prop.moved = true;
      o.prop.body.applyImpulseAtPoint({ x: f.x * 0.9, y: f.y * 0.9 + impulse * 0.12, z: f.z * 0.9 }, p, true);
      return { x, y, z, surf: o.prop.surf };
    }
    o.rag.punch(o.part, f, p);
    return { x, y, z, surf: 'flesh' };
  }

  /** a shock wave: falls with distance, lifts a little, and walls are ignored only by the very close */
  blast(p: THREE.Vector3, power: number, radius: number, sees: (x: number, y: number, z: number) => boolean) {
    for (const L of this.loose) {
      const t = L.body.translation();
      const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, d = Math.hypot(dx, dy, dz);
      if (d > radius || (d > 1.2 && !sees(t.x, t.y, t.z))) continue;
      const k = power * (1 - d / radius) ** 1.5 / Math.max(0.5, d);
      const imp = Math.min(L.kg * 16, k * Math.pow(L.kg, 0.55));
      L.moved = true;
      L.body.applyImpulseAtPoint({ x: (dx / (d || 1)) * imp, y: (Math.max(0, dy / (d || 1)) + 0.45) * imp, z: (dz / (d || 1)) * imp }, { x: t.x + (Math.random() - 0.5) * 0.2, y: t.y - 0.1, z: t.z + (Math.random() - 0.5) * 0.2 }, true);
    }
    for (const r of this.rags) r.blast(p, power, radius);
    for (const d of this.drops) {
      const t = d.body.translation();
      const dist = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      if (dist < radius) d.body.applyImpulse({ x: (t.x - p.x) * 0.2, y: 1.2 * (1 - dist / radius), z: (t.z - p.z) * 0.2 }, true);
    }
  }

  // ------------------------------------------------------------------ time
  step(dt: number) {
    for (const d of this.doors) if (d.d.moving) this.syncDoor(d.d, d.body);
    this.acc = Math.min(this.acc + dt, STEP * 4);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const r of this.rags) r.muscles(STEP);
      this.world.step();
    }
    for (const L of this.loose) {
      const b = L.body;
      if (b.isSleeping()) {
        L.speed = 0;
        continue;
      }
      L.moved = true;
      const t = b.translation(), q = b.rotation(), v = b.linvel();
      L.obj.position.set(t.x, t.y, t.z);
      L.obj.quaternion.set(q.x, q.y, q.z, q.w);
      const s = Math.hypot(v.x, v.y, v.z);
      if (L.speed - s > 1.1) this.onKnock(t.x, t.y, t.z, L.surf, L.speed - s);
      L.speed = s;
      if (t.y < -6) {
        b.setTranslation(L.home.p, false);
        b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      const t = d.body.translation(), q = d.body.rotation(), v = d.body.linvel();
      d.obj.position.set(t.x, t.y, t.z);
      d.obj.quaternion.set(q.x, q.y, q.z, q.w);
      const s = Math.hypot(v.x, v.y, v.z);
      if (d.speed - s > 1.3) this.onKnock(t.x, t.y, t.z, d.surf, d.speed - s);
      d.speed = s;
      if (d.life <= 0) {
        this.dropGone(d);
        this.drops.splice(i, 1);
      }
    }
    for (const s of this.brass) {
      if (!s.live) continue;
      const v = s.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (s.speed - sp > 0.7) {
        const t = s.body.translation();
        this.onKnock(t.x, t.y, t.z, 'brass', s.speed - sp);
      }
      s.speed = sp;
      if (s.body.isSleeping()) s.live = false;
    }
    for (const s of this.shards) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const v = s.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (s.speed - sp > 1.6 && Math.random() < 0.5) {
        const t = s.body.translation();
        this.onKnock(t.x, t.y, t.z, 'shard', s.speed - sp);
      }
      s.speed = sp;
      if (s.life <= 0) {
        s.body.setTranslation({ x: 0, y: -60, z: 0 }, false);
        s.body.sleep();
      }
    }
    for (const r of this.rags) r.sync(dt);
  }

  ragdoll(P: Person, v: THREE.Vector3, zone: number, dir: THREE.Vector3, power: number) {
    // a crowd of bodies is the one thing that could cost a frame: the oldest goes still
    if (this.rags.length >= 7) this.rags[0].freeze();
    const r = new Ragdoll(this, P, v, zone, dir, power);
    this.rags.push(r);
    return r;
  }

  forget(r: Ragdoll) {
    const i = this.rags.indexOf(r);
    if (i >= 0) this.rags.splice(i, 1);
  }

  own(handle: number, rag: Ragdoll, part: number) {
    this.owners.set(handle, { kind: 'rag', rag, part });
  }

  disown(handle: number) {
    this.owners.delete(handle);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const Q = new THREE.Quaternion();
const E = new THREE.Euler();

// ---------------------------------------------------------------------- ragdolls
interface PartDef {
  bone: string;
  tip: string | null;
  r: number;
  kg: number;
  parent: number;
  /** ball joint: how far off its rest direction (radians). Hinge: [0, bend] */
  cone?: number;
  hinge?: 'knee' | 'elbow';
  len?: number;
}

const PARTS: PartDef[] = [
  { bone: 'Bip01_Pelvis', tip: 'Bip01_Spine1', r: 0.13, kg: 12, parent: -1 },
  { bone: 'Bip01_Spine1', tip: 'Bip01_Spine2', r: 0.125, kg: 9, parent: 0, cone: 0.42 },
  { bone: 'Bip01_Spine2', tip: 'Bip01_Neck', r: 0.145, kg: 14, parent: 1, cone: 0.4 },
  { bone: 'Bip01_Head', tip: null, r: 0.105, kg: 4.8, parent: 2, cone: 0.65, len: 0.2 },
  { bone: 'Bip01_L_UpperArm', tip: 'Bip01_L_Forearm', r: 0.05, kg: 2.4, parent: 2, cone: 1.9 },
  { bone: 'Bip01_L_Forearm', tip: 'Bip01_L_Hand', r: 0.043, kg: 1.8, parent: 4, hinge: 'elbow' },
  { bone: 'Bip01_R_UpperArm', tip: 'Bip01_R_Forearm', r: 0.05, kg: 2.4, parent: 2, cone: 1.9 },
  { bone: 'Bip01_R_Forearm', tip: 'Bip01_R_Hand', r: 0.043, kg: 1.8, parent: 6, hinge: 'elbow' },
  { bone: 'Bip01_L_Thigh', tip: 'Bip01_L_Calf', r: 0.075, kg: 8, parent: 0, cone: 1.25 },
  { bone: 'Bip01_L_Calf', tip: 'Bip01_L_Foot', r: 0.055, kg: 4.2, parent: 8, hinge: 'knee' },
  { bone: 'Bip01_R_Thigh', tip: 'Bip01_R_Calf', r: 0.075, kg: 8, parent: 0, cone: 1.25 },
  { bone: 'Bip01_R_Calf', tip: 'Bip01_R_Foot', r: 0.055, kg: 4.2, parent: 10, hinge: 'knee' },
];
/** the chain from the hips out, with what's in between, so each driven bone can be solved in turn */
const CHAIN = ['Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head', 'Bip01_L_Clavicle', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_R_Clavicle', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_R_Thigh', 'Bip01_R_Calf'];

const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vd = new THREE.Vector3();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

interface Part {
  def: PartDef;
  body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  /** along the bone, body space */
  dir: THREE.Vector3;
  /** this bone's direction when it stood, in the parent's body space */
  rest: THREE.Vector3;
  /** at the moment of death: what the muscles still try to hold */
  held: THREE.Vector3;
  /** body-space hinge axis of the parent */
  axis: THREE.Vector3;
}

export class Ragdoll {
  readonly head = new THREE.Vector3();
  private parts: Part[] = [];
  private joints: RAPIER.ImpulseJoint[] = [];
  private t = 0;
  private asleep = 0;
  private frozen = false;
  private byBone = new Map<string, Part>();
  private m = new THREE.Matrix4();

  constructor(private ph: Phys, private P: Person, v: THREE.Vector3, zone: number, dir: THREE.Vector3, power: number) {
    const w = ph.world;
    P.root.updateMatrixWorld(true);
    const inv = P.skeleton.boneInverses, bones = P.skeleton.bones;
    const bindM = (name: string) => {
      const i = bones.indexOf(P.bones[name]);
      return new THREE.Matrix4().copy(inv[i]).invert();
    };
    const bindQ = (name: string) => new THREE.Quaternion().setFromRotationMatrix(bindM(name));
    const bindP = (name: string) => new THREE.Vector3().setFromMatrixPosition(bindM(name));
    const pelvisQ = P.bones.Bip01_Pelvis.getWorldQuaternion(new THREE.Quaternion());
    // a side axis from the hips: the shoulders may be twisted
    const lf = P.worldOf('Bip01_L_Thigh', new THREE.Vector3()).sub(P.worldOf('Bip01_R_Thigh', new THREE.Vector3())).normalize();
    void pelvisQ;
    PARTS.forEach((def, i) => {
      const bone = P.bones[def.bone];
      const p = bone.getWorldPosition(new THREE.Vector3());
      const q = bone.getWorldQuaternion(new THREE.Quaternion());
      const tip = def.tip ? P.worldOf(def.tip, new THREE.Vector3()) : null;
      let len = def.len ?? 0.2;
      const dirW = new THREE.Vector3();
      if (tip) {
        dirW.copy(tip).sub(p);
        len = dirW.length();
        dirW.normalize();
      } else dirW.copy(i === 3 ? P.worldOf('Bip01_Neck', new THREE.Vector3()).sub(p).multiplyScalar(-1).normalize() : UP);
      const dirL = dirW.clone().applyQuaternion(qa.copy(q).invert());
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(v.x, v.y, v.z).setAngularDamping(1.4).setLinearDamping(0.12).setCcdEnabled(i < 3));
      const half = Math.max(0.01, len / 2 - def.r * 0.4);
      const rot = new THREE.Quaternion().setFromUnitVectors(UP, dirL);
      const c = dirL.clone().multiplyScalar(len / 2);
      const col = w.createCollider(RAPIER.ColliderDesc.capsule(half, def.r).setTranslation(c.x, c.y, c.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setMass(def.kg).setFriction(0.75).setRestitution(0.02).setCollisionGroups(GRP.rag), body);
      ph.own(col.handle, this, i);
      const part: Part = { def, body, col, dir: dirL, rest: new THREE.Vector3(), held: new THREE.Vector3(), axis: new THREE.Vector3() };
      this.parts.push(part);
      this.byBone.set(def.bone, part);
      if (def.parent >= 0) {
        const par = this.parts[def.parent];
        const pp = par.body.translation(), pq = par.body.rotation();
        const pQ = qb.set(pq.x, pq.y, pq.z, pq.w);
        const a1 = va.copy(p).sub(vb.set(pp.x, pp.y, pp.z)).applyQuaternion(qa.copy(pQ).invert());
        const a2 = { x: 0, y: 0, z: 0 };
        if (def.hinge) {
          // knees fold back, elbows forward, about the side axis, unless they're already bent
          const parentDir = vb.copy(par.dir).applyQuaternion(pQ);
          const cr = vc.crossVectors(parentDir, dirW);
          const want = def.hinge === 'knee' ? lf : vd.copy(lf).negate();
          const axisW = cr.length() > 0.18 ? cr.normalize() : want;
          const ax1 = vd.copy(axisW).applyQuaternion(qa.copy(pQ).invert()).clone();
          const ax2 = axisW.clone().applyQuaternion(qa.copy(q).invert());
          part.axis.copy(ax1);
          this.joints.push(w.createImpulseJoint(RAPIER.JointData.revoluteWithAxes({ x: a1.x, y: a1.y, z: a1.z }, a2, ax1, ax2), par.body, body, true));
        } else {
          this.joints.push(w.createImpulseJoint(RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, a2), par.body, body, true));
          // the bone's neutral direction, from the bind pose, seen from the parent
          const childTip = def.tip ? bindP(def.tip) : bindP(def.bone).add(bindP(def.bone).sub(bindP('Bip01_Neck')));
          const bindDir = childTip.sub(bindP(def.bone)).normalize();
          part.rest.copy(bindDir).applyQuaternion(bindQ(par.def.bone).invert());
        }
        part.held.copy(dirW).applyQuaternion(qa.copy(pQ).invert());
      }
    });
    // shot: the zone takes it
    const part = zone === 0 ? 3 : zone === 2 || zone === 4 ? (Math.random() < 0.5 ? 9 : 11) : zone === 3 ? 0 : 2;
    const b = this.parts[part].body;
    const t = b.translation();
    b.applyImpulseAtPoint({ x: dir.x * power, y: dir.y * power + power * 0.08, z: dir.z * power }, { x: t.x + (Math.random() - 0.5) * 0.08, y: t.y + 0.06, z: t.z + (Math.random() - 0.5) * 0.08 }, true);
    this.head.copy(P.worldOf('Bip01_Head', va));
  }

  punch(part: number, f: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }) {
    if (this.frozen) return;
    this.parts[part].body.applyImpulseAtPoint(f, at, true);
    this.asleep = 0;
  }

  blast(p: THREE.Vector3, power: number, radius: number) {
    if (this.frozen) return;
    for (const q of this.parts) {
      const t = q.body.translation();
      const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const k = (power * 0.34 * (1 - d / radius) * q.def.kg) / 10 / Math.max(0.6, d);
      q.body.applyImpulse({ x: (dx / (d || 1)) * k, y: (Math.abs(dy) / (d || 1) + 0.5) * k, z: (dz / (d || 1)) * k }, true);
    }
    this.asleep = 0;
  }

  /** joint limits, and for a moment the tone the body had when it was alive */
  muscles(dt: number) {
    if (this.frozen) return;
    this.t += dt;
    const tone = Math.max(0, 1 - this.t / 0.55);
    for (const p of this.parts) {
      const d = p.def;
      if (d.parent < 0) continue;
      const par = this.parts[d.parent];
      if (par.body.isSleeping() && p.body.isSleeping()) continue;
      const q1 = par.body.rotation(), q2 = p.body.rotation();
      qa.set(q1.x, q1.y, q1.z, q1.w);
      qb.set(q2.x, q2.y, q2.z, q2.w);
      const cur = va.copy(p.dir).applyQuaternion(qb);
      if (d.hinge) {
        const axis = vb.copy(p.axis).applyQuaternion(qa);
        const pd = vc.copy(par.dir).applyQuaternion(qa);
        const ang = Math.atan2(vd.crossVectors(pd, cur).dot(axis), pd.dot(cur));
        const lo = 0.02, hi = d.hinge === 'knee' ? 2.35 : 2.45;
        let e = 0;
        if (ang < lo) e = lo - ang;
        else if (ang > hi) e = hi - ang;
        if (e) this.torque(par, p, axis, e * 30 * dt * d.kg * 0.5);
        continue;
      }
      if (tone > 0) {
        const held = vb.copy(p.held).applyQuaternion(qa);
        const ax = vc.crossVectors(cur, held);
        const s = ax.length();
        if (s > 1e-3) this.torque(par, p, ax.multiplyScalar(1 / s), Math.asin(Math.min(1, s)) * 42 * tone * dt * d.kg * 0.6);
      }
      if (d.cone) {
        const rest = vb.copy(p.rest).applyQuaternion(qa);
        const c = cur.dot(rest);
        const ang = Math.acos(THREE.MathUtils.clamp(c, -1, 1));
        if (ang > d.cone) {
          const ax = vc.crossVectors(cur, rest);
          const s = ax.length();
          if (s > 1e-3) this.torque(par, p, ax.multiplyScalar(1 / s), (ang - d.cone) * 40 * dt * d.kg * 0.5);
        }
      }
    }
  }

  private torque(a: Part, b: Part, axis: THREE.Vector3, k: number) {
    b.body.applyTorqueImpulse({ x: axis.x * k, y: axis.y * k, z: axis.z * k }, true);
    a.body.applyTorqueImpulse({ x: -axis.x * k, y: -axis.y * k, z: -axis.z * k }, true);
  }

  /** the skeleton follows the bodies, from the hips outward */
  sync(dt: number) {
    if (this.frozen) return;
    const P = this.P;
    const pel = this.parts[0].body.translation();
    const bone0 = P.bones.Bip01_Pelvis;
    P.root.updateMatrixWorld(false);
    const now = bone0.getWorldPosition(va);
    P.root.position.x += pel.x - now.x;
    P.root.position.y += pel.y - now.y;
    P.root.position.z += pel.z - now.z;
    P.root.updateMatrixWorld(true);
    for (const n of CHAIN) {
      const b = P.bones[n];
      if (!b) continue;
      const part = this.byBone.get(n);
      const parent = b.parent as THREE.Object3D;
      if (part) {
        const r = part.body.rotation();
        qa.setFromRotationMatrix(this.m.extractRotation(parent.matrixWorld)).invert();
        qb.set(r.x, r.y, r.z, r.w);
        b.quaternion.copy(qa).multiply(qb);
      }
      b.updateMatrix();
      b.matrixWorld.multiplyMatrices(parent.matrixWorld, b.matrix);
    }
    P.root.updateMatrixWorld(true);
    const h = this.parts[3].body.translation();
    this.head.set(h.x, h.y, h.z);
    // at rest: stop paying for it
    const awake = this.parts.some((p) => !p.body.isSleeping());
    this.asleep = awake ? this.asleep + dt * (this.parts[0].body.linvel().y ** 2 + this.parts[2].body.linvel().x ** 2 < 0.02 ? 1 : 0) : this.asleep + dt * 4;
    if (this.asleep > 2.4 || this.t > 7) this.freeze();
  }

  /** stays where it lies, costs nothing */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    this.dispose(false);
  }

  dispose(forget = true) {
    if (forget || this.frozen) this.ph.forget(this);
    const w = this.ph.world;
    for (const j of this.joints) w.removeImpulseJoint(j, false);
    for (const p of this.parts) {
      this.ph.disown(p.col.handle);
      w.removeRigidBody(p.body);
    }
    this.joints.length = 0;
    this.parts.length = 0;
    this.frozen = true;
  }
}
