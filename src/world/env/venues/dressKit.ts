import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import { SURF, VERGE } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { MeshBuilder, srgb } from '../geom.ts';
import { ARCH, archMaterial, member, tagAxis, tagClass } from '../archMaterial.ts';
import { canvas2d, canvasTexture } from '../textures.ts';
import { drawBrand, printWear, type Brand } from '../../brands.ts';
import { GlassGeo } from '../../pitlane/building.ts';
import { glassMaterial } from '../../pitlane/materials.ts';
import { makePlan, L as PIT_L, type PitPlan } from '../../pitlane/layout.ts';
import { PIT_HANDOFF } from '../../trackside/context.ts';

/**
 * A venue's own trackside dressing, laid out the way the circuit really dresses itself for the
 * race weekend rather than from the paddock-wide sponsor pool (trackside/structures.ts and
 * barriers.ts still do the generic boards, belts and fence wraps):
 *
 *   DressAtlas   one canvas per venue: the brands that venue's boards really carry (fictional
 *                names in the real boards' colour blocks), its event banners, LED boards
 *   hoardings    a row of printed (or LED) boards on posts ~5–6 m behind the barrier, clear of
 *                the marshal posts, photographers and camera platforms in front of it; brands
 *                hold contracts, so the same board repeats in runs as on a real fence line
 *   billboard    a big scaffold-mounted board at the end of a run-off, turned to the braking zone
 *   gantry       a lattice truss across the track on two lattice legs, banners on both faces
 *   logo         a painted sponsor logo in a tarmac run-off (only where the surface really is
 *                tarmac run-off, wholly inside the barriers)
 *   pit roof     helpers in the pit building's own track space (makePlan) for the features each
 *                venue's building has on top of the shared one
 *
 * Everything lands in five merged meshes per venue: structure (archMaterial, casts shadows),
 * slender members (no shadow), printed faces, LED faces and the painted run-off.
 */

// ---------------------------------------------------------------- the atlas

export interface DressCell {
  name: string;
  w: number;
  h: number;
  draw(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  /** printed-vinyl wear (0 = none) */
  wear?: number;
}

const FONT = '"Titillium Web", "Arial Narrow", Arial, sans-serif';
const ATLAS_W = 2048;

/** shelf-packed canvas of a venue's boards; drawn now and again once the web font is in */
export class DressAtlas {
  readonly tex: THREE.CanvasTexture;
  private readonly rects = new Map<string, [number, number, number, number]>();
  private readonly W: number;
  private readonly H: number;

  constructor(cells: DressCell[]) {
    // a white cell for lamp strips and plain faces
    const all: DressCell[] = [{ name: '_white', w: 64, h: 64, draw: (g, x, y, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(x, y, w, h); } }, ...cells];
    let x = 0, y = 0, rowH = 0;
    for (const c of all) {
      if (x + c.w > ATLAS_W) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      this.rects.set(c.name, [x, y, c.w, c.h]);
      x += c.w;
      rowH = Math.max(rowH, c.h);
    }
    this.W = ATLAS_W;
    this.H = Math.ceil((y + rowH) / 128) * 128;
    const { canvas } = canvas2d(this.W, this.H);
    const paint = () => {
      const g = canvas.getContext('2d')!;
      g.clearRect(0, 0, this.W, this.H);
      all.forEach((c, i) => {
        const [cx, cy, cw, ch] = this.rects.get(c.name)!;
        g.save();
        g.beginPath();
        g.rect(cx, cy, cw, ch);
        g.clip();
        c.draw(g, cx, cy, cw, ch);
        g.restore();
        if (c.wear) printWear(g, cx, cy, cw, ch, 977 + i * 13, c.wear);
      });
    };
    paint();
    this.tex = canvasTexture(canvas, true, 8);
    // (the boot waits for the brand faces, but a world built before them gets its letters later)
    if (typeof document !== 'undefined' && document.fonts)
      document.fonts.ready.then(() => {
        paint();
        this.tex.needsUpdate = true;
      }).catch(() => {});
  }

  has(name: string) {
    return this.rects.has(name);
  }

