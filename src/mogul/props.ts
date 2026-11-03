// Everything placed on the map: food carts with umbrellas, shop awnings, facility roof gear, quarries,
// ore markers, trucks and couriers, the survey pulse and the placement ghost.
import * as THREE from 'three';
import type { City } from './city.ts';
import type { Sim, Cart } from './sim.ts';
import { MENU_BY, SHOP_BY, FAC_BY, GOODS, type GoodId } from './data.ts';

const mat = (c: number | string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });

export function makeCart(color: string, rival: string | null): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.2), mat(rival ?? '#f4f1e8'));
  body.position.y = 0.95;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.22, 1.24), mat(color));
  trim.position.y = 1.35;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 1.4), mat('#8a8f99', { metalness: 0.6, roughness: 0.3 }));
  counter.position.y = 1.5;
  const wheelG = new THREE.CylinderGeometry(0.38, 0.38, 0.14, 14).rotateX(Math.PI / 2);
  const wm = mat('#2a2a30');
  for (const sx of [-0.7, 0.7]) { const w = new THREE.Mesh(wheelG, wm); w.position.set(sx, 0.38, 0.66); g.add(w); }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), mat('#ddd'));
  pole.position.set(0, 2.4, 0);
  const umb = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.7, 10, 1, true), mat(color, { side: THREE.DoubleSide }));
  umb.position.y = 3.35;
  const umb2 = new THREE.Mesh(new THREE.ConeGeometry(1.92, 0.7, 10, 1, true, Math.PI / 10, Math.PI / 10), mat('#ffffff', { side: THREE.DoubleSide }));
  umb2.position.y = 3.36;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(color));
  top.position.y = 3.72;
  g.add(body, trim, counter, pole, umb, top);
  for (let k = 0; k < 5; k++) { const u = umb2.clone(); u.rotation.y = (k * Math.PI * 2) / 5; g.add(u); }
  g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; } });
  g.scale.setScalar(1.25);
  return g;
}

function makeTruck(own: boolean): THREE.Group {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 1.7), mat(own ? '#ffc83d' : '#e9e6df'));
  cab.position.set(0, 1.35, 2.0);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.1), mat('#2b3a4a', { roughness: 0.2, metalness: 0.4 }));
  win.position.set(0, 1.75, 2.86);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.5, 4.2), mat(own ? '#f7f3ea' : '#c9c6bf'));
  box.position.set(0, 1.65, -0.9);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.4, 4.22), mat(own ? '#ffc83d' : '#8a8f99'));
  stripe.position.set(0, 1.1, -0.9);
  const wg = new THREE.CylinderGeometry(0.45, 0.45, 2.3, 12).rotateZ(Math.PI / 2);
  const wm = mat('#1f1f24');
  for (const z of [1.9, -0.4, -2.2]) { const w = new THREE.Mesh(wg, wm); w.position.set(0, 0.45, z); g.add(w); }
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.0), mat('#888'));
  cargo.position.set(0, 3.35, -0.9);
  cargo.name = 'cargo';
  g.add(cab, win, box, stripe, cargo);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

function makeQuarry(ore: GoodId): THREE.Group {
  const g = new THREE.Group();
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(9, 6, 1.2, 20, 1, true), mat('#7a6a55', { side: THREE.DoubleSide }));
  pit.position.y = 0.2;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 20).rotateX(-Math.PI / 2), mat(GOODS[ore].color));
  floor.position.y = 0.12;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(9, 0.6, 6, 24).rotateX(Math.PI / 2), mat('#b49a74'));
  rim.position.y = 0.6;
  // a headframe tower with a turning wheel
  const legM = mat('#d9534f', { metalness: 0.3 });
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.35, 14, 0.35), legM);
    l.position.set(x * 0.6, 7, z * 0.6);
    l.rotation.set(z * 0.05, 0, -x * 0.05);
    g.add(l);
  }
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 6, 18), mat('#333'));
  wheel.position.set(0, 14, 0);
  wheel.name = 'wheel';
  const pile = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3, 9), mat(GOODS[ore].color, { roughness: 1 }));
  pile.position.set(10, 1.5, 4);
  pile.name = 'pile';
  const shed = new THREE.Mesh(new THREE.BoxGeometry(5, 3.4, 4), mat('#f2e6cf'));
  shed.position.set(-10, 1.7, -3);
  g.add(pit, floor, rim, wheel, pile, shed);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

