import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { MOTION_CARS, WHEEL_BOX_GLSL, wheelUniforms } from './motionBlur';

/**
 * Temporal anti-aliasing (High/Ultra), as Unreal Engine 4 — and so ACC — does it: every frame the
 * projection is shifted by a different sub-pixel offset (Halton 2,3, 8 phases: Renderer.render), and
 * this pass blends the new frame into a history of the previous ones, reprojected to where each
 * pixel was a frame ago. Over a few frames every pixel averages many sample positions — a fence's
 * wires, a kerb's stripes, a thin wing flap or a far car's halo stop crawling and flickering the way
 * they do with a single sample per pixel (which SMAA, a post-process edge filter, can only smooth
 * where it finds an edge; it can't rebuild what fell between the samples).
 *
 *   reprojection: the pixel's world position from depth (this frame's jittered projection) is
 *     carried back through last frame's camera — or, inside the box of a tracked car (the cars the
 *     motion blur tracks: the one you ride in and the nearest), through that car's own motion —
 *     so the cockpit stays put while the kerbs stream past, and a car alongside stays sharp. The
 *     depth is the nearest of the 3 × 3 round the pixel, so an edge moves with its foreground.
 *   history: a Catmull-Rom fetch (a bilinear one blurs the image a little more every frame).
 *   rejection: the history is clipped to the colour box of the new frame's 3 × 3 neighbourhood
 *     (mean ± its spread, in YCoCg; Salvi's variance clipping), so whatever is no longer there — the
 *     road behind a car that moved, a disoccluded barrier, smoke that drifted — can't ghost.
 *   blend: ~9 % of the new frame in steady view, more as things move fast across the screen (they
 *     are smeared by the motion blur anyway, and a quick blend keeps them from trailing); colours
 *     are weighted in a tone-mapped space so a sun glint or a lamp can't dominate the average
 *     (Karis, "High Quality Temporal Supersampling", 2014). Sparks and flames (additive, no depth)
 *     are let through nearly as drawn — UE4's "responsive AA" for particles.
 *
 * The history starts over on a camera cut, a jump, a resize or a new scene.
 */

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const RESOLVE_FRAG = /* glsl */ `
#include <packing>
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform vec2 size;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projInv;
uniform mat4 camWorld;
uniform mat4 prevViewProj;
uniform mat4 carInv[${MOTION_CARS}];
uniform mat4 carPrev[${MOTION_CARS}];
uniform int carCount;
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform float reset;
${WHEEL_BOX_GLSL}

// tone-mapped working space (and back): bright texels count as ~1, not as 50
vec3 tmap(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itmap(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
vec3 ycocg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 rgb(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
vec3 fetch(vec2 uv) {
  vec3 c = texture2D(tColor, uv).rgb;
  // (one NaN or Inf in the history would never leave it)
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  return ycocg(tmap(min(max(c, 0.0), vec3(200.0))));
}

// Catmull-Rom history fetch from 5 bilinear taps (the 4 corner taps' weights are tiny: dropped)
vec3 history(vec2 uv) {
  vec2 sp = uv * size;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc0 = (t1 - 1.0) * texel;
  vec2 tc3 = (t1 + 2.0) * texel;
  vec2 tc12 = (t1 + w2 / w12) * texel;
  vec3 r = texture2D(tHistory, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
         + texture2D(tHistory, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
         + texture2D(tHistory, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
         + texture2D(tHistory, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
         + texture2D(tHistory, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, 0.0);
}

// clip a point toward the box centre until it lies inside the box (not a per-axis clamp: that
// shifts the colour's hue)
vec3 clipBox(vec3 h, vec3 mn, vec3 mx) {
  vec3 c = 0.5 * (mx + mn);
  vec3 e = 0.5 * (mx - mn) + 1e-5;
  vec3 v = h - c;
  vec3 a = abs(v / e);
  float m = max(a.x, max(a.y, a.z));
  return m > 1.0 ? c + v / m : h;
}

void main() {
  // the 3 × 3 neighbourhood of the new frame: its colour statistics and its nearest depth
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  vec3 mn = vec3(1e5);
  vec3 mx = vec3(-1e5);
  vec3 cur = vec3(0.0);
  float dMin = 1.0;
  vec2 dUv = vUv;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * texel;
      vec3 s = fetch(vUv + o);
      if (x == 0 && y == 0) cur = s;
      m1 += s;
      m2 += s * s;
      mn = min(mn, s);
      mx = max(mx, s);
      float d = texture2D(tDepth, vUv + o).r;
      if (d < dMin) { dMin = d; dUv = vUv + o; }
    }
  }
  if (reset > 0.5) { gl_FragColor = vec4(itmap(rgb(cur)), 1.0); return; }

  // where the nearest surface round about was a frame ago
  float vz = perspectiveDepthToViewZ(dMin, cameraNear, cameraFar);
  vec4 ray = projInv * vec4(dUv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  vec3 wpos = (camWorld * vec4(ray.xyz * (vz / ray.z), 1.0)).xyz;
  vec3 prev = wpos;
  vec3 wl;
  // the steering wheel turns inside its car: back through its own last frame
  if (onWheel(wpos, wl)) prev = (wheelPrev * vec4(wl, 1.0)).xyz;
  else
  for (int i = 0; i < ${MOTION_CARS}; i++) {
    if (i >= carCount) break;
    vec3 l = (carInv[i] * vec4(wpos, 1.0)).xyz;
    if (all(greaterThan(l, boxMin)) && all(lessThan(l, boxMax))) {
      prev = (carPrev[i] * vec4(l, 1.0)).xyz;
      break;
    }
  }
  vec4 pc = prevViewProj * vec4(prev, 1.0);
  vec2 vel = pc.w > 1e-5 ? dUv - (pc.xy / pc.w * 0.5 + 0.5) : vec2(0.0);
  vec2 hUv = vUv - vel;
  if (pc.w <= 1e-5 || any(lessThan(hUv, vec2(0.0))) || any(greaterThan(hUv, vec2(1.0)))) {
    gl_FragColor = vec4(itmap(rgb(cur)), 1.0);
    return;
  }

  vec3 hist = ycocg(tmap(history(hUv)));
  // variance clipping (γ = 1), inside the neighbourhood's min / max
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  vec3 bMin = max(mean - sigma, mn);
  vec3 bMax = min(mean + sigma, mx);
  hist = clipBox(hist, bMin, bMax);

  // the new frame's share: ~9 % in a steady view, up to a quarter for fast motion across the screen
  float px = length(vel * size);
  float a = mix(0.09, 0.25, smoothstep(2.0, 24.0, px));
  // additive particles (sparks, flames, glows: Particles.ts's hot pool) leave the frame's alpha above
  // 1 (an additive blend's alpha adds up on a half-float target): they fly on their own paths with no
  // depth to reproject them by, so they pass nearly as drawn instead of being averaged to a trace.
  // The steering wheel's screen marks itself the same way (CarModel patchDash): its digits change
  // 15 times a second, and the history kept the last readings ghosting under the new one
  float hot = clamp(texture2D(tColor, vUv).a - 1.0, 0.0, 1.0);
  a = mix(a, 0.75, hot);
  vec3 res = mix(hist, cur, a);
  gl_FragColor = vec4(itmap(rgb(res)), 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
void main() { gl_FragColor = texture2D(tIn, vUv); }
`;

