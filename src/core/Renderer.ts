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
import { MOTION_CARS, MotionBlurEffect } from './motionBlur';
import { AutoExposure } from './autoExposure';
import { OnboardEffect } from './onboard';
import { TAAPass, TAA_JITTER } from './taa';

export { MOTION_CARS };

/**
 * Renderer + post chain.
 *
 *   RenderPass (HDR, half float; sub-pixel jittered projection on High/Ultra)
 *   → N8AO (screen-space AO, world-radius; ultra)
 *   → TAA (temporal anti-aliasing, High/Ultra: taa.ts; replaces SMAA there) [own pass]
 *   → motion blur (camera + per-object, reconstructed from a velocity buffer: motionBlur.ts) [own pass]
 *   → onboard lens (eye cams: own cockpit shaded + defocused from both sides, outside exposed up: onboard.ts)
 *   → speed blur (radial, only while fast)      [own pass: convolution]
 *   → depth of field (trackside lenses, menus/replays) [own pass: convolution]
 *   → lens rain (onboard cameras in the wet)     [own pass: convolution]
 *   → sanitize (NaN/Inf scrub) → AO → sun shafts + lens flare / veiling glare → bloom (soft knee, warm
 *     halation) → grade (game layer × weather look × lightning flash × auto exposure: autoExposure.ts)
 *     → PBR Neutral → film print (black floor, shadow chroma, warm clip, sensor grain by the metered
 *     gain) → vignette
 *   → chromatic aberration (only while fast)     [own pass: convolution]
 *   → SMAA → lens + upscale + sharpen (barrel distortion and lateral CA by the field of view; light
 *     contrast-adaptive sharpening, softer toward the edges; High/Ultra)
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
 * The last pass: the lens and the upscale. Contrast-adaptive sharpening (after AMD's CAS) — a
 * negative-lobe cross filter whose strength backs off wherever the local contrast is already high,
 * so edges crisp up without halos and flat areas don't gain noise — undoes the softness of SMAA and
 * of a lowered render resolution, but only so far: real footage is a little soft (the optics, the
 * camera's own processing, the stream's compression), never a render's pixel-crisp, so it is held to
 * a light touch in the middle of the frame and eases off toward the edges, where a real lens is softer.
 * The lens itself: a wide onboard lens's barrel distortion (straight lines bow outward a touch; the
 * corners stay put and the middle is magnified slightly) and its lateral chromatic aberration (red
 * and blue are imaged at slightly different sizes: thin colour fringes on contrasty edges toward the
 * corners), both scaled by how wide the lens is — a long trackside lens is almost free of them.
 */
const SHARPEN_FRAG = /* glsl */ `
uniform float sharpness;
uniform float edgeSoft;
uniform float lensK;
uniform float lensCA;
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
void mainImage(const in vec4 inputColor, const in vec2 uv0, out vec4 outputColor) {
  // barrel distortion, normalised so the corners map to the corners
  vec2 q = (uv0 - 0.5) * vec2(aspect, 1.0);
  float r2 = dot(q, q);
  float rc2 = 0.25 * (aspect * aspect + 1.0);
  vec2 uv = 0.5 + (uv0 - 0.5) * (1.0 + lensK * r2) / (1.0 + lensK * rc2);
  float edge = r2 / rc2;
  vec3 mn, mx;
  vec3 c = cubic(uv, mn, mx);
  vec3 a = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
  vec3 b = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;
  vec3 d = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  vec3 lo = min(c, min(min(a, b), min(d, e)));
  vec3 hi = max(c, max(max(a, b), max(d, e)));
  vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
  vec3 w = -amp * mix(0.04, 0.2, sharpness) * (1.0 - edgeSoft * edge);
  vec3 o = (c + (a + b + d + e) * w) / (1.0 + 4.0 * w);
  // lateral chromatic aberration toward the corners (red imaged a touch larger, blue smaller): the
  // shift is a texel or two, so red and blue are moved along their own gradients (from the cross
  // taps above) instead of being fetched again — no extra reads at the display's full resolution
  if (lensCA > 0.0) {
    vec2 sh = (uv - 0.5) * lensCA * edge / texelSize;
    vec3 gx = (d - b) * 0.5;
    vec3 gy = (e - a) * 0.5;
    o.r += dot(sh, vec2(gx.r, gy.r));
    o.b -= dot(sh, vec2(gx.b, gy.b));
  }
  outputColor = vec4(clamp(o, 0.0, 1.0), inputColor.a);
}
`;

