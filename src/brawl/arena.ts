import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, worldGroups, propGroups, rv, rq, type PartRef } from './phys.ts';
import type { Fighter } from './fighter.ts';

/**
 * An arena is a Blender scene (public/brawl/<id>.glb) read by naming convention:
 *   col_box_* / col_hull_* / col_mesh_*  collision only (hidden): a box, a convex hull, a triangle mesh
 *   mov_*   a moving part: a kinematic body the arena's script animates by moving the node
 *   dyn_*   a loose prop: a dynamic body, physics moves the node
 *   spawn_* where fighters start
 * Collision nodes belong to the nearest mov_ / dyn_ above them, or to the arena's one fixed body.
 * Custom properties exported from Blender (node.userData) tune them: slick, bumper, mass.
 */

export interface ArenaCtx {
  world: RAPIER.World;
  scene: THREE.Scene;
  parts: Map<number, PartRef>;
  fighters: () => Fighter[];
  sfx: (name: string, at?: THREE.Vector3, gain?: number) => void;
  burst: (at: THREE.Vector3, color: number, n?: number) => void;
}

export interface Mover {
  node: THREE.Object3D;
  body: RAPIER.RigidBody;
}

export interface Prop {
  node: THREE.Object3D;
  body: RAPIER.RigidBody;
  home: THREE.Vector3;
  homeQ: THREE.Quaternion;
}

export interface ArenaLook {
  sky: [number, number];
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunI: number;
  sunDir: [number, number, number];
  hemi: [number, number, number];
  exposure: number;
  bloom: number;
}

export interface ArenaDef {
  id: string;
  name: string;
  blurb: string;
  file: string;
  killY: number;
  /** camera: looks along this yaw, this far down (rad), framing the fighters */
  camYaw: number;
  camPitch: number;
  camMin: number;
  look: ArenaLook;
  /** called once after loading: wire the movers, hazards, effects */
  script(a: Arena, ctx: ArenaCtx): ArenaScript;
}

export interface ArenaScript {
  /** every physics step, before the world steps: move movers */
  step?(dt: number, t: number): void;
  /** every frame: effects */
  frame?(dt: number, t: number): void;
  /** true = this fighter is out (fell in the water, went down the drain) */
  out?(f: Fighter): boolean;
  /** CPU fighters: is this spot safe to stand on */
  safe?(p: THREE.Vector3): boolean;
}

export class Arena {
  root!: THREE.Object3D;
  fixed!: RAPIER.RigidBody;
  movers = new Map<string, Mover>();
  props: Prop[] = [];
  spawns: THREE.Vector3[] = [];
  spawnYaw: number[] = [];
  nodes = new Map<string, THREE.Object3D>();
  script: ArenaScript = {};
  bounds = new THREE.Box3();

  constructor(readonly def: ArenaDef) {}

