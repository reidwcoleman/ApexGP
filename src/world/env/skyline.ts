import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import type { Venue, WorldMap } from './worldmap.ts';
import { rng } from './noise.ts';

/**
 * The things that stand up out of the countryside between the circuit and the horizon and
 * make each venue's backdrop its own: wind farms turning on the ridges (Spa, Silverstone,
 * the Hungarian plain) or out at sea (Zandvoort), lattice pylons marching across the fields
 * with their wires sagging between them, the nodding donkeys of the Awali oil field beside
 * Sakhir, and the industry a venue's skyline is known for — the stacks of the Yokkaichi
 * refineries across the bay from Suzuka, the IJmuiden steelworks up the coast from Zandvoort,
 * the Alba smelter and the Riffa power station north of Sakhir, Umm al Nar's chimneys across
 * the water from Yas.
 *
 * All instanced: one static mesh per kind + the moving parts (rotors, walking beams) updated
 * each frame. Beyond the circuit (≥ 700 m), no shadows; the scene fog hazes them like the
 * horizon.
 */

export interface SkylineBuild {
  group: THREE.Group;
  update(elapsed: number): void;
  count: number;
}

interface WindFarm {
  /** compass bearing (deg, 0 = north = −Z, 90 = east = +X) and distance of the farm's centre (m) */
  bearing: number;
  dist: number;
  n: number;
  /** spread across (deg of bearing) and in depth (m) */
  across: number;
  depth: number;
  hub: number;
  /** the rotors face this way (deg; into the prevailing wind) */
  face: number;
  /** out at sea: stand on the water at this height */
  seaY?: number;
}
interface PylonLine {
  /** the line's direction (deg) and its perpendicular offset from the circuit centre (m; + = right of the direction) */
  dir: number;
  offset: number;
  height: number;
  span: number;
}
/** an industrial site: banded chimneys, a few storage tanks and sheds round a bearing */
interface Industry {
  bearing: number;
  dist: number;
  /** half-spread across (m) and in depth (m) */
  across: number;
  depth: number;
  stacks: number;
  /** chimney height (m) and radius at the foot (m) */
  stackH: number;
  stackR: number;
  tanks: number;
  sheds: number;
  /** a pair of blast furnaces / boiler houses: tall dark blocks */
  furnaces?: number;
}
interface VenueSkyline {
  farms?: WindFarm[];
  industry?: Industry[];
  pylons?: PylonLine[];
  /** oil field: pumpjacks scattered over an arc */
  jacks?: { from: number; to: number; d0: number; d1: number; n: number };
}

const SKYLINES: Partial<Record<Venue, VenueSkyline>> = {
  park: { pylons: [{ dir: 70, offset: -2600, height: 42, span: 360 }, { dir: 150, offset: 2900, height: 36, span: 330 }] },
  ardennes: {
    farms: [{ bearing: 75, dist: 2700, n: 7, across: 18, depth: 700, hub: 118, face: 245 }],
    pylons: [{ dir: 20, offset: 2700, height: 40, span: 360 }],
  },
  airfield: {
    farms: [{ bearing: 205, dist: 2500, n: 7, across: 22, depth: 600, hub: 115, face: 235 }],
    pylons: [{ dir: 110, offset: -2300, height: 46, span: 370 }, { dir: 30, offset: 2800, height: 40, span: 350 }],
  },
  spielberg: { pylons: [{ dir: 80, offset: 1600, height: 40, span: 340 }] },
  austin: { pylons: [{ dir: 5, offset: 2300, height: 38, span: 340 }, { dir: 95, offset: -2500, height: 34, span: 320 }] },
  hungaroring: {
    farms: [{ bearing: 120, dist: 2900, n: 7, across: 18, depth: 700, hub: 120, face: 300 }],
    pylons: [{ dir: 40, offset: -2400, height: 42, span: 360 }],
  },
  zandvoort: {
    farms: [{ bearing: 282, dist: 6500, n: 24, across: 22, depth: 2000, hub: 140, face: 250, seaY: -4 }],
    industry: [{ bearing: 17, dist: 10200, across: 650, depth: 450, stacks: 6, stackH: 140, stackR: 6.5, tanks: 4, sheds: 7, furnaces: 3 }],
  },
  suzuka: {
    pylons: [{ dir: 160, offset: -2100, height: 50, span: 380 }, { dir: 60, offset: 2600, height: 44, span: 360 }],
    industry: [{ bearing: 42, dist: 10800, across: 1200, depth: 600, stacks: 9, stackH: 160, stackR: 5.5, tanks: 14, sheds: 6 }],
  },
  sakhir: {
    pylons: [{ dir: 15, offset: 2200, height: 40, span: 350 }, { dir: 115, offset: -2600, height: 40, span: 350 }],
    jacks: { from: 20, to: 110, d0: 1300, d1: 3600, n: 36 },
    industry: [
      { bearing: 32, dist: 9500, across: 600, depth: 400, stacks: 4, stackH: 120, stackR: 5.5, tanks: 3, sheds: 8 },
      { bearing: 58, dist: 10500, across: 500, depth: 300, stacks: 3, stackH: 95, stackR: 5, tanks: 6, sheds: 3 },
    ],
  },
  yasmarina: {
    pylons: [{ dir: 140, offset: -2800, height: 44, span: 360 }],
    industry: [{ bearing: 178, dist: 10000, across: 450, depth: 300, stacks: 5, stackH: 110, stackR: 5, tanks: 4, sheds: 3 }],
  },
};

