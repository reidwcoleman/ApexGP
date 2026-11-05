import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { PIN, PinHit } from './course-pinball.ts';
import { SHOT, type ShotArena } from './course-bigshot.ts';

/**
 * The game side of Pinball Panic, Big Shot and Rocket Rumble. Each browser runs its own beans
 * (fires them, drains them, fills their tanks); the host keeps the book.
 */

interface Who {
  c: { id: number; name: string; skill: number; player: boolean; human: boolean; outfit: { a: number } };
  m: Marble;
  out: boolean;
  local: boolean;
  fell: number;
}

/** a points game's book */
export class Scores {
  readonly score = new Map<number, number>();
  constructor(protected who: () => Who[]) {}
  add(id: number, v: number) {
    const n = Math.max(0, (this.score.get(id) ?? 0) + v);
    this.score.set(id, n);
    return n;
  }
  of(id: number) {
    return this.score.get(id) ?? 0;
  }
  ranking() {
    return [...this.who()].sort((a, b) => this.of(b.m.id) - this.of(a.m.id) || b.c.skill - a.c.skill);
  }
  board() {
    const rank = this.ranking();
    const best = Math.max(1, this.of(rank[0]?.m.id ?? -1));
    const me = rank.findIndex((r) => r.c.player);
    const show = rank.slice(0, 3);
    if (me >= 3) show.push(rank[me]);
    return show.map((r) => ({ name: `${rank.indexOf(r) + 1}. ${r.c.name}`, color: r.c.outfit.a, share: this.of(r.m.id) / best, mine: r.c.player, label: String(this.of(r.m.id)) }));
  }
}

/** Pinball Panic: the multipliers, and who's waiting in the plunger lane */
export class PinPlay extends Scores {
  private hits = new Map<number, number>();
  /** when each bean in the lane gets fired */
  readonly lane = new Map<number, number>();
  mult(id: number) {
    const h = this.hits.get(id) ?? 0;
    let k = 1;
    for (const s of PIN.steps) if (h >= s) k++;
    return k;
  }
  /** what this is worth to this bean, and it counts toward the next multiplier */
  value(id: number, what: number, x: number) {
    const before = this.mult(id);
    this.hits.set(id, (this.hits.get(id) ?? 0) + 1);
    const base = what === PinHit.Sling ? PIN.sling : what === PinHit.Lane ? PIN.rollover : what === PinHit.Hole ? PIN.hole : what === PinHit.Jackpot ? PIN.jackpot : PIN.bumper;
    const k = this.mult(id);
    return { v: base * k * (x > PIN.T - PIN.multi ? 2 : 1), k, up: k > before };
  }
  drain(id: number) {
    const was = this.mult(id);
    this.hits.set(id, 0);
    return was;
  }
}

interface Aim {
  n: number;
  fired: boolean;
  /** how far off the bullseye it's steered */
  off: number;
  ph: number;
  power: number;
  /** a bot: when it fires, how good the shot */
  at: number;
  want: number;
}

