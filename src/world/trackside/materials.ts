import * as THREE from 'three';
import { ASPHALT_ALB_MAX, ASPHALT_TILE, GRASS_TILE, GRAVEL_TILE, type GroundTextures } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';
import type { RunoffPaint } from '../CircuitGen.ts';

/**
 * Trackside materials. All are MeshStandardMaterial with onBeforeCompile
 * patches, so lighting, shadows, fog and the env map behave like every other
 * PBR surface in the game. Every one of them reacts to the shared weather
 * uniforms (weatherUniforms.ts): wet surfaces darken and turn glossy, the road
 * grows puddles and rain ripples, and a dry line appears on the racing line.
 *
 * Ground vertex layout (asphalt family):
 *   uv   = (lateral m, s·vScale m)
 *   aA0  = (racing-line lateral, rubber 0..1, skid 0..1, marbles 0..1)
 *   aA1  = (zone, zone-edge lateral |m|, paint/style, half width)
 *   aA2  = (acceleration "elevens" 0..1, dirt dragged on at lateral −, at lateral +, line load signed to the inside)
 *          (asphalt only; marbles in aA0.w are signed: the lateral side they collect on — see trackside/context.ts)
 *          zone: 0 road, 1 kerb, 2 verge, 3 tarmac runoff, 4 plain tarmac, 5 concrete apron (4/5 unused at Monza)
 *          kerb style (aA1.z): 1 flat Monza kerb, 2 chicane kerb, 3 wide exit kerb
 *          verge paint (aA1.z): 0 bare, 1 green, 2 green + blue band (tarmac runoff follows)
 */

export const Z_ROAD = 0;
export const Z_KERB = 1;
export const Z_VERGE = 2;
export const Z_RUNOFF = 3;
export const Z_PIT = 4;
export const Z_APRON = 5;

/**
 * Screen-space reflection inputs for the wet road (filled by trackside/ssr.ts).
 * uSsrOn = 0 disables the march entirely (dry track, other cameras).
 */
export const ssrUniforms = {
  uSsrOn: { value: 0 },
  uSsrColor: { value: null as THREE.Texture | null },
  uSsrDepth: { value: null as THREE.Texture | null },
  uSsrProj: { value: new THREE.Matrix4() },
  uSsrNearFar: { value: new THREE.Vector2(0.1, 1000) },
  uSsrLod: { value: 0 },
};

const W = weatherUniforms;

/**
 * Road state shared by every road material. `uRaceRubber` (0..1) is how much rubber the
 * current session has laid down: the racing line and braking zones darken as it builds
 * (driven by fx/SkidMarks from the distance the field has covered; reset each race).
 */
export const roadUniforms = {
  uRaceRubber: { value: 0 },
};

const COMMON = /* glsl */ `
float tsHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tsAA(float edge, float x) { float w = max(fwidth(x) * 0.7, 1e-4); return smoothstep(edge - w, edge + w, x); }
float tsBand(float x, float a, float b) { return tsAA(a, x) * (1.0 - tsAA(b, x)); }
float tsSqI(float t, float duty) { return floor(t) * duty + min(fract(t), duty); }
// box-filtered square wave: fraction of [x-w/2, x+w/2] where fract(t) < duty
float tsSquare(float x, float duty) {
  float w = max(fwidth(x), 1e-4);
  return (tsSqI(x + 0.5 * w, duty) - tsSqI(x - 0.5 * w, duty)) / w;
}
`;

const WEATHER_PARS = /* glsl */ `
uniform float uWetness;
uniform float uRain;
uniform float uDryLine;
uniform float uWeatherTime;
`;

/** Rain drop rings: two layers of cells, each with one ring expanding and fading. Returns a normal offset. */
const RIPPLE = /* glsl */ `
vec2 tsRipple(vec2 p, float t, float rate) {
  vec2 acc = vec2(0.0);
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float cell = 0.34 + fl * 0.17;
    vec2 q = p / cell + fl * vec2(0.37, 0.71);
    vec2 cid = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = tsHash(cid + fl * 13.1);
    if (h > rate) continue;
    vec2 c = (vec2(tsHash(cid + 3.7), tsHash(cid + 9.1)) - 0.5) * 0.36;
    vec2 d = f - c;
    float r = length(d);
    float life = fract(t * (0.9 + 0.5 * h) + h * 7.0);
    float R = life * 0.46;
    float w = 0.035 + 0.03 * life;
    float x = (r - R) / w;
    float env = exp(-x * x);
    float dh = (2.6 * cos(2.6 * x) - 2.0 * x * sin(2.6 * x)) * env / w;
    float amp = (1.0 - life) * (1.0 - life) * (1.0 - smoothstep(0.42, 0.5, r));
    acc += (d / max(r, 1e-3)) * dh * amp * 0.0035 / cell;
  }
  return acc;
}
`;

const SSR = /* glsl */ `
uniform float uSsrOn;
uniform sampler2D uSsrColor;
uniform sampler2D uSsrDepth;
uniform mat4 uSsrProj;
uniform vec2 uSsrNearFar;
uniform float uSsrLod;
float tsViewZ(vec2 uv) {
  float d = texture2D(uSsrDepth, uv).r;
  float n = uSsrNearFar.x, f = uSsrNearFar.y;
  return (n * f) / ((f - n) * d - f);
}
vec2 tsProj(vec3 q) {
  vec4 c = uSsrProj * vec4(q, 1.0);
  return c.xy / max(c.w, 1e-4) * 0.5 + 0.5;
}
// march the reflected ray through the copied depth; rgb = hit colour, a = confidence.
// The ray is projected once and stepped in screen space with perspective-correct depth (1/z is linear),
// steps packed toward its start where contact reflections (tyres on the road) need the detail.
vec4 tsSSR(vec3 P, vec3 N, float rough, vec2 wobble) {
  vec3 V = normalize(P);
  vec3 R = reflect(V, N);
  if (R.z > 0.05) return vec4(0.0);   // toward the camera: nothing on screen to hit
  // short rays only: the cars and walls beside you mirror in the water; long rays through a half-res,
  // 16-step march flicker between hit and miss on thin distant things (fences, verges)
  float maxT = 40.0;
  if (R.z > 0.0) maxT = min(maxT, (-uSsrNearFar.x * 1.5 - P.z) / R.z);
  if (maxT < 0.5) return vec4(0.0);
  vec3 E = P + R * maxT;
  vec2 s0 = tsProj(P), s1 = tsProj(E);
  float iz0 = 1.0 / P.z, iz1 = 1.0 / E.z;
  float fPrev = 0.0, fHit = -1.0;
  // per-pixel jitter of the step positions (interleaved gradient noise): no stair-step blocks in the hits.
  // Full-strength jitter flips the hit/miss step at grazing, marginal reflections (a distant building
  // seen low over wet tarmac) independently per pixel, with nothing to resolve it over time (no TAA
  // here) — that reads as a fine dithered/checkerboard speckle. Half-strength still breaks up banding
  // but halves how often a neighbouring pixel's phase lands on the other side of a hit/miss edge.
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 0.15;
  for (int i = 1; i <= 16; i++) {
    float f = (float(i) - jit) / 16.0;
    f *= f;
    vec2 uv = mix(s0, s1, f);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float z = 1.0 / mix(iz0, iz1, f);
    // crossed behind a surface: refine below (a ray that passed well behind a thin object is rejected there)
    if (tsViewZ(uv) - z > 0.0) { fHit = f; break; }
    fPrev = f;
  }
  if (fHit < 0.0) return vec4(0.0);
  float a = fPrev, b = fHit;
  float dzB = 0.0;
  for (int k = 0; k < 5; k++) {
    float m = 0.5 * (a + b);
    float dz = tsViewZ(mix(s0, s1, m)) - 1.0 / mix(iz0, iz1, m);
    if (dz > 0.0) { b = m; dzB = dz; } else a = m;
  }
  vec2 uv = mix(s0, s1, b) + wobble;
  float tHit = (maxT * iz1 * b) / mix(iz0, iz1, b);
  float thick = 0.8 + tHit * 0.08;
  if (dzB > thick) return vec4(0.0);
  vec2 e = smoothstep(vec2(0.0), vec2(0.07), uv) * (1.0 - smoothstep(vec2(0.93), vec2(1.0), uv));
  // dzB (how far the refined hit still sits behind the surface) is the noisiest of these terms: a marginal,
  // grazing hit (a distant building low in a puddle) lands on a different march step per pixel under the
  // jitter, so dzB swings a lot between neighbours. A short, sharp falloff turns that swing into full-strength
  // on/off speckle; a longer, softer one turns it into a smooth fade instead — same hits, no dither.
  float conf = e.x * e.y * (1.0 - smoothstep(12.0, 38.0, tHit)) * (1.0 - smoothstep(0.2, 0.42, rough)) * (1.0 - smoothstep(0.85 * thick, 2.0 * thick, dzB));
  conf *= smoothstep(-0.05, 0.12, -R.z);
  // rough water smears reflections vertically (the classic wet-road streak): 4 taps along screen y
  float sp = (0.004 + rough * 0.05) * (1.0 + uSsrLod);
  // the copy was taken before the road drew: road (and sky) pixels in it are empty (far depth, black);
  // a tap that lands in one would pull black into the streak, so only real geometry counts
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 t = uv + vec2(0.0, (float(k) - 1.5) * sp);
    float w = step(texture2D(uSsrDepth, t).r, 0.99995);
    c += texture2D(uSsrColor, t).rgb * w;
    wsum += w;
  }
  if (wsum < 0.5) return vec4(0.0);
  return vec4(c / wsum, conf * min(1.0, wsum / 2.0));
}
`;

const VERT_PARS = /* glsl */ `
attribute vec4 aA0;
attribute vec4 aA1;
varying vec2 vTrk;
varying vec4 vA0;
varying vec4 vA1;
`;
const VERT_MAIN = /* glsl */ `
vTrk = uv;
vA0 = aA0;
vA1 = aA1;
`;

// --------------------------------------------------------------------------------------------- asphalt family

