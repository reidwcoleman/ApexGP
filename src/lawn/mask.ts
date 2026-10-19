/**
 * The mowing mask: a texture the size of the lawn (20 cells a metre) that the mower paints.
 *   R  how tall the grass still is (255 uncut, 0 cut), eased down over a tenth of a second
 *   G  the stripe tone of what has been cut (the direction it was driven, seen from the camera)
 * and a CPU copy of the state to count progress, find flowers and coins' ground, and drive the
 * finishing ripple. Only the rows the mower touched are re-uploaded.
 */
import * as THREE from 'three';
import type { LevelDef } from './levels.ts';
import { TS } from './nav.ts';
import { lerp } from './util.ts';

export const CPU = 20;

export class MaskField {
  readonly gw: number;
  readonly gh: number;
  readonly W: number;
  readonly H: number;
  /** 0 tall, 1 being cut, 2 cut, 3 never needed (under something, or beyond the deck's reach) */
  readonly state: Uint8Array;
  /** 1 where something stands: no grass grows there at all */
  readonly solid: Uint8Array;
  private readonly hgt: Uint8Array;
  readonly data: Uint8Array;
  readonly tex: THREE.DataTexture;
  total = 0;
  done = 0;
  private active: number[] = [];
  private d = { i0: 1e9, i1: -1, j0: 1e9, j1: -1, full: true };
  private last: { x: number; z: number; h: number } | null = null;
  // the finishing ripple
  finishing = false;
  finished = false;
  private finishList: number[] = [];
  private finishPtr = 0;
  private finishR = 0;
  private finishOrigin = { x: 0, z: 0 };
  private finishDelay = 0;

