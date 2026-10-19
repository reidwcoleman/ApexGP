import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, cylAttr, flatAttr, roundBox, fixWinding } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import { paintMaterial, Pattern, SPECIES, woodAttr, type PaintSpec } from './shaders.ts';

/**
 * The painted obstacles. Each is a collider whose pose is a function of time (so the AI can ask
 * where a hammer will be when it gets there) and a visual modelled in the collider's own frame.
 */

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** the frame of the path at s: a quaternion taking local y to the floor's up and local z along the track */
export function frameQuat(path: Path, s: number) {
  const i = path.index(s);
  const m = new THREE.Matrix4().makeBasis(path.Rt[i].clone().negate(), path.U[i], path.T[i]);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function cyl(r: number, h: number, seg = 28, cap = true) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, Math.max(1, Math.round(h / 0.5)), !cap);
  return cylAttr(g);
}

/** a candy-striped peg standing on the floor */
export function peg(b: CourseBuilder, path: Path, s: number, lat: number, o: { r?: number; h?: number; paint?: PaintSpec } = {}) {
  const r = o.r ?? 0.32, h = o.h ?? 1.5;
  const q = frameQuat(path, s);
  const base = path.at(s, lat, 0);
  const kin = new Kin({ type: 'cyl', r, hh: h / 2 }, Mat.Paint);
  kin.pos.copy(base).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), h / 2);
  kin.quat.copy(q);
  const g = new THREE.Group();
  const m = b.paint(o.paint ?? { a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.2 });
  g.add(new THREE.Mesh(cyl(r, h), m));
  const top = new THREE.Mesh(cylAttr(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), m);
  top.position.y = h / 2;
  g.add(top);
  return b.obstacle(kin, g);
}

/** a pinball bumper: kicks a marble away with a ding and a flash */
export function bumper(b: CourseBuilder, path: Path, s: number, lat: number, o: { r?: number; color?: number } = {}) {
  const r = o.r ?? 0.8, h = 0.9;
  const q = frameQuat(path, s);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const kin = new Kin({ type: 'cyl', r, hh: h / 2 }, Mat.Bumper);
  kin.kick = 7.5;
  kin.pos.copy(path.at(s, lat, 0)).addScaledVector(up, h / 2);
  kin.quat.copy(q);
  const g = new THREE.Group();
  const color = o.color ?? PAINT.pink;
  const capM = paintMaterial({ a: color, b: PAINT.white, pattern: Pattern.Rings, scale: 3, wear: 0.02 });
  const ringM = paintMaterial({ a: PAINT.white, b: PAINT.yellow, pattern: Pattern.Solid, wear: 0.0 });
  const baseM = b.paint({ a: PAINT.black, b: PAINT.black, pattern: Pattern.Solid, wear: 0.03 });
  const base = new THREE.Mesh(cyl(r * 0.75, h * 0.6), baseM);
  base.position.y = -h * 0.2;
  g.add(base);
  const top = new THREE.Group();
  const ring = new THREE.Mesh(cylAttr(new THREE.TorusGeometry(r * 0.92, 0.12, 12, 36).rotateX(Math.PI / 2)), ringM);
  ring.position.y = 0.05;
  top.add(ring);
  const cap = new THREE.Mesh(cylAttr(new THREE.SphereGeometry(r * 0.95, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1)), capM);
  cap.position.y = 0.12;
  top.add(cap);
  top.position.y = h * 0.1;
  g.add(top);
  // (the glow is the cap's and the ring's)
  const flash = { value: 0 };
  capM.userData.u.uFlash = flash;
  ringM.userData.u.uFlash = flash;
  g.userData.flash = flash;
  g.userData.squash = top;
  return b.obstacle(kin, g);
}

