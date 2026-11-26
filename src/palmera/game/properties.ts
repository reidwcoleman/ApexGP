// Property: five places for sale around Palmera, from a swamp shack to a downtown penthouse. Walk up
// to the FOR SALE sign by the door and press T to buy one with cash. A place you own earns its rent
// into a till while you're away (by the in-game hour, up to three days' worth); come back, press T to
// sleep until morning - you wake healed, the till is paid out and the game is saved. Owned places are
// green houses on the minimap; ones for sale are gold. Saved with the game.
import * as THREE from 'three';
import { groundAt } from '../world/map';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

interface PropDef {
  name: string;
  kind: string;
  /** a point in the district; the door goes on the nearest suitable building's road side */
  at: { x: number; z: number };
  price: number;
  /** rent a game day */
  rent: number;
}

const DEFS: PropDef[] = [
  { name: 'Cypress Landing', kind: 'Swamp shack', at: { x: -560, z: 20 }, price: 4000, rent: 70 },
  { name: 'Pelican Row', kind: 'Bungalow', at: { x: -180, z: 60 }, price: 9500, rent: 150 },
  { name: 'Seabreeze 4B', kind: 'Beach condo', at: { x: 620, z: -140 }, price: 18000, rent: 290 },
  { name: 'Harbourlight Loft', kind: 'Marina loft', at: { x: 352, z: 300 }, price: 26000, rent: 400 },
  { name: 'The Glasshouse', kind: 'Penthouse', at: { x: 230, z: -300 }, price: 60000, rent: 950 },
];

interface Place {
  def: PropDef;
  x: number;
  z: number;
  /** the way the door faces (out from the wall) */
  nx: number;
  nz: number;
  owned: boolean;
  till: number;
  marker: Marker;
  board: THREE.Mesh;
}

export class Properties {
  places: Place[] = [];
  private lastHour = -1;
  private sale: THREE.MeshStandardMaterial;
  private mine: THREE.MeshStandardMaterial;
  private busy = 0;

