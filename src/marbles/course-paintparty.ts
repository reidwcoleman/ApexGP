import * as THREE from 'three';
import { CourseBuilder, PAINT, cylAttr } from './builder.ts';
import { bumperAt, signTexture, sweeper, turntable } from './obstacles.ts';
import { Mat } from './physics.ts';
import { foamTheme, woodAttr } from './shaders.ts';
import { roundBox } from './builder.ts';
import { Parts, mat, plank, post } from './obs-kit.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';

/**
 * The team round, Paint Party: a big walled padded square (or Splat Ring, a round one). The field
 * is cut into teams; every bean on its feet leaves a trail of its team's paint behind it as it runs
 * (over anyone else's), a dive smears a wider stripe and a landing splats a blob. The paint lives
 * in a fine map (a quarter of a metre a texel) drawn as wet, glossy, raised paint with soft blobby
 * edges; the bots read a coarse grid summed from it. A turntable with fins turns in the middle
 * and bumpers pop beans about. When the clock runs out the team with the least floor goes home.
 */

export const TEAM_COLORS = [0xff4f9a, 0x2f9bff, 0xffc21f];
export const TEAM_NAMES = ['PINK', 'BLUE', 'GOLD'];
export const TEAM_T = 100;

export interface TeamArena {
  center: THREE.Vector3;
  half: number;
  n: number;
  cell: number;
  /** 0: unpainted, k + 1: team k */
  cells: Uint8Array;
  teams: number;
  /** team of each bean (marble id) */
  of: Map<number, number>;
  /** paints a round brush at (x, z) for a team; true if anything changed */
  paint(x: number, z: number, team: number, r?: number): boolean;
  /** paints a stroke from one point to another (a bean's step) */
  stroke(x0: number, z0: number, x1: number, z1: number, team: number, r: number): boolean;
  cellAt(x: number, z: number): number;
  centreOf(i: number, out: THREE.Vector3): THREE.Vector3;
  counts(): number[];
  /** tiles there are to paint */
  total: number;
  /** the ring's bar (angle about +y from +x, and its rate) */
  bar?: { angle(t: number): number; omega(t: number): number };
  /** a round arena (or a square one) */
  round: boolean;
  /** close to the wall at (x, z) */
  nearWall(x: number, z: number, m: number): boolean;
  /** where a team's beans start and come back after a fall */
  base(team: number): THREE.Vector3;
  /** paints every tile within r of (x, z) for a team; how many changed */
  splat(x: number, z: number, r: number, team: number): number;
  /** the floor as a string (one digit a tile) and back: the host's floor sent to the guests */
  save(): string;
  load(s: string): void;
  /** paint pickups lying on the floor now (for the bots) */
  pickups: THREE.Vector3[];
}

