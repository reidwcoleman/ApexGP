import * as THREE from 'three';
import { PIECES, T, H, ROAD_W, SLAB, levelY, footprint, toWorld, worldFrames, pieceMesh, Slot, type Placed, type MeshOut } from './pieces.ts';
import { THEMES, type Theme } from './theme.ts';
import { Batch, kitPart, kitReady, pieceMatrix } from './kit.ts';

/** seeded random */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const col = new THREE.Color();
function slotColor(th: Theme, slot: number) {
  switch (slot) {
    case Slot.Road: return th.road;
    case Slot.Edge: return th.edge;
    case Slot.EdgeAlt: return th.edgeAlt;
    case Slot.Side: return th.side;
    case Slot.Under: return th.under;
    case Slot.Boost: return th.boost;
    case Slot.Line: return th.roadLine;
    case Slot.Block: return th.block;
    case Slot.BlockSide: return th.blockSide;
  }
  return 0xff00ff;
}

/** three geometry from the piece mesh builder, coloured by the theme */
export function meshGeometry(m: MeshOut, th: Theme): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
  const c = new Float32Array(m.slot.length * 3);
  m.slot.forEach((s, i) => {
    col.setHex(slotColor(th, s));
    // a little per-quad variation keeps big flat areas alive
    const v = s === Slot.Road ? 1 + (((i >> 2) * 2654435761) % 7 - 3) * 0.006 : 1;
    c[i * 3] = col.r * v; c[i * 3 + 1] = col.g * v; c[i * 3 + 2] = col.b * v;
  });
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setIndex(m.idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

// ---------------------------------------------------------------- sky

/** the panorama rendered in Cycles for each theme (blender/tracksmith/sky.py) */
const skyMaps = new Map<string, THREE.Texture>();
function skyMap(i: number) {
  const url = `tracksmith/sky/sky${i}.webp`;
  let t = skyMaps.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    // (no mipmaps: they would draw a seam where the panorama wraps)
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;
    skyMaps.set(url, t);
  }
  return t;
}

