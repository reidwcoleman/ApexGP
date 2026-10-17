import * as THREE from 'three';
import { loft, table, type Station } from './loft.ts';
import { MAT, mergeBasic, paintMaterial } from './parts.ts';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Drivable, HudInfo, WorldCtx } from './drivable.ts';
import { makeSurf } from '../roads.ts';
import { WATER_Y } from '../geo.ts';
import type { Contact, Solid } from '../sim/collide.ts';

/**
 * A light single-engine helicopter (the Bell 407 / AS350 class Miami's news, police and tour
 * operators fly): a glass-nosed pod, a tapering boom with a fin and stabiliser, a tail rotor,
 * skids, a four-blade main rotor with a blur disc at speed.
 *
 * Flight is assisted (it's a game, not a sim): Space / X collective up / down (it holds its height
 * with neither), W/S cyclic forward / back (it tips and goes), Q/E sideways, A/D pedals. The rotor
 * spools up for a few seconds before it lifts. Lands on any flat roof, deck or street.
 */

export type HeliLivery = 'police' | 'news' | 'private';

export function buildHeli(livery: HeliLivery) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const col = livery === 'police' ? 0x16233f : livery === 'news' ? 0xf1f1ee : 0x111214;
  const paint = paintMaterial(col, 0.4, 0.3);
  const stripe = paintMaterial(livery === 'police' ? 0xf2f2f2 : livery === 'news' ? 0xc8102e : 0xc9a24a, 0.4, 0.3);
  // fuselage: nose (+z) glass bubble, cabin, the boom
  const len = table([[2.6, 0.05], [2.3, 0.55], [1.6, 0.78], [0.4, 0.82], [-0.6, 0.8], [-1.3, 0.55], [-1.9, 0.22], [-2.2, 0.16]]);
  const top = table([[2.6, 1.15], [2.3, 1.5], [1.8, 1.98], [1.2, 2.18], [0, 2.25], [-1.0, 2.2], [-1.6, 1.85], [-2.2, 1.55]]);
  const bot = table([[2.6, 1.05], [2.3, 0.75], [1.6, 0.62], [0, 0.6], [-1.2, 0.7], [-1.9, 1.2], [-2.2, 1.38]]);
  const st: Station[] = [];
  for (let k = 0; k <= 40; k++) {
    const z = 2.6 - (k / 40) * 4.8;
    const w = len(z), yt = top(z), yb = bot(z);
    const mid = (yt + yb) / 2;
    st.push({
      z,
      bands: [
        { pts: [[0, yb], [w * 0.6, yb + 0.05], [w * 0.95, yb + (mid - yb) * 0.45]] },
        { pts: [[w * 0.95, yb + (mid - yb) * 0.45], [w, mid], [w * 0.92, mid + (yt - mid) * 0.55]] },
        { pts: [[w * 0.92, mid + (yt - mid) * 0.55], [w * 0.6, yt - 0.04], [0, yt]] },
      ],
    });
  }
  const L0 = loft({
    stations: st,
    slot(b, z, y) {
      if (z > 1.25 && (b === 2 || (b === 1 && y > 1.15))) return 'glass';
      if (b === 1 && z > -0.9 && z < 0.9 && y > 1.2) return 'glass';
      if (b === 1 && y < 1.15 && y > 0.95) return 'stripe';
      return 'paint';
    },
    capRear: 'paint',
  });
  const mats: Record<string, THREE.Material> = { paint, glass: MAT.glassDark(), stripe };
  for (const [k, g] of L0.slots) {
    const m = new THREE.Mesh(g, mats[k] ?? paint);
    m.castShadow = true;
    body.add(m);
  }
  // the boom, the fin, the stabiliser
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 4.4, 12), paint);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 1.55, -4.3);
  boom.castShadow = true;
  body.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.7), paint);
  fin.position.set(0, 2.05, -6.35);
  fin.rotation.x = -0.35;
  body.add(fin);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.45), paint);
  stab.position.set(0, 1.6, -5.4);
  body.add(stab);
  // skids
  const skidParts: THREE.BufferGeometry[] = [];
  for (const sg of [1, -1]) {
    const tube = new THREE.CylinderGeometry(0.045, 0.045, 3.1, 8);
    tube.rotateX(Math.PI / 2);
    tube.translate(sg * 1.05, 0.05, 0.2);
    skidParts.push(tube);
    for (const z of [0.9, -0.6]) {
      const leg = new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6);
      leg.rotateZ(sg * 0.5);
      leg.translate(sg * 0.85, 0.38, z);
      skidParts.push(leg);
    }
  }
  const skids = new THREE.Mesh(mergeBasic(skidParts), MAT.rimSteel());
  skids.castShadow = true;
  body.add(skids);
  // the rotor
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.55, 0.1);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.35, 10), MAT.blackTrim());
  mast.position.y = -0.15;
  rotor.add(mast);
  const blades: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 5.3), MAT.blackTrim());
    b.geometry.translate(0, 0, 2.7);
    b.rotation.y = (i / 4) * Math.PI * 2;
    b.castShadow = true;
    rotor.add(b);
    blades.push(b);
  }
  const discMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.4, 48), discMat);
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  body.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(0.12, 1.85, -6.35);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 0.12), MAT.blackTrim());
    b.rotation.x = i * Math.PI;
    b.geometry.translate(0, 0.6, 0);
    tail.add(b);
  }
  body.add(tail);
  // the police searchlight / anti-collision beacons
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  beacon.position.set(0, 2.3, -1.2);
  body.add(beacon);
  return { root, body, rotor, tail, blades, disc, discMat, beacon };
}

