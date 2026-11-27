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
  /** holding a fishing rod (game/fishing.ts): both hands forward at the hip */
  fishing = false;
  /** a cop-kind security guard (grey uniform) */
  guard = false;
  /** down on the pavement waiting for an ambulance */
  injured = false;
  /** a spot to hold (officers at a roadblock) */
  post: THREE.Vector3 | null = null;
  /** the player's clothes (Threadline) */
  outfit: import('../game/wardrobe').Outfit | null = null;
  /** crouched behind something (the player, in a gunfight) */
  inCover = false;
  /** 0-1 through a vault over a wall, planter or car bonnet (-1: not vaulting) */
  vaultU = -1;
  /** sideways roll of a bonnet slide */
  vaultRoll = 0;
  /** in the air: 1 freefall (face down), 2 hanging under a parachute */
  sky = 0;
  /** an open umbrella (its canopy colour) held up in the rain, or null */
  umbrella: number | null = null;
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

/** a limb: a rounded tube from y=0 down to y=-len, tapering from r0 to r1 */
function limb(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(1, len, 3, 7);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const half = len / 2 + 1;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // the caps are unit spheres; scale each ring by the radius at its height
    const t = clamp((half - y) / (2 * half), 0, 1);
    const r = r0 + (r1 - r0) * t;
    const yy = y > len / 2 ? len / 2 + (y - len / 2) * r : y < -len / 2 ? -len / 2 + (y + len / 2) * r : y;
    pos.setXYZ(i, pos.getX(i) * r, yy - len / 2 - r0 * 0.5, pos.getZ(i) * r * 0.95);
  }
  g.computeVertexNormals();
  return g;
}

