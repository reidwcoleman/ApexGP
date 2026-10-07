import * as THREE from 'three';
import type { Track } from './Track.ts';
import type { Renderer } from '../core/Renderer.ts';
import { TEAMS } from '../race/Teams.ts';
import { Geo, TrackSpace } from './pitlane/geo.ts';
import { PitPeople } from '../people/strollers.ts';
import { GARAGE_W, L, makePlan, type PitPlan } from './pitlane/layout.ts';
import { DecalAtlas, PrintAtlas, fenceTexture, noiseTexture, whenFontsReady } from './pitlane/textures.ts';
import { decalMaterial, fenceMaterial, glassMaterial, groundMaterial, pitU, signalMaterial, signalU, solidMaterial } from './pitlane/materials.ts';
import { buildGround, buildPaint } from './pitlane/ground.ts';
import { SignalGeo, buildWall } from './pitlane/wall.ts';
import { GlassGeo, H, buildBuilding, pitStyle } from './pitlane/building.ts';
import { buildGarages } from './pitlane/garage.ts';
import { CrewSystem, type CrewStop } from './pitlane/crew.ts';
import { buildDrips } from './pitlane/drips.ts';
import { weatherUniforms } from './weatherUniforms.ts';

/**
 * The whole pit complex at Monza, east of the main straight: pit lane surface
 * and paint, entry/exit spurs, pit wall + debris fence + team stands, the
 * ten team garages (lit interiors), the pit building with the podium over the
 * lane, race control + timing screen, the paddock — and the pit crews, which
 * react to `setBox`.
 *
 * Draw calls: 11 (+4 in the shadow pass; +1 drips while it rains). Everything static is merged by
 * material (ground, paint, structure, detail, print, glass, fence, signals);
 * the crews are real people (people/Humans.ts), drawn only near the camera.
 */

/** what a team's pit box is doing (drives the crew animation) */
export type BoxState = 'idle' | 'ready' | 'service' | 'release';
export type { CrewStop } from './pitlane/crew.ts';

export interface GarageSlot {
  /** team index (TEAMS order) */
  team: number;
  /** s of the pit box (centre of the car when stopped) */
  s: number;
  /** lateral offset of the box (m, + right of travel) */
  lateral: number;
}

export interface PitComplex {
  group: THREE.Group;
  garages: GarageSlot[];
  /**
   * Per team: 'ready' when its car is on the way in (crew steps out into the
   * lane with tyres), 'service' while it is stopped (progress 0 … 1 through the
   * stop), 'release' for ~1.5 s after it leaves, else 'idle'.
   */
  setBox(team: number, state: BoxState, progress: number): void;
  /** the car a team's crew is working on: coming in, stopped (the stop's own clock), leaving — null: none */
  setStop(team: number, stop: CrewStop | null): void;
  update(dt: number, camera: THREE.Camera): void;
  readonly stats: Record<string, unknown>;
  /** optional: compound the crew carries out next ('soft'|'medium'|'hard'|'inter'|'wet') */
  setCompound?(team: number, compound: string): void;
  /** optional: free GPU resources (geometries, materials, textures) */
  dispose?(): void;
  /**
   * A car bay inside a team's garage (bay 0 or 1): the floor point under the car's
   * centre, the yaw that points it out at the pit lane, and the unit direction along
   * the building toward the garage's middle (where there is room for a camera).
   */
  bay(team: number, k: 0 | 1): { pos: THREE.Vector3; yaw: number; inward: THREE.Vector3; wallL: number };
  /** keep people out of a sight line (garage camera → car), or null */
  clearView(a: THREE.Vector3 | null, b?: THREE.Vector3, r?: number): void;
  /** stop drawing one team's crew (-1: draw all) */
  hideCrew(team: number): void;
  /** build every pit-crew member and prop now (loading), so nothing is built mid-race; false: the people kit isn't loaded yet */
  prebuild?(): boolean;
  /** one more team's crew; true once all are built (false too while the people kit isn't loaded) */
  prebuildNext?(): boolean;
  /** show all the crews for a warm-up render (shader compile, bone-texture upload), then back (false) */
  warm?(on: boolean): void;
}

/**
 * The complex's painted atlases (boards, fascias, back walls, floor decals) and its noise: made once
 * per circuit, by the garage box (buildGarageBox) at boot, and taken over by the whole complex when
 * it follows behind the garage (`adopted`: the complex owns and frees them from then on).
 */
