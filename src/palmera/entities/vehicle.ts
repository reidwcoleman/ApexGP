import * as THREE from 'three';
import { clamp, damp, pick } from '../core/math';
import { WATER_Y, groundAt, groundBase, isWater, type Box, type ColliderGrid } from '../world/map';
import { waveHeight } from '../world/water';
import { SPECS, carMats, carModel, paintMat, type CarSpec, type CarType } from './carModels';
import { alloyWheel, kitModel } from './carKit';

const wheelCache = new Map<string, THREE.BufferGeometry>();
function wheelFor(r: number, wid: number) {
  const k = r.toFixed(3) + ':' + wid;
  let g = wheelCache.get(k);
  if (!g) wheelCache.set(k, (g = alloyWheel(r, wid < 1 ? 0.16 : wid > 1.95 ? 0.3 : 0.25)));
  return g;
}

export interface VehicleInput {
  thr: number; // -1..1
  steer: number; // -1..1 (positive = left)
  hand: boolean;
}

export interface CarAI {
  drive(v: Vehicle, dt: number): void;
}

export interface VehicleEvents {
  onImpact(v: Vehicle, speed: number, x: number, y: number, z: number, other: Vehicle | null): void;
  onSink(v: Vehicle): void;
}

const tmpBoxes: Box[] = [];
let nextId = 1;

// tail-light glows, shared by every car
let glowGeo: THREE.BufferGeometry | null = null;
function lampGlowGeo() {
  if (!glowGeo) glowGeo = new THREE.PlaneGeometry(0.42, 0.26);
  return glowGeo;
}
function glowTex(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const gt = glowTex();
const brakeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.15), map: gt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const blinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.1), map: gt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

export class Vehicle {
  id = nextId++;
  spec: CarSpec;
  type: CarType;
  root = new THREE.Group();
  body: THREE.Mesh;
  wheels: THREE.Mesh[] = [];
  paint: THREE.MeshStandardMaterial;
  color: number;
  pos = new THREE.Vector3();
  heading = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  yawRate = 0;
  steerAngle = 0;
  wheelSpin = 0;
  pitch = 0;
  roll = 0;
  input: VehicleInput = { thr: 0, steer: 0, hand: false };
  health: number;
  wrecked = false;
  burnTimer = 0;
  sinking = 0;
  sunk = false;
  /** who is driving: 'player', 'npc' (ped/cop inside), or null */
  driver: 'player' | 'npc' | null = null;
  ai: CarAI | null = null;
  police = false;
  siren = false;
  /** driving like there's a siren behind it (a getaway car): traffic pulls over for it too */
  urgent = false;
  persistent = false;
  missionTag = '';
  lastPlayerHit = 0;
  airborne = false;
  slip = 0;
  rpm = 0;
  gear = 1;
  despawnable = true;
  occupants = 0; // npc occupants (cops)
  sirenRed: THREE.Mesh | null = null;
  sirenBlue: THREE.Mesh | null = null;
  beam: THREE.Mesh | null = null;
  smokeT = 0;
  stuckT = 0;
  age = 0;

  private sirenPos: THREE.Vector3[] | null = null;
  /** the driver's seat in the car's frame (null: nobody shown) */
  seat: THREE.Vector3 | null = null;
  /** top of the cabin roof in the car frame (kit cars) */
  roofY = 0;
  /** the kit model's tail-lamp spot, for the glows */
  tail: { y: number; x: number; z: number } | null = null;
  /** an airboat's spinning fan */
  fan: THREE.Mesh | null = null;
  vid = Math.floor(Math.random() * 1e9);

