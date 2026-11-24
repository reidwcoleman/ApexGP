import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Person } from '../people/Humans.ts';
import type { Env } from './env.ts';

/**
 * Guns: Last Frame's models (a service pistol, a pump gun, a carbine), held by anyone in the game.
 * The arms are posed on top of whatever the legs are doing (walk, run, stand): the right hand is
 * reached to the grip and the left to the fore-end (two-bone IK), the fingers closed round them, the
 * gun pointed where its holder is looking, or carried low.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'lastframe/';

export type GunId = 'pistol' | 'shotgun' | 'rifle';
export type WeaponId = 'fists' | GunId;

export interface GunSpec {
  name: string;
  model: string;
  parts: string[];
  dmg: number;
  pellets: number;
  /** radians of spread (hip; aimed it's a third) */
  spread: number;
  rate: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reload: number;
  range: number;
  kick: number;
  muzzle: [number, number, number];
  support: [number, number, number];
  long: boolean;
}

export const GUNS: Record<GunId, GunSpec> = {
  pistol: {
    name: 'Pistol', model: 'pistol', parts: ['pistol', 'pistol_slide', 'pistol_mag', 'pistol_hammer', 'pistol_trigger'],
    dmg: 34, pellets: 1, spread: 0.03, rate: 0.17, auto: false, mag: 15, reserve: 105, reload: 1.5, range: 80, kick: 0.5,
    muzzle: [0, 0.058, 0.19], support: [0, -0.02, 0.0], long: false,
  },
  shotgun: {
    name: 'Pump shotgun', model: 'shotgun', parts: ['shotgun', 'shotgun_pump'],
    dmg: 17, pellets: 8, spread: 0.075, rate: 0.85, auto: false, mag: 8, reserve: 48, reload: 2.6, range: 35, kick: 1.6,
    muzzle: [0, 0.036, 0.68], support: [0, 0.012, 0.34], long: true,
  },
  rifle: {
    name: 'Carbine', model: 'carbine', parts: ['carbine_lo', 'carbine_mag', 'carbine_bolt'],
    dmg: 29, pellets: 1, spread: 0.035, rate: 0.095, auto: true, mag: 30, reserve: 240, reload: 2.2, range: 140, kick: 0.45,
    muzzle: [0, 0.043, 0.695], support: [0, 0.012, 0.29], long: true,
  },
};

let template: Map<string, THREE.Object3D> | null = null;

export async function loadGuns(env: Env) {
  const g = await new GLTFLoader().loadAsync(BASE + 'guns.glb');
  template = new Map();
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.castShadow = true;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      // dull: parkerised steel and polymer
      mat.roughness = Math.max(0.45, mat.roughness);
      mat.envMapIntensity = 0.8;
      if (/lens/.test(o.name)) {
        mat.transparent = true;
        mat.opacity = 0.15;
      }
    }
  });
  env.prepObject(g.scene, true, true);
  for (const c of g.scene.children) template.set(c.name, c);
}

/** a fresh copy of a gun (gun forward is +z, up +y) */
export function makeGun(id: GunId): THREE.Group {
  const group = new THREE.Group();
  for (const n of GUNS[id].parts) {
    const t = template?.get(n);
    if (t) group.add(t.clone());
  }
  return group;
}

const UP = new THREE.Vector3(0, 1, 0);
const TH_R = [0.8, 0, 0.4], TH_L = [0.3, -0.7, 0.4];
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

