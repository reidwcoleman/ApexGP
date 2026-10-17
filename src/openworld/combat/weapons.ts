import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The guns: what each one does and its model. Generic designs (no makers' names or marks) at real
 * size, built from side profiles extruded to their width with softened edges, so the slide, the
 * receiver, the stock read as machined and moulded parts rather than boxes.
 *
 * Model frame: +z down the barrel, +y up, origin in the shooting hand's grip. `muzzle` and `eject`
 * (the ejection port) are points in that frame; `support` is where the other hand goes.
 */

export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'launcher';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  /** damage per hit (per pellet for the shotgun) */
  damage: number;
  /** rounds per minute */
  rpm: number;
  auto: boolean;
  mag: number;
  /** spare rounds you start with / most you can carry */
  start: number;
  max: number;
  reload: number;
  /** cone (radians): hip fire / aimed */
  spreadHip: number;
  spreadAim: number;
  pellets: number;
  range: number;
  /** camera kick per shot (rad) */
  recoil: number;
  /** two-handed long gun (shouldered) */
  long: boolean;
  /** aimed field of view */
  aimFov: number;
  /** usable from a car window */
  driveBy: boolean;
  /** shell casing size (0: none) */
  casing: number;
  /** a shot's loudness (how far people hear it, m) */
  loud: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { id: 'pistol', name: 'Pistol', damage: 34, rpm: 380, auto: false, mag: 17, start: 102, max: 340, reload: 1.3, spreadHip: 0.022, spreadAim: 0.006, pellets: 1, range: 140, recoil: 0.035, long: false, aimFov: 48, driveBy: true, casing: 0.9, loud: 160 },
  smg: { id: 'smg', name: 'SMG', damage: 24, rpm: 900, auto: true, mag: 30, start: 180, max: 600, reload: 1.6, spreadHip: 0.04, spreadAim: 0.016, pellets: 1, range: 110, recoil: 0.018, long: false, aimFov: 46, driveBy: true, casing: 0.9, loud: 170 },
  rifle: { id: 'rifle', name: 'Carbine', damage: 40, rpm: 700, auto: true, mag: 30, start: 210, max: 600, reload: 2.0, spreadHip: 0.03, spreadAim: 0.004, pellets: 1, range: 420, recoil: 0.028, long: true, aimFov: 40, driveBy: false, casing: 1.2, loud: 260 },
  shotgun: { id: 'shotgun', name: 'Shotgun', damage: 17, rpm: 75, auto: false, mag: 8, start: 48, max: 120, reload: 2.6, spreadHip: 0.075, spreadAim: 0.055, pellets: 9, range: 55, recoil: 0.09, long: true, aimFov: 48, driveBy: false, casing: 1.6, loud: 230 },
  sniper: { id: 'sniper', name: 'Marksman rifle', damage: 160, rpm: 50, auto: false, mag: 5, start: 30, max: 90, reload: 2.8, spreadHip: 0.05, spreadAim: 0.0, pellets: 1, range: 1200, recoil: 0.07, long: true, aimFov: 11, driveBy: false, casing: 1.5, loud: 420 },
  launcher: { id: 'launcher', name: 'Rocket launcher', damage: 0, rpm: 40, auto: false, mag: 1, start: 10, max: 20, reload: 2.4, spreadHip: 0.02, spreadAim: 0.004, pellets: 1, range: 600, recoil: 0.06, long: true, aimFov: 44, driveBy: false, casing: 0, loud: 300 },
};

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'launcher'];

// ------------------------------------------------------------------------------------ materials

const mats = new Map<string, THREE.Material>();
const M = (k: string, f: () => THREE.Material) => {
  let m = mats.get(k);
  if (!m) mats.set(k, (m = f()));
  return m;
};

let knurlTex: THREE.CanvasTexture | null = null;
/** a stippled grip texture (bump) */
function knurl(): THREE.CanvasTexture {
  if (knurlTex) return knurlTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4)
    for (let x = (y / 4) % 2 ? 2 : 0; x < 64; x += 4) {
      g.fillStyle = '#d0d0d0';
      g.fillRect(x, y, 2, 2);
    }
  knurlTex = new THREE.CanvasTexture(c);
  knurlTex.wrapS = knurlTex.wrapT = THREE.RepeatWrapping;
  knurlTex.repeat.set(24, 24);
  return knurlTex;
}

