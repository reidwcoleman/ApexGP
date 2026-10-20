import * as THREE from 'three';
import type { WorldMap } from '../worldmap.ts';
import { buildWaters, type Water, type WaterSpec } from '../water.ts';
import { fbm2, hash2i, rng } from '../noise.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import { Plain } from './monzaScenery.ts';
import { ALPINE_LAKE, RIVIERA_SEA, alpineLake, alpineLakeOutline, canyonWallFeet, rivieraCoast, rivieraSpots } from './scenicLand.ts';
import { boulders, rockMeshes, rockMaterial, type RockSpot } from './rocks.ts';

/**
 * What stands in the scenic venues' land (scenicLand.ts) besides trees and houses: the sea under the
 * cliffs of Capo Serena with its lighthouse and sailing boats, the lake at Bergsee with the chapel
 * on the hill, the boathouse and its jetty, and the boulders strewn over Red Mesa's desert floor.
 */

export interface ScenicSceneryBuild {
  group: THREE.Group;
  update(elapsed: number): void;
}

/** a depth texture over the 6 km square for the water's shallows and foam (from the real banks) */
function depthMap(map: WorldMap, level: number, range: number): THREE.DataTexture {
  const S = map.SQUARE;
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = S.x0 + ((i + 0.5) / N) * (S.x1 - S.x0), z = S.z0 + ((j + 0.5) / N) * (S.z1 - S.z0);
      const d = Math.max(0, Math.min(1, (level - map.height(x, z)) / range));
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(d * 255);
      data[k + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const C = (hex: number) => new THREE.Color(hex);

/** a vertex-coloured, lit, shadowed mesh from a Plain */
function plainMesh(p: Plain, name: string, rough = 0.85): THREE.Mesh {
  const m = new THREE.Mesh(p.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 }));
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** a ring of quads: a tapered tube from (r0 at y0) to (r1 at y1) round (x, z) */
function tube(p: Plain, x: number, z: number, y0: number, y1: number, r0: number, r1: number, k: THREE.Color, n = 16) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const A = new THREE.Vector3(x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0);
    const B = new THREE.Vector3(x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0);
    const Ct = new THREE.Vector3(x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1);
    const D = new THREE.Vector3(x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1);
    p.quad(A, D, Ct, B, k);
  }
}

/** a cone / disc cap */
function cap(p: Plain, x: number, z: number, y0: number, y1: number, r: number, k: THREE.Color, n = 16) {
  const top = new THREE.Vector3(x, y1, z);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    p.tri(new THREE.Vector3(x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r), top, new THREE.Vector3(x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r), k);
  }
}

