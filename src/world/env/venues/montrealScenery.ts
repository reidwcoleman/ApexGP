import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { srgb } from '../geom.ts';
import { buildWaters, type Water, type WaterSpec } from '../water.ts';
import { rng, hash2i } from '../noise.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import { floodUniforms } from '../night.ts';
import { BASIN, MTL_WATER_Y, SITES, montrealGeo } from './montrealLand.ts';

/**
 * Montréal's landmarks and water, built once per world:
 *
 *   the St Lawrence  one big water plane at MTL_WATER_Y over the whole far terrain, with a
 *                    baked depth map (shallows go green-brown, a lighter line at the banks),
 *                    wind ripples and swell from two scrolling normal layers, rain roughens it
 *   the Olympic basin  its concrete coping, eight lanes of buoy lines, the finish tower and
 *                    the rowing stand on the west bank
 *   the Biosphère    Buckminster Fuller's Expo 67 geodesic sphere on Île Sainte-Hélène
 *   the Casino       the French pavilion (floors widening upward, wrapped in curved aluminium
 *                    fins) and the Québec pavilion's gold glass cube, both glowing at night
 *   Habitat 67       Safdie's stacked concrete boxes on the Cité du Havre
 *   Jacques-Cartier  the steel cantilever bridge to the north, lit in colour at night
 *   ships            a lake freighter in the river, another at the Old Port
 *
 * Everything is merged into a handful of meshes (a few draw calls, ~80 k triangles).
 */

// ---------------------------------------------------------------- helpers

class MB {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get n() {
    return this.pos.length / 3;
  }
  v(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  /** flat quad a b c d (counter-clockwise seen from the front) */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i = this.v(a, n, col), j = this.v(b, n, col), k = this.v(c, n, col), l = this.v(d, n, col);
    this.idx.push(i, j, k, i, k, l);
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, out?: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (out && n.dot(out) < 0) {
      n.negate();
      const t = b;
      b = c;
      c = t;
    }
    const i = this.v(a, n, col), j = this.v(b, n, col), k = this.v(c, n, col);
    this.idx.push(i, j, k);
  }
  /** quad whose normal is flipped to agree with `out` */
  quadOut(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color, out: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (n.dot(out) >= 0) this.quad(a, b, c, d, col);
    else this.quad(d, c, b, a, col);
  }
  /** oriented box: centre, half extents along the local axes (x right, y up, z forward), yaw */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, col: THREE.Color, bottom = false) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => new THREE.Vector3(cx + x * c + z * s, cy + y, cz - x * s + z * c);
    const p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(p[4], p[7], p[6], p[5], col); // top
    this.quad(p[3], p[2], p[6], p[7], col); // +z
    this.quad(p[1], p[0], p[4], p[5], col); // −z
    this.quad(p[2], p[1], p[5], p[6], col); // +x
    this.quad(p[0], p[3], p[7], p[4], col); // −x
    if (bottom) this.quad(p[0], p[1], p[2], p[3], col);
  }
  /** triangular-section strut from a to b (width w), one face toward `out` */
  strut(a: THREE.Vector3, b: THREE.Vector3, w: number, col: THREE.Color, out?: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    if (L < 1e-3) return;
    d.divideScalar(L);
    const ref = out ? out.clone() : new THREE.Vector3(0, 1, 0);
    let x = new THREE.Vector3().crossVectors(ref, d);
    if (x.lengthSq() < 1e-6) x = new THREE.Vector3(1, 0, 0).cross(d);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(d, x).normalize();
    const r = w * 0.58;
    const off = [0, 1, 2].map((k) => {
      const t = (k / 3) * Math.PI * 2 + Math.PI / 2;
      return new THREE.Vector3().addScaledVector(x, Math.cos(t) * r).addScaledVector(y, Math.sin(t) * r);
    });
    for (let k = 0; k < 3; k++) {
      const o0 = off[k], o1 = off[(k + 1) % 3];
      const n = new THREE.Vector3().addVectors(o0, o1).normalize();
      const i = this.n;
      for (const p of [a.clone().add(o0), a.clone().add(o1), b.clone().add(o1), b.clone().add(o0)]) this.v(p, n, col);
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** night factor (0 day … 1 night) shared with the floodlights */
const NIGHT_GLSL = 'smoothstep( 0.0, 0.5, uFlood.x )';

/** glass that glows warm gold at night (the Casino, the Québec pavilion) */
function goldGlass(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: srgb(0x6a5428), roughness: 0.14, metalness: 0.85, emissive: srgb(0xffb347), emissiveIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3( 1.0, 0.62, 0.22 ) * 1.5 * ${NIGHT_GLSL};`);
  };
  m.customProgramCacheKey = () => 'apex-mtl-goldglass';
  return m;
}

/** painted steel; `lit` > 0 adds the Jacques-Cartier bridge's colour-cycling night lighting */
function steelMat(lit: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
  if (lit) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uFlood = { value: floodUniforms.params };
      sh.uniforms.uT = weatherUniforms.uWeatherTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;\nuniform float uT;\nvarying vec3 vBW;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  float ph = vBW.x * 0.0021 - uT * 0.05;
  vec3 hue = 0.5 + 0.5 * cos( 6.2832 * ( ph + vec3( 0.0, 0.33, 0.67 ) ) );
  totalEmissiveRadiance += hue * 1.4 * ${NIGHT_GLSL};
}`,
        );
    };
    m.customProgramCacheKey = () => 'apex-mtl-bridge-lit';
  }
  return m;
}

