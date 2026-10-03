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
 *   - two near LODs in the vertex layout below: the scan's trunk + limbs decimated (meshoptimizer),
 *     the bark albedo in the vertex colour, and one camera-facing leaf card per k-means cluster of
 *     the scan's real leaves, textured with clumps of those same leaves (leaf_c / leaf_n);
 *   - 8 impostor frames around the full-resolution tree (imp_c: albedo + coverage, imp_n: normal +
 *     crown AO) for everything beyond the 3D range.
 *
 * Vertex layout (shared by every prototype so they batch together):
 *   position, normal, uv, color (linear tint / bark albedo),
 *   aTree = (wind weight, kind, ao, phase) with kind 1 = leaf, 0 = bark,
 *   aCard = (corner x, corner y, in-plane rotation, 0) in metres: a non-zero corner makes the
 *           vertex part of a camera-facing leaf card (SpeedTree-style). All four corners sit at
 *           the clump centre; the vertex shader spreads them in the view plane, the texture's "up"
 *           turned toward the clump's outward direction on screen. In the shadow pass they face the sun.
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
  timings: Record<string, number>;
}

interface Manifest {
  version: number;
  impostor: { frames: number; rows: number; cell: number };
  leaf: { cols: number; rows: number; cell: number };
  protos: { id: string; height: number; radius: number; crownR: number; crownY: number; W: number; Hc: number; lods: { v: number; i: number; off: number; bytes: number }[] }[];
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
  timings: {},
};

/** decode the near LOD geometry (tools/bake_trees.mjs Geo.pack) */
function decodeLod(buf: ArrayBuffer, off: number, V: number, I: number): THREE.BufferGeometry {
  let o = off;
  const pos = new Float32Array(buf.slice(o, o + V * 12));
  o += V * 12;
  const n8 = new Int8Array(buf, o, V * 4);
  o += V * 4;
  const uv = new Float32Array(buf.slice(o, o + V * 8));
  o += V * 8;
  const c8 = new Uint8Array(buf, o, V * 4);
  o += V * 4;
  const d8 = new Uint8Array(buf, o, V * 4);
  o += V * 4;
  const k16 = new Int16Array(buf, o, V * 4);
  o += V * 8;
  const idx = new Uint16Array(buf.slice(o, o + I * 2));
  const nor = new Float32Array(V * 3), col = new Float32Array(V * 3), dat = new Float32Array(V * 4), card = new Float32Array(V * 4);
  for (let i = 0; i < V; i++) {
    for (let k = 0; k < 3; k++) {
      nor[i * 3 + k] = n8[i * 4 + k] / 127;
      col[i * 3 + k] = c8[i * 4 + k] / 255;
    }
    dat[i * 4] = (d8[i * 4] / 255) * 1.5;
    dat[i * 4 + 1] = d8[i * 4 + 1] > 127 ? 1 : 0;
    dat[i * 4 + 2] = d8[i * 4 + 2] / 255;
    dat[i * 4 + 3] = (d8[i * 4 + 3] / 255) * Math.PI * 2;
    for (let k = 0; k < 4; k++) card[i * 4 + k] = k16[i * 4 + k] / 1000;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTree', new THREE.BufferAttribute(dat, 4));
  g.setAttribute('aCard', new THREE.BufferAttribute(card, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
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
        protos.push({ index, id: p.id, lods: p.lods.map((l) => decodeLod(bin, l.off, l.v, l.i)), height: p.height, radius: p.radius, crownR: p.crownR, crownY: p.crownY, W: p.W, Hc: p.Hc });
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
