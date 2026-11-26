// Harbor Exports: a buyer at the marina crane lot wants five vehicles at a time. Find one of each
// (steal one off the street or out of a driveway), bring it to the lot and stop in the yellow
// box: paid by the model and how much of it is still in one piece. Clear the list for a bonus
// and a new one. The list and what's been delivered go in the save.
import { SPECS, type CarType } from '../entities/carModels';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

const PRICE: Partial<Record<CarType, number>> = {
  sedan: 450,
  suv: 700,
  pickup: 650,
  taxi: 500,
  van: 600,
  sports: 1400,
  bike: 550,
  police: 1800,
  ambulance: 1500,
};
const POOL = Object.keys(PRICE) as CarType[];
const DROP = { x: 400, z: 300 };

export class Exports {
  list: CarType[] = [];
  delivered = new Set<CarType>();
  private marker: Marker;
  private busy = 0;

  constructor(private game: Game) {
    this.marker = new Marker(game.scene, 0xffd23f, 4, 2.5);
    this.marker.at(DROP.x, DROP.z);
    this.newList();
  }

  newList() {
    const pool = [...POOL].sort(() => Math.random() - 0.5);
    this.list = pool.slice(0, 5);
    this.delivered.clear();
  }

  get remaining() {
    return this.list.filter((t) => !this.delivered.has(t));
  }

  /** the phone's line for the list */
  get summary() {
    const r = this.remaining;
    return r.length ? r.map((t) => SPECS[t].label).join(', ') : 'list done';
  }

  get blips(): Blip[] {
    return [{ x: DROP.x, z: DROP.z, color: '#ffd23f', label: 'E', kind: 'mission' }];
  }

  get drop() {
    return DROP;
  }

  update(dt: number) {
    const g = this.game;
    if (this.busy > 0) {
      this.busy -= dt;
      return;
    }
    const v = g.player.vehicle;
    if (!v || v.isBoat) return;
    const d = Math.hypot(v.pos.x - DROP.x, v.pos.z - DROP.z);
    if (d > 22) return;
    const wanted = this.list.includes(v.type) && !this.delivered.has(v.type);
    if (d > 4.5) {
      g.hud.prompt(wanted ? `Harbor Exports · they want the <b>${SPECS[v.type].label}</b>: stop in the yellow box` : `Harbor Exports · not on the list (${this.remaining.length} wanted)`);
      return;
    }
    if (!wanted) {
      g.hud.prompt(`Harbor Exports · wanted: ${this.summary}`);
      return;
    }
    if (g.wanted.level > 0) {
      g.hud.prompt('Harbor Exports · <b>not with the cops on you</b>');
      return;
    }
    if (v.speed > 1.2) {
      g.hud.prompt('Harbor Exports · stop in the box');
      return;
    }
    // sold: out you get, the car goes on the ship
    const cond = Math.max(0.15, Math.min(1, v.health / v.spec.health));
    const pay = Math.round((PRICE[v.type] ?? 400) * cond);
    this.delivered.add(v.type);
    this.busy = 2;
    g.exitVehicle();
    v.persistent = false;
    setTimeout(() => {
      if (g.vehicles.includes(v) && v.driver !== 'player') g.removeVehicle(v);
    }, 1500);
    g.addCash(pay);
    const left = this.remaining.length;
    g.hud.bigMessage('EXPORTED', `${SPECS[v.type].label} · +$${pay}${cond < 0.95 ? `  (${Math.round(cond * 100)}% condition)` : ''}`, '#ffd23f');
    g.audio.cue('cash');
    if (left === 0) {
      setTimeout(() => {
        g.addCash(2500);
        g.hud.bigMessage('LIST CLEARED', '+$2,500 bonus · a new list is up', '#ffd23f');
        this.newList();
        g.saveGame.save();
      }, 2600);
    } else {
      setTimeout(() => g.hud.toast(`Still wanted: ${this.summary}`), 2600);
      g.saveGame.save();
    }
  }
}
