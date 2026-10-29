import * as THREE from 'three';
import { loft, table, latheX, type Station } from './loft.ts';
import type { ModelSpec } from './fleet.ts';

/**
 * The traffic's car bodies, second generation. Still one loft per model (so a model is a handful of
 * instanced meshes), but each section is shaped like a car's: the sill tucked under, a side that
 * swells to the shoulder crease, a greenhouse leaning in (tumblehome) to a rounded roof. The wheel
 * arches are real cut-outs (the side skin stops at the arch) with black liners behind them; the
 * glass is framed by black pillars; the lamps are shaped clusters set into dark housings on the
 * corners; there is a framed grille with slats, a lower intake, number plates, mirrors on stalks,
 * door handles, exhausts. Police cars get a push bar, a segmented LED light bar and a spotlight;
 * their livery and the taxis' signage are a textured decal mesh.
 *
 * Vertex colours: white = the paint (the instance colour), dark = trim; chrome is a light grey.
 */

type RGB = [number, number, number];
const DARK: RGB = [0.022, 0.022, 0.025];
const TRIM: RGB = [0.05, 0.05, 0.055];
const CHROME: RGB = [0.72, 0.72, 0.74];
const PLATE: RGB = [0.9, 0.9, 0.86];
const PAINT: RGB = [1, 1, 1];

export interface CarGeometry {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  heads: THREE.BufferGeometry;
  tails: THREE.BufferGeometry;
  /** the livery / signage (uv-mapped quads), if the model has one */
  decal: THREE.BufferGeometry | null;
}

