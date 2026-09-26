import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Frame, Geo, TrackSpace, beamWorld } from './geo.ts';
import { GARAGE_W, L, type PitPlan } from './layout.ts';
import type { PrintAtlas } from './textures.ts';

/**
 * The pit building: a 500 m run of 6 m garage modules (the ten team garages
 * open and lit, service garages, the rest behind roller doors), a lit fascia
 * band, a first-floor hospitality terrace behind a set-back curtain wall, the
 * Paddock Club floor with vertical fins, a deep roof canopy carrying the
 * sponsor band, the podium terrace cantilevered over the pit lane toward the
 * track at the finish line, the race-control tower with the big timing
 * screen, and the paddock behind (hospitality units, transporters, lamps).
 */

export class GlassGeo {
  pos: number[] = [];
  nor: number[] = [];
  gl: number[] = [];
  idx: number[] = [];
  /** vertical glass quad; along = facade coordinate at corner a; floorY/ceilY world heights of the room; depth */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, outDir: THREE.Vector3, alongA: number, alongB: number, floorY: number, ceilY: number, depth: number) {
    const e1 = new THREE.Vector3().subVectors(c, a), e2 = new THREE.Vector3().subVectors(d, b);
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
    let flip = false;
    if (n.dot(outDir) < 0) {
      n.negate();
      flip = true;
    }
    const base = this.pos.length / 3;
    const al = [alongA, alongB, alongB, alongA];
    [a, b, c, d].forEach((p, i) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.gl.push(al[i], floorY, ceilY, depth);
    });
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aGl', new THREE.Float32BufferAttribute(this.gl, 4));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export const H = {
  door: 4.6,
  fascia0: 4.9,
  slab1: 6.1,
  floor1: 6.55,
  slab2: 10.3,
  floor2: 10.75,
  roof: 14.3,
  roofTop: 14.9,
};

export interface BuildingOut {
  solid: Geo;
  detail: Geo;
  /** thin members that should not cast shadows */
  thin: Geo;
  print: Geo;
  glass: GlassGeo;
}

