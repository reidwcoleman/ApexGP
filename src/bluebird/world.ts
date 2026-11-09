// Bluebird: renderer, sky, light, the snow-covered terrain (its shader reads the live snow state:
// corduroy where you groomed, tracked-out chop, powder, bare patches, lamp pools at night), the
// distant ranges, the forest and the falling snow.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Mountain, SIZE, HALF, GN, GS, SN, SC, LIFTS, RUNS, kickerProfile, rawHeight } from './mountain.ts';
import type { Sim } from './sim.ts';

export const NOISE_N = 256;
function noiseTexture() {
  const d = new Uint8Array(NOISE_N * NOISE_N * 4);
  const r = (x: number, y: number, s: number) => { let h = Math.imul(x * 73856093 ^ y * 19349663 ^ s * 83492791, 0x5bd1e995); h ^= h >>> 15; return ((h >>> 0) % 1000) / 1000; };
  // smooth tiling value noise in R, G; hash in B
  const smoothN = (x: number, y: number, cell: number, s: number) => {
    const fx = x / cell, fy = y / cell;
    const n = NOISE_N / cell;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const u = fx - xi, v = fy - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const g = (a: number, b: number) => r(((a % n) + n) % n, ((b % n) + n) % n, s);
    return (g(xi, yi) * (1 - su) + g(xi + 1, yi) * su) * (1 - sv) + (g(xi, yi + 1) * (1 - su) + g(xi + 1, yi + 1) * su) * sv;
  };
  for (let y = 0; y < NOISE_N; y++)
    for (let x = 0; x < NOISE_N; x++) {
      const i = (y * NOISE_N + x) * 4;
      d[i] = (smoothN(x, y, 32, 1) * 0.5 + smoothN(x, y, 16, 2) * 0.3 + smoothN(x, y, 8, 3) * 0.2) * 255;
      d[i + 1] = (smoothN(x, y, 8, 4) * 0.6 + smoothN(x, y, 4, 5) * 0.4) * 255;
      d[i + 2] = r(x, y, 9) * 255;
      d[i + 3] = 255;
    }
  const t = new THREE.DataTexture(d, NOISE_N, NOISE_N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export interface TreeGrid { x: Float32Array; z: Float32Array; r: Float32Array; cells: Map<number, number[]> }

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.3, 9000);
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a8f9a, 1.0);
  m: Mountain;
  uni = {
    uState: { value: null as THREE.Texture | null },
    uDir: { value: null as THREE.Texture | null },
    uMask: { value: null as THREE.Texture | null },
    uNoise: { value: noiseTexture() },
    uNight: { value: 0 },
    uDay: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
    uTime: { value: 0 },
    uLamps: { value: 0 },
    uHaze: { value: new THREE.Color(0xcfe0f2) },
  };
  stateTex: THREE.DataTexture;
  dirTex: THREE.DataTexture;
  maskTex: THREE.DataTexture;
  private stateBuf = new Uint8Array(SN * SN * 4);
  private dirBuf = new Uint8Array(SN * SN * 4);
  private maskBuf = new Uint8Array(SN * SN * 4);
  sky!: THREE.Mesh;
  skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() }, uNight: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 } };
  trees: TreeGrid = { x: new Float32Array(0), z: new Float32Array(0), r: new Float32Array(0), cells: new Map() };
  terrainMat!: THREE.MeshStandardMaterial;
  snowFall!: THREE.Points;
  private snowU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uRate: { value: 0 }, uWind: { value: 0 }, uNight: { value: 0 } };
  focus = new THREE.Vector3(0, 0, 300);
  night = 0;
  day = 1;
  /** materials that glow at night (windows, bulbs): their emissiveIntensity rides the dark */
  glowMats: { m: THREE.MeshStandardMaterial; k: number }[] = [];
  lampLights: THREE.Group = new THREE.Group();

  constructor(canvas: HTMLCanvasElement, m: Mountain) {
    this.m = m;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.8;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = new THREE.FogExp2(0xcfe0f2, 0.00028);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 10; sc.far = 1400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.stateTex = new THREE.DataTexture(this.stateBuf, SN, SN, THREE.RGBAFormat);
    this.dirTex = new THREE.DataTexture(this.dirBuf, SN, SN, THREE.RGBAFormat);
    this.maskTex = new THREE.DataTexture(this.maskBuf, SN, SN, THREE.RGBAFormat);
    for (const t of [this.stateTex, this.dirTex, this.maskTex]) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
    this.uni.uState.value = this.stateTex;
    this.uni.uDir.value = this.dirTex;
    this.uni.uMask.value = this.maskTex;
    this.buildMask();

    this.buildSky();
    this.buildTerrain();
    this.buildRange();
    this.buildTrees();
    this.buildKickers();
    this.buildSnowfall();
    this.scene.add(this.lampLights);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ snow state textures
  private buildMask() {
    const m = this.m;
    const b = this.maskBuf;
    for (let k = 0; k < SN * SN; k++) {
      const e = m.edge[k];
      b[k * 4] = Math.round(255 * Math.min(1, Math.max(0, (2.5 - e) / 4)));
      b[k * 4 + 1] = 0;
      b[k * 4 + 2] = m.runCell[k];
      b[k * 4 + 3] = 255;
    }
    this.maskTex.needsUpdate = true;
  }

  /** bake lamp pools into the mask (green) */
  setLamps(points: [number, number][], on: boolean) {
    const b = this.maskBuf;
    for (let k = 0; k < SN * SN; k++) b[k * 4 + 1] = 0;
    if (on) {
      const R = 34;
      for (const [x, z] of points) {
        const ci0 = Math.floor((x - R + HALF) / SC), ci1 = Math.ceil((x + R + HALF) / SC);
        const cj0 = Math.floor((z - R + HALF) / SC), cj1 = Math.ceil((z + R + HALF) / SC);
        for (let cj = Math.max(0, cj0); cj <= Math.min(SN - 1, cj1); cj++)
          for (let ci = Math.max(0, ci0); ci <= Math.min(SN - 1, ci1); ci++) {
            const d = Math.hypot((ci + 0.5) * SC - HALF - x, (cj + 0.5) * SC - HALF - z);
            if (d > R) continue;
            const k = cj * SN + ci;
            const v = 255 * Math.pow(1 - d / R, 1.6);
            b[k * 4 + 1] = Math.min(255, b[k * 4 + 1] + v);
          }
      }
    }
    this.maskTex.needsUpdate = true;
    this.uni.uLamps.value = on ? 1 : 0;
  }

  syncSnow(sim: Sim) {
    if (!sim.dirty) return;
    sim.dirty = false;
    const b = this.stateBuf, d = this.dirBuf;
    const { groom, powder, depth, dirA, dirB } = sim;
    for (let k = 0; k < SN * SN; k++) {
      const i = k * 4;
      b[i] = groom[k] * 255;
      b[i + 1] = powder[k] * 255;
      b[i + 2] = depth[k] > 254 ? 254 : depth[k];
      d[i] = (dirA[k] * 0.5 + 0.5) * 255;
      d[i + 1] = (dirB[k] * 0.5 + 0.5) * 255;
    }
    this.stateTex.needsUpdate = true;
    this.dirTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ terrain
  private buildTerrain() {
    const m = this.m;
    const mat = (this.terrainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }));
    const U = this.uni;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D uState; uniform sampler2D uDir; uniform sampler2D uMask; uniform sampler2D uNoise;
uniform float uNight; uniform float uDay; uniform vec3 uSunDir; uniform float uLamps;
float gBump = 0.0; float gSpark = 0.0;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 suv = (vWPos.xz + ${HALF.toFixed(1)}) / ${SIZE.toFixed(1)};
  vec4 st = texture2D(uState, suv);
  vec2 d2 = texture2D(uDir, suv).rg * 2.0 - 1.0;
  vec4 mk = texture2D(uMask, suv);
  float groom = st.r, powder = st.g, depth = st.b * 255.0;
  float onRun = mk.r;
  float a = atan(d2.y, d2.x) * 0.5;
  vec2 dir = vec2(cos(a), sin(a));
  float across = dot(vWPos.xz, vec2(-dir.y, dir.x));
  float fw = fwidth(across);
  float cordK = groom * (1.0 - powder) * smoothstep(0.09, 0.03, fw);
  float cord = sin(across * 6.2831 / 0.30);
  // the seam between two tiller passes
  float pass = abs(fract(across / 5.6) - 0.5);
  float n1 = texture2D(uNoise, vWPos.xz * 0.0071).r;
  float n2 = texture2D(uNoise, vWPos.xz * 0.061 + 0.3).r;
  float n3 = texture2D(uNoise, vWPos.xz * 0.23).g;
  float n4 = texture2D(uNoise, vWPos.xz * 0.9).g;
  float chop = (1.0 - max(groom, min(1.0, powder * 1.3))) * smoothstep(0.1, 0.6, onRun);
  float slope = 1.0 - vWNrm.y;
  vec3 snow = mix(vec3(0.80, 0.84, 0.90), vec3(0.86, 0.88, 0.92), n1);
  float camD = length(cameraPosition - vWPos);
  float nearK = smoothstep(260.0, 40.0, camD);
  vec3 col = snow;
  // groomed: slightly greyer and stripy
  col = mix(col, vec3(0.84, 0.865, 0.91), groom * (1.0 - powder) * 0.35);
  col *= 1.0 - cordK * (0.03 + 0.028 * cord);
  col *= 1.0 - groom * smoothstep(0.03, 0.0, pass - 0.47) * smoothstep(0.3, 0.06, fw) * 0.05;
  // skied off: mottled with ruts and moguls
  float mog = (texture2D(uNoise, vWPos.xz * 0.09 + vec2(0.37, 0.11)).g - 0.5) * 2.0;
  float far = texture2D(uNoise, vWPos.xz * 0.031 + 0.5).g;
  col *= 1.0 - chop * (0.05 + 0.07 * far + 0.02 * n4 * nearK + 0.02 * mog);
  col = mix(col, vec3(0.74, 0.77, 0.82), chop * smoothstep(0.6, 0.95, n2) * 0.35);
  // thin cover shows grass and dirt
  float bare = smoothstep(26.0, 4.0, depth + (n2 - 0.5) * 30.0);
  col = mix(col, mix(vec3(0.33, 0.30, 0.22), vec3(0.42, 0.44, 0.30), n3), bare * 0.9);
  // cliffs off-piste
  float rock = smoothstep(0.36, 0.44, slope + (n2 - 0.5) * 0.25) * (1.0 - onRun);
  rock *= smoothstep(0.38, 0.62, texture2D(uNoise, vWPos.xz * 0.045 + 0.2).r + slope * 0.4);
  vec3 rockC = mix(vec3(0.30, 0.31, 0.34), vec3(0.45, 0.45, 0.47), n3) * (0.8 + 0.4 * n4);
  col = mix(col, rockC, rock);
  // lamp pools
  diffuseColor.rgb = col;
  gBump = cordK * cord * 0.012 + nearK * (chop * mog * 0.035 + powder * (1.0 - groom) * n3 * 0.018);
  float hash = texture2D(uNoise, vWPos.xz * 1.9).b;
  gSpark = step(0.965, hash) * (0.4 + powder) * (1.0 - rock) * (1.0 - bare);
}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.86, 0.62, texture2D(uState, (vWPos.xz + ' + HALF.toFixed(1) + ') / ' + SIZE.toFixed(1) + ').r);')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 vp = -vViewPosition;
  vec3 dpdx = dFdx(vp), dpdy = dFdy(vp);
  float bx = dFdx(gBump), by = dFdy(gBump);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (bx * r1 + by * r2);
  normal = normalize(abs(det) * normal - grad * 3.0);
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec2 suv = (vWPos.xz + ${HALF.toFixed(1)}) / ${SIZE.toFixed(1)};
  float lamp = texture2D(uMask, suv).g * uLamps;
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * lamp * lamp * uNight * 0.55;
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 R = reflect(-V, normalize(vWNrm));
  float sp = pow(max(dot(R, normalize(uSunDir)), 0.0), 18.0);
  totalEmissiveRadiance += vec3(1.0) * gSpark * sp * uDay * 1.6 + vec3(0.8, 0.9, 1.0) * gSpark * 0.05 * uNight * (0.3 + lamp * 3.0);
}`);
    };
    mat.customProgramCacheKey = () => 'bb-terrain';

    // chunks of 100 cells (200 m); nearer chunks draw every vertex, farther ones every 2nd / 4th / 5th
    const C = 100;
    const nC = (GN - 1) / C;
    const lodIndex = (step: number) => {
      const idx: number[] = [];
      for (let j = 0; j < C; j += step) for (let i = 0; i < C; i += step) { const a = j * (C + 1) + i, b = a + step, c = a + (C + 1) * step, d = c + step; idx.push(a, c, b, b, c, d); }
      return new THREE.BufferAttribute(new Uint16Array(idx), 1);
    };
    this.terrainLods = [lodIndex(1), lodIndex(2), lodIndex(4), lodIndex(5)];
    const index = this.terrainLods[0];
    const H = m.H;
    const nrm = (gi: number, gj: number, out: number[]) => {
      const h = (i: number, j: number) => H[Math.min(GN - 1, Math.max(0, j)) * GN + Math.min(GN - 1, Math.max(0, i))];
      const nx = h(gi - 1, gj) - h(gi + 1, gj), nz = h(gi, gj - 1) - h(gi, gj + 1), ny = 2 * GS;
      const L = Math.hypot(nx, ny, nz);
      out[0] = nx / L; out[1] = ny / L; out[2] = nz / L;
    };
    const tmp = [0, 0, 0];
    for (let cj = 0; cj < nC; cj++)
      for (let ci = 0; ci < nC; ci++) {
        const pos = new Float32Array((C + 1) * (C + 1) * 3);
        const nor = new Float32Array((C + 1) * (C + 1) * 3);
        let p = 0;
        for (let j = 0; j <= C; j++)
          for (let i = 0; i <= C; i++) {
            const gi = ci * C + i, gj = cj * C + j;
            pos[p] = gi * GS - HALF; pos[p + 1] = H[gj * GN + gi]; pos[p + 2] = gj * GS - HALF;
            nrm(gi, gj, tmp);
            nor[p] = tmp[0]; nor[p + 1] = tmp[1]; nor[p + 2] = tmp[2];
            p += 3;
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setIndex(index);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.name = 'terrain';
        this.scene.add(mesh);
        this.chunks.push({ mesh, cx: (ci + 0.5) * C * GS - HALF, cz: (cj + 0.5) * C * GS - HALF, lod: 0 });
      }
  }
  terrainLods: THREE.BufferAttribute[] = [];
  chunks: { mesh: THREE.Mesh; cx: number; cz: number; lod: number }[] = [];
  treeTiles: { near: THREE.InstancedMesh; far: THREE.InstancedMesh; cx: number; cz: number }[] = [];

  /** pick terrain and forest detail by distance from the camera */
  private updateLods() {
    const c = this.camera.position;
    for (const ch of this.chunks) {
      const d = Math.max(0, Math.hypot(ch.cx - c.x, ch.cz - c.z) - 141);
      const lod = d < 260 ? 0 : d < 620 ? 1 : d < 1100 ? 2 : 3;
      if (lod !== ch.lod) { ch.lod = lod; ch.mesh.geometry.setIndex(this.terrainLods[lod]); }
    }
    for (const t of this.treeTiles) {
      const d = Math.max(0, Math.hypot(t.cx - c.x, t.cz - c.z) - 141);
      const near = d < 230;
      t.near.visible = near; t.far.visible = !near;
    }
  }

  // ------------------------------------------------------------------ the ranges around the valley
  private buildRange() {
    const rings = 34, segs = 220;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const nz = (x: number, y: number) => {
      // ridged noise
      let s = 0, a = 1, f = 1;
      for (let o = 0; o < 5; o++) {
        const v = Math.sin(x * f * 1.7 + Math.sin(y * f * 1.3) * 1.9) * Math.cos(y * f * 1.9 + Math.cos(x * f * 0.8) * 1.4);
        s += (1 - Math.abs(v)) * a; a *= 0.5; f *= 2.1;
      }
      return s / 1.9;
    };
    for (let r = 0; r <= rings; r++) {
      const R = 760 + Math.pow(r / rings, 1.35) * 4900;
      for (let s = 0; s <= segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const x = Math.cos(th) * R, z = Math.sin(th) * R;
        // start from the terrain's own edge so there's never a gap under the range
        const ex = Math.max(-HALF, Math.min(HALF, x)), ez = Math.max(-HALF, Math.min(HALF, z));
        const edgeH = rawHeight(ex, ez) - 4;
        const toward = Math.max(0, Math.sin(th));
        const open = Math.pow(Math.max(0, (Math.abs(Math.cos(th)) < 0.35 ? 1 - Math.abs(Math.cos(th)) / 0.35 : 0)) * toward, 0.8);
        let peaks = 220 + (180 + nz(x / 900, z / 900) * 640) * (1 - open * 0.75) - open * 160 + nz(x / 260 + 3, z / 260) * 90;
        peaks *= 0.8 + 0.2 * Math.min(1, R / 3000);
        const outside = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - HALF);
        const k = Math.min(1, outside / 900);
        const kk = k * k * (3 - 2 * k);
        const h = edgeH + (Math.max(edgeH, peaks) - edgeH) * kk - (outside < 1 ? 8 : 0);
        pos.push(x, h, z);
        const snowK = Math.min(1, Math.max(0, (h - 240) / 160));
        const c = new THREE.Color().setRGB(0.2, 0.26, 0.27).lerp(new THREE.Color(0.86, 0.89, 0.94), snowK);
        if (outside < 200) c.lerp(new THREE.Color(0.8, 0.84, 0.9), 1 - outside / 200);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    mesh.name = 'range';
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------------ forest
  private treeGeo() {
    const parts: THREE.BufferGeometry[] = [];
    const paint = (g: THREE.BufferGeometry, f: (ny: number, i: number) => [number, number, number]) => {
      const n = g.getAttribute('normal');
      const cols = new Float32Array(n.count * 3);
      for (let i = 0; i < n.count; i++) { const c = f(n.getY(i), i); cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return g;
    };
    const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.4, 5).toNonIndexed();
    trunk.translate(0, 1.0, 0);
    parts.push(paint(trunk, () => [0.24, 0.16, 0.1]));
    const tiers = [[2.7, 4.0, 1.5], [2.1, 3.6, 3.5], [1.45, 3.1, 5.4], [0.75, 2.5, 7.3]];
    tiers.forEach(([rad, h, y], t) => {
      const c = new THREE.ConeGeometry(rad, h, 8, 1).toNonIndexed();
      c.translate(0, y + h / 2 - 0.4, 0);
      // fake a hanging-bough skirt: the lower ring flares down a little
      const p = c.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (p.getY(i) < y) p.setY(i, p.getY(i) - 0.35 * ((i * 7) % 3) / 2);
      c.computeVertexNormals();
      const green: [number, number, number] = t % 2 ? [0.09, 0.19, 0.14] : [0.11, 0.22, 0.16];
      parts.push(paint(c, (ny, i) => (ny > 0.55 && (Math.floor(i / 3) % 4 !== 1) ? [0.9, 0.93, 0.97] : green)));
    });
    return mergeGeos(parts);
  }

  private treeGeoFar() {
    const parts: THREE.BufferGeometry[] = [];
    [[2.6, 6.2, 1.2], [1.5, 5.0, 4.6]].forEach(([rad, h, y], t) => {
      const c = new THREE.ConeGeometry(rad, h, 5, 1, true).toNonIndexed();
      c.translate(0, y + h / 2, 0);
      const n = c.getAttribute('normal');
      const cols = new Float32Array(n.count * 3);
      for (let i = 0; i < n.count; i++) { const top = t === 1 && c.getAttribute('position').getY(i) > y + h * 0.55; const k = top ? 0.4 : (i % 3 === 2 ? 0.12 : 0); cols[i * 3] = 0.1 + k * 0.8; cols[i * 3 + 1] = 0.2 + k * 0.7; cols[i * 3 + 2] = 0.15 + k * 0.8; }
      c.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(c);
    });
    return mergeGeos(parts);
  }

  private buildTrees() {
    const m = this.m;
    const geo = this.treeGeo();
    const farGeo = this.treeGeoFar();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const xs: number[] = [], zs: number[] = [], rs: number[] = [];
    const liftSegs = LIFTS.map((l) => l);
    const distSeg = (px: number, pz: number, a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
    };
    const hash = (i: number, j: number, s: number) => { let h = Math.imul(i * 92837111 ^ j * 689287499 ^ s * 283923481, 0x27d4eb2d); h ^= h >>> 15; return ((h >>> 0) % 10000) / 10000; };
    const STEP = 9;
    const gladeIdx = RUNS.findIndex((r) => r.glade) + 1;
    for (let j = 0; j < SIZE / STEP; j++)
      for (let i = 0; i < SIZE / STEP; i++) {
        const x = i * STEP - HALF + hash(i, j, 1) * STEP, z = j * STEP - HALF + hash(i, j, 2) * STEP;
        if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) continue;
        const k = m.cellAt(x, z);
        if (k < 0) continue;
        const e = m.edge[k];
        const onGlade = m.runCell[k] === gladeIdx;
        if (onGlade) { if (hash(i, j, 3) > 0.22 || e > -9 && e < -1 && false) continue; const n = m.nearestOn(m.runOf['glade'], x, z); if (Math.abs(n.lat) < 7) continue; }
        else if (e < 3 + hash(i, j, 4) * 6) continue;
        if (z > 405 && x > -330 && x < 350) continue; // base village
        if (z > 360 && x > -340 && x < 360 && hash(i, j, 5) < 0.7) continue;
        let nearLift = false;
        for (const l of liftSegs) if (distSeg(x, z, l.a, l.b) < 11) { nearLift = true; break; }
        if (nearLift) continue;
        const h = m.at(x, z);
        const tl = (h - 330) / 90;
        if (tl > 0 && hash(i, j, 6) < tl) continue;
        const nx = m.at(x + 2, z) - m.at(x - 2, z), nz = m.at(x, z + 2) - m.at(x, z - 2);
        if (Math.hypot(nx, nz) / 4 > 1.05) continue;
        // clumps: thin out by a noise field
        const clump = Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * Math.cos(z * 0.017 + x * 0.004);
        if (clump < -0.55 && hash(i, j, 7) < 0.7) continue;
        xs.push(x); zs.push(z); rs.push(0.7 + hash(i, j, 8) * 0.75);
      }
    // tiles of 200 m for culling
    const T = 200, nT = SIZE / T;
    const buckets: number[][] = Array.from({ length: nT * nT }, () => []);
    xs.forEach((x, i) => { const ti = Math.min(nT - 1, Math.floor((x + HALF) / T)), tj = Math.min(nT - 1, Math.floor((zs[i] + HALF) / T)); buckets[tj * nT + ti].push(i); });
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const b of buckets) {
      if (!b.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, b.length);
      const far = new THREE.InstancedMesh(farGeo, mat, b.length);
      far.instanceMatrix = im.instanceMatrix;
      far.castShadow = false; far.receiveShadow = false; far.name = 'treesFar';
      const tiIdx = buckets.indexOf(b);
      this.treeTiles.push({ near: im, far, cx: ((tiIdx % nT) + 0.5) * T - HALF, cz: (Math.floor(tiIdx / nT) + 0.5) * T - HALF });
      b.forEach((ti, n) => {
        const s = rs[ti];
        Q.setFromAxisAngle(Y, (ti * 2.399) % 6.283);
        S.set(s * (0.85 + (ti % 5) * 0.06), s * (0.9 + (ti % 7) * 0.05), s * (0.85 + (ti % 5) * 0.06));
        P.set(xs[ti], m.at(xs[ti], zs[ti]) - 0.3, zs[ti]);
        M.compose(P, Q, S);
        im.setMatrixAt(n, M);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      far.boundingSphere = im.boundingSphere;
      im.name = 'trees';
      this.scene.add(im, far);
    }
    const cells = new Map<number, number[]>();
    xs.forEach((x, i) => { const key = Math.floor((x + HALF) / 10) * 1000 + Math.floor((zs[i] + HALF) / 10); let a = cells.get(key); if (!a) cells.set(key, (a = [])); a.push(i); });
    this.trees = { x: new Float32Array(xs), z: new Float32Array(zs), r: new Float32Array(rs), cells };
  }

  /** nearest tree trunk within r of a point (for collisions) */
  treeHit(x: number, z: number, r: number): { x: number; z: number } | null {
    const ci = Math.floor((x + HALF) / 10), cj = Math.floor((z + HALF) / 10);
    const T = this.trees;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = T.cells.get((ci + a) * 1000 + cj + b);
        if (!list) continue;
        for (const i of list) { const d = Math.hypot(T.x[i] - x, T.z[i] - z); if (d < r + 0.45 * T.r[i]) return { x: T.x[i], z: T.z[i] }; }
      }
    return null;
  }

  private buildKickers() {
    const m = this.m;
    const mat = this.terrainMat;
    for (const k of m.kickers) {
      const L0 = -12 * k.size, L1 = 23 * k.size, W = 8.4;
      const nu = 46, nv = 10;
      const pos: number[] = [], idx: number[] = [];
      for (let a = 0; a <= nu; a++)
        for (let b = 0; b <= nv; b++) {
          const u = L0 + ((L1 - L0) * a) / nu, v = -W + (2 * W * b) / nv;
          const x = k.x + k.tx * u - k.tz * v, z = k.z + k.tz * u + k.tx * v;
          const y = m.at(x, z) + m.kickAt(x, z) + 0.04;
          pos.push(x, y, z);
        }
      for (let a = 0; a < nu; a++)
        for (let b = 0; b < nv; b++) { const i0 = a * (nv + 1) + b, i1 = i0 + 1, i2 = i0 + nv + 1, i3 = i2 + 1; idx.push(i0, i1, i2, i1, i3, i2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      // make the winding face up
      const n = g.getAttribute('normal');
      if (n.getY(Math.floor(n.count / 2)) < 0) { g.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true; mesh.castShadow = true;
      this.scene.add(mesh);
      // a blue lip line + side flags
      const lipW = 9;
      const lip = new THREE.Mesh(new THREE.BoxGeometry(lipW, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.6 }));
      const lx = k.x + k.tx * 0, lz = k.z + k.tz * 0;
      lip.position.set(lx, m.at(lx, lz) + kickerProfile(0) * k.size + 0.08, lz);
      lip.rotation.y = Math.atan2(k.tx, k.tz);
      this.scene.add(lip);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), new THREE.MeshStandardMaterial({ color: 0xf08a24 }));
        const px = k.x - k.tz * side * 7.5 - k.tx * 9, pz = k.z + k.tx * side * 7.5 - k.tz * 9;
        pole.position.set(px, m.at(px, pz) + 1.2, pz);
        this.scene.add(pole);
      }
    }
  }

  // ------------------------------------------------------------------ sky
  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunC; uniform float uNight; uniform float uCloud; uniform float uTime;
        varying vec3 vDir;
        float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float y = max(d.y, -0.2);
          vec3 c = mix(uHor, uTop, pow(smoothstep(-0.02, 0.55, y), 0.7));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          c += uSunC * (pow(sd, 900.0) * 30.0 * (1.0 - uCloud * 0.9) + pow(sd, 12.0) * 0.25 + pow(sd, 3.0) * 0.08) * (1.0 - uNight * 0.6);
          // moon on the opposite side
          vec3 md = normalize(vec3(-uSun.x, abs(uSun.y) + 0.35, -uSun.z));
          float m = max(dot(d, md), 0.0);
          c += vec3(0.9, 0.95, 1.0) * (smoothstep(0.9993, 0.9996, m) * 1.4 + pow(m, 60.0) * 0.08) * uNight * (1.0 - uCloud);
          // stars
          vec3 q = floor(d * 380.0);
          float s = h3(q);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
          c += vec3(0.85, 0.9, 1.0) * step(0.9985, s) * smoothstep(0.0, 0.25, y) * uNight * (1.0 - uCloud) * tw * 1.2;
          c = mix(c, uHor * 0.75, smoothstep(0.0, -0.2, d.y));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  private buildSnowfall() {
    const N = 9000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.snowU,
      transparent: true,
      depthWrite: false,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uRate; uniform float uWind; varying float vA;
        void main(){
          vec3 seed = position;
          float B = 70.0;
          vec3 p = seed * B;
          p.y -= uTime * (1.6 + seed.x * 0.8);
          p.x += uTime * uWind * (2.0 + seed.z * 3.0) + sin(uTime * 0.7 + seed.z * 20.0) * 0.8;
          p.z += sin(uTime * 0.5 + seed.x * 30.0) * 0.6;
          p = mod(p - uCam + B * 0.5, B) + uCam - B * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = step(seed.y, uRate) * smoothstep(B * 0.5, B * 0.2, length(mv.xyz));
          gl_PointSize = (30.0 / -mv.z) * (0.6 + seed.z * 0.8);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uNight; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0) * (1.0 - uNight * 0.6), a * 0.9); }`,
    });
    this.snowFall = new THREE.Points(g, mat);
    this.snowFall.frustumCulled = false;
    this.scene.add(this.snowFall);
  }

  // ------------------------------------------------------------------ time of day
  setTime(hour: number, cloud: number, snowRate: number, wind: number, dt: number, tSec: number) {
    // winter day: sunrise ~7:10, sunset ~17:10
    const dayT = (hour - 6.8) / 10.6;
    const elev = Math.sin(Math.PI * Math.min(1, Math.max(0, dayT))) * 0.5 + (dayT < 0 ? dayT * 0.9 : dayT > 1 ? -(dayT - 1) * 0.9 : 0);
    const az = 0.05 + 2.4 * Math.min(1.2, Math.max(-0.2, dayT)); // east in the morning, round the front of the mountain to the west
    const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    const day = Math.min(1, Math.max(0, (sunDir.y + 0.04) / 0.22));
    const night = 1 - Math.min(1, Math.max(0, (sunDir.y + 0.16) / 0.2));
    this.day = day;
    this.night = night;
    const gold = Math.min(1, Math.max(0, 1 - (sunDir.y - 0.02) / 0.3)) * day;

    const topDay = new THREE.Color(0x2d6fd0), horDay = new THREE.Color(0xbcd6f0);
    const topGold = new THREE.Color(0x3a5c9e), horGold = new THREE.Color(0xf6b57e);
    const topNight = new THREE.Color(0x050a18), horNight = new THREE.Color(0x14203a);
    const gray = new THREE.Color(0x9aa5b2), grayH = new THREE.Color(0xc4cbd3);
    const top = topDay.clone().lerp(topGold, gold * 0.7);
    const hor = horDay.clone().lerp(horGold, gold * 0.85);
    top.lerp(gray, cloud * 0.85); hor.lerp(grayH, cloud * 0.8);
    top.lerp(topNight, night); hor.lerp(horNight.clone().lerp(new THREE.Color(0x2a3040), cloud), night);
    this.skyU.uTop.value.copy(top);
    this.skyU.uHor.value.copy(hor);
    this.skyU.uSun.value.copy(sunDir);
    this.skyU.uSunC.value.setRGB(1, 0.85 - gold * 0.3, 0.7 - gold * 0.45);
    this.skyU.uNight.value = night;
    this.skyU.uCloud.value = cloud;
    this.skyU.uTime.value = tSec;

    // sun or moon
    const moonDir = new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) + 0.35, -sunDir.z).normalize();
    const L = night > 0.5 ? moonDir : sunDir;
    const f = this.focus;
    this.sun.position.set(f.x + L.x * 600, f.y + L.y * 600, f.z + L.z * 600);
    this.sun.target.position.copy(f);
    // snap the shadow camera to texels so shadows don't crawl
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    this.sun.position.x = Math.round(this.sun.position.x / texel) * texel;
    this.sun.position.z = Math.round(this.sun.position.z / texel) * texel;
    this.sun.target.position.x = Math.round(f.x / texel) * texel;
    this.sun.target.position.z = Math.round(f.z / texel) * texel;
    const sunI = day * (2.6 - cloud * 1.9) * (1 - gold * 0.3);
    const moonI = night * 0.32 * (1 - cloud * 0.6);
    this.sun.intensity = Math.max(sunI, moonI);
    this.sun.color.setRGB(1, 0.93 - gold * 0.25, 0.85 - gold * 0.42).lerp(new THREE.Color(0.62, 0.72, 1.0), night);
    this.sun.castShadow = this.sun.intensity > 0.08;
    this.hemi.intensity = 0.3 + day * (0.62 + cloud * 0.45);
    this.hemi.color.copy(top).lerp(new THREE.Color(0xd4e3ff), 0.6 * day);
    this.hemi.groundColor.setRGB(0.55, 0.57, 0.62).multiplyScalar(0.3 + day * 0.7);
    if (night > 0.5) { this.hemi.color.setRGB(0.18, 0.24, 0.42); this.hemi.groundColor.setRGB(0.07, 0.08, 0.12); this.hemi.intensity = 0.55; }
    this.renderer.toneMappingExposure = 0.78 + night * 0.4;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(hor).lerp(new THREE.Color(0xdde4ec), cloud * 0.5 * day);
    fog.density = 0.0003 + cloud * 0.00035 + snowRate * 0.0009 + night * 0.00004;
    this.uni.uHaze.value.copy(fog.color);
    this.uni.uNight.value = night;
    this.uni.uDay.value = day * (1 - cloud * 0.8);
    this.uni.uSunDir.value.copy(sunDir);
    this.uni.uTime.value = tSec;
    for (const g of this.glowMats) g.m.emissiveIntensity = g.k * (0.15 + night * 1.6 + cloud * 0.25 * day);
    this.snowU.uTime.value = tSec;
    this.snowU.uCam.value.copy(this.camera.position);
    this.snowU.uRate.value = Math.min(1, snowRate / 4.5);
    this.snowU.uWind.value = wind * 2.2;
    this.snowU.uNight.value = night * 0.6;
    this.snowFall.visible = snowRate > 0.02;
    this.sky.position.copy(this.camera.position);
  }

  /** register a material that glows at night */
  glow(m: THREE.MeshStandardMaterial, k = 1) { this.glowMats.push({ m, k }); return m; }

  render() { this.updateLods(); this.renderer.render(this.scene, this.camera); }
}

