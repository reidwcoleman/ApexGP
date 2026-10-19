/**
 * The grass. Tens of thousands of instanced tufts (four blades each, three segments a blade) in 4 m
 * chunks, lit by the scene's own lights and shadows (MeshStandardMaterial, patched):
 *   - each tuft reads the mowing mask under it: tall, or cut to a stub with the stripe tone;
 *   - density falls off with distance from the mower (a stochastic LOD, per tuft, in the vertex
 *     shader: tufts fade out by a random rank while the survivors widen), so the near lawn is
 *     lush and the far lawn is still full of grass for few triangles;
 *   - wind that rolls across the lawn in gusts, and grass that parts and lies down before the deck;
 *   - light through the blades when back-lit, a soft wrapped terminator, a dark root.
 * Under it a ground surface carries the same colours and a scanned turf normal map.
 */
import * as THREE from 'three';
import type { LevelDef, Theme } from './levels.ts';
import { TS } from './nav.ts';
import type { MaskField } from './mask.ts';
import { Rng } from './util.ts';

const CHUNK = 4;
const DENSITY = 150;
export const LOD_FAR = 24;

export interface GrassU {
  [k: string]: THREE.IUniform;
  uMask: THREE.IUniform<THREE.Texture>;
  uSize: THREE.IUniform<THREE.Vector2>;
  uTime: THREE.IUniform<number>;
  uFocus: THREE.IUniform<THREE.Vector2>;
  uMower: THREE.IUniform<THREE.Vector3>;
  uStub: THREE.IUniform<number>;
  uH: THREE.IUniform<number>;
  uDens: THREE.IUniform<number>;
  uBase: THREE.IUniform<THREE.Color>;
  uTipA: THREE.IUniform<THREE.Color>;
  uTipB: THREE.IUniform<THREE.Color>;
  uCutL: THREE.IUniform<THREE.Color>;
  uCutD: THREE.IUniform<THREE.Color>;
  uDry: THREE.IUniform<THREE.Color>;
  uMaskOn: THREE.IUniform<number>;
}

export function grassUniforms(theme: Theme, mask: MaskField): GrassU {
  const c = (h: string) => new THREE.Color(h);
  return {
    uMask: { value: mask.tex },
    uSize: { value: new THREE.Vector2(mask.W, mask.H) },
    uTime: { value: 0 },
    uFocus: { value: new THREE.Vector2() },
    uMower: { value: new THREE.Vector3(0, 0, 0.3) },
    uStub: { value: 0.028 },
    uH: { value: 0.3 },
    uDens: { value: 1 },
    uBase: { value: c(theme.grass.base) },
    uTipA: { value: c(theme.grass.tipA) },
    uTipB: { value: c(theme.grass.tipB) },
    uCutL: { value: c(theme.grass.cutL) },
    uCutD: { value: c(theme.grass.cutD) },
    uDry: { value: c(theme.grass.dry) },
    uMaskOn: { value: 1 },
  };
}

const NOISE = /* glsl */ `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float gFbm(vec2 p) { return gNoise(p) * 0.55 + gNoise(p * 2.07 + 4.3) * 0.3 + gNoise(p * 4.1 + 9.1) * 0.15; }
`;

const COLOR_FS = /* glsl */ `
uniform vec3 uBase; uniform vec3 uTipA; uniform vec3 uTipB; uniform vec3 uCutL; uniform vec3 uCutD; uniform vec3 uDry; uniform float uTime;
// the lawn's colour at a point: long grass at height t (0 root … 1 tip), or cut to a stripe tone
vec3 lawnColour(vec2 wp, float t, float rnd, float tall, float stripe) {
  float big = gFbm(wp * 0.11);
  float mid = gNoise(wp * 1.6);
  float dryM = smoothstep(0.58, 0.82, big);
  vec3 tallC = mix(uBase, mix(uTipA, uTipB, rnd), pow(t, 0.8));
  tallC = mix(tallC, uDry * (0.55 + 0.6 * t), dryM * 0.5 * (0.3 + 0.7 * t));
  tallC *= 0.86 + 0.28 * mid;
  vec3 cutC = mix(uCutD, uCutL, stripe) * mix(0.72, 1.04, t) * (0.94 + 0.12 * rnd);
  cutC = mix(cutC, uDry * 0.92, dryM * 0.3);
  cutC *= 0.94 + 0.12 * mid;
  cutC = mix(vec3(dot(cutC, vec3(0.3, 0.59, 0.11))), cutC, 0.86) * 0.96;
  // clouds drifting over: slow patches of a little more and a little less light
  float cl = gFbm(wp * 0.05 + vec2(uTime * 0.5, uTime * 0.18));
  float cloud = mix(0.9, 1.06, smoothstep(0.3, 0.72, cl));
  return mix(cutC, tallC, smoothstep(0.15, 0.75, tall)) * cloud;
}
`;

