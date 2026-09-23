import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import { WorldMap } from './worldmap.ts';
import type { Layout } from './layout.ts';
import type { Track } from '../Track.ts';
import { hash2i, rng } from './noise.ts';
import { sponsorTexture, sponsorUV } from './signage.ts';

/**
 * White Mediterranean town on the hillside north of the circuit (+ the harbour
 * district and an east-hill village): thousands of instanced houses whose
 * windows, shutters and plinths are drawn in the shader, terracotta hip roofs or
 * flat terraces. Landmarks: church with bell tower, Moorish castle on its hill,
 * the Gran Hotel over the Paseo, a ferris wheel by the harbour, and sponsor
 * footbridges over the track.
 */

export interface TownBuild {
  group: THREE.Group;
  update(dt: number): void;
  houses: number;
}

const WALLS = [0xf4f1ea, 0xf2eee4, 0xefe9dc, 0xf6f4ef, 0xe9dcc0, 0xf1e3c6, 0xe7d3b3, 0xf3efe6, 0xeadfcf].map((h) => srgb(h));
const ROOF = srgb(0xb45a38);

function houseMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vHL;
varying vec3 vHN;
varying float vHId;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec3 sc = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
  vHL = ( position + vec3( 0.5, 0.0, 0.5 ) ) * sc;
  vHN = normal;
  vHId = float( gl_InstanceID );
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vHL;
varying vec3 vHN;
varying float vHId;
float hh( float n ) { return fract( sin( n * 91.345 ) * 47453.5453 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // local metres: vHL.y from the foundation (3 m below grade)
  float y = vHL.y - 3.0;
  float side = abs( vHN.y ) < 0.5 ? 1.0 : 0.0;
  float u = abs( vHN.x ) > 0.5 ? vHL.z : vHL.x;
  float pitch = 2.6 + hh( vHId ) * 1.2;
  float wu = fract( ( u - 0.8 ) / pitch );
  float fl = ( y - 0.9 ) / 3.0;
  float wv = fract( fl );
  float win = step( 0.28, wu ) * step( wu, 0.6 ) * step( 0.12, wv ) * step( wv, 0.55 ) * step( 0.0, fl );
  // doors on the ground floor of some facades
  float shutter = hh( vHId + 3.0 );
  vec3 shutCol = shutter < 0.35 ? vec3( 0.09, 0.2, 0.12 ) : shutter < 0.6 ? vec3( 0.07, 0.13, 0.25 ) : shutter < 0.8 ? vec3( 0.25, 0.13, 0.06 ) : vec3( 0.03 );
  float open = step( 0.5, hh( floor( u / pitch ) + floor( fl ) * 7.0 + vHId ) );
  vec3 wc = mix( shutCol, vec3( 0.02, 0.022, 0.025 ), open );
  diffuseColor.rgb = mix( diffuseColor.rgb, wc, win * side );
  // plinth + weathering at the base
  diffuseColor.rgb *= mix( 0.72, 1.0, smoothstep( 0.0, 0.7, y ) );
  diffuseColor.rgb *= 0.94 + 0.06 * hh( floor( y * 2.0 ) + vHId );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-house';
  return mat;
}

function hipRoof(): THREE.BufferGeometry {
  // unit footprint centred at origin, ridge along x, apex height 1
  const mb = new MeshBuilder();
  const c = new THREE.Color(1, 1, 1);
  const r = 0.28; // ridge half-length (fraction of width)
  const A = new THREE.Vector3(-0.5, 0, -0.5), B = new THREE.Vector3(0.5, 0, -0.5), C = new THREE.Vector3(0.5, 0, 0.5), D = new THREE.Vector3(-0.5, 0, 0.5);
  const R1 = new THREE.Vector3(-r, 1, 0), R2 = new THREE.Vector3(r, 1, 0);
  const tri = (p: THREE.Vector3, q: THREE.Vector3, s: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(s, p)).normalize();
    const a = mb.vertex(p.x, p.y, p.z, n.x, n.y, n.z, c);
    const b = mb.vertex(q.x, q.y, q.z, n.x, n.y, n.z, c);
    const d = mb.vertex(s.x, s.y, s.z, n.x, n.y, n.z, c);
    mb.idx.push(a, b, d);
  };
  // long sides (quads as two tris), hips
  tri(D, C, R2); tri(D, R2, R1);
  tri(B, A, R1); tri(B, R1, R2);
  tri(A, D, R1);
  tri(C, B, R2);
  return mb.geometry(false);
}

