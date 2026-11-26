// Side activities you can do any time: street races against three rivals through the city's
// streets, and taxi fares when you're driving a cab.
import * as THREE from 'three';
import { clamp, wrapAngle } from '../core/math';
import { Human } from '../entities/humans';
import type { CarAI, Vehicle } from '../entities/vehicle';
import { groundAt, type RNode } from '../world/map';
import { Marker, type Blip } from './missions';
import type { Game } from './game';

const RACE_ANCHORS = [
  { x: 600, z: -220, name: 'Shoreline Sprint' },
  { x: 120, z: 120, name: 'Downtown Dash' },
  { x: -300, z: -260, name: 'Sabal Loop' },
];

/** a rival: aims at its next checkpoint, brakes for the corners */
class RaceAI implements CarAI {
  cp = 0;
  done = false;
  constructor(private cps: THREE.Vector3[], private skill: number, public go = false) {}
  drive(v: Vehicle, _dt: number) {
    if (!this.go || this.done) {
      v.input.thr = 0;
      v.input.steer = 0;
      v.input.hand = true;
      return;
    }
    const t = this.cps[this.cp];
    const dx = t.x - v.pos.x, dz = t.z - v.pos.z;
    if (Math.hypot(dx, dz) < 12) {
      this.cp++;
      if (this.cp >= this.cps.length) {
        this.done = true;
        return;
      }
    }
    const ang = wrapAngle(Math.atan2(dx, dz) - v.heading);
    v.input.steer = clamp(ang * 2.2, -1, 1);
    const want = (36 - Math.min(1, Math.abs(ang) / 0.9) * 22) * this.skill;
    v.input.thr = clamp((want - v.forwardSpeed) * 0.35, -1, 1);
    v.input.hand = Math.abs(ang) > 1.1 && v.forwardSpeed > 14;
  }
}

interface Race {
  name: string;
  cps: THREE.Vector3[];
  rivals: Vehicle[];
  ais: RaceAI[];
  cp: number;
  countdown: number;
  finishers: number;
  t: number;
  outT: number;
}

interface Fare {
  stage: 'pickup' | 'ride';
  ped: Human;
  dest: THREE.Vector3;
  timer: number;
  dist: number;
  /** pickup to destination, for the fare */
  d0: number;
}

export class Activities {
  private raceMarkers: Marker[] = [];
  private starts: { node: RNode; name: string }[] = [];
  race: Race | null = null;
  fare: Fare | null = null;
  taxiOn = false;
  private cpMarker: Marker;
  private destMarker: Marker;
  private nextFareT = 0;
  private cooldown = 0;
  private hold = 0;

