import * as THREE from 'three';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Phys, Ragdoll } from '../lastframe/physics.ts';
import type { Env } from './env.ts';
import type { Ground } from './height.ts';
import type { Car, Cars } from './cars.ts';
import { castRay, lineOfSight, type Fx, type Sfx } from './combat.ts';
import { GUNS, makeGun, muzzleOf, poseGun, type GunId } from './weapons.ts';
import type { Actor } from './gunplay.ts';
import type { DressData } from './dressing.ts';
import { RoadGraph } from './roadgraph.ts';
import { fill } from './peds.ts';

/**
 * The Miami Beach Police, by stars:
 *
 *   1  a patrol car comes; the officers want to arrest you (stay still and they will)
 *   2  two cars, and they shoot if you run or fight
 *   3  three, and they ram you off the road
 *   4  four, with SWAT in a black van (rifles, armour)
 *   5  five, and the helicopter
 *   6  everything, the helicopter's marksman too
 *
 * A crime raises the heat (shooting in public, hitting people, pulling a driver out, killing,
 * anything against an officer); the stars follow the heat. Units come in from out of sight and
 * drive the streets to you (over the bridge too). They lose you when nobody (no officer, no car, no helicopter) has
 * seen you for a while: the stars flash grey while they search, then go.
 */

export interface You {
  pos: THREE.Vector3;
  driving: boolean;
  car: Car | null;
  armed: boolean;
  /** fired in the last few seconds */
  hostile: boolean;
  speed: number;
  hurt: (dmg: number, dir: THREE.Vector3) => void;
  dead: boolean;
}

type OState = 'seated' | 'chase' | 'arrest' | 'shoot' | 'return' | 'search' | 'leave' | 'dead';

export interface Officer extends Actor {
  p: Person;
  gun: THREE.Group;
  gunId: GunId;
  hp: number;
  state: OState;
  unit: Unit | null;
  yaw: number;
  cd: number;
  burst: number;
  rag: Ragdoll | null;
  deadT: number;
  playing: string;
  swat: boolean;
  aimK: number;
  kick: number;
  lineT: number;
  pooled: boolean;
  sx: number;
  sz: number;
  strafe: number;
}

interface Unit {
  car: Car;
  crew: Officer[];
  swat: boolean;
  path: { x: number; z: number }[];
  pathT: number;
  gone: boolean;
}

const CRIMES: Record<string, [number, number, number]> = {
  // [stars at least, heat added, witness radius (0: always seen)]
  shots: [1, 0.12, 55],
  assault: [1, 0.4, 30],
  hitped: [1, 0.55, 40],
  kill: [2, 0.9, 0],
  carjack: [1, 0.5, 30],
  hitcar: [1, 0.15, -1], // only if police see it
  copHurt: [3, 0.6, 0],
  copKill: [4, 1.2, 0],
  explode: [2, 0.8, 0],
  copCar: [3, 0.5, 0],
};

const LINES = {
  arrest: ['Police! Get on the ground!', 'Hands where I can see them!', "Don't move!", 'You are under arrest!', 'Get down! Now!'],
  shoot: ['Shots fired! Shots fired!', 'Suspect is armed!', 'Drop the weapon!', 'Take him down!', 'Officer needs assistance!', 'Open fire!'],
  chase: ['Stop! Police!', "Don't let him get away!", 'Pull over!', "He's on foot!"],
  search: ['Where did he go?', 'Spread out!', 'Suspect lost, keep looking.', 'Check the alleys!'],
};

export class Police {
  stars = 0;
  private heat = 0;
  private minStars = 0;
  readonly lastKnown = new THREE.Vector3();
  unseen = 0;
  readonly units: Unit[] = [];
  readonly officers: Officer[] = [];
  heli: Heli | null = null;
  /** busted: you stood still for the cuffs */
  onBust: (() => void) | null = null;
  private bustT = 0;
  private spawnT = 0;
  private sayT = 0;
  private rnd = Math.random;
  /** the streets of both districts (set by the page once downtown is in) */
  graph: RoadGraph;
  private logo: THREE.Texture;
  private swatLogo: THREE.Texture;
  private nearSiren: THREE.Vector3 | null = null;
  time = 0;
  /** 0 by day … 1 at night (the helicopter's searchlight) */
  night = 0;
  /** what's alive in the street, to count witnesses */
  witnesses: () => { x: number; z: number }[] = () => [];

  constructor(
    readonly scene: THREE.Scene,
    readonly env: Env,
    readonly kit: PeopleKit,
    readonly ground: Ground,
    readonly cars: Cars,
    readonly phys: Phys,
    readonly fx: Fx,
    readonly sfx: Sfx,
    data: DressData,
  ) {
    this.graph = new RoadGraph(data, []);
    this.logo = printTex('POLICE', '#e8e8e8');
    this.swatLogo = printTex('SWAT', '#e8e8e8');
  }

  get searching(): boolean {
    return this.stars > 0 && this.unseen > 2;
  }

