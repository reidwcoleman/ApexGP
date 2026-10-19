/**
 * The mower: a detailed PBR model (a push mower with a gardener walking behind it, or a small
 * ride-on with the gardener in the seat — the engine's Rocketbox people, animated) and how it drives.
 * Metres: a push mower's deck is about 0.6 m wide, a rider's about a metre.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loadPeople, Person, type Look } from '../people/Humans.ts';
import type { MowerDef } from './save.ts';
import type { Hit, Nav } from './nav.ts';
import { angleDiff, clamp, damp, lerp } from './util.ts';

export interface MowerModel {
  group: THREE.Group;
  /** Wheels turn with the distance driven. */
  wheels: { mesh: THREE.Object3D; r: number }[];
  /** Where the exhaust and the grass chute are, in model space. */
  exhaust: THREE.Vector3;
  chute: THREE.Vector3;
  /** where the gardener stands / sits (model space) */
  stand: THREE.Vector3;
  dispose: () => void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const d = b.clone().sub(a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

let weave: THREE.CanvasTexture | null = null;
/** a woven grass-bag fabric, as a colour map */
function weaveTexture() {
  if (weave) return weave;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e4d6';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 4) {
    g.fillStyle = 'rgba(80,76,64,0.35)';
    g.fillRect(i, 0, 1.4, 128);
    g.fillRect(0, i, 128, 1.4);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(i + 2, 0, 1, 128);
  }
  weave = new THREE.CanvasTexture(c);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(3, 3);
  weave.colorSpace = THREE.SRGBColorSpace;
  weave.anisotropy = 4;
  return weave;
}

function wheel(r: number, w: number, tire: THREE.Material, hub: THREE.Material) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28), tire);
  t.rotation.z = Math.PI / 2;
  t.castShadow = true;
  g.add(t);
  // tread blocks
  const n = 18;
  const blk = new THREE.BoxGeometry(w * 1.02, r * 0.1, r * 0.2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = new THREE.Mesh(blk, tire);
    b.position.set(0, Math.cos(a) * r * 0.99, Math.sin(a) * r * 0.99);
    b.rotation.x = -a;
    g.add(b);
  }
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.006, 24), hub);
  h.rotation.z = Math.PI / 2;
  g.add(h);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.012, 12), tire);
  cap.rotation.z = Math.PI / 2;
  g.add(cap);
  return g;
}