const ASPHALT_FRAG = /* glsl */ `
vec2 tsN = vec2(0.0);    // aggregate detail normal (tangent xy)
vec2 tsMac = vec2(0.0);  // metre-scale unevenness
vec2 tsRip = vec2(0.0);  // rain ripples
vec3 tsSsrN = vec3(0.0); // smooth normal for the reflection march (no ripples / aggregate)
float tsWater = 0.0;     // 1 = the aggregate is under a water film
float tsWet = 0.0;
float tsDetail = 0.6;
float tsSpecOcc = 1.0;   // dry indirect-specular occlusion (1 = none)
float tsRub = 0.0;       // rubber on the line (it sheds water: a smoother sheen in the wet)
{
  float lat = vTrk.x;
  float sv = vTrk.y;
  float alat = abs(lat);
  float zone = vA1.x;
  float hw = vA1.w;
  float px = max(length(fwidth(vTrk)), 1e-4);   // metres per pixel
  // ...and what the aggregate's anisotropic filter really averages over. px is the footprint's long
  // axis — down the road from a car's height that is 10–30× the short one — and fading the scanned
  // aggregate by it threw away detail the 16× filter still resolves: the grain went flat ~4 m from a
  // chase cam, where in laser-scanned games (ACC) and on footage it carries on into the distance as a
  // fine, even texture. The filter averages over the short axis, or over long / ratio once the pixel is
  // stretched more than the filter can follow, so the texture-derived terms fade by that. (Procedural
  // features — seams, hashed pellets, ridges — are not filtered by the hardware: they keep px.)
  vec2 tdX = dFdx(vTrk), tdY = dFdy(vTrk);
  float fLx = length(tdX), fLy = length(tdY);
  float pxA = max(max(min(fLx, fLy), max(fLx, fLy) / uAniso), 1e-4);
  vec4 m96 = texture2D(uMacro, vTrk * (1.0 / 96.0));
  vec4 m24 = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.37, 0.61));
  vec4 mN = texture2D(uMacroN, vTrk * (1.0 / 14.0) + vec2(0.13, 0.29));
  vec4 mN2 = texture2D(uMacroN, vTrk * (1.0 / 61.0) + vec2(0.71, 0.05));
  // decimetre mottling: binder-rich and stone-rich patches, oil drips, fines washed together
  vec4 m3 = texture2D(uMacro, vTrk * (1.0 / 3.1) + vec2(0.21, 0.47));

  // ---- aggregate: two decorrelated samples, histogram-preserving blend → no visible tiling
  const float ca = 0.81915, sa = 0.57358;
  vec2 uA = vTrk * (1.0 / ${ASPHALT_TILE.toFixed(3)});
  vec2 uB = vec2(ca * lat - sa * sv, sa * lat + ca * sv) * (1.0 / ${(ASPHALT_TILE * 0.77).toFixed(3)}) + vec2(0.31, 0.17);
  float wB = smoothstep(0.3, 0.7, m24.a * 0.7 + mN.a * 0.6 - 0.15);
  // the blend mask is low-frequency, so most pixels need only one of the two (16× anisotropic) fetches.
  // (A quarter-mip LOD bias: with no temporal AA to resolve it, the scan's last octave at a texel per pixel
  // crawls under a moving camera — the hardware filter's bilinear tail lets through more than a pixel can
  // hold. Measured with tools/_roadalias.mjs, +0.25 took the road's shimmer below where it was while the
  // aniso-aware fades below kept more of the grain than before; +0.5 went soft.)
  const float LODB = 1.19;   // 2^0.25
  vec2 gAx = dFdx(uA) * LODB, gAy = dFdy(uA) * LODB, gBx = dFdx(uB) * LODB, gBy = dFdy(uB) * LODB;
  vec4 tA, tB;
  if (wB < 0.01) {
    tA = textureGrad(uAsph, uA, gAx, gAy);
    tB = tA;
  } else if (wB > 0.99) {
    tB = textureGrad(uAsph, uB, gBx, gBy);
    tA = tB;
  } else {
    tA = textureGrad(uAsph, uA, gAx, gAy);
    tB = textureGrad(uAsph, uB, gBx, gBy);
  }
  float hk = inversesqrt(wB * wB + (1.0 - wB) * (1.0 - wB));
  vec4 tm = mix(tA, tB, wB);
  float albE = clamp(uAsphMean.x + (tm.r - uAsphMean.x) * hk * 0.72, 0.0, 1.0);
  float albDev = (tm.r - uAsphMean.x) * hk;   // aggregate brightness deviation (≈ ±0.3)
  float hgt = clamp(uAsphMean.y + (tm.g - uAsphMean.y) * hk, 0.0, 1.0);
  vec2 nA = tA.ba * 2.0 - 1.0;
  vec2 nB = tB.ba * 2.0 - 1.0;
  nB = vec2(ca * nB.x + sa * nB.y, -sa * nB.x + ca * nB.y);
  tsN = mix(nA, nB, wB) * hk;   // (single-sample pixels: wB is 0 or 1, so only the matching frame is used)
  float alb = albE * albE * ${ASPHALT_ALB_MAX.toFixed(3)};
  // far and grazing, the footprint outruns even 16x anisotropic filtering and the aggregate would alias
  // (salt-and-pepper glints, worst on a glossy damp road): fall back to its statistics
  float farK = smoothstep(0.006, 0.03, pxA);
  albE = mix(albE, uAsphMean.x, farK * 0.7);
  // (the albedo is linear in the filtered texture, so it may follow the filter out to pxA; the glints are
  // not — thresholds on height and the lit normals — and keep fading by the long axis)
  float farS = smoothstep(0.006, 0.03, px);
  // stone tops = the HIGH-PASS of the height: the scan's height also carries centimetre-to-decimetre
  // swells (how the surface was rolled), and a threshold on the raw height turned those into big binary
  // glossy/matte islands — a camouflage pattern in any backlit glare. Against the local mean (a coarse
  // mip, ~9 cm) only the individual chips stand out, as on a real road: a fine, even sparkle.
  float hLoc = hgt;
  if (farS < 0.99) {
    vec4 tL = textureLod(uAsph, wB < 0.5 ? uA : uB, 5.5);
    hLoc = uAsphMean.y + (tL.g - uAsphMean.y) * hk;
  }
  float stone = mix(smoothstep(-0.02, 0.3, hgt - hLoc), 0.3, farS);
  // binder is matte; the stone tops are polished by traffic and glint
  float rough = mix(0.86, 0.5, stone) + (m3.r - 0.5) * 0.12;
  vec3 col = vec3(alb);
  // resolved grain: sparkle normals; minified: their variance is gone (averaged), keep a little relief
  tsDetail *= mix(1.0, 0.55, smoothstep(0.002, 0.012, px)) * (1.0 - 0.6 * farS);
  albDev *= 1.0 - farK;
  float porous = 0.56;    // how much darker it gets when wet
  float lumTex = clamp(alb / 0.055, 0.5, 2.0);
  tsMac = (mN.rg * 2.0 - 1.0) * 0.045 + (mN2.rg * 2.0 - 1.0) * 0.03;
  vec3 tint = mix(vec3(1.03, 1.0, 0.96), vec3(0.97, 1.0, 1.04), m96.a);
  float dryBand = 0.0;

  if (zone < 0.5 || (zone > 3.5 && zone < 4.5)) {
    // ================================================= racing asphalt: freshly laid, high-grade surface
    // A deep, even charcoal binder-rich stone-mastic surface: the chips are small and coated,
    // so they barely read in colour (±8 %); only a faint, large-scale evenness variation.
    float even = 1.0 + 0.05 * (m96.r - 0.5) + 0.035 * (m24.b - 0.5) + 0.03 * (m3.b - 0.5);
    // (a race-worn mid grey, as the TV pictures show it in sun: the binder long oxidised off the
    // chip tops; the fine chips give a tight ±25 % grain up close)
    col = vec3(0.118, 0.116, 0.112) * (1.0 + albDev * mix(1.25, 0.9, farK)) * even;
    // the odd pale chip (quartz, limestone) among the dark ones, resolved only up close
    col += vec3(0.05, 0.049, 0.046) * smoothstep(0.2, 0.32, albDev) * (1.0 - smoothstep(0.003, 0.012, pxA));
    // satin: coated chips polished smooth, binder slightly rougher; micro-texture normal kept tight
    // (a narrow gap: chip tops and binder differ by a polish, not by a material — a wide one made every
    // cluster of chips a hard-edged glint island against the sun)
    rough = mix(0.76, 0.6, stone) + (m3.r - 0.5) * 0.05;
    tsDetail *= 0.72;
    tsSpecOcc = 0.5;
    // laid in batches: every ~64 m a transverse joint, and each batch a slightly different mix and age —
    // the one variation that still reads 200 m down a straight, where the aggregate is long gone
    {
      const float bLen = 64.0;
      float bi = floor(sv / bLen);
      float bf = sv - bi * bLen;
      float hPrev = tsHash(vec2(bi - 1.0, 11.3));
      float hCur = tsHash(vec2(bi, 11.3));
      float hB = mix(hPrev, hCur, smoothstep(0.0, max(px * 1.5, 0.02), bf));
      float hR = tsHash(vec2(bi, 27.9));
      col *= 1.0 + (hB - 0.5) * 0.2;
      rough += (hR - 0.5) * 0.07;
      // the joint itself: a thin sealed seam, darker and glossier
      float jd = min(bf, bLen - bf);
      float joint = (1.0 - smoothstep(0.012, 0.012 + px, jd)) * (1.0 - smoothstep(0.02, 0.06, px));
      col = mix(col, col * 0.62, joint * 0.7);
      rough = mix(rough, 0.42, joint * 0.6);
    }
    // repairs: now and then a rectangle cut out and relaid — newer patches blacker and tighter, older ones
    // paler and more open, with a sealed (glossy black) seam round the cut. From a TV tower these, the
    // batches and the rubber are what keep a lap of asphalt from reading as one even CG fill.
    if (zone < 0.5) {
      const float pL = 29.0;
      float pc = floor(sv / pL);
      float h = tsHash(vec2(pc, 71.3));
      if (h < 0.24) {
        float h2 = tsHash(vec2(pc, 19.7)), h3 = tsHash(vec2(pc, 5.1)), h4 = tsHash(vec2(pc, 88.2));
        float len = 2.5 + 15.0 * h2 * h2;
        float s0 = pc * pL + h3 * (pL - len);
        float pw = 1.4 + 4.0 * h4;
        float c0 = (h / 0.12 - 1.0) * max(0.0, hw - 0.4 - pw * 0.5);
        float e = max(max(s0 - sv, sv - s0 - len), abs(lat - c0) - pw * 0.5);   // < 0 inside
        float inP = 1.0 - smoothstep(-px, px, e);
        float seam = (1.0 - smoothstep(0.025, 0.025 + px * 1.5, abs(e - 0.03))) * (1.0 - smoothstep(0.02, 0.07, px));
        float newer = step(0.45, h3);
        col *= 1.0 + inP * mix(0.13, -0.2, newer) * (0.85 + 0.3 * m3.b);
        rough += inP * mix(0.05, -0.04, newer);
        tsDetail *= 1.0 + inP * mix(0.25, -0.3, newer);
        col = mix(col, vec3(0.03, 0.03, 0.032), seam * 0.75);
        rough = mix(rough, 0.36, seam * 0.6);
      }
    }
    // metre-scale relief between the grain and the long undulations: breaks the sun's glare into streaks
    vec4 mN3 = texture2D(uMacroN, vTrk * (1.0 / 3.3) + vec2(0.47, 0.83));
    tsMac += (mN3.rg * 2.0 - 1.0) * 0.022;
    // tar snakes: sealed cracks, glossy black bitumen, only in some stretches
    float snake = smoothstep(0.35, 0.75, m24.g) * smoothstep(0.55, 0.75, m96.a) * (1.0 - smoothstep(0.01, 0.04, px));
    col = mix(col, vec3(0.03, 0.03, 0.032), snake * 0.8);
    rough = mix(rough, 0.34, snake * 0.8);
    tsDetail *= 1.0 - snake * 0.7;
    float edgeD = zone < 0.5 ? hw - alat : 99.0;
    // the last half-metre by the edge line sees no traffic: a touch greyer (sand/dust settles)
    float dust = (1.0 - smoothstep(0.1, 0.9, edgeD)) * (0.4 + 0.6 * m24.b);
    col = mix(col, col * 1.18 + vec3(0.003, 0.0028, 0.0024), dust * 0.5);

    // rubbered-in racing line: builds with the session (uRaceRubber), baked strength per corner (vA0.y)
    float d = lat - vA0.x;
    float dd = d + (m24.b - 0.5) * 0.7;
    // (the outside tyres carry the corner: their track lays down more — vA2.w is the line's lateral load,
    // signed toward the inside of the bend)
    float trkW = 1.0 - 0.45 * clamp(vA2.w, -1.0, 1.0) * sign(dd);
    float qA = (abs(dd) - 0.82) / 0.34;
    float qB = (abs(dd) - 0.82) / 0.3;
    float rub = vA0.y * (0.6 * exp(-dd * dd / 3.2) + 0.45 * exp(-qA * qA) * trkW);
    // (every lap of every session before this one has laid some down: the dark line the TV pictures
    // show the whole way round, two tyre tracks inside a darker band, not only in the corners)
    rub = max(rub, 0.5 * exp(-dd * dd / 2.6) + 0.3 * exp(-qB * qB));
    // (laid by thousands of tyres on slightly different lines: long streaks along the lap, not a smooth band)
    float rStreak = texture2D(uMacro, vec2(lat * 1.9, sv * 0.007) + vec2(0.43, 0.12)).b;
    rub *= 0.7 + 0.6 * smoothstep(0.25, 0.75, rStreak);
    rub = clamp(rub, 0.0, 1.0) * (zone < 0.5 ? 1.0 : 0.0) * mix(0.8, 1.0, uRaceRubber);
    tsRub = rub;
    // rubber on new asphalt: darker and a little more matte-satin (it fills the micro-texture)
    col = mix(col, vec3(0.05, 0.05, 0.051), rub * 0.8);
    rough = mix(rough, 0.52, rub * 0.5);
    tsDetail *= 1.0 - rub * 0.4;
    // ...and buffed by thousands of tyres: in long streaks down the line it is polished to a satin sheen
    // that catches a low sun and more of the sky (the chips' cavities are filled: less occlusion)
    float polish = rub * smoothstep(0.35, 0.8, rStreak * 0.6 + m24.b * 0.5) * (zone < 0.5 ? 1.0 : 0.0);
    rough = mix(rough, 0.4, polish * 0.55);
    tsSpecOcc = mix(tsSpecOcc, 0.8, rub * 0.55);
    // off the line the surface sees no rubber: dust and fines settle, a lighter, greyer road
    if (zone < 0.5) {
      float offLine = smoothstep(2.6, 5.0, abs(d)) * (0.55 + 0.45 * m24.b);
      col = mix(col, col * 1.13 + vec3(0.0035, 0.0034, 0.003), offLine * 0.45);
      rough = mix(rough, rough + 0.05, offLine);
      // (unswept: the chips stand proud and open, a coarser grain)
      tsDetail *= 1.0 + 0.15 * offLine;
    }

    // the dry line: tyre tracks clear first, then the whole ±2 m band
    if (zone < 0.5) {
      float dl = abs(d + (mN.a - 0.5) * 0.9);
      float band = 1.0 - smoothstep(1.3, 2.5, dl);
      float qT = (abs(dl) - 0.82) / 0.42;
      float tracks = exp(-qT * qT);
      float patchy = (m24.b - 0.5) * 0.5 + (mN.b - 0.5) * 0.4;
      dryBand = clamp(uDryLine * 1.5 * tracks + (uDryLine * 1.3 - 0.12 + patchy) * band, 0.0, 1.0);
    }

    // braking-zone lock-up streaks: the support races left some, the session adds more (the live tyre
    // marks do the rest)
    float skAmt = vA0.z * mix(0.4, 1.0, uRaceRubber) * (zone < 0.5 ? 1.0 : 0.0);
    if (skAmt > 0.01) {
      float sk = 0.0;
      for (int k = 0; k < 5; k++) {
        float fk = float(k);
        float L = 11.0 + fk * 6.0;
        float cid = floor(sv / L);
        float h1 = tsHash(vec2(cid, fk * 17.0 + 1.0));
        float h2 = tsHash(vec2(cid + 3.1, fk * 5.0 + 2.0));
        float h3 = tsHash(vec2(cid + 7.7, fk * 9.0 + 3.0));
        float f = fract(sv / L);
        float len = 0.35 + 0.6 * h2;
        float st = h3 * (1.0 - len);
        float along = clamp((f - st) / len, 0.0, 1.0);
        float inSeg = step(st, f) * step(f, st + len);
        float off = (h1 - 0.5) * 2.2 + (along - 0.5) * (h2 - 0.5) * 0.9 + sin(along * 9.0 + h1 * 6.0) * 0.04;
        float x = d - off;
        float tr = min(abs(x - 0.8), abs(x + 0.8));
        float w = 0.1 + 0.07 * h3 + px * 0.5;
        float m = 1.0 - smoothstep(w * 0.5, w, tr);
        float fade = smoothstep(0.0, 0.1, along) * (1.0 - smoothstep(0.6, 1.0, along));
        sk = max(sk, m * fade * inSeg * (0.45 + 0.55 * h1));
      }
      float brk = smoothstep(0.2, 0.6, texture2D(uMacro, vec2(lat * 0.4, sv * 0.05)).b);
      sk *= skAmt * brk;
      col = mix(col, vec3(0.01, 0.01, 0.011), sk * 0.8);
      rough = mix(rough, 0.66, sk * 0.5);
      tsDetail *= 1.0 - sk * 0.5;
    }

    // acceleration "elevens" out of the slow corners: the rears spinning up leave two parallel black
    // stripes a rear track apart (±0.78 m), darkest where the throttle goes down, tapering away as the
    // grip comes in, kinked by a snap of oversteer. Every car lays its own pair a little off the line.
    float elAmt = vA2.x * mix(0.45, 1.0, uRaceRubber) * (zone < 0.5 ? 1.0 : 0.0);
    if (elAmt > 0.01) {
      float el = 0.0;
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float L = 17.0 + fk * 9.0;
        float cid = floor(sv / L);
        float h1 = tsHash(vec2(cid, fk * 13.0 + 41.0));
        float h2 = tsHash(vec2(cid + 2.3, fk * 7.0 + 43.0));
        float h3 = tsHash(vec2(cid + 5.9, fk * 3.0 + 47.0));
        float f = fract(sv / L);
        float len = 0.45 + 0.5 * h2;
        float st = h3 * (1.0 - len);
        float along = clamp((f - st) / len, 0.0, 1.0);
        float inSeg = step(st, f) * step(f, st + len);
        float off = (h1 - 0.5) * 1.6 + sin(along * 6.0 + h2 * 6.2831) * 0.05 * h3;
        float x = d - off;
        float tr = min(abs(x - 0.78), abs(x + 0.78));
        float w = 0.15 + 0.06 * h2 + px * 0.5;
        float m = 1.0 - smoothstep(w * 0.55, w, tr);
        float fade = smoothstep(0.0, 0.04, along) * pow(1.0 - along, 1.6);
        el = max(el, m * fade * inSeg * (0.5 + 0.5 * h1));
      }
      // (laid down in streaks along each stripe as the tread hops, not as a flat fill)
      el *= elAmt * (0.65 + 0.35 * texture2D(uMacro, vec2(lat * 2.7, sv * 0.03) + vec2(0.61, 0.33)).b);
      col = mix(col, vec3(0.012, 0.012, 0.013), el * 0.75);
      rough = mix(rough, 0.6, el * 0.4);
      tsDetail *= 1.0 - el * 0.5;
    }

    // marbles: rubber pellets scrubbed off through the corner and flung to the OUTSIDE of the line
    // (vA0.w is signed: the lateral side they collect on), gathering a metre or two off-line into a
    // dark, gritty band that thickens toward the edge; a little on the inside of the tight ones too
    float mbAmt = abs(vA0.w) * mix(0.35, 1.0, uRaceRubber) * (zone < 0.5 ? 1.0 : 0.0);
    if (mbAmt > 0.01) {
      float mSide = vA0.w < 0.0 ? -1.0 : 1.0;
      float dOut = d * mSide;
      float lo = 1.7 + 0.8 * (m24.b - 0.5);
      float offl = smoothstep(lo, lo + 1.4, dOut) + 0.25 * smoothstep(2.4, 4.0, -dOut);
      float n2 = texture2D(uMacro, vTrk / 6.0 + vec2(0.63, 0.05)).b;
      float m = mbAmt * offl * (0.35 + 0.65 * smoothstep(0.3, 0.8, m24.b)) * (0.7 + 0.3 * n2);
      m *= 0.6 + 0.4 * (1.0 - smoothstep(0.0, 4.0, edgeD));
      // pellets: 8–26 mm crumbs on a jittered 4 cm grid, more of them where m is high; up close each one,
      // further away only their coverage (a dark speckled film)
      vec2 pc = vTrk * 25.0;
      vec2 pcI = floor(pc);
      vec2 pcF = fract(pc) - 0.5;
      vec2 pcO = (vec2(tsHash(pcI + 3.1), tsHash(pcI + 8.7)) - 0.5) * 0.3;
      float pcR = 0.1 + 0.23 * tsHash(pcI + 5.3);
      float pel = step(tsHash(pcI + 17.0), m * 0.85) * (1.0 - smoothstep(0.7, 1.0, length(pcF - pcO) / pcR));
      float res = 1.0 - smoothstep(0.006, 0.025, px);
      float mk = mix(m * 0.85 * 0.13, pel, res);
      col = mix(col, vec3(0.012, 0.011, 0.011), clamp(mk, 0.0, 1.0) * 0.9);
      // (and the rubber dust between them: matte, a shade darker)
      col = mix(col, col * 0.82, clamp(m, 0.0, 1.0) * 0.5);
      rough = mix(rough, 0.92, clamp(m, 0.0, 1.0) * 0.6);
    }

    // dirt and gravel dragged back on where cars ran wide (or cut a kerb) over grass or gravel: a
    // brown-grey film fanning in from the edge with stones and clods on it; the line itself stays swept
    if (zone < 0.5) {
      float dS = lat < 0.0 ? vA2.y : vA2.z;
      if (dS > 0.02) {
        float nD = texture2D(uMacro, vTrk * vec2(1.0 / 1.7, 1.0 / 9.0) + vec2(0.29, 0.83)).g * 0.5 + m24.b * 0.6;
        float reach = 0.4 + 2.6 * dS * (0.5 + nD);
        float film = dS * (1.0 - smoothstep(0.0, reach, edgeD)) * smoothstep(0.25, 0.65, nD + 0.2 * m3.b);
        film *= 1.0 - 0.8 * rub;
        col = mix(col, vec3(0.085, 0.074, 0.056) * (0.8 + 0.4 * m3.r), film * 0.55);
        rough = mix(rough, 0.9, film * 0.6);
        vec2 sc = vTrk * vec2(9.0, 7.0);
        vec2 scI = floor(sc);
        vec2 scF = fract(sc) - 0.5;
        vec2 scO = (vec2(tsHash(scI + 11.3), tsHash(scI + 4.9)) - 0.5) * 0.4;
        float scR = 0.07 + 0.15 * tsHash(scI + 2.2);
        float stn = step(tsHash(scI + 6.6), film * 0.7) * (1.0 - smoothstep(0.6, 1.0, length(scF - scO) / scR)) * (1.0 - smoothstep(0.01, 0.04, px));
        vec3 sCol = mix(vec3(0.22, 0.2, 0.17), vec3(0.06, 0.05, 0.035), step(0.6, tsHash(scI + 9.4)));
        col = mix(col, sCol * (0.75 + 0.5 * tsHash(scI + 1.7)), stn);
        rough = mix(rough, 0.85, stn);
      }
    }

    // the paver's longitudinal joint: a faint, slightly glossier seam (hot-joint, barely there)
    float jn = 1.0 - tsAA(0.02 + px * 0.5, abs(lat - 1.9));
    col = mix(col, col * 0.86, jn * 0.35 * (zone < 0.5 ? 1.0 : 0.0));
    rough = mix(rough, rough - 0.06, jn * 0.5);

    if (zone < 0.5) {
      // freshly painted white edge line (track limit) on the last 0.2 m of the road:
      // bright, clean, a satin gloss from the glass beads
      // (rolled onto open asphalt, its edge follows the chips: ragged at the millimetre scale, never a
      // ruler line — offset by the filtered scan, so it settles to a clean edge with distance by itself)
      float line = tsAA(hw - 0.2 + albDev * 0.012, alat);
      // (line paint is ~60 %, not paper white; tyres that cross it and the dust that settles on it grey it in patches)
      vec3 paint = vec3(0.6, 0.59, 0.565) * (0.88 + 0.12 * m3.r) * (1.0 - 0.28 * smoothstep(0.5, 0.85, m24.g * 0.6 + m3.b * 0.5));
      // the paint is a coat over the aggregate, not a decal: the chips' grain shows through it, and it never
      // fills the deepest voids between them — dark pin-holes of tarmac in the white up close, as on a
      // laser-scanned track (ACC) or any onboard on the kerbs
      paint *= 1.0 + 0.3 * albDev;
      float voids = smoothstep(0.32, 0.48, hLoc - hgt) * (1.0 - farK);
      paint = mix(paint, col, voids * 0.7);
      col = mix(col, paint, line);
      tsSpecOcc = mix(tsSpecOcc, 1.0, line);
      rough = mix(rough, 0.38, line);
      tsDetail *= 1.0 - line * 0.75;
      porous = mix(porous, 0.15, line);
    }
  } else if (zone < 1.5) {
    // ================================================= kerb: red/white painted concrete, ridged top
    float kw = max(0.3, vA1.y - hw);
    float kd = (alat - hw) / kw;             // 0 at the road edge … 1 at the outer edge
    float red = tsSquare(sv / 2.0, 0.5);     // 1 m blocks
    vec3 cr = uKerbA;
    vec3 cw = uKerbB;
    vec3 paint = mix(cw, cr, red);
    if (vA1.z > 2.5) {
      // wide exit kerb: an outer band of green/white
      float outer = tsAA(0.62, kd);
      paint = mix(paint, vec3(0.032, 0.11, 0.042), outer);
    }
    // freshly painted: saturated, clean and glossy. Only rubber the session lays down on the inner
    // edge, where the tyres ride (uRaceRubber), dulls it.
    // (a kerb carries rubber from every session before this one too, so some is always there)
    // (the inside kerb at the apex is ridden hardest — vA2.w, the line's load signed to the inside — and the
    // exit kerbs where the cars spin up out of slow corners)
    float kUse = clamp(0.7 + 0.6 * clamp(vA2.w * sign(lat), 0.0, 1.0) + 0.35 * vA2.x, 0.0, 1.35);
    float rubberMarks = smoothstep(0.45, 0.8, texture2D(uMacro, vec2(lat * 0.35, sv * 0.02)).b) * (1.0 - smoothstep(0.1, 0.75, kd)) * mix(0.6, 1.0, uRaceRubber) * kUse;
    float through = 0.0;
    // (a season of rubber, brake dust and grit: never the showroom red and white)
    paint *= 0.96 * (0.92 + 0.16 * m3.b) * (1.0 + 0.06 * albDev);
    // painted concrete, not moulded plastic: up close the coat shows the cast surface under it — a fine
    // sandy grain and the odd air hole the paint bridges darker (the filtered scan again, at a third of the
    // road's relief: it averages away by itself with distance)
    float kGrain = 1.0 - farK;
    paint *= 1.0 + 0.16 * albDev * kGrain;
    paint *= 1.0 - 0.45 * smoothstep(0.36, 0.5, hLoc - hgt) * kGrain;
    // chipped paint: grey concrete shows through where the tyres hammer it
    float chip = smoothstep(0.66, 0.74, texture2D(uMacro, vTrk * vec2(1.0 / 0.9, 1.0 / 1.7) + vec2(0.3, 0.1)).r) * (0.4 + 0.6 * (1.0 - kd)) * (1.0 - smoothstep(0.004, 0.015, px));
    paint = mix(paint, vec3(0.15, 0.145, 0.138) * (0.9 + 0.2 * m3.r), chip * 0.75);
    paint = mix(paint, vec3(0.02), clamp(rubberMarks * 0.6, 0.0, 0.8));
    // the tyres that ride the kerb leave rubber in long streaks along it (stretched 80:1 along the lap),
    // heaviest on the inner half; and the white blocks are never white: a grey-brown road film over all
    float kStreak = smoothstep(0.38, 0.8, texture2D(uMacro, vec2(lat * 1.3, sv * 0.016) + vec2(0.21, 0.6)).g * 0.7 + texture2D(uMacro, vec2(lat * 0.5, sv * 0.006)).b * 0.5)
      * (1.0 - smoothstep(0.3, 0.9, kd)) * (1.0 - smoothstep(0.004, 0.03, px) * 0.5) * mix(0.7, 1.0, uRaceRubber) * kUse;
    // (and a grey film of it over the whole ridden half, under the streaks)
    paint = mix(paint, paint * 0.62 + vec3(0.012), (1.0 - smoothstep(0.15, 0.7, kd)) * 0.45);
    paint = mix(paint, vec3(0.025, 0.024, 0.023), kStreak * 0.6);
    rubberMarks = max(rubberMarks, kStreak * 0.6);
    float kWhite = smoothstep(0.3, 0.5, dot(paint, vec3(0.333)));
    paint = mix(paint, paint * vec3(0.84, 0.82, 0.78), kWhite * (0.6 + 0.4 * m24.b));
    // the joint between each 1 m block, and dirt thrown up along the outer edge
    float bjd = min(fract(sv), 1.0 - fract(sv));
    float bj = (1.0 - smoothstep(0.008, 0.008 + px, bjd)) * (1.0 - smoothstep(0.01, 0.04, px));
    paint *= 1.0 - 0.6 * bj;
    // the joint against the asphalt: a centimetre groove where the precast kerb meets the road, packed
    // with rubber dust and grit — the dark line that makes a kerb read as a separate, raised block from
    // the car rather than paint on the road (it fades out before it is thinner than a pixel)
    float lip = alat - hw;
    float seam = (1.0 - smoothstep(0.012, 0.012 + px, lip)) * (1.0 - smoothstep(0.015, 0.05, px));
    paint = mix(paint, vec3(0.022, 0.021, 0.02), seam * 0.75);
    float kDirt = max(smoothstep(0.6, 1.0, kd) * (0.45 + 0.55 * m24.b), smoothstep(0.55, 0.85, m24.g) * 0.35);
    // dirt dragged across it where cars run wide / cut it over grass or gravel (vA2.y / vA2.z per side)
    float kDS = lat < 0.0 ? vA2.y : vA2.z;
    kDirt = max(kDirt, kDS * smoothstep(0.3, 0.7, m24.b + 0.4 * kd) * 0.9);
    paint = mix(paint, paint * 0.55 + vec3(0.014, 0.012, 0.008), kDirt * 0.55);
    // tyre scuffs across the white blocks: short grey-black arcs where a wheel slid over the kerb
    {
      float sid = floor(sv / 3.0);
      float sh = tsHash(vec2(sid, 61.0));
      float sf = fract(sv / 3.0);
      float arc = abs(kd - (0.15 + 0.6 * sh) - (sf - 0.5) * (sh - 0.5) * 1.4);
      float scuff = (1.0 - smoothstep(0.03, 0.08 + px, arc)) * step(0.55, sh) * smoothstep(0.0, 0.3, sf) * (1.0 - smoothstep(0.6, 1.0, sf)) * kUse;
      paint = mix(paint, paint * 0.45 + vec3(0.01), scuff * kWhite * 0.6);
    }
    col = paint;
    // painted concrete is satin, not plastic: the paint's gloss varies block to block
    rough = mix(0.42 + (m3.r - 0.5) * 0.12 + (tsHash(vec2(floor(sv), 5.0)) - 0.5) * 0.08, 0.64, max(rubberMarks, kDirt * 0.6));
    rough = mix(rough, 0.7, chip * 0.6);
    // (the cast grain's relief, a little of it, faded like the road's)
    tsDetail = mix(0.22, 0.12, smoothstep(0.002, 0.012, pxA));
    porous = 0.22;
    // transverse ridges on the flat top (period 0.16 m), fading out with distance
    float ridgeMask = smoothstep(0.22, 0.3, kd) * (1.0 - smoothstep(0.86, 0.93, kd)) * (1.0 - smoothstep(0.006, 0.02, px));
    float rp = fract(sv / 0.16);
    tsMac.y += (rp < 0.5 ? 1.0 : -1.0) * 0.28 * ridgeMask;
    col *= 1.0 - 0.1 * ridgeMask * step(0.5, rp);
    tsMac *= 0.4;
  } else if (zone < 2.5) {
    // ================================================= verge: green abrasive paint
    float d = alat - vA1.y;
    col = vec3(0.12, 0.118, 0.114) * (1.0 + albDev * 0.9) * (0.95 + 0.1 * m96.r);
    tsSpecOcc = 0.6;
    if (vA1.z > 0.5) {
      // fresh anti-skid green paint: even and saturated, the grit gives it a fine matte texture
      // (the vivid green of the TV pictures: it reads as a colour, not a dark strip)
      vec3 green = vec3(0.035, 0.2, 0.075) * (0.96 + 0.06 * m3.b) * (1.0 + 0.1 * albDev);
      // (weathered: the grit and the dirt cars drag across it dull and darken it in patches; a flat
      // emerald strip was the most video-game thing on every circuit)
      float wear = smoothstep(0.3, 0.8, m24.b) * 0.5 + smoothstep(0.55, 0.9, texture2D(uMacro, vTrk * vec2(1.0 / 1.3, 1.0 / 3.1) + vec2(0.17, 0.71)).r) * 0.5;
      green = mix(green, vec3(0.06, 0.1, 0.06), 0.3 + 0.35 * wear) * (0.82 + 0.3 * m3.r);
      // the anti-skid grit in the paint: a coarse grain and grey specks where it has worn off the high points
      green *= 0.84 + 0.36 * albDev;
      col = mix(green, vec3(0.1, 0.098, 0.092) * (1.0 + albDev), smoothstep(0.6, 0.95, stone) * (1.0 - farK) * 0.35);
      // thin white line on the outer edge of the verge
      float wl = tsBand(d, 1.32, 1.46);
      col = mix(col, vec3(0.6, 0.595, 0.575), wl);
      rough = mix(0.66, 0.4, wl);
      tsDetail = 0.4;
      porous = 0.3;
    }
    // soil and grass cuttings blown over the outer edge (breaks the hard line against the grass)
    if (vA1.z < 1.5) {
      float n = texture2D(uMacro, vTrk * vec2(1.0 / 0.9, 1.0 / 2.3) + vec2(0.4, 0.2)).b;
      float spill = 1.0 - smoothstep(0.0, 0.05 + 0.3 * n * n, 1.5 - d);
      col = mix(col, vec3(0.05, 0.047, 0.034) * (0.7 + 0.6 * m3.b), spill * 0.75);
      rough = mix(rough, 0.95, spill);
    }
  } else if (zone < 3.5) {
    // ================================================= tarmac run-off: new, a shade greyer than the track, painted bands
    col = vec3(0.132, 0.13, 0.126) * (1.0 + albDev * 0.9) * (0.94 + 0.08 * m96.r + 0.05 * (m24.b - 0.5));
    // nobody drives here, so nothing sweeps it: dust, sand and gravel fines lie in drifts
    col = mix(col, vec3(0.2, 0.185, 0.16) * (0.9 + 0.2 * m3.r), smoothstep(0.5, 0.85, m24.b * 0.65 + m96.a * 0.35 + m3.b * 0.2) * 0.3);
    tsSpecOcc = 0.6;
    rough = mix(0.66, 0.5, stone);
    // tyre tracks from cars running wide: shallow arcs out from the edge and back (laid over the paint below)
    float tt = 0.0;
    {
      float dIn = alat - vA1.y;
      for (int k = 0; k < 2; k++) {
        float fk = float(k);
        float L = 34.0 + fk * 22.0;
        float cid = floor(sv / L);
        float h1 = tsHash(vec2(cid, 31.0 + fk * 7.0));
        float f = fract(sv / L);
        float reach = 1.5 + 9.0 * tsHash(vec2(cid, 43.0 + fk));
        float path = sin(3.14159 * f) * reach - 0.8;
        float g = min(abs(dIn - path - 0.8), abs(dIn - path + 0.8));
        tt = max(tt, (1.0 - smoothstep(0.1, 0.22 + px, g)) * step(h1, 0.55) * (0.5 + 0.5 * sin(3.14159 * f)));
      }
    }
    if (vA1.z > 0.5) {
      // painted run-off next to the verge (per circuit, uRunoffStyle):
      //   0 white gap + blue band · 1 astroturf strip · 2 red/white diagonal stripes · 3 none
      float d = alat - vA1.y;
      float gap = tsBand(d, 0.0, 0.12);
      if (uRunoffStyle < 0.5) {
        float bB = tsBand(d, 0.12, 2.3);
        vec3 blue = vec3(0.035, 0.07, 0.165);
        vec3 white = vec3(0.6, 0.595, 0.575);
        // (sun-faded and dusty in patches, worn through to the tarmac where cars cut across it)
        blue = mix(blue, vec3(0.06, 0.08, 0.13), smoothstep(0.45, 0.85, m24.b * 0.7 + m3.r * 0.4) * 0.6);
        vec3 paint = white * gap + blue * bB;
        float amt = (gap + bB) * (0.97 + 0.03 * m24.b) * (1.0 - 0.35 * smoothstep(0.62, 0.8, texture2D(uMacro, vTrk * vec2(1.0 / 1.6, 1.0 / 4.3) + vec2(0.71, 0.27)).r));
        // (a coat over open tarmac, not a sheet of plastic: it follows the grain, and the tyres and the
        // weather wear it off the chip tops first — grey specks through the colour up close)
        paint *= 0.88 + 0.32 * albDev + 0.08 * (m3.b - 0.5);
        float specks = smoothstep(0.55, 0.95, stone) * (1.0 - farK) * 0.45;
        col = mix(col, paint, amt * (1.0 - specks));
        rough = mix(rough, 0.55, amt);
        tsDetail = mix(tsDetail, 0.5, amt);
        porous = mix(porous, 0.3, amt);
      } else if (uRunoffStyle < 1.5) {
        // astroturf: a 3 m strip of synthetic grass (tufted rows, sun-bleached patches, rubbered where cars run over it)
        float band = tsBand(d, 0.15, 3.2);
        float rows = 0.75 + 0.25 * sin(lat * 6.2832 / 0.019 * 0.5);
        float fib = tsHash(floor(vTrk * vec2(160.0, 160.0)));
        float fibK = 1.0 - smoothstep(0.004, 0.012, px);
        vec3 turf = vec3(0.045, 0.16, 0.035) * (0.85 + 0.3 * m3.b) * mix(1.0, (0.8 + 0.4 * fib) * rows, fibK);
        turf = mix(turf, vec3(0.08, 0.17, 0.06), smoothstep(0.6, 0.9, m24.b) * 0.5);
        float wornT = smoothstep(0.55, 0.9, m96.b * 0.6 + m3.r * 0.5) * (1.0 - smoothstep(0.0, 1.5, d - 0.15));
        turf = mix(turf, vec3(0.03, 0.05, 0.028), wornT * 0.6);
        col = mix(col, vec3(0.6, 0.595, 0.575), gap);
        col = mix(col, turf, band);
        rough = mix(rough, 0.92, band);
        tsDetail = mix(tsDetail, 0.9, band);
        porous = mix(porous, 0.5, band);
        tsMac += vec2(fib - 0.5, 0.0) * 0.12 * band * fibK;
      } else if (uRunoffStyle < 2.5) {
        // red/white diagonal stripes, 1.2 m, over a 2.2 m band
        float band = tsBand(d, 0.12, 2.3);
        float st = tsSquare((sv + d * 0.8) / 2.4, 0.5);
        vec3 paint = mix(vec3(0.6, 0.595, 0.575), uKerbA * 1.1, st);
        float amt = max(gap, band) * (0.97 + 0.03 * m24.b);
        col = mix(col, paint * (0.97 + 0.06 * albDev), amt);
        rough = mix(rough, 0.42, amt);
        tsDetail = mix(tsDetail, 0.3, amt);
        porous = mix(porous, 0.25, amt);
      }
    }
    // (the tracks show on the paint as well: rubber and dirt from the tyres)
    col = mix(col, col * 0.55 + vec3(0.004, 0.0035, 0.003), tt * mix(0.3, 0.55, uRaceRubber));
  } else {
    // ================================================= concrete apron
    col = vec3(0.19, 0.19, 0.185) * (0.86 + 0.22 * m24.b + 0.1 * m96.r) * (0.9 + 0.1 * lumTex);
    float jx = abs(fract(lat / 5.0 + 0.5) - 0.5) * 5.0;
    float jy = abs(fract(sv / 6.0 + 0.5) - 0.5) * 6.0;
    float joint = 1.0 - tsAA(0.02 + px * 0.5, min(jx, jy));
    col = mix(col, vec3(0.04), joint * 0.7);
    rough = 0.8;
    tsDetail = 0.15;
    porous = 0.35;
  }

  // grazing angles: the binder hides behind the stones, so what you see is their polished tops
  {
    float NoV = abs(dot(normalize(vNormal), normalize(vViewPosition)));
    rough = mix(rough, rough * 0.72, 1.0 - smoothstep(0.04, 0.35, NoV));
  }

  // ================================================= weather
  if (uWetness > 0.002) {
    float Wt = uWetness;
    float wet = Wt * (1.0 - 0.94 * dryBand);
    // standing water: low spots, the road edges (the camber drains outward), never on the dry line
    float low = mN.b * 0.55 + mN2.b * 0.3 + m96.r * 0.2;
    float edgeBias = zone < 0.5 ? (1.0 - smoothstep(0.1, 2.0, hw - alat)) * 0.3 : zone < 1.5 ? 0.0 : 0.16;
    float thr = 1.08 - 0.5 * Wt;
    float puddle = smoothstep(thr, thr + 0.1, low + edgeBias) * smoothstep(0.25, 0.55, Wt) * (1.0 - dryBand);
    if (zone > 0.5 && zone < 1.5) puddle *= 0.0;
    // the water film rises through the aggregate: crevices fill first, stone tops last
    float level = wet * 1.15 - 0.32;
    // resolved aggregate: per-stone coverage; minified: the fraction of the height distribution below the level
    float sharpC = smoothstep(hgt - 0.22, hgt + 0.12, level);
    float statC = smoothstep(0.0, 1.0, clamp(level / 0.85, 0.0, 1.0));
    float sub = max(mix(sharpC, statC, smoothstep(0.0015, 0.006, px)), puddle);
    if (zone > 0.5 && zone < 1.5) sub *= 0.55;   // kerbs drain: a glossy film, never a mirror
    float damp = smoothstep(0.0, 0.22, wet);
    col *= 1.0 - porous * (1.0 - 0.4 * tsRub) * damp;
    col = mix(col, col * vec3(0.9, 0.95, 1.04), damp * 0.5);
    col *= 1.0 - 0.35 * puddle;
    // a damp film evens out stone vs binder (and keeps the grain from flickering in glossy reflections)
    rough = mix(rough, mix(rough, 0.45, 0.6) * 0.62, damp);
    // specular anti-aliasing: glossy water over sub-pixel aggregate normals sparkles, so flatten them with distance
    tsDetail *= (1.0 - 0.45 * damp) * mix(1.0, 0.12, smoothstep(0.0015, 0.008, px) * damp);
    // water only in the crevices is broken up by the stones around it (and half-hidden): not a mirror
    // until the film joins up — keeps a damp road from sparkling like salt and pepper
    float joined = max(statC, puddle);
    // (a joined film is still broken by the rain and the chips poking through it: a soft, streaky sheen;
    // only standing water is a mirror)
    rough = mix(rough, mix(mix(0.26, 0.11, joined), 0.035, puddle), sub);
    // the rubbered line takes no water into its pores: before the film joins up it already shows a slick,
    // smoother sheen (why it is the slipperiest place on a damp track)
    rough = mix(rough, rough * 0.78, tsRub * damp * (1.0 - sub));
    tsWet = wet;
    if (uRain > 0.01) {
      float fadeR = 1.0 - smoothstep(0.003, 0.011, px);
      if (fadeR > 0.0) tsRip = tsRipple(vTrk, uWeatherTime, 0.25 + 0.75 * uRain) * fadeR * sub * min(1.0, uRain * 2.0);
      // distant rain: a fine shimmer keeps the water from looking like glass
      rough = max(rough, 0.035 + 0.07 * uRain * (1.0 - fadeR) * sub);
    }
  }
  diffuseColor.rgb = col;
  roughnessFactor = clamp(rough, 0.03, 1.0);
}
`;

