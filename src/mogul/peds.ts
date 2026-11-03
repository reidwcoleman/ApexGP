// The crowd: people walking the real streets. Busy streets get more of them; anyone passing a cart or
// a shop may stop, queue, buy and walk on. Every sale in the game is one of these people.
import * as THREE from 'three';
import type { City } from './city.ts';
import type { Sim } from './sim.ts';

const enum St { Walk, Go, Queue, Inside, Back }

export interface Seller { key: string; x: number; z: number; qx: number; qz: number; shop: boolean; mine: boolean; radius: number; p: number; t: number; par: number; cap: number; line: number[]; inside: number[]; timers: number[] }

const SHIRTS = [0xe5533d, 0x3d7be5, 0xf2b134, 0x58b85a, 0x8a6cff, 0xff8fb0, 0x2f2f38, 0xf4f1e8, 0x38c7b0, 0xe07a3a, 0x4a4a5a, 0xb33951, 0x6fb7e8, 0xd9c7a0];
const SKIN = [0xf1c8a5, 0xe0ac86, 0xc68a62, 0x9a6440, 0x6e4529, 0xf5d5bd];

export class Peds {
  N: number;
  e: Int32Array; dir: Int8Array; s: Float32Array; side: Float32Array; sp: Float32Array; st: Uint8Array;
  x: Float32Array; z: Float32Array; yaw: Float32Array; tx: Float32Array; tz: Float32Array; seen: Int32Array; phase: Float32Array; seller: Int32Array; act: Uint8Array;
  body: THREE.InstancedMesh; head: THREE.InstancedMesh;
  sellers: Seller[] = [];
  private city: City;
  private sim: Sim;
  private weights: Float32Array;
  private cum: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private checkT = 0;
  onServed: (sel: Seller, amount: number) => void = () => {};
  onLost: (sel: Seller) => void = () => {};
  extra = new Map<number, number>(); // edge → extra weight (apartments, festivals)