export const GUN_MAT = {
  steel: () => M('steel', () => new THREE.MeshStandardMaterial({ color: 0x23262a, metalness: 0.85, roughness: 0.34 })),
  bright: () => M('bright', () => new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 1, roughness: 0.22 })),
  polymer: () => M('polymer', () => new THREE.MeshStandardMaterial({ color: 0x161719, metalness: 0.05, roughness: 0.62, bumpMap: knurl(), bumpScale: 0.6 })),
  tan: () => M('tan', () => new THREE.MeshStandardMaterial({ color: 0x8b7a5a, metalness: 0.05, roughness: 0.66, bumpMap: knurl(), bumpScale: 0.4 })),
  olive: () => M('olive', () => new THREE.MeshStandardMaterial({ color: 0x4a4d36, metalness: 0.1, roughness: 0.6 })),
  wood: () => M('wood', () => new THREE.MeshStandardMaterial({ color: 0x5a3519, metalness: 0, roughness: 0.48 })),
  rubber: () => M('rubber', () => new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.9 })),
  lens: () => M('lens', () => new THREE.MeshPhysicalMaterial({ color: 0x1b3d52, metalness: 0.4, roughness: 0.05, clearcoat: 1, emissive: 0x0a2233, emissiveIntensity: 0.6 })),
  dot: () => M('dot', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.2) })),
  brass: () => M('brass', () => new THREE.MeshStandardMaterial({ color: 0xc9a046, metalness: 1, roughness: 0.3 })),
  warhead: () => M('warhead', () => new THREE.MeshStandardMaterial({ color: 0x3f4a2e, metalness: 0.3, roughness: 0.5 })),
};

// ------------------------------------------------------------------------------------ builders

class Kit {
  readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, m: THREE.Material) {
    let l = this.parts.get(m);
    if (!l) this.parts.set(m, (l = []));
    l.push(g.index ? g.toNonIndexed() : g);
  }
  /** a side profile [z, y] extruded `w` wide (centred on x), edges softened */
  profile(pts: [number, number][], w: number, m: THREE.Material, x = 0, bevel = 0.0025) {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const b = Math.min(bevel, w * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, w - 2 * b), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(-Math.PI / 2);
    g.translate(x + w / 2 - b, 0, 0);
    this.add(g, m);
    return g;
  }
  box(w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, l);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    this.add(g, m);
  }
  /** a cylinder along z from z0 to z1 */
  tube(r0: number, r1: number, z0: number, z1: number, y: number, m: THREE.Material, x = 0, seg = 16, open = false) {
    const g = new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, (z0 + z1) / 2);
    this.add(g, m);
  }
  /** a hollow muzzle: a tube with a dark bore */
  muzzle(r: number, z: number, y: number, len: number) {
    this.tube(r, r, z - len, z, y, GUN_MAT.steel(), 0, 18);
    const bore = new THREE.CircleGeometry(r * 0.55, 14);
    bore.translate(0, y, z + 0.0005);
    this.add(bore, GUN_MAT.rubber());
  }
  build(name: string): THREE.Group {
    const grp = new THREE.Group();
    grp.name = name;
    for (const [m, list] of this.parts) {
      for (const g of list) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      const merged = mergeGeometries(list);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = true;
      grp.add(mesh);
    }
    return grp;
  }
}

export interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  eject: THREE.Vector3;
  support: THREE.Vector3;
  /** the launcher's rocket (hidden when fired) */
  round?: THREE.Object3D;
}

/** a polymer-frame pistol: slide with serrations and sights, accessory rail, stippled grip */
function pistol(): GunModel {
  const k = new Kit();
  const S = GUN_MAT.steel(), P = GUN_MAT.polymer();
  // the grip, raked back
  k.profile([[-0.03, -0.1], [0.012, -0.105], [0.028, 0.0], [0.03, 0.022], [-0.046, 0.022], [-0.05, 0.005], [-0.044, -0.02]], 0.03, P);
  // the frame and trigger guard, dust cover rail
  k.profile([[-0.05, 0.02], [0.13, 0.02], [0.135, 0.032], [-0.05, 0.034]], 0.028, P);
  k.profile([[0.012, 0.02], [0.016, -0.012], [0.06, -0.014], [0.07, 0.0], [0.07, 0.02], [0.06, 0.02], [0.058, 0.004], [0.022, 0.004], [0.02, 0.02]], 0.012, P);
  k.box(0.004, 0.022, 0.008, 0, 0.006, 0.036, GUN_MAT.bright());
  for (let i = 0; i < 3; i++) k.box(0.03, 0.004, 0.008, 0, 0.026, 0.095 + i * 0.013, P);
  // the slide (a little narrower at the top), serrations at the back
  k.profile([[-0.055, 0.034], [0.15, 0.034], [0.152, 0.06], [0.146, 0.066], [-0.05, 0.066], [-0.056, 0.058]], 0.027, S);
  for (let i = 0; i < 8; i++) k.box(0.028, 0.026, 0.0025, 0, 0.05, -0.044 + i * 0.006, GUN_MAT.rubber());
  // ejection port, sights
  k.box(0.012, 0.012, 0.035, -0.009, 0.06, 0.03, GUN_MAT.bright());
  k.box(0.006, 0.008, 0.006, 0, 0.07, 0.138, S);
  k.box(0.02, 0.008, 0.008, 0, 0.07, -0.046, S);
  k.muzzle(0.0065, 0.153, 0.05, 0.01);
  const g = k.build('pistol');
  return { group: g, muzzle: new THREE.Vector3(0, 0.05, 0.155), eject: new THREE.Vector3(-0.016, 0.062, 0.03), support: new THREE.Vector3(0.0, -0.02, 0.0) };
}

