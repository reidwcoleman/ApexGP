import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, Pattern } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import { Parts, band, bolt, boltRing, dome, frameAt, mat, plank, post, ringDisk, rod, rotX, rotZ } from './obs-kit.ts';

/**
 * Things that travel: logs rolling across an open stretch of track off a feeder ramp, boulders
 * bowling down a straight, seesaws that tip on their own beat, a wobbling plank and a bridge that
 * slides from side to side over a gap. Colliders that sweep at marble height are boxes or upright
 * drums (their faces push sideways, never down onto a marble on the floor).
 */

const QA = new THREE.Quaternion();
const V = new THREE.Vector3();

/**
 * Logs rolling across the track at s, from a feeder ramp on `side` (+1 right) to the far edge and
 * off into the paint. The track should be wall-less there. `logs` evenly spaced, `speed` m/s.
 */
export function logRoll(b: CourseBuilder, path: Path, s: number, o: { side?: number; logs?: number; speed?: number; r?: number; len?: number; phase?: number; color?: number } = {}) {
  const f = frameAt(path, s);
  const side = o.side ?? 1;
  const hw = f.sec.w / 2;
  const r = o.r ?? 0.55, len = o.len ?? 4.2;
  const v = o.speed ?? 3.4;
  const FL = 9, SLOPE = 0.2;
  // the route: the shed (u = 0), down the feeder, across, off the edge and down
  const across = 2 * hw;
  const fallT = 1.8;
  const C = FL + across + v * fallT + 2;
  const n = o.logs ?? 3;
  // lateral (+: the feed side) and height above the floor for a distance u along the route
  const route = (u: number, out: { x: number; y: number; hidden: boolean }) => {
    out.hidden = false;
    if (u < FL) {
      out.x = side * (hw + FL - u);
      out.y = r + (FL - u) * SLOPE;
    } else if (u < FL + across) {
      out.x = side * (hw - (u - FL));
      out.y = r;
    } else {
      const tau = (u - FL - across) / v;
      out.x = side * (hw - (u - FL));
      out.y = r - 12 * tau * tau;
      if (tau > fallT) out.hidden = true;
    }
    return out;
  };
  const R = { x: 0, y: 0, hidden: false };
  const ph = o.phase ?? 0;
  const at = (k: number, t: number) => ((((t + ph) * v + (k * C) / n) % C) + C) % C;
  const col = o.color ?? PAINT.red;
  for (let k = 0; k < n; k++) {
    // the collider: a box that slides (it doesn't need to turn)
    const kin = new Kin({ type: 'box', hx: r * 0.86, hy: r, hz: len / 2 }, Mat.Wood, (t, pos, quat) => {
      route(at(k, t), R);
      pos.copy(f.pos).addScaledVector(f.R, R.x).addScaledVector(f.U, R.hidden ? -40 : R.y);
      quat.copy(f.q);
    });
    b.world.addKin(kin);
    b.hazards.push(kin);
    // the visual: a log turning as it rolls
    const vk = new Kin({ type: 'sph', r: 0.1 }, Mat.Wood, (t, pos, quat) => {
      const u = at(k, t);
      route(u, R);
      pos.copy(f.pos).addScaledVector(f.R, R.x).addScaledVector(f.U, R.hidden ? -40 : R.y);
      QA.setFromAxisAngle(V.set(0, 0, 1), (-side * u) / r);
      quat.copy(f.q).multiply(QA);
    });
    vk.enabled = false;
    const p = new Parts();
    p.add(b.darkWood, rod(r, len - 0.1, 18).rotateX(Math.PI / 2));
    // painted bands, and the cut ends with their rings
    for (const z of [-len * 0.3, len * 0.3]) p.add(b.paint({ a: col, b: PAINT.white, pattern: Pattern.Stripes, scale: 3 }), rod(r + 0.025, 0.4, 18, false).rotateX(Math.PI / 2), mat(0, 0, z));
    for (const e of [-1, 1]) p.add(b.paint({ a: 0xe8c48a, b: 0xb47a44, pattern: Pattern.Rings, scale: 9, wear: 0 }), ringDisk(r - 0.02, 20).rotateX((e * Math.PI) / 2).translate(0, 0, (e * (len - 0.1)) / 2));
    b.obstacle(vk, p.group(), false);
  }
  // the feeder ramp and the shed the logs come out of
  const feedDir = f.R.clone().multiplyScalar(-side).setY(0).normalize();
  const start = f.pos.clone().addScaledVector(f.R, side * (hw + FL + 0.6)).addScaledVector(f.U, FL * SLOPE - 0.02);
  const heading = Math.atan2(feedDir.x, feedDir.z);
  const feed = new Path(start, heading, [{ len: FL + 0.6, slope: Math.atan(SLOPE) * 57.3, w: len + 0.6, wall: 0.5 }]);
  b.chute(feed);
  const shed = new Parts();
  const SW = len + 1.4, SH = 2.6, SD = 2.4;
  shed.add(b.paint({ a: PAINT.green, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.2 }), plank(SD, SH, 0.3, 0.06, 'x'), mat(0, SH / 2, -SW / 2));
  shed.add(b.paint({ a: PAINT.green, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.2 }), plank(SD, SH, 0.3, 0.06, 'x'), mat(0, SH / 2, SW / 2));
  shed.add(b.paint({ a: PAINT.green, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.2 }), plank(0.3, SH, SW, 0.06, 'z'), mat(SD / 2, SH / 2, 0));
  // the roof: two pitched boards
  for (const e of [-1, 1]) shed.add(b.paint({ a: PAINT.red, b: PAINT.white, pattern: Pattern.Checks, scale: 1.4 }), plank(SD * 0.62 + 0.4, 0.16, SW + 0.6, 0.05, 'z'), mat(e * SD * 0.27, SH + 0.45, 0, rotZ(-e * 0.6)));
  shed.add(b.brass, dome(0.25, 1, 12), mat(0, SH + 0.92, 0));
  const sq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI / 2);
  shed.toBatch(b, new THREE.Matrix4().compose(start.clone().addScaledVector(feedDir, 0.4).addScaledVector(f.U, -0.2), sq, new THREE.Vector3(1, 1, 1)));
}

