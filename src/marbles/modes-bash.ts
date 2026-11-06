import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRAVITY, Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { Scores, type Who } from './modes-play.ts';
import { CAR, type BumpArena, type CarState } from './course-bumper.ts';
import { STOMP, type StompArena } from './course-stomp.ts';
import { glowMat } from './obs-world.ts';
import { makeCrown } from './course-kit.ts';

/**
 * The game side of Bumper Bash and Stomp Town. Each browser feels what happens to its own beans,
 * from where it sees everyone else's, and tells the host what it comes to; the host keeps the book.
 */

type Bean = Who & { rig: { root: THREE.Object3D }; s: number };

export interface BumpHit {
  x: number;
  y: number;
  z: number;
  /** how hard */
  power: number;
  /** who was in it (-1: a bumper or the arm), and which of them did the hitting */
  a: number;
  b: number;
  by: number;
}

/** Bumper Bash: car on car, the bumpers and the arm, knockouts, and the cars themselves */
export class BumpPlay extends Scores {
  readonly arena: BumpArena;
  /** this frame's bangs (for the sparks and the noise) */
  readonly hits: BumpHit[] = [];
  /** this browser's cars that went over the edge this frame */
  readonly fallen: Bean[] = [];
  private lastKO = new Map<number, number>();
  private pairT = new Map<number, number>();
  private parts: THREE.InstancedMesh[];
  private shell: THREE.InstancedMesh;
  private tip: THREE.InstancedMesh;
  private flame: THREE.InstancedMesh;
  private crown: THREE.Object3D;
  private M = new THREE.Matrix4();
  private P = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private E = new THREE.Euler(0, 0, 0, 'YXZ');
  private S = new THREE.Vector3(1, 1, 1);
  private C = new THREE.Color();
  /** the leader, who's worth more */
  leader = -1;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private beans: () => Bean[],
  ) {
    super(beans);
    this.arena = course.bump!;
    const n = beans().length;
    // the tub: a fat round shell with room for a bean in it, a little longer than it's wide
    const prof = [[0.9, 0.12], [1.08, 0.18], [1.12, 0.46], [1.03, 0.78], [0.93, 0.84], [0.84, 0.72], [0.8, 0.3], [0.01, 0.26]].map(([x, y]) => new THREE.Vector2(x, y));
    const tub = new THREE.LatheGeometry(prof, 36).scale(1, 1, 1.16);
    const nose = new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.1, 0.62, 0.8).translate(0, 0.56, 0.86);
    const fin = new THREE.BoxGeometry(0.1, 0.5, 0.56).translate(0, 1.02, -1.02);
    const shellG = mergeGeometries([tub, nose, fin].map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
    shellG.computeVertexNormals();
    this.shell = new THREE.InstancedMesh(shellG, new THREE.MeshPhysicalMaterial({ roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 }), n);
    const rubber = new THREE.InstancedMesh(new THREE.TorusGeometry(1.14, 0.2, 10, 44).rotateX(Math.PI / 2).scale(1, 1, 1.16).translate(0, 0.32, 0), new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.7 }), n);
    const trim = new THREE.InstancedMesh(new THREE.TorusGeometry(1.0, 0.045, 8, 44).rotateX(Math.PI / 2).scale(1, 1, 1.16).translate(0, 0.8, 0), new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.2 }), n);
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 1.5, 8).translate(0, 1.3, -0.92), new THREE.MeshPhysicalMaterial({ color: 0xd8dce8, metalness: 0.9, roughness: 0.3 }), n);
    const eyes = new THREE.InstancedMesh(mergeGeometries([-1, 1].map((s) => new THREE.SphereGeometry(0.15, 12, 10).translate(s * 0.46, 0.56, 1.28)))!, glowMat(0xfff4c0, 2.4), n);
    this.tip = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 14, 10).translate(0, 2.08, -0.92), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.flame = new THREE.InstancedMesh(new THREE.ConeGeometry(0.34, 1.6, 14).rotateX(-Math.PI / 2).translate(0, 0.46, -2), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), n);
    this.parts = [this.shell, rubber, trim, pole, eyes, this.tip];
    for (const q of this.parts) {
      q.frustumCulled = false;
      q.castShadow = q === this.shell || q === rubber;
      scene.add(q);
    }
    this.flame.frustumCulled = false;
    scene.add(this.flame);
    this.crown = makeCrown();
    this.crown.scale.setScalar(0.62);
    this.crown.visible = false;
    scene.add(this.crown);
    beans().forEach((r, k) => {
      this.shell.setColorAt(k, this.C.set(r.c.outfit.a));
      this.tip.setColorAt(k, this.C.set(0x5aff8a));
    });
  }

  dispose() {
    this.scene.remove(...this.parts, this.flame, this.crown);
    for (const q of this.parts) q.dispose();
    this.flame.dispose();
  }

  /** a car takes a hit: dv is how hard, (ux, uz) which way */
  private take(m: Marble, c: CarState, ux: number, uz: number, dv: number, by: number, blame: boolean, t: number) {
    const v = Math.max(Math.min(dv, 17) * (1 + c.dmg * CAR.dmgK), 4.5);
    m.vel.x += ux * v;
    m.vel.z += uz * v;
    if (v > CAR.stunAt) {
      m.vel.y = Math.max(m.vel.y, Math.min(7, v * 0.22));
      m.groundT = 1;
      c.stun = CAR.stun;
      c.spin = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.min(9, v * 0.3));
    }
    c.dmg = Math.min(CAR.dmgMax, c.dmg + dv * CAR.dmg);
    if (blame) {
      m.hitBy = by;
      m.hitT = t;
    }
  }

  /** the frame's collisions (all of them seen, only this browser's cars moved) */
  tick(t: number, x: number) {
    const A = this.arena, all = this.beans(), y0 = A.center.y, D = CAR.r * 2;
    this.hits.length = 0;
    this.fallen.length = 0;
    const live = (r: Bean) => !r.out && r.m.active && !r.m.frozen && A.car(r.m.id).ghost <= t;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!live(a)) continue;
      const am = a.m, ca = A.car(am.id);
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!live(b)) continue;
        const bm = b.m;
        const dx = bm.pos.x - am.pos.x, dz = bm.pos.z - am.pos.z;
        if (dx * dx + dz * dz >= D * D || Math.abs(bm.pos.y - am.pos.y) > 1.3) continue;
        const d = Math.hypot(dx, dz) || 0.01, nx = dx / d, nz = dz / d, pen = D - d;
        const wa = a.local ? (b.local ? 0.5 : 1) : 0, wb = b.local ? (a.local ? 0.5 : 1) : 0;
        am.pos.x -= nx * pen * wa;
        am.pos.z -= nz * pen * wa;
        bm.pos.x += nx * pen * wb;
        bm.pos.z += nz * pen * wb;
        const closing = (am.vel.x - bm.vel.x) * nx + (am.vel.z - bm.vel.z) * nz;
        if (closing < 0.6) continue;
        const key = am.id * 64 + bm.id;
        if (t - (this.pairT.get(key) ?? -9) < 0.2) continue;
        this.pairT.set(key, t);
        const sa = Math.hypot(am.vel.x, am.vel.z), sb = Math.hypot(bm.vel.x, bm.vel.z);
        const ma = sa > CAR.top + 1.5 ? CAR.mass : 1, mb = sb > CAR.top + 1.5 ? CAR.mass : 1;
        const toA = ((1 + CAR.e) * closing * mb) / (ma + mb), toB = ((1 + CAR.e) * closing * ma) / (ma + mb);
        if (a.local) this.take(am, ca, -nx, -nz, toA, bm.id, sb >= sa, t);
        if (b.local) this.take(bm, A.car(bm.id), nx, nz, toB, am.id, sa > sb, t);
        this.hits.push({ x: am.pos.x + nx * CAR.r, y: am.pos.y + 0.3, z: am.pos.z + nz * CAR.r, power: closing, a: am.id, b: bm.id, by: sa > sb ? am.id : bm.id });
      }
    }
    const a0 = A.arm(x), ca = Math.cos(a0), sa = Math.sin(a0);
    for (const r of all) {
      const m = r.m;
      if (r.out || !m.active || m.frozen) continue;
      const c = A.car(m.id);
      if (r.local) r.s = c.dmg;
      else c.dmg = r.s;
      if (!r.local || c.ghost > t) continue;
      if (m.pos.y < y0 + 2.4 && m.pos.y > y0 - 1.5) {
        // the bumpers, and the post in the middle
        for (const q of A.bumpers) {
          if (A.gone(q.ring, x)) continue;
          const dx = m.pos.x - q.x, dz = m.pos.z - q.z, d = Math.hypot(dx, dz) || 0.01, need = q.r + CAR.r;
          if (d >= need) continue;
          const nx = dx / d, nz = dz / d, vn = m.vel.x * nx + m.vel.z * nz;
          m.pos.x += nx * (need - d);
          m.pos.z += nz * (need - d);
          if (vn < CAR.bumper) {
            const add = CAR.bumper * (1 + c.dmg * 0.3) - vn;
            m.vel.x += nx * add;
            m.vel.z += nz * add;
            c.stun = Math.max(c.stun, 0.2);
            c.spin = 6;
            q.hit = t;
            this.hits.push({ x: m.pos.x - nx * CAR.r, y: y0 + 1, z: m.pos.z - nz * CAR.r, power: 12, a: m.id, b: -1, by: -1 });
          }
        }
        const rx = m.pos.x - A.center.x, rz = m.pos.z - A.center.z, rr = Math.hypot(rx, rz) || 0.01;
        if (rr < 2.3 + CAR.r) {
          const nx = rx / rr, nz = rz / rr, vn = m.vel.x * nx + m.vel.z * nz;
          m.pos.x += nx * (2.3 + CAR.r - rr);
          m.pos.z += nz * (2.3 + CAR.r - rr);
          if (vn < 7) {
            m.vel.x += nx * (7 - vn);
            m.vel.z += nz * (7 - vn);
          }
        }
        // the arm: hop it, or be swatted the way it's going
        if (m.pos.y - 0.5 < y0 + CAR.armH) {
          const along = rx * ca + rz * sa, perp = -rx * sa + rz * ca, need = CAR.r + 0.31;
          if (Math.abs(along) < CAR.armLen + 0.4 && Math.abs(perp) < need) {
            const s = perp >= 0 ? 1 : -1, nx = -sa * s, nz = ca * s;
            m.pos.x += nx * (need - Math.abs(perp));
            m.pos.z += nz * (need - Math.abs(perp));
            const vn = m.vel.x * nx + m.vel.z * nz;
            if (vn < CAR.arm) {
              const add = CAR.arm * (1 + c.dmg * 0.4) - vn;
              m.vel.x += nx * add;
              m.vel.z += nz * add;
              m.vel.y = Math.max(m.vel.y, 5);
              m.groundT = 1;
              c.stun = CAR.stun;
              c.spin = 10;
              c.dmg = Math.min(CAR.dmgMax, c.dmg + 0.08);
              this.hits.push({ x: m.pos.x, y: y0 + 1, z: m.pos.z, power: 14, a: m.id, b: -1, by: -1 });
            }
          }
        }
      }
      if (m.pos.y < y0 - CAR.fall) this.fallen.push(r);
    }
  }

  /** (the host) a car went off: who gets what */
  ko(id: number, by: number, x: number, t: number) {
    const dbl = this.arena.frenzy(x) ? 2 : 1;
    if (by < 0) return { v: 0, n: 0, o: this.add(id, -CAR.fell), chain: false, crown: false };
    const crown = id === this.leader;
    const chain = t - (this.lastKO.get(by) ?? -99) < CAR.chainT;
    this.lastKO.set(by, t);
    const v = (CAR.ko + (chain ? CAR.chain : 0) + (crown ? CAR.crown : 0)) * dbl;
    return { v, n: this.add(by, v), o: this.add(id, -CAR.knocked), chain, crown };
  }

  /** the cars, under their beans */
  sync(t: number, dt: number) {
    const { M, P, Q, E, S, C } = this;
    const A = this.arena;
    const all = this.beans();
    const top = this.ranking()[0];
    this.leader = top && this.of(top.m.id) > 0 ? top.m.id : -1;
    let fl = 0;
    all.forEach((r, k) => {
      const m = r.m, c = A.car(m.id);
      const gone = r.out || !m.active;
      const blink = c.ghost > t && Math.floor(t * 12) % 2 === 0;
      r.rig.root.position.y += 0.34;
      // (a ghost, just back in: car and bean flicker together)
      if (blink) r.rig.root.visible = false;
      const sp = m.vel.x * Math.cos(m.yaw) - m.vel.z * Math.sin(m.yaw);
      E.set(THREE.MathUtils.clamp(-m.vel.y * 0.03, -0.4, 0.4), m.yaw, THREE.MathUtils.clamp(sp * 0.018, -0.3, 0.3));
      Q.setFromEuler(E);
      P.copy(m.pos);
      P.y -= 0.5;
      S.setScalar(gone || blink ? 0.0001 : 1);
      M.compose(P, Q, S);
      for (const q of this.parts) q.setMatrixAt(k, M);
      // (the tip of the pole says how much damage you've taken: green to red)
      this.tip.setColorAt(k, C.setHSL(Math.max(0, 0.36 - c.dmg * 0.27), 1, 0.55).multiplyScalar(2.4));
      const fast = Math.hypot(m.vel.x, m.vel.z) > CAR.top + 2 && !gone;
      if (fast || c.flame > 0) {
        S.set(1, 1, 0.8 + Math.random() * 0.5);
        this.flame.setMatrixAt(fl++, M.compose(P, Q, S));
      }
      if (m.id === this.leader && !gone) {
        this.crown.visible = true;
        this.crown.position.set(m.pos.x, m.pos.y + 2.2, m.pos.z);
        this.crown.rotation.y += dt * 2.4;
      }
    });
    if (this.leader < 0) this.crown.visible = false;
    this.flame.count = fl;
    this.flame.instanceMatrix.needsUpdate = true;
    for (const q of this.parts) q.instanceMatrix.needsUpdate = true;
    this.tip.instanceColor!.needsUpdate = true;
  }
}