function colorize(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  if (g.index) g = g.toNonIndexed();
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

export function mergeColored(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

export function buildCar(m: ModelSpec): CarGeometry {
  const hl = m.L / 2, hw = m.W / 2;
  const cowl = m.cowl * hl, roofF = m.roofF * hl, roofR = m.roofR * hl, deck = m.deck * hl;
  const round = 1 - m.box;
  const truck = m.id === 'pickup' || m.id === 'cyber';
  const tall = m.id === 'van' || m.id === 'bus';
  // ---- plan, side and top lines
  const widthAt = table([
    [hl, hw * (0.66 + 0.26 * m.box)],
    [hl - 0.1 - round * 0.12, hw * (0.9 + 0.06 * m.box)],
    [hl - 0.45 - round * 0.2, hw * 0.995],
    [0, hw],
    [-hl + 0.45 + round * 0.15, hw * 0.99],
    [-hl + 0.1 + round * 0.1, hw * (0.92 + 0.05 * m.box)],
    [-hl, hw * (0.74 + 0.2 * m.box)],
  ]);
  const clear = m.clear;
  const bottomAt = table([
    [hl, clear + 0.2],
    [hl - 0.45, clear + 0.02],
    [-hl + 0.5, clear + 0.02],
    [-hl, clear + 0.24],
  ]);
  const beltAt = table([
    [hl, m.hoodH - 0.1 - round * 0.1],
    [hl - 0.4, m.hoodH - 0.01],
    [cowl, m.beltH - 0.02],
    [deck, m.beltH],
    [-hl + 0.3, m.deckH - 0.02],
    [-hl, m.deckH - 0.08 - round * 0.08],
  ]);
  const topAt = table(
    m.id === 'pickup'
      ? [[hl, m.hoodH], [hl - 0.4, m.hoodH + 0.04], [cowl, m.hoodH + 0.08], [roofF, m.H], [roofR, m.H], [roofR - 0.06, m.beltH + 0.03], [-hl, m.beltH + 0.03]]
      : m.id === 'cyber'
        ? [[hl, m.hoodH - 0.04], [cowl, m.hoodH + 0.08], [0.05, m.H], [-hl, m.deckH]]
        : [
            [hl, m.hoodH - 0.05],
            [hl - 0.45, m.hoodH + 0.02],
            [cowl, m.hoodH + 0.09],
            [roofF, m.H],
            [roofR, m.H - 0.02],
            [deck, m.deckH + 0.05],
            [-hl + 0.3, m.deckH + 0.03],
            [-hl, m.deckH - 0.05],
          ],
  );
  const inGlassZ = (z: number) => z < cowl - 0.02 && z > (m.id === 'pickup' ? roofR - 0.06 : deck + 0.02);
  const isRoof = (z: number) => z <= roofF + 0.02 && z >= roofR - 0.02;
  // the arches: the side skin stops at them
  const archR = m.wheelR + 0.075;
  const wz = m.wb / 2;
  const archY = (z: number) => {
    let y = -1;
    for (const c of [wz, -wz]) {
      const dz = z - c;
      if (Math.abs(dz) < archR) y = Math.max(y, m.wheelR + Math.sqrt(archR * archR - dz * dz));
    }
    return y;
  };
  // B-pillar(s): where the side glass is split
  const pillars = tall ? [] : m.id === 'pickup' ? [(cowl + roofR) / 2 - 0.1] : [(roofF + roofR) / 2 + 0.05, ...(m.id === 'suv' || m.id === 'gwagon' || m.id === 'policeSuv' ? [roofR + 0.05] : [])];
  const nearPillar = (z: number) => pillars.some((p) => Math.abs(z - p) < 0.06);
  const stations: Station[] = [];
  const nZ = m.id === 'bus' ? 40 : 46;
  for (let k = 0; k <= nZ; k++) {
    const z = hl - (k / nZ) * m.L;
    const w = widthAt(z);
    const yb = bottomAt(z);
    const ybelt = Math.min(beltAt(z), topAt(z) - 0.012);
    const ytop = Math.max(topAt(z), ybelt + 0.012);
    const gh = inGlassZ(z) ? 1 : 0;
    // tumblehome: the greenhouse leans in; the roof's width
    const roofW = w * (1 - m.tumble - 0.04 * round) * (gh ? 1 : 0.97);
    const ya = archY(z);
    const ylow = ya > 0 ? Math.min(Math.max(yb, ya), ybelt - 0.08) : yb;
    // the side: from the sill (tucked under) swelling to the shoulder crease at the belt
    const side: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const y = ylow + (ybelt - ylow) * t;
      const tuck = ya > 0 ? 0 : (1 - t) * (1 - t) * 0.07 * (0.5 + round);
      const swell = Math.sin(t * Math.PI) * 0.018 * round;
      side.push([w - tuck + swell, y]);
    }
    const sh: [number, number] = [w - 0.012, ybelt + 0.012];
    const gMid: [number, number] = [THREE.MathUtils.lerp(w - 0.01, roofW, 0.55) + 0.02 * round * gh, ybelt + (ytop - ybelt) * 0.55];
    const rEdge: [number, number] = [roofW, ytop - 0.035 * (0.4 + round)];
    stations.push({
      z,
      bands: [
        // 0 floor
        { pts: [[0, yb + 0.02], [w * 0.55, yb]] },
        // 1 the sill (dark), under the side
        { pts: [[w * 0.55, yb], [side[0][0] - 0.03, ylow + 0.005], side[0]] },
        // 2 the side
        { pts: side },
        // 3 the shoulder crease
        { pts: [side[5], sh] },
        // 4 the greenhouse (glass in the glass span)
        { pts: [sh, gMid, rEdge] },
        // 5 the roof
        { pts: [rEdge, [roofW * 0.55, ytop - 0.005 * round], [0, ytop + 0.01 * round]] },
      ],
    });
  }
  const L0 = loft({
    stations,
    slot(b, z, y) {
      if (b === 0) return 'trim';
      if (b === 1) return 'sill';
      if (b === 4 && inGlassZ(z) && y > Math.min(beltAt(z), topAt(z)) + 0.035) return nearPillar(z) ? 'pillar' : 'glass';
      if (b === 5 && inGlassZ(z) && !isRoof(z)) return 'glass';
      return 'paint';
    },
    capFront: 'paint',
    capRear: 'paint',
  });
  const bodyParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const dark = m.id === 'suv' || m.id === 'policeSuv' || m.id === 'pickup' || m.id === 'gwagon' || m.id === 'van';
  for (const [k, g] of L0.slots) {
    if (k === 'glass') glassParts.push(g);
    else if (k === 'trim' || k === 'pillar') bodyParts.push(colorize(g, DARK));
    else if (k === 'sill') bodyParts.push(colorize(g, dark ? TRIM : PAINT));
    else bodyParts.push(colorize(g, PAINT));
  }
  const add = (g: THREE.BufferGeometry, c: RGB) => bodyParts.push(colorize(g, c));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, ry = 0, rx = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    if (rx) b.rotateX(rx);
    if (ry) b.rotateY(ry);
    b.translate(x, y, z);
    add(b, c);
  };
  // ---- the cabin, seen through the glass: a dark liner, the dash and the wheel, the seats
  if (m.id !== 'bus') {
    const cz0 = cowl - 0.04;
    const cz1 = m.id === 'pickup' ? roofR - 0.04 : tall || m.id === 'suv' || m.id === 'gwagon' || m.id === 'policeSuv' ? -hl + 0.35 : Math.max(deck + 0.05, roofR - 0.45);
    const cw = widthAt((cz0 + cz1) / 2) * (1 - m.tumble * 0.6) - 0.06;
    const fl = clear + 0.22, ceil = m.H - 0.07;
    // the tub below the windows, seen from inside (the greenhouse above stays open: you see out the far side)
    {
      const top = m.beltH - 0.02;
      const g = new THREE.BoxGeometry(cw * 2, top - fl, cz0 - cz1).toNonIndexed();
      g.translate(0, (fl + top) / 2, (cz0 + cz1) / 2);
      const pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        // (reverse each triangle, turn its normal in)
        const x = pos.getX(i + 1), y = pos.getY(i + 1), z = pos.getZ(i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, x, y, z);
        for (let k = 0; k < 3; k++) nor.setXYZ(i + k, -nor.getX(i + k), -nor.getY(i + k), -nor.getZ(i + k));
      }
      add(g, [0.035, 0.034, 0.033]);
      // the headliner under the roof panel
      const hz0 = roofF - 0.04, hz1 = Math.max(roofR + 0.04, cz1);
      if (hz0 > hz1) {
        const hw2 = widthAt((hz0 + hz1) / 2) * (1 - m.tumble) - 0.1;
        const hl2 = new THREE.PlaneGeometry(hw2 * 2, hz0 - hz1);
        hl2.rotateX(Math.PI / 2);
        hl2.translate(0, ceil - 0.02, (hz0 + hz1) / 2);
        add(hl2, [0.32, 0.31, 0.29]);
      }
    }
    const SEAT: RGB = m.id === 'super' ? [0.32, 0.05, 0.04] : m.id === 'coupe' || m.id === 'police' || m.id === 'muscle' ? [0.025, 0.025, 0.028] : m.id === 'gwagon' ? [0.22, 0.13, 0.08] : m.id === 'taxi' || m.id === 'van' ? [0.07, 0.07, 0.08] : [0.11, 0.1, 0.095];
    // the dash across the front, the instrument hood, the wheel on the driver's (left) side
    // (set back under the windscreen's slope: it mustn't poke through the glass at the cowl)
    box(cw * 2 - 0.04, 0.16, 0.34, 0, m.beltH - 0.04, cz0 - 0.42, [0.03, 0.03, 0.032]);
    box(0.32, 0.06, 0.16, cw * 0.42, m.beltH + 0.07, cz0 - 0.5, [0.02, 0.02, 0.022]);
    {
      const wh = new THREE.TorusGeometry(0.18, 0.024, 4, 12);
      wh.rotateX(-0.45);
      wh.translate(cw * 0.42, m.beltH + 0.02, cz0 - 0.68);
      add(wh, [0.02, 0.02, 0.022]);
    }
    const seat = (x: number, z: number, w: number) => {
      // the cushion, the back up to a hand below the roof, the headrest
      const sy = fl + Math.min(0.24, (ceil - fl) * 0.22);
      const backTop = ceil - 0.3;
      const bh = Math.max(0.3, backTop - sy - 0.06);
      box(w, 0.12, 0.5, x, sy, z + 0.22, SEAT);
      box(w, bh, 0.12, x, sy + 0.06 + bh / 2, z - 0.02, SEAT, 0, -0.18);
      box(Math.min(0.26, w * 0.5), 0.18, 0.11, x, backTop + 0.11, z - 0.1, SEAT);
    };
    // front seats just ahead of the B-pillar, the back seat behind it
    const zF = pillars.length ? pillars[0] + 0.12 : Math.min(cz0 - 1.0, roofR + 0.5);
    if (cz0 - zF > 0.6) {
      seat(cw * 0.45, zF, Math.min(0.52, cw * 0.75));
      seat(-cw * 0.45, zF, Math.min(0.52, cw * 0.75));
    }
    const zR = zF - 0.9;
    if (m.id !== 'coupe' && m.id !== 'super' && m.id !== 'muscle' && m.id !== 'pickup' && zR - 0.3 > cz1) {
      seat(cw * 0.45, zR, Math.min(0.52, cw * 0.75));
      seat(-cw * 0.45, zR, Math.min(0.52, cw * 0.75));
      seat(0, zR, 0.4);
    }
  }
  // ---- arch liners (and a thin black lip on SUVs)
  for (const zc of [wz, -wz]) {
    for (const sg of [1, -1]) {
      const wAt = widthAt(zc);
      const lin = new THREE.CylinderGeometry(archR - 0.005, archR - 0.005, 0.34, 18, 1, true, -Math.PI / 2 - 0.15, Math.PI + 0.3);
      lin.rotateZ(Math.PI / 2);
      lin.translate(sg * (wAt - 0.19), m.wheelR, zc);
      add(lin, DARK);
      if (dark) {
        const lip = new THREE.TorusGeometry(archR + 0.012, 0.022, 5, 18, Math.PI);
        lip.rotateY(Math.PI / 2);
        lip.translate(sg * (wAt + 0.004), m.wheelR, zc);
        add(lip, TRIM);
      }
    }
  }
  // ---- the nose: grille (framed, slatted), the lower intake, the plate
  const noseZ = hl + 0.016;
  const noseW = widthAt(hl);
  const grilleW = Math.min(noseW * 2 - 0.5, m.id === 'gwagon' ? hw * 1.1 : m.box > 0.5 ? hw * 1.05 : hw * 0.8);
  const grilleH = m.id === 'cyber' ? 0.04 : Math.max(0.12, (m.hoodH - m.clear) * (m.box > 0.5 ? 0.42 : 0.28));
  const grilleY = m.hoodH - 0.07 - grilleH / 2;
  if (m.id !== 'cyber' && m.id !== 'bus') {
    box(grilleW, grilleH, 0.03, 0, grilleY, noseZ - 0.02, DARK);
    const slats = Math.max(3, Math.round(grilleH / 0.035));
    for (let i = 0; i < slats; i++) box(grilleW - 0.04, 0.008, 0.012, 0, grilleY - grilleH / 2 + (i + 0.5) * (grilleH / slats), noseZ, m.id === 'gwagon' || m.id === 'taxi' ? CHROME : TRIM);
    // surround
    box(grilleW + 0.03, 0.016, 0.03, 0, grilleY + grilleH / 2 + 0.008, noseZ - 0.005, m.box > 0.6 ? CHROME : TRIM);
  }
  const lowY = m.clear + 0.16;
  box(Math.min(hw * 1.25, noseW * 1.7), 0.1, 0.03, 0, lowY, noseZ - 0.01, DARK);
  box(noseW * 2 - 0.04, 0.03, 0.05, 0, lowY - 0.07, hl - 0.012, TRIM);
  // the bumper: a painted band proud of the nose, its lower intake, fog lamps either side
  if (m.id !== 'bus' && m.id !== 'cyber') {
    box(noseW * 2 - 0.02, 0.15, 0.07, 0, lowY + 0.12, hl + 0.012, m.box > 0.6 ? TRIM : PAINT);
    box(noseW * 2 - 0.06, 0.012, 0.075, 0, lowY + 0.045, hl + 0.014, DARK);
    for (const sg of [1, -1]) box(0.14, 0.06, 0.02, sg * (noseW - 0.22), lowY + 0.0, noseZ + 0.012, DARK);
  }
  box(0.52, 0.12, 0.012, 0, lowY + 0.13, noseZ + 0.055, PLATE);
  // ---- the tail: plate, a dark diffuser band, exhausts
  const tailZ = -hl - 0.012;
  if (m.id !== 'bus') box(widthAt(-hl) * 2 - 0.02, 0.16, 0.07, 0, m.clear + 0.32, -hl - 0.012, m.box > 0.6 || m.id === 'pickup' ? TRIM : PAINT);
  box(0.52, 0.12, 0.012, 0, Math.max(m.clear + 0.5, m.deckH - 0.38), tailZ - 0.02, PLATE);
  box(widthAt(-hl) * 2 - 0.04, 0.09, 0.05, 0, bottomAt(-hl) + 0.03, -hl + 0.012, TRIM);
  if (!tall && m.id !== 'cyber')
    for (const sg of [1, -1]) {
      const ex = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10);
      ex.rotateX(Math.PI / 2);
      ex.translate(sg * hw * (m.id === 'super' || m.id === 'muscle' ? 0.32 : 0.55), bottomAt(-hl) + 0.06, tailZ + 0.02);
      add(ex, TRIM);
    }
  // ---- mirrors on stalks, door handles
  for (const sg of [1, -1]) {
    const zM = cowl - 0.12;
    const wM = widthAt(zM);
    const cap = new THREE.SphereGeometry(0.1, 10, 8);
    cap.scale(0.55, 0.62, 1.1);
    cap.translate(sg * (wM + 0.13), m.beltH + 0.1, zM);
    add(cap, PAINT);
    box(0.12, 0.03, 0.05, sg * (wM + 0.05), m.beltH + 0.06, zM + 0.02, DARK);
    const glassM = new THREE.PlaneGeometry(0.14, 0.09);
    glassM.rotateY(Math.PI);
    glassM.translate(sg * (wM + 0.13), m.beltH + 0.1, zM - 0.105);
    glassParts.push(glassM);
    if (!tall)
      for (const zH of pillars.length ? [pillars[0] + 0.25, pillars[0] - 0.55] : [cowl - 0.6]) {
        const wH = widthAt(zH);
        box(0.02, 0.025, 0.16, sg * (wH + 0.004), m.beltH - 0.1, zH, CHROME);
      }
  }
  // ---- roof bits
  if (m.id === 'suv' || m.id === 'gwagon' || m.id === 'policeSuv') for (const sg of [1, -1]) box(0.045, 0.045, Math.abs(roofF - roofR) * 0.92, sg * widthAt(0) * (1 - m.tumble) * 0.82, m.H + 0.035, (roofF + roofR) / 2, DARK);
  if (m.id === 'sedan' || m.id === 'coupe' || m.id === 'compact') box(0.05, 0.05, 0.14, 0, m.H + 0.02, roofR + 0.12, DARK);
  if (m.id === 'gwagon') {
    const sp = new THREE.CylinderGeometry(0.37, 0.37, 0.25, 22);
    sp.rotateX(Math.PI / 2);
    sp.translate(0, 1.02, -hl - 0.13);
    add(sp, DARK);
    const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 18);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, 1.02, -hl - 0.26);
    add(hub, CHROME);
    // the boxy wing indicators on the fenders
    for (const sg of [1, -1]) box(0.08, 0.05, 0.1, sg * hw * 0.82, m.hoodH + 0.03, hl - 0.25, PAINT);
  }
  if (m.id === 'pickup') {
    for (const sg of [1, -1]) box(0.06, 0.48, -roofR - 0.25 + hl - 0.08, sg * (hw - 0.04), m.beltH - 0.2, (roofR - 0.25 - hl) / 2 + 0.04, PAINT);
    box(hw * 2 - 0.08, 0.48, 0.06, 0, m.beltH - 0.2, -hl + 0.04, PAINT);
    box(hw * 2 - 0.2, 0.04, -roofR - 0.3 + hl, 0, m.clear + 0.5, (roofR - 0.25 - hl) / 2 + 0.04, DARK);
  }
  if (m.id === 'bus') {
    for (const sg of [1, -1]) {
      const g = new THREE.BoxGeometry(0.02, 1.05, m.L - 2.4);
      g.translate(sg * (hw + 0.006), 2.15, -0.45);
      glassParts.push(g);
      for (let i = 0; i < 8; i++) box(0.03, 1.08, 0.08, sg * (hw + 0.012), 2.15, -0.45 - (m.L - 2.4) / 2 + (i + 0.5) * ((m.L - 2.4) / 8), DARK);
    }
    const ws = new THREE.BoxGeometry(hw * 1.85, 1.45, 0.02);
    ws.translate(0, 2.0, hl + 0.006);
    glassParts.push(ws);
    box(hw * 1.4, 0.22, 0.03, 0, 2.95, hl + 0.01, DARK);
  }
  if (m.id === 'van') {
    // sliding door track and the cargo panel line
    for (const sg of [1, -1]) box(0.012, 0.02, 2.2, sg * (hw + 0.004), m.beltH + 0.4, -0.3, TRIM);
  }
  // ---- the sports cars: the supercar's wing, side intakes and engine-cover louvres; the muscle
  // car's twin bonnet stripes and scoop; a ducktail on the coupe
  if (m.id === 'super') {
    const wy = m.deckH + 0.2, wzc = -hl + 0.22;
    box(hw * 1.7, 0.03, 0.3, 0, wy, wzc, DARK, 0, 0.12);
    for (const sg of [1, -1]) {
      box(0.03, 0.16, 0.26, sg * hw * 0.84, wy - 0.02, wzc, DARK);
      box(0.04, 0.2, 0.06, sg * hw * 0.45, wy - 0.12, wzc + 0.02, DARK);
      // the intake behind the door, scooping air to the engine
      box(0.05, 0.18, 0.5, sg * (widthAt(-0.35) - 0.01), m.beltH - 0.22, -0.35, DARK);
    }
    for (let i = 0; i < 5; i++) box(hw * 0.9, 0.012, 0.03, 0, m.deckH + 0.05 - i * 0.012, deck + 0.25 - i * 0.14, DARK);
    box(hw * 1.6, 0.05, 0.22, 0, m.clear + 0.03, hl - 0.1, DARK);
  }
  if (m.id === 'muscle') {
    for (const sg of [1, -1]) {
      box(0.2, 0.006, hl - cowl + 0.02, sg * 0.17, m.hoodH + 0.045, (hl + cowl) / 2, DARK);
      box(0.2, 0.006, roofF - roofR, sg * 0.17, m.H + 0.006, (roofF + roofR) / 2, DARK);
      box(0.2, 0.006, -deck - hl * 0.0 + 0.2, sg * 0.17, m.deckH + 0.06, (deck - hl) / 2 + 0.1, DARK);
    }
    box(0.62, 0.09, 0.7, 0, m.hoodH + 0.07, cowl + 0.55, PAINT);
    box(0.5, 0.05, 0.02, 0, m.hoodH + 0.09, cowl + 0.9, DARK);
    box(hw * 1.5, 0.03, 0.08, 0, m.deckH + 0.03, -hl + 0.06, PAINT);
  }
  if (m.id === 'coupe') box(hw * 1.5, 0.025, 0.14, 0, m.deckH + 0.07, -hl + 0.12, PAINT, 0, -0.2);
  // ---- police: push bar, light bar base, spotlight, antenna
  const police = m.id === 'police' || m.id === 'policeSuv';
  const barZ = (roofF + roofR) / 2 + 0.12;
  if (police) {
    for (const sg of [1, -1]) box(0.06, Math.max(0.3, m.hoodH - m.clear - 0.1), 0.06, sg * 0.32, (m.hoodH + m.clear) / 2, hl + 0.09, DARK);
    box(0.8, 0.06, 0.06, 0, m.hoodH - 0.12, hl + 0.1, DARK);
    box(0.8, 0.06, 0.06, 0, m.clear + 0.25, hl + 0.1, DARK);
    box(1.28, 0.06, 0.34, 0, m.H + 0.045, barZ, DARK);
    for (const sg of [1, -1]) box(0.05, 0.05, 0.3, sg * 0.5, m.H + 0.02, barZ, DARK);
    const spot = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10);
    spot.rotateX(Math.PI / 2);
    spot.translate(widthAt(cowl) * 0.98, m.beltH + 0.22, cowl - 0.15);
    add(spot, CHROME);
    const ant = new THREE.CylinderGeometry(0.004, 0.006, 0.7, 4);
    ant.translate(0.2, m.H + 0.35, roofR + 0.2);
    add(ant, DARK);
  }
  if (m.id === 'taxi') {
    box(0.66, 0.2, 0.3, 0, m.H + 0.11, (roofF + roofR) / 2, [0.98, 0.86, 0.25]);
    box(0.7, 0.03, 0.32, 0, m.H + 0.005, (roofF + roofR) / 2, DARK);
  }

  // ---- lamps: head clusters on the nose corners, DRL strips, wraparound tails, a third brake light
  const heads: THREE.BufferGeometry[] = [];
  const tails: THREE.BufferGeometry[] = [];
  const lamp = (to: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, ry = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    if (ry) b.rotateY(ry);
    b.translate(x, y, z);
    to.push(colorize(b, c));
  };
  // (below the hood's front edge, so the clusters sit in the nose rather than on it)
  const lightY = Math.min(m.hoodH - 0.1 - 0.08 * round, m.clear + 0.58);
  for (const sg of [1, -1]) {
    // the head cluster: a dark housing on the nose's corner, its projector lenses and a DRL line
    const zH = hl + 0.012;
    const xH = Math.min(noseW - 0.2, Math.max(grilleW / 2 + 0.22, noseW * 0.7));
    const ang = 0;
    const hwid = m.box > 0.9 ? 0.2 : 0.28, hh = m.box > 0.9 ? 0.2 : 0.1;
    box(hwid + 0.04, hh + 0.04, 0.05, sg * xH, lightY, zH - 0.01, DARK, ang);
    if (m.box > 0.9) {
      const ring = new THREE.CircleGeometry(0.09, 16);
      ring.translate(sg * xH, lightY, zH + 0.018);
      heads.push(colorize(ring, [1, 0.97, 0.9]));
    } else {
      // a swept cluster: the housing turned back round the nose's corner, a projector and a
      // reflector behind it, an LED running light along its top edge and down its outer end
      // (on the nose's own surface: where the plan's outline reaches each end of the cluster)
      const zAt = (x: number) => {
        for (let z = hl; z > hl - 1; z -= 0.005) if (widthAt(z) >= x) return z;
        return hl - 1;
      };
      const x0 = grilleW / 2 + 0.04, x1 = Math.min(hw - 0.06, x0 + Math.max(0.32, Math.min(0.55, hw - x0 - 0.1)));
      const z0 = zAt(x0), z1 = zAt(x1);
      const wL = Math.hypot(x1 - x0, z0 - z1), hL = m.box > 0.5 ? 0.13 : 0.095;
      const ry = sg * Math.atan2(z0 - z1, x1 - x0);
      const nx = Math.sin(ry), nz = Math.cos(ry);
      const cxL = (sg * (x0 + x1)) / 2, czL = (z0 + z1) / 2 + 0.02;
      const at = (u: number, out: number): [number, number] => [cxL + u * Math.cos(ry) + nx * out, czL - u * Math.sin(ry) + nz * out];
      box(wL + 0.03, hL + 0.025, 0.05, cxL - nx * 0.02, lightY, czL - nz * 0.02, DARK, ry);
      // the reflector bowl behind the clear lens: bright chrome by day
      {
        const [x, z] = at(0, 0.012);
        box(wL - 0.01, hL - 0.012, 0.012, x, lightY - 0.004, z, CHROME, ry);
      }
      for (const [u, r] of [[-sg * wL * 0.2, 0.042], [sg * wL * 0.14, 0.036]] as const) {
        const lens = new THREE.CylinderGeometry(r, r, 0.03, 14);
        lens.rotateX(Math.PI / 2);
        lens.rotateY(ry);
        const [x, z] = at(u, 0.03);
        lens.translate(x, lightY - 0.005, z);
        heads.push(colorize(lens, [1.6, 1.55, 1.45]));
      }
      {
        const [x, z] = at(0, 0.035);
        // (the running lights are on by day: bright even at the lamps' day level)
        lamp(heads, wL * 0.94, 0.018, 0.018, x, lightY + hL / 2 - 0.008, z, [3.0, 3.1, 3.3], ry);
        const [x2, z2] = at(sg * wL * 0.47, 0.035);
        lamp(heads, 0.018, hL * 0.85, 0.018, x2, lightY, z2, [3.0, 3.1, 3.3], ry);
      }
    }
    // the tail: a bar across the corner and a piece wrapping round the side
    const zT = -hl + 0.008;
    const xT = widthAt(-hl) * 0.7;
    const tY = Math.max(m.deckH - 0.13, m.clear + 0.5);
    const tw2 = tall ? 0.22 : 0.4, th = m.id === 'van' || m.id === 'bus' ? 0.42 : 0.1;
    box(tw2 + 0.03, th + 0.03, 0.04, sg * xT, tY, zT - 0.008, DARK);
    lamp(tails, tw2, th, 0.03, sg * xT, tY, zT - 0.026, [0.9, 0.0, 0.0]);
    if (!tall) lamp(tails, 0.03, th, 0.2, sg * (widthAt(-hl + 0.12) + 0.004), tY, -hl + 0.12, [0.9, 0.0, 0.0]);
    // the indicator (amber, painted into the head mesh's colour) and reversing lamp
    lamp(heads, 0.06, 0.03, 0.02, sg * (xH + 0.1), lightY - 0.075, zH + 0.01, [1, 0.55, 0.05], ang);
  }
  if (!tall && m.id !== 'pickup') lamp(tails, 0.4, 0.025, 0.03, 0, m.H - 0.04, roofR - 0.08, [0.9, 0, 0]);
  if (police) {
    // the light bar: segments, red on the driver's side, blue on the passenger's; the tail mesh's
    // instance colour drives red (r) and blue (b) separately
    for (let i = 0; i < 8; i++) {
      const x = -0.56 + i * 0.16;
      const red = x > 0;
      lamp(tails, 0.13, 0.085, 0.3, x, m.H + 0.11, barZ, red ? [1, 0, 0] : [0, 0, 1]);
    }
    // grille lights in the push bar
    for (const sg of [1, -1]) lamp(tails, 0.1, 0.04, 0.02, sg * 0.18, m.hoodH - 0.12, hl + 0.135, sg > 0 ? [1, 0, 0] : [0, 0, 1]);
  }
  // ---- the livery (police) and signage (taxi): textured quads on the doors and the roof sign
  let decal: THREE.BufferGeometry | null = null;
  if (police || m.id === 'taxi') {
    const quads: THREE.BufferGeometry[] = [];
    for (const sg of [1, -1]) {
      const z0 = police ? -0.35 : -0.3, len = police ? 2.2 : 1.4;
      const w0 = widthAt(z0) + 0.006;
      const q = new THREE.PlaneGeometry(len, police ? 0.34 : 0.18);
      // uv: the text half (v 0.5..1) on the doors; the side mirrored for the right
      const uv = q.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
      q.rotateY((sg * Math.PI) / 2);
      q.translate(sg * w0, m.beltH - (police ? 0.3 : 0.2), z0);
      quads.push(q);
    }
    if (police) {
      // the hood / roof number (v 0..0.5)
      const r = new THREE.PlaneGeometry(0.9, 0.45);
      const uv = r.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5);
      r.rotateX(-Math.PI / 2);
      r.rotateY(Math.PI);
      r.translate(0, m.H + 0.004, roofR + 0.35);
      quads.push(r);
    } else {
      for (const sg of [1, -1]) {
        const s = new THREE.PlaneGeometry(0.6, 0.16);
        const uv = s.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5);
        if (sg < 0) s.rotateY(Math.PI);
        s.translate(0, m.H + 0.11, (roofF + roofR) / 2 + sg * 0.152);
        quads.push(s);
      }
    }
    decal = mergeColored(quads.map((q) => colorize(q, [1, 1, 1])));
  }
  return { body: mergeColored(bodyParts), glass: mergeColored(glassParts.map((g) => colorize(g, [1, 1, 1]))), heads: mergeColored(heads), tails: mergeColored(tails), decal };
}

