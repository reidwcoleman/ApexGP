import * as THREE from 'three';
import type { MapLook, TimeLook } from './looks.ts';

/**
 * What stands beyond the bowl: a snow range (Frostpeak), a downtown skyline (Neon Harbor), rolling
 * hills with woods (Greenvale Park). Authored in the simulation frame (cm, z up) like the rest of the
 * arena. Lit by their own small shader rather than the stadium's lights, so at night a range is a
 * moonlit silhouette, not a mountain in the floodlights, and each layer fades into its own air.
 */

export interface SurroundView {
  group: THREE.Group;
  setLook(t: TimeLook, keyDirThree: [number, number, number]): void;
}

// a shared set of uniforms for every surround material
const U = {
  uSunDir: { value: new THREE.Vector3(0, 0, 1) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uAmb: { value: new THREE.Color(0.4, 0.45, 0.55) },
  uFogCol: { value: new THREE.Color(0.7, 0.75, 0.85) },
  uHaze: { value: 0.00035 },
  uNight: { value: 0 },
  uSnowLine: { value: 0.6 },
};

// ------------------------------------------------------------------ noise
function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i + seed * 57.3) * (1 - u) + hash1(i + 1 + seed * 57.3) * u;
}
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** ridged multifractal along an angle (periodic: sampled on a circle) */
function ridge(theta: number, scale: number, seed: number): number {
  let v = 0;
  let a = 0.55;
  let f = scale;
  for (let k = 0; k < 5; k++) {
    const x = Math.cos(theta) * f + seed * 13.1;
    const y = Math.sin(theta) * f + seed * 7.7;
    const n = 1 - Math.abs(noise2(x, y) * 2 - 1);
    v += n * n * a;
    a *= 0.5;
    f *= 2.1;
  }
  return v;
}

// ------------------------------------------------------------------ shading
const LIT_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
  vCol = color;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vH = position.z;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// (the root turns sim cm into three metres, so world positions here are three's)
const LIT_COMMON = /* glsl */ `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uFogCol; uniform float uHaze; uniform float uNight; uniform float uSnowLine;
vec3 shade(vec3 albedo, vec3 n){
  float ndl = max(dot(n, uSunDir), 0.0);
  float sky = 0.55 + 0.45 * n.y;
  return albedo * (uSunCol * ndl + uAmb * sky);
}
vec3 air(vec3 c, vec3 w){
  float d = length(w - cameraPosition);
  float f = 1.0 - exp(-d * uHaze);
  // the air picks up a little of the sun's colour toward it
  vec3 v = normalize(w - cameraPosition);
  vec3 fc = uFogCol + uSunCol * pow(max(dot(v, uSunDir), 0.0), 6.0) * 0.12;
  return mix(c, fc, clamp(f, 0.0, 0.94));
}`;

