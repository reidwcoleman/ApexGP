import * as THREE from 'three';
import { Rng, blurWrap, hash2, normalFromHeight, srgb8, tileFbm, tileNoise } from './noise.ts';

/**
 * Procedural ground textures for the circuit (all generated in code).
 *
 *   asphalt  — aggregate stones in dark binder: albedo / normal / roughness, 2.4 m tile
 *   macro    — R large fBm, G sealed cracks, B medium fBm, A tint fBm (sampled at several scales)
 *   gravel   — rounded beige-grey stones, 1.6 m tile
 *   grass    — short mown blades, 1.5 m tile
 *   fence    — chain-link debris fence with tension cables (RGBA, 0.5 m × 4 m)
 */

export const ASPHALT_TILE = 2.4;
export const GRAVEL_TILE = 1.6;
export const GRASS_TILE = 1.5;

export interface GroundTextures {
  asphaltAlbedo: THREE.DataTexture;
  asphaltNormal: THREE.DataTexture;
  asphaltRough: THREE.DataTexture;
  macro: THREE.DataTexture;
  gravelAlbedo: THREE.DataTexture;
  gravelNormal: THREE.DataTexture;
  grassAlbedo: THREE.DataTexture;
  grassNormal: THREE.DataTexture;
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

// ------------------------------------------------------------------ asphalt

function makeAsphalt(size: number, aniso: number) {
  const N = size * size;
  const h = new Float32Array(N);
  const lum = new Float32Array(N);
  const tint = new Float32Array(N);
  const rgh = new Float32Array(N);
  const g1 = tileNoise(size, size / 4, 7);
  const g2 = tileNoise(size, size / 2, 8);
  const mid = tileFbm(size, 24, 4, 9);
  for (let i = 0; i < N; i++) {
    const g = g1[i] * 0.55 + g2[i] * 0.45;
    h[i] = 0.1 * g + 0.12 * mid[i];
    lum[i] = 0.034 + 0.01 * g + 0.012 * mid[i];
    rgh[i] = 0.94 - 0.06 * g;
  }
  // aggregate: jittered grid of irregular stones, some half-buried
  const rng = new Rng(1234);
  const cell = 4;
  const cells = size / cell;
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const count = rng.next() < 0.45 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const cx = (gx + rng.next()) * cell;
        const cy = (gy + rng.next()) * cell;
        const r = 0.9 + 2.9 * Math.pow(rng.next(), 1.8);
        const ecc = 0.55 + 0.45 * rng.next();
        const ang = rng.next() * Math.PI;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const p = rng.next();
        const tone = p < 0.66 ? rng.range(0.055, 0.08) : p < 0.9 ? rng.range(0.08, 0.108) : rng.range(0.038, 0.05);
        const tn = rng.range(-1, 1);
        const top = 0.45 + 0.55 * rng.next();
        const polish = rng.range(0.55, 0.78);
        const wob = rng.range(-0.35, 0.35);
        const R = Math.ceil(r + 0.5);
        const fcx = Math.floor(cx), fcy = Math.floor(cy);
        const ir = 1 / r, ire = 1 / (r * ecc);
        for (let oy = -R; oy <= R; oy++) {
          const py = (fcy + oy + size) % size;
          const dy = fcy + oy + 0.5 - cy;
          for (let ox = -R; ox <= R; ox++) {
            const dx = fcx + ox + 0.5 - cx;
            const u = (dx * ca + dy * sa) * ir;
            const v = (-dx * sa + dy * ca) * ire;
            const q = u * u + v * v;
            if (q >= 1.4) continue;
            // cheap irregularity: skew the ellipse with a u·v term (no trig per pixel)
            const d2 = q * (1 + wob * u * v);
            if (d2 >= 1) continue;
            const px = (fcx + ox + size) % size;
            const dome = Math.sqrt(1 - d2);
            const z = 0.08 + top * dome;
            const o = py * size + px;
            if (z > h[o]) {
              h[o] = z;
              lum[o] = tone * (0.78 + 0.32 * dome);
              tint[o] = tn;
              rgh[o] = polish + 0.1 * (1 - dome);
            }
          }
        }
      }
    }
  }
  // binder darkening in the crevices (dirt/rubber collects low)
  const hb = blurWrap(Float32Array.from(h), size, 3);
  const alb = new Uint8Array(N * 4);
  const rough = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const cav = Math.max(0, hb[i] - h[i]);
    const l = lum[i] * (1 - Math.min(0.5, cav * 2.2));
    const t = tint[i] * 0.05;
    alb[i * 4] = srgb8(l * (1.02 + t));
    alb[i * 4 + 1] = srgb8(l);
    alb[i * 4 + 2] = srgb8(l * (0.97 - t));
    alb[i * 4 + 3] = 255;
    rough[i * 4] = 255;
    rough[i * 4 + 1] = Math.round(Math.min(1, rgh[i] + cav * 0.3) * 255);
    rough[i * 4 + 2] = 0;
    rough[i * 4 + 3] = 255;
  }
  const nrm = normalFromHeight(h, size, 1.5);
  return {
    albedo: dataTex(alb, size, size, true, aniso),
    normal: dataTex(nrm, size, size, false, aniso),
    rough: dataTex(rough, size, size, false, aniso),
  };
}

