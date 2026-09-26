import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { GrandstandSpec, Layout } from '../layout.ts';
import { MeshBuilder, srgb } from '../geom.ts';
import { buildWaters, type WaterSpec } from '../water.ts';
import { rng } from '../noise.ts';
import { canvas2d, canvasTexture } from '../textures.ts';
import { floodUniforms } from '../night.ts';
import type { MexicoLayout } from './mexico.ts';
import { CANAL, MX_LAKE, MX_SITES, MX_WATER_Y } from './mexicoLand.ts';

/**
 * Mexico City's landmarks and water, built once per world:
 *
 *   the Foro Sol      the stadium the lap runs through: the grandstands (grandstands.ts, from the
 *                     layout) get the stadium round them — the tall concrete outer wall and its
 *                     rim, the stair-and-vomitory piers between the stand sections, eight
 *                     floodlight masts, the Foro Sol lettering, and the podium in the field
 *                     under a pink Gran Premio arch with its big screen
 *   the Palacio       Félix Candela's copper dome (the Palacio de los Deportes, 1968) by Turn 1
 *   the water         the rowing course south of the lap (buoyed lanes, the finish tower) and
 *                     the lake in the infield
 *
 * A handful of merged meshes (a few draw calls, ~40 k triangles).
 */

const CONCRETE = srgb(0xc8c2b6);
const CONCRETE_DARK = srgb(0x9a958c);
const SOL = srgb(0xf29a1f);
const STEEL = srgb(0xdfe2e6);
const STEEL_DARK = srgb(0x4b5058);
const NIGHT_GLSL = 'smoothstep( 0.0, 0.5, uFlood.x )';

