import * as THREE from 'three';
import { CourseBuilder, PAINT, cylAttr, flatAttr } from './builder.ts';
import { signTexture, sweeper } from './obstacles.ts';
import { Kin, Mat } from './physics.ts';
import { paintMaterial, Pattern, woodAttr } from './shaders.ts';
import { Parts, band, boltRing, dome, mat, plank, post, rod } from './obs-kit.ts';
import type { Course } from './courses.ts';

/**
 * Round 3, Jump Club: a painted plate with two bars turning over it. Hop the low one; never hop
 * into the high one. It gets worse: the bars speed up all round, the high bar rises out of the
 * plate at 15 s, the outer ring of the plate flashes and crumbles away at 35 s, the bars stop and
 * turn back the other way at 55 s, the next ring goes at 70 s, and they turn again at 85 s.
 */

/** the schedule (seconds after GO) */
export const JUMP_CLUB = { highAt: 15, ring1: 35, reverse1: 55, ring2: 70, reverse2: 85 };

export function jumpclub(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 120, 0);
  const RAD = 13, R1 = 11, R0 = 9.4;
  b.lakeY = center.y - 34;
  const state = { go: 1e9 };
  const tau = (t: number) => Math.max(0, t - state.go);
  const TH = 1.0;
  const plateM = b.paint({ a: PAINT.yellow, b: PAINT.orange, pattern: Pattern.Spiral, scale: 0.36, wear: 0.08 });
  // the solid middle of the plate: a painted top on a thick wooden drum
  const top = flatAttr(new THREE.CircleGeometry(R0, 80).rotateX(-Math.PI / 2));
  top.translate(center.x, center.y, center.z);
  b.solid(top, plateM, Mat.Paint);
  const side = woodAttr(new THREE.CylinderGeometry(R0, R0 * 0.96, TH, 80, 1, true), 'y');
  side.translate(center.x, center.y - TH / 2, center.z);
  b.solid(side, b.railWood, Mat.Wood);
  const under = flatAttr(new THREE.CircleGeometry(R0 * 0.96, 64).rotateX(Math.PI / 2));
  under.translate(center.x, center.y - TH, center.z);
  b.batch.add(b.railWood, under);
  // the pedestal under it, down into the lake, with brass bands
  const pedH = center.y - b.lakeY;
  const ped = woodAttr(new THREE.CylinderGeometry(3.2, 4.5, pedH, 24, 1, true), 'y');
  ped.translate(center.x, (center.y + b.lakeY) / 2 - TH, center.z);
  b.batch.add(b.postWood, ped);
  {
    const p = new Parts();
    for (let y = -TH - 3; y > -pedH + 4; y -= 6) {
      const r = 3.2 + ((-y - TH) / pedH) * 1.3;
      p.add(b.brass, band(r + 0.04, 0.12, 40), mat(0, y, 0));
    }
    // the bracket ring under the plate
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      p.add(b.darkWood, plank(0.3, 0.3, R0 - 3.4, 0.05, 'z'), mat(Math.cos(a) * (R0 / 2 + 1.3), -TH - 0.6, Math.sin(a) * (R0 / 2 + 1.3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2)));
    }
    p.toBatch(b, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
  }

  // the two rings that crumble: segments (box colliders under true annular-sector tops)
  const ringSegs = (r0: number, r1: number, n: number, at: number, color: number) => {
    const m = paintMaterial({ a: PAINT.yellow, b: color, pattern: Pattern.Spiral, scale: 0.36, wear: 0.08 });
    const flash = { value: 0 };
    m.userData.u.uFlash = flash;
    const rimM = b.railWood;
    // (the warning: a pulsing glow for 3 s, then each segment drops in turn round the ring)
    b.animators.push((t) => {
      const k = tau(t) - (at - 3);
      flash.value = k > 0 && k < 3.6 ? (0.5 + 0.5 * Math.sin(k * (6 + k * 4))) * 0.6 : 0;
    });
    const mid = (r0 + r1) / 2;
    const chord = 2 * r1 * Math.sin(Math.PI / n);
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      const drop = at + (k / n) * 2.4;
      const spin = (k % 2 ? 1 : -1) * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      const axis = new THREE.Vector3(-sa, 0, ca);
      const fall = (t: number) => Math.max(0, tau(t) - drop);
      const kin = new Kin({ type: 'box', hx: (r1 - r0) / 2 + 0.2, hy: TH / 2, hz: chord / 2 }, Mat.Paint, (t, pos, quat) => {
        const f = fall(t);
        const shake = tau(t) > drop - 1 && f === 0 ? Math.sin(t * 60 + k) * 0.03 : 0;
        pos.set(center.x + ca * (mid - 0.2), center.y - TH / 2 - 12 * f * f + shake, center.z + sa * (mid - 0.2));
        if (f > 3) pos.y -= 80;
        quat.setFromAxisAngle(axis, spin * f * f).multiply(base);
      });
      // the visual: the annular sector, its side, modelled about the box centre
      const p = new Parts();
      const a0 = -Math.PI / n, a1 = Math.PI / n;
      const sh = new THREE.Shape();
      sh.absarc(0, 0, r1, a0, a1, false);
      sh.absarc(0, 0, r0, a1, a0, true);
      const tg = new THREE.ShapeGeometry(sh, 10).rotateX(-Math.PI / 2);
      const wd = new Float32Array(tg.getAttribute('position').count * 3);
      const pp = tg.getAttribute('position');
      for (let i = 0; i < pp.count; i++) {
        // (paint coordinates in the plate's frame, so the spiral runs on across the joints)
        const x = pp.getX(i), z = pp.getZ(i);
        wd[i * 3] = x * ca - z * sa;
        wd[i * 3 + 1] = x * sa + z * ca;
      }
      tg.setAttribute('aWood', new THREE.BufferAttribute(wd, 3));
      tg.translate(-(mid - 0.2), TH / 2, 0);
      p.add(m, tg);
      const rim = woodAttr(new THREE.CylinderGeometry(r1, r1 * 0.97, TH, 10, 1, true, Math.PI / 2 - a1, a1 - a0), 'y', k);
      rim.translate(-(mid - 0.2), 0, 0);
      p.add(rimM, rim);
      // the score line between segments (a dark joint)
      p.add(b.darkWood, plank(r1 - r0, 0.04, 0.06, 0.01, 'x'), mat((r0 + r1) / 2 - (mid - 0.2), TH / 2 + 0.005, chord / 2 - 0.03));
      b.obstacle(kin, p.group(), false);
    }
  };
  ringSegs(R0, R1, 20, JUMP_CLUB.ring2, PAINT.red);
  ringSegs(R1, RAD, 24, JUMP_CLUB.ring1, PAINT.red);
  // a ring of white paint at the plate's edge (the danger line) and one at each ring's inner edge
  for (const [r, w] of [[R0, 0.18]] as const) {
    const ring = flatAttr(new THREE.RingGeometry(r - w, r, 96).rotateX(-Math.PI / 2));
    ring.translate(center.x, center.y + 0.01, center.z);
    const rmesh = new THREE.Mesh(ring, b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid, wear: 0.05 }));
    rmesh.receiveShadow = true;
    b.group.add(rmesh);
  }

  // the bars' speed: ω = 0.5 + 0.0055·τ, turning back at the two reversals (smoothly, over 2 s)
  const N = 12000, DT = 0.025;
  const table = new Float32Array(N + 1);
  {
    let a = 0;
    const dir = (x: number) => {
      const r = (c: number) => THREE.MathUtils.smoothstep(x, c, c + 2) * 2;
      return 1 - r(JUMP_CLUB.reverse1) + r(JUMP_CLUB.reverse2);
    };
    for (let i = 0; i <= N; i++) {
      table[i] = a;
      const x = i * DT;
      a += dir(x) * (0.5 + 0.0055 * x) * DT;
    }
  }
  const spun = (x: number) => {
    const f = Math.min(N - 1, x / DT);
    const i = Math.floor(f);
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
  const lowA = (t: number) => spun(tau(t));
  const highA = (t: number) => Math.PI / 2 + spun(tau(t));
  const highH = (t: number) => {
    const k = THREE.MathUtils.clamp((tau(t) - JUMP_CLUB.highAt) / 2.5, 0, 1);
    return -2.6 + (2.05 + 2.6) * k * k * (3 - 2 * k);
  };
  const low = sweeper(b, center.clone(), new THREE.Quaternion(), { len: RAD * 2 + 1.6, r: 0.36, height: 0.56, angle: lowA, paint: { a: PAINT.blue, b: PAINT.white, pattern: Pattern.Rings, scale: 1.2 }, hub: 0.01 });
  const high = sweeper(b, center.clone(), new THREE.Quaternion(), { len: RAD * 2 + 1.6, r: 0.36, height: 2.05, heightAt: highH, angle: highA, paint: { a: PAINT.red, b: PAINT.white, pattern: Pattern.Rings, scale: 1.2 }, hub: 0.01 });
  // the hub (the bars' posts hide inside it)
  const hubH = 1.6;
  const hub = new Kin({ type: 'cyl', r: 1.15, hh: hubH / 2 }, Mat.Paint);
  hub.pos.copy(center).add(new THREE.Vector3(0, hubH / 2, 0));
  {
    const p = new Parts();
    p.add(b.paint({ a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.8 }), cylAttr(new THREE.CylinderGeometry(1.15, 1.25, hubH, 40)));
    p.add(b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }), dome(1.15, 0.9, 32), mat(0, hubH / 2, 0));
    p.add(b.brass, band(1.2, 0.07, 40), mat(0, -hubH / 2 + 0.1, 0));
    boltRing(p, b, mat(0, hubH / 2 + 0.75, 0), 0.6, 8, 0.06);
    p.add(b.brass, dome(0.3, 0.8, 14), mat(0, hubH / 2 + 1.0, 0));
    b.fixed(hub, p, false);
  }

  // the sign, on two posts behind the plate, and bunting poles round it
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshPhysicalMaterial({ map: signTexture(info.name.toUpperCase(), 'Round 3 · Survival', PAINT.blue), roughness: 0.4, clearcoat: 0.8 }));
  sign.position.set(center.x, center.y + 7.5, center.z - RAD - 3);
  b.group.add(sign);
  {
    const p = new Parts();
    p.add(b.railWood, plank(9.4, 2.0, 0.3, 0.08, 'x'), mat(0, 7.5, -0.18));
    for (const sx of [-4.2, 4.2]) post(p, b, mat(sx, -4.5, -0.3), 13.2, { w: 0.42 });
    p.toBatch(b, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z - RAD - 3));
  }
  // posts with flags on a ring of little islands round the plate (the scenery)
  {
    const p = new Parts();
    const cols = [PAINT.red, PAINT.blue, PAINT.green, PAINT.yellow, PAINT.purple, PAINT.orange];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5;
      const x = Math.cos(a) * (RAD + 9), z = Math.sin(a) * (RAD + 9);
      p.add(b.paint({ a: cols[k], b: PAINT.white, pattern: Pattern.Stripes, scale: 1.4 }), rod(1.1, 40, 28), mat(x, -20 - 2, z));
      p.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), dome(1.2, 0.5, 24), mat(x, -2, z));
    }
    p.toBatch(b, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
  }
  b.finish();

  // the plate's edge for the AI: it shrinks as the rings go
  const radiusAt = (t: number) => {
    const x = tau(t);
    return x > JUMP_CLUB.ring2 - 1 ? R0 : x > JUMP_CLUB.ring1 - 1 ? R1 : RAD;
  };
  const plate = {
    center,
    get radius() {
      return radiusAt(b.world.time);
    },
    bars: [
      { angle: lowA, height: 0.56, kin: low, on: () => true },
      { angle: highA, height: 2.05, kin: high, on: (t: number) => highH(t) > 1.6 },
    ],
  };
  return {
    id: 'jumpclub',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 5,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + 0.3;
        const r = 6.2 + (k % 2) * 2.2;
        const pos = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.52, center.z + Math.sin(a) * r);
        out.push({ pos, yaw: Math.atan2(center.x - pos.x, center.z - pos.z) });
      }
      return out;
    },
    plate,
    intro: [],
  };
}
