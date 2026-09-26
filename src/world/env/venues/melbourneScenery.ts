import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { buildWaters, seaPolygon, type Water } from '../water.ts';
import { hash2i, rng } from '../noise.ts';
import { Merge, cityMaterial } from './montrealCity.ts';
import { ISLAND, LAKE_CHAIN, MEL_LAKE_Y, MEL_SEA_Y, MEL_SITES, QUEENS, lakeContour, lakeDistance, melbourneGeo, seaDistance } from './melbourneLand.ts';

/**
 * Albert Park's landmarks and water, built once per world:
 *
 *   the lake        Albert Park Lake inside the lap (one water body on its real shoreline,
 *                   Gunn Island standing out of it), a few sculls out on it
 *   the bay         Port Phillip Bay beyond the south-western suburbs
 *   rowing sheds    the clubs' boathouses and pontoons on the lake's west shore
 *   palms           Canary Island date palms along the lakeside promenade and Lakeside Drive
 *   the city        the CBD's towers 3 km north on the Hoddle Grid, Southbank's (Eureka,
 *                   Australia 108) in front of them, the Arts Centre spire, the offices of
 *                   St Kilda Road and the apartment towers of Queens Road along the park's
 *                   east side, Docklands to the north-west
 *   the Shrine      the Shrine of Remembrance on its mound in the Kings Domain
 *   the MSAC        the aquatic centre by Turn 3, Lakeside Stadium's red track and stand
 *
 * Buildings are one merged mesh with the city window shader (lit windows at night), the
 * rest one merged mesh, the palms two instanced meshes. The towers cast no shadows.
 */

const C = (h: number) => new THREE.Color(h);
const GLASS = [0x7d93a6, 0x8aa0b0, 0x5f7383, 0x9fb1be, 0x6c7f8e, 0xa9b6bf, 0x4f5f6c].map(C);
const CONCRETE = [0xcfcac0, 0xbdb7ab, 0xd9d5cc, 0xa9a399, 0xe2ded5, 0x9c9890].map(C);
const BRICK = [0x9a5a44, 0x8e4f3c, 0xa8674c, 0xc9b79a].map(C);

// ---------------------------------------------------------------- water

function buildMelbourneWater(map: WorldMap): Water {
  const lake = lakeContour(map, 0, 4);
  // the bay: a half-plane from 150 m inland of the coast out into the haze (the foreshore's sand
  // covers its inland edge; the terrain drops under it along the real, wobbly coast)
  const sp = { x: -1150 + 0.588 * 150, z: 1250 - 0.809 * 150 };
  return buildWaters([
    {
      outline: lake,
      y: MEL_LAKE_Y,
      kind: 'lake',
      // a shallow, slightly green-brown park lake
      deep: [0.018, 0.034, 0.036],
      shallow: [0.05, 0.07, 0.052],
      shore: 4,
    },
    {
      outline: seaPolygon(sp, 216, 22000),
      y: MEL_SEA_Y,
      kind: 'sea',
      deep: [0.012, 0.038, 0.062],
      shallow: [0.05, 0.12, 0.12],
      shore: 0,
    },
  ]);
}

// ---------------------------------------------------------------- terrain look

/** early autumn: the park's lawns irrigated but tiring, straw in the roughs, grey-green gums */
export function melbourneTerrainLook(u: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x5c7536);
  set('uMeadow', 0x75773f);
  set('uStraw', 0xa3925c);
  set('uGrassDark', 0x46572a);
  set('uCanopy', 0x3a4a31);
  set('uRoof', 0x8a8c8e);
  set('uGravel', 0xc6b491);
  set('uSand', 0xd8c7a0);
  // Melbourne sprawls to the horizon: the far terrain reads as suburbs
  if (u.uCity) u.uCity.value = 1;
}

// ---------------------------------------------------------------- palms

