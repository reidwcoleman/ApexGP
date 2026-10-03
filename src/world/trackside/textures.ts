import * as THREE from 'three';
import { hash2 } from './noise.ts';
import { ASPHALT_ALB_MAX, asphaltData, fenceData, grassData, gravelData, macroData, macroNData, scanData, type PackedAsphalt } from './groundData.ts';
import { adoptNoisePixels } from '../env/textures.ts';
import type { GroundJob, GroundPixels, GroundRequest } from '../groundWorker.ts';
import { keepData, loadData, pixelKey } from '../../core/pixelCache.ts';

/**
 * Procedural ground textures for the circuit (all generated in code: the pixels in groundData.ts,
 * made off the main thread by the ground worker while the boot builds the circuit).
 *
 *   asphalt  — PACKED aggregate texture, one fetch gives everything (from Poly Haven's CC0 'Asphalt
 *              Track' scan, tools/build_asphalt.py; the procedural asphaltData is the fallback):
 *              R = albedo (linear luminance / ASPHALT_ALB_MAX, stored as sqrt for precision)
 *              G = height (0 binder … 1 top of the biggest stones)
 *              B,A = tangent-space normal xy (0.5 = flat)
 *              The road shader samples it twice (two scales/rotations, histogram-preserving
 *              blend) so it never tiles visibly.
 *   macro    — R large fBm, G sealed cracks, B medium fBm, A tint fBm (sampled at several scales)
 *   macroN   — metre-scale unevenness: RG = height gradient (normal xy), B = height, A = fBm
 *   gravel   — packed like asphalt: RGB albedo (sRGB) + A height; normal from gravelNormal
 *   grass    — ambientCG 'Grass 001' scan (CC0, tools/build_grass.py), procedural blades as the fallback
 *   fence    — chain-link debris fence with tension cables (RGBA, 0.5 m × 4 m)
 */

/**
 * metres per aggregate tile: the scanned track surface (public/textures/asphalt.webp, 1024 px) covers
 * 2 m → 2 mm/px; the procedural fallback was drawn for 1 m (it stretches, only if the scan fails to load)
 */
export const ASPHALT_TILE = 2.0;
export { ASPHALT_ALB_MAX };
export const GRAVEL_TILE = 1.6;
/** the grass scan's tile (ambientCG Grass 001 is 1.4 m; the procedural fallback was drawn for 1.5) */
export const GRASS_TILE = 1.4;

export interface GroundTextures {
  asphalt: THREE.DataTexture;
  /** mean of the packed albedo (R) and height (G) channels, for histogram-preserving blends */
  asphaltMean: THREE.Vector2;
  macro: THREE.DataTexture;
  macroN: THREE.DataTexture;
  gravelAlbedo: THREE.DataTexture;
  gravelNormal: THREE.DataTexture;
  grassAlbedo: THREE.Texture;
  grassNormal: THREE.Texture;
  fence: THREE.DataTexture;
}

function dataTex(data: Uint8Array, w: number, h: number, srgb: boolean, aniso: number, repeat = true): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ the pixels, made off the main thread

/**
 * The ground's pixels (see loadAsphaltScan): the scanned asphalt packed with its normals, and what the
 * ground workers have delivered by the time makeGroundTextures runs (macro, macroN, gravel, fence;
 * the shared env noise goes to env/textures.ts) — or all of it as an earlier visit kept it. A null
 * field is made by makeGroundTextures itself: the same bytes either way (the same deterministic code).
 */
const pre: GroundPixels = { asphalt: null, macro: null, macroN: null, gravel: null, fence: null, noise: null, detailNormal: null };
/** the scan is in pre.asphalt (null there then means it failed: the procedural surface) */
let scanDone = false;
let scanP: Promise<void> | null = null;
let grassBmp: { c: ImageBitmap; n: ImageBitmap } | null = null;

const fetchBitmap = async (file: string) => {
  const r = await fetch(`${import.meta.env.BASE_URL}textures/${file}`);
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
};

/** the scan, downloaded and decoded by the browser (off the main thread), packed with its normals here */
async function scanHere(): Promise<PackedAsphalt | null> {
  try {
    const bmp = await fetchBitmap('asphalt.webp');
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const size = bmp.width;
    const px = g.getImageData(0, 0, size, bmp.height).data;
    // (a closed bitmap reads 0 × 0: the size is taken first)
    bmp.close();
    return scanData(px, size);
  } catch (e) {
    console.warn('asphalt scan failed to load, drawing the procedural surface', e);
    return null;
  }
}

