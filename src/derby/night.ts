import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, EdgeDetectionMode, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { NOISE } from '../marbles/shaders.ts';
import { Mirror } from '../marbles/env-mirror.ts';
import { makeSun } from '../marbles/env-sun.ts';
import { GradeEffect } from '../marbles/post-grade.ts';
import { TAAPass } from '../marbles/post-taa.ts';

/**
 * Marble Derby's night. A clear night over a city: a deep blue-black sky with stars and the band of
 * the galaxy, a big moon low in the east, the violet glow of the city lying along the horizon. The
 * course stands on piers in a black lake that mirrors everything (the skyline's windows, the
 * floodlight towers, the neon on the rails). The light on the course is the floodlights' (one key
 * light with cascaded shadows, from high on the towers), the sky's cold fill, and pools of neon
 * colour from the rails near the action (a handful of point lights the race moves along). The same
 * sky function paints the dome, lights the scene through a PMREM (with the floodlight heads and
 * neon panels in it, so the lacquer and the glass have something to reflect), and colours the air.
 */

/** toward the floodlights' main throw (high and to one side) */
export const KEY = new THREE.Vector3(0.38, 0.84, -0.38).normalize();
export const MOON = new THREE.Vector3(-0.62, 0.3, 0.72).normalize();

const NIGHT_GLSL = /* glsl */ `
const vec3 DY_MOON = normalize(vec3(${MOON.x.toFixed(4)}, ${MOON.y.toFixed(4)}, ${MOON.z.toFixed(4)}));
vec3 dySky(vec3 d){
  float h = d.y;
  float hh = max(h, 0.0);
  vec3 zen = vec3(0.003, 0.006, 0.024);
  vec3 mid = vec3(0.010, 0.018, 0.060);
  vec3 hor = vec3(0.075, 0.032, 0.115);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, hh));
  c = mix(c, zen, smoothstep(0.2, 0.9, hh));
  // the city's glow, lying on the horizon: magenta into amber right at the line
  c += vec3(0.22, 0.05, 0.17) * exp(-abs(h) * 16.0) * 0.55;
  c += vec3(0.30, 0.14, 0.04) * exp(-abs(h) * 60.0) * 0.35;
  // below: the lake's own dark
  c = mix(c, vec3(0.02, 0.016, 0.045), smoothstep(0.0, -0.25, h));
  float md = max(dot(d, DY_MOON), 0.0);
  c += vec3(0.30, 0.38, 0.55) * pow(md, 14.0) * 0.12;
  c += vec3(0.40, 0.46, 0.60) * pow(md, 120.0) * 0.2;
  return c;
}
`;

/** metres of clear air before the haze */
const FOG_START = 90;

/** the air: three's fog chunks replaced (once) so far things sink into the night sky behind them */
export function installNightAir() {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.fog_fragment.includes('dySky')) return;
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vFogRay;\n#endif\n';
  C.fog_vertex = '#ifdef USE_FOG\n vFogRay = mvPosition.xyz * mat3(viewMatrix);\n#endif\n';
  C.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${NIGHT_GLSL}
#endif
`;
  C.fog_fragment = `
#ifdef USE_FOG
  {
    float fd = length(vFogRay);
    vec3 fdir = vFogRay / max(fd, 1e-4);
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-pow(max(fd - ${FOG_START.toFixed(1)}, 0.0) * fogDensity, 1.35));
    #else
      float fogFactor = smoothstep(fogNear, fogFar, fd);
    #endif
    vec3 fc = dySky(normalize(vec3(fdir.x, max(fdir.y, 0.0) * 0.4 + 0.01, fdir.z))) * fogColor;
    // (looking down at the lake: the dark haze lying on the water, not the city's glow)
    fc = mix(fc, vec3(0.012, 0.01, 0.03), smoothstep(-0.05, -0.45, fdir.y));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
  }
