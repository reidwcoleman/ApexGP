import * as THREE from 'three';
import { ll } from '../geo.ts';
import type { Network } from '../roads.ts';
import { KEEP, WRECK, obbOverlap, type AICar, type Traffic } from '../ai/traffic.ts';
import type { Police } from '../ai/police.ts';
import type { Combat } from '../combat/Combat.ts';
import type { Hud } from '../ui/Hud.ts';
import type { Drivable, WorldCtx } from '../vehicles/drivable.ts';
import { FleetCar } from '../vehicles/FleetCar.ts';
import { Helicopter } from '../vehicles/Helicopter.ts';
import { Boat } from '../vehicles/Boat.ts';
import type { ModelId } from '../vehicles/fleet.ts';
import { planRoute } from '../ai/route.ts';
import { Beacon, Chevron } from './markers.ts';
import { Runner } from './Runner.ts';

/**
 * The story: Rafa Vega, a getaway driver back in Miami after two years away, owes forty grand to
 * Dante Cruz, who runs a club on South Beach and half of what moves through the port. Lola Marín,
 * who keeps a garage on Calle Ocho, puts him to work so he can pay it off — and then it all goes
 * wrong. Eight missions, played in order: each is offered at a letter on the map, starts when you
 * stop in its marker, and runs as a list of steps (talk, go somewhere — in a given vehicle, against
 * the clock —, take a vehicle, lose the police, wreck cars, run somebody down). Passing pays; the
 * cash and the progress are saved.
 */

export interface StoryHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  net: Network;
  traffic: Traffic;
  police: Police;
  combat: Combat;
  hud: Hud;
  owned: Drivable[];
  vehicle(): Drivable | null;
  focus(): THREE.Vector3;
  roadSpot(x: number, z: number): { x: number; y: number; z: number; yaw: number } | null;
  waterNear(x: number, z: number, clear: number): { x: number; z: number } | null;
  clearLand(x: number, z: number, r: number): { x: number; z: number } | null;
  roofNear(x: number, z: number, minY: number): { x: number; y: number; z: number } | null;
  addOwned(v: Drivable): void;
  dropOwned(v: Drivable): void;
  ctx(): WorldCtx;
}

type Who = 'LOLA' | 'RAFA' | 'TEO' | 'DANTE' | 'NICO';
interface Line {
  who: Who;
  text: string;
}
const WHO_COLOR: Record<Who, string> = { LOLA: '#ff7ab6', RAFA: '#57e8ff', TEO: '#9be22a', DANTE: '#ffb547', NICO: '#c9a7ff' };

type SpotKind = 'road' | 'land' | 'water' | 'roof';
const SPOTS: Record<string, { lat: number; lon: number; kind: SpotKind; minY?: number; clear?: number }> = {
  garage: { lat: 25.7656, lon: -80.2165, kind: 'road' },
  bayfront: { lat: 25.7752, lon: -80.1868, kind: 'road' },
  bayside: { lat: 25.7786, lon: -80.1882, kind: 'road' },
  ocean: { lat: 25.78, lon: -80.1302, kind: 'road' },
  downtown: { lat: 25.7745, lon: -80.193, kind: 'road' },
  brickell: { lat: 25.763, lon: -80.1928, kind: 'road' },
  watson: { lat: 25.7898, lon: -80.1745, kind: 'land', clear: 14 },
  tower: { lat: 25.7713, lon: -80.1902, kind: 'roof', minY: 70 },
  pad: { lat: 25.7675, lon: -80.2125, kind: 'land', clear: 12 },
  collins: { lat: 25.7848, lon: -80.1308, kind: 'road' },
  marina: { lat: 25.7781, lon: -80.1862, kind: 'water', clear: 4 },
  sea: { lat: 25.762, lon: -80.112, kind: 'water', clear: 70 },
  wynwood: { lat: 25.8005, lon: -80.1995, kind: 'road' },
};

interface PropDef {
  kind: 'parked' | 'runner' | 'heli' | 'boat';
  at: string;
  model?: ModelId;
  paint?: number;
  /** metres along the road from the spot (to line several cars up) */
  off?: number;
}

type Step =
  | { t: 'talk'; lines: Line[] }
  | { t: 'go'; to: string; text: string; r?: number; with?: 'any' | 'car' | 'heli' | 'boat' | string; time?: number; land?: boolean; say?: Line[]; stars?: number }
  | { t: 'take'; prop: string; text: string; say?: Line[] }
  | { t: 'lose'; stars: number; text: string; say?: Line[] }
  | { t: 'wreck'; props: string[]; text: string; say?: Line[] }
  | { t: 'chase'; prop: string; text: string; say?: Line[] };

