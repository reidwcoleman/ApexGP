import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap, V2 } from '../worldmap.ts';
import type { GrandstandSpec, Landmark, Layout, ScreenSpec, SpectatorBank, StandStyle } from '../layout.ts';
import { addCameraTowers, addHospitality } from '../layout.ts';
import { coastPoint } from './zandvoortLand.ts';

/**
 * Circuit Zandvoort: where everything goes.
 *
 *   main straight     the Hoofdtribune east of the straight (the Hugenholtz loop squeezes it
 *                     in the middle), the pits and paddock west of it, the foredune and the
 *                     beach beyond
 *   Tarzanbocht       the big stand wrapping the outside of the hairpin, on the dune
 *   Hugenholtzbocht   the stand on the dune above the banking
 *   Hunserug … T7     fans all over the dune slopes (general admission), a stand at Scheivlak
 *   Mastersbocht      a stand in the east loop
 *   Hans Ernst        the Arena: stands outside the chicane
 *   Kumho, Luyendijk  stands outside the last two corners, the big one on the banking
 *
 * Every stand is a sea of orange (grandstands.ts, ZANDVOORT_FANS), with orange smoke flares
 * and Dutch flags (zandvoortScenery.ts). The extra sites ride on the layout as `zandvoort`.
 */

export interface ZandvoortSites {
  /** where orange smoke flares go up (world points on stands and dune banks) */
  flares: { x: number; y: number; z: number }[];
  /** giant Dutch flags on masts */
  masts: V2[];
}

export type ZandvoortLayout = Layout & { zandvoort: ZandvoortSites };

type AddStand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap?: number, segLen?: number) => void;

const ROW_DEPTH = 0.86;

