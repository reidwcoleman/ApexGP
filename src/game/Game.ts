import * as THREE from 'three';
import { Renderer, type QualityLevel } from '../core/Renderer.ts';
import { Input } from '../core/Input.ts';
import { GameAudio } from '../core/Audio.ts';
import { Track, SURF } from '../world/Track.ts';
import { CIRCUITS, MONZA } from '../world/Circuits.ts';
import { setEvent } from '../world/event.ts';
import { buildTrackside, type Trackside } from '../world/TrackMesh.ts';
import { createEnvironment, type Environment } from '../world/Environment.ts';
import { createCar, preloadCarAssets, type CarRig } from '../car/CarModel.ts';
import { TEAMS, allEntries, uiColor, type Entry } from '../race/Teams.ts';
import { Engineer } from '../race/Engineer.ts';
import { AIDriver } from '../sim/AIDriver.ts';
import { Race, aiQualifyingTime } from '../race/Race.ts';
import { CarView } from './CarView.ts';
import { Cameras, CAMERA_LABEL, ONBOARD, type CameraMode } from './Cameras.ts';
import { ReplayBuffer } from './Replay.ts';
import { Flashback } from './Flashback.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import { Particles } from '../fx/Particles.ts';
import { CarEffects } from '../fx/CarEffects.ts';
import { Debris } from '../fx/Debris.ts';
import { HUD, fmtTime } from '../ui/HUD.ts';
import { Menu, DIFFICULTY, GRID, type RaceSetup, type Settings } from '../ui/Menu.ts';
import { Weather, planWeather, isLowSun, WEATHER_LABEL, TIME_LABEL, type WeatherPlan, type WeatherState, type WeatherChoice, type TimeChoice } from '../world/Weather.ts';
import { applyWeatherUniforms } from '../world/weatherUniforms.ts';
import { buildPitComplex, type PitComplex, type BoxState } from '../world/PitComplex.ts';
import { PlayerControl } from '../sim/PlayerControl.ts';
import { RacingProfile } from '../sim/RacingProfile.ts';
import { F1_SPEC } from '../sim/CarPhysics.ts';
import { RacingLineAssist } from './RacingLineAssist.ts';
import { Celebration } from './Celebration.ts';
import type { AssistConfig } from './Assists.ts';
import { COMPOUNDS } from '../race/Pit.ts';

const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

type GameState = 'boot' | 'menu' | 'intro' | 'race' | 'paused' | 'celebration' | 'results' | 'replay' | 'flashback';

const REPLAY_SHOTS: CameraMode[] = ['tv', 'chase', 'heli', 'tcam', 'tv', 'wheel', 'tv', 'far'];

/** colour of the light on smoke/dust for the weather */
function smokeLight(w: WeatherState): THREE.Color {
  const sun = isLowSun(w.time) ? new THREE.Color(1.0, 0.86, 0.72) : new THREE.Color(1, 1, 1);
  const grey = new THREE.Color(0.74, 0.77, 0.82);
  return sun.lerp(grey, Math.min(1, w.cloud * 0.9 + w.rain * 0.3));
}

