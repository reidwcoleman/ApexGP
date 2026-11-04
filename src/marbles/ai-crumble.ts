import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { CRUMBLE } from './course-crumble.ts';
import { dodge } from './course-strikes.ts';

/**
 * A bot on Cookie Crumble. Standing still is falling, so it always has a tile it is heading for:
 * one still whole, a few metres off, with plenty of whole tiles round it (room to go on from
 * there), not too near the edge and not where the others are. It picks again when that tile is
 * touched or reached; it hops a hole in its way. A weaker bot looks less far ahead, thinks more
 * slowly and now and then dithers.
 */
const NB: number[] = [];
const CAND: number[] = [];

export class CrumbleBrain {
  private target = -1;
  private nextThink = 0;
  private dither = 0;
  private pace: number;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {
    this.pace = 0.36 + 0.18 * rnd();
  }

  update(_dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    const A = c.crumble!;
    const L = A.layerAt(m.pos.y);
    if (L < 0) return;
    // (Meltdown: out from under a snowball, if it's seen it)
    if (A.shots) {
      const out = dodge(A.shots, m, t - c.state.go, 0.75 - 0.55 * this.skill);
      if (out) {
        m.input.set(out[0], 0, out[1]).multiplyScalar(0.85);
        return;
      }
    }
    const ly = A.layers[L];
    const tiles = A.tiles;
    const reached = this.target >= 0 && Math.hypot(tiles[this.target].x - m.pos.x, tiles[this.target].z - m.pos.z) < 0.9;
    const lost = this.target >= 0 && (tiles[this.target].L !== L || !A.intact(this.target));
    if (t >= this.nextThink || reached || lost || this.target < 0) {
      this.nextThink = t + 0.35 + (1 - this.skill) * 0.5 + this.rnd() * 0.2;
      this.target = this.pick(c, L, all);
      if (this.rnd() < (1 - this.skill) * 0.08) this.dither = t + 0.3 + this.rnd() * 0.4;
    }
    if (this.target < 0 || t < this.dither) {
      m.input.set(0, 0, 0);
      return;
    }
    const tg = tiles[this.target];
    const dx = tg.x - m.pos.x, dz = tg.z - m.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // (no hurry: a bean that runs flat out eats its own floor)
    m.input.set(dx / d, 0, dz / d).multiplyScalar(d < 1.2 ? 0.45 : this.pace);
    // tile to tile in hops (a hop only touches where it lands: the floor lasts longer)
    if (A.mode === 'step' && m.grounded && d > 2.2 && d < 4.6 && this.rnd() < 0.05 + 0.2 * this.skill) {
      m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 5));
      m.jump = true;
      return;
    }
    // a hole just ahead (or the tile underfoot about to go, and the next one gone): hop it
    if (m.grounded && d > 1.6) {
      const ax = m.pos.x + (dx / d) * 1.5, az = m.pos.z + (dz / d) * 1.5;
      let ahead = false;
      NB.length = 0;
      for (const i of A.around(ax, az, 1.5, NB)) {
        if (tiles[i].L !== L || !A.solid(i, t + 0.15)) continue;
        if (Math.hypot(tiles[i].x - ax, tiles[i].z - az) < CRUMBLE.tile + 0.1) {
          ahead = true;
          break;
        }
      }
      if (!ahead && this.rnd() < 0.55 + 0.45 * this.skill) m.jump = true;
    }
  }

  /** the best whole tile within reach on this floor (-1: none left) */
  private pick(c: Course, L: number, all: Marble[]) {
    const m = this.m;
    const A = c.crumble!;
    const ly = A.layers[L];
    const tiles = A.tiles;
    const reach = 4.5 + this.skill * 3.5;
    let best = -1, bs = -1e9;
    CAND.length = 0;
    for (const i of A.around(m.pos.x, m.pos.z, reach, CAND)) {
      if (tiles[i].L !== L || !A.intact(i)) continue;
      const tl = tiles[i];
      const d = Math.hypot(tl.x - m.pos.x, tl.z - m.pos.z);
      if (d > reach || (d < 1.4 && A.mode === 'step')) continue;
      // room to go on: whole tiles round it
      let room = 0;
      NB.length = 0;
      for (const j of A.around(tl.x, tl.z, CRUMBLE.sp * 1.6, NB)) if (j !== i && tiles[j].L === L && A.intact(j) && Math.hypot(tiles[j].x - tl.x, tiles[j].z - tl.z) < CRUMBLE.sp * 1.6) room++;
      let crowd = 0;
      for (const o of all) {
        if (o === m || !o.active) continue;
        const od = Math.hypot(o.pos.x - tl.x, o.pos.z - tl.z);
        if (od < 2.4 && Math.abs(o.pos.y - m.pos.y) < 2) crowd += (2.4 - od) / 2.4;
      }
      // (Meltdown: the edge is where the melt has got to, and it keeps coming)
      const edge = Math.max(0, Math.hypot(tl.x - A.center.x, tl.z - A.center.z) - (Math.min(ly.r, A.rNow) - (A.mode === 'melt' ? 3.5 : 3))) * (A.mode === 'melt' ? 3 : 1);
      const sc = room * 0.7 * (0.5 + this.skill) - Math.abs(d - 3.2) * 0.4 - crowd * 2.2 - edge * 1.2 + this.rnd() * (1.5 - this.skill);
      if (sc > bs) (bs = sc), (best = i);
    }
    if (best < 0) {
      // nothing close: the nearest whole tile anywhere on the floor
      let bd = 1e9;
      for (let i = ly.i0; i < ly.i1; i++) {
        if (!A.intact(i)) continue;
        const d = Math.hypot(tiles[i].x - m.pos.x, tiles[i].z - m.pos.z);
        if (d < bd && d > 0.8) (bd = d), (best = i);
      }
    }
    return best;
  }
}
