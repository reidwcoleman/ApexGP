import * as THREE from 'three';
import { VERGE } from '../Track.ts';
import { Frame3, beam, box, cylinder, disc, printQuadX, printQuadZ, type GeoBuilder } from './builder.ts';
import { styleOf, type Ctx } from './context.ts';
import { SPONSORS, type PrintAtlas } from './atlas.ts';
import { Rng } from './noise.ts';

/**
 * Bigger trackside structures for Monza: the start gantry with its five light
 * columns, two sponsor footbridges, marshal posts (cabin, marshals in orange,
 * LED flag panels), TV camera platforms, 150/100/50 braking boards, DRS and
 * sector boards, big corner billboards and the chicanes' sausage kerbs.
 */

const F = new Frame3();
const G = new Frame3();
const A = new THREE.Vector3(), B = new THREE.Vector3();

function frameAt(ctx: Ctx, s: number, lat: number, f = F): Frame3 {
  const t = ctx.track;
  const fr = t.frame(s);
  const o = t.point(s, lat, 0, new THREE.Vector3());
  return f.setHorizontal(o, fr.tangent.x, fr.tangent.z);
}

/** lattice column from y0 to y1 with a square footprint `w` */
function latticeColumn(b: GeoBuilder, f: Frame3, x: number, z: number, w: number, y0: number, y1: number, tube = 0.1) {
  const h = w / 2;
  const corners: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [cx, cz] of corners) box(b, f, x + cx, (y0 + y1) / 2, z + cz, tube, y1 - y0, tube, 0b110111);
  const step = 1.0;
  for (let y = y0 + 0.4; y < y1 - 0.2; y += step) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k];
      const [bx, bz] = corners[(k + 1) % 4];
      f.p(x + ax, y, z + az, A);
      f.p(x + bx, y + step * 0.9, z + bz, B);
      beam(b, A, B, tube * 0.5, tube * 0.5);
    }
  }
}

/** horizontal box truss along local x from x0 to x1, bottom y0, height h, depth d (z −d/2..d/2) */
function truss(b: GeoBuilder, f: Frame3, x0: number, x1: number, y0: number, h: number, d: number, tube = 0.13) {
  const L = x1 - x0;
  const cx = (x0 + x1) / 2;
  for (const y of [y0, y0 + h]) for (const z of [-d / 2, d / 2]) box(b, f, cx, y, z, L, tube, tube, 0b111111);
  const n = Math.max(2, Math.round(L / 1.5));
  for (let k = 0; k <= n; k++) {
    const x = x0 + (L * k) / n;
    for (const z of [-d / 2, d / 2]) box(b, f, x, y0 + h / 2, z, tube * 0.6, h, tube * 0.6, 0b110011);
    box(b, f, x, y0 + h, 0, tube * 0.6, tube * 0.6, d, 0b111100);
    if (k < n) {
      const xn = x0 + (L * (k + 1)) / n;
      for (const z of [-d / 2, d / 2]) {
        f.p(x, k % 2 ? y0 : y0 + h, z, A);
        f.p(xn, k % 2 ? y0 + h : y0, z, B);
        beam(b, A, B, tube * 0.45, tube * 0.45);
      }
    }
  }
}

export interface PanelSpot {
  /** world position of the panel face centre */
  pos: THREE.Vector3;
  /** unit normal the panel faces (toward oncoming cars) */
  normal: THREE.Vector3;
  /** unit horizontal right vector of the panel face */
  right: THREE.Vector3;
}

export interface StructuresOut {
  panels: PanelSpot[];
}

/**
 * Per-circuit placement: sponsor footbridges (s), corners with a TV camera platform, corners
 * with a big billboard at the end of the run-off (name, sponsor salt).
 */
