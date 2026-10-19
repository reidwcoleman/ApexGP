import * as THREE from 'three';

/**
 * The course's materials, all procedural (no image files):
 *  - wood: boards of real grain — growth rings cut at a slant (the cathedral figure of flat-sawn
 *    stock), fine streaks along the grain, each board its own log and tint, butt joints staggered,
 *    the seams cut in as grooves; under a varnish clearcoat.
 *  - paint: glossy enamel over that wood, in stripes / rings / dots / checks / spirals, with brush
 *    streaks and chips worn through to the wood.
 *  - glass marbles: the inside ray-marched in the marble's own frame (so the swirl rolls with it):
 *    cat's-eye vanes, ribbons, galaxies, candy swirls, bubbles, a lava core; the light through the
 *    clear glass from the sky behind (or the warm wood underneath), refracted.
 * Every surface carries `aWood` (along, across, depth in metres): the grain follows a bent rail.
 */

export const NOISE = /* glsl */ `
float mh11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float mh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float mh13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float mvn(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mh13(i), mh13(i + vec3(1,0,0)), f.x), mix(mh13(i + vec3(0,1,0)), mh13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mh13(i + vec3(0,0,1)), mh13(i + vec3(1,0,1)), f.x), mix(mh13(i + vec3(0,1,1)), mh13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float mfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * mvn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
`;