  constructor(private game: Game) {
    const nodes = game.map.nodes.filter((n) => n.edges.length >= 3);
    for (const a of RACE_ANCHORS) {
      let best = nodes[0], bd = 1e9;
      for (const n of nodes) {
        const d = Math.hypot(n.x - a.x, n.z - a.z);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      this.starts.push({ node: best, name: a.name });
      this.raceMarkers.push(new Marker(game.scene, 0xffffff, 3.2, 5).at(best.x, best.z));
    }
    this.cpMarker = new Marker(game.scene, 0xffd23f, 6, 12);
    this.cpMarker.visible = false;
    this.destMarker = new Marker(game.scene, 0x7dff9a, 4, 8);
    this.destMarker.visible = false;
  }

  get active() {
    return !!this.race || (this.taxiOn && !!this.fare);
  }
  get title() {
    return this.race ? this.race.name : 'Taxi';
  }
  get objective() {
    const r = this.race;
    if (r) {
      if (r.countdown > 0) return `Get ready… ${Math.ceil(r.countdown)}`;
      return `Checkpoint ${Math.min(r.cp + 1, r.cps.length)} / ${r.cps.length}  ·  Position ${this.position()}`;
    }
    const f = this.fare;
    if (!f) return '';
    return f.stage === 'pickup' ? 'Pick up the fare (green)' : `Drop them off  ·  ${Math.round(f.dist)} m`;
  }
  get timer(): number | null {
    if (this.race) return this.race.countdown > 0 ? null : this.race.t;
    return this.fare && this.fare.stage === 'ride' ? this.fare.timer : null;
  }

  get blips(): Blip[] {
    const out: Blip[] = [];
    if (this.race) {
      const c = this.race.cps[this.race.cp];
      if (c) out.push({ x: c.x, z: c.z, color: '#ffd23f', label: '', kind: 'dest' });
      return out;
    }
    if (this.fare) {
      const p = this.fare.stage === 'pickup' ? this.fare.ped.pos : this.fare.dest;
      out.push({ x: p.x, z: p.z, color: '#7dff9a', label: '', kind: 'dest' });
      return out;
    }
    for (const s of this.starts) out.push({ x: s.node.x, z: s.node.z, color: '#ffffff', label: 'R', kind: 'mission' });
    return out;
  }

  private position() {
    const r = this.race!;
    const me = this.game.player.vehicle;
    if (!me) return '-';
    const score = (cp: number, v: Vehicle) => cp * 1000 - (r.cps[cp] ? Math.hypot(r.cps[cp].x - v.pos.x, r.cps[cp].z - v.pos.z) : 0);
    const mine = score(r.cp, me);
    let ahead = 0;
    r.ais.forEach((ai, i) => {
      if (ai.done || score(ai.cp, r.rivals[i]) > mine) ahead++;
    });
    return `${ahead + 1} / ${r.ais.length + 1}`;
  }

  /** a route: a walk along the road graph from the start, keeping as straight as it can */
  private route(start: RNode): THREE.Vector3[] {
    const m = this.game.map;
    const out: THREE.Vector3[] = [];
    const seen = new Set<number>([start.id]);
    let cur = start, prevDx = 0, prevDz = 0;
    for (let k = 0; k < 9; k++) {
      const opts = cur.edges.map((e) => m.edges[e]).filter((e) => !e.swamp).map((e) => {
        const to = m.nodes[e.a === cur.id ? e.b : e.a];
        const dx = (to.x - cur.x) / (e.len || 1), dz = (to.z - cur.z) / (e.len || 1);
        return { to, score: (prevDx * dx + prevDz * dz) * 0.6 + Math.random() };
      }).filter((o) => !seen.has(o.to.id));
      if (!opts.length) break;
      opts.sort((a, b) => b.score - a.score);
      const nx = opts[0].to;
      prevDx = (nx.x - cur.x) / (Math.hypot(nx.x - cur.x, nx.z - cur.z) || 1);
      prevDz = (nx.z - cur.z) / (Math.hypot(nx.x - cur.x, nx.z - cur.z) || 1);
      seen.add(nx.id);
      out.push(new THREE.Vector3(nx.x, groundAt(nx.x, nx.z), nx.z));
      cur = nx;
    }
    return out;
  }

  private startRace(i: number) {
    const g = this.game;
    const me = g.player.vehicle!;
    const s = this.starts[i];
    const cps = this.route(s.node);
    if (cps.length < 4) return;
    const rivals: Vehicle[] = [], ais: RaceAI[] = [];
    const fx = me.fwdX(), fz = me.fwdZ(), rx = -fz, rz = fx;
    const grid = [[4.2, 0], [-4.2, 0], [0, -8]];
    grid.forEach(([side, back], k) => {
      const v = g.spawnCar(k === 0 ? 'sports' : k === 1 ? 'sedan' : 'sports', me.pos.x + rx * side + fx * back, me.pos.z + rz * side + fz * back, me.heading);
      v.persistent = true;
      v.driver = 'npc';
      const ai = new RaceAI(cps, 0.86 + Math.random() * 0.16);
      v.ai = ai;
      rivals.push(v);
      ais.push(ai);
    });
    this.race = { name: s.name, cps, rivals, ais, cp: 0, countdown: 3.5, finishers: 0, t: 0, outT: 0 };
    this.raceMarkers.forEach((m) => (m.visible = false));
    g.hud.bigMessage(s.name, 'Street race · first across the line takes $2,000', '#ffd23f');
    g.audio.cue('start');
  }

  private endRace(msg: string, sub: string, color: string, cash: number) {
    const g = this.game;
    const r = this.race!;
    for (const v of r.rivals) {
      v.persistent = false;
      v.despawnable = true;
    }
    for (const ai of r.ais) ai.done = true;
    this.race = null;
    this.cpMarker.visible = false;
    this.raceMarkers.forEach((m) => (m.visible = true));
    this.cooldown = 8;
    if (cash > 0) g.addCash(cash);
    g.hud.bigMessage(msg, sub, color);
    g.audio.cue(cash > 0 ? 'pass' : 'fail');
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    const car = p.vehicle;
    this.raceMarkers.forEach((m) => m.spin(g.elapsed));
    this.cpMarker.spin(g.elapsed);
    this.destMarker.spin(g.elapsed);
    if (this.cooldown > 0) this.cooldown -= dt;

    // ---- the race
    const r = this.race;
    if (r) {
      if (r.countdown > 0) {
        r.countdown -= dt;
        if (car) {
          car.vx *= 0.5;
          car.vz *= 0.5;
        }
        if (r.countdown <= 0) {
          r.ais.forEach((a) => (a.go = true));
          g.hud.bigMessage('GO!', '', '#7dff9a');
        }
      } else r.t += dt;
      const c = r.cps[r.cp];
      if (c) this.cpMarker.at(c.x, c.z).visible = true;
      if (!car || car.wrecked) {
        r.outT += dt;
        if (r.outT > 8) this.endRace('RACE LOST', 'You left your car', '#ff5a5a', 0);
        return;
      }
      r.outT = 0;
      if (g.wanted.level >= 3) {
        this.endRace('RACE CALLED OFF', 'Too much heat', '#ff5a5a', 0);
        return;
      }
      if (c && Math.hypot(c.x - car.pos.x, c.z - car.pos.z) < 12) {
        r.cp++;
        g.audio.cue('cash');
        if (r.cp >= r.cps.length) {
          const place = 1 + r.ais.filter((a) => a.done).length;
          const prize = [2000, 800, 300, 0][place - 1];
          this.endRace(place === 1 ? 'YOU WIN' : `${place}${['st', 'nd', 'rd', 'th'][place - 1]} PLACE`, prize ? `+$${prize.toLocaleString()}  ·  ${r.t.toFixed(1)} s` : `${r.t.toFixed(1)} s`, place === 1 ? '#7dff9a' : '#ffd23f', prize);
        }
      }
      return;
    }

    // ---- a race start: roll in and stop
    if (car && !car.isBoat && !g.missions.active && this.cooldown <= 0 && !this.fare) {
      let inCircle = false;
      this.starts.forEach((s, i) => {
        if (Math.hypot(s.node.x - car.pos.x, s.node.z - car.pos.z) < 6) {
          inCircle = true;
          if (g.wanted.level > 0) g.hud.prompt('Lose the cops before racing');
          else if (car.speed > 1.5) {
            this.hold = 0;
            g.hud.prompt(`Stop in the circle to race · ${s.name}`);
          } else {
            // wait a moment, so stopping at this junction doesn't start a race by accident
            this.hold += dt;
            g.hud.prompt(`${s.name} starts in ${Math.ceil(2 - this.hold)}… drive off to cancel`);
            if (this.hold >= 2) {
              this.hold = 0;
              this.startRace(i);
            }
          }
        }
      });
      if (!inCircle) this.hold = 0;
    }

    // ---- taxi
    const inCab = !!car && car.type === 'taxi';
    if (inCab && !g.missions.active) {
      if (g.input.hit('KeyT')) {
        this.taxiOn = !this.taxiOn;
        g.hud.toast(this.taxiOn ? 'On duty: fares will call in' : 'Off duty');
        this.nextFareT = 1;
        if (!this.taxiOn) this.clearFare();
      }
      if (!this.taxiOn && !this.fare) g.hud.prompt('<kbd>T</kbd> Go on duty (taxi fares)');
    } else if (this.taxiOn && !car) {
      this.taxiOn = false;
      this.clearFare();
      g.hud.toast('Off duty');
    }
    if (!this.taxiOn || !car) return;
    const f = this.fare;
    if (!f) {
      this.nextFareT -= dt;
      if (this.nextFareT <= 0) this.newFare();
      return;
    }
    if (f.ped.dead || !g.npcs.includes(f.ped)) {
      this.clearFare();
      g.hud.toast('Your fare didn’t make it');
      return;
    }
    if (f.stage === 'pickup') {
      this.destMarker.at(f.ped.pos.x, f.ped.pos.z).visible = true;
      if (Math.hypot(f.ped.pos.x - car.pos.x, f.ped.pos.z - car.pos.z) < 9 && car.speed < 2) {
        f.stage = 'ride';
        f.ped.hidden = true;
        f.ped.state = 'wait';
        f.dist = Math.hypot(f.dest.x - car.pos.x, f.dest.z - car.pos.z);
        f.timer = f.dist / 11 + 18;
        g.hud.subtitle(['PASSENGER: Take me to the address on your screen, please.', 'PASSENGER: I’m late. Step on it.', 'PASSENGER: Scenic route is fine, but not too scenic.'][Math.floor(Math.random() * 3)]);
      }
    } else {
      f.timer -= dt;
      f.dist = Math.hypot(f.dest.x - car.pos.x, f.dest.z - car.pos.z);
      this.destMarker.at(f.dest.x, f.dest.z).visible = true;
      if (f.dist < 10 && car.speed < 2) {
        const base = 25 + Math.round(f.d0 * 0.35);
        const tip = Math.max(0, Math.round(f.timer * 3));
        g.addCash(base + tip);
        g.hud.bigMessage('FARE PAID', `+$${base}${tip ? `  ·  tip $${tip}` : ''}`, '#7dff9a');
        g.audio.cue('cash');
        this.dropOff();
      } else if (f.timer <= 0) {
        g.hud.toast('Too slow: the passenger walked off without paying');
        this.dropOff();
      }
    }
  }

  private newFare() {
    const g = this.game;
    const car = g.player.vehicle!;
    const paths = g.peds.paths.filter((p) => !p.beach);
    const pick = (min: number, max: number) => {
      for (let a = 0; a < 40; a++) {
        const p = paths[Math.floor(Math.random() * paths.length)];
        const x = Math.random() < 0.5 ? p.x0 : p.x1, z = p.z0 + (p.z1 - p.z0) * Math.random();
        const d = Math.hypot(x - car.pos.x, z - car.pos.z);
        if (d > min && d < max) return new THREE.Vector3(x, groundAt(x, z), z);
      }
      return null;
    };
    const at = pick(50, 150), dest = pick(250, 650);
    if (!at || !dest) {
      this.nextFareT = 2;
      return;
    }
    const ped = new Human('ped');
    ped.pos.copy(at);
    ped.state = 'wait';
    ped.clip = 'idle';
    ped.stateT = 1e9;
    g.addNpc(ped);
    this.fare = { stage: 'pickup', ped, dest, timer: 0, dist: 0, d0: Math.hypot(dest.x - at.x, dest.z - at.z) };
    g.hud.toast('New fare: pick them up (green on the map)');
  }

  private dropOff() {
    const f = this.fare!;
    const g = this.game;
    const car = g.player.vehicle;
    if (car) {
      f.ped.pos.set(car.pos.x - car.fwdZ() * 2.5, car.pos.y, car.pos.z + car.fwdX() * 2.5);
    }
    f.ped.hidden = false;
    f.ped.state = 'walk';
    f.ped.clip = '';
    this.fare = null;
    this.destMarker.visible = false;
    this.nextFareT = 4;
  }

  private clearFare() {
    if (this.fare) {
      this.fare.ped.hidden = false;
      this.fare.ped.state = 'walk';
      this.fare.ped.clip = '';
    }
    this.fare = null;
    this.destMarker.visible = false;
  }
}

