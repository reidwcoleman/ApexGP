import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Marble, Mode } from './physics.ts';

/**
 * The contestants as you see them: soft jelly beans on stubby legs, googly eyes that jiggle, little
 * arms, an outfit (a colour, a pattern, a hat). All built here from lathe and capsule shapes, the
 * patterns painted on a canvas — no image files. The physics only knows two spheres; this rig is
 * the bean on top of them, animated from what the body is doing: a waddling run (the stride from
 * the speed over the ground), a lean into the run and a jelly wobble on every change of speed,
 * squash on landing and stretch on take-off, arms up and legs kicking in the air, flat out on its
 * belly in a dive, limbs everywhere in a tumble, a struggle when someone has hold of it.
 */

/**
 * body proportions (m), from the ground under the feet: the party-game bean — a round, chunky,
 * bottom-heavy body sitting low on its hips, stubby little legs, big arms set halfway up
 */
const HIP_Y = 0.24;
const CORE_Y = 0.8;
const TOP_Y = 1.6;
const FACE_Y = 1.17;
const SHOULDER_Y = 0.86;
/** the body's radius where the arms come out */
const SHOULDER_X = 0.47;

export type Pat = 'solid' | 'belly' | 'stripes' | 'dots' | 'split' | 'zigzag' | 'stars' | 'hearts' | 'checker' | 'spots' | 'swirl' | 'fade' | 'rainbow' | 'camo' | 'scales' | 'suit' | 'overalls' | 'gingham' | 'leopard' | 'pinstripe';
export type Hat = 'none' | 'beanie' | 'party' | 'propeller' | 'bow' | 'horns' | 'antenna' | 'flower' | 'tophat' | 'headphones' | 'sprout' | 'cap' | 'bunny' | 'cat' | 'dino' | 'shark' | 'chef' | 'viking' | 'halo' | 'unicorn' | 'pirate' | 'mohawk' | 'goggles';
export const PATS: Pat[] = ['solid', 'belly', 'stripes', 'dots', 'split', 'zigzag', 'stars', 'hearts', 'checker', 'spots', 'swirl', 'fade', 'rainbow', 'camo', 'scales', 'suit', 'overalls', 'gingham', 'leopard', 'pinstripe'];
export const HATS: Hat[] = ['none', 'beanie', 'party', 'propeller', 'bow', 'horns', 'antenna', 'flower', 'tophat', 'headphones', 'sprout', 'cap', 'bunny', 'cat', 'dino', 'shark', 'chef', 'viking', 'halo', 'unicorn', 'pirate', 'mohawk', 'goggles'];

export interface Outfit {
  name: string;
  /** body, pattern, limbs */
  a: number;
  b: number;
  limb?: number;
  pat: Pat;
  hat: Hat;
  /** the hat's colours */
  h1?: number;
  h2?: number;
}

export const OUTFITS: Outfit[] = [
  { name: 'Strawberry', a: 0xff3b4e, b: 0xffe27a, pat: 'dots', hat: 'sprout', h1: 0x38c24a },
  { name: 'Sky Pilot', a: 0x3fa4ff, b: 0xffffff, pat: 'belly', hat: 'propeller', h1: 0xffd23a, h2: 0xff4060 },
  { name: 'Bumblebee', a: 0xffcf1f, b: 0x2a2320, limb: 0x2a2320, pat: 'stripes', hat: 'antenna', h1: 0x2a2320, h2: 0x2a2320 },
  { name: 'Party Animal', a: 0x9a5bff, b: 0xffe04a, pat: 'stars', hat: 'party', h1: 0xff4fa8, h2: 0x5fe0ff },
  { name: 'Lil Devil', a: 0xff3a2a, b: 0x9a1010, pat: 'fade', hat: 'horns', h1: 0xffe9c8 },
  { name: 'Bubblegum', a: 0xff8ac8, b: 0xffffff, pat: 'hearts', hat: 'bow', h1: 0xff3d8a },
  { name: 'Martian', a: 0x6fe04a, b: 0x2f9a3a, pat: 'spots', hat: 'antenna', h1: 0x2f9a3a, h2: 0xff4fe0 },
  { name: 'Tiger', a: 0xff8a1f, b: 0x2a1408, limb: 0xff8a1f, pat: 'zigzag', hat: 'none' },
  { name: 'Penguin', a: 0x22283a, b: 0xffffff, limb: 0xffb020, pat: 'belly', hat: 'beanie', h1: 0xff4040, h2: 0xffffff },
  { name: 'Watermelon', a: 0x2fbf5a, b: 0xff5a78, pat: 'split', hat: 'none' },
  { name: 'Dapper', a: 0xd9dde6, b: 0x8a93a8, pat: 'checker', hat: 'tophat', h1: 0x26262e, h2: 0xff3a5a },
  { name: 'DJ Jelly', a: 0x16c8c0, b: 0x0d7f92, pat: 'swirl', hat: 'headphones', h1: 0x262833, h2: 0xff4fa8 },
  { name: 'Sunflower', a: 0xffe14a, b: 0xff9e1f, pat: 'fade', hat: 'flower', h1: 0xffd21f, h2: 0x7a4a1a },
  { name: 'Ladybug', a: 0xff2d2d, b: 0x1c1c22, limb: 0x1c1c22, pat: 'spots', hat: 'antenna', h1: 0x1c1c22, h2: 0x1c1c22 },
  { name: 'Blueberry', a: 0x4a5cff, b: 0x8fa2ff, pat: 'dots', hat: 'sprout', h1: 0x38c24a },
  { name: 'Candy Cane', a: 0xffffff, b: 0xff2a3a, pat: 'stripes', hat: 'beanie', h1: 0x1fbf5a, h2: 0xffffff },
  { name: 'Galaxy', a: 0x1d1f5a, b: 0xffe9a0, limb: 0x2e2f7a, pat: 'stars', hat: 'antenna', h1: 0xb7bccc, h2: 0xffe04a },
  { name: 'Mint Chip', a: 0x9ff0c8, b: 0x5a3a24, pat: 'spots', hat: 'cap', h1: 0x5a3a24, h2: 0x9ff0c8 },
  { name: 'Grape Soda', a: 0x8a46ff, b: 0xd8b8ff, pat: 'swirl', hat: 'party', h1: 0xffd84a, h2: 0x8a46ff },
  { name: 'Frog Prince', a: 0x4ad06a, b: 0xfff07a, pat: 'belly', hat: 'none' },
  { name: 'Lemon Drop', a: 0xfff04a, b: 0xffffff, pat: 'dots', hat: 'cap', h1: 0x2a8aff, h2: 0xffffff },
  { name: 'Cloud', a: 0xf4f8ff, b: 0x9fd0ff, pat: 'fade', hat: 'propeller', h1: 0x2f9bff, h2: 0xffe04a },
  { name: 'Cocoa', a: 0x8a5232, b: 0xf2d6b0, pat: 'belly', hat: 'beanie', h1: 0xffe0f0, h2: 0xff6fa8 },
  { name: 'Hot Sauce', a: 0xff5a1f, b: 0xffd21f, pat: 'zigzag', hat: 'horns', h1: 0x2a2320 },
  { name: 'Bunny Hop', a: 0xfff4f8, b: 0xffb8d4, pat: 'belly', hat: 'bunny', h1: 0xfff4f8, h2: 0xff9cc4 },
  { name: 'Kitty', a: 0xffa64a, b: 0xfff0dc, pat: 'belly', hat: 'cat', h1: 0xffa64a, h2: 0xffc8d8 },
  { name: 'Dino', a: 0x4cc860, b: 0x2f8a46, pat: 'scales', hat: 'dino', h1: 0xffd23a },
  { name: 'Sharky', a: 0x6f8fb8, b: 0xf4f8ff, pat: 'belly', hat: 'shark', h1: 0x6f8fb8 },
  { name: 'Head Chef', a: 0xffffff, b: 0xff3a4a, pat: 'gingham', hat: 'chef', h1: 0xffffff },
  { name: 'Viking', a: 0xd9773a, b: 0x8a4a22, pat: 'overalls', hat: 'viking', h1: 0xb8c0cc, h2: 0xfff0d8 },
  { name: 'Angel', a: 0xfffaf0, b: 0xffe7a0, pat: 'fade', hat: 'halo', h1: 0xffd23a },
  { name: 'Unicorn', a: 0xf2e6ff, b: 0xffffff, pat: 'rainbow', hat: 'unicorn', h1: 0xffd23a, h2: 0xff7ac8 },
  { name: 'Pirate', a: 0xfff4e4, b: 0x2a2a3a, pat: 'stripes', hat: 'pirate', h1: 0xe8202f, h2: 0xffffff },
  { name: 'Punk Rock', a: 0x9a5bff, b: 0x1d1b22, pat: 'leopard', hat: 'mohawk', h1: 0xff3d8a, h2: 0x3dffd0 },
  { name: 'Ace Pilot', a: 0xb07a4a, b: 0xf2dcc0, pat: 'belly', hat: 'goggles', h1: 0x5a3a24, h2: 0x9fe4ff },
  { name: 'Commando', a: 0x7a9a4a, b: 0x3f5a2a, pat: 'camo', hat: 'cap', h1: 0x3f5a2a, h2: 0x7a9a4a },
  { name: 'Black Tie', a: 0x24242e, b: 0xffffff, limb: 0x24242e, pat: 'suit', hat: 'tophat', h1: 0x18181e, h2: 0xe8202f },
  { name: 'Farmhand', a: 0xffd8a8, b: 0x3a6fd8, pat: 'overalls', hat: 'sprout', h1: 0x38c24a },
  { name: 'Leopard', a: 0xffc65a, b: 0x5a3414, pat: 'leopard', hat: 'bow', h1: 0x1d1b22 },
  { name: 'Big Shot', a: 0x2a3a6a, b: 0xdfe6ff, pat: 'pinstripe', hat: 'cap', h1: 0xe8202f, h2: 0xffffff },
  { name: 'Rainbow', a: 0xffffff, b: 0xffffff, pat: 'rainbow', hat: 'propeller', h1: 0xff3a4a, h2: 0x2f9bff },
  { name: 'Chomper', a: 0x3fb8a8, b: 0xd8fff4, pat: 'scales', hat: 'shark', h1: 0x2f8a80 },
  { name: 'Holy Toast', a: 0xe8b070, b: 0xb87a3a, pat: 'fade', hat: 'halo', h1: 0xffd23a },
  { name: 'Snow Cat', a: 0xf4f8ff, b: 0xb8c8e0, pat: 'leopard', hat: 'cat', h1: 0xf4f8ff, h2: 0xffc8d8 },
];

