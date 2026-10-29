import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TimeLook } from './looks.ts';

/**
 * Coral Deep: the bowl stands on the sea floor. Sand dunes rippled by the current and dappled with
 * caustics, reefs of branching, brain and fan coral in every colour, kelp swaying in tall forests,
 * schools of fish circling the glass, manta rays gliding past, a whale far off in the blue,
 * jellyfish glowing at night, bubbles streaming up from vents and shafts of light from the waves.
 *
 * Authored in the simulation frame (cm, z up) under the arena root; the shaders light in three's
 * world frame (metres, y up) with their own water: light falls off red first, then everything
 * fades into the blue.
 */

export interface OceanView {
  group: THREE.Group;
  setLook(t: TimeLook): void;
  update(t: number): void;
}

const U = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uAmb: { value: new THREE.Color(0.2, 0.5, 0.6) },
  uFog: { value: new THREE.Color(0.03, 0.26, 0.36) },
  uHaze: { value: 0.006 },
  uNight: { value: 0 },
  uTime: { value: 0 },
  uCaus: { value: 1 },
};

const COMMON = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uAmb, uFog; uniform float uHaze, uNight, uTime, uCaus;
float oh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float on(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(oh(i), oh(i+vec2(1,0)), u.x), mix(oh(i+vec2(0,1)), oh(i+vec2(1,1)), u.x), u.y); }
// caustics: two drifting layers of a warped sine lattice, bright where the folds bunch up
float caus(vec2 p, float t){
  float c = 0.0;
  for (int k = 0; k < 2; k++){
    float s = k == 0 ? 1.0 : -1.0;
    vec2 q = p * (k == 0 ? 1.0 : 1.37) + vec2(t * 0.21, -t * 0.17) * s;
    q += 0.6 * vec2(sin(q.y * 1.7 + t * 0.9), sin(q.x * 1.5 - t * 0.8));
    q += 0.35 * vec2(sin(q.y * 3.1 - t * 1.3), sin(q.x * 2.9 + t * 1.1));
    vec2 w = abs(sin(q * 1.9));
    c += pow(1.0 - min(w.x, w.y), 7.0);
  }
  return c * 0.6;
}
vec3 olight(vec3 alb, vec3 n, vec3 w){
  float ndl = max(dot(n, uSunDir), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  float d = length(w - cameraPosition);
  // (only where they show: past 260 m they're gone into the blue, so the work is skipped)
  float cs = d < 260.0 && uCaus > 0.0 ? caus(w.xz / 3.2, uTime) * uCaus * smoothstep(-0.1, 0.7, n.y) * (1.0 - smoothstep(60.0, 260.0, d)) : 0.0;
  return alb * (uSunCol * (ndl * 0.8 + 0.2) * (0.55 + 1.9 * cs) + uAmb * sky);
}
// the water: red goes first, then everything sinks into the blue
vec3 oair(vec3 c, vec3 w){
  float d = length(w - cameraPosition);
  c *= exp(-d * vec3(0.0075, 0.0028, 0.0018));
  return mix(c, uFog, clamp(1.0 - exp(-d * uHaze), 0.0, 1.0));
}`;

const LIT_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vCol; varying vec3 vN; varying vec3 vW;
void main(){
  vCol = color;
  #ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
  #endif
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vN = normalize(mat3(m) * normal);
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** lit, fogged, with a glow at night (`glow` scales the vertex colour into emission) */
function litMat(glow = 0, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side,
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vCol; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float g = 0.85 + 0.3 * on(vW.xz * 3.0 + vW.y * 2.0);
        vec3 c = olight(vCol * g, n, vW);
        // a soft rim of the blue round every silhouette
        vec3 v = normalize(cameraPosition - vW);
        c += uFog * pow(1.0 - abs(dot(n, v)), 3.0) * 0.35;
        // bioluminescence: the reef's tips glow in the dark
        c += vCol * ${glow.toFixed(2)} * (0.25 + 1.4 * uNight) * smoothstep(0.2, 1.0, n.y);
        gl_FragColor = vec4(oair(c, vW), 1.0);
      }`,
  });
}

