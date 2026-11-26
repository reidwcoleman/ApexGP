// Sundown Body & Paint: three roadside bays. Stop a car in the pink circle and for $150 the dents
// come out, the health goes back to full and it gets a new colour. Out of the police's sight, a new
// colour means a clean slate: the wanted level goes. With a cruiser watching, they won't touch it.
import * as THREE from 'three';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

const COST = 150;
const COLOURS = [0x1c1f24, 0xf2f2ef, 0xb3122e, 0x16407a, 0x2f6b3a, 0xd9a441, 0x6b6e73, 0x7a1f5c, 0x2aa7b8, 0xe46b2a];
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
    if (!v || v.isBoat || v.wrecked) return;
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
      if (g.cash < COST) {
        g.hud.prompt(`Sundown Body & Paint · <b>$${COST}</b> (you're short)`);
        continue;
      }
      this.service(v);
    }
  }

  private service(v: NonNullable<Game['player']['vehicle']>) {
    const g = this.game;
    this.busy = 1;
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