/** a sweeper: a striped arm turning about a post; `omega(t)` gives the angle */
export function sweeper(b: CourseBuilder, center: THREE.Vector3, up: THREE.Quaternion, o: { len: number; r?: number; height?: number; heightAt?: (t: number) => number; angle: (t: number) => number; paint?: PaintSpec; hub?: number }) {
  const r = o.r ?? 0.34, ht = o.height ?? 0.55;
  const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(up);
  const pivot = center.clone().addScaledVector(upV, ht);
  const qa = new THREE.Quaternion(), qz = new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2);
  const kin = new Kin({ type: 'cyl', r, hh: o.len / 2 }, Mat.Paint, (t, pos, quat) => {
    if (o.heightAt) pos.copy(center).addScaledVector(upV, o.heightAt(t));
    else pos.copy(pivot);
    qa.setFromAxisAngle(Y, o.angle(t));
    quat.copy(up).multiply(qa).multiply(qz);
  });
  const g = new THREE.Group();
  const m = b.paint(o.paint ?? { a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Rings, scale: 1.4 });
  g.add(new THREE.Mesh(cyl(r, o.len, 24), m));
  for (const e of [-1, 1]) {
    const ball = new THREE.Mesh(cylAttr(new THREE.SphereGeometry(r * 1.25, 20, 12)), b.paint({ a: PAINT.red, b: PAINT.red, pattern: Pattern.Solid }));
    ball.position.y = (e * o.len) / 2;
    g.add(ball);
  }
  b.obstacle(kin, g);
  // the post it turns on
  const hubR = o.hub ?? 0.7;
  const postH = ht + 0.9;
  const post = new Kin({ type: 'cyl', r: hubR, hh: postH / 2 }, Mat.Paint);
  post.pos.copy(center).addScaledVector(upV, postH / 2);
  post.quat.copy(up);
  const pg = new THREE.Group();
  pg.add(new THREE.Mesh(cyl(hubR, postH), b.paint({ a: PAINT.blue, b: PAINT.white, pattern: Pattern.Stripes, scale: 2 })));
  const capM = b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid });
  const capG = new THREE.Mesh(cylAttr(new THREE.SphereGeometry(hubR, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)), capM);
  capG.position.y = postH / 2;
  pg.add(capG);
  b.obstacle(post, pg);
  return kin;
}

/** a hammer swinging across the track from a gantry */
export function hammer(b: CourseBuilder, path: Path, s: number, o: { amp?: number; period?: number; phase?: number; len?: number; color?: number } = {}) {
  const i = path.index(s);
  const R = path.Rt[i], T = path.T[i], U = path.U[i];
  const sec = path.sec[i];
  const L = o.len ?? 6.2;
  const pivot = path.at(s, 0, L + 0.95);
  const amp = o.amp ?? 1.0, w = (Math.PI * 2) / (o.period ?? 2.6), ph = o.phase ?? 0;
  const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, T, U));
  const qs = new THREE.Quaternion();
  const down = U.clone().negate();
  const off = new THREE.Vector3();
  const kin = new Kin({ type: 'cyl', r: 0.95, hh: 0.85 }, Mat.Paint, (t, pos, quat) => {
    const th = amp * Math.sin(w * t + ph);
    qs.setFromAxisAngle(T, th);
    off.copy(down).applyQuaternion(qs).multiplyScalar(L);
    pos.copy(pivot).add(off);
    quat.copy(qs).multiply(base);
  });
  const g = new THREE.Group();
  const col = o.color ?? PAINT.red;
  const head = new THREE.Mesh(cyl(0.95, 1.7, 32), b.paint({ a: col, b: PAINT.white, pattern: Pattern.Rings, scale: 1.6 }));
  g.add(head);
  for (const e of [-1, 1]) {
    const band = new THREE.Mesh(cylAttr(new THREE.TorusGeometry(0.97, 0.07, 10, 32).rotateX(Math.PI / 2)), b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }));
    band.position.y = e * 0.85;
    g.add(band);
  }
  // the handle up to the pivot (local +z points at it)
  const rod = new THREE.Mesh(woodAttr(new THREE.CylinderGeometry(0.16, 0.16, L, 12).rotateX(Math.PI / 2), 'z'), b.railWood);
  rod.position.z = L / 2;
  g.add(rod);
  b.obstacle(kin, g);
  // the gantry: two posts and a beam (static, out of the marbles' way above the walls)
  const hw = sec.w / 2 + 0.5;
  const gantry: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const foot = path.at(s, side * hw, -0.4);
    const top = path.at(s, side * hw, L + 1.3);
    const len = top.distanceTo(foot);
    const pg = woodAttr(new THREE.BoxGeometry(0.4, len, 0.4), 'y', s + side);
    pg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, top.clone().sub(foot).normalize()));
    pg.translate((foot.x + top.x) / 2, (foot.y + top.y) / 2, (foot.z + top.z) / 2);
    gantry.push(pg);
  }
  const beamC = path.at(s, 0, L + 1.25);
  const beam = woodAttr(new THREE.BoxGeometry(hw * 2 + 0.8, 0.45, 0.5), 'x', s);
  beam.applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, T)));
  beam.translate(beamC.x, beamC.y, beamC.z);
  gantry.push(beam);
  for (const gg of gantry) b.batch.add(b.railWood, gg.toNonIndexed());
  return kin;
}

