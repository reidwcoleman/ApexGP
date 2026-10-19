import * as THREE from 'three';

/**
 * The course's materials, all procedural (no image files):
 *  - wood: boards of real grain — growth rings cut at a slant (the cathedral arches of flat-sawn
 *    stock, the straight lines of rift-sawn), fibre streaks and pores along the grain, each board
 *    its own log and tint, butt joints staggered, the edges eased and the seams cut in; a fiddle-
 *    back shimmer that moves with the eye, and a sheen stretched across the fibres; under a
 *    varnish clearcoat. Every fine detail is filtered by its footprint, so it fades to its average
 *    with distance instead of crawling.
 *  - paint: thick glossy enamel over that wood, in stripes / rings / dots / checks / spirals /
 *    chevrons with crisp (filtered) edges, chipped through to the wood here and there, the chips
 *    with a raised paint edge.
 *  - glass marbles: the inside traced in the marble's own frame (so it rolls with it): twisted
 *    cat's-eye vanes and ribbons as real sheets found by root finding (crisp at any size), a core
 *    and shells hit exactly, galaxies, bubbles, a lava core, opal fire, mica flakes; lit by the
 *    sun coming through the glass. Behind it the sky (or the warm wood underneath) refracted, a
 *    touch of dispersion, the sun's focus glowing on the far side, Fresnel on top.
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
// a line half-w wide at distance d, over a footprint fw: crisp up close, fading (not fattening) far off
float aaLine(float d, float w, float fw){ fw = max(fw, 1e-6); return clamp((w + 0.5 * fw - d) / fw, 0.0, 1.0) * min(1.0, 4.0 * w / fw); }
`;

export const WOOD = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uDark;
uniform float uPlankW;
uniform float uPlankL;
uniform float uRings;
uniform float uFig;
uniform float uCurl;
// ∫ fract(x)^3: the ring profile's running sum, for an exact box filter
float ringI(float x){ float f = fract(x); return (floor(x) + f * f * f * f) * 0.25; }
// w: (along the grain, across, depth) in metres; fw: its screen footprint per axis.
// Returns the colour; roughness, height, the fiddleback figure and the seam height out.
vec3 woodAt(vec3 w, vec3 fw3, out float rough, out float hgt, out float curl, out float seamH){
  float fw = length(fw3);
  float pw = uPlankW;
  bool solid = pw > 50.0;
  float pid = solid ? 0.0 : floor(w.y / pw);
  float lu = solid ? w.y : w.y - pid * pw;
  float L = uPlankL;
  float off = mh11(pid * 7.13 + 1.7) * L;
  float bid = solid ? 0.0 : floor((w.x + off) / L);
  float lx = solid ? w.x : w.x + off - bid * L;
  float seed = mh12(vec2(pid, bid) + 0.37);
  float seed2 = mh11(seed * 51.7 + 3.1);
  // the log this board was cut from: flat-sawn (its heart just below the face: arches), or
  // rift-sawn (the heart far off to the side: near-straight lines)
  float rift = step(0.64, seed2);
  vec2 c = solid ? vec2(0.31 + seed * 0.4, -0.18 - seed * 0.3)
                 : vec2((seed - 0.5) * pw * mix(1.1, 4.0, rift), -mix(0.06 + seed * 0.22, 0.7 + seed, rift));
  float tilt = (mh11(seed * 91.0) - 0.5) * 0.06 * uFig;
  vec2 q = vec2(lu - (solid ? 0.0 : pw * 0.5) - c.x, w.z - c.y + lx * tilt);
  // the growth wanders: slow waves along the board, quicker across
  float n = mvn(vec3(lx * 0.32, lu * 2.6, w.z * 2.6) + seed * 17.0) + 0.45 * mvn(vec3(lx * 1.1, lu * 8.0, w.z * 8.0) + seed * 5.0);
  float r = length(q) * uRings + n * 1.15 * uFig + lx * 0.012;
  // late wood: each year darkening softly to a crisp edge — box-filtered over the pixel exactly
  float fr = fwidth(r);
  float h = max(fr * 0.6, 1e-3);
  float rf = r - floor(r);
  float late = h < 0.01 ? rf * rf * rf : (ringI(rf + h) - ringI(rf - h)) / (2.0 * h);
  // (each year its own weight: good years and lean ones)
  float yr = 0.5 + mh11(floor(r) * 1.37 + seed * 7.0);
  late *= mix(yr, 1.0, smoothstep(0.4, 1.0, fr));
  late = mix(late, 0.25, smoothstep(0.6, 1.4, fr));
  // fibre streaks and pores along the grain (each faded as it drops under a pixel)
  float sA = mvn(vec3(lx * 1.4, lu * 34.0, w.z * 34.0 + seed * 9.0));
  sA = mix(sA, 0.5, smoothstep(0.012, 0.05, fw));
  float sB = mvn(vec3(lx * 2.5, lu * 110.0, w.z * 110.0 + seed * 3.0));
  sB = mix(sB, 0.5, smoothstep(0.004, 0.014, fw));
  float pore = smoothstep(0.7, 0.88, mvn(vec3(lx * 9.0, lu * 200.0, w.z * 200.0 + seed * 30.0)));
  pore = mix(pore, 0.05, smoothstep(0.0015, 0.006, fw));
  vec3 col = mix(uLight, uDark, clamp(late * 0.58 + (sA - 0.5) * 0.3 + (sB - 0.5) * 0.1 + pore * 0.35, 0.0, 1.0));
  // each board its own tint: lighter or darker, warmer or cooler; a few with a darker heart streak
  col *= 0.8 + 0.36 * seed;
  col = mix(col, col * vec3(1.07, 0.97, 0.86), seed2);
  float heart = step(0.72, mh11(seed * 13.1 + 0.7)) * smoothstep(0.35, 0.7, mvn(vec3(lx * 0.3, lu * 3.5, seed * 11.0)));
  col = mix(col, col * vec3(0.8, 0.7, 0.6), heart * 0.6);
  col *= 0.95 + 0.1 * mvn(vec3(lx * 0.6, lu * 1.5, seed * 13.0));
  // fiddleback: fibres rippling in and out of the face (the shimmer is applied with the view)
  curl = sin(lx * 24.0 + n * 5.0 + seed * 20.0) * (1.0 - smoothstep(0.03, 0.09, fw));
  // the seams: fine dark joints between the boards and at their butt ends (filtered: they thin to
  // a hairline, never a band), a little stain gathered at the edges; eased edges up close
  float sx = min(lu, pw - lu), sy = min(lx, L - lx);
  float sd = min(sx, sy * 1.4);
  float seam = solid ? 0.0 : aaLine(sd, 0.0024, fw * 0.7);
  float stain = solid ? 0.0 : (1.0 - smoothstep(0.0, 0.025, sd)) * (1.0 - smoothstep(0.02, 0.06, fw));
  col *= (1.0 - 0.72 * seam) * (1.0 - 0.2 * stain);
  float ease = solid ? 0.0 : (1.0 - smoothstep(0.0, 0.006, sd));
  seamH = -ease * ease * 0.0005 * (1.0 - smoothstep(0.0008, 0.002, fw));
  hgt = seamH - late * 0.0001 * (1.0 - smoothstep(0.3, 0.8, fr)) - pore * 0.0002;
  rough = 0.46 + 0.1 * late + 0.25 * seam + pore * 0.12;
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
// the direction on the surface along which u grows (the grain), in view space
vec3 grainDir(vec3 surf_pos, vec3 surf_norm, float u){
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  vec3 g = dFdx(u) * R1 + dFdy(u) * R2;
  float l = length(g);
  return l > 1e-12 ? g / l : normalize(cross(surf_norm, vec3(0.0, 0.0, 1.0)) + 1e-4);
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
  /** fiddleback shimmer (0: none) */
  curl?: number;
}
export const SPECIES = {
  maple: { light: 0xe6b478, dark: 0x9c602c, plankW: 0.42, plankL: 3.2, rings: 44, fig: 1, curl: 1 },
  oak: { light: 0xd6a465, dark: 0x8f5b2a, plankW: 0.5, plankL: 3.8, rings: 22, fig: 1.2, curl: 0.4 },
  walnut: { light: 0x8a5833, dark: 0x3f2213, plankW: 99, plankL: 99, rings: 26, fig: 1, curl: 0.7 },
  cherry: { light: 0xc0703f, dark: 0x7a361b, plankW: 99, plankL: 99, rings: 30, fig: 1, curl: 0.6 },
  pine: { light: 0xf0cf98, dark: 0xc08a4c, plankW: 99, plankL: 99, rings: 14, fig: 1.4, curl: 0.2 },
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
    uCurl: { value: s.curl ?? 0.5 },
  };
}

