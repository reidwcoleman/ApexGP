import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { buildCar, carWheel, liveryTexture } from './vehicles/carmodel.ts';
import { MODELS, PAINTS, SPORT_PAINT, type ModelId } from './vehicles/specs.ts';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Env } from './env.ts';
import { fill } from './peds.ts';
import type { Ground } from './height.ts';
import type { Input } from './input.ts';

/**
 * Cars on Ocean Drive. Thirteen body types from the loft generator (sedan, compact, SUV, the boxy
 * off-roader, pickup, coupe, supercar, muscle car, van, taxi, police sedan and SUV, a steel
 * wedge-truck) plus the Ferrari 458 from the three.js examples (model by vicent091036, CC BY 4.0),
 * in random types and paints: white, black and grey mostly, Miami's flamingo, aqua and mint too.
 *
 * Parked along both curbs; traffic on two routes, each car with a seated driver: a loop round the
 * block (Ocean Drive north, 8th west, Collins south, 7th east) and through-traffic up Ocean Drive.
 * Every moving car follows its route at its own pace, slows for the corners, keeps its distance to
 * whatever is ahead (cars, you, people on the road) and waits. Press F next to any car to drive it
 * (its driver gets out first): arcade handling, curbs climbable, walls stop you, parked cars get shoved.
 */
const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

const LANE_X = -1.1; // Ocean Drive's northbound lane (three x)

interface Route {
  pts: THREE.Vector2[]; // x, z every metre
  head: number[];
  vmax: number[];
  loop: boolean;
}

export interface Car {
  root: THREE.Object3D;
  wheels: THREE.Object3D[]; // fl, fr, rl, rr
  lamps: THREE.MeshStandardMaterial[];
  halfL: number;
  halfW: number;
  wb: number;
  wheelR: number;
  x: number;
  z: number;
  yaw: number; // heading: 0 = +z, PI = -z (north)
  v: number;
  steer: number;
  spin: number;
  route: Route | null;
  s: number;
  cruise: number;
  driver: Person | null;
  seat: THREE.Vector3;
  kind: string;
}

const lampHead = () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.4, roughness: 0.15, vertexColors: true });
const lampTail = () => new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 0.6, roughness: 0.2, vertexColors: true });

/** paint: the white vertex colour takes the paint, the dark trim and chrome keep their own */
function paintMaterial(color: number, flake: boolean): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, vertexColors: true, metalness: flake ? 0.55 : 0.15, roughness: flake ? 0.38 : 0.32, clearcoat: 1, clearcoatRoughness: 0.04 });
  m.customProgramCacheKey = () => 'od-paint';
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <color_fragment>',
      `#if defined( USE_COLOR )
        float isPaint = step( 0.94, min( vColor.r, min( vColor.g, vColor.b ) ) );
        diffuseColor.rgb = mix( vColor.rgb, diffuseColor.rgb, isPaint );
      #endif`,
    );
  };
  return m;
}

