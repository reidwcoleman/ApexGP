import * as THREE from 'three';
import type { Track } from '../world/Track.ts';

/**
 * Crash debris: carbon shards thrown out of every heavy hit (one instanced mesh,
 * some in the team's paint), and whole parts that break off — wing halves, the
 * rear wing, wheels — tumbling as rigid bodies until they settle on the road or
 * the grass, bouncing off the barriers. Pieces lie where they land for the rest
 * of the session (the oldest are cleared when the pool is full).
 */

const MAX_SHARDS = 700;
const MAX_PARTS = 40;

interface Shard {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  qx: number; qy: number; qz: number; qw: number;
  wx: number; wy: number; wz: number;
  s: number;
  rest: boolean;
  hint: number;
}

interface Part {
  obj: THREE.Object3D;
  v: THREE.Vector3;
  w: THREE.Vector3;
  /** lowest point below the pivot (m), for resting on the ground */
  foot: number;
  rest: boolean;
  hint: number;
  age: number;
}

export class Debris {
  readonly group = new THREE.Group();
  private shardMesh: THREE.InstancedMesh;
  private shards: Shard[] = [];
  private next = 0;
  private parts: Part[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly dq = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly axis = new THREE.Vector3();
  private dirty = false;

  constructor(private readonly track: Track, private readonly terrain: (x: number, z: number) => number) {
    this.group.name = 'debris';
    // a jagged carbon flake: an irregular thin prism
    const g = new THREE.BufferGeometry();
    const top: [number, number][] = [
      [0.5, 0.05], [0.18, 0.42], [-0.3, 0.33], [-0.5, -0.08], [-0.12, -0.45], [0.36, -0.3],
    ];
    const pos: number[] = [];
    const h = 0.06;
    for (let i = 0; i < top.length; i++) {
      const a = top[i], b = top[(i + 1) % top.length];
      pos.push(0, h, 0, a[0], h, a[1], b[0], h, b[1]);
      pos.push(0, -h, 0, b[0], -h, b[1], a[0], -h, a[1]);
      pos.push(a[0], h, a[1], a[0], -h, a[1], b[0], -h, b[1], a[0], h, a[1], b[0], -h, b[1], b[0], h, b[1]);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.15, name: 'debris-carbon' });
    this.shardMesh = new THREE.InstancedMesh(g, mat, MAX_SHARDS);
    this.shardMesh.count = 0;
    this.shardMesh.castShadow = true;
    this.shardMesh.receiveShadow = true;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.setColorAt(0, this.col.set(0x111111));
    this.group.add(this.shardMesh);
  }

  /** ground height under (x, z): the road/verge plane inside the barriers, the terrain beyond */
  private groundAt(x: number, z: number, hint: number): { y: number; hint: number; lat: number; bar: number; nx: number; nz: number } {
    const t = this.track;
    const pr = t.project(x, z, hint);
    const side = pr.lateral >= 0 ? 1 : -1;
    const bar = t.barrierAt(pr.s, side);
    const y = Math.abs(pr.lateral) < bar + 0.3 ? t.point(pr.s, pr.lateral, 0, this.p).y : this.terrain(x, z);
    const i = Math.floor(t.wrap(pr.s));
    const rl = Math.hypot(t.rx[i], t.rz[i]) || 1;
    return { y, hint: pr.index, lat: pr.lateral, bar, nx: (t.rx[i] / rl) * side, nz: (t.rz[i] / rl) * side };
  }