/** a block of a house in the air */
interface Brick {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  w: number;
  s: number;
  life: number;
}

const BRICKS = 320;

/** Stomp Town: who's big, what they land on, the flat beans, the rubble */
export class StompPlay extends Scores {
  readonly arena: StompArena;
  /** the wave this browser has reached */
  n = -1;
  /** it just changed */
  waved = false;
  /** who was flattened this wave */
  readonly hurt = new Set<number>();
  /** the giants of the wave that just ended, and who got through it flat-free */
  readonly endedOK: number[] = [];
  /** this frame: landings seen; this browser's beans flattened; this browser's giants' wrecking */
  readonly lands: { x: number; y: number; z: number; flop: boolean; id: number }[] = [];
  readonly squashes: { id: number; by: number }[] = [];
  readonly smashes: { k: number; id: number }[] = [];
  private air = new Map<number, number>();
  private ring: THREE.InstancedMesh;
  private brick: THREE.InstancedMesh;
  private bricks: Brick[] = [];
  private nextBrick = 0;
  private M = new THREE.Matrix4();
  private P = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private E = new THREE.Euler();
  private S = new THREE.Vector3();
  private C = new THREE.Color();

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private beans: () => Bean[],
    key: number,
  ) {
    super(beans);
    this.arena = course.stomp!;
    const all = beans();
    this.arena.deal(all.map((r) => r.m.id), all.filter((r) => r.c.human).map((r) => r.m.id), key);
    this.ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.84, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), 16);
    this.ring.frustumCulled = false;
    this.ring.setColorAt(0, this.C.set(0xffffff));
    this.ring.count = 0;
    this.brick = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6 }), BRICKS);
    this.brick.frustumCulled = false;
    this.brick.castShadow = true;
    this.brick.setColorAt(0, this.C.set(0xffffff));
    this.M.makeScale(0, 0, 0);
    for (let k = 0; k < BRICKS; k++) {
      this.brick.setMatrixAt(k, this.M);
      this.bricks.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, w: 0, s: 0, life: 0 });
    }
    scene.add(this.ring, this.brick);
  }

  dispose() {
    this.scene.remove(this.ring, this.brick);
    this.ring.dispose();
    this.brick.dispose();
  }

  /** the ones with the run of the town right now */
  private big(x: number) {
    const A = this.arena;
    return this.beans().filter((r) => !r.out && r.m.active && A.isGiant(r.m.id, x));
  }

  private flatten(r: Bean, by: number, t: number) {
    const A = this.arena, m = r.m;
    A.flat.set(m.id, t + STOMP.flat);
    this.hurt.add(m.id);
    m.mode = Mode.Run;
    m.tumbleT = 0;
    m.vel.set(0, 0, 0);
    m.frozen = true;
    this.squashes.push({ id: m.id, by });
  }

  tick(dt: number, t: number, x: number) {
    const A = this.arena, all = this.beans(), y0 = A.center.y;
    this.lands.length = this.squashes.length = this.smashes.length = 0;
    if (x < STOMP.lead) return;
    const n = A.wave(x);
    if (n !== this.n) {
      // (who came through the wave that's ending)
      this.endedOK.length = 0;
      if (this.n >= 0) for (const r of all) if (!r.out && !A.turns[this.n]?.includes(r.m.id) && !this.hurt.has(r.m.id)) this.endedOK.push(r.m.id);
      this.n = n;
      this.waved = true;
      this.hurt.clear();
      if (n > 0) A.rebuild(t);
      // (a new giant gets up off the floor)
      for (const r of all) {
        if (!A.isGiant(r.m.id, x)) continue;
        A.flat.delete(r.m.id);
        A.safe.delete(r.m.id);
        if (r.local) {
          r.m.frozen = false;
          r.m.mode = Mode.Run;
          r.m.tumbleT = 0;
          r.m.upT = 0;
        }
      }
    }
    // (a giant does nothing until it's done growing: you get that long to get out from under it)
    const big = this.big(x), strong = A.size(x) >= 1;
    for (const g of big) {
      const m = g.m, up = m.groundT > 0.12;
      const was = this.air.get(m.id) ?? 0;
      if (up) this.air.set(m.id, was + dt);
      else {
        this.air.set(m.id, 0);
        if (was >= STOMP.air && strong) {
          const flop = A.flops.delete(m.id) || m.mode === Mode.Dive;
          this.lands.push({ x: m.pos.x, y: m.pos.y - 0.5, z: m.pos.z, flop, id: m.id });
          this.landed(g, flop, t, x);
        }
      }
    }
    // my beans: under a foot?
    if (strong) {
      for (const r of all) {
        const m = r.m;
        if (!r.local || r.out || !m.active || A.isGiant(m.id, x) || m.frozen || (A.safe.get(m.id) ?? 0) > t) continue;
        for (const g of big) {
          const dx = g.m.pos.x - m.pos.x, dz = g.m.pos.z - m.pos.z, dy = g.m.pos.y - m.pos.y;
          if (dx * dx + dz * dz < STOMP.foot * STOMP.foot && dy < STOMP.clear && dy > -3) {
            this.flatten(r, g.m.id, t);
            break;
          }
        }
      }
      // my giants: through a house?
      for (const g of big) {
        if (!g.local) continue;
        const m = g.m;
        for (const q of A.houses) {
          if (q.gone || m.pos.y - 0.5 > y0 + q.h + 1.2) continue;
          if (Math.abs(q.x - m.pos.x) < q.hx + STOMP.foot * 0.9 && Math.abs(q.z - m.pos.z) < q.hz + STOMP.foot * 0.9) this.smashes.push({ k: q.k, id: m.id });
        }
        // (and two giants don't stand in each other)
        for (const o of big) {
          if (o === g) continue;
          const dx = m.pos.x - o.m.pos.x, dz = m.pos.z - o.m.pos.z, d = Math.hypot(dx, dz) || 0.01;
          if (d < 4.4) {
            m.vel.x += (dx / d) * 30 * dt;
            m.vel.z += (dz / d) * 30 * dt;
          }
        }
      }
    }
    // up off the floor
    for (const r of all) {
      const until = A.flat.get(r.m.id);
      if (until === undefined || t < until) continue;
      A.flat.delete(r.m.id);
      A.safe.set(r.m.id, t + STOMP.safe);
      if (r.local) {
        r.m.frozen = false;
        r.m.vel.y = 7.5;
        r.m.groundT = 1;
      }
    }
  }

  /** a giant came down: flat near it, thrown clear further out (this browser's beans) */
  private landed(g: Bean, flop: boolean, t: number, x: number) {
    const A = this.arena;
    const hit = flop ? STOMP.flopHit : STOMP.hit, blast = flop ? STOMP.flopBlast : STOMP.blast;
    for (const r of this.beans()) {
      const m = r.m;
      if (!r.local || r.out || !m.active || m.frozen || A.isGiant(m.id, x)) continue;
      const dx = m.pos.x - g.m.pos.x, dz = m.pos.z - g.m.pos.z, d = Math.hypot(dx, dz) || 0.01;
      if (d > blast || m.pos.y - g.m.pos.y > 3.5) continue;
      if (d < hit && (A.safe.get(m.id) ?? 0) <= t) {
        this.flatten(r, g.m.id, t);
        continue;
      }
      const k = 7 + 12 * (1 - d / blast);
      m.vel.x += (dx / d) * k;
      m.vel.z += (dz / d) * k;
      m.vel.y = Math.max(m.vel.y, 7);
      m.groundT = 1;
      m.knock(0.55);
    }
  }

  /** a house comes apart */
  rubble(k: number, by: Marble | null) {
    const q = this.arena.houses[k];
    if (!q) return;
    const y0 = this.arena.center.y;
    const n = 16;
    const dirX = by ? by.vel.x * 0.35 : 0, dirZ = by ? by.vel.z * 0.35 : 0;
    for (let i = 0; i < n; i++) {
      const j = this.nextBrick;
      this.nextBrick = (j + 1) % BRICKS;
      const b = this.bricks[j];
      b.x = q.x + (Math.random() * 2 - 1) * q.hx;
      b.y = y0 + Math.random() * q.h;
      b.z = q.z + (Math.random() * 2 - 1) * q.hz;
      b.vx = (Math.random() * 2 - 1) * 8 + dirX;
      b.vz = (Math.random() * 2 - 1) * 8 + dirZ;
      b.vy = 5 + Math.random() * 10;
      b.r = Math.random() * 6;
      b.w = (Math.random() * 2 - 1) * 9;
      b.s = 0.45 + Math.random() * 0.75;
      b.life = 1.7 + Math.random() * 0.9;
      this.brick.setColorAt(j, this.C.set(i % 4 === 0 ? q.roof : q.color));
    }
    this.brick.instanceColor!.needsUpdate = true;
  }

  /** what you see of it */
  sync(t: number, dt: number, x: number) {
    const { M, P, Q, E, S } = this;
    const A = this.arena, y0 = A.center.y;
    const size = A.size(x);
    // (it pops up past full size and settles: a jolt, not a slide)
    const e = size >= 1 ? 1 : size <= 0 ? 0 : 1 + 2.7 * (size - 1) ** 3 + 1.7 * (size - 1) ** 2;
    let k = 0;
    // (the next lot get a ring that says so, a couple of seconds early)
    const soon = x < STOMP.lead ? A.turns[0] : A.into(x) > A.W - STOMP.mark ? A.turns[A.wave(x) + 1] : undefined;
    for (const r of this.beans()) {
      const m = r.m, root = r.rig.root;
      const flat = A.flat.get(m.id);
      if (x >= 0 && A.isGiant(m.id, x)) {
        root.scale.setScalar(1 + (STOMP.scale - 1) * e);
        if (r.out || !m.active || k >= 16) continue;
        // the danger: round your feet on the ground, and where you'll come down in the air
        P.set(m.pos.x, y0 + 0.08, m.pos.z);
        let rad = STOMP.foot;
        if (m.groundT > 0.12) {
          const h = m.pos.y - 0.5 - y0, g = GRAVITY, v = m.vel.y;
          const T = (v + Math.sqrt(Math.max(0, v * v + 2 * g * Math.max(0, h)))) / g;
          P.x = THREE.MathUtils.clamp(m.pos.x + m.vel.x * T, A.center.x - A.H, A.center.x + A.H);
          P.z = THREE.MathUtils.clamp(m.pos.z + m.vel.z * T, A.center.z - A.H, A.center.z + A.H);
          rad = (m.mode === Mode.Dive ? STOMP.flopHit : STOMP.hit) * (1 + Math.sin(t * 22) * 0.04);
        }
        this.ring.setColorAt(k, this.C.set(0xff3a2a));
        this.ring.setMatrixAt(k++, M.compose(P, Q.identity(), S.set(rad, 1, rad)));
      } else if (flat !== undefined) {
        // (a pancake, with a quick squash on the way down)
        const u = Math.min(1, (t - (flat - STOMP.flat)) / 0.07);
        root.scale.set(1 + 0.75 * u, 1 - 0.87 * u, 1 + 0.75 * u);
      } else root.scale.setScalar(1);
      if (soon?.includes(m.id) && k < 16 && !r.out && m.active && !A.isGiant(m.id, x)) {
        const rad = 2.2 + Math.sin(t * 11) * 0.35;
        P.set(m.pos.x, Math.max(y0 + 0.08, m.pos.y - 0.42), m.pos.z);
        this.ring.setColorAt(k, this.C.set(0xffd23a));
        this.ring.setMatrixAt(k++, M.compose(P, Q.identity(), S.set(rad, 1, rad)));
      }
    }
    this.ring.count = k;
    this.ring.instanceMatrix.needsUpdate = true;
    if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
    let moved = false;
    for (let i = 0; i < BRICKS; i++) {
      const b = this.bricks[i];
      if (b.life <= 0) continue;
      moved = true;
      b.life -= dt;
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.r += b.w * dt;
      if (b.y < y0 + b.s * 0.5) {
        b.y = y0 + b.s * 0.5;
        b.vy *= -0.35;
        b.vx *= 0.6;
        b.vz *= 0.6;
        b.w *= 0.5;
      }
      const s = b.life <= 0 ? 0 : b.s * Math.min(1, b.life * 2.5);
      P.set(b.x, b.y, b.z);
      Q.setFromEuler(E.set(b.r, b.r * 0.7, b.r * 0.4));
      this.brick.setMatrixAt(i, M.compose(P, Q, S.setScalar(s)));
    }
    if (moved) this.brick.instanceMatrix.needsUpdate = true;
  }
}
