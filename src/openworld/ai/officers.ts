import * as THREE from 'three';
import type { PeopleKit, Look } from '../../people/Humans.ts';
import { printTexture } from '../../people/Humans.ts';
import { Gunman } from '../combat/Gunman.ts';
import type { WeaponId } from '../combat/weapons.ts';
import type { CollisionWorld, Contact } from '../sim/collide.ts';
import { makeSurf, type Network } from '../roads.ts';
import { rayCapsule } from '../combat/Combat.ts';

/**
 * Officers on foot. A cruiser that pulls up near the suspect lets its crew out: they come round the
 * doors with their guns drawn, close in, and either make the arrest (a suspect who stands still for
 * them) or — from two stars, or at anyone pointing a gun at them — take cover behind distance and
 * shoot: short aimed strings, steadier when you're still, wilder when you run. With five stars the
 * tactical team comes in black with carbines. Back in their car when the suspect drives off.
 */

/** cover: behind their cruiser (the engine block between them and the suspect), down, then up to fire */
export type OfficerState = 'exit' | 'chase' | 'hold' | 'cover' | 'return' | 'dead';

export interface Officer {
  g: Gunman;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  state: OfficerState;
  t: number;
  weapon: WeaponId;
  /** the car they came in (index lookup by object) */
  car: object | null;
  carPos: THREE.Vector3 | null;
  cool: number;
  burst: number;
  seen: number;
  last: THREE.Vector3;
  swat: boolean;
  /** strafe direction while shooting */
  side: number;
  onGround: boolean;
  vy: number;
  /** down behind the car right now */
  down: boolean;
}

export interface Target {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  onFoot: boolean;
  /** the player has a gun out and up (or is shooting) */
  threat: boolean;
  inVehicle: boolean;
}

let badge: THREE.CanvasTexture | null = null;
function policeLogo() {
  return (badge ??= printTexture({ text: 'POLICE', color: '#e8e8e8', sub: 'MIAMI' }, { text: 'POLICE', color: '#e8e8e8' }));
}

const BODIES = ['Pilot_Male_03', 'Gardener_Male_01'];

export function officerLook(swat: boolean, seed: number): Look {
  const tone = (Math.sin(seed * 91.7) * 0.5 + 0.5) * 0.9;
  if (swat)
    return {
      female: false, tone, hair: 'buzzed', hairColor: 0x1a120d, top: 'jacket', topColor: 0x15171b, top2: 0x0d0e10, accent: 0x2b2e33,
      bottom: 'trousers', bottomColor: 0x16181c, shoeColor: 0x0b0b0c, gloves: 0x111111, cap: 0x121316, logo: policeLogo(), body: BODIES[1],
    };
  return {
    female: false, tone, hair: 'buzzed', hairColor: 0x1a120d, top: 'polo', topColor: 0x1b2c4f, top2: 0x1b2c4f, accent: 0xc9a24a,
    bottom: 'trousers', bottomColor: 0x141c2e, shoeColor: 0x0b0b0c, cap: 0x17233f, logo: policeLogo(), body: BODIES[0],
  };
}

const UP = new THREE.Vector3(0, 1, 0);

export class Officers {
  readonly list: Officer[] = [];
  readonly group = new THREE.Group();
  kit: PeopleKit | null = null;
  /** shots this frame: [muzzle, target, weapon, accuracy] (the combat module fires them) */
  readonly shots: { from: THREE.Vector3; to: THREE.Vector3; weapon: WeaponId; acc: number }[] = [];
  /** an officer close enough to cuff a still suspect */
  cuffing = false;
  /** what they shout this frame */
  readonly callouts: string[] = [];
  private shoutT = 0;
  private readonly surf = makeSurf();
  private readonly contacts: Contact[] = [];
  private seed = 1;

  constructor(
    private readonly net: Network,
    private readonly world: CollisionWorld,
  ) {
    this.group.name = 'Officers';
  }

  get alive() {
    return this.list.filter((o) => o.state !== 'dead').length;
  }

