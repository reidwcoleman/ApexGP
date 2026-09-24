import * as THREE from 'three';
import { aerialUniforms } from '../world/env/fog.ts';
import { puffAtlas } from './fxTextures.ts';
import { SprayVeil } from './SprayVeil.ts';
import { DEPTH_PARS } from './fxShaders.ts';
import { weatherUniforms } from '../world/weatherUniforms.ts';

/**
 * GPU-instanced particle pools (CPU-simulated, one draw call each):
 *
 *   soft  lit, alpha-blended puffs — rain spray (rooster tails, wheel sheets, mist),
 *         tyre smoke, grass/gravel dust. A normal+density atlas is lit like a tiny
 *         volume: sun wrap + sky ambient + forward scattering when looking into the
 *         sun, darkened near the road; faded softly where it meets the ground and near
 *         the camera (so a cloud never swallows the lens), eroded into wisps with age,
 *         and fogged with the scene's aerial perspective.
 *   hot   additive HDR (blooms): spark streaks that bounce off the road, and per-frame
 *         light glows (rain lights seen through spray).
 *   veil  three camera-space planes that cut visibility when driving in spray.
 *
 * Lighting is discovered from the scene (shadow-casting DirectionalLight + scene.fog
 * colour as the sky ambient) — or pushed explicitly with setLighting().
 */

