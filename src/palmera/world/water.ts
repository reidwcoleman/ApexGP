import * as THREE from 'three';
import { WATER_Y, WORLD, MAIN, ISLAND } from './map';
import type { SkySystem } from './sky';

const vert = /* glsl */ `
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uDay;
uniform float uNight;
uniform sampler2D uMask;
uniform vec4 uRect;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uRotA;
uniform float uRotB;
uniform float uMix;
uniform float uLevel;
uniform float uHasPhoto;
varying vec3 vWPos;
vec3 skyPhoto(sampler2D t, vec3 d, float rot) {
  float az = atan(d.z, d.x) + rot;
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(fract(az / 6.2831853 + 0.5), 0.5 + el / 3.14159265);
  return min(texture2D(t, uv).rgb, vec3(6.0));
}
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), f.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), f.x), f.y); }
#include <fog_pars_fragment>
vec2 wv(vec2 p, vec2 dir, float f, float a, float s) {
  float ph = dot(p, dir) * f + uTime * s;
  return dir * (a * f * cos(ph));
}
void main() {
  vec2 p = vWPos.xz;
  vec2 g = vec2(0.0);
  g += wv(p, normalize(vec2(0.8, 0.6)), 0.08, 0.35, 1.1);
  g += wv(p, normalize(vec2(-0.3, 1.0)), 0.13, 0.22, 1.5);
  g += wv(p, normalize(vec2(1.0, -0.2)), 0.31, 0.08, 2.3);
  g += wv(p, normalize(vec2(0.2, -1.0)), 0.57, 0.04, 3.1);
  g += wv(p, normalize(vec2(-0.7, -0.6)), 1.13, 0.018, 4.4);
  g += wv(p, normalize(vec2(0.5, 0.9)), 2.1, 0.009, 6.0);
  g += wv(p, normalize(vec2(-0.9, 0.4)), 3.7, 0.005, 8.1);
  g += wv(p, normalize(vec2(0.1, 1.0)), 6.3, 0.0028, 10.5);
  // fine chop: scrolling noise slopes
  float e = 0.35;
  vec2 q = p * 1.7 + vec2(uTime * 0.6, uTime * 0.35);
  float n0 = wNoise(q), nx = wNoise(q + vec2(e, 0.0)), nz = wNoise(q + vec2(0.0, e));
  vec2 q2 = p * 4.1 - vec2(uTime * 0.9, -uTime * 0.5);
  float m0 = wNoise(q2), mx = wNoise(q2 + vec2(e, 0.0)), mz = wNoise(q2 + vec2(0.0, e));
  g += vec2(nx - n0, nz - n0) * 0.11 + vec2(mx - m0, mz - m0) * 0.06;
  vec2 muv = (p - uRect.xy) / uRect.zw;
  float mask = 0.0;
  if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) mask = texture2D(uMask, muv).r;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWPos);
  float dist = length(cameraPosition - vWPos);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), clamp(dist / 900.0, 0.0, 0.7)));
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  r.y = max(abs(r.y), 0.015);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.5));
  if (uHasPhoto > 0.5) sky = mix(skyPhoto(tA, r, uRotA), skyPhoto(tB, r, uRotB), uMix) * uLevel;
  // at night the sea mirrors the navy sky, the city's glow on the horizon and a moon path
  sky += (vec3(0.006, 0.011, 0.026) + vec3(0.11, 0.06, 0.035) * exp(-r.y * 9.0)) * uNight;
  float light = 0.08 + 0.92 * uDay;
  vec3 deep = vec3(0.006, 0.07, 0.13);
  vec3 shallow = vec3(0.05, 0.42, 0.42);
  float sh = smoothstep(0.02, 0.5, mask);
  vec3 body = mix(deep, shallow, sh) * light;
  body += vec3(0.02, 0.07, 0.06) * max(n.x * 0.5 + 0.5, 0.0) * light;
  // light scattered up through the wave crests
  body += vec3(0.02, 0.12, 0.1) * pow(max(dot(normalize(vec3(g.x, 0.3, g.y)), -v), 0.0), 3.0) * light;
  vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0));
  float sd = max(dot(r, uSunDir), 0.0);
  float sunVis = smoothstep(-0.05, 0.05, uSunDir.y);
  col += uSunColor * (pow(sd, 400.0) * 9.0 + pow(sd, 60.0) * 0.35) * sunVis;
  vec3 moonD = normalize(vec3(-0.6, 0.35, -0.3));
  float md2 = max(dot(r, moonD), 0.0);
  col += vec3(0.7, 0.78, 0.95) * (pow(md2, 300.0) * 2.0 + pow(md2, 30.0) * 0.05) * uNight;
  float foamBand = smoothstep(0.38, 0.62, mask) * (1.0 - smoothstep(0.75, 0.95, mask));
  float foam = foamBand * (0.55 + 0.45 * sin(dot(p, vec2(0.06, 0.9)) * 0.7 + uTime * 1.6 + mask * 9.0));
  col = mix(col, vec3(0.92, 0.95, 0.95) * light, clamp(foam, 0.0, 1.0) * 0.35);
  // the surf on the beach: the sand shelves down evenly, so the depth here is known exactly
  if (p.x > ${ISLAND.x1.toFixed(1)} && p.y > ${(ISLAND.z0 + 4).toFixed(1)} && p.y < ${(ISLAND.z1 - 4).toFixed(1)}) {
    float depth = -0.8 + 3.2 * (p.x - ${ISLAND.x1.toFixed(1)}) / 88.0;
    if (depth < 3.0) {
      float nz = wNoise(vec2(p.y * 0.05, 0.0)) * 6.0 + wNoise(vec2(p.y * 0.19, 3.0)) * 1.6;
      float ph = (p.x - 734.0) * 0.38 + uTime * 1.2 + nz;
      float crest = pow(max(sin(ph), 0.0), 14.0);
      // waves break over the bar, not across 60 m of sea
      float breakZone = smoothstep(1.6, 0.8, depth) * smoothstep(0.12, 0.4, depth);
      float lace = wNoise(vec2(p.x * 1.3 - uTime * 0.4, p.y * 0.45)) * 0.6 + wNoise(p * 3.1 + uTime * 0.3) * 0.4;
      float surf = crest * breakZone * smoothstep(0.4, 0.68, lace) * 1.25;
      // the swash: a thin lacy sheet over the last few metres, and a moving foam line where it meets the sand
      float swash = smoothstep(0.3, 0.02, depth) * smoothstep(0.42, 0.78, lace);
      float run = 0.06 + 0.07 * sin(uTime * 0.7 + nz * 0.8);
      float edge = exp(-abs(depth - run) * 30.0) * (0.55 + 0.45 * lace);
      // clear shallows: sand showing through, turquoise further out
      float clear = smoothstep(1.5, 0.0, depth);
      vec3 seen = mix(vec3(0.16, 0.5, 0.48), vec3(0.6, 0.58, 0.42), smoothstep(0.6, 0.0, depth));
      col = mix(col, seen * light + sky * 0.05, clear * 0.62);
      col = mix(col, vec3(0.93, 0.96, 0.96) * light, clamp(surf + swash * 0.5 + edge, 0.0, 0.9));
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function makeLandMask(): THREE.CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const W = WORLD.x1 - WORLD.x0, H = WORLD.z1 - WORLD.z0;
  const tx = (x: number) => ((x - WORLD.x0) / W) * S;
  const tz = (z: number) => ((z - WORLD.z0) / H) * S;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = '#fff';
  ctx.fillRect(tx(MAIN.x0), tz(MAIN.z0), tx(MAIN.x1) - tx(MAIN.x0), tz(MAIN.z1) - tz(MAIN.z0));
  ctx.fillRect(tx(ISLAND.x0), tz(ISLAND.z0), tx(735) - tx(ISLAND.x0), tz(ISLAND.z1) - tz(ISLAND.z0));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  return t;
}

// ---------------------------------------------------------------- swash: the film that runs up the sand
const swashVert = /* glsl */ `
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const swashFrag = /* glsl */ `
uniform float uTime;
uniform float uDay;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uRotA;
uniform float uRotB;
uniform float uMix;
uniform float uLevel;
uniform float uHasPhoto;
varying vec3 vWPos;
vec3 skyPhoto(sampler2D t, vec3 d, float rot) {
  float az = atan(d.z, d.x) + rot;
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(fract(az / 6.2831853 + 0.5), 0.5 + el / 3.14159265);
  return min(texture2D(t, uv).rgb, vec3(6.0));
}
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), f.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), f.x), f.y); }
// distance to the nearest scattered point: small in a bubble's middle, large on the lace between bubbles
float worley(vec2 p){ vec2 i = floor(p), f = fract(p); float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(wHash(i + g), wHash(i + g + 17.3)); d = min(d, length(g + o - f)); }
  return d; }
#include <fog_pars_fragment>
void main() {
  float x = vWPos.x, z = vWPos.z;
  float off = wNoise(vec2(z * 0.025, 0.0)) * 1.7;
  float u = fract(uTime / 7.0 + off);
  float cyc = floor(uTime / 7.0 + off);
  float up = smoothstep(0.0, 0.2, u) * (1.0 - smoothstep(0.2, 1.0, u));
  float A = 4.5 + 3.0 * wNoise(vec2(z * 0.07, cyc * 3.1));
  float edge = 734.0 - A * up - (wNoise(vec2(z * 0.5, cyc)) - 0.5) * 0.9;
  float reach = 734.0 - 7.6 - wNoise(vec2(z * 0.05, 7.0)) * 1.2;
  float light = 0.08 + 0.92 * uDay;
  vec4 c = vec4(0.0);
  if (x > edge) {
    // the thin water: see-through over the sand, a sheen of sky at low angles and the sun's glints off
    // its ripples; foam bunched at the leading edge and a lace of bubbles behind it that thins as it drains
    float k = x - edge;
    float dir = u < 0.2 ? -1.0 : 1.0;
    float cell = worley(vec2(x * 1.7 + uTime * 0.45 * dir, z * 1.5));
    float cell2 = worley(vec2(x * 4.1 + uTime * 0.6 * dir, z * 3.7 + 9.0));
    float lace = smoothstep(0.42, 0.62, cell) * 0.7 + smoothstep(0.5, 0.68, cell2) * 0.3;
    float clump = smoothstep(0.4, 0.72, wNoise(vec2(x * 0.6, z * 0.3 + cyc * 5.0)));
    float drain = u < 0.2 ? 1.0 : 1.0 - 0.6 * smoothstep(0.25, 1.0, u);
    float lineF = smoothstep(1.2, 0.0, k) * (0.55 + 0.45 * lace) + smoothstep(0.35, 0.0, k) * 0.4;
    float foam = lineF * (0.75 + 0.25 * drain) + lace * clump * smoothstep(4.5, 0.6, k) * 0.85 * drain;
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = 0.03 + 0.97 * pow(1.0 - max(V.y, 0.0), 5.0);
    vec2 rip = vec2(wNoise(vec2(x * 3.0 - uTime * 1.4, z * 2.0)), wNoise(vec2(z * 2.6, x * 2.0 + uTime))) - 0.5;
    vec3 N = normalize(vec3(rip.x * 0.3, 1.0, rip.y * 0.3));
    vec3 R = reflect(-V, N);
    float glint = pow(max(dot(R, normalize(uSunDir)), 0.0), 140.0) * 4.0 * uDay;
    vec3 tint = vec3(0.13, 0.19, 0.17) * light;
    // the sky it mirrors, the same as the sea's
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
    if (uHasPhoto > 0.5) sky = mix(skyPhoto(tA, R, uRotA), skyPhoto(tB, R, uRotB), uMix) * uLevel;
    vec3 wcol = mix(tint, sky, clamp(fres, 0.0, 0.7)) + glint;
    float a = clamp(0.3 + fres * 0.4 + min(k, 3.0) * 0.04 + glint * 0.3, 0.0, 0.75);
    // where it deepens into the sea, the sea's own sandy-turquoise edge colour, so the two meet without a seam
    float sea = smoothstep(730.5, 734.0, x);
    wcol = mix(wcol, mix(vec3(0.6, 0.58, 0.42), vec3(0.16, 0.5, 0.48), 0.25) * light + sky * 0.05, sea * 0.75);
    a = mix(a, 0.55, sea);
    float fm = clamp(foam, 0.0, 1.0);
    c = vec4(mix(wcol, vec3(0.96, 0.98, 0.98) * light, fm), max(a, fm * 0.95));
  } else if (x > reach) {
    // wet sand where the last waves reached, drying toward the top
    float w = smoothstep(reach, reach + 1.2, x) * (0.55 + 0.45 * smoothstep(edge - 4.0, edge, x));
    c = vec4(vec3(0.05, 0.04, 0.02), 0.45 * w);
  }
  if (c.a < 0.005) discard;
  gl_FragColor = c;
  #include <fog_fragment>
}`;