export function buildBuilding(plan: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: BuildingOut) {
  const { solid, detail, thin, print, glass } = o;
  const p = plan;
  const F = L.front, GB = L.garageBack, BB = L.bldgBack;
  const S0 = p.bldgS0, S1 = p.bldgS1;
  const fr = new Frame();
  const white = 0xe9eae7;
  const cladding = 0xc9cbc9;

  /** glass pane in track space: s range, lateral l, heights; faces the track (dir −1) or the paddock (+1) */
  const pane = (s0: number, s1: number, l: number, h0: number, h1: number, dir: -1 | 1, depth: number) => {
    const n = Math.max(1, Math.ceil((s1 - s0) / 6));
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n, b = s0 + ((s1 - s0) * (i + 1)) / n;
      const A = ts.P(a, l, h0), B = ts.P(b, l, h0), C = ts.P(b, l, h1), D = ts.P(a, l, h1);
      const out = ts.P(a, l + dir, h0).sub(A);
      glass.quad(A, B, C, D, out, a, b, A.y, A.y + (h1 - h0) + 0.0, depth);
    }
  };
  const teamOf = (s: number) => {
    const t = Math.floor((s - p.teamS0) / GARAGE_W);
    return s >= p.teamS0 && s < p.teamS1 ? t : -1;
  };

  // ---------------------------------------------------------------- ground floor modules
  const nMod = Math.round((S1 - S0) / 6);
  let sponsorIdx = 0;
  for (let m = 0; m < nMod; m++) {
    const a = S0 + m * 6, b = a + 6;
    const t = teamOf(a + 3);
    const teamStart = t >= 0 && Math.abs(a - (p.teamS0 + t * GARAGE_W)) < 0.01;
    const service = t < 0 && m % 5 === 2;
    // pillars: every module outside the team garages, only at team boundaries inside
    if (t < 0 || teamStart) {
      solid.color(cladding).mat(0.75, 0, 0, 1);
      ts.box(solid, a - 0.3, a + 0.3, F - 0.1, F + 1.0, 0, H.fascia0, 1 | 2 | 16);
      // partition wall between modules
      solid.color(0xd8d9d6).mat(0.8, 0, 0, 0);
      ts.box(solid, a - 0.15, a + 0.15, F + 1.0, GB, 0, H.door, 1 | 2);
    }
    if (t >= 0) continue; // team interiors are built by garage.ts
    if (service) {
      // open service garage: lit white box with tyre racks (built lightly)
      solid.color(0xe4e5e2).mat(0.6, 0, 0.35, 0);
      ts.wallQuad(solid, a + 0.3, b - 0.3, GB - 0.1, 0, H.door, -1);
      solid.color(0x2a2c30).mat(0.9, 0, 0, 0);
      ts.flat(solid, a + 0.3, b - 0.3, F + 0.6, GB, H.door, -1);
      detail.rgb(1, 0.98, 0.95).mat(0.4, 0, 6, 0);
      for (const l of [F + 3, F + 8, F + 13]) ts.flat(detail, a + 1.0, b - 1.0, l - 0.25, l + 0.25, H.door - 0.02, -1);
      // racks of tyres against the back wall
      fr.at(ts, a + 3, GB - 0.9, 0);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 6; c++) {
          const cmp = [0xd8202e, 0xf2c200, 0xe8e8e8][(c + r) % 3];
          tyre(detail, fr, -2.1 + c * 0.84, 0.4 + r * 0.75, 0, 'z', null, cmp);
        }
      detail.color(0x55595e).mat(0.5, 0.7, 0, 0);
      for (const y of [0.05, 0.8, 1.55]) fr.box(detail, 0, y, 0, 5.4, 0.04, 0.5);
    } else {
      // roller door: ribbed, in blocks of white / graphite / silver
      const door = [0xd6d8da, 0x505459, 0xaeb2b6][Math.floor(m / 3) % 3];
      for (let k = 0; k < 12; k++) {
        solid.color(door, k % 2 ? 0.86 : 1).mat(0.5, 0.35, 0, 0.6);
        ts.wallQuad(solid, a + 0.3, b - 0.3, F + 0.45, (k * H.door) / 12, ((k + 1) * H.door) / 12, -1);
      }
      solid.color(0x2b2e33).mat(0.6, 0.3, 0, 0.6);
      ts.wallQuad(solid, a + 0.3, b - 0.3, F + 0.44, 0, 0.12, -1);
    }
  }
  // closing pillar
  solid.color(cladding).mat(0.75, 0, 0, 1);
  ts.box(solid, S1 - 0.3, S1 + 0.3, F - 0.1, F + 1.0, 0, H.fascia0, 1 | 2 | 16);
  // lintel over the openings + roller-door housing
  solid.color(0x2a2d31).mat(0.6, 0.2, 0, 0.8);
  ts.box(solid, S0, S1, F - 0.05, F + 0.9, H.door, H.fascia0, 4 | 16, 6);
  // ground-floor shell: back wall, end walls
  solid.color(cladding).mat(0.8, 0, 0, 1);
  ts.box(solid, S0 - 0.3, S1 + 0.3, GB, BB, 0, H.slab1, 1 | 2 | 32, 6);
  ts.box(solid, S0 - 0.8, S0 - 0.3, F - 0.1, GB, 0, H.slab1, 1 | 16);
  ts.box(solid, S1 + 0.3, S1 + 0.8, F - 0.1, GB, 0, H.slab1, 2 | 16);
  // back doors to the paddock + a lit sign over each team's door
  for (let m = 0; m < nMod; m++) {
    const a = S0 + m * 6;
    solid.color(0x3a3d42).mat(0.5, 0.4, 0, 0.8);
    ts.wallQuad(solid, a + 1.4, a + 4.6, BB + 0.01, 0, 3.6, 1);
    const t = teamOf(a + 3);
    if (t >= 0 && (a - p.teamS0) % GARAGE_W < 1) {
      print.rgb(1, 1, 1).mat(0.5, 0, 0.6, 1);
      ts.wallQuad(print, a + 4.5, a + 13.5, BB + 0.02, 4.1, 5.2, 1, atlas.uv('fascia' + t));
    }
  }

  // ---------------------------------------------------------------- fascia band with lit team boards
  solid.color(0x16181b).mat(0.55, 0.3, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, F - 0.2, F + 0.9, H.fascia0, H.slab1, 1 | 2 | 16 | 4, 6);
  for (let m = 0; m < nMod; m++) {
    const a = S0 + m * 6;
    const t = teamOf(a + 3);
    if (t >= 0) {
      if ((a - p.teamS0) % GARAGE_W > 1) continue;
      const c = a + GARAGE_W / 2;
      print.rgb(1, 1, 1).mat(0.5, 0, 0.75, 0.7);
      ts.wallQuad(print, c - 4.8, c + 4.8, F - 0.21, H.fascia0 + 0.03, H.slab1 - 0.03, -1, atlas.uv('fascia' + t));
      // car numbers either side
      print.rgb(1, 1, 1).mat(0.5, 0, 0.5, 0.7);
      ts.wallQuad(print, c - 8.6, c - 5.2, F - 0.21, H.fascia0 + 0.1, H.slab1 - 0.1, -1, atlas.sub('sp' + (t % 10), 0, 0, 1, 1));
      ts.wallQuad(print, c + 5.2, c + 8.6, F - 0.21, H.fascia0 + 0.1, H.slab1 - 0.1, -1, atlas.sub('sp' + ((t + 5) % 10), 0, 0, 1, 1));
    } else {
      print.rgb(1, 1, 1).mat(0.5, 0, 0.5, 0.7);
      ts.wallQuad(print, a + 0.6, a + 5.4, F - 0.21, H.fascia0 + 0.03, H.slab1 - 0.03, -1, atlas.uv('sp' + (sponsorIdx++ % 12)));
    }
  }

  // ---------------------------------------------------------------- first floor: terrace + set-back curtain wall
  solid.color(white).mat(0.6, 0, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, F - 2.3, BB, H.slab1, H.floor1, 63, 6);
  // terrace underside downlights
  detail.rgb(1, 0.95, 0.85).mat(0.4, 0, 5, 0);
  for (let s = S0 + 1.5; s < S1; s += 3) ts.flat(detail, s - 0.18, s + 0.18, F - 1.4, F - 1.1, H.slab1 - 0.01, -1);
  // balustrade: low parapet + rail + balusters
  solid.color(white).mat(0.6, 0, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, F - 2.3, F - 2.1, H.floor1, H.floor1 + 0.35, 8 | 16 | 32 | 1 | 2, 6);
  thin.color(0x9aa0a6).mat(0.3, 0.9, 0, 1);
  ts.box(thin, S0 - 0.8, S1 + 0.8, F - 2.26, F - 2.18, H.floor1 + 1.05, H.floor1 + 1.1, 63, 8);
  for (let s = S0 - 0.6; s <= S1 + 0.6; s += 1.5) {
    fr.at(ts, s, F - 2.22, H.floor1);
    fr.box(thin, 0, 0.72, 0, 0.03, 0.72, 0.03);
  }
  // curtain wall (not across the podium, which has its own backdrop)
  const cw = F + 0.8;
  const glassRuns: [number, number][] = [[S0, p.podiumS0 + 1], [p.podiumS1 - 1, S1]];
  for (const [a, b] of glassRuns) pane(a, b, cw, H.floor1 + 0.05, H.slab2, -1, 12);
  solid.color(0xd5d7d8).mat(0.4, 0.6, 0, 1);
  for (let s = S0; s <= S1; s += 1.5) {
    if (s > p.podiumS0 + 1 && s < p.podiumS1 - 1) continue;
    ts.box(solid, s - 0.05, s + 0.05, cw - 0.12, cw + 0.02, H.floor1, H.slab2, 1 | 2 | 16);
  }
  ts.box(solid, S0, S1, cw - 0.1, cw + 0.02, H.floor1 + 0.9, H.floor1 + 1.0, 4 | 8 | 16, 6);
  // end walls of the upper floors
  solid.color(cladding).mat(0.75, 0, 0, 1);
  ts.box(solid, S0 - 0.8, S0, cw - 0.3, BB, H.floor1, H.roof, 1 | 16, 6);
  ts.box(solid, S1, S1 + 0.8, cw - 0.3, BB, H.floor1, H.roof, 2 | 16, 6);

  // big graphics on the end walls (seen down the straight and the pit lane)
  for (const [sEnd, dir] of [[S0 - 0.81, -1], [S1 + 0.81, 1]] as [number, -1 | 1][]) {
    fr.at(ts, sEnd, (cw + BB) / 2, 0);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.3, 1);
    fr.panel(print, 0, (H.floor1 + H.roof) / 2, 0, dir, 0, 0, 14, 7, atlas.uv('podiumBack'));
    fr.at(ts, sEnd, (F + GB) / 2, 0);
    for (let i = 0; i < 3; i++) fr.panel(print, 0, 3.0, -5.6 + i * 5.6, dir, 0, 0, 5.2, 1.3, atlas.uv('sp' + [10, 11, 0][i]));
  }

  // ---------------------------------------------------------------- second floor: Paddock Club with fins
  solid.color(white).mat(0.6, 0, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, F - 0.9, BB, H.slab2, H.floor2, 63, 6);
  const g2 = F - 0.6;
  pane(S0, S1, g2, H.floor2, H.roof, -1, 14);
  solid.color(0xf2f2ef).mat(0.5, 0.1, 0, 1);
  for (let s = S0 + 0.9; s < S1; s += 1.8) ts.box(solid, s - 0.07, s + 0.07, F - 1.45, g2, H.floor2, H.roof, 63);
  // Paddock Club lettering on the podium side
  // roof slab + canopy blade over the apron
  solid.color(white).mat(0.55, 0.05, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, F - 1.5, BB + 0.3, H.roof, H.roofTop, 63 & ~8, 6);
  solid.color(0x9a9d9f).mat(0.85, 0, 0, 1);
  ts.flat(solid, S0 - 0.8, S1 + 0.8, F - 1.5, BB + 0.3, H.roofTop, 1, 6);
  // parapet + skylight strips
  solid.color(0xf0f0ee).mat(0.55, 0.05, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, BB - 0.1, BB + 0.3, H.roofTop, H.roofTop + 0.6, 63, 8);
  solid.color(0x1c2328).mat(0.1, 0.5, 0, 1);
  for (let s = S0 + 6; s < S1 - 6; s += 9) ts.box(solid, s, s + 5, F + 4, BB - 4, H.roofTop, H.roofTop + 0.35, 8 | 1 | 2 | 16 | 32);
  ts.box(solid, S0 - 3, S1 + 3, F - 6.2, F - 1.5, H.roof + 0.25, H.roofTop, 63, 6);
  detail.rgb(1, 0.96, 0.9).mat(0.4, 0, 5, 0);
  for (let s = S0; s < S1; s += 4) ts.flat(detail, s - 0.3, s + 0.3, F - 4.1, F - 3.8, H.roof + 0.24, -1);
  // sponsor band on the canopy edge (faces the track), lit
  solid.color(0x111317).mat(0.5, 0.3, 0, 1);
  ts.box(solid, S0 - 3, S1 + 3, F - 6.45, F - 6.2, H.roof - 0.25, H.roofTop + 0.45, 63, 6);
  {
    const n = Math.floor((S1 - S0 + 6) / 6);
    for (let i = 0; i < n; i++) {
      const a = S0 - 3 + i * 6;
      print.rgb(1, 1, 1).mat(0.45, 0, 0.7, 0.8);
      ts.wallQuad(print, a + 0.35, a + 5.65, F - 6.46, H.roof - 0.2, H.roofTop + 0.4, -1, atlas.uv('sp' + ((i * 5) % 12)));
    }
  }
  // back of the upper floors: glass bands facing the paddock
  pane(S0, S1, BB + 0.01, H.floor1 + 0.4, H.slab2 - 0.4, 1, 8);
  pane(S0, S1, BB + 0.01, H.floor2 + 0.4, H.roof - 0.4, 1, 8);
  // rooftop plant
  for (let s = S0 + 20; s < S1 - 10; s += 47) {
    fr.at(ts, s, BB - 8, H.roofTop);
    solid.color(0xb9bcbf).mat(0.5, 0.5, 0, 1);
    fr.box(solid, 0, 0.9, 0, 6, 1.8, 4.5);
    solid.color(0x55595e).mat(0.5, 0.6, 0, 1);
    fr.cyl(solid, -1.5, 1.95, 0, 'y', 0.7, 0.3, 12, true);
    fr.cyl(solid, 1.5, 1.95, 0, 'y', 0.7, 0.3, 12, true);
  }

  buildPodium(p, ts, atlas, o);
  buildTower(p, ts, atlas, o);
  buildPaddock(p, ts, atlas, o);
  if (ts.track.def.id === 'silverstone') buildWing(p, ts, o);
}

