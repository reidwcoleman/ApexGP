import * as THREE from 'three';
import type { World } from './collide.ts';
import type { Fx } from './fx.ts';
import { applyLF } from './lighting.ts';

/**
 * What people left on the walls and floors: graffiti, posters pasted up, papers everywhere underfoot, and the rooms
 * where it went worst.
 *
 * Each is a sheet drawn into a canvas at load and laid on surfaces as instanced quads lit like any other surface (so a
 * flashlight brings them up out of the dark and they go black in a corner). The graffiti follows what writers really
 * do: a tag (one colour, fast, a handstyle), a throw-up (a quick fill, an outline in another colour round it, a black
 * keyline round the lot, a star of highlight), a blockbuster (big square letters, a 3D drop, a fade from one colour to
 * another), a stencil (hard edges, overspray round them), and the scrawled warnings of whoever was in here last.
 * All of it with drips where the paint pooled, a soft spray edge, and the wear of years.
 *
 * Where it goes is found at load: from inside each room a ray to a wall, then more to the corners, and only a flat
 * run of wall (no door, no window, no corner) takes it. A few rooms, picked by the map's seed, are where it went
 * worst: blood over the floor, up the walls, and dragged across it.
 */

function rnd(r: () => number, a: number, b: number) {
  return a + r() * (b - a);
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a lit sheet of decals: an atlas of cols x rows cells, each quad aspect (w:h) wide */
export class Sheet {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(tex: THREE.Texture, readonly cols: number, readonly rows: number, aspect: number, readonly max: number, rough: number, key: string, order = 2) {
    const g = new THREE.PlaneGeometry(1, 1 / aspect);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
    const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: rough, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 - order, polygonOffsetUnits: -2 - order });
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;').replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2( ( uv.x + mod( aCell, ${cols}.0 ) ) / ${cols}.0, ( uv.y + ${rows - 1}.0 - floor( aCell / ${cols}.0 ) ) / ${rows}.0 );`);
    };
    m.customProgramCacheKey = () => key;
    applyLF(m, { spec: 0.4 });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }

  /** a quad w wide on a surface facing n, its up as near world up as the face allows (or turned by roll about n) */
  add(x: number, y: number, z: number, n: THREE.Vector3, w: number, cell: number, roll = 0, lift = 0.008) {
    if (this.n >= this.max) return;
    const nn = n.clone().normalize();
    const ref = Math.abs(nn.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(ref, nn).normalize();
    let up = new THREE.Vector3().crossVectors(nn, right).normalize();
    if (roll) {
      const q = new THREE.Quaternion().setFromAxisAngle(nn, roll);
      right = right.applyQuaternion(q);
      up = up.applyQuaternion(q);
    }
    const m = new THREE.Matrix4().makeBasis(right.multiplyScalar(w), up.multiplyScalar(w), nn).setPosition(x + nn.x * lift, y + nn.y * lift, z + nn.z * lift);
    this.mesh.setMatrixAt(this.n, m);
    (this.mesh.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute).setX(this.n, cell);
    this.n++;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.getAttribute('aCell').needsUpdate = true;
  }
  get count() { return this.n; }
}

// ------------------------------------------------------------------ graffiti

/**
 * The cells, 4 x 8 of them at 768 x 384:
 *   0-7   throw-ups   fat round letters blown up from a handstyle, a quick streaky fill (chrome, white, one bright),
 *                     a black keyline painted letter by letter so each overlaps the last, a shine, drips
 *   8-15  tags        a handstyle signature, sprayed or in marker, slanted, with its swoop, crown or crew letters
 *   16-21 warnings    whoever was in here last, in a hurry, in red or black, running
 *   22-27 pieces      the big ones: a colour fade with a band cut through it, a 3D drop, a black outline, a cloud
 *                     behind in another colour with its own keyline, highlights, stars, a tag beside it
 *   28-29 blockbusters square letters, two colours split, a 3D drop
 *   30    a stencil, 31 an eye
 * The letterforms are real hand styles (Sedgwick Ave and its display cut, Permanent Marker, Bungee), drawn into
 * shapes the way writers build them: inflated, stacked, outlined, faded.
 */
const G_COLS = 4, G_ROWS = 8;
/** what a cell is: 0 throw-up, 1 tag, 2 warning, 3 piece, 4 blockbuster, 5 stencil or symbol */
export const gKind = (cell: number) => (cell < 8 ? 0 : cell < 16 ? 1 : cell < 22 ? 2 : cell < 28 ? 3 : cell < 30 ? 4 : 5);
const NAMES = ['KROME', 'VEXO', 'NAKS', 'RUSK', 'SKEP', 'ORBY', 'MOKE', 'ZERO', 'TWIG', 'DUSK', 'OKER', 'JUNO', 'FEAR', 'GHOST', 'HAZE', 'REK', 'SOLO', 'KEMS', 'DRAK', 'VOID'];
const CREWS = ['TKV', 'DSK', 'ABK', 'NWO', 'K2S', 'MSR', 'GTC'];
const WORDS = ['GET OUT', 'THEY HEAR YOU', "DON'T LOOK BACK", 'NO WAY OUT', "IT'S STILL HERE", 'NOT ALONE'];
const STENCIL = ['NO EXIT', 'CONDEMNED', 'QUARANTINE', 'DO NOT ENTER', 'WATCHING'];

const F_PIECE = '"LF Piece", "Arial Black", sans-serif';
const F_TAG = '"LF Tag", "Marker Felt", cursive';
const F_MARKER = '"LF Marker", "Marker Felt", cursive';
const F_BLOCK = '"LF Block", Impact, "Arial Black", sans-serif';

/** the hand styles have to be in before the atlas is drawn */
export async function graffitiFonts() {
  const f = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!f) return;
  await Promise.all(['LF Piece', 'LF Tag', 'LF Marker', 'LF Block'].map((n) => f.load(`64px "${n}"`).catch(() => [])));
}

interface Glyph { ch: string; x: number; y: number; rot: number; s: number }