const SOFT_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;  // radius, alpha, rotation, stretch (s)
attribute vec4 iTint;  // rgb, ground y
attribute vec4 iMisc;  // age 0..1, atlas cell, erosion, -
uniform vec3 uCamVel;
uniform vec2 uNear;
uniform float uMaxProj;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
// scene aerial fog (same uniforms/maths as world/env/fog.ts, evaluated per sprite corner)
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec4 aerialParams;
uniform vec3 aerialSunDir;
uniform vec3 aerialSunColor;
varying vec2 vUv;
varying vec4 vAxes;     // quad x/y axes in view space (rotates the atlas normals)
varying vec3 vSunV;     // sun direction in view space
varying vec3 vAmbC;     // ambient term (tint × sky × occlusion)
varying vec3 vSunC;     // sun term (tint × sun × occlusion)
varying vec3 vFwdC;     // forward-scatter term
varying vec4 vFog;      // haze rgb, opacity
varying float vAlpha;
varying float vErode;
varying float vSoft;    // depth softness (m)
varying float vViewZ;
varying float vHFade;
void main() {
  vec4 mvPosition = viewMatrix * vec4( iPos, 1.0 );
  float dist = -mvPosition.z;
  float size = iData.x;
  float alpha = iData.y * smoothstep( uNear.x + size * 0.3, uNear.y + size * 0.8, dist );
  if ( alpha < 0.0015 || dist < 0.1 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  float proj = size * projectionMatrix[1][1] / dist;
  if ( proj > uMaxProj ) size *= uMaxProj / proj;
  vec2 ax;
  vec2 ay;
  float sy = size;
  if ( iData.w > 0.0 ) {
    vec3 rv = ( viewMatrix * vec4( iVel - uCamVel, 0.0 ) ).xyz;
    float l = length( rv.xy );
    ay = l > 1e-3 ? rv.xy / l : vec2( 0.0, 1.0 );
    ax = vec2( ay.y, -ay.x );
    sy = size + min( l * iData.w, size * 5.0 );
  } else {
    float c = cos( iData.z );
    float s = sin( iData.z );
    ax = vec2( c, s );
    ay = vec2( -s, c );
  }
  vec2 off = ax * corner.x * size + ay * corner.y * sy;
  mvPosition.xy += off;
  vec3 world = iPos + ( vec4( off, 0.0, 0.0 ) * viewMatrix ).xyz;
  float cell = iMisc.y;
  vec2 cellOff = vec2( mod( cell, 2.0 ), floor( cell * 0.5 ) ) * 0.5;
  vUv = cellOff + ( 0.008 + ( corner * 0.5 + 0.5 ) * 0.984 ) * 0.5;
  vAxes = vec4( ax, ay );
  vSunV = ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz;
  // lighting that varies slowly across a sprite: per corner
  float hAbove = world.y - iTint.w;
  float occl = mix( 0.8, 1.0, smoothstep( 0.0, 2.0, hAbove ) );
  float sky = 1.05 + 0.2 * clamp( corner.y * 0.5 + 0.3, -1.0, 1.0 );
  vec3 V = normalize( world - cameraPosition );
  float mu = max( dot( V, uSunDir ), 0.0 );
  float mu2 = mu * mu;
  vAmbC = iTint.rgb * uAmb * sky * occl;
  vSunC = iTint.rgb * uSunCol * 0.24 * occl;
  vFwdC = iTint.rgb * uSunCol * 0.8 * mu2 * mu2 * mu2;
  vHFade = smoothstep( -0.3, 0.1 + size * 0.25, hAbove );
  // aerial perspective
  vec3 ray = world - cameraPosition;
  float fd = length( ray );
  float fogA;
  vec3 haze = fogColor;
  if ( aerialParams.x > 0.0 ) {
    float k = aerialParams.y;
    float camH = cameraPosition.y - aerialParams.z;
    float x = k * ray.y;
    float f = abs( x ) > 1e-3 ? ( 1.0 - exp( -x ) ) / x : 1.0 - 0.5 * x;
    float od = aerialParams.x * exp( -k * max( camH, -50.0 ) ) * fd * f;
    fogA = min( 1.0 - exp( -od ), aerialParams.w );
    float m = max( dot( ray / max( fd, 1e-4 ), aerialSunDir ), 0.0 );
    haze += aerialSunColor * ( pow( m, 5.0 ) * 0.55 + pow( m, 24.0 ) * 0.9 );
  } else {
    fogA = fogFar > fogNear ? smoothstep( fogNear, fogFar, dist ) : 0.0;
  }
  vFog = vec4( haze, fogA );
  vAlpha = alpha;
  vErode = iMisc.z * iMisc.x;
  vSoft = 0.35 + size * 0.45;
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SOFT_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
${DEPTH_PARS}
varying vec2 vUv;
varying vec4 vAxes;
varying vec3 vSunV;
varying vec3 vAmbC;
varying vec3 vSunC;
varying vec3 vFwdC;
varying vec4 vFog;
varying float vAlpha;
varying float vErode;
varying float vSoft;
varying float vViewZ;
varying float vHFade;
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  float d = clamp( ( t.a - vErode ) / max( 1.0 - vErode, 0.05 ), 0.0, 1.0 );
  // soft against the real scene depth (and, as a backup, the road plane)
  float a = d * vAlpha * vHFade * clamp( ( sceneViewZ() - vViewZ ) / vSoft, 0.0, 1.0 );
  if ( a < 0.002 ) discard;
  vec2 nt = t.rg * 2.0 - 1.0;
  vec3 n = vec3( vAxes.xy * nt.x + vAxes.zw * nt.y, sqrt( max( 0.0, 1.0 - dot( nt, nt ) ) ) );
  float wrap = clamp( ( dot( n, vSunV ) + 0.6 ) * 0.625, 0.0, 1.0 );
  vec3 col = vAmbC * ( 0.9 + 0.2 * t.b ) + vSunC * wrap + vFwdC * ( 1.0 - 0.6 * d );
  gl_FragColor = vec4( mix( col, vFog.rgb, vFog.a ), a );
}
`;

const HOT_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;  // radius, alpha, -, stretch (s)
attribute vec4 iTint;  // rgb (HDR), -
attribute vec4 iMisc;  // -, -, -, pull toward camera (m)
uniform vec3 uCamVel;
uniform float uPx;
varying vec2 vC;
varying vec3 vTint;
varying float vAlpha;
varying float vStreak;
varying float vViewZ;
varying float vSize;
void main() {
  vec4 mv = viewMatrix * vec4( iPos, 1.0 );
  float dist = -mv.z;
  if ( dist < 0.08 || iData.y < 0.001 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  float pull = iMisc.w;
  if ( pull > 0.0 ) {
    mv.xyz += normalize( -mv.xyz ) * min( pull, dist * 0.5 );
    dist = -mv.z;
  }
  float size = iData.x;
  float alpha = iData.y;
  float minS = 1.3 * uPx * dist / projectionMatrix[1][1];
  if ( size < minS ) {
    float k = size / minS;
    alpha *= iData.w > 0.0 ? k * k : k;
    size = minS;
  }
  vec2 ax = vec2( 1.0, 0.0 );
  vec2 ay = vec2( 0.0, 1.0 );
  float sy = size;
  if ( iData.w > 0.0 ) {
    vec3 rv = ( viewMatrix * vec4( iVel - uCamVel, 0.0 ) ).xyz;
    float l = length( rv.xy );
    ay = l > 1e-3 ? rv.xy / l : vec2( 0.0, 1.0 );
    ax = vec2( ay.y, -ay.x );
    sy = size + min( l * iData.w, 0.9 );
  }
  mv.xy += ax * corner.x * size + ay * corner.y * sy;
  vC = corner;
  vTint = iTint.rgb;
  vAlpha = alpha;
  vStreak = iData.w > 0.0 ? 1.0 : 0.0;
  vViewZ = -mv.z;
  vSize = size;
  gl_Position = projectionMatrix * mv;
}
`;

const HOT_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vTint;
varying float vAlpha;
varying float vStreak;
void main() {
  float r2 = dot( vC, vC );
  float core;
  if ( vStreak > 0.5 ) {
    core = exp( -( vC.x * vC.x * 4.5 + vC.y * vC.y * 1.1 ) * 2.4 );
  } else {
    core = ( exp( -r2 * 9.0 ) + 0.22 * exp( -r2 * 2.2 ) ) * clamp( 1.0 - r2, 0.0, 1.0 );
  }
  gl_FragColor = vec4( vTint * core * vAlpha, 1.0 );
}
`;

const COMPOSITE_VERT = /* glsl */ `
uniform float uOn;
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = uOn > 0.5 ? vec4( position.xy, 0.0, 1.0 ) : vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D( uTex, vUv );
}
`;

/** premultiplied accumulation into the low-res target (alpha = coverage) */
function premulBlend(m: THREE.Material) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.premultipliedAlpha = false;
}

/** light scattered in the spray around a lamp: drawn in the soft pass, additive, depth-softened */
const HALO_FRAG = /* glsl */ `
${DEPTH_PARS}
varying vec2 vC;
varying vec3 vTint;
varying float vAlpha;
varying float vViewZ;
varying float vSize;
void main() {
  float r2 = dot( vC, vC );
  float g = exp( -r2 * 3.0 ) * clamp( 1.0 - r2, 0.0, 1.0 );
  float soft = clamp( ( sceneViewZ() - vViewZ ) / ( 0.3 + vSize * 0.6 ), 0.0, 1.0 );
  // premultiplied emission: adds light, leaves coverage alone
  gl_FragColor = vec4( vTint * g * vAlpha * soft, 0.0 );
}
`;

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** instance layout: pos3 vel3 data4 tint4 misc4 = 18 floats */
const STRIDE = 18;

class Pool {
  readonly mesh: THREE.Mesh;
  readonly max: number;
  count = 0;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array;
  s0: Float32Array; s1: Float32Array; a0: Float32Array;
  rot: Float32Array; rotV: Float32Array; drag: Float32Array; dragV: Float32Array; grav: Float32Array; stretch: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  ground: Float32Array; cell: Float32Array; erode: Float32Array; windK: Float32Array; fadeIn: Float32Array; bounce: Float32Array;
  private buf: Float32Array;
  private attr: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  /** one-frame sprites (light glows) appended after the simulated ones */
  private transient: number[] = [];
  private nTransient = 0;

  constructor(max: number, material: THREE.ShaderMaterial, renderOrder: number) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f();
    this.s0 = f(); this.s1 = f(); this.a0 = f();
    this.rot = f(); this.rotV = f(); this.drag = f(); this.dragV = f(); this.grav = f(); this.stretch = f();
    this.r = f(); this.g = f(); this.b = f();
    this.ground = f(); this.cell = f(); this.erode = f(); this.windK = f(); this.fadeIn = f(); this.bounce = f();

    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    // three needs a 'position' attribute to know the vertex count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new Float32Array((max + 256) * STRIDE);
    this.attr = new THREE.InstancedInterleavedBuffer(this.buf, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.attr, 3, 0));
    geo.setAttribute('iVel', new THREE.InterleavedBufferAttribute(this.attr, 3, 3));
    geo.setAttribute('iData', new THREE.InterleavedBufferAttribute(this.attr, 4, 6));
    geo.setAttribute('iTint', new THREE.InterleavedBufferAttribute(this.attr, 4, 10));
    geo.setAttribute('iMisc', new THREE.InterleavedBufferAttribute(this.attr, 4, 14));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, s0: number, s1: number, a0: number, r: number, g: number, b: number,
    drag: number, grav: number, stretch: number, ground: number, erode = 0.5, windK = 1, fadeIn = 0.08, dragV = -1, bounce = 0, preAge = 0,
  ) {
    let i = this.count;
    if (i >= this.max) {
      // replace the oldest of a few random candidates
      i = (Math.random() * this.max) | 0;
      for (let k = 0; k < 3; k++) {
        const j = (Math.random() * this.max) | 0;
        if (this.life[j] / this.maxLife[j] > this.life[i] / this.maxLife[i]) i = j;
      }
    } else this.count++;
    this.px[i] = x + vx * preAge; this.py[i] = y + vy * preAge; this.pz[i] = z + vz * preAge;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = preAge; this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.rot[i] = Math.random() * Math.PI * 2; this.rotV[i] = (Math.random() - 0.5) * 0.7;
    this.drag[i] = drag; this.dragV[i] = dragV < 0 ? drag : dragV; this.grav[i] = grav; this.stretch[i] = stretch;
    this.r[i] = r; this.g[i] = g; this.b[i] = b;
    this.ground[i] = ground; this.cell[i] = (Math.random() * 4) | 0; this.erode[i] = erode; this.windK[i] = windK;
    this.fadeIn[i] = Math.max(0.005, fadeIn); this.bounce[i] = bounce;
  }

  addTransient(x: number, y: number, z: number, size: number, alpha: number, r: number, g: number, b: number, pull: number) {
    if (this.nTransient >= 256) return;
    const o = this.nTransient * 9;
    const t = this.transient;
    t[o] = x; t[o + 1] = y; t[o + 2] = z; t[o + 3] = size; t[o + 4] = alpha; t[o + 5] = r; t[o + 6] = g; t[o + 7] = b; t[o + 8] = pull;
    this.nTransient++;
  }

  update(dt: number, windX: number, windZ: number) {
    let n = this.count;
    if (dt > 0) {
      for (let i = 0; i < n; i++) {
        const l = (this.life[i] += dt);
        if (l >= this.maxLife[i]) {
          n--;
          this.copy(n, i);
          i--;
          continue;
        }
        const kh = 1 - Math.exp(-this.drag[i] * dt);
        const kv = Math.exp(-this.dragV[i] * dt);
        const wk = this.windK[i];
        this.vx[i] += (windX * wk - this.vx[i]) * kh;
        this.vz[i] += (windZ * wk - this.vz[i]) * kh;
        this.vy[i] = this.vy[i] * kv - this.grav[i] * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        if (this.bounce[i] > 0 && this.py[i] < this.ground[i] + 0.01 && this.vy[i] < 0) {
          this.py[i] = this.ground[i] + 0.01;
          this.vy[i] = -this.vy[i] * this.bounce[i];
          this.vx[i] *= 0.72;
          this.vz[i] *= 0.72;
        }
        this.rot[i] += this.rotV[i] * dt;
      }
      this.count = n;
    }
    const B = this.buf;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.pow(t, 0.4);
      const fi = this.fadeIn[i];
      const u = 1 - t;
      // fresh spray is the densest: a boost over the first ~20 % of life
      const young = u * u * u * u;
      const alpha = this.a0[i] * Math.min(1, t / fi) * u * Math.sqrt(u) * (1 + 0.8 * young * young);
      const o = i * STRIDE;
      B[o] = this.px[i]; B[o + 1] = this.py[i]; B[o + 2] = this.pz[i];
      B[o + 3] = this.vx[i]; B[o + 4] = this.vy[i]; B[o + 5] = this.vz[i];
      B[o + 6] = size; B[o + 7] = alpha; B[o + 8] = this.rot[i]; B[o + 9] = this.stretch[i];
      B[o + 10] = this.r[i]; B[o + 11] = this.g[i]; B[o + 12] = this.b[i]; B[o + 13] = this.ground[i];
      B[o + 14] = t; B[o + 15] = this.cell[i]; B[o + 16] = this.erode[i]; B[o + 17] = 0;
    }
    const tr = this.transient;
    for (let k = 0; k < this.nTransient; k++) {
      const o = (n + k) * STRIDE;
      const s = k * 9;
      B[o] = tr[s]; B[o + 1] = tr[s + 1]; B[o + 2] = tr[s + 2];
      B[o + 3] = 0; B[o + 4] = 0; B[o + 5] = 0;
      B[o + 6] = tr[s + 3]; B[o + 7] = tr[s + 4]; B[o + 8] = 0; B[o + 9] = 0;
      B[o + 10] = tr[s + 5]; B[o + 11] = tr[s + 6]; B[o + 12] = tr[s + 7]; B[o + 13] = 0;
      B[o + 14] = 0; B[o + 15] = 0; B[o + 16] = 0; B[o + 17] = tr[s + 8];
    }
    const total = n + this.nTransient;
    // keep the glows while paused (dt = 0: nobody re-adds them)
    if (dt > 0) this.nTransient = 0;
    this.attr.clearUpdateRanges();
    this.attr.addUpdateRange(0, total * STRIDE);
    this.attr.needsUpdate = true;
    this.geo.instanceCount = total;
  }

  private copy(from: number, to: number) {
    const arrs = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.s0, this.s1, this.a0, this.rot, this.rotV,
      this.drag, this.dragV, this.grav, this.stretch, this.r, this.g, this.b, this.ground, this.cell, this.erode, this.windK, this.fadeIn, this.bounce];
    for (const a of arrs) a[to] = a[from];
  }

  clear() {
    this.count = 0;
    this.nTransient = 0;
    this.geo.instanceCount = 0;
  }

  get instanceCount() {
    return this.geo.instanceCount;
  }
}

export interface FxLighting {
  /** direction TO the sun (world, normalised) */
  sunDir: THREE.Vector3;
  /** sun colour × intensity (linear) */
  sunColor: THREE.Color;
  /** sky/haze radiance that lights the spray from all around (linear) */
  ambient: THREE.Color;
}

export class Particles {
  readonly group = new THREE.Group();
  readonly softMat: THREE.ShaderMaterial;
  readonly hotMat: THREE.ShaderMaterial;
  readonly veil: SprayVeil;
  /**
   * Resolution of the soft-particle pass relative to the frame (0.5 = half res,
   * a quarter of the fill cost). 1 renders at full res; 0 draws them straight
   * into the main pass (no scene-depth softening).
   */
  resolution = 0.5;
  /** …but never more than this many rows (bounds the fill cost on hi-dpi / 4K) */
  maxRows = 560;
  private soft: Pool;
  private hot: Pool;
  private halo: Pool;
  private readonly haloMat: THREE.ShaderMaterial;
  private softScene = new THREE.Scene();
  private composite: THREE.Mesh;
  private compositeMat: THREE.ShaderMaterial;
  private lowRT: THREE.WebGLRenderTarget | null = null;
  private depthUniforms = {
    uDepth: { value: null as THREE.Texture | null },
    uInvRes: { value: new THREE.Vector2(1, 1) },
    uClip: { value: new THREE.Vector2(0.1, 1000) },
    uUseDepth: { value: 0 },
  };
  private warned = false;
  /** debug: time the soft pass on the GPU (EXT_disjoint_timer_query_webgl2); samples in ms */
  gpuTiming = false;
  readonly gpuSamples: number[] = [];
  private tq: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined;
  private queries: WebGLQuery[] = [];
  private windX = 0;
  private windZ = 0;
  private fallback = new THREE.Color(1, 1, 1);
  private manual: FxLighting | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private sunSearch = 0;
  private lastCam = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private haveCam = false;
  private lastDt = 1 / 60;
  /** world direction of the camera that last rendered the particles */
  readonly cameraDirection = new THREE.Vector3(0, 0, -1);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector2();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  // sky irradiance probe (a white lambert sphere lit only by scene.environment)
  private probe: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.MeshStandardMaterial; rt: THREE.WebGLRenderTarget; buf: Float32Array } | null = null;
  private probeEnv: THREE.Texture | null = null;
  private probeIntensity = -1;
  private probeT = 0;
  private skyAmbient = new THREE.Color(-1, -1, -1);
  private readonly lighting: FxLighting = { sunDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(), sunColor: new THREE.Color(2, 2, 2), ambient: new THREE.Color(0.8, 0.84, 0.9) };

  constructor(opts: { maxSoft?: number; maxHot?: number } = {}) {
    const fog = aerialUniforms();
    this.softMat = new THREE.ShaderMaterial({
      name: 'fx-soft',
      vertexShader: SOFT_VERT,
      fragmentShader: SOFT_FRAG,
      uniforms: {
        ...fog,
        ...this.depthUniforms,
        uAtlas: { value: puffAtlas() },
        uSunDir: { value: this.lighting.sunDir },
        uSunCol: { value: new THREE.Vector3() },
        uAmb: { value: new THREE.Vector3() },
        uCamVel: { value: this.camVel },
        uNear: { value: new THREE.Vector2(0.8, 4.0) },
        uMaxProj: { value: 0.3 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: true,
    });
    premulBlend(this.softMat);
    this.hotMat = new THREE.ShaderMaterial({
      name: 'fx-hot',
      vertexShader: HOT_VERT,
      fragmentShader: HOT_FRAG,
      uniforms: { uCamVel: { value: this.camVel }, uPx: { value: 2 / 1080 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.soft = new Pool(opts.maxSoft ?? 4096, this.softMat, 10);
    this.hot = new Pool(opts.maxHot ?? 2048, this.hotMat, 12);
    this.haloMat = new THREE.ShaderMaterial({
      name: 'fx-halo',
      vertexShader: HOT_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { ...this.depthUniforms, uCamVel: { value: this.camVel }, uPx: this.hotMat.uniforms.uPx },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.halo = new Pool(256, this.haloMat, 11);
    this.veil = new SprayVeil(this.depthUniforms);
    premulBlend(this.veil.material);
    this.softScene.add(this.veil.mesh, this.soft.mesh, this.halo.mesh);
    this.softScene.matrixWorldAutoUpdate = true;

    // full-screen triangle that composites the low-res soft layer (premultiplied)
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.compositeMat = new THREE.ShaderMaterial({
      name: 'fx-composite',
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: { uTex: { value: null }, uOn: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.composite = new THREE.Mesh(tri, this.compositeMat);
    this.composite.name = 'fx-soft-composite';
    this.composite.frustumCulled = false;
    this.composite.renderOrder = 10;
    this.composite.onBeforeRender = (renderer, scene, camera) => this.renderSoft(renderer, scene, camera as THREE.PerspectiveCamera);

    this.group.name = 'fx';
    this.group.add(this.composite, this.hot.mesh);
  }

  // ---------------------------------------------------------------------------- lighting
  /** legacy: tint used when the scene has neither fog nor a sun */
  setLight(c: THREE.Color) {
    this.fallback.copy(c);
  }

  /** push lighting explicitly (otherwise it's read from the scene every frame) */
  setLighting(l: FxLighting | null) {
    this.manual = l;
  }

  setWind(x: number, z: number) {
    this.windX = x;
    this.windZ = z;
  }

  /**
   * Called from the composite quad's onBeforeRender, i.e. inside the main render
   * after all opaque geometry: render the soft puffs + veil into a low-res target
   * (depth-tested in the shader against the main pass's depth texture), then let
   * the quad blend it over the frame. Same nested-render pattern as three's Reflector.
   */
  private renderSoft(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.beforeRender(renderer, scene, camera);
    const cur = renderer.getRenderTarget();
    const depth = cur?.depthTexture ?? null;
    const du = this.depthUniforms;
    du.uClip.value.set(camera.near, camera.far);
    this.softScene.fog = scene.fog;
    const nothing = this.soft.instanceCount === 0 && this.halo.instanceCount === 0 && !this.veil.mesh.visible;
    // (the composite's own visibility is set in update(): hiding it here would stop this callback)
    const direct = this.resolution <= 0 || !depth;
    if (!depth && !this.warned && this.resolution > 0) {
      this.warned = true;
      console.warn('[fx] no depth texture on the main render target: soft particles drawn at full res without scene-depth softening');
    }
    const xr = renderer.xr.enabled;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const autoClear = renderer.autoClear;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    if (direct) {
      // straight into the current target, hardware depth test against the scene
      this.compositeMat.uniforms.uOn.value = 0;
      du.uUseDepth.value = 0;
      this.softMat.depthTest = true;
      this.haloMat.depthTest = true;
      this.veil.material.depthTest = true;
      if (!nothing) renderer.render(this.softScene, camera);
    } else {
      const k = Math.min(this.resolution, this.maxRows / cur!.height);
      const w = Math.max(1, Math.round(cur!.width * k));
      const h = Math.max(1, Math.round(cur!.height * k));
      if (!this.lowRT) {
        this.lowRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
        this.lowRT.texture.name = 'fx-soft-lowres';
      } else if (this.lowRT.width !== w || this.lowRT.height !== h) this.lowRT.setSize(w, h);
      this.compositeMat.uniforms.uOn.value = nothing ? 0 : 1;
      this.compositeMat.uniforms.uTex.value = this.lowRT.texture;
      du.uDepth.value = depth;
      du.uUseDepth.value = 1;
      du.uInvRes.value.set(1 / w, 1 / h);
      this.softMat.depthTest = false;
      this.haloMat.depthTest = false;
      this.veil.material.depthTest = false;
      if (!nothing) {
        renderer.getClearColor(this.tmpC);
        const ca = renderer.getClearAlpha();
        const gl = this.gpuTiming ? (renderer.getContext() as WebGL2RenderingContext) : null;
        let q: WebGLQuery | null = null;
        if (gl) {
          if (this.tq === undefined) this.tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          if (this.tq && this.queries.length < 6) {
            q = gl.createQuery()!;
            gl.beginQuery(this.tq.TIME_ELAPSED_EXT, q);
          }
        }
        renderer.setRenderTarget(this.lowRT);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
        renderer.render(this.softScene, camera);
        if (gl && this.tq) {
          if (q) {
            gl.endQuery(this.tq.TIME_ELAPSED_EXT);
            this.queries.push(q);
          }
          while (this.queries.length && gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
            const r = gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT) as number;
            if (!gl.getParameter(this.tq.GPU_DISJOINT_EXT)) this.gpuSamples.push(r / 1e6);
            if (this.gpuSamples.length > 240) this.gpuSamples.shift();
            gl.deleteQuery(this.queries.shift()!);
          }
        }
        renderer.setClearColor(this.tmpC, ca);
        renderer.setRenderTarget(cur);
      }
    }
    renderer.xr.enabled = xr;
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.autoClear = autoClear;
  }

  private beforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // camera velocity for relative streaks
    const cp = camera.getWorldPosition(this.tmpA);
    if (this.haveCam) {
      this.tmpB.subVectors(cp, this.lastCam).divideScalar(Math.max(1e-3, this.lastDt));
      if (this.tmpB.lengthSq() > 160 * 160) this.tmpB.set(0, 0, 0);
      this.camVel.lerp(this.tmpB, 0.5);
    }
    this.lastCam.copy(cp);
    this.haveCam = true;
    camera.getWorldDirection(this.cameraDirection);

    const L = this.lighting;
    if (this.manual) {
      L.sunDir.copy(this.manual.sunDir);
      L.sunColor.copy(this.manual.sunColor);
      L.ambient.copy(this.manual.ambient);
    } else {
      if (!this.sun || !this.sun.parent) {
        if (this.sunSearch-- <= 0) {
          this.sun = null;
          scene.traverse((o) => {
            const d = o as THREE.DirectionalLight;
            if (!this.sun && d.isDirectionalLight && d.castShadow && d.visible) this.sun = d;
          });
          this.sunSearch = 90;
        }
      }
      if (this.sun) {
        this.sun.getWorldPosition(this.tmpA);
        this.sun.target.getWorldPosition(this.tmpB);
        L.sunDir.subVectors(this.tmpA, this.tmpB).normalize();
        L.sunColor.copy(this.sun.color).multiplyScalar(this.sun.intensity);
      } else {
        L.sunColor.setRGB(0, 0, 0);
      }
      // sky light: measured from the environment map when there is one, else the haze colour
      const env = scene.environment;
      const now = performance.now();
      if (env && (env !== this.probeEnv || scene.environmentIntensity !== this.probeIntensity) && now - this.probeT > 800) {
        this.probeT = now;
        this.probeEnv = env;
        this.probeIntensity = scene.environmentIntensity;
        this.measureSky(renderer, env, scene.environmentIntensity);
      }
      const fog = scene.fog as THREE.Fog | THREE.FogExp2 | null;
      if (env && this.skyAmbient.r >= 0) {
        L.ambient.copy(this.skyAmbient);
        // lean toward the haze tint so spray sits in the same air as the fog
        if (fog) L.ambient.lerp(this.tmpC.copy(fog.color).multiplyScalar(Math.max(1e-3, lum(this.skyAmbient)) / Math.max(1e-3, lum(fog.color))), 0.35);
      } else if (fog) L.ambient.copy(fog.color);
      else L.ambient.copy(this.fallback).multiplyScalar(0.8);
      // lightning lights up the spray
      const flash = weatherUniforms.uLightning.value;
      if (flash > 0) L.ambient.multiplyScalar(1 + flash * 2.5);
    }
    const u = this.softMat.uniforms;
    // π: the sun term in the shader is a lambert-ish radiance
    (u.uSunCol.value as THREE.Vector3).set(L.sunColor.r, L.sunColor.g, L.sunColor.b).multiplyScalar(1 / Math.PI);
    (u.uAmb.value as THREE.Vector3).set(L.ambient.r, L.ambient.g, L.ambient.b);
    const size = renderer.getDrawingBufferSize(this.tmpV2);
    this.hotMat.uniforms.uPx.value = 2 / Math.max(1, size.y);
    this.veil.setLighting(L);
  }

  /** average radiance a white diffuse blob receives from scene.environment (one GPU readback) */
  private measureSky(renderer: THREE.WebGLRenderer, env: THREE.Texture, intensity: number) {
    if (!this.probe) {
      const scene = new THREE.Scene();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat));
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      cam.position.set(0, 0.35, 3);
      cam.lookAt(0, 0, 0);
      const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.FloatType, depthBuffer: true });
      this.probe = { scene, cam, mat, rt, buf: new Float32Array(16 * 16 * 4) };
    }
    const pr = this.probe;
    pr.mat.envMap = env;
    pr.mat.envMapIntensity = intensity;
    pr.mat.needsUpdate = true;
    const cur = renderer.getRenderTarget();
    renderer.getClearColor(this.tmpC);
    const ca = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(pr.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(pr.scene, pr.cam);
    renderer.readRenderTargetPixels(pr.rt, 0, 0, 16, 16, pr.buf);
    renderer.setRenderTarget(cur);
    renderer.setClearColor(this.tmpC, ca);
    renderer.autoClear = autoClear;
    let r = 0, g = 0, b = 0, n = 0;
    const B = pr.buf;
    for (let i = 0; i < 256; i++) {
      if (B[i * 4 + 3] < 0.5) continue;
      r += B[i * 4];
      g += B[i * 4 + 1];
      b += B[i * 4 + 2];
      n++;
    }
    if (n > 0 && isFinite(r + g + b)) this.skyAmbient.setRGB(r / n, g / n, b / n);
  }

  /** current lighting (read by the veil and the rain-light glows) */
  get light(): FxLighting {
    return this.lighting;
  }

  // ---------------------------------------------------------------------------- emitters
  smoke(p: THREE.Vector3, v: THREE.Vector3, amount: number, ground = p.y - 0.36) {
    const k = 0.86 + Math.random() * 0.1;
    this.soft.spawn(
      p.x + (Math.random() - 0.5) * 0.3, p.y - 0.12, p.z + (Math.random() - 0.5) * 0.3,
      v.x * 0.4 + (Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 0.9, v.z * 0.4 + (Math.random() - 0.5) * 1.6,
      1.6 + Math.random() * 1.6, 0.35, 2.2 + Math.random() * 1.6, 0.3 * amount, k, k, k * 1.02, 1.5, -0.3, 0, ground, 0.55, 1, 0.1,
    );
  }

  dust(p: THREE.Vector3, v: THREE.Vector3, gravel: boolean, amount: number, ground = p.y - 0.36) {
    const r = gravel ? 0.62 : 0.4, g = gravel ? 0.54 : 0.36, b = gravel ? 0.42 : 0.24;
    this.soft.spawn(
      p.x + (Math.random() - 0.5) * 0.6, p.y - 0.15, p.z + (Math.random() - 0.5) * 0.6,
      v.x * 0.3 + (Math.random() - 0.5) * 2.4, 1 + Math.random() * 2, v.z * 0.3 + (Math.random() - 0.5) * 2.4,
      1.0 + Math.random() * 1.2, 0.4, 2.2 + Math.random() * 1.6, 0.42 * amount, r, g, b, 1.3, 0.5, 0, ground, 0.6, 1, 0.06,
    );
    if (gravel && Math.random() < 0.5) {
      // flung stones: short dark streaks that fall back
      this.soft.spawn(
        p.x, p.y - 0.2, p.z,
        v.x * 0.5 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, v.z * 0.5 + (Math.random() - 0.5) * 4,
        0.45, 0.05, 0.06, 0.8 * amount, 0.25, 0.22, 0.18, 0.5, 9.8, 0.02, ground, 0, 0, 0.02,
      );
    }
  }

  sparks(p: THREE.Vector3, v: THREE.Vector3, count: number, ground = p.y - 0.03) {
    for (let i = 0; i < count; i++) {
      const heat = 0.55 + Math.random() * 0.45;
      this.hot.spawn(
        p.x + (Math.random() - 0.5) * 0.5, p.y + 0.02, p.z + (Math.random() - 0.5) * 0.5,
        v.x * (0.5 + Math.random() * 0.35) + (Math.random() - 0.5) * 5, 0.4 + Math.random() * 3.2, v.z * (0.5 + Math.random() * 0.35) + (Math.random() - 0.5) * 5,
        0.22 + Math.random() * 0.4, 0.016, 0.008, 1, 26 * heat, 10 * heat * heat, 2.4 * heat * heat, 1.6, 9.8, 0.022, ground, 0, 0, 0.01, 0.2, 0.3,
      );
    }
  }

  /** generic soft puff (spray): see Spray.ts for the recipes */
  puff(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, s0: number, s1: number, alpha: number, bright: number, drag: number, grav: number, stretch: number,
    ground: number, erode: number, fadeIn: number, dragV: number, preAge: number,
  ) {
    this.soft.spawn(x, y, z, vx, vy, vz, life, s0, s1, alpha, bright, bright, bright * 1.02, drag, grav, stretch, ground, erode, 1, fadeIn, dragV, 0, preAge);
  }

  /** a light glow for this frame only (HDR colour, blooms); pull = metres toward the camera */
  glow(p: THREE.Vector3, size: number, r: number, g: number, b: number, alpha = 1, pull = 0.3) {
    this.hot.addTransient(p.x, p.y, p.z, size, alpha, r, g, b, pull);
  }

  /** a lamp's light scattered in the surrounding spray/mist, this frame only (soft, depth-faded) */
  haloGlow(p: THREE.Vector3, size: number, r: number, g: number, b: number, alpha = 1) {
    this.halo.addTransient(p.x, p.y, p.z, size, alpha, r, g, b, 0.6);
  }

  update(dt: number) {
    if (dt > 0) this.lastDt = dt;
    this.soft.update(dt, this.windX, this.windZ);
    this.hot.update(dt, this.windX * 0.2, this.windZ * 0.2);
    this.halo.update(dt, 0, 0);
    this.veil.update(dt, this.windX, this.windZ);
    this.composite.visible = this.soft.instanceCount > 0 || this.halo.instanceCount > 0 || this.veil.mesh.visible;
  }

  clear() {
    this.soft.clear();
    this.hot.clear();
    this.halo.clear();
    this.veil.clear();
  }

  dispose() {
    this.lowRT?.dispose();
    this.probe?.rt.dispose();
    this.probe?.mat.dispose();
    this.softMat.dispose();
    this.hotMat.dispose();
    this.compositeMat.dispose();
    this.haloMat.dispose();
    this.veil.material.dispose();
  }

  get stats() {
    return { soft: this.soft.count, hot: this.hot.count };
  }
}
