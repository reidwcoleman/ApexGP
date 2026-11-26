// Sundown Body & Paint: three roadside bays. Stop a car in the pink circle and for $150 the dents
// come out, the health goes back to full and it gets a new colour. Out of the police's sight, a new
// colour means a clean slate: the wanted level goes. With a cruiser watching, they won't touch it.
import * as THREE from 'three';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

const COST = 150;
const COLOURS = [0x1c1f24, 0xf2f2ef, 0xb3122e, 0x16407a, 0x2f6b3a, 0xd9a441, 0x6b6e73, 0x7a1f5c, 0x2aa7b8, 0xe46b2a];
const NEONS = [0xff2bd6, 0x22e6ff, 0x7cff3a, 0xffb000, 0x8a5cff, 0xff3344];
const ENGINE = [1000, 2200, 4000];
const BRAKES = [600, 1400];
const ARMOR = [1200, 2800];
const NEON = 450;
const TINT = 300;

const CSS = `
#garage{position:fixed;left:34px;top:96px;transform:translateX(-30px);width:310px;padding:18px 16px 12px;border-radius:22px;background:rgba(16,16,20,.88);color:#fff;font-family:inherit;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:30;box-shadow:0 18px 50px rgba(0,0,0,.45)}
#garage.open{opacity:1;transform:none}
#garage h3{margin:0 4px 2px;font-size:22px;font-weight:900;letter-spacing:.02em;color:#ff7aa8}
#garage .sub{margin:0 4px 12px;font-size:12px;opacity:.6}
#garage .row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;font-size:14px;font-weight:700}
#garage .row.off{opacity:.4}
#garage kbd{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:7px;background:#fff;color:#141418;font:800 12px inherit}
#garage .lv{font-size:11px;opacity:.6;font-weight:600}
#garage .p{margin-left:auto;font-size:12px;opacity:.8}
#garage .hint{font-size:11px;opacity:.55;text-align:center;margin-top:10px}
`;

const SITES = [
  { x: 300, z: -250 },
  { x: -200, z: 100 },
  { x: 500, z: 160 },
];

interface Bay {
  x: number;
  z: number;
  marker: Marker;
}

export class BodyShop {
  bays: Bay[] = [];
  private busy = 0;
  private cool = 0;
  private fade: HTMLDivElement;
  private menu: HTMLDivElement;
  private open = false;

