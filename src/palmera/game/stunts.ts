// Stunt jumps: steel ramps around Port Palmera - on the straight after an intersection on the grid
// roads, out on the sand, and on swamp banks facing across a pond. Hit one fast in anything with
// wheels and the world drops into slow motion while you fly; land far enough (and in one piece) and
// it counts: $500 the first time, and the ramp's mark goes from amber to green. Original.
import * as THREE from 'three';
import { Rng, wrapAngle } from '../core/math';
import { BEACH, ISLAND, ROAD_HALF, XS, ZS, groundBase, isWater, ramps, type Ramp } from '../world/map';
import type { Game } from './game';
import type { Blip } from './missions';
import type { Vehicle } from '../entities/vehicle';

const LEN = 9, WID = 4.0, HT = 2.5;

function hazardTex(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#6d7074';
  x.fillRect(0, 0, 64, 256);
  // a tread pattern
  x.fillStyle = '#80848a';
  for (let y = 0; y < 256; y += 8) for (let i = (y / 8) % 2 ? 4 : 0; i < 64; i += 8) x.fillRect(i, y, 4, 2);
  // hazard stripes down both edges and across the lip
  const stripe = (x0: number, y0: number, w: number, h: number) => {
    x.save();
    x.beginPath();
    x.rect(x0, y0, w, h);
    x.clip();
    x.fillStyle = '#f2c230';
    x.fillRect(x0, y0, w, h);
    x.fillStyle = '#1b1b1b';
    for (let k = -64; k < 320; k += 16) {
      x.beginPath();
      x.moveTo(k, 0);
      x.lineTo(k + 8, 0);
      x.lineTo(k + 8 + 256, 256);
      x.lineTo(k + 256, 256);
      x.fill();
    }
    x.restore();
  };
  stripe(0, 0, 7, 256);
  stripe(57, 0, 7, 256);
  stripe(0, 0, 64, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** a wedge: the low edge at -len/2, the lip at +len/2, along +z (local) */
function wedge(len: number, wid: number, ht: number): THREE.BufferGeometry {
  const L = len / 2, W = wid / 2;
  const p: number[] = [], uv: number[] = [];
  const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) => {
    // wound counter-clockwise seen from outside
    p.push(...a, ...c, ...b);
    uv.push(...ua, ...uc, ...ub);
  };
  const lowL = [-W, 0, -L], lowR = [W, 0, -L], topL = [-W, ht, L], topR = [W, ht, L], botL = [-W, 0, L], botR = [W, 0, L];
  // the slope (uv v=1 at the lip)
  tri(lowL, lowR, topR, [0, 0], [1, 0], [1, 1]);
  tri(lowL, topR, topL, [0, 0], [1, 1], [0, 1]);
  // the back and the sides (uv in the plain part of the texture)
  const g = [0.5, 0.5];
  tri(botR, botL, topL, g, g, g);
  tri(botR, topL, topR, g, g, g);
  tri(lowR, botR, topR, g, g, g);
  tri(lowL, topL, botL, g, g, g);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

interface Jump {
  r: Ramp;
  i: number;
  x: number;
  z: number;
  peak: number;
  t: number;
}

export class Stunts {
  readonly list = ramps;
  done = new Set<number>();
  best: number[] = [];
  private jump: Jump | null = null;
  private onRamp = -1;
  private onRampT = 0;
  private marks: THREE.Mesh[] = [];
  private markMat = [new THREE.MeshBasicMaterial({ color: 0xffb020 }), new THREE.MeshBasicMaterial({ color: 0x5dff8a })];

  constructor(private game: Game) {
    this.place();
    const tex = hazardTex();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.55 });
    const geo = wedge(LEN, WID, HT);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, metalness: 0.6 });
    ramps.forEach((r, i) => {
      const m = new THREE.Mesh(r.len === LEN ? geo : wedge(r.len, r.wid, r.ht), mat);
      m.position.set(r.x, r.y0, r.z);
      m.rotation.y = r.h;
      m.castShadow = true;
      m.receiveShadow = true;
      game.scene.add(m);
      // a small marker on a post beside the lip: amber until you've landed this one
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), this.markMat[0]);
      const sx = Math.cos(r.h), sz = -Math.sin(r.h);
      mk.position.set(r.x + Math.sin(r.h) * (r.len / 2 - 0.5) + sx * (r.wid / 2 + 0.6), r.y0 + r.ht + 0.9, r.z + Math.cos(r.h) * (r.len / 2 - 0.5) + sz * (r.wid / 2 + 0.6));
      game.scene.add(mk);
      this.marks.push(mk);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, r.ht + 0.6, 6), postMat);
      post.position.set(mk.position.x, r.y0 + (r.ht + 0.6) / 2, mk.position.z);
      post.castShadow = true;
      game.scene.add(post);
      this.best.push(0);
    });
  }

  /** the ramps: after intersections on the grid roads, on the sand, on swamp banks across a pond */
  private place() {
    if (ramps.length) return;
    const rng = new Rng(7311);
    const flat = (x0: number, z0: number, dx: number, dz: number, n: number) => {
      const y = groundBase(x0, z0);
      for (let k = 0; k <= n; k += 4) {
        const x = x0 + dx * k, z = z0 + dz * k;
        if (isWater(x, z) || Math.abs(groundBase(x, z) - y) > 0.25) return false;
      }
      return true;
    };
    const add = (x: number, z: number, h: number, target: number, len = LEN, wid = WID, ht = HT) =>
      ramps.push({ x, z, h, len, wid, ht, y0: groundBase(x, z), target, rr: Math.hypot(len, wid) / 2 + 0.5 });
    // roads: the ramp starts 10 m past an intersection, the rest of the block is the landing
    let tries = 0;
    const want = 7;
    while (ramps.length < want && tries++ < 200) {
      const alongX = rng.chance(0.5);
      if (alongX) {
        const i = Math.floor(rng.next() * (XS.length - 1)), z = ZS[Math.floor(rng.next() * ZS.length)];
        const dir = rng.chance(0.5) ? 1 : -1;
        const a = dir > 0 ? XS[i] : XS[i + 1], b = dir > 0 ? XS[i + 1] : XS[i];
        if (Math.abs(b - a) < 70 || Math.min(a, b) < -470) continue;
        const x = a + dir * (ROAD_HALF + 4 + LEN / 2);
        if (!flat(x, z, dir, 0, Math.abs(b - a) - 22) || ramps.some((r) => Math.hypot(r.x - x, r.z - z) < 160)) continue;
        add(x, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 28);
      } else {
        const j = Math.floor(rng.next() * (ZS.length - 1)), x = XS[Math.floor(rng.next() * XS.length)];
        const dir = rng.chance(0.5) ? 1 : -1;
        const a = dir > 0 ? ZS[j] : ZS[j + 1], b = dir > 0 ? ZS[j + 1] : ZS[j];
        if (Math.abs(b - a) < 70 || x < -470) continue;
        const z = a + dir * (ROAD_HALF + 4 + LEN / 2);
        if (!flat(x, z, 0, dir, Math.abs(b - a) - 22) || ramps.some((r) => Math.hypot(r.x - x, r.z - z) < 160)) continue;
        add(x, z, dir > 0 ? 0 : Math.PI, 28);
      }
    }
    // the beach: two ramps on the sand, running along the shore
    const bx = (BEACH.x0 + ISLAND.x1) / 2 + 30;
    for (const [z, h] of [[-120, 0], [260, Math.PI]] as [number, number][]) if (!isWater(bx, z)) add(bx, z, h, 30);
    // the swamp: clear a pond
    const ponds = this.game.map.flats.filter((f) => f.kind === 'pond' && f.w > 18 && f.w < 34 && f.d < 40);
    let n = 0;
    for (const f of ponds) {
      if (n >= 2) break;
      if (ramps.some((r) => Math.hypot(r.x - f.x, r.z - f.z) < 200)) continue;
      // approach from the east (from the city), jumping west across the pond
      const x = f.x + f.w / 2 + 3 + LEN / 2;
      if (!flat(x + LEN / 2, f.z, 1, 0, 30) || isWater(x, f.z)) continue;
      add(x, f.z, -Math.PI / 2, f.w + 4, LEN, WID, HT * 1.1);
      n++;
    }
  }

  get blips(): Blip[] {
    return ramps.map((r, i) => ({ x: r.x, z: r.z, color: this.done.has(i) ? '#5dff8a' : '#ffb020', label: 'Jump', kind: 'dest' as const })).filter((_, i) => !this.done.has(i));
  }

  private rampUnder(v: Vehicle): number {
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      const dx = v.pos.x - r.x, dz = v.pos.z - r.z;
      if (Math.abs(dx) > r.rr || Math.abs(dz) > r.rr) continue;
      const s = dx * Math.sin(r.h) + dz * Math.cos(r.h), q = dx * Math.cos(r.h) - dz * Math.sin(r.h);
      if (Math.abs(q) <= r.wid / 2 && s > 0 && s <= r.len / 2 + 0.5) return i;
    }
    return -1;
  }

  update(dt: number, realDt: number) {
    const g = this.game;
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      m.rotation.y += dt * 1.5;
      m.material = this.markMat[this.done.has(i) ? 1 : 0];
    }
    const v = g.player.vehicle;
    if (!v || v.isBoat || v.type === 'airboat' || v.wrecked) {
      this.end(false);
      return;
    }
    if (!this.jump) {
      if (!v.airborne) {
        const i = this.rampUnder(v);
        if (i >= 0) {
          this.onRamp = i;
          this.onRampT = 0;
        } else this.onRampT += dt;
        return;
      }
      // just left a ramp's lip, fast and pointing the right way
      const r = ramps[this.onRamp];
      if (this.onRamp >= 0 && this.onRampT < 0.25 && r && v.forwardSpeed > 15 && Math.abs(wrapAngle(v.heading - r.h)) < 0.6) {
        this.jump = { r, i: this.onRamp, x: v.pos.x, z: v.pos.z, peak: v.pos.y, t: 0 };
        g.slowmo = 1.4;
        g.audio.whoosh();
      }
      this.onRamp = -1;
      return;
    }
    const j = this.jump;
    j.t += realDt;
    j.peak = Math.max(j.peak, v.pos.y);
    if (v.airborne && j.t < 6) {
      g.slowmo = Math.max(g.slowmo, j.t < 1.6 ? 0.2 : 0);
      return;
    }
    this.end(true);
  }

  private end(landed: boolean) {
    const j = this.jump;
    this.jump = null;
    this.onRamp = -1;
    if (!j) return;
    const g = this.game;
    g.slowmo = 0;
    const v = g.player.vehicle;
    if (!landed || !v || v.wrecked || v.sinking) {
      g.hud.toast('Stunt jump failed');
      return;
    }
    const d = Math.round(Math.hypot(v.pos.x - j.x, v.pos.z - j.z));
    const ok = d >= j.r.target;
    this.best[j.i] = Math.max(this.best[j.i], d);
    if (!ok) {
      g.hud.toast(`Stunt jump: ${d} m · needs ${j.r.target} m`);
      return;
    }
    if (!this.done.has(j.i)) {
      this.done.add(j.i);
      g.addCash(500);
      g.audio.cue('pass');
      g.hud.bigMessage('STUNT JUMP', `${d} m · ${this.done.size}/${ramps.length} · +$500`, '#ffcf4a');
    } else g.hud.toast(`Stunt jump · ${d} m (best ${this.best[j.i]} m)`);
  }
}


