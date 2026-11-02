import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';
import { NPART, HEAD, CHE, type Fighter } from '../fighter.ts';

const SIZE: Record<string, [number, number]> = { main: [6.6, 5.0], L: [3.8, 3.6], R: [3.8, 3.6] };

/** BALLOON DRIFT: the small baskets drift in and out of reach, the wind gusts, the burners flare. */
export const BALLOON: ArenaDef = {
  id: 'balloon',
  name: 'Balloon Drift',
  blurb: 'Three hot-air balloons above the clouds. Jump the gaps, hold on when the wind blows.',
  file: 'balloon',
  killY: -12,
  camYaw: 0,
  camPitch: 0.34,
  camMin: 19,
  look: { sky: [0x5a74c8, 0xffb48a], fog: 0xffc2a0, fogNear: 70, fogFar: 200, sun: 0xffd6a8, sunI: 2.9, sunDir: [-0.45, 0.85, 0.6], hemi: [0xc0ccff, 0xffa888, 0.75], exposure: 0.9, bloom: 0.9 },
  script(a, ctx) {
    const B = {
      main: a.nodes.get('mov_basket_main')!,
      L: a.nodes.get('mov_basket_L')!,
      R: a.nodes.get('mov_basket_R')!,
    };
    const flames = (['main', 'L', 'R'] as const).map((k) => ({ k, node: a.nodes.get('flame_' + k)!, t: -1, next: 3 + Math.random() * 6 }));
    for (const f of flames) f.node.scale.set(1, 0.001, 1);
    const flag = a.nodes.get('wind_flag');
    const fp = new THREE.Vector3();
    const cool = new Map<Fighter, number>();
    let t0 = -1, gustNext = 9, gustT = -1, gustDir = 1, gust = 0;
    const GUST = 2.8;
    return {
      step(dt, t) {
        if (t0 < 0) t0 = t;
        const rt = t - t0;
        B.main.position.set(0, Math.sin(rt * 0.6) * 0.25, 0);
        B.main.rotation.set(Math.sin(rt * 0.37 + 1) * 0.03, 0, Math.sin(rt * 0.45) * 0.04);
        B.L.position.set(-7.6 - Math.sin(rt * 0.33) * 1.6, Math.sin(rt * 0.5) * 1.1, Math.sin(rt * 0.21) * 0.8);
        B.L.rotation.set(0, Math.sin(rt * 0.17) * 0.15, Math.sin(rt * 0.5 + 0.6) * 0.04);
        B.R.position.set(7.6 + Math.sin(rt * 0.29) * 1.6, -Math.sin(rt * 0.43) * 1.1, -Math.sin(rt * 0.19) * 0.8);
        B.R.rotation.set(0, -Math.sin(rt * 0.15) * 0.15, Math.sin(rt * 0.43 + 2) * 0.04);
        // the wind: a gust every so often, from one side or the other
        gustNext -= dt;
        if (gustNext <= 0 && gustT < 0) {
          gustT = 0;
          gustDir = Math.random() < 0.5 ? -1 : 1;
          ctx.sfx('whoosh', undefined, 1.5);
        }
        if (gustT >= 0) {
          gustT += dt;
          const k = gustT / GUST;
          gust = gustDir * Math.sin(Math.min(1, k) * Math.PI) * 8.5;
          if (gustT > GUST) {
            gustT = -1;
            gust = 0;
            gustNext = 11 + Math.random() * 6;
          }
        }
        if (gust) {
          for (const f of ctx.fighters()) {
            if (!f.alive || f.out) continue;
            const k = (f.ko > 0 ? 1.4 : 1) * (f.hanging() ? 0.5 : 1);
            for (let i = 0; i < NPART; i++) {
              const b = f.bodies[i];
              b.applyImpulse({ x: gust * k * b.mass() * dt, y: 0, z: 0 }, true);
            }
          }
          for (const p of a.props) p.body.applyImpulse({ x: gust * p.body.mass() * dt * 0.8, y: 0, z: 0 }, true);
        }
        // burners: a roar of flame now and then; heads too close get singed
        for (const [f, c] of cool) cool.set(f, c - dt);
        for (const fl of flames) {
          fl.next -= dt;
          if (fl.next <= 0 && fl.t < 0) {
            fl.t = 0;
            ctx.sfx('whoosh', undefined, 0.9);
          }
          if (fl.t >= 0) {
            fl.t += dt;
            if (fl.t > 1.4) {
              fl.t = -1;
              fl.next = 4 + Math.random() * 6;
            }
            fl.node.getWorldPosition(fp);
            for (const f of ctx.fighters()) {
              if (!f.alive || f.out || (cool.get(f) ?? 0) > 0) continue;
              if (f.pos[HEAD].distanceTo(fp) < 1.4 || f.pos[CHE].distanceTo(fp) < 1.2) {
                cool.set(f, 1.5);
                for (let i = 0; i < NPART; i++) {
                  const b = f.bodies[i];
                  b.applyImpulse({ x: (Math.random() - 0.5) * 3 * b.mass(), y: 4 * b.mass(), z: (Math.random() - 0.5) * 3 * b.mass() }, true);
                }
                f.takeDaze(16, null, f.pos[HEAD].clone(), HEAD, 'slam');
                ctx.burst(fp.clone(), 0xff8a2a, 12);
              }
            }
          }
        }
        // sandbags that fell come back into the big basket
        for (const p of a.props) {
          const bt = p.body.translation();
          if (bt.y < -14) {
            p.body.setTranslation({ x: (Math.random() - 0.5) * 3, y: 2.5, z: (Math.random() - 0.5) * 2 }, true);
            p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      },
      frame(_dt, t) {
        for (const fl of flames) {
          if (fl.t < 0) fl.node.scale.set(1, 0.001, 1);
          else {
            const k = Math.min(1, fl.t / 0.15) * Math.min(1, (1.4 - fl.t) / 0.25);
            const s = k * (1 + Math.sin(t * 31) * 0.1 + Math.sin(t * 17) * 0.08);
            fl.node.scale.set(0.8 + s * 0.3, Math.max(0.001, s), 0.8 + s * 0.3);
          }
        }
        if (flag) {
          const want = gust < -0.5 ? Math.PI : gust > 0.5 ? 0 : flag.rotation.y;
          flag.rotation.y += (want - flag.rotation.y) * 0.08;
          flag.rotation.x = Math.sin(t * (gust ? 14 : 3)) * (gust ? 0.25 : 0.08);
        }
      },
      safe(p) {
        for (const k of ['main', 'L', 'R'] as const) {
          const n = B[k], [w, d] = SIZE[k];
          if (Math.abs(p.x - n.position.x) < w / 2 - 0.45 && Math.abs(p.z - n.position.z) < d / 2 - 0.45 && p.y > n.position.y - 1) return true;
        }
        return false;
      },
    };
  },
};
