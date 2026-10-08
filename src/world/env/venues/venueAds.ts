import * as THREE from 'three';
import { SURF, VERGE, type Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec } from '../layout.ts';
import { MeshBuilder, srgb } from '../geom.ts';
import { canvas2d, canvasTexture } from '../textures.ts';
import { BRAND_FONTS, drawBrand, drawTitle, printWear, type Brand, type TitleStyle } from '../../brands.ts';
import { floodUniforms } from '../night.ts';
import type { LedReel } from './ledReel.ts';

/**
 * A venue's own advertising, on top of the paddock-wide boards the trackside builds everywhere
 * (wall paint, fence wraps, bridges, arches): what makes one Grand Prix's broadcast look unlike
 * another's —
 *
 *   hoardings      runs of freestanding printed boards on posts behind the barrier, in a
 *                  venue's own rhythm (contracts of a few boards in a row, the title partner
 *                  repeated), or LED perimeter boards that glow and read after dark
 *   run-off paint  the big word marks painted on the asphalt run-offs of the Tilke circuits,
 *                  laid along the track and reading from the TV camera on the outside
 *   title boards   the event's own banner (title partner · Grand Prix) in its colours
 *
 * Every brand is fictional (partners.ts): a venue's boards are drawn in an `AdSheet`, 512×128
 * cells (4:1), drawn once and redrawn when the brand faces have loaded; its LED boards show a
 * `LedReel` (ledReel.ts) rolling through the partners. One `VenueAds` per venue merges everything
 * into four meshes (frames, prints, LED, paint).
 */

export type AdPainter = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;

const CW = 512, CH = 128, COLS = 4;

/** a brand board, weathered like printed vinyl */
export const brandCell = (b: Brand, invert = false, seed = 1): AdPainter => (g, x, y, w, h) => {
  drawBrand(g, x, y, w, h, b, invert);
  printWear(g, x, y, w, h, seed, 0.8);
};

/**
 * Paint on asphalt: the word mark over its background block, the road's grain showing through the
 * worn paint (alpha), tyre-dark smudges where cars have run wide.
 */
export const paintCell = (b: Brand, invert = false, seed = 1): AdPainter => (g, x, y, w, h) => {
  drawBrand(g, x, y, w, h, b, invert);
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const img = g.getImageData(x, y, w, h);
  const d = img.data;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      // speckled wear (the chip tops poke through the paint) and a softer fade at the ends
      const edge = Math.min(1, i / (w * 0.04), (w - i) / (w * 0.04), j / (h * 0.06), (h - j) / (h * 0.06));
      d[k + 3] = Math.round(255 * Math.max(0, Math.min(1, edge)) * (0.72 + 0.22 * rnd()));
    }
  g.putImageData(img, x, y);
  // rubber smudges across the board
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let k = 0; k < 5; k++) {
    const sx = x + rnd() * w, sy = y + rnd() * h;
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, h * (0.4 + rnd() * 0.6));
    gr.addColorStop(0, 'rgba(20,20,20,0.35)');
    gr.addColorStop(1, 'rgba(20,20,20,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  }
  g.restore();
};

/** the event's banner: the race's title, the title partner's block first (brands.ts drawTitle) */
export const titleCell = (partner: Brand | null, gp: string, st: TitleStyle, seed = 1): AdPainter => (g, x, y, w, h) => {
  drawTitle(g, x, y, w, h, partner, gp, st);
  printWear(g, x, y, w, h, seed, 0.6);
};

