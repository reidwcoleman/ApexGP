// Bluebird: the lifts. Towers, haul rope, terminals and a loop of chairs (or cabins, or a carpet belt)
// that really carry riders: a chair passing the load point takes whoever is first in the line.
import * as THREE from 'three';
import { Mountain, LIFTS, type LiftDef } from './mountain.ts';
import { liftSpecs, LIFT_RUSH } from './data.ts';
import { bake, type World } from './world.ts';

export interface Rider { unload(lift: Lift): void; boarded?(lift: Lift, chair: number, seat: number): void }

const OFF = 2.6; // half the gap between the up and down rope

export class Lift {
  def: LiftDef;
  group = new THREE.Group();
  lv = 0;
  up: THREE.Vector3[] = []; // rope points going up (on the up side)
  dn: THREE.Vector3[] = []; // going down
  upLen: number[] = [];
  dnLen: number[] = [];
  Lu = 0; Ld = 0; L = 0; R = OFF;
  offset = 0;
  speed = 0; // current (eased) rope speed, m/s of game time
  chairs = 0;
  spacing = 14;
  seats = 2;
  riders: (Rider | null)[][] = [];
  queue: Rider[] = [];
  dir = new THREE.Vector2();
  right = new THREE.Vector2();
  loadPt = new THREE.Vector3();
  unloadPt = new THREE.Vector3();
  topPt = new THREE.Vector3();
  hang = 2.6;
  private chairMesh: THREE.InstancedMesh | null = null;
  private carpetTex: THREE.CanvasTexture | null = null;
  running = false;
  broken = false;
  private M = new THREE.Matrix4();
  private Q = new THREE.Quaternion();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(def: LiftDef, private m: Mountain, private w: World) {
    this.def = def;
    const [ax, az] = def.a, [bx, bz] = def.b;
    this.dir.set(bx - ax, bz - az).normalize();
    this.right.set(-this.dir.y, this.dir.x); // perpendicular
    this.hang = def.kind === 'gondola' ? 3.4 : 2.5;
    w.scene.add(this.group);
    this.buildPath();
  }

  get isCarpet() { return this.def.kind === 'carpet'; }

