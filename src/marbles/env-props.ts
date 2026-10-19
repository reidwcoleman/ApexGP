import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The toy box beyond the course: islands of wooden blocks floating over the paint (a turned
 * wooden plinth, layered like plywood underneath, a painted top with towers of rounded blocks,
 * cylinders and roof prisms stacked on it) and hot-air balloons in candy stripes drifting round at
 * the course's height and above. All of it far away, so it is built for the silhouette and the
 * colour: vertex-coloured enamel, everything of a kind merged into one mesh (a handful of draws for
 * the lot), casting its shadow on the paint.
 */

const TOY = [0xe8322f, 0x2f74ff, 0xffc81e, 0x2fbf5a, 0x8a4bff, 0xff8a1f, 0xff5fa8, 0x1fc8c0, 0xfff4e4];

function paintGeo(g: THREE.BufferGeometry, hex: number, k = 1) {
  const g2 = g.index ? g.toNonIndexed() : g;
  const n = g2.getAttribute('position').count;
  const c = new THREE.Color(hex).multiplyScalar(k);
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g2.setAttribute('color', new THREE.BufferAttribute(a, 3));
  // (only what every piece shares, so they merge)
  for (const k2 of Object.keys(g2.attributes)) if (!['position', 'normal', 'color'].includes(k2)) g2.deleteAttribute(k2);
  return g2;
}

/** a floating island: plinth, top, and a few stacks of blocks; geometry in island-local metres */
function island(rnd: () => number, R: number, wood: THREE.BufferGeometry[], enamel: THREE.BufferGeometry[]) {
  // the plinth: a turned top, then plywood steps tapering to a point underneath
  const prof: THREE.Vector2[] = [new THREE.Vector2(0.001, 0), new THREE.Vector2(R * 0.98, 0), new THREE.Vector2(R, -0.6), new THREE.Vector2(R * 0.96, -1.6)];
  let r = R * 0.96, y = -1.6;
  const steps = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < steps; i++) {
    const nr = r * (0.7 + rnd() * 0.12);
    const dy = R * (0.12 + rnd() * 0.08);
    prof.push(new THREE.Vector2(nr, y - 0.3), new THREE.Vector2(nr, y - dy));
    r = nr;
    y -= dy;
  }
  prof.push(new THREE.Vector2(0.001, y - R * 0.15));
  const plinth = new THREE.LatheGeometry(prof, 28);
  // (plywood: light and dark plies by height)
  const pp = plinth.getAttribute('position');
  const col = new Float32Array(pp.count * 3);
  const a = new THREE.Color(0xd9a86a), b = new THREE.Color(0x9a6a3a), t = new THREE.Color();
  for (let i = 0; i < pp.count; i++) {
    const yy = pp.getY(i);
    t.copy(a).lerp(b, Math.floor(-yy / (R * 0.06)) % 2 ? 0.55 : 0.05);
    t.toArray(col, i * 3);
  }
  plinth.setAttribute('color', new THREE.BufferAttribute(col, 3));
  plinth.deleteAttribute('uv');
  wood.push(plinth);
  // the painted top: a play mat
  const top = new THREE.CylinderGeometry(R * 0.97, R * 0.97, 0.5, 40);
  top.translate(0, 0.2, 0);
  enamel.push(paintGeo(top, rnd() < 0.5 ? 0x7fd8a8 : 0xfff1dc));
  // the stacks
  const stacks = 3 + Math.floor(rnd() * 4);
  for (let s = 0; s < stacks; s++) {
    const ang = rnd() * Math.PI * 2, d = R * (0.15 + rnd() * 0.6);
    let x = Math.cos(ang) * d, z = Math.sin(ang) * d, h = 0.45;
    const n = 2 + Math.floor(rnd() * 4);
    const rot = rnd() * Math.PI;
    for (let k = 0; k < n; k++) {
      const kind = rnd();
      const sz = R * (0.12 + rnd() * 0.1) * (1 - k * 0.1);
      let g: THREE.BufferGeometry;
      let gh: number;
      if (k === n - 1 && kind < 0.45) {
        // a roof: a triangular prism
        const sh = new THREE.Shape([new THREE.Vector2(-sz, 0), new THREE.Vector2(sz, 0), new THREE.Vector2(0, sz * 0.9)]);
        g = new THREE.ExtrudeGeometry(sh, { depth: sz * 1.6, bevelEnabled: true, bevelSize: sz * 0.06, bevelThickness: sz * 0.06, bevelSegments: 2 });
        g.translate(0, 0, -sz * 0.8);
        gh = sz * 0.9;
      } else if (kind < 0.3) {
        g = new THREE.CylinderGeometry(sz * 0.8, sz * 0.8, sz * 1.6, 24);
        g.translate(0, sz * 0.8, 0);
        gh = sz * 1.6;
      } else {
        const w = sz * 2, hh = sz * (1.4 + rnd() * 0.8);
        g = new RoundedBoxGeometry(w, hh, w, 2, sz * 0.14);
        g.translate(0, hh / 2, 0);
        gh = hh;
      }
      g.rotateY(rot + k * 0.2);
      g.translate(x, h, z);
      enamel.push(paintGeo(g, TOY[Math.floor(rnd() * TOY.length)]));
      h += gh;
      x += (rnd() - 0.5) * sz * 0.2;
      z += (rnd() - 0.5) * sz * 0.2;
    }
  }
}

