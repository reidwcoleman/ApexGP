import * as THREE from 'three';
import { ASPHALT_ALB_MAX, ASPHALT_TILE, GRASS_TILE, GRAVEL_TILE, type GroundTextures } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

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
  float maxT = 120.0;
  if (R.z > 0.0) maxT = min(maxT, (-uSsrNearFar.x * 1.5 - P.z) / R.z);
  if (maxT < 0.5) return vec4(0.0);
  vec3 E = P + R * maxT;
  vec2 s0 = tsProj(P), s1 = tsProj(E);
  float iz0 = 1.0 / P.z, iz1 = 1.0 / E.z;
  float fPrev = 0.0, fHit = -1.0;
  for (int i = 1; i <= 16; i++) {
    float f = float(i) / 16.0;
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
  float conf = e.x * e.y * (1.0 - smoothstep(60.0, 120.0, tHit)) * (1.0 - smoothstep(0.2, 0.42, rough)) * (1.0 - smoothstep(0.5 * thick, thick, dzB));
  conf *= smoothstep(-0.05, 0.12, -R.z);
  // rough water smears reflections vertically (the classic wet-road streak): 4 taps along screen y
  float sp = (0.004 + rough * 0.05) * (1.0 + uSsrLod);
  vec3 c = texture2D(uSsrColor, uv + vec2(0.0, -1.5 * sp)).rgb + texture2D(uSsrColor, uv + vec2(0.0, -0.5 * sp)).rgb
         + texture2D(uSsrColor, uv + vec2(0.0, 0.5 * sp)).rgb + texture2D(uSsrColor, uv + vec2(0.0, 1.5 * sp)).rgb;
  return vec4(c * 0.25, conf);
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
float tsDetail = 0.42;
{
  float lat = vTrk.x;
  float sv = vTrk.y;
  float alat = abs(lat);
  float zone = vA1.x;
  float hw = vA1.w;
  float px = max(length(fwidth(vTrk)), 1e-4);   // metres per pixel
  vec4 m96 = texture2D(uMacro, vTrk * (1.0 / 96.0));
  vec4 m24 = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.37, 0.61));
  vec4 mN = texture2D(uMacroN, vTrk * (1.0 / 14.0) + vec2(0.13, 0.29));
  vec4 mN2 = texture2D(uMacroN, vTrk * (1.0 / 61.0) + vec2(0.71, 0.05));

  // ---- aggregate: two decorrelated samples, histogram-preserving blend → no visible tiling
  const float ca = 0.81915, sa = 0.57358;
  vec2 uA = vTrk * (1.0 / ${ASPHALT_TILE.toFixed(3)});
  vec2 uB = vec2(ca * lat - sa * sv, sa * lat + ca * sv) * (1.0 / ${(ASPHALT_TILE * 0.77).toFixed(3)}) + vec2(0.31, 0.17);
  float wB = smoothstep(0.3, 0.7, m24.a * 0.7 + mN.a * 0.6 - 0.15);
  // the blend mask is low-frequency, so most pixels need only one of the two (16× anisotropic) fetches
  vec2 gAx = dFdx(uA), gAy = dFdy(uA), gBx = dFdx(uB), gBy = dFdy(uB);
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
  float hgt = clamp(uAsphMean.y + (tm.g - uAsphMean.y) * hk, 0.0, 1.0);
  vec2 nA = tA.ba * 2.0 - 1.0;
  vec2 nB = tB.ba * 2.0 - 1.0;
  nB = vec2(ca * nB.x + sa * nB.y, -sa * nB.x + ca * nB.y);
  tsN = mix(nA, nB, wB) * hk;   // (single-sample pixels: wB is 0 or 1, so only the matching frame is used)
  float alb = albE * albE * ${ASPHALT_ALB_MAX.toFixed(3)};
  float stone = smoothstep(0.32, 0.62, hgt);
  float rough = mix(0.95, 0.66, stone);
  vec3 col = vec3(alb);
  float porous = 0.56;    // how much darker it gets when wet
  float lumTex = clamp(alb / 0.055, 0.5, 2.0);
  tsMac = (mN.rg * 2.0 - 1.0) * 0.045 + (mN2.rg * 2.0 - 1.0) * 0.03;
  vec3 tint = mix(vec3(1.03, 1.0, 0.96), vec3(0.97, 1.0, 1.04), m96.a);
  float dryBand = 0.0;

  if (zone < 0.5 || (zone > 3.5 && zone < 4.5)) {
    // ================================================= racing asphalt
    col *= (0.74 + 0.32 * m96.r + 0.16 * (m24.b - 0.5)) * tint;
    float edgeD = zone < 0.5 ? hw - alat : 99.0;
    // dust and lighter, unused asphalt toward the edges
    float dust = (1.0 - smoothstep(0.2, 2.6, edgeD)) * (0.5 + 0.5 * m24.b);
    col = mix(col, col * 1.42 + vec3(0.008, 0.0072, 0.0058), dust * 0.72);
    rough = min(1.0, rough + dust * 0.04);

    // rubbered-in racing line: broad band + two darker tyre tracks
    float d = lat - vA0.x;
    float dd = d + (m24.b - 0.5) * 0.7;
    float rub = vA0.y * (0.6 * exp(-dd * dd / 3.2) + 0.45 * exp(-pow((abs(dd) - 0.82) / 0.34, 2.0)));
    rub = clamp(rub, 0.0, 1.0) * (zone < 0.5 ? 1.0 : 0.0);
    col = mix(col, vec3(0.016, 0.016, 0.018), rub * 0.68);
    rough = mix(rough, 0.62, rub * 0.55);
    tsDetail *= 1.0 - rub * 0.35;

    // the dry line: tyre tracks clear first, then the whole ±2 m band
    if (zone < 0.5) {
      float dl = abs(d + (mN.a - 0.5) * 0.9);
      float band = 1.0 - smoothstep(1.3, 2.5, dl);
      float tracks = exp(-pow((abs(dl) - 0.82) / 0.42, 2.0));
      float patchy = (m24.b - 0.5) * 0.5 + (mN.b - 0.5) * 0.4;
      dryBand = clamp(uDryLine * 1.5 * tracks + (uDryLine * 1.3 - 0.12 + patchy) * band, 0.0, 1.0);
    }

    // braking-zone lock-up streaks
    if (vA0.z > 0.01) {
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
      sk *= vA0.z * brk;
      col = mix(col, vec3(0.009, 0.009, 0.01), sk * 0.9);
      rough = mix(rough, 0.72, sk * 0.6);
      tsDetail *= 1.0 - sk * 0.5;
    }

    // marbles and dust off-line near corner exits
    if (vA0.w > 0.01) {
      float offl = smoothstep(2.4, 4.5, abs(d));
      float n1 = m24.b;
      float n2 = texture2D(uMacro, vTrk / 6.0 + vec2(0.63, 0.05)).b;
      float m = vA0.w * offl * (0.35 + 0.65 * smoothstep(0.3, 0.8, n1)) * (0.75 + 0.25 * n2);
      m *= 0.6 + 0.4 * (1.0 - smoothstep(0.0, 4.0, edgeD));
      col = mix(col, col * 1.35 + vec3(0.011, 0.01, 0.008), m * 0.5);
      rough = mix(rough, 0.97, m * 0.8);
      float pel = step(0.9, tsHash(floor(vTrk * 26.0))) * (1.0 - smoothstep(0.015, 0.04, px));
      col = mix(col, vec3(0.012), pel * m * 0.8);
    }

    // sealed cracks (tar snakes), only in some areas
    float crack = texture2D(uMacro, vTrk / 32.0 + vec2(0.13, 0.0)).g;
    crack *= smoothstep(0.68, 0.8, m96.r) * (1.0 - smoothstep(0.02, 0.06, px));
    col = mix(col, vec3(0.011, 0.011, 0.012), crack * 0.85);
    rough = mix(rough, 0.5, crack);
    tsDetail *= 1.0 - crack * 0.7;

    // longitudinal paving joint (very faint) and transverse lay joints every ~70 m
    float jn = 1.0 - tsAA(0.03 + px * 0.5, abs(lat - 1.9));
    float tj = 1.0 - tsAA(0.025 + px * 0.5, abs(fract(sv / 71.3 + 0.5) - 0.5) * 71.3);
    col = mix(col, col * 0.72, (jn * 0.45 + tj * 0.35) * (zone < 0.5 ? 1.0 : 0.0));

    // repair patches: fresher (darker, finer) or older (lighter) rectangles
    {
      float cid = floor(sv / 48.0);
      float h = tsHash(vec2(cid, 91.0));
      if (h < 0.22 && zone < 0.5) {
        float h2 = tsHash(vec2(cid, 13.0)), h3 = tsHash(vec2(cid, 29.0)), h4 = tsHash(vec2(cid, 47.0));
        float len = 3.0 + 12.0 * h2;
        float w = 1.6 + 3.8 * h4;
        vec2 c = vec2(-hw + 0.8 + w * 0.5 + (2.0 * hw - 1.6 - w) * tsHash(vec2(cid, 71.0)), cid * 48.0 + 4.0 + len * 0.5 + h3 * (40.0 - len));
        vec2 q = abs(vec2(lat, sv) - c) - vec2(w, len) * 0.5;
        float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        float inside = 1.0 - tsAA(0.0, sdf);
        float seam = (1.0 - smoothstep(0.012, 0.03 + px, abs(sdf))) * (1.0 - smoothstep(0.03, 0.08, px));
        col = mix(col, col * mix(vec3(0.78, 0.78, 0.8), vec3(1.14, 1.12, 1.07), step(0.5, h4)), inside);
        tsDetail *= 1.0 - inside * 0.3;
        col = mix(col, col * 0.45, seam * 0.6);
      }
    }

    if (zone < 0.5) {
      // white edge line (track limit) on the last 0.2 m of the road
      float line = tsAA(hw - 0.2, alat);
      vec3 paint = vec3(0.68, 0.68, 0.66) * (0.8 + 0.25 * m24.b) * (0.86 + 0.14 * lumTex);
      col = mix(col, paint, line);
      rough = mix(rough, 0.46, line);
      tsDetail *= 1.0 - line * 0.6;
      porous = mix(porous, 0.18, line);
    }
  } else if (zone < 1.5) {
    // ================================================= kerb: red/white painted concrete, ridged top
    float kw = max(0.3, vA1.y - hw);
    float kd = (alat - hw) / kw;             // 0 at the road edge … 1 at the outer edge
    float red = tsSquare(sv / 2.0, 0.5);     // 1 m blocks
    vec3 cr = vec3(0.52, 0.02, 0.016);
    vec3 cw = vec3(0.74, 0.74, 0.72);
    vec3 paint = mix(cw, cr, red);
    if (vA1.z > 2.5) {
      // wide exit kerb: an outer band of green/white
      float outer = tsAA(0.62, kd);
      paint = mix(paint, vec3(0.032, 0.11, 0.042), outer);
    }
    // paint wears through on the aggregate peaks; grime and rubber where cars ride it
    float grime = (0.4 + 0.6 * m24.b) * (0.15 + 0.55 * (1.0 - smoothstep(0.0, 0.7, kd)));
    float rubberMarks = smoothstep(0.45, 0.8, texture2D(uMacro, vec2(lat * 0.35, sv * 0.02)).b) * (1.0 - smoothstep(0.1, 0.8, kd));
    paint *= 0.86 + 0.28 * (albE - uAsphMean.x) / 0.3;
    paint = mix(paint, vec3(0.022), clamp(grime * 0.32 + rubberMarks * 0.55, 0.0, 0.85));
    col = paint;
    rough = 0.52 + 0.2 * grime;
    tsDetail = 0.22;
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
    col *= (1.2 + 0.3 * m96.r) * tint;
    if (vA1.z > 0.5) {
      vec3 green = vec3(0.032, 0.1, 0.04) * (0.84 + 0.3 * m24.b);
      float worn = smoothstep(0.64, 0.92, m24.b) * 0.35;
      col = mix(green * (0.85 + 0.25 * (albE - uAsphMean.x) / 0.3), col, worn);
      // thin white line on the outer edge of the verge
      float wl = tsBand(d, 1.32, 1.46);
      col = mix(col, vec3(0.62, 0.62, 0.6), wl);
      rough = 0.74;
      tsDetail = 0.35;
      porous = 0.3;
    }
  } else if (zone < 3.5) {
    // ================================================= tarmac run-off: older, lighter, painted bands
    col *= (1.3 + 0.34 * m96.r + 0.2 * (m24.b - 0.5)) * tint;
    rough = min(1.0, rough + 0.03);
    // tyre tracks from cars running wide: shallow arcs out from the edge and back
    {
      float dIn = alat - vA1.y;
      float tt = 0.0;
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
      col = mix(col, col * 0.52, tt * 0.55);
    }
    if (vA1.z > 0.5) {
      // painted run-off next to the verge: white gap, blue band, then a green band
      float d = alat - vA1.y;
      float gap = tsBand(d, 0.0, 0.12);
      float bB = tsBand(d, 0.12, 2.3);
      vec3 blue = vec3(0.028, 0.06, 0.15);
      vec3 white = vec3(0.5, 0.5, 0.48);
      vec3 paint = white * gap + blue * bB;
      float amt = (gap + bB) * (0.78 + 0.2 * m24.b) * (1.0 - 0.35 * smoothstep(0.6, 0.9, m96.b));
      col = mix(col, paint * (0.82 + 0.3 * (albE - uAsphMean.x) / 0.3), amt);
      rough = mix(rough, 0.7, amt);
      tsDetail = mix(tsDetail, 0.3, amt);
      porous = mix(porous, 0.3, amt);
    }
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
    col *= 1.0 - porous * damp;
    col = mix(col, col * vec3(0.9, 0.95, 1.04), damp * 0.5);
    col *= 1.0 - 0.35 * puddle;
    rough = mix(rough, rough * 0.62, damp);
    // specular anti-aliasing: glossy water over sub-pixel aggregate normals sparkles, so flatten them with distance
    tsDetail *= (1.0 - 0.45 * damp) * mix(1.0, 0.12, smoothstep(0.0015, 0.008, px) * damp);
    rough = mix(rough, mix(0.07, 0.035, puddle), sub);
    tsWater = sub;
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

export function asphaltMaterial(t: GroundTextures): THREE.MeshStandardMaterial {
  // the packed aggregate texture doubles as the "normal map" so three builds the tangent frame;
  // the normal stage itself is replaced below
  t.asphalt.repeat.set(1, 1);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    normalMap: t.asphalt,
    roughness: 1,
    metalness: 0,
  });
  patchGround(m, 'apex-ts-asphalt-5', t, ASPHALT_FRAG, (sh) => {
    sh.uniforms.uAsph = { value: t.asphalt };
    sh.uniforms.uAsphMean = { value: t.asphaltMean };
    Object.assign(sh.uniforms, ssrUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform sampler2D uMacro;', 'uniform sampler2D uMacro;\nuniform sampler2D uAsph;\nuniform vec2 uAsphMean;')
      .replace('void main() {', SSR + '\nvoid main() {')
      .replace('#include <normal_fragment_maps>', ASPHALT_NORMAL)
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
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
  float rk = vTrk.x * 6.2831 / 0.42 + 2.5 * mB.b;
  float px = length(fwidth(vTrk));
  float rakeAmt = (1.0 - smoothstep(0.02, 0.07, px)) * (0.45 + 0.55 * mA.r);
  gRake = cos(rk) * rakeAmt * 0.6;
  col *= 1.0 + 0.1 * sin(rk) * rakeAmt;
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
  diffuseColor.rgb = col * vec3(0.84, 0.78, 0.68);
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
  patchGround(m, 'apex-ts-gravel-4', t, GRAVEL_FRAG, (sh) => {
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
  col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))), col, 0.82) * vec3(1.04, 1.0, 0.86);
  // drier, yellower patches (fewer when it rains)
  float dry = (smoothstep(0.55, 0.85, mB.b) * 0.6 + smoothstep(0.6, 0.9, mA.a) * 0.4) * (1.0 - 0.6 * uWetness);
  col = mix(col, col * vec3(1.45, 1.2, 0.62), dry * 0.5);
  // worn / muddy strip right next to a hard edge (vA1.y = metres from the inner edge)
  float wear = 1.0 - smoothstep(0.0, 0.5 + 0.6 * mB.b, vA1.y);
  col = mix(col, vec3(0.06, 0.05, 0.035), wear * 0.55);
  // mown stripes (diagonal bands), sign flips per band
  gStripe = tsSquare((vTrk.y + vTrk.x * 0.55) / 12.0, 0.5) * 2.0 - 1.0;
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

export function grassMaterial(t: GroundTextures): THREE.MeshStandardMaterial {
  t.grassAlbedo.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  t.grassNormal.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  const m = new THREE.MeshStandardMaterial({
    map: t.grassAlbedo,
    normalMap: t.grassNormal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.95,
    metalness: 0,
  });
  patchGround(m, 'apex-ts-grass-3', t, GRASS_FRAG, (sh) => {
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

/** wet props: darker and glossier, most on upward-facing surfaces */
const PROP_WET = /* glsl */ `
{
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float wUp = clamp(dot(normalize(vNormal), upV), 0.0, 1.0);
  float wet = uWetness * (0.45 + 0.55 * wUp);
  diffuseColor.rgb *= 1.0 - 0.28 * wet;
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, wet);
}
`;

function patchPBR(m: THREE.MeshStandardMaterial, key: string) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWetness = W.uWetness;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPBR;\nvarying vec3 vPBR;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPBR = aPBR;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPBR;\nuniform float uWetness;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor = vPBR.x;\nmetalnessFactor = vPBR.y;\n' + PROP_WET)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPBR.z;');
  };
  m.customProgramCacheKey = () => key;
}

/** Untextured props: vertex colour + per-vertex roughness/metalness/emissive. */
export function propsMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  patchPBR(m, 'apex-ts-props-2');
  return m;
}

/** Printed surfaces: atlas map × vertex colour, per-vertex PBR. */
export function printMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.6, metalness: 0 });
  patchPBR(m, 'apex-ts-print-2');
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
  patchPBR(m, 'apex-ts-decal-3');
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
        '#include <map_fragment>\n  diffuseColor.a *= mix(1.0, 0.4, smoothstep(6.0, 45.0, length(vViewPosition)));\n  diffuseColor.rgb *= 1.0 - 0.25 * uWetness;',
      );
  };
  m.customProgramCacheKey = () => 'apex-ts-fence-3';
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