// ------------------------------------------------------------------ macro

function makeMacro(size: number, aniso: number) {
  const N = size * size;
  const R = tileFbm(size, 4, 6, 21, 0.55);
  const B = tileFbm(size, 8, 5, 33, 0.5);
  const A = tileFbm(size, 3, 4, 45, 0.5);
  const G = new Float32Array(N);
  // sealed cracks: meandering random walks, mostly longitudinal (along +v = texture rows)
  const rng = new Rng(777);
  const stamp = (x: number, y: number, r: number) => {
    const R2 = Math.ceil(r + 1);
    for (let oy = -R2; oy <= R2; oy++)
      for (let ox = -R2; ox <= R2; ox++) {
        const d = Math.hypot(ox + (Math.floor(x) + 0.5 - x), oy + (Math.floor(y) + 0.5 - y));
        const v = Math.max(0, Math.min(1, r + 0.5 - d));
        if (v <= 0) continue;
        const px = ((Math.floor(x) + ox) % size + size) % size;
        const py = ((Math.floor(y) + oy) % size + size) % size;
        const o = py * size + px;
        if (v > G[o]) G[o] = v;
      }
  };
  const walk = (x: number, y: number, ang: number, len: number, r: number, depth: number) => {
    for (let i = 0; i < len; i++) {
      stamp(x, y, r);
      ang += (rng.next() - 0.5) * 0.35;
      x += Math.cos(ang) * 1.2;
      y += Math.sin(ang) * 1.2;
      if (depth < 2 && rng.next() < 0.004) walk(x, y, ang + (rng.next() < 0.5 ? 1 : -1) * rng.range(0.5, 1.2), len * 0.4, r * 0.8, depth + 1);
    }
  };
  for (let k = 0; k < 26; k++) {
    const longit = rng.next() < 0.7;
    const ang = longit ? Math.PI / 2 + rng.range(-0.25, 0.25) : rng.range(0, Math.PI);
    walk(rng.range(0, size), rng.range(0, size), ang, rng.range(60, 420), rng.range(0.7, 1.3), 0);
  }
  const out = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    out[i * 4] = Math.round(R[i] * 255);
    out[i * 4 + 1] = Math.round(G[i] * 255);
    out[i * 4 + 2] = Math.round(B[i] * 255);
    out[i * 4 + 3] = Math.round(A[i] * 255);
  }
  return dataTex(out, size, size, false, aniso);
}

// ------------------------------------------------------------------ gravel

