/**
 * Tyre condition shading: the wheel material (rubber + wheel cover) with wear driven by the physics.
 *
 * One material per corner (per car) so each tyre shows its own state; they all share one
 * program (same cache key) and the compound atlas textures, so the cost is uniform uploads only.
 *
 *   uTyreA  wear (0 new … 1 gone), heat (0 … 1 above the window), blistering, graining
 *   uTyreB  marbles / rubber pick-up, brake dust, sidewall grass & dirt, tread dirt (after an off)
 *   uTyreC  flat-spot position (atlas u), flat-spot depth, spin blur (0 … 1), treaded (inters / wets)
 *
 * Regions come from the wheel atlas v (see carLayout: sidewall rows 0‥256, tread 256‥352, rim cells
 * below). A tileable detail texture carries graining ridges, pick-up / blister blobs and patch noise;
 * it is sampled with a gradient stretched along the rolling direction as the wheel spins up, so a
 * fast wheel shows a smooth, banded tread instead of strobing detail.
 */
import * as THREE from 'three';
import { WET_PARS, wetUniforms } from './carWet.ts';
import { wheelTextures, type Compound } from './carTextures.ts';

export interface TyreLook {
  wear: number;
  heat: number;
  blister: number;
  graining: number;
  pickup: number;
  dust: number;
  grass: number;
  dirt: number;
  /** flat spot: where round the tyre (atlas u, 0 … 1) and how bad (0 … 1) */
  flatU: number;
  flat: number;
}
export function newTyreLook(): TyreLook {
  return { wear: 0, heat: 0, blister: 0, graining: 0, pickup: 0, dust: 0, grass: 0, dirt: 0, flatU: 0, flat: 0 };
}
/** a used set as it comes off in the pits (generic: ~a stint's worth) */
export function wornTyreLook(w = 0.62): TyreLook {
  return { wear: w, heat: 0.15, blister: 0.1 * w, graining: 0.5 * w, pickup: Math.min(1, w * 1.3), dust: Math.min(1, w * 1.1), grass: 0.08, dirt: 0, flatU: 0.3, flat: 0 };
}

export interface TyreUniforms {
  uTyreA: { value: THREE.Vector4 };
  uTyreB: { value: THREE.Vector4 };
  uTyreC: { value: THREE.Vector4 };
}
export function tyreUniforms(): TyreUniforms {
  return { uTyreA: { value: new THREE.Vector4(0, 0, 0, 0) }, uTyreB: { value: new THREE.Vector4(0, 0, 0, 0) }, uTyreC: { value: new THREE.Vector4(0, 0, 0, 0) } };
}
export function applyTyreLook(u: TyreUniforms, s: TyreLook) {
  u.uTyreA.value.set(s.wear, s.heat, s.blister, s.graining);
  u.uTyreB.value.set(s.pickup, s.dust, s.grass, s.dirt);
  u.uTyreC.value.x = s.flatU;
  u.uTyreC.value.y = s.flat;
}

// ------------------------------------------------------------------------------------ detail texture
let detailTex: THREE.DataTexture | null = null;
/**
 * 1024 × 256, tileable, u = round the tyre (the tyre shows it twice), v = across.
 * R graining ridges (transverse, patchy) · G blob dome height · B blob id (coverage threshold) · A patch noise
 */