/**
 * The procedural jobs over two workers, about evenly (the macro texture is the biggest: 1024² of
 * fBm and cracks); ~0.3 s of a core on an M1 between them, off the main thread.
 */
const SPLIT: GroundJob[][] = [
  ['macro', 'fence', 'noise'],
  ['gravel', 'macroN', 'detailNormal'],
];

type WorkerReply = Partial<GroundPixels> & { ms?: Record<string, number> };
/** one worker's share (null if it can't start or fails) */
function fromWorker(jobs: GroundJob[]): Promise<WorkerReply | null> {
  return new Promise((res) => {
    let w: Worker;
    try {
      w = new Worker(new URL('../groundWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      res(null);
      return;
    }
    const done = (v: WorkerReply | null) => {
      w.terminate();
      res(v);
    };
    w.onmessage = (e: MessageEvent<WorkerReply | { error: string }>) => {
      if ('error' in e.data) {
        console.warn('[ground] worker failed, its share is made here:', e.data.error);
        done(null);
      } else done(e.data);
    };
    w.onerror = (e) => {
      e.preventDefault();
      console.warn('[ground] worker did not start, its share is made here:', e.message);
      done(null);
    };
    const req: GroundRequest = { jobs };
    w.postMessage(req);
  });
}

// ------------------------------------------------------------------ kept between visits

/**
 * The finished pixels are the same every visit of a build (deterministic code, the same scan), so
 * the first visit keeps them in IndexedDB (pixelCache keepData, ~12 MB raw) and later boots read
 * them straight back — no workers, no download or decode of the scan. Layout: a u32 header length,
 * a JSON header (each array's offset and length, the asphalt's size and means), the bytes.
 */
const GROUND_KEY = pixelKey('ground-pixels', 1);
const PACKED = ['asphalt', 'macro', 'macroN', 'gravelAlbedo', 'gravelNormal', 'fence', 'noise', 'detailNormal'] as const;
function arrayOf(px: GroundPixels, k: (typeof PACKED)[number]): Uint8Array | null {
  if (k === 'asphalt') return px.asphalt?.data ?? null;
  if (k === 'gravelAlbedo') return px.gravel?.albedo ?? null;
  if (k === 'gravelNormal') return px.gravel?.normal ?? null;
  return px[k];
}
function packGround(px: GroundPixels): ArrayBuffer | null {
  const parts = PACKED.map((k) => arrayOf(px, k));
  // (only a complete set: a missing scan or a failed worker isn't kept)
  if (parts.some((p) => !p) || !px.asphalt) return null;
  let off = 0;
  const at = parts.map((p) => {
    const o = off;
    off += p!.length;
    return [o, p!.length];
  });
  const head = new TextEncoder().encode(JSON.stringify({ at, size: px.asphalt.size, meanA: px.asphalt.meanA, meanH: px.asphalt.meanH }));
  const base = 4 + head.length;
  const buf = new ArrayBuffer(base + off);
  new DataView(buf).setUint32(0, head.length);
  new Uint8Array(buf, 4, head.length).set(head);
  parts.forEach((p, i) => new Uint8Array(buf, base + at[i][0], p!.length).set(p!));
  return buf;
}
function unpackGround(buf: ArrayBuffer): GroundPixels | null {
  try {
    const n = new DataView(buf).getUint32(0);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as { at: [number, number][]; size: number; meanA: number; meanH: number };
    const base = 4 + n;
    const a = h.at.map(([o, l]) => new Uint8Array(buf, base + o, l));
    if (a.length !== PACKED.length || a[0].length !== h.size * h.size * 4) return null;
    return {
      asphalt: { data: a[0], size: h.size, meanA: h.meanA, meanH: h.meanH },
      macro: a[1],
      macroN: a[2],
      gravel: { albedo: a[3], normal: a[4] },
      fence: a[5],
      noise: a[6],
      detailNormal: a[7],
    };
  } catch {
    return null;
  }
}

/** a worker's pixels: the env noise whenever it comes, the ground's only while they're still wanted */
function adopt(p: Partial<GroundPixels>) {
  adoptNoisePixels(p.noise ?? null, p.detailNormal ?? null);
  if (cached) return;
  for (const k of ['macro', 'macroN', 'gravel', 'fence'] as const) if (p[k] && !pre[k]) (pre as unknown as Record<string, unknown>)[k] = p[k];
}

/**
 * The ground's pixels: kept from an earlier visit, else the scan (downloaded and decoded by the
 * browser off the main thread, packed here) and the procedural textures from two ground workers.
 * Resolves once the scan is in and the workers are done — or, if they're slow (a busy machine
 * starves worker threads), shortly after the scan: makeGroundTextures then makes whatever hasn't
 * arrived itself, so a slow worker never costs more than the main thread would.
 */
async function groundPixels(): Promise<void> {
  const kept = await loadData(GROUND_KEY);
  const back = kept && unpackGround(kept);
  if (back) {
    adopt(back);
    pre.asphalt = back.asphalt;
    scanDone = true;
    return;
  }
  const t0 = performance.now();
  const ms: Record<string, number> = {};
  const replies = SPLIT.map((jobs) =>
    fromWorker(jobs).then((p) => {
      if (p) {
        const { ms: took, ...made } = p;
        Object.assign(ms, took);
        adopt(made);
      }
      return p;
    }),
  );
  const workers = Promise.all(replies);
  pre.asphalt = await scanHere();
  scanDone = true;
  await Promise.race([workers, new Promise((r) => setTimeout(r, 120))]);
  // (kept for the next visit once every worker has answered: the full set, whoever made each part)
  void workers.then((rs) => {
    console.info(`[shot] [ground] workers ${rs.every(Boolean) ? 'done' : 'failed'} in ${Math.round(performance.now() - t0)} ms ${JSON.stringify(ms)}`);
    const all: GroundPixels = { asphalt: pre.asphalt, macro: null, macroN: null, gravel: null, fence: null, noise: null, detailNormal: null };
    for (const r of rs) if (r) Object.assign(all, r, { ms: undefined });
    const packed = rs.every(Boolean) ? packGround(all) : null;
    if (packed) keepData(GROUND_KEY, packed);
  });
}

/**
 * The scanned ground and the procedural ground textures' pixels, made off the main thread or read
 * back from an earlier visit (main.ts starts it before the Game exists; the boot waits for it just
 * before the trackside): the asphalt (R albedo, G height, Poly Haven 'Asphalt Track'), the grass
 * (ambientCG 'Grass 001' colour + normal, decoded by the browser), the macro / gravel / fence pixels,
 * the env noise. makeGroundTextures uses whatever has arrived and makes the rest itself.
 */
export function loadAsphaltScan(): Promise<void> {
  return (scanP ??= Promise.all([
    groundPixels().then(() => void performance.mark('apex:ground')),
    (async () => {
      try {
        const [c, n] = await Promise.all([fetchBitmap('grass_c.webp'), fetchBitmap('grass_n.webp')]);
        grassBmp = { c, n };
        performance.mark('apex:grass');
      } catch (e) {
        console.warn('grass scan failed to load, drawing the procedural grass', e);
      }
    })(),
  ]).then(() => undefined));
}

function bitmapTex(bmp: ImageBitmap, srgb: boolean, aniso: number): THREE.Texture {
  const t = new THREE.Texture(bmp);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

let cached: GroundTextures | null = null;

export function makeGroundTextures(aniso: number): GroundTextures {
  if (cached) return cached;
  // (no scan — it failed, or loadAsphaltScan never ran / hasn't finished — draws the procedural surface)
  const a = (scanDone ? pre.asphalt : null) ?? asphaltData(1024);
  // low-frequency data needs no anisotropic filtering (it is 4 fetches per road pixel: keep them cheap)
  const g = pre.gravel ?? gravelData(512);
  let grassAlbedo: THREE.Texture, grassNormal: THREE.Texture;
  if (grassBmp) {
    grassAlbedo = bitmapTex(grassBmp.c, true, Math.min(aniso, 8));
    grassNormal = bitmapTex(grassBmp.n, false, Math.min(aniso, 8));
  } else {
    const d = grassData(512);
    grassAlbedo = dataTex(d.albedo, 512, 512, true, Math.min(aniso, 8));
    grassNormal = dataTex(d.normal, 512, 512, false, Math.min(aniso, 8));
  }
  cached = {
    asphalt: dataTex(a.data, a.size, a.size, false, aniso),
    asphaltMean: new THREE.Vector2(a.meanA, a.meanH),
    macro: dataTex(pre.macro ?? macroData(1024), 1024, 1024, false, 1),
    macroN: dataTex(pre.macroN ?? macroNData(512), 512, 512, false, 1),
    gravelAlbedo: dataTex(g.albedo, 512, 512, true, Math.min(aniso, 8)),
    gravelNormal: dataTex(g.normal, 512, 512, false, Math.min(aniso, 8)),
    grassAlbedo,
    grassNormal,
    fence: dataTex(pre.fence ?? fenceData(), 256, 1024, true, aniso),
  };
  return cached;
}

export { hash2 };
