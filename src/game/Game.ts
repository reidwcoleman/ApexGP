import * as THREE from 'three';
import { Renderer } from '../core/Renderer.ts';
import { Input } from '../core/Input.ts';
import { GameAudio } from '../core/Audio.ts';
import { Track, SURF } from '../world/Track.ts';
import { COSTA_DEL_SOL } from '../world/Circuits.ts';
import { buildTrackside, type Trackside } from '../world/TrackMesh.ts';
import { createEnvironment, type Environment } from '../world/Environment.ts';
import { createCar, preloadCarAssets, type CarRig } from '../car/CarModel.ts';
import { TEAMS, allEntries, uiColor, type Entry } from '../race/Teams.ts';
import { Engineer } from '../race/Engineer.ts';
import { AIDriver } from '../sim/AIDriver.ts';
import { Race } from '../race/Race.ts';
import { CarView } from './CarView.ts';
import { Cameras, CAMERA_LABEL, type CameraMode } from './Cameras.ts';
import { ReplayBuffer } from './Replay.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import { Particles } from '../fx/Particles.ts';
import { HUD, fmtTime } from '../ui/HUD.ts';
import { Menu, ASSISTS, DIFFICULTY, GRID, type RaceSetup, type Settings, type TimeOfDay } from '../ui/Menu.ts';

type GameState = 'boot' | 'menu' | 'intro' | 'race' | 'paused' | 'results' | 'replay';

const REPLAY_SHOTS: CameraMode[] = ['tv', 'chase', 'tv', 'tcam', 'tv', 'far'];

const SMOKE_LIGHT: Record<TimeOfDay, THREE.Color> = {
  golden: new THREE.Color(1.0, 0.86, 0.72),
  day: new THREE.Color(1, 1, 1),
  overcast: new THREE.Color(0.82, 0.84, 0.88),
};