/** floodlight faces: pale by day, blazing at night */
function lampMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.25, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3( 1.0, 0.97, 0.9 ) * ( 0.25 + 5.0 * ${NIGHT_GLSL} );`);
  };
  m.customProgramCacheKey = () => 'apex-mx-lamp';
  return m;
}

/** an oriented box: centre, full sizes along (along, up, facing), yaw from the facing vector */
function obox(mb: MeshBuilder, c: THREE.Vector3, sx: number, sy: number, sz: number, facing: THREE.Vector3, col: THREE.Color) {
  const yaw = Math.atan2(facing.x, facing.z);
  const m = new THREE.Matrix4().makeRotationY(yaw).scale(new THREE.Vector3(sx, sy, sz)).setPosition(c);
  mb.box(m, col);
}

/** the Gran Premio's pink banner for the podium arch */
function arcoTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 128);
  const g = ctx.createLinearGradient(0, 0, 1024, 0);
  g.addColorStop(0, '#e6007e');
  g.addColorStop(0.5, '#ff2d8a');
  g.addColorStop(1, '#e6007e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 128);
  // papel picado edge
  ctx.fillStyle = '#ffffff';
  for (let x = 0; x < 1024; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x + 16, 112);
    ctx.lineTo(x + 32, 128);
    ctx.fill();
  }
  ctx.font = '900 54px "Titillium Web", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GRAN PREMIO DE LA CIUDAD DE MÉXICO', 512, 58);
  return canvasTexture(canvas, true, 4);
}

/** the stadium's name on its outer wall */
function foroTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 256);
  ctx.fillStyle = '#c8c2b6';
  ctx.fillRect(0, 0, 1024, 256);
  // the sun
  const cx = 150, cy = 128;
  ctx.fillStyle = '#f29a1f';
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.1) * 70, cy + Math.sin(a - 0.1) * 70);
    ctx.lineTo(cx + Math.cos(a) * 112, cy + Math.sin(a) * 112);
    ctx.lineTo(cx + Math.cos(a + 0.1) * 70, cy + Math.sin(a + 0.1) * 70);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 0, Math.PI * 2);
  ctx.fillStyle = '#f7b733';
  ctx.fill();
  ctx.fillStyle = '#d9480f';
  ctx.font = '900 150px "Titillium Web", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('FORO SOL', 290, 136);
  return canvasTexture(canvas, true, 4);
}

// ---------------------------------------------------------------- water

function buildMexicoWater() {
  const B = CANAL;
  const dx = B.bx - B.ax, dz = B.bz - B.az;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
  const cx = (B.ax + B.bx) / 2, cz = (B.az + B.bz) / 2;
  const corner = (a: number, c: number) => ({ x: cx + ux * a + nx * c, z: cz + uz * a + nz * c });
  const canal: WaterSpec = {
    outline: [corner(-len / 2, -B.half), corner(len / 2, -B.half), corner(len / 2, B.half), corner(-len / 2, B.half)],
    y: MX_WATER_Y,
    kind: 'basin',
    // the rowing course's water is a murky green-brown
    deep: [0.02, 0.035, 0.028],
    shallow: [0.05, 0.07, 0.045],
  };
  const K = MX_LAKE;
  const lakePts: { x: number; z: number }[] = [];
  const c = Math.cos(K.rot), s = Math.sin(K.rot);
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    // (the same wobbly ellipse as sdLake, a little inside it so the bank shows)
    const w = (1 + 0.08 * Math.sin(a * 3 + 0.7)) * 0.97;
    const u = Math.cos(a) * K.rx * w, v = Math.sin(a) * K.rz * w;
    lakePts.push({ x: K.x + u * c + v * s, z: K.z - u * s + v * c });
  }
  const lake: WaterSpec = { outline: lakePts, y: MX_WATER_Y + 0.02, kind: 'lake', deep: [0.018, 0.04, 0.03], shallow: [0.06, 0.08, 0.05], shore: 5 };
  return buildWaters([canal, lake]);
}

/** late October in the highlands: the rains are over, the grass still green but tired, dusty paths */
export function mexicoTerrainLook(u: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x5f7536);
  set('uGrassDark', 0x44552a);
  set('uCanopy', 0x34482a);
  // the city's flat roofs: grey concrete, red-oxide waterproofing, white-painted
  set('uRoof', 0x9c5a44);
  set('uGravel', 0xb9a88a);
  if (u.uCity) u.uCity.value = 1;
}

// ---------------------------------------------------------------- build

export function buildMexicoScenery(layout: Layout, track: Track, map: WorldMap): { group: THREE.Group; tris: number; update(elapsed: number): void } {
  const group = new THREE.Group();
  group.name = 'MexicoScenery';
  const r = rng(5268);
  const solid = new MeshBuilder();
  const steel = new MeshBuilder();
  const lamps = new MeshBuilder();
  const copper = new MeshBuilder();
  const arco = new MeshBuilder();
  const letters = new MeshBuilder();
  const g = (x: number, z: number) => map.height(x, z);
  const sites = (layout as MexicoLayout).mexico;

  const water = buildMexicoWater();
  group.add(water.mesh);

  // ---------------------------------------------------------------- the Foro Sol
  if (sites) {
    const stands = sites.foro.stands.map((k) => layout.grandstands[k]).filter((s): s is GrandstandSpec => !!s);
    const bowl = stands.filter((s) => s.name !== 'Foro Sol Jardín');
    const along = (s: GrandstandSpec) => new THREE.Vector3(-s.facing.z, 0, s.facing.x);
    const top = (s: GrandstandSpec) => 1.9 + s.rows * 0.46;
    // the outer wall behind every bowl section: from the ground to a rim above the top row, with pilasters
    for (const s of bowl) {
      const T = top(s);
      const back = s.center.clone().addScaledVector(s.facing, -s.depth / 2 - 1.2);
      const yTop = s.y0 + T + 6.5;
      const yBot = Math.min(s.y0, g(back.x, back.z)) - 1.5;
      const c = new THREE.Vector3(back.x, (yTop + yBot) / 2, back.z);
      obox(solid, c, s.length + 2.4, yTop - yBot, 2.2, s.facing, CONCRETE);
      // the rim: a slab cantilevered over the top rows (the upper concourse), and the orange band of the sun
      const rim = s.center.clone().addScaledVector(s.facing, -s.depth / 2 + 1.8);
      obox(solid, new THREE.Vector3(rim.x, s.y0 + T + 5.6, rim.z), s.length + 2.4, 0.9, 6.2, s.facing, CONCRETE_DARK);
      const band = back.clone().addScaledVector(s.facing, -1.2);
      obox(solid, new THREE.Vector3(band.x, s.y0 + T + 3.4, band.z), s.length + 2.5, 2.2, 0.3, s.facing, SOL);
      // pilasters on the outside face
      const a = along(s);
      const nP = Math.max(2, Math.round(s.length / 6));
      for (let k = 0; k <= nP; k++) {
        const t = (k / nP - 0.5) * s.length;
        const q = back.clone().addScaledVector(a, t).addScaledVector(s.facing, -1.5);
        obox(solid, new THREE.Vector3(q.x, (yTop - 0.4 + yBot) / 2, q.z), 0.9, yTop - 0.4 - yBot, 1.0, s.facing, CONCRETE_DARK);
      }
    }
    // piers between neighbouring sections: fill the wedge between one section's end and the next one's start
    for (let i = 0; i + 1 < bowl.length; i++) {
      const A = bowl[i], B = bowl[i + 1];
      if (A.name !== B.name) continue;
      const aA = along(A), aB = along(B);
      // which end of A faces B, which end of B faces A
      const endA = A.center.clone().addScaledVector(aA, A.length / 2).distanceTo(B.center) < A.center.clone().addScaledVector(aA, -A.length / 2).distanceTo(B.center) ? 1 : -1;
      const endB = B.center.clone().addScaledVector(aB, B.length / 2).distanceTo(A.center) < B.center.clone().addScaledVector(aB, -B.length / 2).distanceTo(A.center) ? 1 : -1;
      const pt = (s: GrandstandSpec, a: THREE.Vector3, e: number, d: number) => s.center.clone().addScaledVector(a, (e * s.length) / 2).addScaledVector(s.facing, d);
      const fA = pt(A, aA, endA, A.depth / 2), bA = pt(A, aA, endA, -A.depth / 2 - 2.3);
      const fB = pt(B, aB, endB, B.depth / 2), bB = pt(B, aB, endB, -B.depth / 2 - 2.3);
      const gap = Math.max(fA.distanceTo(fB), bA.distanceTo(bB));
      if (gap < 0.3) continue;
      const T = Math.max(top(A), top(B));
      const y0 = Math.min(A.y0, B.y0);
      // a sloped-top prism over the quad fA–fB–bB–bA: front edge low, back edge at the rim
      const P = [fA, fB, bB, bA];
      const yT = [y0 + 2.2, y0 + 2.2, y0 + T + 6.5, y0 + T + 6.5];
      const yB = y0 - 1.5;
      const ctr = new THREE.Vector3();
      for (const q of P) ctr.add(q);
      ctr.multiplyScalar(0.25);
      // top face (both windings: the quad's orientation depends on which way the bowl turns)
      const v = (k: number, y: number) => new THREE.Vector3(P[k].x, y, P[k].z);
      solid.quad4(v(0, yT[0]), v(1, yT[1]), v(2, yT[2]), v(3, yT[3]), CONCRETE_DARK);
      solid.quad4(v(3, yT[3]), v(2, yT[2]), v(1, yT[1]), v(0, yT[0]), CONCRETE_DARK);
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        solid.quad4(v(k, yB), v(k2, yB), v(k2, yT[k2]), v(k, yT[k]), CONCRETE);
        solid.quad4(v(k2, yB), v(k, yB), v(k, yT[k]), v(k2, yT[k2]), CONCRETE);
      }
      void ctr;
    }
    // floodlight masts behind the bowl (baseball lights): every few sections, tall, leaning in
    const mastEvery = Math.max(2, Math.round(bowl.length / 8));
    bowl.forEach((s, i) => {
      if (i % mastEvery !== Math.floor(mastEvery / 2)) return;
      const base = s.center.clone().addScaledVector(s.facing, -s.depth / 2 - 7);
      const y0 = g(base.x, base.z) - 0.5;
      const H = 52 + r() * 4;
      // the shaft: a tapered steel column in three stages
      for (const [h0, h1, w] of [[0, H * 0.4, 1.6], [H * 0.4, H * 0.75, 1.25], [H * 0.75, H, 0.95]] as const) obox(steel, new THREE.Vector3(base.x, y0 + (h0 + h1) / 2, base.z), w, h1 - h0, w, s.facing, STEEL);
      // the head: a frame of lamps tilted down toward the field
      const hc = base.clone().addScaledVector(s.facing, 1.2);
      const yaw = Math.atan2(s.facing.x, s.facing.z);
      const head = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(0.38));
      const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(head).add(new THREE.Vector3(hc.x, y0 + H + 3, hc.z));
      const W = 13, Hh = 7;
      const fr = new THREE.Matrix4().copy(head).scale(new THREE.Vector3(W + 0.8, Hh + 0.8, 0.8)).setPosition(at(0, 0, -0.5));
      steel.box(fr, STEEL_DARK);
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 7; col++) {
          const x = -W / 2 + (col + 0.5) * (W / 7), y = -Hh / 2 + (row + 0.5) * (Hh / 4);
          const lm = new THREE.Matrix4().copy(head).scale(new THREE.Vector3(1.5, 1.3, 0.25)).setPosition(at(x, y, 0.05));
          lamps.box(lm, new THREE.Color(1, 1, 1));
        }
      // catwalk under the head
      obox(steel, at(0, -Hh / 2 - 0.6, 0.6), W, 0.2, 1.6, s.facing, STEEL);
    });
    // FORO SOL on the outside of the biggest section's wall (seen from the Peraltada and the air)
    {
      let best: GrandstandSpec | null = null;
      for (const s of bowl) if (s.name === 'Foro Sol' && (!best || Math.abs(s.facing.z) > Math.abs(best.facing.z))) best = s;
      const s = best;
      if (s) {
        const back = s.center.clone().addScaledVector(s.facing, -s.depth / 2 - 2.35);
        const a = along(s);
        const T = top(s);
        const w = Math.min(34, s.length * 1.6), h = w / 4;
        const yc = s.y0 + T - 5;
        const out = s.facing.clone().negate();
        const p0 = back.clone().addScaledVector(a, w / 2), p1 = back.clone().addScaledVector(a, -w / 2);
        // (face outward: the quad's winding is chosen so its normal points away from the field)
        const q = [new THREE.Vector3(p0.x, yc - h / 2, p0.z), new THREE.Vector3(p1.x, yc - h / 2, p1.z), new THREE.Vector3(p1.x, yc + h / 2, p1.z), new THREE.Vector3(p0.x, yc + h / 2, p0.z)];
        const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[0]));
        if (n.dot(out) >= 0) letters.quad4(q[0], q[1], q[2], q[3], new THREE.Color(1, 1, 1), [0, 0, 1, 1]);
        else letters.quad4(q[1], q[0], q[3], q[2], new THREE.Color(1, 1, 1), [0, 0, 1, 1]);
      }
    }

    // ---------------------------------------------------------------- the podium in the field
    {
      const P = sites.podium;
      const y = g(P.x, P.z);
      const f = new THREE.Vector3(Math.sin(P.rot), 0, Math.cos(P.rot));
      const a = new THREE.Vector3(f.z, 0, -f.x);
      const at = (u: number, v: number) => new THREE.Vector3(P.x, 0, P.z).addScaledVector(a, u).addScaledVector(f, v);
      // the stage (toward the track, +v) and the three steps, the arch behind (toward the Jardín stand, −v)
      obox(solid, at(0, 0).setY(y + 1.1), 22, 2.2, 9, f, srgb(0x1c1d22));
      obox(solid, at(0, -0.5).setY(y + 2.2 + 0.9), 3.4, 1.8, 3, f, srgb(0xf4f4f4));
      obox(solid, at(-3.4, -0.5).setY(y + 2.2 + 0.6), 3.4, 1.2, 3, f, srgb(0xf4f4f4));
      obox(solid, at(3.4, -0.5).setY(y + 2.2 + 0.4), 3.4, 0.8, 3, f, srgb(0xf4f4f4));
      for (const u of [-11, 11]) obox(steel, at(u, -5).setY(y + 9), 1.6, 18, 1.6, f, srgb(0xe6007e));
      const b0 = at(-11.8, -4.1), b1 = at(11.8, -4.1);
      const yb = y + 14.2;
      const q = [new THREE.Vector3(b0.x, yb, b0.z), new THREE.Vector3(b1.x, yb, b1.z), new THREE.Vector3(b1.x, yb + 2.9, b1.z), new THREE.Vector3(b0.x, yb + 2.9, b0.z)];
      const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[0]));
      if (n.dot(f) >= 0) arco.quad4(q[0], q[1], q[2], q[3], new THREE.Color(1, 1, 1));
      else arco.quad4(q[1], q[0], q[3], q[2], new THREE.Color(1, 1, 1));
      obox(steel, at(0, -4.6).setY(yb + 1.45), 24, 3.3, 0.8, f, STEEL_DARK);
      obox(steel, at(0, -5).setY(y + 18.8), 22.6, 1.2, 1.2, f, srgb(0xe6007e));
    }
  }

  // ---------------------------------------------------------------- the Palacio de los Deportes
  {
    const P = MX_SITES.palacio;
    const y0 = g(P.x, P.z);
    const R = P.r;
    // the ring: a low glazed drum with a concrete plinth
    const nA = 48;
    for (let k = 0; k < nA; k++) {
      const a0 = (k / nA) * Math.PI * 2, a1 = ((k + 1) / nA) * Math.PI * 2;
      const p = (a: number, rr: number, y: number) => new THREE.Vector3(P.x + Math.cos(a) * rr, y, P.z + Math.sin(a) * rr);
      solid.quad4(p(a1, R, y0 - 1), p(a0, R, y0 - 1), p(a0, R, y0 + 2.5), p(a1, R, y0 + 2.5), CONCRETE);
      solid.quad4(p(a1, R - 0.5, y0 + 2.5), p(a0, R - 0.5, y0 + 2.5), p(a0, R - 0.5, y0 + 7), p(a1, R - 0.5, y0 + 7), srgb(0x2a3038));
    }
    // the dome: Candela's hyperbolic-paraboloid "umbrellas" read as a grid of copper panels
    const H = 30, nR = 14, nT = 56;
    const dome = (i: number, j: number) => {
      const t = i / nR; // 0 at the eaves … 1 at the crown
      const a = (j / nT) * Math.PI * 2;
      const rr = R * Math.cos((t * Math.PI) / 2) * 1.0;
      const y = y0 + 7 + H * Math.sin((t * Math.PI) / 2);
      return new THREE.Vector3(P.x + Math.cos(a) * rr, y, P.z + Math.sin(a) * rr);
    };
    for (let i = 0; i < nR; i++)
      for (let j = 0; j < nT; j++) {
        // each panel dished a little (the hypar), alternate panels a shade apart: the famous chequer
        const tone = (i + j) % 2 ? 1 : 0.84;
        const col = new THREE.Color(0.55 * tone, 0.3 * tone, 0.18 * tone);
        const a = dome(i, j), b = dome(i, j + 1), c = dome(i + 1, j + 1), d = dome(i + 1, j);
        const m = a.clone().add(b).add(c).add(d).multiplyScalar(0.25);
        const up = m.clone().sub(new THREE.Vector3(P.x, y0 + 7 - R * 0.4, P.z)).normalize();
        const dip = m.clone().addScaledVector(up, -0.5);
        for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]] as const) {
          // (wound so the face looks outward)
          const nn = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(dip, p));
          if (nn.dot(up) >= 0) copper.quad4(p, q, dip, dip, col);
          else copper.quad4(q, p, dip, dip, col);
        }
      }
  }

  // ---------------------------------------------------------------- the rowing course: coping, lane buoys, the finish tower
  {
    const B = CANAL;
    const dx = B.bx - B.ax, dz = B.bz - B.az;
    const len = Math.hypot(dx, dz);
    const u = new THREE.Vector3(dx / len, 0, dz / len);
    const n = new THREE.Vector3(-u.z, 0, u.x);
    const c0 = new THREE.Vector3((B.ax + B.bx) / 2, 0, (B.az + B.bz) / 2);
    const P = (a: number, c: number, y: number) => c0.clone().addScaledVector(u, a).addScaledVector(n, c).setY(y);
    const yc = MX_WATER_Y + 0.9;
    for (const sd of [-1, 1]) obox(solid, P(0, sd * (B.half + 0.6), yc - 0.6), 1.4, 1.8, len + 2.4, u.clone().multiplyScalar(1), CONCRETE);
    for (const sd of [-1, 1]) obox(solid, P(sd * (len / 2 + 0.6), 0, yc - 0.6), 1.4, 1.8, 2 * B.half + 2.4, n.clone(), CONCRETE);
    // six lanes: buoy lines every 8 m
    const white = new THREE.Color(0.95, 0.95, 0.92), orange = srgb(0xf06a1a);
    for (let lane = 1; lane < 6; lane++) {
      const c = -B.half + (lane * 2 * B.half) / 6;
      for (let a = -len / 2 + 20; a < len / 2 - 20; a += 8) {
        const q = P(a, c, MX_WATER_Y + 0.08);
        solid.aabb(q.x - 0.18, q.y - 0.1, q.z - 0.18, q.x + 0.18, q.y + 0.12, q.z + 0.18, Math.abs(a) > len / 2 - 120 ? orange : white);
      }
    }
    // the finish tower at the east end, on the north bank
    const ft = P(len / 2 - 90, -B.half - 14, 0);
    const fy = g(ft.x, ft.z);
    obox(solid, ft.clone().setY(fy + 6), 6, 12, 6, n, CONCRETE);
    obox(solid, ft.clone().setY(fy + 13.5), 9, 3, 8, n, srgb(0x2a3038));
    obox(solid, ft.clone().setY(fy + 15.3), 10, 0.6, 9, n, CONCRETE_DARK);
    // the stepped concrete stand along the north bank by the finish
    const gy = g(P(len / 2 - 200, -B.half - 12, 0).x, P(len / 2 - 200, -B.half - 12, 0).z);
    for (let row = 0; row < 8; row++) obox(solid, P(len / 2 - 200, -B.half - 8 - row * 0.9, gy + 0.2 + row * 0.45), 120, 0.9 + row * 0.9, 0.9, n, row % 2 ? CONCRETE : CONCRETE_DARK);
  }

  // ---------------------------------------------------------------- meshes
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.vertexCount === 0) return;
    const m = new THREE.Mesh(mb.geometry(false), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }), 'mx_solid', true);
  add(steel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), 'mx_steel', true);
  add(lamps, lampMaterial(), 'mx_lamps', false);
  add(copper, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55 }), 'mx_palacio', true);
  add(arco, new THREE.MeshStandardMaterial({ map: arcoTexture(), roughness: 0.6, emissive: 0xffffff, emissiveMap: arcoTexture(), emissiveIntensity: 0.25 }), 'mx_arco', false);
  add(letters, new THREE.MeshStandardMaterial({ map: foroTexture(), roughness: 0.8 }), 'mx_forosol', false);
  let tris = 0;
  for (const mb of [solid, steel, lamps, copper, arco, letters]) tris += mb.idx.length / 3;
  void track;
  return { group, tris, update: (t: number) => water.update(t) };
}
