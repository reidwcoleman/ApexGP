// Food delivery: Mango Takeout downtown. Walk up to its door and press T to start a shift - a
// delivery bike waits at the kerb. Each order is a real front door somewhere in town (120-520 m off)
// with a clock set by the distance; get there, stop at the door (on foot or on the bike, nearly
// still) and the customer pays $35 plus a tip for the time left - less if you crashed on the way.
// Six drops in a row pays a $250 bonus and ends the shift; a cold order (time up), a lost or wrecked
// bike, or two stars of heat ends it early. The HUD shows the order and the clock; the drop is red on
// the minimap.
import * as THREE from 'three';
import { groundAt } from '../world/map';
import { Marker, type Blip } from './missions';
import { buildingDoor, doorNear, type DoorSpot } from './properties';
import type { Vehicle } from '../entities/vehicle';
import type { Game } from './game';

const SHOP = { x: 180, z: -250 };
const DROPS = 6;
const NAMES = ['Marisol', 'Dev', 'Mrs. Okafor', 'Teddy', 'Lupe', 'Hank', 'Priya', 'Coach Reyes', 'Ines', 'Bo', 'Yuki', 'Dante'];
const FOOD = ['two mango bowls', 'a family plantain box', 'the spicy wrap', 'four empanadas', 'a cold brew and a cubano', 'the big rice tray', 'ceviche for two', 'three tacos al pastor'];

interface Order {
  door: DoorSpot;
  who: string;
  what: string;
  timer: number;
  dist: number;
  hits: number;
}

export class Delivery {
  door: DoorSpot | null;
  private marker: Marker | null = null;
  private dropMarker: Marker;
  bike: Vehicle | null = null;
  order: Order | null = null;
  done = 0;
  earned = 0;
  private busy = 0;
  private lastHealth = 0;

