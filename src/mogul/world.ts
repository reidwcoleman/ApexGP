// The city in 3D: extruded buildings with lit windows, streets, parks and water, the day/night sky,
// the map camera and picking. Building state (owner tint, hover, height for redevelopment) lives in a
// float texture the building shader reads, so ownership changes never rebuild geometry.
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { City, ROAD_W, type Building } from './city.ts';

const TEXW = 1024;

export const OWN = { none: 0, me: 1, sale: 2, build: 3, rival: 10 } as const;

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  hemi = new THREE.HemisphereLight(0xe4ecf5, 0xb0a08a, 1.1);
  city: City;
  bMesh!: THREE.Mesh;
  state!: THREE.DataTexture;
  stateData!: Float32Array;
  private triStart!: Int32Array;
  heat!: THREE.Mesh;
  ground!: THREE.Mesh;
  uni = {
    uState: { value: null as THREE.DataTexture | null },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uRival: { value: [] as THREE.Color[] },
    uMine: { value: new THREE.Color('#ffc83d') },
  };
  night = 0;
  private ray = new THREE.Raycaster();
  private keys = new Set<string>();

  constructor(canvas: HTMLCanvasElement, city: City, rivalColors: string[]) {
    this.city = city;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(42, 1, 2, 9000);
    const R = Math.max(city.W, city.D);
    this.camera.position.set(-R * 0.12, R * 0.5, R * 0.36);
    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 25;
    this.controls.maxDistance = R * 1.25;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minPolarAngle = 0.15;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(0, 0, 0);
    this.uni.uRival.value = rivalColors.map((c) => new THREE.Color(c));
    while (this.uni.uRival.value.length < 10) this.uni.uRival.value.push(new THREE.Color('#888'));

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -R * 0.62; sc.right = R * 0.62; sc.top = R * 0.62; sc.bottom = -R * 0.62; sc.near = 10; sc.far = R * 3;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.fog = new THREE.Fog(0xdfe9f2, R * 0.75, R * 1.9);

    this.buildGround();
    this.buildOutskirts();
    this.buildRoads();
    this.buildBuildings();
    window.addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLInputElement)) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- ground, parks, water
  private buildGround() {
    const c = this.city;
    const g = new THREE.PlaneGeometry(c.W * 6, c.D * 6);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xd9d3c4, roughness: 1 });
    this.ground = new THREE.Mesh(g, m);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // a soft lighter "district" square under the playable city
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(c.W + 60, c.D + 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe6e0d2, roughness: 1 }));
    plaza.position.y = 0.01;
    plaza.receiveShadow = true;
    this.scene.add(plaza);
    const cols = [0x8fcf7a, 0x6fb7e8, 0x7cc46a, 0x5fae5a];
    const groups: number[][] = [[], [], [], []];
    for (const p of c.parks) {
      const v = [];
      for (let i = 0; i < p.pts.length; i += 2) v.push(new THREE.Vector2(p.pts[i], p.pts[i + 1]));
      let tris: number[][];
      try { tris = THREE.ShapeUtils.triangulateShape(v, []); } catch { continue; }
      const y = p.kind === 1 ? 0.05 : 0.03 + p.kind * 0.002;
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) groups[p.kind].push(v[k].x, y, v[k].y);
    }
    groups.forEach((arr, k) => {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      fixWinding(geo, 1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cols[k], roughness: k === 1 ? 0.25 : 1, metalness: 0 }));
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    });
  }

  /** Low anonymous blocks around the playable square so the city doesn't end at a cliff. */
  private buildOutskirts() {
    const c = this.city;
    const hw = c.W / 2 + 30, hd = c.D / 2 + 30;
    const step = 46, far = Math.max(c.W, c.D) * 0.9;
    const boxes: number[][] = [];
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = -hw - far; x < hw + far; x += step)
      for (let z = -hd - far; z < hd + far; z += step) {
        const cx = x + step / 2, cz = z + step / 2;
        if (Math.abs(cx) < hw + step * 0.4 && Math.abs(cz) < hd + step * 0.4) continue;
        const d = Math.max(Math.abs(cx) - hw, Math.abs(cz) - hd);
        const h = Math.max(4, (c.def.defaultH * 1.1) * (0.4 + r() * 0.9) * Math.max(0.25, 1 - d / far));
        boxes.push([cx, cz, step - 12 - r() * 6, step - 12 - r() * 6, h]);
      }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9dfcc, roughness: 0.95 }), boxes.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    boxes.forEach((b, i) => {
      m.makeScale(b[2], b[4], b[3]).setPosition(b[0], 0, b[1]);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHSL(0.08 + r() * 0.05, 0.25, 0.8 + r() * 0.08));
    });
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- streets
  private buildRoads() {
    const c = this.city;
    const walk: number[] = [], asph: number[] = [], paved: number[] = [], line: number[] = [];
    const heatP: number[] = [], heatC: number[] = [];
    const ribbon = (out: number[], ax: number, az: number, bx: number, bz: number, w: number, y: number) => {
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
      const px = (-dz / l) * w / 2, pz = (dx / l) * w / 2;
      out.push(ax + px, y, az + pz, bx + px, y, bz + pz, bx - px, y, bz - pz, ax + px, y, az + pz, bx - px, y, bz - pz, ax - px, y, az - pz);
    };
    const disc = (out: number[], x: number, z: number, r: number, y: number) => {
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        out.push(x, y, z, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r);
      }
    };
    const maxW = new Float32Array(c.nx.length);
    for (const e of c.edges) {
      const ax = c.nx[e.a], az = c.nz[e.a], bx = c.nx[e.b], bz = c.nz[e.b];
      maxW[e.a] = Math.max(maxW[e.a], e.w); maxW[e.b] = Math.max(maxW[e.b], e.w);
      if (e.cls === 5 || e.cls === 6) {
        ribbon(paved, ax, az, bx, bz, e.w, 0.07);
      } else {
        ribbon(walk, ax, az, bx, bz, e.w + 6, 0.06);
        ribbon(asph, ax, az, bx, bz, e.w, 0.09);
        if (e.cls >= 2 && e.len > 6) {
          // dashed centre line
          const n = Math.floor(e.len / 9);
          for (let k = 0; k < n; k++) {
            const t0 = (k + 0.25) / n, t1 = (k + 0.6) / n;
            ribbon(line, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, 0.35, 0.11);
          }
        }
      }
      // heat overlay: foot traffic per street, cool → hot
      const f = Math.min(1, e.foot / 1.6);
      const col = new THREE.Color().setHSL(0.6 - 0.6 * f, 0.95, 0.5 + 0.08 * f);
      const s = heatP.length;
      ribbon(heatP, ax, az, bx, bz, Math.max(4, e.w + 2), 0.14);
      for (let k = s; k < heatP.length; k += 3) heatC.push(col.r, col.g, col.b);
    }
    for (let i = 0; i < c.nx.length; i++) {
      if (c.adj[i].length < 2 || maxW[i] <= 0) continue;
      const anyCar = c.adj[i].some((k) => c.edges[k].cls < 5);
      if (anyCar) { disc(walk, c.nx[i], c.nz[i], maxW[i] / 2 + 3, 0.061); disc(asph, c.nx[i], c.nz[i], maxW[i] / 2, 0.091); }
      else disc(paved, c.nx[i], c.nz[i], maxW[i] / 2, 0.071);
    }
    const mk = (arr: number[], color: number, rough = 0.95, offset = 0) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      fixWinding(geo, 1);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, polygonOffset: true, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset });
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    mk(walk, 0xc9c3b6, 1, 1);
    mk(paved, 0xd8cdb8, 1, 2);
    mk(asph, 0x7c7e84, 0.9, 3);
    mk(line, 0xf3e7c4, 0.8, 4);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(heatP, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(heatC, 3));
    fixWinding(hg, 1);
    this.heat = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    this.heat.visible = false;
    this.heat.renderOrder = 2;
    this.scene.add(this.heat);
  }

  // ---------------------------------------------------------------- buildings
  private buildBuildings() {
    const c = this.city;
    const pos: number[] = [], nrm: number[] = [], col: number[] = [], ids: number[] = [];
    const palette: Record<number, number[]> = {
      0: [0xf4ead6, 0xefdcc0, 0xf7efe2, 0xe8d6bb, 0xf1e4cf, 0xe9c9a8, 0xf3dcc8],
      1: [0xf7d7b5, 0xf2c39e, 0xfae3c8, 0xf0cfa8],
      2: [0xcfe0ee, 0xbfd4e6, 0xdde8f1, 0xb4cade, 0xd6dcea],
      3: [0xf3cdb4, 0xeab99a, 0xf7dcc6, 0xe4a98a, 0xf0c7b0],
      4: [0xefe3c8, 0xe2d2b0],
      5: [0xd9cdb6, 0xcfc3ab],
      6: [0xf0d6e4, 0xe6cadc],
    };
    const tmpC = new THREE.Color();
    this.triStart = new Int32Array(c.buildings.length + 1);
    let tri = 0;
    for (const b of c.buildings) {
      this.triStart[b.id] = tri;
      b.tri0 = tri;
      const pal = palette[b.kind] ?? palette[0];
      tmpC.setHex(pal[(b.id * 7919) % pal.length]);
      const n = b.pts.length / 2;
      const H = b.h;
      const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, k = 1) => {
        pos.push(x, y, z); nrm.push(nx, ny, nz); col.push(tmpC.r * k, tmpC.g * k, tmpC.b * k); ids.push(b.id);
      };
      for (let i = 0; i < n; i++) {
        const x0 = b.pts[i * 2], z0 = b.pts[i * 2 + 1], x1 = b.pts[((i + 1) % n) * 2], z1 = b.pts[((i + 1) % n) * 2 + 1];
        const l = Math.hypot(x1 - x0, z1 - z0) || 1;
        const ox = (z1 - z0) / l, oz = -(x1 - x0) / l;
        // two triangles, wound so they face outward (checked against the normal)
        const quad = [[x0, 0, z0], [x1, 0, z1], [x1, H, z1], [x0, 0, z0], [x1, H, z1], [x0, H, z0]];
        const fa = new THREE.Vector3(...quad[0]), fb = new THREE.Vector3(...quad[1]), fc = new THREE.Vector3(...quad[2]);
        const cr = fb.sub(fa).cross(fc.sub(fa));
        const flip = cr.x * ox + cr.z * oz < 0;
        const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
        for (const k of order) push(quad[k][0], quad[k][1], quad[k][2], ox, 0, oz);
        tri += 2;
      }
      const v: THREE.Vector2[] = [];
      for (let i = 0; i < n; i++) v.push(new THREE.Vector2(b.pts[i * 2], b.pts[i * 2 + 1]));
      let tris: number[][] = [];
      try { tris = THREE.ShapeUtils.triangulateShape(v, []); } catch { tris = []; }
      for (const t of tris) {
        const a = v[t[0]], bb = v[t[1]], cc = v[t[2]];
        // facing up: (b-a)x(c-a) has +y when the x/z triangle is clockwise seen from above
        const cy = (cc.x - a.x) * (bb.y - a.y) - (bb.x - a.x) * (cc.y - a.y);
        const tri3 = cy > 0 ? [a, bb, cc] : [a, cc, bb];
        for (const p of tri3) push(p.x, H, p.y, 0, 1, 0, 0.86);
        tri++;
      }
      this.triStart[b.id + 1] = tri;
      b.tri1 = tri;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aId', new THREE.Float32BufferAttribute(ids, 1));
    geo.computeBoundingSphere();
    const rows = Math.ceil((c.buildings.length + 1) / TEXW);
    this.stateData = new Float32Array(TEXW * rows * 4);
    for (let i = 0; i < c.buildings.length; i++) this.stateData[i * 4 + 1] = 1;
    this.state = new THREE.DataTexture(this.stateData, TEXW, rows, THREE.RGBAFormat, THREE.FloatType);
    this.state.needsUpdate = true;
    this.uni.uState.value = this.state;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aId; uniform sampler2D uState; varying vec4 vState; varying vec3 vWP; varying vec3 vWN; varying float vId; varying float vHgt;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          int iid = int(aId + 0.5);
          vState = texelFetch(uState, ivec2(iid % ${TEXW}, iid / ${TEXW}), 0);
          vId = aId;
          vHgt = transformed.y;
          transformed.y *= vState.g;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight; uniform float uTime; uniform vec3 uRival[10]; uniform vec3 uMine;
          varying vec4 vState; varying vec3 vWP; varying vec3 vWN; varying float vId; varying float vHgt;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float code = vState.r;
          vec3 tint = vec3(0.0); float tk = 0.0;
          if (code > 0.5 && code < 1.5) { tint = uMine; tk = 0.62; }
          else if (code > 1.5 && code < 2.5) { tint = vec3(0.55, 0.85, 0.6); tk = 0.18; }
          else if (code > 9.5) { tint = uRival[int(code - 10.0 + 0.5)]; tk = 0.2; }
          diffuseColor.rgb = mix(diffuseColor.rgb, tint * (0.85 + 0.15 * diffuseColor.r), tk);
          if (code > 2.5 && code < 3.5) {
            float st = step(0.5, fract((vWP.x + vWP.y + vWP.z) * 0.18));
            diffuseColor.rgb = mix(vec3(1.0, 0.62, 0.15), vec3(0.22, 0.2, 0.2), st * 0.8);
          }
          float wall = 1.0 - step(0.5, abs(vWN.y));
          vec3 tng = vec3(-vWN.z, 0.0, vWN.x); tng /= max(length(tng), 1e-3);
          float u = dot(vWP, tng);
          float fl = floor(vWP.y / 3.4);
          vec2 cell = vec2(floor(u / 3.1), fl);
          vec2 fc = vec2(fract(u / 3.1), fract(vWP.y / 3.4));
          float fw = clamp(1.6 - fwidth(u / 3.1) * 3.0, 0.0, 1.0);
          float win = wall * step(0.2, fc.x) * step(fc.x, 0.8) * step(0.28, fc.y) * step(fc.y, 0.82) * step(3.6, vWP.y);
          float lit = step(0.6, h21(cell + vId * 1.37));
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.42, 0.52, 0.62), vec3(0.62, 0.74, 0.84), h21(cell)), win * mix(0.18, 0.5, fw));
          // ground-floor shopfront band
          float shop = wall * (1.0 - step(3.6, vWP.y)) * step(0.4, vWP.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.8, shop * 0.6);
          vec3 vGlow = vec3(1.0, 0.78, 0.45) * win * lit * uNight * mix(0.5, 1.6, fw) + vec3(1.0, 0.85, 0.6) * shop * uNight * 0.35 * step(0.3, h21(cell * 0.3 + vId));
          float hov = vState.b;
          diffuseColor.rgb += hov * vec3(0.16, 0.14, 0.05);
          float sel = vState.a;
          float rim = sel * (0.55 + 0.45 * sin(uTime * 5.0));
          vGlow += rim * uMine * 0.35 + (code > 0.5 && code < 1.5 ? 1.0 : 0.0) * uMine * uNight * 0.18;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vGlow;`);
    };
    this.bMesh = new THREE.Mesh(geo, mat);
    this.bMesh.castShadow = true;
    this.bMesh.receiveShadow = true;
    this.scene.add(this.bMesh);
  }

  setBuilding(id: number, code: number, hScale?: number) {
    this.stateData[id * 4] = code;
    if (hScale !== undefined) this.stateData[id * 4 + 1] = hScale;
    this.state.needsUpdate = true;
  }
  private hoverId = -1;
  private selId = -1;
  setHover(id: number) {
    if (id === this.hoverId) return;
    if (this.hoverId >= 0) this.stateData[this.hoverId * 4 + 2] = 0;
    this.hoverId = id;
    if (id >= 0) this.stateData[id * 4 + 2] = 1;
    this.state.needsUpdate = true;
  }
  setSelected(id: number) {
    if (id === this.selId) return;
    if (this.selId >= 0) this.stateData[this.selId * 4 + 3] = 0;
    this.selId = id;
    if (id >= 0) this.stateData[id * 4 + 3] = 1;
    this.state.needsUpdate = true;
  }

  // ---------------------------------------------------------------- picking
  private ndc = new THREE.Vector2();
  pick(cx: number, cy: number): { b: Building | null; x: number; z: number } {
    this.ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObject(this.bMesh, false)[0];
    let b: Building | null = null;
    let x = 0, z = 0;
    if (hit && hit.faceIndex !== undefined && hit.faceIndex !== null) {
      b = this.buildingOfTri(hit.faceIndex);
      x = hit.point.x; z = hit.point.z;
    }
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (!b && d.y < -1e-4) { const t = -o.y / d.y; x = o.x + d.x * t; z = o.z + d.z * t; }
    return { b, x, z };
  }
  groundAt(cx: number, cy: number): { x: number; z: number } | null {
    this.ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y > -1e-4) return null;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  private buildingOfTri(t: number): Building | null {
    const a = this.triStart;
    let lo = 0, hi = this.city.buildings.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= t) lo = m; else hi = m - 1; }
    return this.city.buildings[lo] ?? null;
  }

  /** world → screen px, or null behind the camera */
  private v3 = new THREE.Vector3();
  toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    this.v3.set(x, y, z).project(this.camera);
    if (this.v3.z > 1) return null;
    return { x: (this.v3.x * 0.5 + 0.5) * innerWidth, y: (-this.v3.y * 0.5 + 0.5) * innerHeight };
  }

  flyTo(x: number, z: number, dist?: number) {
    this.fly = { x, z, dist: dist ?? Math.min(this.camera.position.distanceTo(this.controls.target), 260), t: 0 };
  }
  private fly: { x: number; z: number; dist: number; t: number } | null = null;

  // ---------------------------------------------------------------- time of day
  setHour(h: number) {
    // sun path: rises 6, sets 20
    const day = (h - 6) / 14;
    const el = Math.sin(Math.PI * Math.max(0, Math.min(1, day)));
    const az = Math.PI * (0.15 + day);
    const R = Math.max(this.city.W, this.city.D);
    const sunUp = day > 0 && day < 1;
    const elev = sunUp ? 0.12 + el * 0.95 : 0.6;
    this.sun.position.set(Math.cos(az) * R, Math.sin(elev) * R * 1.1, Math.sin(az) * R * 0.6 - R * 0.2);
    // night factor with dusk/dawn ramps
    const n = h < 5 || h > 21 ? 1 : h < 7 ? 1 - (h - 5) / 2 : h > 19 ? (h - 19) / 2 : 0;
    this.night = n;
    this.uni.uNight.value = n;
    const dusk = Math.max(0, 1 - Math.abs(h - 19.3) / 1.6) + Math.max(0, 1 - Math.abs(h - 6.4) / 1.3);
    const dayC = new THREE.Color(0xbfdcf5), duskC = new THREE.Color(0xf4a678), nightC = new THREE.Color(0x0b1430);
    const sky = dayC.clone().lerp(duskC, Math.min(1, dusk) * 0.8).lerp(nightC, n);
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.sun.intensity = sunUp ? 1.0 + 2.2 * el : 0.25;
    this.sun.color.set(dusk > 0.3 ? 0xffc79a : 0xfff1dc).lerp(new THREE.Color(0x8fa6ff), n);
    this.hemi.intensity = 1.45 - 0.7 * n;
    this.hemi.color.set(0xe4ecf5).lerp(new THREE.Color(0x5a6db0), n);
    this.renderer.toneMappingExposure = 1.05 - 0.15 * n;
  }

  update(dt: number) {
    this.uni.uTime.value += dt;
    // keyboard panning + rotating
    const k = this.keys;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const sp = dist * 1.1 * dt;
    const fwd = new THREE.Vector3().subVectors(this.controls.target, this.camera.position).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const mv = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) mv.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) mv.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) mv.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) mv.sub(right);
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); this.camera.position.add(mv); this.controls.target.add(mv); this.fly = null; }
    if (k.has('KeyQ') || k.has('KeyE')) {
      const a = (k.has('KeyQ') ? 1 : -1) * dt * 1.2;
      const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      this.camera.position.copy(this.controls.target).add(off);
    }
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt * 1.6);
      const e = 1 - Math.pow(1 - f.t, 3);
      const tgt = new THREE.Vector3(f.x, 0, f.z);
      const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      const want = off.clone().setLength(f.dist);
      off.lerp(want, e * 0.25);
      this.controls.target.lerp(tgt, e * 0.25);
      this.camera.position.copy(this.controls.target).add(off);
      if (f.t >= 1 && this.controls.target.distanceTo(tgt) < 1) this.fly = null;
    }
    // clamp the target inside the city
    const t = this.controls.target, c = this.city;
    const cx = Math.max(-c.W / 2 - 50, Math.min(c.W / 2 + 50, t.x)), cz = Math.max(-c.D / 2 - 50, Math.min(c.D / 2 + 50, t.z));
    if (cx !== t.x || cz !== t.z) { const d = new THREE.Vector3(cx - t.x, 0, cz - t.z); t.add(d); this.camera.position.add(d); }
    this.controls.update();
    // shadows follow the view a little so the near city stays crisp
    this.sun.target.position.set(t.x * 0.5, 0, t.z * 0.5);
    this.renderer.render(this.scene, this.camera);
  }
}

/** Makes every triangle of a flat (y-up) non-indexed geometry face up (sign 1) and adds normals. */
function fixWinding(geo: THREE.BufferGeometry, sign: number) {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const a = p.array as Float32Array;
  for (let i = 0; i < a.length; i += 9) {
    const ux = a[i + 3] - a[i], uz = a[i + 5] - a[i + 2], vx = a[i + 6] - a[i], vz = a[i + 8] - a[i + 2];
    const ny = uz * vx - ux * vz; // y of (u × v)
    if (ny * sign < 0) {
      for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
    }
  }
  geo.computeVertexNormals();
}
