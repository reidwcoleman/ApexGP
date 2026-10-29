// Builds the arena collision meshes RocketSim loads (its .cmf format, in bullet units = uu / 50), from
// the published measurements in src/boost/sim/arena.ts: the rounded shell (ramps 256, corners cut
// 1152 along each wall and swept into the walls on CORNER_R, the back walls, the ceiling's edge) with the goal mouths cut out exactly, and
// each goal (sim/arena.ts goalSurfaces): the box with its rounded inside edges, the rounded posts and crossbar, what's left of the
// back wall round the mouth's top corners and the faces where the floor's ramp stops either side of it. RocketSim adds its own
// planes for the floor, the ceiling and the side walls.
//   node --experimental-transform-types --no-warnings tools/boost_rsmesh.mjs
import { writeFileSync } from 'node:fs';
import { ARENA, CORNER_R, GOAL_POST_R, goalSurfaces, octCore } from '../src/boost/sim/arena.ts';

const R = ARENA.R;
const Z = ARENA.Z;
// the mouth in the back wall: the goal plus its rounded posts and crossbar
const GW = ARENA.GOAL_W + GOAL_POST_R;
const GH = ARENA.GOAL_H + GOAL_POST_R;

function mesh() {
  const v = [];
  const t = [];
  const key = new Map();
  const vert = (x, y, z) => {
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let i = key.get(k);
    if (i === undefined) {
      i = v.length / 3;
      v.push(x, y, z);
      key.set(k, i);
    }
    return i;
  };
  const tri = (a, b, c) => {
    if (a !== b && b !== c && a !== c) t.push(a, b, c);
  };
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  return { v, t, vert, tri, quad };
}

// ---- the shrunk octagon's loop (x, y, nx, ny), counter-clockwise, its corners fanned (the rounded
// vertical edges), the back-wall stretches split exactly at the goal posts
const SY = ARENA.Y - R;
// the core octagon; the loop is it pushed out by CORNER_R − R, its vertices fanned (the wide
// vertical joints between the corner panels and the walls)
const V = octCore();
const RC = CORNER_R - R;
const loop = [];
for (let i = 0; i < V.length; i++) {
  const [ax, ay] = V[i];
  const [bx, by] = V[(i + 1) % V.length];
  const ex = bx - ax;
  const ey = by - ay;
  const len = Math.hypot(ex, ey);
  const nx = ey / len;
  const ny = -ex / len;
  // the straight stretch
  const ts = new Set([0]);
  const n = Math.max(1, Math.ceil(len / 120));
  for (let k = 1; k < n; k++) ts.add(k / n);
  if (Math.abs(ay + ny * RC) === SY && ay === by) for (const gx of [-GW, GW]) ts.add((gx - ax) / ex);
  for (const tt of [...ts].filter((x) => x >= 0 && x < 1).sort((a, b) => a - b)) loop.push([ax + ex * tt + nx * RC, ay + ey * tt + ny * RC, nx, ny]);
  // the fan round the next vertex, from this edge's normal to the next one's
  const [cx, cy] = V[(i + 2) % V.length];
  const fx = cx - bx;
  const fy = cy - by;
  const fl = Math.hypot(fx, fy);
  const a0 = Math.atan2(ny, nx);
  let a1 = Math.atan2(-fx / fl, fy / fl);
  while (a1 < a0) a1 += Math.PI * 2;
  const steps = 16;
  for (let k = 0; k < steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    loop.push([bx + Math.cos(a) * RC, by + Math.sin(a) * RC, Math.cos(a), Math.sin(a)]);
  }
}

// ---- the profile up the wall: (radial offset from the shrunk loop, z); floor contact to ceiling edge
const prof = [];
const ARC = 16;
for (let k = 0; k <= ARC; k++) {
  const a = -Math.PI / 2 + (k / ARC) * (Math.PI / 2);
  prof.push([R * Math.cos(a), R + R * Math.sin(a)]);
}
const wallZ = [GH, 345, 1000, 1500].filter((z) => z > R && z < Z - R).sort((a, b) => a - b);
for (const z of wallZ) prof.push([R, z]);
for (let k = 0; k <= ARC; k++) {
  const a = (k / ARC) * (Math.PI / 2);
  prof.push([R * Math.cos(a), Z - R + R * Math.sin(a)]);
}
// (the ramp's arc must also have a ring exactly at the goal height when it falls inside it)
prof.sort((a, b) => a[1] - b[1] || b[0] - a[0]);

const shell = mesh();
const P = loop.length;
const ring = (i, j) => {
  const [x, y, nx, ny] = loop[i % P];
  const [o, z] = prof[j];
  return shell.vert(x + nx * o, y + ny * o, z);
};
for (let i = 0; i < P; i++) {
  for (let j = 0; j < prof.length - 1; j++) {
    // the goal mouths: no shell on a back wall between the posts below the crossbar
    const a = loop[i];
    const b = loop[(i + 1) % P];
    const onBack = Math.abs(a[1]) === SY && a[1] === b[1] && Math.abs(a[3]) === 1;
    const zTop = prof[j + 1][1];
    if (onBack && Math.min(a[0], b[0]) >= -GW - 1e-6 && Math.max(a[0], b[0]) <= GW + 1e-6 && zTop <= GH + 1e-6) continue;
    // (wound so the normals face into the arena: the loop runs counter-clockwise seen from above)
    shell.quad(ring(i, j), ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j));
  }
}

// ---- each goal: the box, the rounded posts and crossbar, the back wall's corners over the mouth and the ramp's end faces
const goals = [];
for (const s of [-1, 1]) {
  const g = mesh();
  const parts = goalSurfaces(s, 14, 6);
  for (const m of [parts.inner, parts.frame, parts.corners, parts.ramps]) {
    const base = [];
    for (let i = 0; i < m.v.length; i += 3) base.push(g.vert(m.v[i], m.v[i + 1], m.v[i + 2]));
    for (let i = 0; i < m.t.length; i += 3) g.tri(base[m.t[i]], base[m.t[i + 1]], base[m.t[i + 2]]);
  }
  goals.push(g);
}

// ---- the files: [int32 bytes][cmf] each
function cmf(m) {
  const nt = m.t.length / 3;
  const nv = m.v.length / 3;
  const buf = new ArrayBuffer(8 + nt * 12 + nv * 12);
  const dv = new DataView(buf);
  dv.setInt32(0, nt, true);
  dv.setInt32(4, nv, true);
  let o = 8;
  for (const i of m.t) dv.setInt32(o, i, true), (o += 4);
  for (const c of m.v) dv.setFloat32(o, c / 50, true), (o += 4);
  return new Uint8Array(buf);
}
const files = [shell, ...goals].map(cmf);
const total = files.reduce((n, f) => n + 4 + f.length, 0);
const out = new Uint8Array(total);
let o = 0;
for (const f of files) {
  new DataView(out.buffer).setInt32(o, f.length, true);
  out.set(f, o + 4);
  o += 4 + f.length;
}
writeFileSync(new URL('../src/boost/sim/rs/arena.bin', import.meta.url), out);
console.log(`shell ${shell.t.length / 3} tris, goals ${goals.map((g) => g.t.length / 3).join('+')} tris, ${(total / 1024).toFixed(0)} KB`);