  /** a crime at (x, z) */
  crime(kind: string, x: number, z: number) {
    const c = CRIMES[kind];
    if (!c) return;
    const [min, add, wr] = c;
    // seen? (by anyone near, or by the police)
    const copSees = this.officers.some((o) => o.alive && o.state !== 'seated' && Math.hypot(o.x - x, o.z - z) < 50) || this.units.some((u) => !u.car.wreck && Math.hypot(u.car.x - x, u.car.z - z) < 45) || (!!this.heli && this.heli.alive);
    if (wr < 0 && !copSees) return;
    if (wr > 0 && !copSees && !this.witnesses().some((w) => Math.hypot(w.x - x, w.z - z) < wr)) return;
    this.heat = Math.min(6.4, this.heat + add);
    this.minStars = Math.max(this.minStars, min);
    const before = this.stars;
    this.stars = Math.min(6, Math.max(this.minStars, Math.ceil(this.heat - 0.05)));
    if (this.stars > before || this.stars > 0) {
      // they know where you are
      this.lastKnown.set(x, 0, z);
      this.unseen = 0;
    }
    if (this.stars > before) this.spawnT = Math.min(this.spawnT, before === 0 ? 1.5 : 0.5);
  }

  /** cleared: after the hospital, the cells, or losing them */
  reset(clearUnits: boolean) {
    this.stars = 0;
    this.heat = 0;
    this.minStars = 0;
    this.unseen = 0;
    this.bustT = 0;
    if (clearUnits) {
      for (const u of [...this.units]) this.dropUnit(u);
      for (const o of [...this.officers]) this.dropOfficer(o);
      if (this.heli) {
        this.heli.dispose();
        this.heli = null;
      }
    }
  }

  /** everyone the bullets can hit */
  actors(): Actor[] {
    const out: Actor[] = this.officers.filter((o) => o.alive && o.state !== 'seated');
    if (this.heli && this.heli.alive) out.push(this.heli.hit);
    return out;
  }

