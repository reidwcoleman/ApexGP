// Flamingos: forty pink plastic lawn flamingos are hidden around Palmera - tucked against walls
// downtown, in suburban yards, among the harbour crates, out in the swamp, on the island and the
// beach, and three up on helipad roofs. They're not on the map; walk (or drive) into one to collect
// it. Every ten pays out, and all forty is worth a fortune. Saved with the game.
import * as THREE from 'three';
import { Rng } from '../core/math';
import { groundAt, isWater, regionAt, ROAD_HALF, MAIN, ISLAND, type Region } from '../world/map';
import type { Game } from './game';

const QUOTA: [Region, number][] = [['downtown', 9], ['suburb', 8], ['harbor', 5], ['marina', 5], ['swamp', 4], ['island', 3], ['beach', 3]];
const ROOFTOPS = 3;
const REWARD: Record<number, number> = { 10: 2500, 20: 6000, 30: 12000, 40: 30000 };

interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  got: boolean;
  mesh: THREE.Group | null;
}

export class Flamingos {
  spots: Spot[] = [];
  private geo: { body: THREE.BufferGeometry; legs: THREE.BufferGeometry };
  private pink: THREE.MeshStandardMaterial;
  private wire: THREE.MeshStandardMaterial;
  private group = new THREE.Group();

  constructor(private game: Game) {
    this.pink = new THREE.MeshStandardMaterial({ color: 0xff5fa8, roughness: 0.35, emissive: 0xff2f86, emissiveIntensity: 0.12 });
    this.wire = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.4, metalness: 0.7 });
    this.geo = flamingoGeometry();
    this.place();
    game.scene.add(this.group);
  }

  get found() {
    return this.spots.filter((s) => s.got).length;
  }

  /** which ones you have, for saving */
  get state(): number[] {
    return this.spots.flatMap((s, i) => (s.got ? [i] : []));
  }

  restore(got: number[]) {
    for (const i of got) {
      const s = this.spots[i];
      if (!s) continue;
      s.got = true;
      if (s.mesh) this.group.remove(s.mesh);
      s.mesh = null;
    }
  }

  /** the same forty spots every game: seeded, spread out, off the roads, against something */
  private place() {
    const map = this.game.map;
    const rng = new Rng(4040);
    const roadD = (x: number, z: number) => {
      let best = 1e9;
      for (const e of map.edges) {
        const a = map.nodes[e.a], b = map.nodes[e.b];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
      }
      return best;
    };
    const tmp: ReturnType<typeof map.colliders.query> = [];
    const taken = (x: number, z: number) => this.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 70);
    const goal = QUOTA.reduce((t, q) => t + q[1], 0);
    // each district's share, then any land at all for whatever a district couldn't fit
    for (const [want, n] of [...QUOTA, ['any', 0] as const]) {
      let got = 0;
      const need = want === 'any' ? () => this.spots.length < goal : () => got < n;
      for (let k = 0; k < 4000 && need(); k++) {
        const onIsland = want === 'any' ? rng.next() < 0.25 : want === 'island' || want === 'beach';
        const x = onIsland ? rng.range(ISLAND.x0, 790) : rng.range(MAIN.x0, MAIN.x1);
        const z = onIsland ? rng.range(ISLAND.z0, ISLAND.z1) : rng.range(MAIN.z0, MAIN.z1);
        const region = regionAt(x, z);
        if ((want === 'any' ? region === 'ocean' || region === 'bay' : region !== want) || isWater(x, z) || taken(x, z)) continue;
        if (region !== 'beach' && region !== 'island' && roadD(x, z) < ROAD_HALF + 2.5) continue;
        const y = groundAt(x, z);
        // nothing standing on the spot, but something within reach to hide against (not out on the sand)
        tmp.length = 0;
        if (map.colliders.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5, tmp).some((q) => q.y0 < y + 1.5 && q.y1 > y + 0.1)) continue;
        if (region !== 'beach') {
          tmp.length = 0;
          const near = map.colliders.query(x - 3, z - 3, x + 3, z + 3, tmp).filter((q) => q.y0 < y + 1 && q.y1 > y + 0.5);
          if (!near.length) continue;
        }
        this.add(x, y, z, rng.range(0, Math.PI * 2));
        got++;
      }
    }
    // up on the helipad roofs, by the pad
    const pads = [...this.game.city.helipads];
    for (let i = 0; i < ROOFTOPS && pads.length; i++) {
      const b = pads.splice(Math.floor(rng.next() * pads.length), 1)[0];
      const p = this.game.city.padAt.get(b) ?? { x: b.x, z: b.z };
      const x = b.x + (p.x === b.x ? b.w * 0.38 : (b.x - p.x) * 1.4), z = b.z + (p.z === b.z ? b.d * 0.38 : (b.z - p.z) * 1.4);
      this.add(x, b.y0 + b.h, z, rng.range(0, Math.PI * 2));
    }
  }

  private add(x: number, y: number, z: number, yaw: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geo.body, this.pink);
    const legs = new THREE.Mesh(this.geo.legs, this.wire);
    body.castShadow = legs.castShadow = true;
    g.add(body, legs);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);
    this.spots.push({ x, y, z, yaw, got: false, mesh: g });
  }

  update(_dt: number) {
    const g = this.game;
    const p = g.player;
    if (p.dead) return;
    const me = p.vehicle ? p.vehicle.pos : p.pos;
    const reach = p.vehicle ? 2.8 : 1.3;
    for (const s of this.spots) {
      if (s.got || !s.mesh) continue;
      const dx = s.x - me.x, dz = s.z - me.z;
      if (dx > 40 || dx < -40 || dz > 40 || dz < -40) {
        s.mesh.visible = Math.abs(dx) < 220 && Math.abs(dz) < 220;
        continue;
      }
      s.mesh.visible = true;
      // a slight wobble in the breeze, as lawn flamingos do on their wire legs
      s.mesh.rotation.z = Math.sin(g.elapsed * 2.1 + s.x) * 0.04;
      if (Math.hypot(dx, dz) < reach && Math.abs(s.y - me.y) < 2.5) this.collect(s);
    }
  }

  private collect(s: Spot) {
    const g = this.game;
    s.got = true;
    if (s.mesh) this.group.remove(s.mesh);
    s.mesh = null;
    const n = this.found;
    const total = this.spots.length;
    g.audio.cue('cash');
    const pay = REWARD[n];
    if (pay) {
      g.addCash(pay);
      g.hud.bigMessage(n >= total ? 'EVERY FLAMINGO' : 'FLAMINGOS', `${n} of ${total} found · +$${pay.toLocaleString()}`, '#ff5fa8');
    } else g.hud.toast(`Lawn flamingo ${n} of ${total}`);
    g.saveGame.save();
  }
}

