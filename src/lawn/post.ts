/**
 * The picture's last steps: depth AO, a soft bloom, neutral tone mapping, a light vignette and
 * film grain, then SMAA; MSAA on the scene buffer (thin blades need it). An adaptive governor
 * trades resolution and effects for frame rate.
 */
import * as THREE from 'three';
import { BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, NoiseEffect, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, BlendFunction } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export interface Quality {
  /** resolution scale (× the device pixel ratio, capped at 2) */
  scale: number;
  ao: boolean;
  dof: boolean;
  /** grass density multiplier */
  grass: number;
  shadow: number;
}

export class Post {
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass;
  readonly dof: DepthOfFieldEffect;
  private readonly bloom: BloomEffect;
  private readonly tm: ToneMappingEffect;
  private readonly dofPass: EffectPass;
  readonly q: Quality;
  private warm = 0;
  private frames = 0;
  private acc = 0;
  private baseDpr: number;
  private w = 1;
  private h = 1;
  /** called when the governor changes something that isn't ours (grass density, shadow size) */
  onChange: (q: Quality) => void = () => {};

  constructor(readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera) {
    const qs = new URLSearchParams(location.search);
    this.baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    const msaa = qs.has('nomsaa') ? 0 : 4;
    this.q = { scale: qs.has('lowres') ? 0.7 : 1, ao: !qs.has('noao'), dof: qs.has('dof'), grass: 1, shadow: 4096 };
    const c = (this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: msaa }));
    c.addPass(new RenderPass(scene, camera));
    const ao = (this.ao = new N8AOPostPass(scene, camera, 1, 1));
    ao.configuration.aoRadius = 0.7;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 2.0;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x0c1408);
    ao.setQualityMode('Medium');
    ao.enabled = this.q.ao;
    c.addPass(ao);
    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 10, focusRange: 9, bokehScale: 2.0, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = this.q.dof;
    c.addPass(this.dofPass);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.9, luminanceSmoothing: 0.5, intensity: 0.55, radius: 0.75 });
    const tmq = qs.get('tm');
    this.tm = new ToneMappingEffect({ mode: tmq === 'agx' ? ToneMappingMode.AGX : tmq === 'aces' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.NEUTRAL });
    const vig = new VignetteEffect({ darkness: 0.38, offset: 0.3 });
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    grain.blendMode.opacity.value = 0.12;
    c.addPass(new EffectPass(camera, this.bloom, this.tm, vig, grain));
    c.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  /** Focus the lens on a point (the mower); the blur ramps up beyond `range` metres of it. */
  focus(target: THREE.Vector3 | null, range = 9) {
    this.dof.target = target;
    (this.dof.cocMaterial as unknown as { focusRange: number }).focusRange = range;
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.applyScale();
  }
  private applyScale() {
    this.renderer.setPixelRatio(this.baseDpr * this.q.scale);
    this.renderer.setSize(this.w, this.h, false);
    this.composer.setSize(this.w, this.h);
  }

  setEnabled(opts: { ao?: boolean; dof?: boolean }) {
    if (opts.ao !== undefined) {
      this.q.ao = opts.ao;
      this.ao.enabled = opts.ao;
    }
    if (opts.dof !== undefined) {
      this.q.dof = opts.dof;
      this.dofPass.enabled = opts.dof;
    }
  }

  /** Every frame: a gentle governor on frame time. */
  govern(dt: number) {
    // (the first few seconds are shader compiles and texture uploads: not a verdict on the machine)
    if (this.warm < 240) {
      this.warm++;
      return;
    }
    this.acc += dt;
    if (++this.frames < 80) return;
    const ms = (this.acc / this.frames) * 1000;
    this.frames = 0;
    this.acc = 0;
    const q = this.q;
    let changed = false;
    if (ms > 22) {
      if (q.dof) {
        this.setEnabled({ dof: false });
        changed = true;
      } else if (q.ao) {
        this.setEnabled({ ao: false });
        changed = true;
      } else if (q.scale > 0.65) {
        q.scale = Math.max(0.65, q.scale - 0.1);
        this.applyScale();
        changed = true;
      } else if (q.grass > 0.5) {
        q.grass -= 0.15;
        changed = true;
      }
    }
    if (changed) this.onChange(q);
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
