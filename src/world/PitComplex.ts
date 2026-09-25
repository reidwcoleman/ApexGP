import * as THREE from 'three';
import type { Track } from './Track.ts';
import type { Renderer } from '../core/Renderer.ts';
import { TEAMS } from '../race/Teams.ts';
import { Geo, TrackSpace } from './pitlane/geo.ts';
import { GARAGE_W, L, makePlan } from './pitlane/layout.ts';
import { DecalAtlas, PrintAtlas, fenceTexture, noiseTexture, whenFontsReady } from './pitlane/textures.ts';
import { decalMaterial, fenceMaterial, glassMaterial, groundMaterial, pitU, signalMaterial, signalU, solidMaterial } from './pitlane/materials.ts';
import { buildGround, buildPaint } from './pitlane/ground.ts';
import { SignalGeo, buildWall } from './pitlane/wall.ts';
import { GlassGeo, H, buildBuilding } from './pitlane/building.ts';
import { buildGarages } from './pitlane/garage.ts';
import { CrewSystem } from './pitlane/crew.ts';
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
 * the crews are GPU-posed instanced meshes (near + far level of detail).
 */

/** what a team's pit box is doing (drives the crew animation) */
export type BoxState = 'idle' | 'ready' | 'service' | 'release';

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
}

export function buildPitComplex(track: Track, gfx: Renderer): PitComplex {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'PitComplex';
  const plan = makePlan(track);
  const ts = new TrackSpace(track, plan.side);
  const aniso = gfx.maxAnisotropy;

  // ---------------------------------------------------------------- textures + shared uniforms
  const print = new PrintAtlas(aniso);
  const decals = new DecalAtlas(aniso);
  whenFontsReady(() => {
    print.draw();
    decals.draw();
  });
  const noise = noiseTexture();
  pitU.uNoise.value = noise;
  {
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
  const detailMesh = add(detail.geometry(), solidMat, 'pit_detail', true);
  add(thin.geometry(), solidMat, 'pit_thin', false);
  add(printG.geometry(), solidMaterial(print.texture), 'pit_print', false);
  add(glass.geometry(), glassMaterial(), 'pit_glass', false);
  const fenceMat = fenceMaterial(fenceTexture(aniso));
  add(fenceG.geometry(), fenceMat, 'pit_fence', false, 2);
  add(signal.geometry(), signalMaterial(), 'pit_signals', false);
  const drips = buildDrips(plan, ts);
  group.add(drips);

  // ---------------------------------------------------------------- crews
  const crew = new CrewSystem(plan, ts, wall.seats);
  group.add(crew.group);

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
    crewTrianglesPerPerson: crew.rigTriangles,
    crewDrawn: [0, 0],
    updateMs: 0,
  };

  const bay = (team: number, k: 0 | 1) => {
    const g0 = plan.teamS0 + team * GARAGE_W;
    const bs = k === 0 ? g0 + 4.5 : g0 + GARAGE_W - 4.5;
    const l = L.front + 5.4;
    const pos = ts.P(bs, l, 0.062);
    const out = ts.P(bs, l - 1, 0.062).sub(pos).setY(0).normalize();
    const inward = ts.P(bs + (k === 0 ? 1 : -1), l, 0.062).sub(pos).setY(0).normalize();
    return { pos, yaw: Math.atan2(out.x, out.z), inward, wallL: L.garageBack - l };
  };

  return {
    group,
    garages,
    stats,
    bay,
    hideCrew(team) {
      crew.hideTeam = team;
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
    dispose() {
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
      crew.group.visible = d < 420;
      if (crew.group.visible) crew.update(dt, cam);
      for (let k = 0; k < TEAMS.length; k++) signalU.uSig.value[k] = crew.signal(k);
      stats.crewDrawn = crew.group.visible ? crew.drawn : [0, 0];
      stats.updateMs = Math.round((performance.now() - u0) * 1000) / 1000;
    },
  };
}
