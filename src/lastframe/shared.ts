/** What both ends of a match agree on: weapons, teams, messages. */

export type Mode = 'tdm' | 'ffa' | 'rounds' | 'hold' | 'gun' | 'siege';
/** one life a round */
export const oneLife = (m?: Mode) => m === 'rounds' || m === 'siege';
/** everyone for themselves */
export const solo = (m?: Mode) => m === 'ffa' || m === 'gun';
export type WeaponId = 'carbine' | 'shotgun' | 'rifle' | 'pistol';
export type NadeKind = 'frag' | 'flash';

export interface WeaponSpec {
  name: string;
  /** seconds between shots */
  cycle: number;
  auto: boolean;
  dmg: number;
  pellets: number;
  headX: number;
  mag: number;
  reserve: number;
  reload: number;
  /** spread, degrees: from the hip, aimed, per metre a second of movement */
  hip: number;
  ads: number;
  move: number;
  /** recoil: degrees up per shot, side wander, how fast it settles */
  kick: number;
  wander: number;
  settle: number;
  /** a bullet's reach before it falls off, and the share left beyond */
  range: number;
  falloff: number;
  /** punch: 1 leaves a carbine's worth after a thin wall; 0 stops at anything */
  pen: number;
  /** view: grip position from the hip, aimed; aimed field of view */
  hipPos: [number, number, number];
  adsPos: [number, number, number];
  adsFov: number;
  /** gun-local (metres) */
  muzzle: [number, number, number];
  support: [number, number, number];
  eject: [number, number, number];
  /** how loud it reads to bots, metres */
  loud: number;
  speed: number;
  /** push on what it hits, newton-seconds, and the size of its brass */
  shove: number;
  brass: number;
  /** seconds for the sights to come up */
  adsT: number;
  /** the recoil of a burst, shot by shot: degrees up and to the side. It is the same every time, so it can be learned
   *  and pulled against; past its end the last six go round again */
  pat: [number, number][];
  /** spread a burst gathers, degrees a shot, and where it stops */
  bloom: number;
  bloomMax: number;
  /** the share an arm or a leg takes */
  limb: number;
  /** what one hit does to a barricade's board (a board stands two) */
  wreck: number;
}

/** the kick of shot n of a burst */
export function recoilAt(spec: WeaponSpec, n: number): [number, number] {
  const p = spec.pat;
  return n < p.length ? p[n] : p[p.length - 6 + ((n - p.length) % 6)] ?? p[p.length - 1];
}
/** a round in the head ends it, whatever fired it (a pellet is not a round) */
export const HEAD_KILL = 260;
export function hitDamage(spec: WeaponSpec, zone: number, k: number): number {
  if (zone === 0) return spec.pellets > 1 ? spec.dmg * k * spec.headX : HEAD_KILL;
  return spec.dmg * k * (zone === 2 || zone === 4 ? spec.limb : 1);
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  carbine: {
    name: 'Carbine', cycle: 0.083, auto: true, dmg: 36, pellets: 1, headX: 8, mag: 30, reserve: 150, reload: 2.4, hip: 3.4, ads: 0.03, move: 0.5, kick: 0.62, wander: 0.34, settle: 11,
    adsT: 0.3, bloom: 0.035, bloomMax: 0.5, limb: 0.75, wreck: 1,
    pat: [[0.95, 0.0], [0.9, 0.08], [0.82, -0.1], [0.74, 0.16], [0.62, 0.28], [0.52, 0.32], [0.46, 0.12], [0.42, -0.22], [0.4, -0.36], [0.38, -0.3], [0.36, 0.06], [0.36, 0.3], [0.34, 0.26], [0.34, -0.14], [0.34, -0.3]],
    range: 70, falloff: 0.7, pen: 1, hipPos: [0.13, -0.105, 0.3], adsPos: [0, -0.112, 0.14], adsFov: 72, muzzle: [0, 0.043, 0.695], support: [0, 0.012, 0.29], eject: [0.02, 0.05, 0.02], loud: 70, speed: 1, shove: 7, brass: 1,
  },
  shotgun: {
    name: 'Pump gun', cycle: 0.88, auto: false, dmg: 16, pellets: 9, headX: 1.8, mag: 6, reserve: 36, reload: 3.4, hip: 3.0, ads: 2.3, move: 0.15, kick: 3.6, wander: 0.5, settle: 7,
    adsT: 0.34, bloom: 0, bloomMax: 0, limb: 0.8, wreck: 2,
    pat: [[4.2, 0.4], [4.0, -0.5], [4.2, 0.3], [4.0, -0.3], [4.2, 0.5], [4.0, -0.4], [4.2, 0.3]],
    range: 13, falloff: 0.28, pen: 0.5, hipPos: [0.13, -0.105, 0.29], adsPos: [0, -0.086, 0.27], adsFov: 76, muzzle: [0, 0.036, 0.68], support: [0, 0.012, 0.34], eject: [0.02, 0.04, 0.02], loud: 85, speed: 1, shove: 3.2, brass: 1.9,
  },
  rifle: {
    name: 'Bolt rifle', cycle: 1.25, auto: false, dmg: 105, pellets: 1, headX: 8, mag: 5, reserve: 30, reload: 3.4, hip: 5.0, ads: 0.0, move: 0.9, kick: 3.0, wander: 0.4, settle: 6,
    adsT: 0.42, bloom: 0, bloomMax: 0, limb: 0.8, wreck: 2,
    pat: [[3.4, 0.3], [3.4, -0.3], [3.4, 0.2], [3.4, -0.2], [3.4, 0.3], [3.4, -0.3], [3.4, 0.2]],
    range: 120, falloff: 0.85, pen: 2.1, hipPos: [0.13, -0.1, 0.29], adsPos: [0, -0.104, 0.09], adsFov: 19, muzzle: [0, 0.075, 0.93], support: [0, 0.02, 0.3], eject: [0.02, 0.07, 0.03], loud: 100, speed: 0.94, shove: 15, brass: 1.5,
  },
  pistol: {
    name: 'Service pistol', cycle: 0.13, auto: false, dmg: 30, pellets: 1, headX: 8, mag: 15, reserve: 60, reload: 1.8, hip: 2.2, ads: 0.08, move: 0.3, kick: 1.5, wander: 0.5, settle: 12,
    adsT: 0.2, bloom: 0.12, bloomMax: 0.9, limb: 0.75, wreck: 1,
    pat: [[1.05, 0.08], [1.1, -0.16], [1.15, 0.22], [1.2, -0.2], [1.2, 0.26], [1.25, -0.24], [1.25, 0.2]],
    range: 35, falloff: 0.6, pen: 0.56, hipPos: [0.1, -0.17, 0.42], adsPos: [0, -0.078, 0.34], adsFov: 78, muzzle: [0, 0.058, 0.19], support: [0, -0.02, 0.0], eject: [0.02, 0.07, 0.05], loud: 55, speed: 1.06, shove: 4, brass: 0.7,
  },
};

