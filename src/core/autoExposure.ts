import * as THREE from 'three';

/**
 * A camera's auto exposure, on the GPU (nothing is read back): the frame's centre-weighted log
 * luminance is metered into a tiny target every frame, and two running averages of it are kept in a
 * 1×1 feedback target — the exposure the camera has adapted to (fast: ~½ s to stop down when it gets
 * brighter, ~1 s to open up into the dark) and a slow reference (~10 s). The grade multiplies the
 * picture by (reference / adapted)^strength, clamped: in steady conditions the two agree and the
 * picture is exactly as the lighting grade sets it (the weather/time-of-day exposure, the night,
 * the wet), but going under a bridge or the trees the image opens up a little a beat late, and
 * coming back out into the sun it is briefly over-exposed before it settles — as onboard footage
 * does. A camera cut snaps both averages to the new view.
 */

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const METER_W = 32;
const METER_H = 16;

// frame → METER_W × METER_H texels of (weighted log luminance, weight)
const METER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 cell;   // one meter texel's size in uv
void main() {
  float acc = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture2D(tIn, vUv + vec2(float(x), float(y)) * cell * 0.33).rgb;
      if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
      float l = dot(clamp(c, 0.0, 200.0), vec3(0.2126, 0.7152, 0.0722));
      acc += log(max(l, 1e-4));
    }
  }
  // centre-weighted: the middle of the frame counts most, the top band (sky) and the corners least
  vec2 d = (vUv - vec2(0.5, 0.45)) * vec2(1.0, 1.4);
  float w = exp(-dot(d, d) * 5.0) + 0.15;
  gl_FragColor = vec4(acc / 9.0 * w, w, 0.0, 1.0);
}
`;

// (adapted, reference) log luminance, eased toward this frame's
const ADAPT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMeter;
uniform sampler2D tPrev;
uniform float dt;
uniform float reset;
void main() {
  // the whole meter, summed (one fragment: ${METER_W * METER_H} texels)
  vec2 s = vec2(0.0);
  for (int y = 0; y < ${METER_H}; y++) {
    for (int x = 0; x < ${METER_W}; x++) {
      s += texture2D(tMeter, (vec2(float(x), float(y)) + 0.5) / vec2(${METER_W}.0, ${METER_H}.0)).xy;
    }
  }
  float cur = s.x / max(s.y, 1e-4);
  vec2 prev = texture2D(tPrev, vec2(0.5)).xy;
  if (reset > 0.5 || prev.x != prev.x || prev.y != prev.y) { gl_FragColor = vec4(cur, cur, 0.0, 1.0); return; }
  // stopping down for a brighter view is quicker than opening up for a darker one
  float tau = cur > prev.x ? 0.45 : 0.9;
  float a = prev.x + (cur - prev.x) * (1.0 - exp(-dt / tau));
  float r = prev.y + (cur - prev.y) * (1.0 - exp(-dt / 10.0));
  gl_FragColor = vec4(a, r, 0.0, 1.0);
}
`;


export class AutoExposure {
  private readonly rtMeter: THREE.WebGLRenderTarget;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private readonly meterMat: THREE.ShaderMaterial;
  private readonly adaptMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private needReset = true;

  constructor() {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.rtMeter = new THREE.WebGLRenderTarget(METER_W, METER_H, opts);
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.meterMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: METER_FRAG,
      uniforms: { tIn: { value: null }, cell: { value: new THREE.Vector2(1 / METER_W, 1 / METER_H) } },
      depthTest: false,
      depthWrite: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: ADAPT_FRAG,
      uniforms: { tMeter: { value: this.rtMeter.texture }, tPrev: { value: null }, dt: { value: 0.016 }, reset: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.meterMat);
    this.quad.frustumCulled = false;
  }

  /** the 1×1 texture holding (adapted, reference) log luminance */
  get texture(): THREE.Texture {
    return this.rtA.texture;
  }

  /** snap to the next frame's view (a camera cut, a new scene) */
  reset() {
    this.needReset = true;
  }

  private skip = 0;
  private pendingDt = 0;
  update(renderer: THREE.WebGLRenderer, input: THREE.Texture, dt: number) {
    // (metered every other frame: the averages move over half a second and more anyway)
    this.pendingDt += dt;
    if (!this.needReset && (this.skip++ & 1) === 1) return;
    const prev = renderer.getRenderTarget();
    const q = this.quad;
    q.material = this.meterMat;
    this.meterMat.uniforms.tIn.value = input;
    renderer.setRenderTarget(this.rtMeter);
    renderer.render(q, this.cam);
    q.material = this.adaptMat;
    const au = this.adaptMat.uniforms;
    au.tPrev.value = this.rtA.texture;
    au.dt.value = Math.min(0.1, Math.max(0, this.pendingDt));
    this.pendingDt = 0;
    au.reset.value = this.needReset ? 1 : 0;
    this.needReset = false;
    renderer.setRenderTarget(this.rtB);
    renderer.render(q, this.cam);
    const t = this.rtA;
    this.rtA = this.rtB;
    this.rtB = t;
    renderer.setRenderTarget(prev);
  }

  dispose() {
    for (const rt of [this.rtMeter, this.rtA, this.rtB]) rt.dispose();
    this.meterMat.dispose();
    this.adaptMat.dispose();
    this.quad.geometry.dispose();
  }
}
