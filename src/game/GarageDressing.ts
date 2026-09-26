import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Team } from '../race/Teams.ts';

/**
 * The rest of the garage around the car, for the menu: the engineers' telemetry desk
 * (three readable monitors, keyboards, a PC, headsets on hooks), a rack of blanketed
 * tyre sets, the teammate's car up on stands with its wheels off and its engine cover
 * on a cradle, flight cases, fire extinguishers, a pedestal fan in the doorway, cable
 * trays and spot lights on the gantry with the car's umbilical, a branded panel over
 * the tyre racks, and the floor markings (the door's hazard line, the wheel marks).
 *
 * Everything is built in the garage's frame (x = the car's left, z = toward the lane);
 * `S` is the side the open middle of the garage is on. Static meshes are flagged for
 * the garage's baking (merged per material); only the fan's rotor stays live.
 *
 * Also here: the viewpoints you can fly between (see `garageSpots`).
 */

const FONT = '"Titillium Web", Arial, sans-serif';

export interface DressingCtx {
  g: THREE.Group;
  S: number;
  owned: { dispose(): void }[];
  aniso: number;
  accent: string;
  team: Team;
  teamCol: THREE.Color;
  noseZ: number;
  tailZ: number;
  midZ: number;
  wheelR: number;
  /** the teammate's car (garage frame), if it is in its bay */
  mate: THREE.Vector3 | null;
  /** the three desk monitors' pictures: left, centre, right */
  screens: [THREE.Texture, THREE.Texture, THREE.Texture];
  blanket: THREE.Material;
  mats: {
    steel: THREE.Material;
    chrome: THREE.Material;
    black: THREE.Material;
    satin: THREE.Material;
    rubber: THREE.Material;
    teamPaint: THREE.Material;
    teamMatte: THREE.Material;
    hose: THREE.Material;
    alu: THREE.Material;
  };
}

export interface Dressing {
  /** the fan turns */
  update(dt: number): void;
  /** where the desk engineers stand (garage frame) and what they look at */
  deskCrew: { x: number; z: number; faceZ: number }[];
  /** mechanics' places at the teammate's car (garage frame) */
  mateCrew: { x: number; z: number; faceX: number; faceZ: number; clip: string }[];
}

