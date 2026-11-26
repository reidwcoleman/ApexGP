// Firearms, thrown and melee weapons, pickups, the gun shop's stock and hit-scan shooting.
import * as THREE from 'three';
import { HumanRenderer, type Human, type WeaponId } from '../entities/humans';
import type { Vehicle } from '../entities/vehicle';
import { groundAt, WATER_Y } from '../world/map';
import type { Game } from './game';

export type AmmoId = Exclude<WeaponId, 'fist' | 'bat'>;
export const AMMO_IDS: AmmoId[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'grenade'];
/** the order the wheel and Q / E go round in */
export const WEAPON_ORDER: WeaponId[] = ['fist', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'grenade'];

export interface WeaponDef {
  id: AmmoId;
  name: string;
  damage: number;
  interval: number; // seconds between shots
  mag: number;
  reload: number;
  spreadAim: number; // radians
  spreadHip: number;
  range: number;
  auto: boolean;
  pickupAmmo: number;
  /** shotgun: pellets per shot */
  pellets?: number;
  /** a scope: the camera zooms in when aiming */
  scope?: boolean;
  /** held in both hands */
  long?: boolean;
  /** camera kick per shot */
  kick: number;
  price: number;
  ammoPrice: number;
  ammoPack: number;
}

export const WEAPONS: Record<AmmoId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Pistol', damage: 26, interval: 0.28, mag: 12, reload: 1.3, spreadAim: 0.008, spreadHip: 0.035, range: 120, auto: false, pickupAmmo: 48, kick: 0.014, price: 400, ammoPrice: 60, ammoPack: 36 },
  smg: { id: 'smg', name: 'SMG', damage: 15, interval: 0.085, mag: 30, reload: 1.9, spreadAim: 0.022, spreadHip: 0.06, range: 90, auto: true, pickupAmmo: 120, kick: 0.006, long: true, price: 1500, ammoPrice: 120, ammoPack: 120 },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', damage: 13, interval: 0.85, mag: 6, reload: 2.6, spreadAim: 0.05, spreadHip: 0.08, range: 45, auto: false, pickupAmmo: 18, pellets: 9, kick: 0.035, long: true, price: 2200, ammoPrice: 100, ammoPack: 18 },
  rifle: { id: 'rifle', name: 'Assault Rifle', damage: 24, interval: 0.11, mag: 30, reload: 2.2, spreadAim: 0.009, spreadHip: 0.045, range: 170, auto: true, pickupAmmo: 90, kick: 0.009, long: true, price: 4500, ammoPrice: 180, ammoPack: 90 },
  sniper: { id: 'sniper', name: 'Sniper Rifle', damage: 140, interval: 1.3, mag: 5, reload: 2.8, spreadAim: 0.0004, spreadHip: 0.08, range: 420, auto: false, pickupAmmo: 15, scope: true, kick: 0.05, long: true, price: 7000, ammoPrice: 200, ammoPack: 15 },
  grenade: { id: 'grenade', name: 'Grenades', damage: 170, interval: 0.9, mag: 1, reload: 0.6, spreadAim: 0, spreadHip: 0, range: 0, auto: false, pickupAmmo: 3, kick: 0, price: 900, ammoPrice: 900, ammoPack: 3 },
};

export const MELEE = { fist: { name: 'Fists', damage: 1 }, bat: { name: 'Baseball Bat', damage: 2.4, price: 150 } };

export function weaponName(w: WeaponId): string {
  return w === 'fist' || w === 'bat' ? MELEE[w].name : WEAPONS[w].name;
}

export interface Loadout {
  owned: Set<WeaponId>;
  clip: Record<AmmoId, number>;
  reserve: Record<AmmoId, number>;
  reloadT: number;
  cooldown: number;
}

export function emptyLoadout(): Loadout {
  const z = () => ({ pistol: 0, smg: 0, shotgun: 0, rifle: 0, sniper: 0, grenade: 0 });
  return { owned: new Set(), clip: z(), reserve: z(), reloadT: 0, cooldown: 0 };
}

export interface ShotHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  human: Human | null;
  vehicle: Vehicle | null;
  dist: number;
}

type PickupKind = AmmoId | 'bat' | 'health' | 'armor';
interface Pickup {
  kind: PickupKind;
  x: number;
  z: number;
  mesh: THREE.Group;
  respawn: number;
}