  /** [u0, v0, u1, v1] of a cell (inset 2 px), optionally a horizontal slice of it */
  uv(name: string, x0 = 0, x1 = 1): [number, number, number, number] {
    const r = this.rects.get(name) ?? this.rects.get('_white')!;
    const [x, y, w, h] = r;
    const u0 = (x + 2 + (w - 4) * x0) / this.W, u1 = (x + 2 + (w - 4) * x1) / this.W;
    return [u0, 1 - (y + h - 2) / this.H, u1, 1 - (y + 2) / this.H];
  }
}

/** a brand's lockup at the board's proportions, weathered */
export function brandCell(name: string, b: Brand, w = 512, h = 128, invert = false, wear = 0.7): DressCell {
  return { name, w, h, wear, draw: (g, x, y, W, H) => drawBrand(g, x, y, W, H, b, invert) };
}

export interface TextStyle {
  bg: string;
  fg: string;
  /** a second, smaller line under the main one */
  sub?: string;
  subFg?: string;
  weight?: number;
  italic?: boolean;
  /** extra tracking (fraction of the font size) */
  track?: number;
  /** bands of colour along the bottom edge (left → right), e.g. a national flag */
  bands?: string[];
  /** a band along the top edge */
  top?: string;
  /** draw something before the text (a mark at the left end, a motif) */
  deco?: (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
  /** leave room at the left for the deco (fraction of the height) */
  indent?: number;
}

function setTrack(g: CanvasRenderingContext2D, px: number) {
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px.toFixed(1)}px`;
}

/** a lettered board: the event's banners, the circuit's own signs */
export function textCell(name: string, text: string, st: TextStyle, w = 512, h = 128, wear = 0.6): DressCell {
  return {
    name,
    w,
    h,
    wear,
    draw(g, x, y, W, H) {
      g.fillStyle = st.bg;
      g.fillRect(x, y, W, H);
      const bandH = st.bands ? H * 0.12 : 0;
      if (st.bands) st.bands.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect(x + (i * W) / st.bands!.length, y + H - bandH, W / st.bands!.length + 1, bandH);
      });
      const topH = st.top ? H * 0.1 : 0;
      if (st.top) {
        g.fillStyle = st.top;
        g.fillRect(x, y, W, topH);
      }
      st.deco?.(g, x, y, W, H);
      const ind = (st.indent ?? 0) * H;
      const inner = H - bandH - topH;
      const cy = y + topH + inner * (st.sub ? 0.4 : 0.52);
      const style = `${st.italic ? 'italic ' : ''}${st.weight ?? 900}`;
      let size = inner * (st.sub ? 0.5 : 0.66);
      const fit = (s: number) => {
        g.font = `${style} ${Math.round(s)}px ${FONT}`;
        setTrack(g, s * (st.track ?? 0));
        return g.measureText(text).width;
      };
      while (size > 10 && fit(size) > W - ind - H * 0.3) size *= 0.94;
      g.fillStyle = st.fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, x + ind + (W - ind) / 2, cy);
      if (st.sub) {
        let ss = inner * 0.2;
        g.font = `600 ${Math.round(ss)}px ${FONT}`;
        setTrack(g, ss * 0.25);
        while (ss > 8 && g.measureText(st.sub).width > W - ind - H * 0.3) {
          ss *= 0.94;
          g.font = `600 ${Math.round(ss)}px ${FONT}`;
          setTrack(g, ss * 0.25);
        }
        g.fillStyle = st.subFg ?? st.fg;
        g.fillText(st.sub, x + ind + (W - ind) / 2, y + topH + inner * 0.78);
      }
      setTrack(g, 0);
    },
  };
}

/**
 * An LED perimeter board: the content drawn by `inner`, then the diode grid over it (dark
 * lines between the pixels, a little bloom-ish lift on the bright ones) — the board's face is
 * self-lit in the LED material, so it reads bright on a grey day and at night.
 */
export function ledCell(name: string, inner: DressCell['draw'], w = 512, h = 128): DressCell {
  return {
    name,
    w,
    h,
    draw(g, x, y, W, H) {
      inner(g, x, y, W, H);
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgba(40,40,46,0.55)';
      for (let k = 0; k < W; k += 4) g.fillRect(x + k, y, 1, H);
      for (let k = 0; k < H; k += 4) g.fillRect(x, y + k, W, 1);
      g.restore();
    },
  };
}

/** the drawing of a brand, for LED / custom cells */
export const brandDraw = (b: Brand, invert = false): DressCell['draw'] => (g, x, y, w, h) => drawBrand(g, x, y, w, h, b, invert);

// ---------------------------------------------------------------- the dressing

const WHITE = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export interface HoardingOpts {
  sA: number;
  sB: number;
  side: number;
  /** metres behind the barrier line (default 5.6: behind the marshal posts and photographers) */
  off?: number;
  /** board bottom above the ground, board height */
  y0?: number;
  h?: number;
  /** panel length (m); default 4 × h (the cells are 4:1) */
  panel?: number;
  cells: string[];
  /** consecutive panels per brand (a contract) */
  run?: number;
  led?: boolean;
  /** backing / post colour */
  frame?: number;
}

export interface GantryOpts {
  s: number;
  /** banners on the face toward oncoming cars, and on the back */
  cells: string[];
  back?: string[];
  /** banner bottom above the road and banner height */
  y0?: number;
  h?: number;
  /** leg distance behind each barrier */
  legOff?: number;
  steel?: number;
  /** consecutive banners per brand */
  run?: number;
  /** an LED face (self-lit) */
  led?: boolean;
}

export class Dress {
  /** structure: posts, frames, legs, roofs (archMaterial, casts shadows) */
  readonly arch = new MeshBuilder();
  /** slender members: truss webs, bracing, rails (no shadow) */
  readonly fine = new MeshBuilder();
  readonly print = new MeshBuilder();
  readonly led = new MeshBuilder();
  readonly paint = new MeshBuilder();
  readonly rooms = new GlassGeo();
  readonly track: Track;
  readonly map: WorldMap;
  readonly layout: Layout;
  readonly atlas: DressAtlas;
  /** s of every big overhead structure the generic trackside also builds (footbridges): hoardings keep clear */
  keepClear: number[] = [];
  glassTint = 0x2c3a44;

  constructor(track: Track, map: WorldMap, layout: Layout, atlas: DressAtlas) {
    this.track = track;
    this.map = map;
    this.layout = layout;
    this.atlas = atlas;
  }

  // ---------------------------------------------------------------- placement

  corner(name: string) {
    return this.track.corners.find((c) => c.name === name);
  }

  /** ground point at (s, lateral) */
  ground(s: number, lat: number, out = new THREE.Vector3()) {
    this.track.point(s, lat, 0, out);
    out.y = this.map.height(out.x, out.z);
    return out;
  }

  /** lateral of a line `off` m behind the barrier on `side` */
  behind(s: number, side: number, off: number) {
    return side * (this.track.barrierAt(s, side) + off);
  }

  /** beyond every part of the lap's barriers by `margin`, and out of the pit complex */
  free(x: number, z: number, margin = 1) {
    return this.map.trackClearance(x, z) > margin && !this.map.inPitZone(x, z, 6);
  }

  /** within `front` m in front of (or inside) a grandstand, under a big screen or a camera tower */
  blocked(x: number, z: number, front = 7) {
    for (const g of this.layout.grandstands) {
      const dx = x - g.center.x, dz = z - g.center.z;
      const along = Math.abs(dx * g.facing.z - dz * g.facing.x);
      const toward = dx * g.facing.x + dz * g.facing.z;
      if (along < g.length / 2 + 2 && toward < g.depth / 2 + front && toward > -g.depth / 2 - 4) return true;
    }
    for (const sc of this.layout.screens) if ((x - sc.x) ** 2 + (z - sc.z) ** 2 < (sc.w / 2 + 4) ** 2) return true;
    for (const lm of this.layout.landmarks ?? []) if (lm.kind === 'cameraTower' && (x - lm.x) ** 2 + (z - lm.z) ** 2 < 36) return true;
    return false;
  }

  /** a general-admission bank on this side at s (its fans stand right behind the fence: no boards in front of them) */
  inBank(s: number, side: number) {
    const t = this.track;
    return this.layout.banks.some((b) => b.side === side && t.delta(b.sA - 6, s) >= 0 && t.delta(s, b.sB + 6) >= 0);
  }

  private nearClear(s: number, r: number) {
    return this.keepClear.some((k) => Math.abs(this.track.delta(k, s)) < r);
  }

  // ---------------------------------------------------------------- primitives

  /** oriented box: centre, full sizes along (local x, y, z), yaw (local x → (cos, −sin)) */
  box(mb: MeshBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, col: number | THREE.Color, cls: number = ARCH.STEEL) {
    const from = mb.vertexCount;
    const m = new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(sx, sy, sz));
    m.setPosition(cx, cy, cz);
    mb.box(m, typeof col === 'number' ? srgb(col) : col);
    tagClass(mb, from, cls);
    tagAxis(mb, from, -yaw);
  }

  /** a straight member a → b */
  bar(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, col: number, cls: number = ARCH.STEEL) {
    const from = mb.vertexCount;
    member(mb, a, b, w, w, srgb(col));
    tagClass(mb, from, cls);
    tagAxis(mb, from, Math.atan2(b.z - a.z, b.x - a.x));
  }

  /**
   * a printed face from a to b (world points at the face's bottom edge), `h` tall, facing the
   * side `toward` is on (the corners are ordered so the print reads left → right from there)
   */
  face(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, h: number, uv: [number, number, number, number], toward: THREE.Vector3) {
    const A1 = a.clone().addScaledVector(UP, h), B1 = b.clone().addScaledVector(UP, h);
    const n = _a.subVectors(b, a).cross(UP);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (n.x * (toward.x - mx) + n.z * (toward.z - mz) >= 0) mb.quad4(a, b, B1, A1, WHITE, uv);
    else mb.quad4(b, a, A1, B1, WHITE, uv);
  }

  /** a quad on the ground (or any plane) that reads correctly from above: p0 → p1 is the image's bottom edge left → right */
  flat(mb: MeshBuilder, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, uv: [number, number, number, number]) {
    const n = _a.subVectors(p1, p0).cross(_b.subVectors(p3, p0));
    // (a mirrored winding would face down: swap left and right, keeping the image the right way round from above)
    if (n.y >= 0) mb.quad4(p0, p1, p2, p3, WHITE, uv);
    else mb.quad4(p1, p0, p3, p2, WHITE, [uv[2], uv[1], uv[0], uv[3]]);
  }

  // ---------------------------------------------------------------- hoardings

  /**
   * A row of boards on posts behind the barrier from sA to sB. Each board is level (its posts
   * reach the ground at both ends); boards are dropped where the barrier line folds or jumps,
   * where another part of the lap or the pit complex is too close, in front of a grandstand,
   * a big screen or a camera tower, and round the footbridges.
   */
  hoardings(o: HoardingOpts) {
    const t = this.track;
    const off = o.off ?? 5.6, y0 = o.y0 ?? 1.4, h = o.h ?? 1.5;
    const panel = o.panel ?? h * 4;
    const run = o.run ?? 3;
    const total = ((o.sB - o.sA) % t.length + t.length) % t.length;
    const pt = (s: number) => this.ground(s, this.behind(s, o.side, off));
    const toward = new THREE.Vector3();
    let a = pt(o.sA), sa = o.sA, acc = 0, prev = a.clone(), k = 0;
    let lastPost: THREE.Vector3 | null = null;
    for (let d = 1; d <= total; d++) {
      const s = o.sA + d;
      const p = pt(s);
      acc += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
      if (acc < panel) continue;
      const b = p, sb = s;
      acc = 0;
      const okFold = (() => {
        const dir = _b.subVectors(b, a).setY(0);
        const len = dir.length();
        const f = t.frame((sa + sb) / 2);
        return len > panel * 0.8 && len < panel * 1.25 && Math.abs(dir.x * f.tangent.x + dir.z * f.tangent.z) / len > 0.9 && Math.abs(t.barrierAt(sa, o.side) - t.barrierAt(sb, o.side)) < 1.2;
      })();
      const ok = okFold && this.free(a.x, a.z, off - 1.5) && this.free(b.x, b.z, off - 1.5) && !this.blocked(a.x, a.z) && !this.blocked(b.x, b.z) && !this.nearClear((sa + sb) / 2, 14) && !t.inPit((sa + sb) / 2) && !this.inBank((sa + sb) / 2, o.side);
      if (ok) {
        const base = Math.min(a.y, b.y) + y0;
        const A = new THREE.Vector3(a.x, base, a.z), B = new THREE.Vector3(b.x, base, b.z);
        t.point((sa + sb) / 2, 0, 0, toward);
        // backing: a thin box behind the print, and the posts down to the ground
        const yaw = -Math.atan2(B.z - A.z, B.x - A.x);
        const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
        const nx = -dz / len, nz = dx / len;
        const sgn = nx * (toward.x - A.x) + nz * (toward.z - A.z) > 0 ? 1 : -1;
        const back = (q: THREE.Vector3, k2: number) => q.clone().set(q.x - nx * sgn * k2, q.y, q.z - nz * sgn * k2);
        const frame = o.frame ?? (o.led ? 0x121316 : 0x2d3035);
        this.box(this.arch, (A.x + B.x) / 2 - nx * sgn * 0.07, base + h / 2, (A.z + B.z) / 2 - nz * sgn * 0.07, len + 0.06, h + 0.12, 0.1, yaw, frame);
        for (const q of lastPost && lastPost.distanceTo(a) < 0.3 ? [b] : [a, b]) {
          const gy = this.map.height(q.x, q.z);
          const bq = back(q, 0.2);
          this.box(this.arch, bq.x, (gy - 0.5 + base + h) / 2, bq.z, 0.1, base + h - gy + 0.5, 0.1, yaw, 0x55595e);
        }
        lastPost = b.clone();
        const cell = o.cells[Math.floor(k / run) % o.cells.length];
        this.face(o.led ? this.led : this.print, A, B, h, this.atlas.uv(cell), toward);
        k++;
      }
      a = b;
      sa = sb;
    }
  }

  // ---------------------------------------------------------------- billboard

  /** a big board on a braced steel frame at (s, side, off behind the barrier), turned to face (lookS, lookLat) */
  billboard(s: number, side: number, off: number, w: number, h: number, y0: number, cell: string, lookS: number, lookLat = 0): boolean {
    if (this.nearClear(s, 16)) return false;
    const c = this.ground(s, this.behind(s, side, off));
    const look = this.track.point(lookS, lookLat, 0, new THREE.Vector3());
    const fx = look.x - c.x, fz = look.z - c.z, fl = Math.hypot(fx, fz);
    const nx = fx / fl, nz = fz / fl;
    // along the board: perpendicular to the facing
    const ax = -nz, az = nx;
    const A = new THREE.Vector3(c.x - ax * w / 2, 0, c.z - az * w / 2), B = new THREE.Vector3(c.x + ax * w / 2, 0, c.z + az * w / 2);
    // (beyond the marshal posts, photographers' stands and camera platforms at the fence)
    for (const q of [c, A, B]) if (!this.free(q.x, q.z, 5) || this.blocked(q.x, q.z)) return false;
    const base = Math.min(this.map.height(A.x, A.z), this.map.height(B.x, B.z), c.y) + y0;
    A.y = B.y = base;
    const yaw = -Math.atan2(B.z - A.z, B.x - A.x);
    this.box(this.arch, c.x - nx * 0.12, base + h / 2, c.z - nz * 0.12, w + 0.2, h + 0.2, 0.18, yaw, 0x2b2e33);
    // legs, kicker braces back to the ground
    for (const u of [-0.42, 0, 0.42]) {
      const lx = c.x + ax * w * u - nx * 0.45, lz = c.z + az * w * u - nz * 0.45;
      const gy = this.map.height(lx, lz);
      this.box(this.arch, lx, (gy - 0.6 + base + h) / 2, lz, 0.22, base + h - gy + 0.6, 0.22, yaw, 0x4a4e55);
      const foot = new THREE.Vector3(lx - nx * 2.6, 0, lz - nz * 2.6);
      foot.y = this.map.height(foot.x, foot.z);
      this.bar(this.fine, new THREE.Vector3(lx, base + h * 0.6, lz), foot, 0.12, 0x5b5f66);
    }
    this.face(this.print, A, B, h, this.atlas.uv(cell), look);
    return true;
  }

  // ---------------------------------------------------------------- gantry over the track

  /** a lattice truss across the track at s on two lattice legs, banners on both faces */
  gantry(o: GantryOpts): boolean {
    const t = this.track;
    const s = o.s;
    // (legs beyond the marshal posts' slabs, which reach ~3.7 m behind a plain barrier)
    const legOff = o.legOff ?? 4.6;
    const xl = -(t.barrierAt(s, -1) + legOff), xr = t.barrierAt(s, 1) + legOff;
    const f = t.frame(s);
    const tx = f.tangent.x, tz = f.tangent.z, tl = Math.hypot(tx, tz);
    const T = new THREE.Vector3(tx / tl, 0, tz / tl);
    const PL = this.ground(s, xl), PR = this.ground(s, xr);
    if (!this.free(PL.x, PL.z, legOff - 1.4) || !this.free(PR.x, PR.z, legOff - 1.4) || this.blocked(PL.x, PL.z, 1.5) || this.blocked(PR.x, PR.z, 1.5)) return false;
    const yc = t.point(s, 0, 0, _c).y;
    const y0 = yc + (o.y0 ?? 6.6), h = o.h ?? 1.8;
    const D = 1.1;
    const steel = o.steel ?? 0x2a2d32;
    const yaw = -Math.atan2(PR.z - PL.z, PR.x - PL.x);
    // legs: four tubes and their lacing, a concrete pad
    for (const P of [PL, PR]) {
      const top = y0 + h + 0.15;
      this.box(this.arch, P.x, P.y + 0.1, P.z, 1.5, 0.5, 1.5, yaw, 0x8a8781, ARCH.CONCRETE);
      for (const u of [-0.4, 0.4]) for (const v of [-0.4, 0.4]) {
        const x = P.x + Math.cos(yaw) * u + T.x * v, z = P.z - Math.sin(yaw) * u + T.z * v;
        this.box(this.arch, x, (P.y + top) / 2, z, 0.14, top - P.y, 0.14, yaw, steel);
      }
      for (let y = P.y + 0.6; y < top - 0.4; y += 1.1)
        for (const v of [-0.4, 0.4]) {
          const a = new THREE.Vector3(P.x - Math.cos(yaw) * 0.4 + T.x * v, y, P.z + Math.sin(yaw) * 0.4 + T.z * v);
          const b = new THREE.Vector3(P.x + Math.cos(yaw) * 0.4 + T.x * v, y + 1.0, P.z - Math.sin(yaw) * 0.4 + T.z * v);
          this.bar(this.fine, a, b, 0.06, steel);
        }
    }
    // the truss: four chords, verticals and diagonals on the two faces
    const at = (x: number, y: number, v: number) => t.point(s, x, 0, new THREE.Vector3()).setY(y).addScaledVector(T, v);
    for (const y of [y0 - 0.1, y0 + h + 0.1]) for (const v of [-D / 2, D / 2]) this.bar(this.arch, at(xl - 0.4, y, v), at(xr + 0.4, y, v), 0.16, steel);
    const nP = Math.max(2, Math.round((xr - xl) / 1.6));
    for (let k = 0; k <= nP; k++) {
      const x = xl + ((xr - xl) * k) / nP;
      for (const v of [-D / 2, D / 2]) {
        this.bar(this.fine, at(x, y0 - 0.1, v), at(x, y0 + h + 0.1, v), 0.07, steel);
        if (k < nP) {
          const xn = xl + ((xr - xl) * (k + 1)) / nP;
          this.bar(this.fine, at(x, k % 2 ? y0 - 0.1 : y0 + h + 0.1, v), at(xn, k % 2 ? y0 + h + 0.1 : y0 - 0.1, v), 0.06, steel);
        }
      }
    }
    // banners on both faces, the same brand in runs
    const bw = h * 4;
    const n = Math.max(1, Math.floor((xr - xl - 0.6) / bw));
    const x0 = (xl + xr) / 2 - (n * bw) / 2;
    const run = o.run ?? 1;
    const mb = o.led ? this.led : this.print;
    for (const [v, cells] of [[-D / 2 - 0.06, o.cells], [D / 2 + 0.06, o.back ?? o.cells]] as [number, string[]][]) {
      const look = at(0, y0, v * 100);
      for (let k = 0; k < n; k++) {
        const a = at(x0 + k * bw + 0.03, y0, v), b = at(x0 + (k + 1) * bw - 0.03, y0, v);
        this.face(mb, a, b, h, this.atlas.uv(cells[Math.floor(k / run) % cells.length]), look);
      }
    }
    // backing sheet between the faces
    const mid = at((xl + xr) / 2, y0 + h / 2, 0);
    this.box(this.arch, mid.x, mid.y, mid.z, xr - xl - 0.4, h, D - 0.1, yaw, 0x1d1f23);
    return true;
  }

  // ---------------------------------------------------------------- painted run-off

  /**
   * A painted logo in the tarmac run-off, centred `lat` from the centreline on `side`: `len`
   * along the track, `wid` across. `along`: the image's up runs with the track (read by the
   * cars and the cameras behind them); otherwise it runs away from the track (read from the
   * far side and the helicopter). Only placed where all of it is tarmac run-off.
   */
  logo(s: number, side: number, lat: number, len: number, wid: number, cell: string, along = false): boolean {
    const t = this.track;
    // (the pit side round the lane, its entry and exit spurs belong to the pit complex)
    if (side === t.pit.side && t.delta(t.pit.sStart - PIT_HANDOFF.before - len, s) > 0 && t.delta(s, t.pit.sEnd + PIT_HANDOFF.after + len) > 0) return false;
    const l0 = lat - wid / 2, l1 = lat + wid / 2;
    for (const ds of [-len / 2, 0, len / 2])
      for (const l of [l0, lat, l1]) {
        const ss = s + ds;
        const inner = t.halfWidthAt(ss) + t.kerbAt(ss, side) + VERGE + 0.8;
        if (l < inner || l > t.barrierAt(ss, side) - 1.6 || t.surfaceAt(ss, side * l) !== SURF.ASPHALT || t.inPit(ss)) return false;
      }
    const P = (ds: number, l: number) => t.point(s + ds, side * l, 0.03, new THREE.Vector3());
    const uv = this.atlas.uv(cell);
    if (along) {
      // bottom edge across the track at the near end; left → right as seen driving along
      const a = P(-len / 2, side < 0 ? l1 : l0), b = P(-len / 2, side < 0 ? l0 : l1);
      const c = P(len / 2, side < 0 ? l0 : l1), d = P(len / 2, side < 0 ? l1 : l0);
      this.flat(this.paint, a, b, c, d, uv);
    } else {
      // bottom edge along the track's edge; left → right as seen from the track looking out
      const a = P(-len / 2 * -side, l0), b = P(len / 2 * -side, l0);
      const c = P(len / 2 * -side, l1), d = P(-len / 2 * -side, l1);
      this.flat(this.paint, a, b, c, d, uv);
    }
    return true;
  }

  /**
   * Logos along a run-off: try every `step` m from sA to sB at the middle of the tarmac
   * between the kerb and the barrier, `width` m wide (the image's long side; the cells are
   * 4:1) or as wide as fits; returns how many went down.
   */
  logos(sA: number, sB: number, side: number, cells: string[], step = 34, width = 16, along = false): number {
    const t = this.track;
    let n = 0;
    const total = ((sB - sA) % t.length + t.length) % t.length;
    for (let d = 0; d <= total; d += step) {
      const s = sA + d;
      const inner = t.halfWidthAt(s) + t.kerbAt(s, side) + VERGE + 0.8;
      const outer = t.barrierAt(s, side) - 1.6;
      const room = outer - inner;
      if (room < 4) continue;
      // along: the image's width runs across the run-off; otherwise along the track
      const across = along ? Math.min(room - 0.6, width) : Math.min(room - 0.6, width / 4);
      const alongLen = along ? across / 4 : across * 4;
      if (this.logo(s, side, (inner + outer) / 2, alongLen, across, cells[n % cells.length], along)) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- the pit building's own space

  /** the pit complex's plan (spans, tower, podium) and a point in its track space (l toward the paddock, h above the road plane) */
  private _pit: { plan: PitPlan; P: (s: number, l: number, h: number) => THREE.Vector3; F: number; BB: number } | null = null;
  pit(): { plan: PitPlan; P: (s: number, l: number, h: number) => THREE.Vector3; F: number; BB: number } {
    if (this._pit) return this._pit;
    const plan = makePlan(this.track);
    const side = plan.side;
    const P = (s: number, l: number, h: number) => {
      const v = this.track.point(s, side * l, 0, new THREE.Vector3());
      v.y += h;
      return v;
    };
    return (this._pit = { plan, P, F: PIT_L.front, BB: PIT_L.bldgBack });
  }

  /** a box in the pit's track space: s0..s1 × l0..l1 × h0..h1, cut into ≤ 8 m pieces along s */
  pitBox(mb: MeshBuilder, s0: number, s1: number, l0: number, l1: number, h0: number, h1: number, col: number, cls: number = ARCH.STEEL) {
    const { P } = this.pit();
    const n = Math.max(1, Math.ceil((s1 - s0) / 8));
    for (let k = 0; k < n; k++) {
      const a = s0 + ((s1 - s0) * k) / n, b = s0 + ((s1 - s0) * (k + 1)) / n;
      const A = P(a, (l0 + l1) / 2, 0), B = P(b, (l0 + l1) / 2, 0);
      const C0 = P(a, l0, 0), C1 = P(a, l1, 0);
      const len = Math.hypot(B.x - A.x, B.z - A.z), dep = Math.hypot(C1.x - C0.x, C1.z - C0.z);
      const yaw = -Math.atan2(B.z - A.z, B.x - A.x);
      const yMid = (A.y + B.y) / 2;
      this.box(mb, (A.x + B.x) / 2, yMid + (h0 + h1) / 2, (A.z + B.z) / 2, len + 0.02, h1 - h0, dep, yaw, col, cls);
    }
  }

  /** a quad turned to face `out` (both windings tried), tagged as `cls` */
  quadOut(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3, col: number, cls: number) {
    const from = mb.vertexCount;
    const n = _a.subVectors(b, a).cross(_b.subVectors(d, a));
    if (n.dot(out) >= 0) mb.quad4(a, b, c, d, srgb(col));
    else mb.quad4(b, a, d, c, srgb(col));
    tagClass(mb, from, cls);
    tagAxis(mb, from, Math.atan2(b.z - a.z, b.x - a.x));
  }

  /**
   * A roof blade over the pit building: the section `prof` ([l, h] front → back, h above the
   * road plane) extruded along s from s0 to s1, `thick` deep, in 6 m pieces; `gaps` (s ranges,
   * e.g. round the race-control tower) are left open with the ends capped.
   */
  pitBlade(mb: MeshBuilder, s0: number, s1: number, prof: [number, number][], thick: number, col: number, gaps: [number, number][] = [], cls: number = ARCH.STEEL, under = col) {
    const { P } = this.pit();
    const runs: [number, number][] = [];
    let a = s0;
    for (const [g0, g1] of [...gaps].sort((x, y) => x[0] - y[0])) {
      if (g1 <= a || g0 >= s1) continue;
      if (g0 > a) runs.push([a, g0]);
      a = Math.max(a, g1);
    }
    if (a < s1) runs.push([a, s1]);
    const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
    for (const [r0, r1] of runs) {
      const n = Math.max(1, Math.ceil((r1 - r0) / 6));
      for (let i = 0; i < n; i++) {
        const sa = r0 + ((r1 - r0) * i) / n, sb = r0 + ((r1 - r0) * (i + 1)) / n;
        for (let k = 0; k < prof.length - 1; k++) {
          const [l0, h0] = prof[k], [l1, h1] = prof[k + 1];
          this.quadOut(mb, P(sa, l0, h0), P(sb, l0, h0), P(sb, l1, h1), P(sa, l1, h1), up, col, cls);
          this.quadOut(mb, P(sa, l0, h0 - thick), P(sb, l0, h0 - thick), P(sb, l1, h1 - thick), P(sa, l1, h1 - thick), down, under, cls);
        }
        for (const [l, h, dl] of [[prof[0][0], prof[0][1], -1], [prof[prof.length - 1][0], prof[prof.length - 1][1], 1]] as [number, number, number][]) {
          const out = P(sa, l + dl, h).sub(P(sa, l, h));
          this.quadOut(mb, P(sa, l, h - thick), P(sb, l, h - thick), P(sb, l, h), P(sa, l, h), out, col, cls);
        }
      }
      for (const [sE, d] of [[r0, -1], [r1, 1]] as [number, number][]) {
        const out = P(sE + d, prof[0][0], 0).sub(P(sE, prof[0][0], 0));
        for (let k = 0; k < prof.length - 1; k++) {
          const [l0, h0] = prof[k], [l1, h1] = prof[k + 1];
          this.quadOut(mb, P(sE, l0, h0 - thick), P(sE, l1, h1 - thick), P(sE, l1, h1), P(sE, l0, h0), out, col, cls);
        }
      }
    }
  }

  /** a printed band on a face of constant l in the pit's track space, facing the track (dir −1) or the paddock (+1) */
  pitPrint(s0: number, s1: number, l: number, h0: number, h1: number, dir: -1 | 1, cells: string[], cellLen: number, led = false) {
    const { P } = this.pit();
    const n = Math.max(1, Math.round((s1 - s0) / cellLen));
    for (let k = 0; k < n; k++) {
      const a = s0 + ((s1 - s0) * k) / n, b = s0 + ((s1 - s0) * (k + 1)) / n;
      const A = P(a, l, h0), B = P(b, l, h0);
      const look = P((a + b) / 2, l + dir * 50, h0);
      this.face(led ? this.led : this.print, A, B, h1 - h0, this.atlas.uv(cells[k % cells.length]), look);
    }
  }

  // ---------------------------------------------------------------- meshes

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const add = (mb: MeshBuilder, mat: THREE.Material, nm: string, cast: boolean, custom: boolean, order = 0) => {
      if (mb.vertexCount === 0) return;
      const m = new THREE.Mesh(mb.geometry(custom), mat);
      m.name = nm;
      m.castShadow = cast;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.renderOrder = order;
      group.add(m);
    };
    const tex = this.atlas.tex;
    add(this.arch, archMaterial(), `${name}_structure`, true, true);
    add(this.fine, archMaterial(true), `${name}_members`, false, true);
    add(this.print, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), `${name}_boards`, false, false);
    add(this.led, new THREE.MeshStandardMaterial({ map: tex, color: 0x303030, roughness: 0.35, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), `${name}_led`, false, false);
    // painted run-off: matt paint on tarmac, a shade darker than print, drawn after the road surfaces (renderOrder 1)
    add(this.paint, new THREE.MeshStandardMaterial({ map: tex, color: 0xcfcfcf, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }), `${name}_runoff`, false, false, 2);
    if (this.rooms.pos.length) {
      const gm = new THREE.Mesh(this.rooms.geometry(), glassMaterial(this.glassTint));
      gm.name = `${name}_glass`;
      gm.receiveShadow = true;
      gm.matrixAutoUpdate = false;
      group.add(gm);
    }
    group.traverse((o: THREE.Object3D) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    return group;
  }
}