/** a sheet of a venue's boards: 4 cells across, as many rows as it needs */
export class AdSheet {
  readonly texture: THREE.CanvasTexture;
  readonly count: number;
  /** canvas height (px) */
  private readonly H: number;
  constructor(cells: AdPainter[]) {
    this.count = cells.length;
    // (a power-of-two height for the mipmaps)
    let H = 128;
    while (H < Math.ceil(cells.length / COLS) * CH) H *= 2;
    this.H = H;
    const { canvas, ctx } = canvas2d(CW * COLS, H);
    const draw = () => {
      ctx.fillStyle = '#777';
      ctx.fillRect(0, 0, CW * COLS, H);
      cells.forEach((paint, k) => paint(ctx, (k % COLS) * CW, Math.floor(k / COLS) * CH, CW, CH));
    };
    draw();
    this.texture = canvasTexture(canvas, true, 8);
    // redraw once the brand faces have loaded (the boot usually has them already)
    if (typeof document !== 'undefined' && document.fonts && !BRAND_FONTS.every((f) => document.fonts.check(f)))
      Promise.all(BRAND_FONTS.map((f) => document.fonts.load(f)))
        .then(() => {
          draw();
          this.texture.needsUpdate = true;
        })
        .catch(() => {});
  }
  /** [u0, v0, u1, v1] of cell k (inset against bleeding; v up: canvas row 0 is v = 1) */
  uv(k: number): [number, number, number, number] {
    const i = ((k % this.count) + this.count) % this.count;
    const W = CW * COLS, H = this.H;
    const x0 = (i % COLS) * CW + 3, x1 = x0 + CW - 6;
    const y0 = Math.floor(i / COLS) * CH + 3, y1 = y0 + CH - 6;
    return [x0 / W, 1 - y1 / H, x1 / W, 1 - y0 / H];
  }
}

export interface RunOpts {
  /** metres behind the barrier face (default 2.4) */
  back?: number;
  /** board width, height and the bottom edge's height above the ground */
  w?: number;
  h?: number;
  y?: number;
  /** gap between boards (m) */
  gap?: number;
  /** cells to cycle; each holds `repeat` boards in a row (a contract). LED runs: the reel slide each board starts on */
  cells: number[];
  repeat?: number;
  /** emissive LED boards instead of printed vinyl */
  led?: boolean;
  /** frame colour */
  frame?: number;
  /** s values to keep `avoidR` metres clear of (footbridge towers, the big corner billboards) */
  avoid?: number[];
  avoidR?: number;
}

/** a run of boards on one side of the track, from sA to sB (wrapping past s = 0 if sB < sA) */
export interface AdRun extends RunOpts {
  sA: number;
  sB: number;
  side: number;
}

/** a big billboard on legs (see VenueAds.billboard) */
export interface AdBoard {
  s: number;
  side: number;
  cell: number;
  w?: number;
  h?: number;
  y?: number;
  back?: number;
  toe?: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Keep the trees and shrubs off where the boards will stand: called from a venue's plan (before the
 * vegetation grows), with the same runs and billboards its scenery builds later.
 */
export function reserveAds(track: Track, map: WorldMap, runs: AdRun[], boards: AdBoard[] = []) {
  const p = new THREE.Vector3();
  for (const r of runs) {
    const back = r.back ?? 2.4;
    const total = track.wrap(r.sB - r.sA);
    for (let d = 2; d < total; d += 4) {
      const s = r.sA + d;
      track.point(s, r.side * (track.barrierAt(s, r.side) + back), 0, p);
      const f = track.frame(s);
      map.exclusions.push({ cx: p.x, cz: p.z, halfW: 2.6, halfL: 1.2, angle: Math.atan2(f.right.x, f.right.z) });
    }
  }
  for (const b of boards) {
    const s = b.s;
    track.point(s, b.side * (track.barrierAt(s, b.side) + (b.back ?? 4)), 0, p);
    const f = track.frame(s);
    map.exclusions.push({ cx: p.x, cz: p.z, halfW: (b.w ?? 14) / 2 + 1.5, halfL: 3, angle: Math.atan2(f.right.x, f.right.z) });
  }
}

/**
 * One venue's boards, merged: `frames` (posts, backs, cabinets: vertex colour), `prints` (vinyl),
 * `leds` (perimeter screens) and `paint` (run-off word marks).
 */
export class VenueAds {
  readonly frames = new MeshBuilder();
  readonly prints = new MeshBuilder();
  readonly leds = new MeshBuilder();
  readonly paint = new MeshBuilder();
  constructor(readonly track: Track, readonly map: WorldMap, readonly sheet: AdSheet, readonly stands: GrandstandSpec[] = [], readonly reel: LedReel | null = null) {}

  /** a spot clear of the pit complex, of every other part of the circuit and of the grandstands and their fronts */
  private clearAt(x: number, z: number, s: number, need: number): boolean {
    const t = this.track;
    if (this.map.inPitZone(x, z, 3)) return false;
    if (t.distanceToOther(x, z, Math.floor(t.wrap(s)), 150) < need + 16) return false;
    for (const g of this.stands) {
      const dx = x - g.center.x, dz = z - g.center.z;
      const across = dx * g.facing.x + dz * g.facing.z, along = -dx * g.facing.z + dz * g.facing.x;
      // (nor in the 2.5 m in front of a stand: its front rows look over the fence there)
      if (Math.abs(along) < g.length / 2 + need + 0.5 && across > -g.depth / 2 - 0.5 && across < g.depth / 2 + 2.5) return false;
    }
    return this.map.trackClearance(x, z) > 0.8;
  }

