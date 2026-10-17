import * as THREE from 'three';
import { rayWorld } from '../sim/collide.ts';
import { makeSurf, type Network } from '../roads.ts';
import type { CollisionWorld } from '../sim/collide.ts';
import { rayCar, WRECK, type AICar, type Traffic } from '../ai/traffic.ts';
import type { People } from '../ai/people.ts';
import type { Police } from '../ai/police.ts';
import type { OpenWorldAudio } from '../audio.ts';
import type { Particles } from '../fx/particles.ts';
import type { DynLight } from '../city/cityLights.ts';
import type { Drivable } from '../vehicles/drivable.ts';
import { buildGun, casingGeometry, GUN_MAT, rocketMesh, WEAPON_ORDER, WEAPONS, type WeaponId, type WeaponSpec } from './weapons.ts';

/**
 * Gunfire and what it does. Every round is a ray (hitscan; the rocket is a projectile): against the
 * city's solids and the ground, the people, the officers, the traffic and the cruisers, the
 * helicopter, the player. Where it lands it throws sparks and dust, leaves a hole in the wall, makes
 * a car's panel ring; people go down; a car shot up enough smokes, catches fire and blows up,
 * throwing the cars round it, setting off the next. The muzzle flashes light the street. Every shot
 * is heard: the people near it run, and the police hear about it.
 */

export type Shooter = 'player' | 'police';

export interface Officer {
  pos: THREE.Vector3;
  hp: number;
  dead: boolean;
}

/** what the combat code needs of the world */
export interface CombatHost {
  scene: THREE.Scene;
  net: Network;
  world: CollisionWorld;
  people: People;
  traffic: Traffic;
  police: Police;
  audio: OpenWorldAudio;
  particles: Particles;
  camera: THREE.PerspectiveCamera;
  owned: Drivable[];
  vehicle: Drivable | null;
  /** the player's position (on foot or in a vehicle) */
  readonly focus: THREE.Vector3;
}

export interface Hit {
  t: number;
  kind: 'world' | 'ground' | 'water' | 'ped' | 'officer' | 'car' | 'cop' | 'owned' | 'heli' | 'player';
  point: THREE.Vector3;
  normal: THREE.Vector3;
  ped?: number;
  head?: boolean;
  car?: AICar;
  cop?: number;
  officer?: number;
  owned?: Drivable;
}

interface Rocket {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  by: Shooter;
}

interface Fire {
  car?: AICar;
  copIdx?: number;
  pos: THREE.Vector3;
  t: number;
  /** seconds to the explosion (burning), or -1 once it has gone up */
  fuse: number;
  smoke: number;
}

interface Casing {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  floor: number;
  rest: boolean;
  t: number;
  sounded: boolean;
}

const MAX_DECALS = 260;
const MAX_CASINGS = 90;

let holeTex: THREE.CanvasTexture | null = null;
function bulletHole(): THREE.CanvasTexture {
  if (holeTex) return holeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(5,5,5,1)');
  grd.addColorStop(0.22, 'rgba(20,18,16,0.95)');
  grd.addColorStop(0.35, 'rgba(60,55,50,0.6)');
  grd.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // spalling cracks
  g.strokeStyle = 'rgba(25,22,20,0.55)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    g.lineTo(32 + Math.cos(a + 0.2) * (14 + Math.random() * 12), 32 + Math.sin(a + 0.2) * (14 + Math.random() * 12));
    g.stroke();
  }
  holeTex = new THREE.CanvasTexture(c);
  holeTex.colorSpace = THREE.SRGBColorSpace;
  return holeTex;
}