/** a hot-air balloon, its envelope's gores in two colours, basket below; local metres, basket at 0 */
function balloon(rnd: () => number, S: number, env: THREE.BufferGeometry[], basket: THREE.BufferGeometry[]) {
  const prof: THREE.Vector2[] = [];
  // (the classic shape: a sphere drawn down into a cone to the mouth)
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const ang = -Math.PI * 0.5 + u * Math.PI;
    const rr = Math.cos(ang) * (u < 0.45 ? 0.55 + u * 1.0 : 1);
    const yy = Math.sin(ang) * (u < 0.45 ? 1.15 : 1);
    prof.push(new THREE.Vector2(Math.max(0.001, rr * S), (yy + 1.15) * S));
  }
  prof[0].x = S * 0.28;
  const seg = 16;
  const g = new THREE.LatheGeometry(prof, seg * 2).toNonIndexed();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c1 = new THREE.Color(TOY[Math.floor(rnd() * 8)]), c2 = new THREE.Color(rnd() < 0.5 ? 0xfff4e4 : TOY[Math.floor(rnd() * 8)]);
  const band = new THREE.Color(TOY[Math.floor(rnd() * 8)]);
  const tc = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    // (one colour per triangle: the gore it belongs to)
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const gore = Math.floor(((Math.atan2(cz, cx) / (Math.PI * 2) + 1) % 1) * seg);
    tc.copy(gore % 2 ? c1 : c2);
    if (Math.abs(cy / S - 1.25) < 0.1) tc.copy(band);
    for (let j = 0; j < 3; j++) tc.toArray(col, (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.translate(0, S * 0.32, 0);
  env.push(g);
  const b = new THREE.CylinderGeometry(S * 0.16, S * 0.13, S * 0.18, 12);
  b.translate(0, S * 0.09, 0);
  basket.push(paintGeo(b, 0x9a6438));
}

interface Item {
  /** geometry per material, in the item's own frame */
  parts: THREE.BufferGeometry[];
  /** its half-width (m) */
  size: number;
  /** height band above the paint (m) and the angle / distance draws, fixed per item */
  y: number;
  a: number;
  d: number;
  turn: number;
}

const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)));

export class Props {
  readonly group = new THREE.Group();
  private balloons = new THREE.Group();
  private islands: Item[] = [];
  private flyers: Item[] = [];
  private mats: THREE.Material[];

  constructor(seed = 21) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const enamelMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const nylonMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide });
    this.mats = [woodMat, enamelMat, nylonMat, woodMat];
    const N = 7;
    for (let k = 0; k < N; k++) {
      const wood: THREE.BufferGeometry[] = [], enamel: THREE.BufferGeometry[] = [];
      const R = 14 + rnd() * 14;
      island(rnd, R, wood, enamel);
      this.islands.push({ parts: [merge(wood), merge(enamel)], size: R, y: 26 + rnd() * 70, a: (k / N) * Math.PI * 2 + rnd() * 0.5, d: rnd(), turn: rnd() * 6 });
    }
    for (let k = 0; k < 6; k++) {
      const env: THREE.BufferGeometry[] = [], bas: THREE.BufferGeometry[] = [];
      const S = 11 + rnd() * 7;
      balloon(rnd, S, env, bas);
      this.flyers.push({ parts: [env[0], bas[0]], size: S, y: 50 + rnd() * 140, a: rnd() * Math.PI * 2, d: rnd(), turn: rnd() * 6 });
    }
    this.group.add(this.balloons);
    this.layout(160);
  }

  /** places everything clear of a course that reaches `clear` metres out from its centre */
  layout(clear: number) {
    for (const o of [...this.group.children, ...this.balloons.children]) if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    this.group.remove(...this.group.children.filter((o) => o !== this.balloons));
    this.balloons.clear();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    const build = (items: Item[], near: number, far: number, mats: THREE.Material[], into: THREE.Object3D) => {
      const lists: THREE.BufferGeometry[][] = mats.map(() => []);
      for (const it of items) {
        const r = clear + it.size + near + it.d * far;
        m.compose(at.set(Math.cos(it.a) * r, it.y, Math.sin(it.a) * r), q.setFromAxisAngle(up, it.turn), one);
        it.parts.forEach((g, i) => lists[i].push(g.clone().applyMatrix4(m)));
      }
      lists.forEach((l, i) => {
        const o = new THREE.Mesh(merge(l), mats[i]);
        o.castShadow = o.receiveShadow = true;
        into.add(o);
      });
    };
    build(this.islands, 40, 260, [this.mats[0], this.mats[1]], this.group);
    build(this.flyers, 30, 320, [this.mats[2], this.mats[3]], this.balloons);
  }

  update(t: number) {
    // (the wind carries the balloons slowly round, rising and sinking a little)
    this.balloons.rotation.y = t * 0.004;
    this.balloons.position.y = Math.sin(t * 0.3) * 1.5;
  }
}
