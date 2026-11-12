import * as THREE from 'three';

/**
 * The avatars are game-crowd meshes: an arm is eight flat sides and a finger six, which is nothing at fifty metres and
 * everything when the arm is your own and fills a third of the frame. This rounds them. Every triangle is cut in four and
 * the new corners are pushed out onto the curve the old corners' normals describe (Phong tessellation), so a tube of flats
 * becomes a tube; done twice, a finger has no corners left. Skin weights, the unwrap and the part numbers go with them.
 */
const cache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

export function refine(src: THREE.BufferGeometry, levels: number, parts: number[] | null, tag: string): THREE.BufferGeometry {
  if (levels <= 0 || !src.index) return src;
  let per = cache.get(src);
  if (!per) cache.set(src, (per = new Map()));
  const hit = per.get(tag);
  if (hit) return hit;
  const P = [...(src.getAttribute('position').array as Float32Array)];
  const N = [...(src.getAttribute('normal').array as Float32Array)];
  const U = [...(src.getAttribute('uv').array as Float32Array)];
  const SI = [...(src.getAttribute('skinIndex').array as Uint16Array)];
  const SW = [...(src.getAttribute('skinWeight').array as Float32Array)];
  const A = [...(src.getAttribute('aPart').array as Float32Array)];
  let idx = [...(src.index.array as Uint16Array | Uint32Array)];
  const want = parts ? new Set(parts) : null;
  const ALPHA = 0.72;
  for (let lv = 0; lv < levels; lv++) {
    const mids = new Map<number, number>();
    const count0 = P.length / 3;
    const mid = (a: number, b: number) => {
      const key = a < b ? a * count0 + b : b * count0 + a;
      const got = mids.get(key);
      if (got !== undefined) return got;
      const i = P.length / 3;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const nax = N[a * 3], nay = N[a * 3 + 1], naz = N[a * 3 + 2], nbx = N[b * 3], nby = N[b * 3 + 1], nbz = N[b * 3 + 2];
      // each end's tangent plane pulls the middle toward itself
      const da = (mx - ax) * nax + (my - ay) * nay + (mz - az) * naz, db = (mx - bx) * nbx + (my - by) * nby + (mz - bz) * nbz;
      P.push(mx - ALPHA * 0.5 * (da * nax + db * nbx), my - ALPHA * 0.5 * (da * nay + db * nby), mz - ALPHA * 0.5 * (da * naz + db * nbz));
      let nx = nax + nbx, ny = nay + nby, nz = naz + nbz;
      const l = Math.hypot(nx, ny, nz) || 1;
      N.push((nx /= l), (ny /= l), (nz /= l));
      U.push((U[a * 2] + U[b * 2]) / 2, (U[a * 2 + 1] + U[b * 2 + 1]) / 2);
      A.push(A[a]);
      // the bones of both ends, the four that matter most
      const w = new Map<number, number>();
      for (const v of [a, b]) for (let c = 0; c < 4; c++) { const k = SW[v * 4 + c]; if (k > 0) w.set(SI[v * 4 + c], (w.get(SI[v * 4 + c]) ?? 0) + k * 0.5); }
      const top = [...w.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
      const sum = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let c = 0; c < 4; c++) { SI.push(top[c]?.[0] ?? 0); SW.push((top[c]?.[1] ?? 0) / sum); }
      mids.set(key, i);
      return i;
    };
    const next: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (want && !(want.has(Math.round(A[a])) && want.has(Math.round(A[b])) && want.has(Math.round(A[c])))) { next.push(a, b, c); continue; }
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    idx = next;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
  g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.boundingSphere = src.boundingSphere?.clone() ?? null;
  g.boundingBox = src.boundingBox?.clone() ?? null;
  per.set(tag, g);
  return g;
}
