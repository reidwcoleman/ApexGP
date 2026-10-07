import * as THREE from 'three';
import { MeshBuilder, srgb } from '../geom.ts';
import { ARCH, appendInto, archMaterial, member, tagAxis, tagClass } from '../archMaterial.ts';
import { BRAND_FONTS, brandAt, drawBrand, printWear, type Brand } from '../../brands.ts';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, SpectatorBank } from '../layout.ts';
import { GlassGeo } from '../../pitlane/building.ts';
import { glassMaterial } from '../../pitlane/materials.ts';

/**
 * The trackside dressing that makes Monza, Spa, Silverstone, Suzuka and the Hungaroring read as
 * themselves on the broadcast, beyond what every circuit shares (trackside/structures.ts): each
 * venue's own footbridges at their real places, a single title sponsor across each face the way
 * the real ones are sold, the LED boards along the main straight, the landmark buildings beside
 * the track. Built with the scenery (the venue files call these helpers), planned with the layout
 * (`planBridge` and friends reserve the ground so no tree or stand grows into them).
 *
 *   BannerAtlas   the venue's own printed banners: fictional brands (brands.ts lockups, or a big
 *                 bridge word mark in a sponsor's colour block), weathered like printed vinyl
 *   Dress         the builders: structure (archMaterial, casts shadows), slender steel (no shadow),
 *                 prints, LED boards (self-lit), interior-mapped glazing; `finish` merges them
 *                 into a handful of meshes for the whole venue
 *   Loc           a local frame on the track: x along the lap, y up, z to the right of travel
 *
 * All brands are fictional; the colour blocks echo what the real boards look like on TV.
 */

const C = (h: number) => srgb(h);

// ---------------------------------------------------------------- brands

/**
 * The venues' title sponsors (fictional), in the colour blocks the real bridges and boards wear:
 * a green-and-gold watchmaker, a yellow freight company with a red italic word mark, a green
 * lager, a white energy board, a navy exchange, the series' own tyre supplier in yellow.
 */
export const DRESS_BRANDS: Record<string, Brand> = {
  coronelle: { name: 'CORONELLE', tag: 'GENÈVE · DEPUIS 1905', bg: '#0b5a3a', fg: '#e8cf86', accent: '#e8cf86', mark: 'none', weight: 600, track: 0.2 },
  karro: { name: 'KARRO', tag: 'EXPRESS WORLDWIDE', bg: '#ffcc00', fg: '#d40511', accent: '#d40511', mark: 'bars', weight: 900, italic: true, sx: 1.2 },
  hallstein: { name: 'HALLSTEIN', tag: 'LAGER · BREWED SINCE 1873', bg: '#0b6e3f', fg: '#ffffff', accent: '#e4002b', mark: 'dot', weight: 700, track: 0.06 },
  meridian: { name: 'MERIDIAN', tag: 'ENERGY FOR TOMORROW', bg: '#ffffff', fg: '#0a6b8a', accent: '#28a745', mark: 'wave', weight: 700, track: 0.08 },
  nexa: { name: 'nexa.coin', tag: 'THE FUTURE OF FINANCE', bg: '#0b1d33', fg: '#ffffff', accent: '#3fa9f5', mark: 'diamond', weight: 600, lower: true },
  castellan: { name: 'CASTELLAN', tag: 'PERFORMANCE TYRES', bg: '#ffd21f', fg: '#111111', accent: '#c4151c', mark: 'diamond', weight: 900, italic: true, sx: 1.12 },
  veloce: { name: 'VELOCE', tag: 'BANCA · ASSICURAZIONI', bg: '#c8102e', fg: '#ffffff', accent: '#ffd400', mark: 'wing', weight: 900, italic: true, sx: 1.08 },
  brianza: { name: 'BRIANZA BANCA', tag: 'DAL 1896', bg: '#f4efe4', fg: '#1f3a5a', accent: '#c8102e', mark: 'shield', weight: 600, track: 0.08 },
  kosei: { name: 'KOSEI', tag: 'ELECTRONICS', bg: '#0050b5', fg: '#ffffff', accent: '#ffffff', mark: 'wing', weight: 700, italic: true },
  hayate: { name: 'HAYATE', tag: 'MOTOR COMPANY', bg: '#e60012', fg: '#ffffff', accent: '#ffffff', mark: 'wing', weight: 900, italic: true, sx: 1.1 },
  valdor: { name: 'VALDOR', tag: 'EAU MINÉRALE DES ARDENNES', bg: '#e9f3fb', fg: '#c8102e', accent: '#0a4c8c', mark: 'ring', weight: 700, track: 0.1 },
  tisza: { name: 'TISZA BANK', tag: 'MAGYAR · SINCE 1912', bg: '#00205b', fg: '#ffffff', accent: '#ce2939', mark: 'shield', weight: 700, track: 0.05 },
};

/** a registry brand (brands.ts) by name, else the first */
export const brandNamed = (name: string): Brand => {
  for (let k = 0; k < 18; k++) if (brandAt(k).name === name) return brandAt(k);
  return brandAt(0);
};

// ---------------------------------------------------------------- banner atlas

