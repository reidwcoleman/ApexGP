import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import { MeshBuilder, srgb } from '../geom.ts';
import type { Layout } from '../layout.ts';
import type { TerrainBuild } from '../terrain.ts';
import type { WorldMap } from '../worldmap.ts';
import { HUNGARORING_SPOTS, hungaroringParasols, type Parasol } from './hungaroring.ts';

/**
 * The Hungaroring's own dressing, built from the spots planHungaroring chose:
 *
 *  - the terrain in late July: sun-dried golden grass, dusty verges, and the farmland round the
 *    estate as the Great Plain's big fields — sunflowers in bloom, harvested wheat stubble with
 *    its straw swaths, dark maize, ploughed earth (a patch on the terrain shader's field layer);
 *  - whitewashed farmsteads (tanya) with red-tile roofs out in the fields;
 *  - the village churches of Mogyoród, Kerepes, Szada and Fót (white towers, dark spires);
 *  - car parks and campsites on the fields, parasols over the fans on the hillside banks;
 *  - round straw bales left in rows on the mown meadows round the estate.
 */

export function buildHungaroringScenery(layout: Layout, track: Track, map: WorldMap, terrain: TerrainBuild): THREE.Group {
  hungaroringTerrainLook(terrain);
  const group = new THREE.Group();
  group.name = 'HungaroringLandmarks';
  const spots = HUNGARORING_SPOTS;
  if (spots.farms.length) for (const m of farms(spots.farms)) group.add(m);
  if (spots.churches.length) group.add(churches(spots.churches));
  if (spots.lots.length) for (const m of lots(spots.lots, map)) group.add(m);
  const ps = hungaroringParasols(track, map, layout.banks);
  if (ps.length) group.add(parasols(ps));
  const hb = bales(map);
  if (hb) group.add(hb);
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  return group;
}

// ---------------------------------------------------------------------------- terrain look

const FIELD_ANCHOR = 'col = mix( col, fieldCol, farm );';

/** the Great Plain's farmland in late July (linear colours; p = world xz, wp = warped) */
const FIELD_GLSL = /* glsl */ `
if ( uHuFields > 0.5 ) {
  vec2 fs2 = vec2( 560.0, 380.0 );
  vec2 cell2 = floor( wp / fs2 );
  float k1 = h21( cell2 + 3.7 );
  float k2 = h21( cell2 + 9.1 );
  vec2 fc2 = fract( wp / fs2 );
  float edge2 = smoothstep( 0.0, 0.014, min( min( fc2.x, 1.0 - fc2.x ), min( fc2.y, 1.0 - fc2.y ) ) );
  // crop rows / harvest swaths across each field
  float ra = floor( k2 * 4.0 ) * 0.785 + 0.3;
  vec2 rn = vec2( -sin( ra ), cos( ra ) );
  float ru = dot( p, rn );
  float rowsU = ru / 0.8;
  float rowsA = 1.0 - smoothstep( 0.25, 0.8, fwidth( rowsU ) );
  float rows = ( 0.5 + 0.5 * sin( rowsU * 6.2832 ) ) * rowsA;
  float swU = ru / 7.0;
  float swA = 1.0 - smoothstep( 0.2, 0.7, fwidth( swU ) );
  float swath = smoothstep( 0.82, 0.95, abs( fract( swU ) - 0.5 ) * 2.0 ) * swA;
  vec3 hf;
  if ( k1 < 0.24 ) {
    // sunflowers in bloom: golden yellow, the dark leaves and seed discs showing through
    vec3 bloom = vec3( 0.66, 0.43, 0.018 ) * ( 0.9 + 0.2 * d1 );
    vec3 leaf = vec3( 0.07, 0.1, 0.02 );
    hf = mix( bloom, leaf, 0.22 + 0.25 * rows + 0.15 * smoothstep( 0.5, 0.9, d2 ) );
    // a few fields past their best (heads bowed, browner)
    hf = mix( hf, vec3( 0.26, 0.2, 0.05 ), step( 0.2, k1 ) * 0.55 );
  } else if ( k1 < 0.5 ) {
    // harvested wheat: pale stubble with brighter straw swaths
    vec3 stub = vec3( 0.52, 0.4, 0.2 ) * ( 0.9 + 0.15 * d1 );
    hf = mix( stub, vec3( 0.66, 0.53, 0.28 ), swath * 0.7 );
    hf = mix( hf, stub * 0.8, rows * 0.25 );
  } else if ( k1 < 0.6 ) {
    // standing wheat / barley, ripe gold
    hf = vec3( 0.55, 0.38, 0.12 ) * ( 0.88 + 0.2 * d1 + 0.08 * rows );
  } else if ( k1 < 0.76 ) {
    // maize: deep green, the rows reading as stripes up close
    hf = vec3( 0.06, 0.1, 0.025 ) * ( 0.9 + 0.25 * rows + 0.15 * d2 );
  } else if ( k1 < 0.86 ) {
    // ploughed / disced after the harvest: dusty brown earth
    hf = mix( vec3( 0.2, 0.13, 0.07 ), vec3( 0.3, 0.21, 0.12 ), 0.5 + 0.5 * rows ) * ( 0.9 + 0.2 * d1 );
  } else {
    // dry pasture / fallow
    hf = mix( uMeadow, uStraw, 0.55 + 0.3 * d1 );
  }
  hf *= 0.93 + 0.12 * m3;
  // unmown grass and weeds along the field margins and tracks
  hf = mix( mix( uStraw, uGrassDark, 0.45 ), hf, edge2 );
  col = mix( col, hf, farm );
}
`;

