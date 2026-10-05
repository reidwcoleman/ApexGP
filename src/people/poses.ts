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

const ikS = new THREE.Vector3();
const ikE = new THREE.Vector3();
const ikH = new THREE.Vector3();
const ikD = new THREE.Vector3();
const ikP = new THREE.Vector3();
const ikQ = new THREE.Quaternion();

/**
 * Put a hand on a point (world): two-bone IK on the arm, the elbow bending toward `pole` (a world
 * direction: down-and-out for work at a wheel). The arm keeps its own bone lengths — a point out of
 * reach is pointed at with the elbow still a little bent, never stretched — so sleeves stay the size
 * they are. `w` blends from the clip's arm (0) to the reach (1).
 */
export function reachTo(p: Person, side: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3, w = 1) {
  const up = p.bones[`upperarm_${side}`], lo = p.bones[`lowerarm_${side}`], hd = p.bones[`hand_${side}`];
  if (!up || !lo || !hd || w <= 0) return;
  up.updateWorldMatrix(true, true);
  up.getWorldPosition(ikS);
  lo.getWorldPosition(ikE);
  hd.getWorldPosition(ikH);
  const a = ikE.distanceTo(ikS), b = ikH.distanceTo(ikE);
  ikD.copy(target).sub(ikS);
  const dist = ikD.length();
  if (dist < 1e-4) return;
  ikD.divideScalar(dist);
  const L = Math.min(dist, (a + b) * 0.97);
  const cosA = THREE.MathUtils.clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  // the pole's part square to the shoulder→hand line
  ikP.copy(pole).addScaledVector(ikD, -pole.dot(ikD));
  if (ikP.lengthSq() < 1e-6) ikP.set(0, -1, 0).addScaledVector(ikD, ikD.y);
  ikP.normalize();
  const elbow = ikE.copy(ikS).addScaledVector(ikD, a * cosA).addScaledVector(ikP, a * sinA);
  p.aim(`upperarm_${side}`, `lowerarm_${side}`, ikH.copy(elbow).sub(ikS), w);
  // the forearm from where the elbow now is to the target (or as far toward it as it reaches)
  lo.getWorldPosition(ikS);
  p.aim(`lowerarm_${side}`, `hand_${side}`, ikH.copy(target).sub(ikS), w);
}

/** each body's head "forward" in the head bone's own frame (from the bind pose) */
const headFwd = new WeakMap<object, THREE.Vector3>();
const ikM = new THREE.Matrix4();

/**
 * Turn the head toward a point (world) on top of the clip: the head bone is rotated so its forward
 * (the face's direction in the bind pose) swings toward the point, by at most `max` radians, blended
 * by `w`. Works whatever the clip has the head doing (bowed over a wheel, turned to a laptop).
 */
export function lookAt(p: Person, target: THREE.Vector3, w = 1, max = 0.9) {
  const h = p.bones.Head;
  if (!h || w <= 0) return;
  let f = headFwd.get(p.asset);
  if (!f) {
    const i = p.skeleton.bones.indexOf(h);
    if (i < 0) return;
    // bind rotation of the head in the body's frame, whose forward is +z
    ikM.copy(p.skeleton.boneInverses[i]).invert();
    ikQ.setFromRotationMatrix(ikM).invert();
    f = new THREE.Vector3(0, 0, 1).applyQuaternion(ikQ).normalize();
    headFwd.set(p.asset, f);
  }
  h.updateWorldMatrix(true, false);
  h.getWorldPosition(ikS);
  h.getWorldQuaternion(ikQ);
  const cur = ikE.copy(f).applyQuaternion(ikQ).normalize();
  const want = ikD.copy(target).sub(ikS).normalize();
  const ang = Math.acos(THREE.MathUtils.clamp(cur.dot(want), -1, 1));
  if (ang < 1e-3) return;
  const k = Math.min(1, max / ang) * w;
  const delta = new THREE.Quaternion().setFromUnitVectors(cur, want);
  delta.slerp(new THREE.Quaternion(), 1 - k);
  const pq = h.parent!.getWorldQuaternion(new THREE.Quaternion());
  const pInv = pq.clone().invert();
  h.quaternion.premultiply(pInv.multiply(delta).multiply(pq));
  h.updateMatrixWorld(true);
}