const ASPHALT_NORMAL = /* glsl */ `
{
  vec2 nd = tsN * tsDetail * (1.0 - tsWater);
  vec2 nm = tsMac * (1.0 - 0.45 * tsWater);
  vec3 mapN = normalize(vec3(nd + nm + tsRip, 1.0));
  normal = normalize(tbn * mapN);
  tsSsrN = normalize(tbn * vec3(nm, 1.0));
  // specular anti-aliasing: normal variance inside the pixel widens the lobe (no sparkle crawl on glossy stone tops)
  vec3 dnx = dFdx(normal), dny = dFdy(normal);
  roughnessFactor = sqrt(roughnessFactor * roughnessFactor + min(0.5 * max(dot(dnx, dnx), dot(dny, dny)), 0.16));
}
`;

function patchGround(m: THREE.MeshStandardMaterial, key: string, t: GroundTextures, fragMain: string, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: t.macro };
    sh.uniforms.uMacroN = { value: t.macroN };
    sh.uniforms.uWetness = W.uWetness;
    sh.uniforms.uRain = W.uRain;
    sh.uniforms.uDryLine = W.uDryLine;
    sh.uniforms.uWeatherTime = W.uWeatherTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uMacro;\nuniform sampler2D uMacroN;\nvarying vec2 vTrk;\nvarying vec4 vA0;\nvarying vec4 vA1;\n' + WEATHER_PARS + COMMON + RIPPLE,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + fragMain);
    extra?.(sh);
  };
  m.customProgramCacheKey = () => key;
}

