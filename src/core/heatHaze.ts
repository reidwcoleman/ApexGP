import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/** how many cars' exhausts shimmer (the nearest to the camera: the motion blur's tracked cars) */
export const HAZE_CARS = 8;

/**
 * Heat haze, the way it shows in every long-lens shot of a hot race: the air over sun-baked asphalt
 * refracts, so far down a straight the road, the cars and the barriers wobble in thin horizontal
 * bands (the mirage), and behind every car the exhaust plume ripples whatever is seen through it.
 *
 *  - mirage: pixels whose surface is far off and seen at a grazing angle (the eye's ray runs a long
 *    way just over the ground before it lands) are displaced by a slow, banded noise: strongest at
 *    a few hundred metres, more down a long lens (narrow field: each pixel covers less), none on the
 *    sky or nearby. Scaled by `strength` (track temperature, sunshine, a dry track).
 *  - exhaust: each tracked car's plume is a cone from the exhaust exit back and up behind the car;
 *    a pixel whose view ray passes through a cone (before reaching its own surface) is displaced by
 *    a fast, fine noise, more near the exit. It is there in the cold and the wet too (hot gas).
 *
 * After the TAA (the wobble is not accumulated into the history), before the motion blur.
 */
const FRAG = /* glsl */ `
uniform mat4 projInv;
uniform mat4 camWorld;
uniform float strength;
uniform float exhaustK;
uniform float time;
uniform float lensK;
uniform vec3 exPos[${HAZE_CARS}];
uniform vec3 exDir[${HAZE_CARS}];
uniform int exCount;

float hzHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hzNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hzHash(i), hzHash(i + vec2(1.0, 0.0)), u.x), mix(hzHash(i + vec2(0.0, 1.0)), hzHash(i + vec2(1.0, 1.0)), u.x), u.y) * 2.0 - 1.0;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) { outputColor = inputColor; return; }
  float vz = getViewZ(depth);
  vec4 ray = projInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  vec3 vp = ray.xyz * (vz / ray.z);
  vec3 wp = (camWorld * vec4(vp, 1.0)).xyz;
  vec3 cp = camWorld[3].xyz;
  float dist = length(vp);
  vec2 off = vec2(0.0);
  // ---- the mirage over the hot road
  if (strength > 0.001) {
    float drop = (cp.y - wp.y) / max(dist, 1.0);
    // (the ray must skim the road the whole way: a target well above the ground isn't seen through the hot layer)
    float graze = 1.0 - smoothstep(0.006, 0.03, abs(drop + 0.002));
    float far = smoothstep(70.0, 320.0, dist) * (1.0 - 0.4 * smoothstep(1500.0, 4000.0, dist));
    float k = strength * graze * far * lensK;
    if (k > 0.001) {
      // thin horizontal bands that crawl upward, broken along their length
      vec2 q = vec2(uv.x * 38.0, uv.y * 210.0 - time * 3.2);
      float n1 = hzNoise(q + vec2(time * 0.7, 0.0));
      float n2 = hzNoise(q * vec2(2.3, 1.7) + vec2(-time * 1.1, time * 1.9) + 7.3);
      off += vec2(n2 * 0.3, n1) * k * 0.00055;
    }
  }
  // ---- exhaust plumes
  if (exhaustK > 0.001) {
    vec3 rd = normalize(wp - cp);
    for (int i = 0; i < ${HAZE_CARS}; i++) {
      if (i >= exCount) break;
      vec3 a = exPos[i];
      vec3 ab = exDir[i];
      float L2 = dot(ab, ab);
      // closest approach between the view ray (cp + rd·t) and the plume's axis (a + ab·s)
      vec3 w0 = cp - a;
      float b = dot(rd, ab), d = dot(rd, w0), e = dot(ab, w0);
      float den = L2 - b * b;
      if (den < 1e-5) continue;
      float s = clamp((e - b * d) / den, 0.0, 1.0);
      float t = dot(rd, a + ab * s - cp);
      if (t <= 0.0 || t > dist + 0.3) continue;
      vec3 pr = cp + rd * t - (a + ab * s);
      float r = 0.12 + 0.55 * s;
      float m = 1.0 - smoothstep(0.0, r, length(pr));
      if (m <= 0.0) continue;
      float near = 1.0 - smoothstep(25.0, 90.0, t);
      float heat = m * (1.0 - s * 0.7) * near;
      vec2 q = uv * vec2(160.0, 120.0) / max(t * 0.08, 1.0) + vec2(0.0, -time * 7.0);
      off += vec2(hzNoise(q + float(i) * 13.1), hzNoise(q * 1.3 + 4.7 + float(i))) * heat * exhaustK * 0.006 / max(t * 0.12, 1.0);
    }
  }
  if (dot(off, off) < 1e-12) { outputColor = inputColor; return; }
  // (never pull in a pixel nearer than this one: a car's own body must not smear into the road behind)
  vec2 su = clamp(uv + off, vec2(0.001), vec2(0.999));
  float sd = readDepth(su);
  outputColor = getViewZ(sd) < vz - 1.5 ? inputColor : texture2D(inputBuffer, su);
}
`;

export class HeatHazeEffect extends Effect {
  constructor() {
    super('HeatHazeEffect', FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['strength', new THREE.Uniform(0)],
        ['exhaustK', new THREE.Uniform(0)],
        ['time', new THREE.Uniform(0)],
        ['lensK', new THREE.Uniform(1)],
        ['exPos', new THREE.Uniform(Array.from({ length: HAZE_CARS }, () => new THREE.Vector3()))],
        ['exDir', new THREE.Uniform(Array.from({ length: HAZE_CARS }, () => new THREE.Vector3()))],
        ['exCount', new THREE.Uniform(0)],
      ]),
    });
  }
}