// ---------------------------------------------------------------- water

/**
 * The river (one sheet over the whole far terrain; the islands and shores stand out of it,
 * a baked depth map puts the shallows and the foam on their real banks) and the basin.
 */
function buildMontrealWater(map: WorldMap): Water {
  const F = map.FAR, S = map.SQUARE;
  // depth map over the 6 km square: 0 at the bank … 1 at 8 m
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = S.x0 + ((i + 0.5) / N) * (S.x1 - S.x0), z = S.z0 + ((j + 0.5) / N) * (S.z1 - S.z0);
      const d = Math.max(0, Math.min(1, (MTL_WATER_Y - map.height(x, z)) / 8));
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(d * 255);
      data[k + 3] = 255;
    }
  const depth = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.generateMipmaps = false;
  depth.needsUpdate = true;
  const river: WaterSpec = {
    outline: [{ x: F.x0, z: F.z0 }, { x: F.x1, z: F.z0 }, { x: F.x1, z: F.z1 }, { x: F.x0, z: F.z1 }],
    y: MTL_WATER_Y,
    kind: 'river',
    // the St Lawrence runs north-north-east past the islands, quite fast
    flow: { x: 0.35, z: -1.1 },
    deep: [0.014, 0.034, 0.042],
    shallow: [0.05, 0.062, 0.04],
    shore: 0,
    depth: { map: depth, x0: S.x0, z0: S.z0, x1: S.x1, z1: S.z1, range: 8 },
  };
  const B = BASIN;
  const dx = B.bx - B.ax, dz = B.bz - B.az;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const cx = (B.ax + B.bx) / 2, cz = (B.az + B.bz) / 2;
  const corner = (a: number, c: number) => ({ x: cx + ux * a + nx * c, z: cz + uz * a + nz * c });
  const basin: WaterSpec = {
    outline: [corner(-len / 2, -B.half), corner(len / 2, -B.half), corner(len / 2, B.half), corner(-len / 2, B.half)],
    // (a little above the river sheet, which runs on underneath)
    y: MTL_WATER_Y + 0.35,
    kind: 'basin',
  };
  return buildWaters([river, basin]);
}

/** June on the island: lush mown parkland, few dry patches, grey-brown roofs across the river */
export function montrealTerrainLook(u: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x547238);
  set('uMeadow', 0x61743c);
  set('uStraw', 0x8a8a52);
  set('uGrassDark', 0x3b5226);
  set('uCanopy', 0x2f4a26);
  set('uRoof', 0x5b5552);
  set('uGravel', 0xc2b596);
}

// ---------------------------------------------------------------- build