const VERT_WOOD = (src: string) =>
  src
    .replace('#include <common>', '#include <common>\nattribute vec3 aWood;\nvarying vec3 vWood;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWood = aWood;');

// specular anti-aliasing: where the surface turns fast within a pixel, the highlight widens
// (no sparkles along silhouettes and tight bends)
const SPEC_AA = /* glsl */ `
{
  vec3 gdx = dFdx(nonPerturbedNormal), gdy = dFdy(nonPerturbedNormal);
  float gv = min(dot(gdx, gdx) + dot(gdy, gdy), 0.2);
  material.roughness = sqrt(material.roughness * material.roughness + gv);
  #ifdef USE_CLEARCOAT
    material.clearcoatRoughness = sqrt(material.clearcoatRoughness * material.clearcoatRoughness + gv);
  #endif
}`;

// the grain's frame for the sheen: rough across the fibres (the highlight stretches over them)
const GRAIN_FRAME = /* glsl */ `
vec3 wGT = grainDir(-vViewPosition, normal, vWood.x);
#ifdef USE_ANISOTROPY
  tbn[0] = normalize(cross(normal, wGT));
  tbn[1] = wGT;
#endif`;

export function woodMaterial(s: WoodSpecies, varnish = 0.7) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0,
    clearcoat: varnish,
    clearcoatRoughness: 0.12,
    specularIntensity: 0.5,
    anisotropy: 0.4,
  });
  const u = woodUniforms(s);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_WOOD(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWood;\n' + NOISE + WOOD)
      .replace(
        '#include <map_fragment>',
        `float wRough, wH, wCurl, wSeam;
        vec3 wfw = fwidth(vWood);
        diffuseColor.rgb = woodAt(vWood, wfw, wRough, wH, wCurl, wSeam);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        ${GRAIN_FRAME}
        // (the fiddleback flips light to dark as the eye moves along the grain)
        diffuseColor.rgb *= 1.0 + uCurl * 0.06 * wCurl * dot(normalize(vViewPosition), wGT);
        normal = woodBump(-vViewPosition, normal, wH, faceDirection);`,
      )
      // the varnish lies smooth over the pores but follows the boards' eased edges into the seams
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = woodBump(-vViewPosition, clearcoatNormal, wSeam, faceDirection);\n#endif')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + SPEC_AA);
  };
  m.customProgramCacheKey = () => 'mm-wood-2';
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

