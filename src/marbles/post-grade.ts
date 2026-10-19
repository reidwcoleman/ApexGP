import * as THREE from 'three';
import { Effect } from 'postprocessing';

/**
 * The grade, after the tone curve: a toy commercial's look, not a film's. Vibrance (the dull colours
 * pushed hardest, the already-pure enamels hardly at all, so nothing clips to a flat slab), a gentle
 * S-curve in display space for snap without crushing the shadows under the planks, and a split tone:
 * shadows a little cool (sky-lit), highlights a little warm (sunlit) — the two lights of the scene,
 * pulled apart. A touch of clean black lift keeps the darkest seams from going to ink.
 */

const FRAG = /* glsl */ `
uniform float vibrance;
uniform float contrast;
uniform vec3 shadowTint;
uniform vec3 highTint;
uniform float lift;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-4);
  c = max(mix(vec3(l), c, 1.0 + vibrance * (1.0 - sat)), 0.0);
  vec3 p = sqrt(c);
  p = mix(p, p * p * (3.0 - 2.0 * p), contrast);
  c = p * p;
  float k = smoothstep(0.02, 0.5, l);
  c *= mix(shadowTint, highTint, k);
  c = c * (1.0 - lift) + lift * vec3(0.06, 0.065, 0.08);
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor({ vibrance = 0.28, contrast = 0.16, lift = 0.02 } = {}) {
    super('GradeEffect', FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['vibrance', new THREE.Uniform(vibrance)],
        ['contrast', new THREE.Uniform(contrast)],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(0.96, 0.99, 1.06))],
        ['highTint', new THREE.Uniform(new THREE.Vector3(1.03, 1.0, 0.96))],
        ['lift', new THREE.Uniform(lift)],
      ]),
    });
  }
}
