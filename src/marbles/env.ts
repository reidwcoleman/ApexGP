import * as THREE from 'three';
import { NOISE } from './shaders.ts';

/**
 * The world around the courses: a bright summer sky (the same dome lights the scene through a
 * PMREM, so the varnish and the glass reflect it), a sea of marbled paint far below that swirls,
 * banks of cloud, and giant painted pegs with giant marbles on top standing out of the paint.
 */

const SKY_V = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const SKY_F = /* glsl */ `
uniform vec3 uSun;
uniform float uEnv;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zen = vec3(0.16, 0.38, 0.95);
  vec3 hor = vec3(0.78, 0.86, 1.0);
  vec3 low = vec3(0.98, 0.83, 0.86);
  vec3 c = mix(hor, zen, pow(max(h, 0.0), 0.55));
  c = mix(c, low, smoothstep(0.12, -0.12, h));
  float sd = max(dot(d, normalize(uSun)), 0.0);
  c += vec3(1.0, 0.85, 0.6) * pow(sd, 8.0) * 0.35;
  c += vec3(1.0, 0.95, 0.85) * pow(sd, 400.0) * (uEnv > 0.5 ? 60.0 : 18.0);
  gl_FragColor = vec4(c * 1.15, 1.0);
}
`;

export function skyDome(sun: THREE.Vector3, env = false) {
  const m = new THREE.ShaderMaterial({
    vertexShader: SKY_V,
    fragmentShader: SKY_F,
    uniforms: { uSun: { value: sun.clone() }, uEnv: { value: env ? 1 : 0 } },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(env ? 50 : 4000, 48, 24), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** the image light: the sky plus two soft studio panels, so the glass has highlights to catch */
export function environment(renderer: THREE.WebGLRenderer, sun: THREE.Vector3) {
  const s = new THREE.Scene();
  s.add(skyDome(sun, true));
  const panel = (w: number, h: number, pos: THREE.Vector3, k: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(30, 12, new THREE.Vector3(-30, 25, 20), 2.2);
  panel(20, 20, new THREE.Vector3(35, 30, -10), 1.6);
  // warm ground bounce (the wood)
  const g = new THREE.Mesh(new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a6440 }));
  g.position.y = -8;
  s.add(g);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  return rt.texture;
}

const LAKE_F_PARS = /* glsl */ `
uniform float uTime;
varying vec3 vWp;
${NOISE}
vec3 paintLake(vec2 p, out float h){
  // marbled paint: colours dragged into each other by a slow, warped flow
  vec2 q = p * 0.012;
  float t = uTime * 0.03;
  vec2 w = vec2(mfbm(vec3(q * 1.5, t)), mfbm(vec3(q * 1.5 + 5.2, t + 3.0)));
  vec2 r = q + (w - 0.5) * 2.4;
  float a = mfbm(vec3(r * 2.0, t * 1.5));
  float b = sin(r.x * 9.0 + a * 7.0) * 0.5 + 0.5;
  vec3 c1 = vec3(0.98, 0.33, 0.62), c2 = vec3(0.24, 0.80, 0.86), c3 = vec3(1.0, 0.84, 0.32), c4 = vec3(0.98, 0.95, 0.92);
  vec3 c = mix(c1, c2, smoothstep(0.35, 0.65, a));
  c = mix(c, c3, smoothstep(0.75, 0.95, b) * 0.85);
  c = mix(c, c4, smoothstep(0.92, 1.0, sin(r.y * 13.0 + a * 9.0) * 0.5 + 0.5) * 0.7);
  h = mvn(vec3(p * 0.35, uTime * 0.5)) * 0.04 + mvn(vec3(p * 1.4, uTime * 0.9)) * 0.012;
  return c;
}
`;

export function lake(y: number) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
  const u = { uTime: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LAKE_F_PARS)
      .replace('#include <map_fragment>', 'float lkH; diffuseColor.rgb = paintLake(vWp.xz, lkH);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); vec2 dh = vec2(dFdx(lkH), dFdy(lkH));
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * R1 + dh.y * R2)); }`,
      );
  };
  m.customProgramCacheKey = () => 'mm-lake-1';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2), m);
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.userData.u = u;
  return mesh;
}

/** cloud banks: clusters of soft puffs */
export function clouds(center: THREE.Vector3, lakeY: number, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xc8d8ff, emissiveIntensity: 0.32 });
  const N = 260;
  const im = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let k = 0;
  while (k < N) {
    const a = rnd() * Math.PI * 2;
    const r = 220 + rnd() * 700;
    const cy = lakeY + 8 + rnd() * 70;
    const cx = center.x + Math.cos(a) * r, cz = center.z + Math.sin(a) * r;
    const big = 10 + rnd() * 18;
    const n = 4 + Math.floor(rnd() * 6);
    for (let j = 0; j < n && k < N; j++, k++) {
      p.set(cx + (rnd() - 0.5) * big * 2.6, cy + rnd() * big * 0.4, cz + (rnd() - 0.5) * big * 1.6);
      const r2 = big * (0.5 + rnd() * 0.6);
      sc.set(r2 * 1.3, r2 * 0.75, r2);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
      m.compose(p, q, sc);
      im.setMatrixAt(k, m);
    }
  }
  return im;
}

/** giant painted pegs standing in the paint, a few with a giant marble on top */
export function giants(center: THREE.Vector3, lakeY: number, paint: (a: number, b: number) => THREE.Material, marble: (i: number) => THREE.Material) {
  const g = new THREE.Group();
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pal = [0xe8322f, 0x2f74ff, 0xffcf2a, 0x37c25a, 0x8a4bff, 0xff8a1f, 0xff5fa8, 0x1fc8c0];
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + rnd() * 0.3;
    const r = 260 + rnd() * 420;
    const h = 60 + rnd() * 120;
    const rad = 6 + rnd() * 8;
    const geo = new THREE.CylinderGeometry(rad, rad * 1.08, h, 32, 8);
    // (paint coordinates along and round)
    const pp = geo.getAttribute('position');
    const at = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      at[i * 3] = pp.getY(i) * 0.08;
      at[i * 3 + 1] = Math.atan2(pp.getZ(i), pp.getX(i)) * 1.2;
      at[i * 3 + 2] = 0;
    }
    geo.setAttribute('aWood', new THREE.BufferAttribute(at, 3));
    const mesh = new THREE.Mesh(geo, paint(pal[k % pal.length], pal[(k + 3) % pal.length]));
    mesh.position.set(center.x + Math.cos(a) * r, lakeY + h / 2 - 2, center.z + Math.sin(a) * r);
    g.add(mesh);
    const capG = new THREE.CylinderGeometry(rad * 1.12, rad * 1.12, 2.5, 32);
    const cat = new Float32Array(capG.getAttribute('position').count * 3);
    capG.setAttribute('aWood', new THREE.BufferAttribute(cat, 3));
    const cap = new THREE.Mesh(capG, paint(0xf3eee4, 0xf3eee4));
    cap.position.copy(mesh.position).add(new THREE.Vector3(0, h / 2 + 1.2, 0));
    g.add(cap);
    if (k % 3 === 0) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.95, 48, 32), marble(k));
      ball.position.copy(cap.position).add(new THREE.Vector3(0, rad * 0.95 + 1.2, 0));
      ball.scale.setScalar(1);
      ball.userData.giant = rad * 0.95;
      g.add(ball);
    }
  }
  return g;
}
