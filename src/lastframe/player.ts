import * as THREE from 'three';
import { move, type Mover, type World } from './collide.ts';
import { F, WEAPONS, WEAPON_LIST, ZONE, type NadeKind, type WeaponId } from './shared.ts';
import { trace, type Tracer } from './ballistics.ts';
import type { Soldier } from './soldier.ts';
import type { Sound } from './audio.ts';
import type { Fx } from './fx.ts';
import type { Body } from './hitbox.ts';
import type { Door } from './world.ts';
import type { Phys } from './physics.ts';

/** a weight on a spring: what a gun in two hands does */
class Sp {
  x = 0;
  v = 0;
  step(dt: number, to: number, k: number, c: number) {
    this.v += (k * (to - this.x) - c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
  reset() {
    this.x = this.v = 0;
  }
}

export class Input {
  keys = new Set<string>();
  dx = 0;
  dy = 0;
  fire = false;
  ads = false;
  pressed = new Set<string>();
  firePressed = false;
  constructor(private el: HTMLElement, private locked: () => boolean) {
    addEventListener('keydown', (e) => {
      if (!this.locked()) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked()) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked()) return;
      if (e.button === 0) {
        this.fire = true;
        this.firePressed = true;
      }
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    });
  }
  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.fire = this.ads = false;
  }
  take(code: string) {
    return this.pressed.delete(code);
  }
  endFrame() {
    this.dx = this.dy = 0;
    this.pressed.clear();
    this.firePressed = false;
  }
}

export interface PlayerCtx {
  world: World;
  sound: Sound;
  fx: Fx;
  doors: Door[];
  bodies(): Iterable<[number, Body]>;
  surfaceAt(x: number, y: number, z: number): string;
  phys: Phys;
  scene: THREE.Object3D;
  send: {
    shot(w: number, o: [number, number, number], e: number[], surf: string[]): void;
    hit(to: number, dmg: number, zone: number, w: number, dir: [number, number, number], dist: number): void;
    door(i: number, from: [number, number, number]): void;
    pane(i: number, at?: [number, number, number]): void;
    nade(kind: NadeKind, o: [number, number, number], v: [number, number, number], fuse: number): void;
  };
  muzzleLight(p: THREE.Vector3): void;
  prompt(s: string): void;
  hitMark(kill: boolean): void;
}

const Q180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const WALK = 3.05, RUN = 5.3, CROUCH = 1.65;

