import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LF, applyLF, roomGlass } from './lighting.ts';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { World, type Box } from './collide.ts';
import { dress } from './dress.ts';

export const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'lastframe/';

export interface MapData {
  mats: { mat: string; verts: number; tris: number; pos: number; nor: number; uv: number; lm: number; idx: number }[];
  materials: Record<string, { tex: string; scale: number; tint: number[]; rough: number; wet: number; metal: number; nrm: number; emit: number[] | null }>;
  textures: string[];
  colliders: [number, number, number, number, number, number, number, string, string][];
  props: { id: string; pos: number[]; rot: number; s: number; tilt?: number; loose?: { kg: number; surf: string; shape: string; half: number[] } }[];
  doors: { axis: string; hinge: number[]; w: number; h: number; sign: number; swing: number; kind: string; t: number }[];
  glass: { axis: string; c: number; a: number; b: number; z0: number; z1: number }[];
  spawns: { a: number[][]; b: number[][]; ffa: number[][] };
  hold: number[][];
  zones: { a: number[]; b: number[]; kind: string }[];
  lights: { kind: string; pos: number[]; color: number[]; power: number }[];
  rooms: { name: string; a: number[]; b: number[] }[];
  lm: { logr: number; k: number; size: number };
  /** facade modules: id, where, and which tile of the second lightmap (none: a far building) */
  units: { id: string; pos: number[]; rot: number; sc: number[]; tint: number[]; tile?: number[] }[];
}