export function planZandvoort(track: Track, map: WorldMap, addStand: AddStand, gs: GrandstandSpec[]): ZandvoortLayout {
  const L = -1, R = 1;
  const corner = (name: string) => track.corners.find((c) => c.name === name)!;
  const p = new THREE.Vector3();
  const at = (s: number, lat: number) => track.point(s, lat, 0, new THREE.Vector3());
  const clear = (x: number, z: number, r: number, soft: number, keep: number) => map.clearings.push({ x, z, r, soft, keep });

  /**
   * The part of [sA, sB] where a stand of `rows` fits on `side` without its back reaching
   * another part of the lap (the Hugenholtz loop sits right beside the main straight).
   */
  const fitRange = (sA: number, sB: number, side: number, rows: number, gap: number): [number, number] | null => {
    const depth = rows * ROW_DEPTH + 3.2;
    let best: [number, number] | null = null;
    let run: number | null = null;
    const len = track.delta(sA, sB);
    for (let d = 0; d <= len + 0.1; d += 4) {
      const s = sA + d;
      const bar = track.barrierAt(s, side);
      let ok = true;
      for (const lat of [bar + gap, bar + gap + depth * 0.5, bar + gap + depth + 6]) {
        const q = at(s, side * lat);
        if (track.distanceToOther(q.x, q.z, Math.floor(track.wrap(s)), 90) < 24) ok = false;
        if (map.inPitZone(q.x, q.z, 6)) ok = false;
      }
      if (ok) {
        if (run === null) run = s;
        if (!best || s - run > best[1] - best[0]) best = [run, s];
      } else run = null;
    }
    return best && best[1] - best[0] >= 30 ? best : null;
  };
  /** a stand, trimmed to where it fits; on a banked corner it sits on the high side's plane */
  const stand = (name: string, sA: number, sB: number, side: number, rows: number, style: StandStyle, gap = 8, segLen = 65) => {
    const r = fitRange(sA, sB, side, rows, gap);
    if (!r) return;
    const g0 = gs.length, w0 = map.worldPads.length;
    addStand(name, r[0], r[1], side, rows, style, gap, segLen);
    for (let k = g0; k < gs.length; k++) {
      const g = gs[k];
      const mid = (g.sA + g.sB) / 2;
      if (Math.abs(track.banked[Math.floor(track.wrap(mid))]) < 0.02) continue;
      const y0 = Math.min(track.point(g.sA, side * g.front, 0, p).y, track.point(g.sB, side * g.front, 0, p).y) - 0.05;
      g.y0 = y0;
      const pad = map.worldPads[w0 + (k - g0)];
      if (pad) pad.h = y0;
    }
  };

  // ---------------------------------------------------------------- grandstands
  const t1 = corner('Tarzanbocht');
  const hug = corner('Hugenholtzbocht');
  const sch = corner('Scheivlak');
  const mas = corner('Mastersbocht');
  const he = corner('Hans Ernstbocht');
  const t13 = corner('Turn 13');
  const kum = corner('Kumhobocht');
  const al = corner('Arie Luyendijkbocht');
  const t11 = corner('Turn 11');
  // the main straight: the Hoofdtribune opposite the pits, either side of the Hugenholtz loop
  stand('Hoofdtribune', 440, 600, R, 18, 'centrale', 8, 80);
  stand('Hoofdtribune Noord', 690, t1.sStart - 30, R, 16, 'covered', 8, 70);
  // Tarzan: all round the outside of the hairpin, on the dune toward the sea
  stand('Tarzan', t1.sStart - 60, t1.sApex + 10, L, 26, 'covered', 9, 60);
  stand('Tarzan Noord', t1.sApex + 16, t1.sEnd + 30, L, 20, 'open', 9, 55);
  // Gerlach: an open stand on the dune outside
  stand('Gerlach', corner('Gerlachbocht').sStart - 50, corner('Gerlachbocht').sEnd, L, 14, 'open', 8, 60);
  // Hugenholtz: the big stand on the dune above the banking
  stand('Hugenholtz', hug.sStart - 20, hug.sEnd + 20, R, 22, 'covered', 7, 50);
  // Scheivlak and the east loop
  stand('Scheivlak', sch.sStart + 20, sch.sApex + 40, L, 16, 'open', 8, 60);
  stand('Mastersbocht', mas.sStart - 90, mas.sApex, L, 18, 'covered', 8, 60);
  stand('Bocht 11', t11.sStart - 20, t11.sApex + 20, R, 14, 'open', 8, 60);
  // the Arena round the Hans Ernst chicane
  stand('Arena', he.sStart - 140, he.sStart - 6, L, 24, 'covered', 8, 65);
  stand('Arena Oost', t13.sStart - 10, t13.sEnd + 30, R, 18, 'covered', 8, 55);
  // Kumho and the banked Arie Luyendijk
  stand('Kumho', kum.sStart - 90, kum.sApex + 10, L, 20, 'covered', 8, 60);
  stand('Arie Luyendijk', al.sStart - 10, al.sEnd - 30, L, 24, 'covered', 7, 55);

  // ---------------------------------------------------------------- dune banks (general admission)
  const banks: SpectatorBank[] = [];
  const addBank = (sA: number, sB: number, side: number, rise: number, density: number, gap = 5, width = 16) => {
    const r = fitRange(sA, sB, side, Math.round(width / ROW_DEPTH), gap);
    if (!r) return;
    [sA, sB] = r;
    let bar = 0;
    for (let s = sA; s <= sB; s += 3) bar = Math.max(bar, track.barrierAt(s, side));
    const latA = side * (bar + gap), latB = side * (bar + gap + width);
    banks.push({ sA, sB, side, latA, latB, rise, density });
    map.trackPads.push({ sA, sB, latA, latB, offset: rise, blend: 12 });
    for (let s = sA; s <= sB; s += 18) {
      track.point(s, (latA + latB) / 2, 0, p);
      map.clearings.push({ x: p.x, z: p.z, r: width * 0.75, soft: 10, keep: 0.05 });
    }
  };
  const hun = corner('Hunserug');
  const rs = corner('Rob Slotemakerbocht');
  addBank(hug.sEnd + 30, hun.sStart + 40, L, 2.6, 1.0, 5, 18);
  addBank(hug.sEnd + 60, hun.sApex, R, 3.2, 1.0, 6, 20);
  addBank(hun.sEnd, rs.sStart - 10, L, 3.0, 1.0, 5, 18);
  addBank(rs.sStart - 30, rs.sEnd + 60, R, 3.6, 1.0, 6, 22);
  addBank(rs.sEnd + 70, sch.sStart - 20, R, 2.6, 0.9, 6, 18);
  addBank(sch.sApex + 50, sch.sEnd + 40, L, 2.8, 1.0, 6, 20);
  addBank(sch.sStart, sch.sEnd, R, 2.2, 0.85, 6, 18);
  addBank(mas.sApex + 20, corner('Turn 10').sStart, L, 2.4, 0.9, 5, 18);
  addBank(corner('Turn 10').sEnd + 10, t11.sStart - 40, L, 2.0, 0.8, 5, 16);
  addBank(t11.sEnd + 30, he.sStart - 170, L, 2.4, 0.95, 5, 18);
  addBank(t11.sEnd + 60, he.sStart - 40, R, 2.8, 1.0, 6, 18);
  addBank(t13.sEnd + 40, kum.sStart - 100, L, 2.2, 0.9, 5, 16);
  addBank(kum.sStart - 20, kum.sEnd + 10, R, 2.0, 0.8, 5, 16);
  addBank(corner('Gerlachbocht').sEnd + 10, hug.sStart - 30, L, 2.4, 0.95, 5, 16);

  // ---------------------------------------------------------------- open ground
  // the paddock and hospitality west of the pits, the car parks behind the Hoofdtribune
  for (let s = 420; s <= 860; s += 40) { const q = at(s, -120); clear(q.x, q.z, 48, 28, 0.05); }
  { const q = at(t1.sApex, -120); clear(q.x, q.z, 60, 40, 0.1); }
  { const q = at(hug.sApex, 60); clear(q.x, q.z, 50, 30, 0.2); }

  const trackLine = (sA: number, sB: number, latFn: (s: number) => number, step = 10): V2[] => {
    const pts: V2[] = [];
    for (let s = sA; s <= sB; s += step) {
      track.point(s, latFn(s), 0, p);
      pts.push({ x: p.x, z: p.z });
    }
    return pts;
  };
  // sandy walkways through the dunes behind the fences
  const walk = (sA: number, sB: number, side: number, off: number) => {
    map.paths.push({ pts: trackLine(sA, sB, (s) => side * (track.barrierAt(s, side) + off + 2.5 * Math.sin(s * 0.013)), 9), width: 3.2, kind: 1 });
  };
  walk(hun.sStart - 60, sch.sStart - 40, L, 30);
  walk(rs.sEnd + 40, mas.sStart - 60, R, 34);
  walk(t11.sEnd + 20, he.sStart - 180, R, 30);
  walk(t13.sEnd + 30, kum.sStart - 60, L, 28);
  // the Boulevard Barnaart along the top of the beach, and the road into town
  {
    const pts: V2[] = [];
    for (let a = -3200; a <= 2600; a += 40) {
      const q = coastPoint(map, a, 95 + 18 * Math.sin(a / 900));
      pts.push({ x: q.x, z: q.z });
    }
    map.paths.push({ pts, width: 9, kind: 2 });
  }

  // ---------------------------------------------------------------- big screens
  const screens: ScreenSpec[] = [];
  const screenAt = (s: number, side: number, lookS: number, lookSide: number, lookLat: number, w = 12, h = 7, back = 6) => {
    const lat = side * (track.barrierAt(s, side) + back);
    const q = at(s, lat);
    if (map.excluded(q.x, q.z, 4) || map.inPitZone(q.x, q.z, 8)) return;
    const look = at(lookS, lookSide * lookLat);
    const rot = Math.atan2(look.x - q.x, look.z - q.z);
    screens.push({ x: q.x, z: q.z, y: track.point(s, lat, 0, p).y, rot, w, h });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: w / 2 + 3, halfL: 4, angle: rot });
    map.clearings.push({ x: q.x, z: q.z, r: 12, soft: 10, keep: 0.2 });
  };
  screenAt(t1.sStart - 80, R, t1.sStart - 60, L, 50, 14, 8, 8);
  screenAt(hug.sApex, L, hug.sApex + 30, R, 40, 12, 7, 5);
  screenAt(he.sStart - 60, R, he.sStart - 80, L, 40);
  screenAt(al.sApex, R, al.sApex + 20, L, 40, 12, 7, 5);

  // ---------------------------------------------------------------- flags, flares
  const flagpoles: V2[] = [];
  const flares: ZandvoortSites['flares'] = [];
  for (const g of gs) {
    const along = new THREE.Vector3(g.facing.z, 0, -g.facing.x);
    if (g.style !== 'open') {
      const n = Math.max(2, Math.round(g.length / 22));
      for (let k = 0; k <= n; k++) {
        const t = k / n - 0.5;
        flagpoles.push({ x: g.center.x + along.x * t * g.length - g.facing.x * (g.depth / 2 + 1.5), z: g.center.z + along.z * t * g.length - g.facing.z * (g.depth / 2 + 1.5) });
      }
    }
    // a flare or two in the front half of most stands (the smoke rolls out from under the roof)
    const nf = g.length > 55 ? 2 : 1;
    for (let k = 0; k < nf; k++) {
      const t = (k + 0.5) / nf - 0.5 + 0.13 * Math.sin(g.sA);
      const fwd = g.depth * 0.22;
      flares.push({
        x: g.center.x + along.x * t * g.length + g.facing.x * fwd,
        z: g.center.z + along.z * t * g.length + g.facing.z * fwd,
        y: g.y0 + g.height * 0.32,
      });
    }
  }
  for (const b of banks) {
    const s = (b.sA + track.delta(b.sA, b.sB) / 2);
    const q = at(s, (b.latA + b.latB) / 2);
    flares.push({ x: q.x, y: q.y + b.rise + 0.6, z: q.z });
  }
  // giant Dutch flags on the dunes behind Tarzan and above the Hugenholtz
  const masts: V2[] = [];
  for (const [s, side, off] of [[t1.sApex - 20, L, 36], [t1.sEnd + 60, L, 30], [hug.sEnd + 40, R, 34], [al.sApex, L, 40], [al.sEnd + 10, L, 45], [he.sStart - 60, L, 42], [sch.sApex, L, 38], [rs.sApex, R, 40]] as const) {
    let q: THREE.Vector3 | null = null;
    for (const extra of [0, 12, 24]) {
      const c = at(s, side * (track.barrierAt(s, side) + off + extra));
      if (map.excluded(c.x, c.z, 2) || map.trackClearance(c.x, c.z) < 5 || map.inPitZone(c.x, c.z, 8)) continue;
      q = c;
      break;
    }
    if (!q) continue;
    masts.push({ x: q.x, z: q.z });
    flagpoles.push({ x: q.x, z: q.z });
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 2.5, halfL: 2.5, angle: 0 });
  }

  // ---------------------------------------------------------------- landmarks
  const landmarks: Landmark[] = [];
  addHospitality(track, map, landmarks, [[t1.sStart - 40, -1], [hun.sApex, 1], [kum.sStart - 150, -1]], 60);
  addCameraTowers(track, map, landmarks, ['Tarzanbocht', 'Hugenholtzbocht', 'Rob Slotemakerbocht', 'Scheivlak', 'Mastersbocht', 'Hans Ernstbocht', 'Arie Luyendijkbocht']);

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
    grandstands: gs, banks, screens, oval: null, pit: pitSpec, flagpoles, poplarRows: [], avenueTrees: [], villages: [], landmarks,
    zandvoort: { flares, masts },
  };
}

