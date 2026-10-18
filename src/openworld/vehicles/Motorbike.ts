import * as THREE from 'three';
import { mergeStatic } from '../city/build.ts';
import { loft, table, type Station } from './loft.ts';
import { MAT, makeWheel, paintMaterial } from './parts.ts';
import { CarBody, type CarSpec } from '../sim/car.ts';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Drivable, HudInfo, WorldCtx } from './drivable.ts';

/**
 * A superbike (litre-class sport bike): full fairing, tank, tail, twin-spar frame, upside-down
 * forks, a single-sided swingarm, an underseat exhaust — and a rider in leathers and a helmet
 * tucked in at speed. Ridden on the same tyre model as the cars (a narrow track), the bike leans
 * into the turns by the lateral acceleration and lifts its front under hard throttle.
 */

const BIKE: CarSpec = {
  tumble: false,
  mass: 290,
  a: 0.72,
  b: 0.72,
  cgH: 0.62,
  izK: 0.9,
  power: 150000,
  maxForce: 4800,
  frontDrive: 0,
  mu: 1.25,
  cornerB: 8,
  cdA: 0.32,
  clA: 0.01,
  fan: 0,
  maxSteer: 0.42,
  brakeG: 1.15,
  hl: 1.05,
  hw: 0.38,
  height: 1.2,
  wheelR: 0.31,
  vmax: 83,
  vrev: 2,
};

/** a capsule from a to b (a limb, a tube) */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, r2 = r): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = r === r2 ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10) : new THREE.CylinderGeometry(r2, r, len, 12);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** a lofted shell from (z, half-width, bottom y, top y) stations — a rounded section, the widest
 *  point a little above the middle */
function shell(rows: [number, number, number, number][], slot: (z: number, y: number) => string) {
  const st: Station[] = rows.map(([z, w, yb, yt]) => {
    const h = yt - yb;
    return {
      z,
      bands: [
        {
          pts: [
            [0, yb],
            [w * 0.55, yb + h * 0.06],
            [w * 0.92, yb + h * 0.3],
            [w, yb + h * 0.55],
            [w * 0.86, yb + h * 0.82],
            [w * 0.5, yb + h * 0.97],
            [0, yt],
          ] as [number, number][],
        },
      ],
    };
  });
  return loft({ stations: st, slot: (_b, z, y) => slot(z, y), capFront: 'paint', capRear: 'paint' });
}