/** Halton (2, 3) sub-pixel offsets in pixels, −0.5 … 0.5 (8 phases) */
export const TAA_JITTER: [number, number][] = (() => {
  const halton = (i: number, b: number) => {
    let f = 1;
    let r = 0;
    while (i > 0) {
      f /= b;
      r += f * (i % b);
      i = Math.floor(i / b);
    }
    return r;
  };
  return Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5] as [number, number]);
})();

export class TAAPass extends Pass {
  private depth: THREE.Texture | null = null;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readonly resolveMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private needReset = true;

  constructor() {
    super('TAAPass');
    this.needsDepthTexture = true;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.resolveMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: RESOLVE_FRAG,
      uniforms: {
        tColor: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        texel: { value: new THREE.Vector2(0.25, 0.25) },
        size: { value: new THREE.Vector2(4, 4) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        projInv: { value: new THREE.Matrix4() },
        camWorld: { value: new THREE.Matrix4() },
        prevViewProj: { value: new THREE.Matrix4() },
        carInv: { value: Array.from({ length: MOTION_CARS }, () => new THREE.Matrix4()) },
        carPrev: { value: Array.from({ length: MOTION_CARS }, () => new THREE.Matrix4()) },
        carCount: { value: 0 },
        // (the motion blur's car box: motionBlur.ts)
        boxMin: { value: new THREE.Vector3(-1.15, 0.06, -2.85) },
        boxMax: { value: new THREE.Vector3(1.15, 1.45, 2.95) },
        ...wheelUniforms(),
        reset: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: COPY_FRAG, uniforms: { tIn: { value: null } }, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMat);
    this.quad.frustumCulled = false;
  }

  /** the reprojection's uniforms (camera, last frame's view-projection, tracked cars): written by the Renderer */
  get uniforms() {
    return this.resolveMat.uniforms;
  }

  /** start the history over with the next frame (a cut, a jump, a new scene) */
  reset() {
    this.needReset = true;
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (w === this.rtA.width && h === this.rtA.height) return;
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    (this.resolveMat.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.resolveMat.uniforms.size.value as THREE.Vector2).set(w, h);
    this.needReset = true;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget) {
    // (the composer's buffers follow the frame size; ours must too)
    if (inputBuffer.width !== this.rtA.width || inputBuffer.height !== this.rtA.height) this.setSize(inputBuffer.width, inputBuffer.height);
    const u = this.resolveMat.uniforms;
    u.tColor.value = inputBuffer.texture;
    u.tHistory.value = this.rtB.texture;
    u.tDepth.value = this.depth;
    u.reset.value = this.needReset || !this.depth ? 1 : 0;
    this.needReset = false;
    // resolve into the new history, then hand a copy on down the chain (the composer's buffers are
    // overwritten by the passes after this one)
    this.quad.material = this.resolveMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    this.copyMat.uniforms.tIn.value = this.rtA.texture;
    this.quad.material = this.copyMat;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.quad, this.cam);
    const t = this.rtA;
    this.rtA = this.rtB;
    this.rtB = t;
  }

  override dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.resolveMat.dispose();
    this.copyMat.dispose();
    this.quad.geometry.dispose();
  }
}