export class LocalPlayer {
  m: Mover = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, height: 1.78, stepEase: 0 };
  yaw = 0;
  pitch = 0;
  alive = false;
  slot = 0;
  sens = 0.0021;
  adsK = 0;
  crouchK = 0;
  crouch = false;
  sprintK = 0;
  lean = 0;
  leanK = 0;
  light = false;
  slots: WeaponId[] = ['carbine', 'pistol'];
  cur = 0;
  ammo = new Map<WeaponId, { mag: number; res: number }>();
  nades: Record<NadeKind, number> = { frag: 1, flash: 1 };
  private cool = 0;
  reloadT = 0;
  private reloadLen = 0;
  private switchT = 0;
  private cycleT = 0;
  private cycleLen = 0;
  private recP = 0;
  private recY = 0;
  private punchP = 0;
  private punchY = 0;
  private punchR = 0;
  private swayY = new Sp();
  private swayP = new Sp();
  private inX = new Sp();
  private inY = new Sp();
  private inZ = new Sp();
  private rkZ = new Sp();
  private rkP = new Sp();
  private rkY = new Sp();
  private rkR = new Sp();
  private camP = new Sp();
  private camR = new Sp();
  private pvx = 0;
  private pvz = 0;
  /** muzzle climb still owed back to the aim */
  private climb = 0;
  private climbY = 0;
  private sinceShot = 9;
  private trauma = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private slideT = 0;
  private slideX = 0;
  private slideZ = 0;
  private stun = 0;
  private mantle: { t: number; len: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null = null;
  mantleK = 0;
  private magGone = false;
  private bob = 0;
  private bobK = 0;
  private stepAcc = 0;
  private breath = 0;
  private retract = 0;
  private landK = 0;
  private airV = 0;
  private stamina = 1;
  private clk = { a: false, b: false };
  /** world pose of the gun */
  readonly gunPos = new THREE.Vector3();
  readonly gunQuat = new THREE.Quaternion();
  readonly barrel = new THREE.Vector3(0, 0, -1);
  readonly lightPos = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  hurtK = 0;

  get weapon() {
    return this.slots[this.cur];
  }
  get spec() {
    return WEAPONS[this.weapon];
  }
  get busy() {
    return this.reloadT > 0 || this.switchT > 0;
  }

  spawn(x: number, y: number, z: number, yaw: number, primary: WeaponId) {
    Object.assign(this.m, { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, height: 1.78, stepEase: 0 });
    this.yaw = yaw;
    this.pitch = 0;
    this.alive = true;
    this.slots = [primary, 'pistol'];
    this.cur = 0;
    this.ammo.clear();
    for (const w of this.slots) this.ammo.set(w, { mag: WEAPONS[w].mag, res: WEAPONS[w].reserve });
    this.nades = { frag: 1, flash: 1 };
    this.reloadT = this.switchT = this.cycleT = 0;
    this.crouch = false;
    this.hurtK = 0;
    this.mantle = null;
    this.slideT = this.stun = this.climb = this.climbY = this.trauma = 0;
    for (const q of [this.swayY, this.swayP, this.inX, this.inY, this.inZ, this.rkZ, this.rkP, this.rkY, this.rkR, this.camP, this.camR]) q.reset();
  }

  /** a blast nearby: k from 0 to 1 */
  shake(k: number) {
    this.trauma = Math.min(1, this.trauma + k);
  }

  flags() {
    return F.alive | (this.crouch ? F.crouch : 0) | (this.adsK > 0.5 ? F.ads : 0) | (this.sprintK > 0.5 ? F.sprint : 0) | (this.light ? F.light : 0) | (this.reloadT > 0 ? F.reload : 0) | (Math.hypot(this.m.vx, this.m.vz) > 0.3 ? F.moving : 0);
  }

  update(dt: number, i: Input, c: PlayerCtx, cam: THREE.PerspectiveCamera, sol: Soldier, freeze: boolean) {
    const m = this.m;
    const spec = this.spec;
    // ---- look
    const sensK = this.sens * (1 - this.adsK * (1 - spec.adsFov / 84) * 0.9);
    const dYaw = -i.dx * sensK, dPitch = -i.dy * sensK;
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, -1.45, 1.45);
    // ---- move
    const f = (i.keys.has('KeyW') ? 1 : 0) - (i.keys.has('KeyS') ? 1 : 0);
    const s = (i.keys.has('KeyD') ? 1 : 0) - (i.keys.has('KeyA') ? 1 : 0);
    const crouchHeld = i.keys.has('KeyC') || i.keys.has('ControlLeft');
    const was = Math.hypot(m.vx, m.vz);
    // a dive into a crouch from a run carries you
    if (crouchHeld && !this.crouch && this.sprintK > 0.5 && was > 4.2 && m.grounded && !freeze && this.slideT <= 0) {
      this.slideT = 0.72;
      this.slideX = m.vx / was;
      this.slideZ = m.vz / was;
      c.sound.step(null, c.surfaceAt(m.x, m.y, m.z), 6, 1.1);
    }
    if (crouchHeld) this.crouch = true;
    else if (this.crouch && !c.world.blocked(m.x, m.y + 0.1, m.z, 0.25, 1.7)) this.crouch = false;
    const wantRun = i.keys.has('ShiftLeft') && f > 0 && !this.crouch && !i.ads && this.stamina > 0.04 && !i.fire;
    const run = wantRun && !freeze;
    this.stamina = Math.min(1, Math.max(0, this.stamina + (run ? -dt / 7 : dt / 5)));
    let top = this.crouch ? CROUCH : run ? RUN : WALK;
    top *= spec.speed * (1 - this.adsK * 0.42) * (1 - this.stun * 0.55);
    if (freeze) top = 0;
    this.stun = Math.max(0, this.stun - dt * 2.6);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    if (this.slideT > 0) {
      // friction only, a little steering
      this.slideT -= dt;
      const sp = Math.max(0, was - 5.2 * dt);
      const steer = 1 - Math.exp(-2.4 * dt);
      const tx = this.slideX + (wx - this.slideX) * steer, tz = this.slideZ + (wz - this.slideZ) * steer;
      const tl = Math.hypot(tx, tz) || 1;
      this.slideX = tx / tl;
      this.slideZ = tz / tl;
      m.vx = this.slideX * sp;
      m.vz = this.slideZ * sp;
      if (sp < 1.6 || !m.grounded) this.slideT = 0;
    } else {
      // a body has mass: it takes a moment to get going, longer to reverse, and very little to do in the air
      const tx = wx * top, tz = wz * top;
      const ex = tx - m.vx, ez = tz - m.vz, el = Math.hypot(ex, ez);
      const pressing = wl > 0.01;
      const against = m.vx * tx + m.vz * tz < 0;
      const A = !m.grounded ? 3.4 : !pressing ? 15 : against ? 26 : run ? 13.5 : 19;
      const dv = Math.min(el, A * dt);
      if (el > 1e-5) {
        m.vx += (ex / el) * dv;
        m.vz += (ez / el) * dv;
      }
    }
    // ---- jump, with a little forgiveness either side of the ledge, or a climb onto what's in front
    this.coyote = m.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuf = i.take('Space') ? 0.12 : Math.max(0, this.jumpBuf - dt);
    if (!this.mantle && this.jumpBuf > 0 && !freeze && f > 0) this.tryMantle(c);
    if (this.jumpBuf > 0 && this.coyote > 0 && !freeze && !this.crouch && !this.mantle) {
      m.vy = 4.15;
      m.grounded = false;
      this.coyote = this.jumpBuf = 0;
      this.slideT = 0;
      this.stamina = Math.max(0, this.stamina - 0.07);
      this.inY.v -= 0.25;
    }
    m.height = this.crouch ? 1.22 : 1.78;
    this.airV = m.vy;
    const wasAir = !m.grounded;
    if (this.mantle) this.climbing(dt, c);
    else move(c.world, m, dt);
    this.mantleK += ((this.mantle ? 1 : 0) - this.mantleK) * Math.min(1, dt * 12);
    if (wasAir && m.grounded) {
      const hit = -this.airV;
      this.landK = Math.min(1, hit / 6);
      c.sound.step(null, c.surfaceAt(m.x, m.y, m.z), 5, 0.7 + Math.min(1, hit / 6));
      this.inY.v -= hit * 0.09;
      this.camP.v -= hit * 0.09;
      if (hit > 5.5) {
        this.stun = Math.min(1, (hit - 5.5) / 3 + 0.5);
        m.vx *= 0.55;
        m.vz *= 0.55;
      }
    }
    const speed = Math.hypot(m.vx, m.vz);
    // ---- steps
    if (m.grounded && speed > 0.3) {
      const stride = run ? 1.62 : this.crouch ? 0.95 : 1.28;
      this.stepAcc += speed * dt;
      this.bob += (speed * dt) / stride * Math.PI;
      if (this.stepAcc >= stride) {
        this.stepAcc = 0;
        c.sound.step(null, c.surfaceAt(m.x, m.y, m.z), speed, this.crouch ? 0.32 : 0.75);
      }
    }
    this.bobK += ((speed > 0.3 && m.grounded ? Math.min(1.25, speed / WALK) : 0) - this.bobK) * Math.min(1, dt * 9);
    // ---- stance easing
    const adsWant = i.ads && !this.switchT && !run ? 1 : 0;
    const adsRate = this.weapon === 'rifle' ? 6.5 : 9;
    this.adsK += (adsWant - this.adsK) * Math.min(1, dt * adsRate);
    this.crouchK += ((this.crouch ? 1 : 0) - this.crouchK) * Math.min(1, dt * 11);
    this.sprintK += ((run && speed > 3.6 ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    const lt = (i.keys.has('KeyE') ? 1 : 0) - (i.keys.has('KeyQ') ? 1 : 0);
    this.lean = lt;
    this.leanK += (lt - this.leanK) * Math.min(1, dt * 10);
    // ---- the head
    const eyeH = 1.63 - this.crouchK * 0.56 - (this.slideT > 0 ? 0.12 : 0);
    const bobY = Math.abs(Math.sin(this.bob)) * 0.03 * this.bobK * (1 - this.adsK * 0.6);
    const bobX = Math.cos(this.bob) * 0.016 * this.bobK * (1 - this.adsK * 0.7);
    this.breath += dt;
    this.landK = Math.max(0, this.landK - dt * 3.2);
    const lk = Math.sin(this.landK * Math.PI) * this.landK;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    // don't lean through a wall
    let lean = this.leanK * 0.36;
    if (Math.abs(lean) > 0.02) {
      const sgn = Math.sign(lean);
      const h = c.world.ray(m.x, m.y + eyeH, m.z, rx * sgn, 0, rz * sgn, 0.6);
      if (h) lean = sgn * Math.min(Math.abs(lean), Math.max(0, h.t - 0.2));
    }
    const eye = this.eye.set(m.x + rx * (lean + bobX), m.y + eyeH + m.stepEase + bobY - lk * 0.1, m.z + rz * (lean + bobX));
    // recoil settles; the camera takes some of it
    const rs = Math.exp(-dt * spec.settle);
    this.recP *= rs;
    this.recY *= rs;
    const ps = Math.exp(-dt * 14);
    this.punchP *= ps;
    this.punchY *= ps;
    this.punchR *= ps;
    // the gun's own weight: springs for the turn, the stride, the shot
    const a = this.adsK;
    const rY = dt > 0 ? dYaw / dt : 0, rP = dt > 0 ? dPitch / dt : 0;
    this.swayY.step(dt, THREE.MathUtils.clamp(rY * 0.017, -0.085, 0.085), 110, 13);
    this.swayP.step(dt, THREE.MathUtils.clamp(rP * 0.017, -0.075, 0.075), 110, 13);
    const axW = dt > 0 ? (m.vx - this.pvx) / dt : 0, azW = dt > 0 ? (m.vz - this.pvz) / dt : 0;
    this.pvx = m.vx;
    this.pvz = m.vz;
    // into the camera's frame: forward and right
    const aF = -sy * axW - cy * azW, aR = cy * axW - sy * azW;
    this.inX.step(dt, THREE.MathUtils.clamp(-aR * 0.0014, -0.03, 0.03), 90, 12);
    this.inZ.step(dt, THREE.MathUtils.clamp(-aF * 0.0016, -0.03, 0.03), 90, 12);
    this.inY.step(dt, 0, 120, 13);
    this.rkZ.step(dt, 0, 420, 30);
    this.rkP.step(dt, 0, 300, 25);
    this.rkY.step(dt, 0, 300, 25);
    this.rkR.step(dt, 0, 260, 22);
    this.camP.step(dt, 0, 170, 19);
    this.camR.step(dt, 0, 170, 19);
    // climb is paid back once the trigger is let go
    this.sinceShot += dt;
    if (this.sinceShot > 0.13 && (this.climb || this.climbY)) {
      const k = 1 - Math.exp(-dt * 8);
      const back = this.climb * k, backY = this.climbY * k;
      this.pitch -= back;
      this.yaw -= backY;
      this.climb -= back;
      this.climbY -= backY;
      if (Math.abs(this.climb) < 1e-4) this.climb = 0;
      if (Math.abs(this.climbY) < 1e-4) this.climbY = 0;
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    const tr = this.trauma * this.trauma, tt = this.breath * 31;
    const shP = tr * 0.05 * (Math.sin(tt) + Math.sin(tt * 1.73 + 1)) * 0.5, shY = tr * 0.05 * Math.sin(tt * 1.31 + 2), shR = tr * 0.06 * Math.sin(tt * 0.87 + 4);
    const camK = 0.45;
    const swayP = Math.sin(this.breath * 1.3) * 0.0035 + Math.sin(this.bob * 2) * 0.0035 * this.bobK;
    const swayY = Math.sin(this.breath * 0.9) * 0.003 + Math.cos(this.bob) * 0.0045 * this.bobK;
    const roll = -this.leanK * 0.2 + Math.cos(this.bob) * 0.008 * this.bobK + this.punchR - s * 0.012 * (speed / WALK) + shR + this.camR.x + (this.slideT > 0 ? 0.07 : 0) + this.mantleK * 0.05 * Math.sin((this.mantle?.t ?? 0) * 6);
    this.e.set(this.pitch + this.recP * camK + this.punchP + swayP * (1 - this.adsK * 0.75) + shP + this.camP.x - this.mantleK * 0.13, this.yaw + this.recY * camK + this.punchY + swayY * (1 - this.adsK * 0.75) + shY, roll, 'YXZ');
    cam.position.copy(eye);
    cam.quaternion.setFromEuler(this.e);
    const fov = THREE.MathUtils.lerp(84, spec.adsFov, this.adsK) + this.sprintK * 3;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    // ---- the gun, in camera space
    // too close to a wall: bring it in and up
    const fw = this.v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const wall = c.world.ray(eye.x, eye.y, eye.z, fw.x, fw.y, fw.z, spec.muzzle[2] + 0.42);
    const want = wall ? THREE.MathUtils.clamp(1 - (wall.t - 0.32) / (spec.muzzle[2] + 0.1), 0, 1) : 0;
    this.retract += (want - this.retract) * Math.min(1, dt * 10);
    const hp = spec.hipPos, ap = spec.adsPos;
    let gx = THREE.MathUtils.lerp(hp[0], ap[0], a), gy = THREE.MathUtils.lerp(hp[1], ap[1], a), gz = THREE.MathUtils.lerp(hp[2], ap[2], a);
    const free = 1 - a * 0.72;
    const sy2 = this.swayY.x, sp2 = this.swayP.x;
    gx += Math.cos(this.bob) * 0.012 * this.bobK * (1 - a * 0.85) - sy2 * 0.28 * free + this.inX.x * free;
    gy += -Math.abs(Math.sin(this.bob)) * 0.014 * this.bobK * (1 - a * 0.85) + sp2 * 0.28 * free - lk * 0.03 + this.inY.x * free;
    gz += this.inZ.x * free - this.rkZ.x * (1 - a * 0.45) - this.recP * 0.12;
    // sprint: muzzle low across the body
    gx -= this.sprintK * 0.05;
    gy -= this.sprintK * 0.09 + this.mantleK * 0.14;
    gz -= this.retract * 0.22;
    gy -= this.retract * 0.03;
    let pitchG = this.recP * 0.7 + this.rkP.x - sp2 * 1.3 - this.sprintK * 0.72 + this.retract * 0.95 - this.mantleK * 0.6;
    let yawG = this.recY * 0.7 + this.rkY.x - sy2 * 1.3 + this.sprintK * 0.95 + (1 - a) * Math.atan2(gx, 22) + this.mantleK * 0.5;
    let rollG = this.sprintK * 0.35 + this.leanK * 0.1 * (1 - a) - sy2 * 0.6 + this.rkR.x - this.inX.x * 3 * free + (this.slideT > 0 ? 0.3 : 0);
    // reload and bolt movements
    let reloadK = 0;
    if (this.reloadT > 0) {
      const t = 1 - this.reloadT / this.reloadLen;
      reloadK = Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.6;
      pitchG += reloadK * 0.34;
      yawG += reloadK * 0.3;
      rollG += reloadK * 0.75;
      gy -= reloadK * 0.05;
      gx -= reloadK * 0.03;
    }
    if (this.switchT > 0) {
      const t = this.switchT / 0.55;
      gy -= Math.sin(t * Math.PI) * 0.3;
      pitchG -= Math.sin(t * Math.PI) * 0.9;
    }
    const cyc = this.cycleT > 0 ? Math.sin((1 - this.cycleT / this.cycleLen) * Math.PI) : 0;
    this.gunPos.set(gx, gy, -gz).applyQuaternion(cam.quaternion).add(eye);
    this.e.set(pitchG, yawG, rollG, 'YXZ');
    this.q.setFromEuler(this.e);
    this.gunQuat.copy(cam.quaternion).multiply(this.q).multiply(Q180);
    this.barrel.set(0, 0, 1).applyQuaternion(this.gunQuat);
    const gun = sol.gun;
    if (gun) {
      if (gun.dot) gun.dot.visible = this.adsK > 0.72;
      gun.group.position.copy(this.gunPos);
      gun.group.quaternion.copy(this.gunQuat);
      if (gun.action) {
        const back = this.weapon === 'pistol' ? Math.max(0, this.cool / spec.cycle) * 0.03 : cyc * (this.weapon === 'rifle' ? 0.09 : 0.1);
        const dirZ = this.weapon === 'shotgun' ? 1 : 1;
        gun.action.position.copy(gun.actionRest);
        gun.action.position.z -= back * dirZ;
      }
      if (gun.mag && this.reloadT > 0) {
        const t = 1 - this.reloadT / this.reloadLen;
        const out = t > 0.2 && t < 0.72;
        const drop = t < 0.2 ? 0 : t < 0.32 ? (t - 0.2) / 0.12 : t < 0.6 ? 1 : t < 0.72 ? 1 - (t - 0.6) / 0.12 : 0;
        gun.mag.position.copy(gun.magRest);
        gun.mag.position.y -= drop * 0.3;
        gun.mag.visible = !out || drop < 0.98;
        if (t > 0.22 && !this.magGone) {
          // the empty one goes where gravity sends it
          this.magGone = true;
          const holder = new THREE.Group();
          const m2 = gun.mag.clone();
          m2.position.copy(gun.magRest);
          m2.visible = true;
          holder.add(m2);
          const bb = new THREE.Box3().setFromObject(m2);
          const mid = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
          c.scene.add(holder);
          const p0 = new THREE.Vector3(0, -0.04, 0).applyQuaternion(this.gunQuat).add(this.gunPos);
          const fall = new THREE.Vector3(0, -1.3, 0).applyQuaternion(this.gunQuat);
          fall.x += m.vx;
          fall.z += m.vz;
          c.phys.drop(holder, [sz.x, sz.y, sz.z], mid, p0, this.gunQuat, fall, 7, 0.35, 16);
        }
      } else if (gun.mag) {
        gun.mag.position.copy(gun.magRest);
        gun.mag.visible = true;
      }
      // the support hand goes down for the magazine or the shells
      if (this.reloadT > 0) {
        const t = 1 - this.reloadT / this.reloadLen;
        sol.magHand = gun.mag ? Math.min(1, Math.min(t / 0.16, (1 - t) / 0.2)) : 0.55 + 0.4 * Math.sin(t * Math.PI * 2 * this.spec.mag);
      } else sol.magHand *= Math.exp(-dt * 12);
    }
    // ahead of the muzzle: a torch on the rail lights the room, not the gun it's clamped to
    this.lightPos.set(0.04, 0.043, spec.muzzle[2] + 0.03).applyQuaternion(this.gunQuat).add(this.gunPos);
    if (freeze) return;
    this.actions(dt, i, c, cam, sol);
  }

  private actions(dt: number, i: Input, c: PlayerCtx, cam: THREE.PerspectiveCamera, sol: Soldier) {
    const spec = this.spec;
    const w = this.weapon;
    const am = this.ammo.get(w)!;
    this.cool -= dt;
    if (this.cycleT > 0) {
      const before = this.cycleT / this.cycleLen;
      this.cycleT -= dt;
      const after = this.cycleT / this.cycleLen;
      if (before > 0.55 && after <= 0.55) {
        c.sound.clack(null, w === 'rifle' ? 'bolt' : 'pump_a');
        this.ejectShell(c);
      }
      if (before > 0.15 && after <= 0.15) c.sound.clack(null, w === 'rifle' ? 'bolt' : 'pump_b');
    }
    if (this.switchT > 0) {
      const b = this.switchT;
      this.switchT -= dt;
      if (b > 0.27 && this.switchT <= 0.27) {
        this.cur = 1 - this.cur;
        sol.setWeapon(this.weapon);
        c.sound.clack(null, 'draw');
      }
    }
    if (this.reloadT > 0) {
      const before = 1 - this.reloadT / this.reloadLen;
      this.reloadT -= dt;
      const after = 1 - this.reloadT / this.reloadLen;
      if (w === 'shotgun' || w === 'rifle') {
        // one at a time
        const n = spec.mag;
        if (Math.floor(before * n) !== Math.floor(after * n)) c.sound.clack(null, 'shell');
      } else {
        if (before < 0.02) this.magGone = false;
        if (before < 0.18 && after >= 0.18) c.sound.clack(null, 'mag_out');
        if (before < 0.68 && after >= 0.68) c.sound.clack(null, 'mag_in');
        if (before < 0.88 && after >= 0.88) c.sound.clack(null, 'bolt');
      }
      if (this.reloadT <= 0) {
        const need = spec.mag - am.mag;
        const got = Math.min(need, am.res);
        am.mag += got;
        am.res -= got;
      }
      if (i.firePressed && (w === 'shotgun' || w === 'rifle') && after > 0.15) {
        // interrupt with what's loaded so far
        const got = Math.min(Math.floor(after * spec.mag), am.res, spec.mag - am.mag);
        am.mag += got;
        am.res -= got;
        this.reloadT = 0;
      }
    }
    if (i.take('KeyR') && !this.busy && am.mag < spec.mag && am.res > 0) {
      this.reloadLen = w === 'shotgun' ? 0.55 * (spec.mag - am.mag) + 0.3 : w === 'rifle' ? 0.6 * (spec.mag - am.mag) + 0.4 : spec.reload;
      this.reloadT = this.reloadLen;
    }
    if ((i.take('Digit1') && this.cur !== 0) || (i.take('Digit2') && this.cur !== 1) || i.take('KeyX')) {
      if (this.switchT <= 0) {
        this.switchT = 0.55;
        this.reloadT = 0;
        c.sound.clack(null, 'draw');
      }
    }
    if (i.take('KeyT')) {
      this.light = !this.light;
      c.sound.clack(null, 'shell');
    }
    if (i.take('KeyG') && this.nades.frag > 0) this.throwNade('frag', c, cam);
    if (i.take('KeyV') && this.nades.flash > 0) this.throwNade('flash', c, cam);
    // ---- doors
    let near: Door | null = null, nd = 2.3;
    const fw = this.v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const d of c.doors) {
      const dx = d.centre.x - this.eye.x, dy = d.centre.y - this.eye.y, dz = d.centre.z - this.eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < nd && (dx * fw.x + dy * fw.y + dz * fw.z) / dist > 0.35) {
        nd = dist;
        near = d;
      }
    }
    c.prompt(near ? (near.want > 0 ? 'F  Close' : 'F  Open') : '');
    if (near && i.take('KeyF')) c.send.door(near.id, [this.m.x, this.m.y, this.m.z]);
    // ---- the trigger
    if (this.busy || this.sprintK > 0.35 || this.retract > 0.72 || this.mantle || this.slideT > 0.5) return;
    const trig = spec.auto ? i.fire : i.firePressed;
    if (!trig || this.cool > 0 || this.cycleT > 0) return;
    if (am.mag <= 0) {
      if (i.firePressed) c.sound.dry_(null);
      if (i.firePressed && am.res > 0) i.pressed.add('KeyR');
      return;
    }
    am.mag--;
    this.cool = spec.cycle;
    if (w === 'shotgun' || w === 'rifle') {
      this.cycleLen = spec.cycle * 0.92;
      this.cycleT = am.mag > 0 ? this.cycleLen : 0;
      this.cool = am.mag > 0 ? spec.cycle : 0.2;
    } else this.ejectShell(c);
    this.fire(c, sol, cam);
  }

  private ejectShell(c: PlayerCtx) {
    const e = this.spec.eject;
    const p = this.v.set(-e[0], e[1], e[2]).applyQuaternion(this.gunQuat).add(this.gunPos);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.gunQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.gunQuat);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(this.gunQuat);
    const v = right.multiplyScalar(2.3 + Math.random() * 1.1).addScaledVector(up, 1.4 + Math.random() * 0.9).addScaledVector(back, Math.random() * 0.7);
    v.x += this.m.vx;
    v.z += this.m.vz;
    c.fx.shell(p, v, this.gunQuat, this.spec.brass);
  }

  /** a ledge in front at hand height: get a knee on it */
  private tryMantle(c: PlayerCtx) {
    const m = this.m;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (this.crouch) return;
    // something to climb, not open air
    if (!c.world.blocked(m.x + fx * 0.42, m.y + 0.5, m.z + fz * 0.42, 0.12, 0.7) && !c.world.blocked(m.x + fx * 0.42, m.y + 1.0, m.z + fz * 0.42, 0.12, 0.3)) return;
    for (const d of [0.62, 0.86, 1.1]) {
      const px = m.x + fx * d, pz = m.z + fz * d;
      const top = c.world.floorAt(px, m.y + 1.5, pz, 0.14, 0);
      const h = top - m.y;
      if (h < 0.42 || h > 1.48) continue;
      if (c.world.blocked(px, top + 0.03, pz, 0.25, 1.72)) continue;
      if (c.world.blocked(m.x, top + 0.03, m.z, 0.2, 1.72)) continue;
      this.mantle = { t: 0, len: 0.24 + h * 0.26, x0: m.x, y0: m.y, z0: m.z, x1: px, y1: top, z1: pz };
      this.jumpBuf = 0;
      this.slideT = 0;
      c.sound.step(null, 'hard', 4, 0.9);
      this.camP.v -= 0.5;
      return;
    }
  }

  private climbing(dt: number, c: PlayerCtx) {
    const q = this.mantle!, m = this.m;
    q.t += dt;
    const t = Math.min(1, q.t / q.len);
    // up first, then over
    const up = 1 - (1 - Math.min(1, t * 1.5)) ** 2;
    const over = THREE.MathUtils.smoothstep(t, 0.35, 1);
    m.x = q.x0 + (q.x1 - q.x0) * over;
    m.y = q.y0 + (q.y1 - q.y0) * up;
    m.z = q.z0 + (q.z1 - q.z0) * over;
    m.vx = m.vz = m.vy = 0;
    if (t >= 1) {
      this.mantle = null;
      m.grounded = true;
      m.vx = -Math.sin(this.yaw) * 1.6;
      m.vz = -Math.cos(this.yaw) * 1.6;
      c.sound.step(null, c.surfaceAt(m.x, m.y, m.z), 3.4, 0.8);
      this.camP.v -= 0.35;
    }
  }

  private fire(c: PlayerCtx, sol: Soldier, cam: THREE.PerspectiveCamera) {
    const spec = this.spec;
    const wi = WEAPON_LIST.indexOf(this.weapon);
    const speed = Math.hypot(this.m.vx, this.m.vz);
    const base = THREE.MathUtils.lerp(spec.hip, spec.ads, this.adsK) + speed * spec.move * (1 - this.adsK * 0.6) + (this.m.grounded ? 0 : 3);
    const crouchK = this.crouch ? 0.72 : 1;
    const muz = this.v.set(...spec.muzzle).applyQuaternion(this.gunQuat).add(this.gunPos).clone();
    // shots come from the barrel unless the barrel is through a wall
    const to = muz.clone().sub(this.eye);
    const tl = to.length();
    const blocked = c.world.ray(this.eye.x, this.eye.y, this.eye.z, to.x / tl, to.y / tl, to.z / tl, tl);
    const o = blocked ? this.eye.clone() : muz;
    const dir = new THREE.Vector3();
    const out: Tracer = { e: [], surf: [], hits: [], panes: [] };
    const bodies = [...c.bodies()];
    const sp = (base * crouchK * Math.PI) / 180;
    for (let n = 0; n < spec.pellets; n++) {
      dir.copy(this.barrel);
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * sp;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.gunQuat), rt = new THREE.Vector3(1, 0, 0).applyQuaternion(this.gunQuat);
      dir.addScaledVector(up, Math.sin(a) * r).addScaledVector(rt, Math.cos(a) * r).normalize();
      trace(c.world, bodies, o.x, o.y, o.z, dir.x, dir.y, dir.z, spec, this.slot, out);
    }
    out.panes.forEach((i, n) => c.send.pane(i, out.paneAt?.[n]));
    c.send.shot(wi, [muz.x, muz.y, muz.z], out.e, out.surf);
    // sum the pellets on each body
    const per = new Map<number, { dmg: number; zone: number; dist: number; at: [number, number, number] }>();
    for (const h of out.hits) {
      const d = spec.dmg * h.k * (h.zone === ZONE.head ? spec.headX : h.zone === ZONE.limb ? 0.72 : 1);
      const e = per.get(h.slot);
      if (e) {
        e.dmg += d;
        e.zone = Math.min(e.zone, h.zone);
      } else per.set(h.slot, { dmg: d, zone: h.zone, dist: h.dist, at: h.at });
    }
    for (const [to2, h] of per) c.send.hit(to2, Math.round(h.dmg), h.zone, wi, [h.at[0] - o.x, h.at[1] - o.y, h.at[2] - o.z], h.dist);
    // ---- kick
    const k = spec.kick * (Math.PI / 180) * (1 - this.adsK * 0.42) * crouchK;
    const side = (Math.random() - 0.5) * 2 * spec.wander * (Math.PI / 180);
    this.recP += k * 0.6;
    this.recY += side * 0.6;
    const up = k * 0.34, drift = side * 0.3;
    this.pitch += up;
    this.yaw += drift;
    this.climb += up * 0.72;
    this.climbY += drift * 0.72;
    this.sinceShot = 0;
    // the shot goes back through the wrists into the shoulder
    const hard = spec.kick * (1 - this.adsK * 0.35) * crouchK;
    this.rkZ.v += 0.42 * Math.sqrt(hard);
    this.rkP.v += hard * 0.22;
    this.rkY.v += side * 16;
    this.rkR.v += (Math.random() - 0.5) * hard * 0.5;
    this.camP.v += hard * 0.045;
    this.camR.v += (Math.random() - 0.5) * hard * 0.09;
    sol.kick = 1;
    c.sound.shot(wi, null);
    c.fx.muzzle(muz, this.barrel, this.weapon === 'shotgun' || this.weapon === 'rifle' ? 1.5 : this.weapon === 'pistol' ? 0.7 : 1);
    c.muzzleLight(muz);
  }

  private throwNade(kind: NadeKind, c: PlayerCtx, cam: THREE.PerspectiveCamera) {
    this.nades[kind]--;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const o = this.eye.clone().addScaledVector(f, 0.45);
    const speed = 13;
    c.sound.clack(null, 'draw');
    c.send.nade(kind, [o.x, o.y, o.z], [f.x * speed + this.m.vx * 0.6, f.y * speed + 2.8, f.z * speed + this.m.vz * 0.6], kind === 'frag' ? 2.4 : 1.7);
  }

  hurt(dir: [number, number, number]) {
    this.punchP += 0.05 + Math.random() * 0.04;
    this.punchY += (Math.random() - 0.5) * 0.09;
    this.punchR += (Math.random() - 0.5) * 0.09;
    this.hurtK = 1;
    // a hit shoves: some of the round's push reaches your feet
    this.m.vx += dir[0] * 0.8;
    this.m.vz += dir[2] * 0.8;
    this.stun = Math.max(this.stun, 0.5);
    this.inY.v -= 0.4;
  }
}