  build(gltfScene: THREE.Object3D, ctx: ArenaCtx) {
    const W = ctx.world;
    this.root = gltfScene;
    ctx.scene.add(this.root);
    this.root.updateMatrixWorld(true);
    this.fixed = W.createRigidBody(R.RigidBodyDesc.fixed());
    const owner = new Map<THREE.Object3D, RAPIER.RigidBody>();
    const cols: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      this.nodes.set(o.name, o);
      if (o.name.startsWith('spawn_')) {
        const p = new THREE.Vector3();
        o.getWorldPosition(p);
        this.spawns.push(p);
        const d = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
        this.spawnYaw.push(Math.atan2(d.x, d.z));
      }
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        if (o.name.startsWith('col_') || o.parent?.name.startsWith('col_')) {
          cols.push(m);
          m.visible = false;
        } else {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      }
    });
    // bodies for movers and props (outermost first)
    this.root.traverse((o) => {
      if (o.name.startsWith('mov_')) {
        const p = o.getWorldPosition(new THREE.Vector3()), q = o.getWorldQuaternion(new THREE.Quaternion());
        const body = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z).setRotation(rq(q)));
        owner.set(o, body);
        this.movers.set(o.name.slice(4), { node: o, body });
      } else if (o.name.startsWith('dyn_')) {
        const p = o.getWorldPosition(new THREE.Vector3()), q = o.getWorldQuaternion(new THREE.Quaternion());
        const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(rq(q)).setLinearDamping(0.1).setAngularDamping(0.3).setCcdEnabled(true));
        owner.set(o, body);
        this.props.push({ node: o, body, home: p.clone(), homeQ: q.clone() });
      }
    });
    const ownerOf = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) {
        const b = owner.get(p);
        if (b) return { body: b, node: p };
      }
      return { body: this.fixed, node: null as THREE.Object3D | null };
    };
    const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    for (const m of cols) {
      const { body, node } = ownerOf(m);
      if (node) inv.copy(node.matrixWorld).invert();
      else inv.identity();
      rel.multiplyMatrices(inv, m.matrixWorld);
      const ud = { ...(m.parent?.userData ?? {}), ...m.userData } as Record<string, number>;
      const g = m.geometry;
      const kind = m.name.startsWith('col_box') || m.parent?.name.startsWith('col_box') ? 'box' : m.name.startsWith('col_mesh') || m.parent?.name.startsWith('col_mesh') ? 'mesh' : 'hull';
      let desc: RAPIER.ColliderDesc | null = null;
      if (kind === 'box') {
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        rel.decompose(pos, quat, scl);
        const c = bb.getCenter(new THREE.Vector3()).multiply(scl).applyQuaternion(quat).add(pos);
        const h = bb.getSize(new THREE.Vector3()).multiply(scl).multiplyScalar(0.5);
        desc = R.ColliderDesc.cuboid(Math.abs(h.x), Math.abs(h.y), Math.abs(h.z)).setTranslation(c.x, c.y, c.z).setRotation(rq(quat));
      } else {
        const pa = g.getAttribute('position');
        const pts = new Float32Array(pa.count * 3);
        const v = new THREE.Vector3();
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(rel);
          pts[i * 3] = v.x;
          pts[i * 3 + 1] = v.y;
          pts[i * 3 + 2] = v.z;
        }
        if (kind === 'mesh') {
          const idx = g.index ? new Uint32Array(g.index.array) : new Uint32Array(pa.count).map((_, i) => i);
          desc = R.ColliderDesc.trimesh(pts, idx);
        } else desc = R.ColliderDesc.convexHull(pts);
      }
      if (!desc) continue;
      const isProp = body.isDynamic();
      desc.setFriction(ud.friction ?? (ud.slick ? 0.05 : 0.8)).setRestitution(ud.bounce ?? 0.05).setCollisionGroups(isProp ? propGroups() : worldGroups());
      if (isProp) desc.setDensity(ud.density ?? 150);
      const col = W.createCollider(desc, body);
      const ref: PartRef = {};
      if (ud.slick) ref.slick = ud.slick;
      if (ud.bumper) ref.bumper = ud.bumper;
      this.tag(col, ref, m);
      if (Object.keys(ref).length) ctx.parts.set(col.handle, ref);
    }
    for (const p of this.props) if (p.node.userData.mass) {
      const b = p.body;
      const total = b.mass();
      const k = p.node.userData.mass / total;
      for (let i = 0; i < b.numColliders(); i++) b.collider(i).setDensity(b.collider(i).density() * k);
    }
    for (const p of this.props) p.body.recomputeMassPropertiesFromColliders();
    this.bounds.setFromObject(this.root);
    // spawn order: around the middle, alternating sides
    if (!this.spawns.length) for (let i = 0; i < 8; i++) {
      this.spawns.push(new THREE.Vector3(Math.cos(i * 0.785) * 3, 1, Math.sin(i * 0.785) * 3));
      this.spawnYaw.push(0);
    }
    this.script = this.def.script(this, ctx);
  }

  /** colliders the script wants to know about by node name (bumpers, belts) */
  colliders = new Map<string, { col: RAPIER.Collider; ref: PartRef }[]>();
  private tag(col: RAPIER.Collider, ref: PartRef, m: THREE.Object3D) {
    const key = (m.name.startsWith('col_') ? m.name : m.parent?.name ?? m.name).replace(/^col_(box|hull|mesh)_/, '').replace(/[._]\d+$/, '');
    let l = this.colliders.get(key);
    if (!l) this.colliders.set(key, (l = []));
    l.push({ col, ref });
  }
  /** put a reference on every collider of that name (and register it) */
  mark(key: string, ctx: ArenaCtx, extra: Partial<PartRef>) {
    for (const e of this.colliders.get(key) ?? []) {
      Object.assign(e.ref, extra);
      ctx.parts.set(e.col.handle, e.ref);
    }
  }

  /** before each physics step: kinematic bodies follow their nodes */
  syncMovers() {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    for (const m of this.movers.values()) {
      m.node.updateWorldMatrix(true, false);
      m.node.getWorldPosition(p);
      m.node.getWorldQuaternion(q);
      m.body.setNextKinematicTranslation(rv(p));
      m.body.setNextKinematicRotation(rq(q));
    }
  }

  /** after the frame's steps: props' nodes follow their bodies */
  syncProps() {
    for (const pr of this.props) {
      const t = pr.body.translation(), r = pr.body.rotation();
      const n = pr.node;
      const parent = n.parent!;
      parent.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion(r.x, r.y, r.z, r.w), new THREE.Vector3(1, 1, 1));
      m.premultiply(new THREE.Matrix4().copy(parent.matrixWorld).invert());
      m.decompose(n.position, n.quaternion, new THREE.Vector3());
    }
  }

  dispose(ctx: ArenaCtx) {
    ctx.scene.remove(this.root);
    for (const m of this.movers.values()) ctx.world.removeRigidBody(m.body);
    for (const p of this.props) ctx.world.removeRigidBody(p.body);
    ctx.world.removeRigidBody(this.fixed);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        for (const mat of ([] as THREE.Material[]).concat(m.material)) mat.dispose();
      }
    });
  }
}