export const PRIMARIES: WeaponId[] = ['carbine', 'shotgun', 'rifle'];
/** Gun Game: the gun you hold by how many you've killed. One more kill with the last of them wins */
export const GUN_LADDER: WeaponId[] = ['carbine', 'carbine', 'shotgun', 'shotgun', 'rifle', 'rifle', 'pistol', 'pistol'];

export const TEAM_NAME = ['Unit', 'Crew'];

/** actor flags in the state packet */
export const F = { crouch: 1, ads: 2, sprint: 4, light: 8, reload: 16, alive: 32, moving: 64, cook: 128, down: 256 };

export const STRIDE = 10;

/** where star shells are fired over a field: its x and z span in game axes, and how high they go */
export interface FlareSpec { x0: number; x1: number; z0: number; z1: number; h: number }
export interface FlareNow { x: number; y: number; z: number; k: number; id: number }
/**
 * The star shells over the field at match time t: one every 11 s or so (some don't go up), fired from one line or the
 * other out over the wire, up in two and a half seconds, then down slowly under a parachute for twenty, drifting. The
 * same for everyone who has the same clock: the host's bots see by them and every screen lights by them.
 */
export function flaresAt(t: number, f: FlareSpec, out: FlareNow[] = []) {
  out.length = 0;
  const P = 11, LIFE = 24, UP = 2.4;
  const i0 = Math.max(0, Math.floor((t - LIFE - 6) / P)), i1 = Math.floor(t / P);
  for (let i = i0; i <= i1; i++) {
    const h = (n: number) => {
      const s = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    if (h(1) > 0.85) continue;
    const age = t - (i * P + h(2) * 6);
    if (age < 0 || age > LIFE) continue;
    const west = h(3) < 0.5;
    const sx = west ? f.x0 + h(4) * 4 : f.x1 - h(4) * 4;
    const sz = f.z0 + (f.z1 - f.z0) * (0.12 + 0.76 * h(5));
    const up = Math.min(1, age / UP), ease = 1 - (1 - up) * (1 - up);
    const x = sx + (west ? 1 : -1) * (12 + h(6) * 24) * ease + Math.max(0, age - UP) * 0.5 * (h(7) - 0.35);
    const z = sz + (h(8) - 0.5) * 10 * ease;
    const y = age < UP ? f.h * ease : Math.max(1.5, f.h - (age - UP) * 1.6);
    const k = age < UP ? 0.12 * up : Math.min(1, (age - UP) / 0.7) * Math.min(1, (LIFE - age) / 2.5) * (y > 2 ? 1 : 0.3);
    out.push({ x, y, z, k, id: i });
  }
  return out;
}
/** one actor's slice: slot, x, y, z, yaw, pitch, lean, flags, weapon index, spare */
export const WEAPON_LIST: WeaponId[] = ['carbine', 'shotgun', 'rifle', 'pistol'];

export interface PlayerInfo {
  slot: number;
  id: string;
  name: string;
  team: number;
  bot: boolean;
  primary: WeaponId;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  hp: number;
  alive: boolean;
  /** on the floor, bleeding: alive, but out of the fight until someone gets them up */
  down?: boolean;
  /** what they carry when attacking, and when defending */
  kits?: [KitId, KitId];
}

/** still in the fight */
export const isUp = (p: { alive: boolean; down?: boolean }) => p.alive && !p.down;

/**
 * What someone brings to the attack-and-defend game besides a gun: one thing for the rounds they attack, one for the
 * rounds they defend.
 */
export type KitId = 'breacher' | 'scout' | 'point' | 'fortifier' | 'trapper' | 'medic';
export const KITS: Record<KitId, { name: string; side: 0 | 1; note: string }> = {
  breacher: { name: 'Breacher', side: 0, note: 'Four breaching charges, set in half the time.' },
  scout: { name: 'Scout', side: 0, note: 'A scope to push through a barricade (X). What it sees, the whole side sees. Three flashes.' },
  point: { name: 'Point', side: 0, note: 'One boot takes a whole barricade. An extra frag.' },
  fortifier: { name: 'Fortifier', side: 1, note: 'Four steel sheets for the walls, and boards up in half the time.' },
  trapper: { name: 'Trapper', side: 1, note: 'Three tripwires for doorways (X).' },
  medic: { name: 'Medic', side: 1, note: 'Gets people up in half the time and in better shape. Two bandages.' },
};
export const ATK_KITS: KitId[] = ['breacher', 'scout', 'point'];
export const DEF_KITS: KitId[] = ['fortifier', 'trapper', 'medic'];
export const DEFAULT_KITS: [KitId, KitId] = ['breacher', 'fortifier'];

export interface MatchConfig {
  /** the location; a room's guests move to it when they join */
  map?: 'ward' | 'store';
  mode: Mode;
  bots: number;
  skill: number;
  /** minutes */
  time: number;
  limit: number;
  seed: number;
}

export type Ev =
  | { t: 'roster'; players: PlayerInfo[] }
  | { t: 'spawn'; s: number; p: [number, number, number]; yaw: number; hp?: number; primary: WeaponId }
  /** on the floor: by whom and how, and how long they have */
  | { t: 'down'; s: number; by: number; zone: number; w: number; dir: [number, number, number]; secs: number }
  /** back on their feet */
  | { t: 'up'; s: number; by: number; hp: number }
  /** a wall: blown through, or sheeted with steel from one side. site: see walls.ts */
  | { t: 'wall'; kind: 'hole' | 'reinf'; site: number[]; side: number; by: number }
  /** a breaching charge on a wall */
  | { t: 'wcharge'; site: number[]; s: number; side: number; fuse: number }
  /** this round's cameras: x, y, z, yaw, pitch each; and which still work (a bit each) */
  | { t: 'cams'; list: number[][]; alive: number }
  /** a tripwire across doorway i (on: strung; off: gone, and whether it went off) */
  | { t: 'trip'; i: number; on: boolean; s: number; bang?: boolean }
  /** seen through a scope or a camera: where, for this side, for a few seconds */
  | { t: 'spot'; team: number; at: number[][] }
  | { t: 'shot'; s: number; w: number; o: [number, number, number]; e: number[]; surf: string[]; }
  | { t: 'hit'; s: number; by: number; dmg: number; hp: number; zone: number; dir: [number, number, number]; bleed?: number }
  /** health changed without a new wound: the bleed, a bandage */
  | { t: 'hp'; s: number; hp: number; bleed: number; healed?: boolean }
  | { t: 'die'; s: number; by: number; zone: number; w: number; dir: [number, number, number]; dist: number }
  | { t: 'door'; i: number; open: number; dir: number; blast?: number }
  | { t: 'pane'; i: number; at?: [number, number, number] }
  | { t: 'nade'; s: number; kind: NadeKind; o: [number, number, number]; v: [number, number, number]; fuse: number; id: number }
  | { t: 'boom'; id: number; kind: NadeKind; p: [number, number, number] }
  | { t: 'phase'; phase: Phase; round: number; clock: number; score: [number, number]; msg?: string; winner?: number; hold?: number; atk?: number; obj?: number[]; objName?: string }
  /** a barricade: which boards of doorway i are up (a bit each, the lowest first); by: who built it or broke the last one */
  | { t: 'bar'; i: number; boards: number; by?: number; blast?: boolean }
  /** a breaching charge set on barricade i, from this side of it, going off in fuse seconds */
  | { t: 'charge'; i: number; s: number; side: number; fuse: number }
  /** the objective: how far the attackers have got with it, who is in the room (attackers, defenders) */
  | { t: 'secure'; prog: number; n: [number, number] }
  | { t: 'hold'; zone: number; owner: number; prog: number; score: [number, number] }
  /** Gun Game: this one's next gun, and how far up the ladder that is */
  | { t: 'arm'; s: number; primary: WeaponId; step: number }
  /** team: a side's radio, heard by that side only */
  | { t: 'chat'; from: string; text: string; team?: number };

export type Phase = 'warmup' | 'prep' | 'live' | 'between' | 'over';

/** guest to host */
export type Req =
  | { t: 'hello'; name: string; primary: WeaponId; team: number }
  | { t: 'me'; primary?: WeaponId; team?: number; name?: string; ready?: boolean }
  | { t: 'shot'; w: number; o: [number, number, number]; e: number[]; surf: string[] }
  | { t: 'hit'; to: number; dmg: number; zone: number; w: number; dir: [number, number, number]; dist: number }
  | { t: 'door'; i: number; from: [number, number, number] }
  /** a boot through it */
  | { t: 'kick'; i: number; from: [number, number, number] }
  | { t: 'heal' }
  | { t: 'pane'; i: number; at?: [number, number, number] }
  | { t: 'nade'; kind: NadeKind; o: [number, number, number]; v: [number, number, number]; fuse: number }
  | { t: 'chat'; text: string }
  /** nail a barricade up in doorway i */
  | { t: 'bar'; i: number }
  /** boards hit by this one's rounds (doorway * 8 + board), each with what it did */
  | { t: 'barhit'; ids: number[]; k: number }
  /** a boot into barricade i */
  | { t: 'barkick'; i: number }
  /** a breaching charge on barricade i, set from this side (the sign along the doorway's normal) */
  | { t: 'charge'; i: number; side: number }
  /** a breaching charge on a wall, or a steel sheet on it, from this side */
  | { t: 'wcharge'; site: number[]; side: number }
  | { t: 'reinf'; site: number[]; side: number }
  /** a teammate got back on their feet */
  | { t: 'revive'; to: number }
  /** a camera shot out */
  | { t: 'camhit'; i: number }
  /** a tripwire strung across doorway i, or shot off it */
  | { t: 'trip'; i: number }
  | { t: 'triphit'; i: number }
  /** the other side, seen through the scope */
  | { t: 'spot'; slots: number[] }
  /** which kit for each side of the round */
  | { t: 'kits'; kits: [KitId, KitId] }
  | { t: 'respawn' };

export const ZONE = { head: 0, torso: 1, limb: 2, blast: 3, leg: 4 };
export const ZONE_NAME = ['head', 'chest', 'arm', 'blast', 'leg'];
/** weapon ids that aren't guns */
export const W_BLAST = -1, W_BOOT = -2;
export const zoneK = (zone: number) => (zone === ZONE.limb || zone === ZONE.leg ? 0.72 : 1);

/** a barricade is this many boards, and a body gets through once the lowest of them are out */
export const BOARDS = 6;
export const BOARDS_ALL = (1 << BOARDS) - 1;
/** the boards a body has to have out to get through (all but the top one) */
export const BOARDS_WAY = (1 << (BOARDS - 1)) - 1;
/** seconds to nail one up, to set a charge, and its fuse */
export const BUILD_T = 1.6, CHARGE_T = 1.1, CHARGE_FUSE = 2.6;
/** the attack-and-defend game: seconds of preparation, of action, to secure the room; charges a life */
export const SIEGE = { prep: 28, live: 180, secure: 9, charges: 2, sheets: 2, trips: 3, cams: 4, bleedOut: 24, revive: 3, upHp: 35, downHp: 20 };
/** seconds to sheet a wall, and to set a charge on one */
export const REINF_T = 2.4, WALL_CHARGE_T = 1.6;
/** what each kit changes */
export const kitCharges = (k?: KitId) => (k === 'breacher' ? 4 : SIEGE.charges);
export const kitSheets = (k?: KitId) => (k === 'fortifier' ? 4 : SIEGE.sheets);

export const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
