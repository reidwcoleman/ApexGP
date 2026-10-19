/** Particles (grass clippings, petals, sparkles, confetti, puffs) and the lawn's own ambient life. */
import * as THREE from 'three';
import type { Theme } from './levels.ts';
import { Rng } from './util.ts';

let glowTex: THREE.Texture | null = null;
/** A soft round glow (sparkles, lantern halos, fireflies, pollen). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

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
      this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, life: 0, max: 1, size: 1, sw: 1, sh: 1, grav: 9.8, drag: 0.5, flutter: 0, grow: 0, r: 1, g: 1, b: 1, landed: false });
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
    p.size = o.size ?? 0.04;
    p.sw = o.sw ?? 1; p.sh = o.sh ?? 1;
    p.grav = o.grav ?? 9.8;
    p.drag = o.drag ?? 0.5;
    p.flutter = o.flutter ?? 0;
    p.grow = o.grow ?? 0;
    this.c.set(o.color ?? '#7bb84a');
    p.r = this.c.r; p.g = this.c.g; p.b = this.c.b;
    p.landed = false;
  }

  update(dt: number, camQ: THREE.Quaternion) {
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
        if (p.flutter > 0) p.vy = Math.max(p.vy, -0.9);
        p.x += p.vx * dt + (p.flutter ? Math.sin(p.life * 7 + p.rx) * p.flutter * dt : 0);
        p.y += p.vy * dt;
        p.z += p.vz * dt + (p.flutter ? Math.cos(p.life * 6 + p.ry) * p.flutter * dt : 0);
        p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
        if (p.y < 0.012 && p.vy < 0 && p.grav > 0) {
          p.y = 0.012;
          p.landed = true;
          p.life = Math.min(p.life, 0.5);
          p.max = 0.5;
        }
      }
    }
    let n = 0;
    for (let i = 0; i < this.alive; i++) {
      const p = this.ps[i];
      const t = p.life / p.max;
      let sc: number;
      if (this.billboard) sc = p.size * (0.45 + 0.55 * Math.sqrt(t));
      else if (p.grow) sc = p.size * (0.6 + (1 - t) * 1.6) * Math.min(1, t * 3);
      else sc = p.size * Math.min(1, t * 2.5);
      if (this.billboard) this.q.copy(camQ);
      else this.q.setFromEuler(this.e.set(p.rx, p.ry, p.rz));
      this.v.set(p.x, p.y, p.z);
      this.s.set(sc * p.sw, sc * p.sh, sc);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
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
    // (lit by nothing: a clipping is a few millimetres of green; its colour is the lawn's own)
    const solidMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: true });
    this.solid = new Pool(3000, quad, solidMat, false);
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.glow = new Pool(600, new THREE.PlaneGeometry(1, 1), glowMat, true);
    const puff = new THREE.IcosahedronGeometry(0.5, 1);
    const smokeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
    this.smoke = new Pool(240, puff, smokeMat, false);
    this.group.add(this.solid.mesh, this.smoke.mesh, this.glow.mesh);
    this.glow.mesh.renderOrder = 5;
  }

  /** A blade-shaped scrap flung from the cutter. */
  clipping(o: Emit) {
    this.solid.emit({ size: 0.034, sw: 0.28, sh: 1.7, life: 1.1, grav: 9.8, drag: 1.0, ...o });
  }
  petal(o: Emit) {
    this.solid.emit({ size: 0.045, sw: 0.8, sh: 1.1, life: 1.6, grav: 2.4, drag: 1.6, flutter: 0.3, spin: 7, ...o });
  }
  confetti(o: Emit) {
    this.solid.emit({ size: 0.075, sw: 0.5, sh: 1, life: 2.6, grav: 4, drag: 1.1, flutter: 0.45, spin: 14, ...o });
  }
  spark(o: Emit) {
    this.glow.emit({ size: 0.28, life: 0.55, grav: 0, drag: 2.5, spin: 0, color: '#ffd24a', ...o });
  }
  /** a drop of water */
  drop(o: Emit) {
    this.solid.emit({ size: 0.02, sw: 0.7, sh: 1.2, life: 0.9, grav: 9.8, drag: 0.2, spin: 0, color: '#d6ecff', ...o });
  }
  puff(o: Emit) {
    this.smoke.emit({ size: 0.09, life: 0.9, grav: -0.25, drag: 1.2, grow: 1, color: '#e9edf2', spin: 0, ...o });
  }
  dust(o: Emit) {
    this.smoke.emit({ size: 0.16, life: 0.8, grav: -0.1, drag: 2.0, grow: 1, color: '#cdbf9e', spin: 0, ...o });
  }

  update(dt: number, cam: THREE.Camera) {
    cam.getWorldQuaternion(this.tmp);
    this.solid.update(dt, this.tmp);
    this.glow.update(dt, this.tmp);
    this.smoke.update(dt, this.tmp);
  }
  clear() {
    this.solid.clear();
    this.glow.clear();
    this.smoke.clear();
  }
  dispose() {
    this.group.traverse((n) => {
      const m = n as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}

const PALETTES: Record<Theme['ambient'], string[]> = {
  pollen: ['#fffbe0', '#fff2b8'],
  leaves: ['#d9742a', '#e8a23a', '#b5482a', '#c9a227', '#8c3a1e'],
  petals: ['#ffc2da', '#ffffff'],
  fireflies: ['#fff3a8', '#f2ffb0'],
};

function wingTexture(kind: number) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const cols = [['#f08a24', '#2a1608'], ['#f4f1e6', '#3b3b3b'], ['#5aa0f0', '#1a2a46'], ['#f2d03a', '#4a3a10']][kind % 4];
  g.clearRect(0, 0, 128, 128);
  // a forewing and a hindwing, the left half; the model mirrors it
  g.fillStyle = cols[0];
  g.beginPath();
  g.moveTo(124, 60);
  g.bezierCurveTo(100, 4, 26, 6, 8, 52);
  g.bezierCurveTo(30, 70, 90, 74, 124, 60);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(124, 68);
  g.bezierCurveTo(90, 76, 36, 80, 30, 104);
  g.bezierCurveTo(52, 126, 104, 108, 124, 68);
  g.closePath();
  g.fill();
  g.strokeStyle = cols[1];
  g.lineWidth = 3;
  g.stroke();
  g.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(122, 62);
    g.lineTo(24 + i * 14, 14 + (i % 3) * 12);
    g.stroke();
  }
  g.fillStyle = cols[1];
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(18 + i * 16, 50 + (i % 2) * 6, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Butterflies, drifting pollen, falling leaves, fireflies: a lawn that is alive. */
export class Ambient {
  readonly group = new THREE.Group();
  private leaves: THREE.InstancedMesh | null = null;
  private lights: THREE.InstancedMesh | null = null;
  private readonly bf: { g: THREE.Group; wings: THREE.Mesh[]; cx: number; cz: number; ax: number; az: number; sp: number; ph: number; h: number }[] = [];
  private readonly seeds: { x: number; y: number; z: number; ph: number; sp: number; sz: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly camQ = new THREE.Quaternion();
  private textures: THREE.Texture[] = [];

  constructor(private theme: Theme, private W: number, private H: number, seed: number) {
    const rng = new Rng(seed);
    const area = W * H;
    const n = Math.min(260, Math.max(60, Math.round(area / 5)));
    for (let i = 0; i < n; i++) {
      this.seeds.push({ x: rng.range(-W / 2 - 2, W / 2 + 2), y: rng.range(0, 5), z: rng.range(-H / 2 - 2, H / 2 + 2), ph: rng.range(0, 6.28), sp: rng.range(0.4, 1), sz: rng.range(0.7, 1.2) });
    }
    const pal = PALETTES[theme.ambient];
    const c = new THREE.Color();
    if (theme.ambient === 'leaves' || theme.ambient === 'petals') {
      const nl = Math.round(n * 0.45);
      const geo = new THREE.CircleGeometry(0.5, 7);
      geo.scale(theme.ambient === 'leaves' ? 0.09 : 0.05, theme.ambient === 'leaves' ? 0.14 : 0.07, 1);
      const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
      this.leaves = new THREE.InstancedMesh(geo, mat, nl);
      for (let i = 0; i < nl; i++) this.leaves.setColorAt(i, c.set(pal[i % pal.length]));
      this.leaves.frustumCulled = false;
      this.group.add(this.leaves);
    } else {
      const fire = theme.ambient === 'fireflies';
      const nl = Math.round(n * (fire ? 0.5 : 0.8));
      const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      this.lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, nl);
      for (let i = 0; i < nl; i++) this.lights.setColorAt(i, c.set(pal[i % pal.length]).multiplyScalar(fire ? 1 : 0.5));
      this.lights.frustumCulled = false;
      this.group.add(this.lights);
    }
    if (theme.ambient !== 'fireflies') {
      const nb = Math.max(2, Math.min(9, Math.round(area / 60)));
      for (let i = 0; i < nb; i++) {
        const g = new THREE.Group();
        const tex = wingTexture(i);
        this.textures.push(tex);
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 });
        const geo = new THREE.PlaneGeometry(0.1, 0.1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(-0.05, 0, 0);
        const w1 = new THREE.Mesh(geo, mat);
        const w2 = new THREE.Mesh(geo, mat);
        w2.scale.x = -1;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), new THREE.MeshStandardMaterial({ color: '#2a2018' }));
        body.rotation.x = Math.PI / 2;
        g.add(w1, w2, body);
        this.group.add(g);
        this.bf.push({ g, wings: [w1, w2], cx: rng.range(-W / 2, W / 2), cz: rng.range(-H / 2, H / 2), ax: rng.range(2, 6), az: rng.range(1.5, 4), sp: rng.range(0.22, 0.42), ph: rng.range(0, 6.28), h: rng.range(0.5, 1.4) });
      }
    }
  }

  update(t: number) {
    const { W, H } = this;
    if (this.leaves) {
      const leaf = this.theme.ambient === 'leaves';
      const nl = this.leaves.count;
      for (let i = 0; i < nl; i++) {
        const s = this.seeds[i];
        const fall = (s.y - t * 0.32 * s.sp + 1000) % 5.4;
        const y = fall - 0.1;
        const sway = Math.sin(t * 1.1 * s.sp + s.ph);
        this.v.set(wrap(s.x + t * 0.22 * s.sp, -W / 2 - 2, W / 2 + 2) + sway * 0.5, y, s.z + Math.cos(t * 0.8 + s.ph) * 0.4);
        this.q.setFromEuler(this.e.set(t * 1.7 * s.sp + s.ph, t * 1.1 + s.ph, Math.sin(t * 2 + s.ph) * (leaf ? 1.2 : 0.6)));
        this.s.setScalar(s.sz);
        this.m.compose(this.v, this.q, this.s);
        this.leaves.setMatrixAt(i, this.m);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
    if (this.lights) {
      const fire = this.theme.ambient === 'fireflies';
      const nl = this.lights.count;
      for (let i = 0; i < nl; i++) {
        const s = this.seeds[i];
        const y = 0.3 + (s.y / 5) * (fire ? 1.6 : 3.2) + Math.sin(t * 0.7 * s.sp + s.ph) * 0.25;
        const x = s.x + Math.sin(t * 0.4 * s.sp + s.ph) * 1.0;
        const z = s.z + Math.cos(t * 0.35 * s.sp + s.ph * 1.7) * 1.0;
        const pulse = fire ? 0.5 + 0.5 * Math.sin(t * 2.2 * s.sp + s.ph * 3) : 1;
        this.v.set(x, y, z);
        this.q.copy(this.camQ);
        this.s.setScalar((fire ? 0.16 : 0.035) * s.sz * (0.45 + 0.55 * pulse));
        this.m.compose(this.v, this.q, this.s);
        this.lights.setMatrixAt(i, this.m);
      }
      this.lights.instanceMatrix.needsUpdate = true;
    }
    for (const b of this.bf) {
      const a = t * b.sp + b.ph;
      const x = b.cx + Math.sin(a) * b.ax;
      const z = b.cz + Math.sin(a * 0.7 + 1) * b.az;
      b.g.position.set(clampTo(x, -W / 2 - 1, W / 2 + 1), b.h + Math.sin(a * 2.3) * 0.2, clampTo(z, -H / 2 - 1, H / 2 + 1));
      b.g.rotation.y = Math.atan2(Math.cos(a) * b.ax, Math.cos(a * 0.7 + 1) * 0.7 * b.az) + Math.PI / 2;
      const flap = Math.sin(t * 24 + b.ph) * 0.9;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }
  }

  setCamera(q: THREE.Quaternion) {
    this.camQ.copy(q);
  }

  dispose() {
    this.group.traverse((n) => {
      const m = n as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.textures.forEach((t) => t.dispose());
  }
}

const clampTo = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (v: number, lo: number, hi: number) => {
  const r = hi - lo;
  return ((((v - lo) % r) + r) % r) + lo;
};