export class Water {
  mesh: THREE.Mesh;
  swash: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  constructor(scene: THREE.Scene, sky: SkySystem) {
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDay: { value: 1 },
        uNight: { value: 0 },
        uMask: { value: null },
        uRect: { value: new THREE.Vector4(WORLD.x0, WORLD.z0, WORLD.x1 - WORLD.x0, WORLD.z1 - WORLD.z0) },
      },
    ]);
    this.uniforms.uSunDir = { value: sky.sunDir };
    this.uniforms.uSunColor = { value: sky.sunColor };
    this.uniforms.uHorizon = { value: sky.horizon };
    this.uniforms.uZenith = { value: sky.zenith };
    this.uniforms.uMask.value = makeLandMask();
    for (const k of ['tA', 'tB', 'uRotA', 'uRotB', 'uMix', 'uLevel', 'uHasPhoto']) this.uniforms[k] = sky.uniforms[k];
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, fog: true });
    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    // swash strip lying on the sand slope
    const x0 = 724, x1 = 741, nx = 17;
    const sg = new THREE.PlaneGeometry(x1 - x0, ISLAND.z1 - ISLAND.z0 - 8, nx, 1);
    sg.rotateX(-Math.PI / 2);
    const sp = sg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i) + (x0 + x1) / 2;
      sp.setXYZ(i, x, (-3.2 * (x - ISLAND.x1)) / 88 + 0.025, sp.getZ(i) + (ISLAND.z0 + ISLAND.z1) / 2);
    }
    sg.computeBoundingSphere();
    const smat = new THREE.ShaderMaterial({
      vertexShader: swashVert,
      fragmentShader: swashFrag,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    smat.uniforms.uTime = this.uniforms.uTime;
    smat.uniforms.uDay = this.uniforms.uDay;
    smat.uniforms.uHorizon = this.uniforms.uHorizon;
    smat.uniforms.uSunDir = this.uniforms.uSunDir;
    smat.uniforms.uZenith = this.uniforms.uZenith;
    for (const k of ['tA', 'tB', 'uRotA', 'uRotB', 'uMix', 'uLevel', 'uHasPhoto']) smat.uniforms[k] = sky.uniforms[k];
    this.swash = new THREE.Mesh(sg, smat);
    this.swash.renderOrder = 1;
    scene.add(this.swash);
  }
  update(elapsed: number, sky: SkySystem, cam: THREE.Vector3) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uDay.value = sky.day;
    this.uniforms.uNight.value = sky.night;
    this.mesh.position.x = Math.round(cam.x / 100) * 100;
    this.mesh.position.z = Math.round(cam.z / 100) * 100;
  }
}

/** Surface height offset of the waves at a point (matches the shader roughly) for floating objects. */
export function waveHeight(x: number, z: number, t: number): number {
  const d1 = (x * 0.8 + z * 0.6) * 0.08 + t * 1.1;
  const d2 = (x * -0.287 + z * 0.958) * 0.13 + t * 1.5;
  return Math.sin(d1) * 0.35 * 0.6 + Math.sin(d2) * 0.22 * 0.6;
}