  /** an oriented box (centre, sizes along / up / across, yaw of `along`) */
  private obox(mb: MeshBuilder, c: THREE.Vector3, along: THREE.Vector3, sx: number, sy: number, sz: number, col: THREE.Color) {
    const m = new THREE.Matrix4().makeBasis(along, UP, new THREE.Vector3().crossVectors(along, UP)).scale(new THREE.Vector3(sx, sy, sz)).setPosition(c);
    mb.box(m, col);
  }

  /**
   * A run of boards from sA to sB (wrapping) on `side`, standing `back` metres behind the barrier
   * and facing the track. Each board spans ~w metres of the barrier line (it follows corners board
   * by board); boards that would stand on another part of the circuit, in the pit complex or
   * folded round a tight apex are left out.
   */
  run(o: AdRun): number {
    const t = this.track;
    const { sA, side } = o;
    const back = o.back ?? 2.4, W = o.w ?? 6, Hb = o.h ?? 1.2, Y = o.y ?? 0.3, gap = o.gap ?? 0.15;
    const rep = o.repeat ?? 3;
    const frameCol = srgb(o.frame ?? 0x2a2d31);
    const total = t.wrap(o.sB - sA);
    const at = (s: number) => t.point(s, side * (t.barrierAt(s, side) + back), 0, new THREE.Vector3());
    let s = sA, k = 0, built = 0;
    const end = sA + total;
    while (s < end - 1) {
      const P0 = at(s);
      let s1 = s + 0.5;
      let P1 = at(s1);
      while (s1 < end && Math.hypot(P1.x - P0.x, P1.z - P0.z) < W) {
        s1 += 0.5;
        P1 = at(s1);
      }
      if (s1 >= end) break;
      const idx = k++;
      const sm = (s + s1) / 2;
      const span = s1 - s;
      s = s1 + gap;
      // (folded round an apex: the chord no longer runs alongside the road)
      const Pm = at(sm);
      const chord = new THREE.Vector3(P1.x - P0.x, 0, P1.z - P0.z);
      const len = chord.length();
      chord.normalize();
      const mid = new THREE.Vector3((P0.x + P1.x) / 2, 0, (P0.z + P1.z) / 2);
      if (Math.hypot(Pm.x - mid.x, Pm.z - mid.z) > 0.6 || span > W * 2.5) continue;
      if (o.avoid?.some((a) => Math.abs(t.delta(a, sm)) < (o.avoidR ?? 10) + W / 2)) continue;
      if (!this.clearAt(mid.x, mid.z, sm, 0)) continue;
      // the face looks at the track
      const c = t.point(sm, 0, 0, new THREE.Vector3());
      const n = new THREE.Vector3().crossVectors(UP, chord);
      if (n.x * (c.x - mid.x) + n.z * (c.z - mid.z) < 0) n.negate();
      const right = new THREE.Vector3().crossVectors(UP, n); // the reader's right
      const g0 = this.map.height(P0.x, P0.z), g1 = this.map.height(P1.x, P1.z);
      const gy = Math.min(g0, g1);
      const y0 = gy + Y, y1 = y0 + Hb;
      const a = mid.clone().addScaledVector(right, -len / 2), b = mid.clone().addScaledVector(right, len / 2);
      const cell = o.cells[Math.floor(idx / rep) % o.cells.length];
      const uv = o.led && this.reel ? this.reel.uv(cell) : this.sheet.uv(cell);
      if (o.led) {
        // a black cabinet on the ground, the screen in its face
        this.obox(this.frames, mid.clone().addScaledVector(n, -0.22).setY((gy - 0.3 + y1 + 0.05) / 2), right, len, y1 + 0.35 - gy, 0.4, frameCol);
        const f = n.clone().multiplyScalar(-0.015);
        this.leds.quad4(a.clone().add(f).setY(y0), b.clone().add(f).setY(y0), b.clone().add(f).setY(y1), a.clone().add(f).setY(y1), new THREE.Color(1, 1, 1), uv);
      } else {
        // two posts, a thin backing sheet, the print on its face
        for (const e of [-0.42, 0.42]) {
          const p = mid.clone().addScaledVector(right, e * len).addScaledVector(n, -0.12);
          this.obox(this.frames, p.setY((gy - 0.4 + y1) / 2), right, 0.09, y1 + 0.4 - gy, 0.09, frameCol);
        }
        this.obox(this.frames, mid.clone().addScaledVector(n, -0.05).setY((y0 + y1) / 2), right, len, Hb + 0.06, 0.05, frameCol);
        const f = n.clone().multiplyScalar(-0.02);
        this.prints.quad4(a.clone().add(f).setY(y0), b.clone().add(f).setY(y0), b.clone().add(f).setY(y1), a.clone().add(f).setY(y1), new THREE.Color(1, 1, 1), uv);
      }
      built++;
    }
    return built;
  }