function flatRoof(): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const c = new THREE.Color(1, 1, 1);
  mb.aabb(-0.5, 0, -0.5, 0.5, 1, 0.5, c, { skipBottom: true });
  return mb.geometry(false);
}

export function buildTown(map: WorldMap, layout: Layout, track: Track): TownBuild {
  const { SQUARE } = map;
  const group = new THREE.Group();
  group.name = 'Town';
  const r = rng(77);

  // ---------------------------------------------------------------- houses
  interface H { x: number; y: number; z: number; w: number; d: number; h: number; rot: number; flat: boolean; c: THREE.Color }
  const houses: H[] = [];
  const C = 15;
  for (let z = SQUARE.z0 + 80; z < SQUARE.z1 - 80; z += C)
    for (let x = SQUARE.x0 + 80; x < SQUARE.x1 - 80; x += C) {
      const ix = Math.floor(x / C), iz = Math.floor(z / C);
      const px = x + (hash2i(ix, iz, 31) - 0.5) * 7;
      const pz = z + (hash2i(ix, iz, 32) - 0.5) * 7;
      const t = map.town(px, pz);
      if (t < 0.08) continue;
      if (hash2i(ix, iz, 33) > t * 0.92) continue;
      const hC = map.height(px, pz);
      if (hC < 2.2) continue;
      if (map.excluded(px, pz, 6)) continue;
      if (map.trackClearance(px, pz) < 16) continue;
      // orient along the contour (face downhill), with some jitter
      const e = 6;
      const gx = map.height(px + e, pz) - map.height(px - e, pz);
      const gz = map.height(px, pz + e) - map.height(px, pz - e);
      const slope = Math.hypot(gx, gz) / (2 * e);
      if (slope > 0.55) continue;
      const rot = Math.atan2(gx, gz) + (hash2i(ix, iz, 34) - 0.5) * 0.35;
      const dense = t > 0.6;
      const w = 7 + hash2i(ix, iz, 35) * (dense ? 6 : 5);
      const d = 6 + hash2i(ix, iz, 36) * 4;
      const floors = 1 + Math.floor(hash2i(ix, iz, 37) * (dense ? 3.2 : 2.2));
      // base at the lowest corner so nothing floats on slopes
      let yMin = hC;
      for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
        const cs = Math.cos(rot), sn = Math.sin(rot);
        yMin = Math.min(yMin, map.height(px + ox * cs + oz * sn, pz - ox * sn + oz * cs));
      }
      const c = WALLS[Math.floor(hash2i(ix, iz, 38) * WALLS.length)].clone().multiplyScalar(0.9 + hash2i(ix, iz, 39) * 0.12);
      houses.push({ x: px, y: yMin, z: pz, w, d, h: floors * 3 + 0.4, rot, flat: hash2i(ix, iz, 40) < 0.35, c });
    }

  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  bodyGeo.translate(0, 0.5, 0);
  const body = new THREE.InstancedMesh(bodyGeo, houseMaterial(), houses.length);
  const hipGeo = hipRoof();
  const flatGeo = flatRoof();
  const nHip = houses.filter((h) => !h.flat).length;
  const hip = new THREE.InstancedMesh(hipGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }), Math.max(1, nHip));
  const flat = new THREE.InstancedMesh(flatGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), Math.max(1, houses.length - nHip));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let ih = 0, iflat = 0;
  const roofC = new THREE.Color();
  houses.forEach((h, i) => {
    q.setFromAxisAngle(up, h.rot);
    m.compose(new THREE.Vector3(h.x, h.y - 3, h.z), q, new THREE.Vector3(h.w, h.h + 3, h.d));
    body.setMatrixAt(i, m);
    body.setColorAt(i, h.c);
    const top = h.y + h.h;
    if (h.flat) {
      m.compose(new THREE.Vector3(h.x, top, h.z), q, new THREE.Vector3(h.w + 0.1, 0.6, h.d + 0.1));
      flat.setMatrixAt(iflat, m);
      flat.setColorAt(iflat, h.c.clone().multiplyScalar(0.97));
      iflat++;
    } else {
      m.compose(new THREE.Vector3(h.x, top, h.z), q, new THREE.Vector3(h.w + 0.8, Math.min(h.w, h.d) * 0.36, h.d + 0.8));
      hip.setMatrixAt(ih, m);
      roofC.copy(ROOF).multiplyScalar(0.8 + r() * 0.35);
      roofC.offsetHSL((r() - 0.5) * 0.02, 0, 0);
      hip.setColorAt(ih, roofC);
      ih++;
    }
  });
  for (const im of [body, hip, flat]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  }
  hip.count = ih;
  flat.count = iflat;

  // ---------------------------------------------------------------- landmarks (merged)
  const lm = new MeshBuilder();
  const boards = new MeshBuilder();
  const bulbs = new MeshBuilder();
  const place = (mb: MeshBuilder, x: number, y: number, z: number, rot: number) =>
    mb.transform(new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z));

  // church: nave + transept + bell tower with pyramid spire
  {
    const ch = layout.church;
    const mb = new MeshBuilder();
    const W = srgb(0xf1ece2);
    mb.aabb(-15, -3, -7, 15, 13, 7, W);
    mb.aabb(-3, -3, -12, 5, 12, 12, W);
    mb.prismX([[-7.8, 13], [7.8, 13], [0, 18]], -15.5, 15.5, ROOF);
    mb.aabb(-18, -3, -3.5, -12, 30, 3.5, W);
    mb.aabb(-18.4, 24, -3.9, -11.6, 25, 3.9, srgb(0xd9d2c4));
    // belfry openings (dark)
    for (const [dx, dz] of [[0, -3.52], [0, 3.52]] as [number, number][]) mb.aabb(-16.5 + dx, 25.5, dz - 0.05, -13.5 + dx, 28.5, dz + 0.05, srgb(0x1a1a1a));
    const sp = new MeshBuilder();
    sp.prismX([[-3.6, 30], [3.6, 30], [0, 38]], -18.2, -11.8, ROOF);
    mb.append(sp);
    // dome over the crossing
    mb.blob(1, 13, 0, 4.5, 5, 4.5, 14, 7, srgb(0xd8a24a), { lumps: 0, leaf: 0, shade: [0.8, 1.05], normalUp: 0 });
    place(mb, ch.x, ch.y, ch.z, ch.rot);
    lm.append(mb);
  }
  // castle: curtain walls with crenellations, corner towers, keep
  {
    const ca = layout.castle;
    const mb = new MeshBuilder();
    const S = srgb(0xc9ab82);
    const Sd = srgb(0xa98c66);
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      mb.aabb(Math.min(x0, x1) - 1.2, -6, Math.min(z0, z1) - 1.2, Math.max(x0, x1) + 1.2, 11, Math.max(z0, z1) + 1.2, S);
      const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
      for (let k = 0; k < len; k += 2.4) {
        const t = k / len;
        const cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
        mb.aabb(cx - 0.6, 11, cz - 0.6, cx + 0.6, 12.4, cz + 0.6, S);
      }
    };
    wall(-32, -22, 32, -22);
    wall(32, -22, 32, 22);
    wall(32, 22, -32, 22);
    wall(-32, 22, -32, -22);
    for (const [x, z] of [[-32, -22], [32, -22], [32, 22], [-32, 22]]) {
      mb.aabb(x - 4.5, -6, z - 4.5, x + 4.5, 16, z + 4.5, Sd);
      for (let k = 0; k < 4; k++) mb.aabb(x - 4.5 + k * 2.6, 16, z - 4.5, x - 3.5 + k * 2.6, 17.4, z + 4.5, Sd);
    }
    mb.aabb(-10, -6, -8, 6, 24, 8, S);
    for (let k = 0; k < 6; k++) mb.aabb(-10 + k * 3.1, 24, -8, -8.8 + k * 3.1, 25.6, 8, S);
    place(mb, ca.x, ca.y, ca.z, ca.rot);
    lm.append(mb);
  }
  // Gran Hotel Miramar: 14-floor slab with balcony bands, over the Paseo
  {
    const ho = layout.hotel;
    const mb = new MeshBuilder();
    const L = 64, D = 15, floors = 14, FH = 3.1;
    const W = srgb(0xf2f0eb);
    const G = srgb(0x3d5360);
    mb.aabb(-L / 2, -4, -D / 2, L / 2, 5, D / 2, srgb(0xdedad2));
    for (let f = 0; f < floors; f++) {
      const y = 5 + f * FH;
      mb.aabb(-L / 2 + 0.6, y, -D / 2 + 1.4, L / 2 - 0.6, y + FH, D / 2 - 1.4, G);
      mb.aabb(-L / 2, y + FH - 0.28, -D / 2 - 0.2, L / 2, y + FH, D / 2 + 0.2, W);
      mb.aabb(-L / 2, y + FH - 1.3, -D / 2 - 0.2, L / 2, y + FH - 0.28, -D / 2, W.clone().multiplyScalar(0.94));
      mb.aabb(-L / 2, y + FH - 1.3, D / 2, L / 2, y + FH - 0.28, D / 2 + 0.2, W.clone().multiplyScalar(0.94));
    }
    // end walls
    mb.aabb(-L / 2 - 0.4, 5, -D / 2, -L / 2 + 0.6, 5 + floors * FH, D / 2, W);
    mb.aabb(L / 2 - 0.6, 5, -D / 2, L / 2 + 0.4, 5 + floors * FH, D / 2, W);
    mb.aabb(-L / 2 - 1, 5 + floors * FH, -D / 2 - 1, L / 2 + 1, 5 + floors * FH + 1.2, D / 2 + 1, W);
    place(mb, ho.x, ho.y, ho.z, ho.rot + Math.PI / 2);
    lm.append(mb);
    // rooftop sign facing the track (east)
    const top = ho.y + 5 + floors * FH + 1.2;
    const b = new MeshBuilder();
    b.quad4(new THREE.Vector3(-D / 2 - 1.1, 0, -22), new THREE.Vector3(-D / 2 - 1.1, 0, 22), new THREE.Vector3(-D / 2 - 1.1, 5.5, 22), new THREE.Vector3(-D / 2 - 1.1, 5.5, -22), new THREE.Color(1, 1, 1), sponsorUV(16));
    b.quad4(new THREE.Vector3(D / 2 + 1.1, 0, 22), new THREE.Vector3(D / 2 + 1.1, 0, -22), new THREE.Vector3(D / 2 + 1.1, 5.5, -22), new THREE.Vector3(D / 2 + 1.1, 5.5, 22), new THREE.Color(1, 1, 1), sponsorUV(16));
    place(b, ho.x, top, ho.z, ho.rot);
    boards.append(b);
  }
  // ferris wheel (static frame; rotating rim + gondolas below)
  const wheelPivot = new THREE.Group();
  const gondolas: THREE.InstancedMesh | null = (() => {
    const wh = layout.wheel;
    const R = 24, HUB = 28, N = 24;
    const frame = new MeshBuilder();
    const steel = srgb(0xe9ecef);
    // A-frame legs
    for (const zs of [-3.5, 3.5])
      for (const xs of [-1, 1]) frame.tube([[xs * 14, -1, zs * 1.6, 0.55], [0, HUB, zs, 0.4]], 6, steel);
    frame.tube([[0, HUB, -4.2, 0.9], [0, HUB, 4.2, 0.9]], 10, steel);
    // base kiosk
    frame.aabb(-8, -1, -6, 8, 3.2, 6, srgb(0x243240));
    place(frame, wh.x, wh.y, wh.z, wh.rot);
    lm.append(frame);
    // rotating part (built around the hub, in the wheel's local frame)
    const rim = new MeshBuilder();
    const bl = new MeshBuilder();
    for (const zs of [-3, 3]) {
      const ring: number[][] = [];
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * Math.PI * 2;
        ring.push([Math.cos(a) * R, Math.sin(a) * R, zs, 0.32]);
      }
      rim.tube(ring, 6, steel);
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        rim.tube([[0, 0, zs * 1.3, 0.12], [Math.cos(a) * R, Math.sin(a) * R, zs, 0.1]], 3, steel);
      }
      for (let k = 0; k < 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        bl.blob(Math.cos(a) * (R + 0.35), Math.sin(a) * (R + 0.35), zs, 0.22, 0.22, 0.22, 4, 2, new THREE.Color(14, 11, 7), { lumps: 0, leaf: 0 });
      }
    }
    const rimMesh = new THREE.Mesh(rim.geometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 }));
    rimMesh.castShadow = true;
    const bulbMesh = new THREE.Mesh(bl.geometry(false), new THREE.MeshBasicMaterial({ vertexColors: true }));
    wheelPivot.add(rimMesh, bulbMesh);
    const holder = new THREE.Group();
    holder.position.set(wh.x, wh.y + HUB, wh.z);
    holder.rotation.y = wh.rot;
    holder.add(wheelPivot);
    group.add(holder);
    // gondolas (kept upright each frame)
    const gm = new MeshBuilder();
    gm.aabb(-1.3, -2.8, -1.1, 1.3, -0.6, 1.1, new THREE.Color(1, 1, 1));
    gm.aabb(-1.5, -0.6, -1.3, 1.5, -0.35, 1.3, new THREE.Color(0.95, 0.95, 0.95));
    gm.tube([[0, -0.4, 0, 0.06], [0, 0.2, 0, 0.06]], 3, new THREE.Color(0.8, 0.8, 0.8));
    const g = new THREE.InstancedMesh(gm.geometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), N);
    const cols = [0xc8102e, 0xffd400, 0x0a5cc2, 0x00a86b, 0xff7a00, 0xe6e6e6].map((h) => new THREE.Color(h));
    for (let k = 0; k < N; k++) g.setColorAt(k, cols[k % cols.length]);
    g.userData = { R, N, holder };
    holder.add(g);
    return g;
  })();

  // sponsor footbridges over the track
  for (const s of layout.bridges) {
    const f = track.frame(s);
    const bl = track.barrierAt(s, -1) + 3.5;
    const br = track.barrierAt(s, 1) + 3.5;
    const pL = track.point(s, -bl, 0);
    const pR = track.point(s, br, 0);
    const deckY = Math.max(pL.y, pR.y) + 7.4;
    const span = pL.distanceTo(pR);
    const mb = new MeshBuilder();
    const bb = new MeshBuilder();
    const steelC = srgb(0xdfe2e6);
    // local frame: x across the track (from left tower to right tower), z along the track
    const half = span / 2;
    for (const xs of [-half, half]) {
      mb.aabb(xs - 2.2, -6, -2.2, xs + 2.2, deckY - pL.y + 3.2, 2.2, srgb(0x3b3f46));
    }
    const dy = deckY - pL.y;
    mb.aabb(-half, dy - 0.5, -1.6, half, dy, 1.6, steelC);
    mb.aabb(-half, dy + 2.6, -1.6, half, dy + 3.0, 1.6, steelC);
    // truss sides = big sponsor boards both ways
    for (const zs of [-1.65, 1.65]) mb.aabb(-half, dy, zs - 0.05, half, dy + 0.15, zs + 0.05, steelC);
    const nb = Math.max(1, Math.round(span / 14));
    for (let k = 0; k < nb; k++) {
      const x0 = -half + (k * span) / nb + 0.2, x1 = -half + ((k + 1) * span) / nb - 0.2;
      const uv = sponsorUV(k + Math.round(s));
      bb.quad4(new THREE.Vector3(x1, dy + 0.2, -1.7), new THREE.Vector3(x0, dy + 0.2, -1.7), new THREE.Vector3(x0, dy + 2.55, -1.7), new THREE.Vector3(x1, dy + 2.55, -1.7), new THREE.Color(1, 1, 1), uv);
      bb.quad4(new THREE.Vector3(x0, dy + 0.2, 1.7), new THREE.Vector3(x1, dy + 0.2, 1.7), new THREE.Vector3(x1, dy + 2.55, 1.7), new THREE.Vector3(x0, dy + 2.55, 1.7), new THREE.Color(1, 1, 1), sponsorUV(k + 5 + Math.round(s)));
    }
    const mid = pL.clone().add(pR).multiplyScalar(0.5);
    const across = pR.clone().sub(pL).setY(0).normalize();
    const along = new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize();
    const yAx = new THREE.Vector3(0, 1, 0);
    // right-handed basis with x = across, y = up, z = x × y
    const zAx = new THREE.Vector3().crossVectors(across, yAx).normalize();
    void along;
    const M = new THREE.Matrix4().makeBasis(across, yAx, zAx).setPosition(mid.x, pL.y, mid.z);
    mb.transform(M);
    bb.transform(M);
    lm.append(mb);
    boards.append(bb);
  }

  const lmMesh = new THREE.Mesh(lm.geometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }));
  lmMesh.name = 'landmarks';
  lmMesh.castShadow = true;
  lmMesh.receiveShadow = true;
  group.add(lmMesh);
  const tex = sponsorTexture();
  const bMesh = new THREE.Mesh(boards.geometry(false), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 }));
  bMesh.name = 'landmark_boards';
  group.add(bMesh);

  let angle = 0;
  const gm4 = new THREE.Matrix4();
  const update = (dt: number) => {
    angle += dt * 0.035;
    wheelPivot.rotation.z = angle;
    if (gondolas) {
      const { R, N } = gondolas.userData as { R: number; N: number };
      for (let k = 0; k < N; k++) {
        const a = angle + (k / N) * Math.PI * 2;
        gm4.makeTranslation(Math.cos(a) * R, Math.sin(a) * R, 0);
        gondolas.setMatrixAt(k, gm4);
      }
      gondolas.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  if (gondolas) gondolas.computeBoundingSphere();
  return { group, update, houses: houses.length };
}