/** a turntable set into the floor, with paddles */
export function turntable(b: CourseBuilder, center: THREE.Vector3, up: THREE.Quaternion, o: { r: number; omega: number; fins?: number; finH?: number }) {
  const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(up);
  const qa = new THREE.Quaternion();
  const TH = 0.3;
  const disk = new Kin({ type: 'cyl', r: o.r, hh: TH }, Mat.Paint, (t, pos, quat) => {
    pos.copy(center).addScaledVector(upV, -TH);
    qa.setFromAxisAngle(Y, o.omega * t);
    quat.copy(up).multiply(qa);
  });
  const g = new THREE.Group();
  const top = new THREE.Mesh(flatAttr(new THREE.CylinderGeometry(o.r, o.r, TH * 2, 64, 1)), b.paint({ a: PAINT.teal, b: PAINT.white, pattern: Pattern.Spiral, scale: 0.55, wear: 0.05 }));
  g.add(top);
  const rim = new THREE.Mesh(cylAttr(new THREE.TorusGeometry(o.r, 0.12, 10, 72).rotateX(Math.PI / 2)), b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }));
  rim.position.y = TH - 0.05;
  g.add(rim);
  b.obstacle(disk, g, false);
  const fins = o.fins ?? 2;
  const fh = o.finH ?? 0.5;
  const qf = new THREE.Quaternion();
  for (let k = 0; k < fins; k++) {
    const a0 = (k / fins) * Math.PI;
    const off = new THREE.Vector3();
    const fin = new Kin({ type: 'box', hx: o.r * 0.82, hy: fh, hz: 0.14 }, Mat.Paint, (t, pos, quat) => {
      qf.setFromAxisAngle(Y, o.omega * t + a0);
      quat.copy(up).multiply(qf);
      off.set(0, fh, 0).applyQuaternion(quat);
      pos.copy(center).add(off);
    });
    const fg = new THREE.Group();
    fg.add(new THREE.Mesh(woodAttr(roundBox(o.r * 1.64, fh * 2, 0.28, 0.08), 'x', k), b.paint({ a: PAINT.purple, b: PAINT.white, pattern: Pattern.Chevron, scale: 1.2 })));
    b.obstacle(fin, fg);
  }
  return disk;
}

