import * as THREE from 'three';
import { designLight, type Design } from './shaders.ts';

/**
 * The light a glass marble lets through: its shadow is not black but tinted by the glass, and
 * the ball, a lens, gathers the sun to a bright point inside it (the caustic).
 *
 * One quad per marble lies on the floor under it, round the shadow the sun casts there, and
 * multiplies what is already drawn: the sun's shadow map has darkened the spot; this puts back the
 * share of the sun that came through the glass, coloured, and concentrated where the lens bends
 * it. How a ball lens spreads the light (by distance behind it, and off its axis) is traced once
 * on the CPU into a little table: rays through a sphere of glass, refracted in and out, the
 * reflections lost at each face, binned into rings.
 *
 * Draw it after the opaque scene (it is transparent) into a float target (the composer's): the
 * factor goes above 1 where the light is focused.
 */

export interface CausticSource {
  pos: THREE.Vector3;
  design: Design;
  /** the ball's radius (m) */
  radius?: number;
}

const IOR = 1.5;
/** the table's reach: off the axis (radii), behind the centre (radii) */
const RHO_MAX = 1.6, T_MAX = 9;
const NR = 64, NT = 96;

/** irradiance behind a glass ball in a parallel beam (1 = the open sun), by (off axis, behind) */
function lensTable() {
  const E = new Float32Array(NR * NT);
  const N = 24000;
  const db = 1 / N;
  for (let k = 0; k < N; k++) {
    const b = (k + 0.5) * db;
    const t1 = Math.asin(b), t2 = Math.asin(b / IOR);
    // (unpolarised Fresnel loss, in and again out)
    const fr = (a: number, c: number) => {
      const rs = Math.sin(a - c) / Math.sin(a + c), rp = Math.tan(a - c) / Math.tan(a + c);
      return 0.5 * (rs * rs + rp * rp);
    };
    const F = b < 1e-4 ? 0.04 : fr(t1, t2);
    const T = (1 - F) * (1 - F);
    // the exit point (polar angle from the beam's axis) and the bend
    const be = 2 * t2 - t1;
    const xe = Math.sin(be), ze = Math.cos(be);
    const dl = 2 * (t1 - t2);
    if (Math.cos(dl) <= 0.02) continue;
    const slope = Math.tan(dl);
    for (let j = 0; j < NT; j++) {
      const tz = ((j + 0.5) / NT) * T_MAX;
      if (tz < ze) continue;
      const rho = Math.abs(xe - slope * (tz - ze));
      const i = Math.floor((rho / RHO_MAX) * NR);
      if (i >= NR) continue;
      E[j * NR + i] += b * db * T;
    }
  }
  // flux per ring → irradiance; softened as the sun's disc (and the glass's flaws) would
  const out = new Float32Array(NR * NT);
  const dr = RHO_MAX / NR;
  for (let j = 0; j < NT; j++) {
    const tz = ((j + 0.5) / NT) * T_MAX;
    const row = new Float32Array(NR);
    for (let i = 0; i < NR; i++) {
      const rc = (i + 0.5) * dr;
      row[i] = E[j * NR + i] / (rc * dr);
    }
    const sig = 0.05 + 0.025 * tz;
    for (let i = 0; i < NR; i++) {
      const ri = (i + 0.5) * dr;
      let s = 0, w = 0;
      for (let m = 0; m < NR; m++) {
        const rm = (m + 0.5) * dr;
        const g = Math.exp(-((ri - rm) ** 2) / (2 * sig * sig)) * rm;
        s += row[m] * g;
        w += g;
      }
      out[j * NR + i] = s / Math.max(w, 1e-9);
    }
  }
  // and along the beam (the floor cuts the cone of light at a slant: no hard ring)
  const sm = new Float32Array(NR * NT);
  const st = 0.22 / (T_MAX / NT);
  for (let j = 0; j < NT; j++)
    for (let i = 0; i < NR; i++) {
      let s = 0, w = 0;
      for (let m = Math.max(0, j - 6); m <= Math.min(NT - 1, j + 6); m++) {
        const g = Math.exp(-((j - m) ** 2) / (2 * st * st));
        s += out[m * NR + i] * g;
        w += g;
      }
      sm[j * NR + i] = Math.min(16, s / w);
    }
  return sm;
}