class SharpenEffect extends Effect {
  constructor() {
    super('SharpenEffect', SHARPEN_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['sharpness', new THREE.Uniform(0.4)],
        ['edgeSoft', new THREE.Uniform(0.75)],
        ['lensK', new THREE.Uniform(0)],
        ['lensCA', new THREE.Uniform(0)],
      ]),
    });
  }
  set sharpness(v: number) {
    this.uniforms.get('sharpness')!.value = v;
  }
  /** how much softer the sharpening is toward the corners (0 = even across the frame) */
  set edgeSoft(v: number) {
    this.uniforms.get('edgeSoft')!.value = v;
  }
  /** the lens: barrel distortion coefficient and lateral chromatic aberration (uv per unit radius) */
  setLens(k: number, ca: number) {
    this.uniforms.get('lensK')!.value = k;
    this.uniforms.get('lensCA')!.value = ca;
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
    // (rS is in uv-y units: the same world radius spans 1/aspect as much in u)
    vec2 o = vec2(cos(a) / aspect, sin(a)) * rS * sqrt(t);
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

// how much of the sun is in sight (a 3 × 3 cluster of depth samples round its disc reaching the sky)
const FLARE_VIS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform vec2 sunUv;
uniform float aspect;
void main() {
  float vis = 0.0;
  for (int i = 0; i < 9; i++) {
    vec2 o = vec2(float(i - (i / 3) * 3) - 1.0, float(i / 3) - 1.0) * vec2(0.006 / aspect, 0.006);
    vis += step(0.99999, texture2D(tDepth, sunUv + o).r);
  }
  gl_FragColor = vec4(vis / 9.0, 0.0, 0.0, 1.0);
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
      uniform sampler2D tFlareVis;
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
          // (how much of the sun the trees, stands and cars cover: one 1×1 pass a frame)
          float vis = texture2D(tFlareVis, vec2(0.5)).r;
          if (vis > 0.0) {
            vec2 axis = vec2(0.5) - flareUv;
            vec3 g = vec3(0.0);
            // (soft-edged and faint: a coated lens's ghosts are smudges of colour, not crisp shapes)
            g += ghost(uv, flareUv + axis * 0.45, 0.026, 0.95) * vec3(0.9, 0.7, 0.35) * 0.3;
            g += ghost(uv, flareUv + axis * 0.8, 0.055, 0.9) * vec3(0.35, 0.6, 0.5) * 0.14;
            g += ghost(uv, flareUv + axis * 1.3, 0.04, 0.9) * vec3(0.55, 0.45, 0.8) * 0.2;
            g += ghost(uv, flareUv + axis * 1.65, 0.09, 0.85) * vec3(0.3, 0.45, 0.6) * 0.08;
            g += ghost(uv, flareUv + axis * 2.1, 0.016, 0.95) * vec3(0.8, 0.6, 0.4) * 0.35;
            // a faint halo ring centred on the image axis
            float rr = length((uv - vec2(0.5)) * vec2(aspect, 1.0));
            float ring = exp(-pow((rr - 0.42) * 16.0, 2.0)) * 0.014;
            vec2 sd = (uv - flareUv) * vec2(aspect, 1.0);
            // veiling glare: the lens's own scatter, strong round the sun and a thin wash over the whole
            // frame (it lifts the shadows and flattens the contrast of everything shot into the light)
            float veil = exp(-length(sd) * 7.0) * 0.18 + exp(-length(sd) * 1.6) * 0.012 + 0.004;
            col += flareColor * (g + ring * vec3(0.7, 0.8, 1.0) + veil) * flare * vis;
          }
        }
        outputColor = vec4(col, inputColor.a);
      }`, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tShafts', new THREE.Uniform(null)],
        ['tFlareVis', new THREE.Uniform(null)],
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
    this.rtVis = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.visMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: FLARE_VIS_FRAG,
      uniforms: { tDepth: { value: null }, sunUv: { value: this.sunUv }, aspect: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.maskMat);
    this.quad.frustumCulled = false;
    this.uniforms.get('tShafts')!.value = this.rtB.texture;
    this.uniforms.get('tFlareVis')!.value = this.rtVis.texture;
  }
  private readonly rtVis: THREE.WebGLRenderTarget;
  private readonly visMat: THREE.ShaderMaterial;
  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }
  override setSize(width: number, height: number) {
    const w = Math.max(4, Math.round(width / 4));
    const h = Math.max(4, Math.round(height / 4));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.maskMat.uniforms.aspect.value = width / Math.max(1, height);
    this.visMat.uniforms.aspect.value = width / Math.max(1, height);
  }
  /** lens flare strength (0 = off), set per frame with the sun's screen position */
  flare = 0;
  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget) {
    const flareOn = this.active && this.depth !== null && this.flare > 0.001;
    this.uniforms.get('flare')!.value = flareOn ? this.flare : 0;
    (this.uniforms.get('flareUv')!.value as THREE.Vector2).copy(this.sunUv);
    const on = this.active && this.strength > 0.002 && this.depth !== null;
    this.uniforms.get('shaftStrength')!.value = on ? this.strength : 0;
    if (!on && !flareOn) return;
    const prev = renderer.getRenderTarget();
    if (flareOn) {
      this.visMat.uniforms.tDepth.value = this.depth;
      this.quad.material = this.visMat;
      renderer.setRenderTarget(this.rtVis);
      renderer.render(this.quad, this.cam);
    }
    if (!on) {
      renderer.setRenderTarget(prev);
      return;
    }
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
  /**
   * (perf) Queue the three inner passes' programs. They only run once the sun is in view, so they
   * were built synchronously in the middle of a lap (three links in one frame) the first time the
   * camera turned into the sun. Queued here they build on the driver's threads (compile, not render).
   */
  warm(renderer: THREE.WebGLRenderer) {
    const prev = renderer.getRenderTarget();
    const mat = this.quad.material;
    // (bound to one of its own targets: the programs are keyed for a linear target, as drawn)
    renderer.setRenderTarget(this.rtA);
    for (const m of [this.visMat, this.maskMat, this.blurMat]) {
      this.quad.material = m;
      renderer.compile(this.quad, this.cam);
    }
    this.quad.material = mat;
    renderer.setRenderTarget(prev);
  }
}

// the sim look's tone curve (Renderer.broadcast): ACES's RRT + ODT fit (Stephen Hill's), per channel
const SIM_TONE_GLSL = /* glsl */ `
vec3 simFilmic(vec3 c) {
  vec3 a = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  return clamp(a, 0.0, 1.0);
}
`;

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
uniform vec2 greenTame;
uniform sampler2D tAdapt;
uniform float adaptStrength;
uniform float sim;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // the camera's auto exposure: (reference / adapted)^strength, 1 in steady light (autoExposure.ts)
  float ae = 1.0;
  if (adaptStrength > 0.0) {
    vec2 ad = texture2D(tAdapt, vec2(0.5)).xy;
    ae = clamp(exp((ad.y - ad.x) * adaptStrength), 0.6, 1.9);
  }
  vec3 c = max(inputColor.rgb, 0.0) * exposure * lookExposure * (1.0 + flash) * ae;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // split toning: shadows toward shadowTint, highlights toward tint
  float hl = smoothstep(0.02, 0.6, l);
  vec3 tS = shadowTint * lookShadowTint;
  vec3 tH = tint * lookTint;
  // (the sim look, see Renderer.broadcast: a game camera is white-balanced to the light, not a
  // broadcast camera's warm sodium cast — most of the tints' colour goes, their brightness stays;
  // the warmth of a low sun is in the light itself, and the remaining 30 % keeps the hour's mood)
  tS = mix(tS, vec3(dot(tS, vec3(0.2126, 0.7152, 0.0722))), 0.7 * sim);
  tH = mix(tH, vec3(dot(tH, vec3(0.2126, 0.7152, 0.0722))), 0.7 * sim);
  c *= mix(tS, tH, hl);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // a camera's greens: foliage, grass and green paint come out olive and muted, never the pure
  // RGB green of a game render (x pulls them toward yellow, y toward grey; by how green they are)
  // (not in the sim look: ACC's Monza park is a rich, clean green)
  float gp = clamp((c.g - max(c.r, c.b)) / max(c.g, 1e-4), 0.0, 1.0) * (1.0 - sim);
  c.r += (c.g - c.r) * gp * greenTame.x;
  c = mix(c, vec3(l), gp * greenTame.y);
  // (the footage layer pulls the colour back to ~0.7 of the render's (Environment FILM.saturation);
  // the sim look gives most of it back: saturated but natural, the tone curve adds the rest)
  c = mix(vec3(l), c, saturation * lookSaturation * (1.0 + 0.32 * sim));
  // vibrance: lift the muted colours (grass, sky, liveries in the shade) more than the already vivid
  // ones, so the picture has the broadcast punch without clipping a red car into a flat blob
  float cMax = max(c.r, max(c.g, c.b));
  float cSat = (cMax - min(c.r, min(c.g, c.b))) / max(cMax, 1e-4);
  c = mix(vec3(l), c, 1.0 + 0.16 * (1.0 - cSat) * saturation);
  c = pow(max(c, 0.0) / 0.18, vec3(contrast * lookContrast)) * 0.18;
  outputColor = vec4(c, inputColor.a);
}
`;

