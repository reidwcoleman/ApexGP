import * as THREE from 'three';
import type { Track } from '../Track.ts';
import type { WorldMap } from './worldmap.ts';
import { bankProfile, BANK_RISE, OVAL_STEP, type OvalPath } from './ovalpath.ts';
import { hash2i } from './noise.ts';
import { noiseTexture } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';
import { sponsorTexture, sponsorUV } from './signage.ts';

/**
 * The Sopraelevata — Monza's 1955 banked oval, abandoned in the woods.
 *
 *  - running surface: 12 m of concrete slabs whose profile steepens to 80 % at
 *    the top of the curves; weathered (tar-sealed joints, water streaks, moss,
 *    cracks, weeds), darker and shiny in the rain
 *  - under the high side a framework of columns and cross beams, an edge beam,
 *    a parapet with a rusty guardrail on top — chunks missing, and both ends
 *    crumbling away where the old links to the main straight used to run
 *  - the east straight rises on grassy embankments to a girder bridge across
 *    the Serraglio (deck ≥ 6.6 m above the road), with abutment walls behind
 *    the barriers and a sponsor banner on each face
 */

export interface BankingBuild {
  group: THREE.Group;
  stats: Record<string, number>;
}

const SLAB = 0.35;
const DECK = 2.0;

class GB {
  pos: number[] = [];
  nor: number[] = [];
  dat: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  v(p: THREE.Vector3, n: THREE.Vector3, along: number, across: number, age: number, kind: number, u = 0, vv = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.dat.push(along, across, age, kind);
    this.uv.push(u, vv);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  /** box from 8 corners: bottom (b0..b3) and top (t0..t3), counter-clockwise from above */
  boxFrom(c: THREE.Vector3[], along: number, age: number, kind: number) {
    const faces: [number, number, number, number][] = [
      [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0],
    ];
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (const f of faces) {
      e1.subVectors(c[f[1]], c[f[0]]);
      e2.subVectors(c[f[3]], c[f[0]]);
      n.crossVectors(e1, e2).normalize();
      const ids = f.map((k, q) => this.v(c[k], n, along + (q === 1 || q === 2 ? 1 : 0), q < 2 ? 0 : 1, age, kind));
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aConc', new THREE.Float32BufferAttribute(this.dat, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** weathered concrete: kind 0 = running surface, 1 = structure, 2 = rusty steel */
function concreteMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uNoise: { value: noiseTexture() }, uWet: weatherUniforms.uWetness });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aConc;\nvarying vec4 vConc;\nvarying vec3 vCW;\nvarying vec3 vCN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvConc = aConc;\nvCW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvCN = normalize( mat3( modelMatrix ) * objectNormal );`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNoise;
uniform float uWet;
varying vec4 vConc;
varying vec3 vCW;
varying vec3 vCN;
float cRough;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  vec3 p = vCW;
  float along = vConc.x, across = vConc.y, age = vConc.z, kind = vConc.w;
  float n1 = texture2D( uNoise, p.xz * 0.013 + p.y * 0.004 ).r;
  float n2 = texture2D( uNoise, vec2( p.x + p.z, p.y ) * 0.061 ).g;
  float n3 = texture2D( uNoise, p.xz * 0.21 + p.y * 0.07 ).b;
  float n4 = texture2D( uNoise, vec2( along * 0.09, across * 0.7 ) ).a;
  vec3 col;
  if ( kind < 1.5 ) {
    vec3 conc = mix( vec3( 0.27, 0.265, 0.245 ), vec3( 0.34, 0.335, 0.31 ), n1 );
    conc *= 0.92 + 0.12 * n3;
    // vertical water streaks on walls, darker at the bottom
    float up = abs( vCN.y );
    float streak = smoothstep( 0.55, 0.8, texture2D( uNoise, vec2( ( p.x + p.z ) * 0.35, p.y * 0.02 ) ).g ) * ( 1.0 - up );
    conc *= 1.0 - streak * 0.35;
    // slab joints on the running surface every 6 m, tar-sealed
    if ( kind < 0.5 ) {
      float j = abs( fract( along / 6.0 ) - 0.5 ) * 6.0;
      conc = mix( conc, vec3( 0.1, 0.095, 0.085 ), smoothstep( 2.9, 2.96, j ) * 0.75 );
      // rain has run down the banking for seventy years: dark streaks along the slope
      float sk = texture2D( uNoise, vec2( along * 0.31, across * 0.05 ) ).g;
      float sk2 = texture2D( uNoise, vec2( along * 1.3, across * 0.09 ) ).b;
      conc *= 1.0 - smoothstep( 0.45, 0.7, sk * 0.65 + sk2 * 0.35 ) * 0.55 * smoothstep( 0.02, 0.45, across );
      // grime and moss collect along the low inner edge
      conc = mix( conc, vec3( 0.14, 0.16, 0.09 ), ( 1.0 - smoothstep( 0.0, 0.28, across ) ) * 0.55 * ( 0.6 + 0.4 * n2 ) );
      // every slab poured a slightly different grey
      float slab = fract( sin( floor( along / 6.0 ) * 91.7 + floor( across * 3.0 ) * 17.3 ) * 43758.5 );
      conc *= 0.93 + 0.12 * slab;
    }
    // moss and lichen: lower parts, joints, abandoned stretches
    float moss = smoothstep( 0.55, 0.8, n2 * 0.6 + n1 * 0.4 + ( 1.0 - age ) * 0.35 ) * ( 0.3 + 0.7 * up );
    conc = mix( conc, mix( vec3( 0.2, 0.24, 0.12 ), vec3( 0.28, 0.3, 0.18 ), n3 ), moss * 0.55 );
    // black water stains on the running surface; formwork panels + streaks on walls
    conc = mix( conc, conc * 0.6, smoothstep( 0.66, 0.82, n4 ) * 0.4 * up );
    float panel = abs( fract( ( p.x + p.z ) / 1.25 ) - 0.5 );
    conc *= 1.0 - ( 1.0 - up ) * ( 1.0 - smoothstep( 0.46, 0.49, panel ) ) * 0.0 - ( 1.0 - up ) * smoothstep( 0.47, 0.5, panel ) * 0.18;
    conc *= 1.0 - ( 1.0 - up ) * smoothstep( 2.5, 0.0, p.y - texture2D( uNoise, p.xz * 0.02 ).r * 3.0 ) * 0.0;
    col = conc;
    cRough = mix( 0.88, 0.95, moss );
  } else {
    // rust
    col = mix( vec3( 0.16, 0.08, 0.04 ), vec3( 0.27, 0.15, 0.07 ), n3 ) * ( 0.7 + 0.4 * n1 );
    cRough = 0.75;
  }
  col *= mix( 1.0, 0.55, uWet );
  cRough = mix( cRough, 0.28, uWet * 0.85 );
  diffuseColor.rgb *= col;
}`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cRough;');
  };
  mat.customProgramCacheKey = () => 'apex-banking-concrete-v1';
  return mat;
}

