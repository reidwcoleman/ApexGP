import type { Box, World } from './collide.ts';
import { hitBody, type Body } from './hitbox.ts';
import type { WeaponSpec } from './shared.ts';

export function surfOf(b: Box): string {
  if (b.tag === 'glass') return 'glass';
  if (b.tag === 'door' || b.tag === 'counter' || /planks|pallet|wood/.test(b.mat)) return 'wood';
  if (/steel|tin|cont_|rack|dumpster|grate/.test(b.mat) || b.tag === 'post' || b.tag === 'container') return 'metal';
  if (b.pen) return 'plaster';
  return 'stone';
}

export interface Tracer {
  /** x y z nx ny nz per impact */
  e: number[];
  surf: string[];
  hits: { slot: number; zone: number; k: number; dist: number; at: [number, number, number] }[];
  panes: number[];
}

/** one bullet: through what it can go through, into the first body in its way */
export function trace(w: World, bodies: Iterable<[number, Body]>, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, spec: WeaponSpec, me: number, out: Tracer) {
  let x = ox, y = oy, z = oz, k = 1, gone = 0;
  for (let seg = 0; seg < 4; seg++) {
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
    out.e.push(px, py, pz, h.nx, h.ny, h.nz);
    out.surf.push(s);
    if (s === 'glass' && h.box.id !== undefined) {
      out.panes.push(h.box.id);
      h.box.off = true;
    } else if (h.box.pen && spec.pen > 0) k *= spec.pen;
    else return;
    gone += h.t + 0.14;
    x = px + dx * 0.14;
    y = py + dy * 0.14;
    z = pz + dz * 0.14;
  }
}
