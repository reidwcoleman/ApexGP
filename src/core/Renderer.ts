import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/**
 * Renderer + post chain.
 *
 *   RenderPass (HDR, half float)
 *   → N8AO (screen-space AO, world-radius; ultra)
 *   → camera motion blur (depth reprojection; tracked cars move with themselves) [own pass]
 *   → onboard lens (eye cams: own cockpit shaded + defocused, outside exposed up) [own pass]
 *   → speed blur (radial, only while fast)      [own pass: convolution]
 *   → depth of field (menus/replays only)        [own pass: convolution]
 *   → lens rain (onboard cameras in the wet)     [own pass: convolution]
 *   → sanitize (NaN/Inf scrub) → sun shafts → bloom → grade (game layer × weather look × lightning flash)
 *     → AgX → vignette → grain
 *   → chromatic aberration (only while fast)     [own pass: convolution]
 *   → SMAA → sharpen (contrast-adaptive, High/Ultra; stronger while the dynamic resolution is down)
 *
 * renderer.toneMapping stays NoToneMapping: tone mapping happens in the
 * composer, after bloom, so highlights bloom in linear HDR.
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

// radial speed blur toward the edges, with the lens's lateral chromatic aberration folded
// into the same pass (red and blue fringes pulled apart radially: one full-screen pass, not two)
const RADIAL_BLUR_FRAG = /* glsl */ `
uniform float strength;
uniform float aberration;
uniform vec2 center;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = uv - center;
  float d = length(dir * vec2(aspect, 1.0));
  float amt = strength * smoothstep(0.12, 0.85, d);
  vec3 col = inputColor.rgb;
  if (aberration > 0.00001) {
    vec2 ca = dir * aberration * smoothstep(0.1, 0.9, d) * 2.0;
    col.r = texture2D(inputBuffer, uv - ca).r;
    col.b = texture2D(inputBuffer, uv + ca).b;
  }
  if (amt < 0.0005) { outputColor = vec4(col, inputColor.a); return; }
  vec3 acc = col;
  float w = 1.0;
  for (int i = 1; i < 10; i++) {
    float t = float(i) / 9.0;
    float wi = 1.0 - t * 0.5;
    acc += texture2D(inputBuffer, uv - dir * amt * t).rgb * wi;
    w += wi;
  }
  outputColor = vec4(acc / w, inputColor.a);
}
`;

class RadialBlurEffect extends Effect {
  constructor() {
    super('RadialBlurEffect', RADIAL_BLUR_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(0)],
        ['aberration', new THREE.Uniform(0)],
        ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.52))],
      ]),
    });
  }
  get strength() {
    return this.uniforms.get('strength')!.value as number;
  }
  set strength(v: number) {
    this.uniforms.get('strength')!.value = v;
  }
  get aberration() {
    return this.uniforms.get('aberration')!.value as number;
  }
  set aberration(v: number) {
    this.uniforms.get('aberration')!.value = v;
  }
}

/** how many cars the motion blur tracks as moving objects (the nearest to the camera) */
export const MOTION_CARS = 8;

// Camera motion blur like a film camera's shutter: every pixel's world position (from depth) is
// reprojected into the previous frame and the image is smeared along the difference. Pixels inside
// a tracked car's box move with that car instead of with the world, so the car you are in (and the
// ones racing alongside) stay sharp while the grass, kerbs and barriers streak past; a panning TV
// camera keeps its car sharp and streaks the background. Samples nearer the lens than the pixel are
// rejected so foreground edges (halo, cockpit) don't bleed into the background.
const MOTION_BLUR_FRAG = /* glsl */ `
uniform mat4 projInv;
uniform mat4 camWorld;
uniform mat4 prevViewProj;
uniform mat4 carInv[${MOTION_CARS}];
uniform mat4 carPrev[${MOTION_CARS}];
uniform int carCount;
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform float shutter;
uniform float maxLen;

vec3 viewPos(vec2 uv, float depth) {
  float vz = getViewZ(depth);
  vec4 ray = projInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  return ray.xyz * (vz / ray.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 wpos = (camWorld * vec4(viewPos(uv, depth), 1.0)).xyz;
  vec3 prev = wpos;
  for (int i = 0; i < ${MOTION_CARS}; i++) {
    if (i >= carCount) break;
    vec3 l = (carInv[i] * vec4(wpos, 1.0)).xyz;
    if (all(greaterThan(l, boxMin)) && all(lessThan(l, boxMax))) {
      prev = (carPrev[i] * vec4(l, 1.0)).xyz;
      break;
    }
  }
  vec4 pc = prevViewProj * vec4(prev, 1.0);
  if (pc.w <= 0.0) { outputColor = inputColor; return; }
  vec2 v = (uv - (pc.xy / pc.w * 0.5 + 0.5)) * shutter;
  float len = length(v * vec2(aspect, 1.0));
  if (len > maxLen) v *= maxLen / len;
  if (length(v / texelSize) < 0.75) { outputColor = inputColor; return; }
  float z0 = -getViewZ(depth);
  vec3 acc = inputColor.rgb;
  float w = 1.0;
  // taps by streak length (4 … 16, a tap every ~3 px), jittered per pixel so the steps read as
  // grain rather than as ghost copies
  float px = length(v / texelSize);
  int n = int(clamp(px / 3.0, 4.0, 16.0));
  float fn = float(n);
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float t = (float(i) + 0.5 + jit) / fn - 0.5;
    vec2 su = uv + v * t;
    float zs = -getViewZ(readDepth(su));
    // a sample much nearer the lens than this pixel is foreground: it does not smear back over it
    float k = step(z0 * 0.8 - 0.3, zs);
    acc += texture2D(inputBuffer, su).rgb * k;
    w += k;
  }
  outputColor = vec4(acc / w, inputColor.a);
}
`;

class MotionBlurEffect extends Effect {
  constructor() {
    super('MotionBlurEffect', MOTION_BLUR_FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['prevViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ['carInv', new THREE.Uniform(Array.from({ length: MOTION_CARS }, () => new THREE.Matrix4()))],
        ['carPrev', new THREE.Uniform(Array.from({ length: MOTION_CARS }, () => new THREE.Matrix4()))],
        ['carCount', new THREE.Uniform(0)],
        // a car's box in its own frame (origin on the ground, mid-wheelbase, +Z forward), a little generous
        ['boxMin', new THREE.Uniform(new THREE.Vector3(-1.15, -0.2, -2.85))],
        ['boxMax', new THREE.Uniform(new THREE.Vector3(1.15, 1.45, 2.95))],
        ['shutter', new THREE.Uniform(0)],
        ['maxLen', new THREE.Uniform(0.09)],
      ]),
    });
  }
}