const WHITE = srgb(0xe7e9ea);
const WHITE_SHADE = srgb(0xcfd3d6);
const STEEL = srgb(0x8d9196);
const JACK = srgb(0x2c3036);
const JACK_HEAD = srgb(0xb8412c);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** a square beam from a to b */
function beam(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, c: THREE.Color) {
  _z.subVectors(b, a);
  const L = _z.length();
  if (L < 1e-4) return;
  _z.multiplyScalar(1 / L);
  _x.set(0, 1, 0).cross(_z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x.multiplyScalar(w), _y.multiplyScalar(w), _z.multiplyScalar(L));
  _m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mb.box(_m, c);
}
const bearingDir = (deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
};

// ---------------------------------------------------------------- geometry (unit: metres, hub height H = 1 for turbines)

/** tower + nacelle, hub at (0, 1, 0), rotor facing +Z; scaled by the hub height */
function turbineBody(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  mb.tube([[0, 0, 0, 0.034], [0, 0.5, 0, 0.027], [0, 0.985, 0, 0.019]], 10, WHITE);
  // nacelle (a rounded-ish box) and the spinner
  _m.makeScale(0.04, 0.038, 0.11).setPosition(0, 1.0, -0.02);
  mb.box(_m, WHITE_SHADE);
  mb.tube([[0, 1.0, 0.035, 0.022], [0, 1.0, 0.06, 0.018], [0, 1.0, 0.078, 0.004]], 8, WHITE);
  return mb.geometry(false);
}
/** three blades about the origin in the XY plane (rotor axis +Z); blade length ≈ 0.48 H */
function turbineRotor(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const L = new THREE.Matrix4().makeRotationZ(a);
    // a tapered, slightly twisted blade from a few flat segments
    const seg = 5;
    for (let i = 0; i < seg; i++) {
      const r0 = 0.02 + (i / seg) * 0.46, r1 = 0.02 + ((i + 1) / seg) * 0.46;
      const w = 0.03 * (1 - (i / seg) * 0.75) + 0.006;
      const m = new THREE.Matrix4().makeRotationY(0.25 - i * 0.05);
      m.premultiply(new THREE.Matrix4().makeTranslation(0, (r0 + r1) / 2, 0));
      m.multiply(new THREE.Matrix4().makeScale(w, r1 - r0 + 0.002, 0.006));
      mb.box(m.premultiply(L), i === seg - 1 ? srgb(0xd9dcdf) : WHITE);
    }
  }
  return mb.geometry(false);
}

