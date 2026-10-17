import * as THREE from 'three';
import { mergeStatic } from '../city/build.ts';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loft, table, type Station } from './loft.ts';
import { MAT, lampMaterial, makeWheel, nozzleGeometry, plumeMesh, wellLiner } from './parts.ts';

/**
 * The Tesla Roadster as revealed on 15 October 2026 — the "cyberfied" production car:
 *
 *  - a low wedge drawn from the SR-71 and the F-35: a sharp spade nose, a crisp chine running the
 *    whole length of each flank, a shoulder crease over the wheels, a Kamm tail
 *  - "Ano White" paint (from rocket protective coatings), gold-tinted glass like an Apollo visor,
 *    a one-piece fighter canopy with removable T-top panels either side of a body spine
 *  - hidden headlights (a hairline LED bar across the nose), a full-width taillight
 *  - an active multi-mode rear wing (rises at speed, stands up as an air brake)
 *  - butterfly doors, a two-seat cockpit with a steer-by-wire yoke, a centre touchscreen and two
 *    small displays in front of the driver
 *  - wheelbase 2,825 mm, width ~2.0 m; length ~4.6 m, height ~1.12 m
 *
 * Trims (Tesla's): Performance (road ready), Thrust (race ready: four rear cold-gas thrusters fed
 * by a 200 L nitrogen tank, 0–60 mph in 0.81 s), Rocket (air ready: ten cold-gas thrusters round
 * the car, single seat, flight).
 */

export type Trim = 'performance' | 'thrust' | 'rocket';

export const ROADSTER = {
  length: 4.58,
  width: 2.0,
  height: 1.12,
  wheelbase: 2.825,
  track: 1.72,
  wheelR: 0.36,
};

export interface Thruster {
  /** position and nozzle direction (the gas leaves along `dir`) in the car frame */
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  /** downward lift nozzles vs rearward boost nozzles */
  kind: 'lift' | 'boost';
  plume: { mesh: THREE.Mesh; u: { uThrust: { value: number }; uTime: { value: number } } };
  level: number;
}

export interface RoadsterRig {
  root: THREE.Group;
  body: THREE.Group;
  wheels: { steer: THREE.Group; spin: THREE.Group; front: boolean; left: boolean; rest: THREE.Vector3 }[];
  doors: THREE.Group[];
  wing: THREE.Group;
  yoke: THREE.Group;
  thrusters: Thruster[];
  nozzleMat: THREE.MeshStandardMaterial;
  paint: THREE.MeshPhysicalMaterial;
  tail: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  screen: THREE.CanvasTexture;
  trim: Trim;
  setPaint(c: THREE.ColorRepresentation): void;
  setBrake(k: number): void;
  setHeadlights(on: number): void;
  setDoors(open: number): void;
  setWing(rise: number, angle: number): void;
  setSteer(rad: number): void;
  spinWheels(dRad: number): void;
  update(t: number): void;
  /** the eye point for the cockpit camera (car frame) */
  eye: THREE.Vector3;
}

const L = ROADSTER.length / 2;
const WZ = ROADSTER.wheelbase / 2;

