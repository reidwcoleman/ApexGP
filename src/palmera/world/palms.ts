import * as THREE from 'three';

/**
 * Palms: a ringed, leaning trunk (bark scan) and a crown of arched fronds cut from a frond picture
 * (alpha-tested, folded along the rib so they catch the light like the real thing), with a few
 * brown dead fronds hanging under the crown and a cluster of coconuts. Same 8 m frame and lean as
 * the old palms, so the sway shader and the placements carry over.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'palmera/tex/';
const H = 8;
const TOP_X = 0.9;
const loader = new THREE.TextureLoader();

function tex(name: string, srgb: boolean, repeat = false) {
  const t = loader.load(BASE + name);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const lean = (y: number) => TOP_X * (y / H) ** 2;

function trunkGeo(radial: number, rows: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, y = t * (H + 0.25);
    // a swollen foot, a slim neck, and the leaf-scar rings
    const ring = 1 + 0.06 * Math.max(0, Math.sin(y * 18)) ** 4;
    const r = (0.17 + 0.1 * (1 - t) + 0.1 * Math.max(0, 0.12 - t) * 8) * ring;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      pos.push(lean(y) + Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push((i / radial) * 2, y / 0.9);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface FrondSpec { a: number; len: number; up: number; droop: number; width: number; dry: boolean }

function crownGeo(count: number, segs: number, seed: number): THREE.BufferGeometry {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const fronds: FrondSpec[] = [];
  for (let k = 0; k < count; k++) {
    const tier = k % 3;
    fronds.push({
      a: (k / count) * Math.PI * 2 + rnd() * 0.4,
      len: 3.4 + rnd() * 0.9,
      up: tier === 0 ? 0.9 : tier === 1 ? 0.45 : 0.05,
      droop: tier === 0 ? 1.6 : tier === 1 ? 2.3 : 3.0,
      width: 1.5 + rnd() * 0.35,
      dry: false,
    });
  }
  // dead fronds hanging under the crown
  const dead = Math.max(1, Math.round(count / 5));
  for (let k = 0; k < dead; k++) fronds.push({ a: rnd() * Math.PI * 2, len: 2.6 + rnd() * 0.6, up: -0.6, droop: 3.4, width: 0.6, dry: true });
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const idxG: number[] = [], idxD: number[] = [];
  const base = new THREE.Vector3(TOP_X, H + 0.05, 0);
  for (const f of fronds) {
    const ca = Math.cos(f.a), sa = Math.sin(f.a);
    const v0 = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const r = 0.12 + t * f.len;
      const y = base.y + f.up * t * 1.6 - f.droop * t * t;
      const cx = base.x + ca * r, cz = base.z + sa * r;
      // the frond narrows to the tip; its leaflets fold up from the rib in a shallow V
      const w = f.width * 0.5 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + t)));
      const fold = 0.18 * w;
      // the curve's tangent, for the normals
      const dy = f.up * 1.6 - 2 * f.droop * t;
      const tan = new THREE.Vector3(ca * f.len, dy, sa * f.len).normalize();
      const side = new THREE.Vector3(-sa, 0, ca);
      const n = new THREE.Vector3().crossVectors(side, tan).normalize();
      if (n.y < 0) n.negate();
      const pts: [number, number, number][] = [
        [cx - side.x * w, y + fold, cz - side.z * w],
        [cx, y, cz],
        [cx + side.x * w, y + fold, cz + side.z * w],
      ];
      pts.forEach((p, k) => {
        pos.push(...p);
        nor.push(n.x + side.x * (k - 1) * 0.3, n.y, n.z + side.z * (k - 1) * 0.3);
        uv.push(k * 0.5, t);
      });
    }
    const out = f.dry ? idxD : idxG;
    for (let i = 0; i < segs; i++) {
      const a = v0 + i * 3, b = a + 3;
      out.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
  }
  // coconuts: small spheres tucked under the crown
  const nut = new THREE.SphereGeometry(0.11, 6, 5);
  const nv0 = pos.length / 3;
  const np = nut.getAttribute('position'), nn = nut.getAttribute('normal');
  const nIdx: number[] = [];
  for (let c = 0; c < 5; c++) {
    const a = (c / 5) * Math.PI * 2;
    const ox = TOP_X + Math.cos(a) * 0.22, oy = H - 0.15 - (c % 2) * 0.12, oz = Math.sin(a) * 0.22;
    const off = pos.length / 3;
    for (let i = 0; i < np.count; i++) {
      pos.push(np.getX(i) + ox, np.getY(i) + oy, np.getZ(i) + oz);
      nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      uv.push(0.5, 0.02); // the frond picture's stem: brown
    }
    const ix = nut.getIndex()!;
    for (let i = 0; i < ix.count; i++) nIdx.push(ix.getX(i) + off);
  }
  void nv0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idxG, ...nIdx, ...idxD]);
  g.addGroup(0, idxG.length + nIdx.length, 0);
  g.addGroup(idxG.length + nIdx.length, idxD.length, 1);
  g.computeBoundingSphere();
  return g;
}

export interface PalmKit {
  trunk: THREE.BufferGeometry;
  trunkLo: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
  crownLo: THREE.BufferGeometry;
  trunkMat: THREE.MeshStandardMaterial;
  frondMat: THREE.MeshStandardMaterial;
  dryMat: THREE.MeshStandardMaterial;
}

export function palmKit(): PalmKit {
  const trunkMat = new THREE.MeshStandardMaterial({
    map: tex('palm_tree_bark_diff.webp', true, true),
    normalMap: tex('palm_tree_bark_nor.webp', false, true),
    roughnessMap: tex('palm_tree_bark_rough.webp', false, true),
    color: 0xd8cbb8,
  });
  const frondMat = new THREE.MeshStandardMaterial({
    map: tex('palm_frond.webp', true),
    normalMap: tex('palm_frond_n.webp', false),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.62,
    color: 0xe8f0d0,
  });
  const dryMat = new THREE.MeshStandardMaterial({ map: tex('palm_frond_dry.webp', true), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9 });
  return {
    trunk: trunkGeo(10, 18),
    trunkLo: trunkGeo(5, 4),
    crown: crownGeo(20, 9, 7),
    crownLo: crownGeo(9, 3, 7),
    trunkMat,
    frondMat,
    dryMat,
  };
}
