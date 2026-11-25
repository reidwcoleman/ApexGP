import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uSunset;
uniform float uTime;
varying vec3 vDir;
float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  float a=h3(vec3(i,0.)), b=h3(vec3(i+vec2(1,0),0.)), c=h3(vec3(i+vec2(0,1),0.)), d=h3(vec3(i+vec2(1,1),0.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.75, clamp(-h * 4.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  float dayVis = 1.0 - uNight * 0.95;
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.5) * dayVis;
  col += vec3(1.0, 0.42, 0.18) * pow(sd, 3.0) * uSunset * 0.45 * (1.0 - t);
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 18.0 * dayVis;
  // moon
  float md = dot(d, uMoonDir);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99935, 0.9996, md) * 3.0 * uNight;
  col += vec3(0.4, 0.5, 0.8) * pow(max(md, 0.0), 300.0) * 0.4 * uNight;
  // stars
  vec3 sp = d * 260.0;
  vec3 cell = floor(sp);
  float r = h3(cell);
  float star = step(0.9965, r) * smoothstep(0.45, 0.0, length(fract(sp) - 0.5));
  star *= 0.6 + 0.4 * sin(uTime * 3.0 + r * 100.0);
  col += vec3(star) * uNight * smoothstep(0.02, 0.25, h) * 1.4;
  // clouds
  if (h > 0.01) {
    vec2 cp = d.xz / (h + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(cp);
    c = smoothstep(0.58, 0.88, c) * smoothstep(0.0, 0.18, h);
    vec3 cloudCol = mix(vec3(1.0, 0.98, 0.95), uSunColor * 1.1 + uHorizon * 0.3, uSunset * 0.6);
    cloudCol = mix(cloudCol, vec3(0.08, 0.09, 0.14), uNight);
    col = mix(col, cloudCol, c * 0.75);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkySystem {
  time = 16.5;
  /** game hours advanced per real second */
  rate = 1 / 45;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly sunColor = new THREE.Color();
  night = 0;
  day = 1;
  sunset = 0;
  light: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  private envScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnv = -100;
  private shadowSize = 70;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.uniforms = {
      uZenith: { value: this.zenith },
      uHorizon: { value: this.horizon },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: this.sunColor },
      uNight: { value: 0 },
      uSunset: { value: 0 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.scale.setScalar(2000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    envSky.scale.setScalar(50);
    this.envScene.add(envSky);

    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    const s = this.light.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.left = -this.shadowSize;
    s.camera.right = this.shadowSize;
    s.camera.top = this.shadowSize;
    s.camera.bottom = -this.shadowSize;
    s.camera.near = 1;
    s.camera.far = 500;
    s.bias = -0.0004;
    s.normalBias = 0.04;
    scene.add(this.light);
    scene.add(this.light.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a60, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xcfe0ea, 0.0011);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.compute();
  }

  setTime(h: number) {
    this.time = ((h % 24) + 24) % 24;
    this.lastEnv = -100;
    this.compute();
  }

  private compute() {
    const a = ((this.time - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.93, 0.36).normalize();
    this.moonDir.set(-Math.cos(a) * 0.9, -Math.sin(a) * 0.85 + 0.15, -0.3).normalize();
    const e = this.sunDir.y;
    this.day = smoothstep(-0.06, 0.2, e);
    this.night = 1 - smoothstep(-0.14, 0.04, e);
    this.sunset = 1 - smoothstep(0.02, 0.38, Math.abs(e - 0.04));

    const dayZ = new THREE.Color(0.1, 0.32, 0.78), dayH = new THREE.Color(0.6, 0.76, 0.9);
    const setZ = new THREE.Color(0.2, 0.22, 0.5), setH = new THREE.Color(1.0, 0.5, 0.26);
    const nZ = new THREE.Color(0.006, 0.01, 0.03), nH = new THREE.Color(0.035, 0.045, 0.09);
    this.zenith.copy(nZ).lerp(dayZ, this.day).lerp(setZ, this.sunset * 0.55);
    this.horizon.copy(nH).lerp(dayH, this.day).lerp(setH, this.sunset * 0.75);
    this.sunColor.setRGB(1.0, lerp(0.9, 0.58, this.sunset), lerp(0.76, 0.34, this.sunset));
  }

  update(dt: number, focus: THREE.Vector3, camPos: THREE.Vector3, renderer: THREE.WebGLRenderer, elapsed: number) {
    this.time = (this.time + dt * this.rate) % 24;
    this.compute();
    const u = this.uniforms;
    u.uNight.value = this.night;
    u.uSunset.value = this.sunset;
    u.uTime.value = elapsed;
    this.mesh.position.copy(camPos);

    const useSun = this.sunDir.y > -0.03;
    const dir = useSun ? this.sunDir : this.moonDir;
    const L = this.light;
    if (useSun) {
      L.color.copy(this.sunColor);
      L.intensity = 3.8 * this.day + 0.05;
    } else {
      L.color.setRGB(0.55, 0.65, 1.0);
      L.intensity = 0.28 * this.night;
    }
    // snap the shadow frustum to texels to stop shimmering
    const texel = (this.shadowSize * 2) / 2048;
    const fwd = dir.clone().negate();
    const up = Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const pr = Math.round(focus.dot(right) / texel) * texel;
    const pu = Math.round(focus.dot(up2) / texel) * texel;
    const pf = focus.dot(fwd);
    const snapped = right.multiplyScalar(pr).add(up2.multiplyScalar(pu)).add(fwd.clone().multiplyScalar(pf));
    L.target.position.copy(snapped);
    L.position.copy(snapped).addScaledVector(dir, 220);
    L.target.updateMatrixWorld();

    this.hemi.color.copy(this.zenith).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.setRGB(0.42, 0.36, 0.28).multiplyScalar(0.3 + 0.7 * this.day);
    this.hemi.intensity = 0.3 + 0.55 * this.day + 0.12 * this.night;
    if (this.night > 0.5) this.hemi.color.setRGB(0.3, 0.36, 0.6);

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.horizon);
    fog.density = lerp(0.0006, 0.0011, this.night) + this.sunset * 0.00015;
    renderer.toneMappingExposure = lerp(0.92, 1.25, this.night);

    if (Math.abs(this.time - this.lastEnv) > 0.6) {
      this.lastEnv = this.time;
      const rt = this.pmrem.fromScene(this.envScene, 0.04, 0.1, 100);
      this.scene.environment = rt.texture;
      this.envRT?.dispose();
      this.envRT = rt;
    }
    this.scene.environmentIntensity = clamp(0.25 + 0.75 * this.day, 0.15, 1);
  }

  clockString(): string {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${m.toString().padStart(2, '0')} ${ap}`;
  }
}
