/**
 * The edge of the lawn: wherever a tile meets the outside, a timber fence, a clipped hedge (a row
 * of the scanned bushes) or a dry-stone wall stands on the line, a stone kerb where the patio
 * begins, nothing where the house wall is. All runs of one material are merged into one mesh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelDef } from './levels.ts';
import { TS } from './nav.ts';
import { pbrMaterial } from './assets.ts';
import { Rng } from './util.ts';
import { SHRUBS, type TreePlacement } from './trees.ts';
import type { Scenery } from './scenery.ts';

type Style = 'timber' | 'hedge' | 'stone' | 'kerb';
interface Run {
  /** along x (a horizontal edge) or along z */
  h: boolean;
  /** the line's coordinate (z for a horizontal run, x for a vertical one) */
  line: number;
  a: number;
  b: number;
  /** +1 / -1: which way is outside */
  out: number;
  style: Style;
}

function runs(level: LevelDef): Run[] {
  const { w, h, nav, house } = level;
  const W = w * TS;
  const H = h * TS;
  type E = { h: boolean; line: number; out: number; a: number; b: number };
  const edges: E[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!nav.tile(i, j)) continue;
      const x0 = i * TS - W / 2;
      const z0 = j * TS - H / 2;
      if (!nav.tile(i, j - 1)) edges.push({ h: true, line: z0, out: -1, a: x0, b: x0 + TS });
      if (!nav.tile(i, j + 1)) edges.push({ h: true, line: z0 + TS, out: 1, a: x0, b: x0 + TS });
      if (!nav.tile(i - 1, j)) edges.push({ h: false, line: x0, out: -1, a: z0, b: z0 + TS });
      if (!nav.tile(i + 1, j)) edges.push({ h: false, line: x0 + TS, out: 1, a: z0, b: z0 + TS });
    }
  }
  // merge touching edges on the same line
  edges.sort((p, q) => (p.h === q.h ? (p.line - q.line || p.out - q.out || p.a - q.a) : p.h ? -1 : 1));
  const merged: E[] = [];
  for (const e of edges) {
    const l = merged[merged.length - 1];
    if (l && l.h === e.h && Math.abs(l.line - e.line) < 1e-6 && l.out === e.out && Math.abs(l.b - e.a) < 1e-6) l.b = e.b;
    else merged.push({ ...e });
  }
  const rng = new Rng(level.seed * 3 + 11);
  const styleFor = (): Style => {
    switch (level.fence) {
      case 'timber':
        return 'timber';
      case 'hedge':
        return 'hedge';
      case 'stone':
        return 'stone';
      default:
        return rng.pick<Style>(['timber', 'hedge', 'stone']);
    }
  };
  const out: Run[] = [];
  for (const e of merged) {
    // the patio's edges are kerbs; the house wall takes the back edge
    let cuts: [number, number][] = [];
    let style: Style | null = null;
    if (house) {
      const patio = (x: number, z: number) => x >= house.px0 - 0.01 && x <= house.px1 + 0.01 && z >= house.z - 0.01 && z <= house.pz1 + 0.01;
      const mx = e.h ? (e.a + e.b) / 2 : e.line + e.out * 0.5;
      const mz = e.h ? e.line + e.out * 0.5 : (e.a + e.b) / 2;
      if (patio(mx, mz)) style = 'kerb';
      if (e.h && e.out === -1 && Math.abs(e.line - house.z) < 1e-6) cuts = [[house.x0, house.x1]];
    }
    const pieces: [number, number][] = [];
    let cur = e.a;
    for (const [c0, c1] of cuts.sort((p, q) => p[0] - q[0])) {
      if (c0 > cur) pieces.push([cur, Math.min(c0, e.b)]);
      cur = Math.max(cur, c1);
    }
    if (cur < e.b) pieces.push([cur, e.b]);
    const s = style ?? styleFor();
    for (const [a, b] of pieces) if (b - a > 0.05) out.push({ h: e.h, line: e.line, a, b, out: e.out, style: s });
  }
  return out;
}

/** a box merged into a list, its uv mapped for a scanned texture (`u0..u0+du` across, `v0..v0+dv` up) */
function box(list: THREE.BufferGeometry[], w: number, hh: number, d: number, x: number, y: number, z: number, uvScale: number, u0 = 0, v0 = 0) {
  const g = new THREE.BoxGeometry(w, hh, d);
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    // metric uv from the face's own axes
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    let a: number;
    let b: number;
    if (nx > 0.5) {
      a = pos.getZ(i) + d / 2 + u0;
      b = pos.getY(i) + hh / 2 + v0;
    } else if (ny > 0.5) {
      a = pos.getX(i) + w / 2 + u0;
      b = pos.getZ(i) + d / 2 + v0;
    } else {
      a = pos.getX(i) + w / 2 + u0;
      b = pos.getY(i) + hh / 2 + v0;
    }
    uv.setXY(i, a * uvScale, b * uvScale);
  }
  g.translate(x, y, z);
  list.push(g);
}