const PAINT_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform int uPat;
uniform float uScale;
uniform float uWear;
uniform float uFlash;
// a square wave of period 1 (B in its middle half) filtered over fw: ±1, fading to 0 far off
float aaSq(float v, float fw){
  float sd = 0.25 - abs(fract(v) - 0.5);
  return clamp(sd / max(fw, 1e-5) * 2.0, -1.0, 1.0) * (1.0 - smoothstep(0.3, 0.7, fw));
}
// the pattern's share of B at w (pattern units), filtered over its footprint
float paintPattern(vec3 w){
  if (uPat == 1) { float v = (w.x + w.y) * 0.5; return 0.5 + 0.5 * aaSq(v, fwidth(v)); }
  if (uPat == 2) { float v = w.x * 0.5; return 0.5 + 0.5 * aaSq(v, fwidth(v)); }
  if (uPat == 3) {
    vec2 g = fract(w.xy) - 0.5;
    float fwd = length(fwidth(w.xy));
    float dd = clamp((0.28 - length(g)) / max(fwd, 1e-5) + 0.5, 0.0, 1.0);
    return 1.0 - mix(dd, 0.246, smoothstep(0.25, 0.6, fwd));
  }
  if (uPat == 4) {
    float vx = w.x * 0.5, vy = w.y * 0.5;
    return 0.5 - 0.5 * aaSq(vx, fwidth(vx)) * aaSq(vy, fwidth(vy));
  }
  if (uPat == 5) {
    float rr = length(w.xy);
    float ang = atan(w.y, w.x) / 6.2831853;
    float v = rr * 0.5 + ang * 2.0;
    // (the angle jumps at its cut: its footprint taken from the turn instead)
    float fwv = fwidth(rr) * 0.5 + length(fwidth(w.xy)) / max(rr, 1e-3) * 0.32;
    return 0.5 + 0.5 * aaSq(v, fwv);
  }
  if (uPat == 6) { float v = (w.x + abs(fract(w.y * 0.5) - 0.5) * 2.0) * 0.5; return 0.5 + 0.5 * aaSq(v, length(fwidth(w.xy)) * 0.6); }
  return 0.0;
}
`;

/** enamel over wood; `flash` (0..1) lights it up (a bumper that was just hit) */
export function paintMaterial(p: PaintSpec, wood: WoodSpecies = SPECIES.pine) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.26,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    specularIntensity: 0.7,
    sheen: 0.25,
    sheenRoughness: 0.4,
    sheenColor: 0xffffff,
  });
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
    // (read from `u` now: the game may have swapped in a shared uFlash before the first compile)
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_WOOD(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWood;\n' + NOISE + WOOD + PAINT_FRAG)
      .replace(
        '#include <map_fragment>',
        `float wRough, wH, wCurl, wSeam;
        vec3 wfw = fwidth(vWood);
        float pfw = length(wfw);
        vec3 wc = woodAt(vWood, wfw, wRough, wH, wCurl, wSeam);
        float band = uPat == 0 ? 0.0 : paintPattern(vWood * uScale);
        vec3 pc = mix(uA, uB, band);
        // a faint trace of the brush along the stroke (gone at a distance: clean enamel)
        float brush = mvn(vec3(vWood.x * 2.0, vWood.y * 46.0, vWood.z * 46.0));
        brush = mix(brush, 0.5, smoothstep(0.006, 0.02, pfw));
        pc *= 0.97 + 0.06 * brush;
        // chips through to the wood, with a crisp edge and a pale rim of crushed paint round them
        float cn = mfbm(vWood * 3.1 + 4.0);
        float cfw = max(fwidth(cn), 1e-5);
        float cd = cn - (1.0 - uWear);
        float chip = uWear <= 0.0 ? 0.0 : clamp(cd / cfw + 0.5, 0.0, 1.0);
        float rim = uWear <= 0.0 ? 0.0 : (1.0 - smoothstep(0.0, 0.012, abs(cd + 0.008))) * (1.0 - chip) * (1.0 - smoothstep(0.004, 0.015, pfw));
        pc = mix(pc, mix(pc, vec3(0.92, 0.9, 0.86), 0.55), rim);
        diffuseColor.rgb = mix(pc, wc * 0.85, chip);
        float pRough = mix(0.2 + brush * 0.06, wRough + 0.15, chip);
        // the paint stands proud of the wood: a step at every chip
        float pH = 0.0005 * (1.0 - chip) + rim * 0.0002;
        wH = mix(brush * 0.00004, wH, chip) + pH * (1.0 - smoothstep(0.004, 0.015, pfw));`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = woodBump(-vViewPosition, normal, wH, faceDirection);')
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nclearcoatNormal = woodBump(-vViewPosition, clearcoatNormal, wH * (1.0 - chip) * 0.6, faceDirection);\n#endif')
      // the clearcoat shrugs off the bare wood of a chip
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - 0.8 * chip;\n#endif\n' + SPEC_AA)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFlash * 2.5;');
  };
  m.customProgramCacheKey = () => 'mm-paint-2';
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
  Swirl = 8,
  Mica = 9,
  Pearl = 10,
}
export interface Design {
  name: string;
  kind: Inside;
  a: number;
  b: number;
  tint: number;
  /** frosted (sea-glass) glass: 0 clear .. 1 */
  frost?: number;
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
  // (new ones at the end: the menu cycles by index)
  { name: 'Aurora Swirl', kind: Inside.Swirl, a: 0x2bffb8, b: 0xb04bff, tint: 0xeef4ff },
  { name: 'Stardust', kind: Inside.Mica, a: 0xffc95a, b: 0x2a3a8a, tint: 0x8e9cd8 },
  { name: 'Pearl', kind: Inside.Pearl, a: 0xfff3ea, b: 0xbfe6ff, tint: 0xffffff },
  { name: 'Sea Glass', kind: Inside.Vanes, a: 0xf4fbff, b: 0x7fd8c8, tint: 0x9fe0cc, frost: 1 },
  { name: 'Tiger Eye', kind: Inside.Swirl, a: 0xffa21f, b: 0x3a1a08, tint: 0xffe2b8 },
  { name: 'Cobalt Eye', kind: Inside.Vanes, a: 0x2a5cff, b: 0xffffff, tint: 0xe4ecff },
];

/**
 * What a design's glass does to the sun on the way through: the colour of the light it focuses
 * (mostly the glass's tint), the colour of the light it scatters across its shadow (the inside's
 * colours, more of them), how much gets through at all, and how sharply it focuses.
 */
export function designLight(d: Design) {
  const tint = lin(d.tint);
  const g = new THREE.Color(Math.pow(tint.r, 0.7), Math.pow(tint.g, 0.7), Math.pow(tint.b, 0.7));
  const inner = lin(d.a).lerp(lin(d.b), 0.35);
  // (how much of the inside stands in the light's way)
  const cover = [0.25, 0.3, 0.45, 0.92, 0.08, 0.6, 0.3, 0.6, 0.35, 0.2, 1][d.kind] ?? 0.3;
  const focus = g.clone().lerp(g.clone().multiply(inner), Math.min(1, cover * 0.8));
  const scatter = g.clone().lerp(g.clone().multiply(inner), Math.min(1, 0.35 + cover));
  const through = (1 - cover) * (d.frost ? 0.6 : 1);
  return { focus, scatter, through, sharp: d.frost ? 0.2 : 1 };
}

const MARBLE_FRAG = /* glsl */ `
uniform vec3 uCamObj;
uniform mat3 uRotW;
uniform int uKind;
uniform vec3 uCA;
uniform vec3 uCB;
uniform vec3 uTint;
uniform vec3 uGround;
uniform float uSeed;
uniform float uFrost;
varying vec3 vObj;
vec3 hue2(float h){ return clamp(abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void over(inout vec4 acc, vec3 c, float a){ a = clamp(a, 0.0, 1.0); acc.rgb += (1.0 - acc.a) * a * c; acc.a += (1.0 - acc.a) * a; }
// a glossy sheet in the glass, lit by the sun through the glass from either side, with its glint
vec3 sheetLit(vec3 c, vec3 n, vec3 rd, vec3 sunO, vec3 sunC){
  float d = abs(dot(n, sunO));
  vec3 h = normalize(sunO - rd);
  float sp = pow(abs(dot(n, h)), 48.0);
  return c * (0.34 + 0.72 * d) + sunC * sp * 0.08;
}
// an opaque body in the glass (the candy core, the lava crust)
vec3 bodyLit(vec3 c, vec3 n, vec3 rd, vec3 sunO, vec3 sunC, float shine){
  float d = max(dot(n, sunO), 0.0);
  vec3 h = normalize(sunO - rd);
  return c * (0.3 + 0.85 * d + 0.12 * max(-n.y, 0.0)) + sunC * pow(max(dot(n, h), 0.0), 40.0) * shine;
}
// the near (t0) and far (t1) crossings of a sphere of radius s round the centre (none: t1 < 0)
vec2 ballHit(vec3 ro, vec3 rd, float s){
  float b = dot(ro, rd), c = dot(ro, ro) - s * s;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// vane sheets: blade n lies where k·(φ + twist)/π = n, φ the angle round the axis — taken here
// unwrapped from the ray's entry (a line's turn about the axis is under half a turn), so it is smooth
float vaneG(vec3 q, vec2 p0, float a0, float k, float tw){
  float psi = atan(p0.x * q.z - p0.y * q.x, dot(p0, q.xz));
  return k * (a0 + psi + q.y * tw + uSeed) / 3.14159265;
}

// the inside along the refracted ray (from ro, unit sphere, for tEx): lit colour (premultiplied), cover
vec4 inside(vec3 ro, vec3 rd, float tEx, vec3 sunO, vec3 sunC, out vec3 glow){
  vec4 acc = vec4(0.0);
  glow = vec3(0.0);
  if (uKind == 0 || uKind == 6 || uKind == 1) {
    // cat's eye / rainbow vanes: leaf-shaped blades through the middle, twisted; a ribbon: one
    // broad blade, striped. Each blade is found where the ray crosses it (crisp at any size).
    bool rib = uKind == 1;
    float k = uKind == 6 ? 3.0 : rib ? 1.0 : 2.0;
    float tw = rib ? 1.9 : 1.05;
    vec2 p0 = ro.xz;
    float a0 = atan(ro.z, ro.x);
    float tA = 0.0, gA = vaneG(ro, p0, a0, k, tw);
    for (int i = 1; i <= 12; i++) {
      float tB = tEx * float(i) / 12.0;
      float gB = vaneG(ro + rd * tB, p0, a0, k, tw);
      float n0 = ceil(min(gA, gB)), n1 = floor(max(gA, gB));
      // (near the axis several blades pass in one step: taken in the order the ray meets them)
      for (int j = 0; j < 4; j++) {
        if (n0 + float(j) > n1) break;
        float n = gB > gA ? n0 + float(j) : n1 - float(j);
        // (bracketed: a few rounds of false position, kept inside the bracket)
        float lo = tA, hi = tB, glo = gA - n, ghi = gB - n;
        float th = lo;
        for (int r = 0; r < 4; r++) {
          th = clamp(lo + (hi - lo) * glo / (glo - ghi), lo, hi);
          float gm = vaneG(ro + rd * th, p0, a0, k, tw) - n;
          if (gm * glo > 0.0) { lo = th; glo = gm; } else { hi = th; ghi = gm; }
        }
        vec3 h = ro + rd * th;
        float rxz = length(h.xz);
        // (petals: round-bellied, pointed at the poles)
        float R = rib ? 0.6 * sqrt(max(1.0 - h.y * h.y / 0.62, 0.0)) : 0.64 * max(1.0 - h.y * h.y / 0.46, 0.0);
        float m = smoothstep(R, R - 0.04, rxz);
        if (m <= 0.0) continue;
        float id = mod(n, 2.0 * k);
        float u = rxz / max(R, 1e-3);
        vec3 c;
        if (rib) {
          // the ribbon: A down its middle, a pale thread, B at its edges
          c = mix(uCA, vec3(0.97), smoothstep(0.5, 0.55, u) * (1.0 - smoothstep(0.63, 0.68, u)));
          c = mix(c, uCB, smoothstep(0.66, 0.71, u));
        } else if (uKind == 6) {
          c = mix(hue2(id / 6.0 + uSeed * 0.07), vec3(1.0), 0.12);
        } else {
          c = mod(id, 2.0) < 0.5 ? uCA : uCB;
        }
        // (the blades are glassier at the heart, the colour thickest toward their edges)
        c *= 0.8 + 0.35 * smoothstep(0.15, 0.9, u);
        vec3 nn = normalize(vec3(-h.z / max(rxz, 1e-4), tw * rxz, h.x / max(rxz, 1e-4)));
        float ob = abs(dot(rd, nn));
        float a = 1.0 - pow(1.0 - (rib ? 0.85 : 0.66) * m, 1.0 / max(ob, 0.22));
        over(acc, sheetLit(c, nn, rd, sunO, sunC), a);
      }
      if (acc.a > 0.97) break;
      tA = tB;
      gA = gB;
    }
    if (rib) {
      // and a lattice of fine threads in a shell just under the glass, near side over, far side under
      vec2 sh = ballHit(ro, rd, 0.84);
      for (int j = 0; j < 2; j++) {
        float t = j == 0 ? sh.x : sh.y;
        if (t <= 0.0 || t > tEx) continue;
        vec3 h = ro + rd * t;
        float ph = atan(h.z, h.x) * 7.0 / 6.2831853 - h.y * 1.6 + uSeed;
        float th = 1.0 - smoothstep(0.035, 0.075, abs(fract(ph) - 0.5));
        th *= 1.0 - smoothstep(0.7, 0.82, abs(h.y));
        vec4 lay = vec4(sheetLit(mix(uCB, vec3(1.0), 0.6), normalize(h), rd, sunO, sunC), th * 0.85);
        if (j == 0) { vec4 a2 = acc; acc = vec4(0.0); over(acc, lay.rgb, lay.a); over(acc, a2.rgb / max(a2.a, 1e-4), a2.a); }
        else over(acc, lay.rgb, lay.a);
      }
    }
    return acc;
  }
  if (uKind == 3) {
    // candy: an opaque cream core, swirls of colour painted on it, under a skin of clear glass
    vec2 sh = ballHit(ro, rd, 0.82);
    if (sh.x > 0.0) {
      vec3 h = ro + rd * sh.x;
      vec3 n = normalize(h);
      float a = atan(n.z, n.x) / 6.2831853;
      float sw = fract(a * 3.0 + n.y * 0.95 + uSeed);
      float sw2 = fract(atan(-n.z, -n.x) / 6.2831853 * 3.0 + 1.5 + n.y * 0.95 + uSeed);
      // (two cuts of the angle: whichever has no seam here gives the footprint)
      float fw = min(fwidth(sw), fwidth(sw2)) + 1e-4;
      float A = smoothstep(-fw, fw, sw) * (1.0 - smoothstep(0.24 - fw, 0.24 + fw, sw));
      float B = smoothstep(0.5 - fw, 0.5 + fw, sw) * (1.0 - smoothstep(0.66 - fw, 0.66 + fw, sw));
      vec3 c = vec3(0.96, 0.94, 0.9);
      c = mix(c, uCA, A);
      c = mix(c, uCB, B);
      over(acc, bodyLit(c, n, rd, sunO, sunC, 0.0), 1.0);
    }
    return acc;
  }
  if (uKind == 5) {
    // lava: a core of dark crust cracked over a glow, a halo of heat round it
    vec2 sh = ballHit(ro, rd, 0.5);
    float dm = length(ro - rd * dot(ro, rd));
    glow += mix(uCA, uCB, 0.3) * exp(-max(dm - 0.5, 0.0) * 7.0) * 0.55;
    if (sh.x > 0.0) {
      vec3 h = ro + rd * sh.x;
      vec3 n = normalize(h);
      float c1 = mvn(n * 3.4 + uSeed);
      float c2 = mvn(n * 7.5 + uSeed * 2.0);
      float crack = 1.0 - smoothstep(0.0, 0.07, abs(c1 - 0.5) + c2 * 0.035);
      crack = max(crack, (1.0 - smoothstep(0.0, 0.05, abs(c2 - 0.5))) * 0.6);
      vec3 crust = mix(vec3(0.05, 0.025, 0.02), uCA * 0.18, c2);
      vec3 hot = mix(uCA, uCB, smoothstep(0.4, 1.0, crack)) * (3.0 + 3.0 * crack);
      over(acc, bodyLit(crust, n, rd, sunO, sunC, 0.25) + hot * crack, 1.0);
    }
    return acc;
  }
  if (uKind == 8) {
    // a swirl: streaks of colour wound round two shells, the inner turned the other way
    vec2 s1 = ballHit(ro, rd, 0.8), s2 = ballHit(ro, rd, 0.52);
    float ts[4];
    ts[0] = s1.x; ts[1] = s2.x; ts[2] = s2.y; ts[3] = s1.y;
    for (int j = 0; j < 4; j++) {
      float t = ts[j];
      if (t <= 0.0 || t > tEx) continue;
      bool inner = j == 1 || j == 2;
      vec3 h = ro + rd * t;
      vec3 n = normalize(h);
      float ph = atan(n.z, n.x) / 6.2831853 * (inner ? 3.0 : 2.0) + n.y * (inner ? -1.3 : 1.1) + uSeed * 0.3;
      float wob = mvn(n * 3.0 + uSeed) * 0.35;
      float v = fract(ph + wob);
      float st = smoothstep(0.0, 0.05, v) * (1.0 - smoothstep(0.32, 0.4, v));
      vec3 c = inner ? uCB : mix(uCA, mix(uCA, uCB, 0.5), smoothstep(0.1, 0.3, v));
      float al = st * (inner ? 0.95 : 0.7) * (1.0 - smoothstep(0.82, 0.97, abs(n.y)) * 0.6);
      over(acc, sheetLit(c * 1.05, n, rd, sunO, sunC), al);
    }
    return acc;
  }
  if (uKind == 4) {
    // bubbles caught in the glass: bright rims, clear hearts; and a fizz of tiny ones
    vec3 last = vec3(-99.0);
    for (int i = 0; i < 14; i++) {
      float t = tEx * (float(i) + 0.5) / 14.0;
      vec3 q = ro + rd * t;
      vec3 g = floor(q * 4.5);
      if (g == last) continue;
      last = g;
      if (mh13(g + 9.0) > 0.4) continue;
      vec3 o = (g + 0.5 + (vec3(mh13(g + uSeed), mh13(g + 3.1), mh13(g + 7.7)) - 0.5) * 0.5) / 4.5;
      float rb = 0.025 + 0.07 * pow(mh13(g + 1.3), 2.0);
      if (length(o) > 0.86 - rb) continue;
      float tc = dot(o - ro, rd);
      float d = length(ro + rd * tc - o);
      if (d > rb || tc < 0.0 || tc > tEx) continue;
      float x = d / rb;
      float rim = smoothstep(0.55, 0.95, x) * (1.0 - smoothstep(0.95, 1.0, x));
      vec3 bn = normalize(ro + rd * tc - o + rd * (-sqrt(max(rb * rb - d * d, 0.0))));
      float spec = pow(max(dot(reflect(rd, bn), sunO), 0.0), 60.0);
      over(acc, vec3(0.9, 0.97, 1.0) * (0.6 + 0.6 * rim) + sunC * spec * 0.25, rim * 0.75 + spec * 0.4);
    }
    return acc;
  }
  if (uKind == 9) {
    // mica: flakes that catch the sun, in a smoky blue haze
    vec3 last = vec3(-99.0);
    for (int i = 0; i < 16; i++) {
      float t = tEx * (float(i) + 0.5) / 16.0;
      vec3 q = ro + rd * t;
      vec3 g = floor(q * 7.0);
      if (g == last) continue;
      last = g;
      if (mh13(g + 11.0 + uSeed) > 0.55) continue;
      vec3 o = (g + 0.5 + (vec3(mh13(g + uSeed), mh13(g + 3.1), mh13(g + 7.7)) - 0.5) * 0.6) / 7.0;
      if (length(o) > 0.86) continue;
      vec3 fn = normalize(vec3(mh13(g + 2.2), mh13(g + 5.5), mh13(g + 8.8)) - 0.5);
      float dn = dot(rd, fn);
      if (abs(dn) < 0.05) continue;
      float tf = dot(o - ro, fn) / dn;
      if (tf < 0.0 || tf > tEx) continue;
      vec3 p = ro + rd * tf - o;
      float fr = 0.022 + 0.026 * mh13(g + 4.4);
      float m = smoothstep(fr, fr * 0.7, length(p));
      if (m <= 0.0) continue;
      float gl = pow(max(dot(reflect(rd, fn), sunO), 0.0), 24.0);
      over(acc, uCA * (0.35 + 0.4 * abs(dot(fn, sunO))) + sunC * uCA * gl * 1.4, m * (0.55 + gl * 0.45));
    }
    over(acc, uCB * 0.5, 0.12 * tEx);
    return acc;
  }
  if (uKind == 2) {
    // a galaxy: a spiral of glowing dust in a disc, a bright heart, and pin-point stars
    for (int i = 0; i < 10; i++) {
      float t = tEx * (float(i) + 0.5) / 10.0;
      vec3 q = ro + rd * t;
      float rxz = length(q.xz);
      float ang = atan(q.z, q.x);
      float arm = 0.5 + 0.5 * cos(2.0 * (ang - log(rxz + 0.06) * 2.2 + uSeed));
      float n = mvn(q * 4.0 + uSeed) * 0.6 + mvn(q * 9.0 - uSeed) * 0.4;
      float disc = exp(-q.y * q.y / 0.03) * (1.0 - smoothstep(0.45, 0.85, rxz));
      float dens = disc * smoothstep(0.35, 0.9, arm * 0.7 + n * 0.6);
      vec3 c = mix(uCA, uCB, smoothstep(0.3, 0.7, n)) * (0.8 + 1.4 * dens);
      float core = exp(-dot(q, q) / 0.012);
      c += vec3(1.0, 0.9, 0.95) * core * 3.0;
      float a = 1.0 - exp(-(dens * 0.9 + core * 2.0) * tEx / 10.0 * 3.0);
      glow += (1.0 - acc.a) * c * a * 0.25;
      over(acc, c, a);
    }
    // stars: two depths of points, each cell's star a little disc sized not to flicker
    for (int j = 0; j < 2; j++) {
      vec3 p = normalize(ro + rd * tEx * (j == 0 ? 0.3 : 0.7)) * (j == 0 ? 16.0 : 24.0);
      vec3 g = floor(p);
      float hs = mh13(g + uSeed + float(j) * 17.0);
      if (hs < 0.88) continue;
      vec3 o = g + 0.5 + (vec3(mh13(g + 1.7), mh13(g + 4.1), mh13(g + 6.3)) - 0.5) * 0.6;
      float d = length(p - o);
      float s = smoothstep(0.16, 0.0, d);
      vec3 sc = mix(vec3(1.0), hue2(hs * 7.0), 0.25) * 4.0;
      glow += (1.0 - acc.a * 0.6) * sc * s;
    }
    return acc;
  }
  if (uKind == 10) {
    // a pearl: solid all through (the lustre is the material's own thin film)
    over(acc, vec3(0.0), 1.0);
    return acc;
  }
  // opal: milky glass with flecks of fire that change colour as it turns
  for (int i = 0; i < 6; i++) {
    float t = tEx * (float(i) + 0.5) / 6.0;
    vec3 q = ro + rd * t;
    float n = mvn(q * 5.0 + uSeed);
    float cell = mvn(q * 9.0 - uSeed * 2.0);
    float fire = smoothstep(0.55, 0.78, cell) * smoothstep(0.85, 0.5, length(q));
    vec3 fc = hue2(n * 1.6 + dot(rd, normalize(q + 0.01)) * 0.9 + cell);
    vec3 milk = mix(uCA, uCB, smoothstep(0.3, 0.75, n));
    vec3 c = mix(milk * 0.95, fc * 1.25, fire * 0.85);
    glow += (1.0 - acc.a) * fc * fire * 0.05;
    over(acc, c * (0.55 + 0.45 * max(dot(normalize(q + 0.01), sunO), 0.0)), 0.2 + fire * 0.25);
  }
  return acc;
}
`;

/** a glass marble; set uniforms.uCamObj / uRotW each frame (see Marbles in game) */
export function marbleMaterial(d: Design, seed: number) {
  const pearl = d.kind === Inside.Pearl;
  const frost = d.frost ?? 0;
  const m = new THREE.MeshPhysicalMaterial({
    color: pearl ? d.a : 0xffffff,
    roughness: pearl ? 0.3 : 0.05 + frost * 0.35,
    metalness: 0,
    clearcoat: pearl ? 1 : 1 - frost * 0.6,
    clearcoatRoughness: pearl ? 0.04 : 0.02 + frost * 0.2,
    specularIntensity: pearl ? 0.6 : 0.75,
    ior: 1.5,
    iridescence: pearl ? 0.7 : 0,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 520],
  });
  const u = {
    uCamObj: { value: new THREE.Vector3() },
    uRotW: { value: new THREE.Matrix3() },
    uKind: { value: d.kind as number },
    uCA: { value: lin(d.a) },
    uCB: { value: lin(d.b) },
    uTint: { value: lin(d.tint) },
    uGround: { value: lin(0xd9a86c).multiplyScalar(0.62) },
    uSeed: { value: seed },
    uFrost: { value: frost },
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
        // the sun, in the marble's frame (for the inside's light) and in the world
        vec3 sunW = vec3(0.0, 1.0, 0.0), sunC = vec3(2.5);
        #if NUM_DIR_LIGHTS > 0
          sunW = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
          sunC = directionalLights[0].color;
        #endif
        vec3 sunO = normalize(transpose(uRotW) * sunW);
        float cosI = clamp(-dot(rd, ro), 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cosI, 5.0);
        vec3 rr = refract(rd, ro, 1.0 / 1.5);
        float tEx = max(-2.0 * dot(ro, rr), 0.0);
        vec3 glow;
        vec4 acc = inside(ro, rr, tEx, sunO, sunC, glow);
        // out the far side, bent again (fanned a little by colour), to whatever lies behind
        vec3 ex = ro + rr * tEx;
        vec3 od = refract(rr, -ex, 1.5);
        if (dot(od, od) < 1e-4) od = reflect(rr, -ex);
        vec3 bw = normalize(uRotW * od);
        vec3 dv = bw - normalize(uRotW * rd);
        vec3 bwR = normalize(bw - dv * 0.035), bwB = normalize(bw + dv * 0.045);
        float bl = 0.06 + uFrost * 0.5;
        #ifdef USE_ENVMAP
          vec3 bg = vec3(textureCubeUV(envMap, envMapRotation * bwR, bl).r, textureCubeUV(envMap, envMapRotation * bw, bl).g, textureCubeUV(envMap, envMapRotation * bwB, bl).b);
        #else
          vec3 bg = vec3(0.7);
        #endif
        // what lies beneath a marble on the course is warm wood, not sky: in its own soft shadow,
        // but for the sun it gathers to a bright point straight down the light (the caustic)
        float gnd = smoothstep(0.05, -0.3, bw.y);
        float focus = max(dot(bw, -sunW), 0.0);
        vec3 under = uGround * (0.7 + 0.3 * smoothstep(0.75, 0.3, focus)) + sunC * uTint * pow(focus, 30.0) * 0.5 * (1.0 - uFrost * 0.7);
        bg = mix(bg, under, gnd);
        // (light that has crossed the glass picks up its tint; more of it the thicker the path)
        vec3 through = bg * pow(uTint, vec3(0.6 + tEx * 0.4)) * (1.0 - acc.a) * (1.0 - fres);
        // toward the rim the glass bends the view round to darker, nearer things: a soft dark edge
        through *= mix(0.6, 1.0, smoothstep(0.0, 0.45, cosI));
        // and some of the light meets the far side and turns back in (bright where it grazes): the
        // thin bright arc inside the rim
        float cosE = clamp(dot(rr, ex), 0.0, 1.0);
        float fIn = 0.04 + 0.96 * pow(1.0 - cosE, 5.0);
        #ifdef USE_ENVMAP
          vec3 inRef = textureCubeUV(envMap, envMapRotation * normalize(uRotW * reflect(rr, -ex)), 0.12).rgb;
        #else
          vec3 inRef = vec3(0.7);
        #endif
        through += inRef * uTint * fIn * 0.35 * (1.0 - acc.a) * (1.0 - fres);
        // the sun's own light, bent through the glass, glowing where it leaves the far side
        float hot = pow(max(dot(normalize(ex), -sunO), 0.0), 6.0);
        vec3 bloomIn = sunC * uTint * hot * 0.05 * (1.0 - acc.a * 0.6);
        ${pearl ? `// nacre: a soft glow off the layers, and the orient (pink to green) sliding as it turns
        float orient = mvn(ro * 2.5 + uSeed) * 1.2 + cosI * 1.6;
        vec3 nacre = mix(vec3(1.0, 0.8, 0.88), vec3(0.8, 0.95, 1.0), 0.5 + 0.5 * sin(orient * 5.0));
        diffuseColor.rgb = mix(uCA * 0.72, uCB * 0.45, smoothstep(0.6, 0.05, cosI)) * mix(vec3(1.0), nacre, 0.35);
        glow += nacre * uCA * 0.1 * pow(cosI, 2.0);` : 'diffuseColor.rgb = vec3(0.0);'}
        vec3 mbThrough = through + acc.rgb * (1.0 - fres * 0.6) + glow + bloomIn;`,
      )
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + SPEC_AA)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mbThrough;');
  };
  m.customProgramCacheKey = () => 'mm-marble-2' + (pearl ? 'p' : '');
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