export function buildBike(color: THREE.ColorRepresentation) {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const paint = paintMaterial(color, 0.35, 0.22);
  const black = MAT.blackTrim();
  const alu = MAT.rimSilver();
  const add = (m: THREE.Object3D) => {
    m.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    lean.add(m);
    return m;
  };
  const meshes = (L: ReturnType<typeof loft>, mats: Record<string, THREE.Material>) => {
    for (const [k, g] of L.slots) add(new THREE.Mesh(g, mats[k] ?? paint));
  };
  // ---- the front fairing and tank (nose +z); the screen is the top of the nose
  meshes(
    shell(
      [
        [0.9, 0.035, 0.84, 0.9],
        [0.84, 0.12, 0.74, 0.99],
        [0.74, 0.18, 0.68, 1.05],
        [0.62, 0.22, 0.64, 1.1],
        [0.5, 0.235, 0.5, 1.1],
        [0.4, 0.24, 0.37, 1.04],
        [0.28, 0.23, 0.36, 1.02],
        [0.16, 0.2, 0.5, 1.03],
        [0.04, 0.17, 0.66, 1.0],
        [-0.06, 0.15, 0.78, 0.94],
      ],
      (z, y) => (z > 0.55 && y > 1.0 ? 'screen' : z > 0.8 && y < 0.925 && y > 0.875 ? 'lamp' : 'paint'),
    ),
    { screen: MAT.glassDark(), lamp: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: new THREE.Color(2.2, 2.2, 2.4), roughness: 0.2 }) },
  );
  // ---- the tail: up and back from the seat, the pillion cowl, the tail light under its tip
  meshes(
    shell(
      [
        [-0.04, 0.14, 0.78, 0.86],
        [-0.25, 0.15, 0.79, 0.87],
        [-0.48, 0.135, 0.82, 0.92],
        [-0.68, 0.11, 0.86, 0.99],
        [-0.86, 0.075, 0.9, 1.03],
        [-0.98, 0.035, 0.93, 1.03],
      ],
      (z, y) => (z > -0.5 && y > 0.86 ? 'seat' : 'paint'),
    ),
    { seat: MAT.interior() },
  );
  // the seat pad over it
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.46), MAT.interior());
  seat.position.set(0, 0.885, -0.27);
  seat.rotation.x = -0.06;
  add(seat);
  // ---- engine: the crankcase, the inline-four's cylinder bank leaning forward, the sump
  const engMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.45 });
  const crank = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.26, 0.42), engMat);
  crank.position.set(0, 0.42, 0.06);
  add(crank);
  const bank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.2), engMat);
  bank.position.set(0, 0.6, 0.2);
  bank.rotation.x = 0.45;
  add(bank);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.22), alu);
  head.position.set(0, 0.74, 0.27);
  head.rotation.x = 0.45;
  add(head);
  for (let i = 0; i < 4; i++) {
    // the headers sweeping down under the engine
    const x = -0.12 + i * 0.08;
    add(limb(V(x, 0.62, 0.36), V(x * 0.6, 0.3, 0.32), 0.018, alu));
    add(limb(V(x * 0.6, 0.3, 0.32), V(x * 0.3, 0.2, 0.05), 0.018, alu));
  }
  // the radiator behind the front wheel
  const rad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.04), new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.3, roughness: 0.6 }));
  rad.position.set(0, 0.62, 0.38);
  rad.rotation.x = -0.35;
  add(rad);
  // ---- frame: twin aluminium spars from the steering head round the engine to the pivot
  for (const sg of [1, -1]) {
    add(limb(V(sg * 0.07, 0.94, 0.48), V(sg * 0.17, 0.8, 0.2), 0.035, alu));
    add(limb(V(sg * 0.17, 0.8, 0.2), V(sg * 0.16, 0.66, -0.08), 0.035, alu));
    add(limb(V(sg * 0.16, 0.66, -0.08), V(sg * 0.15, 0.45, -0.12), 0.035, alu));
    // the swingarm to the rear axle (braced)
    add(limb(V(sg * 0.14, 0.45, -0.12), V(sg * 0.1, 0.31, -0.72), 0.03, alu));
    add(limb(V(sg * 0.14, 0.52, -0.2), V(sg * 0.1, 0.36, -0.6), 0.015, alu));
    // the subframe under the tail
    add(limb(V(sg * 0.12, 0.66, -0.08), V(sg * 0.08, 0.86, -0.6), 0.014, black));
    // rear-set footpegs
    add(limb(V(sg * 0.13, 0.46, -0.24), V(sg * 0.22, 0.46, -0.24), 0.012, alu));
  }
  // the rear shock
  add(limb(V(0, 0.42, -0.36), V(0, 0.68, -0.18), 0.03, new THREE.MeshStandardMaterial({ color: 0xd8b21b, metalness: 0.5, roughness: 0.35 })));
  // the exhaust can up under the tail, right side
  const can = limb(V(-0.13, 0.42, -0.28), V(-0.15, 0.7, -0.84), 0.055, alu, 0.065);
  add(can);
  add(limb(V(0, 0.22, 0.04), V(-0.13, 0.42, -0.28), 0.03, alu));
  // ---- the lights
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.05, 0.05) }));
  tail.position.set(0, 0.92, -0.98);
  add(tail);
  // number plate hanger
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.11, 0.01), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }));
  plate.position.set(0, 0.8, -1.02);
  plate.rotation.x = 0.35;
  add(plate);
  // ---- the front end: raked upside-down forks, the triple clamps, clip-ons, mirrors, fender
  const fork = new THREE.Group();
  fork.position.set(0, 0.95, 0.48);
  // rake: the steering axis leans back ~22°
  const rake = Math.atan2(0.72 - 0.48, 0.95 - 0.31);
  fork.rotation.x = -rake;
  const forkLen = Math.hypot(0.72 - 0.48, 0.95 - 0.31);
  add(fork);
  for (const sg of [1, -1]) {
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, forkLen * 0.55, 14), MAT.gloss());
    outer.position.set(sg * 0.1, -forkLen * 0.28, 0);
    fork.add(outer);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, forkLen * 0.5, 14), MAT.chrome());
    inner.position.set(sg * 0.1, -forkLen * 0.72, 0);
    fork.add(inner);
    // clip-on bars
    const bar = limb(V(sg * 0.1, 0.03, -0.04), V(sg * 0.33, 0.0, -0.1), 0.014, black);
    fork.add(bar);
    const grip = limb(V(sg * 0.25, 0.012, -0.08), V(sg * 0.34, 0.0, -0.1), 0.019, MAT.rubber());
    fork.add(grip);
  }
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.08), alu);
  clamp.position.set(0, 0.0, 0);
  fork.add(clamp);
  // mirrors on the fairing
  for (const sg of [1, -1]) {
    const arm = limb(V(sg * 0.2, 1.0, 0.62), V(sg * 0.3, 1.06, 0.58), 0.008, black);
    add(arm);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), paint);
    mir.position.set(sg * 0.31, 1.06, 0.58);
    add(mir);
  }
  // ---- wheels (the front one rides the forks' steer)
  const front = makeWheel({ radius: 0.31, width: 0.12, rim: 0.215, style: 'spoke5', rimMat: MAT.rimDark(), caliper: MAT.caliperRed() }, 1);
  front.steer.position.set(0, 0.31, 0.72);
  lean.add(front.steer);
  const fender = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.05, 6, 20, 1.3), paint);
  fender.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.25);
  fender.scale.set(1, 1, 0.6);
  front.steer.add(fender);
  const rear = makeWheel({ radius: 0.315, width: 0.19, rim: 0.215, style: 'spoke5', rimMat: MAT.rimDark(), caliper: MAT.caliperGrey() }, 1);
  rear.steer.position.set(0, 0.315, -0.72);
  lean.add(rear.steer);
  // ---- the rider: leathers, boots, gloves, a helmet with a mirrored visor — tucked
  const rider = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.55, metalness: 0.08 });
  const accent = paintMaterial(color, 0.4, 0.3);
  const hip = V(0, 0.98, -0.3);
  const chest = V(0, 1.2, 0.08);
  const neck = V(0, 1.26, 0.2);
  const torso = limb(hip, chest, 0.15, leather);
  torso.scale.set(1.15, 1, 0.85);
  rider.add(torso);
  rider.add(limb(chest, neck, 0.06, leather));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 14), accent);
  helmet.scale.set(0.95, 0.95, 1.12);
  helmet.position.set(0, 1.34, 0.26);
  rider.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.138, 20, 10, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.35, 0.55), MAT.glassGold());
  visor.scale.copy(helmet.scale);
  visor.position.copy(helmet.position);
  rider.add(visor);
  // a hump on the back of the leathers
  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), accent);
  hump.scale.set(1, 0.7, 1.4);
  hump.position.set(0, 1.27, 0.0);
  rider.add(hump);
  for (const sg of [1, -1]) {
    const sh = V(sg * 0.17, 1.2, 0.1);
    const elbow = V(sg * 0.22, 1.02, 0.26);
    const hand = V(sg * 0.3, 1.0, 0.39);
    rider.add(limb(sh, elbow, 0.05, leather));
    rider.add(limb(elbow, hand, 0.045, leather));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), MAT.blackTrim());
    glove.position.copy(hand);
    rider.add(glove);
    const h = V(sg * 0.11, 0.98, -0.28);
    const knee = V(sg * 0.22, 0.82, 0.04);
    const ankle = V(sg * 0.2, 0.5, -0.2);
    rider.add(limb(h, knee, 0.075, leather));
    rider.add(limb(knee, ankle, 0.055, leather));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.24), MAT.blackTrim());
    boot.position.set(sg * 0.2, 0.47, -0.16);
    boot.rotation.x = 0.2;
    rider.add(boot);
    // knee slider
    const slider = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.06), accent);
    slider.position.set(sg * 0.29, 0.82, 0.04);
    rider.add(slider);
  }
  rider.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  lean.add(rider);
  // fixed parts merged per material (the wheels, the forks and the rider move or hide)
  mergeStatic(rider, new Set());
  mergeStatic(fork, new Set());
  mergeStatic(lean, new Set<THREE.Object3D>([front.steer, rear.steer, fork, rider]));
  return { root, lean, front, rear, fork, rider, tail };
}

