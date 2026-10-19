/**
 * The wild flowers in the long grass: daisies, dandelions and clover, as small detailed meshes
 * instanced a few hundred at a time. They stand just above the uncut grass and pop when the mower
 * reaches them (the lawn decides when; a popped flower is scaled to nothing).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FlowerDef } from './levels.ts';
import type { MaskField } from './mask.ts';

function colorize(g: THREE.BufferGeometry, r: number, gr: number, b: number) {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = r;
    c[i * 3 + 1] = gr;
    c[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  // (hand-built petals and leaves carry no uv: drop it everywhere so the pieces merge)
  g.deleteAttribute('uv');
  return g;
}

/** a petal: a long thin diamond, tipped up */
function petal(len: number, wid: number, ang: number, tilt: number, y: number, r0 = 0.004) {
  const g = new THREE.BufferGeometry();
  const p = [0, 0, 0, wid / 2, 0, len * 0.4, 0, 0, len, -wid / 2, 0, len * 0.4];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.translate(0, 0, r0);
  g.rotateX(-tilt);
  g.rotateY(ang);
  g.translate(0, y, 0);
  return g;
}

function stemGeo(h: number, bend: number, r: number) {
  const g = new THREE.CylinderGeometry(r * 0.7, r, h, 5, 3, true);
  g.translate(0, h / 2, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) + bend * y * y);
  }
  g.computeVertexNormals();
  return g;
}

function leaf(len: number, wid: number, ang: number, tilt: number) {
  const g = new THREE.BufferGeometry();
  const p = [0, 0, 0, wid / 2, 0, len * 0.35, 0, 0, len, -wid / 2, 0, len * 0.35];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.rotateX(-tilt);
  g.rotateY(ang);
  return g;
}

export interface Kind {
  head: THREE.BufferGeometry;
  stem: THREE.BufferGeometry;
  /** where the head sits (m, at scale 1) */
  top: number;
}

function daisy(): Kind {
  const top = 0.3;
  const heads: THREE.BufferGeometry[] = [];
  const n = 15;
  for (let i = 0; i < n; i++) heads.push(colorize(petal(0.034, 0.0095, (i / n) * Math.PI * 2, 0.12, top, 0.007), 1, 1, 1));
  for (let i = 0; i < n; i++) heads.push(colorize(petal(0.03, 0.009, ((i + 0.5) / n) * Math.PI * 2, 0.32, top - 0.002, 0.006), 0.96, 0.96, 0.96));
  const disc = new THREE.CylinderGeometry(0.0085, 0.01, 0.007, 14);
  disc.translate(0, top + 0.002, 0);
  heads.push(colorize(disc, 1, 0.74, 0.08));
  const stems: THREE.BufferGeometry[] = [colorize(stemGeo(top, 0.015, 0.0016), 0.28, 0.5, 0.16)];
  for (let i = 0; i < 3; i++) stems.push(colorize(leaf(0.07, 0.016, i * 2.1, 0.5), 0.26, 0.5, 0.15));
  return { head: mergeGeometries(heads)!, stem: mergeGeometries(stems)!, top };
}

function dandelion(): Kind {
  const top = 0.28;
  const heads: THREE.BufferGeometry[] = [];
  const n = 44;
  for (let i = 0; i < n; i++) {
    const ring = i % 2;
    heads.push(colorize(petal(0.022, 0.0042, (i / n) * Math.PI * 2 * 1.0 + ring, 0.35 + ring * 0.5, top + ring * 0.003, 0.003), 1, 1, 1));
  }
  const dome = new THREE.SphereGeometry(0.012, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, top, 0);
  heads.push(colorize(dome, 0.95, 0.8, 0.12));
  const stems: THREE.BufferGeometry[] = [colorize(stemGeo(top, -0.02, 0.0022), 0.4, 0.5, 0.25)];
  // the toothed rosette flat on the ground
  for (let i = 0; i < 8; i++) {
    const l = leaf(0.15, 0.03, (i / 8) * Math.PI * 2, 0.15);
    stems.push(colorize(l, 0.22, 0.44, 0.12));
  }
  return { head: mergeGeometries(heads)!, stem: mergeGeometries(stems)!, top };
}

