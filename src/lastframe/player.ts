import * as THREE from 'three';
import { move, type Mover, type World } from './collide.ts';
import { F, WEAPONS, WEAPON_LIST, W_BOOT, ZONE, zoneK, type NadeKind, type WeaponId } from './shared.ts';
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
  /** a stiff one that rings: stepped finely enough to stay stable at any frame rate */
  ring(dt: number, k: number, c: number) {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    for (let i = 0; i < n; i++) this.step(dt / n, 0, k, c);
    return this.x;
  }
  reset() {
    this.x = this.v = 0;
  }
}

/** reloads as poses on a timeline: t, then pitch, yaw, roll (radians) and x, y, toward-the-chest (metres), added to the gun */
const RELOAD_MAG: number[][] = [
  [0.0, 0, 0, 0, 0, 0, 0],
  [0.1, 0.1, 0.18, 0.5, -0.018, -0.028, 0.012],
  [0.2, 0.16, 0.24, 0.62, -0.024, -0.012, 0.018],
  [0.4, 0.21, 0.27, 0.69, -0.03, -0.042, 0.026],
  [0.6, 0.25, 0.3, 0.73, -0.032, -0.05, 0.03],
  [0.69, 0.11, 0.27, 0.6, -0.028, -0.014, 0.026],
  [0.8, 0.13, 0.16, 0.36, -0.02, -0.03, 0.016],
  [0.9, 0.04, 0.06, 0.12, -0.006, -0.012, 0.004],
  [1.0, 0, 0, 0, 0, 0, 0],
];
const RELOAD_PISTOL: number[][] = [
  [0.0, 0, 0, 0, 0, 0, 0],
  [0.12, 0.3, 0.12, 0.25, -0.01, -0.03, 0.05],
  [0.22, 0.38, 0.14, 0.3, -0.012, -0.015, 0.06],
  [0.6, 0.42, 0.16, 0.32, -0.014, -0.04, 0.07],
  [0.69, 0.28, 0.14, 0.26, -0.012, -0.01, 0.06],
  [0.86, 0.2, 0.06, 0.12, -0.006, -0.02, 0.04],
  [1.0, 0, 0, 0, 0, 0, 0],
];
const RELOAD_SINGLE: number[][] = [
  [0.0, 0, 0, 0, 0, 0, 0],
  [0.07, 0.15, 0.16, 0.6, -0.02, -0.045, 0.02],
  [0.5, 0.17, 0.17, 0.64, -0.022, -0.05, 0.022],
  [0.93, 0.15, 0.16, 0.6, -0.02, -0.045, 0.02],
  [1.0, 0, 0, 0, 0, 0, 0],
];
/** Catmull-Rom through the keys */
function sampleKeys(keys: number[][], t: number, out: number[]): number[] {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(keys.length - 1, i + 2)];
  const u = THREE.MathUtils.clamp((t - b[0]) / Math.max(1e-4, c[0] - b[0]), 0, 1);
  const u2 = u * u, u3 = u2 * u;
  for (let k = 1; k < b.length; k++) {
    const p0 = a[k], p1 = b[k], p2 = c[k], p3 = d[k];
    out[k - 1] = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  }
  return out;
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
    // no menu on a right click anywhere while there's a match on screen
    addEventListener('contextmenu', (e) => {
      if (this.locked() || e.target === el) e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked()) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked()) return;
      // a Mac turns control-click into a right click: holding crouch must not change what the left button does
      if (e.button === 0 || (e.button === 2 && e.ctrlKey)) {
        this.fire = true;
        this.firePressed = true;
      } else if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 || (e.button === 2 && e.ctrlKey)) this.fire = false;
      else if (e.button === 2) this.ads = false;
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
    kick(i: number, from: [number, number, number]): void;
    heal(): void;
    pane(i: number, at?: [number, number, number]): void;
    nade(kind: NadeKind, o: [number, number, number], v: [number, number, number], fuse: number): void;
  };
  muzzleLight(p: THREE.Vector3): void;
  prompt(s: string): void;
  hitMark(kill: boolean): void;
}

