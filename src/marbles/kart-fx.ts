import * as THREE from 'three';

/** What tyres leave behind: smoke and dust, sparks, and black lines on the road. */

const V_SOFT = /* glsl */ `
attribute float aSize;
attribute vec4 aTint;
varying vec4 vTint;
uniform float uScale;
void main() {
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const F_SOFT = /* glsl */ `
varying vec4 vTint;
uniform float uHard;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = uHard > 0.5 ? smoothstep(1.0, 0.2, d) : pow(max(0.0, 1.0 - d * d), 1.6);
  if (a * vTint.a < 0.004) discard;
  gl_FragColor = vec4(vTint.rgb, a * vTint.a);
}`;

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  fall: number;
}

/** a pool of soft points */
export class Bits {
  readonly mesh: THREE.Points;
  private pool: Bit[] = [];
  private at = 0;
  private pos: Float32Array;
  private tint: Float32Array;
  private size: Float32Array;
  private mat: THREE.ShaderMaterial;
  constructor(private n: number, glow: boolean) {
    for (let i = 0; i < n; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 1, fall: 0 });
    this.pos = new Float32Array(n * 3);
    this.tint = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: V_SOFT,
      fragmentShader: F_SOFT,
      uniforms: { uScale: { value: 500 }, uHard: { value: glow ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, a: number, fall = 0) {
    const p = this.pool[this.at];
    this.at = (this.at + 1) % this.n;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = p.max = life;
    p.size = size;
    p.grow = grow;
    p.r = r;
    p.g = g;
    p.b = b;
    p.a = a;
    p.fall = fall;
  }
  update(dt: number, height: number) {
    this.mat.uniforms.uScale.value = height * 0.9;
    const { pos, tint, size } = this;
    const drag = Math.exp(-dt * 1.7);
    this.pool.forEach((p, i) => {
      if (p.life <= 0) {
        size[i] = 0;
        tint[i * 4 + 3] = 0;
        return;
      }
      p.life -= dt;
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - p.fall * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      const k = Math.max(0, p.life / p.max);
      pos.set([p.x, p.y, p.z], i * 3);
      tint.set([p.r, p.g, p.b, p.a * k * Math.min(1, (1 - k) * 9 + 0.15)], i * 4);
      size[i] = p.size;
    });
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.aTint.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** rubber on the road: quads in a ring buffer, oldest overwritten first */
export class Skids {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private at = 0;
  constructor(private n: number) {
    this.pos = new Float32Array(n * 4 * 3);
    this.col = new Float32Array(n * 4 * 4);
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  /** a stretch of mark from where this wheel last was (a) to where it is (b), `w` wide on a surface with this left */
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, lx: number, ly: number, lz: number, w: number, a0: number, a1: number, shade: number) {
    const o = this.at * 12, c = this.at * 16;
    this.at = (this.at + 1) % this.n;
    const up = 0.012;
    this.pos.set([ax + lx * w, ay + ly * w + up, az + lz * w, ax - lx * w, ay - ly * w + up, az - lz * w, bx + lx * w, by + ly * w + up, bz + lz * w, bx - lx * w, by - ly * w + up, bz - lz * w], o);
    this.col.set([shade, shade, shade, a0, shade, shade, shade, a0, shade, shade, shade, a1, shade, shade, shade, a1], c);
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