// ---- the body's lines, front (+z) to back (all metres, y from the ground, w half widths)
const T = (rows: [number, number][]) => table(rows);
const floorY = T([[2.29, 0.17], [2.2, 0.13], [2.0, 0.11], [1.6, 0.11], [0, 0.105], [-1.3, 0.11], [-1.75, 0.17], [-2.05, 0.27], [-2.29, 0.35]]);
const floorW = T([[2.29, 0.3], [2.2, 0.55], [2.0, 0.68], [1.4, 0.7], [0, 0.73], [-1.4, 0.7], [-2.0, 0.62], [-2.29, 0.55]]);
const chineY = T([[2.29, 0.19], [2.2, 0.225], [2.0, 0.27], [1.75, 0.31], [1.41, 0.34], [1.0, 0.35], [0.4, 0.35], [-0.4, 0.36], [-1.1, 0.4], [-1.41, 0.43], [-1.75, 0.46], [-2.05, 0.49], [-2.29, 0.5]]);
const chineW = T([[2.29, 0.46], [2.2, 0.72], [2.0, 0.9], [1.75, 0.985], [1.41, 1.0], [1.0, 0.97], [0.6, 0.95], [0, 0.95], [-0.6, 0.96], [-1.1, 0.99], [-1.41, 1.0], [-1.75, 0.99], [-2.05, 0.95], [-2.29, 0.86]]);
const shY = T([[2.29, 0.205], [2.2, 0.29], [2.0, 0.44], [1.75, 0.63], [1.41, 0.79], [1.1, 0.77], [0.7, 0.73], [0.2, 0.72], [-0.4, 0.75], [-0.8, 0.8], [-1.1, 0.86], [-1.41, 0.9], [-1.75, 0.89], [-2.05, 0.86], [-2.29, 0.8]]);
const shW = T([[2.29, 0.41], [2.2, 0.66], [2.0, 0.82], [1.75, 0.91], [1.41, 0.95], [1.0, 0.88], [0.4, 0.85], [0, 0.84], [-0.6, 0.85], [-1.1, 0.89], [-1.41, 0.93], [-1.75, 0.92], [-2.05, 0.87], [-2.29, 0.8]]);
// the hood / deck centre outside the canopy
const deckY = T([[2.29, 0.205], [2.2, 0.28], [2.0, 0.41], [1.75, 0.55], [1.41, 0.645], [1.1, 0.67], [0.95, 0.685], [-1.5, 0.865], [-1.75, 0.865], [-2.05, 0.84], [-2.29, 0.795]]);
// the canopy
const CAN0 = 0.98, CAN1 = -1.55;
const canTop = T([[CAN0, 0.69], [0.7, 0.86], [0.4, 0.99], [0.1, 1.08], [-0.25, 1.12], [-0.6, 1.09], [-0.9, 1.03], [-1.2, 0.95], [-1.4, 0.9], [CAN1, 0.865]]);
const canTopW = T([[CAN0, 0.5], [0.6, 0.52], [0, 0.56], [-0.8, 0.54], [-1.3, 0.48], [CAN1, 0.44]]);
const canBaseW = T([[CAN0, 0.78], [0.5, 0.8], [0, 0.8], [-0.8, 0.82], [-1.3, 0.84], [CAN1, 0.84]]);

const inCanopy = (z: number) => z <= CAN0 && z >= CAN1;
/** 0 outside the canopy span, easing in over 15 cm at its ends */
const canK = (z: number) => {
  if (!inCanopy(z)) return 0;
  const a = Math.min(z - CAN1, CAN0 - z);
  return Math.min(1, a / 0.15);
};

function ring(z: number): Station {
  const fy = floorY(z), fw = floorW(z);
  const cy = chineY(z), cw = chineW(z);
  const sy = shY(z), sw = shW(z);
  const k = canK(z);
  const dY = deckY(z);
  // canopy base: on the deck just inboard of the shoulder; its top edge and the spine
  const by = THREE.MathUtils.lerp(sy - 0.01, sy + 0.005, k);
  const bw = THREE.MathUtils.lerp(sw * 0.86, Math.min(canBaseW(z), sw - 0.04), k);
  const ty = THREE.MathUtils.lerp(dY, Math.max(canTop(z), sy + 0.02), k);
  const tw = THREE.MathUtils.lerp(sw * 0.5, canTopW(z), k);
  const crown = THREE.MathUtils.lerp(dY + 0.005, ty + 0.035, k);
  const mid = (a: [number, number], b: [number, number], t: number, bulgeX = 0, bulgeY = 0): [number, number] => [a[0] + (b[0] - a[0]) * t + bulgeX, a[1] + (b[1] - a[1]) * t + bulgeY];
  const F0: [number, number] = [0, fy], F1: [number, number] = [fw, fy];
  const C: [number, number] = [cw, cy];
  const S: [number, number] = [sw, sy];
  const Bp: [number, number] = [bw, by];
  const Tp: [number, number] = [tw, ty];
  const SP: [number, number] = [0.13, crown - 0.004];
  const Top: [number, number] = [0, crown];
  return {
    z,
    bands: [
      // 0 floor
      { pts: [F0, mid(F0, F1, 0.5), F1] },
      // 1 rocker: tucks under from the chine
      { pts: [F1, mid(F1, C, 0.5, 0.06, -0.01), mid(F1, C, 0.85, 0.02, 0), C] },
      // 2 flank: chine up to the shoulder, a slight outward swell
      { pts: [C, mid(C, S, 0.35, 0.012, 0), mid(C, S, 0.7, 0.006, 0), S] },
      // 3 shoulder deck to the canopy base
      { pts: [S, mid(S, Bp, 0.5, 0, 0.004), Bp] },
      // 4 canopy side (glass)
      { pts: [Bp, mid(Bp, Tp, 0.35, 0.03 * k, 0), mid(Bp, Tp, 0.7, 0.022 * k, 0), Tp] },
      // 5 canopy top (T-top glass) to the spine
      { pts: [Tp, mid(Tp, SP, 0.5, 0, 0.012 * k), SP] },
      // 6 the body-colour spine
      { pts: [SP, Top] },
    ],
  };
}

