// Procedural low-poly vehicle models. Front of every model points to +z, ground at y = 0.
import * as THREE from 'three';
import { box, cyl, merge, mergeGroups, prep } from '../core/geo';

export type CarType = 'sedan' | 'sports' | 'suv' | 'pickup' | 'taxi' | 'police' | 'boat';

export interface CarSpec {
  type: CarType;
  label: string;
  len: number;
  wid: number;
  hgt: number;
  mass: number;
  maxSpeed: number; // m/s
  accel: number; // m/s^2 at low speed
  brake: number; // m/s^2
  grip: number; // lateral grip (1/s)
  steer: number; // max wheel angle (rad)
  wheelbase: number;
  wheelR: number;
  wheelZ: number; // axle offset from centre
  colors: number[];
  health: number;
}

export const SPECS: Record<CarType, CarSpec> = {
  sedan: { type: 'sedan', label: 'Marlin Sedan', len: 4.6, wid: 1.86, hgt: 1.45, mass: 1400, maxSpeed: 48, accel: 8.5, brake: 16, grip: 7.5, steer: 0.62, wheelbase: 2.7, wheelR: 0.34, wheelZ: 1.38, colors: [0x2f5d8a, 0xc0c4c8, 0x8b1e2d, 0xf2efe6, 0x2a2d31, 0x5c7f63, 0xd9b68c], health: 1000 },
  sports: { type: 'sports', label: 'Stingray GT', len: 4.4, wid: 1.96, hgt: 1.15, mass: 1250, maxSpeed: 66, accel: 13, brake: 20, grip: 9, steer: 0.58, wheelbase: 2.6, wheelR: 0.34, wheelZ: 1.33, colors: [0xff3b3b, 0xffd23f, 0x1fb5c9, 0xff7ac0, 0xf5f5f5, 0x111111, 0x7a3cff], health: 850 },
  suv: { type: 'suv', label: 'Everglade XL', len: 4.85, wid: 2.02, hgt: 1.9, mass: 2100, maxSpeed: 43, accel: 7.5, brake: 14, grip: 6.4, steer: 0.6, wheelbase: 2.9, wheelR: 0.42, wheelZ: 1.5, colors: [0x1d1f22, 0xf0f0f0, 0x6b6f45, 0x3a4f6b, 0x8c2f2f, 0xb8a27a], health: 1300 },
  pickup: { type: 'pickup', label: 'Gulf Hauler', len: 5.3, wid: 2.02, hgt: 1.85, mass: 2200, maxSpeed: 42, accel: 7.2, brake: 14, grip: 6.2, steer: 0.6, wheelbase: 3.3, wheelR: 0.42, wheelZ: 1.7, colors: [0xd6402b, 0x2d5d9a, 0xece8dc, 0x4a5a3a, 0x9c9c9c, 0xe8a33d], health: 1300 },
  taxi: { type: 'taxi', label: 'Sunshine Cab', len: 4.6, wid: 1.86, hgt: 1.45, mass: 1450, maxSpeed: 46, accel: 8, brake: 16, grip: 7.2, steer: 0.62, wheelbase: 2.7, wheelR: 0.34, wheelZ: 1.38, colors: [0xffc21a], health: 1000 },
  police: { type: 'police', label: 'Palmera PD Cruiser', len: 4.8, wid: 1.9, hgt: 1.5, mass: 1650, maxSpeed: 56, accel: 10.5, brake: 18, grip: 8.2, steer: 0.62, wheelbase: 2.8, wheelR: 0.35, wheelZ: 1.45, colors: [0xf4f4f2], health: 1400 },
  boat: { type: 'boat', label: 'Reef Runner', len: 7.0, wid: 2.4, hgt: 1.6, mass: 1800, maxSpeed: 30, accel: 6, brake: 6, grip: 1.6, steer: 1.0, wheelbase: 4, wheelR: 0, wheelZ: 0, colors: [0xffffff, 0x1f4e79, 0xc0392b], health: 1200 },
};

export interface CarModel {
  geo: THREE.BufferGeometry; // groups: 0 paint, 1 detail (vertex colours), 2 lamps
  wheels: THREE.Vector3[];
  wheelGeo: THREE.BufferGeometry | null;
  sirenRed?: THREE.Vector3;
  sirenBlue?: THREE.Vector3;
}