type CompoundRig = CarRig & { setCompound?: (c: string) => void };

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
  private pits!: PitComplex;
  private entries: Entry[] = allEntries();
  private rigs = new Map<Entry, CarRig>();
  private views = new Map<Entry, CarView>();
  private carsGroup = new THREE.Group();
  private race!: Race;
  private cams!: Cameras;
  private particles = new Particles();
  private carFx!: CarEffects;
  private tvDofOn = false;
  private debris!: Debris;
  /** seconds since the player's car was destroyed (−1 = still racing) */
  private retireTimer = -1;
  private hud: HUD;
  private menu: Menu;
  private state: GameState = 'boot';
  private stateTime = 0;
  private timer = new THREE.Timer();
  private mode: 'race' | 'timetrial' = 'race';
  /** the forecast for the next/current session (re-rolled for every new race) */
  private plan!: WeatherPlan;
  private planKey = '';
  private readonly rigCompound = new Map<Entry, string>();
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
  private flash = new Flashback();
  private fbT = 0;
  private fbEntry = 0;
  private fbSat = 1;
  private fbBadge: HTMLDivElement;
  private fbBar: HTMLElement;
  flashbacksUsed = 0;
  private prevCamPos = new THREE.Vector3();
  private fpsAvg = 60;
  private dofTarget = new THREE.Vector3();
  private lastDt = 0.016;
  private engineer = new Engineer();
  private autopilot: AIDriver | null = null;
  private quali: { setup: RaceSetup } | null = null;
  private gridOrder: Entry[] | null = null;
  private control = new PlayerControl();
  private line!: RacingLineAssist;
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
    this.fbBadge = document.createElement('div');
    this.fbBadge.className = 'replay-badge flashback';
    this.fbBadge.innerHTML = '<span class="rdot"></span><b>Flashback</b><span class="rtrack"><i></i></span><span class="rskip">← → scrub · Enter resume · Esc cancel</span>';
    uiRoot.appendChild(this.fbBadge);
    this.fbBar = this.fbBadge.querySelector('i')!;
    this.menu = new Menu(uiRoot, {
      onSetupChange: (s) => this.applySetupPreview(s),
      forecast: () => this.forecastLabel(),
      onStart: (mode, s) => this.startRace(mode, s),
      onSettings: (s) => this.applySettings(s),
      onResume: () => this.resume(),
      onRestart: () => this.startRace(this.mode, this.menu.setup),
      onQuit: () => this.toMenu(),
      onResetCar: () => {
        this.resume();
        this.resetPlayer();
      },
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
    this.rollWeather(this.menu.setup);

    progress(0.08, 'Surveying the circuit');
    await tick();
    // ?track=<id> (dev/demo links) overrides the saved choice
    const want = new URLSearchParams(location.search).get('track') ?? this.menu.setup.track;
    this.track = new Track(CIRCUITS.find((c) => c.id === want) ?? MONZA);
    setEvent(this.track.def);
    this.menu.setup.track = this.track.def.id;

    progress(0.22, 'Laying asphalt, kerbs and barriers');
    await tick();
    this.trackside = buildTrackside(this.track, this.gfx);
    this.scene.add(this.trackside.group);

    progress(0.36, 'Opening the pit lane');
    await tick();
    this.pits = buildPitComplex(this.track, this.gfx);
    this.scene.add(this.pits.group);

    progress(0.42, 'Growing the park');
    await tick();
    const w0 = new Weather(this.plan).state;
    applyWeatherUniforms(w0);
    this.env = createEnvironment(this.track, this.gfx, this.scene, w0);
    this.scene.add(this.env.group);
    this.debris = new Debris(this.track, (x, z) => this.env.heightAt(x, z));
    this.scene.add(this.debris.group);
    this.carFx = new CarEffects(this.particles, this.debris);
    this.scene.add(this.carFx.fireLight);
    this.carFx.onImpact = (id, imp, isPlayer) => this.onImpact(id, imp.speed, isPlayer);
    this.carFx.onExplosion = (id, pos) => this.onExplosion(id, pos);

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
    this.particles.setLight(smokeLight(w0));

    this.cams = new Cameras(this.camera, this.track);
    this.line = new RacingLineAssist(this.track, RacingProfile.for(this.track, F1_SPEC));
    this.scene.add(this.line.mesh);
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
      playerCompound: setup.compound,
      gridOrder: this.gridOrder ?? undefined,
      weather: this.plan,
      damage: setup.damage,
    });
    this.particles.setLight(smokeLight(this.race.weatherState));
    this.rigCompound.clear();
    this.control.reset();
    this.applyAssists(setup.assists);
    // show only the cars in this session
    const inRace = new Set(this.race.cars.map((c) => c.entry));
    for (const [e, rig] of this.rigs) {
      rig.root.visible = inRace.has(e);
      rig.setDriverVisible(true);
      // a new car: undo any crash damage
      rig.setDamage({ fwL: 0, fwR: 0, rw: 0 }, [0, 0, 0, 0], 0);
      for (const w of ['wFL', 'wFR', 'wRL', 'wRR'] as const) rig.setWheelLost(w, false);
    }
    this.carFx?.resetDamage();
    this.retireTimer = -1;
    this.driverHidden = false;
    this.particles.clear();
    this.carFx.reset();
    this.replay.reset(this.race);
    this.flash.reset();
    this.flashbacksUsed = 0;
    return this.race;
  }

  /** roll a new forecast for the setup's weather/time choices */
  private rollWeather(setup: RaceSetup) {
    const laps = setup.laps;
    this.plan = planWeather(setup.weather, setup.time, laps * 85 + 60);
    this.planKey = `${setup.weather}/${setup.time}`;
  }

  /** what a Random choice rolled: "Rain", "Overcast → Rain" / "Golden hour" */
  private forecastLabel(): { weather: string; time: string } {
    if (!this.plan) return { weather: '', time: '' };
    const p = this.plan;
    const w = p.start === p.end ? WEATHER_LABEL[p.start] : `${WEATHER_LABEL[p.start]} → ${WEATHER_LABEL[p.end]}`;
    return { weather: w, time: TIME_LABEL[p.time] };
  }

  private toMenu() {
    // a fresh forecast every time we come back from a session
    if (this.state !== 'boot') this.rollWeather(this.menu.setup);
    this.state = 'menu';
    this.stateTime = 0;
    this.quali = null;
    this.gridOrder = null;
    this.makeRace('race', this.menu.setup);
    this.hud.show(false);
    this.menu.show('title');
    this.gfx.setDepthOfField(true, this.dofTarget, 6, 2.2);
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    if (this.audioReady) this.audio.crowd(0.35);
  }

  private applySetupPreview(s: RaceSetup) {
    // a different circuit means a different world: rebuild it from scratch (the setup is saved)
    if (s.track !== this.track.def.id) {
      location.reload();
      return;
    }
    if (`${s.weather}/${s.time}` !== this.planKey) this.rollWeather(s);
    this.makeRace('race', s);
  }

  private applySettings(s: Settings) {
    if (s.quality !== this.gfx.qualityLevel) this.gfx.setQuality(s.quality);
    this.particles.resolution = { low: 0.35, medium: 0.4, high: 0.5, ultra: 0.6 }[s.quality];
    if (this.cams && this.cams.mode !== s.camera && this.state !== 'menu') this.cams.set(s.camera);
    if (this.audioReady) this.audio.setVolume(s.volume);
  }

  /** one-shot qualifying: a flying lap sets the grid against the AI's times */
  private startQualifying(setup: RaceSetup) {
    this.quali = { setup };
    this.startRace('timetrial', setup, true);
    this.hud.setHint('Qualifying · one flying lap — make it count');
    this.hud.flash('Qualifying', 'one flying lap', '', 2.5);
  }

  /** this circuit's lap relative to Monza's, from the speed profiles (AI qualifying is fitted at Monza) */
  private trackLapScale(): number {
    if (this.track.def.id === 'monza') return 1;
    this.monzaLap ||= RacingProfile.for(new Track(MONZA), F1_SPEC).lapTime;
    return this.race.profile.lapTime / this.monzaLap;
  }
  private monzaLap = 0;

  private endQualifying(time: number, valid: boolean) {
    const setup = this.quali!.setup;
    this.quali = null;
    const player = this.race.player.entry;
    const diff = DIFFICULTY[setup.difficulty].value;
    const wf = this.race.conditionsLapFactor();
    const times = this.entries.map((e) => ({ entry: e, time: e === player ? (valid ? time : Infinity) : aiQualifyingTime(e, diff, wf, this.trackLapScale()) }));
    times.sort((a, b) => a.time - b.time);
    const order = times.map((t) => t.entry);
    const pos = order.indexOf(player) + 1;
    this.state = 'results';
    this.autopilot = new AIDriver(0.7, 0.2);
    this.autopilot.startFrom(this.race.player.car, this.track);
    this.hud.show(false);
    const pole = times[0].time;
    this.menu.showQualifying(
      times.map((t, i) => ({ pos: i + 1, entry: t.entry, isPlayer: t.entry === player, time: t.time, gap: t.time - pole })),
      pos === 1 ? 'Pole position!' : `Qualified P${pos}`,
      valid ? `${fmtTime(time)} · ${this.track.def.name}` : 'Lap deleted for track limits — you start from the back',
      () => {
        this.gridOrder = order;
        this.startRace('race', setup);
      },
      () => this.toMenu(),
    );
  }

  private startRace(mode: 'race' | 'timetrial', setup: RaceSetup, qualifying = false) {
    if (mode === 'race' && GRID[setup.grid].slot === -1 && !this.gridOrder && !qualifying) {
      this.startQualifying(setup);
      return;
    }
    this.mode = qualifying ? 'race' : mode;
    this.autopilot = null;
    if (`${setup.weather}/${setup.time}` !== this.planKey) this.rollWeather(setup);
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

  /** the podium: top three celebrating, then the results */
  private startCelebration() {
    const top = this.race.classification().slice(0, 3).map((r) => r.entry);
    if (top.length < 3 || this.race.isTimeTrial) return this.showResults();
    this.celebration = new Celebration(this.track, (x, z) => this.env.heightAt(x, z), top, this.hud.root.parentElement ?? document.body);
    this.scene.add(this.celebration.group);
    // the top three are parked in parc fermé below the podium (drivers out); the rest are in the garages
    for (const rig of this.rigs.values()) rig.root.visible = false;
    const up = new THREE.Vector3(0, 1, 0);
    top.forEach((e, i) => {
      const rig = this.rigs.get(e);
      const slot = this.celebration!.parkSlots[i];
      if (!rig || !slot) return;
      rig.root.visible = true;
      rig.root.position.copy(slot.pos);
      rig.root.quaternion.setFromAxisAngle(up, slot.yaw);
      rig.body.rotation.set(0, 0, 0);
      rig.body.position.y = 0;
      rig.setSteer(0);
      rig.setWheelSpeed(0);
      rig.setBrakeGlow(0);
      rig.setDrs(0);
      rig.setRainLight(false);
      rig.setDetail(0);
      rig.setDriverVisible(false);
    });
    this.lastCrowd = -1;
    this.state = 'celebration';
    this.stateTime = 0;
    this.hud.show(false);
    if (this.audioReady) this.audio.crowd(1);
  }
  private endCelebration() {
    this.celebration?.dispose();
    this.celebration = null;
    this.carsGroup.visible = true;
    const inRace = new Set(this.race.cars.map((c) => c.entry));
    for (const [e, rig] of this.rigs) {
      rig.root.visible = inRace.has(e);
      rig.setDriverVisible(true);
    }
    this.gfx.setDepthOfField(false);
    this.showResults();
  }
  private celebration: Celebration | null = null;
  private lastCrowd = -1;

  private showResults() {
    this.state = 'results';
    const rows = this.race.classification();
    const p = this.race.player;
    const title = p.retired ? 'Retired · DNF' : p.position === 1 ? 'Victory' : p.position <= 3 ? `Podium · P${p.position}` : `Finished P${p.position}`;
    const laps = this.race.opts.laps;
    const lede = `${laps} lap${laps === 1 ? '' : 's'} · ${this.track.def.name} · ${WEATHER_LABEL[this.race.weatherState.kind]}`;
    this.hud.show(false);
    // the next race gets new weather
    this.rollWeather(this.menu.setup);
    this.menu.showResults(rows, title, lede, () => this.startRace(this.mode, this.menu.setup), () => this.toMenu(), () => this.startReplay());
  }

  // ------------------------------------------------------------------ frame

  private frame(dt: number) {
    this.lastDt = dt;
    this.input.update(dt);
    this.stateTime += dt;
    const st = this.input.state;

    // the key that closes a menu must not also act in the game this frame
    const menuFrame = this.state === 'menu' || this.state === 'results' || this.state === 'paused';
    if (menuFrame) {
      this.menu.update(this.input.nav);
      st.pause = false;
      st.camera = false;
      st.drs = false;
      st.pit = false;
    }
    // read the session after the menu acted — it may have started a new one
    const race = this.race;

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
        if (st.reset) this.startFlashback();
        if (st.pit && !race.isTimeTrial && !race.player.finished && race.player.pit.phase === 'none') {
          race.playerPitRequest = !race.playerPitRequest;
          const next = COMPOUNDS[race.playerNextCompound()].label;
          if (race.playerPitRequest) this.hud.flash('Box this lap', `${next} tyres`, 'green', 2.2);
          else this.hud.flash('Pit request cancelled', '', '', 1.4);
          if (this.audioReady) this.audio.ui('select');
        }
        // the player's car is destroyed: watch it burn, then leave the race (or flash back)
        if (race.player.retired && !race.isTimeTrial) {
          if (this.retireTimer < 0) {
            this.retireTimer = 0;
            this.hud.setHint('Your race is over · <kbd>R</kbd> flashback · <kbd>Enter</kbd> leave the race');
          }
          this.retireTimer += dt;
          if (this.retireTimer > 2.2 && this.cams.mode !== 'tv') this.cams.set('tv');
          if (this.retireTimer > 11 || (this.retireTimer > 1.2 && this.input.nav.accept)) {
            this.hud.setHint(null);
            this.showResults();
          }
        } else if (this.retireTimer >= 0) {
          // flashed back to before it happened
          this.retireTimer = -1;
          this.hud.setHint(null);
          this.cams.set(this.menu.settings.camera);
        }
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
          if (this.finishTimer > 6) this.startCelebration();
        }
      }
    }

    if (this.state === 'race' || this.state === 'intro') {
      this.hud.update(dt, race);
      this.effects(dt);
      this.speedFx();
    } else if (this.state === 'celebration') {
      // the race clock runs on (weather), but the cars stay where they're parked
      this.driveInput(dt);
      race.update(dt);
      const cel = this.celebration!;
      const done = cel.update(dt, this.camera);
      const dof = cel.dof;
      this.gfx.setDepthOfField(true, cel.focus(this.dofTarget), dof.range, dof.bokeh);
      if (this.audioReady && Math.abs(cel.crowdLevel - this.lastCrowd) > 0.01) {
        this.lastCrowd = cel.crowdLevel;
        this.audio.crowd(cel.crowdLevel);
      }
      if (done || this.input.nav.accept || this.input.nav.back) this.endCelebration();
    } else if (this.state === 'results') {
      this.driveInput(dt);
      race.update(dt);
      this.syncAllViews(dt);
      this.cams.update(dt, race.player.car, this.rigs.get(race.player.entry)!, this.track);
      this.effects(dt);
    } else if (this.state === 'flashback') {
      // scrub with left/right (hold), confirm or cancel
      const auto = this.stateTime < 0.7 ? -3.5 : 0;
      this.fbT += (auto + -st.steer * 4) * dt;
      const oldest = Math.max(this.flash.oldest, this.replay.startTime);
      this.fbT = Math.max(oldest, Math.min(this.fbEntry, this.fbT));
      this.replay.apply(this.fbT, this.track.length);
      this.syncAllViews(dt, this.replay.ghosts);
      this.cams.update(dt, this.replay.ghosts[race.player.id], this.rigs.get(race.player.entry)!, this.track);
      this.fbBar.style.width = `${((this.fbT - oldest) / Math.max(0.1, this.fbEntry - oldest)) * 100}%`;
      if (this.input.nav.accept || (st.reset && this.stateTime > 0.2)) this.endFlashback(true);
      else if (this.input.nav.back) this.endFlashback(false);
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
    // the TV camera has a real lens: focus pulled onto the car, shallow on the long end
    const tvView = this.cams.mode === 'tv' && (this.state === 'race' || this.state === 'results' || this.state === 'replay');
    if (tvView) {
      this.gfx.setDepthOfField(true, this.cams.tvFocus, this.cams.tvRange, this.cams.tvDof);
      this.tvDofOn = true;
    } else if (this.tvDofOn) {
      this.tvDofOn = false;
      if (this.state !== 'menu' && this.state !== 'celebration') this.gfx.setDepthOfField(false);
    }
    if (this.state === 'race' || this.state === 'intro' || this.state === 'results') this.replay.record(dt, race);
    if (this.state === 'race' && race.phase === 'racing' && !race.player.finished && !race.player.retired) this.flash.record(dt, race);

    this.trackside.startLights.set(race.phase === 'lights' ? race.lightsLit : 0);
    const showLine = (this.state === 'race' || this.state === 'intro') && this.line.mode !== 'off' && this.cams.mode !== 'tv' && this.cams.mode !== 'heli' && !race.player.finished;
    this.line.mesh.visible = showLine;
    // the line's colours compare against dry targets: scale the car's speed up by the grip it lacks
    if (showLine) this.line.update(race.player.car.s, Math.max(0, race.player.car.vx) / Math.sqrt(Math.max(0.3, race.player.car.gripFactor)));
    applyWeatherUniforms(race.weatherState);
    this.env.setWeather(race.weatherState);
    this.env.update(dt, this.camera);
    this.env.focusShadow(this.celebration ? this.celebration.center : this.playerRigPos());
    this.updatePits(dt, race);
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
  debugStart(opts: { mode?: 'race' | 'timetrial'; camera?: string; autopilot?: boolean; skip?: number; weather?: WeatherChoice; time?: TimeChoice; grid?: number; laps?: number }) {
    const setup = { ...this.menu.setup };
    if (opts.weather) setup.weather = opts.weather;
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
    // pads drive the wheel angle directly; the keyboard uses the chosen mode
    const a = this.menu.setup.assists;
    this.control.aids.steeringMode = st.usingPad ? 'direct' : a.keyboard;
    const out = this.control.update(
      dt,
      { steer: st.steer, throttle: st.throttle, brake: st.brake, usingPad: st.usingPad, ers: st.ers, shiftUp: st.shiftUp, shiftDown: st.shiftDown },
      car,
      this.track,
      race.profile,
    );
    Object.assign(race.playerInput, out);
    if (st.drs) race.playerDrsRequest = true;
  }

  private applyAssists(a: AssistConfig) {
    const car = this.race.player.car;
    car.assists = { traction: a.traction, abs: a.abs, stability: a.stability, autoGear: a.gearbox === 'auto', arcade: a.arcade };
    this.control.aids.brakingAssist = a.braking;
    this.control.aids.steeringMode = a.keyboard;
    this.race.playerDrsAuto = a.drs === 'auto';
    this.line.setMode(a.line);
  }

  private resetPlayer() {
    const c = this.race.player;
    const s = c.car.s - 10;
    c.car.placeOnTrack(this.track, s, this.track.racingLineAt(s));
    c.car.setSpeed(10);
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
      if (this.quali && e.kind === 'lap') {
        this.endQualifying(e.value ?? Infinity, e.valid !== false);
        return;
      }
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
      if (e.kind === 'retired' && e.car === this.race.player.id) this.audio.ui('back');
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
      const v = Number(localStorage.getItem('apexgp.tt.monza'));
      return v > 0 ? v : Infinity;
    } catch {
      return Infinity;
    }
  }

  private saveRecord(t: number) {
    try {
      localStorage.setItem('apexgp.tt.monza', String(t));
    } catch {
      /* storage unavailable */
    }
  }

  private startFlashback() {
    if (!this.flash.available || this.race.player.finished) {
      this.hud.flash('Flashback unavailable', '', '', 1.2);
      return;
    }
    this.state = 'flashback';
    this.stateTime = 0;
    this.fbEntry = this.race.time;
    this.fbT = this.race.time;
    this.fbSat = this.gfx.grade.uniforms.get('saturation')!.value as number;
    this.gfx.grade.set({ saturation: 0.25 });
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    this.particles.clear();
    this.fbBadge.classList.add('on');
    this.input.releaseAll();
    if (this.audioReady) this.audio.suspend();
  }

  private endFlashback(apply: boolean) {
    const race = this.race;
    if (apply && this.fbT < this.fbEntry - 0.2) {
      const t = this.flash.restore(race, this.fbT);
      this.replay.truncate(t);
      this.control.reset();
      this.carFx.reset();
      this.flashbacksUsed++;
      this.hud.flash('Flashback', `${this.flashbacksUsed} used`, '', 1.4);
    }
    this.gfx.grade.set({ saturation: this.fbSat });
    this.fbBadge.classList.remove('on');
    this.state = 'race';
    this.stateTime = 5;
    this.input.releaseAll();
    this.syncAllViews(0.016);
    if (this.audioReady) this.audio.resume();
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
    const w = this.race.weatherState;
    const rainLight = w.wetness > 0.22 || w.rain > 0.08 || w.fog > 0.85;
    for (const c of this.race.cars) {
      const view = this.views.get(c.entry)!;
      view.sync(ghosts ? ghosts[c.id] : c.car, this.track, dt, this.camPos, c.isPlayer, rainLight);
      if (this.rigCompound.get(c.entry) !== c.compound) {
        this.rigCompound.set(c.entry, c.compound);
        (this.rigs.get(c.entry) as CompoundRig).setCompound?.(c.compound);
      }
    }
  }

  /** a damaging hit on some car: crunch and camera shake for the player's, a distant crunch for others */
  private onImpact(id: number, speed: number, isPlayer: boolean) {
    const s = Math.min(1, (speed - 3) / 22);
    if (s <= 0) return;
    if (isPlayer) {
      this.cams.impulse = Math.max(this.cams.impulse, Math.min(1, 0.25 + s));
      if (this.audioReady) this.audio.impact(s);
      return;
    }
    const rig = this.rigs.get(this.race.cars[id].entry);
    if (!rig || !this.audioReady) return;
    const d = rig.root.position.distanceTo(this.camera.position);
    if (d < 120) this.audio.impact(s * Math.min(1, 12 / (d + 4)));
  }

  private onExplosion(id: number, pos: THREE.Vector3) {
    const d = pos.distanceTo(this.camera.position);
    const near = this.race.cars[id].isPlayer ? 1 : Math.min(1, 25 / (d + 10));
    if (this.audioReady) this.audio.explosion(near);
    this.cams.impulse = Math.max(this.cams.impulse, Math.min(1, 40 / (d + 20)));
  }

  private playerRigPos(): THREE.Vector3 {
    const rig = this.rigs.get(this.race.player.entry)!;
    return rig.root.getWorldPosition(this.tmp2);
  }

  // ------------------------------------------------------------------ fx

  private effects(dt: number) {
    this.carFx.update(dt, this.race, this.rigs, this.camera.position, this.race.weather.state);
  }

  /** pit crews: which boxes are expecting, servicing or releasing a car */
  private readonly boxState: BoxState[] = [];
  private readonly boxProgress: number[] = [];
  private readonly releaseTimer = new Map<number, number>();
  private updatePits(dt: number, race: Race) {
    const rank: Record<BoxState, number> = { idle: 0, release: 1, ready: 2, service: 3 };
    for (let k = 0; k < TEAMS.length; k++) {
      this.boxState[k] = 'idle';
      this.boxProgress[k] = 0;
    }
    for (const c of race.cars) {
      const k = TEAMS.indexOf(c.entry.team);
      let st: BoxState = 'idle';
      let prog = 0;
      const ps = c.pit;
      if (ps.phase === 'in') st = 'ready';
      else if (ps.phase === 'stop') {
        st = 'service';
        prog = Math.min(1, ps.timer / Math.max(0.1, ps.stopTime));
      } else if (ps.phase === 'out') {
        st = 'release';
        this.releaseTimer.set(c.id, 1.5);
      } else {
        const t = (this.releaseTimer.get(c.id) ?? 0) - dt;
        this.releaseTimer.set(c.id, t);
        if (t > 0) st = 'release';
      }
      if (rank[st] > rank[this.boxState[k]]) {
        this.boxState[k] = st;
        this.boxProgress[k] = prog;
      }
    }
    for (let k = 0; k < TEAMS.length; k++) this.pits.setBox(k, this.boxState[k], this.boxProgress[k]);
    this.pits.update(dt, this.camera);
  }

  private speedFx() {
    const car = this.race.player.car;
    const kmh = Math.max(0, car.vx * 3.6);
    const onboard = !!ONBOARD[this.cams.mode] || this.cams.mode === 'chase' || this.cams.mode === 'far';
    const k = onboard ? Math.max(0, Math.min(1, (kmh - 170) / 170)) : 0;
    this.gfx.setSpeedBlur(k * k * 0.014 + (car.ersDeploying ? 0.002 : 0));
    this.gfx.setAberration(k * 0.0011);
    // rain on the lens for the onboard cameras, plus spray thrown up by the car ahead
    const w = this.race.weatherState;
    const cam = this.cams.mode;
    const lensCam = ONBOARD[cam] ? 1 : cam === 'chase' ? 0.35 : 0;
    const spray = car.dirty * Math.min(1, car.speed / 40) * w.wetness;
    const lens = lensCam * Math.min(1, w.rain * (0.55 + 0.45 * Math.min(1, car.speed / 45)) + spray * 0.8);
    (this.gfx as unknown as { setLensRain?: (a: number) => void }).setLensRain?.(this.state === 'race' || this.state === 'intro' ? lens : 0);
  }

  // ------------------------------------------------------------------ audio

  private updateAudio(dt: number) {
    if (!this.audioReady) return;
    const a = this.audio;
    const race = this.race;
    const w = race.weatherState;
    if (this.state === 'menu' || this.state === 'results' || this.state === 'paused') {
      const paused = this.state === 'paused';
      a.weather(paused ? 0 : w.rain, w.wetness, 0, paused ? 0 : w.lightning, paused ? 0 : Math.hypot(w.windX, w.windZ));
      a.updatePlayer({ rpm: 4200, throttle: 0, brake: 0, speed: 0, gear: 0, slip: 0, surface: 0, onKerb: false, drs: false, ers: 0, limiter: false });
      a.updateOpponents([]);
      a.update(dt);
      return;
    }
    const replaying = this.state === 'replay';
    const carOf = (c: (typeof race.cars)[number]) => (replaying ? this.replay.ghosts[c.id] : c.car);
    const car = carOf(race.player);
    a.setView(ONBOARD[this.cams.mode] ? 'cockpit' : this.cams.mode === 'tv' || this.cams.mode === 'heli' ? 'tv' : 'chase');
    if (car.lastShift !== 0) a.shift(car.lastShift > 0);
    a.weather(w.rain, (car.wetW[2] + car.wetW[3]) / 2, Math.max(0, car.vx), w.lightning, Math.hypot(w.windX, w.windZ));
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
        if (this.cams.mode === 'tv' || this.cams.mode === 'heli') {
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
    const st = this.menu.settings;
    this.sinceStepUp++;
    // a step up that didn't hold 60 fps goes straight back, and that level is off the table
    if (this.stepUpFrom && this.fpsAvg < 52 && this.sinceStepUp <= 20) {
      this.qualityCap = st.quality;
      this.setAutoQuality(this.stepUpFrom);
      this.stepUpFrom = null;
      return;
    }
    if (this.fpsAvg < 52) {
      if (this.headroom < 3 && gfx.dynamicScale < this.scaleCeiling) this.scaleCeiling = gfx.dynamicScale - 0.01;
      gfx.setDynamicScale(gfx.dynamicScale - (this.fpsAvg < 40 ? 0.12 : 0.07));
      this.headroom = 0;
      // still slow at the lowest resolution for a few seconds: step the graphics level down
      // (only while the player hasn't chosen one themselves)
      // (never below High: the resolution scale takes up the rest)
      if (gfx.dynamicScale <= 0.56 && this.fpsAvg < 45 && st.autoQuality && QUALITY_ORDER.indexOf(st.quality) > QUALITY_ORDER.indexOf('high') && this.state === 'race') {
        if (++this.slowAtFloor >= 4) {
          this.slowAtFloor = 0;
          this.qualityCap = st.quality;
          this.setAutoQuality(QUALITY_ORDER[QUALITY_ORDER.indexOf(st.quality) - 1]);
        }
      } else this.slowAtFloor = 0;
    } else if (this.fpsAvg > 58.5) {
      this.headroom++;
      if (this.headroom >= 4 && gfx.dynamicScale < this.scaleCeiling) {
        gfx.setDynamicScale(Math.min(this.scaleCeiling, gfx.dynamicScale + 0.05));
        this.headroom = 0;
      } else if (this.headroom >= 10 && gfx.dynamicScale >= 1 && st.autoQuality && this.state === 'race') {
        // smooth at full resolution for a while: try the next graphics level up
        const next = QUALITY_ORDER[QUALITY_ORDER.indexOf(st.quality) + 1];
        if (next && next !== this.qualityCap) {
          this.stepUpFrom = st.quality;
          this.sinceStepUp = 0;
          this.setAutoQuality(next);
        }
        this.headroom = 0;
      }
    }
  }
  private setAutoQuality(q: QualityLevel) {
    // this session only: the saved setting stays what the player (or the default) chose
    const st = this.menu.settings;
    st.quality = q;
    this.applySettings(st);
    this.scaleCeiling = 1;
  }
  /** a level that proved too slow this session (auto quality won't step back up into it) */
  private qualityCap: QualityLevel | null = null;
  private stepUpFrom: QualityLevel | null = null;
  private sinceStepUp = 0;
  private headroom = 0;
  private slowAtFloor = 0;
  private scaleCeiling = 1;
}