export function tyreDetailTexture(): THREE.DataTexture {
  if (detailTex) return detailTex;
  const W = 1024;
  const H = 256;
  const data = new Uint8Array(W * H * 4);
  let seed = 918273;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // periodic value noise
  const lat = (n: number) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return a;
  };
  const L1 = lat(64);
  const noise = (x: number, y: number, periodX: number, periodY: number, L: Float32Array, n: number) => {
    // x,y in cells; period in cells (≤ n)
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (i: number, j: number) => L[((((j % periodY) + periodY) % periodY) % n) * n + ((((i % periodX) + periodX) % periodX) % n)];
    const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * sx;
    const b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
  const fbm = (u: number, v: number, cx: number, cy: number) => {
    let s = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      const k = 1 << o;
      s += amp * noise(u * cx * k, v * cy * k, cx * k, cy * k, L1, 64);
      norm += amp;
      amp *= 0.5;
    }
    return s / norm;
  };
  const RIDGES = 210;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const o = (y * W + x) * 4;
      // graining: transverse ridges, wavy, in patches
      const warp = fbm(u, v, 8, 2) - 0.5;
      const ph = (u * RIDGES + warp * 3.2 + v * 1.4) % 1;
      const ridge = Math.pow(Math.abs(Math.sin(Math.PI * ph)), 3);
      const breakup = fbm(u, v, 16, 8);
      const r = ridge * (0.45 + 0.55 * breakup);
      data[o] = Math.round(Math.min(1, r) * 255);
      data[o + 1] = 0;
      data[o + 2] = 255;
      data[o + 3] = Math.round(Math.min(1, Math.max(0, (fbm(u, v, 4, 2) - 0.5) * 1.8 + 0.5)) * 255);
    }
  }
  // blobs (marbles / pick-up; the shader also reads them at half scale as blisters)
  const N = 2600;
  for (let k = 0; k < N; k++) {
    const cx = rnd() * W;
    const cy = rnd() * H;
    const r = 1.3 + Math.pow(rnd(), 2.2) * 3.6;
    const ry = r * (0.75 + rnd() * 0.45);
    const id = rnd();
    const R = Math.ceil(Math.max(r, ry)) + 1;
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const du = x / r;
        const dv = y / ry;
        const d2 = du * du + dv * dv;
        if (d2 >= 1) continue;
        const px = (((Math.floor(cx) + x) % W) + W) % W;
        const py = (((Math.floor(cy) + y) % H) + H) % H;
        const o = (py * W + px) * 4;
        const h = Math.round(Math.sqrt(1 - d2) * 255);
        if (h > data[o + 1]) {
          data[o + 1] = h;
          data[o + 2] = Math.round(id * 254);
        }
      }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 16;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

// ------------------------------------------------------------------------------------ glsl
const VERT_PARS = /* glsl */ `
uniform vec4 uTyreA;
`;
/** worn shoulders: the rounded shoulder rows square off toward the tread (normals and a couple of mm) */
const VERT_NORMAL = /* glsl */ `
float tyR = length( position.yz );
float tyK = 0.0;
if ( tyR > 0.343 && tyR < 0.3595 ) tyK = smoothstep( 0.05, 0.9, uTyreA.x ) * smoothstep( 0.343, 0.356, tyR );
objectNormal = normalize( mix( objectNormal, vec3( 0.0, position.yz / max( tyR, 1e-4 ) ), tyK * 0.6 ) );
`;
const VERT_POS = /* glsl */ `
transformed.yz *= 1.0 + tyK * 0.007;
`;

const FRAG_PARS = /* glsl */ `
uniform vec4 uTyreA;
uniform vec4 uTyreB;
uniform vec4 uTyreC;
uniform sampler2D tyreDetail;
vec3 tyrePerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
  vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN );
  vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDir;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
`;