export type BannerDraw = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
/** cell shapes: an 8:1 band (bridges, LED boards, fascias), a 4:1 board, a 2:1 panel */
export type CellShape = 'band' | 'board' | 'panel';
const SHAPE: Record<CellShape, [number, number]> = { band: [1024, 128], board: [512, 128], panel: [512, 256] };
const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';

/** a brand's lockup at the cell's own proportions, then weathered like printed vinyl */
export const brandCell = (b: Brand, invert = false, seed = 7, wear = 0.8): BannerDraw => (g, x, y, w, h) => {
  drawBrand(g, x, y, w, h, b, invert);
  printWear(g, x, y, w, h, seed, wear);
};

/**
 * A bridge's word mark: one big name filling the band in the sponsor's colour block, as the title
 * sponsor's bridges are printed (no tagline; the odd rule above and below in the accent colour).
 */
export const wordCell = (o: { text: string; bg: string; fg: string; accent?: string; italic?: boolean; weight?: number; sx?: number; track?: number; rules?: boolean; seed?: number }): BannerDraw => (g, x, y, w, h) => {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = o.bg;
  g.fillRect(x, y, w, h);
  if (o.rules && o.accent) {
    g.fillStyle = o.accent;
    g.fillRect(x, y + h * 0.06, w, h * 0.07);
    g.fillRect(x, y + h * 0.87, w, h * 0.07);
  }
  const style = `${o.italic ? 'italic ' : ''}${o.weight ?? 900}`;
  const sx = o.sx ?? 1;
  let size = h * 0.66;
  const set = () => {
    g.font = `${style} ${Math.round(size)}px ${FONT}`;
    const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
    if ('letterSpacing' in c) c.letterSpacing = `${(size * (o.track ?? 0)).toFixed(1)}px`;
  };
  set();
  while (size > 14 && g.measureText(o.text).width * sx > w * 0.9) {
    size *= 0.94;
    set();
  }
  g.fillStyle = o.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.translate(x + w / 2, y + h / 2 + size * 0.05);
  g.scale(sx, 1);
  g.fillText(o.text, 0, 0);
  g.restore();
  printWear(g, x, y, w, h, o.seed ?? 3, 0.7);
};

/** an LED board's frame: the image a little soft and gridded by its pixel pitch, a black bezel */
export const ledCell = (inner: BannerDraw): BannerDraw => (g, x, y, w, h) => {
  inner(g, x, y, w, h);
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let px = x; px < x + w; px += 4) g.fillRect(px, y, 1, h);
  for (let py = y; py < y + h; py += 4) g.fillRect(x, py, w, 1);
  g.fillStyle = '#050506';
  g.fillRect(x, y, w, 3);
  g.fillRect(x, y + h - 3, w, 3);
  g.restore();
};

/**
 * The venue's printed banners on one canvas: cells packed on shelves of their own height, drawn
 * once with whatever font is ready and again once Titillium Web is in.
 */
export class BannerAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly cells = new Map<string, [number, number, number, number]>();
  private readonly list: [string, BannerDraw][] = [];

  constructor(defs: [string, CellShape, BannerDraw][]) {
    const W = 2048;
    // shelves: one run of cells per shape, each shape starting a new row
    let y = 0;
    for (const shape of ['band', 'board', 'panel'] as CellShape[]) {
      const [cw, ch] = SHAPE[shape];
      const mine = defs.filter((d) => d[1] === shape);
      mine.forEach(([name, , draw], k) => {
        const col = k % (W / cw), row = Math.floor(k / (W / cw));
        this.cells.set(name, [col * cw, y + row * ch, cw, ch]);
        this.list.push([name, draw]);
      });
      if (mine.length) y += Math.ceil(mine.length / (W / cw)) * ch;
    }
    let H = 128;
    while (H < y) H *= 2;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.draw();
    if (typeof document !== 'undefined' && document.fonts)
      Promise.all(BRAND_FONTS.map((f) => document.fonts.load(f)))
        .then(() => {
          this.draw();
          this.texture.needsUpdate = true;
        })
        .catch(() => {});
  }

  private draw() {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#808080';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const [name, draw] of this.list) {
      const [x, y, w, h] = this.cells.get(name)!;
      draw(g, x, y, w, h);
    }
  }

  has(name: string) {
    return this.cells.has(name);
  }

  /** uv rect [u0, v0, u1, v1] of a cell (inset a texel; the canvas's row 0 is v = 1) */
  uv(name: string): [number, number, number, number] {
    const c = this.cells.get(name);
    if (!c) throw new Error('no banner cell ' + name);
    const [x, y, w, h] = c;
    const W = this.canvas.width, H = this.canvas.height;
    return [(x + 2) / W, 1 - (y + h - 2) / H, (x + w - 2) / W, 1 - (y + 2) / H];
  }
}

// ---------------------------------------------------------------- local frames

/** local frame: origin (x, y, z), yaw `rot` (local +z → (sin rot, 0, cos rot), local +x → (cos rot, 0, −sin rot)) */
export class Loc {
  readonly m = new THREE.Matrix4();
  /** world yaw of the local x axis (archMaterial's axis convention, x → z) */
  readonly yaw: number;
  constructor(x: number, y: number, z: number, rot: number) {
    this.m.makeRotationY(rot).setPosition(x, y, z);
    this.yaw = -rot;
  }
  p(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, z).applyMatrix4(this.m);
  }
  /** a local direction in world space */
  d(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).transformDirection(this.m);
  }
}