/** the livery texture: top half the door text (POLICE / TAXI), bottom half the roof number */
export function liveryTexture(kind: 'police' | 'taxi'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 512);
  if (kind === 'police') {
    // door: a blue-and-green band with POLICE over it
    g.fillStyle = '#0d2c6b';
    g.fillRect(0, 120, 1024, 40);
    g.fillStyle = '#0f7a4e';
    g.fillRect(0, 165, 1024, 18);
    g.fillStyle = '#0d2c6b';
    g.font = '900 104px "Titillium Web", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('POLICE', 512, 105);
    g.font = '700 30px Arial';
    g.fillStyle = '#ffffff';
    g.fillText('CITY OF MIAMI', 512, 152);
    // the roof number
    g.fillStyle = '#0d2c6b';
    g.font = '900 200px Arial';
    g.fillText(String(100 + Math.floor(Math.random() * 800)), 512, 440);
  } else {
    g.fillStyle = '#111111';
    g.font = '900 120px Arial';
    g.textAlign = 'center';
    g.fillText('TAXI', 512, 110);
    for (let i = 0; i < 32; i++) {
      g.fillStyle = i % 2 ? '#111' : '#f2c41b';
      g.fillRect(i * 32, 140, 32, 24);
      g.fillStyle = i % 2 ? '#f2c41b' : '#111';
      g.fillRect(i * 32, 164, 32, 24);
    }
    g.fillStyle = '#f7f2e0';
    g.fillRect(0, 256, 1024, 256);
    g.fillStyle = '#c81e1e';
    g.font = '900 170px Arial';
    g.fillText('TAXI', 512, 450);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a traffic wheel: tyre with a shoulder, a dished rim with spokes, the disc and caliper behind */
export function carWheel(R: number, W: number, style: 'alloy' | 'steel' | 'black'): THREE.BufferGeometry {
  const r = R * 0.66;
  const tyre = latheX(
    [
      [r - 0.01, -W / 2 + 0.03],
      [r + 0.02, -W / 2 + 0.005],
      [R - 0.05, -W / 2 - 0.005],
      [R - 0.015, -W / 2 + 0.02],
      [R, -W / 2 + 0.05],
      [R, W / 2 - 0.05],
      [R - 0.015, W / 2 - 0.02],
      [R - 0.05, W / 2 + 0.005],
      [r + 0.02, W / 2 - 0.005],
      [r - 0.01, W / 2 - 0.03],
    ],
    18,
  );
  const rimC: RGB = style === 'black' ? [0.07, 0.07, 0.075] : style === 'steel' ? [0.32, 0.32, 0.33] : [0.66, 0.67, 0.69];
  const parts: THREE.BufferGeometry[] = [colorize(tyre, [0.035, 0.035, 0.038])];
  // the barrel (inside the rim) and the disc
  const barrel = latheX([[r * 0.98, W / 2 - 0.03], [r * 0.95, -W / 2 + 0.04]], 12);
  parts.push(colorize(barrel, [0.12, 0.12, 0.13]));
  const disc = new THREE.CylinderGeometry(r * 0.78, r * 0.78, 0.025, 12, 1, true);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-0.01, 0, 0);
  parts.push(colorize(disc, [0.28, 0.28, 0.29]));
  // the face: a dished centre, spokes, a hub cap
  const x0 = W / 2 - 0.035;
  const lip = latheX([[r * 0.99, x0 + 0.012], [r * 0.92, x0]], 16);
  parts.push(colorize(lip, rimC));
  const hub = new THREE.CylinderGeometry(r * 0.22, r * 0.26, 0.05, 10);
  hub.rotateZ(Math.PI / 2);
  hub.translate(x0 - 0.01, 0, 0);
  parts.push(colorize(hub, rimC));
  if (style === 'steel') {
    const face = new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.02, 20);
    face.rotateZ(Math.PI / 2);
    face.translate(x0 - 0.03, 0, 0);
    parts.push(colorize(face, rimC));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const hole = new THREE.CylinderGeometry(0.03, 0.03, 0.024, 8);
      hole.rotateZ(Math.PI / 2);
      hole.translate(x0 - 0.028, Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
      parts.push(colorize(hole, [0.05, 0.05, 0.05]));
    }
  } else {
    const n = style === 'black' ? 6 : 5;
    for (let i = 0; i < n; i++) {
      for (const off of style === 'black' ? [0] : [-0.09, 0.09]) {
        const b = new THREE.BoxGeometry(0.035, r * 0.74, style === 'black' ? 0.07 : 0.04);
        b.translate(0, r * 0.57, 0);
        b.rotateZ(0.12);
        b.rotateX((i / n) * Math.PI * 2 + off);
        b.translate(x0 - 0.02, 0, 0);
        parts.push(colorize(b, rimC));
      }
    }
  }
  return mergeColored(parts);
}
