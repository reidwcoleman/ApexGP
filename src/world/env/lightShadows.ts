import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import { SunLightShadow } from 'three/examples/jsm/lights/SunLightShadow.js';
import { CLOUD_FIELD_GLSL } from './skyClouds.ts';

/**
 * Sun + shadows.
 *
 * three's `SunLight` renders two shadow cascades into one atlas (2 × mapSize ×
 * mapSize). We keep its renderer plumbing but fit the cascades ourselves:
 *
 *   cascade 0  "focus": a fixed-size square around the player car (pushed a
 *              little ahead of the camera), ~3 cm texels — crisp car, driver,
 *              wing and suspension shadows, and it follows the car in every
 *              camera including the long-lens TV cameras.
 *   cascade 1  "view": a fixed-size square ahead of the render camera covering
 *              the visible track and trees out to ~250 m.
 *
 * Both are texel-snapped in light space and fixed in size, so nothing shimmers
 * when the car or camera moves or turns. The fragment side (a patched
 * `getSunShadow`) picks the focus cascade wherever the fragment lies inside it
 * (fading at its edge into the view cascade) and fades shadows out at the far
 * edge; it also multiplies in ground cloud shadows drifting with the wind.
 */

const _lightDir = new THREE.Vector3();
const _orient = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _c = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class FocusSunShadow extends SunLightShadow {
  /** world point the focus cascade is centred on */
  readonly focus = new THREE.Vector3();
  /** edge length (m) of the focus and view cascades */
  nearSize = 80;
  farSize = 360;
  /** how far ahead of the camera the view cascade is centred (fraction of farSize) */
  farAhead = 0.36;
  /** light-space depth range (m) toward the sun / away from it */
  ceiling = 450;
  floor = 250;
  /**
   * per-cascade PCF radius multipliers and normal-bias multipliers
   * (focus 0.6: a car's shadow under a high sun has a penumbra of about a centimetre — the
   * full 2.6-texel disc, ~10 cm, softened every edge of it to a game's blur where footage and ACC
   * show the wheels, the wing endplates and the halo crisp on the asphalt; 1.5 texels (~6 cm) with
   * the hardware 2×2 compare still hides the texel steps, and cloud widens it with L.shadowRadius)
   */
  radiusScale: [number, number] = [0.6, 1.15];
  normalScale: [number, number] = [1, 4.5];
  /** extra multiplier on the focus cascade's disc (dev A/B) */
  focusSharpen = 1;
  /** a long lens centres the view cascade on the followed car (see updateMatrices; dev A/B) */
  followLens = true;

  override updateMatrices(light: THREE.Light, viewCamera?: THREE.Camera) {
    if (!viewCamera) return;
    const self = this as unknown as {
      _viewports: THREE.Vector4[];
      _cameras: THREE.OrthographicCamera[];
      _matrices: THREE.Matrix4[];
      _frustums: THREE.Frustum[];
      _cascadeData: THREE.Vector4[];
      _updateMatrix(cam: THREE.Camera, m: THREE.Matrix4, f: THREE.Frustum, v: THREE.Vector4): void;
    };
    const res = this.mapSize.x;
    const insetTexels = Math.ceil(this.radius * 1.5) + 2;
    const inset = insetTexels / res;
    for (let i = 0; i < 2; i++) self._viewports[i].set(i + inset, inset, 1 - 2 * inset, 1 - 2 * inset);
    const usable = res * (1 - 2 * inset);

    _lightDir.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_lightDir)) > 0.99) _up.set(0, 0, 1);
    _orient.lookAt(_c.set(0, 0, 0), _lightDir, _up);
    _inv.copy(_orient).transpose();

    viewCamera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();

    // A low sun stretches every shadow texel, and the filter disc with it, across the ground by
    // 1 / sin(elevation) — ×7.7 at golden hour, where the focus cascade's 2.6-texel disc smeared a
    // car's shadow ~1.5 m along the sun: a blurred streak rather than the crisp long shadow of
    // golden-hour footage (sharp at the tyres, softening only toward its far tip). The real
    // penumbra there is a few centimetres across the beam, so the focus disc narrows with the sun
    // (to 70 %, ~1.1 texels, below ~6°); the hardware 2×2 compare and the 8 taps still smooth the
    // texel steps. (The view cascade keeps its disc: trees 40–100 m up the beam really do throw
    // soft shadows.)
    const sinEl = Math.max(0, -_lightDir.y);
    const lowSun = 0.7 + 0.3 * THREE.MathUtils.smoothstep(sinEl, 0.1, 0.5);

    // A long lens looks at a patch of circuit far down its axis: the trackside tower's 2° lens frames
    // the cars 150–300 m away, beyond the view cascade (it reaches ~310 m ahead of the camera), so only
    // the followed car had a shadow — the rest of the field, the barriers and the stands behind them
    // stood flat-lit on the asphalt, where the TV pictures them on crisp black shadows. A narrow lens
    // centres the view cascade on what it is looking at (the followed car's distance along the view):
    // the wedge of ground such a lens sees there is a few tens of metres wide, well inside it.
    _eye.setFromMatrixPosition(viewCamera.matrixWorld);
    const fov = (viewCamera as THREE.PerspectiveCamera).isPerspectiveCamera ? (viewCamera as THREE.PerspectiveCamera).fov : 60;
    const narrow = this.followLens ? 1 - THREE.MathUtils.smoothstep(fov, 12, 30) : 0;
    const along = (this.focus.x - _eye.x) * _fwd.x + (this.focus.z - _eye.z) * _fwd.z;
    const ahead0 = this.farSize * this.farAhead;
    const ahead = narrow > 0 && along > ahead0 ? THREE.MathUtils.lerp(ahead0, Math.min(along, 2500), narrow) : ahead0;

    for (let i = 0; i < 2; i++) {
      const size = i === 0 ? this.nearSize : this.farSize;
      const half = size / 2;
      if (i === 0) _c.copy(this.focus);
      else _c.copy(_eye).addScaledVector(_fwd, ahead);
      _c.applyMatrix4(_inv);
      const texel = size / usable;
      _c.x = Math.round(_c.x / texel) * texel;
      _c.y = Math.round(_c.y / texel) * texel;
      const zCenter = _c.z;
      _c.z = zCenter + this.ceiling;
      _c.applyMatrix4(_orient);
      const cam = self._cameras[i];
      cam.position.copy(_c);
      cam.quaternion.setFromRotationMatrix(_orient);
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 0.5;
      cam.far = this.ceiling + this.floor;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      self._updateMatrix(cam, self._matrices[i], self._frustums[i], self._viewports[i]);
      // read by the patched getSunShadow: normal-bias scale, radius scale, tile inset, unused
      self._cascadeData[i].set(this.normalScale[i], this.radiusScale[i] * (i === 0 ? lowSun * this.focusSharpen : 1), inset, 0);
    }
  }
}