export function buildMowerModel(def: MowerDef, width: number): MowerModel {
  const group = new THREE.Group();
  const body = new THREE.MeshPhysicalMaterial({ color: def.body, roughness: 0.3, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const trim = new THREE.MeshStandardMaterial({ color: def.trim, roughness: 0.55, metalness: 0.0 });
  const dark = new THREE.MeshStandardMaterial({ color: '#202327', roughness: 0.6, metalness: 0.1 });
  const tire = new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.95, metalness: 0 });
  const hub = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.5, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.3, metalness: 1 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.85, metalness: 0 });
  const fabric = new THREE.MeshStandardMaterial({ map: weaveTexture(), roughness: 0.95, metalness: 0 });
  const own: THREE.Material[] = [body, trim, dark, tire, hub, steel, rubber, fabric];
  const wheels: MowerModel['wheels'] = [];
  const exhaust = new THREE.Vector3();
  const chute = new THREE.Vector3();
  const stand = new THREE.Vector3();

  if (def.kind === 'push') {
    const hw = width / 2;
    // the cutter housing: a low shell, a darker skirt beneath, the discharge chute at the operator's right
    group.add(rbox(width * 0.98, 0.1, 0.62, 0.04, body, 0, 0.17, 0.04));
    group.add(rbox(width, 0.05, 0.64, 0.02, dark, 0, 0.1, 0.04));
    group.add(rbox(width * 0.7, 0.07, 0.4, 0.03, body, 0, 0.25, 0.0));
    const ch = rbox(0.16, 0.09, 0.2, 0.03, body, -hw + 0.04, 0.16, -0.22);
    ch.rotation.y = 0.35;
    group.add(ch);
    // the engine under its cover
    group.add(rbox(0.34, 0.15, 0.36, 0.06, trim, 0.02, 0.35, -0.02));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), dark);
    cap.position.set(0.1, 0.44, 0.1);
    group.add(cap);
    const pull = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 16), rubber);
    pull.position.set(-0.1, 0.4, 0.17);
    pull.rotation.y = Math.PI / 2;
    group.add(pull);
    // the grass bag, with its frame
    const bag = rbox(Math.min(0.46, width * 0.8), 0.3, 0.3, 0.07, fabric, 0, 0.36, -0.46);
    group.add(bag);
    group.add(rbox(Math.min(0.48, width * 0.82), 0.04, 0.34, 0.015, dark, 0, 0.5, -0.46));
    // wheels: small ones in front, big ones behind
    const fr = 0.085;
    const rr = 0.125;
    const wx = hw - 0.02;
    for (const [sx, z, r] of [[-1, 0.26, fr], [1, 0.26, fr], [-1, -0.2, rr], [1, -0.2, rr]] as const) {
      const w = wheel(r, 0.05, tire, hub);
      w.position.set(sx * wx, r, z);
      group.add(w);
      wheels.push({ mesh: w, r });
    }
    // the handle: two steel uprights to a cross bar with grips, and the safety bar
    const hp = 0.24;
    const lowZ = -0.3;
    for (const sx of [-1, 1]) {
      group.add(tube(V(sx * hp, 0.3, lowZ), V(sx * hp, 0.98, -0.78), 0.011, steel));
      group.add(tube(V(sx * hp * 0.95, 0.98, -0.78), V(sx * (hp + 0.1), 0.99, -0.88), 0.016, rubber));
    }
    group.add(tube(V(-hp, 0.98, -0.78), V(hp, 0.98, -0.78), 0.012, steel));
    group.add(tube(V(-hp * 0.9, 0.9, -0.74), V(hp * 0.9, 0.9, -0.74), 0.008, trim));
    exhaust.set(0.12, 0.4, -0.2);
    chute.set(-hw - 0.02, 0.17, -0.2);
    stand.set(0.4, 0, -0.98);
  } else {
    const hw = width / 2;
    // a small ride-on: deck under the frame, hood, seat, steering wheel
    group.add(rbox(width * 0.98, 0.1, 0.9, 0.04, body, 0, 0.2, 0.3));
    group.add(rbox(width, 0.05, 0.92, 0.02, dark, 0, 0.12, 0.3));
    const ch = rbox(0.2, 0.1, 0.26, 0.03, body, -hw + 0.05, 0.2, 0.0);
    ch.rotation.y = 0.35;
    group.add(ch);
    group.add(rbox(0.56, 0.1, 1.15, 0.05, dark, 0, 0.3, 0.2));
    group.add(rbox(0.5, 0.26, 0.55, 0.12, body, 0, 0.5, 0.62));
    group.add(rbox(0.38, 0.14, 0.04, 0.02, trim, 0, 0.5, 0.9));
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), new THREE.MeshStandardMaterial({ color: '#fffbe6', emissive: '#fff4c8', emissiveIntensity: 1.4, roughness: 0.2 }));
      hl.position.set(sx * 0.17, 0.52, 0.89);
      group.add(hl);
      own.push(hl.material as THREE.Material);
    }
    // fenders over the rear wheels, the seat and its back
    for (const sx of [-1, 1]) group.add(rbox(0.12, 0.05, 0.55, 0.02, body, sx * 0.34, 0.5, -0.28));
    group.add(rbox(0.4, 0.08, 0.38, 0.04, rubber, 0, 0.5, -0.22));
    group.add(rbox(0.38, 0.34, 0.07, 0.03, rubber, 0, 0.72, -0.4));
    // the steering column and wheel
    group.add(tube(V(0, 0.55, 0.28), V(0, 0.86, 0.14), 0.016, steel));
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 10, 28), rubber);
    sw.position.set(0, 0.9, 0.12);
    sw.rotation.x = Math.PI / 2.6;
    sw.castShadow = true;
    group.add(sw);
    const fr = 0.12;
    const rr = 0.22;
    for (const [sx, z, r, wd] of [[-1, 0.7, fr, 0.08], [1, 0.7, fr, 0.08], [-1, -0.28, rr, 0.14], [1, -0.28, rr, 0.14]] as const) {
      const w = wheel(r, wd, tire, hub);
      w.position.set(sx * 0.4, r, z);
      group.add(w);
      wheels.push({ mesh: w, r });
    }
    exhaust.set(0.2, 0.62, -0.5);
    chute.set(-hw - 0.02, 0.2, 0.0);
    stand.set(0, 0.34, -0.22);
  }
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });

  return {
    group,
    wheels,
    exhaust,
    chute,
    stand,
    dispose: () => {
      group.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      own.forEach((m) => m.dispose());
    },
  };
}