  constructor(readonly level: LevelDef) {
    this.W = level.w * TS;
    this.H = level.h * TS;
    this.gw = Math.ceil(this.W * CPU);
    this.gh = Math.ceil(this.H * CPU);
    const n = this.gw * this.gh;
    this.state = new Uint8Array(n);
    this.solid = new Uint8Array(n);
    this.hgt = new Uint8Array(n);
    this.data = new Uint8Array(n * 4);
    const nav = level.nav;
    // what is standing where
    for (const s of nav.shapes) {
      let x0: number, x1: number, z0: number, z1: number;
      if (s.t === 0) {
        x0 = s.x - s.r; x1 = s.x + s.r; z0 = s.z - s.r; z1 = s.z + s.r;
      } else {
        x0 = s.x0; x1 = s.x1; z0 = s.z0; z1 = s.z1;
      }
      const i0 = Math.max(0, Math.floor((x0 + this.W / 2) * CPU) - 1);
      const i1 = Math.min(this.gw - 1, Math.ceil((x1 + this.W / 2) * CPU) + 1);
      const j0 = Math.max(0, Math.floor((z0 + this.H / 2) * CPU) - 1);
      const j1 = Math.min(this.gh - 1, Math.ceil((z1 + this.H / 2) * CPU) + 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) / CPU - this.W / 2;
          const z = (j + 0.5) / CPU - this.H / 2;
          const inside = s.t === 0 ? Math.hypot(x - s.x, z - s.z) < s.r + 0.03 : x > s.x0 - 0.03 && x < s.x1 + 0.03 && z > s.z0 - 0.03 && z < s.z1 + 0.03;
          if (inside) this.solid[j * this.gw + i] = 1;
        }
      }
    }
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const k = j * this.gw + i;
        const x = (i + 0.5) / CPU - this.W / 2;
        const z = (j + 0.5) / CPU - this.H / 2;
        const st = nav.playable(x, z) && !this.solid[k] && nav.coverable(x, z) ? 0 : 3;
        this.state[k] = st;
        this.hgt[k] = st === 0 ? 255 : 0;
        this.data[k * 4] = st === 0 ? 255 : 0;
        this.data[k * 4 + 1] = 118;
        this.data[k * 4 + 3] = 255;
        if (st === 0) this.total++;
      }
    }
    // soften the edge of the grass that is never cut (round rocks and trees, the strip by the fence): the
    // pre-cleared region comes from a coarser grid, so a blurred height reads as trimmed, not stair-stepped
    this.softenEdges(this.gw, this.gh);
    this.tex = new THREE.DataTexture(this.data, this.gw, this.gh, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
  }

  private softenEdges(gw: number, gh: number) {
    const R = 5;
    const a = new Float32Array(gw * gh);
    const b = new Float32Array(gw * gh);
    for (let k = 0; k < a.length; k++) a[k] = this.data[k * 4];
    const norm = 1 / (2 * R + 1);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < gh; j++) {
        let sum = 0;
        const row = j * gw;
        for (let i = -R; i <= R; i++) sum += a[row + Math.min(gw - 1, Math.max(0, i))];
        for (let i = 0; i < gw; i++) {
          b[row + i] = sum * norm;
          sum += a[row + Math.min(gw - 1, i + R + 1)] - a[row + Math.max(0, i - R)];
        }
      }
      for (let i = 0; i < gw; i++) {
        let sum = 0;
        for (let j = -R; j <= R; j++) sum += b[Math.min(gh - 1, Math.max(0, j)) * gw + i];
        for (let j = 0; j < gh; j++) {
          a[j * gw + i] = sum * norm;
          sum += b[Math.min(gh - 1, j + R + 1) * gw + i] - b[Math.max(0, j - R) * gw + i];
        }
      }
    }
    for (let k = 0; k < a.length; k++) {
      this.data[k * 4] = Math.round(a[k]);
    }
  }

  get progress() {
    return this.total ? this.done / this.total : 1;
  }

  index(x: number, z: number) {
    const i = Math.floor((x + this.W / 2) * CPU);
    const j = Math.floor((z + this.H / 2) * CPU);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return -1;
    return j * this.gw + i;
  }
  /** is the grass here still long? */
  uncutAt(x: number, z: number) {
    const k = this.index(x, z);
    return k >= 0 && this.state[k] === 0;
  }
  cellPos(k: number, out: { x: number; z: number }) {
    out.x = ((k % this.gw) + 0.5) / CPU - this.W / 2;
    out.z = (((k / this.gw) | 0) + 0.5) / CPU - this.H / 2;
    return out;
  }

  private mark(i: number, j: number) {
    const d = this.d;
    if (i < d.i0) d.i0 = i;
    if (i > d.i1) d.i1 = i;
    if (j < d.j0) d.j0 = j;
    if (j > d.j1) d.j1 = j;
  }

  private stampRect(x: number, z: number, hd: number, halfW: number, halfL: number, tone: number, newCells: number[]) {
    const fx = Math.sin(hd);
    const fz = Math.cos(hd);
    const rx = Math.cos(hd);
    const rz = -Math.sin(hd);
    const ex = halfW * Math.abs(rx) + halfL * Math.abs(fx);
    const ez = halfW * Math.abs(rz) + halfL * Math.abs(fz);
    const i0 = Math.max(0, Math.floor((x - ex + this.W / 2) * CPU));
    const i1 = Math.min(this.gw - 1, Math.floor((x + ex + this.W / 2) * CPU));
    const j0 = Math.max(0, Math.floor((z - ez + this.H / 2) * CPU));
    const j1 = Math.min(this.gh - 1, Math.floor((z + ez + this.H / 2) * CPU));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.gw + i;
        const st = this.state[k];
        if (st === 3) continue;
        const dx = (i + 0.5) / CPU - this.W / 2 - x;
        const dz = (j + 0.5) / CPU - this.H / 2 - z;
        const u = dx * rx + dz * rz;
        const v = dx * fx + dz * fz;
        if (u > halfW || u < -halfW || v > halfL || v < -halfL) continue;
        this.data[k * 4 + 1] = tone;
        this.mark(i, j);
        if (st === 0) {
          this.state[k] = 1;
          this.active.push(k);
          this.done++;
          newCells.push(k);
        }
      }
    }
  }

  /** Sweep the deck from where it was last frame to here. */
  cut(x: number, z: number, h: number, width: number, tone: number, newCells: number[]) {
    const cur = { x, z, h };
    const prev = this.last ?? cur;
    const dist = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    const steps = Math.max(1, Math.ceil(dist / 0.06));
    const dh = Math.atan2(Math.sin(cur.h - prev.h), Math.cos(cur.h - prev.h));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      this.stampRect(lerp(prev.x, cur.x, t), lerp(prev.z, cur.z, t), prev.h + dh * t, width / 2, 0.16, tone, newCells);
    }
    this.last = cur;
  }
  idleSweep() {
    this.last = null;
  }

  startFinish(x: number, z: number) {
    if (this.finishing) return;
    this.finishing = true;
    this.finishOrigin = { x, z };
    const p = { x: 0, z: 0 };
    const list: { k: number; d: number }[] = [];
    for (let k = 0; k < this.state.length; k++) {
      if (this.state[k] !== 0) continue;
      this.cellPos(k, p);
      list.push({ k, d: Math.hypot(p.x - x, p.z - z) });
    }
    list.sort((a, b) => a.d - b.d);
    this.finishList = list.map((e) => e.k);
    this.finishPtr = 0;
    this.finishR = 0;
    this.finishDelay = 0.25;
  }

  /** Advance the fold-down animations and the finishing ripple; push the changed rows to the GPU. */
  update(dt: number, newCells: number[]): boolean {
    let justFinished = false;
    if (this.finishing && !this.finished) {
      if (this.finishDelay > 0) this.finishDelay -= dt;
      else {
        this.finishR += dt * 9;
        const p = { x: 0, z: 0 };
        let n = 0;
        while (this.finishPtr < this.finishList.length) {
          const k = this.finishList[this.finishPtr];
          this.cellPos(k, p);
          if (Math.hypot(p.x - this.finishOrigin.x, p.z - this.finishOrigin.z) > this.finishR) break;
          this.finishPtr++;
          if (this.state[k] !== 0) continue;
          this.state[k] = 1;
          this.active.push(k);
          this.done++;
          // the classic mowing stripes, a metre wide
          this.data[k * 4 + 1] = (Math.floor((p.z + this.H / 2) / 1.0) & 1) * 255;
          this.d.full = true;
          if (n++ < 60) newCells.push(k);
        }
        if (this.finishPtr >= this.finishList.length && this.active.length === 0) {
          this.finished = true;
          justFinished = true;
        }
      }
    }
    // grass folds down over a tenth of a second
    if (this.active.length) {
      const step = Math.max(1, Math.round(dt * 9 * 255));
      for (let a = this.active.length - 1; a >= 0; a--) {
        const k = this.active[a];
        let v = this.hgt[k] - step;
        if (v <= 0) {
          v = 0;
          this.state[k] = 2;
          this.active[a] = this.active[this.active.length - 1];
          this.active.pop();
        }
        this.hgt[k] = v;
        const f = v / 255;
        this.data[k * 4] = Math.min(this.data[k * 4], Math.round(f * f * 255));
        if (!this.d.full) this.mark(k % this.gw, (k / this.gw) | 0);
      }
    }
    this.upload();
    return justFinished;
  }

  private upload() {
    const d = this.d;
    if (!d.full && d.i1 < 0) return;
    const t = this.tex;
    if (!d.full) {
      // a texSubImage2D per row of the dirty rectangle
      for (let j = d.j0; j <= d.j1; j++) t.addUpdateRange((j * this.gw + d.i0) * 4, (d.i1 - d.i0 + 1) * 4);
    }
    t.needsUpdate = true;
    d.i0 = d.j0 = 1e9;
    d.i1 = d.j1 = -1;
    d.full = false;
  }

  /** The nearest long grass to a point (sampled coarsely), preferring what is ahead of `heading`. */
  nearestUncut(x: number, z: number, heading?: number): { x: number; z: number } | null {
    let best = 1e9;
    let bk = -1;
    const step = 6;
    const fx = heading === undefined ? 0 : Math.sin(heading);
    const fz = heading === undefined ? 0 : Math.cos(heading);
    const p = { x: 0, z: 0 };
    for (let j = 0; j < this.gh; j += step) {
      for (let i = 0; i < this.gw; i += step) {
        const k = j * this.gw + i;
        if (this.state[k] !== 0) continue;
        this.cellPos(k, p);
        const dx = p.x - x;
        const dz = p.z - z;
        let d = Math.hypot(dx, dz);
        if (heading !== undefined && d > 0.01) d *= 1 + 0.9 * (1 - (dx * fx + dz * fz) / d);
        if (d < best) {
          best = d;
          bk = k;
        }
      }
    }
    if (bk < 0) return null;
    return this.cellPos(bk, p);
  }

  dispose() {
    this.tex.dispose();
  }
}
