// Procedural soldier models. Each model is one merged geometry whose vertices carry
// a body-part id + pivot, so the GPU animates legs, weapon arm, shield arm and
// horse/elephant legs per instance (walk phase, attack swing) without skinning.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const C = {
  skin: '#b98a66', skinDark: '#7a4e31', mail: '#6c6b67', bronze: '#9c7740', steel: '#8e9194', linen: '#d4c9ae', leather: '#7a5434', scale: '#a08850',
  wood: '#6b4a2b', dark: '#2a221b', iron: '#626260', gold: '#c29a4c', trousers: '#6a5140', hair: '#7a4b22', horse: '#5b3b22', horse2: '#3d2a1c', ele: '#7c756e', white: '#f2ede2',
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
    const m = mergeVertices(g, 1e-4); // weld shared corners: far fewer vertices to animate
    g.dispose();
    m.computeBoundingSphere();
    return m;
  }
}

const METAL = { [C.mail]: 0.75, [C.bronze]: 0.9, [C.steel]: 0.95, [C.iron]: 0.85, [C.gold]: 1, [C.scale]: 0.7, '#6f747b': 0.9 };
const ARMOR = { mail: C.mail, bronze: C.bronze, segmentata: C.steel, linen: C.linen, leather: C.leather, scale: C.scale };

// ---------------------------------------------------------------- shaped primitives
// a body of revolution from [radius, height] pairs; zs squashes front-to-back; folds ripples the hem
function lathe(b, o, prof, seg = 12, zs = 1, folds = 0, foldAmp = 0) {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  if (folds) {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i), y = P.getY(i), a = Math.atan2(z, x);
      const t = (y - prof[0][1]) / (prof[prof.length - 1][1] - prof[0][1]); // 0 at hem
      const k = 1 + Math.sin(a * folds) * foldAmp * (1 - t);
      P.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
  }
  g.scale(1, 1, zs);
  b.add(g, o);
}
// a tapered limb between two points
function limb(b, o, a, c, r0, r1, seg = 7) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...c), d = B.clone().sub(A), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 2);
  // a little muscle bulge one third down
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const t = 0.5 - P.getY(i) / L; const k = 1 + 0.18 * Math.sin(Math.min(1, t * 1.5) * Math.PI); P.setX(i, P.getX(i) * k); P.setZ(i, P.getZ(i) * k); }
  g.computeVertexNormals();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  b.add(g, o);
}
function ell(b, o, r, s, seg = 10) { b.add(new THREE.SphereGeometry(r, seg, Math.max(5, seg - 3)), { ...o, s }); }

