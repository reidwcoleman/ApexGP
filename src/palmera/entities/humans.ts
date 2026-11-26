// People: data + an instanced renderer with a procedural walk/run cycle.
import * as THREE from 'three';
import { prep, merge } from '../core/geo';
import { clamp, damp, pick } from '../core/math';
import type { Vehicle } from './vehicle';

export type HumanKind = 'player' | 'ped' | 'cop';
export type WeaponId = 'fist' | 'bat' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'grenade';
export const LONG_GUNS = new Set<WeaponId>(['smg', 'shotgun', 'rifle', 'sniper']);

let hid = 1;
export class Human {
  id = hid++;
  kind: HumanKind;
  pos = new THREE.Vector3();
  yaw = 0;
  vx = 0;
  vz = 0;
  dvx = 0;
  dvz = 0;
  vy = 0;
  onGround = true;
  swimming = false;
  health = 100;
  maxHealth = 100;
  /** a driver you hit: keeps after you even in your car */
  rage = false;
  /** walks along looking at a phone */
  texting = false;
  armor = 0;
  dead = false;
  down = 0; // seconds left lying down
  fall = 0; // 0 standing .. 1 lying
  deadT = 0;
  shirt: THREE.Color;
  pants: THREE.Color;
  skin: THREE.Color;
  hair: THREE.Color;
  phase = Math.random() * 6;
  animSpeed = 0;
  sprint = false;
  aim = 0;
  aimPitch = 0;
  punchT = 0;
  flinch = 0;
  weapon: WeaponId = 'fist';
  vehicle: Vehicle | null = null;
  hidden = false;
  // AI scratch
  state = 'walk';
  /** an animation to play while standing still (talk, listen, sit, dance...) */
  clip = '';
  stateT = 0;
  target = new THREE.Vector3();
  fleeFrom = new THREE.Vector3();
  blockId = -1;
  corner = 0;
  dir = 1;
  fireT = 0;
  arrestT = 0;
  car: Vehicle | null = null;
  lastHitByPlayer = 0;
  wanderT = 0;

  constructor(kind: HumanKind) {
    this.kind = kind;
    const skins = [0xf1c7a5, 0xd9a47c, 0xb87a52, 0x8d5a3b, 0x5e3b26, 0xf5d6be];
    this.skin = new THREE.Color(pick(skins));
    this.hair = new THREE.Color(pick([0x2a1d14, 0x4a3020, 0x111111, 0x8a6a3a, 0xd8c08a, 0x777777]));
    if (kind === 'cop') {
      this.shirt = new THREE.Color(0x2c4a78);
      this.pants = new THREE.Color(0x1d2433);
      this.hair = new THREE.Color(0x1a2333);
      this.health = this.maxHealth = 120;
    } else if (kind === 'player') {
      this.shirt = new THREE.Color(0x2fb9a8);
      this.pants = new THREE.Color(0xcab48a);
      this.skin = new THREE.Color(0xd9a47c);
      this.hair = new THREE.Color(0x2a1d14);
    } else {
      this.shirt = new THREE.Color(pick([0xff7f6e, 0xf7f3e8, 0x6ec6ff, 0xffd166, 0x9ad0a8, 0xf49ac1, 0xb39ddb, 0x4db6ac, 0xffffff, 0xff9f43, 0x546e7a]));
      this.pants = new THREE.Color(pick([0x2f3b52, 0xc8b28a, 0x3a3a3a, 0xeeeeee, 0x6d8aa8, 0x8b5e3c, 0xf2d0a0]));
    }
  }

  get alive() {
    return !this.dead;
  }
  get canAct() {
    return !this.dead && this.down <= 0;
  }

