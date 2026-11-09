/** What both ends of a match agree on: weapons, teams, messages. */

export type Mode = 'tdm' | 'ffa' | 'rounds' | 'hold';
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
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  carbine: {
    name: 'Carbine', cycle: 0.083, auto: true, dmg: 46, pellets: 1, headX: 3.2, mag: 30, reserve: 90, reload: 2.5, hip: 1.5, ads: 0.1, move: 0.35, kick: 0.62, wander: 0.34, settle: 11,
    range: 70, falloff: 0.7, pen: 1, hipPos: [0.13, -0.105, 0.3], adsPos: [0, -0.112, 0.14], adsFov: 72, muzzle: [0, 0.043, 0.695], support: [0, 0.012, 0.29], eject: [0.02, 0.05, 0.02], loud: 70, speed: 1, shove: 7, brass: 1,
  },
  shotgun: {
    name: 'Pump gun', cycle: 0.92, auto: false, dmg: 17, pellets: 9, headX: 1.8, mag: 6, reserve: 24, reload: 3.6, hip: 2.6, ads: 2.1, move: 0.15, kick: 3.6, wander: 0.5, settle: 7,
    range: 13, falloff: 0.28, pen: 0.5, hipPos: [0.13, -0.105, 0.29], adsPos: [0, -0.086, 0.27], adsFov: 76, muzzle: [0, 0.036, 0.68], support: [0, 0.012, 0.34], eject: [0.02, 0.04, 0.02], loud: 85, speed: 1, shove: 3.2, brass: 1.9,
  },
  rifle: {
    name: 'Bolt rifle', cycle: 1.3, auto: false, dmg: 110, pellets: 1, headX: 3.5, mag: 5, reserve: 20, reload: 3.4, hip: 3.2, ads: 0.02, move: 0.6, kick: 3.0, wander: 0.4, settle: 6,
    range: 120, falloff: 0.85, pen: 2.1, hipPos: [0.13, -0.1, 0.29], adsPos: [0, -0.104, 0.09], adsFov: 19, muzzle: [0, 0.075, 0.93], support: [0, 0.02, 0.3], eject: [0.02, 0.07, 0.03], loud: 100, speed: 0.94, shove: 15, brass: 1.5,
  },
  pistol: {
    name: 'Service pistol', cycle: 0.14, auto: false, dmg: 38, pellets: 1, headX: 3.0, mag: 15, reserve: 45, reload: 1.9, hip: 1.1, ads: 0.25, move: 0.3, kick: 1.5, wander: 0.5, settle: 12,
    range: 35, falloff: 0.6, pen: 0.56, hipPos: [0.1, -0.17, 0.42], adsPos: [0, -0.078, 0.34], adsFov: 78, muzzle: [0, 0.058, 0.19], support: [0, -0.02, 0.0], eject: [0.02, 0.07, 0.05], loud: 55, speed: 1.06, shove: 4, brass: 0.7,
  },
};

export const PRIMARIES: WeaponId[] = ['carbine', 'shotgun', 'rifle'];

export const TEAM_NAME = ['Unit', 'Crew'];

/** actor flags in the state packet */
export const F = { crouch: 1, ads: 2, sprint: 4, light: 8, reload: 16, alive: 32, moving: 64, cook: 128 };

export const STRIDE = 10;
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
}

export interface MatchConfig {
  /** the location; a room's guests move to it when they join */
  map?: 'block' | 'cove' | 'ward' | 'motel' | 'mansion';
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
  | { t: 'shot'; s: number; w: number; o: [number, number, number]; e: number[]; surf: string[]; }
  | { t: 'hit'; s: number; by: number; dmg: number; hp: number; zone: number; dir: [number, number, number]; bleed?: number }
  /** health changed without a new wound: the bleed, a bandage */
  | { t: 'hp'; s: number; hp: number; bleed: number; healed?: boolean }
  | { t: 'die'; s: number; by: number; zone: number; w: number; dir: [number, number, number]; dist: number }
  | { t: 'door'; i: number; open: number; dir: number; blast?: number }
  | { t: 'pane'; i: number; at?: [number, number, number] }
  | { t: 'nade'; s: number; kind: NadeKind; o: [number, number, number]; v: [number, number, number]; fuse: number; id: number }
  | { t: 'boom'; id: number; kind: NadeKind; p: [number, number, number] }
  | { t: 'phase'; phase: Phase; round: number; clock: number; score: [number, number]; msg?: string; winner?: number; hold?: number }
  | { t: 'hold'; zone: number; owner: number; prog: number; score: [number, number] }
  | { t: 'chat'; from: string; text: string };

export type Phase = 'warmup' | 'live' | 'between' | 'over';

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
  | { t: 'respawn' };

export const ZONE = { head: 0, torso: 1, limb: 2, blast: 3, leg: 4 };
export const ZONE_NAME = ['head', 'chest', 'arm', 'blast', 'leg'];
/** weapon ids that aren't guns */
export const W_BLAST = -1, W_BOOT = -2;
export const zoneK = (zone: number) => (zone === ZONE.limb || zone === ZONE.leg ? 0.72 : 1);

export const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
