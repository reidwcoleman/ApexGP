import * as THREE from 'three';
import { Rng } from '../core/math';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rng: Rng, cols: string[], size = 1.5) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[Math.floor(rng.next() * cols.length)];
    const s = rng.range(0.5, size);
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

/** Two-lane road: u across (12 m), v along (24 m per repeat). */
export function roadTexture(): THREE.CanvasTexture {
  const rng = new Rng(7);
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#5b5a5c';
  ctx.fillRect(0, 0, 128, 256);
  speckle(ctx, 128, 256, 5000, rng, ['#525154', '#636265', '#6b6a6c', '#4a494b', '#5f5d5b']);
  // tyre wear in lanes
  ctx.fillStyle = 'rgba(40,40,42,0.18)';
  for (const x of [22, 42, 86, 106]) ctx.fillRect(x - 5, 0, 10, 256);
  // edge lines
  ctx.fillStyle = '#e9e6dc';
  ctx.fillRect(5, 0, 3, 256);
  ctx.fillRect(120, 0, 3, 256);
  // centre double yellow
  ctx.fillStyle = '#e8b931';
  ctx.fillRect(60, 0, 3, 256);
  ctx.fillRect(65, 0, 3, 256);
  return tex(c);
}

export function intersectionTexture(): THREE.CanvasTexture {
  const rng = new Rng(9);
  const [c, ctx] = canvas(128, 128);
  // a shade darker than the road's base: the road's tyre-worn lanes darken it on average, and the plain
  // asphalt at the junctions read as a pale square against it
  ctx.fillStyle = '#525153';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, 2600, rng, ['#4a494c', '#5a595c', '#626163', '#434244']);
  return tex(c);
}

export function crosswalkTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 32);
  ctx.clearRect(0, 0, 128, 32);
  ctx.fillStyle = 'rgba(236,233,224,0.92)';
  for (let x = 4; x < 128; x += 14) ctx.fillRect(x, 3, 8, 26);
  const t = tex(c, false);
  return t;
}

export function concreteTexture(): THREE.CanvasTexture {
  const rng = new Rng(11);
  // 256 px with 1 px joints: at 128 px and 1.5 px the joints were ~9 cm wide on the plazas and blurred
  // into broad dark bands down every paving line
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#c9c2b5';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 12000, rng, ['#bfb8aa', '#d2cbbe', '#c4bdb0', '#b8b1a3']);
  ctx.fillStyle = 'rgba(120,112,100,0.38)';
  for (let i = 0; i < 256; i += 64) {
    ctx.fillRect(i, 0, 1, 256);
    ctx.fillRect(0, i, 256, 1);
  }
  return tex(c);
}

export function grassTexture(): THREE.CanvasTexture {
  const rng = new Rng(13);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#6f9a4a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(90,130,60,0.25)' : 'rgba(140,160,80,0.22)';
    ctx.beginPath();
    ctx.arc(rng.next() * 256, rng.next() * 256, rng.range(10, 40), 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, 256, 256, 9000, rng, ['#5f8a3d', '#7fa956', '#86ab5a', '#567f36', '#93b562'], 2);
  return tex(c);
}

export function sandTexture(): THREE.CanvasTexture {
  const rng = new Rng(17);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#ecd9b0';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(220,196,150,0.3)' : 'rgba(250,236,205,0.3)';
    ctx.beginPath();
    ctx.ellipse(rng.next() * 256, rng.next() * 256, rng.range(20, 60), rng.range(5, 15), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, 256, 256, 9000, rng, ['#e2cfa4', '#f3e3bf', '#d8c294', '#f8ecd0'], 1.5);
  return tex(c);
}

export function mudTexture(): THREE.CanvasTexture {
  const rng = new Rng(19);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#5d6b3c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(80,70,40,0.35)' : 'rgba(110,130,60,0.3)';
    ctx.beginPath();
    ctx.arc(rng.next() * 256, rng.next() * 256, rng.range(6, 30), 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, 256, 256, 8000, rng, ['#4f5c31', '#6b7a44', '#5a4f34', '#76864b'], 2);
  return tex(c);
}

