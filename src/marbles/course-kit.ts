import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, fixWinding, type Sect } from './builder.ts';
import { arch, floorStripe, frameQuat, signTexture, turntable } from './obstacles.ts';
import { Kin, Mat } from './physics.ts';
import { Pattern, woodAttr } from './shaders.ts';
import { Parts, bolt, dome, frameAt, mat, plank } from './obs-kit.ts';
import type { Course } from './courses.ts';

/**
 * What every race course shares: the grid behind the start gate, the finish line and its arch, the
 * catch pen past the line, checkpoints, the split (two lanes round a gap: a narrow, wall-less
 * shortcut and a safe walled way with things in it), and the Course record itself.
 */

export function raceGrid(path: Path, gateS: number) {
  return (n: number) => {
    const out: { pos: THREE.Vector3; yaw: number }[] = [];
    const across = 7, dr = 1.6;
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / across), col = k % across;
      const lat = (col - (across - 1) / 2) * dr + (row % 2 ? 0.4 : -0.4);
      const s = gateS - 1.1 - row * dr;
      const i = path.index(s);
      out.push({ pos: path.at(s, lat, 0.52), yaw: Math.atan2(path.T[i].x, path.T[i].z) });
    }
    return out;
  };
}

export function finishDressing(b: CourseBuilder, path: Path, fs: number) {
  floorStripe(b, path, fs, 1.4, { a: PAINT.white, b: PAINT.black, pattern: Pattern.Checks, scale: 1.4, wear: 0.03 });
  arch(b, path, fs, 'FINISH', { color: PAINT.red });
}

export function lakeBelow(path: Path) {
  let lo = Infinity;
  for (const p of path.P) lo = Math.min(lo, p.y);
  return lo - 30;
}

export function introOf(path: Path) {
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s < path.length; s += 6) pts.push(path.at(s, 0, 0));
  return pts;
}

export function tag(path: Path, t: string) {
  const r = path.tags.get(t);
  if (!r) throw new Error('no tag ' + t);
  return r;
}

/** a padded wall at the end of the catch area */
export function endWall(b: CourseBuilder, path: Path, s: number) {
  const i = path.index(s);
  const sec = path.sec[i];
  const q = frameQuat(path, s);
  const k = new Kin({ type: 'box', hx: sec.w / 2 + 0.3, hy: 1.2, hz: 0.3 }, Mat.Felt);
  k.pos.copy(path.at(s, 0, 1.0));
  k.quat.copy(q);
  const p = new Parts();
  p.add(b.paint({ a: PAINT.blue, b: PAINT.white, pattern: Pattern.Dots, scale: 1.4 }), plank(sec.w + 0.6, 2.4, 0.6, 0.12, 'x', 9));
  p.add(b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid }), plank(sec.w + 0.8, 0.2, 0.7, 0.06, 'x'), mat(0, 1.2, 0));
  b.fixed(k, p, false);
}

export function makeCrown() {
  const g = new THREE.Group();
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc534, metalness: 1, roughness: 0.22, clearcoat: 0.6 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.75, 0.55, 40, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  const gems = [0xff2244, 0x2266ff, 0x22cc66];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 12), gold);
    spike.position.set(Math.cos(a) * 0.8, 0.55, Math.sin(a) * 0.8);
    g.add(spike);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), gold);
    ball.position.set(Math.cos(a) * 0.8, 0.9, Math.sin(a) * 0.8);
    g.add(ball);
    if (k % 2 === 0) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshPhysicalMaterial({ color: gems[(k / 2) % 3], roughness: 0.05, metalness: 0, transmission: 0, clearcoat: 1, emissive: gems[(k / 2) % 3], emissiveIntensity: 0.4 }));
      gem.position.set(Math.cos(a) * 0.84, 0.0, Math.sin(a) * 0.84);
      g.add(gem);
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.userData.spin = true;
  return g;
}

/**
 * A split over the path's open stretch s0..s1 (the path has `floor: false` and its full width
 * there): a narrow, wall-less `fast` lane on one side and a walled `safe` lane on the other, a
 * painted wedge at the fork that sends you one way or the other, and ghost hazards over the drop
 * between them (and beyond the beam) so the bots pick a lane, not the gap.
 */
