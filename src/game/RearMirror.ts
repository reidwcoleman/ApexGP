import * as THREE from 'three';

/**
 * The virtual rear-view mirror for the onboard cameras (the car's real mirrors sit ~60° off to
 * the side, outside any sane field of view): the scene behind the car rendered into a small HDR
 * target at a third of the frame rate, then drawn — flipped like a mirror, tone-mapped like the main
 * image — into a rounded frame at the top of the screen.
 *
 * It renders the same scene with the same materials (to a render target, so no tone-mapping
 * program variants), from just behind the rear wing, with a short far plane.
 */
const W = 640;
const H = 150;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const QUAD_FRAG = /* glsl */ `
uniform sampler2D tMirror;
uniform float uExposure;
uniform vec2 uSize;
varying vec2 vUv;
// Khronos PBR Neutral (as the main post chain)
vec3 neutral( vec3 color ) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < startCompression ) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / ( peak + d - startCompression );
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
  return mix( color, vec3( newPeak ), g );
}
vec3 toSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
float roundBox( vec2 p, vec2 b, float r ) {
  vec2 q = abs( p ) - b + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
void main() {
  // mirror: left and right swapped
  vec2 uv = vec2( 1.0 - vUv.x, vUv.y );
  vec3 c = texture2D( tMirror, uv ).rgb * uExposure;
  c = toSRGB( clamp( neutral( c ), 0.0, 1.0 ) );
  // rounded frame, a dark bezel, a faint glass sheen across the top
  vec2 px = ( vUv - 0.5 ) * uSize;
  float d = roundBox( px, uSize * 0.5, uSize.y * 0.22 );
  float bezel = smoothstep( -5.0, -3.5, d );
  c = mix( c, vec3( 0.03, 0.03, 0.035 ), bezel );
  c += vec3( 0.05 ) * smoothstep( 0.7, 1.0, vUv.y ) * ( 1.0 - bezel );
  float a = 1.0 - smoothstep( -1.0, 0.5, d );
  gl_FragColor = vec4( c, a );
}`;

export class RearMirror {
  private readonly rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
  private readonly cam = new THREE.PerspectiveCamera(22, W / H, 0.3, 240);
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private frame = 0;
  private fresh = false;

  constructor() {
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      uniforms: { tMirror: { value: this.rt.texture }, uExposure: { value: 1 }, uSize: { value: new THREE.Vector2(W, H) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.quadScene.add(q);
  }

  /** forget the last image (a cut, a new car): the next draw renders first */
  reset() {
    this.fresh = false;
  }

  /**
   * Render (every other frame) and draw the mirror. `carRoot`: the car whose mirror it is;
   * `exposure`: the main grade's exposure (so it matches the picture).
   */
  /** scenery the mirror leaves out (grass blades, far towns, the pylons…): hidden while it renders */
  skip: THREE.Object3D[] = [];
  private readonly skipWas: boolean[] = [];

  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, carRoot: THREE.Object3D, exposure: number) {
    if (!this.fresh || this.frame++ % 3 === 0) {
      carRoot.updateWorldMatrix(true, false);
      const e = carRoot.matrixWorld.elements;
      this.fwd.set(e[8], e[9], e[10]).normalize();
      this.up.set(e[4], e[5], e[6]).normalize();
      // just behind and above the rear wing, looking back down the road
      this.cam.position.setFromMatrixPosition(carRoot.matrixWorld).addScaledVector(this.fwd, -2.9).addScaledVector(this.up, 1.02);
      this.tmp.copy(this.cam.position).addScaledVector(this.fwd, -30).addScaledVector(this.up, -1.1);
      this.cam.up.copy(this.up);
      this.cam.lookAt(this.tmp);
      this.cam.updateMatrixWorld();
      const prevRT = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const prevShadow = renderer.shadowMap.autoUpdate;
      // (the shadow maps are the main camera's: reuse them)
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(this.rt);
      this.skip.forEach((o, i) => {
        this.skipWas[i] = o.visible;
        o.visible = false;
      });
      renderer.render(scene, this.cam);
      this.skip.forEach((o, i) => (o.visible = this.skipWas[i]));
      renderer.setRenderTarget(prevRT);
      renderer.autoClear = prevAuto;
      renderer.shadowMap.autoUpdate = prevShadow;
      this.fresh = true;
    }
    // draw into the top centre of the screen
    renderer.getSize(this.size);
    const sw = this.size.x;
    const sh = this.size.y;
    const w = Math.round(Math.min(sw * 0.3, 460));
    const h = Math.round((w * H) / W);
    const x = Math.round((sw - w) / 2);
    const y = Math.round(sh - h - Math.max(10, sh * 0.018));
    this.mat.uniforms.uExposure.value = exposure;
    (this.mat.uniforms.uSize.value as THREE.Vector2).set(w, h);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.render(this.quadScene, this.quadCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, sw, sh);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.rt.dispose();
    this.mat.dispose();
  }
}
