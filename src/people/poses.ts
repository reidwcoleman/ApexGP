import * as THREE from 'three';
import type { Person } from './Humans.ts';

/**
 * Procedural body language on top of the animation clips: arms aimed in the
 * person's own frame (x = their left, y up, z forward), head turns, a lean.
 * Used by the fans (baked into the crowd's bone texture) and the podium drivers.
 */

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** aim one arm: `upper` and `fore` are directions with x measured outward from the body */
export function aimArm(p: Person, side: 'l' | 'r', upper: [number, number, number], fore: [number, number, number], w = 1) {
  const s = side === 'l' ? 1 : -1;
  p.aim(`upperarm_${side}`, `lowerarm_${side}`, p.dir(upper[0] * s, upper[1], upper[2], tmpA), w);
  p.aim(`lowerarm_${side}`, `hand_${side}`, p.dir(fore[0] * s, fore[1], fore[2], tmpB), w);
}

/** turn the head: yaw (left +), pitch (down +) */
export function turnHead(p: Person, yaw: number, pitch: number) {
  if (yaw) p.rotateWorld('neck_01', p.dir(0, 1, 0, tmpA), yaw * 0.4);
  if (yaw) p.rotateWorld('Head', p.dir(0, 1, 0, tmpA), yaw * 0.6);
  if (pitch) p.rotateWorld('Head', p.dir(1, 0, 0, tmpA), pitch);
}

/** lean the upper body forward (+) or back */
export function lean(p: Person, a: number) {
  if (a) p.rotateWorld('spine_02', p.dir(1, 0, 0, tmpA), a);
}

/** bend the knees (a squat of `a` radians at the knee); the pelvis drops so the feet stay put */
export function crouch(p: Person, a: number) {
  if (a <= 0) return;
  const ax = p.dir(1, 0, 0, tmpA);
  for (const s of ['l', 'r']) {
    p.rotateWorld(`thigh_${s}`, ax, -a * 0.5);
    p.rotateWorld(`calf_${s}`, ax, a);
    p.rotateWorld(`foot_${s}`, ax, -a * 0.5);
  }
  const pel = p.bones.pelvis;
  if (pel) {
    const drop = 0.45 * (1 - Math.cos(a * 0.5)) * 2;
    const d = UP.clone().multiplyScalar(-drop);
    pel.parent!.worldToLocal(pel.getWorldPosition(tmpB).add(d));
    pel.position.copy(tmpB);
    pel.updateMatrixWorld(true);
  }
}

export const ACT = { CHEER: 0, CLAP: 1, WAVE: 2, FLAG: 3, PHONE: 4, FIST: 5, JUMP: 6, IDLE: 7, DANCE: 8, TALK: 9 } as const;
export const ACT_COUNT = 10;

/** the Rocketbox clip under each act */
export const ACT_CLIP = ['cheer', 'clap', 'wave', 'cheer4', 'photo', 'cheer5', 'cheer3', 'idle', 'dance', 'talk'];

/**
 * (The old bodies stood like superheroes and needed their legs straightened under the
 * hips; the Rocketbox clips stand like people. Kept for the callers.)
 */
export function naturalStance(p: Person, w = 0.75) {
  void p;
  void w;
}

/**
 * A fan's act at phase `u` (0..1 around the loop) over its clip: the acts are the
 * Rocketbox clips themselves; only the flag is held up by hand.
 */
export function actPose(p: Person, act: number, u: number) {
  const TAU = Math.PI * 2;
  if (act === ACT.FLAG) {
    const w = Math.sin(u * TAU);
    aimArm(p, 'r', [0.3 + 0.3 * w, 0.9, 0.2], [0.1 + 0.35 * w, 0.95, 0.1]);
  }
}
