import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Frame, Geo, TrackSpace } from './geo.ts';
import { GARAGE_W, L, type PitPlan } from './layout.ts';
import { H, tyre } from './building.ts';
import type { PrintAtlas } from './textures.ts';

/**
 * The ten team garages: lit partition walls with team stripes, the branded
 * back wall with screens, a dark ceiling with light strips (which the epoxy
 * floor shader mirrors), overhead gantries with cable booms and hanging TVs,
 * tyre racks full of blanketed sets (compound-coded), roll cabinets, the
 * engineers' desk, a spare front wing on its trolley, and the next sets of
 * tyres waiting at the front.
 */

const COMPOUNDS = [0xe3202e, 0xf3c300, 0xeeeeee, 0x2fb34a, 0x1f6fd6];

export function buildGarages(plan: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: { solid: Geo; detail: Geo; print: Geo; paint: Geo; paintUV: [number, number, number, number] }) {
  const { solid, detail, print, paint } = o;
  const F = L.front, GB = L.garageBack;
  const fr = new Frame();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  TEAMS.forEach((team, t) => {
    const g0 = plan.teamS0 + t * GARAGE_W, g1 = g0 + GARAGE_W;
    const c = (g0 + g1) / 2;
    const prim = new THREE.Color(team.primary);
    const sec = new THREE.Color(team.secondary);
    const acc = new THREE.Color(team.accent);
    const dark = prim.r + prim.g + prim.b < 0.12;
    const stripe = dark ? acc : prim;

    // ---------------------------------------------------------------- walls
    // side partitions (facing into the garage), lit look
    for (const [s, dir] of [[g0 + 0.16, 1], [g1 - 0.16, -1]] as [number, 1 | -1][]) {
      fr.at(ts, s, (F + GB) / 2 + 0.5, 0);
      solid.color(0xd9dbdd).mat(0.6, 0, 0.28, 0);
      fr.panel(solid, 0, H.door / 2, 0, dir, 0, 0, GB - F - 1, H.door);
      solid.color(stripe).mat(0.45, 0.1, 0.35, 0);
      fr.panel(solid, dir * 0.005, 2.35, 0, dir, 0, 0, GB - F - 1, 0.35);
      solid.color(0x2a2c30).mat(0.7, 0, 0.05, 0);
      fr.panel(solid, dir * 0.005, 0.1, 0, dir, 0, 0, GB - F - 1, 0.2);
    }
    // back wall: branded centre panel, team-colour flanks, screens
    {
      fr.at(ts, c, GB - 0.08, 0);
      print.rgb(1, 1, 1).mat(0.5, 0, 0.55, 0);
      fr.panel(print, 0, 2.25, 0, 0, 0, -1, 8.4, 4.2, atlas.uv('back' + t));
      solid.color(stripe, dark ? 0.6 : 0.85).mat(0.5, 0.1, 0.3, 0);
      for (const x of [-6.6, 6.6]) fr.panel(solid, x, H.door / 2, 0.01, 0, 0, -1, 4.6, H.door);
      // screens on the flanks
      for (const x of [-7.3, -5.9, 5.9, 7.3]) {
        solid.color(0x0b0b0d).mat(0.4, 0.3, 0, 0);
        fr.box(solid, x, 2.6, -0.06, 1.3, 0.8, 0.06);
        print.rgb(1, 1, 1).mat(0.3, 0, 1.5, 0);
        fr.panel(print, x, 2.6, -0.1, 0, 0, -1, 1.2, 0.7, atlas.uv('mon' + ((t + Math.round(x)) & 3), 5));
      }
    }
    // ceiling + light strips (rows match the epoxy reflection shader)
    solid.color(0x121315).mat(0.9, 0, 0.02, 0);
    ts.flat(solid, g0 + 0.16, g1 - 0.16, F + 0.9, GB, H.door, -1, 6);
    for (let i = 0; i < 4; i++) {
      const l = F + 3.2 + i * 4.1;
      detail.color(0x2a2c30).mat(0.5, 0.5, 0, 0);
      ts.box(detail, g0 + 1.0, g1 - 1.0, l - 0.45, l + 0.45, H.door - 0.12, H.door - 0.01, 4 | 16 | 32 | 1 | 2);
      detail.rgb(1, 0.98, 0.94).mat(0.4, 0, 6, 0);
      ts.flat(detail, g0 + 1.2, g1 - 1.2, l - 0.34, l + 0.34, H.door - 0.125, -1, 6);
    }
    // light spill onto the lintel from outside
    detail.rgb(1, 0.97, 0.9).mat(0.4, 0, 4, 0);
    ts.flat(detail, g0 + 0.8, g1 - 0.8, F + 0.05, F + 0.3, H.door - 0.01, -1, 6);

    // ---------------------------------------------------------------- overhead gantries + booms
    for (const bs of [g0 + 4.5, g1 - 4.5]) {
      detail.color(sec).mat(0.45, 0.5, 0, 0);
      for (const d of [-0.35, 0.35]) ts.box(detail, bs + d - 0.06, bs + d + 0.06, F + 1.2, GB - 1.0, 3.95, 4.07, 63, 6);
      for (let l = F + 1.4; l < GB - 1; l += 1.6) ts.box(detail, bs - 0.35, bs + 0.35, l - 0.03, l + 0.03, 3.97, 4.05, 63);
      // cable boom: drop tube, swing arm, coiled umbilical
      fr.at(ts, bs, F + 6.5, 0);
      detail.color(0x2d3035).mat(0.45, 0.6, 0, 0);
      fr.cyl(detail, 0, 3.5, 0, 'y', 0.06, 1.0, 8, false);
      fr.beam(detail, V(0, 3.0, 0), V(0, 3.0, -2.4), 0.09);
      detail.color(0x151618).mat(0.7, 0, 0, 0);
      fr.cyl(detail, 0, 2.2, -2.3, 'y', 0.035, 1.6, 6, false);
      fr.cyl(detail, 0, 2.95, -1.2, 'z', 0.1, 0.5, 10, true);
      // TV hanging from the gantry, facing the lane
      fr.at(ts, bs, F + 1.7, 0);
      detail.color(0x0c0c0e).mat(0.4, 0.3, 0, 0);
      fr.box(detail, 0, 3.35, 0.04, 1.5, 0.88, 0.08);
      fr.box(detail, 0, 3.85, 0.04, 0.05, 0.25, 0.05);
      print.rgb(1, 1, 1).mat(0.3, 0, 1.3, 0);
      fr.panel(print, 0, 3.35, -0.005, 0, 0, -1, 1.4, 0.79, atlas.uv(bs < c ? 'tv' : 'mon1', 4));
      print.rgb(1, 1, 1).mat(0.3, 0, 1.3, 0);
      fr.panel(print, 0, 3.35, 0.085, 0, 0, 1, 1.4, 0.79, atlas.uv('mon2', 4));
    }

    // ---------------------------------------------------------------- tyre racks along the side walls
    const blanket = dark ? new THREE.Color(team.primary).lerp(new THREE.Color(0x202225), 0.4) : prim.clone().multiplyScalar(0.8);
    let set = t;
    for (const [s, dir] of [[g0 + 0.72, 1], [g1 - 0.72, -1]] as [number, number][]) {
      fr.at(ts, s, F + 1.2, 0);
      detail.color(0x8a9097).mat(0.5, 0.15, 0, 0);
      for (const y of [0.05, 0.86]) fr.box(detail, 0, y, 3.3, 0.9, 0.05, 6.6);
      for (const z of [0, 6.6]) fr.box(detail, 0, 0.8, z, 0.9, 1.6, 0.06);
      for (let row = 0; row < 2; row++)
        for (let k = 0; k < 8; k++) {
          const cmp = COMPOUNDS[(Math.floor(k / 4) + row * 2 + set) % 5];
          tyre(detail, fr, 0, 0.44 + row * 0.81, 0.45 + k * 0.8, 'x', k % 4 === 3 && row === 1 ? null : blanket, cmp, 0.35, 0.36);
        }
      set += 2;
      void dir;
    }
    // next sets waiting at the front on trolleys (stacks of two, flat)
    for (const [x, z] of [[-6.2, 1.2], [6.2, 1.2], [-6.2, 2.1], [6.2, 2.1]] as [number, number][]) {
      fr.at(ts, c + x, F + z, 0);
      detail.color(0x5a5e64).mat(0.5, 0.2, 0, 0);
      fr.box(detail, 0, 0.12, 0, 0.8, 0.06, 0.8);
      for (let h = 0; h < 2; h++) tyre(detail, fr, 0, 0.35 + h * 0.37, 0, 'y', blanket, COMPOUNDS[t % 3], 0.35, 0.36);
    }

    // ---------------------------------------------------------------- roll cabinets + desk
    for (const x of [-7.2, -5.8, 5.8, 7.2]) {
      fr.at(ts, c + x, GB - 0.75, 0);
      solid.color(stripe).mat(0.35, 0.3, 0.12, 0);
      fr.box(solid, 0, 0.55, 0, 1.3, 1.0, 0.62);
      solid.color(0x1c1d20).mat(0.4, 0.5, 0, 0);
      fr.box(solid, 0, 1.07, 0, 1.34, 0.04, 0.66);
      for (let d = 0; d < 5; d++) fr.box(solid, 0, 0.18 + d * 0.18, -0.315, 1.2, 0.02, 0.02);
      solid.color(0x1c1d20).mat(0.6, 0, 0, 0);
      for (const dx of [-0.55, 0.55]) fr.cyl(solid, dx, 0.04, 0, 'x', 0.04, 0.05, 6, true);
    }
    // engineers' desk facing the back wall screens
    fr.at(ts, c, GB - 3.2, 0);
    detail.color(0x1a1b1e).mat(0.45, 0.3, 0, 0);
    fr.box(detail, 0, 0.95, 0, 6.2, 0.05, 0.8);
    for (const x of [-3, 3]) fr.box(detail, x, 0.47, 0, 0.06, 0.94, 0.7);
    for (let m = 0; m < 5; m++) {
      const x = -2.4 + m * 1.2;
      detail.color(0x0b0b0d).mat(0.35, 0.3, 0, 0);
      fr.box(detail, x, 1.3, 0.25, 1.0, 0.6, 0.05);
      print.rgb(1, 1, 1).mat(0.3, 0, 1.4, 0);
      fr.panel(print, x, 1.3, 0.22, 0, 0, -1, 0.94, 0.54, atlas.uv('mon' + ((m + t) & 3), 5));
    }

    // ---------------------------------------------------------------- spare front wing on a trolley
    fr.at(ts, c, F + 9.5, 0, Math.PI / 2);
    detail.color(0x4a4e54).mat(0.45, 0.7, 0, 0);
    fr.box(detail, 0, 0.3, 0, 1.4, 0.05, 0.7);
    for (const x of [-0.6, 0.6]) fr.box(detail, x, 0.55, 0, 0.05, 0.5, 0.05);
    detail.color(0x151515).mat(0.28, 0.2, 0, 0);
    fr.box(detail, 0, 0.82, 0, 1.9, 0.03, 0.42);
    fr.box(detail, 0, 0.88, -0.12, 1.85, 0.03, 0.2);
    fr.box(detail, 0, 0.93, -0.2, 1.8, 0.025, 0.12);
    detail.color(stripe).mat(0.35, 0.2, 0, 0);
    for (const x of [-0.96, 0.96]) fr.box(detail, x, 0.9, 0, 0.03, 0.2, 0.5);
    detail.color(sec).mat(0.35, 0.2, 0, 0);
    fr.box(detail, 0, 0.86, 0.23, 0.22, 0.07, 0.08);

    // ---------------------------------------------------------------- floor paint: two car bays
    const white = o.paintUV;
    paint.rgb(0.8, 0.8, 0.78).mat(0.4, 0.2, 0, 0);
    const up = V(0, 1, 0);
    const rect = (s0: number, s1: number, l0: number, l1: number) => {
      paint.quad(ts.P(s0, l0, 0.062), ts.P(s1, l0, 0.062), ts.P(s1, l1, 0.062), ts.P(s0, l1, 0.062), up, white);
    };
    for (const bs of [g0 + 4.5, g1 - 4.5]) {
      const a = bs - 1.3, b = bs + 1.3, l0 = F + 2.2, l1 = F + 8.6;
      rect(a, b, l0, l0 + 0.08);
      rect(a, b, l1 - 0.08, l1);
      rect(a, a + 0.08, l0, l1);
      rect(b - 0.08, b, l0, l1);
    }
    paint.color(stripe).mat(0.4, 0.2, 0, 0);
    rect(g0 + 0.5, g1 - 0.5, GB - 1.6, GB - 1.45);
  });
}
