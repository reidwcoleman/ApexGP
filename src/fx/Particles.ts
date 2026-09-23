import * as THREE from 'three';

/**
 * Two particle pools rendered as camera-facing quads:
 *   - soft (normal blending): tyre smoke, grass/gravel dust
 *   - hot (additive, HDR so it blooms): sparks from the skid blocks and walls
 * Simulation is on the CPU; each frame the live particles are packed into the
 * vertex buffers and the draw range is set.
 */

const PUFF_TEX = (() => {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const img = g.createImageData(s, s);
  // soft blob with some cauliflower noise
  const rnd = (x: number, y: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), cc = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      let n = 0, amp = 0.5, f = 4;
      for (let o = 0; o < 4; o++) {
        n += noise(x / s * f + 10, y / s * f + 3) * amp;
        amp *= 0.5;
        f *= 2;
      }
      const a = Math.max(0, 1 - r) ** 1.6 * (0.55 + n * 0.9);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
})();

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 center;
attribute vec3 vel;
attribute vec4 data; // size, alpha, rotation, stretch
attribute vec3 tint;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  float size = data.x;
  if (data.w > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vec2 d = vv.xy;
    float l = length(d);
    vec2 dir = l > 1e-4 ? d / l : vec2(0.0, 1.0);
    vec2 across = vec2(-dir.y, dir.x);
    mv.xy += across * corner.x * size + dir * corner.y * (size + l * data.w);
  } else {
    float c = cos(data.z), s = sin(data.z);
    mv.xy += mat2(c, -s, s, c) * corner * size;
  }
  vUv = corner * 0.5 + 0.5;
  vAlpha = data.y;
  vTint = tint;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_SOFT = /* glsl */ `
uniform sampler2D map;
uniform vec3 light;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  float a = texture2D(map, vUv).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vTint * light, a);
}
`;

