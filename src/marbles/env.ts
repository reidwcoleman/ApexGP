import * as THREE from 'three';
import { SKY_GLSL } from './env-air.ts';
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
varying vec3 vDir;
${NOISE}
${SKY_GLSL(sun)}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = mmSky(d);
  // high cirrus: streaks of ice drawn out along the wind, thin near the zenith, gone at the horizon
  if (d.y > 0.02 && uEnv < 0.5) {
    vec2 q = d.xz / (d.y + 0.18) * 1.6;
    q = vec2(q.x * 0.55 + q.y * 0.25, q.y * 2.2 - q.x * 0.4) + vec2(uTime * 0.004, 0.0);
    float n = mfbm(vec3(q * 1.3, 2.0));
    float wisp = smoothstep(0.52, 0.8, n + mvn(vec3(q * 7.0, 1.0)) * 0.18);
    float fade = smoothstep(0.03, 0.22, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y));
    c = mix(c, vec3(1.0, 0.98, 0.96) * 1.15, wisp * fade * 0.42);
  }
  float sd = max(dot(d, MM_SUN), 0.0);
  // the disc (hot enough to bloom) and the corona round it
  c += vec3(1.0, 0.92, 0.80) * smoothstep(0.99955, 0.99975, sd) * (uEnv > 0.5 ? 220.0 : 26.0);
  c += vec3(1.0, 0.85, 0.65) * pow(sd, 900.0) * (uEnv > 0.5 ? 6.0 : 1.6);
  gl_FragColor = vec4(c, 1.0);
}
`;

export function skyDome(sun: THREE.Vector3, env = false) {
  const m = new THREE.ShaderMaterial({
    vertexShader: SKY_V,
    fragmentShader: SKY_F(sun),
    uniforms: { uEnv: { value: env ? 1 : 0 }, uTime: { value: 0 } },
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
export function environment(renderer: THREE.WebGLRenderer, sun: THREE.Vector3) {
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
    const k = 1.0 + 0.35 * Math.max(0, Math.cos(a - Math.atan2(sun.z, sun.x)));
    const m = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.98, k * 0.95) }));
    m.position.set(Math.cos(a) * 42, 3 + (i % 3) * 2.5, Math.sin(a) * 42);
    m.scale.set(9 + (i % 4) * 2, 3 + (i % 2), 9);
    m.lookAt(0, m.position.y, 0);
    s.add(m);
  }
  // the paint far below (soft pinks and teals), and the warm wood close under
  const lg = new THREE.CircleGeometry(48, 48).rotateX(-Math.PI / 2);
  const g = new THREE.Mesh(lg, new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; void main(){
      float a = atan(vP.z, vP.x);
      vec3 pink = vec3(0.92, 0.42, 0.62), teal = vec3(0.30, 0.72, 0.80), sun = vec3(0.95, 0.78, 0.40);
      vec3 c = mix(pink, teal, 0.5 + 0.5 * sin(a * 3.0));
      c = mix(c, sun, 0.25 + 0.25 * sin(a * 5.0 + 1.0));
      c = mix(vec3(0.62, 0.44, 0.30), c, smoothstep(6.0, 26.0, length(vP.xz)));
      gl_FragColor = vec4(c * 0.85, 1.0); }`,
  }));
  g.position.y = -9;
  s.add(g);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.015);
  pm.dispose();
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
varying vec3 vWp;
${NOISE}
vec3 lkPal(float i){
  i = mod(i * 3.0, 5.0);
  if (i < 0.5) return vec3(0.94, 0.08, 0.36);   // rose
  if (i < 1.5) return vec3(0.00, 0.56, 0.74);   // teal
  if (i < 2.5) return vec3(1.00, 0.64, 0.03);   // marigold
  if (i < 3.5) return vec3(0.34, 0.14, 0.82);   // violet
  return vec3(0.06, 0.36, 0.92);                // cobalt
}
const vec3 LK_MEAN = vec3(0.47, 0.36, 0.58);
vec3 paintLake(vec2 p, out float h, out float lkRough){
  float t = uTime;
  vec2 q = p * 0.0055 + vec2(t * 0.0012, -t * 0.0007);
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
  vec3 c = mix(lkPal(id), lkPal(id + 1.0), smoothstep(1.0 - aa, 1.0, fr));
  // the cream vein along each boundary, and a hairline of darker pigment beside it
  float e = min(fr, 1.0 - fr);
  float vein = 1.0 - smoothstep(0.03, 0.03 + aa, e);
  float rim = (1.0 - smoothstep(0.075, 0.075 + aa, e)) - vein;
  c = mix(c, c * 0.62, rim * 0.6);
  c = mix(c, vec3(1.0, 0.94, 0.84), vein * 0.9);
  // finer than a pixel: the average colour
  c = mix(c, LK_MEAN, smoothstep(0.25, 0.7, fw));
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
  c = mix(c, vec3(1.0, 0.95, 0.86), men * 0.55);
  h += men * 0.5 + sin(pegD * 1.1 - t * 1.6) * exp(-pegD / 22.0) * 0.06 * near;
  lkRough = mix(0.06, 0.14, vein);
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
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LAKE_F_PARS)
      .replace('#include <map_fragment>', 'float lkH, lkR; diffuseColor.rgb = paintLake(vWp.xz, lkH, lkR);')
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
  m.customProgramCacheKey = () => 'mm-lake-4';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7200, 7200, 1, 1).rotateX(-Math.PI / 2), m);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.userData.u = u;
  return mesh;
}

/**
 * Giant painted toy pegs standing in the paint: a fat turned peg with a rounded crown and a collar,
 * striped like a barber's pole, a few with a giant marble resting in a cup on top; a ring of
 * paint pulled up round each foot.
 */
export function giants(center: THREE.Vector3, lakeY: number, paint: (a: number, b: number) => THREE.Material, marble: (i: number) => THREE.Material) {
  const g = new THREE.Group();
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pal = [0xe8322f, 0x2f74ff, 0xffcf2a, 0x37c25a, 0x8a4bff, 0xff8a1f, 0xff5fa8, 0x1fc8c0];
  const N = 16;
  const pegProfile = (rad: number, h: number, cup: boolean) => {
    // (turned like a toy: a flared foot, the shaft, a collar, a rounded crown or a cup for a marble)
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
      const br = rad * 1.05;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(br, 48, 32), marble(k));
      ball.position.copy(mesh.position).add(new THREE.Vector3(0, h + br * 0.82, 0));
      ball.userData.giant = br;
      g.add(ball);
    }
  }
  return g;
}
