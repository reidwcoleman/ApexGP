import * as THREE from 'three';

/** confetti: paper flakes that flutter down (a burst at the line for every qualifier) */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private life: Float32Array;
  private head = 0;
  private readonly N = 1600;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  private pos = new THREE.Vector3();
  constructor() {
    const g = new THREE.PlaneGeometry(0.16, 0.24);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(g, mat, this.N);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(this.N * 3);
    this.v = new Float32Array(this.N * 3);
    this.r = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    const pal = [0xff3a4a, 0xffd23a, 0x2f9bff, 0x37c25a, 0xff5fa8, 0xff8a1f, 0x8a4bff, 0xffffff];
    const c = new THREE.Color();
    for (let i = 0; i < this.N; i++) {
      this.mesh.setColorAt(i, c.set(pal[i % pal.length]));
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }
  burst(at: THREE.Vector3, n: number, up = 9, spread = 5) {
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.N;
      this.p[i * 3] = at.x + (Math.random() - 0.5) * 2;
      this.p[i * 3 + 1] = at.y + Math.random();
      this.p[i * 3 + 2] = at.z + (Math.random() - 0.5) * 2;
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.v[i * 3] = Math.cos(a) * r;
      this.v[i * 3 + 1] = up * (0.6 + Math.random() * 0.6);
      this.v[i * 3 + 2] = Math.sin(a) * r;
      this.r[i * 3] = Math.random() * 6;
      this.r[i * 3 + 1] = Math.random() * 6;
      this.r[i * 3 + 2] = Math.random() * 6;
      this.life[i] = 4 + Math.random() * 2;
    }
  }
  update(dt: number, t: number) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      // paper: falls slowly, drifts, flutters
      this.v[o + 1] -= 9 * dt;
      const drag = Math.min(1, dt * 2.8);
      this.v[o] *= 1 - drag;
      this.v[o + 2] *= 1 - drag;
      if (this.v[o + 1] < -2.2) this.v[o + 1] += (-2.2 - this.v[o + 1]) * Math.min(1, dt * 6);
      this.p[o] += (this.v[o] + Math.sin(t * 3 + i) * 0.6) * dt;
      this.p[o + 1] += this.v[o + 1] * dt;
      this.p[o + 2] += (this.v[o + 2] + Math.cos(t * 2.6 + i) * 0.6) * dt;
      this.e.set(this.r[o] + t * 5, this.r[o + 1] + t * 3, this.r[o + 2]);
      this.q.setFromEuler(this.e);
      const k = Math.min(1, this.life[i]);
      this.s.setScalar(k);
      this.m.compose(this.pos.set(this.p[o], this.p[o + 1], this.p[o + 2]), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
      }
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    this.life.fill(0);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < this.N; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** a gloop of paint where a marble lands in the lake: droplets and a spreading ring */
export class Splashes {
  readonly group = new THREE.Group();
  private drops: THREE.InstancedMesh;
  private dp = new Float32Array(600 * 3);
  private dv = new Float32Array(600 * 3);
  private dl = new Float32Array(600);
  private head = 0;
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private m = new THREE.Matrix4();
  y = 0;
  constructor() {
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xff5fa2, roughness: 0.1, clearcoat: 1 });
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), mat, 600);
    this.drops.frustumCulled = false;
    const pal = [0xff5fa2, 0x3dd0dc, 0xffd84f, 0xfff4ea];
    const c = new THREE.Color();
    for (let i = 0; i < 600; i++) {
      this.drops.setColorAt(i, c.set(pal[i % 4]));
      this.m.makeScale(0, 0, 0);
      this.drops.setMatrixAt(i, this.m);
    }
    this.group.add(this.drops);
  }
  splash(x: number, z: number) {
    for (let k = 0; k < 36; k++) {
      const i = this.head;
      this.head = (this.head + 1) % 600;
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 4;
      this.dp.set([x, this.y + 0.2, z], i * 3);
      this.dv.set([Math.cos(a) * r, 5 + Math.random() * 9, Math.sin(a) * r], i * 3);
      this.dl[i] = 2;
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 8, 40).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xfff0f6, roughness: 0.1, clearcoat: 1, transparent: true }));
    ring.position.set(x, this.y + 0.05, z);
    this.group.add(ring);
    this.rings.push({ mesh: ring, t: 0 });
  }
  update(dt: number) {
    const s = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
    let any = false;
    for (let i = 0; i < 600; i++) {
      if (this.dl[i] <= 0) continue;
      any = true;
      this.dl[i] -= dt;
      const o = i * 3;
      this.dv[o + 1] -= 24 * dt;
      this.dp[o] += this.dv[o] * dt;
      this.dp[o + 1] += this.dv[o + 1] * dt;
      this.dp[o + 2] += this.dv[o + 2] * dt;
      const alive = this.dl[i] > 0 && this.dp[o + 1] > this.y - 0.3;
      if (!alive) this.dl[i] = 0;
      s.setScalar(alive ? 1 : 0);
      this.m.compose(p.set(this.dp[o], this.dp[o + 1], this.dp[o + 2]), q, s);
      this.drops.setMatrixAt(i, this.m);
    }
    if (any) this.drops.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / 1.6;
      r.mesh.scale.setScalar(1 + k * 6);
      (r.mesh.material as THREE.MeshPhysicalMaterial).opacity = Math.max(0, 1 - k);
    }
    const dead = this.rings.filter((r) => r.t > 1.6);
    for (const r of dead) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
    }
    this.rings = this.rings.filter((r) => r.t <= 1.6);
  }
}
