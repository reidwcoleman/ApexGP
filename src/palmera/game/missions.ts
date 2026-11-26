// Three short original story jobs with map markers and cash rewards.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle';
import { BEACH, groundAt } from '../world/map';
import type { Game } from './game';
import { FleeAI, TrafficAI } from './traffic';

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
  /** the camera, set by the game: a marker's glowing wall fades out as you get right up to it */
  static camera: THREE.Camera | null = null;
  group = new THREE.Group();
  private wall: THREE.MeshBasicMaterial;
  constructor(scene: THREE.Scene, color: number, radius: number, height = 6) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.wall = mat;
    Marker.all.add(this);
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
    Marker.all.delete(this);
  }
  private static all = new Set<Marker>();
  /** every frame: seen from close by, a wall would tint half the screen, so it fades out inside ~14 m */
  static fadeNear() {
    const c = Marker.camera;
    if (!c) return;
    for (const m of Marker.all) {
      const d = Math.hypot(c.position.x - m.group.position.x, c.position.z - m.group.position.z);
      m.wall.opacity = 0.3 * Math.min(1, Math.max(0, (d - 5) / 9));
    }
  }
}

const near = (a: THREE.Vector3, x: number, z: number, r: number) => Math.hypot(a.x - x, a.z - z) < r;

