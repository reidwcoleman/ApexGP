import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/**
 * An onboard camera, as real footage shows it: the lens is exposed for the bright world outside,
 * so the inside of the car the camera sits in (halo, chassis rim, wheel) falls into shadow, and it
 * is focused down the road, so whatever is a hand's width from the glass is soft. Pixels of the
 * player's own car (its box, from depth) are shaded and defocused by how near they are. The
 * outside gets a little more exposure so the sky rolls off toward white.
 *
 * The defocus works from both sides of the edge, as a real out-of-focus foreground does: the
 * cockpit's pixels gather their soft neighbours (and the view behind where their disc crosses an
 * edge), and the outside pixels near the cockpit gather the blurred cockpit that spills over them —
 * so the halo's silhouette against the sky is a soft gradient on both sides, and the bright sky
 * bleeds into its dark edge, instead of a cut-out with a sharp outline. The outside's half needs to
 * know where the cockpit is and how soft it is round about: a half-resolution map of the own car's
 * blur radius (+ distance, + steering-wheel mask) is drawn first, then dilated at quarter resolution.
 */

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// shared GLSL: the own car's box test and the blur radius of a surface this near
const OWN_GLSL = /* glsl */ `
uniform mat4 projInv;
uniform mat4 camWorld;
uniform mat4 ownInv;
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform float defocus;
uniform vec3 wheelPos;
vec3 obViewPos(vec2 uv, float vz) {
  vec4 ray = projInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  return ray.xyz * (vz / ray.z);
}
// distance from the lens if this pixel is the player's own car, else -1; wheel 0 … 1 = on the
// steering wheel (its screen, shift lights and buttons stay readable, as in the footage)
float ownDistZ(vec2 uv, float vz, out float wheel) {
  wheel = 0.0;
  if (-vz > 4.5) return -1.0;
  vec3 vp = obViewPos(uv, vz);
  vec3 l = (ownInv * (camWorld * vec4(vp, 1.0))).xyz;
  if (!(all(greaterThan(l, boxMin)) && all(lessThan(l, boxMax)))) return -1.0;
  wheel = 1.0 - smoothstep(0.17, 0.26, length(l - wheelPos));
  return length(vp);
}
// blur radius (uv, vertical) of a surface this far from a lens focused far away
float coc(float d, float wheel) { return defocus * clamp(1.0 / max(d, 0.25) - 0.12, 0.0, 1.6) * (1.0 - 0.8 * wheel); }
`;

// half res: (blur radius, distance, wheel) of the own car's pixels; zeros elsewhere
const MAP_FRAG = /* glsl */ `
#include <packing>
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
${OWN_GLSL}
void main() {
  float vz = perspectiveDepthToViewZ(texture2D(tDepth, vUv).r, cameraNear, cameraFar);
  float wh;
  float d = ownDistZ(vUv, vz, wh);
  gl_FragColor = d < 0.0 ? vec4(0.0) : vec4(coc(d, wh), d, wh, 1.0);
}
`;

// quarter res: the largest blur radius within reach (a 5 × 5 grid spanning ± the largest radius)
const DILATE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;
uniform vec2 stepUv;
void main() {
  float m = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      m = max(m, texture2D(tMap, vUv + vec2(float(x), float(y)) * stepUv).r);
    }
  }
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}
`;

const ONBOARD_FRAG = /* glsl */ `
uniform float shade;
uniform float outside;
uniform float obVig;
uniform sampler2D tMap;
uniform sampler2D tNear;
uniform float bleed;
${OWN_GLSL}
float ownDist(vec2 uv, float depth, out float wheel) { return ownDistZ(uv, getViewZ(depth), wheel); }

