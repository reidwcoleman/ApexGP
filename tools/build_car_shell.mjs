// Sketchfab "My take on the 2026 f1 regulations" (MaG80, CC-BY-4.0) → ApexGP car frame GLB (then: gltf-transform quantize --quantize-position 14 --quantize-normal 10 --quantize-texcoord 12; the source livery is resized to 1024² first).
// Needs @gltf-transform/core + extensions + meshoptimizer (not project deps: run it from a scratch folder with them installed).
// node build_car.mjs <scene.gltf> <out.glb>
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await MeshoptSimplifier.ready;

// model axles (world units of the source): front 3.538 / r 0.722, rear -3.753 / r 0.800
const S = 3.4 / (3.538 + 3.753);
const ZMID = (3.538 - 3.753) / 2;
const WHEEL_R = 0.3525;
const yF = 0.722 * S, yR = 0.8 * S;
// shear so both axles sit at the game's wheel-centre height
const b = ((WHEEL_R - yF) - (WHEEL_R - yR)) / 3.4, a = ((WHEEL_R - yF) + (WHEEL_R - yR)) / 2;
const m4 = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const m3 = (m, p) => { const v = [m[0]*p[0]+m[4]*p[1]+m[8]*p[2], m[1]*p[0]+m[5]*p[1]+m[9]*p[2], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]]; const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const toCar = (w) => { const x = w[0] * S, z = (w[2] - ZMID) * S; return [x, w[1] * S + a + b * z, z]; };

// gather triangles per output part
const parts = { body: [], nose: [], pillar: [], fwL: [], fwR: [], rw: [], light: [] };
// the halo's centre pillar (its own part: the cockpit camera's "halo column" setting hides it)
const inPillar = (c) => Math.abs(c[0]) < 0.05 && c[2] > 0.72 && c[2] < 1.0 && c[1] > 0.765 && c[1] < 0.94;
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh(); if (!mesh) continue;
  const name = n.getName();
  if (name.startsWith('Wheels') || name.startsWith('WheelCovers')) continue;
  const W = n.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial().getName();
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), U = p.getAttribute('TEXCOORD_0');
    const I = p.getIndices();
    const v = [0, 0, 0], nn = [0, 0, 0], uu = [0, 0];
    const verts = [];
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, v); N.getElement(i, nn); if (U) U.getElement(i, uu); else uu[0] = uu[1] = 0;
      const w = toCar(m4(W, v)); const wn = m3(W, nn);
      // (the shear's tilt on the normals is under a degree: ignored)
      verts.push([...w, ...wn, uu[0], uu[1]]);
    }
    const idx = I ? I.getArray() : Uint32Array.from({ length: P.getCount() }, (_, i) => i);
    let key = mat === 'RearLight' ? 'light' : name.startsWith('Front wing') ? 'fw' : name.startsWith('Rear wing') ? 'rw' : name.startsWith('NoseConnection') ? 'nose' : 'body';
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [verts[idx[t]], verts[idx[t + 1]], verts[idx[t + 2]]];
      let k = key;
      if (k === 'fw') k = (tri[0][0] + tri[1][0] + tri[2][0]) > 0 ? 'fwL' : 'fwR';
      if (k === 'body') {
        const c = [0, 1, 2].map((j) => (tri[0][j] + tri[1][j] + tri[2][j]) / 3);
        if (inPillar(c)) k = 'pillar';
      }
      parts[k].push(tri);
    }
  }
}

// the car number on the nose's crest: a patch draped on the bodywork 3 mm proud (uv 0–1: u along +X —
// read from the front —, v toward the rear; the game maps it into the driver sheet's nose-number cell)
function surfaceY(x, z) {
  let best = -1;
  for (const k of ['body', 'nose']) for (const t of parts[k]) {
    const [a, b, c] = t;
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    best = Math.max(best, l1 * a[1] + l2 * b[1] + l3 * c[1]);
  }
  return best;
}
{
  const X0 = -0.1, X1 = 0.1, Z0 = 1.92, Z1 = 2.2, NU = 8, NV = 10;
  const grid = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const x = X0 + (X1 - X0) * i / NU, z = Z1 - (Z1 - Z0) * j / NV;
    grid.push([x, surfaceY(x, z) + 0.003, z, 0, 1, 0, i / NU, j / NV]);
  }
  const tris = [];
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    tris.push([grid[a], grid[c], grid[b]], [grid[b], grid[c], grid[d]]);
  }
  // normals from the draped grid
  for (const t of tris) {
    const u = [0, 1, 2].map((k) => t[1][k] - t[0][k]), w = [0, 1, 2].map((k) => t[2][k] - t[0][k]);
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (n[1] < 0) { n = n.map((x) => -x); t.reverse(); }
    const l = Math.hypot(...n);
    for (const v of t) { v[3] = n[0] / l; v[4] = n[1] / l; v[5] = n[2] / l; }
  }
  parts.num = tris.map((t) => t.map((v) => [...v]));
  const ys = grid.map((g) => g[1]);
  if (Math.min(...ys) < 0.3) throw new Error('nose number patch runs off the nose');
  console.error('nose number patch y', Math.min(...ys).toFixed(3), Math.max(...ys).toFixed(3));
}

