import * as THREE from 'three';

/**
 * What tyres leave behind. Smoke and dust are soft billboards with a cloudy texture of their own,
 * turning slowly as they rise, and they thin out as they reach the camera so driving through one
 * isn't a white screen. Sparks are the same quads stretched along their own travel. The black lines
 * on the road are one continuous strip per wheel.
 */

const V_BIT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iTint;
attribute vec2 iSR;
varying vec4 vTint;
varying vec2 vUv;
varying float vNear;
uniform float uStretch;
void main() {
  vTint = iTint;
  vUv = uv;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 q = position.xy;
  float s = iSR.x;
  vec2 o;
  if (uStretch > 0.0) {
    vec2 d = (viewMatrix * vec4(iVel, 0.0)).xy;
    float l = length(d);
    vec2 a = l > 1e-3 ? d / l : vec2(1.0, 0.0);
    o = a * q.x * (s + l * uStretch) + vec2(-a.y, a.x) * q.y * s;
  } else {
    float c = cos(iSR.y), n = sin(iSR.y);
    o = vec2(c * q.x - n * q.y, n * q.x + c * q.y) * s;
  }
  mv.xy += o;
  vNear = smoothstep(1.0, 4.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const F_BIT = /* glsl */ `
varying vec4 vTint;
varying vec2 vUv;
varying float vNear;
uniform sampler2D uMap;
uniform float uHard;
void main() {
  float a;
  if (uHard > 0.5) {
    float d = length((vUv - 0.5) * 2.0);
    a = smoothstep(1.0, 0.15, d);
  } else {
    a = texture2D(uMap, vUv).r * vNear;
  }
  a *= vTint.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint.rgb, a);
}`;

/** a soft lump of cloud: a few dozen overlapping blobs, fading to nothing well inside the quad */
function puffTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, S, S);
  x.globalCompositeOperation = 'lighter';
  let seed = 991;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 46; k++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * S * 0.25, cx = S / 2 + Math.cos(a) * d, cy = S / 2 + Math.sin(a) * d, rad = S * (0.09 + r() * 0.15);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.24)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

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
  rot: number;
  spin: number;
}

/** a pool of billboards: soft puffs, or (glow) bright streaks */
export class Bits {
  readonly mesh: THREE.Mesh;
  private pool: Bit[] = [];
  private at = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private tint: Float32Array;
  private sr: Float32Array;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.Texture | null;
  constructor(private n: number, glow: boolean) {
    for (let i = 0; i < n; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 1, fall: 0, rot: 0, spin: 0 });
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.tint = new Float32Array(n * 4);
    this.sr = new Float32Array(n * 2);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const inst = (a: Float32Array, k: number) => new THREE.InstancedBufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', inst(this.pos, 3));
    g.setAttribute('iVel', inst(this.vel, 3));
    g.setAttribute('iTint', inst(this.tint, 4));
    g.setAttribute('iSR', inst(this.sr, 2));
    g.instanceCount = n;
    this.tex = glow ? null : puffTexture();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: V_BIT,
      fragmentShader: F_BIT,
      uniforms: { uHard: { value: glow ? 1 : 0 }, uStretch: { value: glow ? 0.022 : 0 }, uMap: { value: this.tex } },
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
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
    p.rot = Math.random() * 6.283;
    p.spin = (Math.random() - 0.5) * 1.4;
  }
  update(dt: number) {
    const { pos, vel, tint, sr, pool } = this;
    const drag = Math.exp(-dt * 1.7);
    for (let i = 0; i < this.n; i++) {
      const p = pool[i];
      if (p.life <= 0) {
        if (sr[i * 2] !== 0) {
          sr[i * 2] = 0;
          tint[i * 4 + 3] = 0;
        }
        continue;
      }
      p.life -= dt;
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - p.fall * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
      const k = Math.max(0, p.life / p.max), o3 = i * 3, o4 = i * 4;
      pos[o3] = p.x;
      pos[o3 + 1] = p.y;
      pos[o3 + 2] = p.z;
      vel[o3] = p.vx;
      vel[o3 + 1] = p.vy;
      vel[o3 + 2] = p.vz;
      tint[o4] = p.r;
      tint[o4 + 1] = p.g;
      tint[o4 + 2] = p.b;
      tint[o4 + 3] = p.a * k * Math.min(1, (1 - k) * 9 + 0.15);
      sr[i * 2] = p.size;
      sr[i * 2 + 1] = p.rot;
    }
    const g = this.mesh.geometry;
    g.attributes.iPos.needsUpdate = g.attributes.iVel.needsUpdate = g.attributes.iTint.needsUpdate = g.attributes.iSR.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex?.dispose();
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
  /** the next piece of a strip: from the last edge (a left, a right) to this one, each with its strength */
  add(a: Edge, b: Edge, r: number, g: number, bl: number) {
    const o = this.at * 12, c = this.at * 16, P = this.pos, C = this.col, up = 0.012;
    this.at = (this.at + 1) % this.n;
    P[o] = a.lx;
    P[o + 1] = a.ly + up;
    P[o + 2] = a.lz;
    P[o + 3] = a.rx;
    P[o + 4] = a.ry + up;
    P[o + 5] = a.rz;
    P[o + 6] = b.lx;
    P[o + 7] = b.ly + up;
    P[o + 8] = b.lz;
    P[o + 9] = b.rx;
    P[o + 10] = b.ry + up;
    P[o + 11] = b.rz;
    for (let k = 0; k < 4; k++) {
      C[c + k * 4] = r;
      C[c + k * 4 + 1] = g;
      C[c + k * 4 + 2] = bl;
      C[c + k * 4 + 3] = k < 2 ? a.a : b.a;
    }
    const q = this.mesh.geometry;
    q.attributes.position.needsUpdate = q.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** the end of a strip of rubber */
export interface Edge {
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  a: number;
}