const G = 9.81;

export class Helicopter implements Drivable {
  readonly kind = 'heli' as const;
  name: string;
  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  occupied = false;
  impact = 0;
  health = 1;
  police: boolean;
  private model: ReturnType<typeof buildHeli>;
  readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private rates = new THREE.Vector3();
  /** 0..1 rotor speed */
  rpm = 0;
  private rotorAngle = 0;
  grounded = true;
  fuel = 1;
  private surf = makeSurf();
  private contacts: Contact[] = [];
  private near: Solid[] = [];
  /** AI target (the police helicopter follows) */
  aiTarget: THREE.Vector3 | null = null;
  private t = 0;

  constructor(livery: HeliLivery) {
    this.model = buildHeli(livery);
    this.root = this.model.root;
    this.police = livery === 'police';
    this.name = livery === 'police' ? 'Miami PD Helicopter' : livery === 'news' ? 'News Helicopter' : 'Helicopter';
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.e.set(0, yaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.sync(0);
  }

  drive(dt: number, pad: Pad | null, ctx: WorldCtx) {
    this.t += dt;
    this.impact = 0;
    const engine = this.occupied || !!this.aiTarget;
    this.rpm += ((engine ? 1 : 0) - this.rpm) * Math.min(1, dt * (engine ? 0.35 : 0.2));
    let up = pad?.up ? 1 : 0, down = pad?.down ? 1 : 0, fwd = pad ? pad.moveY : 0, side = pad ? (pad.rollR ? 1 : 0) - (pad.rollL ? 1 : 0) : 0;
    const yawIn = pad ? pad.steer : 0;
    // the police helicopter's autopilot: hold 70 m over the target, a little behind
    let yawWant = yawIn * 1.2;
    if (this.aiTarget && !pad) {
      const T = this.aiTarget;
      const dx = T.x - this.pos.x, dz = T.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const wantY = T.y + 70;
      up = this.pos.y < wantY - 3 ? 1 : 0;
      down = this.pos.y > wantY + 6 ? 1 : 0;
      const hd = Math.atan2(dx, dz);
      const err = Math.atan2(Math.sin(hd - this.yaw), Math.cos(hd - this.yaw));
      yawWant = THREE.MathUtils.clamp(err * 1.5, -0.8, 0.8);
      fwd = THREE.MathUtils.clamp((d - 40) / 80, -0.6, 1) * (Math.abs(err) < 1 ? 1 : 0.2);
      side = 0;
    }
    const lift = this.rpm > 0.9 ? 1 : 0;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.e.setFromQuaternion(this.q, 'YXZ');
      const tp = fwd * 0.34, tr = side * 0.32;
      this.rates.x += (7 * (tp - this.e.x) - 3.8 * this.rates.x) * h;
      this.rates.z += (7 * (tr - this.e.z) - 3.8 * this.rates.z) * h;
      this.rates.y += (3 * (yawWant - this.rates.y)) * h;
      if (this.grounded) this.rates.set(0, this.rpm > 0.95 ? this.rates.y * 0.2 : 0, 0);
      this.e.set(this.e.x + this.rates.x * h, this.e.y + this.rates.y * h, this.e.z + this.rates.z * h, 'YXZ');
      this.q.setFromEuler(this.e);
      const tilt = Math.max(0.6, Math.cos(this.e.x) * Math.cos(this.e.z));
      let T = (1 + 0.7 * up - 0.65 * down) / tilt;
      if (!up && !down) T += -this.vel.y * 0.4;
      T *= lift * this.rpm;
      const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
      const F = upV.multiplyScalar(T * G);
      F.y -= G;
      const sp = this.vel.length();
      F.addScaledVector(this.vel, -0.035 * sp);
      F.y -= 0.12 * Math.abs(this.vel.y) * this.vel.y;
      this.vel.addScaledVector(F, h);
      if (this.grounded && this.vel.y < 0) this.vel.y = 0;
      this.pos.addScaledVector(this.vel, h);
      // the ground, roofs, decks, water
      const s = ctx.net.surface(this.pos.x, this.pos.z, this.pos.y + 0.5, this.surf);
      let gy = s.water ? WATER_Y - 0.5 : s.y;
      for (const so of ctx.world.query(this.pos.x, this.pos.z, 2, this.near)) {
        if (so.circle !== undefined || so.y1 > this.pos.y + 1 || so.kind !== 'building') continue;
        if (inPoly(this.pos.x, this.pos.z, so.poly)) gy = Math.max(gy, so.y1);
      }
      if (this.pos.y <= gy) {
        if (this.vel.y < -4) this.impact = Math.max(this.impact, -this.vel.y);
        this.pos.y = gy;
        this.vel.y = Math.max(0, this.vel.y);
        this.vel.x *= 0.9;
        this.vel.z *= 0.9;
        this.grounded = !(up && this.rpm > 0.9);
        if (s.water && gy < WATER_Y) this.health = Math.max(0, this.health - h * 0.5);
      } else if (this.pos.y > gy + 0.3) this.grounded = false;
      // walls (the rotor disc as a circle)
      for (const c of ctx.world.circleContacts(this.pos.x, this.pos.z, 5, this.pos.y + 1.5, this.contacts)) {
        if (c.solid.kind !== 'building') continue;
        this.pos.x += c.nx * c.depth;
        this.pos.z += c.nz * c.depth;
        const vn = this.vel.x * c.nx + this.vel.z * c.nz;
        if (vn < 0) {
          this.impact = Math.max(this.impact, -vn);
          this.vel.x -= 1.5 * vn * c.nx;
          this.vel.z -= 1.5 * vn * c.nz;
          this.health = Math.max(0, this.health + vn * 0.02);
        }
      }
    }
    this.e.setFromQuaternion(this.q, 'YXZ');
    this.yaw = this.e.y;
    this.sync(dt);
  }