/** Big Shot: the cannons, the aiming, the dotted line and the bell */
export class ShotPlay extends Scores {
  readonly arena: ShotArena;
  private st = new Map<number, Aim>();
  private gun = new Map<number, number>();
  private dots: THREE.InstancedMesh;
  private mark: THREE.Mesh;
  private M = new THREE.Matrix4();
  private B = new THREE.Vector3();
  private P = new THREE.Vector3();
  private V = new THREE.Vector3();
  /** the last volley scored */
  bell = -1;
  /** beans that just left a barrel this frame (for the bang) */
  readonly fired: Who[] = [];
  /** the power on your meter, while you're aiming (null: you're not) */
  meter: number | null = null;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    who: () => Who[],
  ) {
    super(who);
    this.arena = course.shot!;
    const all = [...who()].sort((a, b) => a.c.id - b.c.id);
    all.forEach((r, i) => this.gun.set(r.m.id, Math.round((i * 24) / all.length) % 24));
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff4a0, toneMapped: false }), 26);
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    this.mark = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.15, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff2fd0, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
    // (and a shaft of light up from it, so you can see it from a low barrel)
    this.mark.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 12, 14, 1, true).translate(0, 6, 0), new THREE.MeshBasicMaterial({ color: 0xff2fd0, transparent: true, opacity: 0.4, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    this.mark.visible = false;
    scene.add(this.dots, this.mark);
  }
  dispose() {
    this.scene.remove(this.dots, this.mark);
    this.dots.dispose();
  }

  private load(r: Who, n: number) {
    const m = r.m;
    const s: Aim = { n, fired: false, off: 0, ph: Math.random() * 6.28, power: 1, at: 1.2 + Math.random() * (SHOT.aim - 1.6), want: 1 };
    // (how good a bot's shot is: a good one is close, a poor one all over the place)
    const miss = (1.25 - r.c.skill) * 0.55;
    s.want = 1 + (Math.random() - 0.5) * 2 * miss;
    s.off = (Math.random() - 0.5) * 2 * miss * 0.42;
    if (r.c.player) s.off = 0;
    this.st.set(m.id, s);
    m.active = true;
    m.mode = Mode.Run;
    m.tumbleT = m.upT = m.guardT = 0;
    m.ang.set(0, 0, 0);
    r.fell = 0;
    return s;
  }

  /** this browser's beans: aimed, and fired */
  tick(dt: number, x: number, fire: boolean, aimX: number, auto: boolean) {
    const n = Math.floor(x / SHOT.V), u = x - n * SHOT.V;
    this.fired.length = 0;
    this.meter = null;
    this.dots.count = 0;
    this.mark.visible = false;
    if (n >= SHOT.volleys) return;
    const A = this.arena;
    A.bull(n, this.B);
    for (const r of this.who()) {
      if (!r.local || r.out) continue;
      const m = r.m;
      let s = this.st.get(m.id);
      if (!s || s.n !== n) s = this.load(r, n);
      if (s.fired) continue;
      const k = this.gun.get(m.id) ?? 0;
      A.muzzle(k, m.pos);
      m.vel.set(0, 0, 0);
      m.frozen = true;
      const you = r.c.player && !auto;
      if (you) s.off = THREE.MathUtils.clamp(s.off - aimX * dt * 0.55, -0.6, 0.6);
      m.yaw = Math.atan2(this.B.x - m.pos.x, this.B.z - m.pos.z) + s.off;
      s.power = you ? 1 + SHOT.swing * Math.sin(s.ph + u * 3.3) : s.want;
      if (you) {
        this.meter = s.power;
        this.preview(m.pos, m.yaw, s.power);
      }
      if ((you ? fire && u > 0.25 : u >= s.at) || u >= SHOT.aim) {
        s.fired = true;
        const d = Math.hypot(this.B.x - m.pos.x, this.B.z - m.pos.z);
        const v = A.speed(d) * Math.sqrt(s.power), c = Math.cos(SHOT.pitch);
        m.frozen = false;
        m.vel.set(Math.sin(m.yaw) * c * v, Math.sin(SHOT.pitch) * v, Math.cos(m.yaw) * c * v);
        m.groundT = 1;
        this.fired.push(r);
      }
    }
  }

  /** the shot as it stands: dots along the arc, and a ring where it comes down */
  private preview(from: THREE.Vector3, yaw: number, power: number) {
    const A = this.arena, { M, P, V } = this;
    const d = Math.hypot(this.B.x - from.x, this.B.z - from.z);
    const v = A.speed(d) * Math.sqrt(power), c = Math.cos(SHOT.pitch);
    P.copy(from);
    V.set(Math.sin(yaw) * c * v, Math.sin(SHOT.pitch) * v, Math.cos(yaw) * c * v);
    let i = 0;
    const y0 = A.center.y;
    for (let k = 0; k < 400 && i < 26; k++) {
      const h = 0.01;
      P.addScaledVector(V, h);
      V.y -= 24 * h;
      if (P.y < y0) break;
      if (k % 14 === 13) this.dots.setMatrixAt(i++, M.makeTranslation(P.x, P.y, P.z));
    }
    this.dots.count = i;
    this.dots.instanceMatrix.needsUpdate = true;
    this.mark.position.set(P.x, y0 + 0.06, P.z);
    this.mark.visible = true;
  }

  /** (the host) the bell: what everyone's standing on. [id, total, gain] */
  ring(n: number) {
    const out: [number, number, number][] = [];
    for (const r of this.who()) {
      if (r.out || !r.m.active) continue;
      const g = this.arena.worth(n, r.m.pos);
      if (g > 0) out.push([r.m.id, this.add(r.m.id, g), g]);
    }
    return out;
  }

  /** the barrels follow their beans */
  sync() {
    for (const r of this.who()) {
      const k = this.gun.get(r.m.id);
      if (k === undefined) continue;
      const g = this.arena.guns[k];
      if (r.m.frozen || r.m.vel.lengthSq() < 0.01) g.barrel.rotation.y = r.m.yaw;
      g.ring.visible = r.c.player;
    }
  }
}