  punchTarget(from: THREE.Vector3, yaw: number): Officer | null {
    let best: Officer | null = null, bd = 1.5;
    for (const o of this.officers) {
      if (!o.alive || o.state === 'seated') continue;
      const dx = o.x - from.x, dz = o.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d < bd && dx * Math.sin(yaw) + dz * Math.cos(yaw) > 0.2) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** blips for the map: [x, z, kind] */
  blips(): [number, number, 'car' | 'cop' | 'heli'][] {
    const b: [number, number, 'car' | 'cop' | 'heli'][] = [];
    for (const u of this.units) if (!u.car.wreck) b.push([u.car.x, u.car.z, 'car']);
    for (const o of this.officers) if (o.alive && o.state !== 'seated') b.push([o.x, o.z, 'cop']);
    if (this.heli && this.heli.alive) b.push([this.heli.pos.x, this.heli.pos.z, 'heli']);
    return b;
  }

  // ------------------------------------------------------------------ people
  private officer(swat: boolean): Officer {
    const female = !swat && this.rnd() < 0.25;
    const look: Look = swat
      ? { female: false, tone: this.rnd(), top: 'jacket', topColor: 0x15171a, top2: 0x1c1e22, accent: 0x0e0f11, bottom: 'trousers', bottomColor: 0x16171a, shoeColor: 0x0b0b0c, gloves: 0x111111, cap: 0x111214, logo: this.swatLogo, hair: 'none', hairColor: 0x1a120c, build: 1.05 }
      : { female, tone: this.rnd(), top: 'polo', topColor: 0x1b2740, top2: 0x1b2740, accent: 0x0f1626, bottom: 'trousers', bottomColor: 0x12151c, shoeColor: 0x0b0b0c, cap: 0x141c2c, logo: this.logo, hair: 'none', hairColor: 0x1a120c };
    const p = new Person(this.kit, look);
    this.env.prepObject(p.root, true, true);
    fill(p.root);
    const gunId: GunId = swat ? 'rifle' : this.stars >= 3 && this.rnd() < 0.35 ? 'shotgun' : 'pistol';
    const gun = makeGun(gunId);
    gun.visible = false;
    this.scene.add(gun);
    const o: Officer = {
      p, gun, gunId, x: 0, y: 0, z: 0, h: 1.8, r: 0.3, alive: true, cop: true, hp: swat ? 170 : 100, state: 'seated', unit: null, yaw: 0, cd: 1 + this.rnd(), burst: 0,
      rag: null, deadT: 0, playing: '', swat, aimK: 0, kick: 0, lineT: 0, pooled: false, sx: 0, sz: 0, strafe: this.rnd() < 0.5 ? 1 : -1, hurt: () => {},
    };
    o.hurt = (dmg, dir, zone, byYou) => this.hurtOfficer(o, dmg, dir, zone, byYou);
    this.officers.push(o);
    return o;
  }

  private hurtOfficer(o: Officer, dmg: number, dir: THREE.Vector3, zone: number, byYou: boolean) {
    if (!o.alive) return;
    o.hp -= dmg * (zone === 0 ? (o.swat ? 2 : 3.5) : zone === 2 ? 0.6 : o.swat ? 0.6 : 1);
    if (byYou) this.crime(o.hp <= 0 ? 'copKill' : 'copHurt', o.x, o.z);
    if (o.hp <= 0) {
      o.alive = false;
      o.state = 'dead';
      o.deadT = 0;
      o.gun.visible = false;
      o.p.root.rotation.set(0, o.yaw, 0);
      o.rag = this.phys.ragdoll(o.p, dir.clone().multiplyScalar(1.5), zone, dir, Math.min(70, 20 + dmg));
      if (this.rnd() < 0.6) this.say('Officer', ['Officer down!', 'Man down!', "We've got an officer down!"], o.p.root.position, true);
    }
  }

  private say(who: string, lines: string[], p: THREE.Vector3 | null, force = false) {
    if (!force && this.sayT > 0) return;
    this.sayT = 4 + this.rnd() * 3;
    this.sfx.say(who, lines[Math.floor(this.rnd() * lines.length)], p, { pitch: 0.8, rate: 1.2, force });
  }

  // ------------------------------------------------------------------ the streets
  /** a route along the streets (both districts, over the bridge) */
  private route(fx: number, fz: number, tx: number, tz: number): { x: number; z: number }[] {
    return this.graph.route(fx, fz, tx, tz);
  }

  // ------------------------------------------------------------------ units
  private spawnUnit(you: You, eye: THREE.Vector3, swat: boolean) {
    // an intersection 110-200 m away, out of sight
    const cands: [number, number][] = [];
    for (const [x, z] of this.graph.ring(you.pos.x, you.pos.z, 100, 260)) {
      if (Number.isNaN(this.ground.height(x, z))) continue;
      if (lineOfSight(this.ground, eye, new THREE.Vector3(x, 1.5, z)) && Math.hypot(x - eye.x, z - eye.z) < 160) continue;
      if (this.cars.list.some((c) => Math.hypot(c.x - x, c.z - z) < 8)) continue;
      cands.push([x, z]);
    }
    if (!cands.length) return;
    const [x, z] = cands[Math.floor(this.rnd() * cands.length)];
    // pointing down the street that leads toward you
    const snap = this.graph.headingAt(x, z, you.pos.x, you.pos.z);
    const drv = this.officer(swat);
    const mate = this.officer(swat);
    const kind = swat ? 'van' : this.rnd() < 0.3 ? 'policeSuv' : 'police';
    const car = this.cars.spawnUnit(kind, x, z, snap, drv.p, mate.p);
    if (swat) {
      car.root.traverse((m) => {
        const mm = m as THREE.Mesh;
        const mat = mm.material as THREE.MeshPhysicalMaterial;
        if (mm.isMesh && mat && mat.isMeshPhysicalMaterial && mat.clearcoat > 0) mat.color.setHex(0x0e0f12);
      });
      car.mass = 3000;
    }
    car.siren = true;
    const u: Unit = { car, crew: [drv, mate], swat, path: [], pathT: 0, gone: false };
    drv.unit = mate.unit = u;
    this.units.push(u);
    if (this.rnd() < 0.5) this.say('Dispatch', ['All units, suspect last seen near Ocean Drive.', 'Units responding.', 'Requesting backup.'], null);
  }

  private dropUnit(u: Unit) {
    for (const o of [...u.crew]) if (o.state === 'seated' || o.state === 'dead') this.dropOfficer(o);
    for (const o of u.crew) o.unit = null;
    this.cars.remove(u.car);
    u.gone = true;
    this.units.splice(this.units.indexOf(u), 1);
  }

  private dropOfficer(o: Officer) {
    if (o.rag) o.rag.dispose();
    o.p.root.removeFromParent();
    o.gun.removeFromParent();
    const i = this.officers.indexOf(o);
    if (i >= 0) this.officers.splice(i, 1);
    if (o.unit) {
      const k = o.unit.crew.indexOf(o);
      if (k >= 0) o.unit.crew.splice(k, 1);
    }
  }

  /** the crew out of the car (by their doors) */
  private disembark(u: Unit) {
    const c = u.car;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    u.crew.forEach((o, k) => {
      if (o.state !== 'seated') return;
      const side = k === 0 ? 1 : -1;
      const x = c.x + co * (c.halfW + 0.6) * side, z = c.z - s * (c.halfW + 0.6) * side;
      this.scene.attach(o.p.root);
      o.p.root.rotation.set(0, c.yaw, 0);
      o.x = x;
      o.z = z;
      const h = this.ground.height(x, z);
      o.y = Number.isNaN(h) ? 0 : h;
      o.yaw = c.yaw;
      o.state = 'chase';
      o.playing = '';
      o.gun.visible = true;
      if (k === 0 && c.driver === o.p) (c as { driver: Person | null }).driver = null;
      const ci = c.crew.indexOf(o.p);
      if (ci >= 0) c.crew.splice(ci, 1);
    });
    c.ai!.on = false;
  }

  /** an officer back in their seat */
  private embark(o: Officer) {
    const u = o.unit;
    if (!u || u.car.wreck) return false;
    const c = u.car;
    if (!c.driver) {
      if (!this.cars.reseat(c, o.p)) return false;
    } else {
      c.root.add(o.p.root);
      o.p.root.position.set(-c.seat.x, c.seat.y - 0.42, c.seat.z);
      o.p.root.rotation.set(0, 0, 0);
      o.p.play('sit', { fade: 0.2 });
      c.crew.push(o.p);
    }
    o.playing = 'sit';
    o.state = 'seated';
    o.gun.visible = false;
    return true;
  }

  // ------------------------------------------------------------------ the loop
  update(dt: number, you: You, eye: THREE.Vector3) {
    this.time += dt;
    this.sayT -= dt;
    // seen?
    const chest = you.pos.clone().setY(you.pos.y + 1.4);
    let seen = false;
    if (this.stars > 0 && !you.dead) {
      for (const o of this.officers) {
        if (!o.alive || o.state === 'seated') continue;
        if (Math.hypot(o.x - you.pos.x, o.z - you.pos.z) < 70 && lineOfSight(this.ground, new THREE.Vector3(o.x, o.y + 1.6, o.z), chest)) {
          seen = true;
          break;
        }
      }
      if (!seen)
        for (const u of this.units) {
          if (u.car.wreck || !u.car.driver) continue;
          if (Math.hypot(u.car.x - you.pos.x, u.car.z - you.pos.z) < 60 && lineOfSight(this.ground, new THREE.Vector3(u.car.x, u.car.y + 1.4, u.car.z), chest)) {
            seen = true;
            break;
          }
        }
      if (!seen && this.heli && this.heli.alive && Math.hypot(this.heli.pos.x - you.pos.x, this.heli.pos.z - you.pos.z) < 90) seen = true;
      if (seen) {
        this.lastKnown.copy(you.pos);
        if (this.unseen > 2) this.say('Officer', LINES.chase, null);
        this.unseen = 0;
      } else {
        // (only once they're here looking: on the way, dispatch still has you)
        const looking = this.officers.some((o) => o.alive && o.state !== 'seated' && Math.hypot(o.x - you.pos.x, o.z - you.pos.z) < 150) || this.units.some((u) => !u.car.wreck && Math.hypot(u.car.x - you.pos.x, u.car.z - you.pos.z) < 70) || !!this.heli;
        this.unseen = looking ? this.unseen + dt : Math.min(this.unseen, 1);
        if (this.unseen > 3 && this.unseen - dt <= 3) this.say('Officer', LINES.search, null, true);
        // lost you
        if (this.unseen > 9 + this.stars * 3) {
          this.reset(false);
          this.say('Dispatch', ['All units, suspect lost. Resume patrol.', 'Code 4, suspect is gone.'], null, true);
        }
      }
    }
    // how many are coming
    const wantCars = [0, 1, 2, 3, 4, 5, 6][this.stars];
    const liveUnits = this.units.filter((u) => !u.car.wreck && u.crew.some((o) => o.alive));
    this.spawnT -= dt;
    if (this.stars > 0 && liveUnits.length < wantCars && this.spawnT <= 0 && this.officers.length < 14) {
      this.spawnT = 3 + this.rnd() * 3;
      this.spawnUnit(you, eye, this.stars >= 4 && !liveUnits.some((u) => u.swat));
    }
    if (this.stars >= 5 && (!this.heli || (!this.heli.alive && this.heli.deadT > 30))) {
      if (this.heli) this.heli.dispose();
      this.heli = new Heli(this.scene, this.env, you.pos);
    }
    // the units
    this.nearSiren = null;
    let sirenD = Infinity;
    for (const u of [...this.units]) this.unit(u, dt, you, eye, (p) => {
      const d = p.distanceTo(eye);
      if (d < sirenD) {
        sirenD = d;
        this.nearSiren = p;
      }
    });
    for (const o of [...this.officers]) this.foot(o, dt, you, eye);
    if (this.heli) this.heli.update(dt, you, this, this.stars);
    this.sfx.sirenAt(this.nearSiren, this.time);
    // the cuffs
    if (this.bustT > 2.2 && !you.dead) {
      this.bustT = 0;
      this.onBust?.();
    }
  }

  private unit(u: Unit, dt: number, you: You, eye: THREE.Vector3, siren: (p: THREE.Vector3) => void) {
    const c = u.car;
    const ai = c.ai;
    const d = Math.hypot(c.x - you.pos.x, c.z - you.pos.z);
    const crewIn = u.crew.filter((o) => o.state === 'seated');
    // off duty: drive away and vanish out of sight
    if (this.stars === 0) {
      c.siren = false;
      const outOfSight = Math.hypot(c.x - eye.x, c.z - eye.z) > 70 && !lineOfSight(this.ground, eye, new THREE.Vector3(c.x, 1.2, c.z));
      if (crewIn.length === u.crew.length && (outOfSight || c.wreck)) {
        this.dropUnit(u);
        return;
      }
      if (ai && crewIn.length === u.crew.length && c.driver) {
        ai.on = true;
        ai.ram = false;
        ai.stop = 2;
        const away = this.graph.nearestNode(c.x + (c.x - you.pos.x) * 3, c.z + (c.z - you.pos.z) * 3);
        ai.tx = this.graph.x[away];
        ai.tz = this.graph.z[away];
      }
      return;
    }
    if (c.wreck) {
      for (const o of u.crew) if (o.state === 'seated') this.dropOfficer(o);
      return;
    }
    c.siren = true;
    if (d < 120) siren(new THREE.Vector3(c.x, c.y + 1, c.z));
    if (!ai || !c.driver) return;
    // the crew's out: wait (the driver gets back in when you drive off), and for the stragglers
    if (crewIn.length === 0) return;
    if (u.crew.some((o) => o.alive && o.state === 'return')) {
      ai.on = false;
      return;
    }
    const target = this.unseen > 2 ? this.lastKnown : you.pos;
    let tx = target.x, tz = target.z;
    // on foot: pull up on the road nearest you (not through the parked cars to the sidewalk)
    if (!you.driving || this.unseen > 2) {
      const q = this.graph.nearestRoad(tx, tz);
      tx = q.x;
      tz = q.z;
    }
    // lead a moving car
    if (you.driving && you.car && this.unseen <= 2) {
      tx += you.car.vx * 0.9;
      tz += you.car.vz * 0.9;
    }
    u.pathT -= dt;
    if (u.pathT <= 0 || !u.path.length) {
      u.pathT = 1.2;
      u.path = this.route(c.x, c.z, tx, tz);
    }
    while (u.path.length > 1 && Math.hypot(u.path[0].x - c.x, u.path[0].z - c.z) < 8) u.path.shift();
    const wp = u.path[0] ?? { x: tx, z: tz };
    const last = u.path.length <= 1;
    ai.on = true;
    ai.tx = last ? tx : wp.x;
    ai.tz = last ? tz : wp.z;
    ai.ram = you.driving && this.stars >= 3 && last;
    ai.stop = you.driving ? (ai.ram ? 0 : 7) : 4;
    // close and you're on foot (or stopped): out they get
    const vs = Math.hypot(c.vx, c.vz);
    if (d < 22 && vs < 1.5 && (!you.driving || (you.car && Math.hypot(you.car.vx, you.car.vz) < 1.5)) && this.unseen <= 2) {
      this.disembark(u);
      if (this.stars === 1 && !you.hostile) this.say('Officer', LINES.arrest, c.root.position, true);
      else this.say('Officer', LINES.shoot, c.root.position, true);
    }
  }

  private walk(o: Officer, want: number, speed: number, dt: number) {
    let best = NaN;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3]) {
      const a = want + off;
      const nx = o.x + Math.sin(a) * 0.9, nz = o.z + Math.cos(a) * 0.9;
      const h = this.ground.height(nx, nz);
      if (!Number.isNaN(h) && !this.ground.blocked(nx, nz) && h - o.y < 0.5 && !this.cars.blocks(nx, nz)) {
        best = a;
        break;
      }
    }
    if (Number.isNaN(best)) return;
    const nx = o.x + Math.sin(best) * speed * dt, nz = o.z + Math.cos(best) * speed * dt;
    const h = this.ground.height(nx, nz);
    if (!Number.isNaN(h) && !this.ground.blocked(nx, nz) && h - o.y < 0.5) {
      o.x = nx;
      o.z = nz;
    }
    if (speed > 0.2 && o.aimK < 0.5) {
      let dy = best - o.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      o.yaw += dy * Math.min(1, dt * 8);
    }
  }

  private play(o: Officer, clip: string, speed: number) {
    if (o.playing !== clip) {
      o.playing = clip;
      o.p.play(clip, { fade: 0.2 });
    }
    const act = (o.p as unknown as { current: THREE.AnimationAction | null }).current;
    const cs = this.kit.speed.get(clip) ?? (clip === 'run' ? 5.8 : clip === 'jog' ? 2.8 : 1.35);
    if (act) act.timeScale = clip === 'idle' ? 1 : THREE.MathUtils.clamp(speed / cs, 0.5, 1.6);
  }

  private foot(o: Officer, dt: number, you: You, eye: THREE.Vector3) {
    if (o.state === 'seated') {
      // (the car animates its driver; the passenger is ours)
      if (!o.unit || o.unit.car.driver !== o.p) o.p.update(dt);
      const w = o.p.root.getWorldPosition(new THREE.Vector3());
      o.x = w.x;
      o.y = w.y;
      o.z = w.z;
      return;
    }
    if (o.state === 'dead') {
      o.deadT += dt;
      if (o.rag) {
        o.x = o.rag.head.x;
        o.z = o.rag.head.z;
      }
      if (!o.pooled && o.deadT > 1.2) {
        o.pooled = true;
        const pel = o.p.worldOf('Bip01_Pelvis', new THREE.Vector3());
        const h = this.ground.height(pel.x, pel.z);
        this.fx.bloodPool(pel.setY(Number.isNaN(h) ? pel.y - 0.1 : h));
      }
      if (o.deadT > 40 && Math.hypot(o.x - eye.x, o.z - eye.z) > 60) this.dropOfficer(o);
      return;
    }
    o.lineT -= dt;
    o.cd -= dt;
    o.kick = Math.max(0, o.kick - dt * 6);
    const tx = you.driving && you.car ? you.car.x : you.pos.x, tz = you.driving && you.car ? you.car.z : you.pos.z;
    const dist = Math.hypot(tx - o.x, tz - o.z);
    const eyeP = new THREE.Vector3(o.x, o.y + 1.6, o.z);
    const chest = new THREE.Vector3(tx, (you.driving && you.car ? you.car.y + 1.0 : you.pos.y + 1.3), tz);
    const los = lineOfSight(this.ground, eyeP, chest);
    const off = this.stars === 0;
    const u = o.unit;
    // off duty, or you've driven off: back to the car
    if ((off || (you.driving && dist > 25 && u && !u.car.wreck)) && o.state !== 'leave') o.state = 'return';
    if (o.state === 'return' || o.state === 'leave') {
      if (!u || u.car.wreck) {
        // no car: walk away and vanish
        this.walk(o, Math.atan2(o.x - tx, o.z - tz), 1.6, dt);
        this.play(o, 'walk', 1.6);
        if (Math.hypot(o.x - eye.x, o.z - eye.z) > 60) this.dropOfficer(o);
      } else {
        const c = u.car;
        const k = u.crew.indexOf(o);
        const side = k === 0 ? 1 : -1;
        const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
        const dx = c.x + co * (c.halfW + 0.6) * side, dz = c.z - s * (c.halfW + 0.6) * side;
        const dd = Math.hypot(dx - o.x, dz - o.z);
        if (dd < 1.1) {
          if (this.embark(o)) return;
        }
        const run = !off && dd > 4;
        this.walk(o, Math.atan2(dx - o.x, dz - o.z), run ? 5 : 1.7, dt);
        this.play(o, run ? 'run' : 'walk', run ? 5 : 1.7);
        if (!off && !you.driving && dist < 25) o.state = 'chase';
      }
      o.aimK += (0 - o.aimK) * Math.min(1, dt * 6);
    } else {
      // arrest (one star, you haven't fought) or fight
      const arrest = this.stars === 1 && !you.hostile && !you.driving;
      o.state = arrest ? 'arrest' : 'chase';
      const target = this.unseen > 2 ? this.lastKnown : new THREE.Vector3(tx, 0, tz);
      const td = Math.hypot(target.x - o.x, target.z - o.z);
      const engage = o.gunId === 'shotgun' ? 10 : o.gunId === 'rifle' ? 30 : 20;
      if (arrest) {
        if (td > 1.4) {
          const run = td > 5;
          this.walk(o, Math.atan2(target.x - o.x, target.z - o.z), run ? 5.2 : 1.5, dt);
          this.play(o, run ? 'run' : 'walk', run ? 5.2 : 1.5);
        } else {
          this.play(o, 'idle', 0);
          // you're in reach and not going anywhere: the cuffs
          if (you.speed < 1.2) this.bustT += dt;
        }
        if (td > 2.2) this.bustT = Math.max(0, this.bustT - dt * 2);
        o.aimK += ((td < 12 ? 1 : 0.3) - o.aimK) * Math.min(1, dt * 6);
        if (o.lineT <= 0 && td < 15) {
          o.lineT = 4;
          this.say('Officer', LINES.arrest, o.p.root.position);
        }
      } else if (td > engage || !los) {
        this.walk(o, Math.atan2(target.x - o.x, target.z - o.z), 5.2, dt);
        this.play(o, 'run', 5.2);
        o.aimK += (0.2 - o.aimK) * Math.min(1, dt * 6);
      } else {
        // in range: side-step and shoot
        o.aimK += (1 - o.aimK) * Math.min(1, dt * 7);
        const toYou = Math.atan2(tx - o.x, tz - o.z);
        if (this.rnd() < dt * 0.4) o.strafe = -o.strafe;
        this.walk(o, toYou + (Math.PI / 2) * o.strafe, 1.2, dt);
        this.play(o, 'walk', 1.2);
        if (o.cd <= 0 && los && !you.dead) this.shoot(o, you, dist, chest);
      }
      if (o.aimK > 0.4) {
        let dy = Math.atan2(tx - o.x, tz - o.z) - o.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        o.yaw += dy * Math.min(1, dt * 10);
      }
    }
    const h = this.ground.heightSmooth(o.x, o.z);
    o.y += ((Number.isNaN(h) ? 0 : h) - o.y) * 0.5;
    o.p.root.position.set(o.x, o.y, o.z);
    o.p.root.rotation.set(0, o.yaw, 0);
    const near = Math.hypot(o.x - eye.x, o.z - eye.z) < 90;
    o.p.root.visible = near;
    o.gun.visible = near;
    if (!near) return;
    o.p.update(dt);
    const aimDir = chest.clone().sub(new THREE.Vector3(o.x, o.y + 1.45, o.z)).normalize();
    poseGun(o.p, o.gun, o.gunId, aimDir, o.aimK, o.kick);
  }

  /** an officer fires at you: hits by distance, your speed, cover; misses strike near you */
  private shoot(o: Officer, you: You, dist: number, chest: THREE.Vector3) {
    const spec = GUNS[o.gunId];
    if (o.burst <= 0) {
      o.burst = o.gunId === 'rifle' ? 3 + Math.floor(this.rnd() * 3) : o.gunId === 'shotgun' ? 1 : 2 + Math.floor(this.rnd() * 2);
    }
    o.burst--;
    o.cd = o.burst > 0 ? Math.max(0.12, spec.rate * 1.6) : 0.9 + this.rnd() * 1.1;
    o.kick = 1;
    const from = muzzleOf(o.gun, o.gunId, new THREE.Vector3());
    let p = (0.22 + this.stars * 0.035) * THREE.MathUtils.clamp(1.15 - dist / 45, 0.15, 1);
    if (you.speed > 4) p *= 0.55;
    if (you.driving) p *= 0.65;
    if (o.swat) p *= 1.25;
    const pellets = spec.pellets;
    let hits = 0;
    for (let k = 0; k < Math.min(pellets, 3); k++) if (this.rnd() < p) hits++;
    const dir = chest.clone().sub(from).normalize();
    if (hits > 0) {
      const dmg = (o.gunId === 'shotgun' ? 9 * pellets * 0.5 : o.gunId === 'rifle' ? 9 : 8) * (hits / Math.min(pellets, 3));
      if (you.driving && you.car) {
        this.cars.damage(you.car, dmg * 0.5, false);
        this.fx.impact(chest.clone(), dir.clone().negate(), 'metal', dir);
        if (this.rnd() < 0.4) you.hurt(dmg * 0.6, dir);
      } else {
        you.hurt(dmg, dir);
        this.fx.impact(chest.clone().addScaledVector(dir, -0.25), dir.clone().negate(), 'flesh', dir);
      }
      this.fx.tracer(from, chest);
    } else {
      // a miss: near you, into whatever's behind
      const miss = chest.clone().add(new THREE.Vector3((this.rnd() - 0.5) * 2.2, (this.rnd() - 0.6) * 1.6, (this.rnd() - 0.5) * 2.2));
      const d = miss.sub(from).normalize();
      const hit = castRay<Actor>(this.ground, from, d, 80, [], this.cars.list, (c) => c === (you.car as unknown));
      const end = hit ? hit.p : from.clone().addScaledVector(d, 80);
      this.fx.tracer(from, end);
      if (hit) {
        if (hit.kind === 'car' && hit.car) {
          this.fx.impact(hit.p, hit.n, 'metal', d);
          this.cars.damage(hit.car, spec.dmg * 0.15, false);
        } else this.fx.impact(hit.p, hit.n, hit.kind === 'ground' ? 'ground' : 'wall', d);
      }
    }
    this.fx.muzzle(from, dir, o.gunId !== 'pistol');
    this.sfx.shot(o.gunId, from);
    if (o.lineT <= 0 && this.rnd() < 0.3) {
      o.lineT = 5;
      this.say('Officer', LINES.shoot, o.p.root.position);
    }
  }
}

