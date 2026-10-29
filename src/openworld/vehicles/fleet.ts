import * as THREE from 'three';
import { loft, table, type Station } from './loft.ts';
import { mergeBasic } from './parts.ts';
import { latheX } from './loft.ts';
import { buildCar, carWheel, liveryTexture } from './carmodel.ts';
import { bodyMaterial, dentedMaterial, glassMaterial, seamsOf, DENT_ATTRS } from './bodyshader.ts';

/**
 * Miami's traffic, modelled from a loft, rounded (superellipse-ish
 * sections), as instanced fleets: every car of a model is one instance of four meshes (paint body
 * with dark trim in vertex colours, glass, lamps, wheels), so a hundred cars are a few dozen draws.
 * The paint colour is the instance colour; the lamps' instance colour carries headlight / brake
 * intensity (and a police bar's red and blue separately).
 *
 * Models: sedan, compact, SUV, luxury SUV (the boxy off-roader every Miami valet parks), pickup,
 * three sports cars (a coupe, a mid-engine supercar, a V8 muscle car), van, city bus, taxi, and
 * Miami PD's sedan and SUV.
 */

export type ModelId = 'sedan' | 'compact' | 'suv' | 'gwagon' | 'pickup' | 'coupe' | 'super' | 'muscle' | 'van' | 'bus' | 'cyber' | 'taxi' | 'police' | 'policeSuv';

export interface ModelSpec {
  id: ModelId;
  L: number;
  W: number;
  H: number;
  wb: number;
  wheelR: number;
  /** z of the windscreen base, roof front, roof back, rear glass foot (fraction of half length) */
  cowl: number;
  roofF: number;
  roofR: number;
  deck: number;
  hoodH: number;
  beltH: number;
  deckH: number;
  clear: number;
  /** squareness 0 (round) .. 1 (box) */
  box: number;
  tumble: number;
  mass: number;
  power: number;
}