interface Mission {
  id: string;
  title: string;
  blurb: string;
  giver: Who;
  /** where it is offered (the first one starts by itself) */
  at: string;
  reward: number;
  props: Record<string, PropDef>;
  steps: Step[];
}

const MISSIONS: Mission[] = [
  {
    id: 'back',
    title: 'Back in the 305',
    blurb: 'Two years gone. Lola wants a word.',
    giver: 'LOLA',
    at: 'brickell',
    reward: 500,
    props: {},
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: 'Rafa? Two years without a word, and you roll back into Brickell in that thing?' },
          { who: 'RAFA', text: "It's borrowed. Kind of." },
          { who: 'LOLA', text: 'Come to the garage on Calle Ocho. We need to talk about Dante.' },
        ],
      },
      { t: 'go', to: 'garage', text: "Drive to Lola's garage in Little Havana.", say: [{ who: 'RAFA', text: 'Calle Ocho. Some things never change.' }] },
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: 'You owe Dante Cruz forty grand. He says you skipped town with his money.' },
          { who: 'RAFA', text: 'I skipped town with my life.' },
          { who: 'LOLA', text: "Same thing, to him. Drive for me, pay him off, and maybe you get to stay." },
        ],
      },
    ],
  },
  {
    id: 'wheels',
    title: 'Hot Wheels',
    blurb: 'A client wants a Bravado Stallion. No scratches.',
    giver: 'LOLA',
    at: 'garage',
    reward: 2000,
    props: { stallion: { kind: 'parked', at: 'bayfront', model: 'muscle', paint: 0xe0b21d } },
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "A client wants a Bravado Stallion. There's a gold one parked by Bayfront Park." },
          { who: 'LOLA', text: 'Bring it here in one piece and you just made two grand.' },
        ],
      },
      { t: 'take', prop: 'stallion', text: 'Steal the gold Stallion by Bayfront Park.' },
      { t: 'go', to: 'garage', with: 'stallion', text: "Take the Stallion to Lola's garage.", say: [{ who: 'RAFA', text: 'Now that is a V8.' }] },
      { t: 'talk', lines: [{ who: 'LOLA', text: "Beautiful. Leave the keys, I'll handle the plates." }] },
    ],
  },
  {
    id: 'heat',
    title: 'Heat',
    blurb: "Somebody gave the cops your plates.",
    giver: 'LOLA',
    at: 'garage',
    reward: 1500,
    props: {},
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "Rafa, the cops just ran your plates. Somebody tipped them off." },
          { who: 'RAFA', text: 'Dante.' },
          { who: 'LOLA', text: "Don't bring them here. Lose them first." },
        ],
      },
      { t: 'lose', stars: 2, text: 'Lose the police.' },
      { t: 'go', to: 'garage', text: 'Head back to the garage.', say: [{ who: 'RAFA', text: "Clean. Nobody's following." }] },
      { t: 'talk', lines: [{ who: 'LOLA', text: "Dante's testing you. Next time it won't be two cruisers." }] },
    ],
  },
  {
    id: 'express',
    title: 'Express Delivery',
    blurb: 'A package for Ocean Drive. Against the clock.',
    giver: 'LOLA',
    at: 'garage',
    reward: 3000,
    props: {},
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "Pick up a package at Bayside. It goes to a friend on Ocean Drive." },
          { who: 'LOLA', text: "They pay double if it's there inside four minutes. Don't ask what's in it." },
        ],
      },
      { t: 'go', to: 'bayside', text: 'Pick up the package at Bayside.' },
      { t: 'go', to: 'ocean', time: 240, text: 'Deliver the package to Ocean Drive.', say: [{ who: 'RAFA', text: 'MacArthur Causeway, then straight down.' }] },
      { t: 'talk', lines: [{ who: 'LOLA', text: "They got it. You're faster than I remember." }] },
    ],
  },
  {
    id: 'rat',
    title: 'The Rat',
    blurb: 'Nico sold you out. He is leaving town.',
    giver: 'LOLA',
    at: 'garage',
    reward: 5000,
    props: { nico: { kind: 'runner', at: 'downtown', model: 'super', paint: 0xe0b21d } },
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "Nico Reyes. He's the one who told Dante where you went." },
          { who: 'LOLA', text: "He's leaving Downtown right now in a gold Vespera. Stop him." },
        ],
      },
      { t: 'go', to: 'downtown', r: 70, text: 'Get Downtown before Nico leaves.' },
      { t: 'chase', prop: 'nico', text: "Wreck Nico's car.", say: [{ who: 'NICO', text: "Rafa?! Dante said you were dead!" }] },
      { t: 'talk', lines: [{ who: 'RAFA', text: "Tell Dante I'm not.", }, { who: 'LOLA', text: 'Good. Now Dante knows you mean it.' }] },
    ],
  },
  {
    id: 'books',
    title: 'Up and Away',
    blurb: "Dante's books are on a roof Downtown.",
    giver: 'TEO',
    at: 'garage',
    reward: 6000,
    props: { heli: { kind: 'heli', at: 'watson' } },
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'TEO', text: "I'm Teo, Lola's cousin. I fly tourists over the bay, mostly." },
          { who: 'TEO', text: "Dante keeps his books in a case on a tower roof Downtown. My helicopter's on Watson Island." },
          { who: 'TEO', text: 'Grab the case and set down in the lot near the garage.' },
        ],
      },
      { t: 'go', to: 'watson', r: 9, text: "Get to Teo's helicopter on Watson Island." },
      { t: 'take', prop: 'heli', text: 'Get in the helicopter.', say: [{ who: 'TEO', text: 'W to tip forward, Space to climb. Gentle.' }] },
      { t: 'go', to: 'tower', with: 'heli', r: 16, text: 'Fly to the tower roof Downtown.' },
      { t: 'go', to: 'pad', with: 'heli', r: 22, land: true, text: 'Land in the lot near the garage.', say: [{ who: 'RAFA', text: 'Got the case. Coming home.' }] },
      { t: 'talk', lines: [{ who: 'LOLA', text: "Every boat, every bribe. Dante's whole business, in a briefcase." }] },
    ],
  },
  {
    id: 'burn',
    title: 'Burn It Down',
    blurb: "Dante's crew parks outside his club on Ocean Drive.",
    giver: 'LOLA',
    at: 'garage',
    reward: 8000,
    props: {
      c1: { kind: 'parked', at: 'collins', model: 'super', paint: 0x0b0c0e },
      c2: { kind: 'parked', at: 'collins', model: 'muscle', paint: 0x0b0c0e, off: 8 },
      c3: { kind: 'parked', at: 'collins', model: 'gwagon', paint: 0x0b0c0e, off: -8.5 },
    },
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "Dante knows about the books. He's coming for both of us." },
          { who: 'LOLA', text: "His crew keeps three black cars outside his club at the top of Ocean Drive. Burn them." },
        ],
      },
      { t: 'wreck', props: ['c1', 'c2', 'c3'], text: "Destroy Dante's three cars on Ocean Drive.", say: [{ who: 'RAFA', text: 'Guns or bumper. Either works.' }] },
      { t: 'lose', stars: 3, text: 'Lose the police.', say: [{ who: 'DANTE', text: "You just started a war, Vega." }] },
      { t: 'talk', lines: [{ who: 'LOLA', text: "That'll hurt him. Lie low. I'll call." }] },
    ],
  },
  {
    id: 'last',
    title: 'Last Run',
    blurb: 'Dante and the cops. Get to the boat.',
    giver: 'LOLA',
    at: 'garage',
    reward: 25000,
    props: { boat: { kind: 'boat', at: 'marina' } },
    steps: [
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "Dante's paid off half the department. They're coming here, all of them." },
          { who: 'LOLA', text: "There's a go-fast boat off Bayside. Get out to sea. I'll meet you in Bimini." },
          { who: 'RAFA', text: 'Lola —' },
          { who: 'LOLA', text: 'Go!' },
        ],
      },
      { t: 'go', to: 'marina', r: 12, stars: 4, text: 'Get to the boat at the Bayside marina.', say: [{ who: 'DANTE', text: "Every cop in Miami is looking for you, Rafa." }] },
      { t: 'take', prop: 'boat', text: 'Get in the boat.' },
      { t: 'go', to: 'sea', with: 'boat', r: 40, text: 'Get out to the open sea.', say: [{ who: 'RAFA', text: 'Come on, come on...' }] },
      {
        t: 'talk',
        lines: [
          { who: 'LOLA', text: "Rafa? Tell me you're out." },
          { who: 'RAFA', text: "Nothing but water and sunset. See you in Bimini." },
          { who: 'DANTE', text: "This isn't over, Vega." },
        ],
      },
    ],
  },
];

