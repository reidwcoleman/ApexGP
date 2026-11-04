import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { GOLD, SPUD, type Coin } from './course-modes.ts';
import { glowMat } from './obs-world.ts';
import { KEEP } from './course-crown.ts';

/**
 * The host's side of the two games that aren't a function of the clock: who has a spud, who has
 * how much gold. The host (or solo) decides; a guest is told and shows it.
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
      const n = Math.max(1, Math.min(Math.ceil(all.length * 0.13), all.length - slots, this.spuds.length));
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

/** Gold Rush: the coins in the air and on the sand, who has what */
export class GoldPlay {
  readonly score = new Map<number, number>();
  readonly taken = new Set<number>();
  /** coins knocked out of someone (they stay a shorter while) */
  private spilt: Coin[] = [];
  private nextK = 100000;
  /** the coins out there now: for the bots */
  readonly live: Coin[] = [];
  private first = 0;
  private mesh: THREE.InstancedMesh;
  private tumbled = new Set<number>();
  private M = new THREE.Matrix4();
  private V = new THREE.Vector3();
  private Q = new THREE.Quaternion();
  private S = new THREE.Vector3();
  private E = new THREE.Euler();
  readonly arena;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.gold!;
    const g = new THREE.CylinderGeometry(0.56, 0.56, 0.14, 22).rotateX(Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xffa800, roughness: 0.4, metalness: 0.45, emissive: 0xc06800, emissiveIntensity: 0.4 });
    this.mesh = new THREE.InstancedMesh(g, m, 240);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }

  /** what's out there at x seconds after the off */
  refresh(x: number) {
    const L = this.live;
    L.length = 0;
    const list = this.arena.coins;
    while (this.first < list.length && list[this.first].t + GOLD.life < x) this.first++;
    for (let i = this.first; i < list.length && list[i].t <= x; i++) if (!this.taken.has(list[i].k)) L.push(list[i]);
    this.spilt = this.spilt.filter((c) => c.t + 7 > x && !this.taken.has(c.k));
    for (const c of this.spilt) L.push(c);
  }

  /** (the host) anyone standing on a landed coin has it; returns the pick-ups */
  grabs(x: number): { k: number; id: number; v: number }[] {
    const out: { k: number; id: number; v: number }[] = [];
    const all = this.who();
    for (const k of this.live) {
      if (this.taken.has(k.k) || k.t + GOLD.fly > x) continue;
      for (const r of all) {
        const m = r.m;
        if (!m.active || m.pos.y < this.arena.center.y - 0.5) continue;
        const dx = m.pos.x - k.x, dz = m.pos.z - k.z;
        // (people's hands reach a little further: no one's as exact as a bot)
        const reach = r.c.human ? GOLD.take + 0.5 : GOLD.take;
        if (dx * dx + dz * dz > reach * reach) continue;
        this.take(k.k, m.id, k.v);
        out.push({ k: k.k, id: m.id, v: k.v });
        break;
      }
    }
    return out;
  }

  take(k: number, id: number, v: number) {
    this.taken.add(k);
    this.score.set(id, (this.score.get(id) ?? 0) + v);
  }
  set(id: number, n: number) {
    this.score.set(id, n);
  }
  add(list: [number, number, number, number][]) {
    for (const [k, x, z, t] of list) this.spilt.push({ k, x, z, t, v: 1 });
  }

  /** (the host) knocked over: some of its gold flies out round it. Returns the coins for the guests */
  knocks(x: number): { id: number; n: number; add: [number, number, number, number][] }[] {
    const out: { id: number; n: number; add: [number, number, number, number][] }[] = [];
    for (const r of this.who()) {
      const m = r.m;
      const down = m.mode === Mode.Tumble;
      if (!down) {
        this.tumbled.delete(m.id);
        continue;
      }
      if (this.tumbled.has(m.id)) continue;
      this.tumbled.add(m.id);
      out.push(...this.spill(r, Math.min(3, this.score.get(m.id) ?? 0), x));
    }
    return out;
  }

  /** (the host) into the sea: a third of it is gone */
  fell(r: Who) {
    const n = this.score.get(r.m.id) ?? 0;
    const left = n - Math.ceil(n / 3);
    this.score.set(r.m.id, left);
    return left;
  }

  private spill(r: Who, n: number, x: number) {
    if (n <= 0) return [];
    const A = this.arena;
    const id = r.m.id;
    this.score.set(id, (this.score.get(id) ?? 0) - n);
    const add: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 1.8 + Math.random() * 1.8;
      let cx = r.m.pos.x + Math.cos(a) * d, cz = r.m.pos.z + Math.sin(a) * d;
      const pr = Math.hypot(cx - A.center.x, cz - A.center.z), lim = A.R - 1;
      if (pr > lim) (cx = A.center.x + ((cx - A.center.x) / pr) * lim), (cz = A.center.z + ((cz - A.center.z) / pr) * lim);
      add.push([this.nextK++, cx, cz, x - GOLD.fly + 0.35]);
    }
    this.add(add);
    return [{ id, n: this.score.get(id) ?? 0, add }];
  }

  /** the field, most gold first (ties: the luck of the draw) */
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

  /** the coins: flying out of the chest, then spinning on the sand */
  sync(t: number, x: number) {
    const A = this.arena, { M, V, Q, S, E } = this;
    let n = 0;
    for (const k of this.live) {
      if (n >= 240) break;
      const u = (x - k.t) / GOLD.fly;
      const big = k.v >= GOLD.big ? 3 : k.v > 1 ? 1.75 : 1;
      if (u < 1) {
        const q = Math.max(0, u);
        V.set(A.center.x + (k.x - A.center.x) * q, A.center.y + 1.6 + 8 * q * (1 - q) * 2 - 1 * q, A.center.z + (k.z - A.center.z) * q);
        if (k.k >= 100000) V.set(k.x, A.center.y + 0.6 + 2.4 * (1 - q) * q * 4, k.z);
      } else V.set(k.x, A.center.y + 0.62 + 0.1 * Math.sin(t * 3 + k.k), k.z);
      Q.setFromEuler(E.set(0, t * 3 + k.k, 0));
      // (about to go: it blinks)
      const left = (k.k >= 100000 ? 7 : GOLD.life) - (x - k.t);
      const blink = left < 2 && Math.sin(t * 16) < 0;
      M.compose(V, Q, S.setScalar(blink ? 0.001 : big));
      this.mesh.setMatrixAt(n++, M);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Crown Keeper: who has the crown and for how long. The host decides; a guest is told and shows it */
export class KeepPlay {
  readonly arena;
  /** seconds each bean has held it */
  readonly held = new Map<number, number>();
  /** nobody picks it up again until then (it has to land) */
  private looseT = 0;
  private crown = new THREE.Group();
  private beam: THREE.Mesh;
  /** who just took it, this frame (id, how: 'took' off the floor, 'stole' it) */
  taken: { id: number; how: 'took' | 'stole' } | null = null;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.keep!;
    const A = this.arena;
    A.holder = -1;
    A.x = A.center.x;
    A.z = A.center.z;
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.22, metalness: 0.75, emissive: 0xa06000, emissiveIntensity: 0.5 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.4, 0.3, 24, 1, true), gold);
    gold.side = THREE.DoubleSide;
    this.crown.add(band);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 8), gold);
      tip.position.set(Math.cos(a) * 0.43, 0.3, Math.sin(a) * 0.43);
      this.crown.add(tip);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glowMat(k % 2 ? 0xff3a6a : 0x3ac8ff, 2.5));
      gem.position.set(Math.cos(a) * 0.45, 0.47, Math.sin(a) * 0.45);
      this.crown.add(gem);
    }
    this.crown.traverse((o) => (o.castShadow = true));
    scene.add(this.crown);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 30, 16, 1, true).translate(0, 15, 0), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }));
    scene.add(this.beam);
  }

  dispose() {
    this.scene.remove(this.crown, this.beam);
  }

  /** knocked out of someone's hands: it flies a few metres and lands on the floor */
  private loosen(t: number, from: THREE.Vector3) {
    const A = this.arena;
    const a = Math.random() * Math.PI * 2, d = 2.5 + Math.random() * 2.5;
    let x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
    const px = x - A.center.x, pz = z - A.center.z, pr = Math.hypot(px, pz), lim = A.R - 2.5;
    if (pr > lim) (x = A.center.x + (px / pr) * lim), (z = A.center.z + (pz / pr) * lim);
    A.holder = -1;
    A.x = x;
    A.z = z;
    this.looseT = t + 0.45;
  }

  /** (the host) the clock, the pick-ups and the steals; true when who has it changed */
  tick(dt: number, t: number, go: boolean): boolean {
    const A = this.arena;
    this.taken = null;
    if (!go) return false;
    const all = this.who().filter((r) => !r.out);
    const on = (r: Who) => r.m.active && r.m.pos.y > A.center.y - 1;
    if (A.holder < 0) {
      if (t < this.looseT) return false;
      for (const r of all) {
        if (!on(r) || r.m.mode === Mode.Tumble) continue;
        if (Math.hypot(r.m.pos.x - A.x, r.m.pos.z - A.z) > KEEP.pick || r.m.pos.y > A.center.y + 3) continue;
        A.holder = r.m.id;
        this.safeT = t + KEEP.safe;
        this.taken = { id: r.m.id, how: 'took' };
        return true;
      }
      return false;
    }
    const h = all.find((r) => r.m.id === A.holder);
    if (!h || !on(h) || h.m.mode === Mode.Tumble) {
      this.loosen(t, h && on(h) ? h.m.pos : A.center);
      return true;
    }
    this.held.set(h.m.id, (this.held.get(h.m.id) ?? 0) + dt);
    if (t < this.safeT) return false;
    for (const o of all) {
      if (o === h || !on(o)) continue;
      const d = o.m.pos.distanceTo(h.m.pos);
      const hit = (o.m.mode === Mode.Dive && d < KEEP.steal) || (o.m.holding === h.m && d < KEEP.steal + 0.4);
      if (!hit) continue;
      // (it's yours if you're the one who hit them)
      A.holder = o.m.id;
      this.safeT = t + KEEP.safe;
      this.taken = { id: o.m.id, how: 'stole' };
      return true;
    }
    return false;
  }
  private safeT = 0;

  /** how close the leader is, and who it is */
  winner() {
    for (const r of this.who()) if ((this.held.get(r.m.id) ?? 0) >= KEEP.hold) return r;
    return null;
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

  /** the crown on its bean's head, or spinning on the floor under a shaft of light */
  sync(t: number) {
    const A = this.arena;
    const h = A.holder >= 0 ? this.who().find((r) => r.m.id === A.holder) : null;
    this.beam.visible = !h;
    if (h) {
      this.crown.position.set(h.m.pos.x, h.m.pos.y + 1.42, h.m.pos.z);
      this.crown.rotation.set(0, t * 2, 0);
    } else {
      this.crown.position.set(A.x, A.center.y + 1.1 + Math.sin(t * 3) * 0.14, A.z);
      this.crown.rotation.set(0, t * 1.5, 0);
      this.beam.position.set(A.x, A.center.y, A.z);
    }
  }
}
