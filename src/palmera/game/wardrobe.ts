// Threadline: clothes shops. Step into the circle on the pavement and the rail comes up: arrows to
// browse (you try each one on as you go), Enter to buy or wear, Backspace to walk out in what you
// came in with. What you own and what you wear go in the save.
import * as THREE from 'three';
import type { BottomKind, TopKind } from '../../people/Humans.ts';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

export interface Outfit {
  id: string;
  name: string;
  price: number;
  top: TopKind;
  topColor: number;
  top2?: number;
  bottom: BottomKind;
  bottomColor: number;
  cap?: number | null;
}

export const OUTFITS: Outfit[] = [
  { id: 'island', name: 'Island tee', price: 0, top: 'tshirt', topColor: 0x2bb3a3, bottom: 'jeans', bottomColor: 0x2d3f63 },
  { id: 'coral', name: 'Coral tee', price: 90, top: 'tshirt', topColor: 0xff7a6b, bottom: 'jeans', bottomColor: 0x6b84a8 },
  { id: 'cap', name: 'Ballpark', price: 150, top: 'tshirt', topColor: 0xf4b13a, bottom: 'jeans', bottomColor: 0x2d3f63, cap: 0xc8102e },
  { id: 'polo', name: 'Midnight polo', price: 180, top: 'polo', topColor: 0x15171c, top2: 0x15171c, bottom: 'trousers', bottomColor: 0x2a2a2e },
  { id: 'white', name: 'Harbor whites', price: 220, top: 'polo', topColor: 0xf2efe6, top2: 0xf2efe6, bottom: 'trousers', bottomColor: 0x26303c },
  { id: 'track', name: 'Track top', price: 260, top: 'jacket', topColor: 0x1c3f8a, top2: 0xf2f2f2, bottom: 'trousers', bottomColor: 0x111214 },
  { id: 'night', name: 'Night shift', price: 300, top: 'jacket', topColor: 0x1a1b1f, top2: 0x6b1530, bottom: 'jeans', bottomColor: 0x15161a, cap: 0x15161a },
  { id: 'linen', name: 'Linen jacket', price: 420, top: 'jacket', topColor: 0xd8cdb5, top2: 0xb9ad94, bottom: 'trousers', bottomColor: 0x3b3530 },
];

const SITES = [
  { x: 240, z: -290 },
  { x: 640, z: -30 },
];

const CSS = `
#rail{position:fixed;left:34px;top:96px;transform:translateX(-30px);width:300px;padding:18px 16px 12px;border-radius:22px;background:rgba(16,16,20,.88);color:#fff;font-family:inherit;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:30;box-shadow:0 18px 50px rgba(0,0,0,.45)}
#rail.open{opacity:1;transform:none}
#rail h3{margin:0 4px 2px;font-size:22px;font-weight:900;letter-spacing:.02em}
#rail .sub{margin:0 4px 12px;font-size:12px;opacity:.6}
#rail .row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:12px;font-size:14px;font-weight:700}
#rail .row.sel{background:#fff;color:#141418}
#rail .sw{width:22px;height:22px;border-radius:7px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.25)}
#rail .p{margin-left:auto;font-size:12px;opacity:.75}
#rail .hint{font-size:11px;opacity:.55;text-align:center;margin-top:10px}
`;

export class Wardrobe {
  sites: { x: number; z: number }[] = [];
  owned = new Set<string>(['island']);
  wearing = 'island';
  private open = false;
  private sel = 0;
  private el: HTMLDivElement;
  private cool = 0;

