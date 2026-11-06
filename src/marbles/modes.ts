import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { BOUNCE, Pop, popValue, type Balloon } from './course-bounce.ts';
import { glowMat } from './obs-world.ts';
import { KEEP } from './course-crown.ts';
import { makeCrown } from './course-kit.ts';

/**
 * The host's side of the games that aren't a function of the clock: who has popped what, who has
 * the crown, who has how many points. The host (or solo) decides; a guest is told and shows it.
 */

interface Who {
  c: { id: number; name: string; skill: number; player: boolean; human: boolean; outfit: { a: number } };
  m: Marble;
  out: boolean;
}

/** Bounce House: what's in the air, who has popped what, and the combos */
export class BouncePlay {
  readonly score = new Map<number, number>();
  readonly popped = new Set<number>();
  /** the balloons up now: for the bots */
  readonly live: Balloon[] = [];
  private first = 0;
  private combo = new Map<number, { n: number; t: number }>();
  private body: THREE.InstancedMesh;
  private tail: THREE.InstancedMesh;
  /** the same balloons, see-through: any that's between you and the camera */
  private ghost: THREE.InstancedMesh;
  private bolt: THREE.InstancedMesh;
  private land: THREE.Mesh;
  private faded = new Set<number>();
  private M = new THREE.Matrix4();
  private V = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private S = new THREE.Vector3();
  private C = new THREE.Color();
  private P = new THREE.Vector3();
  readonly arena;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.bounce!;
    const N = 260;
    // (a balloon: rounder at the top, drawn in to the knot)
    const prof: THREE.Vector2[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI;
      const pull = 1 + 0.28 * Math.max(0, -Math.cos(a)) ** 3;
      prof.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.62), -Math.cos(a) * 0.72 * pull));
    }
    const g = new THREE.LatheGeometry(prof, 22);
    g.computeVertexNormals();
    this.body = new THREE.InstancedMesh(g, new THREE.MeshPhysicalMaterial({ roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x303030, emissiveIntensity: 0.35 }), N);
    this.tail = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4).translate(0, -1.4, 0), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), N);
    this.ghost = new THREE.InstancedMesh(g, new THREE.MeshPhysicalMaterial({ roughness: 0.16, transparent: true, opacity: 0.16, depthWrite: false }), 24);
    // the bolt on a thunder balloon (you need to read it from across the castle), turned to the camera
    const sh = new THREE.Shape();
    [[0.12, 0.62], [-0.3, -0.02], [-0.03, -0.02], [-0.16, -0.62], [0.32, 0.12], [0.04, 0.12], [0.26, 0.62]].forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    this.bolt = new THREE.InstancedMesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xffe94a, toneMapped: false, side: THREE.DoubleSide, depthTest: false, transparent: true }), 40);
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 3;
    // the ring that closes on the spot you'll land: green is when JUMP makes it a super bounce
    this.land = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 44).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.land.visible = false;
    scene.add(this.bolt, this.land);
    this.body.frustumCulled = this.tail.frustumCulled = this.ghost.frustumCulled = false;
    this.body.castShadow = true;
    this.body.setColorAt(0, this.C.set(0xffffff));
    this.ghost.setColorAt(0, this.C);
    scene.add(this.body, this.tail, this.ghost);
  }

  dispose() {
    this.scene.remove(this.body, this.tail, this.ghost, this.bolt, this.land);
    this.bolt.dispose();
    this.body.dispose();
    this.tail.dispose();
    this.ghost.dispose();
  }

  /** what's up there at x seconds after the off */
  refresh(x: number) {
    const L = this.live;
    L.length = 0;
    const list = this.arena.balloons;
    while (this.first < list.length && list[this.first].t + BOUNCE.life < x) this.first++;
    for (let i = this.first; i < list.length && list[i].t <= x; i++) if (!this.popped.has(list[i].k)) L.push(list[i]);
  }

  /** (the host) anyone in a balloon pops it */
  pops(x: number, t: number): { k: number; id: number; v: number; n: number; combo: number }[] {
    const out: { k: number; id: number; v: number; n: number; combo: number }[] = [];
    const all = this.who();
    for (const q of this.live) {
      if (this.popped.has(q.k) || q.t + 0.3 > x) continue;
      this.arena.at(q, x, this.P);
      const big = q.kind === Pop.Star ? 1.7 : 1;
      for (const r of all) {
        const m = r.m;
        if (!m.active || r.out) continue;
        const dx = m.pos.x - this.P.x, dy = m.pos.y + 0.4 - this.P.y, dz = m.pos.z - this.P.z;
        // (people's hands reach a little further: no one's as exact as a bot)
        const reach = (r.c.human ? BOUNCE.reach + 0.35 : BOUNCE.reach) * big;
        if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > reach + 0.5) continue;
        const e = this.popBy(q, m.id, t);
        out.push(e);
        break;
      }
    }
    return out;
  }

  private popBy(q: Balloon, id: number, t: number) {
    const base = popValue(q.kind);
    const c = this.combo.get(id) ?? { n: 0, t: -9 };
    let v = base;
    if (base < 0) c.n = 0;
    else {
      c.n = t - c.t < BOUNCE.chain ? Math.min(BOUNCE.maxCombo, c.n + 1) : 1;
      v = base * c.n;
    }
    c.t = t;
    this.combo.set(id, c);
    const n = Math.max(0, (this.score.get(id) ?? 0) + v);
    this.take(q.k, id, n);
    return { k: q.k, id, v, n, combo: c.n };
  }

  take(k: number, id: number, n: number) {
    this.popped.add(k);
    this.score.set(id, n);
  }
  balloon(k: number) {
    return this.arena.balloons.find((q) => q.k === k) ?? null;
  }

  /** the field, top score first (ties: the luck of the draw) */
  ranking() {
    return [...this.who()].sort((a, b) => (this.score.get(b.m.id) ?? 0) - (this.score.get(a.m.id) ?? 0) || b.c.skill - a.c.skill);
  }

  /** the board: the top three, and you */
  board() {
    const rank = this.ranking();
    const best = Math.max(1, this.score.get(rank[0]?.m.id ?? -1) ?? 1);
    const me = rank.findIndex((r) => r.c.player);
    const show = rank.slice(0, 3);
    if (me >= 3) show.push(rank[me]);
    return show.map((r) => ({ name: `${rank.indexOf(r) + 1}. ${r.c.name}`, color: r.c.outfit.a, share: (this.score.get(r.m.id) ?? 0) / best, mine: r.c.player, label: String(this.score.get(r.m.id) ?? 0) }));
  }

  /** the landing ring: where you'll come down, closing as you do, green in the super bounce window */
  landing(m: Marble | null, g: number) {
    const L = this.land, y0 = this.arena.center.y;
    if (!m || !m.active) return void (L.visible = false);
    const h = m.pos.y - 0.5 - y0;
    // (seconds to the floor)
    const v = m.vel.y, tt = (v + Math.sqrt(Math.max(0, v * v + 2 * g * Math.max(0, h)))) / g;
    L.visible = v < 3 && h > 0.2;
    if (!L.visible) return;
    const on = tt < BOUNCE.press;
    L.position.set(m.pos.x + m.vel.x * tt, y0 + 0.12, m.pos.z + m.vel.z * tt);
    L.scale.setScalar(0.85 + Math.min(1, tt / 0.8) * 1.9);
    (L.material as THREE.MeshBasicMaterial).color.set(on ? 0x4aff7a : 0xffffff);
  }

  /** is this balloon on the line from the camera to your bean, or right on the lens? */
  private inView(k: number, p: THREE.Vector3, size: number, cam: THREE.Vector3, me: THREE.Vector3 | null) {
    const was = this.faded.has(k);
    const clear = size * (was ? 1.75 : 1.35);
    let hit = p.distanceTo(cam) < clear + 1.6;
    if (!hit && me) {
      SEG.subVectors(me, cam);
      const len2 = SEG.lengthSq();
      const u = len2 > 0.01 ? OFF.subVectors(p, cam).dot(SEG) / len2 : 1;
      if (u > 0 && u < 0.95) hit = OFF.copy(cam).addScaledVector(SEG, u).distanceTo(p) < clear;
    }
    if (hit) this.faded.add(k);
    else this.faded.delete(k);
    return hit;
  }

  /** the balloons: swelling up off the floor, bobbing, and away up into the sky when their time's out */
  sync(t: number, x: number, cam: THREE.Vector3, me: THREE.Vector3 | null) {
    const A = this.arena, { M, V, Q, S, C } = this;
    let n = 0, ng = 0, nb = 0;
    Q2.setFromRotationMatrix(M.lookAt(cam, A.center, UPV));
    for (const q of this.live) {
      if (n >= 260) break;
      A.at(q, x, V);
      const u = x - q.t, left = BOUNCE.life - u;
      if (left < 1) V.y += (1 - left) ** 2 * 14;
      const s = (q.kind === Pop.Star ? 1.9 : q.kind === Pop.High ? 1.05 : q.kind === Pop.Thunder ? 0.95 : 0.9) * Math.min(1, u / 0.35 + 0.1);
      if (q.kind === Pop.Thunder && nb < 40) {
        M.compose(V, Q2, S.setScalar(s * 1.05));
        this.bolt.setMatrixAt(nb++, M);
      }
      M.compose(V, Q.identity(), S.setScalar(s));
      if (q.kind === Pop.Star) C.setHSL((t * 0.5) % 1, 1, 0.58);
      else if (q.kind === Pop.Thunder) C.set(Math.sin(t * 11 + q.ph) > 0.82 ? 0xfff27a : 0x6a3ad0);
      else if (q.kind === Pop.High) C.set(BLOON_HIGH[q.k % 3]);
      else C.set(BLOON_LOW[q.k % 5]);
      // (one that's in the way of the view goes see-through; a bit further out before it comes back, so it can't flicker)
      if (this.inView(q.k, V, s, cam, me) && ng < 24) {
        this.ghost.setMatrixAt(ng, M);
        this.ghost.setColorAt(ng++, C);
        continue;
      }
      this.body.setMatrixAt(n, M);
      this.tail.setMatrixAt(n, M);
      this.body.setColorAt(n, C);
      n++;
    }
    this.body.count = this.tail.count = n;
    this.ghost.count = ng;
    this.bolt.count = nb;
    this.bolt.instanceMatrix.needsUpdate = true;
    this.body.instanceMatrix.needsUpdate = this.tail.instanceMatrix.needsUpdate = this.ghost.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.ghost.instanceColor) this.ghost.instanceColor.needsUpdate = true;
  }
}
const SEG = new THREE.Vector3(), OFF = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
const Q2 = new THREE.Quaternion();
const BLOON_LOW = [0xff4f7a, 0xffb02f, 0x37d07a, 0x2fa8ff, 0xff7ad0];
/** the high ones are worth more: silver-bright so you can tell them */
const BLOON_HIGH = [0xe8f4ff, 0xc8f0ff, 0xf4e8ff];