const RUNOFF_STYLE: Record<RunoffPaint, number> = { bands: 0, astroturf: 1, stripes: 2, plain: 3 };

/** kerb paint (linear albedo) from sRGB hex; the defaults keep the classic red/white */
function kerbColor(hex: string | undefined, fallback: THREE.Color): THREE.Color {
  const c = hex ? new THREE.Color(hex) : fallback.clone();
  // as real paint (the same rule as the cars' liveries): a floor of ~3 % and a ceiling near 70 %, a
  // little greyer than the hex — a kerb that is screen white next to 12 % asphalt glows like a lamp,
  // and a pure red reads as a plastic toy track at TV distance
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const k = 0.9;
  return new THREE.Color(0.03 + (l + (c.r - l) * k) * 0.76, 0.03 + (l + (c.g - l) * k) * 0.76, 0.03 + (l + (c.b - l) * k) * 0.76);
}

export interface AsphaltOptions {
  /** kerb block colours (sRGB hex), e.g. ['#c8261e', '#ecece8'] */
  kerb?: [string, string];
  runoffPaint?: RunoffPaint;
}

export function asphaltMaterial(t: GroundTextures, opts: AsphaltOptions = {}): THREE.MeshStandardMaterial {
  const kerbA = kerbColor(opts.kerb?.[0], new THREE.Color(0.59, 0.023, 0.018));
  const kerbB = kerbColor(opts.kerb?.[1], new THREE.Color(0.84, 0.84, 0.82));
  // the packed aggregate texture doubles as the "normal map" so three builds the tangent frame;
  // the normal stage itself is replaced below
  t.asphalt.repeat.set(1, 1);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    normalMap: t.asphalt,
    roughness: 1,
    metalness: 0,
  });
  patchGround(m, 'apex-ts-asphalt-13', t, ASPHALT_FRAG, (sh) => {
    sh.uniforms.uAsph = { value: t.asphalt };
    // the aggregate's anisotropic filtering ratio (what the driver grants: 16 on desktop GPUs)
    sh.uniforms.uAniso = { value: Math.max(1, t.asphalt.anisotropy) };
    sh.uniforms.uAsphMean = { value: t.asphaltMean };
    sh.uniforms.uKerbA = { value: kerbA };
    sh.uniforms.uKerbB = { value: kerbB };
    sh.uniforms.uRunoffStyle = { value: RUNOFF_STYLE[opts.runoffPaint ?? 'bands'] };
    sh.uniforms.uRaceRubber = roadUniforms.uRaceRubber;
    Object.assign(sh.uniforms, ssrUniforms);
    // the road's third attribute (wear: elevens, dirt per side, line load), asphalt only
    sh.vertexShader = sh.vertexShader
      .replace('attribute vec4 aA1;', 'attribute vec4 aA1;\nattribute vec4 aA2;\nvarying vec4 vA2;')
      .replace('vA1 = aA1;', 'vA1 = aA1;\nvA2 = aA2;');
    sh.fragmentShader = sh.fragmentShader
      .replace('varying vec4 vA1;', 'varying vec4 vA1;\nvarying vec4 vA2;')
      .replace('uniform sampler2D uMacro;', 'uniform sampler2D uMacro;\nuniform sampler2D uAsph;\nuniform float uAniso;\nuniform vec2 uAsphMean;\nuniform vec3 uKerbA;\nuniform vec3 uKerbB;\nuniform float uRunoffStyle;\nuniform float uRaceRubber;')
      .replace('void main() {', SSR + '\nvoid main() {')
      .replace('#include <normal_fragment_maps>', ASPHALT_NORMAL)
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        // the env map is the circuit as seen from ONE spot beside the track: mirrored in a wet road it put that
        // spot's red grandstand or sunlit copper bank under every corner of the lap. Water shows it with its
        // colour mostly gone — the horizon band's light, not somebody else's scenery; what is really beside
        // the road comes from the screen-space march below, in colour and in the right place. (Re-reading it
        // through a wider lobe was tried: the band near the horizon is thin, so a few degrees more reached
        // the open sky and a damp road went snow white under cloud.)
        if (tsWater > 0.02) {
          float iblL = dot(iblRadiance, vec3(0.2126, 0.7152, 0.0722));
          radiance += (mix(vec3(iblL), iblRadiance, 0.45) - iblRadiance) * min(1.0, tsWater * 1.5);
        }
        // specular occlusion: the micro-cavities of a dry surface hide much of the sky's reflection
        // (keeps new asphalt charcoal rather than sky-blue grey); water fills them, so wet it mirrors
        radiance *= mix(tsSpecOcc, 1.0, tsWater);
        // (skip where the view is steep: Fresnel keeps those reflections faint, and they are the nearest, biggest pixels)
        if (uSsrOn > 0.5 && tsWet > 0.04 && material.roughness < 0.42 && dot(normal, normalize(vViewPosition)) < 0.42) {
          vec4 ssr = tsSSR(-vViewPosition, tsSsrN, material.roughness, tsRip * 0.6);
          radiance = mix(radiance, ssr.rgb, ssr.a * smoothstep(0.04, 0.3, tsWet));
        }
        #endif`,
      );
  });
  return m;
}

