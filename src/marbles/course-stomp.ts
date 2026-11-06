import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, Mode, RUN, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { ringGrid, title } from './course-modes.ts';

/**
 * Stomp Town: a toy town, and everyone gets a turn as a giant. A few beans at a time grow to five
 * times their size for one wave and have the run of the place: anyone under foot goes flat, a jump
 * or a belly flop lands with a shockwave, and the houses go down like blocks. Everyone else runs.
 * Points for what you flatten as a giant, points for every wave you get through unflattened as a
 * small one, and the town rebuilds itself for the next lot.
 *
 * Who's a giant when comes from the clock and the round's key, the same in every browser. Each
 * browser decides for its own beans whether they've been stepped on, and for its own giants what
 * they've knocked down; the host keeps the score.
 */
export const STOMP = {
  T: 90,
  /** the head start before the first giants, and how long before a wave its giants are marked */
  lead: 3,
  mark: 2.6,
  /** half the town's width, and the grid the houses stand on */
  H: 32,
  cell: 8,
  /** how many giants at most, how many waves at most, and the longest a wave can be */
  waves: 6,
  longest: 18,
  scale: 5,
  /** what's under a giant's foot, and how high it has to be to miss you */
  foot: 2.6,
  clear: 2.2,
  run: 13.2,
  jump: 1.6,
  flopV: 19,
  flopUp: 10,
  flopCD: 2.6,
  /** a landing: flat within this, thrown clear within that */
  hit: 4.6,
  blast: 9.5,
  flopHit: 6.6,
  flopBlast: 12.5,
  /** how long a landing needs in the air, to be one */
  air: 0.34,
  /** seconds it takes to grow, and to shrink back */
  grow: 0.8,
  shrink: 0.45,
  /** flat for this long, then a moment no one can flatten you again */
  flat: 1.25,
  safe: 2.4,
  /** the points */
  squash: 100,
  house: 20,
  survive: 50,
  squashed: 30,
};

export interface House {
  k: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  color: number;
  roof: number;
  kin: Kin;
  gone: boolean;
  /** coming back up since (world time) */
  up: number;
}

export interface StompArena {
  center: THREE.Vector3;
  H: number;
  houses: House[];
  /** who's a giant in each wave, and how long a wave is */
  turns: number[][];
  W: number;
  /** when the last wave is done (seconds after the off) */
  end: number;
  /** deal the turns: the same ids and key give the same turns in every browser */
  deal(ids: number[], people: number[], key: number): void;
  wave(x: number): number;
  /** seconds into the wave at x */
  into(x: number): number;
  isGiant(id: number, x: number): boolean;
  /** 0..1: how grown this wave's giants are at x */
  size(x: number): number;
  /** flat until (world time), can't be flattened until */
  flat: Map<number, number>;
  safe: Map<number, number>;
  /** a house down */
  fell(k: number): void;
  /** the town rebuilds */
  rebuild(t: number): void;
  /** a house in the way of (x, z), within `pad` */
  blocked(x: number, z: number, pad: number): boolean;
  /** belly flops in the air, by bean id */
  flops: Set<number>;
  /** any house between the camera and you dissolves */
  view(cam: THREE.Vector3, at: THREE.Vector3, dt: number): void;
}

