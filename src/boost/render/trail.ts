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
    this.aux = new Float32Array(MAX * 2 * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    // aux: (age 0…1, side −1/+1)
    this.geo.setAttribute('aux', new THREE.BufferAttribute(this.aux, 2).setUsage(THREE.DynamicDrawUsage));
    this.idx = new THREE.BufferAttribute(new Uint16Array((MAX - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setIndex(this.idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uHead: { value: new THREE.Color() }, uBody: { value: new THREE.Color() }, uT: { value: 0 }, uKind: { value: 0 } },
      vertexShader: `attribute vec2 aux; varying vec2 vA; void main(){ vA = aux; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uHead, uBody; uniform float uT, uKind; varying vec2 vA;
        vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
        void main(){
          float a = vA.x;
          // soft across the strip, a brighter core line down the middle
          float e = 1.0 - abs(vA.y);
          float across = e * (0.5 + 0.8 * e * e * e);
          vec3 body = uKind > 1.5 ? hue(a * 1.6 - uT * 0.8) * 2.6 : uBody;
          vec3 c = mix(uHead, body, smoothstep(0.0, 0.3, a));
          float fade = pow(1.0 - a, 1.6) * smoothstep(0.0, 0.03, a + 0.01);
          if (uKind > 0.5 && uKind < 1.5) fade *= 0.55 + 0.45 * step(0.5, fract(a * 9.0 - uT * 14.0));
          float k = across * fade;
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
      const w = st.w0 + (st.w1 - st.w0) * Math.sqrt(age);
      for (let s = 0; s < 2; s++) {
        const k = s ? 1 : -1;
        const o = (i * 2 + s) * 3;
        this.pos[o] = P[i].x + side.x * w * k;
        this.pos[o + 1] = P[i].y + side.y * w * k;
        this.pos[o + 2] = P[i].z + side.z * w * k;
        this.aux[(i * 2 + s) * 2] = age;
        this.aux[(i * 2 + s) * 2 + 1] = k;
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
