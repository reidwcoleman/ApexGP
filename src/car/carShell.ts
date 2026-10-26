import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Team } from '../race/Teams.ts';
import { FONT } from './carTextures.ts';

/**
 * The 2026 car's bodywork from a scanned-quality model: "My take on the 2026 f1 regulations" by MaG80
 * (https://sketchfab.com/MaG80), CC-BY-4.0 — the credit is in the README and the Settings › Credits
 * line. Converted offline (tools/build_car_shell.mjs) into the game's car frame: metres, +Z forward,
 * the ground at y = 0, the axles at Z_FRONT_AXLE / Z_REAR_AXLE with the wheel centres at WHEEL_R; its
 * own wheels dropped (the game's tyres turn, wear, change compound and come off), the front wing cut
 * into its two halves and the rear wing kept apart so they break off like the procedural ones.
 * Two levels: the full body for the nearest cars and a simplified one (~22 %) for the middle distance;
 * the far level stays the procedural car.
 *
 * Its livery is a blue FIA show-car design with the FIA and F1 marks on it: each team gets the texture
 * repainted per pixel by what the source colour is (the blue → the team's primary, the stripes → its
 * secondary / accent, the carbon kept, the marks and number boards painted out) with the team's own
 * title sponsor lettered where the big marks were.
 */

export type ShellPart = 'body' | 'nose' | 'fwL' | 'fwR' | 'rw' | 'light';
export interface ShellLevel {
  geo: Partial<Record<ShellPart, THREE.BufferGeometry>>;
}
interface Shell {
  levels: ShellLevel[];
  /** the source livery's pixels (1024²) */
  src: ImageData;
  /** metal (B) / roughness (G), shared by every team */
  orm: THREE.Texture | null;
}

const URL_ = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'models/car2026/car2026.glb';
const TEX = 1024;
let shell: Shell | null = null;
let loading: Promise<void> | null = null;
/** the 2026 model is used for the near levels (Settings › Car model can turn it off: the procedural car everywhere) */
export const shellPrefs = { enabled: readPref() };
function readPref(): boolean {
  try {
    if (typeof location !== 'undefined' && /[?&]carmodel=classic/.test(location.search)) return false;
    return localStorage.getItem('apexgp.carModel') !== 'classic';
  } catch {
    return true;
  }
}
/** Settings: choose the car model (cars built from now on; the garage and the next session rebuild theirs) */
export function setShellEnabled(on: boolean) {
  shellPrefs.enabled = on;
  try {
    localStorage.setItem('apexgp.carModel', on ? '2026' : 'classic');
  } catch {
    /* private mode: this session only */
  }
}

export function carShell(): Shell | null {
  return shellPrefs.enabled ? shell : null;
}

export function loadCarShell(): Promise<void> {
  if (loading) return loading;
  loading = new GLTFLoader()
    .loadAsync(URL_)
    .then((gltf) => {
      const levels: ShellLevel[] = [{ geo: {} }, { geo: {} }];
      let livery: THREE.MeshStandardMaterial | null = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const [part, lv] = m.name.split('_L') as [ShellPart, string];
        const g = floatGeometry(m.geometry, m.matrixWorld);
        if (part === 'light') {
          // (one rain light for both levels)
          levels[0].geo.light = g;
          levels[1].geo.light = g;
        } else levels[Number(lv)].geo[part] = g;
        if (part !== 'light') livery = m.material as THREE.MeshStandardMaterial;
      });
      const img = livery!.map!.image as ImageBitmap | HTMLImageElement;
      const c = document.createElement('canvas');
      c.width = c.height = TEX;
      const g2 = c.getContext('2d', { willReadFrequently: true })!;
      g2.drawImage(img, 0, 0, TEX, TEX);
      const src = g2.getImageData(0, 0, TEX, TEX);
      shell = { levels, src, orm: ormFrom(src) };
      console.info(`[car] 2026 bodywork loaded (${levels.map((l) => Object.values(l.geo).reduce((n, g) => n + (g!.index ? g!.index.count / 3 : 0), 0)).join(' / ')} tris)`);
    })
    .catch((e) => {
      console.warn('[car] 2026 bodywork failed to load — the procedural car everywhere', e);
    });
  return loading;
}

