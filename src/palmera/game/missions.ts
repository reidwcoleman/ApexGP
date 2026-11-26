// Three short original story jobs with map markers and cash rewards.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle';
import { groundAt } from '../world/map';
import type { Game } from './game';
import { FleeAI } from './traffic';

export interface Blip {
  x: number;
  z: number;
  color: string;
  label: string;
  kind: 'mission' | 'dest' | 'target' | 'car';
}

type Status = 'running' | 'passed' | 'failed';

interface MissionDef {
  id: number;
  title: string;
  contact: string;
  start: { x: number; z: number };
  reward: number;
  color: string;
  intro: string[];
  create(game: Game, m: Missions): ActiveMission;
}

interface ActiveMission {
  objective: string;
  timer: number | null;
  blips: Blip[];
  update(dt: number): Status;
  failReason?: string;
  cleanup(): void;
}

export class Marker {
  group = new THREE.Group();
  constructor(scene: THREE.Scene, color: number, radius: number, height = 6) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28, 1, true), mat);
    cyl.position.y = height / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    this.group.add(cyl, ring);
    scene.add(this.group);
  }
  at(x: number, z: number) {
    this.group.position.set(x, groundAt(x, z), z);
    return this;
  }
  set visible(v: boolean) {
    this.group.visible = v;
  }
  spin(t: number) {
    this.group.rotation.y = t;
    const s = 1 + Math.sin(t * 3) * 0.04;
    this.group.scale.set(s, 1, s);
  }
  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}

const near = (a: THREE.Vector3, x: number, z: number, r: number) => Math.hypot(a.x - x, a.z - z) < r;

