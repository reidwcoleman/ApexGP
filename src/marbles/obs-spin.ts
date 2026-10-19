import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, Pattern } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import { Parts, band, beam, bolt, boltRing, dome, frameAt, gantry, hub, mat, plank, post, rod, rotX, rotZ } from './obs-kit.ts';
import { paintMaterial } from './shaders.ts';
import type { PaintSpec } from './shaders.ts';

/**
 * Things that turn: the windmill (paddles wheeling across the track on a spindle from a gantry),
 * the turnstile (a revolving door of low boards you can hop), a bed of spinning rollers (a
 * conveyor or a booster) and pinball flippers. All poses are functions of time.
 */

const Y = new THREE.Vector3(0, 1, 0);
const QA = new THREE.Quaternion();

/**
 * A windmill over the track at s: `blades` paddles on arms wheeling about the track's own axis,
 * their tips just kissing the floor at the bottom of the turn — so a paddle sweeps across the floor
 * from wall to wall, then lifts clear. Hung on a spindle from a gantry just upstream.
 */
export function windmill(b: CourseBuilder, path: Path, s: number, o: { blades?: number; omega?: number; phase?: number; height?: number; paint?: PaintSpec; hubColor?: number } = {}) {
  const f = frameAt(path, s);
  const H = o.height ?? 5.6;
  const L = H - 0.06;
  const n = o.blades ?? 3;
  const om = o.omega ?? 0.85, ph = o.phase ?? 0;
  const hubAt = path.at(s, 0, H);
  const PAD = 2.5, ARM = L - PAD;
  const pm = b.paint(o.paint ?? { a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6, wear: 0.05 });
  const armM = b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid, wear: 0.08 });
  // blade k at angle a: its arm and its paddle (boxes in the plane across the track)
  const off = new THREE.Vector3();
  const spin = (k: number, r: number) => (t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => {
    const a = om * t + ph + (k / n) * Math.PI * 2;
    // the local frame turned about its z (the track's direction); the blade hangs along local −y
    QA.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    quat.copy(f.q).multiply(QA);
    off.set(0, -r, 0).applyQuaternion(quat);
    pos.copy(hubAt).add(off);
  };
  for (let k = 0; k < n; k++) {
    const paddle = new Kin({ type: 'box', hx: 0.6, hy: PAD / 2, hz: 0.16 }, Mat.Paint, spin(k, L - PAD / 2));
    const p = new Parts();
    p.add(pm, plank(1.2, PAD, 0.32, 0.1, 'y', k));
    // a painted rim and bolts where it meets the arm
    p.add(armM, plank(1.32, 0.16, 0.36, 0.05, 'x', k), mat(0, PAD / 2 - 0.08, 0));
    p.add(armM, plank(1.32, 0.16, 0.36, 0.05, 'x', k), mat(0, -PAD / 2 + 0.08, 0));
    for (const dx of [-0.34, 0.34]) for (const dy of [0.5, 0.95]) for (const e of [-1, 1]) bolt(p, b, mat(dx, dy, e * 0.16, rotX((e * Math.PI) / 2)), 0.05);
    b.obstacle(paddle, p.group());
    // (the arm never comes down to a marble: no collider)
    const arm = new Kin({ type: 'box', hx: 0.13, hy: ARM / 2, hz: 0.13 }, Mat.Wood, spin(k, ARM / 2));
    arm.enabled = false;
    const pa = new Parts();
    pa.add(b.railWood, plank(0.26, ARM, 0.26, 0.05, 'y', k));
    for (const dy of [-ARM / 2 + 0.3, ARM / 2 - 0.3]) pa.add(b.steel, band(0.17, 0.035, 12).scale(1, 1, 1), mat(0, dy, 0));
    b.obstacle(arm, pa.group(), false);
  }
  // the hub turns with the blades (visual only: nothing reaches it)
  const hubK = new Kin({ type: 'cyl', r: 0.6, hh: 0.3 }, Mat.Paint, (t, pos, quat) => {
    QA.setFromAxisAngle(new THREE.Vector3(0, 0, 1), om * t + ph);
    quat.copy(f.q).multiply(QA).multiply(rotX(Math.PI / 2));
    pos.copy(hubAt);
  });
  const ph2 = new Parts();
  hub(ph2, b, mat(), 0.62, 0.7, b.paint({ a: o.hubColor ?? PAINT.yellow, b: PAINT.white, pattern: Pattern.Rings, scale: 3 }));
  hubK.enabled = false;
  b.obstacle(hubK, ph2.group(), false);
  // the gantry upstream and the spindle to the hub
  const gs = s - 1.3;
  const top = gantry(b, path, gs, H + 0.15, { paint: b.railWood });
  const sp = new Parts();
  beam(sp, b.steel, top, hubAt, 0.2);
  // a bearing block on the beam
  sp.add(b.darkWood, plank(0.8, 0.8, 0.8, 0.08, 'y', 2), new THREE.Matrix4().compose(top, f.q, new THREE.Vector3(1, 1, 1)));
  sp.toBatch(b, new THREE.Matrix4());
}

