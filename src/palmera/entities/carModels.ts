// Procedural low-poly vehicle models. Front of every model points to +z, ground at y = 0.
import * as THREE from 'three';
import { box, cyl, merge, mergeGroups, prep } from '../core/geo';

export type CarType = 'sedan' | 'sports' | 'suv' | 'pickup' | 'taxi' | 'police' | 'van' | 'bus' | 'bike' | 'bicycle' | 'ambulance' | 'boat' | 'jetski' | 'airboat';

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
  van: { type: 'van', label: 'Coastline Courier', len: 5.4, wid: 2.05, hgt: 2.35, mass: 2600, maxSpeed: 38, accel: 6.2, brake: 12, grip: 5.8, steer: 0.58, wheelbase: 3.4, wheelR: 0.38, wheelZ: 1.75, colors: [0xf2f2ee, 0xf2f2ee, 0x2b4a7a, 0x9aa0a6, 0xc9402e, 0x1f6b52], health: 1500 },
  bus: { type: 'bus', label: 'Palmera Transit Bus', len: 11.5, wid: 2.55, hgt: 3.1, mass: 11000, maxSpeed: 25, accel: 3.4, brake: 8, grip: 4.8, steer: 0.52, wheelbase: 6.4, wheelR: 0.5, wheelZ: 3.2, colors: [0x18a3a0, 0xe8743b, 0x2e6fbf], health: 3000 },
  ambulance: { type: 'ambulance', label: 'Palmera General Ambulance', len: 5.6, wid: 2.1, hgt: 2.5, mass: 3000, maxSpeed: 42, accel: 7, brake: 13, grip: 6, steer: 0.58, wheelbase: 3.5, wheelR: 0.38, wheelZ: 1.8, colors: [0xf6f6f2], health: 1800 },
  bike: { type: 'bike', label: 'Sprint 750', len: 2.1, wid: 0.8, hgt: 1.2, mass: 230, maxSpeed: 58, accel: 12, brake: 15, grip: 7.5, steer: 0.5, wheelbase: 1.4, wheelR: 0.32, wheelZ: 0.7, colors: [0xd62828, 0x111111, 0xf2f2f2, 0x1f6fd1, 0xf2b705, 0x2a9d4a], health: 500 },
  bicycle: { type: 'bicycle', label: 'Palmera Cruiser', len: 1.75, wid: 0.62, hgt: 1.1, mass: 95, maxSpeed: 10.5, accel: 3.4, brake: 6, grip: 4, steer: 1.0, wheelbase: 1.05, wheelR: 0.33, wheelZ: 0.53, colors: [0x7fd8d0, 0xff8a7a, 0xf2e3c6, 0x2f4f6f, 0xffd27f, 0x9ad17a, 0x222222], health: 90 },
  jetski: { type: 'jetski', label: 'Wavecat 900', len: 3.1, wid: 1.15, hgt: 1.0, mass: 380, maxSpeed: 27, accel: 10, brake: 7, grip: 2.4, steer: 1.4, wheelbase: 2, wheelR: 0, wheelZ: 0, colors: [0xffd23f, 0xff3b6b, 0x22c7e8, 0x7cff3a, 0xffffff], health: 420 },
  airboat: { type: 'airboat', label: 'Glade Skimmer', len: 4.6, wid: 2.2, hgt: 2.6, mass: 650, maxSpeed: 25, accel: 8, brake: 6, grip: 2.2, steer: 0.9, wheelbase: 3, wheelR: 0, wheelZ: 0, colors: [0x3b6e3a, 0x2f4f6f, 0xc0b8a0, 0x7a2f2a], health: 700 },
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
    case 'ambulance':
      geo = sedanLike(spec, () => {});
      model.sirenRed = new THREE.Vector3(-0.35, spec.hgt + 0.06, 0.6);
      model.sirenBlue = new THREE.Vector3(0.35, spec.hgt + 0.06, 0.6);
      break;
    case 'van':
    case 'bus':
    case 'bike':
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
    case 'airboat': {
      // a flat-bottomed skiff with an upswept bow, a raised driver's seat and the fan cage at the back
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      const hull = new THREE.BoxGeometry(W, 0.45, L * 0.82, 1, 1, 4);
      const hp = hull.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < hp.count; i++) {
        const z = hp.getZ(i);
        // the bow rises
        if (z > L * 0.2 && hp.getY(i) < 0) hp.setY(i, hp.getY(i) + (z - L * 0.2) * 0.6);
      }
      hull.computeVertexNormals();
      hull.translate(0, 0.3, -L * 0.05);
      paint.push(prep(hull, 0xffffff));
      for (const s of [-1, 1]) detail.push(box(0.08, 0.1, L * 0.8, s * (W / 2 + 0.01), 0.55, -L * 0.05, 0x8a8a84));
      detail.push(box(W * 0.85, 0.04, L * 0.6, 0, 0.53, 0, 0x5a4a38));
      // the driver's seat on its stand, and a bench in front
      detail.push(box(0.12, 0.9, 0.12, -0.3, 0.98, -0.75, 0x7d7d78));
      detail.push(box(0.12, 0.9, 0.12, 0.3, 0.98, -0.75, 0x7d7d78));
      detail.push(box(0.8, 0.12, 0.6, 0, 1.45, -0.72, 0x202224));
      detail.push(box(0.8, 0.5, 0.1, 0, 1.72, -1.0, 0x202224));
      detail.push(box(1.6, 0.3, 0.5, 0, 0.72, 0.5, 0x202224));
      // engine and the fan's cage (the blades spin separately)
      detail.push(box(0.6, 0.5, 0.7, 0, 0.85, -1.55, 0x3a3c40));
      const ring = new THREE.TorusGeometry(1.05, 0.05, 6, 24);
      ring.translate(0, 1.7, -1.98);
      detail.push(prep(ring, 0x9a9a94));
      for (const a of [0.6, 2.54]) {
        const st = new THREE.CylinderGeometry(0.035, 0.035, 2.1, 5);
        st.rotateZ(a);
        st.translate(0, 1.7, -1.95);
        detail.push(prep(st, 0x9a9a94));
      }
      detail.push(box(0.06, 1.2, 0.06, -0.9, 1.1, -1.9, 0x9a9a94));
      detail.push(box(0.06, 1.2, 0.06, 0.9, 1.1, -1.9, 0x9a9a94));
      // a rudder pair behind the fan
      detail.push(box(0.04, 0.9, 0.5, -0.35, 1.6, -2.3, 0x2a2c30));
      detail.push(box(0.04, 0.9, 0.5, 0.35, 1.6, -2.3, 0x2a2c30));
      lamp.push(box(0.16, 0.1, 0.05, 0, 0.75, L * 0.38, 0xfff4d8));
      geo = mergeGroups([paint, detail, lamp]);
      model.wheels = [];
      model.wheelGeo = null;
      break;
    }
    case 'bicycle': {
      // a beach cruiser: a diamond frame in the paint colour, swept-back bars, a sprung saddle, a basket on some
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      const tube = (a: number[], b: number[], r: number, col: number, list: THREE.BufferGeometry[]) => {
        const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
        const len = va.distanceTo(vb);
        const g = new THREE.CylinderGeometry(r, r, len, 6);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
        g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        list.push(prep(g, col));
      };
      const BB = [0, 0.3, -0.04], ST = [0, 0.86, -0.24], HT = [0, 0.84, 0.36], HB = [0, 0.64, 0.42], RA = [0, 0.33, -0.52], FA = [0, 0.33, 0.53];
      tube(BB, ST, 0.022, 0xffffff, paint);
      tube(ST, HT, 0.02, 0xffffff, paint);
      tube(BB, HB, 0.024, 0xffffff, paint);
      tube(HB, HT, 0.026, 0xffffff, paint);
      for (const s of [-1, 1]) {
        tube([s * 0.04, 0.3, -0.04], [s * 0.05, 0.33, -0.52], 0.012, 0xffffff, paint);
        tube([s * 0.03, 0.82, -0.22], [s * 0.05, 0.33, -0.52], 0.011, 0xffffff, paint);
        tube([s * 0.035, 0.64, 0.42], [s * 0.05, 0.33, 0.53], 0.013, 0xcfd2d6, detail);
      }
      // stem, bars and grips
      tube(HT, [0, 1.0, 0.34], 0.016, 0xcfd2d6, detail);
      tube([-0.3, 1.02, 0.2], [0.3, 1.02, 0.2], 0.012, 0xcfd2d6, detail);
      tube([-0.3, 1.02, 0.2], [-0.12, 1.0, 0.34], 0.012, 0xcfd2d6, detail);
      tube([0.3, 1.02, 0.2], [0.12, 1.0, 0.34], 0.012, 0xcfd2d6, detail);
      for (const s of [-1, 1]) detail.push(box(0.1, 0.035, 0.035, s * 0.33, 1.02, 0.2, 0x3a2a20));
      // saddle on its post, springs under it
      tube(ST, [0, 0.93, -0.26], 0.014, 0xcfd2d6, detail);
      const sad = new THREE.SphereGeometry(0.13, 8, 5);
      sad.scale(0.95, 0.32, 1.25);
      sad.translate(0, 0.96, -0.27);
      detail.push(prep(sad, 0x4a3426));
      // chainring, cranks, pedals
      const ring = new THREE.TorusGeometry(0.09, 0.01, 4, 14);
      ring.rotateY(Math.PI / 2);
      ring.translate(0.06, 0.3, -0.04);
      detail.push(prep(ring, 0x9aa0a6));
      tube([0.07, 0.3, -0.04], [0.07, 0.3, -0.52], 0.006, 0x333333, detail);
      // fenders
      for (const z of [-0.52, 0.53]) {
        const f = new THREE.TorusGeometry(0.37, 0.03, 3, 10, Math.PI * 0.7);
        f.rotateY(Math.PI / 2);
        f.rotateX(z < 0 ? -0.35 : Math.PI * 0.3 - 0.35);
        f.translate(0, 0.33, z);
        paint.push(prep(f, 0xffffff));
      }
      // a wicker basket on the bars
      detail.push(box(0.36, 0.22, 0.26, 0, 0.92, 0.6, 0xb08a55));
      detail.push(box(0.32, 0.02, 0.22, 0, 1.02, 0.6, 0x6e5233));
      lamp.push(box(0.08, 0.06, 0.04, 0, 0.82, 0.75, 0xfff4d8));
      lamp.push(box(0.06, 0.03, 0.02, 0, 0.62, -0.83, 0xff3030));
      geo = mergeGroups([paint, detail, lamp]);
      // spoked wheels, axle along x
      const wr = 0.33;
      const tyre = new THREE.TorusGeometry(wr - 0.02, 0.022, 5, 22);
      tyre.rotateY(Math.PI / 2);
      const rim = new THREE.TorusGeometry(wr - 0.045, 0.01, 3, 22);
      rim.rotateY(Math.PI / 2);
      const parts = [prep(tyre, 0x1d1d1d), prep(rim, 0xcfd2d6)];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI;
        const sp = new THREE.CylinderGeometry(0.003, 0.003, (wr - 0.05) * 2, 3);
        sp.rotateX(a);
        parts.push(prep(sp, 0xd8dade));
      }
      const hub = new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6);
      hub.rotateZ(Math.PI / 2);
      parts.push(prep(hub, 0x9aa0a6));
      model.wheels = [new THREE.Vector3(0, wr, 0.53), new THREE.Vector3(0, wr, -0.52)];
      model.wheelGeo = merge(parts);
      break;
    }
    case 'jetski': {
      // a short V hull, a long padded seat, a bonnet and handlebars
      const paint: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [], lamp: THREE.BufferGeometry[] = [];
      const shape = new THREE.Shape();
      const hw = W / 2, hl = L / 2;
      shape.moveTo(-hw, -hl);
      shape.lineTo(hw, -hl);
      shape.lineTo(hw, hl * 0.2);
      shape.quadraticCurveTo(hw * 0.7, hl * 0.85, 0, hl);
      shape.quadraticCurveTo(-hw * 0.7, hl * 0.85, -hw, hl * 0.2);
      shape.lineTo(-hw, -hl);
      const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false, curveSegments: 6 });
      hull.rotateX(Math.PI / 2);
      hull.translate(0, 0.42, 0);
      const hp = hull.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < hp.count; i++) if (hp.getY(i) < 0) hp.setX(i, hp.getX(i) * 0.4);
      hull.computeVertexNormals();
      paint.push(prep(hull, 0xffffff));
      detail.push(box(W * 1.02, 0.08, L * 0.75, 0, 0.15, -L * 0.08, 0x1b1d22));
      detail.push(box(0.42, 0.2, 1.3, 0, 0.55, -0.35, 0x202226));
      paint.push(box(0.8, 0.22, 0.7, 0, 0.55, 0.65, 0xffffff));
      detail.push(box(0.08, 0.32, 0.08, 0, 0.78, 0.45, 0x2a2c30));
      detail.push(box(0.7, 0.05, 0.06, 0, 0.94, 0.42, 0x2a2c30));
      detail.push(slab(0.5, 0.16, 0.04, 0, 0.82, 0.82, 0x6f8fa0, 0.7));
      lamp.push(box(0.1, 0.05, 0.04, 0, 0.6, hl * 0.86, 0xfff4d8));
      geo = mergeGroups([paint, detail, lamp]);
      model.wheels = [];
      model.wheelGeo = null;
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