// An onboard camera, as real footage shows it: the lens is exposed for the bright world outside,
// so the inside of the car the camera sits in (halo, chassis rim, wheel) falls into shadow, and it
// is focused down the road, so whatever is a hand's width from the glass is soft. Pixels of the
// player's own car (its box, from depth) are shaded and defocused by how near they are (a disc
// gather, only on those pixels: the outside costs one depth read). The outside gets a
// little more exposure so the sky rolls off toward white.
const ONBOARD_FRAG = /* glsl */ `
uniform mat4 projInv;
uniform mat4 camWorld;
uniform mat4 ownInv;
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform float shade;
uniform float defocus;
uniform float outside;

vec3 obViewPos(vec2 uv, float depth) {
  float vz = getViewZ(depth);
  vec4 ray = projInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  return ray.xyz * (vz / ray.z);
}
// distance from the lens if this pixel is the player's own car, else -1
float ownDist(vec2 uv, float depth) {
  if (-getViewZ(depth) > 4.5) return -1.0;
  vec3 vp = obViewPos(uv, depth);
  vec3 l = (ownInv * (camWorld * vec4(vp, 1.0))).xyz;
  return all(greaterThan(l, boxMin)) && all(lessThan(l, boxMax)) ? length(vp) : -1.0;
}
// blur radius (uv, vertical) of a surface this far from a lens focused far away
float coc(float d) { return defocus * clamp(1.0 / max(d, 0.25) - 0.12, 0.0, 1.6); }

vec3 shadeOwn(vec3 c, float d) {
  float k = shade * (1.0 - smoothstep(1.6, 3.6, d));
  // the shadowed cockpit: much less light, a little less colour, and no sun glints in the lacquer
  // (kept, they sparkle once the paint round them is dark); only the lit LEDs keep their glow —
  // bright AND strongly coloured, where a glint is bright and white
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float hi = max(max(c.r, c.g), c.b);
  float chroma = (hi - min(min(c.r, c.g), c.b)) / max(hi, 1e-4);
  vec3 s = mix(vec3(lum), c, 0.72) * 0.28 + max(c - 2.5, 0.0) * 0.7 * smoothstep(0.5, 0.8, chroma);
  return mix(c, s, k);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // an onboard camera's small wide lens darkens hard toward the corners
  vec2 vc = (uv - 0.5) * vec2(aspect, 1.0);
  float vig = 1.0 - 0.5 * smoothstep(0.3, 1.0, length(vc));
  float d0 = ownDist(uv, depth);
  // the view outside: just the exposure (its edge against the cockpit is softened from the inside)
  if (d0 < 0.0) { outputColor = vec4(inputColor.rgb * outside * vig, inputColor.a); return; }
  float r0 = coc(d0);
  vec3 c0 = shadeOwn(inputColor.rgb, d0);
  if (r0 * resolution.y < 0.75) { outputColor = vec4(c0 * vig, inputColor.a); return; }
  // defocus disc: the cockpit's own soft neighbours, and the view behind where the disc crosses an
  // edge. The disc turns per pixel (interleaved gradient noise) and bright taps are weighted down
  // (1 / (1 + luma)) so a small LED spreads into a soft disc instead of a dotted pattern.
  float rot = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float w = 1.0 / (1.0 + dot(c0, vec3(0.2126, 0.7152, 0.0722)));
  vec3 acc = c0 * w;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996 + rot;
    float rr = sqrt((float(i) + 0.5) / 12.0);
    vec2 su = uv + vec2(cos(a), sin(a)) * rr * r0 * vec2(1.0 / aspect, 1.0);
    float ds = ownDist(su, readDepth(su));
    vec3 c = texture2D(inputBuffer, su).rgb;
    c = ds < 0.0 ? c * outside : shadeOwn(c, ds);
    float wi = 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)));
    acc += c * wi;
    w += wi;
  }
  outputColor = vec4(acc / w * vig, inputColor.a);
}
`;

class OnboardEffect extends Effect {
  constructor() {
    super('OnboardEffect', ONBOARD_FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['ownInv', new THREE.Uniform(new THREE.Matrix4())],
        ['boxMin', new THREE.Uniform(new THREE.Vector3(-1.15, -0.2, -2.85))],
        ['boxMax', new THREE.Uniform(new THREE.Vector3(1.15, 1.45, 2.95))],
        ['shade', new THREE.Uniform(1)],
        ['defocus', new THREE.Uniform(0.0105)],
        ['outside', new THREE.Uniform(1.12)],
      ]),
    });
  }
}

