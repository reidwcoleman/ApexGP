// Bluebird Peak: the snowcats you see out at night. The sim decides where the grooming front is; each
// cat drives there with its lights on and its tiller combing the snow.
import * as THREE from 'three';
import { Mountain } from './mountain.ts';
import type { World } from './world.ts';
import type { Sim } from './sim.ts';
import { SNOWCAT_LOOK } from './data.ts';
abstract class Vehicle {
  group = new THREE.Group();
  p = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vy = 0;
  air = false;
  n = new THREE.Vector3(0, 1, 0);
  lights: THREE.SpotLight[] = [];
  constructor(protected w: World, protected m: Mountain, protected sim: Sim) { w.scene.add(this.group); }
  place(x: number, z: number, yaw: number) { this.p.set(x, this.m.ground(x, z), z); this.yaw = yaw; this.speed = 0; this.vy = 0; this.air = false; }
  setLights(on: number) { for (const l of this.lights) l.intensity = on; }
  /** keep the body on the snow, pitched and rolled with it */
  protected settle(dt: number, len: number, wid: number) {
    const m = this.m;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const hf = m.ground(this.p.x + fx * len, this.p.z + fz * len), hb = m.ground(this.p.x - fx * len, this.p.z - fz * len);
    const hl = m.ground(this.p.x - fz * wid, this.p.z + fx * wid), hr = m.ground(this.p.x + fz * wid, this.p.z - fx * wid);
    const pitch = Math.atan2(hf - hb, len * 2);
    const roll = Math.atan2(hl - hr, wid * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, this.yaw, 0, 'YXZ'));
    const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll);
    q.multiply(qr);
    this.group.quaternion.slerp(q, Math.min(1, dt * 10));
    this.group.position.copy(this.p);
    return pitch;
  }
}

export class Snowcat extends Vehicle {
  tiller = true;
  trackTex: THREE.CanvasTexture;
  blade: THREE.Object3D;
  tillerMesh: THREE.Object3D;
  beacon: THREE.Mesh;
  groomGain = 0;
  driving = false;
  lv = 1;
  private bodyMat: THREE.MeshStandardMaterial;

  constructor(w: World, m: Mountain, sim: Sim) {
    super(w, m, sim);
    this.group.scale.setScalar(1.6);
    const M = (c: number, r = 0.6, mt = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    this.bodyMat = M(0xd2453a, 0.45, 0.25);
    const g = this.group;
    const c = document.createElement('canvas'); c.width = 16; c.height = 64;
    const cx = c.getContext('2d')!; cx.fillStyle = '#1b1d20'; cx.fillRect(0, 0, 16, 64);
    for (let i = 0; i < 8; i++) { cx.fillStyle = '#3a3e44'; cx.fillRect(0, i * 8, 16, 3); }
    this.trackTex = new THREE.CanvasTexture(c);
    this.trackTex.wrapS = this.trackTex.wrapT = THREE.RepeatWrapping;
    this.trackTex.repeat.set(1, 4);
    const trackM = new THREE.MeshStandardMaterial({ map: this.trackTex, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 5.4), trackM);
      tr.position.set(s * 1.55, 0.55, 0);
      g.add(tr);
    }
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 5.0), this.bodyMat);
    chassis.position.set(0, 1.3, 0);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.4, 2.0), this.bodyMat);
    cab.position.set(0, 2.3, 0.6);
    const glassM = w.glow(new THREE.MeshStandardMaterial({ color: 0x1b2833, roughness: 0.1, metalness: 0.6, emissive: 0xffd09a, emissiveIntensity: 0.1 }), 0.25);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.8, 1.6), glassM);
    glass.position.set(0, 2.5, 0.75);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 2.1), M(0xf4f7fb));
    roof.position.set(0, 3.06, 0.6);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.5 }));
    bar.position.set(0, 3.2, 1.3);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xff9b1a, emissive: 0xff8a00, emissiveIntensity: 2 }));
    this.beacon.position.set(0.6, 3.25, 0.1);
    g.add(chassis, cab, glass, roof, bar, this.beacon);
    // blade
    const blade = (this.blade = new THREE.Group());
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.6, 12, 1, true, Math.PI * 0.5, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0xf2c46d, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
    bl.rotation.z = Math.PI / 2;
    blade.add(bl);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.4), M(0x2b3036));
    arms.position.set(0, 0.2, -0.7);
    blade.add(arms);
    blade.position.set(0, 0.75, 3.4);
    g.add(blade);
    // tiller + comb
    const til = (this.tillerMesh = new THREE.Group());
    const drum = new THREE.Mesh(new THREE.BoxGeometry(5, 0.7, 1.1), M(0x2b3036, 0.7));
    const comb = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.08, 0.9), M(0x111316, 0.9));
    comb.position.set(0, -0.36, -0.8);
    comb.rotation.x = 0.25;
    til.add(drum, comb);
    til.position.set(0, 0.5, -3.3);
    g.add(til);
    // headlights
    for (const s of [-0.6, 0.6]) {
      const sp = new THREE.SpotLight(0xfff4e0, 0, 90, 0.62, 0.5, 1.2);
      sp.position.set(s, 3.0, 1.6);
      sp.target.position.set(s * 2, 0, 22);
      g.add(sp, sp.target);
      this.lights.push(sp);
    }
    const rear = new THREE.SpotLight(0xffe6c4, 0, 30, 0.9, 0.6, 1.4);
    rear.position.set(0, 3.0, -0.5); rear.target.position.set(0, 0, -10);
    g.add(rear, rear.target);
    this.lights.push(rear);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  setLevel(lv: number) {
    this.lv = lv;
    const w = SNOWCAT_LOOK[lv].w;
    this.tillerMesh.scale.x = w / 5;
    this.blade.scale.x = (w * 0.85) / 4.6;
    this.bodyMat.color.setHex([0, 0xd2453a, 0xe0a63a, 0x2f7fe0, 0x23262b][lv]);
  }

  /** drive toward a point on the snow (the grooming front), or sit parked */
  pose(tx: number, tz: number, dt: number, t: number, working: boolean) {
    const dx = tx - this.p.x, dz = tz - this.p.z, d = Math.hypot(dx, dz);
    if (d > 60) { this.p.x = tx; this.p.z = tz; } // jumped to a new trail
    else if (d > 0.05) {
      const want = Math.atan2(dx, dz);
      let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 4);
      const step = Math.min(d, Math.max(2, d * 3) * dt);
      this.p.x += (dx / d) * step; this.p.z += (dz / d) * step;
      this.speed = step / Math.max(1e-4, dt);
    } else this.speed = 0;
    this.p.y = this.m.ground(this.p.x, this.p.z);
    this.settle(dt, 2.4, 1.6);
    this.trackTex.offset.y -= this.speed * dt * 0.18;
    this.driving = working;
    this.beacon.visible = !working || Math.sin(t * 9) > 0;
    (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = working ? 2.5 : 0.3;
    this.tillerMesh.position.y = working ? 0.42 : 0.9;
  }
}
