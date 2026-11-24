import * as THREE from 'three';
import type { Input } from './input.ts';
import type { Player } from './player.ts';
import type { Ground } from './height.ts';
import type { Car, Cars } from './cars.ts';
import { castRay, type Fx, type Sfx, type Hittable } from './combat.ts';
import { GUNS, makeGun, muzzleOf, poseGun, posePunch, type GunId, type WeaponId } from './weapons.ts';

/** anyone a bullet can hurt */
export interface Actor extends Hittable {
  hurt: (dmg: number, dir: THREE.Vector3, zone: number, byYou: boolean) => void;
  cop?: boolean;
}

export interface Battlefield {
  ground: Ground;
  fx: Fx;
  sfx: Sfx;
  cars: Cars;
  /** everyone but you */
  actors: () => Actor[];
  /** you fired / hit something: who's alarmed, and the police */
  noise: (x: number, z: number, r: number) => void;
  crime: (kind: string, x: number, z: number) => void;
  /** the nearest person in front of you within a fist's reach */
  punchTarget: (from: THREE.Vector3, yaw: number) => { hit: (dir: THREE.Vector3) => void } | null;
  /** a round into a car with someone in it */
  carShot: (c: Car) => void;
}

const ORDER: WeaponId[] = ['fists', 'pistol', 'shotgun', 'rifle'];

/**
 * Your guns: 1 fists, 2 pistol, 3 shotgun, 4 carbine (or Tab / the wheel to cycle). Right mouse
 * raises the gun (the camera comes in over the shoulder), left fires where the crosshair is (from
 * the hip too, wider); R reloads. Fists throw a punch.
 */