/** a range: forest low down, rock on the steep faces, snow above the snow line */
function terrainMaterial(kind: 'peaks' | 'hills'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${LIT_COMMON}
      varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vH;
      void main(){
        vec3 n = normalize(vN);
        // vCol: x = relative height 0…1, y = a per-vertex random, z = how far out (0 near … 1 far)
        float rel = vCol.x;
        float slope = 1.0 - n.y;
        vec3 forest = mix(vec3(0.03, 0.06, 0.03), vec3(0.05, 0.085, 0.035), vCol.y);
        vec3 meadow = mix(vec3(0.12, 0.2, 0.05), vec3(0.17, 0.24, 0.07), vCol.y);
        vec3 rock = mix(vec3(0.075, 0.07, 0.068), vec3(0.15, 0.14, 0.13), vCol.y);
        vec3 col;
        ${
          kind === 'peaks'
            ? `col = mix(forest, rock, smoothstep(0.28, 0.5, rel + slope * 0.25));
        // snow lies everywhere above the line but the steepest faces, in streaks down the gullies
        float streak = fract(sin(dot(floor(vW.xz * 0.02), vec2(12.9898, 78.233))) * 43758.5453);
        float snow = smoothstep(uSnowLine - 0.05, uSnowLine + 0.05, rel + vCol.y * 0.1 + streak * 0.06 - smoothstep(0.8, 0.97, slope) * 0.35);
        col = mix(col, vec3(0.9, 0.93, 0.97), snow);`
            : `col = mix(meadow, forest, smoothstep(0.35, 0.6, vCol.y + slope * 0.8));
        col = mix(col, meadow * 1.15, smoothstep(0.75, 0.9, rel) * 0.5);`
        }
        vec3 c = shade(col, n);
        gl_FragColor = vec4(air(c, vW), 1.0);
      }`,
  });
}

/** a polar heightfield ring between r0 and r1 (cm) */
function rangeRing(r0: number, r1: number, peak: number, scale: number, seed: number, segs = 720, rows = 22): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let hmax = 1;
  const hs: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      // the range rises from its front edge, peaks a third of the way in, falls off behind
      const prof = Math.sin(Math.PI * Math.min(1, t * 1.25)) ** 0.8;
      const rg = ridge(th + t * 0.35, scale, seed) + 0.25 * ridge(th * 1.7 - t, scale * 2.3, seed + 5);
      const local = 0.7 + 0.6 * noise2(Math.cos(th) * 9 + t * 3, Math.sin(th) * 9 + seed);
      const h = peak * prof * rg * local;
      hs.push(h);
      hmax = Math.max(hmax, h);
    }
  }
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const r = r0 + (r1 - r0) * t;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const h = hs[j * (segs + 1) + i];
      pos.push(Math.cos(th) * r, Math.sin(th) * r, h - 600);
      col.push(h / hmax, hash1(i * 7.1 + j * 13.3 + seed), t);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the land between the stadium and the hills (grass or snow), fading into the air */
function groundDisk(color: THREE.Color, r: number): THREE.Mesh {
  const g = new THREE.CircleGeometry(r, 96);
  const n = g.attributes.position.count;
  const col: number[] = [];
  for (let i = 0; i < n; i++) col.push(color.r, color.g, color.b);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${LIT_COMMON}
      varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vH;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
        return mix(mix(h2(i), h2(i+vec2(1,0)), u.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), u.x), u.y); }
      void main(){
        // fields and copses in patches
        float p = vn(vW.xz * 0.012) * 0.6 + vn(vW.xz * 0.05) * 0.4;
        vec3 c = vCol * (0.75 + 0.5 * p);
        gl_FragColor = vec4(air(shade(c, vec3(0.0, 1.0, 0.0)), vW), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.z = -800;
  return mesh;
}

/** low-poly trees scattered over a heightfield ring (instanced: one draw) */
function woods(geo: THREE.BufferGeometry, count: number, seed: number, size: number): THREE.InstancedMesh {
  // a crown: a squashed icosahedron on a short trunk
  const crown = new THREE.IcosahedronGeometry(1, 1);
  crown.scale(0.7, 0.7, 1.15);
  crown.translate(0, 0, 1.3);
  const n = crown.attributes.position.count;
  const col: number[] = [];
  for (let i = 0; i < n; i++) col.push(0.5, 0.5, 0);
  crown.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vH; varying float vId;
      void main(){
        vCol = color;
        vId = float(gl_InstanceID);
        mat4 m = modelMatrix * instanceMatrix;
        vN = normalize(mat3(m) * normal);
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz;
        vH = position.z;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LIT_COMMON}
      varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vH; varying float vId;
      void main(){
        float hv = fract(sin(vId * 12.9898) * 43758.5453);
        vec3 c = mix(vec3(0.025, 0.055, 0.02), vec3(0.07, 0.12, 0.035), hv) * (0.7 + 0.45 * vH / 2.5);
        gl_FragColor = vec4(air(shade(c, normalize(vN)), vW), 1.0);
      }`,
  });
  const inst = new THREE.InstancedMesh(crown, mat, count);
  const p = geo.attributes.position;
  const c = geo.attributes.color;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let k = 0;
  let tries = 0;
  while (k < count && tries < count * 20) {
    tries++;
    const i = Math.floor(hash1(tries * 3.7 + seed) * p.count);
    // on the lower, gentler ground, in clumps
    if (c.getX(i) > 0.8) continue;
    const x = p.getX(i) + (hash1(tries * 1.3) - 0.5) * 2200;
    const y = p.getY(i) + (hash1(tries * 2.9) - 0.5) * 2200;
    if (noise2(x / 9000, y / 9000) < 0.42) continue;
    const s = size * (0.7 + 0.6 * hash1(tries * 5.1));
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), hash1(tries) * 6.28);
    m4.compose(new THREE.Vector3(x, y, p.getZ(i) - 200), q, new THREE.Vector3(s, s, s));
    inst.setMatrixAt(k++, m4);
  }
  inst.count = k;
  inst.frustumCulled = false;
  return inst;
}