#endif
`;
}

// ------------------------------------------------------------------------------------------ sky
const SKY_V = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const SKY_F = /* glsl */ `
uniform float uEnv;
uniform float uTime;
varying vec3 vDir;
${NOISE}
${NIGHT_GLSL}
// a star field: one candidate per cell of a direction grid, most cells empty, each star its own
// brightness, colour and twinkle; drawn as a soft point a little wider than a pixel
vec3 stars(vec3 d, float scale, float keep){
  vec3 a = abs(d);
  // (a cube's faces: even cells everywhere, no pinch at the poles)
  vec2 uv; float face;
  if (a.x > a.y && a.x > a.z) { uv = d.zy / a.x; face = sign(d.x); }
  else if (a.y > a.z) { uv = d.xz / a.y; face = 2.0 + sign(d.y); }
  else { uv = d.xy / a.z; face = 4.0 + sign(d.z); }
  vec2 g = uv * scale;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float r = mh12(cell + face * 131.0);
  if (r < keep) return vec3(0.0);
  vec2 o = vec2(mh12(cell + 3.7 + face), mh12(cell + 9.1 - face)) - 0.5;
  float dd = length(f - o * 0.7);
  float fw = fwidth(g.x) * 1.5 + 0.02;
  float b = (r - keep) / (1.0 - keep);
  float tw = 0.75 + 0.25 * sin(uTime * (1.5 + r * 4.0) + r * 80.0);
  vec3 col = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), mh11(r * 37.0));
  return col * smoothstep(fw, 0.0, dd) * (0.4 + 3.0 * b * b) * tw;
}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = dySky(d);
  if (d.y > -0.02) {
    float up = smoothstep(-0.02, 0.18, d.y);
    // the galaxy: a band across the sky, mottled with dust lanes
    vec3 ax = normalize(vec3(0.3, 0.5, -0.81));
    float band = exp(-pow(dot(d, ax) * 4.2, 2.0));
    float dust = mfbm(d * 6.0 + 1.3);
    float mw = band * smoothstep(0.35, 0.75, mfbm(d * 3.0)) * (1.0 - smoothstep(0.45, 0.7, dust) * 0.8);
    c += vec3(0.10, 0.09, 0.16) * mw * up * (uEnv > 0.5 ? 0.4 : 1.0);
    if (uEnv < 0.5) {
      c += stars(d, 140.0, 0.93) * up * 0.6;
      c += stars(d, 60.0, 0.975) * up * 1.4 * (1.0 + band);
    }
  }
  // the moon: a disc with its seas, and its halo
  float md = dot(d, DY_MOON);
  float disc = smoothstep(0.99962, 0.99972, md);
  if (disc > 0.0) {
    vec3 t1 = normalize(cross(DY_MOON, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, DY_MOON);
    vec2 q = vec2(dot(d, t1), dot(d, t2)) / 0.028;
    float seas = smoothstep(0.45, 0.62, mfbm(vec3(q * 2.2, 3.0)));
    float limb = sqrt(max(0.0, 1.0 - dot(q, q)));
    vec3 moon = mix(vec3(1.0, 0.98, 0.92), vec3(0.62, 0.64, 0.7), seas) * (0.55 + 0.45 * limb);
    c = mix(c, moon * (uEnv > 0.5 ? 6.0 : 2.4), disc);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

function skyDome(env = false) {
  const m = new THREE.ShaderMaterial({ vertexShader: SKY_V, fragmentShader: SKY_F, uniforms: { uEnv: { value: env ? 1 : 0 }, uTime: { value: 0 } }, side: THREE.BackSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(env ? 50 : 4000, 48, 24), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.u = m.uniforms;
  return mesh;
}

/** the image light: the night sky, the floodlight heads up high, neon panels low all round */
function environment(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene();
  s.add(skyDome(true));
  const panel = (w: number, h: number, pos: THREE.Vector3, c: THREE.Color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  // the floodlight heads: hard bright squares high up (the glass and the lacquer catch them)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.6;
    panel(7, 4, new THREE.Vector3(Math.cos(a) * 34, 32, Math.sin(a) * 34), new THREE.Color(9, 8.4, 7.6));
  }
  // the neon of the city round the horizon: magenta, cyan, amber strips
  const neon = [new THREE.Color(3.2, 0.25, 2.0), new THREE.Color(0.2, 2.2, 3.2), new THREE.Color(3.4, 1.6, 0.3), new THREE.Color(1.4, 0.4, 3.4)];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    panel(5 + (k % 3) * 3, 1.2 + (k % 2), new THREE.Vector3(Math.cos(a) * 44, 2 + (k % 4) * 1.6, Math.sin(a) * 44), neon[k % neon.length]);
  }
  // the lake below: near black, a little blue
  const lake = new THREE.Mesh(new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.01, 0.012, 0.03) }));
  lake.position.y = -8;
  s.add(lake);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.01);
  pm.dispose();
  return rt.texture;
}

