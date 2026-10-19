import * as THREE from 'three';
import { NOISE } from './shaders.ts';

/**
 * Cumulus banks drifting round the course, at its height and below it over the paint.
 *
 * Each bank is a heap of puffs; each puff is a camera-facing card that draws a ball of cloud: a
 * soft disc eaten away at the rim by noise (the cauliflower edge), shaded as if it were a sphere —
 * white and warm where it faces the sun, cool lilac-grey underneath — with a flat base (cumulus
 * float on a level: the condensation height), and a bright silver lining where the edge is thin and
 * the sun is behind it. The cards are drawn back to front (re-sorted when the camera moves), with
 * premultiplied alpha, so the heaps overlap like real cloud rather than like stickers; the air
 * (env-air.ts) fades the far banks into the sky.
 */

const V = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec2 iSeed;
varying vec2 vUv;
varying vec3 vWp;
varying float vSeed;
varying float vBase;
varying float vSize;
#include <fog_pars_vertex>
void main(){
  vec4 wc = modelMatrix * vec4(iPos, 1.0);
  vec4 mvPosition = viewMatrix * wc;
  mvPosition.xy += position.xy * iSize;
  vUv = position.xy;
  vWp = cameraPosition + mvPosition.xyz * mat3(viewMatrix);
  vSeed = iSeed.x;
  vBase = (modelMatrix * vec4(0.0, iSeed.y, 0.0, 1.0)).y;
  vSize = iSize.y;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const F = (sun: THREE.Vector3) => /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vWp;
varying float vSeed;
varying float vBase;
varying float vSize;
#include <fog_pars_fragment>
${NOISE}
const vec3 CL_SUN = normalize(vec3(${sun.x.toFixed(4)}, ${sun.y.toFixed(4)}, ${sun.z.toFixed(4)}));
void main(){
  vec2 uv = vUv;
  float r2 = dot(uv, uv);
  if (r2 > 1.0) discard;
  float n = mfbm(vec3(uv * 1.7 + vSeed * 17.0, uTime * 0.02 + vSeed * 3.0));
  float n2 = mvn(vec3(uv * 6.0 + vSeed * 31.0, uTime * 0.04));
  float d = (1.0 - r2) - (n - 0.5) * 0.95 - (n2 - 0.5) * 0.18;
  float a = smoothstep(0.02, 0.42, d);
  // the flat base
  a *= smoothstep(vBase - 0.5, vBase + vSize * 0.22, vWp.y);
  if (a < 0.003) discard;
  // a sphere's normal (bulging toward the viewer), roughened by the same noise
  vec3 Nv = normalize(vec3(uv * 1.15 + (vec2(n, n2) - 0.5) * 0.5, sqrt(max(1.0 - r2, 0.0)) + 0.2));
  vec3 Nw = Nv * mat3(viewMatrix);
  float diff = dot(Nw, CL_SUN) * 0.5 + 0.5;
  // (the higher in the heap, the more sky it sees)
  float hk = smoothstep(vBase, vBase + vSize * 2.2, vWp.y);
  vec3 lit = vec3(1.0, 0.975, 0.94) * 1.32;
  vec3 shade = vec3(0.60, 0.66, 0.90);
  vec3 col = mix(shade, lit, clamp(diff * (0.5 + 0.55 * hk) + 0.12 * hk, 0.0, 1.0));
  // the silver lining: thin edges, brightest with the sun behind the cloud
  vec3 Vd = normalize(vWp - cameraPosition);
  float fwd = pow(max(dot(Vd, CL_SUN), 0.0), 3.0);
  float edge = 1.0 - smoothstep(0.02, 0.3, d);
  col += vec3(1.0, 0.88, 0.70) * edge * (0.18 + fwd * 1.6);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}
`;

export class Clouds {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private size: Float32Array;
  private seed: Float32Array;
  private src: { p: THREE.Vector3; s: [number, number]; d: [number, number] }[] = [];
  private order: number[] = [];
  private dist: Float32Array;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private local = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  readonly uniforms: { uTime: { value: number } };

  constructor(sun: THREE.Vector3, seed = 3) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const add = (p: THREE.Vector3, w: number, h: number, base: number) => this.src.push({ p, s: [w, h], d: [rnd(), base] });
    // banks: elongated heaps, the biggest puffs in the middle and on top
    const bank = (cx: number, cz: number, base: number, size: number) => {
      const len = size * (1.6 + rnd() * 1.4);
      const n = 7 + Math.floor(rnd() * 8);
      const ang = rnd() * Math.PI;
      const ax = Math.cos(ang), az = Math.sin(ang);
      for (let j = 0; j < n; j++) {
        const u = (rnd() * 2 - 1) * len * 0.5;
        const mid = 1 - Math.abs(u) / (len * 0.5 + 1e-3);
        const r = size * (0.45 + 0.55 * mid) * (0.75 + rnd() * 0.45);
        const side = (rnd() - 0.5) * size * 0.7;
        const y = base + r * 0.55 + mid * size * 0.35 * rnd();
        add(new THREE.Vector3(cx + ax * u - az * side, y, cz + az * u + ax * side), r * 1.25, r * 1.1, base);
      }
      // (a cap or two on top: the towering part)
      const caps = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < caps; j++) {
        const u = (rnd() - 0.5) * len * 0.35;
        const r = size * (0.55 + rnd() * 0.3);
        add(new THREE.Vector3(cx + ax * u, base + size * (0.9 + rnd() * 0.5), cz + az * u), r * 1.2, r * 1.1, base);
      }
    };
    // around the course, at its height and lower over the paint
    for (let k = 0; k < 34; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 210 + rnd() * 900;
      bank(Math.cos(a) * r, Math.sin(a) * r, 12 + rnd() * 70, 14 + rnd() * 20 + r * 0.012);
    }
    // a few high and far, big
    for (let k = 0; k < 10; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 900 + rnd() * 900;
      bank(Math.cos(a) * r, Math.sin(a) * r, 140 + rnd() * 160, 45 + rnd() * 30);
    }
    const N = this.src.length;
    this.pos = new Float32Array(N * 3);
    this.size = new Float32Array(N * 2);
    this.seed = new Float32Array(N * 2);
    this.dist = new Float32Array(N);
    this.order = Array.from({ length: N }, (_, i) => i);
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(2, 2);
    g.index = q.index;
    g.setAttribute('position', q.getAttribute('position'));
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(this.seed, 2).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = N;
    this.uniforms = { uTime: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: V,
      fragmentShader: F(sun),
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uniforms]),
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      fog: true,
    });
    // (merge clones: keep our time uniform the live one)
    m.uniforms.uTime = this.uniforms.uTime;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.write();
  }

  private write() {
    const o = this.order;
    for (let i = 0; i < o.length; i++) {
      const c = this.src[o[i]];
      this.pos[i * 3] = c.p.x;
      this.pos[i * 3 + 1] = c.p.y;
      this.pos[i * 3 + 2] = c.p.z;
      this.size[i * 2] = c.s[0];
      this.size[i * 2 + 1] = c.s[1];
      this.seed[i * 2] = c.d[0];
      this.seed[i * 2 + 1] = c.d[1];
    }
    const g = this.mesh.geometry;
    for (const k of ['iPos', 'iSize', 'iSeed']) (g.getAttribute(k) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  /** the drift, and back-to-front order whenever the camera has moved a few metres */
  update(t: number, camera: THREE.Camera) {
    this.uniforms.uTime.value = t;
    this.mesh.updateWorldMatrix(true, false);
    this.local.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inv.copy(this.mesh.matrixWorld).invert());
    if (this.local.distanceToSquared(this.lastCam) < 16) return;
    this.lastCam.copy(this.local);
    for (let i = 0; i < this.src.length; i++) this.dist[i] = this.src[i].p.distanceToSquared(this.local);
    this.order.sort((a, b) => this.dist[b] - this.dist[a]);
    this.write();
  }
}
