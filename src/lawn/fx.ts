/** Particles: grass clippings, petals, sparkles, confetti, puffs; and the lawn's own ambient life. */
import * as THREE from 'three';
import type { Theme } from './levels.ts';
import { Rng } from './util.ts';
import { glowTexture } from './gfx.ts';

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  sx: number; sy: number; sz: number;
  life: number; max: number;
  size: number; sw: number; sh: number;
  grav: number; drag: number; flutter: number;
  grow: number;
  r: number; g: number; b: number;
  landed: boolean;
}

export interface Emit {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life?: number;
  size?: number;
  sw?: number; sh?: number;
  color?: THREE.ColorRepresentation;
  grav?: number;
  drag?: number;
  spin?: number;
  flutter?: number;
  /** 1 = swell as it fades (smoke) */
  grow?: number;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly ps: P[] = [];
  private alive = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(readonly cap: number, geo: THREE.BufferGeometry, mat: THREE.Material, private billboard: boolean) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    for (let i = 0; i < cap; i++) {
      this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, life: 0, max: 1, size: 1, sw: 1, sh: 1, grav: 9, drag: 0.5, flutter: 0, grow: 0, r: 1, g: 1, b: 1, landed: false });
    }
  }

  emit(o: Emit) {
    if (this.alive >= this.cap) return;
    const p = this.ps[this.alive++];
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.rx = Math.random() * 6.28; p.ry = Math.random() * 6.28; p.rz = Math.random() * 6.28;
    const sp = o.spin ?? 8;
    p.sx = (Math.random() - 0.5) * sp; p.sy = (Math.random() - 0.5) * sp; p.sz = (Math.random() - 0.5) * sp;
    p.max = p.life = o.life ?? 1;
    p.size = o.size ?? 0.08;
    p.sw = o.sw ?? 1; p.sh = o.sh ?? 1;
    p.grav = o.grav ?? 9;
    p.drag = o.drag ?? 0.5;
    p.flutter = o.flutter ?? 0;
    p.grow = o.grow ?? 0;
    this.c.set(o.color ?? '#7bdc4e');
    p.r = this.c.r; p.g = this.c.g; p.b = this.c.b;
    p.landed = false;
  }

  update(dt: number, camQ: THREE.Quaternion, groundY: number) {
    for (let i = this.alive - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        const last = this.ps[this.alive - 1];
        this.ps[i] = last;
        this.ps[this.alive - 1] = p;
        this.alive--;
        continue;
      }
      if (!p.landed) {
        p.vy -= p.grav * dt;
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vz *= d;
        if (p.flutter > 0) p.vy = Math.max(p.vy, -1.1);
        p.x += p.vx * dt + (p.flutter ? Math.sin(p.life * 7 + p.rx) * p.flutter * dt : 0);
        p.y += p.vy * dt;
        p.z += p.vz * dt + (p.flutter ? Math.cos(p.life * 6 + p.ry) * p.flutter * dt : 0);
        p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
        if (p.y < groundY + 0.03 && p.vy < 0 && p.grav > 0) {
          p.y = groundY + 0.03;
          p.landed = true;
          p.life = Math.min(p.life, 0.35);
          p.max = 0.35;
        }
      }
    }
    let n = 0;
    for (let i = 0; i < this.alive; i++) {
      const p = this.ps[i];
      const t = p.life / p.max;
      let sc: number;
      if (this.billboard) sc = p.size * (0.45 + 0.55 * Math.sqrt(t));
      else if (p.grow) sc = p.size * (0.6 + (1 - t) * 1.4) * Math.min(1, t * 3);
      else sc = p.size * Math.min(1, t * 2.5);
      if (this.billboard) this.q.copy(camQ);
      else this.q.setFromEuler(this.e.set(p.rx, p.ry, p.rz));
      this.v.set(p.x, p.y, p.z);
      this.s.set(sc * p.sw, sc * p.sh, sc);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      // additive glows fade by darkening; everything else keeps its colour and shrinks away
      const f = this.billboard ? t : 1;
      this.c.setRGB(p.r * f, p.g * f, p.b * f);
      this.mesh.setColorAt(n, this.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.alive = 0;
    this.mesh.count = 0;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly solid: Pool;
  private readonly glow: Pool;
  private readonly smoke: Pool;
  private readonly tmp = new THREE.Quaternion();

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const solidMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.solid = new Pool(1800, quad, solidMat, false);
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new Pool(500, new THREE.PlaneGeometry(1, 1), glowMat, true);
    const puff = new THREE.IcosahedronGeometry(0.5, 1);
    const smokeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
    this.smoke = new Pool(160, puff, smokeMat, false);
    this.group.add(this.solid.mesh, this.smoke.mesh, this.glow.mesh);
    this.glow.mesh.renderOrder = 5;
  }

  /** A blade-shaped scrap flung from the cutter. */
  clipping(o: Emit) {
    this.solid.emit({ size: 0.075, sw: 0.45, sh: 1.2, life: 0.9, grav: 11, drag: 1.1, ...o });
  }
  petal(o: Emit) {
    this.solid.emit({ size: 0.1, sw: 0.8, sh: 1.1, life: 1.5, grav: 3.2, drag: 1.6, flutter: 0.55, spin: 7, ...o });
  }
  confetti(o: Emit) {
    this.solid.emit({ size: 0.13, sw: 0.5, sh: 1, life: 2.4, grav: 5, drag: 1.1, flutter: 0.7, spin: 14, ...o });
  }
  spark(o: Emit) {
    this.glow.emit({ size: 0.34, life: 0.55, grav: 0, drag: 2.5, spin: 0, color: '#ffd24a', ...o });
  }
  puff(o: Emit) {
    this.smoke.emit({ size: 0.16, life: 0.7, grav: -0.8, drag: 1.4, grow: 1, color: '#e9edf2', spin: 0, ...o });
  }
  dust(o: Emit) {
    this.smoke.emit({ size: 0.22, life: 0.55, grav: -0.4, drag: 2.6, grow: 1, color: '#d7c7a6', spin: 0, ...o });
  }

  update(dt: number, cam: THREE.Camera, groundY = 0) {
    cam.getWorldQuaternion(this.tmp);
    this.solid.update(dt, this.tmp, groundY);
    this.glow.update(dt, this.tmp, groundY);
    this.smoke.update(dt, this.tmp, groundY);
  }
  clear() {
    this.solid.clear();
    this.glow.clear();
    this.smoke.clear();
  }
}

