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
  /** other things that block (the cars) */
  obstacle: (x: number, z: number) => boolean = () => false;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly kit: PeopleKit, readonly ground: Ground, look: Look, private readonly sea: number) {
    this.person = new Person(kit, look);
    this.person.root.name = 'player';
  }

  spawn(x: number, z: number, yaw: number) {
    this.pos.set(x, this.ground.height(x, z), z);
    this.yaw = this.camYaw = yaw;
    this.person.root.position.copy(this.pos);
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
    // camera look
    this.camYaw -= inp.mdx * 0.0026;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - inp.mdy * 0.0022, -1.1, 0.55);
    this.camDist = THREE.MathUtils.clamp(this.camDist + inp.wheel * 0.45, 1.6, 9);
    const mv = inp.move();
    const want = Math.hypot(mv.x, mv.y);
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const walk = inp.down('KeyC') || inp.down('AltLeft');
    const target = want * (sprint ? 6.2 : walk ? 1.45 : 3.3);
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 5 : 8));
    if (want > 0.05) {
      // the camera's forward on the ground
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      const rx = -fz, rz = fx;
      const dx = fx * mv.y + rx * mv.x, dz = fz * mv.y + rz * mv.x;
      const face = Math.atan2(dx, dz);
      let d = face - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 10);
    }
    const sx = Math.sin(this.yaw) * this.speed * dt, sz = Math.cos(this.yaw) * this.speed * dt;
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
    this.person.root.rotation.y = this.yaw;
    this.person.root.visible = !this.hidden;
    this.person.update(dt);
    this.placeCamera(camera, dt);
  }

  placeCamera(camera: THREE.PerspectiveCamera, dt: number) {
    const tgt = this.tmp.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    // over the right shoulder
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    tgt.x += rx * 0.45;
    tgt.z += rz * 0.45;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const bx = -Math.sin(this.camYaw) * cp, by = -sp, bz = -Math.cos(this.camYaw) * cp;
    // pull in when the ground or a wall is in the way
    let d = this.camDist;
    for (let s = 0.4; s <= this.camDist; s += 0.15) {
      const px = tgt.x + bx * s, py = tgt.y + by * s, pz = tgt.z + bz * s;
      const h = this.ground.height(px, pz);
      if (!(py > h + 0.25)) {
        d = Math.max(0.5, s - 0.25);
        break;
      }
    }
    this.camD += (d - this.camD) * Math.min(1, dt * (d < this.camD ? 20 : 4));
    camera.position.set(tgt.x + bx * this.camD, tgt.y + by * this.camD, tgt.z + bz * this.camD);
    camera.lookAt(tgt);
  }
}
