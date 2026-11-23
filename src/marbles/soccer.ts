import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { CUP_COLORS, CUP_NAMES, cupBallArt, fenceBallArt, hoopBallArt, pushBallArt, volleyBallArt, type CupArena, type CupBall, type CupCfg } from './course-soccer.ts';

/**
 * Bean Cup's rules. The balls are the host's: it moves them, works out the kicks from wherever the
 * beans are, and tells everyone. A guest runs the same flight between the host's reports (no kicks)
 * and eases back onto them, so a ball never stutters.
 */

interface Who {
  c: { id: number; name: string; player: boolean; human: boolean; owner?: string; skill?: number };
  m: Marble;
  out: boolean;
  local: boolean;
}

export type CupEvent =
  | { k: 'goal'; team: number; by: number; own: boolean; ball: number; a: number; b: number; pts?: number }
  | { k: 'kick'; ball: number; id: number; v: number; shot: boolean }
  | { k: 'hit'; id: number; vx: number; vy: number; vz: number }
  | { k: 'bang'; ball: number; v: number };

const P = new THREE.Vector3(), N = new THREE.Vector3(), AX = new THREE.Vector3();
/** Bean Hoops: how near the iron the middle of the ball can come (less than the ball: a rim that size and a ball that size would never go in) */
const RIM = 0.82;
const Q = new THREE.Quaternion();

export class CupPlay {
  readonly arena: CupArena;
  /** this pitch's numbers (Bean Cup, Big Push or Over the Fence) */
  readonly cfg: CupCfg;
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
  private col = new THREE.Color();
  private S = new THREE.Vector3();
  private net: { p: THREE.Vector3; v: THREE.Vector3 }[];

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.cup!;
    const C = (this.cfg = this.arena.cfg);
    const tex = C.rule === 'push' ? pushBallArt() : C.rule === 'fence' ? fenceBallArt() : C.rule === 'volley' ? volleyBallArt() : C.rule === 'hoops' ? hoopBallArt() : cupBallArt();
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
    const geo = new THREE.SphereGeometry(C.R, 40, 28);
    const ringGeo = new THREE.RingGeometry(C.R * 0.9, C.R * 1.15, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < this.arena.balls.length; i++) {
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
    this.rings.setColorAt(0, this.col.set(0xffffff));
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
    const C = this.cfg;
    if (x < C.T) return false;
    if (this.score[0] !== this.score[1]) return true;
    return x > C.T + C.over;
  }
  /** Over the Fence: how many balls are lying in a team's yard (its score is the other yard's) */
  inYard(team: number) {
    return this.score[team === 0 ? 1 : 0];
  }
  board() {
    const me = this.mine()?.name;
    if (this.cfg.rule === 'fence') {
      const n = this.arena.balls.length;
      return CUP_NAMES.map((name, i) => ({ name, color: CUP_COLORS[i], share: 1 - this.inYard(i) / n, mine: name === me, label: `${this.inYard(i)} IN YARD` }));
    }
    const top = Math.max(1, this.score[0], this.score[1]);
    return CUP_NAMES.map((n, i) => ({ name: n, color: CUP_COLORS[i], share: this.score[i] / top, mine: n === me, label: String(this.score[i]) }));
  }
  /** the score line, as the HUD and the banner say it */
  line() {
    if (this.cfg.rule === 'fence') return `${CUP_NAMES[0]} YARD ${this.inYard(0)} · ${CUP_NAMES[1]} YARD ${this.inYard(1)}`;
    return `${CUP_NAMES[0]} ${this.score[0]} - ${this.score[1]} ${CUP_NAMES[1]}`;
  }

