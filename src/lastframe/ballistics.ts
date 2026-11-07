import { exitOf, type Box, type World } from './collide.ts';
import { hitBody, type Body } from './hitbox.ts';
import type { WeaponSpec } from './shared.ts';

export function surfOf(b: Box): string {
  if (b.tag === 'glass') return 'glass';
  if (b.tag === 'door' || b.tag === 'counter' || /planks|pallet|wood/.test(b.mat)) return 'wood';
  if (/steel|tin|cont_|rack|dumpster|grate/.test(b.mat) || b.tag === 'post' || b.tag === 'container') return 'metal';
  if (b.pen) return 'plaster';
  return 'stone';
}

/** how much a metre of each thing takes out of a round, before the weapon's own punch */
const STOP: Record<string, number> = { wood: 3.2, plaster: 3.2, metal: 15, glass: 0.4, card: 1.1, stone: 60 };

export interface Tracer {
  /** x y z nx ny nz per impact */
  e: number[];
  surf: string[];
  hits: { slot: number; zone: number; k: number; dist: number; at: [number, number, number] }[];
  panes: number[];
  /** where each pane was hit */
  paneAt?: [number, number, number][];
}

/**
 * One round. It goes through what it has the energy for, pays for the thickness it crosses, leaves a
 * hole on both sides, and at a shallow angle off something hard it skips on, tumbling, with half its
 * energy. Surfaces starting with ~ are the skip: the next point is where it went.
 */
export function trace(w: World, bodies: Iterable<[number, Body]>, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, spec: WeaponSpec, me: number, out: Tracer) {
  let x = ox, y = oy, z = oz, k = 1, gone = 0, skipped = false;
  for (let seg = 0; seg < 5; seg++) {
    const max = 260 - gone;
    const h = w.ray(x, y, z, dx, dy, dz, max);
    const lim = h ? h.t : max;
    let bt = lim, slot = -1, zone = 0;
    for (const [s, b] of bodies) {
      if (s === me) continue;
      const r = hitBody(x, y, z, dx, dy, dz, b, bt);
      if (r && r.t < bt) {
        bt = r.t;
        slot = s;
        zone = r.zone;
      }
    }
    if (slot >= 0) {
      const dist = gone + bt;
      const px = x + dx * bt, py = y + dy * bt, pz = z + dz * bt;
      const fall = dist < spec.range ? 1 : Math.max(spec.falloff, 1 - ((dist - spec.range) / spec.range) * (1 - spec.falloff));
      out.hits.push({ slot, zone, k: k * fall, dist, at: [px, py, pz] });
      out.e.push(px, py, pz, -dx, -dy, -dz);
      out.surf.push('flesh');
      return;
    }
    if (!h) {
      out.e.push(x + dx * lim, y + dy * lim, z + dz * lim, 0, 0, 0);
      out.surf.push('');
      return;
    }
    const px = x + dx * h.t, py = y + dy * h.t, pz = z + dz * h.t;
    const s = surfOf(h.box);
    const cos = -(dx * h.nx + dy * h.ny + dz * h.nz);
    // a graze off something hard
    if (!skipped && cos < 0.3 && cos > 0.02 && (s === 'stone' || s === 'metal') && !h.box.pen) {
      skipped = true;
      out.e.push(px, py, pz, h.nx, h.ny, h.nz);
      out.surf.push('~' + s);
      k *= 0.5;
      const n = 2 * cos;
      dx += h.nx * n + (Math.random() - 0.5) * 0.14;
      dy += h.ny * n + (Math.random() - 0.5) * 0.14 + 0.03;
      dz += h.nz * n + (Math.random() - 0.5) * 0.14;
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      gone += h.t;
      x = px + h.nx * 0.01;
      y = py + h.ny * 0.01;
      z = pz + h.nz * 0.01;
      continue;
    }
    out.e.push(px, py, pz, h.nx, h.ny, h.nz);
    out.surf.push(s);
    if (s === 'glass' && h.box.id !== undefined) {
      out.panes.push(h.box.id);
      (out.paneAt ??= []).push([px, py, pz]);
      h.box.off = true;
      k *= 0.92;
      gone += h.t + 0.02;
      x = px + dx * 0.02;
      y = py + dy * 0.02;
      z = pz + dz * 0.02;
      continue;
    }
    if (!h.box.pen || spec.pen <= 0) return;
    // through it, if it has enough left for the thickness at this angle
    const thick = Math.min(1.6, exitOf(h.box, px, py, pz, dx, dy, dz));
    const cost = (thick * (STOP[h.box.tag === 'prop' || h.box.tag === 'inv' ? 'card' : s] ?? 3)) / spec.pen;
    k -= cost;
    if (k <= 0.04) return;
    const t = thick + 0.015;
    gone += h.t + t;
    x = px + dx * t;
    y = py + dy * t;
    z = pz + dz * t;
    // the far side: a smaller puff, torn outward
    out.e.push(x, y, z, dx, dy, dz);
    out.surf.push(s);
  }
}
