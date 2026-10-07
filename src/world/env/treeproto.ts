import * as THREE from 'three';

/**
 * The tree prototypes: real scanned trees (Poly Haven, CC0), baked offline by tools/bake_trees.mjs
 * (src/dev/treebake.ts) into public/trees/ — nothing about a tree is generated at run time any more.
 *
 *   jacaranda  Jacaranda — a wide, feathery, open crown          (park broadleaf: plane / oak / chestnut)
 *   dome       a low dome on a stout, twisted bole               (oak / chestnut)
 *   gnarl      a gnarled old broadleaf, irregular crown          (oak / plane)
 *   umbrella   Burkea africana — a flat umbrella crown           (ghaf, acacia, mesquite, gums, tipuana)
 *   poplar     the dome drawn in to a column                     (Lombardy poplar rows)
 *   spruce_a   a young fir, branches to the ground               (spruce plantations, woodland edges)
 *   fir_a…c    three tall firs                                  (the Ardennes / Styria / Suzuka conifers)
 *   shrub_a…c  Searsia bushes                                    (hazel / bramble understorey, desert scrub)
 *
 * What the bake made of each scan (≈ 4 MB in all, fetched once at start-up, cached by the browser):
 *   - two near LODs: the scan's trunk + limbs decimated (meshoptimizer), the bark albedo in the
 *     vertex colour, and hundreds of leaf cards — one per k-means cell of the scan's real leaves (a
 *     branch tip, a stretch of fir bough), lying in the cell's own plane along its own axis, textured
 *     with real sprays of the same tree's leaves (leaf_c / leaf_n);
 *   - 8 impostor frames around the full-resolution tree (imp_c: albedo + coverage, imp_n: normal +
 *     crown AO) for everything beyond the 3D range.
 *
 * Vertex layout (shared by every prototype so they batch together):
 *   position   wood: the vertex; card: the card's centre (all four corners)
 *   normal     wood: the normal; card: the card plane's normal e3 (the side its leaves face)
 *   uv         bark tile / leaf atlas
 *   color      wood: linear bark albedo; card: the lighting normal (the crown's surface there)
 *   aTree      (trunk bend weight, kind (1 = leaf card, 0 = wood), crown AO, limb phase)
 *   aCard      (corner offset across, corner offset along the card (m; 0, 0 for wood), limb sway
 *              weight, billboard amount: how far the card turns about its axis toward the camera)
 *   aAxis      card: (axis e1 — along the spray toward its tip, tint); wood: 0
 *   aLod       which LOD the geometry is (0 … 2): the shader dithers neighbouring LODs into each
 *              other over a short band instead of swapping them in one frame
 * The vertex shader (treematerial.ts) builds each card's corners from these for whatever camera is
 * drawing (the sun's in the shadow pass) and moves wood and leaves with the same wind weights.
 */

export type SpeciesId = 'plane' | 'oak' | 'chestnut' | 'poplar' | 'shrub' | 'spruce' | 'umbrella';

/** the baked prototypes, in the bake's order (tools/bake_trees.mjs SPECS); the static numbers are
 *  the manifest's, so trees can be placed (and their shade cast) before the files have arrived */
export const PROTO_INFO = [
  { id: 'jacaranda', crownR: 11.8, height: 21 },
  { id: 'dome', crownR: 10.7, height: 17 },
  { id: 'gnarl', crownR: 9.1, height: 18 },
  { id: 'umbrella', crownR: 4.4, height: 11 },
  { id: 'poplar', crownR: 4.9, height: 26 },
  { id: 'spruce_a', crownR: 5.6, height: 24 },
  { id: 'fir_a', crownR: 4.8, height: 28 },
  { id: 'fir_b', crownR: 5.2, height: 25 },
  { id: 'fir_c', crownR: 4.6, height: 22 },
  { id: 'shrub_a', crownR: 1.3, height: 3.4 },
  { id: 'shrub_b', crownR: 1.1, height: 2.9 },
  { id: 'shrub_c', crownR: 1.0, height: 2.5 },
] as const;
const ID = (id: (typeof PROTO_INFO)[number]['id']) => PROTO_INFO.findIndex((p) => p.id === id);

/** which prototypes stand in for each species (repeats weight the pick) */
export const SPECIES_PROTOS: Record<SpeciesId, number[]> = {
  plane: [ID('jacaranda'), ID('jacaranda'), ID('gnarl'), ID('dome')],
  oak: [ID('gnarl'), ID('gnarl'), ID('dome'), ID('jacaranda')],
  chestnut: [ID('dome'), ID('dome'), ID('jacaranda'), ID('gnarl')],
  poplar: [ID('poplar')],
  shrub: [ID('shrub_a'), ID('shrub_b'), ID('shrub_c')],
  // (the young fir keeps its branches to the ground: the dense dark wall of an Ardennes plantation edge)
  spruce: [ID('spruce_a'), ID('spruce_a'), ID('fir_a'), ID('spruce_a'), ID('fir_b'), ID('fir_c')],
  umbrella: [ID('umbrella')],
};