/** a block sliding across the track from wall to wall */
export function slider(b: CourseBuilder, path: Path, s: number, o: { period?: number; phase?: number; size?: number; color?: number } = {}) {
  const i = path.index(s);
  const sec = path.sec[i];
  const hw = sec.w / 2;
  const size = o.size ?? 2.4;
  const q = frameQuat(path, s);
  const w = (Math.PI * 2) / (o.period ?? 3.2), ph = o.phase ?? 0;
  const base = path.at(s, 0, 0.75);
  const R = path.Rt[i].clone();
  const travel = hw - size / 2 - 0.05;
  const kin = new Kin({ type: 'box', hx: size / 2, hy: 0.75, hz: 0.9 }, Mat.Paint, (t, pos, quat) => {
    pos.copy(base).addScaledVector(R, travel * Math.sin(w * t + ph));
    quat.copy(q);
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(woodAttr(roundBox(size, 1.5, 1.8, 0.14), 'x', s), b.paint({ a: o.color ?? PAINT.orange, b: PAINT.white, pattern: Pattern.Dots, scale: 2.2 })));
  return b.obstacle(kin, g);
}

/** a wall of doors that rise and fall, each on its own beat */
export function doorWall(b: CourseBuilder, path: Path, s: number, o: { doors?: number; seed?: number } = {}) {
  const i = path.index(s);
  const sec = path.sec[i];
  const n = o.doors ?? 5;
  const q = frameQuat(path, s);
  const upV = path.U[i].clone();
  const dw = sec.w / n;
  const H = 1.25;
  let seed = o.seed ?? 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cols = [PAINT.red, PAINT.blue, PAINT.yellow, PAINT.green, PAINT.purple, PAINT.orange];
  for (let k = 0; k < n; k++) {
    const lat = -sec.w / 2 + dw * (k + 0.5);
    const base = path.at(s, lat, H);
    const period = 2.2 + rnd() * 1.8, ph = rnd() * period;
    const kin = new Kin({ type: 'box', hx: dw / 2 - 0.08, hy: H, hz: 0.22 }, Mat.Paint, (t, pos, quat) => {
      // a smooth open–hold–close–hold cycle
      const x = ((t + ph) % period) / period;
      const open = x < 0.12 ? x / 0.12 : x < 0.5 ? 1 : x < 0.62 ? 1 - (x - 0.5) / 0.12 : 0;
      const e = open * open * (3 - 2 * open);
      pos.copy(base).addScaledVector(upV, -e * (H * 2 + 0.1));
      quat.copy(q);
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(woodAttr(roundBox(dw - 0.16, H * 2, 0.44, 0.1), 'y', k), b.paint({ a: cols[k % cols.length], b: PAINT.white, pattern: Pattern.Checks, scale: 1.5 })));
    b.obstacle(kin, g);
  }
  // the lintel over them
  const lc = path.at(s, 0, H * 2 + 0.6);
  const beam = woodAttr(new THREE.BoxGeometry(sec.w + 1.2, 0.5, 0.6), 'x', s);
  beam.applyQuaternion(q);
  beam.translate(lc.x, lc.y, lc.z);
  b.batch.add(b.railWood, beam.toNonIndexed());
  for (const side of [-1, 1]) {
    const foot = path.at(s, side * (sec.w / 2 + 0.45), -0.4);
    const pg = woodAttr(new THREE.BoxGeometry(0.45, H * 2 + 1.3, 0.6), 'y', side);
    pg.applyQuaternion(q);
    pg.translate(foot.x + upV.x * (H + 0.65), foot.y + upV.y * (H + 0.65), foot.z + upV.z * (H + 0.65));
    b.batch.add(b.railWood, pg.toNonIndexed());
  }
}

/** the start gate: a bar across the grid that drops into the floor at GO */
export function startGate(b: CourseBuilder, path: Path, s: number, state: { go: number }) {
  const i = path.index(s);
  const sec = path.sec[i];
  const q = frameQuat(path, s);
  const upV = path.U[i].clone();
  const base = path.at(s, 0, 0.6);
  const kin = new Kin({ type: 'box', hx: sec.w / 2, hy: 0.6, hz: 0.18 }, Mat.Paint, (t, pos, quat) => {
    const k = THREE.MathUtils.clamp((t - state.go) / 0.35, 0, 1);
    pos.copy(base).addScaledVector(upV, -k * 1.5);
    quat.copy(q);
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(woodAttr(roundBox(sec.w, 1.2, 0.36, 0.1), 'x', 3), b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.4, wear: 0.04 })));
  b.obstacle(kin, g, false);
  return kin;
}

/** a launch ramp across the track ending at s (painted chevrons) */
export function kicker(b: CourseBuilder, path: Path, s: number, o: { len?: number; h?: number } = {}) {
  const len = o.len ?? 4.5, h = o.h ?? 1.0;
  const i = path.index(s - len);
  const sec = path.sec[path.index(s)];
  const hw = sec.w / 2 - 0.02;
  const pos: number[] = [], nor: number[] = [];
  const P = (ss: number, x: number, y: number) => path.at(ss, x, y);
  // sloped top as strips along s (follows the chute's own curve), the back face, the sides
  const N = 10;
  const tops: THREE.Vector3[][] = [];
  for (let k = 0; k <= N; k++) {
    const f = k / N;
    const ss = s - len + f * len;
    const y = h * f * f * 0.6 + h * f * 0.4;
    tops.push([P(ss, -hw, y), P(ss, hw, y)]);
  }
  const tri = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3) => {
    pos.push(a.x, a.y, a.z, b2.x, b2.y, b2.z, c.x, c.y, c.z);
    const n = b2.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (let k = 0; k < 3; k++) nor.push(n.x, n.y, n.z);
  };
  for (let k = 0; k < N; k++) {
    const [a, bb] = tops[k], [c, d] = tops[k + 1];
    tri(a, c, bb);
    tri(bb, c, d);
  }
  const [ea, eb] = tops[N];
  const fa = P(s, -hw, 0), fb = P(s, hw, 0);
  tri(ea, fa, eb);
  tri(eb, fa, fb);
  for (const side of [-1, 1]) {
    for (let k = 0; k < N; k++) {
      const a = tops[k][side < 0 ? 0 : 1], c = tops[k + 1][side < 0 ? 0 : 1];
      const ss0 = s - len + (k / N) * len, ss1 = s - len + ((k + 1) / N) * len;
      const a0 = P(ss0, side * hw, 0), c0 = P(ss1, side * hw, 0);
      if (side < 0) {
        tri(a, a0, c);
        tri(c, a0, c0);
      } else {
        tri(a, c, a0);
        tri(c, c0, a0);
      }
    }
  }
  void i;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  // paint coordinates: along the track, across
  const wd: number[] = [];
  for (let k = 0; k < pos.length; k += 3) {
    const v = new THREE.Vector3(pos[k], pos[k + 1], pos[k + 2]);
    const pr = path.project(v, path.index(s), 40);
    wd.push(pr.s, pr.lat, pr.h);
  }
  g.setAttribute('aWood', new THREE.Float32BufferAttribute(wd, 3));
  fixWinding(g);
  b.solid(g, b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Chevron, scale: 0.9, wear: 0.06 }), Mat.Paint);
}