export interface PitKit {
  print: PrintAtlas;
  decals: DecalAtlas;
  noise: THREE.DataTexture;
  adopted: boolean;
}

function makeKit(gfx: Renderer): PitKit {
  const aniso = gfx.maxAnisotropy;
  const print = new PrintAtlas(aniso);
  const decals = new DecalAtlas(aniso);
  whenFontsReady(() => {
    print.draw();
    decals.draw();
  });
  return { print, decals, noise: noiseTexture(), adopted: false };
}

/** the pit shaders' shared uniforms (the same for the box and the whole complex of a circuit) */
function setPitUniforms(track: Track, plan: PitPlan, noise: THREE.Texture) {
  pitU.uNoise.value = noise;
  const f = track.frame(plan.mid);
  pitU.uOrig.value.copy(track.point(plan.mid, 0));
  pitU.uT.value.set(f.tangent.x, f.tangent.z).normalize();
  pitU.uR.value.set(f.right.x, f.right.z).normalize().multiplyScalar(plan.side);
  pitU.uMid.value = plan.mid;
  pitU.uBox.value.set(plan.boxS(0), 18, L.box, L.fast);
  pitU.uGar.value.set(plan.teamS0, plan.teamS1, L.front, H.door);
  pitU.uLane.value.set(plan.sStart, plan.sEnd, plan.limitStart, plan.limitEnd);
  pitU.uCover.value.set(plan.podiumS0, plan.podiumS1, plan.podiumTip, L.front);
  pitU.uCover2.value.set(plan.bldgS0, plan.bldgS1);
}

/** a car bay inside a team's garage (PitComplex.bay) */
function bayOf(plan: PitPlan, ts: TrackSpace) {
  return (team: number, k: 0 | 1) => {
    const g0 = plan.teamS0 + team * GARAGE_W;
    const bs = k === 0 ? g0 + 4.5 : g0 + GARAGE_W - 4.5;
    const l = L.front + 5.4;
    const pos = ts.P(bs, l, 0.062);
    const out = ts.P(bs, l - 1, 0.062).sub(pos).setY(0).normalize();
    const inward = ts.P(bs + (k === 0 ? 1 : -1), l, 0.062).sub(pos).setY(0).normalize();
    return { pos, yaw: Math.atan2(out.x, out.z), inward, wallL: L.garageBack - l };
  };
}

