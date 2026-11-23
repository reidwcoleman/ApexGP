import * as THREE from 'three';
import type { Course } from './courses.ts';

/**
 * Mystery boxes. Run into one and you get a power-up for a few seconds:
 *   ZOOM        you run nearly half as fast again, with a streak of light behind you
 *   SUPER JUMP  you jump twice as high
 *   IRON BEAN   nothing knocks you over, and whoever you run into is bowled over
 * In a race they stand along the road (and come back a few seconds after they're taken); in the
 * arenas one pops up every few seconds where a bean was standing a moment ago. Like the stars,
 * each browser has its own boxes: yours are for your bean (and, on the host, the bots).
 */
export const POWERS = [
  { name: '', sub: '', color: 0xffffff, secs: 0 },
  { name: 'ZOOM!', sub: 'Run like the wind', color: 0x35d6ff, secs: 6 },
  { name: 'SUPER JUMP!', sub: 'Jump twice as high', color: 0x6dff5a, secs: 8 },
  { name: 'IRON BEAN!', sub: 'Nothing knocks you over: run into them', color: 0xffa51f, secs: 7 },
] as const;
export const BOX = { r: 1.55, every: 6.5, max: 3, life: 17, back: 8, gap: 52 };

function boxArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, '#ff2f8e');
  g.addColorStop(0.35, '#ffb400');
  g.addColorStop(0.7, '#12b4f0');
  g.addColorStop(1, '#7a3df0');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  x.lineWidth = 16;
  x.strokeStyle = '#ffffff';
  x.strokeRect(10, 10, 236, 236);
  x.fillStyle = '#ffffff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '900 190px "Lilita One", "Arial Black", sans-serif';
  x.lineWidth = 22;
  x.strokeStyle = '#2a0c52';
  x.strokeText('?', 128, 140);
  x.fillText('?', 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();

interface Spot {
  x: number;
  y: number;
  z: number;
  on: boolean;
  /** (a race's) when it's back; (an arena's) when it's gone */
  backAt: number;
  until: number;
  born: number;
}

export class Boxes {
  private mesh: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private spots: Spot[] = [];
  private trail: { x: number; y: number; z: number; t: number }[] = [];
  private nextT = 0;
  private noteT = 0;
  private roam: boolean;
  constructor(
    c: Course,
    private scene: THREE.Scene,
    /** a browser with one bean to its name (a guest): fewer boxes, further apart */
    private few = false,
  ) {
    this.roam = !c.path;
    if (c.path) {
      const path = c.path;
      const first = (c.checkpoints[0] ?? 40) + 26, end = c.finishS - 30;
      let k = 0;
      for (let s = first; s < end; s += BOX.gap) {
        const sec = path.sec[path.index(s)];
        if (!sec.floor || sec.w < 6 || c.gaps.some(([a, e]) => s + 5 > a && s - 5 < e)) continue;
        const lat = [-0.24, 0.24, 0][k++ % 3] * sec.w;
        const v = path.at(s, lat, 1.15);
        this.spots.push({ x: v.x, y: v.y, z: v.z, on: true, backAt: 0, until: Infinity, born: -9 });
      }
    }
    const tex = boxArt();
    const cap = Math.max(8, this.spots.length);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 1.15, 1.15), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.35 }), cap);
    this.glow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.05, 2), new THREE.MeshBasicMaterial({ color: 0xffd86a, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), cap);
    for (const m of [this.mesh, this.glow]) {
      m.frustumCulled = false;
      m.castShadow = false;
      m.count = 0;
      scene.add(m);
    }
  }
  dispose() {
    for (const m of [this.mesh, this.glow]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.MeshBasicMaterial).map?.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
  /** the arenas: every so often one pops up where a bean still in was standing a moment ago */
  feed(t: number, beans: { m: { pos: THREE.Vector3; active: boolean; groundT: number }; out: boolean; fell: number }[]) {
    if (!this.roam) {
      for (const s of this.spots) if (!s.on && t >= s.backAt) (s.on = true), (s.born = t);
      return;
    }
    if (t > this.noteT) {
      this.noteT = t + 0.6;
      const live = beans.filter((b) => !b.out && !b.fell && b.m.active && b.m.groundT < 0.08);
      const b = live[Math.floor(Math.random() * live.length)];
      if (b) this.trail.push({ x: b.m.pos.x, y: b.m.pos.y, z: b.m.pos.z, t });
      if (this.trail.length > 20) this.trail.shift();
      this.spots = this.spots.filter((s) => s.on && t < s.until);
    }
    if (!this.nextT) this.nextT = t + 3.5;
    if (t < this.nextT) return;
    this.nextT = t + BOX.every * (this.few ? 1.8 : 1) * (0.8 + Math.random() * 0.4);
    const old = this.trail.filter((q) => t - q.t > 1.6);
    const q = old[Math.floor(Math.random() * old.length)];
    if (!q || this.spots.length >= (this.few ? 2 : BOX.max)) return;
    if (this.spots.some((s) => (s.x - q.x) ** 2 + (s.z - q.z) ** 2 < 36)) return;
    this.spots.push({ x: q.x, y: q.y + 0.75, z: q.z, on: true, backAt: 0, until: t + BOX.life, born: t });
  }
  /** a bean's run into one: which power it gets (0: none here) */
  take(p: THREE.Vector3, t: number) {
    for (const s of this.spots) {
      if (!s.on) continue;
      const dx = p.x - s.x, dz = p.z - s.z, dy = p.y + 0.3 - s.y;
      if (dx * dx + dz * dz > BOX.r * BOX.r || Math.abs(dy) > 2) continue;
      s.on = false;
      s.backAt = t + BOX.back;
      V.set(s.x, s.y, s.z);
      return 1 + Math.floor(Math.random() * 3);
    }
    return 0;
  }
  /** where the last one taken was (for its burst) */
  get lastAt() {
    return V;
  }
  sync(t: number) {
    let i = 0;
    for (const s of this.spots) {
      if (!s.on || i >= this.mesh.instanceMatrix.count) continue;
      // (one that's about to go blinks; one that's just come pops in)
      if (s.until - t < 2.5 && Math.sin(t * 16) < -0.2) continue;
      const k = Math.min(1, (t - s.born) / 0.3);
      const bob = Math.sin(t * 2.4 + s.x) * 0.16;
      Q.setFromEuler(E.set(0.35, t * 1.7 + s.z, 0.2));
      V.set(s.x, s.y + bob, s.z);
      this.mesh.setMatrixAt(i, M.compose(V, Q, S.setScalar(k * (1 + Math.sin(t * 5 + s.x) * 0.04))));
      this.glow.setMatrixAt(i, M.compose(V, Q, S.setScalar(k * (1.25 + Math.sin(t * 3.3 + s.z) * 0.12))));
      i++;
    }
    this.mesh.count = this.glow.count = i;
    this.mesh.instanceMatrix.needsUpdate = this.glow.instanceMatrix.needsUpdate = true;
  }
}