interface VenueProps {
  bridges: number[];
  cameras: string[];
  billboards: [string, number][];
}
const VENUE_PROPS: Record<string, VenueProps> = {
  // the main straight past the pit exit, and the back straight toward the Parabolica
  monza: {
    bridges: [1048, 4700],
    cameras: ['Turn 1', 'Curva Grande', 'Roggia', 'Lesmo 2', 'Ascari', 'Parabolica'],
    billboards: [['Turn 1', 0], ['Roggia', 4], ['Ascari', 8], ['Parabolica', 12], ['Lesmo 1', 2]],
  },
  // the Kemmel straight after Raidillon, the run down to Blanchimont
  spa: {
    bridges: [2150, 6050],
    cameras: ['La Source', 'Raidillon', 'Les Combes', 'Rivage', 'Pouhon', 'Stavelot', 'Blanchimont', 'Bus Stop'],
    billboards: [['La Source', 1], ['Les Combes', 5], ['Rivage', 9], ['Bus Stop', 13], ['Stavelot', 3]],
  },
  // the Wellington and Hangar straights
  silverstone: {
    bridges: [1800, 4850],
    cameras: ['Abbey', 'Village', 'Brooklands', 'Luffield', 'Copse', 'Becketts', 'Stowe', 'Club'],
    billboards: [['Village', 2], ['Brooklands', 6], ['Stowe', 10], ['Copse', 14], ['Club', 4]],
  },
  // the end of the main straight before Turn 1, the run from Spoon to the crossover
  suzuka: {
    bridges: [905, 4560],
    cameras: ['Turn 1', 'S Curves', 'Dunlop', 'Degner 1', 'Hairpin', 'Spoon', '130R', 'Casio Triangle'],
    billboards: [['Turn 1', 3], ['Hairpin', 7], ['Spoon', 11], ['Casio Triangle', 1], ['Degner 1', 9]],
  },
  // COTA: the back straight (a sponsor bridge halfway down it)
  austin: {
    bridges: [3380],
    cameras: ['Turn 1', 'Turn 3', 'Turn 9', 'Turn 11', 'Turn 12', 'Turn 15', 'Turn 18', 'Turn 20'],
    billboards: [['Turn 1', 2], ['Turn 11', 6], ['Turn 12', 10], ['Turn 15', 14], ['Turn 19', 4]],
  },
  // the climb from the Niki Lauda Kurve to Remus, the run along the top to Schlossgold
  spielberg: {
    bridges: [1330, 2330],
    cameras: ['Niki Lauda', 'Remus', 'Schlossgold', 'Rauch', 'Würth', 'Jochen Rindt', 'Red Bull Mobile'],
    billboards: [['Niki Lauda', 2], ['Remus', 6], ['Schlossgold', 10], ['Red Bull Mobile', 14], ['Rauch', 4]],
  },
  // Zandvoort: the footbridge over the climb out of the Hugenholtz, another over the back straight
  zandvoort: {
    bridges: [1690, 3480],
    cameras: ['Tarzanbocht', 'Hugenholtzbocht', 'Rob Slotemakerbocht', 'Scheivlak', 'Mastersbocht', 'Hans Ernstbocht', 'Kumhobocht', 'Arie Luyendijkbocht'],
    billboards: [['Tarzanbocht', 2], ['Hugenholtzbocht', 6], ['Mastersbocht', 10], ['Hans Ernstbocht', 14], ['Kumhobocht', 4]],
  },
  // Interlagos: the footbridge over the Reta Oposta, another over the climb of the Subida dos Boxes
  interlagos: {
    bridges: [2240, 440],
    cameras: ['S do Senna', 'Curva do Sol', 'Descida do Lago', 'Ferradura', 'Laranjinha', 'Bico de Pato', 'Mergulho', 'Junção'],
    billboards: [['S do Senna', 2], ['Descida do Lago', 6], ['Bico de Pato', 10], ['Junção', 14], ['Ferradura', 4]],
  },
  // Montréal: the footbridges over the Casino straight and the back leg of the island
  montreal: {
    bridges: [3760, 2380],
    cameras: ['Turn 1', 'Virage Senna', 'Turn 3', 'Turn 6', 'Turn 8', "L'Épingle", 'Turn 13'],
    billboards: [['Turn 1', 3], ["L'Épingle", 7], ['Turn 13', 11], ['Turn 8', 1], ['Turn 3', 9]],
  },
};

export function buildStructures(ctx: Ctx, atlas: PrintAtlas): StructuresOut {
  const out: StructuresOut = { panels: [] };
  const vp = VENUE_PROPS[ctx.track.def.id] ?? { bridges: [], cameras: [], billboards: [] };
  buildGantry(ctx, atlas);
  // sponsor footbridges
  vp.bridges.forEach((s, k) => buildBridge(ctx, atlas, s, k));
  buildMarshalPosts(ctx, atlas, out);
  buildCameras(ctx, vp.cameras);
  buildBoards(ctx, atlas);
  buildBillboards(ctx, atlas, vp.billboards);
  buildSausages(ctx);
  return out;
}

// ------------------------------------------------------------------ start gantry

