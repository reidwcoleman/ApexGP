import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Env } from './env.ts';
import type { Ground } from './height.ts';
import { U } from './materials.ts';

/**
 * The street furniture that makes it a city and not a model of one, laid out from the same map the
 * buildings came from (dressing.json, written by the Blender build):
 *
 * - every street-facing shopfront gets a sign (lit at night) and some a striped awning over the bays
 * - palms down the side streets; parked cars along the curbs (cars.ts)
 * - mast-arm traffic signals on Collins Avenue that cycle (the traffic stops for red)
 * - green street-name blades at the corners; parking pay stations; newspaper boxes; bike racks and
 *   e-scooters; manholes and storm drains in the asphalt
 * - strings of bulbs over the café terraces on Ocean Drive
 * - sunbathers on towels on the beach
 *
 * Everything static is merged per material (a handful of draw calls); palms and bulbs are instanced.
 * Blender (x, y, z) is three (x, z, -y).
 */

export interface Shop {
  x: number;
  y: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  L: number;
  gf: number;
  h: number;
  bays: [number, number][];
  hotel?: boolean;
}
export interface DressData {
  shops: Shop[];
  xs: [number, number, string][];
  ys: [number, number][];
  od: [number, number];
  city: [number, number, number, number];
  fronts: [number, number, number, number, number, string][];
}

const SW = 0.15;
const B = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

const SHOP_NAMES = [
  'CAFÉ CUBANO', 'FARMACIA', 'SURF SHOP', 'PIZZA', 'BOTÁNICA', 'GELATO', 'LIQUOR', 'CIGARS', 'TATTOO', 'SUSHI BAR', 'MINI MARKET', 'LAVANDERÍA',
  'BARBER SHOP', 'SOUVENIRS', 'SWIMWEAR', 'TACOS', 'JUICE BAR', 'HOSTEL', 'NAILS', 'BIKE RENTAL', 'PANADERÍA', 'VENTANITA', 'CEVICHE', 'ART GALLERY',
  'SUNGLASSES', 'BURGERS', 'WINE BAR', 'DELI', 'YOGA', 'DENTAL', 'REALTY', 'LAUNDROMAT',
];
const SIGN_STYLE: [string, string][] = [
  ['#f4f1ea', '#c4122f'], ['#14243f', '#ffffff'], ['#0d6e6e', '#fdf6e3'], ['#ffffff', '#111111'], ['#e8457a', '#ffffff'], ['#1c1c1c', '#f5c542'],
  ['#2f7d4a', '#ffffff'], ['#f6c945', '#1a1a1a'], ['#7a2e8c', '#ffffff'], ['#0b5fa5', '#ffffff'],
];
const AWNING = ['#1f6fb2', '#c62f3b', '#2f8f5b', '#e0a325', '#1c1c1c', '#7a3fa0', '#e8794d', '#127a7a'];

