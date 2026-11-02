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
 * The team round, Paint Party: a walled padded square split into tiles. The field is cut into
 * teams; a bean standing on a tile paints it its team's colour (over anyone else's). A turntable
 * with fins turns in the middle and bumpers pop beans about. When the clock runs out the team with
 * the least floor goes home.
 */

export const TEAM_COLORS = [0xff4f9a, 0x2f9bff, 0xffc21f];
export const TEAM_NAMES = ['PINK', 'BLUE', 'GOLD'];
export const TEAM_T = 75;

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
  /** paints the tile under (x, z) for a team; true if it changed */
  paint(x: number, z: number, team: number): boolean;
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
  const N = 20, CELL = 1.4, HALF = (N * CELL) / 2;
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
  // the tiles: a texture a texel a tile, drawn over the slab
  const cells = new Uint8Array(N * N);
  const data = new Uint8Array(N * N * 4);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const blank = new THREE.Color(0xf4eefc);
  // (a round arena: only the tiles inside the ring are floor)
  const valid = new Uint8Array(N * N);
  let total = 0;
  for (let i = 0; i < N * N; i++) {
    const x = -HALF + ((i % N) + 0.5) * CELL, z = -HALF + (Math.floor(i / N) + 0.5) * CELL;
    const ok = !ROUND || Math.hypot(x, z) < HALF - 0.5;
    const hub = ROUND ? 1.2 : 3.5;
    valid[i] = ok && Math.hypot(x, z) > hub ? 1 : 0;
    total += valid[i];
  }
  const cols = TEAM_COLORS.map((c) => new THREE.Color(c));
  const setTexel = (i: number) => {
    const c = cells[i] ? cols[cells[i] - 1] : blank;
    // (checker the blank tiles a touch so the grid reads)
    const k = cells[i] ? 1 : ((i % N) + Math.floor(i / N)) % 2 ? 0.93 : 1;
    data[i * 4] = Math.round(c.r * 255 * k);
    data[i * 4 + 1] = Math.round(c.g * 255 * k);
    data[i * 4 + 2] = Math.round(c.b * 255 * k);
    data[i * 4 + 3] = 255;
  };
  for (let i = 0; i < N * N; i++) setTexel(i);
  tex.needsUpdate = true;
  const tileM = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
  // a soft groove round every tile, each tile puffed a little
  tileM.onBeforeCompile = (sh) => {
    sh.uniforms.uN = { value: N };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uN;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 tg = fract(vMapUv * uN) - 0.5;
        float td = 0.5 - max(abs(tg.x), abs(tg.y));
        float tw = fwidth(vMapUv.x * uN);
        diffuseColor.rgb *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.05 + tw, td));
        diffuseColor.rgb *= 0.94 + 0.08 * (1.0 - pow(abs(2.0 * tg.x), 4.0)) * (1.0 - pow(abs(2.0 * tg.y), 4.0));`,
      );
  };
  tileM.customProgramCacheKey = () => 'mm-tiles-1';
  const tiles = new THREE.Mesh((ROUND ? new THREE.CircleGeometry(HALF, 128) : new THREE.PlaneGeometry(HALF * 2, HALF * 2)).rotateX(-Math.PI / 2), tileM);
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
    [-7, -7, PAINT.pink],
    [7, -7, PAINT.teal],
    [-7, 7, PAINT.yellow],
    [7, 7, PAINT.purple],
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
    if (i < 0 || j < 0 || i >= N || j >= N || !valid[j * N + i]) return -1;
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
    paint(x, z, team) {
      const i = cellAt(x, z);
      if (i < 0 || cells[i] === team + 1) return false;
      cells[i] = team + 1;
      setTexel(i);
      tex.needsUpdate = true;
      return true;
    },
    splat(x, z, r, team) {
      let n = 0;
      for (let dz = -r; dz <= r + 1e-6; dz += CELL * 0.5)
        for (let dx = -r; dx <= r + 1e-6; dx += CELL * 0.5) {
          if (dx * dx + dz * dz > r * r) continue;
          const i = cellAt(x + dx, z + dz);
          if (i < 0 || cells[i] === team + 1) continue;
          cells[i] = team + 1;
          setTexel(i);
          n++;
        }
      if (n) tex.needsUpdate = true;
      return n;
    },
    save() {
      let out = '';
      for (let i = 0; i < cells.length; i++) out += cells[i];
      return out;
    },
    load(str) {
      if (str.length !== cells.length) return;
      let any = false;
      for (let i = 0; i < cells.length; i++) {
        const v = str.charCodeAt(i) - 48;
        if (v < 0 || v > 3 || cells[i] === v || !valid[i]) continue;
        cells[i] = v;
        setTexel(i);
        any = true;
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
      const c = [0, 0, 0];
      for (let i = 0; i < cells.length; i++) if (cells[i]) c[cells[i] - 1]++;
      return c.slice(0, teams);
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