function buildGantry(ctx: Ctx, atlas: PrintAtlas) {
  const t = ctx.track;
  const s = t.startS + 6;
  const cs = ctx.cs;
  const props = cs.get(s, 'props');
  const print = cs.get(s, 'print');
  const lamps = cs.get(s, 'lamp');
  const i = ctx.wrap(Math.floor(s));
  const pit = t.pit;
  const Lp = ctx.side(-pit.side);
  // leg positions (local x = right of travel): outside the grandstand wall, and inside the pit wall
  const farX = -pit.side * (Lp.bar[i] + Lp.backOff[i] + 1.4);
  const wallX = pit.side * (pit.wallOffset + 0.32);
  const x0 = Math.min(farX, wallX), x1 = Math.max(farX, wallX);
  frameAt(ctx, s, 0);
  const ground = (x: number) => t.point(s, x, 0, A).y - F.o.y;
  const TOP = 8.6, BOT = 7.2;

  props.color(0x1d1f23).mat(0.45, 0.75, 0);
  latticeColumn(props, F, farX, 0, 0.9, ground(farX), TOP + 0.1, 0.13);
  latticeColumn(props, F, wallX, 0, 0.45, ground(wallX), TOP + 0.1, 0.1);
  props.color(0x6d6f72).mat(0.8, 0.2, 0);
  box(props, F, farX, ground(farX) + 0.15, 0, 1.3, 0.3, 1.3);
  props.color(0x1d1f23).mat(0.45, 0.75, 0);
  truss(props, F, x0 - 0.3, x1 + 0.3, BOT, TOP - BOT, 1.0, 0.14);

  // sponsor banner across the truss, both faces
  const cell = atlas.cell('gantry');
  print.rgb(1, 1, 1).mat(0.5, 0, 0.35);
  const w = 4.8;
  const nb = Math.floor((x1 - x0 - 0.8) / w);
  const bx0 = (x0 + x1) / 2 - (nb * w) / 2;
  for (let k = 0; k < nb; k++) {
    const x = bx0 + k * w;
    const c = k % 2 === 0 ? cell : atlas.cell('ad' + [6, 0, 14, 10, 2][((k - 1) / 2) % 5]);
    printQuadZ(print, F, -0.56, x, x + w, BOT + 0.02, TOP - 0.02, -1, c);
    printQuadZ(print, F, 0.56, x, x + w, BOT + 0.02, TOP - 0.02, 1, c);
  }
  // timing screen above the centre
  props.color(0x15171a).mat(0.5, 0.5, 0);
  box(props, F, 0, TOP + 1.25, 0.12, 7.6, 2.1, 0.3, 0b111111);
  for (const x of [-3.2, 3.2]) box(props, F, x, TOP + 0.1, 0.12, 0.15, 0.4, 0.15);
  print.rgb(1, 1, 1).mat(0.3, 0, 1.6);
  printQuadZ(print, F, -0.04, -3.6, 3.6, TOP + 0.3, TOP + 2.2, -1, atlas.cell('screen'));
  print.mat(0.5, 0, 0.3);
  printQuadZ(print, F, 0.28, -3.6, 3.6, TOP + 0.3, TOP + 2.2, 1, atlas.cell('gantry'));

  // five light columns hanging under the truss, facing the grid (−z)
  const cols = [-2.4, -1.2, 0, 1.2, 2.4];
  cols.forEach((cx, c) => {
    props.color(0x0b0b0c).mat(0.4, 0.3, 0);
    box(props, F, cx, BOT - 1.05, -0.35, 0.62, 2.0, 0.34, 0b111111);
    box(props, F, cx, BOT - 0.02, -0.35, 0.12, 0.08, 0.12);
    for (let r = 0; r < 4; r++) {
      const y = BOT - 0.35 - r * 0.45;
      props.color(0x050505).mat(0.5, 0.2, 0);
      box(props, F, cx, y + 0.2, -0.62, 0.42, 0.03, 0.22, 0b111111);
      // lamp: the top two are the red pair driven by StartLights; the rest stay dark
      lamps.s0[0] = r < 2 ? c : 9;
      disc(lamps, F, cx, y, -0.525, 0.15, 14, -1);
    }
  });
  // repeater column on the far leg, facing the back of the grid
  props.color(0x0b0b0c).mat(0.4, 0.3, 0);
  box(props, F, farX + pit.side * 0.9, 4.2, -0.2, 0.5, 1.6, 0.3, 0b111111);
  cols.forEach((_, c) => {
    lamps.s0[0] = c;
    disc(lamps, F, farX + pit.side * 0.9, 4.85 - c * 0.3, -0.36, 0.1, 10, -1);
  });
}

