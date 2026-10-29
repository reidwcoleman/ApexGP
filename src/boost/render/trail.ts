import * as THREE from 'three';

/**
 * A boost trail as a ribbon of light: each nozzle lays down a point every frame while boosting, and
 * a strip facing the camera is drawn through them, white-hot at the nozzle, cooling to the trail's
 * colour, widening and fading as it ages. Everything in the simulation frame (cm).
 */

const MAX = 64;

interface Pt {
  x: number;
  y: number;
  z: number;
  t: number;
  /** the first point after a gap: no strip back to the one before */
  cut: boolean;
}

export interface RibbonStyle {
  /** colour at the head and down the body (HDR) */
  head: THREE.Color;
  body: THREE.Color;
  /** seconds a point lives, width at the nozzle and how much it spreads by the end */
  life: number;
  w0: number;
  w1: number;
  /** 0 smooth, 1 flickering bands (lightning), 2 hue running down it (rainbow) */
  kind: number;
}

export class Ribbon {
  readonly mesh: THREE.Mesh;
  private pts: Pt[] = [];
  private pos: Float32Array;
  private aux: Float32Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private lastT = -1;
  private idx: THREE.BufferAttribute;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 2 * 3);
    this.aux = new Float32Array(MAX * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    // aux: (age 0…1, side −1/+1, when the point was laid: the wisps stay fixed to the air they're in)
    this.geo.setAttribute('aux', new THREE.BufferAttribute(this.aux, 3).setUsage(THREE.DynamicDrawUsage));
    this.idx = new THREE.BufferAttribute(new Uint16Array((MAX - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setIndex(this.idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uHead: { value: new THREE.Color() }, uBody: { value: new THREE.Color() }, uT: { value: 0 }, uKind: { value: 0 } },
      vertexShader: `attribute vec3 aux; varying vec3 vA; void main(){ vA = aux; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uHead, uBody; uniform float uT, uKind; varying vec3 vA;
        vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
        float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
        void main(){
          float a = vA.x;
          float y = vA.y;
          float s = vA.z;
          // filaments of energy: noise fixed to where each piece was laid, drifting across as it ages
          float n = vn(vec2(s * 18.0, y * 2.2 + a * 3.0 + s * 4.0)) * 0.65 + vn(vec2(s * 41.0, y * 5.0 - a * 4.0)) * 0.35;
          // a tight white-hot core, a soft halo round it, the wisps between
          float core = exp(-y * y * 30.0) * (1.0 - a * 0.6);
          float halo = exp(-y * y * 2.6) * 0.38;
          float fil = smoothstep(0.45, 0.85, n) * exp(-y * y * 5.0) * 0.9;
          // the edges eat in as it cools, so it breaks up into smoke-like tatters
          float erode = smoothstep(0.0, 0.25, n + 0.55 - abs(y) * (0.4 + a * 1.1));
          vec3 body = uKind > 1.5 ? hue(a * 1.6 - uT * 0.8 + y * 0.1) * 2.6 : uBody;
          vec3 c = mix(uHead, body, smoothstep(0.0, 0.3, a));
          c = mix(c, uHead * 1.2 + 0.4, core * (1.0 - smoothstep(0.0, 0.5, a)) * 0.6);
          float fade = pow(1.0 - a, 1.5) * smoothstep(0.0, 0.03, a + 0.01);
          if (uKind > 0.5 && uKind < 1.5) fade *= 0.5 + 0.5 * step(0.5, fract(a * 9.0 - uT * 14.0 + n * 0.6));
          float k = (core * 1.5 + halo + fil) * erode * fade;
          gl_FragColor = vec4(c * k, k);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.geo.setDrawRange(0, 0);
  }

  /** lay down a point (call each frame while boosting) */
  push(x: number, y: number, z: number, t: number): void {
    const cut = this.lastT < 0 || t - this.lastT > 0.08;
    this.lastT = t;
    this.pts.unshift({ x, y, z, t, cut });
    if (this.pts.length > MAX) this.pts.length = MAX;
  }

  /** rebuild the strip facing the camera (cam in sim cm) */
  update(t: number, cam: THREE.Vector3, st: RibbonStyle): void {
    this.mat.uniforms.uHead.value.copy(st.head);
    this.mat.uniforms.uBody.value.copy(st.body);
    this.mat.uniforms.uT.value = t;
    this.mat.uniforms.uKind.value = st.kind;
    while (this.pts.length && t - this.pts[this.pts.length - 1].t > st.life) this.pts.pop();
    const P = this.pts;
    const n = P.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    const dir = new THREE.Vector3();
    const view = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(n - 1, i + 1)];
      dir.set(a.x - b.x, a.y - b.y, a.z - b.z);
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
      dir.normalize();
      view.set(cam.x - P[i].x, cam.y - P[i].y, cam.z - P[i].z).normalize();
      side.crossVectors(dir, view);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      const age = Math.min(1, (t - P[i].t) / st.life);
      // (wide: the halo and the wisps fill it, the core stays narrow)
      const w = (st.w0 + (st.w1 - st.w0) * Math.sqrt(age)) * 1.7;
      for (let s = 0; s < 2; s++) {
        const k = s ? 1 : -1;
        const o = (i * 2 + s) * 3;
        this.pos[o] = P[i].x + side.x * w * k;
        this.pos[o + 1] = P[i].y + side.y * w * k;
        this.pos[o + 2] = P[i].z + side.z * w * k;
        this.aux[(i * 2 + s) * 3] = age;
        this.aux[(i * 2 + s) * 3 + 1] = k;
        this.aux[(i * 2 + s) * 3 + 2] = P[i].t % 512;
      }
    }
    // the strip's quads, leaving out any that would bridge a gap
    const I = this.idx.array as Uint16Array;
    let m = 0;
    for (let i = 0; i < n - 1; i++) {
      if (P[i].cut) continue;
      I.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], m);
      m += 6;
    }
    this.idx.needsUpdate = true;
    this.geo.setDrawRange(0, m);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aux as THREE.BufferAttribute).needsUpdate = true;
  }
}
