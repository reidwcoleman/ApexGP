import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

/** how many cars the motion blur tracks as moving objects (the nearest to the camera) */
export const MOTION_CARS = 8;

/**
 * Camera + per-object motion blur, the way a film camera's shutter smears a frame — reconstructed
 * after McGuire et al. ("A Reconstruction Filter for Plausible Motion Blur", 2012):
 *
 *   1. velocity: every pixel's world position (from depth) is reprojected into the previous frame;
 *      pixels inside a tracked car's box move with that car instead of with the world (so the car
 *      you ride in and the ones alongside stay sharp while the kerbs streak past, and a car flashing
 *      past a fixed camera streaks while the barrier behind it doesn't). Stored as the streak's half
 *      extent (uv) + the pixel's distance.
 *   2. tile max: the longest streak in each ~tile (two separable passes on tiny targets).
 *   3. neighbour max: the longest streak among the surrounding tiles — the reach a fast object's
 *      blur has into its still neighbours (a car's smear spills OUTSIDE its silhouette, which a
 *      per-pixel gather can't do: that left hard car outlines with a smeared inside).
 *   4. gather (this effect): taps along the neighbourhood's streak and the pixel's own, each weighted
 *      by who is in front and whose streak covers whom (soft depth compare × cone / cylinder):
 *      a sharp foreground (the halo, the cockpit rim, a tracked car) neither smears nor is smeared
 *      into; taps that leave the screen are dropped (no streaks of repeated edge pixels).
 */

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VELOCITY_FRAG = /* glsl */ `
#include <packing>
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
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
uniform float aspect;
void main() {
  float d = texture2D(tDepth, vUv).r;
  float vz = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
  vec4 ray = projInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  ray.xyz /= ray.w;
  vec3 vp = ray.xyz * (vz / ray.z);
  vec3 wpos = (camWorld * vec4(vp, 1.0)).xyz;
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
  vec2 v = pc.w > 0.0 ? (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * (0.5 * shutter) : vec2(0.0);
  // (half extents from here on; the longest streak is held to maxLen of the frame height)
  float len = length(v * vec2(aspect, 1.0));
  if (len > maxLen * 0.5) v *= maxLen * 0.5 / len;
  gl_FragColor = vec4(v, -vz, 1.0);
}
`;

// the longest streak (by its length in pixels) over a run of texels along one axis
const TILE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 inSize;   // source size in texels
uniform vec2 axis;     // (1,0) or (0,1)
uniform float tile;    // texels per tile along the axis
uniform float outN;    // output texels along the axis
uniform vec2 frame;    // frame size in pixels (to compare lengths in pixels)
uniform float first;   // 1 on the pass that reads the velocity buffer itself
void main() {
  // the first source texel of this output texel's run
  vec2 o = floor(vUv * inSize * (vec2(1.0) - axis)) + 0.5;
  float start = floor(dot(vUv, axis) * outN) * tile;
  vec2 best = vec2(0.0);
  float bl = -1.0;
  float zmin = 1e6;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= tile) break;
    vec2 p = o * (vec2(1.0) - axis) + axis * (start + float(i) + 0.5);
    vec3 t = texture2D(tIn, p / inSize).xyz;
    float l = dot(t.xy * frame, t.xy * frame);
    if (l > bl) { bl = l; best = t.xy; }
    // (first pass: the nearest MOVING surface; second pass: the nearest of those)
    zmin = min(zmin, first > 0.5 ? (l > 1.0 ? t.z : 1e6) : t.z);
  }
  gl_FragColor = vec4(best, zmin, 1.0);
}
`;

// the longest streak among the surrounding tiles (5 × 5: a streak reaches ~2.5 tiles each way)
const NEIGHBOR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 tiles;
uniform vec2 frame;   // frame size in pixels (to compare lengths in pixels)
void main() {
  vec2 best = vec2(0.0);
  float bl = -1.0;
  float zmin = 1e6;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec3 t = texture2D(tIn, vUv + vec2(float(x), float(y)) / tiles).xyz;
      float l = dot(t.xy * frame, t.xy * frame);
      if (l > bl) { bl = l; best = t.xy; }
      zmin = min(zmin, t.z);
    }
  }
  // z = the nearest moving surface round about (a still pixel nearer than that has nothing in
  // front of it that could smear over it)
  gl_FragColor = vec4(best, zmin, 1.0);
}
`;

