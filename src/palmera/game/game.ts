// The Game: owns the world, entities and systems, runs the frame loop.
import * as THREE from 'three';
import { AudioSys } from '../audio/audio';
import { Input } from '../core/input';
import { clamp, damp } from '../core/math';
import { setCarNight, type CarType } from '../entities/carModels';
import { Human, HumanRenderer } from '../entities/humans';
import { Vehicle, collideVehicles, type VehicleEvents } from '../entities/vehicle';
import { carModel } from '../entities/carModels';
import { Hud } from '../ui/hud';
import { City } from '../world/city';
import { BEACH, CityMap, WATER_Y, groundAt, groundBase, regionAt, type Box } from '../world/map';
import { SkySystem } from '../world/sky';
import { Water } from '../world/water';
import { glowTexture } from '../world/textures';
import { Effects } from './effects';
import { Missions } from './missions';
import { Peds } from './peds';
import { PlayerController, TUNING } from './player';
import { PursuitAI, Wanted } from './police';
import { Traffic, TrafficAI } from './traffic';
import { Weapons, emptyLoadout, type Loadout } from './weapons';
import { Post } from '../render/post';
import { SkinnedCrowd } from '../entities/skinned';
import { Shop } from './shop';
import { Life } from './life';
import { Ambient } from '../world/ambient';
import { Heli } from './heli';
import { Reactions } from './reactions';
import { Activities } from './activities';
import { Robbery } from './robbery';
import { Interiors } from './interiors';
import { Phone } from '../ui/phone';
import { Rain } from '../world/rain';
import { detailUniforms } from '../render/detail';

export type Mode = 'title' | 'play' | 'paused';

