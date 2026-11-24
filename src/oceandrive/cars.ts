import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { buildCar, carWheel, liveryTexture } from './vehicles/carmodel.ts';
import { MODELS, PAINTS, SPORT_PAINT, type ModelId } from './vehicles/specs.ts';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Env } from './env.ts';
import { U } from './materials.ts';
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
  // ---- the body
  vx: number; // world velocity
  vz: number;
  w: number; // yaw rate
  y: number; // ride height (sprung)
  vy: number;
  pitch: number;
  roll: number;
  aF: number; // last forward / lateral acceleration (body sway)
  aL: number;
  mass: number;
  tw: number; // half track
  top: number;
  acc: number;
  /** a traffic car knocked off its route remembers it, and rejoins once it's stopped near it */
  routeMem: Route | null;
  rest: number;
  // ---- damage
  hp: number;
  /** burnt out */
  wreck: boolean;
  /** seconds on fire (it goes up at 6) */
  burnT: number;
  // ---- police
  police: boolean;
  /** a driver at the wheel steering for (tx, tz): the police, chasing */
  ai: { tx: number; tz: number; stop: number; ram: boolean; stuck: number; rev: number; on: boolean } | null;
  lightbar: THREE.MeshBasicMaterial[];
  siren: boolean;
  /** who else is in it (the passenger seat), shown seated */
  crew: Person[];
  /** you did it (the damage that put it on fire) */
  blame: boolean;
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
  private nightSet = false;

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
      ['ferrari', 7], ['van', 4], ['taxi', moving ? 7 : 3], ['police', moving ? 0 : 1], ['policeSuv', moving ? 0 : 1], ['cyber', 2],
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
    const spec = kind === 'ferrari' ? null : MODELS[kind as ModelId];
    const fast = kind === 'super' || kind === 'ferrari' || kind === 'coupe' || kind === 'muscle';
    const car: Car = {
      root, wheels, lamps, halfL, halfW, wb, wheelR, x: 0, z: 0, yaw: Math.PI, v: 0, steer: 0, spin: 0, route: null, s: 0, cruise: 0, driver: null, seat, kind,
      vx: 0, vz: 0, w: 0, y: 0, vy: 0, pitch: 0, roll: 0, aF: 0, aL: 0,
      mass: spec ? spec.mass : 1480, tw: (spec ? spec.W : 1.95) / 2 - 0.15, top: kind === 'van' || kind === 'pickup' ? 40 : fast ? 72 : 52,
      acc: spec ? Math.min(13, 1.5 + spec.power / spec.mass / 22) : 12, routeMem: null, rest: 0,
      hp: 100, wreck: false, burnT: 0, police: kind === 'police' || kind === 'policeSuv', ai: null, lightbar: [], siren: false, crew: [], blame: false,
    };
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

  /** more traffic loops (downtown's, over the bridge): three x, z; a car every ~110 m of loop */
  addRoutes(loops: THREE.Vector2[][]) {
    for (const poly of loops) {
      const R = makeRoute(poly, true);
      this.routes.push(R);
      const n = Math.max(1, Math.round(R.pts.length / 110));
      for (let i = 0; i < n; i++) this.addTraffic(R, ((i + this.rnd() * 0.5) / n) * R.pts.length);
    }
    for (const c of this.list) if (c.route && loops.length) this.place(c, 0);
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

  /**
   * Ride: the ground under each wheel gives the car its height, pitch and roll, through a spring
   * (curbs bump it, it settles); the body leans against the acceleration (nose dips braking, squats
   * accelerating, rolls out of a turn).
   */
  private place(c: Car, dt: number) {
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    const hl = c.wb / 2, hw = c.tw;
    const gh = (lx: number, lz: number) => this.groundAt(c.x + lx * co + lz * s, c.z - lx * s + lz * co);
    const fl = gh(hw, hl), fr = gh(-hw, hl), rl = gh(hw, -hl), rr = gh(-hw, -hl);
    const ty = (fl + fr + rl + rr) / 4;
    const tp = Math.atan2((rl + rr - fl - fr) / 2, c.wb);
    const tr = Math.atan2((fl + rl - fr - rr) / 2, 2 * hw);
    if (dt <= 0) {
      c.y = ty;
      c.vy = 0;
      c.pitch = tp;
      c.roll = tr;
    } else {
      c.vy += ((ty - c.y) * 90 - c.vy * 13) * dt;
      c.y += c.vy * dt;
      if (c.y < ty - 0.04) {
        c.y = ty - 0.04;
        c.vy = Math.max(0, c.vy);
      }
      const sp = THREE.MathUtils.clamp(-c.aF * 0.0065, -0.06, 0.06);
      const sr = THREE.MathUtils.clamp(c.aL * 0.009, -0.07, 0.07);
      const k = Math.min(1, dt * 9);
      c.pitch += (tp + sp - c.pitch) * k;
      c.roll += (tr + sr - c.roll) * k;
    }
    c.root.position.set(c.x, c.y, c.z);
    c.root.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ');
    const vF = c.vx * s + c.vz * co;
    c.spin += (vF * dt) / c.wheelR;
    const sx = c.kind === 'ferrari' ? this.ferrariFwd : 1;
    c.wheels.forEach((w, i) => w.rotation.set(c.spin * sx, i < 2 ? c.steer * 0.7 : 0, 0, 'YXZ'));
    if (c.driver && dt > 0) c.driver.update(dt);
  }

  /** road height; off every map the streets stay drivable at 0 */
  private groundAt(x: number, z: number): number {
    const h = this.ground.height(x, z);
    return Number.isNaN(h) ? 0 : h;
  }

  /** what the tyres are on: grip, rolling drag, and how deep the water is */
  private surface(x: number, z: number, y: number): { grip: number; roll: number; water: number } {
    const water = Math.max(0, U.uSea.value - y);
    const wet = U.uWet.value;
    if (x > 132) return { grip: 0.45, roll: 3.2, water }; // the beach: soft sand
    if (x > 11 && x < 100 && z > -95 && z < 95) return { grip: 0.6, roll: 1.6, water }; // the park's lawn
    return { grip: 1 - 0.28 * wet, roll: 0.25, water };
  }

  /**
   * The world around a car's footprint at (x, z, yaw): blocked (walls, posts, the porches, anything
   * higher than a curb above the car's floor) — and if so, the push-out direction.
   */
  private wallHit(c: Car, x: number, z: number, yaw: number): { nx: number; nz: number } | null {
    const s = Math.sin(yaw), co = Math.cos(yaw);
    const L = c.halfL - 0.08, W = c.halfW - 0.08;
    let nx = 0, nz = 0, n = 0;
    const base = c.y;
    for (const [lx, lz] of [[W, L], [-W, L], [W, -L], [-W, -L], [0, L], [0, -L], [W, 0], [-W, 0], [W, L * 0.5], [-W, L * 0.5], [W, -L * 0.5], [-W, -L * 0.5]]) {
      const px = x + lx * co + lz * s, pz = z - lx * s + lz * co;
      const h = this.ground.height(px, pz);
      const bad = Number.isNaN(h) ? !onStreet(px, pz) : this.ground.blocked(px, pz) || h - base > 0.32;
      if (bad) {
        nx += x - px;
        nz += z - pz;
        n++;
      }
    }
    if (!n) return null;
    const l = Math.hypot(nx, nz) || 1;
    return { nx: nx / l, nz: nz / l };
  }

  /** move a free body by its velocity, bouncing off what it hits */
  private moveBody(c: Car, dt: number) {
    const nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
    const hit = this.wallHit(c, nx, nz, c.yaw);
    if (!hit) {
      c.x = nx;
      c.z = nz;
      return;
    }
    // already stuck where it is (spawned in, shoved in): let it move out
    if (this.wallHit(c, c.x, c.z, c.yaw)) {
      c.x = nx + hit.nx * 0.02;
      c.z = nz + hit.nz * 0.02;
      return;
    }
    const vn = c.vx * hit.nx + c.vz * hit.nz;
    if (vn < 0) {
      const e = 0.22;
      c.vx -= (1 + e) * vn * hit.nx;
      c.vz -= (1 + e) * vn * hit.nz;
      // scrape: friction along the wall, and the car twists off it
      c.vx *= 0.8;
      c.vz *= 0.8;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      c.w = c.w * 0.4 + (fx * hit.nz - fz * hit.nx) * vn * 0.12;
      if (-vn > 3) this.crash(-vn, c);
    }
    const sx = c.x + c.vx * dt, sz = c.z + c.vz * dt;
    if (!this.wallHit(c, sx, sz, c.yaw)) {
      c.x = sx;
      c.z = sz;
    }
  }

  /**
   * One step of a car under power: engine and brakes along the car, tyres holding it sideways up to
   * their grip (past it, it slides: the handbrake breaks the rear loose), yaw following the steering
   * where the tyres grip, aero and rolling drag; the surface sets grip and drag; deep water drowns it.
   */
  private stepBody(c: Car, dt: number, thr: number, brk: number, steerIn: number, hand: boolean) {
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    let vF = c.vx * s + c.vz * co;
    let vL = c.vx * co - c.vz * s;
    const sf = this.surface(c.x, c.z, c.y);
    const drown = THREE.MathUtils.clamp((sf.water - 0.25) / 0.6, 0, 1);
    const g = sf.grip;
    let aF = 0;
    if (thr > 0) aF += vF < -0.3 ? 15 * thr : c.acc * thr * Math.max(0, 1 - vF / c.top) * Math.min(1, 0.45 + g) * (1 - drown);
    if (brk > 0) aF -= vF > 0.3 ? 15 * brk * g : vF > -9 ? 5 * brk * (1 - drown) : 0;
    if (hand && Math.abs(vF) > 0.1) aF -= Math.sign(vF) * 7 * g;
    aF -= vF * Math.abs(vF) * 0.0032 + vF * (0.04 + drown * 2.5) + Math.sign(vF) * sf.roll;
    const vF0 = vF;
    vF += aF * dt;
    // the drags never push it backwards
    if (thr === 0 && brk === 0 && Math.sign(vF) !== Math.sign(vF0)) vF = 0;
    if (thr === 0 && brk === 0 && Math.abs(vF) < 0.15) vF = 0;
    // steering: less lock at speed
    const lock = 0.62 / (1 + Math.abs(vF) * 0.045);
    c.steer += (steerIn * lock - c.steer) * Math.min(1, dt * 7);
    const wT = (vF * Math.tan(c.steer)) / c.wb;
    const k = hand ? 2.2 : 10 * g;
    c.w += (wT - c.w) * Math.min(1, dt * k);
    // sideways: the tyres take out slip up to their grip (much less with the handbrake on)
    const grip = (hand ? 3.5 : 15) * g;
    const dL = THREE.MathUtils.clamp(-vL, -grip * dt, grip * dt);
    vL += dL;
    c.aF = (vF - vF0) / Math.max(dt, 1e-4);
    c.aL = vF * c.w;
    c.yaw += c.w * dt;
    const s2 = Math.sin(c.yaw), c2 = Math.cos(c.yaw);
    c.vx = s2 * vF + c2 * vL;
    c.vz = c2 * vF - s2 * vL;
    c.v = vF;
    this.moveBody(c, dt);
  }

  /** a car nobody drives: parked (handbrake on), or knocked loose (its driver brakes) */
  private coast(c: Car, dt: number) {
    const sp = Math.hypot(c.vx, c.vz);
    if (sp < 0.02 && Math.abs(c.w) < 0.01) {
      c.vx = c.vz = c.w = 0;
      c.aF *= 0.8;
      c.aL *= 0.8;
      this.place(c, dt);
      return;
    }
    this.stepBody(c, dt, 0, c.driver ? 1 : 0.6, 0, true);
    c.w *= 1 - Math.min(1, dt * 1.5);
    this.place(c, dt);
  }

  /** car against car: separate them by their masses and trade momentum (with a twist from where they touched) */
  private collide() {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (a.route && b.route) continue; // traffic keeps its own distance
        const dx0 = a.x - b.x, dz0 = a.z - b.z;
        if (dx0 * dx0 + dz0 * dz0 > 64) continue;
        const sa = Math.hypot(a.vx, a.vz) + Math.abs(a.w), sb = Math.hypot(b.vx, b.vz) + Math.abs(b.w);
        if (sa < 0.01 && sb < 0.01) continue;
        // three circles along each car: the deepest overlap
        let best = 0, bx = 0, bz = 0, cx = 0, cz = 0;
        const ra = a.halfW, rb = b.halfW;
        const oa = a.halfL - ra, ob = b.halfL - rb;
        for (const p of [-oa, 0, oa]) {
          const ax = a.x + Math.sin(a.yaw) * p, az = a.z + Math.cos(a.yaw) * p;
          for (const q of [-ob, 0, ob]) {
            const qx = b.x + Math.sin(b.yaw) * q, qz = b.z + Math.cos(b.yaw) * q;
            const d = Math.hypot(ax - qx, az - qz);
            const pen = ra + rb - d;
            if (pen > best) {
              best = pen;
              bx = (ax - qx) / (d || 1);
              bz = (az - qz) / (d || 1);
              cx = (ax + qx) / 2;
              cz = (az + qz) / 2;
            }
          }
        }
        if (best <= 0) continue;
        // traffic hit by something loose stops being traffic until it's stopped again
        for (const c of [a, b]) if (c.route) this.knockLoose(c);
        const ma = a.mass, mb = b.mass;
        a.x += bx * best * (mb / (ma + mb));
        a.z += bz * best * (mb / (ma + mb));
        b.x -= bx * best * (ma / (ma + mb));
        b.z -= bz * best * (ma / (ma + mb));
        const vr = (a.vx - b.vx) * bx + (a.vz - b.vz) * bz;
        if (vr >= 0) continue;
        const e = 0.18;
        const J = (-(1 + e) * vr) / (1 / ma + 1 / mb);
        a.vx += (J / ma) * bx;
        a.vz += (J / ma) * bz;
        b.vx -= (J / mb) * bx;
        b.vz -= (J / mb) * bz;
        // a twist from the off-centre hit
        const Ia = (ma * (4 * a.halfL * a.halfL + 4 * a.halfW * a.halfW)) / 12, Ib = (mb * (4 * b.halfL * b.halfL + 4 * b.halfW * b.halfW)) / 12;
        const rax = cx - a.x, raz = cz - a.z, rbx = cx - b.x, rbz = cz - b.z;
        a.w += (raz * J * bx - rax * J * bz) / Ia;
        b.w -= (rbz * J * bx - rbx * J * bz) / Ib;
        if (-vr > 2) this.crash(-vr, a === this.driven ? a : b);
        // dents: a hard enough hit takes its toll on both
        if (-vr > 3) {
          const you = a === this.driven || b === this.driven;
          // (the AI's scrapes with parked cars shouldn't burn the street down)
          const k = you ? 2 : 0.6;
          this.damage(a, (-vr - 3) * 2.2 * (mb / (ma + mb)) * k, you);
          this.damage(b, (-vr - 3) * 2.2 * (ma / (ma + mb)) * k, you);
        }
        // you hit someone's car: they'll have something to say
        if (-vr > 1.2) {
          if (a === this.driven && b.driver) this.onBump?.(b, -vr);
          if (b === this.driven && a.driver) this.onBump?.(a, -vr);
          if (a === this.driven || b === this.driven) this.onHitCar?.(a === this.driven ? b : a, -vr);
        }
      }
    }
  }

  /** your car struck one with a driver in it (speed of the impact) */
  onBump: ((c: Car, speed: number) => void) | null = null;
  /** your car struck any car */
  onHitCar: ((c: Car, speed: number) => void) | null = null;
  /** you pulled someone out (the person, and the door they land at) */
  onJack: ((c: Car, p: Person, x: number, z: number, yaw: number) => void) | null = null;
  /** a car went up */
  onExplode: ((c: Car) => void) | null = null;

  /** damage a car (bullets, crashes): it smokes below a third, burns below a tenth, and goes up */
  damage(c: Car, amt: number, byYou: boolean) {
    if (c.wreck || amt <= 0) return;
    c.hp -= amt;
    if (byYou) c.blame = true;
    if (c.hp <= 0 && c.burnT === 0) c.burnT = 0.01;
  }

  /** the burnt shell: black, glassless, dark, dead */
  private wreckIt(c: Car) {
    c.wreck = true;
    c.hp = 0;
    c.siren = false;
    c.ai = null;
    c.route = null;
    c.routeMem = null;
    if (c.driver) {
      c.root.remove(c.driver.root);
      c.driver = null;
    }
    for (const p of c.crew) p.root.removeFromParent();
    c.crew.length = 0;
    c.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshPhysicalMaterial;
      if (mat === this.glass) {
        m.visible = false;
        return;
      }
      if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      const burnt = mat.clone();
      burnt.color = new THREE.Color(0.035, 0.032, 0.03);
      burnt.roughness = 0.95;
      burnt.metalness = 0.2;
      if ((burnt as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) (burnt as THREE.MeshPhysicalMaterial).clearcoat = 0;
      burnt.emissiveIntensity = 0;
      burnt.map = null;
      m.material = burnt;
    });
    for (const l of c.lightbar) l.color.setScalar(0.02);
    // thrown up by the blast
    c.vy = 5;
    c.w += (Math.random() - 0.5) * 2;
    this.onExplode?.(c);
  }

  /** a wreck smokes and burns: (x, y, z) of the bonnet, how badly; called by main for the effects */
  hurtCars(): { c: Car; p: THREE.Vector3; fire: boolean }[] {
    const out: { c: Car; p: THREE.Vector3; fire: boolean }[] = [];
    for (const c of this.list) {
      if (c.hp > 35 && !c.wreck) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      out.push({ c, p: new THREE.Vector3(c.x + s * c.halfL * 0.62, c.y + 1.0, c.z + co * c.halfL * 0.62), fire: c.burnT > 0 || (c.wreck && c.burnT < 40) });
    }
    return out;
  }

  private knockLoose(c: Car) {
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    c.vx = s * c.v;
    c.vz = co * c.v;
    c.routeMem = c.route;
    c.route = null;
    c.rest = 0;
  }

  /** the traffic signals: how far ahead a car must stop for a red (dressing.ts) */
  stopFor: ((x: number, z: number, yaw: number) => number) | null = null;

  /** cars parked along the curbs of the side streets (three x, z, heading) */
  park(spots: [number, number, number][]) {
    for (const [x, z, yaw] of spots) {
      if (this.rnd() < 0.28) continue;
      const c = this.make(this.pickKind(false), false);
      c.x = x + (this.rnd() - 0.5) * 0.2;
      c.z = z;
      c.yaw = yaw + (this.rnd() - 0.5) * 0.04;
      this.place(c, 0);
    }
  }

  /** a crash (for the sound): impact speed, and the car */
  onCrash: ((speed: number) => void) | null = null;
  private crashT = 0;
  private crash(speed: number, _c: Car) {
    if (performance.now() - this.crashT < 250) return;
    this.crashT = performance.now();
    this.onCrash?.(speed);
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

  /** a moving car hitting a person at (x, z): its velocity (for the knock), or null */
  strike(x: number, z: number, r = 0.35): { vx: number; vz: number; car: Car } | null {
    for (const c of this.list) {
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 1.6) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 25) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      const lz = dx * s + dz * co, lx = dx * co - dz * s;
      if (Math.abs(lx) < c.halfW + r && Math.abs(lz) < c.halfL + r) return { vx: c.vx, vz: c.vz, car: c };
    }
    return null;
  }

  /** if a point (radius r) is inside a car's footprint: the shortest way out */
  pushOut(x: number, z: number, r: number): { x: number; z: number } | null {
    for (const c of this.list) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 16) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      const lz = dx * s + dz * co, lx = dx * co - dz * s;
      const ox = c.halfW + r - Math.abs(lx), oz = c.halfL + r - Math.abs(lz);
      if (ox <= 0 || oz <= 0) continue;
      // out the nearer side (local), back to world
      const px = ox < oz ? Math.sign(lx || 1) * ox : 0, pz = ox < oz ? 0 : Math.sign(lz || 1) * oz;
      return { x: px * co + pz * s, z: -px * s + pz * co };
    }
    return null;
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

  enter(c: Car, camera: THREE.Camera) {
    if (c.wreck) return false;
    if (c.driver) {
      const p = c.driver;
      c.driver = null;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      this.scene.attach(p.root);
      this.onJack?.(c, p, c.x + co * (c.halfW + 0.9), c.z - s * (c.halfW + 0.9), c.yaw);
      if (!p.root.parent) p.root.removeFromParent();
    }
    for (const q of c.crew) {
      q.root.removeFromParent();
    }
    c.crew.length = 0;
    c.ai = null;
    c.siren = false;
    if (c.route) this.knockLoose(c);
    c.routeMem = null;
    this.driven = c;
    this.exitWanted = false;
    this.camYawOff = 0;
    // the chase camera starts where the walking camera was
    this.camPos.copy(camera.position);
    return true;
  }

  /** the car you're in (or null) */
  get yours(): Car | null {
    return this.driven;
  }

  /** a driver gets out where you can see them (their car stays where it stopped): the person and the door */
  ejectDriver(c: Car): { p: Person; x: number; z: number; yaw: number } | null {
    if (!c.driver || c === this.driven) return null;
    const p = c.driver;
    c.driver = null;
    if (c.route) this.knockLoose(c);
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    this.scene.attach(p.root);
    return { p, x: c.x + co * (c.halfW + 0.6), z: c.z - s * (c.halfW + 0.6), yaw: c.yaw - Math.PI / 2 };
  }

  /** back behind the wheel (they'll rejoin the traffic once stopped near it) */
  reseat(c: Car, p: Person): boolean {
    if (c.wreck || c.driver || c === this.driven) return false;
    c.driver = p;
    c.root.add(p.root);
    p.root.position.copy(c.seat).add(new THREE.Vector3(0, -0.42, 0));
    p.root.rotation.set(0, 0, 0);
    p.play('sit', { fade: 0.2 });
    c.rest = 0;
    return true;
  }

  /** a car for the police: a seated officer at the wheel and one beside, lights on the roof */
  spawnUnit(kind: string, x: number, z: number, yaw: number, driver: Person, mate: Person | null): Car {
    const c = this.make(kind, false);
    c.x = x;
    c.z = z;
    c.yaw = yaw;
    c.police = true;
    c.top = 62;
    c.acc = Math.max(c.acc, 9);
    this.reseat(c, driver);
    if (mate) {
      c.root.add(mate.root);
      mate.root.position.set(-c.seat.x, c.seat.y - 0.42, c.seat.z);
      mate.play('sit', { fade: 0 });
      c.crew.push(mate);
    }
    // the light bar (the SWAT van gets a pair of strobes in the grille instead)
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.01, 0.01), toneMapped: false });
    const blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.01, 0.02, 0.2), toneMapped: false });
    const spec = MODELS[kind as ModelId];
    const top = spec ? spec.H + 0.04 : 1.5;
    const bar = new THREE.Group();
    const bg = new THREE.BoxGeometry(0.52, 0.09, 0.22);
    const l = new THREE.Mesh(bg, red), r = new THREE.Mesh(bg, blue);
    l.position.set(0.28, 0, 0);
    r.position.set(-0.28, 0, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.26), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }));
    base.position.y = -0.05;
    bar.add(l, r, base);
    bar.position.set(0, top, -0.1);
    c.root.add(bar);
    c.lightbar = [red, blue];
    c.ai = { tx: x, tz: z, stop: 6, ram: false, stuck: 0, rev: 0, on: true };
    this.place(c, 0);
    this.env.prepObject(c.root, true, true);
    return c;
  }

  /** take a car away for good */
  remove(c: Car) {
    c.root.removeFromParent();
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
  }

  /**
   * A driver steering for (tx, tz): full throttle on the straight, lifting for the turn, braking to
   * stop `stop` metres short (or not at all when ramming); stuck against something, it backs out.
   */
  private aiDrive(c: Car, dt: number) {
    const A = c.ai!;
    const dx = A.tx - c.x, dz = A.tz - c.z;
    const dist = Math.hypot(dx, dz);
    let ang = Math.atan2(dx, dz) - c.yaw;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const vF = c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);
    let thr = 0, brk = 0, steer = THREE.MathUtils.clamp(ang * 2.2, -1, 1);
    if (A.rev > 0) {
      A.rev -= dt;
      thr = 0;
      brk = 1;
      steer = -steer;
      if (vF > 0.5) brk = 1;
    } else if (!A.on || (!A.ram && dist < A.stop)) {
      brk = vF > 0.2 ? 1 : 0;
    } else {
      // slow for a sharp turn, and for the stop
      const turn = Math.abs(ang);
      const vmax = A.ram ? 40 : Math.min(40, 6 + (dist - A.stop) * 0.9);
      const want = turn > 1.4 ? 5 : turn > 0.7 ? 9 : vmax;
      if (turn > 2.2 && dist < 25) {
        // it's behind: back round
        A.rev = 1.2;
      }
      if (vF < want) thr = 1;
      else brk = Math.min(1, (vF - want) * 0.3);
      // wedged: throttle on, going nowhere
      A.stuck = Math.hypot(c.vx, c.vz) < 0.8 && thr > 0 ? A.stuck + dt : 0;
      if (A.stuck > 1.4) {
        A.stuck = 0;
        A.rev = 1.3;
      }
    }
    const n = Math.max(1, Math.ceil(dt / 0.01));
    for (let i = 0; i < n; i++) this.stepBody(c, dt / n, thr, brk, steer, false);
    this.place(c, dt);
  }

  private exitWanted = false;
  /** F while driving: brake to a stop, then get out */
  requestExit() {
    if (this.driven) this.exitWanted = true;
  }

  /** when the car has stopped after requestExit(): where you step out (by the driver's door), or null */
  takeExit(clear: (x: number, z: number, y: number) => boolean): { x: number; z: number; yaw: number } | null {
    const c = this.driven;
    if (!c || !this.exitWanted || Math.hypot(c.vx, c.vz) > 1.2) return null;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    const spots: [number, number][] = [
      [c.halfW + 0.55, 0.3], [-(c.halfW + 0.55), 0.3], [c.halfW + 0.55, -0.8], [-(c.halfW + 0.55), -0.8], [0, -(c.halfL + 0.7)], [0, c.halfL + 0.7],
      [c.halfW + 1.2, 0.3], [-(c.halfW + 1.2), 0.3],
    ];
    for (const [lx, lz] of spots) {
      const x = c.x + lx * co + lz * s, z = c.z - lx * s + lz * co;
      if (clear(x, z, c.y)) return this.leave(c, x, z);
    }
    // nowhere clear: out the top (rare: boxed in) — on the driver's side anyway
    return this.leave(c, c.x + (c.halfW + 0.6) * co, c.z - (c.halfW + 0.6) * s);
  }

  /** out now, wherever the car is (it's burning, or you're dead) */
  takeExitNow(): { x: number; z: number; yaw: number } | null {
    const c = this.driven;
    if (!c) return null;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    const x = c.x + co * (c.halfW + 0.8), z = c.z - s * (c.halfW + 0.8);
    this.driven = null;
    this.exitWanted = false;
    return { x, z, yaw: c.yaw };
  }

  private leave(c: Car, x: number, z: number) {
    c.vx = c.vz = c.w = c.v = 0;
    c.steer = 0;
    this.driven = null;
    this.exitWanted = false;
    return { x, z, yaw: c.yaw };
  }

  playerPos(): THREE.Vector3 {
    const c = this.driven;
    return c ? this.tmp.set(c.x, c.y, c.z) : this.tmp.set(0, 0, 0);
  }

  speedKmh(): number {
    return this.driven ? Math.hypot(this.driven.vx, this.driven.vz) * 3.6 : 0;
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

  /** pools of light ahead of every moving car (and yours) with its lights on */
  headlights(out: THREE.Vector4[]) {
    if (!this.lightsOn) return;
    for (const c of this.list) {
      if (!c.route && c !== this.driven && !c.driver) continue;
      const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
      out.push(new THREE.Vector4(c.x + s * (c.halfL + 4.5), c.y + 0.9, c.z + co * (c.halfL + 4.5), 45));
    }
  }

  private lightsOn = false;
  setNight(n: number) {
    if (this.lightsOn === n > 0 && this.nightSet) return;
    this.nightSet = true;
    this.lightsOn = n > 0;
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
    const mv = c.wreck ? { x: 0, y: 0 } : inp.move();
    const sF = c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);
    let thr = Math.max(0, mv.y), brk = Math.max(0, -mv.y), hand = inp.down('Space');
    // S while rolling forward brakes; held at a stop it reverses (stepBody sorts which)
    if (this.exitWanted) {
      thr = 0;
      brk = sF > 0.3 ? 1 : 0;
      hand = true;
    }
    // brake lights
    const [, tl] = c.lamps;
    if (tl) tl.emissiveIntensity = (this.lightsOn ? 3.6 : 0.6) + (brk > 0 && sF > 0.3 ? 6 : 0);
    // physics in small steps (stable at any frame rate)
    const n = Math.max(1, Math.ceil(dt / 0.008));
    for (let i = 0; i < n; i++) this.stepBody(c, dt / n, thr, brk, -mv.x, hand);
    this.place(c, dt);
    this.camYawOff = THREE.MathUtils.clamp(this.camYawOff - inp.mdx * 0.003, -2.5, 2.5);
    if (inp.mdx === 0) this.camYawOff *= 1 - Math.min(1, dt * 0.8);
    const sp = Math.hypot(c.vx, c.vz);
    // the camera trails the direction of travel (it swings out in a slide), and pulls back with speed
    const travel = sp > 2 ? Math.atan2(c.vx, c.vz) : c.yaw;
    let dy = travel - c.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const back = c.halfL + 4.2 + sp * 0.035;
    const yaw = c.yaw + dy * 0.5 * (sF > 0 ? 1 : 0) + this.camYawOff;
    const want = this.tmp.set(c.x - Math.sin(yaw) * back, c.y + 1.6 + c.halfW * 0.5, c.z - Math.cos(yaw) * back);
    const gh = this.groundAt(want.x, want.z);
    if (want.y < gh + 0.6) want.y = gh + 0.6;
    this.camPos.lerp(want, Math.min(1, dt * 5));
    camera.position.copy(this.camPos);
    this.camLook.set(c.x + Math.sin(c.yaw) * 2.5, c.y + 1.0, c.z + Math.cos(c.yaw) * 2.5);
    camera.lookAt(this.camLook);
  }

  private flash = 0;
  update(dt: number, walker: THREE.Vector3 | null, eye: THREE.Vector3) {
    this.flash += dt;
    for (const c of this.list) {
      // a car half a mile off is a speck: don't draw it
      c.root.visible = (c.x - eye.x) ** 2 + (c.z - eye.z) ** 2 < 650 * 650 || c === this.driven;
      // burning: it goes up after a few seconds
      if (c.burnT > 0 && !c.wreck) {
        c.burnT += dt;
        if (c.burnT > 5.5) this.wreckIt(c);
      } else if (c.wreck) c.burnT += dt;
      if (c.lightbar.length) {
        const on = c.siren && !c.wreck;
        const ph = Math.floor(this.flash * 7) % 4;
        c.lightbar[0].color.setRGB(on && ph < 2 ? 30 : 0.2, on && ph < 2 ? 0.6 : 0.01, on && ph < 2 ? 0.4 : 0.01);
        c.lightbar[1].color.setRGB(on && ph >= 2 ? 0.4 : 0.01, on && ph >= 2 ? 1.2 : 0.02, on && ph >= 2 ? 30 : 0.2);
      }
      if (c === this.driven) continue;
      if (c.ai && c.driver && !c.wreck) {
        this.aiDrive(c, dt);
        continue;
      }
      if (!c.route) {
        // loose: parked, abandoned, or knocked off its route
        const n = Math.max(1, Math.ceil(dt / 0.012));
        for (let i = 0; i < n; i++) this.coast(c, dt / n);
        // a driver gets going again once stopped near the route
        if (c.routeMem && c.driver) {
          c.rest = Math.hypot(c.vx, c.vz) < 0.2 ? c.rest + dt : 0;
          if (c.rest > 2.5) this.rejoin(c);
          // wedged at an angle it can't drive out of: once nobody's looking, it's towed back to the route
          if (c.routeMem && c.rest > 8 && Math.hypot(c.x - eye.x, c.z - eye.z) > 45) this.tow(c, eye);
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
      // red lights
      if (this.stopFor) {
        const d = this.stopFor(c.x, c.z, c.yaw);
        if (d < Infinity) gap = Math.min(gap, d - c.halfL + 0.8);
      }
      const i = Math.floor(c.s) % n;
      let vlim = c.cruise;
      for (let k = 0; k < 18; k += 3) vlim = Math.min(vlim, R.vmax[(i + k) % n]);
      const want = gap < 1.5 ? 0 : Math.min(vlim, (gap - 1.5) * 0.9);
      const v0 = c.v;
      c.v += THREE.MathUtils.clamp(want - c.v, -8 * dt, 2.6 * dt);
      c.v = Math.max(0, c.v);
      c.aF = (c.v - v0) / Math.max(dt, 1e-4);
      c.s += c.v * dt;
      if (!R.loop && c.s >= n - 1) c.s = 0;
      const j = Math.floor(c.s) % n, f = c.s - Math.floor(c.s);
      const a = R.pts[j], b = R.pts[(j + 1) % n];
      c.x = a.x + (b.x - a.x) * f;
      c.z = a.y + (b.y - a.y) * f;
      let dy = R.head[j] - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.steer = THREE.MathUtils.clamp(dy * 3, -0.6, 0.6);
      const w = dy * Math.min(1, dt * 6);
      c.yaw += w;
      c.w = w / Math.max(dt, 1e-4);
      c.aL = c.v * c.w;
      c.vx = Math.sin(c.yaw) * c.v;
      c.vz = Math.cos(c.yaw) * c.v;
      this.place(c, dt);
    }
    this.collide();
  }

  /** put a stranded traffic car back on its route, somewhere out of view and clear of other cars */
  private tow(c: Car, eye: THREE.Vector3) {
    const R = c.routeMem!;
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(this.rnd() * R.pts.length);
      const p = R.pts[i];
      if (Math.hypot(p.x - eye.x, p.y - eye.z) < 60) continue;
      if (this.list.some((o) => o !== c && Math.hypot(o.x - p.x, o.z - p.y) < 9)) continue;
      c.route = R;
      c.routeMem = null;
      c.s = i;
      c.x = p.x;
      c.z = p.y;
      c.yaw = R.head[i];
      c.vx = c.vz = c.w = c.v = 0;
      c.rest = 0;
      this.place(c, 0);
      return;
    }
  }

  /** back on the route: the nearest point ahead, if it's close and pointing the same way */
  private rejoin(c: Car) {
    const R = c.routeMem!;
    let best = -1, bd = 36;
    for (let i = 0; i < R.pts.length; i++) {
      const d = (R.pts[i].x - c.x) ** 2 + (R.pts[i].y - c.z) ** 2;
      if (d < bd && Math.cos(R.head[i] - c.yaw) > 0.5) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return;
    c.route = R;
    c.routeMem = null;
    c.s = best;
    c.v = 0;
    c.rest = 0;
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