const GATHER_FRAG = /* glsl */ `
uniform sampler2D tVel;
uniform sampler2D tNeighbor;
uniform float maxTaps;
uniform vec2 tileUv;

float mbCone(float d, float v) { return clamp(1.0 - d / v, 0.0, 1.0); }
float mbCyl(float d, float v) { return 1.0 - smoothstep(0.95 * v, 1.05 * v, d); }
// 1 when a is not behind b (within a soft margin that grows with distance)
float mbFront(float za, float zb) { return clamp(1.0 - (za - zb) / (0.04 * min(za, zb) + 0.06), 0.0, 1.0); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // (the neighbourhood is looked up a little off this pixel's own tile — a per-pixel random offset
  // of up to half a tile — so the tiles' edges dissolve into noise instead of drawing blocks where
  // the longest streak changes from one tile to the next)
  vec2 tj = vec2(fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453), fract(sin(dot(gl_FragCoord.xy, vec2(39.3468, 11.135))) * 24634.6345)) - 0.5;
  vec3 nb = texture2D(tNeighbor, uv + tj * tileUv * 0.5).xyz;
  vec2 vmax = nb.xy;
  float lmax = length(vmax * resolution);
  if (lmax < 0.6) { outputColor = inputColor; return; }
  vec4 cx = texture2D(tVel, uv);
  vec2 vx = cx.xy;
  float zx = cx.z;
  float lx = max(length(vx * resolution), 0.5);
  // still, with nothing moving in front of it (the cockpit, the halo, a tracked car): stays sharp
  if (lx < 0.75 && zx <= nb.z * 1.03 + 0.05) { outputColor = inputColor; return; }
  // taps by the streak's length (a tap every ~3 px of the full streak), half along the
  // neighbourhood's longest streak and half along this pixel's own (when it has one of its own):
  // the two differ where a car crosses the flowing background
  float n = clamp(floor(lmax * 0.7), 4.0, maxTaps);
  vec2 dirOwn = lx > 1.5 ? vx : vmax;
  float lOwn = lx > 1.5 ? lx : lmax;
  // interleaved gradient noise: the tap positions shift per pixel, so the steps read as grain
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  float w = 1.0 / lx;
  vec3 acc = inputColor.rgb * w;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= n) break;
    float t = mix(-1.0, 1.0, (float(i) + 0.5 + jit) / n);
    bool own = mod(float(i), 2.0) > 0.5;
    vec2 su = uv + (own ? dirOwn : vmax) * t;
    if (su.x < 0.0 || su.y < 0.0 || su.x > 1.0 || su.y > 1.0) continue;
    vec4 cy = texture2D(tVel, su);
    float ly = max(length(cy.xy * resolution), 0.5);
    float d = abs(t) * (own ? lOwn : lmax);
    float f = mbFront(cy.z, zx);
    float b = mbFront(zx, cy.z);
    float a = f * mbCone(d, ly) + b * mbCone(d, lx) + mbCyl(d, ly) * mbCyl(d, lx) * 2.0;
    acc += texture2D(inputBuffer, su).rgb * a;
    w += a;
  }
  outputColor = vec4(acc / w, inputColor.a);
}
`;

export class MotionBlurEffect extends Effect {
  private depth: THREE.Texture | null = null;
  private readonly rtVel: THREE.WebGLRenderTarget;
  private readonly rtTileH: THREE.WebGLRenderTarget;
  private readonly rtTile: THREE.WebGLRenderTarget;
  private readonly rtNeighbor: THREE.WebGLRenderTarget;
  /** the velocity pass's uniforms (camera + car matrices, shutter: written by the Renderer each frame) */
  readonly velMat: THREE.ShaderMaterial;
  private readonly tileMat: THREE.ShaderMaterial;
  private readonly nbMat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private w = 4;
  private h = 4;
  private tile = 16;