/**
 * A turnstile: a painted drum at the centre of the track with `arms` low boards turning about it,
 * like a revolving door. The boards are low enough to hop.
 */
export function turnstile(b: CourseBuilder, path: Path, s: number, o: { arms?: number; omega?: number; phase?: number; height?: number; reach?: number; color?: number } = {}) {
  const f = frameAt(path, s);
  const n = o.arms ?? 4;
  const om = o.omega ?? 0.9, ph = o.phase ?? 0;
  const H = o.height ?? 1.0;
  const R0 = 0.75;
  const reach = o.reach ?? f.sec.w / 2 - 0.45;
  const len = reach - R0;
  const bm = b.paint({ a: o.color ?? PAINT.teal, b: PAINT.white, pattern: Pattern.Chevron, scale: 1.1, wear: 0.05 });
  const capM = b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid });
  const off = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const kin = new Kin({ type: 'box', hx: len / 2, hy: H / 2, hz: 0.14 }, Mat.Paint, (t, pos, quat) => {
      QA.setFromAxisAngle(Y, om * t + ph + (k / n) * Math.PI * 2);
      quat.copy(f.q).multiply(QA);
      off.set(R0 + len / 2, H / 2, 0).applyQuaternion(quat);
      pos.copy(f.pos).add(off);
    });
    const p = new Parts();
    p.add(bm, plank(len, H, 0.28, 0.1, 'x', k));
    // a white cap rail along the top and a bumper end
    p.add(capM, plank(len + 0.06, 0.12, 0.34, 0.05, 'x', k), mat(0, H / 2, 0));
    p.add(capM, rod(0.2, H, 16), mat(len / 2, 0, 0));
    p.add(b.brass, dome(0.2, 0.6, 12), mat(len / 2, H / 2, 0));
    for (const dx of [-len / 2 + 0.25, -len / 2 + 0.6]) for (const e of [-1, 1]) bolt(p, b, mat(dx, 0, e * 0.14, rotX((e * Math.PI) / 2)), 0.05);
    b.obstacle(kin, p.group());
  }
  // the drum
  const drumH = H + 0.5;
  const drum = new Kin({ type: 'cyl', r: R0, hh: drumH / 2 }, Mat.Paint, (t, pos, quat) => {
    QA.setFromAxisAngle(Y, om * t + ph);
    quat.copy(f.q).multiply(QA);
    off.set(0, drumH / 2, 0).applyQuaternion(f.q);
    pos.copy(f.pos).add(off);
  });
  const pd = new Parts();
  pd.add(b.paint({ a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 }), rod(R0, drumH, 32));
  pd.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), band(R0 + 0.02, 0.07), mat(0, drumH / 2 - 0.1, 0));
  pd.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), band(R0 + 0.02, 0.07), mat(0, -drumH / 2 + 0.12, 0));
  pd.add(capM, dome(R0, 0.45, 28), mat(0, drumH / 2, 0));
  boltRing(pd, b, mat(0, drumH / 2 + R0 * 0.3, 0), R0 * 0.55, 6, 0.06);
  b.obstacle(drum, pd.group());
}

/**
 * A bed of rollers across the track from s0 to s1 (the path should have `deck: false` there): the
 * tops run along the track at `speed` m/s (negative: a conveyor running back up at you). One
 * instanced mesh for the lot.
 */
