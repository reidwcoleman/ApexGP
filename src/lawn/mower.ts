/** The mower: its model (push mowers with a walking gardener, little riders) and how it drives. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MowerDef } from './save.ts';
import type { Hit, Nav } from './nav.ts';
import { angleDiff, clamp, damp, lerp } from './util.ts';
import { lam } from './gfx.ts';

export interface MowerModel {
  group: THREE.Group;
  /** Wheels turn with the distance driven. */
  wheels: { mesh: THREE.Object3D; r: number }[];
  legs: THREE.Object3D[];
  /** Where the exhaust and the grass chute are, in model space. */
  exhaust: THREE.Vector3;
  chute: THREE.Vector3;
  dispose: () => void;
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const d = b.clone().sub(a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

function wheel(r: number, w: number, tire: THREE.Material, hub: THREE.Material) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), tire);
  t.rotation.z = Math.PI / 2;
  g.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.012, 10), hub);
  h.rotation.z = Math.PI / 2;
  g.add(h);
  return g;
}

function person(shirt: string, cap: string, seated: boolean) {
  const g = new THREE.Group();
  const skin = lam('#f3c19a');
  const jeans = lam('#41609e');
  const legs: THREE.Object3D[] = [];
  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.44, 0.2, 2, 0.05), lam(shirt));
  torso.position.y = seated ? 0.88 : 1.02;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), skin);
  head.position.y = torso.position.y + 0.37;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lam(cap));
  hat.position.y = head.position.y + 0.02;
  g.add(hat);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.14), lam(cap));
  brim.position.set(0, head.position.y + 0.025, 0.14);
  g.add(brim);
  if (!seated) {
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.1, 0.8, 0);
      const l = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.62, 0.15, 2, 0.04), jeans);
      l.position.y = -0.31;
      leg.add(l);
      const shoe = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.08, 0.24, 2, 0.03), lam('#f4f1e6'));
      shoe.position.set(0, -0.62, 0.04);
      leg.add(shoe);
      g.add(leg);
      legs.push(leg);
    }
  } else {
    for (const sx of [-1, 1]) {
      const l = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.14, 0.5, 2, 0.04), jeans);
      l.position.set(sx * 0.1, 0.62, 0.2);
      g.add(l);
    }
  }
  return { g, legs, torso, head };
}

