import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';
import { NPART, PEL, CHE, HEAD, type Fighter } from '../fighter.ts';

/** how fast the turntable spins (rad/s) this far into the round: it creeps up, and turns round now and then */
function spin(t: number) {
  const base = Math.min(0.62, 0.16 + t * 0.006);
  // every 22 s it slows to a stop and spins the other way
  const P = 22, ph = t % P, dir = Math.floor(t / P) % 2 ? -1 : 1;
  const ease = ph < 2 ? ph / 2 : ph > P - 2 ? (P - ph) / 2 : 1;
  return base * dir * ease * ease * (3 - 2 * ease);
}

/** CAKE WALK: the cake turns ever faster, the icing rim is slippery, the candles sting. */
export const CAKE: ArenaDef = {
  id: 'cake',
  name: 'Cake Walk',
  blurb: 'A birthday cake on a spinning stand. Slippery icing, hot candles, long drop.',
  file: 'cake',
  killY: -6,
  camYaw: 0,
  camPitch: 0.66,
  camMin: 17,
  look: { sky: [0xf3c6a6, 0xffe4cf], fog: 0xf0d6c4, fogNear: 70, fogFar: 200, sun: 0xffe8cc, sunI: 2.2, sunDir: [-0.45, 1, 0.5], hemi: [0xffeede, 0x7a5a4a, 0.55], exposure: 0.82, bloom: 0.55 },
  script(a, ctx) {
    const tt = a.nodes.get('mov_turntable')!;
    const flames = Array.from({ length: 6 }, (_, i) => a.nodes.get('flame_' + i)).filter(Boolean) as THREE.Object3D[];
    const fp = new THREE.Vector3(), d = new THREE.Vector3();
    const cool = new Map<Fighter, number>();
    let ang = 0, w = 0, lastDir = 1, t0 = -1;
    const sting = (f: Fighter, at: THREE.Vector3) => {
      d.copy(f.pos[CHE]).sub(at).setY(0);
      if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
      d.normalize();
      for (let i = 0; i < NPART; i++) {
        const b = f.bodies[i], m = b.mass();
        b.applyImpulse({ x: d.x * 3.5 * m, y: 5.5 * m, z: d.z * 3.5 * m }, true);
      }
      f.noHover = 0.3;
      f.takeDaze(14, null, at.clone(), HEAD, 'slam');
      ctx.burst(at.clone(), 0xffa030, 12);
      ctx.sfx('whoosh', at, 1);
    };
    return {
      step(dt, t) {
        if (t0 < 0) t0 = t;
        const rt = t - t0;
        w = spin(rt);
        const dir = Math.sign(w) || lastDir;
        if (dir !== lastDir) ctx.sfx('ding', undefined, 0.8);
        lastDir = dir;
        ang += w * dt;
        tt.rotation.y = ang;
        // spinning flings you outward (the further out, the harder)
        for (const f of ctx.fighters()) {
          if (!f.alive || f.out) continue;
          const p = f.pos[PEL];
          const r = Math.hypot(p.x, p.z);
          if (r < 0.5 || r > 9.9 || p.y < -2) continue;
          const k = w * w * r * 1.6 * (f.ko > 0 ? 1.4 : 1);
          for (let i = 0; i < NPART; i++) {
            const b = f.bodies[i], m = b.mass();
            b.applyImpulse({ x: (p.x / r) * k * m * dt, y: 0, z: (p.z / r) * k * m * dt }, true);
          }
        }
        // candle flames
        for (const [f, c] of cool) cool.set(f, c - dt);
        for (const fl of flames) {
          fl.getWorldPosition(fp);
          for (const f of ctx.fighters()) {
            if (!f.alive || f.out || (cool.get(f) ?? 0) > 0) continue;
            for (const i of [HEAD, CHE, PEL]) {
              if (f.pos[i].distanceTo(fp) < 0.55) {
                cool.set(f, 1.2);
                sting(f, fp);
                break;
              }
            }
          }
        }
        // props that fell off come back on top
        for (const p of a.props) {
          const bt = p.body.translation();
          if (bt.y < -8) {
            p.body.setTranslation({ x: (Math.random() - 0.5) * 2, y: 3.5, z: (Math.random() - 0.5) * 2 }, true);
            p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      },
      frame(_dt, t) {
        flames.forEach((f, i) => {
          const s = 1 + Math.sin(t * 17 + i * 2.1) * 0.12 + Math.sin(t * 29 + i) * 0.06;
          f.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
        });
      },
      safe(p) {
        // keep clear of the slippery rim and the candles
        const r = Math.hypot(p.x, p.z);
        if (p.y < -0.5) return false;
        if (p.y < 0.5 && r > 7.4) return false;
        for (const fl of flames) {
          fl.getWorldPosition(fp);
          if (Math.hypot(fp.x - p.x, fp.z - p.z) < 0.6) return false;
        }
        return true;
      },
    };
  },
};