export class Door {
  want = 0;
  dir = 1;
  /** radians off the frame, and how fast */
  ang = 0;
  w = 0;
  moving = true;
  readonly pivot = new THREE.Group();
  readonly box: Box;
  readonly centre = new THREE.Vector3();
  readonly width: number;
  readonly height: number;
  readonly alongX: boolean;
  readonly leafCentre = new THREE.Vector3();
  readonly leafQuat = new THREE.Quaternion();
  /** it hit its frame or its stop */
  onThud: ((d: Door, v: number) => void) | null = null;
  private axisRot: number;
  private sign: number;
  private up = new THREE.Vector3(0, 1, 0);
  constructor(readonly id: number, private d: MapData['doors'][number], mat: THREE.Material, handle: THREE.Material) {
    const [hx, hy, hz] = d.hinge;
    this.width = d.w;
    this.height = d.h;
    this.sign = d.sign;
    this.alongX = d.axis === 'x';
    this.pivot.position.set(hx, hy, hz);
    const g = new THREE.BoxGeometry(d.w - 0.02, d.h - 0.02, d.t);
    g.translate((d.w / 2) * d.sign, d.h / 2, 0);
    // along x in the map runs along +x in the world; along y (north) runs along -z
    this.axisRot = this.alongX ? 0 : Math.PI / 2;
    const leaf = new THREE.Mesh(g, mat);
    const inner = new THREE.Group();
    inner.rotation.y = this.axisRot;
    inner.add(leaf);
    for (const s of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10), handle);
      k.rotation.x = Math.PI / 2;
      k.position.set((d.w - 0.1) * d.sign, 1.02, s * (d.t / 2 + 0.05));
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.02), handle);
      l.position.set((d.w - 0.16) * d.sign, 1.02, s * (d.t / 2 + 0.09));
      inner.add(k, l);
    }
    this.pivot.add(inner);
    this.box = { min: [hx, hy, hz], max: [hx, hy + d.h, hz], pen: true, tag: 'door', mat: 'door', id, slab: { x: hx, z: hz, ux: 1, uz: 0, len: d.w, t: 0.045 }, bump: (px, pz, vx, vz) => this.bump(px, pz, vx, vz) };
    this.place();
    const s = this.box.slab!;
    this.centre.set(hx + s.ux * d.w * 0.5, hy + 1, hz + s.uz * d.w * 0.5);
  }

  /** the leaf's own frame and bounds, from the angle */
  private place() {
    const phi = this.axisRot + this.ang;
    const ux = Math.cos(phi) * this.sign, uz = -Math.sin(phi) * this.sign;
    const b = this.box, s = b.slab!;
    s.ux = ux;
    s.uz = uz;
    const [hx, hy, hz] = this.d.hinge;
    const ex = hx + ux * this.width, ez = hz + uz * this.width, t = s.t + 0.01;
    b.min = [Math.min(hx, ex) - t, hy, Math.min(hz, ez) - t];
    b.max = [Math.max(hx, ex) + t, hy + this.height, Math.max(hz, ez) + t];
    this.leafCentre.set(hx + ux * this.width * 0.5, hy + this.height * 0.5, hz + uz * this.width * 0.5);
    this.leafQuat.setFromAxisAngle(this.up, phi);
    this.pivot.rotation.y = this.ang;
  }

  /** where the leaf wants to be: -dir*sign means dir>0 swings toward +z (or +x) */
  private target() {
    return this.want > 0 ? -this.dir * this.sign * 1.72 : 0;
  }

  /** swing away from whoever opened it */
  toggle(from: THREE.Vector3 | null, force?: number) {
    if (force !== undefined) {
      this.want = force ? 1 : 0;
      if (force) this.dir = force;
      return;
    }
    if (this.want > 0) {
      this.want = 0;
      return;
    }
    this.want = 1;
    if (from) {
      const side = this.alongX ? Math.sign(from.z - this.centre.z) : Math.sign(from.x - this.centre.x);
      this.dir = -(side || 1);
    }
  }

  /** a force at the leaf, as a change of swing speed */
  kick(dw: number) {
    this.w += dw;
    this.moving = true;
  }

  /** how a push along (vx, vz), a fraction of the way along the leaf, turns it */
  private turn(vx: number, vz: number) {
    const phi = this.axisRot + this.ang;
    return this.sign * (-Math.sin(phi) * vx - Math.cos(phi) * vz);
  }

  /** a round through the leaf */
  shot(dx: number, dz: number, k: number) {
    if (this.ang === 0 && this.want === 0) return;
    this.kick(this.turn(dx, dz) * k);
  }

  private bump(_px: number, _pz: number, vx: number, vz: number) {
    if (this.ang === 0 && this.want === 0) return;
    this.kick(this.turn(vx, vz) * 0.14);
  }

  blown(dir: number, k: number) {
    this.want = 1;
    this.dir = dir;
    this.kick(-dir * this.sign * (5 + k * 9));
  }

  update(dt: number) {
    const to = this.target();
    if (!this.moving && to === this.ang) return;
    // a door closer more than a motor: quick to get there, a little overshoot on the stop
    const k = this.want > 0 ? 24 : 15, c = this.want > 0 ? 7 : 5.4;
    const n = 2, h = dt / n;
    for (let i = 0; i < n; i++) {
      this.w += (k * (to - this.ang) - c * this.w) * h;
      const before = this.ang;
      this.ang += this.w * h;
      // the latch: coming back through the frame it stops dead
      if (this.want === 0 && before * this.ang <= 0 && before !== 0) {
        if (Math.abs(this.w) > 0.9) this.onThud?.(this, Math.abs(this.w));
        this.ang = 0;
        this.w = 0;
      }
      const stop = 1.98;
      if (Math.abs(this.ang) > stop) {
        if (Math.abs(this.w) > 1.5) this.onThud?.(this, Math.abs(this.w) * 0.6);
        this.ang = Math.sign(this.ang) * stop;
        this.w *= -0.3;
      }
    }
    if (Math.abs(this.w) < 0.004 && Math.abs(to - this.ang) < 0.002) {
      this.ang = to;
      this.w = 0;
      this.moving = false;
    } else this.moving = true;
    this.place();
  }
}

export class Pane {
  broken = false;
  /** what stays in the frame */
  teeth: THREE.Mesh | null = null;
  constructor(readonly id: number, readonly mesh: THREE.Mesh, readonly box: Box, readonly along: 'x' | 'y') {}