/** yaw that puts a Loc's +x along the lap at s (and +z to the right of travel) */
export function yawAlong(track: Track, s: number): number {
  const f = track.frame(s);
  return Math.atan2(-f.tangent.z, f.tangent.x);
}

/** a Loc on the track at (s, lateral): x along the lap, z to the right; origin at height y (default: the road there) */
export function trackLoc(track: Track, s: number, lat: number, y?: number): Loc {
  const q = track.point(s, lat, 0, new THREE.Vector3());
  return new Loc(q.x, y ?? q.y, q.z, yawAlong(track, s));
}

// ---------------------------------------------------------------- builders

export class Dress {
  /** structure: casts shadows */
  readonly solid = new MeshBuilder();
  /** slender steel (rails, truss webs, hangers): drawn, no shadow, dropped far away */
  readonly fine = new MeshBuilder();
  readonly print = new MeshBuilder();
  readonly led = new MeshBuilder();
  readonly glass = new MeshBuilder();
  readonly rooms = new GlassGeo();

  readonly track: Track;
  readonly map: WorldMap;
  readonly atlas: BannerAtlas;
  constructor(track: Track, map: WorldMap, atlas: BannerAtlas) {
    this.track = track;
    this.map = map;
    this.atlas = atlas;
  }

  /** box in a Loc (min/max corners), its archMaterial class, into the solid (or fine) mesh */
  box(L: Loc, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color, cls: number = ARCH.CONCRETE, fine = false) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const lm = new MeshBuilder();
    lm.aabb(x0, y0, z0, x1, y1, z1, c);
    lm.transform(L.m);
    tagClass(lm, 0, cls);
    tagAxis(lm, 0, L.yaw);
    appendInto(fine ? this.fine : this.solid, lm);
  }

  /** a straight member between two world points (w across, t deep), slender by default */
  bar(a: THREE.Vector3, b: THREE.Vector3, w: number, c: THREE.Color, cls: number = ARCH.STEEL, fine = true, t = w) {
    const mb = fine ? this.fine : this.solid;
    const v0 = mb.vertexCount;
    member(mb, a, b, w, t, c);
    tagClass(mb, v0, cls);
  }

  /** a dark glass box (plain, mirror-ish) */
  darkGlass(L: Loc, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const lm = new MeshBuilder();
    lm.aabb(x0, y0, z0, x1, y1, z1, C(0xffffff));
    lm.transform(L.m);
    appendInto(this.glass, lm);
  }

  /**
   * printed banner on the local plane z = zc spanning x0..x1 × y0..y1, facing −z (dir −1) or +z,
   * reading left to right for whoever looks at it
   */
  bannerZ(L: Loc, x0: number, x1: number, y0: number, y1: number, zc: number, dir: 1 | -1, cell: string, led = false) {
    const a = dir < 0 ? x1 : x0, b = dir < 0 ? x0 : x1;
    (led ? this.led : this.print).quad4(L.p(a, y0, zc), L.p(b, y0, zc), L.p(b, y1, zc), L.p(a, y1, zc), C(0xffffff), this.atlas.uv(cell));
  }

  /** printed banner on the local plane x = xc spanning z0..z1 × y0..y1, facing −x (dir −1) or +x */
  bannerX(L: Loc, z0: number, z1: number, y0: number, y1: number, xc: number, dir: 1 | -1, cell: string, led = false) {
    const a = dir < 0 ? z0 : z1, b = dir < 0 ? z1 : z0;
    (led ? this.led : this.print).quad4(L.p(xc, y0, a), L.p(xc, y0, b), L.p(xc, y1, b), L.p(xc, y1, a), C(0xffffff), this.atlas.uv(cell));
  }

  /** a band of `cells` along x0..x1 (repeating; each tile kept near the cell's 8:1) on the plane z = zc */
  bandZ(L: Loc, x0: number, x1: number, y0: number, y1: number, zc: number, dir: 1 | -1, cells: string[], led = false, aspect = 8) {
    const n = Math.max(1, Math.round((x1 - x0) / ((y1 - y0) * aspect)));
    const w = (x1 - x0) / n;
    // (tiles read left to right from the viewer's side: the first cell sits at the viewer's left)
    for (let k = 0; k < n; k++) {
      const kk = dir < 0 ? n - 1 - k : k;
      this.bannerZ(L, x0 + kk * w + 0.03, x0 + (kk + 1) * w - 0.03, y0, y1, zc, dir, cells[k % cells.length], led);
    }
  }

  /** a band of `cells` along z0..z1 on the plane x = xc */
  bandX(L: Loc, z0: number, z1: number, y0: number, y1: number, xc: number, dir: 1 | -1, cells: string[], led = false, aspect = 8) {
    const n = Math.max(1, Math.round((z1 - z0) / ((y1 - y0) * aspect)));
    const w = (z1 - z0) / n;
    for (let k = 0; k < n; k++) {
      const kk = dir < 0 ? k : n - 1 - k;
      this.bannerX(L, z0 + kk * w + 0.03, z0 + (kk + 1) * w - 0.03, y0, y1, xc, dir, cells[k % cells.length], led);
    }
  }

  /** interior-mapped glazing on a local plane: corners bottom-left → top-left seen from outside */
  glaze(L: Loc, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, out: THREE.Vector3, depth: number) {
    const A = L.p(x0, y0, z0), B = L.p(x1, y0, z1), Cc = L.p(x1, y1, z1), D = L.p(x0, y1, z0);
    const o = out.clone().transformDirection(L.m);
    // (the along-facade coordinate runs the way the shader walks its rooms: up × outward normal)
    const T = new THREE.Vector3(0, 1, 0).cross(o).normalize();
    this.rooms.quad(A, B, Cc, D, o, A.dot(T), B.dot(T), A.y, Cc.y, depth);
  }

  /** ground height under a local point */
  groundAt(L: Loc, x: number, z: number): number {
    const q = L.p(x, 0, z);
    return this.map.height(q.x, q.z);
  }

  /** everything merged into a handful of meshes */
  finish(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const add = (mb: MeshBuilder, mat: THREE.Material, nm: string, cast: boolean, custom: boolean) => {
      if (mb.vertexCount === 0) return;
      const m = new THREE.Mesh(mb.geometry(custom), mat);
      m.name = nm;
      m.castShadow = cast;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    };
    const solidMat = archMaterial();
    solidMat.side = THREE.DoubleSide;
    add(this.solid, solidMat, name + '_structure', true, true);
    add(this.fine, archMaterial(true), name + '_steel', false, true);
    const tex = this.atlas.texture;
    // (prints sit a few cm proud of their girders: pulled forward in depth so they never z-fight down a long lens)
    add(this.print, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.14, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 }), name + '_banners', true, false);
    add(this.led, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 }), name + '_led', false, false);
    add(this.glass, new THREE.MeshStandardMaterial({ color: 0x1c2733, roughness: 0.08, metalness: 0.85 }), name + '_glass', false, false);
    if (this.rooms.pos.length) {
      const gm = new THREE.Mesh(this.rooms.geometry(), glassMaterial(0x2a3a44));
      gm.name = name + '_rooms';
      gm.receiveShadow = true;
      gm.matrixAutoUpdate = false;
      group.add(gm);
    }
    return group;
  }
}