  constructor() {
    super('MotionBlurEffect', GATHER_FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tVel', new THREE.Uniform(null)],
        ['tNeighbor', new THREE.Uniform(null)],
        ['maxTaps', new THREE.Uniform(16)],
        ['tileUv', new THREE.Uniform(new THREE.Vector2())],
      ]),
    });
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.rtVel = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtTileH = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtTile = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtNeighbor = new THREE.WebGLRenderTarget(4, 4, opts);
    this.velMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: VELOCITY_FRAG,
      uniforms: {
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        projInv: { value: new THREE.Matrix4() },
        camWorld: { value: new THREE.Matrix4() },
        prevViewProj: { value: new THREE.Matrix4() },
        carInv: { value: Array.from({ length: MOTION_CARS }, () => new THREE.Matrix4()) },
        carPrev: { value: Array.from({ length: MOTION_CARS }, () => new THREE.Matrix4()) },
        carCount: { value: 0 },
        // a car's box in its own frame (origin on the ground, mid-wheelbase, +Z forward), a little
        // generous round the bodywork but lifted clear of the asphalt: the ground under and beside a
        // car is the world (moving it with the car drew the box as a sharp rectangle in the streaks)
        boxMin: { value: new THREE.Vector3(-1.15, 0.06, -2.85) },
        boxMax: { value: new THREE.Vector3(1.15, 1.45, 2.95) },
        shutter: { value: 0 },
        maxLen: { value: 0.3 },
        aspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.tileMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: TILE_FRAG,
      uniforms: { tIn: { value: null }, inSize: { value: new THREE.Vector2() }, axis: { value: new THREE.Vector2(1, 0) }, tile: { value: 16 }, outN: { value: 1 }, frame: { value: new THREE.Vector2() }, first: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.nbMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: NEIGHBOR_FRAG,
      uniforms: { tIn: { value: this.rtTile.texture }, tiles: { value: new THREE.Vector2() }, frame: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.velMat);
    this.quad.frustumCulled = false;
    this.uniforms.get('tVel')!.value = this.rtVel.texture;
    this.uniforms.get('tNeighbor')!.value = this.rtNeighbor.texture;
  }

  /** most taps per pixel (quality: 16 on High/Ultra, fewer below) */
  set maxTaps(n: number) {
    this.uniforms.get('maxTaps')!.value = n;
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depth = depthTexture;
  }

  override setSize(width: number, height: number) {
    this.w = Math.max(4, width);
    this.h = Math.max(4, height);
    // the velocity buffer is half the frame's resolution (a quarter of the pixels: the streaks are
    // smooth, and the gather's depth compare only needs to know who is in front)
    const vw = Math.max(2, Math.ceil(this.w / 2));
    const vh = Math.max(2, Math.ceil(this.h / 2));
    // tiles ~1/17 of the frame height: the neighbour max (±2 tiles, plus the half-tile jitter) then
    // reaches ~15 % of the height, the longest half streak (maxLen / 2 = 15 %)
    this.tile = Math.max(4, Math.min(64, Math.round(vh / 17)));
    const tw = Math.ceil(vw / this.tile);
    const th = Math.ceil(vh / this.tile);
    this.rtVel.setSize(vw, vh);
    this.rtTileH.setSize(tw, vh);
    this.rtTile.setSize(tw, th);
    this.rtNeighbor.setSize(tw, th);
    this.velMat.uniforms.aspect.value = this.w / this.h;
    (this.nbMat.uniforms.tiles.value as THREE.Vector2).set(tw, th);
    (this.nbMat.uniforms.frame.value as THREE.Vector2).set(this.w, this.h);
    (this.tileMat.uniforms.frame.value as THREE.Vector2).set(this.w, this.h);
    (this.uniforms.get('tileUv')!.value as THREE.Vector2).set(tw > 0 ? 1 / tw : 0, th > 0 ? 1 / th : 0);
  }

  override update(renderer: THREE.WebGLRenderer) {
    if (!this.depth) return;
    const prev = renderer.getRenderTarget();
    const q = this.quad;
    this.velMat.uniforms.tDepth.value = this.depth;
    q.material = this.velMat;
    renderer.setRenderTarget(this.rtVel);
    renderer.render(q, this.cam);
    const tu = this.tileMat.uniforms;
    q.material = this.tileMat;
    tu.tile.value = this.tile;
    tu.tIn.value = this.rtVel.texture;
    (tu.inSize.value as THREE.Vector2).set(this.rtVel.width, this.rtVel.height);
    (tu.axis.value as THREE.Vector2).set(1, 0);
    tu.outN.value = this.rtTileH.width;
    tu.first.value = 1;
    renderer.setRenderTarget(this.rtTileH);
    renderer.render(q, this.cam);
    tu.tIn.value = this.rtTileH.texture;
    (tu.inSize.value as THREE.Vector2).set(this.rtTileH.width, this.rtTileH.height);
    (tu.axis.value as THREE.Vector2).set(0, 1);
    tu.outN.value = this.rtTile.height;
    tu.first.value = 0;
    renderer.setRenderTarget(this.rtTile);
    renderer.render(q, this.cam);
    q.material = this.nbMat;
    renderer.setRenderTarget(this.rtNeighbor);
    renderer.render(q, this.cam);
    renderer.setRenderTarget(prev);
  }

  override dispose() {
    super.dispose();
    this.rtVel.dispose();
    this.rtTileH.dispose();
    this.rtTile.dispose();
    this.rtNeighbor.dispose();
    this.velMat.dispose();
    this.tileMat.dispose();
    this.nbMat.dispose();
    this.quad.geometry.dispose();
  }
}
