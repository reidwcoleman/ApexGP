import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarSpec, CarType } from './carModels';

/**
 * The car bodies modelled in Blender (public/palmera/cars.glb: body / glass / head lamps / tail
 * lamps per model, front toward +z, ground at y = 0, vertex colours white = paint, dark = trim).
 * Each Palmera class draws from a few of them, scaled to the class's size, so the streets aren't
 * one car repeated.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'palmera/';

/** the modelled bodies' own sizes (length, width, height, wheelbase, wheel radius) */
const BODY: Record<string, { L: number; W: number; H: number; wb: number; r: number }> = {
  sedan: { L: 4.85, W: 1.84, H: 1.45, wb: 2.83, r: 0.33 },
  compact: { L: 4.3, W: 1.78, H: 1.46, wb: 2.64, r: 0.31 },
  suv: { L: 4.95, W: 1.98, H: 1.78, wb: 2.95, r: 0.38 },
  gwagon: { L: 4.85, W: 1.98, H: 1.97, wb: 2.89, r: 0.39 },
  pickup: { L: 5.9, W: 2.03, H: 1.95, wb: 3.68, r: 0.42 },
  coupe: { L: 4.52, W: 1.9, H: 1.3, wb: 2.45, r: 0.34 },
  super: { L: 4.62, W: 2.02, H: 1.14, wb: 2.7, r: 0.36 },
  muscle: { L: 4.92, W: 1.96, H: 1.34, wb: 2.86, r: 0.36 },
  police: { L: 5.1, W: 1.9, H: 1.48, wb: 3.05, r: 0.35 },
  policeSuv: { L: 5.05, W: 2.0, H: 1.8, wb: 3.02, r: 0.38 },
  bus: { L: 11.5, W: 2.55, H: 3.1, wb: 6.4, r: 0.5 },
  bike: { L: 2.1, W: 0.8, H: 1.2, wb: 1.4, r: 0.32 },
};

export const VARIANTS: Partial<Record<CarType, string[]>> = {
  sedan: ['sedan', 'compact', 'sedan', 'muscle'],
  sports: ['super', 'coupe', 'muscle'],
  suv: ['suv', 'gwagon'],
  pickup: ['pickup'],
  taxi: ['sedan'],
  police: ['police', 'policeSuv'],
  van: ['van'],
  bus: ['bus'],
  bike: ['bike'],
};

type Parts = { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; heads: THREE.BufferGeometry; tails: THREE.BufferGeometry; trim?: THREE.BufferGeometry };
const kit = new Map<string, Parts>();

export async function loadCarKit(): Promise<void> {
  try {
    const gl = await new GLTFLoader().loadAsync(BASE + 'cars.glb');
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const r = /^car_(\w+?)_(body|glass|heads|tails)$/.exec(o.name);
      if (!m.isMesh || !r) return;
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      if (!kit.has(r[1])) kit.set(r[1], {} as Parts);
      (kit.get(r[1]) as Record<string, THREE.BufferGeometry>)[r[2]] = g;
    });
  } catch (e) {
    console.warn('palmera: cars.glb failed, using the blocky cars', e);
  }
  // the van's own size, measured
  const van = kit.get('van');
  if (van) {
    van.body.computeBoundingBox();
    const bb = van.body.boundingBox!;
    const L = bb.max.z - bb.min.z;
    BODY.van = { L, W: bb.max.x - bb.min.x, H: bb.max.y, wb: L * 0.58, r: 0.37 };
  }
  kit.set('bus', busParts());
  kit.set('bike', bikeParts());
}

