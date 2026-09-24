import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/**
 * Renderer + post chain.
 *
 *   RenderPass (HDR, half float)
 *   → N8AO (screen-space AO, world-radius; ultra)
 *   → sanitize (NaN/Inf scrub)
 *   → speed blur (radial, only while fast)      [own pass: convolution]
 *   → depth of field (menus/replays only)        [own pass: convolution]
 *   → lens rain (onboard cameras in the wet)     [own pass: convolution]
 *   → sun shafts → bloom → grade (game layer × weather look × lightning flash)
 *     → ACES → vignette → grain
 *   → chromatic aberration (only while fast)     [own pass: convolution]
 *   → SMAA
 *
 * renderer.toneMapping stays NoToneMapping: tone mapping happens in the
 * composer, after bloom, so highlights bloom in linear HDR.
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

const RADIAL_BLUR_FRAG = /* glsl */ `
uniform float strength;
uniform vec2 center;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = uv - center;
  float d = length(dir * vec2(aspect, 1.0));
  float amt = strength * smoothstep(0.12, 0.85, d);
  if (amt < 0.0005) { outputColor = inputColor; return; }
  vec3 acc = inputColor.rgb;
  float w = 1.0;
  for (int i = 1; i < 12; i++) {
    float t = float(i) / 11.0;
    float wi = 1.0 - t * 0.5;
    acc += texture2D(inputBuffer, uv - dir * amt * t).rgb * wi;
    w += wi;
  }
  outputColor = vec4(acc / w, inputColor.a);
}
`;

class RadialBlurEffect extends Effect {
  constructor() {
    super('RadialBlurEffect', RADIAL_BLUR_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(0)],
        ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.52))],
      ]),
    });
  }
  get strength() {
    return this.uniforms.get('strength')!.value as number;
  }
  set strength(v: number) {
    this.uniforms.get('strength')!.value = v;
  }
}

// One NaN/Inf pixel (a degenerate normal, a divide by zero in some shader) is
// enough for bloom's blur chain to black out the whole frame. Scrub them first.
const SANITIZE_FRAG = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  bvec3 bad = bvec3(c.r != c.r || abs(c.r) > 1e6, c.g != c.g || abs(c.g) > 1e6, c.b != c.b || abs(c.b) > 1e6);
  if (any(bad)) c = vec3(0.0);
  outputColor = vec4(min(max(c, 0.0), vec3(200.0)), inputColor.a);
}
`;

class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', SANITIZE_FRAG, { blendFunction: BlendFunction.SET });
  }
}

/**
 * Water on the lens: sitting droplets that refract an inverted, miniature image
 * of the scene (and appear/evaporate), plus drops blown outward across the lens
 * with trails as the car goes faster. `amount` 0 … 1, `speed` 0 … 1.
 */
const LENS_RAIN_FRAG = /* glsl */ `
uniform float amount;
uniform float speed;
uniform float time;

float lr_h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 lr_h31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}

// a drop: xy = where to sample the scene (uv offset), z = coverage, w = 0 centre … 1 rim
// sitting drops: an inverted, shrunk image of what is behind them; they bead, sit and evaporate
vec4 lr_static(vec2 uv, float scale, float seed, float density) {
  vec2 g = uv * vec2(aspect, 1.0) * scale;
  vec2 id = floor(g);
  vec2 st = fract(g) - 0.5;
  vec3 n = lr_h31(id.x * 71.3 + id.y * 1117.9 + seed);
  float life = fract(time * (0.04 + 0.07 * n.z) + n.x * 7.0);
  float alive = step(1.0 - density, n.y);
  float r = mix(0.1, 0.32, n.z * n.z) * smoothstep(0.0, 0.05, life) * smoothstep(1.0, 0.75, life);
  vec2 c = (n.xy - 0.5) * (0.8 - 2.0 * r);
  vec2 d = st - c;
  // drops sag a little
  d.y *= 1.0 + 0.25 * sign(d.y);
  float dist = length(d);
  float m = smoothstep(r, r * 0.8, dist) * alive;
  if (m <= 0.0) return vec4(0.0);
  vec2 centreUV = (id + 0.5 + c) / scale / vec2(aspect, 1.0);
  vec2 rel = (uv - centreUV);
  vec2 target = centreUV - rel * 2.4 + vec2(0.0, 0.03);
  return vec4(target - uv, m, clamp(dist / max(r, 1e-4), 0.0, 1.0));
}