function clover(): Kind {
  const top = 0.12;
  const ball = new THREE.IcosahedronGeometry(0.0125, 1);
  ball.scale(1, 1.15, 1);
  ball.translate(0, top, 0);
  const stems: THREE.BufferGeometry[] = [colorize(stemGeo(top - 0.01, 0.006, 0.0012), 0.3, 0.52, 0.2)];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      const l = new THREE.CircleGeometry(0.02, 8);
      l.rotateX(-Math.PI / 2 + 0.25);
      l.translate(0, 0, 0.026);
      l.rotateY(i * 1.6 + k * 2.09);
      l.translate(Math.cos(i * 2.1) * 0.04, 0.05 + i * 0.008, Math.sin(i * 2.1) * 0.04);
      stems.push(colorize(l, 0.2, 0.45, 0.14));
    }
  }
  return { head: colorize(ball, 1, 1, 1), stem: mergeGeometries(stems)!, top };
}

export const makeFlowerKinds = (): Kind[] => [daisy(), dandelion(), clover()];

export class FlowerField {
  readonly group = new THREE.Group();
  private heads: THREE.InstancedMesh[] = [];
  private stems: THREE.InstancedMesh[] = [];
  /** per flower: which mesh and which instance, and the cell it stands in */
  private idx: { kind: number; i: number; k: number; alive: boolean }[] = [];
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private counts = [0, 0, 0];

  constructor(readonly defs: FlowerDef[], mask: MaskField) {
    const kinds = makeFlowerKinds();
    const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
    const stemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    this.mats.push(headMat, stemMat);
    const by: number[][] = [[], [], []];
    defs.forEach((f, i) => by[f.kind].push(i));
    const c = new THREE.Color();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    kinds.forEach((kd, kind) => {
      const list = by[kind];
      this.geos.push(kd.head, kd.stem);
      const head = new THREE.InstancedMesh(kd.head, headMat, Math.max(1, list.length));
      const stem = new THREE.InstancedMesh(kd.stem, stemMat, Math.max(1, list.length));
      head.castShadow = stem.castShadow = false;
      head.receiveShadow = stem.receiveShadow = true;
      head.frustumCulled = stem.frustumCulled = false;
      list.forEach((fi, k) => {
        const f = defs[fi];
        const scale = (f.h / 0.2) * (kind === 2 ? 1 : 1);
        e.set(0, ((fi * 2.399) % 6.28), 0);
        q.setFromEuler(e);
        p.set(f.x, 0, f.z);
        s.set(scale, scale, scale);
        this.m.compose(p, q, s);
        head.setMatrixAt(k, this.m);
        stem.setMatrixAt(k, this.m);
        head.setColorAt(k, c.set(f.color));
        this.idx[fi] = { kind, i: k, k: mask.index(f.x, f.z), alive: true };
      });
      this.counts[kind] = list.length;
      if (!list.length) head.count = stem.count = 0;
      this.heads.push(head);
      this.stems.push(stem);
      this.group.add(head, stem);
    });
  }

  /** Pop every flower whose ground has been cut; returns the ones that went (for petals and score). */
  pop(mask: MaskField, out: FlowerDef[]) {
    out.length = 0;
    for (let fi = 0; fi < this.idx.length; fi++) {
      const r = this.idx[fi];
      if (!r || !r.alive) continue;
      if (r.k >= 0 && mask.state[r.k] !== 0) {
        r.alive = false;
        this.m.makeScale(0, 0, 0);
        this.heads[r.kind].setMatrixAt(r.i, this.m);
        this.stems[r.kind].setMatrixAt(r.i, this.m);
        this.heads[r.kind].instanceMatrix.needsUpdate = true;
        this.stems[r.kind].instanceMatrix.needsUpdate = true;
        out.push(this.defs[fi]);
      }
    }
  }

  dispose() {
    this.heads.forEach((h) => h.dispose());
    this.stems.forEach((h) => h.dispose());
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
  }
}
