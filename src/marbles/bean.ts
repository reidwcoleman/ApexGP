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

/** body proportions (m), from the ground under the feet */
const HIP_Y = 0.33;
const CORE_Y = 0.8;
const TOP_Y = 1.5;

export type Pat = 'solid' | 'belly' | 'stripes' | 'dots' | 'split' | 'zigzag' | 'stars' | 'hearts' | 'checker' | 'spots' | 'swirl' | 'fade';
export type Hat = 'none' | 'beanie' | 'party' | 'propeller' | 'bow' | 'horns' | 'antenna' | 'flower' | 'tophat' | 'headphones' | 'sprout' | 'cap';

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
];

/** a random outfit for a bot: any colour, any pattern, any hat */
export function randomOutfit(rnd: () => number): Outfit {
  const base = OUTFITS[Math.floor(rnd() * OUTFITS.length)];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const pats: Pat[] = ['solid', 'belly', 'stripes', 'dots', 'split', 'zigzag', 'stars', 'hearts', 'checker', 'spots', 'swirl', 'fade'];
  const hats: Hat[] = ['none', 'none', 'beanie', 'party', 'propeller', 'bow', 'horns', 'antenna', 'flower', 'tophat', 'headphones', 'sprout', 'cap'];
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
  }
  // a clear patch for the face on the busy ones
  if (['dots', 'stars', 'hearts', 'checker', 'spots', 'zigzag', 'swirl', 'stripes'].includes(o.pat)) {
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

// ----------------------------------------------------------------------------------- shapes
let G: ReturnType<typeof shapes> | null = null;
function shapes() {
  // the body: a jelly bean's profile turned round (the seam at the back)
  const prof = new THREE.SplineCurve(
    [
      [0.001, 0.17],
      [0.2, 0.19],
      [0.36, 0.27],
      [0.445, 0.42],
      [0.47, 0.62],
      [0.46, 0.86],
      [0.43, 1.06],
      [0.37, 1.26],
      [0.27, 1.41],
      [0.13, 1.49],
      [0.001, 1.505],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
  );
  const body = new THREE.LatheGeometry(prof.getPoints(40), 48).rotateY(Math.PI);
  body.translate(0, -HIP_Y, 0);
  const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 6, 14);
  // an arm hanging from the shoulder, its hand at the end
  const arm = mergeGeometries([cap(0.068, 0.24).translate(0, -0.16, 0), new THREE.SphereGeometry(0.098, 16, 12).translate(0, -0.33, 0.01)]);
  // a leg from the hip, its foot pointing forward
  const leg = mergeGeometries([cap(0.085, 0.14).translate(0, -0.12, 0), new THREE.SphereGeometry(1, 18, 12).scale(0.115, 0.08, 0.165).translate(0, -0.26, 0.05)]);
  const eye = new THREE.SphereGeometry(0.118, 24, 16).scale(1, 1.12, 0.62);
  // the pupil with its glint (vertex colours: black, a white fleck)
  const pup = new THREE.SphereGeometry(0.062, 16, 12).scale(1, 1.1, 0.5);
  const glint = new THREE.SphereGeometry(0.018, 8, 6).translate(0.022, 0.026, 0.03);
  const paint = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const pupil = mergeGeometries([paint(pup, 0x0b0b10), paint(glint, 0xffffff)]);
  const smile = new THREE.TorusGeometry(0.075, 0.017, 8, 20, Math.PI * 0.9).rotateZ(Math.PI * 1.05);
  const ooh = new THREE.SphereGeometry(0.055, 14, 10).scale(1, 1.25, 0.4);
  const cheek = new THREE.SphereGeometry(0.06, 12, 8).scale(1.3, 0.8, 0.3);
  return { body, arm, leg, eye, pupil, smile, ooh, cheek };
}

const shared: Record<string, THREE.Material> = {};
function sharedMats() {
  if (shared.eye) return shared;
  shared.eye = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1 });
  shared.pupil = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15 });
  shared.mouth = new THREE.MeshStandardMaterial({ color: 0x3a0a14, roughness: 0.5 });
  shared.cheek = new THREE.MeshStandardMaterial({ color: 0xff8aa8, roughness: 0.7, transparent: true, opacity: 0.55, depthWrite: false });
  return shared;
}