// ---------------------------------------------------------------------------- crowd & flags

/** the Orange Army: orange shirts, wigs, caps and flags everywhere, a little red-white-blue */
export const ZANDVOORT_FANS = {
  oranje: ['#ff7b00', '#ff8c1a', '#f26b00', '#ff9933', '#e86a10', '#ff6a00', '#ffa033', '#f57c00'],
  holland: ['#ae1c28', '#ffffff', '#21468b', '#f4f4f4'],
};

/**
 * Flag atlas slots 0–3 for the Dutch GP: an orange HOLLAND banner with the crown, the orange
 * pennant over the tricolour, HUP HOLLAND, and (the most common, slot 3) the Dutch tricolour.
 */
export function drawZandvoortFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number, txt: (x: number, y: number, s: string, size: number, col: string) => void) {
  const tri = (x: number, y: number, y0: number, h: number) => {
    ['#ae1c28', '#f4f4f4', '#21468b'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y + y0 + (i * h) / 3, S, h / 3 + 1);
    });
  };
  {
    const [x, y] = at(3);
    tri(x, y, 0, S);
  }
  {
    // the tricolour with an orange band on top (the royal "wimpel" colours)
    const [x, y] = at(1);
    ctx.fillStyle = '#ff7b00';
    ctx.fillRect(x, y, S, S * 0.25);
    tri(x, y, S * 0.25, S * 0.75);
  }
  {
    const [x, y] = at(0);
    ctx.fillStyle = '#ff7b00';
    ctx.fillRect(x, y, S, S);
    // a simple crown
    ctx.fillStyle = '#ffffff';
    const cx = x + S / 2, cy = y + S * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy + 22);
    ctx.lineTo(cx - 44, cy - 14);
    ctx.lineTo(cx - 20, cy + 4);
    ctx.lineTo(cx, cy - 22);
    ctx.lineTo(cx + 20, cy + 4);
    ctx.lineTo(cx + 44, cy - 14);
    ctx.lineTo(cx + 40, cy + 22);
    ctx.closePath();
    ctx.fill();
    txt(x + S / 2, y + S * 0.64, 'HOLLAND', 56, '#ffffff');
  }
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ff7b00';
    ctx.fillRect(x, y, S, S * 0.22);
    ctx.fillRect(x, y + S * 0.78, S, S * 0.22);
    txt(x + S / 2, y + S * 0.4, 'HUP', 60, '#ff6a00');
    txt(x + S / 2, y + S * 0.6, 'HOLLAND', 46, '#21468b');
  }
}