const Q180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const WALK = 2.75, RUN = 5.1, CROUCH = 1.55;
/** a head-mounted lens sees wide */
const FOV = 100;
const BANDAGE = 3.2;

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
  private reloadPose = [0, 0, 0, 0, 0, 0];
  private heat = 0;
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
  /** the gun swings inside the frame before the head follows */
  freeAim = true;
  private aimX = 0;
  private aimY = 0;
  /** wounds: a leg drags, an arm shakes, and blood leaves until it's wrapped */
  limp = 0;
  arm = 0;
  bleed = 0;
  hp = 100;
  wraps = 2;
  healT = 0;
  /** rounds going past */
  supK = 0;
  private kickT = 0;
  private kickCool = 0;
  private kicked = false;
  private breathT = 0;
  private heartT = 0;
  private chambered = false;
  /** how wound up the wearer is, 0 to 1: rounds going past, a wound, a fight a moment ago. It's in the hands */
  stress = 0;
  private fight = 0;
  private tremT = 0;
  /** this reload is going to go wrong once */
  private fumble = false;
  /** the chest under the camera: its phase, faster and deeper when spent or scared */
  private chest = 0;
  private exert = 0;
  /** the camera's clip on the vest: it rings after a knock, and slips: pitch, roll, yaw off true */
  private jigP = new Sp();
  private jigR = new Sp();
  private mountP = 0;
  private mountR = 0;
  private mountY = 0;
  /** a hand comes up and sets it straight: seconds left of that, when the next one is due, where it's being put */
  private fixT = 0;
  private fixWait = 60;
  private fixTo = [0, 0, 0];
  /** 0 to 1 while the support hand is up at the camera */
  fixK = 0;
  /** the wearer, without the camera's own slip: what the arms hang off */
  private bodyQ = new THREE.Quaternion();

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
    this.aimX = this.aimY = this.limp = this.arm = this.bleed = this.supK = this.healT = this.kickT = 0;
    this.hp = 100;
    this.wraps = 2;
    this.stamina = 1;
    this.mantle = null;
    this.slideT = this.stun = this.climb = this.climbY = this.trauma = 0;
    for (const q of [this.swayY, this.swayP, this.inX, this.inY, this.inZ, this.rkZ, this.rkP, this.rkY, this.rkR, this.camP, this.camR, this.jigP, this.jigR]) q.reset();
    this.stress = this.fight = this.fixT = this.fixK = 0;
    this.fumble = false;
    // clipped on in a hurry: never quite level
    this.mountR = (Math.random() - 0.5) * 0.03;
    this.mountP = -Math.random() * 0.015;
    this.mountY = 0;
    this.fixWait = 45 + Math.random() * 60;
  }

  /** something jolts the camera on its clip: it rings, and may not come back to where it was */
  private knock(k: number, slip = k) {
    this.jigP.v += (Math.random() - 0.35) * k * 22;
    this.jigR.v += (Math.random() - 0.5) * k * 26;
    this.mountR = THREE.MathUtils.clamp(this.mountR + (Math.random() - 0.5) * 2 * slip, -0.075, 0.075);
    this.mountP = THREE.MathUtils.clamp(this.mountP + (Math.random() - 0.72) * slip, -0.085, 0.03);
    this.mountY = THREE.MathUtils.clamp(this.mountY + (Math.random() - 0.5) * slip * 0.6, -0.03, 0.03);
  }

  /** a boot comes down: the vest takes it and the lens with it */
  private footfall(speed: number) {
    const k = Math.min(1.6, speed / WALK) * (this.crouch ? 0.5 : 1);
    this.jigP.v -= 0.22 * k * (0.7 + Math.random() * 0.6);
    this.jigR.v += (Math.random() - 0.5) * 0.3 * k;
    if (speed > 4) this.knock(0, 0.0016);
  }

  /** Gun Game hands you the next one: whatever you held is gone, this is loaded */
  rearm(id: WeaponId, sol: Soldier, sound: Sound) {
    this.slots = [id, 'pistol'];
    this.cur = 0;
    this.ammo.clear();
    for (const w of this.slots) this.ammo.set(w, { mag: WEAPONS[w].mag, res: WEAPONS[w].reserve });
    this.reloadT = this.cycleT = this.cool = 0;
    this.switchT = 0;
    this.rkP.v -= 2.4;
    this.inY.v -= 0.5;
    sol.setWeapon(id);
    sound.clack(null, 'draw');
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
    const sensK = this.sens * (1 - this.adsK * (1 - spec.adsFov / FOV) * 0.9);
    const rawYaw = -i.dx * sensK, rawPitch = -i.dy * sensK;
    // the arms move first, inside a small box; past its edge the head turns too. Raising the sights
    // shrinks the box, so the frame slides onto wherever the gun was already pointing.
    const box = this.freeAim ? (1 - this.adsK) * (1 - this.sprintK) : 0;
    const ax = this.aimX + rawYaw, ay = this.aimY + rawPitch;
    this.aimX = THREE.MathUtils.clamp(ax, -0.1 * box, 0.1 * box);
    this.aimY = THREE.MathUtils.clamp(ay, -0.07 * box, 0.07 * box);
    const dYaw = ax - this.aimX, dPitch = ay - this.aimY;
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
    const wantRun = i.keys.has('ShiftLeft') && f > 0 && !this.crouch && !i.ads && this.stamina > 0.04 && !i.fire && this.healT <= 0 && this.limp < 0.8;
    const run = wantRun && !freeze;
    this.stamina = Math.min(1, Math.max(0, this.stamina + (run ? -dt / 7 : dt / 5)));
    let top = this.crouch ? CROUCH : run ? RUN : WALK;
    top *= spec.speed * (1 - this.adsK * 0.42) * (1 - this.stun * 0.55) * (1 - this.limp * 0.36) * (this.healT > 0 ? 0.5 : 1) * (1 - this.supK * 0.12);
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
      const A = !m.grounded ? 3.4 : !pressing ? 9.5 : against ? 15 : run ? 7.5 : 10.5;
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
      this.knock(Math.min(0.06, hit * 0.008), hit > 3.5 ? Math.min(0.03, (hit - 3.5) * 0.008) : 0);
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
        c.sound.step(null, c.surfaceAt(m.x, m.y, m.z), speed, this.crouch ? 0.45 : 1.05);
        c.fx.tread(this.slot, m.x, m.y, m.z, Math.atan2(-m.vx, -m.vz));
        this.footfall(speed);
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
    // the camera's on the vest, a hand below the eyes: the world sits a little higher in the picture
    const eyeH = 1.4 - this.crouchK * 0.5 - (this.slideT > 0 ? 0.12 : 0);
    // a camera on a head: every footfall lands in the picture, and a bad leg lands harder on one side
    const bobY = (Math.abs(Math.sin(this.bob)) * 0.046 + this.limp * Math.max(0, Math.sin(this.bob * 0.5)) ** 3 * 0.075) * this.bobK * (1 - this.adsK * 0.6);
    const bobX = Math.cos(this.bob) * 0.046 * this.bobK * (1 - this.adsK * 0.7);
    this.breath += dt;
    this.exert += (Math.max(1 - this.stamina, this.stress * 0.75) - this.exert) * Math.min(1, dt * 1.5);
    this.chest += dt * (1.55 + 2.6 * this.exert);
    const heave = Math.sin(this.chest) * (1 + 2.6 * this.exert);
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
    // a vest rises and falls with the breath under it
    const eye = this.eye.set(m.x + rx * (lean + bobX), m.y + eyeH + m.stepEase + bobY - lk * 0.1 + heave * 0.006, m.z + rz * (lean + bobX));
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
    const rY = dt > 0 ? rawYaw / dt : 0, rP = dt > 0 ? rawPitch / dt : 0;
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
    // the head rolls into a fast turn, then catches up
    this.camR.step(dt, THREE.MathUtils.clamp(-(dt > 0 ? dYaw / dt : 0) * 0.011, -0.05, 0.05), 150, 17);
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
    // tired, hurt, or under fire: nothing holds still
    const shaky = 1 + (1 - this.stamina) * 1.7 + this.arm * 1.8 + this.supK * 1.4 + this.stress * 1.2;
    const swayP = (Math.sin(this.breath * 1.3) * 0.0042 + Math.sin(this.breath * 2.7 + 1) * 0.0016) * shaky + Math.sin(this.bob * 2) * 0.0058 * this.bobK;
    const swayY = (Math.sin(this.breath * 0.9) * 0.0036 + Math.sin(this.breath * 2.1) * 0.0014) * shaky + Math.cos(this.bob) * 0.0075 * this.bobK;
    const roll = -this.leanK * 0.2 + Math.cos(this.bob) * 0.042 * this.bobK + heave * 0.003 + this.punchR - s * 0.012 * (speed / WALK) + shR + this.camR.x + (this.slideT > 0 ? 0.07 : 0) + this.mantleK * 0.05 * Math.sin((this.mantle?.t ?? 0) * 6);
    this.e.set(this.pitch + this.recP * camK + this.punchP + swayP * (1 - this.adsK * 0.75) + shP + this.camP.x - this.mantleK * 0.13 + heave * 0.0022, this.yaw + this.recY * camK + this.punchY + swayY * (1 - this.adsK * 0.75) + shY, roll, 'YXZ');
    cam.position.copy(eye);
    this.bodyQ.setFromEuler(this.e);
    // the lens is clipped to a vest, not screwed to a skull: it rings after every knock and sits wherever it has slipped
    // to, until a hand comes up and squares it. The arms and the gun hang off the wearer, not off the picture
    this.jigP.ring(dt, 3000, 15);
    this.jigR.ring(dt, 2400, 13);
    let fixP = 0, fixR = 0;
    if (this.fixT > 0) {
      const LEN = 1.3;
      const kb = 1 - this.fixT / LEN;
      this.fixT -= dt;
      const k = 1 - Math.max(0, this.fixT) / LEN;
      const held = THREE.MathUtils.smoothstep(k, 0.2, 0.3) * (1 - THREE.MathUtils.smoothstep(k, 0.76, 0.88));
      this.fixK = THREE.MathUtils.smoothstep(k, 0, 0.24) * (1 - THREE.MathUtils.smoothstep(k, 0.78, 1));
      if (kb < 0.24 && k >= 0.24) {
        // fingers on it
        c.sound.cloth();
        this.jigP.v += 1.1;
        this.jigR.v -= 0.9;
      }
      if (kb < 0.8 && k >= 0.8) this.jigP.v -= 0.5;
      // pushed about while it's held, and left near enough true
      const r = Math.min(1, dt * 7) * held;
      this.mountP += (this.fixTo[0] - this.mountP) * r;
      this.mountR += (this.fixTo[1] - this.mountR) * r;
      this.mountY += (this.fixTo[2] - this.mountY) * r;
      fixP = held * (Math.sin(k * 26) * 0.012 + Math.sin(k * 41 + 1) * 0.006);
      fixR = held * (Math.sin(k * 21 + 2) * 0.016 + Math.sin(k * 35) * 0.007);
      if (this.fixT <= 0) this.fixK = 0;
    }
    this.e.set(this.mountP + this.jigP.x + fixP, this.mountY, this.mountR + this.jigR.x + fixR, 'YXZ');
    cam.quaternion.copy(this.bodyQ).multiply(this.q.setFromEuler(this.e));
    const fov = THREE.MathUtils.lerp(FOV, spec.adsFov, this.adsK) + this.sprintK * 3;
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
    gx -= this.aimX * 0.32;
    gy += this.aimY * 0.3;
    // hands busy: the gun comes down for a bandage, swings aside for a kick
    const healK = this.healT > 0 ? Math.min(1, this.healT * 4) : 0;
    const kickK = this.kickT > 0 ? Math.sin(Math.min(1, this.kickT / 0.55) * Math.PI) : 0;
    gy -= healK * 0.2 + kickK * 0.05;
    gx += kickK * 0.06;
    let pitchG = this.aimY + this.recP * 0.7 + this.rkP.x - sp2 * 1.3 - this.sprintK * 0.72 + this.retract * 0.95 - this.mantleK * 0.6;
    let yawG = this.aimX + this.recY * 0.7 + this.rkY.x - sy2 * 1.3 + this.sprintK * 0.95 + (1 - a) * Math.atan2(gx, 12) + this.mantleK * 0.5;
    pitchG -= healK * 0.7;
    yawG -= kickK * 0.4;
    let rollG = (1 - a) * 0.2 + this.sprintK * 0.35 + this.leanK * 0.1 * (1 - a) - sy2 * 0.6 + this.rkR.x - this.inX.x * 3 * free + (this.slideT > 0 ? 0.3 : 0);
    // reload and bolt movements
    if (this.reloadT > 0) {
      const t = 1 - this.reloadT / this.reloadLen;
      const single = this.weapon === 'shotgun' || this.weapon === 'rifle';
      const k = sampleKeys(single ? RELOAD_SINGLE : this.weapon === 'pistol' ? RELOAD_PISTOL : RELOAD_MAG, t, this.reloadPose);
      pitchG += k[0];
      yawG += k[1];
      rollG += k[2];
      gx += k[3];
      gy += k[4];
      gz -= k[5];
    }
    if (this.switchT > 0) {
      const t = this.switchT / 0.55;
      gy -= Math.sin(t * Math.PI) * 0.3;
      pitchG -= Math.sin(t * Math.PI) * 0.9;
    }
    const cyc = this.cycleT > 0 ? Math.sin((1 - this.cycleT / this.cycleLen) * Math.PI) : 0;
    // ---- the hands under pressure: a fast fine tremor, in bursts, worst when they have something fiddly to do
    {
      const st = this.stress;
      this.tremT += dt * (58 + 22 * st);
      const tt2 = this.tremT;
      const burst = 0.55 + 0.45 * Math.sin(this.breath * 2.3) * Math.sin(this.breath * 0.71 + 1);
      const amp = st * st * burst * (this.reloadT > 0 ? 2.4 : 1) * (1 - a * 0.45) * (this.crouch ? 0.8 : 1) + this.arm * 0.25;
      pitchG += amp * 0.0125 * (Math.sin(tt2) * 0.6 + Math.sin(tt2 * 1.618 + 1.3) * 0.4);
      yawG += amp * 0.011 * (Math.sin(tt2 * 0.93 + 2) * 0.6 + Math.sin(tt2 * 1.47) * 0.4);
      rollG += amp * 0.03 * Math.sin(tt2 * 1.21 + 4);
      gx += amp * 0.0016 * Math.sin(tt2 * 1.13 + 0.5);
      gy += amp * 0.0019 * Math.sin(tt2 * 0.87 + 3);
      // one hand is up at the camera: the muzzle sags and the gun rolls out
      gy -= this.fixK * 0.035;
      pitchG -= this.fixK * 0.13;
      rollG += this.fixK * 0.16;
      yawG += this.fixK * 0.05;
    }
    this.gunPos.set(gx, gy, -gz).applyQuaternion(this.bodyQ).add(eye);
    this.e.set(pitchG, yawG, rollG, 'YXZ');
    this.q.setFromEuler(this.e);
    this.gunQuat.copy(this.bodyQ).multiply(this.q).multiply(Q180);
    this.barrel.set(0, 0, 1).applyQuaternion(this.gunQuat);
    const gun = sol.gun;
    if (gun) {
      if (gun.dot) gun.dot.visible = this.adsK > 0.72;
      gun.group.position.copy(this.gunPos);
      gun.group.quaternion.copy(this.gunQuat);
      if (gun.action) {
        let back = this.weapon === 'pistol' ? Math.max(0, this.cool / spec.cycle) * 0.03 : cyc * (this.weapon === 'rifle' ? 0.09 : 0.1);
        if (this.reloadT > 0 && this.weapon === 'rifle') {
          // the bolt stays open while the rounds go in
          const t = 1 - this.reloadT / this.reloadLen;
          back = 0.09 * Math.min(1, t / 0.06, (1 - t) / 0.06);
        }
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
    sol.camHand = this.fixK;
    sol.camAt.set(-0.1, -0.13, -0.06).applyQuaternion(cam.quaternion).add(eye);
    // a hot barrel smokes after a string of shots
    this.heat = Math.max(0, this.heat - dt * 0.2);
    if (this.heat > 0.22 && this.sinceShot > 0.1 && Math.random() < dt * 26 * this.heat) {
      c.fx.wisp(this.v.set(spec.muzzle[0], spec.muzzle[1], spec.muzzle[2] - 0.02).applyQuaternion(this.gunQuat).add(this.gunPos), this.heat);
    }
    // ahead of the muzzle: a torch on the rail lights the room, not the gun it's clamped to
    this.lightPos.set(0.04, 0.043, spec.muzzle[2] + 0.03).applyQuaternion(this.gunQuat).add(this.gunPos);
    this.body(dt, c);
    if (freeze) return;
    this.actions(dt, i, c, cam, sol);
  }

  /** what the wearer's own chest is doing */
  private body(dt: number, c: PlayerCtx) {
    this.limp = Math.max(0, this.limp - dt / 80);
    this.arm = Math.max(0, this.arm - dt / 80);
    this.supK = Math.max(0, this.supK - dt * 0.42);
    // nerves: up in a moment, a long time going down
    this.fight = Math.max(0, this.fight - dt * 0.07);
    const want = Math.min(1, this.supK * 0.95 + (this.hp < 60 ? ((60 - this.hp) / 60) * 0.55 : 0) + (this.bleed > 0 ? 0.15 : 0) + this.fight);
    this.stress += (want - this.stress) * Math.min(1, dt * (want > this.stress ? 4 : 0.16));
    // running works the clip loose, a little at a time
    if (this.sprintK > 0.5) {
      this.mountR = THREE.MathUtils.clamp(this.mountR + (Math.random() - 0.5) * dt * 0.012, -0.075, 0.075);
      this.mountP = Math.max(-0.085, this.mountP - dt * 0.0011);
    }
    // now and then, when nothing else is going on, a hand comes up and squares it: sooner if it has slipped badly
    this.fixWait -= dt;
    const slip = Math.abs(this.mountR) + Math.abs(this.mountP) * 0.8 + Math.abs(this.mountY);
    const calm = this.sinceShot > 3 && !this.busy && this.adsK < 0.15 && this.sprintK < 0.2 && this.supK < 0.08 && this.healT <= 0 && this.kickT <= 0 && !this.mantle && this.m.grounded && this.slideT <= 0;
    if (this.fixT <= 0 && calm && (this.fixWait <= 0 || (slip > 0.07 && this.fixWait < 150))) {
      this.fixT = 1.3;
      this.fixWait = 110 + Math.random() * 110;
      this.fixTo = [-Math.random() * 0.012, (Math.random() - 0.5) * 0.022, (Math.random() - 0.5) * 0.008];
    }
    // hands needed elsewhere: let go of it
    if (this.fixT > 0.3 && !calm) this.fixT = 0.3;
    // the chest mic hears every breath: quiet at rest, ragged when spent, hurt or under fire
    const hard = Math.max(0.92 - this.stamina * 1.5, this.supK * 0.8, this.hp < 45 ? 0.45 : 0, Math.hypot(this.m.vx, this.m.vz) > 0.5 ? 0.12 : 0.04);
    this.breathT -= dt;
    if (this.breathT <= 0) {
      c.sound.breath(hard);
      this.breathT = (hard < 0.1 ? 3.4 : 2) - hard * 0.95 + Math.random() * 0.4;
    }
    this.heartT -= dt;
    if ((this.hp < 50 || this.supK > 0.55) && this.heartT <= 0) {
      c.sound.heart(Math.max(1 - this.hp / 50, this.supK * 0.6));
      this.heartT = 0.55 + Math.max(this.hp, 12) / 110;
    }
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
        // one at a time, each one pushed home with the thumb
        const n = spec.mag;
        if (Math.floor(before * n) !== Math.floor(after * n)) {
          if (this.fumble && after > 0.25 && after < 0.9) {
            // it slips through the fingers: on the floor, and another one to find
            this.fumble = false;
            this.reloadT = Math.min(this.reloadLen, this.reloadT + this.reloadLen / n);
            const at = new THREE.Vector3(0.01, -0.03, 0.12).applyQuaternion(this.gunQuat).add(this.gunPos);
            c.fx.shell(at, new THREE.Vector3(this.m.vx + (Math.random() - 0.5) * 0.8, 0.3, this.m.vz + (Math.random() - 0.5) * 0.8), this.gunQuat, spec.brass);
            this.rkR.v -= 1.6;
            this.rkP.v -= 1.2;
            this.inY.v -= 0.2;
          } else {
            c.sound.clack(null, 'shell');
            this.rkZ.v -= 0.5;
            this.rkR.v += 0.8;
          }
        }
      } else {
        if (before < 0.02) this.magGone = false;
        if (before < 0.18 && after >= 0.18) {
          c.sound.clack(null, 'mag_out');
          this.rkP.v -= 0.9;
        }
        if (this.fumble && before < 0.645 && after >= 0.645) {
          // the magazine catches the lip of the well instead of going in: back out, look, try again
          this.fumble = false;
          this.reloadT = this.reloadLen * (1 - 0.47);
          c.sound.clack(null, 'shell');
          this.rkR.v += 2.6;
          this.rkY.v += 1.6;
          this.rkP.v -= 1.4;
          this.inY.v -= 0.25;
        } else if (before < 0.68 && after >= 0.68) {
          // seated with the heel of the hand: the whole gun jumps
          c.sound.clack(null, 'mag_in');
          this.rkP.v -= 3.2;
          this.inY.v += 0.35;
          this.rkR.v -= 1.2;
        }
        if (before < 0.88 && after >= 0.88) {
          c.sound.clack(null, 'bolt');
          this.rkZ.v += 0.9;
          this.rkY.v -= 1.4;
        }
      }
      if (this.reloadT <= 0) {
        // one still in the pipe stays there
        const need = spec.mag + (this.chambered ? 1 : 0) - am.mag;
        // the reserve never runs out: every reload is a full one
        am.mag += need;
      }
      if (i.firePressed && (w === 'shotgun' || w === 'rifle') && after > 0.15) {
        // interrupt with what's loaded so far
        am.mag += Math.min(Math.floor(after * spec.mag), spec.mag - am.mag);
        this.reloadT = 0;
      }
    }
    if (i.take('KeyR') && !this.busy && this.healT <= 0 && am.mag < spec.mag && am.res > 0) {
      const dry = am.mag === 0;
      const single = w === 'shotgun' || w === 'rifle';
      this.chambered = !single && !dry;
      // from empty there's a bolt to send home as well; a shot arm fumbles it
      // and hands that won't keep still take longer over all of it, and sometimes miss
      this.reloadLen = (w === 'shotgun' ? 0.55 * (spec.mag - am.mag) + 0.3 : w === 'rifle' ? 0.6 * (spec.mag - am.mag) + 0.4 : spec.reload * (dry ? 1.24 : 1)) * (1 + this.arm * 0.35) * (1 + this.stress * 0.4);
      this.reloadT = this.reloadLen;
      this.fumble = Math.random() < THREE.MathUtils.clamp((this.stress - 0.3) * 1.1 + this.arm * 0.25, 0, 0.7);
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
    // ---- a bandage: both hands, and you can walk but not much else
    const hurtNow = this.hp < 100 || this.bleed > 0 || this.limp > 0.05 || this.arm > 0.05;
    if (i.keys.has('KeyH') && this.wraps > 0 && hurtNow && !this.busy && this.kickT <= 0) {
      if (this.healT <= 0) c.sound.cloth();
      const b = this.healT;
      this.healT += dt;
      if (Math.floor(b / 0.8) !== Math.floor(this.healT / 0.8)) c.sound.cloth();
      if (this.healT >= BANDAGE) {
        this.healT = 0;
        this.wraps--;
        c.send.heal();
      }
    } else this.healT = 0;
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
    // ---- a gun on the ground
    const lying = c.phys.gunNear(this.eye.x, this.eye.y, this.eye.z, fw.x, fw.y, fw.z, 2.1);
    const gunId = lying?.gun as WeaponId | undefined;
    const closer = lying && !near;
    c.prompt(this.healT > 0 ? 'Bandaging' : closer ? `F  Take ${WEAPONS[gunId!].name}` : near ? (near.want > 0 ? 'F  Close' : 'F  Open') : '');
    if (closer && i.take('KeyF') && !this.busy) this.takeGun(lying.i, gunId!, c, sol, fw);
    if (near && i.take('KeyF')) c.send.door(near.id, [this.m.x, this.m.y, this.m.z]);
    // ---- a boot: through a door, into a chest
    this.kickT = Math.max(0, this.kickT - dt);
    this.kickCool = Math.max(0, this.kickCool - dt);
    if (i.take('KeyZ') && this.kickCool <= 0 && !this.busy && !this.mantle && this.healT <= 0) {
      this.kickT = 0.55;
      this.kickCool = 1.05;
      this.kicked = false;
      this.stamina = Math.max(0, this.stamina - 0.1);
      this.camP.v -= 0.5;
      this.knock(0.02, 0.008);
      this.m.vx *= 0.4;
      this.m.vz *= 0.4;
    }
    if (this.kickT > 0 && this.kickT < 0.36 && !this.kicked) {
      this.kicked = true;
      this.boot(c, near, fw);
    }
    // ---- the trigger
    if (this.busy || this.sprintK > 0.35 || this.retract > 0.72 || this.mantle || this.slideT > 0.5 || this.healT > 0 || this.kickT > 0) return;
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

  private takeGun(i: number, id: WeaponId, c: PlayerCtx, sol: Soldier, fw: THREE.Vector3) {
    const had = this.slots[0];
    c.phys.takeGun(i);
    c.sound.clack(null, 'draw');
    if (id === had || id === 'pistol') {
      // same round: take what's in it
      const a = this.ammo.get(id);
      if (a) a.res += Math.ceil(WEAPONS[id].mag * 0.8);
      return;
    }
    if (this.cur === 0) {
      sol.letGo(c.phys, this.v.set(this.m.vx, 0, this.m.vz).clone(), fw);
      sol.gun!.group.visible = true;
    }
    this.ammo.delete(had);
    this.slots[0] = id;
    this.cur = 0;
    this.ammo.set(id, { mag: Math.ceil(WEAPONS[id].mag * 0.8), res: Math.floor(WEAPONS[id].reserve * 0.4) });
    this.reloadT = this.cycleT = 0;
    this.switchT = 0;
    sol.setWeapon(id);
  }

  private boot(c: PlayerCtx, door: Door | null, fw: THREE.Vector3) {
    const m = this.m;
    let hit = false;
    if (door) {
      c.send.kick(door.id, [m.x, m.y, m.z]);
      hit = true;
    }
    for (const [slot, b] of c.bodies()) {
      if (slot === this.slot) continue;
      const dx = b.x - m.x, dy = b.y - m.y, dz = b.z - m.z, l = Math.hypot(dx, dz);
      if (l > 1.75 || Math.abs(dy) > 1.3 || (dx * fw.x + dz * fw.z) / (l || 1) < 0.5) continue;
      c.send.hit(slot, 55, ZONE.torso, W_BOOT, [dx, 0.1, dz], l);
      hit = true;
      break;
    }
    const at = new THREE.Vector3(m.x + fw.x * 1, m.y + 0.5, m.z + fw.z * 1);
    c.phys.blast(at, 26, 1.1, () => true);
    c.sound.boot(hit);
    this.camP.v += hit ? 0.9 : 0.4;
    this.trauma = Math.min(1, this.trauma + (hit ? 0.28 : 0.1));
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
      this.knock(0.02, 0.012);
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
    const base = (THREE.MathUtils.lerp(spec.hip, spec.ads, this.adsK) + speed * spec.move * (1 - this.adsK * 0.6) + (this.m.grounded ? 0 : 3) + this.arm * 0.9 * (1 - this.adsK * 0.7)) * (1 + this.supK * 0.7);
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
      const d = spec.dmg * h.k * (h.zone === ZONE.head ? spec.headX : zoneK(h.zone));
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
    this.heat = Math.min(1, this.heat + (this.weapon === 'shotgun' ? 0.3 : this.weapon === 'rifle' ? 0.25 : 0.09));
    // from the hip the arms take it, and the muzzle walks inside the frame
    this.aimY += k * 0.5 * (1 - this.adsK);
    this.aimX += side * 1.3 * (1 - this.adsK);
    // the shot goes back through the wrists into the shoulder
    const hard = spec.kick * (1 - this.adsK * 0.35) * crouchK;
    this.rkZ.v += 0.42 * Math.sqrt(hard);
    this.rkP.v += hard * 0.22;
    this.rkY.v += side * 16;
    this.rkR.v += (Math.random() - 0.5) * hard * 0.5;
    this.camP.v += hard * 0.045;
    this.camR.v += (Math.random() - 0.5) * hard * 0.09;
    // the stock is in the shoulder the camera hangs from
    this.jigP.v += Math.sqrt(hard) * 0.5 * (1 - this.adsK * 0.3);
    this.jigR.v += (Math.random() - 0.5) * Math.sqrt(hard) * 0.7;
    this.fight = Math.min(0.3, this.fight + 0.012 * Math.sqrt(hard));
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

  /** rounds close enough to hear: k from 0 to 1 */
  suppress(k: number) {
    this.supK = Math.min(1, this.supK + k * 0.34);
    this.trauma = Math.min(1, this.trauma + k * 0.14);
    this.fight = Math.min(0.6, this.fight + k * 0.1);
  }

  healed() {
    this.bleed = 0;
    this.limp *= 0.35;
    this.arm *= 0.35;
    this.supK = 0;
    this.fight *= 0.4;
  }

  hurt(dir: [number, number, number], zone: number, dmg: number, bleed: number) {
    this.bleed = bleed;
    if (zone === ZONE.leg) {
      this.limp = Math.min(1, this.limp + 0.3 + dmg / 90);
      this.stamina = Math.max(0, this.stamina - 0.3);
    }
    if (zone === ZONE.limb) this.arm = Math.min(1, this.arm + 0.3 + dmg / 90);
    this.punchP += 0.05 + Math.random() * 0.04;
    this.punchY += (Math.random() - 0.5) * 0.09;
    this.punchR += (Math.random() - 0.5) * 0.09;
    this.hurtK = 1;
    // a hit shoves: some of the round's push reaches your feet
    this.m.vx += dir[0] * 0.8;
    this.m.vz += dir[2] * 0.8;
    this.stun = Math.max(this.stun, 0.5);
    this.inY.v -= 0.4;
    this.fight = Math.min(0.8, this.fight + 0.3 + dmg / 150);
    this.knock(0.05, 0.022);
  }
}
