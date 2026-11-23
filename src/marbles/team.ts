import * as THREE from 'three';
import type { Course } from './courses.ts';
import { SPOTS, TEAM_COLORS, TEAM_NAMES, type TeamArena } from './course-paintparty.ts';
import { Mode, type Marble } from './physics.ts';
import type { Sound } from './audio.ts';

/**
 * The team rounds' rules, as every browser runs them. A coloured ring at each bean's feet says
 * whose side it's on; a bean that falls comes back at its team's base.
 *
 *  Paint Party, Splat Ring: each bean on the ground paints the floor under it its team's colour,
 *    and paint bombs drop in to be set off. The least floor goes home.
 *  Spot Hogs: three glowing spots. The team with the most beans on their feet in one owns it, and
 *    it pays them a point a second. The spots move. The fewest points goes home.
 *
 * (Online every browser works it out from the beans it sees; the host's count decides.)
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
  label?: string;
}

/** a paint bomb lying on the floor: run into it and it splats your colour all round you */
interface Pickup {
  k: number;
  pos: THREE.Vector3;
  obj: THREE.Object3D;
  born: number;
}
/** the k-th paint bomb drops at GO + FIRST + k·EVERY, and lies there until it's taken or LIFE runs out */
const BOMBS = { first: 3, every: 2.8, life: 12 };
const SPLAT_R = 4.4;

/** one of Spot Hogs' spots: the disc, its rim and the light standing on it */
interface Spot {
  site: number;
  owner: number;
  disc: THREE.Mesh;
  rim: THREE.Mesh;
  beam: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
  col: THREE.Color;
}

