import * as THREE from 'three';
import type { World } from './collide.ts';
import type { Fx } from './fx.ts';

/**
 * What people wrote on the walls, and the rooms where it went worst.
 *
 * Graffiti is spray paint drawn into a canvas at load (white ground, the paint dark), laid on the walls as decals that
 * multiply onto the surface, so the wall's own light carries over it. Where it goes is found at load too: from inside
 * each room a ray to a wall, then four more to the corners of the piece, and only a flat run of wall (no door, no
 * window, no corner) takes it. A few rooms, picked by the map's seed, are where it went worst: blood over the floor,
 * up the walls, and dragged out of the door.
 */

const COLS = 4, ROWS = 8;
const PAINT = ['#141414', '#151515', '#6e0b08', '#5a0907', '#1a2a55', '#1e4423', '#3a3a3a'];

/** what's written: words, and a few marks that aren't */
const WORDS = [
  'GET OUT', 'THEY HEAR YOU', "DON'T LOOK BACK", 'NO WAY OUT', "IT'S STILL HERE", 'LIGHTS OFF', 'WE TRIED', 'HELP US',
  'KEEP QUIET', 'COUNT THEM', 'NOT ALONE', 'SORRY MOM', 'WHO LET THEM IN', 'TURN BACK', 'STAY OUT', 'DONT TRUST THE DOORS',
  'IT WATCHES', 'BEHIND YOU', 'NOBODY CAME', 'RUN', 'DEAD END', 'WHERE IS EVERYONE',
];

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

/** one spray-painted piece in a cell: overspray, the stroke, drips off the heavy parts */
function paint(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, k: number, r: () => number) {
  const col = PAINT[Math.floor(r() * PAINT.length)];
  c.save();
  c.beginPath();
  c.rect(x0 + 6, y0 + 6, w - 12, h - 12);
  c.clip();
  c.translate(x0 + w / 2, y0 + h / 2);
  c.rotate(rnd(r, -0.12, 0.12));
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const drips: [number, number][] = [];
  const spray = (draw: () => void) => {
    // a soft halo of overspray, then the hard line
    c.shadowColor = col;
    c.shadowBlur = 14;
    c.globalAlpha = 0.35;
    draw();
    c.shadowBlur = 3;
    c.globalAlpha = 0.92;
    draw();
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  };
  if (k < WORDS.length) {
    const t = WORDS[k];
    let size = 120;
    const font = (s: number) => `${r() < 0.5 ? 'bold ' : ''}${s}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
    c.font = font(size);
    while (c.measureText(t).width > w * 0.86 && size > 30) {
      size -= 4;
      c.font = font(size);
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const mw = c.measureText(t).width;
    if (r() < 0.6) {
      spray(() => c.fillText(t, 0, 0));
    } else {
      c.lineWidth = size * 0.09;
      spray(() => c.strokeText(t, 0, 0));
    }
    for (let i = 0; i < 3 + Math.floor(r() * 7); i++) drips.push([rnd(r, -mw / 2, mw / 2), size * 0.38]);
  } else {
    const kind = k - WORDS.length;
    c.lineWidth = rnd(r, 8, 14);
    spray(() => {
      c.beginPath();
      if (kind % 5 === 0) {
        // tally marks, a week of them and more
        for (let g = 0; g < 3; g++) {
          const gx = -150 + g * 110;
          for (let i = 0; i < 4; i++) {
            c.moveTo(gx + i * 18, -50);
            c.lineTo(gx + i * 18 + rnd(r, -4, 4), 50);
          }
          c.moveTo(gx - 12, 30);
          c.lineTo(gx + 70, -30);
        }
      } else if (kind % 5 === 1) {
        // an eye
        c.moveTo(-150, 0);
        c.quadraticCurveTo(0, -110, 150, 0);
        c.quadraticCurveTo(0, 110, -150, 0);
        c.moveTo(40, 0);
        c.arc(0, 0, 40, 0, Math.PI * 2);
      } else if (kind % 5 === 2) {
        // an arrow, and the word it points to crossed out
        c.moveTo(-170, 0);
        c.lineTo(120, 0);
        c.moveTo(80, -45);
        c.lineTo(130, 0);
        c.lineTo(80, 45);
        c.moveTo(-60, -70);
        c.lineTo(60, 70);
        c.moveTo(60, -70);
        c.lineTo(-60, 70);
      } else if (kind % 5 === 3) {
        // a circle with a line through it
        c.moveTo(85, 0);
        c.arc(0, 0, 85, 0, Math.PI * 2);
        c.moveTo(-60, 60);
        c.lineTo(60, -60);
      } else {
        // a figure, too thin
        c.moveTo(18, -70);
        c.arc(0, -70, 18, 0, Math.PI * 2);
        c.moveTo(0, -52);
        c.lineTo(0, 30);
        c.moveTo(-50, -20);
        c.lineTo(0, -35);
        c.lineTo(50, -20);
        c.moveTo(-30, 95);
        c.lineTo(0, 30);
        c.lineTo(30, 95);
      }
      c.stroke();
    });
    for (let i = 0; i < 3; i++) drips.push([rnd(r, -120, 120), rnd(r, 20, 60)]);
  }
  // the drips: a thin run down from where the paint was heavy, a bead at the end
  c.globalAlpha = 0.85;
  for (const [dx, dy] of drips) {
    const L = rnd(r, 18, 90);
    c.lineWidth = rnd(r, 2, 5);
    c.beginPath();
    c.moveTo(dx, dy);
    c.lineTo(dx + rnd(r, -2, 2), dy + L);
    c.stroke();
    c.beginPath();
    c.arc(dx, dy + L, c.lineWidth * 0.8, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function atlas(): THREE.CanvasTexture {
  const W = 2048, H = 2048, cw = W / COLS, ch = H / ROWS;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  const r = mulberry(91);
  for (let i = 0; i < COLS * ROWS; i++) paint(c, (i % COLS) * cw, Math.floor(i / COLS) * ch, cw, ch, i % (WORDS.length + 10), r);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

type Room = { name: string; a: number[]; b: number[] };

export class Graffiti {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(readonly max = 260) {
    const g = new THREE.PlaneGeometry(1, 0.5);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
    const m = new THREE.MeshBasicMaterial({
      map: atlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    });
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;').replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2( ( uv.x + mod( aCell, ${COLS}.0 ) ) / ${COLS}.0, ( uv.y + ${ROWS - 1}.0 - floor( aCell / ${COLS}.0 ) ) / ${ROWS}.0 );`);
    };
    m.customProgramCacheKey = () => 'lfgraffiti';
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** a piece w wide on a wall facing (nx, nz), upright */
  add(x: number, y: number, z: number, nx: number, nz: number, w: number, cell: number) {
    if (this.n >= this.max) return;
    const n = new THREE.Vector3(nx, 0, nz).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, n);
    const m = new THREE.Matrix4().makeBasis(right.multiplyScalar(w), up.multiplyScalar(w), n).setPosition(x + n.x * 0.008, y, z + n.z * 0.008);
    this.mesh.setMatrixAt(this.n, m);
    (this.mesh.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute).setX(this.n, cell);
    this.n++;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.getAttribute('aCell').needsUpdate = true;
  }
}

