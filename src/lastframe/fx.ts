import * as THREE from 'three';
import { applyLF } from './lighting.ts';

/** Everything a shot leaves behind: flash, smoke, sparks, holes, brass, and the rain. */

function blob(size: number, paint: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  paint(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PVS = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute vec3 aCol;
varying float vA; varying vec3 vC;
uniform float scale;
void main(){ vA = aAlpha; vC = aCol; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = min(420., aSize * scale / max(.1, -mv.z)); }
`;
const PFS = /* glsl */ `
varying float vA; varying vec3 vC;
void main(){ vec2 p = gl_PointCoord - .5; float r = length(p) * 2.; float a = smoothstep(1., .1, r); if (a <= 0.) discard; gl_FragColor = vec4(vC, a * vA); }
`;

class Pool {
  n = 0;
  readonly geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private col: Float32Array;
  private v: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private a0: Float32Array;
  private i = 0;
  readonly points: THREE.Points;
  constructor(readonly cap: number, blending: THREE.Blending) {
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);
    this.v = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ vertexShader: PVS, fragmentShader: PFS, uniforms: { scale: { value: 800 } }, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(this.geo, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, r: number, g: number, b: number, a: number, grav: number) {
    const i = (this.i = (this.i + 1) % this.cap);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = this.max[i] = life;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.a0[i] = a;
    this.grav[i] = grav;
  }
  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      const dr = Math.exp(-dt * 2.2);
      this.v[i * 3] *= dr;
      this.v[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.v[i * 3] * dt;
      this.pos[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * k;
    }
    for (const n of ['position', 'aSize', 'aAlpha', 'aCol']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}

const SURF: Record<string, [number, number, number, number]> = {
  stone: [0.1, 0.095, 0.09, 1],
  plaster: [0.2, 0.19, 0.17, 1.3],
  wood: [0.1, 0.07, 0.04, 0.8],
  metal: [0.07, 0.07, 0.07, 0.5],
  glass: [0.2, 0.22, 0.24, 0.8],
  flesh: [0.1, 0.005, 0.004, 0.9],
};

export class Fx {
  readonly group = new THREE.Group();
  private soft = new Pool(700, THREE.NormalBlending);
  private glow = new Pool(400, THREE.AdditiveBlending);
  private decals: THREE.InstancedMesh;
  private dI = 0;
  private DM = 500;
  private tracer: THREE.LineSegments;
  private tPos = new Float32Array(32 * 6);
  private tLife = new Float32Array(32);
  private tI = 0;
  private flash: THREE.Mesh[] = [];
  private flashT = 0;
  private shells: THREE.InstancedMesh;
  private sP: { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; t: number; rest: boolean }[] = [];
  private sI = 0;
  private SM = 48;
  private rain: THREE.LineSegments;
  private rainU = { cam: { value: new THREE.Vector3() }, time: { value: 0 }, roofs: { value: [] as THREE.Vector4[] }, k: { value: 1 } };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);
  onShellTink: (x: number, y: number, z: number) => void = () => {};
  groundAt: (x: number, y: number, z: number) => number = () => 0;

  constructor(roofs: THREE.Vector4[]) {
    this.group.add(this.soft.points, this.glow.points);
    // bullet holes and blood, one quad each
    const hole = blob(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      const h = s / 2;
      // two columns of cells: hole | blood
      for (let k = 0; k < 2; k++) {
        const cx = h / 2 + k * h, cy = h / 2;
        if (k === 0) {
          const g = c.createRadialGradient(cx, cy, 2, cx, cy, h * 0.46);
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(0.22, 'rgba(6,6,6,0.98)');
          g.addColorStop(0.32, 'rgba(50,48,44,0.7)');
          g.addColorStop(0.75, 'rgba(30,28,26,0.22)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
          c.fillRect(0, 0, h, h);
          c.strokeStyle = 'rgba(10,10,10,0.5)';
          for (let i = 0; i < 9; i++) {
            const a = Math.random() * 6.28, l = h * (0.2 + Math.random() * 0.26);
            c.beginPath();
            c.moveTo(cx + Math.cos(a) * h * 0.1, cy + Math.sin(a) * h * 0.1);
            c.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
            c.stroke();
          }
        } else {
          for (let i = 0; i < 60; i++) {
            const a = Math.random() * 6.28, r = Math.pow(Math.random(), 1.8) * h * 0.46, sz = Math.random() * 11 + 1;
            c.fillStyle = `rgba(${40 + Math.random() * 30},3,4,${0.45 + Math.random() * 0.5})`;
            c.beginPath();
            c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, sz, 0, 6.28);
            c.fill();
          }
        }
      }
    });
    const dg = new THREE.PlaneGeometry(1, 1);
    const off = new Float32Array(this.DM);
    dg.setAttribute('aCell', new THREE.InstancedBufferAttribute(off, 1));
    const dm = applyLF(new THREE.MeshStandardMaterial({ map: hole, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const prev = dm.onBeforeCompile;
    dm.onBeforeCompile = (s, r) => {
      prev.call(dm, s, r);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2( uv.x * 0.5 + aCell * 0.5, uv.y * 0.5 + 0.5 );');
    };
    dm.customProgramCacheKey = () => 'lfdecal';
    this.decals = new THREE.InstancedMesh(dg, dm, this.DM);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 3;
    this.group.add(this.decals);
    // tracers
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracer = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(9, 6.5, 3), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracer.frustumCulled = false;
    this.group.add(this.tracer);
    // the flash: three crossed cards, redrawn at random each shot
    const star = blob(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.translate(s / 2, s / 2);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.48);
      g.addColorStop(0, 'rgba(255,240,200,1)');
      g.addColorStop(0.25, 'rgba(255,170,70,0.9)');
      g.addColorStop(1, 'rgba(255,90,10,0)');
      c.fillStyle = g;
      for (let i = 0; i < 7; i++) {
        c.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
        c.beginPath();
        c.moveTo(-s * 0.04, 0);
        c.lineTo(0, -s * (0.26 + Math.random() * 0.22));
        c.lineTo(s * 0.04, 0);
        c.fill();
      }
      c.beginPath();
      c.arc(0, 0, s * 0.14, 0, 6.28);
      c.fill();
    });
    const fm = new THREE.MeshBasicMaterial({ map: star, color: new THREE.Color(16, 13, 10), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
      p.visible = false;
      p.renderOrder = 7;
      p.frustumCulled = false;
      this.flash.push(p);
      this.group.add(p);
    }
    // brass
    const sg = new THREE.CylinderGeometry(0.0048, 0.0048, 0.038, 6);
    this.shells = new THREE.InstancedMesh(sg, applyLF(new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 0.95, roughness: 0.3 })), this.SM);
    this.shells.frustumCulled = false;
    this.shells.count = 0;
    this.group.add(this.shells);
    for (let i = 0; i < this.SM; i++) this.sP.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, t: 0, rest: true });
    // rain: streaks that wrap round the camera, kept off anything with a roof
    const N = 2600;
    const rp = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      rp.set([x, y, z, x, y, z], i * 6);
      seed[i * 2] = 0;
      seed[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.rainU.roofs.value = roofs;
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: this.rainU,
      vertexShader: `attribute float aEnd; uniform vec3 cam; uniform float time; uniform vec4 roofs[${roofs.length}]; varying float vA;
        void main(){
          vec3 box = vec3(24., 16., 24.);
          vec3 p = position * box;
          p.y -= time * 15.;
          p.x -= time * 1.2;
          vec3 o = cam - box * .5;
          p = mod(p - o, box) + o;
          float y0 = p.y;
          p.y += aEnd * .34; p.x += aEnd * .03;
          vA = .06;
          for (int i = 0; i < ${roofs.length}; i++) { vec4 r = roofs[i]; if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w) vA = 0.; }
          if (y0 < -0.1) vA = 0.;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
        }`,
      fragmentShader: `varying float vA; uniform float k; void main(){ if (vA <= 0.) discard; gl_FragColor = vec4(vec3(.5,.55,.62), vA * k); }`,
    }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.group.add(this.rain);
  }

  muzzle(p: THREE.Vector3, d: THREE.Vector3, big = 1) {
    this.flashT = 0.034;
    const s = (0.2 + Math.random() * 0.2) * big;
    this.flash.forEach((f, i) => {
      f.visible = true;
      f.position.copy(p).addScaledVector(d, 0.04 + s * 0.3);
      if (i === 0) f.quaternion.setFromUnitVectors(this.z, d);
      else {
        const t = new THREE.Vector3(i === 1 ? 1 : 0, i === 1 ? 0 : 1, 0.01).cross(d).normalize();
        f.quaternion.setFromUnitVectors(this.z, t);
      }
      if (i === 0) f.rotateZ(Math.random() * 6.28);
      f.scale.setScalar(i === 0 ? s * 0.8 : s * 1.3);
    });
    for (let i = 0; i < 5; i++) this.soft.emit(p.x, p.y, p.z, d.x * 2.4 + rnd(0.6), d.y * 2.4 + rnd(0.6) + 0.3, d.z * 2.4 + rnd(0.6), 0.1, 0.8, 0.7 + Math.random() * 0.5, 0.05, 0.05, 0.05, 0.1, -0.2);
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surf: string) {
    const c = SURF[surf] ?? SURF.stone;
    const n = surf === 'flesh' ? 7 : 9;
    for (let i = 0; i < n; i++) {
      const sp = 0.8 + Math.random() * 2.4;
      this.soft.emit(x, y, z, nx * sp + rnd(1), ny * sp + rnd(1), nz * sp + rnd(1), 0.05 + Math.random() * 0.08, 0.5 * c[3], 0.35 + Math.random() * 0.6, c[0], c[1], c[2], 0.5, surf === 'flesh' ? 3 : 1.2);
    }
    if (surf === 'metal' || surf === 'stone') {
      for (let i = 0; i < (surf === 'metal' ? 8 : 3); i++) {
        const sp = 2 + Math.random() * 5;
        this.glow.emit(x, y, z, nx * sp + rnd(3), ny * sp + rnd(3) + 1, nz * sp + rnd(3), 0.012, 0, 0.12 + Math.random() * 0.2, 12, 7, 2.6, 1, 9);
      }
    }
    if (surf === 'glass') {
      for (let i = 0; i < 26; i++) this.glow.emit(x + rnd(0.4), y + rnd(0.4), z + rnd(0.4), rnd(2), -Math.random(), rnd(2), 0.018, 0, 0.5 + Math.random() * 0.4, 1.4, 1.5, 1.6, 0.8, 9);
      return;
    }
    if (nx || ny || nz) this.decal(x, y, z, nx, ny, nz, surf === 'flesh' ? 1 : 0, surf === 'flesh' ? 0.5 : 0.09 + Math.random() * 0.05);
  }

  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, cell: number, size: number) {
    const i = this.dI;
    this.dI = (this.dI + 1) % this.DM;
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.v.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.z, this.v);
    const rot = new THREE.Quaternion().setFromAxisAngle(this.z, Math.random() * 6.28);
    this.q.multiply(rot);
    this.m.compose(this.s.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006), this.q, new THREE.Vector3(size, size, size));
    this.decals.setMatrixAt(i, this.m);
    this.decals.instanceMatrix.needsUpdate = true;
    const a = this.decals.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    a.setX(i, cell);
    a.needsUpdate = true;
  }

  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    for (let i = 0; i < 16; i++) {
      const sp = 1 + Math.random() * 3.6;
      this.soft.emit(x, y, z, dx * sp + rnd(1.1), dy * sp + rnd(1.1) + 0.5, dz * sp + rnd(1.1), 0.035 + Math.random() * 0.05, 0.18, 0.28 + Math.random() * 0.3, 0.09, 0.004, 0.005, 0.85, 8);
    }
  }

  tracerLine(a: THREE.Vector3, bx: number, by: number, bz: number) {
    const i = this.tI;
    this.tI = (this.tI + 1) % 32;
    this.tPos.set([a.x, a.y, a.z, bx, by, bz], i * 6);
    this.tLife[i] = 0.035;
    (this.tracer.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  shell(p: THREE.Vector3, vx: number, vy: number, vz: number) {
    const s = this.sP[this.sI];
    this.sI = (this.sI + 1) % this.SM;
    this.shells.count = Math.max(this.shells.count, this.sI);
    Object.assign(s, { x: p.x, y: p.y, z: p.z, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, t: 0, rest: false });
  }

  burst(p: THREE.Vector3, kind: 'frag' | 'flash') {
    const frag = kind === 'frag';
    for (let i = 0; i < 46; i++) this.soft.emit(p.x + rnd(0.6), p.y + 0.2 + rnd(0.3), p.z + rnd(0.6), rnd(6), Math.random() * 5, rnd(6), 0.5, 3.2, 1.6 + Math.random() * 2.6, frag ? 0.016 : 0.05, frag ? 0.016 : 0.05, frag ? 0.017 : 0.055, frag ? 0.42 : 0.22, -0.1);
    for (let i = 0; i < 40; i++) this.glow.emit(p.x, p.y + 0.1, p.z, rnd(13), Math.random() * 9, rnd(13), 0.02, 0, 0.18 + Math.random() * 0.3, 18, 10, 3, 1, 12);
    this.glow.emit(p.x, p.y + 0.4, p.z, 0, 0, 0, frag ? 5 : 7, 8, 0.14, frag ? 30 : 60, frag ? 18 : 60, frag ? 7 : 60, 1, 0);
  }

  update(dt: number, time: number, cam: THREE.Camera, indoors: boolean) {
    this.flashT -= dt;
    if (this.flashT <= 0) for (const f of this.flash) f.visible = false;
    this.soft.update(dt);
    this.glow.update(dt);
    const tp = this.tPos;
    let dirty = false;
    for (let i = 0; i < 32; i++) {
      if (this.tLife[i] <= 0) continue;
      this.tLife[i] -= dt;
      if (this.tLife[i] <= 0) {
        tp.fill(0, i * 6, i * 6 + 6);
        dirty = true;
      }
    }
    if (dirty) (this.tracer.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    let upd = false;
    for (let i = 0; i < this.SM; i++) {
      const s = this.sP[i];
      if (!s.rest) {
        s.t += dt;
        s.vy -= 11 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.rx += dt * 19;
        s.ry += dt * 13;
        const g = this.groundAt(s.x, s.y + 0.2, s.z);
        if (s.y < g + 0.006 && s.vy < 0) {
          if (Math.abs(s.vy) > 1.4) this.onShellTink(s.x, s.y, s.z);
          s.y = g + 0.006;
          s.vy *= -0.32;
          s.vx *= 0.5;
          s.vz *= 0.5;
          if (Math.abs(s.vy) < 0.3) {
            s.rest = true;
            s.rx = 1.57;
          }
        }
      }
      if (i < this.shells.count) {
        this.q.setFromEuler(new THREE.Euler(s.rx, s.ry, 0));
        this.m.compose(this.v.set(s.x, s.y, s.z), this.q, this.s.set(1, 1, 1));
        this.shells.setMatrixAt(i, this.m);
        upd = true;
      }
    }
    if (upd) this.shells.instanceMatrix.needsUpdate = true;
    this.rainU.cam.value.copy(cam.position);
    this.rainU.time.value = time;
    this.rainU.k.value = indoors ? 0.5 : 1;
  }
}

const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;