/** the jelly: a soft clearcoat over the painted skin, a little of its own colour glowing in the shade */
function jelly(map: THREE.Texture | null, color: number) {
  const m = new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : color,
    map,
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
    sheen: 0.5,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0xffffff),
  });
  m.emissive.set(map ? 0x1e1e1e : new THREE.Color(color).multiplyScalar(0.12));
  if (map) m.emissiveMap = map;
  return m;
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
      add(new THREE.TorusGeometry(0.4, 0.035, 8, 28, Math.PI), m, 0, top - 0.42, 0);
      for (const s of [-1, 1]) {
        const cup = add(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 20), M(h2, 0.4), s * 0.44, top - 0.42, 0);
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
  }
  return g;
}

// ----------------------------------------------------------------------------------- the rig
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const V = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

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
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private eyes = new THREE.Group();
  private pupils: THREE.Mesh;
  private smile: THREE.Mesh;
  private ooh: THREE.Mesh;
  private prop: THREE.Object3D | null = null;
  private mats: THREE.Material[] = [];
  // the animation state
  private phase = Math.random() * 6;
  private yaw = 0;
  private tq = new THREE.Quaternion();
  private tBlend = 0;
  private lean = new Spring(90, 9);
  private side = new Spring(80, 8);
  private squash = new Spring(260, 11);
  private pup = { x: 0, y: 0, vx: 0, vy: 0 };
  private prevVel = new THREE.Vector3();
  private wasGround = true;
  private blinkT = 2 + Math.random() * 3;
  private lookT = 0;
  private lookX = 0;
  private lookY = 0;
  private dive = 0;
  private air = 0;
  private hold = 0;
  private held = 0;
  private stepAcc = 0;
  /** set by the game: a pose for the shows (results, the crown) */
  pose: 'win' | 'sad' | 'wave' | null = null;
  /** a foot hit the ground this frame (for the patter) */
  step = false;

  constructor(outfit: Outfit) {
    this.outfit = outfit;
    G ??= shapes();
    const S = sharedMats();
    const body = jelly(skin(outfit), outfit.a);
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
    this.inner.add(this.hips, this.legL, this.legR);
    this.hips.position.y = HIP_Y;
    this.hips.add(mesh(G.body, body));
    this.core.position.y = CORE_Y - HIP_Y;
    this.top.position.y = TOP_Y - HIP_Y;
    this.hips.add(this.core, this.top);
    // the face
    const fy = 1.12 - HIP_Y;
    for (const s of [-1, 1]) {
      const e = mesh(G.eye, S.eye, false);
      e.position.set(s * 0.135, fy, 0.355);
      e.rotation.y = s * 0.28;
      this.eyes.add(e);
    }
    this.hips.add(this.eyes);
    this.pupils = new THREE.Mesh(mergeGeometries([G.pupil.clone().translate(-0.135, 0, 0), G.pupil.clone().translate(0.135, 0, 0)]), S.pupil);
    this.pupils.position.set(0, fy, 0.43);
    this.hips.add(this.pupils);
    this.smile = mesh(G.smile, S.mouth, false);
    this.smile.position.set(0, 0.955 - HIP_Y, 0.435);
    this.smile.rotation.x = -0.25;
    this.ooh = mesh(G.ooh, S.mouth, false);
    this.ooh.position.set(0, 0.94 - HIP_Y, 0.435);
    this.ooh.visible = false;
    this.hips.add(this.smile, this.ooh);
    for (const s of [-1, 1]) {
      const c = mesh(G.cheek, S.cheek, false);
      c.position.set(s * 0.25, 0.99 - HIP_Y, 0.37);
      c.rotation.y = s * 0.6;
      this.hips.add(c);
    }
    // arms and legs
    for (const [arm, s] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      arm.position.set(s * 0.4, 0.86 - HIP_Y, 0);
      arm.add(mesh(G.arm, limb));
      this.hips.add(arm);
    }
    for (const [leg, s] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      leg.position.set(s * 0.17, HIP_Y - 0.01, 0);
      leg.add(mesh(G.leg, limb));
    }
    const h = hat(outfit);
    if (h) {
      this.hips.add(h);
      h.traverse((o) => {
        if (o.userData.spin) this.prop = o;
      });
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
  }

  /** puts the rig where the body is, and moves it */
  update(m: Marble, dt: number, t: number) {
    const tumbling = m.mode === Mode.Tumble;
    const diving = m.mode === Mode.Dive;
    const grounded = m.groundT < 0.12;
    // where: the feet sphere's bottom; tumbling, the body centre on the ball's
    this.root.position.copy(m.pos);
    this.root.position.y -= 0.5;
    // the turn: standing, the facing; tumbling, the physics' own orientation
    if (tumbling) {
      if (this.tBlend === 0) this.yaw = m.yaw;
      Q.setFromAxisAngle(UP, -this.yaw).multiply(m.quat);
      this.tq.copy(Q);
      this.tBlend = 1;
    } else {
      if (this.tBlend > 0) {
        // (out of a tumble: from where it lay to upright, quickly)
        if (this.tBlend === 1) {
          Q.setFromAxisAngle(UP, this.yaw).multiply(this.tq);
          this.yaw = m.yaw;
          this.tq.copy(Q2.setFromAxisAngle(UP, -this.yaw).multiply(Q));
        }
        this.tBlend = Math.max(0, this.tBlend - dt * 4.5);
        this.tq.slerp(Q.identity(), 1 - Math.exp(-dt * 16));
        if (this.tBlend === 0) this.tq.identity();
      }
      let d = m.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 18);
    }
    this.root.rotation.y = this.yaw;
    this.tumbler.quaternion.copy(this.tq);
    this.tumbler.position.y = THREE.MathUtils.lerp(CORE_Y, 0.5, this.tBlend);

    // what the body's doing, in its own frame
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rvx = m.vel.x - (grounded ? m.groundVel.x : 0), rvz = m.vel.z - (grounded ? m.groundVel.z : 0);
    const speed = Math.hypot(rvx, rvz);
    const ax = (m.vel.x - this.prevVel.x) / Math.max(dt, 1e-3), az = (m.vel.z - this.prevVel.z) / Math.max(dt, 1e-3), ay = (m.vel.y - this.prevVel.y) / Math.max(dt, 1e-3);
    this.prevVel.copy(m.vel);
    const aF = THREE.MathUtils.clamp(ax * fx + az * fz, -60, 60), aS = THREE.MathUtils.clamp(ax * fz - az * fx, -60, 60);
    // landing and take-off: squash and stretch
    if (grounded && !this.wasGround && !tumbling) this.squash.v -= Math.min(9, 1.5 + Math.abs(m.landed || 6) * 0.5);
    if (!grounded && this.wasGround && m.vel.y > 3) this.squash.v += 5;
    this.wasGround = grounded;
    const sq = 1 + this.squash.step(0, dt);
    const k = (x: number, rate: number) => 1 - Math.exp(-dt * rate) + 0 * x;
    this.dive += ((diving ? 1 : 0) - this.dive) * k(0, diving ? 16 : 9);
    this.air += ((!grounded && !tumbling ? 1 : 0) - this.air) * k(0, 10);
    this.hold += ((m.holding ? 1 : 0) - this.hold) * k(0, 12);
    this.held += ((m.heldT > 0 ? 1 : 0) - this.held) * k(0, 12);

    // the run: the stride from the speed over the ground
    const run = grounded && !tumbling && !diving ? Math.min(1, speed / 7) : 0;
    const prev = Math.sin(this.phase);
    this.phase += dt * (speed * 1.55 + (run > 0.05 ? 3 : 0));
    this.step = run > 0.2 && Math.sign(Math.sin(this.phase)) !== Math.sign(prev);
    void this.stepAcc;
    const sw = Math.sin(this.phase);
    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * run;
    // lean into the run, wobble on every change of speed; the waddle side to side
    const leanT = run * 0.2 - aF * 0.006 + this.held * -0.2;
    const lean = this.lean.step(leanT, dt);
    const side = this.side.step(sw * 0.1 * run + aS * 0.004, dt);
    const breathe = Math.sin(t * 2.4 + this.phase) * 0.012 * (1 - run);
    const s = sq + breathe;
    this.hips.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    this.hips.rotation.set(lean * (1 - this.dive) + this.dive * 1.38, 0, side * (1 - this.dive));
    this.hips.position.y = HIP_Y + bob + this.dive * 0.12;
    this.inner.position.y = -CORE_Y;

    // arms: swing with the stride; up in the air; reaching out in a grab; forward in a dive
    const fl = Math.sin(t * 17 + this.phase);
    const tumbleFl = tumbling ? 1 : 0;
    const flail = Math.max(tumbleFl, this.held, this.air * (m.vel.y < -7 ? 1 : 0.35));
    for (const [arm, sgn] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      let rx = -sw * sgn * 0.9 * run;
      let rz = sgn * (0.22 + run * 0.12);
      // the air: arms flung up and out
      rz = THREE.MathUtils.lerp(rz, sgn * (1.9 + fl * sgn * 0.45 * flail), this.air);
      rx = THREE.MathUtils.lerp(rx, fl * sgn * 0.5 * flail, this.air);
      // tumbling, held: windmilling
      if (flail > 0.5 && !this.air) {
        rz = sgn * (1.2 + Math.sin(t * 19 + sgn) * 0.9);
        rx = Math.sin(t * 15 + sgn * 2) * 1.2;
      }
      // a grab: both arms out in front
      rx = THREE.MathUtils.lerp(rx, -1.45, this.hold);
      rz = THREE.MathUtils.lerp(rz, sgn * 0.12, this.hold);
      // a dive: arms forward past the head
      rx = THREE.MathUtils.lerp(rx, -2.9, this.dive);
      rz = THREE.MathUtils.lerp(rz, sgn * 0.3, this.dive);
      if (this.pose === 'win') {
        rx = -0.2;
        rz = sgn * (2.6 + Math.sin(t * 9 + sgn) * 0.35);
      } else if (this.pose === 'wave' && sgn < 0) {
        rx = -0.3;
        rz = -2.4 + Math.sin(t * 8) * 0.4;
      } else if (this.pose === 'sad') {
        rx = 0.15;
        rz = sgn * 0.08;
      }
      arm.rotation.set(rx, 0, rz);
    }
    // legs: the stride; dangling and kicking in the air; straight out behind in a dive
    for (const [leg, sgn] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      let rx = sw * sgn * 0.85 * run;
      rx = THREE.MathUtils.lerp(rx, 0.35 + Math.sin(t * 13 + sgn * 1.5) * 0.4 * flail, this.air);
      if (tumbling) rx = Math.sin(t * 14 + sgn * 2) * 0.9;
      rx = THREE.MathUtils.lerp(rx, 1.25, this.dive);
      leg.rotation.set(rx, 0, sgn * 0.04);
      // (in a dive the legs hang off the hips, which have pitched forward)
      leg.position.set(sgn * 0.17, HIP_Y - 0.01 + this.dive * 0.1, -this.dive * 0.18);
    }
    if (this.pose === 'win') this.hips.position.y += Math.abs(Math.sin(t * 6)) * 0.2;

    // the face: googly pupils on springs, blinks, a mouth that drops open when things go wrong
    const p = this.pup;
    const kx = -aS * 0.0016, ky = -(ay + 24) * 0.0009 * (grounded ? 0.3 : 1);
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 0.6 + Math.random() * 2.2;
      this.lookX = (Math.random() - 0.5) * 0.04;
      this.lookY = (Math.random() - 0.4) * 0.025;
    }
    const tx = this.lookX * (1 - run) + (tumbling ? Math.sin(t * 20) * 0.04 : 0), ty = this.lookY * (1 - run) + (tumbling ? Math.cos(t * 20) * 0.04 : 0);
    p.vx += ((tx - p.x) * 320 - p.vx * 14 + kx * 320) * dt;
    p.vy += ((ty - p.y) * 320 - p.vy * 14 + ky * 320) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const pl = Math.hypot(p.x, p.y);
    if (pl > 0.045) (p.x *= 0.045 / pl), (p.y *= 0.045 / pl);
    this.pupils.position.x = p.x;
    this.pupils.position.y = 1.12 - HIP_Y + p.y;
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 && this.blinkT > 0 ? 0.12 : 1;
    if (this.blinkT < 0) this.blinkT = 1.5 + Math.random() * 4;
    this.eyes.scale.y = blink;
    this.pupils.visible = blink > 0.5;
    const shock = tumbling || this.held > 0.5 || (this.air > 0.5 && m.vel.y < -9) || this.pose === 'sad';
    this.smile.visible = !shock;
    this.ooh.visible = shock;
    this.smile.scale.setScalar(this.pose === 'win' ? 1.4 : 1);
    if (this.prop) this.prop.rotation.y += dt * (8 + speed * 2.5 + this.air * 20);
    void V;
  }
}

/** a bean that stands still and cheers (the giant ones on the pegs out in the paint) */
export function beanStatue(o: Outfit): THREE.Object3D {
  const rig = new BeanRig(o);
  rig.pose = 'win';
  const m = new Marble(-1);
  m.groundT = 0;
  m.pos.set(0, 0.5, 0);
  rig.update(m, 1 / 60, 0.4);
  rig.root.position.set(0, 0, 0);
  rig.root.traverse((x) => {
    x.castShadow = false;
  });
  return rig.root;
}
