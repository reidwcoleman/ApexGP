import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, HueSaturationEffect, BrightnessContrastEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { high, pixelRatio } from './quality.js';

export function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
  r.setPixelRatio(pixelRatio());
  r.setSize(window.innerWidth, window.innerHeight, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.NoToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

// A cinematic post stack: AO for contact depth, gentle bloom, film grade, SMAA.
export function createComposer(renderer, scene, camera, o = {}) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  let ao = null;
  if (o.ao !== false && high()) {
    ao = new N8AOPostPass(scene, camera, 1, 1);
    ao.configuration.aoRadius = o.aoRadius ?? 1.2;
    ao.configuration.distanceFalloff = o.aoFalloff ?? 1.0;
    ao.configuration.intensity = o.aoIntensity ?? 2.2;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x0c0906);
    ao.setQualityMode('Medium');
    composer.addPass(ao);
  }
  const bloom = new BloomEffect({ intensity: o.bloom ?? 0.45, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grade = new HueSaturationEffect({ saturation: o.saturation ?? 0.08 });
  const bc = new BrightnessContrastEffect({ contrast: o.contrast ?? 0.06, brightness: 0.0 });
  const vig = new VignetteEffect({ offset: 0.32, darkness: o.vignette ?? 0.5 });
  composer.addPass(new EffectPass(camera, bloom, tone, grade, bc, vig));
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  composer.ao = ao;
  return composer;
}
