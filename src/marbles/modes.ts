import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
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