/** the print on a uniform: a small word on the chest (left half), a big one across the back (right) */
function printTex(word: string, col: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = col;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 34px "Barlow Condensed", Arial, sans-serif';
  g.fillText(word, 128, 128);
  g.font = '800 92px "Barlow Condensed", Arial, sans-serif';
  g.fillText(word, 384, 118, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ the helicopter
export class Heli {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private rotor: THREE.Object3D;
  private tail: THREE.Object3D;
  private beam: THREE.Mesh;
  private strobe: THREE.Mesh;
  private ang = Math.random() * 6.28;
  private cd = 3;
  hp = 420;
  alive = true;
  deadT = 0;
  private vy = 0;
  private spin = 0;
  readonly hit: Actor;
  constructor(readonly scene: THREE.Scene, env: Env, from: THREE.Vector3) {
    const white = new THREE.MeshPhysicalMaterial({ color: 0xe9eaec, roughness: 0.35, metalness: 0.2, clearcoat: 0.8 });
    const navy = new THREE.MeshPhysicalMaterial({ color: 0x14203a, roughness: 0.4, metalness: 0.2, clearcoat: 0.8 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.05, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.6, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), white);
    body.scale.set(1.0, 1.0, 2.1);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), navy);
    belly.scale.set(1.02, 0.9, 2.12);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), glass);
    canopy.position.set(0, 0.05, 1.05);
    canopy.scale.set(1, 0.9, 1.1);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 4.2, 10), white);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.35, -3.6);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.7), navy);
    fin.position.set(0, 0.85, -5.6);
    this.tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.12), dark);
    this.tail.position.set(0.15, 0.8, -5.6);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.45, 8), dark);
    mast.position.y = 1.15;
    const rotor = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 5.4), dark);
      blade.position.z = 2.7;
      const arm = new THREE.Group();
      arm.rotation.y = (k * Math.PI) / 2;
      arm.add(blade);
      rotor.add(arm);
    }
    rotor.position.y = 1.4;
    this.rotor = rotor;
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), dark);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(0.85 * sx, -1.25, 0.1);
      this.root.add(skid);
      for (const sz of [-0.8, 0.9]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), dark);
        leg.position.set(0.75 * sx, -1.0, sz);
        leg.rotation.z = sx * 0.3;
        this.root.add(leg);
      }
    }
    const beamG = new THREE.ConeGeometry(4, 1, 24, 1, true);
    beamG.translate(0, -0.5, 0);
    // a shaft of light: bright at the lamp, fading out toward the ground
    const fade = document.createElement('canvas');
    fade.width = 4;
    fade.height = 128;
    const fg = fade.getContext('2d')!;
    const gr = fg.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, '#555555');
    gr.addColorStop(1, '#0a0a0a');
    fg.fillStyle = gr;
    fg.fillRect(0, 0, 4, 128);
    this.beam = new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.92, 1), map: new THREE.CanvasTexture(fade), transparent: true, opacity: 0.02, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    // navigation lights: red port, green starboard, a white strobe under the belly
    const nav = (c: THREE.Color, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };
    nav(new THREE.Color(14, 0.3, 0.2), 1.0, 0, 0.4);
    nav(new THREE.Color(0.2, 12, 1), -1.0, 0, 0.4);
    this.strobe = nav(new THREE.Color(20, 20, 20), 0, -1.05, -0.4);
    this.beam.visible = false;
    this.root.add(body, belly, canopy, boom, fin, this.tail, mast, rotor);
    env.prepObject(this.root, true, true);
    this.beam.castShadow = false;
    rotor.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    scene.add(this.root, this.beam);
    this.pos.set(from.x + 220, 70, from.z + 120);
    this.root.position.copy(this.pos);
    const self = this;
    this.hit = {
      x: 0, y: 0, z: 0, h: 2.6, r: 1.4, alive: true, cop: true,
      hurt: (dmg: number) => {
        if (!self.alive) return;
        self.hp -= dmg;
        if (self.hp <= 0) self.alive = false;
      },
    };
  }

  update(dt: number, you: You, police: Police, stars: number) {
    this.rotor.rotation.y += dt * 38;
    this.tail.rotation.x += dt * 60;
    if (!this.alive) {
      // spinning down
      this.hit.alive = false;
      this.deadT += dt;
      this.spin += dt * 4;
      this.vy -= 9.8 * dt;
      this.pos.y += this.vy * dt;
      this.root.rotation.y += this.spin * dt;
      this.beam.visible = false;
      const g = police.ground.height(this.pos.x, this.pos.z);
      if (this.deadT < 0.05) police.fx.explosion(this.pos.clone());
      if (this.pos.y > (Number.isNaN(g) ? 0 : g) + 1) police.fx.smoke(this.pos, true, dt);
      else if (this.vy < 0) {
        this.vy = 0;
        police.fx.explosion(this.pos.clone());
        police.sfx.explosion(this.pos);
        police.fx.shake = 1;
        this.root.visible = false;
      }
      this.root.position.copy(this.pos);
      return;
    }
    // circle you, 35-45 m up
    this.ang += dt * 0.22;
    const gh = police.ground.height(you.pos.x, you.pos.z);
    const want = new THREE.Vector3(you.pos.x + Math.cos(this.ang) * 30, (Number.isNaN(gh) ? 0 : gh) + 40, you.pos.z + Math.sin(this.ang) * 30);
    const prev = this.pos.clone();
    this.pos.lerp(want, Math.min(1, dt * 0.5));
    const v = this.pos.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
    this.root.position.copy(this.pos);
    // nose into the direction of travel, leaning into it
    const face = Math.atan2(you.pos.x - this.pos.x, you.pos.z - this.pos.z);
    this.root.rotation.set(THREE.MathUtils.clamp(v.length() * 0.012, 0, 0.25), face, 0, 'YXZ');
    this.hit.x = this.pos.x;
    this.hit.y = this.pos.y - 1.3;
    this.hit.z = this.pos.z;
    // the searchlight (by night) points at you
    this.beam.visible = police.night > 0.3;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.011 * police.night;
    this.strobe.visible = Math.floor(police.time * 1.3) % 2 === 0 && (police.time * 1.3) % 1 < 0.12;
    const toYou = new THREE.Vector3(you.pos.x, you.pos.y, you.pos.z).sub(this.pos);
    const L = toYou.length();
    this.beam.position.copy(this.pos).setY(this.pos.y - 1);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toYou.clone().normalize());
    this.beam.scale.set(0.55, L, 0.55);
    if (police.night > 0.3) police.fx.lights.push({ p: new THREE.Vector3(you.pos.x, you.pos.y + 4, you.pos.z), i: 260, t: 0.03 });
    // the marksman (six stars)
    this.cd -= dt;
    if (stars >= 6 && this.cd <= 0 && !you.dead) {
      this.cd = 2.2 + Math.random() * 1.5;
      const from = this.pos.clone().add(new THREE.Vector3(0, -1, 0));
      const chest = you.pos.clone().setY(you.pos.y + 1.3);
      const dir = chest.clone().sub(from).normalize();
      if (Math.random() < (you.speed > 4 ? 0.2 : 0.35)) {
        you.hurt(14, dir);
        police.fx.tracer(from, chest);
      } else police.fx.tracer(from, chest.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1.3, (Math.random() - 0.5) * 3)));
      police.fx.muzzle(from, dir, true);
      police.sfx.shot('rifle', from);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.beam.removeFromParent();
  }
}