// ------------------------------------------------------------------ Silverstone: the Wing

/**
 * The Wing's signature roof: a long white aerofoil blade floating above the building on
 * slim struts, reaching out over the pit lane and swooping up toward the middle.
 */
function buildWing(p: PitPlan, ts: TrackSpace, o: BuildingOut) {
  const { solid, thin } = o;
  const F = L.front, BB = L.bldgBack;
  const S0 = p.bldgS0 - 6, S1 = p.bldgS1 + 6;
  const T = H.roofTop;
  const prof: [number, number][] = [[F - 11, T + 2.2], [F - 6, T + 4.2], [F, T + 5.4], [F + 8, T + 5.9], [BB - 3, T + 5.2], [BB + 3, T + 3.6]];
  const swoop = (s: number) => {
    const t = (s - S0) / (S1 - S0);
    return 3.2 * Math.sin(Math.PI * t) + 1.1 * Math.sin(3 * Math.PI * t);
  };
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const THK = 0.5;
  solid.color(0xf3f4f2).mat(0.35, 0.25, 0, 1);
  const n = Math.ceil((S1 - S0) / 6);
  for (let i = 0; i < n; i++) {
    const a = S0 + ((S1 - S0) * i) / n, b = S0 + ((S1 - S0) * (i + 1)) / n;
    const ha = swoop(a), hb = swoop(b);
    for (let k = 0; k < prof.length - 1; k++) {
      const [l0, y0] = prof[k], [l1, y1] = prof[k + 1];
      solid.quad(ts.P(a, l0, y0 + ha), ts.P(b, l0, y0 + hb), ts.P(b, l1, y1 + hb), ts.P(a, l1, y1 + ha), up);
      solid.quad(ts.P(a, l0, y0 + ha - THK), ts.P(b, l0, y0 + hb - THK), ts.P(b, l1, y1 + hb - THK), ts.P(a, l1, y1 + ha - THK), down);
    }
    // leading and trailing edges
    for (const [l, y] of [prof[0], prof[prof.length - 1]]) {
      const out = ts.P(a, l === prof[0][0] ? l - 1 : l + 1, 0).sub(ts.P(a, l, 0));
      solid.quad(ts.P(a, l, y + ha - THK), ts.P(b, l, y + hb - THK), ts.P(b, l, y + hb), ts.P(a, l, y + ha), out);
    }
  }
  // end caps
  for (const [sE, d] of [[S0, -1], [S1, 1]] as [number, number][]) {
    const h = swoop(sE);
    for (let k = 0; k < prof.length - 1; k++) {
      const [l0, y0] = prof[k], [l1, y1] = prof[k + 1];
      const out = ts.P(sE + d, l0, 0).sub(ts.P(sE, l0, 0));
      solid.quad(ts.P(sE, l0, y0 + h - THK), ts.P(sE, l1, y1 + h - THK), ts.P(sE, l1, y1 + h), ts.P(sE, l0, y0 + h), out);
    }
  }
  // slim struts in V pairs down to the roof
  thin.color(0xd9dcdf).mat(0.3, 0.8, 0, 1);
  for (let s = S0 + 10; s < S1 - 8; s += 24) {
    for (const [l, y] of [[F + 3, T + 5.55], [BB - 4, T + 5.3]]) {
      const top = ts.P(s, l, y + swoop(s) - THK);
      beamWorld(thin, ts.P(s - 3, l, T), top, 0.22);
      beamWorld(thin, ts.P(s + 3, l, T), top, 0.22);
    }
  }
}