export async function buildBoundary(level: LevelDef): Promise<{ scenery: Scenery; trees: TreePlacement[] }> {
  const rs = runs(level);
  const rng = new Rng(level.seed * 17 + 3);
  const fenceG: THREE.BufferGeometry[] = [];
  const stoneG: THREE.BufferGeometry[] = [];
  const capG: THREE.BufferGeometry[] = [];
  const kerbG: THREE.BufferGeometry[] = [];
  const trees: TreePlacement[] = [];
  const tint = level.theme.leafTint;
  for (const r of rs) {
    const len = r.b - r.a;
    const mid = (r.a + r.b) / 2;
    // world position along the run
    const P = (t: number, off: number): [number, number] => (r.h ? [t, r.line + r.out * off] : [r.line + r.out * off, t]);
    if (r.style === 'timber') {
      const H = 1.55;
      const pw = 0.105;
      const pitch = 0.112;
      const n = Math.floor(len / pitch);
      for (let i = 0; i < n; i++) {
        const t = r.a + (i + 0.5) * (len / n);
        const [x, z] = P(t, 0.085);
        const hv = H + rng.range(-0.03, 0.03);
        if (r.h) box(fenceG, pw, hv, 0.03, x, hv / 2, z, 0.8, rng.range(0, 2), 0);
        else box(fenceG, 0.03, hv, pw, x, hv / 2, z, 0.8, rng.range(0, 2), 0);
      }
      // rails behind, posts every 2.4 m
      for (const y of [0.35, 1.2]) {
        const [x, z] = P(mid, 0.045);
        if (r.h) box(fenceG, len, 0.09, 0.045, x, y, z, 0.8);
        else box(fenceG, 0.045, 0.09, len, x, y, z, 0.8);
      }
      const posts = Math.max(2, Math.round(len / 2.4) + 1);
      for (let i = 0; i < posts; i++) {
        const t = r.a + (i / (posts - 1)) * len;
        const [x, z] = P(t, 0.0);
        box(fenceG, 0.1, 1.72, 0.1, x, 0.86, z, 0.8, rng.range(0, 3));
        box(capG, 0.13, 0.04, 0.13, x, 1.74, z, 1);
      }
    } else if (r.style === 'stone') {
      const [x, z] = P(mid, 0.17);
      if (r.h) box(stoneG, len, 0.95, 0.32, x, 0.475, z, 0.9);
      else box(stoneG, 0.32, 0.95, len, x, 0.475, z, 0.9);
      if (r.h) box(capG, len + 0.06, 0.06, 0.4, x, 0.98, z, 1.2);
      else box(capG, 0.4, 0.06, len + 0.06, x, 0.98, z, 1.2);
      const posts = Math.max(2, Math.round(len / 3) + 1);
      for (let i = 0; i < posts; i++) {
        const t = r.a + (i / (posts - 1)) * len;
        const [px, pz] = P(t, 0.17);
        box(stoneG, 0.46, 1.1, 0.46, px, 0.55, pz, 0.9, i);
        box(capG, 0.54, 0.07, 0.54, px, 1.13, pz, 1.2);
      }
    } else if (r.style === 'kerb') {
      const [x, z] = P(mid, 0.06);
      if (r.h) box(kerbG, len, 0.1, 0.16, x, 0.05, z, 1);
      else box(kerbG, 0.16, 0.1, len, x, 0.05, z, 1);
    } else {
      // a clipped hedge: a row of the scanned bushes, packed close
      const step = 0.5;
      const n = Math.max(1, Math.round(len / step));
      for (let i = 0; i < n; i++) {
        const t = r.a + (i + 0.5) * (len / n);
        const [x, z] = P(t, 0.34 + rng.range(-0.04, 0.05));
        const k = 0.66 + rng.range(0, 0.12);
        const tt = (c: number) => 1 + (c - 1) * 0.5;
        trees.push({ proto: SHRUBS[rng.int(0, SHRUBS.length - 1)], x, z, s: k, rot: rng.range(0, 6.28), tint: [tt(tint[0]) * 0.62, tt(tint[1]) * 0.8, tt(tint[2]) * 0.58], lod: 0, shade: false, fade: false });
      }
    }
  }

  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const add = async (list: THREE.BufferGeometry[], key: string, opts: { color?: THREE.ColorRepresentation; roughness?: number } = {}) => {
    if (!list.length) return;
    const g = mergeGeometries(list, false)!;
    list.forEach((x) => x.dispose());
    geos.push(g);
    const m = await pbrMaterial(key, opts);
    mats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  await add(fenceG, 'fence', { color: '#e9e2d6', roughness: 1 });
  await add(stoneG, 'stonewall', {});
  await add(capG, 'paving', { color: '#d8d4cc' });
  await add(kerbG, 'paving', {});
  return {
    scenery: {
      group,
      dispose() {
        geos.forEach((g) => g.dispose());
        mats.forEach((m) => m.dispose());
      },
    },
    trees,
  };
}