// ---------------------------------------------------------------- planning

/** each world's dressing plan, made with the layout (before the trees), read by the scenery build */
const PLANS = new WeakMap<WorldMap, unknown>();
export function setDressPlan<T>(map: WorldMap, plan: T) {
  PLANS.set(map, plan);
}
export function dressPlan<T>(map: WorldMap): T | null {
  return (PLANS.get(map) as T | undefined) ?? null;
}

/** a reserved footbridge: where it crosses and how far it reaches each side (|lateral| of its legs) */
export interface BridgeSpot {
  s: number;
  /** |lateral| of the legs, left and right */
  reach: [number, number];
  /** stair tower per side (left, right): beyond the deck along the lap (+1 / −1), or none (0: the walkway runs into a stand) */
  tower: [number, number];
}

/** |lateral| of the barrier line a structure stands behind at s (the pit side's lanes count as barrier) */
export function barrierLine(track: Track, s: number, side: number): number {
  const pit = track.pit;
  const bar = track.barrierAt(s, side);
  const inPitBand = side === pit.side && track.delta(pit.sStart - 110, s) >= 0 && track.delta(s, pit.sEnd + 140) >= 0;
  return inPitBand ? Math.max(bar, pit.garageOffset + 1.5) : bar;
}

/** is (x, z) on a stand's footprint (front edge to back, + margin)? */
function onStand(gs: GrandstandSpec[], x: number, z: number, margin: number) {
  for (const g of gs) {
    const ang = Math.atan2(g.facing.x, g.facing.z);
    const dx = x - g.center.x, dz = z - g.center.z;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const u = Math.abs(dx * ca - dz * sa), v = Math.abs(dx * sa + dz * ca);
    if (u < g.length / 2 + margin && v < g.depth / 2 + margin) return true;
  }
  return false;
}

/** is (s, lateral) on one of the spectator banks (fans stand there)? */
function onBank(track: Track, banks: SpectatorBank[], s: number, lat: number) {
  for (const b of banks) {
    if (Math.sign(lat) !== b.side || track.delta(b.sA, s) < -2 || track.delta(s, b.sB) < -2) continue;
    const lo = Math.min(Math.abs(b.latA), Math.abs(b.latB)) - 1, hi = Math.max(Math.abs(b.latA), Math.abs(b.latB)) + 1;
    if (Math.abs(lat) > lo && Math.abs(lat) < hi) return true;
  }
  return false;
}

/**
 * Reserve a footbridge over the lap at s: legs `gap` m behind the barrier line each side, a stair
 * tower beside each leg (along the lap, whichever way is clear of the stands and the fans' banks;
 * none where neither is: the walkway runs on into the stand), the ground kept clear of trees.
 */