/** `kit`: the garage box's atlases, taken over (else made here) */
export function buildPitComplex(track: Track, gfx: Renderer, kit: PitKit = makeKit(gfx)): PitComplex {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'PitComplex';
  const plan = makePlan(track);
  const ts = new TrackSpace(track, plan.side);
  const aniso = gfx.maxAnisotropy;

  // ---------------------------------------------------------------- textures + shared uniforms
  kit.adopted = true;
  const { print, decals, noise } = kit;
  setPitUniforms(track, plan, noise);

  // ---------------------------------------------------------------- geometry
  const solid = new Geo();
  const detail = new Geo();
  const thin = new Geo();
  const printG = new Geo();
  const fenceG = new Geo();
  const paint = buildPaint(plan, ts, decals);
  const glass = new GlassGeo();
  const signal = new SignalGeo();
  const tGeo0 = performance.now();
  const wall = buildWall(plan, ts, print, { solid, detail, thin, print: printG, fence: fenceG, signal });
  buildBuilding(plan, ts, print, { solid, detail, thin, print: printG, glass });
  buildGarages(plan, ts, print, { solid, detail, print: printG, paint, paintUV: decals.uv('white', 4) });
  const tGeo1 = performance.now();

  const meshes: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast: boolean, order = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.renderOrder = order;
    group.add(m);
    meshes.push(m);
    return m;
  };
  const solidMat = solidMaterial();
  add(buildGround(plan, ts), groundMaterial(), 'pit_ground', false);
  add(paint.geometry(), decalMaterial(decals.texture), 'pit_paint', false, 1);
  add(solid.geometry(), solidMat, 'pit_structure', true);
  // (perf: the detail layer is ~185 k triangles; drawn into both sun cascades it was the biggest
  // single shadow caster at the start line, for shadows too small to read)
  const detailMesh = add(detail.geometry(), solidMat, 'pit_detail', false);
  add(thin.geometry(), solidMat, 'pit_thin', false);
  add(printG.geometry(), solidMaterial(print.texture), 'pit_print', false);
  add(glass.geometry(), glassMaterial(pitStyle(track.def.id).glass), 'pit_glass', false);
  const fenceMat = fenceMaterial(fenceTexture(aniso));
  add(fenceG.geometry(), fenceMat, 'pit_fence', false, 2);
  add(signal.geometry(), signalMaterial(), 'pit_signals', false);
  const drips = buildDrips(plan, ts);
  group.add(drips);

  // ---------------------------------------------------------------- crews
  const crew = new CrewSystem(plan, ts, wall.seats);
  group.add(crew.group);
  // the engineers on the pit wall and the paddock street's people (added once the avatars load)
  const street: THREE.Vector3[] = [];
  for (let s = plan.bldgS0 + 6; s <= plan.bldgS1 - 6; s += 12) street.push(ts.P(s, 53.5, 0.06));
  const pitPeople = new PitPeople({ seats: wall.seats, paddock: street.length > 1 ? [street] : [] });
  group.add(pitPeople.group);

  const garages: GarageSlot[] = TEAMS.map((_, k) => ({ team: k, s: plan.boxS(k), lateral: plan.side * L.box }));
  const garageCentre = ts.P(plan.mid, L.front + 8, 2);
  const cam = new THREE.Vector3();
  // slot 11: the pit-exit light (0 … 10 are the team release lights)
  signalU.uSig.value[11] = 2;

  let tris = 0;
  for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  const stats: Record<string, unknown> = {
    buildMs: Math.round(performance.now() - t0),
    geometryMs: Math.round(tGeo1 - tGeo0),
    meshes: meshes.length + 2,
    staticTriangles: Math.round(tris),
    crewDrawn: 0,
    updateMs: 0,
  };

  const bay = bayOf(plan, ts);

  return {
    group,
    garages,
    stats,
    bay,
    hideCrew(team) {
      crew.hideTeam = team;
    },
    prebuild() {
      return crew.prebuild();
    },
    prebuildNext() {
      return crew.prebuildNext();
    },
    warm(on: boolean) {
      crew.warm(on);
    },
    clearView(a, b, r = 1.2) {
      crew.clear = a && b ? { ax: a.x, az: a.z, bx: b.x, bz: b.z, r } : null;
    },
    setBox(team: number, state: BoxState, progress: number) {
      crew.setBox(team, state, progress);
    },
    setCompound(team: number, compound: string) {
      crew.setCompound(team, compound);
    },
    setStop(team: number, stop: CrewStop | null) {
      crew.setStop(team, stop);
    },
    dispose() {
      crew.dispose();
      pitPeople.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) mt.dispose();
        m.customDepthMaterial?.dispose();
      });
      print.texture.dispose();
      decals.texture.dispose();
      noise.dispose();
      fenceMat.map?.dispose();
    },
    update(dt: number, camera: THREE.Camera) {
      const u0 = performance.now();
      camera.getWorldPosition(cam);
      pitU.uTime.value += dt;
      const d = cam.distanceTo(garageCentre);
      detailMesh.visible = d < 700;
      drips.visible = weatherUniforms.uRain.value > 0.02 && d < 500;
      crew.update(dt, camera);
      pitPeople.update(dt, camera);
      for (let k = 0; k < TEAMS.length; k++) signalU.uSig.value[k] = crew.signal(k);
      stats.crewDrawn = crew.drawn;
      stats.updateMs = Math.round((performance.now() - u0) * 1000) / 1000;
    },
  };
}

/** the boot's garage box (buildGarageBox) */
export type GarageBox = PitComplex & {
  team: number;
  kit: PitKit;
  /** free the box but not `kit` (it goes on into the whole complex, or the next box) */
  disposeBox(): void;
};

/**
 * Only the player's garage: the first thing a circuit builds, so the garage view is up before
 * anything else of it exists. The team's interior (garage.ts), its floor and door frame, the lane and
 * its paint in front of the door — and, standing in for the world beyond (the pit wall, the track,
 * the far side, all built behind the garage: Game.completeWorld), a haze across the lane at the
 * pit wall, coloured each frame like the air (the fog's colour): from inside the dark garage a
 * bright, washed-out outdoors. Replaced by the whole complex (buildPitComplex, which takes over
 * `kit`) once that is built. Same interface; no crews, signals or people (the garage dressing has
 * its own).
 */
