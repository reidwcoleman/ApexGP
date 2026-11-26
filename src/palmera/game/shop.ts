// Sunbelt Arms: gun shops on the street. Walk up, press B, buy guns, ammo, grenades and armor.
import * as THREE from 'three';
import { SIDEWALK, groundAt, type Block } from '../world/map';
import { WEAPONS, MELEE, type AmmoId } from './weapons';
import type { Game } from './game';

interface Item {
  label: string;
  price: () => number;
  buy: () => string | null;
  owned?: () => boolean;
}

const ANCHORS = [
  { x: 640, z: -60 },
  { x: 120, z: -150 },
  { x: -260, z: 160 },
];

export class Shop {
  open = false;
  readonly spots: THREE.Vector3[] = [];
  private panel: HTMLDivElement;
  private items: Item[] = [];
  private near = -1;

  constructor(private game: Game) {
    for (const a of ANCHORS) {
      const s = this.place(a.x, a.z);
      if (s) this.spots.push(s);
    }
    for (const s of this.spots) this.dress(s);
    const guns: AmmoId[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];
    const g = game;
    for (const id of guns) {
      const d = WEAPONS[id];
      this.items.push({
        label: d.name,
        owned: () => g.loadout.owned.has(id),
        price: () => (g.loadout.owned.has(id) ? d.ammoPrice : d.price),
        buy: () => {
          const has = g.loadout.owned.has(id);
          g.weapons.give(id, has ? d.ammoPack : d.mag * 2);
          return has ? `${d.ammoPack} rounds for the ${d.name}` : d.name;
        },
      });
    }
    this.items.push({ label: 'Grenades ×3', price: () => WEAPONS.grenade.price, buy: () => (g.weapons.give('grenade', 3), '3 grenades') });
    this.items.push({ label: MELEE.bat.name, owned: () => g.loadout.owned.has('bat'), price: () => (g.loadout.owned.has('bat') ? 0 : MELEE.bat.price), buy: () => (g.loadout.owned.has('bat') ? null : (g.weapons.give('bat'), MELEE.bat.name)) });
    this.items.push({ label: 'Body Armor', price: () => 250, buy: () => (g.player.armor >= 100 ? null : (g.weapons.give('armor'), 'Body armor')) });

    this.panel = document.createElement('div');
    this.panel.id = 'shop';
    this.panel.className = 'panel hidden';
    document.body.appendChild(this.panel);
    const st = document.createElement('style');
    st.textContent = `
#shop { position: fixed; right: 4vw; top: 50%; transform: translateY(-50%); width: 340px; padding: 18px 20px; z-index: 30; font: 15px/1.4 'Outfit', system-ui, sans-serif; color: #fff; background: rgba(12,16,22,0.86); border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); }
#shop.hidden { display: none; }
#shop h3 { margin: 0 0 2px; font-size: 22px; letter-spacing: 0.06em; color: #ffd23f; }
#shop .sub { opacity: 0.6; margin-bottom: 12px; font-size: 13px; }
#shop .row { display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.07); }
#shop .row b { color: #7dff9a; }
#shop .row.poor b { color: #ff7a7a; }
#shop .row kbd { display: inline-block; min-width: 18px; margin-right: 8px; text-align: center; background: rgba(255,255,255,0.14); border-radius: 4px; font-size: 12px; }
#shop .foot { margin-top: 10px; opacity: 0.6; font-size: 12px; }`;
    document.head.appendChild(st);
  }

