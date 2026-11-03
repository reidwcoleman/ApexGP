import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, cylAttr, roundBox } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import { Pattern, woodAttr } from './shaders.ts';
import { Parts, band, bolt, dome, frameAt, gantry, mat, plank, rod, rotX, rotZ } from './obs-kit.ts';

/**
 * Three more machines for the platform courses: padded fists that punch out across an open deck
 * from boxes beside it (time the gap or go for a swim), balls dropped from hoppers at the top of a
 * slope that roll down at you and off the side at the bottom, and padded gates hinged on the
 * walls that swing shut across the way and open again. Each pose is a function of time, like the
 * rest, so every browser sees the same thing and the bots can look ahead.
 */

const UPV = new THREE.Vector3(0, 1, 0);

/**
 * A puncher at s on one side (+1 right, -1 left): a padded fist in a box just off the open edge,
 * out across the deck in a blink every `period` s, a moment there, then back in slowly.
 */
export function puncher(b: CourseBuilder, path: Path, s: number, side: number, o: { period?: number; phase?: number; reach?: number; color?: number } = {}) {
  const f = frameAt(path, s);
  const hw = f.sec.w / 2;
  const P = o.period ?? 2.8, ph = o.phase ?? 0;
  // the fist's centre, across: home in its box, out to `reach` past the centre line
  const home = side * (hw + 1.55);
  const out = side * (hw - Math.min(hw + 0.8, o.reach ?? hw)) + side * 0.75;
  const OUT = 0.5, HOLD = 0.35, BACK = 0.85;
  const ext = (t: number) => {
    const u = ((((t + ph) % P) + P) % P);
    if (u < OUT) return u / OUT;
    if (u < OUT + HOLD) return 1;
    if (u < OUT + HOLD + BACK) {
      const k = (u - OUT - HOLD) / BACK;
      return 1 - k * k * (3 - 2 * k);
    }
    return 0;
  };
  const kin = new Kin({ type: 'box', hx: 0.75, hy: 0.62, hz: 0.72 }, Mat.Paint, (t, pos, quat) => {
    pos.copy(path.at(s, home + (out - home) * ext(t), 0.78));
    quat.copy(f.q);
  });
  kin.set(0);
  // the fist: a fat padded block with a domed knuckle face, a cuff, and the ram behind it
  // (local x = the track's left: the face points at -side across, i.e. local +side)
  const col = o.color ?? PAINT.red;
  const p = new Parts();
  const glove = b.paint({ a: col, b: PAINT.white, pattern: Pattern.Dots, scale: 2.2 });
  const white = b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid });
  p.add(glove, woodAttr(roundBox(1.3, 1.24, 1.44, 0.4), 'x', s));
  p.add(glove, dome(0.62, 0.45, 28), mat(side * 0.62, 0, 0, rotZ((-side * Math.PI) / 2)));
  p.add(white, band(0.6, 0.12, 32), mat(-side * 0.62, 0, 0, rotZ(Math.PI / 2)));
  p.add(b.steel, rod(0.2, 3.2, 18), mat(-side * 2.2, 0, 0, rotZ(Math.PI / 2)));
  b.obstacle(kin, p.group());
  // its box beside the deck, on a bracket under the lip; striped mouth facing in
  const bx = new Parts();
  const boxM = b.paint({ a: PAINT.white, b: col, pattern: Pattern.Stripes, scale: 1.4 });
  const cx = -side * (hw + 2.2);
  bx.add(boxM, woodAttr(roundBox(3.0, 2.1, 2.2, 0.3), 'z', s), mat(cx, 0.8, 0));
  // (a yellow-and-black lip round its mouth)
  for (const dy of [-0.95, 0.95]) bx.add(b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 2 }), plank(0.2, 0.24, 2.3, 0.06, 'z'), mat(cx + side * 1.45, 0.8 + dy, 0));
  bx.add(b.darkWood, plank(3.2, 0.4, 1.2, 0.08, 'x'), mat(-side * (hw + 0.6), -0.9, 0));
  for (const dz of [-0.75, 0.75]) bolt(bx, b, mat(cx, 1.86, dz), 0.08);
  bx.toBatch(b, f.m);
  // (a solid box: nobody stands in thin air beside it; not a hazard the bots need to steer round)
  const solid = new Kin({ type: 'box', hx: 1.2, hy: 1.05, hz: 1.1 }, Mat.Paint);
  solid.pos.copy(path.at(s, side * (hw + 2.6), 0.8));
  solid.quat.copy(f.q);
  solid.set(0);
  b.world.addKin(solid);
  return kin;
}

