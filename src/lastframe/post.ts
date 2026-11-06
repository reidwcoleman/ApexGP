import * as THREE from 'three';
import { LF } from './lighting.ts';

/**
 * The camera on the vest: a wide cheap lens on a small sensor. HDR scene -> shutter blur -> bloom ->
 * slow auto exposure -> one composite that bends the picture through a fisheye, fringes its edges,
 * grades it hard, then adds what a recording does to it: sharpening, grain, compression.
 */

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const DOWN = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 px;
uniform float first;
vec3 q( vec2 uv ) {
  vec3 c = min( texture2D( tSrc, uv ).rgb, vec3( 60.0 ) );
  return c;
}
void main() {
  vec3 a = q( vUv + px * vec2( -1, -1 ) ), b = q( vUv + px * vec2( 1, -1 ) ), c = q( vUv + px * vec2( -1, 1 ) ), d = q( vUv + px * vec2( 1, 1 ) );
  vec3 s = ( a + b + c + d ) * 0.25;
  gl_FragColor = vec4( s, 1.0 );
}
`;

const UP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tAdd;
uniform vec2 px;
uniform float k;
void main() {
  vec3 s = vec3( 0.0 );
  s += texture2D( tSrc, vUv + px * vec2( -1, -1 ) ).rgb;
  s += texture2D( tSrc, vUv + px * vec2( 1, -1 ) ).rgb;
  s += texture2D( tSrc, vUv + px * vec2( -1, 1 ) ).rgb;
  s += texture2D( tSrc, vUv + px * vec2( 1, 1 ) ).rgb;
  s += texture2D( tSrc, vUv ).rgb * 4.0;
  gl_FragColor = vec4( s / 8.0 * k + texture2D( tAdd, vUv ).rgb, 1.0 );
}
`;

const EXPO = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tPrev;
uniform float dt;
uniform float cut;
void main() {
  float acc = 0.0, wsum = 0.0;
  for ( int j = 0; j < 7; j++ ) for ( int i = 0; i < 9; i++ ) {
    vec2 uv = ( vec2( float( i ), float( j ) ) + 0.5 ) / vec2( 9.0, 7.0 );
    vec2 c = uv - 0.5;
    float w = exp( -dot( c, c ) * 7.0 );
    float l = dot( texture2D( tSrc, uv ).rgb, vec3( 0.3, 0.59, 0.11 ) );
    acc += log2( max( l, 1e-4 ) ) * w;
    wsum += w;
  }
  float avg = exp2( acc / wsum );
  // a small sensor: it opens slowly into the dark and shuts faster on the light
  float want = clamp( 0.105 / max( avg, 1e-4 ), 0.4, 5.5 );
  float prev = texture2D( tPrev, vec2( 0.5 ) ).r;
  float rate = want < prev ? 2.6 : 0.9;
  float e = cut > 0.5 ? want : exp( mix( log( prev ), log( want ), 1.0 - exp( -dt * rate ) ) );
  gl_FragColor = vec4( e, avg, 0.0, 1.0 );
}
`;

const BLUR = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tDepth;
uniform mat4 reproj;  // this frame's clip -> last frame's clip
uniform float amount;
void main() {
  float z = texture2D( tDepth, vUv ).r;
  vec4 p = vec4( vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0 );
  vec4 q = reproj * p;
  vec2 prev = q.xy / q.w * 0.5 + 0.5;
  vec2 v = ( vUv - prev ) * amount;
  float l = length( v );
  v *= min( 1.0, 0.05 / max( l, 1e-5 ) );
  vec3 c = vec3( 0.0 );
  float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
  for ( int i = 0; i < 6; i++ ) {
    float t = ( float( i ) + n + 0.5 ) / 6.0 - 0.5;
    c += min( texture2D( tSrc, vUv + v * t ).rgb, vec3( 40.0 ) );
  }
  gl_FragColor = vec4( c / 6.0, 1.0 );
}
`;

const FINAL = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform sampler2D tBloom;
uniform sampler2D tHalf;
uniform sampler2D tBlock;
uniform sampler2D tExp;
uniform vec2 res;
uniform float time;
uniform float tanHalf;
uniform float fish;
uniform float whiteout;
uniform float hurt;
uniform float glitch;
uniform float feedCut;
uniform float grainK;

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