  /**
   * A big billboard on three legs at `s`, `back` metres behind the barrier on `side`, turned
   * `toe` radians toward the oncoming cars.
   */
  billboard(bb: AdBoard) {
    const t = this.track;
    const { s, side, cell } = bb;
    const W = bb.w ?? 14, Hb = bb.h ?? 3.5, Y = bb.y ?? 2.6, back = bb.back ?? 4, toe = bb.toe ?? 0.4;
    const q = t.point(s, side * (t.barrierAt(s, side) + back), 0, new THREE.Vector3());
    if (!this.clearAt(q.x, q.z, s, W / 2)) return;
    const f = t.frame(s);
    const tan = new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize();
    // facing: toward the track, swung toward oncoming traffic (−tangent)
    const n0 = new THREE.Vector3(-f.right.x * side, 0, -f.right.z * side).normalize();
    const n = n0.multiplyScalar(Math.cos(toe)).addScaledVector(tan, -Math.sin(toe)).normalize();
    const right = new THREE.Vector3().crossVectors(UP, n);
    const gy = this.map.height(q.x, q.z);
    const col = srgb(0x3a3d42);
    for (const e of [-0.36, 0, 0.36]) this.obox(this.frames, q.clone().addScaledVector(right, e * W).addScaledVector(n, -0.3).setY(gy + (Y + Hb) / 2 - 0.2), right, 0.22, Y + Hb + 0.4, 0.22, col);
    this.obox(this.frames, q.clone().addScaledVector(n, -0.15).setY(gy + Y + Hb / 2), right, W + 0.3, Hb + 0.3, 0.16, col);
    const a = q.clone().addScaledVector(right, -W / 2).addScaledVector(n, -0.06), b = q.clone().addScaledVector(right, W / 2).addScaledVector(n, -0.06);
    this.prints.quad4(a.clone().setY(gy + Y), b.clone().setY(gy + Y), b.clone().setY(gy + Y + Hb), a.clone().setY(gy + Y + Hb), new THREE.Color(1, 1, 1), this.sheet.uv(cell));
  }

  /**
   * The title partner's banner across the top of a sponsor footbridge (trackside/structures.ts
   * buildBridge: walkway at 6.4 m, a 2.2 m truss, 2.8 m deep): wrapped over the upper half of both
   * faces, above the partners' boards the bridge carries along its lower half, kept within the
   * barriers so it never overhangs the truss.
   */
  bridgeBanner(s: number, cell: number) {
    const t = this.track;
    const f = t.frame(s);
    const T = new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize();
    const R = new THREE.Vector3(f.right.x, 0, f.right.z).normalize();
    const o = t.point(s, 0, 0, new THREE.Vector3());
    const xl = -(t.barrierAt(s, -1) + 1.2), xr = t.barrierAt(s, 1) + 1.2;
    const y0 = o.y + 6.4 + 2.2 * 0.46, y1 = o.y + 6.4 + 2.2 - 0.06;
    // (4:1 pieces: the cells' own proportions, repeated across the span)
    const W = (y1 - y0) * 4;
    const nb = Math.max(1, Math.floor((xr - xl) / W));
    const w = (xr - xl) / nb;
    const P = (x: number, z: number, y: number) => o.clone().addScaledVector(R, x).addScaledVector(T, z).setY(y);
    const white = new THREE.Color(1, 1, 1);
    for (let k = 0; k < nb; k++) {
      const a = xl + k * w, b = a + w;
      const uv = this.sheet.uv(cell);
      // facing the oncoming cars (−T: their right is +R), and the back face (its reader's right is −R)
      this.prints.quad4(P(a, -1.72, y0), P(b, -1.72, y0), P(b, -1.72, y1), P(a, -1.72, y1), white, uv);
      this.prints.quad4(P(b, 1.72, y0), P(a, 1.72, y0), P(a, 1.72, y1), P(b, 1.72, y1), white, uv);
    }
    // the banner's frame rails
    for (const z of [-1.62, 1.62]) {
      this.obox(this.frames, P((xl + xr) / 2, z, y0 - 0.05), R, xr - xl, 0.1, 0.12, srgb(0x2a2d31));
    }
  }