/**
 * Hungary in late July: hot, hazy, golden — sun-dried meadows, tired green verges, dusty earth
 * and gravel, olive oak woods, red-tile roofs; and the big fields of the plain.
 */
export function hungaroringTerrainLook(t: TerrainBuild) {
  const u = t.uniforms;
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x6e7a3a);
  set('uMeadow', 0x86804a);
  set('uStraw', 0xb59f62);
  set('uGrassDark', 0x535a2e);
  set('uEarth', 0xa38a68);
  set('uGravel', 0xc4b597);
  set('uGravelDark', 0x93846a);
  set('uLitter', 0x5e4c34);
  set('uLitterDark', 0x362c20);
  set('uMoss', 0x5a5e30);
  set('uCanopy', 0x3a4628);
  set('uRoof', 0x96503a);
  const mat = t.material;
  const hu = { uHuFields: { value: 1 } };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (!sh.fragmentShader.includes(FIELD_ANCHOR)) {
      console.warn('[hungaroring] terrain shader anchor not found — no field look');
      return;
    }
    Object.assign(sh.uniforms, hu);
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uHuFields;\nvoid main() {').replace(FIELD_ANCHOR, FIELD_ANCHOR + FIELD_GLSL);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '-hungaroring-fields';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------- buildings

const WHITE = srgb(0xf0ede4);
const CREAM = srgb(0xeee2bf);
const OCHRE = srgb(0xe6cf8e);
const TILE = srgb(0xa4482c);
const TILE_OLD = srgb(0x8a4a33);
const TIMBER = srgb(0x6b5238);
const WINDOW = srgb(0x2a2c30);
const SHUTTER = srgb(0x5b6a4a);

/** gabled roof over x0..x1 (ridge along x), eaves at yE over z ±d, ridge height yR; both slopes + gable ends */
function gable(mb: MeshBuilder, x0: number, x1: number, d: number, yE: number, yR: number, roof: THREE.Color, wall: THREE.Color, over = 0.8) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const e = over;
  mb.quad4(V(x1 + e, yE - 0.3, d + e), V(x0 - e, yE - 0.3, d + e), V(x0 - e, yR, 0), V(x1 + e, yR, 0), roof);
  mb.quad4(V(x0 - e, yE - 0.3, -d - e), V(x1 + e, yE - 0.3, -d - e), V(x1 + e, yR, 0), V(x0 - e, yR, 0), roof);
  for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
    const a = mb.vertex(x, yE, -d, s, 0, 0, wall);
    const b = mb.vertex(x, yE, d, s, 0, 0, wall);
    const c = mb.vertex(x, yR - 0.1, 0, s, 0, 0, wall);
    if (s > 0) mb.idx.push(a, c, b);
    else mb.idx.push(a, b, c);
  }
}