export class Motorbike implements Drivable {
  readonly kind = 'bike' as const;
  name = 'Superbike';
  readonly root: THREE.Group;
  readonly body = new CarBody(BIKE);
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  yaw = 0;
  occupied = false;
  impact = 0;
  health = 1;
  private model: ReturnType<typeof buildBike>;
  private leanA = 0;
  private wheelie = 0;

  constructor(color: THREE.ColorRepresentation = 0xc8102e) {
    this.model = buildBike(color);
    this.root = this.model.root;
    this.pos = this.body.pos;
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.body.place(x, y, z, yaw);
    this.sync(0, null);
  }

  drive(dt: number, pad: Pad | null, ctx: WorldCtx) {
    const b = this.body;
    b.stability = 1.6;
    b.step(dt, pad ? { throttle: pad.throttle, brake: pad.brake, steer: pad.steer, handbrake: pad.handbrake, thrust: 0 } : { throttle: 0, brake: 1, steer: 0, handbrake: false, thrust: 0 }, ctx.net, ctx.world);
    // nobody on it and barely moving: on its stand (the tyre model creeps at walking pace)
    if (!pad && Math.hypot(b.vx, b.vz) < 3) {
      b.vx = b.vz = 0;
      b.yawRate = 0;
    }
    this.impact = b.impact;
    if (this.impact > 6) this.health = Math.max(0, this.health - (this.impact - 6) * 0.02);
    this.yaw = b.yaw;
    this.vel.set(b.vx, b.vy, b.vz);
    this.sync(dt, pad);
  }