  /** a ball onto the pitch from above, where nobody's standing on it */
  private drop(b: CupBall, x: number, z = 0) {
    const A = this.arena;
    b.pos.set(A.center.x + x, A.center.y + 9, A.center.z + z);
    b.vel.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
    b.live = true;
    b.backAt = 0;
    b.last = b.prev = -1;
    b.by[0] = b.by[1] = -1;
    b.byT[0] = b.byT[1] = -99;
    b.worth = 2;
    b.py = b.pos.y;
  }
  /** kick off: the first ball down */
  start() {
    const A = this.arena, C = this.cfg;
    if (C.rule === 'volley') return this.serve(Math.random() < 0.5 ? 0 : 1);
    if (C.rule !== 'fence') return this.drop(A.balls[0], 0);
    // (Over the Fence: half the balls in each yard, spread across it)
    A.balls.forEach((b, i) => {
      const half = A.balls.length / 2, k = Math.floor(i / 2);
      this.drop(b, ((k + 0.5) / half - 0.5) * (C.HW * 1.5), (i % 2 ? 1 : -1) * C.HL * 0.45);
    });
  }

  /** Volley Folly: the ball comes down from high over the middle of a team's yard (theirs to play) */
  private serve(team: number) {
    const C = this.cfg, s = team === 0 ? -1 : 1;
    this.drop(this.arena.balls[0], (Math.random() - 0.5) * C.HW * 0.9, s * C.HL * (0.35 + Math.random() * 0.3));
    // (a slow one: up a little first, so there's time to get under it)
    this.arena.balls[0].pos.y = this.arena.center.y + 11.5;
    this.arena.balls[0].vel.set(0, 3, 0);
    this.rally.team = -1;
  }