/**
 * Boulders bowling down the track from s0 to s1: each rolls in off a ramp on the left (through an
 * open wall), runs down its lane faster than a marble, and leaves off the right (another open
 * stretch) into the paint. Colliders are upright drums inside the painted balls.
 */
export function boulderRun(b: CourseBuilder, path: Path, s0: number, s1: number, o: { count?: number; speed?: number; r?: number; lanes?: number[]; phase?: number; colors?: number[] } = {}) {
  const R0 = o.r ?? 1.35;
  const v = o.speed ?? 16;
  const lanes = o.lanes ?? [-2.2, 2.2, 0];
  const n = o.count ?? 3;
  const f0 = frameAt(path, s0);
  const hw0 = f0.sec.w / 2;
  const IN = 10, SLOPE = 0.22;
  const run = s1 - s0;
  const EXIT = 10, fallT = 2.0;
  const C = IN + run + EXIT + v * fallT + 6;
  const ph = o.phase ?? 0;
  const P = new THREE.Vector3();
  // where a boulder is after travelling u: (pos, the direction it rolls)
  const where = (u: number, lane: number, out: THREE.Vector3, dir: THREE.Vector3) => {
    if (u < IN) {
      // down the ramp onto the left edge
      const k = u / IN;
      out.copy(f0.pos).addScaledVector(f0.R, -(hw0 + IN - u)).addScaledVector(f0.U, R0 * 0.9 + (1 - k) * IN * SLOPE);
      dir.copy(f0.R);
      return true;
    }
    const d = u - IN;
    if (d < run) {
      const s = s0 + d;
      // swing from the left edge into the lane over 10 m, out to the right over the last 10 m
      const a = Math.min(1, d / 10), e = Math.max(0, (d - (run - EXIT)) / EXIT);
      const hw = path.sec[path.index(s)].w / 2;
      const lat = -hw + (lane + hw) * (a * a * (3 - 2 * a)) + (hw + 2 - lane) * e * e;
      path.at(s, lat, R0 * 0.9, out);
      dir.copy(path.T[path.index(s)]);
      return true;
    }
    const tau = (d - run) / v;
    if (tau > fallT) return false;
    const ie = path.index(s1);
    out.copy(path.at(s1, path.sec[ie].w / 2 + 2, R0 * 0.9)).addScaledVector(path.T[ie], (d - run) * 0.7).addScaledVector(path.Rt[ie], (d - run) * 0.7);
    out.y -= 12 * tau * tau;
    dir.copy(path.T[ie]);
    return true;
  };
  const cols = o.colors ?? [PAINT.orange, PAINT.purple, PAINT.teal];
  const DIR = new THREE.Vector3(), AX = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const lane = lanes[k % lanes.length];
    const u = (t: number) => ((((t + ph) * v + (k * C) / n) % C) + C) % C;
    const kin = new Kin({ type: 'cyl', r: R0 * 0.9, hh: R0 * 0.9 }, Mat.Paint, (t, pos, quat) => {
      if (!where(u(t), lane, pos, DIR)) pos.set(f0.pos.x, f0.pos.y - 60, f0.pos.z);
      quat.copy(f0.q);
    });
    b.world.addKin(kin);
    b.hazards.push(kin);
    const vk = new Kin({ type: 'sph', r: 0.1 }, Mat.Paint, (t, pos, quat) => {
      const uu = u(t);
      if (!where(uu, lane, pos, DIR)) pos.set(f0.pos.x, f0.pos.y - 60, f0.pos.z);
      AX.crossVectors(DIR, P.set(0, 1, 0)).normalize();
      // (rolling: turned about the axis across its way by the distance over the radius)
      quat.setFromAxisAngle(AX, -uu / R0);
    });
    vk.enabled = false;
    const p = new Parts();
    const col = cols[k % cols.length];
    const pm = b.paint({ a: col, b: PAINT.white, pattern: Pattern.Spiral, scale: 0.8, wear: 0.08 });
    p.add(pm, dome(R0, 1, 40));
    p.add(pm, dome(R0, 1, 40), mat(0, 0, 0, rotX(Math.PI)));
    p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), band(R0 * 1.0, 0.09, 48));
    p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), band(R0 * 1.0, 0.09, 48), mat(0, 0, 0, rotX(Math.PI / 2)));
    for (const e of [-1, 1]) p.add(b.brass, dome(0.32, 0.6, 14), mat(0, e * R0, 0, e < 0 ? rotX(Math.PI) : undefined));
    b.obstacle(vk, p.group(), false);
  }
  // the ramp in: a short chute from the left, and its hopper
  const feedDir = f0.R.clone().setY(0).normalize();
  const start = f0.pos.clone().addScaledVector(f0.R, -(hw0 + IN + 1)).addScaledVector(f0.U, IN * SLOPE + 0.05);
  const heading = Math.atan2(feedDir.x, feedDir.z);
  const feed = new Path(start, heading, [{ len: IN + 1.2, slope: Math.atan(SLOPE) * 57.3, w: R0 * 2 + 1.2, wall: 0.9 }]);
  b.chute(feed);
  const hop = new Parts();
  const HW = R0 + 1.2, HH = R0 * 2 + 1.6;
  const hm = b.paint({ a: PAINT.blue, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.1 });
  for (const e of [-1, 1]) hop.add(hm, plank(0.35, HH, 3.2, 0.06, 'y'), mat(e * HW, HH / 2, 0));
  hop.add(hm, plank(HW * 2 + 0.35, 0.4, 3.4, 0.06, 'x'), mat(0, HH, 0));
  hop.add(b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 2 }), plank(HW * 2 + 0.6, 0.5, 0.3, 0.05, 'x'), mat(0, HH - 0.2, 1.75));
  hop.add(hm, plank(HW * 2, HH, 0.3, 0.06, 'x'), mat(0, HH / 2, -1.6));
  boltRing(hop, b, mat(0, HH + 0.2, 0), 1.0, 8, 0.07);
  const hq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  hop.toBatch(b, new THREE.Matrix4().compose(start.clone().addScaledVector(feedDir, 0.4), hq, new THREE.Vector3(1, 1, 1)));
}