// ------------------------------------------------------------------------------- the engine

interface Prop {
  def: PropDef;
  ai?: AICar;
  runner?: Runner;
  vehicle?: Drivable;
  done?: boolean;
}

interface Active {
  m: Mission;
  i: number;
  props: Map<string, Prop>;
  /** the current step's state */
  begun: boolean;
  timer: number | null;
  target: { x: number; y: number; z: number; r: number } | null;
  /** seconds the runner has been out of reach */
  lost: number;
  /** seconds the title card shows before the steps start */
  intro: number;
}

const SAVE = 'apexgp.miami.story';

export class Story {
  progress = 0;
  cash = 0;
  private active: Active | null = null;
  private lines: (Line & { t: number })[] = [];
  private lineT = 0;
  private readonly beacon = new Beacon(0xffd23f);
  private readonly chev = new Chevron(0xffd23f);
  private readonly chev2 = new Chevron(0xff4d5e);
  private readonly chev3 = new Chevron(0xff4d5e);
  private t = 0;
  private cool = 0;
  private route: THREE.Vector3[] = [];
  private routeT = 0;
  private readonly spots = new Map<string, { x: number; y: number; z: number; yaw: number } | null>();
  /** what the HUD map draws (blips, the route) this frame */
  readonly blips: { x: number; z: number; color: string; size?: number; shape?: 'dot' | 'square'; edge?: boolean; label?: string }[] = [];
  routeOut: { x: number; z: number }[] | null = null;
  private objText = '';
  /** a mission just ended here: the next starts only after you've driven out of its marker */
  private needLeave = false;