/**
 * The print stage, after tone mapping (display-referred linear 0 … 1): what makes a frame read as
 * footage rather than a render. The blacks are crushed but never pure black (a camera's sensor floor
 * and the veiling flare inside the lens lift them to a dim, warm-tinted floor), the deepest shadows
 * lose their colour (a sensor's chroma noise is filtered out down there), and the brightest
 * highlights clip to a slightly warm white.
 *
 * Then the sensor's noise. A camera's grain lives in the dark-to-mid tones (shot noise; the crushed
 * black floor and the highlights stay clean), it is a little clumpy rather than per-pixel (the
 * camera's own noise reduction and the stream's compression smear it to 2–3 px), and it grows with
 * the gain: the darker the light the camera meters (the auto exposure's adapted level), the higher
 * its ISO — a sunny afternoon is all but clean, a wet morning or a night onboard is visibly noisy,
 * with a little colour in it.
 */
const FILM_FRAG = /* glsl */ `
uniform vec3 filmLift;
uniform float filmShadowSat;
uniform vec3 filmWhite;
uniform float filmGrain;
uniform float filmTime;
uniform sampler2D tAdapt;
uniform float adaptOn;
uniform float sim;
float fg_h(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // (the sim look prints clean: colour all the way into the shadows, a neutral white, and only a
  // quarter of the black floor — what is left is the wet day's veil of spray, which is real)
  c = mix(vec3(l), c, mix(mix(filmShadowSat, 1.0, sim), 1.0, smoothstep(0.0, 0.06, l)));
  vec3 lift = filmLift * (1.0 - 0.75 * sim);
  c = lift + c * (mix(filmWhite, vec3(1.0), sim) - lift);
  if (filmGrain > 0.0) {
    // the gain: ~0 in daylight, ~1 by a wet morning or a night (metered log luminance, pre-grade)
    // (sim look: no sensor gain — what is left of the grain is a faint dither that keeps the
    // sky's gradients from banding in 8 bits)
    float iso = (adaptOn > 0.5 ? smoothstep(-4.1, -5.8, texture2D(tAdapt, vec2(0.5)).x) : 0.3) * (1.0 - sim);
    // clumpy grain: this pixel's noise plus a coarser layer, both new every frame (in a
    // perceptual, square-root domain so it sits evenly across the tones)
    vec3 p = sqrt(c);
    float pl = dot(p, vec3(0.2126, 0.7152, 0.0722));
    float w = smoothstep(0.02, 0.14, pl) * (1.0 - 0.8 * smoothstep(0.25, 0.8, pl));
    if (w > 0.0) {
      vec2 fc = gl_FragCoord.xy;
      float t = floor(filmTime * 60.0);
      vec2 o = vec2(fract(t * 0.6180339) * 913.0, fract(t * 0.7548777) * 577.0);
      float h1 = fg_h(fc + o);
      float h2 = fg_h(floor(fc * 0.5) + o * 1.3);
      float n = (h1 - 0.5) * 0.8 + (h2 - 0.5) * 0.7;
      // (the colour noise rides on the coarse layer, decorrelated per channel)
      vec3 chroma = fract(h2 * vec3(7.31, 13.17, 3.93)) - 0.5;
      float a = filmGrain * (0.5 + 1.0 * iso) * w * (1.0 - 0.8 * sim);
      p += a * (n + chroma * 0.8 * iso);
      c = max(p, 0.0) * max(p, 0.0);
    }
  }
  outputColor = vec4(c, inputColor.a);
}
`;

