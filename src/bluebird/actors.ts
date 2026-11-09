// Bluebird: you. A skier (carving, tucking, popping off kickers, spins and flips, wipeouts), a snowcat
// that grooms real corduroy behind its tiller, and a snowmobile for patrol, repairs and snow guns.
import * as THREE from 'three';
import { Mountain } from './mountain.ts';
import type { World } from './world.ts';
import type { Sim } from './sim.ts';
import type { Lift, Rider } from './lifts.ts';
import { skierGeo } from './people.ts';
import { SNOWCAT, SLED } from './data.ts';

export interface Controls { up: number; down: number; left: number; right: number; jump: boolean; jumpHeld: boolean; grab: boolean; act: boolean }

const G = 9.81;
const tmpN = { x: 0, y: 1, z: 0 };
const wrapPi = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

/** snow under a point: 0..1 groom, powder, chop */
function surface(sim: Sim, x: number, z: number) {
  const k = sim.m.cellAt(x, z);
  if (k < 0) return { groom: 0, powder: 0.5, chop: 0, depth: 80 };
  const groom = sim.groom[k], powder = sim.powder[k];
  const chop = sim.m.runCell[k] ? Math.max(0, 1 - Math.max(groom, powder)) : 0.15 * (1 - powder);
  return { groom, powder, chop, depth: sim.depth[k] };
}

// =========================================================================== skier
export type TrickEvent = { name: string; score: number; clean: boolean };

export class Skier implements Rider {
  group = new THREE.Group();
  body = new THREE.Group();
  p = new THREE.Vector3();
  v = new THREE.Vector3();
  yaw = 0; // where the skis point
  air = false;
  airT = 0;
  spin = 0; // accumulated yaw in the air
  spinRate = 0;
  flip = 0;
  flipRate = 0;
  grabT = 0;
  crashT = 0;
  tuck = 0;
  edge = 0; // -1..1 carve lean
  brake = 0;
  lift: Lift | null = null;
  chair = -1; seat = 0;
  queued = false;
  onTrick: ((t: TrickEvent) => void) | null = null;
  onCrash: ((why: string) => void) | null = null;
  onLand: ((impact: number) => void) | null = null;
  onUnload: ((l: Lift) => void) | null = null;
  speed = 0;
  surf = { groom: 0, powder: 0, chop: 0, depth: 0 };
  trackT = 0;
  headlamp: THREE.SpotLight;
  private n = new THREE.Vector3(0, 1, 0);
  private crashSpin = new THREE.Vector3();
  private bodyRest: THREE.Mesh;
  private sitMesh: THREE.Group;