  /** a crew member out of a car at `at` (the door), facing `yaw` */
  spawn(at: THREE.Vector3, yaw: number, weapon: WeaponId, swat: boolean, car: object | null, carPos: THREE.Vector3 | null): Officer | null {
    if (!this.kit || this.list.length >= 12) return null;
    const g = new Gunman(this.kit, officerLook(swat, this.seed++));
    g.setWeapon(weapon);
    this.group.add(g.root);
    const o: Officer = {
      g, pos: at.clone(), vel: new THREE.Vector3(), yaw, hp: swat ? 170 : 100, state: 'exit', t: 0.6, weapon, car, carPos, cool: 0.8 + Math.random(), burst: 0,
      seen: 0, last: at.clone(), swat, side: Math.random() < 0.5 ? 1 : -1, onGround: true, vy: 0, down: false,
    };
    this.list.push(o);
    return o;
  }

  remove(o: Officer) {
    const i = this.list.indexOf(o);
    if (i >= 0) this.list.splice(i, 1);
    o.g.dispose();
  }

  /** the first officer on a ray */
  ray(o: THREE.Vector3, d: THREE.Vector3, maxT: number): { i: number; t: number; head: boolean } | null {
    let best: { i: number; t: number; head: boolean } | null = null;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.state === 'dead') continue;
      const h = f.down ? 1.1 : 1.82;
      const t = rayCapsule(o, d, f.pos, 0.33, h);
      if (t >= 0 && t < (best ? best.t : maxT)) best = { i, t, head: o.y + d.y * t - f.pos.y > h - 0.27 };
    }
    return best;
  }

  /** hit: true when it killed them */
  shoot(i: number, dmg: number, dir: THREE.Vector3): boolean {
    const f = this.list[i];
    if (!f || f.state === 'dead') return false;
    f.hp -= dmg;
    f.seen = 5;
    if (f.hp <= 0) {
      f.state = 'dead';
      f.t = 0;
      f.g.kill(f.pos.clone().sub(dir));
      return true;
    }
    return false;
  }

  blast(at: THREE.Vector3, r: number): number {
    let k = 0;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.state === 'dead') continue;
      const d = f.pos.distanceTo(at);
      if (d < r * 1.4 && this.shoot(i, 220 * (1 - d / (r * 1.4)), f.pos.clone().sub(at).normalize())) k++;
    }
    return k;
  }

  /**
   * One frame. `wanted` sets the rules of engagement; `target` is the player. Returns the officers
   * that got back into their cars (their cars take them).
   */
  update(dt: number, wanted: number, T: Target, camPos: THREE.Vector3): Officer[] {
    this.shots.length = 0;
    this.callouts.length = 0;
    this.shoutT -= dt;
    this.cuffing = false;
    const back: Officer[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t -= dt;
      if (o.state === 'dead') {
        o.g.update(dt, o.pos, o.yaw, 0, true);
        if (o.t < -40 || o.pos.distanceTo(camPos) > 300) this.remove(o);
        continue;
      }
      const dx = T.pos.x - o.pos.x, dz = T.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      // eyes on: within 90 m and nothing in between (at chest height)
      const sees = d < 90 && this.world.segmentHits(o.pos.x, o.pos.z, T.pos.x, T.pos.z, o.pos.y + 1.4) >= 1;
      if (sees) {
        o.seen = 4;
        o.last.copy(T.pos);
      } else o.seen -= dt;
      const hostile = wanted >= 2 || T.threat;
      let want = new THREE.Vector3();
      let face = o.yaw;
      let aiming = false;
      let speed = 0;
      if (wanted === 0 || (T.inVehicle && d > 70)) o.state = 'return';
      // the first sight of the suspect: the shout
      if (sees && this.shoutT <= 0 && d < 40 && o.state !== 'return') {
        this.shoutT = 7 + Math.random() * 5;
        this.callouts.push(T.threat ? pick(['Police! Drop the weapon!', 'Gun! Drop it, drop it now!', 'Put the gun down!']) : T.onFoot ? pick(['Police! Freeze!', "Don't move! Hands where I can see them!", 'On the ground, now!']) : pick(['Police! Step out of the vehicle!', 'Turn the engine off! Hands out the window!']));
      }
      // under fire with their car close by: get behind it
      const carNear = o.carPos && Math.hypot(o.carPos.x - o.pos.x, o.carPos.z - o.pos.z) < 30 && d < 60;
      if (hostile && (T.threat || wanted >= 3) && carNear && o.seen > 0 && (o.state === 'chase' || o.state === 'hold')) {
        o.state = 'cover';
        o.t = 0.8 + Math.random();
        o.down = false;
      }
      o.g.crouch = false;
      switch (o.state) {
        case 'exit':
          // round the door, gun coming up
          if (o.t <= 0) o.state = 'chase';
          face = Math.atan2(dx, dz);
          aiming = hostile;
          break;
        case 'chase': {
          face = Math.atan2(dx, dz);
          const goal = sees ? T.pos : o.last;
          const gx = goal.x - o.pos.x, gz = goal.z - o.pos.z;
          const gd = Math.hypot(gx, gz);
          const stand = hostile ? (o.weapon === 'shotgun' ? 9 : o.swat ? 22 : 16) : 1.6;
          if (sees && hostile && d < stand + 8) {
            o.state = 'hold';
            o.t = 2 + Math.random() * 3;
          } else if (gd > (hostile ? 2 : 1.4)) {
            speed = gd > 12 ? 5.4 : hostile ? 2.6 : 3.2;
            want.set(gx / gd, 0, gz / gd).multiplyScalar(speed);
            face = Math.atan2(gx, gz);
          }
          aiming = hostile && sees && d < 45;
          // the arrest: up close to a suspect who isn't going anywhere
          if (!hostile && T.onFoot && d < 2.6 && Math.hypot(T.vel.x, T.vel.z) < 2.5) this.cuffing = true;
          break;
        }
        case 'hold': {
          // stand and shoot; sidestep now and then; move up if it's gone quiet
          face = Math.atan2(dx, dz);
          aiming = true;
          if (o.t <= 0) {
            o.side = -o.side;
            o.t = 1.5 + Math.random() * 3;
          }
          const strafe = o.t > 1.2 ? 0 : 1.6;
          want.set(Math.cos(face) * o.side * strafe, 0, -Math.sin(face) * o.side * strafe);
          speed = strafe;
          if (!sees && o.seen < 0) o.state = 'chase';
          if (d > 50) o.state = 'chase';
          if (!hostile) o.state = 'chase';
          break;
        }
        case 'cover': {
          face = Math.atan2(dx, dz);
          if (!o.carPos || !carNear || !hostile || (!sees && o.seen < -2)) {
            o.down = false;
            o.state = 'chase';
            break;
          }
          // the spot: the far side of the car from the suspect, by a wheel (the engine or the axle stops rounds)
          const cx = o.carPos.x - T.pos.x, cz = o.carPos.z - T.pos.z, cd = Math.hypot(cx, cz) || 1;
          const sx = -cz / cd * o.side * 1.1, sz = cx / cd * o.side * 1.1;
          const gx = o.carPos.x + (cx / cd) * 2.1 + sx - o.pos.x, gz = o.carPos.z + (cz / cd) * 2.1 + sz - o.pos.z;
          const gd = Math.hypot(gx, gz);
          if (gd > 0.6) {
            // running to it, low
            speed = gd > 3 ? 4.6 : 2.2;
            want.set(gx / gd, 0, gz / gd).multiplyScalar(speed);
            face = Math.atan2(gx, gz);
            o.down = false;
            aiming = false;
          } else {
            // down, then up over the hood for a string of shots, then down again
            if (o.t <= 0) {
              o.down = !o.down;
              o.t = o.down ? 1.2 + Math.random() * 1.6 : 1.4 + Math.random() * 1.4;
            }
            o.g.crouch = o.down;
            aiming = !o.down;
          }
          break;
        }
        case 'return': {
          aiming = false;
          if (!o.carPos) {
            if (o.pos.distanceTo(camPos) > 160) {
              this.remove(o);
              continue;
            }
            break;
          }
          const gx = o.carPos.x - o.pos.x, gz = o.carPos.z - o.pos.z;
          const gd = Math.hypot(gx, gz);
          if (gd < 2.2) {
            back.push(o);
            this.remove(o);
            continue;
          }
          speed = 5;
          want.set(gx / gd, 0, gz / gd).multiplyScalar(speed);
          face = Math.atan2(gx, gz);
          if (wanted > 0 && !(T.inVehicle && d > 70)) o.state = 'chase';
          break;
        }
      }
      // ---- the gun
      o.g.aiming = aiming;
      if (aiming) {
        const chest = T.pos.clone().add(new THREE.Vector3(0, T.onFoot ? 1.2 : 0.8, 0));
        const eye = o.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
        o.g.aimDir.copy(chest).sub(eye).normalize();
        o.cool -= dt;
        if (hostile && sees && o.cool <= 0 && o.g.aim > 0.85 && o.state !== 'exit') {
          const tv = Math.hypot(T.vel.x, T.vel.z);
          const acc = THREE.MathUtils.clamp(1 - d / 70, 0.15, 0.95) * (tv > 3 ? 0.55 : 1) * (o.swat ? 1.15 : 1);
          const m = o.g.muzzle(new THREE.Vector3());
          // a miss is aimed off the body: the round goes past
          // (real-world police hit rates are low: most rounds in a gunfight miss)
          const miss = Math.random() > acc * (o.swat ? 0.62 : 0.48);
          const aimAt = chest.clone();
          if (miss) aimAt.add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.2) * 2, (Math.random() - 0.5) * 3));
          this.shots.push({ from: m, to: aimAt, weapon: o.weapon, acc: miss ? 0.3 : 0.95 });
          o.g.kick = 1;
          const auto = o.weapon === 'rifle' || o.weapon === 'smg';
          if (auto && o.burst < 3) {
            o.burst++;
            o.cool = 0.11;
          } else {
            o.burst = 0;
            o.cool = o.weapon === 'shotgun' ? 1.2 + Math.random() : auto ? 0.6 + Math.random() * 0.8 : 0.45 + Math.random() * 0.7;
          }
        }
      }
      // ---- move
      const k = Math.min(1, dt * 8);
      o.vel.x += (want.x - o.vel.x) * k;
      o.vel.z += (want.z - o.vel.z) * k;
      o.pos.x += o.vel.x * dt;
      o.pos.z += o.vel.z * dt;
      const s = this.net.surface(o.pos.x, o.pos.z, o.pos.y + 0.6, this.surf);
      if (s.water) {
        o.pos.x -= o.vel.x * dt;
        o.pos.z -= o.vel.z * dt;
      } else o.pos.y = s.y;
      for (const c of this.world.circleContacts(o.pos.x, o.pos.z, 0.35, o.pos.y + 0.9, this.contacts)) {
        o.pos.x += c.nx * c.depth;
        o.pos.z += c.nz * c.depth;
      }
      // keep apart from each other
      for (const p of this.list) {
        if (p === o || p.state === 'dead') continue;
        const ex = o.pos.x - p.pos.x, ez = o.pos.z - p.pos.z;
        const e = Math.hypot(ex, ez);
        if (e < 0.8 && e > 1e-3) {
          o.pos.x += (ex / e) * (0.8 - e) * 0.5;
          o.pos.z += (ez / e) * (0.8 - e) * 0.5;
        }
      }
      o.yaw += Math.atan2(Math.sin(face - o.yaw), Math.cos(face - o.yaw)) * Math.min(1, dt * 9);
      o.g.update(dt, o.pos, o.yaw, Math.hypot(o.vel.x, o.vel.z), true);
      void UP;
    }
    return back;
  }

  clear() {
    for (const o of [...this.list]) this.remove(o);
  }
}

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