export function lotTexture(): THREE.CanvasTexture {
  // a well-used lot: the same 4 stalls x 2 rows and aisle (512 px now), with oil dripped where the
  // engines sit, the aisle darkened by tyres, hairline cracks, and stall lines in aged paint worn
  // through in places. It was clean grey with crisp white lines
  const rng = new Rng(23);
  const N = 512, k = N / 128;
  const [c, ctx] = canvas(N, N);
  ctx.fillStyle = '#6a6a6c';
  ctx.fillRect(0, 0, N, N);
  speckle(ctx, N, N, 26000, rng, ['#606062', '#727274', '#5a5a5c', '#68686a'], 2);
  // tyre-polished lanes down the aisle
  ctx.fillStyle = 'rgba(40,40,44,0.12)';
  for (const y of [55, 62, 66, 73]) ctx.fillRect(0, y * k, N, 2.5 * k);
  // oil: soft dark blots in each stall, toward the aisle where the engine sits
  for (let row = 0; row < 2; row++)
    for (let st = 0; st < 4; st++) {
      if (rng.next() < 0.25) continue;
      const cx = (st * 32 + 16 + (rng.next() - 0.5) * 6) * k;
      const cy = (row === 0 ? 40 + rng.next() * 6 : 88 - rng.next() * 6) * k;
      const r = (5 + rng.next() * 6) * k;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const a = 0.25 + rng.next() * 0.3;
      g.addColorStop(0, `rgba(28,26,26,${a})`);
      g.addColorStop(0.6, `rgba(32,30,30,${a * 0.5})`);
      g.addColorStop(1, 'rgba(32,30,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * (0.6 + rng.next() * 0.4), rng.next() * 3, 0, Math.PI * 2); ctx.fill();
    }
  // hairline cracks
  ctx.strokeStyle = 'rgba(30,30,32,0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    let x = rng.next() * N, y = rng.next() * N;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (rng.next() - 0.5) * 40; y += (rng.next() - 0.3) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // stall lines: aged cream, worn through in patches
  for (let x = 0; x < 128; x += 32)
    for (const [y0, y1] of [[0, 52], [76, 128]]) {
      for (let y = y0 * k; y < y1 * k; ) {
        const wear = rng.next(), len = wear > 0.05 ? 10 + rng.next() * 40 : 3 + rng.next() * 8;
        if (wear > 0.05) {
          ctx.fillStyle = `rgba(226,220,200,${0.6 + 0.35 * wear})`;
          ctx.fillRect(x * k, y, 2 * k, Math.min(len, y1 * k - y));
        }
        y += len;
      }
    }
  return tex(c);
}

export function courtTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#3f8f74';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#c4674a';
  ctx.fillRect(10, 10, 108, 236);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, 108, 236);
  ctx.beginPath(); ctx.moveTo(10, 128); ctx.lineTo(118, 128); ctx.stroke();
  ctx.beginPath(); ctx.arc(64, 128, 18, 0, Math.PI * 2); ctx.stroke();
  return tex(c, false);
}

/** Soft round sprite used for particles and light pools. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = tex(c, false);
  // no mipmaps: seen at a glancing angle (a lamp's pool along the street) the small mips average the
  // round glow to a flat wash over the whole square, and the pool showed as a lit square with a hard
  // straight edge. A smooth gradient doesn't alias without them.
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

export function decalTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,10,10,1)');
  g.addColorStop(0.3, 'rgba(20,18,16,0.95)');
  g.addColorStop(0.55, 'rgba(40,36,32,0.5)');
  g.addColorStop(1, 'rgba(40,36,32,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const rng = new Rng(3);
  ctx.strokeStyle = 'rgba(20,20,20,0.7)';
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, 6.28);
    ctx.beginPath();
    ctx.moveTo(32, 32);
    ctx.lineTo(32 + Math.cos(a) * rng.range(14, 28), 32 + Math.sin(a) * rng.range(14, 28));
    ctx.stroke();
  }
  return tex(c, false);
}

/**
 * A street lamp's pool of light on the ground: bright under the head with a long soft tail that is
 * fully gone well inside the square (at the high night exposure even a few percent of light left at
 * the edge of the quad drew a hard straight line on the road, worst where pools meet a junction).
 */
export function lampPoolTexture(): THREE.CanvasTexture {
  const N = 128;
  const [c, ctx] = canvas(N, N);
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
      const r = Math.hypot(dx, dy);
      const e = Math.min(1, Math.max(0, (r - 0.62) / 0.3));
      const a = Math.exp(-r * r * 4.2) * (1 - e * e * (3 - 2 * e));
      const o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, false);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** a square cast-iron tree grate: radiating slots round a soil-filled ring where the trunk comes up */
export function treeGrateTexture(): THREE.CanvasTexture {
  const N = 256;
  const [c, ctx] = canvas(N, N);
  ctx.fillStyle = '#5a5550';
  ctx.fillRect(0, 0, N, N);
  // soil showing through the middle
  ctx.fillStyle = '#3a2a1d';
  ctx.beginPath(); ctx.arc(N / 2, N / 2, N * 0.17, 0, Math.PI * 2); ctx.fill();
  // slots: concentric rings of short radial cuts, dark (the pit below)
  ctx.strokeStyle = '#0d0c0b';
  ctx.lineCap = 'round';
  for (let ring = 0; ring < 4; ring++) {
    const r0 = N * (0.22 + ring * 0.065), r1 = r0 + N * 0.04, k = 24 + ring * 8;
    ctx.lineWidth = 4;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + ring * 0.1;
      ctx.beginPath();
      ctx.moveTo(N / 2 + Math.cos(a) * r0, N / 2 + Math.sin(a) * r0);
      ctx.lineTo(N / 2 + Math.cos(a) * r1, N / 2 + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
  // the frame, a little rust bleeding into the edge
  ctx.strokeStyle = '#6a5040';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, N - 6, N - 6);
  const t = tex(c, false);
  return t;
}