export interface DriveInput {
  /** World-space direction the player wants to go (unit-ish; length is the throttle 0..1). */
  dx: number;
  dz: number;
}

const GARDENER: Look = {
  female: false,
  tone: 0.3,
  hair: 'buzzed',
  hairColor: '#4a3322',
  top: 'tshirt',
  topColor: '#2f6f55',
  bottom: 'shorts',
  bottomColor: '#4a5668',
  shoeColor: '#2d2a27',
  gloves: '#c9a94a',
  cap: '#d8d2c4',
  body: 'Gardener_Male_01',
  tint: 0.0,
};

export class Mower {
  readonly root = new THREE.Group();
  private readonly lean = new THREE.Group();
  private model: MowerModel | null = null;
  private person: Person | null = null;
  def!: MowerDef;
  width = 0.56;
  maxSpeed = 3;
  radius = 0.32;
  x = 0;
  z = 0;
  heading = Math.PI;
  speed = 0;
  turnRate = 0;
  odo = 0;
  /** 0..1 how hard it is being driven (for sound). */
  throttle = 0;
  squash = 0;
  private time = 0;
  private prevSpeed = 0;
  private roll = 0;
  private pitch = 0;
  appear = 1;
  /** Victory hop and spin. */
  extraY = 0;
  spin = 0;
  private gait = '';

  constructor() {
    this.root.add(this.lean);
  }

  setDef(def: MowerDef, width: number, maxSpeed: number) {
    const rebuild = !this.model || this.def?.id !== def.id || Math.abs(width - this.width) > 0.001;
    this.def = def;
    this.width = width;
    this.maxSpeed = maxSpeed;
    this.radius = def.radius;
    if (rebuild) {
      if (this.model) {
        this.lean.remove(this.model.group);
        this.model.dispose();
      }
      this.model = buildMowerModel(def, width);
      this.lean.add(this.model.group);
      void this.seatGardener();
    }
  }

  /** Put the gardener behind the push mower, or in the rider's seat. */
  private async seatGardener() {
    const model = this.model;
    if (!model) return;
    const kit = await loadPeople();
    if (this.model !== model) return;
    if (!this.person) {
      this.person = new Person(kit, GARDENER);
      this.person.lively = true;
    }
    const p = this.person;
    p.root.parent?.remove(p.root);
    model.group.add(p.root);
    p.root.position.copy(model.stand);
    this.gait = '';
  }

  place(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.turnRate = 0;
    this.sync(0);
  }

  forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }
  /** The middle of the deck (what the blades are cutting). */
  deck() {
    const f = this.forward();
    const d = this.def?.kind === 'rider' ? 0.3 : 0.04;
    return { x: this.x + f.x * d, z: this.z + f.z * d };
  }
  chuteWorld(out: THREE.Vector3) {
    if (!this.model) return out.set(this.x, 0.2, this.z);
    out.copy(this.model.chute).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    return out.add(new THREE.Vector3(this.x, 0, this.z));
  }
  exhaustWorld(out: THREE.Vector3) {
    if (!this.model) return out.set(this.x, 0.4, this.z);
    out.copy(this.model.exhaust).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    return out.add(new THREE.Vector3(this.x, 0, this.z));
  }

  update(dt: number, input: DriveInput | null, nav: Nav): { hit: Hit | null; impact: number } {
    this.time += dt;
    const want = input ? Math.hypot(input.dx, input.dz) : 0;
    this.throttle = damp(this.throttle, want, 10, dt);
    let target = 0;
    let turn = 0;
    const rider = this.def.kind === 'rider';
    if (input && want > 0.05) {
      const desired = Math.atan2(input.dx, input.dz);
      const diff = angleDiff(desired, this.heading);
      const sp = this.speed / this.maxSpeed;
      const maxTurn = rider ? lerp(1.5, 2.4, clamp(sp * 1.4, 0, 1)) : lerp(2.6, 4.0, clamp(sp * 1.4, 0, 1));
      turn = clamp(diff * 6, -maxTurn, maxTurn);
      target = this.maxSpeed * clamp(want, 0, 1) * lerp(0.4, 1, Math.max(0, Math.cos(diff)));
    }
    this.turnRate = damp(this.turnRate, turn, 16, dt);
    this.heading += this.turnRate * dt;
    const accel = target > this.speed ? (rider ? 5 : 8) : rider ? 9 : 14;
    this.speed += clamp(target - this.speed, -accel * dt, accel * dt);

    const f = this.forward();
    const px = this.x;
    const pz = this.z;
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
    const p = { x: this.x, z: this.z };
    const hit = nav.resolve(p, this.radius);
    let impact = 0;
    if (hit) {
      this.x = p.x;
      this.z = p.z;
      // the speed that went into the obstacle is lost; what is left slides along it, and the
      // mower swings round to follow the wall while the player keeps pushing (so edges are easy)
      const vn = this.speed * (f.x * -hit.nx + f.z * -hit.nz);
      if (vn > 0) {
        impact = vn;
        let tx = -hit.nz;
        let tz = hit.nx;
        if (tx * f.x + tz * f.z < 0) {
          tx = -tx;
          tz = -tz;
        }
        const along = Math.max(0, f.x * tx + f.z * tz);
        this.speed *= along;
        if (want > 0.05) this.heading += angleDiff(Math.atan2(tx, tz), this.heading) * Math.min(1, dt * 10);
        this.squash = Math.min(1, this.squash + vn / 4);
      }
    }
    this.odo += Math.hypot(this.x - px, this.z - pz);

    // body language: pitch with acceleration, roll into turns, a hum of vibration
    const acc = (this.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = this.speed;
    this.pitch = damp(this.pitch, clamp(-acc * 0.003, -0.05, 0.05), 10, dt);
    this.roll = damp(this.roll, clamp(-this.turnRate * this.speed * 0.01, -0.09, 0.09), 9, dt);
    this.squash = damp(this.squash, 0, 9, dt);
    this.sync(dt);
    return { hit, impact };
  }

  sync(dt: number) {
    const sp = this.speed / Math.max(1, this.maxSpeed);
    const buzz = Math.sin(this.time * 70) * 0.0016 * (0.4 + this.throttle) + Math.sin(this.time * 43) * 0.001;
    this.root.position.set(this.x, this.extraY, this.z);
    this.root.rotation.y = this.heading + this.spin;
    this.lean.position.y = buzz - this.squash * 0.015;
    this.lean.rotation.set(this.pitch, 0, this.roll);
    this.root.scale.setScalar(this.appear);
    const m = this.model;
    if (m) for (const w of m.wheels) w.mesh.rotation.x = this.odo / w.r;
    const p = this.person;
    if (p && m) {
      const rider = this.def.kind === 'rider';
      const moving = this.speed > 0.25;
      const clip = rider ? 'sit' : moving ? 'trolley' : 'idle';
      if (clip !== this.gait) {
        this.gait = clip;
        p.play(clip, { fade: 0.35 });
      }
      p.root.position.copy(m.stand);
      p.update(Math.max(dt, 0.0001) * (rider ? 1 : moving ? 0.35 + 1.0 * sp : 1));
    }
  }
}
