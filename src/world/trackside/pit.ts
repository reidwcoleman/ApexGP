import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Frame3, beam, box, printQuadX, printQuadZ, type GeoBuilder } from './builder.ts';
import type { Ctx } from './context.ts';
import type { PrintAtlas } from './atlas.ts';
import { Z_APRON, Z_PIT, pitUniforms } from './materials.ts';

/**
 * Pit lane: tarmac lane between the pit wall and the garages (fast + working
 * lane), a concrete service apron to garageOffset + 0.5 m, a service apron
 * behind the entry/exit corridor walls, the debris fence on top of the pit
 * wall, and the ten team pit-wall stands.
 */

const V0 = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
const UP = new THREE.Vector3();
const F = new Frame3();

/** Adjust the ground plan so the grass behind the corridor walls doesn't overlap the service aprons. */
export function preparePit(ctx: Ctx) {
  const t = ctx.track;
  const pit = t.pit;
  const P = ctx.side(pit.side);
  const apron = (i: number) => {
    P.ext[i] = Math.min(P.ext[i], P.bar[i] + P.backOff[i] + 0.9);
  };
  ctx.forRange(pit.sStart - 45, pit.sStart - 1, apron);
  ctx.forRange(pit.sEnd + 1, pit.sEnd + 45, apron);
}