/** how brightly the lamps glow (a little by day, like running lights; full at night) */
const lampGlow = { value: 0.35 };

/**
 * Lamps as lenses, not stickers: a glossy clear-coated lens over a reflector that picks up the sky
 * and the sun like the paint does, glowing in its own colour (white heads, red tails) on top - a
 * little by day, fully at night. They used to be flat unlit colour, which by day read as painted-on
 * blobs (the 'cartoon face' at the back of every car).
 */
function lampMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.08, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLampGlow = lampGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;\nvarying vec3 vBodyN;\nattribute vec4 lampUv;\nvarying vec4 vLampUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBodyPos = position;\n  vBodyN = normal;\n  vLampUv = lampUv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vLampUv;\nuniform float uLampGlow;\nvarying vec3 vBodyPos;\nvarying vec3 vBodyN;\nfloat lampMask = 1.0;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    // what's behind the lens, in the lamp's own face plane
    vec2 lp = abs(vBodyN.x) > abs(vBodyN.z) ? vBodyPos.zy : vBodyPos.xy;
    bool tail = vColor.r > 0.5 && vColor.g < 0.3;
    bool head = vColor.g > 0.9 && vColor.b > 0.8;
    // with the lamp's own coordinates (Blender): metres from its inner edge and bottom, and its size
    vec2 sz = vLampUv.zw;
    vec2 m = vLampUv.xy * sz;
    float edge = min(min(m.x, sz.x - m.x), min(m.y, sz.y - m.y));
    if (sz.x > 0.01 && tail) {
      // a lit outline round the lamp (the modern light-guide look), a dark red lens inside with a
      // faint inner bar, a reversing light at the inner end
      float ring = smoothstep(0.009, 0.003, abs(edge - 0.014));
      float bar = smoothstep(0.012, 0.004, abs(m.y - sz.y * 0.5)) * step(0.06, m.x) * step(m.x, sz.x - 0.04) * step(0.12, sz.y);
      float rev = step(m.x, min(0.09, sz.x * 0.25)) * step(0.03, edge);
      diffuseColor.rgb = vec3(0.1, 0.005, 0.005);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.03, 0.02), max(ring, bar * 0.7));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.55, 0.56), rev);
      lampMask = max(ring, bar * 0.6) * (1.0 - rev) + 0.06;
    } else if (sz.x > 0.01 && head) {
      // a dark chrome housing; one projector (two in a long lamp) toward the outer end; a daytime
      // LED strip along the top edge
      float r = min(sz.y * 0.32, 0.07);
      vec2 c1 = vec2(sz.x - max(r * 1.6, sz.x * 0.28), sz.y * 0.45);
      float d1 = length(m - c1);
      float d2 = sz.x > sz.y * 2.6 ? length(m - (c1 - vec2(r * 2.4, 0.0))) : 99.0;
      float d = min(d1, d2);
      float lens = smoothstep(r, r * 0.85, d);
      float bezel = smoothstep(r * 1.25, r * 1.1, d) * (1.0 - lens);
      float drl = smoothstep(0.012, 0.004, abs(m.y - (sz.y - 0.025))) * step(0.03, m.x) * step(m.x, sz.x - 0.02);
      float fins = 0.5 + 0.5 * sin(m.x * 160.0);
      diffuseColor.rgb = vec3(0.13, 0.135, 0.14) + fins * 0.04;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.76, 0.78), bezel);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92) - smoothstep(0.0, r, d) * 0.4, lens);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), drl);
      lampMask = max(drl, lens * 0.5) + 0.04;
    } else if (tail) {
      // LED light bars behind a red lens, dark gaps between
      float f = fract(lp.y * 24.0);
      float bar = smoothstep(0.0, 0.3, f) * smoothstep(1.0, 0.7, f);
      diffuseColor.rgb = mix(vec3(0.09, 0.004, 0.004), vec3(0.6, 0.03, 0.02), bar);
      lampMask = 0.25 + 0.75 * bar;
    } else if (head) {
      // a dark chrome housing with round projector and LED cells
      vec2 c = fract(lp * vec2(6.5, 5.5)) - 0.5;
      float cell = smoothstep(0.34, 0.2, length(c));
      float ring = smoothstep(0.05, 0.0, abs(length(c) - 0.38));
      diffuseColor.rgb = mix(vec3(0.16, 0.165, 0.17), vec3(0.95), cell) + ring * 0.25;
      lampMask = 0.08 + 0.92 * cell;
    }
    // at night the whole lamp floods with light
    lampMask = mix(lampMask, 1.0, clamp((uLampGlow - 0.35) / 2.6, 0.0, 1.0) * 0.55);
  }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * vColor.rgb * uLampGlow * lampMask;');
  };
  m.customProgramCacheKey = () => 'palmera-lamp-v5';
  return m;
}

