import * as THREE from 'three';
import { loft, table, type Station } from './loft.ts';
import { MAT, mergeBasic, paintMaterial } from './parts.ts';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Drivable, HudInfo, WorldCtx } from './drivable.ts';
import { makeSurf } from '../roads.ts';
import { WATER_Y } from '../geo.ts';
import type { Contact } from '../sim/collide.ts';

/**
 * An amphibious single-engine turboprop on floats (the Cessna Caravan amphibian class that has
 * flown from the Watson Island seaplane base for decades): high strut-braced wing, three-blade
 * prop, two long floats. It sits on the bay at Watson Island.
 *
 * Flying: Shift / X throttle up / down, W/S pitch (S pulls up), A/D roll, Q/E rudder. Lift goes
 * with the square of the airspeed and the angle of attack; past ~16° it stalls. On the water the
 * floats drag until it's up on the step (~25 m/s), then it lifts off at ~32 m/s.
 */

export function buildSeaplane() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const white = paintMaterial(0xf3f3f0, 0.2, 0.32);
  const blue = paintMaterial(0x1f4fa8, 0.3, 0.3);
  const red = paintMaterial(0xd2202a, 0.3, 0.3);
  // fuselage on stations along z (nose +z)
  const hw = table([[5.6, 0.05], [5.3, 0.42], [4.6, 0.68], [3.0, 0.78], [0.5, 0.78], [-1.5, 0.62], [-3.5, 0.32], [-5.4, 0.12]]);
  const top = table([[5.6, 2.55], [5.3, 2.85], [4.6, 3.05], [3.6, 3.5], [3.0, 3.72], [0.5, 3.78], [-1.5, 3.55], [-3.5, 3.25], [-5.4, 3.05]]);
  const bot = table([[5.6, 2.45], [5.3, 2.1], [4.6, 1.95], [3.0, 1.9], [0.5, 1.95], [-1.5, 2.35], [-3.5, 2.8], [-5.4, 2.95]]);
  const st: Station[] = [];
  for (let k = 0; k <= 44; k++) {
    const z = 5.6 - (k / 44) * 11;
    const w = hw(z), yt = top(z), yb = bot(z), mid = (yt + yb) / 2;
    st.push({
      z,
      bands: [
        { pts: [[0, yb], [w * 0.7, yb + 0.04], [w, yb + (mid - yb) * 0.6]] },
        { pts: [[w, yb + (mid - yb) * 0.6], [w * 1.01, mid], [w * 0.95, mid + (yt - mid) * 0.5]] },
        { pts: [[w * 0.95, mid + (yt - mid) * 0.5], [w * 0.6, yt - 0.04], [0, yt]] },
      ],
    });
  }
  const L0 = loft({
    stations: st,
    slot(b, z, y) {
      if (b === 1 && y > 2.95 && z < 3.4 && z > -1.2) return 'glass';
      if (b === 2 && z > 3.0 && z < 3.75 && y > 3.0) return 'glass';
      if (b === 1 && y < 2.55 && y > 2.3) return 'stripe';
      return 'paint';
    },
    capFront: 'paint',
    capRear: 'paint',
  });
  const mats: Record<string, THREE.Material> = { paint: white, glass: MAT.glassDark(), stripe: blue };
  for (const [k, g] of L0.slots) {
    const m = new THREE.Mesh(g, mats[k] ?? white);
    m.castShadow = true;
    body.add(m);
  }
  // the high wing (16 m), its struts, the tail
  const wing = new THREE.Mesh(new THREE.BoxGeometry(15.9, 0.18, 1.95), white);
  wing.position.set(0, 3.86, 1.6);
  wing.castShadow = true;
  body.add(wing);
  for (const sg of [1, -1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.19, 1.95), red);
    tip.position.set(sg * 8.0, 3.86, 1.6);
    body.add(tip);
  }
  const struts: THREE.BufferGeometry[] = [];
  for (const sg of [1, -1]) {
    const s = new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6);
    s.rotateZ(sg * 1.1);
    s.translate(sg * 2.6, 2.95, 1.5);
    struts.push(s);
  }
  body.add(new THREE.Mesh(mergeBasic(struts), white));
  const stab = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.1, 1.3), white);
  stab.position.set(0, 3.15, -4.9);
  body.add(stab);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 1.6), blue);
  fin.position.set(0, 4.1, -5.0);
  fin.rotation.x = -0.3;
  body.add(fin);
  // the floats
  const fw = table([[3.2, 0.02], [2.6, 0.32], [1.0, 0.42], [-2.5, 0.34], [-5.0, 0.08]]);
  for (const sg of [1, -1]) {
    const fs: Station[] = [];
    for (let k = 0; k <= 30; k++) {
      const z = 3.2 - (k / 30) * 8.2;
      const w = fw(z);
      const yb = z > 2.3 ? 0.35 - (2.3 - z) * 0.3 * 0 + (z - 2.3) * 0.35 : 0.2 + Math.max(0, -z - 2.5) * 0.05;
      const yt = 0.85 - Math.max(0, -z - 3) * 0.08;
      fs.push({ z, bands: [{ pts: [[0, yb], [w * 0.95, yb + 0.15], [w, (yb + yt) / 2], [w * 0.7, yt], [0, yt + 0.02]] }] });
    }
    const F = loft({ stations: fs, slot: () => 'float', capRear: 'float' });
    for (const [, g] of F.slots) {
      const m = new THREE.Mesh(g, white);
      m.position.x = sg * 1.45;
      m.castShadow = true;
      body.add(m);
    }
    for (const z of [2.0, -1.0]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), MAT.rimSteel());
      s.position.set(sg * 1.0, 1.4, z);
      s.rotation.z = sg * 0.45;
      body.add(s);
    }
  }
  // the propeller
  const prop = new THREE.Group();
  prop.position.set(0, 2.5, 5.68);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 16), MAT.blackTrim());
  spinner.rotation.x = Math.PI / 2;
  prop.add(spinner);
  const blades: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 0.04), MAT.blackTrim());
    b.geometry.translate(0, 0.65, 0);
    b.rotation.z = (i / 3) * Math.PI * 2;
    prop.add(b);
    blades.push(b);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.32, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);
  body.add(prop);
  return { root, body, prop, blades, disc };
}