export const PICKUP_SPOTS: { kind: PickupKind; x: number; z: number }[] = [
  { kind: 'pistol', x: 678, z: -72 },
  { kind: 'pistol', x: 210, z: -180 },
  { kind: 'pistol', x: -196, z: 96 },
  { kind: 'smg', x: 392, z: 150 },
  { kind: 'smg', x: -550, z: 330 },
  { kind: 'smg', x: 166, z: -470 },
  { kind: 'shotgun', x: -300, z: -120 },
  { kind: 'shotgun', x: 520, z: 60 },
  { kind: 'rifle', x: 30, z: 300 },
  { kind: 'rifle', x: -460, z: -380 },
  { kind: 'sniper', x: 250, z: -360 },
  { kind: 'grenade', x: 640, z: 120 },
  { kind: 'grenade', x: -120, z: -260 },
  { kind: 'bat', x: 690, z: -20 },
  { kind: 'bat', x: 120, z: 20 },
  { kind: 'health', x: 152, z: 116 },
  { kind: 'health', x: 610, z: 230 },
  { kind: 'health', x: -320, z: -340 },
  { kind: 'armor', x: 300, z: -60 },
  { kind: 'armor', x: -60, z: 180 },
];

interface Grenade {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  by: Human;
}

const PICKUP_COL: Record<PickupKind, number> = {
  pistol: 0x5fd3ff, smg: 0xffb347, shotgun: 0xff7a4a, rifle: 0xff5f8a, sniper: 0xc58bff, grenade: 0x9be15d, bat: 0xe8d6a8, health: 0x4dff88, armor: 0x6aa8ff,
};