/** a tanya: the long single-storey house (gable to the lane), a barn, a corn crib */
function farmProto(variant: number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const wall = variant === 1 ? CREAM : variant === 2 ? OCHRE : WHITE;
  // the house: 20 × 8 m, whitewashed, the roof steep and red
  mb.aabb(-10, -1.5, -4, 10, 3.2, 4, wall);
  mb.aabb(-10, -1.5, -4.05, 10, 0.4, 4.05, srgb(0x6a655c));
  gable(mb, -10, 10, 4, 3.2, 7.4, TILE, wall, 0.9);
  // the tornác (the open veranda along the yard side): posts under the roof
  for (let x = -8; x <= 8; x += 3.2) mb.aabb(x - 0.2, 0, 4.5, x + 0.2, 3.0, 4.9, wall);
  for (const x of [-7, -3, 1, 5]) {
    mb.aabb(x - 0.5, 0.9, 4.02, x + 0.5, 2.2, 4.1, WINDOW);
    mb.aabb(x - 0.5, 0.9, -4.1, x + 0.5, 2.2, -4.02, WINDOW);
    mb.aabb(x - 0.95, 0.85, -4.12, x - 0.55, 2.25, -4.04, SHUTTER);
    mb.aabb(x + 0.55, 0.85, -4.12, x + 0.95, 2.25, -4.04, SHUTTER);
  }
  mb.aabb(5, 6.4, -1, 5.8, 8.6, -0.2, wall);
  // the barn / stable across the yard
  const barn = new MeshBuilder();
  barn.aabb(0, -1.5, -5, 22, 3.6, 5, variant === 2 ? WHITE : srgb(0xc9bda4));
  gable(barn, 0, 22, 5, 3.6, 8.2, TILE_OLD, variant === 2 ? WHITE : srgb(0xc9bda4), 0.8);
  barn.aabb(8, 0, 5.02, 12, 3.2, 5.1, TIMBER);
  barn.transform(new THREE.Matrix4().makeRotationY(variant === 1 ? Math.PI / 2 : 0).setPosition(variant === 1 ? -16 : -6, 0, variant === 1 ? 10 : -16));
  mb.append(barn);
  // the corn crib (góré): a slatted timber cage on stilts under a little roof
  mb.aabb(13, -0.5, -2, 15, 4, 5, TIMBER);
  gable(mb, 13, 15, 3.5, 4, 5.4, TILE_OLD, TIMBER, 0.4);
  return mb.geometry(false);
}

function farms(list: { x: number; z: number; y: number; rot: number; size: number }[]): THREE.Object3D[] {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const out: THREE.Object3D[] = [];
  for (let v = 0; v < 3; v++) {
    const mine = list.filter((_, i) => i % 3 === v);
    if (!mine.length) continue;
    const im = new THREE.InstancedMesh(farmProto(v), mat, mine.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    mine.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot);
      s.setScalar(f.size);
      p.set(f.x, f.y, f.z);
      im.setMatrixAt(i, m.compose(p, q, s));
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'hungaroring_farms_' + v;
    out.push(im);
  }
  return out;
}