export function buildMowerModel(def: MowerDef, width: number): MowerModel {
  const group = new THREE.Group();
  const body = lam(def.body);
  const trim = lam(def.trim);
  const tire = lam('#2a2d36');
  const hub = lam('#d9dde6');
  const steel = lam('#9aa1ae');
  const wheels: MowerModel['wheels'] = [];
  const own: THREE.Material[] = [body, trim, tire, hub, steel];
  let legs: THREE.Object3D[] = [];
  const exhaust = new THREE.Vector3();
  const chute = new THREE.Vector3();

  if (def.kind === 'push') {
    const deck = new THREE.Mesh(new RoundedBoxGeometry(width, 0.2, 0.8, 3, 0.07), body);
    deck.position.set(0, 0.2, 0.08);
    group.add(deck);
    const skirt = new THREE.Mesh(new RoundedBoxGeometry(width + 0.02, 0.07, 0.82, 2, 0.03), trim);
    skirt.position.set(0, 0.1, 0.08);
    group.add(skirt);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.28, 0.5, 3, 0.09), body);
    hood.position.set(0, 0.43, 0.02);
    group.add(hood);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), trim);
    cap.position.set(0.1, 0.59, 0.1);
    group.add(cap);
    const pull = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12), steel);
    pull.position.set(-0.12, 0.5, 0.28);
    group.add(pull);
    const bag = new THREE.Mesh(new RoundedBoxGeometry(Math.min(0.7, width * 0.55), 0.34, 0.34, 3, 0.1), lam('#f6f0dd'));
    bag.position.set(0, 0.42, -0.5);
    group.add(bag);
    own.push(bag.material as THREE.Material);
    const hp = 0.3;
    const h1 = new THREE.Vector3(0.0, 0.5, -0.6);
    for (const sx of [-1, 1]) {
      group.add(tube(new THREE.Vector3(sx * hp, 0.32, -0.28), new THREE.Vector3(sx * hp, 0.98, -1.05), 0.022, steel));
    }
    group.add(tube(new THREE.Vector3(-hp, 0.98, -1.05), new THREE.Vector3(hp, 0.98, -1.05), 0.026, trim));
    void h1;
    const fw = 0.14;
    const rw = 0.19;
    const wx = width / 2 - 0.02;
    for (const [sx, z, r] of [[-1, 0.33, fw], [1, 0.33, fw], [-1, -0.2, rw], [1, -0.2, rw]] as const) {
      const w = wheel(r, 0.11, tire, hub);
      w.position.set(sx * wx, r, z);
      group.add(w);
      wheels.push({ mesh: w, r });
    }
    const p = person('#fff3d6', def.body, false);
    p.g.position.set(0, 0, -1.22);
    group.add(p.g);
    legs = p.legs;
    for (const sx of [-1, 1]) {
      group.add(tube(new THREE.Vector3(sx * 0.17, 1.12, -1.2), new THREE.Vector3(sx * hp, 0.99, -1.06), 0.04, lam('#fff3d6')));
    }
    exhaust.set(-0.18, 0.52, -0.1);
    chute.set(width / 2 - 0.05, 0.3, 0.0);
  } else {
    const deck = new THREE.Mesh(new RoundedBoxGeometry(width, 0.18, 0.95, 3, 0.07), body);
    deck.position.set(0, 0.2, 0.32);
    group.add(deck);
    const skirt = new THREE.Mesh(new RoundedBoxGeometry(width + 0.02, 0.06, 0.97, 2, 0.03), trim);
    skirt.position.set(0, 0.1, 0.32);
    group.add(skirt);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.36, 0.68, 4, 0.12), body);
    hood.position.set(0, 0.46, 0.5);
    group.add(hood);
    const grille = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.2, 0.05, 2, 0.02), trim);
    grille.position.set(0, 0.46, 0.84);
    group.add(grille);
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: '#fff6c8' }));
      hl.position.set(sx * 0.27, 0.5, 0.82);
      group.add(hl);
      own.push(hl.material as THREE.Material);
    }
    const chassis = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.22, 0.9, 3, 0.07), body);
    chassis.position.set(0, 0.34, -0.2);
    group.add(chassis);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.1, 0.42, 3, 0.04), trim);
    seat.position.set(0, 0.55, -0.32);
    group.add(seat);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.38, 0.09, 3, 0.04), trim);
    back.position.set(0, 0.75, -0.54);
    group.add(back);
    const col = tube(new THREE.Vector3(0, 0.62, 0.12), new THREE.Vector3(0, 0.86, 0.02), 0.028, steel);
    group.add(col);
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 16), trim);
    sw.position.set(0, 0.9, 0.0);
    sw.rotation.x = Math.PI / 2.5;
    group.add(sw);
    const fw = 0.17;
    const rw = 0.3;
    for (const [sx, z, r, wid] of [[-1, 0.62, fw, 0.12], [1, 0.62, fw, 0.12], [-1, -0.38, rw, 0.2], [1, -0.38, rw, 0.2]] as const) {
      const w = wheel(r, wid, tire, hub);
      w.position.set(sx * (def.kind === 'rider' && r === rw ? 0.44 : 0.4), r, z);
      group.add(w);
      wheels.push({ mesh: w, r });
    }
    const p = person('#ffffff', def.body === '#ffc21a' ? '#2f6fdc' : '#ffd35a', true);
    p.g.position.set(0, 0.0, -0.3);
    group.add(p.g);
    for (const sx of [-1, 1]) group.add(tube(new THREE.Vector3(sx * 0.15, 1.02, -0.36), new THREE.Vector3(sx * 0.13, 0.91, 0.0), 0.035, lam('#ffffff')));
    exhaust.set(0.2, 0.7, 0.6);
    chute.set(width / 2 - 0.05, 0.3, 0.3);
  }

  return {
    group,
    wheels,
    legs,
    exhaust,
    chute,
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

export class Mower {
  readonly root = new THREE.Group();
  private readonly lean = new THREE.Group();
  private model: MowerModel | null = null;
  def!: MowerDef;
  width = 1.3;
  maxSpeed = 4.4;
  radius = 0.4;
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
    }
  }

  place(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.turnRate = 0;
    this.sync();
  }

  forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }
  /** The middle of the deck (what the blades are cutting). */
  deck() {
    const f = this.forward();
    return { x: this.x + f.x * 0.1, z: this.z + f.z * 0.1 };
  }
  chuteWorld(out: THREE.Vector3) {
    if (!this.model) return out.set(this.x, 0.3, this.z);
    out.copy(this.model.chute).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    return out.add(new THREE.Vector3(this.x, 0, this.z));
  }
  exhaustWorld(out: THREE.Vector3) {
    if (!this.model) return out.set(this.x, 0.5, this.z);
    out.copy(this.model.exhaust).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    return out.add(new THREE.Vector3(this.x, 0, this.z));
  }

  update(dt: number, input: DriveInput | null, nav: Nav): { hit: Hit | null; impact: number } {
    this.time += dt;
    const want = input ? Math.hypot(input.dx, input.dz) : 0;
    this.throttle = damp(this.throttle, want, 10, dt);
    let target = 0;
    let turn = 0;
    if (input && want > 0.05) {
      const desired = Math.atan2(input.dx, input.dz);
      const diff = angleDiff(desired, this.heading);
      const sp = this.speed / this.maxSpeed;
      const maxTurn = lerp(2.6, 6.2, clamp(sp * 1.4, 0, 1)) * (this.def.kind === 'rider' ? 0.82 : 1);
      turn = clamp(diff * 7, -maxTurn, maxTurn);
      target = this.maxSpeed * clamp(want, 0, 1) * lerp(0.42, 1, Math.max(0, Math.cos(diff)));
    }
    this.turnRate = damp(this.turnRate, turn, 18, dt);
    this.heading += this.turnRate * dt;
    const accel = target > this.speed ? 13 : 24;
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
        this.squash = Math.min(1, this.squash + vn / 5);
      }
    }
    this.odo += Math.hypot(this.x - px, this.z - pz);

    // body language: pitch with acceleration, roll into turns, a hum of vibration
    const acc = (this.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = this.speed;
    this.pitch = damp(this.pitch, clamp(-acc * 0.004, -0.07, 0.07), 10, dt);
    this.roll = damp(this.roll, clamp(-this.turnRate * this.speed * 0.012, -0.16, 0.16), 9, dt);
    this.squash = damp(this.squash, 0, 9, dt);
    this.sync();
    return { hit, impact };
  }

  sync() {
    const sp = this.speed / Math.max(1, this.maxSpeed);
    const buzz = Math.sin(this.time * 70) * 0.005 * (0.4 + this.throttle) + Math.sin(this.time * 43) * 0.003;
    const bob = Math.abs(Math.sin(this.odo * 3.4)) * 0.018 * sp;
    this.root.position.set(this.x, this.extraY, this.z);
    this.root.rotation.y = this.heading + this.spin;
    this.lean.position.y = buzz + bob - this.squash * 0.04;
    this.lean.rotation.set(this.pitch, 0, this.roll);
    const s = this.appear;
    this.root.scale.set(s * (1 + this.squash * 0.07), s * (1 - this.squash * 0.1), s * (1 + this.squash * 0.07));
    const m = this.model;
    if (m) {
      for (const w of m.wheels) w.mesh.rotation.x = this.odo / w.r;
      const ph = this.odo * 5.2;
      m.legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + i * Math.PI) * 0.7 * Math.min(1, sp * 1.6)));
    }
  }
}
