import * as THREE from 'three';
import { aerialUniforms } from '../../world/env/fog.ts';

/**
 * Soft particles for the open world: the cold-gas vapour of the Roadster's thrusters, tyre smoke,
 * gun smoke and muzzle flashes, dust and sparks where bullets land, fire and smoke from wrecks,
 * explosions.
 *
 * Two pools, each one instanced draw: `smoke` (alpha-blended, lit by the sky and the sun, darker
 * underneath) and `glow` (additive: fire, flashes, sparks, tracers). The CPU steps every particle
 * (drag, buoyancy, gravity, wind, the ground) and writes the instance buffers once a frame.
 */

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** seconds */
  life: number;
  /** start / end size (m) */
  s0: number;
  s1: number;
  /** peak opacity */
  a?: number;
  /** colour (linear) */
  r?: number;
  g?: number;
  b?: number;
  /** velocity damping per second, upward acceleration (m/s²), gravity scale */
  drag?: number;
  lift?: number;
  grav?: number;
  /** the ground under it: on reaching it a falling particle spreads out along it */
  floor?: number;
  /** fraction of the life spent fading in */
  fadeIn?: number;
  /** stretch along the velocity (sparks, tracers) */
  stretch?: number;
  spin?: number;
}

const MAXS = 6000;
const MAXG = 2500;

interface Pool {
  n: number;
  cap: number;
  // state
  p: Float32Array; // x y z
  v: Float32Array; // vx vy vz
  age: Float32Array;
  life: Float32Array;
  s: Float32Array; // s0 s1
  a: Float32Array;
  c: Float32Array; // r g b
  k: Float32Array; // drag lift grav floor
  f: Float32Array; // fadeIn stretch spin rot
  // instance attributes
  iPos: THREE.InstancedBufferAttribute;
  iVel: THREE.InstancedBufferAttribute;
  iSize: THREE.InstancedBufferAttribute;
  iCol: THREE.InstancedBufferAttribute;
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
}

let puffTex: THREE.DataTexture | null = null;
/** a 2×2 atlas of soft, lumpy puffs (value noise, fbm) — 128 px each */
function puffAtlas(): THREE.DataTexture {
  if (puffTex) return puffTex;
  const S = 256, H = 128;
  const data = new Uint8Array(S * S * 4);
  const hash = (x: number, y: number, s: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const noise = (x: number, y: number, s: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * H, oy = Math.floor(q / 2) * H;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < H; x++) {
        const nx = x / H - 0.5, ny = y / H - 0.5;
        const r = Math.hypot(nx, ny) * 2;
        let n = 0, amp = 0.5, fr = 4;
        for (let o = 0; o < 5; o++) {
          n += noise(nx * fr + q * 13.1, ny * fr + q * 7.7, q) * amp;
          amp *= 0.5;
          fr *= 2;
        }
        // a soft round body, eroded at its edge by the noise
        const body = Math.max(0, 1 - r * r * (1.05 + (0.5 - n) * 0.9));
        const alpha = Math.pow(body, 1.4) * (0.55 + n * 0.9);
        // a normal-ish shade: lighter toward the top (the sprite's +y)
        const shade = 0.72 + 0.28 * (0.5 - ny) + (n - 0.5) * 0.3;
        const i = ((oy + y) * S + ox + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, shade * 255));
        data[i + 3] = Math.max(0, Math.min(255, alpha * 255));
      }
  }
  puffTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  puffTex.magFilter = THREE.LinearFilter;
  puffTex.minFilter = THREE.LinearMipmapLinearFilter;
  puffTex.generateMipmaps = true;
  puffTex.needsUpdate = true;
  return puffTex;
}

const VERT = /* glsl */ `
attribute vec4 iPos;   // xyz, rotation
attribute vec4 iVel;   // velocity xyz, stretch
attribute vec2 iSize;  // size, atlas cell
attribute vec4 iCol;   // rgb, alpha
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vec4 mv = modelViewMatrix * vec4( iPos.xyz, 1.0 );
  float s = iSize.x;
  // pulled toward the camera by half its size: a puff lying on the road isn't cut off by it
  mv.xyz += normalize( -mv.xyz ) * min( s * 0.5, -mv.z * 0.5 );
  vec2 c = position.xy;
  // spin, or stretch along the screen-space velocity (sparks, tracers)
  vec3 vv = ( viewMatrix * vec4( iVel.xyz, 0.0 ) ).xyz;
  float vl = length( vv.xy );
  vec2 off;
  if ( iVel.w > 0.0 && vl > 0.01 ) {
    vec2 d = vv.xy / vl;
    vec2 n = vec2( -d.y, d.x );
    off = d * c.y * s * ( 1.0 + iVel.w * vl ) + n * c.x * s;
  } else {
    float cr = cos( iPos.w ), sr = sin( iPos.w );
    off = vec2( c.x * cr - c.y * sr, c.x * sr + c.y * cr ) * s;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float cell = iSize.y;
  vUv = ( position.xy + 0.5 ) * 0.5 + vec2( mod( cell, 2.0 ), floor( cell / 2.0 ) ) * 0.5;
  vCol = iCol;
  // the top of a puff (world up, on screen) catches more light
  vShade = 0.5 + 0.5 * dot( normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xy + 1e-4 ), normalize( c + 1e-4 ) ) * length( c ) * 2.0;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const FRAG_SMOKE = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uSky;
uniform vec3 uSun;
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( uTex, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.004 ) discard;
  vec3 lit = uSky * ( 0.55 + 0.45 * t.r ) + uSun * ( 0.25 + 0.75 * vShade ) * t.r;
  gl_FragColor = vec4( vCol.rgb * lit, a );
  #include <fog_fragment>
}`;

