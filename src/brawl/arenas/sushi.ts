import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';
import { NPART, CHE } from '../fighter.ts';

const L = 5, R = 4.6, SPEED = 2.0, NP = 9;
const PER = 4 * L + 2 * Math.PI * R;

/** where a point s metres round the loop is (front straight first, counter-clockwise from above) */
function along(s: number, out: THREE.Vector3) {
  s = ((s % PER) + PER) % PER;
  if (s < 2 * L) return out.set(-L + s, 0, R);
  s -= 2 * L;
  if (s < Math.PI * R) {
    const a = Math.PI / 2 - s / R;
    return out.set(L + R * Math.cos(a), 0, R * Math.sin(a));
  }
  s -= Math.PI * R;
  if (s < 2 * L) return out.set(L - s, 0, -R);
  s -= 2 * L;
  const a = -Math.PI / 2 - s / R;
  return out.set(-L + R * Math.cos(a), 0, R * Math.sin(a));
}

/** SUSHI SPIN: the belt carries you round, plates ride it, the knife comes down where the red ring shows. */
export const SUSHI: ArenaDef = {
  id: 'sushi',
  name: 'Sushi Spin',
  blurb: 'A conveyor-belt sushi counter. Ride the plates, dodge the chef’s knife.',
  file: 'sushi',
  killY: -5,
  camYaw: 0,
  camPitch: 0.72,
  camMin: 15,
  look: { sky: [0x3a2216, 0x140a06], fog: 0x2a1a10, fogNear: 30, fogFar: 85, sun: 0xfff0d8, sunI: 2.7, sunDir: [0.3, 1, 0.45], hemi: [0xffe6c8, 0x4a2a18, 0.85], exposure: 1, bloom: 0.8 },
  script(a, ctx) {
    const belt = (p: THREE.Vector3, out: THREE.Vector3) => {
      if (Math.abs(p.x) <= L) return out.set(p.z > 0 ? SPEED : -SPEED, 0, 0);
      const cx = p.x > 0 ? L : -L;
      const phi = Math.atan2(p.z, p.x - cx);
      return out.set(Math.sin(phi) * SPEED, 0, -Math.cos(phi) * SPEED);
    };
    a.mark('belt', ctx, { belt });
    const plates = Array.from({ length: NP }, (_, i) => a.nodes.get('mov_plate_' + i)!);
    const knife = a.nodes.get('mov_knife')!;
    const warn = a.nodes.get('knife_warn')!;
    const arm = a.nodes.get('cat_arm');
    warn.visible = false;
    const v = new THREE.Vector3(), t0 = new THREE.Vector3(), t1 = new THREE.Vector3();
    // the knife: wait, move over a spot (the ring shows where), chop, hold, lift
    let kT = 4, phase: 'wait' | 'aim' | 'chop' | 'hold' | 'lift' = 'wait';
    const from = new THREE.Vector3(0, 10, 0), to = new THREE.Vector3();
    let yaw0 = 0, yaw1 = 0;
    knife.position.copy(from);
    const hit = () => {
      ctx.sfx('chop');
      const n = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), knife.rotation.y);
      const across = new THREE.Vector3(-n.z, 0, n.x);
      for (const f of ctx.fighters()) {
        if (!f.alive || f.out) continue;
        v.copy(f.pos[CHE]).sub(to);
        const along = v.dot(n), side = v.dot(across);
        if (Math.abs(along) > 1.7 || Math.abs(side) > 0.9 || f.pos[CHE].y > 2.2) continue;
        const s = Math.sign(side) || 1;
        for (let i = 0; i < NPART; i++) {
          const b = f.bodies[i], m = b.mass();
          b.applyImpulse({ x: across.x * s * 6 * m, y: 3 * m, z: across.z * s * 6 * m }, true);
        }
        f.takeDaze(45, null, f.pos[CHE].clone(), CHE, 'slam');
      }
      ctx.burst(to.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xffffff, 10);
    };
    return {
      step(dt, t) {
        plates.forEach((p, i) => {
          along((i / NP) * PER + SPEED * t, p.position);
          p.rotation.y = t * 0.25 + i;
        });
        kT -= dt;
        if (phase === 'wait' && kT <= 0) {
          // somewhere on the belt, near someone if possible
          const fs = ctx.fighters().filter((f) => f.alive && !f.out);
          const s0 = Math.random() * PER;
          along(s0, to);
          if (fs.length && Math.random() < 0.7) {
            const f = fs[Math.floor(Math.random() * fs.length)];
            let best = s0, bd = 1e9;
            for (let s = 0; s < PER; s += 0.5) {
              along(s, t0);
              const d = t0.distanceToSquared(f.pos[CHE]);
              if (d < bd) {
                bd = d;
                best = s;
              }
            }
            along(best + SPEED * 1.6, to);
            along(best + SPEED * 1.6 + 0.1, t1);
          } else along(s0 + 0.1, t1);
          // blade across the belt
          const tx = t1.x - to.x, tz = t1.z - to.z;
          yaw0 = knife.rotation.y;
          yaw1 = Math.atan2(-tx, -tz) + Math.PI / 2;
          from.copy(knife.position);
          phase = 'aim';
          kT = 1.4;
          warn.visible = true;
          warn.position.set(to.x, 0.03, to.z);
          warn.rotation.y = yaw1;
        }
        if (phase === 'aim') {
          const k = 1 - Math.max(0, kT) / 1.4;
          const e = k * k * (3 - 2 * k);
          knife.position.set(from.x + (to.x - from.x) * e, from.y + (6 - from.y) * e, from.z + (to.z - from.z) * e);
          knife.rotation.y = yaw0 + (yaw1 - yaw0) * e;
          if (kT <= 0) {
            phase = 'chop';
            kT = 0.13;
          }
        } else if (phase === 'chop') {
          const k = 1 - Math.max(0, kT) / 0.13;
          knife.position.y = 6 - 6 * k * k;
          if (kT <= 0) {
            knife.position.y = 0.0;
            hit();
            phase = 'hold';
            kT = 0.8;
          }
        } else if (phase === 'hold' && kT <= 0) {
          phase = 'lift';
          kT = 1.0;
          warn.visible = false;
        } else if (phase === 'lift') {
          const k = 1 - Math.max(0, kT) / 1.0;
          knife.position.y = 10 * k;
          if (kT <= 0) {
            phase = 'wait';
            kT = 3 + Math.random() * 3;
          }
        }
        // rolls that fell off come back on a plate
        for (const p of a.props) {
          const bt = p.body.translation();
          if (bt.y < -6) {
            const pl = plates[Math.floor(Math.random() * NP)].position;
            p.body.setTranslation({ x: pl.x, y: 1.2, z: pl.z }, true);
            p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      },
      frame(_dt, t) {
        if (arm) arm.rotation.z = Math.sin(t * 3.2) * 0.45 - 0.2;
        if (warn.visible) warn.scale.setScalar(0.9 + Math.sin(t * 18) * 0.08);
      },
    };
  },
};
