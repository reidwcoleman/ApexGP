import * as THREE from 'three';
import { BloomEffect, BlendFunction, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { TAAPass } from '../../marbles/post-taa.ts';

/**
 * The camera: HDR render → contact AO (where walls meet pavement, under cars and awnings) →
 * temporal AA (window grids, railings and palm fronds stop crawling) → bloom (sun glints, neon,
 * headlights) → AgX → a warm coastal grade, a lens's falloff and a little grain.
 */
class GradeEffect extends Effect {
  constructor() {
    super(
      'PalmeraGrade',
      /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      float gh( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
        vec3 c = inputColor.rgb;
        float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        // warm highlights, teal shadows (less of both at night, where the lamps already do it)
        float k = 1.0 - uNight * 0.6;
        c += ( vec3( 1.0, 0.92, 0.8 ) - 1.0 ) * 0.28 * k * smoothstep( 0.4, 1.0, l );
        c += ( vec3( 0.84, 0.97, 1.04 ) - 1.0 ) * 0.3 * k * ( 1.0 - smoothstep( 0.0, 0.45, l ) );
        c = mix( vec3( l ), c, 1.12 );
        c = ( c - 0.5 ) * 1.06 + 0.5;
        float g = gh( uv * vec2( 1931.0, 1171.0 ) + fract( uTime * 13.7 ) * 97.0 ) - 0.5;
        c += g * 0.01;
        outputColor = vec4( clamp( c, 0.0, 1.0 ), inputColor.a );
      }`,
      { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uTime', new THREE.Uniform(0)], ['uNight', new THREE.Uniform(0)]]) },
    );
  }
  set(t: number, night: number) {
    this.uniforms.get('uTime')!.value = t;
    this.uniforms.get('uNight')!.value = night;
  }
}

class ExposureEffect extends Effect {
  constructor() {
    super('PalmeraExposure', /* glsl */ `
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
  readonly grade = new GradeEffect();
  readonly bloom: BloomEffect;
  private readonly size = new THREE.Vector2();

  constructor(readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera) {
    const c = (this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    c.addPass(new RenderPass(scene, camera));
    const ao = (this.ao = new N8AOPostPass(scene, camera, 1, 1));
    ao.configuration.aoRadius = 1.6;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.2;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x0b0a09);
    ao.setQualityMode('Performance');
    (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    c.addPass(ao);
    c.addPass((this.taa = new TAAPass()));
    this.bloom = new BloomEffect({ mipmapBlur: true, levels: 6, luminanceThreshold: 2.2, luminanceSmoothing: 0.6, intensity: 0.45, radius: 0.6 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    c.addPass(new EffectPass(camera, this.exposure, this.bloom, tone, this.grade, new VignetteEffect({ darkness: 0.34, offset: 0.3 })));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(t: number, night: number, exposure: number) {
    this.grade.set(t, night);
    this.exposure.value = exposure;
    this.camera.updateMatrixWorld();
    this.renderer.getDrawingBufferSize(this.size);
    this.taa.begin(this.camera, this.size.x, this.size.y, []);
    this.composer.render();
    this.taa.end(this.camera);
  }

  /** a camera cut: drop the history so nothing ghosts */
  reset() {
    this.taa.reset();
  }
}