// ------------------------------------------------------------------ sponsor footbridges

function buildBridge(ctx: Ctx, atlas: PrintAtlas, s: number, salt: number) {
  const t = ctx.track;
  const i = ctx.wrap(Math.floor(s));
  const props = ctx.cs.get(s, 'props');
  const print = ctx.cs.get(s, 'print');
  const L = ctx.L, R = ctx.R;
  const reach = (P: typeof L) => (P.kind[i] === 'none' ? Math.max(P.bar[i], t.pit.garageOffset + 1.5) : P.bar[i] + P.backOff[i]) + 2.2;
  const xl = -reach(L);
  const xr = reach(R);
  frameAt(ctx, s, 0);
  const ground = (x: number) => t.point(s, x, 0, A).y - F.o.y;
  const Y0 = 6.4, H = 1.6, D = 2.6;

  // stair towers: a concrete core with a steel stair cage
  for (const x of [xl, xr]) {
    const g = ground(x);
    const away = Math.sign(x);
    const tx = x + away * 1.6;
    props.color(0xbdbab2).mat(0.85, 0, 0);
    box(props, F, tx, (g + Y0 + H) / 2, 0, 3.2, Y0 + H - g, 3.0, 0b110111);
    props.color(0x2b2e33).mat(0.5, 0.6, 0);
    box(props, F, tx, Y0 + H + 0.12, 0, 3.5, 0.24, 3.3, 0b111111);
    // stair flights on the outer face
    props.color(0x55595e).mat(0.5, 0.6, 0);
    for (let k = 0; k < 3; k++) {
      const y0 = g + k * ((Y0 - g) / 3), y1 = g + (k + 1) * ((Y0 - g) / 3);
      const zA = k % 2 ? 1.7 : -1.7, zB = -zA;
      F.p(tx + away * 1.75, y0 + 0.1, zA, A);
      F.p(tx + away * 1.75, y1, zB, B);
      beam(props, A, B, 0.9, 0.12);
    }
    // printed panels on the tower faces
    print.rgb(1, 1, 1).mat(0.55, 0, 0.1);
    const c = atlas.cell('ad' + ((salt * 7 + (x < 0 ? 3 : 11)) % SPONSORS.length));
    printQuadZ(print, F, -1.52, tx - 1.55, tx + 1.55, Y0 - 1.2, Y0 - 0.43, -1, c);
    printQuadZ(print, F, 1.52, tx - 1.55, tx + 1.55, Y0 - 1.2, Y0 - 0.43, 1, c);
  }
  // deck: a box girder with glazed sides
  props.color(0x2b2e33).mat(0.55, 0.4, 0);
  box(props, F, (xl + xr) / 2, Y0 + 0.12, 0, xr - xl + 0.6, 0.24, D, 0b111111);
  box(props, F, (xl + xr) / 2, Y0 + H + 0.9, 0, xr - xl + 0.6, 0.18, D + 0.4, 0b111111);
  props.color(0x9fb6c4).mat(0.08, 0.2, 0);
  for (const z of [-D / 2 + 0.06, D / 2 - 0.06]) box(props, F, (xl + xr) / 2, Y0 + H + 0.35, z, xr - xl, 0.7, 0.03, 0b110011);
  props.color(0xd8d8d6).mat(0.4, 0.7, 0);
  for (let x = xl; x <= xr; x += 3) for (const z of [-D / 2, D / 2]) box(props, F, x, Y0 + H * 0.5 + 0.45, z, 0.1, H + 0.9, 0.1, 0b110011);
  // printed faces
  const w = 5.6;
  const count = Math.floor((xr - xl - 0.8) / w);
  const start = (xl + xr) / 2 - (count * w) / 2;
  print.rgb(1, 1, 1).mat(0.55, 0, 0.25);
  for (let k = 0; k < count; k++) {
    const cellA = atlas.cell('ad' + ((k + salt * 5) % SPONSORS.length));
    const cellB = atlas.cell('ad' + ((k * 7 + 3 + salt * 3) % SPONSORS.length));
    printQuadZ(print, F, -D / 2 - 0.03, start + k * w + 0.05, start + (k + 1) * w - 0.05, Y0 + 0.25, Y0 + H - 0.05, -1, cellA);
    printQuadZ(print, F, D / 2 + 0.03, start + k * w + 0.05, start + (k + 1) * w - 0.05, Y0 + 0.25, Y0 + H - 0.05, 1, cellB);
  }
}