/** a painted stripe on the floor (the finish line) */
export function floorStripe(b: CourseBuilder, path: Path, s: number, depth: number, paint: PaintSpec) {
  const i = path.index(s);
  const sec = path.sec[i];
  const g = new THREE.PlaneGeometry(sec.w + 0.2, depth, 1, 1);
  g.rotateX(-Math.PI / 2);
  const a = new Float32Array(g.getAttribute('position').count * 3);
  const p = g.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    a[k * 3] = p.getZ(k) + depth / 2;
    a[k * 3 + 1] = p.getX(k) + sec.w;
    a[k * 3 + 2] = 0;
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  const q = frameQuat(path, s);
  g.applyQuaternion(q);
  const c = path.at(s, 0, 0.012);
  g.translate(c.x, c.y, c.z);
  const m = paintMaterial(paint);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  b.group.add(mesh);
  return mesh;
}

/** an arch over the track with a painted banner (FINISH, or a round's name) */
export function arch(b: CourseBuilder, path: Path, s: number, text: string, o: { color?: number; text2?: string } = {}) {
  const i = path.index(s);
  const sec = path.sec[i];
  const q = frameQuat(path, s);
  const hw = sec.w / 2 + 0.9;
  const H = 6.2;
  const grp = new THREE.Group();
  const pm = b.paint({ a: o.color ?? PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(cyl(0.42, H, 24), pm);
    post.position.set(side * hw, H / 2 - 0.4, 0);
    grp.add(post);
    const ball = new THREE.Mesh(cylAttr(new THREE.SphereGeometry(0.62, 24, 14)), b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }));
    ball.position.set(side * hw, H, 0);
    grp.add(ball);
  }
  // the banner board, its face a canvas sign
  const bw = hw * 2 - 0.2;
  const board = new THREE.Mesh(woodAttr(roundBox(bw, 1.7, 0.3, 0.1), 'x', 5), b.railWood);
  board.position.set(0, H - 0.6, 0);
  grp.add(board);
  const tex = signTexture(text, o.text2, o.color ?? PAINT.red);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.3, 1.45), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.1 }));
  for (const side of [-1, 1]) {
    const f = face.clone();
    f.position.set(0, H - 0.6, side * 0.16);
    if (side < 0) f.rotation.y = Math.PI;
    grp.add(f);
  }
  grp.traverse((o2) => {
    if ((o2 as THREE.Mesh).isMesh) {
      o2.castShadow = true;
      o2.receiveShadow = true;
    }
  });
  grp.quaternion.copy(q);
  grp.position.copy(path.at(s, 0, 0));
  b.group.add(grp);
  // (the posts are solid)
  for (const side of [-1, 1]) {
    const k = new Kin({ type: 'cyl', r: 0.42, hh: H / 2 }, Mat.Paint);
    k.pos.copy(path.at(s, side * hw, H / 2 - 0.4));
    k.quat.copy(q);
    b.world.addKin(k);
  }
  return grp;
}