function makeMarker(color: string): THREE.Group {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(2.4), mat(color, { emissive: color, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.25 }));
  gem.position.y = 6;
  gem.name = 'gem';
  const ring = new THREE.Mesh(new THREE.RingGeometry(4, 5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
  ring.position.y = 0.2;
  ring.name = 'ring';
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
  beam.position.y = 3;
  g.add(gem, ring, beam);
  return g;
}

function makeAwning(color: string, w: number): THREE.Group {
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 2.2), mat(color));
  a.position.set(0, 3.3, 1.0);
  a.rotation.x = 0.28;
  const stripes = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.2, 0.5), mat('#ffffff'));
  stripes.position.set(0, 3.0, 2.05);
  stripes.rotation.x = 0.28;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.8, 0.15), mat(color, { emissive: color, emissiveIntensity: 0.25 }));
  sign.position.set(0, 4.3, 0.12);
  g.add(a, stripes, sign);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

function makeRoofGear(type: string, b: { cx: number; cz: number; area: number }, h: number): THREE.Group {
  const g = new THREE.Group();
  const f = FAC_BY[type];
  const s = Math.min(1, Math.sqrt(b.area) / 26);
  if (f.group === 'factory') {
    for (let k = 0; k < (type === 'foundry' ? 3 : 2); k++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(1.0 * s + 0.5, 1.3 * s + 0.6, 12 * s + 6, 12), mat(k % 2 ? '#c4553b' : '#9a9a9a'));
      st.position.set((k - 0.5) * 5 * s, h + (12 * s + 6) / 2, 0);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.05 * s + 0.52, 1.05 * s + 0.52, 0.6, 12), mat('#f4f1e8'));
      band.position.set(st.position.x, h + 12 * s + 4, 0);
      g.add(st, band);
    }
    g.userData.smoke = true;
  } else if (f.group === 'farm') {
    const rows = Math.max(2, Math.round(4 * s));
    for (let k = 0; k < rows; k++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(18 * s + 4, 0.8, 1.6), mat(type === 'greenhouse' ? '#c9f2df' : type === 'grain' ? '#f1d36b' : '#7cc46a', type === 'greenhouse' ? { transparent: true, opacity: 0.7, roughness: 0.1 } : {}));
      r.position.set(0, h + 0.4, (k - (rows - 1) / 2) * 3.2);
      g.add(r);
    }
    if (type === 'greenhouse') {
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(4 * s + 2, 4 * s + 2, 16 * s + 6, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), mat('#bff0dc', { transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2 }));
      dome.position.y = h;
      g.add(dome);
    }
    if (type === 'grain' || type === 'dairy') {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(2 * s + 1, 2 * s + 1, 10 * s + 5, 12), mat('#e9e6df', { metalness: 0.4 }));
      silo.position.set(9 * s + 3, h + (10 * s + 5) / 2, 0);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2 * s + 1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d9534f'));
      cap.position.set(silo.position.x, h + 10 * s + 5, 0);
      g.add(silo, cap);
    }
  } else if (f.group === 'home') {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 6), mat('#f6e3cf'));
    roof.position.y = h + 1.25;
    const garden = new THREE.Mesh(new THREE.BoxGeometry(10 * s + 4, 0.6, 10 * s + 4), mat('#7cc46a'));
    garden.position.set(0, h + 0.3, 7 * s);
    g.add(roof, garden);
  } else {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(10 * s + 3, 1.6, 0.4), mat('#ffc83d'));
    sign.position.y = h + 1.6;
    g.add(sign);
  }
  g.position.set(b.cx, 0, b.cz);
  g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

export class Props {
  scene: THREE.Scene;
  city: City;
  sim: Sim;
  root = new THREE.Group();
  carts = new Map<number, THREE.Group>();
  awnings = new Map<number, THREE.Group>();
  gear = new Map<number, THREE.Group>();
  quarries = new Map<number, THREE.Group>();
  markers = new Map<number, THREE.Group>();
  trucks = new Map<number, THREE.Group>();
  ghost: THREE.Group;
  ghostOk = true;
  pulse: THREE.Mesh;
  private pulseT = -1;
  smoke: THREE.InstancedMesh;
  private smokeP: { x: number; y: number; z: number; t: number; s: number }[] = [];
  private terminal: THREE.Group;
  time = 0;