  constructor(private w: World, private m: Mountain, private sim: Sim) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
    const jm = new THREE.MeshStandardMaterial({ color: 0xffcf3f, roughness: 0.55 });
    const g = skierGeo('ski');
    const jacket = new THREE.Mesh(g.jacket, jm);
    this.bodyRest = new THREE.Mesh(g.rest, mat);
    this.body.add(jacket, this.bodyRest);
    const s = skierGeo('sit');
    this.sitMesh = new THREE.Group();
    this.sitMesh.add(new THREE.Mesh(s.jacket, jm), new THREE.Mesh(s.rest, mat));
    this.sitMesh.visible = false;
    this.group.add(this.body, this.sitMesh);
    this.group.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
    this.headlamp = new THREE.SpotLight(0xfff1d6, 0, 70, 0.55, 0.6, 1.4);
    this.headlamp.position.set(0, 1.75, 0.2);
    this.headlamp.target.position.set(0, 0, 14);
    this.body.add(this.headlamp, this.headlamp.target);
    w.scene.add(this.group);
    this.group.visible = false;
  }

  place(x: number, z: number, yaw: number) {
    this.p.set(x, this.m.ground(x, z), z);
    this.v.set(0, 0, 0);
    this.yaw = yaw;
    this.air = false; this.crashT = 0; this.spin = 0; this.flip = 0; this.vyG = 0;
  }

  // rider callbacks
  boarded(l: Lift, chair: number, seat: number) { this.lift = l; this.chair = chair; this.seat = seat; this.queued = false; }
  unload(l: Lift) {
    this.lift = null; this.chair = -1;
    this.place(l.unloadPt.x + l.dir.x * 2, l.unloadPt.z + l.dir.y * 2, Math.atan2(l.dir.x, l.dir.y));
    this.v.set(l.dir.x * 4, 0, l.dir.y * 4);
    this.onUnload?.(l);
  }
  get riding() { return !!this.lift || this.queued; }

  update(dt: number, c: Controls) {
    const m = this.m;
    if (this.lift && this.chair >= 0) {
      const f = new THREE.Vector3();
      this.lift.seatPos(this.chair, this.seat, this.p, f);
      this.yaw = Math.atan2(f.x, f.z);
      this.v.set(0, 0, 0);
      this.sitMesh.visible = !this.lift.isCarpet;
      this.body.visible = this.lift.isCarpet;
      this.draw(dt);
      return;
    }
    this.sitMesh.visible = false;
    this.body.visible = true;
    if (this.queued) { this.v.multiplyScalar(Math.exp(-dt * 6)); this.p.addScaledVector(this.v, dt); this.p.y = m.ground(this.p.x, this.p.z); this.draw(dt); return; }

    if (this.crashT > 0) {
      this.crashT -= dt;
      // slide to a stop, tumbling
      this.v.multiplyScalar(Math.exp(-dt * 2.2));
      this.v.y -= G * dt;
      this.p.addScaledVector(this.v, dt);
      const gh = m.ground(this.p.x, this.p.z);
      if (this.p.y < gh) { this.p.y = gh; this.v.y = Math.max(0, this.v.y); }
      if (this.crashT <= 0) {
        // stand back up facing down the fall line
        m.normal(this.p.x, this.p.z, tmpN);
        this.yaw = Math.atan2(tmpN.x, tmpN.z);
        this.v.set(0, 0, 0);
        this.spin = this.flip = 0;
      }
      this.draw(dt);
      return;
    }

    const steer = c.right - c.left;
    if (!this.air) this.groundStep(dt, c, steer);
    else this.airStep(dt, c, steer);
    this.speed = Math.hypot(this.v.x, this.v.z);

    // trees
    const hit = this.w.treeHit(this.p.x, this.p.z, 0.45);
    if (hit && this.p.y < m.ground(this.p.x, this.p.z) + 3) {
      if (this.speed > 7) this.crash('Tree!');
      else { const dx = this.p.x - hit.x, dz = this.p.z - hit.z, d = Math.hypot(dx, dz) || 1; this.p.x = hit.x + (dx / d) * 1.2; this.p.z = hit.z + (dz / d) * 1.2; this.v.multiplyScalar(0.3); }
    }
    // the playable square
    const lim = 790;
    if (Math.abs(this.p.x) > lim || Math.abs(this.p.z) > lim) { this.p.x = Math.max(-lim, Math.min(lim, this.p.x)); this.p.z = Math.max(-lim, Math.min(lim, this.p.z)); this.v.multiplyScalar(0.5); }

    this.trackT -= dt;
    if (this.trackT < 0 && !this.air && this.speed > 2) { this.trackT = 0.05; this.sim.track(this.p.x, this.p.z, 0.02); }
    this.draw(dt);
  }

  private groundStep(dt: number, c: Controls, steer: number) {
    const m = this.m, sim = this.sim;
    m.normal(this.p.x, this.p.z, tmpN);
    const n = this.n.set(tmpN.x, tmpN.y, tmpN.z);
    const s = (this.surf = surface(sim, this.p.x, this.p.z));
    // ski frame on the slope
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const l = new THREE.Vector3().crossVectors(n, f);
    this.v.addScaledVector(n, -this.v.dot(n));
    let vf = this.v.dot(f), vl = this.v.dot(l);
    const speed = this.v.length();
    this.tuck += ((c.up > 0 && speed > 4 ? 1 : 0) - this.tuck) * Math.min(1, dt * 6);
    this.brake += ((c.down > 0 ? 1 : 0) - this.brake) * Math.min(1, dt * 8);
    // turning: quicker when slow, less in a tuck, a little twitchy in chop
    const turnRate = (2.3 / (1 + speed * 0.028)) * (1 - this.tuck * 0.45) * (1 + this.brake * 0.6);
    this.yaw -= steer * turnRate * dt;
    if (s.chop > 0.3 && speed > 6) this.yaw += (Math.random() - 0.5) * s.chop * 0.06;
    this.edge += (steer * Math.min(1, speed / 10) - this.edge) * Math.min(1, dt * 7);
    // grip: carving holds the line; braking throws the skis sideways (hockey stop)
    const grip = (this.brake > 0.5 ? 2.4 : 8.5) * (0.65 + 0.35 * s.groom + 0.15 * (1 - s.chop));
    const vl2 = vl * Math.exp(-grip * dt);
    const lost = Math.abs(vl) - Math.abs(vl2);
    vf += Math.sign(vf || 1) * lost * (this.brake > 0.5 ? 0.1 : 0.82);
    vl = vl2;
    // snow friction + air drag
    const mu = 0.035 + s.chop * 0.045 + s.powder * (0.03 + 0.12 * Math.max(0, 1 - speed / 9)) + (s.depth < 18 ? 0.25 : 0);
    const drag = (0.0062 - this.tuck * 0.0028 + s.powder * 0.004) * speed * speed;
    let dec = mu * G * n.y + drag + this.brake * (5.5 + Math.abs(vf) * 0.25);
    // gravity along the slope
    const gt = new THREE.Vector3(0, -G, 0).addScaledVector(n, G * n.y);
    vf += gt.dot(f) * dt;
    vl += gt.dot(l) * dt * 0.35;
    // poling / skating on the flat
    if (c.up > 0 && Math.abs(vf) < 7) vf += 3.2 * dt;
    if (c.down > 0 && Math.abs(vf) < 1.2 && gt.dot(f) < 0.8) { vf *= Math.exp(-dt * 6); dec = 0; }
    const sgn = Math.sign(vf);
    vf -= sgn * Math.min(Math.abs(vf), dec * dt);
    this.v.copy(f).multiplyScalar(vf).addScaledVector(l, vl);
    // jump: pop off the snow with whatever the ground was already doing
    if (c.jump) { this.v.y = Math.max(this.vyG, 0) + 4.8; this.takeoff(); this.p.addScaledVector(this.v, dt); return; }
    // slide along, then see what the ground did under us: if it fell away faster than we were
    // rising/falling a moment ago (a kicker lip, a roller), we keep going and fly
    const y0 = this.p.y;
    this.p.x += this.v.x * dt; this.p.z += this.v.z * dt;
    const gh = m.ground(this.p.x, this.p.z);
    const rate = (gh - y0) / Math.max(1e-4, dt);
    const predicted = y0 + this.vyG * dt;
    if (predicted > gh + 0.03 && this.vyG - rate > 2.2 && speed > 5) {
      this.p.y = predicted;
      this.v.y = this.vyG;
      this.takeoff();
      return;
    }
    this.p.y = gh;
    this.vyG += (rate - this.vyG) * Math.min(1, dt * 30);
    this.airT = 0;
  }
  private vyG = 0;

  private takeoff() {
    this.air = true; this.airT = 0; this.spin = 0; this.flip = 0; this.spinRate = 0; this.flipRate = 0; this.grabT = 0;
  }

  private airStep(dt: number, c: Controls, steer: number) {
    const m = this.m;
    this.airT += dt;
    this.v.y -= G * dt;
    this.v.multiplyScalar(1 - 0.0008 * this.v.length() * dt);
    // spins and flips
    this.spinRate += (-steer * 7.2 - this.spinRate) * Math.min(1, dt * 6);
    const fl = c.up - c.down;
    this.flipRate += (fl * 5.4 - this.flipRate) * Math.min(1, dt * 5);
    if (this.airT < 0.12) { this.spinRate *= 0.5; this.flipRate *= 0.3; }
    this.spin += this.spinRate * dt;
    this.flip += this.flipRate * dt;
    this.yaw -= 0; // the heading of travel doesn't change in the air
    if (c.grab) this.grabT += dt;
    this.p.addScaledVector(this.v, dt);
    const gh = m.ground(this.p.x, this.p.z);
    if (this.p.y <= gh) {
      this.p.y = gh;
      this.land();
    }
  }

  private land() {
    const m = this.m;
    m.normal(this.p.x, this.p.z, tmpN);
    const n = this.n.set(tmpN.x, tmpN.y, tmpN.z);
    const impact = -this.v.dot(n);
    this.air = false;
    // how far round did we get?
    const travel = Math.atan2(this.v.x, this.v.z);
    const finalYaw = this.yaw + this.spin;
    let err = Math.abs(wrapPi(finalYaw - travel));
    const switchLand = err > Math.PI / 2;
    if (switchLand) err = Math.PI - err;
    const flipErr = Math.abs(wrapPi(this.flip));
    const hs = Math.abs(this.spin) / Math.PI;
    const halfSpins = switchLandGuess(this.yaw + this.spin, Math.atan2(this.v.x, this.v.z)) ? 2 * Math.round((hs - 1) / 2) + 1 : 2 * Math.round(hs / 2);
    const flips = Math.round(Math.abs(this.flip) / (Math.PI * 2));
    const big = this.airT > 0.5;
    if (err > 0.85 || flipErr > 0.9 || impact > 15) {
      this.v.multiplyScalar(0.6);
      this.crash(impact > 15 ? 'Flat landing' : flipErr > 0.9 ? 'Over-rotated' : 'Caught an edge');
      if (big && (halfSpins || flips)) this.onTrick?.({ name: trickName(halfSpins, flips, this.flip, this.grabT), score: 0, clean: false });
      return;
    }
    // clean: point the skis where we're going (switch is fine)
    this.yaw = switchLand ? travel + Math.PI : travel;
    this.v.addScaledVector(n, -this.v.dot(n));
    this.vyG = (-n.x * this.v.x - n.z * this.v.z) / Math.max(0.2, n.y);
    this.v.multiplyScalar(impact > 9 ? 0.82 : 0.96);
    this.spin = 0; this.flip = 0;
    this.onLand?.(impact);
    if (big && (halfSpins >= 1 || flips >= 1 || this.grabT > 0.25 || this.airT > 1.4)) {
      const score = Math.round(halfSpins * 180 + flips * 600 + Math.min(1.5, this.grabT) * 260 + Math.max(0, this.airT - 0.6) * 220) * (switchLand ? 1.2 : 1);
      this.onTrick?.({ name: trickName(halfSpins, flips, this.flip, this.grabT, switchLand, this.airT), score: Math.round(score), clean: true });
    }
  }

  crash(why: string) {
    if (this.crashT > 0) return;
    this.crashT = 1.7;
    this.air = false;
    this.crashSpin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, 6 + Math.random() * 5);
    this.onCrash?.(why);
  }

  private visYaw = 0;
  private draw(dt: number) {
    this.group.position.copy(this.p);
    const b = this.body;
    if (this.lift) {
      this.group.rotation.set(0, this.yaw, 0);
      this.sitMesh.position.y = 0;
      b.rotation.set(0, 0, 0);
      b.position.y = 0;
      return;
    }
    this.group.rotation.set(0, 0, 0);
    if (this.crashT > 0) {
      const t = 1.7 - this.crashT;
      b.rotation.set(Math.sin(t * this.crashSpin.x) * 1.5, this.yaw + t * this.crashSpin.y, Math.min(1.5, t * this.crashSpin.z * 0.4));
      b.position.y = 0.2;
      return;
    }
    // align to the slope, lean into turns, crouch in a tuck
    const yaw = this.air ? this.yaw + this.spin : this.yaw;
    this.visYaw = yaw;
    const q = new THREE.Quaternion();
    const up = this.air ? new THREE.Vector3(0, 1, 0) : this.n.clone();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const lean = this.air ? 0 : -this.edge * 0.55 * Math.min(1, this.speed / 8);
    const ql = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.air ? this.flip : this.tuck * 0.25, 0, lean));
    b.quaternion.copy(q).multiply(qy).multiply(ql);
    b.position.y = this.air ? 0.9 * Math.min(1, this.airT * 4) * 0 : 0;
    const sq = 1 - this.tuck * 0.22 - (this.air && this.grabT > 0 ? 0.25 : 0);
    b.scale.set(1, sq, 1);
  }
}

