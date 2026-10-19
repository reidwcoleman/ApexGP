import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, Pattern } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import { Parts, band, bolt, boltRing, dome, frameAt, gantry, hub, mat, plank, rotX, rotZ } from './obs-kit.ts';

/**
 * Things that swing from a gantry: the axe (a broad painted blade on a long handle, swinging across
 * the track) and the wrecking ball (swinging along it, at you). A pendulum's angle is a sine of time;
 * its collider follows the bob.
 */

const QS = new THREE.Quaternion();

/**
 * An axe swinging across the track at s: a bevelled crescent blade on a walnut handle, from a pivot
 * on a gantry `len` above the floor. The blade's edge faces the way it swings.
 */
export function axe(b: CourseBuilder, path: Path, s: number, o: { amp?: number; period?: number; phase?: number; len?: number; color?: number; lat?: number } = {}) {
  const f = frameAt(path, s, o.lat ?? 0);
  const L = o.len ?? 6.4;
  const amp = o.amp ?? 0.95, w = (Math.PI * 2) / (o.period ?? 2.8), ph = o.phase ?? 0;
  const pivot = path.at(s, o.lat ?? 0, L + 0.75);
  const BW = 2.0, BH = 1.3, TH = 0.28;
  const off = new THREE.Vector3();
  // the blade: a box in the swing plane; local x across the track (its edges), y up the handle, z along
  const kin = new Kin({ type: 'box', hx: BW / 2, hy: BH / 2, hz: TH / 2 }, Mat.Paint, (t, pos, quat) => {
    const th = amp * Math.sin(w * t + ph);
    QS.setFromAxisAngle(f.T, th);
    quat.copy(QS).multiply(f.q);
    off.set(0, -L, 0).applyQuaternion(quat);
    pos.copy(pivot).add(off);
  });
  const p = new Parts();
  // a double-bitted blade: two crescents back to back, bevelled
  const sh = new THREE.Shape();
  const hw = BW / 2, hh = BH / 2;
  sh.moveTo(-0.25, -hh * 0.45);
  sh.quadraticCurveTo(-hw * 0.55, -hh * 0.5, -hw, -hh);
  sh.quadraticCurveTo(-hw * 1.12, 0, -hw, hh);
  sh.quadraticCurveTo(-hw * 0.55, hh * 0.5, -0.25, hh * 0.45);
  sh.lineTo(0.25, hh * 0.45);
  sh.quadraticCurveTo(hw * 0.55, hh * 0.5, hw, hh);
  sh.quadraticCurveTo(hw * 1.12, 0, hw, -hh);
  sh.quadraticCurveTo(hw * 0.55, -hh * 0.5, 0.25, -hh * 0.45);
  sh.lineTo(-0.25, -hh * 0.45);
  const g = new THREE.ExtrudeGeometry(sh, { depth: TH - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -(TH - 0.1) / 2);
  const col = o.color ?? PAINT.red;
  p.add(b.paint({ a: col, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6, wear: 0.06 }), woodUV(g));
  // the steel edges
  for (const e of [-1, 1]) p.add(b.steel, plank(0.12, BH * 1.02, TH + 0.04, 0.04, 'y'), mat(e * (hw + 0.02), 0, 0));
  // the eye where the handle goes through, and its bolts
  p.add(b.paint({ a: PAINT.black, b: PAINT.black, pattern: Pattern.Solid }), plank(0.62, BH * 0.95, TH + 0.12, 0.06, 'y'), mat(0, 0, 0));
  for (const dy of [-0.32, 0.32]) for (const e of [-1, 1]) bolt(p, b, mat(0, dy, e * (TH / 2 + 0.06), rotX((e * Math.PI) / 2)), 0.06);
  // the handle up to the pivot
  const hl = L;
  p.add(b.railWood, plank(0.22, hl, 0.22, 0.05, 'y', s), mat(0, hl / 2, 0));
  for (const dy of [hl * 0.35, hl * 0.7]) p.add(b.steel, band(0.15, 0.04, 12), mat(0, dy, 0));
  b.obstacle(kin, p.group());
  // the pivot boss on its gantry
  gantry(b, path, s, L + 1.05, {});
  const pb = new Parts();
  hub(pb, b, mat(0, 0, 0, rotX(Math.PI / 2)), 0.32, 0.9, b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }));
  pb.add(b.darkWood, plank(0.5, 0.5, 0.5, 0.06, 'y'), mat(0, 0.45, 0));
  pb.toBatch(b, new THREE.Matrix4().compose(pivot, f.q, new THREE.Vector3(1, 1, 1)));
  return kin;
}