// ------------------------------------------------------------------ helpers
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0;
    s ^= s + Math.imul(s ^ (s >>> 7), 61 | s);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}
function vnoise(x: number, y: number): number {
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const BED = -600;
/** the sea floor's height (cm): flat under the bowl, dunes beyond, rising into reef walls far out */
function bedZ(x: number, y: number): number {
  const r = Math.hypot(x, y);
  const out = THREE.MathUtils.smoothstep(r, 10500, 16000);
  const dunes = (Math.sin(x * 0.00042 + Math.sin(y * 0.0003) * 2) * 0.5 + 0.5) * 380 + vnoise(x * 0.0002, y * 0.0002) * 600;
  const a = Math.atan2(y, x);
  const wall = THREE.MathUtils.smoothstep(r, 26000, 50000) * (7000 + 12000 * vnoise(Math.cos(a) * 3 + 9, Math.sin(a) * 3 + 4));
  return BED + out * dunes + wall;
}

/** the sand: dunes rippled by the current, dark rock where it climbs, caustics dancing over it */
function seabed(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(180000, 180000, 170, 170);
  const p = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, bedZ(x, y));
    const r = Math.hypot(x, y);
    col.push(THREE.MathUtils.smoothstep(r, 36000, 60000), vnoise(x * 0.0006, y * 0.0006), 0);
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vCol; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        // ripples in the sand, combed by the current
        float rip = sin(vW.x * 2.4 + sin(vW.z * 0.35) * 3.0 + on(vW.xz * 0.2) * 4.0);
        vec3 sand = mix(vec3(0.52, 0.47, 0.34), vec3(0.62, 0.56, 0.42), vCol.y) * (0.9 + 0.1 * rip);
        sand *= 0.8 + 0.3 * on(vW.xz * 0.08);
        // scattered pebbles and weed
        sand = mix(sand, vec3(0.16, 0.24, 0.12), smoothstep(0.72, 0.85, on(vW.xz * 0.05 + 3.0)) * 0.6);
        vec3 rock = mix(vec3(0.12, 0.14, 0.13), vec3(0.2, 0.22, 0.18), on(vW.xz * 0.03));
        vec3 alb = mix(sand, rock, clamp(vCol.x + (1.0 - n.y) * 1.5, 0.0, 1.0));
        vec3 c = olight(alb, n, vW);
        gl_FragColor = vec4(oair(c, vW), 1.0);
      }`,
  });
  return new THREE.Mesh(g, m);
}

/** scatter instances on the sea floor in a ring (r0…r1, cm), clumped into reefs */
function scatter(n: number, r0: number, r1: number, seed: number, build: (m: THREE.Matrix4, x: number, y: number, z: number, r: () => number, k: number) => void): void {
  const r = rng(seed);
  const m = new THREE.Matrix4();
  // reef centres
  const reefs: [number, number][] = [];
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2;
    const d = r0 + (r1 - r0) * Math.sqrt(r());
    reefs.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  for (let k = 0; k < n; k++) {
    const [cx, cy] = reefs[Math.floor(r() * reefs.length)];
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.7) * 3200;
    let x = cx + Math.cos(a) * d;
    let y = cy + Math.sin(a) * d;
    const rr = Math.hypot(x, y);
    if (rr < r0) {
      x *= r0 / rr;
      y *= r0 / rr;
    }
    build(m, x, y, bedZ(x, y), r, k);
  }
}

const REEF = [0xff3d7f, 0xff7a2e, 0xffd23a, 0xb44dff, 0x2ee6c8, 0xff4a4a, 0x5a8dff, 0xff9ad5].map((h) => new THREE.Color(h));

function rocks(): THREE.InstancedMesh {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 0.75 + 0.5 * vnoise(v.x * 2 + 5, v.y * 2 + v.z * 1.3);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  const N = 180;
  const im = new THREE.InstancedMesh(g, litMat(0), N);
  const c = new THREE.Color();
  scatter(N, 10500, 42000, 11, (m, x, y, z, r, k) => {
    const s = 250 + r() * r() * 2600;
    m.compose(new THREE.Vector3(x, y, z + s * 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)), new THREE.Vector3(s * (1 + r()), s * (1 + r()), s * (0.5 + r() * 0.6)));
    im.setMatrixAt(k, m);
    // mossy grey-green, a few with purple encrusting algae
    c.setRGB(0.16, 0.2, 0.17).lerp(new THREE.Color(0.35, 0.16, 0.38), r() < 0.25 ? 0.6 : 0).multiplyScalar(0.8 + r() * 0.5);
    im.setColorAt(k, c);
  });
  return im;
}

/** branching coral: a trunk forking into antler-like tips */
function branchGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rng(5);
  const limb = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const c = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6, 1);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    c.translate(from.x, from.y, from.z);
    parts.push(c.deleteAttribute('uv'));
    if (depth === 0) {
      const tip = new THREE.SphereGeometry(rad * 0.9, 6, 4).translate(to.x, to.y, to.z);
      parts.push(tip.deleteAttribute('uv'));
      return;
    }
    for (let k = 0; k < 3; k++) {
      const d = dir.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.3)).normalize();
      if (d.y < 0.2) d.y = 0.2;
      limb(to, d.normalize(), len * 0.72, rad * 0.68, depth - 1);
    }
  };
  limb(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.5, 0.09, 3);
  const g = mergeGeometries(parts);
  // (y up → z up)
  g.rotateX(Math.PI / 2);
  return g;
}

function corals(): THREE.Group {
  const grp = new THREE.Group();
  const c = new THREE.Color();
  // branching coral
  {
    const N = 420;
    const im = new THREE.InstancedMesh(branchGeo(), litMat(0.55), N);
    scatter(N, 10000, 34000, 21, (m, x, y, z, r, k) => {
      const s = 260 + r() * 520;
      m.compose(new THREE.Vector3(x, y, z - 20), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r() * 6.3), new THREE.Vector3(s, s, s * (0.9 + r() * 0.5)));
      im.setMatrixAt(k, m);
      im.setColorAt(k, c.copy(REEF[k % REEF.length]).multiplyScalar(0.55 + r() * 0.35));
    });
    grp.add(im);
  }
  // brain and boulder coral: squashed bumpy domes
  {
    const g = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 1 + 0.06 * Math.sin(v.x * 30 + Math.sin(v.z * 22) * 2) * Math.sin(v.z * 26);
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    g.computeVertexNormals();
    g.rotateX(Math.PI / 2);
    const N = 260;
    const im = new THREE.InstancedMesh(g, litMat(0.3), N);
    scatter(N, 10000, 36000, 31, (m, x, y, z, r, k) => {
      const s = 140 + r() * 420;
      m.compose(new THREE.Vector3(x, y, z - 30), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.8 + r() * 0.4), s * (0.5 + r() * 0.4)));
      im.setMatrixAt(k, m);
      im.setColorAt(k, c.copy(REEF[(k * 3 + 1) % REEF.length]).lerp(new THREE.Color(0.5, 0.45, 0.3), 0.35).multiplyScalar(0.5 + r() * 0.3));
    });
    grp.add(im);
  }
  // sea fans: flat lacy discs standing across the current
  {
    const g = new THREE.CircleGeometry(1, 18, 0, Math.PI);
    g.rotateX(Math.PI / 2);
    const N = 200;
    const mat = litMat(0.7, THREE.DoubleSide);
    const im = new THREE.InstancedMesh(g, mat, N);
    scatter(N, 10500, 34000, 41, (m, x, y, z, r, k) => {
      const s = 200 + r() * 380;
      m.compose(new THREE.Vector3(x, y, z - 10), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6 + (r() - 0.5) * 0.6), new THREE.Vector3(s, s, s * 1.1));
      im.setMatrixAt(k, m);
      im.setColorAt(k, c.copy(REEF[[0, 3, 5, 7][k % 4]]).multiplyScalar(0.5 + r() * 0.3));
    });
    grp.add(im);
  }
  // tube sponges: clusters of open cylinders
  {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const h = 0.6 + (k % 3) * 0.35;
      const t = new THREE.CylinderGeometry(0.16, 0.12, h, 10, 1, true);
      t.translate(Math.cos(k * 1.3) * 0.28, h / 2, Math.sin(k * 1.3) * 0.28);
      parts.push(t.deleteAttribute('uv'));
    }
    const g = mergeGeometries(parts);
    g.rotateX(Math.PI / 2);
    const N = 160;
    const im = new THREE.InstancedMesh(g, litMat(0.45, THREE.DoubleSide), N);
    scatter(N, 10500, 30000, 51, (m, x, y, z, r, k) => {
      const s = 160 + r() * 260;
      m.compose(new THREE.Vector3(x, y, z - 10), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r() * 6.3), new THREE.Vector3(s, s, s * (1 + r())));
      im.setMatrixAt(k, m);
      im.setColorAt(k, c.copy(REEF[[1, 2, 4, 6][k % 4]]).multiplyScalar(0.55 + r() * 0.3));
    });
    grp.add(im);
  }
  return grp;
}

/** kelp: tall ribbons in forests, swaying with the swell */
function kelp(): THREE.InstancedMesh {
  const g = new THREE.PlaneGeometry(1, 1, 1, 14);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2);
  const N = 520;
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN; varying vec3 vW; varying float vH; varying vec3 vCol;
      void main(){
        vCol = instanceColor;
        vec3 p = position;
        float h = p.z;
        float ph = instanceMatrix[3].x * 0.0007 + instanceMatrix[3].y * 0.0005;
        // the swell pushes the whole stalk, the top most
        vec4 base = instanceMatrix * vec4(p, 1.0);
        float sway = sin(uTime * 0.7 + ph + h * 2.2) * 0.6 + sin(uTime * 1.3 + ph * 2.0 + h * 4.0) * 0.25;
        base.x += sway * h * h * 420.0;
        base.y += cos(uTime * 0.5 + ph) * h * h * 260.0;
        vH = h;
        vec4 w = modelMatrix * base;
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vN; varying vec3 vW; varying float vH; varying vec3 vCol;
      void main(){
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        // light through the blade (it's thin): lit from behind as well as in front
        vec3 c = olight(vCol, n, vW) + vCol * uSunCol * max(dot(-n, uSunDir), 0.0) * 0.5;
        c *= 0.75 + 0.35 * vH;
        gl_FragColor = vec4(oair(c, vW), 1.0);
      }`,
  });
  const im = new THREE.InstancedMesh(g, mat, N);
  const c = new THREE.Color();
  scatter(N, 11500, 36000, 61, (m, x, y, z, r, k) => {
    const h = 1500 + r() * 4200;
    m.compose(new THREE.Vector3(x, y, z - 20), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r() * 6.3), new THREE.Vector3(60 + r() * 80, 1, h));
    im.setMatrixAt(k, m);
    im.setColorAt(k, c.setRGB(0.2 + r() * 0.12, 0.32 + r() * 0.12, 0.08));
  });
  im.frustumCulled = false;
  return im;
}