// drops blown outward across the lens at speed (polar grid moving in log-radius), with a
// wet trail behind them
vec4 lr_stream(vec2 uv, float seed) {
  vec2 q = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
  float r = length(q);
  if (r < 0.06) return vec4(0.0);
  float ang = atan(q.y, q.x);
  float lanes = 40.0;
  float a = ang / 6.2831853 * lanes;
  float lr = log(r) * 7.0 - time * (1.5 + 14.0 * speed);
  vec2 g = vec2(a, lr);
  vec2 id = floor(g);
  vec2 st = fract(g) - 0.5;
  vec3 n = lr_h31(id.x * 13.7 + id.y * 311.1 + seed);
  float alive = step(1.0 - (0.3 + 0.45 * amount) * min(1.0, speed * 1.6), n.z);
  float x = st.x - (n.x - 0.5) * 0.45;
  float along = st.y - (n.y - 0.5) * 0.3;
  float hd = length(vec2(x * 1.25, along * 0.9));
  float head = smoothstep(0.22, 0.15, hd);
  // trail behind the head (toward the centre), thinning out
  float tw = mix(0.07, 0.025, clamp(-along * 2.0, 0.0, 1.0));
  float trail = smoothstep(tw, tw * 0.4, abs(x)) * smoothstep(-0.5, -0.05, along) * step(along, 0.0) * 0.7;
  float m = max(head, trail) * alive * smoothstep(0.06, 0.22, r);
  if (m <= 0.0) return vec4(0.0);
  vec2 dir = q / r;
  vec2 tang = vec2(-dir.y, dir.x);
  vec2 off = (-dir * along * 0.05 - tang * x * 0.06) * (head > trail ? 1.0 : 0.5);
  return vec4(off / vec2(aspect, 1.0), m, head > trail ? clamp(hd / 0.22, 0.0, 1.0) : 0.6);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 a = lr_static(uv, 6.0, 1.0, 0.2 + 0.55 * amount);
  vec4 b = lr_static(uv + 0.37, 11.0, 7.0, 0.2 + 0.6 * amount);
  vec4 c = lr_static(uv + 0.71, 21.0, 13.0, 0.35 * amount);
  vec4 s = speed > 0.02 ? lr_stream(uv, 3.0) : vec4(0.0);
  // the airflow wipes sitting drops away at speed
  float keep = 1.0 - 0.75 * speed;
  vec4 best = vec4(a.xy, a.z * keep, a.w);
  if (b.z * keep > best.z) best = vec4(b.xy, b.z * keep, b.w);
  if (c.z * keep > best.z) best = vec4(c.xy, c.z * keep, c.w);
  if (s.z > best.z) best = s;
  float m = best.z * min(1.0, amount * 1.4);
  vec3 col = inputColor.rgb;
  // a thin film of water softens the image in heavy rain
  if (amount > 0.3) {
    vec2 px = vec2(1.5 / 1920.0 * aspect, 1.5 / 1080.0) * amount;
    vec3 soft = (texture2D(inputBuffer, uv + px).rgb + texture2D(inputBuffer, uv - px).rgb
               + texture2D(inputBuffer, uv + vec2(px.x, -px.y)).rgb + texture2D(inputBuffer, uv + vec2(-px.x, px.y)).rgb) * 0.25;
    col = mix(col, soft, (amount - 0.3) * 0.6);
  }
  if (m > 0.001) {
    vec2 tuv = clamp(uv + best.xy, 0.001, 0.999);
    vec3 refr = (texture2D(inputBuffer, tuv).rgb * 2.0
               + texture2D(inputBuffer, clamp(tuv + vec2(0.002, 0.0), 0.001, 0.999)).rgb
               + texture2D(inputBuffer, clamp(tuv - vec2(0.0, 0.002), 0.001, 0.999)).rgb) * 0.25;
    // dark refracting rim, slightly brighter lensing core
    float rim = smoothstep(0.55, 1.0, best.w);
    refr *= (1.0 - 0.55 * rim) * 1.08;
    col = mix(col, refr, m);
  }
  outputColor = vec4(col, inputColor.a);
}
`;

class LensRainEffect extends Effect {
  constructor() {
    super('LensRainEffect', LENS_RAIN_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['amount', new THREE.Uniform(0)],
        ['speed', new THREE.Uniform(0)],
        ['time', new THREE.Uniform(0)],
      ]),
    });
  }
  override update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt: number) {
    this.uniforms.get('time')!.value += dt ?? 0.016;
  }
}

/**
 * Sun shafts (god rays): a quarter-resolution mask of bright sky near the sun
 * (depth = far plane), blurred radially toward the sun's screen position in two
 * passes, then added to the HDR image before bloom. Trees and grandstands cut
 * the light into beams at golden hour.
 */
const SHAFT_MASK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 sunUv;
uniform float aspect;
uniform float threshold;
void main() {
  vec2 px = vec2( dFdx( vUv.x ), dFdy( vUv.y ) ) * 0.5;
  float sky = 0.0;
  vec3 c = vec3( 0.0 );
  for ( int i = 0; i < 4; i++ ) {
    vec2 o = vec2( i == 1 || i == 3 ? px.x : -px.x, i >= 2 ? px.y : -px.y );
    float d = texture2D( tDepth, vUv + o ).r;
    float s = step( 0.99999, d );
    sky += s;
    c += texture2D( tColor, vUv + o ).rgb * s;
  }
  c *= 0.25;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec2 dv = ( vUv - sunUv ) * vec2( aspect, 1.0 );
  float lobe = exp( -dot( dv, dv ) * 5.0 );
  float k = smoothstep( threshold, threshold * 3.0, l );
  gl_FragColor = vec4( min( c, vec3( 30.0 ) ) * k * lobe, 1.0 );
}
`;