/**
 * A seesaw over a gap, s0..s1: a railed deck pitching about its middle on its own beat, so at
 * times its near end stands proud of the lip (wait, or hop) and its far end drops below the next.
 */
export function seesaw(b: CourseBuilder, path: Path, s0: number, s1: number, o: { amp?: number; period?: number; phase?: number; color?: number } = {}) {
  const sm = (s0 + s1) / 2;
  const f = frameAt(path, sm, 0, -0.16);
  const len = s1 - s0 - 0.12;
  const w = f.sec.w;
  const amp = o.amp ?? 0.075, om = (Math.PI * 2) / (o.period ?? 3.6), ph = o.phase ?? 0;
  const tilt = (t: number) => amp * Math.sin(om * t + ph);
  const deck = new Kin({ type: 'box', hx: w / 2, hy: 0.15, hz: len / 2 }, Mat.Paint, (t, pos, quat) => {
    QA.setFromAxisAngle(f.R, tilt(t));
    quat.copy(QA).multiply(f.q);
    pos.copy(f.pos);
  });
  const col = o.color ?? PAINT.blue;
  const p = new Parts();
  p.add(b.paint({ a: col, b: PAINT.white, pattern: Pattern.Checks, scale: 0.9, wear: 0.06 }), plank(w, 0.3, len, 0.06, 'z'));
  const railM = b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid, wear: 0.06 });
  for (const e of [-1, 1]) {
    p.add(railM, plank(0.26, 0.55, len, 0.08, 'z'), mat(e * (w / 2 - 0.13), 0.42, 0));
    for (let z = -len / 2 + 0.6; z < len / 2; z += 1.6) bolt(p, b, mat(e * (w / 2 - 0.13), 0.7, z), 0.05);
  }
  // a fat chevron down the middle (which way it's tipping)
  p.add(b.paint({ a: PAINT.yellow, b: col, pattern: Pattern.Chevron, scale: 0.8 }), plank(1.4, 0.04, len - 0.4, 0.01, 'z'), mat(0, 0.16, 0));
  b.obstacle(deck, p.group(), false);
  for (const e of [-1, 1]) {
    const rail = new Kin({ type: 'box', hx: 0.13, hy: 0.28, hz: len / 2 }, Mat.Paint, (t, pos, quat) => {
      QA.setFromAxisAngle(f.R, tilt(t));
      quat.copy(QA).multiply(f.q);
      V.set(e * (w / 2 - 0.13), 0.42, 0).applyQuaternion(quat);
      pos.copy(f.pos).add(V);
    });
    rail.enabled = true;
    b.world.addKin(rail);
  }
  // the fulcrum: a painted wedge on a trestle, a brass axle through it
  const fp = new Parts();
  const tri = new THREE.Shape();
  tri.moveTo(-1.4, -2.6);
  tri.lineTo(1.4, -2.6);
  tri.lineTo(0.25, -0.2);
  tri.lineTo(-0.25, -0.2);
  const tg = new THREE.ExtrudeGeometry(tri, { depth: w - 1.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
  tg.translate(0, 0, -(w - 1.2) / 2);
  tg.rotateY(Math.PI / 2);
  fp.add(b.paint({ a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.4 }), uvw(tg));
  fp.add(b.brass, rod(0.18, w + 0.5, 14), mat(0, -0.2, 0, rotZ(Math.PI / 2)));
  for (const e of [-1, 1]) fp.add(b.brass, dome(0.26, 0.6, 12), mat(e * (w / 2 + 0.25), -0.2, 0, rotZ((-e * Math.PI) / 2)));
  fp.toBatch(b, f.m);
}

/**
 * A plank over a gap, s0..s1, rocking side to side about the track's axis (no rails): keep to
 * the middle. Its width is the path's there.
 */
export function wobblePlank(b: CourseBuilder, path: Path, s0: number, s1: number, o: { amp?: number; period?: number; phase?: number; color?: number; lat?: number; w?: number; kerb?: number } = {}) {
  const sm = (s0 + s1) / 2;
  const lat = o.lat ?? 0;
  const f = frameAt(path, sm, lat, -0.16);
  const len = s1 - s0 - 0.1;
  const w = o.w ?? f.sec.w;
  const amp = o.amp ?? 0.16, om = (Math.PI * 2) / (o.period ?? 3.0), ph = o.phase ?? 0;
  const deck = new Kin({ type: 'box', hx: w / 2, hy: 0.15, hz: len / 2 }, Mat.Paint, (t, pos, quat) => {
    QA.setFromAxisAngle(f.T, amp * Math.sin(om * t + ph));
    quat.copy(QA).multiply(f.q);
    pos.copy(f.pos);
  });
  const p = new Parts();
  p.add(b.paint({ a: o.color ?? PAINT.orange, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.5, wear: 0.06 }), plank(w, 0.3, len, 0.07, 'z'));
  for (let z = -len / 2 + 0.5; z < len / 2; z += 2) for (const e of [-1, 1]) bolt(p, b, mat(e * (w / 2 - 0.25), 0.15, z), 0.05);
  // the axle housings at its ends
  for (const e of [-1, 1]) p.add(b.brass, rod(0.2, 0.5, 14).rotateX(Math.PI / 2), mat(0, -0.12, e * (len / 2 - 0.2)));
  // low kerbs (a marble going across fast still hops one)
  const kh = o.kerb ?? 0;
  if (kh > 0) {
    for (const e of [-1, 1]) {
      p.add(b.paint({ a: PAINT.white, b: PAINT.red, pattern: Pattern.Stripes, scale: 1.6 }), plank(0.16, kh + 0.15, len, 0.05, 'z'), mat(e * (w / 2 - 0.08), 0.075 + kh / 2, 0));
      const kerb = new Kin({ type: 'box', hx: 0.08, hy: (kh + 0.15) / 2, hz: len / 2 }, Mat.Paint, (t, pos, quat) => {
        QA.setFromAxisAngle(f.T, amp * Math.sin(om * t + ph));
        quat.copy(QA).multiply(f.q);
        V.set(e * (w / 2 - 0.08), 0.075 + kh / 2, 0).applyQuaternion(quat);
        pos.copy(f.pos).add(V);
      });
      b.world.addKin(kerb);
    }
  }
  b.obstacle(deck, p.group(), false);
  // posts holding the axle, at both ends below the lips
  for (const e of [-1, 1]) {
    const pp = new Parts();
    post(pp, b, mat(), 4, { w: 0.5 });
    pp.toBatch(b, new THREE.Matrix4().compose(path.at(sm + e * (len / 2 + 0.1), lat, -4.4), f.q, new THREE.Vector3(1, 1, 1)));
  }
}

/**
 * A bridge sliding from side to side over a gap, s0..s1 (the path wide there: the bridge is `w`).
 * Ghost hazards ride either side of it so the bots aim for where it will be.
 */
export function slideBridge(b: CourseBuilder, path: Path, s0: number, s1: number, o: { w?: number; period?: number; phase?: number; color?: number } = {}) {
  const sm = (s0 + s1) / 2;
  const f = frameAt(path, sm, 0, -0.16);
  const len = s1 - s0 - 0.1;
  const W = f.sec.w;
  const w = o.w ?? 6;
  const travel = (W - w) / 2;
  const om = (Math.PI * 2) / (o.period ?? 6), ph = o.phase ?? 0;
  const x = (t: number) => travel * Math.sin(om * t + ph);
  const deck = new Kin({ type: 'box', hx: w / 2, hy: 0.15, hz: len / 2 }, Mat.Paint, (t, pos, quat) => {
    quat.copy(f.q);
    pos.copy(f.pos).addScaledVector(f.R, x(t));
  });
  const p = new Parts();
  p.add(b.paint({ a: o.color ?? PAINT.green, b: PAINT.white, pattern: Pattern.Dots, scale: 1.4, wear: 0.05 }), plank(w, 0.3, len, 0.08, 'z'));
  // railed both sides (low: a marble going fast can still hop one)
  const RH = 0.42;
  for (const e of [-1, 1]) p.add(b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 2.2 }), plank(0.2, RH + 0.3, len, 0.06, 'z'), mat(e * (w / 2 - 0.1), RH / 2, 0));
  for (let z = -len / 2 + 0.4; z < len / 2; z += 1.5) for (const e of [-1, 1]) bolt(p, b, mat(e * (w / 2 - 0.1), RH + 0.15, z), 0.05);
  b.obstacle(deck, p.group(), false);
  for (const e of [-1, 1]) {
    const rail = new Kin({ type: 'box', hx: 0.1, hy: (RH + 0.3) / 2, hz: len / 2 }, Mat.Paint, (t, pos, quat) => {
      quat.copy(f.q);
      pos.copy(f.pos).addScaledVector(f.R, x(t) - e * (w / 2 - 0.1)).addScaledVector(f.U, RH / 2);
    });
    b.world.addKin(rail);
  }
  // ghosts on both sides
  const GW = 4;
  for (const e of [-1, 1]) {
    b.ghost({ type: 'box', hx: GW / 2, hy: 1, hz: len / 2 }, (t, pos, quat) => {
      quat.copy(f.q);
      pos.copy(f.pos).addScaledVector(f.R, x(t) + e * (w / 2 + GW / 2 + 0.35)).addScaledVector(f.U, 0.6);
    });
  }
  // the guide rails it runs on, under it, end to end across the gap
  const gp = new Parts();
  for (const e of [-1, 1]) gp.add(b.steel, rod(0.09, W + 1.2, 10), mat(0, -0.45, e * (len / 2 - 0.3), rotZ(Math.PI / 2)));
  for (const e of [-1, 1]) for (const e2 of [-1, 1]) {
    gp.add(b.darkWood, plank(0.4, 0.9, 0.4, 0.05, 'y'), mat(e * (W / 2 + 0.6), -0.45, e2 * (len / 2 - 0.3)));
  }
  gp.toBatch(b, f.m);
}