// A human, standing (or seated on a mount when `rider` is set). Facing +z; right hand at -x.
function human(b, look, { y = 0, rider = false, noArms = false } = {}) {
  const skin = look.skin === 'dark' ? C.skinDark : C.skin;
  const legC = look.hair ? C.trousers : skin;
  const shoe = look.hair ? '#3b2a1c' : '#4a3424';
  if (!rider) {
    for (const [part, x] of [[1, 0.095], [2, -0.095]]) {
      const pivot = [x, 0.9 + y, 0];
      const o = { part, pivot, color: legC };
      limb(b, o, [x, 0.9 + y, 0], [x * 1.05, 0.5 + y, 0.02], 0.088, 0.066, 8); // thigh
      limb(b, o, [x * 1.05, 0.5 + y, 0.02], [x * 1.08, 0.1 + y, -0.01], 0.064, 0.042, 8); // shin
      b.add(new THREE.SphereGeometry(0.06, 8, 6), { part, pivot, color: legC, p: [x * 1.05, 0.5 + y, 0.03] });
      ell(b, { part, pivot, color: shoe, p: [x * 1.08, 0.05 + y, 0.05] }, 0.07, [0.85, 0.62, 1.8], 8); // caliga / shoe
      if (!look.hair) for (let k = 0; k < 3; k++) b.add(new THREE.TorusGeometry(0.047, 0.008, 4, 10), { part, pivot, color: shoe, p: [x * 1.08, 0.14 + k * 0.06 + y, -0.01], r: [Math.PI / 2, 0, 0] }); // straps
      if (look.armor === 'bronze' && !look.hair) b.add(new THREE.CylinderGeometry(0.07, 0.058, 0.32, 9, 1, true, -1.2, 2.4), { part, pivot, color: C.bronze, p: [x * 1.07, 0.3 + y, 0.012] }); // greave
    }
  } else {
    for (const x of [0.17, -0.17]) {
      const s = Math.sign(x);
      limb(b, { color: legC }, [x * 0.6, y + 0.02, 0], [x * 1.25 + s * 0.06, y - 0.08, 0.36], 0.09, 0.07, 8);
      limb(b, { color: legC }, [x * 1.25 + s * 0.06, y - 0.08, 0.36], [x * 1.3 + s * 0.08, y - 0.5, 0.26], 0.064, 0.045, 8);
      ell(b, { color: shoe, p: [x * 1.3 + s * 0.08, y - 0.56, 0.3] }, 0.07, [0.85, 0.62, 1.7], 8);
    }
  }
  const pectoral = look.armor === 'bronze' && look.shield === 'scutum'; // Roman hastati: a square plate over the tunic
  const arm = pectoral ? null : ARMOR[look.armor];
  const tunic = { color: C.team, mask: 1 };
  // tunic skirt with folds, hanging from the belt
  lathe(b, { ...tunic, p: [0, 0.68 + y + (rider ? 0.1 : 0), 0] }, [[0.255, 0], [0.24, 0.1], [0.21, 0.24], [0.185, 0.34]], 18, 0.78, 9, 0.07);
  // torso: waist, ribcage, chest and shoulders
  const torso = arm ? { color: arm } : tunic;
  lathe(b, { ...torso, p: [0, 0.98 + y, 0] }, [[0.165, 0], [0.175, 0.08], [0.2, 0.22], [0.215, 0.33], [0.205, 0.42], [0.15, 0.5], [0.075, 0.54]], 14, 0.7);
  for (const x of [0.2, -0.2]) ell(b, { ...torso, p: [x, 1.42 + y, 0] }, 0.09, [1.1, 0.85, 1], 8);
  if (pectoral) { b.box({ color: C.bronze, p: [0, 1.27 + y, 0.142], r: [-0.08, 0, 0] }, [0.2, 0.2, 0.02]); b.box({ color: C.bronze, p: [0, 1.27 + y, -0.142] }, [0.2, 0.2, 0.02]); for (const x of [0.09, -0.09]) b.box({ color: '#4a3622', p: [x, 1.4 + y, 0], r: [0, 0, 0] }, [0.03, 0.02, 0.3]); }
  if (look.armor === 'segmentata') for (let k = 0; k < 4; k++) b.add(new THREE.CylinderGeometry(0.21 - Math.abs(k - 1.5) * 0.008, 0.21 - Math.abs(k - 1.5) * 0.008, 0.028, 14), { color: '#6f747b', p: [0, 1.04 + k * 0.085 + y, 0], s: [1, 1, 0.72] });
  if (look.armor === 'mail' || look.armor === 'linen' || look.armor === 'segmentata' || look.armor === 'scale')
    for (const x of [0.2, -0.2]) b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 10, 1, true, -Math.PI / 2, Math.PI), { color: arm, p: [x, 1.4 + y, 0], r: [0, 0, Math.PI / 2 + (x > 0 ? -0.25 : 0.25)], s: [0.55, 1, 1.2] }); // shoulder guards
  if (look.armor === 'linen' || look.armor === 'bronze') lathe(b, { color: arm, p: [0, 0.86 + y, 0] }, [[0.235, 0], [0.205, 0.14]], 16, 0.74, 12, 0.12); // pteruges
  // belt (cingulum) and, for Romans, the hanging studded apron
  b.add(new THREE.TorusGeometry(0.175, 0.025, 5, 16), { color: '#4a3622', p: [0, 0.99 + y, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.72, 1] });
  if (!look.hair && look.shield === 'scutum') for (let k = -1; k <= 1; k++) b.box({ color: C.dark, p: [k * 0.035, 0.86 + y, 0.13] }, [0.018, 0.24, 0.012]);
  if (look.armor === 'none' && look.hair) lathe(b, { color: skin, p: [0, 1.12 + y, 0.01] }, [[0.2, 0], [0.205, 0.18], [0.16, 0.3]], 12, 0.7); // bare chest
  // neck and head
  b.cyl({ color: skin, p: [0, 1.53 + y, 0.005] }, 0.055, 0.062, 0.12, 8);
  ell(b, { color: skin, p: [0, 1.66 + y, 0.012] }, 0.1, [0.92, 1.14, 1.04], 12); // cranium
  ell(b, { color: skin, p: [0, 1.6 + y, 0.045] }, 0.07, [1.05, 0.9, 1], 9); // jaw
  b.add(new THREE.ConeGeometry(0.018, 0.05, 4), { color: skin, p: [0, 1.655 + y, 0.115], r: [Math.PI / 2 + 0.3, 0, 0] }); // nose
  for (const x of [0.098, -0.098]) ell(b, { color: skin, p: [x, 1.655 + y, 0.0] }, 0.022, [0.5, 1, 0.8], 6); // ears
  for (const x of [0.035, -0.035]) ell(b, { color: '#2a1d15', p: [x, 1.675 + y, 0.098] }, 0.011, [1.2, 0.7, 0.6], 5); // eyes
  if (look.hair) {
    if (look.helmet === 'none') {
      ell(b, { color: C.hair, p: [0, 1.7 + y, -0.015] }, 0.112, [1, 0.95, 1.05], 10);
      ell(b, { color: C.hair, p: [0, 1.58 + y, -0.07] }, 0.1, [1.05, 1.4, 0.55], 8);
    }
    ell(b, { color: C.hair, p: [0, 1.585 + y, 0.075] }, 0.06, [1.1, 0.8, 0.6], 8); // beard / moustache
  }
  helmet(b, look, 1.67 + y);
  // cloak over the shoulders
  if (look.cape) b.add(new THREE.CylinderGeometry(0.26, 0.36, 0.95, 12, 3, true, Math.PI * 0.62, Math.PI * 0.76), { color: C.team, mask: 0.6, p: [0, 1.0 + y + (rider ? 0.05 : 0), -0.02], s: [1, 1, 0.72] });
  if (noArms) return;
  // weapon arm (part 3) and shield arm (part 4)
  const sh = 1.42 + y;
  const pr = [-0.25, sh, 0], pl = [0.25, sh, 0];
  const sleeve = arm && ['mail', 'scale', 'segmentata'].includes(look.armor) ? arm : C.team;
  const sm = sleeve === C.team ? 1 : 0;
  const elR = [-0.31, sh - 0.27, 0.07], wrR = [-0.3, sh - 0.42, 0.29];
  limb(b, { part: 3, pivot: pr, color: sleeve, mask: sm }, [-0.25, sh, 0], elR, 0.068, 0.052, 7);
  limb(b, { part: 3, pivot: pr, color: skin }, elR, wrR, 0.05, 0.036, 7);
  ell(b, { part: 3, pivot: pr, color: skin, p: [wrR[0], wrR[1] - 0.02, wrR[2] + 0.03] }, 0.042, [0.8, 1, 1.15], 7);
  const hand = [-0.28, sh - 0.44, 0.3];
  weapon(b, look, hand, pr, y);
  const elL = [0.32, sh - 0.25, 0.08], wrL = [0.3, sh - 0.33, 0.33];
  limb(b, { part: 4, pivot: pl, color: sleeve, mask: sm }, [0.25, sh, 0], elL, 0.068, 0.052, 7);
  limb(b, { part: 4, pivot: pl, color: skin }, elL, wrL, 0.05, 0.036, 7);
  ell(b, { part: 4, pivot: pl, color: skin, p: [wrL[0], wrL[1], wrL[2] + 0.03] }, 0.042, [0.8, 1, 1.15], 7);
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
  if (H === 'corinthian') {
    ell(b, { color: met, p: [0, hy - 0.035, 0.008] }, 0.128, [1.0, 1.22, 1.08], 12); // the bowl swept down over the face
    for (const x of [0.04, -0.04]) ell(b, { color: '#0e0b08', p: [x, hy + 0.0, 0.128] }, 0.03, [1.2, 0.55, 0.3], 6); // eye slots
    b.box({ color: met, p: [0, hy - 0.04, 0.138] }, [0.025, 0.08, 0.02]); // nasal
    ell(b, { color: met, p: [0, hy - 0.16, -0.06] }, 0.1, [1.1, 0.5, 0.9], 8); // flared neck
  }
  if (H === 'montefortino' || H === 'imperial' || H === 'attic') for (const x of [0.12, -0.12]) b.box({ color: met, p: [x, hy - 0.08, 0.04] }, [0.03, 0.13, 0.1]);
  if (H === 'imperial') { b.box({ color: met, p: [0, hy - 0.08, -0.13], r: [0.4, 0, 0] }, [0.27, 0.04, 0.12]); b.box({ color: met, p: [0, hy + 0.02, 0.13] }, [0.24, 0.03, 0.03]); }
  if (H === 'montefortino' || H === 'celtic') b.cone({ color: met, p: [0, hy + 0.15, 0] }, 0.025, 0.06, 6);
  if (H === 'boeotian') b.cyl({ color: met, p: [0, hy - 0.02, 0] }, 0.22, 0.22, 0.025, 12);
  if (H === 'thracian') b.cone({ color: met, p: [0, hy + 0.14, 0.05], r: [0.6, 0, 0] }, 0.07, 0.16, 8);
  const cr = look.crest;
  if (cr && cr !== 'none') {
    const cc = cr === 'red' ? C.red : cr === 'white' ? C.white : C.black;
    if (cr === 'feathers') for (const x of [-0.05, 0, 0.05]) b.box({ color: x === 0 ? C.black : C.red, p: [x, hy + 0.27, 0] }, [0.025, 0.3, 0.03]);
    else { ell(b, { color: cc, p: [0, hy + 0.14, -0.03] }, 0.16, [0.2, 0.62, 1.2], 10); b.box({ color: met || C.bronze, p: [0, hy + 0.12, -0.03] }, [0.02, 0.05, 0.22]); } // horsehair crest on its holder
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
    // curved like a section of a barrel: six slats around a 0.55 m radius
    const R = 0.55, n = 6, span = 1.12;
    for (let k = 0; k < n; k++) {
      const a = -span / 2 + (span * (k + 0.5)) / n;
      b.box(o(C.team, [sx + Math.sin(a) * R, sy, sz - R + Math.cos(a) * R], [0, a, 0], 0.6), [(span * R) / n + 0.006, 1.08, 0.035]);
    }
    for (const yy of [0.54, -0.54]) for (let k = 0; k < n; k++) { const a = -span / 2 + (span * (k + 0.5)) / n; b.box(o(C.gold, [sx + Math.sin(a) * (R + 0.012), sy + yy, sz - R + Math.cos(a) * (R + 0.012)], [0, a, 0]), [(span * R) / n + 0.01, 0.03, 0.03]); } // bronze edging
    ell(b, o(C.gold, [sx, sy, sz + 0.02]), 0.075, [1, 1, 0.55], 9); // umbo
    b.box(o(C.gold, [sx, sy + 0.3, sz + 0.012]), [0.05, 0.42, 0.015]); b.box(o(C.gold, [sx, sy - 0.3, sz + 0.012]), [0.05, 0.42, 0.015]);
    for (const d of [-1, 1]) for (const yy of [0.14, -0.14]) b.box(o(C.gold, [sx + d * 0.13, sy + yy, sz - 0.01], [0, -d * 0.2, d * yy * 3]), [0.2, 0.03, 0.012]); // painted wings
    return;
  }
  if (S === 'round') {
    // the hoplite aspis: a shallow bronze-rimmed dome
    b.add(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, 0.6), { ...o(C.team, [sx, sy + 0.08, sz - 0.12], [Math.PI / 2, 0, 0], 0.6), s: [0.46 / Math.sin(0.6), 0.36, 0.46 / Math.sin(0.6)] });
    b.cyl(o(C.team, [sx, sy + 0.08, sz - 0.07], [Math.PI / 2, 0, 0], 0.6), 0.45, 0.45, 0.03, 16);
    b.add(new THREE.TorusGeometry(0.46, 0.022, 5, 22), o(C.bronze, [sx, sy + 0.08, sz - 0.05]));
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
  if (S === 'oval') b.box(o(C.wood, [sx, sy + 0.08, sz + 0.035]), [0.035, dims[1] * 1.8, 0.02]); // spina
}

