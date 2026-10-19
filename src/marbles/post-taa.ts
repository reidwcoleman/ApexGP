import * as THREE from 'three';
import { Pass } from 'postprocessing';

/**
 * Temporal anti-aliasing for the marble show (after src/core/taa.ts, the racing game's): every frame
 * the projection is shifted by a different sub-pixel offset (Halton 2,3, 8 phases), and this pass
 * blends the new frame into a history of the last ones, reprojected to where each pixel was a frame
 * ago. Over a few frames every pixel averages many sample positions: plank seams far down the chute,
 * trestle legs, bunting strings and the rims of the glass stop crawling, which an edge filter like
 * SMAA can't fix (it can't rebuild what fell between the samples).
 *
 *   reprojection: the pixel's world position from depth (the nearest of the 3 × 3 round it, so an
 *     edge moves with its foreground) carried back through last frame's camera — or, on a marble,
 *     through that marble's own move (the stage tracks the glass marbles' centres): the chase
 *     camera rides with your marble, so to the camera it hardly moves while the world streams by,
 *     and it must stay as sharp and as smooth as the planks.
 *   history: a Catmull-Rom fetch (a bilinear one softens the image a little more every frame).
 *   rejection: the history is clipped to the colour box of the new frame's neighbourhood (mean ±
 *     its spread, in YCoCg), so whatever is no longer there can't ghost: a sweeper arm that moved,
 *     the inside of a marble that turned.
 *   blend: ~10 % of the new frame in a steady view, more for fast motion across the screen; in a
 *     tone-mapped space so a sun glint can't dominate the average.
 * The history starts over on a camera cut.
 */

export const MAX_MARBLES = 32;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
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
uniform vec4 balls[${MAX_MARBLES}];
uniform vec3 ballsMove[${MAX_MARBLES}];
uniform mat3 ballsTurn[${MAX_MARBLES}];
uniform int ballCount;
uniform float reset;