/** Crown Keeper: who has the crown and for how long. The host decides; a guest is told and shows it */
export class KeepPlay {
  readonly arena;
  /** seconds on each bean's clock */
  readonly held = new Map<number, number>();
  /** nobody can catch it before then (it has only just left someone's head) */
  private looseT = 0;
  private crown: THREE.Object3D;
  private beam: THREE.Mesh;
  private shaft: THREE.Mesh;
  /** the gold ring round whoever has it, and the mark where a thrown crown is going to land */
  private halo: THREE.Mesh;
  private mark: THREE.Mesh;
  /** a crown in the air: where it left, when, how long for */
  private fly: { x: number; y: number; z: number; t: number; dur: number; h: number } | null = null;
  /** where the crown is drawn */
  readonly at = new THREE.Vector3();
  /** who just took it, this frame (id, how: 'took' off the floor or out of the air, 'stole' it) */
  taken: { id: number; how: 'took' | 'stole' } | null = null;
  /** a dive just knocked it flying: who did it */
  knocked = -1;
  /** the crown went over the edge with someone: it's flying home */
  homing = false;
  private go: { go: number };

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.keep!;
    this.go = course.state;
    const A = this.arena;
    A.holder = -1;
    A.x = A.center.x;
    A.z = A.center.z;
    A.share = 0;
    A.zoomT = 0;
    this.crown = makeCrown();
    this.crown.scale.setScalar(0.62);
    scene.add(this.crown);
    const add = (g: THREE.BufferGeometry, opacity: number) => {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }));
      scene.add(m);
      return m;
    };
    this.beam = add(new THREE.CylinderGeometry(1.1, 1.1, 60, 20, 1, true).translate(0, 30, 0), 0.2);
    this.shaft = add(new THREE.CylinderGeometry(0.34, 0.34, 40, 12, 1, true).translate(0, 20, 0), 0.26);
    this.halo = add(new THREE.RingGeometry(0.72, 1.02, 40).rotateX(-Math.PI / 2), 0.9);
    this.mark = add(new THREE.RingGeometry(1.1, 1.5, 40).rotateX(-Math.PI / 2), 0.8);
  }

  dispose() {
    this.scene.remove(this.crown, this.beam, this.shaft, this.halo, this.mark);
  }

  /** where it comes down: never out over a hole */
  private landing(x: number, z: number, t: number): [number, number] {
    const A = this.arena;
    let px = x - A.center.x, pz = z - A.center.z;
    const pr = Math.hypot(px, pz), lim = KEEP.R - 2;
    if (pr > lim) (px *= lim / pr), (pz *= lim / pr);
    for (let k = 0; k < 12 && !A.onTop(new THREE.Vector3(A.center.x + px, A.center.y + KEEP.top, A.center.z + pz)) && !A.solid(A.center.x + px, A.center.z + pz, t + 4); k++) (px *= 0.88), (pz *= 0.88);
    return [A.center.x + px, A.center.z + pz];
  }

  /** the crown leaves a head for a spot on the floor, in an arc (a guest starts its own from what it drew) */
  throwFrom(from: THREE.Vector3, t: number, dur: number, h: number) {
    this.fly = { x: from.x, y: from.y, z: from.z, t, dur, h };
  }

  /** knocked out of someone's hands: it flies `d` metres the way `dx, dz` says */
  private loosen(t: number, from: THREE.Vector3, dx: number, dz: number, d: number) {
    const A = this.arena;
    const l = Math.hypot(dx, dz) || 1;
    const [x, z] = this.landing(from.x + (dx / l) * d, from.z + (dz / l) * d, t);
    A.holder = -1;
    A.x = x;
    A.z = z;
    this.looseT = t + 0.28;
    this.throwFrom(this.at, t, 0.85, 3.4);
  }

  /** gone over the edge: the crown flies home to the throne */
  private home(t: number) {
    const A = this.arena;
    A.holder = -1;
    A.x = A.center.x;
    A.z = A.center.z;
    this.looseT = t + 0.9;
    this.homing = true;
    this.throwFrom(this.at, t, 1.3, 9);
  }

  private give(r: Who, how: 'took' | 'stole', t: number) {
    this.arena.holder = r.m.id;
    this.safeT = t + KEEP.safe;
    this.arena.zoomT = t + KEEP.safe;
    this.fly = null;
    this.taken = { id: r.m.id, how };
  }

  /** (the host) the clock, the pick-ups and the steals; true when who has it changed */
  tick(dt: number, t: number, go: boolean): boolean {
    const A = this.arena;
    this.taken = null;
    this.knocked = -1;
    this.homing = false;
    if (!go) return false;
    const all = this.who().filter((r) => !r.out);
    const on = (r: Who) => r.m.active && r.m.pos.y > A.center.y - 1;
    if (A.holder < 0) {
      if (t < this.looseT) return false;
      this.place(t);
      // (lying somewhere nobody's getting to: home it goes)
      if (t > this.looseT + KEEP.stale && Math.hypot(A.x - A.center.x, A.z - A.center.z) > 0.1) {
        this.home(t);
        return true;
      }
      for (const r of all) {
        if (!on(r) || r.m.mode === Mode.Tumble) continue;
        // (it can be caught out of the air, if you get up to it)
        if (Math.hypot(r.m.pos.x - this.at.x, r.m.pos.z - this.at.z) > KEEP.pick || Math.abs(r.m.pos.y + 0.3 - this.at.y) > 1.9) continue;
        this.give(r, 'took', t);
        return true;
      }
      return false;
    }
    const h = all.find((r) => r.m.id === A.holder);
    if (!h || !on(h)) {
      this.home(t);
      return true;
    }
    this.held.set(h.m.id, (this.held.get(h.m.id) ?? 0) + dt * (A.onTop(h.m.pos) && A.hot(this.x(t)) ? KEEP.throne : 1));
    if (t < this.safeT) return false;
    if (h.m.mode === Mode.Tumble) {
      this.loosen(t, h.m.pos, h.m.vel.x || Math.random() - 0.5, h.m.vel.z || Math.random() - 0.5, 4.5 + Math.random() * 2.5);
      return true;
    }
    for (const o of all) {
      if (o === h || !on(o)) continue;
      const d = o.m.pos.distanceTo(h.m.pos);
      if (o.m.holding === h.m && d < KEEP.steal + 0.4) {
        // (a grab takes it clean)
        this.give(o, 'stole', t);
        return true;
      }
      if (o.m.mode === Mode.Dive && d < KEEP.steal) {
        // (a dive sends it flying the way you were going: you're first to it, if you get up quick)
        this.loosen(t, h.m.pos, o.m.vel.x, o.m.vel.z, 5 + Math.random() * 2.5);
        this.knocked = o.m.id;
        return true;
      }
    }
    return false;
  }
  private safeT = 0;

  private x(t: number) {
    return t - this.go.go;
  }

  /** how close the leader is, and who it is */
  winner() {
    for (const r of this.who()) if ((this.held.get(r.m.id) ?? 0) >= KEEP.hold) return r;
    return null;
  }
  /** past the clock with someone else holding it and still able to catch the leader? */
  overtime() {
    const A = this.arena;
    return A.holder >= 0 && this.ranking()[0]?.m.id !== A.holder;
  }
  ranking() {
    return [...this.who()].sort((a, b) => (this.held.get(b.m.id) ?? 0) - (this.held.get(a.m.id) ?? 0) || b.c.skill - a.c.skill);
  }
  board() {
    const rank = this.ranking();
    const me = rank.findIndex((r) => r.c.player);
    const show = rank.slice(0, 3);
    if (me >= 3) show.push(rank[me]);
    return show.map((r) => {
      const s = this.held.get(r.m.id) ?? 0;
      return { name: `${r.m.id === this.arena.holder ? '♛ ' : ''}${r.c.name}`, color: r.c.outfit.a, share: s / KEEP.hold, mine: r.c.player, label: `${s.toFixed(1)}s` };
    });
  }

  /** where a loose crown is now: in the air on its arc, or hovering over its spot */
  private place(t: number) {
    const A = this.arena;
    const gy = A.groundAt(A.x, A.z) + 1.05;
    const f = this.fly;
    if (f && t < f.t + f.dur) {
      const k = (t - f.t) / f.dur;
      this.at.set(f.x + (A.x - f.x) * k, f.y + (gy - f.y) * k + Math.sin(k * Math.PI) * f.h, f.z + (A.z - f.z) * k);
      return true;
    }
    this.fly = null;
    this.at.set(A.x, gy + Math.sin(t * 3) * 0.14, A.z);
    return false;
  }

  /** the crown on its bean's head, or in the air, or spinning on the floor in a shaft of light */
  sync(t: number) {
    const A = this.arena;
    const h = A.holder >= 0 ? this.who().find((r) => r.m.id === A.holder) : null;
    A.share = h ? Math.min(1, (this.held.get(h.m.id) ?? 0) / KEEP.hold) : 0;
    this.beam.visible = !h;
    this.shaft.visible = this.halo.visible = !!h;
    if (h) {
      this.at.set(h.m.pos.x, h.m.pos.y + 1.34, h.m.pos.z);
      this.crown.position.copy(this.at);
      this.crown.rotation.set(0, t * 2, 0);
      this.crown.scale.setScalar(0.5 + 0.12 * A.share);
      this.shaft.position.set(h.m.pos.x, h.m.pos.y, h.m.pos.z);
      this.halo.position.set(h.m.pos.x, h.m.pos.y - 0.42, h.m.pos.z);
      this.halo.scale.setScalar(1 + Math.sin(t * 6) * 0.08 + A.share * 0.5);
      (this.shaft.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.34 * A.share;
      this.mark.visible = false;
      return;
    }
    const flying = this.place(t);
    this.crown.position.copy(this.at);
    this.crown.rotation.set(flying ? t * 9 : 0, t * (flying ? 11 : 1.5), 0);
    this.crown.scale.setScalar(0.86);
    this.beam.position.set(this.at.x, A.groundAt(A.x, A.z), this.at.z);
    this.mark.visible = flying;
    if (flying) {
      this.mark.position.set(A.x, A.groundAt(A.x, A.z) + 0.07, A.z);
      this.mark.scale.setScalar(1 + Math.sin(t * 14) * 0.15);
    }
  }
}
