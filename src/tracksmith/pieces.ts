/**
 * Tracksmith track pieces. Pure math (no three.js) so the headless tools can build the same
 * collision mesh the game drives on.
 *
 * Grid: a tile is T metres square, a level is H metres tall. A piece sits on a cell (x, z) at a level,
 * turned by rot quarter-turns about +Y (rot 1 maps local +z to world +x). Locally every piece is entered
 * through the south edge of its entry cell travelling +z; its path(t) gives the centre line frame.
 */

export const T = 10;
export const H = 2.5;
export const ROAD_W = 9;
export const ROAD_Y = 0.12; // level 0 road surface sits just above the ground
export const SLAB = 0.7; // road thickness under the surface

export type Vec3 = [number, number, number];
export interface Frame { p: Vec3; f: Vec3; u: Vec3 }

export type Feature = 'start' | 'finish' | 'check' | 'boost' | 'ramp' | 'loop' | 'block' | 'plate' | 'none';

export interface PieceDef {
  id: string;
  name: string;
  /** palette group in the editor */
  group: 'road' | 'turn' | 'height' | 'special' | 'block';
  cells: [number, number][];
  /** exit cell and direction (0 +z, 1 +x, 2 -z, 3 -x) and level change */
  exit: { cell: [number, number]; dir: number; dl: number };
  feature: Feature;
  /** centre line, t in [0,1], local metres relative to the piece's base level surface */
  path?: (t: number) => { p: Vec3; up: Vec3 };
  samples?: number;
  width?: number;
  /** the lowest level it can stand at */
  minLevel?: number;
  /** a solid box instead of a road: [minx, miny, minz, maxx, maxy, maxz] local */
  box?: [number, number, number, number, number, number];
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const UP: Vec3 = [0, 1, 0];

function arc(cx: number, cz: number, r: number) {
  // from (cx - r, cz) heading +z, turning toward +x, a quarter circle around (cx, cz)
  return (t: number) => {
    const a = (t * Math.PI) / 2;
    return { p: [cx - r * Math.cos(a), 0, cz + r * Math.sin(a)] as Vec3, up: UP };
  };
}

function straight(len: number, rise = 0, ease = smooth) {
  return (t: number) => ({ p: [0, rise * ease(t), -T / 2 + len * t] as Vec3, up: UP });
}

/** a kicker: flat, then a circular lift ending at `angle` and `lift` metres up at the exit edge */
function kicker(angle: number, L = T) {
  const R = L > T ? 22 : 13; // ramp radius
  const arcLen = R * angle;
  const flat = L - R * Math.sin(angle);
  return (t: number) => {
    const s = t * (flat + arcLen);
    if (s <= flat) return { p: [0, 0, -T / 2 + s] as Vec3, up: UP };
    const a = (s - flat) / R;
    return { p: [0, R - R * Math.cos(a), -T / 2 + flat + R * Math.sin(a)] as Vec3, up: [0, Math.cos(a), -Math.sin(a)] as Vec3 };
  };
}

/** a vertical loop that moves one tile sideways (side = +1 toward +x, -1 toward -x) */
function loop(side: number) {
  const R = 8.6;
  const zc = 5;
  // straight in (z -5..zc), the loop, straight out (zc..15) one tile over
  const lin = 10;
  const circ = 2 * Math.PI * R;
  const tot = lin + circ + lin;
  return (t: number) => {
    const s = t * tot;
    if (s <= lin) return { p: [0, 0, -5 + s] as Vec3, up: UP };
    if (s >= lin + circ) return { p: [side * T, 0, zc + (s - lin - circ)] as Vec3, up: UP };
    const th = ((s - lin) / circ) * 2 * Math.PI;
    const x = side * T * smooth(th / (2 * Math.PI));
    return { p: [x, R * (1 - Math.cos(th)), zc + R * Math.sin(th)] as Vec3, up: [0, Math.cos(th), -Math.sin(th)] as Vec3 };
  };
}

/**
 * A quarter turn leaning into itself, tilted about its centre line: the middle of the road stays
 * level (lifting it makes a crest that throws the car off at speed), so the inside edge dips below
 * the piece's level and a bank needs a level of air under it (minLevel).
 */
function banked(cx: number, cz: number, r: number, tilt = 0.42) {
  return (t: number) => {
    const a = (t * Math.PI) / 2;
    const th = tilt * Math.sin(Math.PI * t) ** 2 * 1.0;
    const s = Math.sin(th), c = Math.cos(th);
    return { p: [cx - r * Math.cos(a), 0, cz + r * Math.sin(a)] as Vec3, up: [Math.cos(a) * s, c, -Math.sin(a) * s] as Vec3 };
  };
}

/** a road of rollers: at speed they throw the car up and down */
function wave(len: number, h: number, humps: number) {
  return (t: number) => {
    const y = h * Math.sin(Math.PI * humps * t) ** 2;
    return { p: [0, y, -T / 2 + len * t] as Vec3, up: UP };
  };
}

const cells = (w: number, l: number, sx = 1) => {
  const out: [number, number][] = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < l; z++) out.push([x * sx, z]);
  return out;
};