export function buildGarageBox(track: Track, gfx: Renderer, team: number, kit: PitKit = makeKit(gfx)): GarageBox {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'GarageBox';
  const plan = makePlan(track);
  const ts = new TrackSpace(track, plan.side);
  setPitUniforms(track, plan, kit.noise);
  const g0 = plan.teamS0 + team * GARAGE_W, g1 = g0 + GARAGE_W;
  // (what can be seen of the lane through the door, from anywhere in the garage)
  const win: [number, number] = [g0 - 40, g1 + 40];

  const solid = new Geo();
  const detail = new Geo();
  const printG = new Geo();
  const paint = buildPaint(plan, ts, kit.decals, win);
  buildGarages(plan, ts, kit.print, { solid, detail, print: printG, paint, paintUV: kit.decals.uv('white', 4), only: team });
  // the door frame (as building.ts): pillars at the team boundaries, the lintel, the fascia band
  const cladding = pitStyle(track.def.id).clad;
  solid.color(cladding).mat(0.75, 0, 0, 1);
  for (const a of [g0, g1]) ts.box(solid, a - 0.3, a + 0.3, L.front - 0.1, L.front + 1.0, 0, H.fascia0, 1 | 2 | 16);
  solid.color(0x2a2d31).mat(0.6, 0.2, 0, 0.8);
  ts.box(solid, g0, g1, L.front - 0.05, L.front + 0.9, H.door, H.fascia0, 4 | 16, 6);
  solid.color(0x16181b).mat(0.55, 0.3, 0, 1);
  ts.box(solid, g0 - 0.3, g1 + 0.3, L.front - 0.2, L.front + 0.9, H.fascia0, H.slab1, 1 | 2 | 16 | 4, 6);
  // and the shell behind the back wall (its print panel casts no shadow: a low sun behind the
  // building would shine through it)
  solid.color(cladding).mat(0.8, 0, 0, 1);
  ts.box(solid, g0 - 0.3, g1 + 0.3, L.garageBack, L.garageBack + 0.5, 0, H.slab1, 63, 6);

  const meshes: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast: boolean, order = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.renderOrder = order;
    group.add(m);
    meshes.push(m);
    return m;
  };
  const solidMat = solidMaterial();
  add(buildGround(plan, ts, win), groundMaterial(), 'box_ground', false);
  add(paint.geometry(), decalMaterial(kit.decals.texture), 'box_paint', false, 1);
  add(solid.geometry(), solidMat, 'box_structure', true);
  add(detail.geometry(), solidMat, 'box_detail', false);
  add(printG.geometry(), solidMaterial(kit.print.texture), 'box_print', false);

  // the haze at the pit wall (a vertical band along the lane, 40 m high)
  const pos: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const n = Math.ceil((win[1] - win[0]) / 4);
  for (let i = 0; i <= n; i++) {
    const s = win[0] + ((win[1] - win[0]) * i) / n;
    ts.P(s, L.wall + L.wallT, -2, P);
    pos.push(P.x, P.y, P.z);
    ts.P(s, L.wall + L.wallT, 40, P);
    pos.push(P.x, P.y, P.z);
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hazeGeo.setIndex(idx);
  hazeGeo.computeBoundingSphere();
  const hazeMat = new THREE.MeshBasicMaterial({ color: 0xb0b8c0, side: THREE.DoubleSide, fog: false });
  const haze = new THREE.Mesh(hazeGeo, hazeMat);
  haze.name = 'box_haze';
  haze.matrixAutoUpdate = false;
  haze.onBeforeRender = (_r: THREE.WebGLRenderer, scene: THREE.Scene) => {
    const fog = scene.fog as THREE.Fog | null;
    if (fog) hazeMat.color.copy(fog.color);
  };
  group.add(haze);

  const disposeBox = () =>
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) mt.dispose();
    });

  let tris = 0;
  for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  const stats: Record<string, unknown> = { buildMs: Math.round(performance.now() - t0), meshes: meshes.length + 1, staticTriangles: Math.round(tris) };

  return {
    group,
    team,
    kit,
    garages: TEAMS.map((_, k) => ({ team: k, s: plan.boxS(k), lateral: plan.side * L.box })),
    stats,
    bay: bayOf(plan, ts),
    hideCrew() {},
    clearView() {},
    setBox() {},
    setStop() {},
    disposeBox,
    dispose() {
      disposeBox();
      // (the atlases go on into the whole complex, unless it never came)
      if (!kit.adopted) {
        kit.print.texture.dispose();
        kit.decals.texture.dispose();
        kit.noise.dispose();
      }
    },
    update(dt: number) {
      pitU.uTime.value += dt;
    },
  };
}
