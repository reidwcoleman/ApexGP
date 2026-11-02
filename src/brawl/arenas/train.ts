import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';
import { NPART, PEL, CHE, type Fighter } from '../fighter.ts';

const L = 6.5, R = 4.6, GAP = 3.75;
/** half the gap between the two tables, half a table's depth and width */
const HG = 1.3, HD = 9, HW = 14;
const PER = 4 * L + 2 * Math.PI * R;

/** a point s metres round the oval (front straight first, then round the right end) */
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

/** TOY EXPRESS: the wind-up train laps the table, faster and faster; the engine knocks you flying. */
export const TRAIN: ArenaDef = {
  id: 'train',
  name: 'Toy Express',
  blurb: 'A toy town on two playroom tables. Ride the train over the gap, dodge the engine.',
  file: 'train',
  killY: -6,
  camYaw: 0,
  camPitch: 0.62,
  camMin: 17,
  look: { sky: [0xf0c89a, 0xffe6c8], fog: 0xf0d8bc, fogNear: 70, fogFar: 200, sun: 0xffe6c4, sunI: 2.6, sunDir: [-0.5, 1, 0.45], hemi: [0xffeedd, 0x6a4a30, 0.45], exposure: 0.78, bloom: 0.55 },
  script(a, ctx) {
    const cars = [0, 1, 2].map((i) => a.nodes.get('mov_car_' + i)!);
    const key = a.nodes.get('wind_key');
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3(), d = new THREE.Vector3();
    const cool = new Map<Fighter, number>();
    let s = PER * 0.3, v = 3, t0 = -1, whistle = 4, puff = 0;
    const place = (n: THREE.Object3D, at: number) => {
      along(at, n.position);
      along(at + 0.25, p1);
      along(at - 0.25, p0);
      n.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    };
    cars.forEach((c, i) => place(c, s - i * GAP));
    const hit = (f: Fighter) => {
      d.copy(f.pos[CHE]).sub(cars[0].position).setY(0);
      const sd = Math.sign(d.dot(side)) || 1;
      const sp = 1.8 + v * 0.55;
      for (let i = 0; i < NPART; i++) {
        const b = f.bodies[i], m = b.mass();
        b.applyImpulse({ x: (fwd.x * sp + side.x * sd * 2.2) * m, y: 4 * m, z: (fwd.z * sp + side.z * sd * 2.2) * m }, true);
      }
      f.noHover = 0.4;
      f.stagger = 0.8;
      f.takeDaze(26, null, f.pos[CHE].clone(), CHE, 'slam');
      ctx.burst(f.pos[CHE].clone(), 0xffd040, 12);
      ctx.sfx('ding', undefined, 0.7);
    };
    return {
      step(dt, t) {
        if (t0 < 0) t0 = t;
        const rt = t - t0;
        v = Math.min(6.2, 3 + rt * 0.035);
        s += v * dt;
        cars.forEach((c, i) => place(c, s - i * GAP));
        const e = cars[0];
        fwd.set(Math.sin(e.rotation.y), 0, Math.cos(e.rotation.y));
        side.set(fwd.z, 0, -fwd.x);
        for (const [f, c] of cool) cool.set(f, c - dt);
        for (const f of ctx.fighters()) {
          if (!f.alive || f.out || (cool.get(f) ?? 0) > 0) continue;
          for (const i of [PEL, CHE]) {
            d.copy(f.pos[i]).sub(e.position);
            const ahead = d.dot(fwd), across = d.dot(side);
            if (ahead > 1.3 && ahead < 2.8 && Math.abs(across) < 1.3 && d.y < 3.0) {
              cool.set(f, 0.9);
              hit(f);
              break;
            }
          }
        }
        whistle -= dt;
        if (whistle <= 0) {
          whistle = 9 + Math.random() * 5;
          ctx.sfx('ding', undefined, 1.6);
        }
        // blocks that fell off come back on the felt
        for (const p of a.props) {
          const bt = p.body.translation();
          if (bt.y < -8) {
            p.body.setTranslation({ x: (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4), y: 2.5, z: (Math.random() - 0.5) * 2 }, true);
            p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      },
      frame(dt, t) {
        if (key) key.rotation.z = t * 2.5;
        puff -= dt;
        if (puff <= 0) {
          puff = 0.35;
          const e = cars[0];
          ctx.burst(new THREE.Vector3(0, 3.1, 1.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.rotation.y).add(e.position), 0xf4f0ea, 2);
        }
      },
      safe(p) {
        if (Math.abs(p.x) > HW - 0.8 || Math.abs(p.z) > HD - 0.8 || Math.abs(p.x) < HG + 0.6) return false;
        // keep out of the train's way
        for (const c of cars) if (Math.hypot(p.x - c.position.x, p.z - c.position.z) < 2.6) return false;
        return true;
      },
    };
  },
};