// ------------------------------------------------------------------ marshals

const ORANGE = 0xe8561a;
const SKIN = [0xc58d6b, 0xa8744f, 0xe0b090, 0x7a5236];

/** a standing marshal in orange overalls; `f` origin at the feet, facing local −z → rotated by yaw */
function marshal(b: GeoBuilder, base: Frame3, x: number, z: number, yaw: number, rng: Rng) {
  G.copy(base);
  G.o.copy(base.p(x, 0, z, A));
  G.yaw(yaw);
  const s = rng.range(0.92, 1.06);
  const armUp = rng.next() < 0.25;
  // boots, legs
  b.color(0x151515).mat(0.7, 0, 0);
  for (const lx of [-0.1, 0.1]) box(b, G, lx * s, 0.05 * s, 0.03, 0.13 * s, 0.1 * s, 0.26 * s);
  b.color(ORANGE).mat(0.78, 0, 0);
  for (const lx of [-0.1, 0.1]) box(b, G, lx * s, 0.5 * s, 0, 0.15 * s, 0.82 * s, 0.17 * s, 0b110111);
  // torso with reflective bands
  box(b, G, 0, 1.2 * s, 0, 0.44 * s, 0.62 * s, 0.26 * s, 0b111111);
  b.color(0xd8d8d0).mat(0.3, 0.2, 0.05);
  box(b, G, 0, 1.08 * s, 0, 0.45 * s, 0.05 * s, 0.27 * s, 0b110011);
  box(b, G, 0, 0.62 * s, 0, 0.36 * s, 0.05 * s, 0.19 * s, 0b110011);
  // arms
  b.color(ORANGE).mat(0.78, 0, 0);
  box(b, G, -0.28 * s, 1.18 * s, 0, 0.11 * s, 0.58 * s, 0.13 * s, 0b111111);
  if (armUp) {
    box(b, G, 0.28 * s, 1.55 * s, -0.05, 0.11 * s, 0.58 * s, 0.13 * s, 0b111111);
  } else {
    box(b, G, 0.28 * s, 1.18 * s, 0, 0.11 * s, 0.58 * s, 0.13 * s, 0b111111);
  }
  // head + cap
  b.color(SKIN[rng.int(SKIN.length)]).mat(0.7, 0, 0);
  box(b, G, 0, 1.62 * s, 0, 0.19 * s, 0.22 * s, 0.21 * s, 0b111111);
  b.color(rng.next() < 0.5 ? ORANGE : 0xf2f2f2).mat(0.6, 0, 0);
  box(b, G, 0, 1.76 * s, -0.03, 0.21 * s, 0.07 * s, 0.26 * s, 0b111111);
  // a furled flag in some hands
  if (!armUp && rng.next() < 0.5) {
    b.color(0x3a3a3a).mat(0.5, 0.3, 0);
    G.p(0.3 * s, 0.9 * s, -0.08, A);
    G.p(0.3 * s, 1.75 * s, -0.12, B);
    beam(b, A, B, 0.025, 0.025);
    b.color(rng.next() < 0.5 ? 0xf2d000 : 0x1f5fd0).mat(0.8, 0, 0);
    box(b, G, 0.3 * s, 1.5 * s, -0.12, 0.07, 0.42 * s, 0.07, 0b111111);
  }
}