export class Cars {
  readonly list: Car[] = [];
  private driven: Car | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYawOff = 0;
  private readonly tmp = new THREE.Vector3();
  private hitCar: Car | null = null;
  private rnd: () => number;
  private readonly routes: Route[] = [];
  private kinds = new Map<string, { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; heads: THREE.BufferGeometry; tails: THREE.BufferGeometry; decal: THREE.BufferGeometry | null; wheel: THREE.BufferGeometry }>();
  private ferrari: THREE.Object3D | null = null;
  private ferrariFwd = 1;
  private glass = new THREE.MeshPhysicalMaterial({ color: 0x080b0e, metalness: 0.3, roughness: 0.02, transparent: true, opacity: 0.88, clearcoat: 1, envMapIntensity: 1.5 });
  private wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.4 });
  private walkers: { x: number; z: number }[] = [];

  constructor(readonly scene: THREE.Scene, readonly env: Env, readonly ground: Ground, readonly sw: number, readonly kit: PeopleKit) {
    let s = 4242;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.routes.push(makeRoute(blockLoop(), true), makeRoute([new THREE.Vector2(LANE_X, 330), new THREE.Vector2(LANE_X, -405)], false));
  }

  async load() {
    const draco = new DRACOLoader();
    draco.setDecoderPath(BASE + 'draco/');
    const gl = new GLTFLoader();
    gl.setDRACOLoader(draco);
    const gltf = await gl.loadAsync(BASE + 'cars/ferrari.glb');
    const model = gltf.scene.children[0];
    const fl = model.getObjectByName('wheel_fl'), rl = model.getObjectByName('wheel_rl');
    if (fl && rl) this.ferrariFwd = Math.sign(fl.position.z - rl.position.z) || 1;
    const detail = new THREE.MeshStandardMaterial({ name: 'detail', color: 0xffffff, metalness: 1.0, roughness: 0.35 });
    const cabin = new THREE.MeshStandardMaterial({ name: 'cabin', color: 0x2b2a2a, roughness: 0.72, metalness: 0.05 });
    const paintTpl = new THREE.MeshPhysicalMaterial({ name: 'paint' });
    model.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh) return;
      const n = (mm.material as THREE.Material).name;
      if (mm.name === 'body') mm.material = paintTpl;
      else if (mm.name === 'glass') mm.material = this.glass;
      else if (/^rim_|^trim$/.test(mm.name) || /metal_gray|metal_chrome|Carbon_Fiber/.test(n)) mm.material = detail;
      else if (/Interior|Leather|Carpet|plastic_gray/.test(n)) mm.material = cabin;
    });
    await MeshoptSimplifier.ready;
    this.ferrari = mergeModel(model, ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']);

    // parked: both curbs of Ocean Drive, nose north, ~70 % of the spaces taken
    for (const side of [-1, 1]) {
      const x = side < 0 ? -5.3 : 4.85;
      for (let y = -88; y <= 90; y += 7.4) {
        if (y > -78 && y < -59) continue; // 7th Street's mouth and crosswalks
        if (y > 58 && y < 78) continue; // 8th's
        if (this.rnd() < 0.3) continue;
        const c = this.make(this.pickKind(false), false);
        c.x = x + (this.rnd() - 0.5) * 0.25;
        c.z = -y;
        c.yaw = Math.PI + (this.rnd() - 0.5) * 0.04;
      }
    }
    const loop = this.routes[0], thru = this.routes[1];
    for (let i = 0; i < 10; i++) this.addTraffic(loop, (i / 10) * loop.pts.length);
    for (let i = 0; i < 4; i++) this.addTraffic(thru, i * 180 + 20);
    for (const c of this.list) this.place(c, 0);
  }

  private pickKind(moving: boolean): string {
    const r = this.rnd();
    const table: [string, number][] = [
      ['sedan', 14], ['compact', 9], ['suv', 14], ['gwagon', 8], ['pickup', 5], ['coupe', 8], ['super', 6], ['muscle', 6],
      ['ferrari', 7], ['van', 4], ['taxi', moving ? 7 : 3], ['police', moving ? 2 : 1], ['policeSuv', 1], ['cyber', 2],
    ];
    const tot = table.reduce((a, b) => a + b[1], 0);
    let acc = 0;
    for (const [k, w] of table) {
      acc += w / tot;
      if (r < acc) return k;
    }
    return 'sedan';
  }

  private geo(id: ModelId) {
    let k = this.kinds.get(id);
    if (!k) {
      const spec = MODELS[id];
      const g = buildCar(spec);
      const ww = id === 'pickup' || id === 'gwagon' ? 0.28 : id === 'super' || id === 'muscle' ? 0.3 : 0.24;
      const style = id === 'gwagon' || id === 'police' || id === 'policeSuv' ? 'black' : id === 'van' ? 'steel' : 'alloy';
      k = { body: g.body, glass: g.glass, heads: g.heads, tails: g.tails, decal: g.decal, wheel: carWheel(spec.wheelR, ww, style) };
      this.kinds.set(id, k);
    }
    return k;
  }

  private make(kind: string, moving: boolean): Car {
    const root = new THREE.Group();
    const lamps: THREE.MeshStandardMaterial[] = [];
    let wheels: THREE.Object3D[] = [];
    let halfL = 2.3, halfW = 1.0, wb = 2.65, wheelR = 0.34;
    const sporty = kind === 'super' || kind === 'coupe' || kind === 'muscle' || kind === 'ferrari';
    const paint = kind === 'taxi' ? 0xf2c21b : kind === 'police' || kind === 'policeSuv' ? 0xf2f2f0 : sporty ? pick(SPORT_PAINT.concat(PAINTS), this.rnd) : pick(PAINTS, this.rnd);
    const seat = new THREE.Vector3(0.38, 0.35, -0.15);
    if (kind === 'ferrari' && this.ferrari) {
      const m = this.ferrari.clone(true);
      if (this.ferrariFwd < 0) m.rotation.y = Math.PI;
      root.add(m);
      const body = paintMaterial(paint, true);
      body.vertexColors = false;
      m.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh && (mm.material as THREE.Material).name === 'paint') mm.material = body;
      });
      wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((n) => m.getObjectByName(n) ?? new THREE.Object3D());
      halfL = 2.3;
      halfW = 0.98;
      wheelR = 0.34;
      seat.set(0.36, 0.22, -0.25);
      root.add(shadowPlane(4.6, 2.2));
    } else {
      const id = kind as ModelId;
      const spec = MODELS[id];
      const g = this.geo(id);
      const body = new THREE.Mesh(g.body, kind === 'cyber' ? new THREE.MeshPhysicalMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.32, vertexColors: true }) : paintMaterial(paint, this.rnd() < 0.6));
      root.add(body);
      root.add(new THREE.Mesh(g.glass, this.glass));
      const hm = lampHead(), tm = lampTail();
      lamps.push(hm, tm);
      root.add(new THREE.Mesh(g.heads, hm), new THREE.Mesh(g.tails, tm));
      if (g.decal) {
        const dm = new THREE.MeshStandardMaterial({ map: liveryTexture(kind === 'taxi' ? 'taxi' : 'police'), transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
        root.add(new THREE.Mesh(g.decal, dm));
      }
      const tw = spec.W / 2 - 0.12;
      for (let w = 0; w < 4; w++) {
        const front = w < 2, left = w % 2 === 0;
        const pivot = new THREE.Group();
        pivot.position.set((left ? 1 : -1) * tw, spec.wheelR, front ? spec.wb / 2 : -spec.wb / 2);
        const wm = new THREE.Mesh(g.wheel, this.wheelMat);
        if (!left) wm.scale.x = -1;
        pivot.add(wm);
        root.add(pivot);
        wheels.push(pivot);
      }
      halfL = spec.L / 2;
      halfW = spec.W / 2;
      wb = spec.wb;
      wheelR = spec.wheelR;
      seat.set(spec.W * 0.2, spec.clear + 0.28, -spec.L * 0.04);
      root.add(shadowPlane(spec.L * 1.02, spec.W * 1.12));
    }
    this.env.prepObject(root, true, true);
    // only the body casts (glass, lamps, wheels and trim add draw calls to every cascade for nothing)
    root.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh) return;
      const mat = mm.material as THREE.Material;
      mm.castShadow = mat.name === 'od-body' || (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && mat !== this.glass && !o.userData.noShadow;
      if (o.userData.noShadow) mm.receiveShadow = false;
    });
    this.scene.add(root);
    const car: Car = { root, wheels, lamps, halfL, halfW, wb, wheelR, x: 0, z: 0, yaw: Math.PI, v: 0, steer: 0, spin: 0, route: null, s: 0, cruise: 0, driver: null, seat, kind };
    if (moving) this.seatDriver(car);
    this.list.push(car);
    return car;
  }

  private seatDriver(c: Car) {
    const r = this.rnd;
    const female = r() < 0.4;
    const bodies = female ? ['Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'] : ['Male_Adult_01', 'Male_Adult_05', 'Male_Adult_14', 'Sports_Male_01'];
    const look: Look = {
      female, tone: r(), body: bodies[Math.floor(r() * bodies.length)], hair: 'none', hairColor: 0x2a1d14,
      top: 'tshirt', topColor: 0xffffff, tint: 0, bottom: 'jeans', bottomColor: 0x2d3f63, height: 1,
    };
    const p = new Person(this.kit, look);
    p.play('sit', { offset: r() });
    p.update(0.016);
    p.root.position.copy(c.seat).add(new THREE.Vector3(0, -0.42, 0));
    c.root.add(p.root);
    this.env.prepObject(p.root, false, true);
    fill(p.root);
    c.driver = p;
  }

  private addTraffic(route: Route, s: number) {
    const c = this.make(this.pickKind(true), true);
    c.route = route;
    c.s = s;
    c.cruise = 7.5 + this.rnd() * 4;
    c.v = c.cruise * 0.5;
    const i = Math.floor(s) % route.pts.length;
    c.x = route.pts[i].x;
    c.z = route.pts[i].y;
    c.yaw = route.head[i];
  }

  private place(c: Car, dt: number) {
    const gh = this.groundAt(c.x, c.z);
    c.root.position.set(c.x, gh, c.z);
    c.root.rotation.y = c.yaw;
    c.spin += (c.v * dt) / c.wheelR;
    const sx = c.kind === 'ferrari' ? this.ferrariFwd : 1;
    c.wheels.forEach((w, i) => w.rotation.set(c.spin * sx, i < 2 ? c.steer * 0.7 : 0, 0, 'YXZ'));
    if (c.driver) c.driver.update(dt);
  }

  /** road height; beyond the heightmap the streets stay drivable */
  private groundAt(x: number, z: number): number {
    const h = this.ground.height(x, z);
    return Number.isNaN(h) ? 0 : h;
  }

  private free(x: number, z: number, yaw: number, fromY: number, self: Car): boolean {
    this.hitCar = null;
    const s = Math.sin(yaw), co = Math.cos(yaw);
    const L = self.halfL - 0.05, W = self.halfW - 0.05;
    for (const [lx, lz] of [[W, L], [-W, L], [W, -L], [-W, -L], [0, L + 0.1], [0, -L - 0.1], [W, 0], [-W, 0]]) {
      const px = x + lx * co + lz * s, pz = z - lx * s + lz * co;
      if (this.ground.inside(px, pz)) {
        if (this.ground.blocked(px, pz)) return false;
        if (this.ground.height(px, pz) - fromY > 0.24) return false;
      } else if (!onStreet(px, pz)) return false;
    }
    for (const o of this.list) {
      if (o === self) continue;
      const dx = o.x - x, dz = o.z - z;
      if (dx * dx + dz * dz > 100) continue;
      const ra = self.halfW, rb = o.halfW;
      const oa = self.halfL - ra, ob = o.halfL - rb;
      for (const a of [-oa, 0, oa]) for (const b of [-ob, 0, ob]) {
        const ax = x + Math.sin(yaw) * a, az = z + Math.cos(yaw) * a;
        const bx = o.x + Math.sin(o.yaw) * b, bz = o.z + Math.cos(o.yaw) * b;
        if ((ax - bx) ** 2 + (az - bz) ** 2 < (ra + rb) ** 2) {
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
      if (dx * dx + dz * dz > 16) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      const lz = dx * s + dz * co, lx = dx * co - dz * s;
      if (Math.abs(lx) < c.halfW && Math.abs(lz) < c.halfL) return true;
    }
    return false;
  }

  nearest(p: THREE.Vector3, r: number): Car | null {
    let best: Car | null = null, bd = Infinity;
    for (const c of this.list) {
      const d = Math.hypot(c.x - p.x, c.z - p.z) - c.halfW;
      if (d < r && d < bd) {
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
    if (c.driver) {
      c.root.remove(c.driver.root);
      c.driver = null;
    }
    c.route = null;
    this.driven = c;
    this.camYawOff = 0;
    this.camPos.set(c.x - Math.sin(c.yaw) * 7, c.root.position.y + 2.4, c.z - Math.cos(c.yaw) * 7);
  }

  exit(): { x: number; z: number; yaw: number } | null {
    const c = this.driven;
    if (!c || Math.abs(c.v) > 3) return null;
    c.v = 0;
    this.driven = null;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    for (const side of [1, -1]) {
      const x = c.x + co * (c.halfW + 0.6) * side, z = c.z - s * (c.halfW + 0.6) * side;
      if (!this.ground.blocked(x, z) && !this.blocks(x, z)) return { x, z, yaw: c.yaw };
    }
    return { x: c.x, z: c.z + c.halfL + 1, yaw: c.yaw };
  }

  playerPos(): THREE.Vector3 {
    const c = this.driven;
    return c ? this.tmp.set(c.x, c.root.position.y, c.z) : this.tmp.set(0, 0, 0);
  }

  speedKmh(): number {
    return this.driven ? Math.abs(this.driven.v) * 3.6 : 0;
  }

  /** glossy paint and glass reflect the street (the nearest probe) */
  applyProbes() {
    const mid = this.env.probeAt(0, 0);
    if (mid) this.glass.envMap = mid;
    for (const c of this.list) {
      const t = this.env.probeAt(c.x, c.z);
      if (!t) continue;
      c.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
        if (m && (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && m !== this.glass) {
          m.envMap = t;
          m.envMapIntensity = 1.2;
          m.needsUpdate = true;
        }
      });
    }
  }

  setNight(n: number) {
    // the probes were taken by day: at dusk the paint and glass reflect a much darker street
    const k = n ? 0.12 : 1;
    this.glass.envMapIntensity = 1.5 * k;
    for (const c of this.list)
      c.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
        if (m && m.isMeshPhysicalMaterial && m !== this.glass) m.envMapIntensity = 1.2 * k;
      });
    for (const c of this.list) {
      const [h, t] = c.lamps;
      if (h) h.emissiveIntensity = 0.4 + n * 6;
      if (t) t.emissiveIntensity = 0.6 + n * 3;
    }
  }

  /** people on foot, for the traffic to stop for */
  setWalkers(w: { x: number; z: number }[]) {
    this.walkers = w;
  }

  drive(dt: number, inp: Input, camera: THREE.PerspectiveCamera) {
    const c = this.driven;
    if (!c) return;
    const mv = inp.move();
    const hand = inp.down('Space');
    const fast = c.kind === 'super' || c.kind === 'ferrari' || c.kind === 'coupe' || c.kind === 'muscle';
    const top = c.kind === 'van' || c.kind === 'pickup' ? 38 : fast ? 60 : 48;
    const acc = fast ? 11 : 8, brake = 16;
    if (mv.y > 0) c.v += (c.v < 0 ? brake : acc * (1 - Math.max(0, c.v) / top)) * dt * mv.y;
    else if (mv.y < 0) c.v -= (c.v > 0 ? brake : 5) * dt * -mv.y;
    c.v -= c.v * (0.08 + (hand ? 1.4 : 0)) * dt + Math.sign(c.v) * 0.4 * dt * (mv.y === 0 ? 1 : 0);
    if (Math.abs(c.v) < 0.05 && mv.y === 0) c.v = 0;
    c.v = THREE.MathUtils.clamp(c.v, -9, top);
    const lock = 0.62 / (1 + Math.abs(c.v) * 0.045);
    c.steer += (-mv.x * lock - c.steer) * Math.min(1, dt * 7);
    const yawRate = ((c.v * Math.tan(c.steer)) / c.wb) * (hand ? 1.35 : 1);
    const ny = c.yaw + yawRate * dt;
    const nx = c.x + Math.sin(ny) * c.v * dt, nz = c.z + Math.cos(ny) * c.v * dt;
    const fromY = c.root.position.y;
    if (this.free(nx, nz, ny, fromY, c)) {
      c.x = nx;
      c.z = nz;
      c.yaw = ny;
    } else if (this.hitCar && !this.hitCar.route) {
      const o = this.hitCar;
      const ox = o.x + (nx - c.x) * 1.05, oz = o.z + (nz - c.z) * 1.05;
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
    } else c.v *= -0.25;
    this.place(c, dt);
    this.camYawOff = THREE.MathUtils.clamp(this.camYawOff - inp.mdx * 0.003, -2.5, 2.5);
    if (inp.mdx === 0) this.camYawOff *= 1 - Math.min(1, dt * 0.8);
    const back = c.halfL + 4.2 + Math.abs(c.v) * 0.03;
    const yaw = c.yaw + this.camYawOff;
    const want = this.tmp.set(c.x - Math.sin(yaw) * back, c.root.position.y + 1.6 + c.halfW * 0.5, c.z - Math.cos(yaw) * back);
    this.camPos.lerp(want, Math.min(1, dt * 5));
    camera.position.copy(this.camPos);
    this.camLook.set(c.x + Math.sin(c.yaw) * 2.5, c.root.position.y + 1.0, c.z + Math.cos(c.yaw) * 2.5);
    camera.lookAt(this.camLook);
  }

  update(dt: number, walker: THREE.Vector3 | null, eye: THREE.Vector3) {
    for (const c of this.list) {
      if (c === this.driven) continue;
      if (!c.route) {
        if (Math.abs(c.v) > 0.01) {
          c.v *= 1 - Math.min(1, dt * 1.5);
          const nx = c.x + Math.sin(c.yaw) * c.v * dt, nz = c.z + Math.cos(c.yaw) * c.v * dt;
          if (this.free(nx, nz, c.yaw, c.root.position.y, c)) {
            c.x = nx;
            c.z = nz;
          } else c.v = 0;
          this.place(c, dt);
        }
        continue;
      }
      const R = c.route;
      const n = R.pts.length;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      let gap = 99;
      const look = (ox: number, oz: number, r: number) => {
        const dx = ox - c.x, dz = oz - c.z;
        const along = dx * s + dz * co, lat = Math.abs(dx * co - dz * s);
        if (along > 0 && along < 30 && lat < 1.3 + r * 0.4) gap = Math.min(gap, along - c.halfL - r);
      };
      for (const o of this.list) if (o !== c) look(o.x, o.z, o.halfL);
      if (walker) look(walker.x, walker.z, 0.6);
      for (const w of this.walkers) look(w.x, w.z, 0.5);
      const i = Math.floor(c.s) % n;
      let vlim = c.cruise;
      for (let k = 0; k < 18; k += 3) vlim = Math.min(vlim, R.vmax[(i + k) % n]);
      const want = gap < 1.5 ? 0 : Math.min(vlim, (gap - 1.5) * 0.9);
      c.v += THREE.MathUtils.clamp(want - c.v, -8 * dt, 2.6 * dt);
      c.v = Math.max(0, c.v);
      c.s += c.v * dt;
      if (!R.loop && c.s >= n - 1) c.s = 0;
      const j = Math.floor(c.s) % n, f = c.s - Math.floor(c.s);
      const a = R.pts[j], b = R.pts[(j + 1) % n];
      c.x = a.x + (b.x - a.x) * f;
      c.z = a.y + (b.y - a.y) * f;
      let dy = R.head[j] - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.steer = THREE.MathUtils.clamp(dy * 3, -0.6, 0.6);
      c.yaw += dy * Math.min(1, dt * 6);
      // far away: move, but don't animate the driver
      this.place(c, dt);
    }
  }
}

