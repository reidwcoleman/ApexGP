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
};

export const VARIANTS: Partial<Record<CarType, string[]>> = {
  sedan: ['sedan', 'compact', 'sedan', 'muscle'],
  sports: ['super', 'coupe', 'muscle'],
  suv: ['suv', 'gwagon'],
  pickup: ['pickup'],
  taxi: ['sedan'],
  police: ['police', 'policeSuv'],
};

type Parts = { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; heads: THREE.BufferGeometry; tails: THREE.BufferGeometry };
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
  const groups = [body, null, lamps, glass] as (THREE.BufferGeometry | null)[];
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
  const wheels = [new THREE.Vector3(wx, r, wz), new THREE.Vector3(-wx, r, wz), new THREE.Vector3(wx, r, -wz), new THREE.Vector3(-wx, r, -wz)];
  const out = { geo, wheels, wheelR: r, roofY: b.H * sy };
  cache.set(key, out);
  return out;
}
