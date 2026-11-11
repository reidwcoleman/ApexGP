import * as THREE from 'three';
import type { Renderer } from '../../core/Renderer.ts';
import type { Track } from '../Track.ts';
import type { Scenery } from '../env/scenery.ts';
import { monzaAssets } from './assets.ts';
import { Geo } from './geo.ts';
import { TILE, concreteMaterial, grassMaterial, paintedSteel } from './materials.ts';

/**
 * The park round the new Monza (2026-11-10), from nothing: the ground (lawn by the track, leaf
 * litter under the trees), the Parco di Monza's woods as photographed trees that turn to the lens
 * (and to the sun for their shadows, so the lap runs through real dappled shade), a far wall of
 * woodland on the horizon, and the grandstands with a photographed crowd. Lit by the engine's sun,
 * sky, fog and weather like everything else.
 */

/** where the stands are: [from s, to s, side, rows, roofed] */
const STANDS: [number, number, 1 | -1, number, boolean][] = [
  [310, 900, -1, 16, true], // Tribuna Centrale, opposite the pits
  [1240, 1330, 1, 10, false], // Rettifilo, outside the second part
  [2800, 2900, -1, 10, false], // Lesmo 1
  [4140, 4250, 1, 10, false], // Ascari
  [5330, 5560, -1, 14, true], // Parabolica
];
const ROW_D = 0.85;
const ROW_H = 0.5;
const STAND_GAP = 7;
const STAND_BASE = 1.7;

