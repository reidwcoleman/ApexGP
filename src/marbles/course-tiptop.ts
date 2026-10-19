import * as THREE from 'three';
import { CourseBuilder, PAINT, cylAttr } from './builder.ts';
import { signTexture } from './obstacles.ts';
import { Kin, Mat } from './physics.ts';
import { paintMaterial, Pattern, woodAttr } from './shaders.ts';
import { Parts, band, bolt, boltRing, dome, mat, plank, post, rod } from './obs-kit.ts';
import type { Course } from './courses.ts';

/**
 * Round 5, Tip Top: a great painted dish balanced on a brass ball joint. It tips — a little at
 * first, then more, and the low side wanders round faster and faster — while a low bar turns over
 * it (hop it). At 40 s a ring of bumpers starts popping up out of the dish. Last half on it go through.
 */

export const TIP_TOP = { barSpeed: 0.5, popAt: 30, tiltMax: 0.22 };

export function tiptop(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 125, 0);
  const R = 12.5, TH = 0.8;
  b.lakeY = center.y - 36;
  const state = { go: 1e9 };
  const tau = (t: number) => Math.max(0, t - state.go);
  // the tilt: grows to 8° by 30 s and on to the max by 100 s; the low side precesses round
  const tilt = (x: number) => Math.min(TIP_TOP.tiltMax, 0.14 * THREE.MathUtils.smoothstep(x, 0, 30) + 0.0012 * Math.max(0, x - 30));
  const prec = (x: number) => 0.45 * x + 0.003 * x * x;
  const AX = new THREE.Vector3(), QT = new THREE.Quaternion(), QS = new THREE.Quaternion(), QR = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  /** the dish's tilt at t (no spin) */
  const tiltQ = (t: number, out: THREE.Quaternion) => {
    const x = tau(t);
    const p = prec(x);
    AX.set(Math.cos(p), 0, Math.sin(p));
    return out.setFromAxisAngle(AX, tilt(x));
  };
  const SPIN = 0.12;
  const OFF = new THREE.Vector3();
  /** a rider on the dish: local offset (in the dish's spinning frame or not) → world */
  const ride = (local: THREE.Vector3, spin: (t: number) => number, extra?: (t: number, q: THREE.Quaternion) => void) => (t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => {
    tiltQ(t, QT);
    QS.setFromAxisAngle(Y, spin(t));
    QR.copy(QT).multiply(QS);
    quat.copy(QR);
    if (extra) extra(t, quat);
    OFF.copy(local).applyQuaternion(QR);
    pos.copy(center).add(OFF);
  };
  // the dish
  const dish = new Kin({ type: 'cyl', r: R, hh: TH / 2 }, Mat.Paint, ride(new THREE.Vector3(0, -TH / 2, 0), (t) => SPIN * t));
  {
    const p = new Parts();
    // a target, painted in rings (paint coordinates: radius, round)
    const top = new THREE.CircleGeometry(R, 96, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    const pp = top.getAttribute('position');
    const wd = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), z = pp.getZ(i);
      const r = Math.hypot(x, z);
      wd[i * 3] = r;
      wd[i * 3 + 1] = Math.atan2(z, x) * r;
    }
    top.setAttribute('aWood', new THREE.BufferAttribute(wd, 3));
    top.translate(0, TH / 2, 0);
    p.add(b.paint({ a: PAINT.teal, b: PAINT.white, pattern: Pattern.Rings, scale: 0.42, wear: 0.06 }), top);
    // spokes of paint: chevrons pointing out (which way is down)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      p.add(b.paint({ a: PAINT.yellow, b: PAINT.purple, pattern: Pattern.Chevron, scale: 0.9 }), plank(0.9, 0.02, 4.2, 0.005, 'z'), mat(Math.cos(a) * 8.6, TH / 2 + 0.006, Math.sin(a) * 8.6, new THREE.Quaternion().setFromAxisAngle(Y, -a + Math.PI / 2)));
    }
    p.add(b.railWood, woodAttr(new THREE.CylinderGeometry(R, R - 0.25, TH, 96, 1, true), 'y'));
    p.add(b.paint({ a: PAINT.purple, b: PAINT.white, pattern: Pattern.Stripes, scale: 2 }), band(R + 0.02, 0.1, 96), mat(0, TH / 2 - 0.08, 0));
    const under = new THREE.CircleGeometry(R - 0.25, 64).rotateX(Math.PI / 2);
    under.translate(0, -TH / 2, 0);
    p.add(b.railWood, woodAttr(under, 'x'));
    // the ribs underneath and the cup the ball sits in
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      p.add(b.darkWood, plank(0.35, 0.5, R - 2.2, 0.05, 'z'), mat(Math.cos(a) * (R / 2 + 0.6), -TH / 2 - 0.25, Math.sin(a) * (R / 2 + 0.6), new THREE.Quaternion().setFromAxisAngle(Y, -a + Math.PI / 2)));
    }
    p.add(b.brass, dome(1.9, 0.5, 32), mat(0, -TH / 2, 0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)));
    boltRing(p, b, mat(0, -TH / 2 - 0.02, 0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)), 2.2, 12, 0.08);
    b.obstacle(dish, p.group(), false);
  }
  // the hub post in the middle and the bar turning on it
  const hubH = 1.5;
  const hubK = new Kin({ type: 'cyl', r: 1.0, hh: hubH / 2 }, Mat.Paint, ride(new THREE.Vector3(0, hubH / 2, 0), (t) => SPIN * t));
  {
    const p = new Parts();
    p.add(b.paint({ a: PAINT.purple, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.8 }), rod(1.0, hubH, 32));
    p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), dome(1.0, 0.8, 28), mat(0, hubH / 2, 0));
    p.add(b.brass, dome(0.28, 0.8, 12), mat(0, hubH / 2 + 0.8, 0));
    p.add(b.brass, band(1.04, 0.06, 32), mat(0, -hubH / 2 + 0.1, 0));
    b.obstacle(hubK, p.group(), false);
  }
  const barA = (t: number) => {
    const x = tau(t);
    return 0.9 + TIP_TOP.barSpeed * x + 0.0017 * x * x;
  };
  const BAR_H = 0.56, BAR_L = R * 2 + 1.4;
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const bar = new Kin({ type: 'cyl', r: 0.36, hh: BAR_L / 2 }, Mat.Paint, ride(new THREE.Vector3(0, BAR_H, 0), barA, (_t, q) => q.multiply(qz)));
  {
    const p = new Parts();
    p.add(b.paint({ a: PAINT.red, b: PAINT.white, pattern: Pattern.Rings, scale: 1.2 }), rod(0.36, BAR_L, 24));
    for (const e of [-1, 1]) {
      p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), cylAttr(new THREE.SphereGeometry(0.46, 20, 12)), mat(0, (e * BAR_L) / 2, 0));
      p.add(b.brass, band(0.37, 0.045, 18), mat(0, e * (BAR_L / 2 - 0.55), 0));
    }
    p.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), rod(0.62, 0.6, 24), mat(0, 0, 0));
    b.obstacle(bar, p.group());
  }
  // the bumper ring: six posts that pop up out of the dish from 40 s, each on its own beat
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.26;
    const local = new THREE.Vector3(Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2);
    const H = 0.9;
    const per = 7.5 + (k % 3) * 0.9, ph = k * 1.7;
    const up = (t: number) => {
      const x = tau(t) - TIP_TOP.popAt;
      if (x < 0) return -H - 0.2;
      const c = (((x + ph) % per) + per) % per;
      const k2 = c < 0.25 ? c / 0.25 : c < per * 0.55 ? 1 : c < per * 0.55 + 0.4 ? 1 - (c - per * 0.55) / 0.4 : 0;
      return -H - 0.2 + (H + 0.2 + H / 2) * k2;
    };
    const L2 = new THREE.Vector3();
    const rider = ride(L2, (tt) => SPIN * tt);
    const kin = new Kin({ type: 'cyl', r: 0.75, hh: H / 2 }, Mat.Bumper, (t, pos, quat) => {
      L2.copy(local).setY(up(t));
      rider(t, pos, quat);
    });
    kin.kick = 6.5;
    const p = new Parts();
    const capM = paintMaterial({ a: [PAINT.pink, PAINT.orange, PAINT.green][k % 3], b: PAINT.white, pattern: Pattern.Rings, scale: 3, wear: 0.02 });
    const flash = { value: 0 };
    capM.userData.u.uFlash = flash;
    p.add(b.paint({ a: PAINT.black, b: PAINT.black, pattern: Pattern.Solid }), rod(0.6, H, 24));
    p.add(capM, dome(0.74, 0.45, 28), mat(0, H / 2, 0));
    p.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), band(0.72, 0.1, 28), mat(0, H / 2, 0));
    const vis = p.group();
    vis.userData.flash = flash;
    b.obstacle(kin, vis, false);
  }
  // the ball joint, the gimbal ring and the column down into the paint
  {
    const p = new Parts();
    p.add(b.brass, dome(1.6, 1, 40), mat(0, -TH - 1.2, 0));
    p.add(b.brass, dome(1.6, 1, 40), mat(0, -TH - 1.2, 0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)));
    p.add(b.steel, band(2.3, 0.16, 48), mat(0, -TH - 1.2, 0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)));
    p.add(b.steel, band(2.3, 0.16, 48), mat(0, -TH - 1.2, 0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)));
    const colH = center.y - b.lakeY - 2;
    p.add(b.paint({ a: PAINT.purple, b: PAINT.yellow, pattern: Pattern.Stripes, scale: 0.4, wear: 0.04 }), cylAttr(new THREE.CylinderGeometry(1.3, 3.6, colH, 40, 8, true)), mat(0, -TH - 2.6 - colH / 2, 0));
    p.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), rod(1.5, 0.5, 40), mat(0, -TH - 2.7, 0));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      bolt(p, b, mat(Math.cos(a) * 1.35, -TH - 2.45, Math.sin(a) * 1.35), 0.07);
    }
    p.toBatch(b, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
  }
  // the sign on its posts
  {
    const p = new Parts();
    p.add(b.railWood, plank(9.4, 2.0, 0.3, 0.08, 'x'), mat(0, 8.5, -0.18));
    for (const sx of [-4.2, 4.2]) post(p, b, mat(sx, -6, -0.3), 15.6, { w: 0.42 });
    p.toBatch(b, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z - R - 5));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshPhysicalMaterial({ map: signTexture(info.name.toUpperCase(), 'Round 5 · Survival', PAINT.purple), roughness: 0.4, clearcoat: 0.8 }));
    sign.position.set(center.x, center.y + 8.5, center.z - R - 5);
    b.group.add(sign);
  }
  b.finish();
  return {
    id: 'tiptop',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 9,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + 0.3;
        const r = 4.2 + (k % 3) * 2.3;
        const pos = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.52, center.z + Math.sin(a) * r);
        out.push({ pos, yaw: Math.atan2(center.x - pos.x, center.z - pos.z) });
      }
      return out;
    },
    plate: {
      center,
      radius: R,
      bars: [{ angle: barA, height: BAR_H, kin: bar, on: () => true }],
    },
    intro: [],
  };
}
