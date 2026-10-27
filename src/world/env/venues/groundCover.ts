import * as THREE from 'three';
import { bleedAlpha } from '../../../core/alphaBleed.ts';
import { hash2i } from '../noise.ts';
import { sampleNoise } from '../textures.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import type { WorldMap } from '../worldmap.ts';
import type { ParkMasks } from '../parkmask.ts';

/**
 * Ground cover that stands up out of the ground near the camera, where the terrain shader can only
 * paint it:
 *  - Red Mesa's sagebrush: the low grey-green bushes that cover a Colorado Plateau valley floor every
 *    few metres, each with the shade round its foot. Placement follows the terrain shader's own
 *    density field (the same noise: thicker in the sandy swales, thin on the pavement); beyond the
 *    streamed ring the shader paints them.
 *  - Everywhere else with open country: rough meadow — tussocks of long grass, seed heads, and
 *    wildflowers on the green venues — on the unmown ground (not the verges, lawns and banks the
 *    park mask mows, not the woods, paths, paving or towns), tinted from the venue's own meadow and
 *    straw so it sits in the painted ground it grows out of.
 * Both are crossed cards (the trick that still reads best for a clump seen from the side and from
 * above at once), streamed in 48 m chunks round the camera: chunks are built a couple per frame and
 * kept, and the instance buffers are copies of their prepared matrices, so a car at 300 km/h
 * crossing a chunk a second costs nothing noticeable. Each clump shrinks into the ground over the
 * last stretch of the ring instead of popping. Nothing from a helicopter or a TV tower.
 */

const CHUNK = 48;

/**
 * A clump as three crossed cards (the old trick that still reads best for a bush seen from the
 * side and from above at once), normals bent out from the bush's centre so it lights as a mound.
 */
function cardGeometry(W: number, H: number, up: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a), cz = Math.sin(a);
    const base = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const x = (u * 2 - 1) * W * cx, z = (u * 2 - 1) * W * cz, y = v * H;
      pos.push(x, y, z);
      const n = new THREE.Vector3(x, y + up, z).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** the card: a dome of small silver-grey leaves on dark twigs, ragged at the edge (drawn once) */
function bushTexture(): THREE.Texture {
  const W = 256, H = 160;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  let seed = 9173;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // twigs from the root crown up and out
  g.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
    let x = W / 2 + (r() - 0.5) * 20, y = H;
    const L = 40 + r() * 90;
    g.strokeStyle = `rgba(${48 + r() * 20},${40 + r() * 14},${30 + r() * 10},1)`;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(x, y);
    for (let t = 0; t < L; t += 8) {
      x += Math.cos(a + (r() - 0.5) * 0.6) * 8;
      y += Math.sin(a + (r() - 0.5) * 0.6) * 8;
      g.lineTo(x, y);
      g.lineWidth = Math.max(0.8, g.lineWidth * 0.86);
    }
    g.stroke();
  }
  // the leaves: clusters at the twig ends, packed into a lumpy dome (the outline is the clusters',
  // not a curve), darker underneath and inside, silver at the top
  for (let c = 0; c < 70; c++) {
    const cx = r() * 2 - 1;
    const top = Math.sqrt(Math.max(0, 1 - cx * cx)) * 0.92;
    const cy = top * Math.sqrt(r());
    const cr = 9 + r() * 16;
    const n = 50 + r() * 90;
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cr;
      const px = W / 2 + cx * (W / 2 - 20) + Math.cos(a) * d * 1.3, py = H - 4 - cy * (H - 24) + Math.sin(a) * d;
      if (py > H - 2) continue;
      const y = 1 - py / H;
      const light = 0.45 + 0.55 * y + (r() - 0.5) * 0.4 - (d / cr) * 0.1;
      g.fillStyle = `rgb(${(100 + 64 * light) | 0},${(104 + 62 * light) | 0},${(88 + 56 * light) | 0})`;
      g.beginPath();
      g.ellipse(px, py, 1.4 + r() * 2.0, 1.0 + r() * 1.2, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  // (the empty texels filled from the leaves: no dark outline round each card at a distance)
  const t = bleedAlpha(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the shade round a bush's foot: a soft dark disc on the ground */
function shadeGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 14);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // (uv → radial distance in the shader)
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 - 1, uv.getY(i) * 2 - 1);
  return g;
}