function switchLandGuess(finalYaw: number, travel: number) { return Math.abs(wrapPi(finalYaw - travel)) > Math.PI / 2; }

function trickName(half: number, flips: number, flip: number, grab: number, sw = false, air = 0) {
  const parts: string[] = [];
  if (sw) parts.push('Switch');
  if (half) parts.push(String(half * 180));
  if (flips) parts.push((flips > 1 ? (flips === 2 ? 'Double ' : 'Triple ') : '') + (flip < 0 ? 'Backflip' : 'Frontflip'));
  if (grab > 0.25) parts.push(['Mute', 'Safety', 'Japan', 'Tail'][Math.min(3, Math.floor(grab * 2.2))] + ' grab');
  if (!parts.length || (parts.length === 1 && sw)) parts.push(air > 1.4 ? 'Big air' : 'Straight air');
  return parts.join(' ');
}

// =========================================================================== vehicles
abstract class Vehicle {
  group = new THREE.Group();
  p = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vy = 0;
  air = false;
  n = new THREE.Vector3(0, 1, 0);
  lights: THREE.SpotLight[] = [];
  constructor(protected w: World, protected m: Mountain, protected sim: Sim) { w.scene.add(this.group); }
  place(x: number, z: number, yaw: number) { this.p.set(x, this.m.ground(x, z), z); this.yaw = yaw; this.speed = 0; this.vy = 0; this.air = false; }
  setLights(on: number) { for (const l of this.lights) l.intensity = on; }
  /** keep the body on the snow, pitched and rolled with it */
  protected settle(dt: number, len: number, wid: number) {
    const m = this.m;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const hf = m.ground(this.p.x + fx * len, this.p.z + fz * len), hb = m.ground(this.p.x - fx * len, this.p.z - fz * len);
    const hl = m.ground(this.p.x - fz * wid, this.p.z + fx * wid), hr = m.ground(this.p.x + fz * wid, this.p.z - fx * wid);
    const pitch = Math.atan2(hf - hb, len * 2);
    const roll = Math.atan2(hl - hr, wid * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, this.yaw, 0, 'YXZ'));
    const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll);
    q.multiply(qr);
    this.group.quaternion.slerp(q, Math.min(1, dt * 10));
    this.group.position.copy(this.p);
    return pitch;
  }
}