/**
 * Balls rolling down a slope at you, s0 (the bottom) .. s1 (the top): each drops out of a hopper
 * over its lane at the top, rolls all the way down, and at the bottom swings out and off the side.
 */
export function rollDown(b: CourseBuilder, path: Path, s0: number, s1: number, o: { lanes?: number[]; speed?: number; r?: number; period?: number; phase?: number; colors?: number[]; ball?: (R: number, k: number) => Parts } = {}) {
  const R0 = o.r ?? 1.15;
  const v = o.speed ?? 7.5;
  const lanes = o.lanes ?? [-4, 0, 4];
  const C = o.period ?? 4.2;
  const ph = o.phase ?? 0;
  const top = s1 - 1.5, end = s0 + 5;
  const L = top - end;
  const DROP = 0.55, H = 6.4, OFF = 2.2;
  const where = (tau: number, lane: number, side: number, out: THREE.Vector3, dir: THREE.Vector3) => {
    const it = path.index(top);
    if (tau < DROP) {
      const k = tau / DROP;
      path.at(top, lane, R0 + H * (1 - k * k), out);
      dir.copy(path.T[it]).negate();
      return true;
    }
    const d = (tau - DROP) * v;
    if (d < L) {
      const s = top - d;
      path.at(s, lane + Math.sin(d * 0.35 + lane) * 0.6, R0, out);
      dir.copy(path.T[path.index(s)]).negate();
      return true;
    }
    // at the bottom: out sideways and over the edge
    const e = d - L;
    const ie = path.index(end);
    const hw = path.sec[ie].w / 2;
    const lat = lane + Math.sin(L * 0.35 + lane) * 0.6 + side * e * 1.1;
    path.at(Math.max(s0, end - e * 0.4), lat, R0, out);
    const over = Math.abs(lat) - hw;
    if (over > 0) {
      const tf = over / (v * 1.1);
      out.y -= 14 * tf * tf;
      if (tf > OFF) return false;
    }
    dir.copy(path.Rt[ie]).multiplyScalar(side);
    return true;
  };
  const cols = o.colors ?? [PAINT.pink, PAINT.teal, PAINT.yellow, PAINT.purple];
  const DIR = new THREE.Vector3(), AX = new THREE.Vector3();
  const f1 = frameAt(path, top);
  const hide = (pos: THREE.Vector3) => pos.set(f1.pos.x, f1.pos.y - 80, f1.pos.z);
  lanes.forEach((lane, k) => {
    const side = lane === 0 ? (k % 2 ? 1 : -1) : Math.sign(lane);
    const tau = (t: number) => ((((t + ph + (k * C) / lanes.length) % C) + C) % C);
    const kin = new Kin({ type: 'sph', r: R0 }, Mat.Paint, (t, pos, quat) => {
      if (!where(tau(t), lane, side, pos, DIR)) hide(pos);
      quat.copy(f1.q);
    });
    b.world.addKin(kin);
    b.hazards.push(kin);
    // the visual: turned as it rolls (no collider of its own)
    const vk = new Kin({ type: 'sph', r: 0.1 }, Mat.Paint, (t, pos, quat) => {
      const tt = tau(t);
      if (!where(tt, lane, side, pos, DIR)) hide(pos);
      AX.crossVectors(DIR, UPV).normalize();
      quat.setFromAxisAngle(AX, (-Math.max(0, tt - DROP) * v) / R0);
    });
    vk.enabled = false;
    let p = new Parts();
    if (o.ball) p = o.ball(R0, k);
    else {
      const c = cols[k % cols.length];
      const pm = b.paint({ a: c, b: PAINT.white, pattern: Pattern.Stripes, scale: 0.9 });
      p.add(pm, dome(R0, 1, 40));
      p.add(pm, dome(R0, 1, 40), mat(0, 0, 0, rotX(Math.PI)));
      for (const e of [-1, 1]) p.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), dome(0.3, 0.5, 16), mat(0, e * R0 * 0.985, 0, e < 0 ? rotX(Math.PI) : undefined));
    }
    b.obstacle(vk, p.group(), false);
  });
  // the hoppers: a gantry over the top with a funnel over each lane
  const gy = gantry(b, path, top, H + R0 + 1.4, { span: f1.sec.w, paint: b.paint({ a: PAINT.blue, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.2 }) });
  void gy;
  const hp = new Parts();
  const fm = b.paint({ a: PAINT.orange, b: PAINT.white, pattern: Pattern.Rings, scale: 2 });
  for (const lane of lanes) {
    const fun = cylAttr(new THREE.CylinderGeometry(R0 + 0.5, R0 + 0.25, 1.8, 28, 2, true));
    hp.add(fm, fun, mat(-lane, H + R0 + 0.4, 0));
    hp.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), band(R0 + 0.5, 0.12, 32), mat(-lane, H + R0 + 1.3, 0));
  }
  hp.toBatch(b, f1.m);
}