function cardMaterial(map: THREE.Texture, key: string, fade: [number, number], keepColour: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = weatherUniforms.uWind;
    sh.uniforms.uWeatherTime = weatherUniforms.uWeatherTime;
    // (both sides of a card light as the clump it stands for: no flipping the normal for the back face)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );');
    // the flowers keep their own colours: only the unsaturated (grass) texels take the venue's tint
    if (keepColour)
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR )
{
  vec3 t = diffuseColor.rgb;
  float sat = max( t.r, max( t.g, t.b ) ) - min( t.r, min( t.g, t.b ) );
  diffuseColor.rgb = mix( t * vColor.rgb, t * mix( vec3( 1.0 ), vColor.rgb, 0.3 ), smoothstep( 0.1, 0.22, sat ) );
}
#endif`,
      );
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 uWind;\nuniform float uWeatherTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
  vec4 iw = vec4( 0.0, 0.0, 0.0, 1.0 );
#ifdef USE_INSTANCING
  iw = instanceMatrix * iw;
#endif
  // into the ground over the last stretch of the ring (no popping at its edge)
  float fd = length( ( modelMatrix * iw ).xyz - cameraPosition );
  transformed *= 1.0 - smoothstep( ${fade[0].toFixed(1)}, ${fade[1].toFixed(1)}, fd );
  // the tops sway in the wind, gusting
  float sway = sin( uWeatherTime * 2.3 + iw.x * 0.37 + iw.z * 0.29 ) * 0.5 + 0.5;
  transformed.xz += uWind * 0.006 * position.y * position.y * ( 0.5 + 0.5 * sway );
}`,
    );
  };
  m.customProgramCacheKey = () => 'apex-cover-' + key;
  return m;
}

/** a tussock: long blades fanning from the root, some bent over, seed heads; `flowers` adds a few blooms */
function grassTexture(flowers: boolean, seed0: number): THREE.Texture {
  const W = 256, H = 192;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  let seed = seed0;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  // blades: grey (the instance tint gives the venue's green or straw), darker toward the root
  for (let k = 0; k < 120; k++) {
    const x0 = W / 2 + (r() - 0.5) * W * 0.5;
    const lean = (r() - 0.5) * 1.6 + (x0 - W / 2) / (W * 0.25) * 0.5;
    const L = H * (0.35 + r() * 0.62);
    const bend = (r() - 0.5) * 0.9;
    const shade = 150 + r() * 105;
    const grad = g.createLinearGradient(0, H, 0, H - L);
    grad.addColorStop(0, `rgb(${shade * 0.4},${shade * 0.42},${shade * 0.36})`);
    grad.addColorStop(1, `rgb(${shade},${shade},${shade * 0.94})`);
    g.strokeStyle = grad;
    g.lineWidth = 1.4 + r() * 2.2;
    g.beginPath();
    g.moveTo(x0, H);
    const tx = x0 + lean * L * 0.45, ty = H - L;
    g.quadraticCurveTo(x0 + lean * L * 0.12, H - L * 0.6, tx + bend * L * 0.25, ty + Math.abs(bend) * L * 0.25);
    g.stroke();
    // seed heads on a few
    if (r() < 0.18) {
      g.fillStyle = `rgb(${200 + r() * 40},${190 + r() * 40},${160 + r() * 30})`;
      g.beginPath();
      g.ellipse(tx + bend * L * 0.25, ty + Math.abs(bend) * L * 0.25 + 4, 2, 7, lean * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (flowers) {
    const kinds = [
      [250, 250, 245, 3.2],
      [255, 214, 40, 2.6],
      [176, 120, 220, 2.6],
      [255, 255, 255, 2.2],
      [230, 70, 60, 2.8],
    ];
    for (let k = 0; k < 16; k++) {
      const [R, G, B, rad] = kinds[Math.floor(r() * kinds.length)];
      const x = W / 2 + (r() - 0.5) * W * 0.7, y = H * (0.15 + r() * 0.5);
      g.strokeStyle = 'rgb(120,130,110)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 8, H);
      g.stroke();
      g.fillStyle = `rgb(${R},${G},${B})`;
      g.beginPath();
      g.arc(x, y, rad + r() * 1.5, 0, Math.PI * 2);
      g.fill();
      if (R > 240 && G > 240) {
        g.fillStyle = 'rgb(245,200,40)';
        g.beginPath();
        g.arc(x, y, 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // (the empty texels filled from the leaves: no dark outline round each card at a distance)
  const t = bleedAlpha(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Item {
  x: number;
  y: number;
  z: number;
  /** width, height */
  w: number;
  h: number;
  rot: number;
  c: THREE.Color;
  kind: number;
  /** the foot's shade disc radius (0 = none) */
  shade: number;
}

interface Chunk {
  m: Float32Array[];
  c: Float32Array[];
  n: number[];
  sm: Float32Array;
  sn: number;
}

/**
 * Streams instanced cards round the camera: `place(x, z, gx, gz)` decides each grid cell (`cell` m).
 */
function streamer(kinds: THREE.InstancedMesh[], shade: THREE.InstancedMesh | null, cell: number, reach: number, place: (gx: number, gz: number) => Item | null) {
  const chunks = new Map<number, Chunk>();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const build = (cx: number, cz: number): Chunk => {
    const lists: Item[][] = kinds.map(() => []);
    const n = Math.round(CHUNK / cell);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const it = place(cx * n + i, cz * n + j);
        if (it) lists[it.kind].push(it);
      }
    const ch: Chunk = { m: [], c: [], n: [], sm: new Float32Array(0), sn: 0 };
    let ns = 0;
    for (const l of lists) for (const it of l) if (it.shade > 0) ns++;
    ch.sm = new Float32Array(ns * 16);
    lists.forEach((l, k) => {
      const M = new Float32Array(l.length * 16), C = new Float32Array(l.length * 3);
      l.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot);
        v.set(it.x, it.y, it.z);
        sc.set(it.w, it.h, it.w);
        m4.compose(v, q, sc);
        m4.toArray(M, i * 16);
        C[i * 3] = it.c.r;
        C[i * 3 + 1] = it.c.g;
        C[i * 3 + 2] = it.c.b;
        if (it.shade > 0) {
          v.y += 0.02;
          sc.set(it.shade, 1, it.shade);
          m4.compose(v, q, sc);
          m4.toArray(ch.sm, ch.sn * 16);
          ch.sn++;
        }
      });
      ch.m[k] = M;
      ch.c[k] = C;
      ch.n[k] = l.length;
    });
    return ch;
  };
  let lastKey = NaN;
  let dirty = false;
  return (camera: THREE.Camera) => {
    const cp = camera.position;
    const ccx = Math.floor(cp.x / CHUNK), ccz = Math.floor(cp.z / CHUNK);
    const key = ccx * 100003 + ccz;
    if (key !== lastKey) dirty = true;
    lastKey = key;
    // build the missing chunks nearest first, two a frame (the ring fills in within a few frames)
    let budget = 2;
    for (let d = 0; d <= reach && budget > 0; d++)
      for (let dz = -d; dz <= d && budget > 0; dz++)
        for (let dx = -d; dx <= d && budget > 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
          const k = (ccx + dx + 4096) * 8192 + (ccz + dz + 4096);
          if (chunks.has(k)) continue;
          chunks.set(k, build(ccx + dx, ccz + dz));
          budget--;
          dirty = true;
        }
    if (!dirty) return;
    dirty = false;
    const cnt = kinds.map(() => 0);
    let sn = 0;
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const ch = chunks.get((ccx + dx + 4096) * 8192 + (ccz + dz + 4096));
        if (!ch) continue;
        kinds.forEach((mesh, k) => {
          const room = mesh.instanceMatrix.count - cnt[k];
          const n = Math.min(ch.n[k], room);
          if (n <= 0) return;
          (mesh.instanceMatrix.array as Float32Array).set(ch.m[k].subarray(0, n * 16), cnt[k] * 16);
          (mesh.instanceColor!.array as Float32Array).set(ch.c[k].subarray(0, n * 3), cnt[k] * 3);
          cnt[k] += n;
        });
        if (shade) {
          const n = Math.min(ch.sn, shade.instanceMatrix.count - sn);
          if (n > 0) (shade.instanceMatrix.array as Float32Array).set(ch.sm.subarray(0, n * 16), sn * 16);
          sn += Math.max(0, n);
        }
      }
    kinds.forEach((mesh, k) => {
      mesh.count = cnt[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    });
    if (shade) {
      shade.count = sn;
      shade.instanceMatrix.needsUpdate = true;
    }
  };
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, max: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  return mesh;
}

export interface GroundCover {
  group: THREE.Group;
  update(camera: THREE.Camera): void;
  setEnabled(on: boolean): void;
}

function shadeMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGcUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGcUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGcUv;')
      .replace('#include <opaque_fragment>', 'float rr = length( vGcUv );\ngl_FragColor = vec4( 0.0, 0.0, 0.0, 0.42 * ( 1.0 - smoothstep( 0.35, 1.0, rr ) ) );');
  };
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  m.customProgramCacheKey = () => 'apex-sagebrush-shade-1';
  return m;
}

/** the terrain shader's sagebrush density at (x, z) (terrain.ts, the canyon floor) */
function density(x: number, z: number): number {
  const m1 = sampleNoise(x * 0.00093 + 0.13, z * 0.00093 + 0.71, 0);
  const m2 = sampleNoise(x * 0.0041 + 0.37, z * 0.0041 + 0.19, 1);
  const m3 = sampleNoise(x * 0.019, z * 0.019, 2);
  const d1 = sampleNoise((0.8 * x + 0.6 * z) * 0.121, (-0.6 * x + 0.8 * z) * 0.121, 3);
  const ss = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const paveK = ss(0.56, 0.74, m1 * 0.35 + m3 * 0.35 + d1 * 0.3) * 0.75;
  return (0.25 + 0.55 * ss(0.3, 0.7, m2 * 0.6 + m3 * 0.4)) * (1 - paveK * 0.6);
}

/** venues with no open grass to speak of (desert sand, the city) */
const NO_MEADOW = new Set(['sakhir', 'yasmarina', 'canyon']);
/** how many of the tussocks flower, by venue (the green ones in early summer most) */
const FLOWERS: Record<string, number> = { alpine: 0.4, spielberg: 0.3, ardennes: 0.2, airfield: 0.16, park: 0.14, hungaroring: 0.1, suzuka: 0.1, riviera: 0.06 };
/** how dry the long grass is (0 green … 1 straw), by venue */
const DRY: Record<string, number> = { riviera: 0.75, hungaroring: 0.45, austin: 0.55, mexico: 0.3, melbourne: 0.45, zandvoort: 0.5, monza: 0.25, interlagos: 0.1 };

export function buildGroundCover(map: WorldMap, masks: ParkMasks, palette: { meadow: THREE.Color; straw: THREE.Color }): GroundCover | null {
  const group = new THREE.Group();
  group.name = 'ground_cover';
  let tick: (camera: THREE.Camera) => void;
  if (map.venue === 'canyon') {
    // ---- sagebrush (the terrain shader paints it beyond 130 m)
    const tex = bushTexture();
    const bush = instanced(cardGeometry(0.62, 0.78, 0.35), cardMaterial(tex, 'sage', [128, 144], false), 9000, 'sagebrush');
    const shade = new THREE.InstancedMesh(shadeGeometry(), shadeMaterial(), 9000);
    shade.name = 'sagebrush_shade';
    shade.frustumCulled = false;
    shade.count = 0;
    shade.renderOrder = 1;
    group.add(bush, shade);
    const CELL = 3.4;
    const col = new THREE.Color();
    tick = streamer([bush], shade, CELL, 3, (gx, gz) => {
      const h = hash2i(gx, gz, 1733);
      const x = (gx + 0.2 + 0.6 * hash2i(gx, gz, 1734)) * CELL, z = (gz + 0.2 + 0.6 * hash2i(gx, gz, 1735)) * CELL;
      if (h > density(x, z)) return null;
      if (map.trackClearance(x, z) < 6 || map.inPitZone(x, z, 6) || map.excluded(x, z, 1.5) || map.pathDistance(x, z).d < 2.5) return null;
      if (map.slope(x, z, 2) < 0.9) return null;
      const s = 0.45 + 0.75 * Math.pow(hash2i(gx, gz, 1736), 1.6);
      const k = 0.8 + 0.4 * hash2i(gx, gz, 1738);
      return { x, y: map.height(x, z) - 0.04, z, w: s * 1.2, h: s * (0.85 + 0.35 * k), rot: hash2i(gx, gz, 1737) * 6.283, c: col.setScalar(k).clone(), kind: 0, shade: s * 1.5 };
    });
  } else {
    if (NO_MEADOW.has(map.venue)) return null;
    // ---- rough meadow: tussocks and wildflowers on the unmown ground
    const geo = cardGeometry(0.5, 0.6, 1.2);
    const grass = instanced(geo, cardMaterial(grassTexture(false, 4111), 'tussock', [70, 86], true), 10000, 'meadow_tussocks');
    const bloom = instanced(geo, cardMaterial(grassTexture(true, 7717), 'flowers', [70, 86], true), 3500, 'meadow_flowers');
    group.add(grass, bloom);
    const CELL = 2;
    const flowerK = FLOWERS[map.venue] ?? 0.08;
    const dryK = DRY[map.venue] ?? 0.2;
    const F = masks.fineBounds;
    tick = streamer([grass, bloom], null, CELL, 2, (gx, gz) => {
      const x = (gx + 0.15 + 0.7 * hash2i(gx, gz, 2733)) * CELL, z = (gz + 0.15 + 0.7 * hash2i(gx, gz, 2734)) * CELL;
      if (x < F.x0 || x > F.x1 || z < F.z0 || z > F.z1) return null;
      // patchy: thick in the swales, thin on the crowns (the painted meadow's own large-scale noise)
      const patch = sampleNoise(x * 0.0041 + 0.37, z * 0.0041 + 0.19, 1) * 0.6 + sampleNoise(x * 0.019, z * 0.019, 2) * 0.4;
      const dens = 0.15 + 0.85 * Math.min(1, Math.max(0, (patch - 0.32) / 0.3));
      if (hash2i(gx, gz, 2735) > dens) return null;
      const mown = masks.lawnAt(x, z);
      if (mown > 0.25 || masks.pathAt(x, z) > 0.2 || masks.pavedAt(x, z) > 0.1) return null;
      if (map.forest(x, z) > 0.45 || map.urban(x, z) > 0.1) return null;
      if (map.trackClearance(x, z) < 8 || map.inPitZone(x, z, 8) || map.excluded(x, z, 1.5) || map.pathDistance(x, z).d < 2) return null;
      if (map.scenic === 'riviera' && map.height(x, z) < -30) return null;
      if (map.slope(x, z, 2) < 0.75) return null;
      const s = 0.55 + 0.75 * Math.pow(hash2i(gx, gz, 2736), 1.4);
      const dry = Math.min(1, Math.max(0, dryK + (sampleNoise(x * 0.0093, z * 0.0093 + 0.4, 0) - 0.5) * 0.8 + (hash2i(gx, gz, 2737) - 0.5) * 0.3));
      const k = 1.25 + 0.45 * hash2i(gx, gz, 2738);
      const c = palette.meadow.clone().lerp(palette.straw, dry).multiplyScalar(k);
      const kind = hash2i(gx, gz, 2739) < flowerK * (1 - dry * 0.8) ? 1 : 0;
      return { x, y: map.height(x, z) - 0.05, z, w: s * (0.9 + 0.4 * hash2i(gx, gz, 2740)), h: s, rot: hash2i(gx, gz, 2741) * 6.283, c, kind, shade: 0 };
    });
  }
  let enabled = true;
  return {
    group,
    update(camera) {
      // nothing from a helicopter or a TV tower far off the ground (the painted ground does it)
      const cp = camera.position;
      const high = cp.y - map.height(cp.x, cp.z) > 60;
      group.visible = enabled && !high;
      if (!group.visible) return;
      tick(camera);
    },
    setEnabled(on) {
      enabled = on;
      group.visible = on;
    },
  };
}
