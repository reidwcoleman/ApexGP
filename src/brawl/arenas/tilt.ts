import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';
import { NPART, PEL, CHE } from '../fighter.ts';

/** TILT: the pinball table. Flippers swing on their own, bumpers and slingshots kick, a chrome ball rolls downhill and gets shot back up the lane. */
export const TILT: ArenaDef = {
  id: 'tilt',
  name: 'Tilt',
  blurb: 'A giant pinball table. Mind the flippers, and the drain between them.',
  file: 'tilt',
  killY: -4,
  camYaw: 0,
  camPitch: 0.78,
  camMin: 15,
  look: { sky: [0x1a0d33, 0x05030c], fog: 0x0b0619, fogNear: 45, fogFar: 140, sun: 0xf2f0ff, sunI: 3.4, sunDir: [0.35, 1, 0.55], hemi: [0x9a8cff, 0x2a1030, 1.1], exposure: 1, bloom: 1.25 },
  script(a, ctx) {
    const table = a.nodes.get('table')!;
    const flip = { L: a.nodes.get('mov_flipper_L')!, R: a.nodes.get('mov_flipper_R')! };
    const REST = 0.52, UP = -0.32;
    let flipT = 2.5, phase = -1, which = 3;
    const bumpers = [0, 1, 2].map((i) => ({ node: a.nodes.get('bumper_' + i)!, cap: a.nodes.get('bumper_' + i + '_cap')!, hit: 0 }));
    const slings = ['L', 'R'].map((s) => ({ node: a.nodes.get('kick_sling_' + s)!, s: s === 'L' ? 1 : -1 }));
    const cool = new Map<string, number>();
    const ball = a.props[0];
    let ballWait = 0;
    const inserts: THREE.MeshStandardMaterial[] = [];
    a.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.name?.startsWith('insert_') && !inserts.includes(m)) inserts.push(m);
    });
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(table.getWorldQuaternion(new THREE.Quaternion()));
    const p = new THREE.Vector3(), q = new THREE.Vector3(), d = new THREE.Vector3();
    const kick = (f: import('../fighter.ts').Fighter, dir: THREE.Vector3, speed: number) => {
      for (let i = 0; i < NPART; i++) {
        const b = f.bodies[i], m = b.mass();
        b.applyImpulse({ x: dir.x * speed * m, y: (dir.y * speed + 2.6) * m, z: dir.z * speed * m }, true);
      }
      f.noHover = 0.25;
      f.stagger = 0.5;
    };
    const lanePos = new THREE.Vector3(6.6, 1.0, 9.0);
    const resetBall = () => {
      table.updateWorldMatrix(true, false);
      const w = lanePos.clone().applyMatrix4(table.matrixWorld);
      ball.body.setTranslation({ x: w.x, y: w.y, z: w.z }, true);
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      ballWait = 1.4;
    };
    return {
      step(dt, t) {
        // flippers: a flick every few seconds, sometimes one side only
        flipT -= dt;
        if (flipT <= 0 && phase < 0) {
          phase = 0;
          which = Math.random() < 0.6 ? 3 : Math.random() < 0.5 ? 1 : 2;
          ctx.sfx('flip');
        }
        let ang = REST;
        if (phase >= 0) {
          phase += dt;
          if (phase < 0.07) ang = REST + (UP - REST) * (phase / 0.07);
          else if (phase < 0.4) ang = UP;
          else if (phase < 0.62) ang = UP + (REST - UP) * ((phase - 0.4) / 0.22);
          else {
            phase = -1;
            flipT = 1.4 + Math.random() * 2.4;
          }
        }
        flip.L.rotation.y = which & 1 ? -ang : -REST;
        flip.R.rotation.y = which & 2 ? ang : REST;
        // bumpers and slingshots
        for (const [k, v] of cool) cool.set(k, v - dt);
        const fs = ctx.fighters();
        for (const [bi, bp] of bumpers.entries()) {
          bp.node.getWorldPosition(p);
          for (const f of fs) {
            if (!f.alive || f.out) continue;
            for (const i of [PEL, CHE]) {
              d.copy(f.pos[i]).sub(p);
              const h = d.dot(up);
              d.addScaledVector(up, -h);
              if (h < -0.2 || h > 1.6 || d.length() > 1.25) continue;
              const key = bi + ':' + f.slot;
              if ((cool.get(key) ?? 0) > 0) continue;
              cool.set(key, 0.3);
              kick(f, d.normalize(), 8.5);
              bp.hit = 1;
              ctx.sfx('ding', p, 1);
              ctx.burst(f.pos[i].clone(), 0xffe14a, 6);
              break;
            }
          }
          // the ball too
          const bt = ball.body.translation();
          d.set(bt.x - p.x, bt.y - p.y, bt.z - p.z);
          const h = d.dot(up);
          d.addScaledVector(up, -h);
          if (h > -0.3 && h < 1.6 && d.length() < 1.7 && (cool.get('b' + bi) ?? 0) <= 0) {
            cool.set('b' + bi, 0.25);
            d.normalize();
            const v = ball.body.linvel();
            ball.body.setLinvel({ x: d.x * 11 + v.x * 0.2, y: v.y, z: d.z * 11 + v.z * 0.2 }, true);
            bp.hit = 1;
            ctx.sfx('ding', p, 1);
          }
        }
        for (const s of slings) {
          s.node.getWorldPosition(p);
          for (const f of fs) {
            if (!f.alive || f.out) continue;
            d.copy(f.pos[PEL]).sub(p);
            d.addScaledVector(up, -d.dot(up));
            if (d.length() > 1.0) continue;
            const key = 's' + s.s + ':' + f.slot;
            if ((cool.get(key) ?? 0) > 0) continue;
            cool.set(key, 0.4);
            q.set(-s.s * 0.8, 0, -0.6).normalize();
            kick(f, q, 7);
            ctx.sfx('ding', p, 0.8);
          }
        }
        // the ball: back up the lane when it drains
        const bt = ball.body.translation();
        if (bt.y < -3 || Math.abs(bt.x) > 12) resetBall();
        if (ballWait > 0) {
          ballWait -= dt;
          if (ballWait <= 0) {
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(table.getWorldQuaternion(new THREE.Quaternion()));
            ball.body.setLinvel({ x: dir.x * 24, y: dir.y * 24, z: dir.z * 24 }, true);
            ctx.sfx('clunk');
          }
        }
        void t;
      },
      frame(dt, t) {
        for (const bp of bumpers) {
          bp.hit = Math.max(0, bp.hit - dt * 4);
          const s = 1 + bp.hit * 0.25;
          bp.cap.scale.set(s, 1, s);
        }
        inserts.forEach((m, i) => (m.emissiveIntensity = 1.5 + 3.5 * Math.max(0, Math.sin(t * 5 - i * 1.3))));
      },
    };
  },
};