/** a baroque village church: white nave under red tiles, the west tower with a dark pointed spire */
function churches(list: { x: number; z: number; y: number; rot: number }[]): THREE.Object3D {
  const all = new MeshBuilder();
  const spire = srgb(0x3b4a45);
  const trim = srgb(0xe2d7b8);
  for (const c of list) {
    const mb = new MeshBuilder();
    mb.aabb(-12, -1.5, -6.5, 12, 10, 6.5, WHITE);
    gable(mb, -12, 12, 6.5, 10, 16.5, TILE, WHITE, 0.5);
    mb.aabb(12, -1.5, -4.5, 16, 9, 4.5, WHITE);
    for (const z of [-6.56, 6.56]) for (const x of [-7, -2, 3, 8]) mb.aabb(x - 0.8, 3.5, z - 0.05, x + 0.8, 8.2, z + 0.05, WINDOW);
    // the tower: pilaster corners, the clock and belfry, a cornice
    mb.aabb(-18, -1.5, -3.6, -11, 25, 3.6, WHITE);
    mb.aabb(-18.3, 24.6, -3.9, -10.7, 25.4, 3.9, trim);
    mb.aabb(-18.2, 12, -3.8, -10.8, 12.5, 3.8, trim);
    for (const [x, z] of [[-14.5, -3.66], [-14.5, 3.66], [-18.06, 0], [-10.94, 0]] as const) {
      const dx = Math.abs(z) > 1 ? 0.8 : 0.05, dz = Math.abs(z) > 1 ? 0.05 : 0.8;
      mb.aabb(x - dx, 19, z - dz, x + dx, 22.5, z + dz, WINDOW);
      mb.aabb(x - dx * 1.2, 15.2, z - dz * 1.2, x + dx * 1.2, 17.6, z + dz * 1.2, trim);
    }
    // the spire: a small bulb, then the tall pointed helm (lathe)
    const prof: [number, number][] = [[4.0, 25.2], [3.2, 26.6], [2.2, 27.4], [2.5, 28.4], [1.6, 29.6], [0.9, 30.2], [1.0, 31], [0.55, 33.5], [0.25, 37], [0.06, 40.5]];
    const ring: number[][] = [];
    const sides = 8;
    for (const [r, y] of prof) {
      const row: number[] = [];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2 + Math.PI / 8;
        row.push(mb.vertex(-14.5 + Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), 0.3, Math.sin(a), spire));
      }
      ring.push(row);
    }
    for (let i = 0; i < ring.length - 1; i++)
      for (let k = 0; k < sides; k++) mb.idx.push(ring[i][k], ring[i + 1][k], ring[i][k + 1], ring[i][k + 1], ring[i + 1][k], ring[i + 1][k + 1]);
    mb.aabb(-14.58, 40.2, -0.06, -14.42, 42.4, 0.06, srgb(0xd9b24a));
    mb.aabb(-14.58, 41.4, -0.6, -14.42, 41.56, 0.6, srgb(0xd9b24a));
    mb.transform(new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, c.y, c.z));
    all.append(mb);
  }
  const geo = all.geometry(false);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, flatShading: true, side: THREE.DoubleSide }));
  m.castShadow = false;
  m.receiveShadow = true;
  m.name = 'hungaroring_churches';
  return m;
}

// ---------------------------------------------------------------------------- car parks, campsites, parasols

const CAR_COLS = [0xe8e8e6, 0xd9dadb, 0x1c1d20, 0x2b2d31, 0x8c9096, 0xa8acb0, 0x6d7278, 0x1f3a6b, 0x7a1b1b, 0xb42a26, 0x2f4f3a, 0x3a3f58, 0xc9c1a8, 0xf0f0ee, 0x404448];
const TENT_COLS = [0xe8612a, 0x2f6fc2, 0x3f8a3a, 0xd9c23a, 0xce2939, 0x7c8c96, 0xf07e1e, 0x1f4d8a, 0x5e7d34, 0xeeeeee, 0xff7b00, 0x477050];
const PARASOL_COLS = [0xce2939, 0xffffff, 0x477050, 0xff7b00, 0x1f4d8a, 0xf2d23a, 0xe8612a, 0x2f6fc2, 0xdb0a40, 0xf4f4f0, 0x1c1d20, 0x00a19c];

