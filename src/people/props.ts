import * as THREE from 'three';
import type { Person } from './Humans.ts';

/**
 * Hand props for the garage people: a driver's helmet carried by the chin bar, a mechanic's
 * wrench. Built in the body's bind space around the hand, then skinned rigidly to the hand bone,
 * so they follow the clip and the procedural arm poses.
 */

/** the hand's frame in bind space: palm centre, along-the-fingers, the fist's grip axis, palm down */
function handFrame(p: Person, side: 'l' | 'r') {
  const lm = p.asset.lm;
  const H = lm.pos[`hand_${side}`].clone();
  const E = lm.pos[`lowerarm_${side}`];
  const a = H.clone().sub(E).normalize();
  const down = new THREE.Vector3(0, -1, 0);
  const g = new THREE.Vector3().crossVectors(a, down).normalize();
  if (g.z < 0) g.negate();
  const palm = H.clone().addScaledVector(a, 0.075).addScaledVector(down, 0.02);
  return { palm, a, g, down };
}

const place = (geo: THREE.BufferGeometry, m: THREE.Matrix4) => geo.applyMatrix4(m);

/**
 * A full-face helmet in the driver's two colours, carried by the chin bar. A plain object (not
 * skinned to the hand): `update` hangs it under the hand every frame, crown up, the visor turned
 * out the way the driver faces — so it reads as a helmet whatever the hand bone's roll.
 */
export function makeHelmet(colours: [string, string]) {
  const group = new THREE.Group();
  group.name = 'carried-helmet';
  const S = new THREE.Matrix4().makeScale(0.125, 0.135, 0.148);
  const mats: THREE.Material[] = [];
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, mat: THREE.Material) => {
    place(geo, m);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    group.add(mesh);
    if (!mats.includes(mat)) mats.push(mat);
  };
  const shell = new THREE.MeshPhysicalMaterial({ color: colours[0], roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const stripe = new THREE.MeshPhysicalMaterial({ color: colours[1], roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x0d1016, metalness: 0.85, roughness: 0.06, iridescence: 0.6, iridescenceIOR: 1.6 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.6 });
  // the shell: an egg a touch longer front-to-back, open underneath
  add(new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.8), S.clone(), shell);
  // a band of the second colour round the crown
  add(new THREE.SphereGeometry(1.012, 28, 4, 0, Math.PI * 2, Math.PI * 0.2, Math.PI * 0.12), S.clone(), stripe);
  // the visor: a wide window across the front (+z)
  add(new THREE.SphereGeometry(1.02, 20, 6, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.4, Math.PI * 0.2), S.clone(), visor);
  // the neck roll round the opening
  add(new THREE.TorusGeometry(0.62, 0.1, 8, 28), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.8, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), trim);
  // the roof spoiler
  add(new THREE.BoxGeometry(1.1, 0.12, 0.5), S.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.72, -0.55)).multiply(new THREE.Matrix4().makeRotationX(-0.5)), stripe);
  const hand = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  return {
    group,
    /** hang it under `handBone` (the driver faces `yaw` in the group's parent frame; `out` turns the visor that far to the side) */
    update(handBone: THREE.Object3D, yaw: number, out: number, t: number) {
      handBone.getWorldPosition(hand);
      const parent = group.parent;
      if (parent) parent.worldToLocal(hand);
      group.position.set(hand.x, hand.y - 0.155, hand.z);
      // (a slow sway from the walk-less hand, the chin bar gripped at the front)
      e.set(0.25 + Math.sin(t * 0.9) * 0.03, yaw + out, Math.sin(t * 0.7) * 0.04);
      group.quaternion.copy(q.setFromEuler(e));
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      for (const m of mats) m.dispose();
    },
  };
}

/** a chrome combination wrench in the fist, sticking out past the thumb */
export function attachWrench(p: Person, side: 'l' | 'r', mat: THREE.Material, len = 0.24): { dispose(): void } {
  const { palm, g, down } = handFrame(p, side);
  const geos: THREE.BufferGeometry[] = [];
  const bar = (from: THREE.Vector3, to: THREE.Vector3, w: number, t: number) => {
    const d = to.clone().sub(from);
    const geo = new THREE.BoxGeometry(w, t, d.length());
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
    geo.applyMatrix4(new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    geos.push(geo);
    p.attachProp(geo, `hand_${side}`, mat);
  };
  const base = palm.clone().addScaledVector(down, 0.01);
  const a0 = base.clone().addScaledVector(g, -0.05);
  const a1 = base.clone().addScaledVector(g, len - 0.05);
  bar(a0, a1, 0.016, 0.007);
  // the open-ended head
  const head = new THREE.TorusGeometry(0.02, 0.007, 6, 12, Math.PI * 1.4);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), down.clone().negate());
  head.applyMatrix4(new THREE.Matrix4().compose(a1.clone().addScaledVector(g, 0.016), q, new THREE.Vector3(1, 1, 1)));
  geos.push(head);
  p.attachProp(head, `hand_${side}`, mat);
  return {
    dispose() {
      for (const gg of geos) gg.dispose();
    },
  };
}