/** aim a hand along f, turned so index-to-little runs along side, the fingers closed by curl */
function hold(P: Person, s: 'L' | 'R', f: THREE.Vector3, side: THREE.Vector3, curl: number) {
  const H = `Bip01_${s}_Hand`;
  if (!P.bones[`Bip01_${s}_Finger2`]) return;
  P.aim(H, `Bip01_${s}_Finger2`, f);
  const a = P.worldOf(`Bip01_${s}_Finger1`, new THREE.Vector3()), b = P.worldOf(`Bip01_${s}_Finger4`, new THREE.Vector3());
  const cur = b.sub(a);
  cur.addScaledVector(f, -cur.dot(f)).normalize();
  const want = side.clone().addScaledVector(f, -side.dot(f)).normalize();
  const ang = Math.atan2(new THREE.Vector3().crossVectors(cur, want).dot(f), cur.dot(want));
  P.rotateWorld(H, f, ang);
  const axis = want.clone().multiplyScalar(s === 'R' ? -1 : 1);
  const td = s === 'R' ? TH_R : TH_L;
  const sg = s === 'R' ? -1 : 1;
  P.rotateWorld(`Bip01_${s}_Finger0`, f, sg * td[0] * curl);
  P.rotateWorld(`Bip01_${s}_Finger0`, axis, td[1] * curl);
  P.rotateWorld(`Bip01_${s}_Finger01`, axis, td[2] * curl);
  P.rotateWorld(`Bip01_${s}_Finger02`, axis, td[2] * curl);
  for (let k = 1; k < 5; k++) {
    P.rotateWorld(`Bip01_${s}_Finger${k}`, axis, 0.95 * curl);
    P.rotateWorld(`Bip01_${s}_Finger${k}1`, axis, 0.95 * curl);
    P.rotateWorld(`Bip01_${s}_Finger${k}2`, axis, 0.6 * curl);
  }
}

/** two-bone IK: the hand to target, the elbow out along `out` and down */
export function reach(P: Person, s: 'L' | 'R', target: THREE.Vector3, out: THREE.Vector3, w = 1) {
  const ua = `Bip01_${s}_UpperArm`, fa = `Bip01_${s}_Forearm`, ha = `Bip01_${s}_Hand`;
  if (!P.bones[ua] || !P.bones[fa] || !P.bones[ha]) return;
  const S = P.worldOf(ua, new THREE.Vector3());
  const E0 = P.worldOf(fa, new THREE.Vector3());
  const H0 = P.worldOf(ha, new THREE.Vector3());
  const a = S.distanceTo(E0), b = E0.distanceTo(H0);
  const T = target.clone();
  if (w < 1) T.lerp(H0, 1 - w);
  const toT = T.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dn = toT.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pole = out.clone().multiplyScalar(0.7).addScaledVector(UP, -1);
  pole.addScaledVector(dn, -pole.dot(dn)).normalize();
  const E = S.clone().addScaledVector(dn, a * cosA).addScaledVector(pole, a * sinA);
  P.aim(ua, fa, E.clone().sub(S));
  const E1 = P.worldOf(fa, new THREE.Vector3());
  P.aim(fa, ha, T.clone().sub(E1));
}

/**
 * Hold a gun: point it along `dir` (aim 1) or carry it low (aim 0), the kick (0..1) throwing the
 * muzzle up. Call after the person's own update (the clip) each frame.
 */