function townArt() {
  const { H, cell } = STOMP;
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const k = S / (2 * H);
  x.fillStyle = '#6d7686';
  x.fillRect(0, 0, S, S);
  // the blocks of grass between the streets, each with a pale kerb
  const n = (2 * H) / cell;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const px = i * cell * k, pz = j * cell * k, w = cell * k, m = 1.05 * k;
      const plaza = Math.abs(i - n / 2 + 0.5) < 1.1 && Math.abs(j - n / 2 + 0.5) < 1.1;
      if (plaza) continue;
      x.fillStyle = '#f2e6c9';
      x.fillRect(px + m - 7, pz + m - 7, w - 2 * m + 14, w - 2 * m + 14);
      x.fillStyle = (i + j) % 2 ? '#6fd26a' : '#63c85e';
      x.fillRect(px + m, pz + m, w - 2 * m, w - 2 * m);
    }
  // the dashes down the streets
  x.fillStyle = '#ffe58a';
  for (let i = 0; i <= n; i++)
    for (let s = 0; s < 96; s += 2) {
      const a = i * cell * k, u = (s / 96) * S;
      x.fillRect(a - 3, u, 6, 12);
      x.fillRect(u, a - 3, 12, 6);
    }
  // the square in the middle
  const p = S / 2, r = 2 * cell * k - 1.05 * k;
  x.fillStyle = '#f4d9a8';
  x.fillRect(p - r, p - r, r * 2, r * 2);
  x.strokeStyle = '#ff6a5a';
  x.lineWidth = 12;
  x.beginPath();
  x.arc(p, p, r * 0.76, 0, 7);
  x.stroke();
  x.strokeStyle = '#3fb4ff';
  x.beginPath();
  x.arc(p, p, r * 0.5, 0, 7);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function wallArt() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 3; j++) {
      x.fillStyle = '#38506e';
      x.fillRect(38 + i * 112, 22 + j * 76, 68, 50);
      x.fillStyle = '#ffe9a0';
      x.fillRect(44 + i * 112, 28 + j * 76, 56, 38);
      x.fillStyle = '#ffffff';
      x.fillRect(70 + i * 112, 28 + j * 76, 4, 38);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const HOUSE_COLS = [0xff7a6a, 0xffc24a, 0x5ac8ff, 0xb68aff, 0x7ee08a, 0xff9ad0, 0xfff0d0];
const ROOF_COLS = [0xd8433f, 0x3a6fd8, 0x2fa86a, 0x8a4ac8, 0xe08a2a];

export function stompTown(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 110, 0);
  const y0 = center.y, cx = center.x, cz = center.z;
  const { H, cell } = STOMP;
  const state = { go: 1e9 };
  b.lakeY = y0 - 28;
  let sd = 77123;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  // ---- the ground and the walls round it (tall, unseen: no one leaves town, giant or not)
  {
    const g = new THREE.PlaneGeometry(H * 2, H * 2).rotateX(-Math.PI / 2).translate(cx, y0, cz);
    b.world.statics.addGeometry(g, Mat.Wood);
    const floor = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: townArt(), roughness: 0.82 }));
    floor.receiveShadow = true;
    b.group.add(floor);
    const base = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 3, 6, H * 2 + 3).translate(cx, y0 - 3.05, cz), new THREE.MeshStandardMaterial({ color: 0xffb04a, roughness: 0.6 }));
    b.group.add(base);
    const hedge = new THREE.MeshStandardMaterial({ color: 0x3fae5a, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const wa = new THREE.BoxGeometry(H * 2 + 3, 60, 1).translate(cx, y0 + 30, cz + s * (H + 0.5));
      const wb = new THREE.BoxGeometry(1, 60, H * 2 + 3).translate(cx + s * (H + 0.5), y0 + 30, cz);
      b.world.statics.addGeometry(wa, Mat.Wood);
      b.world.statics.addGeometry(wb, Mat.Wood);
      const ha = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 3, 2, 1.5).translate(cx, y0 + 1, cz + s * (H + 0.75)), hedge);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, H * 2 + 3).translate(cx + s * (H + 0.75), y0 + 1, cz), hedge);
      ha.castShadow = hb.castShadow = true;
      b.group.add(ha, hb);
    }
  }
  // ---- the houses: boxes and pointy roofs, from a toy box. Colliders the giants go through
  const houses: House[] = [];
  const n = (2 * H) / cell;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (Math.abs(i - n / 2 + 0.5) < 1.1 && Math.abs(j - n / 2 + 0.5) < 1.1) continue;
      if (rnd() < 0.27) continue;
      const x = cx - H + (i + 0.5) * cell + (rnd() - 0.5) * 0.5, z = cz - H + (j + 0.5) * cell + (rnd() - 0.5) * 0.5;
      const hx = 1.7 + rnd() * 0.7, hz = 1.7 + rnd() * 0.7, h = 2.6 + rnd() * 1.9;
      const q: House = {
        k: houses.length, x, z, hx, hz, h,
        color: HOUSE_COLS[Math.floor(rnd() * HOUSE_COLS.length)],
        roof: ROOF_COLS[Math.floor(rnd() * ROOF_COLS.length)],
        gone: false, up: -9,
        kin: new Kin({ type: 'box', hx, hy: h / 2, hz }, Mat.Wood, (t, p) => {
          const u = Math.min(1, (t - q.up) / 0.5);
          p.set(x, y0 + h / 2 - h * (1 - u) * (1 - u), z);
        }),
      };
      b.world.addKin(q.kin);
      houses.push(q);
    }
  const N = houses.length;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ map: wallArt(), roughness: 0.55 }), N);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.76, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.5, flatShading: true }), N);
  // (how solid each house is: a screen door of pixels, so there's nothing to sort)
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(N).fill(1), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  for (const q of [walls, roofs]) {
    q.geometry.setAttribute('aFade', fade);
    (q.material as THREE.Material).onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < 0.99 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;');
    };
  }
  walls.castShadow = roofs.castShadow = walls.receiveShadow = true;
  walls.frustumCulled = roofs.frustumCulled = false;
  b.group.add(walls, roofs);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), C = new THREE.Color();
  const draw = (q: House, t: number) => {
    const u = q.gone ? 0 : Math.min(1, (t - q.up) / 0.5);
    const e = u <= 0 ? 0 : 1 - (1 - u) * (1 - u);
    // (a house down is a house with no height, tucked under the street)
    P.set(q.x, y0 + (u <= 0 ? -30 : 0), q.z);
    S.set(q.hx * 2, Math.max(0.01, q.h * e), q.hz * 2);
    walls.setMatrixAt(q.k, M.compose(P, Q, S));
    P.y += q.h * e;
    S.set(q.hx * 2.24, 1.5 * e + 0.01, q.hz * 2.24);
    roofs.setMatrixAt(q.k, M.compose(P, Q, S));
  };
  for (const q of houses) {
    walls.setColorAt(q.k, C.set(q.color));
    roofs.setColorAt(q.k, C.set(q.roof));
    draw(q, 9);
  }
  let dirty = true, rising = 0;
  b.animators.push((t) => {
    if (!dirty && t > rising) return;
    dirty = false;
    for (const q of houses) draw(q, t);
    walls.instanceMatrix.needsUpdate = roofs.instanceMatrix.needsUpdate = true;
  });
  // ---- the trees on the square and along the blocks (only looks: giants walk through them)
  {
    const spots: [number, number][] = [];
    for (let k = 0; k < 60; k++) {
      const x = cx + (rnd() * 2 - 1) * (H - 2), z = cz + (rnd() * 2 - 1) * (H - 2);
      if (Math.abs(x - cx) < 8 && Math.abs(z - cz) < 8) continue;
      if (houses.some((q) => Math.abs(q.x - x) < q.hx + 1 && Math.abs(q.z - z) < q.hz + 1)) continue;
      // (on the grass, never in the street)
      const u = (((x - cx + H) % cell) + cell) % cell, v = (((z - cz + H) % cell) + cell) % cell;
      if (u < 1.5 || u > cell - 1.5 || v < 1.5 || v > cell - 1.5) continue;
      spots.push([x, z]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 1.2, 8).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: 0x9a6a3e }), spots.length);
    const leaf = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.95, 1).translate(0, 1.8, 0), new THREE.MeshStandardMaterial({ color: 0x3fc46a, roughness: 0.7, flatShading: true }), spots.length);
    leaf.castShadow = true;
    spots.forEach(([x, z], k) => {
      M.makeTranslation(x, y0, z);
      trunk.setMatrixAt(k, M);
      leaf.setMatrixAt(k, M);
      leaf.setColorAt(k, C.setHSL(0.3 + rnd() * 0.08, 0.6, 0.5));
    });
    b.group.add(trunk, leaf);
  }
  // ---- the turns
  let turns: number[][] = [];
  let W = STOMP.longest;
  const wave = (x: number) => Math.max(0, Math.min(turns.length - 1, Math.floor((x - STOMP.lead) / W)));
  const into = (x: number) => x - STOMP.lead - wave(x) * W;
  const isGiant = (id: number, x: number) => x >= STOMP.lead && x < STOMP.lead + turns.length * W && !!turns[wave(x)]?.includes(id);
  const size = (x: number) => {
    const u = into(x);
    return THREE.MathUtils.clamp(Math.min(u / STOMP.grow, (W - u) / STOMP.shrink), 0, 1);
  };
  const flops = new Set<number>();
  // ---- a giant's legs and its belly flop (everyone else just runs)
  b.world.fields.push({
    min: new THREE.Vector3(cx - H - 4, y0 - 40, cz - H - 4),
    max: new THREE.Vector3(cx + H + 4, y0 + 70, cz + H + 4),
    act: (m: Marble, t: number) => {
      const x = t - state.go;
      if (!isGiant(m.id, x)) return;
      m.runK = STOMP.run / RUN;
      m.jumpK = STOMP.jump;
      // (nothing knocks a giant over)
      m.guardT = 1;
      if (!m.dash) return;
      m.dash = false;
      if (m.dashCD > 0 || m.mode !== Mode.Run) return;
      let lx = m.input.x, lz = m.input.z;
      if (lx * lx + lz * lz < 0.01) (lx = Math.sin(m.yaw)), (lz = Math.cos(m.yaw));
      const l = Math.hypot(lx, lz);
      m.vel.set((lx / l) * STOMP.flopV, STOMP.flopUp, (lz / l) * STOMP.flopV);
      m.yaw = Math.atan2(lx, lz);
      m.mode = Mode.Dive;
      m.diveT = 0;
      m.groundT = 1;
      m.dashCD = STOMP.flopCD;
      flops.add(m.id);
    },
  });
  title(b, info, 'Stomp as a giant · Run when you are small', 0xff6a5a, new THREE.Vector3(cx, y0 + 12, cz - H - 7));
  dressArena(b, new THREE.Vector3(cx, y0 - 2, cz), H * 1.2, 83);
  b.finish();
  return {
    id: 'stomptown',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 8,
    lakeY: b.lakeY,
    state,
    grid: (k) => ringGrid(center, k, 3.4, 2.4, 9),
    plate: { center, radius: H, bars: [] },
    stomp: {
      center,
      H,
      houses,
      get turns() {
        return turns;
      },
      get W() {
        return W;
      },
      get end() {
        return STOMP.lead + turns.length * W;
      },
      deal(ids, people, key) {
        // (a shuffle from the round's key: the same everywhere)
        const list = [...ids].sort((p, q) => p - q);
        let s = (key * 9301 + 49297) % 2147483647 || 1;
        const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
        const per = Math.max(1, Math.ceil(list.length / STOMP.waves));
        const count = Math.ceil(list.length / per);
        // (people get their go after the first wave: you see what a giant does before you are one)
        const bots = list.filter((id) => !people.includes(id)), folk = list.filter((id) => people.includes(id));
        const first = bots.splice(0, Math.min(per, bots.length));
        const rest = [...folk, ...bots];
        turns = [first];
        for (let w = 1; w < count; w++) turns.push([]);
        rest.forEach((id, i) => {
          const w = count > 1 ? 1 + (i % (count - 1)) : 0;
          turns[w].push(id);
        });
        turns = turns.filter((q) => q.length);
        // (a small field goes round again: the round is never a town with no giants in it)
        while (turns.length && turns.length < 5) turns = [...turns, ...turns];
        W = Math.min(STOMP.longest, (STOMP.T - STOMP.lead) / turns.length);
      },
      wave,
      into,
      isGiant,
      size,
      flat: new Map(),
      safe: new Map(),
      fell(k) {
        const q = houses[k];
        if (!q || q.gone) return;
        q.gone = true;
        q.kin.enabled = false;
        dirty = true;
      },
      rebuild(t) {
        for (const q of houses) {
          if (!q.gone) continue;
          q.gone = false;
          q.up = t;
          q.kin.enabled = true;
        }
        rising = t + 0.6;
        dirty = true;
      },
      blocked(x, z, pad) {
        for (const q of houses) if (!q.gone && Math.abs(q.x - x) < q.hx + pad && Math.abs(q.z - z) < q.hz + pad) return true;
        return false;
      },
      flops,
      view(cam, at, dt) {
        const dx = at.x - cam.x, dz = at.z - cam.z;
        const k = Math.min(1, dt * 9);
        let moved = false;
        for (const q of houses) {
          // does the line from the lens to you cross this house, below its roof?
          const pad = 0.9, ex = q.hx + pad, ez = q.hz + pad;
          let t0 = 0, t1 = 1;
          for (const [o, d, c, e] of [[cam.x, dx, q.x, ex], [cam.z, dz, q.z, ez]] as const) {
            if (Math.abs(d) < 1e-5) {
              if (Math.abs(o - c) > e) t0 = 2;
              continue;
            }
            const a = (c - e - o) / d, b = (c + e - o) / d;
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
          }
          let want = 1;
          if (t0 < t1 && !q.gone) {
            // (the height of that line where it first reaches the house)
            const y = cam.y + (at.y - cam.y) * t0;
            if (y < y0 + q.h + 1.9) want = 0.14;
          }
          const was = fade.getX(q.k);
          if (Math.abs(was - want) > 0.004) {
            fade.setX(q.k, was + (want - was) * k);
            moved = true;
          }
        }
        if (moved) fade.needsUpdate = true;
      },
    },
    intro: [],
  };
}