export function buildBanking(o: OvalPath, track: Track, map: WorldMap, terrainMat: THREE.Material): BankingBuild {
  const group = new THREE.Group();
  group.name = 'Sopraelevata';
  const conc = new GB();
  const rust = new GB();
  const earth = new GB();
  const W = o.width;
  const n = o.n;
  const up = new THREE.Vector3(0, 1, 0);
  const P = new THREE.Vector3(), N = new THREE.Vector3(), Q = new THREE.Vector3();

  // track lateral of each sample near the bridge (to cut embankments and place the girder)
  const lat = new Float32Array(n).fill(1e4);
  const sOf = new Float32Array(n);
  for (let i = Math.max(0, o.bridgeU - 90); i < Math.min(n, o.bridgeU + 90); i++) {
    const pr = map.projectFast(o.x[i], o.z[i], Math.round(o.bridgeS), 60);
    lat[i] = pr.lat;
    sOf[i] = pr.s;
  }
  const [aL, aR] = o.abutLat;
  const inCorridor = (l: number) => l > aL && l < aR;
  // clamp a point that falls inside the track corridor back onto the abutment plane
  const cut = (p: THREE.Vector3) => {
    const pr = map.projectFast(p.x, p.z, Math.round(o.bridgeS), 80);
    if (!inCorridor(pr.lat)) return false;
    const target = pr.lat < (aL + aR) / 2 ? aL : aR;
    const q = track.point(pr.s, target, 0);
    p.x = q.x;
    p.z = q.z;
    return true;
  };

  // per-sample frame helpers
  const center = (i: number, out: THREE.Vector3) => out.set(o.x[i], 0, o.z[i]);
  const rightOf = (i: number, out: THREE.Vector3) => out.set(-o.tz[i], 0, o.tx[i]);
  const R = new THREE.Vector3();
  const C = new THREE.Vector3();
  /** point on the running surface at w (0 inner edge … W outer edge), plus height offset */
  const surf = (i: number, w: number, dy: number, out: THREE.Vector3) => {
    center(i, C);
    rightOf(i, R);
    out.copy(C).addScaledVector(R, W / 2 - w);
    out.y = o.base[i] + bankProfile(w, W, o.bank[i]) + dy;
    return out;
  };
  const along = (i: number) => i * OVAL_STEP;

  // ---------------------------------------------------------------- running surface (8 strips across) + slab underside
  const ACROSS = 8;
  {
    const rows: number[][] = [];
    const rowsU: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [], rowU: number[] = [];
      for (let k = 0; k <= ACROSS; k++) {
        const w = (k / ACROSS) * W;
        surf(i, w, 0, P);
        // normal from the profile slope
        const e = 0.25;
        const h1 = bankProfile(Math.min(W, w + e), W, o.bank[i]) - bankProfile(Math.max(0, w - e), W, o.bank[i]);
        rightOf(i, R);
        N.copy(R).multiplyScalar(h1 / (2 * e)).add(up).normalize();
        row.push(conc.v(P, N, along(i), w / W, o.intact[i], 0));
        surf(i, w, -SLAB, Q);
        rowU.push(conc.v(Q, N.clone().negate(), along(i), w / W, o.intact[i], 1));
      }
      rows.push(row);
      rowsU.push(rowU);
    }
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < ACROSS; k++) {
        conc.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]);
        conc.quad(rowsU[i][k], rowsU[i][k + 1], rowsU[i + 1][k + 1], rowsU[i + 1][k]);
      }
  }

  // ---------------------------------------------------------------- inner kerb, outer edge beam, skirts
  const tmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const inSpan = (i: number) => lat[i] > aL - 4 && lat[i] < aR + 4;
  for (let i = 0; i < n - 1; i++) {
    const j = i + 1;
    const spanned = inSpan(i) || inSpan(j);
    // inner edge: a skirt to the ground (or the girder over the bridge)
    const drop = (k: number, w: number, out: THREE.Vector3) => {
      surf(k, w, 0, out);
      const g = map.height(out.x, out.z) - 0.4;
      out.y = inCorridor(lat[k]) ? o.base[k] - DECK : Math.min(out.y - SLAB, Math.max(g, out.y - SLAB - 2.5));
      return out;
    };
    rightOf(i, R);
    for (const [w, sgn] of [[0, 1], [W, -1]] as [number, number][]) {
      if (spanned) break;
      const a = surf(i, w, -SLAB, tmp[0].clone()), b = surf(j, w, -SLAB, tmp[1].clone());
      const c = drop(j, w, tmp[2].clone()), d = drop(i, w, tmp[3].clone());
      // the outer skirt only where the slab is low (on curves the columns carry it)
      if (w === W && o.bank[i] > 0.15 && !inCorridor(lat[i])) {
        // edge beam 0.9 m deep
        c.copy(b).y -= 0.9;
        d.copy(a).y -= 0.9;
      }
      const nn = R.clone().multiplyScalar(sgn);
      const ids = [conc.v(a, nn, along(i), 0, o.intact[i], 1), conc.v(b, nn, along(j), 0, o.intact[j], 1), conc.v(c, nn, along(j), 1, o.intact[j], 1), conc.v(d, nn, along(i), 1, o.intact[i], 1)];
      if (sgn > 0) conc.quad(ids[0], ids[3], ids[2], ids[1]);
      else conc.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    // inner kerb (low lip)
    {
      const a = surf(i, 0.0, 0, new THREE.Vector3()), b = surf(j, 0.0, 0, new THREE.Vector3());
      const a2 = a.clone().setY(a.y + 0.22), b2 = b.clone().setY(b.y + 0.22);
      const nn = R.clone();
      const ids = [conc.v(a, nn, along(i), 0, o.intact[i], 1), conc.v(b, nn, along(j), 0, o.intact[j], 1), conc.v(b2, nn, along(j), 0.1, o.intact[j], 1), conc.v(a2, nn, along(i), 0.1, o.intact[i], 1)];
      conc.quad(ids[0], ids[3], ids[2], ids[1]);
    }
  }

  // ---------------------------------------------------------------- columns + cross beams under the banked curves
  let columns = 0;
  for (let i = 1; i < n - 1; i += 3) {
    if (o.bank[i] < 0.25 || o.intact[i] < 0.15) continue;
    rightOf(i, R);
    const T = new THREE.Vector3(o.tx[i], 0, o.tz[i]);
    for (const f of [0.42, 0.72, 0.98]) {
      const w = f * W;
      surf(i, w, -SLAB, P);
      const g = map.height(P.x, P.z) - 0.3;
      if (P.y - g < 1.0) continue;
      const hx = 0.28, hz = 0.36;
      const c: THREE.Vector3[] = [];
      for (const y of [g, P.y - 0.02])
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][])
          c.push(P.clone().setY(y).addScaledVector(R, sx * hx).addScaledVector(T, sz * hz));
      conc.boxFrom(c, along(i), o.intact[i], 1);
      columns++;
    }
    // cross beam under the slab from 0.35 W to the outer edge
    {
      const a = surf(i, 0.35 * W, -SLAB, new THREE.Vector3());
      const b = surf(i, W, -SLAB, new THREE.Vector3());
      const c: THREE.Vector3[] = [];
      const hz = 0.25;
      for (const y of [-0.55, -0.02])
        for (const [pt, sz] of [[a, -1], [b, -1], [b, 1], [a, 1]] as [THREE.Vector3, number][])
          c.push(pt.clone().setY(pt.y + y).addScaledVector(T, sz * hz));
      conc.boxFrom(c, along(i), o.intact[i], 1);
    }
  }

  // ---------------------------------------------------------------- parapet + guardrail (outer side; both sides over the bridge)
  let posts = 0;
  const parapet = (w: number, side: number) => {
    let run = 0;
    for (let i = 0; i < n - 1; i++) {
      const j = i + 1;
      const onBridgeApproach = Math.abs(i - o.bridgeU) < 70;
      if (side < 0 && !onBridgeApproach) continue;
      // crumbling: gaps, more of them near the abandoned ends
      const h = hash2i(Math.floor(i / 4), side, 91);
      if (h > o.intact[i] * 0.97 + 0.02 && !onBridgeApproach) {
        run = 0;
        continue;
      }
      run++;
      rightOf(i, R);
      const nOut = R.clone().multiplyScalar(-side);
      const a = surf(i, w, 0, new THREE.Vector3()), b = surf(j, w, 0, new THREE.Vector3());
      const Ht = 1.0;
      const th = 0.3;
      const a2 = a.clone().addScaledVector(nOut, th), b2 = b.clone().addScaledVector(nOut, th);
      const c = [a, b, b2, a2].map((q) => q.clone().setY(q.y - 0.02));
      for (const q of [a, b, b2, a2]) c.push(q.clone().setY(q.y + Ht));
      conc.boxFrom(c, along(i), o.intact[i], 1);
      // guardrail on the inner face
      if (i % 2 === 0) {
        const inW = w - side * 0.08;
        for (const hr of [0.55, 0.85]) {
          const p0 = surf(i, inW, hr, new THREE.Vector3()), p1 = surf(j + 1 < n ? j + 1 : j, inW, hr, new THREE.Vector3());
          const cc = [p0, p1, p1.clone().addScaledVector(R, side * 0.05), p0.clone().addScaledVector(R, side * 0.05)].map((q) => q.clone());
          for (const q of [p0, p1, p1.clone().addScaledVector(R, side * 0.05), p0.clone().addScaledVector(R, side * 0.05)]) cc.push(q.clone().setY(q.y + 0.12));
          rust.boxFrom(cc, along(i), o.intact[i], 2);
        }
        if (i % 4 === 0) {
          const p0 = surf(i, inW, 0, new THREE.Vector3());
          const T = new THREE.Vector3(o.tx[i], 0, o.tz[i]);
          const cc: THREE.Vector3[] = [];
          for (const y of [0, 0.95])
            for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][])
              cc.push(p0.clone().setY(p0.y + y).addScaledVector(R, sx * 0.05).addScaledVector(T, sz * 0.05));
          rust.boxFrom(cc, along(i), o.intact[i], 2);
          posts++;
        }
      }
    }
  };
  parapet(W, 1);
  parapet(0, -1);

  // ---------------------------------------------------------------- embankments to the bridge
  {
    let prev: number[] | null = null;
    for (let i = 0; i < n; i++) {
      const e = o.emb[i];
      if (e < 0.04 || inCorridor(lat[i])) {
        prev = null;
        continue;
      }
      rightOf(i, R);
      center(i, C);
      const topY = o.base[i] - SLAB;
      const hw = W / 2 + 0.2;
      const spread = e * 1.7 + 0.5;
      const pts = [
        C.clone().addScaledVector(R, hw + spread),
        C.clone().addScaledVector(R, hw),
        C.clone().addScaledVector(R, -hw),
        C.clone().addScaledVector(R, -hw - spread),
      ];
      const row: number[] = [];
      pts.forEach((q, k) => {
        const top = k === 1 || k === 2;
        cut(q);
        q.y = top ? topY : map.height(q.x, q.z) - 0.25;
        const nn = top ? up : R.clone().multiplyScalar(k === 0 ? 1 : -1).multiplyScalar(0.55).add(up).normalize();
        row.push(earth.v(q, nn, along(i), k / 3, 1, 0));
      });
      if (prev) for (let k = 0; k < 3; k++) earth.quad(prev[k], row[k], row[k + 1], prev[k + 1]);
      prev = row;
    }
  }

  // ---------------------------------------------------------------- bridge girder + abutments
  {
    // girder: side faces + soffit under the running surface across the corridor (± 4 m into the banks)
    for (let i = 0; i < n - 1; i++) {
      if (!inSpan(i) || !inSpan(i + 1)) continue;
      const j = i + 1;
      rightOf(i, R);
      for (const [w, sgn] of [[0, 1], [W, -1]] as [number, number][]) {
        const a = surf(i, w, -SLAB, new THREE.Vector3()), b = surf(j, w, -SLAB, new THREE.Vector3());
        const c = b.clone().setY(o.base[j] - DECK), d = a.clone().setY(o.base[i] - DECK);
        const nn = R.clone().multiplyScalar(sgn);
        const ids = [conc.v(a, nn, along(i), 0, 1, 1), conc.v(b, nn, along(j), 0, 1, 1), conc.v(c, nn, along(j), 1, 1, 1), conc.v(d, nn, along(i), 1, 1, 1)];
        if (sgn > 0) conc.quad(ids[0], ids[3], ids[2], ids[1]);
        else conc.quad(ids[0], ids[1], ids[2], ids[3]);
      }
      const a = surf(i, 0, 0, new THREE.Vector3()).setY(o.base[i] - DECK), b = surf(j, 0, 0, new THREE.Vector3()).setY(o.base[j] - DECK);
      const c = surf(j, W, 0, new THREE.Vector3()).setY(o.base[j] - DECK), d = surf(i, W, 0, new THREE.Vector3()).setY(o.base[i] - DECK);
      const nd = new THREE.Vector3(0, -1, 0);
      const ids = [conc.v(a, nd, along(i), 0, 1, 1), conc.v(b, nd, along(j), 0, 1, 1), conc.v(c, nd, along(j), 1, 1, 1), conc.v(d, nd, along(i), 1, 1, 1)];
      conc.quad(ids[0], ids[1], ids[2], ids[3]);
      // soffit ribs every 4 m
      if (i % 2 === 0) {
        const T = new THREE.Vector3(o.tx[i], 0, o.tz[i]);
        const cc: THREE.Vector3[] = [];
        const y0 = o.base[i] - DECK;
        for (const y of [y0 - 0.45, y0 + 0.01])
          for (const [q, sz] of [[a, -1], [d, -1], [d, 1], [a, 1]] as [THREE.Vector3, number][]) cc.push(q.clone().setY(y).addScaledVector(T, sz * 0.2));
        conc.boxFrom(cc, along(i), 1, 1);
      }
    }
    // abutment walls along the track, behind each barrier
    for (const la of [aL, aR]) {
      const side = Math.sign(la);
      // find where the oval centreline crosses this line
      let sc = o.bridgeS, best = Infinity;
      for (let s = o.bridgeS - 60; s <= o.bridgeS + 60; s += 0.5) {
        const q = track.point(s, la, 0);
        const d = map.ovalNear(q.x, q.z).d;
        if (d < best) { best = d; sc = s; }
      }
      const wall: { s: number; top: number; g: number }[] = [];
      for (let s = sc - 45; s <= sc + 45; s += 1) {
        const q = track.point(s, la, 0);
        const on = map.ovalNear(q.x, q.z);
        if (on.i < 0) continue;
        const k = on.i;
        const hw = W / 2 + 0.2;
        const e = o.emb[k];
        const spread = e * 1.7 + 0.5;
        const g = track.heightAt(s) - 0.3;
        let top: number;
        if (on.d <= hw + 2) top = o.base[k] + 0.15;
        else if (on.d <= hw + spread + 1.5) top = Math.max(g + 0.3, o.base[k] - SLAB - (on.d - hw - 2) / spread * (o.base[k] - SLAB - g) + 0.5);
        else continue;
        wall.push({ s, top, g });
      }
      for (let q = 0; q < wall.length - 1; q++) {
        const A = wall[q], B = wall[q + 1];
        const pa = track.point(A.s, la, 0), pb = track.point(B.s, la, 0);
        const pa2 = track.point(A.s, la + side * 1.2, 0), pb2 = track.point(B.s, la + side * 1.2, 0);
        const c = [pa.setY(A.g), pb.setY(B.g), pb2.setY(B.g), pa2.setY(A.g)];
        for (const [v, t] of [[pa, A.top], [pb, B.top], [pb2, B.top], [pa2, A.top]] as [THREE.Vector3, number][]) c.push(v.clone().setY(t));
        conc.boxFrom(c, A.s, 1, 1);
      }
    }
  }

  // ---------------------------------------------------------------- banners on the bridge faces
  const banner = new GB();
  {
    const tex = sponsorTexture();
    void tex;
    for (const [w, sgn, k] of [[0, 1, 0], [W, -1, 15]] as [number, number, number][]) {
      // the stretch of girder over the road itself
      let i0 = -1, i1 = -1;
      for (let i = 0; i < n; i++) if (lat[i] > aL + 4 && lat[i] < aR - 4) { if (i0 < 0) i0 = i; i1 = i; }
      if (i0 < 0) continue;
      const mid = Math.round((i0 + i1) / 2);
      const half = Math.min(12, Math.floor((i1 - i0) / 2) - 1);
      const a0 = mid - half, a1 = mid + half;
      rightOf(mid, R);
      const off = R.clone().multiplyScalar(sgn * 0.06);
      const uvr = sponsorUV(k);
      const E0 = surf(a0, w, -SLAB - 0.25, new THREE.Vector3()).add(off);
      const E1 = surf(a1, w, -SLAB - 0.25, new THREE.Vector3()).add(off);
      const nn = R.clone().multiplyScalar(sgn);
      // the viewer's right when facing this side of the girder
      const rightV = new THREE.Vector3().crossVectors(up, nn);
      const [Lp, Rp] = E1.clone().sub(E0).dot(rightV) > 0 ? [E0, E1] : [E1, E0];
      const ids = [
        banner.v(Lp.clone().setY(Lp.y - 1.45), nn, 0, 0, 1, 0, uvr[0], uvr[1]),
        banner.v(Rp.clone().setY(Rp.y - 1.45), nn, 0, 0, 1, 0, uvr[2], uvr[1]),
        banner.v(Rp, nn, 0, 0, 1, 0, uvr[2], uvr[3]),
        banner.v(Lp, nn, 0, 0, 1, 0, uvr[0], uvr[3]),
      ];
      banner.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  const cmat = concreteMaterial();
  const add = (b: GB, mat: THREE.Material, name: string, cast: boolean) => {
    if (b.pos.length === 0) return;
    const m = new THREE.Mesh(b.geometry(), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(conc, cmat, 'banking_concrete', true);
  add(rust, cmat, 'banking_rails', false);
  add(earth, terrainMat, 'banking_embankment', false);
  const bannerMat = new THREE.MeshStandardMaterial({ map: sponsorTexture(), roughness: 0.6, emissiveMap: sponsorTexture(), emissive: 0xffffff, emissiveIntensity: 0.12, side: THREE.DoubleSide });
  add(banner, bannerMat, 'banking_banners', false);

  void BANK_RISE;
  return { group, stats: { samples: n, columns, posts, bridgeS: Math.round(o.bridgeS), deckClearance: +(o.deckBottom - o.roadY).toFixed(2) } };
}