vec2 lens( vec2 p, float rho, float k, float aspect ) {
  float rd = sqrt( aspect * aspect + 1.0 );
  float thd = atan( rd * tanHalf );
  float th = rho / rd * thd;
  float rin = tan( th ) / tanHalf;
  float s = mix( 1.0, rin / max( rho, 1e-4 ), fish ) * k;
  // keep the frame filled: the corners land on the corners
  return p * s;
}

vec3 film( vec3 x ) {
  // filmic toe and shoulder, harder than a game: the sensor clips
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
}

void main() {
  float aspect = res.x / res.y;
  vec2 uv = vUv;
  // a torn feed
  if ( glitch > 0.0 ) {
    float band = floor( uv.y * 24.0 + time * 13.0 );
    float r = hash( vec2( band, floor( time * 22.0 ) ) );
    uv.x += ( r - 0.5 ) * glitch * step( 0.62, r ) * 0.14;
  }
  vec2 p = ( uv - 0.5 ) * 2.0 * vec2( aspect, 1.0 );
  float rho = length( p );
  float rd = sqrt( aspect * aspect + 1.0 );
  float edge = rho / rd;

  float ca = 0.0016 + 0.016 * edge * edge * edge;
  vec2 cr = lens( p, rho, 1.0 + ca, aspect ) / ( 2.0 * vec2( aspect, 1.0 ) ) + 0.5;
  vec2 cg = lens( p, rho, 1.0, aspect ) / ( 2.0 * vec2( aspect, 1.0 ) ) + 0.5;
  vec2 cb = lens( p, rho, 1.0 - ca, aspect ) / ( 2.0 * vec2( aspect, 1.0 ) ) + 0.5;

  vec3 c = vec3( texture2D( tSrc, cr ).r, texture2D( tSrc, cg ).g, texture2D( tSrc, cb ).b );
  // unsharp mask, as the camera's own processing does it
  vec3 soft = texture2D( tHalf, cg ).rgb;
  c = max( c + ( c - soft ) * 0.3, vec3( 0.0 ) );
  vec3 bloom = texture2D( tBloom, cg ).rgb;
  float expo = texture2D( tExp, vec2( 0.5 ) ).r;
  vec3 hdr = c + bloom * 0.075 + whiteout * 9.0;
  // macroblocks: the dark parts of a stream fall apart first
  vec2 blk = ( floor( cg * res / 10.0 ) + 0.5 ) * 10.0 / res;
  vec3 bl = texture2D( tBlock, blk ).rgb;
  float lum0 = dot( hdr * expo, vec3( 0.3, 0.6, 0.1 ) );
  float blum = dot( bl * expo, vec3( 0.3, 0.6, 0.1 ) );
  hdr = mix( hdr, bl, 0.3 * smoothstep( 0.14, 0.0, lum0 ) * smoothstep( 0.2, 0.05, blum ) );
  hdr *= expo;

  vec3 col = film( hdr * 0.92 );
  // a cheap sensor's colour: thin, cold shadows
  float l = dot( col, vec3( 0.3, 0.59, 0.11 ) );
  col = mix( vec3( l ), col, 0.8 );
  col *= mix( vec3( 0.93, 1.0, 1.05 ), vec3( 1.02, 1.0, 0.97 ), smoothstep( 0.0, 0.5, l ) );
  col = pow( col, vec3( 1.1 ) );
  // lens falloff and the housing's rounded corners, with a coloured rim
  float vig = 1.0 - smoothstep( 0.5, 1.1, edge ) * 0.5;
  col *= vig;
  vec2 q = abs( p ) / vec2( aspect, 1.0 );
  float corner = length( max( q - vec2( 0.86, 0.8 ), 0.0 ) / vec2( 0.14, 0.2 ) );
  float rim = smoothstep( 0.86, 1.06, corner );
  col = mix( col, col * vec3( 1.3, 0.92, 0.72 ) + vec3( 0.05, 0.015, 0.0 ) * smoothstep( 0.6, 1.0, corner ), smoothstep( 0.6, 1.0, corner ) * 0.5 );
  col *= 1.0 - rim;
  // hurt: the world drains and the lens darkens
  float hl = dot( col, vec3( 0.3, 0.59, 0.11 ) );
  col = mix( col, vec3( hl ) * vec3( 1.05, 0.9, 0.88 ), hurt * 0.75 );
  col *= 1.0 - hurt * 0.3 * smoothstep( 0.2, 0.9, edge );
  // sensor noise, heavier in the dark
  vec2 gp = floor( gl_FragCoord.xy / 1.5 );
  float g = hash( gp + fract( time ) * 91.7 ) - 0.5;
  float g2 = hash( gp * 1.7 + fract( time * 1.3 ) * 37.1 ) - 0.5;
  float gk = mix( 0.038, 0.013, smoothstep( 0.0, 0.42, l ) ) * grainK;
  col += vec3( g + g2 * 0.15, g, g - g2 * 0.15 ) * gk;
  col = mix( col, vec3( 0.0 ), feedCut );
  col = pow( max( col, 0.0 ), vec3( 1.0 / 2.2 ) );
  gl_FragColor = vec4( col, 1.0 );
}
`;

function pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

function target(w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType, filter: THREE.TextureFilter = THREE.LinearFilter) {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type, minFilter: filter as THREE.MinificationTextureFilter, magFilter: filter as THREE.MagnificationTextureFilter, depthBuffer: false, generateMipmaps: false });
}

export class Post {
  scale = 1;
  scene!: THREE.WebGLRenderTarget;
  private blur!: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private exp = [target(1, 1, THREE.FloatType, THREE.NearestFilter), target(1, 1, THREE.FloatType, THREE.NearestFilter)];
  private ei = 0;
  private quad: THREE.Mesh;
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private qs = new THREE.Scene();
  private mDown = pass(DOWN, { tSrc: { value: null }, px: { value: new THREE.Vector2() }, first: { value: 0 } });
  private mUp = pass(UP, { tSrc: { value: null }, tAdd: { value: null }, px: { value: new THREE.Vector2() }, k: { value: 1 } });
  private mExp = pass(EXPO, { tSrc: { value: null }, tPrev: { value: null }, dt: { value: 0 }, cut: { value: 1 } });
  private mBlur = pass(BLUR, { tSrc: { value: null }, tDepth: { value: null }, reproj: { value: new THREE.Matrix4() }, amount: { value: 1 } });
  mFinal = pass(FINAL, {
    tSrc: { value: null }, tBloom: { value: null }, tHalf: { value: null }, tBlock: { value: null }, tExp: { value: null }, res: { value: new THREE.Vector2() }, time: { value: 0 },
    tanHalf: { value: 0.9 }, fish: { value: 0.85 }, whiteout: { value: 0 }, hurt: { value: 0 }, glitch: { value: 0 }, feedCut: { value: 0 }, grainK: { value: 1 },
  });
  private prevVP = new THREE.Matrix4();
  private curVP = new THREE.Matrix4();
  private hadPrev = false;
  /** next frame jumps straight to the right exposure */
  cutExposure = true;
  motionBlur = true;
  msaa = 2;

  constructor(private r: THREE.WebGLRenderer) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mFinal);
    this.quad.frustumCulled = false;
    this.qs.add(this.quad);
  }

  resize(w: number, h: number) {
    for (const t of [this.scene, this.blur, ...this.down, ...this.up]) t?.dispose();
    const W = Math.round(w), H = Math.round(h);
    this.scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: this.msaa, depthBuffer: true, depthTexture: new THREE.DepthTexture(W, H, THREE.UnsignedIntType) });
    this.scene.texture.minFilter = this.scene.texture.magFilter = THREE.LinearFilter;
    this.blur = target(W, H);
    this.down = [];
    this.up = [];
    let a = W, b = H;
    for (let i = 0; i < 6; i++) {
      a = Math.ceil(a / 2);
      b = Math.ceil(b / 2);
      this.down.push(target(a, b));
      if (i < 5) this.up.push(target(a, b));
    }
    this.mFinal.uniforms.res.value.set(W, H);
    this.cutExposure = true;
  }

  private draw(m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    this.r.setRenderTarget(to);
    this.r.render(this.qs, this.ortho);
  }

  render(scene: THREE.Scene, cam: THREE.PerspectiveCamera, dt: number, time: number) {
    const r = this.r;
    r.setRenderTarget(this.scene);
    r.clear();
    r.render(scene, cam);
    let src = this.scene.texture;
    // ---- shutter blur from the camera's own motion
    this.curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (this.motionBlur && this.hadPrev) {
      const u = this.mBlur.uniforms;
      u.tSrc.value = src;
      u.tDepth.value = this.scene.depthTexture;
      u.reproj.value.copy(this.curVP).invert().premultiply(this.prevVP);
      u.amount.value = Math.min(1, (1 / 90) / Math.max(dt, 1e-3));
      this.draw(this.mBlur, this.blur);
      src = this.blur.texture;
    }
    this.prevVP.copy(this.curVP);
    this.hadPrev = true;
    // ---- the downsample chain
    let s: THREE.Texture = src, sw = this.scene.width, sh = this.scene.height;
    for (const d of this.down) {
      this.mDown.uniforms.tSrc.value = s;
      this.mDown.uniforms.px.value.set(0.5 / sw, 0.5 / sh);
      this.draw(this.mDown, d);
      s = d.texture;
      sw = d.width;
      sh = d.height;
    }
    // ---- exposure
    const e0 = this.exp[this.ei], e1 = this.exp[1 - this.ei];
    this.mExp.uniforms.tSrc.value = this.down[this.down.length - 1].texture;
    this.mExp.uniforms.tPrev.value = e0.texture;
    this.mExp.uniforms.dt.value = dt;
    this.mExp.uniforms.cut.value = this.cutExposure ? 1 : 0;
    this.cutExposure = false;
    this.draw(this.mExp, e1);
    this.ei = 1 - this.ei;
    // ---- bloom back up
    let b: THREE.Texture = this.down[5].texture;
    for (let i = 4; i >= 0; i--) {
      const t = this.up[i];
      this.mUp.uniforms.tSrc.value = b;
      this.mUp.uniforms.tAdd.value = this.down[i].texture;
      this.mUp.uniforms.px.value.set(1 / t.width, 1 / t.height);
      this.mUp.uniforms.k.value = 0.9;
      this.draw(this.mUp, t);
      b = t.texture;
    }
    const f = this.mFinal.uniforms;
    f.tSrc.value = src;
    f.tBloom.value = b;
    f.tHalf.value = this.down[0].texture;
    f.tBlock.value = this.down[2].texture;
    f.tExp.value = e1.texture;
    f.time.value = time;
    f.tanHalf.value = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    this.draw(this.mFinal, null);
  }
}

/** the wet ground's reflection: the world drawn again from below the street, at half size */
export class Planar {
  rt: THREE.WebGLRenderTarget | null = null;
  private cam = new THREE.PerspectiveCamera();
  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private y = -0.06;
  private n = new THREE.Vector3();
  private t = new THREE.Vector3();
  private f = new THREE.Vector3();
  constructor(private r: THREE.WebGLRenderer) {
    this.black.needsUpdate = true;
    LF.planar.value = this.black;
  }
  resize(w: number, h: number) {
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(Math.round(w / 2.4), Math.round(h / 2.4), { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }
  render(scene: THREE.Scene, cam: THREE.PerspectiveCamera, hide: THREE.Object3D[], on: boolean) {
    LF.planarK.value = on ? 1 : 0;
    if (!on || !this.rt) {
      LF.planar.value = this.black;
      return;
    }
    const c = this.cam, y = this.y;
    c.fov = cam.fov;
    c.aspect = cam.aspect;
    c.near = 0.1;
    c.far = cam.far;
    c.projectionMatrix.copy(cam.projectionMatrix);
    c.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    c.position.copy(cam.position);
    c.position.y = 2 * y - c.position.y;
    this.f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.t.copy(cam.position).add(this.f);
    this.t.y = 2 * y - this.t.y;
    this.n.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.n.y = -this.n.y;
    c.up.copy(this.n);
    c.lookAt(this.t);
    c.updateMatrixWorld();
    LF.planar.value = this.black;
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const auto = this.r.shadowMap.autoUpdate;
    this.r.shadowMap.autoUpdate = false;
    this.r.setRenderTarget(this.rt);
    this.r.clear();
    this.r.render(scene, c);
    this.r.setRenderTarget(null);
    this.r.shadowMap.autoUpdate = auto;
    hide.forEach((o, i) => (o.visible = vis[i]));
    LF.planar.value = this.rt.texture;
    LF.planarVP.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  }
}
