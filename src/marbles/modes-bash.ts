import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRAVITY, Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { Scores, type Who } from './modes-play.ts';
import { CAR, type BumpArena, type CarState } from './course-bumper.ts';
import { glowMat } from './obs-world.ts';
import { makeCrown } from './course-kit.ts';

/**
 * The game side of Bumper Bash. Each browser feels what happens to its own beans,
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