export function split(b: CourseBuilder, path: Path, s0: number, s1: number, o: { fastLat: number; fastW: number; safeLat: number; safeW: number; safeWall?: number; color?: number; fastChute?: boolean; fastSect?: (s: number) => Partial<Sect> }) {
  const fast = Path.lane(path, s0, s1, () => o.fastLat, (s): Partial<Sect> => ({ w: o.fastW, wallL: 0, wallR: 0, ...o.fastSect?.(s - path.index(s0) * 0.25) }));
  const sw = o.safeWall ?? 1.4;
  const safe = Path.lane(path, s0, s1, () => o.safeLat, (): Partial<Sect> => ({ w: o.safeW, wallL: sw, wallR: sw }));
  // (the fast way can be something else: a plank that rocks)
  if (o.fastChute !== false) b.chute(fast);
  b.chute(safe);
  const i0 = path.index(s0);
  // lane coordinates: s on a lane = s on the path − off
  const off = i0 * 0.25;
  // the gap between the lanes (lat range)
  const dir = Math.sign(o.safeLat - o.fastLat);
  const fastIn = o.fastLat + dir * (o.fastW / 2 + 0.32);
  const safeIn = o.safeLat - dir * (o.safeW / 2 + 0.32);
  const gMid = (fastIn + safeIn) / 2, gW = Math.abs(safeIn - fastIn);
  // (the ghosts hug the fast lane's edges: the bots keep to its middle)
  const gIn = o.fastLat + dir * (o.fastW / 2 + 0.05);
  const gMid2 = (gIn + safeIn) / 2, gW2 = Math.abs(safeIn - gIn);
  // the wedge at the fork: a painted prism with its nose upstream
  const nose = 5;
  {
    const pos: number[] = [];
    const H = 1.3;
    const pts = [path.at(s0 - nose, gMid, 0), path.at(s0 + 0.3, fastIn, 0), path.at(s0 + 0.3, safeIn, 0)];
    const up = path.U[path.index(s0)];
    const top = pts.map((p) => p.clone().addScaledVector(up, H));
    const quad = (a: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, e: THREE.Vector3) => pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, a.x, a.y, a.z, d.x, d.y, d.z, e.x, e.y, e.z);
    // the two sloping faces and the top
    quad(pts[0], pts[1], top[1], top[0]);
    quad(pts[2], pts[0], top[0], top[2]);
    pos.push(top[0].x, top[0].y, top[0].z, top[1].x, top[1].y, top[1].z, top[2].x, top[2].y, top[2].z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // (normals outward: from the centroid)
    const c = pts[0].clone().add(pts[1]).add(pts[2]).divideScalar(3).addScaledVector(up, H / 2);
    const nr = g.getAttribute('normal'), pp = g.getAttribute('position');
    for (let k = 0; k < pp.count; k += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pp, k), bb = new THREE.Vector3().fromBufferAttribute(pp, k + 1), cc = new THREE.Vector3().fromBufferAttribute(pp, k + 2);
      const n = bb.clone().sub(a).cross(cc.clone().sub(a)).normalize();
      const mid = a.clone().add(bb).add(cc).divideScalar(3);
      if (n.dot(mid.sub(c)) < 0) n.negate();
      for (let j = 0; j < 3; j++) nr.setXYZ(k + j, n.x, n.y, n.z);
    }
    fixWinding(g);
    const wd: number[] = [];
    for (let k = 0; k < pp.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pp, k);
      const pr = path.project(v, i0, 40);
      wd.push(pr.s, pr.lat + pr.h, 0);
    }
    g.setAttribute('aWood', new THREE.Float32BufferAttribute(wd, 3));
    b.solid(g, b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.3, wear: 0.06 }), Mat.Paint);
    // a post and a sign on the nose: which way is the shortcut
    const f = frameAt(path, s0 - nose + 0.4, gMid);
    const sp = new Parts();
    sp.add(b.railWood, plank(0.22, 3.4, 0.22, 0.04, 'y'), mat(0, 1.7, 0));
    sp.add(b.brass, dome(0.16, 0.8, 10), mat(0, 3.4, 0));
    sp.toBatch(b, f.m);
    const fastLeft = o.fastLat < o.safeLat;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshPhysicalMaterial({ map: signTexture(fastLeft ? '◀ SHORTCUT' : 'SHORTCUT ▶', undefined, PAINT.red), roughness: 0.4, clearcoat: 0.8 }));
    const board = new THREE.Mesh(woodAttr(new THREE.BoxGeometry(3.8, 1.05, 0.12), 'x'), b.railWood);
    const sg = new THREE.Group();
    sg.add(board);
    sign.position.z = -0.07;
    sign.rotation.y = Math.PI;
    sg.add(sign);
    const bp = new Parts();
    for (const dx of [-1.6, 1.6]) bolt(bp, b, mat(dx, 0, -0.07, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)), 0.05);
    sg.add(bp.group());
    sg.position.copy(f.pos).addScaledVector(f.U, 2.9);
    sg.quaternion.copy(f.q);
    sg.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    b.group.add(sg);
  }
  // deflectors from the chute's walls in to the lanes' outer edges (nothing rides the wall off the end)
  {
    const W = path.sec[path.index(s0 - 8)].w / 2;
    const fastOut = o.fastLat - dir * (o.fastW / 2 - 0.1);
    const safeOut = o.safeLat + dir * (o.safeW / 2 + 0.3);
    for (const [from, to] of [[-dir * (W - 0.25), fastOut], [dir * (W - 0.25), safeOut]]) {
      const a = path.at(s0 - 8, from, 0), c = path.at(s0 + 0.3, to, 0);
      const len = a.distanceTo(c);
      const f = frameAt(path, s0 - 4);
      const H = 1.2;
      const mid = a.clone().add(c).multiplyScalar(0.5).addScaledVector(f.U, H / 2);
      // (turned in the floor's plane by the angle it cuts across)
      const ang = Math.atan2(to - from, 8.3);
      const q = f.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang));
      const k = new Kin({ type: 'box', hx: 0.16, hy: H / 2, hz: len / 2 }, Mat.Wood);
      k.pos.copy(mid);
      k.quat.copy(q);
      const p = new Parts();
      p.add(b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.3, wear: 0.06 }), plank(0.32, H, len, 0.06, 'z'));
      p.add(b.railWood, plank(0.42, 0.14, len + 0.1, 0.04, 'z'), mat(0, H / 2, 0));
      b.fixed(k, p, false);
    }
  }
  // ghosts: over the drop between the lanes, and out beyond the fast lane's open edge
  const outer = o.fastLat - dir * (o.fastW / 2 + 0.05 + 2);
  for (let s = s0 - nose; s < s1; s += 6) {
    const se = Math.min(s + 6, s1);
    const f = frameAt(path, (s + se) / 2);
    if (s < s0) b.ghost({ type: 'box', hx: gW / 2 - 0.1, hy: 1, hz: (se - s) / 2 }, null, path.at((s + se) / 2, gMid, 0.6), f.q);
    else b.ghost({ type: 'box', hx: gW2 / 2, hy: 1, hz: (se - s) / 2 }, null, path.at((s + se) / 2, gMid2, 0.6), f.q);
    b.ghost({ type: 'box', hx: 2, hy: 1, hz: (se - s) / 2 }, null, path.at((s + se) / 2, outer, 0.6), f.q);
  }
  b.splits.push({ s0, s1, fast: o.fastLat, safe: o.safeLat });
  return { fast, safe, off };
}