  /**
   * A word mark painted on the asphalt run-off on `side`, centred at `s`, `len` metres along the
   * track and `wid` across, starting `inset` metres beyond the painted verge. Laid along the
   * direction of travel, its top toward the track (it reads from the camera on the outside).
   * Left out unless all of it lies on asphalt run-off.
   */
  runoff(s: number, side: number, cell: number, len = 24, wid = 6, inset = 2.5): boolean {
    const t = this.track;
    const kerb = Math.max(t.kerbAt(s - len / 2, side), t.kerbAt(s, side), t.kerbAt(s + len / 2, side));
    const near = Math.max(t.halfWidthAt(s - len / 2), t.halfWidthAt(s), t.halfWidthAt(s + len / 2)) + kerb + VERGE + inset;
    const far = near + wid;
    for (let u = -len / 2; u <= len / 2; u += len / 6)
      for (const l of [near, (near + far) / 2, far]) {
        if (t.surfaceAt(s + u, side * l) !== SURF.ASPHALT) return false;
        if (l > t.barrierAt(s + u, side) - 2 || t.inPit(s + u)) return false;
      }
    const [ua, v0, ub, v1] = this.sheet.uv(cell);
    // (seen from the outside the lettering runs along +s on the right of the track, −s on the left)
    const u0 = side > 0 ? ua : ub, u1 = side > 0 ? ub : ua;
    const NU = 8, NV = 2;
    const base = this.paint.vertexCount;
    const c = new THREE.Color(1, 1, 1);
    const p = new THREE.Vector3();
    for (let j = 0; j <= NV; j++)
      for (let i = 0; i <= NU; i++) {
        // v = 1 (the top of the lettering) on the edge nearest the road
        const l = far - (far - near) * (j / NV);
        t.point(s - len / 2 + (len * i) / NU, side * l, 0.03, p);
        this.paint.vertex(p.x, p.y, p.z, 0, 1, 0, c, 0, 0, u0 + ((u1 - u0) * i) / NU, v0 + ((v1 - v0) * j) / NV);
      }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i, b = a + 1, d = a + NU + 1, e = d + 1;
        // (wound to face up whichever side the lateral grows to)
        if (side > 0) this.paint.idx.push(a, b, e, a, e, d);
        else this.paint.idx.push(a, e, b, a, d, e);
      }
    return true;
  }

  /** the four meshes (empty ones left out) */
  meshes(name: string): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const tex = this.sheet.texture;
    const add = (mb: MeshBuilder, mat: THREE.Material, suffix: string, cast: boolean, order = 0) => {
      if (mb.vertexCount === 0) return;
      const m = new THREE.Mesh(mb.geometry(false), mat);
      m.name = `${name}_${suffix}`;
      m.castShadow = cast;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.renderOrder = order;
      out.push(m);
    };
    add(this.frames, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }), 'frames', true);
    add(this.prints, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), 'prints', false);
    add(this.leds, ledMaterial(this.reel?.texture ?? tex), 'leds', false);
    // (the LED boards roll through the venue's partners: ledReel.ts)
    const led = out.find((m) => m.name === `${name}_leds`);
    if (led && this.reel) this.reel.attach(led);
    add(this.paint, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), 'paint', false, 1);
    return out;
  }
}

/**
 * LED screens: self-lit like the big screens (grandstands.ts), a little brighter still once the
 * floodlights are on (env/night.ts)
 */
function ledMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.35, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 + 0.3 * smoothstep( 0.0, 0.5, uFlood.x );');
  };
  m.customProgramCacheKey = () => 'apex-venue-led';
  return m;
}