export function buildPit(ctx: Ctx, atlas: PrintAtlas) {
  const t = ctx.track;
  const pit = t.pit;
  const sd = pit.side;
  const P = ctx.side(sd);
  const cs = ctx.cs;
  const outer = pit.garageOffset + 0.5;
  const wallBack = pit.wallOffset + 0.6;
  const fastEdge = pit.laneInner + (pit.laneOuter - pit.laneInner) * 0.5;

  pitUniforms.uPit.value.set(pit.laneInner, fastEdge, pit.laneOuter);
  pitUniforms.uPitS.value.set((pit.sStart + 2) * ctx.vScale, (pit.sEnd - 2) * ctx.vScale);
  const band = (b: GeoBuilder, i: number, a0: number, b0: number, a1: number, b1: number, zone: number, rl: number) => {
    const set = (row: number) => {
      const k = ctx.wrap(row);
      b.s0[0] = rl; b.s0[1] = zone === Z_PIT ? 0.35 : 0; b.s0[2] = 0; b.s0[3] = 0;
      b.s1[0] = zone; b.s1[1] = 0; b.s1[2] = zone === Z_PIT ? 2 : 0; b.s1[3] = t.halfWidth[k];
    };
    set(i);
    const A = ctx.gv(b, i, sd * a0, 0);
    const B = ctx.gv(b, i, sd * b0, 0);
    set(i + 1);
    const C = ctx.gv(b, i + 1, sd * b1, 0);
    const D = ctx.gv(b, i + 1, sd * a1, 0);
    ctx.upOf(i, UP);
    b.quadN(A, B, C, D, UP.x, UP.y, UP.z);
  };

  // ---------------------------------------------------------------- lane + apron surfaces
  for (let s = Math.floor(pit.sStart); s < Math.ceil(pit.sEnd); s++) {
    const b = cs.get(s, 'asphalt');
    const rl = sd * (pit.laneInner + fastEdge) * 0.5;
    band(b, s, wallBack, pit.laneOuter, wallBack, pit.laneOuter, Z_PIT, rl);
    band(b, s, pit.laneOuter, outer, pit.laneOuter, outer, Z_APRON, 99);
  }
  // service aprons behind the entry / exit corridor walls
  for (const [a, e] of [[pit.sStart - 45, pit.sStart], [pit.sEnd, pit.sEnd + 45]]) {
    for (let s = Math.floor(a); s < Math.ceil(e); s++) {
      const i = ctx.wrap(s);
      const i1 = ctx.wrap(s + 1);
      const in0 = Math.min(outer - 0.5, P.bar[i] + P.backOff[i] + 0.9);
      const in1 = Math.min(outer - 0.5, P.bar[i1] + P.backOff[i1] + 0.9);
      if (P.kind[i] === 'pitwall') continue;
      const b = cs.get(s, 'asphalt');
      band(b, s, in0, outer, in1, outer, Z_APRON, 99);
    }
  }

  // ---------------------------------------------------------------- pit wall fence (on top of the wall)
  const fenceX = pit.wallOffset + 0.3;
  const HB = 1.1, HV = 4.2, OH = 0.7, OT = 4.9;
  for (let s = Math.floor(pit.sStart); s < Math.ceil(pit.sEnd); s++) {
    const fb = cs.get(s, 'fence');
    const pa = t.point(s, sd * fenceX, 0, new THREE.Vector3());
    const pb = t.point(s + 1, sd * fenceX, 0, new THREE.Vector3());
    const oa = t.point(s, sd * (fenceX - OH), 0, new THREE.Vector3());
    const ob = t.point(s + 1, sd * (fenceX - OH), 0, new THREE.Vector3());
    const k = ctx.wrap(s);
    const nx = -t.rx[k] * sd, nz = -t.rz[k] * sd;
    const u0 = s / 0.5, u1 = (s + 1) / 0.5;
    let a = fb.v(pa.x, pa.y + HB, pa.z, nx, 0, nz, u0, HB / 4);
    let c = fb.v(pb.x, pb.y + HB, pb.z, nx, 0, nz, u1, HB / 4);
    let d = fb.v(pb.x, pb.y + HV, pb.z, nx, 0, nz, u1, HV / 4);
    let e = fb.v(pa.x, pa.y + HV, pa.z, nx, 0, nz, u0, HV / 4);
    fb.quadN(a, c, d, e, nx, 0, nz);
    a = fb.v(pa.x, pa.y + HV, pa.z, nx, 0.7, nz, u0, HV / 4);
    c = fb.v(pb.x, pb.y + HV, pb.z, nx, 0.7, nz, u1, HV / 4);
    d = fb.v(ob.x, ob.y + OT, ob.z, nx, 0.7, nz, u1, 1.1);
    e = fb.v(oa.x, oa.y + OT, oa.z, nx, 0.7, nz, u0, 1.1);
    fb.quadN(a, c, d, e, nx, 0.7, nz);
  }
  for (let s = pit.sStart + 1; s < pit.sEnd; s += 4) {
    const props = cs.get(s, 'props');
    props.color(0x3d4145).mat(0.5, 0.7, 0);
    t.point(s, sd * fenceX, 0, V0);
    V0.y += HB;
    t.point(s, sd * fenceX, 0, V1);
    V1.y += HV + 0.02;
    t.point(s, sd * (fenceX - OH - 0.03), 0, V2);
    V2.y += OT + 0.05;
    beam(props, V0, V1, 0.1, 0.1);
    beam(props, V1, V2, 0.07, 0.07);
  }

  // ---------------------------------------------------------------- team pit-wall stands
  const mid = (pit.sStart + pit.sEnd) / 2;
  TEAMS.forEach((team, k) => {
    const s = mid + (k - 4.5) * 18;
    const props = cs.get(s, 'props');
    const print = cs.get(s, 'print');
    const f = t.frame(s);
    const o = t.point(s, sd * (wallBack + 0.6), 0, new THREE.Vector3());
    F.setHorizontal(o, f.tangent.x, f.tangent.z);
    // local x = right of travel; toward the track = −sd·x
    const X = (v: number) => -sd * v; // v > 0 → toward the track
    const primary = new THREE.Color(team.primary);
    const secondary = new THREE.Color(team.secondary);
    // legs
    props.color(0x2a2c30).mat(0.5, 0.6, 0);
    for (const dz of [-1.8, 1.8]) for (const dx of [-0.5, 0.5]) box(props, F, X(dx), 0.5, dz, 0.07, 1.0, 0.07);
    // platform deck
    props.color(0x3a3c40).mat(0.7, 0.3, 0);
    box(props, F, X(0), 1.02, 0, 1.2, 0.08, 4.0, 0b111111);
    // desk along the wall side: top + team-coloured front panel
    props.color(0x202226).mat(0.5, 0.2, 0);
    box(props, F, X(0.33), 1.78, 0, 0.5, 0.05, 3.9, 0b111111);
    props.color(secondary).mat(0.45, 0.1, 0);
    box(props, F, X(0.1), 1.42, 0, 0.04, 0.7, 3.9, 0b111111);
    // monitors facing the engineers (away from the track), glowing a little
    for (let m = 0; m < 4; m++) {
      const dz = -1.35 + m * 0.9;
      props.color(0x0c0c0e).mat(0.4, 0.2, 0);
      box(props, F, X(0.46), 2.1, dz, 0.06, 0.52, 0.8);
      const cell = atlas.sub('monitor', (m % 4) * 0.25 + 0.01, (m % 4) * 0.25 + 0.24, 0.05, 0.95);
      print.rgb(1, 1, 1).mat(0.25, 0, 1.4);
      // screens face the engineers (away from the track)
      printQuadX(print, F, X(0.42), dz - 0.37, dz + 0.37, 1.87, 2.33, sd, cell);
    }
    // stools
    for (let m = 0; m < 4; m++) {
      const dz = -1.35 + m * 0.9;
      props.color(0x2a2c30).mat(0.5, 0.6, 0);
      box(props, F, X(-0.2), 1.35, dz, 0.05, 0.6, 0.05);
      props.color(secondary).mat(0.6, 0.1, 0);
      box(props, F, X(-0.2), 1.66, dz, 0.36, 0.06, 0.36, 0b111111);
    }
    // roof canopy in team colours, reaching over the wall top
    props.color(0x2a2c30).mat(0.5, 0.6, 0);
    for (const dz of [-1.95, 1.95]) for (const dx of [-0.7, 0.5]) box(props, F, X(dx), 2.05, dz, 0.07, 2.1, 0.07);
    props.color(primary).mat(0.4, 0.2, 0);
    box(props, F, X(-0.1), 3.12, 0, 1.4, 0.1, 4.3, 0b111111);
    // name plates on both long edges of the canopy
    const plate = atlas.cell('team_' + team.id);
    print.rgb(1, 1, 1).mat(0.45, 0, 0.15);
    printQuadX(print, F, X(0.62), -2.1, 2.1, 2.95, 3.45, -sd, plate);
    printQuadX(print, F, X(-0.82), -2.1, 2.1, 2.95, 3.45, sd, plate);
  });

  // ---------------------------------------------------------------- pit lane speed signs (on posts beside the lane)
  for (const [s, cell] of [[pit.sStart + 22, 2], [pit.sStart + 24, 3], [pit.sEnd - 24, 3]] as [number, number][]) {
    const props = cs.get(s, 'props');
    const print = cs.get(s, 'print');
    const lat = sd * (pit.laneOuter + 1.4);
    const f = t.frame(s);
    const o = t.point(s, lat, 0, new THREE.Vector3());
    F.setHorizontal(o, f.tangent.x, f.tangent.z);
    props.color(0x8d9196).mat(0.4, 0.8, 0);
    box(props, F, 0, 1.0, 0.06, 0.08, 2.0, 0.08);
    const uv = atlas.sub('signs', cell * 0.25, cell * 0.25 + 0.25, 0, 1);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.1);
    printQuadZ(print, F, 0, -0.45, 0.45, 1.6, 2.5, -1, uv);
  }
}
