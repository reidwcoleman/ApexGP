/**
 * The house behind the lawn: a two-storey facade (red brick with white sashes, or white render
 * with black frames), a pitched tiled roof with a chimney, French doors onto a paved patio.
 * Scanned brick, plaster, roof and paving textures; real glass that reflects the sky; at dusk the
 * windows glow.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelDef } from './levels.ts';
import { pbrMaterial } from './assets.ts';
import { Rng } from './util.ts';
import type { Scenery } from './scenery.ts';

type List = THREE.BufferGeometry[];

/** a box with metric uv (one texture repeat = `tile` metres) */
function box(list: List, w: number, h: number, d: number, x: number, y: number, z: number, tile = 1.2, ox = 0, oy = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    let a: number;
    let b: number;
    if (nx > 0.5) {
      a = pos.getZ(i) + d / 2;
      b = pos.getY(i) + h / 2;
    } else if (ny > 0.5) {
      a = pos.getX(i) + w / 2;
      b = pos.getZ(i) + d / 2;
    } else {
      a = pos.getX(i) + w / 2 + x + ox;
      b = pos.getY(i) + h / 2 + y + oy;
    }
    uv.setXY(i, a / tile, b / tile);
  }
  g.translate(x, y, z);
  list.push(g);
}

export async function buildHouse(level: LevelDef): Promise<Scenery> {
  const hs = level.house!;
  const brick = hs.style === 0;
  const rng = new Rng(level.seed * 29 + 5);
  const [wallM, roofM, payM] = await Promise.all([
    pbrMaterial(brick ? 'brick' : 'plaster', { color: brick ? '#e6c9b8' : '#f3efe6', roughness: 1 }),
    pbrMaterial('roof', { color: brick ? '#b86a48' : '#4a4d52', roughness: 1 }),
    pbrMaterial('paving', { color: '#d9d4c8' }),
  ]);
  const trimMat = new THREE.MeshStandardMaterial({ color: brick ? '#f4f1ea' : '#1f2125', roughness: 0.5 });
  const doorMat = new THREE.MeshStandardMaterial({ color: brick ? '#27465f' : '#2b3a30', roughness: 0.4, metalness: 0.0 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0d141b', roughness: 0.035, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8 });
  const lit = level.theme.lights;
  const glowMat = new THREE.MeshStandardMaterial({ color: '#2a2218', emissive: '#ffc873', emissiveIntensity: 2.4, roughness: 0.6 });
  const stoneMat = await pbrMaterial('stonewall', { color: '#cfc9bd' });
  const mats = [wallM, roofM, payM, trimMat, doorMat, glassMat, glowMat, stoneMat];

  const wall: List = [];
  const roof: List = [];
  const trim: List = [];
  const door: List = [];
  const glass: List = [];
  const glow: List = [];
  const stone: List = [];
  const pave: List = [];

  const x0 = hs.x0;
  const x1 = hs.x1;
  const W = x1 - x0;
  const cx = (x0 + x1) / 2;
  const D = 7;
  const front = hs.z - 0.04;
  const zc = front - D / 2;
  const floorH = 2.7;
  const H = floorH * 2 + 0.3;
  // the walls and a stone plinth
  box(wall, W, H, D, cx, H / 2, zc, brick ? 1.0 : 1.8);
  box(stone, W + 0.1, 0.4, D + 0.1, cx, 0.2, zc, 1.0);
  // the roof: two slopes meeting at a ridge, with an overhang, and gable ends
  const rise = 2.6;
  const half = D / 2 + 0.55;
  const slope = Math.atan2(rise, D / 2);
  const slen = Math.hypot(rise, half);
  for (const s of [-1, 1]) {
    const r = new THREE.BoxGeometry(W + 0.9, 0.12, slen);
    const uv = r.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((W + 0.9) / 1.3), uv.getY(i) * (slen / 1.3));
    r.rotateX(s * slope);
    r.translate(cx, H + rise / 2 + 0.05, zc + s * (half / 2) * 0.95);
    roof.push(r);
  }
  // gable-end triangles in the wall material
  for (const sx of [-1, 1]) {
    const tri = new THREE.BufferGeometry();
    const hz = D / 2;
    const p = [0, 0, -hz, 0, 0, hz, 0, rise, 0];
    tri.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, D, 0, D / 2, rise], 2));
    tri.setIndex(sx > 0 ? [0, 1, 2] : [0, 2, 1]);
    tri.computeVertexNormals();
    tri.translate(sx > 0 ? x1 : x0, H, zc);
    wall.push(tri);
  }
  // a ridge cap
  box(trim, W + 0.9, 0.1, 0.22, cx, H + rise + 0.1, zc, 1);
  // eaves board and a gutter
  box(trim, W + 0.9, 0.18, 0.1, cx, H - 0.05, front + 0.5, 1);
  const gut = new THREE.CylinderGeometry(0.06, 0.06, W + 0.9, 10, 1, true, 0, Math.PI);
  gut.rotateZ(Math.PI / 2);
  gut.translate(cx, H - 0.2, front + 0.58);
  trim.push(gut);
  // a chimney
  const chx = cx + (rng.chance(0.5) ? -1 : 1) * W * 0.28;
  box(wall, 0.9, rise + 1.5, 0.9, chx, H + (rise + 1.5) / 2 - 0.2, zc - 0.6, 0.9);
  box(trim, 1.05, 0.1, 1.05, chx, H + rise + 1.35, zc - 0.6, 1);
  for (let i = 0; i < 2; i++) {
    const pot = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 12);
    pot.translate(chx + (i - 0.5) * 0.4, H + rise + 1.6, zc - 0.6);
    door.push(pot);
  }

  // windows and doors on the front: ground floor then upper floor
  const patioMid = (hs.px0 + hs.px1) / 2;
  const win = (x: number, y: number, w: number, h: number, glowing: boolean) => {
    const fz = front + 0.03;
    // frame, glass, bars
    box(trim, w + 0.16, h + 0.16, 0.08, x, y, fz, 1);
    (glowing ? glow : glass).push(new THREE.BoxGeometry(w, h, 0.06).translate(x, y, fz + 0.025));
    box(trim, 0.045, h, 0.1, x, y, fz + 0.03, 1);
    const rows = h > 1.4 ? 2 : 1;
    for (let r = 1; r <= rows; r++) box(trim, w, 0.04, 0.1, x, y - h / 2 + (h * r) / (rows + 1), fz + 0.03, 1);
    box(stone, w + 0.3, 0.07, 0.2, x, y - h / 2 - 0.1, fz + 0.05, 0.6);
  };
  const doorX = patioMid;
  const slots: number[] = [];
  const step = 3.3;
  const n = Math.max(2, Math.floor(W / step));
  for (let i = 0; i < n; i++) slots.push(x0 + (i + 0.5) * (W / n));
  for (const x of slots) {
    const nearDoor = Math.abs(x - doorX) < 1.9;
    if (!nearDoor) win(x, 1.4, 1.1, 1.35, lit && rng.chance(0.7));
    win(x, floorH + 1.45, 1.1, 1.35, lit && rng.chance(0.55));
  }
  // French doors onto the patio, with the front door beside them on the left
  {
    const w = 2.0;
    const h = 2.15;
    const fz = front + 0.03;
    box(trim, w + 0.2, h + 0.14, 0.1, doorX, h / 2 + 0.1, fz, 1);
    (lit ? glow : glass).push(new THREE.BoxGeometry(w, h, 0.06).translate(doorX, h / 2 + 0.1, fz + 0.03));
    box(trim, 0.06, h, 0.12, doorX, h / 2 + 0.1, fz + 0.04, 1);
    for (const y of [0.9, 1.6]) box(trim, w, 0.04, 0.1, doorX, y, fz + 0.04, 1);
  }
  // the porch lamp
  const lampX = doorX - 1.5;
  const lamp = new THREE.SphereGeometry(0.1, 12, 10);
  lamp.translate(lampX, 2.5, front + 0.18);
  glow.push(lamp);
  box(trim, 0.08, 0.2, 0.08, lampX, 2.65, front + 0.08, 1);
  // drainpipes at the corners
  for (const x of [x0 + 0.25, x1 - 0.25]) {
    const pipe = new THREE.CylinderGeometry(0.045, 0.045, H - 0.4, 8);
    pipe.translate(x, (H - 0.4) / 2 + 0.2, front + 0.07);
    trim.push(pipe);
  }
  // the patio: big scanned slabs, 15 mm proud of the lawn
  {
    const pw = hs.px1 - hs.px0;
    const pd = hs.pz1 - hs.z;
    const g = new THREE.PlaneGeometry(pw, pd);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (pw / 1.6), uv.getY(i) * (pd / 1.6));
    g.translate((hs.px0 + hs.px1) / 2, 0.015, (hs.z + hs.pz1) / 2);
    pave.push(g);
  }

  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const add = (list: List, mat: THREE.Material, cast = true) => {
    if (!list.length) return;
    // (merge needs matching attributes: every piece here has position, normal and uv)
    const g = mergeGeometries(list.map((x) => (x.getAttribute('normal') ? x : (x.computeVertexNormals(), x))), false);
    if (!g) return;
    list.forEach((x) => x.dispose());
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
  };
  add(wall, wallM);
  add(roof, roofM);
  add(trim, trimMat);
  add(door, doorMat);
  add(glass, glassMat, false);
  add(glow, glowMat, false);
  add(stone, stoneMat);
  add(pave, payM, false);
  return {
    group,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