function buildMarshalPosts(ctx: Ctx, atlas: PrintAtlas, out: StructuresOut) {
  const t = ctx.track;
  const rng = new Rng(314);
  for (const post of ctx.posts) {
    const { s, side } = post;
    const P = ctx.side(side);
    const i = ctx.wrap(s);
    const off = P.bar[i] + P.backOff[i] + 2.3;
    const props = ctx.cs.get(s, 'props');
    const print = ctx.cs.get(s, 'print');
    frameAt(ctx, s, side * off);
    const X = (v: number) => -side * v; // v > 0 → toward the track
    // slab (reaching down so it sits on terrain that may be lower than the run-off)
    props.color(0x9a9892).mat(0.9, 0, 0);
    box(props, F, 0, -0.62, 0, 2.6, 1.56, 4.2, 0b111111);
    // shelter: open-fronted cabin with an orange roof
    props.color(0xe9e7e1).mat(0.6, 0, 0);
    box(props, F, X(-0.75), 1.2, 0, 0.12, 2.4, 3.2);
    box(props, F, X(-0.1), 1.2, -1.55, 1.4, 2.4, 0.1);
    box(props, F, X(-0.1), 1.2, 1.55, 1.4, 2.4, 0.1);
    props.color(0xe8641c).mat(0.6, 0.1, 0);
    box(props, F, X(-0.05), 2.45, 0, 2.0, 0.12, 3.6, 0b111111);
    props.color(0x2d2f33).mat(0.5, 0.6, 0);
    for (const z of [-1.7, 1.7]) box(props, F, X(0.85), 1.2, z, 0.08, 2.4, 0.08);
    // bench + fire extinguisher + broom
    props.color(0x55595e).mat(0.6, 0.4, 0);
    box(props, F, X(-0.5), 0.45, 0.2, 0.4, 0.06, 1.8, 0b111111);
    props.color(0xc41010).mat(0.4, 0.1, 0);
    cylinder(props, F, X(-0.55), 0, -1.3, 0.09, 0.6, 8);
    // post number plate on the roof edge, facing the track
    const num = post.num;
    if (num <= 24) {
      const c = Math.floor((num - 1) / 8), k = (num - 1) % 8;
      const uv = atlas.sub('posts' + c, k / 8 + 0.004, (k + 1) / 8 - 0.004, 0.02, 0.98);
      print.rgb(1, 1, 1).mat(0.5, 0, 0.12);
      printQuadX(print, F, X(0.98), -0.3, 0.3, 2.62, 3.82, -side, uv);
      props.color(0x2d2f33).mat(0.5, 0.6, 0);
      box(props, F, X(1.0), 3.2, 0, 0.04, 1.26, 0.66, 0b111111);
    }
    // marshals: two or three, one at the fence watching
    const count = 2 + (rng.next() < 0.5 ? 1 : 0);
    for (let m = 0; m < count; m++) {
      const mx = m === 0 ? X(0.95) : X(0.1 + rng.next() * 0.5);
      const mz = m === 0 ? rng.range(-0.8, 0.8) : rng.range(-1.2, 1.2);
      // face the track (local −x·side … rotate so −z points toward the track)
      marshal(props, F, mx, mz, (side > 0 ? -Math.PI / 2 : Math.PI / 2) + rng.range(-0.6, 0.6), rng);
    }

    // LED flag panel on a pole at the barrier, facing oncoming cars
    const sp = s + 2;
    const k2 = ctx.wrap(sp);
    const pole = P.backOff[k2] + 0.4;
    frameAt(ctx, sp, side * (P.bar[k2] + pole));
    props.color(0x2d2f33).mat(0.5, 0.6, 0);
    box(props, F, 0, 1.55, 0, 0.1, 3.1, 0.1);
    props.color(0x111214).mat(0.5, 0.2, 0);
    box(props, F, X(0.3), 3.0, 0.0, 1.1, 0.8, 0.14, 0b111111);
    // the lit face itself is an instanced LED panel (see TrackMesh), 1 cm in front of the housing
    const pos = F.p(X(0.3), 3.0, -0.075, new THREE.Vector3());
    const normal = F.d(0, 0, -1, new THREE.Vector3()).normalize();
    const right = F.d(1, 0, 0, new THREE.Vector3()).normalize();
    out.panels.push({ pos, normal, right });
    void t;
  }
}

// ------------------------------------------------------------------ TV camera platforms

