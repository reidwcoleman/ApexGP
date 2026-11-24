import * as THREE from 'three';
import { BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect, BlendFunction } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { TAAPass } from '../marbles/post-taa.ts';

/**
 * The camera: HDR render → contact AO (N8AO, the bake holds the large-scale occlusion) → temporal AA
 * (alpha-tested fronds and thin frames stop crawling) → bloom (sun glints, neon) → AgX → grade:
 * a touch of warmth in the highlights, teal in the shadows, a lens's falloff and fine grain.
 */
class GradeEffect extends Effect {
  constructor() {
    super(
      'OdGrade',
      /* glsl */ `
      uniform float uTime;
      float gh( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
        vec3 c = inputColor.rgb;
        float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        // split tone
        c += ( vec3( 1.0, 0.93, 0.82 ) - 1.0 ) * 0.22 * smoothstep( 0.45, 1.0, l );
        c += ( vec3( 0.86, 0.97, 1.02 ) - 1.0 ) * 0.25 * ( 1.0 - smoothstep( 0.0, 0.4, l ) );
        // a little more saturation in the mids (Miami)
        c = mix( vec3( l ), c, 1.08 );
        // contrast around the mid grey
        c = ( c - 0.5 ) * 1.04 + 0.5;
        // grain
        float g = gh( uv * vec2( 1931.0, 1171.0 ) + fract( uTime * 13.7 ) * 97.0 ) - 0.5;
        c += g * 0.018;
        outputColor = vec4( clamp( c, 0.0, 1.0 ), inputColor.a );
      }`,
      { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uTime', new THREE.Uniform(0)]]) },
    );
  }
  set time(t: number) {
    this.uniforms.get('uTime')!.value = t;
  }
}

class ExposureEffect extends Effect {
  constructor() {
    super('OdExposure', /* glsl */ `
      uniform float uExposure;
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) { outputColor = vec4( inputColor.rgb * uExposure, inputColor.a ); }`,
      { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uExposure', new THREE.Uniform(1)]]) });
  }
  set value(v: number) {
    this.uniforms.get('uExposure')!.value = v;
  }
}

export class Post {
  readonly exposure = new ExposureEffect();
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass;
  readonly taa: TAAPass;
  readonly tone: ToneMappingEffect;
  readonly grade = new GradeEffect();
  readonly bloom: BloomEffect;
  private readonly size = new THREE.Vector2();

  constructor(readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera) {
    const c = (this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    c.addPass(new RenderPass(scene, camera));
    const ao = (this.ao = new N8AOPostPass(scene, camera, 1, 1));
    ao.configuration.aoRadius = 0.9;
    ao.configuration.distanceFalloff = 0.7;
    ao.configuration.intensity = 1.8;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x0b0a09);
    ao.setQualityMode('Performance');
    (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    c.addPass(ao);
    c.addPass((this.taa = new TAAPass()));
    this.bloom = new BloomEffect({ mipmapBlur: true, levels: 6, luminanceThreshold: 4.5, luminanceSmoothing: 0.8, intensity: 0.3, radius: 0.55 });
    const tm = new URLSearchParams(location.search).get('tm');
    this.tone = new ToneMappingEffect({ mode: tm === 'agx' ? ToneMappingMode.AGX : tm === 'aces' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.NEUTRAL });
    c.addPass(new EffectPass(camera, this.exposure, this.bloom, this.tone, this.grade, new VignetteEffect({ darkness: 0.32, offset: 0.32 })));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(t: number) {
    this.grade.time = t;
    this.renderer.getDrawingBufferSize(this.size);
    this.taa.begin(this.camera, this.size.x, this.size.y, []);
    this.composer.render();
    this.taa.end(this.camera);
  }

  reset() {
    this.taa.reset();
  }
}