export function planBridge(track: Track, map: WorldMap, gs: GrandstandSpec[], banks: SpectatorBank[], s: number, gap = 2.4): BridgeSpot {
  const reach: [number, number] = [barrierLine(track, s, -1) + gap, barrierLine(track, s, 1) + gap];
  const tower: [number, number] = [0, 0];
  const yaw = Math.atan2(track.frame(s).tangent.x, track.frame(s).tangent.z);
  const q = new THREE.Vector3();
  [-1, 1].forEach((side, k) => {
    for (const dir of [1, -1]) {
      // the tower's footprint: 4.4 m along the lap beyond the deck, 4 m out from the leg
      let ok = true;
      for (const ds of [3, 5, 7]) for (const dl of [0.5, 2.5, 4.5]) {
        const lat = side * (reach[k] + dl);
        track.point(s + dir * ds, lat, 0, q);
        if (onStand(gs, q.x, q.z, 1) || map.trackClearance(q.x, q.z) < 1 || onBank(track, banks, s + dir * ds, lat)) ok = false;
      }
      if (!ok) continue;
      tower[k] = dir;
      break;
    }
    track.point(s + tower[k] * 4.5, side * (reach[k] + 2.2), 0, q);
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 4.5, halfL: 6.5, angle: yaw });
    map.clearings.push({ x: q.x, z: q.z, r: 9, soft: 6, keep: 0.3 });
  });
  return { s, reach, tower };
}

// ---------------------------------------------------------------- footbridges

export interface BridgeStyle {
  /** cells across the face oncoming cars see, and across the far face */
  front: string[];
  back: string[];
  /** 'box': an enclosed box-girder walkway, glazed above the banners; 'truss': open Warren girders
   *  with the banners hung on the lower half; 'arch': a pair of arches springing from the ground
   *  each side, the deck hung from them */
  kind?: 'box' | 'truss' | 'arch';
  steel?: number;
  /** the arch ribs' colour */
  arch?: number;
  /** soffit height over the road, banner depth, deck width along the lap */
  clear?: number;
  bannerH?: number;
  width?: number;
  /** cladding of the stair towers */
  tower?: number;
  /** cells on the stair towers' track faces */
  towerCells?: string[];
}

/**
 * A footbridge over the lap: legs behind the barriers, a deck at `clear` m, girders carrying the
 * title sponsor's banners on both faces, a glazed walkway (box) or open trusses, stair towers.
 */
