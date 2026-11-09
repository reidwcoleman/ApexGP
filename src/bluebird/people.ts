// Bluebird: low-poly skier figures. Two parts per pose so jackets can be tinted per instance while
// pants, boots, skis and helmets keep their own colours.
import * as THREE from 'three';
import { mergeGeos } from './world.ts';

export type Pose = 'ski' | 'sit' | 'stand';

function box(w: number, h: number, d: number, x: number, y: number, z: number, col: [number, number, number], rx = 0, rz = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  const c = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

const PANTS: [number, number, number] = [0.14, 0.15, 0.18];
const BOOT: [number, number, number] = [0.08, 0.08, 0.09];
const SKI: [number, number, number] = [0.85, 0.2, 0.15];
const SKIN: [number, number, number] = [0.86, 0.66, 0.52];
const HELM: [number, number, number] = [0.12, 0.13, 0.16];
const GOG: [number, number, number] = [0.95, 0.62, 0.12];
const WHITE: [number, number, number] = [1, 1, 1];
const POLE: [number, number, number] = [0.6, 0.62, 0.66];

/** +z is forward (the way the skis point) */
export function skierGeo(pose: Pose): { jacket: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const J: THREE.BufferGeometry[] = [], R: THREE.BufferGeometry[] = [];
  if (pose === 'sit') {
    // hips at the origin (the seat), legs out front, skis hanging
    R.push(box(0.14, 0.14, 0.5, -0.12, 0.02, 0.25, PANTS), box(0.14, 0.14, 0.5, 0.12, 0.02, 0.25, PANTS));
    R.push(box(0.14, 0.5, 0.14, -0.12, -0.22, 0.5, PANTS), box(0.14, 0.5, 0.14, 0.12, -0.22, 0.5, PANTS));
    R.push(box(0.15, 0.16, 0.3, -0.12, -0.52, 0.56, BOOT), box(0.15, 0.16, 0.3, 0.12, -0.52, 0.56, BOOT));
    R.push(box(0.09, 0.03, 1.6, -0.13, -0.6, 0.7, SKI, -0.25), box(0.09, 0.03, 1.6, 0.13, -0.6, 0.7, SKI, -0.25));
    J.push(box(0.44, 0.58, 0.28, 0, 0.36, -0.02, WHITE, -0.08));
    J.push(box(0.12, 0.45, 0.12, -0.28, 0.34, 0.08, WHITE, -0.5), box(0.12, 0.45, 0.12, 0.28, 0.34, 0.08, WHITE, -0.5));
    R.push(box(0.22, 0.24, 0.24, 0, 0.82, 0.0, SKIN), box(0.26, 0.16, 0.28, 0, 0.94, -0.01, HELM), box(0.22, 0.08, 0.05, 0, 0.84, 0.13, GOG));
  } else {
    const ski = pose === 'ski';
    const lean = ski ? 0.32 : 0.06; // forward lean of the shins
    const knee = ski ? 0.42 : 0.5;
    R.push(box(0.09, 0.03, 1.65, -0.13, 0.03, 0.05, SKI), box(0.09, 0.03, 1.65, 0.13, 0.03, 0.05, SKI));
    R.push(box(0.15, 0.22, 0.3, -0.13, 0.16, 0.02, BOOT), box(0.15, 0.22, 0.3, 0.13, 0.16, 0.02, BOOT));
    R.push(box(0.14, 0.42, 0.14, -0.13, 0.42, 0.08, PANTS, lean), box(0.14, 0.42, 0.14, 0.13, 0.42, 0.08, PANTS, lean));
    R.push(box(0.15, 0.42, 0.15, -0.12, 0.45 + knee * 0.5, 0.06, PANTS, -lean * 0.8), box(0.15, 0.42, 0.15, 0.12, 0.45 + knee * 0.5, 0.06, PANTS, -lean * 0.8));
    const ty = ski ? 1.12 : 1.22, tz = ski ? 0.12 : 0.02;
    J.push(box(0.44, 0.6, 0.27, 0, ty, tz, WHITE, ski ? 0.35 : 0.05));
    J.push(box(0.12, 0.5, 0.12, -0.3, ty - 0.05, tz + 0.12, WHITE, ski ? -0.7 : -0.15, 0.15), box(0.12, 0.5, 0.12, 0.3, ty - 0.05, tz + 0.12, WHITE, ski ? -0.7 : -0.15, -0.15));
    const hy = ty + 0.48, hz = tz + (ski ? 0.2 : 0.03);
    R.push(box(0.22, 0.24, 0.24, 0, hy, hz, SKIN), box(0.26, 0.17, 0.28, 0, hy + 0.11, hz - 0.01, HELM), box(0.22, 0.08, 0.05, 0, hy + 0.02, hz + 0.13, GOG));
    // poles
    R.push(box(0.025, 1.1, 0.025, -0.36, 0.55, ski ? 0.05 : 0.15, POLE, ski ? -0.55 : 0.1), box(0.025, 1.1, 0.025, 0.36, 0.55, ski ? 0.05 : 0.15, POLE, ski ? -0.55 : 0.1));
  }
  return { jacket: mergeGeos(J), rest: mergeGeos(R) };
}

export const JACKETS = [0xd2453a, 0x2f7fe0, 0xf2c46d, 0x2fb65a, 0x8b2f56, 0xf08a24, 0x1d1d22, 0xe8e8ea, 0x3fb7c9, 0x6a4cc2, 0xff6f91, 0x2a4d8f];