const road = (id: string, name: string, feature: Feature = 'none'): PieceDef => ({
  id, name, group: feature === 'none' ? 'road' : 'special', cells: [[0, 0]], exit: { cell: [0, 0], dir: 0, dl: 0 }, feature, path: straight(T), samples: 4,
});

export const PIECES: PieceDef[] = [
  road('road', 'Straight'),
  { id: 'turn1', name: 'Tight turn', group: 'turn', cells: [[0, 0]], exit: { cell: [0, 0], dir: 1, dl: 0 }, feature: 'none', path: arc(T / 2, -T / 2, T / 2), samples: 12 },
  { id: 'turn2', name: 'Turn', group: 'turn', cells: cells(2, 2), exit: { cell: [1, 1], dir: 1, dl: 0 }, feature: 'none', path: arc(1.5 * T, -T / 2, 1.5 * T), samples: 22 },
  { id: 'turn3', name: 'Wide turn', group: 'turn', cells: cells(3, 3), exit: { cell: [2, 2], dir: 1, dl: 0 }, feature: 'none', path: arc(2.5 * T, -T / 2, 2.5 * T), samples: 32 },
  { id: 'slope', name: 'Slope', group: 'height', cells: [[0, 0]], exit: { cell: [0, 0], dir: 0, dl: 1 }, feature: 'none', path: straight(T, H), samples: 14 },
  { id: 'slope2', name: 'Long slope', group: 'height', cells: cells(1, 2), exit: { cell: [0, 1], dir: 0, dl: 1 }, feature: 'none', path: straight(2 * T, H), samples: 20 },
  { id: 'climb', name: 'Climb', group: 'height', cells: cells(1, 2), exit: { cell: [0, 1], dir: 0, dl: 2 }, feature: 'none', path: straight(2 * T, 2 * H), samples: 22 },
  { id: 'ramp', name: 'Kicker', group: 'height', cells: [[0, 0]], exit: { cell: [0, 0], dir: 0, dl: 0 }, feature: 'ramp', path: kicker(0.25), samples: 16 },
  { id: 'loop', name: 'Loop (left)', group: 'special', cells: cells(2, 2), exit: { cell: [1, 1], dir: 0, dl: 0 }, feature: 'loop', path: loop(1), samples: 72, width: 8 },
  { id: 'loopR', name: 'Loop (right)', group: 'special', cells: cells(2, 2, -1), exit: { cell: [-1, 1], dir: 0, dl: 0 }, feature: 'loop', path: loop(-1), samples: 72, width: 8 },
  road('start', 'Start', 'start'),
  road('check', 'Checkpoint', 'check'),
  road('finish', 'Finish', 'finish'),
  road('boost', 'Boost pad', 'boost'),
  { id: 'plate', name: 'Plate', group: 'block', cells: [[0, 0]], exit: { cell: [0, 0], dir: 0, dl: 0 }, feature: 'plate', box: [-T / 2, -SLAB, -T / 2, T / 2, 0, T / 2] },
  { id: 'block', name: 'Block', group: 'block', cells: [[0, 0]], exit: { cell: [0, 0], dir: 0, dl: 1 }, feature: 'block', box: [-T / 2, -ROAD_Y, -T / 2, T / 2, H, T / 2] },
  // (new pieces go on the end: share codes store a piece by its place in this list)
  { id: 'bank2', name: 'Banked turn', group: 'turn', cells: cells(2, 2), exit: { cell: [1, 1], dir: 1, dl: 0 }, feature: 'none', path: banked(1.5 * T, -T / 2, 1.5 * T, 0.4), samples: 30, minLevel: 1 },
  { id: 'bank3', name: 'Wide banked turn', group: 'turn', cells: cells(3, 3), exit: { cell: [2, 2], dir: 1, dl: 0 }, feature: 'none', path: banked(2.5 * T, -T / 2, 2.5 * T, 0.42), samples: 44, minLevel: 1 },
  { id: 'wave', name: 'Rollers', group: 'height', cells: cells(1, 2), exit: { cell: [0, 1], dir: 0, dl: 0 }, feature: 'none', path: wave(2 * T, 0.5, 2), samples: 40 },
  { id: 'bigramp', name: 'Big kicker', group: 'height', cells: cells(1, 2), exit: { cell: [0, 1], dir: 0, dl: 0 }, feature: 'ramp', path: kicker(0.3, 2 * T), samples: 24 },
];