export function* monzaSceneryBuilder(track: Track, gfx: Renderer): Generator<{ group: THREE.Group; step: string }, Scenery, void> {
  const t0 = performance.now();
  const A = monzaAssets(gfx.maxAnisotropy);
  const n = track.n;
  const group = new THREE.Group();
  group.name = 'scenery';
  const df = track.buildDistanceField(8, 620, 300);

  let meanY = 0;
  for (let i = 0; i < n; i++) meanY += track.py[i];
  meanY /= n;

  const wrap = (v: number) => ((v % n) + n) % n;
  const inSpan = (i: number, a: number, b: number) => {
    const x = wrap(i), lo = wrap(a), hi = wrap(b);
    return lo <= hi ? x >= lo && x <= hi : x >= lo || x <= hi;
  };
  const pitFar = track.pit.garageOffset + track.pit.paddock + 14;

  /** what the nearest part of the lap says about a point: its sample, its lateral, how far beyond the barrier */
  const probe = (x: number, z: number) => {
    const gx = Math.round((x - df.originX) / df.cell), gz = Math.round((z - df.originZ) / df.cell);
    if (gx < 0 || gz < 0 || gx >= df.w || gz >= df.h) return null;
    const j = df.nearest[gz * df.w + gx];
    if (j < 0) return null;
    const lat = (x - track.px[j]) * track.rx[j] + (z - track.pz[j]) * track.rz[j];
    const side = lat < 0 ? -1 : 1;
    let bar = side < 0 ? track.barrierL[j] : track.barrierR[j];
    const pit = side === track.pit.side && j >= track.pit.sStart - 70 && j <= track.pit.sEnd + 70;
    if (pit) bar = Math.max(bar, pitFar);
    return { j, lat, side, bar, beyond: Math.abs(lat) - bar, pit };
  };
  const heightAt = (x: number, z: number): number => {
    const q = probe(x, z);
    if (!q) return meanY - 0.05;
    const j = q.j;
    if (q.beyond <= 0.5) return track.py[j] + track.ry[j] * q.lat - 0.3;
    const edge = track.py[j] + track.ry[j] * q.side * q.bar - 0.03;
    const k = THREE.MathUtils.smoothstep(q.beyond, 0, 60);
    const far = THREE.MathUtils.smoothstep(q.beyond, 140, 290);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(edge, track.py[j] - 0.05, k), meanY - 0.05, far);
  };

  // ------------------------------------------------------------------ the ground
  {
    const cell = 10;
    const x0 = df.originX, z0 = df.originZ;
    const w = Math.floor((df.w * df.cell) / cell), h = Math.floor((df.h * df.cell) / cell);
    const pos = new Float32Array((w + 1) * (h + 1) * 3);
    const uv = new Float32Array((w + 1) * (h + 1) * 2);
    const trk = new Float32Array((w + 1) * (h + 1) * 4);
    const kk = new Float32Array((w + 1) * (h + 1) * 4);
    for (let iz = 0; iz <= h; iz++) {
      for (let ix = 0; ix <= w; ix++) {
        const x = x0 + ix * cell, z = z0 + iz * cell;
        const o = iz * (w + 1) + ix;
        pos[o * 3] = x;
        pos[o * 3 + 1] = heightAt(x, z);
        pos[o * 3 + 2] = z;
        uv[o * 2] = x / TILE.grass;
        uv[o * 2 + 1] = z / TILE.grass;
        trk[o * 4] = x;
        trk[o * 4 + 1] = z;
        const q = probe(x, z);
        // (lawn kept open for the first metres beyond the barrier; woodland floor from there)
        kk[o * 4 + 1] = q ? THREE.MathUtils.smoothstep(q.beyond, 6, 34) : 1;
      }
    }
    const idx = new Uint32Array(w * h * 6);
    let t = 0;
    for (let iz = 0; iz < h; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const a = iz * (w + 1) + ix, b = a + 1, c = a + (w + 1), d = c + 1;
        idx[t++] = a;
        idx[t++] = c;
        idx[t++] = b;
        idx[t++] = b;
        idx[t++] = c;
        idx[t++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aTrk', new THREE.BufferAttribute(trk, 4));
    g.setAttribute('aK', new THREE.BufferAttribute(kk, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, grassMaterial(A, true));
    ground.name = 'mz_ground';
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    group.add(ground);
  }
  yield { group, step: 'ground' };

  // ------------------------------------------------------------------ the grandstands
  const standAt = (j: number, side: number, beyond: number) => STANDS.some(([a, b, sd, rows]) => sd === side && inSpan(j, a - 8, b + 8) && beyond < STAND_GAP + rows * ROW_D + 9);
  {
    const crowd = new THREE.MeshLambertMaterial({ map: A.crowd, side: THREE.DoubleSide });
    const conc = concreteMaterial(A);
    const roofMat = paintedSteel(0xd9dbdd, 0.6);
    roofMat.side = THREE.DoubleSide;
    const frame = paintedSteel(0x2c3036, 0.55);
    const gc = new Geo(), gw = new Geo(), gr = new Geo(), gf = new Geo();
    const P = (i: number, lat: number, y: number) => {
      const j = wrap(i);
      return new THREE.Vector3(track.px[j] + track.rx[j] * lat, track.py[j] + y, track.pz[j] + track.rz[j] * lat);
    };
    const Y = new THREE.Vector3(0, 1, 0);
    for (const [a, b, side, rows, roofed] of STANDS) {
      const len = wrap(b - a);
      const segs = Math.max(1, Math.round(len / 6));
      const depth = rows * ROW_D, rise = rows * ROW_H;
      // (the rake's normal: up and toward the track)
      for (let k = 0; k < segs; k++) {
        const i0 = a + (len * k) / segs, i1 = a + (len * (k + 1)) / segs;
        const j0 = wrap(Math.round(i0)), j1 = wrap(Math.round(i1));
        const f0 = (side < 0 ? track.barrierL[j0] : track.barrierR[j0]) + STAND_GAP, f1 = (side < 0 ? track.barrierL[j1] : track.barrierR[j1]) + STAND_GAP;
        const toTrack = new THREE.Vector3(-side * track.rx[j0], 0, -side * track.rz[j0]);
        const rakeN = toTrack.clone().multiplyScalar(ROW_H).add(new THREE.Vector3(0, ROW_D, 0)).normalize();
        const u0 = (len * k) / segs / 27, u1 = (len * (k + 1)) / segs / 27;
        // the crowd, on the rake
        const c = [gc.vert(P(j0, side * f0, STAND_BASE), rakeN, u0, 0), gc.vert(P(j1, side * f1, STAND_BASE), rakeN, u1, 0), gc.vert(P(j1, side * (f1 + depth), STAND_BASE + rise), rakeN, u1, 1), gc.vert(P(j0, side * (f0 + depth), STAND_BASE + rise), rakeN, u0, 1)];
        gc.quad(c[0], c[1], c[2], c[3], rakeN);
        // the front wall, the back wall
        const fw = [gw.vert(P(j0, side * f0, -0.4), toTrack, i0 / 2, 0, [STAND_BASE, i0, 0, 0]), gw.vert(P(j1, side * f1, -0.4), toTrack, i1 / 2, 0, [STAND_BASE, i1, 0, 0]), gw.vert(P(j1, side * f1, STAND_BASE + 0.05), toTrack, i1 / 2, 1, [0, i1, 0, 0]), gw.vert(P(j0, side * f0, STAND_BASE + 0.05), toTrack, i0 / 2, 1, [0, i0, 0, 0])];
        gw.quad(fw[0], fw[1], fw[2], fw[3], toTrack);
        const away = toTrack.clone().negate();
        const top = STAND_BASE + rise + 1.1;
        const bw = [gw.vert(P(j0, side * (f0 + depth), -0.4), away, i0 / 2, 0, [top, i0, 0, 0]), gw.vert(P(j1, side * (f1 + depth), -0.4), away, i1 / 2, 0, [top, i1, 0, 0]), gw.vert(P(j1, side * (f1 + depth), top), away, i1 / 2, top / 2, [0, i1, 0, 0]), gw.vert(P(j0, side * (f0 + depth), top), away, i0 / 2, top / 2, [0, i0, 0, 0])];
        gw.quad(bw[0], bw[1], bw[2], bw[3], away);
        if (roofed) {
          // a cantilever roof over the seats, tipped up toward the track, on a column at the back every bay
          const ry0 = STAND_BASE + rise + 4.2, ry1 = ry0 + 1.6;
          const r = [gr.vert(P(j0, side * (f0 - 1.5), ry1), Y, 0, 0), gr.vert(P(j1, side * (f1 - 1.5), ry1), Y, 1, 0), gr.vert(P(j1, side * (f1 + depth + 0.8), ry0), Y, 1, 1), gr.vert(P(j0, side * (f0 + depth + 0.8), ry0), Y, 0, 1)];
          gr.quad(r[0], r[1], r[2], r[3], Y);
          const along = new THREE.Vector3(track.tx[j0], 0, track.tz[j0]).normalize();
          gf.box(P(j0, side * (f0 + depth + 0.2), -0.4), toTrack.clone().negate(), Y, along, 0.3, ry0 + 0.4, 0.3);
          // the raker under the roof
          const from = P(j0, side * (f0 + depth + 0.3), ry0 - 0.25), to = P(j0, side * (f0 - 1.3), ry1 - 0.25);
          const dir = to.clone().sub(from);
          const lenR = dir.length();
          dir.normalize();
          gf.box(from, dir, new THREE.Vector3(0, 1, 0), along, lenR, 0.22, 0.16);
        }
      }
      // the two ends
      for (const [i, sgn] of [[a, -1], [b, 1]] as const) {
        const j = wrap(Math.round(i));
        const f = (side < 0 ? track.barrierL[j] : track.barrierR[j]) + STAND_GAP;
        const nrm = new THREE.Vector3(track.tx[j], 0, track.tz[j]).normalize().multiplyScalar(sgn);
        const e = [gw.vert(P(j, side * f, -0.4), nrm, 0, 0, [2, i, 0, 0]), gw.vert(P(j, side * (f + depth), -0.4), nrm, depth / 2, 0, [2, i, 0, 0]), gw.vert(P(j, side * (f + depth), STAND_BASE + rise + 1.1), nrm, depth / 2, 4, [0, i, 0, 0]), gw.vert(P(j, side * f, STAND_BASE), nrm, 0, 1, [0, i, 0, 0])];
        gw.quad(e[0], e[1], e[2], e[3], nrm);
      }
    }
    const add = (g: Geo, m: THREE.Material, cast: boolean, name: string) => {
      if (!g.count) return;
      const mesh = new THREE.Mesh(g.build(), m);
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    add(gc, crowd, false, 'mz_crowd');
    add(gw, conc, true, 'mz_stand');
    add(gr, roofMat, true, 'mz_roof');
    add(gf, frame, true, 'mz_frame');
  }
  yield { group, step: 'stands' };

  // ------------------------------------------------------------------ the woods
  let treeCount = 0;
  {
    let seed = 0x51ed2701;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const CELL = 7.5, REGION = 260;
    const regions = new Map<string, number[]>();
    for (let z = df.originZ; z < df.originZ + df.h * df.cell; z += CELL) {
      for (let x = df.originX; x < df.originX + df.w * df.cell; x += CELL) {
        const tx = x + rnd() * CELL, tz = z + rnd() * CELL;
        const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
        const q = probe(tx, tz);
        if (!q || q.beyond < 9 || q.beyond > 270) continue;
        if (standAt(q.j, q.side, q.beyond)) continue;
        // dense by the track (the wall of the park), thinning into the woods where nobody sees between the trunks
        const p = q.beyond < 45 ? 0.8 : q.beyond < 120 ? 0.5 : 0.3;
        if (r1 > p) continue;
        const hgt = (11 + 9 * r2) * (q.beyond < 16 ? 0.78 : 1);
        const key = `${Math.floor(tx / REGION)},${Math.floor(tz / REGION)}`;
        let list = regions.get(key);
        if (!list) regions.set(key, (list = []));
        // (the photos are lit bright and vivid; a wood in daylight is deeper and greyer than a specimen tree)
        const shade = 0.5 + 0.2 * r4;
        // x, y, z, w, h, cell, flip, tint
        list.push(tx, heightAt(tx, tz) - 0.15, tz, hgt * (0.6 + 0.12 * r3), hgt, Math.floor(r1 * 97) % 4, r4 > 0.5 ? 1 : 0, shade * (1.0 + 0.1 * r2), shade * 0.97, shade * (0.8 + 0.12 * r3));
      }
    }
    const VERT_PARS = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aDim;
attribute vec3 aTint;
varying vec3 vTint;
`;
    const VERT_UV = /* glsl */ `
vec3 bbTo = cameraPosition - aBase;
bbTo.y = 0.0;
bbTo = normalize( bbTo );
vec3 bbR = vec3( bbTo.z, 0.0, - bbTo.x );
#ifdef USE_MAP
  vMapUv = vec2( ( aDim.z + ( aDim.w > 0.5 ? 1.0 - uv.x : uv.x ) ) * 0.25, uv.y );
#endif
`;
    const VERT_POS = /* glsl */ `vec3 transformed = aBase + bbR * ( position.x * aDim.x ) + vec3( 0.0, position.y * aDim.y, 0.0 );`;
    const treeMat = new THREE.MeshLambertMaterial({ map: A.trees, alphaTest: 0.4, side: THREE.DoubleSide });
    treeMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_UV + 'vTint = aTint;')
        // a crown is a ball of leaves, not a card: the light falls across it as across a sphere
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize( bbR * ( uv.x - 0.5 ) * 0.55 + vec3( 0.0, 1.0, 0.0 ) * ( 0.75 + 0.5 * uv.y ) + bbTo * 0.2 );')
        .replace('#include <begin_vertex>', VERT_POS);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTint;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) ) ), diffuseColor.rgb, 0.72 ) * vTint;');
    };
    treeMat.customProgramCacheKey = () => 'mz-tree-4';
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: A.trees, alphaTest: 0.4 });
    depthMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBase;\nattribute vec4 aDim;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_UV)
        .replace('#include <begin_vertex>', VERT_POS);
    };
    depthMat.customProgramCacheKey = () => 'mz-tree-depth-2';
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    for (const list of regions.values()) {
      const m = list.length / 10;
      treeCount += m;
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index;
      g.setAttribute('position', quad.getAttribute('position'));
      g.setAttribute('normal', quad.getAttribute('normal'));
      g.setAttribute('uv', quad.getAttribute('uv'));
      const base = new Float32Array(m * 3), dim = new Float32Array(m * 4), tint = new Float32Array(m * 3);
      const box = new THREE.Box3();
      for (let k = 0; k < m; k++) {
        const o = k * 10;
        base.set([list[o], list[o + 1], list[o + 2]], k * 3);
        dim.set([list[o + 3], list[o + 4], list[o + 5], list[o + 6]], k * 4);
        tint.set([list[o + 7], list[o + 8], list[o + 9]], k * 3);
        box.expandByPoint(new THREE.Vector3(list[o] - 10, list[o + 1], list[o + 2] - 10));
        box.expandByPoint(new THREE.Vector3(list[o] + 10, list[o + 1] + list[o + 4], list[o + 2] + 10));
      }
      g.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
      g.setAttribute('aDim', new THREE.InstancedBufferAttribute(dim, 4));
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      g.instanceCount = m;
      g.boundingBox = box;
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(g, treeMat);
      mesh.name = 'mz_trees';
      mesh.customDepthMaterial = depthMat;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  yield { group, step: 'trees' };

  // ------------------------------------------------------------------ the far wall of woodland, round the horizon
  {
    const cx = df.originX + (df.w * df.cell) / 2, cz = df.originZ + (df.h * df.cell) / 2;
    const rx = (df.w * df.cell) / 2 - 40, rz = (df.h * df.cell) / 2 - 40;
    const mat = new THREE.MeshLambertMaterial({ map: A.treeline, alphaTest: 0.35, side: THREE.DoubleSide });
    const g = new Geo();
    const SEG = 96, H = 34;
    const Y = new THREE.Vector3(0, 1, 0);
    let u = 0;
    let prev: THREE.Vector3 | null = null;
    const ring: [THREE.Vector3, number][] = [];
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      // (a rounded rectangle: the wall keeps its distance from the long straights and from the ends)
      const c = Math.cos(a), s = Math.sin(a);
      const e = 4;
      const rr = 1 / Math.pow(Math.pow(Math.abs(c), e) + Math.pow(Math.abs(s), e), 1 / e);
      const p = new THREE.Vector3(cx + c * rr * rx, meanY - 1, cz + s * rr * rz);
      if (prev) u += p.distanceTo(prev) / (H * 3.6);
      ring.push([p, u]);
      prev = p;
    }
    for (let k = 0; k + 1 < ring.length; k++) {
      const [p0, u0] = ring[k], [p1, u1] = ring[k + 1];
      const v = [g.vert(p0, Y, u0, 0), g.vert(p1, Y, u1, 0), g.vert(p1.clone().setY(p1.y + H), Y, u1, 1), g.vert(p0.clone().setY(p0.y + H), Y, u0, 1)];
      g.quad(v[0], v[1], v[2], v[3]);
    }
    const mesh = new THREE.Mesh(g.build(), mat);
    mesh.name = 'mz_horizon';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
  yield { group, step: 'horizon' };

  return {
    group,
    heightAt,
    setLight() {},
    update() {},
    setQuality() {},
    stats: { trees: treeCount, buildMs: Math.round(performance.now() - t0) },
  };
}
