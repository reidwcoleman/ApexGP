import * as THREE from 'three';
import type { Course } from './courses.ts';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();

/**
 * Stars: trails of them along the risky lines of a race, arcs of them over every jump; in every
 * other round they pop up where the beans have just been. They're yours alone (each browser has
 * its own), they're kept all through a show, and enough of them is a revive (ghost.ts).
 */
export const STARS = { r: 1.45, max: 14, every: 1.5, life: 18 };

function starGeo() {
  const sh = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 2, r = k % 2 ? 0.14 : 0.33;
    if (k === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, steps: 1 });
  g.center();
  return g;
}

export class Stars {
  private mesh: THREE.InstancedMesh;
  private spots: { x: number; y: number; z: number; got: boolean; pop: number; until: number }[] = [];
  /** the rounds with no road: where beans stood a moment ago (a star's next spot) */
  private trail: { x: number; y: number; z: number; t: number }[] = [];
  private nextT = 0;
  private noteT = 0;
  private roam: boolean;
  constructor(
    c: Course,
    private scene: THREE.Scene,
    /** for a ghost: no stars laid along the road (it would fly the lot), only the ones that pop up */
    ghost = false,
  ) {
    this.roam = !c.path || ghost;
    if (!this.roam) this.lay(c);
    this.mesh = new THREE.InstancedMesh(starGeo(), new THREE.MeshPhysicalMaterial({ color: 0xffd84a, roughness: 0.3, metalness: 0.1, emissive: 0xffb820, emissiveIntensity: 0.75, clearcoat: 1 }), Math.max(STARS.max + 6, this.spots.length));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  private lay(c: Course) {
    const path = c.path!;
    const add = (v: THREE.Vector3) => this.spots.push({ x: v.x, y: v.y, z: v.z, got: false, pop: 0, until: Infinity });
    for (const v of c.b.starSpots) add(v);
    // lines of them near the open edges, where it's a risk to go
    let side = 1;
    const first = (c.checkpoints[0] ?? 40) + 14, end = c.finishS - 18;
    for (let s = first; s < end; s += 27) {
      let ok = true;
      for (let q = 0; q <= 10 && ok; q += 2) {
        const sec = path.sec[path.index(s + q)];
        ok = sec.floor && sec.w > 8;
      }
      if (!ok || c.gaps.some(([a, e]) => s + 12 > a && s - 2 < e)) continue;
      const w = path.sec[path.index(s)].w;
      for (let q = 0; q < 5; q++) add(path.at(s + q * 2.4, side * (w / 2 - 1.8), 1));
      side = -side;
    }
    // and an arc over every jump
    for (const [a, e] of c.gaps) {
      if (e - a < 2.5 || e - a > 14) continue;
      for (let q = 1; q < 6; q++) {
        const k = q / 6;
        add(path.at(a + (e - a) * k, 0, 1.4 + Math.sin(k * Math.PI) * 1.6));
      }
    }
  }
  /**
   * The rounds with no road: every so often a star pops up where one of the beans still in was
   * standing a moment ago (so it's always somewhere a bean can get to), and is gone in a while.
   */
  feed(t: number, beans: { m: { pos: THREE.Vector3; active: boolean; groundT: number }; out: boolean; fell: number }[], air = false, life = STARS.life) {
    if (!this.roam) return;
    if (t > this.noteT) {
      this.noteT = t + 0.45;
      const live = beans.filter((b) => !b.out && !b.fell && b.m.active && (air || b.m.groundT < 0.08));
      const b = live[Math.floor(Math.random() * live.length)];
      if (b) this.trail.push({ x: b.m.pos.x, y: b.m.pos.y, z: b.m.pos.z, t });
      if (this.trail.length > 24) this.trail.shift();
      this.spots = this.spots.filter((s) => (s.got ? t - s.pop < 0.4 : t < s.until));
    }
    if (t < this.nextT) return;
    this.nextT = t + STARS.every;
    const old = this.trail.filter((q) => t - q.t > 1.3);
    const q = old[Math.floor(Math.random() * old.length)];
    if (!q || this.spots.filter((s) => !s.got).length >= STARS.max) return;
    // (not on top of another one)
    if (this.spots.some((s) => !s.got && (s.x - q.x) ** 2 + (s.z - q.z) ** 2 < 9)) return;
    this.spots.push({ x: q.x, y: q.y + 0.55, z: q.z, got: false, pop: t, until: t + life });
  }
  /** the star nearest a spot that's still there (a ghost flies at it) */
  near(p: THREE.Vector3, max = Infinity) {
    let best = null, bd = max * max;
    for (const s of this.spots) {
      if (s.got) continue;
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
  /** the stars a bean (or a ghost) has just picked up */
  take(m: { pos: THREE.Vector3 }, t: number, reach = STARS.r) {
    let n = 0;
    for (const s of this.spots) {
      if (s.got) continue;
      const dx = m.pos.x - s.x, dy = m.pos.y + 0.2 - s.y, dz = m.pos.z - s.z;
      if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > 1.9) continue;
      s.got = true;
      s.pop = t;
      n++;
    }
    return n;
  }
  sync(t: number) {
    let i = 0;
    for (const s of this.spots) {
      const q = s.got ? (t - s.pop) / 0.28 : -1;
      // (taken: it swells and is gone)
      if (q >= 1 || i >= this.mesh.instanceMatrix.count) continue;
      // (one that's popped up grows in, and blinks before it goes)
      const fresh = this.roam && !s.got ? Math.min(1, (t - s.pop) / 0.3) : 1;
      if (this.roam && !s.got && s.until - t < 2.5 && Math.sin(t * 16) < -0.2) continue;
      const k = q < 0 ? (1 + Math.sin(t * 3 + i) * 0.06) * fresh * (this.roam ? 1.25 : 1) : 1.5 * (1 - q);
      Q.setFromEuler(E.set(0, t * 2.4 + i * 0.7, 0));
      V.set(s.x, s.y + Math.sin(t * 2.2 + i) * 0.1 + (q > 0 ? q * 0.9 : 0), s.z);
      this.mesh.setMatrixAt(i++, M.compose(V, Q, S.setScalar(k)));
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