export class Arsenal {
  weapon: WeaponId = 'fists';
  readonly ammo: Record<GunId, { mag: number; reserve: number }> = {
    pistol: { mag: GUNS.pistol.mag, reserve: GUNS.pistol.reserve },
    shotgun: { mag: GUNS.shotgun.mag, reserve: GUNS.shotgun.reserve },
    rifle: { mag: GUNS.rifle.mag, reserve: GUNS.rifle.reserve },
  };
  private guns: Partial<Record<GunId, THREE.Group>> = {};
  private cd = 0;
  private reloadT = 0;
  private kick = 0;
  /** keeps the gun up for a moment after a shot from the hip */
  private hot = 0;
  private punchT = 0;
  private punched = false;
  /** where the gun is aimed (world), for the people it's pointed at */
  readonly aimFrom = new THREE.Vector3();
  readonly aimDir = new THREE.Vector3();
  aiming = false;
  /** shots fired at you are seen by the police as an armed suspect */
  firedT = 99;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly scene: THREE.Scene, readonly player: Player, readonly W: Battlefield) {}

  get armed(): boolean {
    return this.weapon !== 'fists';
  }

  get reloading(): boolean {
    return this.reloadT > 0;
  }

  private gun(id: GunId): THREE.Group {
    let g = this.guns[id];
    if (!g) {
      g = makeGun(id);
      this.scene.add(g);
      this.guns[id] = g;
    }
    return g;
  }

  select(w: WeaponId) {
    if (w === this.weapon) return;
    this.weapon = w;
    this.reloadT = 0;
    this.cd = 0.25;
  }

  /** every frame, after the player's own update (the clip) */
  update(dt: number, inp: Input, camera: THREE.PerspectiveCamera, driving: boolean) {
    const P = this.player;
    this.cd = Math.max(0, this.cd - dt);
    this.kick = Math.max(0, this.kick - dt * 6);
    this.hot = Math.max(0, this.hot - dt);
    this.firedT += dt;
    for (const g of Object.values(this.guns)) g!.visible = false;
    if (driving || P.dead) {
      this.aiming = false;
      P.aimK = 0;
      return;
    }
    // choose
    for (let i = 0; i < ORDER.length; i++) if (inp.hit(`Digit${i + 1}`)) this.select(ORDER[i]);
    if (inp.hit('Tab') || inp.hit('KeyQ')) this.select(ORDER[(ORDER.indexOf(this.weapon) + 1) % ORDER.length]);
    if (this.weapon === 'fists') {
      this.fists(dt, inp);
      return;
    }
    const id = this.weapon;
    const spec = GUNS[id];
    const am = this.ammo[id];
    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const n = Math.min(spec.mag - am.mag, am.reserve);
        am.mag += n;
        am.reserve -= n;
      }
    } else if ((inp.hit('KeyR') && am.mag < spec.mag && am.reserve > 0) || (am.mag === 0 && am.reserve > 0)) {
      this.reloadT = spec.reload;
    }
    const want = inp.mouse(2) || this.hot > 0 || inp.mouse(0);
    this.aiming = inp.mouse(2);
    P.aimK += ((want && this.reloadT <= 0 ? (inp.mouse(2) ? 1 : 0.85) : 0) - P.aimK) * Math.min(1, dt * 12);
    // pose: the gun along the camera's line, landing on what the crosshair is over
    const g = this.gun(id);
    g.visible = !P.hidden;
    camera.getWorldDirection(this.aimDir);
    this.aimFrom.copy(P.pos).setY(P.pos.y + 1.45);
    const target = this.tmp.copy(camera.position).addScaledVector(this.aimDir, 40);
    const dir = target.sub(this.aimFrom).normalize();
    poseGun(P.person, g, id, dir, P.aimK, this.kick);
    // fire
    const trigger = spec.auto ? inp.mouse(0) : inp.click(0);
    if (trigger && this.cd <= 0 && this.reloadT <= 0) {
      if (am.mag <= 0) {
        this.cd = 0.25;
        this.W.sfx.hit('metal', null);
      } else {
        am.mag--;
        this.cd = spec.rate;
        this.hot = 1.2;
        this.fire(id, camera, g, P.aimK > 0.8);
      }
    }
  }

  private fire(id: GunId, camera: THREE.PerspectiveCamera, g: THREE.Group, aimed: boolean) {
    const spec = GUNS[id];
    const P = this.player;
    const W = this.W;
    const muzzle = muzzleOf(g, id, new THREE.Vector3());
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    // the ray starts level with you (not behind you at the camera)
    const o = camera.position.clone();
    const head = P.pos.clone().setY(P.pos.y + 1.5);
    o.addScaledVector(fwd, Math.max(0, head.sub(o).dot(fwd)));
    const spread = spec.spread * (aimed ? 0.33 : 1);
    const yours = W.cars.yours;
    for (let k = 0; k < spec.pellets; k++) {
      const d = fwd.clone();
      // a cone: random angle off the line
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const u = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
      const v = new THREE.Vector3().crossVectors(u, d);
      d.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
      const hit = castRay<Actor>(W.ground, o, d, spec.range, W.actors(), W.cars.list, (x) => x === (yours as unknown) || x === (P.hit as unknown));
      const end = hit ? hit.p : o.clone().addScaledVector(d, spec.range);
      if (k < 2) W.fx.tracer(muzzle, end);
      if (!hit) continue;
      if (hit.kind === 'actor' && hit.actor) {
        hit.actor.hurt(spec.dmg * (1 - Math.min(0.6, hit.d / spec.range * 0.6)), d, hit.zone ?? 1, true);
        W.fx.impact(hit.p, hit.n, 'flesh', d);
        W.sfx.hit('flesh', hit.p);
        // the blood lands behind them
        const bp = hit.p.clone().addScaledVector(d, 0.8 + Math.random());
        const h = W.ground.height(bp.x, bp.z);
        if (!Number.isNaN(h) && Math.random() < 0.7) W.fx.bloodSplash(bp.setY(h));
      } else if (hit.kind === 'car' && hit.car) {
        W.cars.damage(hit.car, spec.dmg * 0.22, true);
        W.fx.impact(hit.p, hit.n, hit.p.y - hit.car.y > 0.95 ? 'glass' : 'metal', d);
        W.sfx.hit('metal', hit.p);
        W.carShot(hit.car);
      } else {
        W.fx.impact(hit.p, hit.n, hit.kind === 'ground' ? 'ground' : 'wall', d);
      }
    }
    W.fx.muzzle(muzzle, fwd, id !== 'pistol');
    W.sfx.shot(id, null);
    this.kick = Math.min(1, this.kick + spec.kick);
    P.camPitch += spec.kick * 0.035 * (0.6 + Math.random() * 0.4);
    P.camYaw += (Math.random() - 0.5) * spec.kick * 0.02;
    W.fx.shake = Math.min(1, W.fx.shake + spec.kick * 0.15);
    this.firedT = 0;
    W.noise(P.pos.x, P.pos.z, id === 'pistol' ? 45 : 60);
    W.crime('shots', P.pos.x, P.pos.z);
  }

  private fists(dt: number, inp: Input) {
    const P = this.player;
    P.aimK += ((inp.mouse(2) ? 0.5 : 0) - P.aimK) * Math.min(1, dt * 10);
    this.aiming = false;
    if (this.punchT > 0) {
      this.punchT -= dt;
      const t = 1 - this.punchT / 0.5;
      const fwd = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
      const tgt = P.person.worldOf('Bip01_Head', new THREE.Vector3()).addScaledVector(fwd, 0.7).setY(P.pos.y + 1.45);
      posePunch(P.person, tgt, t);
      if (!this.punched && t > 0.32) {
        this.punched = true;
        const who = this.W.punchTarget(P.pos, P.yaw);
        if (who) {
          who.hit(fwd);
          this.W.sfx.hit('punch', null);
        }
      }
    } else if (inp.click(0)) {
      this.punchT = 0.5;
      this.punched = false;
      // swing toward the crosshair
      P.yaw = P.camYaw;
    }
  }
}
