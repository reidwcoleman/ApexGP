import * as THREE from 'three';
import type { Course } from './courses.ts';
import { Scores, type Who } from './modes-play.ts';
import { PICNIC, type Ball, type Food, type PicnicArena } from './course-picnic.ts';
import { makeCrown } from './course-kit.ts';

/**
 * The game side of Sticky Picnic: what each ball eats, what it bumps into, and the balls themselves
 * with everything stuck to them. Each browser does this for its own beans, from where it sees
 * everyone else's, and a ball's size goes out in its bean's state (r.s).
 */

type Bean = Who & { rig: { root: THREE.Object3D }; s: number };

export interface PicnicHit {
  x: number;
  y: number;
  z: number;
  power: number;
  a: number;
  b: number;
  /** 'knock': two balls; 'wall': food too big to eat; 'gulp': b picked up a */
  kind: 'knock' | 'wall' | 'gulp';
  /** what it cost whoever lost out */
  took: number;
  by: number;
}

/** a piece of food stuck to a ball */
interface Bit {
  food: Food;
  slot: number;
  r: number;
  /** where on the ball (the ball's own frame) and which way up */
  dir: THREE.Vector3;
  q: THREE.Quaternion;
}

/** a piece knocked loose, in the air */
interface Loose {
  food: Food;
  slot: number;
  r: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const BITS = 72;
const ROOM = 520;
/** the bean's feet are this far above where the ball touches the table */
const FOOT = 0.5;

function swirlArt() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 128);
  x.strokeStyle = 'rgba(255,255,255,0.0)';
  x.fillStyle = 'rgba(40, 20, 50, 0.22)';
  for (let k = 0; k < 8; k++) {
    x.beginPath();
    x.moveTo(k * 32, 0);
    x.bezierCurveTo(k * 32 + 26, 44, k * 32 - 8, 84, k * 32 + 16, 128);
    x.lineTo(k * 32 + 32, 128);
    x.bezierCurveTo(k * 32 + 8, 84, k * 32 + 42, 44, k * 32 + 16, 0);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class PicnicPlay extends Scores {
  readonly arena: PicnicArena;
  /** this frame's bangs */
  readonly hits: PicnicHit[] = [];
  /** this browser's balls that went off the table this frame */
  readonly fallen: Bean[] = [];
  /** eaten here and not told yet: item, who, item, who */
  readonly told: number[] = [];
  /** what you ate this frame: how many, and how much */
  ate = 0;
  ateV = 0;
  /** the biggest right now */
  leader = -1;
  private pairT = new Map<number, number>();
  private balls: THREE.InstancedMesh;
  private fade: THREE.InstancedBufferAttribute;
  private stuck: THREE.InstancedMesh[];
  private free: number[][];
  private top: number[];
  private bits = new Map<number, Bit[]>();
  private loose: Loose[] = [];
  private crown: THREE.Object3D;
  private M = new THREE.Matrix4();
  private P = new THREE.Vector3();
  private V = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private Q2 = new THREE.Quaternion();
  private S = new THREE.Vector3();
  private C = new THREE.Color();
  private AX = new THREE.Vector3();

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private beans: () => Bean[],
    key: number,
  ) {
    super(beans);
    this.arena = course.picnic!;
    this.arena.deal(key, beans().length);
    const n = beans().length;
    const jam = new THREE.MeshPhysicalMaterial({ map: swirlArt(), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15 });
    // (a ball between the lens and you dissolves: a screen door of pixels, so there's nothing to sort)
    jam.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < 0.99 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;');
    };
    jam.customProgramCacheKey = () => 'mm-picnic-jam';
    const sphere = new THREE.SphereGeometry(1, 36, 24);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    this.fade.setUsage(THREE.DynamicDrawUsage);
    sphere.setAttribute('aFade', this.fade);
    this.balls = new THREE.InstancedMesh(sphere, jam, n);
    this.balls.frustumCulled = false;
    this.balls.castShadow = true;
    scene.add(this.balls);
    beans().forEach((r, k) => this.balls.setColorAt(k, this.C.set(r.c.outfit.a)));
    this.stuck = this.arena.geo.map((g) => {
      const q = new THREE.InstancedMesh(g, this.arena.mat, ROOM);
      q.frustumCulled = false;
      q.count = 0;
      // (every slot needs a colour before the first one is drawn)
      q.setColorAt(0, this.C.set(0xffffff));
      scene.add(q);
      return q;
    });
    this.free = this.arena.geo.map(() => []);
    this.top = this.arena.geo.map(() => 0);
    this.crown = makeCrown();
    this.crown.visible = false;
    scene.add(this.crown);
  }

  dispose() {
    this.scene.remove(this.balls, this.crown, ...this.stuck);
    this.balls.dispose();
    for (const q of this.stuck) q.dispose();
  }

  /** the board: sizes, in metres */
  override board() {
    return super.board().map((b) => ({ ...b, label: `${(Number(b.label) / 100).toFixed(1)}M` }));
  }

  /** a ball's weight, whether it can be touched, and whether it's stuck to someone, in one number */
  private pack(q: Ball, t: number) {
    const s = q.mass + (q.ghost > t ? 1e5 : 0);
    return q.stuck > t ? -s - 1 : s;
  }
  private unpack(q: Ball, s: number, t: number) {
    const stuck = s < 0;
    let v = stuck ? -s - 1 : s;
    if (v >= 1e5) {
      v -= 1e5;
      q.ghost = t + 0.2;
    }
    q.mass = v;
    q.stuck = stuck ? t + 0.2 : 0;
  }

  private slot(food: Food) {
    const f = this.free[food].pop();
    if (f !== undefined) return f;
    return this.top[food] < ROOM ? this.top[food]++ : -1;
  }

  /** a piece of food goes on a ball: `wx, wy, wz` is where it touched, from the ball's middle */
  stick(id: number, food: Food, r: number, col: number, wx: number, wy: number, wz: number) {
    const q = this.arena.ball(id);
    let list = this.bits.get(id);
    if (!list) this.bits.set(id, (list = []));
    if (list.length >= BITS) this.drop(list.shift()!);
    const slot = this.slot(food);
    if (slot < 0) return;
    this.stuck[food].setColorAt(slot, this.C.set(col));
    this.stuck[food].instanceColor!.needsUpdate = true;
    this.stuck[food].count = Math.max(this.stuck[food].count, slot + 1);
    const dir = this.V.set(wx, wy, wz).normalize().clone().applyQuaternion(this.Q.copy(q.quat).invert());
    list.push({ food, slot, r, dir, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, 0)) });
  }

  private drop(b: { food: Food; slot: number }) {
    this.free[b.food].push(b.slot);
    this.stuck[b.food].setMatrixAt(b.slot, this.M.makeScale(0, 0, 0));
    this.stuck[b.food].instanceMatrix.needsUpdate = true;
  }

  /** this share of what's on a ball comes flying off it */
  shed(r: Bean, share: number, power = 8) {
    const list = this.bits.get(r.m.id);
    if (!list?.length) return;
    const q = this.arena.ball(r.m.id), R = this.arena.size(q.mass), m = r.m;
    const n = Math.min(list.length, Math.ceil(list.length * share) + 1);
    for (let k = 0; k < n; k++) {
      const b = list.splice(Math.floor(Math.random() * list.length), 1)[0];
      this.V.copy(b.dir).applyQuaternion(q.quat);
      this.loose.push({
        food: b.food, slot: b.slot, r: b.r,
        x: m.pos.x + this.V.x * R, y: m.pos.y - FOOT + R + this.V.y * R, z: m.pos.z + this.V.z * R,
        vx: this.V.x * power + (Math.random() - 0.5) * 4, vy: 6 + Math.random() * 7, vz: this.V.z * power + (Math.random() - 0.5) * 4,
        life: 1.1 + Math.random() * 0.4,
      });
    }
  }

  /** what someone else ate */
  heard(a: number[]) {
    const A = this.arena, all = this.beans();
    for (let i = 0; i + 1 < a.length; i += 2) {
      const it = A.items[a[i]], who = all.find((r) => r.m.id === a[i + 1]);
      if (!it || it.gone) continue;
      A.eaten(it.k);
      if (who && !who.local) this.stick(who.m.id, it.food, it.r, it.col, it.x - who.m.pos.x, -1, it.z - who.m.pos.z);
    }
  }

  /** somewhere else, you got the credit for a fall */
  gain(id: number, v: number) {
    this.arena.ball(id).mass += v;
  }

  private centreY(m: { pos: THREE.Vector3 }, R: number) {
    return m.pos.y - FOOT + R;
  }

  /** the frame: sizes in, balls on balls, the food, the edge */
  tick(t: number, x: number, on: boolean) {
    const A = this.arena, all = this.beans(), y0 = A.center.y;
    this.hits.length = 0;
    this.fallen.length = 0;
    this.ate = this.ateV = 0;
    const dbl = A.feast(x) ? 2 : 1;
    for (const r of all) {
      const q = A.ball(r.m.id);
      if (r.local) r.s = this.pack(q, t);
      else this.unpack(q, r.s, t);
      this.score.set(r.m.id, Math.round(A.size(q.mass) * 100));
    }
    const biggest = Math.max(1, ...all.map((r) => A.size(A.ball(r.m.id).mass)));
    const live = (r: Bean) => {
      const q = A.ball(r.m.id);
      return !r.out && r.m.active && !r.m.frozen && q.ghost <= t && q.stuck <= t;
    };
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!live(a)) continue;
      const am = a.m, qa = A.ball(am.id), ra = A.size(qa.mass);
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!live(b)) continue;
        const bm = b.m, qb = A.ball(bm.id), rb = A.size(qb.mass);
        const dx = bm.pos.x - am.pos.x, dy = this.centreY(bm, rb) - this.centreY(am, ra), dz = bm.pos.z - am.pos.z, D = ra + rb;
        if (dx * dx + dy * dy + dz * dz >= D * D) continue;
        const d = Math.hypot(dx, dz) || 0.01, nx = dx / d, nz = dz / d;
        const sa = Math.hypot(am.vel.x, am.vel.z), sb = Math.hypot(bm.vel.x, bm.vel.z);
        // (a boost is a boost whoever's browser it was: you can see it in the speed)
        const fastA = qa.fast > t || sa > PICNIC.top + ra * PICNIC.topR + 3, fastB = qb.fast > t || sb > PICNIC.top + rb * PICNIC.topR + 3;
        const big = ra >= rb ? a : b, small = ra >= rb ? b : a;
        const rBig = Math.max(ra, rb), rSmall = Math.min(ra, rb), smallFast = ra >= rb ? fastB : fastA;
        const key = am.id * 64 + bm.id;
        const since = t - (this.pairT.get(key) ?? -9);
        // much smaller, and not coming in on a boost: it's picked up
        if (rBig >= rSmall * PICNIC.gulp && !smallFast) {
          if (since < 2.5) continue;
          this.pairT.set(key, t);
          const qs = A.ball(small.m.id), took = qs.mass * PICNIC.gulpTake + 0.4;
          if (on) {
            if (small.local) {
              qs.mass -= Math.min(qs.mass, took);
              this.shed(small, 0.3, 5);
            }
            if (big.local) A.ball(big.m.id).mass += took * dbl;
          }
          if (small.local) {
            qs.stuck = t + PICNIC.stuck;
            qs.by = big.m.id;
          }
          A.ball(big.m.id).pulse = 1;
          this.hits.push({ x: small.m.pos.x, y: y0 + rSmall, z: small.m.pos.z, power: 20, a: small.m.id, b: big.m.id, kind: 'gulp', took, by: big.m.id });
          continue;
        }
        // otherwise they bounce, the lighter one more
        const ma = ra * ra * ra * (fastA ? 2.5 : 1), mb = rb * rb * rb * (fastB ? 2.5 : 1), wa = mb / (ma + mb), wb = ma / (ma + mb);
        const pen = D - Math.hypot(dx, dz);
        if (a.local) {
          am.pos.x -= nx * pen * wa;
          am.pos.z -= nz * pen * wa;
        }
        if (b.local) {
          bm.pos.x += nx * pen * wb;
          bm.pos.z += nz * pen * wb;
        }
        const closing = (am.vel.x - bm.vel.x) * nx + (am.vel.z - bm.vel.z) * nz;
        if (closing < 0.5 || since < 0.3) continue;
        this.pairT.set(key, t);
        const kick = (1 + PICNIC.e) * closing;
        if (a.local) {
          am.vel.x -= nx * Math.max(2, kick * wa);
          am.vel.z -= nz * Math.max(2, kick * wa);
          if (kick * wa > 6) am.vel.y = Math.max(am.vel.y, Math.min(7, kick * wa * 0.3));
          am.hitBy = bm.id;
          am.hitT = t;
        }
        if (b.local) {
          bm.vel.x += nx * Math.max(2, kick * wb);
          bm.vel.z += nz * Math.max(2, kick * wb);
          if (kick * wb > 6) bm.vel.y = Math.max(bm.vel.y, Math.min(7, kick * wb * 0.3));
          bm.hitBy = am.id;
          bm.hitT = t;
        }
        qa.pulse = qb.pulse = Math.min(1, closing / 14);
        // hard enough, and bits come off whoever was hit: the faster one takes them
        const hitter = (fastA && !fastB) || (fastA === fastB && sa > sb) ? a : b, hurt = hitter === a ? b : a;
        const qh = A.ball(hurt.m.id), rh = A.ball(hitter.m.id);
        let took = 0;
        if (closing > PICNIC.shake) {
          const share = Math.min(PICNIC.shakeMax, closing * 0.006);
          took = Math.min(qh.mass * share, rh.mass * 1.2 + 2);
          if (on) {
            if (hurt.local) {
              qh.mass -= took;
              this.shed(hurt, share * 2, closing * 0.5);
            }
            if (hitter.local) rh.mass += took * dbl;
          }
        }
        this.hits.push({ x: am.pos.x + nx * ra, y: y0 + Math.min(ra, rb), z: am.pos.z + nz * ra, power: closing, a: am.id, b: bm.id, kind: 'knock', took, by: hitter.m.id });
      }
    }
    // each browser's own balls: stuck ones ride along, the rest eat and hit things
    for (const r of all) {
      const m = r.m;
      if (!r.local || r.out || !m.active || m.frozen) continue;
      const q = A.ball(m.id);
      if (q.by >= 0) {
        const on2 = all.find((o) => o.m.id === q.by);
        if (q.stuck > t && on2) {
          m.pos.x = on2.m.pos.x;
          m.pos.z = on2.m.pos.z;
          m.vel.x = m.vel.z = 0;
          continue;
        }
        // let go: thrown clear, towards the middle of the table
        q.by = -1;
        q.stuck = 0;
        q.ghost = t + PICNIC.ghost;
        const a = Math.random() * 6.28, ex = A.center.x - m.pos.x, ez = A.center.z - m.pos.z, el = Math.hypot(ex, ez) || 1;
        m.vel.set((ex / el) * 9 + Math.cos(a) * 6, 13, (ez / el) * 9 + Math.sin(a) * 6);
        m.groundT = 1;
        if (m.pos.y < y0 - 1) A.respawn(m, t);
      }
      const R = A.size(q.mass), cy = this.centreY(m, R), lim = R * PICNIC.eat;
      if (on && q.ghost <= t) {
        A.near(m.pos.x, m.pos.z, R + 1, (it) => {
          if (it.gone || it.at > x) return;
          const dx = it.x - m.pos.x, dy = it.y - cy, dz = it.z - m.pos.z, dd = dx * dx + dy * dy + dz * dz;
          const eats = it.r <= lim;
          // (food goes on the touch, so nothing tucked up against something big is ever out of reach)
          const need = R + it.r * (eats ? 1.05 : 0.82);
          if (dd >= need * need) return;
          if (eats) {
            A.eaten(it.k);
            const v = it.r ** PICNIC.power * PICNIC.gain * dbl * (1 + PICNIC.catchUp * (1 - R / biggest));
            q.mass += v;
            q.pulse = Math.max(q.pulse, Math.min(1, 0.25 + it.r / R));
            this.stick(m.id, it.food, it.r, it.col, dx, dy, dz);
            this.told.push(it.k, m.id);
            if (r.c.player) {
              this.ate++;
              this.ateV += v;
            }
            return;
          }
          // too big for you, for now: it's a wall
          const d = Math.hypot(dx, dz) || 0.01, nx = dx / d, nz = dz / d, pen = need - Math.sqrt(dd);
          m.pos.x -= nx * pen;
          m.pos.z -= nz * pen;
          const vn = m.vel.x * nx + m.vel.z * nz;
          if (vn > 0.5) {
            m.vel.x -= nx * vn * 1.5;
            m.vel.z -= nz * vn * 1.5;
            if (vn > 5) this.hits.push({ x: m.pos.x + nx * R, y: y0 + R, z: m.pos.z + nz * R, power: vn, a: m.id, b: -1, kind: 'wall', took: 0, by: -1 });
          }
        });
      }
      if (m.pos.y < y0 - PICNIC.fall) this.fallen.push(r);
    }
  }

  /** the balls, and everything on them */
  sync(t: number, dt: number) {
    const { M, P, V, Q, Q2, S, AX } = this;
    const A = this.arena, all = this.beans();
    const rank = this.ranking()[0];
    this.leader = rank && this.of(rank.m.id) > 100 ? rank.m.id : -1;
    this.crown.visible = false;
    all.forEach((r, k) => {
      const m = r.m, q = A.ball(m.id), gone = r.out || !m.active;
      const R = A.size(q.mass);
      q.vis += (R - q.vis) * Math.min(1, dt * 7);
      q.pulse = Math.max(0, q.pulse - dt * 4.5);
      const v = q.vis, y = this.centreY(m, v);
      // rolling: round the axis across the way it's going, as far as it's gone
      const hs = Math.hypot(m.vel.x, m.vel.z);
      if (hs > 0.05 && m.pos.y > A.center.y - 4) {
        AX.set(m.vel.z / hs, 0, -m.vel.x / hs);
        q.quat.premultiply(Q.setFromAxisAngle(AX, (hs * dt) / v)).normalize();
      }
      const stuck = q.stuck > t;
      const blink = q.ghost > t && Math.floor(t * 12) % 2 === 0;
      const hide = gone || stuck || blink;
      S.set(v * (1 + q.pulse * 0.1), v * (1 - q.pulse * 0.13), v * (1 + q.pulse * 0.1));
      if (hide) S.setScalar(0.0001);
      P.set(m.pos.x, y, m.pos.z);
      this.balls.setMatrixAt(k, M.compose(P, q.quat, S));
      const root = r.rig.root;
      if (stuck) {
        // (round and round on whoever's got you: its ball is at your feet, wherever you are)
        const by = this.nearestBig(r);
        const rr = by ? A.ball(by.m.id).vis : v, a = t * 7 + k;
        const c = by ? by.m : m;
        root.position.set(c.pos.x + Math.cos(a) * rr * Math.cos(t * 3), this.centreY(c, rr) + Math.sin(t * 3) * rr, c.pos.z + Math.sin(a) * rr * Math.cos(t * 3));
      } else {
        root.position.y += v * 2 - 0.12 - q.pulse * v * 0.2;
        if (blink) root.visible = false;
      }
      const list = this.bits.get(m.id);
      if (list)
        for (const b of list) {
          // (the bigger a piece is for its ball, the deeper it sinks in)
          // (and a crumb on a big ball is drawn big enough to see: the point is a ball covered in food)
          const s = hide ? 0.0001 : Math.min(Math.max(b.r, v * 0.17), v * 0.62);
          V.copy(b.dir).applyQuaternion(q.quat);
          P.set(m.pos.x + V.x * (v + s * 0.1), y + V.y * (v + s * 0.1), m.pos.z + V.z * (v + s * 0.1));
          Q2.copy(q.quat).multiply(b.q);
          this.stuck[b.food].setMatrixAt(b.slot, M.compose(P, Q2, S.setScalar(s)));
        }
      if (m.id === this.leader && !gone && !stuck) {
        this.crown.visible = true;
        this.crown.scale.setScalar(0.7);
        this.crown.position.set(m.pos.x, m.pos.y + v * 2 + 1.5, m.pos.z);
        this.crown.rotation.y += dt * 2.4;
      }
    });
    this.balls.instanceMatrix.needsUpdate = true;
    // what's been knocked off: a little flight, then it's gone
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const b = this.loose[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.drop(b);
        this.loose.splice(i, 1);
        continue;
      }
      b.vy -= 26 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < A.center.y + b.r * 0.5 && Math.hypot(b.x - A.center.x, b.z - A.center.z) < A.R) {
        b.y = A.center.y + b.r * 0.5;
        b.vy *= -0.4;
        b.vx *= 0.7;
        b.vz *= 0.7;
      }
      P.set(b.x, b.y, b.z);
      Q.setFromAxisAngle(AX.set(0.6, 0.8, 0), b.life * 9);
      this.stuck[b.food].setMatrixAt(b.slot, M.compose(P, Q, S.setScalar(Math.min(b.r, 1.6) * Math.min(1, b.life * 3))));
    }
    for (const q of this.stuck) q.instanceMatrix.needsUpdate = true;
  }

  /** any other ball between the lens and you dissolves */
  view(cam: THREE.Vector3, at: THREE.Vector3, me: number, dt: number) {
    const A = this.arena, dx = at.x - cam.x, dz = at.z - cam.z, l2 = dx * dx + dz * dz || 1, k = Math.min(1, dt * 9);
    this.beans().forEach((r, i) => {
      const v = A.ball(r.m.id).vis;
      const u = THREE.MathUtils.clamp(((r.m.pos.x - cam.x) * dx + (r.m.pos.z - cam.z) * dz) / l2, 0, 1);
      const e = Math.hypot(cam.x + dx * u - r.m.pos.x, cam.z + dz * u - r.m.pos.z), y = cam.y + (at.y - cam.y) * u;
      const want = r.m.id !== me && u < 0.98 && e < v + 0.5 && y < r.m.pos.y + v * 2 + 0.6 ? 0.2 : 1;
      const was = this.fade.getX(i);
      if (Math.abs(was - want) > 0.004) {
        this.fade.setX(i, was + (want - was) * k);
        this.fade.needsUpdate = true;
      }
    });
  }

  /** the ball that has hold of you */
  private nearestBig(r: Bean) {
    const A = this.arena, q = A.ball(r.m.id);
    if (q.by >= 0) return this.beans().find((o) => o.m.id === q.by) ?? null;
    let best: Bean | null = null, d = 1e9;
    for (const o of this.beans()) {
      if (o === r || o.out || A.ball(o.m.id).stuck > 0) continue;
      const e = Math.hypot(o.m.pos.x - r.m.pos.x, o.m.pos.z - r.m.pos.z);
      if (e < d) {
        d = e;
        best = o;
      }
    }
    return best;
  }
}
