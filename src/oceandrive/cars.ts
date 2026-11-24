import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import type { Env } from './env.ts';
import type { Ground } from './height.ts';
import type { Input } from './input.ts';

/**
 * Cars on Ocean Drive: the Ferrari 458 Italia from the three.js examples (model by vicent091036,
 * CC BY 4.0) in a dozen paints — clear-coated metallic body, chrome-and-rubber wheels that turn and
 * steer, tinted glass, the baked contact shadow under each. Parked nose-north along both curbs; a
 * few cruise the northbound lane at Ocean Drive pace and stop for whatever is in front of them.
 * Press F next to one to drive it: arcade handling (bicycle model, grip with a little slide on the
 * handbrake), curbs climbable, walls and other cars stop you.
 */
const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

const PAINTS = [0xf4f4f1, 0x0d0d10, 0xb5121b, 0xf2c230, 0x9aa2aa, 0x1f8fa0, 0x8fc3e6, 0xf08aa8, 0x1b2a4a, 0x2f6a3e, 0xe8622a, 0xffffff];
const LANE_X = -1.1; // the northbound lane's centre (three x)
const WB = 2.65;      // wheelbase

interface Car {
  root: THREE.Object3D;
  body: THREE.MeshPhysicalMaterial;
  wheels: { fl: THREE.Object3D | null; fr: THREE.Object3D | null; rl: THREE.Object3D | null; rr: THREE.Object3D | null };
  x: number;
  z: number;
  yaw: number; // heading: 0 = +z, PI = -z (north)
  v: number;
  steer: number;
  spin: number;
  ai: boolean;
  aiSpeed: number;
}