// ------------------------------------------------------------------ podium

function buildPodium(p: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: BuildingOut) {
  const { solid, detail, thin, print } = o;
  const F = L.front;
  const a = p.podiumS0, b = p.podiumS1;
  const tip = p.podiumTip;
  const deck0 = H.slab1 - 0.35, deck1 = H.floor1;
  const fr = new Frame();
  // deck
  solid.color(0xeeeeec).mat(0.55, 0.05, 0, 1);
  ts.box(solid, a, b, tip, F + 0.8, deck0, deck1, 63, 4);
  // steel girders under the deck, deeper toward the building
  solid.color(0x2f3338).mat(0.45, 0.6, 0, 1);
  for (const s of [a + 0.6, (a + b) / 2, b - 0.6]) {
    ts.box(solid, s - 0.3, s + 0.3, tip + 0.4, F - 6, deck0 - 0.55, deck0, 63, 4);
    ts.box(solid, s - 0.3, s + 0.3, F - 6, F + 0.8, deck0 - 1.2, deck0, 63, 4);
  }
  ts.box(solid, a + 0.3, b - 0.3, tip + 0.4, tip + 0.9, deck0 - 0.55, deck0, 63, 8);
  // downlights under the deck
  detail.rgb(1, 0.96, 0.88).mat(0.4, 0, 6, 0);
  for (let s = a + 3; s < b - 1; s += 4.5) for (let l = tip + 2.5; l < F - 1; l += 3.5) ts.flat(detail, s - 0.2, s + 0.2, l - 0.2, l + 0.2, deck0 - 0.01, -1);
  // front + side fascia with banners
  solid.color(0xa00018).mat(0.5, 0.1, 0, 1);
  ts.box(solid, a - 0.1, b + 0.1, tip - 0.1, tip + 0.05, deck0 - 0.45, deck1 + 0.5, 63, 8);
  {
    const n = 7;
    const w = (b - a) / n;
    for (let i = 0; i < n; i++) {
      print.rgb(1, 1, 1).mat(0.5, 0, 0.6, 1);
      ts.wallQuad(print, a + i * w + 0.1, a + (i + 1) * w - 0.1, tip - 0.11, deck0 - 0.4, deck1 + 0.45, -1, atlas.uv('podium'));
    }
  }
  // deck floor finish + steps (2 – 1 – 3) at the tip facing the track
  solid.color(0x3a3d42).mat(0.7, 0, 0, 0.9);
  ts.box(solid, a + 0.3, b - 0.3, tip + 0.3, F, deck1, deck1 + 0.02, 8, 6);
  const mid = (a + b) / 2;
  const step = (s0: number, s1: number, h: number, c: number) => {
    solid.color(c).mat(0.55, 0.1, 0, 0.9);
    ts.box(solid, s0, s1, tip + 1.4, tip + 3.6, deck1, deck1 + h, 63);
    solid.color(0xc8102e).mat(0.85, 0, 0, 0.9);
    ts.box(solid, s0 + 0.05, s1 - 0.05, tip + 1.45, tip + 3.55, deck1 + h, deck1 + h + 0.02, 8);
  };
  step(mid - 2.2, mid + 2.2, 0.95, 0xf4f4f2);
  step(mid - 6.6, mid - 2.2, 0.62, 0xe0e0de);
  step(mid + 2.2, mid + 6.6, 0.42, 0xe0e0de);
  // railings on the three open sides
  thin.color(0xb0b5ba).mat(0.3, 0.9, 0, 1);
  ts.box(thin, a, b, tip + 0.05, tip + 0.12, deck1 + 1.05, deck1 + 1.12, 63, 8);
  for (const s of [a + 0.05, b - 0.05]) ts.box(thin, s - 0.035, s + 0.035, tip, F, deck1 + 1.05, deck1 + 1.12, 63, 8);
  for (let s = a + 0.1; s <= b; s += 1.4) {
    fr.at(ts, s, tip + 0.09, deck1);
    fr.box(thin, 0, 0.55, 0, 0.04, 1.1, 0.04);
  }
  for (let l = tip + 1.4; l < F; l += 1.4)
    for (const s of [a + 0.05, b - 0.05]) {
      fr.at(ts, s, l, deck1);
      fr.box(thin, 0, 0.55, 0, 0.04, 1.1, 0.04);
    }
  // backdrop on the building face
  solid.color(0x8e0016).mat(0.5, 0.1, 0.05, 0.3);
  ts.box(solid, a + 0.5, b - 0.5, F + 0.6, F + 0.8, deck1, H.slab2, 16 | 1 | 2, 6);
  print.rgb(1, 1, 1).mat(0.5, 0, 0.55, 0.3);
  ts.wallQuad(print, mid - 3.7, mid + 3.7, F + 0.59, deck1 + 0.1, deck1 + 3.7, -1, atlas.uv('podiumBack'));
  for (const d of [-9.5, 9.5]) ts.wallQuad(print, mid + d - 3.2, mid + d + 3.2, F + 0.59, deck1 + 1.8, deck1 + 3.4, -1, atlas.uv('podium'));
  // a slim lit sponsor beam on posts across the tip
  solid.color(0x2f3338).mat(0.45, 0.6, 0, 1);
  for (const sp of [a + 1.2, b - 1.2]) {
    fr.at(ts, sp, tip + 0.35, deck1);
    fr.box(solid, 0, 1.6, 0, 0.14, 3.2, 0.14);
  }
  solid.color(0x0e0f12).mat(0.5, 0.3, 0, 1);
  ts.box(solid, a + 1.0, b - 1.0, tip + 0.25, tip + 0.45, deck1 + 3.2, deck1 + 4.1, 63, 8);
  {
    const n = 5;
    const w = (b - a - 2) / n;
    for (let i = 0; i < n; i++) {
      print.rgb(1, 1, 1).mat(0.5, 0, 0.7, 1);
      ts.wallQuad(print, a + 1 + i * w + 0.1, a + 1 + (i + 1) * w - 0.1, tip + 0.24, deck1 + 3.25, deck1 + 4.05, -1, atlas.uv(i % 2 ? 'sp11' : 'podium'));
      ts.wallQuad(print, a + 1 + i * w + 0.1, a + 1 + (i + 1) * w - 0.1, tip + 0.46, deck1 + 3.25, deck1 + 4.05, 1, atlas.uv(i % 2 ? 'podium' : 'sp11'));
    }
  }
}

