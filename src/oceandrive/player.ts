import * as THREE from 'three';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Ground } from './height.ts';
import type { Input } from './input.ts';

/**
 * You, on foot: a Rocketbox scan in street clothes, walked by the clips at their own stride (the
 * clip's speed sets its playback rate, so feet don't skate). Moves relative to the camera; steps up
 * curbs and porch steps (≤ 55 cm), stopped by walls, tables, posts and trunks (the heightmap's mask),
 * slides along what stops it. Space jumps (enough for the coral wall). Third-person camera on the
 * shoulder, pulled in when a wall gets between it and you.
 */
const STEP = 0.55;
const R = 0.28;

export class Player {
  readonly person: Person;
  readonly pos = new THREE.Vector3();
  yaw = Math.PI;
  private vy = 0;
  private grounded = true;
  private speed = 0;
  private anim = '';
  camYaw = Math.PI;
  camPitch = -0.08;
  camDist = 3.4;
  private camD = 3.4;
  hidden = false;
  // ---- the fight
  hp = 200;
  readonly maxHp = 200;
  armor = 0;
  dead = false;
  /** 0 at ease … 1 aiming down the gun (set by the arsenal each frame) */
  aimK = 0;
  /** you can't run flat out with a gun up */
  /** a hit: (damage, direction it came from) */
  onHurt: ((dmg: number, dir: THREE.Vector3) => void) | null = null;
  onDie: ((dir: THREE.Vector3) => void) | null = null;
  /** for the bullets: your capsule */
  readonly hit = { x: 0, y: 0, z: 0, h: 1.8, r: 0.3, alive: true, hurt: (dmg: number, dir: THREE.Vector3) => this.hurt(dmg, dir) };
  /** other things that block (the cars) */
  obstacle: (x: number, z: number) => boolean = () => false;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly kit: PeopleKit, readonly ground: Ground, look: Look, private readonly sea: number) {
    this.person = new Person(kit, look);
    this.person.root.name = 'player';
  }

  /** the camera eases from where it was (the car's chase cam) to the shoulder over half a second */
  private blendFrom = new THREE.Vector3();
  private blendT = 1;
  hurt(dmg: number, dir: THREE.Vector3) {
    if (this.dead || dmg <= 0) return;
    const a = Math.min(this.armor, dmg * 0.7);
    this.armor -= a;
    this.hp -= dmg - a;
    this.onHurt?.(dmg, dir);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.hit.alive = false;
      this.onDie?.(dir);
    }
  }

  /** back on your feet, whole (after the hospital, or a night in the cells) */
  revive() {
    this.hp = this.maxHp;
    this.armor = 0;
    this.dead = false;
    this.hit.alive = true;
    this.anim = '';
    this.camPitch = -0.08;
    this.person.root.rotation.set(0, this.yaw, 0);
  }

  spawn(x: number, z: number, yaw: number, camera?: THREE.Camera) {
    const h = this.ground.height(x, z);
    this.pos.set(x, Number.isNaN(h) ? 0.15 : h, z);
    this.vy = 0;
    this.grounded = true;
    this.speed = 0;
    this.knockT = 0;
    this.yaw = this.camYaw = yaw;
    this.person.root.position.copy(this.pos);
    if (camera) {
      this.blendFrom.copy(camera.position);
      this.blendT = 0;
      this.camD = this.camDist;
    }
  }

  /** room for you to stand at (x, z), stepping down from a car floor at y */
  clearAt(x: number, z: number, y: number): boolean {
    const g = this.ground;
    const h0 = g.height(x, z);
    if (Number.isNaN(h0) || Math.abs(h0 - y) > 0.6 || h0 < this.sea - 0.6) return false;
    for (const [dx, dz] of [[0, 0], [R + 0.05, 0], [-R - 0.05, 0], [0, R + 0.05], [0, -R - 0.05]]) {
      if (g.blocked(x + dx, z + dz) || this.obstacle(x + dx, z + dz)) return false;
      if (Math.abs(g.height(x + dx, z + dz) - h0) > STEP) return false;
    }
    return true;
  }

  /**
   * Hit by a car: thrown along its path, down on the ground for a moment, then back up. (The body
   * tips over from the feet and slides; you can't move until you're up.)
   */
  private knockT = 0;
  private knockV = new THREE.Vector2();
  private knockDir = 0;
  knock(vx: number, vz: number) {
    if (this.knockT > 0) return;
    this.knockT = 2.4;
    const sp = Math.hypot(vx, vz);
    this.knockV.set(vx, vz).multiplyScalar(Math.min(1.1, 4 / Math.max(sp, 1)) * Math.min(1, sp / 6) * 1.6);
    this.knockDir = Math.atan2(vx, vz);
    this.vy = Math.min(4, sp * 0.35);
    this.grounded = false;
    this.speed = 0;
  }

  private walkable(x: number, z: number, fromY: number): boolean {
    for (const [dx, dz] of [[R, 0], [-R, 0], [0, R], [0, -R], [0, 0]]) {
      const g = this.ground;
      if (g.blocked(x + dx, z + dz) || this.obstacle(x + dx, z + dz)) return false;
      const h = g.height(x + dx, z + dz);
      if (!(h - fromY < STEP)) return false;
      if (h < this.sea - 1.05) return false; // too deep to wade
    }
    return true;
  }

  update(dt: number, inp: Input, camera: THREE.PerspectiveCamera) {
    // camera look (slower aimed: finer)
    const sens = 1 - this.aimK * 0.45;
    this.camYaw -= inp.mdx * 0.0026 * sens;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - inp.mdy * 0.0022 * sens, -1.1, 0.55);
    if (this.dead) {
      // the camera drifts round where you fell
      this.camYaw += dt * 0.25;
      this.camPitch += (-0.45 - this.camPitch) * Math.min(1, dt);
      this.placeCamera(camera, dt);
      return;
    }
    this.camDist = THREE.MathUtils.clamp(this.camDist + inp.wheel * 0.45, 1.6, 9);
    if (this.knockT > 0) {
      this.knocked(dt, camera);
      return;
    }
    const mv = inp.move();
    const want = Math.hypot(mv.x, mv.y);
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const walk = inp.down('KeyC') || inp.down('AltLeft');
    const target = want * (sprint && this.aimK < 0.3 ? 6.2 : walk ? 1.45 : this.aimK > 0.3 ? 2.4 : 3.3);
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 5 : 8));
    let moveYaw = this.yaw;
    if (want > 0.05) {
      // the camera's forward on the ground
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      const rx = -fz, rz = fx;
      const dx = fx * mv.y + rx * mv.x, dz = fz * mv.y + rz * mv.x;
      moveYaw = Math.atan2(dx, dz);
    }
    // aiming, you face the crosshair and strafe; otherwise you face where you're going
    const face = this.aimK > 0.3 ? this.camYaw : want > 0.05 ? moveYaw : this.yaw;
    {
      let d = face - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * (this.aimK > 0.3 ? 18 : 10));
    }
    if (this.aimK <= 0.3) moveYaw = want > 0.05 ? this.yaw : moveYaw;
    const sx = Math.sin(moveYaw) * this.speed * dt, sz = Math.cos(moveYaw) * this.speed * dt;
    const y = this.pos.y + (this.grounded ? 0 : 0.35);
    if (this.walkable(this.pos.x + sx, this.pos.z + sz, y)) {
      this.pos.x += sx;
      this.pos.z += sz;
    } else if (this.walkable(this.pos.x + sx, this.pos.z, y)) {
      this.pos.x += sx;
    } else if (this.walkable(this.pos.x, this.pos.z + sz, y)) {
      this.pos.z += sz;
    } else {
      this.speed *= 0.5;
    }
    // vertical
    const gh = this.ground.heightSmooth(this.pos.x, this.pos.z);
    if (this.grounded && inp.hit('Space')) {
      this.vy = 4.4;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= 9.81 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gh) {
        this.pos.y = gh;
        this.vy = 0;
        this.grounded = true;
      }
    } else {
      // step up quickly, fall off edges with gravity
      if (gh > this.pos.y) this.pos.y += (gh - this.pos.y) * Math.min(1, dt * 18);
      else if (this.pos.y - gh > 0.35) this.grounded = false;
      else this.pos.y += (gh - this.pos.y) * Math.min(1, dt * 14);
    }
    // wading: slower in the sea
    if (gh < this.sea - 0.2) this.speed *= 1 - Math.min(0.6, (this.sea - gh) * 0.6) * dt * 4;
    // animation by speed
    const a = !this.grounded ? 'jog' : this.speed < 0.25 ? 'idle' : this.speed < 2.1 ? 'walk' : this.speed < 4.6 ? 'jog' : 'run';
    if (a !== this.anim) {
      this.person.play(a, { fade: 0.25 });
      this.anim = a;
    }
    if (a !== 'idle') {
      const clipSpeed = this.kit.speed.get(a) ?? (a === 'walk' ? 1.4 : a === 'jog' ? 3.2 : 5.8);
      const act = (this.person as unknown as { current: THREE.AnimationAction | null }).current;
      if (act) act.timeScale = THREE.MathUtils.clamp(this.speed / clipSpeed, 0.5, 1.6);
    }
    this.person.root.position.copy(this.pos);
    this.person.root.rotation.set(0, this.yaw, 0);
    this.person.root.visible = !this.hidden;
    this.person.update(dt);
    this.hit.x = this.pos.x;
    this.hit.y = this.pos.y;
    this.hit.z = this.pos.z;
    this.placeCamera(camera, dt);
  }

  /** down: slide to a stop, lie there, get up */
  private knocked(dt: number, camera: THREE.PerspectiveCamera) {
    this.knockT -= dt;
    const t = 2.4 - this.knockT;
    // slide with friction, stopped by walls like walking
    const nx = this.pos.x + this.knockV.x * dt, nz = this.pos.z + this.knockV.y * dt;
    // thrown clear of the car: only the world stops the slide
    const nh = this.ground.height(nx, nz);
    if (!Number.isNaN(nh) && !this.ground.blocked(nx, nz) && nh - this.pos.y < STEP + 0.3) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else this.knockV.multiplyScalar(-0.2);
    this.knockV.multiplyScalar(Math.max(0, 1 - dt * (this.grounded ? 4 : 0.3)));
    const gh = this.ground.heightSmooth(this.pos.x, this.pos.z);
    this.vy -= 9.81 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.vy = 0;
      this.grounded = true;
    }
    // the fall: tip back over ~0.35 s, lie, then up over the last 0.6 s
    const down = t < 0.35 ? t / 0.35 : this.knockT < 0.6 ? Math.max(0, this.knockT / 0.6) : 1;
    const e = down * down * (3 - 2 * down);
    if (this.anim !== 'crouch' && this.knockT < 0.7) {
      this.person.play('crouch', { fade: 0.3 });
      this.anim = 'crouch';
    } else if (this.anim !== 'idle' && this.knockT >= 0.7) {
      this.person.play('idle', { fade: 0.15 });
      this.anim = 'idle';
    }
    this.person.root.position.set(this.pos.x, this.pos.y + e * 0.12, this.pos.z);
    this.person.root.rotation.set(-e * 1.45, this.knockDir + Math.PI, 0, 'YXZ');
    this.person.root.visible = !this.hidden;
    this.person.update(dt);
    if (this.knockT <= 0) {
      this.person.root.rotation.set(0, this.yaw, 0);
      this.knockT = 0;
    }
    this.placeCamera(camera, dt);
  }

  private aimCam = 0;
  placeCamera(camera: THREE.PerspectiveCamera, dt: number) {
    this.aimCam += (this.aimK - this.aimCam) * Math.min(1, dt * 9);
    const a = this.aimCam;
    const fov = 52 - a * 12;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const tgt = this.tmp.set(this.pos.x, this.pos.y + 1.55 + a * 0.05, this.pos.z);
    // over the right shoulder (further over, and closer in, aiming)
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    tgt.x += rx * (0.45 + a * 0.22);
    tgt.z += rz * (0.45 + a * 0.22);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const bx = -Math.sin(this.camYaw) * cp, by = -sp, bz = -Math.cos(this.camYaw) * cp;
    // pull in when the ground or a wall is in the way
    const want = this.camDist + (1.55 - this.camDist) * a;
    let d = want;
    for (let s = 0.4; s <= want; s += 0.15) {
      const px = tgt.x + bx * s, py = tgt.y + by * s, pz = tgt.z + bz * s;
      const h = this.ground.height(px, pz);
      // (and a car: the camera doesn't go through its roof)
      if (!(py > h + 0.25) || (py < this.pos.y + 1.7 && this.obstacle(px, pz))) {
        d = Math.max(0.5, s - 0.25);
        break;
      }
    }
    this.camD += (d - this.camD) * Math.min(1, dt * (d < this.camD ? 20 : 4));
    camera.position.set(tgt.x + bx * this.camD, tgt.y + by * this.camD, tgt.z + bz * this.camD);
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 0.55);
      const k = this.blendT * this.blendT * (3 - 2 * this.blendT);
      camera.position.lerpVectors(this.blendFrom, camera.position, k);
    }
    camera.lookAt(tgt);
  }
}