const GLASS = 0x1b2630, TRIM = 0x222426, CHROME = 0xb9bec3, HEAD = 0xfff6dc, TAIL = 0xc0101a, BLACK = 0x151515;

function slab(w: number, h: number, d: number, x: number, y: number, z: number, color: number, taperTop = 1, taperFront = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * taperTop);
      if (taperFront && p.getZ(i) > 0) p.setZ(i, p.getZ(i) - taperFront);
      if (taperFront && p.getZ(i) < 0) p.setZ(i, p.getZ(i) + taperFront * 0.6);
    }
  }
  g.computeVertexNormals();
  g.translate(x, y, z);
  return prep(g, color);
}

function lamps(spec: CarSpec, yHead: number, yTail: number, out: THREE.BufferGeometry[]) {
  const L = spec.len / 2, W = spec.wid / 2;
  for (const s of [-1, 1]) {
    out.push(box(0.36, 0.14, 0.05, s * (W - 0.32), yHead, L + 0.01, HEAD));
    out.push(box(0.34, 0.13, 0.05, s * (W - 0.3), yTail, -L - 0.01, TAIL));
  }
}

function sedanLike(spec: CarSpec, extra: (paint: THREE.BufferGeometry[], detail: THREE.BufferGeometry[], lamp: THREE.BufferGeometry[]) => void): THREE.BufferGeometry {
  const L = spec.len, W = spec.wid;
  const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
  paint.push(slab(W, 0.5, L, 0, 0.62, 0, 0xffffff, 0.97));
  paint.push(slab(W * 0.98, 0.12, L * 0.44, 0, 0.92, L * 0.27, 0xffffff, 0.95)); // hood
  paint.push(slab(W * 0.98, 0.12, L * 0.24, 0, 0.92, -L * 0.37, 0xffffff, 0.95)); // trunk
  detail.push(slab(W * 0.9, 0.5, L * 0.46, 0, 1.12, -L * 0.04, GLASS, 0.82, 0.3));
  paint.push(slab(W * 0.76, 0.06, L * 0.3, 0, 1.4, -L * 0.07, 0xffffff));
  detail.push(box(W + 0.04, 0.2, 0.18, 0, 0.45, L / 2 - 0.05, TRIM));
  detail.push(box(W + 0.04, 0.2, 0.18, 0, 0.45, -L / 2 + 0.05, TRIM));
  detail.push(box(W * 0.5, 0.12, 0.04, 0, 0.66, L / 2 + 0.01, CHROME));
  for (const s of [-1, 1]) detail.push(box(0.04, 0.06, L * 0.5, s * (W / 2 + 0.01), 0.68, 0, CHROME));
  lamps(spec, 0.72, 0.75, lamp);
  extra(paint, detail, lamp);
  return mergeGroups([paint, detail, lamp]);
}

function wheelGeo(r: number, w: number): THREE.BufferGeometry {
  const tire = new THREE.CylinderGeometry(r, r, w, 12);
  tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 8);
  hub.rotateZ(Math.PI / 2);
  return merge([prep(tire, BLACK), prep(hub, CHROME)]);
}

function wheelsFor(spec: CarSpec): THREE.Vector3[] {
  const x = spec.wid / 2 - 0.16;
  return [
    new THREE.Vector3(x, spec.wheelR, spec.wheelZ), new THREE.Vector3(-x, spec.wheelR, spec.wheelZ),
    new THREE.Vector3(x, spec.wheelR, -spec.wheelZ), new THREE.Vector3(-x, spec.wheelR, -spec.wheelZ),
  ];
}

const cache = new Map<CarType, CarModel>();

