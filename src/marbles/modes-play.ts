import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';

/**
 * The game side of Rocket Rumble, and the book every points game keeps. Each browser runs its own beans
 * (fires them, drains them, fills their tanks); the host keeps the book.
 */

export interface Who {
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

/** a rocket's flame, white at the nozzle out to nothing at the tip */
function flameArt() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,240,190,0)');
  g.addColorStop(0.3, 'rgba(255,120,30,0.5)');
  g.addColorStop(0.72, 'rgba(255,190,60,0.95)');
  g.addColorStop(1, 'rgba(255,255,235,1)');
  x.fillStyle = g;
  x.fillRect(0, 0, 8, 128);
  return new THREE.CanvasTexture(c);
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
  private spot: THREE.Mesh;
  readonly arena;
  private go: () => number;
  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.rocket!;
    this.go = () => course.state.go;
    const g = new THREE.CapsuleGeometry(0.17, 0.5, 6, 14);
    this.pack = new THREE.InstancedMesh(g, new THREE.MeshPhysicalMaterial({ color: 0xff5a3a, roughness: 0.3, clearcoat: 1 }), 48);
    const fg = new THREE.ConeGeometry(0.2, 1.7, 12, 6, true).rotateX(Math.PI).translate(0, -0.85, 0);
    this.flame = new THREE.InstancedMesh(fg, new THREE.MeshBasicMaterial({ map: flameArt(), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 48);
    this.pack.frustumCulled = this.flame.frustumCulled = false;
    this.pack.castShadow = true;
    // the ring on whatever's under you: green if there's something to land on, red if there's only the sea
    this.spot = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.spot.visible = false;
    scene.add(this.pack, this.flame, this.spot);
  }
  dispose() {
    this.scene.remove(this.pack, this.flame, this.spot);
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
      if (n >= 47) break;
      E.set(0, m.yaw, 0);
      Q.setFromEuler(E);
      // (someone else's bean: it's on the way up with nothing under it, so it must be burning)
      const on = r.local ? A.burning.has(m.id) : m.groundT > 0.15 && m.vel.y > 0.5;
      const sx = Math.cos(m.yaw), sz = -Math.sin(m.yaw);
      for (const side of [-1, 1]) {
        // (two tanks on its back, clear of the body)
        P.set(-Math.sin(m.yaw) * 0.68 + sx * side * 0.24, 0.72, -Math.cos(m.yaw) * 0.68 + sz * side * 0.24).add(m.pos);
        this.pack.setMatrixAt(n++, M.compose(P, Q, S.setScalar(1)));
        if (on) {
          P.y -= 0.42;
          this.flame.setMatrixAt(f++, M.compose(P, Q, S.set(1, 0.85 + Math.sin(t * 50 + m.id + side) * 0.3, 1)));
        }
      }
    }
    // the ring under you
    const me = this.who().find((r) => r.c.player);
    this.spot.visible = false;
    if (me && !me.out && me.m.active && me.m.groundT > 0.12) {
      const x = Math.max(0, t - this.go()), mx = me.m.pos.x, mz = me.m.pos.z;
      let top = -Infinity;
      for (const q of A.pads) {
        const y = A.padY(q, x);
        if (y === null || y > me.m.pos.y) continue;
        if (Math.hypot(A.center.x + q.x - mx, A.center.z + q.z - mz) < q.r && y > top) top = y;
      }
      const mat = this.spot.material as THREE.MeshBasicMaterial;
      const low = top === -Infinity;
      mat.color.set(low ? 0xff4030 : 0x5aff8a);
      this.spot.position.set(mx, low ? A.center.y - 2 : top + 0.06, mz);
      this.spot.scale.setScalar(low ? 1.5 + Math.sin(t * 9) * 0.25 : 1.2);
      this.spot.visible = true;
    }
    this.pack.count = n;
    this.flame.count = f;
    this.pack.instanceMatrix.needsUpdate = this.flame.instanceMatrix.needsUpdate = true;
  }
}
