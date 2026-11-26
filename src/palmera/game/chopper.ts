// The Skylark: a light helicopter you can fly. One sits on the sand at the beach and one on each
// rooftop helipad. F to climb in (and, landed, to climb out). W/S nose forward/back, A/D turn,
// Space climbs, Shift sinks. Land on the ground or any roof; fly into a wall and it throws you off it.
import * as THREE from 'three';
import { BEACH, groundAt, isWater, WATER_Y } from '../world/map';
import type { Game } from './game';

const SKID = 1.55; // body origin above the skids' contact

function skylark(): { root: THREE.Group; rotor: THREE.Object3D; tail: THREE.Object3D } {
  const root = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.3, metalness: 0.3, clearcoat: 1 });
  const stripe = new THREE.MeshPhysicalMaterial({ color: 0xe0503a, roughness: 0.35, metalness: 0.3, clearcoat: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.05, metalness: 0.3, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.5, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), paint);
  body.scale.set(1.15, 1.05, 2.2);
  const band = new THREE.Mesh(new THREE.SphereGeometry(1.01, 20, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.12), stripe);
  band.scale.set(1.15, 1.05, 2.2);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), glass);
  canopy.scale.set(1.02, 0.78, 1.25);
  canopy.position.set(0, 0.1, 1.0);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 4.6, 10), paint);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.3, -3.5);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), stripe);
  fin.position.set(0, 0.9, -5.6);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.45), paint);
  stab.position.set(0, 0.35, -5.2);
  root.add(body, band, canopy, boom, fin, stab);
  for (const x of [-0.8, 0.8]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.4, 8), dark);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(x, -SKID + 0.06, 0.1);
    for (const z of [0.75, -0.55]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.06), dark);
      strut.position.set(x * 0.92, -SKID + 0.33, z);
      root.add(strut);
    }
    root.add(skid);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.45, 8), dark);
  mast.position.set(0, 1.25, 0);
  root.add(mast);
  const rotor = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 4.8), dark);
    blade.position.z = 2.4;
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * Math.PI * 2;
    arm.add(blade);
    rotor.add(arm);
  }
  rotor.position.y = 1.5;
  const tail = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.14), dark);
  tail.add(tb);
  tail.position.set(0.12, 0.6, -5.7);
  root.add(rotor, tail);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { root, rotor, tail };
}

interface Craft {
  root: THREE.Group;
  rotor: THREE.Object3D;
  tail: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  spin: number; // rotor speed 0..1
}

export class Chopper {
  crafts: Craft[] = [];
  /** the one you're flying */
  active: Craft | null = null;
  private yawRate = 0;
  /** the one you're flying is sitting on the ground or a roof */
  grounded = false;
  private bump = 0;

  constructor(private game: Game) {
    const spots: { x: number; y: number; z: number; yaw: number }[] = [{ x: BEACH.x0 + 20, y: groundAt(BEACH.x0 + 20, -210), z: -210, yaw: Math.PI / 2 }];
    for (const b of game.city.helipads) {
      const c = game.city.padAt.get(b) ?? b;
      spots.push({ x: c.x, y: b.y0 + b.h, z: c.z, yaw: 0 });
    }
    for (const s of spots.slice(0, 4)) {
      const m = skylark();
      const c: Craft = { ...m, pos: new THREE.Vector3(s.x, s.y + SKID, s.z), vel: new THREE.Vector3(), yaw: s.yaw, pitch: 0, roll: 0, spin: 0 };
      game.scene.add(m.root);
      this.sync(c, 0);
      this.crafts.push(c);
    }
  }

  /** the ground (or roof) under a point, and whether that's a building top */
  private floor(x: number, z: number, y: number): number {
    // over the sea it won't come lower than a hover just above the waves
    let f = isWater(x, z) ? WATER_Y + 2.5 : groundAt(x, z);
    for (const b of this.game.map.buildings) {
      if (Math.abs(x - b.x) > b.w / 2 + 1 || Math.abs(z - b.z) > b.d / 2 + 1) continue;
      const top = b.y0 + b.h;
      if (y > top - 0.5) f = Math.max(f, top);
    }
    return f;
  }

  private sync(c: Craft, dt: number) {
    c.root.position.copy(c.pos);
    c.root.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ');
    c.rotor.rotation.y += c.spin * dt * 32;
    c.tail.rotation.x += c.spin * dt * 60;
  }

