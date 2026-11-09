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

const G_COLS = 4, G_ROWS = 8;
const FILLS = ['#d8dade', '#e9e6dc', '#f1cf2e', '#e7609e', '#56b6e3', '#7ed36a', '#f08a2a', '#b98bf0', '#e5463a'];
const LINES = ['#111111', '#141414', '#b3141b', '#1d3fa8', '#0d6b33', '#5a1a7a'];
const NAMES = ['KROME', 'VEXO', 'NAKS', 'RUSK', 'SKEP', 'ORBY', 'MOKE', 'ZERO', 'TWIG', 'DUSK', 'OKER', 'JUNO', 'FEAR', 'GHOST', 'HAZE', 'REK'];
const WORDS = ['GET OUT', 'THEY HEAR YOU', "DON'T LOOK BACK", 'NO WAY OUT', "IT'S STILL HERE", 'LIGHTS OFF', 'HELP US', 'KEEP QUIET', 'NOT ALONE', 'BEHIND YOU', 'NOBODY CAME', 'RUN'];
const STENCIL = ['NO EXIT', 'CONDEMNED', 'QUARANTINE', 'DO NOT ENTER', 'WATCHING'];

const HAND = '"Marker Felt", "Chalkboard SE", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';
const BUBBLE = '"Arial Rounded MT Bold", "Arial Black", "Helvetica Neue", sans-serif';
const BLOCK = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