/** a sport bike, built here: tank, fairing and tail in paint; frame, forks, engine, seat in trim */
function bikeParts(): Parts {
  const body: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [], tails: THREE.BufferGeometry[] = [];
  const paint: [number, number, number] = [1, 1, 1], dark: [number, number, number] = [0.07, 0.07, 0.08], metal: [number, number, number] = [0.6, 0.6, 0.62];
  const at = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number], rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateX(rx);
    g.translate(x, y, z);
    list.push(withColor(g, c));
  };
  const seg = (list: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, t: number, c: [number, number, number]) => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(t, t, d.length(), 8);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z);
    list.push(withColor(g, c));
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // bodywork
  at(body, 0.34, 0.24, 0.5, 0, 0.98, 0.12, paint);
  at(body, 0.42, 0.36, 0.3, 0, 1.0, 0.6, paint, -0.35);
  at(body, 0.24, 0.16, 0.62, 0, 0.96, -0.5, paint, 0.18);
  at(body, 0.36, 0.22, 0.5, 0, 0.62, 0.32, paint, -0.4);
  // frame, forks, swingarm, engine, seat, bars, exhaust
  seg(trim, V(0, 1.02, 0.55), V(0, 0.6, -0.2), 0.035, dark);
  for (const s of [-1, 1]) seg(trim, V(s * 0.09, 0.32, 0.7), V(s * 0.09, 1.04, 0.56), 0.028, metal);
  for (const s of [-1, 1]) seg(trim, V(s * 0.1, 0.55, -0.18), V(s * 0.1, 0.32, -0.7), 0.03, dark);
  at(trim, 0.3, 0.34, 0.42, 0, 0.52, 0.02, [0.18, 0.18, 0.2]);
  at(trim, 0.28, 0.08, 0.5, 0, 1.06, -0.24, dark);
  at(trim, 0.68, 0.035, 0.035, 0, 1.16, 0.5, dark);
  seg(trim, V(0.17, 0.4, -0.05), V(0.2, 0.55, -0.78), 0.045, metal);
  // wheel mudguards
  at(trim, 0.14, 0.04, 0.5, 0, 0.68, 0.72, dark, 0.3);
  // windscreen, lamps
  at(glass, 0.3, 0.2, 0.02, 0, 1.25, 0.7, [0.05, 0.06, 0.07], -0.6);
  at(heads, 0.2, 0.1, 0.04, 0, 1.0, 0.77, [1, 0.96, 0.88]);
  at(tails, 0.14, 0.06, 0.03, 0, 0.98, -0.82, [0.85, 0.03, 0.02]);
  return { body: mergeColored(body), trim: mergeColored(trim), glass: mergeColored(glass), heads: mergeColored(heads), tails: mergeColored(tails) };
}

/** a city bus, built here: low floor, a long glass band, a destination sign over the windscreen */
function busParts(): Parts {
  const L = 11.5, W = 2.55, H = 3.1;
  const body: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [], tails: THREE.BufferGeometry[] = [];
  const at = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    list.push(withColor(g, c));
  };
  const paint: [number, number, number] = [1, 1, 1], dark: [number, number, number] = [0.07, 0.07, 0.08], white: [number, number, number] = [0.9, 0.9, 0.89];
  // the painted lower body, with arches over the wheels (axles at +-3.2)
  const yb = 0.3, yt = 1.35, ya = 1.15;
  const seg = (z0: number, z1: number, y0: number) => at(body, W, yt - y0, z1 - z0, 0, (y0 + yt) / 2, (z0 + z1) / 2, paint);
  seg(-L / 2, -4.0, yb);
  seg(-2.4, 2.4, yb);
  seg(4.0, L / 2, yb);
  seg(-4.0, -2.4, ya);
  seg(2.4, 4.0, ya);
  // inside the arches
  for (const z of [3.2, -3.2]) at(trim, W - 0.5, ya - yb, 1.6, 0, (ya + yb) / 2, z, dark);
  // pale upper body, roof and its housings, a dark skirt line
  at(trim, W, 1.7, L - 0.1, 0, yt + 0.85, -0.05, white);
  at(trim, W - 0.1, 0.06, L - 0.3, 0, H - 0.02, 0, [0.82, 0.82, 0.81]);
  at(trim, 1.6, 0.32, 2.6, 0, H + 0.14, -L * 0.25, [0.78, 0.78, 0.78]);
  at(trim, 1.4, 0.26, 1.6, 0, H + 0.12, L * 0.12, [0.78, 0.78, 0.78]);
  at(trim, W + 0.02, 0.08, L, 0, yt, 0, dark);
  // windows: a long band each side with pillars, the door on the right, windscreen, rear window
  for (const s of [-1, 1]) {
    at(glass, 0.04, 1.1, L - 3.4, s * (W / 2 + 0.01), 2.05, -0.8, [0.02, 0.025, 0.03]);
    for (let k = 0; k < 6; k++) at(trim, 0.05, 1.12, 0.1, s * (W / 2 + 0.02), 2.05, -L / 2 + 1.0 + k * 1.62, dark);
  }
  at(glass, 0.05, 2.3, 1.0, -(W / 2 + 0.02), 1.5, L / 2 - 1.4, [0.02, 0.025, 0.03]);
  at(glass, W - 0.15, 1.75, 0.04, 0, 1.8, L / 2 + 0.01, [0.02, 0.025, 0.03]);
  at(glass, W - 0.4, 0.9, 0.04, 0, 2.25, -L / 2 - 0.01, [0.02, 0.025, 0.03]);
  // the destination sign, lamps, bumpers
  at(heads, W - 0.6, 0.28, 0.05, 0, H - 0.3, L / 2 + 0.02, [1, 0.62, 0.12]);
  for (const s of [-1, 1]) {
    at(heads, 0.42, 0.18, 0.05, s * (W / 2 - 0.35), 0.62, L / 2 + 0.03, [1, 0.96, 0.88]);
    at(tails, 0.22, 0.42, 0.05, s * (W / 2 - 0.2), 0.95, -L / 2 - 0.03, [0.85, 0.03, 0.02]);
  }
  at(trim, W, 0.3, 0.2, 0, 0.4, L / 2 + 0.05, dark);
  at(trim, W, 0.3, 0.2, 0, 0.4, -L / 2 - 0.05, dark);
  return { body: mergeColored(body), trim: mergeColored(trim), glass: mergeColored(glass), heads: mergeColored(heads), tails: mergeColored(tails) };
}