// indexed geometry per part (welded on exact attribute match), and a simplified LOD
function indexed(tris) {
  const map = new Map(); const vb = []; const ib = [];
  for (const tri of tris) for (const vv of tri) {
    const k = vv.map((x) => x.toFixed(5)).join(',');
    let id = map.get(k);
    if (id === undefined) { id = vb.length / 8; map.set(k, id); vb.push(...vv); }
    ib.push(id);
  }
  return { vb: new Float32Array(vb), ib: new Uint32Array(ib) };
}
function simplify({ vb, ib }, ratio, err) {
  const pos = new Float32Array(vb.length / 8 * 3);
  for (let i = 0; i < vb.length / 8; i++) { pos[i*3] = vb[i*8]; pos[i*3+1] = vb[i*8+1]; pos[i*3+2] = vb[i*8+2]; }
  const target = Math.floor(ib.length * ratio / 3) * 3;
  const [res] = MeshoptSimplifier.simplify(ib, pos, 3, target, err, ['LockBorder']);
  return { vb, ib: res };
}

const outDoc = new Document();
const buf = outDoc.createBuffer();
const scene = outDoc.createScene('car');
const srcMats = Object.fromEntries(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
// textures: the livery (repainted per team in the game) and its metal/roughness
const texOf = (t) => t && outDoc.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType());
const liv = srcMats.Livery;
const livery = outDoc.createMaterial('livery').setBaseColorTexture(texOf(liv.getBaseColorTexture())).setDoubleSided(true);
const light = outDoc.createMaterial('rearlight').setBaseColorFactor(srcMats.RearLight.getBaseColorFactor()).setEmissiveFactor([1, 0.05, 0.05]);
const stats = {};
for (const [k, tris] of Object.entries(parts)) {
  if (!tris.length) continue;
  const g0 = indexed(tris);
  const levels = k === 'light' || k === 'num' || k === 'pillar' ? [g0] : [g0, simplify(g0, k === 'body' ? 0.22 : 0.3, 0.004)];
  levels.forEach((g, lv) => {
    // compact the vertex buffer to what the indices use
    const remap = new Int32Array(g.vb.length / 8).fill(-1); const vb = []; const ib = new Uint32Array(g.ib.length);
    for (let i = 0; i < g.ib.length; i++) { const o = g.ib[i]; if (remap[o] < 0) { remap[o] = vb.length / 8; for (let j = 0; j < 8; j++) vb.push(g.vb[o * 8 + j]); } ib[i] = remap[o]; }
    const n = vb.length / 8; const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { P.set(vb.slice(i*8, i*8+3), i*3); N.set(vb.slice(i*8+3, i*8+6), i*3); U.set(vb.slice(i*8+6, i*8+8), i*2); }
    const prim = outDoc.createPrimitive()
      .setAttribute('POSITION', outDoc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
      .setAttribute('NORMAL', outDoc.createAccessor().setType('VEC3').setArray(N).setBuffer(buf))
      .setAttribute('TEXCOORD_0', outDoc.createAccessor().setType('VEC2').setArray(U).setBuffer(buf))
      .setIndices(outDoc.createAccessor().setType('SCALAR').setArray(ib).setBuffer(buf))
      .setMaterial(k === 'light' ? light : livery);
    const name = `${k}_L${lv}`;
    scene.addChild(outDoc.createNode(name).setMesh(outDoc.createMesh(name).addPrimitive(prim)));
    stats[name] = ib.length / 3;
  });
}
await io.write(out, outDoc);
console.log(JSON.stringify({ S, ZMID, a, b, tris: stats }));
