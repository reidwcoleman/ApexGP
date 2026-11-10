// Bluebird Peak: the things that make it look like a real resort. Trail-head signs and orange edge poles
// on every open trail, rails and boxes in the terrain park, and a lively plaza: string lights, fire pits,
// flags snapping in the wind, smoke from the lodge chimney.
import * as THREE from 'three';
import { Mountain, RUNS, DIFF_COLOR, type RunDef } from './mountain.ts';
import type { World } from './world.ts';
import type { Sim } from './sim.ts';
import type { Village } from './village.ts';
import type { Fx } from './fx.ts';

const M = (c: number, r = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });

function trailSign(r: RunDef) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 224;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b2a44'; g.fillRect(0, 0, 512, 224);
  g.fillStyle = '#f4f7fb'; g.fillRect(8, 8, 496, 208);
  const col = r.diff === 'black' || r.diff === 'double' ? '#15161c' : DIFF_COLOR[r.diff];
  g.fillStyle = col;
  const sym = (x: number, y: number, s: number) => {
    g.beginPath();
    if (r.diff === 'green') g.arc(x, y, s, 0, Math.PI * 2);
    else if (r.diff === 'blue') g.rect(x - s, y - s, s * 2, s * 2);
    else if (r.diff === 'park') { g.roundRect(x - s, y - s, s * 2, s * 2, 14); }
    else { g.moveTo(x, y - s * 1.2); g.lineTo(x + s, y); g.lineTo(x, y + s * 1.2); g.lineTo(x - s, y); g.closePath(); }
    g.fill();
  };
  if (r.diff === 'double') { sym(62, 112, 34); sym(122, 112, 34); } else sym(84, 112, 50);
  g.fillStyle = '#1b2a44';
  g.textAlign = 'left';
  const name = r.name.toUpperCase();
  let fs = 64;
  g.font = `italic 800 ${fs}px "Barlow Condensed", "Barlow", sans-serif`;
  while (g.measureText(name).width > 330 && fs > 30) { fs -= 4; g.font = `italic 800 ${fs}px "Barlow Condensed", "Barlow", sans-serif`; }
  g.fillText(name, 168, 118);
  g.font = '700 26px "Barlow", sans-serif'; g.fillStyle = '#5b6780';
  g.fillText({ green: 'EASIEST', blue: 'MORE DIFFICULT', black: 'MOST DIFFICULT', double: 'EXPERTS ONLY', park: 'TERRAIN PARK' }[r.diff], 170, 160);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Flame { mesh: THREE.Mesh; light: THREE.Mesh; x: number; y: number; z: number }

export class Dressing {
  trails = new THREE.Group();
  plaza = new THREE.Group();
  private key = '';
  private flames: Flame[] = [];
  private flags: THREE.Mesh[] = [];
  private smokeT = 0;
  private emberT = 0;
  private bulbM: THREE.MeshStandardMaterial;
  private flameM: THREE.MeshStandardMaterial;