// ------------------------------------------------------------------------------------------ water
const WATER_PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uReflOn;
varying vec3 vWp;
${NOISE}
float wv(vec2 p, float t){
  // a light chop, wind-driven: a few octaves drifting different ways
  return mvn(vec3(p * 0.11 + vec2(t * 0.05, t * 0.02), t * 0.05)) * 0.6
       + mvn(vec3(p * 0.37 - vec2(t * 0.09, -t * 0.05), t * 0.11)) * 0.28
       + mvn(vec3(p * 1.3 + vec2(t * 0.2, t * 0.13), t * 0.3)) * 0.1;
}
`;

function water(mirror: Mirror) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x03050a, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1 });
  const u = { uTime: { value: 0 }, uRefl: { value: mirror.target.texture }, uReflMat: { value: mirror.matrix }, uReflOn: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_PARS)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float wh = wv(vWp.xz, uTime) * (1.0 - smoothstep(0.5, 3.0, fwidth(vWp.x) * 4.0));
        { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); vec2 dh = vec2(dFdx(wh), dFdy(wh)) * 0.9;
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * R1 + dh.y * R2)); }`,
      )
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\nclearcoatNormal = normal;')
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        if (uReflOn > 0.5) {
          vec4 rc = uReflMat * vec4(vWp, 1.0);
          // (the reflections stretch down the chop: the neon in long wavering streaks)
          vec2 d = (normal - nonPerturbedNormal).xy;
          vec2 ruv = rc.xy / rc.w + vec2(d.x * 0.05, d.y * 0.16);
          vec3 refl = texture2D(uRefl, clamp(ruv, 0.002, 0.998)).rgb;
          radiance = refl;
          clearcoatRadiance = refl * 0.6;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'dy-water-1';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), m);
  mesh.receiveShadow = true;
  mesh.userData.u = u;
  return mesh;
}

// ------------------------------------------------------------------------------------------ city
const CITY_V = /* glsl */ `
attribute vec3 aTint;
varying vec3 vWp;
varying vec3 vLp;
varying vec3 vN;
varying vec3 vTint;
varying float vSeed;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  // (local, in metres: the instance's scale without its turn)
  vLp = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vN = normal;
  vTint = aTint;
  vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.029;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const CITY_F = /* glsl */ `
