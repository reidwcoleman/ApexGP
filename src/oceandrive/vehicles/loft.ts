import * as THREE from 'three';

/**
 * Vehicle bodies as lofts: a cross-section ring at each station along the car, built from
 * bands (floor, rocker, flank, shoulder, glasshouse, roof…). Each band is its own smooth surface,
 * so the edges between bands are crisp creases — the chine and shoulder lines of a wedge — while
 * the surface along the car stays smooth. Each quad picks its material slot by where it is (glass
 * in the glasshouse span, paint elsewhere), and quads inside the door spans go to the door meshes
 * so the doors can open.
 *
 * Car frame: +x left, +y up, +z forward, origin on the ground under the middle of the wheelbase.
 * Rings are given for the left half (x >= 0) and mirrored.
 */

export interface Band {
  /** points of this band on the left half, from its lower/inner edge to its upper edge */
  pts: [number, number][];
}

export interface Station {
  z: number;
  bands: Band[];
}

export interface LoftSpec {
  stations: Station[];
  /** which material slot a quad of band `b` at station-midpoint z (and height y) uses */
  slot(b: number, z: number, y: number, x: number): string;
  /** door spans: quads of these bands whose midpoint z is in [z0, z1] go to the door (per side) */
  door?: { bands: number[]; z0: number; z1: number };
  /** cap the first / last ring (nose / tail) */
  capFront?: string;
  capRear?: string;
}

export interface LoftResult {
  /** geometry per material slot (both sides) */
  slots: Map<string, THREE.BufferGeometry>;
  /** door geometry per side and slot */
  doors: { left: Map<string, THREE.BufferGeometry>; right: Map<string, THREE.BufferGeometry> };
}

class Acc {
  pos: number[] = [];
  uv: number[] = [];
  band: number[] = [];
  idx: number[] = [];
  /** vertex dedupe per (band, station, point, side) so a band is one smooth surface */
  map = new Map<string, number>();
  vert(key: string, x: number, y: number, z: number, u: number, v: number, band: number): number {
    const k = this.map.get(key);
    if (k !== undefined) return k;
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.band.push(band);
    this.map.set(key, i);
    return i;
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBand', new THREE.Float32BufferAttribute(this.band, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function loft(spec: LoftSpec): LoftResult {
  const accs = new Map<string, Acc>();
  const doorAccs = { left: new Map<string, Acc>(), right: new Map<string, Acc>() };
  const get = (m: Map<string, Acc>, k: string) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = new Acc()));
    return a;
  };
  const S = spec.stations;
  const nb = S[0].bands.length;
  for (let b = 0; b < nb; b++) {
    const np = S[0].bands[b].pts.length;
    for (let i = 0; i + 1 < S.length; i++) {
      const s0 = S[i], s1 = S[i + 1];
      for (let k = 0; k + 1 < np; k++) {
        const p00 = s0.bands[b].pts[k], p01 = s0.bands[b].pts[k + 1];
        const p10 = s1.bands[b].pts[k], p11 = s1.bands[b].pts[k + 1];
        const zm = (s0.z + s1.z) / 2, ym = (p00[1] + p01[1] + p10[1] + p11[1]) / 4, xm = (p00[0] + p01[0] + p10[0] + p11[0]) / 4;
        const slot = spec.slot(b, zm, ym, xm);
        const inDoor = spec.door && spec.door.bands.includes(b) && zm >= spec.door.z0 && zm <= spec.door.z1;
        for (const side of [1, -1]) {
          const acc = inDoor ? get(side > 0 ? doorAccs.left : doorAccs.right, slot) : get(accs, slot);
          const key = (st: number, pt: number) => `${b}:${st}:${pt}:${side}`;
          const V = (st: Station, si: number, pt: number) => {
            const p = st.bands[b].pts[pt];
            return acc.vert(key(si, pt), p[0] * side, p[1], st.z, st.z, pt / (np - 1), b);
          };
          const a = V(s0, i, k), bq = V(s0, i, k + 1), c = V(s1, i + 1, k + 1), d = V(s1, i + 1, k);
          // stations run front → back (z decreasing), points run up/inward: outward winding per side
          if (side > 0) acc.idx.push(a, d, c, a, c, bq);
          else acc.idx.push(a, c, d, a, bq, c);
        }
      }
    }
  }
  // caps: a fan over the whole ring
  const cap = (st: Station, front: boolean, slot: string) => {
    const acc = get(accs, slot + (front ? ':capF' : ':capR'));
    const ring: [number, number][] = [];
    for (const bd of st.bands) for (const p of bd.pts) if (!ring.length || ring[ring.length - 1][0] !== p[0] || ring[ring.length - 1][1] !== p[1]) ring.push(p);
    // left half then mirrored right half (reverse) makes a closed outline
    const full = [...ring.map((p) => [p[0], p[1]]), ...ring.slice().reverse().map((p) => [-p[0], p[1]])];
    let cy = 0;
    for (const p of full) cy += p[1];
    cy /= full.length;
    const c = acc.vert('c', 0, cy, st.z, 0.5, 0.5, -1);
    const ids = full.map((p, i) => acc.vert('r' + i, p[0], p[1], st.z, p[0], p[1], -1));
    for (let i = 0; i + 1 < ids.length; i++) {
      if (front) acc.idx.push(c, ids[i], ids[i + 1]);
      else acc.idx.push(c, ids[i + 1], ids[i]);
    }
  };
  if (spec.capFront) cap(S[0], true, spec.capFront);
  if (spec.capRear) cap(S[S.length - 1], false, spec.capRear);

  const slots = new Map<string, THREE.BufferGeometry>();
  const merged = new Map<string, THREE.BufferGeometry[]>();
  for (const [k, a] of accs) {
    const g = a.build();
    if (!g) continue;
    const name = k.split(':')[0];
    let l = merged.get(name);
    if (!l) merged.set(name, (l = []));
    l.push(g);
  }
  for (const [k, l] of merged) slots.set(k, l.length === 1 ? l[0] : mergeGeos(l));
  const doors = { left: new Map<string, THREE.BufferGeometry>(), right: new Map<string, THREE.BufferGeometry>() };
  for (const side of ['left', 'right'] as const) for (const [k, a] of doorAccs[side]) {
    const g = a.build();
    if (g) doors[side].set(k, g);
  }
  return { slots, doors };
}

export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], band: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv'), b = g.getAttribute('aBand');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      band.push(b ? b.getX(i) : 0);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('aBand', new THREE.Float32BufferAttribute(band, 1));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** monotone cubic interpolation of a table [z, value] (no overshoot between rows) */
export function table(rows: [number, number][]): (z: number) => number {
  const r = rows.slice().sort((a, b) => a[0] - b[0]);
  const n = r.length;
  const d: number[] = [];
  for (let i = 0; i + 1 < n; i++) d.push((r[i + 1][1] - r[i][1]) / (r[i + 1][0] - r[i][0]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  // Fritsch–Carlson
  for (let i = 0; i + 1 < n; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (z: number) => {
    if (z <= r[0][0]) return r[0][1];
    if (z >= r[n - 1][0]) return r[n - 1][1];
    let i = 0;
    while (i + 1 < n && r[i + 1][0] < z) i++;
    const h = r[i + 1][0] - r[i][0];
    const t = (z - r[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * r[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * r[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

/** a lathe (tyres, rims, nozzles): profile [radius, x] around the x axis */
export function latheX(profile: [number, number][], seg: number): THREE.BufferGeometry {
  const pts = profile.map(([r, x]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, seg);
  // lathe is around y: rotate so the axis is x
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
