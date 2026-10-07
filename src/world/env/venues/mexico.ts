import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { CANAL, MX_LAKE, MX_SITES, MX_WATER_Y } from './mexicoLand.ts';
import { reserveVenueAds } from './venueAdPlans.ts';

/**
 * The Autódromo Hermanos Rodríguez's layout: where the stands, fans, paths, the water and the
 * landmark sites go. The long run of grandstands on the north side of the main straight
 * (opposite the pits, the paddock in the infield), the big stands round Turns 1–3, at Turn 4
 * and the hairpin, and the signature piece: the Foro Sol, the baseball stadium the lap runs
 * through between Turns 13 and 16 — a steep horseshoe of packed stands wrapped round the
 * field, a stand across the outfield, the podium in the middle. Then the Peraltada's remnant
 * with its own stand on the outside.
 *
 * Extra sites for venues/mexicoScenery.ts ride on the returned layout as `mexico`.
 */

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

export interface MexicoSites {
  /** the Foro Sol's bowl: centre, and the stands that make it (indices into layout.grandstands) */
  foro: { x: number; z: number; stands: number[] };
  /** the podium: on the outfield side of the stadium straight, facing the main stand */
  podium: { x: number; z: number; rot: number };
}
export type MexicoLayout = Layout & { mexico: MexicoSites };