let scorchTex: THREE.CanvasTexture | null = null;
function scorch(): THREE.CanvasTexture {
  if (scorchTex) return scorchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 40; i++) {
    const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50;
    const r = 10 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(8,7,6,0.35)');
    grd.addColorStop(1, 'rgba(8,7,6,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  scorchTex = new THREE.CanvasTexture(c);
  scorchTex.colorSpace = THREE.SRGBColorSpace;
  return scorchTex;
}

export class Combat {
  readonly group = new THREE.Group();
  // ---- the player's guns
  readonly ammo: Record<WeaponId, { mag: number; spare: number; owned: boolean }>;
  current: WeaponId | null = 'pistol';
  private cool = 0;
  reloading = 0;
  private triggerWas = false;
  private latch = 0;
  /** the player on foot */
  hp = 100;
  armor = 50;
  /** recoil to add to the camera this frame */
  recoilPitch = 0;
  recoilYaw = 0;
  /** hit marker flash for the HUD (s) */
  marker = 0;
  markerKill = false;
  /** crimes this frame for the police: [kind, where] */
  readonly crimes: { kind: 'shots' | 'shootPed' | 'killPed' | 'shootCop' | 'killCop' | 'explosion' | 'shootCar'; at: THREE.Vector3 }[] = [];
  /** damage to the player this frame (for the HUD's red flash) */
  hurt = 0;
  /** muzzle flashes / explosions lighting the street */
  private readonly flashes: { L: DynLight; t: number; life: number; i0: number }[] = [];
  private readonly rockets: Rocket[] = [];
  readonly fires: Fire[] = [];
  private readonly decals: THREE.InstancedMesh;
  private readonly scorches: THREE.InstancedMesh;
  private decalN = 0;
  private scorchN = 0;
  private readonly casings: THREE.InstancedMesh;
  private readonly cas: Casing[] = [];
  private casN = 0;
  private readonly surf = makeSurf();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private t = 0;

  constructor(private readonly H: CombatHost) {
    this.group.name = 'Combat';
    this.ammo = {} as Combat['ammo'];
    for (const id of WEAPON_ORDER) this.ammo[id] = { mag: WEAPONS[id].mag, spare: WEAPONS[id].start, owned: true };
    const dm = new THREE.MeshStandardMaterial({ map: bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), dm, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 5;
    const sm = new THREE.MeshStandardMaterial({ map: scorch(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, roughness: 1 });
    this.scorches = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sm, 24);
    this.scorches.count = 0;
    this.scorches.frustumCulled = false;
    this.casings = new THREE.InstancedMesh(casingGeometry(), GUN_MAT.brass(), MAX_CASINGS);
    this.casings.count = 0;
    this.casings.frustumCulled = false;
    this.casings.castShadow = false;
    this.group.add(this.decals, this.scorches, this.casings);
  }

  /**
   * Compile every gun, the rocket, the decals and the brass now (behind the loading screen), so the
   * first shot doesn't stall the frame while the GPU builds their shaders.
   */
  async warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) {
    const g = new THREE.Group();
    const at = new THREE.Vector3(0, 0, -3).applyQuaternion(camera.quaternion).add(camera.position);
    g.position.copy(at);
    for (const id of WEAPON_ORDER) g.add(buildGun(id).group);
    g.add(rocketMesh());
    this.decals.count = this.scorches.count = this.casings.count = 1;
    scene.add(g);
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      renderer.compile(scene, camera);
    }
    scene.remove(g);
    this.decals.count = this.scorches.count = this.casings.count = 0;
  }

  get spec(): WeaponSpec | null {
    return this.current ? WEAPONS[this.current] : null;
  }

  select(id: WeaponId | null) {
    if (id === this.current) return;
    if (id && !this.ammo[id].owned) return;
    this.current = id;
    this.reloading = 0;
    this.cool = 0.25;
  }

  cycle(dir: number) {
    const list: (WeaponId | null)[] = [null, ...WEAPON_ORDER.filter((w) => this.ammo[w].owned)];
    const i = list.indexOf(this.current);
    this.select(list[(i + dir + list.length) % list.length]);
  }

  reload() {
    const s = this.spec;
    if (!s || this.reloading > 0) return;
    const a = this.ammo[s.id];
    if (a.mag >= s.mag || a.spare <= 0) return;
    this.reloading = s.reload;
    this.H.audio.reload(s.id);
  }

  refill() {
    for (const id of WEAPON_ORDER) {
      this.ammo[id].spare = WEAPONS[id].max;
      this.ammo[id].mag = WEAPONS[id].mag;
    }
    this.armor = 100;
  }

  /**
   * The player's trigger this frame. `origin`/`dir`: the camera's aim ray (the crosshair); `muzzle`:
   * where the shot leaves the gun. Returns true when a round went.
   */
  playerTrigger(dt: number, held: boolean, aiming: boolean, aimRay: THREE.Ray, muzzle: THREE.Vector3, moving: number, inVehicle: boolean): boolean {
    const s = this.spec;
    this.cool -= dt;
    // a press is latched until it can fire (during a cooldown or a weapon switch it would be lost)
    if (held && !this.triggerWas) this.latch = 0.45;
    this.triggerWas = held;
    this.latch = Math.max(0, this.latch - dt);
    const pressed = this.latch > 0;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0 && s) {
        const a = this.ammo[s.id];
        const take = Math.min(s.mag - a.mag, a.spare);
        a.mag += take;
        a.spare -= take;
      }
      return false;
    }
    if (!s || (!held && !pressed)) return false;
    if (inVehicle && !s.driveBy) return false;
    if (this.cool > 0 || (!s.auto && !pressed)) return false;
    const a = this.ammo[s.id];
    if (a.mag <= 0) {
      if (pressed && !s.auto) this.H.audio.dry();
      else if (held && this.latch > 0.4) this.H.audio.dry();
      this.latch = 0;
      if (a.spare > 0) this.reload();
      return false;
    }
    a.mag--;
    this.latch = 0;
    this.cool = 60 / s.rpm;
    // where the crosshair points: the first thing on the camera's ray (from in front of the player)
    const far = this.tmp.copy(aimRay.direction).multiplyScalar(s.range).add(aimRay.origin);
    const camHit = this.trace(aimRay.origin, aimRay.direction, s.range, 'player', 1.5);
    const target = camHit ? camHit.point.clone() : far.clone();
    const dir = target.clone().sub(muzzle).normalize();
    const spread = (aiming ? s.spreadAim : s.spreadHip) * (1 + moving * 0.6) * (inVehicle ? 1.6 : 1);
    if (s.id === 'launcher') this.launch(muzzle, dir, 'player');
    else for (let k = 0; k < s.pellets; k++) this.fire(muzzle, jitter(dir, spread), s, 'player', k === 0);
    this.muzzleFx(muzzle, dir, s);
    this.H.audio.shot(s.id, 0);
    this.recoilPitch += s.recoil * (aiming ? 0.6 : 1) * (0.8 + Math.random() * 0.4);
    this.recoilYaw += (Math.random() - 0.5) * s.recoil * 0.5;
    this.crimes.push({ kind: 'shots', at: muzzle.clone() });
    this.H.people.scare(muzzle, s.loud * 0.4);
    if (a.mag === 0 && a.spare > 0) this.cool = 0.25;
    return true;
  }

  /** an AI shot (an officer, a cruiser's window, the helicopter) at the player */
  aiFire(muzzle: THREE.Vector3, target: THREE.Vector3, id: WeaponId, accuracy: number) {
    const s = WEAPONS[id];
    const dir = target.clone().sub(muzzle).normalize();
    const d = muzzle.distanceTo(this.H.focus);
    if (id === 'launcher') this.launch(muzzle, jitter(dir, 0.01), 'police');
    else for (let k = 0; k < s.pellets; k++) this.fire(muzzle, jitter(dir, s.spreadHip * 0.6 + (1 - accuracy) * 0.06), s, 'police', k === 0);
    this.muzzleFx(muzzle, dir, s);
    this.H.audio.shot(id, d);
  }

  // ------------------------------------------------------------------ the ray

  /**
   * The first thing a round meets. `by` decides who can be hit (no one shoots themselves); `skip`
   * ignores everything nearer than that (the camera's ray starts behind the player).
   */
  trace(o: THREE.Vector3, d: THREE.Vector3, maxT: number, by: Shooter, skip = 0): Hit | null {
    const H = this.H;
    let best: Hit | null = null;
    const take = (h: Hit) => {
      if (h.t < skip) return;
      if (!best || h.t < best.t) best = h;
    };
    // the city's solids
    const w = rayWorld(H.world, o.x, o.y, o.z, d.x, d.y, d.z, maxT);
    if (w) take({ t: w.t, kind: 'world', point: new THREE.Vector3().copy(d).multiplyScalar(w.t).add(o), normal: new THREE.Vector3(w.nx, w.ny, w.nz) });
    // the ground / the water: step down the ray to where it passes under the surface
    if (d.y < -0.002) {
      let t = 0;
      const lim = best ? (best as Hit).t : maxT;
      const step = 6;
      let prevAbove = true;
      for (; t < lim; t += step) {
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        const s = H.net.surface(x, z, y + 0.5, this.surf);
        const gy = s.water ? -1.1 : s.y;
        if (y < gy) {
          // bisect the last step
          let a = Math.max(0, t - step), b = t;
          for (let k = 0; k < 8; k++) {
            const m = (a + b) / 2;
            const sm = H.net.surface(o.x + d.x * m, o.z + d.z * m, o.y + d.y * m + 0.5, this.surf);
            if (o.y + d.y * m < (sm.water ? -1.1 : sm.y)) b = m;
            else a = m;
          }
          const sb = H.net.surface(o.x + d.x * b, o.z + d.z * b, o.y + d.y * b + 0.5, this.surf);
          take({ t: b, kind: sb.water ? 'water' : 'ground', point: new THREE.Vector3().copy(d).multiplyScalar(b).add(o), normal: new THREE.Vector3(0, 1, 0) });
          break;
        }
        prevAbove = true;
      }
      void prevAbove;
    }
    const lim = () => (best ? (best as Hit).t : maxT);
    // people
    const p = H.people.ray(o, d, lim());
    if (p) take({ t: p.t, kind: 'ped', ped: p.i, head: p.head, point: new THREE.Vector3().copy(d).multiplyScalar(p.t).add(o), normal: d.clone().negate() });
    // officers
    const of = H.police.rayOfficers(o, d, lim());
    if (of) take({ t: of.t, kind: 'officer', officer: of.i, head: of.head, point: new THREE.Vector3().copy(d).multiplyScalar(of.t).add(o), normal: d.clone().negate() });
    // the traffic (and the parked cars)
    for (const c of H.traffic.cars) {
      if (c.state === 'player' && by === 'player') continue;
      const dx = c.pos.x - o.x, dz = c.pos.z - o.z;
      const along = dx * d.x + dz * d.z;
      if (along < -4 || along > lim() + 4) continue;
      if (Math.abs(dx * d.z - dz * d.x) > 4) continue;
      const t = rayCar(c, o, d, lim(), this.n);
      if (t >= 0) take({ t, kind: c.state === 'player' ? 'player' : 'car', car: c, point: new THREE.Vector3().copy(d).multiplyScalar(t).add(o), normal: this.n.clone() });
    }
    // the cruisers
    const cops = H.police.cops;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      const b = c.body;
      if (Math.abs((b.pos.x - o.x) * d.z - (b.pos.z - o.z) * d.x) > 4) continue;
      const t = rayCar({ pos: b.pos, yaw: b.yaw, spec: c.spec }, o, d, lim(), this.n);
      if (t >= 0) take({ t, kind: 'cop', cop: i, point: new THREE.Vector3().copy(d).multiplyScalar(t).add(o), normal: this.n.clone() });
    }
    // the police helicopter (a sphere round the cabin)
    const heli = H.police.heli;
    if (heli && by === 'player') {
      const t = raySphere(o, d, heli.pos.clone().add(new THREE.Vector3(0, 1.6, 0)), 2.6);
      if (t >= 0 && t < lim()) take({ t, kind: 'heli', point: new THREE.Vector3().copy(d).multiplyScalar(t).add(o), normal: d.clone().negate() });
    }
    // the player's own vehicles (parked), and the player
    for (const v of H.owned) {
      if (v === H.vehicle && by === 'player') continue;
      const dims = vehicleBox(v);
      if (!dims) continue;
      if (Math.abs((v.pos.x - o.x) * d.z - (v.pos.z - o.z) * d.x) > dims.L) continue;
      const t = rayCar({ pos: v.pos, yaw: v.yaw, spec: dims }, o, d, lim(), this.n);
      if (t >= 0) take({ t, kind: v === H.vehicle ? 'player' : 'owned', owned: v, point: new THREE.Vector3().copy(d).multiplyScalar(t).add(o), normal: this.n.clone() });
    }
    if (by === 'police' && !H.vehicle) {
      const f = H.focus;
      const t = rayCapsule(o, d, f, 0.32, 1.8);
      if (t >= 0 && t < lim()) take({ t, kind: 'player', point: new THREE.Vector3().copy(d).multiplyScalar(t).add(o), normal: d.clone().negate() });
    }
    return best;
  }

  // ------------------------------------------------------------------ a round

  private fire(o: THREE.Vector3, d: THREE.Vector3, s: WeaponSpec, by: Shooter, tracer: boolean) {
    const h = this.trace(o, d, s.range, by, 0.05);
    const end = h ? h.point : this.tmp2.copy(d).multiplyScalar(s.range).add(o);
    const len = o.distanceTo(end);
    // the tracer: a fast streak (not every round of an automatic)
    if (tracer && (by === 'police' || !s.auto || Math.random() < 0.5)) {
      const v = 420;
      this.H.particles.spark({ x: o.x + d.x * 0.6, y: o.y + d.y * 0.6, z: o.z + d.z * 0.6, vx: d.x * v, vy: d.y * v, vz: d.z * v, life: Math.max(0.02, Math.min(0.3, (len - 0.6) / v)), s0: 0.028, s1: 0.028, a: 1, r: 3.2, g: 2.4, b: 1.2, stretch: 0.012, fadeIn: 0 });
    }
    // a round passing close to the player's head
    if (by === 'police') {
      const f = this.H.focus;
      const to = this.tmp2.copy(f).add(new THREE.Vector3(0, 1.5, 0)).sub(o);
      const tc = to.dot(d);
      if (tc > 0 && tc < len) {
        const miss = to.addScaledVector(d, -tc).length();
        if (miss < 2.5 && (!h || h.kind !== 'player')) this.H.audio.whiz();
      }
    }
    if (!h) return;
    this.land(h, d, s.damage, by, s);
  }

  /** a round's effect where it lands */
  private land(h: Hit, d: THREE.Vector3, dmg: number, by: Shooter, s: WeaponSpec | null) {
    const H = this.H;
    const P = H.particles;
    const dist = h.point.distanceTo(H.camera.position);
    switch (h.kind) {
      case 'world':
      case 'ground': {
        this.sparks(h.point, h.normal, 3 + Math.floor(Math.random() * 4), 1);
        this.dust(h.point, h.normal, h.kind === 'ground' ? 0.62 : 0.7);
        this.decal(h.point, h.normal);
        H.audio.hit('stone', dist);
        break;
      }
      case 'water': {
        for (let i = 0; i < 6; i++) P.puff({ x: h.point.x, y: -1.0, z: h.point.z, vx: (Math.random() - 0.5) * 1.5, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 1.5, life: 0.6, s0: 0.08, s1: 0.4, a: 0.6, r: 0.9, g: 0.95, b: 1, grav: 1, floor: -1.1, fadeIn: 0 });
        H.audio.hit('water', dist);
        break;
      }
      case 'ped': {
        const killed = H.people.shoot(h.ped!, dmg * (h.head ? 3 : 1), d);
        this.dust(h.point, h.normal, 0.45, 0.4);
        if (by === 'player') {
          this.mark(killed);
          this.crimes.push({ kind: killed ? 'killPed' : 'shootPed', at: h.point.clone() });
        }
        H.audio.hit('flesh', dist);
        break;
      }
      case 'officer': {
        const killed = H.police.shootOfficer(h.officer!, dmg * (h.head ? 3 : 1), d, by);
        this.dust(h.point, h.normal, 0.45, 0.4);
        if (by === 'player') {
          this.mark(killed);
          this.crimes.push({ kind: killed ? 'killCop' : 'shootCop', at: h.point.clone() });
        }
        H.audio.hit('flesh', dist);
        break;
      }
      case 'car':
      case 'cop':
      case 'owned':
      case 'heli':
      case 'player': {
        this.sparks(h.point, h.normal, 4 + Math.floor(Math.random() * 5), 1.3);
        H.audio.hit(Math.random() < 0.25 ? 'glass' : 'metal', dist);
        if (h.kind === 'car') this.damageCar(h.car!, dmg * 0.22, h.point, by);
        else if (h.kind === 'cop') this.damageCop(h.cop!, dmg * 0.22, by);
        else if (h.kind === 'heli') {
          H.police.heliHp -= dmg * 0.12;
          if (by === 'player') this.mark(false);
          if (H.police.heliHp <= 0 && H.police.heli) {
            this.explode(H.police.heli.pos.clone(), 9, by);
            H.police.downHeli();
          }
        } else if (h.kind === 'owned' && h.owned) {
          h.owned.health = Math.max(0, h.owned.health - dmg * 0.0022);
          if (h.owned.health <= 0) this.explode(h.owned.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 7, by);
        } else if (h.kind === 'player') this.hurtPlayer(dmg, h.car ?? null);
        if (by === 'player' && (h.kind === 'cop' || h.kind === 'heli')) this.crimes.push({ kind: 'shootCop', at: h.point.clone() });
        else if (by === 'player' && h.kind === 'car') this.crimes.push({ kind: 'shootCar', at: h.point.clone() });
        break;
      }
    }
    void s;
  }

  private mark(kill: boolean) {
    this.marker = 0.18;
    this.markerKill ||= kill;
  }

  /** the police hit the player (on foot: armour first; in a vehicle: the vehicle) */
  private hurtPlayer(dmg: number, car: AICar | null) {
    const v = this.H.vehicle;
    if (v) {
      v.health = Math.max(0, v.health - dmg * 0.0018);
      void car;
    } else {
      let d = dmg * 0.45;
      const a = Math.min(this.armor, d * 0.7);
      this.armor -= a;
      d -= a;
      this.hp = Math.max(0, this.hp - d);
    }
    this.hurt = Math.min(1, this.hurt + 0.35);
  }

  damageCar(c: AICar, dmg: number, at: THREE.Vector3 | null, by: Shooter) {
    if (c.flags & WRECK) return;
    const hp = (c.hp ?? 100) - dmg;
    c.hp = hp;
    if (by === 'player' && at) this.mark(false);
    // a driver under fire floors it
    if (c.state === 'lane' || c.state === 'junction') {
      c.vmax *= 1.4;
      c.flags |= 16;
    }
    if (hp <= 0 && !this.fires.some((f) => f.car === c)) this.fires.push({ car: c, pos: c.pos, t: 0, fuse: 3.5 + Math.random() * 3, smoke: 0 });
  }

  private damageCop(i: number, dmg: number, by: Shooter) {
    const cop = this.H.police.cops[i];
    if (!cop || cop.wreck) return;
    cop.hp -= dmg;
    if (by === 'player') this.mark(false);
    if (cop.hp <= 0 && !this.fires.some((f) => f.pos === cop.body.pos)) this.fires.push({ copIdx: i, pos: cop.body.pos, t: 0, fuse: 3 + Math.random() * 2, smoke: 0 });
  }

  // ------------------------------------------------------------------ rockets and explosions

  private launch(o: THREE.Vector3, d: THREE.Vector3, by: Shooter) {
    const mesh = rocketMesh();
    mesh.position.copy(o);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    this.group.add(mesh);
    this.rockets.push({ mesh, pos: o.clone(), vel: d.clone().multiplyScalar(55), life: 6, by });
    // the back-blast
    const P = this.H.particles;
    for (let i = 0; i < 14; i++) {
      const k = 6 + Math.random() * 10;
      P.puff({ x: o.x - d.x * 1.2, y: o.y - d.y * 1.2, z: o.z - d.z * 1.2, vx: -d.x * k + (Math.random() - 0.5) * 3, vy: -d.y * k + Math.random() * 1.5, vz: -d.z * k + (Math.random() - 0.5) * 3, life: 1.6, s0: 0.3, s1: 2.4, a: 0.4, r: 0.8, g: 0.78, b: 0.75, drag: 2.5, lift: 0.4, fadeIn: 0.05 });
    }
  }

  /**
   * An explosion: the fireball, black smoke, debris and sparks, a scorch mark, the flash; people
   * killed or thrown, cars wrecked and flung (and set burning to go up in turn), the player hurt.
   */
  explode(at: THREE.Vector3, r: number, by: Shooter) {
    const H = this.H;
    const P = H.particles;
    const R = Math.random;
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, e = R() * 1.2;
      const v = 4 + R() * 9;
      P.spark({ x: at.x, y: at.y + 0.5, z: at.z, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(e) * v + 2, vz: Math.sin(a) * Math.cos(e) * v, life: 0.5 + R() * 0.5, s0: 1.2, s1: 3.8 + R() * 2, a: 1, r: 4, g: 1.7 + R() * 0.6, b: 0.4, drag: 3, lift: 3, fadeIn: 0.02 });
    }
    for (let i = 0; i < 6; i++) P.spark({ x: at.x, y: at.y + 1, z: at.z, life: 0.18, s0: 3, s1: 9, a: 1, r: 6, g: 4, b: 2, fadeIn: 0 });
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, v = 2 + R() * 5;
      P.puff({ x: at.x + Math.cos(a) * R(), y: at.y + 0.6 + R() * 1.5, z: at.z + Math.sin(a) * R(), vx: Math.cos(a) * v, vy: 2 + R() * 5, vz: Math.sin(a) * v, life: 4 + R() * 4, s0: 1.5, s1: 7 + R() * 5, a: 0.75, r: 0.12, g: 0.11, b: 0.1, drag: 1.2, lift: 1.4, fadeIn: 0.04, floor: at.y });
    }
    for (let i = 0; i < 40; i++) {
      const a = R() * Math.PI * 2, e = 0.2 + R() * 1.2, v = 8 + R() * 18;
      P.spark({ x: at.x, y: at.y + 0.6, z: at.z, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(e) * v, vz: Math.sin(a) * Math.cos(e) * v, life: 0.6 + R() * 1.2, s0: 0.05, s1: 0.03, a: 1, r: 5, g: 2.6, b: 0.8, grav: 1, floor: at.y - 0.4, stretch: 0.02, fadeIn: 0 });
    }
    const gy = H.net.surface(at.x, at.z, at.y + 0.5, this.surf);
    if (!gy.water && at.y - gy.y < 2.5) this.scorch(new THREE.Vector3(at.x, gy.y, at.z), r * 0.8);
    this.flash(at, 60, 45, 0.45);
    const dist = at.distanceTo(H.camera.position);
    H.audio.boom(dist);
    this.shake = Math.max(this.shake, Math.min(1.2, 30 / (dist + 10)));
    // what it does
    const killed = H.people.blast(at, r);
    if (by === 'player') {
      this.crimes.push({ kind: 'explosion', at: at.clone() });
      if (killed) this.crimes.push({ kind: 'killPed', at: at.clone() });
    }
    H.police.blast(at, r, by);
    for (const c of H.traffic.cars) {
      const dx = c.pos.x - at.x, dz = c.pos.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > r * 1.5 || Math.abs(c.pos.y - at.y) > r) continue;
      const k = 1 - d / (r * 1.5);
      if (c.state !== 'player') {
        if (!c.body) H.traffic.makeDynamic(c);
        const b = c.body!;
        b.vx += (dx / (d || 1)) * 9 * k;
        b.vz += (dz / (d || 1)) * 9 * k;
        b.vy = Math.max(b.vy, 4 * k);
        b.yawRate += (R() - 0.5) * 3 * k;
        this.damageCar(c, 140 * k, null, by);
      }
    }
    for (let i = 0; i < H.police.cops.length; i++) {
      const c = H.police.cops[i];
      const b = c.body;
      const dx = b.pos.x - at.x, dz = b.pos.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > r * 1.5) continue;
      const k = 1 - d / (r * 1.5);
      b.vx += (dx / (d || 1)) * 9 * k;
      b.vz += (dz / (d || 1)) * 9 * k;
      b.vy = Math.max(b.vy, 4 * k);
      this.damageCop(i, 140 * k, by);
    }
    for (const v of H.owned) {
      const d = v.pos.distanceTo(at);
      if (d < r * 1.5) v.health = Math.max(0, v.health - (1 - d / (r * 1.5)) * 0.9);
    }
    // the player
    const pd = H.focus.distanceTo(at);
    if (pd < r * 1.6) {
      const k = 1 - pd / (r * 1.6);
      if (H.vehicle) H.vehicle.health = Math.max(0, H.vehicle.health - k * 0.9);
      else {
        this.hp = Math.max(0, this.hp - k * 160);
        this.hurt = 1;
      }
    }
  }

  shake = 0;

  // ------------------------------------------------------------------ effects

  private muzzleFx(o: THREE.Vector3, d: THREE.Vector3, s: WeaponSpec) {
    const P = this.H.particles;
    const big = s.id === 'shotgun' || s.id === 'sniper' ? 1.6 : s.id === 'rifle' ? 1.25 : s.id === 'launcher' ? 2.2 : 1;
    // a hot white core, a forward jet and four petals round the muzzle (the flash hider's star)
    P.spark({ x: o.x + d.x * 0.04, y: o.y + d.y * 0.04, z: o.z + d.z * 0.04, life: 0.04, s0: 0.08 * big, s1: 0.14 * big, a: 1, r: 9, g: 7, b: 4, fadeIn: 0 });
    for (let i = 0; i < 2; i++) {
      const v = 30 + Math.random() * 25;
      P.spark({ x: o.x, y: o.y, z: o.z, vx: d.x * v, vy: d.y * v, vz: d.z * v, life: 0.035, s0: 0.05 * big, s1: 0.09 * big, a: 1, r: 7, g: 4.2, b: 1.4, stretch: 0.05, fadeIn: 0 });
    }
    const u = new THREE.Vector3(d.z, 0, -d.x).normalize();
    const w2 = new THREE.Vector3().crossVectors(d, u);
    const rot = Math.random() * Math.PI;
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      const px = u.x * Math.cos(a) + w2.x * Math.sin(a), py = u.y * Math.cos(a) + w2.y * Math.sin(a), pz = u.z * Math.cos(a) + w2.z * Math.sin(a);
      const v = 9 + Math.random() * 5;
      P.spark({ x: o.x + d.x * 0.03, y: o.y + d.y * 0.03, z: o.z + d.z * 0.03, vx: px * v + d.x * 4, vy: py * v + d.y * 4, vz: pz * v + d.z * 4, life: 0.03, s0: 0.03 * big, s1: 0.045 * big, a: 1, r: 6, g: 3.6, b: 1.2, stretch: 0.09, fadeIn: 0 });
    }
    // a wisp of smoke
    for (let i = 0; i < (s.id === 'shotgun' || s.id === 'launcher' ? 4 : 1); i++)
      P.puff({ x: o.x + d.x * 0.1, y: o.y + d.y * 0.1, z: o.z + d.z * 0.1, vx: d.x * 2 + (Math.random() - 0.5) * 0.4, vy: d.y * 2 + 0.3, vz: d.z * 2 + (Math.random() - 0.5) * 0.4, life: 1.2, s0: 0.06, s1: 0.5 * big, a: 0.22, r: 0.85, g: 0.85, b: 0.85, drag: 2.5, lift: 0.5, fadeIn: 0.05 });
    this.flash(o, 3.5 * big, 9, 0.05);
    // the case flies out to the right
    if (s.casing > 0 && o.distanceTo(this.H.camera.position) < 40) this.eject(o, d, s.casing);
  }

  private flash(at: THREE.Vector3, intensity: number, radius: number, life: number) {
    if (this.flashes.length > 6) this.flashes.shift();
    this.flashes.push({ L: { pos: at.clone(), color: new THREE.Color(1, 0.72, 0.4), intensity, radius }, t: 0, life, i0: intensity });
  }

  /** the lights for the city light pass this frame */
  lights(out: DynLight[]) {
    for (const f of this.flashes) out.push(f.L);
    for (const f of this.fires) {
      if (f.fuse > 0 && f.t < 0.5) continue;
      const L = (f as Fire & { L?: DynLight }).L ?? ((f as Fire & { L?: DynLight }).L = { pos: new THREE.Vector3(), color: new THREE.Color(1, 0.5, 0.2), intensity: 0, radius: 14 });
      L.pos.set(f.pos.x, f.pos.y + 1.6, f.pos.z);
      L.intensity = (f.fuse > 0 ? 2.5 : 4) * (0.8 + Math.random() * 0.4) * Math.min(1, (60 - f.t) / 10);
      out.push(L);
    }
  }

  sparks(at: THREE.Vector3, n: THREE.Vector3, count: number, k: number) {
    const P = this.H.particles;
    for (let i = 0; i < count; i++) {
      const v = (4 + Math.random() * 8) * k;
      const rx = n.x + (Math.random() - 0.5) * 1.4, ry = n.y + (Math.random() - 0.5) * 1.4 + 0.3, rz = n.z + (Math.random() - 0.5) * 1.4;
      P.spark({ x: at.x + n.x * 0.02, y: at.y + n.y * 0.02, z: at.z + n.z * 0.02, vx: rx * v, vy: ry * v, vz: rz * v, life: 0.15 + Math.random() * 0.3, s0: 0.03, s1: 0.015, a: 1, r: 5, g: 3, b: 1.2, grav: 1, floor: at.y - 3, stretch: 0.015, fadeIn: 0 });
    }
  }

  private dust(at: THREE.Vector3, n: THREE.Vector3, shade: number, a = 0.35) {
    const P = this.H.particles;
    for (let i = 0; i < 3; i++) {
      const v = 1 + Math.random() * 2;
      P.puff({ x: at.x + n.x * 0.05, y: at.y + n.y * 0.05, z: at.z + n.z * 0.05, vx: (n.x + (Math.random() - 0.5) * 0.6) * v, vy: (n.y + 0.3) * v, vz: (n.z + (Math.random() - 0.5) * 0.6) * v, life: 0.9 + Math.random() * 0.6, s0: 0.08, s1: 0.6 + Math.random() * 0.4, a, r: shade, g: shade * 0.95, b: shade * 0.88, drag: 3, lift: 0.2, fadeIn: 0.05 });
    }
  }

  private decal(at: THREE.Vector3, n: THREE.Vector3) {
    const i = this.decalN++ % MAX_DECALS;
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const s = 0.7 + Math.random() * 0.6;
    this.m4.compose(this.tmp.copy(at).addScaledVector(n, 0.01), this.q, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(i, this.m4);
    this.decals.count = Math.min(MAX_DECALS, this.decalN);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  private scorch(at: THREE.Vector3, r: number) {
    const i = this.scorchN++ % 24;
    this.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28));
    this.m4.compose(this.tmp.set(at.x, at.y + 0.04, at.z), this.q, new THREE.Vector3(r * 2, r * 2, 1));
    this.scorches.setMatrixAt(i, this.m4);
    this.scorches.count = Math.min(24, this.scorchN);
    this.scorches.instanceMatrix.needsUpdate = true;
  }

  private eject(o: THREE.Vector3, d: THREE.Vector3, size: number) {
    const i = this.casN++ % MAX_CASINGS;
    const right = new THREE.Vector3(-d.z, 0, d.x).normalize().negate();
    const c: Casing = this.cas[i] ?? (this.cas[i] = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), floor: 0, rest: false, t: 0, sounded: false });
    c.p.copy(o).addScaledVector(d, -0.12);
    c.v.copy(right).multiplyScalar(2.5 + Math.random() * 1.5).add(new THREE.Vector3(0, 2 + Math.random(), 0)).addScaledVector(d, -0.5);
    c.w.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.r.set(0, Math.atan2(d.x, d.z), 0);
    c.floor = this.H.net.surface(o.x, o.z, o.y, this.surf).y + 0.005;
    c.rest = false;
    c.t = 0;
    c.sounded = false;
    (c as Casing & { s?: number }).s = size;
    this.casings.count = Math.min(MAX_CASINGS, this.casN);
  }

  // ------------------------------------------------------------------ the frame

  update(dt: number) {
    const H = this.H;
    this.t += dt;
    this.marker = Math.max(0, this.marker - dt);
    if (this.marker <= 0) this.markerKill = false;
    this.hurt = Math.max(0, this.hurt - dt * 1.4);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      f.L.intensity = f.i0 * Math.max(0, 1 - f.t / f.life);
      if (f.t >= f.life) this.flashes.splice(i, 1);
    }
    // ---- rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const sp = r.vel.length();
      if (sp < 110) r.vel.multiplyScalar(1 + dt * 1.5);
      r.vel.y -= 1.5 * dt;
      const step = r.vel.length() * dt;
      const d = this.tmp.copy(r.vel).normalize();
      const h = this.trace(r.pos, d, step, r.by, 0);
      if (h || r.life <= 0) {
        const at = h ? h.point.clone().addScaledVector(h.normal, 0.3) : r.pos.clone();
        this.explode(at, 7.5, r.by);
        this.group.remove(r.mesh);
        this.rockets.splice(i, 1);
        continue;
      }
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      const P = H.particles;
      P.spark({ x: r.pos.x - d.x * 0.4, y: r.pos.y - d.y * 0.4, z: r.pos.z - d.z * 0.4, life: 0.06, s0: 0.35, s1: 0.2, a: 1, r: 6, g: 3.2, b: 1, fadeIn: 0 });
      for (let k = 0; k < 3; k++) {
        const b = -k * step / 3;
        P.puff({ x: r.pos.x + d.x * (b - 0.5), y: r.pos.y + d.y * (b - 0.5), z: r.pos.z + d.z * (b - 0.5), vx: (Math.random() - 0.5) * 0.8, vy: 0.3 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.8, life: 2.5 + Math.random(), s0: 0.25, s1: 1.8, a: 0.5, r: 0.86, g: 0.85, b: 0.84, drag: 1.2, lift: 0.3, fadeIn: 0.05 });
      }
    }
    // ---- burning cars, and wrecks still smouldering
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.copIdx !== undefined) {
        const cop = H.police.cops[f.copIdx];
        if (!cop || cop.body.pos !== f.pos) {
          // (the cruiser was retired: find it again by its body, or let the fire burn out)
          const j = H.police.cops.findIndex((c) => c.body.pos === f.pos);
          if (j >= 0) f.copIdx = j;
        }
      }
      if (f.fuse > 0) {
        f.fuse -= dt;
        if (f.fuse <= 0) {
          f.fuse = -1;
          f.t = 0;
          this.explode(f.pos.clone().add(new THREE.Vector3(0, 0.7, 0)), 6.5, 'player');
          if (f.car) {
            f.car.flags |= WRECK;
            H.traffic.fleet.paint(f.car.slot, 0x161514);
            if (f.car.body) {
              f.car.body.vy = Math.max(f.car.body.vy, 5);
              f.car.body.yawRate += (Math.random() - 0.5) * 2;
            }
          }
          if (f.copIdx !== undefined) H.police.wreckCop(f.copIdx);
        }
      }
      if (f.t > 60 && f.fuse < 0) {
        this.fires.splice(i, 1);
        continue;
      }
      // smoke from under the bonnet, flames once it's alight
      if (f.pos.distanceTo(H.camera.position) > 500) continue;
      const P = H.particles;
      const burning = f.fuse < 0 ? Math.max(0, 1 - f.t / 45) : Math.min(1, f.t / 2) * 0.8;
      f.smoke += dt * (8 + 10 * burning);
      while (f.smoke > 1) {
        f.smoke -= 1;
        const R = Math.random;
        P.puff({ x: f.pos.x + (R() - 0.5) * 1.6, y: f.pos.y + 1.1, z: f.pos.z + (R() - 0.5) * 1.6, vx: (R() - 0.5), vy: 2 + R() * 2, vz: (R() - 0.5), life: 3.5 + R() * 3, s0: 0.6, s1: 4 + R() * 3, a: 0.5 * (0.4 + burning), r: 0.1, g: 0.095, b: 0.09, drag: 0.6, lift: 1.5, fadeIn: 0.08 });
        if (burning > 0.05) P.spark({ x: f.pos.x + (R() - 0.5) * 1.8, y: f.pos.y + 0.7 + R() * 0.5, z: f.pos.z + (R() - 0.5) * 1.8, vx: (R() - 0.5) * 0.5, vy: 1.5 + R() * 2, vz: (R() - 0.5) * 0.5, life: 0.5 + R() * 0.4, s0: 0.6, s1: 1.3 * burning, a: burning, r: 3.6, g: 1.4, b: 0.3, drag: 1, lift: 2, fadeIn: 0.1 });
      }
    }
    // smoke from damaged (not yet burning) cars
    for (const c of H.traffic.cars) {
      const hp = c.hp ?? 100;
      if (hp > 35 || hp <= 0 || c.flags & WRECK || Math.random() > dt * 6) continue;
      if (c.pos.distanceTo(H.camera.position) > 250) continue;
      const fx = Math.sin(c.yaw) * c.spec.L * 0.35, fz = Math.cos(c.yaw) * c.spec.L * 0.35;
      H.particles.puff({ x: c.pos.x + fx, y: c.pos.y + c.spec.H * 0.7, z: c.pos.z + fz, vx: (Math.random() - 0.5) * 0.4, vy: 1, vz: (Math.random() - 0.5) * 0.4, life: 2.5, s0: 0.3, s1: 2.2, a: 0.35 * (1 - hp / 35), r: 0.55, g: 0.55, b: 0.55, drag: 1, lift: 0.8, fadeIn: 0.1 });
    }
    // ---- casings
    for (let i = 0; i < Math.min(MAX_CASINGS, this.casN); i++) {
      const c = this.cas[i];
      if (!c) continue;
      c.t += dt;
      if (!c.rest) {
        c.v.y -= 9.81 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt;
        c.r.y += c.w.y * dt;
        c.r.z += c.w.z * dt;
        if (c.p.y < c.floor) {
          c.p.y = c.floor;
          if (!c.sounded) {
            c.sounded = true;
            H.audio.casing(c.p.distanceTo(H.camera.position));
          }
          c.v.y = -c.v.y * 0.35;
          c.v.x *= 0.5;
          c.v.z *= 0.5;
          c.w.multiplyScalar(0.5);
          if (Math.abs(c.v.y) < 0.4) {
            c.rest = true;
            c.r.x = Math.PI / 2;
            c.r.z = 0;
          }
        }
      }
      const s = (c as Casing & { s?: number }).s ?? 1;
      this.m4.compose(c.p, this.q.setFromEuler(c.r), this.tmp.set(s, s, s));
      this.casings.setMatrixAt(i, this.m4);
    }
    this.casings.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ helpers

