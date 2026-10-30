import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';

/** TICK TOCK: the clock tower. Gears turn (and carry you), the pendulum sweeps the middle every few seconds. */
export const CLOCK: ArenaDef = {
  id: 'clock',
  name: 'Tick Tock',
  blurb: 'Turning gears high in a clock tower, and a pendulum that never misses a beat.',
  file: 'clock',
  killY: -8,
  camYaw: 0.25,
  camPitch: 0.62,
  camMin: 15,
  look: { sky: [0x2a1a14, 0x0c0705], fog: 0x140c08, fogNear: 24, fogFar: 75, sun: 0xffd6a0, sunI: 3.6, sunDir: [-0.4, 1, 0.7], hemi: [0xffd8b0, 0x2a1810, 1.2], exposure: 1, bloom: 1.0 },
  script(a, ctx) {
    const spin: [THREE.Object3D, number][] = [
      [a.nodes.get('mov_gear_a')!, 0.32],
      [a.nodes.get('mov_gear_b')!, -0.4],
      [a.nodes.get('mov_gear_c')!, 0.27],
      [a.nodes.get('mov_gear_d')!, -0.85],
    ];
    const base = spin.map(([n]) => n.rotation.y);
    const deco: [THREE.Object3D, number][] = [];
    a.root.traverse((o) => {
      if (o.name.startsWith('deco_gear_')) deco.push([o, (deco.length % 2 ? -1 : 1) * (0.08 + (deco.length % 3) * 0.05)]);
    });
    const pend = a.nodes.get('mov_pendulum')!;
    const hourH = a.nodes.get('hand_hour'), minH = a.nodes.get('hand_min');
    const PERIOD = 6.2, AMP = 0.56;
    let lastSide = 0;
    return {
      step(_dt, t) {
        spin.forEach(([n, w], i) => (n.rotation.y = base[i] + w * t));
        const s = Math.sin((t / PERIOD) * Math.PI * 2);
        pend.rotation.z = AMP * s;
        const side = s > 0.98 ? 1 : s < -0.98 ? -1 : 0;
        if (side && side !== lastSide) ctx.sfx('tick');
        if (side) lastSide = side;
      },
      frame(_dt, t) {
        for (const [n, w] of deco) n.rotation.y = w * t;
        if (minH) minH.rotation.z = -t * 0.05;
        if (hourH) hourH.rotation.z = -t * 0.05 / 12 - 1.2;
      },
    };
  },
};