  hurt(amount: number, fromX: number, fromZ: number, knock = 0): boolean {
    if (this.dead) return false;
    if (this.armor > 0) {
      const a = Math.min(this.armor, amount * 0.7);
      this.armor -= a;
      amount -= a;
    }
    this.health -= amount;
    this.flinch = 0.3;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    if (knock > 0) {
      this.vx += (dx / d) * knock;
      this.vz += (dz / d) * knock;
      if (knock > 4) {
        this.down = Math.max(this.down, 2.2);
        this.vy = Math.min(knock * 0.4, 6);
        this.onGround = false;
      }
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.down = 999;
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- renderer
const PARTS = ['torso', 'head', 'hair', 'armUL', 'armUR', 'armFL', 'armFR', 'legL', 'legR', 'gun'] as const;
type Part = (typeof PARTS)[number];

function partGeo(p: Part): THREE.BufferGeometry {
  switch (p) {
    case 'torso': {
      const g = new THREE.BoxGeometry(0.44, 0.62, 0.24);
      g.translate(0, 0.31, 0);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.1) pos.setX(i, pos.getX(i) * 0.82);
      g.computeVertexNormals();
      return merge([prep(g, 0xffffff)]);
    }
    case 'head': {
      const g = new THREE.SphereGeometry(0.13, 8, 6);
      g.scale(0.92, 1.08, 1);
      g.translate(0, 0.14, 0);
      const nose = new THREE.BoxGeometry(0.04, 0.05, 0.05);
      nose.translate(0, 0.12, 0.125);
      return merge([prep(g, 0xffffff), prep(nose, 0xffffff)]);
    }
    case 'hair': {
      const g = new THREE.SphereGeometry(0.14, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
      g.scale(0.95, 0.9, 1.02);
      g.translate(0, 0.18, -0.01);
      return merge([prep(g, 0xffffff)]);
    }
    case 'armUL':
    case 'armUR': {
      const g = new THREE.BoxGeometry(0.13, 0.32, 0.13);
      g.translate(0, -0.16, 0);
      return merge([prep(g, 0xffffff)]);
    }
    case 'armFL':
    case 'armFR': {
      const g = new THREE.BoxGeometry(0.11, 0.3, 0.11);
      g.translate(0, -0.15, 0);
      const hand = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      hand.translate(0, -0.34, 0);
      return merge([prep(g, 0xffffff), prep(hand, 0xffffff)]);
    }
    case 'legL':
    case 'legR': {
      const g = new THREE.BoxGeometry(0.17, 0.9, 0.19);
      g.translate(0, -0.45, 0);
      const shoe = new THREE.BoxGeometry(0.17, 0.1, 0.3);
      shoe.translate(0, -0.95, 0.05);
      return merge([prep(g, 0xffffff), prep(shoe, 0x252525)]);
    }
    case 'gun': {
      const g = new THREE.BoxGeometry(0.06, 0.1, 0.26);
      g.translate(0, 0, 0.1);
      const grip = new THREE.BoxGeometry(0.05, 0.12, 0.06);
      grip.translate(0, -0.08, 0.0);
      return merge([prep(g, 0x2a2a2a), prep(grip, 0x1a1a1a)]);
    }
  }
}

const M = THREE.Matrix4;
export class HumanRenderer {
  meshes: Record<Part, THREE.InstancedMesh>;
  readonly cap = 160;
  private m = new M();
  private root = new M();
  private torso = new M();
  private tmp = new M();
  private tmp2 = new M();
  private sc = new THREE.Vector3();
  private white = new THREE.Color(1, 1, 1);
  private gunCol = new THREE.Color(0.8, 0.8, 0.8);
  private zero = new M().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.meshes = {} as Record<Part, THREE.InstancedMesh>;
    for (const p of PARTS) {
      const im = new THREE.InstancedMesh(partGeo(p), mat, this.cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, this.white);
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      im.count = 0;
      scene.add(im);
      this.meshes[p] = im;
    }
  }

  /** Advance animation state for one human. */
  animate(h: Human, dt: number) {
    const sp = Math.hypot(h.vx, h.vz);
    h.animSpeed = damp(h.animSpeed, h.onGround || h.swimming ? sp : h.animSpeed, 10, dt);
    h.phase += dt * (h.animSpeed * 1.85 + (h.swimming ? 2 : 0));
    if (h.punchT > 0) h.punchT = Math.max(0, h.punchT - dt);
    if (h.flinch > 0) h.flinch = Math.max(0, h.flinch - dt);
    const target = h.down > 0 || h.dead ? 1 : 0;
    h.fall = damp(h.fall, target, target ? 9 : 5, dt);
  }

  render(list: Human[], cam: THREE.Vector3, maxDist: number, skip?: Set<number>) {
    let n = 0;
    const md2 = maxDist * maxDist;
    for (const h of list) {
      if (h.hidden || h.vehicle || skip?.has(h.id)) continue;
      const dx = h.pos.x - cam.x, dz = h.pos.z - cam.z;
      if (dx * dx + dz * dz > md2) continue;
      if (n >= this.cap) break;
      this.pose(h, n);
      n++;
    }
    for (const p of PARTS) {
      const im = this.meshes[p];
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private set(p: Part, i: number, m: THREE.Matrix4, c: THREE.Color) {
    const im = this.meshes[p];
    im.setMatrixAt(i, m);
    im.setColorAt(i, c);
  }

  private pose(h: Human, i: number) {
    const run = clamp(h.animSpeed / 6.5, 0, 1);
    const moving = clamp(h.animSpeed / 1.2, 0, 1);
    const s = Math.sin(h.phase);
    let legA = s * (0.35 + 0.45 * run) * moving;
    let armA = -s * (0.3 + 0.5 * run) * moving;
    let elbow = -0.25 - 0.95 * run * moving;
    const bob = Math.abs(Math.cos(h.phase)) * 0.06 * moving * (0.5 + run);
    let lean = 0.08 * run * moving;
    if (!h.onGround && !h.swimming) {
      legA = 0.45;
      armA = -0.6;
      elbow = -0.5;
    }
    if (h.flinch > 0) lean -= h.flinch * 0.9;
    // root
    const R = this.root;
    R.makeRotationY(h.yaw);
    let y = h.pos.y + bob;
    if (h.swimming) {
      y = h.pos.y + 0.2;
    }
    R.setPosition(h.pos.x, y, h.pos.z);
    if (h.fall > 0.01) {
      this.tmp.makeRotationX(-h.fall * Math.PI * 0.5);
      this.tmp2.makeTranslation(0, h.fall * 0.14, 0);
      R.multiply(this.tmp2).multiply(this.tmp);
      legA *= 1 - h.fall;
      armA = armA * (1 - h.fall) - h.fall * 2.4;
    }
    if (h.swimming) {
      this.tmp.makeRotationX(1.1);
      this.tmp2.makeTranslation(0, 0.9, 0);
      R.multiply(this.tmp2).multiply(this.tmp).multiply(this.tmp2.makeTranslation(0, -0.9, 0));
      legA = s * 0.4;
      armA = -2.4 + Math.sin(h.phase * 1.5) * 0.9;
    }
    // torso at hips (y = 0.98)
    const T = this.torso.copy(R).multiply(this.tmp.makeTranslation(0, 0.98, 0)).multiply(this.tmp2.makeRotationX(lean));
    this.set('torso', i, T, h.shirt);
    // head
    this.m.copy(T).multiply(this.tmp.makeTranslation(0, 0.64, 0)).multiply(this.tmp2.makeRotationX(-h.aimPitch * 0.5 * h.aim));
    this.set('head', i, this.m, h.skin);
    this.set('hair', i, this.m, h.hair);
    // legs
    for (const side of [-1, 1]) {
      this.m.copy(R).multiply(this.tmp.makeTranslation(side * 0.11, 0.98, 0)).multiply(this.tmp2.makeRotationX(legA * side));
      this.set(side < 0 ? 'legL' : 'legR', i, this.m, h.pants);
    }
    // arms
    const armed = h.weapon !== 'fist' && h.weapon !== 'bat' && h.weapon !== 'grenade';
    const aimW = h.aim;
    for (const side of [-1, 1]) {
      let a = armA * side;
      let el = elbow;
      let spread = 0.06;
      const right = side < 0;
      if (h.fall < 0.5) {
        if (right && h.punchT > 0) {
          const t = 1 - h.punchT / 0.38;
          const ext = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
          a = -1.55 * ext + a * (1 - ext);
          el = -0.2 * ext - 1.4 * (1 - ext);
          spread = 0;
        }
        if (aimW > 0.01 && (right || LONG_GUNS.has(h.weapon))) {
          const ta = -Math.PI / 2 - h.aimPitch;
          a = a * (1 - aimW) + ta * aimW;
          el = el * (1 - aimW);
          spread = right ? 0.0 : -0.35;
        }
      }
      // shoulders at (±0.28, 0.58) in torso space
      this.m.copy(T).multiply(this.tmp.makeTranslation(side * 0.28, 0.58, 0)).multiply(this.tmp2.makeRotationX(a));
      this.m.multiply(this.tmp.makeRotationZ(side * spread));
      if (!right && aimW > 0.01 && LONG_GUNS.has(h.weapon)) this.m.multiply(this.tmp.makeRotationY(-0.5 * aimW));
      this.set(right ? 'armUR' : 'armUL', i, this.m, h.shirt);
      this.m.multiply(this.tmp.makeTranslation(0, -0.32, 0)).multiply(this.tmp2.makeRotationX(el));
      this.set(right ? 'armFR' : 'armFL', i, this.m, h.skin);
      if (right) {
        if (armed && !h.dead) {
          this.m.multiply(this.tmp.makeTranslation(0, -0.34, 0.02)).multiply(this.tmp2.makeRotationX(Math.PI / 2));
          if (LONG_GUNS.has(h.weapon)) this.m.multiply(this.tmp.makeScale(1.2, 1.3, h.weapon === 'smg' ? 1.6 : 2.6));
          this.set('gun', i, this.m, this.gunCol);
        } else this.set('gun', i, this.zero, this.gunCol);
      }
    }
    void this.sc;
  }

  /** Muzzle world position for a human with a gun (approximation from pose). */
  static muzzle(h: Human, out: THREE.Vector3): THREE.Vector3 {
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const rx = -fz, rz = fx;
    const reach = 0.75 * Math.cos(h.aimPitch);
    return out.set(h.pos.x + fx * (0.15 + reach) + rx * 0.26, h.pos.y + 1.56 + Math.sin(h.aimPitch) * 0.75, h.pos.z + fz * (0.15 + reach) + rz * 0.26);
  }
}
