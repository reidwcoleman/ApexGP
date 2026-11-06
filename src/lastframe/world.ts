import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LF, applyLF } from './lighting.ts';
import { World, type Box } from './collide.ts';

export const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'lastframe/';

export interface MapData {
  mats: { mat: string; verts: number; tris: number; pos: number; nor: number; uv: number; lm: number; idx: number }[];
  materials: Record<string, { tex: string; scale: number; tint: number[]; rough: number; wet: number; metal: number; nrm: number; emit: number[] | null }>;
  textures: string[];
  colliders: [number, number, number, number, number, number, number, string, string][];
  props: { id: string; pos: number[]; rot: number; s: number }[];
  doors: { axis: string; hinge: number[]; w: number; h: number; sign: number; swing: number; kind: string; t: number }[];
  glass: { axis: string; c: number; a: number; b: number; z0: number; z1: number }[];
  spawns: { a: number[][]; b: number[][]; ffa: number[][] };
  hold: number[][];
  zones: { a: number[]; b: number[]; kind: string }[];
  lights: { kind: string; pos: number[]; color: number[]; power: number }[];
  rooms: { name: string; a: number[]; b: number[] }[];
  lm: { logr: number; k: number; size: number };
}

export class Door {
  open = 0;
  want = 0;
  dir = 1;
  readonly pivot = new THREE.Group();
  readonly box: Box;
  private closedBox: { min: [number, number, number]; max: [number, number, number] };
  readonly centre = new THREE.Vector3();
  constructor(readonly id: number, private d: MapData['doors'][number], mat: THREE.Material, handle: THREE.Material) {
    const [hx, hy, hz] = d.hinge;
    this.pivot.position.set(hx, hy, hz);
    const g = new THREE.BoxGeometry(d.w - 0.02, d.h - 0.02, d.t);
    g.translate((d.w / 2) * d.sign, d.h / 2, 0);
    // along x in the map runs along +x in the world; along y (north) runs along -z
    const axisRot = d.axis === 'x' ? 0 : Math.PI / 2;
    const leaf = new THREE.Mesh(g, mat);
    const inner = new THREE.Group();
    inner.rotation.y = axisRot;
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
    const a = d.axis === 'x';
    const p0 = d.sign > 0 ? 0 : -d.w, p1 = d.sign > 0 ? d.w : 0;
    const t = d.t / 2 + 0.02;
    this.closedBox = a
      ? { min: [hx + p0, hy, hz - t], max: [hx + p1, hy + d.h, hz + t] }
      : { min: [hx - t, hy, hz - p1], max: [hx + t, hy + d.h, hz - p0] };
    this.box = { min: [...this.closedBox.min], max: [...this.closedBox.max], pen: true, tag: 'door', mat: 'door', id };
    this.centre.set((this.closedBox.min[0] + this.closedBox.max[0]) / 2, hy + 1, (this.closedBox.min[2] + this.closedBox.max[2]) / 2);
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
      const a = this.d.axis === 'x';
      const side = a ? Math.sign(from.z - this.centre.z) : Math.sign(from.x - this.centre.x);
      this.dir = -(side || 1);
    }
  }

  update(dt: number) {
    const to = this.want;
    const before = this.open;
    this.open += Math.sign(to - this.open) * Math.min(Math.abs(to - this.open), dt * 2.6);
    if (before === this.open) return;
    const e = this.open * this.open * (3 - 2 * this.open);
    const a = this.d.axis === 'x';
    // the leaf turns about the hinge toward dir (world z for a wall along x, world x for a wall along y)
    const s = this.d.sign;
    const ang = (a ? -this.dir * s : this.dir * s) * e * 1.72;
    this.pivot.rotation.y = a ? -ang * -1 : ang;
    this.pivot.rotation.y = ang;
    const b = this.box;
    if (this.open > 0.5) {
      const [hx, hy, hz] = this.d.hinge;
      const w = this.d.w, t = 0.05;
      if (a) {
        const z0 = this.dir > 0 ? hz : hz - w, z1 = this.dir > 0 ? hz + w : hz;
        b.min = [hx - t, hy, z0];
        b.max = [hx + t, hy + this.d.h, z1];
      } else {
        const x0 = this.dir > 0 ? hx : hx - w, x1 = this.dir > 0 ? hx + w : hx;
        b.min = [x0, hy, hz - t];
        b.max = [x1, hy + this.d.h, hz + t];
      }
    } else {
      b.min = [...this.closedBox.min];
      b.max = [...this.closedBox.max];
    }
  }
}

export class Pane {
  broken = false;
  constructor(readonly id: number, readonly mesh: THREE.Mesh, readonly box: Box) {}
}

export interface Loaded {
  group: THREE.Group;
  world: World;
  map: MapData;
  doors: Door[];
  panes: Pane[];
  sky: THREE.Texture;
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
  need.push(['lm.webp', false], ['sky.webp', false]);
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
    if (d.emit) m = new THREE.MeshBasicMaterial({ color: new THREE.Color(d.emit[0], d.emit[1], d.emit[2]) });
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
  const gl = await new GLTFLoader().loadAsync(BASE + 'props.glb');
  const byId = new Map<string, THREE.Object3D>();
  for (const c of gl.scene.children) byId.set(c.name, c);
  const placed = new Map<string, MapData['props']>();
  for (const p of map.props) {
    const l = placed.get(p.id);
    if (l) l.push(p);
    else placed.set(p.id, [p]);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const prepared = new Set<THREE.Material>();
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
      if (!prepared.has(mat)) {
        prepared.add(mat);
        applyLF(mat, {});
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = 4;
      }
      const inst = new THREE.InstancedMesh(mesh.geometry, mat, list.length);
      const local = mesh.matrixWorld.clone();
      list.forEach((p, i) => {
        q.setFromAxisAngle(UP, p.rot);
        mtx.compose(v.set(p.pos[0], p.pos[1], p.pos[2]), q, sc.setScalar(p.s)).multiply(local);
        inst.setMatrixAt(i, mtx);
      });
      inst.frustumCulled = false;
      group.add(inst);
    });
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
    return new Pane(i, mesh, box);
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
  progress(0.92, 'Light');
  return { group, world, map, doors, panes, sky: skyT };
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
  LF.volMin.value.set(min[0], min[1], min[2]);
  LF.volInv.value.set(1 / (max[0] - min[0]), 1 / (max[1] - min[1]), 1 / (max[2] - min[2]));
  LF.volDim.value.set(dim[0], dim[1], dim[2]);
}