export const MISSIONS: MissionDef[] = [
  {
    id: 0,
    title: 'Bayline Exit',
    contact: 'Marisol Vey',
    start: { x: 170, z: 70 },
    reward: 2500,
    color: '#ff6fa5',
    intro: [
      'MARISOL: My cousin’s crew is about to walk out of Bayline Savings with a bag that isn’t theirs.',
      'MARISOL: Their driver got cold feet. The green sedan on the corner is yours. Don’t scratch the paint.',
    ],
    create(game, m) {
      const car = new Vehicle('sedan', 0x2f6b47);
      car.place(157, 100, 0);
      car.persistent = true;
      car.missionTag = 'getaway';
      game.addVehicle(car);
      const bank = { x: 243, z: -300 };
      const lockup = { x: -163, z: 220 };
      const dest = new Marker(game.scene, 0xffd23f, 4.5, 4).at(bank.x, bank.z);
      dest.visible = false;
      let step = 0;
      let wait = 0;
      const a: ActiveMission = {
        objective: 'Get in the green getaway sedan',
        timer: null,
        blips: [],
        update(dt) {
          dest.spin(game.elapsed);
          if (car.wrecked || car.sunk || car.burnTimer > 0) {
            a.failReason = 'The getaway car is wrecked';
            return 'failed';
          }
          const p = game.player;
          a.blips = [];
          if (step === 0) {
            a.blips.push({ x: car.pos.x, z: car.pos.z, color: '#4dd2ff', label: 'Car', kind: 'car' });
            if (p.vehicle === car) {
              step = 1;
              dest.visible = true;
              dest.at(bank.x, bank.z);
              game.hud.subtitle('MARISOL: Bayline Savings, downtown on 3rd. Pull up out front and wait for them.');
            }
          } else if (step === 1) {
            a.objective = 'Drive to Bayline Savings downtown';
            a.blips.push({ x: bank.x, z: bank.z, color: '#ffd23f', label: 'Bank', kind: 'dest' });
            if (p.vehicle !== car) a.objective = 'Get back in the getaway car';
            if (p.vehicle === car && near(car.pos, bank.x, bank.z, 6) && car.speed < 3) {
              wait += dt;
              a.objective = `Wait for the crew… ${Math.max(0, 3 - wait).toFixed(1)}`;
              if (wait > 3) {
                step = 2;
                game.wanted.setLevel(2);
                game.hud.subtitle('CREW: GO GO GO! Silent alarm tripped — lose the cops!');
                dest.visible = false;
              }
            } else wait = 0;
          } else if (step === 2) {
            a.objective = 'Lose the cops';
            if (game.wanted.level === 0) {
              step = 3;
              dest.at(lockup.x, lockup.z);
              dest.visible = true;
              game.hud.subtitle('CREW: Nice driving. Take us to the lockup in Sabal Heights.');
            }
          } else if (step === 3) {
            a.objective = game.wanted.level > 0 ? 'Lose the cops before going to the lockup' : 'Drop the crew at the Sabal Heights lockup';
            a.blips.push({ x: lockup.x, z: lockup.z, color: '#ffd23f', label: 'Lockup', kind: 'dest' });
            if (p.vehicle === car && near(car.pos, lockup.x, lockup.z, 6.5) && game.wanted.level === 0 && car.speed < 4) return 'passed';
          }
          return 'running';
        },
        cleanup() {
          dest.dispose(game.scene);
          car.persistent = false;
          car.missionTag = '';
        },
      };
      void m;
      return a;
    },
  },
  {
    id: 1,
    title: 'Loose Lips',
    contact: 'Ray Ortega',
    start: { x: 90, z: -250 },
    reward: 3000,
    color: '#5fd3ff',
    intro: [
      'RAY: A guy named Dutch Pell is meeting the feds tonight. He’s leaving the garage right now in a yellow sports car.',
      'RAY: I don’t want him hurt. I want his ride turned into scrap so he misses that meeting. Take the SUV.',
    ],
    create(game) {
      const suv = new Vehicle('suv', 0x1d1f22);
      suv.place(83, -230, Math.PI);
      suv.persistent = true;
      game.addVehicle(suv);
      // Dutch starts a block east, heading east
      const map = game.map;
      const from = map.nodeIndex.get('80,-180')!, to = map.nodeIndex.get('160,-180')!;
      const dutch = new Vehicle('sports', 0xffd23f);
      dutch.place(110, -177, Math.PI / 2);
      dutch.driver = 'npc';
      dutch.persistent = true;
      dutch.missionTag = 'target';
      const ai = new FleeAI(game, from, to, 20);
      dutch.ai = ai;
      dutch.spec = { ...dutch.spec, health: 700 };
      dutch.health = 700;
      game.addVehicle(dutch);
      let time = 180;
      let started = false;
      const a: ActiveMission = {
        objective: 'Wreck Dutch’s yellow sports car',
        timer: time,
        blips: [],
        update(dt) {
          const p = game.player;
          if (!started) {
            // Dutch waits until the player is in a car or close
            dutch.input.thr = 0;
            dutch.input.hand = true;
            if (p.vehicle || near(p.pos, dutch.pos.x, dutch.pos.z, 25)) started = true;
            else {
              a.blips = [{ x: dutch.pos.x, z: dutch.pos.z, color: '#ff4040', label: 'Dutch', kind: 'target' }, { x: suv.pos.x, z: suv.pos.z, color: '#4dd2ff', label: 'SUV', kind: 'car' }];
              a.objective = 'Get in a car and catch Dutch';
              dutch.ai = null;
              return 'running';
            }
          }
          if (!dutch.ai && !dutch.wrecked && dutch.burnTimer === 0 && dutch.driver === 'npc') dutch.ai = ai;
          time -= dt;
          a.timer = time;
          a.objective = 'Wreck Dutch’s yellow sports car';
          a.blips = [{ x: dutch.pos.x, z: dutch.pos.z, color: '#ff4040', label: 'Dutch', kind: 'target' }];
          const ref = p.vehicle ? p.vehicle.pos : p.pos;
          const d = Math.hypot(ref.x - dutch.pos.x, ref.z - dutch.pos.z);
          if (d > 220) a.objective = 'Dutch is getting away! Close the gap';
          if (dutch.health <= dutch.spec.health * 0.12 || dutch.wrecked || dutch.burnTimer > 0 || dutch.sunk) {
            if (dutch.driver === 'npc') game.ejectDriver(dutch, true);
            dutch.ai = null;
            return 'passed';
          }
          if (dutch.driver !== 'npc') return 'passed';
          if (d > 300) {
            a.failReason = 'Dutch got away';
            return 'failed';
          }
          if (time <= 0) {
            a.failReason = 'Out of time';
            return 'failed';
          }
          return 'running';
        },
        cleanup() {
          suv.persistent = false;
          dutch.persistent = false;
          dutch.missionTag = '';
          if (dutch.ai === ai) dutch.ai = null;
        },
      };
      game.hud.subtitle('RAY: There he goes — yellow coupe. Ram him till it stops running.');
      return a;
    },
  },
  {
    id: 2,
    title: 'Cold Chain',
    contact: 'Captain Lou Abernathy',
    start: { x: 330, z: 230 },
    reward: 4000,
    color: '#7dff9a',
    intro: [
      'LOU: The Coral Crown Hotel ordered sixty pounds of stone crab and a cooler of something they won’t name.',
      'LOU: The ice is already melting. Get my pickup across the causeway to their kitchen door. Gently.',
    ],
    create(game) {
      const truck = new Vehicle('pickup', 0xece8dc);
      truck.place(323, 262, Math.PI);
      truck.persistent = true;
      truck.missionTag = 'cargo';
      game.addVehicle(truck);
      const dest = { x: 667, z: 300 };
      const mk = new Marker(game.scene, 0x7dff9a, 4.5, 4).at(dest.x, dest.z);
      let time = 115;
      let started = false;
      const a: ActiveMission = {
        objective: 'Get in the cooler pickup',
        timer: null,
        blips: [],
        update(dt) {
          mk.spin(game.elapsed);
          const p = game.player;
          const cond = Math.round((truck.health / truck.spec.health) * 100);
          if (truck.wrecked || truck.sunk || truck.burnTimer > 0 || cond < 45) {
            a.failReason = 'The cargo is ruined';
            return 'failed';
          }
          if (!started) {
            a.blips = [{ x: truck.pos.x, z: truck.pos.z, color: '#4dd2ff', label: 'Pickup', kind: 'car' }];
            if (p.vehicle === truck) {
              started = true;
              game.hud.subtitle('LOU: Clock’s running. Every bump costs me money.');
            }
            return 'running';
          }
          time -= dt;
          a.timer = time;
          a.objective = p.vehicle === truck ? `Deliver to the Coral Crown Hotel · cargo ${cond}%` : 'Get back in the pickup';
          a.blips = [{ x: dest.x, z: dest.z, color: '#7dff9a', label: 'Hotel', kind: 'dest' }];
          if (p.vehicle !== truck) a.blips.push({ x: truck.pos.x, z: truck.pos.z, color: '#4dd2ff', label: 'Pickup', kind: 'car' });
          if (p.vehicle === truck && near(truck.pos, dest.x, dest.z, 6.5) && truck.speed < 4) return 'passed';
          if (time <= 0) {
            a.failReason = 'The ice melted';
            return 'failed';
          }
          return 'running';
        },
        cleanup() {
          mk.dispose(game.scene);
          truck.persistent = false;
          truck.missionTag = '';
        },
      };
      return a;
    },
  },
];

