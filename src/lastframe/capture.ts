import * as THREE from 'three';
import type { Loaded } from './world.ts';
import { LF } from './lighting.ts';

/**
 * Build tool (tools/lastframe/volume.mjs): renders the baked world from a grid of points and writes
 * each cell's light as six cosine-weighted colours. Runs on the real renderer, so it sees exactly
 * the lightmap, the sky and the lamps the game shows.
 */
// z runs from behind the far yard to the shops across the street; the cove brings its own in map.json
const BLOCK = { step: [2, 1.15, 2], min: [-4, -3.7, -66], dim: [53, 12, 40] };
const T = 8;
const DIRS: [THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)], [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)], [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)], [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
];

export async function capture(r: THREE.WebGLRenderer, scene: THREE.Scene, L: Loaded, onProgress: (f: number) => void) {
  const { step: STEP, min: MIN, dim: DIM } = L.map.volume ?? BLOCK;
  const [dx, dy, dz] = DIM;
  const n = dx * dy * dz;
  const perRow = Math.floor(2048 / (T * 6));
  const rows = 64;
  const batch = perRow * rows;
  const rt = new THREE.WebGLRenderTarget(perRow * T * 6, rows * T, { type: THREE.FloatType, depthBuffer: true });
  const cam = new THREE.PerspectiveCamera(90, 1, 0.03, 900);
  // only the architecture and the sky: props take their light from these cells
  const hidden: THREE.Object3D[] = [];
  L.group.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh || (o.parent === L.group && !(o as THREE.Mesh).isMesh && o.name !== 'land') || o.name === 'sea') {
      if (o.visible) hidden.push(o);
      o.visible = false;
    }
  });
  for (const d of L.doors) d.pivot.visible = false;
  for (const p of L.panes) p.mesh.visible = false;
  // solid-angle weights of a face's texels
  const texW: { x: number; y: number; z: number; w: number }[] = [];
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const u = ((i + 0.5) / T) * 2 - 1, v = ((j + 0.5) / T) * 2 - 1;
    const l2 = u * u + v * v + 1;
    texW.push({ x: u, y: v, z: 1, w: (4 / (T * T)) / (l2 * Math.sqrt(l2)) });
  }
  const out = new Float32Array(n * 6 * 3);
  const valid = new Uint8Array(n);
  const buf = new Float32Array(rt.width * rt.height * 4);
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), w = new THREE.Vector3();
  r.autoClear = false;
  LF.disc.value = 0;
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  for (let b0 = 0; b0 < n; b0 += batch) {
    const b1 = Math.min(n, b0 + batch);
    r.setRenderTarget(rt);
    r.clear();
    rt.scissorTest = true;
    for (let i = b0; i < b1; i++) {
      const ix = i % dx, iy = Math.floor(i / dx) % dy, iz = Math.floor(i / (dx * dy));
      const x = MIN[0] + (ix + 0.5) * STEP[0], y = MIN[1] + (iy + 0.5) * STEP[1], z = MIN[2] + (iz + 0.5) * STEP[2];
      valid[i] = L.world.blocked(x, y - 0.06, z, 0.06, 0.12) ? 0 : 1;
      if (!valid[i]) continue;
      cam.position.set(x, y, z);
      const k = i - b0, tx = (k % perRow) * T * 6, ty = Math.floor(k / perRow) * T;
      for (let f = 0; f < 6; f++) {
        cam.up.copy(DIRS[f][1]);
        cam.lookAt(x + DIRS[f][0].x, y + DIRS[f][0].y, z + DIRS[f][0].z);
        cam.updateMatrixWorld();
        rt.viewport.set(tx + f * T, ty, T, T);
        rt.scissor.set(tx + f * T, ty, T, T);
        r.setRenderTarget(rt);
        r.render(scene, cam);
      }
    }
    rt.scissorTest = false;
    r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    for (let i = b0; i < b1; i++) {
      if (!valid[i]) continue;
      const k = i - b0, tx = (k % perRow) * T * 6, ty = Math.floor(k / perRow) * T;
      const acc = new Float64Array(18);
      const ws = new Float64Array(6);
      for (let f = 0; f < 6; f++) {
        fwd.copy(DIRS[f][0]);
        up.copy(DIRS[f][1]);
        right.crossVectors(fwd, up);
        for (let t = 0; t < T * T; t++) {
          const tw = texW[t];
          const px = tx + f * T + (t % T), py = ty + Math.floor(t / T);
          const o = (py * rt.width + px) * 4;
          w.copy(fwd).addScaledVector(right, tw.x).addScaledVector(up, tw.y).normalize();
          for (let a = 0; a < 6; a++) {
            const c = w.dot(axes[a]);
            if (c <= 0) continue;
            const ww = c * tw.w;
            acc[a * 3] += buf[o] * ww;
            acc[a * 3 + 1] += buf[o + 1] * ww;
            acc[a * 3 + 2] += buf[o + 2] * ww;
            ws[a] += ww;
          }
        }
      }
      for (let a = 0; a < 6; a++) for (let c = 0; c < 3; c++) out[(i * 6 + a) * 3 + c] = acc[a * 3 + c] / ws[a];
    }
    onProgress(b1 / n);
    await new Promise((res) => setTimeout(res));
  }
  r.setRenderTarget(null);
  // cells buried in a wall borrow from their neighbours, so filtering never drags in black
  for (let pass = 0; pass < 6; pass++) {
    const nv = valid.slice();
    for (let i = 0; i < n; i++) {
      if (valid[i]) continue;
      const ix = i % dx, iy = Math.floor(i / dx) % dy, iz = Math.floor(i / (dx * dy));
      let c = 0;
      const s = new Float64Array(18);
      for (const [a, b, d] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = ix + a, Y = iy + b, Z = iz + d;
        if (X < 0 || Y < 0 || Z < 0 || X >= dx || Y >= dy || Z >= dz) continue;
        const j = X + Y * dx + Z * dx * dy;
        if (!valid[j]) continue;
        c++;
        for (let e = 0; e < 18; e++) s[e] += out[j * 18 + e];
      }
      if (c) {
        for (let e = 0; e < 18; e++) out[i * 18 + e] = s[e] / c;
        nv[i] = 1;
      }
    }
    valid.set(nv);
  }
  // encode: x + y*dx + (z + face*dz)*dx*dy, the same log curve as the lightmap
  const LOGR = L.map.lm.logr, K = L.map.lm.k;
  const bytes = new Uint8Array(n * 6 * 4);
  for (let i = 0; i < n; i++) {
    const ix = i % dx, iy = Math.floor(i / dx) % dy, iz = Math.floor(i / (dx * dy));
    for (let f = 0; f < 6; f++) {
      const o = (ix + iy * dx + (iz + f * dz) * dx * dy) * 4;
      for (let c = 0; c < 3; c++) bytes[o + c] = Math.round(255 * Math.min(1, Math.log2(1 + out[(i * 6 + f) * 3 + c] * K) / LOGR));
      bytes[o + 3] = 255;
    }
  }
  r.autoClear = true;
  LF.disc.value = 1;
  for (const o of hidden) o.visible = true;
  for (const d of L.doors) d.pivot.visible = true;
  for (const p of L.panes) p.mesh.visible = true;
  rt.dispose();
  return { bytes, meta: { dim: DIM, min: MIN, max: [MIN[0] + DIM[0] * STEP[0], MIN[1] + DIM[1] * STEP[1], MIN[2] + DIM[2] * STEP[2]] } };
}
