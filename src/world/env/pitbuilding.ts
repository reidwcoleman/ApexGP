import * as THREE from 'three';
import type { Track } from '../Track.ts';
import { MeshBuilder, srgb } from './geom.ts';
import { TEAMS } from '../../race/Teams.ts';
import { sponsorTexture, sponsorUV, teamBoardTexture, teamUV } from './signage.ts';
import type { Layout } from './layout.ts';

/**
 * Pit building along the pit lane: a row of 6 m garage modules (the ten team
 * garages open, lit, painted in team colours; the rest behind roller doors),
 * hospitality floors with glass curtain walls and balconies, race-control tower
 * at the line, podium balcony over the lane, and the paddock behind it
 * (team motorhomes + transporters).
 *
 * Geometry is authored in track space (s, lateral, height) so the building
 * follows the straight's gentle rise and fall exactly.
 */

export interface GarageSlot {
  teamId: string;
  /** s of the garage centre (pit box in front of it) */
  s: number;
  /** lateral of the pit box (signed) */
  lateral: number;
}

export interface PitBuild {
  group: THREE.Group;
  garages: GarageSlot[];
}

const MODULE = 6;
const WHITE = srgb(0xeeeeec);
const CONCRETE = srgb(0xc9c6bf);
const DARK = srgb(0x2a2d33);
const FLOOR = srgb(0xb8bcc0);
const DOOR = srgb(0x9aa0a6);