/**
 * A wrecking ball swinging along the track at s (it comes at you, then goes away), `lat` m off
 * the centre. The collider is an upright drum round the bob (its faces push sideways, never down).
 */
export function wreckingBall(b: CourseBuilder, path: Path, s: number, o: { lat?: number; amp?: number; period?: number; phase?: number; len?: number; r?: number; color?: number } = {}) {
  const lat = o.lat ?? 0;
  const f = frameAt(path, s, lat);
  const L = o.len ?? 6.5;
  const R = o.r ?? 1.15;
  const amp = o.amp ?? 0.75, w = (Math.PI * 2) / (o.period ?? 3.4), ph = o.phase ?? 0;
  const pivot = path.at(s, lat, L + R + 0.15);
  const axis = f.R.clone();
  const off = new THREE.Vector3();
  const bob = (t: number, out: THREE.Vector3) => {
    QS.setFromAxisAngle(axis, amp * Math.sin(w * t + ph));
    off.copy(f.U).multiplyScalar(-L).applyQuaternion(QS);
    return out.copy(pivot).add(off);
  };
  const kin = new Kin({ type: 'cyl', r: R * 0.92, hh: R * 0.9 }, Mat.Paint, (t, pos, quat) => {
    bob(t, pos);
    quat.copy(f.q);
  });
  b.world.addKin(kin);
  b.hazards.push(kin);
  // the visual: ball + chain, hung from the pivot (so it can swing as one piece)
  const p = new Parts();
  const col = o.color ?? PAINT.purple;
  p.add(b.paint({ a: col, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.2, wear: 0.05 }), dome(R, 1, 36), mat(0, -L, 0));
  p.add(b.paint({ a: col, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.2, wear: 0.05 }), dome(R, 1, 36), mat(0, -L, 0, rotX(Math.PI)));
  p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), band(R * 1.0, 0.08, 40), mat(0, -L, 0));
  p.add(b.brass, dome(0.36, 0.8, 16), mat(0, -L + R - 0.05, 0));
  boltRing(p, b, mat(0, -L + R * 0.86, 0), 0.5, 6, 0.05);
  // the chain: links alternately turned
  const top = R + 0.1;
  const links = Math.floor((L - top) / 0.34);
  for (let k = 0; k < links; k++) {
    const y = -L + top + k * 0.34 + 0.17;
    const link = new THREE.TorusGeometry(0.14, 0.04, 6, 12).scale(1, 1.5, 1);
    p.add(b.steel, link, mat(0, y, 0, k % 2 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) : undefined));
  }
  const vis = p.group();
  vis.position.copy(pivot);
  b.group.add(vis);
  vis.traverse((m) => ((m as THREE.Mesh).castShadow = true));
  b.animators.push((t) => {
    QS.setFromAxisAngle(axis, amp * Math.sin(w * t + ph));
    vis.quaternion.copy(QS).multiply(f.q);
  });
  // a gantry over the whole track
  gantry(b, path, s, L + R + 0.45, {});
  const pb = new Parts();
  hub(pb, b, mat(0, 0, 0, rotZ(Math.PI / 2)), 0.3, 0.8, b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }));
  pb.toBatch(b, new THREE.Matrix4().compose(pivot, f.q, new THREE.Vector3(1, 1, 1)));
  return kin;
}

/** extrusions come with uvs: use them for the paint (x across, y up) */
function woodUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    a[i * 3] = p.getX(i);
    a[i * 3 + 1] = p.getY(i);
    a[i * 3 + 2] = p.getZ(i);
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  return g;
}