/** a lattice transmission tower, height 1 (scaled per line), cross-arms along ±X; wire attach points returned */
function pylonGeometry(): { geo: THREE.BufferGeometry; attach: [number, number][] } {
  const mb = new MeshBuilder();
  const w = 0.009;
  const leg = (t: number, sx: number, sz: number) => {
    // taper: 0.2 wide at the foot, 0.05 at the waist (0.62), 0.035 at the top
    const hw = t < 0.62 ? 0.1 - (t / 0.62) * 0.075 : 0.025 - ((t - 0.62) / 0.38) * 0.008;
    return new THREE.Vector3(sx * hw, t, sz * hw);
  };
  const levels = [0, 0.12, 0.24, 0.36, 0.48, 0.62, 0.74, 0.87, 1];
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < levels.length - 1; i++) {
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = corners[c];
      const [nx, nz] = corners[(c + 1) % 4];
      beam(mb, leg(levels[i], sx, sz), leg(levels[i + 1], sx, sz), w * 1.3, STEEL);
      // X bracing on each face
      beam(mb, leg(levels[i], sx, sz), leg(levels[i + 1], nx, nz), w * 0.7, STEEL);
      beam(mb, leg(levels[i], nx, nz), leg(levels[i + 1], sx, sz), w * 0.7, STEEL);
      beam(mb, leg(levels[i + 1], sx, sz), leg(levels[i + 1], nx, nz), w * 0.8, STEEL);
    }
  }
  // cross-arms: two levels (the lower wider), triangulated
  const attach: [number, number][] = [];
  for (const [y, half] of [[0.74, 0.2], [0.87, 0.15]] as [number, number][]) {
    for (const s of [-1, 1]) {
      const root = leg(y, s, 0);
      const tip = new THREE.Vector3(s * half, y, 0);
      beam(mb, root.clone().setZ(-0.02), tip, w, STEEL);
      beam(mb, root.clone().setZ(0.02), tip, w, STEEL);
      beam(mb, leg(y + 0.06, s, 0), tip, w * 0.8, STEEL);
      attach.push([s * half, y - 0.035]);
    }
  }
  // earth-wire peak
  beam(mb, leg(1, -1, 0), new THREE.Vector3(0, 1.05, 0), w, STEEL);
  beam(mb, leg(1, 1, 0), new THREE.Vector3(0, 1.05, 0), w, STEEL);
  attach.push([0, 1.05]);
  return { geo: mb.geometry(false), attach };
}

/** pumpjack: base, samson post, horse head — the walking beam (+ head) is separate, pivot at (0, 4.2, 0) */
function jackBase(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  _m.makeScale(1.6, 0.5, 8).setPosition(0, 0.25, 0);
  mb.box(_m, JACK);
  // samson post (A-frame)
  for (const s of [-1, 1]) {
    beam(mb, new THREE.Vector3(s * 0.7, 0.4, 1.4), new THREE.Vector3(0, 4.2, 0), 0.22, JACK);
    beam(mb, new THREE.Vector3(s * 0.7, 0.4, -1.4), new THREE.Vector3(0, 4.2, 0), 0.22, JACK);
  }
  // gearbox + crank at the back
  _m.makeScale(1.2, 1.2, 1.4).setPosition(0, 1.1, -3.1);
  mb.box(_m, JACK);
  // wellhead
  mb.tube([[0, 0.3, 3.4, 0.14], [0, 1.4, 3.4, 0.1]], 6, STEEL);
  return mb.geometry(false);
}
function jackBeam(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  _m.makeScale(0.35, 0.45, 6.6).setPosition(0, 0, -0.4);
  mb.box(_m, JACK);
  // horse head over the well
  _m.makeScale(0.4, 1.9, 0.5).setPosition(0, -0.6, 3.05);
  mb.box(_m, JACK_HEAD);
  // counterweight arm at the back
  _m.makeScale(0.9, 0.9, 0.9).setPosition(0, -0.5, -3.3);
  mb.box(_m, JACK);
  return mb.geometry(false);
}

/** a chimney of height 1 and foot radius 1 (scaled per stack): tapering, red-and-white bands at the top */
function stackGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const RED = srgb(0xa8402e), CON = srgb(0x9c9a94), WH = srgb(0xd9d8d3);
  const path: number[][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    path.push([0, t, 0, 1 - 0.38 * t]);
  }
  mb.tube(path, 10, (t) => (t < 0.7 ? CON : Math.floor((t - 0.7) / 0.075) % 2 === 0 ? RED : WH), () => 0, true);
  return mb.geometry(false);
}
/** a storage tank (height 1, radius 1) and a shed (unit box), pale and weathered */
function tankGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  mb.tube([[0, 0, 0, 1], [0, 1, 0, 1], [0, 1.08, 0, 0.6]], 16, srgb(0xc9c7c0), () => 0, true);
  return mb.geometry(false);
}
function shedGeometry(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  _m.makeScale(1, 1, 1).setPosition(0, 0.5, 0);
  mb.box(_m, srgb(0x8f948f));
  // a lighter roof strip (cladding seen from afar)
  _m.makeScale(1.02, 0.08, 1.02).setPosition(0, 1.0, 0);
  mb.box(_m, srgb(0xa9aba6));
  return mb.geometry(false);
}