export class Weapons {
  pickups: Pickup[] = [];
  grenades: Grenade[] = [];
  private v1 = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6, metalness: 0.3 });

  constructor(private game: Game) {
    for (const s of PICKUP_SPOTS) {
      const g = this.pickupMesh(s.kind);
      g.position.set(s.x, groundAt(s.x, s.z) + 1.0, s.z);
      game.scene.add(g);
      this.pickups.push({ kind: s.kind, x: s.x, z: s.z, mesh: g, respawn: 0 });
    }
  }

  private pickupMesh(kind: PickupKind): THREE.Group {
    const g = new THREE.Group();
    const col = PICKUP_COL[kind];
    const glowMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: col }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.9;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 16, 1, true), glowMat);
    beam.position.y = 0.1;
    let item: THREE.Mesh;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4, emissive: col, emissiveIntensity: 0.25 });
    if (kind === 'health' || kind === 'armor') {
      item = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: kind === 'health' ? 0xffffff : 0x2a3a5a, emissive: kind === 'health' ? 0x22aa44 : 0x2244aa, emissiveIntensity: 0.6 }));
      if (kind === 'health') {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: 0x22cc55 }));
        const cross2 = cross.clone();
        cross2.rotation.z = Math.PI / 2;
        item.add(cross, cross2);
      }
    } else if (kind === 'grenade') {
      item = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), dark);
    } else if (kind === 'bat') {
      item = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.025, 0.85, 10), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.5, emissive: col, emissiveIntensity: 0.15 }));
      item.rotation.z = 0.5;
    } else {
      const len = { pistol: 0.4, smg: 0.7, shotgun: 1.0, rifle: 0.95, sniper: 1.2 }[kind];
      item = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, len), dark);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.1), dark);
      grip.position.set(0, -0.15, -len * 0.25);
      item.add(grip);
    }
    item.name = 'item';
    g.add(ring, beam, item);
    return g;
  }

  /** what the player gets from a pickup or a purchase */
  give(kind: PickupKind, ammo?: number): string {
    const g = this.game, p = g.player, lo = g.loadout;
    if (kind === 'health') {
      p.health = p.maxHealth;
      return 'Health restored';
    }
    if (kind === 'armor') {
      p.armor = 100;
      return 'Body armor';
    }
    if (kind === 'bat') {
      lo.owned.add('bat');
      p.weapon = 'bat';
      return 'Baseball Bat';
    }
    const def = WEAPONS[kind];
    const first = !lo.owned.has(kind);
    lo.owned.add(kind);
    if (kind === 'grenade') lo.clip.grenade = 1;
    else if (first) lo.clip[kind] = def.mag;
    lo.reserve[kind] += ammo ?? def.pickupAmmo;
    p.weapon = kind;
    return def.name;
  }

  update(dt: number, elapsed: number) {
    const g = this.game;
    const p = g.player;
    for (const pk of this.pickups) {
      if (pk.respawn > 0) {
        pk.respawn -= dt;
        pk.mesh.visible = pk.respawn <= 0;
        continue;
      }
      const item = pk.mesh.getObjectByName('item')!;
      item.rotation.y = elapsed * 2;
      item.position.y = Math.sin(elapsed * 3) * 0.12;
      if (p.vehicle || p.dead) continue;
      const dx = p.pos.x - pk.x, dz = p.pos.z - pk.z;
      if (dx * dx + dz * dz < 2.2 && Math.abs(p.pos.y + 1 - pk.mesh.position.y) < 2) {
        if (pk.kind === 'health' && p.health >= p.maxHealth) continue;
        if (pk.kind === 'armor' && p.armor >= 100) continue;
        const name = this.give(pk.kind);
        g.hud.toast(pk.kind === 'health' || pk.kind === 'armor' ? name : `${name} picked up  ·  Q / E or 1–8 to switch`);
        g.audio.cue('pickup');
        pk.respawn = 45;
        pk.mesh.visible = false;
      }
    }
    const lo = g.loadout;
    if (lo.cooldown > 0) lo.cooldown -= dt;
    if (lo.reloadT > 0) {
      lo.reloadT -= dt;
      if (lo.reloadT <= 0) this.finishReload();
    }
    this.updateGrenades(dt);
  }

  private owns(w: WeaponId) {
    if (w === 'fist') return true;
    const lo = this.game.loadout;
    if (!lo.owned.has(w)) return false;
    if (w === 'grenade') return lo.reserve.grenade + lo.clip.grenade > 0;
    return true;
  }

  cycle(dirn: number) {
    const g = this.game;
    const own = WEAPON_ORDER.filter((w) => this.owns(w));
    let i = own.indexOf(g.player.weapon);
    i = (i + dirn + own.length) % own.length;
    g.player.weapon = own[i];
    g.loadout.reloadT = 0;
  }

  select(w: WeaponId) {
    if (this.owns(w)) {
      this.game.player.weapon = w;
      this.game.loadout.reloadT = 0;
    }
  }

  reload() {
    const g = this.game;
    const w = g.player.weapon;
    if (w === 'fist' || w === 'bat' || w === 'grenade') return;
    const lo = g.loadout;
    if (lo.reloadT > 0 || lo.clip[w] >= WEAPONS[w].mag || lo.reserve[w] <= 0) return;
    lo.reloadT = WEAPONS[w].reload;
  }

  private finishReload() {
    const g = this.game;
    const w = g.player.weapon;
    if (w === 'fist' || w === 'bat' || w === 'grenade') return;
    const lo = g.loadout;
    const need = WEAPONS[w].mag - lo.clip[w];
    const take = Math.min(need, lo.reserve[w]);
    lo.clip[w] += take;
    lo.reserve[w] -= take;
    g.audio.cue('click');
  }

  /** Player trigger pull. aimPoint is where the crosshair points in the world. */
  playerFire(aimPoint: THREE.Vector3, aiming: boolean): boolean {
    const g = this.game;
    const p = g.player;
    const w = p.weapon;
    if (w === 'fist' || w === 'bat') return false;
    const lo = g.loadout;
    if (lo.cooldown > 0 || lo.reloadT > 0) return false;
    const def = WEAPONS[w];
    if (w === 'grenade') {
      if (lo.reserve.grenade <= 0) {
        g.audio.cue('click');
        lo.cooldown = 0.3;
        this.cycle(-1);
        return false;
      }
      lo.reserve.grenade--;
      lo.cooldown = def.interval;
      const from = HumanRenderer.muzzle(p, this.v1).clone();
      this.dir.subVectors(aimPoint, from).normalize();
      const speed = 15 + (aiming ? 4 : 0);
      this.grenades.push({ mesh: this.spawnGrenadeMesh(), pos: from, vel: this.dir.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 4.5, 0)), fuse: 2.4, by: p });
      p.punchT = 0.35;
      g.audio.whoosh();
      if (lo.reserve.grenade <= 0) setTimeout(() => p.weapon === 'grenade' && this.cycle(-1), 900);
      return true;
    }
    if (lo.clip[w] <= 0) {
      if (lo.reserve[w] > 0) this.reload();
      else g.audio.cue('click');
      lo.cooldown = 0.25;
      return false;
    }
    lo.clip[w]--;
    lo.cooldown = def.interval;
    const muzzle = HumanRenderer.muzzle(p, this.v1);
    const spread = aiming ? def.spreadAim : def.spreadHip;
    for (let k = 0; k < (def.pellets ?? 1); k++) {
      this.dir.subVectors(aimPoint, muzzle).normalize();
      this.jitter(this.dir, spread);
      const hit = this.trace(muzzle, this.dir, def.range, p);
      this.applyHit(hit, def.damage, p, muzzle, k === 0 || Math.random() < 0.35);
    }
    g.effects.muzzleFlash(muzzle, !!def.long);
    g.effects.shell(muzzle, p.yaw, w === 'shotgun');
    g.audio.gunshot(w, 0);
    g.alertDanger(p.pos, w === 'sniper' ? 80 : 45, true);
    g.cameraKick += def.kick;
    if (lo.clip[w] === 0 && lo.reserve[w] > 0) this.reload();
    return true;
  }

  private spawnGrenadeMesh() {
    const m = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    m.castShadow = true;
    this.game.scene.add(m);
    return m;
  }

  private updateGrenades(dt: number) {
    const g = this.game;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const gr = this.grenades[i];
      gr.fuse -= dt;
      gr.vel.y -= 9.81 * dt;
      gr.pos.addScaledVector(gr.vel, dt);
      const gy = Math.max(groundAt(gr.pos.x, gr.pos.z, gr.pos.y + 0.5), WATER_Y) + 0.09;
      if (gr.pos.y < gy) {
        gr.pos.y = gy;
        if (gr.vel.y < -1.5) g.audio.cue('click');
        gr.vel.y = -gr.vel.y * 0.35;
        gr.vel.x *= 0.6;
        gr.vel.z *= 0.6;
      }
      // off walls
      const hit = g.map.colliders.raycast(gr.pos.x, gr.pos.y, gr.pos.z, gr.vel.x, 0, gr.vel.z, Math.hypot(gr.vel.x, gr.vel.z) * dt + 0.12);
      if (hit) {
        if (Math.abs(hit.nx) > 0.5) gr.vel.x = -gr.vel.x * 0.4;
        if (Math.abs(hit.nz) > 0.5) gr.vel.z = -gr.vel.z * 0.4;
      }
      gr.mesh.position.copy(gr.pos);
      gr.mesh.rotation.x += dt * 8;
      if (gr.fuse <= 0) {
        g.scene.remove(gr.mesh);
        this.grenades.splice(i, 1);
        g.blast(gr.pos, 7.5, WEAPONS.grenade.damage, gr.by);
      }
    }
  }

  /** NPC (police) shot at a target with an accuracy 0..1. */
  npcFire(shooter: Human, target: THREE.Vector3, accuracy: number) {
    const g = this.game;
    const w = shooter.weapon === 'fist' || shooter.weapon === 'bat' || shooter.weapon === 'grenade' ? 'pistol' : shooter.weapon;
    const def = WEAPONS[w];
    const muzzle = HumanRenderer.muzzle(shooter, this.v1);
    for (let k = 0; k < (def.pellets ? 5 : 1); k++) {
      this.dir.subVectors(target, muzzle).normalize();
      const miss = Math.random() > accuracy;
      this.jitter(this.dir, miss ? 0.09 : def.pellets ? 0.04 : 0.01);
      const hit = this.trace(muzzle, this.dir, 90, shooter);
      this.applyHit(hit, w === 'rifle' ? 11 : w === 'smg' ? 7 : 8, shooter, muzzle, k === 0);
    }
    g.effects.muzzleFlash(muzzle, !!def.long);
    const d = muzzle.distanceTo(g.camera.position);
    g.audio.gunshot(w, d);
    g.alertDanger(shooter.pos, 40, false);
  }

  private jitter(d: THREE.Vector3, s: number) {
    d.x += (Math.random() - 0.5) * 2 * s;
    d.y += (Math.random() - 0.5) * 2 * s;
    d.z += (Math.random() - 0.5) * 2 * s;
    d.normalize();
  }

  private applyHit(hit: ShotHit, dmg: number, shooter: Human, from: THREE.Vector3, tracer = true) {
    const g = this.game;
    if (tracer) g.effects.tracer(from, hit.point);
    if (hit.human) {
      const h = hit.human;
      const headshot = hit.point.y - h.pos.y > 1.5 && h.fall < 0.3;
      const killed = h.hurt(headshot ? dmg * 2.5 : dmg, shooter.pos.x, shooter.pos.z, dmg > 60 ? 6 : 1.5);
      g.effects.puff(hit.point.x, hit.point.y, hit.point.z, 'blood');
      g.effects.bloodPool(h, killed);
      g.onHumanHurt(h, shooter, killed, 'gun');
    } else if (hit.vehicle) {
      const v = hit.vehicle;
      v.damage(dmg * 1.6);
      g.effects.sparks(hit.point.x, hit.point.y, hit.point.z, 6);
      g.effects.decal(hit.point, hit.normal);
      if (shooter === g.player) g.onVehicleAttacked(v);
    } else if (hit.dist < 900) {
      if (hit.point.y <= WATER_Y + 0.05 && groundAt(hit.point.x, hit.point.z) < WATER_Y) {
        g.effects.puff(hit.point.x, WATER_Y, hit.point.z, 'splash');
      } else {
        g.effects.decal(hit.point, hit.normal);
        g.effects.sparks(hit.point.x, hit.point.y, hit.point.z, 4);
        g.effects.puff(hit.point.x, hit.point.y, hit.point.z, 'dust');
      }
    }
  }

  /** Trace a bullet/ray through humans, vehicles, buildings and the ground. */
  trace(o: THREE.Vector3, d: THREE.Vector3, range: number, ignore: Human | null, ignoreVehicle: Vehicle | null = null): ShotHit {
    const g = this.game;
    let best = range;
    let bh: Human | null = null, bv: Vehicle | null = null;
    const n = new THREE.Vector3(0, 1, 0);
    // buildings and props
    const bhit = g.map.colliders.raycast(o.x, o.y, o.z, d.x, d.y, d.z, range);
    if (bhit && bhit.t < best) {
      best = bhit.t;
      n.set(bhit.nx, bhit.ny, bhit.nz);
    }
    // ground / water (march)
    const steps = Math.ceil(Math.min(best, range) / 2);
    for (let i = 1; i <= steps; i++) {
      const t = Math.min(best, i * 2);
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const gy = Math.max(groundAt(x, z, y + 0.5), WATER_Y);
      if (y < gy) {
        // refine
        let lo = t - 2, hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          const yy = o.y + d.y * m;
          if (yy < Math.max(groundAt(o.x + d.x * m, o.z + d.z * m, yy + 0.5), WATER_Y)) hi = m;
          else lo = m;
        }
        best = hi;
        n.set(0, 1, 0);
        break;
      }
    }
    // humans: vertical capsule
    for (const h of g.humans) {
      if (h === ignore || h.vehicle || h.hidden) continue;
      const t = rayHuman(o, d, h, best);
      if (t !== null && t < best) {
        best = t;
        bh = h;
        bv = null;
      }
    }
    // vehicles: oriented boxes
    for (const v of g.vehicles) {
      if (v === ignoreVehicle || (ignore && ignore.vehicle === v)) continue;
      const t = rayVehicle(o, d, v, best);
      if (t !== null && t < best) {
        best = t;
        bv = v;
        bh = null;
      }
    }
    const point = new THREE.Vector3().copy(o).addScaledVector(d, best);
    return { point, normal: n, human: bh, vehicle: bv, dist: best };
  }
}