/** a compact SMG: boxy receiver, straight mag in the grip's front, folding wire stock, short barrel */
function smg(): GunModel {
  const k = new Kit();
  const S = GUN_MAT.steel(), P = GUN_MAT.polymer();
  k.profile([[-0.03, -0.1], [0.014, -0.104], [0.026, 0.0], [0.026, 0.02], [-0.04, 0.02], [-0.04, -0.02]], 0.03, P);
  // receiver
  k.profile([[-0.12, 0.02], [0.2, 0.02], [0.21, 0.035], [0.2, 0.085], [-0.1, 0.085], [-0.12, 0.07]], 0.04, S, 0, 0.004);
  // the top rail and a small red dot
  k.box(0.022, 0.008, 0.22, 0, 0.09, 0.04, S);
  for (let i = 0; i < 11; i++) k.box(0.024, 0.004, 0.006, 0, 0.096, -0.06 + i * 0.02, S);
  k.tube(0.014, 0.014, 0.03, 0.07, 0.115, S);
  k.box(0.02, 0.016, 0.04, 0, 0.1, 0.05, S);
  const lens = new THREE.CircleGeometry(0.011, 16);
  lens.rotateY(Math.PI);
  lens.translate(0, 0.115, 0.029);
  k.add(lens, GUN_MAT.lens());
  // the magazine through the grip
  k.profile([[-0.012, 0.02], [0.022, 0.02], [0.03, -0.17], [0.0, -0.175]], 0.028, S);
  // foregrip under the barrel shroud, the barrel and a compensator
  k.profile([[0.11, 0.02], [0.15, 0.02], [0.148, -0.07], [0.124, -0.072]], 0.026, P);
  k.tube(0.018, 0.018, 0.2, 0.27, 0.058, S);
  k.muzzle(0.013, 0.3, 0.058, 0.03);
  // trigger guard + trigger
  k.profile([[0.026, 0.02], [0.03, -0.006], [0.08, -0.01], [0.09, 0.02], [0.08, 0.02], [0.074, 0.004], [0.036, 0.004], [0.034, 0.02]], 0.012, P);
  // folding stock (wire): two rods and a butt plate
  for (const x of [0.016, -0.016]) k.tube(0.004, 0.004, -0.33, -0.12, 0.05, S, x, 8);
  k.profile([[-0.36, -0.03], [-0.33, -0.03], [-0.33, 0.085], [-0.36, 0.085]], 0.04, GUN_MAT.rubber());
  // charging handle
  k.box(0.04, 0.012, 0.012, 0.03, 0.07, 0.15, S);
  const g = k.build('smg');
  return { group: g, muzzle: new THREE.Vector3(0, 0.058, 0.305), eject: new THREE.Vector3(-0.022, 0.07, 0.05), support: new THREE.Vector3(0, -0.04, 0.14) };
}