/** checkpoints: a walk along the roads from a junction, keeping fairly straight */
function roadRoute(game: Game, start: number, n: number): THREE.Vector3[] {
  const m = game.map;
  const out: THREE.Vector3[] = [];
  const seen = new Set<number>([start]);
  let cur = m.nodes[start], pdx = 0, pdz = 0;
  for (let k = 0; k < n; k++) {
    const opts = cur.edges.map((e) => m.edges[e]).filter((e) => !e.swamp).map((e) => m.nodes[e.a === cur.id ? e.b : e.a]).filter((o) => !seen.has(o.id));
    if (!opts.length) break;
    opts.sort((a, b) => {
      const s = (o: typeof a) => ((o.x - cur.x) * pdx + (o.z - cur.z) * pdz) / (Math.hypot(o.x - cur.x, o.z - cur.z) || 1) * 0.5 + Math.random();
      return s(b) - s(a);
    });
    const nx = opts[0];
    const l = Math.hypot(nx.x - cur.x, nx.z - cur.z) || 1;
    pdx = (nx.x - cur.x) / l;
    pdz = (nx.z - cur.z) / l;
    seen.add(nx.id);
    out.push(new THREE.Vector3(nx.x, groundAt(nx.x, nx.z), nx.z));
    cur = nx;
  }
  return out;
}

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
  {
    id: 3,
    title: 'Paper Route',
    contact: 'Nina Calloway',
    start: { x: -232, z: 68 },
    reward: 2200,
    color: '#ffb020',
    intro: [
      'NINA: Envelope for a lawyer across Sabal Heights. Signed by noon or the deal dies.',
      'NINA: Take the bike. Hit every drop point, and don’t drop the bike — the envelope’s in the tail.',
    ],
    create(game) {
      const bike = new Vehicle('bike', 0xf2b705);
      bike.place(-237, 76, 0);
      bike.persistent = true;
      game.addVehicle(bike);
      const map = game.map;
      const cps = roadRoute(game, map.nodeIndex.get('-240,60') ?? map.nearestNode(-240, 60).id, 8);
      const mk = new Marker(game.scene, 0xffb020, 4.5, 8);
      let i = 0, time = 0, off = 0, started = false;
      const a: ActiveMission = {
        objective: 'Get on the courier bike',
        timer: null,
        blips: [],
        update(dt) {
          mk.spin(game.elapsed);
          const p = game.player;
          if (bike.wrecked || bike.sunk || bike.burnTimer > 0) {
            a.failReason = 'The bike is wrecked';
            return 'failed';
          }
          if (!started) {
            a.blips = [{ x: bike.pos.x, z: bike.pos.z, color: '#ffb020', label: 'Bike', kind: 'car' }];
            if (p.vehicle === bike) {
              started = true;
              time = 14 + cps.length * 11;
            }
            return 'running';
          }
          time -= dt;
          a.timer = time;
          const c = cps[i];
          mk.at(c.x, c.z);
          a.blips = [{ x: c.x, z: c.z, color: '#ffb020', label: '', kind: 'dest' }];
          a.objective = p.vehicle === bike ? `Drop point ${i + 1} / ${cps.length}` : 'Get back on the bike';
          off = p.vehicle === bike ? 0 : off + dt;
          if (off > 12) {
            a.failReason = 'You left the bike';
            return 'failed';
          }
          if (p.vehicle === bike && near(bike.pos, c.x, c.z, 9)) {
            i++;
            game.audio.cue('cash');
            if (i >= cps.length) return 'passed';
          }
          if (time <= 0) {
            a.failReason = 'The deal died';
            return 'failed';
          }
          return 'running';
        },
        cleanup() {
          mk.dispose(game.scene);
          bike.persistent = false;
        },
      };
      return a;
    },
  },
  {
    id: 4,
    title: 'Long Lens',
    contact: 'Teo Brandt',
    start: { x: 248, z: -412 },
    reward: 3500,
    color: '#c77dff',
    intro: [
      'TEO: My client thinks her business partner is cooking the books. He drives a silver sedan.',
      'TEO: Follow him. Not close enough to be seen, not so far you lose him. I just need to know where he goes.',
    ],
    create(game) {
      const car = new Vehicle('sedan', 0x2a2d31);
      car.place(244, -400, 0);
      car.persistent = true;
      game.addVehicle(car);
      const map = game.map;
      const from = map.nearestNode(240, -360);
      const to = map.nodes[map.otherEnd(map.edges[from.edges[0]], from.id)];
      const mark = new Vehicle('sedan', 0xc0c4c8);
      mark.place(from.x + 2, from.z + 2, Math.atan2(to.x - from.x, to.z - from.z));
      mark.driver = 'npc';
      mark.persistent = true;
      mark.missionTag = 'target';
      const ai = new TrafficAI(game, from.id, to.id);
      ai.cruise = 9;
      game.addVehicle(mark);
      let started = false, tail = 70, close = 0, far = 0;
      const a: ActiveMission = {
        objective: 'Get in the car',
        timer: null,
        blips: [],
        update(dt) {
          const p = game.player;
          if (!started) {
            mark.input.thr = 0;
            mark.input.hand = true;
            a.blips = [{ x: car.pos.x, z: car.pos.z, color: '#4dd2ff', label: 'Car', kind: 'car' }, { x: mark.pos.x, z: mark.pos.z, color: '#c77dff', label: 'Mark', kind: 'target' }];
            if (p.vehicle) {
              started = true;
              mark.ai = ai;
              game.hud.subtitle('TEO: He’s moving. Keep him in sight.');
            }
            return 'running';
          }
          if (mark.driver !== 'npc' || mark.wrecked) {
            a.failReason = 'You blew the tail';
            return 'failed';
          }
          const ref = p.vehicle ? p.vehicle.pos : p.pos;
          const d = Math.hypot(ref.x - mark.pos.x, ref.z - mark.pos.z);
          close = d < 14 ? close + dt : Math.max(0, close - dt);
          far = d > 110 ? far + dt : 0;
          tail -= dt;
          a.timer = tail;
          a.blips = [{ x: mark.pos.x, z: mark.pos.z, color: '#c77dff', label: 'Mark', kind: 'target' }];
          a.objective = d < 22 ? `Too close! Back off · ${Math.round(d)} m` : d > 85 ? `You’re losing him · ${Math.round(d)} m` : `Tail the silver sedan · ${Math.round(d)} m`;
          if (close > 3) {
            a.failReason = 'He spotted you';
            return 'failed';
          }
          if (far > 6) {
            a.failReason = 'You lost him';
            return 'failed';
          }
          if (tail <= 0) {
            game.hud.subtitle('TEO: That’s the place. Got it all on camera. Nice work.');
            return 'passed';
          }
          return 'running';
        },
        cleanup() {
          car.persistent = false;
          mark.persistent = false;
          mark.missionTag = '';
        },
      };
      return a;
    },
  },
  {
    id: 5,
    title: 'Gilded',
    contact: 'Celeste Marchetti',
    start: { x: 168, z: 148 },
    reward: 5000,
    color: '#ffd23f',
    intro: [
      'CELESTE: A collector in the south end keeps a gold coupe on his drive like a lawn ornament. My buyer wants it.',
      'CELESTE: It has a tracker; the police will know the moment you sit in it. Lose them, then bring it to the marina crane lot. Not a scratch.',
    ],
    create(game) {
      const prize = new Vehicle('sports', 0xd4af37);
      prize.place(-152, -330, Math.PI / 2);
      prize.persistent = true;
      prize.missionTag = 'cargo';
      game.addVehicle(prize);
      const dest = { x: 396, z: 308 };
      const mk = new Marker(game.scene, 0xffd23f, 4.5, 6).at(dest.x, dest.z);
      let taken = false;
      const a: ActiveMission = {
        objective: 'Steal the gold coupe',
        timer: null,
        blips: [],
        update() {
          mk.spin(game.elapsed);
          const p = game.player;
          const cond = Math.round((prize.health / prize.spec.health) * 100);
          if (prize.wrecked || prize.sunk || prize.burnTimer > 0 || cond < 50) {
            a.failReason = 'The coupe is ruined';
            return 'failed';
          }
          if (!taken) {
            a.blips = [{ x: prize.pos.x, z: prize.pos.z, color: '#ffd23f', label: 'Coupe', kind: 'car' }];
            if (p.vehicle === prize) {
              taken = true;
              game.wanted.setLevel(Math.max(2, game.wanted.level));
              game.hud.subtitle('CELESTE: There goes the tracker. Lose the heat first.');
            }
            return 'running';
          }
          const hot = game.wanted.level > 0;
          a.objective = p.vehicle !== prize ? 'Get back in the coupe' : hot ? `Lose the police · condition ${cond}%` : `Deliver to the marina crane lot · condition ${cond}%`;
          a.blips = hot ? [] : [{ x: dest.x, z: dest.z, color: '#ffd23f', label: 'Lot', kind: 'dest' }];
          if (p.vehicle !== prize) a.blips.push({ x: prize.pos.x, z: prize.pos.z, color: '#ffd23f', label: 'Coupe', kind: 'car' });
          if (!hot && p.vehicle === prize && near(prize.pos, dest.x, dest.z, 7) && prize.speed < 4) return 'passed';
          return 'running';
        },
        cleanup() {
          mk.dispose(game.scene);
          prize.persistent = false;
          prize.missionTag = '';
        },
      };
      return a;
    },
  },
  {
    id: 6,
    title: 'High Water',
    contact: 'Marisol Vane',
    start: { x: BEACH.x0 + 12, z: -196 },
    reward: 8000,
    color: '#7fd8ff',
    intro: [
      'MARISOL: There is a case on the roof of the tallest tower in town. The owner thinks the helipad is the safest place in Port Palmera.',
      'MARISOL: Take the Skylark on the sand here, set down on that pad, and the case is yours. The roof has an alarm. Bring it to the marina crane lot by air.',
    ],
    create(game) {
      const pads = [...game.city.helipads].sort((a, b) => b.y0 + b.h - (a.y0 + a.h));
      const pad = pads[0];
      const pc = pad ? game.city.padAt.get(pad) ?? pad : null;
      const roof = pad && pc ? { x: pc.x, y: pad.y0 + pad.h, z: pc.z } : { x: 200, y: 120, z: -220 };
      const lot = { x: 400, z: 300 };
      const mkRoof = new Marker(game.scene, 0x7fd8ff, 5, 4);
      mkRoof.group.position.set(roof.x, roof.y + 0.2, roof.z);
      const mkLot = new Marker(game.scene, 0x7fd8ff, 7, 6).at(lot.x, lot.z);
      mkLot.group.visible = false;
      let stage: 'board' | 'pickup' | 'deliver' = 'board';
      const a: ActiveMission = {
        objective: 'Get in the Skylark on the sand',
        timer: null,
        blips: [],
        update() {
          mkRoof.spin(game.elapsed);
          mkLot.spin(game.elapsed);
          const ch = game.chopper;
          const c = ch.camera();
          if (stage === 'board') {
            const k = ch.crafts[0];
            a.blips = [{ x: k.pos.x, z: k.pos.z, color: '#7fd8ff', label: 'Skylark', kind: 'car' }];
            if (c) {
              stage = 'pickup';
              game.hud.subtitle('MARISOL: The tallest one. You cannot miss it. Set her down gently.');
            }
            return 'running';
          }
          if (!c) {
            a.objective = 'Get back in a Skylark';
            a.blips = ch.crafts.map((k) => ({ x: k.pos.x, z: k.pos.z, color: '#7fd8ff', label: 'Skylark', kind: 'car' as const }));
            return 'running';
          }
          if (stage === 'pickup') {
            a.objective = `Land on the helipad atop the tallest tower · ${Math.round(Math.hypot(c.x - roof.x, c.z - roof.z))} m`;
            a.blips = [{ x: roof.x, z: roof.z, color: '#7fd8ff', label: 'Pad', kind: 'dest' }];
            if (ch.grounded && Math.hypot(c.x - roof.x, c.z - roof.z) < 9 && c.y > roof.y) {
              stage = 'deliver';
              mkRoof.group.visible = false;
              mkLot.group.visible = true;
              game.wanted.setLevel(Math.max(3, game.wanted.level));
              game.audio.cue('pickup');
              game.hud.subtitle('MARISOL: You have it. And that is the alarm. Go, go!');
            }
            return 'running';
          }
          a.objective = `Fly the case to the marina crane lot · ${Math.round(Math.hypot(c.x - lot.x, c.z - lot.z))} m`;
          a.blips = [{ x: lot.x, z: lot.z, color: '#7fd8ff', label: 'Lot', kind: 'dest' }];
          if (ch.grounded && Math.hypot(c.x - lot.x, c.z - lot.z) < 14) return 'passed';
          return 'running';
        },
        cleanup() {
          mkRoof.dispose(game.scene);
          mkLot.dispose(game.scene);
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
    if (this.game.bodyShop) out.push(...this.game.bodyShop.blips);
    if (this.game.wardrobe) out.push(...this.game.wardrobe.blips);
    if (this.game.exports) out.push(...this.game.exports.blips);
    if (this.game.skyTours) out.push(...this.game.skyTours.blips);
    if (this.game.garages) out.push(...this.game.garages.blips);
    if (this.game.street) out.push(...this.game.street.blips);
    if (this.game.club) out.push(...this.game.club.blips);
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
      setTimeout(() => g.saveGame.save('Progress saved'), 3500);
      g.hud.bigMessage('JOB DONE', `+$${d.reward.toLocaleString()}`, '#7dff9a');
      g.audio.cue('pass');
      if (this.done.size === MISSIONS.length) setTimeout(() => g.hud.subtitle('Every job done. Port Palmera is yours to roam.'), 4000);
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