export function hasKit(type: CarType): boolean {
  const v = VARIANTS[type];
  return !!v && v.every((id) => kit.has(id));
}

function withColor(g: THREE.BufferGeometry, rgb: [number, number, number] | null): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone();
  const n = out.getAttribute('position').count;
  if (rgb || !out.getAttribute('color')) {
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(rgb ?? [1, 1, 1], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  } else {
    // glTF colours may be normalised shorts or have 4 components: make them plain rgb floats
    const src = out.getAttribute('color');
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([src.getX(i), src.getY(i), src.getZ(i)], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'color'].includes(k)) out.deleteAttribute(k);
  return out;
}

/** a wheel: tyre with rounded shoulders and a five-spoke alloy, axis along x, centred */
export function alloyWheel(r: number, w: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hw = w / 2;
  // tyre: a lathe of the profile around y, turned to the x axis
  const prof = [
    new THREE.Vector2(r * 0.7, -hw), new THREE.Vector2(r * 0.93, -hw), new THREE.Vector2(r * 0.99, -hw * 0.8),
    new THREE.Vector2(r, -hw * 0.4), new THREE.Vector2(r, hw * 0.4), new THREE.Vector2(r * 0.99, hw * 0.8),
    new THREE.Vector2(r * 0.93, hw), new THREE.Vector2(r * 0.7, hw),
  ];
  const tyre = new THREE.LatheGeometry(prof, 32);
  parts.push(paint(tyre, [0.035, 0.035, 0.038]));
  // rim barrel and face on both sides
  for (const s of [-1, 1]) {
    const face = new THREE.CylinderGeometry(r * 0.68, r * 0.68, 0.02, 28, 1, true);
    face.translate(0, s * (hw - 0.03), 0);
    parts.push(paint(face, [0.6, 0.61, 0.63]));
    const hub = new THREE.CylinderGeometry(r * 0.17, r * 0.2, 0.06, 12);
    hub.translate(0, s * (hw - 0.04), 0);
    parts.push(paint(hub, [0.75, 0.76, 0.78]));
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.BoxGeometry(r * 0.13, 0.03, r * 0.52);
      sp.translate(0, s * (hw - 0.035), r * 0.4);
      sp.rotateY((k / 5) * Math.PI * 2);
      parts.push(paint(sp, [0.78, 0.79, 0.81]));
    }
    // dark well behind the spokes
    const well = new THREE.CircleGeometry(r * 0.67, 24);
    well.rotateX(s > 0 ? -Math.PI / 2 : Math.PI / 2);
    well.translate(0, s * (hw - 0.06), 0);
    parts.push(paint(well, [0.05, 0.05, 0.05]));
  }
  const g = mergeColored(parts);
  g.rotateZ(Math.PI / 2);
  return g;
}

function paint(g: THREE.BufferGeometry, rgb: [number, number, number]) {
  return withColor(g, rgb);
}

