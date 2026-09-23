/**
 * The hero asset: a fully procedural 2026-style F1 car.
 *
 *   root (place/orient; origin = ground level, mid-wheelbase; +Z forward, +X left)
 *   ├─ body            sprung: hull, wings, floor, halo, driver, cockpit … (game pitches/rolls this)
 *   │   ├─ L0 / L1 / L2   detail groups (merged per material)
 *   │   │   ├─ flap pivot (DRS)      └─ steering pivot (L0)
 *   │   └─ anchors: cockpit, tcam, nose, rearWing, exhaust
 *   ├─ unsprung L0/L1  suspension arms, rear uprights/brakes, rear blur discs
 *   ├─ corners FL FR RL RR
 *   │   └─ steer (fronts) → assembly (upright, disc, caliper, duct) + blur disc + spinFlip → spin → tyre, spokes
 *   └─ wheels L2       all four wheels merged (far LOD)
 *
 * Geometry is built once per detail level and shared by every car; materials are per team/driver.
 */
import * as THREE from 'three';
import type { Team, Driver } from '../race/Teams.ts';
import { buildCarGeometry, FLAP_PIVOT, STEER_PIVOT, STEER_TILT, HELMET_C, type CarGeoLevel } from './carGeometry.ts';
import { acquireLivery, releaseLivery } from './Livery.ts';
import { carbonTextures, wheelTextures, trimShared, trimTexture, driverTexture, fontsLoaded } from './carTextures.ts';
import { WHEELBASE, TRACK_F, TRACK_R, WHEEL_R, Z_FRONT_AXLE, Z_REAR_AXLE, CAR_WIDTH } from './carLayout.ts';

export interface CarRig {
  root: THREE.Group;
  body: THREE.Group;
  setSteer(rad: number): void;
  setWheelSpin(frontRad: number, rearRad: number): void;
  setWheelSpeed(mps: number): void;
  setBrakeGlow(v: number): void;
  setRainLight(on: boolean): void;
  setDrs(open: number): void;
  setDetail(level: 0 | 1 | 2): void;
  setDriverVisible(v: boolean): void;
  update(dt: number): void;
  readonly anchors: {
    cockpit: THREE.Object3D;
    tcam: THREE.Object3D;
    nose: THREE.Object3D;
    rearWing: THREE.Object3D;
    exhaust: THREE.Object3D;
    wheelFL: THREE.Object3D;
    wheelFR: THREE.Object3D;
    wheelRL: THREE.Object3D;
    wheelRR: THREE.Object3D;
  };
  readonly dims: { wheelbase: number; trackFront: number; trackRear: number; length: number; width: number; wheelRadius: number };
  dispose(): void;
}

/** resolves when the livery fonts are loaded (textures repaint automatically either way) */
export function preloadCarAssets(): Promise<void> {
  return fontsLoaded;
}

// ------------------------------------------------------------------------------------ shared geometry
let GEO: CarGeoLevel[] | null = null;
let geoRefs = 0;
function acquireGeo(): CarGeoLevel[] {
  if (!GEO) GEO = [buildCarGeometry(0), buildCarGeometry(1), buildCarGeometry(2)];
  geoRefs++;
  return GEO;
}
function releaseGeo() {
  if (--geoRefs > 0 || !GEO) return;
  for (const l of GEO) {
    const all = [l.body.paint, l.body.carbon, l.body.trim, l.body.driver, l.body.decals, l.flap, l.steer, l.unsprung.carbon, l.unsprung.trim,
      l.unsprung.blurRear, l.frontAssy, l.blurFront, l.wheelF, l.wheelR, l.spokesF, l.spokesR, l.wheelsMerged];
    for (const g of all) g?.dispose();
  }
  GEO = null;
}
export function carTriangles(level: 0 | 1 | 2) {
  return (GEO ?? acquireGeo())[level].triangles;
}