function makeGravel(size: number, aniso: number) {
  const N = size * size;
  const h = new Float32Array(N);
  const col = new Float32Array(N * 3);
  const base = tileNoise(size, 64, 5);
  for (let i = 0; i < N; i++) {
    h[i] = 0.05 * base[i];
    col[i * 3] = 0.1; col[i * 3 + 1] = 0.09; col[i * 3 + 2] = 0.075;
  }
  const palette = [
    [0.3, 0.26, 0.2], [0.36, 0.32, 0.26], [0.24, 0.225, 0.2], [0.4, 0.35, 0.27],
    [0.27, 0.23, 0.18], [0.33, 0.31, 0.28], [0.2, 0.18, 0.15], [0.42, 0.38, 0.32],
  ];
  const rng = new Rng(4242);
  const cell = 3;
  const cells = Math.floor(size / cell);
  for (let pass = 0; pass < 2; pass++)
    for (let gy = 0; gy < cells; gy++)
      for (let gx = 0; gx < cells; gx++) {
        const cx = (gx + rng.next()) * cell;
        const cy = (gy + rng.next()) * cell;
        const r = 1.2 + 1.8 * Math.pow(rng.next(), 1.3);
        const ecc = 0.6 + 0.4 * rng.next();
        const ang = rng.next() * Math.PI;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const c = rng.pick(palette);
        const shade = rng.range(0.8, 1.15);
        const top = 0.5 + 0.5 * rng.next();
        const R = Math.ceil(r + 0.5);
        for (let oy = -R; oy <= R; oy++) {
          const py = ((Math.floor(cy) + oy) % size + size) % size;
          const dy = Math.floor(cy) + oy + 0.5 - cy;
          for (let ox = -R; ox <= R; ox++) {
            const px = ((Math.floor(cx) + ox) % size + size) % size;
            const dx = Math.floor(cx) + ox + 0.5 - cx;
            const u = (dx * ca + dy * sa) / r;
            const v = (-dx * sa + dy * ca) / (r * ecc);
            const d2 = u * u + v * v;
            if (d2 >= 1) continue;
            const dome = Math.sqrt(1 - d2);
            const z = top * (0.35 + 0.65 * dome) + pass * 0.05;
            const o = py * size + px;
            if (z > h[o]) {
              h[o] = z;
              const l = shade * (0.7 + 0.4 * dome);
              col[o * 3] = c[0] * l; col[o * 3 + 1] = c[1] * l; col[o * 3 + 2] = c[2] * l;
            }
          }
        }
      }
  const hb = blurWrap(Float32Array.from(h), size, 3);
  const alb = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const cav = Math.max(0, hb[i] - h[i]);
    const k = 1 - Math.min(0.65, cav * 2.5);
    alb[i * 4] = srgb8(col[i * 3] * k);
    alb[i * 4 + 1] = srgb8(col[i * 3 + 1] * k);
    alb[i * 4 + 2] = srgb8(col[i * 3 + 2] * k);
    alb[i * 4 + 3] = 255;
  }
  return {
    albedo: dataTex(alb, size, size, true, aniso),
    normal: dataTex(normalFromHeight(h, size, 2.2), size, size, false, aniso),
  };
}

// ------------------------------------------------------------------ grass