export class Cars {
  readonly list: Car[] = [];
  private tpl: THREE.Object3D | null = null;
  private fwdSign = 1;
  private driven: Car | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYawOff = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly scene: THREE.Scene, readonly env: Env, readonly ground: Ground, readonly sw: number) {}

  async load() {
    const draco = new DRACOLoader();
    draco.setDecoderPath(BASE + 'draco/');
    const gl = new GLTFLoader();
    gl.setDRACOLoader(draco);
    const gltf = await gl.loadAsync(BASE + 'cars/ferrari.glb');
    const model = gltf.scene.children[0];
    const fl = model.getObjectByName('wheel_fl'), rl = model.getObjectByName('wheel_rl');
    if (fl && rl) this.fwdSign = Math.sign(fl.position.z - rl.position.z) || 1;
    this.tpl = model;
    const ao = await new THREE.TextureLoader().loadAsync(BASE + 'cars/ferrari_ao.png');
    const shadowMat = new THREE.MeshBasicMaterial({ map: ao, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true, depthWrite: false });
    const shadowGeo = new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4);
    shadowGeo.rotateX(-Math.PI / 2);
    const detail = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.35 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.72 });
    // one template: the shared materials on, then every part merged by material (the body, and each
    // wheel on its own so it can turn): ~a dozen draw calls a car instead of ~70
    const paintTpl = new THREE.MeshPhysicalMaterial({ name: 'paint' });
    const setTpl = (name: string, mat: THREE.Material) => {
      const o = model.getObjectByName(name) as THREE.Mesh | undefined;
      if (o) o.material = mat;
    };
    setTpl('body', paintTpl);
    for (const n of ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim']) setTpl(n, detail);
    setTpl('glass', glass);
    // fold the 19 materials into a few: the cabin is seen through tinted glass, the trim is all metal
    const cabin = new THREE.MeshStandardMaterial({ name: 'cabin', color: 0x2b2a2a, roughness: 0.72, metalness: 0.05 });
    model.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh) return;
      const n = (mm.material as THREE.Material).name;
      if (/Interior|Leather|Carpet|plastic_gray/.test(n)) mm.material = cabin;
      else if (/metal_gray|metal_chrome|Carbon_Fiber/.test(n)) mm.material = detail;
    });
    await MeshoptSimplifier.ready;
    const merged = mergeCar(model, ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']);
    const make = (paint: number, ai: boolean): Car => {
      const root = new THREE.Group();
      const m = merged.clone(true);
      // the model faces +z when fwdSign is +1; turn it so the car's nose is +z in its own frame
      if (this.fwdSign < 0) m.rotation.y = Math.PI;
      root.add(m);
      const body = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.9, roughness: 0.42, clearcoat: 1.0, clearcoatRoughness: 0.03 });
      m.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh && (mm.material as THREE.Material).name === 'paint') mm.material = body;
      });
      const sh = new THREE.Mesh(shadowGeo, shadowMat);
      sh.position.y = 0.012;
      sh.renderOrder = 1;
      root.add(sh);
      this.env.prepObject(m, true, true);
      sh.castShadow = sh.receiveShadow = false;
      this.scene.add(root);
      const car: Car = {
        root, body,
        wheels: { fl: m.getObjectByName('wheel_fl') ?? null, fr: m.getObjectByName('wheel_fr') ?? null, rl: m.getObjectByName('wheel_rl') ?? null, rr: m.getObjectByName('wheel_rr') ?? null },
        x: 0, z: 0, yaw: Math.PI, v: 0, steer: 0, spin: 0, ai, aiSpeed: 0,
      };
      this.list.push(car);
      return car;
    };
    // parked along both curbs inside the block (Blender y -58..58 -> three z 58..-58)
    let k = 0;
    for (const side of [-1, 1]) {
      const x = side < 0 ? -5.35 : 4.85;
      for (let y = -56; y <= 56; y += 8.2) {
        if (Math.abs(y + 3) < 6) continue; // a gap by the Colony
        const h = Math.sin(y * 12.9898 + side * 78.233) * 43758.5453;
        if (h - Math.floor(h) < 0.42) continue;
        const c = make(PAINTS[k++ % PAINTS.length], false);
        c.x = x;
        c.z = -y;
        c.yaw = Math.PI;
      }
    }
    // cruisers
    for (let i = 0; i < 3; i++) {
      const c = make(PAINTS[(k + i * 3) % PAINTS.length], true);
      c.x = LANE_X;
      c.z = 300 - i * 230;
      c.yaw = Math.PI;
      c.aiSpeed = 8 + i * 1.3;
      c.v = c.aiSpeed;
    }
    for (const c of this.list) this.place(c, 0);
  }

  private place(c: Car, dt: number) {
    const gh = this.groundAt(c.x, c.z);
    c.root.position.set(c.x, gh, c.z);
    c.root.rotation.y = c.yaw;
    c.spin += (c.v * dt) / 0.34;
    const w = c.wheels;
    for (const wh of [w.fl, w.fr, w.rl, w.rr]) if (wh) wh.rotation.x = c.spin * this.fwdSign;
    for (const wh of [w.fl, w.fr]) if (wh) wh.rotation.y = c.steer * 0.6 * this.fwdSign;
  }

  /** road height; beyond the heightmap the street itself stays drivable */
  private groundAt(x: number, z: number): number {
    const h = this.ground.height(x, z);
    if (!Number.isNaN(h)) return h;
    return 0;
  }

  /** the car that blocked the last free() test (null: the world did, or nothing) */
  private hitCar: Car | null = null;

  private free(x: number, z: number, yaw: number, fromY: number, self: Car): boolean {
    this.hitCar = null;
    const s = Math.sin(yaw), co = Math.cos(yaw);
    for (const [lx, lz] of [[0.95, 2.2], [-0.95, 2.2], [0.95, -2.2], [-0.95, -2.2], [0, 2.3], [0, -2.3], [0.95, 0], [-0.95, 0]]) {
      const px = x + lx * co + lz * s, pz = z - lx * s + lz * co;
      if (this.ground.inside(px, pz)) {
        if (this.ground.blocked(px, pz)) return false;
        if (this.ground.height(px, pz) - fromY > 0.24) return false;
      } else {
        // outside the map: only Ocean Drive's roadway
        if (px < -6.4 || px > 5.9 || pz > 330 || pz < -410) return false;
      }
    }
    for (const o of this.list) {
      if (o === self) continue;
      const dx = o.x - x, dz = o.z - z;
      if (dx * dx + dz * dz > 49) continue;
      // two circles per car
      for (const a of [-1.3, 1.3]) for (const b of [-1.3, 1.3]) {
        const ax = x + Math.sin(yaw) * a, az = z + Math.cos(yaw) * a;
        const bx = o.x + Math.sin(o.yaw) * b, bz = o.z + Math.cos(o.yaw) * b;
        if ((ax - bx) ** 2 + (az - bz) ** 2 < 2.0 * 2.0) {
          this.hitCar = o;
          return false;
        }
      }
    }
    return true;
  }

  /** is a point inside any car's footprint */
  blocks(x: number, z: number): boolean {
    for (const c of this.list) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 9) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      const lz = dx * s + dz * co, lx = dx * co - dz * s;
      if (Math.abs(lx) < 1.0 && Math.abs(lz) < 2.3) return true;
    }
    return false;
  }

  nearest(p: THREE.Vector3, r: number): Car | null {
    let best: Car | null = null, bd = r * r;
    for (const c of this.list) {
      const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  near(p: THREE.Vector3, r: number): boolean {
    return !!this.nearest(p, r);
  }

  enter(c: Car) {
    c.ai = false;
    this.driven = c;
    this.camYawOff = 0;
    this.camPos.set(c.x - Math.sin(c.yaw) * 7, c.root.position.y + 2.4, c.z - Math.cos(c.yaw) * 7);
  }

  exit(): { x: number; z: number; yaw: number } | null {
    const c = this.driven;
    if (!c || Math.abs(c.v) > 3) return null;
    c.v = 0;
    this.driven = null;
    // out of the driver's door (left side)
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    for (const side of [1, -1]) {
      const x = c.x + co * 1.5 * side, z = c.z - s * 1.5 * side;
      if (!this.ground.blocked(x, z)) return { x, z, yaw: c.yaw };
    }
    return { x: c.x, z: c.z + 3, yaw: c.yaw };
  }

  playerPos(): THREE.Vector3 {
    const c = this.driven;
    return c ? this.tmp.set(c.x, c.root.position.y, c.z) : this.tmp.set(0, 0, 0);
  }

  speedKmh(): number {
    return this.driven ? Math.abs(this.driven.v) * 3.6 : 0;
  }

  drive(dt: number, inp: Input, camera: THREE.PerspectiveCamera) {
    const c = this.driven;
    if (!c) return;
    const mv = inp.move();
    const hand = inp.down('Space');
    // throttle / brake / reverse
    const top = 52, acc = 9.5, brake = 16;
    if (mv.y > 0) c.v += (c.v < 0 ? brake : acc * (1 - Math.max(0, c.v) / top)) * dt * mv.y;
    else if (mv.y < 0) c.v -= (c.v > 0 ? brake : 5) * dt * -mv.y;
    c.v -= c.v * (0.08 + (hand ? 1.4 : 0)) * dt + Math.sign(c.v) * 0.4 * dt * (mv.y === 0 ? 1 : 0);
    if (Math.abs(c.v) < 0.05 && mv.y === 0) c.v = 0;
    c.v = THREE.MathUtils.clamp(c.v, -9, top);
    // steering: less lock at speed
    const lock = 0.62 / (1 + Math.abs(c.v) * 0.045);
    c.steer += (-mv.x * lock - c.steer) * Math.min(1, dt * 7);
    const yawRate = (c.v * Math.tan(c.steer)) / WB * (hand ? 1.35 : 1);
    const ny = c.yaw + yawRate * dt;
    const nx = c.x + Math.sin(ny) * c.v * dt, nz = c.z + Math.cos(ny) * c.v * dt;
    const fromY = c.root.position.y;
    if (this.free(nx, nz, ny, fromY, c)) {
      c.x = nx;
      c.z = nz;
      c.yaw = ny;
    } else if (this.hitCar && !this.hitCar.ai) {
      // shove the other car along (they're parked, not bolted down), lose some speed
      const o = this.hitCar;
      const dx = nx - c.x, dz = nz - c.z;
      const ox = o.x + dx * 1.05, oz = o.z + dz * 1.05;
      this.hitCar = null;
      if (this.free(ox, oz, o.yaw + c.steer * 0.02, o.root.position.y, o)) {
        o.x = ox;
        o.z = oz;
        o.yaw += c.steer * 0.02 * Math.sign(c.v);
        this.place(o, 0);
        c.x = nx;
        c.z = nz;
        c.yaw = ny;
      }
      c.v *= 1 - Math.min(1, dt * 2.5);
    } else if (this.free(c.x, c.z, ny, fromY, c)) {
      c.yaw = ny;
      c.v *= -0.25;
    } else {
      c.v *= -0.25;
    }
    // ride height: settle on curbs
    this.place(c, dt);
    // chase camera
    this.camYawOff = THREE.MathUtils.clamp(this.camYawOff - inp.mdx * 0.003, -2.5, 2.5);
    if (inp.mdx === 0) this.camYawOff *= 1 - Math.min(1, dt * 0.8);
    const back = 6.4 + Math.abs(c.v) * 0.03;
    const yaw = c.yaw + this.camYawOff;
    const want = this.tmp.set(c.x - Math.sin(yaw) * back, c.root.position.y + 2.1, c.z - Math.cos(yaw) * back);
    this.camPos.lerp(want, Math.min(1, dt * 5));
    camera.position.copy(this.camPos);
    this.camLook.set(c.x + Math.sin(c.yaw) * 2.5, c.root.position.y + 1.0, c.z + Math.cos(c.yaw) * 2.5);
    camera.lookAt(this.camLook);
  }

  update(dt: number, walker: THREE.Vector3 | null) {
    for (const c of this.list) {
      if (!c.ai) {
        if (c !== this.driven) {
          // rolling to a stop when abandoned
          if (Math.abs(c.v) > 0.01) {
            c.v *= 1 - Math.min(1, dt * 1.5);
            const nx = c.x + Math.sin(c.yaw) * c.v * dt, nz = c.z + Math.cos(c.yaw) * c.v * dt;
            if (this.free(nx, nz, c.yaw, c.root.position.y, c)) {
              c.x = nx;
              c.z = nz;
            } else c.v = 0;
            this.place(c, dt);
          }
        }
        continue;
      }
      // cruise north in the lane, slow for anything ahead (cars, you, the driven car)
      let gap = 99;
      for (const o of this.list) {
        if (o === c) continue;
        if (Math.abs(o.x - c.x) < 2.2 && o.z < c.z) gap = Math.min(gap, c.z - o.z - 4.6);
      }
      if (walker && Math.abs(walker.x - c.x) < 1.8 && walker.z < c.z) gap = Math.min(gap, c.z - walker.z - 3.0);
      const want = gap < 2 ? 0 : Math.min(c.aiSpeed, gap * 0.9);
      c.v += THREE.MathUtils.clamp(want - c.v, -9 * dt, 3 * dt);
      c.z -= c.v * dt;
      c.x += (LANE_X - c.x) * Math.min(1, dt);
      c.yaw = Math.PI;
      if (c.z < -405) c.z = 325;
      this.place(c, dt);
    }
  }
}

/** merge a model's meshes by material, keeping the named sub-trees (wheels) as their own merged groups */
function mergeCar(model: THREE.Object3D, keep: string[]): THREE.Object3D {
  model.updateMatrixWorld(true);
  const out = new THREE.Group();
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const collect = (rootObj: THREE.Object3D, skip: Set<THREE.Object3D>, rel: THREE.Matrix4) => {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    rootObj.traverse((o) => {
      for (let p: THREE.Object3D | null = o; p && p !== rootObj; p = p.parent) if (skip.has(p)) return;
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      let g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rel, m.matrixWorld));
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (g.index) g = g.toNonIndexed();
      const mat = m.material as THREE.Material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g);
    });
    const grp = new THREE.Group();
    for (const [mat, gs] of byMat) {
      const g0 = mergeGeometries(gs, false);
      if (!g0) continue;
      // only the cabin (behind tinted glass) is simplified: re-derived normals spoil the paint
      grp.add(new THREE.Mesh(mat.name === 'cabin' ? simplify(g0, 0.15) : g0, mat));
    }
    return grp;
  };
  const wheels = keep.map((n) => model.getObjectByName(n)).filter((w): w is THREE.Object3D => !!w);
  out.add(collect(model, new Set(wheels), inv));
  for (const w of wheels) {
    // each wheel merged about its own pivot, placed where it was
    const wInv = new THREE.Matrix4().copy(w.matrixWorld).invert();
    const g = collect(w, new Set(), wInv);
    g.name = w.name;
    g.matrix.multiplyMatrices(inv, w.matrixWorld);
    g.matrix.decompose(g.position, g.quaternion, g.scale);
    out.add(g);
  }
  return out;
}

/** meshoptimizer: weld, then simplify to a share of the triangles (the silhouette kept) */
function simplify(g0: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
  g0.deleteAttribute('normal');
  const g = mergeVertices(g0, 1e-4);
  const idx = g.index!;
  const target = Math.max(3, Math.floor((idx.count * ratio) / 3) * 3);
  if (idx.count < 600) {
    g.computeVertexNormals();
    return g;
  }
  const [out] = MeshoptSimplifier.simplify(new Uint32Array(idx.array), g.attributes.position.array as Float32Array, 3, target, 0.01);
  g.setIndex(new THREE.BufferAttribute(out, 1));
  g.computeVertexNormals();
  return g;
}
