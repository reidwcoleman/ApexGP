import * as THREE from 'three';

/**
 * A windy day you can see: leaves and bits of dry grass carried across the circuit on the wind,
 * tumbling and fluttering, gusting in waves. One instanced mesh of small double-sided leaf shapes
 * in a box round the camera; a leaf that leaves the box downwind comes back in upwind. How many
 * fly scales with the wind's strength (none in a light breeze) and stops once the ground is wet.
 */

const N = 1500;
/** the box round the camera the leaves live in (half extents, m) */
const BX = 34, BY = 9, BZ = 34;

function leafGeometry(): THREE.BufferGeometry {
  // a pointed leaf, slightly cupped (two triangles each side of the midrib)
  const L = 0.1, W = 0.05, C = 0.012;
  const p = [0, 0, -L, -W, C, 0, 0, 0, L * 0.9, 0, 0, -L, 0, 0, L * 0.9, W, C, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

export class WindLeaves {
  readonly mesh: THREE.InstancedMesh;
  private p = new Float32Array(N * 3);
  private v = new Float32Array(N * 3);
  private r = new Float32Array(N * 3);
  private w = new Float32Array(N * 3);
  private ph = new Float32Array(N);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly t = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly s0 = new THREE.Vector3(1e-4, 1e-4, 1e-4);
  private time = 0;
  private seeded = false;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(leafGeometry(), mat, N);
    this.mesh.name = 'wind_leaves';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const pal = [0x5b6b2a, 0x7a7330, 0x8a6a2c, 0x9a5a26, 0x6b4a24, 0xa88a4a, 0x4e5e26, 0xb39a5c].map((h) => new THREE.Color(h));
    for (let i = 0; i < N; i++) {
      this.mesh.setColorAt(i, pal[i % pal.length]);
      this.ph[i] = Math.random() * 100;
      this.w.set([(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 9], i * 3);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.mesh.count = 0;
  }

  private respawn(i: number, cam: THREE.Vector3, wx: number, wz: number, anywhere: boolean, ground: (x: number, z: number) => number) {
    const o = i * 3;
    let x: number, z: number;
    if (anywhere) {
      x = cam.x + (Math.random() * 2 - 1) * BX;
      z = cam.z + (Math.random() * 2 - 1) * BZ;
    } else {
      // on the upwind face of the box
      const sp = Math.hypot(wx, wz) || 1;
      const ux = wx / sp, uz = wz / sp;
      const across = (Math.random() * 2 - 1) * BX;
      x = cam.x - ux * BX * 0.98 - uz * across;
      z = cam.z - uz * BZ * 0.98 + ux * across;
    }
    const g = ground(x, z);
    this.p.set([x, g + 0.2 + Math.pow(Math.random(), 1.8) * BY * 1.6, z], o);
    this.v.set([wx, 0, wz], o);
    this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], o);
  }

  /**
   * `amount` 0..1 (how many fly), wind in m/s (world), the camera, the ground height; dt in s
   */
  update(dt: number, amount: number, wx: number, wz: number, cam: THREE.Vector3, ground: (x: number, z: number) => number) {
    const n = Math.round(N * Math.max(0, Math.min(1, amount)));
    if (n === 0) {
      this.mesh.count = 0;
      this.seeded = false;
      return;
    }
    if (!this.seeded) {
      for (let i = 0; i < N; i++) this.respawn(i, cam, wx, wz, true, ground);
      this.seeded = true;
    }
    this.time += dt;
    const T = this.time;
    const P = this.p, V = this.v, R = this.r, W = this.w;
    // gusts sweep through in waves; leaves follow the air with a lag, flutter and lift in eddies
    const k = 1 - Math.exp(-1.8 * dt);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const gust = 0.75 + 0.45 * Math.sin(T * 0.9 + P[o] * 0.05 + P[o + 2] * 0.04);
      const tx = wx * gust + Math.sin(T * 2.3 + this.ph[i]) * 1.2;
      const tz = wz * gust + Math.cos(T * 1.9 + this.ph[i] * 1.3) * 1.2;
      const ty = -0.9 + Math.sin(T * 3.1 + this.ph[i] * 2.1) * 1.4 + 0.12 * Math.hypot(wx, wz) * Math.max(0, Math.sin(T * 0.7 + this.ph[i]));
      V[o] += (tx - V[o]) * k;
      V[o + 1] += (ty - V[o + 1]) * k;
      V[o + 2] += (tz - V[o + 2]) * k;
      P[o] += V[o] * dt;
      P[o + 1] += V[o + 1] * dt;
      P[o + 2] += V[o + 2] * dt;
      R[o] += W[o] * dt;
      R[o + 1] += W[o + 1] * dt;
      R[o + 2] += W[o + 2] * dt;
      const g = ground(P[o], P[o + 2]);
      // on the ground: skitter along a moment, then off again with the next gust (or recycled)
      if (P[o + 1] < g + 0.02) {
        P[o + 1] = g + 0.02;
        V[o + 1] = Math.abs(V[o + 1]) * 0.6 + 0.8;
      }
      // (the box wraps round the camera: a leaf that drops out of one side comes in at the other, so a
      // car at 300 km/h keeps driving into fresh leaves)
      const dx = P[o] - cam.x, dz = P[o + 2] - cam.z;
      if (Math.abs(dx) > BX || Math.abs(dz) > BZ) {
        if (dx > BX) P[o] -= 2 * BX;
        else if (dx < -BX) P[o] += 2 * BX;
        if (dz > BZ) P[o + 2] -= 2 * BZ;
        else if (dz < -BZ) P[o + 2] += 2 * BZ;
        P[o + 1] = ground(P[o], P[o + 2]) + 0.2 + Math.pow(Math.random(), 1.8) * BY * 1.6;
      } else if (P[o + 1] > g + BY * 2) this.respawn(i, cam, wx, wz, true, ground);
      this.q.setFromEuler(this.e.set(R[o], R[o + 1], R[o + 2]));
      this.t.set(P[o], P[o + 1], P[o + 2]);
      // (none right on the lens)
      const near = this.t.distanceToSquared(cam) < 0.35;
      this.m.compose(this.t, this.q, near ? this.s0 : this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