/** schools of fish circling the bowl: every fish placed by the shader from its school's orbit */
function schools(): THREE.Mesh {
  // a little fish, x forward: a body and a forked tail
  const body = new THREE.SphereGeometry(1, 10, 6);
  body.scale(1, 0.32, 0.5);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.85, 0, 0, -1.6, 0, 0.55, -1.45, 0, 0, -0.85, 0, 0, -1.45, 0, 0, -1.6, 0, -0.55], 3));
  tail.computeVertexNormals();
  const fish = mergeGeometries([body.deleteAttribute('uv').toNonIndexed(), tail]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = fish.index;
  geo.setAttribute('position', fish.attributes.position);
  geo.setAttribute('normal', fish.attributes.normal);
  const r = rng(71);
  const off: number[] = [];
  const sch: number[] = [];
  const col: number[] = [];
  const size: number[] = [];
  // (radius, height, angular speed, phase, count, fish size, colour)
  const S: [number, number, number, number, number, number, number][] = [
    [3200, 3300, 0.09, 0, 140, 34, 0xc8d8e8],
    [11500, 1400, -0.06, 1, 90, 40, 0xffd23a],
    [13000, 3200, 0.05, 2.2, 120, 30, 0x5ab8ff],
    [10800, 700, 0.07, 3.6, 60, 52, 0xff7a2e],
    [16000, 2400, -0.04, 4.4, 160, 36, 0xd8e4f0],
    [12500, 5200, 0.045, 5.1, 110, 28, 0x2ee6c8],
    [19000, 4200, -0.035, 0.6, 130, 44, 0xb8c8d8],
    [9800, 2600, 0.08, 2.9, 50, 70, 0xff3d7f],
  ];
  for (const [rad, h, sp, ph, n, sz, hex] of S) {
    const cc = new THREE.Color(hex);
    const spread = 220 + n * 4;
    for (let k = 0; k < n; k++) {
      off.push((r() - 0.5) * spread * 2.4, (r() - 0.5) * spread * 1.6, (r() - 0.5) * spread * 0.7);
      sch.push(rad, h, sp, ph);
      const v = 0.85 + r() * 0.3;
      col.push(cc.r * v, cc.g * v, cc.b * v);
      size.push(sz * (0.8 + r() * 0.4));
    }
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 3));
  geo.setAttribute('aSch', new THREE.InstancedBufferAttribute(new Float32Array(sch), 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(col), 3));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(size), 1));
  geo.instanceCount = size.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec3 aOff; attribute vec4 aSch; attribute vec3 aCol; attribute float aSize;
      varying vec3 vN; varying vec3 vW; varying vec3 vCol;
      void main(){
        vCol = aCol;
        float a = aSch.w + uTime * aSch.z;
        // the school weaves in and out and up and down on its orbit
        float rad = aSch.x + sin(a * 3.0 + aSch.w) * aSch.x * 0.08;
        float h = aSch.y + sin(a * 2.0 + aSch.w * 1.7) * 380.0;
        vec3 c = vec3(cos(a) * rad, sin(a) * rad, h);
        vec3 fwd = normalize(vec3(-sin(a), cos(a), 0.0) * sign(aSch.z));
        vec3 up = vec3(0.0, 0.0, 1.0);
        vec3 side = normalize(cross(up, fwd));
        // each fish drifts about its place
        vec3 o = aOff + vec3(sin(uTime * 0.9 + aOff.y * 0.02), sin(uTime * 1.1 + aOff.x * 0.02), sin(uTime * 0.7 + aOff.z * 0.03)) * 60.0;
        vec3 p = position;
        // the tail beats
        float beat = sin(uTime * 14.0 + aOff.x * 0.05);
        p.y += beat * max(0.0, -p.x - 0.2) * 0.35;
        p *= aSize;
        vec3 sp = c + fwd * o.x + side * o.y + up * o.z + fwd * p.x + side * p.y + up * p.z;
        vec4 w = modelMatrix * vec4(sp, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * (fwd * normal.x + side * normal.y + up * normal.z));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vN; varying vec3 vW; varying vec3 vCol;
      void main(){
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(cameraPosition - vW);
        // countershaded: pale belly, darker back, and a silver flash when a flank turns to the light
        vec3 alb = vCol * mix(0.55, 1.15, smoothstep(-0.6, 0.4, -n.y));
        vec3 c = olight(alb, n, vW);
        c += uSunCol * pow(max(dot(reflect(-v, n), uSunDir), 0.0), 24.0) * 1.4;
        c += vCol * 0.5 * uNight;
        gl_FragColor = vec4(oair(c, vW), 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/** jellyfish: glowing bells pulsing slowly upward, trailing tentacles */
function jellies(): THREE.Mesh {
  const bell = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  bell.rotateX(Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [bell.deleteAttribute('uv')];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const t = new THREE.CylinderGeometry(0.03, 0.01, 2.4, 3, 6, true);
    t.rotateX(Math.PI / 2);
    t.translate(Math.cos(a) * 0.55, Math.sin(a) * 0.55, -1.2);
    parts.push(t.deleteAttribute('uv'));
  }
  const g = mergeGeometries(parts);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = g.index;
  geo.setAttribute('position', g.attributes.position);
  geo.setAttribute('normal', g.attributes.normal);
  const r = rng(81);
  const N = 46;
  const pos: number[] = [];
  const col: number[] = [];
  const hues = [0xff6ad5, 0x6ae8ff, 0xb48cff, 0xffa86a];
  for (let k = 0; k < N; k++) {
    const a = r() * Math.PI * 2;
    const d = 9800 + r() * 16000;
    pos.push(Math.cos(a) * d, Math.sin(a) * d, 1200 + r() * 7000, 70 + r() * 130);
    const c = new THREE.Color(hues[k % hues.length]);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(col), 3));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec4 aPos; attribute vec3 aCol;
      varying vec3 vN; varying vec3 vW; varying vec3 vCol; varying float vZ;
      void main(){
        vCol = aCol;
        float ph = aPos.x * 0.001 + aPos.y * 0.0013;
        float pulse = 0.5 + 0.5 * sin(uTime * 1.6 + ph);
        vec3 p = position;
        // the bell squeezes and opens; the tentacles trail and wave
        p.xy *= mix(1.0, 0.78, pulse * step(-0.05, p.z));
        p.xy += vec2(sin(uTime * 1.2 + p.z * 1.4 + ph), cos(uTime * 1.1 + p.z * 1.3 + ph)) * 0.12 * step(p.z, -0.05) * -p.z;
        vZ = p.z;
        vec3 c = aPos.xyz + vec3(sin(uTime * 0.07 + ph) * 300.0, cos(uTime * 0.06 + ph) * 300.0, mod(uTime * 40.0 + ph * 900.0, 1400.0) - 700.0);
        vec4 w = modelMatrix * vec4(c + p * aPos.w, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vN; varying vec3 vW; varying vec3 vCol; varying float vZ;
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float f = pow(1.0 - abs(dot(normalize(vN), v)), 2.0);
        float bell = step(-0.05, vZ);
        float k = (bell * (0.25 + f * 1.1) + (1.0 - bell) * 0.45) * mix(0.35, 1.6, uNight);
        float d = length(vW - cameraPosition);
        k *= exp(-d * uHaze * 0.8);
        gl_FragColor = vec4(vCol * k, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 7;
  return m;
}

/** a manta ray: a flat diamond whose wings beat in a slow wave */
function manta(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(2, 1.2, 24, 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    // (x across the wings, y along the body) → a diamond with a rounded nose and swept tips
    const w = 1 - Math.abs(y + 0.1) * 1.4;
    p.setXYZ(i, y * 0.9, x * Math.max(0.05, w), -Math.abs(x) * 0.05 + (1 - Math.abs(x)) * 0.08);
  }
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uPh: { value: 0 } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPh;
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 p = position;
        float s = abs(p.y);
        p.z += sin(uTime * 1.4 + uPh - s * 2.2) * s * s * 0.55;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 alb = mix(vec3(0.85, 0.88, 0.9), vec3(0.04, 0.05, 0.07), smoothstep(-0.3, 0.3, n.y));
        gl_FragColor = vec4(oair(olight(alb, n, vW), vW), 1.0);
      }`,
  });
  return new THREE.Mesh(g, mat);
}

/** a whale far out in the blue: a long body, a fluke that beats, fins */
function whale(): THREE.Group {
  const grp = new THREE.Group();
  const mat = litMat(0, THREE.DoubleSide);
  const geoC = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const dark = new THREE.Color(0.1, 0.13, 0.17);
  const bodyG = new THREE.SphereGeometry(1, 28, 16);
  bodyG.scale(1, 0.24, 0.22);
  const p = bodyG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const k = x < 0 ? 1 - Math.pow(-x, 1.6) * 0.75 : 1;
    p.setY(i, p.getY(i) * k);
    p.setZ(i, p.getZ(i) * k - (x > 0.3 ? (x - 0.3) * 0.06 : 0));
  }
  bodyG.computeVertexNormals();
  grp.add(new THREE.Mesh(geoC(bodyG, dark), mat));
  const fin = (sx: number) => {
    const f = new THREE.SphereGeometry(1, 10, 6);
    f.scale(0.22, 0.4, 0.03);
    f.rotateZ(sx * 0.3);
    f.translate(0.35, sx * 0.32, -0.12);
    grp.add(new THREE.Mesh(geoC(f, dark), mat));
  };
  fin(1);
  fin(-1);
  const fluke = new THREE.Group();
  const fg = new THREE.SphereGeometry(1, 12, 6);
  fg.scale(0.12, 0.34, 0.025);
  fluke.add(new THREE.Mesh(geoC(fg, dark), mat));
  fluke.position.set(-1.0, 0, 0);
  grp.add(fluke);
  grp.userData.fluke = fluke;
  grp.scale.setScalar(2600);
  return grp;
}

/** bubbles streaming up from vents in the sand, and a few drifting loose */
function bubbles(): THREE.Points {
  const r = rng(91);
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const vents: [number, number][] = [];
  for (let k = 0; k < 22; k++) {
    const a = r() * Math.PI * 2;
    const d = 10500 + r() * 14000;
    vents.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  for (let i = 0; i < N; i++) {
    if (i % 3) {
      const [vx, vy] = vents[i % vents.length];
      pos.set([vx + (r() - 0.5) * 120, vy + (r() - 0.5) * 120, bedZ(vx, vy)], i * 3);
    } else {
      const a = r() * Math.PI * 2;
      const d = 9500 + r() * 22000;
      pos.set([Math.cos(a) * d, Math.sin(a) * d, BED], i * 3);
    }
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uPx: { value: 1 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime; uniform float uPx; uniform float uHaze;
      varying float vA;
      void main(){
        vec3 p = position;
        float H = 14000.0;
        float rise = 160.0 + seed * 220.0;
        float z = mod(seed * H + uTime * rise, H);
        p.z += z;
        p.x += sin(uTime * 3.0 + seed * 50.0 + z * 0.01) * (20.0 + z * 0.01);
        p.y += cos(uTime * 2.6 + seed * 31.0 + z * 0.012) * (20.0 + z * 0.01);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // (they grow as they rise: less pressure)
        gl_PointSize = clamp((0.08 + seed * 0.14) * (1.0 + z / 9000.0) * 900.0 * uPx / -mv.z, 1.0, 18.0);
        vA = smoothstep(0.0, 400.0, z) * (1.0 - smoothstep(H * 0.8, H, z)) * exp(-(-mv.z) * uHaze * 0.9);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunCol; uniform vec3 uFog;
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        // a clear bubble: a bright rim and a glint
        float rim = smoothstep(0.55, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
        float glint = 1.0 - smoothstep(0.0, 0.25, length(gl_PointCoord - vec2(0.35, 0.32)));
        vec3 c = mix(uFog * 2.0, vec3(0.9, 1.0, 1.0), 0.6) + uSunCol * 0.2;
        gl_FragColor = vec4(c, (rim * 0.75 + glint * 0.9) * vA);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

/** shafts of sunlight slanting down from the waves (soft additive sheets turned to face you) */
function godRays(): THREE.Mesh {
  const r = rng(101);
  const N = 26;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const a: number[] = [];
  for (let k = 0; k < N; k++) {
    const an = r() * Math.PI * 2;
    const d = k < 6 ? r() * 6000 : 7000 + r() * 26000;
    // (x, y, width, phase)
    a.push(Math.cos(an) * d, Math.sin(an) * d, 1200 + r() * 3600, r() * 10);
  }
  geo.setAttribute('aRay', new THREE.InstancedBufferAttribute(new Float32Array(a), 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uRay: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec4 aRay;
      varying vec2 vU; varying float vPh; varying float vD;
      void main(){
        vU = uv; vPh = aRay.w;
        // a sheet from the surface to the floor, leaning with the light, turned about its axis to face the eye
        float top = 26000.0, bot = -600.0;
        vec3 camL = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        float z = mix(bot, top, uv.y);
        vec3 axis = vec3(aRay.xy + vec2(0.18, 0.1) * (z - bot), z);
        vec2 to = normalize(camL.xy - axis.xy + 1e-3);
        vec2 side = vec2(-to.y, to.x);
        float w = aRay.z * mix(1.0, 1.8, uv.y) * (0.85 + 0.15 * sin(uTime * 0.4 + aRay.w));
        vec3 p = axis + vec3(side * (uv.x - 0.5) * w, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunCol; uniform float uRay; uniform float uHaze;
      varying vec2 vU; varying float vPh; varying float vD;
      void main(){
        float across = sin(vU.x * 3.14159);
        across = pow(across, 2.5);
        // flickering with the waves overhead
        float fl = 0.6 + 0.4 * sin(uTime * 0.9 + vPh * 3.0 + vU.x * 6.0);
        float a = across * fl * pow(vU.y, 1.4) * smoothstep(0.0, 0.25, vU.y);
        // (never a slab in front of the lens, and gone into the blue far off)
        a *= smoothstep(8.0, 40.0, vD) * exp(-vD * uHaze * 0.5);
        gl_FragColor = vec4(uSunCol * a * 0.07 * uRay, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 8;
  return m;
}

export function buildOcean(): OceanView {
  const group = new THREE.Group();
  group.add(seabed(), rocks(), corals(), kelp(), schools(), jellies(), bubbles(), godRays());
  const mantas: THREE.Mesh[] = [];
  for (let k = 0; k < 3; k++) {
    const m = manta();
    m.scale.setScalar(380 + k * 60);
    (m.material as THREE.ShaderMaterial).uniforms.uPh.value = k * 2.1;
    mantas.push(m);
    group.add(m);
  }
  const wh = whale();
  group.add(wh);
  const fl = wh.userData.fluke as THREE.Group;
  return {
    group,
    setLook(t) {
      U.uSunDir.value.set(...t.keyDir).normalize();
      U.uSunCol.value.setRGB(...t.keyCol).multiplyScalar(t.day > 0.25 ? t.keyI * 0.75 : 0.35);
      U.uAmb.value.setRGB(...t.hemiSky).multiplyScalar(t.hemiI * (t.day > 0.25 ? 0.9 : 0.5));
      U.uFog.value.setRGB(...t.fog);
      U.uHaze.value = t.day > 0.25 ? 0.0085 : 0.011;
      U.uNight.value = 1 - Math.min(1, t.day * 1.6);
      U.uCaus.value = t.day > 0.25 ? 1 : 0.15;
    },
    update(t) {
      U.uTime.value = t;
      // the mantas glide on wide loops, banking into the turn
      mantas.forEach((m, k) => {
        const a = t * (0.05 + k * 0.012) + k * 2.1;
        const rad = 12500 + k * 3500;
        m.position.set(Math.cos(a) * rad, Math.sin(a) * rad, 2600 + k * 1300 + Math.sin(t * 0.3 + k) * 500);
        m.rotation.set(0, 0, a + Math.PI / 2);
        m.rotateX(-0.25);
        m.rotateY(Math.sin(t * 0.3 + k) * 0.08);
      });
      // the whale, slow and far
      const a = t * 0.012 + 1.3;
      wh.position.set(Math.cos(a) * 34000, Math.sin(a) * 34000, 9000 + Math.sin(t * 0.1) * 1200);
      wh.rotation.set(0, Math.sin(t * 0.25) * 0.06, a + Math.PI / 2);
      fl.rotation.y = Math.sin(t * 0.8) * 0.35;
    },
  };
}