export const MODELS: Record<ModelId, ModelSpec> = {
  sedan: { id: 'sedan', L: 4.85, W: 1.84, H: 1.45, wb: 2.83, wheelR: 0.33, cowl: 0.42, roofF: 0.12, roofR: -0.42, deck: -0.7, hoodH: 0.82, beltH: 0.96, deckH: 0.98, clear: 0.15, box: 0.3, tumble: 0.16, mass: 1550, power: 150000 },
  compact: { id: 'compact', L: 4.3, W: 1.78, H: 1.46, wb: 2.64, wheelR: 0.31, cowl: 0.4, roofF: 0.12, roofR: -0.58, deck: -0.92, hoodH: 0.8, beltH: 0.95, deckH: 1.0, clear: 0.15, box: 0.35, tumble: 0.15, mass: 1300, power: 110000 },
  suv: { id: 'suv', L: 4.95, W: 1.98, H: 1.78, wb: 2.95, wheelR: 0.38, cowl: 0.45, roofF: 0.2, roofR: -0.82, deck: -0.97, hoodH: 1.08, beltH: 1.18, deckH: 1.2, clear: 0.22, box: 0.55, tumble: 0.12, mass: 2100, power: 220000 },
  gwagon: { id: 'gwagon', L: 4.85, W: 1.98, H: 1.97, wb: 2.89, wheelR: 0.39, cowl: 0.42, roofF: 0.3, roofR: -0.9, deck: -0.97, hoodH: 1.16, beltH: 1.24, deckH: 1.3, clear: 0.24, box: 0.95, tumble: 0.02, mass: 2500, power: 310000 },
  pickup: { id: 'pickup', L: 5.9, W: 2.03, H: 1.95, wb: 3.68, wheelR: 0.42, cowl: 0.5, roofF: 0.3, roofR: -0.12, deck: -0.15, hoodH: 1.25, beltH: 1.33, deckH: 1.28, clear: 0.26, box: 0.75, tumble: 0.08, mass: 2400, power: 300000 },
  coupe: { id: 'coupe', L: 4.52, W: 1.9, H: 1.3, wb: 2.45, wheelR: 0.34, cowl: 0.32, roofF: 0.0, roofR: -0.4, deck: -0.78, hoodH: 0.76, beltH: 0.88, deckH: 0.86, clear: 0.12, box: 0.25, tumble: 0.2, mass: 1500, power: 330000 },
  super: { id: 'super', L: 4.62, W: 2.02, H: 1.14, wb: 2.7, wheelR: 0.36, cowl: 0.56, roofF: 0.14, roofR: -0.22, deck: -0.86, hoodH: 0.7, beltH: 0.8, deckH: 0.9, clear: 0.1, box: 0.18, tumble: 0.26, mass: 1450, power: 470000 },
  muscle: { id: 'muscle', L: 4.92, W: 1.96, H: 1.34, wb: 2.86, wheelR: 0.36, cowl: 0.2, roofF: -0.06, roofR: -0.46, deck: -0.84, hoodH: 0.93, beltH: 0.99, deckH: 0.98, clear: 0.13, box: 0.5, tumble: 0.17, mass: 1750, power: 360000 },
  van: { id: 'van', L: 5.9, W: 2.0, H: 2.55, wb: 3.66, wheelR: 0.36, cowl: 0.72, roofF: 0.6, roofR: -0.98, deck: -0.995, hoodH: 1.1, beltH: 1.2, deckH: 2.3, clear: 0.2, box: 0.8, tumble: 0.05, mass: 2600, power: 140000 },
  bus: { id: 'bus', L: 12.2, W: 2.55, H: 3.2, wb: 6.2, wheelR: 0.5, cowl: 0.985, roofF: 0.97, roofR: -0.985, deck: -0.995, hoodH: 0.9, beltH: 1.0, deckH: 3.0, clear: 0.3, box: 0.92, tumble: 0.02, mass: 12000, power: 220000 },
  cyber: { id: 'cyber', L: 5.68, W: 2.03, H: 1.79, wb: 3.81, wheelR: 0.42, cowl: 0.3, roofF: 0.06, roofR: -0.06, deck: -0.98, hoodH: 1.12, beltH: 1.18, deckH: 1.3, clear: 0.28, box: 1.0, tumble: 0.18, mass: 3100, power: 600000 },
  taxi: { id: 'taxi', L: 4.85, W: 1.84, H: 1.48, wb: 2.83, wheelR: 0.33, cowl: 0.42, roofF: 0.12, roofR: -0.42, deck: -0.7, hoodH: 0.82, beltH: 0.96, deckH: 0.98, clear: 0.15, box: 0.3, tumble: 0.16, mass: 1550, power: 150000 },
  police: { id: 'police', L: 5.1, W: 1.9, H: 1.48, wb: 3.05, wheelR: 0.35, cowl: 0.4, roofF: 0.1, roofR: -0.42, deck: -0.72, hoodH: 0.88, beltH: 1.0, deckH: 1.02, clear: 0.14, box: 0.4, tumble: 0.15, mass: 1900, power: 290000 },
  policeSuv: { id: 'policeSuv', L: 5.05, W: 2.0, H: 1.8, wb: 3.02, wheelR: 0.38, cowl: 0.45, roofF: 0.2, roofR: -0.82, deck: -0.97, hoodH: 1.08, beltH: 1.18, deckH: 1.2, clear: 0.22, box: 0.55, tumble: 0.12, mass: 2200, power: 300000 },
};

/** paint colours (linear-ish sRGB hex), weighted like Miami's streets: white, black, greys, then colour */
export const PAINTS = [
  0xf2f2f0, 0xf2f2f0, 0xeeeeea, 0x101114, 0x15161a, 0x8e9196, 0x6b6e73, 0xb9bcc0, 0x1e3a6e, 0x2b5ea8, 0x7a0f14, 0xb3121b, 0x1f3d2c, 0xd4c7a8, 0x4a2c5e,
  // (and Miami's own: flamingo, aqua, mint, sunshine, coral, lilac, lime)
  0xff4f97, 0x16c4d4, 0x7fe0b0, 0xf6c823, 0xff7656, 0xb48cff, 0x9be22a, 0x0f6f7a, 0xe86a1c, 0xff3f8e, 0x2fd3ff,
];

/** the sports cars wear the loud ones */
export const SPORT_PAINT = [0xff3f8e, 0x12c6d6, 0xff6a1a, 0x9be22a, 0x7b3cff, 0xc40d16, 0xe0b21d, 0xf1efe9, 0x0b0c0e, 0xffd400, 0x00b37a];