export interface TreeProto {
  index: number;
  id: string;
  lods: THREE.BufferGeometry[];
  height: number;
  /** max horizontal extent from the trunk */
  radius: number;
  crownR: number;
  crownY: number;
  /** impostor card width and height (m) */
  W: number;
  Hc: number;
}

export interface TreeKit {
  /** false until the baked files have arrived (protos empty, textures blank) */
  ready: boolean;
  protos: TreeProto[];
  leafMap: THREE.Texture;
  leafNormal: THREE.Texture;
  bark: THREE.Texture;
  /** impostor frames: albedo + coverage, normal + AO; `frames` around, one row per prototype */
  impC: THREE.Texture;
  impN: THREE.Texture;
  frames: number;
  /** impostor atlas row of each prototype, and the number of rows */
  impRow: number[];
  impRows: number;
  /** leaf atlas size in texels (mip selection in the card shader) */
  leafSize: THREE.Vector2;
  /** leaf atlas cells (columns, rows): the card shader fades each spray out at its cell's rim */
  leafGrid: THREE.Vector2;
  timings: Record<string, number>;
}

interface Manifest {
  version: number;
  impostor: { frames: number; rows: number; cell: number };
  leaf: { cols: number; rows: number; cell: number };
  protos: { id: string; height: number; radius: number; crownR: number; crownY: number; W: number; Hc: number; lods: { v: number; i: number; cards: number; off: number; bytes: number }[] }[];
}

const blank = (srgb: boolean) => {
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
};

const kit: TreeKit = {
  ready: false,
  protos: [],
  leafMap: blank(true),
  leafNormal: blank(false),
  bark: blank(false),
  impC: blank(true),
  impN: blank(false),
  frames: 8,
  impRow: [],
  impRows: 1,
  leafSize: new THREE.Vector2(2048, 2048),
  leafGrid: new THREE.Vector2(8, 8),
  timings: {},
};

/**
 * decode one near LOD (tools/bake_trees.mjs → treebake.ts packLod): V wood vertices + I indices,
 * then K leaf cards, each expanded here into its four corners
 */