/** glowing glass (a lighthouse lantern, lit windows): emissive after dark */
function glowMaterial(color: number, day: number, night: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a2024, roughness: 0.15, metalness: 0.1, emissive: color, emissiveIntensity: day });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSignGlow = weatherUniforms.uSignGlow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSignGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= mix( 1.0, ${night.toFixed(2)} / ${Math.max(day, 0.01).toFixed(2)}, smoothstep( 0.2, 0.8, uSignGlow ) );`);
  };
  m.customProgramCacheKey = () => `scenic-glow-${night}`;
  return m;
}

// ------------------------------------------------------------------------------------------ boats

/** one sailing yacht (local frame, bow toward +z): white hull, mast, mainsail and jib */
function yachtGeometry(): THREE.BufferGeometry {
  const p = new Plain();
  const white = C(0xf2f2ee), navy = C(0x1d2a3a), teak = C(0x8a6a48), sail = C(0xf4f1e8);
  const L = 11, B = 3.4;
  // hull: a pointed bow, a transom stern, tumblehome sides
  const deck = 1.2, keel = -0.9;
  const sec = (zz: number, w: number) => [new THREE.Vector3(-w, deck, zz), new THREE.Vector3(w, deck, zz), new THREE.Vector3(w * 0.7, 0.1, zz), new THREE.Vector3(-w * 0.7, 0.1, zz), new THREE.Vector3(0, keel, zz)];
  const zs = [-L / 2, -L / 4, 0, L / 4, L / 2 - 1.2, L / 2];
  const ws = [B * 0.42, B * 0.5, B * 0.5, B * 0.42, B * 0.22, 0.02];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = sec(zs[i], ws[i]), b = sec(zs[i + 1], ws[i + 1]);
    p.quad(a[0], b[0], b[3], a[3], white);
    p.quad(b[1], a[1], a[2], b[2], white);
    p.quad(a[3], b[3], b[4], a[4], navy);
    p.quad(b[2], a[2], a[4], b[4], navy);
    p.quad(a[0], a[1], b[1], b[0], teak);
  }
  const t = sec(zs[0], ws[0]);
  p.quad(t[1], t[0], t[3], t[2], white);
  // cabin
  p.box(0, -0.6, deck, deck + 0.7, B * 0.5, 3.2, 0, white, 0.92);
  // mast and boom
  p.post(new THREE.Vector3(0, deck, 0.6), new THREE.Vector3(0, deck + 14, 0.6), 0.18, C(0xc8c8c8), 0.1);
  // mainsail (both faces) and jib
  const m0 = new THREE.Vector3(0, deck + 1.3, 0.55), m1 = new THREE.Vector3(0, deck + 13.6, 0.55), m2 = new THREE.Vector3(0.2, deck + 1.3, -3.6);
  p.tri(m0, m1, m2, sail);
  p.tri(m0, m2, m1, sail);
  const j0 = new THREE.Vector3(0, deck + 0.3, L / 2 - 0.4), j1 = new THREE.Vector3(0, deck + 12.5, 0.75), j2 = new THREE.Vector3(-0.3, deck + 0.8, 0.9);
  p.tri(j0, j1, j2, sail);
  p.tri(j0, j2, j1, sail);
  return p.geometry();
}

/** a small open motor boat / fishing gozzo */
function dinghyGeometry(): THREE.BufferGeometry {
  const p = new Plain();
  const body = C(0x2f6fa0), white = C(0xeeeeea), wood = C(0x8a6a48);
  const L = 5.2, B = 1.8;
  const sec = (zz: number, w: number) => [new THREE.Vector3(-w, 0.7, zz), new THREE.Vector3(w, 0.7, zz), new THREE.Vector3(0, -0.3, zz)];
  const zs = [-L / 2, 0, L / 2 - 0.8, L / 2];
  const ws = [B * 0.4, B * 0.5, B * 0.3, 0.02];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = sec(zs[i], ws[i]), b = sec(zs[i + 1], ws[i + 1]);
    p.quad(a[0], b[0], b[2], a[2], body);
    p.quad(b[1], a[1], a[2], b[2], body);
    p.quad(a[0], a[1], b[1], b[0], wood);
  }
  const t = sec(zs[0], ws[0]);
  p.tri(t[1], t[0], t[2], white);
  p.box(0, -0.2, 0.7, 1.0, 0.8, 0.5, 0, white);
  return p.geometry();
}

interface Boat { x: number; z: number; rot: number; ph: number; s: number }

function boatFleet(geo: THREE.BufferGeometry, boats: Boat[], y: number, name: string) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, boats.length));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = boats.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const place = (t: number) => {
    boats.forEach((b, i) => {
      // a gentle roll and pitch on the swell, heeling a little to the breeze
      e.set(0.025 * Math.sin(t * 0.7 + b.ph * 2), b.rot, 0.06 + 0.035 * Math.sin(t * 0.9 + b.ph), 'YXZ');
      q.setFromEuler(e);
      v.set(b.x, y + 0.12 * Math.sin(t * 1.1 + b.ph * 3), b.z);
      sc.setScalar(b.s);
      m.compose(v, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  mesh.computeBoundingSphere();
  // (the fleet spreads over kilometres: never culled as one small sphere)
  mesh.frustumCulled = false;
  return { mesh, place };
}

// ------------------------------------------------------------------------------------------ rocks

/**
 * Capo Serena's cliffs in rock. The terrain mesh out there is 16 m, so on its own a face is one smooth
 * slope; here it is built up of limestone blocks bedded into that slope (buttresses, overhangs,
 * ledges between them), with a rubble of fallen blocks along the waterline, outcrops along the top
 * edge, and the sea stacks clad the same way.
 */
function cliffRock(map: WorldMap): THREE.Group {
  const S = map.SQUARE;
  const sea = RIVIERA_SEA;
  const r = rng(733);
  const C0 = 24;
  const nx = Math.ceil((S.x1 - S.x0) / C0), nz = Math.ceil((S.z1 - S.z0) / C0);
  const coarse = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) coarse[j * nx + i] = map.height(S.x0 + (i + 0.5) * C0, S.z0 + (j + 0.5) * C0);
  const nearSea = (i: number, j: number) => {
    for (let b = -2; b <= 2; b++)
      for (let a = -2; a <= 2; a++) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && coarse[jj * nx + ii] < sea + 1.5) return true;
      }
    return false;
  };
  const face: RockSpot[] = [], foot: RockSpot[] = [], stacks: RockSpot[] = [], top: RockSpot[] = [];
  const F = 6;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (coarse[j * nx + i] > sea + 80 || !nearSea(i, j)) continue;
      for (let b = 0; b < C0 / F; b++)
        for (let a = 0; a < C0 / F; a++) {
          const x = S.x0 + i * C0 + (a + 0.5) * F + (r() - 0.5) * F * 0.9;
          const z = S.z0 + j * C0 + (b + 0.5) * F + (r() - 0.5) * F * 0.9;
          const h = map.height(x, z);
          if (h < sea - 3) continue;
          if (map.trackClearance(x, z) < 34 || map.inPitZone(x, z, 20) || map.excluded(x, z, 4)) continue;
          const gx = (map.height(x + 3, z) - map.height(x - 3, z)) / 6, gz = (map.height(x, z + 3) - map.height(x, z - 3)) / 6;
          const grad = Math.hypot(gx, gz);
          const cd = rivieraCoast(map, x, z);
          if (cd < -45) continue;
          // facing downhill (out to sea)
          const yaw = Math.atan2(-gx, -gz);
          const k = 0.82 + r() * 0.34;
          if (cd > 28 && h > sea + 3) {
            // a sea stack: tall blocks, stacked, the waves' notch at the foot
            if (r() < 0.85) {
              const H = Math.min(34, (h - sea) * 0.85 + 4);
              stacks.push({ x, z, y: sea + H * 0.42, w: 9 + r() * 7, h: H, d: 8 + r() * 6, rot: r() * 6.28, tx: (r() - 0.5) * 0.12, tz: (r() - 0.5) * 0.12, k });
            }
          } else if (grad > 0.9 && h > sea + 2) {
            // the face: a block bedded into the slope, its outer face roughly the cliff's
            // (big: a buttress or a slab the height of a third of the cliff, so the face is a jumble
            // of facets and shadowed re-entrants, not a wall with pebbles on it)
            if (r() < 0.8) {
              const d = 8 + r() * 8;
              face.push({ x: x + (gx / grad) * d * 0.3, z: z + (gz / grad) * d * 0.3, y: h + (r() - 0.35) * 5, w: 11 + r() * 14, h: 9 + r() * 15, d, rot: yaw + (r() - 0.5) * 0.6, tx: (r() - 0.5) * 0.3, tz: (r() - 0.5) * 0.25, k });
            }
          } else if (h < sea + 4.5 && cd > -18) {
            // the waterline: fallen blocks, half in the sea
            if (r() < 0.6) {
              const s = 1.2 + Math.pow(r(), 2) * 6;
              foot.push({ x, z, y: Math.max(h, sea - 1.2) + s * 0.15, w: s * (0.9 + r() * 0.5), h: s * (0.55 + r() * 0.35), d: s * (0.8 + r() * 0.4), rot: r() * 6.28, tx: (r() - 0.5) * 0.4, tz: (r() - 0.5) * 0.4, k });
            }
          } else if (grad > 0.3 && h > sea + 15 && r() < 0.14) {
            // the top edge: low outcrops breaking through the turf (flat slabs, not boulders)
            const s = 0.9 + r() * 2.2;
            top.push({ x, z, y: h - s * 0.05, w: s * 1.5, h: s * 0.38, d: s * 1.1, rot: yaw + (r() - 0.5), tx: (r() - 0.5) * 0.2, tz: (r() - 0.5) * 0.2, k: k * 0.85 });
          }
        }
    }
  const g = new THREE.Group();
  g.name = 'riviera_cliffs';
  g.add(rockMeshes(face, 'limestone', 'riviera_cliff_face', { blocky: 0.9, detail: 2, shapes: 5, seed: 11 }));
  g.add(rockMeshes(stacks, 'limestone', 'riviera_stacks', { blocky: 0.85, detail: 3, shapes: 4, seed: 12 }));
  g.add(rockMeshes(foot, 'limestone', 'riviera_shore_rocks', { blocky: 0.6, detail: 2, shapes: 5, seed: 13 }));
  g.add(rockMeshes(top, 'limestone', 'riviera_outcrops', { blocky: 0.8, detail: 2, shapes: 3, seed: 14 }));
  if (import.meta.env.DEV) console.debug('[scenic] cliff rocks', face.length, stacks.length, foot.length, top.length);
  return g;
}

/** Bergsee's shore: granite boulders and shingle along the waterline, a few out in the shallows */
function alpineShore(map: WorldMap): THREE.Group {
  const r = rng(551);
  const pts: { x: number; z: number }[] = [];
  const line = alpineLakeOutline(map, 0);
  for (let k = 0; k < line.length; k++) {
    const A = line[k], B = line[(k + 1) % line.length];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    for (let t = 0; t < L; t += 5 + r() * 6) {
      const x = A.x + ((B.x - A.x) * t) / L + (r() - 0.5) * 16, z = A.z + ((B.z - A.z) * t) / L + (r() - 0.5) * 16;
      if (!map.inSquare(x, z) || map.trackClearance(x, z) < 30 || map.inPitZone(x, z, 10) || map.excluded(x, z, 3)) continue;
      if (map.height(x, z) < ALPINE_LAKE - 2.5) continue;
      pts.push({ x, z });
    }
  }
  const spots = boulders(map, pts, [0.5, 3.8], 552).map((s) => ({ ...s, y: Math.max(s.y, ALPINE_LAKE - 0.3 + s.h * 0.15) }));
  return rockMeshes(spots, 'granite', 'alpine_shore', { blocky: 0.2, detail: 2, seed: 9 });
}

/**
 * Red Mesa's talus: the walls drop their rock at their feet. Big fallen slabs leaning at the base,
 * boulders thinning and shrinking out across the apron, round every butte near the lap and along the
 * escarpment.
 */
function canyonTalus(map: WorldMap): THREE.Group {
  const r = rng(919);
  const slabs: RockSpot[] = [], blocks: RockSpot[] = [];
  for (const f of canyonWallFeet(map, 3200, 8, r)) {
    if (!map.inSquare(f.x, f.z) && Math.hypot(f.x - map.A.center.x, f.z - map.A.center.z) > 3200) continue;
    if (map.trackClearance(f.x, f.z) < 26 || map.inPitZone(f.x, f.z, 20) || map.excluded(f.x, f.z, 3)) continue;
    const near = 1 - Math.min(1, f.d / (f.wallH * 0.7));
    const y = map.height(f.x, f.z);
    if (f.d < 12 && r() < 0.35) {
      const H = 7 + r() * 12;
      slabs.push({ x: f.x, z: f.z, y: y + H * 0.3, w: 6 + r() * 9, h: H, d: 3 + r() * 4, rot: f.out + (r() - 0.5) * 0.7, tx: (r() - 0.5) * 0.6, tz: (r() - 0.5) * 0.3, k: 0.85 + r() * 0.3 });
    } else {
      const s = (1 + 8 * near * near) * (0.35 + 0.65 * r());
      blocks.push({ x: f.x, z: f.z, y: y + s * (0.15 + r() * 0.1), w: s * (0.9 + r() * 0.6), h: s * (0.5 + r() * 0.4), d: s * (0.8 + r() * 0.5), rot: r() * 6.28, tx: (r() - 0.5) * 0.5, tz: (r() - 0.5) * 0.5, k: 0.8 + r() * 0.35 });
    }
  }
  const g = new THREE.Group();
  g.name = 'canyon_talus';
  g.add(rockMeshes(slabs, 'sandstone', 'canyon_slabs', { blocky: 0.95, detail: 2, shapes: 4, seed: 21 }));
  g.add(rockMeshes(blocks, 'sandstone', 'canyon_blocks', { blocky: 0.8, detail: 2, shapes: 5, seed: 22 }));
  if (import.meta.env.DEV) console.debug('[scenic] talus', slabs.length, blocks.length);
  return g;
}
/** scatter spots round the lap (lat from `near` to `far` m beyond the barriers), filtered */
function scatter(map: WorldMap, n: number, near: number, far: number, seed: number, ok: (x: number, z: number) => boolean, size: [number, number]) {
  const r = rng(seed);
  const t = map.track;
  const out: { x: number; z: number; s: number; rot: number }[] = [];
  const p = new THREE.Vector3();
  for (let k = 0; k < n * 4 && out.length < n; k++) {
    const i = Math.floor(r() * t.n);
    const side = r() < 0.5 ? -1 : 1;
    const f = r();
    t.point(i, side * (t.barrierAt(i, side) + near + f * f * (far - near)), 0, p);
    if (map.trackClearance(p.x, p.z) < near * 0.8 || map.excluded(p.x, p.z, 3) || map.inPitZone(p.x, p.z, 10)) continue;
    if (!ok(p.x, p.z)) continue;
    out.push({ x: p.x, z: p.z, s: size[0] + (size[1] - size[0]) * Math.pow(r(), 2.2), rot: r() * 6.28 });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ riviera

function buildRiviera(map: WorldMap, group: THREE.Group): (t: number) => void {
  const S = map.SQUARE, F = map.FAR;
  const sea: WaterSpec = {
    outline: [{ x: F.x0, z: F.z0 }, { x: F.x1, z: F.z0 }, { x: F.x1, z: F.z1 }, { x: F.x0, z: F.z1 }],
    y: RIVIERA_SEA,
    kind: 'sea',
    flow: { x: 0.04, z: 0.03 },
    // the Ligurian Sea: deep ultramarine offshore, clear turquoise over the rock shelves
    deep: [0.003, 0.022, 0.06],
    shallow: [0.02, 0.14, 0.16],
    shore: 0,
    depth: { map: depthMap(map, RIVIERA_SEA, 12), x0: S.x0, z0: S.z0, x1: S.x1, z1: S.z1, range: 12 },
  };
  const water: Water = buildWaters([sea]);
  group.add(water.mesh);

  // the lighthouse on the cape: a white tower with a black lantern gallery, the keeper's house
  const sp = rivieraSpots(map);
  {
    const p = new Plain();
    const x = sp.cape.x, z = sp.cape.z, y = map.height(x, z) - 0.5;
    const white = C(0xeeeae0), stone = C(0xb8ad98), dark = C(0x22262a), roof = C(0xa4543a);
    tube(p, x, z, y, y + 3, 4.2, 4.0, stone);
    tube(p, x, z, y + 3, y + 22, 3.4, 2.5, white);
    // a red band two-thirds up
    tube(p, x, z, y + 15, y + 17.5, 2.82, 2.73, C(0xb0302a));
    // the gallery and its rail
    tube(p, x, z, y + 22, y + 22.5, 3.3, 3.3, dark);
    cap(p, x, z, y + 22, y + 22, 3.3, dark);
    tube(p, x, z, y + 22.5, y + 23.4, 3.25, 3.25, dark, 24);
    // the lantern's dome and finial
    cap(p, x, z, y + 26.2, y + 28.4, 2.1, dark);
    p.post(new THREE.Vector3(x, y + 28.2, z), new THREE.Vector3(x, y + 29.6, z), 0.15, dark);
    // keeper's house, hipped tile roof
    const hx = x - 14, hz = z + 6;
    const hy = map.height(hx, hz) - 0.5;
    p.box(hx, hz, hy, hy + 6.2, 11, 8, 0.4, white);
    p.box(hx, hz, hy + 6.2, hy + 8.8, 12, 9, 0.4, roof, 0.2, 0.05);
    group.add(plainMesh(p, 'riviera_lighthouse'));
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.8, 16, 1, true), glowMaterial(0xffd9a0, 0.4, 9));
    lantern.position.set(x, y + 24.8, z);
    lantern.name = 'riviera_lantern';
    group.add(lantern);
  }

  // yachts on the sea and fishing boats in the cove
  const yachts: Boat[] = [];
  const r = rng(907);
  const c = map.A.center;
  for (let k = 0; k < 400 && yachts.length < 18; k++) {
    const a = ((18 + r() * 220) * Math.PI) / 180;
    const R = 900 + Math.pow(r(), 1.3) * 5200;
    const x = c.x + Math.sin(a) * R, z = c.z - Math.cos(a) * R;
    if (rivieraCoast(map, x, z) < 140 || map.height(x, z) > RIVIERA_SEA - 6) continue;
    yachts.push({ x, z, rot: r() * 6.28, ph: r() * 10, s: 0.9 + r() * 0.5 });
  }
  const yf = boatFleet(yachtGeometry(), yachts, RIVIERA_SEA + 0.1, 'riviera_yachts');
  group.add(yf.mesh);
  const small: Boat[] = [];
  for (let k = 0; k < 300 && small.length < 14; k++) {
    const x = sp.cove.x + (r() - 0.5) * 520, z = sp.cove.z + (r() - 0.5) * 520;
    const cd = rivieraCoast(map, x, z);
    if (cd < 40 || cd > 260 || map.height(x, z) > RIVIERA_SEA - 2) continue;
    small.push({ x, z, rot: r() * 6.28, ph: r() * 10, s: 1 });
  }
  const sf = boatFleet(dinghyGeometry(), small, RIVIERA_SEA + 0.05, 'riviera_boats');
  group.add(sf.mesh);

  // pale limestone boulders on the clifftops and among the macchia
  const rocks = scatter(map, 320, 10, 260, 41, (x, z) => rivieraCoast(map, x, z) < -6 && map.slope(x, z) > 0.8, [0.5, 3.2]);
  group.add(rockMeshes(boulders(map, rocks, [0.5, 3.2], 42), 'limestone', 'riviera_rocks', { blocky: 0.7, seed: 4 }));
  group.add(cliffRock(map));

  return (t) => {
    water.update(t);
    yf.place(t);
    sf.place(t);
  };
}

// ------------------------------------------------------------------------------------------ alpine

function buildAlpine(map: WorldMap, group: THREE.Group): (t: number) => void {
  const S = map.SQUARE;
  const lake: WaterSpec = {
    outline: alpineLakeOutline(map, 60),
    y: ALPINE_LAKE,
    kind: 'lake',
    flow: { x: 0.01, z: 0.02 },
    // glacial milk: deep teal, pale green-turquoise over the shingle
    deep: [0.006, 0.04, 0.045],
    shallow: [0.05, 0.15, 0.13],
    shore: 0,
    depth: { map: depthMap(map, ALPINE_LAKE, 8), x0: S.x0, z0: S.z0, x1: S.x1, z1: S.z1, range: 8 },
  };
  const water = buildWaters([lake]);
  group.add(water.mesh);

  const t = map.track;
  const p = new Plain();
  const white = C(0xf0ede4), roofRed = C(0x7a3426), shingle = C(0x4a3a30), wood = C(0x6e4a30), stone = C(0x8c8a84), copper = C(0x4e7a66);
  // the chapel above the Kapelle hairpin: whitewashed nave, shingled roof, a bell tower with an onion dome
  {
    const p = new Plain();
    const corner = t.corners.find((k) => k.name === 'Kapelle') ?? t.corners[Math.floor(t.corners.length * 0.66)];
    const q = new THREE.Vector3();
    t.point(corner.sApex, corner.dir * (t.barrierAt(corner.sApex, corner.dir as 1 | -1) + 46), 0, q);
    const y = map.height(q.x, q.z) - 0.4;
    const rot = Math.atan2(q.x - t.px[corner.sApex], q.z - t.pz[corner.sApex]);
    p.box(q.x, q.z, y, y + 7, 7, 13, rot, white);
    p.box(q.x, q.z, y + 7, y + 11, 8, 14, rot, shingle, 0.02, 1);
    const tx = q.x + Math.sin(rot) * 7.5, tz = q.z + Math.cos(rot) * 7.5;
    p.box(tx, tz, y, y + 15, 3.6, 3.6, rot, white);
    tube(p, tx, tz, y + 15, y + 16.8, 1.7, 2.1, copper, 12);
    tube(p, tx, tz, y + 16.8, y + 18, 2.1, 1.0, copper, 12);
    cap(p, tx, tz, y + 18, y + 20.5, 1.0, copper, 12);
    map.exclusions.push({ cx: q.x, cz: q.z, halfW: 6, halfL: 12, angle: rot });
    group.add(plainMesh(p, 'alpine_chapel'));
  }
  // the village church on the lake's south shore (the tallest steeple in the valley)
  {
    const bb = map.A.bb;
    const cx = bb.x0 + 300, cz = (bb.z0 + bb.z1) / 2 + 1500;
    const y = map.height(cx, cz) - 0.4;
    p.box(cx, cz, y, y + 11, 11, 24, 0.2, white);
    p.box(cx, cz, y + 11, y + 17, 12, 25, 0.2, roofRed, 0.02, 1);
    const tx = cx + Math.sin(0.2) * 14, tz = cz + Math.cos(0.2) * 14;
    p.box(tx, tz, y, y + 30, 5.5, 5.5, 0.2, white);
    p.box(tx, tz, y + 30, y + 46, 5.8, 5.8, 0.2, roofRed, 0.04);
  }
  // the boathouse and its jetty out into the lake by the Bootshaus corner
  {
    const corner = t.corners.find((k) => k.name === 'Bootshaus') ?? t.corners[t.corners.length - 1];
    const q = new THREE.Vector3();
    // (the lake lies to the right of the straight after it: look along both sides for the shore)
    let best = { x: 0, z: 0, d: -1e9, s: 0 };
    const s0 = corner.sApex + 170;
    for (let lat = 40; lat < 300 && best.d < -1e8; lat += 8)
      for (const side of [1, -1]) {
        t.point(s0, side * lat, 0, q);
        const d = alpineLake(map, q.x, q.z);
        if (d > -6 && d < 8 && map.trackClearance(q.x, q.z) > 25) { best = { x: q.x, z: q.z, d, s: s0 }; break; }
      }
    if (best.d > -1e8) {
      const si = Math.floor(best.s) % t.n;
      const dir = Math.atan2(best.x - t.px[si], best.z - t.pz[si]);
      const y = ALPINE_LAKE + 0.9;
      const hx = best.x - Math.sin(dir) * 12, hz = best.z - Math.cos(dir) * 12;
      const hy = Math.max(y, map.height(hx, hz)) - 0.3;
      p.box(hx, hz, hy, hy + 5, 9, 12, dir, wood);
      p.box(hx, hz, hy + 5, hy + 8.5, 10, 13, dir, shingle, 0.02, 1);
      // the jetty: planks on posts
      for (let k = 0; k < 14; k++) {
        const jx = best.x + Math.sin(dir) * k * 3, jz = best.z + Math.cos(dir) * k * 3;
        p.box(jx, jz, y - 0.15, y + 0.1, 2.4, 3.05, dir, wood);
        p.post(new THREE.Vector3(jx + Math.cos(dir) * 1.1, ALPINE_LAKE - 2, jz - Math.sin(dir) * 1.1), new THREE.Vector3(jx + Math.cos(dir) * 1.1, y, jz - Math.sin(dir) * 1.1), 0.22, wood);
      }
    }
  }
  // grey granite boulders dropped by the glacier, on the meadows and the moraine
  const rocks = scatter(map, 320, 8, 300, 52, (x, z) => alpineLake(map, x, z) < -12, [0.6, 3.6]);
  group.add(rockMeshes(boulders(map, rocks, [0.6, 3.6], 53), 'granite', 'alpine_rocks', { blocky: 0.15, seed: 5 }));
  group.add(alpineShore(map));
  group.add(plainMesh(p, 'alpine_buildings'));

  // rowing boats and a sail or two on the lake
  const boats: Boat[] = [];
  const r = rng(313);
  const bb = map.A.bb;
  for (let k = 0; k < 400 && boats.length < 9; k++) {
    const x = bb.x0 - 200 - r() * 1100, z = (bb.z0 + bb.z1) / 2 - 3000 + r() * 3800;
    if (alpineLake(map, x, z) < 40) continue;
    boats.push({ x, z, rot: r() * 6.28, ph: r() * 10, s: k % 3 === 0 ? 0.7 : 1 });
  }
  const fleet = boatFleet(dinghyGeometry(), boats, ALPINE_LAKE + 0.05, 'alpine_boats');
  group.add(fleet.mesh);
  void stone;
  return (tt) => {
    water.update(tt);
    fleet.place(tt * 0.6);
  };
}

// ------------------------------------------------------------------------------------------ canyon

function buildCanyon(map: WorldMap, group: THREE.Group): (t: number) => void {
  // boulders fallen from the walls, red and dark, thick round the buttes' feet and along the wash
  const big = scatter(map, 420, 10, 420, 63, () => true, [0.7, 4.2]);
  group.add(rockMeshes(boulders(map, big, [0.7, 4.2], 65), 'sandstone', 'canyon_rocks', { blocky: 0.75, seed: 6 }));
  const small = scatter(map, 900, 4, 160, 64, () => true, [0.2, 0.9]);
  group.add(rockMeshes(boulders(map, small, [0.2, 0.9], 66), 'sandstone', 'canyon_stones', { blocky: 0.5, detail: 2, seed: 7, shadows: false }));
  group.add(canyonTalus(map));
  // hoodoos: thin spires of soft rock with a hard cap, in a few clusters off the lap
  const p = new Plain();
  const r = rng(77);
  const t = map.track;
  const q = new THREE.Vector3();
  for (let cl = 0; cl < 7; cl++) {
    const i = Math.floor(r() * t.n);
    const side = r() < 0.5 ? -1 : 1;
    t.point(i, side * (t.barrierAt(i, side) + 120 + r() * 260), 0, q);
    for (let k = 0; k < 6; k++) {
      const x = q.x + (r() - 0.5) * 60, z = q.z + (r() - 0.5) * 60;
      if (map.trackClearance(x, z) < 60 || map.inPitZone(x, z, 20)) continue;
      const y = map.height(x, z) - 1;
      // a soft-rock column, waisted under a hard cap, on a broad skirt of its own debris
      const h = 7 + r() * 11, w = 3.2 + r() * 3.2;
      const red = C(0x9a4a2a).multiplyScalar(0.85 + r() * 0.3), capC = C(0xb88a64);
      const lx = (r() - 0.5) * 1.2, lz = (r() - 0.5) * 1.2;
      tube(p, x, z, y - 1, y + h * 0.18, w * 1.55, w * 1.0, red.clone().multiplyScalar(0.9), 10);
      tube(p, x, z, y + h * 0.18, y + h * 0.55, w * 1.0, w * 0.62, red, 10);
      tube(p, x + lx * 0.5, z + lz * 0.5, y + h * 0.55, y + h * 0.86, w * 0.62, w * 0.78, red.clone().multiplyScalar(1.08), 10);
      tube(p, x + lx, z + lz, y + h * 0.86, y + h + 1.2, w * 1.05, w * 0.95, capC, 10);
      cap(p, x + lx, z + lz, y + h + 1.2, y + h + 1.6, w * 0.95, capC, 10);
      map.exclusions.push({ cx: x, cz: z, halfW: w, halfL: w, angle: 0 });
    }
  }
  {
    const m = new THREE.Mesh(p.geometry(), rockMaterial('sandstone', true));
    m.name = 'canyon_hoodoos';
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return () => {};
}

export function buildScenicScenery(map: WorldMap): ScenicSceneryBuild {
  const group = new THREE.Group();
  group.name = 'ScenicScenery';
  const tick = map.scenic === 'riviera' ? buildRiviera(map, group) : map.scenic === 'alpine' ? buildAlpine(map, group) : buildCanyon(map, group);
  return {
    group,
    update(elapsed) {
      tick(elapsed);
    },
  };
}
