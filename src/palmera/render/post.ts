import * as THREE from 'three';
import { BloomEffect, BlendFunction, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
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

/**
 * Light shafts: from each pixel march toward the sun on screen and count the open sky (depth at the
 * far plane) along the way; sunlight is added in proportion, so rays fan out through palm fronds and
 * between towers. Strongest with a low sun in front of you.
 */
class ShaftsEffect extends Effect {
  constructor() {
    super(
      'PalmeraShafts',
      /* glsl */ `
      uniform vec2 uSun;
      uniform vec3 uSunCol;
      uniform float uStrength;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        if (uStrength <= 0.001) { outputColor = inputColor; return; }
        vec2 d = uSun - uv;
        const int N = 28;
        vec2 st = d / float(N) * 0.9;
        float j = fract(sin(dot(uv * 931.7, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 p = uv + st * j;
        vec3 acc = vec3(0.0);
        float w = 1.0, wsum = 0.0;
        for (int i = 0; i < N; i++) {
          p += st;
          vec2 q = clamp(p, vec2(0.001), vec2(0.999));
          float sky = step(1500.0, -getViewZ(readDepth(q)));
          vec3 c = texture2D(inputBuffer, q).rgb;
          // the brighter the sky there (the glow round the sun), the more it carries
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          acc += (c * smoothstep(0.0, 1.0, lum) + uSunCol * 1.6) * sky * w;
          wsum += w;
          w *= 0.955;
        }
        acc /= wsum;
        float r = length(d * vec2(1.0, 0.6));
        float fall = exp(-r * 1.6);
        vec3 add = acc * mix(vec3(1.0), uSunCol, 0.6) * fall * uStrength;
        // the shafts show in the air in front of things, not as a glow on open sky
        add *= mix(1.0, 0.35, step(1500.0, -getViewZ(depth)));
        outputColor = vec4(inputColor.rgb + add, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        uniforms: new Map<string, THREE.Uniform>([
          ['uSun', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
          ['uSunCol', new THREE.Uniform(new THREE.Color(1, 0.8, 0.5))],
          ['uStrength', new THREE.Uniform(0)],
        ]),
      },
    );
  }
  private readonly v = new THREE.Vector3();
  set(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, sunCol: THREE.Color, day: number, sunset: number) {
    const v = this.v.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
    const camFwd = new THREE.Vector3();
    camera.getWorldDirection(camFwd);
    const facing = THREE.MathUtils.smoothstep(camFwd.dot(sunDir), 0.05, 0.6);
    const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(v.x), Math.abs(v.y)), 1.1, 1.9);
    (this.uniforms.get('uSun')!.value as THREE.Vector2).set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    (this.uniforms.get('uSunCol')!.value as THREE.Color).copy(sunCol);
    const lowSun = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.06) * (1 - THREE.MathUtils.smoothstep(sunDir.y, 0.35, 0.8));
    this.uniforms.get('uStrength')!.value = 1.1 * day * facing * onScreen * (0.35 + 0.65 * Math.max(lowSun, sunset));
  }
}

export class Post {
  readonly shafts = new ShaftsEffect();
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
    c.addPass(new EffectPass(camera, this.shafts, this.exposure, this.bloom, tone, this.grade, new VignetteEffect({ darkness: 0.34, offset: 0.3 })));
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
