import * as THREE from 'three';

/**
 * The show's effects: confetti for every qualifier, and gloops of paint where a marble lands in
 * the lake. Both are pools of instances: nothing is made or thrown away while they play.
 */

// the sun through thin stuff: paper lit from behind glows in its own colour
const TRANSLUCENT = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
  {
    float back = max(dot(-normal, directionalLights[0].direction), 0.0);
    totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * back * 0.22;
  }
#endif
`;

const PAPER = [0xff3a4a, 0xffd23a, 0x2f9bff, 0x37c25a, 0xff5fa8, 0xff8a1f, 0x8a4bff, 0x2fd6c8, 0xfff4e6];
const FOIL = [0xffd27a, 0xe8eef8, 0xff9ac8, 0x9fd8ff];

/** a flake of paper (or foil), a little curled so it catches the light along its bend */
function flake(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, 2, 4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h;
    p.setZ(i, y * y * h * 0.35);
  }
  g.computeVertexNormals();
  return g;
}

/** confetti: paper flakes that flutter down, with foil among them that flashes in the sun */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private foil: THREE.InstancedMesh;
  private p: Float32Array;
  private v: Float32Array;
  /** spin axis (body frame) and rate, and a fixed tilt */
  private ax: Float32Array;
  private w: Float32Array;
  private tilt: THREE.Quaternion[];
  private life: Float32Array;
  private head = 0;
  private readonly N = 1600;
  /** every fourth flake is foil (drawn by the foil mesh) */
  private readonly F = 4;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private a = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private pos = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor() {
    const paper = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
    paper.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + TRANSLUCENT);
    };
    paper.customProgramCacheKey = () => 'mm-paper-1';
    const nFoil = this.N / this.F;
    this.mesh = new THREE.InstancedMesh(flake(0.16, 0.24), paper, this.N - nFoil);
    this.mesh.frustumCulled = false;
    const foilM = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.22, metalness: 1 });
    this.foil = new THREE.InstancedMesh(flake(0.14, 0.14), foilM, nFoil);
    this.foil.frustumCulled = false;
    this.mesh.add(this.foil);
    this.p = new Float32Array(this.N * 3);
    this.v = new Float32Array(this.N * 3);
    this.ax = new Float32Array(this.N * 3);
    this.w = new Float32Array(this.N);
    this.life = new Float32Array(this.N);
    this.tilt = [];
    const c = new THREE.Color();
    for (let i = 0; i < this.N; i++) {
      this.tilt.push(new THREE.Quaternion());
      const [mesh, j] = this.slot(i);
      mesh.setColorAt(j, c.set(mesh === this.foil ? FOIL[j % FOIL.length] : PAPER[j % PAPER.length]));
      mesh.setMatrixAt(j, this.zero);
    }
  }
  /** which mesh and instance draws flake i */
  private slot(i: number): [THREE.InstancedMesh, number] {
    return i % this.F === 0 ? [this.foil, i / this.F] : [this.mesh, i - Math.floor(i / this.F) - 1];
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
      // (a flake twirls about an axis near its length, at its own pace)
      const ta = Math.random() * Math.PI * 2;
      this.ax[i * 3] = Math.cos(ta) * 0.35;
      this.ax[i * 3 + 1] = 1;
      this.ax[i * 3 + 2] = Math.sin(ta) * 0.35;
      this.w[i] = (4 + Math.random() * 7) * (Math.random() < 0.5 ? -1 : 1);
      this.tilt[i].setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
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
      const [mesh, j] = this.slot(i);
      // paper: falls slowly (slowest lying flat), drifts, flutters
      this.q.setFromAxisAngle(this.a.set(this.ax[o], this.ax[o + 1], this.ax[o + 2]).normalize(), t * this.w[i] + i);
      this.q.premultiply(this.tilt[i]);
      const flat = Math.abs(this.a.set(0, 0, 1).applyQuaternion(this.q).y);
      const term = -(1.1 + 1.6 * (1 - flat));
      this.v[o + 1] -= 9 * dt;
      const drag = Math.min(1, dt * 2.8);
      this.v[o] *= 1 - drag;
      this.v[o + 2] *= 1 - drag;
      if (this.v[o + 1] < term) this.v[o + 1] += (term - this.v[o + 1]) * Math.min(1, dt * 6);
      this.p[o] += (this.v[o] + Math.sin(t * 2.4 + i) * 0.7 * flat) * dt;
      this.p[o + 1] += this.v[o + 1] * dt;
      this.p[o + 2] += (this.v[o + 2] + Math.cos(t * 2.1 + i * 1.3) * 0.7 * flat) * dt;
      this.s.setScalar(Math.min(1, this.life[i] * 1.5));
      this.m.compose(this.pos.set(this.p[o], this.p[o + 1], this.p[o + 2]), this.q, this.s);
      mesh.setMatrixAt(j, this.life[i] <= 0 ? this.zero : this.m);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.foil.instanceMatrix.needsUpdate = true;
    }
  }
  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.N; i++) {
      const [mesh, j] = this.slot(i);
      mesh.setMatrixAt(j, this.zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.foil.instanceMatrix.needsUpdate = true;
  }
}

/** the lake's paints (linear), so a splash is the stuff it came out of */
const LAKE = [
  [0.98, 0.33, 0.62],
  [0.24, 0.8, 0.86],
  [1.0, 0.84, 0.32],
  [0.98, 0.95, 0.92],
].map(([r, g, b]) => new THREE.Color(r, g, b));

/** thick glossy paint: enamel-smooth, with a little depth to its colour */
function paintGloss(color = 0xffffff) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.4, sheenRoughness: 0.3, sheenColor: 0xffffff });
}

interface Gloop {
  crown: THREE.Mesh;
  jet: THREE.Mesh;
  blob: THREE.Mesh;
  ring: THREE.Mesh;
  t: number;
  /** how long it plays (s) */
  T: number;
}

/**
 * A gloop of paint where a marble lands in the lake: a crown of paint thrown up round the hole
 * and falling back, a jet that rises from the middle and drops its bead, a ripple rolling out,
 * and droplets — heavy, stretched by their speed — that plop back in.
 */
export class Splashes {
  readonly group = new THREE.Group();
  private drops: THREE.InstancedMesh;
  private readonly ND = 600;
  private dp = new Float32Array(600 * 3);
  private dv = new Float32Array(600 * 3);
  private dl = new Float32Array(600);
  private ds = new Float32Array(600);
  private head = 0;
  private gloops: Gloop[] = [];
  private gHead = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sv = new THREE.Vector3();
  private pv = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private upV = new THREE.Vector3(0, 1, 0);
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  y = 0;
  constructor() {
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), paintGloss(), this.ND);
    this.drops.frustumCulled = false;
    for (let i = 0; i < this.ND; i++) {
      this.drops.setColorAt(i, LAKE[i % 4]);
      this.drops.setMatrixAt(i, this.zero);
    }
    this.group.add(this.drops);
    // the crown: a thin sheet thrown up and flaring out like a tulip, thinning to a lip that breaks
    // into points (each point flings a bead)
    const prof: THREE.Vector2[] = [];
    for (let k = 0; k <= 14; k++) {
      const u = k / 14;
      prof.push(new THREE.Vector2(1 + 0.75 * u ** 1.7, u));
    }
    for (let k = 14; k >= 0; k--) {
      const u = k / 14;
      prof.push(new THREE.Vector2(1 + 0.75 * u ** 1.7 - (0.2 * (1 - u) + 0.025), u * 0.985));
    }
    const crownG = new THREE.LatheGeometry(prof, 72);
    const cp = crownG.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const a = Math.atan2(z, x);
      const spike = Math.max(0, Math.sin(a * 9)) ** 4 * y * y;
      const r = Math.hypot(x, z), k = 1 + spike * 0.12;
      cp.setXYZ(i, (x / r) * r * k, y * (1 + 0.45 * spike), (z / r) * r * k);
    }
    crownG.computeVertexNormals();
    const jetG = new THREE.CapsuleGeometry(0.3, 0.8, 6, 16).translate(0, 0.7, 0);
    const blobG = new THREE.SphereGeometry(0.34, 18, 12);
    const ringG = new THREE.TorusGeometry(1, 0.16, 10, 48).rotateX(Math.PI / 2);
    for (let k = 0; k < 6; k++) {
      const mat = paintGloss();
      const g: Gloop = { crown: new THREE.Mesh(crownG, mat), jet: new THREE.Mesh(jetG, mat), blob: new THREE.Mesh(blobG, mat), ring: new THREE.Mesh(ringG, mat), t: 99, T: 1.8 };
      for (const o of [g.crown, g.jet, g.blob, g.ring]) {
        o.visible = false;
        this.group.add(o);
      }
      this.gloops.push(g);
    }
  }
  splash(x: number, z: number) {
    const ci = Math.floor(Math.random() * 4);
    const c = LAKE[ci];
    for (let k = 0; k < 36; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.ND;
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 4;
      this.dp.set([x + Math.cos(a) * 0.8, this.y + 0.3, z + Math.sin(a) * 0.8], i * 3);
      this.dv.set([Math.cos(a) * r, 5 + Math.random() * 9, Math.sin(a) * r], i * 3);
      this.dl[i] = 2.4;
      this.ds[i] = 0.09 + Math.random() ** 2 * 0.2;
      // (mostly the paint it came from, a few of the paint beside it)
      this.drops.setColorAt(i, Math.random() < 0.75 ? c : LAKE[(ci + 1 + Math.floor(Math.random() * 3)) % 4]);
    }
    if (this.drops.instanceColor) this.drops.instanceColor.needsUpdate = true;
    // a bead flung from each point of the crown
    for (let k = 0; k < 9; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.ND;
      const a = ((k + 0.25) / 9) * Math.PI * 2 + this.gloops[this.gHead].crown.rotation.y * 0;
      this.dp.set([x + Math.cos(a) * 1.4, this.y + 0.6, z + Math.sin(a) * 1.4], i * 3);
      this.dv.set([Math.cos(a) * 3.2, 8 + Math.random() * 3, Math.sin(a) * 3.2], i * 3);
      this.dl[i] = 2.4;
      this.ds[i] = 0.12 + Math.random() * 0.06;
      this.drops.setColorAt(i, c);
    }
    const g = this.gloops[this.gHead];
    this.gHead = (this.gHead + 1) % this.gloops.length;
    g.t = 0;
    g.T = 1.6 + Math.random() * 0.3;
    (g.crown.material as THREE.MeshPhysicalMaterial).color.copy(c);
    for (const o of [g.crown, g.jet, g.blob, g.ring]) {
      o.position.set(x, this.y, z);
      o.visible = true;
    }
    g.crown.rotation.y = 0;
  }
  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.ND; i++) {
      if (this.dl[i] <= 0) continue;
      any = true;
      this.dl[i] -= dt;
      const o = i * 3;
      this.dv[o + 1] -= 24 * dt;
      this.dp[o] += this.dv[o] * dt;
      this.dp[o + 1] += this.dv[o + 1] * dt;
      this.dp[o + 2] += this.dv[o + 2] * dt;
      const alive = this.dl[i] > 0 && this.dp[o + 1] > this.y - 0.3;
      if (!alive) {
        this.dl[i] = 0;
        this.drops.setMatrixAt(i, this.zero);
        continue;
      }
      // a heavy drop, drawn out along its flight (more the faster it goes), rounder as it slows
      const vx = this.dv[o], vy = this.dv[o + 1], vz = this.dv[o + 2];
      const sp = Math.hypot(vx, vy, vz);
      const st = 1 + Math.min(1.6, sp * 0.07);
      this.dir.set(vx, vy, vz).divideScalar(Math.max(sp, 1e-4));
      this.q.setFromUnitVectors(this.upV, this.dir);
      const r = this.ds[i] * Math.min(1, this.dl[i] * 3);
      this.sv.set(r / Math.sqrt(st), r * st, r / Math.sqrt(st));
      this.m.compose(this.pv.set(this.dp[o], this.dp[o + 1], this.dp[o + 2]), this.q, this.sv);
      this.drops.setMatrixAt(i, this.m);
    }
    if (any) this.drops.instanceMatrix.needsUpdate = true;
    for (const g of this.gloops) {
      if (g.t > g.T) continue;
      g.t += dt;
      const k = Math.min(1, g.t / g.T);
      // the crown: thrown up fast, opening out, then slumping back below the surface
      const ck = Math.min(1, k * 1.8);
      const rise = Math.sin(ck * Math.PI) * (1 - ck * 0.3);
      const open = 0.75 + 1.3 * (1 - (1 - ck) ** 2);
      g.crown.scale.set(open, Math.max(0.001, rise * 1.15), open);
      g.crown.position.y = this.y - 0.06 - Math.max(0, ck - 0.6) * 0.6;
      g.crown.visible = ck < 1;
      // the jet: up from the middle once the crown has gone back, dropping its bead
      const jk = THREE.MathUtils.clamp((k - 0.3) / 0.5, 0, 1);
      const jh = Math.sin(jk * Math.PI);
      g.jet.scale.set(1 - jh * 0.2, Math.max(0.001, jh * 1.35), 1 - jh * 0.2);
      g.jet.position.y = this.y - 0.4;
      g.jet.visible = jk > 0 && jk < 1;
      const bk = THREE.MathUtils.clamp((k - 0.45) / 0.5, 0, 1);
      g.blob.visible = bk > 0 && bk < 1;
      g.blob.position.y = this.y + 0.1 + 2.6 * Math.sin(Math.min(1, bk * 1.25) * Math.PI);
      g.blob.scale.setScalar(0.7 + 0.5 * Math.sin(bk * Math.PI));
      // the ripple rolls out and sinks back into the paint
      g.ring.scale.setScalar(1 + k * 5.5);
      g.ring.scale.y = 1 - k * 0.6;
      g.ring.position.y = this.y + 0.04 - k * k * 0.35;
      if (g.t > g.T) for (const o of [g.crown, g.jet, g.blob, g.ring]) o.visible = false;
    }
  }
}

/**
 * Little soft puffs of dust where a bean lands hard, kicks off a dive or skids, and a burst of
 * spinning stars when one is knocked flat. One instanced mesh each, a fixed pool.
 */
/** a ring of light racing out along the ground (a blast, a big landing) */
export class Rings {
  readonly group = new THREE.Group();
  private R: { m: THREE.Mesh; t: number; max: number; r: number }[] = [];
  private geo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  ring(at: THREE.Vector3, r: number, color: number, life = 0.45) {
    let o = this.R.find((x) => x.t <= 0);
    if (!o) {
      if (this.R.length >= 10) return;
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      o = { m: new THREE.Mesh(this.geo, mat), t: 0, max: 1, r: 1 };
      this.group.add(o.m);
      this.R.push(o);
    }
    o.t = o.max = life;
    o.r = r;
    o.m.position.copy(at);
    o.m.position.y += 0.08;
    (o.m.material as THREE.MeshBasicMaterial).color.set(color);
    o.m.visible = true;
  }
  update(dt: number) {
    for (const o of this.R) {
      if (o.t <= 0) continue;
      o.t -= dt;
      const k = 1 - Math.max(0, o.t) / o.max;
      o.m.scale.setScalar(0.3 + o.r * (1 - (1 - k) * (1 - k)));
      (o.m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (o.t <= 0) o.m.visible = false;
    }
  }
}

export class Puffs {
  readonly group = new THREE.Group();
  private puff: THREE.InstancedMesh;
  private star: THREE.InstancedMesh;
  private P: { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; s: number; spin: number; star: boolean }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private sc = new THREE.Vector3();
  private static N = 360;
  constructor() {
    const pm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.8, depthWrite: false });
    this.puff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), pm, Puffs.N);
    const sh = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2, r = k % 2 ? 0.42 : 1;
      if (k) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    sg.center();
    this.star = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffb000, emissiveIntensity: 0.6, roughness: 0.35 }), 120);
    for (const im of [this.puff, this.star]) {
      im.count = 0;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }
  /** a ring of dust at a bean's feet */
  dust(at: THREE.Vector3, n: number, size = 0.22, speed = 2.2) {
    for (let k = 0; k < n && this.P.length < Puffs.N; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.6;
      const v = new THREE.Vector3(Math.cos(a) * speed * (0.6 + Math.random() * 0.6), 0.5 + Math.random() * 0.9, Math.sin(a) * speed * (0.6 + Math.random() * 0.6));
      const life = 0.45 + Math.random() * 0.3;
      this.P.push({ p: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.25, 0.08, Math.sin(a) * 0.25)), v, life, max: life, s: size * (0.7 + Math.random() * 0.6), spin: 0, star: false });
    }
  }
  /** knocked flat: stars fly out round the head */
  stars(at: THREE.Vector3) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const life = 0.8 + Math.random() * 0.3;
      this.P.push({ p: at.clone().add(new THREE.Vector3(0, 1.2, 0)), v: new THREE.Vector3(Math.cos(a) * 2.6, 3 + Math.random() * 1.5, Math.sin(a) * 2.6), life, max: life, s: 0.13, spin: (Math.random() - 0.5) * 14, star: true });
    }
  }
  update(dt: number) {
    let np = 0, ns = 0;
    for (let i = this.P.length - 1; i >= 0; i--) {
      const o = this.P[i];
      o.life -= dt;
      if (o.life <= 0) {
        this.P.splice(i, 1);
        continue;
      }
      const k = o.life / o.max;
      if (o.star) o.v.y -= 9 * dt;
      else o.v.multiplyScalar(1 - Math.min(1, dt * 4));
      o.p.addScaledVector(o.v, dt);
      if (o.star) {
        if (ns >= 120) continue;
        this.q.setFromEuler(this.e.set(0, o.spin * o.life, o.spin * 0.3 * o.life));
        const s = o.s * Math.min(1, k * 3);
        this.m.compose(o.p, this.q, this.sc.set(s, s, s));
        this.star.setMatrixAt(ns++, this.m);
      } else {
        // (a puff swells as it fades)
        const s = o.s * (1.6 - k * 0.9) * Math.min(1, k * 4);
        this.m.compose(o.p, this.q.identity(), this.sc.set(s, s * 0.8, s));
        this.puff.setMatrixAt(np++, this.m);
      }
    }
    this.puff.count = np;
    this.star.count = ns;
    this.puff.instanceMatrix.needsUpdate = true;
    this.star.instanceMatrix.needsUpdate = true;
  }
  clear() {
    this.P.length = 0;
  }
}

/**
 * Fireworks: shells that climb, burst into a shell of sparks and fade as they fall. One draw for all
 * of them; the sparks are brighter than white so the bloom catches them.
 */
export class Fireworks {
  readonly points: THREE.Points;
  private readonly N = 1800;
  private p: Float32Array;
  private c: Float32Array;
  private v: Float32Array;
  private rgb: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private head = 0;
  private shells: { x: number; y: number; z: number; vy: number; top: number; wait: number; color: number; big: number }[] = [];
  /** a shell has just burst: the game plays the boom */
  onBurst: (x: number, y: number, z: number) => void = () => {};
  constructor() {
    const n = this.N;
    this.p = new Float32Array(n * 3).fill(1e6);
    this.c = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.rgb = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.9, map: new THREE.CanvasTexture(cv), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
    this.points.frustumCulled = false;
    this.points.visible = false;
  }
  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, col: THREE.Color, life: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.N;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.rgb.set([col.r, col.g, col.b], i * 3);
    this.life[i] = this.max[i] = life;
  }
  private burst(x: number, y: number, z: number, color: number, big: number) {
    const c = new THREE.Color(color), w = new THREE.Color(0xffffff);
    const n = Math.round(110 * big), sp = 15 * big;
    for (let k = 0; k < n; k++) {
      // (evenly over a sphere, in two shells so it reads as a flower)
      const u = (k + 0.5) / n, ph = Math.acos(1 - 2 * u), th = k * 2.39996;
      const r = sp * (k % 3 === 0 ? 0.62 : 1) * (0.92 + Math.random() * 0.16);
      this.spark(x, y, z, Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r, k % 3 === 0 ? w : c, 1.1 + Math.random() * 0.7);
    }
    this.onBurst(x, y, z);
  }
  /** `n` shells from below `at`, spread over `spread` metres, a beat apart */
  show(at: THREE.Vector3, n = 5, spread = 40, height = 34, gap = 0.28) {
    const pal = [0xffc21f, 0xff3a6a, 0x3ac8ff, 0x7a5aff, 0x37e07a, 0xffffff];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, d = spread * (0.35 + Math.random() * 0.65);
      const top = at.y + height * (0.8 + Math.random() * 0.5);
      this.shells.push({ x: at.x + Math.cos(a) * d, y: at.y - 6, z: at.z + Math.sin(a) * d, vy: 38, top, wait: k * gap + Math.random() * 0.1, color: pal[(Math.random() * pal.length) | 0], big: 0.9 + Math.random() * 0.6 });
    }
    this.points.visible = true;
  }
  update(dt: number) {
    const gold = FW_GOLD;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (s.wait > 0) {
        s.wait -= dt;
        continue;
      }
      s.y += s.vy * dt;
      this.spark(s.x, s.y, s.z, (Math.random() - 0.5) * 2, -3, (Math.random() - 0.5) * 2, gold, 0.4);
      if (s.y >= s.top) {
        this.burst(s.x, s.y, s.z, s.color, s.big);
        this.shells.splice(i, 1);
      }
    }
    if (!this.points.visible) return;
    let live = this.shells.length;
    const drag = Math.exp(-dt * 1.7);
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.p[j] = 1e6;
        this.c[j] = this.c[j + 1] = this.c[j + 2] = 0;
        continue;
      }
      live++;
      this.v[j] *= drag;
      this.v[j + 1] = this.v[j + 1] * drag - 7 * dt;
      this.v[j + 2] *= drag;
      this.p[j] += this.v[j] * dt;
      this.p[j + 1] += this.v[j + 1] * dt;
      this.p[j + 2] += this.v[j + 2] * dt;
      // (it twinkles as it dies)
      const k = this.life[i] / this.max[i];
      const b = 3.4 * k * k * (k < 0.4 ? 0.55 + 0.45 * Math.sin(this.life[i] * 40 + i) : 1);
      this.c[j] = this.rgb[j] * b;
      this.c[j + 1] = this.rgb[j + 1] * b;
      this.c[j + 2] = this.rgb[j + 2] * b;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    if (!live) this.points.visible = false;
  }
  clear() {
    this.shells.length = 0;
    this.life.fill(0);
    this.p.fill(1e6);
    this.c.fill(0);
    this.points.visible = false;
  }
}
const FW_GOLD = new THREE.Color(0xffc860);
