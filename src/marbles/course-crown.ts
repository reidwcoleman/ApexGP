import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CourseBuilder } from './builder.ts';
import { GRAVITY, Kin, Mat, Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';
import { makeCrown } from './course-kit.ts';
import { addStrikes, type Hit3, type Strikes } from './course-strikes.ts';

/**
 * Crown Keeper, the other final: a castle in the sky at dusk and one crown. Hold it for KEEP.hold
 * seconds in all and you win the show. The keep in the middle is the high ground: every so often its
 * throne goes hot and the crown's clock runs double up there, right until it blows everyone off the
 * top. So the holder has a gamble to make, and everyone can come for them: up the four carpets, off
 * the hop pads, or flung the long way round via the drums out past the walls. A dive knocks the
 * crown flying (catch it if you can), a grab takes it, and so does going over.
 *
 * The round closes in as it goes: sweepers on the outer courtyard, then cannon fire, then the outer
 * courtyard itself breaks away chunk by chunk. All of that is a function of the clock, so every
 * browser agrees without a word; who holds the crown is the host's to say (modes.ts).
 */
export const KEEP = {
  /** the courtyard's edge, the keep's top (radius, height), where the carpets meet the courtyard, and the line the outer courtyard breaks along */
  R: 20,
  keepR: 6.6,
  top: 3.4,
  foot: 13,
  rim: 12.9,
  rampW: 4.4,
  /** seconds to win, the clock, the most overtime */
  hold: 30,
  T: 150,
  over: 25,
  /** how near you take it, a dive's reach, how long a new holder can't lose it */
  pick: 1.7,
  steal: 1.9,
  safe: 1.6,
  /** a new holder's burst of speed */
  zoomK: 1.24,
  /** the throne's clock */
  throne: 2,
  /** the throne's blast: nobody sits up there for ever */
  blastAt: 21,
  blastGap: 15,
  /** the throne is hot (the clock runs double there) this long before each blast */
  hotT: 6.5,
  barAt: 18,
  barV: 0.85,
  cannonAt: 42,
  fallAt: 78,
  fallGap: 3,
  /** a chunk shakes this long before it goes */
  warn: 2.2,
  /** a holder's a step slower than the rest, and slower the nearer the win */
  carry: 0.94,
  heavy: 0.13,
  /** everyone else's speed once a holder's past halfway */
  rally: 1.1,
  /** a crown left lying this long flies home */
  stale: 9,
};

/** what happens when, for the announcer */
export const KEEP_PHASES: { at: number; text: string; sub: string }[] = [
  { at: KEEP.barAt, text: 'SWEEPERS!', sub: 'Hop the bars on the outer courtyard' },
  { at: KEEP.cannonAt, text: 'CANNONS!', sub: 'Watch the gold rings' },
  { at: KEEP.fallAt, text: 'THE WALLS ARE FALLING!', sub: 'Get in towards the keep' },
];

export interface KeepPad {
  x: number;
  y: number;
  z: number;
  r: number;
  to: THREE.Vector3;
  T: number;
  kind: 'hop' | 'fling' | 'drum';
  hit: number;
}

export interface KeepArena {
  center: THREE.Vector3;
  R: number;
  /** who has the crown (a bean id, -1: it's lying loose) */
  holder: number;
  /** where it's lying, or going to land */
  x: number;
  z: number;
  /** world time a new holder's burst runs out */
  zoomT: number;
  /** how far the holder's clock has got (0..1): it slows them */
  share: number;
  /** the sweepers' angle at x seconds after the off (null: not out) */
  bar(x: number): number | null;
  /** the carpets' angles */
  ramps: number[];
  pads: KeepPad[];
  shots: Strikes;
  /** the throne clearing itself */
  blast: Strikes;
  /** is the throne hot, x seconds after the off? */
  hot(x: number): boolean;
  /** the floor's height at a spot (the keep, the carpets, the courtyard) */
  groundAt(x: number, z: number): number;
  /** floor here at this world time? */
  solid(x: number, z: number, t: number): boolean;
  onTop(p: THREE.Vector3): boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/** a stone wall's blocks and their relief */
function stone(base: string, line: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 512, 512);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rows = 8, h = 512 / rows;
  for (let r = 0; r < rows; r++) {
    const n = 4, w = 512 / n;
    for (let k = -1; k < n; k++) {
      const px = k * w + (r % 2 ? w / 2 : 0);
      x.fillStyle = `rgba(${rnd() < 0.5 ? '255,240,220' : '60,30,90'},${0.04 + rnd() * 0.12})`;
      x.fillRect(px + 3, r * h + 3, w - 6, h - 6);
      x.strokeStyle = line;
      x.lineWidth = 5;
      x.strokeRect(px + 2, r * h + 2, w - 4, h - 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** the throne's floor: a gold sunburst with the rule written round it */
function throneTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(512, 512, 40, 512, 512, 512);
  g.addColorStop(0, '#ffe9a0');
  g.addColorStop(0.32, '#ffc832');
  g.addColorStop(0.36, '#6a2fd0');
  g.addColorStop(1, '#3f1a96');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 1024);
  x.translate(512, 512);
  for (let k = 0; k < 32; k++) {
    x.rotate(Math.PI / 16);
    x.fillStyle = k % 2 ? 'rgba(255,214,90,0.20)' : 'rgba(255,255,255,0.05)';
    x.beginPath();
    x.moveTo(170, -18);
    x.lineTo(500, -56);
    x.lineTo(500, 56);
    x.lineTo(170, 18);
    x.closePath();
    x.fill();
  }
  x.strokeStyle = '#ffd23a';
  x.lineWidth = 10;
  for (const r of [176, 340, 500]) {
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.stroke();
  }
  // the crown in the middle
  x.fillStyle = '#7a3a00';
  x.beginPath();
  x.moveTo(-96, 56);
  x.lineTo(-112, -50);
  x.lineTo(-52, -6);
  x.lineTo(0, -80);
  x.lineTo(52, -6);
  x.lineTo(112, -50);
  x.lineTo(96, 56);
  x.closePath();
  x.fill();
  // the rule, all the way round
  const text = 'THE THRONE   CLOCK X2   THE THRONE   CLOCK X2   ';
  x.font = "800 58px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  x.fillStyle = '#ffe9a0';
  x.textAlign = 'center';
  for (let k = 0; k < text.length; k++) {
    x.save();
    x.rotate((k / text.length) * Math.PI * 2);
    x.fillText(text[k], 0, -398);
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a red carpet: steps, gold edging */
function carpetTex() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c81e46';
  x.fillRect(0, 0, 256, 512);
  for (let k = 0; k < 8; k++) {
    x.fillStyle = k % 2 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.05)';
    x.fillRect(0, k * 64, 256, 64);
    x.fillStyle = 'rgba(255,210,90,0.9)';
    x.fillRect(32, k * 64 + 60, 192, 4);
  }
  x.fillStyle = '#ffc832';
  x.fillRect(0, 0, 22, 512);
  x.fillRect(234, 0, 22, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a pad: a ring of stripes with an arrow on it pointing where it throws you */
function padTex(a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.translate(128, 128);
  for (let k = 0; k < 16; k++) {
    x.fillStyle = k % 2 ? a : b;
    x.beginPath();
    x.moveTo(0, 0);
    x.arc(0, 0, 128, (k / 16) * Math.PI * 2, ((k + 1) / 16) * Math.PI * 2);
    x.closePath();
    x.fill();
  }
  x.fillStyle = '#fff6e0';
  x.beginPath();
  x.arc(0, 0, 88, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = a;
  x.beginPath();
  x.moveTo(0, -66);
  x.lineTo(54, 4);
  x.lineTo(22, 4);
  x.lineTo(22, 60);
  x.lineTo(-22, 60);
  x.lineTo(-22, 4);
  x.lineTo(-54, 4);
  x.closePath();
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a heraldic banner */
function bannerTex(a: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const x = c.getContext('2d')!;
  x.fillStyle = a;
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(128, 0);
  x.lineTo(128, 270);
  x.lineTo(64, 320);
  x.lineTo(0, 270);
  x.closePath();
  x.fill();
  x.strokeStyle = '#ffd23a';
  x.lineWidth = 8;
  x.strokeRect(8, 8, 112, 250);
  x.fillStyle = '#ffd23a';
  x.beginPath();
  x.moveTo(30, 150);
  x.lineTo(22, 92);
  x.lineTo(46, 118);
  x.lineTo(64, 78);
  x.lineTo(82, 118);
  x.lineTo(106, 92);
  x.lineTo(98, 150);
  x.closePath();
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** low-poly rock hanging under everything, darker the deeper */
function rockUnder(R: number, depth: number, seed: number) {
  const pts: THREE.Vector2[] = [];
  const n = 8;
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pts.push(new THREE.Vector2(Math.max(0.01, R * (1 - u) ** 0.75), -u * depth));
  }
  const g = new THREE.LatheGeometry(pts.reverse(), 26).toNonIndexed();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const hash = (a: number, b: number) => {
    const v = Math.sin(a * 12.9898 + b * 78.233 + seed) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const qa = Math.round(Math.atan2(z, x) * 5), qy = Math.round(y);
    const s = 1 + (hash(qa, qy) - 0.5) * 0.3 * Math.min(1, -y / 2);
    p.setXYZ(i, x * s, y, z * s);
    const k = THREE.MathUtils.clamp(-y / depth, 0, 1);
    c.setHex(0x8a5fd8).lerp(new THREE.Color(0x2a1658), k).multiplyScalar(0.85 + hash(qa + 3, qy) * 0.3);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function crownKeep(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 124, 0);
  const K = KEEP, R = K.R;
  const state = { go: 1e9 };
  const y0 = center.y, yTop = y0 + K.top;
  b.lakeY = y0 - 46;
  const ramps = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2);
  const groundAt = (x: number, z: number) => {
    const px = x - center.x, pz = z - center.z;
    if (Math.hypot(px, pz) <= K.keepR) return yTop;
    for (const a of ramps) {
      const along = px * Math.cos(a) + pz * Math.sin(a), side = Math.abs(-px * Math.sin(a) + pz * Math.cos(a));
      if (side <= K.rampW / 2 && along >= K.keepR && along <= K.foot) return y0 + (K.top * (K.foot - along)) / (K.foot - K.keepR);
    }
    return y0;
  };
  // ---- the courtyard: hex flagstones, the outer ones on a clock
  const S = 3.6, HR = S / Math.sqrt(3), rowH = (S * Math.sqrt(3)) / 2, HH = 0.6;
  const tiles: { x: number; z: number; r: number; a: number; drop: number; rim: boolean }[] = [];
  for (let j = -12; j <= 12; j++)
    for (let i = -12; i <= 12; i++) {
      const x = (i + (Math.abs(j) % 2 ? 0.5 : 0)) * S, z = j * rowH, r = Math.hypot(x, z);
      if (r > R || r < K.keepR - 2.6) continue;
      tiles.push({ x: center.x + x, z: center.z + z, r, a: Math.atan2(z, x), drop: Infinity, rim: r > K.rim });
    }
  // (the outer flagstones break away a chunk at a time, the outermost first, round and round)
  {
    const SECT = 8;
    const chunks = new Map<number, typeof tiles>();
    for (const t of tiles) {
      if (!t.rim) continue;
      const sec = Math.floor(((t.a + Math.PI) / (Math.PI * 2)) * SECT) % SECT, band = t.r > (K.rim + R) / 2 + 0.6 ? 0 : 1;
      const k = band * SECT + ((sec * 3) % SECT);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k)!.push(t);
    }
    [...chunks.keys()].sort((p, q) => p - q).forEach((k, n) => {
      for (const t of chunks.get(k)!) t.drop = K.fallAt + n * K.fallGap;
    });
  }
  const cells = new Map<number, number[]>();
  const cellOf = (x: number, z: number) => (Math.floor((x - center.x) / S) + 64) * 256 + Math.floor((z - center.z) / S) + 64;
  tiles.forEach((t, i) => {
    const k = cellOf(t.x, t.z);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(i);
  });
  const near = (x: number, z: number, out: number[]) => {
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const a = cells.get(cellOf(x + i * S, z + j * S));
        if (a) for (const q of a) out.push(q);
      }
  };
  b.world.pads = {
    shape: { type: 'cyl', r: HR + 0.04, hh: HH },
    bound: Math.hypot(HR + 0.04, HH),
    mat: Mat.Paint,
    near,
    at: (i, o) => o.set(tiles[i].x, y0 - HH, tiles[i].z),
    on: (i, t) => t - state.go < tiles[i].drop,
  };
  const NEAR: number[] = [];
  const solid = (x: number, z: number, t: number) => {
    NEAR.length = 0;
    near(x, z, NEAR);
    for (const i of NEAR) if (Math.hypot(tiles[i].x - x, tiles[i].z - z) < HR && t - state.go < tiles[i].drop) return true;
    return false;
  };
  {
    // (a hexagon with a bevelled top: flat shaded, each face its own)
    const prof = [[HR - 0.4, -HH * 2 - 0.3], [HR - 0.03, -HH * 2], [HR - 0.03, -0.1], [HR - 0.16, 0], [0, 0]].map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y));
    const hex = new THREE.LatheGeometry(prof, 6).toNonIndexed().rotateY(Math.PI / 6);
    hex.computeVertexNormals();
    const trimG = new THREE.RingGeometry(HR - 0.3, HR - 0.17, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6).translate(0, 0.012, 0);
    const mesh = new THREE.InstancedMesh(hex, new THREE.MeshPhysicalMaterial({ roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.28 }), tiles.length);
    const trim = new THREE.InstancedMesh(trimG, new THREE.MeshStandardMaterial({ color: 0xffc832, roughness: 0.3, metalness: 0.7, emissive: 0x8a5a00, emissiveIntensity: 0.5 }), tiles.length);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    trim.receiveShadow = true;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), E = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1);
    const C = new THREE.Color();
    const inner = [0x7a44e8, 0x6636d4, 0x8a54f0], outer = [0x3f6fe8, 0x2f58d0, 0x4a7ef0];
    const base = tiles.map((t, i) => (t.rim ? outer : inner)[(i * 7 + Math.floor(t.r / 3)) % 3]);
    tiles.forEach((t, i) => {
      M.makeTranslation(t.x, y0, t.z);
      mesh.setMatrixAt(i, M);
      trim.setMatrixAt(i, M);
      mesh.setColorAt(i, C.setHex(base[i]));
    });
    mesh.frustumCulled = trim.frustumCulled = false;
    b.group.add(mesh, trim);
    const rimT = tiles.map((t, i) => ({ t, i })).filter((q) => q.t.rim);
    b.animators.push((tt) => {
      const x = tt - state.go;
      if (x < K.fallAt - K.warn) return;
      let dirty = false;
      for (const { t, i } of rimT) {
        const d = x - t.drop;
        if (d < -K.warn || d > 5) continue;
        dirty = true;
        if (d < 0) {
          // (it shakes and flashes, faster and faster)
          const k = 1 + d / K.warn;
          const w = 0.06 * k;
          M.makeTranslation(t.x + Math.sin(tt * 47 + i) * w, y0 - 0.05 * k + Math.sin(tt * 61 + i) * w, t.z + Math.cos(tt * 53 + i) * w);
          C.setHex(Math.sin(tt * (8 + 18 * k)) > 0 ? 0xff5a3a : base[i]);
          mesh.setColorAt(i, C);
        } else {
          E.set(d * (0.6 + (i % 3) * 0.4), 0, d * (0.4 + (i % 2) * 0.5));
          Q.setFromEuler(E);
          M.compose(V.set(t.x, y0 - 0.5 * GRAVITY * 0.7 * d * d, t.z), Q, d > 4.9 ? V.clone().set(0, 0, 0) : ONE);
        }
        mesh.setMatrixAt(i, M);
        trim.setMatrixAt(i, M);
      }
      if (dirty) {
        mesh.instanceMatrix.needsUpdate = trim.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
  }
  // ---- the rock it all stands on
  {
    const g = rockUnder(R * 0.86, 40, 3).translate(center.x, y0 - 1.3, center.z);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
    b.group.add(m);
    // gold crystals in it
    const cg = new THREE.OctahedronGeometry(1, 0).scale(0.6, 1.5, 0.6);
    const cm = new THREE.InstancedMesh(cg, glowMat(0xffc040, 1.9), 22);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3();
    for (let k = 0; k < 22; k++) {
      const a = k * 2.399, d = 4 + (k % 7) * 4.6, r = R * 0.86 * (1 - d / 40) ** 0.75;
      Q.setFromAxisAngle(V.set(Math.sin(a), 0, Math.cos(a)), 0.5 + (k % 3) * 0.3);
      M.compose(V.set(center.x + Math.cos(a) * r, y0 - 2 - d, center.z + Math.sin(a) * r), Q, Sc.setScalar(0.8 + (k % 4) * 0.5));
      cm.setMatrixAt(k, M);
    }
    b.group.add(cm);
  }
  let throneMat!: THREE.MeshPhysicalMaterial;
  // ---- the keep: a round tower, its throne on top, battlements with gaps for the way in
  {
    const wallTex = stone('#f2e6d2', 'rgba(120,80,150,0.55)');
    wallTex.repeat.set(5, 1);
    const wall = new THREE.CylinderGeometry(K.keepR, K.keepR + 0.25, K.top + 0.6, 64, 1, true).translate(center.x, y0 + K.top / 2 - 0.3, center.z);
    b.world.statics.addGeometry(wall, Mat.Paint);
    const wm = new THREE.Mesh(wall, new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 1.4, roughness: 0.75 }));
    wm.castShadow = wm.receiveShadow = true;
    b.group.add(wm);
    const top = new THREE.CircleGeometry(K.keepR, 96).rotateX(-Math.PI / 2).translate(center.x, yTop, center.z);
    b.world.statics.addGeometry(top, Mat.Paint);
    const tt = throneTex();
    throneMat = new THREE.MeshPhysicalMaterial({ map: tt, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.2, emissive: 0xffffff, emissiveMap: tt, emissiveIntensity: 0.05 });
    const tm = new THREE.Mesh(top, throneMat);
    tm.receiveShadow = true;
    b.group.add(tm);
    // gold bands round the tower
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.32, metalness: 0.45, emissive: 0x8a5200, emissiveIntensity: 0.55 });
    for (const [y, r] of [[yTop - 0.1, K.keepR + 0.1], [y0 + 0.5, K.keepR + 0.34]] as const) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.14, 8, 96).rotateX(Math.PI / 2).translate(center.x, y, center.z), gold);
      band.castShadow = true;
      b.group.add(band);
    }
    // the battlements: a block between each pair of ways in
    const parts: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) / 8) * Math.PI * 2 + 0, x = center.x + Math.cos(a + 0.0) * (K.keepR - 0.2), z = center.z + Math.sin(a) * (K.keepR - 0.2);
      // (the ways in are at every eighth of a turn, so the gap between them is narrow at a carpet)
      const w = 1.9, h = 0.8;
      const yaw = Math.PI / 2 - a;
      const g = new THREE.BoxGeometry(w, h, 0.8).rotateY(yaw).translate(x, yTop + h / 2, z);
      b.world.statics.addGeometry(g, Mat.Paint);
      parts.push(g);
      caps.push(new THREE.BoxGeometry(w + 0.16, 0.14, 0.96).rotateY(yaw).translate(x, yTop + h + 0.07, z));
    }
    const bm = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.75 }));
    bm.castShadow = bm.receiveShadow = true;
    b.group.add(bm);
    const cm = new THREE.Mesh(mergeGeometries(caps, false)!, gold);
    cm.castShadow = true;
    b.group.add(cm);
  }
  // ---- the four carpets up
  {
    const tex = carpetTex();
    const carpet = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.75, sheen: 1, sheenColor: new THREE.Color(0xff6a8a), sheenRoughness: 0.5 });
    const sideTex = stone('#d8c6b4', 'rgba(110,70,140,0.55)');
    const side = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.8 });
    for (const a of ramps) {
      const c = Math.cos(a), s = Math.sin(a), hw = K.rampW / 2;
      const P = (along: number, lat: number, y: number) => [center.x + c * along - s * lat, y, center.z + s * along + c * lat] as const;
      const r0 = K.keepR - 0.1, r1 = K.foot;
      const v = [P(r0, -hw, yTop), P(r0, hw, yTop), P(r1, hw, y0), P(r1, -hw, y0)];
      const face = new THREE.BufferGeometry();
      face.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v.flat()), 3));
      face.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
      face.setIndex([0, 1, 2, 0, 2, 3]);
      face.computeVertexNormals();
      if (face.getAttribute('normal').getY(0) < 0) face.setIndex([0, 2, 1, 0, 3, 2]);
      face.computeVertexNormals();
      b.world.statics.addGeometry(face, Mat.Paint);
      const fm = new THREE.Mesh(face, carpet);
      fm.receiveShadow = true;
      b.group.add(fm);
      // the sides: solid wedges, so a bean walks round the carpet, not through it
      for (const sd of [-1, 1]) {
        const w = [P(r0, hw * sd, yTop), P(r1, hw * sd, y0), P(r0, hw * sd, y0)];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(w.flat()), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, K.top / 3.2, (r1 - r0) / 3.2, 0, 0, 0]), 2));
        g.setIndex(sd > 0 ? [0, 1, 2, 0, 2, 1] : [0, 2, 1, 0, 1, 2]);
        g.computeVertexNormals();
        b.world.statics.addGeometry(g, Mat.Paint);
        const m = new THREE.Mesh(g, side);
        m.material.side = THREE.DoubleSide;
        m.castShadow = true;
        b.group.add(m);
      }
    }
  }
  // ---- the pads: hop up from the courtyard, or the long way via a drum out past the walls
  const pads: KeepPad[] = [];
  /** until when each bean's in flight off a pad (it goes where it was thrown) */
  const flung = new Map<number, number>();
  {
    const drumR = R + 4.8, drumY = y0 + 1.4;
    const hopTex = padTex('#ff4f6a', '#ffd23a'), flingTex = padTex('#2fa8ff', '#ffd23a');
    const padMesh = (x: number, y: number, z: number, r: number, tex: THREE.Texture, yaw: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.28 }));
      m.position.set(x, y + 0.03, z);
      m.rotation.y = yaw;
      m.receiveShadow = true;
      b.group.add(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 8, 40).rotateX(Math.PI / 2), glowMat(0xffd23a, 1.5));
      ring.position.set(x, y + 0.05, z);
      b.group.add(ring);
      return { m, ring };
    };
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      const at = (r: number, y: number) => new THREE.Vector3(center.x + c * r, y, center.z + s * r);
      // the hop: up onto the keep
      const hop = at(9.7, y0);
      pads.push({ x: hop.x, y: y0, z: hop.z, r: 1.5, to: at(3, yTop), T: 1, kind: 'hop', hit: -9 });
      padMesh(hop.x, y0, hop.z, 1.5, hopTex, Math.atan2(c, s) + Math.PI);
      // the fling: out to the drum...
      const fl = at(17, y0);
      const drum = at(drumR, drumY);
      pads.push({ x: fl.x, y: y0, z: fl.z, r: 1.5, to: drum.clone(), T: 0.9, kind: 'fling', hit: -9 });
      padMesh(fl.x, y0, fl.z, 1.5, flingTex, Math.atan2(c, s));
      // ...and the drum throws you all the way over to the throne
      pads.push({ x: drum.x, y: drumY, z: drum.z, r: 2.9, to: at(2.2, yTop), T: 1.7, kind: 'drum', hit: -9 });
      const dg = new THREE.CylinderGeometry(2.8, 2.5, 1.3, 40).translate(drum.x, drumY - 0.65, drum.z);
      b.world.statics.addGeometry(dg, Mat.Bumper);
      const dm = new THREE.Mesh(dg, new THREE.MeshPhysicalMaterial({ color: 0xff4f6a, roughness: 0.3, clearcoat: 0.9 }));
      dm.castShadow = true;
      b.group.add(dm);
      const skin = new THREE.Mesh(new THREE.CircleGeometry(2.7, 40).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: flingTex, roughness: 0.25, clearcoat: 1, emissive: 0xffffff, emissiveMap: flingTex, emissiveIntensity: 0.3 }));
      skin.position.set(drum.x, drumY + 0.02, drum.z);
      skin.rotation.y = Math.atan2(c, s) + Math.PI;
      b.group.add(skin);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(2.82, 0.16, 10, 44).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.25, metalness: 0.9 }));
      hoop.position.set(drum.x, drumY, drum.z);
      b.group.add(hoop);
      const pad = pads[pads.length - 1];
      const y1 = skin.position.y;
      b.animators.push((t) => {
        const q = t - pad.hit;
        skin.position.y = y1 - (q < 0.3 ? Math.sin((q / 0.3) * Math.PI) * 0.45 : 0);
      });
      // the little rock it stands on
      const rock = new THREE.Mesh(rockUnder(3.2, 10, k + 11).translate(drum.x, drumY - 1.3, drum.z), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
      b.group.add(rock);
    }
  }
  b.world.fields.push({
    min: new THREE.Vector3(center.x - R - 9, y0 - 2, center.z - R - 9),
    max: new THREE.Vector3(center.x + R + 9, y0 + 7, center.z + R + 9),
    act: (m: Marble, t: number) => {
      if (m.vel.y > 2) return;
      const feet = m.pos.y - 0.5;
      for (const p of pads) {
        if (Math.hypot(m.pos.x - p.x, m.pos.z - p.z) > p.r || feet - p.y > 0.7 || feet - p.y < -0.5) continue;
        if (p.kind !== 'drum' && m.mode === Mode.Tumble) continue;
        const T = p.T;
        m.vel.set((p.to.x - m.pos.x) / T, (p.to.y + 0.55 - m.pos.y) / T + 0.5 * GRAVITY * T, (p.to.z - m.pos.z) / T);
        m.groundT = 1;
        m.sprung = true;
        p.hit = t;
        flung.set(m.id, t + T * 0.92);
        break;
      }
    },
  });
  // ---- the sweepers: two bars round the outer courtyard (they go once it has broken away)
  const barEnd = K.fallAt + K.fallGap * 15;
  const bar = (x: number) => (x < K.barAt || x > barEnd ? null : (x - K.barAt) * (K.barV + 0.0024 * (x - K.barAt)));
  {
    const r0 = K.foot + 0.4, r1 = R + 1, L = (r1 - r0) / 2, rm = (r0 + r1) / 2, hh = 0.26, y = y0 + 0.42;
    const barMat = new THREE.MeshPhysicalMaterial({ color: 0xff4f6a, roughness: 0.3, clearcoat: 0.8, emissive: 0xff2040, emissiveIntensity: 0.35 });
    const tipMat = new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.25, metalness: 0.9 });
    for (const off of [0, Math.PI]) {
      const kin = new Kin({ type: 'box', hx: L, hy: hh, hz: 0.3 }, Mat.Paint, (t, pos, quat) => {
        const a = bar(t - state.go);
        if (a === null) return void pos.set(center.x, y - 60, center.z);
        const d = a + off;
        pos.set(center.x + Math.cos(d) * rm, y, center.z - Math.sin(d) * rm);
        quat.setFromAxisAngle(UP, d);
      });
      b.world.addKin(kin);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(L * 2, hh * 2, 0.6), barMat);
      const c0 = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12), tipMat);
      const c1 = c0.clone();
      c0.position.x = -L;
      c1.position.x = L;
      body.castShadow = c0.castShadow = c1.castShadow = true;
      g.add(body, c0, c1);
      g.visible = false;
      b.group.add(g);
      b.animators.push((t) => {
        const a = bar(t - state.go);
        g.visible = a !== null;
        if (a === null) return;
        const d = a + off;
        g.position.set(center.x + Math.cos(d) * rm, y, center.z - Math.sin(d) * rm);
        g.rotation.y = d;
      });
    }
  }
  // ---- the cannons: deterministic shells, a ring first, the keep's top too; they come faster as it goes
  const list: Hit3[] = [];
  {
    let sd = 90217;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let x = K.cannonAt + 1.5; x < K.T + K.over + 2; x += Math.max(1.1, 3 - (x - K.cannonAt) * 0.022)) {
      const a = rnd() * Math.PI * 2, onKeep = rnd() < 0.3, d = onKeep ? 1.5 + rnd() * 4 : K.keepR + 1.5 + rnd() * (R - K.keepR - 3);
      const px = center.x + Math.cos(a) * d, pz = center.z + Math.sin(a) * d;
      // (nothing's to be gained shelling a hole)
      if (!onKeep && (K.fallAt + 12 < x) && d > K.rim) continue;
      list.push({ t: x, x: px, y: groundAt(px, pz), z: pz, r: 2.3 + rnd() * 0.7 });
    }
  }
  const shots = addStrikes(b, { list, warn: 1.7, state, ring: 0xffd23a, ball: { color: 0x281838, r: 0.75 }, box: [new THREE.Vector3(center.x - R - 3, y0 - 2, center.z - R - 3), new THREE.Vector3(center.x + R + 3, y0 + 9, center.z + R + 3)], out: 9.5, up: 8.5 });
  // ---- the throne goes hot on the clock, then clears itself: a ring closes in and it blows everyone off the top
  const hot = (x: number) => {
    if (x < K.blastAt - K.hotT) return false;
    const q = (x - K.blastAt) % K.blastGap;
    return (q < 0 ? q + K.blastGap : q) > K.blastGap - K.hotT;
  };
  {
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(K.keepR - 0.1, K.keepR - 0.1, 7, 48, 1, true).translate(center.x, yTop + 3.5, center.z), new THREE.MeshBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    glow.visible = false;
    b.group.add(glow);
    b.animators.push((t) => {
      const on = hot(t - state.go);
      glow.visible = on;
      throneMat.emissiveIntensity = on ? 0.55 + 0.3 * Math.sin(t * 9) : 0.05;
      if (on) (glow.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.07 * Math.sin(t * 9);
    });
  }
  const blasts: Hit3[] = [];
  for (let x = K.blastAt; x < K.T + K.over + 2; x += K.blastGap) blasts.push({ t: x, x: center.x, y: yTop, z: center.z, r: K.keepR - 0.2 });
  const blast = addStrikes(b, { list: blasts, warn: 2.6, state, ring: 0xff4f6a, jet: 0xffc860, box: [new THREE.Vector3(center.x - K.keepR - 1, yTop - 1, center.z - K.keepR - 1), new THREE.Vector3(center.x + K.keepR + 1, yTop + 5, center.z + K.keepR + 1)], out: 13, up: 9.5 });
  // ---- the holder: a burst away with the crown, then the weight of it
  const arena: KeepArena = { center, R, holder: -1, x: center.x, z: center.z, zoomT: 0, share: 0, bar, ramps, pads, shots, blast, hot, groundAt, solid, onTop: (p) => p.y > yTop - 0.2 && Math.hypot(p.x - center.x, p.z - center.z) < K.keepR + 0.2 };
  b.world.fields.push({
    min: new THREE.Vector3(center.x - R - 9, y0 - 3, center.z - R - 9),
    max: new THREE.Vector3(center.x + R + 9, y0 + 16, center.z + R + 9),
    act: (m: Marble, t: number) => {
      if (t < (flung.get(m.id) ?? 0)) m.input.set(0, 0, 0);
      // (someone near the win: the whole field gets a second wind)
      if (arena.holder >= 0 && arena.holder !== m.id && arena.share > 0.5) m.runK *= K.rally;
      if (arena.holder !== m.id) return;
      if (t < arena.zoomT) {
        m.runK *= K.zoomK;
        m.guardT = Math.max(m.guardT, 0.05);
      } else m.runK *= K.carry - K.heavy * arena.share;
    },
  });
  // ---- round it: four gate towers on rocks, banners, the lamps, and a great crown turning overhead
  {
    const wallTex = stone('#efe2ce', 'rgba(110,70,140,0.5)');
    wallTex.repeat.set(3, 3);
    const wall = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 1.2, roughness: 0.78 });
    const roofs = [0x3a5ad8, 0x8a3fe0, 0xd83a5a, 0x2f8ad8];
    const banners = [bannerTex('#c81e46'), bannerTex('#3a4ad8'), bannerTex('#7a2fd0'), bannerTex('#c81e46')];
    const win = glowMat(0xffc860, 2.2);
    const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.25, metalness: 0.9 });
    ramps.forEach((a, k) => {
      const r = R + 15, x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r, h = 17 + (k % 2) * 5, tr = 3;
      const base = y0 - 3;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr * 1.12, h, 28).translate(x, base + h / 2, z), wall);
      body.castShadow = true;
      b.group.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(tr * 1.35, tr * 2.6, 28).translate(x, base + h + tr * 1.3 + 0.8, z), new THREE.MeshPhysicalMaterial({ color: roofs[k], roughness: 0.35, clearcoat: 0.7 }));
      roof.castShadow = true;
      b.group.add(roof);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10).translate(x, base + h + tr * 2.6 + 1.1, z), GOLD);
      b.group.add(ball);
      const band = new THREE.Mesh(new THREE.TorusGeometry(tr * 1.08, 0.2, 8, 40).rotateX(Math.PI / 2).translate(x, base + h + 0.7, z), GOLD);
      b.group.add(band);
      // windows, lit from inside, facing the courtyard
      const ax = center.x - x, az = center.z - z, yaw = Math.atan2(ax, az);
      for (const [wy, wa] of [[0.62, -0.42], [0.62, 0.42], [0.8, 0]] as const) {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 4, 10), win);
        const q = yaw + wa;
        m.position.set(x + Math.sin(q) * tr * 0.97, base + h * wy, z + Math.cos(q) * tr * 0.97);
        b.group.add(m);
      }
      // the banner down the front of it
      const bn = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.8, 1, 8), new THREE.MeshStandardMaterial({ map: banners[k], transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }));
      bn.position.set(x + Math.sin(yaw) * (tr + 0.14), base + h * 0.42, z + Math.cos(yaw) * (tr + 0.14));
      bn.rotation.y = yaw;
      bn.castShadow = true;
      b.group.add(bn);
      const pos = bn.geometry.getAttribute('position') as THREE.BufferAttribute;
      const y00 = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i));
      b.animators.push((t) => {
        for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(t * 2.2 + y00[i] * 1.1 + k) * 0.13 * (2.9 - y00[i]) * 0.3);
        pos.needsUpdate = true;
      });
      const rock = new THREE.Mesh(rockUnder(6.4, 20, k + 5).translate(x, base + 0.1, z), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
      b.group.add(rock);
    });
    // the lamps, a ring of them on the wind
    const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 12, 8), glowMat(0xffd070, 3.2), 32);
    const M = new THREE.Matrix4();
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      lamp.setMatrixAt(k, M.makeTranslation(center.x + Math.cos(a) * (R + 2.5), y0 + 4.5 + Math.sin(k * 1.7) * 0.8, center.z + Math.sin(a) * (R + 2.5)));
    }
    b.group.add(lamp);
    // the great crown, high over the throne, with hoops turning round it
    const big = makeCrown();
    big.scale.setScalar(3.4);
    big.position.set(center.x, y0 + 21, center.z);
    b.group.add(big);
    big.traverse((o) => (o.castShadow = false));
    const hoops = [0, 1, 2].map((k) => {
      const h = new THREE.Mesh(new THREE.TorusGeometry(5.2 + k * 1.1, 0.09, 8, 80), glowMat(0xffc860, 1.5));
      h.position.copy(big.position);
      b.group.add(h);
      return h;
    });
    b.animators.push((t) => {
      big.rotation.y = t * 0.25;
      big.position.y = y0 + 21 + Math.sin(t * 0.7) * 0.5;
      hoops.forEach((h, k) => {
        h.position.y = big.position.y + 1;
        h.rotation.set(t * (0.2 + k * 0.13), t * (0.15 - k * 0.09), k);
      });
    });
  }
  title(b, info, 'The final · Keep the crown', 0xffc21f, new THREE.Vector3(center.x, y0 + 12, center.z - R - 12));
  dressArena(b, new THREE.Vector3(center.x, y0 - 2, center.z), R + 6, 47);
  b.finish();
  return {
    id: 'crownkeep',
    name: info.name,
    kind: 'final',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 7,
    lakeY: b.lakeY,
    state,
    // (on the outer courtyard, between the carpets' feet, everyone an equal run from the keep)
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const ring = Math.floor(k / 8), inRing = Math.min(8, n - ring * 8), kk = k - ring * 8;
        const a = (kk / inRing) * Math.PI * 2 + 0.39 + ring * 0.4, r = 14.2 + ring * 1.9;
        const p = new THREE.Vector3(center.x + Math.cos(a) * r, y0 + 0.55, center.z + Math.sin(a) * r);
        out.push({ pos: p, yaw: Math.atan2(center.x - p.x, center.z - p.z) });
      }
      return out;
    },
    plate: { center, radius: R, bars: [] },
    keep: arena,
    intro: [],
  };
}