export function planMexico(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): MexicoLayout {
  const L = -1, R = 1;
  const N = track.length;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  const t1 = corner('Turn 1');
  const t2 = corner('Turn 2');
  const t3 = corner('Turn 3');
  const t4 = corner('Turn 4');
  const t6 = corner('Turn 6');
  const t12 = corner('Turn 12');
  const t13 = corner('Turn 13');
  const per = corner('Peraltada');

  // ---------------------------------------------------------------- the Foro Sol
  // the horseshoe of the stadium's own stands, wrapped round the outside of the lap through
  // the field (south, then west), steep and very tall; its segments short so it follows the curve
  const foroStands: number[] = [];
  const mark = (fn: () => void) => {
    const n0 = gs.length;
    fn();
    for (let k = n0; k < gs.length; k++) foroStands.push(k);
  };
  mark(() => addStand('Foro Sol', t13.sApex + 14, N + 128, L, 40, 'open', 6, 16));
  // the east side of the bowl: a stand along the run from Turn 12 into the stadium
  mark(() => addStand('Foro Sol Oriente', t12.sEnd + 40, t13.sStart - 6, R, 30, 'open', 6, 26));
  // the outfield stand across the field, facing the main bowl (the podium stands in front of it)
  mark(() => addStand('Foro Sol Jardín', 18, 76, R, 16, 'covered', 18, 29));

  // ---------------------------------------------------------------- grandstands
  // the Peraltada: the outside of the final corner, between the track and the Viaducto
  addStand('Grada 6 Peraltada', per.sStart + 20, per.sEnd - 12, L, 22, 'covered', 7, 34);
  // the main straight, opposite the pits (the paddock is in the infield, right)
  addStand('Grada 5', per.sEnd + 30, 560, L, 22, 'covered', 7, 70);
  addStand('Grada Principal', 570, 830, L, 30, 'centrale', 7, 90);
  addStand('Grada 4', 840, 1110, L, 24, 'covered', 7, 70);
  addStand('Grada 3', 1120, 1400, L, 24, 'covered', 7, 70);
  // the far end of the straight, after the pit exit: the infield side too
  addStand('Grada 14', 1100, 1420, R, 18, 'open', 7, 64);
  // Turns 1–3: the braking zone and the outside of the first corner, the esses beyond
  addStand('Grada 1', 1410, t1.sStart - 4, L, 26, 'covered', 7, 55);
  addStand('Grada 2', t2.sStart - 50, t2.sEnd + 6, R, 18, 'open', 7, 50);
  addStand('Grada 15', t3.sStart - 50, t3.sStart + 4, L, 16, 'open', 7, 50);
  // Turn 4 (the braking zone at the end of the back straight) and the hairpin
  addStand('Grada 7', t4.sStart - 160, t4.sStart - 10, R, 22, 'covered', 7, 70);
  addStand('Grada 9', t6.sStart - 70, t6.sStart + 2, L, 16, 'open', 7, 50);
  // Turn 12, at the end of the back straight
  addStand('Grada 10', t12.sStart - 150, t12.sStart - 12, L, 20, 'covered', 7, 70);

  // ---------------------------------------------------------------- general admission (flat grass, low banks)
  const banks: SpectatorBank[] = [];
  const addBank = (sA: number, sB: number, side: number, rise: number, density: number, gap = 5, width = 16) => {
    let bar = 0;
    for (let s = sA; s <= sB; s += 3) bar = Math.max(bar, track.barrierAt(s, side));
    const latA = side * (bar + gap), latB = side * (bar + gap + width);
    banks.push({ sA, sB, side, latA, latB, rise, density });
    map.trackPads.push({ sA, sB, latA, latB, offset: rise, blend: 9 });
    for (let s = sA; s <= sB; s += 18) {
      track.point(s, (latA + latB) / 2, 0, p);
      map.clearings.push({ x: p.x, z: p.z, r: width * 0.75, soft: 10, keep: 0.05 });
    }
  };
  addBank(t3.sEnd + 60, t3.sEnd + 300, R, 1.0, 0.6, 5, 14);
  addBank(t4.sEnd + 20, t4.sEnd + 60, L, 1.0, 0.7, 5, 14);
  addBank(corner('Turn 7').sStart - 120, corner('Turn 7').sStart - 10, L, 1.0, 0.65, 5, 16);
  addBank(corner('Turn 8').sEnd + 10, corner('Turn 9').sStart - 5, R, 0.9, 0.6, 5, 14);
  addBank(corner('Turn 10').sStart - 90, corner('Turn 10').sStart - 10, L, 0.9, 0.6, 5, 14);
  addBank(corner('Turn 11').sEnd + 40, corner('Turn 11').sEnd + 200, R, 0.9, 0.5, 5, 14);

  // ---------------------------------------------------------------- open ground
  // the paddock (between the garages and the infield) and the hospitality behind it
  for (let s = 420; s <= 1060; s += 40) { const q = at(s, 115); clear(q.x, q.z, 48, 24, 0.05); }
  // concourse and the service road behind the main stands, down to the Viaducto
  for (let s = 380; s <= 1480; s += 50) { const q = at(s, -(track.barrierAt(s, -1) + 55)); clear(q.x, q.z, 34, 18, 0.12); }
  // the Foro Sol: nothing grows in the stadium
  clear(MX_SITES.foro.x, MX_SITES.foro.z, 175, 30, 0);
  // the stadium's concourse: paved all round the outside of the bowl
  for (const k of foroStands) {
    const g = gs[k];
    if (g.name === 'Foro Sol Jardín') continue;
    const c = g.center.clone().addScaledVector(g.facing, -g.depth / 2 - 11);
    map.worldPads.push({ cx: c.x, cz: c.z, halfW: g.length / 2 + 5, halfL: 11, angle: Math.atan2(g.facing.x, g.facing.z), h: g.y0, blend: 10, paved: true });
  }
  // the Palacio de los Deportes' forecourt and car parks
  clear(MX_SITES.palacio.x, MX_SITES.palacio.z, MX_SITES.palacio.r + 70, 30, 0.05);
  // the sports city's fields south of the lap: football and baseball pitches, running tracks
  for (const [x, z, r] of [[-560, 420, 110], [-300, 480, 90], [-80, 380, 80], [120, 560, 80], [620, 520, 90], [-620, 130, 70], [-260, 150, 80]] as const) clear(x, z, r, 30, 0.08);
  // open lawns round the lake
  clear(MX_LAKE.x, MX_LAKE.z, Math.max(MX_LAKE.rx, MX_LAKE.rz) + 40, 25, 0.2);

  // ---------------------------------------------------------------- water: the rowing course and the lake
  {
    const B = CANAL;
    const dx = B.bx - B.ax, dz = B.bz - B.az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const cx = (B.ax + B.bx) / 2, cz = (B.az + B.bz) / 2;
    // the water: a sharp-edged pad so the concrete banks stay vertical at the fine resolution
    map.worldPads.push({ cx, cz, halfW: B.half, halfL: len / 2, angle: Math.atan2(ux, uz), h: MX_WATER_Y - 2.6, blend: 2.5 });
    map.exclusions.push({ cx, cz, halfW: B.half + 6, halfL: len / 2 + 6, angle: Math.atan2(ux, uz) });
    // promenades along both banks
    for (const sd of [-1, 1]) {
      const off = B.half + 6;
      const pts: V2[] = [];
      for (let d = -len / 2 - 6; d <= len / 2 + 6; d += 20) pts.push({ x: cx + ux * d - uz * off * sd, z: cz + uz * d + ux * off * sd });
      map.paths.push({ pts, width: sd > 0 ? 8 : 5, kind: sd > 0 ? 2 : 1 });
    }
  }
  {
    const K = MX_LAKE;
    // (the lake's bed: a pad well under the water; the shore comes from mexicoNatural's banks)
    map.worldPads.push({ cx: K.x, cz: K.z, halfW: K.rx * 0.75, halfL: K.rz * 0.7, angle: K.rot + Math.PI / 2, h: MX_WATER_Y - 2.2, blend: 20 });
    map.exclusions.push({ cx: K.x, cz: K.z, halfW: K.rx + 6, halfL: K.rz + 6, angle: K.rot + Math.PI / 2 });
  }
  // eucalyptus lines along the rowing course and the park avenues
  const avenueTrees: V2[] = [];
  const poplarRows: V2[] = [];
  {
    const B = CANAL;
    for (let x = B.ax + 10; x < B.bx - 10; x += 11) for (const sd of [-1, 1]) poplarRows.push({ x, z: B.az + sd * (B.half + 16) });
  }

  // ---------------------------------------------------------------- paths & roads
  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // service road behind the main-straight grandstands
  map.paths.push({ pts: trackLine(per.sEnd, t1.sStart - 30, (s) => -(track.barrierAt(s, -1) + 52), 12), width: 8, kind: 2 });
  // the Viaducto Río de la Piedad along the north, Río Churubusco down the east side
  {
    const via: V2[] = [];
    for (let x = map.SQUARE.x0 + 40; x <= map.SQUARE.x1 - 40; x += 40) via.push({ x, z: MX_SITES.viaductoZ(x) });
    map.paths.push({ pts: via, width: 34, kind: 2 });
    const chu: V2[] = [];
    for (let z = map.SQUARE.z0 + 40; z <= map.SQUARE.z1 - 40; z += 40) chu.push({ x: 1060 + 0.08 * z, z });
    map.paths.push({ pts: chu, width: 30, kind: 2 });
    // and the avenue along the south of the sports city
    const sur: V2[] = [];
    for (let x = map.SQUARE.x0 + 40; x <= map.SQUARE.x1 - 40; x += 40) sur.push({ x, z: 1180 - 0.05 * x });
    map.paths.push({ pts: sur, width: 26, kind: 2 });
    // avenue trees along the Viaducto's verges
    for (let x = -1200; x <= 1100; x += 13) for (const sd of [-1, 1]) avenueTrees.push({ x, z: MX_SITES.viaductoZ(x) + sd * 24 });
  }
  // spectator walkways behind the fences round the back of the circuit
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2 * Math.sin(s * 0.013)), 9), width: 3.6, kind: 1 });
  };
  walk(t3.sEnd + 30, t4.sStart - 180, L, 18);
  walk(t6.sEnd + 30, corner('Turn 7').sStart - 130, R, 16);
  walk(corner('Turn 11').sEnd + 30, t12.sStart - 170, R, 16);
  walk(corner('Turn 11').sEnd + 30, t12.sStart - 170, L, 18);

  // ---------------------------------------------------------------- big screens
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, side: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 6) => {
    const lat = side * (track.barrierAt(s, side) + back);
    const q = at(s, lat);
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.heightAt(s), rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
    map.clearings.push({ x: q.x, z: q.z, r: 12, soft: 10, keep: 0.2 });
  };
  screenAt(1180, R, 900, L, 40, 14, 8, 30);
  screenAt(t1.sStart + 20, R, t1.sStart - 60, L, 40, 12, 7, 20);
  screenAt(t4.sEnd + 30, L, t4.sStart - 90, R, 40);
  screenAt(t12.sEnd + 10, R, t12.sStart - 80, L, 40);

  // ---------------------------------------------------------------- flags on poles behind the covered stands
  const flagpoles: V2[] = [];
  for (const g of gs) {
    if (g.style === 'open' && !g.name.startsWith('Foro Sol')) continue;
    const n = Math.max(2, Math.round(g.length / 18));
    for (let k = 0; k <= n; k++) {
      const tt = k / n - 0.5;
      const along = new THREE.Vector3(g.facing.z, 0, -g.facing.x);
      flagpoles.push({ x: g.center.x + along.x * tt * g.length - g.facing.x * (g.depth / 2 + 1.5), z: g.center.z + along.z * tt * g.length - g.facing.z * (g.depth / 2 + 1.5) });
    }
  }

  // ---------------------------------------------------------------- landmark sites (built by mexicoScenery.ts)
  // the Palacio de los Deportes stands on a level plaza
  {
    const P = MX_SITES.palacio;
    const y = map.naturalExact(P.x, P.z);
    map.worldPads.push({ cx: P.x, cz: P.z, halfW: P.r + 22, halfL: P.r + 22, angle: 0, h: y, blend: 16, paved: true });
    map.exclusions.push({ cx: P.x, cz: P.z, halfW: P.r + 14, halfL: P.r + 14, angle: 0 });
  }
  // the stadium's podium: on the outfield side, in front of the Jardín stand
  const podS = 47;
  const podQ = at(podS, track.barrierAt(podS, R) + 8);
  const podLook = at(podS, 0);
  const podium = { x: podQ.x, z: podQ.z, rot: Math.atan2(podLook.x - podQ.x, podLook.z - podQ.z) };

  // the race weekend's own hoardings and LED boards (venueAdPlans.ts): keep the trees off them
  reserveVenueAds(track, map);

  // ---------------------------------------------------------------- hospitality & TV towers
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[1250, 1], [3780, -1]], 40);
  addCameraTowers(track, map, landmarks, ['Turn 1', 'Turn 4', 'Turn 6', 'Turn 7', 'Turn 10', 'Turn 12', 'Peraltada']);

  const pit = track.pit;
  const pitSpec = {
    sA: pit.sStart,
    sB: pit.sEnd,
    side: pit.side,
    front: pit.garageOffset + 0.5,
    depth: 26,
    paddockTo: 125,
    y0: track.heightAt(pit.sStart),
    y1: track.heightAt(pit.sEnd),
  };
  return {
    grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows, avenueTrees, villages: [], landmarks,
    mexico: { foro: { x: MX_SITES.foro.x, z: MX_SITES.foro.z, stands: foroStands }, podium },
  };
}