function mergeColored(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export interface KitModel {
  /** groups: 0 paint, 1 trim/detail, 2 lamps, 3 glass */
  geo: THREE.BufferGeometry;
  wheels: THREE.Vector3[];
  wheelR: number;
  roofY: number;
  /** where the driver sits (passenger: mirror x) */
  seat: THREE.Vector3;
}

const cache = new Map<string, KitModel>();

export function kitModel(type: CarType, spec: CarSpec, variant: number): KitModel | null {
  const ids = VARIANTS[type];
  if (!ids || !hasKit(type)) return null;
  const id = ids[variant % ids.length];
  const key = type + ':' + id;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = kit.get(id)!, b = BODY[id];
  const sx = spec.wid / b.W, sy = spec.hgt / b.H, sz = spec.len / b.L;
  const m4 = new THREE.Matrix4().makeScale(sx, sy, sz);
  const body = withColor(p.body, null);
  const glass = withColor(p.glass, [0.02, 0.025, 0.03]);
  const heads = withColor(p.heads, [1, 0.96, 0.88]);
  const tails = withColor(p.tails, [0.85, 0.03, 0.02]);
  const extra: THREE.BufferGeometry[] = [];
  if (type === 'taxi') {
    const sign = new THREE.BoxGeometry(0.62, 0.2, 0.26);
    sign.translate(0, b.H + 0.1, -0.15);
    extra.push(withColor(sign, [1, 0.88, 0.45]));
  }
  const lamps = extra.length ? mergeColored([heads, tails, ...extra]) : mergeColored([heads, tails]);
  // a cabin behind the glass: tub, dash, seat backs, headlining (so the see-through glass shows a car, not a hollow shell)
  const cab: THREE.BufferGeometry[] = [];
  const cw = b.W * 0.8, belt = b.H * 0.6;
  const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
    const q = new THREE.BoxGeometry(w, h, d);
    q.translate(x, y, z);
    cab.push(withColor(q, c));
  };
  boxAt(cw, belt - 0.3, b.L * 0.42, 0, 0.3 + (belt - 0.3) / 2, -b.L * 0.06, [0.05, 0.05, 0.055]);
  boxAt(cw, 0.14, 0.4, 0, belt + 0.02, b.L * 0.16, [0.03, 0.03, 0.032]);
  for (const sx of [-1, 1]) boxAt(cw * 0.38, 0.62, 0.12, sx * cw * 0.25, belt + 0.12, -b.L * 0.05, [0.09, 0.08, 0.075]);
  boxAt(cw * 0.92, 0.04, b.L * 0.34, 0, b.H - 0.08, -b.L * 0.06, [0.42, 0.41, 0.39]);
  const detail = (id === 'bus' || id === 'bike') && p.trim ? p.trim : p.trim ? mergeColored([...cab, p.trim]) : mergeColored(cab);
  const groups = [body, detail, lamps, glass] as (THREE.BufferGeometry | null)[];
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  let start = 0;
  groups.forEach((g, gi) => {
    if (!g) return;
    const pp = g.getAttribute('position'), nn = g.getAttribute('normal'), cc = g.getAttribute('color');
    for (let i = 0; i < pp.count; i++) {
      pos.push(pp.getX(i), pp.getY(i), pp.getZ(i));
      nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      col.push(cc.getX(i), cc.getY(i), cc.getZ(i));
    }
    geo.addGroup(start, pp.count, gi);
    start += pp.count;
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.applyMatrix4(m4);
  geo.computeBoundingSphere();
  const wx = (b.W / 2 - 0.12) * sx, wz = (b.wb / 2) * sz, r = b.r * sy;
  const wheels = id === 'bike' ? [new THREE.Vector3(0, r, wz), new THREE.Vector3(0, r, -wz)] : [new THREE.Vector3(wx, r, wz), new THREE.Vector3(-wx, r, wz), new THREE.Vector3(wx, r, -wz), new THREE.Vector3(-wx, r, -wz)];
  const seat = id === 'bike' ? new THREE.Vector3(0, 0.58, -0.18) : id === 'bus' ? new THREE.Vector3(0.7, 1.05, b.L / 2 - 1.5) : new THREE.Vector3(b.W * 0.2 * sx, b.H * sy - 1.36, -b.L * 0.07 * sz);
  const out = { geo, wheels, wheelR: r, roofY: b.H * sy, seat };
  cache.set(key, out);
  return out;
}