export const PIECE_BY_ID = new Map(PIECES.map((p, i) => [p.id, i]));
export const pieceIndex = (id: string) => {
  const i = PIECE_BY_ID.get(id);
  if (i === undefined) throw new Error('no piece ' + id);
  return i;
};

export interface Placed { t: number; x: number; z: number; l: number; r: number }

// ---------------------------------------------------------------- transforms

export const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
/** rotate a local (x, z) by r quarter turns (r=1: +z -> +x) */
export function rot2(x: number, z: number, r: number): [number, number] {
  r = ((r % 4) + 4) % 4;
  for (let i = 0; i < r; i++) [x, z] = [z, -x];
  return [x === 0 ? 0 : x, z === 0 ? 0 : z];
}

export function toWorld(pl: Placed, v: Vec3, dir = false): Vec3 {
  const [x, z] = rot2(v[0], v[2], pl.r);
  if (dir) return [x, v[1], z];
  return [x + pl.x * T, v[1] + levelY(pl.l), z + pl.z * T];
}
export const levelY = (l: number) => l * H + ROAD_Y;

export function footprint(pl: Placed): [number, number][] {
  return PIECES[pl.t].cells.map(([cx, cz]) => {
    const [x, z] = rot2(cx, cz, pl.r);
    return [pl.x + x, pl.z + z];
  });
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** local frames along a piece path (forward by finite difference, up orthogonalised) */
export function frames(def: PieceDef, n = def.samples ?? 8): Frame[] {
  const out: Frame[] = [];
  const path = def.path!;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = path(Math.max(0, t - 1e-3)).p;
    const b = path(Math.min(1, t + 1e-3)).p;
    const f = norm(sub(b, a));
    const { p, up } = path(t);
    const u = norm(sub(up, [f[0] * dot(up, f), f[1] * dot(up, f), f[2] * dot(up, f)]));
    out.push({ p, f, u });
  }
  return out;
}

// ---------------------------------------------------------------- mesh building

/** colours: the renderer maps these material slots to its theme palette */
export const Slot = { Road: 0, Edge: 1, EdgeAlt: 2, Side: 3, Under: 4, Boost: 5, Line: 6, Block: 7, BlockSide: 8 } as const;