function decodeLod(buf: ArrayBuffer, off: number, V: number, I: number, K: number, cols: number, rows: number, lod: number): THREE.BufferGeometry {
  const dv = new DataView(buf, off);
  const NV = V + K * 4, NI = I + K * 6;
  const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), col = new Float32Array(NV * 3);
  const tree = new Float32Array(NV * 4), card = new Float32Array(NV * 4), axis = new Float32Array(NV * 4);
  const idx = NV > 65535 ? new Uint32Array(NI) : new Uint16Array(NI);
  let o = 0;
  const f = () => ((o += 4), dv.getFloat32(o - 4, true));
  const i8 = () => dv.getInt8(o++) / 127;
  const u8 = () => dv.getUint8(o++) / 255;
  const u16 = () => ((o += 2), dv.getUint16(o - 2, true));
  for (let i = 0; i < V; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = f();
    for (let k = 0; k < 3; k++) nor[i * 3 + k] = i8();
    o++;
    uv[i * 2] = f();
    uv[i * 2 + 1] = f();
    for (let k = 0; k < 3; k++) col[i * 3 + k] = u8();
    o++;
    const trunkW = u8() * 1.5, limbW = u8() * 1.5, ao = u8(), ph = u8() * Math.PI * 2;
    tree.set([trunkW, 0, ao, ph], i * 4);
    card.set([0, 0, limbW, 0], i * 4);
  }
  for (let i = 0; i < I; i++) idx[i] = u16();
  o = V * 32 + Math.ceil((I * 2) / 4) * 4;
  const CORNER = [0, 0, 1, 0, 1, 1, 0, 1];
  for (let k = 0; k < K; k++) {
    const cx = f(), cy = f(), cz = f();
    const e1 = [i8(), i8(), i8()];
    o++;
    const e3 = [i8(), i8(), i8()];
    o++;
    const ln = [i8(), i8(), i8()];
    o++;
    const wd = u16() / 1000, ln2 = u16() / 1000;
    const cell = dv.getUint8(o++);
    const tint = u8() + 0.5, ao = u8(), trunkW = u8() * 1.5, limbW = u8() * 1.5, ph = u8() * Math.PI * 2, bb = u8();
    o++;
    // (the atlas is decoded flipped: v = 0 is the bottom row)
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows;
    for (let c = 0; c < 4; c++) {
      const a = CORNER[c * 2], b = CORNER[c * 2 + 1];
      const vi = V + k * 4 + c;
      pos.set([cx, cy, cz], vi * 3);
      nor.set(e3, vi * 3);
      col.set(ln, vi * 3);
      uv.set([u0 + (a * 0.996 + 0.002) / cols, v0 + (b * 0.996 + 0.002) / rows], vi * 2);
      tree.set([trunkW, 1, ao, ph], vi * 4);
      card.set([(a - 0.5) * wd, (b - 0.5) * ln2, limbW, bb], vi * 4);
      axis.set([e1[0], e1[1], e1[2], tint], vi * 4);
    }
    const b0 = V + k * 4;
    idx.set([b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3], I + k * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTree', new THREE.BufferAttribute(tree, 4));
  g.setAttribute('aCard', new THREE.BufferAttribute(card, 4));
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 4));
  g.setAttribute('aLod', new THREE.BufferAttribute(new Float32Array(NV).fill(lod), 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  // (the cards are spread in the vertex shader: grow the bounds by the largest card, and the crown's
  // sway in a gale — a crown sticking out past its sphere is culled while still on screen, and pops
  // in at the frame's edge as the car turns toward it)
  g.boundingSphere!.radius += 3.5;
  return g;
}

const BASE = `${import.meta.env.BASE_URL}trees/`;

/** fetch + decode an image off the main thread, GL orientation (v = 0 at the bottom row) */
async function bitmap(file: string): Promise<ImageBitmap> {
  const r = await fetch(BASE + file);
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return createImageBitmap(await r.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function fill(t: THREE.Texture, bmp: ImageBitmap, wrap: boolean, aniso = 4) {
  t.image = bmp;
  t.flipY = false;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
}

let loading: Promise<TreeKit> | null = null;
const waiters: (() => void)[] = [];

/**
 * Start (once) fetching the baked trees; resolves with the kit when everything has arrived.
 * Called at module load, so the download overlaps the rest of the boot.
 */
export function loadTreeKit(): Promise<TreeKit> {
  return (loading ??= (async () => {
    const t0 = performance.now();
    try {
      const [man, bin, ic, inn, lc, ln, bk] = await Promise.all([
        fetch(BASE + 'trees.json').then((r) => r.json() as Promise<Manifest>),
        fetch(BASE + 'trees.bin').then((r) => r.arrayBuffer()),
        bitmap('imp_c.webp'),
        bitmap('imp_n.webp'),
        bitmap('leaf_c.webp'),
        bitmap('leaf_n.webp'),
        bitmap('bark.webp'),
      ]);
      const t1 = performance.now();
      const protos: TreeProto[] = [];
      PROTO_INFO.forEach((info, index) => {
        const p = man.protos.find((q) => q.id === info.id);
        if (!p) throw new Error(`trees.json has no ${info.id}`);
        if (man.version !== 2) throw new Error(`trees.json is version ${man.version}, expected 2`);
        protos.push({ index, id: p.id, lods: p.lods.map((l, li) => decodeLod(bin, l.off, l.v, l.i, l.cards, man.leaf.cols, man.leaf.rows, li)), height: p.height, radius: p.radius, crownR: p.crownR, crownY: p.crownY, W: p.W, Hc: p.Hc });
      });
      const rowOf = new Map(man.protos.map((p, i) => [p.id, i] as const));
      // (the impostor rows follow the manifest; the shader indexes by prototype)
      kit.protos = protos;
      kit.impRow = protos.map((p) => rowOf.get(p.id)!);
      kit.impRows = man.impostor.rows;
      kit.frames = man.impostor.frames;
      fill(kit.impC, ic, false);
      fill(kit.impN, inn, false);
      fill(kit.leafMap, lc, false);
      fill(kit.leafNormal, ln, false);
      fill(kit.bark, bk, true, 8);
      kit.leafSize.set(lc.width, lc.height);
      kit.leafGrid.set(man.leaf.cols, man.leaf.rows);
      kit.ready = true;
      kit.timings = { fetch: Math.round(t1 - t0), decode: Math.round(performance.now() - t1) };
    } catch (e) {
      console.error('[trees] the baked trees failed to load — no trees this session', e);
    }
    for (const w of waiters.splice(0)) w();
    return kit;
  })());
}

/** run once the kit has loaded (or failed) — immediately if it already has */
export function whenTreeKit(f: () => void) {
  if (kit.ready) f();
  else {
    waiters.push(f);
    void loadTreeKit();
  }
}

/** the shared kit (the same object before and after loading: Game keeps its resources across circuits) */
export function buildTreeKit(): TreeKit {
  void loadTreeKit();
  return kit;
}

// the download overlaps everything else the boot does
if (typeof window !== 'undefined' && typeof fetch !== 'undefined') void loadTreeKit();