export const WOOD = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uDark;
uniform float uPlankW;
uniform float uPlankL;
uniform float uRings;
uniform float uFig;
// w: (along the grain, across, depth) in metres. Returns the colour; rough and height out.
vec3 woodAt(vec3 w, float fw, out float rough, out float hgt){
  float pw = uPlankW;
  float pid = floor(w.y / pw);
  float lu = w.y - pid * pw;
  float L = uPlankL;
  float off = mh11(pid * 7.13 + 1.7) * L;
  float bid = floor((w.x + off) / L);
  float lx = w.x + off - bid * L;
  float seed = mh12(vec2(pid, bid) + 0.37);
  // the log this board was cut from: its heart off to one side, below the face, a little slanted
  vec2 c = vec2((seed - 0.5) * pw * 1.6, -0.12 - seed * 0.5);
  float tilt = (mh11(seed * 91.0) - 0.5) * 0.05 * uFig;
  vec2 q = vec2(lu - pw * 0.5 - c.x, w.z - c.y + lx * tilt);
  float n = mfbm(vec3(lx * 0.45, lu * 5.0, w.z * 5.0) + seed * 17.0);
  float r = length(q) * uRings + n * 1.3 * uFig + lx * 0.015;
  float ring = fract(r);
  // late wood: the dark band at the end of each year's growth
  float late = smoothstep(0.5, 0.92, ring) * (1.0 - smoothstep(0.92, 1.0, ring));
  float aaR = clamp(fw * uRings * 2.5, 0.0, 1.0);
  late = mix(late, 0.28, aaR);
  float streak = mvn(vec3(lx * 1.2, lu * 70.0, w.z * 70.0 + seed * 9.0));
  float aaS = clamp(fw * 60.0, 0.0, 1.0);
  streak = mix(streak, 0.5, aaS);
  float pore = smoothstep(0.72, 0.9, mvn(vec3(lx * 9.0, lu * 160.0, seed * 30.0)));
  pore = mix(pore, 0.1, clamp(fw * 140.0, 0.0, 1.0));
  vec3 col = mix(uLight, uDark, clamp(late * 0.8 + (streak - 0.5) * 0.35 + pore * 0.25, 0.0, 1.0));
  col *= 0.86 + 0.26 * seed;
  col = mix(col, col * vec3(1.06, 0.97, 0.9), mh11(seed * 3.3));
  // the seams: grooves between the boards and at their butt ends
  float sx = min(lu, pw - lu), sy = min(lx, L - lx);
  float sd = min(sx, sy * 2.0);
  float sw = 0.004 + fw * 0.9;
  float seam = 1.0 - smoothstep(0.0, sw, sd);
  if (pw > 50.0) seam = 0.0;
  col *= 1.0 - 0.62 * seam;
  hgt = -seam * 0.0025 - late * 0.00035 - pore * 0.0003 + streak * 0.00012;
  rough = 0.42 + 0.12 * late + 0.3 * seam + pore * 0.1;
  return col;
}
vec3 woodBump(vec3 surf_pos, vec3 surf_norm, float h, float faceDirection){
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1) * faceDirection;
  vec3 g = sign(det) * (dh.x * R1 + dh.y * R2);
  return normalize(abs(det) * surf_norm - g);
}
`;

export interface WoodSpecies {
  light: number;
  dark: number;
  /** board width / length (m); a solid piece: plankW 99 */
  plankW: number;
  plankL: number;
  rings: number;
  fig: number;
}
export const SPECIES = {
  maple: { light: 0xd9b07a, dark: 0xa8723f, plankW: 0.42, plankL: 3.2, rings: 26, fig: 1 },
  oak: { light: 0xc7965c, dark: 0x8a5a2b, plankW: 0.5, plankL: 3.8, rings: 18, fig: 1.2 },
  walnut: { light: 0x7a4f30, dark: 0x3e2414, plankW: 99, plankL: 99, rings: 20, fig: 1 },
  cherry: { light: 0xb8693f, dark: 0x7a3a1f, plankW: 99, plankL: 99, rings: 22, fig: 1 },
  pine: { light: 0xe6c48e, dark: 0xb88148, plankW: 99, plankL: 99, rings: 9, fig: 1.4 },
} satisfies Record<string, WoodSpecies>;

const lin = (hex: number) => new THREE.Color(hex);

function woodUniforms(s: WoodSpecies) {
  return {
    uLight: { value: lin(s.light) },
    uDark: { value: lin(s.dark) },
    uPlankW: { value: s.plankW },
    uPlankL: { value: s.plankL },
    uRings: { value: s.rings },
    uFig: { value: s.fig },
  };
}

const VERT_WOOD = (src: string) =>
  src
    .replace('#include <common>', '#include <common>\nattribute vec3 aWood;\nvarying vec3 vWood;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWood = aWood;');

export function woodMaterial(s: WoodSpecies, varnish = 0.7) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, clearcoat: varnish, clearcoatRoughness: 0.16, specularIntensity: 0.55 });
  const u = woodUniforms(s);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_WOOD(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWood;\n' + NOISE + WOOD)
      .replace(
        '#include <map_fragment>',
        `float wRough, wH;
        float wfw = length(fwidth(vWood));
        diffuseColor.rgb = woodAt(vWood, wfw, wRough, wH);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = woodBump(-vViewPosition, normal, wH, faceDirection);');
  };
  m.customProgramCacheKey = () => 'mm-wood-1';
  return m;
}

export const enum Pattern {
  Solid = 0,
  Stripes = 1,
  Rings = 2,
  Dots = 3,
  Checks = 4,
  Spiral = 5,
  Chevron = 6,
}

export interface PaintSpec {
  a: number;
  b: number;
  pattern: Pattern;
  /** pattern repeats per metre */
  scale?: number;
  /** share worn through to the wood */
  wear?: number;
}