export interface MeshOut {
  pos: number[];
  slot: number[]; // one per vertex
  idx: number[];
}

function quad(m: MeshOut, a: Vec3, b: Vec3, c: Vec3, d: Vec3, slot: number, inside: Vec3) {
  // wound so the face normal points away from `inside`
  const n = cross(sub(b, a), sub(c, a));
  const g: Vec3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  const flip = dot(n, sub(g, inside)) < 0;
  const i = m.pos.length / 3;
  m.pos.push(...a, ...b, ...c, ...d);
  m.slot.push(slot, slot, slot, slot);
  if (flip) m.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  else m.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** sweep the road cross-section along world frames */
function sweepRoad(m: MeshOut, F: Frame[], width: number, feature: Feature, lenMetres: number) {
  const hw = width / 2;
  const edge = 0.7; // painted kerb band
  const cols = [-hw, -hw + edge, -2.4, -0.14, 0.14, 2.4, hw - edge, hw];
  let dist = 0;
  for (let i = 0; i < F.length - 1; i++) {
    const A = F[i], B = F[i + 1];
    const seg = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]);
    const ra = cross(A.f, A.u), rb = cross(B.f, B.u);
    const P = (Fr: Frame, r: Vec3, x: number, y = 0): Vec3 => add(add(Fr.p, r, x), Fr.u, y);
    const inside = add(lerp3(A.p, B.p, 0.5), lerp3(A.u, B.u, 0.5), -SLAB / 2);
    const at = dist + seg / 2;
    const kerb = Math.floor(at / 2.5) % 2 === 0 ? Slot.Edge : Slot.EdgeAlt;
    const mid = at / Math.max(lenMetres, 1e-3);
    for (let c = 0; c < cols.length - 1; c++) {
      const x0 = cols[c], x1 = cols[c + 1];
      let slot: number = c === 0 || c === cols.length - 2 ? kerb : Slot.Road;
      if (c === 3 && at % 5 < 2.5) slot = Slot.Line;
      if (feature === 'boost' && c >= 2 && c <= 4 && mid > 0.1 && mid < 0.9) slot = Slot.Boost;
      quad(m, P(A, ra, x0), P(A, ra, x1), P(B, rb, x1), P(B, rb, x0), slot, inside);
    }
    const d = -SLAB;
    quad(m, P(A, ra, hw), P(A, ra, hw, d), P(B, rb, hw, d), P(B, rb, hw), Slot.Side, inside);
    quad(m, P(A, ra, -hw, d), P(A, ra, -hw), P(B, rb, -hw), P(B, rb, -hw, d), Slot.Side, inside);
    quad(m, P(A, ra, hw, d), P(A, ra, -hw, d), P(B, rb, -hw, d), P(B, rb, hw, d), Slot.Under, inside);
    dist += seg;
  }
}

function capEnd(m: MeshOut, Fr: Frame, width: number, sign: number) {
  const hw = width / 2;
  const r = cross(Fr.f, Fr.u);
  const P = (x: number, y: number): Vec3 => add(add(Fr.p, r, x), Fr.u, y);
  quad(m, P(hw, 0), P(-hw, 0), P(-hw, -SLAB), P(hw, -SLAB), Slot.Side, add(add(Fr.p, Fr.f, -sign), Fr.u, -SLAB / 2));
}

function boxMesh(m: MeshOut, b: [number, number, number, number, number, number], tw: (v: Vec3) => Vec3, top: number, side: number) {
  const [x0, y0, z0, x1, y1, z1] = b;
  const v = (x: number, y: number, z: number) => tw([x, y, z]);
  const c = v((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  quad(m, v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), top, c);
  quad(m, v(x0, y0, z1), v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), side, c);
  quad(m, v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0), side, c);
  quad(m, v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(x0, y0, z1), side, c);
  quad(m, v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(x0, y0, z0), side, c);
  quad(m, v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1), side, c);
}