export function poseGun(P: Person, gun: THREE.Object3D, id: GunId, dir: THREE.Vector3, aim: number, kick: number) {
  const spec = GUNS[id];
  P.root.updateMatrixWorld(true);
  const fwd = P.dir(0, 0, 1, v1).setY(0).normalize();
  // bend the chest toward where the gun points (up or down)
  const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.9, 0.9));
  const right0 = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  if (aim > 0.05) {
    P.rotateWorld('Bip01_Spine1', right0, -pitch * 0.28 * aim);
    P.rotateWorld('Bip01_Spine2', right0, -pitch * 0.28 * aim);
  }
  const d = v2.copy(dir).normalize();
  // carried low: muzzle down and across the body
  const low = new THREE.Vector3().copy(fwd).multiplyScalar(0.55).addScaledVector(UP, -0.8).addScaledVector(right0, spec.long ? -0.35 : 0).normalize();
  d.lerp(low, 1 - aim).normalize();
  const right = new THREE.Vector3().crossVectors(d, UP).normalize();
  const sR = P.worldOf('Bip01_R_UpperArm', new THREE.Vector3());
  const sL = P.worldOf('Bip01_L_UpperArm', new THREE.Vector3());
  const grip = new THREE.Vector3();
  if (spec.long) grip.copy(sR).addScaledVector(d, (id === 'shotgun' ? 0.44 : 0.36) - kick * 0.05).addScaledVector(UP, -0.1).addScaledVector(right, -0.08);
  // (a pistol out in front of the right shoulder, where the camera over it can see it)
  else grip.copy(sR).lerp(sL, 0.3).addScaledVector(d, 0.5 * aim + 0.25 * (1 - aim) - kick * 0.04).addScaledVector(UP, -0.05 - 0.12 * (1 - aim));
  const gdir = new THREE.Vector3().copy(d).addScaledVector(UP, kick * 0.25).normalize();
  const side = new THREE.Vector3().crossVectors(UP, gdir).normalize();
  const gup = new THREE.Vector3().crossVectors(gdir, side).normalize();
  gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, gup, gdir));
  gun.position.copy(grip);
  gun.updateMatrixWorld(true);
  const gq = gun.getWorldQuaternion(new THREE.Quaternion());
  const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(gq);
  const palm = new THREE.Vector3(-0.038, -0.03, -0.05).applyMatrix4(gun.matrixWorld);
  reach(P, 'R', palm, right, 1);
  hold(P, 'R', L(0.8, 0, 0.6).normalize(), L(0, -1, 0), 1);
  const su = spec.support;
  const pistol = id === 'pistol';
  const sup = new THREE.Vector3(su[0] + (pistol ? 0.05 : 0.04), su[1] - (pistol ? 0.03 : 0.052), su[2] - 0.06).applyMatrix4(gun.matrixWorld);
  // a pistol carried low is in one hand
  reach(P, 'L', sup, right.clone().negate(), pistol ? aim : 1);
  if (!pistol || aim > 0.5) hold(P, 'L', L(-0.62, -0.08, 0.78).normalize(), L(0, pistol ? -0.5 : 0, -1).normalize(), pistol ? 0.9 : 0.72);
}

/** where the gun's muzzle is (world) */
export function muzzleOf(gun: THREE.Object3D, id: GunId, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(...GUNS[id].muzzle).applyMatrix4(gun.matrixWorld);
}

/** a punch: the right fist out to `target` and back over `t` (0..1) */
export function posePunch(P: Person, target: THREE.Vector3, t: number) {
  const k = t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.65);
  if (k <= 0) return;
  P.root.updateMatrixWorld(true);
  const right = P.dir(-1, 0, 0, v3);
  const fwd = P.dir(0, 0, 1, new THREE.Vector3());
  P.rotateWorld('Bip01_Spine1', UP, -0.35 * k);
  const H0 = P.worldOf('Bip01_R_Hand', new THREE.Vector3());
  reach(P, 'R', H0.lerp(target, k), right, 1);
  hold(P, 'R', fwd, right.clone().negate(), 1);
  // the other fist up by the chin
  const chin = P.worldOf('Bip01_Head', new THREE.Vector3()).addScaledVector(fwd, 0.25).addScaledVector(UP, -0.2).addScaledVector(right, -0.12);
  reach(P, 'L', chin, right.clone().negate(), 0.8);
}

/** both hands up (surrender), by w */
export function poseHandsUp(P: Person, w: number) {
  if (w <= 0) return;
  P.root.updateMatrixWorld(true);
  const head = P.worldOf('Bip01_Head', new THREE.Vector3());
  const left = P.dir(1, 0, 0, new THREE.Vector3());
  const fwd = P.dir(0, 0, 1, new THREE.Vector3());
  for (const s of ['L', 'R'] as const) {
    const sg = s === 'L' ? 1 : -1;
    const t = head.clone().addScaledVector(left, 0.3 * sg).addScaledVector(UP, 0.35).addScaledVector(fwd, 0.08);
    reach(P, s, t, left.clone().multiplyScalar(sg), w);
  }
}
