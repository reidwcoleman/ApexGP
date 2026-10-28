// Builds the arena collision meshes RocketSim loads (its .cmf format, in bullet units = uu / 50), from
// the published measurements in src/boost/sim/arena.ts: the rounded shell (ramps 256, corners cut
// 1152 along each wall and swept into the walls on CORNER_R, the back walls, the ceiling's edge) with the goal mouths cut out exactly, the
// faces where the ramp stops either side of each mouth, and the goal boxes. RocketSim adds its own
// planes for the floor, the ceiling and the side walls.
//   node --experimental-transform-types --no-warnings tools/boost_rsmesh.mjs
import { writeFileSync } from 'node:fs';
import { ARENA, CORNER_R, goalProfile, octCore } from '../src/boost/sim/arena.ts';

const prof2 = goalProfile(14);

const R = ARENA.R;
const Z = ARENA.Z;
const GW = ARENA.GOAL_W;
const GH = ARENA.GOAL_H;
const Y = ARENA.Y;
const GY1 = ARENA.Y + ARENA.GOAL_D;

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

// ---- each goal: side walls (with the faces where the ramp stops), roof, back
const goals = [];
for (const s of [-1, 1]) {
  const g = mesh();
  for (const sx of [-1, 1]) {
    const x = sx * GW;
    // in front of the back wall: from the floor up to the ramp, on the shell's own rings
    for (let k = 0; k < ARC; k++) {
      const a0 = -Math.PI / 2 + (k / ARC) * (Math.PI / 2);
      const a1 = -Math.PI / 2 + ((k + 1) / ARC) * (Math.PI / 2);
      const y0 = s * (SY + R * Math.cos(a0));
      const y1 = s * (SY + R * Math.cos(a1));
      g.quad(g.vert(x, y0, 0), g.vert(x, y1, 0), g.vert(x, y1, R + R * Math.sin(a1)), g.vert(x, y0, R + R * Math.sin(a0)));
    }
    // behind the back wall: the side, cut to the goal's profile (a convex outline: a fan from inside)
    const c = g.vert(x, s * (Y + ARENA.GOAL_D * 0.45), GH * 0.5);
    for (let k = 0; k < prof2.length; k++) {
      const [d0, z0] = prof2[k];
      const [d1, z1] = prof2[(k + 1) % prof2.length];
      g.tri(c, g.vert(x, s * (Y + d0), z0), g.vert(x, s * (Y + d1), z1));
    }
  }
  // the floor's ramp, the back wall, the curve over and the roof, across the goal's width
  for (let k = 1; k < prof2.length - 1; k++) {
    const [d0, z0] = prof2[k];
    const [d1, z1] = prof2[k + 1];
    g.quad(g.vert(-GW, s * (Y + d0), z0), g.vert(GW, s * (Y + d0), z0), g.vert(GW, s * (Y + d1), z1), g.vert(-GW, s * (Y + d1), z1));
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
