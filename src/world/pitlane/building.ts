import * as THREE from 'three';
import { TEAMS } from '../../race/Teams.ts';
import { Frame, Geo, TrackSpace, beamWorld, rng } from './geo.ts';
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
 * The end walls carry slab bands, cladding fins and a glazed stair core; Silverstone gets the
 * Wing's blade roof (ribbed underneath), Interlagos a white roof rolling in waves. The outside
 * surfaces weather in the shader (materials.ts solidMaterial).
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

/**
 * Each circuit's pit building in its own materials, as the real ones are: Spa's and Mexico's dark
 * grey cladding, Sakhir's sandstone, Suzuka's and Hungaroring's horizontal louvres, the flush
 * curtain walls at Austin and Spa, Spielberg's graphite, the white fins at Monza and Yas.
 *   trim   slab edges, canopy, frames      clad   end walls, pillars, the ground-floor shell
 *   core   stair cores and the tower shaft  frame  mullions and fins
 *   shade  how the top floor is shaded: vertical fins, horizontal louvres or a flush curtain wall
 *   glass  the curtain wall's tint (glassMaterial)
 */
export interface PitStyle {
  trim: number;
  clad: number;
  core: number;
  frame: number;
  shade: 'fins' | 'louvres' | 'flush';
  glass: number;
}
const STYLES: Record<string, Partial<PitStyle>> = {
  monza: { clad: 0xb3b6b8, core: 0x8f9396, glass: 0x2c3a44 },
  spa: { trim: 0xf0f0ec, clad: 0x6c7177, core: 0x55595e, frame: 0x3a3e43, shade: 'flush', glass: 0x26384a },
  silverstone: { clad: 0xb8bcc0, core: 0x9a9fa4, glass: 0x30404c },
  suzuka: { trim: 0xf2f2ef, clad: 0xd2d4d2, core: 0xb4b7b6, frame: 0xc9ccce, shade: 'louvres', glass: 0x1e2a30 },
  yasmarina: { trim: 0xf4f3ef, clad: 0xe2dfd8, core: 0xcfcbc2, frame: 0xf2f1ec, glass: 0x2a4450 },
  austin: { trim: 0xf0f0ee, clad: 0x8d9298, core: 0x6f747a, frame: 0x2f3338, shade: 'flush', glass: 0x22344a },
  hungaroring: { trim: 0xeeeeea, clad: 0xc4c6c4, core: 0x9fa3a3, frame: 0x3a3d42, shade: 'louvres', glass: 0x2a3a36 },
  interlagos: { clad: 0xbfc3c4, core: 0x9ea2a4, glass: 0x2c3c46 },
  melbourne: { trim: 0xebebe8, clad: 0x8e9396, core: 0x6e7376, frame: 0x50555a, shade: 'louvres', glass: 0x2a3640 },
  mexico: { trim: 0xe8e8e4, clad: 0x5d6268, core: 0x474b50, frame: 0x2a2d31, shade: 'flush', glass: 0x26323c },
  montreal: { trim: 0xf3f3f0, clad: 0xdadcdb, core: 0xb9bcbc, frame: 0xe6e8e8, glass: 0x2b3e4a },
  sakhir: { trim: 0xebe0c9, clad: 0xcdb994, core: 0xb39f7b, frame: 0xc2ad86, shade: 'louvres', glass: 0x3a3a34 },
  spielberg: { trim: 0xd9dbdd, clad: 0x3f4348, core: 0x2e3135, frame: 0x26292d, glass: 0x222c34 },
  zandvoort: { trim: 0xf0f0ec, clad: 0x9fa4a8, core: 0x7d8286, frame: 0x60656a, shade: 'louvres', glass: 0x2c3a44 },
};
export function pitStyle(id: string): PitStyle {
  return { trim: 0xe9eae7, clad: 0xc9cbc9, core: 0xa9acac, frame: 0xf2f2ef, shade: 'fins', glass: 0x2c3a44, ...STYLES[id] };
}

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
  const st = pitStyle(ts.track.def.id);
  const white = st.trim;
  const cladding = st.clad;

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
  // sponsors hold contracts: runs of consecutive boards, with the odd plain module between them
  const fasciaPlan = contracts(nMod, 17);
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
  ts.box(solid, S0 - 0.8, S0 - 0.3, F - 0.1, BB, 0, H.slab1, 1 | 16 | 32);
  ts.box(solid, S1 + 0.3, S1 + 0.8, F - 0.1, BB, 0, H.slab1, 2 | 16 | 32);
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
      const sp = fasciaPlan[m];
      if (sp >= 0) ts.wallQuad(print, a + 0.6, a + 5.4, F - 0.21, H.fascia0 + 0.03, H.slab1 - 0.03, -1, atlas.uv('sp' + sp));
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
  // (the glass runs to the end planes: it wraps the corners there, buildEndWalls)
  const glassRuns: [number, number][] = [[S0 - 0.8, p.podiumS0 + 1], [p.podiumS1 - 1, S1 + 0.8]];
  for (const [a, b] of glassRuns) pane(a, b, cw, H.floor1 + 0.05, H.slab2, -1, 12);
  solid.color(st.frame).mat(0.4, 0.6, 0, 1);
  for (let s = S0; s <= S1; s += 1.5) {
    if (s > p.podiumS0 + 1 && s < p.podiumS1 - 1) continue;
    ts.box(solid, s - 0.05, s + 0.05, cw - 0.12, cw + 0.02, H.floor1, H.slab2, 1 | 2 | 16);
  }
  ts.box(solid, S0 - 0.8, S1 + 0.8, cw - 0.1, cw + 0.02, H.floor1 + 0.9, H.floor1 + 1.0, 4 | 8 | 16, 6);

  // ---------------------------------------------------------------- second floor: Paddock Club with fins
  solid.color(white).mat(0.6, 0, 0, 1);
  ts.box(solid, S0 - 0.8, S1 + 0.8, F - 0.9, BB, H.slab2, H.floor2, 63, 6);
  const g2 = F - 0.6;
  pane(S0 - 0.8, S1 + 0.8, g2, H.floor2, H.roof, -1, 14);
  if (st.shade === 'fins') {
    // vertical fins, 1.8 m apart, standing proud of the glass
    solid.color(st.frame).mat(0.5, 0.1, 0, 1);
    for (let s = S0 + 0.9; s < S1; s += 1.8) ts.box(solid, s - 0.07, s + 0.07, F - 1.45, g2, H.floor2, H.roof, 63);
  } else if (st.shade === 'louvres') {
    // horizontal aluminium louvre blades hung in front of the glass on outriggers every 6 m:
    // from the track they read as fine dark lines over the glass, and their shade bands it
    thin.color(st.frame).mat(0.4, 0.55, 0, 1);
    for (let y = H.floor2 + 0.55; y < H.roof - 0.2; y += 0.48) ts.box(thin, S0 - 0.8, S1 + 0.8, F - 1.5, F - 1.12, y, y + 0.07, 4 | 8 | 16 | 32, 12);
    for (let s = S0 - 0.8; s <= S1 + 0.8; s += 6) ts.box(thin, s - 0.05, s + 0.05, F - 1.55, g2, H.floor2, H.roof, 1 | 2 | 16);
  } else {
    // flush curtain wall: slim mullions and a transom at sill height, a dark spandrel at the slab
    thin.color(st.frame).mat(0.35, 0.6, 0, 1);
    for (let s = S0 - 0.8; s <= S1 + 0.8; s += 1.5) ts.box(thin, s - 0.04, s + 0.04, g2 - 0.14, g2, H.floor2, H.roof, 1 | 2 | 16);
    ts.box(thin, S0 - 0.8, S1 + 0.8, g2 - 0.12, g2, H.floor2 + 1.05, H.floor2 + 1.12, 4 | 8 | 16, 12);
  }
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
    const canopyPlan = contracts(n, 91);
    for (let i = 0; i < n; i++) {
      const a = S0 - 3 + i * 6;
      if (canopyPlan[i] < 0) continue;
      print.rgb(1, 1, 1).mat(0.45, 0, 0.7, 0.8);
      ts.wallQuad(print, a + 0.35, a + 5.65, F - 6.46, H.roof - 0.2, H.roofTop + 0.4, -1, atlas.uv('sp' + canopyPlan[i]));
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
  buildTower(p, ts, atlas, o, st);
  buildPaddock(p, ts, atlas, o);
  if (ts.track.def.id === 'silverstone') buildWing(p, ts, o, 'wing');
  // Interlagos: the new pit building's white roof that rolls in waves along the straight
  if (ts.track.def.id === 'interlagos') buildWing(p, ts, o, 'wave');
  buildEndWalls(p, ts, atlas, o, st);
}