function lots(list: { x: number; z: number; rot: number; hw: number; hl: number; camp: boolean }[], map: WorldMap): THREE.Object3D[] {
  let seed = 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  type I = { x: number; z: number; yaw: number; c: THREE.Color; s: number };
  const cars: I[] = [], tents: I[] = [], vans: I[] = [];
  for (const L of list) {
    const ca = Math.cos(L.rot), sa = Math.sin(L.rot);
    const at = (u: number, v: number) => ({ x: L.x + u * ca + v * sa, z: L.z - u * sa + v * ca });
    if (!L.camp) {
      for (let u = -L.hw + 3; u < L.hw - 3; u += 12)
        for (const du of [0, 5.2])
          for (let v = -L.hl + 2; v < L.hl - 2; v += 2.7) {
            if (rnd() < 0.2) continue;
            const q = at(u + du, v + (rnd() - 0.5) * 0.3);
            cars.push({ ...q, yaw: L.rot + Math.PI / 2 + (du ? Math.PI : 0) + (rnd() - 0.5) * 0.12, c: new THREE.Color(CAR_COLS[Math.floor(rnd() * CAR_COLS.length)]), s: 0.92 + rnd() * 0.16 });
          }
    } else {
      for (let u = -L.hw + 5; u < L.hw - 5; u += 9)
        for (let v = -L.hl + 5; v < L.hl - 5; v += 9) {
          if (rnd() < 0.15) continue;
          const j = at(u + (rnd() - 0.5) * 5, v + (rnd() - 0.5) * 5);
          const yaw = L.rot + (rnd() - 0.5) * 1.2;
          const k = rnd();
          if (k < 0.2) vans.push({ ...j, yaw, c: new THREE.Color(k < 0.1 ? 0xf2f2f0 : 0xdcd8cc), s: 0.9 + rnd() * 0.25 });
          else {
            tents.push({ ...j, yaw, c: new THREE.Color(TENT_COLS[Math.floor(rnd() * TENT_COLS.length)]), s: 0.8 + rnd() * 0.7 });
            if (rnd() < 0.45) cars.push({ x: j.x - 3.6 * Math.sin(yaw), z: j.z - 3.6 * Math.cos(yaw), yaw: yaw + Math.PI / 2, c: new THREE.Color(CAR_COLS[Math.floor(rnd() * CAR_COLS.length)]), s: 1 });
          }
        }
    }
  }
  const W = new THREE.Color(1, 1, 1);
  const car = new MeshBuilder();
  car.aabb(-0.9, 0.25, -2.2, 0.9, 0.95, 2.2, W);
  car.aabb(-0.8, 0.95, -1.2, 0.8, 1.45, 0.9, new THREE.Color(0.35, 0.37, 0.4));
  const tent = new MeshBuilder();
  {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const a = V(-1.3, 0, -1.3), b = V(1.3, 0, -1.3), c = V(1.3, 0, 1.3), d = V(-1.3, 0, 1.3), t1 = V(0, 1.35, -0.35), t2 = V(0, 1.35, 0.35);
    tent.quad4(d, c, t2, t2, W);
    tent.quad4(b, a, t1, t1, W);
    tent.quad4(a, d, t2, t1, W);
    tent.quad4(c, b, t1, t2, W);
  }
  const van = new MeshBuilder();
  van.aabb(-1.15, 0.35, -3.2, 1.15, 2.6, 3.2, W);
  van.aabb(-1.17, 1.4, -2.6, 1.17, 1.9, 2.0, new THREE.Color(0.25, 0.27, 0.3));
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const out: THREE.Object3D[] = [];
  const inst = (mb: MeshBuilder, items: I[], m: THREE.Material, name: string) => {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(mb.geometry(false), m, items.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      p.set(it.x, map.height(it.x, it.z) - 0.05, it.z);
      q.setFromAxisAngle(up, it.yaw);
      sc.setScalar(it.s);
      im.setMatrixAt(i, M.compose(p, q, sc));
      im.setColorAt(i, it.c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = false;
    im.receiveShadow = true;
    im.name = name;
    out.push(im);
  };
  inst(car, cars, mat, 'hungaroring_parked_cars');
  inst(tent, tents, cloth, 'hungaroring_tents');
  inst(van, vans, mat, 'hungaroring_caravans');
  return out;
}

/** beach parasols over the fans on the grass banks (the July sun): pole + eight-panel canopy */
function parasols(list: Parasol[]): THREE.Object3D {
  const W = new THREE.Color(1, 1, 1);
  const mb = new MeshBuilder();
  mb.aabb(-0.03, 0, -0.03, 0.03, 2.1, 0.03, new THREE.Color(0.85, 0.85, 0.85));
  const N = 8, R = 1.1;
  const top = new THREE.Vector3(0, 2.35, 0);
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * R, 1.95, Math.sin(a0) * R), p1 = new THREE.Vector3(Math.cos(a1) * R, 1.95, Math.sin(a1) * R);
    mb.quad4(p1, p0, top, top, W);
  }
  const im = new THREE.InstancedMesh(mb.geometry(false), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), list.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const col = new THREE.Color();
  list.forEach((it, i) => {
    const h = (it.c % 1000) / 1000, h2 = (Math.floor(it.c / 1000) % 1000) / 1000;
    axis.set(h - 0.5, 0, h2 - 0.5).normalize();
    q.setFromAxisAngle(axis, 0.12 + 0.2 * h2);
    p.set(it.x, it.y - 0.1, it.z);
    sc.setScalar(0.85 + 0.35 * h);
    im.setMatrixAt(i, M.compose(p, q, sc));
    im.setColorAt(i, col.set(PARASOL_COLS[it.c % PARASOL_COLS.length]));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'hungaroring_parasols';
  return im;
}

/** round straw bales lying in rows on the mown meadows between the circuit and the fields */
function bales(map: WorldMap): THREE.Object3D | null {
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const c = map.A.center;
  const list: { x: number; z: number; yaw: number; s: number }[] = [];
  const ok = (x: number, z: number) => {
    const d = map.distToTrack(x, z);
    return d > 110 && d < 900 && map.forest(x, z) < 0.03 && !map.excluded(x, z, 4) && map.pathDistance(x, z).d > 8 && !map.inPitZone(x, z, 40) && map.urban(x, z) < 0.02;
  };
  for (let tries = 0; tries < 600 && list.length < 220; tries++) {
    const a = rnd() * Math.PI * 2, r = 500 + rnd() * 900;
    const x0 = c.x + Math.cos(a) * r, z0 = c.z + Math.sin(a) * r;
    if (!ok(x0, z0)) continue;
    // a row or two along the mowing direction
    const yaw = rnd() * Math.PI;
    const ux = Math.cos(yaw), uz = Math.sin(yaw);
    const n = 3 + Math.floor(rnd() * 7);
    for (let k = 0; k < n; k++) {
      const x = x0 + ux * k * (9 + rnd() * 5) + (rnd() - 0.5) * 3, z = z0 + uz * k * (9 + rnd() * 5) + (rnd() - 0.5) * 3;
      if (!ok(x, z)) break;
      list.push({ x, z, yaw: yaw + (rnd() - 0.5) * 0.6, s: 0.9 + rnd() * 0.2 });
    }
  }
  if (!list.length) return null;
  // a 1.5 m round bale lying on its side (axis along local x), faceted, the ends paler
  const mb = new MeshBuilder();
  const side = srgb(0xc9a864), end = srgb(0xd8bd7c);
  const N = 12, R = 0.78, H = 0.62;
  const ring: [number, number][] = [];
  for (let k = 0; k <= N; k++) ring.push([Math.cos((k / N) * Math.PI * 2), Math.sin((k / N) * Math.PI * 2)]);
  for (let k = 0; k < N; k++) {
    const [c0, s0] = ring[k], [c1, s1] = ring[k + 1];
    const P = (x: number, cc: number, ss: number) => new THREE.Vector3(x, R + ss * R, cc * R);
    mb.quad4(P(-H, c0, s0), P(H, c0, s0), P(H, c1, s1), P(-H, c1, s1), side);
    for (const x of [-H, H]) {
      const o = mb.vertex(x, R, 0, Math.sign(x), 0, 0, end);
      const v0 = mb.vertex(x, R + s0 * R, c0 * R, Math.sign(x), 0, 0, end);
      const v1 = mb.vertex(x, R + s1 * R, c1 * R, Math.sign(x), 0, 0, end);
      if (x > 0) mb.idx.push(o, v0, v1);
      else mb.idx.push(o, v1, v0);
    }
  }
  const geo = mb.geometry(false);
  geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), list.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => {
    p.set(b.x, map.height(b.x, b.z) - 0.12, b.z);
    q.setFromAxisAngle(up, b.yaw);
    sc.setScalar(b.s);
    im.setMatrixAt(i, M.compose(p, q, sc));
  });
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'hungaroring_bales';
  return im;
}