  private buildPath() {
    const { a, b } = this.def;
    const m = this.m;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const carpet = this.isCarpet;
    const towerH = this.def.kind === 'gondola' ? 15 : 10.5;
    const stationH = carpet ? 0.35 : this.def.kind === 'gondola' ? 7.5 : 6.2;
    const n = carpet ? Math.ceil(L / 4) : Math.max(2, Math.ceil(L / 58));
    // centre line points (top of towers), first/last at the terminals
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const end = i === 0 || i === n;
      pts.push(new THREE.Vector3(x, m.at(x, z) + (end ? stationH : carpet ? 0.35 : towerH), z));
    }
    if (!carpet) {
      // keep the rope clear of the snow: raise towers until every span clears by 7 m (gondola 9 m)
      const clear = this.def.kind === 'gondola' ? 9 : 7;
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < n; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          for (let k = 1; k < 8; k++) {
            const t = k / 8;
            const x = p0.x + (p1.x - p0.x) * t, z = p0.z + (p1.z - p0.z) * t;
            const y = p0.y + (p1.y - p0.y) * t - Math.sin(t * Math.PI) * 1.2;
            const g = m.at(x, z) + clear + this.hang;
            if (y < g) { const need = g - y; if (i > 0) pts[i].y += need * (1 - t); if (i + 1 < n) pts[i + 1].y += need * t; }
          }
        }
      }
    }
    this.towers = pts;
    const rx = this.right.x, rz = this.right.y;
    const off = carpet ? 0 : OFF;
    this.up = pts.map((p) => new THREE.Vector3(p.x + rx * off, p.y, p.z + rz * off));
    this.dn = [...pts].reverse().map((p) => new THREE.Vector3(p.x - rx * off, p.y, p.z - rz * off));
    const acc = (arr: THREE.Vector3[]) => { const out = [0]; for (let i = 1; i < arr.length; i++) out.push(out[i - 1] + arr[i].distanceTo(arr[i - 1])); return out; };
    this.upLen = acc(this.up); this.dnLen = acc(this.dn);
    this.Lu = this.upLen[this.upLen.length - 1];
    this.Ld = this.dnLen[this.dnLen.length - 1];
    this.R = carpet ? 0.5 : OFF;
    this.L = this.Lu + this.Ld + Math.PI * this.R * 2;
    // load / unload points on the ground
    const g = (x: number, z: number, out: THREE.Vector3) => out.set(x, m.at(x, z), z);
    g(a[0] + this.dir.x * 3 + rx * off, a[1] + this.dir.y * 3 + rz * off, this.loadPt);
    g(b[0] - this.dir.x * (carpet ? 1 : 2) + rx * off, b[1] - this.dir.y * (carpet ? 1 : 2) + rz * off, this.unloadPt);
    g(b[0] + this.dir.x * 10, b[1] + this.dir.y * 10, this.topPt);
  }
  towers: THREE.Vector3[] = [];

  /** rebuild meshes for a level */
  setLevel(lv: number) {
    if (lv === this.lv) return;
    this.lv = lv;
    for (const c of [...this.group.children]) this.group.remove(c);
    this.chairMesh = null;
    const spec = liftSpecs(this.def.kind)[lv];
    if (!lv || !spec) return;
    // keep riders that are aboard
    const old = this.riders;
    this.spacing = spec.spacing;
    this.seats = spec.seats;
    this.chairs = Math.floor(this.L / this.spacing);
    this.spacing = this.L / this.chairs;
    this.riders = Array.from({ length: this.chairs }, (_, i) => Array.from({ length: this.seats }, (_, s) => old[i]?.[s] ?? null));
    for (let i = this.chairs; i < old.length; i++) for (const r of old[i]) if (r) r.unload(this);
    this.buildMeshes(spec.name);
  }

  private buildMeshes(levelName: string) {
    const kind = this.def.kind;
    const M = (c: number, r = 0.6, mt = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
    const steel = M(0x9aa1a8, 0.5, 0.15);
    const dark = M(0x2b3036, 0.6, 0.1);
    const accent = M({ meadow: 0x2f7fe0, summit: 0xd2453a, ridge: 0xf2c46d, gondola: 0x2fb65a, carpet: 0x2f7fe0 }[this.def.id] ?? 0x2f7fe0, 0.5, 0.2);
    const yaw = Math.atan2(this.dir.x, this.dir.y);
    if (kind === 'carpet') {
      const a = this.towers[0], b = this.towers[this.towers.length - 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const segs = this.towers.length - 1;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const p = this.towers[i];
        for (const s of [-1, 1]) { pos.push(p.x + this.right.x * s * 0.8, this.m.at(p.x, p.z) + 0.32, p.z + this.right.y * s * 0.8); uv.push(s * 0.5 + 0.5, (i / segs) * L / 1.2); }
      }
      for (let i = 0; i < segs; i++) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const n = g.getAttribute('normal');
      if (n.getY(0) < 0) { g.setIndex(idx.map((_, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
      const c = document.createElement('canvas'); c.width = 32; c.height = 32;
      const cx = c.getContext('2d')!; cx.fillStyle = '#26292e'; cx.fillRect(0, 0, 32, 32); cx.fillStyle = '#3b4048'; cx.fillRect(0, 0, 32, 6);
      const t = (this.carpetTex = new THREE.CanvasTexture(c));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      const belt = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
      belt.receiveShadow = true;
      this.group.add(belt);
      // side rails + a little tunnel at the start
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, L), accent);
        const mx = (a.x + b.x) / 2 + this.right.x * s * 1.0, mz = (a.z + b.z) / 2 + this.right.y * s * 1.0;
        rail.position.set(mx, (this.m.at(a.x, a.z) + this.m.at(b.x, b.z)) / 2 + 0.7, mz);
        rail.rotation.order = 'YXZ';
        rail.rotation.y = yaw;
        rail.rotation.x = -Math.atan2(this.m.at(b.x, b.z) - this.m.at(a.x, a.z), L);
        this.group.add(rail);
      }
      if (this.lv >= 2) {
        // a covered carpet: hoops every few metres
        const hoopM = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.2, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
        for (let t = 0.04; t < 0.97; t += 0.035) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.06, 4, 12, Math.PI), hoopM);
          hoop.position.set(x, this.m.at(x, z) + 0.3, z);
          hoop.rotation.y = yaw;
          this.group.add(hoop);
        }
      }
      return;
    }
    // towers
    const n = this.towers.length;
    for (let i = 1; i < n - 1; i++) {
      const p = this.towers[i];
      const gy = this.m.at(p.x, p.z);
      const h = p.y - gy + 0.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 8), steel);
      pole.position.set(p.x, gy + h / 2, p.z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(OFF * 2 + 1.2, 0.4, 0.5), steel);
      arm.position.set(p.x, p.y + 0.5, p.z);
      arm.rotation.y = yaw;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), dark);
      cap.position.set(p.x, p.y + 0.85, p.z);
      this.group.add(pole, arm, cap);
      for (const s of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 2.6), dark);
        sh.position.set(p.x + this.right.x * OFF * s, p.y + 0.2, p.z + this.right.y * OFF * s);
        sh.rotation.y = yaw;
        this.group.add(sh);
      }
      // a ladder stripe so it reads as a tower
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.8, 8), M(0x7a7d80, 0.9, 0));
      base.position.set(p.x, gy + 0.2, p.z);
      this.group.add(base);
    }
    // terminals
    for (const end of [0, n - 1]) {
      const p = this.towers[end];
      const gy = this.m.at(p.x, p.z);
      const g = new THREE.Group();
      const big = kind === 'gondola';
      const hw = OFF + 1.8;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 4, 0.5, big ? 16 : 9), M(0x8a8e93, 0.95, 0));
      pad.position.set(0, 0.0, end === 0 ? 4 : -4);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(1.4, p.y - gy - 0.5, 1.4), steel);
      legs.position.set(0, (p.y - gy) / 2, end === 0 ? -3.5 : 3.5);
      const house = new THREE.Mesh(big ? new THREE.BoxGeometry(hw * 2 + 1, 4.5, 12) : new THREE.CylinderGeometry(hw + 0.3, hw + 0.3, 1.4, 20), big ? accent : dark);
      house.position.set(0, p.y - gy + (big ? 0.5 : 0.6), 0);
      const roof = new THREE.Mesh(big ? new THREE.BoxGeometry(hw * 2 + 2, 0.5, 13) : new THREE.CylinderGeometry(hw + 0.6, hw + 0.6, 0.3, 20), M(0xf4f7fb, 0.7, 0));
      roof.position.set(0, p.y - gy + (big ? 3 : 1.45), 0);
      g.add(pad, legs, house, roof);
      if (end === 0) {
        // operator hut + maze ropes
        const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), accent);
        hut.position.set(hw + 3, 1.3, -2);
        const hr = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 2.8), M(0xf4f7fb, 0.7, 0));
        hr.position.set(hw + 3, 2.75, -2);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), this.w.glow(new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0xffc070, emissiveIntensity: 0.3 }), 1));
        win.position.set(hw + 3, 1.6, -0.79);
        win.rotation.y = Math.PI;
        g.add(hut, hr, win);
        // sign
        const c = document.createElement('canvas'); c.width = 512; c.height = 128;
        const cx = c.getContext('2d')!;
        cx.fillStyle = '#1f3a5f'; cx.fillRect(0, 0, 512, 128);
        cx.fillStyle = '#fff6e6'; cx.font = '700 54px Barlow, sans-serif'; cx.textAlign = 'center'; cx.fillText(this.def.name.toUpperCase(), 256, 64);
        cx.fillStyle = '#f2c46d'; cx.font = '600 28px Barlow, sans-serif'; cx.fillText(levelName.toUpperCase(), 256, 106);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
        sign.position.set(0, p.y - gy + 2.3, -hw);
        sign.rotation.y = Math.PI;
        g.add(sign);
      }
      g.position.set(p.x, gy, p.z);
      g.rotation.y = yaw;
      g.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      this.group.add(g);
    }
    // haul rope
    const rope: number[] = [];
    const pushLine = (arr: THREE.Vector3[]) => { for (let i = 0; i < arr.length - 1; i++) { const a = arr[i], b = arr[i + 1]; for (let k = 0; k < 6; k++) { const t0 = k / 6, t1 = (k + 1) / 6; const s0 = Math.sin(t0 * Math.PI) * 0.9, s1 = Math.sin(t1 * Math.PI) * 0.9; rope.push(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0 - s0, a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1 - s1, a.z + (b.z - a.z) * t1); } } };
    pushLine(this.up); pushLine(this.dn);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3));
    this.group.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x22262b })));
    // chairs / cabins
    let geo: THREE.BufferGeometry;
    if (kind === 'gondola') {
      const parts: THREE.BufferGeometry[] = [];
      const cab = new THREE.BoxGeometry(2.2, 2.3, 2.4); cab.translate(0, -1.2, 0); parts.push(cab);
      const hang = new THREE.BoxGeometry(0.12, this.hang - 2.3, 0.12); hang.translate(0, -(this.hang - 2.3) / 2 + 0.05, 0); parts.push(hang);
      geo = mergeSimple(parts);
      geo.translate(0, 0, 0);
    } else {
      const parts: THREE.BufferGeometry[] = [];
      const w = this.seats * 0.62 + 0.2;
      const hang = new THREE.BoxGeometry(0.08, this.hang, 0.08); hang.translate(0, -this.hang / 2, 0); parts.push(hang);
      const seat = new THREE.BoxGeometry(w, 0.12, 0.6); seat.translate(0, -this.hang, 0.1); parts.push(seat);
      const back = new THREE.BoxGeometry(w, 0.7, 0.08); back.translate(0, -this.hang + 0.38, -0.2); parts.push(back);
      const bar = new THREE.BoxGeometry(w, 0.05, 0.05); bar.translate(0, -this.hang + 0.55, 0.62); parts.push(bar);
      const top = new THREE.BoxGeometry(0.4, 0.2, 0.4); parts.push(top);
      geo = mergeSimple(parts);
    }
    const mat = kind === 'gondola' ? new THREE.MeshStandardMaterial({ color: 0x2fb65a, roughness: 0.45, metalness: 0.05 }) : new THREE.MeshStandardMaterial({ color: (accent.color as THREE.Color).getHex(), roughness: 0.55, metalness: 0.05 });
    this.chairMesh = new THREE.InstancedMesh(geo, mat, this.chairs);
    this.chairMesh.castShadow = true;
    this.chairMesh.frustumCulled = false;
    this.group.add(this.chairMesh);
    if (kind === 'gondola') {
      // cabin windows glow at night
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.24, 0.9, 2.44).translate(0, -0.9, 0), this.w.glow(new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.15, metalness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0.2 }), 0.6), this.chairs);
      wins.frustumCulled = false;
      this.winMesh = wins;
      this.group.add(wins);
    }
    bake(this.group);
  }
  private winMesh: THREE.InstancedMesh | null = null;

  /** where along the loop a rope point is */
  private ropeAt(u: number, out: THREE.Vector3, fwd: THREE.Vector3) {
    u = ((u % this.L) + this.L) % this.L;
    const seg = (arr: THREE.Vector3[], lens: number[], d: number) => {
      let i = 0;
      while (i < lens.length - 2 && lens[i + 1] < d) i++;
      const t = (d - lens[i]) / Math.max(1e-6, lens[i + 1] - lens[i]);
      out.lerpVectors(arr[i], arr[i + 1], t);
      out.y -= Math.sin(t * Math.PI) * 0.9;
      fwd.subVectors(arr[i + 1], arr[i]).normalize();
    };
    const half = Math.PI * this.R;
    if (u < this.Lu) { seg(this.up, this.upLen, u); return; }
    u -= this.Lu;
    const top = this.towers[this.towers.length - 1], bot = this.towers[0];
    if (u < half) {
      const a = u / this.R; // 0..pi
      const rx = this.right.x, rz = this.right.y;
      out.set(top.x + (rx * Math.cos(a) + this.dir.x * Math.sin(a) * 0.6) * this.R, top.y, top.z + (rz * Math.cos(a) + this.dir.y * Math.sin(a) * 0.6) * this.R);
      fwd.set(-rx * Math.sin(a) + this.dir.x * Math.cos(a), 0, -rz * Math.sin(a) + this.dir.y * Math.cos(a)).normalize();
      return;
    }
    u -= half;
    if (u < this.Ld) { seg(this.dn, this.dnLen, u); return; }
    u -= this.Ld;
    const a = u / this.R;
    const rx = this.right.x, rz = this.right.y;
    out.set(bot.x + (-rx * Math.cos(a) - this.dir.x * Math.sin(a) * 0.6) * this.R, bot.y, bot.z + (-rz * Math.cos(a) - this.dir.y * Math.sin(a) * 0.6) * this.R);
    fwd.set(rx * Math.sin(a) - this.dir.x * Math.cos(a), 0, rz * Math.sin(a) - this.dir.y * Math.cos(a)).normalize();
  }

  chairU(i: number) { return (((this.offset + i * this.spacing) % this.L) + this.L) % this.L; }

  /** world position of a seat (the rider's hips) and the way it faces */
  seatPos(i: number, seat: number, out: THREE.Vector3, fwd: THREE.Vector3) {
    this.ropeAt(this.chairU(i), out, fwd);
    const flat = this.tmp2.set(fwd.x, 0, fwd.z).normalize();
    const side = (seat - (this.seats - 1) / 2) * (this.isCarpet ? 0.7 : 0.62);
    if (this.isCarpet) {
      out.y = this.m.at(out.x, out.z) + 0.35;
      out.x += -flat.z * side; out.z += flat.x * side;
      return;
    }
    out.y -= this.hang - (this.def.kind === 'gondola' ? 2.0 : 0.1);
    out.x += -flat.z * side; out.z += flat.x * side;
    if (this.def.kind === 'gondola') { out.x += flat.x * (seat % 2 ? 0.5 : -0.5); }
  }

  /** where the i-th person in line stands */
  queueSlot(i: number, out: THREE.Vector3) {
    const row = Math.floor(i / 4), col = i % 4;
    const back = 3 + row * 1.6;
    const lat = (col - 1.5) * 1.0 * (row % 2 ? -1 : 1);
    const x = this.loadPt.x - this.dir.x * back + this.right.x * lat, z = this.loadPt.z - this.dir.y * back + this.right.y * lat;
    return out.set(x, this.m.at(x, z), z);
  }

  enqueue(r: Rider, front = false) { if (!this.queue.includes(r)) front ? this.queue.unshift(r) : this.queue.push(r); }
  leaveQueue(r: Rider) { const i = this.queue.indexOf(r); if (i >= 0) this.queue.splice(i, 1); }
  /** take a rider off a chair without the unload callback (e.g. on a level swap) */
  remove(r: Rider) { for (const c of this.riders) for (let s = 0; s < c.length; s++) if (c[s] === r) c[s] = null; this.leaveQueue(r); }

  update(dt: number, run: boolean) {
    if (!this.lv) return;
    this.running = run;
    const spec = liftSpecs(this.def.kind)[this.lv];
    const target = run ? spec.speed * LIFT_RUSH : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * (run ? 0.8 : 2.2));
    if (Math.abs(this.speed) < 0.01 && !run) this.speed = 0;
    const du = this.speed * dt;
    const u0s = this.chairs ? this.offset : 0;
    this.offset = (this.offset + du) % this.L;
    const loadU = 3, unloadU = this.Lu - (this.isCarpet ? 1.2 : 2.5);
    if (du > 0) {
      for (let i = 0; i < this.chairs; i++) {
        const before = (((u0s + i * this.spacing) % this.L) + this.L) % this.L;
        const after = before + du;
        // load
        if (before < loadU && after >= loadU) {
          const seats = this.riders[i];
          for (let s = 0; s < seats.length; s++) {
            if (seats[s] || !this.queue.length) continue;
            const r = this.queue.shift()!;
            seats[s] = r;
            r.boarded?.(this, i, s);
          }
        }
        if (before < unloadU && after >= unloadU) {
          const seats = this.riders[i];
          for (let s = 0; s < seats.length; s++) { const r = seats[s]; if (r) { seats[s] = null; r.unload(this); } }
        }
      }
    }
    // chairs
    if (this.chairMesh) {
      const p = this.tmp, f = new THREE.Vector3();
      for (let i = 0; i < this.chairs; i++) {
        this.ropeAt(this.chairU(i), p, f);
        const yaw = Math.atan2(f.x, f.z);
        this.Q.setFromAxisAngle(Y_AXIS, yaw);
        // swing a little when the rope speeds up / brakes
        this.M.compose(p, this.Q, ONE);
        this.chairMesh.setMatrixAt(i, this.M);
        this.winMesh?.setMatrixAt(i, this.M);
      }
      this.chairMesh.instanceMatrix.needsUpdate = true;
      if (this.winMesh) this.winMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.carpetTex) this.carpetTex.offset.y -= (this.speed * dt) / 1.2;
  }

  /** the chair rides you: where are you on the loop (0..1 of the ride up) */
  rideFrac(chair: number) { return Math.min(1, this.chairU(chair) / this.Lu); }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function mergeSimple(parts: THREE.BufferGeometry[]) {
  const geos = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.getAttribute('position').array as Float32Array, o * 3); nor.set(g.getAttribute('normal').array as Float32Array, o * 3); o += g.getAttribute('position').count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

export class Lifts {
  list: Lift[];
  by: Record<string, Lift> = {};
  constructor(m: Mountain, w: World) {
    this.list = LIFTS.map((d) => new Lift(d, m, w));
    for (const l of this.list) this.by[l.def.id] = l;
  }
}