/**
 * A pair of padded gates at s, hinged on the walls, swinging shut across the way and open again
 * (the two out of step, so one side is always opening).
 */
export function gates(b: CourseBuilder, path: Path, s: number, o: { period?: number; phase?: number; color?: number } = {}) {
  const f = frameAt(path, s);
  const hw = f.sec.w / 2;
  const L = hw - 1.1;
  const w = (Math.PI * 2) / (o.period ?? 3.4), ph = o.phase ?? 0;
  const col = o.color ?? PAINT.purple;
  const q = new THREE.Quaternion();
  for (const side of [-1, 1]) {
    const hinge = path.at(s, side * (hw - 0.25), 0.95);
    const off = side < 0 ? Math.PI : 0;
    const ang = (t: number) => (Math.PI / 4) * (1 + Math.sin(w * t + ph + off));
    const d = new THREE.Vector3();
    const kin = new Kin({ type: 'box', hx: 0.22, hy: 0.85, hz: L / 2 }, Mat.Paint, (t, pos, quat) => {
      const a = ang(t) * side;
      q.setFromAxisAngle(f.U, a);
      quat.copy(q).multiply(f.q);
      d.copy(f.T).applyQuaternion(q);
      pos.copy(hinge).addScaledVector(d, L / 2);
    });
    const p = new Parts();
    p.add(b.paint({ a: col, b: PAINT.white, pattern: Pattern.Chevron, scale: 1.1 }), woodAttr(roundBox(0.44, 1.7, L, 0.2), 'z', s + side));
    p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), rod(0.26, 1.9, 18), mat(0, 0.05, -L / 2));
    p.add(b.brass, dome(0.3, 0.7, 16), mat(0, 1.0, -L / 2));
    b.obstacle(kin, p.group());
    // the hinge post on the wall, from under the deck
    const hp = new Parts();
    hp.add(b.paint({ a: PAINT.white, b: col, pattern: Pattern.Stripes, scale: 2.4 }), rod(0.32, 2.6, 18), mat(-side * (hw - 0.25), 0.9, 0));
    hp.add(b.brass, dome(0.36, 0.7, 16), mat(-side * (hw - 0.25), 2.2, 0));
    hp.toBatch(b, f.m);
  }
}
