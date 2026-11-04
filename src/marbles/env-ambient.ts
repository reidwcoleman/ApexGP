import * as THREE from 'three';
import type { BiomeId } from './biome.ts';

/**
 * What hangs in the air of each world, in a box that follows the camera: petals, snow, embers,
 * bubbles, confetti, dust motes, fireflies. One draw, all of it moved in the vertex shader.
 */

interface Look {
  /** a colour for each third of the specks */
  c: [number, number, number];
  /** drift (m/s), how far it wanders, its size, how many of them (0..1) */
  v: [number, number, number];
  sway: number;
  size: number;
  n: number;
  /** 0 a soft dot, 1 a petal or a leaf, 2 a ring (a bubble) */
  shape: number;
  /** it lights itself (embers, fireflies): added on, not painted over */
  glow: boolean;
  /** twinkles */
  blink: number;
}

const LOOKS: Record<BiomeId, Look> = {
  candy: { c: [0xffffff, 0xffc8e0, 0xc8f0ff], v: [0.2, 0.25, 0.1], sway: 0.8, size: 0.09, n: 0.45, shape: 0, glow: true, blink: 1 },
  beach: { c: [0xffffff, 0xfff0d0, 0xd0f0ff], v: [0.9, 0.1, 0.3], sway: 0.5, size: 0.05, n: 0.35, shape: 0, glow: false, blink: 0 },
  volcano: { c: [0xff7a20, 0xffc040, 0xff4010], v: [0.4, 2.4, 0.2], sway: 1, size: 0.09, n: 0.9, shape: 0, glow: true, blink: 1 },
  arctic: { c: [0xffffff, 0xe0f0ff, 0xffffff], v: [0.5, -1.7, 0.2], sway: 1.1, size: 0.11, n: 1, shape: 0, glow: false, blink: 0 },
  jungle: { c: [0xc8ff60, 0xffe860, 0x80ffb0], v: [0.05, 0.12, 0.05], sway: 1.8, size: 0.08, n: 0.6, shape: 0, glow: true, blink: 1 },
  space: { c: [0xc8d8ff, 0xffffff, 0xe0c0ff], v: [0.1, 0.05, 0.15], sway: 0.4, size: 0.06, n: 0.7, shape: 0, glow: true, blink: 1 },
  spooky: { c: [0x90ff90, 0xc0a0ff, 0xffb060], v: [0.1, 0.2, 0.05], sway: 1.6, size: 0.08, n: 0.6, shape: 0, glow: true, blink: 1 },
  neon: { c: [0xff40c0, 0x40e0ff, 0xffe040], v: [0, 0.8, 0], sway: 0.3, size: 0.06, n: 0.7, shape: 0, glow: true, blink: 1 },
  desert: { c: [0xe8c088, 0xd8a868, 0xf0d8a8], v: [2.8, 0.2, 0.8], sway: 0.5, size: 0.06, n: 0.8, shape: 0, glow: false, blink: 0 },
  autumn: { c: [0xe87020, 0xd8a020, 0xc04020], v: [0.8, -1.1, 0.3], sway: 1.8, size: 0.2, n: 0.7, shape: 1, glow: false, blink: 0 },
  sunset: { c: [0xffe0a0, 0xffc080, 0xffffff], v: [0.3, 0.2, 0.1], sway: 1, size: 0.07, n: 0.45, shape: 0, glow: true, blink: 1 },
  royal: { c: [0xffe070, 0xffffff, 0xffc030], v: [0.05, -0.4, 0.05], sway: 0.8, size: 0.07, n: 0.6, shape: 0, glow: true, blink: 1 },
  blossom: { c: [0xffb8d4, 0xffd8e8, 0xff9ac0], v: [0.9, -0.9, 0.4], sway: 1.8, size: 0.17, n: 1, shape: 1, glow: false, blink: 0 },
  storm: { c: [0xc0d0e8, 0xa0b0c8, 0xffffff], v: [2.2, -0.4, 1], sway: 0.6, size: 0.05, n: 0.5, shape: 0, glow: false, blink: 0 },
  reef: { c: [0xe0ffff, 0xc0f0ff, 0xffffff], v: [0.05, 1.1, 0.05], sway: 0.7, size: 0.16, n: 0.6, shape: 2, glow: false, blink: 0 },
  clockwork: { c: [0xffd080, 0xffa040, 0xfff0c0], v: [0.2, 0.5, 0.1], sway: 0.7, size: 0.06, n: 0.6, shape: 0, glow: true, blink: 1 },
  disco: { c: [0xff3a8a, 0x2fa8ff, 0xffd21f], v: [0.1, -0.5, 0.1], sway: 0.9, size: 0.1, n: 0.9, shape: 0, glow: true, blink: 1 },
  circus: { c: [0xe8283a, 0xffc21f, 0x2f8cff], v: [0.25, -0.95, 0.15], sway: 1.6, size: 0.16, n: 0.7, shape: 1, glow: false, blink: 0 },
  pirate: { c: [0xffffff, 0xe0f8ff, 0xfff0d0], v: [1.3, 0.25, 0.4], sway: 0.6, size: 0.05, n: 0.45, shape: 0, glow: false, blink: 0 },
  toybox: { c: [0xffffff, 0xd8f0ff, 0xffe0f0], v: [0.15, 0.7, 0.1], sway: 1, size: 0.22, n: 0.55, shape: 2, glow: false, blink: 0 },
};