// ---------------------------------------------------------------- build

export function buildSkyline(map: WorldMap): SkylineBuild | null {
  const cfg = SKYLINES[map.venue];
  if (!cfg) return null;
  const group = new THREE.Group();
  group.name = 'Skyline';
  const r = rng(5150);
  const c = map.A.center;
  const clearOfCircuit = (x: number, z: number, m: number) => map.distToTrack(x, z) > m && !map.inPitZone(x, z, m);
  const updates: ((t: number) => void)[] = [];
  let count = 0;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });

  // ---- wind farms
  const farms = cfg.farms ?? [];
  const spots: { x: number; y: number; z: number; H: number; face: number; phase: number; speed: number }[] = [];
  for (const F of farms) {
    let tries = 0;
    let placed = 0;
    while (placed < F.n && tries++ < F.n * 40) {
      const b = F.bearing + (r() - 0.5) * 2 * F.across;
      const d = F.dist + (r() - 0.5) * F.depth;
      const [dx, dz] = bearingDir(b);
      const x = c.x + dx * d, z = c.z + dz * d;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < F.hub * 3.2)) continue;
      if (!clearOfCircuit(x, z, 900)) continue;
      const y = F.seaY ?? map.height(x, z);
      const H = F.hub * (0.92 + r() * 0.16);
      spots.push({ x, y, z, H, face: ((F.face + (r() - 0.5) * 8) * Math.PI) / 180, phase: r() * 6.28, speed: (0.9 + r() * 0.35) * (13 / H) * 1.9 });
      placed++;
    }
  }
  if (spots.length) {
    const body = new THREE.InstancedMesh(turbineBody(), mat, spots.length);
    const rotor = new THREE.InstancedMesh(turbineRotor(), mat, spots.length);
    // aviation warning lights on the nacelles (blink red at dusk and night; barely there by day)
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2a14, toneMapped: false, transparent: true, opacity: 0 });
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 6, 4), lightMat, spots.length);
    body.name = 'skyline_turbines';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    spots.forEach((t, i) => {
      q.setFromEuler(e.set(0, t.face, 0));
      m.compose(p.set(t.x, t.y, t.z), q, s.setScalar(t.H));
      body.setMatrixAt(i, m);
      m.compose(p.set(t.x, t.y + t.H * 1.025, t.z), q, s.setScalar(t.H));
      lights.setMatrixAt(i, m);
    });
    body.frustumCulled = rotor.frustumCulled = lights.frustumCulled = false;
    group.add(body, rotor, lights);
    const hubOff = new THREE.Vector3();
    const rq = new THREE.Quaternion(), fq = new THREE.Quaternion();
    updates.push((time) => {
      spots.forEach((t, i) => {
        fq.setFromEuler(e.set(0, t.face, 0));
        rq.setFromAxisAngle(_z.set(0, 0, 1), t.phase + time * t.speed);
        hubOff.set(0, 1.0, 0.07).multiplyScalar(t.H).applyQuaternion(fq);
        m.compose(p.set(t.x + hubOff.x, t.y + hubOff.y, t.z + hubOff.z), fq.multiply(rq), s.setScalar(t.H));
        rotor.setMatrixAt(i, m);
      });
      rotor.instanceMatrix.needsUpdate = true;
      // synchronised 1 Hz blink (as the real ones are)
      lightMat.opacity = (time % 1.5) < 0.6 ? 0.9 : 0;
    });
    count += spots.length;
  }

  // ---- pylon lines
  const pyl = pylonGeometry();
  const towers: THREE.Matrix4[] = [];
  const wirePts: number[] = [];
  for (const L of cfg.pylons ?? []) {
    const [dx, dz] = bearingDir(L.dir);
    // perpendicular (right of the direction)
    const px = -dz, pz = dx;
    const ox = c.x + px * L.offset, oz = c.z + pz * L.offset;
    const R = 5200;
    const line: { x: number; y: number; z: number; yaw: number }[] = [];
    for (let u = -R; u <= R; u += L.span * (0.92 + r() * 0.16)) {
      // a gentle wander so the line isn't ruler-straight
      const wob = Math.sin(u / 1700 + L.offset) * 60;
      const x = ox + dx * u + px * wob, z = oz + dz * u + pz * wob;
      if (!clearOfCircuit(x, z, 650)) {
        line.push({ x: NaN, y: 0, z: 0, yaw: 0 });
        continue;
      }
      if (map.venue === 'zandvoort' || map.height(x, z) < -1) continue;
      line.push({ x, y: map.height(x, z), z, yaw: Math.atan2(dx, dz) });
    }
    for (let i = 0; i < line.length; i++) {
      const T = line[i];
      if (Number.isNaN(T.x)) continue;
      const m = new THREE.Matrix4().makeRotationY(T.yaw + Math.PI / 2);
      m.scale(new THREE.Vector3(L.height, L.height, L.height));
      m.setPosition(T.x, T.y, T.z);
      towers.push(m);
      const N = line[i + 1];
      if (!N || Number.isNaN(N.x)) continue;
      // wires: a catenary-ish sag between the attach points of neighbouring towers
      for (const [ax, ay] of pyl.attach) {
        const a = _a.set(ax, ay, 0).applyMatrix4(m);
        const mN = new THREE.Matrix4().makeRotationY(N.yaw + Math.PI / 2).scale(new THREE.Vector3(L.height, L.height, L.height)).setPosition(N.x, N.y, N.z);
        const b = _b.set(ax, ay, 0).applyMatrix4(mN);
        const span = a.distanceTo(b);
        const sag = span * 0.035;
        const SEG = 10;
        for (let k = 0; k < SEG; k++) {
          const t0 = k / SEG, t1 = (k + 1) / SEG;
          const y0 = a.y + (b.y - a.y) * t0 - sag * 4 * t0 * (1 - t0);
          const y1 = a.y + (b.y - a.y) * t1 - sag * 4 * t1 * (1 - t1);
          wirePts.push(a.x + (b.x - a.x) * t0, y0, a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, y1, a.z + (b.z - a.z) * t1);
        }
      }
    }
  }
  if (towers.length) {
    const im = new THREE.InstancedMesh(pyl.geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }), towers.length);
    im.name = 'skyline_pylons';
    towers.forEach((m, i) => im.setMatrixAt(i, m));
    im.frustumCulled = false;
    group.add(im);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    // GL lines are a pixel wide at any range, so a line of wires 3 km off drew one hard wavy stroke
    // right along the horizon. A conductor bundle (~0.12 m) covers 0.12 / (d · pixel angle) of a
    // pixel: the wires fade with distance as a lens sees them (clear at a few hundred metres, gone
    // into the haze by a few kilometres)
    const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2d31, transparent: true, opacity: 0.75, depthWrite: false });
    wireMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWireD;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWireD = - mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWireD;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= clamp( 330.0 / max( vWireD, 1.0 ), 0.0, 1.0 );');
    };
    wireMat.customProgramCacheKey = () => 'apex-skyline-wires';
    const wires = new THREE.LineSegments(wg, wireMat);
    wires.name = 'skyline_wires';
    wires.frustumCulled = false;
    group.add(wires);
    count += towers.length;
  }

  // ---- industry: stacks, tanks, sheds (static, instanced; a red light on each stack top at night)
  if (cfg.industry?.length) {
    const st: THREE.Matrix4[] = [], tk: THREE.Matrix4[] = [], sh: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const I of cfg.industry) {
      const [fx, fz] = bearingDir(I.bearing);
      const tx = -fz, tz = fx;
      const site = (k: number) => {
        const a = (r() - 0.5) * 2 * I.across * (0.4 + 0.6 * k), d = (r() - 0.5) * 2 * I.depth;
        const x = c.x + fx * (I.dist + d) + tx * a, z = c.z + fz * (I.dist + d) + tz * a;
        return { x, z, y: map.height(x, z) - 1 };
      };
      // (out of the horizon ring's way: it is written at ~12 km depth, anything beyond is behind it)
      const dry = (P: { y: number }) => P.y > -2;
      const pick = (k: number) => {
        for (let t = 0; t < 12; t++) {
          const P = site(k);
          if (dry(P)) return P;
        }
        return null;
      };
      for (let i = 0; i < I.stacks; i++) {
        const P = pick(0.6);
        if (!P) continue;
        const h = I.stackH * (0.55 + 0.45 * r()) * (i === 0 ? 1.15 : 1);
        st.push(new THREE.Matrix4().compose(p.set(P.x, P.y, P.z), q.identity(), s.set(I.stackR * (0.8 + 0.4 * r()), h, I.stackR * (0.8 + 0.4 * r()))));
      }
      for (let i = 0; i < I.tanks; i++) {
        const P = pick(1);
        if (!P) continue;
        const rr = 9 + 14 * r();
        tk.push(new THREE.Matrix4().compose(p.set(P.x, P.y, P.z), q.identity(), s.set(rr, 8 + 10 * r(), rr)));
      }
      for (let i = 0; i < I.sheds + (I.furnaces ?? 0); i++) {
        const P = pick(1);
        if (!P) continue;
        const fur = i >= I.sheds;
        const w = fur ? 30 + 10 * r() : 60 + 120 * r(), d = fur ? 30 + 10 * r() : 30 + 60 * r(), h = fur ? 70 + 25 * r() : 12 + 14 * r();
        q.setFromEuler(e.set(0, ((I.bearing + 90) * Math.PI) / 180 + (r() - 0.5) * 0.2, 0));
        sh.push(new THREE.Matrix4().compose(p.set(P.x, P.y, P.z), q, s.set(w, h, d)));
      }
    }
    const add = (geo: THREE.BufferGeometry, list: THREE.Matrix4[], name: string) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.name = name;
      im.frustumCulled = false;
      group.add(im);
      count += list.length;
    };
    add(stackGeometry(), st, 'skyline_stacks');
    add(tankGeometry(), tk, 'skyline_tanks');
    add(shedGeometry(), sh, 'skyline_sheds');
    if (st.length) {
      const lm = new THREE.MeshBasicMaterial({ color: 0xff2a14, toneMapped: false, transparent: true, opacity: 0 });
      const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 6, 4), lm, st.length);
      const m = new THREE.Matrix4();
      st.forEach((M, i) => {
        p.setFromMatrixPosition(M);
        s.setFromMatrixScale(M);
        lights.setMatrixAt(i, m.makeTranslation(p.x, p.y + s.y + 1, p.z));
      });
      lights.frustumCulled = false;
      group.add(lights);
      updates.push((time) => { lm.opacity = (time % 2) < 1 ? 0.85 : 0.35; });
    }
  }

  // ---- oil field
  if (cfg.jacks) {
    const J = cfg.jacks;
    const pts: { x: number; y: number; z: number; yaw: number; phase: number; speed: number }[] = [];
    let tries = 0;
    while (pts.length < J.n && tries++ < J.n * 30) {
      const b = J.from + r() * (J.to - J.from);
      const d = J.d0 + r() * (J.d1 - J.d0);
      const [dx, dz] = bearingDir(b);
      const x = c.x + dx * d, z = c.z + dz * d;
      if (!clearOfCircuit(x, z, 500) || map.excluded(x, z, 20) || map.urban(x, z) > 0.2) continue;
      if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 90)) continue;
      pts.push({ x, y: map.height(x, z), z, yaw: r() * 6.28, phase: r() * 6.28, speed: 1.1 + r() * 0.5 });
    }
    if (pts.length) {
      const bm = new THREE.InstancedMesh(jackBase(), mat, pts.length);
      const wb = new THREE.InstancedMesh(jackBeam(), mat, pts.length);
      bm.name = 'skyline_jacks';
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
      pts.forEach((j, i) => {
        m.compose(p.set(j.x, j.y, j.z), q.setFromEuler(e.set(0, j.yaw, 0)), one);
        bm.setMatrixAt(i, m);
      });
      bm.frustumCulled = wb.frustumCulled = false;
      group.add(bm, wb);
      updates.push((time) => {
        pts.forEach((j, i) => {
          const tilt = Math.sin(j.phase + time * j.speed) * 0.32;
          q.setFromEuler(e.set(tilt, j.yaw, 0, 'YXZ'));
          const off = _a.set(0, 4.2, 0);
          m.compose(p.set(j.x + off.x, j.y + off.y, j.z + off.z), q, one);
          wb.setMatrixAt(i, m);
        });
        wb.instanceMatrix.needsUpdate = true;
      });
      count += pts.length;
    }
  }

  return {
    group,
    count,
    update(t) {
      for (const f of updates) f(t);
    },
  };
}