/** after <map_fragment>: works out the region, samples the detail and sets colour; keeps values for later chunks */
const FRAG_MAP = /* glsl */ `
float tyV = vMapUv.y;
float tyTread = step( 0.3125, tyV ) * step( tyV, 0.5 );
float tySide = step( 0.5, tyV );
float tyRim = 1.0 - max( tyTread, tySide );
float tyU = vMapUv.x;
float tyT = clamp( ( tyV - 0.3145 ) / 0.1836, 0.0, 1.0 );   // across the tread
float tyS = clamp( ( tyV - 0.502 ) / 0.496, 0.0, 1.0 );     // sidewall: bead 0 … shoulder 1
float tyWear = uTyreA.x;
float tyWv = smoothstep( 0.0, 0.55, tyWear );              // visual wear (reads early)
float tySpin = uTyreC.z;
// detail uv: round the tyre × across (tread) / radial (sidewall, rim)
vec2 tyK = tyTread > 0.5 ? vec2( 2.0, 1.0 / 0.1836 ) : vec2( 2.0, 1.6 );
vec2 tyUV = vec2( tyU, tyTread > 0.5 ? tyT : tyS * 0.8 ) * vec2( 2.0, 1.0 );
if ( tyRim > 0.5 ) { tyK = vec2( 9.0 ); tyUV = vMapUv * 9.0; }
vec2 tyGx = dFdx( vMapUv ) * tyK;
vec2 tyGy = dFdy( vMapUv ) * tyK;
// spinning: stretch the footprint along the rolling direction (texture u)
float tyBl = tySpin * tySpin * ( tyRim > 0.5 ? 0.0 : 0.9 );
tyGx.x += tyBl;
tyGy.x += tyBl * 0.7;
vec4 tyD = textureGrad( tyreDetail, tyUV, tyGx, tyGy );
vec4 tyD2 = textureGrad( tyreDetail, tyUV * 0.5 + vec2( 0.37, 0.61 ), tyGx * 0.5, tyGy * 0.5 );
float tyH = 0.0;           // relief height for the bump
float tyRough = 0.0;       // roughness target shift
float tyGloss = 0.0;       // glaze (flat spot, hot rubber)
float tyDirtAll = 0.0;     // how much the rubber's sheen is hidden
vec3 tyC = diffuseColor.rgb;
float tyGroove = 1.0;
if ( tyTread > 0.5 ) {
  // grooves (inters / wets): their dark floors and relief fade as the tread wears down
  float grooveMask = uTyreC.w * ( 1.0 - smoothstep( 0.0025, 0.006, dot( tyC, vec3( 0.333 ) ) ) );
  tyGroove = 1.0 - uTyreC.w * 0.8 * smoothstep( 0.1, 0.95, tyWear );
  vec3 treadBase = vec3( 0.0085 );
  tyC = mix( tyC, treadBase, grooveMask * smoothstep( 0.2, 1.0, tyWear ) * 0.85 );
  // used rubber: lighter, browner, matte; patchy
  vec3 used = vec3( 0.075, 0.07, 0.064 ) * ( 0.65 + 0.7 * tyD.a );
  tyC = mix( tyC, used, tyWv * 0.92 );
  // graining: transverse ridges in patches
  float grain = uTyreA.w * smoothstep( 0.62, 0.3, tyD.a - uTyreA.w * 0.35 ) * ( 1.0 - tySpin );
  float ridge = tyD.r;
  tyC *= 1.0 + grain * ( ridge * 1.8 - 0.55 );
  tyH += grain * ridge * 1.4;
  tyRough += grain * 0.12;
  // worn shoulders: a lighter scrubbed band that widens with wear
  float edge = min( tyT, 1.0 - tyT );
  float wb = 0.03 + 0.16 * tyWv;
  float band = smoothstep( wb, wb * 0.35, edge ) * smoothstep( 0.05, 0.4, tyWear );
  tyC = mix( tyC, vec3( 0.12, 0.112, 0.1 ) * ( 0.8 + 0.4 * tyD.a ), band * 0.8 );
  tyRough += band * 0.1;
  // marbles / pick-up stuck on the shoulders
  float sh = smoothstep( 0.3, 0.04, edge );
  float pk = smoothstep( 0.05, 0.4, tyD2.g ) * step( tyD2.b, uTyreB.x * ( 0.05 + 0.95 * sh ) * 0.8 );
  pk = mix( pk, uTyreB.x * sh * 0.35, tySpin );
  tyC = mix( tyC, vec3( 0.007, 0.0065, 0.006 ), clamp( pk * 1.6, 0.0, 1.0 ) );
  tyH += pk * 2.4;
  tyRough += pk * 0.2;
  // blisters: craters in the hot centre of the tread
  float mid = smoothstep( 0.12, 0.3, edge );
  float bb = tyD2.g * step( 1.0 - tyD2.b, uTyreA.z * mid * 0.5 ) * ( 1.0 - tySpin );
  float crater = smoothstep( 0.55, 0.8, bb );
  float lip = smoothstep( 0.02, 0.25, bb ) * ( 1.0 - crater );
  tyC = mix( tyC, vec3( 0.09, 0.085, 0.078 ), lip * 0.85 );
  tyC = mix( tyC, vec3( 0.006 ), crater );
  tyH -= crater * 1.4 - lip * 0.4;
  // canvas: very worn, patches of the cord show through
  float cord = smoothstep( 0.82, 1.0, tyWear ) * smoothstep( 0.52, 0.72, tyD.a + ( 1.0 - edge ) * 0.1 );
  float cph = ( tyU * 2.0 * 180.0 + tyT * 40.0 );
  float cph2 = ( tyU * 2.0 * 180.0 - tyT * 40.0 );
  float fw = fwidth( cph ) + tySpin * 2.0;
  float hatch = max( smoothstep( 0.35, 0.0, abs( fract( cph ) - 0.5 ) ), smoothstep( 0.35, 0.0, abs( fract( cph2 ) - 0.5 ) ) );
  hatch = mix( hatch, 0.5, smoothstep( 0.25, 0.8, fw ) );
  tyC = mix( tyC, vec3( 0.16, 0.145, 0.12 ) * ( 0.75 + 0.35 * hatch ), cord * 0.85 );
  tyRough += cord * 0.15;
  // flat spot from a lock-up: a glazed, scrubbed oval across the tread
  float fdu = abs( fract( tyU - uTyreC.x + 0.5 ) - 0.5 );
  float fsp = uTyreC.y * smoothstep( 0.028, 0.012, fdu ) * smoothstep( 0.0, 0.12, edge ) * ( 1.0 - tySpin );
  tyC = mix( tyC, vec3( 0.07, 0.07, 0.075 ), fsp * 0.7 );
  tyGloss += fsp * 0.45;
  // dirt / grass picked up off the track
  float dd = uTyreB.w * smoothstep( 0.3, 0.7, tyD.a + tyD2.a * 0.3 );
  tyC = mix( tyC, vec3( 0.085, 0.075, 0.045 ), dd * 0.75 );
  tyRough += dd * 0.2;
  // hot rubber is darker and tackier
  tyC *= 1.0 - 0.22 * uTyreA.y;
  tyGloss += 0.22 * uTyreA.y;
  tyRough += 0.26 * tyWv;
  tyDirtAll = max( tyWv * 0.7, dd );
} else if ( tySide > 0.5 ) {
  // brake dust from the bead up, grimy rubber and pick-up at the shoulder, grass / dirt after offs
  float dust = uTyreB.y * ( 1.0 - smoothstep( 0.05, 0.6, tyS ) ) * ( 0.55 + 0.45 * tyD.a );
  float lum = dot( tyC, vec3( 0.333 ) );
  float bright = smoothstep( 0.03, 0.2, lum );      // compound band + lettering
  tyC = mix( tyC, vec3( 0.07, 0.058, 0.047 ), dust * ( 0.75 - 0.4 * bright ) );
  float grime = clamp( tyWear * 0.7 + uTyreB.x * 0.4, 0.0, 1.0 ) * smoothstep( 0.55, 1.0, tyS ) * ( 0.4 + 0.6 * tyD.a );
  tyC = mix( tyC, vec3( 0.022, 0.02, 0.018 ), grime * ( 0.6 - 0.3 * bright ) );
  float pk = tyD.g * step( tyD.b, uTyreB.x * smoothstep( 0.82, 1.0, tyS ) * 0.8 ) * ( 1.0 - tySpin );
  tyC = mix( tyC, vec3( 0.01 ), pk );
  tyH += pk * 1.2;
  float grass = uTyreB.z * smoothstep( 0.45, 0.75, tyD.a + tyD2.a * 0.25 + ( 1.0 - tyS ) * 0.1 );
  tyC = mix( tyC, vec3( 0.05, 0.062, 0.024 ), grass * 0.7 );
  // a used tyre's lettering loses its crispness
  tyC = mix( tyC, tyC * 0.8 + vec3( 0.01 ), bright * tyWv * 0.5 );
  tyRough += dust * 0.12 + grime * 0.1 + grass * 0.1;
  tyDirtAll = clamp( dust + grime * 0.6 + grass, 0.0, 1.0 );
} else {
  // wheel cover, rim lip, nut: brake dust settles in a brown-grey film
  float dust = uTyreB.y * ( 0.45 + 0.55 * tyD.a );
  tyC = mix( tyC, vec3( 0.06, 0.05, 0.041 ), dust * 0.55 );
  tyRough += dust * 0.22;
  tyDirtAll = dust;
}
diffuseColor.rgb = tyC;
`;