export function buildDressing(c: DressingCtx): Dressing {
  const { g, S, owned } = c;
  const M = c.mats;
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (key: string, color: THREE.ColorRepresentation, rough = 0.5, metal = 0.2, extra: THREE.MeshStandardMaterialParameters = {}) => {
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
      matCache.set(key, m);
      owned.push(m);
    }
    return m;
  };
  const basic = (color: THREE.ColorRepresentation | THREE.Color, map: THREE.Texture | null = null) => {
    const m = new THREE.MeshBasicMaterial({ color, map });
    owned.push(m);
    return m;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, parent: THREE.Object3D = g, bake = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.bake = bake;
    parent.add(mesh);
    owned.push(geo);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = g, ry = 0, rx = 0, rz = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry, rx, rz, p);
  const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = g, ry = 0) => add(new RoundedBoxGeometry(w, h, d, 2, r), m, x, y, z, ry, 0, 0, p);
  const cyl = (r0: number, r1: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number, p: THREE.Object3D = g, ry = 0, rx = 0, rz = 0) => add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z, ry, rx, rz, p);
  const tube = (pts: THREE.Vector3[], r: number, m: THREE.Material, p: THREE.Object3D = g, seg = 32) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 8, false), m, 0, 0, 0, 0, 0, 0, p);
  const node = (x: number, y: number, z: number, ry = 0, p: THREE.Object3D = g) => {
    const n = new THREE.Group();
    n.position.set(x, y, z);
    n.rotation.y = ry;
    p.add(n);
    return n;
  };
  const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, p: THREE.Object3D = g) => {
    const mesh = add(new THREE.PlaneGeometry(w, h), m, x, y, z, ry, rx, 0, p, false);
    mesh.castShadow = false;
    return mesh;
  };
  const canvasTex = (w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d')!, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = c.aniso;
    owned.push(t);
    return t;
  };
  const caster = (x: number, z: number, p: THREE.Object3D, r = 0.04) => {
    cyl(r, r, 0.035, 12, M.rubber, x, r, z, p, 0, 0, Math.PI / 2);
    box(0.05, 0.05, 0.05, M.steel, x, r * 2 + 0.02, z, p);
  };
  const facing = (dirX: number, dirZ: number) => Math.atan2(dirX, dirZ);

  // ================================================================ the telemetry desk
  // three monitors facing the car, engineers standing in front of it (backs to the car)
  const deskX = S * 3.45, deskZ = -7.2;
  {
    const D = node(deskX, 0, deskZ);
    rbox(3.3, 0.05, 0.82, 0.012, mat('deskTop', 0x202226, 0.4, 0.2), 0, 1.0, 0, D);
    for (const x of [-1.55, 1.55]) rbox(0.07, 0.98, 0.72, 0.01, M.satin, x, 0.49, 0, D);
    box(3.1, 0.18, 0.04, M.satin, 0, 0.55, -0.34, D);
    // monitor arm bar and three screens
    box(3.0, 0.05, 0.05, M.alu, 0, 1.28, -0.3, D);
    for (const x of [-1.0, 0, 1.0]) cyl(0.022, 0.022, 0.3, 8, M.alu, x, 1.14, -0.3, D);
    c.screens.forEach((tex, i) => {
      const x = (i - 1) * 1.02, ry = -(i - 1) * 0.16;
      const Mn = node(x, 1.56, -0.27 + Math.abs(i - 1) * 0.07, ry, D);
      rbox(0.98, 0.58, 0.035, 0.012, M.black, 0, 0, -0.02, Mn);
      const sm = basic(new THREE.Color(1.05, 1.05, 1.05), tex);
      plane(0.94, 0.53, sm, 0, 0, 0.0, 0, 0, Mn);
    });
    // keyboards, mice, a PC tower under the desk, a mug
    for (const x of [-0.75, 0.55]) {
      rbox(0.44, 0.02, 0.15, 0.006, M.black, x, 1.035, 0.12, D);
      rbox(0.06, 0.02, 0.1, 0.01, M.black, x + 0.34, 1.035, 0.14, D);
    }
    rbox(0.2, 0.46, 0.46, 0.015, M.black, 1.2, 0.24, -0.1, D);
    box(0.012, 0.3, 0.012, basic(new THREE.Color(0.2, 0.9, 1.6)), 1.3, 0.3, 0.14, D);
    cyl(0.04, 0.035, 0.1, 12, mat('mug', 0xeeeeee, 0.35, 0), -0.2, 1.075, 0.2, D);
    // headsets on hooks at the desk's end
    const H = node(1.72, 0, 0.1, 0, D);
    cyl(0.018, 0.018, 1.5, 8, M.alu, 0, 0.75, 0, H);
    cyl(0.16, 0.18, 0.03, 16, M.satin, 0, 0.015, 0, H);
    for (let k = 0; k < 3; k++) {
      const y = 1.0 + k * 0.17;
      box(0.012, 0.012, 0.14, M.alu, 0, y, 0.07, H);
      const hs = node(0, y - 0.1, 0.13, Math.PI / 2, H);
      add(new THREE.TorusGeometry(0.085, 0.012, 6, 20, Math.PI), M.black, 0, 0.0, 0, 0, 0, 0, hs);
      for (const sx of [-0.085, 0.085]) cyl(0.045, 0.045, 0.035, 14, k === 1 ? M.teamMatte : M.black, sx, -0.03, 0, hs, 0, 0, Math.PI / 2);
    }
  }
  const deskCrew = [
    { x: deskX - S * 0.62, z: deskZ + 0.72, faceZ: deskZ - 1 },
    { x: deskX + S * 0.6, z: deskZ + 0.74, faceZ: deskZ - 1 },
  ];

  // ================================================================ a rack of blanketed tyre sets
  {
    const R = c.wheelR;
    const T = node(S * 6.35, 0, 0.45, facing(-S, 0));
    const W = 4.1;
    for (const x of [-W / 2, 0, W / 2]) for (const z of [-0.26, 0.26]) box(0.05, 1.62, 0.05, M.steel, x, 0.81, z, T);
    for (const y of [0.1, 0.86]) {
      box(W + 0.1, 0.035, 0.6, M.steel, 0, y, 0, T);
      for (const z of [-0.26, 0.26]) box(W + 0.1, 0.05, 0.03, mat('rackEdge', 0x9aa1a8, 0.4, 0.8), 0, y + 0.03, z, T);
    }
    // the blanket around each tyre (the same cover as on the car), rims out
    const prof: [number, number][] = [
      [R * 0.8, -0.21],
      [R - 0.02, -0.215],
      [R + 0.02, -0.18],
      [R + 0.035, -0.12],
      [R + 0.035, 0.12],
      [R + 0.02, 0.18],
      [R - 0.02, 0.215],
      [R * 0.8, 0.21],
    ];
    const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40);
    lathe.rotateX(Math.PI / 2);
    // tyres standing on their treads along each shelf, in sets of four; the set's compound on a tag
    lathe.rotateY(Math.PI / 2);
    const compound = [0xe3202e, 0xf3c300, 0xeeeeee, 0xe3202e];
    const rimM = mat('rim', 0x1d1f23, 0.35, 0.8);
    let set = 0;
    for (const y of [0.1, 0.86]) {
      for (let s4 = 0; s4 < 2; s4++, set++) {
        for (let i = 0; i < 4; i++) {
          const x = -W / 2 + 0.3 + s4 * 2.05 + i * 0.45;
          const cy = y + 0.03 + R + 0.035;
          add(lathe.clone(), c.blanket, x, cy, 0, 0, 0, 0, T);
          for (const sx of [-0.2, 0.2]) add(new THREE.CircleGeometry(R * 0.8, 24), rimM, x + sx, cy, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0, T);
        }
        // the set's tag hangs from the shelf's lip
        box(0.3, 0.1, 0.012, mat('cmp' + set, compound[set], 0.5, 0), -W / 2 + 0.3 + s4 * 2.05 + 0.675, y + 0.0, 0.31, T);
      }
    }
    lathe.dispose();
  }

  // ================================================================ the teammate's car up on stands
  const mateCrew: Dressing['mateCrew'] = [];
  if (c.mate) {
    const m = c.mate;
    for (const [dx, dz] of [[-0.42, 1.3], [0.42, 1.3], [-0.42, -1.25], [0.42, -1.25]] as const) {
      const x = m.x + dx, z = m.z + dz;
      rbox(0.3, 0.03, 0.3, 0.01, M.satin, x, 0.015, z);
      cyl(0.03, 0.03, 0.26, 10, M.teamPaint, x, 0.16, z);
      rbox(0.16, 0.035, 0.12, 0.01, M.rubber, x, 0.3, z);
    }
    // its wheels, off: two stacked flat, two leaning on a wheel stand
    const R = c.wheelR;
    const tyreGeo = new THREE.CylinderGeometry(R, R, 0.36, 32, 1, false);
    const tyreM = mat('looseTyre', 0x121214, 0.85, 0);
    for (let h = 0; h < 2; h++) {
      add(tyreGeo.clone(), c.blanket, m.x + S * 1.55, 0.18 + h * 0.37, m.z + 1.9);
      add(new THREE.CircleGeometry(R * 0.78, 24), mat('rim', 0x1d1f23, 0.35, 0.8), m.x + S * 1.55, 0.18 + h * 0.37 + 0.182, m.z + 1.9, 0, -Math.PI / 2);
    }
    for (let h = 0; h < 2; h++) {
      add(tyreGeo.clone(), tyreM, m.x + S * 1.6, R + 0.02, m.z - 0.9 + h * 0.4, 0, 0, Math.PI / 2 - 0.12 * S);
    }
    tyreGeo.dispose();
    mateCrew.push({ x: m.x + S * 0.95, z: m.z - 1.6, faceX: m.x, faceZ: m.z - 1.4, clip: 'Fixing_Kneeling' });
    mateCrew.push({ x: m.x - S * 0.9, z: m.z + 0.3, faceX: m.x, faceZ: m.z + 0.2, clip: 'Interact' });
  }
  // the engine cover on its cradle, between the cars
  {
    const E = node(S * 7.0, 0, -3.3, facing(0, 1) + S * 0.35);
    for (const z of [-0.55, 0.55]) {
      box(0.06, 0.62, 0.06, M.steel, -0.25, 0.31, z, E);
      box(0.06, 0.62, 0.06, M.steel, 0.25, 0.31, z, E);
      rbox(0.62, 0.06, 0.12, 0.02, M.rubber, 0, 0.64, z, E);
    }
    // the cover: a side profile (the airbox hump, the fin) extruded to its width
    const sh = new THREE.Shape();
    sh.moveTo(-0.9, 0);
    sh.bezierCurveTo(-0.7, 0.28, -0.35, 0.52, 0.0, 0.58);
    sh.lineTo(0.18, 0.6);
    sh.bezierCurveTo(0.5, 0.42, 0.8, 0.2, 1.05, 0.06);
    sh.lineTo(1.05, 0);
    sh.lineTo(-0.9, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 16 });
    geo.translate(0, 0, -0.21);
    geo.rotateY(Math.PI / 2);
    const cover = add(geo, M.teamPaint, 0, 0.67, 0, 0, 0, 0, E);
    cover.userData.bake = true;
    // the air intake's dark mouth
    add(new THREE.CircleGeometry(0.09, 20), M.black, 0, 1.17, -0.03, 0, 0, 0, E);
  }

  // ================================================================ flight cases
  const flightCase = (x: number, z: number, ry: number, w: number, h: number, d: number, y = 0) => {
    const F = node(x, y, z, ry);
    rbox(w, h, d, 0.02, mat('case', 0x16171a, 0.6, 0.1), 0, h / 2 + 0.05, 0, F);
    for (const sy of [0.06, h + 0.04]) for (const sz of [-d / 2, d / 2]) box(w + 0.01, 0.025, 0.025, M.alu, 0, sy, sz, F);
    box(w * 0.9, 0.05, 0.012, M.teamPaint, 0, h * 0.62 + 0.05, d / 2 + 0.006, F);
    for (const sx of [-w / 2 + 0.1, w / 2 - 0.1]) for (const sz of [-d / 2 + 0.1, d / 2 - 0.1]) caster(sx, sz, F, 0.03);
    return F;
  };
  flightCase(S * 6.1, 3.7, 0.2, 1.1, 0.72, 0.62);
  flightCase(S * 6.15, 3.72, 0.25, 0.9, 0.45, 0.55, 0.82);
  flightCase(S * 7.3, 4.2, -0.3, 0.8, 0.9, 0.6);

  // ================================================================ fire extinguishers
  const extinguisher = (x: number, z: number, faceX: number) => {
    const Ex = node(x, 0, z, facing(faceX, 0));
    box(0.2, 0.3, 0.02, M.steel, 0, 0.62, -0.02, Ex);
    cyl(0.075, 0.075, 0.5, 16, mat('fireRed', 0xc4121c, 0.35, 0.2), 0, 0.5, 0.08, Ex);
    cyl(0.035, 0.045, 0.08, 10, M.black, 0, 0.79, 0.08, Ex);
    tube([new THREE.Vector3(0.03, 0.78, 0.1), new THREE.Vector3(0.12, 0.6, 0.14), new THREE.Vector3(0.09, 0.35, 0.13)], 0.01, M.black, Ex, 12);
    // the sign above it
    const sign = canvasTex(128, 128, (x2, w, h) => {
      x2.fillStyle = '#c4121c';
      x2.fillRect(0, 0, w, h);
      x2.fillStyle = '#fff';
      x2.fillRect(52, 30, 26, 76);
      x2.fillRect(44, 22, 42, 12);
    });
    plane(0.22, 0.22, basic(0xffffff, sign), 0, 1.2, 0.0, 0, 0, Ex);
  };
  extinguisher(-S * 4.3, 4.75, S);
  extinguisher(-S * 4.3, -3.3, S);
  extinguisher(S * 5.2, 5.05, -S);

  // ================================================================ a pedestal fan in the doorway (its rotor turns)
  let rotor: THREE.Object3D | null = null;
  {
    const F = node(-S * 3.35, 0, 4.95, facing(S * 1.3, -2.2));
    cyl(0.28, 0.3, 0.04, 20, M.satin, 0, 0.02, 0, F);
    cyl(0.025, 0.025, 1.25, 10, M.chrome, 0, 0.65, 0, F);
    const head = node(0, 1.32, 0.05, 0, F);
    add(new THREE.TorusGeometry(0.36, 0.012, 6, 40), M.chrome, 0, 0, 0.05, 0, 0, 0, head);
    add(new THREE.TorusGeometry(0.36, 0.012, 6, 40), M.chrome, 0, 0, -0.09, 0, 0, 0, head);
    for (let k = 0; k < 8; k++) box(0.006, 0.72, 0.006, M.chrome, 0, 0, 0.06, head, 0, 0, (k * Math.PI) / 8);
    cyl(0.1, 0.12, 0.16, 16, M.satin, 0, 0, -0.14, head, 0, Math.PI / 2);
    const r = new THREE.Group();
    r.position.set(0, 0, -0.02);
    head.add(r);
    r.userData.noBake = true;
    const bladeGeo = new THREE.CircleGeometry(0.32, 12, 0, 0.55);
    owned.push(bladeGeo);
    const bladeM = mat('blade', 0x2a2d33, 0.45, 0.2, { side: THREE.DoubleSide });
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(bladeGeo, bladeM);
      b.rotation.z = (k * Math.PI * 2) / 3;
      b.castShadow = true;
      r.add(b);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), M.satin);
    owned.push(hub.geometry);
    hub.rotation.x = Math.PI / 2;
    r.add(hub);
    rotor = r;
  }

  // ================================================================ gantry: cable trays, spots, the car's umbilical
  {
    for (const x of [-0.95, 0.95]) {
      box(0.28, 0.05, 14.5, M.satin, x, 3.9, -2.9);
      for (const sx of [-0.14, 0.14]) box(0.012, 0.09, 14.5, M.satin, x + sx, 3.93, -2.9);
      // bundles of cable along the tray
      for (const [ox, r] of [[-0.06, 0.02], [0.02, 0.028], [0.08, 0.016]] as const) cyl(r, r, 14.4, 6, M.hose, x + ox, 3.95, -2.9, g, 0, Math.PI / 2);
      for (let z = 3.6; z > -10; z -= 1.8) cyl(0.006, 0.006, 0.12, 4, M.steel, x, 4.0, z);
    }
    // spot fixtures along the gantry, lenses glowing
    const lens = basic(new THREE.Color(3, 2.95, 2.8));
    for (const z of [3.2, -3.1, -6.2]) {
      for (const x of [-0.95, 0.95]) {
        const Sp = node(x, 3.78, z);
        cyl(0.07, 0.09, 0.2, 14, M.black, 0, 0, 0, Sp, 0, 0.35);
        add(new THREE.CircleGeometry(0.07, 14), lens, 0, -0.1, 0.035, 0, Math.PI / 2 + 0.35, 0, Sp).castShadow = false;
      }
    }
    // the umbilical: down from the tray behind the light box, into the car
    tube([new THREE.Vector3(-S * 0.95, 3.88, -2.4), new THREE.Vector3(-S * 0.85, 2.6, -2.2), new THREE.Vector3(-S * 0.6, 1.4, -1.6), new THREE.Vector3(-S * 0.4, 0.95, -1.1)], 0.022, M.hose, g, 40);
    box(0.08, 0.06, 0.1, M.teamMatte, -S * 0.38, 0.93, -1.05);
  }

  // ================================================================ a branded panel above the tyre racks
  {
    const tex = canvasTex(2048, 384, (x2, w, h) => {
      const bg = x2.createLinearGradient(0, 0, w, 0);
      bg.addColorStop(0, '#0d0e11');
      bg.addColorStop(1, '#17191e');
      x2.fillStyle = bg;
      x2.fillRect(0, 0, w, h);
      x2.fillStyle = c.accent;
      for (let k = 0; k < 3; k++) {
        x2.beginPath();
        x2.moveTo(w - 520 + k * 120, 0);
        x2.lineTo(w - 460 + k * 120, 0);
        x2.lineTo(w - 620 + k * 120, h);
        x2.lineTo(w - 680 + k * 120, h);
        x2.fill();
      }
      x2.fillRect(0, h - 14, w, 14);
      x2.fillStyle = '#ffffff';
      x2.font = `italic 700 150px ${FONT}`;
      x2.textBaseline = 'middle';
      x2.fillText(c.team.name.toUpperCase(), 90, h / 2 + 4, w - 900);
      x2.font = `700 42px ${FONT}`;
      x2.fillStyle = 'rgba(255,255,255,0.55)';
      x2.fillText(c.team.drivers.map((d) => `${d.number}  ${d.last.toUpperCase()}`).join('      '), 96, h - 62, w - 900);
    });
    const pm = basic(new THREE.Color(1, 1, 1), tex);
    rbox(6.5, 1.28, 0.06, 0.02, M.black, -S * 4.27, 3.15, 1.0, g, facing(S, 0));
    plane(6.4, 1.2, pm, -S * 4.235, 3.15, 1.0, facing(S, 0));
  }

  // ================================================================ floor: the door's hazard line, the wheel marks
  {
    const hz = canvasTex(512, 64, (x2, w, h) => {
      x2.fillStyle = '#f2c200';
      x2.fillRect(0, 0, w, h);
      x2.fillStyle = '#111';
      for (let x = -h; x < w + h; x += 64) {
        x2.beginPath();
        x2.moveTo(x, h);
        x2.lineTo(x + 32, h);
        x2.lineTo(x + 32 + h, 0);
        x2.lineTo(x + h, 0);
        x2.fill();
      }
    });
    hz.wrapS = THREE.RepeatWrapping;
    hz.repeat.set(8.7 / 1.1, 1);
    const hm = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.4, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    owned.push(hm);
    const hmesh = plane(8.7, 0.14, hm, S * 0.15, 0.006, 5.22, 0, -Math.PI / 2);
    hmesh.receiveShadow = true;
    const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    owned.push(white);
    // L marks at each tyre's outside corners
    const wz = [1.7, -1.7];
    for (const z of wz) {
      for (const sx of [-1, 1]) {
        const x = sx * 1.12;
        for (const dz of [-0.42, 0.42]) {
          plane(0.05, 0.3, white, x, 0.006, z + dz - Math.sign(dz) * 0.13, 0, -Math.PI / 2).receiveShadow = true;
          plane(0.22, 0.05, white, x - sx * 0.085, 0.006, z + dz, 0, -Math.PI / 2).receiveShadow = true;
        }
      }
    }
  }

  return {
    update(dt: number) {
      if (rotor) rotor.rotation.z -= dt * 11;
    },
    deskCrew,
    mateCrew,
  };
}