  /** jagged glass left in the putty, on all four sides */
  breakTeeth(mat: THREE.Material) {
    const g = this.mesh.geometry as THREE.BoxGeometry;
    const p = g.parameters;
    const w = this.along === 'x' ? p.width : p.depth, h = p.height;
    const pos: number[] = [];
    const edge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      const L = Math.hypot(bx - ax, by - ay);
      let t = 0;
      while (t < L) {
        const s = 0.06 + Math.random() * 0.26;
        const e = Math.min(L, t + s);
        const tip = (t + e) / 2 + (Math.random() - 0.5) * s;
        const d = Math.random() < 0.3 ? 0.012 : 0.03 + Math.random() ** 2 * 0.3;
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        pos.push(ax + ux * t, ay + uy * t, 0, ax + ux * e, ay + uy * e, 0, ax + ux * tip + nx * d, ay + uy * tip + ny * d, 0);
        t = e;
      }
    };
    edge(-w / 2, -h / 2, w / 2, -h / 2, 0, 1);
    edge(w / 2, h / 2, -w / 2, h / 2, 0, -1);
    edge(-w / 2, h / 2, -w / 2, -h / 2, 1, 0);
    edge(w / 2, -h / 2, w / 2, h / 2, -1, 0);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.computeVertexNormals();
    const m = new THREE.Mesh(bg, mat);
    m.position.copy(this.mesh.position);
    if (this.along === 'y') m.rotation.y = Math.PI / 2;
    m.renderOrder = 4;
    this.mesh.parent?.add(m);
    this.teeth = m;
  }

  mend() {
    this.teeth?.removeFromParent();
    this.teeth?.geometry.dispose();
    this.teeth = null;
  }
}

export interface Loaded {
  group: THREE.Group;
  world: World;
  map: MapData;
  doors: Door[];
  panes: Pane[];
  sky: THREE.Texture;
  /** the props nobody bolted down, ready to be given bodies */
  loose: { obj: THREE.Object3D; def: NonNullable<MapData['props'][number]['loose']>; x: number; y: number; z: number; rot: number }[];
  glassMat: THREE.Material;
  /** what the street's reflection never needs to draw */
  indoors: THREE.Object3D[];
}

