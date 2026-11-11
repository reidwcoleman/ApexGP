import * as THREE from 'three';

/**
 * The new Monza's own pictures (public/monza, made by tools/build_monza.py from images generated for
 * this circuit) and the two textures drawn here: a tiling value noise for the materials' large-scale
 * variation, and the chain-link of the debris fences. Nothing is shared with the earlier circuits.
 */
export interface MonzaAssets {
  asphalt: THREE.Texture;
  asphaltN: THREE.Texture;
  grass: THREE.Texture;
  grassN: THREE.Texture;
  floor: THREE.Texture;
  concrete: THREE.Texture;
  concreteN: THREE.Texture;
  paint: THREE.Texture;
  kerb: THREE.Texture;
  gravel: THREE.Texture;
  gravelN: THREE.Texture;
  treeline: THREE.Texture;
  treeline2: THREE.Texture;
  trees: THREE.Texture;
  crowd: THREE.Texture;
  noise: THREE.DataTexture;
  fence: THREE.CanvasTexture;
}

let cached: MonzaAssets | null = null;
const pending: Promise<unknown>[] = [];

function photo(file: string, srgb: boolean, aniso: number, wrap: 'repeat' | 'clamp' | 'x' = 'repeat'): THREE.Texture {
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  // (decoded off the main thread; three's default flipY, so v runs up the picture)
  pending.push(
    fetch(`${import.meta.env.BASE_URL}monza/${file}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${file}: ${r.status}`))))
      .then((b) => createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then((bmp) => {
        t.image = bmp;
        t.flipY = false;
        t.needsUpdate = true;
      })
      .catch((e) => console.warn('[monza] texture failed to load', e)),
  );
  return t;
}

/** 256² of tiling value noise, a different field in each channel (read bilinearly at low frequency) */
function noiseTexture(): THREE.DataTexture {
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  let seed = 0x2f6e2b1;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let c = 0; c < 4; c++) {
    // three octaves of lattice noise, each a power-of-two grid so the tile wraps
    const f = new Float32Array(N * N);
    for (const [cells, amp] of [[16, 0.5], [32, 0.3], [64, 0.2]] as const) {
      const g = new Float32Array(cells * cells);
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      const k = N / cells;
      for (let y = 0; y < N; y++) {
        const gy = y / k, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < N; x++) {
          const gx = x / k, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
          const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
          const e = g[((y0 + 1) % cells) * cells + (x0 % cells)], h = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
          f[y * N + x] += amp * (a + (b - a) * sx + (e + (h - e) * sx - (a + (b - a) * sx)) * sy);
        }
      }
    }
    for (let i = 0; i < N * N; i++) d[i * 4 + c] = Math.max(0, Math.min(255, Math.round(f[i] * 255)));
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** galvanised chain-link, 5 cm diamonds, with the three tension wires (alpha = wire) */
function fenceTexture(aniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(176,180,184,1)';
  g.lineWidth = 2.1;
  const step = 32;
  for (let k = -256; k < 512; k += step) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 256, 256);
    g.moveTo(k + 256, 0);
    g.lineTo(k, 256);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

export function monzaAssets(aniso: number): MonzaAssets {
  if (cached) return cached;
  const a = Math.min(aniso, 16);
  cached = {
    asphalt: photo('asphalt_c.webp', true, a),
    asphaltN: photo('asphalt_n.webp', false, a),
    grass: photo('grass_c.webp', true, Math.min(a, 8)),
    grassN: photo('grass_n.webp', false, Math.min(a, 8)),
    floor: photo('floor_c.webp', true, Math.min(a, 8)),
    concrete: photo('concrete_c.webp', true, Math.min(a, 8)),
    concreteN: photo('concrete_n.webp', false, Math.min(a, 8)),
    paint: photo('paint_c.webp', true, Math.min(a, 8)),
    kerb: photo('kerb_c.webp', true, a, 'x'),
    gravel: photo('gravel_c.webp', true, Math.min(a, 8)),
    gravelN: photo('gravel_n.webp', false, Math.min(a, 8)),
    treeline: photo('treeline.webp', true, 4, 'x'),
    treeline2: photo('treeline2.webp', true, 4, 'x'),
    trees: photo('trees.webp', true, 4, 'clamp'),
    crowd: photo('crowd.webp', true, 4, 'x'),
    noise: noiseTexture(),
    fence: fenceTexture(a),
  };
  return cached;
}

/** resolves once every picture asked for so far has arrived (or failed: the game runs without it) */
export function monzaAssetsReady(): Promise<void> {
  return Promise.all(pending).then(() => undefined);
}
