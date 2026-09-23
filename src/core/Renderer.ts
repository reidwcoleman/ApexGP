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
 *   → N8AO (screen-space AO, world-radius)
 *   → speed blur (radial, only while fast)      [own pass: convolution]
 *   → depth of field (menus/replays only)        [own pass: convolution]
 *   → bloom → grade (exposure/sat/contrast/tint) → ACES → vignette → grain
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

const GRADE_FRAG = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform vec3 tint;
uniform vec3 shadowTint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0) * exposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split toning: shadows toward shadowTint, highlights toward tint
  float hl = smoothstep(0.02, 0.6, l);
  c *= mix(shadowTint, tint, hl);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = pow(max(c, 0.0) / 0.18, vec3(contrast)) * 0.18;
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1.05)],
        ['contrast', new THREE.Uniform(1.04)],
        ['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
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
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private quality: QualityLevel = 'high';
  private renderScale = 1;

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

    this.radial = new RadialBlurEffect();
    this.radialPass = new EffectPass(camera, this.radial);
    this.radialPass.enabled = false;
    this.composer.addPass(this.radialPass);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 5, bokehScale: 2.5, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

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
    this.composer.addPass(new EffectPass(camera, this.bloom, this.grade, this.toneMapping, this.vignette, this.grain));

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
    this.renderScale = { low: Math.min(dpr, 1) * 0.75, medium: Math.min(dpr, 1.25), high: Math.min(dpr, 1.5), ultra: Math.min(dpr, 2) }[q];
    // AO costs a fixed ~3 ms at 1080p whatever its tier, so it is an Ultra feature
    this.ao.enabled = q === 'ultra';
    this.ao.configuration.halfRes = true;
    this.ao.setQualityMode('Medium');
    this.renderer.shadowMap.enabled = true;
    this.dynamicScale = 1;
    this.resize();
  }

  /**
   * Dynamic resolution: the game nudges this down when frames run long and
   * back up when there's headroom. Multiplies the preset's pixel ratio.
   */
  dynamicScale = 1;
  setDynamicScale(s: number) {
    const v = THREE.MathUtils.clamp(s, 0.6, 1);
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

  render(dt: number) {
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
