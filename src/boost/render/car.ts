import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Car } from '../sim/car.ts';

/**
 * A battle car built from code, in the simulation's car frame (cm; x forward, y left, z up, the
 * ground at z = −17). An original body in the arena game's proportions: a compact tub filling the
 * hitbox, fenders swelling over chunky wheels with slim arch lips and dark wells, a tall cabin with a
 * steep screen and big glass, a short nose, a ducktail spoiler and twin boost nozzles. Every panel is
 * a lofted superellipse so the paint carries smooth reflections; team paint under a clear coat with
 * the player's accent in the stripes, swoosh, spoiler and rims.
 */

export const TEAM_COLORS = [0x1458ff, 0xff5a0a];

type P3 = [number, number, number];
const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
/** piecewise-linear lookup in [x, y] knots (x descending or ascending) */
function pl(k: [number, number][], x: number): number {
  const asc = k[0][0] < k[k.length - 1][0];
  const a = asc ? k : [...k].reverse();
  if (x <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) {
    if (x <= a[i][0]) {
      const t = (x - a[i - 1][0]) / (a[i][0] - a[i - 1][0]);
      const s = t * t * (3 - 2 * t);
      return a[i - 1][1] + (a[i][1] - a[i - 1][1]) * (0.35 * t + 0.65 * s);
    }
  }
  return a[a.length - 1][1];
}

/**
 * a (nu+1) × (nv+1) grid surface; `centre(u)` is a point inside the surface at station u, used to
 * turn the triangles outward. Closed in v: the seam's normals are averaged.
 */
function grid(nu: number, nv: number, P: (u: number, v: number) => P3, centre: (u: number) => P3, closedV: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const p = P(i / nu, j / nv);
      pos.push(p[0], p[1], p[2]);
      uv.push(i / nu, j / nv);
    }
  const idx: number[] = [];
  const at = (i: number, j: number) => i * (nv + 1) + j;
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = at(i, j);
      const b = at(i, j + 1);
      const c = at(i + 1, j);
      const d = at(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  // orientation probe at the middle
  const i0 = nu >> 1;
  const j0 = nv >> 2;
  const v = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const pa = v(at(i0, j0));
  const n = new THREE.Vector3().subVectors(v(at(i0, j0 + 1)), pa).cross(new THREE.Vector3().subVectors(v(at(i0 + 1, j0)), pa));
  const c = centre(i0 / nu);
  if (n.dot(pa.clone().sub(new THREE.Vector3(c[0], c[1], c[2]))) < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closedV) {
    const nr = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i <= nu; i++) {
      const a = at(i, 0);
      const b = at(i, nv);
      const x = nr.getX(a) + nr.getX(b);
      const y = nr.getY(a) + nr.getY(b);
      const z = nr.getZ(a) + nr.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      nr.setXYZ(a, x / l, y / l, z / l);
      nr.setXYZ(b, x / l, y / l, z / l);
    }
  }
  return g;
}

interface Sec {
  /** half width */
  w: number;
  zb: number;
  zt: number;
  yc?: number;
  /** superellipse exponent: 2 an ellipse, 4 a rounded box */
  n?: number;
  /** the top this much narrower than the bottom (0..1) */
  tumble?: number;
  /** the bottom this much narrower than the middle (0..1): the body tucked in behind the wheels */
  tuck?: number;
}

/** a body lofted along x through superellipse sections, the ends rounded over `round` cm */
function loft(x0: number, x1: number, sec: (x: number) => Sec, o: { nu?: number; nv?: number; round?: number; a0?: number; a1?: number } = {}): THREE.BufferGeometry {
  const nu = o.nu ?? 40;
  const nv = o.nv ?? 32;
  const round = o.round ?? 6;
  const a0 = o.a0 ?? 0;
  const a1 = o.a1 ?? Math.PI * 2;
  const closed = a1 - a0 > 6.28;
  const xAt = (u: number) => x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
  return grid(
    nu,
    nv,
    (u, v) => {
      const x = xAt(u);
      const s = sec(x);
      const d = Math.min(x - x0, x1 - x);
      const k = d < round ? Math.sqrt(Math.max(0, 1 - (1 - d / round) ** 2)) : 1;
      const a = a0 + (a1 - a0) * v;
      const n = s.n ?? 3;
      const ys = spow(Math.cos(a), 2 / n);
      const zs = spow(Math.sin(a), 2 / n);
      const zm = (s.zb + s.zt) / 2;
      const hh = (s.zt - s.zb) / 2;
      const w = s.w * (1 - (s.tumble ?? 0) * Math.max(0, zs) - (s.tuck ?? 0) * Math.max(0, -zs) ** 1.5);
      return [x, (s.yc ?? 0) + w * ys * k, zm + hh * zs * k];
    },
    (u) => {
      const x = xAt(u);
      const s = sec(x);
      return [x, s.yc ?? 0, (s.zb + s.zt) / 2];
    },
    closed,
  );
}