const FRAG_HOT = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float core = exp(-dot(p * vec2(2.2, 1.0), p * vec2(2.2, 1.0)) * 2.5);
  gl_FragColor = vec4(vTint * core * vAlpha, 1.0);
}
`;

class Pool {
  readonly mesh: THREE.Mesh;
  readonly max: number;
  count = 0;
  // simulation state (SoA)
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array;
  size0: Float32Array; size1: Float32Array; alpha0: Float32Array;
  rot: Float32Array; rotV: Float32Array; drag: Float32Array; grav: Float32Array; stretch: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  private aCenter: THREE.BufferAttribute;
  private aVel: THREE.BufferAttribute;
  private aData: THREE.BufferAttribute;
  private aTint: THREE.BufferAttribute;
  private geo: THREE.BufferGeometry;

  constructor(max: number, material: THREE.ShaderMaterial) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f();
    this.size0 = f(); this.size1 = f(); this.alpha0 = f();
    this.rot = f(); this.rotV = f(); this.drag = f(); this.grav = f(); this.stretch = f();
    this.r = f(); this.g = f(); this.b = f();

    const geo = (this.geo = new THREE.BufferGeometry());
    const corner = new Float32Array(max * 8);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    this.aCenter = new THREE.BufferAttribute(new Float32Array(max * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(new Float32Array(max * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(new Float32Array(max * 16), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.BufferAttribute(new Float32Array(max * 12), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('center', this.aCenter);
    geo.setAttribute('vel', this.aVel);
    geo.setAttribute('data', this.aData);
    geo.setAttribute('tint', this.aTint);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number, r: number, g: number, b: number, drag: number, grav: number, stretch = 0) {
    let i = this.count;
    if (i >= this.max) {
      // overwrite the oldest-ish slot
      i = Math.floor(Math.random() * this.max);
    } else this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.size0[i] = s0; this.size1[i] = s1; this.alpha0[i] = a0;
    this.rot[i] = Math.random() * Math.PI * 2; this.rotV[i] = (Math.random() - 0.5) * 0.8;
    this.drag[i] = drag; this.grav[i] = grav; this.stretch[i] = stretch;
    this.r[i] = r; this.g[i] = g; this.b[i] = b;
  }

  update(dt: number) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d - this.grav[i] * dt; this.vz[i] *= d;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
    }
    this.count = n;
    const c = this.aCenter.array as Float32Array;
    const v = this.aVel.array as Float32Array;
    const dd = this.aData.array as Float32Array;
    const tt = this.aTint.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      const size = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      const alpha = this.alpha0[i] * (1 - t) * Math.min(1, t * 12);
      for (let k = 0; k < 4; k++) {
        const o3 = (i * 4 + k) * 3;
        c[o3] = this.px[i]; c[o3 + 1] = this.py[i]; c[o3 + 2] = this.pz[i];
        v[o3] = this.vx[i]; v[o3 + 1] = this.vy[i]; v[o3 + 2] = this.vz[i];
        tt[o3] = this.r[i]; tt[o3 + 1] = this.g[i]; tt[o3 + 2] = this.b[i];
        const o4 = (i * 4 + k) * 4;
        dd[o4] = size; dd[o4 + 1] = alpha; dd[o4 + 2] = this.rot[i]; dd[o4 + 3] = this.stretch[i];
      }
    }
    this.aCenter.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.aTint.needsUpdate = true;
    this.aCenter.clearUpdateRanges();
    this.aCenter.addUpdateRange(0, n * 12);
    this.aVel.clearUpdateRanges();
    this.aVel.addUpdateRange(0, n * 12);
    this.aTint.clearUpdateRanges();
    this.aTint.addUpdateRange(0, n * 12);
    this.aData.clearUpdateRanges();
    this.aData.addUpdateRange(0, n * 16);
    this.geo.setDrawRange(0, n * 6);
  }

  private copy(from: number, to: number) {
    const arrs = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.size0, this.size1, this.alpha0, this.rot, this.rotV, this.drag, this.grav, this.stretch, this.r, this.g, this.b];
    for (const a of arrs) a[to] = a[from];
  }

  clear() {
    this.count = 0;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private soft: Pool;
  private hot: Pool;
  readonly softMat: THREE.ShaderMaterial;

  constructor() {
    this.softMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_SOFT,
      uniforms: { map: { value: PUFF_TEX }, light: { value: new THREE.Color(1, 1, 1) } },
      transparent: true,
      depthWrite: false,
    });
    const hotMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG_HOT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.soft = new Pool(2400, this.softMat);
    this.hot = new Pool(1200, hotMat);
    this.group.add(this.soft.mesh, this.hot.mesh);
  }

  /** ambient light level for smoke (so it isn't glowing white at dusk) */
  setLight(c: THREE.Color) {
    (this.softMat.uniforms.light.value as THREE.Color).copy(c);
  }

  smoke(p: THREE.Vector3, v: THREE.Vector3, amount: number) {
    const k = 0.75 + Math.random() * 0.2;
    this.soft.spawn(
      p.x + (Math.random() - 0.5) * 0.3, p.y + 0.15, p.z + (Math.random() - 0.5) * 0.3,
      v.x * 0.35 + (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.8, v.z * 0.35 + (Math.random() - 0.5) * 1.2,
      1.2 + Math.random() * 1.2, 0.3, 1.8 + Math.random() * 1.2, 0.22 * amount, k, k, k * 1.02, 1.6, -0.25,
    );
  }

  dust(p: THREE.Vector3, v: THREE.Vector3, gravel: boolean, amount: number) {
    const r = gravel ? 0.66 : 0.46, g = gravel ? 0.58 : 0.42, b = gravel ? 0.46 : 0.3;
    this.soft.spawn(
      p.x + (Math.random() - 0.5) * 0.6, p.y + 0.1, p.z + (Math.random() - 0.5) * 0.6,
      v.x * 0.25 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.6, v.z * 0.25 + (Math.random() - 0.5) * 2,
      0.9 + Math.random() * 1.0, 0.35, 2 + Math.random() * 1.5, 0.3 * amount, r, g, b, 1.3, 0.4,
    );
  }

  sparks(p: THREE.Vector3, v: THREE.Vector3, count: number) {
    for (let i = 0; i < count; i++) {
      const heat = 0.6 + Math.random() * 0.4;
      this.hot.spawn(
        p.x + (Math.random() - 0.5) * 0.5, p.y + 0.03, p.z + (Math.random() - 0.5) * 0.5,
        v.x * (0.55 + Math.random() * 0.3) + (Math.random() - 0.5) * 5, 0.5 + Math.random() * 3.5, v.z * (0.55 + Math.random() * 0.3) + (Math.random() - 0.5) * 5,
        0.18 + Math.random() * 0.35, 0.022, 0.012, 1, 14 * heat, 6.5 * heat, 1.6 * heat, 2.2, 9.8, 0.018,
      );
    }
  }

  update(dt: number) {
    this.soft.update(dt);
    this.hot.update(dt);
  }

  clear() {
    this.soft.clear();
    this.hot.clear();
  }
}
