/** Four looks. Every colour in the game comes from here. */
export interface Theme {
  name: string;
  skyTop: number;
  skyHorizon: number;
  skyGround: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sunColor: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ground: number;
  groundAlt: number;
  far: number; // distant landforms
  farAlt: number;
  road: number;
  roadLine: number;
  edge: number;
  edgeAlt: number;
  side: number;
  under: number;
  boost: number;
  block: number;
  blockSide: number;
  pillar: number;
  accent: number;
  props: 'mesa' | 'pine' | 'palm' | 'crystal';
  water?: number;
  stars?: boolean;
  exposure: number;
}

export const THEMES: Theme[] = [
  {
    name: 'Mesa', skyTop: 0x4f86c6, skyHorizon: 0xffd6a8, skyGround: 0xe7b98a, fog: 0xf1cfa8, fogNear: 160, fogFar: 1300,
    sunColor: 0xfff0d8, sunIntensity: 2.6, sunDir: [-0.55, 0.62, 0.45], hemiSky: 0xbcd6f5, hemiGround: 0xd59a63, hemiIntensity: 1.25,
    ground: 0xe3b27c, groundAlt: 0xd9a36c, far: 0xc8683f, farAlt: 0xe08a55,
    road: 0x3d414b, roadLine: 0xf5e9cf, edge: 0xf6eee0, edgeAlt: 0xe2553a, side: 0xdcc6a2, under: 0xa98c6c, boost: 0xffae1a,
    block: 0xeadbc0, blockSide: 0xcfb08a, pillar: 0xc9ad88, accent: 0xff7a3d, props: 'mesa', exposure: 1.0,
  },
  {
    name: 'Pinewood', skyTop: 0x5d9fe0, skyHorizon: 0xe4f2ff, skyGround: 0xb7d39a, fog: 0xd8e9f2, fogNear: 150, fogFar: 1200,
    sunColor: 0xfffaf0, sunIntensity: 2.5, sunDir: [0.45, 0.72, 0.3], hemiSky: 0xcfe5ff, hemiGround: 0x7a9a58, hemiIntensity: 1.3,
    ground: 0x8fc06a, groundAlt: 0x7fb25c, far: 0x7d8ea6, farAlt: 0xf3f6fb,
    road: 0x3e434c, roadLine: 0xf0f4f7, edge: 0xf4f6f8, edgeAlt: 0x2f8fe0, side: 0xc9cfd6, under: 0x8e97a2, boost: 0xffb81f,
    block: 0xe3e8ec, blockSide: 0xb8c2cc, pillar: 0xaab4bf, accent: 0x2f8fe0, props: 'pine', exposure: 1.0,
  },
  {
    name: 'Lagoon', skyTop: 0x3bb4ec, skyHorizon: 0xe8fbff, skyGround: 0x7fd9d6, fog: 0xcdeff3, fogNear: 180, fogFar: 1400,
    sunColor: 0xfffbe8, sunIntensity: 2.7, sunDir: [0.3, 0.8, -0.5], hemiSky: 0xc4ecff, hemiGround: 0xe8d6a8, hemiIntensity: 1.3,
    ground: 0xf0dcab, groundAlt: 0xe8d09a, far: 0x4f9a5a, farAlt: 0x68b46c, water: 0x2cc3c7,
    road: 0x3b434c, roadLine: 0xfff6e0, edge: 0xfffaf0, edgeAlt: 0xff5f8a, side: 0xf2e2bd, under: 0xc9b58e, boost: 0xffb000,
    block: 0xfff1d4, blockSide: 0xe6cf9f, pillar: 0xe9d6ae, accent: 0xff5f8a, props: 'palm', exposure: 1.0,
  },
  {
    name: 'Dusk', skyTop: 0x1d1f4a, skyHorizon: 0xff8a6e, skyGround: 0x3b3560, fog: 0x6c5379, fogNear: 120, fogFar: 1000,
    sunColor: 0xffb48a, sunIntensity: 2.0, sunDir: [-0.7, 0.36, -0.5], hemiSky: 0x8f8ae0, hemiGround: 0x4a3a5e, hemiIntensity: 1.5,
    ground: 0x45415f, groundAlt: 0x3d3956, far: 0x2b2944, farAlt: 0x3a3658,
    road: 0x34374a, roadLine: 0x9df3ff, edge: 0xe8e4ff, edgeAlt: 0xa25cff, side: 0x5a5478, under: 0x3a3552, boost: 0xffa62b,
    block: 0x6c6690, blockSide: 0x4c4770, pillar: 0x4a4566, accent: 0x6ff0ff, props: 'crystal', stars: true, exposure: 1.08,
  },
];
