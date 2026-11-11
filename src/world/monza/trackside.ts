import * as THREE from 'three';
import type { Renderer } from '../../core/Renderer.ts';
import { SURF, VERGE, GRAVEL_EDGE, type Track } from '../Track.ts';
import type { Trackside, TracksideStats } from '../TrackMesh.ts';
import { monzaAssets } from './assets.ts';
import { Buckets, Geo } from './geo.ts';
import { TILE, asphaltMaterial, concreteMaterial, fenceMaterial, grassMaterial, gravelMaterial, kerbMaterial, paintedSteel, steelMaterial, tyreWallMaterial } from './materials.ts';

/**
 * Monza, built from the ground up (2026-11-10). Everything between the barriers and the barriers
 * themselves: the road ribbon from the surveyed centreline, the kerbs, the strip behind them, the
 * run-offs the physics says are there (grass, gravel beds, asphalt), triple guard rail with its
 * posts, the pit-straight wall, debris fences where the crowd is close, tyre barriers at the end of
 * the traps, the start gantry and its five lights, the line, the grid, the braking boards and the
 * boards on the fences. Its own geometry, its own materials (materials.ts), its own pictures
 * (assets.ts) — nothing from the circuits that came before. The pit lane, wall and garages are the
 * pit complex's (PitComplex.ts), which the pit stops and the garage menu run on.
 */

const STEP = 2;
const CHUNK = 240;

/** fictional trackside names for the fence boards (new for this circuit) */
const BOARDS: [string, string, string][] = [
  ['APEX GP', '#0b0c0f', '#ffffff'],
  ['MONZA', '#0f7a3c', '#ffffff'],
  ['CORSA OIL', '#f3c613', '#16161a'],
  ['BRERA CAFFÈ', '#5a1f17', '#f4e9d8'],
  ['NORDLICHT', '#0e3a8a', '#e9f1ff'],
  ['FULMINE', '#d21f26', '#ffffff'],
  ['ASTRA TYRES', '#111114', '#f2d21b'],
  ['LOMBARDA BANCA', '#f1f1ee', '#13325b'],
];

