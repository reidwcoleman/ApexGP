import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Car } from '../sim/car.ts';

/**
 * A battle car built from code, in the simulation's car frame (cm; x forward, y left, z up, the
 * ground at z = −17). The proportions of the arena game's cars: big exposed wheels on long travel, a
 * high-riding tub, flared hoops over the tyres, a low bubble canopy set back, a wing on struts and
 * twin boost nozzles. Every panel is a lofted superellipse so the paint carries smooth reflections;
 * candy team paint under a clear coat with the player's accent in the stripes, swoosh, wing and rims.
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
      const w = s.w * (1 - (s.tumble ?? 0) * Math.max(0, zs));
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
const WF: P3 = [51.25, 34.5, 13]; // front wheel: x, |y|, radius (drawn)
const WR: P3 = [-33.75, 35.5, 15.5];
const wz = (r: number) => r - 17;

const bodyTop: [number, number][] = [
  [79, 11],
  [72, 15.5],
  [62, 19],
  [46, 21.5],
  [30, 23.5],
  [0, 26],
  [-30, 27.4],
  [-46, 27.6],
  [-52, 24],
];
const bodyHalfW: [number, number][] = [
  [79, 21],
  [71, 27.5],
  [60, 29],
  [40, 29.5],
  [30, 34],
  [12, 36.5],
  [-8, 36.5],
  [-16, 31],
  [-40, 31.5],
  [-52, 29],
];

const bodySec = (x: number): Sec => ({
  w: pl(bodyHalfW, x),
  zb: 3 + Math.max(0, x - 62) * 0.38 + Math.max(0, -44 - x) * 0.7,
  zt: pl(bodyTop, x),
  n: 3.4,
  tumble: 0.2,
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

  // the tub: blunt nose, a hood climbing to the cowl, side pods between the wheels, a flat deck
  paint.push(loft(-52, 79, bodySec, { nu: 56, nv: 40, round: 7 }));
  // a bulge down the middle of the hood
  paint.push(
    loft(
      28,
      68,
      (x) => ({ w: 10 - Math.max(0, x - 50) * 0.18, zb: pl(bodyTop, x) - 4, zt: pl(bodyTop, x) + 2.2 - Math.max(0, x - 52) * 0.08, n: 3 }),
      { nu: 20, nv: 20, round: 8 },
    ),
  );
  // the hoops over the tyres
  for (const sy of [-1, 1]) {
    paint.push(hoop(WF[0], wz(WF[2]), WF[2] + 5, 0.12, Math.PI - 0.02, sy * (WF[1] + 0.5), 8.2, 2.6));
    paint.push(hoop(WR[0], wz(WR[2]), WR[2] + 5, 0.02, Math.PI - 0.1, sy * (WR[1] + 0.5), 8.8, 2.8));
  }
  // the canopy: a low bubble set back over the rear axle
  const cabTop: [number, number][] = [
    [31, 23],
    [16, 35.5],
    [2, 42],
    [-14, 43.2],
    [-28, 39.5],
    [-38, 29],
  ];
  const cabW: [number, number][] = [
    [31, 24],
    [12, 26.5],
    [-20, 26.5],
    [-38, 23],
  ];
  const cabSec = (x: number): Sec => ({ w: pl(cabW, x), zb: pl(bodyTop, x) - 3, zt: pl(cabTop, x), n: 2.7, tumble: 0.34 });
  const glass = loft(-38, 31, cabSec, { nu: 36, nv: 36, round: 5 });
  // the painted roof: the canopy's top, a hair proud of the glass
  paint.push(
    loft(
      -30,
      10,
      (x) => {
        const s = cabSec(x);
        return { ...s, w: s.w + 0.5, zt: s.zt + 0.6, zb: s.zb - 0.5 };
      },
      { nu: 24, nv: 18, round: 6, a0: Math.PI * 0.2, a1: Math.PI * 0.8 },
    ),
  );
  // the wing: an airfoil plate on two struts, with end plates
  const wing = loft(-37, 37, () => ({ w: 8.5, zb: -1.1, zt: 1.1, n: 2.2 }), { nu: 16, nv: 16, round: 3 });
  wing.rotateZ(Math.PI / 2);
  wing.rotateY(0.1);
  wing.translate(-49, 0, 45);
  accent.push(wing);
  for (const sy of [-1, 1]) {
    accent.push(new THREE.BoxGeometry(17, 1.2, 7).translate(-49, sy * 37.4, 44));
    const strut = new THREE.BoxGeometry(5, 2.2, 18);
    strut.rotateY(-0.35);
    strut.translate(-45.5, sy * 15, 36);
    carbon.push(strut);
  }
  // nose: splitter, bumper, a grille surround; tail: diffuser; under: a tray and the arms
  carbon.push(loft(60, 82, (x) => ({ w: 30 - Math.max(0, x - 74) * 0.9, zb: 1.5 + Math.max(0, x - 70) * 0.25, zt: 8.5, n: 4 }), { nu: 14, nv: 20, round: 4 }));
  carbon.push(new THREE.BoxGeometry(18, 60, 1.6).translate(73, 0, 1.2));
  carbon.push(loft(-55, -38, () => ({ w: 28, zb: 2, zt: 10, n: 4 }), { nu: 10, nv: 20, round: 3 }));
  carbon.push(new THREE.BoxGeometry(110, 52, 2).translate(10, 0, 3));
  for (const [wx, wy, wr] of [WF, WR]) {
    for (const sy of [-1, 1]) {
      for (const dz of [-3, 3]) {
        const arm = new THREE.BoxGeometry(5, wy - 18, 1.6);
        arm.translate(wx + dz * 0.6, sy * (18 + (wy - 18) / 2), wz(wr) + dz);
        carbon.push(arm);
      }
    }
  }
  // side intakes behind the front wheels
  for (const sy of [-1, 1]) carbon.push(new THREE.BoxGeometry(9, 2, 5).translate(31, sy * 34.2, 11));
  // the grille: a dark mesh plane in the nose
  const grille = new THREE.PlaneGeometry(7, 30, 1, 1);
  grille.rotateY(Math.PI / 2);
  grille.translate(78.3, 0, 11.4);
  // lights: slanted headlamp slits, tail bars
  const head: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  for (const sy of [-1, 1]) {
    const h = new THREE.BoxGeometry(5, 10, 1.6);
    h.rotateY(-0.55);
    h.rotateZ(sy * 0.25);
    h.translate(74.5, sy * 18, 14.2);
    head.push(h);
    tail.push(new THREE.BoxGeometry(1.4, 12, 2.6).translate(-52.4, sy * 20, 20.5));
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
          float hf = abs(length(o.xz - vec2(51.25, -4.0)) - 18.0);
          float hr = abs(length(o.xz - vec2(-33.75, -1.5)) - 20.5);
          float onHoop = step(33.0, ay) * step(min(hf, hr), 5.0);
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
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(team === 0 ? 0x5fb0ff : 0xffa040) }, uK: { value: 0 } },
      vertexShader: `varying vec3 vP; varying vec2 vU; void main(){ vP = position; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uK; varying vec3 vP; varying vec2 vU;
        void main(){ float t = clamp(-vP.x, 0.0, 1.0);
          float n = 0.5 + 0.5*sin(vU.x*40.0 + uT*60.0) * sin(t*20.0 - uT*80.0);
          float core = (1.0 - t) * (1.0 - t);
          vec3 c = mix(uC * 1.6, vec3(1.6, 1.5, 1.2), core * 0.8);
          float a = (1.0 - t) * (0.6 + 0.4*n) * uK;
          gl_FragColor = vec4(c * a * 2.2, a); }`,
    });
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
      const base = new THREE.Vector3(-43, 13, 26.5);
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
    for (const f of this.flames) {
      f.visible = this.boostVis > 0.02;
      const L = 44 + 34 * this.boostVis + Math.sin(t * 70 + f.position.y) * 6;
      f.scale.set(L, 5 + this.boostVis, 5 + this.boostVis);
    }
    this.nozzleGlow.color.setRGB(0.035 + this.boostVis * 6, 0.02 + this.boostVis * 2.9, 0.015 + this.boostVis * 1.3);
  }
}