// ---------------------------------------------------------------- routes and streets
function blockLoop(): THREE.Vector2[] {
  // three coords (x, z = -blender y): Ocean Dr northbound x -1.1, 8th at z -68.2, Collins x -104, 7th at z 69
  const P = (x: number, z: number) => new THREE.Vector2(x, z);
  const corners = [P(LANE_X, 69), P(LANE_X, -68.2), P(-104, -68.2), P(-104, 69)];
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[(i + 3) % 4], b = corners[i], c = corners[(i + 1) % 4];
    const p0 = b.clone().add(a.clone().sub(b).normalize().multiplyScalar(6));
    const p2 = b.clone().add(c.clone().sub(b).normalize().multiplyScalar(6));
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      out.push(new THREE.Vector2((1 - t) ** 2 * p0.x + 2 * (1 - t) * t * b.x + t * t * p2.x, (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * b.y + t * t * p2.y));
    }
  }
  return out;
}

function makeRoute(poly: THREE.Vector2[], loop: boolean): Route {
  const pts: THREE.Vector2[] = [];
  const segs = loop ? poly.length : poly.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.round(a.distanceTo(b)));
    for (let k = 0; k < n; k++) pts.push(a.clone().lerp(b, k / n));
  }
  if (!loop) pts.push(poly[poly.length - 1].clone());
  const N = pts.length;
  const head = pts.map((p, i) => {
    if (!loop && i === N - 1) return Math.atan2(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    const q = pts[(i + 1) % N];
    return Math.atan2(q.x - p.x, q.y - p.y);
  });
  const vmax = head.map((h, i) => {
    const h2 = head[loop ? (i + 6) % N : Math.min(N - 1, i + 6)];
    const turn = Math.abs(Math.atan2(Math.sin(h2 - h), Math.cos(h2 - h)));
    return turn > 0.3 ? 4.5 : turn > 0.1 ? 7 : 99;
  });
  return { pts, head, vmax, loop };
}