// ------------------------------------------------------------------ race control + timing screen

function buildTower(p: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: BuildingOut) {
  const { solid, print, glass } = o;
  const F = L.front, BB = L.bldgBack;
  const a = p.towerS0, b = p.towerS1;
  const fr = new Frame();
  solid.color(0xeeeeec).mat(0.55, 0.05, 0, 1);
  ts.box(solid, a + 3, b - 3, F + 3, BB - 2, H.roofTop, 22.2, 63, 6);
  // control room cantilevered toward the track
  ts.box(solid, a - 1, b + 1, F - 4, BB - 1, 22.2, 22.7, 63, 6);
  ts.box(solid, a - 1.4, b + 1.4, F - 4.5, BB - 0.6, 27.6, 28.3, 63, 6);
  const panes = (s0: number, s1: number, l: number, dir: -1 | 1) => {
    const A = ts.P(s0, l, 22.7), B = ts.P(s1, l, 22.7), C = ts.P(s1, l, 27.6), D = ts.P(s0, l, 27.6);
    glass.quad(A, B, C, D, ts.P(s0, l + dir, 22.7).sub(A), s0, s1, A.y, C.y - 0.1, 8);
  };
  panes(a - 0.8, b + 0.8, F - 3.8, -1);
  panes(a - 0.8, b + 0.8, BB - 1.2, 1);
  // end glass (faces ±s)
  for (const [s, d] of [[a - 0.8, -1], [b + 0.8, 1]] as [number, number][]) {
    const A = ts.P(s, F - 3.8, 22.7), B = ts.P(s, BB - 1.2, 22.7), C = ts.P(s, BB - 1.2, 27.6), D = ts.P(s, F - 3.8, 27.6);
    const out = ts.P(s + d, F, 22.7).sub(ts.P(s, F, 22.7));
    glass.quad(A, B, C, D, out, F, BB, A.y, C.y - 0.1, 10);
  }
  solid.color(0xdfe1e2).mat(0.4, 0.5, 0, 1);
  for (let s = a - 0.8; s <= b + 0.8; s += 2.2) ts.box(solid, s - 0.06, s + 0.06, F - 3.95, F - 3.75, 22.7, 27.6, 63);
  // antenna mast
  fr.at(ts, b - 2, BB - 4, 28.3);
  solid.color(0x9aa0a6).mat(0.4, 0.8, 0, 1);
  fr.cyl(solid, 0, 3, 0, 'y', 0.08, 6, 6, true);
  fr.cyl(solid, 0, 0.6, 0, 'y', 0.25, 1.2, 8, true);
  // big timing screen on the tower face
  solid.color(0x0b0c0e).mat(0.5, 0.4, 0, 1);
  ts.box(solid, a + 2, b - 2, F + 2.5, F + 3, 15.4, 21.8, 63);
  print.rgb(1, 1, 1).mat(0.35, 0, 1.4, 0.4);
  ts.wallQuad(print, a + 2.3, b - 2.3, F + 2.49, 16.4, 20.9, -1, atlas.uv('timingBoard'));
  print.rgb(1, 1, 1).mat(0.5, 0, 0.9, 0.4);
  ts.wallQuad(print, a + 2.3, b - 2.3, F + 2.49, 20.95, 21.7, -1, atlas.sub('timing', 0.1, 0.1, 0.9, 0.9));
}