export class Snowcat extends Vehicle {
  tiller = true;
  trackTex: THREE.CanvasTexture;
  blade: THREE.Object3D;
  tillerMesh: THREE.Object3D;
  beacon: THREE.Mesh;
  groomGain = 0;
  driving = false;
  lv = 1;
  private bodyMat: THREE.MeshStandardMaterial;

  constructor(w: World, m: Mountain, sim: Sim) {
    super(w, m, sim);
    const M = (c: number, r = 0.6, mt = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    this.bodyMat = M(0xd2453a, 0.45, 0.25);
    const g = this.group;
    const c = document.createElement('canvas'); c.width = 16; c.height = 64;
    const cx = c.getContext('2d')!; cx.fillStyle = '#1b1d20'; cx.fillRect(0, 0, 16, 64);
    for (let i = 0; i < 8; i++) { cx.fillStyle = '#3a3e44'; cx.fillRect(0, i * 8, 16, 3); }
    this.trackTex = new THREE.CanvasTexture(c);
    this.trackTex.wrapS = this.trackTex.wrapT = THREE.RepeatWrapping;
    this.trackTex.repeat.set(1, 4);
    const trackM = new THREE.MeshStandardMaterial({ map: this.trackTex, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 5.4), trackM);
      tr.position.set(s * 1.55, 0.55, 0);
      g.add(tr);
    }
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 5.0), this.bodyMat);
    chassis.position.set(0, 1.3, 0);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.4, 2.0), this.bodyMat);
    cab.position.set(0, 2.3, 0.6);
    const glassM = w.glow(new THREE.MeshStandardMaterial({ color: 0x1b2833, roughness: 0.1, metalness: 0.6, emissive: 0xffd09a, emissiveIntensity: 0.1 }), 0.25);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.8, 1.6), glassM);
    glass.position.set(0, 2.5, 0.75);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 2.1), M(0xf4f7fb));
    roof.position.set(0, 3.06, 0.6);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.5 }));
    bar.position.set(0, 3.2, 1.3);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xff9b1a, emissive: 0xff8a00, emissiveIntensity: 2 }));
    this.beacon.position.set(0.6, 3.25, 0.1);
    g.add(chassis, cab, glass, roof, bar, this.beacon);
    // blade
    const blade = (this.blade = new THREE.Group());
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.6, 12, 1, true, Math.PI * 0.5, Math.PI * 0.7), new THREE.MeshStandardMaterial({ color: 0xf2c46d, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
    bl.rotation.z = Math.PI / 2;
    blade.add(bl);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.4), M(0x2b3036));
    arms.position.set(0, 0.2, -0.7);
    blade.add(arms);
    blade.position.set(0, 0.75, 3.4);
    g.add(blade);
    // tiller + comb
    const til = (this.tillerMesh = new THREE.Group());
    const drum = new THREE.Mesh(new THREE.BoxGeometry(5, 0.7, 1.1), M(0x2b3036, 0.7));
    const comb = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.08, 0.9), M(0x111316, 0.9));
    comb.position.set(0, -0.36, -0.8);
    comb.rotation.x = 0.25;
    til.add(drum, comb);
    til.position.set(0, 0.5, -3.3);
    g.add(til);
    // headlights
    for (const s of [-0.6, 0.6]) {
      const sp = new THREE.SpotLight(0xfff4e0, 0, 90, 0.62, 0.5, 1.2);
      sp.position.set(s, 3.0, 1.6);
      sp.target.position.set(s * 2, 0, 22);
      g.add(sp, sp.target);
      this.lights.push(sp);
    }
    const rear = new THREE.SpotLight(0xffe6c4, 0, 30, 0.9, 0.6, 1.4);
    rear.position.set(0, 3.0, -0.5); rear.target.position.set(0, 0, -10);
    g.add(rear, rear.target);
    this.lights.push(rear);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  setLevel(lv: number) {
    this.lv = lv;
    const w = SNOWCAT[lv].w;
    this.tillerMesh.scale.x = w / 5;
    this.blade.scale.x = (w * 0.85) / 4.6;
    this.bodyMat.color.setHex([0, 0xd2453a, 0xe0a63a, 0x2f7fe0, 0x23262b][lv]);
  }

  update(dt: number, c: Controls | null, t: number) {
    const spec = SNOWCAT[this.lv];
    const thr = c ? c.up - c.down : 0;
    const steer = c ? c.right - c.left : 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const along = (this.m.ground(this.p.x + fx * 2, this.p.z + fz * 2) - this.m.ground(this.p.x - fx * 2, this.p.z - fz * 2)) / 4;
    const max = spec.speed * (thr >= 0 ? 1 - Math.max(0, along) * 0.8 : 0.5);
    const target = thr * max;
    const acc = Math.abs(target) > Math.abs(this.speed) ? 3.2 : 5;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), acc * dt);
    if (!c) this.speed *= Math.exp(-dt * 3);
    // skid steer: turns on the spot too
    this.yaw -= steer * (0.55 + Math.min(0.35, Math.abs(this.speed) * 0.05)) * dt * (this.speed < -0.2 ? -1 : 1);
    const nx = this.p.x + fx * this.speed * dt, nz = this.p.z + fz * this.speed * dt;
    const hit = this.w.treeHit(nx + fx * 2.8 * Math.sign(this.speed || 1), nz + fz * 2.8 * Math.sign(this.speed || 1), 1.8);
    if (hit) this.speed *= -0.2;
    else { this.p.x = nx; this.p.z = nz; }
    const lim = 785;
    this.p.x = Math.max(-lim, Math.min(lim, this.p.x)); this.p.z = Math.max(-lim, Math.min(lim, this.p.z));
    this.p.y = this.m.ground(this.p.x, this.p.z);
    this.settle(dt, 2.4, 1.6);
    this.trackTex.offset.y -= this.speed * dt * 0.18;
    this.beacon.visible = Math.sin(t * 9) > 0 || !this.driving;
    (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = this.driving ? 2.5 : 0.4;
    this.tillerMesh.position.y = this.tiller ? 0.42 : 0.9;
    this.groomGain = 0;
    if (this.tiller && this.speed > 0.6 && c) {
      const bx = this.p.x - fx * 4.0, bz = this.p.z - fz * 4.0;
      this.groomGain = this.sim.groomStrip(bx, bz, fx, fz, spec.w, Math.max(1.5, this.speed * dt * 1.5 + 1));
    }
  }
}