export function graffitiAtlas(): THREE.CanvasTexture {
  const W = 3072, H = 3072, cw = W / G_COLS, ch = H / G_ROWS;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const r = mulberry(91);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  // a layer the size of a cell, centred like the cell is, for the parts that are painted inside a shape
  const layer = () => {
    const l = document.createElement('canvas');
    l.width = cw;
    l.height = ch;
    const x = l.getContext('2d')!;
    x.translate(cw / 2, ch / 2);
    return { l, x };
  };
  const A = layer(), B = layer();
  const clear = (x: CanvasRenderingContext2D) => {
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, cw, ch);
    x.restore();
  };
  const blit = (x: CanvasRenderingContext2D, alpha = 1) => {
    c.save();
    c.globalAlpha = alpha;
    c.drawImage(x.canvas, -cw / 2, -ch / 2);
    c.restore();
  };

  /** the biggest size the word fits at: its width squeezed, plus m x size of outline all round, inside wmax by hmax */
  const fit = (t: string, font: (s: number) => string, wmax: number, s0: number, squeeze = 1, m = 0, hmax = Infinity) => {
    let s = s0;
    c.font = font(s);
    while ((c.measureText(t).width * squeeze + 2 * m * s > wmax || s * (1 + 2 * m) > hmax) && s > 30) {
      s -= 4;
      c.font = font(s);
    }
    return s;
  };
  /** where each letter goes: run together, each bounced, turned and sized a little differently */
  const run = (t: string, size: number, font: (s: number) => string, squeeze: number, jy: number, jr: number, js: [number, number]): Glyph[] => {
    c.font = font(size);
    const ws = [...t].map((x) => (x === ' ' ? size * 0.35 : c.measureText(x).width * squeeze));
    let x = -ws.reduce((a, b) => a + b, 0) / 2;
    return [...t].map((chr, i) => {
      const g = { ch: chr, x: x + ws[i] / 2, y: rnd(r, -jy, jy) * size, rot: rnd(r, -jr, jr), s: size * rnd(r, js[0], js[1]) };
      x += ws[i];
      return g;
    });
  };
  const draw = (x: CanvasRenderingContext2D, g: Glyph, font: (s: number) => string, f: (x: CanvasRenderingContext2D) => void, dx = 0, dy = 0) => {
    x.save();
    x.translate(g.x + dx, g.y + dy);
    x.rotate(g.rot);
    x.font = font(g.s);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.lineCap = 'round';
    f(x);
    x.restore();
  };
  /** the letter as a solid, blown up by `fat` all round */
  const blob = (x: CanvasRenderingContext2D, g: Glyph, font: (s: number) => string, fat: number, col: string | CanvasGradient | CanvasPattern, dx = 0, dy = 0) =>
    draw(x, g, font, (q) => {
      q.fillStyle = col;
      q.strokeStyle = col;
      if (fat > 0) {
        q.lineWidth = fat * 2;
        q.strokeText(g.ch, 0, 0);
      }
      q.fillText(g.ch, 0, 0);
    }, dx, dy);
  /** spray: a soft halo of overspray first, then the hard paint */
  const sprayed = (col: string, f: () => void, soft = 10, halo = 0.4) => {
    c.save();
    c.shadowColor = col;
    c.shadowBlur = soft;
    c.globalAlpha = halo;
    f();
    c.restore();
    c.save();
    c.shadowColor = col;
    c.shadowBlur = 1.5;
    f();
    c.restore();
  };
  /** a can's fill: never even, streaks where it went back and forth, a few spits */
  const fillPattern = (base: string, x: CanvasRenderingContext2D = c) => {
    const p = document.createElement('canvas');
    p.width = p.height = 160;
    const q = p.getContext('2d')!;
    q.fillStyle = base;
    q.fillRect(0, 0, 160, 160);
    for (let i = 0; i < 14; i++) {
      q.globalAlpha = rnd(r, 0.025, 0.08);
      q.strokeStyle = r() < 0.5 ? '#000' : '#fff';
      q.lineWidth = rnd(r, 4, 16);
      const y = rnd(r, 0, 160), a = rnd(r, -0.25, 0.25);
      q.beginPath();
      q.moveTo(-10, y);
      q.lineTo(170, y + Math.tan(a) * 180);
      q.stroke();
    }
    q.globalAlpha = 0.25;
    q.fillStyle = '#000';
    for (let i = 0; i < 90; i++) q.fillRect(rnd(r, 0, 160), rnd(r, 0, 160), 1.6, 1.6);
    return x.createPattern(p, 'repeat')!;
  };
  const drips = (n: number, x0: number, x1: number, y: number, col: string, wmax = 6, lmax = 90) => {
    c.save();
    c.fillStyle = col;
    c.strokeStyle = col;
    c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = rnd(r, x0, x1), L = rnd(r, 12, lmax) * (r() < 0.2 ? 1.8 : 1), w = rnd(r, 1.8, wmax);
      c.globalAlpha = rnd(r, 0.8, 0.97);
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x, y + L * 0.3, x + rnd(r, -2, 2), y + L * 0.7, x + rnd(r, -2, 2), y + L);
      c.stroke();
      c.beginPath();
      c.ellipse(x, y + L, w * 0.75, w * 1.15, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };
  /** the four-point glint writers spray on a shine */
  const star = (x: number, y: number, s: number, col = '#ffffff') => {
    c.save();
    c.fillStyle = col;
    c.shadowColor = col;
    c.shadowBlur = 8;
    c.beginPath();
    c.moveTo(x, y - s);
    c.quadraticCurveTo(x + s * 0.08, y - s * 0.08, x + s, y);
    c.quadraticCurveTo(x + s * 0.08, y + s * 0.08, x, y + s);
    c.quadraticCurveTo(x - s * 0.08, y + s * 0.08, x - s, y);
    c.quadraticCurveTo(x - s * 0.08, y - s * 0.08, x, y - s);
    c.fill();
    c.restore();
  };
  /** a shine: the letter less itself moved down and right leaves its top-left edge, a thin white crescent */
  const shine = (G: Glyph[], font: (s: number) => string, fat: number, off: number, alpha: number) => {
    clear(B.x);
    for (const g of G) blob(B.x, g, font, fat * 0.72, '#ffffff');
    B.x.globalCompositeOperation = 'destination-out';
    for (const g of G) blob(B.x, g, font, fat * 0.72, '#000', off, off * 1.2);
    B.x.globalCompositeOperation = 'source-over';
    blit(B.x, alpha);
  };

  // ---- a throw-up
  const throwUp = (t: string) => {
    const fill = pick(['#e3e5e8', '#ecebe6', '#c8ccd2', '#d4d8dd', '#f3d23a', '#9fd8f2', '#f4a3c6', '#eceae4']);
    const line = pick(['#0e0e0e', '#0e0e0e', '#0e0e0e', '#1f37b5', '#b3151c', '#5b1d82']);
    const font = (s: number) => `${s}px ${F_PIECE}`;
    const size = fit(t, font, cw * 0.9, 300, 0.84, 0.21, ch * 0.72);
    c.translate(0, -ch * 0.02);
    const G = run(t, size, font, 0.84, 0.06, 0.12, [0.94, 1.08]);
    const fat = size * 0.09, key = size * 0.075;
    const pat = fillPattern(fill);
    // overspray of the whole outline, soft
    sprayed(line, () => G.forEach((g) => blob(c, g, font, fat + key, line)), 18, 0.35);
    // painted letter by letter: each one's outline goes over the last one's fill
    for (const g of G) {
      blob(c, g, font, fat + key, line);
      blob(c, g, font, fat, pat);
    }
    shine(G, font, fat, size * 0.045, 0.85);
    const by = G.reduce((a, g) => Math.max(a, g.y), 0) + size * 0.42;
    drips(4 + Math.floor(r() * 5), -cw * 0.28, cw * 0.28, by - fat * 0.6, fill, 5, 60);
    drips(3 + Math.floor(r() * 4), -cw * 0.3, cw * 0.3, by, line, 4, 80);
    for (let i = 0; i < 1 + Math.floor(r() * 3); i++) star(rnd(r, -cw * 0.28, cw * 0.28), rnd(r, -size * 0.45, -size * 0.15), rnd(r, 14, 26));
  };

  // ---- a tag
  const tag = (t: string, col: string, marker: boolean, scale = 1) => {
    const font = (s: number) => `${s}px ${marker ? F_MARKER : F_TAG}`;
    const size = fit(t, font, cw * (scale > 1 ? 0.86 : 0.6), 230 * scale, 0.92, 0.12, ch * 0.62);
    const G = run(t, size, font, 0.92, 0.06, 0.12, [0.9, 1.12]);
    // the first letter bigger, the way most hands start
    G[0].s *= 1.25;
    G[0].y -= size * 0.06;
    c.save();
    c.transform(1, 0, rnd(r, -0.42, -0.18), 1, 0, 0);
    const w = size * (marker ? 0.018 : 0.035);
    sprayed(col, () => {
      for (const g of G)
        draw(c, g, font, (q) => {
          q.strokeStyle = col;
          q.fillStyle = col;
          q.lineWidth = w;
          q.strokeText(g.ch, 0, 0);
          q.fillText(g.ch, 0, 0);
        });
      c.strokeStyle = col;
      c.lineWidth = size * (marker ? 0.03 : 0.04);
      c.lineCap = 'round';
      const last = G[G.length - 1], first = G[0];
      const k = r();
      c.beginPath();
      if (k < 0.45) {
        // the swoop: off the last letter, back under the lot
        c.moveTo(last.x + size * 0.2, last.y + size * 0.1);
        c.bezierCurveTo(last.x + size * 0.6, last.y + size * 0.55, first.x - size * 0.2, size * 0.75, first.x - size * 0.45, size * 0.38);
      } else if (k < 0.7) {
        // a crown over the first letter
        const x = first.x, y = first.y - size * 0.62;
        c.moveTo(x - size * 0.22, y + size * 0.12);
        c.lineTo(x - size * 0.16, y - size * 0.1);
        c.lineTo(x - size * 0.06, y + size * 0.05);
        c.lineTo(x + size * 0.02, y - size * 0.14);
        c.lineTo(x + size * 0.1, y + size * 0.05);
        c.lineTo(x + size * 0.2, y - size * 0.1);
        c.lineTo(x + size * 0.24, y + size * 0.12);
      } else {
        // a straight underline, flicked at the end
        c.moveTo(first.x - size * 0.3, size * 0.5);
        c.lineTo(last.x + size * 0.3, size * 0.45);
        c.lineTo(last.x + size * 0.42, size * 0.3);
      }
      c.stroke();
    }, marker ? 1.2 : 3.5, marker ? 0.15 : 0.35);
    c.restore();
    // the crew, small, after it
    if (scale <= 1 && r() < 0.55) {
      const cf = (s: number) => `${s}px ${F_MARKER}`;
      c.save();
      c.translate(G[G.length - 1].x + size * 0.35, size * 0.42);
      c.rotate(-0.12);
      c.font = cf(size * 0.28);
      c.fillStyle = col;
      c.textAlign = 'left';
      c.fillText(pick(CREWS), 0, 0);
      c.restore();
    }
    if (!marker) drips(2 + Math.floor(r() * 5), -cw * 0.3, cw * 0.3, size * 0.25, col, 3.5, 70);
    return size;
  };

  // ---- a piece
  const FADES: [string, string, string][] = [
    ['#ff4f9a', '#ffcf3a', '#ffffff'], ['#3ec5ff', '#2b44e0', '#c8f1ff'], ['#9cf25a', '#178a4d', '#f3ff7a'], ['#ffb43a', '#e5322d', '#fff1a0'],
    ['#c18bff', '#ff5ec4', '#ffffff'], ['#f2f2ee', '#8fd3ff', '#ff6fb0'], ['#ffe14a', '#ff7a1f', '#ffffff'], ['#5ef0d3', '#8a3cf0', '#ffffff'],
  ];
  const CLOUDS = ['#1e2a6e', '#5a1640', '#173d2a', '#e8e4dc', '#2a2a2a', '#7a1c14'];
  const DROPS = ['#1a0f2e', '#0f1a33', '#2a0d0d', '#101010', '#3a2a0a'];
  const piece = (t: string) => {
    const [ca, cb, band] = pick(FADES);
    const cloud = pick(CLOUDS), drop = pick(DROPS);
    const font = (s: number) => `${s}px ${F_PIECE}`;
    const size = fit(t, font, cw * 0.93, 290, 0.84, 0.36, ch * 0.9);
    c.translate(0, -ch * 0.02);
    const G = run(t, size, font, 0.84, 0.08, 0.18, [0.92, 1.12]);
    const fat = size * 0.07, key = size * 0.05;
    // the cloud behind, with its own black keyline, and a few bubbles off it
    const cl = fat + key + size * 0.2;
    sprayed('#0d0d0d', () => G.forEach((g) => blob(c, g, font, cl + key * 0.8, '#0d0d0d')), 16, 0.3);
    G.forEach((g) => blob(c, g, font, cl, cloud));
    for (let i = 0; i < 5; i++) {
      const x = rnd(r, -cw * 0.4, cw * 0.4), y = rnd(r, -ch * 0.3, ch * 0.3), rr = rnd(r, 6, 14);
      c.fillStyle = '#0d0d0d';
      c.beginPath();
      c.arc(x, y, rr + key * 0.6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = cloud;
      c.beginPath();
      c.arc(x, y, rr, 0, Math.PI * 2);
      c.fill();
    }
    // the 3D drop: down and to one side, solid, behind every letter
    const dx = rnd(r, 0.6, 1) * (r() < 0.5 ? 1 : -1), dy = 1;
    for (let k = 16; k > 0; k--) G.forEach((g) => blob(c, g, font, fat + key, drop, dx * k * 1.3, dy * k * 1.15));
    // letter by letter: outline, then the fill painted inside it
    const top = -size * 0.55, bot = size * 0.55;
    const grain = fillPattern('rgba(0,0,0,0)', A.x);
    for (const g of G) {
      blob(c, g, font, fat + key, '#0b0b0b');
      clear(A.x);
      blob(A.x, g, font, fat, '#fff');
      A.x.globalCompositeOperation = 'source-atop';
      const gr = A.x.createLinearGradient(0, top, 0, bot);
      gr.addColorStop(0, ca);
      gr.addColorStop(0.48, ca);
      gr.addColorStop(0.62, cb);
      gr.addColorStop(1, cb);
      A.x.fillStyle = gr;
      A.x.fillRect(-cw / 2, -ch / 2, cw, ch);
      A.x.globalAlpha = 0.5;
      A.x.fillStyle = grain;
      A.x.fillRect(-cw / 2, -ch / 2, cw, ch);
      A.x.globalAlpha = 1;
      // the band cut through the fade, a zigzag of a third colour
      A.x.fillStyle = band;
      A.x.beginPath();
      const yb = size * 0.04;
      A.x.moveTo(-cw / 2, yb);
      for (let x = -cw / 2; x <= cw / 2; x += 26) A.x.lineTo(x, yb + ((x / 26) % 2 === 0 ? -10 : 10));
      for (let x = cw / 2; x >= -cw / 2; x -= 26) A.x.lineTo(x, yb + 16 + ((x / 26) % 2 === 0 ? -10 : 10));
      A.x.closePath();
      A.x.fill();
      // a few bubbles of the other colour inside, as writers dot them
      A.x.fillStyle = cb;
      for (let i = 0; i < 6; i++) {
        A.x.beginPath();
        A.x.arc(rnd(r, -cw * 0.4, cw * 0.4), rnd(r, -size * 0.45, -size * 0.1), rnd(r, 3, 9), 0, Math.PI * 2);
        A.x.fill();
      }
      A.x.globalCompositeOperation = 'source-over';
      blit(A.x);
    }
    shine(G, font, fat, size * 0.03, 0.9);
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) star(rnd(r, -cw * 0.3, cw * 0.3), rnd(r, -size * 0.5, size * 0.1), rnd(r, 14, 30));
    drips(3 + Math.floor(r() * 4), -cw * 0.3, cw * 0.3, size * 0.48, cb, 4, 50);
  };

  // ---- a blockbuster
  const block = (t: string) => {
    const [ca, cb] = pick(FADES);
    const drop = pick(DROPS);
    const font = (s: number) => `${s}px ${F_BLOCK}`;
    const size = fit(t, font, cw * 0.78, 220, 0.96);
    const G = run(t, size, font, 0.96, 0.02, 0.03, [0.98, 1.02]);
    for (let k = 14; k > 0; k--) G.forEach((g) => blob(c, g, font, size * 0.04, drop, k * 1.5, k * 1.2));
    G.forEach((g) => blob(c, g, font, size * 0.05, '#0b0b0b'));
    clear(A.x);
    G.forEach((g) => blob(A.x, g, font, size * 0.015, '#fff'));
    A.x.globalCompositeOperation = 'source-atop';
    A.x.fillStyle = ca;
    A.x.fillRect(-cw / 2, -ch / 2, cw, ch / 2 + size * 0.04);
    A.x.fillStyle = cb;
    A.x.fillRect(-cw / 2, size * 0.04, cw, ch / 2);
    A.x.fillStyle = 'rgba(255,255,255,0.7)';
    A.x.fillRect(-cw / 2, -size * 0.36, cw, size * 0.045);
    A.x.globalCompositeOperation = 'source-over';
    blit(A.x);
    star(rnd(r, -cw * 0.3, cw * 0.3), -size * 0.35, 22);
    drips(5, -cw * 0.35, cw * 0.35, size * 0.4, cb, 4, 50);
  };

  const stencil = (t: string) => {
    const col = pick(['#141414', '#8a1010', '#1b1b1b']);
    const font = (s: number) => `${s}px ${F_BLOCK}`;
    const size = fit(t, font, cw * 0.84, 170);
    c.font = font(size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = col;
    for (let i = 0; i < 1600; i++) {
      c.globalAlpha = rnd(r, 0.08, 0.35);
      c.fillRect(rnd(r, -cw * 0.46, cw * 0.46), rnd(r, -ch * 0.4, ch * 0.4), 2, 2);
    }
    c.globalAlpha = 1;
    c.fillText(t, 0, 0);
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (let x = -cw * 0.46; x < cw * 0.46; x += size * 0.36) c.fillRect(x, -size * 0.6, size * 0.04, size * 1.2);
    c.restore();
  };
  const eye = () => {
    const col = pick(['#141414', '#8a1010', '#e9e6dc']);
    c.strokeStyle = col;
    c.lineWidth = 16;
    c.lineCap = 'round';
    sprayed(col, () => {
      c.beginPath();
      c.moveTo(-220, 0);
      c.quadraticCurveTo(0, -160, 220, 0);
      c.quadraticCurveTo(0, 160, -220, 0);
      c.moveTo(60, 0);
      c.arc(0, 0, 60, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = col;
      c.beginPath();
      c.arc(0, 0, 24, 0, Math.PI * 2);
      c.fill();
    }, 10);
    drips(5, -160, 160, 70, col, 5);
  };

  for (let i = 0; i < G_COLS * G_ROWS; i++) {
    const x0 = (i % G_COLS) * cw, y0 = Math.floor(i / G_COLS) * ch;
    c.save();
    c.beginPath();
    c.rect(x0 + 4, y0 + 4, cw - 8, ch - 8);
    c.clip();
    c.translate(x0 + cw / 2, y0 + ch / 2);
    c.rotate(rnd(r, -0.05, 0.05));
    const k = gKind(i);
    if (k === 0) throwUp(NAMES[i]);
    else if (k === 1) tag(NAMES[i], pick(['#0e0e0e', '#0e0e0e', '#c9ccd0', '#b3151c', '#1f37b5', '#ecebe6', '#f3d23a']), i % 2 === 1);
    else if (k === 2) {
      const col = pick(['#6e0b08', '#141414', '#5a0907']);
      const s = tag(WORDS[i - 16], col, i % 3 === 0, 1.2);
      drips(10, -cw * 0.4, cw * 0.4, s * 0.25, col, 4, 110);
    } else if (k === 3) piece(NAMES[(i + 5) % NAMES.length]);
    else if (k === 4) block(NAMES[(i + 11) % NAMES.length]);
    else if (i === 30) stencil(pick(STENCIL));
    else eye();
    c.restore();
    // years of it: worn through in patches, scratched, flaking
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < 16; n++) {
      c.globalAlpha = rnd(r, 0.04, 0.16);
      c.beginPath();
      c.ellipse(x0 + rnd(r, 0, cw), y0 + rnd(r, 0, ch), rnd(r, 6, 34), rnd(r, 4, 20), rnd(r, 0, 3), 0, Math.PI * 2);
      c.fill();
    }
    for (let n = 0; n < 500; n++) {
      c.globalAlpha = rnd(r, 0.3, 0.8);
      const sz = rnd(r, 1, 3.5);
      c.fillRect(x0 + rnd(r, 0, cw), y0 + rnd(r, 0, ch), sz, sz * rnd(r, 0.5, 1.5));
    }
    c.globalAlpha = 0.55;
    c.lineWidth = 1.4;
    for (let n = 0; n < 22; n++) {
      c.beginPath();
      const x = x0 + rnd(r, 0, cw), y = y0 + rnd(r, 0, ch);
      c.moveTo(x, y);
      c.lineTo(x + rnd(r, -90, 90), y + rnd(r, -30, 30));
      c.stroke();
    }
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ posters, pasted up and left

const P_COLS = 4, P_ROWS = 2;

function posterAtlas(): THREE.CanvasTexture {
  const W = 2048, H = 2048, cw = W / P_COLS, ch = H / P_ROWS;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  const r = mulberry(17);
  const SANS = '"Helvetica Neue", Arial, sans-serif', SERIF = 'Georgia, "Times New Roman", serif', MONO = '"Courier New", monospace';
  const text = (t: string, x: number, y: number, size: number, font: string, col: string, align: CanvasTextAlign = 'center', weight = 'bold') => {
    c.font = `${weight} ${size}px ${font}`;
    // never off the sheet
    while (c.measureText(t).width > cw - 100 && size > 16) {
      size -= 4;
      c.font = `${weight} ${size}px ${font}`;
    }
    c.fillStyle = col;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(t, x, y);
  };
  const lines = (x: number, y: number, w: number, n: number, gap: number, col: string) => {
    c.fillStyle = col;
    for (let i = 0; i < n; i++) c.fillRect(x, y + i * gap, w * rnd(r, 0.6, 1), gap * 0.35);
  };
  const face = (x: number, y: number, w: number, h: number) => {
    // a grainy photo: someone's head and shoulders, too dark to know
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#6d6a64');
    g.addColorStop(1, '#2c2a27');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.fillStyle = '#1b1a18';
    c.beginPath();
    c.ellipse(x + w / 2, y + h * 0.42, w * 0.2, h * 0.24, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(x + w / 2, y + h * 1.0, w * 0.42, h * 0.32, 0, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 1500; i++) {
      c.fillStyle = `rgba(255,255,255,${rnd(r, 0, 0.12)})`;
      c.fillRect(x + rnd(r, 0, w), y + rnd(r, 0, h), 2, 2);
    }
  };
  const designs: ((w: number, h: number) => void)[] = [
    // missing
    (w, h) => {
      text('MISSING', w / 2, h * 0.1, 150, SANS, '#b01515');
      face(w * 0.15, h * 0.18, w * 0.7, h * 0.4);
      text('HAVE YOU SEEN', w / 2, h * 0.64, 48, SANS, '#151515');
      text('ELLEN MARSH', w / 2, h * 0.7, 72, SANS, '#151515');
      text('Age 34. Last seen 14 October', w / 2, h * 0.77, 34, SANS, '#2a2a2a', 'center', 'normal');
      lines(w * 0.1, h * 0.82, w * 0.8, 4, 26, 'rgba(30,30,30,0.7)');
      text('PLEASE CALL', w / 2, h * 0.95, 44, SANS, '#151515');
    },
    // a notice from the council
    (w, h) => {
      c.fillStyle = '#1a1a1a';
      c.fillRect(0, 0, w, h * 0.16);
      text('NOTICE', w / 2, h * 0.08, 120, SANS, '#f2f2ee');
      text('THIS BUILDING IS', w / 2, h * 0.24, 54, SANS, '#151515');
      text('CONDEMNED', w / 2, h * 0.32, 104, SANS, '#b01515');
      text('Unsafe structure. Entry prohibited.', w / 2, h * 0.41, 32, SANS, '#2a2a2a', 'center', 'normal');
      lines(w * 0.1, h * 0.47, w * 0.8, 14, 30, 'rgba(30,30,30,0.6)');
      text('By order of the Borough', w / 2, h * 0.93, 34, SERIF, '#2a2a2a', 'center', 'italic');
    },
    // a gig, long gone
    (w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2a0f3a');
      g.addColorStop(1, '#0a0a12');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8c547';
      c.beginPath();
      c.arc(w / 2, h * 0.36, w * 0.28, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0a0a12';
      for (let i = 0; i < 7; i++) c.fillRect(w * 0.18, h * (0.3 + i * 0.03), w * 0.64, h * 0.012);
      text('THE HOLLOW', w / 2, h * 0.7, 100, SANS, '#f0ece2');
      text('SAINTS', w / 2, h * 0.78, 110, SANS, '#f0ece2');
      text('LIVE · ONE NIGHT ONLY', w / 2, h * 0.87, 40, SANS, '#e8c547');
      text('doors 8pm', w / 2, h * 0.93, 34, SANS, '#b0aca0', 'center', 'normal');
    },
    // quarantine
    (w, h) => {
      c.fillStyle = '#e9c21b';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#121212';
      for (let i = -4; i < 14; i++) {
        c.beginPath();
        c.moveTo(i * 80, 0);
        c.lineTo(i * 80 + 40, 0);
        c.lineTo(i * 80 + 40 - 120, 120);
        c.lineTo(i * 80 - 120, 120);
        c.fill();
      }
      c.fillRect(0, h - 40, w, 40);
      text('QUARANTINE', w / 2, h * 0.24, 92, SANS, '#121212');
      text('AREA', w / 2, h * 0.33, 120, SANS, '#121212');
      c.lineWidth = 16;
      c.strokeStyle = '#121212';
      c.beginPath();
      c.arc(w / 2, h * 0.56, w * 0.17, 0, Math.PI * 2);
      c.stroke();
      text('!', w / 2, h * 0.565, 200, SANS, '#121212');
      text('DO NOT ENTER WITHOUT', w / 2, h * 0.76, 40, SANS, '#121212');
      text('AUTHORISATION', w / 2, h * 0.81, 54, SANS, '#121212');
    },
    // a lost dog
    (w, h) => {
      text('LOST DOG', w / 2, h * 0.1, 120, SANS, '#151515');
      c.fillStyle = '#5a4a38';
      c.fillRect(w * 0.15, h * 0.18, w * 0.7, h * 0.36);
      c.fillStyle = '#2a2018';
      c.beginPath();
      c.ellipse(w * 0.5, h * 0.4, w * 0.2, h * 0.1, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(w * 0.36, h * 0.3, w * 0.08, h * 0.06, 0, 0, Math.PI * 2);
      c.fill();
      text('"BISCUIT"', w / 2, h * 0.62, 72, SANS, '#151515');
      lines(w * 0.12, h * 0.69, w * 0.76, 5, 28, 'rgba(30,30,30,0.6)');
      // the tear-off strips along the foot, most of them gone
      for (let i = 0; i < 9; i++) {
        if (r() < 0.6) continue;
        c.fillStyle = 'rgba(20,20,20,0.7)';
        c.save();
        c.translate(w * (0.08 + i * 0.105), h * 0.92);
        c.rotate(-Math.PI / 2);
        c.font = `20px ${SANS}`;
        c.fillText('call 0161 ...', 0, 0);
        c.restore();
      }
    },
    // a film nobody saw
    (w, h) => {
      c.fillStyle = '#0d0d0f';
      c.fillRect(0, 0, w, h);
      const g = c.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h * 0.4, w * 0.6);
      g.addColorStop(0, '#8b1a14');
      g.addColorStop(1, '#0d0d0f');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h * 0.75);
      c.fillStyle = '#050505';
      c.beginPath();
      c.ellipse(w / 2, h * 0.45, w * 0.13, h * 0.2, 0, 0, Math.PI * 2);
      c.fill();
      text('NIGHT', w / 2, h * 0.8, 130, SERIF, '#e8e2d2');
      text('SHIFT', w / 2, h * 0.89, 130, SERIF, '#e8e2d2');
      text('IN CINEMAS', w / 2, h * 0.96, 30, SANS, '#a09a8a', 'center', 'normal');
    },
    // an evacuation route
    (w, h) => {
      c.fillStyle = '#1d6b3a';
      c.fillRect(0, 0, w, h * 0.14);
      text('FIRE EVACUATION', w / 2, h * 0.07, 62, SANS, '#ffffff');
      c.strokeStyle = '#2a2a2a';
      c.lineWidth = 4;
      for (let i = 0; i < 9; i++) c.strokeRect(w * (0.08 + (i % 3) * 0.28), h * (0.2 + Math.floor(i / 3) * 0.17), w * 0.26, h * 0.15);
      c.strokeStyle = '#b01515';
      c.lineWidth = 10;
      c.beginPath();
      c.moveTo(w * 0.2, h * 0.3);
      c.lineTo(w * 0.5, h * 0.3);
      c.lineTo(w * 0.5, h * 0.66);
      c.lineTo(w * 0.85, h * 0.66);
      c.stroke();
      c.fillStyle = '#b01515';
      c.beginPath();
      c.arc(w * 0.2, h * 0.3, 18, 0, Math.PI * 2);
      c.fill();
      text('YOU ARE HERE', w * 0.2, h * 0.36, 26, SANS, '#b01515');
      lines(w * 0.08, h * 0.76, w * 0.84, 6, 30, 'rgba(30,30,30,0.6)');
    },
    // a typed page someone pinned up, written over
    (w, h) => {
      text('WE ARE STILL', w / 2, h * 0.08, 60, MONO, '#151515');
      text('IN THE BUILDING', w / 2, h * 0.14, 60, MONO, '#151515');
      lines(w * 0.08, h * 0.22, w * 0.84, 18, 34, 'rgba(25,25,25,0.75)');
      c.save();
      c.translate(w * 0.5, h * 0.86);
      c.rotate(-0.12);
      text('THEY LIED', 0, 0, 96, F_MARKER, '#9a0e0e');
      c.restore();
    },
  ];
  designs.forEach((d, i) => {
    const x0 = (i % P_COLS) * cw, y0 = Math.floor(i / P_COLS) * ch;
    const w = cw - 40, h = ch - 40;
    c.save();
    c.translate(x0 + 20, y0 + 20);
    // the paper: off-white gone yellow
    c.fillStyle = `rgb(${226 + r() * 14},${216 + r() * 12},${190 + r() * 14})`;
    c.fillRect(0, 0, w, h);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    d(w, h);
    // age: a water stain, foxing, a fold across it
    const g = c.createRadialGradient(w * rnd(r, 0.2, 0.8), h * rnd(r, 0.5, 1), 10, w / 2, h * 0.8, h * 0.6);
    g.addColorStop(0, 'rgba(120,90,40,0.35)');
    g.addColorStop(1, 'rgba(120,90,40,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let k = 0; k < 140; k++) {
      c.fillStyle = `rgba(110,80,40,${rnd(r, 0.05, 0.25)})`;
      c.beginPath();
      c.arc(rnd(r, 0, w), rnd(r, 0, h), rnd(r, 1, 6), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(0, h * rnd(r, 0.45, 0.55), w, 3);
    c.restore();
    // torn: a corner gone, a bite out of an edge; tape where it's held
    c.save();
    c.translate(x0 + 20, y0 + 20);
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    const cx = r() < 0.5 ? 0 : w, cy = r() < 0.5 ? 0 : h;
    c.moveTo(cx, cy);
    c.lineTo(cx + (cx ? -1 : 1) * rnd(r, 60, 180), cy);
    for (let k = 0; k < 6; k++) c.lineTo(cx + (cx ? -1 : 1) * rnd(r, 0, 120), cy + (cy ? -1 : 1) * rnd(r, 0, 120));
    c.lineTo(cx, cy + (cy ? -1 : 1) * rnd(r, 60, 180));
    c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(220,210,170,0.65)';
    for (const [tx, ty] of [[0.5, 0], [0.02, 0.5], [0.98, 0.5]]) {
      if (r() < 0.4) continue;
      c.save();
      c.translate(tx * w, ty * h);
      c.rotate(rnd(r, -0.6, 0.6));
      c.fillRect(-36, -12, 72, 24);
      c.restore();
    }
    c.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ papers underfoot

const Q_COLS = 4, Q_ROWS = 4;

function paperAtlas(): THREE.CanvasTexture {
  const S = 2048, cw = S / Q_COLS;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, S, S);
  const r = mulberry(5);
  const lines = (x: number, y: number, w: number, n: number, gap: number, col: string, hgt = 0.32) => {
    c.fillStyle = col;
    for (let i = 0; i < n; i++) if (r() > 0.06) c.fillRect(x, y + i * gap, w * rnd(r, 0.55, 1), gap * hgt);
  };
  for (let i = 0; i < Q_COLS * Q_ROWS; i++) {
    const x0 = (i % Q_COLS) * cw, y0 = Math.floor(i / Q_COLS) * cw;
    const kind = i % 8;
    // an A4 sheet standing in the cell (taller than wide), or a newspaper spread
    const w = kind === 3 ? cw * 0.92 : cw * 0.66, h = kind === 3 ? cw * 0.68 : cw * 0.92;
    c.save();
    c.translate(x0 + cw / 2, y0 + cw / 2);
    c.translate(-w / 2, -h / 2);
    const tone = kind === 3 ? [176, 170, 152] : kind === 6 ? [180, 160, 118] : [196, 190, 172];
    c.fillStyle = `rgb(${tone[0] + rnd(r, -10, 6)},${tone[1] + rnd(r, -10, 6)},${tone[2] + rnd(r, -10, 6)})`;
    c.fillRect(0, 0, w, h);
    c.save();
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    if (kind === 0) {
      // a typed letter
      c.fillStyle = '#222';
      c.fillRect(w * 0.1, h * 0.06, w * 0.35, 10);
      lines(w * 0.1, h * 0.14, w * 0.8, 22, 16, 'rgba(25,25,25,0.75)');
    } else if (kind === 1) {
      // a form with boxes
      c.strokeStyle = 'rgba(30,30,30,0.7)';
      c.lineWidth = 2;
      for (let k = 0; k < 9; k++) c.strokeRect(w * 0.08, h * (0.1 + k * 0.09), w * 0.84, h * 0.07);
      lines(w * 0.1, h * 0.12, w * 0.3, 9, h * 0.09, 'rgba(25,25,25,0.6)', 0.18);
      lines(w * 0.45, h * 0.125, w * 0.35, 9, h * 0.09, 'rgba(20,30,90,0.6)', 0.15);
    } else if (kind === 2) {
      // a chart: a grid and a line that falls away
      c.strokeStyle = 'rgba(80,120,160,0.4)';
      c.lineWidth = 1;
      for (let k = 0; k < 20; k++) {
        c.beginPath();
        c.moveTo(0, h * 0.2 + k * h * 0.04);
        c.lineTo(w, h * 0.2 + k * h * 0.04);
        c.stroke();
      }
      c.strokeStyle = '#a01818';
      c.lineWidth = 3;
      c.beginPath();
      for (let k = 0; k <= 12; k++) c.lineTo(w * (0.08 + k * 0.07), h * (0.4 + Math.sin(k) * 0.05 + (k > 8 ? (k - 8) * 0.08 : 0)));
      c.stroke();
      lines(w * 0.08, h * 0.06, w * 0.6, 3, 16, 'rgba(25,25,25,0.7)');
    } else if (kind === 3) {
      // a newspaper: columns, a headline, a photo
      c.fillStyle = '#1a1a1a';
      c.font = `bold ${Math.round(h * 0.11)}px Georgia, serif`;
      c.fillText('BODIES FOUND', w * 0.05, h * 0.14);
      c.fillStyle = '#58554e';
      c.fillRect(w * 0.05, h * 0.2, w * 0.38, h * 0.38);
      for (let col = 0; col < 3; col++) lines(w * (0.47 + col * 0.17), h * 0.2, w * 0.15, 30, 10, 'rgba(25,25,25,0.6)', 0.4);
      lines(w * 0.05, h * 0.62, w * 0.38, 18, 10, 'rgba(25,25,25,0.6)', 0.4);
    } else if (kind === 4) {
      // a page torn from a notebook, written on in a hurry
      c.strokeStyle = 'rgba(70,110,170,0.4)';
      for (let k = 0; k < 22; k++) {
        c.beginPath();
        c.moveTo(0, h * 0.08 + k * h * 0.042);
        c.lineTo(w, h * 0.08 + k * h * 0.042);
        c.stroke();
      }
      c.fillStyle = '#1b2a6a';
      c.font = `${Math.round(h * 0.06)}px ${'"Bradley Hand", "Segoe Print", cursive'}`;
      const said = ["they're in the walls", 'dont go down', 'to the cellar', "it knows we're here", 'count the doors'];
      for (let k = 0; k < said.length; k++) c.fillText(said[(k + i) % said.length], w * 0.08, h * (0.16 + k * 0.1));
    } else if (kind === 5) {
      // a photograph, face down half the time
      if (r() < 0.5) {
        c.fillStyle = '#efece4';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#4a4740';
        c.fillRect(w * 0.06, h * 0.05, w * 0.88, h * 0.72);
        c.fillStyle = '#2a2824';
        c.beginPath();
        c.ellipse(w * 0.4, h * 0.38, w * 0.12, h * 0.14, 0, 0, Math.PI * 2);
        c.ellipse(w * 0.62, h * 0.4, w * 0.11, h * 0.13, 0, 0, Math.PI * 2);
        c.fill();
      } else lines(w * 0.1, h * 0.1, w * 0.4, 2, 18, 'rgba(60,60,160,0.5)');
    } else if (kind === 6) {
      // a brown file folder
      c.fillStyle = 'rgba(120,90,40,0.25)';
      c.fillRect(0, 0, w, h * 0.06);
      c.fillStyle = '#1a1a1a';
      c.font = `bold ${Math.round(h * 0.05)}px "Courier New", monospace`;
      c.fillText('CASE FILE', w * 0.1, h * 0.14);
      c.fillText('No. ' + (1000 + Math.floor(r() * 8999)), w * 0.1, h * 0.21);
    } else {
      // a printed page, mostly text
      lines(w * 0.1, h * 0.08, w * 0.8, 30, 13, 'rgba(25,25,25,0.7)');
    }
    // dirt, a boot print, a crease or two
    for (let k = 0; k < 60; k++) {
      c.fillStyle = `rgba(70,60,45,${rnd(r, 0.03, 0.2)})`;
      c.beginPath();
      c.arc(rnd(r, 0, w), rnd(r, 0, h), rnd(r, 2, 14), 0, Math.PI * 2);
      c.fill();
    }
    if (r() < 0.5) {
      c.fillStyle = 'rgba(40,32,24,0.28)';
      c.save();
      c.translate(w * rnd(r, 0.3, 0.7), h * rnd(r, 0.3, 0.7));
      c.rotate(rnd(r, 0, 6));
      for (let k = 0; k < 7; k++) c.fillRect(-60 + k * 18, -24, 10, 48);
      c.restore();
    }
    c.fillStyle = 'rgba(0,0,0,0.1)';
    c.fillRect(0, h * rnd(r, 0.3, 0.7), w, 2);
    c.fillRect(w * rnd(r, 0.3, 0.7), 0, 2, h);
    c.restore();
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

type Room = { name: string; a: number[]; b: number[] };

/** everything this file lays down */
// ------------------------------------------------------------------ trench boards

const SIGNS = ['PICCADILLY', 'BOND ST', 'REGENT ST', 'FRONT LINE \u2192', 'BN. H.Q.', 'SAP 4 \u2014 KEEP LOW', 'SNIPER!|KEEP YOUR HEAD DOWN', '\u2190 TO FRONT LINE',
  'KAISERSTRASSE', 'LINDENWEG', 'BERLINER GASSE', 'VORDERER GRABEN \u2192', 'BTL. GEF. STAND', 'SAPPE 7 \u2014 B\u00dcCKEN!', 'ACHTUNG!|SCHARFSCH\u00dcTZE', '\u2190 ZUM VORDEREN GRABEN'];

/** boards nailed up in a trench: two or three planks, weathered, the name painted on by hand, and the warnings */
export function signAtlas(): THREE.CanvasTexture {
  const COLS = 4, ROWS = 4, W = 2048, H = 2048, cw = W / COLS, ch = H / ROWS / 2;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H / 2;
  const c = cv.getContext('2d')!;
  const r = mulberry(1916);
  SIGNS.forEach((t, i) => {
    const x0 = (i % COLS) * cw, y0 = Math.floor(i / COLS) * ch;
    c.save();
    c.translate(x0, y0);
    const n = 2 + Math.floor(r() * 2);
    const mx = 10, my = 14;
    const bh = (ch - my * 2) / n;
    for (let k = 0; k < n; k++) {
      const y = my + k * bh;
      const base = 48 + Math.floor(r() * 26);
      c.fillStyle = `rgb(${base + 22},${base + 8},${base - 10})`;
      c.beginPath();
      c.moveTo(mx + rnd(r, 0, 12), y + 2);
      c.lineTo(cw - mx - rnd(r, 0, 12), y + rnd(r, 0, 4));
      c.lineTo(cw - mx - rnd(r, 0, 8), y + bh - 3);
      c.lineTo(mx + rnd(r, 0, 8), y + bh - rnd(r, 2, 6));
      c.closePath();
      c.fill();
      // the grain, and the dark of the gaps between boards
      c.save();
      c.clip();
      for (let g = 0; g < 26; g++) {
        c.strokeStyle = `rgba(${r() < 0.5 ? '20,12,6' : '120,100,80'},${rnd(r, 0.08, 0.22)})`;
        c.lineWidth = rnd(r, 1, 3);
        const gy = y + rnd(r, 0, bh);
        c.beginPath();
        c.moveTo(0, gy);
        c.bezierCurveTo(cw * 0.3, gy + rnd(r, -6, 6), cw * 0.6, gy + rnd(r, -6, 6), cw, gy + rnd(r, -4, 4));
        c.stroke();
      }
      c.fillStyle = 'rgba(10,8,6,0.5)';
      c.fillRect(0, y + bh - 4, cw, 4);
      c.restore();
      // the nails, a streak of rust under each
      for (const nx of [mx + 22, cw - mx - 22]) {
        c.fillStyle = '#2a1c12';
        c.beginPath();
        c.arc(nx, y + bh / 2, 4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(90,40,15,0.35)';
        c.fillRect(nx - 2, y + bh / 2, 4, rnd(r, 10, 30));
      }
    }
    // the words, painted by somebody with a brush and not much time
    const lines = t.split('|');
    const paint = i % 8 === 6 ? '#b02618' : r() < 0.75 ? '#e6e1d4' : '#151210';
    c.fillStyle = paint;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const fam = i % 2 ? '"LF Marker", "Marker Felt", sans-serif' : '"LF Block", Impact, sans-serif';
    lines.forEach((ln, k) => {
      let size = lines.length > 1 ? 64 : 92;
      c.font = `${size}px ${fam}`;
      while (c.measureText(ln).width > cw - 70 && size > 20) {
        size -= 4;
        c.font = `${size}px ${fam}`;
      }
      const ty = ch / 2 + (k - (lines.length - 1) / 2) * size * 1.05;
      c.save();
      c.translate(cw / 2, ty);
      c.rotate(rnd(r, -0.025, 0.025));
      c.globalAlpha = 0.92;
      c.fillText(ln, 0, 0);
      // the brush ran out here and there
      c.globalCompositeOperation = 'destination-out';
      for (let q = 0; q < 40; q++) {
        c.globalAlpha = rnd(r, 0.1, 0.5);
        c.fillRect(rnd(r, -cw / 2, cw / 2), rnd(r, -size / 2, size / 2), rnd(r, 4, 30), rnd(r, 1, 3));
      }
      c.restore();
      if (r() < 0.6) {
        c.save();
        c.fillStyle = paint;
        c.globalAlpha = 0.85;
        for (let q = 0; q < 3; q++) c.fillRect(rnd(r, cw * 0.2, cw * 0.8), ty + size * 0.35, 3, rnd(r, 8, 40));
        c.restore();
      }
    });
    // mud splashed up from the duckboards
    for (let q = 0; q < 60; q++) {
      c.fillStyle = `rgba(40,28,16,${rnd(r, 0.15, 0.5)})`;
      c.beginPath();
      c.arc(rnd(r, 0, cw), ch - rnd(r, 0, ch * 0.35) ** 1.2, rnd(r, 1, 6), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** the boards on a map's trench walls */
export function trenchSigns(list: number[][]): THREE.Mesh {
  const sheet = new Sheet(signAtlas(), 4, 4, 2, Math.max(1, list.length), 0.85, 'lfsign', 3);
  for (const g of list) sheet.add(g[0], g[1], g[2], new THREE.Vector3(g[3], 0, g[4]), g[6], g[5], 0, 0.012);
  return sheet.mesh;
}

export class Graffiti {
  readonly group = new THREE.Group();
  readonly paint = new Sheet(graffitiAtlas(), G_COLS, G_ROWS, 2, 640, 0.7, 'lfgraffiti', 2);
  readonly posters = new Sheet(posterAtlas(), P_COLS, P_ROWS, 0.5, 220, 0.85, 'lfposter', 3);
  readonly papers = new Sheet(paperAtlas(), Q_COLS, Q_ROWS, 1, 2600, 0.9, 'lfpaper', 2);
  constructor() {
    this.group.add(this.paint.mesh, this.posters.mesh, this.papers.mesh);
  }
  /** the old single-sheet call */
  get mesh() {
    return this.paint.mesh;
  }
}

/** a flat run of wall w wide and h tall facing back along (dx, dz) from p, or null */
function wallAt(world: World, px: number, py: number, pz: number, dx: number, dz: number, far: number, w: number, h: number) {
  const hit = world.ray(px, py, pz, dx, 0, dz, far, true, true);
  if (!hit || hit.t < 0.4 || Math.abs(hit.ny) > 0.1) return null;
  const tx = -dz, tz = dx;
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0.5], [0, -0.5]]) {
    const h2 = world.ray(px + tx * a * w, py + b * h, pz + tz * a * w, dx, 0, dz, far, true, true);
    if (!h2 || Math.abs(h2.t - hit.t) > 0.04) return null;
  }
  return { x: px + dx * hit.t, y: py, z: pz + dz * hit.t, n: new THREE.Vector3(-dx, 0, -dz), tx, tz };
}

/** paint the walls, paste them up, litter the floors and soak a few rooms, the same way on every machine for a map */
export function markUp(rooms: Room[], world: World, fx: Fx, g: Graffiti, seed: number) {
  const r = mulberry(seed);
  const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let soaked = 0;
  const soakedRooms: string[] = [];
  const usable = rooms.filter((q) => !/stair|well/.test(q.name) && q.b[1] - q.a[1] > 2.2 && q.b[0] - q.a[0] > 1.6 && q.b[2] - q.a[2] > 1.6);
  const order = usable.map((q) => [r(), q] as const).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const worst = new Set(order.filter((q) => (q.b[0] - q.a[0]) * (q.b[2] - q.a[2]) > 9).slice(0, Math.max(2, Math.round(usable.length / 6))));
  for (const q of usable) {
    const [x0, y0, z0] = q.a, [x1, , z1] = q.b;
    const W = x1 - x0, D = z1 - z0;
    const long = Math.max(W, D) > 10;
    // graffiti: most rooms, the long ones more; a piece with a tag or two round it
    const want = r() < 0.85 ? 1 + Math.floor(r() * (long ? 6 : 3)) : 0;
    for (let k = 0, got = 0; k < want * 10 && got < want; k++) {
      const [dx, dz] = DIRS[Math.floor(r() * 4)];
      const px = rnd(r, x0 + 0.5, x1 - 0.5), pz = rnd(r, z0 + 0.5, z1 - 0.5);
      // what goes up: pieces on the long runs, throw-ups everywhere, tags most of all, warnings now and then
      const q = r();
      const cell = q < 0.22 ? 22 + Math.floor(r() * 6) : q < 0.5 ? Math.floor(r() * 8) : q < 0.78 ? 8 + Math.floor(r() * 8) : q < 0.9 ? 16 + Math.floor(r() * 6) : q < 0.96 ? 28 + Math.floor(r() * 2) : 30 + Math.floor(r() * 2);
      const kind = gKind(cell);
      const w = kind === 3 ? rnd(r, 2.4, 3.6) : kind === 0 ? rnd(r, 1.5, 2.4) : kind === 1 ? rnd(r, 0.7, 1.3) : kind === 4 ? rnd(r, 2.0, 3.0) : rnd(r, 1.2, 2.2);
      const y = y0 + (kind === 3 || kind === 4 ? rnd(r, 1.15, 1.45) : rnd(r, 1.0, 1.8));
      const s = wallAt(world, px, y, pz, dx, dz, Math.max(W, D), w, w * 0.5);
      if (!s) continue;
      g.paint.add(s.x, s.y, s.z, s.n, w, cell, kind === 1 ? rnd(r, -0.08, 0.08) : 0);
      // tags gather round what's up already: writers hit the same wall
      for (let t = 0; t < (kind === 3 ? 5 : 3); t++) {
        if (r() < 0.35) continue;
        const o = rnd(r, -w * 0.8, w * 0.8), wy = s.y + rnd(r, -0.75, 0.6), ww = rnd(r, 0.55, 1.0);
        const t2 = wallAt(world, px + s.tx * o, wy, pz + s.tz * o, dx, dz, Math.max(W, D), ww, ww * 0.5);
        if (t2) g.paint.add(t2.x, t2.y, t2.z, t2.n, ww, 8 + Math.floor(r() * 8), rnd(r, -0.1, 0.1), 0.012 + t * 0.002);
      }
      got++;
    }
    // posters: pasted up in runs along a wall, overlapping, some crooked
    const pw = r() < (long ? 0.8 : 0.45) ? 1 + Math.floor(r() * (long ? 3 : 2)) : 0;
    for (let k = 0, got = 0; k < pw * 8 && got < pw; k++) {
      const [dx, dz] = DIRS[Math.floor(r() * 4)];
      const px = rnd(r, x0 + 0.5, x1 - 0.5), pz = rnd(r, z0 + 0.5, z1 - 0.5);
      const n = 1 + Math.floor(r() * 4), w = rnd(r, 0.42, 0.62), y = y0 + rnd(r, 1.2, 1.6);
      const s = wallAt(world, px, y, pz, dx, dz, Math.max(W, D), w * n + 0.1, w * 2.1);
      if (!s) continue;
      for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * w * rnd(r, 0.85, 1.0);
        g.posters.add(s.x + s.tx * o, s.y + rnd(r, -0.06, 0.06), s.z + s.tz * o, s.n, w, Math.floor(r() * P_COLS * P_ROWS), rnd(r, -0.08, 0.08), 0.01 + i * 0.002);
      }
      got++;
    }
    // papers: lots, drifted against the walls and into the corners, a scatter across the middle
    const nP = Math.min(60, Math.floor(W * D * rnd(r, 0.35, 0.8)));
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < nP; i++) {
      let x: number, z: number;
      if (r() < 0.6) {
        // along a wall
        const side = Math.floor(r() * 4);
        const t = r();
        x = side < 2 ? x0 + 0.25 + t * (W - 0.5) : side === 2 ? x0 + rnd(r, 0.2, 0.9) : x1 - rnd(r, 0.2, 0.9);
        z = side >= 2 ? z0 + 0.25 + t * (D - 0.5) : side === 0 ? z0 + rnd(r, 0.2, 0.9) : z1 - rnd(r, 0.2, 0.9);
      } else {
        x = rnd(r, x0 + 0.3, x1 - 0.3);
        z = rnd(r, z0 + 0.3, z1 - 0.3);
      }
      const fy = world.floorAt(x, y0 + 0.3, z, 0.02, 0.05, true);
      if (fy < y0 - 0.3 || fy > y0 + 0.3) continue;
      g.papers.add(x, fy, z, up, rnd(r, 0.24, 0.36), Math.floor(r() * Q_COLS * Q_ROWS), r() * Math.PI * 2, 0.004 + (i % 7) * 0.0008);
    }
    if (!worst.has(q)) continue;
    soaked++;
    soakedRooms.push(q.name);
    const floorY = (x: number, z: number) => world.floorAt(x, y0 + 0.3, z, 0.05, 0.05, true);
    const nPool = 10 + Math.floor((W * D) / 4);
    for (let i = 0; i < Math.min(nPool, 40); i++) {
      const x = rnd(r, x0 + 0.4, x1 - 0.4), z = rnd(r, z0 + 0.4, z1 - 0.4);
      const fy = floorY(x, z);
      if (fy < y0 - 0.4) continue;
      const k = r();
      fx.stain(x, fy, z, 0, 1, 0, rnd(r, 0.7, 2.4), k < 0.4 ? 11 : k < 0.7 ? 14 : k < 0.85 ? 12 : 13);
    }
    for (let t = 0; t < 2; t++) {
      let x = rnd(r, x0 + 1, x1 - 1), z = rnd(r, z0 + 1, z1 - 1);
      const a = r() * Math.PI * 2;
      for (let i = 0; i < 8; i++) {
        const fy = floorY(x, z);
        if (fy > y0 - 0.4) fx.decal(x, fy + 0.005, z, 0, 1, 0, 13, rnd(r, 0.7, 1.0), a + Math.PI / 2 + rnd(r, -0.2, 0.2), true);
        x += Math.cos(a) * 0.55;
        z -= Math.sin(a) * 0.55;
        if (x < x0 + 0.3 || x > x1 - 0.3 || z < z0 + 0.3 || z > z1 - 0.3) break;
      }
    }
    for (let i = 0, got = 0; i < 40 && got < 12; i++) {
      const [dx, dz] = DIRS[Math.floor(r() * 4)];
      const px = rnd(r, x0 + 0.4, x1 - 0.4), pz = rnd(r, z0 + 0.4, z1 - 0.4), y = y0 + rnd(r, 0.3, 2.0);
      const hit = world.ray(px, y, pz, dx, 0, dz, Math.max(W, D), true, true);
      if (!hit || Math.abs(hit.ny) > 0.1) continue;
      fx.stain(px + dx * hit.t, y, pz + dz * hit.t, -dx, 0, -dz, rnd(r, 0.6, 1.8));
      got++;
    }
  }
  return { pieces: g.paint.count, posters: g.posters.count, papers: g.papers.count, soaked, soakedRooms };
}