  /** the sidewalk outside the block nearest an anchor, on the side facing it */
  private place(x: number, z: number): THREE.Vector3 | null {
    let best: Block | null = null, bd = Infinity;
    for (const b of this.game.map.blocks) {
      if (b.park) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      const d = Math.hypot(cx - x, cz - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return null;
    const b = best;
    const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    const sides = [
      new THREE.Vector3(b.x0 + SIDEWALK * 0.55, 0, mz),
      new THREE.Vector3(b.x1 - SIDEWALK * 0.55, 0, mz),
      new THREE.Vector3(mx, 0, b.z0 + SIDEWALK * 0.55),
      new THREE.Vector3(mx, 0, b.z1 - SIDEWALK * 0.55),
    ];
    sides.sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
    const s = sides[0];
    s.y = groundAt(s.x, s.z);
    return s;
  }

  private dress(p: THREE.Vector3) {
    const g = this.game;
    // a sign on a post with the shop's name, lit at night, and a marker on the ground
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#121519';
    x.fillRect(0, 0, 512, 128);
    x.strokeStyle = '#ffd23f';
    x.lineWidth = 8;
    x.strokeRect(6, 6, 500, 116);
    x.fillStyle = '#ffd23f';
    x.font = 'bold 64px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('SUNBELT ARMS', 256, 58);
    x.font = '22px system-ui, sans-serif';
    x.fillStyle = '#ffffff';
    x.fillText('GUNS · AMMO · ARMOR', 256, 104);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 0.12), [
      new THREE.MeshStandardMaterial({ color: 0x121519 }), new THREE.MeshStandardMaterial({ color: 0x121519 }),
      new THREE.MeshStandardMaterial({ color: 0x121519 }), new THREE.MeshStandardMaterial({ color: 0x121519 }),
      new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.6 }),
      new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.6 }),
    ]);
    sign.position.set(p.x, p.y + 3.4, p.z);
    sign.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.0, 8), new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.4 }));
    post.position.set(p.x, p.y + 1.5, p.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, p.y + 0.15, p.z);
    ring.name = 'shop-ring';
    g.scene.add(sign, post, ring);
  }

  update() {
    const g = this.game;
    const p = g.player;
    const inp = g.input;
    this.near = -1;
    if (!p.vehicle && !p.dead) this.spots.forEach((s, i) => Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 2.6 && (this.near = i));
    if (this.open) {
      if (this.near < 0 || inp.hit('KeyB') || inp.hit('Escape')) return this.close();
      for (let k = 0; k < this.items.length; k++) if (inp.hit('Digit' + (k + 1))) this.purchase(k);
      this.render();
      return;
    }
    if (this.near >= 0) {
      g.hud.prompt('<kbd>B</kbd> Sunbelt Arms');
      if (inp.hit('KeyB')) {
        if (g.wanted.level > 0) g.hud.toast('They won’t serve you with the cops on your tail');
        else {
          this.open = true;
          this.panel.classList.remove('hidden');
          this.render();
        }
      }
    }
  }

  private close() {
    this.open = false;
    this.panel.classList.add('hidden');
  }

  private purchase(k: number) {
    const g = this.game;
    const it = this.items[k];
    const price = it.price();
    if (g.cash < price) {
      g.audio.cue('fail');
      g.hud.toast('Not enough cash');
      return;
    }
    const what = it.buy();
    if (what === null) return;
    g.cash -= price;
    g.audio.cue('cash');
    g.hud.toast(`Bought: ${what}`);
  }

  private render() {
    const g = this.game;
    const rows = this.items
      .map((it, i) => {
        const pr = it.price();
        const name = it.owned?.() && pr > 0 && it.label !== 'Body Armor' && !it.label.startsWith('Grenades') ? `${it.label} ammo` : it.label;
        return `<div class="row${g.cash < pr ? ' poor' : ''}"><span><kbd>${i + 1}</kbd>${name}</span><b>${pr ? '$' + pr.toLocaleString() : 'owned'}</b></div>`;
      })
      .join('');
    const html = `<h3>SUNBELT ARMS</h3><div class="sub">Cash: $${Math.floor(g.cash).toLocaleString()}</div>${rows}<div class="foot">Number keys to buy · B to leave</div>`;
    if (this.panel.innerHTML !== html) this.panel.innerHTML = html;
  }
}