/** a hoop swept round a wheel (centre cx, cz in the x–z plane) from angle t0 to t1 */
function hoop(cx: number, cz: number, R: number, t0: number, t1: number, yc: number, halfY: number, halfT: number): THREE.BufferGeometry {
  const nu = 30;
  const nv = 20;
  const span = t1 - t0;
  return grid(
    nu,
    nv,
    (u, v) => {
      const t = t0 + span * u;
      const d = Math.min(u, 1 - u) * span * R;
      const k = d < 4 ? Math.sqrt(Math.max(0, 1 - (1 - d / 4) ** 2)) : 1;
      const a = Math.PI * 2 * v;
      const ys = spow(Math.cos(a), 0.5);
      const rs = spow(Math.sin(a), 0.5);
      // the outer edge flares out and down a little
      const flare = Math.max(0, ys) * 1.5;
      const r = R + rs * halfT * k + flare;
      return [cx + Math.cos(t) * r, yc + ys * halfY * k * Math.sign(yc), cz + Math.sin(t) * r];
    },
    (u) => {
      const t = t0 + span * u;
      return [cx + Math.cos(t) * R, yc, cz + Math.sin(t) * R];
    },
    true,
  );
}

// ------------------------------------------------------------------ the shape
// the proportions of the arena game's battle cars, an original body: a compact tub that fills the
// hitbox, fenders swelling out over chunky wheels, a tall cabin with big glass, a short nose
const WF: P3 = [51.25, 34.5, 13.5]; // front wheel: x, |y|, radius (drawn)
const WR: P3 = [-33.75, 35, 16];
const wz = (r: number) => r - 17;

const bodyTop: [number, number][] = [
  [76, 12],
  [70, 16.5],
  [58, 19.5],
  [42, 21.5],
  [30, 23],
  [0, 25.5],
  [-30, 27],
  [-44, 27.5],
  [-50, 25],
];
// the plan: fenders over each axle, a waist between, a narrower nose and tail
const bodyHalfW: [number, number][] = [
  [76, 24],
  [70, 31],
  [62, 36.5],
  [51, 38.5],
  [40, 36.5],
  [26, 33],
  [4, 33],
  [-18, 35.5],
  [-34, 39.5],
  [-44, 37.5],
  [-50, 33],
];

// near each wheel the lower body tucks in behind the tyre, so the fender swells out over it
const nearWheel = (x: number) => Math.max(0, 1 - Math.abs(x - WF[0]) / (WF[2] + 6)) ** 0.6 + Math.max(0, 1 - Math.abs(x - WR[0]) / (WR[2] + 6)) ** 0.6;
const bodySec = (x: number): Sec => ({
  w: pl(bodyHalfW, x),
  zb: -1.5 + Math.max(0, x - 62) * 0.55 + Math.max(0, -40 - x) * 1.0,
  zt: pl(bodyTop, x),
  n: 4.2,
  tumble: 0.16,
  tuck: 0.1 + 0.26 * Math.min(1, nearWheel(x)),
});

let shared: {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  carbon: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  grille: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  rimLip: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  nozzle: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
} | null = null;

