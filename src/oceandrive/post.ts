import * as THREE from 'three';
import { BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect, BlendFunction } from 'postprocessing';
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

/**
 * Air: height fog over the world (thicker low down, thinning with altitude), its colour the sky's
 * horizon, brightening toward the sun (forward scattering); in a storm a grey murk that swallows
 * the far end of the street. Works from the depth buffer, so everything gets it alike.
 */
export class AtmosphereEffect extends Effect {
  readonly invProj = new THREE.Matrix4();
  readonly camWorld = new THREE.Matrix4();
  constructor() {
    super(
      'OdAtmosphere',
      /* glsl */ `
      uniform mat4 uInvProj;
      uniform mat4 uCamWorld;
      uniform float uDensity;
      uniform float uHeightK;
      uniform vec3 uFogCol;
      uniform vec3 uSunDir;
      uniform vec3 uSunScat;
      void mainImage( const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor ) {
        if ( depth >= 0.99999 || uDensity <= 0.0 ) { outputColor = inputColor; return; }
        vec4 vp = uInvProj * vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
        vp /= vp.w;
        vec3 wp = ( uCamWorld * vec4( vp.xyz, 1.0 ) ).xyz;
        vec3 ro = uCamWorld[ 3 ].xyz;
        vec3 rd = wp - ro;
        float dist = length( rd );
        rd /= dist;
        // the fog's density falls off with height: integrate it along the ray
        float k = uHeightK;
        float h0 = max( ro.y, -2.0 );
        float dy = rd.y * dist;
        float avg = abs( dy ) > 0.05 ? ( exp( -k * h0 ) - exp( -k * ( h0 + dy ) ) ) / ( k * dy ) : exp( -k * h0 );
        float tau = uDensity * dist * clamp( avg, 0.0, 4.0 );
        float ext = 1.0 - exp( -tau );
        float mu = max( dot( rd, uSunDir ), 0.0 );
        vec3 fc = uFogCol + uSunScat * ( pow( mu, 8.0 ) * 1.4 + pow( mu, 2.0 ) * 0.25 );
        outputColor = vec4( mix( inputColor.rgb, fc, ext ), inputColor.a );
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
          ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
          ['uDensity', new THREE.Uniform(0.0009)],
          ['uHeightK', new THREE.Uniform(0.02)],
          ['uFogCol', new THREE.Uniform(new THREE.Vector3(0.7, 0.75, 0.8))],
          ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
          ['uSunScat', new THREE.Uniform(new THREE.Vector3())],
        ]),
      },
    );
  }
  u(name: string) {
    return this.uniforms.get(name)!;
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
  readonly air = new AtmosphereEffect();
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
    c.addPass(new EffectPass(camera, this.air, this.exposure, this.bloom, this.tone, this.grade, new VignetteEffect({ darkness: 0.32, offset: 0.32 })));
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  render(t: number) {
    this.grade.time = t;
    this.camera.updateMatrixWorld();
    this.air.u('uInvProj').value.copy(this.camera.projectionMatrixInverse);
    this.air.u('uCamWorld').value.copy(this.camera.matrixWorld);
    this.renderer.getDrawingBufferSize(this.size);
    this.taa.begin(this.camera, this.size.x, this.size.y, []);
    this.composer.render();
    this.taa.end(this.camera);
  }

  reset() {
    this.taa.reset();
  }
}