const COUNT = 700;
const BOX = 44;

export class Ambient {
  readonly points: THREE.Points;
  private u = {
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uVel: { value: new THREE.Vector3() },
    uSway: { value: 1 },
    uSize: { value: 0.1 },
    uH: { value: 720 },
    uShape: { value: 0 },
    uBlink: { value: 0 },
    uGlow: { value: 0 },
    uC0: { value: new THREE.Color() },
    uC1: { value: new THREE.Color() },
    uC2: { value: new THREE.Color() },
  };
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(COUNT * 3), r = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      p[i * 3] = Math.random() * BOX;
      p[i * 3 + 1] = Math.random() * BOX;
      p[i * 3 + 2] = Math.random() * BOX;
      r[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(r, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aRnd;
        uniform vec3 uCam, uVel, uC0, uC1, uC2;
        uniform float uTime, uSway, uSize, uH, uBlink;
        varying vec3 vC;
        varying float vA;
        varying float vR;
        void main() {
          float B = ${BOX.toFixed(1)};
          float ph = aRnd * 6.283;
          vec3 p = position + uVel * uTime * (0.7 + 0.6 * aRnd);
          p += uSway * vec3(sin(uTime * 0.7 + ph * 3.0), 0.5 * sin(uTime * 0.9 + ph * 5.0), cos(uTime * 0.6 + ph * 2.0));
          // (wrapped into a box round the camera)
          p = mod(p - uCam + 0.5 * B, B) - 0.5 * B;
          float edge = 1.0 - smoothstep(0.32 * B, 0.5 * B, length(p));
          p += uCam;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float near = smoothstep(0.6, 2.6, -mv.z);
          gl_PointSize = clamp(uSize * (0.6 + 0.8 * aRnd) * uH / max(0.5, -mv.z), 1.0, 48.0);
          float tw = mix(1.0, 0.55 + 0.45 * sin(uTime * (2.0 + 3.0 * aRnd) + ph * 7.0), uBlink);
          vA = edge * near * tw;
          vC = aRnd < 0.34 ? uC0 : aRnd < 0.67 ? uC1 : uC2;
          vR = uTime * (0.5 + aRnd) + ph;
        }`,
      fragmentShader: `
        uniform float uShape, uGlow;
        varying vec3 vC;
        varying float vA;
        varying float vR;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a;
          if (uShape < 0.5) a = smoothstep(0.5, 0.12, length(q));
          else if (uShape < 1.5) {
            // a petal, turning as it falls
            float c = cos(vR), s = sin(vR);
            vec2 w = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
            a = smoothstep(0.5, 0.42, length(w * vec2(1.0, 2.0 + 1.2 * sin(vR * 1.7))));
          } else {
            float l = length(q);
            a = smoothstep(0.5, 0.45, l) * (0.22 + 0.7 * smoothstep(0.3, 0.46, l)) + 0.5 * smoothstep(0.1, 0.0, length(q + vec2(0.16, 0.16)));
          }
          a *= vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC * (1.0 + uGlow * 1.2), a * (uGlow > 0.5 ? 0.85 : 0.8));
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  set(id: BiomeId) {
    const L = LOOKS[id] ?? LOOKS.candy, u = this.u;
    u.uC0.value.set(L.c[0]);
    u.uC1.value.set(L.c[1]);
    u.uC2.value.set(L.c[2]);
    u.uVel.value.set(...L.v);
    u.uSway.value = L.sway;
    u.uSize.value = L.size;
    u.uShape.value = L.shape;
    u.uBlink.value = L.blink;
    u.uGlow.value = L.glow ? 1 : 0;
    this.mat.blending = L.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.points.geometry.setDrawRange(0, Math.round(COUNT * L.n));
  }

  update(t: number, cam: THREE.Camera, h: number) {
    this.u.uTime.value = t;
    this.u.uCam.value.copy(cam.position);
    this.u.uH.value = h;
  }
}