  /** the flight: floor, walls, posts */
  private fly(b: CupBall, h: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, C = this.cfg;
    const was = b.pos.z - A.center.z;
    b.vel.y -= C.g * h;
    b.pos.addScaledVector(b.vel, h);
    const drag = 1 - 0.1 * h;
    b.vel.multiplyScalar(drag);
    this.hold(b, was, h, ev, i);
    // it rolls the way it's going
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.05) {
      AX.set(b.vel.z, 0, -b.vel.x).normalize();
      b.quat.premultiply(Q.setFromAxisAngle(AX, (sp / C.R) * h)).normalize();
    }
  }
  /**
   * Everything that keeps the ball where a ball can be: the floor, the roof, the walls, the posts,
   * the fence, the top speed. Run after the flight and again after the beans have had their touch,
   * so nothing a bean does can leave it in a wall or over the fence for a frame.
   */
  private hold(b: CupBall, was: number, h: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, y0 = A.center.y, C = this.cfg, R = C.R;
    if (b.pos.y < y0 + R) {
      this.down = i;
      b.pos.y = y0 + R;
      if (b.vel.y < -2.2) {
        b.vel.y *= -0.62;
        if (ev && b.vel.y > 6) ev.push({ k: 'bang', ball: i, v: b.vel.y });
      } else b.vel.y = 0;
      const k = 1 - 0.62 * h;
      b.vel.x *= k;
      b.vel.z *= k;
    }
    if (b.pos.y > y0 + C.ceil - R) {
      b.pos.y = y0 + C.ceil - R;
      if (b.vel.y > 0) b.vel.y *= -0.5;
    }
    // in the goal, under the bar: the roof
    const dz = Math.abs(b.pos.z - A.center.z);
    if (C.goalHalf > 0 && dz > C.HL && b.pos.y > y0 + C.goalH - R && b.vel.y > 0) {
      b.pos.y = y0 + C.goalH - R;
      b.vel.y *= -0.3;
    }
    for (const s of A.segs) this.seg(b, s[0], s[1], s[2], s[3], 0.72);
    // the bar is a bar (the ball comes off it whichever way it met it: nothing snaps back onto the
    // pitch), and over it is the wall
    const inX = Math.abs(b.pos.x - A.center.x) < C.goalHalf;
    if (inX && C.goalHalf > 0) {
      const s = Math.sign(b.pos.z - A.center.z) || 1;
      const zb = dz - C.HL, up = b.pos.y - (y0 + C.goalH);
      const d = Math.hypot(zb, up), rr = R + 0.34;
      if (d < rr && d > 1e-3) {
        const nz = zb / d, ny = up / d;
        b.pos.z = A.center.z + s * (C.HL + nz * rr);
        b.pos.y = y0 + C.goalH + ny * rr;
        const vn = b.vel.z * s * nz + b.vel.y * ny;
        if (vn < 0) {
          b.vel.z -= s * nz * vn * 1.6;
          b.vel.y -= ny * vn * 1.6;
          if (ev && vn < -5) ev.push({ k: 'bang', ball: i, v: 10 });
        }
      } else if (up > 0 && zb > -R && zb < 0.5) {
        b.pos.z = A.center.z + s * (C.HL - R);
        if (b.vel.z * s > 0) b.vel.z *= -0.72;
      }
    }
    this.fenceHold(b, was, ev, i);
    // the big bumpers: a drum with a top to it, so a ball coming down onto one rolls off it
    // (a drum with no top let a bouncing ball sink into it, then threw it out sideways)
    for (const o of A.rounds) {
      const dx = b.pos.x - o.x, dzz = b.pos.z - o.z, d = Math.hypot(dx, dzz);
      if (d >= o.r + R || d < 0.01) continue;
      const rr = Math.min(d, o.r), cy = THREE.MathUtils.clamp(b.pos.y - y0, 0, 3);
      const px = o.x + (dx / d) * rr, pz = o.z + (dzz / d) * rr, py = y0 + cy;
      let nx = b.pos.x - px, ny = b.pos.y - py, nz = b.pos.z - pz;
      const gap = Math.hypot(nx, ny, nz);
      if (gap >= R) continue;
      if (gap < 1e-3) (nx = dx / d), (ny = 0), (nz = dzz / d);
      else (nx /= gap), (ny /= gap), (nz /= gap);
      b.pos.set(px + nx * R, py + ny * R, pz + nz * R);
      const vn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
      if (vn < 0) {
        const j = -vn * 1.6 + o.kick * Math.hypot(nx, nz);
        b.vel.x += nx * j;
        b.vel.y += ny * j;
        b.vel.z += nz * j;
        if (ev) ev.push({ k: 'bang', ball: i, v: 12 });
      }
    }
    // Bean Hoops: the rims. A ball can drop through the middle; anywhere on the iron it comes off it
    for (const H of A.hoops) {
      const hx = b.pos.x - H.x, hz = b.pos.z - H.z, hr = Math.hypot(hx, hz);
      if (hr < 1e-3 || hr > C.hoopR + R || Math.abs(b.pos.y - H.y) > R) continue;
      // the nearest point of the ring
      const px = H.x + (hx / hr) * C.hoopR, pz = H.z + (hz / hr) * C.hoopR;
      let nx = b.pos.x - px, ny = b.pos.y - H.y, nz = b.pos.z - pz;
      const d = Math.hypot(nx, ny, nz);
      if (d >= RIM || d < 1e-3) continue;
      nx /= d;
      ny /= d;
      nz /= d;
      b.pos.set(px + nx * RIM, H.y + ny * RIM, pz + nz * RIM);
      const vn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
      if (vn < 0) {
        b.vel.x -= nx * vn * 1.5;
        b.vel.y -= ny * vn * 1.5;
        b.vel.z -= nz * vn * 1.5;
        if (ev && vn < -3) ev.push({ k: 'bang', ball: i, v: 9 });
      }
    }
    // (nobody kicks that hard, however many of them are in on it)
    const top = b.vel.length();
    if (top > C.top) b.vel.multiplyScalar(C.top / top);
    // (and however it got there, it isn't leaving)
    const lim = C.HL + C.goalD - R, limX = C.HW - R;
    b.pos.x = THREE.MathUtils.clamp(b.pos.x, A.center.x - limX, A.center.x + limX);
    b.pos.z = THREE.MathUtils.clamp(b.pos.z, A.center.z - lim, A.center.z + lim);
  }
  /** a bean has it against them: eased out of the bean, never thrown (no jumps on the screen) */
  private clear(b: CupBall, reach: number) {
    const gap = Math.min(reach - P.distanceTo(b.pos), this.give);
    if (gap > 0) {
      b.pos.addScaledVector(N, gap);
      this.give -= gap;
    }
    const floor = this.arena.center.y + this.cfg.R;
    if (b.pos.y < floor) b.pos.y = floor;
  }
  /** how far the beans can still ease the ball this step, and the ball that touched the floor in it */
  private give = 0;
  private down = -1;
  /** who had it last, for each side (a goal is theirs) */
  private touched(b: CupBall, id: number, t: number) {
    if (b.last !== id) {
      b.prev = b.last;
      b.last = id;
    }
    const team = this.teamOf(id);
    b.by[team] = id;
    b.byT[team] = t;
  }
  /** Over the Fence: low enough, the net stops it; over the top it goes */
  private fenceHold(b: CupBall, was: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, C = this.cfg;
    if (C.fenceH <= 0 || Math.abs(was) < 1e-3) return;
    const now = b.pos.z - A.center.z;
    const side = Math.sign(was);
    const up = b.pos.y - (A.center.y + C.fenceH);
    if (up > 0) {
      // (above the top: the rail along it is a bar the ball rolls off, one way or the other)
      const d = Math.hypot(now, up);
      if (d >= C.R) return;
      const nz = d > 1e-3 ? now / d : side * 0.3, ny = d > 1e-3 ? up / d : 0.95;
      b.pos.z = A.center.z + nz * C.R;
      b.pos.y = A.center.y + C.fenceH + ny * C.R;
      const vn = b.vel.z * nz + b.vel.y * ny;
      if (vn < 0) {
        b.vel.z -= nz * vn * 1.45;
        b.vel.y -= ny * vn * 1.45;
        if (ev && vn < -4) ev.push({ k: 'bang', ball: i, v: 8 });
      }
      return;
    }
    if (Math.abs(now) >= C.R && Math.sign(now) === side) return;
    b.pos.z = A.center.z + side * C.R;
    if (b.vel.z * side < 0) {
      b.vel.z *= -0.5;
      if (ev && Math.abs(b.vel.z) > 3) ev.push({ k: 'bang', ball: i, v: 8 });
    }
  }
  private seg(b: CupBall, x0: number, z0: number, x1: number, z1: number, e: number) {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    const u = THREE.MathUtils.clamp(((b.pos.x - x0) * dx + (b.pos.z - z0) * dz) / l2, 0, 1);
    const cx = x0 + dx * u, cz = z0 + dz * u;
    const nx0 = b.pos.x - cx, nz0 = b.pos.z - cz, d = Math.hypot(nx0, nz0);
    const R = this.cfg.R;
    if (d >= R || d < 1e-4) return;
    const nx = nx0 / d, nz = nz0 / d;
    b.pos.x = cx + nx * R;
    b.pos.z = cz + nz * R;
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
    const C = this.cfg;
    // (Volley Folly: you have to get properly under it)
    const reach = C.R + (C.rule === 'volley' ? (r.c.human ? 0.8 : 0.5) : r.c.human ? 0.95 : 0.78);
    if (d >= reach || d < 1e-3) return;
    N.multiplyScalar(1 / d);
    const hs = Math.hypot(m.vel.x, m.vel.z);
    const rel = (m.vel.x - b.vel.x) * N.x + (m.vel.y - b.vel.y) * N.y + (m.vel.z - b.vel.z) * N.z;
    const speed = b.vel.length();
    const air = m.groundT > 0.1;
    const dive = m.mode === Mode.Dive;
    // (a shot goes where you're going, so you can aim it)
    const dx = hs > 1 ? m.vel.x / hs : Math.sin(m.yaw), dz = hs > 1 ? m.vel.z / hs : Math.cos(m.yaw);
    if (C.rule === 'volley') return this.bump(b, i, r, t, ev, dx, dz, dive || (air && N.y > 0.2));
    if (C.rule === 'hoops' && (dive || (air && N.y > 0.25))) return this.shoot(b, i, r, t, ev, dx, dz, !dive);
    // (a shot just gone up isn't knocked off its line by everyone stood round it: only a dive or a jump gets to it)
    if (C.rule === 'hoops' && t - b.kickT < 0.4) return;
    // a hard one coming the other way: it wins
    if (speed > 15 && rel < -11 && C.rule !== 'push' && C.rule !== 'hoops' && b.last !== m.id && t - b.kickT > 0.15 && m.mode === Mode.Run) {
      b.vel.multiplyScalar(0.45);
      ev.push({ k: 'hit', id: r.c.id, vx: -N.x * speed * 0.5, vy: 5, vz: -N.z * speed * 0.5 });
      this.touched(b, m.id, t);
      this.clear(b, reach);
      return;
    }
    this.clear(b, reach);
    if (rel < -0.5 && !dive) return;
    this.touched(b, m.id, t);
    // (dribbled since it was shot: it's a two again)
    b.worth = 2;
    if (dive) {
      if (t - b.kickT < 0.2) return;
      b.kickT = t;
      const v = (r.c.human ? 29 : 25) * C.kick;
      if (C.rule === 'push') {
        // (a shove: it adds to how the ball's already going)
        b.vel.x += dx * v;
        b.vel.z += dz * v;
        b.vel.y = Math.max(b.vel.y, C.loft);
      } else b.vel.set(dx * v, C.loft, dz * v);
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: true });
      return;
    }
    if (air && N.y > 0.25 && C.rule !== 'push') {
      // a header
      if (t - b.kickT < 0.2) return;
      b.kickT = t;
      const v = Math.max(13, hs * 1.5);
      b.vel.set(dx * v, 7 + Math.max(0, m.vel.y) * 0.4, dz * v);
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: true });
      return;
    }
    // the dribble: pushed on ahead of you, mostly the way you're running
    const k = (Math.max(0, rel) * 1.25 + 1.5) * C.push;
    const fx = N.x * 0.5 + dx * 0.5, fz = N.z * 0.5 + dz * 0.5;
    b.vel.x += fx * k;
    b.vel.z += fz * k;
    b.vel.y += Math.max(0, N.y) * k * 0.4;
    if (k > 8) ev.push({ k: 'kick', ball: i, id: m.id, v: k, shot: false });
  }

  /**
   * Bean Hoops: a dive into the ball (or a jump up into it) is a shot. It's thrown at the hoop on
   * an arc that drops into it; how true depends on how far out you are and how squarely you were
   * heading at the hoop. From outside the arc it's worth three. Facing away from the hoop it's
   * just a clearance, the way you're going.
   */
  private shoot(b: CupBall, i: number, r: Who, t: number, ev: CupEvent[], dx: number, dz: number, header: boolean) {
    const A = this.arena, C = this.cfg, m = r.m;
    if (t - b.kickT < 0.3) return;
    b.kickT = t;
    this.touched(b, m.id, t);
    const team = this.teamOf(r.c.id), H = A.hoops[team];
    const hx = H.x - b.pos.x, hz = H.z - b.pos.z, d = Math.hypot(hx, hz);
    // which way it's being hit: the way you're going and the side of the ball you're on, together
    let ax = dx + N.x, az = dz + N.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    const facing = d > 0.5 ? (ax * hx + az * hz) / d : 1;
    // (a jump up into it is only a shot close in, a tip at the rim; further out it's just knocked on)
    if (facing < 0.15 || (header && d > 9)) {
      const v = header ? 8 : 15;
      b.vel.set(ax * v, 8, az * v);
      b.worth = 2;
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: !header });
      return;
    }
    // (from the far end it's not a shot, it's a long ball up the court for someone to run on to)
    if (d > 27) {
      const T = 1.5, k = 0.55;
      b.vel.set((hx * k + (Math.random() - 0.5) * 6) / T, 0.5 * C.g * T * 0.8, (hz * k) / T);
      b.worth = 2;
      ev.push({ k: 'kick', ball: i, id: m.id, v: b.vel.length(), shot: true });
      return;
    }
    // how far off it can be (m): more from further out, more if you weren't square to it, more for a weaker bot
    const hand = r.c.human ? 1 : 1.9 - 0.7 * (r.c.skill ?? 0.7);
    const off = (0.3 + d * 0.045 + Math.max(0, d - 10) * 0.1) * (1 + (1 - facing) * 3) * hand * (header ? 1.35 : 1);
    const tx = H.x + (Math.random() + Math.random() - 1) * off * 1.6, tz = H.z + (Math.random() + Math.random() - 1) * off * 1.6;
    const T = 0.8 + d * 0.045;
    b.vel.set((tx - b.pos.x) / T, (H.y + 0.35 - b.pos.y) / T + 0.5 * C.g * T, (tz - b.pos.z) / T);
    // (the arc above has no air in it: a touch more to make up for the drag)
    b.vel.multiplyScalar(1 + 0.05 * T);
    b.worth = d > C.three ? 3 : 2;
    ev.push({ k: 'kick', ball: i, id: m.id, v: b.vel.length(), shot: true });
  }

  /**
   * Volley Folly: any touch sends it up. Run under it and it's a bump: up and on toward the net
   * for someone else (or over, if you're close to it). JUMP or DIVE into it and it's a hit: over the
   * net, the way you're heading, as deep as you were moving fast. The flight's worked out so it
   * lands where it's aimed and clears the net on the way.
   */
  private bump(b: CupBall, i: number, r: Who, t: number, ev: CupEvent[], dx: number, dz: number, hard: boolean) {
    const A = this.arena, C = this.cfg, m = r.m;
    if (t - b.kickT < 0.32) return;
    const team = this.teamOf(r.c.id), dir = team === 0 ? 1 : -1;
    const floor = A.center.y + C.R, zNet = A.center.z;
    const toNet = (zNet - b.pos.z) * dir;
    // (only in your own yard: the net's glass is in the way of anything else)
    if (toNet < 0) return;
    b.kickT = t;
    this.touched(b, m.id, t);
    // how many times this side has had it since it came over
    if (this.rally.team !== team) (this.rally.team = team), (this.rally.n = 0);
    const n = ++this.rally.n;
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (!hard) {
      // a bump: straight up off your head and a little on toward the net, for someone to hit.
      // Each one in a row comes up lower: three and it's as good as down
      const vy = n <= 1 ? 7.4 : n === 2 ? 5.4 : 2.6;
      b.vel.set(dx * 1.6, vy, dz * 1.6 + dir * Math.min(2.2, toNet * 0.3));
      ev.push({ k: 'kick', ball: i, id: m.id, v: vy, shot: false });
      return;
    }
    // a hit: over the net, the way you're heading, as deep as you were moving fast
    const deep = 3.5 + Math.min(1, hs / 11) * (C.HL - 7) * (r.c.human ? 1 : 0.55 + Math.random() * 0.55);
    const tz = zNet + dir * Math.min(C.HL - 2.2, deep);
    const tx = THREE.MathUtils.clamp(b.pos.x + dx * 9 + (r.c.human ? 0 : (Math.random() - 0.5) * 9), A.center.x - C.HW + 2.2, A.center.x + C.HW - 2.2);
    // the flight: as flat as clears the net with room to spare
    let T = 0.8;
    for (; T < 3; T += 0.1) {
      const vy = (floor - b.pos.y) / T + 0.5 * C.g * T;
      const tc = (T * toNet) / Math.max(0.1, (tz - b.pos.z) * dir);
      if (b.pos.y + vy * tc - 0.5 * C.g * tc * tc > A.center.y + C.fenceH + C.R + 0.55) break;
    }
    b.vel.set((tx - b.pos.x) / T, (floor - b.pos.y) / T + 0.5 * C.g * T, (tz - b.pos.z) / T);
    // (the flight above has no air in it: a touch more to make up for the drag)
    b.vel.multiplyScalar(1 + 0.05 * T);
    ev.push({ k: 'kick', ball: i, id: m.id, v: b.vel.length(), shot: hard });
  }

  /** (the host) the ball's moves, this frame */
  tick(dt: number, t: number, x: number) {
    const ev: CupEvent[] = [];
    const A = this.arena, all = this.who(), C = this.cfg;
    if (C.second > 0 && !this.second && x > C.T - C.second) {
      this.second = true;
      this.drop(A.balls[1], 6);
      A.balls[0].backAt && (A.balls[0].backAt = t + 0.5);
    }
    const n = 4, h = dt / n;
    A.balls.forEach((b, i) => {
      if (b.backAt && t >= b.backAt) {
        if (C.rule === 'volley') this.serve(this.serveTo);
        else this.drop(b, i ? 6 : this.second ? -6 : 0);
      }
      if (!b.live && !b.backAt) return;
      for (let k = 0; k < n; k++) {
        this.down = -1;
        this.fly(b, h, ev, i);
        if (!b.live) continue;
        const was = b.pos.z - A.center.z;
        this.give = 0.085;
        for (const r of all) if (r.m.active && !r.out && !r.m.frozen) this.touch(b, i, r, t, ev);
        this.hold(b, was, 0, null, i);
        const dz = b.pos.z - A.center.z;
        // Bean Hoops: down through a rim is a basket for the side that shoots at it
        if (C.rule === 'hoops') {
          for (let team = 0; team < 2 && b.live; team++) {
            const H = A.hoops[team];
            if (!(b.py > H.y && b.pos.y <= H.y) || Math.hypot(b.pos.x - H.x, b.pos.z - H.z) > C.hoopR - RIM * 0.6) continue;
            const mine = t - b.byT[team] < C.credit, pts = mine ? b.worth : 2;
            this.score[team] += pts;
            b.live = false;
            b.backAt = t + C.restart;
            const by = mine ? b.by[team] : b.last;
            ev.push({ k: 'goal', team, by, own: !mine && by >= 0 && this.teamOf(by) !== team, ball: i, a: this.score[0], b: this.score[1], pts });
          }
          b.py = b.pos.y;
          continue;
        }
        // Volley Folly: down on the floor is a point to the other side, and their serve to take
        if (C.rule === 'volley') {
          if (this.down !== i) continue;
          const team = dz > 0 ? 0 : 1;
          this.score[team]++;
          b.live = false;
          b.backAt = t + C.restart;
          this.serveTo = team === 0 ? 1 : 0;
          ev.push({ k: 'goal', team, by: t - b.byT[team] < 8 ? b.by[team] : -1, own: false, ball: i, a: this.score[0], b: this.score[1] });
          continue;
        }
        if (Math.abs(dz) > C.HL + C.R * 0.6 && Math.abs(b.pos.x - A.center.x) < C.goalHalf && b.pos.y < A.center.y + C.goalH) {
          const team = dz > 0 ? 0 : 1;
          this.score[team]++;
          b.live = false;
          b.backAt = t + C.restart;
          // (it's the goal of whoever on the scoring side had it last, if that was lately: a keeper
          // getting a hand to a shot hasn't scored an own goal, and nor has the bean pushing back)
          const mine = t - b.byT[team] < C.credit;
          const by = mine ? b.by[team] : b.last;
          ev.push({ k: 'goal', team, by, own: !mine && by >= 0 && this.teamOf(by) !== team, ball: i, a: this.score[0], b: this.score[1] });
        }
      }
      if (b.live) this.attack[b.pos.z > A.center.z ? 0 : 1] += dt;
    });
    // Over the Fence: the score is where the balls lie (each team's is the count in the other's yard)
    if (C.rule === 'fence') this.yards();
    return ev;
  }

  /** Volley Folly: whose yard the next ball comes down in, and who's had it how often since it came over */
  private serveTo = 0;
  private rally = { team: -1, n: 0 };

  private yards() {
    const A = this.arena;
    this.score[0] = this.score[1] = 0;
    for (const b of A.balls) if (b.live) this.score[b.pos.z > A.center.z ? 0 : 1]++;
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
      const up = b.pos.y - y0 - this.cfg.R;
      k.scale.setScalar(1 + up * 0.08);
      (k.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.85 - up * 0.08);
    });
    let n = 0;
    const { M, S } = this, C = this.col;
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