export class Missions {
  active: ActiveMission | null = null;
  activeDef: MissionDef | null = null;
  done = new Set<number>();
  markers: Marker[] = [];
  cooldown = 0;
  private introQueue: string[] = [];
  private introT = 0;

  constructor(private game: Game) {
    for (const d of MISSIONS) {
      const col = new THREE.Color(d.color).getHex();
      this.markers.push(new Marker(game.scene, col, 2.2, 7).at(d.start.x, d.start.z));
    }
  }

  get blips(): Blip[] {
    const out: Blip[] = [];
    if (this.active) return this.active.blips;
    const act = this.game.activities;
    if (act && act.active) return act.blips;
    if (act) out.push(...act.blips);
    if (this.game.robbery) out.push(...this.game.robbery.blips);
    for (const d of MISSIONS) if (!this.done.has(d.id)) out.push({ x: d.start.x, z: d.start.z, color: d.color, label: String(d.id + 1), kind: 'mission' });
    return out;
  }

  start(id: number) {
    const g = this.game;
    const d = MISSIONS[id];
    if (!d || this.active) return;
    this.activeDef = d;
    this.markers.forEach((m) => (m.visible = false));
    g.hud.bigMessage(d.title, `A job for ${d.contact}`, d.color);
    g.audio.cue('start');
    this.introQueue = [...d.intro];
    this.introT = 0;
    this.active = d.create(g, this);
  }

  cancel(reason: string) {
    if (!this.active || !this.activeDef) return;
    this.finish('failed', reason);
  }

  private finish(st: Status, reason = '') {
    const g = this.game;
    const d = this.activeDef!;
    this.active?.cleanup();
    this.introQueue = [];
    this.active = null;
    this.activeDef = null;
    this.cooldown = 6;
    if (st === 'passed') {
      this.done.add(d.id);
      g.addCash(d.reward);
      g.hud.bigMessage('JOB DONE', `+$${d.reward.toLocaleString()}`, '#7dff9a');
      g.audio.cue('pass');
      if (this.done.size === MISSIONS.length) setTimeout(() => g.hud.subtitle('All three jobs done. Port Palmera is yours to roam.'), 4000);
    } else {
      g.hud.bigMessage('JOB FAILED', reason, '#ff5a5a');
      g.audio.cue('fail');
    }
    this.markers.forEach((m, i) => (m.visible = !this.done.has(i)));
  }

  update(dt: number) {
    const g = this.game;
    this.markers.forEach((m) => m.spin(g.elapsed));
    if (this.introQueue.length) {
      this.introT -= dt;
      if (this.introT <= 0) {
        g.hud.subtitle(this.introQueue.shift()!, 5);
        this.introT = 5;
      }
    }
    if (this.active) {
      const st = this.active.update(dt);
      if (st !== 'running') this.finish(st, this.active.failReason);
      return;
    }
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    const p = g.player;
    if (p.dead) return;
    const ref = p.vehicle ? p.vehicle.pos : p.pos;
    for (const d of MISSIONS) {
      if (this.done.has(d.id)) continue;
      if (near(ref, d.start.x, d.start.z, 2.6) && Math.abs(ref.y - groundAt(d.start.x, d.start.z)) < 3) {
        if (g.wanted.level > 0) {
          g.hud.prompt('Lose the cops before starting a job');
          return;
        }
        if (p.vehicle && p.vehicle.speed > 3) return;
        this.start(d.id);
        return;
      }
    }
  }

  get objective(): string {
    return this.active ? this.active.objective : '';
  }
  get timer(): number | null {
    return this.active ? this.active.timer : null;
  }
  get title(): string {
    return this.activeDef ? this.activeDef.title : '';
  }
}
