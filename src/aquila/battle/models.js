// Procedural soldier models. Each model is one merged geometry whose vertices carry
// a body-part id + pivot, so the GPU animates legs, weapon arm, shield arm and
// horse/elephant legs per instance (walk phase, attack swing) without skinning.
import * as THREE from 'three';

const C = {
  skin: '#d09c74', skinDark: '#7a4e31', mail: '#7f8389', bronze: '#b8893e', steel: '#a9aeb5', linen: '#e8e0cb', leather: '#7a5434', scale: '#a08850',
  wood: '#6b4a2b', dark: '#2a221b', iron: '#8d9196', gold: '#d8b24a', trousers: '#6a5140', hair: '#7a4b22', horse: '#5b3b22', horse2: '#3d2a1c', ele: '#7c756e', white: '#f2ede2',
  red: '#a3161c', black: '#1c1a18', fur: '#5d4630', team: '#ffffff',
};

class GB {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.part = []; this.piv = []; this.mask = []; this.metal = []; }
  add(geo, { part = 0, pivot = [0, 0, 0], color = '#fff', mask = 0, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] }) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s));
    g.applyMatrix4(m);
    const P = g.attributes.position, N = g.attributes.normal;
    const c = new THREE.Color(color);
    // skin and hair get per-soldier variety; armour and blades are metallic
    if (mask === 0 && (color === C.skin || color === C.skinDark)) mask = 0.3;
    if (mask === 0 && color === C.hair) mask = 0.2;
    const metal = METAL[color] ?? 0;
    for (let i = 0; i < P.count; i++) {
      this.metal.push(metal);
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      this.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.part.push(part);
      this.piv.push(...pivot);
      this.mask.push(mask);
    }
    g.dispose();
  }
  box(o, size) { this.add(new THREE.BoxGeometry(...size), o); }
  cyl(o, rt, rb, h, seg = 8) { this.add(new THREE.CylinderGeometry(rt, rb, h, seg), o); }
  sph(o, r, ws = 8, hs = 6, phiLen = Math.PI * 2, thetaLen = Math.PI) { this.add(new THREE.SphereGeometry(r, ws, hs, 0, phiLen, 0, thetaLen), o); }
  cone(o, r, h, seg = 8) { this.add(new THREE.ConeGeometry(r, h, seg), o); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.mask, 1));
    g.setAttribute('aMetal', new THREE.Float32BufferAttribute(this.metal, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const METAL = { [C.mail]: 0.75, [C.bronze]: 0.9, [C.steel]: 0.95, [C.iron]: 0.85, [C.gold]: 1, [C.scale]: 0.7, '#6f747b': 0.9 };
const ARMOR = { mail: C.mail, bronze: C.bronze, segmentata: C.steel, linen: C.linen, leather: C.leather, scale: C.scale };

// A human, standing (or seated on a mount when `rider` is set). Facing +z; right hand at -x.
function human(b, look, { y = 0, rider = false, noArms = false } = {}) {
  const skin = look.skin === 'dark' ? C.skinDark : C.skin;
  const legC = look.hair ? C.trousers : skin;
  if (!rider) {
    for (const [part, x] of [[1, 0.1], [2, -0.1]]) {
      const pivot = [x, 0.84 + y, 0];
      b.cyl({ part, pivot, color: legC, p: [x, 0.46 + y, 0] }, 0.078, 0.06, 0.78, 7);
      b.box({ part, pivot, color: C.dark, p: [x, 0.05 + y, 0.04] }, [0.13, 0.1, 0.25]);
      if (look.armor === 'bronze' && !look.hair) b.box({ part, pivot, color: C.bronze, p: [x, 0.3 + y, 0.02] }, [0.155, 0.34, 0.16]);
    }
  } else {
    for (const x of [0.2, -0.2]) {
      b.box({ color: legC, p: [x, y - 0.12, 0.08], r: [0.3, 0, x > 0 ? -0.25 : 0.25] }, [0.14, 0.62, 0.15]);
      b.box({ color: C.dark, p: [x * 1.25, y - 0.45, 0.18] }, [0.12, 0.1, 0.22]);
    }
  }
  // tunic skirt + torso
  b.cyl({ color: C.team, mask: 1, p: [0, 0.93 + y, 0], s: [1, 1, 0.68] }, 0.22, 0.28, 0.3, 10);
  const arm = ARMOR[look.armor];
  b.cyl({ color: arm || C.team, mask: arm ? 0 : 1, p: [0, 1.2 + y, 0], s: [1, 1, 0.64] }, 0.25, 0.21, 0.48, 10);
  for (const x of [0.2, -0.2]) b.sph({ color: arm || C.team, mask: arm ? 0 : 1, p: [x, 1.38 + y, 0] }, 0.085, 8, 6);
  if (look.armor === 'segmentata') for (let k = 0; k < 3; k++) b.cyl({ color: '#6f747b', p: [0, 1.06 + k * 0.12 + y, 0], s: [1, 1, 0.66] }, 0.235 - k * 0.01 + 0.012, 0.235 - k * 0.01 + 0.012, 0.025, 10);
  if (look.armor === 'linen' || look.armor === 'segmentata' || look.armor === 'scale') for (const x of [0.22, -0.22]) b.box({ color: arm, p: [x, 1.4 + y, 0] }, [0.16, 0.08, 0.28]);
  b.cyl({ color: '#4a3622', p: [0, 1.0 + y, 0], s: [1, 1, 0.68] }, 0.24, 0.24, 0.06, 10);
  if (look.armor === 'none' && look.hair) b.cyl({ color: skin, p: [0, 1.3 + y, 0.02], s: [1, 1, 0.62] }, 0.2, 0.2, 0.2, 10); // bare chest under open tunic
  // head
  b.box({ color: skin, p: [0, 1.46 + y, 0] }, [0.1, 0.1, 0.1]);
  b.sph({ color: skin, p: [0, 1.6 + y, 0.01] }, 0.115, 10, 8);
  if (look.hair && look.helmet === 'none') {
    b.sph({ color: C.hair, p: [0, 1.64 + y, -0.03] }, 0.125, 10, 8);
    b.box({ color: C.hair, p: [0, 1.48 + y, -0.08] }, [0.2, 0.22, 0.08]);
  }
  helmet(b, look, 1.6 + y);
  // cape
  if (look.cape) b.box({ color: C.team, mask: 1, p: [0, 1.0 + y + (rider ? 0.05 : 0), -0.17], r: [0.12, 0, 0] }, [0.5, 0.95, 0.04]);
  if (noArms) return;
  // weapon arm (part 3) and shield arm (part 4)
  const sh = 1.38 + y;
  const pr = [-0.27, sh, 0], pl = [0.27, sh, 0];
  const sleeve = arm && look.armor !== 'leather' ? arm : skin;
  b.cyl({ part: 3, pivot: pr, color: sleeve, p: [-0.28, sh - 0.14, 0.04], r: [-0.3, 0, 0] }, 0.062, 0.055, 0.28, 6);
  b.cyl({ part: 3, pivot: pr, color: skin, p: [-0.28, sh - 0.36, 0.17], r: [-0.9, 0, 0] }, 0.052, 0.045, 0.28, 6);
  const hand = [-0.28, sh - 0.44, 0.3];
  weapon(b, look, hand, pr, y);
  b.cyl({ part: 4, pivot: pl, color: sleeve, p: [0.28, sh - 0.14, 0.04], r: [-0.3, 0, 0] }, 0.062, 0.055, 0.28, 6);
  b.cyl({ part: 4, pivot: pl, color: skin, p: [0.28, sh - 0.34, 0.18], r: [-1.1, 0, 0] }, 0.052, 0.045, 0.26, 6);
  shield(b, look, pl, y);
}

function helmet(b, look, hy) {
  const H = look.helmet;
  const met = { montefortino: C.bronze, imperial: C.steel, corinthian: C.bronze, attic: C.bronze, boeotian: C.bronze, thracian: C.bronze, conical: C.iron, pilos: C.bronze, celtic: C.iron }[H];
  if (H === 'none' || !H) return;
  if (H === 'phrygian') { b.cone({ color: C.team, mask: 1, p: [0, hy + 0.12, 0.04], r: [0.35, 0, 0] }, 0.13, 0.3, 8); return; }
  if (H === 'wolf') { b.sph({ color: C.fur, p: [0, hy + 0.02, -0.01] }, 0.135, 10, 6, Math.PI * 2, Math.PI * 0.6); b.box({ color: C.fur, p: [0, hy - 0.2, -0.1] }, [0.3, 0.35, 0.06]); return; }
  if (H === 'conical' || H === 'pilos') { b.cone({ color: met, p: [0, hy + 0.12, 0] }, 0.13, H === 'conical' ? 0.3 : 0.2, 10); b.cyl({ color: met, p: [0, hy + 0.01, 0] }, 0.128, 0.128, 0.06, 10); return; }
  b.sph({ color: met, p: [0, hy + 0.01, 0] }, 0.132, 10, 6, Math.PI * 2, Math.PI * 0.55);
  if (H === 'corinthian') { b.box({ color: met, p: [0, hy - 0.06, 0.02] }, [0.27, 0.2, 0.26]); b.box({ color: C.dark, p: [0, hy - 0.02, 0.15] }, [0.16, 0.03, 0.01]); }
  if (H === 'montefortino' || H === 'imperial' || H === 'attic') for (const x of [0.12, -0.12]) b.box({ color: met, p: [x, hy - 0.08, 0.04] }, [0.03, 0.13, 0.1]);
  if (H === 'imperial') { b.box({ color: met, p: [0, hy - 0.08, -0.13], r: [0.4, 0, 0] }, [0.27, 0.04, 0.12]); b.box({ color: met, p: [0, hy + 0.02, 0.13] }, [0.24, 0.03, 0.03]); }
  if (H === 'montefortino' || H === 'celtic') b.cone({ color: met, p: [0, hy + 0.15, 0] }, 0.025, 0.06, 6);
  if (H === 'boeotian') b.cyl({ color: met, p: [0, hy - 0.02, 0] }, 0.22, 0.22, 0.025, 12);
  if (H === 'thracian') b.cone({ color: met, p: [0, hy + 0.14, 0.05], r: [0.6, 0, 0] }, 0.07, 0.16, 8);
  const cr = look.crest;
  if (cr && cr !== 'none') {
    const cc = cr === 'red' ? C.red : cr === 'white' ? C.white : C.black;
    if (cr === 'feathers') for (const x of [-0.05, 0, 0.05]) b.box({ color: x === 0 ? C.black : C.red, p: [x, hy + 0.27, 0] }, [0.025, 0.3, 0.03]);
    else b.box({ color: cc, p: [0, hy + 0.17, -0.01] }, [0.05, 0.13, 0.3]);
  }
}

function weapon(b, look, hand, pv, y) {
  const W = look.weapon;
  const o = (color, p, r = [0, 0, 0]) => ({ part: 3, pivot: pv, color, p, r });
  const [hx, hy, hz] = hand;
  if (W === 'gladius') { b.box(o(C.steel, [hx, hy + 0.02, hz + 0.32]), [0.05, 0.02, 0.5]); b.box(o(C.dark, [hx, hy, hz + 0.02]), [0.1, 0.05, 0.05]); }
  else if (W === 'sword') { b.box(o(C.steel, [hx, hy + 0.02, hz + 0.42]), [0.045, 0.02, 0.75]); b.box(o(C.dark, [hx, hy, hz]), [0.12, 0.05, 0.05]); }
  else if (W === 'falx') { b.box(o(C.steel, [hx, hy + 0.15, hz + 0.3], [-0.5, 0, 0]), [0.05, 0.02, 0.6]); b.box(o(C.steel, [hx, hy + 0.12, hz + 0.62], [0.8, 0, 0]), [0.05, 0.02, 0.3]); b.box(o(C.wood, [hx, hy, hz]), [0.04, 0.04, 0.4]); }
  else if (W === 'spear') { b.cyl(o(C.wood, [hx, hy + 0.1, hz + 0.6], [Math.PI / 2, 0, 0]), 0.02, 0.02, 2.5, 5); b.cone(o(C.steel, [hx, hy + 0.1, hz + 1.95], [Math.PI / 2, 0, 0]), 0.035, 0.22, 5); }
  else if (W === 'pike') { b.cyl(o(C.wood, [hx, hy + 0.25, hz + 1.6], [Math.PI / 2 - 0.08, 0, 0]), 0.022, 0.022, 5.6, 5); b.cone(o(C.steel, [hx, hy + 0.48, hz + 4.45], [Math.PI / 2 - 0.08, 0, 0]), 0.035, 0.25, 5); }
  else if (W === 'lance') { b.cyl(o(C.wood, [hx, hy + 0.05, hz + 0.9], [Math.PI / 2, 0, 0]), 0.022, 0.022, 3.2, 5); b.cone(o(C.steel, [hx, hy + 0.05, hz + 2.55], [Math.PI / 2, 0, 0]), 0.035, 0.2, 5); }
  else if (W === 'javelin') { b.cyl(o(C.wood, [hx, hy + 0.35, hz + 0.1], [Math.PI / 2 - 0.9, 0, 0]), 0.015, 0.015, 1.5, 4); b.cone(o(C.steel, [hx, hy + 0.84, hz + 0.68], [Math.PI / 2 - 0.9, 0, 0]), 0.025, 0.14, 4); }
  else if (W === 'bow') { /* drawing hand, bow is in the shield hand */ }
  else if (W === 'sling') { b.box(o('#8a6d4a', [hx, hy - 0.2, hz]), [0.02, 0.4, 0.02]); }
}

function shield(b, look, pv, y) {
  const S = look.shield;
  const o = (color, p, r = [0, 0, 0], mask = 0) => ({ part: 4, pivot: pv, color, p, r, mask });
  const sy = 1.0 + y, sx = 0.22, sz = 0.36;
  if (look.weapon === 'bow') {
    b.cyl(o(C.wood, [0.28, sy + 0.25, sz + 0.12], [0.15, 0, 0]), 0.018, 0.018, 1.3, 4);
    b.cyl(o('#ddd', [0.28, sy + 0.25, sz + 0.02], [0.15, 0, 0]), 0.004, 0.004, 1.25, 3);
    return;
  }
  if (!S || S === 'none') return;
  if (S === 'scutum') {
    for (const [dx, rot] of [[-0.2, 0.35], [0, 0], [0.2, -0.35]]) b.box(o(C.team, [sx + dx, sy, sz - Math.abs(dx) * 0.35], [0, rot, 0], 0.6), [0.22, 1.05, 0.05]);
    b.sph(o(C.gold, [sx, sy, sz + 0.04]), 0.07, 8, 6);
    b.box(o(C.gold, [sx, sy + 0.3, sz + 0.03]), [0.06, 0.32, 0.02]);
    b.box(o(C.gold, [sx, sy - 0.3, sz + 0.03]), [0.06, 0.32, 0.02]);
    return;
  }
  const dims = { round: [0.46, 0.46], oval: [0.32, 0.55], small: [0.3, 0.3], parma: [0.3, 0.3], pelte: [0.32, 0.28] }[S] || [0.4, 0.4];
  b.cyl(o(C.team, [sx, sy + 0.08, sz], [Math.PI / 2, 0, 0], 0.6), 1, 1, 0.06, 14);
  // the disc above is unit radius: squash it to the shield's shape
  const n = new THREE.CylinderGeometry(1, 1, 0.06, 14).toNonIndexed().attributes.position.count;
  const start = b.pos.length - n * 3;
  for (let i = start; i < b.pos.length; i += 3) {
    b.pos[i] = sx + (b.pos[i] - sx) * dims[0];
    b.pos[i + 1] = sy + 0.08 + (b.pos[i + 1] - sy - 0.08) * dims[1];
  }
  if (S === 'round') b.cyl(o(C.bronze, [sx, sy + 0.08, sz - 0.035], [Math.PI / 2, 0, 0]), dims[0] + 0.03, dims[0] + 0.03, 0.03, 14);
  b.sph(o(S === 'round' ? C.bronze : C.iron, [sx, sy + 0.08, sz + 0.04]), 0.06, 8, 6);
}

function horse(b, look) {
  const coat = look.horse === 'armored' ? '#8f8a7e' : Math.random() < 0.5 ? C.horse : C.horse2;
  b.box({ color: coat, p: [0, 1.32, 0] }, [0.52, 0.6, 1.5]);
  b.box({ color: coat, p: [0, 1.38, 0.62] }, [0.48, 0.62, 0.42]);
  b.box({ color: coat, p: [0, 1.82, 0.88], r: [-0.65, 0, 0] }, [0.28, 0.75, 0.36]);
  b.box({ color: coat, p: [0, 2.12, 1.17], r: [0.55, 0, 0] }, [0.24, 0.26, 0.56]);
  b.box({ color: C.dark, p: [0, 2.12, 0.86], r: [-0.65, 0, 0] }, [0.08, 0.7, 0.2]);
  b.box({ color: C.dark, p: [0, 1.25, -0.88], r: [0.5, 0, 0] }, [0.1, 0.6, 0.1]);
  for (const x of [0.07, -0.07]) b.box({ color: coat, p: [x, 2.33, 0.98] }, [0.04, 0.12, 0.05]);
  // saddle cloth in team colour
  b.box({ color: C.team, mask: 1, p: [0, 1.6, -0.05] }, [0.62, 0.12, 0.62]);
  b.box({ color: C.team, mask: 1, p: [0.31, 1.38, -0.05] }, [0.02, 0.36, 0.62]);
  b.box({ color: C.team, mask: 1, p: [-0.31, 1.38, -0.05] }, [0.02, 0.36, 0.62]);
  if (look.horse === 'armored') b.box({ color: C.scale, p: [0, 1.4, 0.35] }, [0.58, 0.55, 0.7]);
  const legs = [[5, 0.17, 0.6], [6, -0.17, 0.6], [7, 0.17, -0.58], [8, -0.17, -0.58]];
  for (const [part, x, z] of legs) {
    const pivot = [x, 1.08, z];
    b.box({ part, pivot, color: coat, p: [x, 0.6, z] }, [0.13, 0.98, 0.15]);
    b.box({ part, pivot, color: C.dark, p: [x, 0.06, z + 0.02] }, [0.14, 0.1, 0.17]);
  }
}

function elephant(b) {
  b.sph({ color: C.ele, p: [0, 2.35, 0], s: [1.15, 1.15, 1.75] }, 1, 12, 10);
  b.sph({ color: C.ele, p: [0, 2.75, 1.75] }, 0.78, 10, 8);
  for (const x of [0.75, -0.75]) b.box({ color: '#6e6761', p: [x, 2.7, 1.5], r: [0, x > 0 ? -0.5 : 0.5, 0] }, [0.08, 1.0, 0.8]);
  for (const x of [0.28, -0.28]) b.cone({ color: C.white, p: [x, 2.05, 2.55], r: [1.9, 0, 0] }, 0.07, 0.8, 6);
  // trunk (part 3 swings on attack)
  const tp = [0, 2.5, 2.35];
  b.cyl({ part: 3, pivot: tp, color: C.ele, p: [0, 1.95, 2.55], r: [0.15, 0, 0] }, 0.18, 0.24, 1.2, 8);
  b.cyl({ part: 3, pivot: tp, color: C.ele, p: [0, 1.0, 2.68], r: [-0.1, 0, 0] }, 0.11, 0.17, 0.9, 8);
  for (const [part, x, z] of [[5, 0.6, 0.85], [6, -0.6, 0.85], [7, 0.6, -0.85], [8, -0.6, -0.85]]) {
    const pivot = [x, 1.9, z];
    b.cyl({ part, pivot, color: C.ele, p: [x, 0.95, z] }, 0.33, 0.36, 1.9, 10);
  }
  b.box({ color: C.dark, p: [0, 2.1, -1.75], r: [0.4, 0, 0] }, [0.08, 0.8, 0.08]);
  // war blanket and tower
  b.box({ color: C.team, mask: 1, p: [0, 3.35, -0.1] }, [1.7, 0.12, 1.9]);
  for (const x of [0.86, -0.86]) b.box({ color: C.team, mask: 1, p: [x, 2.9, -0.1] }, [0.04, 0.9, 1.9]);
  b.box({ color: C.wood, p: [0, 3.9, -0.15] }, [1.2, 0.9, 1.3]);
  b.box({ color: C.team, mask: 1, p: [0, 4.0, -0.15] }, [1.24, 0.3, 1.34]);
  for (const [x, z] of [[0.3, 0.1], [-0.3, -0.4]]) {
    b.box({ color: C.linen, p: [x, 4.55, z] }, [0.32, 0.4, 0.22]);
    b.sph({ color: C.skin, p: [x, 4.9, z] }, 0.12, 8, 6);
    b.cone({ color: C.bronze, p: [x, 5.05, z] }, 0.12, 0.2, 8);
    b.cyl({ color: C.wood, p: [x - 0.15, 4.9, z + 0.5], r: [1.0, 0, 0] }, 0.02, 0.02, 2.2, 4);
  }
  // mahout
  b.box({ color: C.linen, p: [0, 3.55, 1.25] }, [0.3, 0.38, 0.22]);
  b.sph({ color: C.skinDark, p: [0, 3.86, 1.27] }, 0.11, 8, 6);
}

export function buildModel(unitType) {
  const look = unitType.look;
  const b = new GB();
  if (look.body === 'elephant') elephant(b);
  else if (['cav', 'harcher'].includes(unitType.cls)) { horse(b, look); human(b, look, { y: 0.88, rider: true }); }
  else human(b, look);
  return b.build();
}

// ---------------------------------------------------------------- material with GPU animation
const ANIM_COMMON = `
attribute float aPart; attribute vec3 aPivot; attribute float aMask; attribute float aMetal;
attribute vec3 aTeam; attribute vec4 aAnim; attribute vec3 aVar;
varying vec3 vTeam; varying float vMask; varying float vMetal; varying vec3 vVar;
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
void animate(inout vec3 p, inout vec3 n){
  float ph = aAnim.x, walk = aAnim.y, atk = aAnim.z, st = aAnim.w;
  mat3 R = mat3(1.0); vec3 T = vec3(0.0);
  if (aPart > 0.5 && aPart < 2.5) {
    float s = aPart < 1.5 ? 1.0 : -1.0;
    R = rotX(sin(ph) * 0.65 * walk * s);
  } else if (aPart > 2.5 && aPart < 3.5) {
    float t = clamp(atk, 0.0, 1.0);
    float sw = sin(t * 3.14159);
    R = rotX(-sw * 0.9 + sin(ph) * 0.2 * walk);
    T = vec3(0.0, sw * 0.12, sw * 0.32);
  } else if (aPart > 3.5 && aPart < 4.5) {
    R = rotX(-sin(ph) * 0.12 * walk - st * 1.45);
    T = vec3(0.0, st * 0.4, -st * 0.1);
  } else if (aPart > 4.5) {
    float k = aPart - 5.0;
    float off = k > 1.5 ? 1.7 : 0.0;
    float side = (k == 1.0 || k == 3.0) ? 3.14159 : 0.0;
    R = rotX(sin(ph + off + side) * 0.75 * walk);
  }
  p = R * (p - aPivot) + aPivot + T;
  p.y += abs(sin(ph)) * 0.06 * walk;
  n = R * n;
}
`;

export function soldierMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.08 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ANIM_COMMON)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 animP = position; animate(animP, objectNormal); vTeam = aTeam; vMask = aMask; vMetal = aMetal; vVar = aVar;')
      .replace('#include <begin_vertex>', 'vec3 transformed = animP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTeam; varying float vMask; varying float vMetal; varying vec3 vVar;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vMask > 0.5) diffuseColor.rgb = vMask > 0.8 ? vTeam : vTeam * 0.62 + vec3(0.035, 0.03, 0.02);
        else if (vMask > 0.25) diffuseColor.rgb *= vVar.x;
        else if (vMask > 0.15) {
          float h = vVar.y;
          vec3 hair = h < 0.33 ? mix(vec3(0.07, 0.05, 0.04), vec3(0.28, 0.16, 0.08), h * 3.0) : h < 0.66 ? mix(vec3(0.28, 0.16, 0.08), vec3(0.5, 0.24, 0.1), (h - 0.33) * 3.0) : mix(vec3(0.5, 0.24, 0.1), vec3(0.78, 0.6, 0.32), (h - 0.66) * 3.0);
          diffuseColor.rgb = hair;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, vMetal);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMetal * 0.85;');
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ANIM_COMMON)
      .replace('#include <begin_vertex>', 'vec3 animP = position; vec3 dn = vec3(0.0, 1.0, 0.0); animate(animP, dn); vec3 transformed = animP;');
  };
  return { mat, depth };
}