  constructor(type: CarType, color?: number) {
    this.type = type;
    this.spec = SPECS[type];
    this.health = this.spec.health;
    this.color = color ?? pick(this.spec.colors);
    this.paint = paintMat(this.color);
    const kitM = kitModel(type, this.spec, Math.floor(Math.random() * 16));
    const model = carModel(type);
    this.body = new THREE.Mesh(kitM ? kitM.geo : model.geo, [this.paint, carMats.detail, carMats.lamps, carMats.glass]);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.root.add(this.body);
    if (kitM) this.seat = kitM.seat;
    if (kitM) this.roofY = kitM.roofY;
    if (kitM) this.tail = kitM.tail;
    // a jet ski's rider sits astride, out in the open
    if (type === 'jetski') this.seat = new THREE.Vector3(0, 0.62, -0.3);
    if (type === 'airboat') {
      this.seat = new THREE.Vector3(0, 1.51, -0.72);
      // the fan: two long blades turning in the cage
      const blades = new THREE.BoxGeometry(1.9, 0.18, 0.04);
      const fan = new THREE.Mesh(blades, new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6 }));
      fan.position.set(0, 1.7, -2.0);
      fan.castShadow = true;
      this.body.add(fan);
      this.fan = fan;
    }
    if (kitM) {
      model.sirenRed && (this.sirenPos = [new THREE.Vector3(-0.3, kitM.roofY + 0.07, -0.25), new THREE.Vector3(0.3, kitM.roofY + 0.07, -0.25)]);
    }
    const wheelGeo = kitM ? wheelFor(kitM.wheelR, this.spec.wid) : model.wheelGeo;
    if (wheelGeo) {
      for (const w of kitM ? kitM.wheels : model.wheels) {
        const m = new THREE.Mesh(wheelGeo, carMats.wheel);
        m.position.copy(w);
        m.castShadow = true;
        this.body.add(m);
        this.wheels.push(m);
      }
    }
    if (model.sirenRed && model.sirenBlue) {
      const g = new THREE.BoxGeometry(0.5, 0.14, 0.26);
      this.sirenRed = new THREE.Mesh(g, carMats.sirenOff);
      this.sirenRed.position.copy(this.sirenPos ? this.sirenPos[0] : model.sirenRed);
      this.sirenBlue = new THREE.Mesh(g, carMats.sirenOffB);
      this.sirenBlue.position.copy(this.sirenPos ? this.sirenPos[1] : model.sirenBlue);
      this.body.add(this.sirenRed, this.sirenBlue);
      this.police = type === 'police';
    }
    this.root.userData.vehicle = this;
  }

  private dented = false;
  /** the body as built, kept while it's dented so a repair can put it back */
  private baseGeo: THREE.BufferGeometry | null = null;

  /** a new colour (the paint materials are shared per colour, so swap rather than recolour) */
  /** garage upgrades: engine 0-3, brakes 0-2, armour 0-2, underglow colour, tinted glass */
  tune = { engine: 0, brakes: 0, armor: 0, neon: null as number | null, tint: false };
  private neonMesh: THREE.Mesh | null = null;

  /** rebuild this car's own stats and looks from its tune */
  applyTune() {
    const t = this.tune;
    const base = SPECS[this.type];
    const was = this.health / this.spec.health;
    this.spec = {
      ...base,
      maxSpeed: base.maxSpeed * (1 + 0.08 * t.engine),
      accel: base.accel * (1 + 0.16 * t.engine),
      brake: base.brake * (1 + 0.22 * t.brakes),
      grip: base.grip * (1 + 0.06 * t.brakes),
      health: base.health * (1 + 0.35 * t.armor),
    };
    this.health = Math.min(this.spec.health, was * this.spec.health);
    const m = this.body.material as THREE.Material[];
    if (Array.isArray(m) && m[3]) m[3] = t.tint ? tintedGlass() : carMats.glass;
    if (t.neon !== null) {
      if (!this.neonMesh) {
        this.neonMesh = new THREE.Mesh(neonGeo, new THREE.MeshBasicMaterial({ map: neonTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        this.neonMesh.renderOrder = 2;
        this.root.add(this.neonMesh);
      }
      this.neonMesh.scale.set(this.spec.wid + 1.1, 1, this.spec.len + 1.2);
      this.neonMesh.position.y = 0.04;
      (this.neonMesh.material as THREE.MeshBasicMaterial).color.setHex(t.neon).multiplyScalar(2.2);
    } else if (this.neonMesh) {
      this.root.remove(this.neonMesh);
      (this.neonMesh.material as THREE.Material).dispose();
      this.neonMesh = null;
    }
  }

  repaint(color: number) {
    this.color = color;
    this.paint = paintMat(color);
    const m = this.body.material as THREE.Material[];
    if (Array.isArray(m)) m[0] = this.paint;
  }

  /** dents out, full health */
  repair() {
    if (this.dented && this.baseGeo) {
      this.body.geometry.dispose();
      this.body.geometry = this.baseGeo;
      this.baseGeo = null;
      this.dented = false;
    }
    this.crumple = 0;
    this.health = this.spec.health;
    this.smokeT = 0;
    this.bumpers = [0, 0];
    this.bumperTris = [null, null];
  }

  /** front and rear bumper: 0 on, 1 hanging off one end, 2 gone */
  bumpers = [0, 0];
  private bumperTris: (number[] | null)[] = [null, null];

  private ensureOwnGeometry() {
    if (!this.dented) {
      this.baseGeo = this.body.geometry;
      this.body.geometry = this.body.geometry.clone();
      this.dented = true;
    }
  }

  /** the triangles of a bumper (end 0 front +z, 1 rear): the low band across the very end */
  private bumperTriangles(end: number): number[] {
    const cached = this.bumperTris[end];
    if (cached) return cached;
    const pos = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const box = this.body.geometry.boundingBox ?? (this.body.geometry.computeBoundingBox(), this.body.geometry.boundingBox!);
    const zEdge = end === 0 ? box.max.z - 0.42 : box.min.z + 0.42;
    const yTop = box.min.y + (box.max.y - box.min.y) * 0.42;
    const out: number[] = [];
    for (let t = 0; t < pos.count / 3; t++) {
      const i = t * 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      if (cy < yTop && (end === 0 ? cz > zEdge : cz < zEdge)) out.push(t);
    }
    this.bumperTris[end] = out;
    return out;
  }

  /** a hard knock on an end: the bumper drops at one corner and hangs */
  sagBumper(end: number, side: number) {
    if (this.isBoat || this.type === 'bike' || this.type === 'airboat' || this.bumpers[end] !== 0) return;
    this.ensureOwnGeometry();
    const tris = this.bumperTriangles(end);
    if (tris.length < 6) return;
    const pos = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const box = this.body.geometry.boundingBox!;
    // pivot at the corner that held on; the other end swings down
    const px = side > 0 ? box.min.x + 0.2 : box.max.x - 0.2;
    const py = box.min.y + (box.max.y - box.min.y) * 0.4;
    const a = 0.22 * (side > 0 ? -1 : 1);
    const c = Math.cos(a), sn = Math.sin(a);
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        const x = pos.getX(i) - px, y = pos.getY(i) - py;
        pos.setXY(i, px + x * c - y * sn, Math.max(box.min.y - 0.05, py + x * sn + y * c));
      }
    pos.needsUpdate = true;
    this.bumpers[end] = 1;
  }

  /** the bumper comes away: its triangles leave the body and come back as a loose piece (local geometry, centred) */
  detachBumper(end: number): { geo: THREE.BufferGeometry; at: THREE.Vector3 } | null {
    if (this.isBoat || this.type === 'bike' || this.type === 'airboat' || this.bumpers[end] === 2) return null;
    this.ensureOwnGeometry();
    const tris = this.bumperTriangles(end);
    if (tris.length < 6) return null;
    const src = this.body.geometry;
    const groups = src.groups;
    const matOf = (vi: number) => {
      for (const gr of groups) if (vi >= gr.start && vi < gr.start + gr.count) return gr.materialIndex ?? 0;
      return 0;
    };
    const order = tris.map((t) => ({ t, m: matOf(t * 3) })).sort((a, b) => a.m - b.m);
    const geo = new THREE.BufferGeometry();
    const names = Object.keys(src.attributes);
    for (const n of names) {
      const at = src.getAttribute(n) as THREE.BufferAttribute;
      const arr = new Float32Array(order.length * 3 * at.itemSize);
      let o = 0;
      for (const { t } of order)
        for (let k = 0; k < 3; k++)
          for (let c = 0; c < at.itemSize; c++) arr[o++] = at.array[(t * 3 + k) * at.itemSize + c];
      geo.setAttribute(n, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
    }
    let start = 0;
    for (let i = 0; i <= order.length; i++)
      if (i === order.length || (i > 0 && order[i].m !== order[i - 1].m)) {
        geo.addGroup(start * 3, (i - start) * 3, order[i - 1].m);
        start = i;
      }
    geo.computeBoundingBox();
    const ctr = geo.boundingBox!.getCenter(new THREE.Vector3());
    geo.translate(-ctr.x, -ctr.y, -ctr.z);
    geo.computeBoundingSphere();
    // gone from the body: collapse each triangle to a point
    const pos = src.getAttribute('position') as THREE.BufferAttribute;
    for (const t of tris) {
      const i = t * 3;
      for (let k = 1; k < 3; k++) pos.setXYZ(i + k, pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    pos.needsUpdate = true;
    this.bumpers[end] = 2;
    this.body.updateWorldMatrix(true, false);
    return { geo, at: this.body.localToWorld(ctr.clone()) };
  }
  /** total crumple so far (glass breaks, the bonnet gives) */
  crumple = 0;
  private readonly tv = new THREE.Vector3();

  /**
   * Crumple the body where it was hit (world point, strength in m/s of closing speed): vertices
   * near the hit are pushed in toward the car's middle with a little noise, and only the
   * triangles touched get new (faceted) normals, so the dent catches the light like bent metal.
   */
  dent(x: number, y: number, z: number, strength: number) {
    if (this.isBoat || this.wrecked || strength < 3) return;
    if (!this.dented) {
      this.baseGeo = this.body.geometry;
      this.body.geometry = this.body.geometry.clone();
      this.dented = true;
    }
    const g = this.body.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const p = this.body.worldToLocal(this.tv.set(x, y, z));
    const r = 0.55 + Math.min(1.1, strength * 0.06);
    const push = Math.min(0.32, strength * 0.016);
    let nx = -p.x, nz = -p.z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const touched: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - p.x, dy = pos.getY(i) - p.y, dz = pos.getZ(i) - p.z;
      const d = Math.sqrt(dx * dx + dy * dy * 0.6 + dz * dz);
      if (d > r) continue;
      const f = (1 - d / r) ** 2;
      const n = Math.sin(pos.getX(i) * 9.1 + pos.getZ(i) * 7.7) * 0.15 + 0.85;
      pos.setXYZ(i, pos.getX(i) + nx * push * f * n, pos.getY(i) - push * 0.35 * f * n, pos.getZ(i) + nz * push * f * n);
      touched.push(Math.floor(i / 3));
    }
    if (!touched.length) return;
    // faceted normals on the bent triangles
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const t of new Set(touched)) {
      const i = t * 3;
      if (i + 2 >= pos.count) continue;
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      b.sub(a);
      c.sub(a);
      const fn = b.cross(c).normalize();
      for (let k = 0; k < 3; k++) {
        const ox = nor.getX(i + k), oy = nor.getY(i + k), oz = nor.getZ(i + k);
        const s = fn.x * ox + fn.y * oy + fn.z * oz < 0 ? -1 : 1;
        nor.setXYZ(i + k, ox * 0.72 + fn.x * s * 0.28, oy * 0.72 + fn.y * s * 0.28, oz * 0.72 + fn.z * s * 0.28);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.crumple += push;
  }

  /** -1 left, 0 none, 1 right (set by the AI before a turn) */
  signal = 0;
  private lights: { brake: THREE.Mesh; l: THREE.Mesh; r: THREE.Mesh } | null = null;

  /** brake lights and indicators: glows on the tail, made when the car first comes near */
  updateLights(show: boolean, t: number) {
    if (this.isBoat) return;
    if (!show) {
      if (this.lights) this.lights.brake.visible = this.lights.l.visible = this.lights.r.visible = false;
      return;
    }
    if (!this.lights) {
      const s = this.spec;
      const mk = (mat: THREE.Material, x: number, w: number) => {
        const m = new THREE.Mesh(lampGlowGeo(), mat);
        const tl = this.tail;
        m.position.set(x, tl ? tl.y : s.hgt * 0.42, tl ? tl.z - 0.05 : -s.len / 2 - 0.06);
        m.scale.set(w, 1, 1);
        m.rotation.y = Math.PI;
        m.renderOrder = 4;
        this.root.add(m);
        return m;
      };
      const brakeGroup = new THREE.Group();
      const tx = this.tail ? this.tail.x : s.wid * 0.36;
      const bl = mk(brakeMat, tx, 1), br = mk(brakeMat, -tx, 1);
      this.root.remove(bl, br);
      brakeGroup.add(bl, br);
      this.root.add(brakeGroup);
      const bx = this.tail ? Math.min(s.wid * 0.47, this.tail.x + 0.18) : s.wid * 0.47;
      this.lights = { brake: brakeGroup as unknown as THREE.Mesh, l: mk(blinkMat, bx, 0.6), r: mk(blinkMat, -bx, 0.6) };
    }
    const fs = this.forwardSpeed;
    const braking = this.driver !== null && !this.wrecked && ((fs > 0.5 && this.input.thr < -0.05) || (fs < -0.5 && this.input.thr > 0.05) || (this.input.hand && Math.abs(fs) < 1 && this.driver === 'npc'));
    this.lights.brake.visible = braking;
    const on = Math.floor(t * 2.6) % 2 === 0 && !this.wrecked;
    this.lights.l.visible = on && this.signal < 0;
    this.lights.r.visible = on && this.signal > 0;
  }

  get isBoat() {
    return this.type === 'boat' || this.type === 'jetski';
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  get forwardSpeed() {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }
  fwdX() {
    return Math.sin(this.heading);
  }
  fwdZ() {
    return Math.cos(this.heading);
  }

  place(x: number, z: number, heading: number) {
    this.pos.set(x, this.isBoat ? WATER_Y : groundAt(x, z), z);
    this.heading = heading;
    this.vx = this.vz = this.vy = this.yawRate = 0;
    this.syncMesh(0);
  }

  /** world position of the driver door (left side) */
  doorPos(out: THREE.Vector3): THREE.Vector3 {
    const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
    const side = -(this.spec.wid / 2 + 0.7);
    return out.set(this.pos.x + rx * side + this.fwdX() * 0.3, this.pos.y, this.pos.z + rz * side + this.fwdZ() * 0.3);
  }

  damage(amount: number) {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      if (this.burnTimer === 0) this.burnTimer = 0.001;
    }
  }

  wreck() {
    this.wrecked = true;
    this.health = 0;
    this.body.material = [carMats.burnt, carMats.burnt, carMats.burnt];
    this.siren = false;
    for (const w of this.wheels) w.material = carMats.burnt;
  }

  /** Physics step. */
  update(dt: number, colliders: ColliderGrid, events: VehicleEvents, elapsed: number) {
    this.age += dt;
    const s = this.spec;
    const inp = this.input;
    if (this.wrecked || this.sunk || this.burnTimer > 0) {
      inp.thr = 0;
      inp.hand = true;
      inp.steer = 0;
    }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * rx + this.vz * rz;
    const onGround = !this.airborne;

    // ---- engine and brakes
    if (onGround && !this.sinking) {
      const thr = inp.thr;
      if (thr > 0.01) {
        if (vLong < -0.5) vLong += s.brake * thr * dt;
        else {
          const f = 1 - clamp(vLong / s.maxSpeed, 0, 1) ** 2;
          vLong += s.accel * thr * f * dt * (this.isBoat ? 1 : 1);
        }
      } else if (thr < -0.01) {
        if (vLong > 0.5) vLong += s.brake * thr * dt;
        else {
          const maxRev = this.isBoat ? 8 : 13;
          vLong += s.accel * 0.6 * thr * (1 - clamp(-vLong / maxRev, 0, 1)) * dt;
        }
      } else {
        // rolling resistance
        const rr = this.isBoat ? 1.6 : 1.1;
        vLong = Math.abs(vLong) < rr * dt ? 0 : vLong - Math.sign(vLong) * rr * dt;
      }
      if (inp.hand && !this.isBoat) {
        const hb = 7.5 * dt;
        vLong = Math.abs(vLong) < hb ? 0 : vLong - Math.sign(vLong) * hb;
      }
      // aerodynamic drag
      vLong -= vLong * Math.abs(vLong) * (this.isBoat ? 0.004 : 0.0009) * dt;
    }

    // ---- steering (speed sensitive)
    const sp = Math.abs(vLong);
    const maxSteer = s.steer / (1 + sp / 17);
    this.steerAngle = damp(this.steerAngle, inp.steer * maxSteer, 9, dt);
    let yawTarget: number;
    if (this.isBoat) yawTarget = inp.steer * 0.9 * clamp(sp / 6, 0, 1) * Math.sign(vLong || 1);
    else yawTarget = (vLong * Math.tan(this.steerAngle)) / s.wheelbase;
    let grip = s.grip;
    let yawGrip = 9;
    if (inp.hand && !this.isBoat && sp > 4) {
      grip = 1.1;
      yawGrip = 3.5;
      yawTarget *= 1.55;
    }
    // slip angle reduces grip a little when already sliding (lets drifts carry)
    const slipNow = Math.abs(vLat);
    if (!inp.hand && slipNow > 4) grip *= 0.6;
    if (!onGround) {
      grip = 0;
      yawGrip = 0.3;
    }
    if (this.sinking) {
      grip = 2;
      yawTarget = 0;
    }
    this.yawRate += (yawTarget - this.yawRate) * clamp(yawGrip * dt, 0, 1);
    vLat *= Math.exp(-grip * dt);
    this.slip = Math.abs(vLat);

    this.vx = fx * vLong + rx * vLat;
    this.vz = fz * vLong + rz * vLat;
    this.heading += this.yawRate * dt;

    // ---- integrate
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;

    // ---- vertical
    if (this.isBoat) {
      if (!isWater(this.pos.x, this.pos.z)) {
        // beached: stop against the land
        this.pos.x = px;
        this.pos.z = pz;
        const imp = this.speed;
        this.vx *= -0.2;
        this.vz *= -0.2;
        if (imp > 3) events.onImpact(this, imp, this.pos.x, this.pos.y, this.pos.z, null);
      }
      const wh = waveHeight(this.pos.x, this.pos.z, elapsed) * 0.5;
      this.pos.y = damp(this.pos.y, WATER_Y + wh + 0.05 + Math.min(0.25, sp * 0.01), 6, dt);
      this.airborne = false;
    } else {
      let g = groundAt(this.pos.x, this.pos.z, this.pos.y + 1.0);
      // an airboat skims the swamp ponds instead of sinking into them
      if (this.type === 'airboat' && this.pos.x < -470) g = Math.max(g, 0.02);
      if (this.pos.y > g + 0.06) {
        this.airborne = true;
        this.vy -= 20 * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= g) {
          if (this.vy < -7) events.onImpact(this, -this.vy * 0.6, this.pos.x, this.pos.y, this.pos.z, null);
          this.pos.y = g;
          this.vy = 0;
          this.airborne = false;
        }
      } else {
        const nvy = (g - this.pos.y) / Math.max(dt, 1e-4);
        this.vy = clamp(nvy, -2, 14);
        this.pos.y = g;
        this.airborne = false;
      }
      // water
      if (groundBase(this.pos.x, this.pos.z) < WATER_Y - 0.4 && this.pos.y < WATER_Y + 0.3) {
        if (!this.sinking) {
          this.sinking = 0.001;
          events.onSink(this);
        }
      }
      if (this.sinking) {
        this.sinking += dt;
        this.airborne = false;
        this.pos.y = Math.max(this.pos.y - dt * 0.8, WATER_Y - 1.6);
        this.vx *= Math.exp(-2.5 * dt);
        this.vz *= Math.exp(-2.5 * dt);
        if (this.sinking > 3 && !this.sunk) {
          this.sunk = true;
          this.wrecked = true;
        }
      }
    }

    // ---- static collisions (three circles along the body)
    if (!this.sinking) this.collideStatic(colliders, events);

    // ---- burning / explosion handled by game; drive the visual
    this.syncMesh(dt);
  }

  circles(out: { x: number; z: number; r: number }[]): { x: number; z: number; r: number }[] {
    const s = this.spec;
    const r = s.wid / 2;
    const off = s.len / 2 - r;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    out.length = 0;
    out.push({ x: this.pos.x + fx * off, z: this.pos.z + fz * off, r }, { x: this.pos.x, z: this.pos.z, r }, { x: this.pos.x - fx * off, z: this.pos.z - fz * off, r });
    return out;
  }

  private circ: { x: number; z: number; r: number }[] = [];
  private collideStatic(colliders: ColliderGrid, events: VehicleEvents) {
    const cs = this.circles(this.circ);
    const y0 = this.pos.y + (this.isBoat ? -0.5 : 0.25), y1 = this.pos.y + this.spec.hgt;
    for (let k = 0; k < 3; k++) {
      const c = cs[k];
      // cars roll over street furniture rather than stopping dead on a planter
      const res = colliders.resolveCircle(c.x, c.z, c.r, y0, y1, tmpBoxes, true);
      if (!res) continue;
      const dx = res.x - c.x, dz = res.z - c.z;
      this.pos.x += dx;
      this.pos.z += dz;
      for (const o of cs) { o.x += dx; o.z += dz; }
      const offx = c.x - this.pos.x, offz = c.z - this.pos.z;
      // velocity of the contact point
      const vpx = this.vx + this.yawRate * offz, vpz = this.vz - this.yawRate * offx;
      const vn = vpx * res.nx + vpz * res.nz;
      if (vn < 0) {
        const e = 0.25;
        this.vx -= (1 + e) * vn * res.nx;
        this.vz -= (1 + e) * vn * res.nz;
        // tangential scrub
        this.vx *= 0.97;
        this.vz *= 0.97;
        const torque = offx * res.nz - offz * res.nx;
        this.yawRate += torque * vn * 0.08;
        this.yawRate *= 0.8;
        const imp = -vn;
        if (imp > 2) {
          this.damage((imp - 2) * 14);
          events.onImpact(this, imp, c.x - res.nx * c.r, this.pos.y + 0.6, c.z - res.nz * c.r, null);
        }
      }
    }
  }

  syncMesh(dt: number) {
    const s = this.spec;
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.heading, 0);
    // pitch from terrain and acceleration, roll from cornering
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let tp = 0;
    if (!this.isBoat && !this.airborne) {
      const h = s.len * 0.45;
      const gf = groundAt(this.pos.x + fx * h, this.pos.z + fz * h, this.pos.y + 1.5);
      const gb = groundAt(this.pos.x - fx * h, this.pos.z - fz * h, this.pos.y + 1.5);
      tp = -Math.atan2(gf - gb, h * 2);
    }
    const vLong = this.forwardSpeed;
    const accelPitch = clamp(this.input.thr * 0.02 * (Math.abs(vLong) < s.maxSpeed * 0.9 ? 1 : 0), -0.03, 0.03);
    // cars roll out of a corner; a bike leans into it, as far as the corner needs
    const rollT = this.type === 'bike' ? clamp(Math.atan((this.yawRate * vLong) / 9.81) * -1, -0.7, 0.7) : clamp(this.yawRate * vLong * 0.004, -0.09, 0.09);
    if (this.isBoat) tp -= clamp(Math.abs(vLong) * 0.006, 0, 0.12);
    if (dt > 0) {
      this.pitch = damp(this.pitch, tp - accelPitch, 10, dt);
      this.roll = damp(this.roll, rollT, 6, dt);
    } else {
      this.pitch = tp;
    }
    this.body.rotation.set(this.pitch, 0, this.roll, 'YXZ');
    if (this.sinking) this.body.rotation.x += Math.min(0.5, this.sinking * 0.2);
    // wheels
    if (this.wheels.length) {
      this.wheelSpin += (vLong / s.wheelR) * dt;
      for (let i = 0; i < this.wheels.length; i++) {
        const w = this.wheels[i];
        w.rotation.set(this.wheelSpin, w.position.z > 0 ? this.steerAngle : 0, 0, 'YXZ');
      }
    }
    // rpm for audio
    const frac = clamp(Math.abs(vLong) / s.maxSpeed, 0, 1);
    const gears = 5;
    this.gear = Math.min(gears, 1 + Math.floor(frac * gears * 0.999));
    const within = frac * gears - (this.gear - 1);
    const target = 0.18 + 0.72 * within + Math.abs(this.input.thr) * 0.1;
    this.rpm = dt > 0 ? damp(this.rpm, target, 8, dt) : target;
  }

  setSirenVisual(t: number) {
    if (!this.sirenRed || !this.sirenBlue) return;
    const on = this.siren && !this.wrecked;
    const a = Math.floor(t * 6) % 2 === 0;
    this.sirenRed.material = on && a ? carMats.sirenRed : carMats.sirenOff;
    this.sirenBlue.material = on && !a ? carMats.sirenBlue : carMats.sirenOffB;
  }
}

/** Resolve overlaps and momentum between vehicles. */
export function collideVehicles(list: Vehicle[], events: VehicleEvents) {
  const ca: { x: number; z: number; r: number }[] = [], cb: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.sinking) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.sinking || a.isBoat !== b.isBoat) continue;
      const dx0 = b.pos.x - a.pos.x, dz0 = b.pos.z - a.pos.z;
      const lim = (a.spec.len + b.spec.len) / 2 + 0.5;
      if (dx0 * dx0 + dz0 * dz0 > lim * lim) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
      a.circles(ca);
      b.circles(cb);
      for (const p of ca)
        for (const q of cb) {
          const dx = q.x - p.x, dz = q.z - p.z;
          const rr = p.r + q.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          const pen = rr - d;
          const ma = a.spec.mass * (a.wrecked && !a.persistent ? 1.5 : 1), mb = b.spec.mass;
          const wa = mb / (ma + mb), wb = ma / (ma + mb);
          a.pos.x -= nx * pen * wa;
          a.pos.z -= nz * pen * wa;
          b.pos.x += nx * pen * wb;
          b.pos.z += nz * pen * wb;
          const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rv < 0) {
            const e = 0.3;
            const jimp = (-(1 + e) * rv) / (1 / ma + 1 / mb);
            a.vx -= (jimp / ma) * nx;
            a.vz -= (jimp / ma) * nz;
            b.vx += (jimp / mb) * nx;
            b.vz += (jimp / mb) * nz;
            a.yawRate += (Math.random() - 0.5) * -rv * 0.05;
            b.yawRate += (Math.random() - 0.5) * -rv * 0.05;
            const imp = -rv;
            if (imp > 2.5) {
              a.damage((imp - 2.5) * 10 * (mb / ma));
              b.damage((imp - 2.5) * 10 * (ma / mb));
              events.onImpact(a, imp, (p.x + q.x) / 2, a.pos.y + 0.6, (p.z + q.z) / 2, b);
            }
          }
        }
    }
  }
}

/** the underglow: a soft rounded pool of light on the road, laid flat under the car */
const neonGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let neonTex: THREE.CanvasTexture | null = null;
function neonTexture() {
  if (neonTex) return neonTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d')!;
  const img = x.createImageData(128, 256);
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 128; i++) {
      // distance outside an inner rounded box, as a soft glow that is brightest at the car's edge
      const u = Math.abs(i - 63.5) / 63.5, v = Math.abs(j - 127.5) / 127.5;
      const dx = Math.max(0, u - 0.55) / 0.45, dy = Math.max(0, v - 0.72) / 0.28;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 1.6) * (u < 0.55 && v < 0.72 ? 0.75 : 1);
      const k = (j * 128 + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  x.putImageData(img, 0, 0);
  neonTex = new THREE.CanvasTexture(c);
  return neonTex;
}
let tinted: THREE.Material | null = null;
function tintedGlass() {
  if (!tinted) {
    const m = carMats.glass.clone();
    m.color.setHex(0x1a1d22);
    m.opacity = 0.88;
    tinted = m;
  }
  return tinted;
}