function stations(): Station[] {
  const zs: number[] = [];
  // dense at the nose and tail and round the canopy ends
  for (let z = L; z > -L - 1e-6; ) {
    zs.push(z);
    const dense = z > L - 0.35 || z < -L + 0.3 || Math.abs(z - CAN0) < 0.2 || Math.abs(z - CAN1) < 0.2 || Math.abs(Math.abs(z) - WZ) < 0.45;
    z -= dense ? 0.04 : 0.09;
  }
  if (zs[zs.length - 1] > -L + 0.005) zs.push(-L);
  return zs.map(ring);
}

// ---- the touchscreen's picture
function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 320);
  grd.addColorStop(0, '#0b0f16');
  grd.addColorStop(1, '#06080c');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 320);
  // the map: streets in a grid, the route in blue
  g.strokeStyle = 'rgba(120,140,170,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(170 + i * 30, 0);
    g.lineTo(140 + i * 30, 320);
    g.stroke();
    g.beginPath();
    g.moveTo(170, i * 30);
    g.lineTo(512, i * 30 + 10);
    g.stroke();
  }
  g.strokeStyle = '#3e8bff';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(330, 320);
  g.lineTo(340, 180);
  g.lineTo(450, 120);
  g.stroke();
  g.fillStyle = '#e8ecf2';
  g.font = '600 46px Arial';
  g.fillText('0', 40, 90);
  g.font = '600 16px Arial';
  g.fillStyle = '#8a93a3';
  g.fillText('MPH', 44, 116);
  g.fillText('ROADSTER', 30, 290);
  g.fillStyle = '#21d07a';
  g.fillRect(30, 150, 90, 8);
  g.fillStyle = '#e8ecf2';
  g.fillText('620 mi', 30, 180);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let wordTex: THREE.CanvasTexture | null = null;
/** the spaced-out wordmark across the tail */
function wordmark(): THREE.CanvasTexture {
  if (wordTex) return wordTex;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 102;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.font = '600 74px "Titillium Web", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const word = 'T E S L A';
  g.letterSpacing = '38px';
  g.fillText(word, 512 + 19, 54);
  wordTex = new THREE.CanvasTexture(c);
  wordTex.colorSpace = THREE.SRGBColorSpace;
  wordTex.anisotropy = 8;
  return wordTex;
}