function geos() {
  if (shared) return shared;
  const paint: THREE.BufferGeometry[] = [];
  const carbon: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];

  // the tub
  paint.push(loft(-50, 76, bodySec, { nu: 64, nv: 44, round: 8 }));
  // a raised centre on the hood, running back to the cowl
  paint.push(
    loft(
      30,
      66,
      (x) => ({ w: 12 - Math.max(0, x - 50) * 0.22, zb: pl(bodyTop, x) - 4, zt: pl(bodyTop, x) + 1.8 - Math.max(0, x - 54) * 0.1, n: 4 }),
      { nu: 20, nv: 20, round: 8 },
    ),
  );
  // slim arch lips over the wheels, flush with the fenders
  for (const sy of [-1, 1]) {
    paint.push(hoop(WF[0], wz(WF[2]), WF[2] + 3.2, 0.25, Math.PI - 0.15, sy * (pl(bodyHalfW, WF[0]) - 3.2), 3.6, 1.4));
    paint.push(hoop(WR[0], wz(WR[2]), WR[2] + 3.2, 0.15, Math.PI - 0.3, sy * (pl(bodyHalfW, WR[0]) - 3.2), 3.6, 1.4));
  }
  // the cabin: a tall greenhouse, a steep screen, the roof over the back axle's front
  const cabTop: [number, number][] = [
    [37, 22],
    [26, 33],
    [14, 42.5],
    [2, 46.5],
    [-16, 47],
    [-28, 43],
    [-40, 30],
  ];
  const cabW: [number, number][] = [
    [37, 28],
    [16, 29.5],
    [-22, 29.5],
    [-40, 26],
  ];
  const cabSec = (x: number): Sec => ({ w: pl(cabW, x), zb: pl(bodyTop, x) - 3, zt: pl(cabTop, x), n: 3.2, tumble: 0.3 });
  const glass = loft(-40, 37, cabSec, { nu: 40, nv: 40, round: 5 });
  // the painted roof and pillars: the cabin's top band, a hair proud of the glass
  paint.push(
    loft(
      -32,
      12,
      (x) => {
        const s = cabSec(x);
        return { ...s, w: s.w + 0.5, zt: s.zt + 0.6, zb: s.zb - 0.5 };
      },
      { nu: 28, nv: 20, round: 7, a0: Math.PI * 0.18, a1: Math.PI * 0.82 },
    ),
  );
  // a ducktail spoiler on the deck
  paint.push(loft(-52, -40, (x) => ({ w: 33 - Math.max(0, -48 - x) * 1.2, zb: 24, zt: 28.5 + (-40 - x) * 0.32, n: 3.6 }), { nu: 14, nv: 18, round: 3 }));
  // the spoiler's lip in the accent colour
  accent.push(loft(-53.5, -50.5, () => ({ w: 31, zb: 28.2, zt: 30.6, n: 3 }), { nu: 6, nv: 14, round: 1.4 }));
  // nose: a lower bumper and splitter; tail: a diffuser; under: a tray
  carbon.push(loft(58, 79, (x) => ({ w: 31 - Math.max(0, x - 72) * 1.0, zb: 1.5 + Math.max(0, x - 70) * 0.3, zt: 7.5, n: 4.5 }), { nu: 14, nv: 20, round: 4 }));
  carbon.push(loft(-53, -38, () => ({ w: 30, zb: 2, zt: 9.5, n: 4.5 }), { nu: 10, nv: 20, round: 3 }));
  carbon.push(new THREE.BoxGeometry(100, 52, 2).translate(10, 0, 3));
  // dark wheel wells over the tyres, so the fenders read as arches
  for (const [wx, wy, wr] of [WF, WR]) {
    for (const sy of [-1, 1]) {
      // (a part-cylinder about the axle, y; the arc over the top of the tyre)
      const well = new THREE.CylinderGeometry(wr + 2.4, wr + 2.4, 13, 24, 1, true, -Math.PI * 0.62, Math.PI * 1.24);
      well.translate(wx, sy * (wy - 2), wz(wr));
      carbon.push(well);
    }
  }
  // the grille: a dark mesh plane in the nose
  const grille = new THREE.PlaneGeometry(7, 32, 1, 1);
  grille.rotateY(Math.PI / 2);
  grille.translate(75.8, 0, 10.6);
  // lights: slanted headlamp slits, tail bars
  const head: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  for (const sy of [-1, 1]) {
    const h = new THREE.BoxGeometry(5, 10, 1.6);
    h.rotateY(-0.55);
    h.rotateZ(sy * 0.25);
    h.translate(72.2, sy * 19, 14.6);
    head.push(h);
    tail.push(new THREE.BoxGeometry(1.4, 13, 2.8).translate(-50.4, sy * 21, 20.5));
  }

  // tyre: a fat sidewall and rounded shoulders (axle along y, unit radius, width 1)
  const tp: THREE.Vector2[] = [new THREE.Vector2(0.62, -0.47)];
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI;
    tp.push(new THREE.Vector2(0.8 + 0.2 * Math.sin(a) ** 0.6, -0.5 + 0.5 * (1 - Math.cos(a))));
  }
  tp.push(new THREE.Vector2(0.62, 0.47));
  const tyre = new THREE.LatheGeometry(tp, 44);
  // the rim: a dish (outer face +y) with five split spokes and a centre cap
  const dish = new THREE.LatheGeometry(
    [new THREE.Vector2(0.001, 0.43), new THREE.Vector2(0.15, 0.43), new THREE.Vector2(0.19, 0.38), new THREE.Vector2(0.56, 0.2), new THREE.Vector2(0.6, 0.18), new THREE.Vector2(0.62, -0.3)],
    32,
  );
  const spokes: THREE.BufferGeometry[] = [dish];
  for (let k = 0; k < 5; k++) {
    for (const off of [-0.07, 0.07]) {
      const b = new THREE.BoxGeometry(0.07, 0.12, 0.44);
      b.rotateX(0.32);
      b.translate(off, 0.33, 0.37);
      b.rotateY((k / 5) * Math.PI * 2);
      spokes.push(b.toNonIndexed());
    }
  }
  const rim = mergeGeometries(spokes.map((g) => (g.index ? g.toNonIndexed() : g)));
  const rimLip = new THREE.TorusGeometry(0.64, 0.035, 8, 40);
  rimLip.rotateX(Math.PI / 2);
  rimLip.translate(0, 0.42, 0);
  const disc = mergeGeometries([new THREE.CylinderGeometry(0.5, 0.5, 0.06, 28).translate(0, 0.05, 0), new THREE.BoxGeometry(0.22, 0.22, 0.34).translate(0, 0.12, 0.42)].map((g) => g.toNonIndexed()));
  const nozzle = new THREE.CylinderGeometry(5.6, 4.2, 10, 24, 1, true);
  nozzle.rotateZ(Math.PI / 2);
  const flame = new THREE.ConeGeometry(1, 1, 18, 6, true);
  flame.rotateZ(Math.PI / 2);
  flame.translate(-0.5, 0, 0);
  const m = (a: THREE.BufferGeometry[]) => mergeGeometries(a);
  shared = {
    paint: m(paint),
    glass,
    carbon: m(carbon),
    accent: m(accent),
    grille,
    head: m(head),
    tail: m(tail),
    tyre,
    rim,
    rimLip,
    disc,
    nozzle,
    flame,
  };
  return shared;
}