/** where a car may be outside the walk heightmap: the streets of the grid */
function onStreet(x: number, z: number): boolean {
  const y = -z;
  if (x > -6.4 && x < 5.9 && z < 330 && z > -410) return true;
  if (x > -114.4 && x < -100.4) return true;
  for (const [a, b] of [[-73.5, -64.5], [63.7, 72.7]]) if (y > a && y < b && x > -115 && x < 6) return true;
  return false;
}

function pick<T>(a: T[], r: () => number): T {
  return a[Math.floor(r() * a.length) % a.length];
}

let aoTex: THREE.CanvasTexture | null = null;
function shadowPlane(L: number, W: number): THREE.Mesh {
  if (!aoTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.85)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.5)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    aoTex = new THREE.CanvasTexture(c);
  }
  const geo = new THREE.PlaneGeometry(W, L);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, opacity: 0.75, toneMapped: false }));
  m.position.y = 0.015;
  m.renderOrder = 1;
  m.userData.noShadow = true;
  return m;
}

/** merge a model's meshes by material (the named sub-trees, the wheels, each on its own); the cabin simplified */
function mergeModel(model: THREE.Object3D, keep: string[]): THREE.Object3D {
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
      if (g0) grp.add(new THREE.Mesh(mat.name === 'cabin' ? simplify(g0, 0.15) : g0, mat));
    }
    return grp;
  };
  const wheels = keep.map((n) => model.getObjectByName(n)).filter((w): w is THREE.Object3D => !!w);
  out.add(collect(model, new Set(wheels), inv));
  for (const w of wheels) {
    const wInv = new THREE.Matrix4().copy(w.matrixWorld).invert();
    const g = collect(w, new Set(), wInv);
    g.name = w.name;
    g.matrix.multiplyMatrices(inv, w.matrixWorld);
    g.matrix.decompose(g.position, g.quaternion, g.scale);
    out.add(g);
  }
  return out;
}

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