  constructor(private w: World, private m: Mountain, private village: Village, private fx: Fx) {
    w.scene.add(this.trails, this.plaza);
    this.bulbM = w.glow(M(0xffffff, 0.4, { emissive: 0xffc77a, emissiveIntensity: 1 }), 3.2);
    this.flameM = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 3, roughness: 1, transparent: true, opacity: 0.92 });
    this.buildPlaza();
  }

  private at(x: number, z: number) { return this.m.at(x, z); }

  update(sim: Sim) {
    const key = RUNS.map((r) => (sim.runBuilt(r.id) ? 1 : 0)).join('');
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.trails.children]) this.trails.remove(c);
    const built = RUNS.filter((r) => sim.runBuilt(r.id));
    // ---------------------------------------------------------------- edge poles
    const poles: [number, number, number][] = [];
    for (const r of built) {
      const p = this.m.runOf[r.id];
      const step = 22;
      for (let s = 30; s < p.len - 20; s += step) {
        const i = this.m.idxAt(p, s);
        for (const side of [-1, 1]) {
          const off = (r.w / 2 + 1.5) * side;
          poles.push([p.x[i] - p.tz[i] * off, p.z[i] + p.tx[i] * off, poles.length]);
        }
      }
    }
    if (poles.length) {
      const g = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5);
      g.translate(0, 1.1, 0);
      const im = new THREE.InstancedMesh(g, M(0xffffff, 0.6), poles.length);
      const mt = new THREE.Matrix4(), col = new THREE.Color();
      poles.forEach(([x, z, n], i) => {
        mt.makeTranslation(x, this.at(x, z) - 0.1, z);
        im.setMatrixAt(i, mt);
        im.setColorAt(i, col.setHex(n % 4 < 2 ? 0xf08a24 : 0x1d1d22));
      });
      im.castShadow = true;
      this.trails.add(im);
    }
    // ---------------------------------------------------------------- trail-head signs
    for (const r of built) {
      const p = this.m.runOf[r.id];
      const i = this.m.idxAt(p, 14);
      const off = r.w / 2 + 3;
      const x = p.x[i] - p.tz[i] * off, z = p.z[i] + p.tx[i] * off;
      const g = new THREE.Group();
      const postM = M(0x4a2f1f);
      for (const dx of [-1.4, 1.4]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.6, 0.18), postM); post.position.set(dx, 1.8, -0.06); g.add(post); }
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.575), new THREE.MeshStandardMaterial({ map: trailSign(r), roughness: 0.6, side: THREE.DoubleSide }));
      board.position.y = 2.9;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.14, 0.4), M(0xf4f7fb, 0.7));
      cap.position.y = 3.74;
      g.add(board, cap);
      g.position.set(x, this.at(x, z), z);
      // face uphill, toward skiers arriving at the top
      g.rotation.y = Math.atan2(-p.tx[i], -p.tz[i]);
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.trails.add(g);
    }
    // ---------------------------------------------------------------- the terrain park
    if (built.some((r) => r.id === 'park')) {
      const p = this.m.runOf['park'];
      const feats = [0.2, 0.33, 0.47, 0.62, 0.78];
      feats.forEach((f, k) => {
        const i = Math.floor(p.x.length * f);
        const near = this.m.kickers.some((kk) => Math.hypot(kk.x - p.x[i], kk.z - p.z[i]) < 22);
        const lat = (k % 2 ? 1 : -1) * p.def.w * (near ? 0.32 : 0.18);
        const x = p.x[i] - p.tz[i] * lat, z = p.z[i] + p.tx[i] * lat;
        const g = new THREE.Group();
        if (k % 2) {
          // a flat-down rail
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 9, 8), M(0xd2453a, 0.35, { metalness: 0.6 }));
          rail.rotation.x = Math.PI / 2; rail.position.y = 1.0;
          g.add(rail);
          for (const dz of [-3.6, 3.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.15), M(0x2b3036)); leg.position.set(0, 0.5, dz); g.add(leg); }
        } else {
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 7), M([0xf2c46d, 0x2f7fe0, 0x2fb65a][k % 3], 0.5));
          box.position.y = 0.45;
          const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 7.05), M(0xe8e8ea, 0.3, { metalness: 0.4 }));
          top.position.y = 0.82;
          g.add(box, top);
        }
        g.position.set(x, this.at(x, z), z);
        g.rotation.y = Math.atan2(p.tx[i], p.tz[i]);
        g.rotation.order = 'YXZ';
        g.rotation.x = -Math.atan2(this.at(x + p.tx[i] * 3, z + p.tz[i] * 3) - this.at(x - p.tx[i] * 3, z - p.tz[i] * 3), 6);
        g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        this.trails.add(g);
      });
    }
  }

  // ------------------------------------------------------------------ the plaza
  private buildPlaza() {
    const P = this.plaza;
    // string lights between posts around the plaza
    const posts: [number, number][] = [[-96, 476], [-48, 494], [-4, 500], [44, 500], [92, 494], [138, 482]];
    const postM = M(0x3b2a1e);
    const bulbs: THREE.Vector3[] = [];
    posts.forEach(([x, z], i) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 6), postM);
      post.position.set(x, this.at(x, z) + 3.5, z);
      post.castShadow = true;
      P.add(post);
      if (i === 0) return;
      const [x0, z0] = posts[i - 1];
      const a = new THREE.Vector3(x0, this.at(x0, z0) + 6.8, z0), b = new THREE.Vector3(x, this.at(x, z) + 6.8, z);
      const n = Math.round(a.distanceTo(b) / 2.2);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const pnt = a.clone().lerp(b, t);
        pnt.y -= Math.sin(Math.PI * t) * 2.2;
        bulbs.push(pnt);
      }
    });
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), this.bulbM, bulbs.length);
    const mt = new THREE.Matrix4(), col = new THREE.Color();
    bulbs.forEach((b, i) => { mt.makeTranslation(b.x, b.y, b.z); bm.setMatrixAt(i, mt); bm.setColorAt(i, col.setHex([0xffd28a, 0xff8a6b, 0x9fd0ff, 0xb7ff9a][i % 4])); });
    P.add(bm);
    // fire pits with chairs round them
    const stoneM = M(0x7a746d, 0.95), logM = M(0x5a3a22), chairM = M(0xd2453a, 0.7);
    for (const [x, z] of [[18, 508], [-74, 506], [104, 500]] as [number, number][]) {
      const y = this.at(x, z);
      const g = new THREE.Group();
      for (let k = 0; k < 10; k++) {
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42), stoneM);
        st.position.set(Math.cos((k / 10) * Math.PI * 2) * 1.3, 0.25, Math.sin((k / 10) * Math.PI * 2) * 1.3);
        g.add(st);
      }
      for (let k = 0; k < 3; k++) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6), logM); lg.rotation.set(Math.PI / 2, (k * Math.PI) / 3, 0.3); lg.position.y = 0.3; g.add(lg); }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const ch = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.8), chairM); seat.position.y = 0.45;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.1), chairM); back.position.set(0, 0.85, -0.42); back.rotation.x = -0.25;
        ch.add(seat, back);
        ch.position.set(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2);
        ch.rotation.y = -a - Math.PI / 2;
        g.add(ch);
      }
      g.position.set(x, y, z);
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      P.add(g);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 7, 1, true), this.flameM);
      flame.position.set(x, y + 1.1, z);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(5, 24), new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, y + 0.15, z);
      P.add(flame, glow);
      this.flames.push({ mesh: flame, light: glow, x, y, z });
    }
    // flags by the ticket office
    const flagCols = [0x2f7fe0, 0xf2c46d, 0xd2453a, 0x2fb65a];
    flagCols.forEach((c, i) => {
      const x = -44 + i * 7, z = 470;
      const y = this.at(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 11, 6), M(0xd9dde3, 0.4, { metalness: 0.5 }));
      pole.position.set(x, y + 5.5, z);
      pole.castShadow = true;
      const fg = new THREE.PlaneGeometry(3.6, 2.2, 8, 1);
      fg.translate(1.8, 0, 0);
      const flag = new THREE.Mesh(fg, M(c, 0.7, { side: THREE.DoubleSide }));
      flag.position.set(x, y + 9.8, z);
      flag.castShadow = true;
      (flag.userData as any).base = Float32Array.from(fg.getAttribute('position').array as Float32Array);
      (flag.userData as any).ph = i * 1.3;
      P.add(pole, flag);
      this.flags.push(flag);
    });
  }

  frame(dt: number, t: number, sim: Sim, wind: number, night: number) {
    // fires crackle, brighter after dark
    const lit = night > 0.15 || sim.hour > 15.5 || sim.hour < 9;
    for (const f of this.flames) {
      f.mesh.visible = lit;
      const k = 0.85 + Math.sin(t * 11 + f.x) * 0.1 + Math.sin(t * 23 + f.z) * 0.06;
      f.mesh.scale.set(k, 0.9 + Math.sin(t * 9 + f.x * 2) * 0.18, k);
      (f.light.material as THREE.MeshBasicMaterial).opacity = lit ? (0.16 + 0.05 * Math.sin(t * 13 + f.z)) * (0.4 + night) : 0;
    }
    this.emberT -= dt;
    if (lit && this.emberT < 0) {
      this.emberT = 0.12;
      const f = this.flames[(Math.random() * this.flames.length) | 0];
      this.fx.emit(f.x, f.y + 1.8, f.z, 0, 2.5, 0, 0.8, 1, 1.4, 30, -1.2);
    }
    // flags ripple
    for (const fl of this.flags) {
      const pos = fl.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = (fl.userData as any).base as Float32Array;
      const ph = (fl.userData as any).ph as number;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        pos.setZ(i, Math.sin(x * 1.6 - t * (4 + wind * 5) + ph) * 0.22 * (x / 3.6) * (0.5 + wind));
        pos.setY(i, base[i * 3 + 1] - (x / 3.6) * 0.5 * (1 - Math.min(1, wind * 1.5)));
      }
      pos.needsUpdate = true;
      fl.rotation.y = Math.sin(t * 0.3 + ph) * 0.15 + 0.4;
    }
    // chimney smoke drifts downwind
    this.smokeT -= dt;
    if (this.smokeT < 0) {
      this.smokeT = 0.18;
      const c = this.village.chimney;
      this.fx.emit(c.x, c.y, c.z, 1.5 + wind * 4, 2.6, 0.4, 0.7, 1, 4.5, 170, -0.9);
    }
  }
}