function makeSky(tex: THREE.Texture, lm: MapData['lm']) {
  const geo = new THREE.SphereGeometry(400, 32, 20);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { t: { value: tex }, k: LF.lmK, gain: { value: 0.62 } },
    vertexShader: 'varying vec3 d; void main(){ d = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position,1.); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 d; uniform sampler2D t; uniform vec2 k; uniform float gain;
      void main(){ vec3 n = normalize(d); float u = atan(n.z, n.x) / 6.2831853 + 0.5; float v = asin(clamp(n.y,-1.,1.)) / 3.14159265 + 0.5;
      vec3 e = texture2D(t, vec2(u, v)).rgb; vec3 c = (exp2(e*k.x)-1.)/k.y; gl_FragColor = vec4(min(c*gain*vec3(.36,.62,1.05), vec3(1.6)),1.); }`,
  });
  const s = new THREE.Mesh(geo, m);
  s.frustumCulled = false;
  s.renderOrder = -1;
  return s;
}

export async function loadWorld(r: THREE.WebGLRenderer, progress: (f: number, what: string) => void): Promise<Loaded> {
  const map: MapData = await (await fetch(BASE + 'map.json')).json();
  LF.lmK.value.set(map.lm.logr, map.lm.k);
  const bin = await (await fetch(BASE + 'world.bin')).arrayBuffer();
  const tl = new THREE.TextureLoader();
  const aniso = Math.min(4, r.capabilities.getMaxAnisotropy());
  const texs = new Map<string, THREE.Texture>();
  const need: [string, boolean][] = [];
  for (const t of map.textures) need.push([`tex/${t}_c.webp`, true], [`tex/${t}_n.webp`, false], [`tex/${t}_a.webp`, false]);
  need.push(['lm.webp', false], ['lm2.webp', false], ['sky.webp', false]);
  let done = 0;
  await Promise.all(need.map(async ([f, srgb]) => {
    const t = await tl.loadAsync(BASE + f).catch(() => null);
    done++;
    progress(0.1 + 0.6 * (done / need.length), 'Textures');
    if (!t) return;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    texs.set(f, t);
  }));
  const lm = texs.get('lm.webp')!;
  lm.wrapS = lm.wrapT = THREE.ClampToEdgeWrapping;
  lm.generateMipmaps = false;
  lm.minFilter = THREE.LinearFilter;
  lm.anisotropy = 1;
  lm.flipY = true;
  lm.needsUpdate = true;
  LF.lm.value = lm;
  const lm2 = texs.get('lm2.webp');
  if (lm2) {
    lm2.wrapS = lm2.wrapT = THREE.ClampToEdgeWrapping;
    lm2.generateMipmaps = false;
    lm2.minFilter = THREE.LinearFilter;
    lm2.anisotropy = 1;
    lm2.flipY = true;
    lm2.needsUpdate = true;
    LF.lm2.value = lm2;
  }
  const skyT = texs.get('sky.webp')!;
  skyT.generateMipmaps = false;
  skyT.minFilter = THREE.LinearFilter;
  skyT.wrapS = THREE.RepeatWrapping;

  const group = new THREE.Group();
  group.add(makeSky(skyT, map.lm));
  const mats = new Map<string, THREE.Material>();
  const makeMat = (name: string) => {
    let m = mats.get(name);
    if (m) return m;
    const d = map.materials[name];
    if (d.emit) m = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.emit[0], d.emit[1], d.emit[2]).multiplyScalar(0.5) });
    else {
      const st = new THREE.MeshStandardMaterial({
        map: texs.get(`tex/${d.tex}_c.webp`) ?? null, normalMap: texs.get(`tex/${d.tex}_n.webp`) ?? null, roughnessMap: texs.get(`tex/${d.tex}_a.webp`) ?? null, aoMap: texs.get(`tex/${d.tex}_a.webp`) ?? null,
        color: new THREE.Color(d.tint[0], d.tint[1], d.tint[2]), roughness: d.rough, metalness: d.metal,
      });
      st.aoMapIntensity = 1.3;
      st.normalScale.set(d.nrm, d.nrm);
      if (st.aoMap) st.aoMap.channel = 0;
      m = applyLF(st, { lightmap: true, wet: d.wet });
    }
    mats.set(name, m);
    return m;
  };
  for (const e of map.mats) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, e.pos, e.verts * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin, e.nor, e.verts * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, e.uv, e.verts * 2), 2));
    g.setAttribute('uvLM', new THREE.BufferAttribute(new Float32Array(bin, e.lm, e.verts * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, e.idx, e.tris * 3), 1));
    const mesh = new THREE.Mesh(g, makeMat(e.mat));
    mesh.name = e.mat;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  progress(0.72, 'Props');
  const gl = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(BASE + 'props.glb');
  // compression moves each mesh into a quantised box and puts the way back on its node: nothing here may drop a node's matrix
  gl.scene.updateMatrixWorld(true);
  const byId = new Map<string, THREE.Object3D>();
  for (const c of gl.scene.children) {
    byId.set(c.name, c);
  }
  const placed = new Map<string, MapData['props']>();
  const loose: Loaded['loose'] = [];
  for (const p of map.props) {
    if (p.loose) continue;
    const l = placed.get(p.id);
    if (l) l.push(p);
    else placed.set(p.id, [p]);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const indoors: THREE.Object3D[] = [];
  const insideZone = (p: number[]) => map.zones.some((z) => p[0] > z.a[0] && p[0] < z.b[0] && p[2] > z.a[2] && p[2] < z.b[2]);
  const prepared = new Set<THREE.Material>();
  const prep = (mat: THREE.MeshStandardMaterial, id = '') => {
    if (prepared.has(mat)) return;
    prepared.add(mat);
    // the cubes are coarser than the corners these stand in: pale things would glow
    mat.color.multiplyScalar(/cardboard|rollershutter/.test(id) ? 0.5 : /crate|shelves|barrier/.test(id) ? 0.72 : 0.85);
    applyLF(mat, {});
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = 4;
    // scans with holes in them (chain link, grates): cut, don't blend
    if (mat.transparent || mat.alphaTest > 0) {
      mat.transparent = false;
      mat.alphaTest = 0.5;
      mat.side = THREE.DoubleSide;
    }
  };
  for (const [id, list] of placed) {
    const src = byId.get(id) ?? byId.get(id.replace(/[.\s]/g, '_'));
    if (!src) {
      console.warn('[lastframe] no prop', id);
      continue;
    }
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      prep(mat, id);
      // a block of the map each, so what's behind the camera or across the block isn't drawn three times over
      const cells = new Map<string, MapData['props']>();
      for (const p of list) {
        const k = `${Math.floor(p.pos[0] / 18)},${Math.floor(p.pos[2] / 18)},${insideZone(p.pos) ? 1 : 0}`;
        const c = cells.get(k);
        if (c) c.push(p);
        else cells.set(k, [p]);
      }
      const local = mesh.matrixWorld.clone();
      for (const part of cells.values()) {
        const inst = new THREE.InstancedMesh(mesh.geometry, mat, part.length);
        part.forEach((p, i) => {
          q.setFromAxisAngle(UP, p.rot);
          if (p.tilt) q.multiply(q2.setFromAxisAngle(RIGHT, p.tilt));
          mtx.compose(v.set(p.pos[0], p.pos[1], p.pos[2]), q, sc.setScalar(p.s)).multiply(local);
          inst.setMatrixAt(i, mtx);
        });
        inst.computeBoundingSphere();
        group.add(inst);
        if (insideZone(part[0].pos)) indoors.push(inst);
      }
    });
  }
  // ---- the kit: instanced by module, in blocks of the map, each instance on its own lightmap tile
  {
    const glass = roomGlass();
    const near = new Map<THREE.Material, THREE.Material>(), far = new Map<THREE.Material, THREE.Material>();
    const matFor = (m0: THREE.MeshStandardMaterial, tiled: boolean) => {
      if (/glass/i.test(m0.name)) return glass;
      const table = tiled ? near : far;
      let m = table.get(m0);
      if (!m) {
        const c = m0.clone();
        c.transparent = false;
        c.alphaTest = 0;
        c.side = THREE.FrontSide;
        for (const t of [c.map, c.normalMap, c.roughnessMap]) if (t) t.anisotropy = 4;
        // plaster takes more light than the scans round it
        c.color.multiplyScalar(tiled ? 0.74 : 0.8);
        m = applyLF(c, tiled ? { lightmap: true, tile: true, wet: 0.25 } : {});
        table.set(m0, m);
      }
      return m;
    };
    const byCell = new Map<string, MapData['units']>();
    for (const u of map.units ?? []) {
      const k = `${u.id}@${Math.floor(u.pos[0] / 24)},${Math.floor(u.pos[2] / 24)}`;
      const c = byCell.get(k);
      if (c) c.push(u);
      else byCell.set(k, [u]);
    }
    const col = new THREE.Color();
    for (const [key, list] of byCell) {
      const id = key.split('@')[0];
      const src = byId.get(id) ?? byId.get(id.replace(/[.\s|+]/g, '_')) ?? byId.get(id.replace(/[.\s|+]/g, ''));
      if (!src) {
        console.warn('[lastframe] no unit', id);
        continue;
      }
      const tiled = !!list[0].tile;
      src.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m0 = mesh.material as THREE.MeshStandardMaterial;
        const local = mesh.matrixWorld.clone();
        const geo = new THREE.BufferGeometry();
        geo.index = mesh.geometry.index;
        for (const [n, a] of Object.entries(mesh.geometry.attributes)) geo.setAttribute(n, a);
        if (tiled && mesh.geometry.getAttribute('uv1')) geo.setAttribute('uvLM', mesh.geometry.getAttribute('uv1'));
        const tiles = new Float32Array(list.length * 4);
        const inst = new THREE.InstancedMesh(geo, matFor(m0, tiled), list.length);
        inst.name = id;
        list.forEach((u, i) => {
          q.setFromAxisAngle(UP, u.rot);
          // sc is along the module, out of it, up it
          mtx.compose(v.set(u.pos[0], u.pos[1], u.pos[2]), q, sc.set(u.sc[0], u.sc[2], u.sc[1])).multiply(local);
          inst.setMatrixAt(i, mtx);
          inst.setColorAt(i, col.setRGB(u.tint[0], u.tint[1], u.tint[2]));
          if (u.tile) tiles.set(u.tile, i * 4);
        });
        if (tiled) geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 4));
        inst.computeBoundingSphere();
        group.add(inst);
      });
    }
  }
  for (const p of map.props) {
    if (!p.loose) continue;
    const src = byId.get(p.id) ?? byId.get(p.id.replace(/[.\s]/g, '_'));
    if (!src) continue;
    // a pivot at the middle of its box: the model hangs below it
    const obj = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(src.clone());
    inner.position.set(0, -p.loose.half[2], 0);
    inner.scale.setScalar(p.s);
    inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      prep(m.material as THREE.MeshStandardMaterial, p.id);
      m.castShadow = true;
    });
    obj.add(inner);
    loose.push({ obj, def: p.loose, x: p.pos[0], y: p.pos[1], z: p.pos[2], rot: p.rot });
  }
  progress(0.85, 'Collision');
  const world = new World();
  for (const c of map.colliders) world.add({ min: [c[0], c[1], c[2]], max: [c[3], c[4], c[5]], pen: !!c[6], tag: c[7], mat: c[8] });

  const doorMat = {
    wood: applyLF(new THREE.MeshStandardMaterial({ map: texs.get('tex/distressed_painted_planks_c.webp'), normalMap: texs.get('tex/distressed_painted_planks_n.webp'), roughness: 0.8, color: 0x9a8f7c })),
    steel: applyLF(new THREE.MeshStandardMaterial({ map: texs.get('tex/green_metal_rust_c.webp'), normalMap: texs.get('tex/green_metal_rust_n.webp'), roughness: 0.7, color: 0xa0a8a4 })),
    street: applyLF(new THREE.MeshStandardMaterial({ map: texs.get('tex/distressed_painted_planks_c.webp'), normalMap: texs.get('tex/distressed_painted_planks_n.webp'), roughness: 0.7, color: 0x5a3a2a })),
  };
  const handle = applyLF(new THREE.MeshStandardMaterial({ color: 0x8a8378, metalness: 0.9, roughness: 0.4 }));
  const doors = map.doors.map((d, i) => {
    const door = new Door(i, d, doorMat[d.kind as keyof typeof doorMat] ?? doorMat.wood, handle);
    group.add(door.pivot);
    world.dyn.push(door.box);
    return door;
  });
  const glassMat = applyLF(new THREE.MeshStandardMaterial({ color: 0x223034, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.26, depthWrite: false }));
  const panes = map.glass.map((g, i) => {
    const w = g.b - g.a, h = g.z1 - g.z0;
    const geo = new THREE.BoxGeometry(g.axis === 'x' ? w : 0.012, h, g.axis === 'x' ? 0.012 : w);
    const mesh = new THREE.Mesh(geo, glassMat);
    const cx = g.axis === 'x' ? (g.a + g.b) / 2 : g.c, cz = g.axis === 'x' ? -g.c : -(g.a + g.b) / 2;
    mesh.position.set(cx, (g.z0 + g.z1) / 2, cz);
    mesh.renderOrder = 4;
    group.add(mesh);
    const box: Box = {
      min: g.axis === 'x' ? [g.a, g.z0, -g.c - 0.03] : [g.c - 0.03, g.z0, -g.b],
      max: g.axis === 'x' ? [g.b, g.z1, -g.c + 0.03] : [g.c + 0.03, g.z1, -g.a], pen: true, tag: 'glass', mat: 'glass', id: i,
    };
    world.dyn.push(box);
    return new Pane(i, mesh, box, g.axis as 'x' | 'y');
  });
  // what glows: tube covers and bulbs, so the bloom has something to hold on to
  const tube = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 8, 9) });
  const bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 9, 5) });
  const sodium = new THREE.MeshBasicMaterial({ color: new THREE.Color(46, 26, 9) });
  for (const l of map.lights) {
    let mesh: THREE.Mesh;
    if (l.kind === 'area') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.02, 0.08), tube);
      mesh.rotation.y = 0;
      mesh.position.set(l.pos[0], l.pos[1] - 0.03, l.pos[2]);
    } else if (l.kind === 'spot') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(l.pos[1] > 6.3 ? 0.14 : 0.07, 10, 8), l.pos[1] > 6.3 ? sodium : bulb);
      mesh.position.set(l.pos[0], l.pos[1] - 0.04, l.pos[2]);
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bulb);
      mesh.position.set(l.pos[0], l.pos[1], l.pos[2]);
    }
    group.add(mesh);
  }
  const deco = new THREE.Group();
  group.add(deco);
  dress(deco);
  progress(0.92, 'Light');
  return { group, world, map, doors, panes, sky: skyT, loose, glassMat, indoors };
}

/** the ambient cubes; flat until a capture has been shipped */
export async function loadVolume(): Promise<void> {
  let dim = [2, 2, 2], min = [0, 0, 0], max = [1, 1, 1];
  let data: Uint8Array | null = null;
  try {
    const meta = await (await fetch(BASE + 'volume.json')).json();
    dim = meta.dim;
    min = meta.min;
    max = meta.max;
    data = new Uint8Array(await (await fetch(BASE + 'volume.bin')).arrayBuffer());
  } catch {
    /* no capture yet */
  }
  if (!data || data.length !== dim[0] * dim[1] * dim[2] * 6 * 4) {
    data = new Uint8Array(dim[0] * dim[1] * dim[2] * 6 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 110;
      data[i + 1] = 112;
      data[i + 2] = 122;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.Data3DTexture(data, dim[0], dim[1], dim[2] * 6);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  LF.vol.value = t;
  // the mean of the six faces, for the air: decoded, averaged, encoded again
  const [dx, dy, dz] = dim;
  const cells = dx * dy * dz;
  const avg = new Uint8Array(cells * 4);
  const R = LF.lmK.value.x, K = LF.lmK.value.y;
  const dec = (e: number) => (2 ** ((e / 255) * R) - 1) / K;
  const enc = (v: number) => (Math.log2(1 + v * K) / R) * 255;
  for (let i = 0; i < cells; i++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let f = 0; f < 6; f++) s += dec(data[(f * cells + i) * 4 + c]);
      avg[i * 4 + c] = Math.min(255, enc(s / 6) + 0.5);
    }
    avg[i * 4 + 3] = 255;
  }
  const a = new THREE.Data3DTexture(avg, dx, dy, dz);
  a.format = THREE.RGBAFormat;
  a.type = THREE.UnsignedByteType;
  a.minFilter = a.magFilter = THREE.LinearFilter;
  a.wrapS = a.wrapT = a.wrapR = THREE.ClampToEdgeWrapping;
  a.unpackAlignment = 1;
  a.needsUpdate = true;
  LF.volAvg.value = a;
  LF.volMin.value.set(min[0], min[1], min[2]);
  LF.volInv.value.set(1 / (max[0] - min[0]), 1 / (max[1] - min[1]), 1 / (max[2] - min[2]));
  LF.volDim.value.set(dim[0], dim[1], dim[2]);
}
