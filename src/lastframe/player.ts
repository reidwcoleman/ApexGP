import * as THREE from 'three';
import { move, type Mover, type World } from './collide.ts';
import { F, WEAPONS, WEAPON_LIST, ZONE, type NadeKind, type WeaponId } from './shared.ts';
import { trace, type Tracer } from './ballistics.ts';
import type { Soldier } from './soldier.ts';
import type { Sound } from './audio.ts';
import type { Fx } from './fx.ts';
import type { Body } from './hitbox.ts';
import type { Door } from './world.ts';

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
  send: {
    shot(w: number, o: [number, number, number], e: number[], surf: string[]): void;
    hit(to: number, dmg: number, zone: number, w: number, dir: [number, number, number], dist: number): void;
    door(i: number, from: [number, number, number]): void;
    pane(i: number): void;
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
  private lagY = 0;
  private lagP = 0;
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
    if (crouchHeld) this.crouch = true;
    else if (this.crouch && !c.world.blocked(m.x, m.y + 0.1, m.z, 0.25, 1.7)) this.crouch = false;
    const wantRun = i.keys.has('ShiftLeft') && f > 0 && !this.crouch && !i.ads && this.stamina > 0.04 && !i.fire;
    const run = wantRun && !freeze;
    this.stamina = Math.min(1, Math.max(0, this.stamina + (run ? -dt / 7 : dt / 5)));
    let top = this.crouch ? CROUCH : run ? RUN : WALK;
    top *= spec.speed * (1 - this.adsK * 0.42);
    if (freeze) top = 0;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const acc = m.grounded ? 13 : 2.5;
    const k = 1 - Math.exp(-acc * dt);
    m.vx += (wx * top - m.vx) * k;
    m.vz += (wz * top - m.vz) * k;
    if (i.take('Space') && m.grounded && !freeze && !this.crouch) {
      m.vy = 4.05;
      m.grounded = false;
    }
    m.height = this.crouch ? 1.22 : 1.78;
    this.airV = m.vy;
    const wasAir = !m.grounded;
    move(c.world, m, dt);
    if (wasAir && m.grounded) {
      this.landK = Math.min(1, -this.airV / 6);
      c.sound.step(null, c.surfaceAt(m.x, m.y, m.z), 5, 1.2);
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
    const eyeH = 1.63 - this.crouchK * 0.56;
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
    const camK = 0.45;
    const swayP = Math.sin(this.breath * 1.3) * 0.0035 + Math.sin(this.bob * 2) * 0.0035 * this.bobK;
    const swayY = Math.sin(this.breath * 0.9) * 0.003 + Math.cos(this.bob) * 0.0045 * this.bobK;
    const roll = -this.leanK * 0.2 + Math.cos(this.bob) * 0.008 * this.bobK + this.punchR - s * 0.012 * (speed / WALK);
    this.e.set(this.pitch + this.recP * camK + this.punchP + swayP * (1 - this.adsK * 0.75), this.yaw + this.recY * camK + this.punchY + swayY * (1 - this.adsK * 0.75), roll, 'YXZ');
    cam.position.copy(eye);
    cam.quaternion.setFromEuler(this.e);
    const fov = THREE.MathUtils.lerp(84, spec.adsFov, this.adsK) + this.sprintK * 3;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    // ---- the gun, in camera space
    const lagK = Math.exp(-dt * (this.adsK > 0.5 ? 22 : 13));
    this.lagY = this.lagY * lagK + dYaw * 0.65;
    this.lagP = this.lagP * lagK + dPitch * 0.65;
    this.lagY = THREE.MathUtils.clamp(this.lagY, -0.1, 0.1);
    this.lagP = THREE.MathUtils.clamp(this.lagP, -0.1, 0.1);
    // too close to a wall: bring it in and up
    const fw = this.v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const wall = c.world.ray(eye.x, eye.y, eye.z, fw.x, fw.y, fw.z, spec.muzzle[2] + 0.42);
    const want = wall ? THREE.MathUtils.clamp(1 - (wall.t - 0.32) / (spec.muzzle[2] + 0.1), 0, 1) : 0;
    this.retract += (want - this.retract) * Math.min(1, dt * 10);
    const hp = spec.hipPos, ap = spec.adsPos;
    const a = this.adsK;
    let gx = THREE.MathUtils.lerp(hp[0], ap[0], a), gy = THREE.MathUtils.lerp(hp[1], ap[1], a), gz = THREE.MathUtils.lerp(hp[2], ap[2], a);
    gx += Math.cos(this.bob) * 0.012 * this.bobK * (1 - a * 0.85) - this.lagY * 0.28 * (1 - a * 0.7);
    gy += -Math.abs(Math.sin(this.bob)) * 0.014 * this.bobK * (1 - a * 0.85) + this.lagP * 0.28 * (1 - a * 0.7) - lk * 0.03;
    gz -= (this.recP * 0.22 + this.cool * 0.0) * (1 - a * 0.5);
    // sprint: muzzle low across the body
    gx -= this.sprintK * 0.05;
    gy -= this.sprintK * 0.09;
    gz -= this.retract * 0.22;
    gy -= this.retract * 0.03;
    let pitchG = this.recP * 1.1 - this.lagP * 1.3 - this.sprintK * 0.72 + this.retract * 0.95;
    let yawG = this.recY * 1.1 - this.lagY * 1.3 + this.sprintK * 0.95 + (1 - a) * Math.atan2(gx, 22);
    let rollG = this.sprintK * 0.35 + this.leanK * 0.1 * (1 - a) - this.lagY * 0.6;
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
    this.lightPos.set(0.04, 0.043, 0.45).applyQuaternion(this.gunQuat).add(this.gunPos);
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
    if (this.busy || this.sprintK > 0.35 || this.retract > 0.72) return;
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
    c.fx.shell(p, right.x * 2.6 + this.m.vx, 1.8 + Math.random(), right.z * 2.6 + this.m.vz);
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
    for (const i of out.panes) c.send.pane(i);
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
    this.recP += k;
    this.recY += (Math.random() - 0.5) * 2 * spec.wander * (Math.PI / 180);
    this.pitch += k * 0.32;
    this.yaw += (Math.random() - 0.5) * spec.wander * (Math.PI / 180) * 0.5;
    this.punchR += (Math.random() - 0.5) * 0.02 * spec.kick;
    this.punchP += k * 0.2;
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
    void dir;
  }
}