/** enamel over wood; `flash` (0..1) lights it up (a bumper that was just hit) */
export function paintMaterial(p: PaintSpec, wood: WoodSpecies = SPECIES.pine) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, specularIntensity: 0.6 });
  const u = {
    ...woodUniforms(wood),
    uA: { value: lin(p.a) },
    uB: { value: lin(p.b) },
    uPat: { value: p.pattern as number },
    uScale: { value: p.scale ?? 1 },
    uWear: { value: p.wear ?? 0.06 },
    uFlash: { value: 0 },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_WOOD(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWood;\nuniform vec3 uA;\nuniform vec3 uB;\nuniform int uPat;\nuniform float uScale;\nuniform float uWear;\nuniform float uFlash;\n' + NOISE + WOOD,
      )
      .replace(
        '#include <map_fragment>',
        `float wRough, wH;
        float wfw = length(fwidth(vWood));
        vec3 wc = woodAt(vWood, wfw, wRough, wH);
        vec3 w = vWood * uScale;
        float fwp = wfw * uScale;
        float k = 0.0;
        if (uPat == 1) k = fract((w.x + w.y) * 0.5);
        else if (uPat == 2) k = fract(w.x * 0.5);
        else if (uPat == 3) { vec2 g = fract(w.xy) - 0.5; k = length(g) < 0.28 ? 0.25 : 0.75; }
        else if (uPat == 4) { vec2 g = floor(w.xy); k = mod(g.x + g.y, 2.0) * 0.5 + 0.25; }
        else if (uPat == 5) { float ang = atan(w.y, w.x) / 6.2831853; k = fract(length(w.xy) * 0.5 + ang * 2.0); }
        else if (uPat == 6) k = fract((w.x + abs(fract(w.y * 0.5) - 0.5) * 2.0) * 0.5);
        float band = uPat == 0 ? 0.0 : smoothstep(0.5 - fwp * 1.5, 0.5 + fwp * 1.5, k) - smoothstep(1.0 - fwp * 1.5, 1.0, k);
        if (uPat == 3 || uPat == 4) band = step(0.5, k);
        vec3 pc = mix(uA, uB, band);
        // brush streaks along the stroke, and chips through to the bare wood
        float brush = mvn(vec3(vWood.x * 2.0, vWood.y * 40.0, vWood.z * 40.0));
        pc *= 0.94 + 0.1 * brush;
        float chip = smoothstep(1.0 - uWear, 1.0 - uWear + 0.03, mfbm(vWood * 3.1 + 4.0));
        diffuseColor.rgb = mix(pc, wc, chip);
        float pRough = mix(0.28 + brush * 0.12, wRough + 0.15, chip);
        wH = mix(brush * 0.00015, wH - 0.0006, chip);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = woodBump(-vViewPosition, normal, wH, faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFlash * 2.5;');
  };
  m.customProgramCacheKey = () => 'mm-paint-1';
  return m;
}

/** marble designs: the inside's kind, its two colours, the glass tint */
export const enum Inside {
  Vanes = 0,
  Ribbons = 1,
  Galaxy = 2,
  Candy = 3,
  Bubbles = 4,
  Lava = 5,
  Rainbow = 6,
  Opal = 7,
}
export interface Design {
  name: string;
  kind: Inside;
  a: number;
  b: number;
  tint: number;
}
export const DESIGNS: Design[] = [
  { name: "Ruby Cat's Eye", kind: Inside.Vanes, a: 0xff2a3a, b: 0xffd23a, tint: 0xeaf6ff },
  { name: 'Deep Ocean', kind: Inside.Ribbons, a: 0x1f7bff, b: 0x22e0d0, tint: 0xd8f0ff },
  { name: 'Galaxy', kind: Inside.Galaxy, a: 0x8a3dff, b: 0xff4fb8, tint: 0x6a6f9a },
  { name: 'Candy Swirl', kind: Inside.Candy, a: 0xff5fa2, b: 0x4fc8ff, tint: 0xffffff },
  { name: 'Sunburst', kind: Inside.Vanes, a: 0xff8a00, b: 0xffe600, tint: 0xfff6e0 },
  { name: 'Mint Ribbon', kind: Inside.Ribbons, a: 0x18d47a, b: 0xffffff, tint: 0xe6fff2 },
  { name: 'Lava Core', kind: Inside.Lava, a: 0xff4a00, b: 0xffc400, tint: 0x40302a },
  { name: 'Bubble Aqua', kind: Inside.Bubbles, a: 0x7ff0ff, b: 0xffffff, tint: 0x9fe8f0 },
  { name: 'Rainbow Vane', kind: Inside.Rainbow, a: 0xff3355, b: 0x33aaff, tint: 0xf4f4ff },
  { name: 'Opal', kind: Inside.Opal, a: 0xffe9f6, b: 0x9fe9ff, tint: 0xffffff },
  { name: 'Emerald Eye', kind: Inside.Vanes, a: 0x10c060, b: 0x0a5a30, tint: 0xe0fff0 },
  { name: 'Grape Candy', kind: Inside.Candy, a: 0x8a46ff, b: 0xffd84a, tint: 0xffffff },
];

const MARBLE_FRAG = /* glsl */ `
uniform vec3 uCamObj;
uniform mat3 uRotW;
uniform int uKind;
uniform vec3 uCA;
uniform vec3 uCB;
uniform vec3 uTint;
uniform vec3 uGround;
uniform float uSeed;
varying vec3 vObj;
vec3 hue2(float h){ return clamp(abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// the inside at q (unit sphere): rgb, density
vec4 inside(vec3 q){
  float r = length(q);
  if (uKind == 0 || uKind == 6) {
    // cat's eye: four vanes through the middle, twisted along the axis, thinning to the glass
    float a = atan(q.z, q.x) + q.y * 1.4 + uSeed;
    float d = abs(sin(a * 2.0)) * length(q.xz);
    float v = smoothstep(0.075, 0.025, d) * (1.0 - smoothstep(0.55, 0.82, r));
    vec3 c = uKind == 6 ? hue2(floor((a / 3.14159 + 4.0) * 2.0) / 4.0 + uSeed * 0.1) : mix(uCA, uCB, step(0.0, sin(a)) * 0.6 + smoothstep(0.1, 0.0, d) * 0.4);
    return vec4(c, v * 0.9);
  }
  if (uKind == 1) {
    // ribbons: two wavy bands wound through the glass
    float s1 = sin(q.x * 3.2 + sin(q.y * 4.0 + uSeed) * 1.4 + q.z * 1.5);
    float s2 = sin(q.z * 3.0 + sin(q.x * 3.5 + uSeed * 2.0) * 1.6 - q.y * 1.2);
    float b1 = smoothstep(0.22, 0.08, abs(s1)) * (1.0 - smoothstep(0.7, 0.9, r));
    float b2 = smoothstep(0.18, 0.06, abs(s2)) * (1.0 - smoothstep(0.65, 0.88, r));
    vec3 c = b1 > b2 ? uCA : uCB;
    return vec4(c, max(b1, b2) * 0.85);
  }
  if (uKind == 2) {
    // a galaxy: a dark nebula and pin-point stars
    float n = mfbm(q * 3.0 + uSeed);
    vec3 neb = mix(uCA, uCB, smoothstep(0.35, 0.7, mfbm(q * 2.0 - uSeed)));
    vec3 g = floor(q * 14.0);
    float st = step(0.965, mh13(g + uSeed)) * smoothstep(0.35, 0.0, length(fract(q * 14.0) - 0.5));
    return vec4(neb * smoothstep(0.35, 0.75, n) * 1.4 + vec3(st * 6.0), clamp(smoothstep(0.4, 0.8, n) * 0.35 + st, 0.0, 1.0));
  }
  if (uKind == 3) {
    // candy: opaque white with painted swirls just under the glass
    float a = atan(q.z, q.x);
    float sw = fract(a / 6.2831853 * 3.0 + q.y * 0.9 + uSeed);
    vec3 c = sw < 0.25 ? uCA : (sw > 0.5 && sw < 0.68 ? uCB : vec3(0.95, 0.93, 0.9));
    return vec4(c, smoothstep(0.78, 0.84, r) * 0.0 + step(r, 0.86));
  }
  if (uKind == 4) {
    // bubbles caught in the glass
    vec3 g = floor(q * 6.0);
    vec3 f = fract(q * 6.0) - 0.5;
    vec3 o = vec3(mh13(g + uSeed), mh13(g + 3.1), mh13(g + 7.7)) - 0.5;
    float d = length(f - o * 0.5);
    float rr = 0.06 + 0.08 * mh13(g + 1.3);
    float bub = smoothstep(rr, rr - 0.02, d) - smoothstep(rr - 0.03, rr - 0.06, d);
    return vec4(vec3(1.0), bub * step(mh13(g + 9.0), 0.4) * 0.6);
  }
  if (uKind == 5) {
    // lava: a glowing core cracked with dark veins
    float n = mfbm(q * 4.0 + uSeed);
    float core = 1.0 - smoothstep(0.2, 0.62, r + (n - 0.5) * 0.3);
    vec3 c = mix(uCA, uCB, smoothstep(0.4, 0.75, n)) * (1.0 + 3.0 * core);
    return vec4(c, core * 0.95);
  }
  // opal: milky with a play of colour
  float n = mfbm(q * 3.5 + uSeed);
  vec3 c = mix(vec3(0.95), hue2(n * 2.0 + q.y), 0.35);
  return vec4(c, 0.55);
}
`;

/** a glass marble; set uniforms.uCamObj / uRotW each frame (see Marbles in game) */
export function marbleMaterial(d: Design, seed: number) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, ior: 1.5 });
  const u = {
    uCamObj: { value: new THREE.Vector3() },
    uRotW: { value: new THREE.Matrix3() },
    uKind: { value: d.kind as number },
    uCA: { value: lin(d.a) },
    uCB: { value: lin(d.b) },
    uTint: { value: lin(d.tint) },
    uGround: { value: lin(0xc89a62).multiplyScalar(0.7) },
    uSeed: { value: seed },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE + MARBLE_FRAG)
      .replace(
        '#include <map_fragment>',
        `vec3 ro = normalize(vObj);
        vec3 rd = normalize(vObj - uCamObj);
        vec3 rr = refract(rd, ro, 1.0 / 1.5);
        float tEx = max(-2.0 * dot(ro, rr), 0.0);
        vec4 acc = vec4(0.0);
        vec3 glow = vec3(0.0);
        for (int i = 0; i < 14; i++) {
          float t = (float(i) + 0.5) / 14.0 * tEx;
          vec4 c = inside(ro + rr * t);
          float a = 1.0 - pow(1.0 - clamp(c.a, 0.0, 0.999), tEx / 1.96);
          if (uKind == 3) a = c.a;
          if (uKind == 5) glow += (1.0 - acc.a) * a * c.rgb * 0.6;
          acc.rgb += (1.0 - acc.a) * a * c.rgb;
          acc.a += (1.0 - acc.a) * a;
          if (acc.a > 0.98) break;
        }
        vec3 ex = ro + rr * tEx;
        vec3 od = refract(rr, -normalize(ex), 1.5);
        if (dot(od, od) < 1e-4) od = reflect(rr, -normalize(ex));
        vec3 bw = normalize(uRotW * od);
        #ifdef USE_ENVMAP
          vec3 bg = textureCubeUV(envMap, envMapRotation * bw, 0.08).rgb;
        #else
          vec3 bg = vec3(0.7);
        #endif
        // what lies beneath a marble on the course is warm wood, not sky
        bg = mix(bg, uGround, smoothstep(0.05, -0.35, bw.y));
        // (light that has crossed the glass picks up its tint; more of it the thicker the path)
        vec3 through = bg * pow(uTint, vec3(0.6 + tEx * 0.4)) * (1.0 - acc.a);
        diffuseColor.rgb = acc.a > 0.001 ? acc.rgb / acc.a : vec3(0.0);
        diffuseColor.rgb *= acc.a;
        vec3 mbThrough = through * 0.92 + glow;`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mbThrough;');
  };
  m.customProgramCacheKey = () => 'mm-marble-1';
  return m;
}

/** fills `aWood` from the local positions: grain along `axis`, solid timber (no boards) */
export function woodAttr(g: THREE.BufferGeometry, axis: 'x' | 'y' | 'z' = 'x', seed = 0) {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  const o = seed * 13.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [u, v, w] = axis === 'x' ? [x, y, z] : axis === 'y' ? [y, x, z] : [z, x, y];
    a[i * 3] = u + o;
    a[i * 3 + 1] = v + o * 0.3;
    a[i * 3 + 2] = w;
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  return g;
}
