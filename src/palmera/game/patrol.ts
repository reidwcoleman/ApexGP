// Patrol: in a police car, T starts a patrol. Dispatch calls in a fleeing suspect somewhere nearby
// (red on the minimap); run them down and stop their car (wreck it, or batter it below a quarter of
// its health) before the clock runs out. Each one stopped pays more and the next is faster. Missing
// one, or leaving the cruiser, ends the patrol.
import { Vehicle } from '../entities/vehicle';
import { GetawayAI } from './events';
import { TrafficAI } from './traffic';
import type { Blip } from './missions';
import type { Game } from './game';

export class Patrol {
  on = false;
  level = 0;
  suspect: Vehicle | null = null;
  private timer = 0;
  private next = 0;

  constructor(private game: Game) {}

  get blips(): Blip[] {
    return this.suspect ? [{ x: this.suspect.pos.x, z: this.suspect.pos.z, color: '#ff3b3b', label: '', kind: 'car' }] : [];
  }

  private stop(msg: string) {
    const g = this.game;
    this.on = false;
    if (this.suspect) {
      this.suspect.persistent = false;
      this.suspect.urgent = false;
    }
    this.suspect = null;
    g.hud.bigMessage('PATROL OVER', msg, '#4da6ff');
  }

  /** a suspect car on a road 100-230 m away, out of sight (many tries: few random roads fall in the ring) */
  private dispatch() {
    const g = this.game;
    const type = this.level >= 3 && Math.random() < 0.6 ? 'sports' : Math.random() < 0.5 ? 'sedan' : 'suv';
    const v = g.traffic.spawnOnRoad(100, 230, type, 300);
    if (!v) {
      this.next = 1;
      return;
    }
    const base = v.ai as TrafficAI;
    const ai = new GetawayAI(g, base.from, base.to, 21);
    ai.next = base.next;
    v.ai = ai;
    v.urgent = true;
    v.persistent = true;
    this.suspect = v;
    this.timer = 75;
    g.hud.bigMessage(`SUSPECT ${this.level + 1}`, 'fleeing a stolen car · stop them', '#ff5a5a');
    g.audio.cue('wanted');
  }

  update(dt: number) {
    const g = this.game;
    const car = g.player.vehicle;
    const cop = !!car && car.police && !car.wrecked;
    if (!this.on) {
      if (cop && !g.missions.active) {
        g.hud.prompt('<kbd>T</kbd> Start a patrol · <kbd>G</kbd> siren');
        if (g.input.hit('KeyT')) {
          this.on = true;
          this.level = 0;
          this.next = 2;
          g.hud.toast('On patrol: dispatch will call in suspects');
          g.audio.cue('start');
        }
      }
      return;
    }
    if (!cop) return this.stop(this.level ? `${this.level} stopped` : 'you left the cruiser');
    if (g.input.hit('KeyT')) return this.stop(`${this.level} stopped`);
    if (!this.suspect) {
      this.next -= dt;
      if (this.next <= 0) this.dispatch();
      return;
    }
    const s = this.suspect;
    this.timer -= dt;
    const d = Math.hypot(s.pos.x - car!.pos.x, s.pos.z - car!.pos.z);
    // stopped them
    if (s.wrecked || s.sunk || s.health < s.spec.health * 0.25) {
      this.level++;
      const pay = 250 + this.level * 150;
      g.addCash(pay);
      g.hud.bigMessage('SUSPECT STOPPED', `+$${pay}`, '#4da6ff');
      g.audio.cue('pass');
      s.persistent = false;
      s.urgent = false;
      this.suspect = null;
      this.next = 4;
      return;
    }
    if (this.timer <= 0 || !g.vehicles.includes(s) || d > 450) return this.stop(`the suspect got away · ${this.level} stopped`);
    // they get faster the further you go
    (s.ai as GetawayAI).cruise = 21 + Math.min(8, this.level * 1.5);
    g.hud.prompt(`Patrol · suspect ${this.level + 1} · ${Math.round(d)} m · <b>${Math.ceil(this.timer)} s</b>`);
  }
}