export function buildRoadster(trim: Trim, color: THREE.ColorRepresentation = 0xe9e8e3): RoadsterRig {
  const root = new THREE.Group();
  root.name = 'Roadster';
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.18, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.025, sheen: 0.2, sheenColor: new THREE.Color(0xffffff) });
  // the wheel arches are cut out of the flanks (and the front light bar drawn) in the paint shader
  const archU = { uArchZ: { value: WZ }, uArchY: { value: ROADSTER.wheelR }, uArchR: { value: 0.39 } };
  paint.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, archU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\nvarying vec3 vLocN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;\nvLocN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uArchZ, uArchY, uArchR;\nvarying vec3 vLoc;\nvarying vec3 vLocN;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if ( abs( vLoc.x ) > 0.62 && vLocN.x * sign( vLoc.x ) > 0.3 && vLoc.y < 0.735 ) {
  float dz = abs( vLoc.z ) - uArchZ;
  float dy = vLoc.y - uArchY;
  if ( dz * dz + dy * dy < uArchR * uArchR ) discard;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float ax = abs( vLoc.x );
  float sm = 0.0035;
  // panel seams: the doors, the frunk, the charge port
  float seam = 0.0;
  if ( ax > 0.45 && vLoc.y > 0.3 ) seam = max( seam, 1.0 - smoothstep( sm * 0.4, sm, abs( vLoc.z - 0.82 ) ) );
  if ( ax > 0.45 && vLoc.y > 0.3 && vLoc.y < 0.95 ) seam = max( seam, 1.0 - smoothstep( sm * 0.4, sm, abs( vLoc.z + 0.62 ) ) );
  if ( ax < 0.74 && vLoc.y > 0.42 && vLoc.z > 1.0 ) seam = max( seam, 1.0 - smoothstep( sm * 0.4, sm, abs( vLoc.z - 1.62 ) ) );
  if ( vLoc.z > 1.62 && vLoc.z < 2.2 && vLoc.y > 0.4 ) seam = max( seam, 1.0 - smoothstep( sm * 0.4, sm, abs( ax - 0.7 ) ) );
  // the SR-71 chine's shadow line and a side intake sculpted ahead of the rear wheel
  float intake = 0.0;
  if ( ax > 0.8 && vLoc.z < -0.66 && vLoc.z > -1.0 && vLoc.y > 0.4 && vLoc.y < 0.66 ) {
    float k = smoothstep( -1.0, -0.66, vLoc.z );
    intake = step( vLoc.y, 0.4 + 0.26 * k );
    float slat = step( 0.5, fract( vLoc.y * 70.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.012 ) * ( 0.6 + 0.6 * slat ), intake );
  }
  // the front intake below the light bar: a honeycomb mesh behind a dark surround
  if ( vLoc.z > 1.9 && vLoc.y < 0.215 && vLoc.y > 0.115 && ax < 0.8 - ( 0.215 - vLoc.y ) * 0.6 ) {
    vec2 hp = vec2( vLoc.x * 42.0, vLoc.y * 48.0 );
    vec2 hr = vec2( 1.0, 1.732 );
    vec2 ha = mod( hp, hr ) - hr * 0.5, hb = mod( hp - hr * 0.5, hr ) - hr * 0.5;
    float hd = min( dot( ha, ha ), dot( hb, hb ) );
    diffuseColor.rgb = mix( vec3( 0.006 ), vec3( 0.05 ), smoothstep( 0.12, 0.2, hd ) );
  }
  // the hood's twin heat extractors (slatted vents either side of the centre)
  if ( vLoc.z > 1.36 && vLoc.z < 1.58 && ax > 0.26 && ax < 0.44 && vLocN.y > 0.5 ) {
    float slat = smoothstep( 0.3, 0.5, abs( fract( vLoc.z * 70.0 ) - 0.5 ) );
    float edge = smoothstep( 0.0, 0.008, min( min( vLoc.z - 1.36, 1.58 - vLoc.z ), min( ax - 0.26, 0.44 - ax ) ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.015 ), diffuseColor.rgb * 0.55, slat ), edge );
  }
  // the tail: body colour above the light blade, a gloss-black band with the wordmark, the
  // carbon diffuser below
  if ( vLoc.z < -2.27 && vLocN.z < -0.6 ) {
    if ( vLoc.y < 0.765 ) diffuseColor.rgb = vec3( 0.012 );
    if ( vLoc.y < 0.5 ) {
      float cb = step( 0.5, fract( ( vLoc.x + vLoc.y ) * 60.0 ) ) * 0.5 + step( 0.5, fract( ( vLoc.x - vLoc.y ) * 60.0 ) ) * 0.5;
      diffuseColor.rgb = vec3( 0.018 + cb * 0.016 );
    }
  }
  // the lower door blade (a carbon sill line) and the chine's shadow just under the crease
  if ( ax > 0.86 && vLoc.y > 0.17 && vLoc.y < 0.3 && abs( vLoc.z ) < 1.0 ) diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.02 ), 0.92 );
  diffuseColor.rgb *= 1.0 - 0.9 * seam;
}`,
      );
  };
  paint.customProgramCacheKey = () => 'roadster-paint';
  const L0 = loft({
    stations: stations(),
    slot(b, z, y) {
      if (b === 0) return 'floor';
      if (b === 1) return z > 1.95 || z < -2.05 ? 'rocker' : 'paint';
      if ((b === 4 || b === 5) && canK(z) > 0.2 && y > 0.74) return 'glass';
      return 'paint';
    },
    door: { bands: [2, 3, 4], z0: -0.62, z1: 0.82 },
    capFront: 'paint',
    capRear: 'paint',
  });
  const mats: Record<string, THREE.Material> = {
    paint,
    glass: MAT.glassGold(),
    floor: MAT.blackTrim(),
    rocker: MAT.carbon(),
    tailcap: MAT.gloss(),
  };
  for (const [k, g] of L0.slots) {
    const m = new THREE.Mesh(g, mats[k] ?? paint);
    m.castShadow = k !== 'glass';
    m.receiveShadow = true;
    m.name = 'body_' + k;
    body.add(m);
  }
  // doors: butterfly, hinged at the A-pillar's foot, swinging up and forward
  const doors: THREE.Group[] = [];
  for (const side of ['left', 'right'] as const) {
    const sg = side === 'left' ? 1 : -1;
    const hinge = new THREE.Group();
    const hp = new THREE.Vector3(0.56 * sg, 0.98, 0.8);
    hinge.position.copy(hp);
    for (const [k, g] of L0.doors[side]) {
      const m = new THREE.Mesh(g, mats[k] ?? paint);
      m.position.copy(hp).multiplyScalar(-1);
      m.castShadow = k !== 'glass';
      m.receiveShadow = true;
      hinge.add(m);
    }
    hinge.userData.axis = new THREE.Vector3(0, 0.42, 1).normalize();
    hinge.userData.side = sg;
    body.add(hinge);
    doors.push(hinge);
  }

  // ---- lamps: the hairline LED bar across the nose, the full-width tail light
  const head = lampMaterial(0xf2f6ff, 0.6);
  const tail = lampMaterial(0xff1020, 1.6);
  {
    const pts: THREE.Vector3[] = [];
    const z = 2.205;
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const t = i / n - 0.5;
      const x = t * 2 * chineW(z) * 0.93;
      const ax = Math.abs(t * 2);
      pts.push(new THREE.Vector3(x, chineY(z) + 0.022 + ax * 0.012, z - ax * ax * 0.13));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 48, 0.007, 6, false);
    const bar = new THREE.Mesh(g, head);
    body.add(bar);
  }
  {
    // the taillight: a full-width blade set into the tail's upper edge
    const z = -L - 0.004;
    const y = shY(-L) - 0.06;
    const w = chineW(-L) * 0.94;
    const g = new THREE.BoxGeometry(w * 2, 0.035, 0.02);
    const tl = new THREE.Mesh(g, tail);
    tl.position.set(0, y, z);
    body.add(tl);
    // the blade's smoked housing, its C-shaped ends wrapping round the corners, the reverse lamps
    const housing = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.02, 0.05, 0.012), MAT.glassDark());
    housing.position.set(0, y, z - 0.004);
    body.add(housing);
    for (const sg of [1, -1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.022), tail);
      c.position.set(sg * (w - 0.035), y - 0.04, z);
      body.add(c);
      const rev = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.022, 0.014), lampMaterial(0xffffff, 0.15));
      rev.position.set(sg * 0.42, 0.535, z);
      body.add(rev);
    }
    // the wordmark across the black band
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.07), new THREE.MeshStandardMaterial({ map: wordmark(), transparent: true, metalness: 0.6, roughness: 0.3, color: 0xf2f3f5, emissive: 0x30333a, emissiveMap: wordmark() }));
    wm.position.set(0, 0.64, z - 0.006);
    wm.rotation.y = Math.PI;
    body.add(wm);
    // the diffuser: strakes running back under the tail
    for (let i = -3; i <= 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.62), MAT.carbon());
      fin.position.set(i * 0.17, floorY(-2.0) + 0.05, -L + 0.3);
      fin.rotation.x = 0.36;
      body.add(fin);
    }
    // a carbon lip under the diffuser's trailing edge
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w * 2 - 0.1, 0.012, 0.08), MAT.carbon());
    lip.position.set(0, floorY(-L) - 0.004, -L + 0.03);
    body.add(lip);
  }
  // ---- the nose: lamp pods under the hairline bar, the carbon splitter
  for (const sg of [1, -1]) {
    const z = 2.12;
    const x = chineW(z) * 0.78 * sg;
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.17, 4, 10), MAT.glassDark());
    pod.rotation.z = Math.PI / 2;
    pod.rotation.y = -0.45 * sg;
    pod.scale.set(1, 1, 0.5);
    pod.position.set(x, chineY(z) - 0.006, z + 0.035);
    body.add(pod);
    for (let k = 0; k < 3; k++) {
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.013, 12), head);
      const lx = x - sg * (0.055 - k * 0.055) * Math.cos(0.45);
      led.position.set(lx, chineY(z) - 0.006, z + 0.035 + (0.055 - k * 0.055) * Math.sin(0.45) * 1 + 0.016);
      body.add(led);
    }
  }
  {
    const sh = new THREE.Shape();
    const n = 18;
    const zs = (i: number) => 2.29 - (i / n) * 0.55;
    sh.moveTo(0, 2.33);
    for (let i = 0; i <= n; i++) sh.lineTo(floorW(zs(i)) + 0.08 - (i / n) * 0.02, zs(i) + 0.04 * (1 - i / n));
    for (let i = n; i >= 0; i--) sh.lineTo(-(floorW(zs(i)) + 0.08 - (i / n) * 0.02), zs(i) + 0.04 * (1 - i / n));
    sh.lineTo(0, 2.33);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    const sp = new THREE.Mesh(g, MAT.carbon());
    sp.position.y = floorY(2.2) + 0.002;
    body.add(sp);
  }
  // the badge: a small chrome T on the nose
  {
    const s = new THREE.Shape();
    s.moveTo(-0.05, 0.012);
    s.quadraticCurveTo(0, 0.022, 0.05, 0.012);
    s.lineTo(0.05, 0.003);
    s.quadraticCurveTo(0.03, 0.006, 0.008, 0.002);
    s.lineTo(0.008, -0.05);
    s.lineTo(-0.008, -0.05);
    s.lineTo(-0.008, 0.002);
    s.quadraticCurveTo(-0.03, 0.006, -0.05, 0.003);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false });
    const b = new THREE.Mesh(g, MAT.chrome());
    const z = 1.95;
    b.position.set(0, deckY(z) + 0.004, z);
    b.rotation.x = -Math.PI / 2 + 0.42;
    body.add(b);
  }
  // camera pods (flush aero: no mirrors)
  for (const sg of [1, -1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 4, 8), MAT.gloss());
    pod.rotation.x = Math.PI / 2;
    pod.position.set(0.86 * sg, shY(0.85) + 0.01, 0.85);
    body.add(pod);
  }

  // ---- the active wing: an airfoil on two swan-neck struts, stowed flush in the deck
  const wing = new THREE.Group();
  {
    const af = new THREE.Shape();
    af.moveTo(0, 0);
    af.bezierCurveTo(0.05, 0.03, 0.2, 0.03, 0.32, 0.004);
    af.lineTo(0.32, -0.002);
    af.bezierCurveTo(0.2, 0.008, 0.06, 0.004, 0, 0);
    const g = new THREE.ExtrudeGeometry(af, { depth: 1.5, bevelEnabled: false, curveSegments: 10 });
    g.rotateY(Math.PI / 2);
    g.translate(-0.75, 0, 0.16);
    const blade = new THREE.Mesh(g, MAT.carbon());
    blade.castShadow = true;
    wing.add(blade);
    const gurney = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.014, 0.004), MAT.gloss());
    gurney.position.set(0, 0.009, -0.16);
    wing.add(gurney);
    for (const sg of [1, -1]) {
      const ep = new THREE.Shape();
      ep.moveTo(-0.2, -0.03);
      ep.lineTo(0.17, -0.02);
      ep.quadraticCurveTo(0.2, 0.03, 0.12, 0.05);
      ep.lineTo(-0.16, 0.06);
      ep.quadraticCurveTo(-0.22, 0.04, -0.2, -0.03);
      const eg = new THREE.ExtrudeGeometry(ep, { depth: 0.01, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 });
      eg.rotateY(Math.PI / 2);
      const plate = new THREE.Mesh(eg, paint);
      plate.position.set(0.752 * sg + (sg > 0 ? 0 : 0.01), 0.005, 0);
      wing.add(plate);
    }
    wing.userData.struts = [] as THREE.Mesh[];
    for (const sg of [1, -1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.3, 0.06), MAT.carbon());
      st.position.set(0.32 * sg, -0.15, 0.06);
      wing.add(st);
      (wing.userData.struts as THREE.Mesh[]).push(st);
    }
    wing.position.set(0, deckY(-1.95) + 0.008, -1.95);
    body.add(wing);
  }

  // ---- wheels, arches, brakes
  const wheels: RoadsterRig['wheels'] = [];
  const caliper = MAT.caliperRed();
  for (const front of [true, false]) {
    for (const left of [true, false]) {
      const sg = left ? 1 : -1;
      const w = makeWheel({ radius: ROADSTER.wheelR, width: front ? 0.27 : 0.33, rim: 0.27, style: 'aero', rimMat: MAT.rimSilver(), caliper }, left ? 1 : -1);
      const rest = new THREE.Vector3((ROADSTER.track / 2 + (front ? 0 : 0.02)) * sg, ROADSTER.wheelR, front ? WZ : -WZ);
      w.steer.position.copy(rest);
      root.add(w.steer);
      wheels.push({ steer: w.steer, spin: w.spin, front, left, rest });
      body.add(wellLiner(front ? WZ : -WZ, ROADSTER.wheelR, 0.385, sg < 0 ? -1.02 : 0.8, sg < 0 ? -0.8 : 1.02));
      // the arch's finished edge: a thin black lip round the cut-out (flat along the top where the
      // shoulder runs over the tyre)
      {
        const pts: THREE.Vector3[] = [];
        const zc = front ? WZ : -WZ;
        for (let i = 0; i <= 40; i++) {
          const th = 0.02 + (i / 40) * (Math.PI - 0.04);
          const z = zc + Math.cos(th) * 0.39;
          const y = Math.min(0.36 + Math.sin(th) * 0.39, 0.733);
          const cy = chineY(z), cw = chineW(z), sy = shY(z), sw = shW(z);
          const k = THREE.MathUtils.clamp((y - cy) / Math.max(0.01, sy - cy), 0, 1);
          const x = cw + (sw - cw) * k + 0.012 * Math.sin(k * Math.PI) + 0.006;
          pts.push(new THREE.Vector3(x * sg, y, z));
        }
        const lip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.011, 6, false), MAT.gloss());
        body.add(lip);
      }
      // a carbon sill under the doors
      if (front) {
        const sill = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.0), MAT.carbon());
        sill.position.set(0.96 * sg, floorY(0) + 0.06, 0);
        body.add(sill);
      }
    }
  }

  // ---- the cockpit
  const yoke = new THREE.Group();
  const screen = screenTexture();
  {
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.06, 2.0), MAT.interior());
    tub.position.set(0, 0.2, -0.2);
    body.add(tub);
    // dashboard: a low wide wing of a dash, alcantara top
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 0.36), MAT.interior());
    dash.position.set(0, 0.66, 0.62);
    dash.rotation.x = 0.18;
    body.add(dash);
    // centre touchscreen (landscape, floating)
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.225), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.9, roughness: 0.15 }));
    scr.position.set(0, 0.79, 0.5);
    scr.rotation.x = -0.32;
    scr.rotation.y = Math.PI;
    body.add(scr);
    // the two driver displays either side of the yoke
    for (const dx of [0.5, 0.2]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2f7dff, emissiveIntensity: 0.6, roughness: 0.2 }));
      d.position.set(dx, 0.76, 0.56);
      d.rotation.y = Math.PI;
      d.rotation.x = -0.3;
      body.add(d);
    }
    // seats: carbon-backed buckets, black bolsters round cream inserts, a fixed headrest
    for (const sx of [0.35, -0.35]) {
      const seat = new THREE.Group();
      const shell = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.7, 0.09, 3, 0.04), MAT.carbon());
      shell.position.set(0, 0.62, -0.31);
      shell.rotation.x = -0.4;
      const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.1, 0.5, 3, 0.04), MAT.interior());
      cushion.position.set(0, 0.29, -0.02);
      cushion.rotation.x = 0.08;
      const insert = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.03, 0.4, 2, 0.012), MAT.interiorLight());
      insert.position.set(0, 0.345, -0.0);
      insert.rotation.x = 0.08;
      const back = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.6, 0.08, 3, 0.035), MAT.interior());
      back.position.set(0, 0.61, -0.255);
      back.rotation.x = -0.4;
      const backIn = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.42, 0.02, 2, 0.008), MAT.interiorLight());
      backIn.position.set(0, 0.58, -0.205);
      backIn.rotation.x = -0.4;
      seat.add(shell, cushion, insert, back, backIn);
      for (const bx of [0.2, -0.2]) {
        const bol = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.36, 4, 10), MAT.interior());
        bol.position.set(bx, 0.6, -0.22);
        bol.rotation.x = -0.4;
        const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.3, 4, 10), MAT.interior());
        thigh.rotation.x = Math.PI / 2 + 0.08;
        thigh.position.set(bx * 1.05, 0.34, 0.0);
        seat.add(bol, thigh);
      }
      seat.position.set(sx, 0, -0.35);
      body.add(seat);
    }
    // the centre tunnel and console, the door cards with their ambient light line
    const tunnel = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.2, 1.2, 3, 0.04), MAT.interior());
    tunnel.position.set(0, 0.32, 0.0);
    body.add(tunnel);
    const consoleTop = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.02, 0.5, 2, 0.008), MAT.gloss());
    consoleTop.position.set(0, 0.43, 0.12);
    body.add(consoleTop);
    const amb = lampMaterial(0x6fd6ff, 1.2);
    for (const sg of [1, -1]) {
      const card = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.3, 1.3, 2, 0.015), MAT.interior());
      card.position.set(0.74 * sg, 0.5, 0.05);
      body.add(card);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 1.1), amb);
      strip.position.set(0.715 * sg, 0.62, 0.05);
      body.add(strip);
    }
    // the hoop behind the seats (carbon), the T-top's spine above
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 28, Math.PI), MAT.carbon());
    hoop.scale.set(1, 0.72, 1);
    hoop.position.set(0, 0.42, -0.86);
    body.add(hoop);
    // the yoke: a squared ring with grips, on a column
    const yokePath = new THREE.CurvePath<THREE.Vector3>();
    const yp = [
      [-0.17, 0.05],
      [-0.17, -0.07],
      [-0.12, -0.1],
      [0.12, -0.1],
      [0.17, -0.07],
      [0.17, 0.05],
    ];
    for (let i = 0; i + 1 < yp.length; i++) yokePath.add(new THREE.LineCurve3(new THREE.Vector3(yp[i][0], yp[i][1], 0), new THREE.Vector3(yp[i + 1][0], yp[i + 1][1], 0)));
    const ring = new THREE.Mesh(new THREE.TubeGeometry(yokePath, 40, 0.017, 8, false), MAT.interior());
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 20), MAT.gloss());
    hub.rotation.x = Math.PI / 2;
    yoke.add(ring, hub);
    for (const gx of [0.17, -0.17]) {
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.09, 4, 8), MAT.interior());
      grip.position.set(gx, -0.005, 0);
      yoke.add(grip);
    }
    yoke.position.set(0.35, 0.66, 0.38);
    yoke.rotation.x = 0.35;
    body.add(yoke);
  }

  // ---- thrusters
  const thrusters: Thruster[] = [];
  // the nozzles frost over as the expanding nitrogen chills them (their own material, so it can)
  const nozzleMat = (MAT.nozzle() as THREE.MeshStandardMaterial).clone();
  const addThruster = (pos: THREE.Vector3, dir: THREE.Vector3, kind: 'lift' | 'boost', scale: number) => {
    const nz = new THREE.Mesh(nozzleGeometry(scale), nozzleMat);
    // nozzle bell opens along -y in its own frame: aim -y at `dir`
    nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
    nz.position.copy(pos);
    body.add(nz);
    const plume = plumeMesh(kind === 'boost' ? 1.6 : 1.25, kind === 'boost' ? 0.2 : 0.17);
    plume.mesh.quaternion.copy(nz.quaternion);
    plume.mesh.position.copy(pos).addScaledVector(dir.clone().normalize(), 0.07 * scale);
    plume.mesh.visible = false;
    body.add(plume.mesh);
    thrusters.push({ pos: pos.clone(), dir: dir.clone().normalize(), kind, plume, level: 0 });
  };
  const down = new THREE.Vector3(0, -1, 0);
  const back = new THREE.Vector3(0, -0.05, -1);
  if (trim === 'thrust' || trim === 'rocket') {
    // the rear boost cluster under the tail light
    const y = floorY(-L) + 0.12;
    for (const x of trim === 'thrust' ? [-0.48, -0.17, 0.17, 0.48] : [-0.32, 0.32]) addThruster(new THREE.Vector3(x, y, -L + 0.02), back, 'boost', 0.85);
  }
  if (trim === 'rocket') {
    // eight lift nozzles round the perimeter (with the two boost nozzles: ten)
    const ring8: [number, number][] = [
      [0.62, 1.95],
      [-0.62, 1.95],
      [0.9, 0.95],
      [-0.9, 0.95],
      [0.9, -0.62],
      [-0.9, -0.62],
      [0.72, -2.02],
      [-0.72, -2.02],
    ];
    for (const [x, z] of ring8) addThruster(new THREE.Vector3(x, floorY(z) + 0.075, z), down.clone().add(new THREE.Vector3(x * 0.08, 0, 0)), 'lift', 0.85);
  }

  // one draw per material for the body's fixed parts (the doors, the wing, the yoke and the plumes move)
  mergeStatic(body, new Set<THREE.Object3D>([...doors, wing, yoke, ...thrusters.map((t) => t.plume.mesh)]));

  const rig: RoadsterRig = {
    root,
    body,
    wheels,
    doors,
    wing,
    yoke,
    thrusters,
    nozzleMat,
    paint,
    tail,
    head,
    screen,
    trim,
    eye: new THREE.Vector3(0.35, 0.96, -0.36),
    setPaint(c) {
      paint.color.set(c);
    },
    setBrake(k) {
      tail.emissiveIntensity = 1.6 + 7 * k;
    },
    setHeadlights(on) {
      head.emissiveIntensity = 0.6 + 5 * on;
    },
    setDoors(open) {
      const a = THREE.MathUtils.smoothstep(open, 0, 1) * 1.15;
      for (const d of doors) d.quaternion.setFromAxisAngle(d.userData.axis as THREE.Vector3, a * (d.userData.side as number));
    },
    setWing(rise, angle) {
      wing.position.y = deckY(-1.95) + 0.008 + rise * 0.28;
      wing.rotation.x = -angle;
      for (const st of wing.userData.struts as THREE.Mesh[]) st.scale.y = 0.15 + rise * 0.95;
    },
    setSteer(rad) {
      for (const w of wheels) if (w.front) w.steer.rotation.y = rad;
      yoke.rotation.z = -rad * 10;
    },
    spinWheels(d) {
      for (const w of wheels) w.spin.rotation.x += d;
    },
    update(t) {
      for (const th of thrusters) {
        th.plume.u.uTime.value = t;
        th.plume.u.uThrust.value = th.level;
        th.plume.mesh.visible = th.level > 0.02;
        th.plume.mesh.scale.set(0.8, 0.3 + th.level * 0.4, 0.8);
      }
    },
  };
  return rig;
}
