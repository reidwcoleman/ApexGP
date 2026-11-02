/**
 * The worlds the rounds are played in. Every round has its own: the sky (its gradient, the sun or
 * the moon, stars, an aurora, a synthwave sun), the sea far below (marbled paint, the ocean, lava,
 * ice, a swamp, a neon grid, a sand sea, a sea of cloud), the scenery standing round it
 * (env-biomes.ts), the course's own colours (its floor tiles, rails and arches) and the toys the
 * islands beside it hold (course-dress.ts). Colours here are sRGB hex.
 */

export type BiomeId = 'candy' | 'beach' | 'volcano' | 'arctic' | 'jungle' | 'space' | 'spooky' | 'neon' | 'desert' | 'autumn' | 'sunset' | 'royal';

export interface Biome {
  id: BiomeId;
  sky: {
    zen: number;
    mid: number;
    hor: number;
    band: number;
    below: number;
    /** the sun's glow round it, and its disc */
    glow: number;
    disc: number;
    /** 0 sun, 1 a big pale moon, 2 a striped synthwave sun */
    discKind: number;
    discSize: number;
    stars: number;
    aurora: number;
    cirrus: number;
  };
  sun: { color: number; k: number };
  hemi: { sky: number; ground: number; k: number };
  env: number;
  fog: number;
  lake: {
    pal: [number, number, number, number, number];
    mean: number;
    vein: number;
    veinK: number;
    /** 0: crisp marbled bands; 1: soft blends (water, sand) */
    soft: number;
    /** the bands' own light (lava, a nebula), and the veins' */
    self: number;
    emit: number;
    emitK: number;
    rough: number;
    coat: number;
    mirror: boolean;
    grid: number;
    /** band scale (bigger: wider bands) */
    scale: number;
  };
  clouds: { on: boolean; lit: number; shade: number };
  /** the course: floor tiles (pairs), the rails and posts, the zone arches */
  deck: { tiles: [number, number][]; arch: number[]; wall: number; rail: number; railB: number; post: number; base: number };
  /** the islands beside the course: their tops and undersides */
  isle: { top: number[]; under: number };
}

const DECK_CANDY = {
  tiles: [[0xff9cc8, 0xffc8e0], [0x86e3bd, 0xb4f2d6], [0xffe27a, 0xfff1b8], [0x8ec8ff, 0xbfe0ff], [0xc9a2ff, 0xe0caff], [0xffbf7a, 0xffdcb2], [0xff9e8e, 0xffc6bb], [0xc6ef7e, 0xe0f8b4], [0x7fe6e6, 0xb6f3f1]] as [number, number][],
  arch: [0xff4f8f, 0x22c08a, 0xffb81f, 0x2f8cff, 0x9a5bff, 0xff8a1f, 0xff5a4a, 0x7cc81f, 0x16c0c0],
};