  constructor(scene: THREE.Scene, city: City, sim: Sim) {
    this.scene = scene; this.city = city; this.sim = sim;
    scene.add(this.root);
    this.ghost = makeCart('#ffc83d', null);
    this.ghost.traverse((o) => { if (o instanceof THREE.Mesh) { o.material = (o.material as THREE.Material).clone(); (o.material as THREE.MeshStandardMaterial).transparent = true; (o.material as THREE.MeshStandardMaterial).opacity = 0.6; o.castShadow = false; } });
    this.ghost.visible = false;
    const gring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffc83d', transparent: true, opacity: 0.8, depthWrite: false }));
    gring.name = 'range';
    gring.position.y = 0.25;
    this.ghost.add(gring);
    scene.add(this.ghost);
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7ff0e0', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.pulse.visible = false;
    this.pulse.renderOrder = 3;
    scene.add(this.pulse);
    this.smoke = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshStandardMaterial({ color: '#e8e8ec', transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }), 260);
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);
    // the freight terminal where couriers come from
    this.terminal = new THREE.Group();
    const n = sim.terminal;
    const tx = city.nx[n], tz = city.nz[n];
    const gate = new THREE.Mesh(new THREE.BoxGeometry(16, 1.4, 1.4), mat('#ffc83d'));
    gate.position.y = 7;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 1.2), mat('#3b3b40')); p.position.set(s * 7.5, 3.5, 0); this.terminal.add(p); }
    this.terminal.add(gate);
    this.terminal.position.set(tx, 0, tz);
    scene.add(this.terminal);
  }

  setGhost(on: boolean, x = 0, z = 0, ok = true, radius = 16, color = '#ffc83d') {
    this.ghost.visible = on;
    if (!on) return;
    this.ghost.position.set(x, 0, z);
    this.ghostOk = ok;
    const ring = this.ghost.getObjectByName('range') as THREE.Mesh;
    ring.scale.setScalar(radius);
    (ring.material as THREE.MeshBasicMaterial).color.set(ok ? color : '#ff5a5a');
  }

  surveyPulse(x: number, z: number) {
    this.pulse.position.set(x, 0.3, z);
    this.pulseT = 0;
    this.pulse.visible = true;
  }

  /** Rebuild the placed things from the sim (called on change; cheap, diffing by id). */
  sync() {
    const s = this.sim.s;
    const seen = new Set<number>();
    for (const c of s.carts) {
      seen.add(c.id);
      let g = this.carts.get(c.id);
      const col = MENU_BY[c.menu[0]].color;
      const key = c.menu.join(',') + c.rival;
      if (!g || g.userData.key !== key) {
        if (g) this.root.remove(g);
        g = makeCart(col, c.rival >= 0 ? s.rivals[c.rival].color : null);
        g.userData.key = key;
        g.userData.id = c.id;
        this.carts.set(c.id, g);
        this.root.add(g);
      }
      g.position.set(c.x, 0, c.z);
      const q = this.city.nearestEdge(c.x, c.z, 40);
      if (q) { const e = this.city.edges[q.e]; g.rotation.y = Math.atan2(this.city.nx[e.b] - this.city.nx[e.a], this.city.nz[e.b] - this.city.nz[e.a]) + Math.PI / 2; }
    }
    for (const [id, g] of this.carts) if (!seen.has(id)) { this.root.remove(g); this.carts.delete(id); }
    // shop awnings
    seen.clear();
    for (const sh of s.shops) {
      seen.add(sh.id);
      if (this.awnings.has(sh.id)) continue;
      const b = this.city.buildings[sh.b];
      const list = this.sim.shopsIn(sh.b);
      const k = list.indexOf(sh), n = list.length;
      const g = makeAwning(SHOP_BY[sh.type].color, 6);
      const tx = -b.door.nz, tz = b.door.nx;
      const off = (k - (n - 1) / 2) * 7;
      g.position.set(b.door.x + tx * off, 0, b.door.z + tz * off);
      g.rotation.y = Math.atan2(b.door.nx, b.door.nz);
      this.awnings.set(sh.id, g);
      this.root.add(g);
    }
    for (const [id, g] of this.awnings) if (!seen.has(id)) { this.root.remove(g); this.awnings.delete(id); }
    // facility roof gear
    seen.clear();
    for (const f of s.facs) {
      seen.add(f.b);
      const key = f.type + (f.build >= 1 ? 1 : 0);
      const g = this.gear.get(f.b);
      if (g && g.userData.key === key) continue;
      if (g) this.root.remove(g);
      if (f.build < 1) { this.gear.delete(f.b); continue; }
      const b = this.city.buildings[f.b];
      const ng = makeRoofGear(f.type, b, FAC_BY[f.type].h);
      ng.userData.key = key;
      this.gear.set(f.b, ng);
      this.root.add(ng);
    }
    for (const [id, g] of this.gear) if (!seen.has(id)) { this.root.remove(g); this.gear.delete(id); }
    // quarries + found deposits
    for (const q of s.quarries) {
      if (this.quarries.has(q.id)) continue;
      const d = s.deposits[q.dep];
      const g = makeQuarry(d.ore);
      g.position.set(q.x, 0, q.z);
      this.quarries.set(q.id, g);
      this.root.add(g);
    }
    for (const d of s.deposits) {
      const want = d.found && !d.claimed;
      const g = this.markers.get(d.id);
      if (want && !g) { const m = makeMarker(GOODS[d.ore].color); m.position.set(d.x, 0, d.z); m.userData.dep = d.id; this.markers.set(d.id, m); this.root.add(m); }
      if (!want && g) { this.root.remove(g); this.markers.delete(d.id); }
    }
  }

  cartAt(x: number, z: number, r = 4): Cart | null {
    let best: Cart | null = null, bd = r;
    for (const c of this.sim.s.carts) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  markerAt(x: number, z: number, r = 7): number {
    for (const [id, g] of this.markers) if (Math.hypot(g.position.x - x, g.position.z - z) < r) return id;
    return -1;
  }
  quarryAt(x: number, z: number, r = 11): number {
    for (const q of this.sim.s.quarries) if (Math.hypot(q.x - x, q.z - z) < r) return q.id;
    return -1;
  }

  update(dt: number, speed: number) {
    this.time += dt;
    // vehicles
    const live = new Set<number>();
    for (const v of this.sim.vehicles) {
      if (v.phase === 'idle' && !v.own) continue;
      live.add(v.id);
      let g = this.trucks.get(v.id);
      if (!g) { g = makeTruck(v.own); this.trucks.set(v.id, g); this.root.add(g); }
      g.position.set(v.x, 0, v.z);
      let dy = v.dir - g.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.rotation.y += dy * Math.min(1, dt * 8);
      const cargo = g.getObjectByName('cargo') as THREE.Mesh;
      cargo.visible = !!v.good && v.phase === 'drop';
      if (v.good) (cargo.material as THREE.MeshStandardMaterial).color.set(GOODS[v.good].color);
    }
    for (const [id, g] of this.trucks) if (!live.has(id)) { this.root.remove(g); this.trucks.delete(id); }
    // quarry wheels turn, piles grow with the store
    for (const q of this.sim.s.quarries) {
      const g = this.quarries.get(q.id);
      if (!g) continue;
      const d = this.sim.s.deposits[q.dep];
      (g.getObjectByName('wheel') as THREE.Object3D).rotation.z += dt * speed * (d.left > 0 ? 1.5 : 0);
      const pile = g.getObjectByName('pile') as THREE.Object3D;
      pile.scale.setScalar(0.3 + Math.min(1, (q.store[d.ore] ?? 0) / 300) * 0.9);
    }
    for (const g of this.markers.values()) {
      const gem = g.getObjectByName('gem') as THREE.Object3D;
      gem.rotation.y += dt * 1.6;
      gem.position.y = 6 + Math.sin(this.time * 2 + g.position.x) * 0.6;
      const ring = g.getObjectByName('ring') as THREE.Object3D;
      ring.scale.setScalar(1 + (this.time % 1.5) * 0.6);
    }
    // smoke from factory stacks
    for (const [bid, g] of this.gear) {
      if (!g.userData.smoke || Math.random() > dt * 6 * Math.min(speed, 3)) continue;
      const stacks = g.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.CylinderGeometry && c.position.y > 4);
      const st = stacks[(Math.random() * stacks.length) | 0];
      if (!st) continue;
      const top = st.position.y + ((st as THREE.Mesh).geometry as THREE.CylinderGeometry).parameters.height / 2;
      this.smokeP.push({ x: g.position.x + st.position.x, y: top, z: g.position.z + st.position.z, t: 0, s: 0.8 + Math.random() * 0.6 });
      void bid;
    }
    if (this.smokeP.length > 250) this.smokeP.splice(0, this.smokeP.length - 250);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const p of this.smokeP) {
      p.t += dt;
      p.y += dt * 3.5; p.x += dt * 1.6;
      const sc = p.s * (1 + p.t * 1.4);
      m.makeScale(sc, sc, sc).setPosition(p.x, p.y, p.z);
      if (p.t < 5) this.smoke.setMatrixAt(k++, m);
    }
    this.smokeP = this.smokeP.filter((p) => p.t < 5);
    this.smoke.count = k;
    this.smoke.instanceMatrix.needsUpdate = true;
    // survey pulse
    if (this.pulseT >= 0) {
      this.pulseT += dt;
      const r = 140 * Math.min(1, this.pulseT / 1.4);
      this.pulse.scale.setScalar(r);
      (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - Math.max(0, this.pulseT - 1.2) / 0.8);
      if (this.pulseT > 2) { this.pulseT = -1; this.pulse.visible = false; }
    }
    // cart umbrellas bob a little
    for (const g of this.carts.values()) g.children[4] && (g.children[4].rotation.y += dt * 0.2);
  }
}