// --------------------------------------------------------------------------------------------- gravel

const GRAVEL_FRAG = /* glsl */ `
float gRake = 0.0;
{
  vec3 col = diffuseColor.rgb;
  float gh = gTex.a;
  vec4 mA = texture2D(uMacro, vTrk * (1.0 / 96.0));
  vec4 mB = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.11, 0.73));
  vec4 mC = texture2D(uMacro, vTrk * (1.0 / 7.0) + vec2(0.52, 0.33));
  // fresher, paler gravel in patches; darker, dirtier and finer elsewhere
  col *= (0.72 + 0.46 * mA.r + 0.3 * (mB.b - 0.5) + 0.16 * (mC.b - 0.5)) * mix(vec3(1.06, 1.0, 0.9), vec3(0.95, 0.98, 1.04), mA.a);
  // jagged edge toward the grass (vA1.y = metres to the gravel's outer edge)
  float n = texture2D(uMacro, vTrk / 6.0 + vec2(0.3, 0.1)).b;
  if (vA1.y < n * 0.9 - 0.1 - gh * 0.25) discard;
  // thinner, darker gravel near the edges and where it was thrown onto the verge
  float thin = 1.0 - smoothstep(0.0, 0.6, vA1.y);
  col = mix(col, col * vec3(0.55, 0.6, 0.45), thin * 0.5);
  // rake ridges parallel to the track
  // (raked by hand, a while ago: the lines wander, and footprints, wind and rain have blurred whole patches)
  float rk = vTrk.x * 6.2831 / 0.42 + 2.5 * mB.b + 1.6 * mC.b;
  float px = length(fwidth(vTrk));
  float rakeAmt = (1.0 - smoothstep(0.02, 0.07, px)) * (0.25 + 0.75 * mA.r) * smoothstep(0.25, 0.6, mB.r * 0.7 + mC.r * 0.5);
  gRake = cos(rk) * rakeAmt * 0.45;
  col *= 1.0 + 0.06 * sin(rk) * rakeAmt;
  // furrows where cars ran wide into the bed (vA1.x = metres from the inner edge)
  {
    float cid = floor(vTrk.y / 40.0);
    float h = tsHash(vec2(cid, 5.0));
    if (h < 0.4) {
      float f = fract(vTrk.y / 40.0);
      float path = (f - 0.15 - 0.3 * h) * 40.0 * (0.18 + 0.2 * tsHash(vec2(cid, 9.0)));
      float along = step(0.0, path) * (1.0 - smoothstep(6.0, 14.0, path));
      float g = min(abs(vA1.x - path - 0.8), abs(vA1.x - path + 0.8));
      float fur = (1.0 - smoothstep(0.12, 0.3 + px, g)) * along;
      col = mix(col, col * vec3(0.6, 0.58, 0.56), fur * 0.8);
      gRake *= 1.0 - fur;
    }
  }
  float rough = 0.9 - 0.12 * gh;
  // wet gravel: much darker, with a glossy sheen on the pebble tops
  float wet = smoothstep(0.0, 0.3, uWetness);
  col *= 1.0 - 0.5 * wet;
  rough = mix(rough, mix(0.62, 0.3, gh), wet);
  // at TV range the pebbles average out to one flat beige: keep a grain of stone clumps and damp,
  // compacted patches at 1–3 m, and the cars' tracks across it, so a trap still reads as loose gravel
  {
    float far = smoothstep(0.03, 0.2, px);
    vec4 mD = texture2D(uMacro, vTrk * (1.0 / 2.3) + vec2(0.27, 0.61));
    col *= 1.0 + far * (0.22 * (mD.g - 0.5) + 0.14 * (mC.g - 0.5));
    col *= 1.0 - far * 0.12 * smoothstep(0.55, 0.85, mB.g);
  }
  // (a light grey-beige river gravel, not a sand-yellow)
  diffuseColor.rgb = col * vec3(0.82, 0.78, 0.71);
  roughnessFactor = rough;
}
`;