/** the static geometry, collected per material and merged */
class Pile {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry, m: THREE.Matrix4) {
    const c = g.index ? g.toNonIndexed() : g.clone();
    c.applyMatrix4(m);
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    let l = this.parts.get(mat);
    if (!l) this.parts.set(mat, (l = []));
    l.push(c);
  }
  build(cast: (m: THREE.Material) => boolean): THREE.Group {
    const g = new THREE.Group();
    for (const [mat, gs] of this.parts) {
      const geo = mergeGeometries(gs, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast(mat);
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S1 = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const plane = new THREE.PlaneGeometry(1, 1);

/** a matrix: position, yaw (about up), scale */
function at(p: THREE.Vector3, yaw: number, sx: number, sy: number, sz: number) {
  return M.compose(p, Q.setFromAxisAngle(UP, yaw), V.set(sx, sy, sz)).clone();
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface SignalStop {
  x: number; // three
  z: number;
  yaw: number; // the heading of traffic that stops here
  phase: 'ns' | 'ew';
}

export class Dressing {
  readonly root = new THREE.Group();
  readonly stops: SignalStop[] = [];
  private rnd: () => number;
  private readonly signMats: THREE.MeshStandardMaterial[] = [];
  private readonly lens: Record<'ns' | 'ew', Record<'r' | 'y' | 'g', THREE.MeshStandardMaterial>>;
  private bulbs: THREE.MeshStandardMaterial | null = null;
  private cycle = 0;
  private readonly sunbathers: Person[] = [];

  constructor(readonly scene: THREE.Scene, readonly env: Env, readonly ground: Ground, readonly data: DressData, readonly kit: PeopleKit, readonly world: THREE.Object3D) {
    let s = 777;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const lensMat = (c: number) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0, roughness: 0.2 });
    this.lens = {
      ns: { r: lensMat(0xff2a1a), y: lensMat(0xffb000), g: lensMat(0x18ff8a) },
      ew: { r: lensMat(0xff2a1a), y: lensMat(0xffb000), g: lensMat(0x18ff8a) },
    };
    const pile = new Pile();
    this.shops(pile);
    this.signals(pile);
    this.streetSigns(pile);
    this.furniture(pile);
    this.drains(pile);
    this.cafeLights();
    this.palms();
    const g = pile.build((m) => !(m as THREE.MeshStandardMaterial).transparent && m.name !== 'decal');
    this.root.add(g);
    this.env.prepObject(this.root, true, true);
    this.root.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh && (mm.material as THREE.Material).name === 'decal') mm.castShadow = false;
    });
    scene.add(this.root);
    this.beach();
    this.dunes();
  }

  /** ground height (three coords) with a fallback */
  private gh(x: number, z: number, d = SW): number {
    const h = this.ground.height(x, z);
    return Number.isNaN(h) ? d : h;
  }

  // ------------------------------------------------------------------ shopfronts
  private shops(pile: Pile) {
    const textures = SHOP_NAMES.map((name, i) => {
      const [bg, fg] = SIGN_STYLE[i % SIGN_STYLE.length];
      const t = canvasTex(1024, 192, (g) => {
        g.fillStyle = bg;
        g.fillRect(0, 0, 1024, 192);
        g.strokeStyle = fg;
        g.globalAlpha = 0.35;
        g.lineWidth = 6;
        g.strokeRect(14, 14, 996, 164);
        g.globalAlpha = 1;
        g.fillStyle = fg;
        g.font = `${i % 3 === 0 ? 'italic ' : ''}800 118px "Barlow Condensed", "Arial Narrow", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name, 512, 100, 940);
      });
      const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0, roughness: 0.55 });
      this.signMats.push(m);
      return m;
    });
    const backing = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.6, metalness: 0.3 });
    const awningMats = AWNING.map((c) => {
      const t = canvasTex(64, 64, (g) => {
        g.fillStyle = c;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#f4f1e8';
        g.fillRect(32, 0, 32, 64);
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
    });
    const frame = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.4 });
    for (const sh of this.data.shops) {
      const U = new THREE.Vector3(sh.ux, 0, -sh.uy);
      const N = new THREE.Vector3(sh.nx, 0, -sh.ny);
      const at3 = (u: number, z: number, n: number) => B(sh.x, sh.y, z).addScaledVector(U, u).addScaledVector(N, n);
      // the sign, centred over the shopfront on its signboard band
      const nameI = Math.floor(this.rnd() * SHOP_NAMES.length);
      const w = Math.min(sh.L - 1.2, 2.6 + this.rnd() * 3.2);
      const zc = SW + sh.gf - 0.36;
      const c = at3(sh.L / 2, zc, 0.13);
      const xr = new THREE.Vector3().crossVectors(UP, N).normalize();
      const rot = new THREE.Matrix4().makeBasis(xr, UP, N);
      const mS = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromRotationMatrix(rot), new THREE.Vector3(w, w * (192 / 1024) * 0.95, 1));
      pile.add(textures[nameI], plane, mS);
      const mB = new THREE.Matrix4().compose(at3(sh.L / 2, zc, 0.07), new THREE.Quaternion().setFromRotationMatrix(rot), new THREE.Vector3(w + 0.08, w * 0.18 + 0.08, 0.1));
      pile.add(backing, box, mB);
      // awnings over the bays (about half the shops)
      if (!sh.hotel && this.rnd() < 0.5) {
        const mat = awningMats[Math.floor(this.rnd() * awningMats.length)];
        const zt = SW + sh.gf - 0.78, depth = 1.15 + this.rnd() * 0.4, drop = 0.55;
        for (const [u0, u1] of sh.bays) {
          const a0 = at3(u0 + 0.08, zt, 0.02), a1 = at3(u1 - 0.08, zt, 0.02);
          const b0 = at3(u0 + 0.08, zt - drop, depth), b1 = at3(u1 - 0.08, zt - drop, depth);
          const c0 = at3(u0 + 0.08, zt - drop - 0.26, depth), c1 = at3(u1 - 0.08, zt - drop - 0.26, depth);
          const wd = (u1 - u0 - 0.16) / 0.42;
          pile.add(mat, quad(a0, a1, b1, b0, wd), M.identity());
          pile.add(mat, quad(b0, b1, c1, c0, wd), M.identity());
          // the frame's arms
          for (const u of [u0 + 0.1, u1 - 0.1]) {
            const p0 = at3(u, zt - drop - 0.02, depth - 0.02), p1 = at3(u, zt - 0.55, 0.02);
            pile.add(frame, cyl, rod(p0, p1, 0.018));
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ signals on Collins
  private signals(pile: Pile) {
    const pole = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.7, roughness: 0.42 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.55 });
    const collins = this.data.xs.find((x) => x[2] === 'Collins Avenue');
    if (!collins) return;
    const [x0, x1] = collins;
    for (const [y0, y1] of this.data.ys) {
      if (Math.abs((y0 + y1) / 2) > 240) continue;
      // [corner x, corner y, arm direction (Blender), heads face (Blender), phase]
      const corners: [number, number, number, number, number, number, 'ns' | 'ew'][] = [
        [x0 - 1.1, y0 - 1.1, 1, 0, 0, 1, 'ns'], // SW corner, arm east over Collins, faces north (southbound traffic)
        [x1 + 1.1, y1 + 1.1, -1, 0, 0, -1, 'ns'], // NE corner, arm west, faces south (northbound)
        [x0 - 1.1, y1 + 1.1, 0, -1, 1, 0, 'ew'], // NW corner, arm south over the street, faces east (westbound)
        [x1 + 1.1, y0 - 1.1, 0, 1, -1, 0, 'ew'], // SE corner, arm north, faces west (eastbound)
      ];
      for (const [cx, cy, ax, ay, fx, fy, ph] of corners) {
        const base = B(cx, cy, 0);
        base.y = this.gh(base.x, base.z);
        const H = 6.4;
        pile.add(pole, cyl, rod(base, base.clone().setY(base.y + H), 0.13));
        const reach = ph === 'ns' ? (x1 - x0) * 0.72 : (y1 - y0) * 0.8;
        const end = B(cx + ax * reach, cy + ay * reach, 0).setY(base.y + H - 0.3);
        pile.add(pole, cyl, rod(base.clone().setY(base.y + H - 0.3), end, 0.08));
        // a brace
        pile.add(pole, cyl, rod(base.clone().setY(base.y + H - 1.4), B(cx + ax * reach * 0.45, cy + ay * reach * 0.45, 0).setY(base.y + H - 0.32), 0.04));
        const face = Math.atan2(fx, -fy); // the yaw that turns +z (three) toward (fx, -fy)
        for (const k of [0.55, 0.95]) {
          const hp = B(cx + ax * reach * k, cy + ay * reach * k, 0).setY(base.y + H - 1.05);
          pile.add(housing, box, at(hp, face, 0.36, 1.08, 0.26));
          for (const [i, col] of (['r', 'y', 'g'] as const).entries()) {
            const lp = hp.clone().add(new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(0.135));
            lp.y += 0.34 - i * 0.34;
            pile.add(this.lens[ph][col], cyl, M.compose(lp, Q.setFromAxisAngle(new THREE.Vector3(Math.cos(face), 0, -Math.sin(face)), Math.PI / 2), V.set(0.24, 0.02, 0.24)).clone());
            // a visor over each lens
            const vp = lp.clone().add(new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(0.09));
            vp.y += 0.1;
            pile.add(housing, box, at(vp, face, 0.28, 0.02, 0.18));
          }
        }
        // where its traffic stops: a few metres before the crossing, heading against the heads' facing
        const stopB = ph === 'ns' ? (fy > 0 ? [(x0 + x1) / 2, y1 + 3.2] : [(x0 + x1) / 2, y0 - 3.2]) : fx > 0 ? [x1 + 3.2, (y0 + y1) / 2] : [x0 - 3.2, (y0 + y1) / 2];
        const sp = B(stopB[0], stopB[1], 0);
        this.stops.push({ x: sp.x, z: sp.z, yaw: Math.atan2(-fx, fy), phase: ph });
      }
    }
  }

  /**
   * Downtown's signals: a mast arm over each approach from the corner on its right, two heads facing the
   * traffic; north-south approaches run with Collins' phase, east-west with the cross streets'. (Blender
   * coords: crosswalk centre, heading of the arriving traffic, the road's width, one-way.)
   */
  addSignals(list: { legs: [number, number, number, number, number][] }[]) {
    const pile = new Pile();
    const pole = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.7, roughness: 0.42 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.55 });
    for (const c of list) {
      for (const [x, y, hb, W, one] of c.legs) {
        const dx = Math.sin(hb), dy = Math.cos(hb);
        const ph: 'ns' | 'ew' = Math.abs(dy) > 0.7 ? 'ns' : 'ew';
        const rx = dy, ry = -dx;
        const off = (one ? W / 2 : W / 2) + 1.3;
        const cx = x + rx * off - dx * 1.2, cy = y + ry * off - dy * 1.2;
        const base = B(cx, cy, 0);
        base.y = this.gh(base.x, base.z);
        const H = 6.6;
        pile.add(pole, cyl, rod(base, base.clone().setY(base.y + H), 0.14));
        const reach = one ? W * 0.78 : W * 0.48;
        const end = B(cx - rx * reach, cy - ry * reach, 0).setY(base.y + H - 0.3);
        pile.add(pole, cyl, rod(base.clone().setY(base.y + H - 0.3), end, 0.085));
        pile.add(pole, cyl, rod(base.clone().setY(base.y + H - 1.5), B(cx - rx * reach * 0.42, cy - ry * reach * 0.42, 0).setY(base.y + H - 0.32), 0.04));
        const face = Math.atan2(-dx, dy);
        const nh = one && W > 9 ? 3 : 2;
        for (let k = 0; k < nh; k++) {
          const f = 0.45 + (0.5 * (k + 0.5)) / nh;
          const hp = B(cx - rx * reach * f, cy - ry * reach * f, 0).setY(base.y + H - 1.05);
          pile.add(housing, box, at(hp, face, 0.36, 1.08, 0.26));
          for (const [i, col] of (['r', 'y', 'g'] as const).entries()) {
            const lp = hp.clone().add(new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(0.135));
            lp.y += 0.34 - i * 0.34;
            pile.add(this.lens[ph][col], cyl, M.compose(lp, Q.setFromAxisAngle(new THREE.Vector3(Math.cos(face), 0, -Math.sin(face)), Math.PI / 2), V.set(0.24, 0.02, 0.24)).clone());
            const vp = lp.clone().add(new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(0.09));
            vp.y += 0.1;
            pile.add(housing, box, at(vp, face, 0.28, 0.02, 0.18));
          }
        }
        // the traffic stops a few metres short of the crosswalk
        const sp = B(x - dx * 3.4, y - dy * 3.4, 0);
        this.stops.push({ x: sp.x, z: sp.z, yaw: Math.PI - hb, phase: ph });
      }
    }
    const g = pile.build(() => true);
    this.env.prepObject(g, true, true);
    this.root.add(g);
  }

  /** the lights: Collins green 14 s, amber 3, all red 1.5, then the cross streets the same */
  signalState(ph: 'ns' | 'ew'): 'g' | 'y' | 'r' {
    const T = 37;
    const t = this.cycle % T;
    const o = ph === 'ns' ? t : (t + T / 2) % T;
    return o < 14 ? 'g' : o < 17 ? 'y' : 'r';
  }

  // ------------------------------------------------------------------ street names
  private streetSigns(pile: Pile) {
    const post = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.4 });
    const names = ['6 St', '7 St', '8 St', '9 St', '10 St'];
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const blade = (txt: string) => {
      let m = mats.get(txt);
      if (!m) {
        const t = canvasTex(512, 96, (g) => {
          g.fillStyle = '#0d5c36';
          g.fillRect(0, 0, 512, 96);
          g.strokeStyle = '#ffffff';
          g.lineWidth = 4;
          g.strokeRect(6, 6, 500, 84);
          g.fillStyle = '#ffffff';
          g.font = '700 66px "Barlow Condensed", "Arial Narrow", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(txt, 256, 52);
        });
        m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
        mats.set(txt, m);
      }
      return m;
    };
    const roads: [number, number, string][] = [[this.data.od[0], this.data.od[1], 'Ocean Dr'], ...this.data.xs.map((x) => [x[0], x[1], x[2].replace('Avenue', 'Ave').replace('Court', 'Ct')] as [number, number, string])];
    this.data.ys.forEach(([y0, y1], i) => {
      for (const [x0, , nm] of roads) {
        if (Math.abs(x0) > 240) continue;
        const p = B(x0 - 1.0, y1 + 1.0, 0);
        p.y = this.gh(p.x, p.z);
        pile.add(post, cyl, rod(p, p.clone().setY(p.y + 3.3), 0.035));
        const a = p.clone().setY(p.y + 3.2);
        pile.add(blade(names[i] ?? ''), plane, at(a.clone().add(new THREE.Vector3(0.45, 0, 0)), 0, 0.95, 0.18, 1));
        pile.add(blade(nm), plane, at(a.clone().setY(a.y + 0.22).add(new THREE.Vector3(0, 0, -0.45)), Math.PI / 2, 0.95, 0.18, 1));
      }
    });
  }

  // ------------------------------------------------------------------ pay stations, news boxes, bike racks, scooters
  private furniture(pile: Pile) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.5, roughness: 0.45 });
    const screen = new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x3aa0ff, emissiveIntensity: 0.25, roughness: 0.2 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xa9adb2, metalness: 0.85, roughness: 0.3 });
    const news = ['#c8102e', '#0b4ea2', '#f2f2f2', '#2b8a3e', '#f0b323'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.2 }));
    const scoot = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.4 });
    const scootAccent = new THREE.MeshStandardMaterial({ color: 0x27c4a8, roughness: 0.4 });
    const r = this.rnd;
    const payStation = (x: number, z: number, yaw: number) => {
      const y = this.gh(x, z);
      pile.add(dark, box, at(new THREE.Vector3(x, y + 0.7, z), yaw, 0.32, 1.4, 0.24));
      pile.add(screen, box, at(new THREE.Vector3(x, y + 1.18, z).add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.125)), yaw, 0.22, 0.16, 0.01));
    };
    // Ocean Drive's west sidewalk, and the side streets
    for (let y = -300; y < 400; y += 27) payStation(-7.45, -y, Math.PI / 2);
    for (const [y0, y1] of this.data.ys) for (let x = -250; x < -14; x += 34) if (!this.nearRoad(x)) for (const yy of [y0 - 0.9, y1 + 0.9]) payStation(x, -yy, yy < y0 ? 0 : Math.PI);
    // newspaper boxes at corners
    for (const [y0, y1] of this.data.ys) {
      if (Math.abs(y0) > 240) continue;
      for (const [cx, cy] of [[-8.0, y0 - 1.4], [-99.2, y1 + 1.4]]) {
        for (let k = 0; k < 3; k++) {
          const p = B(cx - k * 0.62, cy, 0);
          p.y = this.gh(p.x, p.z);
          const m = news[Math.floor(r() * news.length)];
          pile.add(m, box, at(p.clone().setY(p.y + 0.55), 0, 0.5, 0.9, 0.45));
          pile.add(dark, box, at(p.clone().setY(p.y + 0.06), 0, 0.42, 0.12, 0.4));
        }
      }
    }
    // bike racks (inverted U) and scooters along the park side of Ocean Drive
    for (let y = -90; y < 95; y += 30) {
      const x = 9.9;
      const z = -y;
      const g = this.gh(x, z);
      for (let k = 0; k < 4; k++) {
        const zz = z + k * 0.9;
        const a = new THREE.Vector3(x - 0.35, g, zz), b = new THREE.Vector3(x + 0.35, g, zz);
        pile.add(steel, cyl, rod(a, a.clone().setY(g + 0.8), 0.025));
        pile.add(steel, cyl, rod(b, b.clone().setY(g + 0.8), 0.025));
        pile.add(steel, cyl, rod(a.clone().setY(g + 0.8), b.clone().setY(g + 0.8), 0.025));
      }
      for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
        const sx = x + 0.9 + r() * 0.5, sz = z + 4 + k * 0.7, yaw = (r() - 0.5) * 0.5;
        const sy = this.gh(sx, sz);
        const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const p = new THREE.Vector3(sx, sy, sz);
        pile.add(scoot, box, at(p.clone().setY(sy + 0.12), yaw, 0.16, 0.05, 0.95));
        pile.add(scootAccent, box, at(p.clone().setY(sy + 0.15), yaw, 0.1, 0.01, 0.5));
        const top = p.clone().addScaledVector(f, 0.42).setY(sy + 1.1);
        pile.add(scoot, cyl, rod(p.clone().addScaledVector(f, 0.45).setY(sy + 0.12), top, 0.02));
        pile.add(scoot, cyl, rod(top.clone().add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.25)), top.clone().add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(-0.25)), 0.015));
        for (const d of [0.42, -0.42]) pile.add(scoot, cyl, M.compose(p.clone().addScaledVector(f, d).setY(sy + 0.1), Q.setFromAxisAngle(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), Math.PI / 2), V.set(0.2, 0.05, 0.2)).clone());
      }
    }
  }

  private nearRoad(x: number) {
    return this.data.xs.some(([a, b]) => x > a - 7 && x < b + 7);
  }

  // ------------------------------------------------------------------ manholes and drains
  private drains(pile: Pile) {
    const iron = canvasTex(128, 128, (g) => {
      g.fillStyle = '#5e5953';
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#7d776f';
      g.lineWidth = 3;
      for (let r = 12; r < 60; r += 10) {
        g.beginPath();
        g.arc(64, 64, r, 0, Math.PI * 2);
        g.stroke();
      }
      for (let a = 0; a < 12; a++) {
        g.beginPath();
        g.moveTo(64, 64);
        g.lineTo(64 + Math.cos((a / 12) * Math.PI * 2) * 60, 64 + Math.sin((a / 12) * Math.PI * 2) * 60);
        g.stroke();
      }
    });
    const grate = canvasTex(128, 64, (g) => {
      g.fillStyle = '#141210';
      g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#6a645d';
      for (let x = 6; x < 128; x += 12) g.fillRect(x, 6, 5, 52);
    });
    const mh = new THREE.MeshStandardMaterial({ name: 'decal', map: iron, transparent: true, alphaTest: 0.5, roughness: 0.45, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const gr = new THREE.MeshStandardMaterial({ name: 'decal', map: grate, roughness: 0.5, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const flat = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const put = (mat: THREE.Material, x: number, z: number, w: number, d: number, yaw: number) => {
      const y = this.gh(x, z, 0) + 0.012;
      pile.add(mat, plane, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.setFromAxisAngle(UP, yaw), V.set(w, 1, d)).multiply(flat));
    };
    for (let y = -300; y < 400; y += 31) put(mh, 0.6, -y, 0.75, 0.75, 0);
    for (const [y0, y1] of this.data.ys) for (let x = -250; x < -12; x += 37) put(mh, x, -(y0 + y1) / 2, 0.75, 0.75, 0);
    for (const [x0, x1] of this.data.xs) for (let y = -300; y < 400; y += 37) put(mh, (x0 + x1) / 2, -y, 0.75, 0.75, 0);
    // storm drains in the gutters near the corners
    for (const [y0, y1] of this.data.ys)
      for (const [x0, x1] of [[this.data.od[0], this.data.od[1]], ...this.data.xs.map((x) => [x[0], x[1]])]) {
        if (Math.abs(x0) > 240) continue;
        put(gr, x0 - 6, -(y0 + 0.45), 0.9, 0.4, 0);
        put(gr, x1 + 6, -(y1 - 0.45), 0.9, 0.4, 0);
      }
  }

  // ------------------------------------------------------------------ café string lights
  private cafeLights() {
    const cafes = new Set(['700', '720', '736', '740', '750', '760', '800', '660', '650', '820', '826', '900']);
    const pts: THREE.Vector3[] = [];
    for (const [, xf, y0, y1, , num] of this.data.fronts) {
      if (!cafes.has(num)) continue;
      // zig-zag from the facade to the curb side of the terrace, sagging between
      let side = 0;
      for (let y = y0 + 1.2; y < y1 - 1.5; y += 3.3) {
        const a = B(side ? -8.3 : xf + 0.3, y, SW + (side ? 3.0 : 3.6));
        const b = B(side ? xf + 0.3 : -8.3, y + 3.3, SW + (side ? 3.6 : 3.0));
        const n = Math.ceil(a.distanceTo(b) / 0.42);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const p = a.clone().lerp(b, t);
          p.y -= Math.sin(t * Math.PI) * 0.32;
          pts.push(p);
        }
        side ^= 1;
      }
    }
    if (!pts.length) return;
    this.bulbs = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffc27a, emissiveIntensity: 0.4, roughness: 0.3 });
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 8, 6), this.bulbs, pts.length);
    pts.forEach((p, i) => im.setMatrixAt(i, M.compose(p, Q.identity(), S1)));
    // the wire
    const wire = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts.flatMap((p, i) => (i && p.distanceTo(pts[i - 1]) < 0.6 ? [pts[i - 1], p] : []))),
      new THREE.LineBasicMaterial({ color: 0x151515 }),
    );
    this.root.add(im, wire);
  }

  // ------------------------------------------------------------------ palms down the side streets
  private palms() {
    const variants: THREE.InstancedMesh[][] = [];
    for (let k = 0; k < 6; k++) {
      const parts: THREE.InstancedMesh[] = [];
      this.world.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh && new RegExp(`^palm_${k}(_\\d)?_inst$`).test(im.name)) parts.push(im);
      });
      if (parts.length) variants.push(parts);
    }
    if (!variants.length) return;
    const spots: [number, number][] = [];
    const r = this.rnd;
    const ok = (bx: number, by: number) => {
      const p = B(bx, by, 0);
      const h = this.ground.height(p.x, p.z);
      return !Number.isNaN(h) && h > 0.05 && h < 0.45 && !this.ground.blocked(p.x, p.z) && Math.hypot(bx, by) < 280;
    };
    for (const [y0, y1] of this.data.ys)
      for (const yy of [y0 - 1.6, y1 + 1.6])
        for (let x = -250; x < -16; x += 13 + r() * 5) if (!this.data.xs.some(([a, b]) => x > a - 9 && x < b + 9) && ok(x, yy)) spots.push([x, yy]);
    for (const [x0, x1] of this.data.xs)
      for (const xx of [x0 - 1.6, x1 + 1.6])
        for (let y = -300; y < 400; y += 14 + r() * 5) if (!this.data.ys.some(([a, b]) => y > a - 9 && y < b + 9) && ok(xx, y)) spots.push([xx, y]);
    const byVar = variants.map(() => [] as THREE.Matrix4[]);
    for (const [bx, by] of spots) {
      const v = Math.floor(r() * variants.length);
      const p = B(bx, by, 0);
      p.y = this.gh(p.x, p.z) - 0.05;
      const sc = 0.85 + r() * 0.25;
      byVar[v].push(new THREE.Matrix4().compose(p, Q.setFromAxisAngle(UP, r() * Math.PI * 2), V.set(sc, sc, sc)));
    }
    variants.forEach((parts, v) => {
      const mats = byVar[v];
      if (!mats.length) return;
      for (const src of parts) {
        const im = new THREE.InstancedMesh(src.geometry, src.material, mats.length);
        // the source's own instance 0 carries the axis change from Blender: apply ours on top of its rotation
        const m0 = new THREE.Matrix4();
        src.getMatrixAt(0, m0);
        const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s0 = new THREE.Vector3();
        m0.decompose(p0, q0, s0);
        const qBase = q0.clone(), sBase = s0.clone().divideScalar(s0.y || 1);
        mats.forEach((m, i) => {
          const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
          m.decompose(p, q, sc);
          // keep the source's tilt (its local axes), spin about up, our scale
          im.setMatrixAt(i, new THREE.Matrix4().compose(p, q.multiply(qBase), sBase.clone().multiplyScalar(sc.x * (s0.y || 1))));
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        this.root.add(im);
      }
    });
  }

  // ------------------------------------------------------------------ the dunes
  /** sea oats in thick clumps over the dune (swaying in the wind), and a rope fence on posts along its foot */
  private dunes() {
    const r = this.rnd;
    // one tuft: 14 curved blades and a few taller seed stalks
    const pos: number[] = [], col: number[] = [];
    for (let b = 0; b < 16; b++) {
      const a = r() * Math.PI * 2, lean = 0.25 + r() * 0.55, h = 0.45 + r() * 0.5 + (b > 12 ? 0.5 : 0);
      const w = b > 12 ? 0.006 : 0.016;
      const dx = Math.cos(a), dz = Math.sin(a);
      const ox = (r() - 0.5) * 0.25, oz = (r() - 0.5) * 0.25;
      let px = ox, py = 0, pz = oz;
      const N = 4;
      const g = 0.6 + r() * 0.3, dry = r() < 0.3 || b > 12 ? 1 : 0;
      const c0 = dry ? [0.6, 0.53, 0.36] : [0.38 * g, 0.47 * g, 0.24 * g];
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        const nx = ox + dx * lean * h * t1 * t1, ny = h * t1, nz = oz + dz * lean * h * t1 * t1;
        const w0 = w * (1 - t0), w1 = w * (1 - t1) + 0.001;
        const sx = -dz, sz = dx;
        const q = [
          [px - sx * w0, py, pz - sz * w0], [px + sx * w0, py, pz + sz * w0], [nx + sx * w1, ny, nz + sz * w1],
          [px - sx * w0, py, pz - sz * w0], [nx + sx * w1, ny, nz + sz * w1], [nx - sx * w1, ny, nz - sz * w1],
        ];
        for (const v of q) {
          pos.push(v[0], v[1], v[2]);
          const k = 0.75 + 0.35 * (v[1] / h);
          col.push(c0[0] * k, c0[1] * k, c0[2] * k);
        }
        px = nx; py = ny; pz = nz;
      }
      if (b > 12) {
        // the seed head: a panicle of flat, oat-like spikelets dangling off the arching stalk tip
        for (let i = 0; i < 9; i++) {
          const t = i / 9;
          const sx = px + dx * (0.02 + 0.09 * t), sz = pz + dz * (0.02 + 0.09 * t), sy = py - 0.03 - 0.16 * t * t;
          const a2 = r() * 6.28;
          const ex = Math.cos(a2) * 0.012, ez = Math.sin(a2) * 0.012;
          const L2 = 0.045 + 0.02 * r();
          pos.push(sx - ex, sy, sz - ez, sx + ex, sy, sz + ez, sx + ex * 0.3, sy - L2, sz + ez * 0.3);
          pos.push(sx - ex, sy, sz - ez, sx + ex * 0.3, sy - L2, sz + ez * 0.3, sx - ex * 0.3, sy - L2, sz - ez * 0.3);
          const k = 0.85 + 0.3 * r();
          for (let v = 0; v < 6; v++) col.push(0.66 * k, 0.56 * k, 0.36 * k);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    // grass lights like a soft carpet: the blades' normals lean to the sky
    {
      const nn = g.getAttribute('normal') as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < nn.count; i++) {
        v.fromBufferAttribute(nn, i);
        if (v.y < 0) v.negate();
        v.y += 1.6;
        v.normalize();
        nn.setXYZ(i, v.x, v.y, v.z);
      }
    }
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, name: 'od_seaoats' });
    m.onBeforeCompile = (sh) => {
      // both faces of a blade keep the sky-leaning normal (no flip for the back face)
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      sh.uniforms.uTime = U.uTime;
      sh.uniforms.uWind = U.uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 iw = instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
          float sway = ( sin( uTime * 1.7 + iw.x * 0.31 + iw.z * 0.23 ) * 0.6 + sin( uTime * 3.1 + iw.z * 0.7 ) * 0.25 ) * ( 0.25 + uWind );
          transformed.x += sway * 0.12 * transformed.y * transformed.y;
          transformed.z += sway * 0.05 * transformed.y * transformed.y;`,
        );
    };
    this.env.prep(m);
    // where: over the dune (x 100..134), denser on the crest, in clumps; not on the beach-access paths
    const N = 9000;
    const im = new THREE.InstancedMesh(g, m, N);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; n < N && tries < N * 4; tries++) {
      const x = 100 + r() * 34, z = -440 + r() * 800;
      const clump = Math.sin(z * 0.09 + Math.sin(z * 0.023) * 3) * 0.5 + Math.sin(x * 0.4 + z * 0.05) * 0.5;
      const crest = 1 - Math.abs(x - 116) / 17;
      if (r() > crest * 1.1 + clump * 0.3) continue;
      // the boardwalk crossings every ~95 m stay clear
      if (Math.abs(((z + 1000) % 95) - 47) < 3) continue;
      const y = this.gh(x, z, NaN);
      if (Number.isNaN(y) || y < 0.25) continue;
      const k = 1.3 + r() * 1.1;
      M.compose(P.set(x, y - 0.03, z), Q.setFromAxisAngle(S.set(0, 1, 0), r() * 6.28), S.set(k, k * (0.8 + r() * 0.5), k));
      im.setMatrixAt(n++, M);
    }
    im.count = n;
    // thousands of thin blades: too many for the shadow cascades, and their shadows would only be a speckle
    im.castShadow = false;
    im.receiveShadow = true;
    this.root.add(im);
    // the rope fence along the dune's foot (seaward), posts every 3 m
    const posts: THREE.Vector3[] = [];
    for (let z = -430; z <= 350; z += 3) {
      if (Math.abs(((z + 1000) % 95) - 47) < 4) continue;
      const x = 134 + Math.sin(z * 0.02) * 1.5;
      const y = this.gh(x, z, NaN);
      if (!Number.isNaN(y)) posts.push(new THREE.Vector3(x, y, z));
    }
    const pg = new THREE.CylinderGeometry(0.045, 0.05, 1.0, 6);
    pg.translate(0, 0.45, 0);
    const pm = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.9 });
    const pi = new THREE.InstancedMesh(pg, pm, posts.length);
    posts.forEach((p, i) => pi.setMatrixAt(i, M.makeTranslation(p.x, p.y, p.z)));
    pi.castShadow = true;
    this.root.add(pi);
    const rp: number[] = [];
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i], b = posts[i + 1];
      if (b.z - a.z > 3.5) continue;
      for (const h of [0.55, 0.85]) {
        // a slight sag between posts
        for (let k = 0; k < 4; k++) {
          const t0 = k / 4, t1 = (k + 1) / 4;
          const s0 = Math.sin(t0 * Math.PI) * 0.06, s1 = Math.sin(t1 * Math.PI) * 0.06;
          rp.push(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0 + h - s0, a.z + (b.z - a.z) * t0);
          rp.push(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1 + h - s1, a.z + (b.z - a.z) * t1);
        }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    this.root.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x6b5e4c })));
    this.env.prep(pm);
  }

  // ------------------------------------------------------------------ sunbathers
  private beach() {
    const r = this.rnd;
    const towelCols = [['#e8457a', '#ffffff'], ['#1f6fb2', '#ffd23f'], ['#2f8f5b', '#ffffff'], ['#f08a24', '#2a2a2a'], ['#7a3fa0', '#7fe0d0'], ['#c62f3b', '#ffffff']];
    // the sports bodies are the nearest thing to beachwear in the loaded set
    const bodies = ['Sports_Female_02', 'Sports_Male_01'];
    for (let i = 0; i < 34; i++) {
      // in clusters by the umbrellas, thinning out toward the ends of the beach
      const x = 160 + r() * 62, z = (r() - 0.5) * (i < 20 ? 170 : 560);
      const y = this.gh(x, z, 0.5);
      const yaw = r() * Math.PI * 2;
      const [a, b] = towelCols[i % towelCols.length];
      const t = canvasTex(64, 128, (g) => {
        for (let k = 0; k < 8; k++) {
          g.fillStyle = k % 2 ? a : b;
          g.fillRect(0, k * 16, 64, 16);
        }
      });
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.85), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
      towel.rotation.set(-Math.PI / 2, 0, yaw);
      towel.position.set(x, y + 0.02, z);
      towel.receiveShadow = true;
      this.root.add(towel);
      // their own umbrella, stuck in the sand at a tilt, and a bag or a cooler
      if (r() < 0.55) {
        const cols = [0xf25c78, 0xffd23f, 0x2fa8d6, 0x5ec26a, 0xff8a3d, 0xffffff, 0x8a5cd6];
        const u = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.1, 6), new THREE.MeshStandardMaterial({ color: 0xdedbd4, metalness: 0.5, roughness: 0.4 }));
        pole.position.y = 1.0;
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.38, 10, 1, true), new THREE.MeshStandardMaterial({ color: cols[Math.floor(r() * cols.length)], roughness: 0.85, side: THREE.DoubleSide }));
        canopy.position.y = 2.0;
        u.add(pole, canopy);
        u.position.set(x + Math.cos(yaw) * 0.9, y - 0.15, z - Math.sin(yaw) * 0.9);
        u.rotation.set((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5);
        u.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : 0));
        this.root.add(u);
        this.env.prepObject(u, true, true);
      }
      if (r() < 0.5) {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, 0.3), new THREE.MeshStandardMaterial({ color: r() < 0.5 ? 0x2a6fd6 : 0xe94b3c, roughness: 0.6 }));
        bag.position.set(x + Math.sin(yaw + 1.3) * 0.9, y + 0.12, z + Math.cos(yaw + 1.3) * 0.9);
        bag.rotation.y = r() * 3;
        bag.castShadow = true;
        this.root.add(bag);
        this.env.prepObject(bag, true, true);
      }
      const body = bodies[Math.floor(r() * bodies.length)];
      const look: Look = {
        female: body.includes('Female'), tone: r(), body, hair: 'none', hairColor: 0x2a1d14,
        top: 'tshirt', topColor: 0xffffff, tint: 0, bottom: 'jeans', bottomColor: 0x2d3f63, height: 1,
      };
      const p = new Person(this.kit, look);
      p.play('idle', { offset: r() });
      p.update(0.016);
      // lying on the back, head toward the towel's end
      p.root.position.set(x - Math.sin(yaw) * 0.85, y + 0.12, z - Math.cos(yaw) * 0.85);
      p.root.rotation.set(-Math.PI / 2, yaw + Math.PI, 0, 'YXZ');
      // lying still: posed once, no shadow pass past the near ones (they're flat on the sand anyway)
      this.env.prepObject(p.root, Math.abs(z) < 90, true);
      this.scene.add(p.root);
      this.sunbathers.push(p);
    }
  }

  update(dt: number, night: number, lamps: number) {
    this.cycle += dt;
    for (const ph of ['ns', 'ew'] as const) {
      const st = this.signalState(ph);
      for (const c of ['r', 'y', 'g'] as const) this.lens[ph][c].emissiveIntensity = st === c ? 6 + night * 4 : 0.05;
    }
    for (const m of this.signMats) m.emissiveIntensity = 0.02 + night * 1.6;
    if (this.bulbs) this.bulbs.emissiveIntensity = 0.3 + lamps * 14;
    void dt;
  }

  /** how far ahead a car (at x, z heading yaw) must stop for a red, or Infinity */
  stopFor(x: number, z: number, yaw: number): number {
    let best = Infinity;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const s of this.stops) {
      if (Math.cos(s.yaw - yaw) < 0.7) continue;
      const dx = s.x - x, dz = s.z - z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along < 0.5 || along > 40 || lat > 8) continue;
      const st = this.signalState(s.phase);
      if (st === 'r' || (st === 'y' && along > 9)) best = Math.min(best, along);
    }
    return best;
  }
}

/** a quad (a b c d) with uv u across 0..uw, v 0..1 */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uw: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, uw, 1, uw, 0, 0, 1, uw, 0, 0, 0], 2));
  g.computeVertexNormals();
  return g;
}

/** a unit cylinder (radius 0.5, height 1, along y) stretched from a to b with radius r */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Matrix4 {
  const d = b.clone().sub(a);
  const L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r * 2, L, r * 2));
}