  get flying() {
    return !!this.active;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    const inp = g.input;
    for (const c of this.crafts) if (c !== this.active) {
      c.spin = Math.max(0, c.spin - dt * 0.25);
      this.sync(c, dt);
    }
    const c = this.active;
    if (!c) {
      if (p.vehicle || p.dead) return;
      for (const k of this.crafts) {
        if (Math.hypot(k.pos.x - p.pos.x, k.pos.z - p.pos.z) > 4.5 || Math.abs(k.pos.y - SKID - p.pos.y) > 3) continue;
        g.hud.prompt('<kbd>F</kbd> Fly the Skylark');
        if (inp.hit('KeyF')) {
          this.active = k;
          p.hidden = true;
          g.hud.toast('W/S forward/back · A/D turn · Space climb · Shift sink · F out when landed');
        }
        break;
      }
      return;
    }
    // ---- flying
    c.spin = Math.min(1, c.spin + dt * 0.5);
    const lift = c.spin > 0.85;
    const fwd = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const turn = (inp.down('KeyA') ? 1 : 0) - (inp.down('KeyD') ? 1 : 0);
    const up = (inp.down('Space') ? 1 : 0) - (inp.down('ShiftLeft') || inp.down('ShiftRight') ? 1 : 0);
    const floor = this.floor(c.pos.x, c.pos.z, c.pos.y - SKID);
    const alt = c.pos.y - SKID - floor;
    const grounded = alt < 0.15;
    this.grounded = grounded;
    this.yawRate += ((lift ? turn * 1.3 : 0) - this.yawRate) * Math.min(1, dt * 3);
    c.yaw += this.yawRate * dt;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    if (lift && !(grounded && up <= 0)) {
      c.vel.x += fx * fwd * 16 * dt;
      c.vel.z += fz * fwd * 16 * dt;
    }
    // drag: a top speed of about 48 m/s (107 mph), and it settles when you let go
    const drag = Math.min(1, dt * (fwd ? 0.32 : 0.9));
    c.vel.x -= c.vel.x * drag;
    c.vel.z -= c.vel.z * drag;
    const climb = lift ? up * 9 : -4;
    c.vel.y += (climb - c.vel.y) * Math.min(1, dt * 2.5);
    c.pos.addScaledVector(c.vel, dt);
    // the floor (ground, water, roof)
    const f2 = this.floor(c.pos.x, c.pos.z, c.pos.y - SKID);
    if (c.pos.y - SKID < f2) {
      if (c.vel.y < -6) this.hurt(c.vel.y * -8);
      c.pos.y = f2 + SKID;
      c.vel.y = Math.max(0, c.vel.y);
      c.vel.x *= 0.8;
      c.vel.z *= 0.8;
    }
    // walls: back out the way it came, a jolt and some damage
    for (const b of g.map.buildings) {
      const hx = b.w / 2 + 2.2, hz = b.d / 2 + 2.2;
      const dx = c.pos.x - b.x, dz = c.pos.z - b.z;
      if (Math.abs(dx) > hx || Math.abs(dz) > hz) continue;
      const top = b.y0 + b.h;
      if (c.pos.y - SKID > top - 0.3) continue;
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      const sp = Math.hypot(c.vel.x, c.vel.z);
      if (px < pz) {
        c.pos.x = b.x + Math.sign(dx) * hx;
        c.vel.x = -c.vel.x * 0.35;
      } else {
        c.pos.z = b.z + Math.sign(dz) * hz;
        c.vel.z = -c.vel.z * 0.35;
      }
      if (sp > 6 && this.bump <= 0) {
        this.hurt(sp * 3);
        this.bump = 0.6;
      }
    }
    this.bump -= dt;
    c.pos.y = Math.min(c.pos.y, 420);
    // tilt with the push, bank into turns
    const lf = c.vel.x * fx + c.vel.z * fz;
    c.pitch += ((grounded ? 0 : fwd * 0.22 + lf * 0.004) - c.pitch) * Math.min(1, dt * 3);
    c.roll += ((grounded ? 0 : -this.yawRate * Math.min(1, Math.abs(lf) / 20) * 0.45) - c.roll) * Math.min(1, dt * 3);
    this.sync(c, dt);
    // the pilot rides along (hidden) so everything that looks for the player finds them here
    p.pos.set(c.pos.x, c.pos.y - 0.6, c.pos.z);
    p.vx = c.vel.x;
    p.vz = c.vel.z;
    p.vy = 0;
    p.yaw = c.yaw;
    g.audio.setRotor(0.75);
    const wet = isWater(c.pos.x, c.pos.z);
    if (grounded) g.hud.prompt(wet ? 'Find land to set down' : '<kbd>F</kbd> Climb out');
    if (inp.hit('KeyF') && grounded && !wet && Math.hypot(c.vel.x, c.vel.z) < 3) this.leave();
  }

  private hurt(n: number) {
    const p = this.game.player;
    p.health = Math.max(0, p.health - n);
    this.game.hud.toast('Rotor strike!');
  }

  /** out of the cabin onto the skid side */
  leave() {
    const c = this.active;
    if (!c) return;
    const g = this.game;
    const p = g.player;
    this.active = null;
    this.grounded = false;
    p.hidden = false;
    const rx = Math.cos(c.yaw) * 2.2, rz = -Math.sin(c.yaw) * 2.2;
    p.pos.set(c.pos.x + rx, c.pos.y - SKID, c.pos.z + rz);
    p.vx = p.vz = p.vy = 0;
    c.vel.set(0, 0, 0);
    g.audio.setRotor(0);
  }

  /** camera: behind and above, looking along the heading */
  camera(): { x: number; y: number; z: number; yaw: number; speed: number } | null {
    const c = this.active;
    if (!c) return null;
    return { x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, speed: Math.hypot(c.vel.x, c.vel.z) };
  }
}
