import * as THREE from 'three';
import type { Network } from '../roads.ts';
import type { BuildingsBuild } from './buildings.ts';
import { rng } from './build.ts';

/**
 * Things to look at between the buildings: billboards on the low and mid-rise roofs (frames, a
 * catwalk, lamps that light them after dark) carrying a set of made-up Miami ads, and strings of
 * flag bunting across the festive streets (Calle Ocho, Ocean Drive, Washington Ave, Wynwood's
 * 2nd Ave). All instanced; the ads share one canvas atlas.
 */

export interface StreetLifeBuild {
  group: THREE.Group;
  update(night: number): void;
}

// ------------------------------------------------------------------------------- the ads

type Ad = (c: CanvasRenderingContext2D, w: number, h: number) => void;

const font = (wt: number, px: number) => `${wt} ${px}px "Titillium Web", "Arial Black", Arial, sans-serif`;

function sunset(c: CanvasRenderingContext2D, w: number, h: number, stops: string[]) {
  const g = c.createLinearGradient(0, 0, 0, h);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

function palm(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  c.save();
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = s * 0.07;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x + s * 0.15, y - s * 0.5, x + s * 0.05, y - s);
  c.stroke();
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9;
    c.beginPath();
    c.moveTo(x + s * 0.05, y - s);
    c.quadraticCurveTo(x + s * 0.05 + Math.cos(a) * s * 0.35, y - s + Math.sin(a) * s * 0.35 - s * 0.12, x + s * 0.05 + Math.cos(a) * s * 0.6, y - s + Math.sin(a) * s * 0.4 + s * 0.15);
    c.lineWidth = s * 0.05;
    c.stroke();
  }
  c.restore();
}