/** after <metalnessmap_fragment> (replaces the old wheel wet code) */
const FRAG_ROUGH = /* glsl */ `
float tWet = clamp( uWetness * 1.25 + uRain * 0.35, 0.0, 1.0 );
float rub = 1.0 - metalnessFactor;
// new rubber reads crisp and faintly glossy, used rubber goes matte
float tyNew = ( 1.0 - tyDirtAll ) * rub * ( 1.0 - tyRim );
roughnessFactor *= mix( 1.0, 0.74, tyNew );
roughnessFactor = clamp( roughnessFactor + tyRough * rub - tyGloss * roughnessFactor, 0.04, 1.0 );
metalnessFactor *= 1.0 - 0.6 * tyDirtAll * tyRim;
roughnessFactor = mix( roughnessFactor, roughnessFactor + 0.2, tyDirtAll * tyRim * ( 1.0 - rub ) );
diffuseColor.rgb *= mix( 1.0, 0.7, tWet * rub );
roughnessFactor = mix( roughnessFactor, min( roughnessFactor, 0.3 ), tWet * rub );
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.6, tWet * ( 1.0 - rub ) );
`;

/** replaces <normal_fragment_maps>: groove relief fades with wear; bump from the wear relief */
const FRAG_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale * tyGroove;
  normal = normalize( tbn * mapN );
