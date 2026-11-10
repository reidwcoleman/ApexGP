// Bluebird: snow particles. Ski spray, the plume off a snow gun, the rooster tail behind a sled, the
// cloud from a wipeout. One pooled point cloud.
import * as THREE from 'three';

const N = 6000;

export class Fx {
  points: THREE.Points;
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private max = new Float32Array(N);
  private size = new Float32Array(N);
  private alpha = new Float32Array(N);
  private grav = new Float32Array(N).fill(4.5);
  private head = 0;
  private uni = { uNight: { value: 0 }, uScale: { value: 1 } };

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni,
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aAlpha; gl_PointSize = min(220.0, aSize * uScale / 140.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uNight; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.97, 0.98, 1.0) * (1.0 - uNight * 0.35), a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, spread: number, n: number, life = 0.9, size = 60, grav = 4.5) {
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % N;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.4; this.pos[i * 3 + 1] = y + Math.random() * 0.2; this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * spread; this.vel[i * 3 + 1] = vy + Math.random() * spread * 0.6; this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.max[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.size[i] = size * (0.5 + Math.random());
      this.grav[i] = grav;
    }
  }

  update(dt: number, night: number, h: number, fov = 55) {
    this.uni.uNight.value = night;
    this.uni.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = this.life[i] / this.max[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const d = Math.exp(-dt * 2.2);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] *= d; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.max(0, t) * Math.min(1, (1 - t) * 6) * 0.6;
      this.size[i] *= 1 + dt * 0.55;
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aSize').needsUpdate = true;
    g.getAttribute('aAlpha').needsUpdate = true;
  }
}