export const START = { x: 677, z: -40, yaw: Math.PI };

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  map: CityMap;
  city: City;
  sky: SkySystem;
  water: Water;
  effects: Effects;
  humanR: HumanRenderer;
  input: Input;
  audio = new AudioSys();
  hud: Hud;
  player: Human;
  playerCtl: PlayerController;
  traffic: Traffic;
  peds: Peds;
  wanted: Wanted;
  weapons: Weapons;
  missions: Missions;
  vehicles: Vehicle[] = [];
  npcs: Human[] = [];
  humans: Human[] = [];
  loadout: Loadout = emptyLoadout();
  cash = 500;
  displayCash = 500;
  mode: Mode = 'title';
  started = false;
  startedAt = 0;
  elapsed = 0;
  cameraKick = 0;
  focus = new THREE.Vector3();
  boat!: Vehicle;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private headLight: THREE.SpotLight;
  private beamMat: THREE.MeshBasicMaterial;
  private beamGeo: THREE.PlaneGeometry;
  private overlayT = 0;
  private overlayKind: 'dead' | 'busted' | '' = '';
  private titleT = 0;
  private tmpBoxes: Box[] = [];
  private prTimer = 0;
  private prFrames = 0;
  private pixelRatio: number;
  stats = { kills: 0, carsStolen: 0, shots: 0 };
  private readonly tmpFwd = new THREE.Vector3();
  events: VehicleEvents;
  post: Post;
  skinned: SkinnedCrowd;
  shop!: Shop;
  life!: Life;
  ambient!: Ambient;
  heli!: Heli;
  reactions!: Reactions;
  activities!: Activities;
  robbery!: Robbery;
  interiors!: Interiors;
  phone!: Phone;
  rain!: Rain;
  wet = 0;
  private ambLight = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    // start at native CSS resolution; adaptResolution climbs toward the screen's own ratio when there's headroom
    this.pixelRatio = 1;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.NoToneMapping; // AgX in the post chain
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 2600);
    this.scene.add(this.camera);

    this.map = new CityMap();
    this.city = new City(this.scene, this.map);
    this.sky = new SkySystem(this.scene, this.renderer);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.water = new Water(this.scene, this.sky);
    this.effects = new Effects(this.scene);
    this.humanR = new HumanRenderer(this.scene);
    this.skinned = new SkinnedCrowd(this.scene);
    this.input = new Input(canvas);
    this.player = new Human('player');
    this.player.pos.set(START.x, 0, START.z);
    this.player.yaw = START.yaw;
    this.humans = [this.player];
    this.playerCtl = new PlayerController(this);
    this.playerCtl.camYaw = START.yaw;
    this.traffic = new Traffic(this);
    this.peds = new Peds(this);
    this.wanted = new Wanted(this);
    this.weapons = new Weapons(this);
    this.shop = new Shop(this);
    this.life = new Life(this);
    this.ambient = new Ambient(this.scene);
    this.heli = new Heli(this);
    this.reactions = new Reactions(this);
    this.activities = new Activities(this);
    this.robbery = new Robbery(this);
    this.interiors = new Interiors(this);
    this.phone = new Phone(this);
    this.rain = new Rain(this.scene);
    this.missions = new Missions(this);
    this.hud = new Hud(this);

    this.events = {
      onImpact: (v, speed, x, y, z, other) => this.onImpact(v, speed, x, y, z, other),
      onSink: (v) => this.onSink(v),
    };

    this.headLight = new THREE.SpotLight(0xfff1d6, 0, 70, 0.55, 0.6, 1.2);
    this.headLight.castShadow = false;
    this.scene.add(this.headLight, this.headLight.target);
    this.beamMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff0c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beamGeo = new THREE.PlaneGeometry(5, 13);
    this.beamGeo.rotateX(-Math.PI / 2);

    // the player's boat at Pelican Marina + moored boats
    this.boat = new Vehicle('boat', 0xffffff);
    this.boat.place(428, 235.5, Math.PI / 2);
    this.boat.persistent = true;
    this.addVehicle(this.boat);
    const bm = carModel('boat');
    const moored = new THREE.InstancedMesh(bm.geo, [new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), new THREE.MeshBasicMaterial({ vertexColors: true })] as unknown as THREE.Material, this.map.moored.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.map.moored.forEach((b, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.h);
      m4.compose(new THREE.Vector3(b.x, WATER_Y + 0.05, b.z), q, new THREE.Vector3(1, 1, 1));
      moored.setMatrixAt(i, m4);
      moored.setColorAt(i, new THREE.Color(b.color));
    });
    moored.castShadow = true;
    this.scene.add(moored);

    window.addEventListener('resize', () => this.resize());
    this.focus.copy(this.player.pos);
    this.warmUp();
  }

  /** Compile every material once up front so new cars and effects don't stutter on first sight. */
  private warmUp() {
    const tmp: Vehicle[] = [];
    (['sedan', 'sports', 'suv', 'pickup', 'taxi', 'police'] as CarType[]).forEach((t, i) => {
      const v = new Vehicle(t);
      v.place(START.x + i * 6, START.z + 40, 0);
      v.beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      v.root.add(v.beam);
      this.scene.add(v.root);
      tmp.push(v);
    });
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      /* compile is only an optimisation */
    }
    for (const v of tmp) this.scene.remove(v.root);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- entity lists
  addVehicle(v: Vehicle) {
    this.vehicles.push(v);
    this.scene.add(v.root);
  }
  removeVehicle(v: Vehicle) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    this.scene.remove(v.root);
    if (v.beam) v.beam = null;
  }
  addNpc(h: Human) {
    this.npcs.push(h);
    this.humans.push(h);
  }
  removeNpc(h: Human) {
    let i = this.npcs.indexOf(h);
    if (i >= 0) this.npcs.splice(i, 1);
    i = this.humans.indexOf(h);
    if (i >= 0) this.humans.splice(i, 1);
  }
  /** true once the opening seconds (when the world fills in around the player) are over */
  get settled(): boolean {
    return this.started && this.elapsed - this.startedAt > 4;
  }

  get police(): Vehicle[] {
    return this.vehicles.filter((v) => v.police);
  }

  setDesired(h: Human, vx: number, vz: number) {
    h.dvx = vx;
    h.dvz = vz;
  }

  private viewPt = new THREE.Vector3();
  inView(x: number, y: number, z: number): boolean {
    return this.frustum.containsPoint(this.viewPt.set(x, y, z));
  }

  addCash(n: number) {
    this.cash += n;
    this.audio.cue('cash');
  }

  nearestVehicle(pos: THREE.Vector3, range: number): Vehicle | null {
    let best: Vehicle | null = null, bd = range;
    for (const v of this.vehicles) {
      if (v.wrecked || v.sinking || v.driver === 'player') continue;
      if (Math.abs(v.pos.y - pos.y) > 3) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const dx = pos.x - v.pos.x, dz = pos.z - v.pos.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = Math.max(0, Math.abs(lx) - v.spec.wid / 2), ez = Math.max(0, Math.abs(lz) - v.spec.len / 2);
      const d = Math.hypot(ex, ez);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---------------------------------------------------------------- vehicle entry
  ejectDriver(v: Vehicle, flee: boolean) {
    if (v.driver !== 'npc') return;
    const door = v.doorPos(new THREE.Vector3());
    const cop = v.police && v.occupants > 0;
    const h = new Human(cop ? 'cop' : 'ped');
    h.pos.set(door.x, groundAt(door.x, door.z, v.pos.y + 1), door.z);
    h.yaw = v.heading + Math.PI / 2;
    if (cop) {
      h.weapon = 'pistol';
      h.state = 'chase';
      v.occupants = 0;
    } else {
      h.health = h.maxHealth = 60;
      h.state = 'flee';
      h.stateT = 8;
      h.fleeFrom.copy(this.player.pos);
      h.down = flee ? 0 : 0.6;
    }
    this.addNpc(h);
    v.driver = null;
    v.ai = null;
    v.input.thr = 0;
    v.input.hand = true;
    if (!flee) {
      this.wanted.crime(v.police ? 'copCar' : 'jack', v.pos.x, v.pos.z, true);
      this.stats.carsStolen++;
    }
  }

  enterVehicle(v: Vehicle) {
    if (!v.isBoat && this.audio.radio.station > 0) setTimeout(() => this.hud.toast(this.audio.radio.tune(0) + '  ·  Q / E to change'), 700);
    const p = this.player;
    if (v.wrecked || v.sinking) return;
    if (v.driver === 'npc') this.ejectDriver(v, false);
    else if (!v.persistent && !v.missionTag && v !== this.boat) this.wanted.crime(v.police ? 'copCar' : 'steal', v.pos.x, v.pos.z, v.police);
    p.vehicle = v;
    p.swimming = false;
    p.vx = p.vz = 0;
    p.aim = 0;
    v.driver = 'player';
    v.ai = null;
    v.despawnable = false;
    this.playerCtl.camYaw = v.heading;
    this.audio.punch();
  }

  exitVehicle() {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    const fast = v.speed > 12;
    const out = new THREE.Vector3();
    let placed = false;
    const tries: [number, number][] = [[-1, 0.3], [1, 0.3], [-1, -1.2], [1, -1.2], [0, 1], [0, -1]];
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    for (const dist of v.isBoat ? [1.9, 3.0, 4.2] : [1.0]) {
      for (const [side, fwd] of tries) {
        const lx = side * (v.spec.wid / 2 + 0.7) * dist, lz = side === 0 ? fwd * (v.spec.len / 2 + 0.8) * dist : fwd;
        // local x axis is (-cos h, sin h) for the right side
        const x = v.pos.x + -c * lx + s * lz, z = v.pos.z + s * lx + c * lz;
        const gy = groundAt(x, z, v.pos.y + 1);
        if (v.isBoat && gy < WATER_Y - 0.3) continue;
        if (this.map.colliders.resolveCircle(x, z, 0.4, gy + 0.3, gy + 1.8, this.tmpBoxes)) continue;
        out.set(x, gy, z);
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      if (v.isBoat) {
        out.set(v.pos.x - c * 2, WATER_Y - 1.35, v.pos.z + s * 2);
        p.swimming = true;
      } else out.set(v.pos.x, v.pos.y + 1.5, v.pos.z);
    }
    p.vehicle = null;
    p.pos.copy(out);
    p.yaw = v.heading;
    p.vx = fast ? v.vx * 0.5 : 0;
    p.vz = fast ? v.vz * 0.5 : 0;
    p.vy = 0;
    if (fast) {
      p.down = 1.4;
      p.hurt(10, v.pos.x, v.pos.z, 0);
      this.playerCtl.lastDamage = this.elapsed;
    }
    v.driver = null;
    v.input.thr = 0;
    v.input.steer = 0;
    v.input.hand = true;
    v.despawnable = true;
    this.audio.setEngine(false, 0, 0, false);
    this.audio.setHorn(false);
    this.audio.setScreech(0);
    this.playerCtl.camYaw = v.heading;
  }

  // ---------------------------------------------------------------- crime and danger
  alertDanger(pos: THREE.Vector3, radius: number, gunshot: boolean, horn = false) {
    for (const h of this.npcs) {
      if (h.kind !== 'ped' || h.dead) continue;
      const d = Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z);
      if (d < radius) {
        if (horn && d > 10) continue;
        this.peds.scare(h, pos.x, pos.z, horn ? 3 : 8);
      }
    }
    if (gunshot) {
      for (const v of this.vehicles) {
        if (v.ai instanceof TrafficAI && !v.police && Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) < radius) v.ai.panic = 10;
      }
      if (this.player.weapon !== 'fist' && Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z) < 2) {
        this.stats.shots++;
        this.reactions.witness(pos.x, pos.z);
        this.wanted.crime('shots', pos.x, pos.z, false);
      }
    }
  }

  onHumanHurt(h: Human, attacker: Human, killed: boolean, how: 'punch' | 'gun' | 'car') {
    if (h === this.player) {
      this.playerCtl.lastDamage = this.elapsed;
      const d = document.getElementById('damage');
      if (d) {
        d.style.boxShadow = 'inset 0 0 140px rgba(255,0,0,0.55)';
        setTimeout(() => (d.style.boxShadow = 'inset 0 0 120px rgba(255,0,0,0)'), 160);
      }
      return;
    }
    if (h.kind === 'ped') this.peds.scare(h, attacker.pos.x, attacker.pos.z, 10);
    this.alertDanger(h.pos, how === 'gun' ? 30 : 16, false);
    if (attacker === this.player) {
      if (killed) this.stats.kills++;
      if (how === 'punch' && !killed) this.reactions.punched(h);
      this.reactions.witness(h.pos.x, h.pos.z);
      if (how !== 'punch' || h.kind === 'cop') this.hud.hitT = 0.15;
      if (h.kind === 'cop') {
        this.wanted.crime(killed ? 'copKill' : 'copAssault', h.pos.x, h.pos.z, true);
        h.state = 'chase';
      } else this.wanted.crime(killed ? 'kill' : 'assault', h.pos.x, h.pos.z, true);
      if (killed && h.kind === 'ped' && Math.random() < 0.6) {
        const amt = 10 + Math.floor(Math.random() * 40);
        this.addCash(amt);
        this.hud.toast(`+$${amt}`);
      }
    }
  }

  onVehicleAttacked(v: Vehicle) {
    if (v.police && (v.occupants > 0 || v.driver === 'npc')) this.wanted.crime('copCar', v.pos.x, v.pos.z, true);
    if (v.ai instanceof TrafficAI) v.ai.panic = 10;
  }

  honkAt(v: Vehicle) {
    this.audio.honk(v.pos.distanceTo(this.camera.position));
  }

  private onImpact(v: Vehicle, speed: number, x: number, y: number, z: number, other: Vehicle | null) {
    const camD = this.camera.position.distanceTo(v.pos);
    // a hit reported at the car's centre (a wall, a drop): it took it on the nose or the tail
    if (Math.abs(x - v.pos.x) < 0.01 && Math.abs(z - v.pos.z) < 0.01) {
      const s = v.forwardSpeed >= 0 ? 1 : -1;
      x += v.fwdX() * v.spec.len * 0.5 * s;
      z += v.fwdZ() * v.spec.len * 0.5 * s;
      y = v.pos.y + 0.6;
    }
    if (camD < 160 && speed > 4) {
      v.dent(x, y, z, speed);
      other?.dent(x, y, z, speed);
      if (speed > 9) {
        // glass and trim fly off
        this.effects.debris(x, y, z, speed, v.color);
      }
    }
    if (camD < 120) {
      this.effects.sparks(x, y, z, Math.min(20, Math.floor(speed)));
      this.audio.crash(speed, camD);
    }
    const pv = this.player.vehicle;
    if (pv && (v === pv || other === pv)) {
      this.cameraKick += Math.min(0.03, speed * 0.002);
      const o = v === pv ? other : v;
      if (o) {
        if (o.police && speed > 4) this.wanted.crime('copCar', o.pos.x, o.pos.z, true);
        else if (o.ai instanceof TrafficAI) {
          o.ai.panic = 8;
          if (speed > 8) this.wanted.crime('vehicle', o.pos.x, o.pos.z, false);
          // some drivers get out to have a word
          else if (speed > 3 && !o.persistent && Math.random() < 0.25) {
            const oo = o;
            setTimeout(() => {
              if (oo.driver !== 'npc' || oo.wrecked) return;
              this.ejectDriver(oo, true);
              const h = this.npcs[this.npcs.length - 1];
              if (h && h.kind === 'ped') {
                h.down = 0;
                h.state = 'fight';
                h.clip = '';
                h.stateT = 14;
                h.fireT = 0.8;
                h.rage = true;
                this.hud.subtitle(['DRIVER: Hey! Are you blind?!', 'DRIVER: You just hit my car!', 'DRIVER: Get out here, right now!', 'DRIVER: Unbelievable. Unbelievable!'][Math.floor(Math.random() * 4)], 3);
              }
            }, 900);
          }
        }
      }
    }
  }

  private onSink(v: Vehicle) {
    this.effects.puff(v.pos.x, WATER_Y, v.pos.z, 'splash');
    for (let i = 0; i < 8; i++) this.effects.puff(v.pos.x + Math.random() * 3 - 1.5, WATER_Y, v.pos.z + Math.random() * 3 - 1.5, 'splash');
    this.audio.splash();
    if (v.driver === 'player') {
      const p = this.player;
      this.exitVehicle();
      p.pos.set(v.pos.x, WATER_Y - 1.35, v.pos.z);
      p.swimming = true;
      this.hud.toast('Your ride is sleeping with the fishes');
    } else if (v.driver === 'npc') {
      v.driver = null;
      v.ai = null;
    }
  }

  // ---------------------------------------------------------------- death / arrest
  busted() {
    if (this.overlayKind) return;
    this.overlayKind = 'busted';
    this.overlayT = 3.5;
    const fee = Math.min(this.cash, 300);
    this.hud.bigMessage('CUFFED', `Booked by Palmera PD · -$${fee}`, '#5fa8ff');
    this.audio.cue('fail');
    if (this.player.vehicle) this.exitVehicle();
    this.player.down = 4;
  }

  private die() {
    if (this.overlayKind) return;
    this.overlayKind = 'dead';
    this.overlayT = 4;
    const fee = Math.min(this.cash, 250);
    this.hud.bigMessage('FLATLINED', `Palmera General patched you up · -$${fee}`, '#ff5a5a');
    this.audio.cue('fail');
  }

  private respawn() {
    const kind = this.overlayKind;
    this.overlayKind = '';
    const p = this.player;
    if (p.vehicle) this.exitVehicle();
    const spot = kind === 'busted' ? this.map.policeHQ : this.map.hospital;
    this.cash -= Math.min(this.cash, kind === 'busted' ? 300 : 250);
    this.displayCash = this.cash;
    if (kind === 'busted') {
      this.loadout.owned.clear();
      p.weapon = 'fist';
    }
    this.missions.cancel(kind === 'busted' ? 'You got cuffed' : 'You flatlined');
    this.wanted.clear();
    for (const v of [...this.vehicles]) if (v.police && v.ai instanceof PursuitAI) this.removeVehicle(v);
    for (const h of [...this.npcs]) if (h.kind === 'cop') this.removeNpc(h);
    this.teleport(spot.x, spot.z);
    p.health = p.maxHealth;
    p.dead = false;
    p.down = 0;
    p.fall = 0;
    p.swimming = false;
  }

  teleport(x: number, z: number) {
    const p = this.player;
    if (p.vehicle) {
      const v = p.vehicle;
      v.place(x, z, v.heading);
      v.pos.y = v.isBoat ? WATER_Y : groundAt(x, z);
    } else {
      p.pos.set(x, groundAt(x, z), z);
      p.vx = p.vz = p.vy = 0;
      p.swimming = groundBase(x, z) < WATER_Y - 1.2 && groundAt(x, z) < WATER_Y;
      if (p.swimming) p.pos.y = WATER_Y - 1.35;
    }
    this.focus.set(x, 0, z);
  }

  spawnCar(type: CarType, x: number, z: number, h: number): Vehicle {
    const v = new Vehicle(type);
    v.place(x, z, h);
    this.addVehicle(v);
    return v;
  }

  setPaused(p: boolean) {
    if (this.mode === 'title') return;
    this.mode = p ? 'paused' : 'play';
    this.hud.showPause(p);
    if (p) {
      this.audio.quietAll();
      document.exitPointerLock?.();
    }
  }

  start() {
    this.mode = 'play';
    this.started = true;
    this.startedAt = this.elapsed;
    this.hud.showTitle(false);
    this.audio.init();
    this.player.hidden = false;
    this.focus.copy(this.player.pos);
    this.hud.subtitle('Welcome to Port Palmera. Three jobs are waiting — check the map with M.', 6);
  }

  // ---------------------------------------------------------------- physics for people
  private stepHumans(dt: number) {
    const tb = this.tmpBoxes;
    for (const h of this.humans) {
      if (h.vehicle) {
        h.pos.copy(h.vehicle.pos);
        h.vx = h.vz = 0;
        continue;
      }
      if (h.hidden) continue;
      const isP = h === this.player;
      const incap = h.dead || h.down > 0;
      if (incap) {
        const f = h.onGround ? Math.exp(-5 * dt) : 1;
        h.vx *= f;
        h.vz *= f;
      } else {
        const acc = (h.onGround || h.swimming ? TUNING.groundAccel : TUNING.airAccel) * dt;
        h.vx += clamp(h.dvx - h.vx, -acc, acc);
        h.vz += clamp(h.dvz - h.vz, -acc, acc);
        if (!isP && (h.dvx || h.dvz)) {
          const want = Math.atan2(h.dvx, h.dvz);
          let d = want - h.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (h.aim < 0.5) h.yaw += d * clamp(10 * dt, 0, 1);
        }
      }
      h.pos.x += h.vx * dt;
      h.pos.z += h.vz * dt;
      // vertical
      const g = groundAt(h.pos.x, h.pos.z, h.pos.y + 0.6);
      if (h.swimming) {
        h.pos.y = WATER_Y - 1.35;
        h.vy = 0;
        h.onGround = false;
        if (g > WATER_Y - 1.35 + 0.2 && g < WATER_Y + 1.2) {
          h.swimming = false;
          h.pos.y = g;
          h.onGround = true;
        } else if (g >= WATER_Y + 1.2) {
          h.pos.x -= h.vx * dt;
          h.pos.z -= h.vz * dt;
        }
      } else {
        if (h.pos.y > g + 0.02 || h.vy > 0) {
          h.vy -= TUNING.gravity * dt;
          h.pos.y += h.vy * dt;
          h.onGround = false;
          if (h.pos.y <= g) {
            if (h.vy < -13 && !h.dead) {
              const killed = h.hurt((-h.vy - 13) * 12, h.pos.x, h.pos.z);
              if (isP) this.onHumanHurt(h, h, killed, 'car');
            }
            h.pos.y = g;
            h.vy = 0;
            h.onGround = true;
          }
        } else {
          h.pos.y = g;
          h.vy = 0;
          h.onGround = true;
        }
        if (g < WATER_Y - 1.2 && h.pos.y < WATER_Y - 0.9 && groundBase(h.pos.x, h.pos.z) < WATER_Y - 0.5) {
          h.swimming = true;
          h.pos.y = WATER_Y - 1.35;
          this.effects.puff(h.pos.x, WATER_Y, h.pos.z, 'splash');
          if (isP) this.audio.splash();
        }
      }
      // buildings and props
      const res = this.map.colliders.resolveCircle(h.pos.x, h.pos.z, 0.35, h.pos.y + 0.35, h.pos.y + 1.8, tb);
      if (res) {
        h.pos.x = res.x;
        h.pos.z = res.z;
        const vn = h.vx * res.nx + h.vz * res.nz;
        if (vn < 0) {
          h.vx -= vn * res.nx;
          h.vz -= vn * res.nz;
        }
      }
    }
    // people vs people (cheap push)
    const list = this.humans;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.vehicle || a.hidden || a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.vehicle || b.hidden || b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.49 || d2 < 1e-6 || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const d = Math.sqrt(d2);
        const push = (0.7 - d) * 0.5;
        a.pos.x -= (dx / d) * push;
        a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.z += (dz / d) * push;
      }
    }
  }

  /** Cars hitting people and people walking into cars. */
  private carsVsPeople() {
    for (const v of this.vehicles) {
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const hw = v.spec.wid / 2 + 0.3, hl = v.spec.len / 2 + 0.3;
      const sp = v.speed;
      for (const h of this.humans) {
        if (h.vehicle || h.hidden) continue;
        const dx = h.pos.x - v.pos.x, dz = h.pos.z - v.pos.z;
        if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
        if (h.pos.y > v.pos.y + v.spec.hgt || h.pos.y + 1.7 < v.pos.y - (v.isBoat ? 1 : 0)) continue;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) > hw || Math.abs(lz) > hl) continue;
        // relative velocity of the car towards the person
        const vrel = Math.hypot(v.vx - h.vx, v.vz - h.vz);
        if (vrel > 4.5 && !h.dead) {
          const dmg = vrel * (h === this.player ? 3.5 : 6.5);
          const killed = h.hurt(dmg, v.pos.x - v.vx, v.pos.z - v.vz, 0);
          h.vx = v.vx * 0.9 + (Math.random() - 0.5) * 3;
          h.vz = v.vz * 0.9 + (Math.random() - 0.5) * 3;
          h.vy = Math.min(8, vrel * 0.35);
          h.onGround = false;
          h.down = Math.max(h.down, 2.5);
          h.pos.y += 0.1;
          this.audio.punch();
          this.effects.puff(h.pos.x, h.pos.y + 1, h.pos.z, 'blood');
          v.vx *= 0.93;
          v.vz *= 0.93;
          v.damage(vrel * 2);
          if (v.driver === 'player') this.onHumanHurt(h, this.player, killed, 'car');
          else if (h === this.player) this.onHumanHurt(h, h, killed, 'car');
          else this.alertDanger(h.pos, 15, false);
        } else {
          // push the person out of the car footprint
          const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
          let ox = 0, oz = 0;
          if (px < pz) ox = Math.sign(lx) * px;
          else oz = Math.sign(lz) * pz;
          // back to world (local x axis = (cos h, -sin h), local z = (sin h, cos h))
          h.pos.x += ox * c + oz * s;
          h.pos.z += -ox * s + oz * c;
        }
      }
    }
  }

  // ---------------------------------------------------------------- vehicles
  private stepVehicles(dt: number) {
    const night = this.sky.night;
    const cam = this.camera.position;
    for (const v of this.vehicles) {
      if (v.driver === 'npc' && v.ai) v.ai.drive(v, dt);
      else if (v.driver !== 'player') {
        v.input.thr = 0;
        v.input.steer = 0;
        v.input.hand = true;
      }
      v.update(dt, this.map.colliders, this.events, this.elapsed);
      v.setSirenVisual(this.elapsed);
      // burning and explosions
      if (v.burnTimer > 0 && !v.wrecked) {
        v.burnTimer += dt;
        if (Math.random() < dt * 30) this.effects.fire(v.pos.x + v.fwdX() * v.spec.len * 0.3, v.pos.y + 1, v.pos.z + v.fwdZ() * v.spec.len * 0.3);
        if (v.driver === 'npc' && v.burnTimer > 0.5) this.ejectDriver(v, true);
        if (v.driver === 'player') this.hud.prompt('<kbd>F</kbd> Get out — it’s going to blow!');
        if (v.burnTimer > 4.5) this.explode(v);
      }
      // smoke from damaged engines
      const hf = v.health / v.spec.health;
      if (!v.sunk && (hf < 0.45 || v.wrecked)) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = v.wrecked ? 0.25 : hf < 0.2 ? 0.06 : 0.14;
          const front = v.spec.len * 0.35;
          this.effects.puff(v.pos.x + v.fwdX() * front, v.pos.y + v.spec.hgt * 0.8, v.pos.z + v.fwdZ() * front, hf < 0.2 || v.wrecked ? 'dark' : 'smoke');
        }
      }
      // drift smoke
      if (!v.isBoat && v.slip > 4 && v.speed > 6 && !v.airborne && Math.random() < dt * 25) {
        const back = -v.spec.wheelZ;
        this.effects.puff(v.pos.x + v.fwdX() * back, v.pos.y + 0.2, v.pos.z + v.fwdZ() * back, 'tire');
      }
      if (v.isBoat && v.speed > 4 && Math.random() < dt * 20) this.effects.puff(v.pos.x - v.fwdX() * 3.6, WATER_Y + 0.1, v.pos.z - v.fwdZ() * 3.6, 'splash');
      // LOD: shadows and wheels by distance
      const d = Math.hypot(v.pos.x - cam.x, v.pos.z - cam.z);
      v.updateLights(d < 140, this.elapsed);
      v.body.castShadow = d < 70;
      const showWheels = d < 110;
      for (const w of v.wheels) w.visible = showWheels;
      v.root.visible = d < 700;
      // headlight beams at night
      const beamOn = night > 0.15 && !v.wrecked && v.driver !== null && d < 160 && !v.isBoat;
      if (beamOn && !v.beam) {
        v.beam = new THREE.Mesh(this.beamGeo, this.beamMat);
        v.beam.position.set(0, 0.08, v.spec.len / 2 + 6.5);
        v.beam.renderOrder = 3;
        v.root.add(v.beam);
      }
      if (v.beam) v.beam.visible = beamOn;
    }
    collideVehicles(this.vehicles, this.events);
    this.beamMat.opacity = clamp(night * 0.5, 0, 0.5);
    setCarNight(night);
    // the player's headlights
    const pv = this.player.vehicle;
    if (pv && night > 0.1 && !pv.isBoat && !pv.wrecked) {
      this.headLight.intensity = night * 60;
      this.headLight.position.set(pv.pos.x + pv.fwdX() * 2, pv.pos.y + 0.9, pv.pos.z + pv.fwdZ() * 2);
      this.headLight.target.position.set(pv.pos.x + pv.fwdX() * 20, pv.pos.y - 1, pv.pos.z + pv.fwdZ() * 20);
      this.headLight.target.updateMatrixWorld();
    } else this.headLight.intensity = 0;
  }

  private explode(v: Vehicle) {
    v.wreck();
    v.burnTimer = 0;
    const p = v.pos;
    if (v.driver === 'player') {
      this.exitVehicle();
      this.player.hurt(200, p.x, p.z, 8);
    }
    this.blast(p, 8, 140, null, v);
    v.vy += 5;
  }

  /** an explosion: fireball, shake, sound; hurts people, wrecks and shoves cars (chain reactions) */
  blast(p: THREE.Vector3, radius: number, dmg: number, by: Human | null, skip: Vehicle | null = null) {
    this.effects.explosion(p.x, p.y, p.z);
    this.effects.scorch(p.x, p.z);
    this.audio.explosion(this.camera.position.distanceTo(p));
    this.cameraKick += 0.05 * Math.max(0, 1 - this.camera.position.distanceTo(p) / 60);
    for (const h of this.humans) {
      if (h.vehicle) continue;
      const d = h.pos.distanceTo(p);
      if (d < radius) {
        const killed = h.hurt(dmg * (1 - d / radius), p.x, p.z, 10 * (1 - d / radius));
        if (by) this.onHumanHurt(h, by, killed, 'gun');
        else if (h === this.player) this.onHumanHurt(h, h, killed, 'car');
      }
    }
    for (const u of this.vehicles) {
      if (u === skip) continue;
      const d = u.pos.distanceTo(p);
      if (d < radius + 1) {
        u.damage(600 * (1 - d / (radius + 1)));
        const k = (1 - d / (radius + 1)) * 9;
        u.vx += ((u.pos.x - p.x) / (d || 1)) * k;
        u.vz += ((u.pos.z - p.z) / (d || 1)) * k;
        if (by === this.player) this.onVehicleAttacked(u);
      }
    }
    this.alertDanger(p, 60, true);
  }

  // ---------------------------------------------------------------- frame
  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 1 / 20);
    this.camera.updateMatrixWorld();
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);

    if (this.mode === 'paused') {
      if (this.input.hit('Escape') || this.input.hit('KeyM') || this.input.hit('KeyP')) this.setPaused(false);
      this.input.endFrame();
      this.render();
      return;
    }
    let sdt = dt;
    if (this.overlayKind) sdt = dt * 0.35;
    this.elapsed += sdt;
    const p = this.player;

    if (this.mode === 'title') {
      this.titleT += dt;
      p.hidden = true;
      // slow drone shot from the sea towards the beach, hotels and the downtown skyline
      const t = this.titleT;
      const cz = -40 + Math.sin(t * 0.03) * 260;
      this.focus.set(640, 0, cz);
      this.camera.position.set(880 + Math.sin(t * 0.05) * 20, 34 + Math.sin(t * 0.07) * 6, cz + 120);
      this.camera.lookAt(560, 14, cz - 90);
      if (this.camera.fov !== 55) {
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
      }
    } else {
      if (this.input.hit('Escape') || this.input.hit('KeyP')) {
        this.setPaused(true);
        this.input.endFrame();
        return;
      }
      if (this.input.hit('KeyM')) {
        this.setPaused(true);
        this.input.endFrame();
        return;
      }
      if (!this.overlayKind) this.playerCtl.update(sdt);
      else this.setDesired(p, 0, 0);
      this.focus.copy(p.vehicle ? p.vehicle.pos : p.pos);
    }

    this.traffic.update(sdt);
    this.peds.update(sdt);
    this.life.update(sdt);
    if (this.mode === 'play') this.wanted.update(sdt);
    this.stepVehicles(sdt);
    this.stepHumans(sdt);
    this.carsVsPeople();
    for (const h of this.humans) this.humanR.animate(h, sdt);
    if (this.mode === 'play') {
      this.weapons.update(sdt, this.elapsed);
      this.shop.update();
      this.heli.update(sdt, this.elapsed);
      this.reactions.update(sdt);
      this.activities.update(sdt);
      this.robbery.update(sdt);
      this.interiors.update(sdt);
      this.phone.update();
      this.missions.update(sdt);
      this.playerCtl.updateCamera(dt);
      if (p.health <= 0 && !this.overlayKind) this.die();
      if (this.overlayKind) {
        this.overlayT -= dt;
        if (this.overlayT <= 0) this.respawn();
      }
      // world edge
      if (Math.abs(p.pos.x - 50) > 1100 || Math.abs(p.pos.z) > 1000) {
        this.hud.prompt('You’re heading out to open sea');
      }
    }
    this.displayCash = damp(this.displayCash, this.cash, 6, dt);
    if (Math.abs(this.displayCash - this.cash) < 1) this.displayCash = this.cash;

    // world systems
    const cam = this.camera.position;
    this.sky.update(sdt, this.focus, cam, this.renderer, this.elapsed);
    this.water.update(this.elapsed, this.sky, cam);
    this.city.update(cam, this.sky.night, this.elapsed);
    this.effects.update(sdt, this.renderer.domElement.height, this.camera.fov);
    // the rain, and the streets drying after it
    this.rain.update(this.elapsed, cam, this.sky.rain, 0.2 + 0.8 * this.sky.day);
    this.wet += ((this.sky.rain > 0.15 ? 1 : 0) - this.wet) * Math.min(1, sdt * (this.sky.rain > 0.15 ? 0.15 : 0.02));
    detailUniforms.dWet.value = this.wet;
    this.post.wet = this.wet;
    this.audio.setRain(this.sky.rain);
    this.audio.radio.setOn(!!this.player.vehicle && this.mode === 'play' && !this.player.dead);
    const dl = (0.08 + 0.92 * this.sky.day) * (1 - 0.4 * this.sky.rain);
    this.ambient.update(sdt, this.elapsed, this.focus, this.sky.day, this.ambLight.setRGB(dl, dl, dl * 0.97));
    this.skinned.update(dt, this.humans, cam, this.camera.getWorldDirection(this.tmpFwd));
    this.skinned.updateDrivers(dt, this.vehicles, cam, this.player);
    this.humanR.render(this.humans, cam, 150, this.skinned.taken);
    if (this.mode === 'play') {
      this.hud.update(dt);
      this.updateAudio(dt);
    }
    this.input.endFrame();
    this.render();
    this.adaptResolution(dtRaw);
  }

  private updateAudio(dt: number) {
    const a = this.audio;
    if (!a.ctx) return;
    const p = this.player;
    const v = p.vehicle;
    if (v) {
      a.setEngine(!v.wrecked && !v.sunk, v.rpm, v.input.thr, v.isBoat);
      a.setScreech(!v.isBoat && v.slip > 4 && v.speed > 6 ? clamp((v.slip - 4) / 6, 0, 1) : 0);
    } else {
      a.setEngine(false, 0, 0, false);
      a.setScreech(0);
    }
    let siren = 0;
    for (const u of this.vehicles) if (u.siren) siren = Math.max(siren, 1 - u.pos.distanceTo(this.camera.position) / 160);
    a.setSiren(siren);
    const ref = v ? v.pos : p.pos;
    const beach = clamp(1 - Math.abs(ref.x - (BEACH.x0 + 50)) / 90, 0, 1) * (regionAt(ref.x, ref.z) === 'ocean' ? 0.5 : 1);
    const r = regionAt(ref.x, ref.z);
    const city = r === 'downtown' || r === 'harbor' ? 1 : r === 'suburb' || r === 'island' ? 0.6 : 0.2;
    a.ambient(dt, this.sky.night, beach, city);
  }

  private render() {
    this.post.shafts.set(this.camera, this.sky.sunDir, this.sky.sunColor, this.sky.day, this.sky.sunset);
    this.post.render(this.elapsed, this.sky.night, this.sky.exposure);
  }

  private prLockUntil = 0;
  private prRaisedAt = -1;
  /**
   * Keep the frame rate up by moving the render resolution: measured every second, down fast when the
   * frame rate sags (further when it collapses), up in small steps only while it holds 60, and if a
   * step up costs frames, back down and no more climbing for half a minute.
   */
  private adaptResolution(dt: number) {
    this.prTimer += dt;
    this.prFrames++;
    if (this.prTimer < 1) return;
    const fps = this.prFrames / this.prTimer;
    this.prTimer = 0;
    this.prFrames = 0;
    if (document.hidden) return;
    let pr = this.pixelRatio;
    const maxPr = Math.min(window.devicePixelRatio || 1, 1.5);
    const now = this.elapsed;
    if (fps < 55 && pr > 0.65) {
      pr = Math.max(0.65, pr - (fps < 38 ? 0.2 : 0.1));
      if (this.prRaisedAt >= 0 && now - this.prRaisedAt < 3) this.prLockUntil = now + 30;
      this.prRaisedAt = -1;
    } else if (fps > 58.5 && pr < maxPr && now > this.prLockUntil) {
      pr = Math.min(maxPr, pr + 0.05);
      this.prRaisedAt = now;
    }
    if (Math.abs(pr - this.pixelRatio) > 1e-3) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.resize();
    }
  }

}