/** a lawn flamingo, about 0.9 m tall: plump body, S-curved neck, head and black-tipped bill; wire legs */
function flamingoGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.16, 14, 10);
  body.scale(1.55, 0.95, 0.9);
  body.rotateZ(-0.25);
  body.translate(0, 0.58, 0);
  parts.push(body);
  const tail = new THREE.ConeGeometry(0.09, 0.2, 8);
  tail.rotateZ(Math.PI / 2 + 0.4);
  tail.translate(-0.28, 0.62, 0);
  parts.push(tail);
  // the neck: a tube along an S from the breast up to the head
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.18, 0.66, 0), new THREE.Vector3(0.26, 0.78, 0), new THREE.Vector3(0.17, 0.92, 0), new THREE.Vector3(0.2, 1.04, 0), new THREE.Vector3(0.27, 1.1, 0)]);
  parts.push(new THREE.TubeGeometry(curve, 16, 0.035, 8, false));
  const head = new THREE.SphereGeometry(0.06, 10, 8);
  head.translate(0.28, 1.11, 0);
  parts.push(head);
  const bill = new THREE.ConeGeometry(0.035, 0.12, 8);
  bill.rotateZ(-Math.PI / 2 - 0.9);
  bill.translate(0.35, 1.07, 0);
  parts.push(bill);
  const merged = mergeAll(parts);
  const legs: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const l = new THREE.CylinderGeometry(0.008, 0.008, 0.62, 5);
    l.translate(0.02, 0.31, s * 0.05);
    legs.push(l);
  }
  return { body: merged, legs: mergeAll(legs) };
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g of gs) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nor.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