/** shared (by reference) with every lit built-in material, see installSunShadowChunk */
export const cloudShadowA = { x: 0, y: 0, z: 0, w: 0 }; // strength, coverage, windX, windZ
export const cloudShadowB = { x: 0, y: 0, z: 1500, w: 0 }; // sunDir.x/y, sunDir.z/y, cloud mid height, ground height of the baked map
/** the baked map of the drawn clouds' shadows (skyClouds.ts bakeShadow): corner x, z, 1 / size, 1 = in use */
export const cloudShadowC = { x: 0, y: 0, z: 0, w: 0 };
/**
 * The map's GPU texture, handed to every lit material. ShaderLib's uniforms are cloned per material, and
 * three won't clone a render target's texture (it hands the clone null) — so the materials get an
 * external texture whose source is looked up live: every clone binds whatever map the current
 * environment baked, and none (no shadow: r reads 0) before the first.
 */
const cloudShadowGL: { tex: WebGLTexture | null } = { tex: null };
class CloudShadowTexture extends THREE.ExternalTexture {}
Object.defineProperty(CloudShadowTexture.prototype, 'sourceTexture', {
  get: () => cloudShadowGL.tex,
  set: () => {},
  configurable: true,
});
export const cloudShadowTexture = new CloudShadowTexture();
/** point the materials' cloud-shadow map at a baked render target (null: none) */
export function setCloudShadowTarget(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget | null) {
  cloudShadowGL.tex = rt ? ((renderer.properties.get(rt.texture) as { __webglTexture?: WebGLTexture }).__webglTexture ?? null) : null;
  if (!cloudShadowGL.tex) cloudShadowC.w = 0;
}
/**
 * GLSL: how much of the sun the clouds take at world point wp — the baked map of the drawn clouds where
 * it reaches, fading to the old statistical patches (cloudShadowMask) toward and beyond its edge.
 * Needs CLOUD_FIELD_GLSL and the four uniforms.
 */