function panoramaMaterial(i: number) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { map: { value: skyMap(i) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform sampler2D map; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec2 uv = vec2(0.5 + atan(d.x, -d.z) / 6.2831853, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
        gl_FragColor = texture2D(map, uv);
        #include <colorspace_fragment>
      }`,
  });
}

function skyMaterial(th: Theme) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(th.skyTop) },
      hor: { value: new THREE.Color(th.skyHorizon) },
      gnd: { value: new THREE.Color(th.skyGround) },
      sun: { value: new THREE.Vector3(...th.sunDir).normalize() },
      sunCol: { value: new THREE.Color(th.sunColor) },
      stars: { value: th.stars ? 1 : 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 top, hor, gnd, sun, sunCol; uniform float stars; varying vec3 vDir;
      float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y,0.0,1.0), 0.55)) : mix(hor, gnd, clamp(-y*6.0,0.0,1.0));
        float s = max(dot(d, sun), 0.0);
        c += sunCol * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.18 + pow(s, 3.0) * 0.06);
        if (stars > 0.5 && y > 0.05) {
          vec2 g = vec2(atan(d.z, d.x) * 120.0, y * 160.0);
          vec2 id = floor(g);
          float r = h21(id);
          float st = step(0.985, r) * smoothstep(0.45, 0.0, length(fract(g) - 0.5)) * smoothstep(0.05, 0.4, y);
          c += vec3(st) * 0.9;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- props (all low-poly, built here)

function flatGeo(g: THREE.BufferGeometry, color: number, jitter = 0, seed = 1) {
  g = g.index ? g.toNonIndexed() : g;
  if (jitter) {
    const r = rng(seed);
    const p = g.getAttribute('position');
    // move shared positions together so faces stay closed
    const map = new Map<string, [number, number, number]>();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!map.has(k)) map.set(k, [(r() - 0.5) * jitter, (r() - 0.5) * jitter, (r() - 0.5) * jitter]);
      const o = map.get(k)!;
      p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
    }
  }
  const c = new Float32Array(g.getAttribute('position').count * 3);
  col.setHex(color);
  for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    colr.set(p.getAttribute('color').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function propGeos(th: Theme): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
    g.scale(sx, sy, sz); g.rotateY(ry); g.translate(x, y, z); return g;
  };
  if (th.props === 'pine') {
    for (let v = 0; v < 3; v++) {
      const parts = [flatGeo(at(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6), 0, 1.2, 0), 0x6b4a32)];
      const greens = [0x2f6b45, 0x3a7a4c, 0x285e3d];
      for (let k = 0; k < 3; k++) parts.push(flatGeo(at(new THREE.ConeGeometry(3.2 - k * 0.8, 3.6, 7), 0, 3 + k * 2.2, 0), greens[(k + v) % 3], 0.35, v * 10 + k));
      out.push(merge(parts));
    }
    out.push(merge([flatGeo(new THREE.DodecahedronGeometry(1.6, 0), 0x9aa3ad, 0.5, 7)]));
  } else if (th.props === 'mesa') {
    for (let v = 0; v < 2; v++) {
      const g = 0x5f8f4c;
      const parts = [flatGeo(at(new THREE.CylinderGeometry(0.45, 0.5, 4.2, 7), 0, 2.1, 0), g)];
      parts.push(flatGeo(at(new THREE.CylinderGeometry(0.3, 0.32, 1.6, 6), 1.0, 2.6 + v * 0.4, 0), g));
      parts.push(flatGeo(at(new THREE.CylinderGeometry(0.3, 0.32, 0.9, 6).rotateZ(Math.PI / 2), 0.55, 1.9 + v * 0.4, 0), g));
      if (v) {
        parts.push(flatGeo(at(new THREE.CylinderGeometry(0.28, 0.3, 1.3, 6), -0.95, 2.3, 0), g));
        parts.push(flatGeo(at(new THREE.CylinderGeometry(0.28, 0.3, 0.8, 6).rotateZ(Math.PI / 2), -0.5, 1.75, 0), g));
      }
      out.push(merge(parts));
    }
    out.push(merge([flatGeo(new THREE.DodecahedronGeometry(1.8, 0), 0xc77f52, 0.6, 3)]));
    out.push(merge([flatGeo(at(new THREE.DodecahedronGeometry(1.2, 0), 0, 0.3, 0, 1.6, 0.7, 1.2), 0xb86a42, 0.4, 5)]));
  } else if (th.props === 'palm') {
    for (let v = 0; v < 2; v++) {
      const parts: THREE.BufferGeometry[] = [];
      const lean = 0.15 + v * 0.12;
      for (let k = 0; k < 6; k++) {
        const seg = new THREE.CylinderGeometry(0.26 - k * 0.02, 0.3 - k * 0.02, 1.25, 6);
        parts.push(flatGeo(at(seg, lean * k * k * 0.12, 0.62 + k * 1.2, 0), k % 2 ? 0x9b7a52 : 0x8a6a45));
      }
      const top = lean * 25 * 0.12;
      for (let k = 0; k < 7; k++) {
        const leaf = new THREE.ConeGeometry(0.7, 4.2, 4).rotateZ(Math.PI / 2 + 0.5).translate(2.0, -0.4, 0).scale(1, 1, 0.35);
        leaf.rotateY((k / 7) * Math.PI * 2 + v);
        parts.push(flatGeo(leaf.translate(top, 7.4, 0), k % 2 ? 0x3f9a4f : 0x4fae5a));
      }
      out.push(merge(parts));
    }
    out.push(merge([flatGeo(new THREE.DodecahedronGeometry(1.0, 0), 0xc9b48a, 0.3, 4)]));
  } else {
    for (let v = 0; v < 3; v++) {
      const parts: THREE.BufferGeometry[] = [];
      const r = rng(40 + v);
      for (let k = 0; k < 4; k++) {
        const h = 2.5 + r() * 5;
        const c = new THREE.OctahedronGeometry(0.8 + r() * 0.5, 0).scale(1, h, 1);
        c.rotateZ((r() - 0.5) * 0.7); c.rotateX((r() - 0.5) * 0.7);
        parts.push(flatGeo(c.translate((r() - 0.5) * 2.5, h * 0.6, (r() - 0.5) * 2.5), [0x6ff0ff, 0xb98bff, 0x8fb6ff][(k + v) % 3]));
      }
      out.push(merge(parts));
    }
    out.push(merge([flatGeo(new THREE.DodecahedronGeometry(1.6, 0), 0x3a3655, 0.5, 9)]));
  }
  return out;
}

// ---------------------------------------------------------------- environment

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
  sun = new THREE.DirectionalLight(0xffffff, 2.5);
  hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  theme: Theme = THEMES[0];
  private env = new THREE.Group();
  private sky: THREE.Mesh;
  themeIndex = -1;
  quality = 1;

  constructor(canvas: HTMLCanvasElement) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.env);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(this.theme));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** build the land around a track's footprint */
  setTheme(i: number, pieces: Placed[], force = false) {
    const key = i * 1e6 + pieces.length;
    if (!force && key === this.themeIndex) return;
    this.themeIndex = key;
    const th = (this.theme = THEMES[i % THEMES.length]);
    (this.sky.material as THREE.ShaderMaterial).dispose();
    this.sky.material = panoramaMaterial(i % THEMES.length);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.sun.color.setHex(th.sunColor);
    this.sun.intensity = th.sunIntensity;
    this.hemi.color.setHex(th.hemiSky);
    this.hemi.groundColor.setHex(th.hemiGround);
    this.hemi.intensity = th.hemiIntensity;
    this.renderer.toneMappingExposure = th.exposure;
    for (const c of [...this.env.children]) {
      this.env.remove(c);
      c.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    }
    this.buildLand(th, pieces);
  }

  private buildLand(th: Theme, pieces: Placed[]) {
    // track bounds in metres
    let x0 = -20, x1 = 20, z0 = -20, z1 = 20;
    const occupied = new Set<string>();
    for (const p of pieces) for (const [cx, cz] of footprint(p)) {
      occupied.add(cx + ',' + cz);
      x0 = Math.min(x0, cx * T - T); x1 = Math.max(x1, cx * T + T);
      z0 = Math.min(z0, cz * T - T); z1 = Math.max(z1, cz * T + T);
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rad = Math.max(x1 - x0, z1 - z0) / 2 + 60;
    const near = (x: number, z: number, m: number) => {
      const ix = Math.round(x / T), iz = Math.round(z / T);
      const k = Math.ceil(m / T);
      for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) if (occupied.has(ix + a + ',' + (iz + b))) return true;
      return false;
    };
    const r = rng(1234 + this.themeIndex);

    // ground: a faceted disc, flat where you can drive, rolling far out
    const N = 90, size = 2600;
    const g = new THREE.PlaneGeometry(size, size, N, N).rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + cx, z = p.getZ(i) + cz;
      const d = Math.hypot(x - cx, z - cz);
      const far = THREE.MathUtils.smoothstep(d, rad + 40, rad + 400);
      const h = far * (Math.sin(x * 0.011) * Math.cos(z * 0.013) * 18 + Math.sin(x * 0.03 + z * 0.02) * 6 + 10);
      p.setXYZ(i, x + (r() - 0.5) * 6 * (d > rad ? 1 : 0), th.water && far < 0.02 && d > rad ? -0.6 : h, z + (r() - 0.5) * 6 * (d > rad ? 1 : 0));
    }
    const gg = g.toNonIndexed();
    const gp = gg.getAttribute('position');
    const gc = new Float32Array(gp.count * 3);
    const a = new THREE.Color(th.ground), b = new THREE.Color(th.groundAlt);
    const w = th.water ? new THREE.Color(th.water) : null;
    for (let i = 0; i < gp.count; i += 3) {
      const t = r();
      const mx = (gp.getX(i) + gp.getX(i + 1) + gp.getX(i + 2)) / 3, mz = (gp.getZ(i) + gp.getZ(i + 1) + gp.getZ(i + 2)) / 3;
      const my = (gp.getY(i) + gp.getY(i + 1) + gp.getY(i + 2)) / 3;
      const d = Math.hypot(mx - cx, mz - cz);
      col.copy(a).lerp(b, t);
      if (w && d > rad - 10 && my < 1.5) col.copy(w).multiplyScalar(0.92 + t * 0.12);
      for (let k = 0; k < 3; k++) { gc[(i + k) * 3] = col.r; gc[(i + k) * 3 + 1] = col.g; gc[(i + k) * 3 + 2] = col.b; }
    }
    gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    ground.receiveShadow = true;
    this.env.add(ground);

    // far landforms ringing the world
    const ring: THREE.BufferGeometry[] = [];
    const count = 34;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + r() * 0.15;
      const dist = rad + 500 + r() * 600;
      const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      let geo: THREE.BufferGeometry;
      const s = 60 + r() * 90;
      if (th.props === 'mesa') {
        geo = flatGeo(new THREE.CylinderGeometry(s * 0.8, s, s * (0.5 + r() * 0.5), 7, 2), r() > 0.5 ? th.far : th.farAlt, s * 0.12, i);
      } else if (th.props === 'pine') {
        geo = flatGeo(new THREE.ConeGeometry(s * 1.3, s * (1.4 + r()), 7, 2), th.far, s * 0.15, i);
        const cap = flatGeo(new THREE.ConeGeometry(s * 0.55, s * 0.62, 7, 1), th.farAlt, s * 0.05, i + 99);
        const hh = (geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox!)).max.y;
        cap.translate(0, hh - s * 0.3, 0);
        geo = merge([geo, cap]);
      } else if (th.props === 'palm') {
        geo = flatGeo(new THREE.SphereGeometry(s * 0.9, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.5, 0.45, 1), r() > 0.5 ? th.far : th.farAlt, s * 0.1, i);
      } else {
        geo = flatGeo(new THREE.ConeGeometry(s * 0.9, s * (1.6 + r() * 1.2), 5, 2), r() > 0.5 ? th.far : th.farAlt, s * 0.12, i);
      }
      geo.rotateY(r() * 6);
      geo.translate(x, -4, z);
      ring.push(geo);
    }
    const ringMesh = new THREE.Mesh(merge(ring), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    this.env.add(ringMesh);

    // scattered props around the track (never on it)
    const geos = propGeos(th);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    if (th.props === 'crystal') { mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0.0; }
    const n = Math.min(900, Math.round(rad * rad * 0.012) + 120);
    const per = geos.map(() => [] as THREE.Matrix4[]);
    const q = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3();
    for (let i = 0; i < n * 3 && per.reduce((a2, b2) => a2 + b2.length, 0) < n; i++) {
      const ang = r() * Math.PI * 2;
      const dd = Math.sqrt(r()) * (rad + 220);
      const x = cx + Math.cos(ang) * dd, z = cz + Math.sin(ang) * dd;
      if (near(x, z, 12)) continue;
      const k = Math.floor(r() * geos.length);
      const sc = 0.7 + r() * 0.8;
      q.setFromAxisAngle(v3.set(0, 1, 0), r() * Math.PI * 2);
      per[k].push(new THREE.Matrix4().compose(v3.set(x, 0, z), q, s3.set(sc, sc * (0.85 + r() * 0.3), sc)));
    }
    geos.forEach((geo, k) => {
      if (!per[k].length) return;
      const im = new THREE.InstancedMesh(geo, mat, per[k].length);
      per[k].forEach((m, j) => im.setMatrixAt(j, m));
      im.castShadow = true;
      im.receiveShadow = true;
      this.env.add(im);
    });

    // a few drifting low-poly clouds
    const clouds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 18; i++) {
      const parts: THREE.BufferGeometry[] = [];
      const bx = cx + (r() - 0.5) * 1800, bz = cz + (r() - 0.5) * 1800, by = 160 + r() * 140;
      for (let k = 0; k < 4; k++) {
        const s = 14 + r() * 16;
        parts.push(flatGeo(new THREE.IcosahedronGeometry(s, 0).scale(1.6, 0.6, 1).translate(bx + k * s * 1.3, by + r() * 6, bz + (r() - 0.5) * 20), th.stars ? 0x8a7aa8 : 0xffffff, 0, 0));
      }
      clouds.push(merge(parts));
    }
    const cm = new THREE.Mesh(merge(clouds), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: new THREE.Color(th.stars ? 0x332844 : 0x777777), transparent: true, opacity: 0.92 }));
    this.env.add(cm);
  }

  /** keep the sun's shadow box on the car */
  followShadow(x: number, y: number, z: number) {
    const d = new THREE.Vector3(...this.theme.sunDir).normalize();
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + d.x * 150, y + d.y * 150, z + d.z * 150);
  }

  render() {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------- the track's look: road, gates, pillars, boost glow

function checkerTexture(a: string, b: string, n = 8) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  const s = c.height / 2;
  for (let x = 0; x < c.width / s; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? a : b;
    g.fillRect(x * s, y * s, s, s);
  }
  void n;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 128);
  g.fillStyle = '#fff';
  for (let k = 0; k < 2; k++) {
    const y = k * 64 + 8;
    g.beginPath();
    g.moveTo(4, y + 34); g.lineTo(32, y + 6); g.lineTo(60, y + 34); g.lineTo(60, y + 52); g.lineTo(32, y + 24); g.lineTo(4, y + 52);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let CHECKER: THREE.Texture | null = null;
let CHEVRON: THREE.Texture | null = null;

export interface GateView { i: number; kind: 'start' | 'check' | 'finish'; mesh: THREE.Group; light: THREE.MeshBasicMaterial; passed: boolean }

export class TrackView {
  group = new THREE.Group();
  gates: GateView[] = [];
  private boostMats: THREE.MeshBasicMaterial[] = [];
  private mats: THREE.Material[] = [];

  build(pieces: Placed[], th: Theme) {
    this.dispose();
    // the Blender kit, painted by the theme; the plain swept meshes if it didn't load
    const kit = kitReady();
    const batch = new Batch();
    if (kit) for (const p of pieces) batch.add('p_' + PIECES[p.t].id, th, pieceMatrix(p));
    const road = new THREE.Mesh(kit ? batch.geometry() : meshGeometry(trackMesh(pieces), th), this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: !kit, roughness: 0.74, metalness: 0.0 })));
    road.castShadow = true;
    road.receiveShadow = true;
    this.group.add(road);

    CHECKER ??= checkerTexture('#111318', '#f4f4f4');
    CHEVRON ??= chevronTexture();
    const occupiedBelow = new Map<string, number>();
    for (const p of pieces) for (const [cx, cz] of footprint(p)) {
      const k = cx + ',' + cz;
      occupiedBelow.set(k, Math.min(occupiedBelow.get(k) ?? 99, p.l));
    }

    // pillars under raised road
    const pillarGeo = kit ? (() => { const b = new Batch(); b.add('pylon', th, new THREE.Matrix4()); return b.geometry(); })() : new THREE.BoxGeometry(1.1, 1, 1.1);
    const pillarMat = this.mat(new THREE.MeshStandardMaterial({ color: kit ? 0xffffff : th.pillar, vertexColors: kit, flatShading: true, roughness: 0.7 }));
    const caps = new Batch();
    const mats: THREE.Matrix4[] = [];
    pieces.forEach((p) => {
      const def = PIECES[p.t];
      if (def.feature === 'loop') return;
      if (def.box) {
        return;
      }
      const F = worldFrames(p, Math.max(1, def.cells.length * 1));
      for (let k = 0; k < F.length; k++) {
        if (F.length > 1 && (k === 0 || k === F.length - 1) && def.cells.length === 1) continue;
        const f = F[k];
        const bottom = f.p[1] - SLAB;
        if (bottom < 1.2) continue;
        const kx = Math.round(f.p[0] / T), kz = Math.round(f.p[2] / T);
        const below = occupiedBelow.get(kx + ',' + kz) ?? 99;
        if (below < p.l) continue;
        for (const side of [-1, 1]) {
          const rx = f.f[2] * side * (ROAD_W / 2 - 1.4), rz = -f.f[0] * side * (ROAD_W / 2 - 1.4);
          const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.f[0], f.f[2]));
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(f.p[0] + rx, kit ? 0 : bottom / 2, f.p[2] + rz), yaw, new THREE.Vector3(1, bottom, 1)));
          if (kit) caps.add('cap', th, new THREE.Matrix4().compose(new THREE.Vector3(f.p[0] + rx, bottom - 0.12, f.p[2] + rz), yaw, new THREE.Vector3(1, 1, 1)));
        }
      }
      if (def.cells.length === 1) {
        const f = F[Math.floor(F.length / 2)];
        void f;
      }
    });
    if (mats.length) {
      const im = new THREE.InstancedMesh(pillarGeo, pillarMat, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = true;
      im.receiveShadow = true;
      this.group.add(im);
    }
    if (kit && caps.pos.length) {
      const cm = new THREE.Mesh(caps.geometry(), pillarMat);
      cm.castShadow = true;
      this.group.add(cm);
    }

    // gates and boost glows
    pieces.forEach((p, i) => {
      const def = PIECES[p.t];
      if (def.feature === 'start' || def.feature === 'check' || def.feature === 'finish') this.gate(p, i, def.feature, th);
      if (def.feature === 'boost') {
        const mat = this.mat(new THREE.MeshBasicMaterial({ map: CHEVRON!.clone(), color: 0xfff0b0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
        mat.map!.repeat.set(1, 4);
        mat.map!.needsUpdate = true;
        this.boostMats.push(mat as THREE.MeshBasicMaterial);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 8).rotateX(-Math.PI / 2), mat);
        const c = toWorld(p, [0, 0.03, 0]);
        pl.position.set(c[0], c[1], c[2]);
        pl.rotation.y = (p.r * Math.PI) / 2;
        this.group.add(pl);
      }
    });
  }

  private mat<M extends THREE.Material>(m: M): M {
    this.mats.push(m);
    return m;
  }

  /** a gate from the kit: its body painted by the theme, its lamps a material of their own */
  private kitGate(p: Placed, i: number, kind: 'start' | 'check' | 'finish', th: Theme) {
    const g = new THREE.Group();
    const name = 'gate_' + kind;
    const b = new Batch();
    b.add(name, th, new THREE.Matrix4(), 'light');
    const body = new THREE.Mesh(b.geometry(), this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })));
    body.castShadow = true;
    g.add(body);
    const light = this.mat(new THREE.MeshBasicMaterial({ color: kind === 'start' ? 0x46e38a : kind === 'finish' ? 0xffd34d : 0x9aa0aa, fog: false }));
    g.add(new THREE.Mesh(kitPart(name, 'light'), light));
    if (kind !== 'check') {
      // (the chequered flag across the banner, both faces)
      const t = CHECKER!.clone();
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(3, 1);
      t.needsUpdate = true;
      const fm = this.mat(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.96), fm);
        f.position.set(0, 5.99, s * 0.485);
        f.rotation.y = s < 0 ? Math.PI : 0;
        g.add(f);
      }
    }
    const c = toWorld(p, [0, 0, 0]);
    g.position.set(c[0], c[1], c[2]);
    g.rotation.y = (p.r * Math.PI) / 2;
    this.group.add(g);
    this.gates.push({ i, kind, mesh: g, light, passed: false });
  }

  private gate(p: Placed, i: number, kind: 'start' | 'check' | 'finish', th: Theme) {
    if (kitReady()) return this.kitGate(p, i, kind, th);
    const g = new THREE.Group();
    const span = ROAD_W + 1.6;
    const hgt = 6.2;
    const postMat = this.mat(new THREE.MeshStandardMaterial({ color: kind === 'check' ? 0xf4f1ea : 0x23262e, flatShading: true, roughness: 0.6 }));
    const post = new THREE.BoxGeometry(0.7, hgt, 0.7);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(post, postMat);
      m.position.set((s * span) / 2, hgt / 2, 0);
      m.castShadow = true;
      g.add(m);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), postMat);
      foot.position.set((s * span) / 2, 0.25, 0);
      g.add(foot);
    }
    let bannerMat: THREE.Material;
    if (kind === 'check') {
      bannerMat = this.mat(new THREE.MeshStandardMaterial({ color: th.accent, flatShading: true, roughness: 0.5, emissive: th.accent, emissiveIntensity: 0.25 }));
    } else {
      const t = CHECKER!.clone();
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(span / 4, 1);
      t.needsUpdate = true;
      bannerMat = this.mat(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span + 0.7, 1.3, 0.4), bannerMat);
    banner.position.set(0, hgt - 0.3, 0);
    banner.castShadow = true;
    g.add(banner);
    // light strip that turns on when you pass
    const light = this.mat(new THREE.MeshBasicMaterial({ color: kind === 'start' ? 0x46e38a : kind === 'finish' ? 0xffd34d : 0xffffff, fog: false }));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(span - 0.1, 0.18, 0.46), light);
    strip.position.set(0, hgt - 1.05, 0);
    g.add(strip);
    for (const s of [-1, 1]) {
      const ls = new THREE.Mesh(new THREE.BoxGeometry(0.12, hgt - 1.6, 0.74), light);
      ls.position.set((s * span) / 2 - s * 0.36, (hgt - 1.2) / 2 + 0.5, 0);
      g.add(ls);
    }
    if (kind === 'check') light.color.setHex(0x9aa0aa);
    const c = toWorld(p, [0, 0, 0]);
    g.position.set(c[0], c[1], c[2]);
    g.rotation.y = (p.r * Math.PI) / 2;
    this.group.add(g);
    this.gates.push({ i, kind, mesh: g, light, passed: false });
  }

  pass(i: number, color: number) {
    const gv = this.gates.find((x) => x.i === i);
    if (gv) { gv.passed = true; gv.light.color.setHex(color); }
  }

  resetGates() {
    for (const gv of this.gates) if (gv.kind === 'check') { gv.passed = false; gv.light.color.setHex(0x9aa0aa); }
  }

  update(t: number) {
    for (const m of this.boostMats) {
      m.map!.offset.y = -t * 1.6;
      m.opacity = 0.65 + Math.sin(t * 9) * 0.2;
    }
  }

  dispose() {
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.mats = [];
    this.boostMats = [];
    this.gates = [];
    this.group.clear();
  }
}

function trackMesh(pieces: Placed[]): MeshOut {
  const m: MeshOut = { pos: [], slot: [], idx: [] };
  for (const p of pieces) pieceMesh(p, m);
  return m;
}

export { H, levelY };