export function signTexture(text: string, sub: string | undefined, color: number) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const x = c.getContext('2d')!;
  const col = '#' + color.toString(16).padStart(6, '0');
  x.fillStyle = '#f4ecdc';
  x.fillRect(0, 0, c.width, c.height);
  // a checker border
  for (let i = 0; i < 64; i++) {
    x.fillStyle = i % 2 ? '#1d1b22' : '#f4ecdc';
    x.fillRect(i * 16, 0, 16, 14);
    x.fillStyle = i % 2 ? '#f4ecdc' : '#1d1b22';
    x.fillRect(i * 16, c.height - 14, 16, 14);
  }
  x.fillStyle = col;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `${sub ? 96 : 120}px "Lilita One", "Arial Black", sans-serif`;
  x.lineWidth = 10;
  x.strokeStyle = '#1d1b22';
  x.strokeText(text, c.width / 2, sub ? 80 : c.height / 2 + 4);
  x.fillText(text, c.width / 2, sub ? 80 : c.height / 2 + 4);
  if (sub) {
    x.font = '44px "Fredoka", "Arial Rounded MT Bold", sans-serif';
    x.fillStyle = '#1d1b22';
    x.fillText(sub, c.width / 2, 148);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** bunting: little painted flags on a sagging line along both rails */
export function bunting(b: CourseBuilder, path: Path, s0: number, s1: number) {
  const flags: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const pal = [PAINT.red, PAINT.yellow, PAINT.blue, PAINT.green, PAINT.pink, PAINT.orange, PAINT.white];
  const posts: THREE.BufferGeometry[] = [];
  const SPAN = 10;
  let c = 0;
  for (let s = s0; s < s1 - SPAN; s += SPAN) {
    for (const side of [-1, 1]) {
      const ia = path.index(s), ib = path.index(s + SPAN);
      const ha = side < 0 ? path.sec[ia].wallL : path.sec[ia].wallR, hb = side < 0 ? path.sec[ib].wallL : path.sec[ib].wallR;
      if (ha < 0.5 || hb < 0.5) continue;
      const lata = side * (path.sec[ia].w / 2 + 0.16), latb = side * (path.sec[ib].w / 2 + 0.16);
      const A = path.at(s, lata, ha + 1.6), B = path.at(s + SPAN, latb, hb + 1.6);
      // the pole
      const foot = path.at(s, lata, ha);
      const pg = woodAttr(new THREE.CylinderGeometry(0.06, 0.07, 1.7, 8), 'y', s);
      pg.translate(foot.x, foot.y + 0.85, foot.z);
      posts.push(pg.toNonIndexed());
      const n = 9;
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const p = A.clone().lerp(B, f);
        p.y -= Math.sin(f * Math.PI) * 0.55;
        const dir = B.clone().sub(A).normalize();
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, Y);
        m.setPosition(p);
        flags.push(m);
        colors.push(new THREE.Color(pal[c++ % pal.length]));
      }
    }
  }
  if (!flags.length) return;
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute([-0.0, 0, -0.28, 0, 0, 0.28, 0, -0.62, 0], 3));
  fg.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  const fm = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  const im = new THREE.InstancedMesh(fg, fm, flags.length);
  flags.forEach((m, k) => {
    im.setMatrixAt(k, m);
    im.setColorAt(k, colors[k]);
  });
  im.castShadow = true;
  b.group.add(im);
  const line: number[] = [];
  for (let k = 0; k < flags.length; k++) {
    const p = new THREE.Vector3().setFromMatrixPosition(flags[k]);
    if (k % 9 === 8) continue;
    const q2 = new THREE.Vector3().setFromMatrixPosition(flags[k + 1] ?? flags[k]);
    line.push(p.x, p.y, p.z, q2.x, q2.y, q2.z);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  b.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3a2a20 })));
  for (const p of posts) b.batch.add(b.postWood, p);
}

export { SPECIES };