const ADS: Ad[] = [
  (c, w, h) => {
    sunset(c, w, h, ['#ff2d7a', '#ff7a2d', '#ffd23f']);
    c.fillStyle = '#fff3c4';
    c.beginPath();
    c.arc(w * 0.78, h * 0.62, h * 0.32, 0, Math.PI * 2);
    c.fill();
    palm(c, w * 0.88, h * 1.02, h * 0.95, '#3a0a2a');
    c.fillStyle = '#fff';
    c.font = font(900, h * 0.3);
    c.fillText('PALMA COLA', w * 0.05, h * 0.42);
    c.font = font(700, h * 0.12);
    c.fillText('Taste the coast.', w * 0.06, h * 0.64);
    // the bottle
    c.fillStyle = '#5a0f1c';
    c.fillRect(w * 0.6, h * 0.28, h * 0.12, h * 0.6);
    c.fillRect(w * 0.6 + h * 0.035, h * 0.12, h * 0.05, h * 0.18);
  },
  (c, w, h) => {
    sunset(c, w, h, ['#1b0a4a', '#5b1da8', '#ff3f8e']);
    c.strokeStyle = '#57e8ff';
    c.lineWidth = h * 0.025;
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.arc(w * 0.18, h * 0.5, h * (0.1 + i * 0.07), -0.9, 0.9);
      c.stroke();
    }
    c.fillStyle = '#fff';
    c.font = font(900, h * 0.28);
    c.fillText('FLAMINGO FM', w * 0.32, h * 0.46);
    c.fillStyle = '#ffd23f';
    c.font = font(900, h * 0.2);
    c.fillText('99.1  ·  MIAMI HITS', w * 0.33, h * 0.75);
  },
  (c, w, h) => {
    c.fillStyle = '#0b0b10';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ff3f8e';
    c.lineWidth = h * 0.03;
    c.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h * 0.88);
    c.fillStyle = '#ff3f8e';
    c.font = font(900, h * 0.3);
    c.fillText('CORAL CLUB', w * 0.08, h * 0.44);
    c.fillStyle = '#57e8ff';
    c.font = font(700, h * 0.14);
    c.fillText('OCEAN DRIVE  ·  LIVE EVERY NIGHT', w * 0.08, h * 0.72);
  },
  (c, w, h) => {
    sunset(c, w, h, ['#0a1a2f', '#103a63']);
    // a wedge of a car
    c.fillStyle = '#ff3f8e';
    c.beginPath();
    c.moveTo(w * 0.5, h * 0.78);
    c.lineTo(w * 0.62, h * 0.5);
    c.lineTo(w * 0.8, h * 0.44);
    c.lineTo(w * 0.96, h * 0.6);
    c.lineTo(w * 0.97, h * 0.78);
    c.closePath();
    c.fill();
    c.fillStyle = '#111';
    for (const x of [0.6, 0.88]) {
      c.beginPath();
      c.arc(w * x, h * 0.8, h * 0.08, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.font = font(900, h * 0.24);
    c.fillText('VESPERA GT-R', w * 0.05, h * 0.42);
    c.font = font(600, h * 0.12);
    c.fillStyle = '#9fd8ff';
    c.fillText('Born in the heat.', w * 0.06, h * 0.64);
  },
  (c, w, h) => {
    sunset(c, w, h, ['#ffe25a', '#ffb627']);
    c.fillStyle = '#ff6a1a';
    c.beginPath();
    c.arc(w * 0.16, h * 0.5, h * 0.3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ff6a1a';
    c.lineWidth = h * 0.04;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.beginPath();
      c.moveTo(w * 0.16 + Math.cos(a) * h * 0.36, h * 0.5 + Math.sin(a) * h * 0.36);
      c.lineTo(w * 0.16 + Math.cos(a) * h * 0.46, h * 0.5 + Math.sin(a) * h * 0.46);
      c.stroke();
    }
    c.fillStyle = '#3a1500';
    c.font = font(900, h * 0.3);
    c.fillText('SUNRAY', w * 0.36, h * 0.45);
    c.font = font(800, h * 0.15);
    c.fillText('SPF 50  ·  STAY GOLDEN', w * 0.37, h * 0.72);
  },
  (c, w, h) => {
    c.fillStyle = '#0f6f4a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#c6f24e';
    c.beginPath();
    c.ellipse(w * 0.84, h * 0.5, h * 0.3, h * 0.36, 0.4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = font(900, h * 0.27);
    c.fillText('CASA LIMÓN', w * 0.05, h * 0.42);
    c.fillStyle = '#ffd23f';
    c.font = font(700, h * 0.13);
    c.fillText('Cuban kitchen · Calle Ocho', w * 0.06, h * 0.68);
  },
  (c, w, h) => {
    sunset(c, w, h, ['#00c2d6', '#0062d6']);
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = h * 0.04;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      for (let x = 0; x <= w; x += 10) c.lineTo(x, h * (0.78 + k * 0.08) + Math.sin(x * 0.03 + k) * h * 0.04);
      c.stroke();
    }
    c.fillStyle = '#fff';
    c.font = font(900, h * 0.28);
    c.fillText('AQUA DIVE CO.', w * 0.05, h * 0.42);
    c.font = font(700, h * 0.13);
    c.fillText('Reef trips daily from Bayside', w * 0.06, h * 0.62);
  },
  (c, w, h) => {
    sunset(c, w, h, ['#120024', '#3d0a6b']);
    c.fillStyle = '#ffd23f';
    for (let i = 0; i < 30; i++) {
      c.globalAlpha = 0.6;
      c.fillRect(((i * 97) % 100) / 100 * w, ((i * 53) % 100) / 100 * h * 0.5, 4, 4);
    }
    c.globalAlpha = 1;
    c.fillStyle = '#9be22a';
    c.font = font(900, h * 0.3);
    c.fillText('ELECTRIC BAY', w * 0.05, h * 0.5);
    c.fillStyle = '#fff';
    c.font = font(700, h * 0.13);
    c.fillText('MUSIC FESTIVAL · BAYFRONT PARK · MARCH', w * 0.06, h * 0.75);
  },
];

function adAtlas(): THREE.CanvasTexture {
  const cw = 1024, ch = 448;
  const cv = document.createElement('canvas');
  cv.width = cw * 2;
  cv.height = ch * 4;
  const c = cv.getContext('2d')!;
  ADS.forEach((ad, i) => {
    c.save();
    c.translate((i % 2) * cw, Math.floor(i / 2) * ch);
    c.beginPath();
    c.rect(0, 0, cw, ch);
    c.clip();
    ad(c, cw, ch);
    c.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------------------- build

const FESTIVE = /^(SW 8th St|Calle Ocho|Ocean Dr|Washington Ave|Lincoln Rd|Espanola Way|NE 2nd Ave|NW 2nd Ave)$/;

export function buildStreetLife(net: Network, buildings: BuildingsBuild): StreetLifeBuild {
  const group = new THREE.Group();
  group.name = 'StreetLife';
  const R = rng(4242);

  // ---- billboards: on a share of the low and mid-rise roofs, facing the nearest road
  const W = 12, H = 5.2;
  const boards: THREE.Matrix4[] = [];
  const cells: number[] = [];
  const frames: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const r of buildings.roofs) {
    if (r.y < 8 || r.y > 48 || Math.min(r.w, r.d) < 12 || R() > 0.16) continue;
    const hit = net.nearestEdge(r.x, r.z, 0, 70, (e) => e.kind !== 'lane');
    if (!hit) continue;
    const pt = net.point(hit.e, hit.pr.s, 0, { x: 0, y: 0, z: 0, tx: 0, tz: 0 });
    const yaw = Math.atan2(pt.x - r.x, pt.z - r.z);
    // set back from the roof's edge toward the road
    const back = Math.min(r.w, r.d) * 0.25;
    const bx = r.x + Math.sin(yaw) * back, bz = r.z + Math.cos(yaw) * back;
    const y = r.y + 3.4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    boards.push(new THREE.Matrix4().compose(p.set(bx, y + H / 2, bz), q, s));
    cells.push(Math.floor(R() * ADS.length));
    frames.push(new THREE.Matrix4().compose(p.set(bx, r.y, bz), q, s));
  }
  if (boards.length) {
    const atlas = adAtlas();
    const g = new THREE.PlaneGeometry(W, H);
    const uvOff = new Float32Array(boards.length * 2);
    cells.forEach((c, i) => uvOff.set([(c % 2) / 2, 1 - (Math.floor(c / 2) + 1) / 4], i * 2));
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(uvOff, 2));
    const mat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aCell + uv * vec2( 0.5, 0.25 );\n#endif\n#ifdef USE_EMISSIVEMAP\nvEmissiveMapUv = aCell + uv * vec2( 0.5, 0.25 );\n#endif');
    };
    mat.customProgramCacheKey = () => 'ow-billboard-v1';
    const im = new THREE.InstancedMesh(g, mat, boards.length);
    boards.forEach((b, i) => im.setMatrixAt(i, b));
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
    // the frame: two legs, a back, a catwalk with its lamps
    const parts: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const b = new THREE.BoxGeometry(w, h, d);
      b.translate(x, y, z);
      parts.push(b);
    };
    for (const sx of [-W * 0.3, W * 0.3]) box(0.35, 3.4 + H * 0.5, 0.35, sx, (3.4 + H * 0.5) / 2, -0.3);
    box(W + 0.3, H + 0.3, 0.12, 0, 3.4 + H / 2, -0.12);
    box(W, 0.08, 1.0, 0, 3.2, 0.35);
    for (let i = 0; i < 4; i++) box(0.12, 0.4, 0.6, -W * 0.375 + i * W * 0.25, 3.2, 0.9);
    const fg = mergeGeos(parts);
    const fm = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 });
    const fim = new THREE.InstancedMesh(fg, fm, frames.length);
    frames.forEach((f, i) => fim.setMatrixAt(i, f));
    fim.castShadow = true;
    group.add(fim);
    (group.userData as { boardMat: THREE.MeshStandardMaterial }).boardMat = mat;
  }

  // ---- bunting: flag strings across the festive streets every ~28 m
  const flagM: THREE.Matrix4[] = [];
  const flagC: THREE.Color[] = [];
  const COLS = [0xff3f8e, 0xffd23f, 0x12c6d6, 0x9be22a, 0xff6a1a, 0x7b3cff, 0xffffff];
  const tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  for (const e of net.edges) {
    if (!FESTIVE.test(e.name ?? '') || e.elevated) continue;
    const half = e.hw + Math.max(0, e.spec.sidewalk) * 0.6;
    for (let sAlong = 14; sAlong < e.len - 10; sAlong += 28) {
      const a = net.point(e, sAlong, -half, { ...tmp }), b = net.point(e, sAlong, half, { ...tmp });
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(6, Math.round(span / 0.9));
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const k = Math.floor(R() * COLS.length);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const sag = 1.4 * 4 * t * (1 - t);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2);
        flagM.push(new THREE.Matrix4().compose(p.set(a.x + (b.x - a.x) * t, a.y + 7.2 - sag, a.z + (b.z - a.z) * t), q, s));
        flagC.push(new THREE.Color(COLS[(k + i) % COLS.length]));
      }
    }
  }
  if (flagM.length) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.32, 0, 0, 0.32, 0, 0, 0, -0.55, 0], 3));
    tri.computeVertexNormals();
    const fm = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(tri, fm, flagM.length);
    flagM.forEach((f, i) => {
      im.setMatrixAt(i, f);
      im.setColorAt(i, flagC[i]);
    });
    group.add(im);
  }

  return {
    group,
    update(night: number) {
      const bm = (group.userData as { boardMat?: THREE.MeshStandardMaterial }).boardMat;
      if (bm) bm.emissiveIntensity = night * 0.85;
    },
  };
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    const a = g.getAttribute('position'), b = g.getAttribute('normal');
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(b.getX(i), b.getY(i), b.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