export class TeamPlay {
  private rings = new Map<number, THREE.Mesh>();
  private bombs: Pickup[] = [];
  private nextK = 0;
  private gone = new Set<number>();
  private bombGeo: THREE.BufferGeometry;
  private bombMat: THREE.MeshPhysicalMaterial;
  private haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, toneMapped: false });
  private haloGeo = new THREE.TorusGeometry(0.75, 0.06, 8, 40).rotateX(Math.PI / 2);
  private ringGeo = new THREE.TorusGeometry(0.62, 0.07, 8, 32).rotateX(Math.PI / 2);
  private mats: THREE.MeshBasicMaterial[];
  private blipT = 0;
  private spots: Spot[] = [];
  private spotPeriod = -1;
  readonly arena: TeamArena;
  readonly game;

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
    private sound: Sound,
  ) {
    this.arena = course.team!;
    this.game = this.arena.game;
    this.arena.points.fill(0);
    this.arena.zones.length = 0;
    this.mats = TEAM_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, toneMapped: false }));
    // the bomb: a glossy ball in swirls of every team's colour, a white cap and a fuse
    const g = new THREE.SphereGeometry(0.6, 32, 20).toNonIndexed();
    const p = g.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    const C = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      if (y > 0.47) C.set(0xffffff);
      else C.set(TEAM_COLORS[Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 6 + y * 3 + 6) % 3]);
      for (let k = 0; k < 3; k++) C.toArray(col, (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    this.bombGeo = g;
    this.bombMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.08 });
    if (this.game === 'spots') this.makeSpots();
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
    if (!(go < 1e8) || this.game !== 'paint') return out;
    const S = BOMBS;
    while (go + S.first + this.nextK * S.every <= t) {
      const k = this.nextK++;
      const born = go + S.first + k * S.every;
      if (this.gone.has(k) || t - born > S.life) continue;
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
      if (age > S.life) {
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

  // ---------------------------------------------------------------------------------- Spot Hogs
  private makeSpots() {
    const A = this.arena, R = SPOTS.r;
    const discG = new THREE.CircleGeometry(R, 56).rotateX(-Math.PI / 2);
    const rimG = new THREE.TorusGeometry(R, 0.13, 10, 72).rotateX(Math.PI / 2);
    const beamG = new THREE.CylinderGeometry(R * 0.96, R, 7, 48, 1, true).translate(0, 3.5, 0);
    for (let k = 0; k < SPOTS.n; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false });
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
      const disc = new THREE.Mesh(discG, mat), rim = new THREE.Mesh(rimG, mat), beam = new THREE.Mesh(beamG, beamMat);
      disc.renderOrder = 1;
      rim.renderOrder = 1;
      beam.renderOrder = 3;
      disc.visible = rim.visible = beam.visible = false;
      this.scene.add(disc, rim, beam);
      this.spots.push({ site: -1, owner: -1, disc, rim, beam, mat, beamMat, col: new THREE.Color(0xffffff) });
      A.zones.push({ x: A.center.x, z: A.center.z, r: R, owner: -1, going: false });
    }
  }

  /** which three of the nine places the spots are in, for a stretch of the round (the same in every browser) */
  private spotSites(period: number, seed: number): number[] {
    const n = this.arena.sites.length;
    let h = (period * 2246822519 + seed * 3266489917 + 101) >>> 0;
    const rnd = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    // (never where one has just been)
    const last = period > 0 ? this.spotSites(period - 1, seed) : [];
    const pool = Array.from({ length: n }, (_, i) => i).filter((i) => !last.includes(i));
    const out: number[] = [];
    while (out.length < SPOTS.n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  }

  /**
   * Spot Hogs, this frame: the spots where the clock says, whose each one is (the most beans on
   * their feet in it; level is nobody's), and a point a second to the owner. Says when they move
   * and when your team takes or loses one.
   */
  spotsUpdate(t: number, go: number, seed: number, dt: number, scoring: boolean) {
    const ev = { moved: false, warn: false, took: 0, lost: 0 };
    if (this.game !== 'spots' || !(go < 1e8)) return ev;
    const A = this.arena, x = Math.max(0, t - go);
    const period = Math.floor(x / SPOTS.every), into = x - period * SPOTS.every;
    const going = into > SPOTS.every - SPOTS.warn;
    if (period !== this.spotPeriod) {
      ev.moved = this.spotPeriod >= 0;
      this.spotPeriod = period;
      const at = this.spotSites(period, seed);
      this.spots.forEach((s, k) => {
        s.site = at[k] ?? k;
        s.owner = -1;
        const p = A.sites[s.site];
        for (const o of [s.disc, s.rim, s.beam]) o.position.set(p.x, A.center.y + 0.05, p.z);
        s.rim.position.y = A.center.y + 0.1;
      });
      this.warned = false;
    }
    if (going && !this.warned) {
      this.warned = true;
      ev.warn = true;
    }
    const me = this.who().find((r) => r.c.player);
    const mine = me ? this.teamOf(me.c.id) : -1;
    const n = [0, 0, 0];
    this.spots.forEach((s, k) => {
      const p = A.sites[s.site];
      n[0] = n[1] = n[2] = 0;
      for (const r of this.who()) {
        const m = r.m;
        if (r.out || r.fell || !m.active || m.mode === Mode.Tumble) continue;
        if (Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < SPOTS.r && m.pos.y - A.center.y < 2.6) n[this.teamOf(r.c.id)]++;
      }
      let owner = -1, top = 0;
      for (let q = 0; q < A.teams; q++) {
        if (n[q] > top) (top = n[q]), (owner = q);
        else if (n[q] === top) owner = -1;
      }
      if (owner !== s.owner) {
        if (owner === mine && mine >= 0) ev.took++;
        else if (s.owner === mine && mine >= 0) ev.lost++;
        s.owner = owner;
      }
      if (owner >= 0 && scoring) A.points[owner] += dt;
      // its colour: the owner's, white for nobody's; it blinks before it moves
      const want = owner >= 0 ? TMP.set(TEAM_COLORS[owner]) : TMP.set(0xffffff);
      s.col.lerp(want, Math.min(1, dt * 9));
      s.mat.color.copy(s.col).multiplyScalar(owner >= 0 ? 1.25 : 1);
      s.beamMat.color.copy(s.col);
      const blink = going ? 0.45 + 0.55 * Math.abs(Math.sin(t * 9)) : 1;
      s.mat.opacity = (owner >= 0 ? 0.55 : 0.34) * blink + 0.06 * Math.sin(t * 4 + k);
      s.beamMat.opacity = (owner >= 0 ? 0.16 : 0.08) * blink;
      s.rim.scale.setScalar(1 + 0.025 * Math.sin(t * 5 + k * 2));
      s.disc.visible = s.rim.visible = s.beam.visible = true;
      const z = A.zones[k];
      z.x = p.x;
      z.z = p.z;
      z.owner = owner;
      z.going = going;
    });
    return ev;
  }
  private warned = false;

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

  /** where each bean last painted (a stroke joins it to where it is now) */
  private last = new Map<number, { x: number; z: number }>();
  /**
   * Paint: every bean on its feet leaves a trail of its team's colour as it runs (a stroke from
   * where it last painted, so a fast run is a solid stripe); a belly slide smears a wider one, and
   * coming down from a jump splats a blob.
   */
  paint() {
    if (this.game !== 'paint') return;
    const now = performance.now();
    const A = this.arena;
    for (const r of this.who()) {
      const m = r.m;
      const id = r.c.id;
      const onFloor = m.pos.y - A.center.y < 0.9;
      if (r.out || r.fell || !m.active || m.groundT > 0.12 || !onFloor) {
        this.last.delete(id);
        continue;
      }
      const team = this.teamOf(id);
      const L = this.last.get(id);
      const wide = m.mode === Mode.Dive ? 1.35 : m.mode === Mode.Tumble ? 1.1 : 0.95;
      let did = L && Math.hypot(m.pos.x - L.x, m.pos.z - L.z) < 3 ? A.stroke(L.x, L.z, m.pos.x, m.pos.z, team, wide) : A.paint(m.pos.x, m.pos.z, team, wide);
      if (m.landed > 5) did = A.splat(m.pos.x, m.pos.z, 1.2 + Math.min(1, (m.landed - 5) / 6) * 0.8, team) > 0 || did;
      if (L) (L.x = m.pos.x), (L.z = m.pos.z);
      else this.last.set(id, { x: m.pos.x, z: m.pos.z });
      if (did && r.c.player && now - this.blipT > 90) {
        this.blipT = now;
        this.sound.notes([72 + Math.floor(Math.random() * 3) * 2], 0, 0.05, true);
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
    const mine = this.mine();
    if (this.game !== 'paint') {
      const top = Math.max(12, ...c);
      return c.map((n, k) => ({ name: TEAM_NAMES[k], color: TEAM_COLORS[k], share: n / top, mine: mine?.name === TEAM_NAMES[k], label: String(Math.floor(n)) }));
    }
    const total = this.arena.total;
    return c.map((n, k) => ({ name: TEAM_NAMES[k], color: TEAM_COLORS[k], share: n / total, mine: mine?.name === TEAM_NAMES[k] }));
  }

  /** the team with the least (floor, or points; a tie: the first of them) */
  loser() {
    const c = this.arena.counts();
    let lo = 0;
    for (let k = 1; k < c.length; k++) if (c[k] < c[lo]) lo = k;
    return lo;
  }

  /** what the host tells everyone, once a second: its floor, or its points */
  packet() {
    return this.game === 'paint' ? this.arena.save() : `p:${this.arena.points.map((v) => v.toFixed(1)).join(',')}`;
  }
  heard(c: string) {
    if (!c.startsWith('p:')) return this.arena.load(c);
    c.slice(2).split(',').forEach((v, k) => {
      const n = Number(v);
      if (k < 3 && n >= 0) this.arena.points[k] = n;
    });
  }

  dispose() {
    for (const b of this.bombs) this.scene.remove(b.obj);
    this.bombs.length = 0;
    this.arena.pickups.length = 0;
    this.arena.zones.length = 0;
    this.bombGeo.dispose();
    this.bombMat.dispose();
    this.haloMat.dispose();
    this.haloGeo.dispose();
    for (const r of this.rings.values()) this.scene.remove(r);
    this.rings.clear();
    this.ringGeo.dispose();
    for (const m of this.mats) m.dispose();
    this.spots.forEach((s, k) => {
      this.scene.remove(s.disc, s.rim, s.beam);
      s.mat.dispose();
      s.beamMat.dispose();
      if (!k) for (const o of [s.disc, s.rim, s.beam]) o.geometry.dispose();
    });
    this.spots.length = 0;
  }
}

const TMP = new THREE.Color();