  constructor(private readonly H: StoryHost) {
    H.scene.add(this.beacon.group, this.chev.mesh, this.chev2.mesh, this.chev3.mesh);
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) ?? '{}');
      this.progress = Math.min(MISSIONS.length, Number(s.progress) || 0);
      this.cash = Number(s.cash) || 0;
    } catch {
      /* private mode */
    }
    H.hud.setCash(this.cash);
  }

  get missions() {
    return MISSIONS.map((m, i) => ({ title: m.title, blurb: m.blurb, reward: m.reward, state: i < this.progress ? 'done' : i === this.progress ? 'next' : 'locked' }));
  }

  get playing() {
    return !!this.active;
  }

  private save() {
    try {
      localStorage.setItem(SAVE, JSON.stringify({ progress: this.progress, cash: this.cash }));
    } catch {
      /* private mode */
    }
  }

  reset() {
    if (this.active) this.end(false, '');
    this.progress = 0;
    this.cash = 0;
    this.save();
    this.H.hud.setCash(0);
  }

  // ---- places

  private spot(name: string) {
    if (this.spots.has(name)) return this.spots.get(name)!;
    const S = SPOTS[name];
    const p = ll(S.lat, S.lon);
    let out: { x: number; y: number; z: number; yaw: number } | null = null;
    if (S.kind === 'road') out = this.H.roadSpot(p.x, p.z);
    else if (S.kind === 'water') {
      const w = this.H.waterNear(p.x, p.z, S.clear ?? 14);
      if (w) out = { x: w.x, y: -1.1, z: w.z, yaw: 0 };
    } else if (S.kind === 'land') {
      const w = this.H.clearLand(p.x, p.z, S.clear ?? 10);
      if (w) out = { x: w.x, y: 0, z: w.z, yaw: 0 };
    } else {
      const r = this.H.roofNear(p.x, p.z, S.minY ?? 60);
      if (r) out = { ...r, yaw: 0 };
    }
    out ??= { x: p.x, y: 0, z: p.z, yaw: 0 };
    this.spots.set(name, out);
    return out;
  }

  // ---- talk

  private say(lines: Line[]) {
    for (const l of lines) this.lines.push({ ...l, t: Math.min(6.5, Math.max(2.6, l.text.length * 0.058)) });
  }

  private talking() {
    return this.lines.length > 0;
  }

  // ---- the loop

  /** the player was wasted or busted: a mission in hand fails */
  down(why: 'wasted' | 'busted') {
    if (this.active) this.end(false, why === 'wasted' ? 'You died.' : 'You got busted.');
  }

  update(dt: number) {
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    const H = this.H;
    // the subtitles
    if (this.lines.length) {
      const l = this.lines[0];
      if (this.lineT === 0) H.hud.subtitle(l.who, l.text, WHO_COLOR[l.who]);
      this.lineT += dt;
      if (this.lineT >= l.t) {
        this.lines.shift();
        this.lineT = 0;
        if (!this.lines.length) H.hud.subtitle('', '', '');
      }
    }
    this.blips.length = 0;
    this.routeOut = null;
    this.chev.hide();
    this.chev2.hide();
    this.chev3.hide();
    this.beacon.update(this.t, H.camera.position);
    if (!this.active) this.idle();
    else this.run(dt);
    // the GPS line to where we're going (re-planned now and then)
    const tgt = this.active?.target ?? (this.active ? null : this.nextStart());
    if (tgt && !(this.active && this.isAir())) {
      this.routeT -= dt;
      const f = H.focus();
      if (this.routeT <= 0) {
        this.routeT = 2.5;
        const v = H.vehicle();
        planRoute(H.net, f, v ? v.yaw : 0, tgt, this.route);
      }
      if (Math.hypot(tgt.x - f.x, tgt.z - f.z) > 40 && this.route.length) this.routeOut = this.route;
    }
  }

  private isAir() {
    const v = this.H.vehicle();
    return v instanceof Helicopter || v instanceof Boat;
  }

  private nextStart() {
    if (this.progress >= MISSIONS.length) return null;
    const m = MISSIONS[this.progress];
    const s = this.spot(m.at);
    return { x: s.x, y: s.y, z: s.z, r: 5 };
  }

  /** between missions: the next one's marker and its letter on the map */
  private idle() {
    const H = this.H;
    if (this.progress >= MISSIONS.length) {
      this.beacon.hide();
      return;
    }
    const m = MISSIONS[this.progress];
    // the first one rings you as you arrive
    if (this.progress === 0 && this.t > 2.5 && !this.cool) {
      this.start(m);
      return;
    }
    const s = this.spot(m.at);
    this.beacon.set(0xffd23f);
    this.beacon.place(s.x, s.y, s.z, 4);
    this.blips.push({ x: s.x, z: s.z, color: '#ffd23f', size: 7, edge: true, label: m.giver[0] });
    const f = H.focus();
    const v = H.vehicle();
    const sp = v ? Math.hypot(v.vel.x, v.vel.z) : 0;
    const d = Math.hypot(f.x - s.x, f.z - s.z);
    if (d > 9) this.needLeave = false;
    if (this.needLeave) return;
    if (d < 5.5 && Math.abs(f.y - s.y) < 4 && sp < 9 && !this.cool && H.police.wanted === 0) this.start(m);
    else if (d < 5.5 && H.police.wanted > 0 && !this.cool) {
      H.hud.toast('Lose the police first', 'warn');
      this.cool = 4;
    }
  }

  private start(m: Mission) {
    const H = this.H;
    this.beacon.hide();
    const a: Active = { m, i: 0, props: new Map(), begun: false, timer: null, target: null, lost: 0, intro: 3.2 };
    this.active = a;
    for (const [name, def] of Object.entries(m.props)) a.props.set(name, this.spawn(def));
    H.hud.missionTitle(m.title, `Mission ${MISSIONS.indexOf(m) + 1} of ${MISSIONS.length}`);
    this.lines.length = 0;
    this.lineT = 0;
  }

  private spawn(def: PropDef): Prop {
    const H = this.H;
    const s = this.spot(def.at);
    const p: Prop = { def };
    if (def.kind === 'parked' || def.kind === 'runner') {
      // (along the road from the spot, on the kerb side)
      const off = def.off ?? 0;
      const x = s.x + Math.sin(s.yaw) * off, z = s.z + Math.cos(s.yaw) * off;
      const c = H.traffic.spawnParked(def.model ?? 'sedan', x, s.y + 0.03, z, s.yaw, def.paint ?? 0xff3f8e);
      if (c) c.flags |= KEEP;
      if (c && def.kind === 'parked') p.ai = c;
      if (c && def.kind === 'runner') {
        const fc = new FleetCar(c, H.traffic);
        fc.aiDriven = true;
        fc.health = 1;
        p.vehicle = fc;
        p.runner = new Runner(fc, H.net);
        H.owned.push(fc);
      }
    } else if (def.kind === 'heli') {
      const h = new Helicopter('private');
      h.place(s.x, 0.05, s.z, Math.PI * 0.5);
      H.addOwned(h);
      p.vehicle = h;
    } else {
      const b = new Boat(0xf4f4f2, 0xff3f8e);
      b.place(s.x, 0, s.z, Math.PI * 0.5);
      H.addOwned(b);
      p.vehicle = b;
    }
    return p;
  }

  private cleanup(a: Active) {
    const H = this.H;
    for (const p of a.props.values()) {
      // (the cars are ordinary traffic again: cleared away once you're far off)
      if (p.ai) p.ai.flags &= ~KEEP;
      if (p.runner && p.vehicle) {
        const i = H.owned.indexOf(p.vehicle);
        if (i >= 0) H.owned.splice(i, 1);
        const fc = p.vehicle as FleetCar;
        fc.release();
        fc.car.flags &= ~KEEP;
      }
      // (a helicopter or boat left behind stays for the player to use)
    }
  }

  private end(pass: boolean, why: string) {
    const a = this.active;
    if (!a) return;
    this.cleanup(a);
    this.active = null;
    this.beacon.hide();
    this.lines.length = 0;
    this.lineT = 0;
    const H = this.H;
    H.hud.subtitle('', '', '');
    H.hud.setObjective('');
    H.hud.setTimer(null);
    H.hud.setTargetBar(null, 0);
    this.objText = '';
    if (pass) {
      this.progress = Math.max(this.progress, MISSIONS.indexOf(a.m) + 1);
      this.cash += a.m.reward;
      H.hud.setCash(this.cash);
      H.hud.missionResult(true, `+$${a.m.reward.toLocaleString('en-US')}`);
      this.save();
      if (this.progress >= MISSIONS.length) {
        H.police.clear();
        setTimeout(() => H.hud.missionTitle('The End', 'Rafa Vega made it out. Miami is yours to roam.'), 5000);
      }
      else setTimeout(() => H.hud.toast(`New mission: ${MISSIONS[this.progress].title} (${MISSIONS[this.progress].giver[0]} on the map)`), 4500);
    } else if (why) H.hud.missionResult(false, why);
    this.cool = 6;
    this.needLeave = true;
  }

  private objective(text: string) {
    if (text === this.objText) return;
    this.objText = text;
    this.H.hud.setObjective(text);
  }

  private run(dt: number) {
    const a = this.active!;
    const H = this.H;
    if (a.intro > 0) {
      a.intro -= dt;
      return;
    }
    const step = a.m.steps[a.i];
    if (!step) {
      // the last line spoken: passed
      if (!this.talking()) this.end(true, '');
      return;
    }
    if (!a.begun) {
      a.begun = true;
      a.target = null;
      a.timer = null;
      a.lost = 0;
      if (step.t === 'talk') this.say(step.lines);
      else {
        if ('say' in step && step.say) this.say(step.say);
        this.objective(step.text);
      }
      if (step.t === 'go' && step.time) a.timer = step.time;
      const stars = step.t === 'lose' ? step.stars : step.t === 'go' ? step.stars ?? 0 : 0;
      if (stars) {
        const P = H.police;
        if (P.wanted < stars) {
          P.wanted = stars;
          P.unseen = 0;
          P.lastSeen.copy(H.focus());
          for (const k of H.traffic.cars) if (k.police) k.flags |= 1;
          H.hud.setWanted(P.wanted, false, this.t);
        }
      }
    }
    const res = this.stepUpdate(a, step, dt);
    // the timer
    if (a.timer !== null) {
      a.timer -= dt;
      H.hud.setTimer(a.timer);
      if (a.timer <= 0) return this.end(false, 'Out of time.');
    }
    if (res === true) {
      a.i++;
      a.begun = false;
      H.hud.setTimer(null);
      H.hud.setTargetBar(null, 0);
      this.beacon.hide();
      if (a.m.steps[a.i]?.t !== 'talk') this.objective('');
      else this.objective('');
    } else if (typeof res === 'string') this.end(false, res);
  }

  /** true: done; a string: failed (why); undefined: still at it */
  private stepUpdate(a: Active, step: Step, dt: number): true | string | undefined {
    const H = this.H;
    const f = H.focus();
    const v = H.vehicle();
    // any prop vehicle the mission needs destroyed → fail
    for (const [name, p] of a.props) {
      if (p.vehicle && !p.runner && p.vehicle.health <= 0 && !p.done) return `The ${name === 'heli' ? 'helicopter' : name === 'boat' ? 'boat' : 'car'} was destroyed.`;
    }
    switch (step.t) {
      case 'talk':
        return this.talking() ? undefined : true;
      case 'go': {
        const s = this.spot(step.to);
        const r = step.r ?? (step.with === 'heli' ? 18 : v ? 6 : 4);
        a.target = { x: s.x, y: s.y, z: s.z, r };
        this.beacon.set(0xffd23f);
        this.beacon.place(s.x, s.y, s.z, r, step.with === 'heli' && !step.land ? 18 : 7);
        this.blips.push({ x: s.x, z: s.z, color: '#ffd23f', size: 6, edge: true });
        // in the right vehicle?
        let ok = true;
        if (step.with === 'heli') ok = v instanceof Helicopter;
        else if (step.with === 'boat') ok = v instanceof Boat;
        else if (step.with === 'car') ok = v instanceof FleetCar;
        else if (step.with && step.with !== 'any') {
          const p = a.props.get(step.with);
          ok = !!p && ((p.ai && v instanceof FleetCar && v.car === p.ai) || (!!p.vehicle && v === p.vehicle));
          if (p?.ai && (p.ai.flags & WRECK || (p.ai.hp ?? 100) <= 0)) return 'The car was destroyed.';
          if (!ok) {
            // out of it: back in!
            const pos = p?.ai?.pos ?? p?.vehicle?.pos;
            if (pos) {
              this.chev.at(pos, 1.6, this.t, H.camera);
              this.blips.push({ x: pos.x, z: pos.z, color: '#57e8ff', size: 5, edge: true });
            }
            this.objective('Get back in the car.');
            this.beacon.hide();
            a.target = pos ? { x: pos.x, y: pos.y, z: pos.z, r: 3 } : null;
            return undefined;
          }
          this.objective(step.text);
        }
        const dx = f.x - s.x, dz = f.z - s.z, dy = f.y - s.y;
        const close = Math.hypot(dx, dz) < r && (step.with === 'heli' ? Math.abs(dy) < 14 : Math.abs(dy) < 5);
        if (close && ok) {
          if (step.land && !(v instanceof Helicopter && v.grounded)) {
            this.objective('Set it down.');
            return undefined;
          }
          if (v && !(v instanceof Helicopter) && !(v instanceof Boat) && Math.hypot(v.vel.x, v.vel.z) > 14 && !step.time) {
            this.objective('Slow down to stop in the marker.');
            return undefined;
          }
          return true;
        }
        return undefined;
      }
      case 'take': {
        const p = a.props.get(step.prop);
        if (!p) return true;
        if (p.ai) {
          if (p.ai.flags & WRECK || (p.ai.hp ?? 100) <= 0) return 'The car was destroyed.';
          if (v instanceof FleetCar && v.car === p.ai) return true;
          this.chev.at(p.ai.pos, p.ai.spec.H + 0.4, this.t, H.camera);
          this.blips.push({ x: p.ai.pos.x, z: p.ai.pos.z, color: '#57e8ff', size: 5, edge: true });
          a.target = { x: p.ai.pos.x, y: p.ai.pos.y, z: p.ai.pos.z, r: 3 };
        } else if (p.vehicle) {
          // (any helicopter or boat will do: there's one moored at Bayside, one on Watson Island)
          if (v === p.vehicle || (p.vehicle instanceof Helicopter && v instanceof Helicopter) || (p.vehicle instanceof Boat && v instanceof Boat)) return true;
          this.chev.at(p.vehicle.pos, p.vehicle instanceof Helicopter ? 3.4 : 1.8, this.t, H.camera);
          this.blips.push({ x: p.vehicle.pos.x, z: p.vehicle.pos.z, color: '#57e8ff', size: 5, edge: true });
          a.target = { x: p.vehicle.pos.x, y: p.vehicle.pos.y, z: p.vehicle.pos.z, r: 3 };
        }
        return undefined;
      }
      case 'lose':
        a.target = null;
        return H.police.wanted === 0 ? true : undefined;
      case 'wreck': {
        let left = 0;
        const chevs = [this.chev, this.chev2, this.chev3];
        let k = 0;
        let near: AICar | null = null;
        let nd = Infinity;
        for (const n of step.props) {
          const p = a.props.get(n);
          const c = p?.ai;
          if (!c) continue;
          const dead = !!(c.flags & WRECK) || (c.hp ?? 100) <= 0 || !H.traffic.cars.includes(c);
          if (dead) continue;
          left++;
          chevs[k++ % 3].at(c.pos, c.spec.H + 0.4, this.t, H.camera);
          chevs[(k - 1) % 3].set(0xff4d5e);
          this.blips.push({ x: c.pos.x, z: c.pos.z, color: '#ff4d5e', size: 5, edge: true });
          const d = c.pos.distanceTo(f);
          if (d < nd) {
            nd = d;
            near = c;
          }
        }
        a.target = near ? { x: near.pos.x, y: near.pos.y, z: near.pos.z, r: 3 } : null;
        H.hud.setTargetBar(left ? `Cars left: ${left}` : null, left / step.props.length);
        return left === 0 ? true : undefined;
      }
      case 'chase': {
        const p = a.props.get(step.prop);
        const fc = p?.vehicle as FleetCar | undefined;
        if (!p || !fc || !p.runner) return true;
        const b = fc.body;
        if (fc.health <= 0 || p.done) {
          if (!p.done) {
            p.done = true;
            H.combat.explode(b.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 6, 'police');
            H.traffic.fleet.paint(fc.car.slot, 0x161514);
          }
          return true;
        }
        p.runner.update(dt, H.ctx(), f);
        // he hits the traffic, and you hit him
        H.traffic.collide({ pos: b.pos, vel: fc.vel, yaw: b.yaw, hl: fc.car.spec.L / 2, hw: fc.car.spec.W / 2, mass: b.spec.mass, onImpulse: (jx, jz, px, pz) => b.shove(jx, jz, px, pz) });
        this.ram(fc);
        this.chev.set(0xff4d5e);
        this.chev.at(b.pos, fc.car.spec.H + 0.4, this.t, H.camera);
        this.blips.push({ x: b.pos.x, z: b.pos.z, color: '#ff4d5e', size: 6, edge: true });
        a.target = { x: b.pos.x, y: b.pos.y, z: b.pos.z, r: 3 };
        H.hud.setTargetBar('Nico', fc.health);
        // too far ahead for too long: he got away
        const d = b.pos.distanceTo(f);
        a.lost = d > 650 ? a.lost + dt : Math.max(0, a.lost - dt);
        if (a.lost > 10) return 'Nico got away.';
        if (d > 650) this.objective("He's getting away! Catch Nico.");
        else this.objective(step.text);
        return undefined;
      }
    }
  }

  /** the player's car against the runner: they shove each other, and the runner takes the damage */
  private ram(fc: FleetCar) {
    const H = this.H;
    const v = H.vehicle();
    if (!(v instanceof FleetCar)) return;
    const A = v.body, B = fc.body;
    if (Math.abs(A.pos.x - B.pos.x) > 9 || Math.abs(A.pos.z - B.pos.z) > 9 || Math.abs(A.pos.y - B.pos.y) > 2) return;
    const hit = obbOverlap(A.pos.x, A.pos.z, A.yaw, v.car.spec.L / 2, v.car.spec.W / 2, B.pos.x, B.pos.z, B.yaw, fc.car.spec.L / 2, fc.car.spec.W / 2);
    if (!hit) return;
    const m1 = A.spec.mass, m2 = B.spec.mass;
    A.pos.x -= hit.nx * hit.depth * (m2 / (m1 + m2));
    A.pos.z -= hit.nz * hit.depth * (m2 / (m1 + m2));
    B.pos.x += hit.nx * hit.depth * (m1 / (m1 + m2));
    B.pos.z += hit.nz * hit.depth * (m1 / (m1 + m2));
    const vn = (B.vx - A.vx) * hit.nx + (B.vz - A.vz) * hit.nz;
    if (vn >= 0) return;
    const j = (-(1 + 0.3) * vn) / (1 / m1 + 1 / m2);
    B.shove((j * hit.nx) / m2, (j * hit.nz) / m2, hit.px, hit.pz);
    A.shove((-j * hit.nx) / m1, (-j * hit.nz) / m1, hit.px, hit.pz);
    v.impact = Math.max(v.impact, -vn);
    // (a glancing tap scratches it; a real hit takes a chunk)
    fc.health = Math.max(0, fc.health - Math.max(0, -vn - 2.5) * 0.028);
  }
}
