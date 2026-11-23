import * as THREE from 'three';

/**
 * The show-off effects: streaks of light behind a bean that's flying (a dive, a boost, a ZOOM),
 * a comic-book burst where something lands a hit, and the glowing shell round a bean with a
 * power-up. All additive and unlit, so the bloom picks them up.
 */

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), COL = new THREE.Color();

// ----------------------------------------------------------------------------- trails
interface Trail {
  /** the last points it was at, newest first */
  p: Float32Array;
  n: number;
  /** how bright (0..1): eases up when it's on, away when it's not */
  k: number;
  r: number;
  g: number;
  b: number;
  seen: number;
}

export class Trails {
  readonly mesh: THREE.Mesh;
  private T = new Map<number, Trail>();
  private pos: Float32Array;
  private col: Float32Array;
  private frame = 0;
  constructor(
    private max = 26,
    private N = 16,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * N * 2 * 3);
    this.col = new Float32Array(max * N * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    // (across the ribbon: a soft edge and a bright core, so it reads as a streak of light, not a tape)
    const uv = new Float32Array(max * N * 2 * 2);
    for (let k = 0; k < max * N; k++) {
      uv[k * 4] = 0;
      uv[k * 4 + 2] = 1;
      uv[k * 4 + 1] = uv[k * 4 + 3] = 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 4;
    const cx = cv.getContext('2d')!;
    const gr = cx.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr;
    cx.fillRect(0, 0, 64, 4);
    const map = new THREE.CanvasTexture(cv);
    const idx: number[] = [];
    for (let t = 0; t < max; t++)
      for (let k = 0; k < N - 1; k++) {
        const o = (t * N + k) * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  clear() {
    this.T.clear();
    this.mesh.geometry.setDrawRange(0, 0);
  }
  /** a bean this frame: where it is, whether it's streaking, and in what colour */
  feed(id: number, at: THREE.Vector3, on: boolean, color: number, dt: number) {
    let t = this.T.get(id);
    if (!t) {
      if (!on || this.T.size >= this.max) return;
      this.T.set(id, (t = { p: new Float32Array(this.N * 3), n: 0, k: 0, r: 1, g: 1, b: 1, seen: 0 }));
    }
    t.seen = this.frame;
    t.k += ((on ? 1 : 0) - t.k) * Math.min(1, dt * (on ? 9 : 3.2));
    if (on) {
      COL.set(color);
      t.r = COL.r;
      t.g = COL.g;
      t.b = COL.b;
    }
    const p = t.p;
    // (a jump: a respawn, a kick-off: the streak starts again)
    if (t.n && (p[0] - at.x) ** 2 + (p[1] - at.y) ** 2 + (p[2] - at.z) ** 2 > 64) t.n = 0;
    if (!t.n || (p[0] - at.x) ** 2 + (p[1] - at.y) ** 2 + (p[2] - at.z) ** 2 > 0.16) {
      p.copyWithin(3, 0, (this.N - 1) * 3);
      t.n = Math.min(this.N, t.n + 1);
    }
    p[0] = at.x;
    p[1] = at.y;
    p[2] = at.z;
  }
  /** the ribbons, turned to face the camera */
  update(cam: THREE.Camera) {
    const pos = this.pos, col = this.col, N = this.N;
    let slot = 0;
    for (const [id, t] of this.T) {
      if (t.seen !== this.frame || (t.k < 0.02 && t.n > 1)) {
        if (t.seen !== this.frame || t.k < 0.02) this.T.delete(id);
        continue;
      }
      if (slot >= this.max) break;
      const p = t.p;
      for (let k = 0; k < N; k++) {
        const j = Math.min(k, Math.max(0, t.n - 1));
        A.set(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
        const j2 = Math.min(j + 1, Math.max(0, t.n - 1)), j0 = Math.max(0, j - 1);
        B.set(p[j0 * 3] - p[j2 * 3], p[j0 * 3 + 1] - p[j2 * 3 + 1], p[j0 * 3 + 2] - p[j2 * 3 + 2]);
        C.subVectors(cam.position, A);
        B.cross(C);
        const l = B.length();
        const f = 1 - k / (N - 1);
        // (wide at the bean, a point at the end; nothing at all past the points it has)
        const w = l > 1e-5 && k < t.n ? (0.42 * f * (0.25 + 0.75 * f)) / l : 0;
        const o = (slot * N + k) * 6;
        pos[o] = A.x + B.x * w;
        pos[o + 1] = A.y + B.y * w;
        pos[o + 2] = A.z + B.z * w;
        pos[o + 3] = A.x - B.x * w;
        pos[o + 4] = A.y - B.y * w;
        pos[o + 5] = A.z - B.z * w;
        // (its own colour run hot so the bloom catches it, whitening toward the bean; see-through toward the tail)
        const c2 = (slot * N + k) * 8, hot = 1.5 + f * 1.3, wh = f * f * 0.3;
        col[c2] = col[c2 + 4] = (t.r + (1 - t.r) * wh) * hot;
        col[c2 + 1] = col[c2 + 5] = (t.g + (1 - t.g) * wh) * hot;
        col[c2 + 2] = col[c2 + 6] = (t.b + (1 - t.b) * wh) * hot;
        col[c2 + 3] = col[c2 + 7] = t.k * f * Math.sqrt(f) * 0.72;
      }
      slot++;
    }
    this.frame++;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, slot * (N - 1) * 6);
  }
}

// ----------------------------------------------------------------------------- bursts
function burstArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.translate(128, 128);
  // a spiky star, comic-book style, soft in the middle
  x.fillStyle = '#ffffff';
  x.beginPath();
  const n = 14;
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2, r = k % 2 ? 46 + (k % 4) * 6 : 118 - (k % 6) * 7;
    if (k) x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
  x.fill();
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 120);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = g;
  x.fillRect(-128, -128, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Bursts {
  readonly group = new THREE.Group();
  private S: { s: THREE.Sprite; t: number; max: number; size: number }[] = [];
  private tex = burstArt();
  /** a flash where something hit: `size` metres across at its biggest */
  burst(at: THREE.Vector3, size: number, color: number, life = 0.24) {
    let o = this.S.find((q) => q.t <= 0);
    if (!o) {
      if (this.S.length >= 16) return;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      s.renderOrder = 4;
      o = { s, t: 0, max: 1, size: 1 };
      this.group.add(s);
      this.S.push(o);
    }
    o.t = o.max = life;
    o.size = size;
    o.s.position.copy(at);
    o.s.material.color.set(color);
    o.s.material.rotation = Math.random() * 6.3;
    o.s.visible = true;
  }
  update(dt: number) {
    for (const o of this.S) {
      if (o.t <= 0) continue;
      o.t -= dt;
      const k = 1 - Math.max(0, o.t) / o.max;
      o.s.scale.setScalar(o.size * (0.35 + 0.65 * (1 - (1 - k) * (1 - k))));
      o.s.material.opacity = (1 - k) * (1 - k) * 1.4;
      if (o.t <= 0) o.s.visible = false;
    }
  }
}

// ----------------------------------------------------------------------------- auras
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
export class Auras {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor() {
    // (an energy shell: clear in the middle, bright at the edge, so the bean inside is still seen)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = normalize(-mv.xyz);
          #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
          #else
          vC = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main() {
          float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.3);
          gl_FragColor = vec4(vC * (0.06 + f * 1.7), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), mat, 26);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    this.mesh.setColorAt(0, COL.set(0xffffff));
  }
  begin() {
    this.n = 0;
  }
  /** a bean with a power-up on: a glowing shell round it, beating */
  add(at: THREE.Vector3, color: number, t: number, last: number) {
    if (this.n >= 26) return;
    // (the last second and a half: it flickers, running out)
    if (last < 1.5 && Math.sin(t * 22) < 0) return;
    const s = 1.02 + Math.sin(t * 7 + at.x) * 0.07;
    this.mesh.setMatrixAt(this.n, M.compose(A.set(at.x, at.y + 0.18, at.z), Q.identity(), SC.set(s, s * 1.22, s)));
    this.mesh.setColorAt(this.n, COL.set(color));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
