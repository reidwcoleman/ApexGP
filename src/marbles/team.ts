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

export class TeamPlay {
  private rings = new Map<number, THREE.Mesh>();
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
    const total = this.arena.n * this.arena.n;
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
    for (const r of this.rings.values()) this.scene.remove(r);
    this.rings.clear();
    this.ringGeo.dispose();
    for (const m of this.mats) m.dispose();
  }
}