/**
 * A turntable filling the path's open stretch t0..t1 (17 m long, 17.4 wide): the disc, its fins,
 * guard walls along both sides, and maple plates in the four corners round the disc so nothing
 * drops between the disc and the square hole it sits in.
 */
export function turntableGap(b: CourseBuilder, path: Path, t0: number, t1: number, o: { omega: number; fins: number; r?: number }) {
  const tc = (t0 + t1) / 2;
  const ti = path.index(tc);
  const tq = frameQuat(path, tc);
  const r = o.r ?? 8.35;
  turntable(b, path.P[ti].clone(), tq, { r, omega: o.omega, fins: o.fins });
  const hl = (t1 - t0) / 2, hw = 8.72;
  for (const side of [-1, 1]) {
    const k = new Kin({ type: 'box', hx: 0.18, hy: 0.8, hz: hl + 0.3 }, Mat.Wood);
    k.pos.copy(path.at(tc, side * 8.9, 0.5));
    k.quat.copy(tq);
    const p = new Parts();
    p.add(b.railWood, plank(0.36, 1.6, hl * 2 + 0.6, 0.06, 'z', side));
    p.add(b.brass, dome(0.2, 0.7, 10), mat(0, 0.8, -hl - 0.3));
    p.add(b.brass, dome(0.2, 0.7, 10), mat(0, 0.8, hl + 0.3));
    b.fixed(k, p, false);
  }
  // the corner plates: the rectangle with the disc cut out of it
  // (a little under the chute's floor at both ends: no crack where they meet)
  const shape = new THREE.Shape([new THREE.Vector2(-hw, -hl - 0.4), new THREE.Vector2(hw, -hl - 0.4), new THREE.Vector2(hw, hl + 0.4), new THREE.Vector2(-hw, hl + 0.4)]);
  const hole = new THREE.Path();
  hole.absarc(0, 0, r + 0.04, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 48);
  // (shape x = across, y = along) → frame x (left), z (along), on the floor, facing up
  g.rotateX(-Math.PI / 2);
  const pp = g.getAttribute('position');
  const wd = new Float32Array(pp.count * 3);
  for (let k = 0; k < pp.count; k++) {
    wd[k * 3] = tc + pp.getZ(k);
    wd[k * 3 + 1] = pp.getX(k);
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(wd, 3));
  g.applyQuaternion(tq);
  const c = path.at(tc, 0, -0.012);
  g.translate(c.x, c.y, c.z);
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const up = path.U[ti];
  for (let k = 0; k < n.count; k++) n.setXYZ(k, up.x, up.y, up.z);
  b.solid(g, b.floorWood, Mat.Wood);
}

/** checkpoints at the given s (a respawn there must be safe: never in a jump, on a beam, by a hammer) */
export function checkpoints(gateS: number, list: number[]) {
  return [gateS - 3, ...list.sort((a, b) => a - b)];
}

/** the common race record */
export function raceRecord(b: CourseBuilder, path: Path, o: { id: string; name: string; kind: 'race' | 'final'; blurb: string; gateS: number; finishS: number; gaps: [number, number][]; checkpoints: number[]; state: { go: number }; crown?: THREE.Object3D }): Course {
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    blurb: o.blurb,
    b,
    path,
    finishS: o.finishS,
    gaps: o.gaps,
    checkpoints: o.checkpoints,
    killY: b.lakeY + 4,
    lakeY: b.lakeY,
    state: o.state,
    grid: raceGrid(path, o.gateS),
    crown: o.crown,
    intro: introOf(path),
  };
}
