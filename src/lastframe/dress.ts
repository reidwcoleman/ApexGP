import * as THREE from 'three';
import { applyLF } from './lighting.ts';

/**
 * What the bake doesn't need to know about: overhead wires, shop signs, neon, posters, paint on the walls.
 * All of it is drawn here, in the browser, so no one else's name or art ever comes into it.
 */

function card(w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** weather on a painted board: rust runs, chipped corners */
function age(c: CanvasRenderingContext2D, w: number, h: number) {
  for (let i = 0; i < 30; i++) {
    c.fillStyle = `rgba(30,18,10,${rnd(0.05, 0.22)})`;
    const x = rnd(0, w);
    c.fillRect(x, rnd(-20, h * 0.4), rnd(1, 5), rnd(10, h));
  }
  for (let i = 0; i < 16; i++) {
    c.fillStyle = `rgba(20,20,20,${rnd(0.1, 0.4)})`;
    c.beginPath();
    c.arc(rnd(0, w), rnd(0, h), rnd(1, 7), 0, 6.28);
    c.fill();
  }
}

function sign(text: string, bg: string, fg: string, serif = false) {
  return card(1024, 128, (c, w, h) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = fg;
    c.lineWidth = 3;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = fg;
    c.font = `${serif ? 'italic bold 74px Georgia, serif' : 'bold 78px Arial Narrow, Arial, sans-serif'}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 4);
    age(c, w, h);
  });
}

function poster(k: number) {
  const hue = ['#c9b58f', '#b0352a', '#2c4a66', '#e0d6c0', '#d0a020', '#333'][k % 6];
  const ink = ['#201c18', '#f0e6d0', '#f0e6d0', '#7a1f18', '#181818', '#d8d0c0'][k % 6];
  const words = [['LOST', 'CAT'], ['RENT', 'STRIKE'], ['NIGHT', 'MARKET'], ['ROOMS', 'TO LET'], ['SALE', 'ALL WEEK'], ['BOXING', 'FRIDAY']][k % 6];
  return card(256, 384, (c, w, h) => {
    c.fillStyle = hue;
    c.fillRect(0, 0, w, h);
    c.fillStyle = ink;
    c.textAlign = 'center';
    c.font = 'bold 62px Arial Narrow, Arial, sans-serif';
    c.fillText(words[0], w / 2, 90);
    c.font = 'bold 40px Arial Narrow, Arial, sans-serif';
    c.fillText(words[1], w / 2, 150);
    c.fillRect(30, 180, w - 60, 4);
    for (let i = 0; i < 7; i++) c.fillRect(rnd(30, 60), 205 + i * 22, rnd(100, 190), 8);
    // torn: the bottom corner gone
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.moveTo(w, h);
    c.lineTo(w, h - rnd(40, 150));
    for (let x = w; x > w - 140; x -= 16) c.lineTo(x - 16, h - rnd(0, 120) * ((x - w + 140) / 140));
    c.lineTo(w - 150, h);
    c.fill();
    c.globalCompositeOperation = 'source-over';
    age(c, w, h);
  });
}

/** paint: on white, because it's drawn multiplied over whatever light the wall has */
function tag(k: number) {
  const ink = ['#303a70', '#1c1c20', '#702a2a', '#2a5a48'][k % 4];
  return card(512, 256, (c, w, h) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = ink;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.filter = 'blur(1.2px)';
    c.lineWidth = rnd(9, 15);
    let x = 40;
    const n = 4 + (k % 3);
    for (let i = 0; i < n; i++) {
      const y = h / 2 + rnd(-12, 12), ww = rnd(46, 74), hh = rnd(60, 96);
      c.beginPath();
      c.moveTo(x, y + hh / 2);
      c.bezierCurveTo(x + rnd(-10, 20), y - hh, x + ww, y - hh, x + ww * rnd(0.4, 0.9), y + rnd(-10, 30));
      c.bezierCurveTo(x + ww, y + hh, x + ww * 0.3, y + hh * 0.9, x + ww * 1.1, y + hh * 0.4);
      c.stroke();
      x += ww + rnd(4, 20);
    }
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(30, h - 44);
    c.bezierCurveTo(w * 0.3, h - 20, w * 0.6, h - 70, x, h - 40);
    c.stroke();
    // what ran
    c.filter = 'none';
    c.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const dx = rnd(40, x);
      c.beginPath();
      c.moveTo(dx, h / 2);
      c.lineTo(dx, h / 2 + rnd(40, 120));
      c.stroke();
    }
  });
}

function neon(text: string, col: string) {
  return card(512, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.font = 'bold 120px Arial Narrow, Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = col;
    for (const [b, a] of [[30, 0.5], [12, 0.8], [3, 1]] as const) {
      c.shadowBlur = b;
      c.globalAlpha = a;
      c.strokeStyle = b === 3 ? '#fff' : col;
      c.lineWidth = b === 3 ? 4 : 9;
      c.strokeText(text, w / 2, h / 2);
    }
  });
}

/** a sagging line from a to b */
function wire(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.011, 4);
}

export function dress(group: THREE.Group) {
  const add = (map: THREE.Texture, x: number, y: number, z: number, ry: number, w: number, h: number, kind: 'lit' | 'mult' | 'glow', k = 1) => {
    let m: THREE.Material;
    if (kind === 'lit') {
      const s = new THREE.MeshStandardMaterial({ map, roughness: 0.75, transparent: true, alphaTest: 0.3 });
      s.color.setScalar(0.5 * k);
      m = applyLF(s);
    } else if (kind === 'mult') {
      m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor });
    } else {
      const b = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      b.color.setScalar(k);
      m = b;
    }
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    q.position.set(x, y, z);
    q.rotation.y = ry;
    q.renderOrder = kind === 'glow' ? 6 : 2;
    group.add(q);
  };
  // the shops across the street: fascias facing north, the two you can walk into stand a little proud
  const fascia: [number, number, string, string, string, boolean?][] = [
    [7, 2.86, 'HARLOW HARDWARE', '#1e3028', '#d8c890'], [19, 2.86, 'LAUNDERETTE', '#d8d0b8', '#253a60'], [37, 3.08, 'LUCKY DINER', '#5a1a18', '#e8c060', true],
    [52, 2.86, 'PAWN  &  LOAN', '#14141a', '#d0a030'], [70, 3.08, 'CLOSE SHAVE BARBERS', '#20306a', '#e8e0d0'], [85, 2.86, 'OFF LICENCE', '#301c14', '#e0c8a0', true],
  ];
  fascia.forEach(([x, z, t, bg, fg, serif]) => add(sign(t, bg, fg, serif), x, 2.75, z, Math.PI, 5.6, 0.7, 'lit', 1.1));
  // neon in two windows: light that isn't in any bake
  add(neon('BAR', '#ff2a3a'), 30.2, 1.95, -12.8, Math.PI, 1.1, 0.42, 'glow', 9);
  add(neon('OPEN', '#2ad0ff'), 12.0, 1.6, -12.9, Math.PI, 1.0, 0.38, 'glow', 7);
  add(neon('ROOMS', '#ffb030'), 22.0, 2.42, -12.8, Math.PI, 0.9, 0.32, 'glow', 6);
  add(neon('EAT', '#ff5a2a'), 34.2, 1.72, 3.22, Math.PI, 1.0, 0.38, 'glow', 7);
  add(neon('CUTS', '#2a9dff'), 66.6, 1.72, 3.22, Math.PI, 1.0, 0.38, 'glow', 7);
  // bills pasted up
  const walls: [number, number, number, number][] = [
    [36.4, 1.45, -12.84, Math.PI], [36.9, 1.5, -12.84, Math.PI], [47.5, 1.4, -12.84, Math.PI], [47.0, 1.5, -12.84, Math.PI], [2.2, 1.55, -12.84, Math.PI], [90.8, 1.5, -12.84, Math.PI],
    [34.17, 1.5, -20.5, Math.PI / 2], [34.17, 1.45, -21.1, Math.PI / 2], [49.78, 1.5, -18.0, -Math.PI / 2], [49.78, 1.4, -24.8, -Math.PI / 2],
    [-0.34, 1.3, -3.0, Math.PI / 2], [-0.34, 1.38, -5.2, Math.PI / 2], [96.34, 1.4, -4.0, -Math.PI / 2], [96.34, 1.3, -6.5, -Math.PI / 2],
  ];
  walls.forEach(([x, y, z, ry], i) => add(poster(i), x, y, z, ry, 0.56 + (i % 3) * 0.06, 0.84 + (i % 3) * 0.09, 'lit', 1));
  // paint
  const tags: [number, number, number, number, number][] = [
    [4.2, 1.5, -12.84, Math.PI, 2.2], [36.0, 1.1, -12.84, Math.PI, 1.8], [48.0, 0.95, -12.84, Math.PI, 2.0], [55.5, 1.15, -12.78, Math.PI, 2.6], [70.0, 1.2, -12.78, Math.PI, 2.4], [91.0, 1.1, -12.84, Math.PI, 1.9],
    [34.17, 1.1, -30.0, Math.PI / 2, 2.4], [49.78, 1.1, -30.0, -Math.PI / 2, 2.8], [49.78, 1.0, -38.5, -Math.PI / 2, 2.2], [34.17, 1.05, -16.0, Math.PI / 2, 1.8],
  ];
  tags.forEach(([x, y, z, ry, w], i) => add(tag(i), x, y, z, ry, w, w / 2, 'mult'));
  // overhead wires, street to tenement, along the far wall
  const black = new THREE.MeshBasicMaterial({ color: 0x070708 });
  const lines: [number[], number[], number][] = [];
  for (const x of [9, 26, 41, 58, 73, 88]) lines.push([[x, 9.4, 3.2], [x + 3, 6.2, -12.6], 0.9], [[x + 0.3, 9.2, 3.2], [x + 3.3, 6.0, -12.6], 1.1]);
  for (let x = 0; x < 96; x += 16) lines.push([[x, 10.8, 3.22], [x + 16, 10.8, 3.22], 0.3]);
  lines.push([[34.3, 5.8, -19], [49.7, 6.4, -24], 0.8], [[34.3, 5.4, -28], [49.7, 6.1, -33], 1], [[34.3, 5.6, -36], [49.7, 6.2, -30], 0.7]);
  for (const [a, b, s] of lines) {
    const m = new THREE.Mesh(wire(new THREE.Vector3(...a), new THREE.Vector3(...b), s), black);
    group.add(m);
  }
}