export function gravelMaterial(t: GroundTextures): THREE.MeshStandardMaterial {
  t.gravelAlbedo.repeat.set(1 / GRAVEL_TILE, 1 / GRAVEL_TILE);
  t.gravelNormal.repeat.set(1 / GRAVEL_TILE, 1 / GRAVEL_TILE);
  const m = new THREE.MeshStandardMaterial({
    map: t.gravelAlbedo,
    normalMap: t.gravelNormal,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughness: 0.93,
    metalness: 0,
    // gravel overlaps the grass under its jagged outer edge: keep it on top at any distance
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  patchGround(m, 'apex-ts-gravel-6', t, GRAVEL_FRAG, (sh) => {
    sh.fragmentShader = sh.fragmentShader
      // parallax: pebbles stand proud of the voids between them (height in the albedo's alpha)
      .replace(
        '#include <map_fragment>',
        `vec2 gPuv = vMapUv;
        vec4 gTex;
        {
          mat3 tbnP = getTangentFrame(-vViewPosition, normalize(vNormal), vMapUv);
          vec3 Vt = normalize(vec3(dot(normalize(vViewPosition), tbnP[0]), dot(normalize(vViewPosition), tbnP[1]), dot(normalize(vViewPosition), tbnP[2])));
          vec2 dir = Vt.xy / max(Vt.z, 0.35) * 0.018;
          float h0 = texture2D(map, gPuv).a;
          gPuv += dir * (h0 - 0.55);
          float h1 = texture2D(map, gPuv).a;
          gPuv = vMapUv + dir * (0.5 * (h0 + h1) - 0.55);
          gTex = texture2D(map, gPuv);
          diffuseColor *= gTex;
        }`,
      )
      .replace('texture2D( normalMap, vNormalMapUv )', 'texture2D( normalMap, gPuv )')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(normal + normalize(tbn[0]) * gRake * 0.45);',
      );
  });
  return m;
}

// --------------------------------------------------------------------------------------------- grass

const GRASS_FRAG = /* glsl */ `
float gStripe = 0.0;
{
  vec3 col = diffuseColor.rgb;
  vec4 mA = texture2D(uMacro, vTrk * (1.0 / 96.0) + vec2(0.3, 0.8));
  vec4 mB = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.61, 0.17));
  float clump = texture2D(uMacro, vTrk / 6.0 + vec2(0.7, 0.2)).b;
  col *= (0.78 + 0.42 * mA.r) * (0.8 + 0.4 * clump);
  // (the deep, slightly dull green of real verges in camera footage — not a game's lawn green)
  col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))), col, 0.92) * vec3(0.92, 1.0, 0.74) * 0.86;
  // drier, yellower patches (fewer when it rains)
  float dry = (smoothstep(0.5, 0.85, mB.b) * 0.6 + smoothstep(0.55, 0.9, mA.a) * 0.4) * (1.0 - 0.6 * uWetness);
  col = mix(col, col * vec3(1.45, 1.2, 0.62), dry * 0.6);
  // worn / muddy strip right next to a hard edge (vA1.y = metres from the inner edge)
  float wear = 1.0 - smoothstep(0.0, 0.5 + 0.6 * mB.b, vA1.y);
  col = mix(col, vec3(0.06, 0.05, 0.035), wear * 0.55);
  // mown stripes (diagonal bands), sign flips per band
  gStripe = tsSquare((vTrk.y + vTrk.x * 0.55) / 12.0, 0.5) * 2.0 - 1.0;
  // (the stripes read from every angle on TV: part of it is the cut itself, not only the sheen)
  col *= 1.0 + 0.09 * gStripe;
  float wet = smoothstep(0.0, 0.35, uWetness);
  col *= 1.0 - 0.32 * wet;
  float rough = mix(0.95, 0.68, wet);
  // waterlogged, shiny patches when it pours
  float pool = smoothstep(0.78, 0.86, mB.b * 0.6 + mA.r * 0.5 + wear * 0.25) * smoothstep(0.75, 1.0, uWetness);
  col *= 1.0 - 0.3 * pool;
  rough = mix(rough, 0.2, pool);
  diffuseColor.rgb = col;
  roughnessFactor = rough;
}
`;

/**
 * Desert ground (TracksideDef.ground = 'desert', Bahrain): the grass ribbons become compacted
 * pale sand and grit, dusted darker where cars run wide, with no mowing stripes.
 */
const DESERT_FRAG = /* glsl */ `
{
  vec4 dA = texture2D(uMacro, vTrk * (1.0 / 70.0) + vec2(0.17, 0.43));
  vec4 dB = texture2D(uMacro, vTrk * (1.0 / 11.0) + vec2(0.52, 0.91));
  vec4 dC = texture2D(uMacro, vTrk * (1.0 / 1.7) + vec2(0.11, 0.36));
  vec3 sand = vec3(0.55, 0.44, 0.29);
  vec3 stone = vec3(0.36, 0.31, 0.25);
  vec3 col = sand * (0.84 + 0.3 * dA.r) * (0.9 + 0.2 * dB.g);
  // grey-brown desert pavement (loose stones) in patches, pale wind-blown sand in others
  col = mix(col, stone * (0.85 + 0.3 * dC.b), smoothstep(0.55, 0.8, dA.a * 0.6 + dB.b * 0.4) * 0.6);
  col = mix(col, sand * 1.15, smoothstep(0.62, 0.85, dB.r) * 0.35);
  // grit: dark and pale specks
  col *= 0.86 + 0.28 * smoothstep(0.3, 0.7, dC.g);
  // dust and rubber thrown off the track, darkest right at the edge
  float edge = 1.0 - smoothstep(0.0, 1.2 + 1.5 * dB.b, vA1.y);
  col = mix(col, col * vec3(0.62, 0.6, 0.6), edge * 0.6);
  col *= 1.0 - 0.36 * smoothstep(0.0, 0.35, uWetness);
  diffuseColor.rgb = col;
  roughnessFactor = mix(0.97, 0.75, smoothstep(0.0, 0.5, uWetness));
  gStripe = 0.0;
}
`;

export function grassMaterial(t: GroundTextures, opts: { desert?: boolean } = {}): THREE.MeshStandardMaterial {
  t.grassAlbedo.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  t.grassNormal.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  const m = new THREE.MeshStandardMaterial({
    map: t.grassAlbedo,
    normalMap: t.grassNormal,
    normalScale: opts.desert ? new THREE.Vector2(0.45, 0.45) : new THREE.Vector2(0.9, 0.9),
    roughness: 0.95,
    metalness: 0,
  });
  patchGround(m, opts.desert ? 'apex-ts-grass-3-desert' : 'apex-ts-grass-3', t, opts.desert ? GRASS_FRAG + DESERT_FRAG : GRASS_FRAG, (sh) => {
    // mown-stripe sheen: blades laid one way look lighter from one side, darker from the other
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        vec3 V = normalize(vViewPosition);
        vec3 B = normalize(tbn[1]);
        float facing = dot(V, B);
        float sheen = gStripe * facing;
        diffuseColor.rgb *= 1.0 + 0.22 * sheen;
        diffuseColor.rgb += vec3(0.006, 0.01, 0.004) * max(0.0, 1.0 - dot(V, nonPerturbedNormal));
      }`,
    );
  });
  return m;
}

// --------------------------------------------------------------------------------------------- vertex-PBR props

/**
 * Wet props: darker and glossier, most on upward-facing surfaces; vertical faces get
 * running-water streaks (darker, glossy columns, fading downward from ledges) so walls,
 * boards and barriers read as rain-soaked rather than uniformly varnished.
 */
const PROP_WET = /* glsl */ `
if (uWetness > 0.002) {
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float wUp = clamp(dot(normalize(vNormal), upV), 0.0, 1.0);
  float wet = uWetness * (0.45 + 0.55 * wUp);
  // streaks on steep faces: 9 cm columns keyed on the world position along the face
  float vert = 1.0 - smoothstep(0.35, 0.7, wUp);
  float col = floor(dot(vWP.xz, vec2(0.7071)) * 11.0);
  float h1 = fract(sin(col * 12.9898) * 43758.5453);
  float h2 = fract(sin(col * 78.233) * 12543.123);
  float run = fract(vWP.y * (0.18 + 0.3 * h2) + h1);
  float streak = step(0.45, h1) * smoothstep(0.0, 0.25, run) * (1.0 - 0.6 * run) * vert;
  float w2 = clamp(wet + streak * uWetness * 0.8, 0.0, 1.0);
  diffuseColor.rgb *= 1.0 - 0.28 * w2 - 0.1 * streak * uWetness;
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, w2);
  roughnessFactor = mix(roughnessFactor, 0.08, streak * uWetness * 0.7);
}
`;

/**
 * Galvanised steel (armco, posts, masts, fence frames): a dull, mottled zinc skin instead of a
 * chrome finish — spangle crystals up close, weathered patches further off, never a mirror.
 */
const PROP_ZINC = /* glsl */ `
if (metalnessFactor > 0.5) {
  float zfw = length(fwidth(vWP));
  vec3 zq = floor(vWP * 9.0);
  float zsp = fract(sin(dot(zq, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float zK = 1.0 - smoothstep(0.02, 0.08, zfw);
  float zblot = 0.5 + 0.5 * sin(vWP.x * 0.9 + sin(vWP.z * 1.3)) * sin(vWP.z * 0.7 + vWP.y * 2.1);
  diffuseColor.rgb *= mix(1.0, 0.86 + 0.24 * zsp, zK) * (0.9 + 0.14 * zblot);
  roughnessFactor = clamp(roughnessFactor + 0.12 + (zblot - 0.5) * 0.12 + (zsp - 0.5) * 0.1 * zK, 0.05, 1.0);
  metalnessFactor = min(metalnessFactor, 0.72);
}
`;

/**
 * Weathering by surface class (the integer part of aPBR.x, see WEATHER in builder.ts), all
 * procedural in world space and faded out by its own screen footprint:
 *   CONCRETE      blotchy cure/patina at two scales, rain-run streaks down the faces, pour joints
 *                 every 3 m, lichen on the tops
 *   STEEL         painted steel: chalky mottle, chips and rust runs
 *   PAINTED_WALL  a painted barrier: paint mottle, black rubber scuffs from cars that touched it,
 *                 grime streaks, joints between the 4 m sections
 *   PLASTIC       TecPro / plastic: sun-faded mottle and rubber scuffs
 */
const PW_COMMON = /* glsl */ `
float pwH( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float pwN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( pwH( i ), pwH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( pwH( i + vec2( 0.0, 1.0 ) ), pwH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float pwLine( float x, float p, float w, float fw ) {
  float d = abs( fract( x / p + 0.5 ) - 0.5 ) * p;
  return 1.0 - smoothstep( w, w + fw * 1.5, d );
}
`;
const PROP_WEATHER = /* glsl */ `
float pCls = floor( vPBR.x + 1e-3 );
roughnessFactor = vPBR.x - pCls;
if ( pCls > 0.5 ) {
  vec3 Nw = normalize( ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).xyz );
  float vert = 1.0 - smoothstep( 0.45, 0.8, abs( Nw.y ) );
  vec2 tW = normalize( vec2( -Nw.z, Nw.x ) + vec2( 1e-4 ) );
  vec2 q = mix( vWP.xz, vec2( dot( vWP.xz, tW ), vWP.y ), vert );
  float fw = length( fwidth( q ) );
  float near = 1.0 - smoothstep( 0.03, 0.14, fw );
  float big = pwN( q * 0.11 ) * 0.6 + pwN( q * 0.47 + 7.1 ) * 0.4;
  float fine = pwN( q * 3.7 );
  vec3 c = diffuseColor.rgb;
  float r = roughnessFactor;
  if ( pCls < 1.5 ) {
    c *= 0.8 + 0.3 * big + 0.12 * ( fine - 0.5 ) * near;
    float streak = vert * smoothstep( 0.5, 0.86, pwN( vec2( q.x * 2.3, q.y * 0.32 ) ) ) * ( 0.6 + 0.4 * big );
    c *= 1.0 - 0.24 * streak;
    c *= 1.0 - 0.38 * pwLine( q.x, 3.0, 0.012, fw ) * vert * near;
    c = mix( c, c * vec3( 0.82, 0.9, 0.7 ), ( 1.0 - vert ) * smoothstep( 0.5, 0.8, big ) * 0.6 );
    r = clamp( r + 0.08 * ( fine - 0.5 ), 0.05, 1.0 );
  } else if ( pCls < 2.5 ) {
    c *= 0.9 + 0.14 * big;
    float rust = smoothstep( 0.76, 0.95, pwN( vec2( q.x * 3.0, q.y * 0.3 ) ) ) * vert;
    c = mix( c, vec3( 0.23, 0.13, 0.07 ), rust * 0.3 );
    float chip = smoothstep( 0.8, 0.9, pwN( q * 9.0 ) ) * near;
    c = mix( c, c * 0.62 + vec3( 0.05 ), chip * 0.5 );
    r = clamp( r + 0.16 * ( big - 0.5 ) + 0.1 * chip, 0.05, 1.0 );
  } else if ( pCls < 3.5 ) {
    c *= 0.9 + 0.16 * big;
    // rubber scuffs: long thin black smears, horizontal, in patches along the wall
    float patchK = smoothstep( 0.55, 0.8, pwN( vec2( q.x * 0.05, 3.3 ) ) );
    float smear = smoothstep( 0.62, 0.9, pwN( vec2( q.x * 0.35, q.y * 9.0 ) ) ) * patchK * vert;
    c = mix( c, vec3( 0.03 ), smear * 0.7 );
    float grime = vert * smoothstep( 0.55, 0.85, pwN( vec2( q.x * 1.7, q.y * 0.6 ) ) );
    c *= 1.0 - 0.2 * grime;
    c *= 1.0 - 0.45 * pwLine( q.x, 4.0, 0.006, fw ) * vert * near;
    r = mix( r, 0.55, smear );
  } else {
    c *= 0.86 + 0.2 * big;
    float smear = smoothstep( 0.66, 0.92, pwN( vec2( q.x * 0.8, q.y * 6.0 ) ) ) * vert;
    c = mix( c, vec3( 0.04 ), smear * 0.45 );
    c = mix( c, vec3( dot( c, vec3( 0.333 ) ) ), 0.2 * smoothstep( 0.5, 0.8, big ) );
  }
  diffuseColor.rgb = c;
  roughnessFactor = r;
}
`;

function patchPBR(m: THREE.MeshStandardMaterial, key: string) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWetness = W.uWetness;
    sh.uniforms.uSignGlow = W.uSignGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPBR;\nvarying vec3 vPBR;\nvarying vec3 vWP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPBR = aPBR;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPBR;\nvarying vec3 vWP;\nuniform float uWetness;\nuniform float uSignGlow;\n' + PW_COMMON)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor = vPBR.x;\nmetalnessFactor = vPBR.y;\n' + PROP_WEATHER + PROP_ZINC + PROP_WET)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPBR.z * (vPBR.z < 0.9 ? uSignGlow : 1.0);');
  };
  m.customProgramCacheKey = () => key;
}

/** Untextured props: vertex colour + per-vertex roughness/metalness/emissive. */
export function propsMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  patchPBR(m, 'apex-ts-props-5');
  return m;
}

/** Printed surfaces: atlas map × vertex colour, per-vertex PBR. */
export function printMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.6, metalness: 0 });
  patchPBR(m, 'apex-ts-print-5');
  return m;
}

/** Painted road markings: blended over the road (drawn after it, before cars' transparents). */
export function decalMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    transparent: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  patchPBR(m, 'apex-ts-decal-5');
  return m;
}

export function fenceMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  tex.repeat.set(1, 1);
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.35,
    alphaTest: 0.01,
  });
  m.forceSinglePass = true;
  // thin wires all but vanish with distance: thin the mip-averaged coverage so fences read as a light veil
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWetness = W.uWetness;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWetness;')
      .replace(
        '#include <map_fragment>',
        // (seen edge-on down a straight the mesh piles up into a solid grey sheet that mirrored the sky like
        // glass: thin it and take the sheen off at grazing angles — a real catch fence is a faint haze there)
        '#include <map_fragment>\n  float fNdv = abs(dot(normalize(vNormal), normalize(vViewPosition)));\n  float fGraze = 1.0 - smoothstep(0.04, 0.45, fNdv);\n  diffuseColor.a *= mix(1.0, 0.4, smoothstep(6.0, 45.0, length(vViewPosition))) * (1.0 - 0.6 * fGraze * smoothstep(4.0, 25.0, length(vViewPosition)));\n  diffuseColor.rgb *= 1.0 - 0.25 * uWetness;',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.9, fGraze);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.1, fGraze);');
  };
  m.customProgramCacheKey = () => 'apex-ts-fence-4';
  return m;
}

/** Start-light lamps: `aA0.x` holds the column (0..4, or 9 for never-lit lamps). */
export function lampMaterial(): { material: THREE.MeshStandardMaterial; lit: { value: number } } {
  const lit = { value: 0 };
  const m = new THREE.MeshStandardMaterial({ color: 0x2a0303, emissive: 0xff1208, emissiveIntensity: 1, roughness: 0.25, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = lit;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aA0;\nvarying float vCol;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCol = aA0.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nvarying float vCol;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= step(vCol + 0.5, uLit) * 38.0;');
  };
  m.customProgramCacheKey = () => 'apex-ts-lamp-1';
  return { material: m, lit };
}