// One NaN/Inf pixel (a degenerate normal, a divide by zero in some shader) is
// enough for bloom's blur chain to black out the whole frame. Scrub them first.
const SANITIZE_FRAG = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  bvec3 bad = bvec3(c.r != c.r || abs(c.r) > 1e6, c.g != c.g || abs(c.g) > 1e6, c.b != c.b || abs(c.b) > 1e6);
  if (any(bad)) c = vec3(0.0);
  outputColor = vec4(min(max(c, 0.0), vec3(200.0)), inputColor.a);
}
`;

/**
 * Contrast-adaptive sharpening (after AMD's CAS): a negative-lobe cross filter whose
 * strength backs off wherever the local contrast is already high, so edges crisp up
 * without halos and flat areas don't gain noise. Undoes the softness of SMAA and of a
 * lowered render resolution — the difference between a game capture and a broadcast feed.
 */
const SHARPEN_FRAG = /* glsl */ `
uniform float sharpness;
// the last pass draws at the display's native resolution from the lower-resolution frame: a
// Catmull-Rom bicubic upscale (9 bilinear taps), clamped to the local 2×2 neighbourhood so it
// can't ring, then contrast-adaptive sharpening measured on the source texels
vec3 cubic(vec2 uv, out vec3 mn, out vec3 mx) {
  vec2 size = 1.0 / texelSize;
  vec2 sp = uv * size;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 t0 = (t1 - 1.0) * texelSize;
  vec2 t3 = (t1 + 2.0) * texelSize;
  vec2 t12 = (t1 + o12) * texelSize;
  vec3 r = vec3(0.0);
  r += texture2D(inputBuffer, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;
  r += texture2D(inputBuffer, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
  r += texture2D(inputBuffer, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
  r += texture2D(inputBuffer, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
  r += texture2D(inputBuffer, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
  r += texture2D(inputBuffer, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
  r += texture2D(inputBuffer, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;
  r += texture2D(inputBuffer, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
  r += texture2D(inputBuffer, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  vec2 b = t1 * texelSize;
  vec3 a00 = texture2D(inputBuffer, b).rgb;
  vec3 a10 = texture2D(inputBuffer, b + vec2(texelSize.x, 0.0)).rgb;
  vec3 a01 = texture2D(inputBuffer, b + vec2(0.0, texelSize.y)).rgb;
  vec3 a11 = texture2D(inputBuffer, b + texelSize).rgb;
  mn = min(min(a00, a10), min(a01, a11));
  mx = max(max(a00, a10), max(a01, a11));
  return clamp(r, mn, mx);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 mn, mx;
  vec3 c = cubic(uv, mn, mx);
  vec3 a = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
  vec3 b = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;
  vec3 d = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  vec3 lo = min(c, min(min(a, b), min(d, e)));
  vec3 hi = max(c, max(max(a, b), max(d, e)));
  vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
  vec3 w = -amp * mix(0.08, 0.22, sharpness);
  vec3 o = (c + (a + b + d + e) * w) / (1.0 + 4.0 * w);
  outputColor = vec4(clamp(o, 0.0, 1.0), inputColor.a);
}
`;

class SharpenEffect extends Effect {
  constructor() {
    super('SharpenEffect', SHARPEN_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['sharpness', new THREE.Uniform(0.5)]]),
    });
  }
  set sharpness(v: number) {
    this.uniforms.get('sharpness')!.value = v;
  }
}

/**
 * Ambient occlusion in the main post pass: depth-only, one pass, no extra render targets (the
 * N8AO pass costs ~5 ms on an M1 whatever its quality — this costs about one). View positions are
 * rebuilt from the depth buffer, the normal from their screen derivatives, and 10 taps on a
 * noise-rotated spiral within a world-space radius test how much of the hemisphere is blocked:
 * the car sitting on the asphalt, wheels in their wells, the barrier feet, the gaps in the stands,
 * trunks and the ground under the trees. It darkens the ambient-lit share of the picture more than
 * the sunlit one (bright pixels are mostly direct light, which AO must not touch).
 */
const AO_FRAG = /* glsl */ `
uniform float aoRadius;
uniform float aoIntensity;
uniform vec2 aoTanHalf;
vec3 aoViewPos(vec2 uv, float d) {
  float vz = getViewZ(d);
  return vec3((uv * 2.0 - 1.0) * aoTanHalf * -vz, vz);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (aoIntensity <= 0.0 || depth >= 0.99999) return;
  vec3 P = aoViewPos(uv, depth);
  float dist = -P.z;
  if (dist > 180.0) return;
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  // screen radius (uv) of the world radius at this depth, kept to a sensible footprint
  float rS = min(aoRadius / (dist * aoTanHalf.y * 2.0), 0.08);
  if (rS < texelSize.y * 1.5) return;
  // one fixed spiral for every pixel (a per-pixel rotation with no blur pass after it left a fine
  // dot pattern over every curved panel): smooth, and 14 taps keep it from banding
  float occ = 0.0;
  for (int i = 0; i < 14; i++) {
    float t = (float(i) + 0.5) / 14.0;
    float a = float(i) * 2.39996;
    vec2 o = vec2(cos(a), sin(a) * aspect) * rS * sqrt(t);
    vec2 q = uv + o;
    float dq = readDepth(q);
    vec3 S = aoViewPos(q, dq);
    vec3 v = S - P;
    float l = length(v);
    float h = max(0.0, dot(N, v) / max(l, 1e-4) - 0.2);
    occ += h * (1.0 - smoothstep(aoRadius * 0.6, aoRadius * 1.4, l));
  }
  occ = clamp(occ / 14.0 * 1.9, 0.0, 1.0);
  // fade out with distance (the far field is fog and aerial haze)
  occ *= 1.0 - smoothstep(90.0, 180.0, dist);
  float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float ambient = 1.0 - smoothstep(0.35, 2.5, lum) * 0.65;
  outputColor = vec4(inputColor.rgb * (1.0 - occ * aoIntensity * ambient), inputColor.a);
}
`;

export class AOEffect extends Effect {
  constructor() {
    super('AOEffect', AO_FRAG, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['aoRadius', new THREE.Uniform(0.9)],
        ['aoIntensity', new THREE.Uniform(0.85)],
        ['aoTanHalf', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ]),
    });
  }
  set intensity(v: number) {
    this.uniforms.get('aoIntensity')!.value = v;
  }
  get intensity() {
    return this.uniforms.get('aoIntensity')!.value as number;
  }
  setCamera(cam: THREE.PerspectiveCamera) {
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    (this.uniforms.get('aoTanHalf')!.value as THREE.Vector2).set(ty * cam.aspect, ty);
  }
}

class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', SANITIZE_FRAG, { blendFunction: BlendFunction.SET });
  }
}

/**
 * Water on the lens: sitting droplets that refract an inverted, miniature image
 * of the scene (and appear/evaporate), plus drops blown outward across the lens
 * with trails as the car goes faster. `amount` 0 … 1, `speed` 0 … 1.
 */
const LENS_RAIN_FRAG = /* glsl */ `
uniform float amount;
uniform float shimmer;
uniform float speed;
uniform float time;

float lr_h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 lr_h31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}

// a drop: xy = where to sample the scene (uv offset), z = coverage, w = 0 centre … 1 rim
// sitting drops: an inverted, shrunk image of what is behind them; they bead, sit and evaporate
vec4 lr_static(vec2 uv, float scale, float seed, float density) {
  vec2 g = uv * vec2(aspect, 1.0) * scale;
  vec2 id = floor(g);
  vec2 st = fract(g) - 0.5;
  vec3 n = lr_h31(id.x * 71.3 + id.y * 1117.9 + seed);
  float life = fract(time * (0.04 + 0.07 * n.z) + n.x * 7.0);
  float alive = step(1.0 - density, n.y);
  float r = mix(0.1, 0.32, n.z * n.z) * smoothstep(0.0, 0.05, life) * smoothstep(1.0, 0.75, life);
  vec2 c = (n.xy - 0.5) * (0.8 - 2.0 * r);
  vec2 d = st - c;
  // drops sag a little
  d.y *= 1.0 + 0.25 * sign(d.y);
  float dist = length(d);
  float m = smoothstep(r, r * 0.8, dist) * alive;
  if (m <= 0.0) return vec4(0.0);
  vec2 centreUV = (id + 0.5 + c) / scale / vec2(aspect, 1.0);
  vec2 rel = (uv - centreUV);
  vec2 target = centreUV - rel * 2.4 + vec2(0.0, 0.03);
  return vec4(target - uv, m, clamp(dist / max(r, 1e-4), 0.0, 1.0));
}

// drops blown outward across the lens at speed (polar grid moving in log-radius), with a
// wet trail behind them
vec4 lr_stream(vec2 uv, float seed) {
  vec2 q = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
  float r = length(q);
  if (r < 0.06) return vec4(0.0);
  float ang = atan(q.y, q.x);
  float lanes = 40.0;
  float a = ang / 6.2831853 * lanes;
  float lr = log(r) * 7.0 - time * (1.5 + 14.0 * speed);
  vec2 g = vec2(a, lr);
  vec2 id = floor(g);
  vec2 st = fract(g) - 0.5;
  vec3 n = lr_h31(id.x * 13.7 + id.y * 311.1 + seed);
  float alive = step(1.0 - (0.3 + 0.45 * amount) * min(1.0, speed * 1.6), n.z);
  float x = st.x - (n.x - 0.5) * 0.45;
  float along = st.y - (n.y - 0.5) * 0.3;
  float hd = length(vec2(x * 1.25, along * 0.9));
  float head = smoothstep(0.22, 0.15, hd);
  // trail behind the head (toward the centre), thinning out
  float tw = mix(0.07, 0.025, clamp(-along * 2.0, 0.0, 1.0));
  float trail = smoothstep(tw, tw * 0.4, abs(x)) * smoothstep(-0.5, -0.05, along) * step(along, 0.0) * 0.7;
  float m = max(head, trail) * alive * smoothstep(0.06, 0.22, r);
  if (m <= 0.0) return vec4(0.0);
  vec2 dir = q / r;
  vec2 tang = vec2(-dir.y, dir.x);
  vec2 off = (-dir * along * 0.05 - tang * x * 0.06) * (head > trail ? 1.0 : 0.5);
  return vec4(off / vec2(aspect, 1.0), m, head > trail ? clamp(hd / 0.22, 0.0, 1.0) : 0.6);
}

float lr_n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lr_h21(i), lr_h21(i + vec2(1.0, 0.0)), f.x), mix(lr_h21(i + vec2(0.0, 1.0)), lr_h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // heat shimmer (weather): hot air rising off the asphalt wobbles everything 30 m … 3 km away
  vec3 col0 = inputColor.rgb;
  if (shimmer > 0.001) {
    float vz = -getViewZ(depth);
    float k = shimmer * smoothstep(25.0, 110.0, vz) * (1.0 - smoothstep(900.0, 3500.0, vz));
    if (k > 0.001) {
      vec2 q = vec2(uv.x * aspect * 240.0, uv.y * 160.0 - time * 6.5);
      float n = lr_n2(q) + 0.5 * lr_n2(q * 2.3 + vec2(3.7, -time * 4.0)) - 0.75;
      col0 = texture2D(inputBuffer, uv + vec2(n * 0.3, n) * k * 0.0021).rgb;
    }
  }
  if (amount < 0.001) {
    outputColor = vec4(col0, inputColor.a);
    return;
  }
  vec4 a = lr_static(uv, 6.0, 1.0, 0.2 + 0.55 * amount);
  vec4 b = lr_static(uv + 0.37, 11.0, 7.0, 0.2 + 0.6 * amount);
  vec4 c = lr_static(uv + 0.71, 21.0, 13.0, 0.35 * amount);
  vec4 s = speed > 0.02 ? lr_stream(uv, 3.0) : vec4(0.0);
  // the airflow wipes sitting drops away at speed
  float keep = 1.0 - 0.75 * speed;
  vec4 best = vec4(a.xy, a.z * keep, a.w);
  if (b.z * keep > best.z) best = vec4(b.xy, b.z * keep, b.w);
  if (c.z * keep > best.z) best = vec4(c.xy, c.z * keep, c.w);
  if (s.z > best.z) best = s;
  float m = best.z * min(1.0, amount * 1.4);
  vec3 col = col0;
  // a thin film of water softens the image in heavy rain
  if (amount > 0.3) {
    vec2 px = vec2(1.5 / 1920.0 * aspect, 1.5 / 1080.0) * amount;
    vec3 soft = (texture2D(inputBuffer, uv + px).rgb + texture2D(inputBuffer, uv - px).rgb
               + texture2D(inputBuffer, uv + vec2(px.x, -px.y)).rgb + texture2D(inputBuffer, uv + vec2(-px.x, px.y)).rgb) * 0.25;
    col = mix(col, soft, (amount - 0.3) * 0.6);
  }
  if (m > 0.001) {
    vec2 tuv = clamp(uv + best.xy, 0.001, 0.999);
    vec3 refr = (texture2D(inputBuffer, tuv).rgb * 2.0
               + texture2D(inputBuffer, clamp(tuv + vec2(0.002, 0.0), 0.001, 0.999)).rgb
               + texture2D(inputBuffer, clamp(tuv - vec2(0.0, 0.002), 0.001, 0.999)).rgb) * 0.25;
    // dark refracting rim, slightly brighter lensing core
    float rim = smoothstep(0.55, 1.0, best.w);
    refr *= (1.0 - 0.55 * rim) * 1.08;
    col = mix(col, refr, m);
  }
  outputColor = vec4(col, inputColor.a);
}
`;

class LensRainEffect extends Effect {
  constructor() {
    super('LensRainEffect', LENS_RAIN_FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['amount', new THREE.Uniform(0)],
        ['speed', new THREE.Uniform(0)],
        ['time', new THREE.Uniform(0)],
        ['shimmer', new THREE.Uniform(0)],
      ]),
    });
  }
  override update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt: number) {
    this.uniforms.get('time')!.value += dt ?? 0.016;
  }
}

/**
 * Sun shafts (god rays): a quarter-resolution mask of bright sky near the sun
 * (depth = far plane), blurred radially toward the sun's screen position in two
 * passes, then added to the HDR image before bloom. Trees and grandstands cut
 * the light into beams at golden hour.
 */
const SHAFT_MASK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 sunUv;
uniform float aspect;
uniform float threshold;
void main() {
  vec2 px = vec2( dFdx( vUv.x ), dFdy( vUv.y ) ) * 0.5;
  float sky = 0.0;
  vec3 c = vec3( 0.0 );
  for ( int i = 0; i < 4; i++ ) {
    vec2 o = vec2( i == 1 || i == 3 ? px.x : -px.x, i >= 2 ? px.y : -px.y );
    float d = texture2D( tDepth, vUv + o ).r;
    float s = step( 0.99999, d );
    sky += s;
    vec3 t = texture2D( tColor, vUv + o ).rgb;
    if ( t.r != t.r || t.g != t.g || t.b != t.b ) t = vec3( 0.0 );
    c += min( max( t, 0.0 ), vec3( 200.0 ) ) * s;
  }
  c *= 0.25;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec2 dv = ( vUv - sunUv ) * vec2( aspect, 1.0 );
  float lobe = exp( -dot( dv, dv ) * 5.0 );
  float k = smoothstep( threshold, threshold * 3.0, l );
  gl_FragColor = vec4( min( c, vec3( 30.0 ) ) * k * lobe, 1.0 );
}
`;

const SHAFT_BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 sunUv;
uniform float stepScale;
void main() {
  vec2 d = ( sunUv - vUv ) * stepScale / 24.0;
  vec2 uv = vUv;
  vec3 acc = vec3( 0.0 );
  float w = 1.0;
  float wsum = 0.0;
  for ( int i = 0; i < 24; i++ ) {
    acc += texture2D( tIn, uv ).rgb * w;
    wsum += w;
    w *= 0.955;
    uv += d;
  }
  gl_FragColor = vec4( acc / wsum, 1.0 );
}
`;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

class SunShaftsEffect extends Effect {
  private depth: THREE.Texture | null = null;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private maskMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly sunUv = new THREE.Vector2(0.5, 0.5);
  strength = 0;
  active = false;

  constructor() {
    super('SunShaftsEffect', /* glsl */ `
      uniform sampler2D tShafts;
      uniform float shaftStrength;
      uniform float flare;
      uniform vec2 flareUv;
      uniform vec3 flareColor;
      // lens flare: ghosts of the sun reflected between the lens elements, strung along the
      // line through the image centre, each a soft aperture-shaped disc with a coloured rim;
      // the sun's visibility (how much of it the trees, stands and cars cover) scales them
      float ghost(vec2 uv, vec2 c, float r, float soft) {
        vec2 d = (uv - c) * vec2(aspect, 1.0);
        // hexagonal aperture
        vec2 a = abs(d);
        float hex = max(a.x * 0.866 + a.y * 0.5, a.y);
        return 1.0 - smoothstep(r * (1.0 - soft), r, hex);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 col = inputColor.rgb + texture2D(tShafts, uv).rgb * shaftStrength;
        if (flare > 0.001) {
          float vis = 0.0;
          for (int i = 0; i < 9; i++) {
            vec2 o = vec2(float(i % 3) - 1.0, float(i / 3) - 1.0) * vec2(0.006 / aspect, 0.006);
            vis += step(0.99999, readDepth(flareUv + o));
          }
          vis /= 9.0;
          if (vis > 0.0) {
            vec2 axis = vec2(0.5) - flareUv;
            vec3 g = vec3(0.0);
            g += ghost(uv, flareUv + axis * 0.45, 0.022, 0.7) * vec3(0.9, 0.7, 0.35) * 0.5;
            g += ghost(uv, flareUv + axis * 0.8, 0.05, 0.5) * vec3(0.35, 0.6, 0.5) * 0.22;
            g += ghost(uv, flareUv + axis * 1.3, 0.035, 0.6) * vec3(0.55, 0.45, 0.8) * 0.32;
            g += ghost(uv, flareUv + axis * 1.65, 0.085, 0.4) * vec3(0.3, 0.45, 0.6) * 0.12;
            g += ghost(uv, flareUv + axis * 2.1, 0.014, 0.8) * vec3(0.8, 0.6, 0.4) * 0.6;
            // a faint halo ring centred on the image axis
            float rr = length((uv - vec2(0.5)) * vec2(aspect, 1.0));
            float ring = exp(-pow((rr - 0.42) * 16.0, 2.0)) * 0.018;
            vec2 sd = (uv - flareUv) * vec2(aspect, 1.0);
            // veiling glare close to the sun (the lens's own scatter)
            float veil = exp(-length(sd) * 7.0) * 0.18;
            col += flareColor * (g + ring * vec3(0.7, 0.8, 1.0) + veil) * flare * vis;
          }
        }
        outputColor = vec4(col, inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tShafts', new THREE.Uniform(null)],
        ['shaftStrength', new THREE.Uniform(0)],
        ['flare', new THREE.Uniform(0)],
        ['flareUv', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['flareColor', new THREE.Uniform(new THREE.Vector3(1, 0.95, 0.85))],
      ]),
    });
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.maskMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: SHAFT_MASK_FRAG,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        sunUv: { value: this.sunUv },
        aspect: { value: 1 },
        threshold: { value: 1.2 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: SHAFT_BLUR_FRAG,
      uniforms: { tIn: { value: null }, sunUv: { value: this.sunUv }, stepScale: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMat);
    this.quad.frustumCulled = false;
    this.uniforms.get('tShafts')!.value = this.rtB.texture;
  }
  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }
  override setSize(width: number, height: number) {
    const w = Math.max(4, Math.round(width / 4));
    const h = Math.max(4, Math.round(height / 4));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.maskMat.uniforms.aspect.value = width / Math.max(1, height);
  }
  /** lens flare strength (0 = off), set per frame with the sun's screen position */
  flare = 0;
  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.get('flare')!.value = this.active && this.depth !== null ? this.flare : 0;
    (this.uniforms.get('flareUv')!.value as THREE.Vector2).copy(this.sunUv);
    const on = this.active && this.strength > 0.002 && this.depth !== null;
    this.uniforms.get('shaftStrength')!.value = on ? this.strength : 0;
    if (!on) return;
    const prev = renderer.getRenderTarget();
    this.maskMat.uniforms.tColor.value = inputBuffer.texture;
    this.maskMat.uniforms.tDepth.value = this.depth;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tIn.value = this.rtA.texture;
    this.blurMat.uniforms.stepScale.value = 0.55;
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.quad, this.cam);
    this.blurMat.uniforms.tIn.value = this.rtB.texture;
    this.blurMat.uniforms.stepScale.value = 0.18;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    // final result lives in rtA → swap so the effect reads it
    this.uniforms.get('tShafts')!.value = this.rtA.texture;
    renderer.setRenderTarget(prev);
  }
  set threshold(v: number) {
    this.maskMat.uniforms.threshold.value = v;
  }
}

const GRADE_FRAG = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform vec3 tint;
uniform vec3 shadowTint;
uniform float lookExposure;
uniform float lookSaturation;
uniform float lookContrast;
uniform vec3 lookTint;
uniform vec3 lookShadowTint;
uniform float flash;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0) * exposure * lookExposure * (1.0 + flash);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split toning: shadows toward shadowTint, highlights toward tint
  float hl = smoothstep(0.02, 0.6, l);
  c *= mix(shadowTint * lookShadowTint, tint * lookTint, hl);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation * lookSaturation);
  // vibrance: lift the muted colours (grass, sky, liveries in the shade) more than the already vivid
  // ones, so the picture has the broadcast punch without clipping a red car into a flat blob
  float cMax = max(c.r, max(c.g, c.b));
  float cSat = (cMax - min(c.r, min(c.g, c.b))) / max(cMax, 1e-4);
  c = mix(vec3(l), c, 1.0 + 0.16 * (1.0 - cSat) * saturation);
  c = pow(max(c, 0.0) / 0.18, vec3(contrast * lookContrast)) * 0.18;
  outputColor = vec4(c, inputColor.a);
}
`;

export interface GradeLook {
  exposure: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  shadowTint: [number, number, number];
}

/**
 * Colour grade with two multiplied layers: `set()` is the game's layer
 * (flashback desaturation, menus, dev pages), `setLook()` is the weather/time
 * look written by the Environment every frame. `flash` brightens everything
 * for a lightning strike.
 */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['lookExposure', new THREE.Uniform(1)],
        ['lookSaturation', new THREE.Uniform(1.05)],
        ['lookContrast', new THREE.Uniform(1.04)],
        ['lookTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['lookShadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['flash', new THREE.Uniform(0)],
      ]),
    });
  }
  set(opts: { exposure?: number; saturation?: number; contrast?: number; tint?: THREE.ColorRepresentation; shadowTint?: THREE.ColorRepresentation }) {
    const u = this.uniforms;
    if (opts.exposure !== undefined) u.get('exposure')!.value = opts.exposure;
    if (opts.saturation !== undefined) u.get('saturation')!.value = opts.saturation;
    if (opts.contrast !== undefined) u.get('contrast')!.value = opts.contrast;
    if (opts.tint !== undefined) {
      const c = new THREE.Color(opts.tint);
      (u.get('tint')!.value as THREE.Vector3).set(c.r, c.g, c.b);
    }
    if (opts.shadowTint !== undefined) {
      const c = new THREE.Color(opts.shadowTint);
      (u.get('shadowTint')!.value as THREE.Vector3).set(c.r, c.g, c.b);
    }
  }
  /** the weather/time-of-day layer (tints are linear RGB multipliers) */
  setLook(l: GradeLook) {
    const u = this.uniforms;
    u.get('lookExposure')!.value = l.exposure;
    u.get('lookSaturation')!.value = l.saturation;
    u.get('lookContrast')!.value = l.contrast;
    (u.get('lookTint')!.value as THREE.Vector3).set(...l.tint);
    (u.get('lookShadowTint')!.value as THREE.Vector3).set(...l.shadowTint);
  }
  set flash(v: number) {
    this.uniforms.get('flash')!.value = v;
  }
  get exposure() {
    return this.uniforms.get('exposure')!.value as number;
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly ao: N8AOPostPass;
  readonly bloom: BloomEffect;
  readonly grade: GradeEffect;
  readonly toneMapping: ToneMappingEffect;
  readonly vignette: VignetteEffect;
  readonly grain: NoiseEffect;
  readonly aberration: ChromaticAberrationEffect;
  readonly dof: DepthOfFieldEffect;
  /** the one-pass depth AO (High and below; Ultra runs N8AO instead) */
  readonly ssao: AOEffect;

  private readonly radial: RadialBlurEffect;
  private readonly radialPass: EffectPass;
  private readonly motion: MotionBlurEffect;
  private readonly motionPass: EffectPass;
  private readonly onboard: OnboardEffect;
  private readonly onboardPass: EffectPass;
  private readonly caPass: EffectPass;
  private readonly dofPass: EffectPass;
  private readonly lensRain: LensRainEffect;
  private readonly lensPass: EffectPass;
  private readonly shafts: SunShaftsEffect;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private quality: QualityLevel = 'high';
  private renderScale = 1;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private sunShaftStrength = 0;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();
  private readonly tmpF2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: QualityLevel = 'high') {
    this.scene = scene;
    this.camera = camera;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      logarithmicDepthBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    // shadow-pass hooks (perf: far cars swap in a one-mesh silhouette just for the shadow maps)
    const sm = this.renderer.shadowMap as unknown as { render: (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => void };
    const shadowRender = sm.render.bind(sm);
    sm.render = (lights, scene, camera) => {
      const hooks = this.shadowHooks;
      if (lights.length === 0 || hooks.length === 0) return shadowRender(lights, scene, camera);
      for (let i = 0; i < hooks.length; i++) hooks[i](true);
      try {
        shadowRender(lights, scene, camera);
      } finally {
        for (let i = 0; i < hooks.length; i++) hooks[i](false);
      }
    };
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    // Apple's tile-based GPUs report timer-query times that run well past the real frame time
    // (≈20 ms on an M1 holding a steady 60 fps): the adaptive resolution must not believe them
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.gpuName = gpuName;
    this.timerTrusted = !/apple|m1|m2|m3|m4/i.test(gpuName);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    // contact-scale AO: cars on the asphalt, wheels in their arches, barrier feet, stands, trunks
    this.ao.configuration.aoRadius = 1.4;
    this.ao.configuration.distanceFalloff = 1.0;
    this.ao.configuration.intensity = 2.4;
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.depthAwareUpsampling = true;
    this.ao.configuration.color = new THREE.Color(0x0a0a0c);
    this.ao.setQualityMode('Medium');
    this.composer.addPass(this.ao);

    this.motion = new MotionBlurEffect();
    this.motionPass = new EffectPass(camera, this.motion);
    this.motionPass.enabled = false;
    this.composer.addPass(this.motionPass);

    this.onboard = new OnboardEffect();
    this.onboardPass = new EffectPass(camera, this.onboard);
    this.onboardPass.enabled = false;
    this.composer.addPass(this.onboardPass);

    this.radial = new RadialBlurEffect();
    this.radialPass = new EffectPass(camera, this.radial);
    this.radialPass.enabled = false;
    this.composer.addPass(this.radialPass);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 5, bokehScale: 2.5, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.lensRain = new LensRainEffect();
    this.lensPass = new EffectPass(camera, this.lensRain);
    this.lensPass.enabled = false;
    this.composer.addPass(this.lensPass);

    this.shafts = new SunShaftsEffect();
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.1,
      luminanceSmoothing: 0.35,
      intensity: 0.9,
      radius: 0.62,
    });
    this.grade = new GradeEffect();
    // Khronos PBR Neutral: base colours come out as painted (a Ferrari red stays red, not
    // AgX's salmon), with a filmic roll-off only in the highlights; the weather look adds a touch
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    // a soft lens fall-off that pulls the eye to the centre (strong enough to feel, never a filter)
    this.vignette = new VignetteEffect({ darkness: 0.38, offset: 0.3 });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.grain.blendMode.opacity.value = 0.02;
    // (the NaN scrub runs first inside this pass rather than as a pass of its own — one full-screen
    // copy less; bloom's luminance pre-pass and the shaft mask scrub what they read themselves)
    const lum = this.bloom.luminanceMaterial as unknown as THREE.ShaderMaterial;
    lum.fragmentShader = lum.fragmentShader.replace(
      'vec4 texel=texture2D(inputBuffer,vUv);',
      'vec4 texel=texture2D(inputBuffer,vUv);if(texel.r!=texel.r||texel.g!=texel.g||texel.b!=texel.b||max(max(abs(texel.r),abs(texel.g)),abs(texel.b))>1e6)texel.rgb=vec3(0.0);texel.rgb=min(max(texel.rgb,0.0),vec3(200.0));',
    );
    this.ssao = new AOEffect();
    this.composer.addPass(new EffectPass(camera, new SanitizeEffect(), this.ssao, this.shafts, this.bloom, this.grade, this.toneMapping, this.vignette, this.grain));

    this.aberration = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.4,
    });
    this.caPass = new EffectPass(camera, this.aberration);
    this.caPass.enabled = false;
    this.composer.addPass(this.caPass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.smaaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.smaaPass);
    this.sharpen = new SharpenEffect();
    this.sharpenPass = new EffectPass(camera, this.sharpen);
    this.composer.addPass(this.sharpenPass);

    this.setQuality(quality);
  }

  // ------------------------------------------------------------------ perf plumbing

  private readonly smaa: SMAAEffect;
  private readonly sharpen: SharpenEffect;
  private readonly sharpenPass: EffectPass;
  private readonly smaaPass: EffectPass;
  private readonly shadowHooks: ((on: boolean) => void)[] = [];
  /** run `fn(true)` right before the shadow maps render and `fn(false)` right after (every renderer.render) */
  onShadowPass(fn: (on: boolean) => void): () => void {
    this.shadowHooks.push(fn);
    return () => {
      const i = this.shadowHooks.indexOf(fn);
      if (i >= 0) this.shadowHooks.splice(i, 1);
    };
  }

  private readonly timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  /** the GPU's name (WebGL renderer string) */
  readonly gpuName: string;
  /** timer-query results match reality on this GPU (not on Apple silicon) */
  readonly timerTrusted: boolean;
  private readonly gpuQueries: WebGLQuery[] = [];
  private gpuActive: WebGLQuery | null = null;
  /** GPU time (ms) of the most recent frame whose timer result came back; NaN without the timer extension */
  gpuMs = NaN;
  /** called with every GPU frame time that comes back (dev tools, the adaptive quality) */
  onGpuTime: ((ms: number) => void) | null = null;
  private gpuRecent: number[] = [];
  /** the GPU frame times that came back since the last call */
  takeGpuSamples(): number[] {
    const a = this.gpuRecent;
    this.gpuRecent = [];
    return a;
  }
  get hasGpuTimer() {
    return this.timerExt !== null;
  }
  /** start timing one frame's GPU work (pair with gpuFrameEnd; results arrive a few frames later) */
  gpuFrameBegin() {
    const ext = this.timerExt;
    if (!ext || this.gpuActive || this.gpuQueries.length > 6) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.gpuActive = q;
  }
  gpuFrameEnd() {
    const ext = this.timerExt;
    if (!ext) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (this.gpuActive) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.gpuQueries.push(this.gpuActive);
      this.gpuActive = null;
    }
    while (this.gpuQueries.length && gl.getQueryParameter(this.gpuQueries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.gpuQueries.shift()!;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.gpuMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        if (this.gpuRecent.length < 240) this.gpuRecent.push(this.gpuMs);
        this.onGpuTime?.(this.gpuMs);
      }
      gl.deleteQuery(q);
    }
  }

  /**
   * Compile the post chain's occasional passes (speed blur, depth of field, lens rain,
   * chromatic aberration) now, so their first use mid-race doesn't stall a frame.
   */
  warmPasses() {
    const was = [this.radialPass.enabled, this.dofPass.enabled, this.lensPass.enabled, this.caPass.enabled, this.motionPass.enabled, this.onboardPass.enabled];
    const dofTarget = this.dof.target;
    const strength = this.radial.strength;
    this.radialPass.enabled = this.dofPass.enabled = this.lensPass.enabled = this.caPass.enabled = this.motionPass.enabled = this.onboardPass.enabled = true;
    this.radial.strength = 0.01;
    this.composer.render(0.016);
    this.radial.strength = strength;
    this.radialPass.enabled = was[0];
    this.dofPass.enabled = was[1];
    this.lensPass.enabled = was[2];
    this.caPass.enabled = was[3];
    this.motionPass.enabled = was[4];
    this.onboardPass.enabled = was[5];
    this.dof.target = dofTarget;
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    for (const p of this.composer.passes) {
      (p as unknown as { mainCamera: THREE.Camera }).mainCamera = camera;
    }
    this.ao.camera = camera;
    this.renderPass.mainCamera = camera;
    this.resize();
  }

  setScene(scene: THREE.Scene) {
    this.scene = scene;
    for (const p of this.composer.passes) {
      (p as unknown as { mainScene: THREE.Scene }).mainScene = scene;
    }
    this.ao.scene = scene;
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    // each preset's starting pixel ratio, and the ceiling the dynamic resolution may climb to when the
    // GPU has room (High renders one pixel per CSS pixel and rises toward 1.5 on Retina screens —
    // most of the gap to a console-sharp image; the adaptive scale backs off again if frames run long)
    this.renderScale = { low: Math.min(dpr, 1) * 0.75, medium: Math.min(dpr, 1), high: Math.min(dpr, 1), ultra: Math.min(dpr, 1.5) }[q];
    const ceiling = { low: this.renderScale, medium: this.renderScale, high: Math.min(dpr, 1.5), ultra: Math.min(dpr, 2) }[q];
    this.maxDynamic = ceiling / this.renderScale;
    this.minDynamic = { low: 0.5, medium: 0.65, high: 0.8, ultra: 0.8 }[q];
    const preset = q === 'ultra' || q === 'high' ? SMAAPreset.HIGH : q === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.LOW;
    if (preset !== this.smaaPreset) {
      this.smaaPreset = preset;
      this.smaa.applyPreset(preset);
    }
    // AO costs ~3 ms at 1080p whatever its tier (measured again: ~15–20 % of a High frame, even
    // half-res with 8 samples), so it stays an Ultra feature; High gets its contact darkening
    // from the materials (terrain canopy AO, crown AO) and the focus shadow cascade
    this.ao.enabled = q === 'ultra';
    this.ssao.intensity = q === 'ultra' || q === 'low' ? 0 : q === 'medium' ? 0.7 : 1.0;
    this.ao.configuration.halfRes = true;
    this.ao.setQualityMode('Medium');
    // (the last enabled pass must be the one that renders to the screen)
    const sharpenOn = q === 'ultra' || q === 'high';
    this.sharpenPass.enabled = sharpenOn;
    this.sharpenPass.renderToScreen = sharpenOn;
    this.upscaleOn = sharpenOn;
    this.smaaPass.renderToScreen = !sharpenOn;
    this.renderer.shadowMap.enabled = true;
    this.shafts.active = q !== 'low';
    this.dynamicScale = 1;
    this.resize();
  }

  /**
   * Dynamic resolution: the game nudges this down when frames run long and
   * back up when there's headroom. Multiplies the preset's pixel ratio.
   */
  dynamicScale = 1;
  /**
   * The dynamic scale's range for the current preset. High and Ultra never drop below 0.8:
   * a soft, smeary picture looks far worse than a few frames a second fewer (on a Retina
   * screen the old 0.5 floor rendered a quarter of the CSS pixels — a sixteenth of the panel's).
   */
  minDynamic = 0.8;
  maxDynamic = 1;
  private smaaPreset: SMAAPreset = SMAAPreset.HIGH;
  setDynamicScale(s: number) {
    const v = THREE.MathUtils.clamp(s, this.minDynamic, this.maxDynamic);
    if (Math.abs(v - this.dynamicScale) < 0.001) return;
    this.dynamicScale = v;
    // sharpen harder when the image is being upscaled
    this.sharpen.sharpness = THREE.MathUtils.clamp(0.5 + (1 - v) * 0.4, 0.5, 0.7);
    this.resize();
  }

  get qualityLevel() {
    return this.quality;
  }

  /** 0 → off. ~0.02 is a strong blur. */
  setSpeedBlur(strength: number) {
    this.radial.strength = strength > 0.0008 ? strength : 0;
    this.radialPass.enabled = this.radial.strength > 0 || this.radial.aberration > 0;
  }

  /** lateral chromatic aberration (shares the speed-blur pass) */
  setAberration(offset: number) {
    this.radial.aberration = offset > 0.00003 ? offset : 0;
    this.radialPass.enabled = this.radial.strength > 0 || this.radial.aberration > 0;
  }

  /**
   * Water on the lens for onboard cameras: 0 = dry … 1 = soaked. `speed` 0 … 1
   * makes the drops stream outward (defaults to following `amount`).
   */
  setLensRain(amount: number, speed?: number) {
    const a = THREE.MathUtils.clamp(amount, 0, 1);
    this.lensAmount = a;
    this.lensPass.enabled = a > 0.01 || this.shimmer > 0.01;
    this.lensRain.uniforms.get('amount')!.value = a;
    this.lensRain.uniforms.get('speed')!.value = THREE.MathUtils.clamp(speed ?? a, 0, 1);
  }

  private lensAmount = 0;
  private shimmer = 0;
  /** heat haze over hot asphalt, 0 … 1 (weather; shares the lens pass) */
  setHeatShimmer(amount: number) {
    const k = THREE.MathUtils.clamp(amount, 0, 1);
    if (Math.abs(k - this.shimmer) < 0.002) return;
    this.shimmer = k;
    this.lensRain.uniforms.get('shimmer')!.value = k;
    this.lensPass.enabled = this.lensAmount > 0.01 || k > 0.01;
  }

  /** lightning: 0 … 1 exposure punch for this frame */
  setFlash(intensity: number) {
    this.grade.flash = Math.max(0, intensity) * 1.6;
  }
  /** alias of setFlash */
  flash(intensity: number) {
    this.setFlash(intensity);
  }

  /** sun shafts: world direction toward the sun, strength (0 = off), sky-brightness threshold */
  setSunShafts(dir: THREE.Vector3, strength: number, threshold = 1.2) {
    this.sunDir.copy(dir).normalize();
    this.sunShaftStrength = strength;
    this.shafts.threshold = threshold;
  }

  /** Bokeh DOF for menus/replays. With a target the focus follows it (autofocus). */
  setDepthOfField(on: boolean, target: THREE.Vector3 | null = null, range = 5, bokeh = 2.5) {
    this.dofPass.enabled = on;
    this.dof.target = on ? target : null;
    if (on) {
      (this.dof.cocMaterial as unknown as { focusRange: number }).focusRange = range;
      this.dof.bokehScale = bokeh;
    }
  }

  /**
   * The frame renders at renderScale × dynamicScale pixels per CSS pixel; on High and Ultra the
   * canvas itself is the display's native resolution and the final pass (bicubic + CAS) does the
   * upscale — far crisper on a Retina screen than the browser stretching a small canvas.
   */
  private upscaleOn = false;
  /** the final pass upscales to the display's native resolution (High/Ultra); the frame-rate governor may turn it off */
  get nativeUpscale() {
    return this.upscaleOn;
  }
  set nativeUpscale(on: boolean) {
    if (on === this.upscaleOn) return;
    this.upscaleOn = on;
    this.resize();
  }
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const internal = this.renderScale * this.dynamicScale;
    const native = Math.min(window.devicePixelRatio || 1, 2);
    const out = this.upscaleOn ? Math.max(internal, native) : internal;
    this.renderer.setPixelRatio(out);
    this.composer.setSize(w, h);
    const iw = Math.max(1, Math.round(w * internal));
    const ih = Math.max(1, Math.round(h * internal));
    // (for code that sizes its own buffers off "the frame": the internal size, not the canvas)
    (this.renderer as unknown as { apexFrame: { w: number; h: number } }).apexFrame = { w: iw, h: ih };
    if (out > internal + 1e-3) {
      this.composer.inputBuffer.setSize(iw, ih);
      this.composer.outputBuffer.setSize(iw, ih);
      for (const p of this.composer.passes) p.setSize(iw, ih);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  /** the internal frame size in pixels (what the scene renders at, before the upscale) */
  get frameSize(): { w: number; h: number } {
    const k = this.renderScale * this.dynamicScale;
    return { w: Math.round(window.innerWidth * k), h: Math.round(window.innerHeight * k) };
  }

  /** lens flare scale (weather sets it: the sun's radiance × how clear it is; 0 = off) */
  flareStrength = 0;
  setFlareColor(r: number, g: number, b: number) {
    (this.shafts.uniforms.get('flareColor')!.value as THREE.Vector3).set(r, g, b);
  }
  /** indoors (the garage): no sun shafts or lens flare, whatever the sky outside is doing */
  indoor = false;
  private updateShafts() {
    let k = 0;
    let fl = 0;
    if (!this.indoor && (this.flareStrength > 0.002 || this.sunShaftStrength > 0.002)) {
      const cam = this.camera;
      const p = this.tmpV.copy(this.sunDir).multiplyScalar(1000).add(cam.position);
      p.project(cam);
      // behind the camera?
      const fwd = cam.getWorldDirection(this.tmpF);
      const facing = fwd.dot(this.sunDir);
      if (facing > 0.05) {
        const u = p.x * 0.5 + 0.5;
        const v = p.y * 0.5 + 0.5;
        this.shafts.sunUv.set(u, v);
        const off = Math.max(Math.abs(p.x), Math.abs(p.y));
        // (THREE.MathUtils.smoothstep takes (x, min, max) — the GLSL order here used to zero the shafts)
        const ss = THREE.MathUtils.smoothstep;
        k = this.sunShaftStrength * (1 - ss(off, 1.0, 1.9)) * ss(facing, 0.05, 0.35);
        // the flare needs the sun itself in frame (its depth sample decides the occlusion)
        fl = this.flareStrength * (1 - ss(off, 0.85, 1.0)) * ss(facing, 0.3, 0.6);
      }
    }
    this.shafts.strength = k;
    this.shafts.flare = fl;
  }

  render(dt: number) {
    this.renderer.info.reset();
    this.ssao.setCamera(this.camera);
    this.updateShafts();
    this.updateScene();
    this.updateMotion(dt);
    this.updateOnboard();
    this.composer.render(dt);
  }

  /** the car an onboard camera rides in (null = not onboard): its own cockpit is shaded and defocused */
  onboardCar: THREE.Object3D | null = null;
  private updateOnboard() {
    const own = this.onboardCar;
    this.onboardPass.enabled = own !== null;
    if (!own) return;
    const u = this.onboard.uniforms;
    (u.get('projInv')!.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.get('camWorld')!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    (u.get('ownInv')!.value as THREE.Matrix4).copy(own.matrixWorld).invert();
  }

  /**
   * Camera motion blur: the shutter as a fraction of a 60 fps frame (0 = off, 0.5 = a film
   * camera's 180° shutter). Cuts and teleports skip a frame instead of smearing across the screen.
   */
  motionBlur = 0;
  /** the moving objects (car roots) the motion blur tracks this frame, nearest first; at most MOTION_CARS */
  readonly motionCars: THREE.Object3D[] = [];
  private readonly prevCar = new WeakMap<THREE.Object3D, { m: THREE.Matrix4; frame: number }>();
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly prevCamQ = new THREE.Quaternion();
  private prevCam: THREE.Camera | null = null;
  private motionFrame = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private updateMotion(dt: number) {
    const cam = this.camera;
    const frame = ++this.motionFrame;
    cam.updateMatrixWorld();
    const u = this.motion.uniforms;
    const camPos = this.tmpV.setFromMatrixPosition(cam.matrixWorld);
    const camQ = this.tmpQ.setFromRotationMatrix(cam.matrixWorld);
    let ok = this.motionBlur > 0.01 && this.prevCam === cam && dt > 0;
    // a cut (a new camera position or a whip around) has no motion to blur
    if (ok && (camPos.distanceTo(this.prevCamPos) > 20 || camQ.angleTo(this.prevCamQ) > 0.5)) ok = false;
    if (ok) {
      (u.get('projInv')!.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      (u.get('camWorld')!.value as THREE.Matrix4).copy(cam.matrixWorld);
      (u.get('prevViewProj')!.value as THREE.Matrix4).copy(this.prevViewProj);
      u.get('shutter')!.value = this.motionBlur * THREE.MathUtils.clamp(1 / 60 / dt, 0.5, 2);
      const inv = u.get('carInv')!.value as THREE.Matrix4[];
      const prev = u.get('carPrev')!.value as THREE.Matrix4[];
      let n = 0;
      for (const o of this.motionCars) {
        if (n >= MOTION_CARS) break;
        const p = this.prevCar.get(o);
        inv[n].copy(o.matrixWorld).invert();
        const fresh = p && p.frame === frame - 1;
        prev[n].copy(fresh ? p.m : o.matrixWorld);
        // a car that jumped (replay seek, reset to track) has no motion either
        if (fresh && this.tmpF.setFromMatrixPosition(p.m).distanceToSquared(this.tmpF2.setFromMatrixPosition(o.matrixWorld)) > 400) prev[n].copy(o.matrixWorld);
        n++;
      }
      u.get('carCount')!.value = n;
    }
    this.motionPass.enabled = ok;
    for (const o of this.motionCars) {
      const p = this.prevCar.get(o);
      if (p) {
        p.m.copy(o.matrixWorld);
        p.frame = frame;
      } else this.prevCar.set(o, { m: o.matrixWorld.clone(), frame });
    }
    this.prevViewProj.multiplyMatrices(cam.projectionMatrix, this.tmpM.copy(cam.matrixWorld).invert());
    this.prevCamPos.copy(camPos);
    this.prevCamQ.copy(camQ);
    this.prevCam = cam;
  }

  /**
   * three.js recomputes every object's world matrix each frame, visible or not: hidden subtrees
   * (the garage during a race, the pit crews' people until they are needed, parked cars, every
   * car's unused levels of detail) were ~11 k of the scene's ~13.5 k nodes, ~3 ms a frame. The
   * scene is updated here instead, skipping hidden subtrees; one that is shown again gets a full
   * refresh. (Code that reads a hidden object's position uses getWorldPosition/updateWorldMatrix,
   * which still work; objects with their own updateMatrixWorld — skinned meshes, cameras — get it.)
   */
  private readonly baseUpdate = THREE.Object3D.prototype.updateMatrixWorld;
  private readonly stale = new WeakSet<THREE.Object3D>();
  private updateScene() {
    const scene = this.scene;
    scene.matrixWorldAutoUpdate = false;
    this.updateVisible(scene, false);
  }
  private updateVisible(o: THREE.Object3D, force: boolean) {
    if (o.updateMatrixWorld !== this.baseUpdate) {
      o.updateMatrixWorld(force);
      return;
    }
    if (o.matrixAutoUpdate) o.updateMatrix();
    if (o.matrixWorldNeedsUpdate || force) {
      if (o.matrixWorldAutoUpdate || o === this.scene) {
        if (o.parent === null) o.matrixWorld.copy(o.matrix);
        else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      }
      o.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (!c.visible) {
        this.stale.add(c);
        continue;
      }
      this.updateVisible(c, this.stale.delete(c) || force);
    }
  }
}
