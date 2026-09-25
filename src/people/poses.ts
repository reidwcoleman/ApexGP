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

/** the clip under each act */
export const ACT_CLIP = ['Idle_Loop', 'Idle_Loop', 'Idle_Loop', 'Idle_Loop', 'Idle_Loop', 'Idle_Loop', 'Jump_Loop', 'Idle_Loop', 'Dance_Loop', 'Idle_Talking_Loop'];

/**
 * A fan's arms for an act at phase `u` (0..1 around the loop; every rhythm is a
 * whole number of beats per loop so the bake loops cleanly).
 */
/** stand like a person, not a superhero: feet under the hips, knees soft */
export function naturalStance(p: Person, w = 0.75) {
  for (const s of ['l', 'r'] as const) {
    const o = s === 'l' ? 1 : -1;
    p.aim(`thigh_${s}`, `calf_${s}`, p.dir(0.05 * o, -1, 0.03, tmpA), w);
    p.aim(`calf_${s}`, `foot_${s}`, p.dir(0.02 * o, -1, -0.04, tmpA), w);
  }
}

export function actPose(p: Person, act: number, u: number) {
  const TAU = Math.PI * 2;
  if (act !== ACT.JUMP && act !== ACT.DANCE) naturalStance(p);
  const beat = (n: number) => Math.sin(u * TAU * n);
  switch (act) {
    case ACT.CHEER: {
      const b = beat(3) * 0.5 + 0.5;
      aimArm(p, 'l', [0.45, 0.86, 0.18], [0.25 + 0.1 * b, 0.95, 0.12]);
      aimArm(p, 'r', [0.45, 0.86, 0.18], [0.25 + 0.1 * b, 0.95, 0.12]);
      turnHead(p, 0, -0.18);
      break;
    }
    case ACT.CLAP: {
      const c = Math.pow(Math.abs(Math.sin(u * TAU * 5)), 0.6);
      aimArm(p, 'l', [0.28, -0.45, 0.85], [-0.55 + 0.35 * c, 0.42, 0.72]);
      aimArm(p, 'r', [0.28, -0.45, 0.85], [-0.55 + 0.35 * c, 0.42, 0.72]);
      break;
    }
    case ACT.WAVE: {
      const w = beat(4);
      aimArm(p, 'r', [0.62, 0.72, 0.28], [0.1 + 0.45 * w, 0.9, 0.15]);
      aimArm(p, 'l', [0.12, -0.98, 0.1], [0.05, -0.9, 0.35], 0.6);
      turnHead(p, -0.1, -0.1);
      break;
    }
    case ACT.FLAG: {
      const w = beat(1);
      aimArm(p, 'r', [0.3 + 0.3 * w, 0.9, 0.2], [0.1 + 0.35 * w, 0.95, 0.1]);
      aimArm(p, 'l', [0.35, 0.2, 0.9], [0.1, 0.7, 0.7], 0.7);
      break;
    }
    case ACT.PHONE: {
      const s = beat(1) * 0.04;
      aimArm(p, 'r', [0.05, 0.3 + s, 0.95], [-0.1, 0.72, 0.68]);
      aimArm(p, 'l', [0.12, -0.98, 0.1], [0.05, -0.9, 0.35], 0.5);
      turnHead(p, -0.08, 0.08);
      break;
    }
    case ACT.FIST: {
      const f = Math.max(0, beat(3));
      aimArm(p, 'r', [0.35, 0.78 + 0.18 * f, 0.35], [0.1, 0.96, 0.2]);
      aimArm(p, 'l', [0.18, -0.9, 0.35], [0.0, -0.3, 0.95], 0.6);
      turnHead(p, 0, -0.12);
      break;
    }
    case ACT.JUMP: {
      aimArm(p, 'l', [0.5, 0.82, 0.2], [0.3, 0.94, 0.1]);
      aimArm(p, 'r', [0.5, 0.82, 0.2], [0.3, 0.94, 0.1]);
      break;
    }
    case ACT.IDLE: {
      // hands down, relaxed (the idle clip's fists come unclenched a little by pose)
      aimArm(p, 'l', [0.15, -0.98, 0.05], [0.08, -0.95, 0.3], 0.8);
      aimArm(p, 'r', [0.15, -0.98, 0.05], [0.08, -0.95, 0.3], 0.8);
      break;
    }
    default:
      break;
  }
}