#endif
{
  float hs = tyH * 0.0035;
  vec2 dH = vec2( dFdx( hs ), dFdy( hs ) );
  normal = tyrePerturb( - vViewPosition, normal, dH, faceDirection );
}
`;

const FRAG_LIGHTS = /* glsl */ `
#ifdef USE_SHEEN
  material.sheenColor *= ( 1.0 - tWet ) * ( 1.0 - 0.8 * tyDirtAll ) * ( 1.0 + 0.6 * tyNew );
#endif
`;

export function patchTyre(mat: THREE.MeshPhysicalMaterial, u: TyreUniforms) {
  mat.onBeforeCompile = (sh) => {
    wetUniforms(sh);
    sh.uniforms.uTyreA = u.uTyreA;
    sh.uniforms.uTyreB = u.uTyreB;
    sh.uniforms.uTyreC = u.uTyreC;
    sh.uniforms.tyreDetail = { value: tyreDetailTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + VERT_NORMAL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_POS);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WET_PARS + FRAG_PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_MAP)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + FRAG_LIGHTS);
  };
  mat.customProgramCacheKey = () => 'apex-tyre-v1';
}

/** a wheel material with its own condition uniforms */
export function createTyreMaterial(c: Compound, name: string): { mat: THREE.MeshPhysicalMaterial; u: TyreUniforms } {
  const w = wheelTextures(c);
  const u = tyreUniforms();
  const mat = new THREE.MeshPhysicalMaterial({
    name,
    map: w.map,
    roughnessMap: w.orm,
    metalnessMap: w.orm,
    normalMap: w.normal,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 1,
    metalness: 1,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0.35, 0.35, 0.35),
  });
  patchTyre(mat, u);
  setTyreCompound(mat, u, c);
  return { mat, u };
}
export function setTyreCompound(mat: THREE.MeshPhysicalMaterial, u: TyreUniforms, c: Compound) {
  const w = wheelTextures(c);
  mat.map = w.map;
  mat.roughnessMap = w.orm;
  mat.metalnessMap = w.orm;
  mat.normalMap = w.normal;
  u.uTyreC.value.w = c === 'inter' || c === 'wet' ? 1 : 0;
}