function horse(b, look) {
  const coat = look.horse === 'armored' ? '#8f8a7e' : [C.horse, C.horse2, '#6e4a2c', '#4a3324'][Math.floor(Math.random() * 4)];
  const mane = C.dark, hoof = '#2a2420';
  // barrel, chest and hindquarters
  ell(b, { color: coat, p: [0, 1.36, -0.05] }, 1, [0.3, 0.33, 0.72], 14);
  ell(b, { color: coat, p: [0, 1.4, 0.48] }, 1, [0.27, 0.34, 0.34], 12);
  ell(b, { color: coat, p: [0, 1.42, -0.55] }, 1, [0.29, 0.33, 0.36], 12);
  // neck, head and muzzle
  limb(b, { color: coat }, [0, 1.5, 0.6], [0, 2.02, 0.98], 0.2, 0.13, 10);
  limb(b, { color: coat }, [0, 2.08, 1.0], [0, 1.82, 1.42], 0.12, 0.075, 9);
  ell(b, { color: coat, p: [0, 1.79, 1.44] }, 0.085, [0.95, 0.9, 1.1], 8);
  for (const x of [0.06, -0.06]) b.add(new THREE.ConeGeometry(0.03, 0.12, 5), { color: coat, p: [x, 2.18, 0.98], r: [-0.2, 0, x * 2] });
  for (const x of [0.075, -0.075]) ell(b, { color: '#120d0a', p: [x, 2.02, 1.14] }, 0.018, [0.6, 1, 1], 5);
  b.box({ color: mane, p: [0, 1.95, 0.76], r: [-0.95, 0, 0] }, [0.05, 0.6, 0.1]); // mane
  // tail
  limb(b, { color: mane }, [0, 1.6, -0.86], [0, 1.0, -1.02], 0.06, 0.1, 6);
  // tack: bridle, reins, saddle and the team saddle cloth
  b.add(new THREE.TorusGeometry(0.09, 0.012, 4, 10), { color: C.dark, p: [0, 1.86, 1.36], r: [0, Math.PI / 2, 0.5] });
  limb(b, { color: C.dark }, [0, 1.84, 1.36], [0, 1.72, 0.72], 0.01, 0.01, 4);
  b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.66, 12, 1, true, -Math.PI / 2, Math.PI), { color: C.team, mask: 1, p: [0, 1.38, -0.05], r: [Math.PI / 2, 0, 0], s: [1.02, 1, 1] });
  b.box({ color: '#4a3622', p: [0, 1.7, -0.05] }, [0.36, 0.08, 0.52]);
  for (const z of [0.2, -0.3]) b.box({ color: '#4a3622', p: [0, 1.78, z] }, [0.3, 0.1, 0.06]); // saddle horns
  if (look.horse === 'armored') lathe(b, { color: C.scale, p: [0, 1.15, 0.45] }, [[0.32, 0], [0.33, 0.25], [0.28, 0.5]], 12, 1.0);
  // legs: forearm/gaskin, cannon, fetlock and hoof; each swings from shoulder or hip
  const legs = [[5, 0.15, 0.55], [6, -0.15, 0.55], [7, 0.15, -0.58], [8, -0.15, -0.58]];
  for (const [part, x, z] of legs) {
    const pivot = [x, 1.18, z], hind = z < 0, o = { part, pivot, color: coat };
    const kz = z + (hind ? -0.1 : 0.02);
    limb(b, o, [x, 1.25, z], [x, 0.72, kz], hind ? 0.12 : 0.1, 0.065, 8);
    ell(b, { ...o, p: [x, 0.7, kz] }, 0.06, [1, 1.1, 1], 7);
    limb(b, o, [x, 0.7, kz], [x, 0.16, z + 0.02], 0.045, 0.04, 7);
    ell(b, { ...o, p: [x, 0.15, z + 0.03] }, 0.055, [1, 0.9, 1.1], 7);
    b.add(new THREE.CylinderGeometry(0.05, 0.062, 0.1, 9), { part, pivot, color: hoof, p: [x, 0.05, z + 0.04] });
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
varying vec3 vTeam; varying float vMask; varying float vMetal; varying vec3 vVar; varying vec3 vObj;
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
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 animP = position; animate(animP, objectNormal); vTeam = aTeam; vMask = aMask; vMetal = aMetal; vVar = aVar; vObj = animP;')
      .replace('#include <begin_vertex>', 'vec3 transformed = animP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTeam; varying float vMask; varying float vMetal; varying vec3 vVar; varying vec3 vObj;
float sh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float sn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh3(i), sh3(i + vec3(1,0,0)), f.x), mix(sh3(i + vec3(0,1,0)), sh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sh3(i + vec3(0,0,1)), sh3(i + vec3(1,0,1)), f.x), mix(sh3(i + vec3(0,1,1)), sh3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vMask > 0.5) diffuseColor.rgb = vMask > 0.8 ? vTeam : vTeam * 0.62 + vec3(0.035, 0.03, 0.02);
        else if (vMask > 0.25) diffuseColor.rgb *= vVar.x;
        else if (vMask > 0.15) {
          float h = vVar.y;
          vec3 hair = h < 0.33 ? mix(vec3(0.07, 0.05, 0.04), vec3(0.28, 0.16, 0.08), h * 3.0) : h < 0.66 ? mix(vec3(0.28, 0.16, 0.08), vec3(0.5, 0.24, 0.1), (h - 0.33) * 3.0) : mix(vec3(0.5, 0.24, 0.1), vec3(0.78, 0.6, 0.32), (h - 0.66) * 3.0);
          diffuseColor.rgb = hair;
        }
        // real dyes fade and dull; cloth has a weave and stains
        if (vMask > 0.5) { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * vec3(1.05, 0.98, 0.88), 0.1) * 0.8; }
        float weave = sn3(vObj * 70.0 + vVar.z * 13.0);
        float blot = sn3(vObj * 7.0 + vVar.y * 31.0);
        if (vMetal < 0.05) diffuseColor.rgb *= 0.9 + 0.1 * weave - 0.08 * smoothstep(0.55, 0.9, blot);
        // mail: rows of rings catching the light
        if (vMetal > 0.7 && vMetal < 0.8) { float r = sin(vObj.y * 240.0) * sin((vObj.x + vObj.z) * 240.0 + vObj.y * 120.0); diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(-0.3, 0.7, r); }
        // bronze and iron are dulled by wear
        if (vMetal > 0.5) diffuseColor.rgb *= 0.86 + 0.18 * sn3(vObj * 23.0 + vVar.x * 7.0);
        // mud and dust climbing the legs (and a horse's legs)
        float mud = smoothstep(0.62, 0.04, vObj.y) * (0.45 + 0.55 * sn3(vObj * 11.0 + vVar.z * 9.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.24, 0.16), mud * 0.6);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32 + 0.25 * sn3(vObj * 31.0), vMetal);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMetal * 0.72;');
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ANIM_COMMON)
      .replace('#include <begin_vertex>', 'vec3 animP = position; vec3 dn = vec3(0.0, 1.0, 0.0); animate(animP, dn); vec3 transformed = animP;');
  };
  return { mat, depth };
}
