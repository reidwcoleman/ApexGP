// Parts that come off in crashes: a bumper knocked hard hangs off one corner; knocked hard again
// (or very hard the first time) it tears away and tumbles down the road, bouncing and sliding to a
// stop, and lies there a while. Keeps at most 24 loose pieces.
import * as THREE from 'three';
import type { Vehicle } from '../entities/vehicle';
import { groundAt } from '../world/map';
import type { Game } from './game';

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rest: boolean;
  age: number;
  half: number;
}

const MAX = 24;
const LIFE = 90;

export class Parts {
  pieces: Piece[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(private game: Game) {}

  /** a car took a hit of `speed` m/s at world (x, z) */
  hit(v: Vehicle, speed: number, x: number, z: number) {
    if (v.isBoat || v.type === 'bike' || speed < 6) return;
    // which end, and which side of it
    const lx = x - v.pos.x, lz = z - v.pos.z;
    const along = lx * v.fwdX() + lz * v.fwdZ();
    const across = lx * v.fwdZ() - lz * v.fwdX();
    if (Math.abs(along) < v.spec.len * 0.3) return;
    const end = along > 0 ? 0 : 1;
    const state = v.bumpers[end];
    if (state === 2) return;
    if (speed > 18 || (state === 1 && speed > 6)) this.tear(v, end, speed);
    else if (state === 0 && speed > 8) v.sagBumper(end, across >= 0 ? 1 : -1);
  }

  private tear(v: Vehicle, end: number, speed: number) {
    const d = v.detachBumper(end);
    if (!d) return;
    const mesh = new THREE.Mesh(d.geo, v.body.material);
    mesh.castShadow = true;
    mesh.position.copy(d.at);
    v.body.getWorldQuaternion(mesh.quaternion);
    this.game.scene.add(mesh);
    const out = end === 0 ? 1 : -1;
    const vel = new THREE.Vector3(v.fwdX() * (v.forwardSpeed * 0.55 + out * 2.5), 2 + Math.random() * 2 + speed * 0.06, v.fwdZ() * (v.forwardSpeed * 0.55 + out * 2.5));
    vel.x += (Math.random() - 0.5) * 3;
    vel.z += (Math.random() - 0.5) * 3;
    const spin = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    d.geo.computeBoundingBox();
    const half = Math.max(0.12, (d.geo.boundingBox!.max.y - d.geo.boundingBox!.min.y) * 0.35);
    this.pieces.push({ mesh, vel, spin, rest: false, age: 0, half });
    while (this.pieces.length > MAX) this.drop(this.pieces.shift()!);
  }

  private drop(p: Piece) {
    this.game.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
  }

  update(dt: number) {
    const f = this.game.focus;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      const m = p.mesh;
      if (p.age > LIFE || Math.hypot(m.position.x - f.x, m.position.z - f.z) > 260) {
        this.drop(p);
        this.pieces.splice(i, 1);
        continue;
      }
      if (p.rest) {
        // a car driving over it kicks it along
        for (const v of this.game.vehicles) {
          if (v.isBoat || Math.abs(v.speed) < 3) continue;
          if (Math.hypot(v.pos.x - m.position.x, v.pos.z - m.position.z) < 1.6) {
            p.rest = false;
            p.vel.set(v.fwdX() * v.forwardSpeed * 0.5, 1.5, v.fwdZ() * v.forwardSpeed * 0.5);
            p.spin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
            this.game.audio.crash(4, this.game.camera.position.distanceTo(m.position));
            break;
          }
        }
        continue;
      }
      p.vel.y -= 18 * dt;
      m.position.addScaledVector(p.vel, dt);
      this.q.setFromEuler(this.e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
      m.quaternion.multiply(this.q);
      const gy = groundAt(m.position.x, m.position.z) + p.half;
      if (m.position.y < gy) {
        m.position.y = gy;
        if (p.vel.y < -2.5) {
          // bounce, losing most of it
          p.vel.y *= -0.3;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.5);
        } else {
          // slide, then settle flat-ish
          p.vel.y = 0;
          const k = Math.max(0, 1 - 6 * dt);
          p.vel.x *= k;
          p.vel.z *= k;
          p.spin.multiplyScalar(k);
          if (Math.hypot(p.vel.x, p.vel.z) < 0.15) {
            p.rest = true;
            // lie on its face or back, keeping its heading
            this.e.setFromQuaternion(m.quaternion, 'YXZ');
            const flat = Math.abs(this.e.x) > Math.PI / 4 ? Math.PI / 2 * Math.sign(this.e.x) : 0;
            m.quaternion.setFromEuler(this.e.set(flat, this.e.y, 0, 'YXZ'));
          }
        }
      }
    }
  }
}