const FRAG_GLOW = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
void main() {
  vec4 t = texture2D( uTex, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vCol.rgb * a, 0.0 );
}`;

function makePool(cap: number, glow: boolean, uniforms: Record<string, THREE.IUniform>): Pool {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iVel', iVel);
  geo.setAttribute('iSize', iSize);
  geo.setAttribute('iCol', iCol);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: glow ? {} : aerialUniforms(),
    vertexShader: VERT,
    fragmentShader: glow ? FRAG_GLOW : FRAG_SMOKE,
    transparent: true,
    depthWrite: false,
    fog: !glow,
    blending: glow ? THREE.CustomBlending : THREE.NormalBlending,
  });
  if (glow) {
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
  }
  // (shared uniforms by reference: the light follows the time of day)
  Object.assign(mat.uniforms, uniforms);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = glow ? 9100 : 9050;
  mesh.name = glow ? 'fx-glow' : 'fx-smoke';
  return {
    n: 0, cap,
    p: new Float32Array(cap * 3), v: new Float32Array(cap * 3), age: new Float32Array(cap), life: new Float32Array(cap),
    s: new Float32Array(cap * 2), a: new Float32Array(cap), c: new Float32Array(cap * 3), k: new Float32Array(cap * 4), f: new Float32Array(cap * 4),
    iPos, iVel, iSize, iCol, mesh, geo,
  };
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly smoke: Pool;
  private readonly glow: Pool;
  readonly uniforms = {
    uTex: { value: puffAtlas() as THREE.Texture },
    uSky: { value: new THREE.Color(0.75, 0.8, 0.88) },
    uSun: { value: new THREE.Color(0.9, 0.85, 0.75) },
  };
  /** the wind (m/s), drifting the smoke */
  readonly wind = new THREE.Vector3(1.2, 0, 0.6);
  private seed = 1;

  constructor() {
    this.group.name = 'Particles';
    this.smoke = makePool(MAXS, false, this.uniforms);
    this.glow = makePool(MAXG, true, this.uniforms);
    this.group.add(this.smoke.mesh, this.glow.mesh);
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** the light on the smoke: the sky's colour and the sun's (scaled by how much there is) */
  setLight(night: number, direct: number) {
    const d = (1 - night) * direct;
    this.uniforms.uSky.value.setRGB(0.12 + 0.6 * (1 - night), 0.13 + 0.64 * (1 - night), 0.17 + 0.68 * (1 - night));
    this.uniforms.uSun.value.setRGB(0.95 * d, 0.88 * d, 0.76 * d);
  }

  private add(P: Pool, e: Emit) {
    if (P.n >= P.cap) return;
    const i = P.n++;
    P.p[i * 3] = e.x;
    P.p[i * 3 + 1] = e.y;
    P.p[i * 3 + 2] = e.z;
    P.v[i * 3] = e.vx ?? 0;
    P.v[i * 3 + 1] = e.vy ?? 0;
    P.v[i * 3 + 2] = e.vz ?? 0;
    P.age[i] = 0;
    P.life[i] = e.life;
    P.s[i * 2] = e.s0;
    P.s[i * 2 + 1] = e.s1;
    P.a[i] = e.a ?? 1;
    P.c[i * 3] = e.r ?? 1;
    P.c[i * 3 + 1] = e.g ?? 1;
    P.c[i * 3 + 2] = e.b ?? 1;
    P.k[i * 4] = e.drag ?? 0;
    P.k[i * 4 + 1] = e.lift ?? 0;
    P.k[i * 4 + 2] = e.grav ?? 0;
    P.k[i * 4 + 3] = e.floor ?? -1e9;
    P.f[i * 4] = e.fadeIn ?? 0.1;
    P.f[i * 4 + 1] = e.stretch ?? 0;
    P.f[i * 4 + 2] = e.spin ?? (this.rand() - 0.5) * 1.2;
    P.f[i * 4 + 3] = this.rand() * 6.28;
    // (the atlas cell rides in the size attribute)
    P.iSize.array[i * 2 + 1] = Math.floor(this.rand() * 4);
  }

  puff(e: Emit) {
    this.add(this.smoke, e);
  }

  spark(e: Emit) {
    this.add(this.glow, e);
  }

  get count() {
    return this.smoke.n + this.glow.n;
  }

  update(dt: number) {
    for (const P of [this.smoke, this.glow]) this.step(P, dt);
  }

  private step(P: Pool, dt: number) {
    const W = this.wind;
    let j = 0;
    const pos = P.iPos.array as Float32Array, vel = P.iVel.array as Float32Array, size = P.iSize.array as Float32Array, col = P.iCol.array as Float32Array;
    for (let i = 0; i < P.n; i++) {
      const age = P.age[i] + dt;
      const life = P.life[i];
      if (age >= life) continue;
      // move (compacting the live ones to the front as we go)
      const i3 = i * 3, j3 = j * 3;
      let vx = P.v[i3], vy = P.v[i3 + 1], vz = P.v[i3 + 2];
      const drag = P.k[i * 4], lift = P.k[i * 4 + 1], grav = P.k[i * 4 + 2], floor = P.k[i * 4 + 3];
      const kd = Math.exp(-drag * dt);
      // drag pulls toward the wind, not toward rest
      vx = W.x + (vx - W.x) * kd;
      vz = W.z + (vz - W.z) * kd;
      vy = vy * kd + (lift - 9.81 * grav) * dt;
      let x = P.p[i3] + vx * dt, y = P.p[i3 + 1] + vy * dt, z = P.p[i3 + 2] + vz * dt;
      if (y < floor) {
        // a jet hitting the ground fans out along it (and a spark bounces)
        y = floor;
        if (vy < 0) {
          if (grav > 0) vy = -vy * 0.3;
          else {
            const h = Math.hypot(vx, vz);
            const sp = -vy * 0.4;
            if (h > 0.01) {
              vx += (vx / h) * sp;
              vz += (vz / h) * sp;
            } else {
              const a = this.rand() * 6.283;
              vx += Math.cos(a) * sp;
              vz += Math.sin(a) * sp;
            }
            vy = 0.4;
          }
        }
      }
      P.p[j3] = x;
      P.p[j3 + 1] = y;
      P.p[j3 + 2] = z;
      P.v[j3] = vx;
      P.v[j3 + 1] = vy;
      P.v[j3 + 2] = vz;
      P.age[j] = age;
      P.life[j] = life;
      P.s[j * 2] = P.s[i * 2];
      P.s[j * 2 + 1] = P.s[i * 2 + 1];
      P.a[j] = P.a[i];
      P.c[j3] = P.c[i3];
      P.c[j3 + 1] = P.c[i3 + 1];
      P.c[j3 + 2] = P.c[i3 + 2];
      for (let q = 0; q < 4; q++) {
        P.k[j * 4 + q] = P.k[i * 4 + q];
        P.f[j * 4 + q] = P.f[i * 4 + q];
      }
      const t = age / life;
      const fin = P.f[j * 4];
      const rot = (P.f[j * 4 + 3] += P.f[j * 4 + 2] * dt);
      // size grows fast then slows (a puff spreading); opacity fades in, then out
      const g = 1 - (1 - t) * (1 - t);
      const s = P.s[j * 2] + (P.s[j * 2 + 1] - P.s[j * 2]) * g;
      const al = P.a[j] * (fin > 0 ? Math.min(1, t / fin) : 1) * (1 - t) * (1 - t * 0.3);
      pos[j * 4] = x;
      pos[j * 4 + 1] = grav > 0 ? y : Math.max(y, floor + s * 0.28);
      pos[j * 4 + 2] = z;
      pos[j * 4 + 3] = rot;
      vel[j * 4] = vx;
      vel[j * 4 + 1] = vy;
      vel[j * 4 + 2] = vz;
      vel[j * 4 + 3] = P.f[j * 4 + 1];
      size[j * 2] = s;
      size[j * 2 + 1] = size[i * 2 + 1];
      col[j * 4] = P.c[j3];
      col[j * 4 + 1] = P.c[j3 + 1];
      col[j * 4 + 2] = P.c[j3 + 2];
      col[j * 4 + 3] = al;
      j++;
    }
    P.n = j;
    P.geo.instanceCount = j;
    for (const a of [P.iPos, P.iVel, P.iSize, P.iCol]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, j * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

/** the shared particle system (one per world) */
export const fx = { p: null as Particles | null };