const G = 9.81;

export class Seaplane implements Drivable {
  readonly kind = 'plane' as const;
  name = 'Seaplane';
  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  occupied = false;
  impact = 0;
  health = 1;
  private model: ReturnType<typeof buildSeaplane>;
  readonly q = new THREE.Quaternion();
  private w = new THREE.Vector3();
  throttle = 0;
  private propAngle = 0;
  onWater = true;
  private surf = makeSurf();
  private contacts: Contact[] = [];
  stall = false;
  private readonly mass = 3600;

  constructor() {
    this.model = buildSeaplane();
    this.root = this.model.root;
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.sync(0);
  }

  drive(dt: number, pad: Pad | null, ctx: WorldCtx) {
    this.impact = 0;
    if (pad) {
      if (pad.boost) this.throttle = Math.min(1, this.throttle + dt * 0.5);
      if (pad.down) this.throttle = Math.max(0, this.throttle - dt * 0.6);
      if (pad.throttle > 0.05) this.throttle = Math.max(this.throttle, pad.throttle);
    } else this.throttle = Math.max(0, this.throttle - dt * 0.5);
    const pitchIn = pad ? -pad.moveY : 0; // S pulls up
    const rollIn = pad ? pad.steer : 0;
    const yawIn = pad ? (pad.rollL ? 1 : 0) - (pad.rollR ? 1 : 0) : 0;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    const m = this.mass;
    for (let i = 0; i < n; i++) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
      const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.q);
      const v = this.vel.length();
      const q = 0.5 * 1.2 * v * v;
      // angle of attack: the airflow's angle under the nose
      const vf = this.vel.dot(fwd), vu = this.vel.dot(up);
      const aoa = v > 2 ? Math.atan2(-vu, Math.max(vf, 0.1)) : 0;
      const stalled = Math.abs(aoa) > 0.28;
      this.stall = stalled && v > 10 && !this.onWater;
      const cl = stalled ? 0.55 * Math.sign(aoa) : 0.32 + aoa * 5.2;
      const S = 26;
      const liftDir = v > 1 ? new THREE.Vector3().crossVectors(this.vel, right).normalize().multiplyScalar(-1) : up.clone();
      if (liftDir.dot(up) < 0) liftDir.negate();
      const F = new THREE.Vector3();
      F.addScaledVector(liftDir, q * S * cl * (v > 3 ? 1 : 0));
      const cd = 0.035 + 0.045 * cl * cl;
      if (v > 0.01) F.addScaledVector(this.vel, (-q * S * cd) / v);
      // sideslip: the fin straightens it out
      const vr = this.vel.dot(right);
      F.addScaledVector(right, -vr * v * 2.5);
      F.addScaledVector(fwd, this.throttle * 14500);
      F.y -= m * G;
      // ---- the water: floats buoyant, draggy until on the step
      const s = ctx.net.surface(this.pos.x, this.pos.z, this.pos.y + 1, this.surf);
      const ground = s.water ? WATER_Y + 0.05 : s.y;
      this.onWater = false;
      if (this.pos.y <= ground + 0.05) {
        this.onWater = s.water;
        const sink = ground + 0.05 - this.pos.y;
        F.y += m * G * Math.min(2, 0.6 + sink * 3) - this.vel.y * m * 2;
        const stepK = s.water ? THREE.MathUtils.lerp(0.9, 0.12, THREE.MathUtils.smoothstep(vf, 8, 24)) : 0.08;
        F.addScaledVector(fwd, -vf * m * stepK * 0.12);
        F.addScaledVector(right, -vr * m * 2.5);
        if (!s.water && Math.abs(vf) < 0.5 && this.throttle < 0.05) this.vel.multiplyScalar(0.9);
      }
      this.vel.addScaledVector(F, h / m);
      this.pos.addScaledVector(this.vel, h);
      if (this.pos.y < ground - 0.3) this.pos.y = ground - 0.3;
      // ---- attitude: control surfaces work with airspeed (and the water rudder at taxi speed)
      const auth = THREE.MathUtils.clamp(v / 30, 0, 1.4);
      const e = new THREE.Euler().setFromQuaternion(this.q, 'YXZ');
      const onW = this.onWater || this.pos.y <= ground + 0.2;
      this.w.x += ((pitchIn * 0.9 * auth - this.w.x) * 3 + (onW ? e.x * 6 : 0) - (stalled ? 0.6 : 0)) * h;
      this.w.z += ((rollIn * 1.4 * auth - this.w.z) * 3 + (onW ? e.z * 8 : 0)) * h;
      // the nose follows the turn (a banked plane yaws into it)
      this.w.y += ((yawIn * 0.5 + (onW ? rollIn * 0.5 * THREE.MathUtils.clamp(vf / 8, -1, 1) : -Math.sin(e.z) * auth * 0.9) - this.w.y) * 3) * h;
      const qd = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.w.x * h, this.w.y * h, -this.w.z * h, 'YXZ'));
      // body-frame rotation: apply in local space
      this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.w.x * h));
      this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.w.z * h));
      this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.w.y * h));
      this.q.normalize();
      void qd;
      // velocity follows the nose a little (weathervane)
      if (v > 5 && !onW) {
        const nf = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
        this.vel.lerp(nf.multiplyScalar(v), Math.min(1, h * 0.8));
      }
      // ---- buildings
      for (const c of ctx.world.circleContacts(this.pos.x, this.pos.z, 4, this.pos.y + 2.5, this.contacts)) {
        if (c.solid.kind !== 'building') continue;
        this.pos.x += c.nx * c.depth;
        this.pos.z += c.nz * c.depth;
        const vn = this.vel.x * c.nx + this.vel.z * c.nz;
        if (vn < 0) {
          this.impact = Math.max(this.impact, -vn);
          this.vel.x -= 1.4 * vn * c.nx;
          this.vel.z -= 1.4 * vn * c.nz;
          this.health = Math.max(0, this.health + vn * 0.015);
        }
      }
    }
    this.yaw = new THREE.Euler().setFromQuaternion(this.q, 'YXZ').y;
    this.sync(dt);
  }

  private sync(dt: number) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.quaternion.copy(this.q);
    this.propAngle += (5 + this.throttle * 60) * dt * (this.occupied ? 1 : 0);
    m.prop.rotation.z = this.propAngle;
    (m.disc.material as THREE.MeshBasicMaterial).opacity = this.occupied ? 0.05 + this.throttle * 0.12 : 0;
  }

  subject(): CamSubject {
    return { pos: this.pos, yaw: this.yaw, vel: this.vel, quat: this.q, body: this.model.body, eye: new THREE.Vector3(0.35, 3.3, 3.4), size: 16, kind: 'plane' };
  }

  hud(): HudInfo {
    return {
      name: this.name,
      speed: this.vel.length(),
      gauges: [{ label: 'Throttle', value: this.throttle, color: '#57e8ff' }],
      altitude: this.pos.y,
      mode: this.stall ? 'STALL' : this.onWater ? 'ON WATER' : undefined,
      gear: '',
    };
  }

  exitPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x + Math.cos(this.yaw) * 2.6, this.pos.y + 0.6, this.pos.z - Math.sin(this.yaw) * 2.6);
  }
}