function boardAtlas(aniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  BOARDS.forEach(([name, bg, fg], i) => {
    const y = i * 128;
    g.fillStyle = bg;
    g.fillRect(0, y, 1024, 128);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // (two boards' worth across: the name twice, so one 10 m panel reads from a distance)
    g.font = 'italic 800 78px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.fillText(name, 256, y + 68, 470);
    g.fillText(name, 768, y + 68, 470);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, y, 1024, 3);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y + 125, 1024, 3);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function numeralTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 192;
  const g = c.getContext('2d')!;
  ['150', '100', '50'].forEach((n, i) => {
    g.fillStyle = '#f2f2ee';
    g.fillRect(i * 128, 0, 128, 192);
    g.strokeStyle = '#111';
    g.lineWidth = 6;
    g.strokeRect(i * 128 + 5, 5, 118, 182);
    g.fillStyle = '#111';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 74px Arial, sans-serif';
    g.fillText(n, i * 128 + 64, 100, 108);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chequerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = (x + y) % 2 ? '#0c0c0d' : '#e8e8e4';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function* monzaTracksideBuilder(track: Track, gfx: Renderer): Generator<void, Trackside & { stats: TracksideStats }, void> {
  const t0 = performance.now();
  const A = monzaAssets(gfx.maxAnisotropy);
  const n = track.n;
  const def = track.def;
  const defCorners = def.corners ?? [];
  const group = new THREE.Group();
  group.name = 'trackside';

  // ------------------------------------------------------------------ the lap's frame, a point at a time
  const P = (i: number, lat: number, lift = 0, out = new THREE.Vector3()) => {
    // (a fraction of a metre past a sample runs on along its tangent)
    const fl = Math.floor(i), f = i - fl;
    const j = ((fl % n) + n) % n;
    return out.set(track.px[j] + track.rx[j] * lat + track.ux[j] * lift + track.tx[j] * f, track.py[j] + track.ry[j] * lat + track.uy[j] * lift + track.ty[j] * f, track.pz[j] + track.rz[j] * lat + track.uz[j] * lift + track.tz[j] * f);
  };
  const ix = (i: number) => ((Math.floor(i) % n) + n) % n;
  const up = (i: number, out = new THREE.Vector3()) => out.set(track.ux[ix(i)], track.uy[ix(i)], track.uz[ix(i)]);
  const right = (i: number, out = new THREE.Vector3()) => out.set(track.rx[ix(i)], track.ry[ix(i)], track.rz[ix(i)]);
  const fwd = (i: number, out = new THREE.Vector3()) => out.set(track.tx[ix(i)], track.ty[ix(i)], track.tz[ix(i)]);
  const inPit = (i: number, side: number) => side === track.pit.side && i >= track.pit.sStart - 1 && i <= track.pit.sEnd + 1;
  const inSpan = (i: number, a: number, b: number) => {
    const w = (v: number) => ((v % n) + n) % n;
    const x = w(i), lo = w(a), hi = w(b);
    return lo <= hi ? x >= lo && x <= hi : x >= lo || x <= hi;
  };

  // how hard the tyres work each metre (the rubber they leave): the corners, and the braking zones into them
  const rub = new Float32Array(n);
  for (let i = 0; i < n; i++) rub[i] = 0.5 + 0.5 * Math.min(1, Math.abs(track.kappa[i]) * 70);
  for (const c of defCorners) {
    const len = (c as { brakeLen?: number }).brakeLen ?? 0;
    const k = (c as { brake?: number }).brake ?? 0;
    if (!len || !k) continue;
    for (let d = -len - 40; d <= 20; d++) {
      const i = (((Math.round(c.at) + d) % n) + n) % n;
      const ramp = d < -len ? (d + len + 40) / 40 : 1;
      rub[i] = Math.max(rub[i], 0.55 + 0.6 * k * ramp);
    }
  }
  {
    // (a 30 m running mean: the line does not switch on and off)
    const src = rub.slice();
    let acc = 0;
    const R = 15;
    for (let d = -R; d <= R; d++) acc += src[((d % n) + n) % n];
    for (let i = 0; i < n; i++) {
      rub[i] = acc / (2 * R + 1);
      acc += src[(i + R + 1) % n] - src[(((i - R) % n) + n) % n];
    }
  }

  const B = new Buckets(CHUNK);
  const tmp = new THREE.Vector3();
  const U = new THREE.Vector3();
  const rows: number[] = [];
  for (let i = 0; i < n; i += STEP) rows.push(i);
  rows.push(n);

  // ------------------------------------------------------------------ the ground between the barriers
  type Col = { lat: number; lift: number; u: number; trk: [number, number, number, number]; k: [number, number, number, number] };
  const strip = (mat: string, i0: number, i1: number, c0: Col[], c1: Col[]) => {
    const g = B.at(mat, i0);
    const base = g.count;
    for (const [i, cols] of [[i0, c0], [i1, c1]] as const) {
      up(i, U);
      for (const c of cols) g.vert(P(i, c.lat, c.lift, tmp), U, c.u, i / (mat === 'gravel' ? TILE.gravel : mat === 'kerb' ? TILE.concrete : mat === 'asphalt' ? TILE.asphalt : TILE.grass), [c.trk[0], i, c.trk[2], c.trk[3]], c.k);
    }
    const m = c0.length;
    for (let c = 0; c + 1 < m; c++) g.quad(base + c, base + c + 1, base + m + c + 1, base + m + c, U);
  };

  const roadCols = (i: number): Col[] => {
    const j = i % n;
    const hw = track.halfWidth[j], rl = track.racingLine[j];
    return [-hw, 0, hw].map((lat) => ({ lat, lift: 0, u: lat / TILE.asphalt, trk: [lat, 0, lat - rl, hw - Math.abs(lat)], k: [0, rub[j], 0, 0] }) as Col);
  };
  const sideAt = (i: number, side: number) => {
    const j = i % n;
    const hw = track.halfWidth[j];
    const kw = side < 0 ? track.kerbL[j] : track.kerbR[j];
    const bar = side < 0 ? track.barrierL[j] : track.barrierR[j];
    const ro = side < 0 ? track.runoffL[j] : track.runoffR[j];
    return { hw, kw, bar, ro, a3: hw + kw + VERGE };
  };

  for (let r = 0; r + 1 < rows.length; r++) {
    const i0 = rows[r], i1 = rows[r + 1];
    strip('asphalt', i0, i1, roadCols(i0), roadCols(i1));
    for (const side of [-1, 1]) {
      if (inPit(i0, side) || inPit(i1 % n, side)) continue;
      const a = sideAt(i0, side), b = sideAt(i1, side);
      const kerb = a.kw > 0.05 && b.kw > 0.05;
      const j0 = i0 % n, j1 = i1 % n;
      if (kerb) {
        const kc = (q: typeof a, j: number): Col[] =>
          [
            [0, 0.0],
            [0.55, 0.036],
            [1, 0.022],
          ].map(([u, lift]) => ({ lat: side * (q.hw + u * q.kw), lift, u: (u * q.kw) / TILE.concrete, trk: [u, 0, 0, 0], k: [0, rub[j], 0, 0] }) as Col);
        strip('kerb', i0, i1, kc(a, j0), kc(b, j1));
      }
      // the strip behind the kerb (or the road's shoulder)
      const vc = (q: typeof a, hasKerb: boolean): Col[] => [
        { lat: side * (q.hw + q.kw), lift: hasKerb ? 0.022 : 0, u: (side * (q.hw + q.kw)) / TILE.asphalt, trk: [side * (q.hw + q.kw), 0, 0, -q.kw], k: [1, 0, hasKerb ? 1 : 0, 0] },
        { lat: side * q.a3, lift: 0, u: (side * q.a3) / TILE.asphalt, trk: [side * q.a3, 0, 0, -q.kw - VERGE], k: [1, 0, hasKerb ? 1 : 0, 0] },
      ];
      const vergeOut = (q: typeof a) => Math.min(q.a3, q.bar - 0.05);
      if (vergeOut(a) > a.hw + a.kw + 0.2) strip('asphalt', i0, i1, vc(a, kerb), vc(b, kerb));
      if (a.bar - a.a3 < 0.4 || b.bar - b.a3 < 0.4) continue;
      const flat = (q: typeof a, from: number, to: number, zone: number, dip = 0): Col[] => {
        const mid = (from + to) / 2;
        return [from, mid, to].map((x, m) => ({ lat: side * x, lift: m === 1 ? dip : 0, u: (side * x) / (zone === 3 ? TILE.gravel : zone === 2 ? TILE.asphalt : TILE.grass), trk: [side * x, 0, 0, 0], k: [zone === 2 ? 2 : 0, 0, x - q.a3, 0] }) as Col);
      };
      if (a.ro === SURF.ASPHALT) strip('asphalt', i0, i1, flat(a, a.a3, a.bar, 2), flat(b, b.a3, b.bar, 2));
      else if (a.ro === SURF.GRAVEL && a.bar - GRAVEL_EDGE > a.a3 + 1.5 && b.bar - GRAVEL_EDGE > b.a3 + 1.5) {
        strip('gravel', i0, i1, flat(a, a.a3, a.bar - GRAVEL_EDGE, 3, -0.04), flat(b, b.a3, b.bar - GRAVEL_EDGE, 3, -0.04));
        strip('verge', i0, i1, flat(a, a.bar - GRAVEL_EDGE, a.bar, 0), flat(b, b.bar - GRAVEL_EDGE, b.bar, 0));
      } else strip('verge', i0, i1, flat(a, a.a3, a.bar, 0), flat(b, b.a3, b.bar, 0));
    }
  }
  yield;

  // ------------------------------------------------------------------ barriers
  const cornerOf = (i: number, side: number, before: number, after: number) => track.corners.findIndex((c) => c.dir === side && inSpan(i, c.sStart - before, c.sEnd + after));
  const runs = def.trackside?.runs ?? [];
  const concreteAt = (i: number, side: number) => runs.some((r) => r.side === side && r.kind === 'concrete' && inSpan(i, r.from, r.to));
  const fenced = (i: number, side: number) => concreteAt(i, side) || cornerOf(i, side, 90, 140) >= 0;
  const N = new THREE.Vector3();
  const railProfile: [number, number][] = [];
  for (const yc of [0.36, 0.67, 0.98]) railProfile.push([0, yc - 0.15], [-0.05, yc - 0.09], [-0.012, yc], [-0.05, yc + 0.09], [0, yc + 0.15]);
  const posts: THREE.Matrix4[] = [];
  const fencePosts: THREE.Matrix4[] = [];
  const mtx = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const frameAt = (i: number, lat: number, lift: number, side: number) => {
    // x = away from the track, y = up, z = along the lap
    right(i, X).multiplyScalar(side);
    up(i, Y);
    fwd(i, Z);
    return mtx.makeBasis(X, Y, Z).setPosition(P(i, lat, lift, tmp)).clone();
  };
  let boardSlot = 0;
  for (const side of [-1, 1]) {
    for (let r = 0; r + 1 < rows.length; r++) {
      const i0 = rows[r], i1 = rows[r + 1];
      if (inPit(i0, side) || inPit(i1 % n, side)) continue;
      const b0 = sideAt(i0, side).bar, b1 = sideAt(i1, side).bar;
      const conc = concreteAt(i0, side);
      if (conc) {
        // the wall: 1.05 m of cast concrete, 0.25 m thick, with a coping
        const g = B.at('concrete', i0);
        for (const [face, d0, d1, y0, y1] of [
          [-1, 0, 0, 0, 1.05],
          [0, 0, 0.25, 1.05, 1.05],
          [1, 0.25, 0.25, 1.05, 0],
        ] as const) {
          right(i0, N).multiplyScalar(face === 0 ? 0 : face * side);
          if (face === 0) up(i0, N);
          else N.multiplyScalar(-1);
          const v = [
            g.vert(P(i0, side * (b0 + d0), y0, tmp), N, i0 / TILE.concrete, y0 / TILE.concrete, [1.05 - y0, i0, 0, 0]),
            g.vert(P(i1, side * (b1 + d0), y0, tmp), N, i1 / TILE.concrete, y0 / TILE.concrete, [1.05 - y0, i1, 0, 0]),
            g.vert(P(i1, side * (b1 + d1), y1, tmp), N, i1 / TILE.concrete, (y1 + d1) / TILE.concrete, [1.05 - y1, i1, 0, 0]),
            g.vert(P(i0, side * (b0 + d1), y1, tmp), N, i0 / TILE.concrete, (y1 + d1) / TILE.concrete, [1.05 - y1, i0, 0, 0]),
          ];
          g.quad(v[0], v[1], v[2], v[3], N);
        }
      } else {
        // triple guard rail: three W-beams, their posts behind them every 4 m
        const g = B.at('steel', i0);
        const base = g.count;
        for (const [i, bb] of [[i0, b0], [i1, b1]] as const) {
          right(i, N).multiplyScalar(-side);
          for (const [d, y] of railProfile) g.vert(P(i, side * (bb + d), y, tmp), N, i / 2, y);
        }
        const m = railProfile.length;
        for (let c = 0; c + 1 < m; c++) if (c % 5 !== 4) g.quad(base + c, base + c + 1, base + m + c + 1, base + m + c, N);
        if (i0 % 4 === 0) posts.push(frameAt(i0, side * (b0 + 0.06), 0, side));
      }
      if (fenced(i0, side)) {
        // debris fence above the barrier, its posts cranked in toward the track at the top
        const g = B.at('fence', i0);
        const y0 = conc ? 1.05 : 1.15, y1 = 4.3, off = conc ? 0.12 : 0.3;
        right(i0, N).multiplyScalar(-side);
        const v = [
          g.vert(P(i0, side * (b0 + off), y0, tmp), N, i0 / 0.4, y0 / 0.4),
          g.vert(P(i1, side * (b1 + off), y0, tmp), N, i1 / 0.4, y0 / 0.4),
          g.vert(P(i1, side * (b1 + off), y1, tmp), N, i1 / 0.4, y1 / 0.4),
          g.vert(P(i0, side * (b0 + off), y1, tmp), N, i0 / 0.4, y1 / 0.4),
        ];
        g.quad(v[0], v[1], v[2], v[3], N);
        if (i0 % 4 === 0) fencePosts.push(frameAt(i0, side * (b0 + off + 0.04), 0, side));
        // a board on the fence every 12 m
        if (i0 % 12 === 0 && r + 5 < rows.length) {
          const i2 = rows[r + 5];
          const gb = B.at('boards', i0);
          const row = boardSlot++ % BOARDS.length;
          const bb2 = sideAt(i2, side).bar;
          const u0 = side < 0 ? 0 : 1, u1 = 1 - u0;
          const w = [
            gb.vert(P(i0, side * (b0 + off - 0.03), y0 + 0.08, tmp), N, u0, 1 - (row + 1) / 8),
            gb.vert(P(i2, side * (bb2 + off - 0.03), y0 + 0.08, tmp), N, u1, 1 - (row + 1) / 8),
            gb.vert(P(i2, side * (bb2 + off - 0.03), y0 + 1.0, tmp), N, u1, 1 - row / 8),
            gb.vert(P(i0, side * (b0 + off - 0.03), y0 + 1.0, tmp), N, u0, 1 - row / 8),
          ];
          gb.quad(w[0], w[1], w[2], w[3], N);
        }
      }
      // tyres in front of the barrier where a trap ends against it
      const ci = cornerOf(i0, side, 20, 60);
      if (ci >= 0 && !conc) {
        const front = (defCorners[ci] as { front?: string } | undefined)?.front;
        const g = B.at(front === 'tecpro' ? 'tecpro' : 'tyres', i0);
        const d = 0.72;
        right(i0, N).multiplyScalar(-side);
        up(i0, U);
        const f = [
          g.vert(P(i0, side * (b0 - d), 0, tmp), N, i0 / 2.48, 0),
          g.vert(P(i1, side * (b1 - d), 0, tmp), N, i1 / 2.48, 0),
          g.vert(P(i1, side * (b1 - d + 0.05), 1.0, tmp), N, i1 / 2.48, 1),
          g.vert(P(i0, side * (b0 - d + 0.05), 1.0, tmp), N, i0 / 2.48, 1),
        ];
        g.quad(f[0], f[1], f[2], f[3], N);
        const t = [
          g.vert(P(i0, side * (b0 - d + 0.05), 1.0, tmp), U, i0 / 2.48, 0.02),
          g.vert(P(i1, side * (b1 - d + 0.05), 1.0, tmp), U, i1 / 2.48, 0.02),
          g.vert(P(i1, side * (b1 - 0.08), 1.0, tmp), U, i1 / 2.48, 0.24),
          g.vert(P(i0, side * (b0 - 0.08), 1.0, tmp), U, i0 / 2.48, 0.24),
        ];
        g.quad(t[0], t[1], t[2], t[3], U);
      }
    }
  }
  yield;

  // ------------------------------------------------------------------ paint and furniture
  const startI = Math.round(track.startS) % n;
  const white = new THREE.MeshStandardMaterial({ map: A.paint, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  {
    // the grid: a bracket for each of 22 cars, and the line itself
    const g = new Geo();
    const slab = (s: number, lat0: number, lat1: number, len: number) => {
      const i = Math.round(s);
      up(i, U);
      const v = [
        g.vert(P(i, lat0, 0.006, tmp), U, lat0 / 2, 0),
        g.vert(P(i, lat1, 0.006, tmp), U, lat1 / 2, 0),
        g.vert(P(i + len, lat1, 0.006, tmp), U, lat1 / 2, len / 2),
        g.vert(P(i + len, lat0, 0.006, tmp), U, lat0 / 2, len / 2),
      ];
      g.quad(v[0], v[1], v[2], v[3], U);
    };
    for (let k = 0; k < 22; k++) {
      const q = track.gridSlot(k);
      const front = q.s + 2.9;
      slab(front, q.lateral - 1.25, q.lateral + 1.25, 0.14);
      slab(front - 1.2, q.lateral - 1.25, q.lateral - 1.11, 1.2);
      slab(front - 1.2, q.lateral + 1.11, q.lateral + 1.25, 1.2);
    }
    const mesh = new THREE.Mesh(g.build(), white);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    group.add(mesh);
    const hw = track.halfWidth[startI];
    const lg = new Geo();
    up(startI, U);
    const v = [
      lg.vert(P(startI, -hw, 0.007, tmp), U, 0, 0),
      lg.vert(P(startI, hw, 0.007, tmp), U, (2 * hw) / 4.8, 0),
      lg.vert(P(startI + 1, hw, 0.007, tmp), U, (2 * hw) / 4.8, 1),
      lg.vert(P(startI + 1, -hw, 0.007, tmp), U, 0, 1),
    ];
    lg.quad(v[0], v[1], v[2], v[3], U);
    const line = new THREE.Mesh(lg.build(), new THREE.MeshStandardMaterial({ map: chequerTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    line.receiveShadow = true;
    line.renderOrder = 2;
    group.add(line);
  }

  // the gantry over the line: two legs, a truss, five lamp units facing the grid
  const dark = paintedSteel(0x15161a, 0.5);
  const lamps: THREE.MeshStandardMaterial[] = [];
  {
    const hw = track.halfWidth[startI];
    const legL = -(hw + 1.6), legR = hw + 1.6;
    const g = new Geo();
    right(startI, X);
    up(startI, Y);
    fwd(startI, Z);
    const at = (lat: number, y: number, z: number) => P(startI, lat, y, new THREE.Vector3()).addScaledVector(Z, z);
    for (const lat of [legL, legR]) g.box(at(lat - 0.18, 0, 6.0 - 0.18), X, Y, Z, 0.36, 7.4, 0.36);
    // (a boxed truss: two chords and the lacing between them)
    for (const y of [6.6, 7.4]) g.box(at(legL, y - 0.07, 6.0 - 0.3), X, Y, Z, legR - legL, 0.14, 0.14);
    for (const y of [6.6, 7.4]) g.box(at(legL, y - 0.07, 6.0 + 0.16), X, Y, Z, legR - legL, 0.14, 0.14);
    for (let x = legL; x < legR - 0.4; x += 0.9) g.box(at(x, 6.6, 6.0 - 0.3), X, Y, Z, 0.07, 0.8, 0.07);
    const frame = new THREE.Mesh(g.build(), dark);
    frame.castShadow = true;
    group.add(frame);
    for (let k = 0; k < 5; k++) {
      const lat = (k - 2) * 1.5;
      const hg = new Geo();
      hg.box(at(lat - 0.42, 5.55, 6.0 - 0.32), X, Y, Z, 0.84, 1.0, 0.2);
      const house = new THREE.Mesh(hg.build(), dark);
      group.add(house);
      const lm = new THREE.MeshStandardMaterial({ color: 0x1a0606, emissive: new THREE.Color(3.4, 0.1, 0.06), emissiveIntensity: 0, roughness: 0.4 });
      lamps.push(lm);
      for (const y of [5.82, 6.28]) {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), lm);
        disc.position.copy(at(lat, y, 6.0 - 0.33));
        // facing back down the grid
        disc.lookAt(disc.position.clone().addScaledVector(Z, -1));
        group.add(disc);
      }
    }
  }

  // braking boards into the big stops: 150 / 100 / 50 on the outside
  {
    const g = new Geo();
    track.corners.forEach((c, ci) => {
      const dc = defCorners[ci] as { brake?: number; at: number } | undefined;
      if (!dc || (dc.brake ?? 0) < 0.5) return;
      [150, 100, 50].forEach((d, k) => {
        const i = (((Math.round(dc.at) - d) % n) + n) % n;
        const side = c.dir;
        if (inPit(i, side)) return;
        const q = sideAt(i, side);
        const lat = side * Math.min(q.a3 + 1.2, q.bar - 0.6);
        right(i, X).multiplyScalar(-side);
        up(i, Y);
        fwd(i, Z);
        // (faces the cars coming: its normal is back down the lap)
        const o = P(i, lat, 0.5, new THREE.Vector3());
        const a = o.clone().addScaledVector(X, -0.4), b = o.clone().addScaledVector(X, 0.4);
        const nrm = Z.clone().negate();
        const u0 = k / 3, u1 = (k + 1) / 3;
        const v = [g.vert(a, nrm, side < 0 ? u0 : u1, 0), g.vert(b, nrm, side < 0 ? u1 : u0, 0), g.vert(b.clone().addScaledVector(Y, 1.1), nrm, side < 0 ? u1 : u0, 1), g.vert(a.clone().addScaledVector(Y, 1.1), nrm, side < 0 ? u0 : u1, 1)];
        g.quad(v[0], v[1], v[2], v[3], nrm);
      });
    });
    if (g.count) {
      const mesh = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ map: numeralTexture(), roughness: 0.6, side: THREE.DoubleSide }));
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  // posts (instanced)
  const steel = steelMaterial();
  const addPosts = (list: THREE.Matrix4[], geo: THREE.BufferGeometry, mat: THREE.Material) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
  };
  addPosts(posts, new THREE.BoxGeometry(0.09, 1.2, 0.07).translate(0, 0.6, 0), steel);
  {
    // a fence post: 4.3 m of tube, the top 0.7 m cranked 0.45 m toward the track
    const pg = new Geo();
    pg.box(new THREE.Vector3(-0.035, 0, -0.035), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 0.07, 3.7, 0.07);
    pg.box(new THREE.Vector3(-0.035, 3.7, -0.035), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.54, 0.84, 0).normalize(), new THREE.Vector3(0, 0, 1), 0.07, 0.82, 0.07);
    addPosts(fencePosts, pg.build(), paintedSteel(0x3b4046, 0.6));
  }

  const tecpro = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    ['#c9281f', '#d9d9d4', '#1f4fa8', '#d9d9d4'].forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(i * 64, 0, 64, 64);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(i * 64, 0, 2, 64);
      g.fillRect(i * 64, 30, 64, 2);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  })();
  const tris = B.finish(group, {
    asphalt: { material: asphaltMaterial(A) },
    kerb: { material: kerbMaterial(A) },
    verge: { material: grassMaterial(A, false) },
    gravel: { material: gravelMaterial(A) },
    concrete: { material: concreteMaterial(A), cast: true },
    steel: { material: steel, cast: true },
    fence: { material: fenceMaterial(A), receive: false, order: 3 },
    boards: { material: new THREE.MeshStandardMaterial({ map: boardAtlas(gfx.maxAnisotropy), roughness: 0.6, metalness: 0, side: THREE.DoubleSide }), cast: true },
    tyres: { material: tyreWallMaterial(), cast: true },
    tecpro: { material: tecpro, cast: true },
  });
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
  yield;

  const stats: TracksideStats = { buildMs: performance.now() - t0, meshes: group.children.length, triangles: tris, chunks: Math.ceil(n / CHUNK), byKey: {}, phases: {} };
  return {
    group,
    stats,
    startLights: {
      set(lit: number) {
        const k = Math.max(0, Math.min(5, Math.round(lit)));
        lamps.forEach((m, i) => (m.emissiveIntensity = i < k ? 1 : 0));
      },
    },
    update() {},
  };
}