/** knobbly tread for the bump map: offset blocks with a centre rib */
let treadTex: THREE.CanvasTexture | null = null;
function tread(): THREE.CanvasTexture {
  if (treadTex) return treadTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, 512, 64);
  x.fillStyle = '#fff';
  const n = 24;
  for (let i = 0; i < n; i++) {
    const u = (i / n) * 512;
    const w = 512 / n;
    x.fillRect(u + 2, i % 2 ? 2 : 6, w * 0.62, 16);
    x.fillRect(u + 2, i % 2 ? 46 : 42, w * 0.62, 16);
    x.beginPath();
    x.moveTo(u + 3, 24);
    x.lineTo(u + w * 0.45, 32);
    x.lineTo(u + 3, 40);
    x.lineTo(u + w * 0.3, 40);
    x.lineTo(u + w * 0.75, 32);
    x.lineTo(u + w * 0.3, 24);
    x.fill();
  }
  treadTex = new THREE.CanvasTexture(c);
  treadTex.wrapS = THREE.RepeatWrapping;
  treadTex.anisotropy = 4;
  return treadTex;
}

/** a fine hex mesh for the grille */
let meshTex: THREE.CanvasTexture | null = null;
function grilleTex(): THREE.CanvasTexture {
  if (meshTex) return meshTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#16181c';
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#020203';
  for (let r = 0; r < 8; r++)
    for (let q = 0; q < 34; q++) {
      const cx = q * 8 + (r % 2) * 4;
      const cy = r * 8 + 4;
      x.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        x.lineTo(cx + Math.cos(a) * 3.2, cy + Math.sin(a) * 3.2);
      }
      x.fill();
    }
  meshTex = new THREE.CanvasTexture(c);
  meshTex.colorSpace = THREE.SRGBColorSpace;
  return meshTex;
}

