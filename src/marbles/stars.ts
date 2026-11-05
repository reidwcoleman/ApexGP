import * as THREE from 'three';
import type { Course } from './courses.ts';
import type { Marble } from './physics.ts';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();

/**
 * Stars: trails of them along the risky lines of a race, arcs of them over every jump. They're yours
 * alone (each browser has its own): a little something for taking the risky line.
 */
export const STARS = { r: 1.45 };

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
  private spots: { x: number; y: number; z: number; got: boolean; pop: number }[] = [];
  constructor(
    c: Course,
    private scene: THREE.Scene,
  ) {
    const path = c.path!;
    const add = (v: THREE.Vector3) => this.spots.push({ x: v.x, y: v.y, z: v.z, got: false, pop: 0 });
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
    this.mesh = new THREE.InstancedMesh(starGeo(), new THREE.MeshPhysicalMaterial({ color: 0xffd84a, roughness: 0.3, metalness: 0.1, emissive: 0xffb820, emissiveIntensity: 0.75, clearcoat: 1 }), Math.max(1, this.spots.length));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }
  /** the stars a bean has just picked up */
  take(m: Marble, t: number) {
    let n = 0;
    for (const s of this.spots) {
      if (s.got) continue;
      const dx = m.pos.x - s.x, dy = m.pos.y + 0.2 - s.y, dz = m.pos.z - s.z;
      if (dx * dx + dz * dz > STARS.r * STARS.r || Math.abs(dy) > 1.9) continue;
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
      if (q >= 1) continue;
      const k = q < 0 ? 1 + Math.sin(t * 3 + i) * 0.06 : 1.5 * (1 - q);
      Q.setFromEuler(E.set(0, t * 2.4 + i * 0.7, 0));
      V.set(s.x, s.y + Math.sin(t * 2.2 + i) * 0.1 + (q > 0 ? q * 0.9 : 0), s.z);
      this.mesh.setMatrixAt(i++, M.compose(V, Q, S.setScalar(k)));
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
