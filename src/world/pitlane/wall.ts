import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Frame, Geo, TrackSpace } from './geo.ts';
import { L, type PitPlan } from './layout.ts';
import type { PrintAtlas } from './textures.ts';

/**
 * The concrete pit wall with its debris fence, the ten team pit-wall stands,
 * the outer lane walls along the entry/exit spurs, impact attenuators,
 * bollards, speed-limit boards, the pit-exit light and the per-box release
 * light gantries.
 */

export interface WallParts {
  /** seats on the pit-wall stands: world position + heading the engineer faces */
  seats: { team: number; pos: THREE.Vector3; heading: number }[];
}

export class SignalGeo {
  pos: number[] = [];
  col: number[] = [];
  sig: number[] = [];
  idx: number[] = [];
  /** lamp disc facing normal n (world) */
  lamp(c: THREE.Vector3, n: THREE.Vector3, r: number, color: THREE.Color, slot: number, kind: number) {
    const u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0));
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(u, n).normalize();
    const base = this.pos.length / 3;
    const seg = 10;
    this.pos.push(c.x + n.x * 0.002, c.y + n.y * 0.002, c.z + n.z * 0.002);
    this.col.push(color.r * 1.4, color.g * 1.4, color.b * 1.4);
    this.sig.push(slot, kind);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const p = c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
      this.pos.push(p.x, p.y, p.z);
      this.col.push(color.r * 0.8, color.g * 0.8, color.b * 0.8);
      this.sig.push(slot, kind);
    }
    for (let i = 0; i < seg; i++) {
      // winding: face toward n
      const a = new THREE.Vector3().fromArray(this.pos, (base + 1 + i) * 3);
      const b = new THREE.Vector3().fromArray(this.pos, (base + 2 + i) * 3);
      const f = new THREE.Vector3().crossVectors(a.sub(c), b.sub(c));
      if (f.dot(n) >= 0) this.idx.push(base, base + 1 + i, base + 2 + i);
      else this.idx.push(base, base + 2 + i, base + 1 + i);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSig', new THREE.Float32BufferAttribute(this.sig, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function track_barrier(p: PitPlan, s: number) {
  return p.track.barrierAt(s, p.side);
}