export const BIOMES: Record<BiomeId, Biome> = {
  candy: {
    id: 'candy',
    sky: { zen: 0x3c7ce5, mid: 0x7cbcff, hor: 0xbcdfff, band: 0xffefec, below: 0xdadffd, glow: 0xffd8a8, disc: 0xfff2dc, discKind: 0, discSize: 1, stars: 0, aurora: 0, cirrus: 1 },
    sun: { color: 0xfff0da, k: 3.2 },
    hemi: { sky: 0xc4dcff, ground: 0xe0a49a, k: 0.6 },
    env: 0.9,
    fog: 1 / 1800,
    lake: { pal: [0xfa50a1, 0x00c4e0, 0xffd131, 0x9e69e9, 0x45a1f6], mean: 0xb6a2c8, vein: 0xfff9ed, veinK: 0.9, soft: 0, self: 0, emit: 0x000000, emitK: 0, rough: 0.06, coat: 1, mirror: true, grid: 0, scale: 1 },
    clouds: { on: true, lit: 0xffffff, shade: 0xc6cdf2 },
    deck: { ...DECK_CANDY, wall: 0x9b6bff, rail: 0x8a4bff, railB: 0xffffff, post: 0xff5fa8, base: 0x4b2f91 },
    isle: { top: [0xfff2c8, 0xd8f5c0, 0xffd6ea, 0xd6ecff], under: 0xa58ad8 },
  },
  beach: {
    id: 'beach',
    sky: { zen: 0x1f78e0, mid: 0x5fb6ff, hor: 0xcdeeff, band: 0xfff4dc, below: 0xb8e8ee, glow: 0xffe2b0, disc: 0xfff6e0, discKind: 0, discSize: 1.1, stars: 0, aurora: 0, cirrus: 0.6 },
    sun: { color: 0xfff4e0, k: 3.5 },
    hemi: { sky: 0xcfe8ff, ground: 0x7fd6d0, k: 0.65 },
    env: 0.95,
    fog: 1 / 2000,
    lake: { pal: [0x0b86b8, 0x12b4c6, 0x0a68a6, 0x1fc6bd, 0x0c7cb0], mean: 0x16a0bc, vein: 0xffffff, veinK: 0.35, soft: 1, self: 0.08, emit: 0x000000, emitK: 0, rough: 0.04, coat: 1, mirror: true, grid: 0, scale: 1.4 },
    clouds: { on: true, lit: 0xffffff, shade: 0xc8dcf2 },
    deck: {
      tiles: [[0xffe6b0, 0xfff3d8], [0x7fe0e0, 0xb8f2f0], [0xffb38a, 0xffd6bf], [0x9fd8ff, 0xcde9ff], [0xfff09a, 0xfff8cc], [0xa8ecb0, 0xd0f6d4]],
      arch: [0xff6a3d, 0x00b4c8, 0xffc21f, 0x2f8cff, 0xff4f8f, 0x22c08a],
      wall: 0x00a8c0, rail: 0xff6a3d, railB: 0xffffff, post: 0x00b4c8, base: 0x1d6f8a,
    },
    isle: { top: [0xffe2a8, 0xf6d896], under: 0xd8a868 },
  },
  volcano: {
    id: 'volcano',
    sky: { zen: 0x1c0a10, mid: 0x5a1e18, hor: 0xc85a32, band: 0xffa060, below: 0x4a2018, glow: 0xff8040, disc: 0xffc080, discKind: 0, discSize: 1.6, stars: 0.15, aurora: 0, cirrus: 0 },
    sun: { color: 0xffb27a, k: 2.7 },
    hemi: { sky: 0xff9a70, ground: 0xff4a10, k: 0.55 },
    env: 0.75,
    fog: 1 / 1100,
    lake: { pal: [0x1c0c08, 0x2c0e08, 0xff5a10, 0x140606, 0xffa020], mean: 0x6a2410, vein: 0xffd060, veinK: 0.9, soft: 0.25, self: 1.8, emit: 0xff8a20, emitK: 3, rough: 0.5, coat: 0.15, mirror: false, grid: 0, scale: 0.8 },
    clouds: { on: true, lit: 0x7a5a50, shade: 0x2a1c1c },
    deck: {
      tiles: [[0x5a4a48, 0x6e5c58], [0xff8a3d, 0xffae70], [0x3c3236, 0x4e4248], [0xffc24a, 0xffd98a], [0x6a3a30, 0x84504a]],
      arch: [0xff5a10, 0xffb020, 0xd02020, 0xff7a30, 0xffd040],
      wall: 0x2a2226, rail: 0xff5a10, railB: 0x2a2226, post: 0xffb020, base: 0x1a1214,
    },
    isle: { top: [0x3a3034, 0x4a3a3a], under: 0x221a1c },
  },
  arctic: {
    id: 'arctic',
    sky: { zen: 0x1a4aa8, mid: 0x6aa8e8, hor: 0xe2f4ff, band: 0xffffff, below: 0xdcefff, glow: 0xfff0e0, disc: 0xffffff, discKind: 0, discSize: 0.9, stars: 0.2, aurora: 1, cirrus: 0.5 },
    sun: { color: 0xfff8f0, k: 3.1 },
    hemi: { sky: 0xd8ecff, ground: 0xffffff, k: 0.75 },
    env: 1.0,
    fog: 1 / 1500,
    lake: { pal: [0xcfeeff, 0x9fd6f2, 0xeaf8ff, 0x86c6e8, 0xdaf2ff], mean: 0xc0e6f6, vein: 0xffffff, veinK: 0.55, soft: 0.45, self: 0.1, emit: 0x000000, emitK: 0, rough: 0.1, coat: 1, mirror: true, grid: 0, scale: 0.9 },
    clouds: { on: true, lit: 0xffffff, shade: 0xbcd0ee },
    deck: {
      tiles: [[0xe8f6ff, 0xffffff], [0x9fd6ff, 0xc8e8ff], [0xc8b8ff, 0xe0d8ff], [0x8ee8e0, 0xc0f4ee], [0xbfe0ff, 0xe0f0ff]],
      arch: [0x2f8cff, 0x16c0c0, 0x9a5bff, 0xff4f8f, 0x22a0e0],
      wall: 0x2f8cff, rail: 0x2f6cff, railB: 0xffffff, post: 0x16c0c0, base: 0x2a4a86,
    },
    isle: { top: [0xffffff, 0xf0f8ff], under: 0x9ec8e8 },
  },
  jungle: {
    id: 'jungle',
    sky: { zen: 0x2280c4, mid: 0x86cce4, hor: 0xd6f0d8, band: 0xfff4c8, below: 0x9ed0a8, glow: 0xffe0a0, disc: 0xfff4d8, discKind: 0, discSize: 1, stars: 0, aurora: 0, cirrus: 0.4 },
    sun: { color: 0xfff0c8, k: 3.1 },
    hemi: { sky: 0xd0f0c0, ground: 0x5a8a3a, k: 0.65 },
    env: 0.85,
    fog: 1 / 1300,
    lake: { pal: [0x1a6a48, 0x2a8a5a, 0x14563c, 0x3aa070, 0x206c56], mean: 0x22785a, vein: 0xb8f0c0, veinK: 0.3, soft: 0.8, self: 0.05, emit: 0x000000, emitK: 0, rough: 0.05, coat: 1, mirror: true, grid: 0, scale: 1.2 },
    clouds: { on: true, lit: 0xfffff4, shade: 0xb8d0c0 },
    deck: {
      tiles: [[0xa8e070, 0xc8f0a0], [0xffd060, 0xffe6a0], [0x70d8b0, 0xa8ecd0], [0xff9a70, 0xffc0a8], [0xd8f080, 0xecf8b8]],
      arch: [0x22a040, 0xff8a1f, 0xffc21f, 0xe03a5a, 0x16a0a0],
      wall: 0x3a8a2a, rail: 0x8a5a2a, railB: 0xffe6a0, post: 0x22a040, base: 0x3a2a18,
    },
    isle: { top: [0x6ac040, 0x58b03a], under: 0x8a6a48 },
  },
  space: {
    id: 'space',
    sky: { zen: 0x04020c, mid: 0x0e0826, hor: 0x2a1450, band: 0x6a3a9a, below: 0x0a0618, glow: 0x9a7aff, disc: 0xf0f0ff, discKind: 0, discSize: 0.7, stars: 1, aurora: 0, cirrus: 0 },
    sun: { color: 0xe4e8ff, k: 2.6 },
    hemi: { sky: 0x8a9cff, ground: 0xff6ad0, k: 0.5 },
    env: 0.7,
    fog: 1 / 3200,
    lake: { pal: [0x0c0620, 0x1a0a40, 0x3a1070, 0x0a1a50, 0x200830], mean: 0x180c38, vein: 0xff6ad8, veinK: 0.8, soft: 0.5, self: 0.9, emit: 0xff60d0, emitK: 1.8, rough: 0.12, coat: 1, mirror: true, grid: 0, scale: 1.2 },
    clouds: { on: false, lit: 0xffffff, shade: 0xffffff },
    deck: {
      tiles: [[0x3a2a7a, 0x4a3a90], [0x2a6aa8, 0x3a80c0], [0x6a2a8a, 0x8040a0], [0x1a7a8a, 0x2a94a4], [0x2a2a5a, 0x3a3a70]],
      arch: [0xff40c0, 0x30e0ff, 0x9a5bff, 0xffd040, 0x40ff9a],
      wall: 0x30e0ff, rail: 0xff40c0, railB: 0x1a1430, post: 0x30e0ff, base: 0x0e0a20,
    },
    isle: { top: [0x6a6a8a, 0x8a7aa8], under: 0x3a3450 },
  },
  spooky: {
    id: 'spooky',
    sky: { zen: 0x0a0820, mid: 0x261a48, hor: 0x5a3c6c, band: 0x9a6a8a, below: 0x1c1828, glow: 0xb8c8ff, disc: 0xf4f0d8, discKind: 1, discSize: 3.2, stars: 0.6, aurora: 0, cirrus: 0.3 },
    sun: { color: 0xb8c8ff, k: 1.9 },
    hemi: { sky: 0x8a8ac8, ground: 0x3a5a3a, k: 0.55 },
    env: 0.65,
    fog: 1 / 1000,
    lake: { pal: [0x12221a, 0x1c2a14, 0x2a1e30, 0x0e1a14, 0x22301a], mean: 0x1a2418, vein: 0x8aff70, veinK: 0.55, soft: 0.5, self: 0.15, emit: 0x60ff50, emitK: 1.4, rough: 0.2, coat: 0.7, mirror: true, grid: 0, scale: 1 },
    clouds: { on: true, lit: 0x8a7aa8, shade: 0x2e2640 },
    deck: {
      tiles: [[0x6a4a8a, 0x80609e], [0xff8a2a, 0xffa858], [0x3a5a4a, 0x4e6e5c], [0x8a6aa8, 0xa084be], [0x4a3a5a, 0x5e4c70]],
      arch: [0xff7a1a, 0x9a5bff, 0x60e050, 0xff4f8f, 0xffc21f],
      wall: 0x3a2a4a, rail: 0xff7a1a, railB: 0x2a1a3a, post: 0x9a5bff, base: 0x1a1222,
    },
    isle: { top: [0x3a4a3a, 0x4a3a52], under: 0x2a2230 },
  },
  neon: {
    id: 'neon',
    sky: { zen: 0x080320, mid: 0x320a52, hor: 0xff4fa0, band: 0xffb050, below: 0x180630, glow: 0xff60b0, disc: 0xffd060, discKind: 2, discSize: 6.5, stars: 0.7, aurora: 0, cirrus: 0 },
    sun: { color: 0xffb8e0, k: 2.4 },
    hemi: { sky: 0xff8ad8, ground: 0x40e0ff, k: 0.55 },
    env: 0.7,
    fog: 1 / 1600,
    lake: { pal: [0x0a0820, 0x100a30, 0x080618, 0x140c38, 0x0c0a26], mean: 0x0c0a26, vein: 0xff40c0, veinK: 0, soft: 1, self: 0, emit: 0xff40c0, emitK: 2.5, rough: 0.04, coat: 1, mirror: true, grid: 1, scale: 1 },
    clouds: { on: false, lit: 0xffffff, shade: 0xffffff },
    deck: {
      tiles: [[0x2a1a5a, 0x3a2470], [0x5a1a6a, 0x702484], [0x1a2a6a, 0x243a84], [0x4a1a4a, 0x602460]],
      arch: [0xff40c0, 0x30e0ff, 0xffd040, 0x9a5bff, 0x40ff9a],
      wall: 0x30e0ff, rail: 0xff40c0, railB: 0x140a30, post: 0x30e0ff, base: 0x0a0618,
    },
    isle: { top: [0x2a1a4a, 0x1a1a3a], under: 0x120a24 },
  },
  desert: {
    id: 'desert',
    sky: { zen: 0x3070c4, mid: 0x86b4e0, hor: 0xf6dcb0, band: 0xffd8a0, below: 0xe8c890, glow: 0xffd8a0, disc: 0xfff4e0, discKind: 0, discSize: 1.2, stars: 0, aurora: 0, cirrus: 0.2 },
    sun: { color: 0xfff0d0, k: 3.7 },
    hemi: { sky: 0xd8e8ff, ground: 0xe8b070, k: 0.6 },
    env: 0.9,
    fog: 1 / 1400,
    lake: { pal: [0xe8c088, 0xd8a868, 0xf0d098, 0xc89458, 0xe0b478], mean: 0xdeb27a, vein: 0xfff0d0, veinK: 0.12, soft: 0.95, self: 0, emit: 0x000000, emitK: 0, rough: 0.92, coat: 0, mirror: false, grid: 0, scale: 0.7 },
    clouds: { on: true, lit: 0xfff8f0, shade: 0xd8c8c0 },
    deck: {
      tiles: [[0xf6c890, 0xfadcb0], [0x7fd0c8, 0xb0e8e0], [0xff9a70, 0xffbca0], [0xf0e090, 0xf8eebc], [0xd8a070, 0xe8bc94]],
      arch: [0xe8602a, 0x16a0a0, 0xffb81f, 0xc0402a, 0x2f8cff],
      wall: 0xc8703a, rail: 0x16a0a0, railB: 0xfff0d8, post: 0xe8602a, base: 0x6a3a1a,
    },
    isle: { top: [0xe8c088, 0xd8b078], under: 0xb87848 },
  },
  autumn: {
    id: 'autumn',
    sky: { zen: 0x3a74b8, mid: 0x9cc0e0, hor: 0xf8e2c4, band: 0xffc890, below: 0xe8c8a0, glow: 0xffc888, disc: 0xfff0d8, discKind: 0, discSize: 1.1, stars: 0, aurora: 0, cirrus: 0.7 },
    sun: { color: 0xffe2b8, k: 3.1 },
    hemi: { sky: 0xffe8c8, ground: 0xc87840, k: 0.62 },
    env: 0.85,
    fog: 1 / 1500,
    lake: { pal: [0xd88a20, 0xb86818, 0xe8a040, 0xa05010, 0xf0b850], mean: 0xc88028, vein: 0xfff0c0, veinK: 0.6, soft: 0.35, self: 0.1, emit: 0x000000, emitK: 0, rough: 0.07, coat: 1, mirror: true, grid: 0, scale: 1 },
    clouds: { on: true, lit: 0xfff6ec, shade: 0xd0b8b0 },
    deck: {
      tiles: [[0xffb060, 0xffcc90], [0xff8060, 0xffa890], [0xf0d070, 0xf8e4a8], [0xc8a0e0, 0xdcc0ec], [0xa8d070, 0xc8e4a0]],
      arch: [0xe8501a, 0xffb020, 0xc02a3a, 0x8a5a2a, 0x7a9a2a],
      wall: 0x8a4a2a, rail: 0xe8501a, railB: 0xfff0d8, post: 0xffb020, base: 0x4a2a18,
    },
    isle: { top: [0xd89040, 0xc8a050], under: 0x7a5a3a },
  },
  sunset: {
    id: 'sunset',
    sky: { zen: 0x2e2470, mid: 0xb0558a, hor: 0xffaa80, band: 0xffd4a0, below: 0xf0a090, glow: 0xffa070, disc: 0xffe0b0, discKind: 0, discSize: 1.8, stars: 0.1, aurora: 0, cirrus: 0.8 },
    sun: { color: 0xffc8a0, k: 2.9 },
    hemi: { sky: 0xffb8d0, ground: 0xff9060, k: 0.62 },
    env: 0.85,
    fog: 1 / 1500,
    lake: { pal: [0x6a3418, 0xff9cc0, 0xf0c080, 0x8a4a20, 0xfff0e0], mean: 0xc0805a, vein: 0xfff4e8, veinK: 0.9, soft: 0, self: 0, emit: 0x000000, emitK: 0, rough: 0.07, coat: 1, mirror: true, grid: 0, scale: 1.1 },
    clouds: { on: true, lit: 0xffd6c0, shade: 0x9a6a9a },
    deck: {
      tiles: [[0xffa8c8, 0xffcce0], [0xffc890, 0xffe0bc], [0xd8a0ff, 0xe8c8ff], [0xff9c90, 0xffc4bc], [0xfff0a0, 0xfff8d0]],
      arch: [0xff4f8f, 0xff8a1f, 0x9a5bff, 0xffc21f, 0xe03a5a],
      wall: 0x9a5bff, rail: 0xff4f8f, railB: 0xfff4e8, post: 0xff8a1f, base: 0x4a2a5a,
    },
    isle: { top: [0xfff2c8, 0xffd6ea], under: 0xc07a9a },
  },
  royal: {
    id: 'royal',
    sky: { zen: 0x2a5ab8, mid: 0x8ab4ee, hor: 0xfff0d4, band: 0xffe0a0, below: 0xfff6e8, glow: 0xffe0a0, disc: 0xfffbea, discKind: 0, discSize: 1.3, stars: 0, aurora: 0, cirrus: 0.6 },
    sun: { color: 0xfff4d8, k: 3.5 },
    hemi: { sky: 0xfff0d0, ground: 0xffe0a8, k: 0.72 },
    env: 1.0,
    fog: 1 / 1700,
    lake: { pal: [0xffffff, 0xf2eeff, 0xfff4e4, 0xeaf0ff, 0xfffaf0], mean: 0xf6f4f8, vein: 0xffd870, veinK: 0.45, soft: 0.9, self: 0.18, emit: 0x000000, emitK: 0, rough: 0.35, coat: 0.3, mirror: false, grid: 0, scale: 1.3 },
    clouds: { on: true, lit: 0xffffff, shade: 0xd8d4f0 },
    deck: {
      tiles: [[0xffe68a, 0xfff2c0], [0xb8a0ff, 0xd4c6ff], [0xff9cc0, 0xffc4da], [0x9fd0ff, 0xc8e4ff], [0xffffff, 0xf4f0ff]],
      arch: [0xffc21f, 0x9a5bff, 0xe03a5a, 0x2f6cff, 0xffd870],
      wall: 0x7a4bdf, rail: 0xffc21f, railB: 0xffffff, post: 0x7a4bdf, base: 0x3a2a7a,
    },
    isle: { top: [0xffffff, 0xf8f4ff], under: 0xd8d0f0 },
  },
};

/** which world each round is in */
export const ROUND_BIOME: Record<string, BiomeId> = {
  hopscotch: 'candy',
  bonkbay: 'beach',
  knockknock: 'spooky',
  whirligig: 'space',
  bonkalley: 'autumn',
  wobblewalk: 'jungle',
  skystairs: 'arctic',
  jellyjunction: 'sunset',
  punchline: 'neon',
  rumblehill: 'desert',
  crownpeak: 'royal',
  lavarush: 'volcano',
  crumble: 'sunset',
  meltdown: 'arctic',
  jumpclub: 'space',
  tiptop: 'beach',
  paintparty: 'candy',
  splatring: 'neon',
};

let cur: Biome = BIOMES.candy;
export const biome = () => cur;
export function setBiome(id: BiomeId) {
  cur = BIOMES[id] ?? BIOMES.candy;
  return cur;
}
export const biomeOf = (round: string) => BIOMES[ROUND_BIOME[round] ?? 'candy'];