const J1 = new THREE.Vector3(), J2 = new THREE.Vector3();
/** a direction scattered in a cone */
export function jitter(d: THREE.Vector3, cone: number): THREE.Vector3 {
  if (cone <= 0) return d.clone();
  J1.set(d.z, 0, -d.x);
  if (J1.lengthSq() < 1e-6) J1.set(1, 0, 0);
  J1.normalize();
  J2.crossVectors(d, J1).normalize();
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * cone;
  return d.clone().addScaledVector(J1, Math.cos(a) * r).addScaledVector(J2, Math.sin(a) * r).normalize();
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const D = b * b - cc;
  if (D < 0) return -1;
  const t = -b - Math.sqrt(D);
  return t >= 0 ? t : -1;
}

/** a ray against a standing capsule (feet at base) */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, base: THREE.Vector3, r: number, h: number): number {
  const cx = base.x - o.x, cz = base.z - o.z;
  const A = d.x * d.x + d.z * d.z;
  if (A < 1e-6) return -1;
  const tx = (cx * d.x + cz * d.z) / A;
  const qx = cx - d.x * tx, qz = cz - d.z * tx;
  const r2 = qx * qx + qz * qz;
  if (r2 > r * r) return -1;
  const t = tx - Math.sqrt((r * r - r2) / A);
  if (t < 0) return -1;
  const y = o.y + d.y * t - base.y;
  return y >= 0 && y <= h ? t : -1;
}

/** a rough box for the player's own vehicles */
function vehicleBox(v: Drivable): { L: number; W: number; H: number } | null {
  switch (v.kind) {
    case 'roadster':
      return { L: 4.6, W: 2.0, H: 1.15 };
    case 'bike':
      return { L: 2.1, W: 0.7, H: 1.2 };
    case 'heli':
      return { L: 9, W: 2.4, H: 3.2 };
    case 'plane':
      return { L: 9, W: 3, H: 3 };
    case 'boat':
      return { L: 9, W: 2.6, H: 1.6 };
    default:
      return null;
  }
}