  constructor(scene: THREE.Scene, city: City, sim: Sim, n = 1600) {
    this.city = city; this.sim = sim; this.N = n;
    this.e = new Int32Array(n); this.dir = new Int8Array(n); this.s = new Float32Array(n); this.side = new Float32Array(n); this.sp = new Float32Array(n);
    this.st = new Uint8Array(n); this.x = new Float32Array(n); this.z = new Float32Array(n); this.yaw = new Float32Array(n); this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.seen = new Int32Array(n).fill(-1); this.phase = new Float32Array(n); this.seller = new Int32Array(n).fill(-1); this.act = new Uint8Array(n);
    this.weights = new Float32Array(city.edges.length);
    this.cum = new Float32Array(city.edges.length);
    this.reweight();
    const bodyG = new THREE.CylinderGeometry(0.26, 0.2, 1.15, 7).translate(0, 0.62, 0);
    const legs = new THREE.BoxGeometry(0.34, 0.5, 0.2).translate(0, 0.25, 0);
    const bg = mergeGeos([bodyG, legs]);
    const hg = new THREE.SphereGeometry(0.2, 8, 6).translate(0, 1.42, 0);
    this.body = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ roughness: 0.8 }), n);
    this.head = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.body.setColorAt(i, c.setHex(SHIRTS[(Math.random() * SHIRTS.length) | 0]));
      this.head.setColorAt(i, c.setHex(SKIN[(Math.random() * SKIN.length) | 0]));
      this.spawn(i, true);
    }
    this.body.castShadow = true;
    this.body.frustumCulled = false; this.head.frustumCulled = false;
    scene.add(this.body, this.head);
  }

  reweight() {
    const c = this.city;
    const fest = this.sim.festivalEdge();
    let acc = 0;
    for (let i = 0; i < c.edges.length; i++) {
      const e = c.edges[i];
      let w = Math.pow(e.foot, 1.6) * e.len * (1 + (this.extra.get(i) ?? 0));
      if (i === fest) w *= 12;
      this.weights[i] = e.foot * (1 + (this.extra.get(i) ?? 0)) * (i === fest ? 5 : 1);
      acc += w;
      this.cum[i] = acc;
    }
    this.festival = fest;
  }
  festival = -1;

  private spawn(i: number, anywhere: boolean) {
    const c = this.city;
    const r = Math.random() * this.cum[this.cum.length - 1];
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.cum[m] < r) lo = m + 1; else hi = m; }
    const e = c.edges[lo];
    this.e[i] = lo;
    this.dir[i] = Math.random() < 0.5 ? 1 : -1;
    this.s[i] = anywhere ? Math.random() * e.len : 0;
    const walkable = e.cls >= 5;
    this.side[i] = walkable ? (Math.random() - 0.5) * (e.w - 1.2) : (Math.random() < 0.5 ? -1 : 1) * (e.w / 2 + 1.2 + Math.random() * 1.6);
    this.sp[i] = 1.25 + Math.random() * 0.7;
    this.st[i] = St.Walk;
    this.phase[i] = Math.random() * 6;
    this.act[i] = 1;
    this.place(i);
  }

  private place(i: number) {
    const c = this.city;
    const e = c.edges[this.e[i]];
    const ax = c.nx[e.a], az = c.nz[e.a], bx = c.nx[e.b], bz = c.nz[e.b];
    const L = e.len || 1;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const t = this.dir[i] > 0 ? this.s[i] : L - this.s[i];
    const side = this.side[i] * (this.dir[i] > 0 ? 1 : 1);
    this.x[i] = ax + ux * t - uz * side;
    this.z[i] = az + uz * t + ux * side;
    this.yaw[i] = Math.atan2(ux * this.dir[i], uz * this.dir[i]);
  }

  /** Sellers come from the sim: carts on the kerb, shops at their doors. */
  setSellers() {
    const old = new Map(this.sellers.map((s) => [s.key, s]));
    const out: Seller[] = [];
    for (const c of this.sim.s.carts) {
      const key = 'c:' + c.id;
      const q = this.city.nearestEdge(c.x, c.z, 40);
      let qx = 1, qz = 0;
      if (q) { const e = this.city.edges[q.e]; qx = (this.city.nx[e.b] - this.city.nx[e.a]) / e.len; qz = (this.city.nz[e.b] - this.city.nz[e.a]) / e.len; }
      const o = old.get(key);
      const svc = this.sim.serviceTime(key);
      out.push({ key, x: c.x, z: c.z, qx, qz, shop: false, mine: c.rival < 0, radius: 0, p: 0, t: svc.t, par: svc.par, cap: svc.cap, line: o?.line ?? [], inside: o?.inside ?? [], timers: o?.timers ?? [] });
    }
    for (const sh of this.sim.s.shops) {
      const key = 's:' + sh.id;
      const b = this.city.buildings[sh.b];
      const k = this.sim.shopsIn(sh.b).indexOf(sh);
      const n = this.sim.shopsIn(sh.b).length;
      const tx = -b.door.nz, tz = b.door.nx;
      const off = (k - (n - 1) / 2) * 7;
      const o = old.get(key);
      const svc = this.sim.serviceTime(key);
      out.push({ key, x: b.door.x + b.door.nx * 1.2 + tx * off, z: b.door.z + b.door.nz * 1.2 + tz * off, qx: tx, qz: tz, shop: true, mine: true, radius: 0, p: 0, t: svc.t, par: svc.par, cap: svc.cap, line: o?.line ?? [], inside: o?.inside ?? [], timers: o?.timers ?? [] });
    }
    // release anyone whose seller vanished
    const keys = new Set(out.map((s) => s.key));
    for (const s of this.sellers) if (!keys.has(s.key)) for (const i of [...s.line, ...s.inside]) this.release(i);
    this.sellers = out;
    for (let i = 0; i < this.N; i++) if (this.seller[i] >= 0) this.seller[i] = -1;
    this.sellers.forEach((s, si) => { for (const i of s.line) this.seller[i] = si; for (const i of s.inside) this.seller[i] = si; });
    this.refreshPitch();
  }
  refreshPitch() {
    for (const s of this.sellers) { const p = this.sim.pitch(s.key); s.p = p.p; s.radius = p.radius; const svc = this.sim.serviceTime(s.key); s.t = svc.t; s.par = svc.par; s.cap = svc.cap; }
  }

  private release(i: number) {
    this.st[i] = St.Back;
    this.seller[i] = -1;
  }

  /** Click-to-serve on a cart: the person at the front is served on the spot. */
  rush(key: string): boolean {
    const s = this.sellers.find((x) => x.key === key);
    if (!s || !s.line.length) return false;
    const i = s.line[0];
    if (Math.hypot(this.x[i] - this.tx[i], this.z[i] - this.tz[i]) > 1.2) return false;
    this.finish(s, i);
    return true;
  }

  private finish(s: Seller, i: number) {
    s.line = s.line.filter((k) => k !== i);
    s.inside = s.inside.filter((k) => k !== i);
    const amt = this.sim.serve(s.key);
    if (s.mine && amt > 0) this.onServed(s, amt);
    this.release(i);
    this.seen[i] = this.sellers.indexOf(s);
  }

  queueSpot(s: Seller, k: number): [number, number] {
    if (s.shop) return [s.x + s.qx * (k * 0.9) + (k ? 0 : 0), s.z + s.qz * (k * 0.9)];
    // carts: customers line up along the kerb, the first one at the counter
    return [s.x + s.qx * (1.2 + k * 0.85), s.z + s.qz * (1.2 + k * 0.85)];
  }

  update(dt: number, speed: number) {
    const c = this.city;
    const N = this.N;
    const want = Math.round(N * Math.min(1, Math.max(0.05, this.sim.crowdMul() * 0.9)));
    const sdt = dt * Math.min(speed, 3);
    this.checkT -= dt;
    const doCheck = this.checkT <= 0;
    if (doCheck) this.checkT = 0.35;
    let active = 0;
    for (let i = 0; i < N; i++) if (this.act[i]) active++;
    // sellers: serve the front of each line
    for (const s of this.sellers) {
      while (s.timers.length < s.par) s.timers.push(0);
      for (let k = 0; k < s.par; k++) {
        const i = s.shop ? s.inside[k] : s.line[k];
        if (i === undefined) { s.timers[k] = 0; continue; }
        if (!s.shop && Math.hypot(this.x[i] - this.tx[i], this.z[i] - this.tz[i]) > 0.6) continue;
        s.timers[k] += dt * speed;
        if (s.timers[k] >= s.t) { s.timers[k] = 0; this.finish(s, i); }
      }
      if (s.shop) {
        // move the front of the queue inside when there's room
        while (s.inside.length < s.par && s.line.length) {
          const i = s.line[0];
          if (Math.hypot(this.x[i] - this.tx[i], this.z[i] - this.tz[i]) > 1) break;
          s.line.shift();
          s.inside.push(i);
          this.st[i] = St.Inside;
        }
      }
      s.line.forEach((i, k) => { const [qx, qz] = this.queueSpot(s, k); this.tx[i] = qx; this.tz[i] = qz; });
    }
    for (let i = 0; i < N; i++) {
      if (!this.act[i]) {
        if (active < want && Math.random() < 0.02) { this.spawn(i, true); active++; }
        continue;
      }
      const st = this.st[i];
      if (st === St.Walk) {
        const e = c.edges[this.e[i]];
        this.s[i] += this.sp[i] * sdt;
        if (this.s[i] >= e.len) {
          // reached a corner: maybe go home, else pick the next street
          if (active > want && Math.random() < 0.25) { this.act[i] = 0; active--; continue; }
          const node = this.dir[i] > 0 ? e.b : e.a;
          const opts = c.adj[node];
          let ne = this.e[i];
          if (opts.length > 1) {
            let tot = 0;
            for (const k of opts) if (k !== this.e[i]) tot += this.weights[k] + 0.05;
            let r = Math.random() * tot;
            for (const k of opts) { if (k === this.e[i]) continue; r -= this.weights[k] + 0.05; if (r <= 0) { ne = k; break; } }
          }
          const n2 = c.edges[ne];
          this.dir[i] = n2.a === node ? 1 : -1;
          this.s[i] = this.s[i] - e.len;
          if (ne !== this.e[i]) {
            this.e[i] = ne;
            const walkable = n2.cls >= 5;
            if (walkable) this.side[i] = Math.max(-(n2.w / 2 - 0.6), Math.min(n2.w / 2 - 0.6, this.side[i]));
            else { const sd = Math.sign(this.side[i]) || 1; this.side[i] = sd * (n2.w / 2 + 1.2 + Math.random() * 1.6); }
          }
          if (this.s[i] > n2.len) this.s[i] = 0;
        }
        this.place(i);
        if (doCheck && this.sellers.length) {
          // anyone selling nearby?
          let best = -1, bs = 0;
          for (let k = 0; k < this.sellers.length; k++) {
            const s = this.sellers[k];
            const d = Math.hypot(this.x[i] - s.x, this.z[i] - s.z);
            if (d > s.radius) { if (this.seen[i] === k && d > s.radius + 8) this.seen[i] = -1; continue; }
            if (this.seen[i] === k) continue;
            const sc = s.p * Math.random() * (1 - d / (s.radius * 1.3));
            if (sc > bs) { bs = sc; best = k; }
          }
          if (best >= 0) {
            const s = this.sellers[best];
            // roll once per pass, against everyone nearby
            for (let k = 0; k < this.sellers.length; k++) if (Math.hypot(this.x[i] - this.sellers[k].x, this.z[i] - this.sellers[k].z) <= this.sellers[k].radius) this.seen[i] = k;
            this.seen[i] = best;
            if (Math.random() < s.p) {
              if (s.line.length >= s.cap) { if (s.mine) this.onLost(s); }
              else {
                s.line.push(i);
                this.seller[i] = best;
                this.st[i] = St.Go;
                const [qx, qz] = this.queueSpot(s, s.line.length - 1);
                this.tx[i] = qx; this.tz[i] = qz;
              }
            }
          }
        }
      } else if (st === St.Go || st === St.Queue) {
        const dx = this.tx[i] - this.x[i], dz = this.tz[i] - this.z[i];
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const k = Math.min(d, this.sp[i] * sdt * 1.2);
          this.x[i] += (dx / d) * k; this.z[i] += (dz / d) * k;
          this.yaw[i] = Math.atan2(dx, dz);
        } else {
          this.st[i] = St.Queue;
          const s = this.sellers[this.seller[i]];
          if (s) this.yaw[i] = Math.atan2(s.x - this.x[i], s.z - this.z[i]);
        }
      } else if (st === St.Inside) {
        // hidden in the shop
      } else if (st === St.Back) {
        // walk back onto the street where we left it
        const e = c.edges[this.e[i]];
        const ax = c.nx[e.a], az = c.nz[e.a];
        const L = e.len || 1;
        const ux = (c.nx[e.b] - ax) / L, uz = (c.nz[e.b] - az) / L;
        const t = this.dir[i] > 0 ? this.s[i] : L - this.s[i];
        const px = ax + ux * t - uz * this.side[i], pz = az + uz * t + ux * this.side[i];
        const dx = px - this.x[i], dz = pz - this.z[i];
        const d = Math.hypot(dx, dz);
        if (d < 0.3) this.st[i] = St.Walk;
        else { const k = Math.min(d, this.sp[i] * sdt * 1.1); this.x[i] += (dx / d) * k; this.z[i] += (dz / d) * k; this.yaw[i] = Math.atan2(dx, dz); }
      }
    }
    this.draw(dt * Math.min(speed, 3));
  }

  private draw(dt: number) {
    for (let i = 0; i < this.N; i++) {
      const vis = this.act[i] && this.st[i] !== St.Inside;
      if (!vis) { this.m.makeScale(0, 0, 0); this.body.setMatrixAt(i, this.m); this.head.setMatrixAt(i, this.m); continue; }
      const moving = this.st[i] === St.Walk || this.st[i] === St.Go || this.st[i] === St.Back;
      if (moving) this.phase[i] += dt * this.sp[i] * 6;
      const bob = moving ? Math.abs(Math.sin(this.phase[i])) * 0.08 : 0;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), this.yaw[i]);
      this.sc.set(1.3, 1.3, 1.3);
      this.m.compose(this.v.set(this.x[i], 0.08 + bob, this.z[i]), this.q, this.sc);
      this.body.setMatrixAt(i, this.m);
      this.head.setMatrixAt(i, this.m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
  }

  lineLength(key: string) { return this.sellers.find((s) => s.key === key)?.line.length ?? 0; }
}

export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