export const CLOUD_SHADOW_AT_GLSL = /* glsl */ `
float cloudShadowAmount( vec3 wp, vec4 A, vec4 B, vec4 C, sampler2D map ) {
  float k = 0.0;
  float baked = 0.0;
  if ( C.w > 0.5 ) {
    // (the map was baked for the ground under it: a point higher up looks up a ray that starts further
    // toward the sun)
    vec2 uv = ( wp.xz - B.xy * ( wp.y - B.w ) - C.xy ) * C.z;
    float edge = min( min( uv.x, 1.0 - uv.x ), min( uv.y, 1.0 - uv.y ) );
    k = smoothstep( 0.0, 0.12, edge );
    if ( k > 0.0 ) baked = texture2D( map, uv ).r;
  }
  // (the statistical patches only where the map doesn't reach: they cost six noise lookups)
  if ( k >= 1.0 ) return baked;
  float proc = cloudShadowMask( wp.xz + B.xy * ( B.z - wp.y ) + A.zw, A.y );
  return mix( proc, baked, k );
}
`;

const GET_SUN_SHADOW = /* glsl */ `
#if defined( SHADOWMAP_TYPE_PCF )
float sunPCF( sampler2DShadow shadowMap, vec2 mapSize, float bias, float radiusTexels, vec4 c, int taps ) {
  vec3 sc = c.xyz / c.w;
  sc.z += bias;
  if ( sc.z > 1.0 ) return 1.0;
  // one fixed disc for every pixel: a per-pixel rotation (three's default) needs temporal AA to
  // resolve, and without it every soft shadow edge — cars, walls, columns — showed a checkerboard dither
  float phi = 0.6;
  vec2 r = vec2( radiusTexels ) / vec2( mapSize.x * 2.0, mapSize.y );
  float s = 0.0;
  if ( taps > 5 ) {
    for ( int i = 0; i < 8; i++ ) s += texture( shadowMap, vec3( sc.xy + vogelDiskSample( i, 8, phi ) * r, sc.z ) );
    return s * 0.125;
  }
  for ( int i = 0; i < 5; i++ ) s += texture( shadowMap, vec3( sc.xy + vogelDiskSample( i, 5, phi ) * r, sc.z ) );
  return s * 0.2;
}
#endif

// tile-local edge distance (0 at the usable edge, 0.5 at the centre)
float sunTileEdge( vec4 c, float tile, float inset ) {
  vec2 l = vec2( c.x / c.w * 2.0 - tile, c.y / c.w );
  vec2 e = min( l - inset, 1.0 - inset - l ) / ( 1.0 - 2.0 * inset );
  return min( e.x, e.y );
}

uniform vec4 cloudShadowA;
uniform vec4 cloudShadowB;
uniform vec4 cloudShadowC;
uniform sampler2D cloudShadowMap;
${CLOUD_FIELD_GLSL}
${CLOUD_SHADOW_AT_GLSL}
float cloudShadowAt( vec3 wp ) {
  if ( cloudShadowA.x <= 0.0 ) return 1.0;
  return 1.0 - cloudShadowA.x * cloudShadowAmount( wp, cloudShadowA, cloudShadowB, cloudShadowC, cloudShadowMap );
}

float getSunShadow(
  #if defined( SHADOWMAP_TYPE_PCF )
    sampler2DShadow shadowMap,
  #else
    sampler2D shadowMap,
  #endif
  SunLightShadow sunLightShadow,
  int shadowIndex
) {
  int o = shadowIndex * SUN_LIGHT_CASCADES;
  vec4 p0 = sunShadowCascade[ o ];
  vec4 p1 = sunShadowCascade[ o + 1 ];
  float nb = sunLightShadow.shadowNormalBias;
  vec3 wp = vSunShadowWorldPosition.xyz;
  vec3 wn = vSunShadowWorldNormal;
  float cloud = cloudShadowAt( wp );

  #if defined( SHADOWMAP_TYPE_PCF )
    vec4 c0 = sunShadowMatrix[ o ] * vec4( wp + wn * nb * p0.x, 1.0 );
    float e0 = sunTileEdge( c0, 0.0, p0.z );
    float w0 = smoothstep( 0.0, 0.06, e0 );
    float s = 1.0;
    if ( w0 < 1.0 ) {
      vec4 c1 = sunShadowMatrix[ o + 1 ] * vec4( wp + wn * nb * p1.x, 1.0 );
      float e1 = sunTileEdge( c1, 1.0, p1.z );
      float w1 = smoothstep( 0.0, 0.12, e1 );
      if ( w1 > 0.0 ) s = mix( 1.0, sunPCF( shadowMap, sunLightShadow.shadowMapSize, sunLightShadow.shadowBias * 1.5, sunLightShadow.shadowRadius * p1.y, c1, 5 ), w1 );
    }
    if ( w0 > 0.0 ) s = mix( s, sunPCF( shadowMap, sunLightShadow.shadowMapSize, sunLightShadow.shadowBias, sunLightShadow.shadowRadius * p0.y, c0, 8 ), w0 );
    return mix( 1.0, s, sunLightShadow.shadowIntensity ) * cloud;
  #else
    return cloud;
  #endif
}
`;