// ------------------------------------------------------------------ Silverstone: the Wing

/**
 * The Wing's signature roof: a long white aerofoil blade floating above the building on
 * slim struts, reaching out over the pit lane and swooping up toward the middle.
 */
function buildWing(p: PitPlan, ts: TrackSpace, o: BuildingOut, style: 'wing' | 'wave') {
  const { solid, thin } = o;
  const F = L.front, BB = L.bldgBack;
  const S0 = p.bldgS0 - 6, S1 = p.bldgS1 + 6;
  const T = H.roofTop;
  const prof: [number, number][] =
    style === 'wing'
      ? [[F - 11, T + 2.2], [F - 6, T + 4.2], [F, T + 5.4], [F + 8, T + 5.9], [BB - 3, T + 5.2], [BB + 3, T + 3.6]]
      : [[F - 8, T + 1.0], [F - 4, T + 2.0], [F + 2, T + 2.6], [F + 10, T + 2.8], [BB - 2, T + 2.4], [BB + 2, T + 1.5]];
  const waves = Math.max(3, Math.round((S1 - S0) / 110));
  const swoop = (s: number) => {
    const t = (s - S0) / (S1 - S0);
    if (style === 'wave') return 1.5 * Math.sin(Math.PI * waves * 2 * t - Math.PI / 2) + 1.5;
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
  // the blade's underside is not a flat slab: transverse ribs every 12 m, deepest mid-chord
  // (seen from the pit straight and the grid, they give the soffit its rhythm and its shading)
  solid.color(0xe2e4e3).mat(0.45, 0.2, 0, 1);
  const l0 = prof[0][0], l1 = prof[prof.length - 1][0];
  for (let i = 0; i <= n; i += 2) {
    const a = S0 + ((S1 - S0) * i) / n;
    const h = swoop(a);
    for (let k = 0; k < prof.length - 1; k++) {
      const [la, ya] = prof[k], [lb, yb] = prof[k + 1];
      const da = 0.75 * Math.sin((Math.PI * (la - l0)) / (l1 - l0)), db = 0.75 * Math.sin((Math.PI * (lb - l0)) / (l1 - l0));
      for (const d of [-1, 1]) {
        const s = a + d * 0.12;
        const out = ts.P(s + d, la, 0).sub(ts.P(s, la, 0));
        solid.quad(ts.P(s, la, ya + h - THK - da), ts.P(s, lb, yb + h - THK - db), ts.P(s, lb, yb + h - THK), ts.P(s, la, ya + h - THK), out);
      }
      // the rib's bottom edge
      solid.quad(ts.P(a - 0.12, la, ya + h - THK - da), ts.P(a + 0.12, la, ya + h - THK - da), ts.P(a + 0.12, lb, yb + h - THK - db), ts.P(a - 0.12, lb, yb + h - THK - db), down);
    }
  }
  // slim struts in V pairs down to the roof
  thin.color(0xd9dcdf).mat(0.3, 0.8, 0, 1);
  for (let s = S0 + 10; s < S1 - 8; s += 24) {
    for (const l of [F + 3, BB - 4]) {
      // (the blade's height over this line, from the profile)
      let y = prof[0][1];
      for (let k = 0; k < prof.length - 1; k++)
        if (l >= prof[k][0] && l <= prof[k + 1][0]) y = prof[k][1] + ((prof[k + 1][1] - prof[k][1]) * (l - prof[k][0])) / (prof[k + 1][0] - prof[k][0]);
      const top = ts.P(s, l, y + swoop(s) - THK);
      beamWorld(thin, ts.P(s - 3, l, T), top, 0.22);
      beamWorld(thin, ts.P(s + 3, l, T), top, 0.22);
    }
  }
}

// ------------------------------------------------------------------ end walls

/**
 * The building's two end elevations are seen head-on down the straight, down the pit lane and in
 * every long-lens shot of the grid: not a blank slab with a poster on it but the way a real pit
 * building ends —
 *   - the curtain wall wraps the track-side corner (both upper floors), mullions on the return
 *   - the slab edges run round the corner as projecting white bands
 *   - the rest is clad (panel joints and weathering in the shader), a framed event board
 *     standing proud of it across both floors
 *   - a stair core at the paddock corner, proud of the wall, rising past the roof to its lift
 *     overrun, a full-height glazed slot up its face
 *   - at the foot: a glazed entrance lobby under a canopy, a roller-shuttered service door with
 *     a board over it, a plinth
 *   - on the roof behind the parapet: a louvred plant enclosure
 */
function buildEndWalls(p: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: BuildingOut, st: PitStyle) {
  const { solid, detail, thin, print, glass } = o;
  const F = L.front, GB = L.garageBack, BB = L.bldgBack;
  const fr = new Frame();
  const cw = F + 0.8, g2 = F - 0.6;
  /** the corner glazing reaches this far back; then cladding up to the stair core */
  const lg = F + 7.4;
  const lc0 = BB - 4.4, lc1 = BB + 0.5;
  for (const dir of [-1, 1] as const) {
    const sI = dir < 0 ? p.bldgS0 : p.bldgS1;
    /** the end wall's outer face */
    const sO = sI + dir * 0.8;
    const outer = dir < 0 ? 1 : 2;
    /** box between two s values given in any order */
    const eb = (g: Geo, sa: number, sb: number, l0: number, l1: number, h0: number, h1: number, mask: number, seg = 6) =>
      ts.box(g, Math.min(sa, sb), Math.max(sa, sb), l0, l1, h0, h1, mask, seg);
    /** a glazed panel on an end plane at s, facing out (interior-mapped rooms `depth` deep) */
    const endGlass = (s: number, l0: number, l1: number, h0: number, h1: number, depth: number) => {
      const A = ts.P(s, l0, h0), B = ts.P(s, l1, h0), C = ts.P(s, l1, h1), D = ts.P(s, l0, h1);
      glass.quad(A, B, C, D, ts.P(s + dir, l0, h0).sub(A), l0, l1, A.y, A.y + (h1 - h0), depth);
    };

    // ---- upper floors: the corner glazing, mullions on the return, a transom at sill height
    endGlass(sO, cw, lg, H.floor1 + 0.05, H.slab2, 6);
    endGlass(sO, g2, lg, H.floor2, H.roof, 6.5);
    thin.color(st.frame).mat(0.4, 0.6, 0, 1);
    for (let l = cw + 1.5; l < lg - 0.2; l += 1.5) eb(thin, sO, sO + dir * 0.1, l - 0.05, l + 0.05, H.floor1, H.slab2, outer | 16 | 32);
    for (let l = g2 + 1.5; l < lg - 0.2; l += 1.5) eb(thin, sO, sO + dir * 0.1, l - 0.05, l + 0.05, H.floor2, H.roof, outer | 16 | 32);
    eb(thin, sO, sO + dir * 0.1, cw, lg, H.floor1 + 0.9, H.floor1 + 1.0, outer | 4 | 8);
    // corner posts
    solid.color(st.frame).mat(0.4, 0.6, 0, 1);
    eb(solid, sO - dir * 0.1, sO + dir * 0.1, cw - 0.12, cw + 0.08, H.floor1, H.slab2, outer | 16);
    eb(solid, sO - dir * 0.1, sO + dir * 0.1, g2 - 0.12, g2 + 0.08, H.floor2, H.roof, outer | 16);

    // ---- the clad part of the upper floors, back to the stair core
    solid.color(st.clad).mat(0.72, 0.05, 0, 1);
    eb(solid, sI, sO, lg, lc0 + 0.2, H.slab1, H.roof, outer | 16);
    // slab edges round the corner: white bands proud of the wall
    solid.color(st.trim).mat(0.6, 0, 0, 1);
    for (const [y0, y1, l0] of [[H.slab1, H.floor1, F - 2.3], [H.slab2, H.floor2, F - 0.9], [H.roof, H.roofTop, F - 1.5]] as [number, number, number][])
      eb(solid, sO - dir * 0.05, sO + dir * 0.22, l0, lc0, y0 - 0.05, y1 + 0.05, outer | 4 | 8 | 16);
    // the event board, framed and standing off the cladding across both floors
    {
      const lm = (lg + lc0) / 2;
      const w = Math.min(lc0 - lg - 1.6, 12), h = w / 2;
      const hm = (H.floor1 + H.roof) / 2 + 0.2;
      solid.color(0x1b1d20).mat(0.5, 0.4, 0, 1);
      eb(solid, sO + dir * 0.22, sO + dir * 0.42, lm - w / 2 - 0.18, lm + w / 2 + 0.18, hm - h / 2 - 0.18, hm + h / 2 + 0.18, outer | 4 | 8 | 16 | 32);
      fr.at(ts, sO + dir * 0.43, lm, 0);
      print.rgb(1, 1, 1).mat(0.5, 0, 0.45, 1);
      fr.panel(print, 0, hm, 0, dir, 0, 0, w, h, atlas.uv('podiumBack'));
    }

    // ---- stair core at the paddock corner, past the roof to the lift overrun
    const sC = sO + dir * 0.9;
    // (under Interlagos' wave roof the core stops short of the blade)
    const yTop = H.roofTop + (ts.track.def.id === 'interlagos' ? 1.3 : 2.9);
    solid.color(st.core).mat(0.78, 0, 0, 1);
    eb(solid, sI - dir * 3, sC, lc0, lc1, 0, yTop, outer | 8 | 16 | 32);
    solid.color(st.trim).mat(0.6, 0, 0, 1);
    eb(solid, sI - dir * 3.1, sC + dir * 0.1, lc0 - 0.1, lc1 + 0.1, yTop, yTop + 0.35, 63);
    endGlass(sC + dir * 0.01, lc0 + 1.1, lc0 + 2.9, 0.6, yTop - 1.0, 3);
    thin.color(st.frame).mat(0.4, 0.6, 0, 1);
    for (const l of [lc0 + 1.1, lc0 + 2.9]) eb(thin, sC, sC + dir * 0.12, l - 0.08, l + 0.08, 0.5, yTop - 0.9, outer | 16 | 32);
    for (let y = 0.6 + 3.3; y < yTop - 1.1; y += 3.3) eb(thin, sC, sC + dir * 0.08, lc0 + 1.1, lc0 + 2.9, y - 0.06, y, outer | 4 | 8);

    // ---- ground floor: plinth, glazed entrance under a canopy, service door, a board over it
    solid.color(0x55585b).mat(0.85, 0, 0, 1);
    eb(solid, sO, sO + dir * 0.04, F - 0.1, lc0, 0, 0.45, outer | 8);
    endGlass(sO + dir * 0.02, F + 1.6, F + 7.6, 0.2, 3.7, 7);
    thin.color(st.frame).mat(0.4, 0.6, 0, 1);
    for (let l = F + 1.6; l <= F + 7.61; l += 2) eb(thin, sO, sO + dir * 0.12, l - 0.06, l + 0.06, 0.2, 3.7, outer | 16 | 32);
    eb(thin, sO, sO + dir * 0.12, F + 1.6, F + 7.6, 2.5, 2.58, outer | 4 | 8);
    solid.color(st.trim).mat(0.55, 0.1, 0, 1);
    eb(solid, sO, sO + dir * 2.4, F + 1.1, F + 8.1, 3.85, 4.15, outer | 4 | 8 | 16 | 32);
    detail.rgb(1, 0.95, 0.85).mat(0.4, 0, 5, 0);
    for (const l of [F + 2.6, F + 4.6, F + 6.6]) eb(detail, sO + dir * 0.9, sO + dir * 1.3, l - 0.2, l + 0.2, 3.84, 3.85, 4);
    // the roller shutter: ribbed, in a dark frame
    solid.color(0x2a2c30).mat(0.6, 0.3, 0, 0.8);
    eb(solid, sO, sO + dir * 0.06, GB - 7.4, GB - 1.1, 0, 4.7, outer | 8 | 16 | 32);
    for (let k = 0; k < 14; k++) {
      solid.color(0xa9adb1, k % 2 ? 0.86 : 1).mat(0.5, 0.4, 0, 0.7);
      eb(solid, sO, sO + dir * 0.08, GB - 7.1, GB - 1.4, (k * 4.4) / 14, ((k + 1) * 4.4) / 14, outer);
    }
    fr.at(ts, sO + dir * 0.09, GB - 4.25, 0);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.4, 1);
    fr.panel(print, 0, 5.3, 0, dir, 0, 0, 5.2, 1.3, atlas.uv('sp' + (dir < 0 ? 10 : 11)));
    // a personnel door and a lit exit sign by the core
    solid.color(0x3a3d42).mat(0.5, 0.4, 0, 0.8);
    eb(solid, sO, sO + dir * 0.05, lc0 - 2.6, lc0 - 1.4, 0, 2.3, outer);
    detail.rgb(0.2, 1, 0.45).mat(0.4, 0, 3, 0);
    eb(detail, sO, sO + dir * 0.08, lc0 - 2.3, lc0 - 1.7, 2.45, 2.65, outer);

    // ---- louvred plant enclosure on the roof behind the end
    const sp0 = sI - dir * 15, sp1 = sI - dir * 4;
    const ph = ts.track.def.id === 'interlagos' ? 1.4 : 2.6;
    solid.color(0x9da2a6).mat(0.5, 0.5, 0, 1);
    eb(solid, sp0, sp1, F + 9, BB - 9, H.roofTop, H.roofTop + ph, 63);
    detail.color(0x7f8489).mat(0.45, 0.55, 0, 1);
    for (let y = H.roofTop + 0.3; y < H.roofTop + ph - 0.1; y += 0.32) {
      eb(detail, sp1, sp1 + dir * 0.12, F + 9, BB - 9, y, y + 0.1, outer | 8 | 4);
      eb(detail, sp0, sp1, F + 8.88, F + 9, y, y + 0.1, 16 | 8 | 4);
    }
    // a pair of extract fans on top
    if (ph > 2) {
      fr.at(ts, (sp0 + sp1) / 2, (F + BB) / 2, H.roofTop + ph);
      detail.color(0x55595e).mat(0.5, 0.6, 0, 1);
      fr.cyl(detail, -2.2, 0.35, 0, 'y', 0.9, 0.7, 14, true);
      fr.cyl(detail, 2.2, 0.35, 0, 'y', 0.9, 0.7, 14, true);
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

/**
 * Race control: a clad shaft with a glazed lift slot and vertical fins rising off the roof, the
 * control room cantilevered over the pit lane on a deep slab. Its glazing is raked outward at
 * the top all round, as real control rooms and airport towers are (no reflections of the room
 * on the glass for the stewards); a deep roof overhang shades it, a dark fascia band trims it,
 * aerials and a weather mast on top.
 */
function buildTower(p: PitPlan, ts: TrackSpace, atlas: PrintAtlas, o: BuildingOut, st: PitStyle) {
  const { solid, detail, thin, print, glass } = o;
  const F = L.front, BB = L.bldgBack;
  const a = p.towerS0, b = p.towerS1;
  const fr = new Frame();
  const yF = 22.2, yG = 22.75, yC = 27.5, yR = 28.5;
  // ---- the shaft
  solid.color(st.core).mat(0.7, 0.05, 0, 1);
  ts.box(solid, a + 3, b - 3, F + 3, BB - 2, H.roofTop, yF, 63, 6);
  // vertical cladding fins on the ends of the shaft and a glazed lift slot up the paddock face
  detail.color(st.clad).mat(0.55, 0.2, 0, 1);
  for (let l = F + 3.9; l < BB - 2.6; l += 1.4)
    for (const [s0, s1] of [[a + 2.75, a + 3], [b - 3, b - 2.75]] as [number, number][]) ts.box(detail, s0, s1, l - 0.09, l + 0.09, H.roofTop, yF, 63);
  {
    const s0 = (a + b) / 2 - 1.2, s1 = (a + b) / 2 + 1.2;
    const A = ts.P(s0, BB - 1.98, H.roofTop + 0.6), B = ts.P(s1, BB - 1.98, H.roofTop + 0.6), C = ts.P(s1, BB - 1.98, yF - 0.6), D = ts.P(s0, BB - 1.98, yF - 0.6);
    glass.quad(A, B, C, D, ts.P(s0, BB, H.roofTop).sub(ts.P(s0, BB - 2, H.roofTop)), s0, s1, A.y, C.y, 2.5);
  }
  // ---- control room floor slab, cantilevered toward the track (a thick edge, lit soffit)
  solid.color(st.trim).mat(0.55, 0.05, 0, 1);
  ts.box(solid, a - 1.3, b + 1.3, F - 4.3, BB - 0.7, yF, yG, 63, 6);
  detail.rgb(1, 0.95, 0.85).mat(0.4, 0, 5, 0);
  for (let s = a; s <= b; s += 3.3) ts.flat(detail, s - 0.18, s + 0.18, F - 3.4, F - 3.0, yF - 0.01, -1);
  // ---- raked glazing: the bottom inset, the top leaning out ~0.9 m
  const s0b = a - 0.8, s1b = b + 0.8, l0b = F - 3.7, l1b = BB - 1.3;
  const s0t = a - 1.7, s1t = b + 1.7, l0t = F - 4.6, l1t = BB - 0.4;
  const pb = (s: number, l: number) => ts.P(s, l, yG), pt = (s: number, l: number) => ts.P(s, l, yC);
  const rake = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, D: THREE.Vector3, out: THREE.Vector3, al0: number, al1: number, depth: number) =>
    glass.quad(A, B, C, D, out, al0, al1, A.y, C.y - 0.1, depth);
  const tOut = ts.P(a, F - 10, yG).sub(ts.P(a, F, yG)), pOut = tOut.clone().negate();
  const eOut0 = ts.P(a - 10, F, yG).sub(ts.P(a, F, yG)), eOut1 = eOut0.clone().negate();
  rake(pb(s0b, l0b), pb(s1b, l0b), pt(s1t, l0t), pt(s0t, l0t), tOut, s0b, s1b, 8);
  rake(pb(s0b, l1b), pb(s1b, l1b), pt(s1t, l1t), pt(s0t, l1t), pOut, s0b, s1b, 8);
  rake(pb(s0b, l0b), pb(s0b, l1b), pt(s0t, l1t), pt(s0t, l0t), eOut0, l0b, l1b, 10);
  rake(pb(s1b, l0b), pb(s1b, l1b), pt(s1t, l1t), pt(s1t, l0t), eOut1, l0b, l1b, 10);
  // raked mullions (front, back, ends) and the corner posts
  thin.color(st.frame === 0xf2f2ef ? 0x2c3035 : st.frame).mat(0.4, 0.6, 0, 1);
  const nm = Math.round((s1b - s0b) / 2.2);
  for (let k = 0; k <= nm; k++) {
    const u = k / nm;
    const sb = s0b + (s1b - s0b) * u, stp = s0t + (s1t - s0t) * u;
    beamWorld(thin, pb(sb, l0b), pt(stp, l0t), k % nm === 0 ? 0.2 : 0.1);
    beamWorld(thin, pb(sb, l1b), pt(stp, l1t), k % nm === 0 ? 0.2 : 0.1);
  }
  const ne = Math.round((l1b - l0b) / 2.4);
  for (let k = 1; k < ne; k++) {
    const u = k / ne;
    const lb = l0b + (l1b - l0b) * u, lt = l0t + (l1t - l0t) * u;
    beamWorld(thin, pb(s0b, lb), pt(s0t, lt), 0.1);
    beamWorld(thin, pb(s1b, lb), pt(s1t, lt), 0.1);
  }
  // a sill rail at desk height round the front
  beamWorld(thin, ts.P(s0b - 0.18, l0b - 0.18, yG + 1.1), ts.P(s1b + 0.18, l0b - 0.18, yG + 1.1), 0.08);
  // ---- roof: a deep overhang with a dark fascia band, soffit downlights
  solid.color(st.trim).mat(0.55, 0.05, 0, 1);
  ts.box(solid, a - 3.0, b + 3.0, F - 6.2, BB + 0.9, yC, yR, 63, 6);
  solid.color(0x1d2024).mat(0.45, 0.4, 0, 1);
  ts.box(solid, a - 3.05, b + 3.05, F - 6.25, F - 6.0, yC - 0.05, yR + 0.25, 63, 6);
  detail.rgb(1, 0.95, 0.85).mat(0.4, 0, 5, 0);
  for (let s = a - 1.5; s <= b + 1.5; s += 3) ts.flat(detail, s - 0.15, s + 0.15, F - 5.4, F - 5.1, yC - 0.01, -1);
  solid.color(0x8f9499).mat(0.6, 0.3, 0, 1);
  ts.box(solid, a - 3, b + 3, BB + 0.3, BB + 0.9, yR, yR + 0.7, 63, 6);
  // roof kit: a lattice aerial mast, a weather mast, two satellite domes
  fr.at(ts, b - 2, BB - 4, yR);
  solid.color(0x9aa0a6).mat(0.4, 0.8, 0, 1);
  fr.cyl(solid, 0, 0.6, 0, 'y', 0.25, 1.2, 8, true);
  thin.color(0xb5babf).mat(0.4, 0.8, 0, 1);
  for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [0.35, 0.35], [-0.35, 0.35]]) fr.box(thin, x, 4.2, z, 0.06, 7.2, 0.06);
  for (let y = 1.4; y < 7.6; y += 1.1) {
    for (const z of [-0.35, 0.35]) fr.box(thin, 0, y, z, 0.7, 0.04, 0.04);
    for (const x of [-0.35, 0.35]) fr.box(thin, x, y, 0, 0.04, 0.04, 0.7);
  }
  fr.cyl(thin, 0, 8.8, 0, 'y', 0.05, 2.4, 6, true);
  fr.at(ts, a + 1, BB - 5, yR);
  fr.cyl(thin, 0, 1.6, 0, 'y', 0.05, 3.2, 6, true);
  fr.box(thin, 0, 3.2, 0, 1.2, 0.05, 0.05);
  detail.color(0xeeeeec).mat(0.5, 0.1, 0, 1);
  for (const ds of [3, 6.5]) {
    fr.at(ts, a + ds, BB - 3, yR);
    fr.cyl(detail, 0, 0.5, 0, 'y', 0.5, 1.0, 10, true);
    fr.cyl(detail, 0, 1.25, 0, 'y', 0.75, 0.5, 14, true);
  }
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
    // upper floor overhanging the street, glazed full width as the teams' motorhomes are: the team
    // colour frames it (a fascia band carrying the name, a sill band, the end walls), graphite
    // mullions, the back clad in dark grey
    const dark = prim.clone().multiplyScalar(0.18).add(new THREE.Color(0x1c1e21));
    solid.color(prim).mat(0.35, 0.3, 0, 1);
    ts.box(solid, a - 0.4, b + 0.4, l0 - 1.0, l1 + 0.2, 3.7, 4.15, 63, 6);
    ts.box(solid, a - 0.4, b + 0.4, l0 - 1.0, l1 + 0.2, 6.55, 7.6, 63, 6);
    for (const [s0, s1] of [[a - 0.4, a + 0.5], [b - 0.5, b + 0.4]]) ts.box(solid, s0, s1, l0 - 1.0, l1 + 0.2, 4.15, 6.55, 63);
    solid.color(dark).mat(0.5, 0.3, 0, 1);
    ts.box(solid, a + 0.5, b - 0.5, l1 - 0.4, l1 + 0.2, 4.15, 6.55, 32, 6);
    {
      const A2 = ts.P(a + 0.5, l0 - 0.85, 4.15), B2 = ts.P(b - 0.5, l0 - 0.85, 4.15), C2 = ts.P(b - 0.5, l0 - 0.85, 6.55), D2 = ts.P(a + 0.5, l0 - 0.85, 6.55);
      glass.quad(A2, B2, C2, D2, ts.P(a, l0 - 2, 4.2).sub(ts.P(a, l0, 4.2)), a + 0.5, b - 0.5, A2.y, C2.y, 7);
    }
    detail.color(0x2a2d31).mat(0.4, 0.6, 0, 1);
    for (let s = a + 2.3; s < b - 1; s += 1.8) ts.box(detail, s - 0.05, s + 0.05, l0 - 0.98, l0 - 0.85, 4.15, 6.55, 1 | 2 | 16);
    print.rgb(1, 1, 1).mat(0.45, 0, 0.5, 1);
    ts.wallQuad(print, c - 4.2, c + 4.2, l0 - 1.03, 6.6, 7.55, -1, atlas.uv('fascia' + k));
    // roof terrace rail + parasols
    solid.color(0xf0f0ee).mat(0.5, 0.05, 0, 1);
    ts.box(solid, a - 0.5, b + 0.5, l0 - 1.1, l1 + 0.3, 7.6, 7.85, 63 & ~8, 6);
    // the roof terrace: pale grey decking at the front, the plant and a white tensile shade at the back
    solid.color(0x9a9c9c).mat(0.85, 0, 0, 1);
    ts.flat(solid, a - 0.5, b + 0.5, l0 - 1.1, l1 + 0.3, 7.85, 1, 6);
    solid.color(0xb4b8bb).mat(0.5, 0.5, 0, 1);
    ts.box(solid, c - 6, c + 6, l1 - 5, l1 - 0.5, 7.85, 9.4, 63 & ~4);
    detail.color(0xf3f2ee).mat(0.85, 0, 0, 1);
    ts.box(detail, a + 0.5, b - 0.5, l0 + 0.5, l0 + 9, 10.1, 10.2, 63);
    detail.color(0x9aa0a6).mat(0.4, 0.7, 0, 1);
    for (const s of [a + 0.7, c, b - 0.7]) for (const l of [l0 + 0.7, l0 + 8.8]) ts.box(detail, s - 0.06, s + 0.06, l - 0.06, l + 0.06, 7.85, 10.1, 1 | 2 | 16 | 32);
    solid.color(prim).mat(0.4, 0.2, 0, 1);
    ts.box(solid, a - 0.5, b + 0.5, l0 - 1.1, l0 - 0.9, 7.85, 8.15, 63, 8);
    detail.color(0xa9aeb3).mat(0.3, 0.9, 0, 1);
    ts.box(detail, a - 0.4, b + 0.4, l0 - 1.0, l0 - 0.94, 8.8, 8.86, 63, 8);
    for (const ds of [-8.5, 8.5]) {
      fr.at(ts, c + ds, l0 + 11.5, 7.85);
      detail.color(0x9aa0a6).mat(0.4, 0.7, 0, 1);
      fr.cyl(detail, 0, 1.2, 0, 'y', 0.03, 2.4, 6, false);
      detail.color(prim).mat(0.8, 0, 0, 1);
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
  const seg = 24;
  const ax = axis === 'x' ? fr.x : axis === 'y' ? fr.y : fr.z;
  const u = axis === 'y' ? fr.x.clone() : fr.y.clone();
  const v = new THREE.Vector3().crossVectors(ax, u).normalize();
  const c = fr.p(cx, cy, cz);
  const P = (rad: number, ang: number, off: number) => c.clone().addScaledVector(u, Math.cos(ang) * rad).addScaledVector(v, Math.sin(ang) * rad).addScaledVector(ax, off);
  const N = (ang: number) => new THREE.Vector3().addScaledVector(u, Math.cos(ang)).addScaledVector(v, Math.sin(ang));
  const body = blanket === null ? new THREE.Color(0x121213) : new THREE.Color(blanket as THREE.ColorRepresentation);
  // tread: a flat crown and rounded shoulders (the radius drops and the normal turns toward the sidewall)
  g.color(body).mat(blanket === null ? 0.85 : 0.9, 0, 0, 0);
  const sh = r * 0.045, crown = w / 2 - sh;
  const prof: [number, number, number][] = [[-w / 2, r - sh, -0.7], [-crown, r, 0], [crown, r, 0], [w / 2, r - sh, 0.7]];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    for (let j = 0; j < prof.length - 1; j++) {
      const [o0, r0, t0] = prof[j], [o1, r1, t1] = prof[j + 1];
      const nn = (a: number, t: number) => N(a).multiplyScalar(1 - Math.abs(t)).addScaledVector(ax, t).normalize();
      const q = [P(r0, a0, o0), P(r0, a1, o0), P(r1, a1, o1), P(r1, a0, o1)];
      const n0 = nn(a0, t0), n1 = nn(a1, t0), n2 = nn(a1, t1), n3 = nn(a0, t1);
      const i0 = g.vert(q[0], n0), i1 = g.vert(q[1], n1), i2 = g.vert(q[2], n2), i3 = g.vert(q[3], n3);
      const fn = new THREE.Vector3().crossVectors(q[1].clone().sub(q[0]), q[2].clone().sub(q[0]));
      if (fn.dot(N(a0)) >= 0) g.idx.push(i0, i1, i2, i0, i2, i3);
      else g.idx.push(i0, i2, i1, i0, i3, i2);
    }
  }
  // sidewalls: outer ring (body), compound stripe, rim
  const rings: [number, number, THREE.Color, number, number][] = [
    [r - sh, r * 0.8, body, 0.9, 0],
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

/**
 * Sponsor slots along a band of `n` boards, as a real paddock sells them: each sponsor holds a run
 * of 3–7 consecutive boards, and now and then a module or two is left plain (-1). Seeded, so a
 * circuit always looks the same.
 */
function contracts(n: number, seed: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let last = -1;
  while (out.length < n) {
    let sp = Math.floor(r() * 12);
    if (sp === last) sp = (sp + 5) % 12;
    last = sp;
    const run = 3 + Math.floor(r() * 5);
    for (let k = 0; k < run && out.length < n; k++) out.push(sp);
    if (r() < 0.3) for (let k = 1 + Math.floor(r() * 2); k > 0 && out.length < n; k--) out.push(-1);
  }
  return out;
}
