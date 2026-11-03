import type { TrackData } from './track.ts';

/** Everything saved lives in localStorage; every access is guarded (private windows throw). */
export interface Profile {
  name: string;
  paint: number;
  accent: number;
  volume: number;
  cam: number;
  ghost: boolean;
  pbs: Record<string, number>; // track id -> best ms
  splits: Record<string, number[]>; // track id -> checkpoint ms of the best run
  lastTrack: string;
}

const KEY = 'tracksmith.v1';
const MINE = 'tracksmith.mine.v1';
const GHOST = 'tracksmith.ghost.';

const DEFAULT: Profile = { name: 'Driver', paint: 0xff4d3d, accent: 0x1b1d23, volume: 0.7, cam: 0, ghost: true, pbs: {}, splits: {}, lastTrack: 'ts01' };

function get(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function set(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch {}
}
function del(k: string) {
  try { localStorage.removeItem(k); } catch {}
}

export function loadProfile(): Profile {
  try {
    const raw = get(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT, pbs: {}, splits: {} };
}
export const saveProfile = (p: Profile) => set(KEY, JSON.stringify(p));

export function loadMine(): TrackData[] {
  try {
    const raw = get(MINE);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
export const saveMine = (t: TrackData[]) => set(MINE, JSON.stringify(t));

// ghosts: Float32 frames (x y z qx qy qz qw) at 60 Hz, stored base64
export function saveGhost(id: string, frames: Float32Array) {
  const u8 = new Uint8Array(frames.buffer, frames.byteOffset, frames.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  set(GHOST + id, btoa(s));
}
export function loadGhost(id: string): Float32Array | null {
  const s = get(GHOST + id);
  if (!s) return null;
  try {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(u8.buffer);
  } catch { return null; }
}
export const dropGhost = (id: string) => del(GHOST + id);

export function fmt(ms: number, plus = false): string {
  const neg = ms < 0;
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = ms % 1000;
  const body = `${m > 0 ? m + ':' + String(s).padStart(2, '0') : s}.${String(x).padStart(3, '0')}`;
  return (neg ? '-' : plus ? '+' : '') + body;
}