  private sync(dt: number) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.quaternion.copy(this.q);
    this.rotorAngle += this.rpm * 44 * dt;
    m.rotor.rotation.y = this.rotorAngle;
    m.tail.rotation.x = this.rotorAngle * 2.3;
    // at speed the blades blur into a disc
    m.discMat.opacity = THREE.MathUtils.smoothstep(this.rpm, 0.5, 1) * 0.12;
    for (const b of m.blades) b.visible = this.rpm < 0.85 || Math.floor(this.t * 60) % 2 === 0;
    (m.beacon.material as THREE.MeshBasicMaterial).color.setScalar(Math.floor(this.t * 1.5) % 2 ? 0.2 : 6).multiply(new THREE.Color(1, 0.1, 0.1));
  }

  subject(): CamSubject {
    return { pos: this.pos, yaw: this.yaw, vel: this.vel, quat: this.q, body: this.model.body, eye: new THREE.Vector3(0.4, 1.75, 1.3), size: 11, kind: 'flight' };
  }

  hud(): HudInfo {
    return {
      name: this.name,
      speed: this.vel.length(),
      gauges: [
        { label: 'Rotor', value: this.rpm, color: '#57e8ff' },
        { label: 'Fuel', value: this.fuel, color: '#ffb547' },
      ],
      altitude: this.pos.y,
      mode: this.rpm < 0.9 && this.occupied ? 'SPOOLING' : undefined,
      gear: this.grounded ? 'G' : 'H',
    };
  }

  exitPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x + Math.cos(this.yaw) * 2.2, this.pos.y, this.pos.z - Math.sin(this.yaw) * 2.2);
  }
}

function inPoly(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export { inPoly };