function buildCameras(ctx: Ctx, names: string[]) {
  for (const c of ctx.track.corners) {
    if (!names.includes(c.name)) continue;
    const side = c.dir as -1 | 1;
    const s = c.sApex + 8;
    const i = ctx.wrap(s);
    const P = ctx.side(side);
    if (P.kind[i] === 'none') continue;
    const off = P.bar[i] + P.backOff[i] + 2.1;
    const props = ctx.cs.get(s, 'props');
    frameAt(ctx, s, side * off);
    const H = 3.6;
    props.color(0x9ea3a8).mat(0.45, 0.8, 0);
    for (const x of [-0.75, 0.75]) for (const z of [-0.75, 0.75]) box(props, F, x, (H + 1.1 - 1.5) / 2, z, 0.06, H + 1.1 + 1.5, 0.06, 0b110011);
    for (let y = 0.9; y < H; y += 0.9) {
      box(props, F, 0, y, -0.75, 1.5, 0.05, 0.05, 0b111111);
      box(props, F, 0, y, 0.75, 1.5, 0.05, 0.05, 0b111111);
      box(props, F, -0.75, y, 0, 0.05, 0.05, 1.5, 0b111111);
      box(props, F, 0.75, y, 0, 0.05, 0.05, 1.5, 0b111111);
    }
    props.color(0x6b5a44).mat(0.85, 0, 0);
    box(props, F, 0, H, 0, 1.7, 0.08, 1.7, 0b111111);
    props.color(0xd6d8da).mat(0.4, 0.7, 0);
    box(props, F, 0, H + 1.05, -0.8, 1.6, 0.05, 0.05, 0b111111);
    box(props, F, 0, H + 1.05, 0.8, 1.6, 0.05, 0.05, 0b111111);
    box(props, F, -0.8, H + 1.05, 0, 0.05, 0.05, 1.6, 0b111111);
    box(props, F, 0.8, H + 1.05, 0, 0.05, 0.05, 1.6, 0b111111);
    const X = (v: number) => -side * v;
    props.color(0x1b1c1e).mat(0.5, 0.3, 0);
    box(props, F, X(0.1), H + 0.75, 0, 0.08, 1.4, 0.08);
    box(props, F, X(0.15), H + 1.55, 0, 0.55, 0.32, 0.26, 0b111111);
    const lensF = new Frame3().copy(F);
    F.p(X(0.15), H + 1.55, 0, lensF.o);
    lensF.y.copy(F.x).multiplyScalar(-side);
    lensF.x.copy(F.y);
    cylinder(props, lensF, 0, 0.25, 0, 0.09, 0.62, 10);
    // operator in a rain jacket
    props.color(0x20252c).mat(0.6, 0, 0);
    box(props, F, X(-0.45), H + 0.8, 0, 0.35, 0.75, 0.45);
    props.color(0xc58d6b).mat(0.7, 0, 0);
    box(props, F, X(-0.45), H + 1.35, 0, 0.22, 0.26, 0.22, 0b111111);
    // umbrella
    props.color(0x1d4f9c).mat(0.7, 0, 0);
    box(props, F, 0, H + 2.4, 0, 1.9, 0.05, 1.9, 0b111111);
    box(props, F, 0, H + 1.8, 0.7, 0.04, 1.3, 0.04);
  }
}

// ------------------------------------------------------------------ braking boards, DRS and sector boards

function buildBoards(ctx: Ctx, atlas: PrintAtlas) {
  const t = ctx.track;
  const board = (s: number, side: number, uv: { u0: number; u1: number; v0: number; v1: number }, size: number, yBase: number) => {
    const i = ctx.wrap(Math.floor(s));
    const P = ctx.side(side);
    if (P.kind[i] === 'none') return;
    // stand the board just in front of the barrier where there's room, else behind it
    const room = P.bar[i] - (t.halfWidth[i] + P.kerb[i] + VERGE);
    const x = room > 3 ? P.bar[i] - 0.9 : P.bar[i] + P.backOff[i] + 0.32;
    const props = ctx.cs.get(s, 'props');
    const print = ctx.cs.get(s, 'print');
    frameAt(ctx, s, side * x);
    F.yaw(side * 0.22); // turn the face a little toward the track
    props.color(0x8d9196).mat(0.4, 0.8, 0);
    for (const px of [-size * 0.35, size * 0.35]) box(props, F, px, (yBase + 0.1) / 2, 0.06, 0.07, yBase + 0.1, 0.07);
    props.color(0x202020).mat(0.6, 0.2, 0);
    box(props, F, 0, yBase + size / 2, 0.035, size + 0.04, size + 0.04, 0.04, 0b111111);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.15);
    printQuadZ(print, F, 0, -size / 2, size / 2, yBase, yBase + size, -1, uv);
  };
  // braking boards: CornerDef.boards, else every slow corner at the end of a straight (see context.ts resolveStyles)
  for (const c of t.corners) {
    const sty = styleOf(c.name);
    if (!sty.boards) continue;
    const ref = c.sStart;
    const side = c.dir; // outside of the corner = the side you brake on
    [[150, 0], [100, 1], [50, 2]].forEach(([d, k]) => board(ref - d, side, atlas.sub('boards', k * 0.25, k * 0.25 + 0.25, 0, 1), 1.2, 0.95));
  }
  const drsSide = -t.pit.side;
  for (const z of t.drs) {
    board(z.detect - 2, drsSide, atlas.sub('signs', 0.25, 0.5, 0, 1), 1.2, 1.9);
    board(z.start - 2, drsSide, atlas.sub('signs', 0, 0.25, 0, 1), 1.2, 1.9);
  }
  t.sectorS.forEach((s, k) => board(s - 1, drsSide, atlas.sub('signs2', (k + 1) * 0.25, (k + 2) * 0.25, 0, 1), 1.0, 2.1));
  board(t.startS - 1, drsSide, atlas.sub('signs2', 0, 0.25, 0, 1), 1.0, 2.1);
}