export function buildMontrealScenery(layout: Layout, track: Track, map: WorldMap): { group: THREE.Group; tris: number; update(elapsed: number): void } {
  void layout;
  void track;
  const group = new THREE.Group();
  group.name = 'MontrealScenery';
  const r = rng(6767);
  const solid = new MB();
  const steel = new MB();
  const lit = new MB();
  const gold = new MB();
  const g = (x: number, z: number) => map.height(x, z);

  const water = buildMontrealWater(map);
  group.add(water.mesh);

  // ---------------------------------------------------------------- the Olympic basin
  {
    const B = BASIN;
    const dx = B.bx - B.ax, dz = B.bz - B.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    // right-hand normal (east, toward the paddock)
    const nx = -uz, nz = ux;
    const cx = (B.ax + B.bx) / 2, cz = (B.az + B.bz) / 2;
    const P = (along: number, across: number, y: number) => new THREE.Vector3(cx + ux * along + nx * across, y, cz + uz * along + nz * across);
    const conc = srgb(0xb8b2a6), concTop = srgb(0xcfc9bd);
    const yBot = MTL_WATER_Y - 0.4;
    // the coping: a vertical face toward the water and a 1.2 m cap, all round
    const edge = (a0: number, c0: number, a1: number, c1: number, inward: THREE.Vector3) => {
      const L = Math.hypot(a1 - a0, c1 - c0);
      const n = Math.max(1, Math.round(L / 12));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const A = P(a0 + (a1 - a0) * t0, c0 + (c1 - c0) * t0, 0), Bq = P(a0 + (a1 - a0) * t1, c0 + (c1 - c0) * t1, 0);
        const ya = Math.max(MTL_WATER_Y + 0.9, g(A.x - inward.x * 3, A.z - inward.z * 3) + 0.12);
        const yb = Math.max(MTL_WATER_Y + 0.9, g(Bq.x - inward.x * 3, Bq.z - inward.z * 3) + 0.12);
        const a = new THREE.Vector3(A.x, yBot, A.z), b = new THREE.Vector3(Bq.x, yBot, Bq.z);
        const at = new THREE.Vector3(A.x, ya, A.z), bt = new THREE.Vector3(Bq.x, yb, Bq.z);
        // face (toward the water: the quad's normal must agree with `inward`)
        const nq = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(at, a));
        if (nq.dot(inward) > 0) solid.quad(a, b, bt, at, conc);
        else solid.quad(b, a, at, bt, conc);
        const ao = at.clone().addScaledVector(inward, -1.2), bo = bt.clone().addScaledVector(inward, -1.2);
        const nt = new THREE.Vector3().subVectors(bt, at).cross(new THREE.Vector3().subVectors(ao, at));
        if (nt.y > 0) solid.quad(at, bt, bo, ao, concTop);
        else solid.quad(bt, at, ao, bo, concTop);
      }
    };
    const h = B.half, l2 = len / 2;
    edge(-l2, -h, l2, -h, new THREE.Vector3(nx, 0, nz));
    edge(-l2, h, l2, h, new THREE.Vector3(-nx, 0, -nz));
    edge(-l2, -h, -l2, h, new THREE.Vector3(ux, 0, uz));
    edge(l2, -h, l2, h, new THREE.Vector3(-ux, 0, -uz));
    // lane lines: seven strings of buoys (white, red over the last 100 m)
    const buoys: { p: THREE.Vector3; c: THREE.Color }[] = [];
    for (let k = 1; k < 8; k++) {
      const across = -h + (k * 2 * h) / 8;
      for (let a = -l2 + 25; a <= l2 - 15; a += 10) buoys.push({ p: P(a, across, MTL_WATER_Y + 0.43), c: a > l2 - 110 ? srgb(0xe53935) : a < -l2 + 60 ? srgb(0xfdd835) : srgb(0xf2f2f2) });
    }
    const bg = new THREE.IcosahedronGeometry(0.3, 0);
    const bm = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ roughness: 0.4 }), buoys.length);
    const m4 = new THREE.Matrix4();
    buoys.forEach((b, i) => {
      bm.setMatrixAt(i, m4.makeTranslation(b.p.x, b.p.y, b.p.z));
      bm.setColorAt(i, b.c);
    });
    bm.instanceMatrix.needsUpdate = true;
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    bm.computeBoundingSphere();
    bm.name = 'mtl_basin_buoys';
    group.add(bm);
    // the finish tower and the rowing stand on the west bank at the south (finish) end
    const yaw = Math.atan2(ux, uz);
    {
      const q = P(l2 - 30, -h - 16, 0);
      const y = g(q.x, q.z);
      solid.box(q.x, y + 7, q.z, 2.6, 7, 2.6, yaw, srgb(0xe8e4dc));
      gold.box(q.x, y + 15.5, q.z, 4.6, 1.5, 4.6, yaw, srgb(0xffffff));
      solid.box(q.x, y + 17.2, q.z, 5.4, 0.25, 5.4, yaw, srgb(0xf2f2ee));
      steel.box(q.x, y + 21, q.z, 0.08, 3.6, 0.08, yaw, srgb(0xdddddd));
      // the stand: eight stepped terraces facing the water, blue seats, a light roof on columns
      const sc = P(l2 - 150, -h - 9, 0);
      const sy = g(sc.x, sc.z);
      for (let k = 0; k < 8; k++) {
        const s0 = P(l2 - 150, -h - 5.5 - k * 0.9, 0);
        solid.box(s0.x, sy + 0.2 + k * 0.23, s0.z, 0.45, 0.2 + k * 0.23, 48, yaw, k % 2 ? srgb(0x2f5fa8) : srgb(0x2a549a));
      }
      for (let a = -46; a <= 46; a += 11.5) {
        const cpos = P(l2 - 150 + a, -h - 13.2, 0);
        steel.box(cpos.x, sy + 3.6, cpos.z, 0.15, 3.6, 0.15, yaw, srgb(0xe6e6e6));
      }
      const roofC = P(l2 - 150, -h - 9.4, 0);
      solid.box(roofC.x, sy + 7.3, roofC.z, 5.2, 0.18, 49, yaw, srgb(0xf0f0ec), true);
    }
    // boathouses at the north end
    for (let k = 0; k < 3; k++) {
      const q = P(-l2 + 40 + k * 34, -h - 26, 0);
      const y = g(q.x, q.z);
      solid.box(q.x, y + 3.5, q.z, 14, 3.5, 8, yaw + Math.PI / 2, srgb(0xe6e1d6));
      solid.box(q.x, y + 7.3, q.z, 15, 0.3, 9, yaw + Math.PI / 2, srgb(0x5d6b73));
    }
  }

  // ---------------------------------------------------------------- the Biosphère
  {
    const S = SITES.biosphere;
    const y0 = g(S.x, S.z);
    const R = 38, cy = y0 + 62 - R;
    const center = new THREE.Vector3(S.x, cy, S.z);
    // geodesic icosphere, frequency 14, truncated below 0.63 R
    const t = (1 + Math.sqrt(5)) / 2;
    const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => new THREE.Vector3(...v).normalize());
    const Fc = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const Fq = 14;
    const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
    const key = (p: THREE.Vector3) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
    const addE = (a: THREE.Vector3, b: THREE.Vector3) => {
      const ka = key(a), kb = key(b);
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (!edges.has(k)) edges.set(k, [a, b]);
    };
    for (const [ia, ib, ic] of Fc) {
      const A = V[ia], Bv = V[ib], Cv = V[ic];
      const pt = (i: number, j: number) => new THREE.Vector3().copy(A).addScaledVector(new THREE.Vector3().subVectors(Bv, A), i / Fq).addScaledVector(new THREE.Vector3().subVectors(Cv, A), j / Fq).normalize();
      for (let i = 0; i < Fq; i++)
        for (let j = 0; j < Fq - i; j++) {
          const p0 = pt(i, j), p1 = pt(i + 1, j), p2 = pt(i, j + 1);
          addE(p0, p1); addE(p1, p2); addE(p2, p0);
        }
    }
    const col = srgb(0xdfe2e4);
    const cut = -0.63;
    for (const [a, b] of edges.values()) {
      if (a.y < cut && b.y < cut) continue;
      const A = a.clone().multiplyScalar(R).add(center), Bp = b.clone().multiplyScalar(R).add(center);
      if (A.y < y0 || Bp.y < y0) continue;
      const out = a.clone().add(b).normalize();
      steel.strut(A, Bp, 0.42, col, out);
    }
    // base ring and the museum inside (floors on columns)
    const ringR = R * Math.sqrt(1 - cut * cut);
    for (let k = 0; k < 48; k++) {
      const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
      solid.strut(new THREE.Vector3(S.x + Math.cos(a0) * ringR, y0 + 0.6, S.z + Math.sin(a0) * ringR), new THREE.Vector3(S.x + Math.cos(a1) * ringR, y0 + 0.6, S.z + Math.sin(a1) * ringR), 1.4, srgb(0xbab5aa));
    }
    for (let f = 0; f < 4; f++) {
      const w = [22, 26, 24, 16][f];
      solid.box(S.x, y0 + 4 + f * 8, S.z, w, 0.5, w * 0.8, 0.4, srgb(0xcac5ba));
    }
    gold.box(S.x, y0 + 14, S.z, 12, 14, 10, 0.4, srgb(0xffffff));
  }

  // ---------------------------------------------------------------- the Casino (French pavilion) and the Québec pavilion
  {
    const S = SITES.casino;
    const y0 = g(S.x, S.z);
    const yaw = 0.3;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const L = (x: number, y: number, z: number) => new THREE.Vector3(S.x + x * c + z * s, y0 + y, S.z - x * s + z * c);
    const A = 40, Bz = 33, n = 4.5;
    // superellipse point at angle th, scale k
    const sup = (th: number, k: number) => {
      const ct = Math.cos(th), st = Math.sin(th);
      return [k * A * Math.sign(ct) * Math.abs(ct) ** (2 / n), k * Bz * Math.sign(st) * Math.abs(st) ** (2 / n)];
    };
    const FLOORS = 6, FH = 5.2;
    const scale = (y: number) => 0.72 + 0.28 * Math.pow(y / (FLOORS * FH), 0.8);
    // glass core, floor by floor, and the slabs
    for (let f = 0; f < FLOORS; f++) {
      const k = scale(f * FH + FH / 2) - 0.06;
      const N = 40;
      for (let i = 0; i < N; i++) {
        const [x0, z0] = sup((i / N) * Math.PI * 2, k), [x1, z1] = sup(((i + 1) / N) * Math.PI * 2, k);
        const out = new THREE.Vector3((x0 + x1) * c + (z0 + z1) * s, 0, -(x0 + x1) * s + (z0 + z1) * c);
        gold.quadOut(L(x1, f * FH, z1), L(x0, f * FH, z0), L(x0, (f + 1) * FH, z0), L(x1, (f + 1) * FH, z1), srgb(0xffffff), out);
      }
      // the slab edge: a white band round each floor, just proud of the glass
      const ke = scale((f + 1) * FH) - 0.035;
      for (let i = 0; i < N; i++) {
        const [x0, z0] = sup((i / N) * Math.PI * 2, ke), [x1, z1] = sup(((i + 1) / N) * Math.PI * 2, ke);
        const out = new THREE.Vector3((x0 + x1) * c + (z0 + z1) * s, 0, -(x0 + x1) * s + (z0 + z1) * c);
        solid.quadOut(L(x1, (f + 1) * FH - 0.7, z1), L(x0, (f + 1) * FH - 0.7, z0), L(x0, (f + 1) * FH, z0), L(x1, (f + 1) * FH, z1), srgb(0xf1efe8), out);
      }
      const ks = scale((f + 1) * FH) - 0.02;
      for (let i = 0; i < N; i++) {
        const [x0, z0] = sup((i / N) * Math.PI * 2, ks), [x1, z1] = sup(((i + 1) / N) * Math.PI * 2, ks);
        solid.tri(L(0, (f + 1) * FH, 0), L(x1, (f + 1) * FH, z1), L(x0, (f + 1) * FH, z0), srgb(0xe9e6de), new THREE.Vector3(0, 1, 0));
      }
    }
    // the aluminium fins: curved ribs rising and flaring outward, ~2.6 m apart
    const finC = srgb(0xe2dcc8);
    const NF = 92;
    for (let i = 0; i < NF; i++) {
      const th = (i / NF) * Math.PI * 2;
      let prev: THREE.Vector3 | null = null;
      for (let q = 0; q <= 8; q++) {
        const y = (q / 8) * (FLOORS * FH + 3);
        const k = scale(Math.min(y, FLOORS * FH)) + 0.02 + 0.03 * Math.sin((q / 8) * Math.PI);
        const [x, z] = sup(th, k);
        const p = L(x, y, z);
        if (prev) steel.strut(prev, p, 0.55, finC, new THREE.Vector3(x * c + z * s, 0, -x * s + z * c).normalize());
        prev = p;
      }
    }
    // podium and the forecourt canopy
    solid.box(S.x, y0 - 0.4, S.z, A * 0.8, 0.6, Bz * 0.8, yaw, srgb(0xcfc9bd));
    // the Québec pavilion: a glass cube on a dark podium with a thin frame
    const Q = SITES.quebecPavilion;
    const qy = g(Q.x, Q.z);
    solid.box(Q.x, qy + 1.2, Q.z, 21, 1.2, 21, yaw, srgb(0x3a3b3d));
    gold.box(Q.x, qy + 16.4, Q.z, 18, 14, 18, yaw, srgb(0xffffff));
    for (const [hx, hz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = L(0, 0, 0);
      void p;
      const cxq = Q.x + hx * 18 * c + hz * 18 * s, czq = Q.z - hx * 18 * s + hz * 18 * c;
      steel.box(cxq, qy + 16.4, czq, 0.4, 14.4, 0.4, yaw, srgb(0xc9b27a));
    }
    steel.box(Q.x, qy + 30.6, Q.z, 18.6, 0.3, 18.6, yaw, srgb(0xc9b27a));
    // the passerelle between them
    const mid = new THREE.Vector3((S.x + Q.x) / 2, 0, (S.z + Q.z) / 2);
    solid.box(mid.x, y0 + 8, mid.z, 3, 1.6, Math.hypot(S.x - Q.x, S.z - Q.z) / 2 - 20, Math.atan2(Q.x - S.x, Q.z - S.z), srgb(0xd4d0c6));
  }

  // ---------------------------------------------------------------- Habitat 67
  {
    const S = SITES.habitat;
    const yaw = 0.5;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const conc = [srgb(0xd3cbbb), srgb(0xc8c0af), srgb(0xdcd5c7)];
    const win = srgb(0x3b4148);
    // three clusters along the peninsula, stepping up to 12 storeys
    for (const [off, levels, spread] of [[-80, 10, 34], [0, 12, 40], [85, 9, 30]] as const) {
      for (let lv = 0; lv < levels; lv++) {
        const w = spread * (1 - lv / (levels + 2));
        const count = Math.round(6 - lv * 0.35);
        for (let k = 0; k < count; k++) {
          const along = off + (r() - 0.5) * 2 * w;
          const across = (r() - 0.5) * 22;
          const x = S.x + along * c + across * s, z = S.z - along * s + across * c;
          const y = g(S.x, S.z) + 1.5 + lv * 3.1 + 1.5;
          const rot = yaw + (r() < 0.5 ? 0 : Math.PI / 2);
          solid.box(x, y, z, 5.85, 1.5, 2.65, rot, conc[k % 3]);
          if (r() < 0.6) solid.box(x + Math.sin(rot) * 2.7, y, z + Math.cos(rot) * 2.7, 3.2, 1.0, 0.05, rot, win);
        }
      }
    }
  }

  // ---------------------------------------------------------------- the Jacques-Cartier bridge
  {
    // Montréal (De Lorimier) → over the main channel → Île Sainte-Hélène's north end → Longueuil
    const P0 = new THREE.Vector3(-2600, 0, -2300), P1 = new THREE.Vector3(-1150, 0, -2620), P2 = new THREE.Vector3(1350, 0, -3160);
    const deckY = (x: number) => MTL_WATER_Y + 12 + 34 * Math.exp(-(((x + 1700) / 1100) ** 2)) + 10 * Math.exp(-(((x - 300) / 900) ** 2));
    const path: THREE.Vector3[] = [];
    const seg = (a: THREE.Vector3, b: THREE.Vector3, step: number) => {
      const L = a.distanceTo(b);
      const n = Math.ceil(L / step);
      for (let k = 0; k < n; k++) path.push(new THREE.Vector3().lerpVectors(a, b, k / n));
    };
    seg(P0, P1, 20);
    seg(P1, P2, 20);
    path.push(P2.clone());
    for (const p of path) p.y = Math.max(deckY(p.x), g(p.x, p.z) + 3);
    const green = srgb(0x55675c), deckC = srgb(0x6c6e70), pierC = srgb(0xa9a49a);
    // the main (cantilever) span over the channel: from x0 to x1, the truss rises over the two main piers
    const mx0 = -2080, mx1 = -1320;
    const hump = (x: number) => {
      if (x < mx0 || x > mx1) return 7;
      const t = (x - mx0) / (mx1 - mx0);
      const pk = (u: number) => Math.max(0, 1 - Math.abs(t - u) / 0.28);
      return 7 + 36 * Math.max(pk(0.27), pk(0.73)) ** 0.9 + 6 * Math.sin(t * Math.PI);
    };
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1];
      const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const yaw = Math.atan2(dir.x, dir.z);
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
      // deck
      steel.box(mid.x, mid.y - 0.8, mid.z, 11, 0.8, a.distanceTo(b) / 2 + 0.2, yaw, deckC, true);
      // side trusses (through-truss over the main span, deck trusses elsewhere)
      const ha = hump(a.x), hb = hump(b.x);
      for (const sd of [-1, 1]) {
        const o = side.clone().multiplyScalar(sd * 10.5);
        const a0 = a.clone().add(o), b0 = b.clone().add(o);
        const aT = a0.clone().setY(a0.y + ha), bT = b0.clone().setY(b0.y + hb);
        lit.strut(a0, b0, 1.8, green);
        lit.strut(aT, bT, 1.8, green);
        lit.strut(a0, aT, 1.2, green);
        lit.strut(i % 2 ? a0 : aT, i % 2 ? bT : b0, 1.0, green);
      }
      // cross bracing on top
      lit.strut(a.clone().addScaledVector(side, -10.5).setY(a.y + ha), a.clone().addScaledVector(side, 10.5).setY(a.y + ha), 0.8, green);
      // piers every 60 m where the deck is well up
      if (i % 3 === 0) {
        const gy = Math.min(g(a.x, a.z), MTL_WATER_Y - 0.5);
        if (a.y - gy > 4) solid.box(a.x, (a.y + gy) / 2 - 1.2, a.z, 7, (a.y - gy) / 2 - 1.2, 3.5, yaw + Math.PI / 2, pierC);
      }
    }
  }

  // ---------------------------------------------------------------- ships
  {
    const ship = (x: number, z: number, yaw: number, len: number, hull: number) => {
      const y = MTL_WATER_Y;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const at = (a: number) => ({ x: x + a * s, z: z + a * c });
      const b = 11.5;
      solid.box(x, y + 2.5, z, b, 5.5, len / 2 - 10, yaw, srgb(hull));
      const bow = at(len / 2 - 5);
      solid.box(bow.x, y + 3.2, bow.z, b * 0.72, 6.2, 5, yaw, srgb(hull));
      solid.box(x, y + 8.1, z, b - 0.3, 0.1, len / 2 - 10, yaw, srgb(0x7a2a22));
      // hatch covers
      for (let k = -6; k <= 4; k++) {
        const h = at(k * 13);
        solid.box(h.x, y + 8.6, h.z, b - 2.2, 0.5, 5.2, yaw, srgb(0x9a3b2c));
      }
      // the accommodation block and bridge at the stern
      const st = at(-len / 2 + 14);
      solid.box(st.x, y + 14, st.z, b - 1, 6, 7, yaw, srgb(0xf0efe9));
      solid.box(st.x, y + 20.8, st.z, b + 1.5, 0.8, 4, yaw, srgb(0xf0efe9));
      const fu = at(-len / 2 + 7);
      solid.box(fu.x, y + 21, fu.z, 1.6, 3.5, 1.8, yaw, srgb(0x2b2b2b));
    };
    ship(760, -700, 0.12 + Math.PI, 190, 0x8e1b16);
    ship(-2110, -1150, 0.2, 170, 0x1d2b4a);
  }

  // ---------------------------------------------------------------- meshes
  const add = (mb: MB, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.n === 0) return;
    const m = new THREE.Mesh(mb.geometry(), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), 'mtl_solid', true);
  add(steel, steelMat(false), 'mtl_steel', true);
  add(lit, steelMat(true), 'mtl_bridge', false);
  add(gold, goldGlass(), 'mtl_goldglass', false);
  let tris = 0;
  for (const mb of [solid, steel, lit, gold]) tris += mb.idx.length / 3;
  void hash2i;
  void montrealGeo;
  return { group, tris, update: (t: number) => water.update(t) };
}
