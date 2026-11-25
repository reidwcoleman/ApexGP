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
  ctx.fillStyle = '#5b5a5c';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, 2600, rng, ['#525154', '#636265', '#6b6a6c', '#4a494b']);
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
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#c9c2b5';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, 3000, rng, ['#bfb8aa', '#d2cbbe', '#c4bdb0', '#b8b1a3']);
  ctx.strokeStyle = 'rgba(120,112,100,0.45)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
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
  const rng = new Rng(23);
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#6a6a6c';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, 2500, rng, ['#606062', '#727274', '#5a5a5c']);
  ctx.fillStyle = '#e8e4d8';
  for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 0, 2, 52);
  for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 76, 2, 52);
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
