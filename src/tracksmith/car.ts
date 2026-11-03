import * as THREE from 'three';
import { WHEEL_R } from './sim.ts';

/**
 * The car: a faceted wedge lofted from a few cross-sections (Tracksmith's own shape), four wheels,
 * a wing and lights. The model's origin is the physics body's centre; the floor sits at y = -0.6.
 */
type Sec = { z: number; pts: [number, number][] }; // right half, bottom centre -> top centre

const FLOOR = -0.62;

function loft(secs: Sec[], colors: number[], capStart: number | null, capEnd: number | null): THREE.BufferGeometry {
  const pos: number[] = [], cols: number[] = [];
  const c = new THREE.Color();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3(), g = new THREE.Vector3();
  // every triangle faces away from `inside` (a point on the section's centre axis)
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, hex: number, inside: THREE.Vector3) => {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a));
    g.copy(a).add(b).add(d).multiplyScalar(1 / 3).sub(inside);
    const list = n.dot(g) < 0 ? [a, d, b] : [a, b, d];
    c.setHex(hex);
    for (const p of list) { pos.push(p.x, p.y, p.z); cols.push(c.r, c.g, c.b); }
  };
  const P = (s: Sec, k: number, side: number) => new THREE.Vector3(s.pts[k][0] * side, s.pts[k][1] + FLOOR, s.z);
  const mid = (s: Sec) => s.pts.reduce((acc, p) => acc + p[1], 0) / s.pts.length + FLOOR;
  for (let i = 0; i < secs.length - 1; i++) {
    const A = secs[i], B = secs[i + 1];
    const inside = new THREE.Vector3(0, (mid(A) + mid(B)) / 2 - 0.05, (A.z + B.z) / 2);
    for (let k = 0; k < A.pts.length - 1; k++) {
      const hex = colors[k] ?? colors[colors.length - 1];
      for (const side of [1, -1]) {
        const a = P(A, k, side), b = P(A, k + 1, side), d = P(B, k + 1, side), e = P(B, k, side);
        tri(a, b, d, hex, inside);
        tri(a, d, e, hex, inside);
      }
    }
  }
  const cap = (s: Sec, hex: number, dir: number) => {
    const ctr = new THREE.Vector3(0, mid(s), s.z);
    const inside = ctr.clone().add(new THREE.Vector3(0, 0, -dir));
    for (const side of [1, -1]) for (let k = 0; k < s.pts.length - 1; k++) tri(ctr, P(s, k, side), P(s, k + 1, side), hex, inside);
  };
  if (capStart !== null) cap(secs[0], capStart, -1);
  if (capEnd !== null) cap(secs[secs.length - 1], capEnd, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

const BODY: Sec[] = [
  { z: -2.08, pts: [[0, 0.3], [0.8, 0.32], [0.9, 0.56], [0.84, 0.8], [0, 0.82]] },
  { z: -1.7, pts: [[0, 0.2], [0.94, 0.22], [1.0, 0.54], [0.92, 0.84], [0, 0.88]] },
  { z: -0.6, pts: [[0, 0.17], [0.96, 0.18], [1.02, 0.5], [0.94, 0.8], [0, 0.84]] },
  { z: 0.75, pts: [[0, 0.17], [0.96, 0.18], [1.0, 0.46], [0.92, 0.66], [0, 0.7]] },
  { z: 1.7, pts: [[0, 0.2], [0.9, 0.22], [0.94, 0.4], [0.84, 0.52], [0, 0.56]] },
  { z: 2.2, pts: [[0, 0.24], [0.76, 0.26], [0.8, 0.34], [0.7, 0.4], [0, 0.42]] },
];
const CABIN: Sec[] = [
  { z: -1.45, pts: [[0.84, 0.84], [0.6, 1.12], [0, 1.14]] },
  { z: -0.55, pts: [[0.9, 0.82], [0.66, 1.26], [0, 1.3]] },
  { z: 0.15, pts: [[0.9, 0.76], [0.64, 1.2], [0, 1.24]] },
  { z: 0.95, pts: [[0.9, 0.68], [0.86, 0.7], [0, 0.72]] },
];

export interface CarLook { paint: number; accent: number }

export class CarView {
  root = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  paintMat: THREE.MeshStandardMaterial;
  private mats: THREE.Material[] = [];
  brake: THREE.MeshBasicMaterial;
  flame: THREE.Mesh;

  constructor(look: CarLook, ghost = false) {
    const mat = (m: THREE.Material) => { this.mats.push(m); return m; };
    this.paintMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.38, metalness: 0.15 })) as THREE.MeshStandardMaterial;
    const P = 0xffffff; // paint: tinted by the material colour
    const body = new THREE.Mesh(loft(BODY, [0x1c1e24, P, P, P], 0x1c1e24, 0x1c1e24), this.paintMat);
    const cabin = new THREE.Mesh(loft(CABIN, [0x161a22, P], 0x161a22, 0x161a22), mat(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.2, metalness: 0.3 })));
    this.body.add(body, cabin);
    // the cabin is dark glass with a painted roof: tint only the roof strip by sharing paint via a second mesh
    const roof = new THREE.Mesh(loft(CABIN.map((s) => ({ z: s.z, pts: s.pts.slice(1).map(([x, y]) => [x * 0.995, y + 0.005] as [number, number]) })), [P], null, null), this.paintMat);
    this.body.add(roof);

    // wing
    const dark = mat(new THREE.MeshStandardMaterial({ color: 0x1b1d23, flatShading: true, roughness: 0.6 }));
    const accentMat = mat(new THREE.MeshStandardMaterial({ color: look.accent, flatShading: true, roughness: 0.4 }));
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.34, 0.2), dark);
      post.position.set(s * 0.55, FLOOR + 0.98, -1.86);
      this.body.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.5), accentMat);
      plate.position.set(s * 0.93, FLOOR + 1.12, -1.9);
      this.body.add(plate);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 0.5), accentMat);
    wing.position.set(0, FLOOR + 1.16, -1.9);
    wing.rotation.x = -0.08;
    this.body.add(wing);
    // stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 1.5), accentMat);
    stripe.position.set(0, FLOOR + 0.655, 1.38);
    stripe.rotation.x = 0.13;
    this.body.add(stripe);

    // lights
    const head = mat(new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
    this.brake = mat(new THREE.MeshBasicMaterial({ color: 0x7a0d12 })) as THREE.MeshBasicMaterial;
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.06), head);
      h.position.set(s * 0.5, FLOOR + 0.36, 2.2);
      h.rotation.y = s * 0.2;
      this.body.add(h);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.05), this.brake);
    tail.position.set(0, FLOOR + 0.64, -2.09);
    this.body.add(tail);

    // exhaust flame (boost)
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 6).rotateX(-Math.PI / 2), mat(new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.flame.position.set(0, FLOOR + 0.42, -2.75);
    this.flame.visible = false;
    this.body.add(this.flame);

    // wheels
    const tire = mat(new THREE.MeshStandardMaterial({ color: 0x1a1b1f, flatShading: true, roughness: 0.9 }));
    const rim = mat(new THREE.MeshStandardMaterial({ color: 0xd9dde3, flatShading: true, roughness: 0.35, metalness: 0.5 }));
    const tg = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.36, 12).rotateZ(Math.PI / 2);
    const rg = new THREE.CylinderGeometry(WHEEL_R * 0.62, WHEEL_R * 0.62, 0.38, 6).rotateZ(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Group();
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tg, tire), new THREE.Mesh(rg, rim));
      w.add(spin);
      this.wheels.push(w);
      this.root.add(w);
    }

    this.root.add(this.body);
    this.setLook(look);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = !ghost; m.receiveShadow = !ghost; }
    });
    if (ghost) {
      this.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false });
        this.mats.push(gm);
        m.material = gm;
      });
      this.flame.visible = false;
    }
  }

  setLook(look: CarLook) {
    this.paintMat.color.setHex(look.paint);
  }

  /** pose from physics: body pose, per-wheel suspension, steer and spin */
  pose(p: THREE.Vector3, q: THREE.Quaternion, wheels: { comp: number; spin: number; steer: number }[] | null) {
    this.root.position.copy(p);
    this.root.quaternion.copy(q);
    const W = [[0.84, 1.32], [-0.84, 1.32], [0.84, -1.22], [-0.84, -1.22]];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const ws = wheels?.[i];
      const comp = ws ? ws.comp : 0.13;
      w.position.set(W[i][0] + Math.sign(W[i][0]) * 0.1, 0.05 - (0.42 + WHEEL_R - comp - WHEEL_R), W[i][1]);
      w.rotation.set(0, ws ? -ws.steer : 0, 0);
      w.children[0].rotation.x = ws ? ws.spin : 0;
    }
  }

  dispose() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}

export const PAINTS = [0xff4d3d, 0x2f7bff, 0xffc21a, 0x24c26b, 0xf2f2f2, 0x24262e, 0xff5fb0, 0x8a5cff, 0x18c8d8, 0xff8a1f];
export const ACCENTS = [0x1b1d23, 0xf4f4f4, 0xffd23a, 0xff3b3b, 0x2fd7ff];