  private sync(dt: number, pad: Pad | null) {
    const b = this.body;
    const m = this.model;
    m.root.position.copy(b.pos);
    m.root.rotation.set(-b.groundPitch, b.yaw, 0, 'YXZ');
    // lean into the corner: tan(lean) = v·ω / g
    const v = b.vLong;
    const want = this.occupied || Math.abs(v) > 0.5 ? THREE.MathUtils.clamp(Math.atan((v * b.yawRate) / 9.81), -0.95, 0.95) : 0.22;
    this.leanA += (want - this.leanA) * Math.min(1, dt * 8);
    // a wheelie under hard throttle at low speed
    const wl = pad && pad.throttle > 0.9 && v > 3 && v < 22 ? 0.18 : 0;
    this.wheelie += (wl - this.wheelie) * Math.min(1, dt * 4);
    m.lean.rotation.set(-this.wheelie, 0, -this.leanA);
    m.lean.position.y = this.wheelie * 0.2;
    m.front.steer.rotation.y = b.steer * 0.8;
    m.fork.rotation.set(-Math.atan2(0.24, 0.64), b.steer * 0.8, 0, 'XYZ');
    m.front.spin.rotation.x = b.spin;
    m.rear.spin.rotation.x = b.spin;
    m.rider.visible = this.occupied;
    m.rider.rotation.x = Math.min(0.25, Math.abs(v) / 120);
    void dt;
  }

  subject(): CamSubject {
    return { pos: this.pos, yaw: this.yaw, vel: this.vel, body: this.model.lean, eye: new THREE.Vector3(0, 1.45, 0.1), size: 2.2, kind: 'bike' };
  }

  hud(): HudInfo {
    return { name: this.name, speed: Math.abs(this.body.vLong), gauges: [{ label: 'Damage', value: this.health, color: '#ffb547' }], gear: this.body.reverse ? 'R' : 'D', mode: this.wheelie > 0.1 ? 'WHEELIE' : undefined };
  }

  exitPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x + Math.cos(this.yaw) * 0.9, this.pos.y, this.pos.z - Math.sin(this.yaw) * 0.9);
  }
}
