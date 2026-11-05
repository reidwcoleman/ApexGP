import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { SPUD } from './course-modes.ts';
import { BOUNCE, Pop, popValue, type Balloon } from './course-bounce.ts';
import { glowMat } from './obs-world.ts';
import { KEEP } from './course-crown.ts';
import { makeCrown } from './course-kit.ts';

/**
 * The host's side of the two games that aren't a function of the clock: who has a spud, who has
 * what's popped. The host (or solo) decides; a guest is told and shows it.
 */

interface Who {
  c: { id: number; name: string; skill: number; player: boolean; human: boolean; outfit: { a: number } };
  m: Marble;
  out: boolean;
}

/** Hot Spud: the fuses, the passing and the spuds on people's heads */
export class SpudPlay {
  private spuds: THREE.Group[] = [];
  /** a red ring on the floor round everyone holding one */
  private marks: THREE.Mesh[] = [];
  private sparks: THREE.Mesh[] = [];
  private skin: THREE.MeshStandardMaterial;
  private since = new Map<number, number>();
  private nextFuse = 2;
  readonly arena;
  /** the ones it took this time round */
  blown: number[] = [];
  /** who handed it to whom this frame */
  passed: [number, number][] = [];

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.spud!;
    const skin = (this.skin = new THREE.MeshStandardMaterial({ color: 0xd8904a, roughness: 0.6, emissive: 0xff3010, emissiveIntensity: 0.25 }));
    const fuseM = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 });
    const body = new THREE.SphereGeometry(0.72, 22, 16).scale(1.2, 0.85, 0.9);
    const fuse = new THREE.CylinderGeometry(0.035, 0.05, 0.5, 6).translate(0, 0.25, 0).rotateZ(-0.4);
    const ringG = new THREE.RingGeometry(0.95, 1.2, 36).rotateX(-Math.PI / 2);
    const ringM = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    for (let k = 0; k < 8; k++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(body, skin);
      b.castShadow = true;
      const f = new THREE.Mesh(fuse, fuseM);
      f.position.y = 0.55;
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), glowMat(0xffa030, 4));
      s.position.set(0.2, 1.02, 0);
      g.add(b, f, s);
      g.visible = false;
      scene.add(g);
      this.spuds.push(g);
      this.sparks.push(s);
      const r = new THREE.Mesh(ringG, ringM);
      r.visible = false;
      scene.add(r);
      this.marks.push(r);
    }
  }

  dispose() {
    for (const g of [...this.spuds, ...this.marks]) this.scene.remove(g);
  }

  /** the new list of holders: anyone who's just got rid of one gets a burst of speed */
  setHolders(h: Iterable<number>, end: number, t: number) {
    const A = this.arena;
    const next = new Set(h);
    if (next.size) for (const id of A.holders) if (!next.has(id)) A.free.set(id, t + 1.1);
    A.holders = next;
    A.end = end;
  }

  /** (the host) the fuses and the passing; true when the list of holders changed */
  tick(t: number, slots: number, x: number): boolean {
    const A = this.arena;
    const all = this.who().filter((r) => !r.out);
    let changed = false;
    this.blown.length = 0;
    this.passed.length = 0;
    if (!A.holders.size) {
      if (x < this.nextFuse || all.length <= slots) return false;
      // (a fuse: fewer spuds than there are places left to lose)
      const n = Math.max(1, Math.min(Math.ceil(all.length * 0.08), all.length - slots, this.spuds.length));
      const pool = [...all].sort(() => Math.random() - 0.5).slice(0, n);
      for (const r of pool) {
        A.holders.add(r.m.id);
        this.since.set(r.m.id, t);
      }
      A.end = t + SPUD.fuse;
      return true;
    }
    if (t >= A.end) {
      this.blown = [...A.holders];
      A.holders.clear();
      this.nextFuse = x + SPUD.gap;
      return true;
    }
    for (const h of all) {
      if (!A.holders.has(h.m.id) || t - (this.since.get(h.m.id) ?? 0) < SPUD.wait) continue;
      for (const o of all) {
        if (A.holders.has(o.m.id) || !o.m.active) continue;
        // (a dive reaches further: it's how you tag a runner)
        const reach = h.m.mode === Mode.Dive ? SPUD.dive : SPUD.pass;
        if (h.m.pos.distanceToSquared(o.m.pos) > reach * reach) continue;
        A.holders.delete(h.m.id);
        A.holders.add(o.m.id);
        A.free.set(h.m.id, t + 1.1);
        this.since.set(o.m.id, t);
        this.passed.push([h.m.id, o.m.id]);
        changed = true;
        break;
      }
    }
    return changed;
  }

  /** the spuds on their heads, shaking harder as the fuse runs down */
  sync(t: number) {
    const A = this.arena;
    const left = Math.max(0, A.end - t);
    // (it glows hotter and pulses faster as the fuse runs down)
    this.skin.emissiveIntensity = 0.25 + (1 - Math.min(1, left / SPUD.fuse)) * 1.4 * (0.6 + 0.4 * Math.sin(t * (left < 3 ? 22 : 8)));
    let i = 0;
    for (const r of this.who()) {
      if (!A.holders.has(r.m.id) || r.out || i >= this.spuds.length) continue;
      const g = this.spuds[i];
      const shake = left < 3 ? (3 - left) * 0.03 : 0;
      g.position.set(r.m.pos.x + Math.sin(t * 50) * shake, r.m.pos.y + 1.75, r.m.pos.z + Math.cos(t * 43) * shake);
      g.rotation.y = t * 2;
      g.visible = true;
      this.sparks[i].scale.setScalar(0.8 + 0.5 * Math.sin(t * (left < 3 ? 40 : 18)));
      const k = this.marks[i];
      k.position.set(r.m.pos.x, r.m.pos.y - 0.46, r.m.pos.z);
      k.scale.setScalar(1 + 0.12 * Math.sin(t * (left < 3 ? 22 : 9)));
      k.visible = true;
      i++;
    }
    for (; i < this.spuds.length; i++) this.spuds[i].visible = this.marks[i].visible = false;
  }
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
    this.body.frustumCulled = this.tail.frustumCulled = false;
    this.body.castShadow = true;
    this.body.setColorAt(0, this.C.set(0xffffff));
    scene.add(this.body, this.tail);
  }

  dispose() {
    this.scene.remove(this.body, this.tail);
    this.body.dispose();
    this.tail.dispose();
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

  /** the balloons: swelling up off the floor, bobbing, and away up into the sky when their time's out */
  sync(t: number, x: number) {
    const A = this.arena, { M, V, Q, S, C } = this;
    let n = 0;
    for (const q of this.live) {
      if (n >= 260) break;
      A.at(q, x, V);
      const u = x - q.t, left = BOUNCE.life - u;
      if (left < 1) V.y += (1 - left) ** 2 * 14;
      const s = (q.kind === Pop.Star ? 1.9 : q.kind === Pop.High ? 1.05 : q.kind === Pop.Thunder ? 0.95 : 0.9) * Math.min(1, u / 0.35 + 0.1);
      M.compose(V, Q.identity(), S.setScalar(s));
      this.body.setMatrixAt(n, M);
      this.tail.setMatrixAt(n, M);
      if (q.kind === Pop.Star) C.setHSL((t * 0.5) % 1, 1, 0.58);
      else if (q.kind === Pop.Thunder) C.set(Math.sin(t * 11 + q.ph) > 0.82 ? 0xfff27a : 0x2a1a48);
      else if (q.kind === Pop.High) C.set(BLOON_HIGH[q.k % 3]);
      else C.set(BLOON_LOW[q.k % 5]);
      this.body.setColorAt(n, C);
      n++;
    }
    this.body.count = this.tail.count = n;
    this.body.instanceMatrix.needsUpdate = this.tail.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
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