uniform float uTime;
varying vec3 vWp;
varying vec3 vLp;
varying vec3 vN;
varying vec3 vTint;
varying float vSeed;
${NOISE}
#include <fog_pars_fragment>
void main(){
  // dark glass and steel; windows in a grid on the walls (lit or not, warm or cool), the roofs dark
  vec3 base = vec3(0.012, 0.014, 0.028);
  vec3 col = base;
  if (abs(vN.y) < 0.5) {
    float along = abs(vN.x) > abs(vN.z) ? vLp.z : vLp.x;
    vec2 g = vec2(along / 2.2, vLp.y / 3.4);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
    float r = mh12(cell + vSeed * 97.0);
    float lit = step(0.58, r);
    // (some flicker off and on through the night)
    lit *= step(0.02, fract(r * 13.0 + floor(uTime * 0.05 + r * 9.0) * 0.37));
    vec3 wc = mix(vec3(1.0, 0.72, 0.38), vec3(0.62, 0.8, 1.0), step(0.8, mh11(r * 71.0)));
    float far = smoothstep(0.3, 1.2, fwidth(g.x));
    col += wc * mix(win * lit, 0.42 * 0.33, far) * 1.6 * (0.6 + 0.6 * mh11(r * 5.0));
    // the crown light: a band of neon round the top of the tallest towers
    float topBand = step(vTint.x, 0.5) * step(vTint.z - 3.0, vLp.y) * step(vLp.y, vTint.z - 1.2);
    vec3 nc = vTint.y < 0.33 ? vec3(1.0, 0.15, 0.7) : vTint.y < 0.66 ? vec3(0.15, 0.8, 1.0) : vec3(1.0, 0.6, 0.12);
    col = mix(col, nc * 4.0, topBand);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

/** the skyline: a ring of towers well beyond the course, their windows lit */
function skyline() {
  const N = 420;
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const tint = new Float32Array(N * 3);
  const mat = new THREE.ShaderMaterial({ vertexShader: CITY_V, fragmentShader: CITY_F, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2;
    // (a denser downtown off to one side)
    const down = Math.exp(-Math.pow(((a - 2.2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI, 2) * 1.4);
    const r = 700 + rnd() * 900 - down * 200;
    const w = 18 + rnd() * 30, d = 18 + rnd() * 30;
    const h = 30 + Math.pow(rnd(), 2.2) * 160 + down * rnd() * 220;
    m.compose(new THREE.Vector3(Math.cos(a) * r, -2, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI), new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m);
    tint[i * 3] = h > 150 ? rnd() * 0.8 : 1;
    tint[i * 3 + 1] = rnd();
    tint[i * 3 + 2] = h;
  }
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  mesh.frustumCulled = false;
  mesh.userData.u = mat.uniforms;
  return mesh;
}

// ------------------------------------------------------------------------------------------ towers
const BEAM_V = /* glsl */ `
uniform float uLen;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
void main(){
  vAlong = clamp(position.z / uLen, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_F = /* glsl */ `
uniform vec3 uColor;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
void main(){
  // brightest at the lamp, fading down the throw; soft at the cone's edges (seen edge-on)
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float a = (1.0 - vAlong) * (1.0 - vAlong) * edge;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** a floodlight tower: a steel mast, a head of lamps (hot enough to bloom), the beam in the haze */
function tower(h: number, aim: THREE.Vector3, at: THREE.Vector3) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.8, roughness: 0.5 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.6, h, 8, 1), steel);
  mast.position.y = h / 2;
  g.add(mast);
  for (let y = 8; y < h - 4; y += 9) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6 - (y / h) * 0.9, 0.12, 6, 12), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  const head = new THREE.Group();
  head.position.y = h;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 0.8), steel);
  head.add(frame);
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12.5, 10.5) });
  const lampG = new THREE.CircleGeometry(0.62, 16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const l = new THREE.Mesh(lampG, lampM);
      l.position.set(-2.85 + i * 1.9, -1.45 + j * 1.45, 0.42);
      head.add(l);
    }
  // the beam: a long open cone out of the head, additive, faint
  const len = Math.min(240, aim.distanceTo(at.clone().setY(at.y + h)) * 1.15);
  // (the cone runs down +z from the head: the way lookAt turns it)
  const bg = new THREE.CylinderGeometry(3.2, 3.2 + len * 0.26, len, 24, 1, true).translate(0, -len / 2, 0).rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(
    bg,
    new THREE.ShaderMaterial({ vertexShader: BEAM_V, fragmentShader: BEAM_F, uniforms: { uColor: { value: new THREE.Color(0.05, 0.047, 0.04) }, uLen: { value: len } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  beam.renderOrder = 5;
  head.add(beam);
  g.add(head);
  g.position.copy(at);
  g.updateMatrixWorld(true);
  // aim the head (its +z) at the course
  head.lookAt(aim);
  return g;
}

// ------------------------------------------------------------------------------------------ fireworks
const FW_V = /* glsl */ `
attribute vec3 aCol;
attribute float aSize;
varying vec3 vCol;
void main(){
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 600.0 / max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;
const FW_F = /* glsl */ `
varying vec3 vCol;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 18.0);
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

/** fireworks: shells that climb, burst into a sphere of stars that droop and fade, a crackle after */
export class Fireworks {
  readonly points: THREE.Points;
  private N = 3000;
  private p: Float32Array;
  private v: Float32Array;
  private c: Float32Array;
  private base: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private head = 0;
  private shells: { p: THREE.Vector3; v: THREE.Vector3; t: number; col: THREE.Color }[] = [];
  /** called when a shell bursts (for the sound): position */
  onBurst: ((p: THREE.Vector3) => void) | null = null;
  constructor() {
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(this.N * 3);
    this.v = new Float32Array(this.N * 3);
    this.c = new Float32Array(this.N * 3);
    this.base = new Float32Array(this.N * 3);
    this.size = new Float32Array(this.N);
    this.life = new Float32Array(this.N);
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.c, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: FW_V, fragmentShader: FW_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /** a shell from `from`, bursting about `height` above it */
  launch(from: THREE.Vector3, height: number, col?: THREE.Color) {
    const pal = [new THREE.Color(5, 0.6, 2.6), new THREE.Color(0.5, 3.6, 5), new THREE.Color(5, 3.6, 0.6), new THREE.Color(3.4, 1, 5), new THREE.Color(1.2, 5, 1.6), new THREE.Color(5, 5, 4.6)];
    const v = Math.sqrt(2 * 9.8 * height);
    this.shells.push({ p: from.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 3, v, (Math.random() - 0.5) * 3), t: v / 9.8, col: col ?? pal[Math.floor(Math.random() * pal.length)] });
  }

  private spark(p: THREE.Vector3, v: THREE.Vector3, col: THREE.Color, life: number, size: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.N;
    this.p.set([p.x, p.y, p.z], i * 3);
    this.v.set([v.x, v.y, v.z], i * 3);
    this.base.set([col.r, col.g, col.b], i * 3);
    this.life[i] = life;
    this.size[i] = size;
  }

  /** spray off the water where a marble goes in: pale droplets thrown up in a cone */
  spray(at: THREE.Vector3) {
    const v = new THREE.Vector3();
    const c = new THREE.Color(0.5, 0.65, 0.9);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
      v.set(Math.cos(a) * r, 5 + Math.random() * 7, Math.sin(a) * r);
      this.spark(at, v, c, 0.9 + Math.random() * 0.5, 0.35);
    }
  }

  update(dt: number) {
    const tmp = new THREE.Vector3();
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      s.t -= dt;
      s.v.y -= 9.8 * dt;
      s.p.addScaledVector(s.v, dt);
      // (the rising trail)
      this.spark(s.p, tmp.set((Math.random() - 0.5) * 0.6, -1, (Math.random() - 0.5) * 0.6), new THREE.Color(2.4, 1.6, 0.8), 0.5, 0.35);
      if (s.t <= 0) {
        const n = 160;
        const speed = 16 + Math.random() * 8;
        for (let i = 0; i < n; i++) {
          const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
          tmp.set(Math.cos(a) * r, z, Math.sin(a) * r).multiplyScalar(speed * (0.85 + Math.random() * 0.3));
          this.spark(s.p, tmp, s.col, 1.6 + Math.random() * 0.8, 0.9);
        }
        this.onBurst?.(s.p);
        this.shells.splice(k, 1);
      }
    }
    const p = this.p, v = this.v;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      // drag, and gravity: the stars droop as they fade
      const drag = Math.exp(-dt * 1.8);
      v[j] *= drag;
      v[j + 1] = v[j + 1] * drag - 6 * dt;
      v[j + 2] *= drag;
      p[j] += v[j] * dt;
      p[j + 1] += v[j + 1] * dt;
      p[j + 2] += v[j + 2] * dt;
      const f = Math.min(1, this.life[i] / 1.2);
      // (a crackle at the end: flicker)
      const fl = this.life[i] < 0.5 ? (Math.random() < 0.5 ? 1.6 : 0.2) : 1;
      this.c[j] = this.base[j] * f * fl;
      this.c[j + 1] = this.base[j + 1] * f * fl;
      this.c[j + 2] = this.base[j + 2] * f * fl;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  get busy() {
    return this.shells.length > 0;
  }
}

// ------------------------------------------------------------------------------------------ stage
export class NightStage {
  readonly composer: EffectComposer;
  readonly key: ReturnType<typeof makeSun>;
  readonly sky: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly city: THREE.InstancedMesh;
  readonly towers = new THREE.Group();
  readonly mirror = new Mirror();
  readonly fireworks = new Fireworks();
  readonly ao: N8AOPostPass;
  readonly taa: TAAPass | null = null;
  /** coloured light pools from the neon near the action */
  readonly pools: THREE.PointLight[] = [];
  private balls: THREE.Mesh[] = [];
  private size = new THREE.Vector2();
  quality = 2;
  autoQuality = true;
  private frameT = 0;
  private slowT = 0;
  private settleT = 0;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
  ) {
    const r = renderer;
    installNightAir();
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    scene.environment = environment(r);
    scene.environmentIntensity = 0.75;
    scene.add((this.sky = skyDome()));
    scene.fog = new THREE.FogExp2(0xffffff, 1 / 1300);
    scene.add(new THREE.HemisphereLight(0x3a4a9a, 0x140a1c, 0.35));
    const key = (this.key = makeSun(KEY, 0xfff0e0, 2.7));
    scene.add(key);
    // a cold rim from the moon (no shadow)
    const moon = new THREE.DirectionalLight(0x8ea4ff, 0.35);
    moon.position.copy(MOON).multiplyScalar(100);
    scene.add(moon);
    for (let k = 0; k < 4; k++) {
      const l = new THREE.PointLight(0xffffff, 0, 11, 2);
      this.pools.push(l);
      scene.add(l);
    }
    this.water = water(this.mirror);
    scene.add(this.water);
    this.city = skyline();
    scene.add(this.city);
    scene.add(this.towers);
    scene.add(this.fireworks.points);

    const c = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    c.addPass(new RenderPass(scene, camera));
    const ao = (this.ao = new N8AOPostPass(scene, camera, 1, 1));
    ao.configuration.aoRadius = 1.0;
    ao.configuration.distanceFalloff = 0.8;
    ao.configuration.intensity = 2.6;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x05030a);
    const smaa = new URLSearchParams(location.search).get('aa') === 'smaa';
    ao.setQualityMode(smaa ? 'Medium' : 'Performance');
    (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    c.addPass(ao);
    if (!smaa) c.addPass((this.taa = new TAAPass()));
    // (the night wants more glow: the neon, the lamps, the moon, the fireworks)
    const bloom = new BloomEffect({ mipmapBlur: true, levels: 6, luminanceThreshold: 0.85, luminanceSmoothing: 0.4, intensity: 1.15, radius: 0.78 });
    const tm = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    c.addPass(new EffectPass(camera, bloom, tm, new GradeEffect({ vibrance: 0.32, contrast: 0.2, lift: 0.012 }), new VignetteEffect({ darkness: 0.5, offset: 0.3 })));
    if (smaa) c.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.ULTRA, edgeDetectionMode: EdgeDetectionMode.COLOR })));
    const gfx = new URLSearchParams(location.search).get('gfx');
    if (gfx) {
      this.autoQuality = false;
      this.setQuality(gfx === 'low' ? 0 : gfx === 'medium' ? 1 : 2);
    }
  }

  setQuality(q: number) {
    q = THREE.MathUtils.clamp(Math.round(q), 0, 2);
    if (q === this.quality) return;
    this.quality = q;
    this.mirror.enabled = q >= 2;
    (this.water.userData.u as { uReflOn: { value: number } }).uReflOn.value = q >= 2 ? 1 : 0;
    this.ao.enabled = q >= 1;
    const size = q >= 1 ? 2048 : 1024;
    const sh = this.key.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      sh.map = null;
    }
  }

  private watch() {
    const now = performance.now();
    const dt = this.frameT ? now - this.frameT : 16;
    this.frameT = now;
    if (!this.autoQuality || this.quality === 0 || dt > 100) return;
    if (this.settleT > 0) {
      this.settleT -= dt;
      return;
    }
    this.slowT = dt > 20.5 ? this.slowT + dt : Math.max(0, this.slowT - dt * 1.5);
    if (this.slowT > 3000) {
      this.setQuality(this.quality - 1);
      this.slowT = 0;
      this.settleT = 3000;
    }
  }

  /** a new course: the lake under it; floodlight towers round it, aimed in */
  setCourse(lakeY: number, center: THREE.Vector3, radius: number) {
    this.taa?.reset();
    this.settleT = 4000;
    this.water.position.set(center.x, lakeY, center.z);
    this.city.position.set(center.x, lakeY, center.z);
    for (const t of [...this.towers.children]) {
      this.towers.remove(t);
      t.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      const r = radius + 45 + (k % 2) * 20;
      const base = new THREE.Vector3(center.x + Math.cos(a) * r, lakeY, center.z + Math.sin(a) * r);
      const h = center.y - lakeY + 45 + (k % 3) * 8;
      this.towers.add(tower(h, center.clone().add(new THREE.Vector3(Math.cos(a) * radius * 0.25, -10, Math.sin(a) * radius * 0.25)), base));
    }
  }

  /** a camera cut: the temporal AA starts its history over */
  cut() {
    this.taa?.reset();
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.taa?.reset();
    const d = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.mirror.setSize(d.x, d.y);
  }

  update(dt: number, t: number) {
    (this.water.userData.u as { uTime: { value: number } }).uTime.value = t;
    (this.sky.userData.u as { uTime: { value: number } }).uTime.value = t;
    (this.city.userData.u as { uTime: { value: number } }).uTime.value = t;
    this.fireworks.update(dt);
  }

  render() {
    this.watch();
    if (this.key.shadow.map) this.mirror.render(this.renderer, this.scene, this.camera, this.water.position.y, [this.water]);
    const taa = this.taa;
    if (taa) {
      this.balls.length = 0;
      for (const o of this.scene.children) {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.visible && m.geometry.type === 'SphereGeometry') this.balls.push(m);
      }
      this.renderer.getDrawingBufferSize(this.size);
      taa.begin(this.camera, this.size.x, this.size.y, this.balls);
    }
    this.composer.render();
    taa?.end(this.camera);
  }
}