/** Rocket Rumble: the packs on their backs and the flames under them */
export class RocketPlay {
  private pack: THREE.InstancedMesh;
  private flame: THREE.InstancedMesh;
  private M = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private E = new THREE.Euler();
  private S = new THREE.Vector3();
  private P = new THREE.Vector3();
  /** where your tank was last frame */
  private lastFill = 0;
  readonly arena;
  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.rocket!;
    const g = new THREE.CapsuleGeometry(0.2, 0.5, 4, 12);
    this.pack = new THREE.InstancedMesh(g, new THREE.MeshPhysicalMaterial({ color: 0xd8dde8, metalness: 0.8, roughness: 0.3 }), 24);
    this.flame = new THREE.InstancedMesh(new THREE.ConeGeometry(0.26, 1.5, 10, 1, true).rotateX(Math.PI).translate(0, -0.75, 0), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 24);
    this.pack.frustumCulled = this.flame.frustumCulled = false;
    this.pack.castShadow = true;
    scene.add(this.pack, this.flame);
  }
  dispose() {
    this.scene.remove(this.pack, this.flame);
    this.pack.dispose();
    this.flame.dispose();
  }
  /** you went through a ring since last asked */
  refilled(id: number) {
    const t = this.arena.filled.get(id) ?? 0;
    if (t > this.lastFill) {
      this.lastFill = t;
      return true;
    }
    return false;
  }
  sync(t: number) {
    const { M, Q, E, S, P } = this;
    const A = this.arena;
    let n = 0, f = 0;
    for (const r of this.who()) {
      const m = r.m;
      if (r.out || !m.active || n >= 24) continue;
      E.set(0, m.yaw, 0);
      Q.setFromEuler(E);
      P.set(-Math.sin(m.yaw) * 0.46, 0.45, -Math.cos(m.yaw) * 0.46).add(m.pos);
      this.pack.setMatrixAt(n++, M.compose(P, Q, S.setScalar(1)));
      // (someone else's bean: it's on the way up with nothing under it, so it must be burning)
      const on = r.local ? A.burning.has(m.id) : m.groundT > 0.15 && m.vel.y > 0.5;
      if (on) {
        P.y -= 0.42;
        this.flame.setMatrixAt(f++, M.compose(P, Q, S.set(1, 0.8 + Math.sin(t * 50 + m.id) * 0.3, 1)));
      }
    }
    this.pack.count = n;
    this.flame.count = f;
    this.pack.instanceMatrix.needsUpdate = this.flame.instanceMatrix.needsUpdate = true;
  }
}