vec3 tmap(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 itmap(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
vec3 ycocg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 rgb(vec3 y) { return vec3(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z); }
vec3 fetch(vec2 uv) {
  vec3 c = texture2D(tColor, uv).rgb;
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  return ycocg(tmap(min(max(c, 0.0), vec3(200.0))));
}
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
vec3 clipBox(vec3 h, vec3 mn, vec3 mx) {
  vec3 c = 0.5 * (mx + mn);
  vec3 e = 0.5 * (mx - mn) + 1e-5;
  vec3 v = h - c;
  vec3 a = abs(v / e);
  float m = max(a.x, max(a.y, a.z));
  return m > 1.0 ? c + v / m : h;
}

void main() {
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), mn = vec3(1e5), mx = vec3(-1e5), cur = vec3(0.0);
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

  float vz = perspectiveDepthToViewZ(dMin, cameraNear, cameraFar);
  vec4 ray = projInv * vec4(dUv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  vec3 wpos = (camWorld * vec4(ray.xyz * (vz / ray.z), 1.0)).xyz;
  // (the sky has no depth to speak of: only the camera's turn moves it)
  if (dMin >= 1.0) wpos = (camWorld * vec4(ray.xyz * (1e4 / -ray.z), 1.0)).xyz;
  vec3 prev = wpos;
  bool onBall = false;
  for (int i = 0; i < ${MAX_MARBLES}; i++) {
    if (i >= ballCount) break;
    vec3 dv = wpos - balls[i].xyz;
    if (dot(dv, dv) < balls[i].w * balls[i].w) { prev = balls[i].xyz - ballsMove[i] + ballsTurn[i] * dv; onBall = true; break; }
  }
  vec4 pc = prevViewProj * vec4(prev, 1.0);
  vec2 vel = pc.w > 1e-5 ? dUv - (pc.xy / pc.w * 0.5 + 0.5) : vec2(0.0);
  vec2 hUv = vUv - vel;
  if (pc.w <= 1e-5 || any(lessThan(hUv, vec2(0.0))) || any(greaterThan(hUv, vec2(1.0)))) {
    gl_FragColor = vec4(itmap(rgb(cur)), 1.0);
    return;
  }
  vec3 hist = ycocg(tmap(history(hUv)));
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  // (a little wider on the turning glass: its insides change every frame, the rim shouldn't fizz)
  float g = onBall ? 1.25 : 1.0;
  hist = clipBox(hist, max(mean - sigma * g, mn), min(mean + sigma * g, mx));
  float px = length(vel * size);
  float a = mix(0.1, 0.28, smoothstep(2.0, 24.0, px));
  gl_FragColor = vec4(itmap(rgb(mix(hist, cur, a))), 1.0);
}
`;

// the hand-on down the chain, with a light sharpen (the history's blend softens a hair; this
// restores it without halos: the result is held inside the neighbours' range)
const COPY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 texel;
uniform float sharpen;
void main() {
  vec3 c = texture2D(tIn, vUv).rgb;
  vec3 n = texture2D(tIn, vUv + vec2(0.0, texel.y)).rgb, s = texture2D(tIn, vUv - vec2(0.0, texel.y)).rgb;
  vec3 e = texture2D(tIn, vUv + vec2(texel.x, 0.0)).rgb, w = texture2D(tIn, vUv - vec2(texel.x, 0.0)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  vec3 r = c + (c - 0.25 * (n + s + e + w)) * sharpen;
  gl_FragColor = vec4(clamp(r, mn, mx), 1.0);
}
`;

/** Halton (2, 3) sub-pixel offsets in pixels, −0.5 … 0.5 (8 phases) */
const JITTER: [number, number][] = (() => {
  const halton = (i: number, b: number) => {
    let f = 1, r = 0;
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
  private phase = 0;
  private saved = new THREE.Matrix4();
  private savedInv = new THREE.Matrix4();
  private prevVP = new THREE.Matrix4();
  private prevPos = new THREE.Vector3();
  private prevFov = 0;
  private prevBalls = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion; seen: number }>();
  private frame = 0;
  private tmp = new THREE.Vector3();
  private tc = new THREE.Vector3();
  private tq = new THREE.Quaternion();
  private tq2 = new THREE.Quaternion();
  private tm = new THREE.Matrix4();

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
        balls: { value: Array.from({ length: MAX_MARBLES }, () => new THREE.Vector4()) },
        ballsMove: { value: Array.from({ length: MAX_MARBLES }, () => new THREE.Vector3()) },
        ballsTurn: { value: Array.from({ length: MAX_MARBLES }, () => new THREE.Matrix3()) },
        ballCount: { value: 0 },
        reset: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tIn: { value: null }, texel: { value: new THREE.Vector2(0.25, 0.25) }, sharpen: { value: 0.35 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMat);
    this.quad.frustumCulled = false;
  }

  /** start the history over with the next frame */
  reset() {
    this.needReset = true;
  }

  /**
   * Before the frame: shift the projection by this frame's sub-pixel offset, note the camera and
   * where each marble (`balls`: their meshes, radius from the geometry) has moved since last frame.
   */
  begin(camera: THREE.PerspectiveCamera, w: number, h: number, balls: THREE.Mesh[]) {
    const u = this.resolveMat.uniforms;
    camera.updateMatrixWorld();
    // a cut: the camera jumped, or zoomed hard
    const pos = this.tmp.setFromMatrixPosition(camera.matrixWorld);
    if (pos.distanceTo(this.prevPos) > 6 || Math.abs(camera.fov - this.prevFov) > 4) this.needReset = true;
    this.prevPos.copy(pos);
    this.prevFov = camera.fov;
    (u.prevViewProj.value as THREE.Matrix4).copy(this.prevVP);
    this.saved.copy(camera.projectionMatrix);
    this.savedInv.copy(camera.projectionMatrixInverse);
    // next frame's "last frame": this one, unjittered
    this.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const [jx, jy] = JITTER[this.phase++ % JITTER.length];
    const e = camera.projectionMatrix.elements;
    e[8] += (jx * 2) / w;
    e[9] += (jy * 2) / h;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    (u.projInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.camWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    // the marbles' moves: where each surface point of a marble was a frame ago, it rolled since
    const bv = u.balls.value as THREE.Vector4[], mv = u.ballsMove.value as THREE.Vector3[], tv = u.ballsTurn.value as THREE.Matrix3[];
    let n = 0;
    this.frame++;
    for (const b of balls) {
      if (n >= MAX_MARBLES) break;
      b.updateWorldMatrix(true, false);
      const c = this.tc.setFromMatrixPosition(b.matrixWorld);
      const q = this.tq2.setFromRotationMatrix(this.tm.extractRotation(b.matrixWorld));
      const g = b.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r = g.boundingSphere!.radius * b.matrixWorld.getMaxScaleOnAxis() * 1.04;
      let was = this.prevBalls.get(b);
      bv[n].set(c.x, c.y, c.z, r);
      if (was) {
        mv[n].copy(c).sub(was.p);
        // (the turn since last frame: last frame's rotation times the inverse of this one)
        this.tq.copy(q).invert().premultiply(was.q);
        tv[n].setFromMatrix4(this.tm.makeRotationFromQuaternion(this.tq));
      } else {
        mv[n].set(0, 0, 0);
        tv[n].identity();
        was = { p: new THREE.Vector3(), q: new THREE.Quaternion(), seen: 0 };
        this.prevBalls.set(b, was);
      }
      was.p.copy(c);
      was.q.copy(q);
      was.seen = this.frame;
      n++;
    }
    // (forget the marbles gone from the scene)
    if (this.frame % 120 === 0) for (const [k, v] of this.prevBalls) if (v.seen !== this.frame) this.prevBalls.delete(k);
    u.ballCount.value = n;
  }

  /** after the frame: the unjittered projection back */
  end(camera: THREE.PerspectiveCamera) {
    camera.projectionMatrix.copy(this.saved);
    camera.projectionMatrixInverse.copy(this.savedInv);
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, width), h = Math.max(1, height);
    if (w === this.rtA.width && h === this.rtA.height) return;
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    (this.resolveMat.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.copyMat.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
    (this.resolveMat.uniforms.size.value as THREE.Vector2).set(w, h);
    this.needReset = true;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget) {
    if (inputBuffer.width !== this.rtA.width || inputBuffer.height !== this.rtA.height) this.setSize(inputBuffer.width, inputBuffer.height);
    const u = this.resolveMat.uniforms;
    u.tColor.value = inputBuffer.texture;
    u.tHistory.value = this.rtB.texture;
    u.tDepth.value = this.depth;
    u.reset.value = this.needReset || !this.depth ? 1 : 0;
    this.needReset = false;
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