function sectionPts(halfW: number, y0: number, y1: number, box: number, n: number, bulge = 0): [number, number][] {
  // a quarter-superellipse from (halfW, y0) up to (?, y1) — used for flanks
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = y0 + (y1 - y0) * t;
    const s = Math.sin(t * Math.PI);
    pts.push([halfW + bulge * s * (1 - box * 0.6), y]);
  }
  return pts;
}

/** body + glass geometry of a model, with vertex colours (white = paint, dark = trim, chrome) */
export function buildBody(m: ModelSpec): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; heads: THREE.BufferGeometry; tails: THREE.BufferGeometry } {
  const hl = m.L / 2, hw = m.W / 2;
  const cowl = m.cowl * hl, roofF = m.roofF * hl, roofR = m.roofR * hl, deck = m.deck * hl;
  const round = 1 - m.box;
  // plan view: nose and tail rounding
  const widthAt = table([
    [hl, hw * (0.72 + 0.2 * m.box)],
    [hl - 0.12 - round * 0.15, hw * 0.97],
    [hl - 0.5, hw],
    [-hl + 0.5, hw],
    [-hl + 0.12 + round * 0.12, hw * 0.97],
    [-hl, hw * (0.78 + 0.18 * m.box)],
  ]);
  const clear = m.clear;
  const bottomAt = table([
    [hl, clear + 0.15],
    [hl - 0.4, clear],
    [-hl + 0.45, clear],
    [-hl, clear + 0.18],
  ]);
  const beltAt = table([
    [hl, m.hoodH - 0.08 - round * 0.12],
    [hl - 0.35, m.hoodH],
    [cowl, m.beltH - 0.02],
    [deck, m.beltH],
    [-hl + 0.3, m.deckH],
    [-hl, m.deckH - 0.06 - round * 0.1],
  ]);
  // the top: hood → windscreen → roof → rear glass → deck
  const topAt = table(
    m.id === 'pickup'
      ? [
          [hl, m.hoodH],
          [cowl, m.hoodH + 0.06],
          [roofF, m.H],
          [roofR, m.H],
          [roofR - 0.05, m.beltH + 0.02],
          [-hl, m.beltH + 0.02],
        ]
      : m.id === 'cyber'
        ? [
            [hl, m.hoodH - 0.04],
            [cowl, m.hoodH + 0.08],
            [0.05, m.H],
            [-hl, m.deckH],
          ]
        : [
            [hl, m.hoodH - 0.04],
            [hl - 0.5, m.hoodH + 0.02],
            [cowl, m.hoodH + 0.08],
            [roofF, m.H],
            [roofR, m.H - 0.02],
            [deck, m.deckH + 0.04],
            [-hl + 0.3, m.deckH + 0.02],
            [-hl, m.deckH - 0.04],
          ],
  );
  const inGlassZ = (z: number) => z < cowl && z > (m.id === 'pickup' ? roofR - 0.05 : deck);
  const stations: Station[] = [];
  const nZ = m.id === 'bus' ? 40 : 46;
  for (let k = 0; k <= nZ; k++) {
    const z = hl - (k / nZ) * m.L;
    const w = widthAt(z);
    const yb = bottomAt(z), ybelt = Math.min(beltAt(z), topAt(z) - 0.01);
    const ytop = Math.max(topAt(z), ybelt + 0.01);
    const gh = inGlassZ(z) ? 1 : 0;
    const roofW = w * (1 - m.tumble) * (gh ? 1 : 0.94);
    const sideBulge = 0.03 * round;
    stations.push({
      z,
      bands: [
        { pts: [[0, yb], [w * 0.9, yb]] },
        { pts: [[w * 0.9, yb], [w, yb + 0.12], [w, Math.min(ybelt - 0.02, yb + 0.35)]] },
        { pts: sectionPts(w, Math.min(ybelt - 0.02, yb + 0.35), ybelt, m.box, 4, sideBulge) },
        { pts: [[w, ybelt], [THREE.MathUtils.lerp(w, roofW, 0.5) + 0.02 * round, (ybelt + ytop) / 2 + (gh ? 0 : 0.0)], [roofW, ytop - 0.03 * round]] },
        { pts: [[roofW, ytop - 0.03 * round], [roofW * 0.5, ytop], [0, ytop + 0.01 * round]] },
      ],
    });
  }
  const isRoof = (z: number) => z <= roofF + 0.02 && z >= roofR - 0.02;
  const L0 = loft({
    stations,
    slot(b, z, y) {
      if (b === 0) return 'trim';
      if (b === 1) return 'lower';
      if (b === 3 && inGlassZ(z) && y > Math.min(beltAt(z), topAt(z)) + 0.04) return 'glass';
      if (b === 4 && inGlassZ(z) && !isRoof(z)) return 'glass';
      return 'paint';
    },
    capFront: 'paint',
    capRear: 'paint',
  });
  const color = (g: THREE.BufferGeometry, c: [number, number, number]) => {
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const bodyParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  for (const [k, g] of L0.slots) {
    if (k === 'glass') glassParts.push(g);
    else if (k === 'trim' || (k === 'lower' && (m.id === 'suv' || m.id === 'policeSuv' || m.id === 'pickup' || m.id === 'van'))) bodyParts.push(color(g, k === 'trim' ? [0.03, 0.03, 0.03] : [0.05, 0.05, 0.055]));
    else bodyParts.push(color(g, [1, 1, 1]));
  }
  // details: mirrors, door handles' strip, bumpers, grille, roof bars on SUVs, the bed of a pickup
  const extra: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
    const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    b.translate(x, y, z);
    extra.push(color(b, c));
  };
  const dark: [number, number, number] = [0.025, 0.025, 0.028];
  for (const sg of [1, -1]) box(0.16, 0.1, 0.18, sg * (hw + 0.06), m.beltH + 0.12, cowl - 0.05, [1, 1, 1]);
  // grille and the front / rear bumper bands
  box(hw * 1.2, (m.hoodH - m.clear) * 0.35, 0.04, 0, m.clear + (m.hoodH - m.clear) * 0.45, hl - 0.02, dark);
  box(hw * 1.9, 0.08, 0.06, 0, m.clear + 0.18, hl - 0.04, dark);
  box(hw * 1.9, 0.08, 0.06, 0, m.clear + 0.2, -hl + 0.04, dark);
  if (m.id === 'suv' || m.id === 'gwagon' || m.id === 'policeSuv') for (const sg of [1, -1]) box(0.05, 0.05, Math.abs(roofF - roofR) * 0.9, sg * hw * 0.62, m.H + 0.04, (roofF + roofR) / 2, dark);
  if (m.id === 'gwagon') {
    // the spare wheel on the tailgate
    const sp = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 18).toNonIndexed();
    sp.rotateX(Math.PI / 2);
    sp.translate(0, 1.0, -hl - 0.12);
    extra.push(color(sp, [0.04, 0.04, 0.045]));
  }
  if (m.id === 'pickup') {
    // the bed walls
    for (const sg of [1, -1]) box(0.06, 0.5, -roofR - 0.2 + hl - 0.1, sg * (hw - 0.05), m.beltH - 0.2, (roofR - 0.2 - hl) / 2 + 0.05, [1, 1, 1]);
    box(hw * 2 - 0.1, 0.5, 0.06, 0, m.beltH - 0.2, -hl + 0.05, [1, 1, 1]);
  }
  if (m.id === 'taxi') box(0.6, 0.18, 0.28, 0, m.H + 0.1, (roofF + roofR) / 2, [1, 0.85, 0.2]);
  if (m.id === 'bus') {
    // the windows are a band down both sides: dark glass strip, a destination sign
    for (const sg of [1, -1]) {
      const g = new THREE.BoxGeometry(0.02, 1.05, m.L - 2.2).toNonIndexed();
      g.translate(sg * (hw + 0.005), 2.15, -0.5);
      glassParts.push(g);
    }
    const ws = new THREE.BoxGeometry(hw * 1.8, 1.4, 0.02).toNonIndexed();
    ws.translate(0, 2.0, hl + 0.005);
    glassParts.push(ws);
  }
  const body = mergeBasicColored([...bodyParts, ...extra]);
  const glass = mergeBasic(glassParts.map((g) => (g.index ? g : g)));
  // lamps: headlights (white) in one mesh; taillights (red) and a police bar (red / blue halves) in
  // another — each mesh's instance colour drives its intensity (r = tail/brake/red bar, b = blue bar)
  const headParts: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];
  const lamp = (to: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
    const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    b.translate(x, y, z);
    to.push(color(b, c));
  };
  const lightH = Math.min(m.hoodH - 0.12, m.clear + 0.55);
  for (const sg of [1, -1]) {
    lamp(headParts, m.box > 0.9 ? 0.2 : 0.34, m.box > 0.9 ? 0.2 : 0.09, 0.04, sg * hw * 0.7, lightH, hl - 0.05 - round * 0.05, [1, 0.97, 0.9]);
    lamp(tailParts, m.id === 'bus' ? 0.2 : 0.36, m.id === 'van' || m.id === 'bus' ? 0.4 : 0.1, 0.04, sg * hw * 0.72, Math.max(m.deckH - 0.12, m.clear + 0.5), -hl + 0.03, [0.9, 0.0, 0.0]);
  }
  if (m.id === 'police' || m.id === 'policeSuv') {
    lamp(tailParts, 0.55, 0.11, 0.3, 0.3, m.H + 0.09, (roofF + roofR) / 2 + 0.1, [1, 0, 0]);
    lamp(tailParts, 0.55, 0.11, 0.3, -0.3, m.H + 0.09, (roofF + roofR) / 2 + 0.1, [0, 0, 1]);
  }
  return { body, glass, heads: mergeBasicColored(headParts), tails: mergeBasicColored(tailParts) };
}