/** a carbine: collapsible stock, flat-top upper with an optic, free-float rail handguard, curved mag */
function rifle(): GunModel {
  const k = new Kit();
  const S = GUN_MAT.steel(), P = GUN_MAT.polymer(), T = GUN_MAT.tan();
  // pistol grip
  k.profile([[-0.035, -0.095], [0.008, -0.1], [0.022, 0.0], [0.024, 0.02], [-0.04, 0.02], [-0.045, -0.01]], 0.03, T);
  // lower receiver with the mag well and trigger guard
  k.profile([[-0.08, 0.02], [0.17, 0.02], [0.17, 0.06], [-0.08, 0.06]], 0.034, S, 0, 0.003);
  k.profile([[0.07, 0.02], [0.16, 0.02], [0.155, -0.02], [0.075, -0.02]], 0.036, S, 0, 0.003);
  k.profile([[0.022, 0.02], [0.026, -0.008], [0.068, -0.01], [0.07, 0.02], [0.062, 0.02], [0.06, 0.004], [0.03, 0.004], [0.03, 0.02]], 0.012, S);
  // curved magazine
  const mag: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    mag.push([0.078 + 0.05 * t * t, -0.02 - 0.2 * t]);
  }
  for (let i = 8; i >= 0; i--) {
    const t = i / 8;
    mag.push([0.152 + 0.055 * t * t, -0.02 - 0.2 * t]);
  }
  k.profile(mag, 0.03, T);
  // upper receiver, forward assist, ejection port, charging handle
  k.profile([[-0.08, 0.06], [0.2, 0.06], [0.2, 0.1], [-0.07, 0.1], [-0.08, 0.09]], 0.034, S, 0, 0.003);
  k.tube(0.009, 0.009, 0.02, 0.06, 0.08, S, 0.022, 10);
  k.box(0.004, 0.016, 0.05, -0.0175, 0.08, 0.06, GUN_MAT.bright());
  k.box(0.03, 0.01, 0.03, 0, 0.105, -0.065, S);
  // the top rail
  k.box(0.022, 0.01, 0.6, 0, 0.105, 0.2, S);
  for (let i = 0; i < 30; i++) k.box(0.024, 0.005, 0.008, 0, 0.112, -0.08 + i * 0.02, S);
  // handguard (an octagonal tube) with slots
  {
    const g = new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8, 1, false);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 8);
    g.translate(0, 0.075, 0.36);
    k.add(g, P);
    for (let i = 0; i < 5; i++) for (const x of [0.029, -0.029]) k.box(0.004, 0.01, 0.035, x, 0.075, 0.24 + i * 0.055, GUN_MAT.rubber());
  }
  // barrel, gas block, flash hider
  k.tube(0.0095, 0.0095, 0.52, 0.66, 0.075, S, 0, 12);
  k.muzzle(0.012, 0.71, 0.075, 0.05);
  for (let i = 0; i < 4; i++) k.box(0.002, 0.024, 0.02, 0.012 * Math.cos(i * 1.57), 0.075 + 0.012 * Math.sin(i * 1.57), 0.7, GUN_MAT.rubber());
  // the optic: a holographic box sight
  k.profile([[0.02, 0.11], [0.12, 0.11], [0.12, 0.165], [0.1, 0.17], [0.03, 0.17], [0.02, 0.16]], 0.04, S, 0, 0.004);
  {
    const lens = new THREE.PlaneGeometry(0.03, 0.04);
    lens.translate(0, 0.142, 0.121);
    k.add(lens, GUN_MAT.lens());
  }
  k.box(0.004, 0.004, 0.002, 0, 0.142, 0.03, GUN_MAT.dot());
  // buffer tube and the stock
  k.tube(0.016, 0.016, -0.3, -0.08, 0.07, S, 0, 14);
  k.profile([[-0.33, -0.02], [-0.18, 0.04], [-0.17, 0.1], [-0.33, 0.11], [-0.34, 0.1], [-0.34, -0.015]], 0.042, T, 0, 0.005);
  k.box(0.044, 0.135, 0.02, 0, 0.045, -0.345, GUN_MAT.rubber());
  // front sight post (folded)
  k.box(0.012, 0.016, 0.02, 0, 0.118, 0.5, S);
  const g = k.build('rifle');
  return { group: g, muzzle: new THREE.Vector3(0, 0.075, 0.715), eject: new THREE.Vector3(-0.02, 0.08, 0.06), support: new THREE.Vector3(0, 0.03, 0.34) };
}

