import { PIECES, DIRS, rot2, pieceIndex, volume, pieceMesh, pieceWalls, worldFrames, type Placed, type MeshOut, type Frame } from './pieces.ts';

/** a track: what the editor saves and the share code carries */
export interface TrackData {
  id: string;
  name: string;
  author: string;
  theme: number;
  pieces: Placed[];
  /** medal times in ms: [author, gold, silver, bronze] (0 = none) */
  medals?: [number, number, number, number];
  /** the order a driver takes through the pieces (built-in tracks only, for the autopilot) */
  route?: { i: number; rev: boolean }[];
}

// ---------------------------------------------------------------- the track DSL used for built-in tracks
//
// A turtle walks the grid laying pieces: S straight, B boost, C checkpoint, F finish (start is laid first
// automatically), L1-3 / R1-3 turns (tight / normal / wide), U / D one-level slope, U2 / D2 long slope,
// UU / DD two-level climb, J kicker, G<n> gap, O / OR loop shifting left / right, ^ / v change level
// without a piece. A number after S, B, G repeats it. Then: L4 L5 R4 R5 sweepers, KL / KR 2, 3, 5 banks,
// XL / XR 3, 5 steep banks, HL / HR helix up (DHL / DHR down), CL / CR corkscrew, SL / SR lane shift,
// Q crest, UP / DN four-level drop, T tunnel.

interface Turtle { x: number; z: number; l: number; d: number }

export function buildDSL(spec: string, base = 0): { pieces: Placed[]; route: { i: number; rev: boolean }[]; overlaps: string[] } {
  const pieces: Placed[] = [];
  const route: { i: number; rev: boolean }[] = [];
  const occ = new Map<string, number>();
  const overlaps: string[] = [];
  const T: Turtle = { x: 0, z: 0, l: base, d: 0 };

  const lay = (id: string, rev = false) => {
    const t = pieceIndex(id);
    const def = PIECES[t];
    let pl: Placed;
    if (!rev) {
      pl = { t, x: T.x, z: T.z, l: T.l, r: T.d };
      const [ex, ez] = rot2(def.exit.cell[0], def.exit.cell[1], T.d);
      const dw = (def.exit.dir + T.d) % 4;
      T.x = pl.x + ex + DIRS[dw][0];
      T.z = pl.z + ez + DIRS[dw][1];
      T.l += def.exit.dl;
      T.d = dw;
    } else {
      const r = (((T.d - def.exit.dir - 2) % 4) + 4) % 4;
      const [ex, ez] = rot2(def.exit.cell[0], def.exit.cell[1], r);
      pl = { t, x: T.x - ex, z: T.z - ez, l: T.l - def.exit.dl, r };
      const dw = (2 + r) % 4;
      T.x = pl.x + DIRS[dw][0];
      T.z = pl.z + DIRS[dw][1];
      T.l = pl.l;
      T.d = dw;
    }
    const vol = volume(pl);
    for (const [cx, cz, cl] of vol) {
      // a piece needs a clear level above and below it (a slab and a car)
      for (let l = cl - 1; l <= cl + 1; l++) {
        const o = occ.get(`${cx},${cz},${l}`);
        if (o !== undefined && o !== pieces.length && o !== pieces.length - 1) overlaps.push(`${id}#${pieces.length} at ${cx},${cz},${l} hits #${o}`);
      }
    }
    for (const [cx, cz, cl] of vol) occ.set(`${cx},${cz},${cl}`, pieces.length);
    route.push({ i: pieces.length, rev });
    pieces.push(pl);
  };

  lay('start');
  for (const tok of spec.trim().split(/\s+/)) {
    const m = /^([A-Z^v]+)(\d*)$/.exec(tok);
    if (!m) throw new Error('bad token ' + tok);
    const [, k, nStr] = m;
    const n = nStr ? Number(nStr) : 1;
    switch (k) {
      case 'S': for (let i = 0; i < n; i++) lay('road'); break;
      case 'B': for (let i = 0; i < n; i++) lay('boost'); break;
      case 'C': lay('check'); break;
      case 'F': lay('finish'); break;
      case 'L': lay(['turn1', 'turn2', 'turn3', 'turn4', 'turn5'][n - 1]); break;
      case 'R': lay(['turn1', 'turn2', 'turn3', 'turn4', 'turn5'][n - 1], true); break;
      case 'U': lay(n === 2 ? 'slope2' : 'slope'); break;
      case 'D': lay(n === 2 ? 'slope2' : 'slope', true); break;
      case 'UU': lay('climb'); break;
      case 'DD': lay('climb', true); break;
      case 'J': lay('ramp'); break;
      case 'JJ': lay('bigramp'); break;
      case 'W': for (let i = 0; i < n; i++) lay('wave'); break;
      case 'KL': lay(n === 5 ? 'bank5' : n === 3 ? 'bank3' : 'bank2'); break;
      case 'KR': lay(n === 5 ? 'bank5' : n === 3 ? 'bank3' : 'bank2', true); break;
      case 'XL': lay(n === 5 ? 'steep5' : 'steep3'); break;
      case 'XR': lay(n === 5 ? 'steep5' : 'steep3', true); break;
      case 'HL': lay('helixL'); break;
      case 'HR': lay('helixR'); break;
      case 'DHL': lay('helixR', true); break;
      case 'DHR': lay('helixL', true); break;
      case 'CL': lay('corkL'); break;
      case 'CR': lay('corkR'); break;
      case 'SL': lay('shiftL'); break;
      case 'SR': lay('shiftR'); break;
      case 'Q': for (let i = 0; i < n; i++) lay('hill'); break;
      case 'UP': lay('drop'); break;
      case 'DN': lay('drop', true); break;
      case 'T': for (let i = 0; i < n; i++) lay('tunnel'); break;
      case 'O': lay('loop'); break;
      case 'OR': lay('loopR'); break;
      case 'G': T.x += DIRS[T.d][0] * n; T.z += DIRS[T.d][1] * n; break;
      case '^': T.l += n; break;
      case 'v': T.l -= n; break;
      default: throw new Error('bad token ' + tok);
    }
  }
  return { pieces, route, overlaps };
}