function rayHuman(o: THREE.Vector3, d: THREE.Vector3, h: Human, maxT: number): number | null {
  const r = 0.38;
  if (h.fall > 0.5) {
    // lying: sphere around the torso
    const fx = -Math.sin(h.yaw) * 0.6, fz = -Math.cos(h.yaw) * 0.6;
    const cx = h.pos.x + fx, cy = h.pos.y + 0.25, cz = h.pos.z + fz;
    return raySphere(o, d, cx, cy, cz, 0.6, maxT);
  }
  const ox = o.x - h.pos.x, oz = o.z - h.pos.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0 || t > maxT) return null;
  const y = o.y + d.y * t - h.pos.y;
  if (y < 0 || y > 1.85) return null;
  return t;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, cx: number, cy: number, cz: number, r: number, maxT: number): number | null {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : null;
}

export function rayVehicle(o: THREE.Vector3, d: THREE.Vector3, v: Vehicle, maxT: number): number | null {
  const s = v.spec;
  const c = Math.cos(-v.heading), sn = Math.sin(-v.heading);
  const lx = o.x - v.pos.x, lz = o.z - v.pos.z;
  // rotate into local space (inverse heading)
  const ox = lx * c + lz * sn, oz = -lx * sn + lz * c;
  const dx = d.x * c + d.z * sn, dz = -d.x * sn + d.z * c;
  const oy = o.y - v.pos.y, dy = d.y;
  let tmin = 0, tmax = maxT;
  const slab = (oo: number, dd: number, lo: number, hi: number) => {
    if (Math.abs(dd) < 1e-9) return oo >= lo && oo <= hi;
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  const y0 = v.isBoat ? -0.4 : 0.2;
  if (!slab(ox, dx, -s.wid / 2, s.wid / 2)) return null;
  if (!slab(oz, dz, -s.len / 2, s.len / 2)) return null;
  if (!slab(oy, dy, y0, s.hgt)) return null;
  return tmin;
}