// ------------------------------------------------------------------ paddock

function buildPaddock(p: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: BuildingOut) {
  const { solid, detail, print, glass } = o;
  const fr = new Frame();
  const l0 = 60, l1 = 76;
  TEAMS.forEach((t, k) => {
    const c = p.mid + (k - 4.5) * 28;
    const a = c - 11, b = c + 11;
    const prim = new THREE.Color(t.primary);
    // ground floor: glass box in a white frame
    solid.color(0xf0f0ee).mat(0.5, 0.05, 0, 1);
    ts.box(solid, a, b, l0, l1, 3.45, 3.7, 63, 6);
    for (const s of [a, a + 5.5, c, b - 5.5, b]) ts.box(solid, s - 0.12, s + 0.12, l0, l0 + 0.3, 0, 3.45, 63);
    const A = ts.P(a, l0 + 0.15, 0), B = ts.P(b, l0 + 0.15, 0), C = ts.P(b, l0 + 0.15, 3.45), D = ts.P(a, l0 + 0.15, 3.45);
    glass.quad(A, B, C, D, ts.P(a, l0 - 1, 0).sub(A), a, b, A.y, C.y, 7);
    solid.color(0xd9dad8).mat(0.7, 0, 0, 1);
    ts.box(solid, a, b, l0 + 6, l1, 0, 3.45, 1 | 2 | 32);
    // upper floor clad in team colour, overhanging the street
    solid.color(prim).mat(0.35, 0.3, 0, 1);
    ts.box(solid, a - 0.4, b + 0.4, l0 - 1.0, l1 + 0.2, 3.7, 7.6, 63, 6);
    {
      const A2 = ts.P(a + 2, l0 - 1.02, 4.2), B2 = ts.P(b - 2, l0 - 1.02, 4.2), C2 = ts.P(b - 2, l0 - 1.02, 5.9), D2 = ts.P(a + 2, l0 - 1.02, 5.9);
      glass.quad(A2, B2, C2, D2, ts.P(a, l0 - 2, 4.2).sub(ts.P(a, l0, 4.2)), a + 2, b - 2, A2.y, C2.y, 6);
    }
    print.rgb(1, 1, 1).mat(0.45, 0, 0.5, 1);
    ts.wallQuad(print, c - 4.8, c + 4.8, l0 - 1.03, 6.1, 7.3, -1, atlas.uv('fascia' + k));
    // roof terrace rail + parasols
    solid.color(0xf0f0ee).mat(0.5, 0.05, 0, 1);
    ts.box(solid, a - 0.5, b + 0.5, l0 - 1.1, l1 + 0.3, 7.6, 7.85, 63 & ~8, 6);
    solid.color(0x3a3c3f).mat(0.8, 0, 0, 1);
    ts.flat(solid, a - 0.5, b + 0.5, l0 - 1.1, l1 + 0.3, 7.85, 1, 6);
    solid.color(prim).mat(0.4, 0.2, 0, 1);
    ts.box(solid, a - 0.5, b + 0.5, l0 - 1.1, l0 - 0.9, 7.85, 8.15, 63, 8);
    detail.color(0xa9aeb3).mat(0.3, 0.9, 0, 1);
    ts.box(detail, a - 0.4, b + 0.4, l0 - 1.0, l0 - 0.94, 8.8, 8.86, 63, 8);
    for (const ds of [-6, 0, 6]) {
      fr.at(ts, c + ds, l0 + 4, 7.85);
      detail.color(0x9aa0a6).mat(0.4, 0.7, 0, 1);
      fr.cyl(detail, 0, 1.2, 0, 'y', 0.03, 2.4, 6, false);
      detail.color(ds === 0 ? prim : 0xf2f2f2).mat(0.8, 0, 0, 1);
      cone(detail, fr, 0, 2.4, 0, 1.6, 0.45);
    }
    // planters + awning at the door
    for (const ds of [-9, -3, 3, 9]) {
      fr.at(ts, c + ds, l0 - 1.8, 0);
      detail.color(0x2d3033).mat(0.7, 0, 0, 1);
      fr.box(detail, 0, 0.3, 0, 1.2, 0.6, 0.6);
      detail.color(0x3d6b2a).mat(0.9, 0, 0, 1);
      fr.box(detail, 0, 0.75, 0, 1.0, 0.35, 0.45);
    }
    // two transporters behind, noses toward the building
    for (const ds of [-3.4, 3.4]) {
      const s = c + ds;
      solid.color(prim).mat(0.3, 0.4, 0, 1);
      ts.box(solid, s - 1.27, s + 1.27, 86.6, 100.2, 1.0, 4.0, 63);
      ts.box(solid, s - 1.25, s + 1.25, 84.0, 86.4, 0.7, 3.5, 63);
      solid.color(0x101215).mat(0.15, 0.6, 0, 1);
      ts.box(solid, s - 1.2, s + 1.2, 83.95, 84.3, 2.0, 3.2, 16);
      solid.color(0x151618).mat(0.9, 0, 0, 1);
      for (const l of [85.2, 94.5, 95.9, 97.3]) {
        fr.at(ts, s, l, 0.5);
        fr.cyl(solid, 0, 0, 0, 'x', 0.5, 2.5, 10, true);
      }
      print.rgb(1, 1, 1).mat(0.35, 0, 0.1, 1);
      for (const d of [-1, 1] as const) {
        // the livery reads toward the cab on both sides
        const sFace = s + d * 1.28;
        const A3 = ts.P(sFace, d > 0 ? 86.8 : 100.0, 1.1);
        const B3 = ts.P(sFace, d > 0 ? 100.0 : 86.8, 1.1);
        const C3 = ts.P(sFace, d > 0 ? 100.0 : 86.8, 3.9);
        const D3 = ts.P(sFace, d > 0 ? 86.8 : 100.0, 3.9);
        const out = ts.P(sFace + d, 90, 2).sub(ts.P(sFace, 90, 2));
        print.quad(A3, B3, C3, D3, out, atlas.uv('truck' + k));
      }
    }
  });
  // lamp posts along the paddock street
  for (let s = p.bldgS0 + 10; s < p.bldgS1; s += 32) {
    fr.at(ts, s, 54, 0);
    solid.color(0x44484d).mat(0.45, 0.7, 0, 1);
    fr.cyl(solid, 0, 4, 0, 'y', 0.09, 8, 8, true);
    fr.box(solid, 0, 8.05, -0.5, 0.25, 0.14, 1.3);
    detail.rgb(1, 0.93, 0.8).mat(0.4, 0, 7, 0);
    fr.box(detail, 0, 7.97, -0.8, 0.2, 0.02, 0.6, 4);
  }
}