// ------------------------------------------------------------------------------------ shaders
const PAINT_KEY = 'apex-paint-v1';
function patchPaint(mat: THREE.MeshPhysicalMaterial, mask: THREE.Texture, carbon: THREE.Texture) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.liveryMask = { value: mask };
    sh.uniforms.carbonMap = { value: carbon };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 cuv;\nvarying vec2 vCuv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCuv = cuv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D liveryMask;\nuniform sampler2D carbonMap;\nvarying vec2 vCuv;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float cMask = texture2D( liveryMask, vMapUv ).r;
        vec3 cw = texture2D( carbonMap, vCuv ).rgb;
        diffuseColor.rgb = mix( diffuseColor.rgb, cw, cMask );`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.34, cMask );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.0, cMask );')
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = mix( material.clearcoat, 1.0, cMask );
          material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.07, cMask );
        #endif
        #ifdef USE_SHEEN
          material.sheenColor *= ( 1.0 - cMask );
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => PAINT_KEY;
}

interface TrimUniforms {
  uHeat: { value: number };
  uRain: { value: number };
  uSelf: { value: number };
}
function patchTrim(mat: THREE.MeshStandardMaterial, u: TrimUniforms) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHeat = u.uHeat;
    sh.uniforms.uRain = u.uRain;
    sh.uniforms.uSelf = u.uSelf;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHeat;\nuniform float uRain;\nuniform float uSelf;')
      .replace(
        '#include <emissivemap_fragment>',
        `vec4 emM = texture2D( emissiveMap, vEmissiveMapUv );
        float h = clamp( uHeat, 0.0, 1.0 );
        vec3 heat = mix( vec3( 0.9, 0.04, 0.0 ), vec3( 1.0, 0.42, 0.08 ), h * h ) * ( h * h * 17.0 + h * 2.0 );
        totalEmissiveRadiance = heat * emM.r + vec3( 1.0, 0.03, 0.015 ) * emM.g * uRain + diffuseColor.rgb * emM.b * uSelf;`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-trim-v1';
}

// ------------------------------------------------------------------------------------ shared materials
let carbonMat: THREE.MeshPhysicalMaterial | null = null;
function sharedCarbon() {
  if (carbonMat) return carbonMat;
  const c = carbonTextures();
  carbonMat = new THREE.MeshPhysicalMaterial({
    name: 'car-carbon',
    map: c.map,
    normalMap: c.normal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: c.rough,
    roughness: 1.3,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.22,
    specularIntensity: 0.55,
    envMapIntensity: 0.55,
  });
  return carbonMat;
}
let wheelMat: THREE.MeshPhysicalMaterial | null = null;
function sharedWheel() {
  if (wheelMat) return wheelMat;
  const w = wheelTextures('soft');
  wheelMat = new THREE.MeshPhysicalMaterial({
    name: 'car-wheel',
    map: w.map,
    roughnessMap: w.orm,
    metalnessMap: w.orm,
    roughness: 1,
    metalness: 1,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0.35, 0.35, 0.35),
  });
  return wheelMat;
}

const paintCache = new Map<string, { mat: THREE.MeshPhysicalMaterial; refs: number }>();
function acquirePaint(team: Team) {
  const hit = paintCache.get(team.id);
  if (hit) {
    hit.refs++;
    return hit.mat;
  }
  const liv = acquireLivery(team);
  const c = new THREE.Color(team.primary);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const metallic = hsl.s < 0.15 && hsl.l > 0.25 && hsl.l < 0.85 ? 0.55 : 0.08;
  const m = team.matte;
  const mat = new THREE.MeshPhysicalMaterial({
    name: `car-paint-${team.id}`,
    map: liv.map,
    roughness: 0.46 + 0.22 * m - metallic * 0.12,
    metalness: metallic,
    clearcoat: 1 - 0.72 * m,
    clearcoatRoughness: 0.035 + 0.42 * m,
    sheen: 0.4 * m,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0.3, 0.3, 0.32),
  });
  patchPaint(mat, liv.mask, carbonTextures().map);
  paintCache.set(team.id, { mat, refs: 1 });
  return mat;
}
function releasePaint(team: Team) {
  const hit = paintCache.get(team.id);
  if (!hit) return;
  if (--hit.refs <= 0) {
    hit.mat.dispose();
    releaseLivery(team);
    paintCache.delete(team.id);
  }
}

// ------------------------------------------------------------------------------------ createCar
export function createCar(team: Team, driver: Driver, seat: 0 | 1, opts: { envMap?: THREE.Texture } = {}): CarRig {
  const geo = acquireGeo();
  const paint = acquirePaint(team);
  let carbon = sharedCarbon();
  let wheel = sharedWheel();
  const ts = trimShared();
  const trimTex = trimTexture(team, driver, seat);
  const uniforms: TrimUniforms = { uHeat: { value: 0 }, uRain: { value: 0 }, uSelf: { value: 3.0 } };
  const trim = new THREE.MeshStandardMaterial({
    name: 'car-trim',
    map: trimTex,
    roughnessMap: ts.orm,
    metalnessMap: ts.orm,
    roughness: 1,
    metalness: 1,
    emissive: 0xffffff,
    emissiveMap: ts.emis,
  });
  patchTrim(trim, uniforms);
  const drvTex = driverTexture(team, driver);
  const driverMat = new THREE.MeshPhysicalMaterial({
    name: 'car-driver',
    map: drvTex,
    alphaTest: 0.5,
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const blurMat = new THREE.MeshStandardMaterial({
    name: 'car-wheel-blur',
    map: wheelTextures('soft').blur,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    roughness: 0.7,
    metalness: 0.2,
  });
  const own: THREE.Material[] = [trim, driverMat, blurMat];
  let paintMat: THREE.Material = paint;
  if (opts.envMap) {
    // per-car copies so a custom env map doesn't leak into other cars
    carbon = carbon.clone();
    wheel = wheel.clone();
    const p = paint.clone();
    p.onBeforeCompile = paint.onBeforeCompile;
    p.customProgramCacheKey = paint.customProgramCacheKey;
    paintMat = p;
    own.push(carbon, wheel, p);
    for (const m of [carbon, wheel, p, trim, driverMat, blurMat] as THREE.MeshStandardMaterial[]) m.envMap = opts.envMap;
  }

  const root = new THREE.Group();
  root.name = `car-${team.id}-${driver.code}`;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, recv = true) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = cast;
    x.receiveShadow = recv;
    return x;
  };

  // ---- body per level
  const bodyL: THREE.Group[] = [];
  const unsprungL: THREE.Group[] = [];
  const flapPivots: THREE.Object3D[] = [];
  const driverMeshes: { all: THREE.Mesh; decals: THREE.Mesh | null }[] = [];
  let steerSpin: THREE.Object3D | null = null;
  for (let lv = 0; lv < 3; lv++) {
    const L = geo[lv];
    const g = new THREE.Group();
    g.name = `L${lv}`;
    g.add(mesh(L.body.paint, paintMat));
    g.add(mesh(L.body.carbon, carbon));
    g.add(mesh(L.body.trim, trim));
    if (L.body.driver) {
      const all = mesh(L.body.driver, driverMat);
      g.add(all);
      let dec: THREE.Mesh | null = null;
      if (L.body.decals) {
        dec = mesh(L.body.decals, driverMat, false);
        dec.visible = false;
        g.add(dec);
      }
      driverMeshes.push({ all, decals: dec });
    }
    const fp = new THREE.Group();
    fp.position.set(FLAP_PIVOT[0], FLAP_PIVOT[1], FLAP_PIVOT[2]);
    fp.add(mesh(L.flap, paintMat));
    g.add(fp);
    flapPivots.push(fp);
    if (L.steer) {
      const pv = new THREE.Group();
      pv.position.set(STEER_PIVOT[0], STEER_PIVOT[1], STEER_PIVOT[2]);
      pv.rotation.x = STEER_TILT;
      const spin = new THREE.Group();
      spin.add(mesh(L.steer, trim, false));
      pv.add(spin);
      g.add(pv);
      steerSpin = spin;
    }
    body.add(g);
    bodyL.push(g);
    if (lv < 2) {
      const u = new THREE.Group();
      u.name = `unsprung-L${lv}`;
      u.add(mesh(L.unsprung.carbon, carbon));
      u.add(mesh(L.unsprung.trim, trim));
      if (L.unsprung.blurRear) {
        const b = mesh(L.unsprung.blurRear, blurMat, false, false);
        b.name = 'blur';
        b.visible = false;
        u.add(b);
      }
      root.add(u);
      unsprungL.push(u);
    } else {
      const u = new THREE.Group();
      u.name = 'unsprung-L2';
      u.add(mesh(L.unsprung.carbon, carbon));
      u.add(mesh(L.unsprung.trim, trim));
      root.add(u);
      unsprungL.push(u);
    }
  }
  const wheelsFar = mesh(geo[2].wheelsMerged!, wheel);
  root.add(wheelsFar);

  // ---- corners
  interface Corner {
    group: THREE.Group;
    steer: THREE.Group;
    spin: THREE.Group;
    side: number;
    front: boolean;
    lv: { tyre: THREE.Mesh; spokes: THREE.Mesh; assy: THREE.Mesh | null; blur: THREE.Mesh | null }[];
  }
  const corners: Corner[] = [];
  const mkCorner = (front: boolean, side: number) => {
    const group = new THREE.Group();
    group.position.set(((front ? TRACK_F : TRACK_R) / 2) * side, WHEEL_R, front ? Z_FRONT_AXLE : Z_REAR_AXLE);
    const steer = new THREE.Group();
    group.add(steer);
    const flip = new THREE.Group();
    if (side < 0) flip.rotation.y = Math.PI;
    steer.add(flip);
    const spin = new THREE.Group();
    flip.add(spin);
    const lv: Corner['lv'] = [];
    for (let l = 0; l < 2; l++) {
      const L = geo[l];
      const tyre = mesh(front ? L.wheelF! : L.wheelR!, wheel);
      const spokes = mesh(front ? L.spokesF! : L.spokesR!, wheel);
      spin.add(tyre, spokes);
      let assy: THREE.Mesh | null = null;
      let blur: THREE.Mesh | null = null;
      if (front) {
        const mirror = new THREE.Group();
        mirror.scale.x = side;
        assy = mesh(L.frontAssy!, trim, false);
        blur = mesh(L.blurFront!, blurMat, false, false);
        blur.visible = false;
        mirror.add(assy, blur);
        steer.add(mirror);
      }
      lv.push({ tyre, spokes, assy, blur });
    }
    root.add(group);
    const c: Corner = { group, steer, spin, side, front, lv };
    corners.push(c);
    return c;
  };
  const FL = mkCorner(true, 1);
  const FR = mkCorner(true, -1);
  const RL = mkCorner(false, 1);
  const RR = mkCorner(false, -1);

  // ---- anchors
  const anchor = (name: string, p: [number, number, number], parent: THREE.Object3D) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(p[0], p[1], p[2]);
    parent.add(o);
    return o;
  };
  const anchors = {
    cockpit: anchor('cockpit', [0, HELMET_C[1] + 0.005, HELMET_C[2] + 0.07], body),
    tcam: anchor('tcam', [0, 0.995, -0.255], body),
    nose: anchor('nose', [0, 0.2, 3.0], body),
    rearWing: anchor('rearWing', [0, 0.88, -2.12], body),
    exhaust: anchor('exhaust', [0, 0.458, -2.25], body),
    wheelFL: anchor('wheelFL', [0, 0, 0], FL.group),
    wheelFR: anchor('wheelFR', [0, 0, 0], FR.group),
    wheelRL: anchor('wheelRL', [0, 0, 0], RL.group),
    wheelRR: anchor('wheelRR', [0, 0, 0], RR.group),
  };

  // ---- state
  let detail: 0 | 1 | 2 = 0;
  let blur = 0;
  let rainOn = false;
  let rainT = 0;
  let driverVisible = true;

  const applyVisibility = () => {
    bodyL.forEach((g, i) => (g.visible = i === detail));
    unsprungL.forEach((g, i) => (g.visible = i === detail));
    wheelsFar.visible = detail === 2;
    const showBlur = blur > 0.02;
    for (const c of corners) {
      c.group.visible = detail < 2;
      c.lv.forEach((m, i) => {
        const on = i === detail;
        m.tyre.visible = on;
        m.spokes.visible = on && blur < 0.6;
        if (m.assy) m.assy.visible = on;
        if (m.blur) m.blur.visible = on && showBlur;
      });
    }
    for (const u of unsprungL) {
      const b = u.getObjectByName('blur');
      if (b) b.visible = showBlur;
    }
    for (const d of driverMeshes) {
      d.all.visible = driverVisible;
      if (d.decals) d.decals.visible = !driverVisible;
    }
  };
  applyVisibility();

  const rig: CarRig = {
    root,
    body,
    anchors,
    dims: { wheelbase: WHEELBASE, trackFront: TRACK_F, trackRear: TRACK_R, length: 5.46, width: CAR_WIDTH, wheelRadius: WHEEL_R },
    setSteer(rad) {
      FL.steer.rotation.y = rad;
      FR.steer.rotation.y = rad;
      if (steerSpin) steerSpin.rotation.z = -rad * 6;
    },
    setWheelSpin(f, r) {
      FL.spin.rotation.x = f;
      FR.spin.rotation.x = -f;
      RL.spin.rotation.x = r;
      RR.spin.rotation.x = -r;
    },
    setWheelSpeed(mps) {
      const v = Math.abs(mps);
      const t = Math.min(1, Math.max(0, (v - 3) / 9));
      const b = t * t * (3 - 2 * t);
      if (Math.abs(b - blur) < 1e-3) return;
      const wasShown = blur > 0.02;
      const wasSpokes = blur < 0.6;
      blur = b;
      blurMat.opacity = b;
      if (wasShown !== blur > 0.02 || wasSpokes !== blur < 0.6) applyVisibility();
    },
    setBrakeGlow(v) {
      uniforms.uHeat.value = Math.min(1, Math.max(0, v));
    },
    setRainLight(on) {
      rainOn = on;
      if (!on) uniforms.uRain.value = 0;
    },
    setDrs(open) {
      const o = Math.min(1, Math.max(0, open));
      for (const fp of flapPivots) fp.rotation.x = -0.55 * o;
    },
    setDetail(level) {
      if (level === detail) return;
      detail = level;
      applyVisibility();
    },
    setDriverVisible(v) {
      driverVisible = v;
      applyVisibility();
    },
    update(dt) {
      if (rainOn) {
        rainT += dt;
        uniforms.uRain.value = rainT % 0.25 < 0.125 ? 16 : 0.4;
      }
    },
    dispose() {
      root.removeFromParent();
      for (const m of own) m.dispose();
      trimTex.dispose();
      drvTex.dispose();
      releasePaint(team);
      releaseGeo();
    },
  };
  return rig;
}