/** paint coordinates straight from the local position (extrusions) */
function uvw(g: THREE.BufferGeometry) {
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

/**
 * A trampoline in a pit across the path's open stretch s0..s1, `depth` below the floor: roll off the
 * lip, drop onto the drum skin and get thrown up and on to the far side. A painted frame on legs,
 * steel springs all round, a skin with a target on it.
 */
export function trampoline(b: CourseBuilder, path: Path, s0: number, s1: number, o: { depth?: number; kick?: number; color?: number } = {}) {
  const sm = (s0 + s1) / 2;
  const depth = o.depth ?? 2.2;
  const f = frameAt(path, sm, 0, -depth);
  const len = s1 - s0 + 0.6;
  const w = f.sec.w;
  const TH = 0.3;
  const bed = new Kin({ type: 'box', hx: w / 2, hy: TH / 2, hz: len / 2 }, Mat.Bumper);
  bed.pos.copy(f.pos).addScaledVector(f.U, -TH / 2);
  bed.quat.copy(f.q);
  bed.kick = o.kick ?? 4.5;
  const p = new Parts();
  // the skin: a target painted on black
  const skin = new THREE.PlaneGeometry(w - 1.2, len - 1.2, 1, 1).rotateX(-Math.PI / 2);
  const pp = skin.getAttribute('position');
  const wd = new Float32Array(pp.count * 3);
  skin.setAttribute('aWood', new THREE.BufferAttribute(wd, 3));
  skin.translate(0, TH / 2 + 0.01, 0);
  const skinM = b.paint({ a: PAINT.black, b: PAINT.black, pattern: Pattern.Solid, wear: 0 });
  p.add(skinM, skin);
  p.add(b.paint({ a: o.color ?? PAINT.red, b: PAINT.white, pattern: Pattern.Rings, scale: 0.9, wear: 0 }), ringDisk(Math.min(w, len) / 2 - 1.2, 48), mat(0, TH / 2 + 0.02, 0));
  // the frame: four bevelled painted rails
  const fm = b.paint({ a: PAINT.blue, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.4, wear: 0.05 });
  for (const e of [-1, 1]) {
    p.add(fm, plank(0.5, TH + 0.1, len, 0.08, 'z'), mat(e * (w / 2 - 0.25), 0, 0));
    p.add(fm, plank(w, TH + 0.1, 0.5, 0.08, 'x'), mat(0, 0, e * (len / 2 - 0.25)));
  }
  // springs from the frame to the skin
  for (let z = -len / 2 + 0.9; z <= len / 2 - 0.9; z += 0.7) for (const e of [-1, 1]) p.add(b.steel, rod(0.05, 0.6, 6).rotateZ(Math.PI / 2), mat(e * (w / 2 - 0.75), TH / 2 + 0.02, z));
  for (let x = -w / 2 + 0.9; x <= w / 2 - 0.9; x += 0.7) for (const e of [-1, 1]) p.add(b.steel, rod(0.05, 0.6, 6).rotateX(Math.PI / 2), mat(x, TH / 2 + 0.02, e * (len / 2 - 0.75)));
  // legs down into the paint (short stubs with brass feet: it hangs from the lips)
  for (const ex of [-1, 1]) for (const ez of [-1, 1]) {
    p.add(b.railWood, plank(0.3, 3, 0.3, 0.05, 'y'), mat(ex * (w / 2 - 0.25), -1.6, ez * (len / 2 - 0.25)));
    p.add(b.brass, dome(0.22, 0.7, 10), mat(ex * (w / 2 - 0.25), -3.1, ez * (len / 2 - 0.25), rotX(Math.PI)));
  }
  b.fixed(bed, p, false);
  // the pit's walls: the ends flush with the floor (a weak bounce drops back on the skin and goes
  // again), the sides standing a rail's height above it
  const wm = b.paint({ a: PAINT.yellow, b: PAINT.blue, pattern: Pattern.Chevron, scale: 0.8, wear: 0.06 });
  const box = (hx: number, hy: number, hz: number, at: THREE.Vector3) => {
    const k = new Kin({ type: 'box', hx, hy, hz }, Mat.Paint);
    k.pos.copy(f.pos).addScaledVector(f.R, -at.x).addScaledVector(f.U, at.y).addScaledVector(f.T, at.z);
    k.quat.copy(f.q);
    const pp = new Parts();
    pp.add(wm, plank(hx * 2, hy * 2, hz * 2, 0.06, hx > hz ? 'x' : 'z'));
    pp.add(b.railWood, plank(hx * 2 + 0.08, 0.12, hz * 2 + 0.08, 0.04, hx > hz ? 'x' : 'z'), mat(0, hy, 0));
    b.fixed(k, pp, false);
  };
  for (const e of [-1, 1]) {
    // (up to the underside of the lip, whose cut end carries on to the floor)
    const gap = s1 - s0;
    box(w / 2, (depth - 0.42) / 2, 0.15, new THREE.Vector3(0, (depth - 0.42) / 2, e * (gap / 2 + 0.15)));
    box(0.18, (depth + 1.3) / 2, len / 2 + 0.3, new THREE.Vector3(e * (w / 2 + 0.18), (depth + 1.3) / 2, 0));
  }
}