function graffitiAtlas(): THREE.CanvasTexture {
  const W = 2048, H = 2048, cw = W / G_COLS, ch = H / G_ROWS;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  const r = mulberry(91);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

  /** fit a word to the cell at a font, returns size */
  const fit = (t: string, font: (s: number) => string, wmax: number, s0: number) => {
    let s = s0;
    c.font = font(s);
    while (c.measureText(t).width > wmax && s > 24) {
      s -= 4;
      c.font = font(s);
    }
    return s;
  };
  /** letters one by one: each bounced, turned and sized a little differently, run together */
  const letters = (t: string, size: number, font: (s: number) => string, draw: (ch: string, x: number, y: number, rot: number, s: number) => void, squeeze = 0.86) => {
    c.font = font(size);
    const widths = [...t].map((x) => c.measureText(x).width * squeeze);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = -total / 2;
    [...t].forEach((x0, i) => {
      const s = size * rnd(r, 0.9, 1.12);
      draw(x0, x + widths[i] / 2, rnd(r, -size * 0.08, size * 0.08), rnd(r, -0.16, 0.16), s);
      x += widths[i];
    });
  };
  const drips = (n: number, x0: number, x1: number, y: number, col: string, wmax = 5) => {
    c.save();
    c.fillStyle = col;
    c.strokeStyle = col;
    c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = rnd(r, x0, x1), L = rnd(r, 10, 70) * (r() < 0.2 ? 2 : 1), w = rnd(r, 1.5, wmax);
      c.globalAlpha = rnd(r, 0.75, 0.95);
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + rnd(r, -1.5, 1.5), y + L);
      c.stroke();
      c.beginPath();
      c.ellipse(x, y + L, w * 0.8, w * 1.1, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };
  /** a highlight sprayed as a four-point star */
  const star = (x: number, y: number, s: number) => {
    c.save();
    c.fillStyle = '#ffffff';
    c.shadowColor = '#ffffff';
    c.shadowBlur = 6;
    c.beginPath();
    c.moveTo(x, y - s);
    c.quadraticCurveTo(x, y, x + s, y);
    c.quadraticCurveTo(x, y, x, y + s);
    c.quadraticCurveTo(x, y, x - s, y);
    c.quadraticCurveTo(x, y, x, y - s);
    c.fill();
    c.restore();
  };
  /** the spray: drawn soft first (the overspray), then hard */
  const sprayed = (col: string, f: () => void, soft = 10) => {
    c.save();
    c.shadowColor = col;
    c.shadowBlur = soft;
    c.globalAlpha = soft < 4 ? 0.2 : 0.45;
    f();
    c.shadowBlur = 2;
    c.globalAlpha = 1;
    f();
    c.restore();
  };

  const tag = (t: string, col: string, big = false) => {
    const font = (s: number) => `italic ${s}px ${HAND}`;
    const size = fit(t, font, cw * 0.82, big ? 150 : 128);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = col;
    c.fillStyle = col;
    c.transform(1, 0, -0.25, 1, 0, 0);
    sprayed(col, () => {
      letters(t, size, font, (chr, x, y, rot, s) => {
        c.save();
        c.translate(x, y);
        c.rotate(rot);
        c.font = font(s);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = s * 0.022;
        c.strokeText(chr, 0, 0);
        c.fillText(chr, 0, 0);
        c.restore();
      }, 0.97);
      // the underline swoop writers finish with
      if (r() < 0.6) {
        c.lineWidth = size * 0.03;
        c.beginPath();
        c.moveTo(-cw * 0.36, size * 0.45);
        c.quadraticCurveTo(0, size * 0.62, cw * 0.38, size * 0.3);
        c.stroke();
      }
    }, 2.5);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return size;
  };
  const throwUp = (t: string) => {
    const fill = pick(FILLS), line = pick(LINES.filter((x) => x !== '#111111'));
    const font = (s: number) => `bold ${s}px ${BUBBLE}`;
    const size = fit(t, font, cw * 0.7, 160);
    const each = (f: (chr: string, s: number) => void) =>
      letters(t, size, font, (chr, x, y, rot, s) => {
        c.save();
        c.translate(x, y);
        c.rotate(rot);
        c.font = font(s);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        f(chr, s);
        c.restore();
      }, 0.78);
    c.lineJoin = 'round';
    // the keyline: black, fat, round, round the whole piece
    sprayed('#101010', () => each((chr, s) => {
      c.strokeStyle = '#101010';
      c.lineWidth = s * 0.34;
      c.strokeText(chr, 0, 0);
    }), 8);
    // the outline in the second colour, then the fill, quick and uneven
    each((chr, s) => {
      c.strokeStyle = line;
      c.lineWidth = s * 0.16;
      c.strokeText(chr, 0, 0);
    });
    each((chr) => {
      c.fillStyle = fill;
      c.fillText(chr, 0, 0);
    });
    // the fill never quite covers: streaks of the spray going back and forth
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 14; i++) {
      c.lineWidth = rnd(r, 3, 9);
      const y = rnd(r, -size * 0.5, size * 0.5);
      c.beginPath();
      c.moveTo(-cw * 0.4, y);
      c.lineTo(cw * 0.4, y + rnd(r, -20, 20));
      c.stroke();
    }
    c.restore();
    drips(6 + Math.floor(r() * 6), -cw * 0.3, cw * 0.3, size * 0.4, line);
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) star(rnd(r, -cw * 0.3, cw * 0.3), rnd(r, -size * 0.4, -size * 0.1), rnd(r, 10, 20));
  };
  const block = (t: string) => {
    const a = pick(FILLS), b = pick(FILLS), d = pick(['#1a1a1a', '#2a1236', '#0e2a40', '#3a1010']);
    const font = (s: number) => `${s}px ${BLOCK}`;
    const size = fit(t, font, cw * 0.8, 170);
    c.font = font(size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // the 3D: the letters pushed down and right, solid
    c.fillStyle = d;
    for (let k = 14; k > 0; k--) c.fillText(t, k * 1.4, k * 1.2);
    c.lineJoin = 'miter';
    c.strokeStyle = '#0c0c0c';
    c.lineWidth = size * 0.07;
    sprayed('#0c0c0c', () => c.strokeText(t, 0, 0), 6);
    const g = c.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, a);
    g.addColorStop(0.55, b);
    g.addColorStop(1, b);
    c.fillStyle = g;
    c.fillText(t, 0, 0);
    // a white shine along the tops of the letters
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(-cw / 2, -size * 0.42, cw, size * 0.06);
    c.restore();
    star(rnd(r, -cw * 0.3, cw * 0.3), -size * 0.35, 18);
    drips(5, -cw * 0.35, cw * 0.35, size * 0.42, b, 4);
  };
  const stencil = (t: string) => {
    const col = pick(['#141414', '#151515', '#8a1010', '#1b1b1b']);
    const font = (s: number) => `${s}px ${BLOCK}`;
    const size = fit(t, font, cw * 0.84, 120);
    c.font = font(size);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // overspray round the card's edge, then the letters hard
    c.fillStyle = col;
    for (let i = 0; i < 900; i++) {
      c.globalAlpha = rnd(r, 0.1, 0.4);
      const x = rnd(r, -cw * 0.45, cw * 0.45), y = rnd(r, -ch * 0.4, ch * 0.4);
      c.fillRect(x, y, 1.5, 1.5);
    }
    c.globalAlpha = 1;
    c.fillText(t, 0, 0);
    // the bridges a stencil needs to hold its letters together
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (let x = -cw * 0.45; x < cw * 0.45; x += size * 0.33) c.fillRect(x, -size * 0.6, size * 0.035, size * 1.2);
    c.restore();
  };
  const scrawl = (t: string) => {
    const col = pick(['#6e0b08', '#141414', '#5a0907', '#1a1a1a']);
    const size = tag(t, col, true);
    drips(12, -cw * 0.4, cw * 0.4, size * 0.3, col, 4);
  };
  const symbol = (k: number) => {
    const col = pick(['#141414', '#8a1010', '#e9e6dc']);
    c.strokeStyle = col;
    c.lineWidth = 11;
    c.lineCap = 'round';
    sprayed(col, () => {
      c.beginPath();
      if (k === 0) {
        // an eye
        c.moveTo(-150, 0);
        c.quadraticCurveTo(0, -110, 150, 0);
        c.quadraticCurveTo(0, 110, -150, 0);
        c.moveTo(40, 0);
        c.arc(0, 0, 40, 0, Math.PI * 2);
      } else {
        // tally marks, more than a week of them
        for (let g = 0; g < 4; g++) {
          const gx = -190 + g * 100;
          for (let i = 0; i < 4; i++) {
            c.moveTo(gx + i * 16, -50);
            c.lineTo(gx + i * 16 + rnd(r, -4, 4), 50);
          }
          c.moveTo(gx - 10, 30);
          c.lineTo(gx + 62, -30);
        }
      }
      c.stroke();
    }, 8);
    drips(4, -120, 120, 50, col, 4);
  };

  for (let i = 0; i < G_COLS * G_ROWS; i++) {
    const x0 = (i % G_COLS) * cw, y0 = Math.floor(i / G_COLS) * ch;
    c.save();
    c.beginPath();
    c.rect(x0 + 4, y0 + 4, cw - 8, ch - 8);
    c.clip();
    c.translate(x0 + cw / 2, y0 + ch / 2);
    c.rotate(rnd(r, -0.06, 0.06));
    if (i < 8) throwUp(NAMES[i]);
    else if (i < 14) tag(NAMES[i], pick(LINES.concat(FILLS.slice(0, 3))));
    else if (i < 22) scrawl(WORDS[i - 14]);
    else if (i < 26) block(NAMES[(i + 3) % NAMES.length]);
    else if (i < 30) stencil(STENCIL[i - 26]);
    else symbol(i - 30);
    c.restore();
    // years of it: the paint worn through in patches, scratched, flaking
    c.save();
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 40; k++) {
      c.globalAlpha = rnd(r, 0.05, 0.3);
      c.beginPath();
      c.ellipse(x0 + rnd(r, 0, cw), y0 + rnd(r, 0, ch), rnd(r, 6, 40), rnd(r, 4, 24), rnd(r, 0, 3), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 0.6;
    c.lineWidth = 1;
    for (let k = 0; k < 18; k++) {
      c.beginPath();
      const x = x0 + rnd(r, 0, cw), y = y0 + rnd(r, 0, ch);
      c.moveTo(x, y);
      c.lineTo(x + rnd(r, -60, 60), y + rnd(r, -20, 20));
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
      text('THEY LIED', 0, 0, 96, HAND, '#9a0e0e');
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
export class Graffiti {
  readonly group = new THREE.Group();
  readonly paint = new Sheet(graffitiAtlas(), G_COLS, G_ROWS, 2, 320, 0.7, 'lfgraffiti', 2);
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
    const want = r() < 0.75 ? 1 + Math.floor(r() * (long ? 5 : 2)) : 0;
    for (let k = 0, got = 0; k < want * 10 && got < want; k++) {
      const [dx, dz] = DIRS[Math.floor(r() * 4)];
      const px = rnd(r, x0 + 0.5, x1 - 0.5), pz = rnd(r, z0 + 0.5, z1 - 0.5);
      const w = rnd(r, 1.1, 2.6), y = y0 + rnd(r, 1.0, 1.8);
      const s = wallAt(world, px, y, pz, dx, dz, Math.max(W, D), w, w * 0.5);
      if (!s) continue;
      g.paint.add(s.x, s.y, s.z, s.n, w, Math.floor(r() * G_COLS * G_ROWS));
      // tags gather round a piece
      for (let t = 0; t < 2; t++) {
        if (r() < 0.4) continue;
        const o = rnd(r, -w * 0.9, w * 0.9), wy = s.y + rnd(r, -0.7, 0.5), ww = rnd(r, 0.5, 0.9);
        const t2 = wallAt(world, px + s.tx * o, wy, pz + s.tz * o, dx, dz, Math.max(W, D), ww, ww * 0.5);
        if (t2) g.paint.add(t2.x, t2.y, t2.z, t2.n, ww, 8 + Math.floor(r() * 6), rnd(r, -0.1, 0.1), 0.012);
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