const SHAFT_BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 sunUv;
uniform float stepScale;
void main() {
  vec2 d = ( sunUv - vUv ) * stepScale / 24.0;
  vec2 uv = vUv;
  vec3 acc = vec3( 0.0 );
  float w = 1.0;
  float wsum = 0.0;
  for ( int i = 0; i < 24; i++ ) {
    acc += texture2D( tIn, uv ).rgb * w;
    wsum += w;
    w *= 0.955;
    uv += d;
  }
  gl_FragColor = vec4( acc / wsum, 1.0 );
}
`;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

class SunShaftsEffect extends Effect {
  private depth: THREE.Texture | null = null;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private maskMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly sunUv = new THREE.Vector2(0.5, 0.5);
  strength = 0;
  active = false;

  constructor() {
    super('SunShaftsEffect', /* glsl */ `
      uniform sampler2D tShafts;
      uniform float shaftStrength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb + texture2D(tShafts, uv).rgb * shaftStrength, inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tShafts', new THREE.Uniform(null)],
        ['shaftStrength', new THREE.Uniform(0)],
      ]),
    });
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.maskMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: SHAFT_MASK_FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        sunUv: { value: this.sunUv },
        aspect: { value: 1 },
        threshold: { value: 1.2 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: SHAFT_BLUR_FRAG,
      uniforms: { tIn: { value: null }, sunUv: { value: this.sunUv }, stepScale: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMat);
    this.quad.frustumCulled = false;
    this.uniforms.get('tShafts')!.value = this.rtB.texture;
  }
  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }
  override setSize(width: number, height: number) {
    const w = Math.max(4, Math.round(width / 4));
    const h = Math.max(4, Math.round(height / 4));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.maskMat.uniforms.aspect.value = width / Math.max(1, height);
  }
  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    const on = this.active && this.strength > 0.002 && this.depth !== null;
    this.uniforms.get('shaftStrength')!.value = on ? this.strength : 0;
    if (!on) return;
    const prev = renderer.getRenderTarget();
    this.maskMat.uniforms.tColor.value = inputBuffer.texture;
    this.maskMat.uniforms.tDepth.value = this.depth;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tIn.value = this.rtA.texture;
    this.blurMat.uniforms.stepScale.value = 0.55;
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.quad, this.cam);
    this.blurMat.uniforms.tIn.value = this.rtB.texture;
    this.blurMat.uniforms.stepScale.value = 0.18;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    // final result lives in rtA → swap so the effect reads it
    this.uniforms.get('tShafts')!.value = this.rtA.texture;
    renderer.setRenderTarget(prev);
  }
  set threshold(v: number) {
    this.maskMat.uniforms.threshold.value = v;
  }
}