function makeGrass(size: number, aniso: number) {
  const N = size * size;
  const h = new Float32Array(N);
  const col = new Float32Array(N * 3);
  const soil = tileFbm(size, 16, 4, 61);
  for (let i = 0; i < N; i++) {
    h[i] = 0.1 * soil[i];
    col[i * 3] = 0.035 + 0.02 * soil[i];
    col[i * 3 + 1] = 0.045 + 0.02 * soil[i];
    col[i * 3 + 2] = 0.018;
  }
  const rng = new Rng(99);
  const blades = Math.round(size * size * 0.09);
  for (let b = 0; b < blades; b++) {
    let x = rng.next() * size;
    let y = rng.next() * size;
    const ang = rng.next() * Math.PI * 2;
    const len = 3 + rng.next() * 7;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const hue = rng.next();
    const lit = rng.range(0.7, 1.25);
    const r = (0.04 + 0.045 * hue) * lit;
    const g = (0.095 + 0.05 * (1 - hue * 0.5)) * lit;
    const bb = (0.02 + 0.015 * hue) * lit;
    const top = rng.range(0.4, 1);
    for (let t = 0; t < len; t++) {
      const px = ((Math.floor(x) % size) + size) % size;
      const py = ((Math.floor(y) % size) + size) % size;
      const o = py * size + px;
      const z = top * (0.4 + 0.6 * (t / len));
      if (z > h[o]) {
        h[o] = z;
        const k = 0.75 + 0.35 * (t / len);
        col[o * 3] = r * k; col[o * 3 + 1] = g * k; col[o * 3 + 2] = bb * k;
      }
      x += dx;
      y += dy;
    }
  }
  const alb = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    alb[i * 4] = srgb8(col[i * 3]);
    alb[i * 4 + 1] = srgb8(col[i * 3 + 1]);
    alb[i * 4 + 2] = srgb8(col[i * 3 + 2]);
    alb[i * 4 + 3] = 255;
  }
  return {
    albedo: dataTex(alb, size, size, true, aniso),
    normal: dataTex(normalFromHeight(h, size, 1.6), size, size, false, aniso),
  };
}

// ------------------------------------------------------------------ fence

/** 256 × 1024 RGBA: 0.5 m (u) × 4 m (v). Chain-link diamonds + cables at 0.05/1/2/3/3.95 m. */
function makeFence(aniso: number) {
  const W = 256, H = 1024;
  const data = new Uint8Array(W * H * 4);
  const pitchU = W / 10; // 5 cm diamonds
  const pitchV = H / 64; // 6.25 cm
  const wire = (d: number, r: number) => Math.max(0, Math.min(1, r + 0.5 - d));
  const cables = [0.05, 1.0, 2.0, 3.0, 3.93].map((m) => (m / 4) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) % pitchU) / pitchU; // 0..1 inside a diamond cell
      const v = ((y + 0.5) % pitchV) / pitchV;
      // diamond lattice: lines u = v and u = 1 − v (in cell coords), measured in pixels
      const d1 = Math.abs(((u - v + 1.5) % 1) - 0.5) * pitchU * 0.62;
      const d2 = Math.abs(((u + v + 0.5) % 1) - 0.5) * pitchU * 0.62;
      let a = Math.max(wire(d1, 0.85), wire(d2, 0.85));
      let shade = 0.55 + 0.25 * (d1 < d2 ? 1 : 0.7);
      for (const cy of cables) {
        const dc = Math.abs(y + 0.5 - cy);
        const ca = wire(dc, 1.6);
        if (ca > 0) {
          a = Math.max(a, ca);
          shade = 0.6;
        }
      }
      const o = (y * W + x) * 4;
      const g = shade * 175;
      data[o] = g; data[o + 1] = g * 1.01; data[o + 2] = g * 1.04;
      data[o + 3] = Math.round(a * 255);
    }
  }
  return dataTex(data, W, H, true, aniso);
}

export function makeGroundTextures(aniso: number): GroundTextures {
  const t0 = performance.now();
  const a = makeAsphalt(1024, aniso);
  const t1 = performance.now();
  const g = makeGravel(512, aniso);
  const t2 = performance.now();
  const gr = makeGrass(512, aniso);
  const t3 = performance.now();
  const macro = makeMacro(1024, aniso);
  const t4 = performance.now();
  const fence = makeFence(aniso);
  const t5 = performance.now();
  void t0; void t1; void t2; void t3; void t4; void t5;
  return {
    asphaltAlbedo: a.albedo,
    asphaltNormal: a.normal,
    asphaltRough: a.rough,
    macro,
    gravelAlbedo: g.albedo,
    gravelNormal: g.normal,
    grassAlbedo: gr.albedo,
    grassNormal: gr.normal,
    fence,
  };
}

export { hash2 };
