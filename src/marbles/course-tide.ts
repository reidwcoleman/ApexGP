import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CourseBuilder } from './builder.ts';
import { Mat } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { signTexture } from './obstacles.ts';
import { lake, paintLakeFor } from './env.ts';
import { BIOMES } from './biome.ts';
import { addStrikes, type Hit3, type Strikes } from './course-strikes.ts';

/**
 * High Tide: a reef of hexagonal coral columns standing out of the sea, every one a step (a hop)
 * higher than its lower neighbour, up to a few tall ones near the middle. The tide comes in a step
 * at a time; whoever it reaches is out. Climb, and keep your spot when everyone else wants it.
 */

export const TIDE = { pitch: 3.3, rings: 4, step: 0.9, every: 16, rise: 3, wait: 6 };

export interface TideArena {
  center: THREE.Vector3;
  /** the columns' tops (world) */
  cols: { x: number; z: number; y: number }[];
  /** the sea's height at a time */
  level(t: number): number;
  /** the blowholes: a column goes up like a whale's spout, and whoever's on it with it */
  jets: Strikes;
}

export function tide(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const state = { go: 1e9 };
  const { pitch, rings, step } = TIDE;
  // the columns on a hex grid (axial coords), each a whole number of steps tall
  let sd = 4517;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const cols: { x: number; z: number; y: number; h: number }[] = [];
  for (let q = -rings; q <= rings; q++)
    for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const x = pitch * (q + r / 2), z = pitch * ((Math.sqrt(3) / 2) * r);
      // (tallest in the middle, a step down each ring out, give or take one)
      let h = 7 - ring - (rnd() < 0.35 ? 1 : 0) + (ring > 1 && rnd() < 0.18 ? 1 : 0);
      if (ring === 0) h = 7;
      h = Math.max(1, h);
      cols.push({ x: center.x + x, z: center.z + z, y: center.y + h * step, h });
    }
  const base = center.y;
  // the sea: starts a little under the lowest tops and comes in a step at a time
  const y0 = base + 0.2;
  const level = (t: number) => {
    const x = t - state.go - TIDE.wait;
    if (x < 0) return y0;
    const n = Math.floor(x / TIDE.every), u = x - n * TIDE.every;
    return y0 + step * (n + THREE.MathUtils.smootherstep(u, 0, TIDE.rise));
  };
  // the columns: hexagonal prisms down into the sea; tops sandy coral, sides banded
  {
    const geos: THREE.BufferGeometry[] = [];
    const R = pitch / Math.sqrt(3) - 0.03;
    const topCols = [0xffd8a8, 0xffb0a0, 0xffc890, 0xffa8c0, 0xb8f0e0, 0xd8c8ff, 0xfff0c0];
    const c = new THREE.Color();
    for (const k of cols) {
      const H = k.y - (base - 40);
      const g = new THREE.CylinderGeometry(R, R * 1.02, H, 6, 1, false).rotateY(Math.PI / 6).translate(k.x, k.y - H / 2, k.z);
      const ng = g.toNonIndexed();
      const p = ng.getAttribute('position');
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i += 3) {
        const yc = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
        if (yc > k.y - 0.01) c.set(topCols[k.h % topCols.length]);
        else {
          const d = k.y - yc;
          c.set(d < 0.25 ? 0xfff4e0 : Math.floor((yc - base) / step + 100) % 2 ? 0xd88a6a : 0xc87458);
          if (yc < base) c.lerp(new THREE.Color(0x2a6a7a), Math.min(1, (base - yc) / 8));
        }
        for (let j = 0; j < 3; j++) c.toArray(col, (i + j) * 3);
      }
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(ng);
      b.world.statics.addGeometry(g, Mat.Paint);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.35, flatShading: true }));
    mesh.castShadow = mesh.receiveShadow = true;
    b.group.add(mesh);
    // a step number on each top (so you can see how high it is)
    const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), cols.reduce((a, k) => a + k.h, 0));
    const M = new THREE.Matrix4();
    let n = 0;
    for (const k of cols)
      for (let i = 0; i < k.h; i++) {
        const a = (i / k.h) * Math.PI * 2;
        dots.setMatrixAt(n++, M.makeTranslation(k.x + Math.cos(a) * 0.55 * (k.h > 1 ? 1 : 0), k.y + 0.015, k.z + Math.sin(a) * 0.55 * (k.h > 1 ? 1 : 0)));
      }
    b.group.add(dots);
  }
  // the sea
  b.lakeY = base - 40;
  const sea = lake(y0);
  paintLakeFor(sea, BIOMES.reef);
  sea.receiveShadow = true;
  b.group.add(sea);
  const su = sea.userData.u as { uTime: { value: number } };
  // (foam rings round the columns at the waterline)
  const foam = new THREE.InstancedMesh(new THREE.RingGeometry(pitch / Math.sqrt(3) - 0.02, pitch / Math.sqrt(3) + 0.35, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, depthWrite: false }), cols.length);
  foam.frustumCulled = false;
  b.group.add(foam);
  const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3();
  b.animators.push((t) => {
    su.uTime.value = t;
    const L = level(t);
    sea.position.y = L;
    cols.forEach((k, i) => {
      const under = k.y < L - 0.05;
      V.set(k.x, L + 0.03, k.z);
      foam.setMatrixAt(i, M.compose(V, Q, under ? Z : S.setScalar(1 + 0.06 * Math.sin(t * 3 + i))));
    });
    foam.instanceMatrix.needsUpdate = true;
  });
  // the name
  {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: signTexture(info.name.toUpperCase(), 'Survival · Climb above the tide', 0x10c0b0, 9 / 1.7), transparent: true }));
    sign.position.set(center.x, center.y + 12, center.z - 22);
    b.group.add(sign);
  }
  const reach = pitch * rings + 2;
  dressArena(b, new THREE.Vector3(center.x, center.y - 1, center.z), reach + 3, 21);
  b.finish();
  // the blowholes: a column every few seconds, more as it goes on (seeded: the same in every browser)
  const jetList: Hit3[] = [];
  {
    let js = 91733;
    const jr = () => ((js = (js * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 8; k++) jr();
    for (let t = 8; t < 160; t += Math.max(1.6, 3.6 - t * 0.02) * (0.8 + jr() * 0.4)) {
      const k = cols[Math.floor(jr() * cols.length)];
      jetList.push({ t, x: k.x, y: k.y, z: k.z, r: 1.6 });
    }
  }
  const jets = addStrikes(b, { list: jetList, warn: 1.4, state, ring: 0x40e0ff, jet: 0xd8f6ff, box: [new THREE.Vector3(center.x - 20, center.y - 2, center.z - 20), new THREE.Vector3(center.x + 20, center.y + 12, center.z + 20)], out: 5, up: 12 });
  const arena: TideArena = { center, cols, level, jets };
  const world = b.world;
  const outer = cols.filter((k) => Math.hypot(k.x - center.x, k.z - center.z) > pitch * (rings - 1.5)).sort((p, q) => Math.atan2(p.z - center.z, p.x - center.x) - Math.atan2(q.z - center.z, q.x - center.x));
  return {
    id: 'hightide',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    // (out once the sea is up to your middle)
    get killY() {
      return Math.max(base - 30, level(world.time) - 0.15);
    },
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const c = outer[Math.floor((k * outer.length) / Math.max(n, 1)) % outer.length];
        const p = new THREE.Vector3(c.x, c.y + 0.55, c.z);
        out.push({ pos: p, yaw: Math.atan2(center.x - p.x, center.z - p.z) });
      }
      return out;
    },
    plate: { center: new THREE.Vector3(center.x, center.y + 3, center.z), radius: reach, bars: [] },
    tide: arena,
    intro: [],
  };
}