vec3 shadeOwn(vec3 c, float d, float wheel) {
  float k = shade * (1.0 - smoothstep(1.6, 3.6, d)) * (1.0 - 0.55 * wheel);
  // the shadowed cockpit: much less light, a little less colour, and no sun glints in the lacquer
  // (kept, they sparkle once the paint round them is dark); lit LEDs and the wheel's screen keep
  // their glow — bright AND strongly coloured, where a glint is bright and white
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float hi = max(max(c.r, c.g), c.b);
  float chroma = (hi - min(min(c.r, c.g), c.b)) / max(hi, 1e-4);
  // (to ~40 %, most of the colour kept: in the helmet-cam footage the chassis rim and the halo are in
  // shade but still read as the livery's red / papaya / silver, never as a black frame)
  vec3 s = mix(vec3(lum), c, 0.75) * 0.4 + max(c - 2.5, 0.0) * 0.12 * smoothstep(0.5, 0.8, chroma);
  vec3 lit = mix(s, c, wheel * 0.85);
  return mix(c, lit, k);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // an onboard camera's small wide lens darkens hard toward the corners (obVig: Renderer's look)
  vec2 vc = (uv - 0.5) * vec2(aspect, 1.0);
  float vig = 1.0 - obVig * smoothstep(0.3, 1.0, length(vc));
  float rot = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float wh0;
  float d0 = ownDist(uv, depth, wh0);
  if (d0 < 0.0) {
    // the view outside, exposed up; near the cockpit, the cockpit's blur spills over it
    vec3 bg = inputColor.rgb * outside;
    float R = bleed > 0.5 ? texture2D(tNear, uv).r : 0.0;
    if (R * resolution.y < 1.0) { outputColor = vec4(bg * vig, inputColor.a); return; }
    vec3 fg = vec3(0.0);
    float cover = 0.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996 + rot;
      float rr = sqrt((float(i) + 0.5) / 12.0);
      vec2 o = vec2(cos(a), sin(a)) * rr * R;
      vec2 su = uv + o * vec2(1.0 / aspect, 1.0);
      // (the map is filtered: alpha is how much of the tap is cockpit, so the coverage is smooth)
      vec4 m = texture2D(tMap, su);
      // a cockpit pixel whose own blur disc reaches this far covers this pixel
      if (m.a > 0.01 && m.r / m.a >= rr * R) {
        fg += shadeOwn(texture2D(inputBuffer, su).rgb, m.g / m.a, m.b / m.a) * m.a;
        cover += m.a;
      }
    }
    vec3 c = cover > 0.0 ? mix(bg, fg / cover, cover / 12.0) : bg;
    outputColor = vec4(c * vig, inputColor.a);
    return;
  }
  float r0 = coc(d0, wh0);
  vec3 c0 = shadeOwn(inputColor.rgb, d0, wh0);
  if (r0 * resolution.y < 0.75) { outputColor = vec4(c0 * vig, inputColor.a); return; }
  // defocus disc: the cockpit's own soft neighbours, and the view behind where the disc crosses an
  // edge. The disc turns per pixel (interleaved gradient noise) and the cockpit's bright taps are
  // weighted down (1 / (1 + luma)) so a small LED spreads into a soft disc instead of a dotted
  // pattern; the view behind counts in full (the bright sky glows into the dark halo's edge)
  float w = 1.0 / (1.0 + dot(c0, vec3(0.2126, 0.7152, 0.0722)));
  vec3 acc = c0 * w;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996 + rot;
    float rr = sqrt((float(i) + 0.5) / 12.0);
    vec2 su = uv + vec2(cos(a), sin(a)) * rr * r0 * vec2(1.0 / aspect, 1.0);
    float whs;
    float ds = ownDist(su, readDepth(su), whs);
    vec3 c = texture2D(inputBuffer, su).rgb;
    float wi;
    if (ds < 0.0) {
      c *= outside;
      wi = 1.0;
    } else {
      c = shadeOwn(c, ds, whs);
      wi = 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)));
    }
    acc += c * wi;
    w += wi;
  }
  outputColor = vec4(acc / w * vig, inputColor.a);
}
`;

export class OnboardEffect extends Effect {
  private depth: THREE.Texture | null = null;
  private readonly rtMap: THREE.WebGLRenderTarget;
  private readonly rtNear: THREE.WebGLRenderTarget;
  private readonly mapMat: THREE.ShaderMaterial;
  private readonly dilateMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    const shared = {
      projInv: new THREE.Uniform(new THREE.Matrix4()),
      camWorld: new THREE.Uniform(new THREE.Matrix4()),
      ownInv: new THREE.Uniform(new THREE.Matrix4()),
      boxMin: new THREE.Uniform(new THREE.Vector3(-1.15, -0.2, -2.85)),
      boxMax: new THREE.Uniform(new THREE.Vector3(1.15, 1.45, 2.95)),
      defocus: new THREE.Uniform(0.0105),
      // the steering wheel's centre in the car's frame (carGeometry STEER_PIVOT)
      wheelPos: new THREE.Uniform(new THREE.Vector3(0, 0.605, 0.5)),
    };
    super('OnboardEffect', ONBOARD_FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ...Object.entries(shared),
        ['shade', new THREE.Uniform(1)],
        ['outside', new THREE.Uniform(1.12)],
        ['obVig', new THREE.Uniform(0.5)],
        ['tMap', new THREE.Uniform(null)],
        ['tNear', new THREE.Uniform(null)],
        ['bleed', new THREE.Uniform(1)],
      ]),
    });
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.rtMap = new THREE.WebGLRenderTarget(4, 4, { ...opts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtNear = new THREE.WebGLRenderTarget(4, 4, { ...opts, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.mapMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: MAP_FRAG,
      uniforms: { ...shared, tDepth: { value: null }, cameraNear: { value: 0.1 }, cameraFar: { value: 1000 } },
      depthTest: false,
      depthWrite: false,
    });
    this.dilateMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: DILATE_FRAG,
      uniforms: { tMap: { value: this.rtMap.texture }, stepUv: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mapMat);
    this.quad.frustumCulled = false;
    this.uniforms.get('tMap')!.value = this.rtMap.texture;
    this.uniforms.get('tNear')!.value = this.rtNear.texture;
  }

  /** the camera (for the depth → distance conversion of the cockpit map) */
  setCamera(cam: THREE.PerspectiveCamera) {
    this.mapMat.uniforms.cameraNear.value = cam.near;
    this.mapMat.uniforms.cameraFar.value = cam.far;
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number) {
    this.rtMap.setSize(Math.max(2, Math.ceil(width / 2)), Math.max(2, Math.ceil(height / 2)));
    this.rtNear.setSize(Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(height / 4)));
  }

  /** the cockpit's blur spills over the view outside it too (High/Ultra; below, only its inside is soft) */
  set twoSided(on: boolean) {
    this.uniforms.get('bleed')!.value = on ? 1 : 0;
  }
  get twoSided(): boolean {
    return (this.uniforms.get('bleed')!.value as number) > 0.5;
  }

  override update(renderer: THREE.WebGLRenderer) {
    if (!this.depth || !this.twoSided) return;
    const prev = renderer.getRenderTarget();
    this.mapMat.uniforms.tDepth.value = this.depth;
    this.quad.material = this.mapMat;
    renderer.setRenderTarget(this.rtMap);
    renderer.render(this.quad, this.cam);
    // the grid spans ± the largest blur radius (defocus × 1.6, of the frame height)
    const r = (this.uniforms.get('defocus')!.value as number) * 1.6;
    const aspect = this.rtMap.width / Math.max(1, this.rtMap.height);
    (this.dilateMat.uniforms.stepUv.value as THREE.Vector2).set(r / 2 / aspect, r / 2);
    this.quad.material = this.dilateMat;
    renderer.setRenderTarget(this.rtNear);
    renderer.render(this.quad, this.cam);
    renderer.setRenderTarget(prev);
  }

  override dispose() {
    super.dispose();
    this.rtMap.dispose();
    this.rtNear.dispose();
    this.mapMat.dispose();
    this.dilateMat.dispose();
    this.quad.geometry.dispose();
  }
}