  constructor(private game: Game) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.id = 'rail';
    document.body.appendChild(this.el);
    const map = game.map;
    const sign = signMaterial();
    const pole = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 });
    for (const s of SITES) {
      let best = map.nodes[0], bd = 1e9;
      for (const n of map.nodes) {
        const d = Math.hypot(n.x - s.x, n.z - s.z);
        if (d < bd && n.edges.length >= 3) (bd = d), (best = n);
      }
      const o = map.nodes[map.otherEnd(map.edges[best.edges[0]], best.id)];
      const ex = o.x - best.x, ez = o.z - best.z, el = Math.hypot(ex, ez) || 1;
      const dx = ex / el, dz = ez / el;
      // on the pavement, 20 m down the road from the junction
      const x = best.x + dx * 20 - dz * 8.2, z = best.z + dz * 20 + dx * 8.2;
      new Marker(game.scene, 0x9b7bff, 1.2, 0.5).at(x, z);
      const g = new THREE.Group();
      g.position.set(x - dz * 1.4, 0, z + dx * 1.4);
      g.rotation.y = Math.atan2(-dz, dx);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8), pole);
      p.position.y = 1.7;
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.1), [pole, pole, pole, pole, sign, sign]);
      b.position.y = 3.6;
      p.castShadow = b.castShadow = true;
      g.add(p, b);
      game.scene.add(g);
      this.sites.push({ x, z });
    }
    this.apply(this.wearing);
  }

  get blips(): Blip[] {
    return this.sites.map((s) => ({ x: s.x, z: s.z, color: '#9b7bff', label: 'T', kind: 'mission' as const }));
  }

  /** put an outfit on the player (and rebuild their figure) */
  apply(id: string) {
    const o = OUTFITS.find((q) => q.id === id) ?? OUTFITS[0];
    const p = this.game.player;
    p.outfit = o;
    p.shirt.setHex(o.topColor);
    p.pants.setHex(o.bottomColor);
    this.game.skinned?.restyle(p);
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.cool -= dt;
    const near = !p.vehicle && !p.dead && g.wanted.level === 0 && this.sites.some((s) => Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 1.4);
    if (!this.open) {
      if (near && this.cool <= 0) this.show(true);
      else if (!p.vehicle && this.sites.some((s) => Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 5)) g.hud.prompt('Threadline · step into the circle to browse');
      return;
    }
    if (!near) return this.close(true);
    const inp = g.input;
    const n = OUTFITS.length;
    let moved = false;
    if (inp.hit('ArrowDown')) (this.sel = (this.sel + 1) % n), (moved = true);
    if (inp.hit('ArrowUp')) (this.sel = (this.sel + n - 1) % n), (moved = true);
    if (moved) this.apply(OUTFITS[this.sel].id);
    if (inp.hit('Enter')) {
      const o = OUTFITS[this.sel];
      if (!this.owned.has(o.id)) {
        if (g.cash < o.price) {
          g.hud.toast(`${o.name}: $${o.price}, you're short`);
          return;
        }
        g.cash -= o.price;
        this.owned.add(o.id);
        g.audio.cue('cash');
      } else g.audio.cue('click');
      this.wearing = o.id;
      g.hud.toast(`Wearing: ${o.name}`);
      g.saveGame.save();
      return this.close(false);
    }
    if (inp.hit('Backspace')) return this.close(true);
    if (moved || g.elapsed % 0.5 < 0.02) this.render();
  }

  private show(v: boolean) {
    this.open = v;
    this.sel = Math.max(0, OUTFITS.findIndex((o) => o.id === this.wearing));
    this.el.classList.toggle('open', v);
    this.render();
  }

  /** shut the rail; `revert` puts back what you were wearing */
  private close(revert: boolean) {
    if (revert) this.apply(this.wearing);
    this.show(false);
    this.cool = 2.5;
  }

  private render() {
    if (!this.open) return;
    const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
    this.el.innerHTML = `<h3>THREADLINE</h3><div class="sub">$${this.game.cash.toLocaleString()} · try it on as you browse</div>${OUTFITS.map(
      (o, i) =>
        `<div class="row ${i === this.sel ? 'sel' : ''}"><span class="sw" style="background:linear-gradient(135deg,${hex(o.topColor)} 0 55%,${hex(o.bottomColor)} 55%)"></span>${o.name}<span class="p">${
          o.id === this.wearing ? 'wearing' : this.owned.has(o.id) ? 'owned' : '$' + o.price
        }</span></div>`,
    ).join('')}<div class="hint">↑ ↓ browse · Enter buy / wear · Backspace leave</div>`;
  }
}

function signMaterial() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 186;
  const x = c.getContext('2d')!;
  x.fillStyle = '#16151c';
  x.fillRect(0, 0, 512, 186);
  x.fillStyle = '#b9a3ff';
  x.fillRect(0, 150, 512, 10);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.font = '800 74px Georgia, serif';
  x.fillText('Threadline', 256, 112);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3 });
}
