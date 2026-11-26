// Home garages: two bays of your own (one by the start on the beach road, one in the suburbs). Stop a
// car in the green circle and press V to keep it: it's yours from then on, with its colour and its
// Sundown upgrades, marked on the minimap, and saved with the game. Leave it anywhere; if it's
// wrecked or lost, a fresh one is waiting back at the garage the next time you're out of sight of it.
import * as THREE from 'three';
import type { CarType } from '../entities/carModels';
import type { Vehicle } from '../entities/vehicle';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

export interface StoredCar {
  type: CarType;
  color: number;
  tune: Vehicle['tune'];
}

const SITES = [
  { x: 640, z: -60 },
  { x: -230, z: 60 },
];

interface Site {
  x: number;
  z: number;
  heading: number;
  marker: Marker;
}

export class Garages {
  sites: Site[] = [];
  slots: (StoredCar | null)[] = [null, null];
  cars: (Vehicle | null)[] = [null, null];
  private t = 0;

  constructor(private game: Game) {
    const map = game.map;
    const sign = signMaterial();
    const pole = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 });
    for (const s of SITES) {
      // the kerb lane of the road leaving the junction nearest the site
      let best = map.nodes[0], bd = 1e9;
      for (const n of map.nodes) {
        const d = Math.hypot(n.x - s.x, n.z - s.z);
        if (d < bd && n.edges.length >= 2) (bd = d), (best = n);
      }
      const o = map.nodes[map.otherEnd(map.edges[best.edges[0]], best.id)];
      const ex = o.x - best.x, ez = o.z - best.z, el = Math.hypot(ex, ez) || 1;
      const dx = ex / el, dz = ez / el;
      const x = best.x + dx * 22 - dz * 3, z = best.z + dz * 22 + dx * 3;
      const marker = new Marker(game.scene, 0x5cff8a, 3, 3).at(x, z);
      const g = new THREE.Group();
      g.position.set(x - dz * 4.6, 0, z + dx * 4.6);
      g.rotation.y = Math.atan2(-dz, dx);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.4, 8), pole);
      p.position.y = 2.2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 0.12), [pole, pole, pole, pole, sign, sign]);
      b.position.y = 4.6;
      b.castShadow = p.castShadow = true;
      g.add(p, b);
      game.scene.add(g);
      this.sites.push({ x, z, heading: Math.atan2(dx, dz), marker });
    }
  }

  get blips(): Blip[] {
    const out: Blip[] = this.sites.map((s) => ({ x: s.x, z: s.z, color: '#5cff8a', label: 'G', kind: 'mission' as const }));
    for (const v of this.cars) if (v && !v.wrecked && this.game.player.vehicle !== v) out.push({ x: v.pos.x, z: v.pos.z, color: '#5cff8a', label: '', kind: 'car' });
    return out;
  }

  /** is this car one of yours */
  owns(v: Vehicle) {
    return this.cars.includes(v);
  }

  private store(i: number, v: Vehicle) {
    const g = this.game;
    // the car that was kept here before goes back into town as an ordinary car
    const old = this.cars[i];
    if (old && old !== v) old.persistent = false;
    const j = this.cars.indexOf(v);
    if (j >= 0 && j !== i) {
      this.cars[j] = null;
      this.slots[j] = null;
    }
    this.slots[i] = { type: v.type, color: v.color, tune: { ...v.tune } };
    this.cars[i] = v;
    v.persistent = true;
    g.audio.cue('cash');
    g.hud.bigMessage('GARAGE', `${v.spec.label} is yours`, '#5cff8a');
    g.saveGame.save();
  }

  /** a fresh copy of a stored car, parked in its bay */
  private respawn(i: number) {
    const g = this.game;
    const s = this.sites[i];
    const d = this.slots[i]!;
    const v = g.spawnCar(d.type, s.x, s.z, s.heading);
    v.repaint(d.color);
    v.tune = { ...d.tune };
    v.applyTune();
    v.persistent = true;
    this.cars[i] = v;
  }

  update(dt: number) {
    const g = this.game;
    const v = g.player.vehicle;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      s.marker.spin(g.elapsed);
      if (!v || v.isBoat || v.wrecked) continue;
      const d = Math.hypot(v.pos.x - s.x, v.pos.z - s.z);
      if (d > 9) continue;
      if (d > 3.2 || Math.abs(v.speed) > 1.5) {
        g.hud.prompt('Your garage · stop in the circle');
        continue;
      }
      if (g.wanted.level > 0) {
        g.hud.prompt('Your garage · <b>lose the police first</b>');
        continue;
      }
      if (this.cars[i] === v) {
        g.hud.prompt(`Your garage · ${v.spec.label} lives here`);
        continue;
      }
      g.hud.prompt(`<kbd>V</kbd> Keep the ${v.spec.label} in this garage${this.slots[i] ? ' (replaces yours)' : ''}`);
      if (g.input.hit('KeyV')) this.store(i, v);
    }
    // keep the upgrades on record as you buy them, and bring wrecked or lost cars back
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const f = g.focus;
    for (let i = 0; i < this.slots.length; i++) {
      const d = this.slots[i];
      if (!d) continue;
      const c = this.cars[i];
      if (c && !c.wrecked && !c.sunk && g.vehicles.includes(c)) {
        d.color = c.color;
        d.tune = { ...c.tune };
        continue;
      }
      if (c) {
        c.persistent = false;
        this.cars[i] = null;
      }
      const s = this.sites[i];
      const dist = Math.hypot(s.x - f.x, s.z - f.z);
      if (dist < 260 && (dist > 40 || !g.inView(s.x, 1, s.z))) this.respawn(i);
    }
  }
}

function signMaterial() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 200;
  const x = c.getContext('2d')!;
  x.fillStyle = '#12261a';
  x.fillRect(0, 0, 512, 200);
  x.fillStyle = '#5cff8a';
  x.fillRect(0, 168, 512, 10);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.font = '900 64px system-ui, sans-serif';
  x.fillText('GARAGE', 256, 96);
  x.font = '700 30px system-ui, sans-serif';
  x.fillText('RESIDENTS ONLY', 256, 146);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3 });
}