/** a pump shotgun: wood stock and fore-end, tube magazine, bead sight */
function shotgun(): GunModel {
  const k = new Kit();
  const S = GUN_MAT.steel(), W = GUN_MAT.wood();
  // stock with a pistol-ish wrist, butt pad
  k.profile([[-0.42, -0.09], [-0.12, -0.03], [-0.04, -0.04], [-0.0, 0.0], [0.0, 0.05], [-0.06, 0.05], [-0.42, 0.06], [-0.43, 0.04]], 0.04, W, 0, 0.006);
  k.box(0.044, 0.155, 0.02, 0, -0.015, -0.435, GUN_MAT.rubber(), -0.1);
  // receiver
  k.profile([[-0.01, -0.03], [0.2, -0.03], [0.2, 0.06], [0.02, 0.06], [-0.01, 0.04]], 0.04, S, 0, 0.004);
  k.box(0.004, 0.025, 0.07, -0.0205, 0.025, 0.1, GUN_MAT.rubber());
  // trigger guard
  k.profile([[0.02, -0.03], [0.024, -0.06], [0.09, -0.062], [0.1, -0.03], [0.09, -0.03], [0.086, -0.05], [0.032, -0.05], [0.03, -0.03]], 0.012, S);
  // barrel and the magazine tube under it; the pump
  k.tube(0.012, 0.012, 0.2, 0.72, 0.035, S, 0, 16);
  k.muzzle(0.0125, 0.722, 0.035, 0.01);
  k.tube(0.011, 0.011, 0.2, 0.64, 0.0, S, 0, 14);
  k.profile([[0.3, -0.02], [0.5, -0.02], [0.5, 0.022], [0.3, 0.022]], 0.045, W, 0, 0.008);
  for (let i = 0; i < 6; i++) k.box(0.047, 0.003, 0.004, 0, 0.0, 0.32 + i * 0.03, GUN_MAT.rubber());
  k.tube(0.003, 0.003, 0.71, 0.72, 0.05, GUN_MAT.bright(), 0, 8);
  // the rib along the top
  k.box(0.008, 0.005, 0.5, 0, 0.049, 0.46, S);
  const g = k.build('shotgun');
  return { group: g, muzzle: new THREE.Vector3(0, 0.035, 0.725), eject: new THREE.Vector3(-0.022, 0.03, 0.1), support: new THREE.Vector3(0, -0.02, 0.4) };
}

/** a bolt-action marksman rifle: long fluted barrel, a big scope, bipod folded, thumbhole stock */
function sniper(): GunModel {
  const k = new Kit();
  const S = GUN_MAT.steel(), O = GUN_MAT.olive();
  k.profile([[-0.5, -0.08], [-0.2, -0.03], [-0.05, -0.1], [0.0, -0.1], [0.03, 0.0], [0.4, -0.01], [0.42, 0.03], [-0.05, 0.05], [-0.5, 0.07], [-0.51, 0.04]], 0.05, O, 0, 0.007);
  k.box(0.052, 0.15, 0.025, 0, -0.005, -0.51, GUN_MAT.rubber());
  // receiver and bolt
  k.tube(0.02, 0.02, -0.06, 0.2, 0.065, S, 0, 18);
  k.tube(0.007, 0.007, 0.03, 0.03, 0.065, S, 0, 8);
  k.box(0.07, 0.01, 0.01, -0.035, 0.065, -0.02, S);
  {
    const knob = new THREE.SphereGeometry(0.012, 10, 8);
    knob.translate(-0.072, 0.065, -0.02);
    k.add(knob, S);
  }
  // trigger guard, a detachable mag
  k.profile([[0.0, 0.0], [0.004, -0.03], [0.06, -0.032], [0.07, 0.0]], 0.012, S);
  k.profile([[0.09, -0.01], [0.17, -0.01], [0.165, -0.07], [0.095, -0.07]], 0.034, S);
  // barrel (tapered) and a muzzle brake
  k.tube(0.016, 0.011, 0.2, 0.95, 0.065, S, 0, 16);
  k.profile([[0.95, 0.05], [1.02, 0.05], [1.02, 0.08], [0.95, 0.08]], 0.032, S, 0, 0.004);
  k.box(0.034, 0.008, 0.01, 0, 0.065, 0.985, GUN_MAT.rubber());
  // the scope: tube, bells, turrets, lenses, rings
  k.tube(0.015, 0.015, -0.05, 0.25, 0.135, S, 0, 20);
  k.tube(0.015, 0.025, 0.25, 0.32, 0.135, S, 0, 20);
  k.tube(0.025, 0.025, 0.32, 0.36, 0.135, S, 0, 20);
  k.tube(0.02, 0.015, -0.1, -0.05, 0.135, S, 0, 20);
  k.tube(0.02, 0.02, -0.13, -0.1, 0.135, GUN_MAT.rubber(), 0, 20);
  k.tube(0.012, 0.012, 0.08, 0.12, 0.17, S, 0, 12);
  {
    const t = new THREE.CylinderGeometry(0.012, 0.012, 0.04, 12);
    t.rotateZ(Math.PI / 2);
    t.translate(0.03, 0.135, 0.1);
    k.add(t, S);
  }
  for (const z of [0.02, 0.2]) k.box(0.04, 0.05, 0.02, 0, 0.1, z, S);
  {
    const l = new THREE.CircleGeometry(0.023, 20);
    l.translate(0, 0.135, 0.3605);
    k.add(l, GUN_MAT.lens());
    const r = new THREE.CircleGeometry(0.018, 20);
    r.rotateY(Math.PI);
    r.translate(0, 0.135, -0.1305);
    k.add(r, GUN_MAT.lens());
  }
  // the bipod, folded under the fore-end
  for (const x of [0.012, -0.012]) k.tube(0.005, 0.005, 0.2, 0.38, -0.025, S, x, 8);
  const g = k.build('sniper');
  return { group: g, muzzle: new THREE.Vector3(0, 0.065, 1.02), eject: new THREE.Vector3(-0.025, 0.07, 0.08), support: new THREE.Vector3(0, -0.02, 0.32) };
}