export function carModel(type: CarType): CarModel {
  const c = cache.get(type);
  if (c) return c;
  const spec = SPECS[type];
  const L = spec.len, W = spec.wid;
  let geo: THREE.BufferGeometry;
  const model: CarModel = { geo: null as unknown as THREE.BufferGeometry, wheels: wheelsFor(spec), wheelGeo: wheelGeo(spec.wheelR, 0.26) };
  switch (type) {
    case 'sedan':
      geo = sedanLike(spec, () => {});
      break;
    case 'taxi':
      geo = sedanLike(spec, (_p, d, l) => {
        for (const s of [-1, 1]) {
          for (let i = 0; i < 8; i++) d.push(box(0.03, 0.08, 0.22, s * (W / 2 + 0.015), 0.74 + (i % 2) * 0.08, -1.2 + i * 0.32, i % 2 ? 0x111111 : 0xffffff));
        }
        l.push(slab(0.7, 0.2, 0.3, 0, 1.53, -0.25, 0xfff2b0, 0.85));
      });
      break;
    case 'police':
      geo = sedanLike(spec, (_p, d) => {
        d.push(box(W + 0.03, 0.3, L * 0.5, 0, 0.56, -0.05, 0x111418));
        d.push(box(W * 0.98, 0.13, L * 0.44, 0, 0.93, L * 0.27, 0x111418));
        d.push(box(1.1, 0.1, 0.32, 0, 1.47, -0.3, 0x222222));
        d.push(box(W + 0.05, 0.28, 0.2, 0, 0.5, L / 2 + 0.05, 0x111111)); // push bar
      });
      model.sirenRed = new THREE.Vector3(-0.3, 1.56, -0.3);
      model.sirenBlue = new THREE.Vector3(0.3, 1.56, -0.3);
      break;
    case 'sports': {
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      paint.push(slab(W, 0.42, L, 0, 0.5, 0, 0xffffff, 0.94));
      paint.push(slab(W * 0.96, 0.1, L * 0.4, 0, 0.75, L * 0.3, 0xffffff, 0.9));
      paint.push(slab(W * 0.98, 0.16, L * 0.3, 0, 0.78, -L * 0.33, 0xffffff, 0.95));
      detail.push(slab(W * 0.84, 0.36, L * 0.38, 0, 0.88, -L * 0.06, GLASS, 0.72, 0.38));
      paint.push(slab(W * 0.6, 0.05, L * 0.16, 0, 1.08, -L * 0.1, 0xffffff));
      detail.push(box(W * 0.94, 0.05, 0.36, 0, 1.0, -L / 2 + 0.22, BLACK));
      for (const s of [-1, 1]) {
        detail.push(box(0.06, 0.18, 0.08, s * 0.6, 0.9, -L / 2 + 0.25, BLACK));
        detail.push(box(0.05, 0.16, 0.9, s * (W / 2 + 0.005), 0.48, -0.1, BLACK)); // side intakes
      }
      detail.push(box(W + 0.02, 0.14, 0.14, 0, 0.32, L / 2 - 0.05, TRIM));
      detail.push(box(W + 0.02, 0.14, 0.14, 0, 0.36, -L / 2 + 0.05, TRIM));
      lamps(spec, 0.6, 0.66, lamp);
      geo = mergeGroups([paint, detail, lamp]);
      break;
    }
    case 'suv': {
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      paint.push(slab(W, 0.78, L, 0, 0.86, 0, 0xffffff, 0.98));
      detail.push(slab(W * 0.95, 0.6, L * 0.64, 0, 1.55, -L * 0.08, GLASS, 0.93, 0.12));
      paint.push(slab(W * 0.9, 0.08, L * 0.6, 0, 1.88, -L * 0.1, 0xffffff));
      for (const s of [-1, 1]) {
        detail.push(box(0.05, 0.05, L * 0.5, s * W * 0.38, 1.95, -L * 0.1, CHROME));
        detail.push(box(0.06, 0.2, L * 0.92, s * (W / 2 + 0.02), 0.55, 0, TRIM));
      }
      detail.push(box(W + 0.04, 0.26, 0.2, 0, 0.55, L / 2 - 0.04, TRIM));
      detail.push(box(W + 0.04, 0.26, 0.2, 0, 0.55, -L / 2 + 0.04, TRIM));
      detail.push(box(W * 0.6, 0.3, 0.04, 0, 0.95, L / 2 + 0.01, 0x2a2c2e));
      detail.push(cyl(0.38, 0.38, 0.22, 10, 0, 1.0, -L / 2 - 0.12, BLACK, 'z'));
      lamps(spec, 1.0, 1.05, lamp);
      geo = mergeGroups([paint, detail, lamp]);
      break;
    }
    case 'pickup': {
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      paint.push(slab(W, 0.66, L, 0, 0.82, 0, 0xffffff, 0.98));
      detail.push(slab(W * 0.95, 0.6, 1.6, 0, 1.45, 0.6, GLASS, 0.92, 0.12));
      paint.push(slab(W * 0.9, 0.08, 1.4, 0, 1.78, 0.55, 0xffffff));
      paint.push(slab(W * 0.98, 0.14, 1.3, 0, 1.2, L / 2 - 0.65, 0xffffff, 0.95)); // hood
      for (const s of [-1, 1]) paint.push(box(0.1, 0.42, 2.35, s * (W / 2 - 0.05), 1.36, -1.3, 0xffffff));
      paint.push(box(W, 0.42, 0.1, 0, 1.36, -L / 2 + 0.05, 0xffffff));
      detail.push(box(W - 0.2, 0.04, 2.3, 0, 1.17, -1.3, 0x2b2b2b));
      detail.push(box(W + 0.04, 0.24, 0.2, 0, 0.55, L / 2 - 0.04, CHROME));
      detail.push(box(W + 0.04, 0.24, 0.2, 0, 0.55, -L / 2 + 0.04, CHROME));
      detail.push(box(W * 0.6, 0.32, 0.04, 0, 0.95, L / 2 + 0.01, CHROME));
      lamps(spec, 1.0, 1.1, lamp);
      geo = mergeGroups([paint, detail, lamp]);
      break;
    }
    case 'boat': {
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      const shape = new THREE.Shape();
      const hw = W / 2, hl = L / 2;
      shape.moveTo(-hw, -hl);
      shape.lineTo(hw, -hl);
      shape.lineTo(hw, hl * 0.25);
      shape.quadraticCurveTo(hw * 0.8, hl * 0.8, 0, hl);
      shape.quadraticCurveTo(-hw * 0.8, hl * 0.8, -hw, hl * 0.25);
      shape.lineTo(-hw, -hl);
      const hull = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false, curveSegments: 6 });
      hull.rotateX(Math.PI / 2); // extrude along -y; shape y -> z
      hull.translate(0, 0.6, 0);
      // taper the bottom into a V
      const hp = hull.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < hp.count; i++) if (hp.getY(i) < 0) hp.setX(i, hp.getX(i) * 0.45);
      hull.computeVertexNormals();
      paint.push(prep(hull, 0xffffff));
      detail.push(box(W * 0.9, 0.06, L * 0.6, 0, 0.6, -L * 0.15, 0xf2efe6));
      detail.push(slab(W * 0.8, 0.4, 0.1, 0, 0.85, 0.6, 0x9fc6d8, 0.9));
      detail.push(box(0.7, 0.5, 0.8, -0.45, 0.85, -0.3, 0xe8e2d4));
      detail.push(box(0.7, 0.5, 0.8, 0.45, 0.85, -0.3, 0xe8e2d4));
      detail.push(box(0.5, 0.9, 0.5, 0, 0.75, -hl - 0.2, 0x202020));
      detail.push(box(0.15, 0.7, 0.2, 0, 0.2, -hl - 0.3, 0x202020));
      detail.push(box(W * 1.01, 0.12, L * 0.6, 0, 0.25, -L * 0.15, 0x1f4e79));
      lamp.push(box(0.12, 0.12, 0.12, hw - 0.1, 0.7, hl * 0.5, 0x30ff60));
      lamp.push(box(0.12, 0.12, 0.12, -hw + 0.1, 0.7, hl * 0.5, 0xff3030));
      geo = mergeGroups([paint, detail, lamp]);
      model.wheels = [];
      model.wheelGeo = null;
      break;
    }
  }
  model.geo = geo;
  cache.set(type, model);
  return model;
}

// shared materials
export const carMats = {
  detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 }),
  glass: new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, transparent: true, opacity: 0.55, depthWrite: false }),
  lamps: new THREE.MeshBasicMaterial({ vertexColors: true }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }),
  burnt: new THREE.MeshStandardMaterial({ color: 0x1e1b19, roughness: 1, metalness: 0 }),
  sirenRed: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  sirenBlue: new THREE.MeshBasicMaterial({ color: 0x2050ff }),
  sirenOff: new THREE.MeshBasicMaterial({ color: 0x331111 }),
  sirenOffB: new THREE.MeshBasicMaterial({ color: 0x111133 }),
};

const paintCache = new Map<number, THREE.MeshStandardMaterial>();
export function paintMat(color: number): THREE.MeshStandardMaterial {
  let m = paintCache.get(color);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, vertexColors: true, roughness: 0.38, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 });
    paintCache.set(color, m);
  }
  return m;
}

export function setCarNight(night: number) {
  const k = 1 + night * 4;
  carMats.lamps.color.setRGB(k, k, k);
}
