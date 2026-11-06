import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { CUP, CUP_COLORS, CUP_NAMES, cupBallArt, type CupArena, type CupBall } from './course-soccer.ts';

/**
 * Bean Cup's rules. The balls are the host's: it moves them, works out the kicks from wherever the
 * beans are, and tells everyone. A guest runs the same flight between the host's reports (no kicks)
 * and eases back onto them, so a ball never stutters.
 */

interface Who {
  c: { id: number; name: string; player: boolean; human: boolean; owner?: string };
  m: Marble;
  out: boolean;
  local: boolean;
}

export type CupEvent =
  | { k: 'goal'; team: number; by: number; own: boolean; ball: number; a: number; b: number }
  | { k: 'kick'; ball: number; id: number; v: number; shot: boolean }
  | { k: 'hit'; id: number; vx: number; vy: number; vz: number }
  | { k: 'bang'; ball: number; v: number };

const P = new THREE.Vector3(), N = new THREE.Vector3(), AX = new THREE.Vector3();
const Q = new THREE.Quaternion();

export class CupPlay {
  readonly arena: CupArena;
  readonly score = [0, 0];
  /** seconds the ball's spent in each team's attacking half: the last word if nothing else settles it */
  readonly attack = [0, 0];
  overtime = false;
  /** the second ball's in */
  second = false;
  private meshes: THREE.Mesh[] = [];
  private marks: THREE.Mesh[] = [];
  private rings: THREE.InstancedMesh;
  private M = new THREE.Matrix4();
  private C = new THREE.Color();
  private S = new THREE.Vector3();
  private net: { p: THREE.Vector3; v: THREE.Vector3 }[];

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.cup!;
    const tex = cupBallArt();
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
    const geo = new THREE.SphereGeometry(CUP.R, 40, 28);
    const ringGeo = new THREE.RingGeometry(CUP.R * 0.9, CUP.R * 1.15, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      const k = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
      m.visible = k.visible = false;
      scene.add(m, k);
      this.meshes.push(m);
      this.marks.push(k);
    }
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.66, 0.085, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ toneMapped: false }), 24);
    this.rings.frustumCulled = false;
    this.rings.setColorAt(0, this.C.set(0xffffff));
    scene.add(this.rings);
    this.net = this.arena.balls.map(() => ({ p: new THREE.Vector3(), v: new THREE.Vector3() }));
  }
  dispose() {
    for (const o of [...this.meshes, ...this.marks]) this.scene.remove(o);
    this.scene.remove(this.rings);
    this.rings.dispose();
  }

  teamOf(id: number) {
    return this.arena.of.get(id) ?? 0;
  }
  nameOf(id: number) {
    return CUP_NAMES[this.teamOf(id)];
  }
  mine() {
    const p = this.who().find((r) => r.c.player);
    if (!p) return null;
    const t = this.teamOf(p.c.id);
    return { name: CUP_NAMES[t], color: CUP_COLORS[t] };
  }
  /** the side going home */
  loser() {
    const [a, b] = this.score;
    if (a !== b) return a < b ? 0 : 1;
    return this.attack[0] < this.attack[1] ? 0 : 1;
  }
  /** is it all over, x seconds after the off? */
  done(x: number) {
    if (x < CUP.T) return false;
    if (this.score[0] !== this.score[1]) return true;
    return x > CUP.T + CUP.over;
  }
  board() {
    const me = this.mine()?.name;
    const top = Math.max(1, this.score[0], this.score[1]);
    return CUP_NAMES.map((n, i) => ({ name: n, color: CUP_COLORS[i], share: this.score[i] / top, mine: n === me, label: String(this.score[i]) }));
  }

  /** a ball onto the pitch from above, where nobody's standing on it */
  private drop(b: CupBall, x: number) {
    const A = this.arena;
    b.pos.set(A.center.x + x, A.center.y + 9, A.center.z);
    b.vel.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
    b.live = true;
    b.backAt = 0;
    b.last = b.prev = -1;
  }
  /** kick off: the first ball down */
  start() {
    this.drop(this.arena.balls[0], 0);
  }

  /** the flight: floor, walls, posts */
  private fly(b: CupBall, h: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, y0 = A.center.y, R = CUP.R;
    b.vel.y -= CUP.g * h;
    b.pos.addScaledVector(b.vel, h);
    const drag = 1 - 0.1 * h;
    b.vel.multiplyScalar(drag);
    if (b.pos.y < y0 + R) {
      b.pos.y = y0 + R;
      if (b.vel.y < -2.2) {
        b.vel.y *= -0.62;
        if (ev && b.vel.y > 6) ev.push({ k: 'bang', ball: i, v: b.vel.y });
      } else b.vel.y = 0;
      const k = 1 - 0.62 * h;
      b.vel.x *= k;
      b.vel.z *= k;
    }
    if (b.pos.y > y0 + CUP.ceil - R && b.vel.y > 0) b.vel.y *= -0.5;
    // in the goal, under the bar: the roof
    const dz = Math.abs(b.pos.z - A.center.z);
    if (dz > CUP.HL && b.pos.y > y0 + CUP.goalH - R && b.vel.y > 0) {
      b.pos.y = y0 + CUP.goalH - R;
      b.vel.y *= -0.3;
    }
    for (const s of A.segs) this.seg(b, s[0], s[1], s[2], s[3], 0.72);
    // over the bar's a wall too, and the bar itself is a bar
    const inX = Math.abs(b.pos.x - A.center.x) < CUP.goalHalf;
    if (inX && dz > CUP.HL - R && dz < CUP.HL + 0.5 && b.pos.y > y0 + CUP.goalH - 0.3) {
      const s = Math.sign(b.pos.z - A.center.z);
      b.pos.z = A.center.z + s * (CUP.HL - R);
      if (b.vel.z * s > 0) b.vel.z *= -0.72;
    }
    for (const o of A.rounds) {
      const dx = b.pos.x - o.x, dzz = b.pos.z - o.z, d = Math.hypot(dx, dzz), r = o.r + R;
      if (d >= r || b.pos.y > y0 + 3.6 || d < 0.01) continue;
      const nx = dx / d, nz = dzz / d;
      b.pos.x = o.x + nx * r;
      b.pos.z = o.z + nz * r;
      const vn = b.vel.x * nx + b.vel.z * nz;
      if (vn < 0) {
        b.vel.x += nx * (-vn * 1.6 + o.kick);
        b.vel.z += nz * (-vn * 1.6 + o.kick);
        if (ev) ev.push({ k: 'bang', ball: i, v: 12 });
      }
    }
    // (nobody kicks that hard, however many of them are in on it)
    const top = b.vel.length();
    if (top > 34) b.vel.multiplyScalar(34 / top);
    // (and however it got there, it isn't leaving)
    const lim = CUP.HL + CUP.goalD - R, limX = CUP.HW - R;
    b.pos.x = THREE.MathUtils.clamp(b.pos.x, A.center.x - limX, A.center.x + limX);
    b.pos.z = THREE.MathUtils.clamp(b.pos.z, A.center.z - lim, A.center.z + lim);
    // it rolls the way it's going
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.05) {
      AX.set(b.vel.z, 0, -b.vel.x).normalize();
      b.quat.premultiply(Q.setFromAxisAngle(AX, (sp / R) * h)).normalize();
    }
  }
  private seg(b: CupBall, x0: number, z0: number, x1: number, z1: number, e: number) {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    const u = THREE.MathUtils.clamp(((b.pos.x - x0) * dx + (b.pos.z - z0) * dz) / l2, 0, 1);
    const cx = x0 + dx * u, cz = z0 + dz * u;
    const nx0 = b.pos.x - cx, nz0 = b.pos.z - cz, d = Math.hypot(nx0, nz0);
    if (d >= CUP.R || d < 1e-4) return;
    const nx = nx0 / d, nz = nz0 / d;
    b.pos.x = cx + nx * CUP.R;
    b.pos.z = cz + nz * CUP.R;
    const vn = b.vel.x * nx + b.vel.z * nz;
    if (vn < 0) {
      b.vel.x -= nx * vn * (1 + e);
      b.vel.z -= nz * vn * (1 + e);
    }
  }

  /** a bean and a ball: dribble, shot, header, or a ball in the face */
  private touch(b: CupBall, i: number, r: Who, t: number, ev: CupEvent[]) {
    const m = r.m;
    P.set(m.pos.x, m.pos.y + 0.55, m.pos.z);
    N.subVectors(b.pos, P);
    const d = N.length();
    const reach = CUP.R + (r.c.human ? 0.95 : 0.78);
    if (d >= reach || d < 1e-3) return;
    N.multiplyScalar(1 / d);
    const hs = Math.hypot(m.vel.x, m.vel.z);
    const rel = (m.vel.x - b.vel.x) * N.x + (m.vel.y - b.vel.y) * N.y + (m.vel.z - b.vel.z) * N.z;
    const speed = b.vel.length();
    // a hard one coming the other way: it wins
    if (speed > 15 && rel < -11 && b.last !== m.id && t - b.kickT > 0.15 && m.mode === Mode.Run) {
      b.vel.multiplyScalar(0.45);
      ev.push({ k: 'hit', id: r.c.id, vx: -N.x * speed * 0.5, vy: 5, vz: -N.z * speed * 0.5 });
      b.prev = b.last;
      b.last = m.id;
      b.pos.copy(P).addScaledVector(N, reach);
      return;
    }
    b.pos.copy(P).addScaledVector(N, reach);
    if (b.pos.y < this.arena.center.y + CUP.R) b.pos.y = this.arena.center.y + CUP.R;
    const air = m.groundT > 0.1;
    const dive = m.mode === Mode.Dive;
    // (a shot goes where you're going, so you can aim it)
    const dx = hs > 1 ? m.vel.x / hs : Math.sin(m.yaw), dz = hs > 1 ? m.vel.z / hs : Math.cos(m.yaw);
    if (rel < -0.5 && !dive) return;
    if (b.last !== m.id) {
      b.prev = b.last;
      b.last = m.id;
    }
    if (dive) {
      if (t - b.kickT < 0.2) return;
      b.kickT = t;
      const v = r.c.human ? 29 : 25;
      b.vel.set(dx * v, 6.5, dz * v);
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: true });
      return;
    }
    if (air && N.y > 0.25) {
      // a header
      if (t - b.kickT < 0.2) return;
      b.kickT = t;
      const v = Math.max(13, hs * 1.5);
      b.vel.set(dx * v, 7 + Math.max(0, m.vel.y) * 0.4, dz * v);
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: true });
      return;
    }
    // the dribble: pushed on ahead of you, mostly the way you're running
    const k = Math.max(0, rel) * 1.25 + 1.5;
    const fx = N.x * 0.5 + dx * 0.5, fz = N.z * 0.5 + dz * 0.5;
    b.vel.x += fx * k;
    b.vel.z += fz * k;
    b.vel.y += Math.max(0, N.y) * k * 0.4;
    if (k > 8) ev.push({ k: 'kick', ball: i, id: m.id, v: k, shot: false });
  }

  /** (the host) the ball's moves, this frame */
  tick(dt: number, t: number, x: number) {
    const ev: CupEvent[] = [];
    const A = this.arena, all = this.who();
    if (!this.second && x > CUP.T - CUP.second) {
      this.second = true;
      this.drop(A.balls[1], 6);
      A.balls[0].backAt && (A.balls[0].backAt = t + 0.5);
    }
    const n = 4, h = dt / n;
    A.balls.forEach((b, i) => {
      if (b.backAt && t >= b.backAt) this.drop(b, i ? 6 : this.second ? -6 : 0);
      if (!b.live && !b.backAt) return;
      for (let k = 0; k < n; k++) {
        this.fly(b, h, ev, i);
        if (!b.live) continue;
        for (const r of all) if (r.m.active && !r.out && !r.m.frozen) this.touch(b, i, r, t, ev);
        const dz = b.pos.z - A.center.z;
        if (Math.abs(dz) > CUP.HL + CUP.R * 0.6 && Math.abs(b.pos.x - A.center.x) < CUP.goalHalf && b.pos.y < A.center.y + CUP.goalH) {
          const team = dz > 0 ? 0 : 1;
          this.score[team]++;
          b.live = false;
          b.backAt = t + CUP.restart;
          const by = b.last;
          ev.push({ k: 'goal', team, by, own: by >= 0 && this.teamOf(by) !== team, ball: i, a: this.score[0], b: this.score[1] });
        }
      }
      if (b.live) this.attack[b.pos.z > A.center.z ? 0 : 1] += dt;
    });
    return ev;
  }

  /** what the host sends */
  packet() {
    const out: number[] = [];
    for (const b of this.arena.balls) out.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.live ? 1 : 0);
    return out.map((v) => Math.round(v * 100) / 100);
  }
  /** a guest hears where they are */
  heard(s: number[], a: number, b: number) {
    this.score[0] = a;
    this.score[1] = b;
    this.arena.balls.forEach((q, i) => {
      const o = i * 7;
      const n = this.net[i];
      n.p.set(s[o], s[o + 1], s[o + 2]);
      n.v.set(s[o + 3], s[o + 4], s[o + 5]);
      const was = q.live;
      q.live = s[o + 6] > 0;
      if (q.live && !was) {
        q.pos.copy(n.p);
        q.vel.copy(n.v);
      }
      q.backAt = q.live ? 0 : 1;
      q.vel.lerp(n.v, 0.6);
    });
  }
  /** (a guest) the flight between reports, leaning back onto the host's */
  follow(dt: number) {
    this.arena.balls.forEach((b, i) => {
      if (!b.live && !b.backAt) return;
      this.fly(b, dt, null, i);
      const n = this.net[i];
      n.p.addScaledVector(n.v, dt);
      if (b.pos.distanceToSquared(n.p) > 36) b.pos.copy(n.p);
      else b.pos.lerp(n.p, Math.min(1, dt * 9));
    });
  }

  /** the nearest ball in play */
  ballNear(p: THREE.Vector3) {
    let best: CupBall | null = null, bd = Infinity;
    for (const b of this.arena.balls) {
      if (!b.live) continue;
      const d = b.pos.distanceToSquared(p);
      if (d < bd) (bd = d), (best = b);
    }
    return best;
  }

  sync() {
    const A = this.arena, y0 = A.center.y;
    A.balls.forEach((b, i) => {
      const on = b.live || !!b.backAt;
      const m = this.meshes[i], k = this.marks[i];
      m.visible = k.visible = on;
      if (!on) return;
      m.position.copy(b.pos);
      m.quaternion.copy(b.quat);
      k.position.set(b.pos.x, y0 + 0.05, b.pos.z);
      const up = b.pos.y - y0 - CUP.R;
      k.scale.setScalar(1 + up * 0.08);
      (k.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.85 - up * 0.08);
    });
    let n = 0;
    const { M, C, S } = this;
    for (const r of this.who()) {
      if (r.out || !r.m.active || n >= 24) continue;
      const lift = THREE.MathUtils.clamp(1 - (r.m.pos.y - y0 - 0.5) * 0.2, 0.45, 1) * (r.c.player ? 1.25 : 1);
      M.makeScale(lift, 1, lift).setPosition(S.set(r.m.pos.x, y0 + 0.06, r.m.pos.z));
      this.rings.setMatrixAt(n, M);
      this.rings.setColorAt(n, C.set(CUP_COLORS[this.teamOf(r.c.id)]));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }
}
