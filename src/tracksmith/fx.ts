import * as THREE from 'three';
import type { CarView } from './car.ts';
import type { Sim } from './sim.ts';

/** a small pool of flat-shaded particles: tyre smoke, landing dust, gate bursts, confetti */
interface P { m: THREE.Mesh; v: THREE.Vector3; life: number; max: number; spin: THREE.Vector3; grow: number; fade: boolean }

export class Fx {
  private pool: P[] = [];
  private live: P[] = [];
  private geo = new THREE.IcosahedronGeometry(0.5, 0);
  private box = new THREE.BoxGeometry(0.35, 0.05, 0.2);
  private group = new THREE.Group();
  private skidT = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  private spawn(geo: THREE.BufferGeometry, color: number, opacity: number, lit = true): P {
    let p = this.pool.find((x) => x.m.geometry === geo && (x.m.material as THREE.Material).userData.lit === lit);
    if (p) this.pool.splice(this.pool.indexOf(p), 1);
    else {
      // smoke and dust are unlit (a lit puff shows a dark side and reads as a rock); bursts and confetti are lit
      const m = lit ? new THREE.MeshStandardMaterial({ flatShading: true, transparent: true, roughness: 1, depthWrite: false }) : new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      m.userData.lit = lit;
      p = { m: new THREE.Mesh(geo, m), v: new THREE.Vector3(), life: 0, max: 1, spin: new THREE.Vector3(), grow: 0, fade: true };
      this.group.add(p.m);
    }
    const mat = p.m.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = opacity;
    mat.userData.o = opacity;
    p.m.visible = true;
    p.m.scale.setScalar(1);
    this.live.push(p);
    return p;
  }

  burst(at: THREE.Vector3, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const p = this.spawn(this.geo, color, 0.9);
      p.m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2));
      p.v.set((Math.random() - 0.5) * 9, Math.random() * 7, (Math.random() - 0.5) * 9);
      p.life = 0; p.max = 0.5 + Math.random() * 0.4; p.grow = -1.2; p.fade = true;
      p.m.scale.setScalar(0.3 + Math.random() * 0.3);
      p.spin.set(Math.random() * 6, Math.random() * 6, 0);
    }
  }

  dust(at: THREE.Vector3, k: number) {
    for (let i = 0; i < 10 * k + 2; i++) {
      const p = this.spawn(this.geo, 0xf3ebde, 0.4, false);
      const a = Math.random() * Math.PI * 2;
      p.m.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 1.4, -0.4, Math.sin(a) * 1.4));
      p.v.set(Math.cos(a) * 4, 1 + Math.random() * 1.5, Math.sin(a) * 4);
      p.life = 0; p.max = 0.7 + Math.random() * 0.5; p.grow = 2.2; p.fade = true;
      p.m.scale.setScalar(0.5);
    }
  }

  confetti(at: THREE.Vector3) {
    const cols = [0xff4d3d, 0xffd23a, 0x2f7bff, 0x24c26b, 0xff5fb0, 0xffffff];
    for (let i = 0; i < 90; i++) {
      const p = this.spawn(this.box, cols[i % cols.length], 1);
      p.m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 3, (Math.random() - 0.5) * 8));
      p.v.set((Math.random() - 0.5) * 6, 3 + Math.random() * 6, (Math.random() - 0.5) * 6);
      p.life = 0; p.max = 2.2 + Math.random(); p.grow = 0; p.fade = false;
      p.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
    }
  }

  update(dt: number, car: CarView, sim: Sim, slip: number) {
    // tyre smoke while sliding
    this.skidT -= dt;
    if (slip > 0.5 && sim.speed > 6 && this.skidT <= 0) {
      this.skidT = 0.03;
      for (let i = 2; i < 4; i++) {
        if (!sim.wheels[i].hit) continue;
        const w = car.wheels[i];
        const wp = w.getWorldPosition(new THREE.Vector3());
        const p = this.spawn(this.geo, 0xf4f2ee, 0.22 * Math.min(1, slip), false);
        p.m.position.copy(wp).add(new THREE.Vector3(0, -0.15, 0));
        p.v.set((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5);
        p.life = 0; p.max = 0.7; p.grow = 2.4; p.fade = true;
        p.m.scale.setScalar(0.32);
      }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      if (p.life >= p.max) {
        p.m.visible = false;
        this.live.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.v.y -= (p.fade ? 3 : 7) * dt;
      if (!p.fade) p.v.multiplyScalar(1 - 1.6 * dt);
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.spin.x * dt;
      p.m.rotation.y += p.spin.y * dt;
      p.m.rotation.z += p.spin.z * dt;
      if (p.grow) p.m.scale.multiplyScalar(Math.max(0.2, 1 + p.grow * dt));
      const mat = p.m.material as THREE.MeshBasicMaterial;
      const k = p.life / p.max;
      mat.opacity = (mat.userData.o as number) * (p.fade ? 1 - k : k > 0.8 ? (1 - k) * 5 : 1);
    }
  }

  clear() {
    for (const p of this.live) { p.m.visible = false; this.pool.push(p); }
    this.live = [];
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.material) (m.material as THREE.Material).dispose(); });
    this.geo.dispose();
    this.box.dispose();
  }
}