  /**
   * Shards from a hit at (x, y, z): thrown along the car's velocity and away from
   * what it hit (nx, nz = toward the obstacle), `amount` 0..1, some in `paint`.
   */
  burst(x: number, y: number, z: number, vx: number, vz: number, nx: number, nz: number, amount: number, paint: string) {
    const n = Math.round(4 + amount * 26);
    const pc = new THREE.Color(paint);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_SHARDS;
      const sp = 2 + Math.random() * 9 * (0.4 + amount);
      const a = Math.random() * Math.PI * 2;
      const sh: Shard = {
        x: x + (Math.random() - 0.5) * 0.4, y: y + 0.15 + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.4,
        // bounce back off the obstacle, keep most of the car's speed, scatter
        vx: vx * (0.45 + Math.random() * 0.45) - nx * sp * 0.6 + Math.cos(a) * sp * 0.5,
        vy: 1.5 + Math.random() * 5 * (0.5 + amount),
        vz: vz * (0.45 + Math.random() * 0.45) - nz * sp * 0.6 + Math.sin(a) * sp * 0.5,
        qx: 0, qy: 0, qz: 0, qw: 1,
        wx: (Math.random() - 0.5) * 30, wy: (Math.random() - 0.5) * 30, wz: (Math.random() - 0.5) * 30,
        s: 0.04 + Math.random() * Math.random() * 0.2,
        rest: false,
        hint: -1,
      };
      this.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      sh.qx = this.q.x; sh.qy = this.q.y; sh.qz = this.q.z; sh.qw = this.q.w;
      this.shards[i] = sh;
      // most of it is bare carbon; a few flakes carry the paint
      this.shardMesh.setColorAt(i, Math.random() < 0.3 ? pc : this.col.setRGB(0.018, 0.018, 0.02));
      this.shardMesh.instanceColor!.needsUpdate = true;
    }
    this.shardMesh.count = Math.max(this.shardMesh.count, Math.min(MAX_SHARDS, this.shards.length));
    this.dirty = true;
  }

  /** a part that broke off: `obj` is already in world space; it takes the car's velocity plus a kick */
  addPart(obj: THREE.Object3D, vx: number, vy: number, vz: number, spin: number) {
    if (this.parts.length >= MAX_PARTS) {
      const old = this.parts.shift()!;
      old.obj.removeFromParent();
    }
    const box = new THREE.Box3().setFromObject(obj);
    const foot = Math.max(0.03, obj.position.y - box.min.y);
    this.group.add(obj);
    this.parts.push({
      obj,
      v: new THREE.Vector3(vx, vy, vz),
      w: new THREE.Vector3((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin),
      foot,
      rest: false,
      hint: -1,
      age: 0,
    });
  }

  update(dt: number) {
    if (dt <= 0) return;
    const G = 9.81;
    // ---- shards
    const n = this.shardMesh.count;
    for (let i = 0; i < n; i++) {
      const s = this.shards[i];
      if (!s || s.rest) continue;
      s.vy -= G * dt;
      const drag = Math.exp(-0.25 * dt);
      s.vx *= drag;
      s.vz *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const gnd = this.groundAt(s.x, s.z, s.hint);
      s.hint = gnd.hint;
      if (Math.abs(gnd.lat) > gnd.bar && Math.abs(gnd.lat) < gnd.bar + 1.2 && s.y < gnd.y + 1.1) {
        // off the barrier face
        const vn = s.vx * gnd.nx + s.vz * gnd.nz;
        if (vn > 0) {
          s.vx -= 1.4 * vn * gnd.nx;
          s.vz -= 1.4 * vn * gnd.nz;
        }
      }
      const floor = gnd.y + s.s * 0.06;
      if (s.y < floor) {
        s.y = floor;
        if (Math.abs(s.vy) < 1.2 && Math.hypot(s.vx, s.vz) < 1.5) {
          s.rest = true;
          // lie flat
          this.q.set(s.qx, s.qy, s.qz, s.qw);
          const e = new THREE.Euler().setFromQuaternion(this.q, 'YXZ');
          this.q.setFromEuler(new THREE.Euler(0, e.y, 0));
          s.qx = this.q.x; s.qy = this.q.y; s.qz = this.q.z; s.qw = this.q.w;
        } else {
          s.vy = -s.vy * 0.3;
          // flakes skate along the asphalt
          s.vx *= 0.7;
          s.vz *= 0.7;
          s.wx *= 0.6;
          s.wy *= 0.6;
          s.wz *= 0.6;
        }
      }
      if (!s.rest) {
        const wl = Math.hypot(s.wx, s.wy, s.wz);
        if (wl > 1e-3) {
          this.q.set(s.qx, s.qy, s.qz, s.qw);
          this.dq.setFromAxisAngle(this.axis.set(s.wx / wl, s.wy / wl, s.wz / wl), wl * dt);
          this.q.premultiply(this.dq);
          s.qx = this.q.x; s.qy = this.q.y; s.qz = this.q.z; s.qw = this.q.w;
        }
      }
      this.dirty = true;
    }
    if (this.dirty) {
      for (let i = 0; i < n; i++) {
        const s = this.shards[i];
        if (!s) continue;
        this.q.set(s.qx, s.qy, s.qz, s.qw);
        this.m.compose(this.p.set(s.x, s.y, s.z), this.q, this.sc.set(s.s, s.s, s.s));
        this.shardMesh.setMatrixAt(i, this.m);
      }
      this.shardMesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
    // ---- whole parts
    for (const p of this.parts) {
      p.age += dt;
      if (p.rest) continue;
      const o = p.obj;
      p.v.y -= G * dt;
      const k = Math.exp(-0.15 * dt);
      p.v.x *= k;
      p.v.z *= k;
      o.position.addScaledVector(p.v, dt);
      const wl = p.w.length();
      if (wl > 1e-3) {
        this.dq.setFromAxisAngle(this.axis.copy(p.w).divideScalar(wl), wl * dt);
        o.quaternion.premultiply(this.dq);
      }
      const gnd = this.groundAt(o.position.x, o.position.z, p.hint);
      p.hint = gnd.hint;
      if (Math.abs(gnd.lat) > gnd.bar - 0.2 && Math.abs(gnd.lat) < gnd.bar + 1.5 && o.position.y < gnd.y + 1.2) {
        const vn = p.v.x * gnd.nx + p.v.z * gnd.nz;
        if (vn > 0) {
          p.v.x -= 1.3 * vn * gnd.nx;
          p.v.z -= 1.3 * vn * gnd.nz;
          p.w.multiplyScalar(0.7);
        }
      }
      const floor = gnd.y + p.foot * 0.55;
      if (o.position.y < floor) {
        o.position.y = floor;
        if (p.v.y < -1.5) {
          p.v.y = -p.v.y * 0.28;
          // tumbling: trade some spin for scrub
          p.w.multiplyScalar(0.6);
          p.v.x *= 0.72;
          p.v.z *= 0.72;
        } else {
          p.v.y = 0;
          // sliding and scraping to a stop
          const f = Math.exp(-3.2 * dt);
          p.v.x *= f;
          p.v.z *= f;
          p.w.multiplyScalar(Math.exp(-4 * dt));
          if (p.v.lengthSq() < 0.04 && p.w.lengthSq() < 0.05) p.rest = true;
        }
      }
    }
  }

  /** the number of pieces still moving (for the camera / tests) */
  get active(): number {
    return this.parts.filter((p) => !p.rest).length;
  }

  clear() {
    for (const p of this.parts) p.obj.removeFromParent();
    this.parts = [];
    this.shards = [];
    this.next = 0;
    this.shardMesh.count = 0;
  }
}