export function footbridge(d: Dress, spot: BridgeSpot, st: BridgeStyle) {
  const t = d.track;
  const s = spot.s;
  const y0 = t.heightAt(s);
  const L = trackLoc(t, s, 0, y0);
  const zl = -spot.reach[0], zr = spot.reach[1];
  const kind = st.kind ?? 'box';
  const Y0 = st.clear ?? 6.6, BH = st.bannerH ?? 2.6, D = st.width ?? 3.4;
  const steel = C(st.steel ?? 0x2b2f35), light = C(0xd9dcdf), conc = C(0xb5b1a8);
  const top = Y0 + BH;

  // ---- legs: a pair of square columns each side, on a footing
  for (const [z, k] of [[zl, 0], [zr, 1]] as [number, number][]) {
    const g = Math.min(d.groundAt(L, -D / 2, z), d.groundAt(L, D / 2, z)) - y0;
    if (kind !== 'arch') for (const x of [-D / 2 + 0.35, D / 2 - 0.35]) d.box(L, x - 0.32, g - 0.4, z - 0.32, x + 0.32, Y0 - 0.3, z + 0.32, steel, ARCH.STEEL);
    d.box(L, -D / 2 - 0.3, g - 0.6, z - 0.9, D / 2 + 0.3, g + 0.35, z + 0.9, conc);
    // ---- stair tower: a clad core with a switchback stair inside, glazed slot, its own sponsor panel
    const dir = spot.tower[k];
    if (dir !== 0) {
      const side = k === 0 ? -1 : 1;
      const x0 = dir > 0 ? D / 2 + 0.2 : -D / 2 - 4.6, x1 = x0 + 4.4;
      const za = side < 0 ? z - 4.2 : z, zb = side < 0 ? z : z + 4.2;
      const gt = Math.min(d.groundAt(L, (x0 + x1) / 2, (za + zb) / 2), g + y0) - y0;
      d.box(L, x0, gt - 0.5, za, x1, top + 0.9, zb, C(st.tower ?? 0xc9ccce), ARCH.CLAD);
      d.box(L, x0 - 0.15, top + 0.9, za - 0.15, x1 + 0.15, top + 1.2, zb + 0.15, light, ARCH.STEEL);
      // a glazed slot up the face toward the track (the stair inside shows as shadows behind it)
      const zf = side < 0 ? zb : za - 0.04;
      d.darkGlass(L, (x0 + x1) / 2 - 0.8, gt + 0.8, zf, (x0 + x1) / 2 + 0.8, top - 0.2, zf + 0.04);
      // the tower's own 2:1 panel, toward the oncoming cars (−x)
      if (st.towerCells?.length) d.bannerX(L, za + 0.2, zb - 0.2, top - 1.9, top, x0 - 0.04, -1, st.towerCells[k % st.towerCells.length]);
    }
  }

  // ---- the span
  const za = zl - 0.4, zb = zr + 0.4;
  if (kind === 'arch') {
    // two arch ribs in the girders' planes, springing from the ground outside the legs
    const rib = C(st.arch ?? 0xf2c200);
    const span = zb - za + 6, zc = (za + zb) / 2, rise = top + 5.5;
    const N = 18;
    // (the ribs stand just proud of the banner faces, so they pass in front of the band's ends)
    const xr = D / 2 + 0.75;
    for (const sx of [-1, 1]) {
      const x = sx * xr;
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= N; i++) {
        const u = i / N, z = zc - span / 2 + span * u;
        // (a parabola over the road; the two feet go down into the ground beside the footings)
        const y = i === 0 || i === N ? d.groundAt(L, x, z) - y0 - 0.3 : Math.max(0.5, rise * (1 - (2 * u - 1) ** 2));
        const p = L.p(x, y, z);
        if (prev) d.bar(prev, p, 0.75, rib, ARCH.STEEL, false, 0.9);
        prev = p;
      }
      // hangers from the rib down to the girder's top edge, every ~3 m
      for (let z = za + 1.5; z < zb - 1; z += 3) {
        const u = (z - (zc - span / 2)) / span;
        const y = rise * (1 - (2 * u - 1) ** 2);
        if (y > top + 0.4) d.bar(L.p(x, y - 0.45, z), L.p(sx * (D / 2), top, z), 0.08, steel);
      }
    }
    // cross bracing between the ribs over the crown
    for (let z = zc - 6; z <= zc + 6.01; z += 3) {
      const u = (z - (zc - span / 2)) / span;
      const y = rise * (1 - (2 * u - 1) ** 2);
      d.bar(L.p(-xr, y, z), L.p(xr, y, z), 0.3, rib, ARCH.STEEL, false);
    }
  }
  // girders (the banners' backing), deck slab, the walkway's roof
  for (const x of [-D / 2, D / 2]) d.box(L, x - 0.18, Y0 - 0.05, za, x + 0.18, top + 0.05, zb, steel, ARCH.STEEL);
  d.box(L, -D / 2, Y0 - 0.32, za, D / 2, Y0, zb, C(0x8d9196), ARCH.STEEL);
  if (kind === 'box') {
    // glazed walkway over the girders: a dark band, slim mullions, a roof plate with a light fascia
    for (const x of [-D / 2, D / 2]) d.darkGlass(L, x - 0.06, top + 0.05, za, x + 0.06, top + 1.25, zb);
    for (let z = za; z <= zb + 0.01; z += 1.5) for (const x of [-D / 2, D / 2]) d.box(L, x - 0.09, top + 0.05, z - 0.05, x + 0.09, top + 1.25, z + 0.05, light, ARCH.STEEL, true);
    d.box(L, -D / 2 - 0.35, top + 1.25, za - 0.3, D / 2 + 0.35, top + 1.55, zb + 0.3, light, ARCH.STEEL);
  } else if (kind === 'truss') {
    // open Warren trusses above the banner band, a handrail along the top chord
    for (const x of [-D / 2, D / 2]) {
      const n = Math.max(3, Math.round((zb - za) / 2.4));
      d.box(L, x - 0.12, top + 1.4, za, x + 0.12, top + 1.62, zb, steel, ARCH.STEEL);
      for (let i = 0; i < n; i++) {
        const z0 = za + ((zb - za) * i) / n, z1 = za + ((zb - za) * (i + 1)) / n;
        d.bar(L.p(x, i % 2 ? top + 1.5 : top + 0.05, z0), L.p(x, i % 2 ? top + 0.05 : top + 1.5, z1), 0.12, steel);
      }
    }
    for (let z = za + 1.5; z < zb; z += 3) d.bar(L.p(-D / 2, top + 1.5, z), L.p(D / 2, top + 1.5, z), 0.08, steel);
  }
  // the title sponsor across both faces (front: the face oncoming cars see, toward −x), tiles near the cells' 8:1
  d.bandX(L, za + 0.1, zb - 0.1, Y0 + 0.1, top - 0.1, -D / 2 - 0.2, -1, st.front);
  d.bandX(L, za + 0.1, zb - 0.1, Y0 + 0.1, top - 0.1, D / 2 + 0.2, 1, st.back);
  // lamps under the deck
  for (let z = za + 2; z < zb - 1; z += 5) d.box(L, -0.45, Y0 - 0.4, z - 0.12, 0.45, Y0 - 0.32, z + 0.12, C(0xe8e6df), ARCH.PLAIN, true);
}

// ---------------------------------------------------------------- boards

/**
 * LED boards along a stretch of barrier (the main straights' grandstand side): self-lit panels,
 * 0.95 m tall, on posts just behind the barrier line, their tops clear of the wall; each panel
 * one cell, the cells cycling in runs as the boards are sold.
 */