export class Sled extends Vehicle {
  lv = 1;
  vel = new THREE.Vector2();
  carrying = false;
  toboggan: THREE.Group;
  patient: THREE.Group;
  driving = false;
  private skiL: THREE.Object3D;
  private skiR: THREE.Object3D;

  constructor(w: World, m: Mountain, sim: Sim) {
    super(w, m, sim);
    const M = (c: number, r = 0.5, mt = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    const g = this.group;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 2.6), M(0x2f7fe0, 0.35, 0.3));
    body.position.set(0, 0.7, 0);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.0), M(0x2f7fe0, 0.35, 0.3));
    hood.position.set(0, 1.0, 0.85); hood.rotation.x = -0.35;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 1.2), M(0x1b1d20, 0.8));
    seat.position.set(0, 1.1, -0.5);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.05), new THREE.MeshStandardMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.5, roughness: 0.1 }));
    shield.position.set(0, 1.45, 0.45); shield.rotation.x = -0.5;
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 2.0), M(0x1b1d20, 0.9));
    track.position.set(0, 0.25, -0.5);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.06), M(0x2b3036));
    bar.position.set(0, 1.4, 0.3);
    g.add(body, hood, seat, shield, track, bar);
    this.skiL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1.4), M(0x1b1d20)); this.skiL.position.set(-0.6, 0.06, 1.1);
    this.skiR = this.skiL.clone(); this.skiR.position.x = 0.6;
    g.add(this.skiL, this.skiR);
    // rider
    const rider = skierGeo('sit');
    const rm = new THREE.Group();
    rm.add(new THREE.Mesh(rider.jacket, new THREE.MeshStandardMaterial({ color: 0xffcf3f })), new THREE.Mesh(rider.rest, new THREE.MeshStandardMaterial({ vertexColors: true })));
    rm.position.set(0, 1.25, -0.5);
    rm.name = 'rider';
    g.add(rm);
    // the rescue toboggan on a tow bar
    this.toboggan = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 2.3), M(0xd2453a, 0.5));
    tb.position.y = 0.2;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), M(0x9aa3ab));
    pole.position.set(0, 0.35, 1.8);
    this.toboggan.add(tb, pole);
    this.patient = new THREE.Group();
    const pg = skierGeo('stand');
    this.patient.add(new THREE.Mesh(pg.jacket, new THREE.MeshStandardMaterial({ color: 0x3fb7c9 })), new THREE.Mesh(pg.rest, new THREE.MeshStandardMaterial({ vertexColors: true })));
    this.patient.rotation.x = -Math.PI / 2;
    this.patient.position.set(0, 0.5, 0.9);
    this.patient.visible = false;
    this.toboggan.add(this.patient);
    this.toboggan.position.set(0, 0, -3.3);
    g.add(this.toboggan);
    const hl = new THREE.SpotLight(0xfff4e0, 0, 80, 0.5, 0.5, 1.2);
    hl.position.set(0, 1.2, 1.4); hl.target.position.set(0, 0, 20);
    g.add(hl, hl.target);
    this.lights.push(hl);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  setLevel(lv: number) { this.lv = lv; }

  update(dt: number, c: Controls | null) {
    const spec = SLED[this.lv];
    const thr = c ? c.up - c.down * 0.6 : 0;
    const steer = c ? c.right - c.left : 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const m = this.m;
    (this.group.getObjectByName('rider') as THREE.Object3D).visible = this.driving;
    this.patient.visible = this.carrying;
    if (this.air) {
      this.vy -= G * dt;
      this.p.x += this.vel.x * dt; this.p.z += this.vel.y * dt; this.p.y += this.vy * dt;
      const gh = m.ground(this.p.x, this.p.z);
      if (this.p.y <= gh) { this.p.y = gh; this.air = false; this.vy = 0; }
      this.group.position.copy(this.p);
      this.yaw -= steer * 0.6 * dt;
      return;
    }
    m.normal(this.p.x, this.p.z, tmpN);
    // gravity along the slope
    const gx = tmpN.x * G * tmpN.y, gz = tmpN.z * G * tmpN.y;
    let vf = this.vel.x * fx + this.vel.y * fz;
    let vl = -this.vel.x * fz + this.vel.y * fx;
    const power = thr > 0 ? 9.5 * thr * Math.max(0, 1 - vf / spec.speed) : thr < 0 ? (vf > 0.5 ? -12 : -4) : 0;
    vf += (power + gx * fx + gz * fz) * dt;
    vl += (-gx * fz + gz * fx) * dt * 0.5;
    vl *= Math.exp(-dt * 6);
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), (0.6 + Math.abs(vf) * 0.04 + (c ? 0 : 3)) * dt);
    this.yaw -= steer * (1.6 * Math.min(1, Math.abs(vf) / 4) + 0.15) * dt * Math.sign(vf || 1) / (1 + Math.abs(vf) * 0.02);
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    this.vel.set(nfx * vf - nfz * vl, nfz * vf + nfx * vl);
    const nx = this.p.x + this.vel.x * dt, nz = this.p.z + this.vel.y * dt;
    if (this.w.treeHit(nx, nz, 0.9)) { this.vel.multiplyScalar(-0.25); }
    else { this.p.x = nx; this.p.z = nz; }
    const lim = 785;
    this.p.x = Math.max(-lim, Math.min(lim, this.p.x)); this.p.z = Math.max(-lim, Math.min(lim, this.p.z));
    // the slope's vertical speed vs where the ground went: crests launch you
    const prevY = this.p.y;
    const gh = m.ground(this.p.x, this.p.z);
    const expected = prevY + this.vyGround * dt;
    this.vyGround = (gh - prevY) / Math.max(1e-4, dt);
    if (expected > gh + 0.25 && this.speed > 9) { this.air = true; this.vy = (expected - prevY) / dt; this.p.y = prevY; }
    else this.p.y = gh;
    this.speed = this.vel.length();
    this.settle(dt, 1.2, 0.6);
    // tow bar follows
    this.toboggan.visible = this.carrying || this.driving;
  }
  private vyGround = 0;
}