  constructor(private game: Game) {
    const map = game.map;
    const sign = signMaterial();
    const pole = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 });
    for (const s of SITES) {
      // the junction nearest the site, then 14 m down its first road, in the kerb lane
      let best = map.nodes[0], bd = 1e9;
      for (const n of map.nodes) {
        const d = Math.hypot(n.x - s.x, n.z - s.z);
        if (d < bd && n.edges.length >= 3) (bd = d), (best = n);
      }
      const o = map.nodes[map.otherEnd(map.edges[best.edges[0]], best.id)];
      const ex = o.x - best.x, ez = o.z - best.z, el = Math.hypot(ex, ez) || 1;
      const dx = ex / el, dz = ez / el;
      const x = best.x + dx * 16 - dz * 3, z = best.z + dz * 16 + dx * 3;
      const marker = new Marker(game.scene, 0xff6fb5, 3, 3);
      marker.at(x, z);
      // a sign on a pole at the kerb
      const g = new THREE.Group();
      const px = x - dz * 4.6, pz = z + dx * 4.6;
      g.position.set(px, 0, pz);
      g.rotation.y = Math.atan2(-dz, dx);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8), pole);
      p.position.y = 2.6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.3, 0.12), [pole, pole, pole, pole, sign, sign]);
      b.position.y = 5.4;
      b.castShadow = p.castShadow = true;
      g.add(p, b);
      game.scene.add(g);
      this.bays.push({ x, z, marker });
    }
    this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s;z-index:40';
    document.body.appendChild(this.fade);
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.menu = document.createElement('div');
    this.menu.id = 'garage';
    document.body.appendChild(this.menu);
  }

  private setOpen(v: boolean) {
    if (this.open === v) return;
    this.open = v;
    this.menu.classList.toggle('open', v);
  }

  /** the upgrade list for this car: name, level text, price (null when maxed) */
  private items(v: NonNullable<Game['player']['vehicle']>) {
    const t = v.tune;
    const lv = (n: number, max: number) => '\u25cf'.repeat(n) + '\u25cb'.repeat(max - n);
    return [
      { name: 'Repair & respray', lv: v.health < v.spec.health - 1 || v.crumple > 0 ? 'damaged' : 'new colour', price: COST as number | null },
      { name: 'Engine', lv: lv(t.engine, 3), price: t.engine < 3 ? ENGINE[t.engine] : null },
      { name: 'Brakes & tyres', lv: lv(t.brakes, 2), price: t.brakes < 2 ? BRAKES[t.brakes] : null },
      { name: 'Armour', lv: lv(t.armor, 2), price: t.armor < 2 ? ARMOR[t.armor] : null },
      { name: t.neon === null ? 'Neon underglow' : 'Next neon colour', lv: t.neon === null ? 'off' : 'on', price: NEON as number | null },
      { name: t.tint ? 'Clear the windows' : 'Window tint', lv: t.tint ? 'tinted' : 'clear', price: TINT as number | null },
    ];
  }

  private render(v: NonNullable<Game['player']['vehicle']>) {
    const cash = this.game.cash;
    const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
    const sw = v.tune.neon !== null ? `<span style="width:12px;height:12px;border-radius:50%;background:${hex(v.tune.neon)};box-shadow:0 0 8px ${hex(v.tune.neon)}"></span>` : '';
    this.menu.innerHTML = `<h3>SUNDOWN GARAGE</h3><div class="sub">${v.spec.label} \u00b7 $${cash.toLocaleString()}</div>${this.items(v)
      .map(
        (it, i) =>
          `<div class="row ${it.price === null || cash < it.price ? 'off' : ''}"><kbd>${i + 1}</kbd>${it.name} <span class="lv">${it.lv}</span>${i === 4 ? sw : ''}<span class="p">${it.price === null ? 'max' : '$' + it.price.toLocaleString()}</span></div>`,
      )
      .join('')}<div class="hint">press a number to buy \u00b7 drive off to leave</div>`;
  }

  private buy(v: NonNullable<Game['player']['vehicle']>, i: number) {
    const g = this.game;
    const it = this.items(v)[i];
    if (!it || it.price === null) return;
    if (g.cash < it.price) {
      g.hud.toast(`${it.name}: $${it.price.toLocaleString()}, you're short`);
      return;
    }
    if (i === 0) return this.service(v);
    g.cash -= it.price;
    const t = v.tune;
    if (i === 1) t.engine++;
    else if (i === 2) t.brakes++;
    else if (i === 3) t.armor++;
    else if (i === 4) t.neon = NEONS[(t.neon === null ? -1 : NEONS.indexOf(t.neon)) + 1] ?? NEONS[0];
    else if (i === 5) t.tint = !t.tint;
    v.applyTune();
    if (i === 3) v.health = v.spec.health;
    g.audio.cue('cash');
    g.hud.toast(i === 1 ? `Engine stage ${t.engine}` : i === 2 ? `Brakes stage ${t.brakes}` : i === 3 ? `Armour stage ${t.armor}` : i === 4 ? 'Underglow fitted' : t.tint ? 'Windows tinted' : 'Tint removed');
  }

  get blips(): Blip[] {
    return this.bays.map((b) => ({ x: b.x, z: b.z, color: '#ff6fb5', label: 'P', kind: 'mission' as const }));
  }

  /** the police can see you right now (a cruiser or officer with a line of sight) */
  private watched() {
    const w = this.game.wanted;
    return w.level > 0 && w.unseen < 1.5;
  }

  update(dt: number) {
    const g = this.game;
    this.cool -= dt;
    if (this.busy > 0) return;
    const v = g.player.vehicle;
    if (!v || v.isBoat || v.wrecked) return this.setOpen(false);
    let menu = false;
    for (const b of this.bays) {
      const d = Math.hypot(v.pos.x - b.x, v.pos.z - b.z);
      if (d > 9) continue;
      if (d > 3.2) {
        g.hud.prompt('Sundown Body & Paint · stop in the circle');
        continue;
      }
      if (this.cool > 0) continue;
      if (v.speed > 1.5) {
        g.hud.prompt('Sundown Body & Paint · stop in the circle');
        continue;
      }
      if (this.watched()) {
        g.hud.prompt('Sundown Body & Paint · <b>not with the cops watching</b>');
        continue;
      }
      menu = true;
      this.setOpen(true);
      for (let k = 0; k < 6; k++) if (g.input.hit('Digit' + (k + 1))) this.buy(v, k);
      if (this.busy > 0) return;
      this.render(v);
    }
    if (!menu) this.setOpen(false);
  }

  private service(v: NonNullable<Game['player']['vehicle']>) {
    const g = this.game;
    this.busy = 1;
    this.setOpen(false);
    v.input.thr = 0;
    v.vx = v.vz = 0;
    this.fade.style.opacity = '1';
    g.audio.cue('click');
    setTimeout(() => {
      let c = v.color;
      while (c === v.color) c = COLOURS[Math.floor(Math.random() * COLOURS.length)];
      v.repaint(c);
      v.repair();
      v.vx = v.vz = 0;
      g.cash -= COST;
      const hot = g.wanted.level > 0;
      if (hot) g.wanted.clear();
      g.post.reset();
      this.fade.style.opacity = '0';
      g.hud.bigMessage('FRESH PAINT', hot ? `-$${COST}  ·  the heat is off` : `-$${COST}  ·  good as new`, '#ff9ad0');
      g.audio.cue('cash');
      this.cool = 8;
      setTimeout(() => (this.busy = 0), 400);
    }, 1400);
  }
}

function signMaterial() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 196;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 512, 196);
  gr.addColorStop(0, '#ff7a59');
  gr.addColorStop(1, '#ff4fa3');
  x.fillStyle = gr;
  x.fillRect(0, 0, 512, 196);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.font = '900 70px system-ui, sans-serif';
  x.fillText('SUNDOWN', 256, 92);
  x.font = '700 40px system-ui, sans-serif';
  x.fillText('BODY & PAINT', 256, 150);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
}