export function worldFrames(pl: Placed, n?: number): Frame[] {
  const def = PIECES[pl.t];
  return frames(def, n).map((F) => ({ p: toWorld(pl, F.p), f: toWorld(pl, F.f, true), u: toWorld(pl, F.u, true) }));
}

export function pieceMesh(pl: Placed, m: MeshOut) {
  const def = PIECES[pl.t];
  if (def.box) {
    const top = def.feature === 'plate' ? Slot.Road : Slot.Block;
    boxMesh(m, def.box, (v) => toWorld(pl, v), top, Slot.BlockSide);
    return;
  }
  const F = worldFrames(pl);
  const w = def.width ?? ROAD_W;
  let len = 0;
  for (let i = 1; i < F.length; i++) len += Math.hypot(F[i].p[0] - F[i - 1].p[0], F[i].p[1] - F[i - 1].p[1], F[i].p[2] - F[i - 1].p[2]);
  sweepRoad(m, F, w, def.feature, len);
  if (def.feature === 'ramp') {
    // the kicker is a solid wedge: walls from the lifted road's underside down to the base slab
    const hw = w / 2;
    const baseY = levelY(pl.l) - SLAB;
    for (let i = 0; i < F.length - 1; i++) {
      const A = F[i], B = F[i + 1];
      if (A.p[1] - levelY(pl.l) < 0.02 && B.p[1] - levelY(pl.l) < 0.02) continue;
      const ra = cross(A.f, A.u), rb = cross(B.f, B.u);
      for (const s of [1, -1]) {
        const a = add(add(A.p, ra, s * hw), A.u, -SLAB), b = add(add(B.p, rb, s * hw), B.u, -SLAB);
        const a0: Vec3 = [a[0], baseY, a[2]], b0: Vec3 = [b[0], baseY, b[2]];
        quad(m, a, b, b0, a0, Slot.Side, [(A.p[0] + B.p[0]) / 2, baseY, (A.p[2] + B.p[2]) / 2]);
      }
    }
    const L = F[F.length - 1];
    const r = cross(L.f, L.u);
    const t1 = add(add(L.p, r, hw), L.u, -SLAB), t2 = add(add(L.p, r, -hw), L.u, -SLAB);
    capEnd(m, L, w, 1);
    quad(m, t1, t2, [t2[0], baseY, t2[2]], [t1[0], baseY, t1[2]], Slot.Side, add(L.p, L.f, -2));
  }
  if (def.feature === 'loop') {
    capEnd(m, F[0], w, -1);
    capEnd(m, F[F.length - 1], w, 1);
  }
}

// ---------------------------------------------------------------- triggers

/** where a car standing on this piece is in its local frame (x across, y up, z along) */
export function toLocal(pl: Placed, p: Vec3): Vec3 {
  const x = p[0] - pl.x * T, y = p[1] - levelY(pl.l), z = p[2] - pl.z * T;
  const [lx, lz] = rot2(x, z, -pl.r);
  return [lx, y, lz];
}

/** spawn pose on a start piece (or a checkpoint): position and forward */
export function spawnPose(pl: Placed, along = -2.5): { p: Vec3; f: Vec3 } {
  return { p: toWorld(pl, [0, 0.9, along]), f: toWorld(pl, [0, 0, 1], true) };
}

export function inGate(pl: Placed, p: Vec3): boolean {
  const [x, y, z] = toLocal(pl, p);
  return Math.abs(x) < ROAD_W / 2 + 0.6 && y > -1 && y < 7 && Math.abs(z) < 1.4;
}

export function onBoost(pl: Placed, p: Vec3): boolean {
  const [x, y, z] = toLocal(pl, p);
  return Math.abs(x) < 3.2 && y > -0.5 && y < 2.5 && Math.abs(z) < 3.6;
}