// ---------------------------------------------------------------- fans & flags

/** the crowd: el Tricolor's green, white and red everywhere, Checo's Red Bull navy, sombreros and team kit */
export const MEXICO_FANS = {
  tricolor: ['#006847', '#0a7a52', '#ffffff', '#f4f4f4', '#ce1126', '#d7182a', '#006847', '#ce1126'],
  checo: ['#1e2a5a', '#23326e', '#ffcc00', '#d4202c'],
};

/** flags 0–3: the Mexican flag, a ¡VAMOS MÉXICO! banner, a CHECO 11 banner, a green-white-red MÉXICO banner */
export function drawMexicoFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number, txt: (x: number, y: number, s: string, size: number, col: string) => void) {
  // 0: the flag: vertical green–white–red, the eagle on a nopal (simplified) in the centre
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#006847';
    ctx.fillRect(x, y, S / 3 + 1, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + S / 3, y, S / 3 + 1, S);
    ctx.fillStyle = '#ce1126';
    ctx.fillRect(x + (2 * S) / 3, y, S / 3, S);
    coatOfArms(ctx, x + S / 2, y + S / 2, S * 0.13);
  }
  // 1: ¡VAMOS MÉXICO! on green
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#006847';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S * 0.7, S, S * 0.08);
    ctx.fillStyle = '#ce1126';
    ctx.fillRect(x, y + S * 0.78, S, S * 0.08);
    txt(x + S / 2, y + S * 0.3, '¡VAMOS', 62, '#ffffff');
    txt(x + S / 2, y + S * 0.52, 'MÉXICO!', 62, '#ffffff');
  }
  // 2: CHECO 11, Red Bull navy with the red and yellow
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#1e2a5a';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#d4202c';
    ctx.fillRect(x, y + S * 0.66, S, S * 0.08);
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(x, y + S * 0.74, S, S * 0.05);
    txt(x + S / 2, y + S * 0.3, 'CHECO', 68, '#ffffff');
    txt(x + S / 2, y + S * 0.52, '11', 72, '#ffcc00');
  }
  // 3: MÉXICO in the tricolour, horizontal
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#006847';
    ctx.fillRect(x, y, S, S / 3 + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S / 3, S, S / 3 + 1);
    ctx.fillStyle = '#ce1126';
    ctx.fillRect(x, y + (2 * S) / 3, S, S / 3);
    txt(x + S / 2, y + S * 0.5, 'MÉXICO', 58, '#006847');
  }
}