/** Butterflies, falling petals and leaves, fireflies, drifting motes: a lawn that is alive. */
export class Ambient {
  readonly group = new THREE.Group();
  private readonly leaves: THREE.InstancedMesh | null = null;
  private readonly lights: THREE.InstancedMesh | null = null;
  private readonly bf: { g: THREE.Group; wings: THREE.Mesh[]; cx: number; cz: number; ax: number; az: number; sp: number; ph: number; h: number }[] = [];
  private readonly seeds: { x: number; y: number; z: number; ph: number; sp: number; sz: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private theme: Theme, private w: number, private h: number, seed: number) {
    const rng = new Rng(seed);
    const n = 46;
    for (let i = 0; i < n; i++) {
      this.seeds.push({ x: rng.range(-w / 2 - 1, w / 2 + 1), y: rng.range(0, 3.2), z: rng.range(-h / 2 - 1, h / 2 + 1), ph: rng.range(0, 6.28), sp: rng.range(0.4, 1), sz: rng.range(0.7, 1.2) });
    }
    if (theme.ambient === 'petals' || theme.ambient === 'leaves') {
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      this.leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, theme.ambient === 'leaves' ? 0.17 : 0.11), mat, n);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) this.leaves.setColorAt(i, c.set(theme.drift[i % theme.drift.length]));
      this.leaves.frustumCulled = false;
      this.group.add(this.leaves);
    } else {
      const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      this.lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
      const c = new THREE.Color();
      const fire = theme.ambient === 'fireflies';
      for (let i = 0; i < n; i++) this.lights.setColorAt(i, c.set(theme.drift[i % theme.drift.length]).multiplyScalar(fire ? 1 : 0.32));
      this.lights.frustumCulled = false;
      this.group.add(this.lights);
    }
    if (theme.ambient !== 'fireflies') {
      const nb = Math.max(2, Math.min(7, Math.round((w * h) / 22)));
      for (let i = 0; i < nb; i++) {
        const g = new THREE.Group();
        const col = new THREE.Color(rng.pick(theme.blooms.length > 2 ? theme.blooms.slice(1) : theme.blooms));
        const wm = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
        const geo = new THREE.CircleGeometry(0.12, 8);
        geo.scale(1, 1.1, 1);
        geo.translate(0.1, 0, 0);
        const w1 = new THREE.Mesh(geo, wm);
        const w2 = new THREE.Mesh(geo, wm);
        w2.scale.x = -1;
        g.add(w1, w2);
        this.group.add(g);
        this.bf.push({ g, wings: [w1, w2], cx: rng.range(-w / 2, w / 2), cz: rng.range(-h / 2, h / 2), ax: rng.range(1.5, 3.5), az: rng.range(1, 2.6), sp: rng.range(0.25, 0.5), ph: rng.range(0, 6.28), h: rng.range(0.9, 1.6) });
      }
    }
  }

  update(t: number, _dt: number) {
    const { w, h } = this;
    if (this.leaves) {
      const leaf = this.theme.ambient === 'leaves';
      for (let i = 0; i < this.seeds.length; i++) {
        const s = this.seeds[i];
        const fall = (s.y - t * 0.38 * s.sp + 1000) % 3.4;
        const y = fall - 0.1;
        const sway = Math.sin(t * 1.3 * s.sp + s.ph);
        this.v.set(wrap(s.x + t * 0.12 * s.sp, -w / 2 - 1, w / 2 + 1) + sway * 0.45, y, s.z + Math.cos(t * 0.9 + s.ph) * 0.35);
        this.q.setFromEuler(this.e.set(t * 1.7 * s.sp + s.ph, t * 1.1 + s.ph, Math.sin(t * 2 + s.ph) * (leaf ? 1.2 : 0.6)));
        this.s.setScalar(s.sz);
        this.m.compose(this.v, this.q, this.s);
        this.leaves.setMatrixAt(i, this.m);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
    if (this.lights) {
      const fire = this.theme.ambient === 'fireflies';
      for (let i = 0; i < this.seeds.length; i++) {
        const s = this.seeds[i];
        const y = 0.35 + (s.y / 3.2) * (fire ? 1.5 : 2.2) + Math.sin(t * 0.8 * s.sp + s.ph) * 0.2;
        const x = s.x + Math.sin(t * 0.5 * s.sp + s.ph) * 0.8;
        const z = s.z + Math.cos(t * 0.43 * s.sp + s.ph * 1.7) * 0.8;
        const pulse = fire ? 0.5 + 0.5 * Math.sin(t * 2.2 * s.sp + s.ph * 3) : 1;
        this.v.set(x, y, z);
        this.q.copy(this.camQ);
        this.s.setScalar((fire ? 0.5 : 0.1) * s.sz * (0.45 + 0.55 * pulse));
        this.m.compose(this.v, this.q, this.s);
        this.lights.setMatrixAt(i, this.m);
      }
      this.lights.instanceMatrix.needsUpdate = true;
    }
    for (const b of this.bf) {
      const a = t * b.sp + b.ph;
      const x = b.cx + Math.sin(a) * b.ax;
      const z = b.cz + Math.sin(a * 0.7 + 1) * b.az;
      b.g.position.set(clampTo(x, -w / 2 - 0.5, w / 2 + 0.5), b.h + Math.sin(a * 2.3) * 0.25, clampTo(z, -h / 2 - 0.5, h / 2 + 0.5));
      b.g.rotation.y = Math.atan2(Math.cos(a) * b.ax, Math.cos(a * 0.7 + 1) * 0.7 * b.az) + Math.PI / 2;
      const flap = Math.sin(t * 22 + b.ph) * 0.9;
      b.wings[0].rotation.y = flap;
      b.wings[1].rotation.y = -flap;
      b.g.rotation.x = 0;
    }
  }

  private readonly camQ = new THREE.Quaternion();
  setCamera(q: THREE.Quaternion) {
    this.camQ.copy(q);
  }

  dispose() {
    this.group.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
}

const clampTo = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (v: number, lo: number, hi: number) => {
  const r = hi - lo;
  return ((((v - lo) % r) + r) % r) + lo;
};