export function buildPitBuilding(track: Track, layout: Layout): PitBuild {
  const pit = track.pit;
  const side = pit.side;
  const group = new THREE.Group();
  group.name = 'PitBuilding';
  const struct = new MeshBuilder();
  const glass = new MeshBuilder();
  const interior = new MeshBuilder();
  const lights = new MeshBuilder();
  const boards = new MeshBuilder();
  const teamBoards = new MeshBuilder();

  const P = (s: number, lat: number, h: number) => {
    const v = track.point(s, side * lat, 0);
    v.y += h;
    return v;
  };
  /** box in track space: s range, lateral range (unsigned, toward the pit side), height range */
  const tbox = (mb: MeshBuilder, s0: number, s1: number, l0: number, l1: number, h0: number, h1: number, c: THREE.Color, skip: { top?: boolean; bottom?: boolean; front?: boolean; back?: boolean } = {}) => {
    // orientation: with side = +1 (right of travel), increasing lateral goes to the right;
    // quad4 wants bottom-left, bottom-right, top-right, top-left seen from outside
    const flip = side > 0;
    const q = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3) => (flip ? mb.quad4(b, a, d, cc, c) : mb.quad4(a, b, cc, d, c));
    // long boxes are split along s so they follow the straight's vertical profile
    const n = Math.max(1, Math.ceil((s1 - s0) / 6));
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n, sb = s0 + ((s1 - s0) * (k + 1)) / n;
      const c000 = P(sa, l0, h0), c100 = P(sb, l0, h0), c010 = P(sa, l1, h0), c110 = P(sb, l1, h0);
      const c001 = P(sa, l0, h1), c101 = P(sb, l0, h1), c011 = P(sa, l1, h1), c111 = P(sb, l1, h1);
      if (!skip.front) q(c000, c100, c101, c001); // faces the lane (−lateral)
      if (!skip.back) q(c110, c010, c011, c111);
      if (k === 0) q(c010, c000, c001, c011); // s0 end
      if (k === n - 1) q(c100, c110, c111, c101); // s1 end
      if (!skip.top) q(c001, c101, c111, c011);
      if (!skip.bottom) q(c010, c110, c100, c000);
    }
  };
  // a quad facing the lane at lateral l
  const tfront = (mb: MeshBuilder, s0: number, s1: number, l: number, h0: number, h1: number, c: THREE.Color, uv?: [number, number, number, number]) => {
    const n = uv ? 1 : Math.max(1, Math.ceil((s1 - s0) / 6));
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n, sb = s0 + ((s1 - s0) * (k + 1)) / n;
      const a = P(sa, l, h0), b = P(sb, l, h0), cc = P(sb, l, h1), d = P(sa, l, h1);
      if (side > 0) mb.quad4(b, a, d, cc, c, uv);
      else mb.quad4(a, b, cc, d, c, uv);
    }
  };

  const L0 = layout.pit.front; // garage front line
  const G1 = L0 + 19; // garage back wall
  const BACK = L0 + 26; // building back
  const sA = pit.sStart - 4;
  const sB = pit.sEnd + 4;
  // Team garages line up with the trackside pit-wall stands: team k is centred at
  // mid + (k − 4.5)·18 m (3 modules of 6 m each). The module grid is aligned to that.
  const teamMods = 3;
  const mid = (pit.sStart + pit.sEnd) / 2;
  const teamStart = mid - (TEAMS.length / 2) * teamMods * MODULE;
  const s0 = teamStart - MODULE * Math.floor((teamStart - sA) / MODULE);
  const nMod = Math.floor((sB - s0) / MODULE);
  const firstTeamMod = Math.round((teamStart - s0) / MODULE);
  const garages: GarageSlot[] = [];
  const HG = 6.0; // ground floor height
  const HD = 4.7; // door height

  for (let m = 0; m < nMod; m++) {
    const a = s0 + m * MODULE;
    const b = a + MODULE;
    const tIdx = m - firstTeamMod;
    const team = tIdx >= 0 && tIdx < TEAMS.length * teamMods ? TEAMS[Math.floor(tIdx / teamMods)] : null;
    // pillar at the start of the module + lintel
    tbox(struct, a, a + 0.7, L0, G1, 0, HG, CONCRETE, { bottom: true });
    tbox(struct, a + 0.7, b, L0, L0 + 0.6, HD, HG, WHITE, { bottom: true });
    const open = !!team || m % 9 === 4;
    if (open) {
      const prim = team ? srgb(parseInt(team.primary.slice(1), 16)) : srgb(0x8a9097);
      const sec = team ? srgb(parseInt(team.secondary.slice(1), 16)) : srgb(0x5d6167);
      const acc = team ? srgb(parseInt(team.accent.slice(1), 16)) : srgb(0xb0b4b8);
      // floor, back wall, side walls, ceiling
      tbox(interior, a + 0.7, b, L0 + 0.2, G1, -0.2, 0.03, FLOOR, { bottom: true, front: false });
      tfront(interior, a + 0.7, b, G1 - 0.05, 0, HD, prim.clone().multiplyScalar(team ? 0.9 : 0.6));
      // accent stripe on the back wall + tool cabinets
      tfront(interior, a + 0.7, b, G1 - 0.1, 1.6, 1.9, acc);
      tbox(interior, a + 1.1, b - 0.4, G1 - 1.0, G1 - 0.12, 0, 1.1, sec);
      // side wall panels (seen through the door)
      tbox(interior, a + 0.7, a + 0.85, L0 + 0.6, G1, 0, HD, WHITE.clone().multiplyScalar(0.9));
      // ceiling + light strips
      tbox(interior, a + 0.7, b, L0 + 0.6, G1, HD - 0.05, HD + 0.1, WHITE.clone().multiplyScalar(0.8), { top: true });
      for (let k = 0; k < 3; k++) {
        const la = L0 + 3 + k * 5.2;
        const pa = P(a + 1.6, la, HD - 0.08), pb = P(b - 0.9, la, HD - 0.08), pc = P(b - 0.9, la + 0.5, HD - 0.08), pd = P(a + 1.6, la + 0.5, HD - 0.08);
        const warm = new THREE.Color(9, 9.2, 9.6);
        if (side > 0) lights.quad4(pa, pb, pc, pd, warm);
        else lights.quad4(pd, pc, pb, pa, warm);
      }
      if (team && tIdx % teamMods === 0) {
        const ti = Math.floor(tIdx / teamMods);
        const sc = a + (teamMods * MODULE) / 2;
        garages.push({ teamId: team.id, s: sc, lateral: side * (pit.laneOuter - 3.2) });
        // team board on the facade above the garages
        tfront(teamBoards, a + 1.5, a + teamMods * MODULE - 0.8, L0 - 0.08, HD + 0.1, HG - 0.1, new THREE.Color(1, 1, 1), teamUV(ti));
      }
    } else {
      // roller door
      tfront(struct, a + 0.7, b, L0 + 0.35, 0, HD, DOOR);
      for (let k = 1; k < 6; k++) tfront(struct, a + 0.7, b, L0 + 0.33, k * 0.78, k * 0.78 + 0.05, DOOR.clone().multiplyScalar(0.8));
    }
  }
  // closing pillar + ground floor shell (back/top)
  tbox(struct, s0 + nMod * MODULE, s0 + nMod * MODULE + 0.7, L0, G1, 0, HG, CONCRETE);
  tbox(struct, s0, s0 + nMod * MODULE + 0.7, G1, BACK, -1, HG, CONCRETE_DIM());

  // first floor: hospitality with balcony
  const sEnd = s0 + nMod * MODULE + 0.7;
  tbox(struct, s0 - 0.5, sEnd + 0.5, L0 - 0.4, BACK, HG, HG + 0.45, WHITE); // slab / balcony
  tfront(glass, s0, sEnd, L0 - 0.35, HG + 0.45, HG + 1.5, DARK); // balcony glass balustrade
  tbox(glass, s0, sEnd, L0 + 1.8, L0 + 1.9, HG + 0.45, HG + 4.2, DARK); // curtain wall
  tbox(struct, s0, sEnd, L0 + 1.9, BACK, HG + 0.45, HG + 4.2, CONCRETE_DIM(), { front: true });
  // second floor
  const H2 = HG + 4.2;
  tbox(struct, s0 - 0.5, sEnd + 0.5, L0 + 0.8, BACK, H2, H2 + 0.4, WHITE);
  tbox(glass, s0, sEnd, L0 + 2.6, L0 + 2.7, H2 + 0.4, H2 + 4.0, DARK);
  tbox(struct, s0, sEnd, L0 + 2.7, BACK, H2 + 0.4, H2 + 4.0, CONCRETE_DIM(), { front: true });
  for (let s = s0; s <= sEnd; s += 3) tbox(struct, s, s + 0.12, L0 + 2.15, L0 + 2.6, H2 + 0.4, H2 + 4.0, srgb(0xd9dadc), { top: true, bottom: true });
  // mullions on the first-floor curtain wall
  for (let s = s0; s <= sEnd; s += 2) tbox(struct, s, s + 0.08, L0 + 1.72, L0 + 1.8, HG + 0.45, HG + 4.2, srgb(0x3c4046), { top: true, bottom: true, back: true });
  // roof with a deep white overhang
  const H3 = H2 + 4.0;
  tbox(struct, s0 - 2, sEnd + 2, L0 - 2.5, BACK + 0.5, H3, H3 + 0.7, WHITE);
  // sponsor band along the roof edge (faces the track)
  {
    const n = Math.floor((sEnd - s0) / 24);
    for (let k = 0; k < n; k++) {
      const a = s0 + k * 24 + 0.5;
      tfront(boards, a, a + 23, L0 - 2.55, H3 + 0.05, H3 + 1.35, new THREE.Color(1, 1, 1), sponsorUV(k * 3 + 1));
    }
    tbox(struct, s0 - 2, sEnd + 2, L0 - 2.5, L0 - 2.0, H3 + 0.7, H3 + 1.4, DARK, { bottom: true });
  }

  // race control tower just past the line
  {
    const t0 = track.startS + 12, t1 = t0 + 22;
    // slim core set back from the facade, a cantilevered glass control room on top
    tbox(struct, t0 + 3, t1 - 3, L0 + 4, BACK, H3 + 0.7, 22, WHITE);
    tbox(struct, t0 + 3.2, t1 - 3.2, L0 + 3.9, L0 + 4, H3 + 1.5, 21.5, srgb(0x3c4046), { top: true, bottom: true, back: true });
    tbox(struct, t0 - 1, t1 + 1, L0 - 4, BACK + 0.5, 22, 22.6, WHITE);
    tbox(glass, t0 - 0.6, t1 + 0.6, L0 - 3.6, BACK, 22.6, 27.4, DARK);
    for (let s = t0 - 0.6; s <= t1 + 0.6; s += 2.4) tbox(struct, s, s + 0.14, L0 - 3.75, L0 - 3.55, 22.6, 27.4, WHITE, { top: true, bottom: true });
    tbox(struct, t0 - 1.4, t1 + 1.4, L0 - 4.4, BACK + 0.8, 27.4, 28.2, WHITE);
    tfront(boards, t0 + 1, t1 - 1, L0 - 3.3, 28.4, 31.0, new THREE.Color(1, 1, 1), sponsorUV(15));
    tbox(struct, t0 + 0.6, t1 - 0.6, L0 - 3.2, L0 - 2.9, 28.2, 31.2, DARK);
  }
  // podium balcony over the lane
  {
    const p0 = track.startS - 16, p1 = p0 + 16;
    const lane = pit.laneOuter - 1.5;
    tbox(struct, p0, p1, lane, L0, HG, HG + 0.5, WHITE);
    tfront(glass, p0, p1, lane - 0.02, HG + 0.5, HG + 1.6, DARK);
    // steps 2-1-3
    tbox(struct, p0 + 5.5, p0 + 10.5, L0 - 3.4, L0 - 1.0, HG + 0.5, HG + 1.5, srgb(0xd7b84a));
    tbox(struct, p0 + 1.5, p0 + 5.5, L0 - 3.4, L0 - 1.0, HG + 0.5, HG + 1.1, srgb(0xbfc3c7));
    tbox(struct, p0 + 10.5, p0 + 14.5, L0 - 3.4, L0 - 1.0, HG + 0.5, HG + 0.9, srgb(0xb0784a));
    // canopy
    tbox(struct, p0 - 1, p1 + 1, lane - 0.5, L0 + 1, HG + 5.2, HG + 5.6, WHITE);
    tbox(struct, p0 - 0.6, p0 - 0.2, lane, lane + 0.4, HG + 0.5, HG + 5.2, WHITE);
    tbox(struct, p1 + 0.2, p1 + 0.6, lane, lane + 0.4, HG + 0.5, HG + 5.2, WHITE);
    tfront(boards, p0, p1, lane - 0.55, HG + 5.2, HG + 6.4, new THREE.Color(1, 1, 1), sponsorUV(15));
  }
  // apron between the lane and the garages
  // (the service apron between the lane and the garages is built by the trackside module)

  // paddock: motorhomes + transporters behind the building
  TEAMS.forEach((t, i) => {
    const prim = srgb(parseInt(t.primary.slice(1), 16));
    const sec = srgb(parseInt(t.secondary.slice(1), 16));
    const sc = sA + 60 + i * ((sB - sA - 120) / (TEAMS.length - 1));
    const l0 = BACK + 18, l1 = l0 + 12;
    tbox(struct, sc - 9, sc + 9, l0, l1, -0.5, 3.4, WHITE);
    tbox(glass, sc - 8.6, sc + 8.6, l0 - 0.05, l1 - 0.4, 3.4, 6.2, DARK);
    tbox(struct, sc - 9.4, sc + 9.4, l0 - 1.8, l1 + 0.4, 6.2, 6.9, prim);
    tbox(struct, sc - 9, sc + 9, l0 - 0.02, l0 + 0.1, 1.1, 1.6, prim);
    // awning
    tbox(struct, sc - 9, sc + 9, l0 - 5, l0, 3.3, 3.5, sec.clone().lerp(WHITE, 0.3));
    // transporters
    for (let k = 0; k < 2; k++) {
      const ts = sc - 8 + k * 9;
      tbox(struct, ts - 0.1, ts + 2.5, l1 + 8, l1 + 24, -0.3, 4.0, prim);
      tbox(struct, ts - 0.1, ts + 2.5, l1 + 24, l1 + 27.5, -0.3, 3.4, sec);
    }
  });

  // ---------------------------------------------------------------- meshes
  const structMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x5a7584, roughness: 0.03, metalness: 0.92, emissive: 0x2a1c10, emissiveIntensity: 0.3, envMapIntensity: 1.25 });
  const interiorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0 });
  interiorMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.55;`,
    );
  };
  interiorMat.customProgramCacheKey = () => 'apex-garage-interior';
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const sTex = sponsorTexture();
  const boardMat = new THREE.MeshStandardMaterial({ map: sTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: sTex, emissiveIntensity: 0.25 });
  const tTex = teamBoardTexture();
  // team boards use their own atlas: split boards by texture
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.idx.length === 0) return;
    const m = new THREE.Mesh(mb.geometry(false), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  const sponsorBoards = boards;
  add(struct, structMat, 'pit_structure', true);
  add(glass, glassMat, 'pit_glass', true);
  add(interior, interiorMat, 'pit_interior', false);
  add(lights, lightMat, 'pit_lights', false);
  add(teamBoards, new THREE.MeshStandardMaterial({ map: tTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tTex, emissiveIntensity: 0.35 }), 'pit_teamboards', false);
  add(sponsorBoards, boardMat, 'pit_boards', false);
  return { group, garages };
}

function CONCRETE_DIM() {
  return srgb(0xa9a6a0);
}
