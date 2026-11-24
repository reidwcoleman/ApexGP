import * as THREE from 'three';

/**
 * Light at night that reaches everything: the baked city gets its lamps in its own shader, but the
 * people, the cars and the props don't. A small pool of real point lights follows the camera, each
 * borrowing the position of one of the nearest street lamps (warm) or neon signs (their own colour,
 * saturated: the pink and cyan that wash over the sidewalk and the faces on Ocean Drive).
 */
export interface Spot {
  p: THREE.Vector3;
  c: THREE.Color;
  /** candela-ish */
  i: number;
  /** reach (m) */
  r: number;
}

export class NightLights {
  readonly lights: THREE.PointLight[] = [];
  readonly spots: Spot[] = [];
  private acc = 1;

  constructor(scene: THREE.Scene, n = 8) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.castShadow = false;
      l.visible = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  /** neon: every mesh drawn with the neon material, one spot per sign (its centre, its average colour) */
  addNeon(root: THREE.Object3D, name = 'od_neon') {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m.material as THREE.Material).name !== name) return;
      const g = m.geometry;
      const col = g.getAttribute('color');
      const pos = g.getAttribute('position');
      // a sign is one connected stretch of letters: cluster by position (5 m)
      const cl: { s: THREE.Vector3; c: THREE.Color; n: number }[] = [];
      const v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        let k = cl.find((q) => q.s.clone().divideScalar(q.n).distanceTo(v) < 5);
        if (!k) cl.push((k = { s: new THREE.Vector3(), c: new THREE.Color(0, 0, 0), n: 0 }));
        k.s.add(v);
        if (col) k.c.add(new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)));
        else k.c.add(new THREE.Color(1, 0.3, 0.8));
        k.n++;
      }
      for (const q of cl) {
        const c = q.c.multiplyScalar(1 / q.n);
        // saturate: neon light reads as pure colour
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2 + 0.1), 0.5);
        this.spots.push({ p: q.s.divideScalar(q.n), c, i: 9, r: 13 });
      }
      void box;
    });
  }

  addLamps(list: THREE.Vector4[], warm = new THREE.Color(1.0, 0.72, 0.45)) {
    for (const l of list) if (l.w >= 100) this.spots.push({ p: new THREE.Vector3(l.x, l.y, l.z), c: warm.clone(), i: 34, r: 22 });
  }

  /** k: how dark it is (0 day .. 1 night) */
  update(dt: number, eye: THREE.Vector3, k: number) {
    const on = k > 0.05;
    for (const l of this.lights) l.visible = on;
    if (!on) return;
    this.acc += dt;
    if (this.acc < 0.2) {
      for (const l of this.lights) l.intensity = (l.userData.i as number) * k;
      return;
    }
    this.acc = 0;
    // the nearest spots ahead of the camera count double
    const scored = this.spots
      .map((s) => ({ s, d: s.p.distanceToSquared(eye) }))
      .filter((q) => q.d < 70 * 70)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lights.length);
    this.lights.forEach((l, i) => {
      const q = scored[i];
      if (!q) {
        l.userData.i = 0;
        l.intensity = 0;
        return;
      }
      l.position.copy(q.s.p);
      l.color.copy(q.s.c);
      l.distance = q.s.r;
      l.userData.i = q.s.i;
      l.intensity = q.s.i * k;
    });
  }
}