const GRADE_FRAG = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform vec3 tint;
uniform vec3 shadowTint;
uniform float lookExposure;
uniform float lookSaturation;
uniform float lookContrast;
uniform vec3 lookTint;
uniform vec3 lookShadowTint;
uniform float flash;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0) * exposure * lookExposure * (1.0 + flash);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split toning: shadows toward shadowTint, highlights toward tint
  float hl = smoothstep(0.02, 0.6, l);
  c *= mix(shadowTint * lookShadowTint, tint * lookTint, hl);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation * lookSaturation);
  c = pow(max(c, 0.0) / 0.18, vec3(contrast * lookContrast)) * 0.18;
  outputColor = vec4(c, inputColor.a);
}
`;

export interface GradeLook {
  exposure: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  shadowTint: [number, number, number];
}

/**
 * Colour grade with two multiplied layers: `set()` is the game's layer
 * (flashback desaturation, menus, dev pages), `setLook()` is the weather/time
 * look written by the Environment every frame. `flash` brightens everything
 * for a lightning strike.
 */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['lookExposure', new THREE.Uniform(1)],
        ['lookSaturation', new THREE.Uniform(1.05)],
        ['lookContrast', new THREE.Uniform(1.04)],
        ['lookTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['lookShadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['flash', new THREE.Uniform(0)],
      ]),
    });
  }
  set(opts: { exposure?: number; saturation?: number; contrast?: number; tint?: THREE.ColorRepresentation; shadowTint?: THREE.ColorRepresentation }) {
    const u = this.uniforms;
    if (opts.exposure !== undefined) u.get('exposure')!.value = opts.exposure;
    if (opts.saturation !== undefined) u.get('saturation')!.value = opts.saturation;
    if (opts.contrast !== undefined) u.get('contrast')!.value = opts.contrast;
    if (opts.tint !== undefined) {
      const c = new THREE.Color(opts.tint);
      (u.get('tint')!.value as THREE.Vector3).set(c.r, c.g, c.b);
    }
    if (opts.shadowTint !== undefined) {
      const c = new THREE.Color(opts.shadowTint);
      (u.get('shadowTint')!.value as THREE.Vector3).set(c.r, c.g, c.b);
    }
  }
  /** the weather/time-of-day layer (tints are linear RGB multipliers) */
  setLook(l: GradeLook) {
    const u = this.uniforms;
    u.get('lookExposure')!.value = l.exposure;
    u.get('lookSaturation')!.value = l.saturation;
    u.get('lookContrast')!.value = l.contrast;
    (u.get('lookTint')!.value as THREE.Vector3).set(...l.tint);
    (u.get('lookShadowTint')!.value as THREE.Vector3).set(...l.shadowTint);
  }
  set flash(v: number) {
    this.uniforms.get('flash')!.value = v;
  }
  get exposure() {
    return this.uniforms.get('exposure')!.value as number;
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly ao: N8AOPostPass;
  readonly bloom: BloomEffect;
  readonly grade: GradeEffect;
  readonly toneMapping: ToneMappingEffect;
  readonly vignette: VignetteEffect;
  readonly grain: NoiseEffect;
  readonly aberration: ChromaticAberrationEffect;
  readonly dof: DepthOfFieldEffect;

  private readonly radial: RadialBlurEffect;
  private readonly radialPass: EffectPass;
  private readonly caPass: EffectPass;
  private readonly dofPass: EffectPass;
  private readonly lensRain: LensRainEffect;
  private readonly lensPass: EffectPass;
  private readonly shafts: SunShaftsEffect;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private quality: QualityLevel = 'high';
  private renderScale = 1;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private sunShaftStrength = 0;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: QualityLevel = 'high') {
    this.scene = scene;
    this.camera = camera;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      logarithmicDepthBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    this.ao.configuration.aoRadius = 1.6;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.intensity = 2.6;
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.depthAwareUpsampling = true;
    this.ao.configuration.color = new THREE.Color(0x0a0a0c);
    this.ao.setQualityMode('Medium');
    this.composer.addPass(this.ao);
    this.composer.addPass(new EffectPass(camera, new SanitizeEffect()));

    this.radial = new RadialBlurEffect();
    this.radialPass = new EffectPass(camera, this.radial);
    this.radialPass.enabled = false;
    this.composer.addPass(this.radialPass);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 5, bokehScale: 2.5, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.lensRain = new LensRainEffect();
    this.lensPass = new EffectPass(camera, this.lensRain);
    this.lensPass.enabled = false;
    this.composer.addPass(this.lensPass);

    this.shafts = new SunShaftsEffect();
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.1,
      luminanceSmoothing: 0.35,
      intensity: 0.9,
      radius: 0.72,
    });
    this.grade = new GradeEffect();
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ darkness: 0.38, offset: 0.3 });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.grain.blendMode.opacity.value = 0.05;
    this.composer.addPass(new EffectPass(camera, this.shafts, this.bloom, this.grade, this.toneMapping, this.vignette, this.grain));

    this.aberration = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.4,
    });
    this.caPass = new EffectPass(camera, this.aberration);
    this.caPass.enabled = false;
    this.composer.addPass(this.caPass);

    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

    this.setQuality(quality);
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    for (const p of this.composer.passes) {
      (p as unknown as { mainCamera: THREE.Camera }).mainCamera = camera;
    }
    this.ao.camera = camera;
    this.renderPass.mainCamera = camera;
    this.resize();
  }

  setScene(scene: THREE.Scene) {
    this.scene = scene;
    for (const p of this.composer.passes) {
      (p as unknown as { mainScene: THREE.Scene }).mainScene = scene;
    }
    this.ao.scene = scene;
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderScale = { low: Math.min(dpr, 1) * 0.75, medium: Math.min(dpr, 1), high: Math.min(dpr, 1.25), ultra: Math.min(dpr, 1.75) }[q];
    // AO costs a fixed ~3 ms at 1080p whatever its tier, so it is an Ultra feature
    this.ao.enabled = q === 'ultra';
    this.ao.configuration.halfRes = true;
    this.ao.setQualityMode('Medium');
    this.renderer.shadowMap.enabled = true;
    this.shafts.active = q !== 'low';
    this.dynamicScale = 1;
    this.resize();
  }

  /**
   * Dynamic resolution: the game nudges this down when frames run long and
   * back up when there's headroom. Multiplies the preset's pixel ratio.
   */
  dynamicScale = 1;
  setDynamicScale(s: number) {
    const v = THREE.MathUtils.clamp(s, 0.55, 1);
    if (Math.abs(v - this.dynamicScale) < 0.001) return;
    this.dynamicScale = v;
    this.resize();
  }

  get qualityLevel() {
    return this.quality;
  }

  /** 0 → off. ~0.02 is a strong blur. */
  setSpeedBlur(strength: number) {
    this.radialPass.enabled = strength > 0.0008;
    this.radial.strength = strength;
  }

  setAberration(offset: number) {
    const on = offset > 0.00003;
    this.caPass.enabled = on;
    if (on) this.aberration.offset.set(offset, offset * 0.7);
  }

  /**
   * Water on the lens for onboard cameras: 0 = dry … 1 = soaked. `speed` 0 … 1
   * makes the drops stream outward (defaults to following `amount`).
   */
  setLensRain(amount: number, speed?: number) {
    const a = THREE.MathUtils.clamp(amount, 0, 1);
    this.lensPass.enabled = a > 0.01;
    this.lensRain.uniforms.get('amount')!.value = a;
    this.lensRain.uniforms.get('speed')!.value = THREE.MathUtils.clamp(speed ?? a, 0, 1);
  }

  /** lightning: 0 … 1 exposure punch for this frame */
  setFlash(intensity: number) {
    this.grade.flash = Math.max(0, intensity) * 1.6;
  }
  /** alias of setFlash */
  flash(intensity: number) {
    this.setFlash(intensity);
  }

  /** sun shafts: world direction toward the sun, strength (0 = off), sky-brightness threshold */
  setSunShafts(dir: THREE.Vector3, strength: number, threshold = 1.2) {
    this.sunDir.copy(dir).normalize();
    this.sunShaftStrength = strength;
    this.shafts.threshold = threshold;
  }

  /** Bokeh DOF for menus/replays. With a target the focus follows it (autofocus). */
  setDepthOfField(on: boolean, target: THREE.Vector3 | null = null, range = 5, bokeh = 2.5) {
    this.dofPass.enabled = on;
    this.dof.target = on ? target : null;
    if (on) {
      (this.dof.cocMaterial as unknown as { focusRange: number }).focusRange = range;
      this.dof.bokehScale = bokeh;
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.renderScale * this.dynamicScale);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateShafts() {
    let k = 0;
    if (this.sunShaftStrength > 0.002) {
      const cam = this.camera;
      const p = this.tmpV.copy(this.sunDir).multiplyScalar(1000).add(cam.position);
      p.project(cam);
      // behind the camera?
      const fwd = cam.getWorldDirection(this.tmpF);
      const facing = fwd.dot(this.sunDir);
      if (facing > 0.05) {
        const u = p.x * 0.5 + 0.5;
        const v = p.y * 0.5 + 0.5;
        this.shafts.sunUv.set(u, v);
        const off = Math.max(Math.abs(p.x), Math.abs(p.y));
        k = this.sunShaftStrength * THREE.MathUtils.smoothstep(1.9, 1.0, off) * THREE.MathUtils.smoothstep(0.05, 0.35, facing);
      }
    }
    this.shafts.strength = k;
  }

  render(dt: number) {
    this.renderer.info.reset();
    this.updateShafts();
    this.composer.render(dt);
  }
}