export function rollers(b: CourseBuilder, path: Path, s0: number, s1: number, o: { speed: number; r?: number; pitch?: number; colors?: [number, number]; half?: number }) {
  const r = o.r ?? 0.3;
  // (a whole number of rollers end to end: no gap at either end of the bed)
  const n = Math.max(1, Math.round((s1 - s0) / (o.pitch ?? 0.64)));
  const pitch = (s1 - s0) / n;
  const kins: Kin[] = [];
  const base: { pos: THREE.Vector3; q: THREE.Quaternion }[] = [];
  const om = o.speed / r;
  for (let k = 0; k < n; k++) {
    const s = s0 + (k + 0.5) * pitch;
    const f = frameAt(path, s);
    // the axis across the track: local y turned onto local x
    const q = f.q.clone().multiply(rotZ(Math.PI / 2));
    const pos = path.at(s, 0, -0.12);
    const hh = o.half ?? path.sec[path.index(s0)].w / 2 - 0.55;
    const kin = new Kin({ type: 'cyl', r, hh }, Mat.Paint, (t, p, qq) => {
      QA.setFromAxisAngle(Y, -om * t + k * 0.7);
      qq.copy(q).multiply(QA);
      p.copy(pos);
    });
    b.world.addKin(kin);
    kins.push(kin);
    base.push({ pos, q });
  }
  // one instanced roller (the bed is one width)
  const hh0 = (kins[0].shape as { hh: number }).hh;
  const g = rod(r, hh0 * 2, 20, true);
  const m = b.paint({ a: o.colors?.[0] ?? PAINT.yellow, b: o.colors?.[1] ?? PAINT.black, pattern: Pattern.Stripes, scale: 3.2, wear: 0.04 });
  const im = new THREE.InstancedMesh(g, m, n);
  im.castShadow = im.receiveShadow = true;
  const M = new THREE.Matrix4(), S = new THREE.Vector3(1, 1, 1);
  const sync = () => {
    for (let k = 0; k < n; k++) {
      const kin = kins[k];
      M.compose(kin.pos, kin.quat, S);
      im.setMatrixAt(k, M);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  sync();
  im.computeBoundingSphere();
  b.group.add(im);
  b.animators.push(sync);
  // the machine bed under them: a dark board, and brass bearing caps along both fillets
  const p = new Parts();
  for (let k = 0; k < n; k += 1) {
    const s = s0 + (k + 0.5) * pitch;
    const f = frameAt(path, s);
    const w = f.sec.w / 2 - 0.5;
    for (const side of [-1, 1]) {
      const at = new THREE.Matrix4().compose(path.at(s, side * w, -0.12), f.q.clone().multiply(rotZ((side * Math.PI) / 2)), new THREE.Vector3(1, 1, 1));
      p.add(b.brass, rod(0.12, 0.12, 10), at);
    }
  }
  p.toBatch(b, new THREE.Matrix4());
  return kins;
}

/**
 * Pinball flippers at s: a pair hinged just inside the walls, resting angled back along the track
 * (out of the way) and snapping across on their beat to bat marbles back up the course. They
 * glow just before they fire.
 */
export function flippers(b: CourseBuilder, path: Path, s: number, o: { period?: number; phase?: number; len?: number; alternate?: boolean } = {}) {
  const f = frameAt(path, s);
  const hw = f.sec.w / 2 - 0.35;
  const len = o.len ?? Math.min(3.4, hw - 0.8);
  const per = o.period ?? 2.6, ph = o.phase ?? 0;
  const REST = 1.05, FIRE = 0.12, H = 0.42;
  const out: Kin[] = [];
  for (const side of [-1, 1]) {
    const hinge = path.at(s, side * hw, 0);
    const off = new THREE.Vector3();
    const local = side > 0 ? 0 : per / 2;
    const ang = (t: number) => {
      // rest – snap across (0.14 s) – hold – ease back
      const x = (((t + ph + (o.alternate === false ? 0 : local)) % per) + per) % per;
      const k = x < 0.14 ? x / 0.14 : x < 0.45 ? 1 : x < 1.0 ? 1 - (x - 0.45) / 0.55 : 0;
      const e = x < 0.14 ? k : k * k * (3 - 2 * k);
      return REST + (FIRE - REST) * e;
    };
    // local frame: x = left; a flipper on the right (side +1) points left (−x... toward the centre)
    const kin = new Kin({ type: 'box', hx: len / 2, hy: H, hz: 0.22 }, Mat.Bumper, (t, pos, quat) => {
      // angle measured from pointing straight across, swung back (−z) by `ang`
      const a = ang(t);
      QA.setFromAxisAngle(Y, side * -a);
      quat.copy(f.q).multiply(QA);
      off.set(side * (len / 2), H, 0).applyQuaternion(quat);
      pos.copy(hinge).add(off);
    });
    kin.kick = 2;
    const p = new Parts();
    // a tapered white flipper with a red rubber edge and a brass pivot
    const shape = new THREE.Shape();
    const w0 = 0.3, w1 = 0.14;
    shape.moveTo(-len / 2, -w0);
    shape.lineTo(len / 2, -w1);
    shape.absarc(len / 2, 0, w1, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-len / 2, w0);
    shape.absarc(-len / 2, 0, w0, Math.PI / 2, (Math.PI * 3) / 2, false);
    const g = new THREE.ExtrudeGeometry(shape, { depth: H * 2 - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -(H * 2 - 0.12) / 2);
    g.rotateX(Math.PI / 2);
    if (side > 0) g.rotateY(Math.PI);
    const fm = paintMaterial({ a: PAINT.white, b: PAINT.red, pattern: Pattern.Rings, scale: 0.7, wear: 0.02 });
    p.add(fm, g);
    const rub = band(1, 0.06, 24);
    rub.scale(len / 2 + 0.2, 1, 0.42);
    p.add(b.paint({ a: PAINT.red, b: PAINT.red, pattern: Pattern.Solid, wear: 0 }), rub, mat(0, 0, 0));
    p.add(b.brass, dome(0.2, 0.7, 12), mat(-side * (len / 2), H, 0));
    const vis = p.group();
    // the glow before it fires
    const flash = { value: 0 };
    fm.userData.u.uFlash = flash;
    b.animators.push((t) => {
      const x = (((t + ph + (o.alternate === false ? 0 : local)) % per) + per) % per;
      flash.value = x > per - 0.35 ? (x - (per - 0.35)) / 0.35 * 0.8 : x < 0.2 ? 0.8 : 0;
    });
    b.obstacle(kin, vis);
    out.push(kin);
    // the post it pivots on
    const pp = new Parts();
    post(pp, b, mat(), H * 2 + 0.25, { w: 0.34, paint: b.paint({ a: PAINT.black, b: PAINT.black, pattern: Pattern.Solid }) });
    pp.toBatch(b, new THREE.Matrix4().compose(path.at(s, side * (hw + 0.05), 0), f.q, new THREE.Vector3(1, 1, 1)));
  }
  return out;
}