// ------------------------------------------------------------------ big corner billboards

function buildBillboards(ctx: Ctx, atlas: PrintAtlas, spots: [string, number][]) {
  const t = ctx.track;
  for (const [name, salt] of spots) {
    const c = ctx.corner(name);
    if (!c) continue;
    const side = c.dir;
    const P = ctx.side(side);
    // at the end of the run-off, facing the braking zone
    const s = c.sStart - 10;
    const i = ctx.wrap(s);
    if (P.kind[i] === 'none') continue;
    const off = P.bar[i] + P.backOff[i] + 3.2;
    if (ctx.clear[i] < off + 8) continue;
    const props = ctx.cs.get(s, 'props');
    const print = ctx.cs.get(s, 'print');
    frameAt(ctx, s, side * off);
    F.yaw(side * 0.5);
    const W = 12, H = 3, Y = 2.4;
    props.color(0x3a3d42).mat(0.5, 0.6, 0);
    for (const x of [-W * 0.35, 0, W * 0.35]) box(props, F, x, Y / 2 + H / 2, 0.25, 0.18, Y + H, 0.18);
    box(props, F, 0, Y + H / 2, 0.12, W + 0.2, H + 0.2, 0.12, 0b111111);
    print.rgb(1, 1, 1).mat(0.55, 0, 0.2);
    printQuadZ(print, F, 0.04, -W / 2, W / 2, Y, Y + H, -1, atlas.cell('ad' + ((salt + 5) % SPONSORS.length)));
  }
}

// ------------------------------------------------------------------ sausage kerbs

function buildSausages(ctx: Ctx) {
  const t = ctx.track;
  for (const c of t.corners) {
    if (!styleOf(c.name).chicane) continue;
    const inside = -c.dir;
    const P = ctx.side(inside);
    for (const ds of [-5.5, -2.9, -0.3, 2.3, 4.9]) {
      const s0 = c.sApex + ds;
      const i = ctx.wrap(Math.floor(s0));
      if (P.kerb[i] <= 0) continue;
      const lat = inside * (t.halfWidth[i] + P.kerb[i] + 0.35);
      const props = ctx.cs.get(s0, 'props');
      // half-round yellow profile swept along 2.2 m of track with tapered, black-striped ends
      const N = 8;
      const segs = 10;
      const len = 2.2;
      const base = props.count;
      for (let r = 0; r <= segs; r++) {
        const f = r / segs;
        const s = s0 + f * len;
        const taper = Math.min(1, f / 0.18, (1 - f) / 0.18);
        const fr = t.frame(s);
        const endBand = f < 0.12 || f > 0.88;
        props.color(endBand ? 0x151515 : 0xf2c200).mat(0.5, 0, 0);
        for (let k = 0; k <= N; k++) {
          const a = (k / N) * Math.PI;
          const lx = Math.cos(a) * 0.17;
          const ly = Math.sin(a) * 0.11 * Math.sqrt(Math.max(0, taper));
          const p = t.point(s, lat + lx, ly, A);
          const nx = fr.right.x * Math.cos(a) + fr.up.x * Math.sin(a);
          const ny = fr.right.y * Math.cos(a) + fr.up.y * Math.sin(a);
          const nz = fr.right.z * Math.cos(a) + fr.up.z * Math.sin(a);
          props.v(p.x, p.y, p.z, nx, ny, nz);
        }
      }
      const up = t.frame(s0).up;
      for (let r = 0; r < segs; r++)
        for (let k = 0; k < N; k++) {
          const a = base + r * (N + 1) + k;
          props.quadN(a, a + 1, a + N + 2, a + N + 1, up.x, up.y, up.z);
        }
    }
  }
}