// ---------------------------------------------------------------- geometry

export function trackMesh(pieces: Placed[]): MeshOut {
  const m: MeshOut = { pos: [], slot: [], idx: [] };
  for (const p of pieces) pieceMesh(p, m);
  return m;
}

export function wallMesh(pieces: Placed[]): MeshOut {
  const m: MeshOut = { pos: [], slot: [], idx: [] };
  for (const p of pieces) pieceWalls(p, m);
  return m;
}

/** the centre line a driver follows, from the route (built-ins) */
export function routeLine(td: TrackData): Frame[] {
  const out: Frame[] = [];
  if (!td.route) return out;
  for (const { i, rev } of td.route) {
    const pl = td.pieces[i];
    if (PIECES[pl.t].box) continue;
    const roll = PIECES[pl.t].feature === 'loop';
    let F: Frame[] = worldFrames(pl).map((f) => ({ ...f, roll }));
    if (rev) F = F.slice().reverse().map((f) => ({ ...f, f: [-f.f[0], -f.f[1], -f.f[2]] }));
    for (const f of F) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last.p[0] - f.p[0], last.p[1] - f.p[1], last.p[2] - f.p[2]) < 0.05) continue;
      out.push(f);
    }
  }
  return out;
}

export function validate(td: TrackData): string | null {
  const starts = td.pieces.filter((p) => PIECES[p.t].feature === 'start').length;
  const fins = td.pieces.filter((p) => PIECES[p.t].feature === 'finish').length;
  if (starts === 0) return 'Place a Start piece';
  if (starts > 1) return 'Only one Start piece';
  if (fins === 0) return 'Place a Finish piece';
  return null;
}

export const checkpoints = (td: TrackData) => td.pieces.filter((p) => PIECES[p.t].feature === 'check');
export const startPiece = (td: TrackData) => td.pieces.find((p) => PIECES[p.t].feature === 'start');

// ---------------------------------------------------------------- share codes

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const k = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < k; j++) s += B64[(n >> (18 - 6 * j)) & 63];
  }
  return s;
}
function unb64(s: string) {
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

/** TS1.<name>.<theme><pieces>: each piece is 6 bytes (type, x, z as int16 halves, level, rot) */
export function encodeTrack(td: TrackData): string {
  const bytes = new Uint8Array(1 + td.pieces.length * 6);
  bytes[0] = td.theme & 255;
  td.pieces.forEach((p, i) => {
    const o = 1 + i * 6;
    const X = Math.max(0, Math.min(4095, p.x + 2048)), Z = Math.max(0, Math.min(4095, p.z + 2048));
    bytes[o] = p.t;
    bytes[o + 1] = X & 255;
    bytes[o + 2] = Z & 255;
    bytes[o + 3] = (p.l + 128) & 255;
    bytes[o + 4] = p.r & 3;
    bytes[o + 5] = (X >> 8) | ((Z >> 8) << 4);
  });
  const name = encodeURIComponent(td.name).replace(/\./g, '%2E');
  const author = encodeURIComponent(td.author || '').replace(/\./g, '%2E');
  return `TS1.${name}.${author}.${b64(bytes)}`;
}

export function decodeTrack(code: string): TrackData | null {
  const parts = code.trim().split('.');
  if (parts.length < 4 || parts[0] !== 'TS1') return null;
  const bytes = unb64(parts[3]);
  if (bytes.length < 1) return null;
  const pieces: Placed[] = [];
  for (let o = 1; o + 6 <= bytes.length; o += 6) {
    const hi = bytes[o + 5] ?? 0;
    const t = bytes[o];
    if (t >= PIECES.length) continue;
    pieces.push({ t, x: (bytes[o + 1] | ((hi & 15) << 8)) - 2048, z: (bytes[o + 2] | ((hi >> 4) << 8)) - 2048, l: bytes[o + 3] - 128, r: bytes[o + 4] & 3 });
  }
  let name = 'Shared track', author = '';
  try {
    name = decodeURIComponent(parts[1]) || name;
    author = decodeURIComponent(parts[2]);
  } catch {}
  return { id: 'code-' + hash(code), name, author, theme: bytes[0] % 4, pieces };
}

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