export function ledRun(d: Dress, sA: number, sB: number, side: number, back: number, cells: string[], run = 3, y0 = 1.25, h = 0.95) {
  const t = d.track;
  const len = h * 8;
  const total = t.delta(sA, sB);
  const n = Math.floor(total / (len + 0.15));
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  const steel = C(0x2a2d31);
  for (let k = 0; k < n; k++) {
    const s0 = sA + k * (len + 0.15), s1 = s0 + len;
    const latA = side * (barrierLine(t, s0, side) + back), latB = side * (barrierLine(t, s1, side) + back);
    t.point(s0, latA, 0, A);
    t.point(s1, latB, 0, B);
    const ya = t.heightAt(s0), yb = t.heightAt(s1);
    A.y = ya + y0;
    B.y = yb + y0;
    const cell = cells[Math.floor(k / run) % cells.length];
    // readable from the track: the viewer's left is the lower s on the left side, the higher on the right
    const [p, q] = side < 0 ? [A, B] : [B, A];
    const P0 = p.clone(), P1 = q.clone();
    const P2 = q.clone(), P3 = p.clone();
    P2.y += h;
    P3.y += h;
    d.led.quad4(P0, P1, P2, P3, C(0xffffff), d.atlas.uv(cell));
    // the housing behind the face and two posts
    const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
    const out = new THREE.Vector3(B.z - A.z, 0, A.x - B.x).normalize().multiplyScalar(-side * 0.12);
    const Lh = new Loc(mid.x + out.x, mid.y, mid.z + out.z, Math.atan2(-(B.z - A.z), B.x - A.x));
    d.box(Lh, -len / 2, -0.02, -0.1, len / 2, h + 0.02, 0.1, C(0x101113), ARCH.PLAIN);
    for (const x of [-len * 0.3, len * 0.3]) {
      const gq = Lh.p(x, 0, 0);
      const g = d.map.height(gq.x, gq.z) - mid.y;
      d.box(Lh, x - 0.05, g - 0.2, -0.05, x + 0.05, 0, 0.05, steel, ARCH.STEEL, true);
    }
  }
}

/**
 * A freestanding billboard at (s, lateral) turned `turn` radians from square to the track (toward
 * the cars coming at it), `w` × `h` raised `lift` m on three posts; the back clad plain.
 */
export function hoarding(d: Dress, s: number, lat: number, turn: number, w: number, h: number, lift: number, cell: string) {
  const t = d.track;
  const q = t.point(s, lat, 0, new THREE.Vector3());
  const y = d.map.height(q.x, q.z);
  const side = Math.sign(lat) || 1;
  // the face's normal: toward the track, turned back toward the cars coming at it
  const f = t.frame(s);
  const n = new THREE.Vector3(-side * f.right.x * Math.cos(turn) - f.tangent.x * Math.sin(turn), 0, -side * f.right.z * Math.cos(turn) - f.tangent.z * Math.sin(turn)).normalize();
  // (local −z is the face's normal)
  const L = new Loc(q.x, y, q.z, Math.atan2(-n.x, -n.z));
  const steel = C(0x3a3d42);
  for (const x of [-w * 0.36, 0, w * 0.36]) d.box(L, x - 0.12, -0.6, 0.15, x + 0.12, lift + h, 0.39, steel, ARCH.STEEL);
  d.box(L, -w / 2 - 0.1, lift - 0.1, 0.02, w / 2 + 0.1, lift + h + 0.1, 0.14, C(0x202226), ARCH.STEEL);
  d.bannerZ(L, -w / 2, w / 2, lift, lift + h, -0.01, -1, cell);
}

// ---------------------------------------------------------------- old pit rows

/** a row of buildings along the lap: where it runs, which side, how far behind the barrier its front face is, how deep */
export interface RowSpot {
  sA: number;
  sB: number;
  side: number;
  /** the front face's distance behind the barrier line (which it follows, smoothed) */
  back: number;
  depth: number;
}

/** |lateral| of a row's front face at s: the barrier line averaged over ±20 m, plus the row's setback */
export function rowFront(track: Track, row: { side: number; back: number }, s: number): number {
  let sum = 0;
  for (let d = -20; d <= 20; d += 5) sum += barrierLine(track, s + d, row.side);
  return sum / 9 + row.back;
}

/** reserve a row of buildings along the lap (exclusions every 24 m; the ground is left as it lies: the row steps down it) */
export function planRow(track: Track, map: WorldMap, sA: number, sB: number, side: number, back: number, depth: number): RowSpot {
  const row: RowSpot = { sA, sB, side, back, depth };
  const q = new THREE.Vector3();
  for (let s = sA; s <= sB; s += 24) {
    const sm = Math.min(sB, s + 12);
    track.point(sm, side * (rowFront(track, row, sm) + depth / 2), 0, q);
    const yaw = Math.atan2(track.frame(sm).tangent.x, track.frame(sm).tangent.z);
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: depth / 2 + 3, halfL: 15, angle: yaw });
    map.clearings.push({ x: q.x, z: q.z, r: depth + 8, soft: 10, keep: 0.1 });
  }
  return row;
}

/**
 * The frame of one module of a row between s0 and s1: origin at the middle of its front face, on
 * the ground under it (the lower of front and back), x along the face (s0 → s1), z to the right
 * of that; and the face's length.
 */
