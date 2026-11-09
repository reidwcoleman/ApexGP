// Bluebird: the base village (lodge, shops, hotel, parking), the snow guns and the floodlights. Every
// building grows with its upgrade level, so you can see where the money went.
import * as THREE from 'three';
import { Mountain, BUILD_SPOTS, RUNS } from './mountain.ts';
import type { Sim, Gun } from './sim.ts';
import { bake, type World } from './world.ts';
import { PARKING } from './data.ts';

const M = (c: number, r = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });

function prism(w: number, h: number, d: number) {
  // triangle cross-section in x/y, extruded along z
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

function signTexture(text: string, sub: string, bg = '#1f3a5f', fg = '#fff6e6') {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#f2c46d'; g.lineWidth = 10; g.strokeRect(14, 14, 996, 228);
  g.fillStyle = fg; g.textAlign = 'center';
  g.font = '700 118px "Barlow", system-ui, sans-serif';
  g.fillText(text, 512, 150);
  if (sub) { g.font = '600 40px "Barlow", system-ui, sans-serif'; g.fillStyle = '#f2c46d'; g.fillText(sub, 512, 212); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Village {
  group = new THREE.Group();
  guns = new THREE.Group();
  lamps = new THREE.Group();
  gunMesh = new Map<string, THREE.Object3D>();
  lampPts: [number, number][] = [];
  private built = '';
  private gunsBuilt = '';
  private lampsBuilt = -1;
  private glass: THREE.MeshStandardMaterial;
  private bulb: THREE.MeshStandardMaterial;

  constructor(private w: World, private m: Mountain) {
    w.scene.add(this.group, this.guns, this.lamps);
    this.glass = w.glow(M(0x2a2f3a, 0.3, { emissive: 0xffb866, emissiveIntensity: 0.2 }), 1.2);
    this.bulb = w.glow(M(0xffffff, 0.4, { emissive: 0xffd9a0, emissiveIntensity: 1 }), 2.6);
  }

  update(sim: Sim) {
    const key = ['lodge', 'rental', 'school', 'hotel', 'parking'].map((k) => sim.lv(k)).join(',');
    if (key !== this.built) { this.built = key; this.rebuild(sim); }
    const gk = RUNS.map((r) => (sim.runBuilt(r.id) ? sim.lv('guns.' + r.id) : 0)).join(',');
    if (gk !== this.gunsBuilt) { this.gunsBuilt = gk; this.rebuildGuns(sim); }
    const lk = sim.lv('lights') ? RUNS.filter((r) => r.lit && sim.runBuilt(r.id)).length : 0;
    if (lk !== this.lampsBuilt) { this.lampsBuilt = lk; this.rebuildLamps(sim); }
  }

  private place(o: THREE.Object3D, x: number, z: number, rot = 0) {
    o.position.set(x, this.m.at(x, z), z);
    o.rotation.y = rot;
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.group.add(o);
    return o;
  }

  /** a timber chalet: walls, a snowy gable roof, rows of glowing windows */
  chalet(w: number, d: number, h: number, wall: number, opts: { floors?: number; roof?: number; trim?: number } = {}) {
    const g = new THREE.Group();
    const floors = opts.floors ?? 1;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(wall, 0.9));
    body.position.y = h / 2;
    g.add(body);
    // stone base
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 1.0, d + 0.4), M(0x6f6a64, 0.95));
    base.position.y = 0.5;
    g.add(base);
    const rh = opts.roof ?? w * 0.42;
    const roof = new THREE.Mesh(prism(w + 2.2, rh, d + 2.4), M(opts.trim ?? 0x5b3a26, 0.8));
    roof.position.y = h;
    g.add(roof);
    const snow = new THREE.Mesh(prism(w + 2.6, rh + 0.5, d + 2.8), M(0xf4f7fb, 0.7));
    snow.position.y = h + 0.25;
    snow.scale.set(1, 1, 1);
    g.add(snow);
    // windows: front and back, per floor
    const fh = h / floors;
    const wg = new THREE.PlaneGeometry(1.3, 1.5);
    for (let f = 0; f < floors; f++)
      for (let i = 0; i < Math.max(1, Math.floor(w / 3.2)); i++) {
        const n = Math.max(1, Math.floor(w / 3.2));
        const x = -w / 2 + (w / n) * (i + 0.5);
        for (const side of [1, -1]) {
          const win = new THREE.Mesh(wg, this.glass);
          win.position.set(x, fh * f + fh * 0.55 + 0.4, (side * d) / 2 + side * 0.02);
          win.rotation.y = side > 0 ? 0 : Math.PI;
          g.add(win);
        }
      }
    // gable window
    const gw = new THREE.Mesh(new THREE.CircleGeometry(rh * 0.28, 3), this.glass);
    gw.position.set(0, h + rh * 0.32, d / 2 + 1.25);
    gw.rotation.z = Math.PI / 2;
    g.add(gw);
    return g;
  }

  private sign(text: string, sub: string, w: number, bg?: string) {
    const mat = new THREE.MeshStandardMaterial({ map: signTexture(text, sub, bg), roughness: 0.7, emissive: 0xffffff, emissiveMap: null as any, emissiveIntensity: 0 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, w / 4 + 0.3, 0.2), M(0x3b2a1e));
    back.position.z = -0.12;
    const g = new THREE.Group();
    g.add(s, back);
    return g;
  }

  private rebuild(sim: Sim) {
    for (const c of [...this.group.children]) this.group.remove(c);
    const S = BUILD_SPOTS;
    // lodge
    const L = sim.lv('lodge');
    if (L) {
      const spec = [null, [10, 8, 4.5, 1], [16, 12, 6, 1], [24, 16, 9, 2], [34, 20, 12, 3], [46, 24, 15, 3]][L]!;
      const lodge = this.chalet(spec[0], spec[1], spec[2], 0x8a5a3b, { floors: spec[3], trim: 0x4a2f1f });
      if (L >= 3) {
        const wing = this.chalet(spec[0] * 0.5, spec[1] * 0.8, spec[2] * 0.7, 0x7c5136, { floors: Math.max(1, spec[3] - 1) });
        wing.position.set(spec[0] * 0.62, 0, 2);
        wing.rotation.y = Math.PI / 2;
        lodge.add(wing);
      }
      // deck with tables
      const deck = new THREE.Mesh(new THREE.BoxGeometry(spec[0] * 0.9, 0.5, 6), M(0x9b7350));
      deck.position.set(0, 1.0, spec[1] / 2 + 3);
      lodge.add(deck);
      for (let i = 0; i < Math.min(8, L * 2); i++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 8), M(0xc8a27a));
        t.position.set(-spec[0] * 0.4 + (i * spec[0] * 0.8) / Math.max(1, Math.min(8, L * 2) - 1), 2.0, spec[1] / 2 + 3.5);
        const um = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.7, 8), M(i % 2 ? 0xd2453a : 0xf2c46d));
        um.position.copy(t.position).add(new THREE.Vector3(0, 1.6, 0));
        lodge.add(t, um);
      }
      const sg = this.sign('BLUEBIRD PEAK', ['', 'WARMING HUT', 'CAFETERIA', 'TIMBER LODGE', 'GRAND LODGE', 'ALPINE HALL'][L], Math.min(14, spec[0] * 0.7));
      sg.position.set(0, spec[2] + 1.0, spec[1] / 2 + 0.3);
      lodge.add(sg);
      // chimney + smoke spot
      const ch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 1.2), M(0x6f6a64));
      ch.position.set(spec[0] * 0.25, spec[2] + spec[0] * 0.3, -spec[1] * 0.2);
      lodge.add(ch);
      this.place(lodge, S.lodge[0], S.lodge[1], 0);
    }
    // ticket booth + gate
    {
      const b = this.chalet(4, 3, 3, 0x3f6f9a, { trim: 0x24425e });
      const sg = this.sign('LIFT TICKETS', '', 4.4, '#9a3426');
      sg.position.set(0, 3.4, 1.7);
      b.add(sg);
      this.place(b, S.tickets[0], S.tickets[1], 0);
    }
    // rental
    const R = sim.lv('rental');
    if (R) {
      const b = this.chalet(8 + R * 3, 8, 4 + R, 0x9a3f32, { trim: 0x5a231c });
      const sg = this.sign('RENTALS', ['', 'SKIS & BOOTS', 'DEMO CENTER', 'PRO SHOP', 'FLAGSHIP'][R], 6, '#2f5f3b');
      sg.position.set(0, 4 + R + 0.8, 4.2);
      b.add(sg);
      // ski racks
      for (let i = 0; i < 6; i++) {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.1), M([0xd2453a, 0x2f7fe0, 0xf2c46d, 0x2fb65a][i % 4]));
        rack.position.set(-3 + i * 0.5, 0.9, 5);
        b.add(rack);
      }
      this.place(b, S.rental[0], S.rental[1], 0.15);
    }
    // ski school
    const SC = sim.lv('school');
    if (SC) {
      const b = this.chalet(7 + SC * 2, 6, 3.5, 0xe0a63a, { trim: 0x7a4a18 });
      const sg = this.sign('SKI SCHOOL', '', 5, '#2f7fe0');
      sg.position.set(0, 4.3, 3.2);
      b.add(sg);
      for (let i = 0; i < 4 + SC * 2; i++) {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 4), M([0xd2453a, 0x2f7fe0, 0xf2c46d, 0x2fb65a][i % 4]));
        fl.position.set(-6 + i * 1.6, 0.6, 9 + Math.sin(i) * 2);
        b.add(fl);
      }
      this.place(b, S.school[0], S.school[1], -0.2);
    }
    // patrol hut
    {
      const b = this.chalet(6, 5, 3.2, 0xb8352c, { trim: 0x5a1c16 });
      const cross = new THREE.Group();
      const cm = M(0xffffff, 0.5, { emissive: 0xffffff, emissiveIntensity: 0.3 });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.1), cm), c2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.1), cm);
      cross.add(c1, c2);
      cross.position.set(0, 4.4, 2.6);
      b.add(cross);
      this.place(b, S.patrol[0], S.patrol[1], 0);
    }
    // maintenance shed: big doors for the cat
    {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 12), M(0x6d7a84, 0.7, { metalness: 0.2 }));
      body.position.y = 3.5;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.6, 13), M(0xf4f7fb, 0.7));
      roof.position.y = 7.3;
      b.add(body, roof);
      for (const x of [-4.5, 4.5]) {
        const door = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.4), M(0x3a434b, 0.6));
        door.position.set(x, 2.8, 6.02);
        b.add(door);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.4), this.bulb);
        lamp.position.set(x, 6, 6.3);
        b.add(lamp);
      }
      const sg = this.sign('MOUNTAIN OPS', 'SNOWCAT · SLEDS', 7, '#3a434b');
      sg.position.set(0, 9.3, 5.6);
      b.add(sg);
      this.place(b, S.shed[0], S.shed[1], Math.PI - 0.15);
    }
    // hotel
    const HT = sim.lv('hotel');
    if (HT) {
      const floors = [0, 3, 5, 7][HT];
      const b = this.chalet(24 + HT * 6, 14, floors * 3.2, 0xd9cbb4, { floors, trim: 0x3d4f66, roof: 8 });
      const sg = this.sign('THE BLUEBIRD', 'SLOPESIDE HOTEL', 12, '#3d4f66');
      sg.position.set(0, floors * 3.2 + 1.6, 7.3);
      b.add(sg);
      this.place(b, S.hotel[0], S.hotel[1], 0.08);
    }
    // parking
    const P = sim.lv('parking');
    if (P) {
      const [px, pz] = S.parking;
      const lotW = 40 + P * 22, lotD = 26 + P * 6;
      const lot = new THREE.Mesh(new THREE.PlaneGeometry(lotW, lotD), M(P >= 2 ? 0x3c4046 : 0x8a8276, 0.95));
      lot.rotation.x = -Math.PI / 2;
      lot.position.set(px, this.m.at(px, pz) + 0.08, pz);
      lot.receiveShadow = true;
      this.group.add(lot);
      const cars = Math.min(260, Math.round(PARKING[P] / 5));
      const carG = new THREE.BoxGeometry(1.9, 1.4, 4.3);
      carG.translate(0, 0.7, 0);
      const carM = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 });
      const im = new THREE.InstancedMesh(carG, carM, cars);
      const palette = [0xd2453a, 0x2f7fe0, 0xe8e8ea, 0x23262b, 0x7c8590, 0x2f6b47, 0xe0a63a, 0x8b2f56];
      const mt = new THREE.Matrix4(), c = new THREE.Color();
      const cols = Math.floor(lotW / 2.8);
      for (let i = 0; i < cars; i++) {
        const row = Math.floor(i / cols), col = i % cols;
        const x = px - lotW / 2 + 1.6 + col * 2.8, z = pz - lotD / 2 + 3 + row * 6.2;
        if (z > pz + lotD / 2 - 2) break;
        mt.makeTranslation(x, this.m.at(x, z) + 0.1, z);
        im.setMatrixAt(i, mt);
        im.setColorAt(i, c.setHex(palette[(i * 7) % palette.length]));
      }
      im.castShadow = true;
      im.name = 'cars';
      this.group.add(im);
      this.carMesh = im;
      this.carCount = cars;
    }
    // big trail-map board by the lifts
    {
      const b = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ map: this.trailMap(), roughness: 0.7 }));
      board.position.y = 3.6;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, 0.3), M(0x4a2f1f));
      legs.position.y = 1.5;
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5.6, 0.25), M(0x4a2f1f)); l1.position.set(-3, 2.8, -0.1);
      const l2 = l1.clone(); l2.position.x = 3;
      b.add(board, legs, l1, l2);
      this.place(b, -40, 474, 0.2);
    }
    // a few fire pits / benches for life
    for (const [x, z] of [[-10, 506], [70, 500]] as [number, number][]) {
      const fire = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.25, 6, 10), M(0x5f5a55));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 6), this.bulb);
      flame.position.y = 0.6;
      fire.add(ring, flame);
      this.place(fire, x, z);
    }
    bake(this.group);
  }
  carMesh: THREE.InstancedMesh | null = null;
  carCount = 0;
  /** show the right number of parked cars for how many people are here */
  setCars(frac: number) {
    if (!this.carMesh) return;
    this.carMesh.count = Math.max(4, Math.round(this.carCount * Math.min(1, frac)));
  }

  private trailMap() {
    const c = document.createElement('canvas');
    c.width = 384; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#eaf1f8'; g.fillRect(0, 0, 384, 256);
    g.fillStyle = '#1f3a5f'; g.font = '700 22px Barlow, sans-serif'; g.fillText('TRAIL MAP', 14, 28);
    for (const r of RUNS) {
      const p = this.m.runOf[r.id];
      g.strokeStyle = ({ green: '#2fb65a', blue: '#2f7fe0', black: '#1d1d22', double: '#1d1d22', park: '#f08a24' } as any)[r.diff];
      g.lineWidth = 4;
      g.beginPath();
      for (let i = 0; i < p.x.length; i += 8) { const X = 192 + p.x[i] * 0.2, Y = 128 + p.z[i] * 0.22; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ------------------------------------------------------------------ snow guns
  private rebuildGuns(sim: Sim) {
    for (const c of [...this.guns.children]) this.guns.remove(c);
    this.gunMesh.clear();
    const poleM = M(0x9aa3ab, 0.5, { metalness: 0.5 });
    const fanM = M(0xf2c46d, 0.55);
    const ringM = M(0x2a2f36, 0.6);
    for (const g of sim.builtGuns()) {
      const o = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.2, 6), poleM);
      pole.position.y = 2.1;
      const head = new THREE.Group();
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 1.6, 12, 1, true), fanM);
      fan.material.side = THREE.DoubleSide;
      fan.rotation.x = Math.PI / 2;
      const back = new THREE.Mesh(new THREE.CircleGeometry(0.85, 12), ringM);
      back.position.z = -0.8;
      back.rotation.y = Math.PI;
      head.add(fan, back);
      head.position.y = 4.4;
      head.rotation.x = -0.35;
      o.add(pole, head);
      o.position.set(g.x, this.m.at(g.x, g.z), g.z);
      o.rotation.y = Math.atan2(g.dx, g.dz);
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
      // status light
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x555555 }));
      led.position.set(0, 3.4, 0.2);
      led.name = 'led';
      o.add(led);
      this.guns.add(o);
      this.gunMesh.set(g.id, o);
    }
    bake(this.guns, (m) => m.name === 'led');
  }
  setGunState(sim: Sim, t: number) {
    for (const [id, o] of this.gunMesh) {
      const on = sim.gunOn.has(id);
      const led = o.getObjectByName('led') as THREE.Mesh;
      (led.material as THREE.MeshBasicMaterial).color.setHex(on ? (sim.canMakeSnow ? 0x3dff7a : 0xffb000) : 0xff3b30);
      led.visible = on || Math.sin(t * 4) > 0;
    }
  }
  gunNozzle(g: Gun, out: THREE.Vector3) {
    out.set(g.x + g.dx * 1.0, this.m.at(g.x, g.z) + 4.7, g.z + g.dz * 1.0);
    return out;
  }

  // ------------------------------------------------------------------ floodlights
  private rebuildLamps(sim: Sim) {
    for (const c of [...this.lamps.children]) this.lamps.remove(c);
    this.lampPts = [];
    if (!sim.lv('lights')) { this.w.setLamps([], false); return; }
    const poleM = M(0x4a4f55, 0.6, { metalness: 0.4 });
    const poleG = new THREE.CylinderGeometry(0.14, 0.2, 9, 6);
    poleG.translate(0, 4.5, 0);
    const headG = new THREE.BoxGeometry(1.4, 0.4, 0.7);
    const pts: [number, number][] = [];
    for (const r of RUNS) {
      if (!r.lit || !sim.runBuilt(r.id)) continue;
      const p = this.m.runOf[r.id];
      const step = 42;
      for (let s = 10, k = 0; s < p.len - 5; s += step, k++) {
        const i = this.m.idxAt(p, s);
        const side = k % 2 ? 1 : -1;
        const off = r.w / 2 + 1.5;
        const x = p.x[i] - p.tz[i] * off * side, z = p.z[i] + p.tx[i] * off * side;
        const pole = new THREE.Mesh(poleG, poleM);
        pole.position.set(x, this.m.at(x, z), z);
        const head = new THREE.Mesh(headG, this.bulb);
        head.position.set(x + p.tz[i] * side * 0.8, this.m.at(x, z) + 9.1, z - p.tx[i] * side * 0.8);
        head.rotation.y = Math.atan2(p.tx[i], p.tz[i]);
        pole.castShadow = true;
        this.lamps.add(pole, head);
        pts.push([x + p.tz[i] * side * (off * 0.7), z - p.tx[i] * side * (off * 0.7)]);
      }
    }
    // the village itself is lit
    for (const [x, z] of [[0, 500], [60, 520], [-60, 500], [-120, 470], [140, 490], [220, 520], [-200, 480]] as [number, number][]) pts.push([x, z]);
    this.lampPts = pts;
    bake(this.lamps);
    this.w.setLamps(pts, true);
  }
}
