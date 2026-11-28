// Suburban frontages: what turns a stucco box into a house from the street - a front door on a
// step (half of them under a little porch canopy on posts), a paved path out to the sidewalk, a
// concrete driveway beside the house where the car parks (some under a carport), a mailbox at the
// curb, a white picket fence along some fronts and an AC unit on the side wall. Merged per band
// along z so each band frustum-culls; nothing collides (all low or slim).
import * as THREE from 'three';
import { box, merge } from '../core/geo';
import { groundBase, type CityMap } from './map';

const DOORS = [0x6b4a32, 0x2f4f6f, 0x8a2e2e, 0x2e5d4b, 0xf2efe6, 0x3a3a3a];

const CELL = 120;

export function buildHouseFronts(scene: THREE.Scene, map: CityMap) {
  const cells = new Map<string, { x: number; z: number; list: THREE.BufferGeometry[] }>();
  // each house's wall height, from its building (the houses list only has the footprint)
  const wallH = new Map<string, number>();
  for (const b of map.buildings) if (b.style === 2 && b.y0 === 0) wallH.set(Math.round(b.x * 10) + ',' + Math.round(b.z * 10), b.h);
  for (const h of map.houses) {
    const cx = Math.floor(h.x / CELL), cz = Math.floor(h.z / CELL), key = cx + ',' + cz;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, list: [] }));
    const out = cell.list;
    const y0 = groundBase(h.x, h.z);
    let r = h.seed * 9973;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647) % 1;
    rnd();
    // a box in house space: 'al' along the street, 'up', 'o' out from the front wall toward the street
    const hb = (al: number, up: number, o: number, w: number, hh: number, d: number, c: number, paved = false) => {
      const x = h.x + h.ax * al + h.nx * o, z = h.z + h.az * al + h.nz * o;
      out.push(h.ax ? box(w, hh, d, x, y0 + up, z, c) : box(d, hh, w, x, y0 + up, z, c));
      if (paved) {
        const sx = (h.ax ? w : d) / 2, sz = (h.ax ? d : w) / 2;
        map.paved.push({ x0: x - sx, z0: z - sz, x1: x + sx, z1: z + sz });
      }
    };
    const front = h.hd;
    const setback = 6;
    // centred between the two front windows (the facade shader puts them 1.08-2.52 m either side of the
    // middle): anywhere else the door, its frame or a porch post stood in front of the glass
    const doorAl = (rnd() - 0.5) * 0.12;
    // door, frame and step
    hb(doorAl, 1.08, front + 0.05, 1.0, 2.1, 0.1, DOORS[Math.floor(rnd() * DOORS.length)]);
    hb(doorAl, 1.15, front + 0.03, 1.25, 2.3, 0.06, 0xf4f1ea);
    hb(doorAl, 0.08, front + 0.7, 2.0, 0.16, 1.4, 0xcfc9bd);
    // a porch canopy on two posts
    if (rnd() < 0.5) {
      hb(doorAl, 2.62, front + 0.85, 1.6, 0.14, 1.8, 0xf4f1ea);
      for (const s of [-1, 1]) hb(doorAl + s * 0.62, 1.3, front + 1.65, 0.12, 2.6, 0.12, 0xf4f1ea);
    }
    // a paved path to the sidewalk
    hb(doorAl, 0.025, front + (setback + 1.4) / 2, 1.2, 0.05, setback - 1.4, 0xd8d2c6, true);
    // driveway beside the house, maybe under a carport
    const dAl = h.hw + 2.2;
    if (h.drive) {
      hb(dAl, 0.03, front - h.hd + (setback + 2 * h.hd) / 2 - 0.5, 3.4, 0.06, setback + 2 * h.hd - 1, 0xbdb8ae, true);
      if (rnd() < 0.4) {
        hb(dAl, 2.5, front - 1.5, 3.8, 0.12, 6.5, 0xf4f1ea);
        for (const sa of [-1.75, 1.75]) for (const so of [-4.5, 1.5]) hb(dAl + sa, 1.25, front + so, 0.12, 2.5, 0.12, 0xf4f1ea);
      }
    }
    // mailbox at the curb, by the driveway (or the path)
    const mAl = h.drive ? dAl - 2.1 : doorAl + 1.0;
    hb(mAl, 0.55, front + setback - 0.4, 0.08, 1.1, 0.08, 0x3a3a3a);
    hb(mAl, 1.15, front + setback - 0.4, 0.22, 0.22, 0.42, rnd() < 0.5 ? 0x2a2a2a : 0xf2efe6);
    // a white picket fence along the front, with gaps for the path and the drive
    if (rnd() < 0.35) {
      const fo = front + setback - 1.0;
      const segs: [number, number][] = [[-h.hw - 0.5, doorAl - 0.8], [doorAl + 0.8, h.drive ? dAl - 1.9 : h.hw + 0.5]];
      for (const [a, b] of segs) {
        if (b - a < 0.5) continue;
        // a low board fence: one panel, a cap rail and posts (not one box a picket - that was ~40k boxes)
        hb((a + b) / 2, 0.42, fo, b - a, 0.62, 0.03, 0xf7f5f0);
        hb((a + b) / 2, 0.76, fo, b - a, 0.05, 0.07, 0xf7f5f0);
        for (let p = a; p <= b + 0.01; p += Math.max(1.2, (b - a) / Math.ceil((b - a) / 1.6))) hb(p, 0.45, fo, 0.09, 0.9, 0.09, 0xf7f5f0);
      }
    }
    // gutters under the front and back eaves, a downpipe at each end of them
    const H = wallH.get(Math.round(h.x * 10) + ',' + Math.round(h.z * 10));
    if (H) {
      const gc = rnd() < 0.6 ? 0xf2f0ea : 0x8b8f92;
      for (const s of [-1, 1]) {
        hb(0, H - 0.07, s * (front + 0.47), 2 * h.hw + 0.62, 0.12, 0.12, gc);
        for (const e of [-1, 1]) hb(e * (h.hw - 0.12), (H - 0.1) / 2, s * (front + 0.06), 0.07, H - 0.1, 0.07, gc);
      }
    }
    // an AC unit against the side wall away from the drive
    hb(-h.hw - 0.4, 0.45, -h.hd * 0.3, 0.7, 0.8, 0.8, 0xc9ccce);
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const chunks: { m: THREE.Mesh; x: number; z: number }[] = [];
  for (const c of cells.values()) {
    const m = new THREE.Mesh(merge(c.list), mat);
    chunks.push({ m, x: c.x, z: c.z });
    m.name = "houseFronts";
    // no shadow-pass cost for all this; AO grounds it
    m.castShadow = false;
    m.receiveShadow = true;
    scene.add(m);
  }
  /** small stuff: each 120 m cell only within 240 m of the camera */
  return {
    update(cam: THREE.Vector3) {
      for (const c of chunks) c.m.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < 240 + CELL * 0.7;
    },
  };
}
