import * as THREE from 'three';
import { SKY_GLSL, skyUniforms } from './env-air.ts';
import type { Biome } from './biome.ts';
import { NOISE } from './shaders.ts';

/**
 * The world around the courses: a deep summer sky (the same function lights the scene through a
 * PMREM, so the varnish and the glass reflect it, and colours the air), a sea of thick marbled
 * paint far below that swirls and swells, and giant painted toy pegs standing out of it, a few
 * with a giant marble on top. (The clouds and the floating toys: env-clouds.ts, env-props.ts.)
 */

const SKY_V = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const SKY_F = (sun: THREE.Vector3) => /* glsl */ `
uniform float uEnv;
uniform float uTime;
uniform vec3 uDisc;
uniform float uDiscKind;
uniform float uDiscSize;
uniform float uStars;
uniform float uAurora;
uniform float uCirrus;
varying vec3 vDir;
${NOISE}
${SKY_GLSL(sun)}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = mmSky(d);
  // high cirrus: streaks of ice drawn out along the wind, thin near the zenith, gone at the horizon
  if (d.y > 0.02 && uEnv < 0.5 && uCirrus > 0.0) {
    vec2 q = d.xz / (d.y + 0.18) * 1.6;
    q = vec2(q.x * 0.55 + q.y * 0.25, q.y * 2.2 - q.x * 0.4) + vec2(uTime * 0.004, 0.0);
    float n = mfbm(vec3(q * 1.3, 2.0));
    float wisp = smoothstep(0.52, 0.8, n + mvn(vec3(q * 7.0, 1.0)) * 0.18);
    float fade = smoothstep(0.03, 0.22, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    c = mix(c, mix(uHor, vec3(1.0), 0.6) * 1.1, wisp * fade * 0.42 * uCirrus);
  }
  // stars: one in a few hundred cells of a fine grid on the sphere, twinkling
  if (uStars > 0.0 && d.y > -0.05) {
    vec3 q = d * 260.0;
    vec3 id = floor(q);
    float h = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float s = step(0.982, h) * smoothstep(0.42, 0.05, length(fract(q) - 0.5));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 60.0);
    vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), fract(h * 37.0));
    c += sc * s * tw * uStars * (0.8 + 3.0 * fract(h * 91.0)) * smoothstep(-0.05, 0.2, d.y);
    // (and a faint band of the galaxy)
    float mw = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, -0.93))) * 3.2, 2.0));
    c += vec3(0.35, 0.25, 0.55) * mw * mfbm(d * 6.0) * 0.5 * uStars;
  }
  // the aurora: curtains hanging over the poles, slowly folding
  if (uAurora > 0.0 && d.y > 0.04) {
    float az = atan(d.z, d.x);
    float n = mvn(vec3(az * 2.6, d.y * 1.5, uTime * 0.04));
    float n2 = mvn(vec3(az * 7.0 + n * 2.0, 3.0, uTime * 0.07));
    float cur = smoothstep(0.42, 0.72, n) * smoothstep(0.06, 0.2, d.y) * (1.0 - smoothstep(0.3, 0.62, d.y));
    float rays = 0.55 + 0.45 * sin(az * 90.0 + n2 * 14.0);
    c += mix(vec3(0.15, 1.0, 0.55), vec3(0.55, 0.3, 1.0), smoothstep(0.14, 0.42, d.y)) * cur * rays * 0.55 * uAurora;
  }
  float sd = max(dot(d, uDiscDir), 0.0);
  float ang = acos(min(sd, 1.0));
  float R = 0.026 * uDiscSize;
  if (uDiscKind < 0.5) {
    // the sun: the disc (hot enough to bloom) and the corona round it
    c += uDisc * smoothstep(R, R * 0.8, ang) * (uEnv > 0.5 ? 220.0 : 26.0);
    c += uDisc * pow(sd, 900.0 / (uDiscSize * uDiscSize)) * (uEnv > 0.5 ? 6.0 : 1.6);
  } else if (uDiscKind < 1.5) {
    // the moon: pale, its seas, a halo
    float m = smoothstep(R, R * 0.96, ang);
    float sea = mfbm(d * 90.0);
    c = mix(c, uDisc * (1.5 - smoothstep(0.45, 0.7, sea) * 0.45), m);
    c += uDisc * exp(-ang / (R * 2.5)) * 0.25 * (1.0 - m);
  } else {
    // a synthwave sun: a gradient disc, its lower half cut in stripes that thin toward the top
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(uDiscDir, up));
    vec3 vup = cross(side, uDiscDir);
    float y = dot(d - uDiscDir, vup) / R;
    float m = smoothstep(R, R * 0.97, ang);
    float k = clamp(y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sc = mix(vec3(1.0, 0.15, 0.55), uDisc, k) * 2.4;
    float st = y < 0.1 ? step(0.5 - 0.35 * (0.1 - y), fract(y * 7.0)) : 1.0;
    c = mix(c, sc, m * st);
    c += vec3(1.0, 0.3, 0.6) * exp(-ang / (R * 1.6)) * 0.35;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const SKY_U = skyUniforms();
/** the sky's uniforms, shared by the dome and the image light (set them with paintSky) */
export const skyU = SKY_U;
const lin = (hex: number) => new THREE.Color(hex);
/** the sky for a biome: its colours, the disc and where it hangs, the stars and the aurora */
export function paintSky(b: Biome, sun: THREE.Vector3) {
  const u = SKY_U;
  const set = (v: THREE.Vector3, hex: number) => {
    const c = lin(hex);
    v.set(c.r, c.g, c.b);
  };
  const s = b.sky;
  set(u.uZen.value, s.zen);
  set(u.uMid.value, s.mid);
  set(u.uHor.value, s.hor);
  set(u.uBand.value, s.band);
  set(u.uBelow.value, s.below);
  set(u.uGlow.value, s.glow);
  set(u.uDisc.value, s.disc);
  u.uDiscKind.value = s.discKind;
  u.uDiscSize.value = s.discSize;
  u.uStars.value = s.stars;
  u.uAurora.value = s.aurora;
  u.uCirrus.value = s.cirrus;
  // (the moon a little lower than the sun, the synthwave sun sat on the horizon)
  const az = Math.atan2(sun.z, sun.x);
  const el = s.discKind === 2 ? 0.075 : s.discKind === 1 ? 0.5 : Math.asin(sun.y);
  u.uDiscDir.value.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  if (s.discKind === 2) u.uDiscDir.value.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
}

export function skyDome(sun: THREE.Vector3, env = false) {
  const m = new THREE.ShaderMaterial({
    vertexShader: SKY_V,
    fragmentShader: SKY_F(sun),
    uniforms: { ...SKY_U, uEnv: { value: env ? 1 : 0 }, uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(env ? 50 : 4000, 48, 24), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.u = m.uniforms;
  return mesh;
}

/**
 * The image light: the sky, two soft studio panels (so the glass has highlights to catch), a few
 * bright cloud banks low round the horizon (the glass shows them sliding past), and below, the
 * paint: a pink-and-teal glow the undersides of the planks pick up.
 */
export function environment(renderer: THREE.WebGLRenderer, sun: THREE.Vector3, b: Biome) {
  const s = new THREE.Scene();
  s.add(skyDome(sun, true));
  const panel = (w: number, h: number, pos: THREE.Vector3, k: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(30, 12, new THREE.Vector3(-30, 25, 20), 2.0);
  panel(20, 20, new THREE.Vector3(35, 30, -10), 1.4);
  // cloud banks: flattened white blobs, lit warm on the sun's side
  const cg = new THREE.SphereGeometry(1, 24, 12);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    if (!b.clouds.on) break;
    const k = 1.0 + 0.35 * Math.max(0, Math.cos(a - Math.atan2(sun.z, sun.x)));
    const m = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: new THREE.Color(b.clouds.lit).multiplyScalar(k) }));
    m.position.set(Math.cos(a) * 42, 3 + (i % 3) * 2.5, Math.sin(a) * 42);
    m.scale.set(9 + (i % 4) * 2, 3 + (i % 2), 9);
    m.lookAt(0, m.position.y, 0);
    s.add(m);
  }
  // the paint far below (soft pinks and teals), and the warm wood close under
  const lg = new THREE.CircleGeometry(48, 48).rotateX(-Math.PI / 2);
  const g = new THREE.Mesh(lg, new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    uniforms: { uA: { value: new THREE.Color(b.lake.pal[0]) }, uB: { value: new THREE.Color(b.lake.pal[1]) }, uC: { value: new THREE.Color(b.lake.pal[2]) }, uSelf: { value: 0.85 + b.lake.self } },
    fragmentShader: `uniform vec3 uA, uB, uC; uniform float uSelf; varying vec3 vP; void main(){
      float a = atan(vP.z, vP.x);
      vec3 c = mix(uA, uB, 0.5 + 0.5 * sin(a * 3.0));
      c = mix(c, uC, 0.25 + 0.25 * sin(a * 5.0 + 1.0));
      c = mix(vec3(0.62, 0.44, 0.30), c, smoothstep(6.0, 26.0, length(vP.xz)));
      gl_FragColor = vec4(c * uSelf, 1.0); }`,
  }));
  g.position.y = -9;
  s.add(g);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.015);
  pm.dispose();
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}

/**
 * The paint sea. Marbled paint is bands of colour floated on size and combed into each other: here
 * a flow field warped over itself, dragged round the giant pegs and stirred along the curl of a
 * slower noise (the swirls), cut into bands of five enamels of uneven width with a thin cream vein
 * where two meet; the whole pattern drifts and slowly turns over. The paint is thick, so it doesn't
 * ripple like water: it swells, long and slow, the veins stand a hair proud of the surface, and it
 * climbs each peg in a meniscus. Varnish-glossy: it mirrors the world (env-mirror.ts, bent by the
 * swells) and, without the mirror, the sky. Beyond a few hundred metres the bands are finer than a
 * pixel, so they fade to their average (no moiré), and the air takes it from there.
 */
const LAKE_F_PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform vec3 uPegs[16];
uniform vec3 uPal[5];
uniform vec3 uMean;
uniform vec3 uVein;
uniform vec3 uEmit;
uniform float uVeinK;
uniform float uSoft;
uniform float uSelf;
uniform float uGrid;
uniform float uScale;
uniform float uRough;
varying vec3 vWp;
${NOISE}
vec3 lkPal(float i){
  return uPal[int(mod(i * 3.0, 5.0))];
}
vec3 paintLake(vec2 p, out float h, out float lkRough, out vec3 lkEm){
  float t = uTime;
  vec2 q = p * 0.0055 / uScale + vec2(t * 0.0012, -t * 0.0007);
  // the swirls: the field warped by itself, twice (each pass slower and finer)
  vec2 w1 = vec2(mfbm(vec3(q, t * 0.010)), mfbm(vec3(q + vec2(5.2, 1.3), t * 0.010 + 4.0))) - 0.5;
  vec2 r = q + w1 * 2.6;
  // the giant pegs drag the paint round them as it flows past (a differential turn: spirals), and
  // pull it up into a meniscus at the foot
  float pegD = 1e4;
  for (int i = 0; i < 16; i++) {
    vec2 dv = p - uPegs[i].xy;
    float dl = length(dv);
    float d = dl - uPegs[i].z;
    pegD = min(pegD, d);
    r += vec2(-dv.y, dv.x) / max(dl, 1.0) * exp(-max(d, 0.0) / 40.0) * 0.22;
  }
  // then stirred: carried a few steps along the curl of a slower noise (the stylus through the size)
  vec2 s = r;
  for (int i = 0; i < 3; i++) {
    vec3 P = vec3(s * 1.9, t * 0.015 + float(i) * 1.7);
    float n0 = mvn(P), nx = mvn(P + vec3(0.04, 0.0, 0.0)), ny = mvn(P + vec3(0.0, 0.04, 0.0));
    vec2 gr = vec2(nx - n0, ny - n0) / 0.04;
    s += vec2(gr.y, -gr.x) * 0.06;
  }
  // the bands: combed across the warped field, uneven in width
  float f = (s.x * 2.2 + s.y * 1.3) * 4.6 + mvn(vec3(s * 4.0, t * 0.02)) * 1.6;
  // (uneven widths: some bands pinched to ribbons, some fat)
  f += 0.42 * sin(f * 1.27 + 1.3);
  float fw = fwidth(f);
  float id = floor(f), fr = fract(f);
  float aa = clamp(fw * 1.2, 0.002, 0.5);
  vec3 c = mix(lkPal(id), lkPal(id + 1.0), mix(smoothstep(1.0 - aa, 1.0, fr), smoothstep(0.0, 1.0, fr), uSoft));
  // the cream vein along each boundary, and a hairline of darker pigment beside it
  float e = min(fr, 1.0 - fr);
  float vein = 1.0 - smoothstep(0.03, 0.03 + aa, e);
  float rim = (1.0 - smoothstep(0.075, 0.075 + aa, e)) - vein;
  vein *= uVeinK;
  rim *= uVeinK;
  c = mix(c, c * 0.62, rim * 0.6);
  c = mix(c, uVein, vein * 0.9);
  // finer than a pixel: the average colour
  c = mix(c, uMean, smoothstep(0.25, 0.7, fw));
  // swells (m): long and slow, the paint is thick; the veins stand proud
  float near = 1.0 - smoothstep(0.08, 0.35, fw);
  float mid = 1.0 - smoothstep(0.3, 1.2, fw);
  float sw = mvn(vec3(p * 0.025, t * 0.12)) * 0.9 + mvn(vec3(p * 0.08 + 3.0, t * 0.22)) * 0.28 * mid + mvn(vec3(p * 0.26 + 7.0, t * 0.38)) * 0.06 * near;
  h = sw + (vein * 0.03 + rim * 0.01) * near;
  // (the troughs a touch deeper in colour, the crests catching more light)
  c *= 0.86 + 0.22 * smoothstep(0.25, 0.75, sw);
  // pigment: denser and thinner patches within a band, a little grain along the flow
  c *= 1.0 + (mvn(vec3(s * 26.0, f * 0.15)) - 0.5) * 0.16 * near;
  // the foot of a peg: the meniscus (cream where the paint thins as it climbs), rings spreading out
  float men = exp(-max(pegD, 0.0) / 1.4);
  c = mix(c, uVein, men * 0.55);
  h += men * 0.5 + sin(pegD * 1.1 - t * 1.6) * exp(-pegD / 22.0) * 0.06 * near;
  lkRough = clamp(uRough + 0.08 * vein, 0.02, 1.0);
  // its own light: glowing bands (lava, a nebula), glowing veins, and a grid of light
  lkEm = c * uSelf * (0.8 + 0.4 * mvn(vec3(p * 0.05, t * 0.3))) + uEmit * (vein + rim * 0.4 + men * 0.5);
  if (uGrid > 0.5) {
    vec2 gp = p / 14.0;
    vec2 gd = abs(fract(gp) - 0.5);
    float gw = fwidth(gp.x) + fwidth(gp.y);
    float line = 1.0 - smoothstep(0.0, gw * 1.2 + 0.015, 0.5 - max(gd.x, gd.y));
    lkEm += uEmit * line * (1.0 - smoothstep(0.15, 0.6, gw)) * 1.4;
    c *= 1.0 - line * 0.5;
  }
  return c;
}
`;