/** the coat of arms, simplified: a brown eagle on a green nopal over a blue-green lake, in a laurel wreath */
function coatOfArms(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // wreath
  ctx.strokeStyle = '#4a7a2a';
  ctx.lineWidth = r * 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.1, r * 0.95, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  // lake and nopal
  ctx.fillStyle = '#3d7fa6';
  ctx.fillRect(cx - r * 0.6, cy + r * 0.62, r * 1.2, r * 0.18);
  ctx.fillStyle = '#3f8a3a';
  for (const [u, v, w, h] of [[0, 0.35, 0.28, 0.3], [-0.3, 0.2, 0.2, 0.24], [0.3, 0.2, 0.2, 0.24]]) {
    ctx.beginPath();
    ctx.ellipse(cx + u * r, cy + v * r, w * r, h * r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // eagle: body, spread wing, head, the serpent in its beak
  ctx.fillStyle = '#6b4424';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.05, cy - r * 0.15, r * 0.28, r * 0.38, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.1, cy - r * 0.3);
  ctx.lineTo(cx - r * 0.85, cy - r * 0.85);
  ctx.lineTo(cx - r * 0.55, cy - r * 0.2);
  ctx.lineTo(cx - r * 0.75, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - r * 0.18, cy - r * 0.55, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3f8a3a';
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, cy - r * 0.55);
  ctx.quadraticCurveTo(cx - r * 0.5, cy - r * 0.3, cx - r * 0.35, cy - r * 0.1);
  ctx.stroke();
}