/** downtown: instanced towers, glass by day, lit windows at night */
function skyline(seed: number): THREE.Group {
  const grp = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0, 0.5);
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vS; varying float vId;
      void main(){
        mat4 m = modelMatrix * instanceMatrix;
        vN = normalize(mat3(m) * normal);
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz;
        // the facade in metres: across, up
        vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)) * 0.01;
        vL = position;
        vId = float(gl_InstanceID);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LIT_COMMON}
      varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vS; varying float vId;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 n = normalize(vN);
        float tint = hh(vec2(vId, 3.0));
        vec3 base = mix(vec3(0.07, 0.085, 0.11), vec3(0.24, 0.23, 0.22), tint * tint);
        // windows: 3.6 m floors, 2.4 m bays
        float across = abs(vL.x) > 0.499 ? vL.y * vS.y : vL.x * vS.x;
        vec2 g = vec2(across / 2.4, vL.z * vS.z / 3.6);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.85) * step(abs(n.z), 0.5);
        vec3 c = shade(base, n);
        // by day the glass gives back the sky
        vec3 v = normalize(vW - cameraPosition);
        float fr = pow(1.0 - max(dot(-v, n), 0.0), 3.0);
        c = mix(c, uFogCol * mix(0.55, 1.0, fr), win * (0.25 + 0.55 * fr) * (1.0 - uNight));
        // at night: a scatter of lit offices, warm and cool, and the crown of each tower
        float lit = step(0.55, hh(cell + vId * 1.7)) * win;
        vec3 wc = mix(vec3(1.0, 0.78, 0.5), vec3(0.75, 0.85, 1.0), hh(cell * 0.7 + vId));
        c += wc * lit * uNight * 1.6;
        float crown = smoothstep(0.985, 0.995, vL.z) * step(0.6, hh(vec2(vId, 9.0)));
        c += mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.25, 0.7), hh(vec2(vId, 5.0))) * crown * uNight * 2.0;
        gl_FragColor = vec4(air(c, vW), 1.0);
      }`,
  });
  const N = 520;
  const inst = new THREE.InstancedMesh(box, mat, N);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let k = 0;
  for (let i = 0; i < N * 3 && k < N; i++) {
    const th = hash1(i * 1.37 + seed) * Math.PI * 2;
    const r = 48000 + Math.pow(hash1(i * 2.11 + seed), 0.7) * 100000;
    // downtown to the north-east of the stadium: the tall ones bunch there
    const dt = Math.max(Math.cos(th - 0.9), 0) ** 3;
    const h = (3500 + Math.pow(hash1(i * 3.3), 2.2) * 26000) * (0.45 + 1.4 * dt) * (r < 65000 ? 0.6 : 1);
    const w = 2200 + hash1(i * 4.7) * 3800;
    const d = 2200 + hash1(i * 5.9) * 3800;
    const x = Math.cos(th) * r;
    const y = Math.sin(th) * r;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.round(hash1(i * 6.1) * 4) * 0.39);
    m4.compose(new THREE.Vector3(x, y, -600), q, new THREE.Vector3(w, d, h));
    inst.setMatrixAt(k++, m4);
  }
  inst.count = k;
  inst.frustumCulled = false;
  grp.add(inst);
  return grp;
}

export function buildSurround(map: MapLook): SurroundView | null {
  const group = new THREE.Group();
  if (map.surround === 'none') return null;
  if (map.surround === 'mountains') {
    group.add(groundDisk(new THREE.Color(0.62, 0.65, 0.7), 330000));
    // near: wooded foothills; far: the snow range
    const near = rangeRing(60000, 120000, 32000, 2.2, 3, 480, 16);
    group.add(new THREE.Mesh(near, terrainMaterial('peaks')));
    group.add(woods(near, 3000, 4, 900));
    group.add(new THREE.Mesh(rangeRing(160000, 380000, 165000, 1.6, 7, 720, 28), terrainMaterial('peaks')));
  } else if (map.surround === 'hills') {
    group.add(groundDisk(new THREE.Color(0.11, 0.19, 0.05), 300000));
    const hills = rangeRing(32000, 110000, 30000, 1.3, 11, 520, 18);
    group.add(new THREE.Mesh(hills, terrainMaterial('hills')));
    group.add(woods(hills, 5000, 12, 650));
    // and a blue line of far ridges
    group.add(new THREE.Mesh(rangeRing(160000, 260000, 52000, 1.1, 13, 360, 10), terrainMaterial('hills')));
  } else if (map.surround === 'city') {
    group.add(groundDisk(new THREE.Color(0.07, 0.075, 0.08), 300000));
    group.add(skyline(21));
    group.add(new THREE.Mesh(rangeRing(190000, 280000, 40000, 1.2, 23, 360, 10), terrainMaterial('hills')));
  }
  return {
    group,
    setLook(t, k) {
      // three's frame → the sim frame these shaders light in (world = three: the root's transform is
      // applied to positions and normals, so the light stays in three's frame)
      U.uSunDir.value.set(k[0], k[1], k[2]).normalize();
      const sun = t.day > 0.25 ? t.keyI * 0.95 : 0.22;
      // (night: the moon, cold and dim)
      U.uSunCol.value.setRGB(...(t.day > 0.25 ? t.keyCol : ([0.5, 0.6, 0.9] as [number, number, number]))).multiplyScalar(sun);
      U.uAmb.value.setRGB(...t.hemiSky).multiplyScalar(t.hemiI * (t.day > 0.25 ? 0.7 : 0.35));
      U.uFogCol.value.setRGB(...t.fog);
      U.uHaze.value = t.day > 0.25 ? 0.00016 + (1 - t.day) * 0.0003 : 0.00035;
      U.uNight.value = 1 - Math.min(1, t.day * 1.6);
      U.uSnowLine.value = 0.27;
    },
  };
}