/**
 * The file is quantized (KHR_mesh_quantization: normalized integers under a node scale): back to plain
 * floats in the car frame, so the meshes sit under the car's own groups with no transform of their own.
 */
function floatGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const n = a.count, k = a.itemSize;
    const f = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) f[i * k + j] = a.getComponent(i, j);
    g.setAttribute(name, new THREE.BufferAttribute(f, k));
  }
  if (src.index) g.setIndex(src.index);
  g.applyMatrix4(m);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * The model's own metal/roughness map is flat (fully rough): ours from the livery itself — lacquered
 * paint (smooth, the team's metal flake) where it's painted, satin carbon where the sheet is black.
 */
function ormFrom(src: ImageData): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d')!;
  const out = g.createImageData(TEX, TEX);
  const d = src.data, o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.max(d[i], d[i + 1], d[i + 2]);
    const carbon = 1 - Math.min(1, Math.max(0, (l - 10) / 30));
    o[i] = 255;
    o[i + 1] = Math.round((0.5 + 0.22 * carbon) * 255);
    o[i + 2] = Math.round((1 - carbon) * 255);
    o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ---------------------------------------------------------------- per-team livery
const lin = (hex: string) => {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
};
/** the source design's inks (sRGB 0–255) */
const SRC = {
  base: [0, 53, 114],
  black: [0, 0, 0],
  beige: [255, 219, 150],
  white: [255, 255, 255],
  orange: [255, 107, 0],
  pale: [255, 252, 144],
  yellow: [255, 224, 0],
  red: [255, 0, 6],
};
const liveries = new Map<string, { tex: THREE.CanvasTexture; refs: number }>();

function paintLivery(team: Team): THREE.CanvasTexture {
  const s = shell!;
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d')!;
  const out = g.createImageData(TEX, TEX);
  const hexRgb = (h: string) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  void lin;
  const P = hexRgb(team.primary), Sx = hexRgb(team.secondary), A = hexRgb(team.accent);
  // carbon: a near-black with the team's tint, the way a lacquered weave picks up the paint round it
  const K = [18, 18, 20];
  // ink → team colour (the white marks and the beige number boards are painted out in the primary)
  const map: [number[], number[]][] = [
    [SRC.base, P],
    [SRC.black, K],
    [SRC.beige, P],
    [SRC.white, P],
    [SRC.orange, Sx],
    [SRC.pale, A],
    [SRC.yellow, A],
    [SRC.red, Sx],
  ];
  const d = s.src.data, o = out.data;
  // soft nearest-ink weights keep the source's anti-aliased edges smooth
  const inv = 1 / (2 * 42 * 42);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    let wr = 0, wg = 0, wb = 0, ws = 0;
    for (const [src, dst] of map) {
      const dr = r - src[0], dg = gg - src[1], db = b - src[2];
      const w = Math.exp(-(dr * dr + dg * dg + db * db) * inv) + 1e-6;
      wr += dst[0] * w;
      wg += dst[1] * w;
      wb += dst[2] * w;
      ws += w;
    }
    o[i] = wr / ws;
    o[i + 1] = wg / ws;
    o[i + 2] = wb / ws;
    o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  // the show car's "2026" emblems painted out
  g.fillStyle = team.primary;
  for (const [u0, v0, u1, v1] of ERASE) g.fillRect(u0 * TEX, v0 * TEX, (u1 - u0) * TEX, (v1 - v0) * TEX);
  // the title sponsor where the FIA marks were (the sidepod islands are laid out mirrored in the sheet)
  const ink = contrastHex(team.primary);
  const word = (x: number, y: number, w: number, h: number, rot: number, flip: boolean) => {
    g.save();
    g.translate(x * TEX, y * TEX);
    g.rotate(rot);
    if (flip) g.scale(-1, 1);
    g.fillStyle = ink;
    g.font = `italic 900 ${Math.round(h * TEX)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const tw = g.measureText(team.sponsor).width;
    const k = Math.min(1, (w * TEX) / tw);
    g.scale(k, 1);
    g.fillText(team.sponsor, 0, 0);
    g.restore();
  };
  for (const v of SPONSOR_SPOTS) word(v[0], v[1], v[2], v[3], v[4], v[5]);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}
/** the "2026" emblems in the sheet (u0, v0, u1, v1) */
const ERASE: [number, number, number, number][] = [
  [0.318, 0.045, 0.392, 0.085],
  [0.318, 0.195, 0.392, 0.235],
  [0.185, 0.368, 0.22, 0.395],
];
/** where the sponsor goes in the sheet (u, v centre, width, height, rotation, mirrored) */
const SPONSOR_SPOTS: [number, number, number, number, number, boolean][] = [
  [0.49, 0.1, 0.12, 0.045, Math.PI, true],
  [0.49, 0.25, 0.12, 0.045, Math.PI, false],
  [0.82, 0.21, 0.2, 0.04, 0, true],
];
function contrastHex(hex: string) {
  const c = new THREE.Color(hex);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 0.35 ? '#111111' : '#f2f2f2';
}

// (keyed by the colours and the sponsor too: the paint shop recolours a team in place)
const liveryKey = (t: Team) => [t.id, t.primary, t.secondary, t.accent, t.sponsor].join('|');
export function acquireShellLivery(team: Team): THREE.CanvasTexture {
  const k = liveryKey(team);
  let e = liveries.get(k);
  if (!e) {
    e = { tex: paintLivery(team), refs: 0 };
    liveries.set(k, e);
  }
  e.refs++;
  return e.tex;
}
export function releaseShellLivery(tex: THREE.Texture) {
  for (const [k, e] of liveries) {
    if (e.tex !== tex) continue;
    if (--e.refs > 0) return;
    e.tex.dispose();
    liveries.delete(k);
    return;
  }
}

/** the body paint for one car (its own material: grime, burns and the env map are per car) */
export function shellPaintMaterial(team: Team, map: THREE.Texture): THREE.MeshPhysicalMaterial {
  const s = shell!;
  const m = team.matte;
  const c = new THREE.Color(team.primary);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // (as the procedural paint: silvers and greys get a metal flake)
  const metallic = team.metallic ?? (hsl.s < 0.15 && hsl.l > 0.25 && hsl.l < 0.85 ? 0.55 : 0.08);
  return new THREE.MeshPhysicalMaterial({
    name: `car-shell-${team.id}`,
    map,
    metalnessMap: s.orm,
    roughnessMap: s.orm,
    metalness: metallic,
    roughness: 1 + 0.4 * m,
    clearcoat: 1 - 0.72 * m,
    clearcoatRoughness: 0.065 + 0.4 * m,
    specularIntensity: 1 - 0.75 * (1 - m),
    side: THREE.DoubleSide,
  });
}

/**
 * The onboard cameras on this body (car frame, m): its tub sides stand ~15 cm higher than the
 * procedural car's and its nose crest is higher where the nose pod sits — the eyes ride up to look
 * over the rim as they did, and the pods sit on the bodywork rather than inside it.
 */
export const SHELL_CAM_LIFT: Record<string, readonly [number, number, number]> = {
  cockpit: [0, 0.14, 0],
  helmet: [0, 0.1, 0],
  halo: [0, 0.14, 0],
  tcam: [0, 0.08, 0],
  tcamoff: [0, 0.08, 0],
  tcamrev: [0, 0.08, 0],
  nose: [-0.04, 0.1, 0],
  bonnet: [0, 0.05, 0],
};