/**
 * Road grime: the sills, arches and lower doors carry a film of dust and spray - duller and a
 * little browner, fading out by the waist line - so the paint isn't showroom-perfect all the way
 * down. Works in the body's own space (ground at y = 0).
 */
function addGrime(m: THREE.MeshPhysicalMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyPos;\nvarying vec3 vBodyN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBodyPos = position;\n  vBodyN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBodyPos;
varying vec3 vBodyN;
float trim = 0.0;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }
float grime = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    // streaky, uneven: noise stretched along the car, stronger at the very bottom
    float n = gNoise(vec2(vBodyPos.z * 1.3, vBodyPos.y * 9.0)) * 0.6 + gNoise(vBodyPos.xz * 6.0 + vBodyPos.y * 3.0) * 0.4;
    grime = smoothstep(0.62, 0.12, vBodyPos.y + (n - 0.5) * 0.22);
    vec3 dust = vec3(0.34, 0.31, 0.27);
    diffuseColor.rgb = mix(diffuseColor.rgb, dust * (0.7 + 0.3 * n), grime * 0.42);
    // the body's black parts are plastic, not paint: matte, and the grilles and diffusers facing
    // front or back get a diamond mesh with dark holes behind
    if (vColor.r < 0.2 && vColor.g < 0.2) {
      trim = 1.0;
      diffuseColor.rgb = vec3(0.035);
      if (abs(vBodyN.z) > 0.55 && vBodyPos.y < 0.95) {
        vec2 q = vBodyPos.xy * 26.0;
        vec2 d = abs(fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5);
        float rib = smoothstep(0.09, 0.04, min(d.x, d.y));
        diffuseColor.rgb = mix(vec3(0.003), vec3(0.07), rib);
      }
    }
  }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor, 0.75, grime * 0.7), 0.62, trim);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.clearcoat *= (1.0 - grime * 0.75) * (1.0 - trim);');
  };
  m.customProgramCacheKey = () => 'palmera-paint-grime-v3';
}