function mergeBasicColored(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let base = 0;
  for (let g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
    void g;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** a traffic wheel in one mesh: tyre (dark) and rim (silver) in vertex colours; axis = x */
export function wheelGeometry(R: number, W: number, style: 'alloy' | 'steel' | 'black'): THREE.BufferGeometry {
  const r = R * 0.68;
  const tyre = latheX(
    [
      [r, -W / 2 + 0.02],
      [R - 0.04, -W / 2],
      [R, -W / 2 + 0.04],
      [R, W / 2 - 0.04],
      [R - 0.04, W / 2],
      [r, W / 2 - 0.02],
    ],
    24,
  );
  const tc = new Float32Array(tyre.getAttribute('position').count * 3).fill(0.035);
  tyre.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const rimC = style === 'black' ? 0.06 : style === 'steel' ? 0.35 : 0.62;
  const face = new THREE.CylinderGeometry(r, r * 0.96, 0.04, 20, 1);
  face.rotateZ(Math.PI / 2);
  face.translate(W / 2 - 0.05, 0, 0);
  const fc = new Float32Array(face.getAttribute('position').count * 3).fill(rimC);
  face.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  const parts: THREE.BufferGeometry[] = [tyre, face];
  // spokes: dark gaps painted as thin dark boxes over the face
  for (let i = 0; i < 5; i++) {
    const b = new THREE.BoxGeometry(0.02, r * 0.7, 0.05).toNonIndexed();
    b.translate(0, r * 0.55, 0);
    b.rotateX((i / 5) * Math.PI * 2 + 0.3);
    b.translate(W / 2 - 0.02, 0, 0);
    b.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.getAttribute('position').count * 3).fill(0.04), 3));
    parts.push(b);
  }
  return mergeBasicColored(parts);
}

