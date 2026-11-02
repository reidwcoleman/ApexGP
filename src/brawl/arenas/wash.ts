import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';

/** the wash programme: [target spin rad/s, seconds, label] — turn, rest, turn back, rest… and every third round a spin */
const PROGRAM: [number, number, string][] = [
  [0.42, 7, 'wash'], [0, 1.2, 'rest'], [-0.42, 7, 'wash'], [0, 1.2, 'rest'],
  [0.5, 6, 'wash'], [0, 1.2, 'rest'], [-0.5, 6, 'wash'], [0, 1.2, 'rest'],
  [0.3, 2.2, 'warn'], [1.15, 4.5, 'spin'], [0, 2.5, 'rest'],
];
const LEN = PROGRAM.reduce((s, p) => s + p[1], 0);

function phaseAt(t: number) {
  let r = t % LEN;
  for (const p of PROGRAM) {
    if (r < p[1]) return p;
    r -= p[1];
  }
  return PROGRAM[0];
}

/** SPIN CYCLE: the drum turns, the paddles lift you and drop you, and now and then it spins. */
export const WASH: ArenaDef = {
  id: 'wash',
  name: 'Spin Cycle',
  blurb: 'Inside a giant washing machine. Ride the paddles, and hold on when it spins.',
  file: 'wash',
  killY: -7,
  camYaw: 0,
  camPitch: 0.27,
  camMin: 23,
  camFixed: { pos: [0, 6.4, 7.2], tgt: [0, 1.0, -4.2], follow: 0.3 },
  look: { sky: [0xbfe2f0, 0xf4efe4], fog: 0xe6eef0, fogNear: 50, fogFar: 140, sun: 0xfff6ea, sunI: 2.4, sunDir: [0.25, 1, 1.1], hemi: [0xe8f4ff, 0x8a8070, 0.8], exposure: 0.95, bloom: 0.7 },
  script(a, ctx) {
    const drum = a.nodes.get('mov_drum')!;
    // the drum and the machine round it don't shadow the inside (you couldn't see in otherwise)
    a.root.traverse((o) => {
      const n = o.name;
      if ((o as THREE.Mesh).isMesh && !/paddle|sock|towel/.test(n) && !/paddle|sock|towel/.test(o.parent?.name ?? '')) o.castShadow = false;
    });
    const lamp = new THREE.PointLight(0xfff1dd, 70, 0, 2);
    lamp.position.set(0, 9.6, -3.4);
    a.root.add(lamp);
    const lights: THREE.MeshStandardMaterial[] = [];
    for (let k = 0; k < 4; k++) {
      const m = (a.nodes.get('wash_light_' + k) as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
      if (m) {
        const c = m.clone();
        c.emissive = new THREE.Color(0x3aa0ff);
        (a.nodes.get('wash_light_' + k) as THREE.Mesh).material = c;
        lights.push(c);
      }
    }
    const bubbles: { o: THREE.Object3D; base: THREE.Vector3; k: number }[] = [];
    a.root.traverse((o) => {
      if (/^bubble_\d+$/.test(o.name)) bubbles.push({ o, base: o.position.clone(), k: bubbles.length });
    });
    let w = 0, ang = 0, label = 'wash', t0 = -1, beepT = 0;
    return {
      step(dt, t) {
        if (t0 < 0) t0 = t;
        const [target, , lab] = phaseAt(t - t0);
        if (lab !== label) {
          if (lab === 'warn') ctx.sfx('ding', undefined, 1.4);
          if (lab === 'spin') ctx.sfx('whoosh', undefined, 1.4);
          label = lab;
        }
        const acc = label === 'spin' ? 0.9 : 0.6;
        w += THREE.MathUtils.clamp(target - w, -acc * dt, acc * dt);
        ang += w * dt;
        drum.rotation.z = ang;
        if (label === 'warn') {
          beepT -= dt;
          if (beepT <= 0) {
            beepT = 0.5;
            ctx.sfx('ding', undefined, 1.8);
          }
        }
        // laundry that went over the seal comes back in through the top
        for (const p of a.props) {
          const bt = p.body.translation();
          if (bt.y < -9 || bt.z > 4) {
            p.body.setTranslation({ x: (Math.random() - 0.5) * 3, y: 6, z: -2 - Math.random() * 4 }, true);
            p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      },
      frame(_dt, t) {
        const warn = label === 'warn' || label === 'spin';
        lights.forEach((m, i) => {
          const on = warn ? Math.floor(t * 6 + i) % 2 === 0 : i === Math.floor(t * 1.5) % 4;
          m.emissive.set(warn ? 0xff4040 : 0x3aa0ff);
          m.emissiveIntensity = on ? 5 : 0.2;
        });
        for (const b of bubbles) {
          b.o.position.set(b.base.x + Math.sin(t * 0.3 + b.k) * 1.5, b.base.y + ((t * 0.6 + b.k * 3) % 18) - 6, b.base.z + Math.cos(t * 0.25 + b.k) * 1.2);
        }
      },
      safe(p) {
        // the seal and the door are the way out
        return p.z < -0.7 && Math.abs(p.x) < 4.6;
      },
    };
  },
};