// shared materials
export const carMats = {
  detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 }),
  glass: new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, transparent: true, opacity: 0.55, depthWrite: false }),
  lamps: lampMaterial(),
  /** a bus's windows: its strip lights glow through them after dark (setCarNight) */
  busGlass: busGlassMaterial(),
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
    // solid gloss (whites, blacks, reds, the bright colours) or metallic, decided by the colour so a
    // model in one colour always looks the same
    const c = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const metallic = ((color * 2654435761) >>> 0) % 100 < 55 && hsl.l > 0.12 && hsl.l < 0.8 && hsl.s < 0.85;
    const pm = new THREE.MeshPhysicalMaterial(
      metallic
        ? { color, vertexColors: true, roughness: 0.34, metalness: 0.72, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 }
        : { color, vertexColors: true, roughness: 0.42, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 },
    );
    addGrime(pm);
    m = pm;
    paintCache.set(color, m);
  }
  return m;
}

/**
 * the bus's glazing: by day the same tinted glass as the cars; after dark the cabin's strip lights show
 * through it - brightest under the ceiling, falling off down the window, with the seat backs and
 * heads of the riders as darker shapes along the lower half (from the body-space position)
 */
function busGlassMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, transparent: true, opacity: 0.62, depthWrite: false, emissive: 0xd8e6ff, emissiveIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBusP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBusP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBusP;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float y = vBusP.y;
  float lit = smoothstep(1.35, 2.55, y);
  lit = 0.25 + 0.75 * lit * lit;
  // seat backs and heads along the lower part of each window
  float row = fract(vBusP.z / 0.82) * 0.82;
  float dz = row - 0.3;
  // a seat back with a rounded top, and (in some seats) a rider's head and shoulders above it
  float backTop = 1.72 - dz * dz * 3.0;
  float seat = smoothstep(0.03, -0.03, y - backTop) * smoothstep(0.05, -0.02, abs(dz) - 0.2);
  float rider = step(0.45, fract(sin(floor(vBusP.z / 0.82) * 12.9898 + vBusP.x * 3.0) * 43758.5453));
  float head = smoothstep(0.11, 0.085, length(vec2(dz, (y - 1.98) * 0.85)));
  float shoulders = smoothstep(0.03, -0.03, y - (1.86 - dz * dz * 6.0)) * smoothstep(0.05, -0.02, abs(dz) - 0.21);
  float dark = max(seat * 0.55, rider * max(head, shoulders) * 0.7);
  totalEmissiveRadiance *= lit * (1.0 - dark);
}`,
      );
  };
  m.customProgramCacheKey = () => 'palmera-busglass-v2';
  return m;
}

/**
 * Car paint and glass reflect the sky's own reflection map (a skyline and a crisp horizon), not the
 * flattened lighting environment; they're scaled the way the scene's environment is
 */
export function setCarEnv(env: THREE.Texture | null, k: number) {
  const mats: THREE.MeshStandardMaterial[] = [...paintCache.values(), carMats.glass, carMats.busGlass];
  for (const m of mats) {
    if (m.envMap !== env) {
      m.envMap = env;
      m.needsUpdate = true;
    }
    const base = (m.userData.envBase ??= m.envMapIntensity) as number;
    m.envMapIntensity = base * k;
  }
}

export function setCarNight(night: number) {
  lampGlow.value = 0.35 + night * 2.6;
  carMats.busGlass.emissiveIntensity = Math.max(0, night - 0.15) * 0.75;
}