// ------------------------------------------------------------------ shared props

/** simple cone (parasol) */
function cone(g: Geo, fr: Frame, cx: number, cy: number, cz: number, r: number, h: number) {
  const seg = 10;
  const apex = fr.p(cx, cy + h, cz);
  const inside = fr.p(cx, cy + h * 0.2, cz);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = fr.p(cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r);
    const p1 = fr.p(cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r);
    g.face(p0, p1, apex, apex.clone(), inside);
  }
}

/**
 * Tyre (optionally in a blanket) centred at local (cx,cy,cz), axle along `axis`.
 * blanket = fabric colour or null (bare tyre with compound stripe).
 */
export function tyre(g: Geo, fr: Frame, cx: number, cy: number, cz: number, axis: 'x' | 'y' | 'z', blanket: THREE.Color | number | null, compound: number, r = 0.35, w = 0.36) {
  const seg = 14;
  const ax = axis === 'x' ? fr.x : axis === 'y' ? fr.y : fr.z;
  const u = axis === 'y' ? fr.x.clone() : fr.y.clone();
  const v = new THREE.Vector3().crossVectors(ax, u).normalize();
  const c = fr.p(cx, cy, cz);
  const P = (rad: number, ang: number, off: number) => c.clone().addScaledVector(u, Math.cos(ang) * rad).addScaledVector(v, Math.sin(ang) * rad).addScaledVector(ax, off);
  const N = (ang: number) => new THREE.Vector3().addScaledVector(u, Math.cos(ang)).addScaledVector(v, Math.sin(ang));
  const body = blanket === null ? new THREE.Color(0x121213) : new THREE.Color(blanket as THREE.ColorRepresentation);
  // tread
  g.color(body).mat(blanket === null ? 0.85 : 0.9, 0, 0, 0);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const q = [P(r, a0, -w / 2), P(r, a1, -w / 2), P(r, a1, w / 2), P(r, a0, w / 2)];
    const n0 = N(a0), n1 = N(a1);
    const i0 = g.vert(q[0], n0), i1 = g.vert(q[1], n1), i2 = g.vert(q[2], n1), i3 = g.vert(q[3], n0);
    const fn = new THREE.Vector3().crossVectors(q[1].clone().sub(q[0]), q[2].clone().sub(q[0]));
    if (fn.dot(n0) >= 0) g.idx.push(i0, i1, i2, i0, i2, i3);
    else g.idx.push(i0, i2, i1, i0, i3, i2);
  }
  // sidewalls: outer ring (body), compound stripe, rim
  const rings: [number, number, THREE.Color, number, number][] = [
    [r, r * 0.8, body, 0.9, 0],
    [r * 0.8, r * 0.72, new THREE.Color(compound), 0.6, 0.15],
    [r * 0.72, r * 0.6, body, 0.9, 0],
    [r * 0.6, 0.05, blanket === null ? new THREE.Color(0x2a2c30) : body.clone().multiplyScalar(0.7), 0.4, 0],
  ];
  for (const side of [-1, 1]) {
    const n = ax.clone().multiplyScalar(side);
    const off = (side * w) / 2;
    for (const [ro, ri, col, rough, emit] of rings) {
      g.color(col).mat(rough, ri < 0.1 && blanket === null ? 0.7 : 0, emit, 0);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        g.face(P(ro, a0, off), P(ro, a1, off), P(ri, a1, off), P(ri, a0, off), c.clone().addScaledVector(n, -1));
      }
    }
  }
}