function partGeo(p: Part): THREE.BufferGeometry {
  switch (p) {
    case 'torso': {
      // a tapered, rounded chest: wide at the shoulders, narrower at the waist, flatter front to back
      const g = new THREE.CylinderGeometry(0.2, 0.165, 0.6, 10, 3);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        // round the shoulders off and give the chest a little depth
        const top = clamp((y - 0.18) / 0.12, 0, 1);
        pos.setX(i, pos.getX(i) * (1 - top * 0.18));
        pos.setZ(i, pos.getZ(i) * (0.62 - top * 0.12) + (y > 0 && pos.getZ(i) > 0 ? 0.015 : 0));
      }
      g.translate(0, 0.3, 0);
      const sh: THREE.BufferGeometry[] = [];
      for (const sx of [-1, 1]) {
        const b = new THREE.SphereGeometry(0.085, 8, 6);
        b.scale(1, 0.9, 1);
        b.translate(sx * 0.19, 0.55, 0);
        sh.push(prep(b, 0xffffff));
      }
      // a belt line, then the hips in the trouser colour are drawn by the legs
      const belt = new THREE.CylinderGeometry(0.168, 0.17, 0.05, 10);
      belt.scale(1, 1, 0.62);
      belt.translate(0, 0.02, 0);
      g.computeVertexNormals();
      return merge([prep(g, 0xffffff), ...sh, prep(belt, 0x2a2622)]);
    }
    case 'head': {
      const g = new THREE.SphereGeometry(0.115, 12, 9);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        // a jaw: narrower below the cheekbones
        if (y < 0) pos.setX(i, pos.getX(i) * (1 + y * 1.6));
        if (y < -0.02 && pos.getZ(i) < 0) pos.setZ(i, pos.getZ(i) * 0.8);
      }
      g.scale(0.9, 1.12, 1);
      g.computeVertexNormals();
      g.translate(0, 0.16, 0.01);
      const neck = new THREE.CylinderGeometry(0.05, 0.058, 0.12, 7);
      neck.translate(0, 0.03, 0);
      const nose = new THREE.ConeGeometry(0.022, 0.05, 4);
      nose.rotateX(Math.PI / 2);
      nose.translate(0, 0.15, 0.115);
      const ears: THREE.BufferGeometry[] = [];
      for (const sx of [-1, 1]) {
        const e = new THREE.SphereGeometry(0.025, 5, 4);
        e.scale(0.5, 1, 0.8);
        e.translate(sx * 0.103, 0.16, 0);
        ears.push(prep(e, 0xffffff));
      }
      return merge([prep(g, 0xffffff), prep(neck, 0xffffff), prep(nose, 0xffffff), ...ears]);
    }
    case 'hair': {
      const g = new THREE.SphereGeometry(0.124, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
      g.scale(0.94, 0.95, 1.04);
      g.translate(0, 0.2, -0.004);
      // a little at the back of the neck
      const back = new THREE.SphereGeometry(0.105, 8, 4, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.25);
      back.scale(0.95, 1, 1);
      back.translate(0, 0.2, -0.02);
      return merge([prep(g, 0xffffff), prep(back, 0xffffff)]);
    }
    case 'armUL':
    case 'armUR': {
      return merge([prep(limb(0.2, 0.068, 0.056), 0xffffff)]);
    }
    case 'armFL':
    case 'armFR': {
      const hand = new THREE.SphereGeometry(0.05, 6, 5);
      hand.scale(0.75, 1.3, 0.55);
      hand.translate(0, -0.33, 0.01);
      return merge([prep(limb(0.2, 0.052, 0.042), 0xffffff), prep(hand, 0xffffff)]);
    }
    case 'legL':
    case 'legR': {
      // thigh and shin in one tapered tube, a hip cap at the top, a rounded shoe
      const g = limb(0.82, 0.095, 0.06);
      const hip = new THREE.SphereGeometry(0.1, 8, 6);
      hip.scale(1, 0.8, 0.95);
      hip.translate(0, -0.03, 0);
      const shoe = new THREE.SphereGeometry(0.07, 8, 5);
      shoe.scale(0.95, 0.6, 1.9);
      shoe.translate(0, -0.935, 0.05);
      return merge([prep(g, 0xffffff), prep(hip, 0xffffff), prep(shoe, 0x252525)]);
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
    const rest = h.dead ? '' : h.state === 'towel' || h.state === 'lounge' || h.state === 'bench' ? h.state : '';
    let legRest = 0;
    let ox = 0, oy = 0;
    if (rest) {
      legA = 0;
      armA = rest === 'bench' ? -0.35 : 0;
      elbow = rest === 'bench' ? -0.9 : -0.1;
      lean = rest === 'bench' ? -0.08 : 0;
      // place the hips (0.98 above the root) and lean the torso back from them, legs out in front
      if (rest === 'towel') oy = 0.13 - 0.98, ox = -0.93, lean = -Math.PI / 2 + 0.04, legRest = -Math.PI / 2 + 0.02;
      else if (rest === 'lounge') oy = 0.46 - 0.98, ox = -0.42, lean = -0.9, legRest = -Math.PI / 2 + 0.1;
      else oy = -0.42, ox = -0.22, legRest = -1.05;
    }
    // root
    const R = this.root;
    R.makeRotationY(h.yaw);
    let y = h.pos.y + (rest ? oy : bob);
    if (h.swimming) {
      y = h.pos.y + 0.2;
    }
    R.setPosition(h.pos.x + Math.sin(h.yaw) * ox, y, h.pos.z + Math.cos(h.yaw) * ox);
    if (h.fall > 0.01 && !rest) {
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
      this.m.copy(R).multiply(this.tmp.makeTranslation(side * 0.1, 0.98, 0)).multiply(this.tmp2.makeRotationX(legA * side + legRest));
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
      this.m.copy(T).multiply(this.tmp.makeTranslation(side * 0.215, 0.535, 0)).multiply(this.tmp2.makeRotationX(a));
      this.m.multiply(this.tmp.makeRotationZ(side * spread));
      if (!right && aimW > 0.01 && LONG_GUNS.has(h.weapon)) this.m.multiply(this.tmp.makeRotationY(-0.5 * aimW));
      this.set(right ? 'armUR' : 'armUL', i, this.m, h.shirt);
      this.m.multiply(this.tmp.makeTranslation(0, -0.27, 0)).multiply(this.tmp2.makeRotationX(el));
      this.set(right ? 'armFR' : 'armFL', i, this.m, h.skin);
      if (right) {
        if (armed && !h.dead) {
          this.m.multiply(this.tmp.makeTranslation(0, -0.31, 0.02)).multiply(this.tmp2.makeRotationX(Math.PI / 2));
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