/** merge every plain mesh under root into one mesh per material (fewer draw calls) */
export function bake(root: THREE.Object3D, skip?: (m: THREE.Mesh) => boolean) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const gone: THREE.Mesh[] = [];
  const rel = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as any).isInstancedMesh || Array.isArray(m.material) || (skip && skip(m))) return;
    const mat = m.material as THREE.Material;
    if ((mat as any).transparent) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    const vc = !!(mat as any).vertexColors;
    for (const k of Object.keys(g.attributes)) if (!(k === 'position' || k === 'normal' || k === 'uv' || (vc && k === 'color'))) g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
    let list = byMat.get(mat);
    if (!list) byMat.set(mat, (list = []));
    list.push(g);
    gone.push(m);
  });
  for (const m of gone) m.parent?.remove(m);
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
  }
}

export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'color'];
  const out = new THREE.BufferGeometry();
  let total = 0;
  for (const g of list) total += g.getAttribute('position').count;
  for (const n of names) {
    if (!list.every((g) => g.getAttribute(n))) continue;
    const isz = list[0].getAttribute(n).itemSize;
    const arr = new Float32Array(total * isz);
    let o = 0;
    for (const g of list) { const a = g.getAttribute(n); for (let i = 0; i < a.count; i++) for (let c = 0; c < isz; c++) arr[o++] = a.array[i * isz + c] as number; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, isz));
  }
  return out;
}