// ==================================================================== viewpoints

export type SpotId = 'car' | 'cockpit' | 'frontWing' | 'tyres' | 'mate' | 'chests' | 'gantry' | 'wall' | 'desk' | 'door' | 'pitwall';

export interface Spot {
  id: SpotId;
  label: string;
  /** camera position, what it looks at, where its button sits (world) */
  pos: THREE.Vector3;
  look: THREE.Vector3;
  marker: THREE.Vector3;
  fov: number;
  /** the buttons shown from here */
  near: SpotId[];
  /** drag orbits the car here (instead of looking around) */
  orbit?: boolean;
  /** arrive and leave straight up/down (the cockpit) */
  vertical?: boolean;
}

/** the tour's order (next / previous) */
export const SPOT_ORDER: SpotId[] = ['car', 'cockpit', 'frontWing', 'gantry', 'chests', 'tyres', 'mate', 'desk', 'wall', 'door', 'pitwall'];

export function garageSpots(toWorld: (x: number, y: number, z: number) => THREE.Vector3, S: number, a: { cockpit: THREE.Vector3; noseZ: number; tailZ: number; wallCenter: THREE.Vector3; mate: THREE.Vector3 | null }): Record<SpotId, Spot> {
  const W = (x: number, y: number, z: number) => toWorld(x * S, y, z);
  const nz = a.noseZ;
  // the teammate's bay, across the garage (9 m over on the open side if unknown)
  const mx = a.mate ? Math.abs(a.mate.x) : 9;
  const ck = a.cockpit;
  const spot = (id: SpotId, label: string, pos: THREE.Vector3, look: THREE.Vector3, marker: THREE.Vector3, fov: number, near: SpotId[], extra: Partial<Spot> = {}): Spot => ({ id, label, pos, look, marker, fov, near, ...extra });
  return {
    car: spot('car', 'The car', W(4.2, 1.8, 3.9), W(0, 0.45, 0), W(0.95, 0.95, 0.9), 38, ['cockpit', 'frontWing', 'gantry', 'chests', 'tyres', 'mate', 'wall', 'desk', 'door'], { orbit: true }),
    cockpit: spot('cockpit', 'Cockpit', toWorld(ck.x, ck.y + 0.17, ck.z - 0.06), toWorld(ck.x, ck.y - 0.18, ck.z + 0.7), toWorld(ck.x, ck.y + 0.5, ck.z), 64, ['car', 'frontWing', 'gantry'], { vertical: true }),
    frontWing: spot('frontWing', 'Front wing', W(1.3, 0.62, nz + 1.35), W(-0.1, 0.18, nz - 0.35), W(0, 0.45, nz + 0.1), 40, ['car', 'cockpit', 'tyres', 'door']),
    gantry: spot('gantry', 'Gantry', W(1.25, 3.4, 2.9), W(0, 0.25, -0.6), W(0.95, 3.7, 0.4), 50, ['car', 'cockpit', 'wall', 'desk']),
    chests: spot('chests', 'Tool chests', W(1.35, 2.15, -1.3), W(-2.6, 0.8, -0.3), W(-2.62, 1.35, 0.1), 46, ['car', 'wall', 'tyres', 'gantry']),
    tyres: spot('tyres', 'Tyre sets', W(3.55, 1.5, 2.4), W(6.3, 0.75, 0.2), W(6.3, 1.85, 0.45), 48, ['car', 'mate', 'desk', 'door', 'chests']),
    // the teammate's car on its stands (x of the mate's bay, measured on the open side)
    mate: spot('mate', 'Second car', W(mx + 2.4, 1.85, 4.0), W(mx - 0.1, 0.4, -0.3), W(mx, 1.45, 0), 46, ['tyres', 'car', 'desk', 'door']),
    desk: spot('desk', 'Telemetry desk', W(3.45, 1.78, -4.85), W(3.45, 1.35, -7.35), W(3.45, 2.1, -7.25), 44, ['car', 'wall', 'tyres', 'gantry']),
    wall: spot('wall', 'Video wall', W(0.2, 2.1, -1.4), a.wallCenter.clone(), a.wallCenter.clone().add(new THREE.Vector3(0, 1.45, 0)), 44, ['car', 'desk', 'chests', 'gantry']),
    door: spot('door', 'Pit lane', W(-0.6, 1.65, 5.6), W(-6, 1.25, 16), W(0.4, 2.3, 5.6), 55, ['pitwall', 'car', 'frontWing', 'tyres']),
    pitwall: spot('pitwall', 'Pit wall', W(6.2, 2.3, 17.2), W(8.2, 1.4, 22.5), W(7.4, 3.0, 20.2), 50, ['door', 'car']),
  };
}
