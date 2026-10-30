import * as THREE from 'three';

/**
 * Effects: stuffing that flies out of a plush when it gets hit (soft white tufts with gravity and
 * drag), bright impact flashes, dust puffs, splashes and confetti. One instanced mesh per kind.
 */

interface P {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  s: number;
  spin: number;
  rot: number;
  c: THREE.Color;
  g: number;
  drag: number;
}

class Pool {
  mesh: THREE.InstancedMesh;
  ps: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private sv = new THREE.Vector3();
  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
  }
  add(p: P) {
    if (this.ps.length >= this.cap) this.ps.shift();
    this.ps.push(p);
  }
  update(dt: number, grow: boolean) {
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.ps.splice(i, 1);
        continue;
      }
      p.v.y -= p.g * dt;
      p.v.multiplyScalar(Math.exp(-p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      p.rot += p.spin * dt;
    }
    for (const p of this.ps) {
      const k = p.life / p.max;
      const s = p.s * (grow ? Math.min(1, (1 - k) * 6) * (0.4 + 0.6 * k) : Math.min(1, k * 3));
      this.q.setFromEuler(this.e.set(p.rot, p.rot * 0.7, p.rot * 0.3));
      this.m.compose(p.p, this.q, this.sv.set(s, s, s));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Fx {
  private fluff: Pool;
  private flash: Pool;
  private dust: Pool;
  private conf: Pool;
  private drops: Pool;
  constructor(scene: THREE.Scene) {
    const tuft = new THREE.IcosahedronGeometry(0.06, 1);
    const pa = tuft.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const k = 0.75 + Math.random() * 0.5;
      pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k, pa.getZ(i) * k);
    }
    tuft.computeVertexNormals();
    this.fluff = new Pool(scene, tuft, new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1, envMapIntensity: 0.4 }), 260);
    this.flash = new Pool(scene, new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 40);
    this.dust = new Pool(scene, new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }), 200);
    this.conf = new Pool(scene, new THREE.PlaneGeometry(0.08, 0.05), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), 500);
    this.drops = new Pool(scene, new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.8 }), 300);
  }

  /** a hit: a flash and a puff of stuffing in the hit fighter's colour-tinted white */
  hit(at: THREE.Vector3, dir: THREE.Vector3, power: number, color: number) {
    const n = Math.min(9, 2 + Math.round(power / 3.5));
    const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.82);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5 + 0.5, (Math.random() - 0.5) * 3).addScaledVector(dir, 2 + Math.random() * 2);
      this.fluff.add({ p: at.clone(), v, life: 0.9 + Math.random() * 0.7, max: 1.6, s: 0.5 + Math.random() * 0.7, spin: (Math.random() - 0.5) * 8, rot: Math.random() * 6, c: tint.clone(), g: 2.2, drag: 2.4 });
    }
    this.flash.add({ p: at.clone(), v: new THREE.Vector3(), life: 0.12, max: 0.12, s: 1 + power / 12, spin: 0, rot: 0, c: new THREE.Color(0.9, 0.85, 0.7), g: 0, drag: 0 });
  }

  dustAt(at: THREE.Vector3, n = 6, color = 0xd8ccb8) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 1.4, 0.4 + Math.random() * 0.6, Math.sin(a) * 1.4);
      this.dust.add({ p: at.clone().add(new THREE.Vector3(0, 0.05, 0)), v, life: 0.6 + Math.random() * 0.4, max: 1, s: 0.8 + Math.random() * 0.8, spin: 1, rot: Math.random() * 6, c: c.clone(), g: -0.4, drag: 3 });
    }
  }

  splash(at: THREE.Vector3, n = 26) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const v = new THREE.Vector3(Math.cos(a) * r * 3, 3 + Math.random() * 4, Math.sin(a) * r * 3);
      this.drops.add({ p: at.clone(), v, life: 0.9 + Math.random() * 0.5, max: 1.4, s: 0.6 + Math.random() * 1.2, spin: 0, rot: 0, c: new THREE.Color(0xd8f4ff), g: 13, drag: 0.4 });
    }
  }

  confetti(at: THREE.Vector3, n = 120) {
    const cols = [0xff4f6d, 0xffd23a, 0x37c25a, 0x3b8cff, 0xb36bff, 0xff8a1f, 0xffffff];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 4), 6 + Math.random() * 6, Math.sin(a) * (1 + Math.random() * 4));
      this.conf.add({ p: at.clone(), v, life: 3 + Math.random() * 2, max: 5, s: 1 + Math.random(), spin: (Math.random() - 0.5) * 14, rot: Math.random() * 6, c: new THREE.Color(cols[i % cols.length]), g: 5, drag: 1.6 });
    }
  }

  update(dt: number) {
    this.fluff.update(dt, true);
    this.flash.update(dt, false);
    this.dust.update(dt, true);
    this.conf.update(dt, false);
    this.drops.update(dt, false);
  }
}