export class Game {
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 30000);
  private gfx: Renderer;
  private input = new Input();
  private audio = new GameAudio();
  private audioReady = false;
  private track!: Track;
  private trackside!: Trackside;
  private env!: Environment;
  private entries: Entry[] = allEntries();
  private rigs = new Map<Entry, CarRig>();
  private views = new Map<Entry, CarView>();
  private carsGroup = new THREE.Group();
  private race!: Race;
  private cams!: Cameras;
  private particles = new Particles();
  private hud: HUD;
  private menu: Menu;
  private state: GameState = 'boot';
  private stateTime = 0;
  private timer = new THREE.Timer();
  private mode: 'race' | 'timetrial' = 'race';
  private time: TimeOfDay = 'golden';
  private finishTimer = -1;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private replay = new ReplayBuffer();
  private replayT = 0;
  private replayStart = 0;
  private replayEnd = 0;
  private replayShot = -1;
  private replayBadge: HTMLDivElement;
  private replayBar: HTMLElement;
  private prevCamPos = new THREE.Vector3();
  private fpsAvg = 60;
  private dofTarget = new THREE.Vector3();
  private lastDt = 0.016;
  private engineer = new Engineer();
  private autopilot: AIDriver | null = null;
  private driverHidden = false;
  private qualityCheck = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.gfx = new Renderer(canvas, this.scene, this.camera, 'high');
    this.hud = new HUD(uiRoot);
    this.replayBadge = document.createElement('div');
    this.replayBadge.className = 'replay-badge';
    this.replayBadge.innerHTML = '<span class="rdot"></span><b>Replay</b><span class="rtrack"><i></i></span><span class="rskip">Enter to skip</span>';
    uiRoot.appendChild(this.replayBadge);
    this.replayBar = this.replayBadge.querySelector('i')!;
    this.menu = new Menu(uiRoot, {
      onSetupChange: (s) => this.applySetupPreview(s),
      onStart: (mode, s) => this.startRace(mode, s),
      onSettings: (s) => this.applySettings(s),
      onResume: () => this.resume(),
      onRestart: () => this.startRace(this.mode, this.menu.setup),
      onQuit: () => this.toMenu(),
      onUi: (k) => this.audioReady && this.audio.ui(k),
    });
    addEventListener('resize', () => this.gfx.resize());
    const unlock = () => {
      if (this.audioReady) return;
      this.audio
        .init()
        .then(() => {
          this.audioReady = true;
          this.audio.setVolume(this.menu.settings.volume);
        })
        .catch(() => {});
    };
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.audioReady) return;
      if (document.hidden) this.audio.suspend();
      else this.audio.resume();
      if (document.hidden && this.state === 'race') this.pause();
    });
  }

  // ------------------------------------------------------------------ boot

  async boot(progress: (f: number, step: string) => void) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    progress(0.02, 'Loading fonts');
    try {
      await Promise.all([document.fonts.load('700 20px "Titillium Web"'), document.fonts.load('900 20px "Titillium Web"'), document.fonts.load('600 20px "Titillium Web"')]);
    } catch {
      /* fallback fonts are fine */
    }
    this.applySettings(this.menu.settings);
    this.time = this.menu.setup.time;

    progress(0.08, 'Surveying the circuit');
    await tick();
    this.track = new Track(COSTA_DEL_SOL);

    progress(0.22, 'Laying asphalt, kerbs and barriers');
    await tick();
    this.trackside = buildTrackside(this.track, this.gfx);
    this.scene.add(this.trackside.group);

    progress(0.42, 'Building the coast');
    await tick();
    this.env = createEnvironment(this.track, this.gfx, this.scene, this.time);
    this.scene.add(this.env.group);

    progress(0.62, 'Rolling out the cars');
    await preloadCarAssets();
    this.scene.add(this.carsGroup);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const rig = createCar(e.team, e.driver, e.seat, { envMap: this.scene.environment ?? undefined });
      this.rigs.set(e, rig);
      this.views.set(e, new CarView(rig));
      this.carsGroup.add(rig.root);
      if (i % 4 === 3) {
        progress(0.62 + (0.25 * i) / this.entries.length, 'Rolling out the cars');
        await tick();
      }
    }
    this.scene.add(this.particles.group);
    this.particles.setLight(SMOKE_LIGHT[this.time]);

    this.cams = new Cameras(this.camera, this.track);
    this.hud.setup(this.makeRace('race', this.menu.setup), this.track);

    progress(0.9, 'Warming up shaders');
    await tick();
    this.syncAllViews(0.016);
    this.cams.orbit(0.016, this.playerRigPos());
    this.gfx.renderer.compile(this.scene, this.camera);
    this.gfx.render(0.016);

    progress(1, 'Ready');
    this.toMenu();
    const loop = (now: number) => {
      this.timer.update(now);
      const dt = Math.min(this.timer.getDelta(), 1 / 20);
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ states

  private makeRace(mode: 'race' | 'timetrial', setup: RaceSetup): Race {
    const team = TEAMS[setup.team];
    const playerEntry = this.entries.find((e) => e.team === team && e.seat === setup.seat)!;
    this.race = new Race(this.track, {
      mode,
      laps: setup.laps,
      difficulty: DIFFICULTY[setup.difficulty].value,
      playerEntry,
      playerGrid: GRID[setup.grid].slot,
      entries: this.entries,
    });
    const as = ASSISTS[setup.assists];
    this.race.player.car.assists = {
      traction: as.traction,
      abs: as.abs,
      stability: as.stability,
      autoGear: this.menu.settings.gearbox === 'auto',
    };
    // show only the cars in this session
    const inRace = new Set(this.race.cars.map((c) => c.entry));
    for (const [e, rig] of this.rigs) {
      rig.root.visible = inRace.has(e);
      rig.setDriverVisible(true);
    }
    this.driverHidden = false;
    this.particles.clear();
    this.replay.reset(this.race);
    return this.race;
  }

  private toMenu() {
    this.state = 'menu';
    this.stateTime = 0;
    this.makeRace('race', this.menu.setup);
    this.hud.show(false);
    this.menu.show('title');
    this.gfx.setDepthOfField(true, this.dofTarget, 6, 2.2);
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    if (this.audioReady) this.audio.crowd(0.35);
  }

  private applySetupPreview(s: RaceSetup) {
    if (s.time !== this.time) {
      this.time = s.time;
      this.env.setTimeOfDay(s.time);
      this.particles.setLight(SMOKE_LIGHT[s.time]);
    }
    this.makeRace('race', s);
  }

  private applySettings(s: Settings) {
    if (s.quality !== this.gfx.qualityLevel) this.gfx.setQuality(s.quality);
    if (this.cams && this.cams.mode !== s.camera && this.state !== 'menu') this.cams.set(s.camera);
    if (this.audioReady) this.audio.setVolume(s.volume);
    if (this.race) this.race.player.car.assists.autoGear = s.gearbox === 'auto';
  }

  private startRace(mode: 'race' | 'timetrial', setup: RaceSetup) {
    this.mode = mode;
    this.autopilot = null;
    if (setup.time !== this.time) {
      this.time = setup.time;
      this.env.setTimeOfDay(setup.time);
      this.particles.setLight(SMOKE_LIGHT[setup.time]);
    }
    this.makeRace(mode, setup);
    this.hud.setup(this.race, this.track);
    this.engineer.reset(this.race);
    this.menu.show('none');
    this.gfx.setDepthOfField(false);
    this.cams.set(this.menu.settings.camera);
    this.finishTimer = -1;
    this.input.releaseAll();
    this.state = mode === 'timetrial' ? 'race' : 'intro';
    this.stateTime = 0;
    this.hud.show(true);
    if (mode === 'race') this.hud.setHint('Lights out soon · hold <kbd>↑</kbd> to rev, launch when they go out');
    else {
      const rec = this.loadRecord();
      this.hud.setHint(`Flying lap${isFinite(rec) ? ` · record ${fmtTime(rec)}` : ''} · <kbd>Space</kbd> DRS · <kbd>Shift</kbd> ERS`);
    }
    if (this.audioReady) this.audio.crowd(mode === 'race' ? 0.8 : 0.3);
  }

  private pause() {
    if (this.state !== 'race' && this.state !== 'intro') return;
    this.state = 'paused';
    this.menu.show('pause');
    this.input.releaseAll();
    if (this.audioReady) this.audio.suspend();
  }

  private resume() {
    this.menu.show('none');
    this.state = this.race.phase === 'grid' ? 'intro' : 'race';
    if (this.audioReady) this.audio.resume();
  }

  private showResults() {
    this.state = 'results';
    const rows = this.race.classification();
    const p = this.race.player;
    const title = p.position === 1 ? 'Victory' : p.position <= 3 ? `Podium · P${p.position}` : `Finished P${p.position}`;
    const laps = this.race.opts.laps;
    const lede = `${laps} lap${laps === 1 ? '' : 's'} · ${COSTA_DEL_SOL.name}`;
    this.hud.show(false);
    this.menu.showResults(rows, title, lede, () => this.startRace(this.mode, this.menu.setup), () => this.toMenu(), () => this.startReplay());
  }

  // ------------------------------------------------------------------ frame

  private frame(dt: number) {
    this.lastDt = dt;
    this.input.update(dt);
    this.stateTime += dt;
    const race = this.race;
    const st = this.input.state;

    // the key that closes a menu must not also act in the game this frame
    const menuFrame = this.state === 'menu' || this.state === 'results' || this.state === 'paused';
    if (menuFrame) {
      this.menu.update(this.input.nav);
      st.pause = false;
      st.camera = false;
      st.drs = false;
    }

    if (this.state === 'menu') {
      race.update(dt);
      this.syncAllViews(dt);
      this.cams.orbit(dt, this.playerRigPos(), 7.2, 1.35, 0.1);
      this.dofTarget.copy(this.playerRigPos()).y += 0.5;
    } else if (this.state === 'intro') {
      // a short orbit of the player's car on the grid, then chase cam + lights
      race.playerInput.throttle = st.throttle;
      race.update(dt);
      this.syncAllViews(dt);
      if (st.pause) this.pause();
      if (this.stateTime < 2.6) this.cams.orbit(dt, this.playerRigPos(), 6.5 - this.stateTime * 0.6, 1.2 + this.stateTime * 0.2, 0.5);
      else {
        this.cams.update(dt, race.player.car, this.rigs.get(race.player.entry)!, this.track);
        if (this.stateTime > 3.4 && race.phase === 'grid') race.startLights();
      }
      if (race.phase === 'racing') {
        this.state = 'race';
        this.hud.setHint(null);
      }
      this.handleRaceEvents();
    } else if (this.state === 'race') {
      if (st.pause) {
        this.pause();
      } else {
        this.driveInput(dt);
        race.update(dt);
        this.handleRaceEvents();
        this.syncAllViews(dt);
        if (st.camera) {
          this.cams.next();
          this.hud.cameraLabel(CAMERA_LABEL[this.cams.mode]);
        }
        this.cams.lookBack = st.lookBack;
        this.cams.update(dt, race.player.car, this.rigs.get(race.player.entry)!, this.track);
        if (race.isTimeTrial && this.stateTime > 4) this.hud.setHint(null);
        if (st.reset) this.resetPlayer();
        // chequered flag → results
        if (race.player.finished && !race.isTimeTrial) {
          if (this.finishTimer < 0) {
            this.finishTimer = 0;
            // the car drives itself on the cool-down lap
            this.autopilot = new AIDriver(0.7, 0.2);
            this.autopilot.startFrom(race.player.car, this.track);
          }
          this.finishTimer += dt;
          if (this.finishTimer > 1.5 && this.cams.mode !== 'tv') this.cams.set('tv');
          if (this.finishTimer > 6) this.showResults();
        }
      }
    }

    if (this.state === 'race' || this.state === 'intro') {
      this.hud.update(dt, race);
      this.effects(dt);
      this.speedFx();
    } else if (this.state === 'results') {
      this.driveInput(dt);
      race.update(dt);
      this.syncAllViews(dt);
      this.cams.update(dt, race.player.car, this.rigs.get(race.player.entry)!, this.track);
    } else if (this.state === 'replay') {
      this.replayT += dt;
      const shot = Math.floor(this.stateTime / 4.5);
      if (shot !== this.replayShot) {
        this.replayShot = shot;
        this.cams.set(REPLAY_SHOTS[shot % REPLAY_SHOTS.length]);
      }
      this.replay.apply(this.replayT, this.track.length);
      this.syncAllViews(dt, this.replay.ghosts);
      this.cams.update(dt, this.replay.ghosts[race.player.id], this.rigs.get(race.player.entry)!, this.track);
      const span = Math.max(1, this.replayEnd - this.replayStart);
      this.replayBar.style.width = `${Math.min(100, ((this.replayT - this.replayStart) / span) * 100)}%`;
      if (this.replayT >= this.replayEnd || st.pause || this.input.nav.accept || this.input.nav.back) this.endReplay();
    }
    if (this.state === 'race' || this.state === 'intro' || this.state === 'results') this.replay.record(dt, race);

    this.trackside.startLights.set(race.phase === 'lights' ? race.lightsLit : 0);
    this.env.update(dt, this.camera);
    this.env.focusShadow(this.playerRigPos());
    this.trackside.update(dt, this.camera);
    this.particles.update(this.state === 'paused' ? 0 : dt);
    this.updateAudio(dt);
    this.gfx.render(dt);
    this.adaptQuality(dt);
  }

  /**
   * Dev/demo hook: start a session immediately, optionally with the player on
   * autopilot and the race fast-forwarded (e.g. ?demo=race&cam=tcam&skip=40).
   */
  debugStart(opts: { mode?: 'race' | 'timetrial'; camera?: string; autopilot?: boolean; skip?: number; time?: TimeOfDay; grid?: number; laps?: number }) {
    const setup = { ...this.menu.setup };
    if (opts.time) setup.time = opts.time;
    if (opts.grid !== undefined) setup.grid = opts.grid;
    if (opts.laps) setup.laps = opts.laps;
    this.startRace(opts.mode ?? 'race', setup);
    if (opts.camera) this.cams.set(opts.camera as never);
    if (opts.autopilot) {
      this.autopilot = new AIDriver(0.985, 0.6);
      this.autopilot.startFrom(this.race.player.car, this.track);
    }
    const skip = opts.skip ?? 0;
    if (skip > 0) {
      if (this.race.phase === 'grid') this.race.startLights();
      this.state = 'race';
      this.hud.setHint(null);
      const dt = 1 / 60;
      for (let t = 0; t < skip; t += dt) {
        this.driveInput(dt);
        this.race.update(dt);
        this.hud.handleEvents(this.race, this.race.events);
      }
      this.syncAllViews(dt);
    }
  }

  private driveInput(dt: number) {
    const race = this.race;
    const st = this.input.state;
    const car = race.player.car;
    if (this.autopilot) {
      const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
      this.autopilot.update(dt, car, this.track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
      Object.assign(race.playerInput, this.autopilot.input);
      race.playerInput.shiftUp = race.playerInput.shiftDown = false;
      return;
    }
    const v = Math.max(0, car.vx);
    // speed-sensitive steering lock; the pad gets a little more at speed
    const lock = (st.usingPad ? 0.4 : 0.36) / (1 + v / (st.usingPad ? 34 : 30));
    race.playerInput.steer = st.steer * lock;
    race.playerInput.throttle = st.throttle;
    race.playerInput.brake = st.brake;
    race.playerInput.ers = st.ers;
    race.playerInput.shiftUp = st.shiftUp;
    race.playerInput.shiftDown = st.shiftDown;
    if (st.drs) race.playerDrsRequest = true;
    void dt;
  }

  private resetPlayer() {
    const c = this.race.player;
    const s = c.car.s - 10;
    c.car.placeOnTrack(this.track, s, this.track.racingLineAt(s));
    c.car.vx = 10;
    c.car.gear = 2;
    this.hud.flash('Reset', '', '', 1.2);
  }

  private handleRaceEvents() {
    const ev = this.race.events;
    if (ev.length === 0) {
      // lights beeps are derived from lightsLit changes
    }
    this.hud.handleEvents(this.race, ev);
    const line = this.engineer.update(this.lastDt, this.race, ev);
    if (line) {
      this.hud.radio(line, uiColor(this.race.player.entry.team));
      if (this.audioReady) this.audio.ui('select');
    }
    for (const e of ev) {
      // time trial record, kept across sessions
      if (this.race.isTimeTrial && e.kind === 'lap' && this.race.player.lapValid !== undefined) {
        const lapTime = e.value ?? Infinity;
        const valid = this.race.player.lapTimes.length > 0 && this.race.player.bestLap === lapTime;
        const rec = this.loadRecord();
        if (valid && lapTime < rec) {
          this.saveRecord(lapTime);
          if (isFinite(rec)) this.hud.flash('New record', `${fmtTime(lapTime)} · was ${fmtTime(rec)}`, 'purple', 3.5);
        }
      }
      if (!this.audioReady) continue;
      if (e.kind === 'lights-out') this.audio.startBeep(true);
      if (e.kind === 'contact') {
        this.audio.impact(Math.min(1, (e.value ?? 0) / 12));
        this.cams.impulse = Math.min(1, (e.value ?? 0) / 10);
      }
    }
    // a beep for each light
    const lit = this.race.lightsLit;
    if (lit !== this.lastLit) {
      if (lit > 0 && this.audioReady) this.audio.startBeep(false);
      this.lastLit = lit;
    }
  }
  private lastLit = 0;

  private loadRecord(): number {
    try {
      const v = Number(localStorage.getItem('apexgp.tt.costa'));
      return v > 0 ? v : Infinity;
    } catch {
      return Infinity;
    }
  }

  private saveRecord(t: number) {
    try {
      localStorage.setItem('apexgp.tt.costa', String(t));
    } catch {
      /* storage unavailable */
    }
  }

  private startReplay() {
    if (this.replay.duration < 3) return;
    this.state = 'replay';
    this.stateTime = 0;
    this.replayShot = -1;
    this.replayEnd = this.race.time - 0.1;
    this.replayStart = Math.max(this.replay.startTime, this.replayEnd - 45);
    this.replayT = this.replayStart;
    this.menu.show('none');
    this.hud.show(false);
    this.gfx.setDepthOfField(false);
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    this.particles.clear();
    this.replayBadge.classList.add('on');
  }

  private endReplay() {
    this.replayBadge.classList.remove('on');
    this.cams.set('tv');
    this.input.releaseAll();
    this.showResults();
  }

  private syncAllViews(dt: number, ghosts?: CarPhysics[]) {
    this.camPos.copy(this.camera.position);
    const cockpit = (this.state === 'race' || this.state === 'intro') && this.cams.mode === 'cockpit';
    if (cockpit !== this.driverHidden) {
      this.driverHidden = cockpit;
      this.rigs.get(this.race.player.entry)?.setDriverVisible(!cockpit);
    }
    for (const c of this.race.cars) {
      const view = this.views.get(c.entry)!;
      view.sync(ghosts ? ghosts[c.id] : c.car, this.track, dt, this.camPos, c.isPlayer, this.time === 'overcast');
    }
  }

  private playerRigPos(): THREE.Vector3 {
    const rig = this.rigs.get(this.race.player.entry)!;
    return rig.root.getWorldPosition(this.tmp2);
  }

  // ------------------------------------------------------------------ fx

  private effects(dt: number) {
    const cam = this.camera.position;
    for (const c of this.race.cars) {
      const car = c.car;
      const rig = this.rigs.get(c.entry)!;
      rig.root.getWorldPosition(this.tmp);
      if (this.tmp.distanceToSquared(cam) > 260 * 260) continue;
      const [wx, wz] = car.worldVelocity();
      const vel = this.tmp2.set(wx, 0, wz);
      const speed = car.speed;
      const emit = (amount: number) => Math.random() < amount * dt * 60;
      const wheelPos = (a: THREE.Object3D) => a.getWorldPosition(this.tmp);

      // lock-ups & wheelspin → tyre smoke (sparingly: F1 tyres rarely smoke)
      if (car.lockup > 0.35 && speed > 8 && emit(car.lockup * 0.5)) {
        this.particles.smoke(wheelPos(rig.anchors.wheelFL), vel, car.lockup);
        this.particles.smoke(wheelPos(rig.anchors.wheelFR), vel, car.lockup);
      }
      if (car.wheelspin > 0.3 && emit(car.wheelspin * 0.6)) {
        this.particles.smoke(wheelPos(rig.anchors.wheelRL), vel, car.wheelspin);
        this.particles.smoke(wheelPos(rig.anchors.wheelRR), vel, car.wheelspin);
      }
      // big slides only
      const slide = Math.max(0, car.slipRear - 2.2) + Math.max(0, car.slipFront - 2.6);
      if (slide > 0.2 && speed > 10 && emit(Math.min(0.4, slide * 0.3))) {
        this.particles.smoke(wheelPos(rig.anchors.wheelRL), vel, Math.min(1, slide) * 0.6);
        this.particles.smoke(wheelPos(rig.anchors.wheelRR), vel, Math.min(1, slide) * 0.6);
      }
      // dirt off track
      const wheels: [number, THREE.Object3D][] = [
        [car.surfaceFL, rig.anchors.wheelFL],
        [car.surfaceFR, rig.anchors.wheelFR],
        [car.surfaceRL, rig.anchors.wheelRL],
        [car.surfaceRR, rig.anchors.wheelRR],
      ];
      for (const [sf, a] of wheels) {
        if ((sf === SURF.GRASS || sf === SURF.GRAVEL) && speed > 6 && emit(Math.min(1, speed / 30) * (sf === SURF.GRAVEL ? 0.7 : 0.3))) {
          this.particles.dust(wheelPos(a), vel, sf === SURF.GRAVEL, Math.min(1, speed / 25));
        }
      }
      // sparks: plank on the kerbs / compressions at high speed, walls, contact
      const hi = speed > 62;
      if ((hi && car.onKerb && emit(0.6)) || (speed > 75 && car.heave < -0.02 && emit(0.25)) || (car.contact.wallHit > 1 && emit(1)) || (c.contactTimer > 0 && speed > 20 && emit(0.8))) {
        rig.root.getWorldPosition(this.tmp);
        const back = this.tmp2.set(Math.sin(car.yaw), 0, Math.cos(car.yaw)).multiplyScalar(-0.6);
        this.tmp.add(back);
        this.particles.sparks(this.tmp, vel.set(wx, 0, wz), 6 + Math.floor(Math.random() * 8));
      }
      if (c.contactTimer > 0) c.contactTimer -= dt;
    }
  }

  private speedFx() {
    const car = this.race.player.car;
    const kmh = Math.max(0, car.vx * 3.6);
    const onboard = this.cams.mode === 'cockpit' || this.cams.mode === 'tcam' || this.cams.mode === 'nose' || this.cams.mode === 'chase' || this.cams.mode === 'far';
    const k = onboard ? Math.max(0, Math.min(1, (kmh - 170) / 170)) : 0;
    this.gfx.setSpeedBlur(k * k * 0.014 + (car.ersDeploying ? 0.002 : 0));
    this.gfx.setAberration(k * 0.0011);
  }

  // ------------------------------------------------------------------ audio

  private updateAudio(dt: number) {
    if (!this.audioReady) return;
    const a = this.audio;
    const race = this.race;
    if (this.state === 'menu' || this.state === 'results' || this.state === 'paused') {
      a.updatePlayer({ rpm: 4200, throttle: 0, brake: 0, speed: 0, gear: 0, slip: 0, surface: 0, onKerb: false, drs: false, ers: 0, limiter: false });
      a.updateOpponents([]);
      a.update(dt);
      return;
    }
    const replaying = this.state === 'replay';
    const carOf = (c: (typeof race.cars)[number]) => (replaying ? this.replay.ghosts[c.id] : c.car);
    const car = carOf(race.player);
    a.setView(this.cams.mode === 'cockpit' || this.cams.mode === 'tcam' || this.cams.mode === 'nose' ? 'cockpit' : this.cams.mode === 'tv' ? 'tv' : 'chase');
    if (car.lastShift !== 0) a.shift(car.lastShift > 0);
    const slip = Math.max(0, Math.max(car.slipRear, car.slipFront) - 0.85) + car.lockup + car.wheelspin * 0.8;
    const surf = Math.max(car.surfaceFL, car.surfaceFR, car.surfaceRL, car.surfaceRR);
    a.updatePlayer({
      rpm: car.rpm,
      throttle: car.throttle,
      brake: car.brake,
      speed: Math.max(0, car.vx),
      gear: car.gear,
      slip,
      surface: surf === SURF.KERB ? 0 : surf,
      onKerb: car.onKerb,
      drs: car.drsAnim > 0.5,
      ers: car.ersDeploying ? 1 : 0,
      limiter: car.limiter,
    });
    // opponents relative to the camera
    const cam = this.camera;
    const camRight = this.tmp.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const camVel = this.tmp2.copy(cam.position).sub(this.prevCamPos).divideScalar(Math.max(dt, 1e-3));
    this.prevCamPos.copy(cam.position);
    const list: { id: number; rpm: number; throttle: number; distance: number; relVel: number; pan: number }[] = [];
    for (const c of race.cars) {
      if (c.isPlayer) {
        if (this.cams.mode === 'tv') {
          const p = this.rigs.get(c.entry)!.root.position;
          const dx = p.x - cam.position.x, dy = p.y - cam.position.y, dz = p.z - cam.position.z;
          const d = Math.hypot(dx, dy, dz);
          const [wx, wz] = carOf(c).worldVelocity();
          a.setTvCamera(d, -(wx * dx + wz * dz) / Math.max(d, 1), Math.max(-1, Math.min(1, (dx * camRight.x + dz * camRight.z) / Math.max(d, 1))));
        }
        continue;
      }
      const rig = this.rigs.get(c.entry)!;
      const p = rig.root.position;
      const dx = p.x - cam.position.x, dy = p.y - cam.position.y, dz = p.z - cam.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 320) continue;
      const [wx, wz] = carOf(c).worldVelocity();
      // closing speed along the line of sight (+ = approaching)
      const relVel = -((wx - camVel.x) * dx + (wz - camVel.z) * dz) / Math.max(d, 1);
      const pan = Math.max(-1, Math.min(1, (dx * camRight.x + dz * camRight.z) / Math.max(d, 1)));
      list.push({ id: c.id, rpm: carOf(c).rpm, throttle: carOf(c).throttle, distance: d, relVel, pan });
    }
    list.sort((x, y) => x.distance - y.distance);
    a.updateOpponents(list.slice(0, 4));
    a.update(dt);
  }

  // ------------------------------------------------------------------ perf

  /**
   * Dynamic resolution. Once a second: drop the render scale if frames run
   * long; creep back up after a few seconds of headroom, and remember a
   * ceiling if raising it made things slow again.
   */
  private adaptQuality(dt: number) {
    this.fpsAvg = this.fpsAvg * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    this.qualityCheck += dt;
    if (this.qualityCheck < 1) return;
    this.qualityCheck = 0;
    (window as unknown as { __fps: number }).__fps = Math.round(this.fpsAvg);
    if (this.state !== 'race' && this.state !== 'intro' && this.state !== 'menu') return;
    const gfx = this.gfx;
    if (this.fpsAvg < 52) {
      if (this.headroom < 3 && gfx.dynamicScale < this.scaleCeiling) this.scaleCeiling = gfx.dynamicScale - 0.01;
      gfx.setDynamicScale(gfx.dynamicScale - 0.07);
      this.headroom = 0;
    } else if (this.fpsAvg > 58.5) {
      this.headroom++;
      if (this.headroom >= 4 && gfx.dynamicScale < this.scaleCeiling) {
        gfx.setDynamicScale(Math.min(this.scaleCeiling, gfx.dynamicScale + 0.05));
        this.headroom = 0;
      }
    }
  }
  private headroom = 0;
  private scaleCeiling = 1;
}