export class FilmEffect extends Effect {
  constructor() {
    super('FilmEffect', FILM_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['filmLift', new THREE.Uniform(new THREE.Vector3(0.005, 0.0044, 0.0036))],
        ['filmShadowSat', new THREE.Uniform(0.6)],
        ['filmWhite', new THREE.Uniform(new THREE.Vector3(1.0, 0.985, 0.95))],
        ['filmGrain', new THREE.Uniform(0)],
        ['filmTime', new THREE.Uniform(0)],
        ['tAdapt', new THREE.Uniform(null)],
        ['adaptOn', new THREE.Uniform(0)],
        // (1 = the sim look; the live chain sets it from Renderer.broadcast, other users keep the footage)
        ['sim', new THREE.Uniform(0)],
      ]),
    });
  }
  override update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt?: number) {
    this.uniforms.get('filmTime')!.value = ((this.uniforms.get('filmTime')!.value as number) + (dt ?? 0.016)) % 1000;
  }
}

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
        ['greenTame', new THREE.Uniform(new THREE.Vector2(0.3, 0.3))],
        ['tAdapt', new THREE.Uniform(null)],
        ['adaptStrength', new THREE.Uniform(0)],
        // (1 = the sim look; the live chain sets it from Renderer.broadcast, other users keep the footage)
        ['sim', new THREE.Uniform(0)],
      ]),
    });
  }
  private auto: AutoExposure | null = null;
  /**
   * Meter the frame like a camera's auto exposure (0 = off): how much of a change in the view's
   * brightness (into shade, under a bridge, out into the sun) it compensates, after a beat.
   */
  setAutoExposure(strength: number) {
    if (strength > 0 && !this.auto) this.auto = new AutoExposure();
    this.uniforms.get('adaptStrength')!.value = this.auto ? strength : 0;
  }
  /** snap the auto exposure to the next frame (a camera cut) */
  resetAutoExposure() {
    this.auto?.reset();
  }
  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, dt?: number) {
    const a = this.auto;
    if (!a || (this.uniforms.get('adaptStrength')!.value as number) <= 0) return;
    a.update(renderer, inputBuffer.texture, dt ?? 0.016);
    this.uniforms.get('tAdapt')!.value = a.texture;
    for (const e of this.adaptLinks) {
      e.uniforms.get('tAdapt')!.value = a.texture;
      e.uniforms.get('adaptOn')!.value = 1;
    }
  }
  /** effects later in the chain that read the metered level too (their tAdapt / adaptOn uniforms) */
  readonly adaptLinks: Effect[] = [];
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
  /** the print stage after tone mapping: black floor, shadow chroma, warm clip */
  readonly film: FilmEffect;
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

    // (before the motion blur, as UE4 orders it: the blur then smears an image without stair-steps)
    this.taa = new TAAPass();
    this.composer.addPass(this.taa);

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
    // an in-focus band round the focus distance: postprocessing's circle of confusion grows from the exact
    // focus plane (smoothstep 0 → range), so on a long lens only a slice of the car was sharp — its nose
    // and wing went soft and the half-res CoC of the field behind bled over it. A real lens holds the
    // depth of field: the whole car (±focusHold m) stays sharp, the blur ramps up beyond it.
    {
      const coc = this.dof.cocMaterial as unknown as THREE.ShaderMaterial;
      coc.uniforms.focusHold = new THREE.Uniform(0);
      coc.fragmentShader = coc.fragmentShader
        .replace('uniform float focusRange;', 'uniform float focusRange;uniform float focusHold;')
        .replace('smoothstep(0.0,focusRange,abs(signedDistance))', 'smoothstep(focusHold,focusHold+focusRange,abs(signedDistance))');
      coc.needsUpdate = true;
    }
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
      luminanceSmoothing: 0.5,
      intensity: 0.9,
      // (wide: a lamp glows several times its own size in footage — the lens and sensor scatter)
      radius: 0.78,
    });
    this.grade = new GradeEffect();
    this.grade.setAutoExposure(0.6);
    // Khronos PBR Neutral: base colours come out as painted (a Ferrari red stays red, not
    // AgX's salmon), with a filmic roll-off only in the highlights; the weather look adds a touch
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    // a soft lens fall-off that pulls the eye to the centre (strong enough to feel, never a filter)
    this.vignette = new VignetteEffect({ darkness: 0.38, offset: 0.3 });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.grain.blendMode.opacity.value = 0.028;
    // (the NaN scrub runs first inside this pass rather than as a pass of its own — one full-screen
    // copy less; bloom's luminance pre-pass and the shaft mask scrub what they read themselves)
    const lum = this.bloom.luminanceMaterial as unknown as THREE.ShaderMaterial;
    lum.fragmentShader = lum.fragmentShader
      .replace(
        'vec4 texel=texture2D(inputBuffer,vUv);',
        'vec4 texel=texture2D(inputBuffer,vUv);if(texel.r!=texel.r||texel.g!=texel.g||texel.b!=texel.b||max(max(abs(texel.r),abs(texel.g)),abs(texel.b))>1e6)texel.rgb=vec3(0.0);texel.rgb=min(max(texel.rgb,0.0),vec3(200.0));',
      )
      // a soft knee that only lets the light ABOVE the threshold glow (as a lens's scatter does): a
      // smoothstep mask passed the whole colour of everything just over the threshold, so a bright sky
      // round a low sun bloomed as a flat disc with a visible edge where it crossed the threshold
      // (smoothing is the knee's width as a fraction of the threshold)
      .replace(
        'mask=smoothstep(threshold,threshold+smoothing,l);',
        'float kn=max(smoothing*threshold,1e-4);float sk=clamp(l-threshold+kn,0.0,2.0*kn);sk=sk*sk/(4.0*kn);mask=max(sk,l-threshold)/max(l,1e-4);',
      );
    // halation: the glow round a bright light in footage is warm (red light scatters deepest into the
    // film / sensor stack and spreads widest), not the light's own colour scaled up
    const bl = this.bloom as unknown as { fragmentShader: string; setFragmentShader(s: string): void };
    bl.setFragmentShader(
      bl.fragmentShader
        .replace('uniform float intensity;', 'uniform float intensity;uniform vec3 halation;')
        .replace('outputColor=texture2D(map,uv)*intensity;', 'vec4 bt=texture2D(map,uv);outputColor=vec4(bt.rgb*halation,bt.a)*intensity;'),
    );
    this.bloom.uniforms.set('halation', new THREE.Uniform(new THREE.Vector3(1.12, 0.94, 0.76)));
    // The sim look's tone curve (see `broadcast`): ACC is an Unreal Engine 4 game, whose filmic tone
    // mapper is fitted to ACES — per channel, so colour stays rich through the mids, with detail kept
    // in the shade (PBR Neutral's quadratic toe crushes it, as a broadcast camera does) and a long
    // soft shoulder that holds the sky and sunlit lacquer. It runs in the display primaries, not
    // ACES's AP1 (whose round trip turns a sunlit red livery orange), and is blended in the same pass
    // by a uniform (no second program). acesScale sets mid grey: 0.18 in → 0.15 out, a touch brighter
    // than Neutral's 0.14 (a game exposes for the subject, a broadcast camera a little under).
    const tm = this.toneMapping as unknown as { fragmentShader: string; setFragmentShader(s: string): void };
    const tmSrc = tm.fragmentShader
      .replace('uniform float whitePoint;', `uniform float whitePoint;uniform float simTone;uniform float acesScale;${SIM_TONE_GLSL}`)
      .replace(
        'outputColor=vec4(toneMapping(inputColor.rgb),inputColor.a);',
        'vec3 tmc=toneMapping(inputColor.rgb);if(simTone>0.0)tmc=mix(tmc,simFilmic(inputColor.rgb*acesScale),simTone);outputColor=vec4(tmc,inputColor.a);',
      );
    if (!tmSrc.includes('simTone>0.0')) console.warn('Renderer: tone mapping patch did not apply (postprocessing changed?)');
    tm.setFragmentShader(tmSrc);
    this.toneMapping.uniforms.set('simTone', new THREE.Uniform(0));
    this.toneMapping.uniforms.set('acesScale', new THREE.Uniform(1.3));
    // (the sim look keeps only a hint of the vignette: the game's camera is not a lens that darkens
    // its corners; `darkness` stays what the game sets, the sim look scales it)
    const vg = this.vignette as unknown as { fragmentShader: string; setFragmentShader(s: string): void };
    vg.setFragmentShader(vg.fragmentShader.replace('uniform float darkness;', 'uniform float darkness;uniform float vigScale;').replace('d*(darkness+offset)', 'd*(darkness*vigScale+offset)'));
    this.vignette.uniforms.set('vigScale', new THREE.Uniform(1));
    this.ssao = new AOEffect();
    this.film = new FilmEffect();
    this.grade.adaptLinks.push(this.film);
    // (the grain lives in the print stage now — sensor noise that follows the light; `grain` stays as
    // the knob: its opacity is the base amount)
    this.composer.addPass(new EffectPass(camera, new SanitizeEffect(), this.ssao, this.shafts, this.bloom, this.grade, this.toneMapping, this.film, this.vignette));

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
  /** temporal anti-aliasing (High/Ultra; SMAA below): taa.ts */
  private readonly taa: TAAPass;
  /** TAA is running (the game keeps the tracked cars listed for its reprojection even with motion blur off) */
  get temporalAA() {
    return this.taa.enabled;
  }
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
    // (and the sun shafts' / lens flare's inner passes, which run only with the sun in view)
    this.shafts.warm(this.renderer);
  }

  /**
   * (boot) Queue the post chain's own programs on the driver's threads (KHR_parallel_shader_compile)
   * and resolve once they are built: each pass's full-screen material, bloom's mip chain, SMAA's two
   * stages, the exposure meter… Left to the first frame they were built one by one, each blocking
   * the main thread (≈0.3 s for the garage's chain on a cold Windows/D3D shader cache, and the
   * occasional passes another ≈1 s in warmPasses: tools/_boottrace.mjs). A dry run of the chain:
   * every draw it would make becomes a compileAsync with the same target bound (the target is part
   * of a program's key), and nothing is drawn. `all`: the passes that only switch on at speed, in
   * the rain, onboard or on a long lens too.
   */
  compilePasses(all = false): Promise<unknown> {
    const r = this.renderer;
    const queued: Promise<unknown>[] = [];
    const occasional = [this.radialPass, this.dofPass, this.lensPass, this.caPass, this.motionPass, this.onboardPass];
    const was = occasional.map((p) => p.enabled);
    const main = this.renderPass.enabled;
    const draw = r.render;
    if (all) for (const p of occasional) p.enabled = true;
    // (the scene itself is the game's to compile: compileQueued)
    this.renderPass.enabled = false;
    r.render = (scene, camera) => void queued.push(r.compileAsync(scene, camera));
    try {
      this.composer.render(0);
    } catch (e) {
      console.warn('[shaders] post chain compile failed', e);
    } finally {
      r.render = draw;
      this.renderPass.enabled = main;
      occasional.forEach((p, i) => (p.enabled = was[i]));
      // (the meter's dry run read nothing: it starts afresh on the first real frame)
      this.grade.resetAutoExposure();
    }
    return Promise.all(queued);
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
    this.grade.resetAutoExposure();
    this.taa.reset();
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
    // TAA where the CAS sharpen follows it (High/Ultra) — it resolves what SMAA can't (sub-pixel
    // wires, kerb stripes, thin flaps), and the sharpen gives back what its blend softens; below,
    // SMAA (no history, no jitter: cheaper, and nothing to smear at a low frame rate)
    this.taa.enabled = sharpenOn;
    this.taa.reset();
    this.smaaPass.enabled = !sharpenOn;
    this.renderer.shadowMap.enabled = true;
    this.shafts.active = q !== 'low';
    this.motion.maxTaps = q === 'low' ? 6 : q === 'medium' ? 10 : q === 'high' ? 14 : 20;
    this.onboard.twoSided = q === 'high' || q === 'ultra';
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
    this.sharpBase = THREE.MathUtils.clamp(0.4 + (1 - v) * 0.5, 0.4, 0.65);
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

  /** lateral chromatic aberration (shares the speed-blur pass; the broadcast look only, see `broadcast`) */
  setAberration(offset: number) {
    this.caWanted = offset;
    this.radial.aberration = offset * this.broadcast > 0.00003 ? offset * this.broadcast : 0;
    this.radialPass.enabled = this.radial.strength > 0 || this.radial.aberration > 0;
  }
  private caWanted = 0;

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
  setDepthOfField(on: boolean, target: THREE.Vector3 | null = null, range = 5, bokeh = 2.5, hold = 0) {
    this.dofPass.enabled = on;
    this.dof.target = on ? target : null;
    if (on) {
      (this.dof.cocMaterial as unknown as { focusRange: number }).focusRange = range;
      ((this.dof.cocMaterial as unknown as THREE.ShaderMaterial).uniforms.focusHold as THREE.IUniform<number>).value = hold;
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
  private wasIndoor = false;
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

  /** lens character on (barrel distortion + lateral CA by the field of view; off for menus' dev pages) */
  lensCharacter = true;
  private updateLens() {
    const fov = this.camera.fov;
    // how wide the lens is (vertical fov): a long trackside lens (a few degrees) 0, the onboards ~0.8, chase 1
    // (a real lens's character is the broadcast look's: the sim's camera is an ideal rectilinear one)
    const lens = this.lensCharacter ? this.broadcast : 0;
    const wide = THREE.MathUtils.smoothstep(fov, 20, 60);
    this.sharpen.setLens(0.05 * wide * lens, (0.0012 + 0.0024 * wide) * lens);
  }

  /**
   * The look, 0 … 1: 0 is the sim look, 1 the broadcast look. The game sets it per camera
   * (Game.updateMotionBlur): the cameras you drive with (chase, onboards) get the sim look, the TV
   * director, the trackside and aerial cameras and the replays keep the broadcast look.
   *
   * The broadcast look is what the chain was built for: compressed TV footage — a warm sodium cast,
   * olive greens, colour pulled back, a lifted black floor, sensor grain that follows the gain, a
   * strong vignette, the lens's barrel distortion and lateral CA, speed CA, footage-soft sharpening.
   *
   * The sim look is Assetto Corsa Competizione's (Unreal Engine 4): a clean, crisp, high-dynamic-
   * range image — ACES-fitted filmic tone curve (deep shade, rich mids, a soft shoulder), white
   * balance to the light, saturated but natural colour, clean blacks, no grain beyond a dither,
   * a hint of vignette, no lens distortion or chromatic aberration, even sharpening corner to corner,
   * a restrained neutral bloom, and a cockpit that is in shade but readable (no footage-style
   * defocus). Shared state (exposure, auto exposure, weather looks, flare) is untouched: the two
   * looks are the same light shot by two cameras.
   */
  broadcast = 0;
  private sharpBase = 0.4;
  private appliedLook = -1;
  private applyLook() {
    const b = THREE.MathUtils.clamp(this.broadcast, 0, 1);
    const s = 1 - b;
    // (per frame: cheap, and the sharpening base moves with the dynamic resolution)
    // (the sim look sharpens a little harder and evenly: ACC's TAA + sharpen is crisp to the corners)
    this.sharpen.sharpness = Math.min(1, this.sharpBase + 0.22 * s);
    this.sharpen.edgeSoft = 0.75 * b;
    this.radial.aberration = this.caWanted * b > 0.00003 ? this.caWanted * b : 0;
    this.radialPass.enabled = this.radial.strength > 0 || this.radial.aberration > 0;
    if (b === this.appliedLook) return;
    this.appliedLook = b;
    this.grade.uniforms.get('sim')!.value = s;
    this.film.uniforms.get('sim')!.value = s;
    this.toneMapping.uniforms.get('simTone')!.value = s;
    this.vignette.uniforms.get('vigScale')!.value = THREE.MathUtils.lerp(0.4, 1, b);
    // bloom: the footage's wide warm halation, or a restrained neutral glow (UE4's bloom is subtle in ACC)
    (this.bloom.uniforms.get('halation')!.value as THREE.Vector3).set(THREE.MathUtils.lerp(0.62, 1.12, b), THREE.MathUtils.lerp(0.6, 0.94, b), THREE.MathUtils.lerp(0.58, 0.76, b));
    // the cockpit: footage shades it hard and defocuses it (a lens exposed for the outside, focused far);
    // the sim's eye sees it in shade but readable and sharp, as ACC's cockpit view does
    const ou = this.onboard.uniforms;
    ou.get('shade')!.value = THREE.MathUtils.lerp(0.5, 1, b);
    ou.get('outside')!.value = THREE.MathUtils.lerp(1.0, 1.12, b);
    ou.get('defocus')!.value = THREE.MathUtils.lerp(0.0105 * 0.25, 0.0105, b);
    ou.get('obVig')!.value = THREE.MathUtils.lerp(0.12, 0.5, b);
  }

  render(dt: number) {
    this.renderer.info.reset();
    this.applyLook();
    this.updateLens();
    this.film.uniforms.get('filmGrain')!.value = this.grain.blendMode.opacity.value;
    // (a cut, another camera, or in/out of the garage: the auto exposure starts from the new view)
    if (this.motionCut || this.prevCam !== this.camera || this.indoor !== this.wasIndoor) this.grade.resetAutoExposure();
    this.wasIndoor = this.indoor;
    this.ssao.setCamera(this.camera);
    this.updateShafts();
    this.updateScene();
    // (before updateMotion, which moves last frame's camera and car matrices on to this frame's)
    this.updateTaa();
    this.updateMotion(dt);
    this.updateOnboard();
    // TAA: this frame's sub-pixel offset, on the projection for the composer's render only (game code
    // between frames, and the matrices kept for next frame's reprojection, see the unjittered one)
    const cam = this.camera;
    const jitter = this.taa.enabled;
    if (jitter) {
      const j = TAA_JITTER[this.taaPhase++ & 7];
      this.taaSaved.copy(cam.projectionMatrix);
      const e = cam.projectionMatrix.elements;
      e[8] += (2 * j[0]) / Math.max(1, this.composer.inputBuffer.width);
      e[9] += (2 * j[1]) / Math.max(1, this.composer.inputBuffer.height);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      (this.taa.uniforms.projInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    }
    try {
      this.composer.render(dt);
    } finally {
      if (jitter) {
        cam.projectionMatrix.copy(this.taaSaved);
        cam.projectionMatrixInverse.copy(this.taaSaved).invert();
      }
    }
  }

  private taaPhase = 0;
  private readonly taaSaved = new THREE.Matrix4();
  /** the TAA's reprojection: last frame's (unjittered) view-projection and the tracked cars' motion */
  private updateTaa() {
    if (!this.taa.enabled) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const camPos = this.tmpV.setFromMatrixPosition(cam.matrixWorld);
    const camQ = this.tmpQ.setFromRotationMatrix(cam.matrixWorld);
    const zoom = cam.projectionMatrix.elements[5] / Math.max(1e-6, this.prevViewProjZoom);
    // a cut, another camera, a jump, a whip pan or a zoom snap: nothing a frame ago to blend with
    // (the same tests as the motion blur's; updateMotion clears motionCut after this)
    if (this.motionCut || this.prevCam !== cam || camPos.distanceTo(this.prevCamPos) > 8 || camQ.angleTo(this.prevCamQ) > 0.25 || zoom > 1.05 || zoom < 1 / 1.05) this.taa.reset();
    const u = this.taa.uniforms;
    (u.prevViewProj.value as THREE.Matrix4).copy(this.prevViewProj);
    (u.camWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
    (u.projInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    u.cameraNear.value = cam.near;
    u.cameraFar.value = cam.far;
    const inv = u.carInv.value as THREE.Matrix4[];
    const prev = u.carPrev.value as THREE.Matrix4[];
    let n = 0;
    for (const o of this.motionCars) {
      if (n >= MOTION_CARS) break;
      const p = this.prevCar.get(o);
      inv[n].copy(o.matrixWorld).invert();
      // (updateMotion hasn't counted this frame yet: a car seen last frame has frame === motionFrame)
      const fresh = p && p.frame === this.motionFrame;
      prev[n].copy(fresh ? p.m : o.matrixWorld);
      if (fresh && this.tmpF.setFromMatrixPosition(p.m).distanceToSquared(this.tmpF2.setFromMatrixPosition(o.matrixWorld)) > 400) prev[n].copy(o.matrixWorld);
      n++;
    }
    u.carCount.value = n;
  }

  /** the car an onboard camera rides in (null = not onboard): its own cockpit is shaded and defocused */
  onboardCar: THREE.Object3D | null = null;
  private updateOnboard() {
    const own = this.onboardCar;
    this.onboardPass.enabled = own !== null;
    if (!own) return;
    const u = this.onboard.uniforms;
    this.onboard.setCamera(this.camera);
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
  private prevViewProjZoom = 1;
  /** set for one frame by the game on a camera cut */
  motionCut = false;
  private motionFrame = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private updateMotion(dt: number) {
    const cam = this.camera;
    const frame = ++this.motionFrame;
    cam.updateMatrixWorld();
    const camPos = this.tmpV.setFromMatrixPosition(cam.matrixWorld);
    const camQ = this.tmpQ.setFromRotationMatrix(cam.matrixWorld);
    let ok = this.motionBlur > 0.01 && this.prevCam === cam && dt > 0 && !this.motionCut;
    this.motionCut = false;
    // a cut (a new camera position, a whip around, a zoom snap) has no motion to blur — the game says
    // so (motionCut); these catch the rest
    const zoom = cam.projectionMatrix.elements[5] / Math.max(1e-6, this.prevViewProjZoom);
    if (ok && (camPos.distanceTo(this.prevCamPos) > 8 || camQ.angleTo(this.prevCamQ) > 0.25 || zoom > 1.05 || zoom < 1 / 1.05)) ok = false;
    this.prevViewProjZoom = cam.projectionMatrix.elements[5];
    if (ok) {
      const u = this.motion.velMat.uniforms;
      (u.projInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
      (u.camWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
      (u.prevViewProj.value as THREE.Matrix4).copy(this.prevViewProj);
      u.cameraNear.value = cam.near;
      u.cameraFar.value = cam.far;
      // (a long lens magnifies every tremor of the operator's pan and every beat of lag behind the
      // car into a smear across the frame; broadcast long lenses run a faster shutter, and the blur
      // eases off with the field of view: full from ~30°, under a third at a few degrees)
      const lensShutter = 0.3 + 0.7 * THREE.MathUtils.smoothstep(cam.fov, 4, 30);
      u.shutter.value = this.motionBlur * lensShutter * THREE.MathUtils.clamp(1 / 60 / dt, 0.5, 2);
      const inv = u.carInv.value as THREE.Matrix4[];
      const prev = u.carPrev.value as THREE.Matrix4[];
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
      u.carCount.value = n;
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