/** a shoulder-fired launcher: the tube, grips, optic, and the rocket's warhead in the muzzle */
function launcher(): GunModel {
  const k = new Kit();
  const S = GUN_MAT.steel(), O = GUN_MAT.olive();
  k.tube(0.045, 0.045, -0.55, 0.55, 0.11, O, 0, 22, true);
  {
    // the inside of the tube, dark
    const g = new THREE.CylinderGeometry(0.042, 0.042, 1.1, 22, 1, true);
    g.rotateX(Math.PI / 2);
    g.scale(-1, 1, 1);
    g.translate(0, 0.11, 0);
    k.add(g, GUN_MAT.rubber());
  }
  k.tube(0.06, 0.05, -0.62, -0.55, 0.11, S, 0, 22, true);
  k.tube(0.05, 0.05, 0.55, 0.58, 0.11, S, 0, 22, true);
  k.tube(0.05, 0.05, -0.12, 0.05, 0.11, GUN_MAT.rubber(), 0, 22);
  // grips
  k.profile([[-0.03, -0.1], [0.012, -0.104], [0.026, 0.0], [0.03, 0.07], [-0.03, 0.07]], 0.03, GUN_MAT.polymer());
  k.profile([[0.27, -0.06], [0.31, -0.06], [0.31, 0.07], [0.27, 0.07]], 0.028, GUN_MAT.polymer());
  // the optic on the left
  k.profile([[0.0, 0.14], [0.14, 0.14], [0.14, 0.21], [0.0, 0.21]], 0.03, S, 0.07, 0.004);
  {
    const l = new THREE.CircleGeometry(0.018, 14);
    l.translate(0.07, 0.175, 0.1405);
    k.add(l, GUN_MAT.lens());
  }
  const g = k.build('launcher');
  // the rocket's nose cone in the muzzle (hidden once fired)
  const round = rocketMesh();
  round.position.set(0, 0.11, 0.6);
  g.add(round);
  return { group: g, muzzle: new THREE.Vector3(0, 0.11, 0.62), eject: new THREE.Vector3(0, 0.11, -0.6), support: new THREE.Vector3(0, 0.0, 0.29), round };
}

/** a rocket: the warhead, a body, fins (for the flight, and the one in the tube) */
export function rocketMesh(): THREE.Group {
  const k = new Kit();
  const W = GUN_MAT.warhead(), S = GUN_MAT.steel();
  const nose = new THREE.LatheGeometry([0, 0.012, 0.03, 0.044, 0.044, 0.02].map((r, i) => new THREE.Vector2(r, [0.2, 0.19, 0.14, 0.07, 0.0, -0.02][i])), 18);
  nose.rotateX(Math.PI / 2);
  k.add(nose, W);
  k.tube(0.02, 0.02, -0.38, -0.02, 0, S, 0, 12);
  for (let i = 0; i < 6; i++) {
    const f = new THREE.BoxGeometry(0.002, 0.04, 0.08);
    f.translate(0, 0.035, -0.34);
    f.rotateZ((i / 6) * Math.PI * 2);
    k.add(f, S);
  }
  return k.build('rocket');
}

const builders: Record<WeaponId, () => GunModel> = { pistol, smg, rifle, shotgun, sniper, launcher };

export function buildGun(id: WeaponId): GunModel {
  return builders[id]();
}

/** a spent case (instanced by the combat module) */
export function casingGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8, 1);
  g.rotateX(Math.PI / 2);
  return g;
}