const VERT = /* glsl */ `
attribute vec4 aBall;
attribute vec4 aTint;
attribute vec4 aScat;
varying vec3 vW;
varying vec4 vBall;
varying vec4 vTint;
varying vec4 vScat;
void main(){
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vBall = aBall;
  vTint = aTint;
  vScat = aScat;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const FRAG = /* glsl */ `
uniform vec3 uSun;
uniform sampler2D uLut;
uniform float uRatio;
uniform float uGain;
varying vec3 vW;
varying vec4 vBall;
varying vec4 vTint;
varying vec4 vScat;
void main(){
  float R = vBall.w;
  vec3 d = vBall.xyz - vW;
  // along the beam from here back to the ball's centre, and how far off its axis
  float t = dot(d, uSun);
  float rho = length(d - uSun * t);
  if (t <= 0.0 || vTint.a <= 0.0) discard;
  vec2 uv = vec2(rho / (R * ${RHO_MAX.toFixed(2)}), t / (R * ${T_MAX.toFixed(1)}));
  if (uv.x >= 1.0 || uv.y >= 1.0) discard;
  float E = texture2D(uLut, vec2(uv.x * ${NR}.0 / ${NR + 1}.0, uv.y)).r;
  // (fading out at the table's far end)
  E *= 1.0 - smoothstep(0.75, 1.0, uv.y);
  // the sun's shadow map has taken the light here (a soft disc); put back what the glass let through
  float V = 1.0 - smoothstep(R * 0.86, R * 1.12, rho);
  // the focused light (the lens, in the glass's tint), and a share scattered by the inside and the
  // glass's flaws across the whole shadow, in the inside's colours
  float disc = 1.0 - smoothstep(R * 0.45, R * 1.0, rho);
  vec3 back = uRatio * uGain * vTint.a * (E * vTint.rgb + vScat.a * disc * vScat.rgb);
  vec3 f = 1.0 + back / (1.0 + uRatio * (1.0 - V));
  gl_FragColor = vec4(f, 1.0);
}
`;

export class Caustics {
  readonly mesh: THREE.InstancedMesh;
  /** lit floor over shadowed floor (sun over sky light): how much light the shadow took */
  ratio = 2.4;
  /** the strength of the effect (0: plain shadows) */
  gain = 1;
  /** the share of the light the glass scatters across its shadow rather than focusing */
  scatter = 0.3;
  private ball: THREE.InstancedBufferAttribute;
  private tint: THREE.InstancedBufferAttribute;
  private scat: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private m = new THREE.Matrix4();
  private tints = new Map<Design, ReturnType<typeof designLight>>();
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private n = new THREE.Vector3();
  private ax = new THREE.Vector3();
  private bx = new THREE.Vector3();
  private c = new THREE.Vector3();
  private L = new THREE.Vector3();

  constructor(readonly max = 48) {
    const lut = lensTable();
    // (a column of zeros past the edge, so the far side fades to nothing)
    const data = new Uint16Array((NR + 1) * NT);
    for (let j = 0; j < NT; j++) for (let i = 0; i < NR; i++) data[j * (NR + 1) + i] = THREE.DataUtils.toHalfFloat(lut[j * NR + i]);
    const tex = new THREE.DataTexture(data, NR + 1, NT, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // per marble: its centre and radius; the focused light's colour (and a fade); the scattered light's
    const inst = () => new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBall', (this.ball = inst()));
    g.setAttribute('aTint', (this.tint = inst()));
    g.setAttribute('aScat', (this.scat = inst()));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uLut: { value: tex }, uRatio: { value: this.ratio }, uGain: { value: this.gain } },
      transparent: true,
      depthWrite: false,
      // (multiplies what is there: dst · src)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }

  /**
   * Each frame: the marbles, the direction to the sun (unit), and the floor finder
   * (the highest surface below a point within `depth`, −Infinity for none). `focus`/`reach`: the
   * patch the sun's shadow map covers (outside it there is no shadow to lighten).
   */
  update(src: readonly CausticSource[], sun: THREE.Vector3, floorBelow: (x: number, y: number, z: number, depth: number) => number, focus?: THREE.Vector3, reach = 30) {
    const L = this.L.copy(sun).normalize();
    (this.mat.uniforms.uSun.value as THREE.Vector3).copy(L);
    this.mat.uniforms.uRatio.value = this.ratio;
    this.mat.uniforms.uGain.value = this.gain;
    let k = 0;
    for (const s of src) {
      if (k >= this.max) break;
      const R = s.radius ?? 0.5;
      const p = s.pos;
      let fade = 1;
      if (focus) {
        const dx = p.x - focus.x, dz = p.z - focus.z;
        fade = 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dz), reach * 0.8, reach);
        if (fade <= 0) continue;
      }
      // the floor under the ball: its height here and a step either way (for its slope)
      const depth = R * 14;
      const y0 = floorBelow(p.x, p.y - R * 0.5, p.z, depth);
      if (!(y0 > -Infinity)) continue;
      const e = R * 0.8;
      let y1 = floorBelow(p.x + e, p.y - R * 0.5, p.z, depth);
      let y2 = floorBelow(p.x, p.y - R * 0.5, p.z + e, depth);
      if (!(y1 > -Infinity) || Math.abs(y1 - y0) > e) y1 = y0;
      if (!(y2 > -Infinity) || Math.abs(y2 - y0) > e) y2 = y0;
      const P0 = this.v0.set(p.x, y0, p.z);
      this.v1.set(e, y1 - y0, 0);
      this.v2.set(0, y2 - y0, e);
      const n = this.n.crossVectors(this.v2, this.v1).normalize();
      if (n.y < 0) n.negate();
      const nl = n.dot(L);
      if (nl < 0.15) continue;
      // the shadow's centre on that plane, straight down the beam from the ball
      const h = this.c.copy(p).sub(P0).dot(n);
      if (h > R * (T_MAX - 1) * nl) continue;
      const C = this.c.copy(p).addScaledVector(L, -h / nl).addScaledVector(n, 0.004);
      // the quad: long along the beam's slant over the floor, as wide as the table reaches
      const ax = this.ax.copy(L).addScaledVector(n, -nl);
      if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0).addScaledVector(n, -n.x);
      ax.normalize();
      const bx = this.bx.crossVectors(ax, n).normalize();
      const w = R * RHO_MAX * 2.1, l = w / nl;
      this.m.makeBasis(ax.multiplyScalar(l), n, bx.multiplyScalar(w));
      this.m.setPosition(C);
      this.mesh.setMatrixAt(k, this.m);
      let t = this.tints.get(s.design);
      if (!t) this.tints.set(s.design, (t = designLight(s.design)));
      this.ball.setXYZW(k, p.x, p.y, p.z, R);
      this.tint.setXYZW(k, t.focus.r * t.through * t.sharp, t.focus.g * t.through * t.sharp, t.focus.b * t.through * t.sharp, fade);
      this.scat.setXYZW(k, t.scatter.r, t.scatter.g, t.scatter.b, this.scatter * t.through * (2 - t.sharp));
      k++;
    }
    this.mesh.count = k;
    if (k) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.ball.needsUpdate = true;
      this.tint.needsUpdate = true;
      this.scat.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    (this.mat.uniforms.uLut.value as THREE.Texture).dispose();
  }
}