/** a flat run of wall w wide and h tall facing back along (dx, dz) from p, or null */
function wallAt(world: World, px: number, py: number, pz: number, dx: number, dz: number, far: number, w: number, h: number) {
  const hit = world.ray(px, py, pz, dx, 0, dz, far, true, true);
  if (!hit || hit.t < 0.4 || Math.abs(hit.ny) > 0.1) return null;
  // the corners must all land on the same face
  const tx = -dz, tz = dx;
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0.5], [0, -0.5]]) {
    const h2 = world.ray(px + tx * a * w, py + b * h, pz + tz * a * w, dx, 0, dz, far, true, true);
    if (!h2 || Math.abs(h2.t - hit.t) > 0.04) return null;
  }
  return { x: px + dx * hit.t, y: py, z: pz + dz * hit.t, nx: -dx, nz: -dz };
}

/** paint the walls and soak a few rooms, the same way on every machine for a given map */
export function markUp(rooms: Room[], world: World, fx: Fx, g: Graffiti, seed: number) {
  const r = mulberry(seed);
  const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let pieces = 0, soaked = 0;
  const soakedRooms: string[] = [];
  const usable = rooms.filter((q) => !/stair|well/.test(q.name) && q.b[1] - q.a[1] > 2.2 && q.b[0] - q.a[0] > 1.6 && q.b[2] - q.a[2] > 1.6);
  // the worst rooms: about one in six, at least two
  const order = usable.map((q) => [r(), q] as const).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const worst = new Set(order.filter((q) => (q.b[0] - q.a[0]) * (q.b[2] - q.a[2]) > 9).slice(0, Math.max(2, Math.round(usable.length / 6))));
  for (const q of usable) {
    const [x0, y0, z0] = q.a, [x1, , z1] = q.b;
    const W = x1 - x0, D = z1 - z0;
    // graffiti: most rooms get some, corridors more
    const want = r() < 0.65 ? 1 + Math.floor(r() * (Math.max(W, D) > 10 ? 4 : 2)) : 0;
    for (let k = 0, got = 0; k < want * 8 && got < want; k++) {
      const [dx, dz] = DIRS[Math.floor(r() * 4)];
      const px = rnd(r, x0 + 0.5, x1 - 0.5), pz = rnd(r, z0 + 0.5, z1 - 0.5);
      const w = rnd(r, 0.9, 2.2), y = y0 + rnd(r, 1.1, 1.9);
      const s = wallAt(world, px, y, pz, dx, dz, Math.max(W, D), w, w * 0.5);
      if (!s) continue;
      g.add(s.x, s.y, s.z, s.nx, s.nz, w, Math.floor(r() * COLS * ROWS));
      got++;
      pieces++;
    }
    if (!worst.has(q)) continue;
    soaked++;
    soakedRooms.push(q.name);
    const floorY = (x: number, z: number) => world.floorAt(x, y0 + 0.3, z, 0.05, 0.05, true);
    // the floor: pools, old and new, and where something was dragged
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
    // the walls: sprays, hands, smears, low and high
    for (let i = 0, got = 0; i < 40 && got < 12; i++) {
      const [dx, dz] = DIRS[Math.floor(r() * 4)];
      const px = rnd(r, x0 + 0.4, x1 - 0.4), pz = rnd(r, z0 + 0.4, z1 - 0.4), y = y0 + rnd(r, 0.3, 2.0);
      const hit = world.ray(px, y, pz, dx, 0, dz, Math.max(W, D), true, true);
      if (!hit || Math.abs(hit.ny) > 0.1) continue;
      fx.stain(px + dx * hit.t, y, pz + dz * hit.t, -dx, 0, -dz, rnd(r, 0.6, 1.8));
      got++;
    }
  }
  return { pieces, soaked, soakedRooms };
}
