import * as THREE from 'three';

/** a growing indexed mesh: position, normal, uv and the two track-space attributes the materials read */
export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  trk: number[] = [];
  k: number[] = [];
  idx: number[] = [];

  get count() {
    return this.pos.length / 3;
  }

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, t: [number, number, number, number] = [0, 0, 0, 0], k: [number, number, number, number] = [0, 0, 0, 0]): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.trk.push(t[0], t[1], t[2], t[3]);
    this.k.push(k[0], k[1], k[2], k[3]);
    return i;
  }

  /** a quad a-b-c-d (in order round its edge), wound so it faces `face` */
  quad(a: number, b: number, c: number, d: number, face?: THREE.Vector3) {
    if (face) {
      const P = this.pos;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
      const e2x = P[d * 3] - ax, e2y = P[d * 3 + 1] - ay, e2z = P[d * 3 + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (nx * face.x + ny * face.y + nz * face.z < 0) {
        this.idx.push(a, d, b, b, d, c);
        return;
      }
    }
    this.idx.push(a, b, d, b, c, d);
  }

  /** an axis-aligned box in a local frame (origin o, unit axes x/y/z), sizes along each */
  box(o: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3, sx: number, sy: number, sz: number, uvScale = 1) {
    const c = (i: number, j: number, k: number) => o.clone().addScaledVector(ax, i * sx).addScaledVector(ay, j * sy).addScaledVector(az, k * sz);
    const faces: [THREE.Vector3, [number, number, number][], number, number][] = [
      [ax.clone().negate(), [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], sz, sy],
      [ax.clone(), [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], sz, sy],
      [az.clone().negate(), [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], sx, sy],
      [az.clone(), [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], sx, sy],
      [ay.clone(), [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], sx, sz],
      [ay.clone().negate(), [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], sx, sz],
    ];
    const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [n, cs, su, sv] of faces) {
      const v = cs.map((q, m) => this.vert(c(q[0], q[1], q[2]), n, uvs[m][0] * su * uvScale, uvs[m][1] * sv * uvScale, [uvs[m][1] * sv, uvs[m][0] * su, 0, 0]));
      this.quad(v[0], v[1], v[2], v[3], n);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTrk', new THREE.Float32BufferAttribute(this.trk, 4));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** geometry sorted into (material, stretch of lap) buckets, each one mesh: culled a stretch at a time */
export class Buckets {
  private readonly map = new Map<string, Geo>();
  constructor(private readonly chunk: number) {}

  at(material: string, s: number): Geo {
    const key = `${material}:${Math.floor(s / this.chunk)}`;
    let g = this.map.get(key);
    if (!g) this.map.set(key, (g = new Geo()));
    return g;
  }

  /** every bucket as a mesh under `group`; returns the triangle count */
  finish(group: THREE.Group, materials: Record<string, { material: THREE.Material; cast?: boolean; receive?: boolean; order?: number }>): number {
    let tris = 0;
    for (const [key, g] of this.map) {
      if (!g.idx.length) continue;
      const name = key.split(':')[0];
      const def = materials[name];
      const mesh = new THREE.Mesh(g.build(), def.material);
      mesh.name = `mz_${key}`;
      mesh.castShadow = def.cast ?? false;
      mesh.receiveShadow = def.receive ?? true;
      if (def.order !== undefined) mesh.renderOrder = def.order;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      tris += g.idx.length / 3;
    }
    return tris;
  }
}