// ---------------------------------------------------------------- blades

const BLADE_LIGHT = /* glsl */ `
varying float vLeaf;
void RE_Direct_Grass( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  // light through the blades: forward scatter when the sun is behind the grass, a fainter diffuse
  // transmission always, in the yellow-green a leaf lets through
  float VL = saturate( dot( -geometryViewDir, directLight.direction ) );
  float back = saturate( dot( -geometryNormal, directLight.direction ) * 0.6 + 0.4 );
  float through = ( pow( VL, 5.0 ) * 0.95 + 0.3 * back * back ) * vLeaf;
  vec3 dc = material.diffuseColor;
  vec3 tc = dc * dc / max( max( dc.r, dc.g ), 1e-3 );
  reflectedLight.directDiffuse += directLight.color * tc * vec3( 1.0, 1.0, 0.55 ) * through * 0.75;
  // a soft terminator on the lit side
  float nl = dot( geometryNormal, directLight.direction );
  float wrapL = saturate( ( nl + 0.35 ) / 1.35 ) - saturate( nl );
  reflectedLight.directDiffuse += directLight.color * dc * wrapL * 0.3 * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Grass
`;

/** `wild`: the uncut meadow beyond the fences: always tall, coarser, taller, a little dry. */
export function makeGrassMaterial(u: GrassU, wild = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    if (wild) {
      sh.vertexShader = '#define WILD\n' + sh.vertexShader;
      sh.fragmentShader = '#define WILD\n' + sh.fragmentShader;
    }
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 iPos; attribute vec4 iRnd; attribute float aT; attribute vec2 aW; attribute vec2 aLean;
uniform sampler2D uMask; uniform vec2 uSize; uniform float uTime; uniform vec2 uFocus; uniform vec3 uMower; uniform float uStub; uniform float uH; uniform float uDens;
varying float vT; varying float vTall; varying float vStripe; varying float vRnd; varying vec2 vWp; varying float vLeaf;
float lodDens(float d) { float k = clamp((${LOD_FAR.toFixed(1)} - d) / 18.0, 0.0, 1.0); return k * sqrt(k); }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float cy = cos(iPos.z); float sy = sin(iPos.z);
vec3 objectNormal = vec3(cy * normal.x + sy * normal.z, normal.y, -sy * normal.x + cy * normal.z);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
{
  vec2 wp = iPos.xy;
  vec4 mk = texture2D(uMask, wp / uSize + 0.5);
#ifdef WILD
  mk = vec4(1.0, 0.5, 0.0, 1.0);
#endif
  float tall = mk.r;
  float k = tall * tall * (3.0 - 2.0 * tall);
  float dd = distance(wp, uFocus);
  float dens = lodDens(dd) * uDens;
  float vis = smoothstep(0.0, 0.2, dens - iRnd.w);
  float comp = clamp(inversesqrt(max(lodDens(dd), 0.05)), 1.0, 3.2);
  float H = mix(uStub * (0.8 + 0.5 * iRnd.y), uH * (0.72 + 0.56 * iRnd.y), k) * vis;
#ifdef WILD
  H = uH * (1.05 + 1.5 * iRnd.y * iRnd.y + 0.5 * iRnd.x) * vis;
  comp *= 1.5;
#endif
  float t = aT;
  mat2 R = mat2(cy, -sy, sy, cy);
  vec2 base = R * position.xz;
  vec2 wd = R * aW * comp * mix(0.7, 1.0, k);
  vec2 ln = R * aLean * (0.45 + 0.55 * k);
  // wind: a breeze plus gusts rolling across the lawn
  float w1 = sin(uTime * 1.3 + wp.x * 0.35 + wp.y * 0.2 + iRnd.z * 6.28);
  float w2 = sin(uTime * 2.3 + wp.y * 0.9 - wp.x * 0.4 + iRnd.z * 3.0);
  float gust = 0.5 + 0.5 * sin(uTime * 0.45 + dot(wp, vec2(0.11, 0.07)));
  vec2 bend = vec2(w1 * 0.7 + w2 * 0.3, w1 * 0.3 - w2 * 0.2) * (0.05 + 0.07 * gust) * t * t * k;
  // the grass parts before the mower and lies down under it
  vec2 dm = wp - uMower.xy;
  float md = length(dm);
  float push = 1.0 - smoothstep(0.05, uMower.z * 1.5 + 0.25, md);
  bend += (dm / max(md, 0.001)) * push * 0.4 * t * t * k;
  float lean = t * t;
  float y = position.y * H * (1.0 - 0.4 * push * k * t);
  transformed = vec3(wp.x + base.x + wd.x + (ln.x * lean + bend.x) * H, y, wp.y + base.y + wd.y + (ln.y * lean + bend.y) * H);
  vT = t; vTall = tall; vStripe = mk.g; vRnd = iRnd.x; vWp = wp;
  vLeaf = k * smoothstep(0.1, 1.0, t);
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vT; varying float vTall; varying float vStripe; varying float vRnd; varying vec2 vWp;\n${NOISE}\n${COLOR_FS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${BLADE_LIGHT}`)
      .replace('#include <color_fragment>', `diffuseColor.rgb = lawnColour(vWp, clamp(vT, 0.0, 1.0), vRnd, vTall, clamp(vStripe, 0.0, 1.0));
diffuseColor.rgb *= mix(1.0, mix(0.32, 1.0, smoothstep(0.0, 0.5, clamp(vT, 0.0, 1.0))), vTall);
#ifdef WILD
diffuseColor.rgb = mix(diffuseColor.rgb, uDry * (0.5 + 0.7 * vT) * (0.8 + 0.4 * vRnd), 0.18 + 0.4 * gFbm(vWp * 0.17));
#endif`);
  };
  m.customProgramCacheKey = () => (wild ? 'lawn-grass-wild-v2' : 'lawn-grass-v2');
  return m;
}

// ---------------------------------------------------------------- ground

export function makeGroundMaterial(u: GrassU, turfN: THREE.Texture, outside: boolean, turfC?: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, normalMap: turfN, normalScale: new THREE.Vector2(0.9, 0.9) });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.uniforms.uTurfC = { value: turfC ?? null };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vWp; uniform sampler2D uMask; uniform vec2 uSize; uniform float uMaskOn; uniform sampler2D uTurfC;\n${NOISE}\n${COLOR_FS}`)
      .replace(
        '#include <color_fragment>',
        `{
  vec4 mk = texture2D(uMask, vWp / uSize + 0.5);
  float inside = ${outside ? '0.0' : '1.0'};
  float tall = mix(1.0, mk.r, inside);
  // the root layer under long grass is dark; cut ground is the stripe's colour
  vec3 c = lawnColour(vWp, 0.18 + 0.1 * gNoise(vWp * 5.0), gNoise(vWp * 3.0), tall, mk.g);
  ${outside ? `c = mix(c, uDry * 0.8, 0.25 + 0.3 * gFbm(vWp * 0.07));
  c = mix(c, uDry * 0.7, smoothstep(0.5, 0.82, gFbm(vWp * 0.035 + 5.0)) * 0.45);
  // the stalks and tussocks of the field, as seen from further off than the tufts reach
  float fine = gNoise(vWp * vec2(5.0, 7.0)) * 0.45 + gNoise(vWp * vec2(19.0, 23.0)) * 0.35 + gNoise(vWp * 2.3) * 0.2;
  c *= (0.78 + 0.5 * fine) * 0.92;` : ''}
  // the grain of real turf on the cut ground: a scanned colour map at two scales, as light and dark only
  float g1 = dot(texture2D(uTurfC, vWp / 1.4).rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.0716;
  float g2 = dot(texture2D(uTurfC, vWp / 4.3 + 0.37).rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.0716;
  c *= mix(pow(clamp(g1 * g2, 0.25, 4.0), 0.27), 1.0, tall * 0.85);
  ${outside ? '' : `// clippings lying on the cut lawn: pale slivers lying every which way
  {
    vec2 cp = vWp * 27.0;
    vec2 cell = floor(cp);
    vec2 fr = fract(cp) - 0.5;
    float h1 = gHash(cell + 3.1);
    float h2 = gHash(cell + 17.7);
    float a = h2 * 6.2832;
    vec2 d = vec2(cos(a), sin(a));
    float along = dot(fr, d);
    float across = dot(fr, vec2(-d.y, d.x));
    float sliver = smoothstep(0.42, 0.28, abs(along)) * smoothstep(0.1, 0.03, abs(across));
    float on = step(0.78, h1) * smoothstep(0.1, 0.55, mk.b) * (1.0 - tall);
    vec3 clipC = mix(uTipA, uDry, 0.35 + 0.4 * h2) * (1.0 + 0.4 * h1);
    c = mix(c, clipC, sliver * on * 0.75);
  }`}
  diffuseColor.rgb = c * (${outside ? '0.8' : '0.62'} + 0.38 * smoothstep(0.0, 1.0, 1.0 - tall));
}`,
      );
  };
  m.customProgramCacheKey = () => (outside ? 'lawn-ground-out-v3' : 'lawn-ground-v3');
  return m;
}

/** The lawn's top surface: a quad per playable tile, uv in metres (the turf normal map repeats every 1.4 m). */
export function groundGeometry(level: LevelDef): THREE.BufferGeometry {
  const { w, h, nav } = level;
  const W = w * TS;
  const H = h * TS;
  const pos: number[] = [];
  const uv: number[] = [];
  const S = 1 / 1.4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!nav.tile(i, j)) continue;
      const x0 = i * TS - W / 2;
      const z0 = j * TS - H / 2;
      const x1 = x0 + TS;
      const z1 = z0 + TS;
      pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1);
      uv.push(x0 * S, z0 * S, x0 * S, z1 * S, x1 * S, z0 * S, x1 * S, z0 * S, x0 * S, z1 * S, x1 * S, z1 * S);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const nrm: number[] = [];
  for (let i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

// ---------------------------------------------------------------- tufts

/** One tuft: four blades of three segments, shared by every chunk. */
export function tuftGeometry(): { position: THREE.BufferAttribute; aT: THREE.BufferAttribute; aW: THREE.BufferAttribute; aLean: THREE.BufferAttribute; normal: THREE.BufferAttribute; index: THREE.BufferAttribute } {
  const rng = new Rng(4242);
  const pos: number[] = [];
  const aT: number[] = [];
  const aW: number[] = [];
  const aLean: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const rows = [0, 0.38, 0.72];
  const half = [0.0072, 0.0066, 0.0044];
  const blades = 4;
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const r0 = rng.range(0.012, 0.034);
    const bx = Math.cos(ang) * r0;
    const bz = Math.sin(ang) * r0;
    const la = ang + rng.range(-1.0, 1.0);
    const leanAmt = rng.range(0.08, 0.34);
    const lx = Math.cos(la) * leanAmt;
    const lz = Math.sin(la) * leanAmt;
    const wa = la + Math.PI / 2 + rng.range(-0.3, 0.3);
    const wx = Math.cos(wa);
    const wz = Math.sin(wa);
    const hf = 0.62 + 0.38 * (b === 0 ? 1 : rng.next());
    // the blade's face normal: across its width, tipped toward the sky so lighting stays soft
    const fx = -wz;
    const fz = wx;
    const nx = fx * 0.6;
    const ny = 0.8;
    const nz = fz * 0.6;
    const o = pos.length / 3;
    for (let r = 0; r < rows.length; r++) {
      for (const s of [-1, 1]) {
        pos.push(bx, rows[r] * hf, bz);
        aT.push(rows[r]);
        aW.push(wx * half[r] * s, wz * half[r] * s);
        aLean.push(lx, lz);
        nor.push(nx, ny, nz);
      }
    }
    pos.push(bx, hf, bz);
    aT.push(1);
    aW.push(0, 0);
    aLean.push(lx, lz);
    nor.push(nx, ny, nz);
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4, o + 3, o + 5, o + 4, o + 4, o + 5, o + 6);
  }
  return {
    position: new THREE.Float32BufferAttribute(pos, 3),
    aT: new THREE.Float32BufferAttribute(aT, 1),
    aW: new THREE.Float32BufferAttribute(aW, 2),
    aLean: new THREE.Float32BufferAttribute(aLean, 2),
    normal: new THREE.Float32BufferAttribute(nor, 3),
    index: new THREE.Uint16BufferAttribute(idx, 1),
  };
}

interface Chunk {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  n: number;
  cx: number;
  cz: number;
}

export class Grass {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private chunks: Chunk[] = [];
  private shared: ReturnType<typeof tuftGeometry>;
  tufts = 0;

  constructor(level: LevelDef, mask: MaskField, readonly u: GrassU) {
    this.material = makeGrassMaterial(u);
    this.shared = tuftGeometry();
    const rng = new Rng(level.seed * 31 + 7);
    const { w, h, nav } = level;
    const W = w * TS;
    const H = h * TS;
    const s = 1 / Math.sqrt(DENSITY);
    const nx = Math.ceil(W / CHUNK);
    const nz = Math.ceil(H / CHUNK);
    for (let cj = 0; cj < nz; cj++) {
      for (let ci = 0; ci < nx; ci++) {
        const x0 = ci * CHUNK - W / 2;
        const z0 = cj * CHUNK - H / 2;
        // any tile in this chunk?
        const pts: number[] = [];
        for (let z = z0 + s / 2; z < z0 + CHUNK; z += s) {
          for (let x = x0 + s / 2; x < x0 + CHUNK; x += s) {
            const px = x + rng.range(-0.45, 0.45) * s;
            const pz = z + rng.range(-0.45, 0.45) * s;
            if (!nav.playable(px, pz)) continue;
            const k = mask.index(px, pz);
            if (k < 0 || mask.solid[k]) continue;
            pts.push(px, pz);
          }
        }
        const n = pts.length / 2;
        if (n < 8) continue;
        // a random order, so the first fraction of the instances is an even thinning
        const order = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(rng.next() * (i + 1));
          const t = order[i];
          order[i] = order[j];
          order[j] = t;
        }
        const iPos = new Float32Array(n * 3);
        const iRnd = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const o = order[i];
          iPos[i * 3] = pts[o * 2];
          iPos[i * 3 + 1] = pts[o * 2 + 1];
          iPos[i * 3 + 2] = rng.range(0, Math.PI * 2);
          iRnd[i * 4] = rng.next();
          iRnd[i * 4 + 1] = rng.next();
          iRnd[i * 4 + 2] = rng.next();
          iRnd[i * 4 + 3] = (i + 0.5) / n;
        }
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', this.shared.position);
        geo.setAttribute('normal', this.shared.normal);
        geo.setAttribute('aT', this.shared.aT);
        geo.setAttribute('aW', this.shared.aW);
        geo.setAttribute('aLean', this.shared.aLean);
        geo.setIndex(this.shared.index);
        geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
        geo.setAttribute('iRnd', new THREE.InstancedBufferAttribute(iRnd, 4));
        geo.instanceCount = n;
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, 0.15, z0 + CHUNK / 2), CHUNK * 0.75 + 0.5);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({ mesh, geo, n, cx: x0 + CHUNK / 2, cz: z0 + CHUNK / 2 });
        this.tufts += n;
      }
    }
  }

  /** Thin each chunk to what its distance from the mower deserves. */
  update(fx: number, fz: number, densScale: number) {
    this.u.uFocus.value.set(fx, fz);
    this.u.uDens.value = densScale;
    const R = CHUNK * 0.72;
    for (const c of this.chunks) {
      const d = Math.max(0, Math.hypot(c.cx - fx, c.cz - fz) - R);
      const k = Math.max(0, Math.min(1, (LOD_FAR - d) / 18));
      const dens = k * Math.sqrt(k) * densScale;
      const count = Math.min(c.n, Math.ceil(c.n * dens + 0.5));
      c.geo.instanceCount = count;
      c.mesh.visible = count > 0 && d < LOD_FAR;
    }
  }

  dispose() {
    for (const c of this.chunks) {
      c.geo.deleteAttribute('iPos');
      c.geo.deleteAttribute('iRnd');
      c.geo.dispose();
    }
    this.shared.position.array = new Float32Array(0);
    this.material.dispose();
  }
}

export { CHUNK };