// ------------------------------------------------------------------------------ the instanced fleet

export interface FleetSlot {
  model: ModelId;
  index: number;
}

export class Fleet {
  readonly group = new THREE.Group();
  private readonly kinds = new Map<ModelId, Kind>();
  private readonly m4 = new THREE.Matrix4();
  private readonly m5 = new THREE.Matrix4();
  private readonly mc = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qw = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(caps: Partial<Record<ModelId, number>>) {
    this.group.name = 'Fleet';
    const paint = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
    const chrome = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.92, roughness: 0.22, clearcoat: 0.6 });
    // (Miami tint: dark, the cabin a shadow behind it head-on, a mirror at a glance)
    const glass = glassMaterial(new THREE.MeshPhysicalMaterial({ color: 0x10161a, metalness: 0.1, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: 0.84, envMapIntensity: 1.8 }));
    const decalMats: Partial<Record<'police' | 'taxi', THREE.MeshStandardMaterial>> = {};
    const lamp = dentedMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }), true);
    const wheel = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.42 });
    for (const [id, cap] of Object.entries(caps) as [ModelId, number][]) {
      if (!cap) continue;
      const spec = MODELS[id];
      const g = buildCar(spec);
      // the dents: four per car, shared by the body and its glass
      const dents = DENT_ATTRS.map(() => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      DENT_ATTRS.forEach((k, i) => {
        for (const geo of [g.body, g.glass, g.heads, g.tails, g.decal]) geo?.setAttribute(k, dents[i]);
      });
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cast: boolean) => {
        const im = new THREE.InstancedMesh(geo, mat, n);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < n; i++) im.setMatrixAt(i, this.zero);
        im.castShadow = cast;
        im.receiveShadow = true;
        im.frustumCulled = false;
        this.group.add(im);
        return im;
      };
      const body = mk(g.body, bodyMaterial(id === 'cyber' ? chrome : paint, seamsOf(spec)), cap, true);
      for (let i = 0; i < cap; i++) body.setColorAt(i, new THREE.Color(1, 1, 1));
      const heads = mk(g.heads, lamp, cap, false);
      const tails = mk(g.tails, lamp, cap, false);
      for (let i = 0; i < cap; i++) {
        heads.setColorAt(i, new THREE.Color(1, 1, 1));
        tails.setColorAt(i, new THREE.Color(1, 1, 1));
      }
      const wheels = mk(carWheel(spec.wheelR, spec.id === 'bus' ? 0.32 : spec.id === 'pickup' || spec.id === 'gwagon' ? 0.28 : spec.id === 'super' || spec.id === 'muscle' ? 0.3 : 0.24, id === 'gwagon' || id === 'police' || id === 'policeSuv' ? 'black' : id === 'van' || id === 'bus' ? 'steel' : 'alloy'), wheel, cap * 4, false);
      let decal: THREE.InstancedMesh | null = null;
      if (g.decal) {
        const kind = id === 'taxi' ? 'taxi' : 'police';
        const dm = (decalMats[kind] ??= dentedMaterial(new THREE.MeshStandardMaterial({ map: liveryTexture(kind), transparent: true, roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }), false));
        decal = mk(g.decal, dm, cap, false);
      }
      this.kinds.set(id, { spec, body, glass: mk(g.glass, glass, cap, false), heads, tails, wheels, decal, dents, free: Array.from({ length: cap }, (_, i) => cap - 1 - i), cap, used: new Set<number>() });
    }
  }

  spec(id: ModelId) {
    return MODELS[id];
  }

  alloc(id: ModelId, paint: THREE.ColorRepresentation): FleetSlot | null {
    const k = this.kinds.get(id);
    if (!k || !k.free.length) return null;
    // (the lowest free slot: the drawn range stays short)
    k.free.sort((a, b) => b - a);
    const index = k.free.pop()!;
    k.used.add(index);
    this.dirty(k);
    k.body.setColorAt(index, new THREE.Color(paint));
    k.body.instanceColor!.needsUpdate = true;
    this.dent({ model: id, index }, null);
    return { model: id, index };
  }

  /** a car's crash damage (CarBody.dents: [x, y, z, depth] × 4), or none */
  dent(s: FleetSlot, d: ArrayLike<number> | null) {
    const k = this.kinds.get(s.model)!;
    for (let i = 0; i < 4; i++) {
      const a = k.dents[i];
      a.setXYZW(s.index, d ? d[i * 4] : 0, d ? d[i * 4 + 1] : 0, d ? d[i * 4 + 2] : 0, d ? d[i * 4 + 3] : 0);
      a.needsUpdate = true;
    }
  }

  /** repaint a car (a burnt-out wreck goes black) */
  paint(s: FleetSlot, color: THREE.ColorRepresentation) {
    const k = this.kinds.get(s.model)!;
    k.body.setColorAt(s.index, C.set(color));
    k.body.instanceColor!.needsUpdate = true;
  }

  free(s: FleetSlot) {
    const k = this.kinds.get(s.model)!;
    k.body.setMatrixAt(s.index, this.zero);
    k.glass.setMatrixAt(s.index, this.zero);
    k.heads.setMatrixAt(s.index, this.zero);
    k.tails.setMatrixAt(s.index, this.zero);
    k.decal?.setMatrixAt(s.index, this.zero);
    for (let w = 0; w < 4; w++) k.wheels.setMatrixAt(s.index * 4 + w, this.zero);
    k.free.push(s.index);
    k.used.delete(s.index);
    this.dirty(k);
  }

  available(id: ModelId) {
    return this.kinds.get(id)?.free.length ?? 0;
  }

  private dirtySet = new Set<Kind>();
  private dirty(k: Kind) {
    this.dirtySet.add(k);
  }

  /**
   * Place a car: position (ground under its middle), heading, the chassis's pitch/roll (the ground
   * it sits on, or how it lies), front steer, wheel spin angle; lamps: head (0..1), brake (0..1),
   * police red / blue (0..1 each); the body on its springs (pitch, roll, heave) and each wheel's
   * height (0 FL, 1 FR, 2 RL, 3 RR: over a curb, hanging under a lifted body).
   */
  set(s: FleetSlot, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, steer: number, spin: number, head: number, brake: number, red = 0, blue = 0, bp = 0, br = 0, hv = 0, drop: readonly number[] | null = null) {
    const k = this.kinds.get(s.model)!;
    const sp = k.spec;
    this.q.setFromEuler(E.set(pitch, yaw, roll, 'YXZ'));
    this.v.set(x, y, z);
    // the chassis (the wheels hang off it), then the sprung body over it
    this.mc.compose(this.v, this.q, this.one);
    if (bp || br || hv) {
      this.qw.setFromEuler(E.set(bp, 0, br, 'YXZ'));
      this.m4.compose(this.v.set(0, hv, 0), this.qw, this.one).premultiply(this.mc);
    } else this.m4.copy(this.mc);
    k.body.setMatrixAt(s.index, this.m4);
    k.glass.setMatrixAt(s.index, this.m4);
    k.heads.setMatrixAt(s.index, this.m4);
    k.tails.setMatrixAt(s.index, this.m4);
    k.decal?.setMatrixAt(s.index, this.m4);
    const police = sp.id === 'police' || sp.id === 'policeSuv';
    const hk = 0.3 + head * 3.5;
    const bk = 0.45 + brake * 5 + head * 1.0;
    k.heads.setColorAt(s.index, C.setRGB(hk, hk, hk));
    k.tails.setColorAt(s.index, C.setRGB(police ? Math.max(bk, 0.2 + red * 9) : bk, 0, police ? 0.2 + blue * 9 : 0));
    const hl = sp.wb / 2, tw = sp.W / 2 - 0.12;
    for (let w = 0; w < 4; w++) {
      const front = w < 2, left = w % 2 === 0;
      const lx = (left ? 1 : -1) * tw, lz = front ? hl : -hl;
      this.qw.setFromEuler(E.set(spin, front ? steer : 0, 0, 'YXZ'));
      this.m5.compose(this.v.set(lx, sp.wheelR + (drop ? drop[w] : 0), lz), this.qw, left ? this.one : NEG_X);
      this.m5.premultiply(this.mc);
      k.wheels.setMatrixAt(s.index * 4 + w, this.m5);
    }
    this.dirty(k);
  }

  /** upload this frame's changes */
  flush() {
    for (const k of this.dirtySet) {
      // draw only up to the highest slot in use (hidden slots still cost vertex work)
      let n = 0;
      for (const i of k.used) n = Math.max(n, i + 1);
      for (const im of [k.body, k.glass, k.heads, k.tails, k.decal]) if (im) im.count = n;
      k.wheels.count = n * 4;
      k.body.instanceMatrix.needsUpdate = true;
      k.glass.instanceMatrix.needsUpdate = true;
      k.heads.instanceMatrix.needsUpdate = true;
      k.tails.instanceMatrix.needsUpdate = true;
      if (k.decal) k.decal.instanceMatrix.needsUpdate = true;
      if (k.heads.instanceColor) k.heads.instanceColor.needsUpdate = true;
      if (k.tails.instanceColor) k.tails.instanceColor.needsUpdate = true;
      k.wheels.instanceMatrix.needsUpdate = true;
    }
    this.dirtySet.clear();
  }
}

interface Kind {
  spec: ModelSpec;
  body: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  tails: THREE.InstancedMesh;
  wheels: THREE.InstancedMesh;
  decal: THREE.InstancedMesh | null;
  dents: THREE.InstancedBufferAttribute[];
  free: number[];
  cap: number;
  used: Set<number>;
}

const E = new THREE.Euler();
const C = new THREE.Color();
const NEG_X = new THREE.Vector3(-1, 1, 1);