  constructor(private game: Game) {
    this.door = doorNear(game.map, SHOP.x, SHOP.z);
    this.dropMarker = new Marker(game.scene, 0xff5a3c, 1.6, 3);
    this.dropMarker.visible = false;
    if (!this.door) return;
    const d = this.door;
    this.marker = new Marker(game.scene, 0xffa03c, 1.2, 2.2).at(d.x, d.z);
    // a little sign over the door
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.06), signMaterial());
    sign.position.set(d.x - d.nx * 1.1, groundAt(d.x, d.z) + 3.0, d.z - d.nz * 1.1);
    sign.rotation.y = Math.atan2(d.nx, d.nz);
    game.scene.add(sign);
  }

  get active() {
    return !!this.order;
  }
  get title() {
    return `Mango Takeout · ${this.done}/${DROPS}`;
  }
  get objective() {
    const o = this.order;
    if (!o) return '';
    return `${o.what} for ${o.who}  ·  ${Math.round(o.dist)} m`;
  }
  get timer(): number | null {
    return this.order ? this.order.timer : null;
  }

  get blips(): Blip[] {
    const out: Blip[] = [];
    if (this.order) out.push({ x: this.order.door.x, z: this.order.door.z, color: '#ff5a3c', label: '', kind: 'dest' });
    else if (this.door) out.push({ x: this.door.x, z: this.door.z, color: '#ffa03c', label: 'D', kind: 'mission' });
    if (this.bike && this.order && this.game.player.vehicle !== this.bike) out.push({ x: this.bike.pos.x, z: this.bike.pos.z, color: '#ffa03c', label: '', kind: 'car' });
    return out;
  }

  private start() {
    const g = this.game;
    const d = this.door!;
    // the bike at the kerb in front of the shop, pointing along the street
    const bx = d.x + d.nx * 3.6, bz = d.z + d.nz * 3.6;
    const bike = g.spawnCar('bike', bx, bz, Math.atan2(d.nz, -d.nx));
    bike.repaint(0xffa03c);
    bike.persistent = true;
    this.bike = bike;
    this.done = 0;
    this.earned = 0;
    g.hud.bigMessage('MANGO TAKEOUT', `${DROPS} orders · the bike is out front`, '#ffa03c');
    g.audio.cue('cash');
    this.next();
  }

  /** a fresh order: the door of a random building 120-520 m from where you are */
  private next() {
    const g = this.game;
    const p = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
    const map = g.map;
    let door: DoorSpot | null = null;
    for (let k = 0; k < 40 && !door; k++) {
      const b = map.buildings[Math.floor(Math.random() * map.buildings.length)];
      if (b.y0 > 0.5 || b.w < 6 || b.d < 6 || b.x < -470) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < 120 || d > 520) continue;
      door = buildingDoor(map, b);
    }
    if (!door) return this.end('No more orders tonight');
    const dist = Math.hypot(door.x - p.x, door.z - p.z);
    this.order = {
      door,
      who: NAMES[Math.floor(Math.random() * NAMES.length)],
      what: FOOD[Math.floor(Math.random() * FOOD.length)],
      timer: Math.round(22 + dist / 8.5),
      dist,
      hits: 0,
    };
    this.dropMarker.at(door.x, door.z);
    this.dropMarker.visible = true;
    this.lastHealth = this.bike ? this.bike.health : 0;
    g.hud.toast(`Order up: ${this.order.what} for ${this.order.who} (red on the map)`);
  }

  private deliver() {
    const g = this.game;
    const o = this.order!;
    const base = 35;
    const tip = Math.max(0, Math.round(o.timer * 1.6 - o.hits * 12));
    g.cash += base + tip;
    this.earned += base + tip;
    this.done++;
    g.audio.cue('cash');
    if (this.done >= DROPS) {
      g.cash += 250;
      this.earned += 250;
      this.order = null;
      this.dropMarker.visible = false;
      g.hud.bigMessage('SHIFT DONE', `${DROPS} orders · $${this.earned.toLocaleString()} with the $250 bonus`, '#7dff9a');
      this.release();
      g.saveGame.save();
      return;
    }
    g.hud.bigMessage('DELIVERED', `${o.who}: +$${base}${tip ? `  ·  tip $${tip}` : '  ·  no tip'}`, '#7dff9a');
    this.next();
  }

  private end(why: string) {
    const g = this.game;
    this.order = null;
    this.dropMarker.visible = false;
    g.hud.bigMessage('SHIFT OVER', `${why} · ${this.done} delivered · $${this.earned.toLocaleString()}`, '#ff9a5a');
    g.audio.cue('fail');
    this.release();
  }

  private release() {
    if (this.bike) this.bike.persistent = false;
    this.bike = null;
  }

  update(dt: number) {
    const g = this.game;
    if (this.busy > 0) this.busy -= dt;
    const pl = g.player;
    if (this.marker) {
      this.marker.spin(g.elapsed);
      this.marker.visible = !this.order;
    }
    this.dropMarker.spin(g.elapsed);
    const o = this.order;
    if (!o) {
      // at the shop door, on foot: start a shift
      const d = this.door;
      if (!d || pl.vehicle || pl.dead) return;
      if (Math.hypot(pl.pos.x - d.x, pl.pos.z - d.z) > 1.8) return;
      if (g.missions.active || g.activities.active) return g.hud.prompt('Mango Takeout · finish what you’re doing first');
      if (g.wanted.level > 0) return g.hud.prompt('Mango Takeout · <b>lose the police first</b>');
      g.hud.prompt('<kbd>T</kbd> Start a delivery shift · Mango Takeout');
      if (g.input.hit('KeyT') && this.busy <= 0) {
        this.busy = 1;
        this.start();
      }
      return;
    }
    // on the clock
    o.timer -= dt;
    const ref = pl.vehicle ? pl.vehicle.pos : pl.pos;
    o.dist = Math.hypot(o.door.x - ref.x, o.door.z - ref.z);
    const b = this.bike;
    if (b) {
      // knocks on the way cost the tip
      if (b.health < this.lastHealth - 8) o.hits++;
      this.lastHealth = b.health;
    }
    if (pl.dead) return this.end('You went down');
    if (g.wanted.level >= 2) return this.end('Too much heat');
    if (!b || b.wrecked || b.sunk || !g.vehicles.includes(b)) return this.end('The bike is gone');
    if (o.timer <= 0) return this.end(`${o.who}’s order went cold`);
    const slow = !pl.vehicle || Math.abs(pl.vehicle.speed) < 3;
    if (o.dist < 3.2 && slow) this.deliver();
  }
}

function signMaterial() {
  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 100;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1d6b3a';
  x.fillRect(0, 0, 360, 100);
  x.fillStyle = '#ffa03c';
  x.beginPath();
  x.ellipse(52, 50, 30, 36, 0.5, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#fff6e0';
  x.textAlign = 'left';
  x.font = '900 42px system-ui, sans-serif';
  x.fillText('MANGO', 100, 52);
  x.font = '700 22px system-ui, sans-serif';
  x.fillText('TAKEOUT · DELIVERY', 102, 82);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
}