  constructor(private game: Game) {
    const map = game.map;
    this.sale = boardMaterial('FOR SALE', '#c8102e', '#ffffff');
    this.mine = boardMaterial('YOURS', '#1c7a3e', '#ffffff');
    const pole = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6 });
    for (const def of DEFS) {
      const spot = this.doorNear(def.at.x, def.at.z);
      if (!spot) continue;
      const { x, z, nx, nz } = spot;
      const marker = new Marker(game.scene, 0xffd23f, 1.1, 2.2).at(x, z);
      // the sign: a white post with a hanging board, a step to the side of the door, facing the street
      const g = new THREE.Group();
      const sx = x + nz * 1.8, sz = z - nx * 1.8;
      g.position.set(sx, groundAt(sx, sz), sz);
      g.rotation.y = Math.atan2(nx, nz);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.9, 0.09), pole);
      post.position.y = 0.95;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.07), pole);
      arm.position.set(0.36, 1.82, 0);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.03), [pole, pole, pole, pole, this.sale, this.sale]);
      board.position.set(0.42, 1.5, 0);
      post.castShadow = board.castShadow = true;
      g.add(post, arm, board);
      game.scene.add(g);
      this.places.push({ def, x, z, nx, nz, owned: false, till: 0, marker, board });
    }
  }

  /**
   * a door spot 1.2 m out from a real wall of the building nearest a point: the side facing the nearest
   * road junction first, then the others, then the next building - each checked against the collision
   * grid (a wall right behind the spot, nothing on the spot itself)
   */
  private doorNear(px: number, pz: number): { x: number; z: number; nx: number; nz: number } | null {
    const map = this.game.map;
    const cands = map.buildings
      .filter((b) => b.y0 < 0.5 && b.w >= 6 && b.d >= 6 && Math.hypot(b.x - px, b.z - pz) < 140)
      .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))
      .slice(0, 16);
    const tmp: ReturnType<typeof map.colliders.query> = [];
    for (const b of cands) {
      let n = map.nodes[0], nd = 1e9;
      for (const q of map.nodes) {
        const d = Math.hypot(q.x - b.x, q.z - b.z);
        if (d < nd) (nd = d), (n = q);
      }
      const faces: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      faces.sort((f, g) => -(f[0] * (n.x - b.x) / b.w + f[1] * (n.z - b.z) / b.d) + (g[0] * (n.x - b.x) / b.w + g[1] * (n.z - b.z) / b.d));
      for (const [nx, nz] of faces) {
        const x = b.x + nx * (b.w / 2 + 1.2), z = b.z + nz * (b.d / 2 + 1.2);
        const y = groundAt(x, z);
        const hit = map.colliders.raycast(x, y + 1.2, z, -nx, 0, -nz, 1.6, true);
        if (!hit) continue;
        tmp.length = 0;
        if (map.colliders.query(x - 0.4, z - 0.4, x + 0.4, z + 0.4, tmp).some((q) => q.y0 < y + 1.8 && q.y1 > y + 0.2)) continue;
        return { x, z, nx, nz };
      }
    }
    return null;
  }

  get blips(): Blip[] {
    return this.places.map((p) => ({ x: p.x, z: p.z, color: p.owned ? '#5cff8a' : '#ffd23f', label: p.owned ? 'H' : '$', kind: 'mission' as const }));
  }

  /** what you own, for saving */
  get state() {
    return this.places.map((p) => ({ owned: p.owned, till: Math.round(p.till) }));
  }

  restore(s: { owned: boolean; till: number }[]) {
    s.forEach((q, i) => {
      const p = this.places[i];
      if (!p) return;
      p.owned = q.owned;
      p.till = q.till;
      this.dress(p);
    });
  }

  private dress(p: Place) {
    const m = p.owned ? this.mine : this.sale;
    (p.board.material as THREE.Material[])[4] = m;
    (p.board.material as THREE.Material[])[5] = m;
    p.marker.setColor(p.owned ? 0x5cff8a : 0xffd23f);
  }

  private buy(p: Place) {
    const g = this.game;
    g.cash -= p.def.price;
    p.owned = true;
    p.till = 0;
    this.dress(p);
    g.audio.cue('cash');
    g.hud.bigMessage('PROPERTY', `${p.def.name} is yours · earns $${p.def.rent} a day`, '#5cff8a');
    g.saveGame.save();
  }

  private sleep(p: Place) {
    const g = this.game;
    const paid = Math.floor(p.till);
    p.till = 0;
    g.cash += paid;
    g.player.health = g.player.maxHealth;
    // until 8 in the morning (the next one if it's already past)
    const t = g.sky.time;
    const wake = 8;
    const hours = (wake - t + 24) % 24 || 24;
    // every place you own keeps earning while you sleep
    for (const q of this.places) if (q.owned && q !== p) q.till = Math.min(q.def.rent * 3, q.till + (q.def.rent * hours) / 24);
    g.sky.setTime(wake);
    this.lastHour = wake;
    g.audio.cue('cash');
    g.hud.bigMessage('RESTED', paid > 0 ? `${p.def.name} · rent collected $${paid.toLocaleString()} · game saved` : `${p.def.name} · game saved`, '#7dd3ff');
    g.saveGame.save();
  }

  update(dt: number) {
    const g = this.game;
    // rent accrues by the in-game hour
    const h = g.sky.time;
    if (this.lastHour < 0) this.lastHour = h;
    const dh = (h - this.lastHour + 24) % 24;
    if (dh > 0 && dh < 6) for (const p of this.places) if (p.owned) p.till = Math.min(p.def.rent * 3, p.till + (p.def.rent * dh) / 24);
    this.lastHour = h;
    if (this.busy > 0) this.busy -= dt;
    const pl = g.player;
    for (const p of this.places) {
      p.marker.spin(g.elapsed);
      const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
      p.marker.visible = d < 90;
      if (pl.vehicle || pl.dead || d > 1.8) continue;
      if (p.owned) {
        if (g.wanted.level > 0) {
          g.hud.prompt(`${p.def.name} · <b>lose the police first</b>`);
          continue;
        }
        const t = Math.floor(p.till);
        g.hud.prompt(`<kbd>T</kbd> Sleep at ${p.def.name}${t > 0 ? ` · collect $${t.toLocaleString()} rent` : ''}`);
        if (g.input.hit('KeyT') && this.busy <= 0) {
          this.busy = 1;
          this.sleep(p);
        }
        continue;
      }
      const head = `${p.def.kind} · ${p.def.name} · $${p.def.price.toLocaleString()} · rent $${p.def.rent}/day`;
      if (g.cash < p.def.price) {
        g.hud.prompt(`${head} · <b>$${(p.def.price - g.cash).toLocaleString()} short</b>`);
        continue;
      }
      g.hud.prompt(`<kbd>T</kbd> Buy · ${head}`);
      if (g.input.hit('KeyT') && this.busy <= 0) {
        this.busy = 1;
        this.buy(p);
      }
    }
  }
}

function boardMaterial(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 154;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 154);
  x.fillStyle = bg;
  x.fillRect(8, 8, 240, 138);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.font = `900 ${text.length > 6 ? 44 : 56}px system-ui, sans-serif`;
  x.fillText(text, 128, 92);
  x.font = '700 18px system-ui, sans-serif';
  x.fillText(text === 'YOURS' ? 'HOME' : 'PALMERA REALTY', 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
}