/** Canary Island date palm crown: ~30 long fronds arching out and down into a full round head */
function canaryCrown(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const add = (yaw: number, pitch: number, len: number, width: number, droop: number) => {
    const seg = 5;
    const base = pos.length / 3;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let rx = 0, ry = 0;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      if (k > 0) {
        const th = Math.max(-1.4, pitch - droop * (t - 0.5 / seg));
        rx += Math.cos(th) * (len / seg);
        ry += Math.sin(th) * (len / seg);
      }
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.1)) * 0.5;
      for (const sgn of [-1, 1]) {
        pos.push(dir.x * rx + side.x * w * sgn, ry - w * 0.3, dir.z * rx + side.z * w * sgn);
        uv.push(sgn < 0 ? 0 : 1, t);
      }
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };
  // four tiers: the old fronds hanging down the trunk, two arching out and over, the young ones
  // standing up in the centre: a full, round head
  const N = 44;
  for (let i = 0; i < N; i++) {
    const yaw = (i / N) * Math.PI * 2 + (i % 4) * 0.21;
    const tier = i % 4;
    add(yaw, [-0.25, 0.3, 0.75, 1.15][tier], [5.2, 5.8, 5.6, 4.4][tier] + ((i * 7) % 5) * 0.14, 1.75, [1.0, 1.55, 1.75, 1.3][tier]);
  }
  for (let i = 0; i < 6; i++) add((i / 6) * Math.PI * 2 + 0.3, 1.35, 3.2, 0.9, 0.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nr.count; i++) {
    const v = new THREE.Vector3(nr.getX(i), Math.abs(nr.getY(i)) + 0.9, nr.getZ(i)).normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** a frond seen flat: stiff, dense, dark glossy leaflets along a yellow-green rachis */
function frondTexture(): THREE.CanvasTexture {
  const W = 128, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const r = rng(81);
  ctx.lineCap = 'round';
  for (let y = 8; y < H - 4; y += 2.6) {
    const t = y / H;
    const len = W * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.05)) * (0.85 + r() * 0.2);
    for (const sgn of [-1, 1]) {
      const g = 0.8 + r() * 0.3;
      const grad = ctx.createLinearGradient(W / 2, y, W / 2 + sgn * len, y + len * 0.5);
      grad.addColorStop(0, `rgb(${Math.round(58 * g)},${Math.round(90 * g)},${Math.round(36 * g)})`);
      grad.addColorStop(1, `rgb(${Math.round(104 * g)},${Math.round(138 * g)},${Math.round(62 * g)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.quadraticCurveTo(W / 2 + sgn * len * 0.6, y + len * 0.12, W / 2 + sgn * len, y + len * 0.5 + (r() - 0.5) * 5);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#8c8a4a';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildPalms(map: WorldMap, track: Track): THREE.Group {
  const spots: { x: number; z: number; s: number }[] = [];
  const r = rng(6161);
  const ok = (x: number, z: number) => map.trackClearance(x, z) > 7 && !map.excluded(x, z, 2) && map.pathDistance(x, z).d > 1.2 && !map.inPitZone(x, z, 4) && lakeDistance(map, x, z) > 3;
  // the promenade round the lake: a palm every ~24 m on its landward side
  const ring = lakeContour(map, 15, 3);
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    acc += Math.hypot(b.x - a.x, b.z - a.z);
    if (acc < 24) continue;
    acc = 0;
    if (ok(a.x, a.z)) spots.push({ x: a.x, z: a.z, s: 0.9 + r() * 0.25 });
  }
  // Lakeside Drive: a row on the inside of the back straight, between the road and the water
  const p = new THREE.Vector3();
  for (let s = 3060; s <= 3960; s += 26) {
    track.point(s, track.barrierAt(s, 1) + 11, 0, p);
    if (ok(p.x, p.z)) spots.push({ x: p.x, z: p.z, s: 0.95 + r() * 0.2 });
  }
  // round the paddock's lake frontage
  const pit = track.pit;
  for (let s = pit.sStart + 30; s <= pit.sEnd - 30; s += 30) {
    track.point(s, pit.side * (112 + r() * 8), 0, p);
    if (ok(p.x, p.z)) spots.push({ x: p.x, z: p.z, s: 0.9 + r() * 0.2 });
  }

  const trunk = new THREE.CylinderGeometry(0.42, 0.55, 1, 7, 3, true);
  trunk.translate(0, 0.5, 0);
  const crown = canaryCrown();
  const tex = frondTexture();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7d6a52, roughness: 0.95 });
  trunkMat.onBeforeCompile = (sh) => {
    // the diamond pattern of old leaf bases
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTU = vec2( atan( position.x, position.z ), position.y );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTU;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec2 q = vec2( vTU.x * 2.2 + vTU.y * 16.0, vTU.x * 2.2 - vTU.y * 16.0 ); float d = abs( fract( q.x ) - 0.5 ) + abs( fract( q.y ) - 0.5 ); diffuseColor.rgb *= 0.78 + 0.3 * smoothstep( 0.25, 0.5, d ); }');
  };
  trunkMat.customProgramCacheKey = () => 'apex-mel-palm-trunk';
  const leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.62, color: 0xffffff });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.35, side: THREE.DoubleSide });
  const n = spots.length;
  const tm = new THREE.InstancedMesh(trunk, trunkMat, Math.max(1, n));
  const cm = new THREE.InstancedMesh(crown, leafMat, Math.max(1, n));
  cm.customDepthMaterial = leafDepth;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const e = new THREE.Euler();
  const tint = new THREE.Color();
  spots.forEach((sp, i) => {
    const hh = (k: number) => hash2i(Math.floor(sp.x * 3), Math.floor(sp.z * 3), k);
    const H = (7 + hh(5) * 6) * sp.s;
    const y = map.height(sp.x, sp.z) - 0.2;
    e.set((hh(6) - 0.5) * 0.06, hh(7) * Math.PI * 2, 0, 'YXZ');
    q.setFromEuler(e);
    ps.set(sp.x, y, sp.z);
    sc.set(sp.s, H, sp.s);
    M.compose(ps, q, sc);
    tm.setMatrixAt(i, M);
    const top = new THREE.Vector3(0, H, 0).applyQuaternion(q).add(ps);
    const cs = sp.s * (1.15 + hh(8) * 0.25);
    sc.set(cs, cs, cs);
    M.compose(top, q, sc);
    cm.setMatrixAt(i, M);
    tint.setRGB(0.9 + r() * 0.2, 0.92 + r() * 0.16, 0.85 + r() * 0.15);
    cm.setColorAt(i, tint);
  });
  tm.count = cm.count = n;
  for (const m of [tm, cm]) {
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.receiveShadow = true;
    m.castShadow = true;
  }
  if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  tm.name = 'mel_palm_trunks';
  cm.name = 'mel_palm_crowns';
  const g = new THREE.Group();
  g.name = 'MelbournePalms';
  g.add(tm, cm);
  return g;
}

// ---------------------------------------------------------------- the city

function buildCity(map: WorldMap, M: Merge) {
  const r = rng(3141);
  const ground = (x: number, z: number) => map.height(x, z) - 0.5;
  const free = (x: number, z: number, margin: number) => {
    const g = melbourneGeo(map, x, z);
    return g.out > margin && seaDistance(x, z) < -80;
  };
  // ---- the CBD on the Hoddle Grid: a 1.8 × 0.9 km rectangle of towers, the tallest in the middle
  const D = MEL_SITES.cbd;
  const rot = 0.35;
  const ux = Math.cos(rot), uz = -Math.sin(rot), vx = Math.sin(rot), vz = Math.cos(rot);
  for (let a = -900; a <= 900; a += 48)
    for (let b = -460; b <= 460; b += 44) {
      const ia = Math.round(a / 48), ib = Math.round(b / 44);
      // the grid's laneways: every fourth row is a street
      if (ib % 4 === 0) continue;
      const x = D.x + ux * a + vx * b, z = D.z + uz * a + vz * b;
      const h0 = hash2i(ia, ib, 3);
      if (h0 > 0.86) continue;
      const core = Math.max(0, 1 - Math.hypot(a / 900, b / 520));
      const tall = hash2i(ia, ib, 5);
      let h = 18 + tall * 30;
      if (tall > 0.45) h = 40 + core * 200 * hash2i(ia, ib, 6) ** 1.3;
      if (tall > 0.93) h = 120 + core * 140;
      const modern = h > 50 || hash2i(ia, ib, 8) < 0.3;
      const w = 22 + hash2i(ia, ib, 11) * 18, d = 20 + hash2i(ia, ib, 12) * 16;
      const col = (modern ? (hash2i(ia, ib, 13) < 0.65 ? GLASS : CONCRETE) : BRICK)[Math.floor(hash2i(ia, ib, 14) * 4)].clone().multiplyScalar(0.9 + r() * 0.2);
      const y = ground(x, z);
      const cw = modern && h > 50 ? 0.6 + 0.4 * hash2i(ia, ib, 17) : 0;
      M.box(x, z, y, y + h, w, d, rot, col, cw, modern ? 0.5 + 0.5 * hash2i(ia, ib, 18) : 0);
      // setbacks and plant rooms on the tall ones
      if (h > 120) M.box(x, z, y + h, y + h + 10 + hash2i(ia, ib, 19) * 16, w * 0.62, d * 0.62, rot, col.clone().multiplyScalar(0.85), cw, 0.5);
    }
  // ---- named towers (the skyline's signature shapes)
  const T = (x: number, z: number) => ({ x, z, y: ground(x, z) });
  {
    // Australia 108: 317 m, gold-and-white, the "starburst" cantilever two-thirds of the way up
    const t = T(-1010, -2700);
    M.box(t.x, t.z, t.y, t.y + 210, 40, 30, 0.2, C(0xd8d2c2), 0.9, 0.7);
    M.box(t.x - 6, t.z, t.y + 206, t.y + 222, 58, 40, 0.2, C(0xc9a24a), 0.4, 0.8);
    M.box(t.x + 2, t.z + 2, t.y + 222, t.y + 317, 30, 26, 0.2, C(0xd8d2c2), 0.9, 0.7, 0.8);
    // Eureka Tower: 297 m, blue glass with gold-plated windows on its top ten floors, the red stripe
    const e = T(-770, -2790);
    M.box(e.x, e.z, e.y, e.y + 262, 42, 38, 0.35, C(0x3e4e66), 1, 0.9);
    M.box(e.x, e.z, e.y + 262, e.y + 292, 42, 38, 0.35, C(0xd8a942), 1, 1);
    M.box(e.x, e.z, e.y + 292, e.y + 297, 30, 28, 0.35, C(0xd8a942), 0, 0);
    M.box(e.x + 21.5 * Math.cos(0.35), e.z - 21.5 * Math.sin(0.35), e.y + 20, e.y + 280, 1.2, 12, 0.35, C(0xb3261e), 0, 0);
    // Prima Pearl, Southbank Grand, Victoria One …
    for (const [dx, dz, h, w, col] of [[-880, -2660, 254, 32, 0x9aa7b3], [-640, -2700, 185, 30, 0x8394a4], [-1120, -2840, 200, 30, 0xb7b9b6], [-950, -2900, 240, 30, 0x6f8193], [-700, -2620, 160, 34, 0xc9c5bb], [-1220, -2660, 170, 28, 0x7e8f9c], [-560, -2780, 150, 30, 0xa1adb6]] as const) {
      const q = T(dx, dz);
      M.box(q.x, q.z, q.y, q.y + h, w, w * 0.85, 0.3 + (r() - 0.5) * 0.4, C(col), 0.9, 0.8);
    }
    // the CBD's tallest: Aurora, 120 Collins (with its spire), 101 Collins, the Rialto's twin blue towers
    const aur = T(D.x - 120, D.z - 260);
    M.box(aur.x, aur.z, aur.y, aur.y + 271, 36, 30, rot, C(0xb9c2c9), 0.9, 0.8);
    const c120 = T(D.x + 420, D.z - 20);
    M.box(c120.x, c120.z, c120.y, c120.y + 220, 40, 34, rot, C(0x8f9ba5), 0.7, 0.6);
    M.box(c120.x, c120.z, c120.y + 220, c120.y + 228, 26, 22, rot, C(0x8f9ba5), 0, 0);
    M.box(c120.x, c120.z, c120.y + 228, c120.y + 265, 2.2, 2.2, rot, C(0xd8d8d8), 0, 0, 0.3);
    const c101 = T(D.x + 520, D.z + 70);
    M.box(c101.x, c101.z, c101.y, c101.y + 260, 42, 36, rot, C(0x7c8a96), 0.8, 0.6);
    const ri = T(D.x - 520, D.z + 60);
    M.box(ri.x, ri.z, ri.y, ri.y + 251, 32, 30, rot, C(0x4f6f8f), 1, 1);
    M.box(ri.x + 30, ri.z + 16, ri.y, ri.y + 185, 30, 28, rot, C(0x4f6f8f), 1, 1);
    // Collins Arch and Queen & Collins mid-heights
    for (const [da, db, h, col] of [[-300, 120, 210, 0xa6b3bd], [200, -180, 230, 0x7f8f9c], [-60, 180, 190, 0xc4c6c4], [640, -200, 200, 0x93a2ae], [-720, -120, 205, 0x6d7f8e]] as const) {
      const q = T(D.x + ux * da + vx * db, D.z + uz * da + vz * db);
      M.box(q.x, q.z, q.y, q.y + h, 36, 32, rot, C(col), 0.9, 0.8);
    }
  }
  // ---- the Arts Centre: the lattice spire (162 m) over its drum
  {
    const S = MEL_SITES.spire;
    const y = ground(S.x, S.z);
    M.box(S.x + 40, S.z + 40, y, y + 22, 90, 70, 0.3, C(0xb9a88a));
    const top = new THREE.Vector3(S.x, y + 162, S.z);
    const white = C(0xe8e8ea);
    const ribs = 8;
    const baseY = y + 24, R0 = 12;
    const pt = (k: number, t: number) => {
      const a = (k / ribs) * Math.PI * 2;
      const rr = R0 * (1 - t) ** 1.25;
      return new THREE.Vector3(S.x + Math.cos(a) * rr, baseY + (top.y - baseY) * t, S.z + Math.sin(a) * rr);
    };
    for (let k = 0; k < ribs; k++) M.beam(pt(k, 0), top, 0.9, white);
    // the skirt of mesh bands and rings up the spire
    for (let lv = 0; lv < 10; lv++) {
      const t = lv / 10;
      for (let k = 0; k < ribs; k++) M.beam(pt(k, t), pt(k + 1, t), 0.5, white);
      if (lv < 9) for (let k = 0; k < ribs; k++) M.beam(pt(k, t), pt(k + 1, t + 0.1), 0.35, white);
    }
    M.box(S.x, S.z, y + 20, y + 30, 20, 20, 0.3, C(0xcfc6b6));
  }
  // ---- St Kilda Road's offices and Queens Road's apartment towers along the park's east side
  {
    const dx = QUEENS.bx - QUEENS.ax, dz = QUEENS.bz - QUEENS.az;
    const L = Math.hypot(dx, dz);
    const Ux = dx / L, Uz = dz / L;
    // east of the road: the normal (uz, −ux)
    const Nx = Uz, Nz = -Ux;
    const yaw = Math.atan2(Nx, Nz);
    for (let t = -400; t <= L + 200; t += 36) {
      const k = Math.round(t / 36);
      for (const [off, kind] of [[34, 0], [300, 1], [370, 1]] as const) {
        const x = QUEENS.ax + Ux * t + Nx * off, z = QUEENS.az + Uz * t + Nz * off;
        if (!free(x, z, 10)) continue;
        const h0 = hash2i(k, off, 41);
        if (h0 > (kind === 0 ? 0.8 : 0.72)) continue;
        const h = kind === 0 ? 28 + hash2i(k, off, 42) * 55 : 36 + hash2i(k, off, 43) * 85;
        const col = (kind === 0 ? CONCRETE : hash2i(k, off, 44) < 0.6 ? GLASS : CONCRETE)[Math.floor(hash2i(k, off, 45) * 4)].clone();
        const y = ground(x, z);
        M.box(x, z, y, y + h, 22 + hash2i(k, off, 46) * 12, 20 + hash2i(k, off, 47) * 10, yaw + (hash2i(k, off, 48) - 0.5) * 0.2, col, kind === 1 ? 0.7 : 0.2, kind === 1 ? 0.7 : 0.35);
      }
    }
  }
  // ---- South Melbourne / Kings Way and Docklands: mid-rise towers scattered between the park and the river
  for (let k = 0; k < 170; k++) {
    const fx = r(), fz = r();
    let x: number, z: number, hmax: number;
    if (k < 110) {
      x = -1300 + fx * 1500;
      z = -2500 + fz * 900;
      hmax = 70 + 90 * fz;
    } else {
      x = -2400 + fx * 900;
      z = -3700 + fz * 900;
      hmax = 140;
    }
    if (!free(x, z, 120)) continue;
    const h = 20 + r() * hmax;
    const y = ground(x, z);
    M.box(x, z, y, y + h, 20 + r() * 14, 18 + r() * 12, rot + (r() - 0.5) * 0.3, (r() < 0.5 ? GLASS : CONCRETE)[Math.floor(r() * 4)].clone(), 0.6, 0.6);
  }
}

// ---------------------------------------------------------------- build

export function buildMelbourneScenery(layout: Layout, track: Track, map: WorldMap): { group: THREE.Group; tris: number; update(elapsed: number): void } {
  void layout;
  const group = new THREE.Group();
  group.name = 'MelbourneScenery';
  const r = rng(6161);
  const g = (x: number, z: number) => map.height(x, z);
  const water = buildMelbourneWater(map);
  group.add(water.mesh);

  const city = new Merge();
  const solid = new Merge();
  buildCity(map, city);

  // ---------------------------------------------------------------- the rowing sheds on the east shore
  {
    const cream = C(0xe9e2cf), green = C(0x3f5e46), red = C(0x8e3a2a), timber = C(0x8a7457), dark = C(0x2c2f33), deck = C(0x9a8b74);
    const sheds: { x: number; z: number; nx: number; nz: number }[] = [];
    // walk west from points on the lake's axis until the shore, then step back out onto the grass
    for (const k of [1, 2, 3, 4]) {
      const [cx, cz] = LAKE_CHAIN[k];
      let x = cx, z = cz;
      for (let st = 0; st < 400 && lakeDistance(map, x, z) < 0; st++) x -= 1;
      // the shore's outward normal by central differences
      const e = 2;
      const gx = lakeDistance(map, x + e, z) - lakeDistance(map, x - e, z), gz = lakeDistance(map, x, z + e) - lakeDistance(map, x, z - e);
      const gl = Math.hypot(gx, gz) || 1;
      sheds.push({ x, z, nx: gx / gl, nz: gz / gl });
    }
    for (const sh of sheds) {
      const yaw = Math.atan2(sh.nx, sh.nz);
      const bx = sh.x + sh.nx * 14, bz = sh.z + sh.nz * 14;
      if (map.trackClearance(bx, bz) < 12 || map.excluded(bx, bz, 2)) continue;
      const y = Math.max(MEL_LAKE_Y + 0.4, g(bx, bz));
      const roof = r() < 0.5 ? green : red;
      // two storeys: boat bays below (dark doors facing the water), the clubroom and its balcony above
      solid.box(bx, bz, y - 0.5, y + 7.5, 26, 13, yaw, cream);
      solid.box(bx, bz, y + 7.5, y + 8, 27.4, 14.4, yaw, roof);
      // hipped roof
      solid.pyramid(bx, bz, y + 8, y + 10.5, 27.4, 14.4, yaw, roof);
      for (let d = -9; d <= 9; d += 6) {
        const px = bx - sh.nx * 6.6 + Math.cos(yaw) * d, pz = bz - sh.nz * 6.6 - Math.sin(yaw) * d;
        solid.box(px, pz, y, y + 3.6, 4.4, 0.3, yaw, dark);
      }
      // the balcony
      solid.box(bx - sh.nx * 7.4, bz - sh.nz * 7.4, y + 4.2, y + 4.5, 24, 2.2, yaw, timber);
      // the pontoon out onto the water, a couple of sculls tied up and a pair out on the lake
      const px = sh.x - sh.nx * 7, pz = sh.z - sh.nz * 7;
      solid.box(px, pz, MEL_LAKE_Y + 0.1, MEL_LAKE_Y + 0.45, 20, 5, yaw, deck);
      for (const off of [-1, 1]) {
        const qx = px - sh.nx * 4.6 + Math.cos(yaw) * off * 4, qz = pz - sh.nz * 4.6 - Math.sin(yaw) * off * 4;
        solid.box(qx, qz, MEL_LAKE_Y, MEL_LAKE_Y + 0.3, 8.2, 0.45, yaw, C(0xf2f2f0));
      }
      const ox = sh.x - sh.nx * (60 + r() * 60), oz = sh.z - sh.nz * (60 + r() * 60);
      if (lakeDistance(map, ox, oz) < -8) {
        const hy = yaw + Math.PI / 2 + (r() - 0.5) * 0.5;
        solid.box(ox, oz, MEL_LAKE_Y - 0.05, MEL_LAKE_Y + 0.28, 0.5, 11.5, hy, C(0xf4f1e8));
        solid.box(ox, oz, MEL_LAKE_Y + 0.28, MEL_LAKE_Y + 0.9, 0.5, 0.6, hy, C(0x1d3f7a));
        solid.box(ox, oz, MEL_LAKE_Y + 0.2, MEL_LAKE_Y + 0.26, 5.6, 0.12, hy, C(0xd8d8d8));
      }
    }
  }

  // ---------------------------------------------------------------- Gunn Island's shrubs are the forest's; give it a little jetty
  {
    const y = MEL_LAKE_Y + 0.15;
    solid.box(ISLAND.x + ISLAND.rx + 4, ISLAND.z, y, y + 0.3, 9, 2.4, 0, C(0x8f8068));
  }

  // ---------------------------------------------------------------- the Shrine of Remembrance
  {
    const S = MEL_SITES.shrine;
    const y = g(S.x, S.z);
    const stone = C(0xb8ae99), stoneD = C(0x9c937f);
    // the terraces
    solid.box(S.x, S.z, y - 1, y + 2, 110, 110, 0, stoneD);
    solid.box(S.x, S.z, y + 2, y + 4, 86, 86, 0, stone);
    // the sanctuary and its porticos (N and S), columns
    solid.box(S.x, S.z, y + 4, y + 19, 42, 42, 0, stone);
    for (const sd of [-1, 1]) {
      solid.box(S.x, S.z + sd * 27, y + 17, y + 21, 26, 12, 0, stone);
      for (let k = -3; k <= 3; k++) solid.box(S.x + k * 3.6, S.z + sd * 31.5, y + 4, y + 17, 1.2, 1.2, 0, C(0xc8bea8));
      // pediment
      solid.pyramid(S.x, S.z + sd * 27, y + 21, y + 25, 26, 12, 0, stone);
    }
    // the stepped pyramid roof (after the Mausoleum of Halicarnassus) and its finial
    for (let k = 0; k < 6; k++) solid.box(S.x, S.z, y + 19 + k * 1.4, y + 20.4 + k * 1.4, 36 - k * 4.2, 36 - k * 4.2, 0, stone);
    solid.pyramid(S.x, S.z, y + 27.4, y + 33, 10, 10, 0, stone);
  }

  // ---------------------------------------------------------------- the aquatic centre and Lakeside Stadium
  {
    const M0 = MEL_SITES.msac;
    const y = g(M0.x, M0.z);
    const yaw = 0.35;
    // a long low hall with a glazed front and a gently curved (here, pitched) silver roof
    solid.box(M0.x, M0.z, y - 0.3, y + 11, 140, 80, yaw, C(0xd6d3cc));
    solid.box(M0.x, M0.z, y + 11, y + 12, 144, 84, yaw, C(0xa7adb2));
    solid.pyramid(M0.x, M0.z, y + 12, y + 17, 144, 84, yaw, C(0xb9bec2));
    const gx = Math.sin(yaw), gz = Math.cos(yaw);
    city.box(M0.x + gx * 40.5, M0.z + gz * 40.5, y, y + 10, 120, 1, yaw, C(0x6c8394), 1, 1);
    // Lakeside Stadium: the red athletics track round a green infield, the covered west stand
    const Sd = MEL_SITES.stadium;
    const sy = g(Sd.x, Sd.z) + 0.05;
    const cy = Math.cos(yaw), sn = Math.sin(yaw);
    const ring = (rx: number, rz: number, w: number, col: THREE.Color) => {
      const N = 48;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        const p0 = [Math.cos(a0) * rx, Math.sin(a0) * rz], p1 = [Math.cos(a1) * rx, Math.sin(a1) * rz];
        const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const a = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
        solid.box(Sd.x + mx * cy + mz * sn, Sd.z - mx * sn + mz * cy, sy, sy + 0.12, w, len + 0.6, yaw + a, col);
      }
    };
    ring(82, 50, 10, C(0xa9412f));
    solid.box(Sd.x - sn * 0 - cy * 0, Sd.z, sy - 0.02, sy + 0.1, 150, 82, yaw, C(0x4f7a34));
    const stx = Sd.x - cy * 0 + sn * -70, stz = Sd.z + cy * -70;
    for (let k = 0; k < 10; k++) solid.box(stx - sn * k * 1.1, stz - cy * k * 1.1, sy, sy + 0.8 + k * 0.6, 90, 1.2, yaw, k % 2 ? C(0x2a5ea0) : C(0x24528c));
    solid.box(stx - sn * 6, stz - cy * 6, sy + 12, sy + 12.6, 96, 16, yaw, C(0xeeeeec));
  }

  // ---------------------------------------------------------------- meshes
  const cityMesh = new THREE.Mesh(city.geometry(), cityMaterial(false));
  cityMesh.name = 'mel_city';
  cityMesh.castShadow = false;
  cityMesh.receiveShadow = false;
  group.add(cityMesh);
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const solidMesh = new THREE.Mesh(solid.geometry(), solidMat);
  solidMesh.name = 'mel_landmarks';
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  group.add(solidMesh);
  group.add(buildPalms(map, track));
  for (const o of group.children) {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  }
  const tris = (city.idx.length + solid.idx.length) / 3;
  return { group, tris, update: (t: number) => water.update(t) };
}