let installed = false;

/**
 * Replace three's getSunShadow with the focus/view cascade selector + cloud
 * shadows, and hand every lit built-in material the cloud-shadow uniforms.
 * Idempotent; affects only materials lit by a SunLight.
 */
export function installSunShadowChunk() {
  if (installed) return;
  installed = true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const re = /float getSunShadow\([\s\S]*?return shadow;\s*\}/;
  if (!re.test(chunk)) {
    console.warn('[env] getSunShadow not found in shadowmap_pars_fragment — using three default cascades');
    return;
  }
  // (the same for three's own PCF on the spot and point lights)
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk
    .replace(re, GET_SUN_SHADOW)
    .replace(/float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;/g, 'float phi = 0.6;');
  for (const key of Object.keys(THREE.ShaderLib)) {
    const sh = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key];
    if (sh && sh.uniforms && 'sunLights' in sh.uniforms) {
      sh.uniforms.cloudShadowA = { value: cloudShadowA };
      sh.uniforms.cloudShadowB = { value: cloudShadowB };
      sh.uniforms.cloudShadowC = { value: cloudShadowC };
      sh.uniforms.cloudShadowMap = { value: cloudShadowTexture };
    }
  }
}

export interface SunRig {
  sun: SunLight;
  shadow: FocusSunShadow;
  setDirection(dir: THREE.Vector3): void;
  setQuality(mapSize: number, farSize: number): void;
}

export function createSun(): SunRig {
  installSunShadowChunk();
  const sun = new SunLight(0xffffff, 3);
  sun.name = 'Sun';
  const shadow = new FocusSunShadow();
  sun.shadow.dispose();
  sun.shadow = shadow;
  sun.castShadow = true;
  shadow.mapSize.set(2048, 2048);
  shadow.bias = -0.00008;
  shadow.normalBias = 0.035;
  shadow.radius = 2.2;
  return {
    sun,
    shadow,
    setDirection(dir) {
      sun.position.copy(dir).normalize();
      sun.updateMatrixWorld();
    },
    setQuality(mapSize, farSize) {
      if (shadow.mapSize.x !== mapSize) {
        shadow.mapSize.set(mapSize, mapSize);
        if (shadow.map) {
          shadow.map.dispose();
          shadow.map = null;
        }
      }
      shadow.farSize = farSize;
    },
  };
}