export function rowModule(d: Dress, row: RowSpot, s0: number, s1: number): { L: Loc; len: number } {
  const t = d.track;
  const A = t.point(s0, row.side * rowFront(t, row, s0), 0, new THREE.Vector3());
  const B = t.point(s1, row.side * rowFront(t, row, s1), 0, new THREE.Vector3());
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
  const dx = B.x - A.x, dz = B.z - A.z;
  const len = Math.hypot(dx, dz);
  // (the back of the module: `depth` out along the face's own normal, away from the track)
  const bx = mx + (-dz / len) * row.side * row.depth, bz = mz + (dx / len) * row.side * row.depth;
  const y = Math.min(d.map.height(mx, mz), d.map.height(bx, bz));
  return { L: new Loc(mx, y, mz, Math.atan2(-dz, dx)), len };
}

export interface PitRowStyle {
  /** 1: garages under a roof terrace; 2: a glazed hospitality floor over the garages */
  storeys: 1 | 2;
  wall: number;
  trim: number;
  /** roller doors, in runs of three */
  doors: number[];
  /** printed fascia band over the doors (cells, in runs of three) */
  fascia?: string[];
  /** a spectators' rail round the roof */
  terrace?: boolean;
}

/**
 * An old pit row: 6 m garage modules (piers, ribbed roller doors, a lintel and the fascia band),
 * the back wall to the paddock, then a roof terrace behind a rail or a glazed first floor under a
 * thin oversailing roof. Each module sits on the ground under it, so the row steps down a slope.
 */
export function pitRow(d: Dress, row: RowSpot, st: PitRowStyle) {
  const t = d.track;
  const { sA, sB, side, depth } = row;
  const n = Math.max(1, Math.round(t.delta(sA, sB) / 6));
  const ds = t.delta(sA, sB) / n;
  /** local z range between two distances out from the front face (toward the paddock) */
  const zr = (u0: number, u1: number): [number, number] => {
    const a = side * u0, b = side * u1;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const wall = C(st.wall), trim = C(st.trim), dark = C(0x2a2d31), plinth = C(0x8f8b84);
  const H1 = 4.4, H2 = st.storeys === 2 ? 8.2 : H1;
  for (let k = 0; k < n; k++) {
    const { L, len } = rowModule(d, row, sA + k * ds, sA + (k + 1) * ds);
    const x0 = -len / 2 - 0.02, x1 = len / 2 + 0.02;
    const box = (xa: number, ya: number, u0: number, xb: number, yb: number, u1: number, c: THREE.Color, cls: number, fine = false) => {
      const [za, zb] = zr(u0, u1);
      d.box(L, xa, ya, za, xb, yb, zb, c, cls, fine);
    };
    // plinth down into the ground, the back wall, the slab over the garages
    box(x0, -1.4, 0, x1, 0.25, depth, plinth, ARCH.CONCRETE);
    box(x0, 0.25, depth - 0.4, x1, H2, depth, wall, ARCH.RENDER);
    box(x0, H1 - 0.05, -0.3, x1, H1 + 0.35, depth, trim, ARCH.RENDER);
    // a pier, the roller door beside it (ribbed in alternating strips), the lintel and the fascia band
    box(-len / 2, 0.25, 0, -len / 2 + 0.5, H1 - 0.05, 0.5, wall, ARCH.RENDER);
    const door = C(st.doors[Math.floor(k / 3) % st.doors.length]);
    for (let r = 0; r < 6; r++) box(-len / 2 + 0.5, 0.25 + r * 0.55, 0.3, len / 2, 0.8 + r * 0.55, 0.42, door.clone().multiplyScalar(r % 2 ? 0.86 : 1), ARCH.STEEL);
    box(-len / 2 + 0.5, 3.55, 0.1, len / 2, H1 - 0.05, 0.5, dark, ARCH.PLAIN);
    if (st.fascia?.length) d.bannerZ(L, -len / 2 + 0.6, len / 2 - 0.1, 3.62, H1 - 0.12, -side * 0.02 + side * 0.1, side > 0 ? -1 : 1, st.fascia[Math.floor(k / 3) % st.fascia.length]);
    if (st.storeys === 2) {
      // first floor: glazed toward the track behind slim mullions, a thin roof plate oversailing it
      d.glaze(L, side > 0 ? x1 : x0, side * 1.2, side > 0 ? x0 : x1, side * 1.2, H1 + 0.35, H2 - 0.3, new THREE.Vector3(0, 0, -side), 6);
      box(x0, H1 + 0.35, 1.3, x1, H2, depth - 0.4, C(0x55595d), ARCH.PLAIN);
      for (const x of [-len / 2, 0]) box(x - 0.06, H1 + 0.35, 1.05, x + 0.06, H2, 1.25, trim, ARCH.STEEL, true);
      box(x0, H2, -1.2, x1, H2 + 0.35, depth + 0.3, trim, ARCH.RENDER);
    } else {
      // the roof terrace: a parapet and, for the spectators, a tubular rail on posts
      box(x0, H1 + 0.35, 0, x1, H1 + 0.95, 0.25, trim, ARCH.RENDER);
      if (st.terrace) {
        box(x0, H1 + 1.35, 0.08, x1, H1 + 1.42, 0.16, C(0x9aa0a6), ARCH.STEEL, true);
        box(-0.03, H1 + 0.95, 0.08, 0.03, H1 + 1.4, 0.16, C(0x9aa0a6), ARCH.STEEL, true);
      }
    }
  }
}
