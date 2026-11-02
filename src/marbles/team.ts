import * as THREE from 'three';
import type { Course } from './courses.ts';
import { TEAM_COLORS, TEAM_NAMES, type TeamArena } from './course-paintparty.ts';
import { Mode, type Marble } from './physics.ts';
import type { Sound } from './audio.ts';

/**
 * The team round's rules, as every browser runs them: each bean on the ground paints the tile
 * under it its team's colour; a coloured ring at each bean's feet says whose side it's on; a bean
 * that falls comes back at its team's base. (Online every browser paints from the beans it sees;
 * the host's count decides.)
 */

interface Who {
  c: { id: number; player: boolean };
  m: Marble;
  out: boolean;
  fell: number;
}

export interface TeamScore {
  name: string;
  color: number;
  share: number;
  mine: boolean;
}

/** a paint bomb lying on the floor: run into it and it splats your colour all round you */
interface Pickup {
  k: number;
  pos: THREE.Vector3;
  obj: THREE.Object3D;
  born: number;
}
/** the k-th paint bomb drops at GO + FIRST + k·EVERY, and lies there until it's taken or LIFE runs out */
const FIRST = 4, EVERY = 4.5, LIFE = 14, SPLAT_R = 2.6;

export class TeamPlay {
  private rings = new Map<number, THREE.Mesh>();
  private bombs: Pickup[] = [];
  private nextK = 0;
  private gone = new Set<number>();
  private bombGeo: THREE.BufferGeometry;
  private bombMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.08 });
  private haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, toneMapped: false });
  private haloGeo = new THREE.TorusGeometry(0.75, 0.06, 8, 40).rotateX(Math.PI / 2);
  private ringGeo = new THREE.TorusGeometry(0.62, 0.07, 8, 32).rotateX(Math.PI / 2);
  private mats: THREE.MeshBasicMaterial[];
  private blipT = 0;
  readonly arena: TeamArena;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
    private sound: Sound,
  ) {
    this.arena = course.team!;
    this.mats = TEAM_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, toneMapped: false }));
    // the bomb: a glossy ball in swirls of every team's colour, a white cap and a fuse
    const g = new THREE.SphereGeometry(0.6, 32, 20).toNonIndexed();
    const p = g.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    const C = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      if (y > 0.47) C.set(0xffffff);
      else C.set(TEAM_COLORS[Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 6 + y * 3 + 6) % 3]);
      for (let k = 0; k < 3; k++) C.toArray(col, (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    this.bombGeo = g;
  }

  /** where the k-th bomb lands: a tile picked from the round and k (the same in every browser) */
  private bombAt(k: number, seed: number) {
    const A = this.arena;
    let h = (k * 2654435761 + seed * 40503 + 17) >>> 0;
    const rnd = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    const out = new THREE.Vector3();
    for (let tries = 0; tries < 60; tries++) {
      const i = Math.floor(rnd() * A.n * A.n);
      A.centreOf(i, out);
      if (A.cellAt(out.x, out.z) < 0 || A.nearWall(out.x, out.z, 2.2)) continue;
      const cx = out.x - A.center.x, cz = out.z - A.center.z;
      if (!A.round && cx * cx + cz * cz < 5 * 5) continue;
      return out;
    }
    return out.set(A.center.x + 4, A.center.y, A.center.z + 4);
  }

  /**
   * The bombs: new ones drop on schedule; with `authority` (solo, or the host) a bean that runs
   * into one sets it off. Returns what went off this frame (the host sends these to the guests).
   */
  bombsUpdate(t: number, go: number, seed: number, authority: boolean): { k: number; id: number }[] {
    const A = this.arena;
    const out: { k: number; id: number }[] = [];
    if (!(go < 1e8)) return out;
    while (go + FIRST + this.nextK * EVERY <= t) {
      const k = this.nextK++;
      const born = go + FIRST + k * EVERY;
      if (this.gone.has(k) || t - born > LIFE) continue;
      const pos = this.bombAt(k, seed);
      const obj = new THREE.Group();
      const ball = new THREE.Mesh(this.bombGeo, this.bombMat);
      ball.castShadow = true;
      ball.position.y = 0.9;
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), this.haloMat);
      fuse.position.y = 1.28;
      const halo = new THREE.Mesh(this.haloGeo, this.haloMat);
      halo.position.y = 0.05;
      obj.add(ball, fuse, halo);
      obj.position.copy(pos);
      this.scene.add(obj);
      this.bombs.push({ k, pos, obj, born });
    }
    for (let q = this.bombs.length - 1; q >= 0; q--) {
      const b = this.bombs[q];
      const age = t - b.born;
      // (dropping in, bobbing, a pulse of the ring on the floor)
      const drop = Math.max(0, 1 - age / 0.5);
      b.obj.position.y = b.pos.y + drop * drop * 8;
      b.obj.children[0].position.y = 0.9 + Math.sin(t * 3 + b.k) * 0.12;
      b.obj.children[1].position.y = b.obj.children[0].position.y + 0.68;
      b.obj.rotation.y = t * 1.6 + b.k;
      b.obj.children[2].scale.setScalar(1 + 0.15 * Math.sin(t * 6));
      if (age > LIFE) {
        this.remove(q);
        continue;
      }
      if (!authority || drop > 0) continue;
      for (const r of this.who()) {
        const m = r.m;
        if (r.out || r.fell || !m.active) continue;
        if (Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z) < 1.25 && Math.abs(m.pos.y - b.pos.y - 0.5) < 1.6) {
          out.push({ k: b.k, id: r.c.id });
          this.boom(q, r.c.id);
          break;
        }
      }
    }
    A.pickups.length = 0;
    for (const b of this.bombs) A.pickups.push(b.pos);
    return out;
  }

  /** bomb k set off by bean `id` (the host told us, or we saw it): its team's colour splashed round it */
  collect(k: number, id: number) {
    this.gone.add(k);
    const q = this.bombs.findIndex((b) => b.k === k);
    if (q >= 0) this.boom(q, id);
  }
  /** the last bomb that went off: where, and whose */
  lastBoom: { pos: THREE.Vector3; team: number; mine: boolean } | null = null;
  private boom(q: number, id: number) {
    const b = this.bombs[q];
    const team = this.teamOf(id);
    this.gone.add(b.k);
    this.arena.splat(b.pos.x, b.pos.z, SPLAT_R, team);
    const me = this.who().find((r) => r.c.player);
    this.lastBoom = { pos: b.pos.clone(), team, mine: !!me && this.teamOf(me.c.id) === team };
    this.sound.notes(this.lastBoom.mine ? [72, 76, 79, 84] : [60, 55], 0, 0.07, true);
    this.remove(q);
  }
  private remove(q: number) {
    this.scene.remove(this.bombs[q].obj);
    this.bombs.splice(q, 1);
  }

  teamOf(id: number) {
    return this.arena.of.get(id) ?? 0;
  }
  nameOf(id: number) {
    return TEAM_NAMES[this.teamOf(id)];
  }
  mine() {
    const p = this.who().find((r) => r.c.player);
    if (!p) return null;
    const t = this.teamOf(p.c.id);
    return { name: TEAM_NAMES[t], color: TEAM_COLORS[t] };
  }

  /** paint under every bean that's on its feet */
  paint() {
    const now = performance.now();
    for (const r of this.who()) {
      const m = r.m;
      if (r.out || r.fell || !m.active || m.groundT > 0.12) continue;
      if (this.arena.paint(m.pos.x, m.pos.z, this.teamOf(r.c.id)) && r.c.player && now - this.blipT > 70) {
        this.blipT = now;
        this.sound.notes([72 + Math.floor(Math.random() * 3) * 2], 0, 0.06, true);
      }
    }
  }

  /** the rings follow their beans */
  sync() {
    const seen = new Set<number>();
    for (const r of this.who()) {
      const id = r.c.id;
      seen.add(id);
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.ringGeo, this.mats[this.teamOf(id)]);
        ring.renderOrder = 2;
        this.scene.add(ring);
        this.rings.set(id, ring);
      }
      ring.visible = !r.out && !r.fell && r.m.active;
      ring.position.set(r.m.pos.x, this.arena.center.y + 0.04, r.m.pos.z);
      // (lifts with a jump, shrinks with the height: a shadow of a sort)
      const k = THREE.MathUtils.clamp(1 - (r.m.pos.y - this.arena.center.y - 0.5) * 0.25, 0.4, 1);
      ring.scale.setScalar(r.c.player ? k * 1.15 : k);
    }
    for (const [id, ring] of this.rings) if (!seen.has(id)) ring.visible = false;
  }

  respawn(m: Marble) {
    const t = this.teamOf(m.id);
    const p = this.arena.base(t);
    m.pos.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 3));
    m.vel.set(0, 0, 0);
    m.ang.set(0, 0, 0);
    m.mode = Mode.Run;
    m.tumbleT = m.upT = m.heldT = 0;
    m.release();
    m.yaw = Math.atan2(this.arena.center.x - p.x, this.arena.center.z - p.z);
  }

  scores(): TeamScore[] {
    const c = this.arena.counts();
    const total = this.arena.total;
    const mine = this.mine();
    return c.map((n, k) => ({ name: TEAM_NAMES[k], color: TEAM_COLORS[k], share: n / total, mine: mine?.name === TEAM_NAMES[k] }));
  }

  /** the team with the least floor (a tie: the one with fewer beans standing loses, then the first) */
  loser() {
    const c = this.arena.counts();
    let lo = 0;
    for (let k = 1; k < c.length; k++) if (c[k] < c[lo]) lo = k;
    return lo;
  }

  dispose() {
    for (const b of this.bombs) this.scene.remove(b.obj);
    this.bombs.length = 0;
    this.arena.pickups.length = 0;
    this.bombGeo.dispose();
    this.bombMat.dispose();
    this.haloMat.dispose();
    this.haloGeo.dispose();
    for (const r of this.rings.values()) this.scene.remove(r);
    this.rings.clear();
    this.ringGeo.dispose();
    for (const m of this.mats) m.dispose();
  }
}
