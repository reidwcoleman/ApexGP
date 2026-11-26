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
        // far from the sun the shafts fade to nothing: skip the 28-tap march there (most of the screen)
        float fall = exp(-length(d * vec2(1.0, 0.6)) * 1.6);
        if (fall * uStrength < 0.012) { outputColor = inputColor; return; }
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
    // shafts are a ground-level thing, broken up by buildings; from a roof or a helicopter they'd lay a
    // milky veil over the whole city, so they fade out with height
    const high = 1 / (1 + Math.max(0, camera.position.y - 15) / 20);
    this.uniforms.get('uStrength')!.value = 1.1 * day * facing * onScreen * (0.35 + 0.65 * Math.max(lowSun, sunset)) * high;
  }
}

/**
 * Wet ground reflections: on a rainy street every ground pixel reflects the view ray off the road
 * (flat, normal up), marches it through the depth buffer and picks up whatever it meets: lit windows,
 * neon, lamps and headlights smear across the tarmac. Puddles reflect fully, the rest of the road
 * a little; Fresnel makes it strongest at a glancing angle.
 */
class WetReflectEffect extends Effect {
  constructor() {
    super(
      'PalmeraWet',
      /* glsl */ `
      uniform float uWet;
      uniform float uT;
      uniform mat4 uProj;
      uniform mat4 uProjInv;
      uniform mat4 uView;
      uniform mat4 uViewInv;
      float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(wh(i), wh(i + vec2(1, 0)), f.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), f.x), f.y); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (uWet < 0.02) return;
        float vz = -getViewZ(depth);
        if (vz > 260.0) return;
        vec4 cp = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec3 vp = cp.xyz / cp.w;
        vec3 wp = (uViewInv * vec4(vp, 1.0)).xyz;
        if (wp.y > 0.2 || wp.y < -0.3) return;
        // not the beach, not lawns: tarmac, paving and concrete
        if (wp.x > 676.0) return;
        if (inputColor.g > inputColor.r * 1.12 && inputColor.g > inputColor.b * 1.1) return;
        vec3 cam = (uViewInv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 V = normalize(wp - cam);
        // a touch of ripple so the reflection isn't a perfect mirror
        vec2 rp = wp.xz * 3.0;
        vec3 N = normalize(vec3((wn(rp) - 0.5) * 0.05, 1.0, (wn(rp + 9.1) - 0.5) * 0.05));
        vec3 R = reflect(V, N);
        float pud = mix(0.4, 1.0, smoothstep(0.52, 0.7, wn(wp.xz * 0.12 + 7.0)));
        float t = 0.4;
        float j = fract(wh(floor(uv * resolution)) + uT * 0.618034);
        vec3 hit = vec3(0.0);
        float found = 0.0;
        for (int i = 0; i < 26; i++) {
          vec3 sp = wp + R * t * (1.0 + j * 0.25);
          vec4 cs = uProj * uView * vec4(sp, 1.0);
          if (cs.w <= 0.0) break;
          vec2 suv = cs.xy / cs.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
          float sz = -getViewZ(readDepth(suv));
          float dz = cs.w - sz;
          if (dz > 0.05 && dz < 0.6 + t * 0.12) {
            // refine between the last miss and this hit
            float a = t / 1.28, b = t;
            for (int k = 0; k < 5; k++) {
              float m = (a + b) * 0.5;
              vec4 mc = uProj * uView * vec4(wp + R * m * (1.0 + j * 0.25), 1.0);
              vec2 muv = mc.xy / mc.w * 0.5 + 0.5;
              if (mc.w - -getViewZ(readDepth(muv)) > 0.0) { b = m; suv = muv; } else a = m;
            }
            hit = texture2D(inputBuffer, suv).rgb;
            // fade toward the screen edges, where the reflected thing would be cut off
            vec2 e = smoothstep(vec2(0.0), vec2(0.08), suv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - suv);
            found = e.x * e.y * (1.0 - float(i) / 26.0 * 0.5);
            break;
          }
          t *= 1.28;
        }
        if (found <= 0.0) return;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, vec3(0.0, 1.0, 0.0)), 0.0), 5.0);
        float k = clamp(fres * 1.4, 0.0, 1.0) * uWet * pud * found * (1.0 - smoothstep(150.0, 260.0, vz));
        outputColor = vec4(mix(inputColor.rgb, hit, k * 0.85) + hit * k * 0.15, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        uniforms: new Map<string, THREE.Uniform>([
          ['uWet', new THREE.Uniform(0)],
          ['uT', new THREE.Uniform(0)],
          ['uProj', new THREE.Uniform(new THREE.Matrix4())],
          ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
          ['uView', new THREE.Uniform(new THREE.Matrix4())],
          ['uViewInv', new THREE.Uniform(new THREE.Matrix4())],
        ]),
      },
    );
  }
  private frame = 0;
  set(camera: THREE.PerspectiveCamera, wet: number) {
    this.uniforms.get('uWet')!.value = wet;
    this.uniforms.get('uT')!.value = this.frame++ % 64;
    (this.uniforms.get('uProj')!.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (this.uniforms.get('uProjInv')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.uniforms.get('uView')!.value as THREE.Matrix4).copy(camera.matrixWorldInverse);
    (this.uniforms.get('uViewInv')!.value as THREE.Matrix4).copy(camera.matrixWorld);
  }
}

/**
 * Speed blur: at high speed in a car the picture streaks toward the middle of the screen, more at
 * the edges than the centre, so the road ahead stays sharp. Off (an early return) below the threshold.
 */
class SpeedBlurEffect extends Effect {
  constructor() {
    super(
      'PalmeraSpeedBlur',
      /* glsl */ `
      uniform float uAmount;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        if (uAmount <= 0.001) { outputColor = inputColor; return; }
        vec2 d = vec2(0.5, 0.52) - uv;
        float r = length(d * vec2(1.6, 1.0));
        float m = smoothstep(0.18, 0.75, r) * uAmount;
        if (m <= 0.002) { outputColor = inputColor; return; }
        const int N = 10;
        vec2 st = d * m * 0.07 / float(N);
        float j = fract(sin(dot(uv * 711.3, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 p = uv + st * j;
        vec3 acc = inputColor.rgb;
        for (int i = 0; i < N; i++) {
          p += st;
          acc += texture2D(inputBuffer, p).rgb;
        }
        outputColor = vec4(acc / float(N + 1), inputColor.a);
      }`,
      { uniforms: new Map<string, THREE.Uniform>([['uAmount', new THREE.Uniform(0)]]) },
    );
  }
  set(amount: number) {
    this.uniforms.get('uAmount')!.value = amount;
  }
}

export class Post {
  readonly speedBlur = new SpeedBlurEffect();
  readonly wetRefl = new WetReflectEffect();
  readonly shafts = new ShaftsEffect();
  readonly exposure = new ExposureEffect();
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass;
  readonly taa: TAAPass;
  readonly grade = new GradeEffect();
  readonly bloom: BloomEffect;
  private readonly size = new THREE.Vector2();
  wet = 0;

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
    c.addPass(new EffectPass(camera, this.speedBlur, this.wetRefl, this.shafts, this.exposure, this.bloom, tone, this.grade, new VignetteEffect({ darkness: 0.34, offset: 0.3 })));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(t: number, night: number, exposure: number) {
    this.grade.set(t, night);
    this.exposure.value = exposure;
    this.camera.updateMatrixWorld();
    this.wetRefl.set(this.camera, this.wet);
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