/** 'square': the walled square with a turntable; 'ring': a round arena swept by a long bar (hop it) */
export function paintparty(info: { id?: string; name: string; blurb: string }, variant: 'square' | 'ring' = 'square'): Course {
  const ROUND = variant === 'ring';
  /** the ring's bar: its angle at t (it turns faster as the round goes on) */
  const barAngle = (t: number) => {
    const x = Math.max(0, t - state.go);
    return 0.55 * x + 0.0025 * x * x;
  };
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 110, 0);
  // the coarse grid the bots read (N cells of CELL m) and the fine paint map (NF texels of F m)
  const N = 28, CELL = 1.5, HALF = (N * CELL) / 2;
  const F = 0.25, SUB = Math.round(CELL / F), NF = N * SUB;
  b.lakeY = center.y - 30;
  const state = { go: 1e9 };
  const th = foamTheme();
  // the slab
  {
    const g = ROUND ? new THREE.CylinderGeometry(HALF + 0.9, HALF + 0.5, 1.2, 96) : roundBox(HALF * 2 + 1.6, 1.2, HALF * 2 + 1.6, 0.3);
    woodAttr(g, ROUND ? 'y' : 'x', 1);
    g.translate(center.x, center.y - 0.6, center.z);
    b.solid(g, b.darkWood, Mat.Paint);
  }
  // the padded walls round it, with fat tubes along the tops
  const WH = 1.3;
  if (ROUND) {
    // a ring of padded blocks, one fat tube round the top
    const SEGS = 40, RW = HALF + 0.4;
    for (let k = 0; k < SEGS; k++) {
      const a = (k / SEGS) * Math.PI * 2;
      const g = roundBox(((Math.PI * 2 * RW) / SEGS) * 1.06, WH, 0.8, 0.12);
      woodAttr(g, 'x', k);
      g.rotateY(-a + Math.PI / 2);
      g.translate(center.x + Math.cos(a) * RW, center.y + WH / 2, center.z + Math.sin(a) * RW);
      b.solid(g, b.railWood, Mat.Felt);
    }
    const tg = new THREE.TorusGeometry(RW, 0.42, 16, 160).rotateX(Math.PI / 2);
    const uv = tg.getAttribute('uv'), wd = new Float32Array(uv.count * 3);
    for (let k = 0; k < uv.count; k++) {
      wd[k * 3] = uv.getX(k) * Math.PI * 2 * RW;
      wd[k * 3 + 1] = uv.getY(k) * Math.PI * 2 * 0.42;
      wd[k * 3 + 2] = 0.42;
    }
    tg.setAttribute('aWood', new THREE.BufferAttribute(wd, 3));
    const tube = new THREE.Mesh(tg, b.paint({ a: th.rail, b: th.railB, pattern: 1, scale: 1.4 }));
    tube.position.set(center.x, center.y + WH + 0.2, center.z);
    tube.castShadow = true;
    b.group.add(tube);
  }
  for (const [x, z, w, d] of ROUND ? [] : [
    [0, -HALF - 0.4, HALF * 2 + 1.6, 0.8],
    [0, HALF + 0.4, HALF * 2 + 1.6, 0.8],
    [-HALF - 0.4, 0, 0.8, HALF * 2],
    [HALF + 0.4, 0, 0.8, HALF * 2],
  ]) {
    const g = roundBox(w, WH, d, 0.18);
    woodAttr(g, w > d ? 'x' : 'z', x + z);
    g.translate(center.x + x, center.y + WH / 2, center.z + z);
    b.solid(g, b.railWood, Mat.Felt);
    const tube = new THREE.Mesh(cylAttr(new THREE.CylinderGeometry(0.42, 0.42, Math.max(w, d), 20, 1).rotateZ(Math.PI / 2)), b.paint({ a: th.rail, b: th.railB, pattern: 1, scale: 1.4 }));
    if (d > w) tube.rotation.y = Math.PI / 2;
    tube.position.set(center.x + x, center.y + WH + 0.2, center.z + z);
    tube.castShadow = true;
    b.group.add(tube);
  }
  // the pedestal under it, down into the paint
  {
    const ped = woodAttr(new THREE.CylinderGeometry(5, 7, center.y - b.lakeY, 32, 1, true), 'y');
    ped.translate(center.x, (center.y + b.lakeY) / 2 - 1.2, center.z);
    b.batch.add(b.postWood, ped);
  }
  // the paint: a fine map, one texel a quarter metre; a channel per team (so a filtered sample is
  // each team's share there), and a coarse grid for the bots summed from it
  const cells = new Uint8Array(N * N);
  const fine = new Uint8Array(NF * NF);
  const data = new Uint8Array(NF * NF * 4);
  const tex = new THREE.DataTexture(data, NF, NF, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  const validF = new Uint8Array(NF * NF);
  /** each texel's wobble (the same everywhere): the brush's edge goes in and out with it */
  const wob = new Float32Array(NF * NF);
  /** when this browser last painted a texel itself (the host's floor doesn't paint over that) */
  const mineT = new Float32Array(NF * NF).fill(-1e9);
  const ccount = new Uint16Array(N * N * 3);
  const cvalid = new Uint16Array(N * N);
  const tcount = [0, 0, 0];
  let total = 0;
  const hub = ROUND ? 1.2 : 3.6;
  for (let j = 0; j < NF; j++)
    for (let i = 0; i < NF; i++) {
      const x = -HALF + (i + 0.5) * F, z = -HALF + (j + 0.5) * F;
      const r = Math.hypot(x, z);
      const ok = (!ROUND || r < HALF - 0.45) && r > hub;
      const k = j * NF + i;
      validF[k] = ok ? 1 : 0;
      wob[k] = 0.5 + 0.22 * Math.sin(x * 1.9 + Math.sin(z * 1.3) * 2) + 0.22 * Math.sin(z * 2.3 + Math.sin(x * 1.1) * 2) + 0.06 * Math.sin((x + z) * 7.1);
      if (ok) {
        total++;
        cvalid[Math.floor(j / SUB) * N + Math.floor(i / SUB)]++;
      }
      data[k * 4 + 3] = 255;
    }
  tex.needsUpdate = true;
  const setFine = (k: number, v: number) => {
    const old = fine[k];
    if (old === v) return false;
    fine[k] = v;
    data[k * 4] = v === 1 ? 255 : 0;
    data[k * 4 + 1] = v === 2 ? 255 : 0;
    data[k * 4 + 2] = v === 3 ? 255 : 0;
    const i = k % NF, j = Math.floor(k / NF);
    const ci = Math.floor(j / SUB) * N + Math.floor(i / SUB);
    if (old) (ccount[ci * 3 + old - 1]--, tcount[old - 1]--);
    if (v) (ccount[ci * 3 + v - 1]++, tcount[v - 1]++);
    // (the coarse cell: whoever has the most of it, if they have a good part of it)
    let best = 0, bn = cvalid[ci] * 0.35;
    for (let q = 0; q < 3; q++) if (ccount[ci * 3 + q] > bn) (bn = ccount[ci * 3 + q]), (best = q + 1);
    cells[ci] = best;
    return true;
  };
  /** a round brush of radius r at (x, z): wobbly edged; how many texels changed */
  const stamp = (x: number, z: number, r: number, team: number, now: number) => {
    const fx = (x - center.x + HALF) / F, fz = (z - center.z + HALF) / F;
    const rr = (r * 1.25) / F;
    const i0 = Math.max(0, Math.floor(fx - rr)), i1 = Math.min(NF - 1, Math.ceil(fx + rr));
    const j0 = Math.max(0, Math.floor(fz - rr)), j1 = Math.min(NF - 1, Math.ceil(fz + rr));
    let n = 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * NF + i;
        if (!validF[k]) continue;
        const d = Math.hypot(i + 0.5 - fx, j + 0.5 - fz) * F;
        if (d > r * (0.78 + 0.44 * wob[k])) continue;
        mineT[k] = now;
        if (setFine(k, team + 1)) n++;
      }
    if (n) tex.needsUpdate = true;
    return n;
  };
  const clock = () => performance.now() / 1000;
  const T0 = new THREE.Color(TEAM_COLORS[0]), T1 = new THREE.Color(TEAM_COLORS[1]), T2 = new THREE.Color(TEAM_COLORS[2]);
  const tileM = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.3, sheenColor: new THREE.Color(0xffffff) });
  // the floor: soft padded tiles where it's bare; where it's painted, glossy paint in the team's
  // colour, with blobby edges (the filtered map's contour), a darker wet rim and a raised lip
  tileM.onBeforeCompile = (sh) => {
    sh.uniforms.uN = { value: N };
    sh.uniforms.uNF = { value: NF };
    sh.uniforms.uT0 = { value: T0 };
    sh.uniforms.uT1 = { value: T1 };
    sh.uniforms.uT2 = { value: T2 };
    sh.uniforms.uBlank = { value: new THREE.Color(0xf4eefc) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uN; uniform float uNF; uniform vec3 uT0, uT1, uT2, uBlank; float pcov;')
      .replace(
        '#include <map_fragment>',
        `vec2 pt = vec2(0.8 / uNF);
        vec3 pw = (texture2D(map, vMapUv).rgb * 2.0 + texture2D(map, vMapUv + pt).rgb + texture2D(map, vMapUv - pt).rgb + texture2D(map, vMapUv + vec2(pt.x, -pt.y)).rgb + texture2D(map, vMapUv + vec2(-pt.x, pt.y)).rgb) / 6.0;
        float psum = pw.r + pw.g + pw.b;
        float paa = fwidth(psum) * 0.7 + 0.02;
        pcov = smoothstep(0.5 - paa, 0.5 + paa, psum);
        vec3 p4 = pw * pw; p4 *= p4;
        vec3 pc = (p4.r * uT0 + p4.g * uT1 + p4.b * uT2) / max(p4.r + p4.g + p4.b, 1e-4);
        vec2 tg = fract(vMapUv * uN) - 0.5;
        float td = 0.5 - max(abs(tg.x), abs(tg.y));
        float tw = fwidth(vMapUv.x * uN);
        vec3 base = uBlank * (1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.05 + tw, td)));
        base *= 0.95 + 0.06 * (1.0 - pow(abs(2.0 * tg.x), 4.0)) * (1.0 - pow(abs(2.0 * tg.y), 4.0));
        // (the wet rim: a touch darker just inside the edge)
        float rim = 1.0 - smoothstep(0.5, 0.85, psum);
        pc *= 1.0 - 0.22 * rim;
        diffuseColor.rgb = mix(base, pc, pcov);`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.16, pcov);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        { float ph = smoothstep(0.3, 0.7, psum) * 0.035;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition); vec2 dh = vec2(dFdx(ph), dFdy(ph));
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * R1 + dh.y * R2)); }`,
      );
  };
  tileM.customProgramCacheKey = () => 'mm-paint-3';
  const floorG = (ROUND ? new THREE.CircleGeometry(HALF, 128) : new THREE.PlaneGeometry(HALF * 2, HALF * 2)).rotateX(-Math.PI / 2);
  // (laid flat, the geometry's v runs toward -z; the paint map's rows run toward +z)
  {
    const uv = floorG.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  }
  const tiles = new THREE.Mesh(floorG, tileM);
  tiles.position.set(center.x, center.y + 0.012, center.z);
  tiles.receiveShadow = true;
  b.group.add(tiles);
  // the turntable in the middle, and bumpers out at the corners of the middle
  const up = new THREE.Quaternion();
  if (ROUND) {
    // one long bar turning over the floor from a hub in the middle, speeding up as it goes: hop it
    sweeper(b, center.clone(), up, { len: HALF * 2 - 0.9, height: 0.55, angle: barAngle, paint: { a: th.rail, b: PAINT.white, pattern: 2, scale: 1.4 }, hub: 0.9 });
  } else turntable(b, center.clone(), new THREE.Quaternion(), { r: 3.4, omega: 0.7, fins: 2, finH: 0.45 });
  for (const [x, z, c] of ROUND ? [] : [
    [-9, -9, PAINT.pink],
    [9, -9, PAINT.teal],
    [-9, 9, PAINT.yellow],
    [9, 9, PAINT.purple],
    [0, -13, PAINT.orange],
    [0, 13, PAINT.green],
    [-13, 0, PAINT.blue],
    [13, 0, PAINT.red],
  ] as const) bumperAt(b, new THREE.Vector3(center.x + x, center.y, center.z + z), up, { r: 0.9, color: c });
  // the sign
  {
    const p = new Parts();
    p.add(b.railWood, plank(9.4, 2.0, 0.3, 0.08, 'x'), mat(0, 7.5, -0.18));
    for (const sx of [-4.2, 4.2]) post(p, b, mat(sx, -6, -0.3), 14.6, { w: 0.42 });
    p.toBatch(b, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z - HALF - 4));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshPhysicalMaterial({ map: signTexture(info.name.toUpperCase(), ROUND ? 'Team round · Hop the bar, paint the floor' : 'Team round · Paint the floor', PAINT.pink, 9 / 1.7), roughness: 0.4, clearcoat: 0.8 }));
    sign.position.set(center.x, center.y + 7.5, center.z - HALF - 4);
    b.group.add(sign);
  }
  dressArena(b, center, HALF + 2, 7);
  b.finish();

  const of = new Map<number, number>();
  let teams = 3;
  const cellAt = (x: number, z: number) => {
    const i = Math.floor((x - center.x + HALF) / CELL), j = Math.floor((z - center.z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N || !cvalid[j * N + i]) return -1;
    return j * N + i;
  };
  const arena: TeamArena = {
    center,
    half: HALF,
    n: N,
    cell: CELL,
    cells,
    get teams() {
      return teams;
    },
    set teams(v: number) {
      teams = v;
    },
    of,
    cellAt,
    paint(x, z, team, r = 0.95) {
      return stamp(x, z, r, team, clock()) > 0;
    },
    stroke(x0, z0, x1, z1, team, r) {
      const d = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(d / (r * 0.45)));
      const now = clock();
      let n = 0;
      for (let k = 1; k <= steps; k++) n += stamp(x0 + ((x1 - x0) * k) / steps, z0 + ((z1 - z0) * k) / steps, r, team, now);
      return n > 0;
    },
    splat(x, z, r, team) {
      return stamp(x, z, r, team, clock());
    },
    // (run-length: a digit for the team and the run's length in base 36, then a dot)
    save() {
      const out: string[] = [];
      let v = fine[0], n = 0;
      for (let k = 0; k <= fine.length; k++) {
        if (k < fine.length && fine[k] === v) {
          n++;
          continue;
        }
        out.push(v + n.toString(36) + '.');
        if (k < fine.length) (v = fine[k]), (n = 1);
      }
      return out.join('');
    },
    load(str) {
      const now = clock();
      let k = 0, any = false;
      for (const run of str.split('.')) {
        if (!run) continue;
        const v = run.charCodeAt(0) - 48;
        const n = parseInt(run.slice(1), 36);
        if (!(v >= 0 && v <= 3) || !(n > 0)) return;
        for (let e = Math.min(fine.length, k + n); k < e; k++) {
          // (not what this browser just painted: the host hasn't seen it yet)
          if (!validF[k] || now - mineT[k] < 1.2) continue;
          if (setFine(k, v)) any = true;
        }
      }
      if (any) tex.needsUpdate = true;
    },
    pickups: [],
    centreOf(i, out) {
      return out.set(center.x - HALF + ((i % N) + 0.5) * CELL, center.y, center.z - HALF + (Math.floor(i / N) + 0.5) * CELL);
    },
    total,
    round: ROUND,
    bar: ROUND ? { angle: barAngle, omega: (t: number) => 0.55 + 0.005 * Math.max(0, t - state.go) } : undefined,
    nearWall(x, z, m) {
      const cx = x - center.x, cz = z - center.z;
      return ROUND ? Math.hypot(cx, cz) > HALF - m : Math.abs(cx) > HALF - m || Math.abs(cz) > HALF - m;
    },
    counts() {
      return tcount.slice(0, teams);
    },
    base(team) {
      const a = (team / teams) * Math.PI * 2 + Math.PI / 2;
      return new THREE.Vector3(center.x + Math.cos(a) * (HALF - 3), center.y + 0.52, center.z + Math.sin(a) * (HALF - 3));
    },
  };
  return {
    id: info.id ?? 'paintparty',
    name: info.name,
    kind: 'team',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 9,
    lakeY: b.lakeY,
    state,
    // (teams are dealt in grid order: k % teams; each team in a cluster at its base)
    grid: (n) => {
      teams = n >= 9 ? 3 : 2;
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      const per = Math.ceil(n / teams);
      for (let k = 0; k < n; k++) {
        const t = k % teams, slot = Math.floor(k / teams);
        const bp = arena.base(t);
        const a = (t / teams) * Math.PI * 2 + Math.PI / 2;
        // a little row facing the middle
        const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        const lat = (slot - (per - 1) / 2) * 1.5;
        const back = (slot % 2) * 1.2;
        const pos = bp.clone().addScaledVector(side, lat).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(back));
        out.push({ pos, yaw: Math.atan2(center.x - pos.x, center.z - pos.z) });
      }
      return out;
    },
    plate: { center, radius: HALF, bars: [] },
    team: arena,
    intro: [],
  };
}