export function buildWall(plan: PitPlan, ts: TrackSpace, atlas: PrintAtlas, out: { solid: Geo; detail: Geo; thin: Geo; print: Geo; fence: Geo; signal: SignalGeo }): WallParts {
  const { solid, detail, thin, print, fence, signal } = out;
  const p = plan;
  const F = new Frame();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const seats: WallParts['seats'] = [];

  // ---------------------------------------------------------------- concrete pit wall
  const w0 = L.wall, w1 = L.wall + L.wallT, H = L.wallH;
  solid.color(0xd9dad6).mat(0.78, 0, 0, 1);
  ts.box(solid, p.sStart, p.sEnd, w0 + 0.04, w1, 0, H, 8 | 32 | 1 | 2, 6);
  // track face: sponsor boards in 12 m panels, a thin kerb-coloured base
  {
    const n = Math.floor((p.sEnd - p.sStart) / 12);
    for (let i = 0; i < n; i++) {
      const a = p.sStart + i * 12, b = a + 12;
      print.rgb(1, 1, 1).mat(0.55, 0, 0.12, 1);
      const cell = ['sp10', 'sp0', 'sp11', 'sp3', 'sp10', 'sp8', 'sp1', 'sp11', 'sp6', 'sp2'][i % 10];
      ts.wallQuad(print, a + 0.05, a + 5.95, w0, 0.18, H - 0.04, -1, atlas.uv(cell));
      ts.wallQuad(print, a + 6.05, b - 0.05, w0, 0.18, H - 0.04, -1, atlas.uv(i % 3 === 0 ? 'sp11' : 'sp10'));
    }
    solid.color(0x202225).mat(0.7, 0, 0, 1);
    ts.wallQuad(solid, p.sStart, p.sEnd, w0 - 0.002, 0, 0.18, -1);
  }
  // lane-side face: grey with a yellow/black foot at the ends
  solid.color(0x9c9e9e).mat(0.85, 0, 0, 1);
  ts.wallQuad(solid, p.sStart, p.sEnd, w1, 0, H, 1);

  // ---------------------------------------------------------------- debris fence on the wall
  const fl = w0 + 0.18;
  const HB = H, HV = 4.4, OH = 0.9, OT = 5.0;
  {
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const n = Math.ceil((p.sEnd - p.sStart) / 4);
    for (let i = 0; i < n; i++) {
      const sa = p.sStart + ((p.sEnd - p.sStart) * i) / n;
      const sb = p.sStart + ((p.sEnd - p.sStart) * (i + 1)) / n;
      ts.P(sa, fl, HB, A);
      ts.P(sb, fl, HB, B);
      ts.P(sb, fl, HV, C);
      ts.P(sa, fl, HV, D);
      const dirT = ts.P(sa, fl - 1, HB).sub(ts.P(sa, fl, HB));
      fence.quad(A, B, C, D, dirT, [sa / 0.2, HB / 0.2, sb / 0.2, HV / 0.2]);
      ts.P(sa, fl - OH, OT, A);
      ts.P(sb, fl - OH, OT, B);
      ts.P(sb, fl, HV, C);
      ts.P(sa, fl, HV, D);
      fence.quad(D, C, B, A, dirT.clone().setY(0.8), [sa / 0.2, HV / 0.2, sb / 0.2, (HV + 1.2) / 0.2]);
    }
    // posts + top cables
    // thin members don't cast: at shadow-map resolution they only alias
    thin.color(0x55595e).mat(0.45, 0.7, 0, 0.8);
    for (let s = p.sStart + 2; s < p.sEnd; s += 4) {
      F.at(ts, s, fl, 0);
      F.box(thin, 0, (HB + HV) / 2, 0, 0.1, HV - HB, 0.1);
      F.beam(thin, V(0, HV, 0), V(0, OT, -OH), 0.08);
    }
    for (const [l, h] of [[fl, HV], [fl - OH, OT], [fl, (HB + HV) / 2]] as [number, number][]) ts.box(thin, p.sStart, p.sEnd, l - 0.02, l + 0.02, h - 0.02, h + 0.02, 63, 8);
  }

  // ---------------------------------------------------------------- team pit-wall stands
  TEAMS.forEach((team, k) => {
    const s = p.boxS(k);
    const prim = new THREE.Color(team.primary);
    const sec = new THREE.Color(team.secondary);
    F.at(ts, s, w1, 0);
    const len = 7.2;
    // legs + deck
    detail.color(0x26282c).mat(0.5, 0.7, 0, 0.8);
    for (const x of [-len / 2 + 0.2, 0, len / 2 - 0.2]) for (const z of [0.15, 1.15]) F.box(detail, x, 0.47, z, 0.08, 0.94, 0.08);
    detail.color(0x2e3034).mat(0.6, 0.5, 0, 1);
    F.box(detail, 0, 0.98, 0.65, len, 0.08, 1.35);
    // step
    F.box(detail, len / 2 + 0.35, 0.5, 0.9, 0.7, 0.06, 0.6);
    // desk against the wall top + team-colour front panel
    detail.color(0x18191c).mat(0.4, 0.2, 0, 0.6);
    F.box(detail, 0, 1.78, 0.28, len - 0.1, 0.05, 0.56);
    detail.color(sec).mat(0.45, 0.15, 0, 0.6);
    F.box(detail, 0, 1.43, 0.55, len - 0.1, 0.66, 0.03);
    detail.color(prim).mat(0.45, 0.15, 0, 0.6);
    F.box(detail, 0, 1.2, 0.565, len - 0.1, 0.1, 0.02);
    // monitors: lower row on the desk, upper row hanging from the roof
    const nm = 6;
    for (let m = 0; m < nm; m++) {
      const x = -len / 2 + 0.7 + (m * (len - 1.4)) / (nm - 1);
      detail.color(0x0b0b0d).mat(0.35, 0.3, 0, 0.5);
      F.box(detail, x, 2.08, 0.18, 0.66, 0.44, 0.05);
      F.box(detail, x, 1.84, 0.2, 0.05, 0.1, 0.05);
      print.rgb(1, 1, 1).mat(0.2, 0, 1.6, 0);
      F.panel(print, x, 2.08, 0.21, 0, 0, 1, 0.6, 0.38, atlas.uv('mon' + ((m + k) % 4), 6));
      detail.color(0x0b0b0d).mat(0.35, 0.3, 0, 0.3);
      F.box(detail, x, 2.62, 0.35, 0.56, 0.36, 0.05);
      F.box(detail, x, 2.95, 0.35, 0.03, 0.3, 0.03);
      print.rgb(1, 1, 1).mat(0.2, 0, 1.5, 0);
      F.panel(print, x, 2.62, 0.38, 0, 0, 1, 0.5, 0.3, atlas.uv('mon' + ((m + k + 1) % 4), 6));
    }
    // stools (seat 0.64 above the deck); 4 engineers sit on the middle ones
    for (let m = 0; m < nm; m++) {
      const x = -len / 2 + 0.7 + (m * (len - 1.4)) / (nm - 1);
      detail.color(0x2a2c30).mat(0.45, 0.7, 0, 0.6);
      F.cyl(detail, x, 1.33, 0.95, 'y', 0.025, 0.66, 6, false);
      F.box(detail, x, 1.12, 0.95, 0.36, 0.02, 0.02);
      detail.color(sec).mat(0.6, 0.05, 0, 0.6);
      F.cyl(detail, x, 1.66, 0.95, 'y', 0.19, 0.06, 10, true);
      if (m >= 1 && m <= 4) seats.push({ team: k, pos: F.p(x, 1.69, 0.98), heading: Math.atan2(-F.z.x, -F.z.z) });
    }
    // roof: posts, slab in team colour, name boards along both long edges
    detail.color(0x26282c).mat(0.5, 0.7, 0, 0.8);
    for (const x of [-len / 2 + 0.1, len / 2 - 0.1]) for (const z of [0.1, 1.25]) F.box(detail, x, 2.2, z, 0.07, 2.4, 0.07);
    solid.color(prim).mat(0.45, 0.25, 0, 1);
    F.box(solid, 0, 3.47, 0.62, len + 0.4, 0.12, 1.94);
    solid.color(0x1a1b1e).mat(0.5, 0.3, 0, 1);
    F.box(solid, 0, 3.12, 0.62, len + 0.3, 0.6, 1.9, 4 | 1 | 2);
    print.rgb(1, 1, 1).mat(0.45, 0, 0.35, 0.8);
    const fas = atlas.sub('fascia' + k, 0, 0.18, 1, 0.82);
    F.panel(print, 0, 3.12, -0.335, 0, 0, -1, len + 0.3, 0.6, fas);
    F.panel(print, 0, 3.12, 1.575, 0, 0, 1, len + 0.3, 0.6, fas);
    // under-roof light strip
    detail.rgb(1, 0.97, 0.92).mat(0.4, 0, 4, 0);
    F.box(detail, 0, 2.8, 0.75, len - 0.4, 0.03, 0.12, 4);
  });

  // ---------------------------------------------------------------- attenuators at the wall noses
  const attenuator = (sA: number, sB: number, faceDir: 1 | -1) => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = sA + ((sB - sA) * i) / n, b = sA + ((sB - sA) * (i + 1)) / n;
      solid.color(i % 2 ? 0x121212 : 0xf2c200).mat(0.55, 0, 0, 1);
      ts.box(solid, a, b, w0 - 0.15, w1 + 0.15, 0, 1.0, 8 | 16 | 32 | (i === 0 ? 1 : 0) | (i === n - 1 ? 2 : 0));
    }
    // chevron board on the nose
    const s = faceDir < 0 ? sA : sB;
    F.at(ts, s + faceDir * 0.02, (w0 + w1) / 2, 0);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.25, 1);
    F.panel(print, 0, 0.55, 0, faceDir, 0, 0, 0.9, 0.8, atlas.uv('pitexit'));
  };
  attenuator(p.sStart - 7, p.sStart, -1);
  attenuator(p.sEnd, p.sEnd + 4, 1);

  // ---------------------------------------------------------------- bollards along the entry / exit lines
  const bollard = (s: number, l: number) => {
    F.at(ts, s, l, 0);
    detail.color(0xff5a00).mat(0.5, 0, 0, 1);
    F.cyl(detail, 0, 0.4, 0, 'y', 0.09, 0.8, 8, true);
    detail.color(0xf0f0f0).mat(0.4, 0, 0.3, 1);
    F.cyl(detail, 0, 0.62, 0, 'y', 0.093, 0.1, 8, false);
    F.cyl(detail, 0, 0.42, 0, 'y', 0.093, 0.1, 8, false);
    detail.color(0x1a1a1a).mat(0.8, 0, 0, 1);
    F.cyl(detail, 0, 0.02, 0, 'y', 0.16, 0.04, 8, true);
  };
  for (let s = p.sStart - 22; s <= p.sStart - 8; s += 2) bollard(s, p.entryLine(s));
  for (let s = p.sEnd + 5; s <= p.sEnd + 26; s += 2.5) bollard(s, p.exitLine(s));

  // ---------------------------------------------------------------- outer lane walls (where there is no building)
  const outerWall = (sA: number, sB: number) => {
    const n = Math.ceil((sB - sA) / 3);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = sA + ((sB - sA) * i) / n, b = sA + ((sB - sA) * (i + 1)) / n;
      const la = p.outer(a), lb = p.outer(b);
      const seg = (l0a: number, l0b: number, l1a: number, l1b: number, h0: number, h1: number) => {
        const c = [
          ts.P(a, l0a, h0), ts.P(b, l0b, h0), ts.P(a, l1a, h0), ts.P(b, l1b, h0),
          ts.P(a, l0a, h1), ts.P(b, l0b, h1), ts.P(a, l1a, h1), ts.P(b, l1b, h1),
        ];
        const mid = new THREE.Vector3();
        for (const v of c) mid.add(v);
        mid.multiplyScalar(1 / 8);
        solid.face(c[4], c[5], c[7], c[6], mid);
        solid.face(c[0], c[1], c[5], c[4], mid);
        solid.face(c[2], c[3], c[7], c[6], mid);
        if (i === 0) solid.face(c[0], c[2], c[6], c[4], mid);
        if (i === n - 1) solid.face(c[1], c[3], c[7], c[5], mid);
      };
      solid.color(0xd4d5d1).mat(0.8, 0, 0, 1);
      seg(la, lb, la + 0.45, lb + 0.45, 0, 1.1);
      // fence panel above
      ts.P(a, la + 0.22, 1.1, A);
      ts.P(b, lb + 0.22, 1.1, B);
      ts.P(b, lb + 0.22, 3.0, C);
      ts.P(a, la + 0.22, 3.0, D);
      fence.quad(A, B, C, D, ts.P(a, la - 1, 1).sub(ts.P(a, la, 1)), [a / 0.2, 1.1 / 0.2, b / 0.2, 3.0 / 0.2]);
    }
    thin.color(0x55595e).mat(0.45, 0.7, 0, 0.8);
    for (let s = sA + 1.5; s < sB; s += 4) {
      F.at(ts, s, p.outer(s) + 0.22, 0);
      F.box(thin, 0, 2.05, 0, 0.08, 1.9, 0.08);
    }
  };
  outerWall(p.s0, p.bldgS0 - 0.5);
  outerWall(p.bldgS1 + 0.5, p.s1);
  // sponsor boards on the lane side of the outer walls
  const outerBoards = (sA: number, sB: number) => {
    const cells = ['sp10', 'sp4', 'sp11', 'sp7', 'sp9', 'sp10', 'sp2', 'sp5'];
    let i = 0;
    for (let a = sA + 0.5; a + 6 < sB; a += 6, i++) {
      const cell = atlas.uv(cells[i % cells.length]);
      print.rgb(1, 1, 1).mat(0.55, 0, 0.1, 1);
      // quad faces −l: +s reads left→right iff −side > 0
      const right = -ts.side > 0;
      for (let h = 0; h < 2; h++) {
        const s0 = right ? a + h * 2.95 : a + (1 - h) * 2.95, s1 = s0 + 2.95;
        const u0 = cell[0] + ((cell[2] - cell[0]) * h) / 2, u1 = cell[0] + ((cell[2] - cell[0]) * (h + 1)) / 2;
        const sL = right ? s0 : s1, sR = right ? s1 : s0;
        const lL = p.outer(sL) - 0.01, lR = p.outer(sR) - 0.01;
        const A = ts.P(sL, lL, 0.15), B = ts.P(sR, lR, 0.15), C = ts.P(sR, lR, 1.02), D = ts.P(sL, lL, 1.02);
        print.quad(A, B, C, D, ts.P(sL, lL - 1, 0.5).sub(ts.P(sL, lL, 0.5)), [u0, cell[1], u1, cell[3]]);
      }
    }
  };
  outerBoards(p.s0 + 2, p.bldgS0 - 1);
  outerBoards(p.bldgS1 + 1, p.s1 - 2);
  // PIT IN board before the entry
  {
    const s = p.entryS - 12;
    const l = track_barrier(p, s) + 1.2;
    F.at(ts, s, l, 0);
    solid.color(0x2a2c30).mat(0.45, 0.6, 0, 0.8);
    F.box(solid, 0.05, 1.5, 0, 0.12, 3.0, 0.12);
    solid.color(0x0d0d0f).mat(0.5, 0.2, 0, 0.8);
    F.box(solid, 0.03, 3.3, -0.2, 0.06, 0.95, 3.4);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.5, 0.8);
    F.panel(print, -0.005, 3.3, -0.2, -1, 0, 0, 3.3, 0.85, atlas.uv('pitin'));
  }

  // ---------------------------------------------------------------- speed-limit boards
  /** sign facing oncoming pit traffic (−s) */
  const board = (s: number, l: number, cell: string) => {
    F.at(ts, s, l, 0);
    solid.color(0x8d9196).mat(0.4, 0.8, 0, 0.8);
    F.box(solid, 0.04, 1.05, 0, 0.08, 2.1, 0.08);
    solid.color(0x202226).mat(0.5, 0.3, 0, 0.8);
    F.box(solid, 0, 2.35, 0, 0.04, 1.0, 1.0);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.25, 0.8);
    F.panel(print, -0.022, 2.35, 0, -1, 0, 0, 0.94, 0.94, atlas.uv(cell, 3));
  };
  board(p.limitStart - 2, L.standLine - 0.3, 'sign80');
  board(p.limitStart - 2, L.laneOuter + 0.6, 'sign80');
  board(p.limitEnd + 2, L.standLine - 0.3, 'signEnd');
  board(p.limitEnd + 2, L.laneOuter + 0.6, 'signEnd');

  // ---------------------------------------------------------------- pit exit light + board
  {
    const s = p.sEnd - 3;
    const l = p.outer(s) - 1.2;
    F.at(ts, s, l, 0);
    solid.color(0x2a2c30).mat(0.45, 0.6, 0, 0.8);
    F.box(solid, 0, 1.6, 0, 0.16, 3.2, 0.16);
    F.box(solid, 0, 3.3, -1.2, 0.12, 0.12, 2.6);
    solid.color(0x0d0d0f).mat(0.5, 0.2, 0, 0.8);
    F.box(solid, 0.05, 2.75, -2.3, 0.35, 1.0, 0.45);
    const n = F.dir(-1, 0, 0).normalize();
    signal.lamp(F.p(-0.14, 3.0, -2.3), n, 0.14, new THREE.Color(8, 0.25, 0.1), 10, 0);
    signal.lamp(F.p(-0.14, 2.55, -2.3), n, 0.14, new THREE.Color(0.25, 7, 1.2), 10, 1);
    // PIT EXIT board over the lane
    print.rgb(1, 1, 1).mat(0.5, 0, 0.4, 0.8);
    F.panel(print, 0.02, 3.95, -1.2, -1, 0, 0, 3.2, 0.8, atlas.uv('pitexit'));
    solid.color(0x0d0d0f).mat(0.5, 0.2, 0, 0.8);
    F.box(solid, 0.08, 3.95, -1.2, 0.08, 0.86, 3.26);
  }

  // ---------------------------------------------------------------- per-box release light gantries
  TEAMS.forEach((_, k) => {
    const s = p.boxS(k) + 4.6;
    F.at(ts, s, L.laneOuter + 0.4, 0);
    solid.color(0x1f2124).mat(0.45, 0.6, 0, 0.8);
    F.box(solid, 0, 1.6, 0, 0.12, 3.2, 0.12);
    F.box(solid, 0, 3.15, -1.6, 0.1, 0.1, 3.3);
    F.box(solid, 0, 2.95, -2.95, 0.05, 0.4, 0.05);
    solid.color(0x0b0b0c).mat(0.5, 0.2, 0, 0.8);
    F.box(solid, 0.02, 2.55, -2.95, 0.22, 0.46, 0.9);
    const n = F.dir(-1, 0, 0).normalize();
    for (const dz of [-0.22, 0.22]) {
      signal.lamp(F.p(-0.095, 2.66, -2.95 + dz), n, 0.075, new THREE.Color(8, 0.2, 0.08), k, 0);
      signal.lamp(F.p(-0.095, 2.44, -2.95 + dz), n, 0.075, new THREE.Color(0.2, 7, 1.0), k, 1);
    }
  });

  return { seats };
}