/** a random outfit for a bot: any colour, any pattern, any hat */
export function randomOutfit(rnd: () => number): Outfit {
  const base = OUTFITS[Math.floor(rnd() * OUTFITS.length)];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const pats: Pat[] = PATS;
  const hats: Hat[] = ['none', ...HATS];
  const other = OUTFITS[Math.floor(rnd() * OUTFITS.length)];
  return { name: base.name, a: base.a, b: rnd() < 0.5 ? base.b : other.a, pat: rnd() < 0.6 ? pick(pats) : base.pat, hat: rnd() < 0.5 ? pick(hats) : base.hat, h1: other.b, h2: base.b };
}

// ----------------------------------------------------------------------------------- paint
const css = (n: number) => '#' + n.toString(16).padStart(6, '0');
const texCache = new Map<string, THREE.CanvasTexture>();

/** the outfit's skin: a 512 × 256 canvas, u round the body (the face at u = 0.5), v bottom to top */
function skin(o: Outfit): THREE.CanvasTexture {
  const key = `${o.a}-${o.b}-${o.pat}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const A = css(o.a), B = css(o.b);
  g.fillStyle = A;
  g.fillRect(0, 0, W, H);
  g.fillStyle = B;
  g.strokeStyle = B;
  // (canvas y runs down: v = 1 - y / H)
  const yOf = (v: number) => (1 - v) * H;
  switch (o.pat) {
    case 'belly': {
      g.beginPath();
      g.ellipse(W * 0.5, yOf(0.4), W * 0.17, H * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'stripes':
      for (let k = 0; k < 7; k++) g.fillRect(0, yOf(0.12 + k * 0.13), W, H * 0.065);
      break;
    case 'dots':
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 12; x++) {
          g.beginPath();
          g.arc(((x + (y % 2) * 0.5) / 12) * W, ((y + 0.5) / 8) * H, 7.5, 0, Math.PI * 2);
          g.fill();
        }
      break;
    case 'split':
      g.fillRect(0, yOf(0.47), W, H);
      g.fillStyle = '#ffffff';
      g.fillRect(0, yOf(0.47) - 4, W, 8);
      break;
    case 'zigzag':
      g.lineWidth = 11;
      g.lineJoin = 'miter';
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        const y0 = yOf(0.12 + k * 0.17);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, y0 + ((x / 32) % 2 ? -12 : 12));
        g.stroke();
      }
      break;
    case 'stars':
      for (let k = 0; k < 34; k++) star(g, ((k * 0.618) % 1) * W, ((k * 0.381 + 0.13) % 1) * H, 6 + ((k * 7) % 5) * 1.6);
      break;
    case 'hearts':
      for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) heart(g, ((x + (y % 2) * 0.5) / 10) * W, ((y + 0.5) / 6) * H, 9);
      break;
    case 'checker': {
      const n = 16, m = 8;
      for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) if ((x + y) % 2) g.fillRect((x / n) * W, (y / m) * H, W / n + 1, H / m + 1);
      break;
    }
    case 'spots':
      for (let k = 0; k < 22; k++) {
        g.beginPath();
        g.ellipse(((k * 0.618 + 0.05) % 1) * W, ((k * 0.29 + 0.1) % 1) * H, 10 + ((k * 5) % 7) * 2.5, 8 + ((k * 3) % 5) * 2, k, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'swirl':
      g.lineWidth = 14;
      for (let k = -4; k < 8; k++) {
        g.beginPath();
        g.moveTo((k / 6) * W, H);
        g.bezierCurveTo((k / 6) * W + 60, H * 0.6, (k / 6) * W - 20, H * 0.4, (k / 6) * W + 90, 0);
        g.stroke();
      }
      break;
    case 'fade': {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, A);
      gr.addColorStop(0.45, A);
      gr.addColorStop(1, B);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      break;
    }
    case 'rainbow': {
      const bands = ['#ff4a5a', '#ff9a2a', '#ffd83a', '#4ad06a', '#3aa8ff', '#9a6aff'];
      bands.forEach((c, k) => {
        g.fillStyle = c;
        g.fillRect(0, yOf(0.08 + (k + 1) * 0.085), W, H * 0.085 + 1);
      });
      break;
    }
    case 'camo': {
      const dark = css(new THREE.Color(o.b).multiplyScalar(0.62).getHex());
      for (const [cc, n, r] of [[B, 26, 26], [dark, 20, 18], [A, 10, 12]] as const) {
        g.fillStyle = cc;
        for (let k = 0; k < n; k++) {
          const x = ((k * 0.618 + (r % 7) * 0.13) % 1) * W, y = ((k * 0.381 + (r % 5) * 0.21) % 1) * H;
          g.beginPath();
          for (let q = 0; q < 9; q++) {
            const a = (q / 9) * Math.PI * 2, rr = r * (0.7 + 0.5 * Math.abs(Math.sin(q * 2.3 + k)));
            g.lineTo(x + Math.cos(a) * rr * 1.5, y + Math.sin(a) * rr);
          }
          g.fill();
        }
      }
      break;
    }
    case 'scales': {
      g.lineWidth = 3.5;
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 21; x++) {
          g.beginPath();
          g.arc((x + (y % 2) * 0.5) * (W / 20), H - y * (H / 10) - 4, W / 40, Math.PI * 0.05, Math.PI * 0.95);
          g.stroke();
        }
      // a pale belly under the scales
      g.fillStyle = css(new THREE.Color(o.a).lerp(new THREE.Color(0xffffff), 0.55).getHex());
      g.beginPath();
      g.ellipse(W * 0.5, yOf(0.36), W * 0.12, H * 0.27, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'suit': {
      // a white shirt front in a V, a bow tie, buttons
      g.fillStyle = B;
      g.beginPath();
      g.moveTo(W * 0.5 - W * 0.07, yOf(0.62));
      g.lineTo(W * 0.5 + W * 0.07, yOf(0.62));
      g.lineTo(W * 0.5 + W * 0.035, yOf(0.12));
      g.lineTo(W * 0.5 - W * 0.035, yOf(0.12));
      g.fill();
      g.fillStyle = '#e8202f';
      g.beginPath();
      g.moveTo(W * 0.5, yOf(0.585));
      g.lineTo(W * 0.5 - 20, yOf(0.62));
      g.lineTo(W * 0.5 - 20, yOf(0.55));
      g.closePath();
      g.moveTo(W * 0.5, yOf(0.585));
      g.lineTo(W * 0.5 + 20, yOf(0.62));
      g.lineTo(W * 0.5 + 20, yOf(0.55));
      g.closePath();
      g.fill();
      g.fillStyle = '#26262e';
      for (const v of [0.46, 0.36, 0.26]) {
        g.beginPath();
        g.arc(W * 0.5, yOf(v), 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'overalls': {
      g.fillStyle = B;
      g.fillRect(0, yOf(0.4), W, H * 0.4);
      // the bib and the straps over the shoulders, brass buttons
      g.fillRect(W * 0.5 - W * 0.08, yOf(0.56), W * 0.16, H * 0.17);
      g.fillRect(W * 0.5 - W * 0.075, yOf(0.8), W * 0.025, H * 0.26);
      g.fillRect(W * 0.5 + W * 0.05, yOf(0.8), W * 0.025, H * 0.26);
      g.fillRect(0, yOf(0.8), W * 0.03, H * 0.42);
      g.fillRect(W * 0.97, yOf(0.8), W * 0.03, H * 0.42);
      g.fillStyle = '#ffd23a';
      for (const x of [-0.06, 0.06]) {
        g.beginPath();
        g.arc(W * (0.5 + x), yOf(0.54), 5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'gingham': {
      g.globalAlpha = 0.55;
      for (let x = 0; x < 24; x += 2) g.fillRect((x / 24) * W, 0, W / 24, H);
      for (let y = 0; y < 12; y += 2) g.fillRect(0, (y / 12) * H, W, H / 12);
      g.globalAlpha = 1;
      break;
    }
    case 'leopard': {
      g.lineWidth = 3.2;
      g.lineCap = 'round';
      for (let k = 0; k < 90; k++) {
        const x = ((k * 0.618 + 0.11) % 1) * W, y = ((k * 0.437 + 0.07) % 1) * H;
        g.fillStyle = css(new THREE.Color(o.a).multiplyScalar(0.8).getHex());
        g.beginPath();
        g.ellipse(x, y, 6, 4.5, k, 0, Math.PI * 2);
        g.fill();
        // (broken rosette rings in two or three bits)
        for (let q = 0; q < 3; q++) {
          const a0 = k + q * 2.1;
          g.beginPath();
          g.ellipse(x, y, 7.5, 6, k, a0, a0 + 1.3);
          g.stroke();
        }
      }
      break;
    }
    case 'pinstripe':
      for (let x = 0; x < 40; x++) g.fillRect((x / 40) * W, 0, 2.5, H);
      break;
  }
  // a clear patch for the face on the busy ones
  if (['dots', 'stars', 'hearts', 'checker', 'spots', 'zigzag', 'swirl', 'stripes', 'camo', 'scales', 'gingham', 'leopard', 'pinstripe', 'rainbow'].includes(o.pat)) {
    g.fillStyle = A;
    g.beginPath();
    g.ellipse(W * 0.5, yOf(0.74), W * 0.105, H * 0.16, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}
function heart(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35);
  g.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
  g.fill();
}

// ----------------------------------------------------------------------------------- hats
function hat(o: Outfit): THREE.Object3D | null {
  const h1 = o.h1 ?? 0xff4060, h2 = o.h2 ?? 0xffffff;
  const M = (c: number, r = 0.55) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const top = TOP_Y - HIP_Y;
  switch (o.hat) {
    case 'none':
      return null;
    case 'beanie': {
      add(new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1), M(h1, 0.9), 0, top - 0.2, 0);
      add(new THREE.TorusGeometry(0.31, 0.06, 10, 28).rotateX(Math.PI / 2), M(h2, 0.9), 0, top - 0.2, 0);
      add(new THREE.SphereGeometry(0.1, 14, 10), M(h2, 1), 0, top + 0.08, 0);
      break;
    }
    case 'party': {
      const cone = new THREE.ConeGeometry(0.17, 0.42, 20, 6);
      const p = cone.getAttribute('position');
      const col = new Float32Array(p.count * 3);
      const ca = new THREE.Color(h1), cb = new THREE.Color(h2);
      for (let i = 0; i < p.count; i++) {
        const c = Math.floor((p.getY(i) + 0.21) * 10) % 2 ? ca : cb;
        col.set([c.r, c.g, c.b], i * 3);
      }
      cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = add(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), 0.06, top + 0.12, 0);
      m.rotation.z = -0.25;
      add(new THREE.SphereGeometry(0.06, 10, 8), M(0xffffff, 1), 0.15, top + 0.32, 0);
      break;
    }
    case 'propeller': {
      add(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), M(h1, 0.6), 0, top - 0.12, 0);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), M(0x888888, 0.3), 0, top + 0.08, 0);
      const prop = new THREE.Group();
      const blade = new THREE.BoxGeometry(0.5, 0.012, 0.07);
      prop.add(new THREE.Mesh(blade, M(h2, 0.4)));
      prop.add(new THREE.Mesh(blade.clone().rotateY(Math.PI / 2), M(h1 === h2 ? 0xffffff : h2, 0.4)));
      prop.position.set(0, top + 0.15, 0);
      prop.userData.spin = 1;
      g.add(prop);
      break;
    }
    case 'bow': {
      const m = M(h1, 0.45);
      const lobe = new THREE.SphereGeometry(0.11, 14, 10).scale(1.25, 0.85, 0.5);
      add(lobe, m, -0.12, top - 0.02, 0.12).rotation.z = 0.35;
      add(lobe.clone(), m, 0.12, top - 0.02, 0.12).rotation.z = -0.35;
      add(new THREE.SphereGeometry(0.06, 10, 8), m, 0, top - 0.02, 0.14);
      g.rotation.z = 0.45;
      g.position.x = 0.1;
      break;
    }
    case 'horns': {
      const m = M(h1, 0.4);
      for (const s of [-1, 1]) {
        const horn = add(new THREE.ConeGeometry(0.075, 0.26, 14), m, s * 0.2, top - 0.05, 0.02);
        horn.rotation.z = -s * 0.5;
      }
      break;
    }
    case 'antenna': {
      for (const s of [-1, 1]) {
        const stalk = add(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6), M(h1, 0.6), s * 0.12, top + 0.08, 0);
        stalk.rotation.z = -s * 0.35;
        add(new THREE.SphereGeometry(0.055, 12, 8), M(h2, 0.3), s * 0.17, top + 0.22, 0);
      }
      break;
    }
    case 'flower': {
      const f = new THREE.Group();
      for (let k = 0; k < 7; k++) {
        const pe = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8).scale(1.4, 0.4, 0.8), M(h1, 0.6));
        const a = (k / 7) * Math.PI * 2;
        pe.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
        pe.rotation.y = -a;
        pe.castShadow = true;
        f.add(pe);
      }
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8).scale(1, 0.6, 1), M(h2, 0.8));
      f.add(c);
      f.position.set(0.16, top - 0.06, 0.05);
      f.rotation.z = -0.5;
      g.add(f);
      break;
    }
    case 'tophat': {
      const m = M(h1, 0.4);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 28), m, 0, top - 0.03, 0);
      add(new THREE.CylinderGeometry(0.19, 0.2, 0.3, 28), m, 0, top + 0.12, 0);
      add(new THREE.CylinderGeometry(0.205, 0.205, 0.06, 28), M(h2, 0.6), 0, top + 0.02, 0);
      g.rotation.z = -0.12;
      break;
    }
    case 'headphones': {
      const m = M(h1, 0.35);
      add(new THREE.TorusGeometry(0.44, 0.035, 8, 28, Math.PI), m, 0, top - 0.44, 0);
      for (const s of [-1, 1]) {
        const cup = add(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 20), M(h2, 0.4), s * 0.48, top - 0.44, 0);
        cup.rotation.z = Math.PI / 2;
      }
      break;
    }
    case 'sprout': {
      const m = M(h1, 0.5);
      add(new THREE.CylinderGeometry(0.014, 0.02, 0.14, 6), m, 0, top + 0.05, 0);
      for (const s of [-1, 1]) {
        const leaf = add(new THREE.SphereGeometry(0.09, 12, 8).scale(1.6, 0.3, 0.8), m, s * 0.12, top + 0.12, 0);
        leaf.rotation.z = s * 0.45;
      }
      break;
    }
    case 'cap': {
      add(new THREE.SphereGeometry(0.31, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1), M(h1, 0.7), 0, top - 0.17, 0);
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.3), M(h2, 0.7), 0, top - 0.17, 0.2);
      add(new THREE.SphereGeometry(0.035, 8, 6), M(h2, 0.7), 0, top + 0.02, 0);
      break;
    }
    case 'bunny': {
      for (const s of [-1, 1]) {
        const ear = new THREE.Group();
        const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 6, 14).scale(1, 1, 0.5), M(h1, 0.6));
        const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.3, 6, 12).scale(1, 1, 0.4), M(h2, 0.7));
        inner.position.z = 0.025;
        outer.castShadow = true;
        ear.add(outer, inner);
        ear.position.set(s * 0.12, top + 0.18, 0);
        // (one ear stands, the other flops over)
        ear.rotation.set(s > 0 ? -0.5 : 0.05, 0, -s * 0.22);
        if (s > 0) ear.position.y -= 0.04;
        g.add(ear);
      }
      break;
    }
    case 'cat': {
      for (const s of [-1, 1]) {
        const e = add(new THREE.ConeGeometry(0.17, 0.32, 14).scale(1, 1, 0.5), M(h1, 0.6), s * 0.2, top + 0.02, -0.02);
        e.rotation.z = -s * 0.36;
        const i = add(new THREE.ConeGeometry(0.1, 0.2, 12).scale(1, 1, 0.3), M(h2, 0.7), s * 0.195, top + 0.0, 0.045);
        i.rotation.z = -s * 0.36;
      }
      break;
    }
    case 'dino': {
      // spikes down the back, smaller toward the tail
      const m = M(h1, 0.5);
      const at = [[1.3, 0.14, 0.3, 0.11], [1.19, 0.31, 0.75, 0.12], [1.05, 0.41, 1.05, 0.11], [0.88, 0.46, 1.3, 0.1], [0.7, 0.485, 1.5, 0.085], [0.5, 0.488, 1.57, 0.07]];
      for (const [y, z, a, r] of at) {
        const sp = add(new THREE.ConeGeometry(r, r * 2.1, 12).scale(0.55, 1, 1), m, 0, y + Math.cos(a) * r * 0.6, -z - Math.sin(a) * r * 0.6);
        sp.rotation.x = -a;
      }
      break;
    }
    case 'shark': {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(0.1, 0.24, -0.12, 0.42);
      sh.quadraticCurveTo(-0.16, 0.2, -0.36, 0);
      sh.closePath();
      const fin = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3 }).translate(0, 0, -0.025).rotateY(Math.PI / 2);
      add(fin, M(h1, 0.4), 0, top - 0.1, 0.05);
      break;
    }
    case 'chef': {
      const m = M(h1, 0.85);
      add(new THREE.CylinderGeometry(0.25, 0.23, 0.3, 24), m, 0, top + 0.02, 0);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.16, 14, 10), m, Math.cos(a) * 0.15, top + 0.25, Math.sin(a) * 0.15);
      }
      add(new THREE.SphereGeometry(0.2, 16, 12), m, 0, top + 0.33, 0);
      break;
    }
    case 'viking': {
      add(new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), new THREE.MeshStandardMaterial({ color: h1, roughness: 0.3, metalness: 0.6 }), 0, top - 0.17, 0);
      add(new THREE.TorusGeometry(0.325, 0.035, 8, 28).rotateX(Math.PI / 2), M(0xd9a441, 0.35), 0, top - 0.15, 0);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), M(0xd9a441, 0.35), 0, top + 0.02, 0);
      for (const s of [-1, 1]) {
        const horn = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.2, 0.02, 0), new THREE.Vector3(s * 0.24, 0.26, 0)), 12, 0.05, 10);
        // (tapered: shrink the tube's rings toward its tip)
        const hp = horn.getAttribute('position');
        const c = new THREE.Vector3();
        for (let i = 0; i < hp.count; i++) {
          const u = Math.floor(i / 11) / 12;
          const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.2, 0.02, 0), new THREE.Vector3(s * 0.24, 0.26, 0));
          curve.getPoint(u, c);
          const k = 1 - u * 0.85;
          hp.setXYZ(i, c.x + (hp.getX(i) - c.x) * k, c.y + (hp.getY(i) - c.y) * k, c.z + (hp.getZ(i) - c.z) * k);
        }
        horn.computeVertexNormals();
        add(horn, M(h2, 0.45), s * 0.27, top - 0.12, 0);
      }
      break;
    }
    case 'halo': {
      const ring = add(new THREE.TorusGeometry(0.22, 0.035, 10, 36).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: h1, emissive: h1, emissiveIntensity: 0.9, roughness: 0.3 }), 0, top + 0.2, 0);
      ring.castShadow = false;
      ring.userData.halo = 1;
      break;
    }
    case 'unicorn': {
      const horn = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.46, 18), M(h1, 0.35));
      cone.castShadow = true;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 40; k++) {
        const u = k / 40, r = 0.085 * (1 - u) + 0.006;
        pts.push(new THREE.Vector3(Math.cos(u * 18) * r, -0.23 + u * 0.45, Math.sin(u * 18) * r));
      }
      horn.add(cone, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.014, 6), M(h2, 0.4)));
      horn.position.set(0, top + 0.06, 0.2);
      horn.rotation.x = 0.45;
      g.add(horn);
      // a little mane down the back
      for (let k = 0; k < 4; k++) add(new THREE.SphereGeometry(0.07 - k * 0.008, 12, 8), M([0xff7ac8, 0x9a6aff, 0x5fd0ff, 0xffd23a][k], 0.6), 0, top - 0.05 - k * 0.11, -0.16 - k * 0.07);
      break;
    }
    case 'pirate': {
      const cap = new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1);
      add(cap, M(h1, 0.75), 0, top - 0.17, 0);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.03, 8, 6), M(h2, 0.8), Math.cos(a) * 0.21, top - 0.03, Math.sin(a) * 0.21);
      }
      add(new THREE.SphereGeometry(0.07, 12, 8), M(h1, 0.75), 0, top - 0.12, -0.33);
      for (const s of [-1, 1]) {
        const tail = add(new THREE.CapsuleGeometry(0.035, 0.16, 4, 8).scale(1.5, 1, 0.5), M(h1, 0.75), s * 0.07, top - 0.24, -0.36);
        tail.rotation.z = s * 0.4;
      }
      break;
    }
    case 'mohawk': {
      for (let k = 0; k < 7; k++) {
        const a = -0.95 + (k / 6) * 1.9;
        const sp = add(new THREE.ConeGeometry(0.085, 0.38 - Math.abs(a) * 0.08, 10).scale(0.5, 1, 1), M(k % 2 ? h2 : h1, 0.5), 0, top - 0.1 + Math.cos(a) * 0.16, Math.sin(a) * 0.32);
        sp.rotation.x = a;
      }
      break;
    }
    case 'goggles': {
      const y = top - 0.18;
      add(new THREE.TorusGeometry(0.39, 0.03, 8, 40).rotateX(Math.PI / 2), M(h1, 0.6), 0, y - 0.02, 0);
      for (const s of [-1, 1]) {
        const rim = add(new THREE.TorusGeometry(0.095, 0.03, 10, 24), M(0xd9a441, 0.3), s * 0.12, y, 0.33);
        rim.rotation.y = s * 0.3;
        const lens = add(new THREE.SphereGeometry(0.095, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.5), new THREE.MeshPhysicalMaterial({ color: h2, roughness: 0.05, clearcoat: 1, metalness: 0.2 }), s * 0.12, y, 0.335);
        lens.rotation.y = s * 0.3;
      }
      break;
    }
  }
  return g;
}

// ----------------------------------------------------------------------------------- shapes
let G: ReturnType<typeof shapes> | null = null;
/** limb sizes (m) */
const ARM_A = 0.2, ARM_B = 0.18, ARM_R = 0.094, HAND_R = 0.135;
const LEG_A = 0.085, LEG_B = 0.085, LEG_R = 0.11;
function shapes() {
  // the body: a round, chunky bean turned round (the seam at the back), fullest a third of the way
  // up, tapering a little to a full round dome; low to the ground on its hips
  const prof = new THREE.SplineCurve(
    [
      [0.001, 0.13],
      [0.2, 0.14],
      [0.34, 0.19],
      [0.43, 0.29],
      [0.475, 0.43],
      [0.488, 0.6],
      [0.485, 0.8],
      [0.47, 1.0],
      [0.44, 1.17],
      [0.39, 1.32],
      [0.31, 1.45],
      [0.2, 1.54],
      [0.09, 1.59],
      [0.001, 1.6],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const body = new THREE.LatheGeometry(prof.getPoints(48), 56).rotateY(Math.PI);
  body.translate(0, -HIP_Y, 0);
  // the limbs: one skinned mesh, three bones a limb (upper, lower, hand or foot), each part modelled
  // pointing down -y from its bone
  const parts: THREE.BufferGeometry[] = [];
  const bone = (g: THREE.BufferGeometry, b: number) => {
    const n = g.getAttribute('position').count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = b;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const seg = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 5, 12).translate(0, -len / 2, 0);
  for (let L = 0; L < 4; L++) {
    const arm = L < 2;
    bone(seg(arm ? ARM_R : LEG_R, arm ? ARM_A : LEG_A), L * 3);
    bone(seg(arm ? ARM_R * 0.92 : LEG_R * 0.92, arm ? ARM_B : LEG_B), L * 3 + 1);
    // a round mitten; a chunky rounded boot pointing forward (+z)
    if (arm) bone(new THREE.SphereGeometry(HAND_R, 16, 12).scale(1, 1.08, 0.9), L * 3 + 2);
    else bone(new THREE.SphereGeometry(1, 18, 12).scale(0.15, 0.095, 0.2).translate(0, -0.02, 0.06), L * 3 + 2);
  }
  const limbs = mergeGeometries(parts)!;
  const eye = new THREE.SphereGeometry(0.135, 28, 18).scale(1, 1.14, 0.6);
  const pup = new THREE.SphereGeometry(0.07, 18, 12).scale(1, 1.12, 0.5);
  const glint = new THREE.SphereGeometry(0.02, 8, 6).translate(0.025, 0.03, 0.035);
  const paint = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const pupil = mergeGeometries([paint(pup, 0x0b0b10), paint(glint, 0xffffff)]);
  const smile = new THREE.TorusGeometry(0.085, 0.019, 8, 22, Math.PI * 0.9).rotateZ(Math.PI * 1.05);
  const ooh = new THREE.SphereGeometry(0.06, 14, 10).scale(1, 1.25, 0.4);
  const cheek = new THREE.SphereGeometry(0.065, 12, 8).scale(1.3, 0.8, 0.3);
  const brow = new THREE.CapsuleGeometry(0.022, 0.1, 4, 8).rotateZ(Math.PI / 2);
  return { body, limbs, eye, pupil, smile, ooh, cheek, brow };
}

const shared: Record<string, THREE.Material> = {};
function sharedMats() {
  if (shared.eye) return shared;
  shared.eye = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  shared.pupil = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15 });
  shared.mouth = new THREE.MeshStandardMaterial({ color: 0x3a0a14, roughness: 0.5 });
  shared.brow = new THREE.MeshStandardMaterial({ color: 0x2a1a22, roughness: 0.6 });
  shared.cheek = new THREE.MeshStandardMaterial({ color: 0xff8aa8, roughness: 0.7, transparent: true, opacity: 0.55, depthWrite: false });
  return shared;
}

/**
 * The jelly: a soft clearcoat over the painted skin, a little of its own colour glowing in the
 * shade, light bleeding through the thin edges; `jig` (the body's wobble, metres at the top) shears
 * the body, the more the higher up.
 */
function jelly(map: THREE.Texture | null, color: number, jig?: { value: THREE.Vector2 }) {
  const m = new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : color,
    map,
    roughness: 0.38,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
    sheen: 0.6,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xffffff),
  });
  m.emissive.set(map ? 0x1e1e1e : new THREE.Color(color).multiplyScalar(0.12));
  if (map) m.emissiveMap = map;
  m.onBeforeCompile = (sh) => {
    if (jig) {
      sh.uniforms.uJig = jig;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uJig;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        float jh = clamp(transformed.y / ${(TOP_Y - HIP_Y).toFixed(3)}, 0.0, 1.2);
        transformed.xz += uJig * jh * jh;`);
    }
    // (the rim of a jelly glows with the light coming through it)
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      { float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += diffuseColor.rgb * rimF * 0.35; }`,
    );
  };
  m.customProgramCacheKey = () => (jig ? 'bean-jig' : 'bean-limb');
  return m;
}

// ----------------------------------------------------------------------------------- the rig
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const E = new THREE.Euler();

/** a spring with a velocity (for the jelly) */
class Spring {
  x = 0;
  v = 0;
  constructor(
    public k: number,
    public d: number,
  ) {}
  step(target: number, dt: number) {
    const a = (target - this.x) * this.k - this.v * this.d;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/**
 * A limb: three points (the shoulder or hip, the elbow or knee, the hand or foot) simulated with
 * Verlet — they carry their own momentum and fall under gravity, are pulled toward the pose the
 * animation wants (hard when the bean is in control, hardly at all when it's knocked flying), and
 * keep their lengths. So arms trail when it turns, flop when it lands, and fly about loose in a
 * tumble, all on their own.
 */
class Limb {
  p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  o = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private fresh = true;
  constructor(
    readonly a: number,
    readonly b: number,
    readonly r: number,
  ) {}
  step(dt: number, anchor: THREE.Vector3, tMid: THREE.Vector3, tEnd: THREE.Vector3, rate: number, floorY: number) {
    const p = this.p, o = this.o;
    if (this.fresh || p[0].distanceToSquared(anchor) > 4) {
      p[0].copy(anchor);
      p[1].copy(tMid);
      p[2].copy(tEnd);
      for (let i = 0; i < 3; i++) o[i].copy(p[i]);
      this.fresh = false;
      return;
    }
    p[0].copy(anchor);
    const damp = Math.pow(0.9, dt * 60);
    const pull = 1 - Math.exp(-rate * dt);
    const g = 24 * dt * dt;
    for (let i = 1; i < 3; i++) {
      V.subVectors(p[i], o[i]).multiplyScalar(damp);
      o[i].copy(p[i]);
      p[i].add(V);
      p[i].y -= g;
      p[i].lerp(i === 1 ? tMid : tEnd, pull);
    }
    for (let it = 0; it < 3; it++) {
      this.fix(p[0], p[1], this.a, 1);
      this.fix(p[1], p[2], this.b, 0.5);
      // (never through the floor under it)
      for (let i = 1; i < 3; i++) if (p[i].y < floorY + this.r) p[i].y = floorY + this.r;
    }
  }
  /** keeps b at `len` from a; `w`: b's share of the move (1: a is pinned) */
  private fix(a: THREE.Vector3, b: THREE.Vector3, len: number, w: number) {
    V.subVectors(b, a);
    const d = V.length() || 1e-6;
    const k = (d - len) / d;
    b.addScaledVector(V, -k * w);
    if (w < 1) a.addScaledVector(V, k * (1 - w));
  }
}

export class BeanRig {
  readonly root = new THREE.Group();
  /** the body centre (for the TAA: it moves and turns with the bean) */
  readonly core = new THREE.Object3D();
  /** the top of the head (a crown sits here) */
  readonly top = new THREE.Object3D();
  readonly outfit: Outfit;
  private tumbler = new THREE.Group();
  private inner = new THREE.Group();
  private hips = new THREE.Group();
  /** what rides on the wobble: the face (part way up) and the hat (the top) */
  private face = new THREE.Group();
  private crownG = new THREE.Group();
  private eyes = new THREE.Group();
  private pupils: THREE.Mesh;
  private smile: THREE.Mesh;
  private ooh: THREE.Mesh;
  private brows: THREE.Mesh[] = [];
  private prop: THREE.Object3D | null = null;
  private mats: THREE.Material[] = [];
  private limbMesh: THREE.SkinnedMesh;
  private bones: THREE.Bone[] = [];
  private limbs: Limb[];
  // the animation state
  private phase = Math.random() * 6;
  private yaw = 0;
  private tq = new THREE.Quaternion();
  private tBlend = 0;
  private lean = new Spring(90, 9);
  private side = new Spring(80, 8);
  private squash = new Spring(260, 10);
  /** the jelly wobble: the top's offset (hips frame x, z) on a soft spring */
  private jig = { value: new THREE.Vector2() };
  private jv = new THREE.Vector2();
  private pup = { x: 0, y: 0, vx: 0, vy: 0 };
  private prevVel = new THREE.Vector3();
  private wasGround = true;
  private floorY = -1e9;
  private floorT = 9;
  private blinkT = 2 + Math.random() * 3;
  private lookT = 0;
  private lookX = 0;
  private lookY = 0;
  private dive = 0;
  private air = 0;
  private hold = 0;
  private held = 0;
  private flop = 0;
  /** set by the game: a pose for the shows (results, the crown) */
  pose: 'win' | 'sad' | 'wave' | null = null;
  /** a foot hit the ground this frame (for the patter) */
  step = false;
  /** at the wheel of a kart: where the seat is, how it's tilted, and the steering (-1..1) */
  seat: THREE.Vector3 | null = null;
  tilt: THREE.Quaternion | null = null;
  steer: number | null = null;

  constructor(outfit: Outfit) {
    this.outfit = outfit;
    G ??= shapes();
    const S = sharedMats();
    const body = jelly(skin(outfit), outfit.a, this.jig);
    const limb = jelly(null, outfit.limb ?? outfit.a);
    this.mats.push(body, limb);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
      const x = new THREE.Mesh(g, m);
      x.castShadow = shadow;
      x.receiveShadow = true;
      return x;
    };
    this.root.add(this.tumbler);
    this.tumbler.add(this.inner);
    this.inner.position.y = -CORE_Y;
    this.tumbler.position.y = CORE_Y;
    this.inner.add(this.hips);
    this.hips.position.y = HIP_Y;
    this.hips.add(mesh(G.body, body));
    this.core.position.y = CORE_Y - HIP_Y;
    this.hips.add(this.core, this.face, this.crownG);
    this.top.position.y = TOP_Y - HIP_Y;
    this.crownG.add(this.top);
    // the face
    const fy = FACE_Y - HIP_Y;
    for (const s of [-1, 1]) {
      const e = mesh(G.eye, S.eye, false);
      e.position.set(s * 0.15, fy, 0.375);
      e.rotation.y = s * 0.3;
      this.eyes.add(e);
      const br = mesh(G.brow, S.brow, false);
      br.position.set(s * 0.16, fy + 0.2, 0.39);
      br.rotation.y = s * 0.3;
      this.brows.push(br);
      this.face.add(br);
    }
    this.face.add(this.eyes);
    this.pupils = new THREE.Mesh(mergeGeometries([G.pupil.clone().translate(-0.15, 0, 0), G.pupil.clone().translate(0.15, 0, 0)]), S.pupil);
    this.pupils.position.set(0, fy, 0.455);
    this.face.add(this.pupils);
    this.smile = mesh(G.smile, S.mouth, false);
    this.smile.position.set(0, fy - 0.19, 0.455);
    this.smile.rotation.x = -0.22;
    this.ooh = mesh(G.ooh, S.mouth, false);
    this.ooh.position.set(0, fy - 0.2, 0.455);
    this.ooh.visible = false;
    this.face.add(this.smile, this.ooh);
    for (const s of [-1, 1]) {
      const c = mesh(G.cheek, S.cheek, false);
      c.position.set(s * 0.28, fy - 0.14, 0.37);
      c.rotation.y = s * 0.62;
      this.face.add(c);
    }
    // the limbs: twelve free bones (not in the scene graph: the rig sets their matrices itself)
    for (let k = 0; k < 12; k++) {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      this.bones.push(b);
    }
    this.limbMesh = new THREE.SkinnedMesh(G.limbs, limb);
    this.limbMesh.bind(new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    this.limbMesh.castShadow = true;
    this.limbMesh.receiveShadow = true;
    this.limbMesh.frustumCulled = false;
    this.root.add(this.limbMesh);
    this.limbs = [new Limb(ARM_A, ARM_B, HAND_R), new Limb(ARM_A, ARM_B, HAND_R), new Limb(LEG_A, LEG_B, 0.09), new Limb(LEG_A, LEG_B, 0.09)];
    const h = hat(outfit);
    if (h) {
      this.crownG.add(h);
      h.traverse((o) => {
        if (o.userData.spin) this.prop = o;
      });
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.limbMesh.skeleton.dispose();
  }

  /** puts the rig where the body is, and moves it */
  update(m: Marble, dt: number, t: number) {
    dt = Math.min(dt, 1 / 20);
    const tumbling = m.mode === Mode.Tumble;
    const diving = m.mode === Mode.Dive;
    const grounded = m.groundT < 0.12;
    // where: the feet sphere's bottom; tumbling, the body centre on the ball's
    this.root.position.copy(m.pos);
    this.root.position.y -= 0.5;
    if (m.groundT < 0.2) {
      this.floorY = m.pos.y - 0.5;
      this.floorT = 0;
    } else if ((this.floorT += dt) > 0.6) this.floorY = -1e9;
    // the turn: standing, the facing; tumbling, the physics' own orientation
    if (tumbling) {
      if (this.tBlend === 0) this.yaw = m.yaw;
      Q.setFromAxisAngle(UP, -this.yaw).multiply(m.quat);
      this.tq.copy(Q);
      this.tBlend = 1;
    } else {
      if (this.tBlend > 0) {
        // (out of a tumble: from where it lay to upright, with a wobble)
        if (this.tBlend === 1) {
          Q.setFromAxisAngle(UP, this.yaw).multiply(this.tq);
          this.yaw = m.yaw;
          this.tq.copy(Q2.setFromAxisAngle(UP, -this.yaw).multiply(Q));
          this.squash.v -= 4;
        }
        this.tBlend = Math.max(0, this.tBlend - dt * 4);
        this.tq.slerp(Q.identity(), 1 - Math.exp(-dt * 13));
        if (this.tBlend === 0) this.tq.identity();
      }
      let d = m.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 16);
    }
    this.root.rotation.y = this.yaw;
    if (this.seat && this.tilt) {
      this.root.position.copy(this.seat);
      this.root.quaternion.copy(this.tilt);
      this.floorY = -1e9;
    }
    this.tumbler.quaternion.copy(this.tq);
    this.tumbler.position.y = THREE.MathUtils.lerp(CORE_Y, 0.5, this.tBlend);

    // what the body's doing, in its own frame
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rvx = m.vel.x - (grounded ? m.groundVel.x : 0), rvz = m.vel.z - (grounded ? m.groundVel.z : 0);
    const speed = Math.hypot(rvx, rvz);
    const ax = (m.vel.x - this.prevVel.x) / Math.max(dt, 1e-3), az = (m.vel.z - this.prevVel.z) / Math.max(dt, 1e-3), ay = (m.vel.y - this.prevVel.y) / Math.max(dt, 1e-3);
    this.prevVel.copy(m.vel);
    const aF = THREE.MathUtils.clamp(ax * fx + az * fz, -80, 80), aS = THREE.MathUtils.clamp(ax * fz - az * fx, -80, 80);
    // landing and take-off: squash and stretch (a hard landing squashes more)
    if (grounded && !this.wasGround && !tumbling) this.squash.v -= Math.min(10, 2 + Math.abs(m.landed || 6) * 0.6);
    if (!grounded && this.wasGround && m.vel.y > 3) this.squash.v += 5.5;
    this.wasGround = grounded;
    const sq = 1 + THREE.MathUtils.clamp(this.squash.step(0, dt), -0.35, 0.3);
    // the wobble: the top lags every change of speed and swings back past the middle
    if (!tumbling) {
      const J = this.jig.value;
      const k = 150, dmp = 7;
      // (hips frame: +x is the bean's left, +z forward)
      this.jv.x += (-J.x * k - this.jv.x * dmp + aS * 0.012) * dt;
      this.jv.y += (-J.y * k - this.jv.y * dmp - aF * 0.012) * dt;
      J.x = THREE.MathUtils.clamp(J.x + this.jv.x * dt, -0.16, 0.16);
      J.y = THREE.MathUtils.clamp(J.y + this.jv.y * dt, -0.16, 0.16);
      if (m.knocked) this.jv.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    } else this.jig.value.multiplyScalar(1 - Math.min(1, dt * 6));
    const J = this.jig.value;
    const fh = (FACE_Y - HIP_Y) / (TOP_Y - HIP_Y);
    this.face.position.set(J.x * fh * fh, 0, J.y * fh * fh);
    this.crownG.position.set(J.x, 0, J.y);
    const ease = (target: number, cur: number, rate: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
    this.dive = ease(diving ? 1 : 0, this.dive, diving ? 16 : 8);
    this.air = ease(!grounded && !tumbling ? 1 : 0, this.air, 10);
    this.hold = ease(m.holding ? 1 : 0, this.hold, 12);
    this.held = ease(m.heldT > 0 ? 1 : 0, this.held, 12);
    // floppy: knocked over, the limbs go loose; they firm up as it gets back up
    this.flop = tumbling ? 1 : ease(0, this.flop, 2.5);

    // the run: the stride from the speed over the ground
    const seated = this.steer !== null;
    const run = grounded && !tumbling && !diving && !seated ? Math.min(1, speed / 7) : 0;
    const prev = Math.sin(this.phase);
    this.phase += dt * (speed * 1.6 + (run > 0.05 ? 3 : 0));
    this.step = run > 0.2 && Math.sign(Math.sin(this.phase)) !== Math.sign(prev);
    const sw = Math.sin(this.phase);
    const bob = Math.abs(Math.cos(this.phase)) * 0.07 * run;
    // lean into the run, back on a stop; the waddle side to side
    const leanT = run * 0.22 - aF * 0.005 + this.held * -0.2;
    const lean = this.lean.step(leanT, dt);
    const side = this.side.step(sw * 0.11 * run + aS * 0.004, dt);
    const breathe = Math.sin(t * 2.4 + this.phase) * 0.012 * (1 - run);
    const s = sq + breathe;
    this.hips.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    this.hips.rotation.set(lean * (1 - this.dive) + this.dive * 1.38, 0, side * (1 - this.dive));
    this.hips.position.y = HIP_Y + bob + this.dive * 0.12;
    if (this.pose === 'win') this.hips.position.y += Math.abs(Math.sin(t * 6)) * 0.2;
    this.root.updateMatrixWorld(true);

    // ---- the limbs: the pose wanted (hips frame), then the simulation
    const fl = Math.sin(t * 17 + this.phase);
    const flail = Math.max(this.held, this.air * (m.vel.y < -7 ? 1 : 0.35));
    const hm = this.hips.matrixWorld;
    const toW = (x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyMatrix4(hm);
    const anchor = new THREE.Vector3(), mid = new THREE.Vector3(), end = new THREE.Vector3();
    const dir = (rx: number, rz: number, out: THREE.Vector3) => out.copy(DOWN).applyEuler(E.set(rx, 0, rz));
    const jl = (h: number) => (h / (TOP_Y - HIP_Y)) ** 2;
    // how hard each limb is held to its pose (per second)
    const rate = THREE.MathUtils.lerp(this.air > 0.5 ? 14 : 34, 0.8, this.flop);
    for (let L = 0; L < 2; L++) {
      const sgn = L === 0 ? 1 : -1;
      let rx = -sw * sgn * 0.95 * run;
      let rz = sgn * (0.28 + run * 0.12);
      let bend = 0.35 + run * 0.5;
      rz = THREE.MathUtils.lerp(rz, sgn * (2.0 + fl * sgn * 0.45 * flail), this.air);
      rx = THREE.MathUtils.lerp(rx, fl * sgn * 0.5 * flail, this.air);
      if (this.held > 0.5) {
        rz = sgn * (1.3 + Math.sin(t * 19 + sgn) * 0.8);
        rx = Math.sin(t * 15 + sgn * 2) * 1.1;
      }
      rx = THREE.MathUtils.lerp(rx, -1.5, this.hold);
      rz = THREE.MathUtils.lerp(rz, sgn * 0.14, this.hold);
      bend = THREE.MathUtils.lerp(bend, 0.1, this.hold);
      rx = THREE.MathUtils.lerp(rx, -2.9, this.dive);
      rz = THREE.MathUtils.lerp(rz, sgn * 0.3, this.dive);
      bend = THREE.MathUtils.lerp(bend, 0, this.dive);
      // (at the wheel: hands at ten to two, turning with it)
      if (seated && this.pose === null && this.air < 0.5) {
        const w = this.steer! * 0.34;
        rx = -1.22 + sgn * w * 0.8;
        rz = sgn * 0.3 + w * 0.32;
        bend = 0.62;
      }
      if (this.pose === 'win') {
        rx = -0.2;
        rz = sgn * (2.6 + Math.sin(t * 9 + sgn) * 0.35);
        bend = 0.2;
      } else if (this.pose === 'wave' && sgn < 0) {
        rx = -0.3;
        rz = -2.4 + Math.sin(t * 8) * 0.4;
        bend = 0.6 + Math.sin(t * 8) * 0.3;
      } else if (this.pose === 'sad') {
        rx = 0.15;
        rz = sgn * 0.1;
        bend = 0.1;
      }
      const sy = SHOULDER_Y - HIP_Y, j = jl(sy);
      toW(sgn * SHOULDER_X + J.x * j, sy, J.y * j, anchor);
      dir(rx, rz, V2);
      const ls = new THREE.Vector3(sgn * SHOULDER_X + J.x * j, sy, J.y * j).addScaledVector(V2, ARM_A);
      toW(ls.x, ls.y, ls.z, mid);
      dir(rx - bend, rz, V2);
      ls.addScaledVector(V2, ARM_B + HAND_R * 0.6);
      toW(ls.x, ls.y, ls.z, end);
      this.limbs[L].step(dt, anchor, mid, end, rate, this.floorY);
    }
    for (let L = 2; L < 4; L++) {
      const sgn = L === 2 ? 1 : -1;
      let rx = sw * sgn * 0.9 * run;
      // (the knee bends as the foot comes forward off the ground)
      let knee = Math.max(0, Math.sin(this.phase + (sgn > 0 ? 0 : Math.PI)) * 1.3 * run);
      rx = THREE.MathUtils.lerp(rx, 0.3 + Math.sin(t * 13 + sgn * 1.5) * 0.45 * flail, this.air);
      knee = THREE.MathUtils.lerp(knee, 0.7, this.air);
      rx = THREE.MathUtils.lerp(rx, 1.3, this.dive);
      knee = THREE.MathUtils.lerp(knee, 0.2, this.dive);
      // (feet out in front on the pedals)
      if (seated) {
        rx = -1.42;
        knee = -0.32;
      }
      const hy = 0.0, j = jl(0.05);
      toW(sgn * 0.2 + J.x * j, hy, J.y * j, anchor);
      dir(rx, sgn * 0.05, V2);
      const ls = new THREE.Vector3(sgn * 0.2, hy, 0).addScaledVector(V2, LEG_A);
      toW(ls.x, ls.y, ls.z, mid);
      dir(rx - knee, sgn * 0.05, V2);
      ls.addScaledVector(V2, LEG_B + 0.03);
      toW(ls.x, ls.y, ls.z, end);
      this.limbs[L].step(dt, anchor, mid, end, rate * 1.2, this.floorY);
    }
    // ---- the bones from the simulated points (world space: an attached skin cancels its own matrix)
    const fwd = new THREE.Vector3(fx, 0, fz);
    for (let L = 0; L < 4; L++) {
      const p = this.limbs[L].p;
      for (let k = 0; k < 3; k++) {
        const b = this.bones[L * 3 + k];
        const from = p[Math.min(k, 2)];
        let ydir: THREE.Vector3;
        if (k < 2) ydir = V.subVectors(p[k], p[k + 1]);
        else ydir = V.subVectors(p[1], p[2]);
        ydir.normalize();
        // a foot stays flat-ish and points forward; a hand follows its forearm
        if (L >= 2 && k === 2) {
          const flat = 1 - this.flop * 0.8;
          ydir.lerp(UP, flat).normalize();
          const z = V2.copy(fwd).addScaledVector(ydir, -fwd.dot(ydir)).normalize();
          const x = new THREE.Vector3().crossVectors(ydir, z);
          b.matrixWorld.makeBasis(x, ydir, z).setPosition(from);
        } else {
          Q.setFromUnitVectors(UP, ydir);
          b.matrixWorld.compose(from, Q, ONE);
        }
      }
    }

    // ---- the face: googly pupils on springs, blinks, brows, a mouth that drops open when things go wrong
    const p = this.pup;
    const kx = -aS * 0.0016, ky = -(ay + 24) * 0.0009 * (grounded ? 0.3 : 1);
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 0.6 + Math.random() * 2.2;
      this.lookX = (Math.random() - 0.5) * 0.045;
      this.lookY = (Math.random() - 0.4) * 0.028;
    }
    const tx = this.lookX * (1 - run) + (tumbling ? Math.sin(t * 20) * 0.045 : 0), ty = this.lookY * (1 - run) + (tumbling ? Math.cos(t * 20) * 0.045 : 0);
    p.vx += ((tx - p.x) * 320 - p.vx * 14 + kx * 320) * dt;
    p.vy += ((ty - p.y) * 320 - p.vy * 14 + ky * 320) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const pl = Math.hypot(p.x, p.y);
    if (pl > 0.05) (p.x *= 0.05 / pl), (p.y *= 0.05 / pl);
    this.pupils.position.x = p.x;
    this.pupils.position.y = FACE_Y - HIP_Y + p.y;
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 && this.blinkT > 0 ? 0.12 : 1;
    if (this.blinkT < 0) this.blinkT = 1.5 + Math.random() * 4;
    this.eyes.scale.y = blink;
    this.pupils.visible = blink > 0.5;
    const shock = tumbling || this.held > 0.5 || (this.air > 0.5 && m.vel.y < -9) || this.pose === 'sad';
    const fierce = this.dive > 0.5 || this.hold > 0.5;
    this.smile.visible = !shock;
    this.ooh.visible = shock;
    this.smile.scale.setScalar(this.pose === 'win' ? 1.4 : 1);
    // brows: up in a fright, down and in when it means it, a happy lift on the podium
    this.brows.forEach((br, i) => {
      const sgn = i === 0 ? -1 : 1;
      const tilt = fierce ? -sgn * 0.45 : shock ? sgn * 0.35 : this.pose === 'win' ? sgn * 0.2 : 0;
      const lift = shock ? 0.05 : fierce ? -0.03 : this.pose === 'win' ? 0.03 : 0;
      br.rotation.z = ease(tilt, br.rotation.z, 18);
      br.position.y = ease(FACE_Y - HIP_Y + 0.2 + lift, br.position.y, 18);
    });
    if (this.prop) this.prop.rotation.y += dt * (8 + speed * 2.5 + this.air * 20);
  }
}
const ONE = new THREE.Vector3(1, 1, 1);

/** a bean that stands still and cheers (the giant ones on the pegs out in the paint) */
export function beanStatue(o: Outfit): THREE.Object3D {
  const rig = new BeanRig(o);
  rig.pose = 'win';
  const m = new Marble(-1);
  m.groundT = 0;
  m.pos.set(0, 0.5, 0);
  for (let k = 0; k < 30; k++) rig.update(m, 1 / 60, 0.4 + k / 60);
  rig.root.position.set(0, 0, 0);
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((x) => {
    x.castShadow = false;
  });
  return rig.root;
}