const WHEELS: P3[] = [
  [WF[0], WF[1], WF[2]],
  [WF[0], -WF[1], WF[2]],
  [WR[0], WR[1], WR[2]],
  [WR[0], -WR[1], WR[2]],
];

export class CarView {
  readonly group = new THREE.Group();
  private readonly paint: THREE.MeshPhysicalMaterial;
  private wheels: { pivot: THREE.Group; spin: THREE.Group; r: number; front: boolean; z0: number }[] = [];
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.ShaderMaterial;
  private coreMat: THREE.ShaderMaterial;
  private cores: THREE.Mesh[] = [];
  private nozzleGlow: THREE.MeshBasicMaterial;
  private spin = 0;
  private tag: THREE.Sprite | null = null;
  readonly team: number;
  boostVis = 0;
  /** a soft contact shadow on whatever surface the wheels are on */
  private contact: THREE.Mesh;

  constructor(team: number, accent: number, name?: string) {
    this.team = team;
    const g = geos();
    const teamC = new THREE.Color(TEAM_COLORS[team]);
    const accC = new THREE.Color(accent);
    // candy paint: a saturated base under a mirror clear coat
    this.paint = new THREE.MeshPhysicalMaterial({ color: teamC, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8 });
    const uAcc = { value: accC };
    const uTeam = { value: teamC.clone() };
    this.paint.onBeforeCompile = (sh) => {
      sh.uniforms.uAcc = uAcc;
      sh.uniforms.uTeam = uTeam;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nuniform vec3 uAcc;\nuniform vec3 uTeam;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 o = vObj;
          float ay = abs(o.y);
          // twin stripes over the hood, roof and deck
          float st = (1.0 - smoothstep(2.2, 2.7, abs(ay - 6.2))) * step(19.0, o.z);
          // a swoosh down each flank, rising toward the tail
          float sw = o.z - (13.5 - o.x * 0.085);
          float swW = mix(1.2, 3.6, smoothstep(70.0, -20.0, o.x));
          float sws = (1.0 - smoothstep(swW - 0.4, swW, abs(sw))) * step(27.0, ay) * step(o.x, 72.0) * step(-50.0, o.x);
          // a thin pinstripe under it
          float pin = (1.0 - smoothstep(0.25, 0.55, abs(sw + swW + 1.6))) * step(27.0, ay) * step(o.x, 66.0) * step(-48.0, o.x);
          // not on the hoops over the wheels
          float hf = abs(length(o.xz - vec2(51.25, -3.5)) - 16.7);
          float hr = abs(length(o.xz - vec2(-33.75, -1.0)) - 19.2);
          float onHoop = step(31.0, ay) * step(min(hf, hr), 4.0);
          float dec = max(st, max(sws, pin) * (1.0 - onHoop));
          diffuseColor.rgb = mix(diffuseColor.rgb, uAcc, dec);
          // panel seams: the cowl, the doors
          float seam = (1.0 - smoothstep(0.12, 0.3, abs(o.x - 30.5))) * step(20.0, o.z) * step(ay, 24.0);
          seam = max(seam, (1.0 - smoothstep(0.12, 0.3, abs(o.x + 15.5))) * step(29.0, ay) * step(6.0, o.z));
          diffuseColor.rgb *= 1.0 - seam * 0.7;
          // dark rockers along the bottom
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025), smoothstep(6.5, 5.0, o.z) * step(ay, 37.5));`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // metallic flake under the clear coat: a fine glitter in the base layer's highlights
          {
            vec3 fc = floor(vObj * 7.0);
            vec3 fr = fract(sin(vec3(dot(fc, vec3(12.9898, 78.233, 37.719)), dot(fc, vec3(39.346, 11.135, 83.155)), dot(fc, vec3(73.156, 52.235, 9.151)))) * 43758.5453) - 0.5;
            // (fading out once a flake is under a pixel, so it never turns to noise)
            normal = normalize(normal + fr * 0.07 * (1.0 - smoothstep(0.05, 0.14, length(fwidth(vObj)))));
          }`,
        );
    };
    this.paint.customProgramCacheKey = () => 'bbcarpaint';
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x121317, roughness: 0.42, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x04070c, roughness: 0.03, metalness: 0.8, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0 });
    const accentM = new THREE.MeshPhysicalMaterial({ color: accC, metalness: 0.5, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05 });
    const grilleM = new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: 0.6, metalness: 0.3 });
    grilleM.map!.repeat.set(1, 1);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.86, metalness: 0, bumpMap: tread(), bumpScale: 3 });
    const rimM = new THREE.MeshPhysicalMaterial({ color: accC.clone().lerp(new THREE.Color(0xd8dce4), 0.35), roughness: 0.22, metalness: 0.75, clearcoat: 0.8, envMapIntensity: 1.7 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.12, metalness: 1, envMapIntensity: 2 });
    const discM = new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.45, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.5 });
    // the exhaust pipes: brushed metal, seen inside too
    const nozzleM = new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide });

    const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    add(g.paint, this.paint);
    add(g.glass, glass);
    add(g.carbon, carbon);
    add(g.accent, accentM);
    add(g.grille, grilleM, false);
    add(g.head, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5.6) }), false);
    add(g.tail, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.22) }), false);
    // boost nozzles and flames
    this.nozzleGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.02, 0.015) });
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(team === 0 ? 0x4f9dff : 0xff8a2a) }, uK: { value: 0 }, uHot: { value: 0 } },
      vertexShader: `varying vec3 vP; varying vec2 vU; void main(){ vP = position; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uK; uniform float uHot; varying vec3 vP; varying vec2 vU;
        void main(){ float t = clamp(-vP.x, 0.0, 1.0);
          // flickering shock bands running down the jet
          float n = 0.5 + 0.5*sin(vU.x*40.0 + uT*60.0) * sin(t*20.0 - uT*80.0);
          float bands = 0.75 + 0.25*sin(t*34.0 - uT*95.0);
          float core = (1.0 - t) * (1.0 - t);
          vec3 c = mix(uC * 1.7, vec3(1.8, 1.55, 1.1), mix(core * 0.85, 0.85, uHot));
          float a = pow(1.0 - t, mix(1.1, 1.8, uHot)) * (0.55 + 0.45*n) * bands * uK;
          gl_FragColor = vec4(c * a * mix(2.4, 3.4, uHot), a); }`,
    });
    // a short white-hot core inside each jet
    this.coreMat = this.flameMat.clone();
    this.coreMat.uniforms.uHot.value = 1;
    for (const sy of [-1, 1]) {
      const nz = add(g.nozzle, nozzleM, false);
      nz.position.set(-55, sy * 12, 12.5);
      // the glow sits deep in the pipe: a dark bore at rest, white-hot when boosting
      add(new THREE.CircleGeometry(4.2, 18).rotateY(-Math.PI / 2).translate(-52.5, sy * 12, 12.5), this.nozzleGlow, false);
      const fl = new THREE.Mesh(g.flame, this.flameMat);
      fl.position.set(-60, sy * 12, 12.5);
      fl.scale.set(60, 5.4, 5.4);
      fl.renderOrder = 9;
      fl.frustumCulled = false;
      this.group.add(fl);
      this.flames.push(fl);
      const core = new THREE.Mesh(g.flame, this.coreMat);
      core.position.set(-58, sy * 12, 12.5);
      core.renderOrder = 10;
      core.frustumCulled = false;
      this.group.add(core);
      this.cores.push(core);
    }
    {
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uA: { value: 0.7 } },
        vertexShader: `varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uA; varying vec2 vU; void main(){ float d = length(vU * vec2(1.0, 1.0)); float k = pow(1.0 - smoothstep(0.25, 1.0, d), 1.6); gl_FragColor = vec4(0.0, 0.0, 0.0, k * uA); }`,
      });
      m.polygonOffset = true;
      m.polygonOffsetFactor = -3;
      this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      this.contact.scale.set(150, 104, 1);
      this.contact.position.set(8, 0, -16.4);
      this.contact.renderOrder = 2;
      this.group.add(this.contact);
    }
    // an antenna off the rear deck, leaning back, with a little team-coloured topper
    {
      const d = new THREE.Vector3(-Math.sin(0.3), 0, Math.cos(0.3));
      const base = new THREE.Vector3(-45, 25, 27.5);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 30, 6), dark);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      rod.position.copy(base).addScaledVector(d, 15);
      this.group.add(rod);
      const top = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 10), accentM);
      top.position.copy(base).addScaledVector(d, 30);
      top.castShadow = true;
      this.group.add(top);
    }
    // wheels: the right-hand ones mirrored so every rim's face looks out
    for (const [wx, wy, wr] of WHEELS) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const z0 = wz(wr);
      pivot.position.set(wx, wy, z0);
      const w = wr < 15 ? 12 : 14.5;
      const side = Math.sign(wy);
      const t = new THREE.Mesh(g.tyre, rubber);
      t.scale.set(wr, w, wr);
      t.castShadow = true;
      const rm = new THREE.Mesh(g.rim, rimM);
      rm.scale.set(wr, w * side, wr);
      const lip = new THREE.Mesh(g.rimLip, chrome);
      lip.scale.set(wr, w * side, wr);
      spin.add(t, rm, lip);
      const dc = new THREE.Mesh(g.disc, discM);
      dc.scale.set(wr, w * side, wr);
      pivot.add(spin, dc);
      this.group.add(pivot);
      this.wheels.push({ pivot, spin, r: wr, front: wx > 0, z0 });
    }
    if (name) this.setName(name);
  }

  setName(name: string): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const x = c.getContext('2d')!;
    x.font = 'italic 900 56px "Titillium Web", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 10;
    x.strokeStyle = 'rgba(0,0,0,0.75)';
    x.strokeText(name.toUpperCase(), 256, 50);
    x.fillStyle = this.team === 0 ? '#7fb6ff' : '#ffb27a';
    x.fillText(name.toUpperCase(), 256, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
    sp.scale.set(160, 30, 1);
    sp.position.set(0, 0, 110);
    sp.renderOrder = 20;
    this.tag = sp;
    this.group.add(sp);
  }

  showTag(v: boolean): void {
    if (this.tag) this.tag.visible = v;
  }

  setAccent(c: number): void {
    void c;
  }

  /** pose from the simulated car (positions already smoothed by the caller) */
  update(car: Car, pos: THREE.Vector3, quat: THREE.Quaternion, dt: number, t: number): void {
    this.group.visible = car.alive;
    if (!car.alive) return;
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    const vf = car.vel.dot(car.rot.f);
    this.spin += (vf / 14) * dt;
    const steer = car.input.steer * (0.42 - Math.min(0.3, Math.abs(vf) / 6000));
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.spin.rotation.y = this.spin * (14 / w.r);
      if (w.front) w.pivot.rotation.z = -steer * (car.onGround ? 1 : 0.6);
      const comp = car.wheelComp[i];
      const target = w.z0 + (car.wheelContact[i] ? Math.min(6, comp) - 1.5 : -3.5);
      w.pivot.position.z += (target - w.pivot.position.z) * Math.min(1, dt * 25);
    }
    // the contact shadow fades as the wheels leave the surface
    const down = car.wheelContact.filter(Boolean).length;
    const sm = this.contact.material as THREE.ShaderMaterial;
    sm.uniforms.uA.value += ((down >= 2 ? 0.72 : 0) - sm.uniforms.uA.value) * Math.min(1, dt * 14);
    this.contact.visible = sm.uniforms.uA.value > 0.01;
    const k = car.boosting ? 1 : 0;
    this.boostVis += (k - this.boostVis) * Math.min(1, dt * (k ? 30 : 12));
    this.flameMat.uniforms.uT.value = t;
    this.flameMat.uniforms.uK.value = this.boostVis;
    this.coreMat.uniforms.uT.value = t;
    this.coreMat.uniforms.uK.value = this.boostVis;
    for (const f of this.cores) {
      f.visible = this.boostVis > 0.02;
      f.scale.set(22 + 12 * this.boostVis + Math.sin(t * 90 + f.position.y) * 3, 3.2, 3.2);
    }
    for (const f of this.flames) {
      f.visible = this.boostVis > 0.02;
      const L = 50 + 50 * this.boostVis + Math.sin(t * 70 + f.position.y) * 8;
      f.scale.set(L, 5.2 + 1.6 * this.boostVis, 5.2 + 1.6 * this.boostVis);
    }
    this.nozzleGlow.color.setRGB(0.035 + this.boostVis * 6, 0.02 + this.boostVis * 2.9, 0.015 + this.boostVis * 1.3);
  }
}