/** the paint sea; `mirror` (env-mirror.ts) its reflection, when there is one */
export function lake(y: number, mirror?: { target: THREE.WebGLRenderTarget; matrix: THREE.Matrix4 }) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, specularIntensity: 0.8 });
  const u = {
    uTime: { value: 0 },
    uRefl: { value: mirror ? mirror.target.texture : null },
    uReflMat: { value: mirror ? mirror.matrix : new THREE.Matrix4() },
    uReflOn: { value: mirror ? 1 : 0 },
    uPegs: { value: Array.from({ length: 16 }, () => new THREE.Vector3(1e5, 1e5, 1)) },
    uPal: { value: Array.from({ length: 5 }, () => new THREE.Color()) },
    uMean: { value: new THREE.Color() },
    uVein: { value: new THREE.Color() },
    uEmit: { value: new THREE.Color(0, 0, 0) },
    uVeinK: { value: 1 },
    uSoft: { value: 0 },
    uSelf: { value: 0 },
    uGrid: { value: 0 },
    uScale: { value: 1 },
    uRough: { value: 0.06 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LAKE_F_PARS)
      .replace('#include <map_fragment>', 'float lkH, lkR; vec3 lkE; diffuseColor.rgb = paintLake(vWp.xz, lkH, lkR, lkE);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = lkE;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = lkR;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); vec2 dh = vec2(dFdx(lkH), dFdy(lkH));
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * R1 + dh.y * R2)); }`,
      )
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\nclearcoatNormal = normal;')
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        if (uReflOn > 0.5) {
          // the mirror, bent by the swells (their tilt off the flat, in view space)
          vec4 rc = uReflMat * vec4(vWp, 1.0);
          vec2 ruv = rc.xy / rc.w + (normal - nonPerturbedNormal).xy * 0.12;
          vec3 refl = texture2D(uRefl, clamp(ruv, 0.002, 0.998)).rgb;
          radiance = refl * 0.9;
          clearcoatRadiance = refl * 0.9;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'mm-lake-5';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7200, 7200, 1, 1).rotateX(-Math.PI / 2), m);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.userData.u = u;
  return mesh;
}

/** the sea for a biome */
export function paintLakeFor(mesh: THREE.Mesh, b: Biome) {
  const u = mesh.userData.u as LakeU;
  const L = b.lake;
  L.pal.forEach((h, i) => u.uPal.value[i].set(h));
  u.uMean.value.set(L.mean);
  u.uVein.value.set(L.vein);
  u.uEmit.value.set(L.emit).multiplyScalar(L.emitK);
  u.uVeinK.value = L.veinK;
  u.uSoft.value = L.soft;
  u.uSelf.value = L.self;
  u.uGrid.value = L.grid;
  u.uScale.value = L.scale;
  u.uRough.value = L.rough;
  const m = mesh.material as THREE.MeshPhysicalMaterial;
  m.clearcoat = Math.max(0.02, L.coat);
  m.specularIntensity = L.coat > 0.1 ? 0.8 : 0.25;
}
type LakeU = { uPal: { value: THREE.Color[] }; uMean: { value: THREE.Color }; uVein: { value: THREE.Color }; uEmit: { value: THREE.Color }; uVeinK: { value: number }; uSoft: { value: number }; uSelf: { value: number }; uGrid: { value: number }; uScale: { value: number }; uRough: { value: number } };

/**
 * Giant painted toy pegs standing in the paint: a fat turned peg with a rounded crown and a collar,
 * striped like a barber's pole, a few with a giant bean standing in a cup on top, cheering; a ring
 * of paint pulled up round each foot.
 */
export function giants(center: THREE.Vector3, lakeY: number, paint: (a: number, b: number) => THREE.Material, statue: (i: number) => THREE.Object3D) {
  const g = new THREE.Group();
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pal = [0xe8322f, 0x2f74ff, 0xffcf2a, 0x37c25a, 0x8a4bff, 0xff8a1f, 0xff5fa8, 0x1fc8c0];
  const N = 16;
  const pegProfile = (rad: number, h: number, cup: boolean) => {
    // (turned like a toy: a flared foot, the shaft, a collar, a rounded crown or a cup for a bean)
    const pts: THREE.Vector2[] = [];
    pts.push(new THREE.Vector2(0.001, -2), new THREE.Vector2(rad * 1.25, -2), new THREE.Vector2(rad * 1.18, 1.2), new THREE.Vector2(rad, 3));
    pts.push(new THREE.Vector2(rad, h - 5), new THREE.Vector2(rad * 1.22, h - 4), new THREE.Vector2(rad * 1.22, h - 2.6), new THREE.Vector2(rad * 0.96, h - 2));
    if (cup) {
      pts.push(new THREE.Vector2(rad * 1.05, h), new THREE.Vector2(rad * 1.1, h + 0.6), new THREE.Vector2(rad * 0.75, h + 0.4), new THREE.Vector2(0.001, h - 0.4));
    } else {
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 0.5;
        pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * rad * 0.96), h - 2 + Math.sin(a) * rad * 0.7));
      }
    }
    return pts;
  };
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + rnd() * 0.3;
    const r = 280 + rnd() * 420;
    const h = 60 + rnd() * 130;
    const rad = 7 + rnd() * 8;
    const cup = k % 3 === 0;
    const geo = new THREE.LatheGeometry(pegProfile(rad, h, cup), 40);
    // (paint coordinates: along and round)
    const pp = geo.getAttribute('position');
    const at = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      at[i * 3] = pp.getY(i) * 0.08;
      at[i * 3 + 1] = Math.atan2(pp.getZ(i), pp.getX(i)) * 1.2;
      at[i * 3 + 2] = 0;
    }
    geo.setAttribute('aWood', new THREE.BufferAttribute(at, 3));
    const mesh = new THREE.Mesh(geo, paint(pal[k % pal.length], k % 2 ? 0xfff6ea : pal[(k + 3) % pal.length]));
    mesh.position.set(center.x + Math.cos(a) * r, lakeY, center.z + Math.sin(a) * r);
    mesh.castShadow = true;
    mesh.userData.peg = rad * 1.25;
    g.add(mesh);
    if (cup) {
      const bean = statue(k);
      bean.scale.setScalar(rad * 1.1);
      bean.position.copy(mesh.position).add(new THREE.Vector3(0, h - 0.2, 0));
      bean.rotation.y = rnd() * Math.PI * 2;
      bean.userData.giant = rad;
      g.add(bean);
    }
  }
  return g;
}
