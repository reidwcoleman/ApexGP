import * as THREE from 'three';
import { Renderer, type QualityLevel } from '../core/Renderer.ts';
import { Input } from '../core/Input.ts';
import { GameAudio } from '../core/Audio.ts';
import { Track, SURF } from '../world/Track.ts';
import { CIRCUITS, MONZA } from '../world/Circuits.ts';
import type { CircuitDef } from '../world/CircuitGen.ts';
import { collectDeep, collectResources, disposeTree, sweepGpu, trackGpuUploads } from '../core/dispose.ts';
import { createCloudNoise } from '../world/env/skyNoise.ts';
import { buildTreeKit } from '../world/env/treeproto.ts';
import { makeGroundTextures } from '../world/trackside/textures.ts';
import { noiseTexture, detailNormalTexture } from '../world/env/textures.ts';
import { sponsorTexture, teamBoardTexture } from '../world/env/signage.ts';
import { setEvent, EVENT } from '../world/event.ts';
const EVENT_GP = () => EVENT.gp;
import { buildTrackside, type Trackside } from '../world/TrackMesh.ts';
import { createEnvironment, type Environment } from '../world/Environment.ts';
import { createCar, preloadCarAssets, type CarRig } from '../car/CarModel.ts';
import { TEAMS, allEntries, uiColor, type Entry } from '../race/Teams.ts';
import { Engineer } from '../race/Engineer.ts';
import { AIDriver } from '../sim/AIDriver.ts';
import { Race, aiQualifyingTime, aiPace, type Competitor } from '../race/Race.ts';
import { CarView } from './CarView.ts';
import { Cameras, CAMERA_LABEL, ONBOARD, ALL_CAMERAS, isRemoteCam, type CameraMode } from './Cameras.ts';
import { ReplayBuffer, RF, type ReplayEvent } from './Replay.ts';
import { Director, type FieldCar } from './Director.ts';
import { Broadcast, describeEvent } from '../ui/Broadcast.ts';
import { Flashback } from './Flashback.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import { Particles } from '../fx/Particles.ts';
import { CarEffects } from '../fx/CarEffects.ts';
import { Debris } from '../fx/Debris.ts';
import { SkidMarks } from '../fx/SkidMarks.ts';
import { HUD, fmtTime } from '../ui/HUD.ts';
import { Menu, aiLevel, GRID, type RaceSetup, type Settings } from '../ui/Menu.ts';
import { Weather, planWeather, isLowSun, floodlit, WEATHER_LABEL, TIME_LABEL, type WeatherPlan, type WeatherState, type WeatherChoice, type TimeChoice } from '../world/Weather.ts';
import { applyWeatherUniforms, suppressFloods } from '../world/weatherUniforms.ts';
import { buildPitComplex, type PitComplex } from '../world/PitComplex.ts';
import { PlayerControl } from '../sim/PlayerControl.ts';
import { RacingProfile } from '../sim/RacingProfile.ts';
import { F1_SPEC } from '../sim/CarPhysics.ts';
import { RacingLineAssist } from './RacingLineAssist.ts';
import { Celebration } from './Celebration.ts';
import type { AssistConfig } from './Assists.ts';
import { COMPOUNDS, newStopPose, stopPose } from '../race/Pit.ts';
import { Career, SETUP } from '../career/Career.ts';
import { loadPeople } from '../people/Humans.ts';
import { Highlights } from '../career/Highlights.ts';
import { GarageScene } from './GarageScene.ts';
import { peopleKit } from '../people/Humans.ts';
import type { SetupPart } from '../career/Career.ts';
import type { HubTab } from '../ui/Menu.ts';

/** objects that cast shadows into the garage key light (see buildGarageLights) */
const GARAGE_SHADOW_LAYER = 3;
/** what the garage floor mirrors: the player's car, its blankets and the garage lights */
const GARAGE_MIRROR_LAYER = 4;

const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

type GameState = 'boot' | 'menu' | 'intro' | 'race' | 'paused' | 'celebration' | 'results' | 'replay' | 'flashback' | 'spectate';

/** simulation speeds when watching a race, replay speeds */
const SIM_SPEEDS = [1, 2, 4, 8];
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

/** colour of the light on smoke/dust for the weather */
function smokeLight(w: WeatherState): THREE.Color {
  // (after dark it is the cool white of the floodlights)
  const sun = floodlit(w.time) > 0 ? new THREE.Color(0.9, 0.93, 1.0) : isLowSun(w.time) ? new THREE.Color(1.0, 0.86, 0.72) : new THREE.Color(1, 1, 1);
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
  /** tyre marks laid this race (cleared by makeRace) */
  private skids!: SkidMarks;
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
  // ---- watching: a simulated race ('spectate') and the full-race replay
  /** this session is a simulated race (all cars on AI; never counts for the career) */
  private spectating = false;
  private director = new Director();
  private directorOn = true;
  private broadcast!: Broadcast;
  /** the car the cameras follow */
  private focusId = 0;
  private simSpeed = 1;
  private replayPlaying = true;
  private replaySpeed = 1;
  /** the rig whose driver is hidden for the halo POV */
  private povRig: CarRig | null = null;
  private field: FieldCar[] = [];
  /** replay time the banners have announced up to */
  private announcedT = 0;
  private specPitLap = -1;
  private specFinish = -1;
  private replayBadge: HTMLDivElement;
  private replayBar: HTMLElement;
  private flash = new Flashback();
  private fbT = 0;
  private fbEntry = 0;
  private fbSat = 1;
  private fbBadge: HTMLDivElement;
  private fbBar: HTMLElement;
  private fbLabel: HTMLElement | null = null;
  /** R was pressed again during this flashback (stops the automatic rewind) */
  private fbJumped = false;
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
  private career = new Career();
  readonly highlights = new Highlights();
  private lastPos = 0;
  private celMoment = false;
  /** livery id each rig was built with (the player's may wear their own paint) */
  private rigTeam = new Map<Entry, string>();
  /** the garage (menu) camera: framing per hub tab, eased */
  private hubTab: HubTab = 'race';
  private garageCam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), vl: new THREE.Vector3(), init: false, th: 0, r: 0, y: 0, fov: 38, vth: 0, vr: 0, vy: 0, vfov: 0 };
  private garageLights = new THREE.Group();
  private lastReward: import('../career/Career.ts').RaceReward | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    // (know every texture / render target on the GPU, so a circuit switch can free all of the old one's)
    trackGpuUploads();
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
    this.fbBadge.innerHTML = '<span class="rdot"></span><b>Flashback</b><span class="rtrack"><i></i></span><span class="rskip">R back 3 s · ← → scrub · Enter resume · Esc cancel</span>';
    uiRoot.appendChild(this.fbBadge);
    this.fbBar = this.fbBadge.querySelector('i')!;
    this.fbLabel = this.fbBadge.querySelector('b');
    this.menu = new Menu(uiRoot, {
      onSetupChange: (s) => this.applySetupPreview(s),
      forecast: () => this.forecastLabel(),
      onStart: (mode, s) => this.startRace(mode, s),
      onSettings: (s) => this.applySettings(s),
      onResume: () => this.resume(),
      onRestart: () => (this.spectating ? this.startSpectate(this.menu.setup) : this.startRace(this.mode, this.menu.setup)),
      onQuit: () => this.toMenu(),
      onResetCar: () => {
        this.resume();
        this.resetPlayer();
      },
      onUi: (k) => this.audioReady && this.audio.ui(k),
      onHubTab: (t) => {
        this.hubTab = t;
        this.garageOrbit.active = false;
        if (t === 'career' || t === 'race') this.garage?.refreshStats();
      },
      onFocusPart: (p) => (this.focusPart = p),
      onPlayHighlight: (id) => this.garage?.playHighlight(id),
      nowPlaying: () => this.garage?.current?.id ?? null,
      onCarChange: () => this.refreshPlayerRig(),
      onTravel: (id) => void this.travel(id),
      onSpectate: (s) => this.startSpectate(s),
    }, this.career);
    this.broadcast = new Broadcast(uiRoot, {
      onCamera: (d) => this.bcCamera(d),
      onCar: (d) => this.bcCar(d),
      onCarAt: (p) => this.bcCarAt(p),
      onDirector: () => this.bcDirector(),
      onSpeed: (d) => this.bcSpeed(d),
      onExit: () => (this.state === 'replay' ? this.endReplay() : this.state === 'spectate' ? this.pause() : undefined),
      onTogglePlay: () => {
        if (this.replayT >= this.replayEnd - 0.05) this.replayT = this.replayStart;
        this.replayPlaying = !this.replayPlaying;
      },
      onSeek: (t) => this.replaySeek(t),
      onSkip: (d) => this.replaySeek(this.replayT + d),
      onEvent: (d) => {
        const e = this.replay.nextEvent(this.replayT + (d > 0 ? 3 : -3), d);
        if (e) {
          this.replaySeek(e.t - 3);
          this.focusId = e.car;
          if (this.directorOn) this.director.reset(e.car);
        }
      },
    });
    addEventListener('resize', () => this.gfx.resize());
    // browsers only allow audio after a gesture: the first key / click (even during loading)
    // starts it — the menu music included. Later gestures just make sure it is still running.
    this.audio.setVolume(this.menu.settings.volume);
    this.audio.setMusicVolume(this.menu.settings.music);
    const unlock = () => {
      if (this.audioReady) return this.audio.wake();
      this.audio
        .init()
        .then(() => {
          this.audioReady = true;
          this.audio.setVolume(this.menu.settings.volume);
          this.audio.setMusicVolume(this.menu.settings.music);
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
    const t0 = performance.now();
    progress(0.02, 'Loading fonts');
    try {
      await Promise.all([document.fonts.load('700 20px "Titillium Web"'), document.fonts.load('900 20px "Titillium Web"'), document.fonts.load('600 20px "Titillium Web"')]);
    } catch {
      /* fallback fonts are fine */
    }
    this.applySettings(this.menu.settings);
    this.rollWeather(this.menu.setup);

    // the people (a network load) come in while the circuit is being surveyed
    const people = loadPeople().catch((e) => console.warn('people failed to load', e));
    // ?track=<id> (dev/demo links) overrides the saved choice
    const want = new URLSearchParams(location.search).get('track') ?? this.menu.setup.track;
    await this.buildWorld(CIRCUITS.find((c) => c.id === want) ?? MONZA, async (f, step) => {
      progress(0.06 + f * 0.56, step);
      await tick();
    }, people);

    progress(0.62, 'Rolling out the cars');
    await preloadCarAssets();
    this.scene.add(this.carsGroup);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const rig = createCar(e.team, e.driver, e.seat, { envMap: this.scene.environment ?? undefined });
      this.rigs.set(e, rig);
      this.rigTeam.set(e, e.team.id);
      this.views.set(e, new CarView(rig));
      this.carsGroup.add(rig.root);
      if (i % 4 === 3) {
        progress(0.62 + (0.25 * i) / this.entries.length, 'Rolling out the cars');
        await tick();
      }
    }
    // far cars cast a one-mesh silhouette into the shadow maps (see CarRig.shadowPass)
    // (the player's car keeps its detailed shadow up close; the others use a middle-detail one)
    this.gfx.onShadowPass((on) => {
      const me = this.race?.player.entry;
      for (const [e, rig] of this.rigs) rig.shadowPass?.(on, e === me);
    });
    this.scene.add(this.particles.group);
    this.particles.setLight(smokeLight(new Weather(this.plan).state));
    this.buildGarageLights();
    this.menu.highlights = this.highlights;
    this.highlights.onChange(() => {
      if (this.state === 'menu' && this.hubTab === 'highlights') this.menu.refreshTab();
    });
    this.bindGarageInput();
    this.finishWorld();

    progress(0.9, 'Warming up shaders');
    await tick();
    this.toMenu();
    await this.warmUp();
    this.bootMs = Math.round(performance.now() - t0);

    progress(1, 'Ready');
    const loop = (now: number) => {
      this.timer.update(now);
      const dt = Math.min(this.timer.getDelta(), 1 / 20);
      // (nothing to draw while a new circuit is being built behind the travel veil)
      if (!this.worldBusy) {
        this.gfx.gpuFrameBegin();
        this.frame(dt);
        this.gfx.gpuFrameEnd();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ the world (one circuit)

  /** how long the boot / the last world build took (ms, per step) — dev readouts */
  bootMs = 0;
  worldTimes: Record<string, number> = {};
  /** a new circuit is being built: the frame loop pauses (the travel veil covers the screen) */
  private worldBusy = false;
  /** Track objects are pure data and take ~0.4–0.7 s to build: one per circuit, kept */
  private readonly trackCache = new Map<string, Track>();
  private trackFor(def: CircuitDef): Track {
    let t = this.trackCache.get(def.id);
    if (!t) this.trackCache.set(def.id, (t = new Track(def)));
    return t;
  }

  /**
   * Everything that belongs to one circuit: the track, trackside, pit complex, sky and
   * scenery, debris, skid marks. Built in steps; `step(f, label)` runs between them
   * (0 … 1 progress) so a loading bar can update. The cameras, racing line and HUD map
   * follow in finishWorld() once the cars exist.
   */
  private async buildWorld(def: CircuitDef, step: (f: number, label: string) => Promise<void>, people?: Promise<unknown>) {
    const times: Record<string, number> = {};
    let tLap = performance.now();
    const lap = (k: string) => {
      const n = performance.now();
      times[k] = Math.round(n - tLap);
      tLap = n;
    };
    await step(0.02, 'Surveying the circuit');
    this.track = this.trackFor(def);
    setEvent(this.track.def);
    this.menu.setup.track = this.track.def.id;
    lap('track');

    await step(0.14, 'Laying asphalt, kerbs and barriers');
    this.trackside = buildTrackside(this.track, this.gfx);
    this.scene.add(this.trackside.group);
    lap('trackside');

    await step(0.3, 'Opening the pit lane');
    this.pits = buildPitComplex(this.track, this.gfx);
    this.scene.add(this.pits.group);
    lap('pits');

    if (people) {
      await step(0.36, 'Getting the people in');
      await people;
      lap('people');
    }
    // every pit crew (people, wheels, guns, jacks) now, so nothing is built mid-race
    this.pits.prebuild?.();
    lap('crew');

    await step(0.4, 'Growing the park');
    const w0 = new Weather(this.plan).state;
    applyWeatherUniforms(w0);
    this.env = createEnvironment(this.track, this.gfx, this.scene, w0);
    this.scene.add(this.env.group);
    lap('environment');

    await step(0.94, 'Sweeping the track');
    this.debris = new Debris(this.track, (x, z) => this.env.heightAt(x, z));
    this.scene.add(this.debris.group);
    this.carFx = new CarEffects(this.particles, this.debris);
    this.skids = new SkidMarks(this.track, this.trackside.groundLift);
    this.scene.add(this.skids.mesh);
    this.scene.add(this.carFx.fireLight);
    this.carFx.onImpact = (id, imp, isPlayer) => this.onImpact(id, imp.speed, isPlayer);
    this.carFx.onExplosion = (id, pos) => this.onExplosion(id, pos);
    lap('fx');
    this.worldTimes = times;
  }

  /** the circuit's cameras, racing line and HUD map (needs the cars) */
  private finishWorld() {
    const mode = this.cams?.mode;
    this.cams = new Cameras(this.camera, this.track);
    if (mode) this.cams.mode = mode;
    this.line = new RacingLineAssist(this.track, RacingProfile.for(this.track, F1_SPEC));
    this.scene.add(this.line.mesh);
    this.hud.setup(this.makeRace('race', this.menu.setup), this.track);
  }

  /**
   * Free everything the current circuit owns (GPU memory back to where it was before it was
   * built). The cars, particles, people kit and the per-page caches are left alone.
   */
  private disposeWorld() {
    const keep = collectResources([
      this.carsGroup,
      this.particles.group,
      this.garageLights,
      peopleKit(),
      buildTreeKit(),
      makeGroundTextures(this.gfx.maxAnisotropy),
      noiseTexture(),
      detailNormalTexture(),
      sponsorTexture(),
      teamBoardTexture(),
      createCloudNoise(this.gfx.renderer),
    ]);
    this.highlights.cancel();
    // (the garage look froze the old sun's shadows; it re-arms on the new one)
    this.leaveGarageLook();
    this.garage?.dispose();
    this.garage = null;
    this.garageRig = null;
    this.celebration?.dispose();
    this.celebration = null;
    this.carFx.reset();
    this.carFx.fireLight.removeFromParent();
    this.particles.clear();
    disposeTree(this.debris.group, keep);
    this.skids.dispose();
    this.skids.mesh.removeFromParent();
    disposeTree(this.line.mesh, keep);
    this.trackside.ssr?.dispose();
    disposeTree(this.trackside.group, keep);
    this.pits.dispose?.();
    disposeTree(this.pits.group, keep);
    this.env.dispose(keep);
    // then whatever the old world still has on the GPU that no walk could see (textures only a
    // shader closure or a module-level uniform holds): everything live that nothing persistent uses
    const persistent = collectDeep([this.scene, this.particles, this.highlights], keep);
    collectDeep([this.gfx], persistent, 10);
    this.lastSweep = sweepGpu(persistent);
  }
  /** what the last world switch's GPU sweep freed (dev readout) */
  lastSweep: { targets: number; textures: number; names?: string[] } = { targets: 0, textures: 0 };

  /**
   * Compile the shader variants of every lighting set-up up front (menu garage, race, podium).
   * All three are queued at once and nothing waits on them: with KHR_parallel_shader_compile the
   * driver builds them on its own threads while the menu is up, so the first race frame, the
   * first podium frame and the first fast lap (speed blur) find their programs ready.
   */
  private async warmUp() {
    const r = this.gfx.renderer;
    const warm: number[] = [];
    let t = performance.now();
    const lap = () => {
      warm.push(Math.round(performance.now() - t));
      t = performance.now();
    };
    const menu = this.state === 'menu';
    // the pit crews are hidden until the camera nears them: show them all for the compile + first render
    this.pits.warm?.(true);
    // the scene is only ever drawn into the post chain's linear targets (Renderer.render → composer),
    // never straight to the canvas: compile for a bound target, or the programs built here (sRGB
    // output) aren't the ones the race uses and everything recompiles mid-race
    const linear = new THREE.WebGLRenderTarget(1, 1);
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(linear);
    const compileLinear = () => r.compile(this.scene, this.camera);
    // the menu: the garage and its work lights
    this.garageFrame(0.016);
    this.garageLights.visible = true;
    if (this.garage) this.garage.group.visible = true;
    compileLinear();
    // racing: sun and sky only
    this.garageLights.visible = false;
    if (this.garage) this.garage.group.visible = false;
    compileLinear();
    // the podium adds a spot light
    const spot = new THREE.SpotLight(0xffffff, 0);
    this.scene.add(spot);
    compileLinear();
    spot.removeFromParent();
    spot.dispose();
    r.setRenderTarget(prevTarget);
    linear.dispose();
    // one real frame in race lighting: the shadow-map depth programs (light counts are part of their
    // key, so the menu's garage-lit frame doesn't build them) and the first uploads
    this.gfx.render(0.016);
    lap();
    this.garageLights.visible = menu;
    if (this.garage) this.garage.group.visible = menu;
    await new Promise((res) => setTimeout(res, 0));
    // the post passes that only switch on at speed / in the rain / on the TV cameras; this first
    // full render also uploads the new world's textures
    this.gfx.warmPasses();
    this.gfx.render(0.016);
    this.pits.warm?.(false);
    lap();
    this.warmTimes = warm;
  }
  warmTimes: number[] = [];

  // ------------------------------------------------------------------ states

  private makeRace(mode: 'race' | 'timetrial', setup: RaceSetup): Race {
    const team = TEAMS[setup.team];
    const playerEntry = this.entries.find((e) => e.team === team && e.seat === setup.seat)!;
    this.race = new Race(this.track, {
      mode,
      laps: setup.laps,
      difficulty: aiLevel(setup, this.career).value,
      dynamicAI: aiLevel(setup, this.career).dynamic,
      trackLimits: setup.trackLimits,
      playerEntry,
      playerGrid: GRID[setup.grid].slot,
      entries: this.entries,
      playerCompound: setup.compound,
      gridOrder: this.gridOrder ?? undefined,
      weather: this.plan,
      damage: setup.damage,
      playerSpec: this.career.spec(),
    });
    this.refreshPlayerRig();
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
    this.skids?.clear();
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
    this.highlights.cancel();
    // a fresh forecast every time we come back from a session
    if (this.state !== 'boot') this.rollWeather(this.menu.setup);
    this.state = 'menu';
    this.stateTime = 0;
    this.quali = null;
    this.gridOrder = null;
    this.spectating = false;
    this.leaveBroadcast();
    this.makeRace('race', this.menu.setup);
    this.hud.show(false);
    this.menu.show('title');
    this.garageCam.init = false;
    this.gfx.setDepthOfField(true, this.dofTarget, 5, 2.2);
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    // (safe before the audio is unlocked: it remembers and applies on start)
    this.audio.crowd(0.35);
    this.audio.setScene('menu');
  }

  private applySetupPreview(s: RaceSetup) {
    // a different circuit means a different world: build it in place behind the travel veil
    if (s.track !== this.track.def.id) {
      this.travel(s.track);
      return;
    }
    if (`${s.weather}/${s.time}` !== this.planKey) this.rollWeather(s);
    this.makeRace('race', s);
  }

  private applySettings(s: Settings) {
    if (s.quality !== this.gfx.qualityLevel) this.gfx.setQuality(s.quality);
    this.particles.resolution = { low: 0.35, medium: 0.4, high: 0.5, ultra: 0.6 }[s.quality];
    if (this.cams && this.cams.mode !== s.camera && this.state !== 'menu') this.cams.set(s.camera);
    this.audio.setVolume(s.volume);
    this.audio.setMusicVolume(s.music);
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
    this.monzaLap ||= RacingProfile.for(this.trackFor(MONZA), F1_SPEC).lapTime;
    return this.race.profile.lapTime / this.monzaLap;
  }
  private monzaLap = 0;

  private endQualifying(time: number, valid: boolean) {
    const setup = this.quali!.setup;
    this.quali = null;
    const player = this.race.player.entry;
    const diff = aiLevel(setup, this.career).value;
    const wf = this.race.conditionsLapFactor();
    const times = this.entries.map((e) => ({ entry: e, time: e === player ? (valid ? time : Infinity) : aiQualifyingTime(e, diff, wf, this.trackLapScale()) }));
    times.sort((a, b) => a.time - b.time);
    const order = times.map((t) => t.entry);
    const pos = order.indexOf(player) + 1;
    this.state = 'results';
    this.autopilot = new AIDriver(0.7, 0.2);
    this.autopilot.startFrom(this.race.player.car, this.track);
    this.hud.show(false);
    this.audio.setScene('results');
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

  /** set when this session's result has gone into the career */
  private recorded = false;

  private startRace(mode: 'race' | 'timetrial', setup: RaceSetup, qualifying = false) {
    if (mode === 'race' && GRID[setup.grid].slot === -1 && !this.gridOrder && !qualifying) {
      this.startQualifying(setup);
      return;
    }
    this.mode = qualifying ? 'race' : mode;
    this.recorded = false;
    this.spectating = false;
    this.leaveBroadcast();
    this.highlights.cancel();
    this.lastPos = 0;
    this.celMoment = false;
    this.lastReward = null;
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
    // a new session always leaves the audio running, un-muffled, at the set volume
    // (a restart from the pause menu used to leave the context suspended: silent second race)
    this.audio.resetSession();
    this.audioPos = 0;
    this.audio.crowd(mode === 'race' ? 0.8 : 0.3);
    this.audio.setScene('race');
  }

  private pause() {
    if (this.state !== 'race' && this.state !== 'intro' && this.state !== 'spectate') return;
    if (this.state === 'spectate') this.broadcast.show(null);
    this.state = 'paused';
    this.menu.show('pause');
    this.input.releaseAll();
    // muffle the world behind the menu (never suspend: menu ticks must still play, and a
    // restart / quit from here must not inherit a stopped context)
    this.audio.setScene('paused');
  }

  private resume() {
    this.menu.show('none');
    this.state = this.spectating ? 'spectate' : this.race.phase === 'grid' ? 'intro' : 'race';
    if (this.spectating) this.broadcast.show('live');
    this.audio.setScene('race');
  }

  /** the podium: top three celebrating, then the results */
  private startCelebration() {
    if (this.celebrationPending) return;
    const top = this.race.classification().slice(0, 3).map((r) => r.entry);
    if (top.length < 3 || this.race.isTimeTrial) return this.showResults();
    const cel = new Celebration(this.track, (x, z) => this.env.heightAt(x, z), top, this.hud.root.parentElement ?? document.body);
    // (perf) its shaders — the crowd, the stage, the podium lighting — compile on the driver's threads
    // while the race keeps running for a few more frames; then the ceremony starts without a stall
    this.celebrationPending = true;
    const race = this.race;
    const go = () => {
      this.celebrationPending = false;
      if (this.race !== race || this.celebration) {
        cel.dispose();
        return;
      }
      this.beginCelebration(cel, top);
    };
    this.gfx.renderer.compileAsync(cel.group, this.camera, this.scene).then(go, go);
  }
  private celebrationPending = false;
  private beginCelebration(cel: Celebration, top: Entry[]) {
    this.celebration = cel;
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
    this.audio.crowd(1);
    this.audio.setScene('celebration');
    this.audio.crowdReact('cheer', 1);
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
    this.audio.setScene('results');
    const rows = this.race.classification();
    const p = this.race.player;
    const winner = rows[0]?.entry.driver;
    const title = this.spectating
      ? `${winner ? `${winner.first} ${winner.last} wins` : 'Race result'}`
      : p.retired ? 'Retired · DNF' : p.position === 1 ? 'Victory' : p.position <= 3 ? `Podium · P${p.position}` : `Finished P${p.position}`;
    const laps = this.race.opts.laps;
    const lede = `${laps} lap${laps === 1 ? '' : 's'} · ${this.track.def.name} · ${WEATHER_LABEL[this.race.weatherState.kind]}`;
    this.hud.show(false);
    // the next race gets new weather
    this.rollWeather(this.menu.setup);
    // a race (not a time trial) counts for the career, once
    let reward: typeof this.lastReward = null;
    if (!this.race.isTimeTrial && !this.recorded) {
      this.recorded = true;
      const me = rows.find((r) => r.isPlayer)!;
      reward = this.career.recordRace(this.track.def.id, me.pos, !!me.dnf, me.fastest && me.pos <= 10, TEAMS.indexOf(me.entry.team), rows.length);
      // Dynamic AI: the rating learns from this race (lap pace and result)
      if (this.race.opts.dynamicAI) this.career.setAiSkill(this.race.rateAiSkill());
      this.lastReward = reward;
    } else if (!this.race.isTimeTrial) reward = this.lastReward;
    const again = () => (this.spectating ? this.startSpectate(this.menu.setup) : this.startRace(this.mode, this.menu.setup));
    this.menu.showResults(rows, title, this.spectating ? `Simulated race · ${lede}` : lede, again, () => this.toMenu(), () => this.startReplay(), reward);
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

    this.garageLights.visible = this.state === 'menu';
    suppressFloods(this.state === 'menu');
    if (this.garage) this.garage.setActive(this.state === 'menu');
    if (this.state !== 'menu') this.leaveGarageLook();
    if (this.state !== 'menu') this.updateHotspots();
    if (this.state !== 'menu') {
      this.pits.clearView(null);
      this.pits.hideCrew(-1);
    }
    if (this.state === 'menu') {
      race.update(dt);
      this.syncAllViews(dt);
      this.garageFrame(dt);
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
      if (!this.celMoment && this.celebration) {
        const place = this.race.player.position;
        const tTrophy = place === 3 ? 14 : place === 2 ? 16.5 : 19;
        if (place <= 3 && !this.race.player.retired && this.celebration.time > tTrophy + 0.2) {
          this.celMoment = true;
          this.highlights.moment(place === 1 ? 'win' : 'podium', place === 1 ? `Victory at ${this.track.def.short}` : `P${place} on the podium`, `${EVENT_GP()} · ${new Date().toLocaleDateString()}`, place === 1 ? 100 : 85 - place * 3, this.track.def.short);
        }
      }
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
      // each R press jumps back further, left/right scrub (hold), Enter resumes, Esc cancels
      const auto = this.stateTime < 0.7 && !this.fbJumped ? -3.5 : 0;
      this.fbT += (auto + -st.steer * 4) * dt;
      if (st.reset) {
        this.fbT -= 3;
        this.fbJumped = true;
      }
      const oldest = Math.max(this.flash.oldest, this.replay.startTime);
      this.fbT = Math.max(oldest, Math.min(this.fbEntry, this.fbT));
      if (this.fbLabel) this.fbLabel.textContent = `Flashback −${Math.max(0, this.fbEntry - this.fbT).toFixed(1)} s`;
      this.replay.apply(this.fbT, this.track.length);
      this.syncAllViews(dt, this.replay.ghosts);
      this.cams.update(dt, this.replay.ghosts[race.player.id], this.rigs.get(race.player.entry)!, this.track);
      this.fbBar.style.width = `${((this.fbT - oldest) / Math.max(0.1, this.fbEntry - oldest)) * 100}%`;
      if (this.input.nav.accept) this.endFlashback(true);
      else if (this.input.nav.back) this.endFlashback(false);
    } else if (this.state === 'replay') {
      this.replayFrame(dt);
    } else if (this.state === 'spectate') {
      this.spectateFrame(dt);
    }
    // the trackside cameras have a real lens: focus pulled onto the car, shallow on the long end
    const tvView = this.cams.lensDof && (this.state === 'race' || this.state === 'results' || this.state === 'replay' || this.state === 'spectate');
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
    if (this.state === 'race' || this.state === 'celebration') this.highlights.afterRender(this.canvas, dt);
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

  /** the moments worth keeping: places gained, the lead, a fastest lap, the flag */
  private watchMoments(ev: { kind: string; car: number; value?: number }[]) {
    const r = this.race;
    if (r.isTimeTrial || this.quali) return;
    const p = r.player;
    const where = `Lap ${Math.max(1, Math.min(r.opts.laps, p.laps + 1))} · ${this.track.def.short}`;
    const name = this.track.def.short;
    if (r.phase === 'racing' && !p.retired) {
      const pos = p.position;
      if (this.lastPos && pos < this.lastPos && this.stateTime > 3) {
        if (pos === 1) this.highlights.moment('lead', 'Into the lead', where, 75, name, 0.1);
        else this.highlights.moment('overtake', `P${this.lastPos} → P${pos}`, where, 30 + Math.max(0, 11 - pos) * 3, name, 0.1);
      }
      this.lastPos = pos;
    }
    for (const e of ev) {
      if (e.car !== p.id) continue;
      if (e.kind === 'fastest-lap') this.highlights.moment('fastest', `Fastest lap · ${fmtTime(e.value ?? NaN)}`, where, 55, name);
      if (e.kind === 'finish') this.highlights.moment('finish', `Chequered flag · P${p.position}`, `${r.opts.laps} laps · ${name}`, p.position <= 3 ? 60 : 35, name);
    }
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
      if (this.audioReady) this.audio.radio();
    }
    this.watchMoments(ev);
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
      if (e.kind === 'lights-out') {
        this.audio.startBeep(true);
        this.audio.crowdReact('cheer', 0.9);
      }
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
    this.fbJumped = false;
    this.fbSat = this.gfx.grade.uniforms.get('saturation')!.value as number;
    this.gfx.grade.set({ saturation: 0.25 });
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    this.particles.clear();
    this.fbBadge.classList.add('on');
    this.input.releaseAll();
    this.audio.setScene('flashback');
  }

  private endFlashback(apply: boolean) {
    const race = this.race;
    if (apply && this.fbT < this.fbEntry - 0.2) {
      const t = this.flash.restore(race, this.fbT);
      this.replay.truncate(t);
      this.control.reset();
      this.carFx.reset();
      this.skids.breakAll();
      this.flashbacksUsed++;
      this.hud.flash('Flashback', `${this.flashbacksUsed} used`, '', 1.4);
    }
    this.gfx.grade.set({ saturation: this.fbSat });
    this.fbBadge.classList.remove('on');
    this.state = 'race';
    this.stateTime = 5;
    this.input.releaseAll();
    this.syncAllViews(0.016);
    this.audio.setScene('race');
  }

  // ------------------------------------------------------------------ watching: simulated race, broadcast, full replay

  /** a simulated race: every car (the player's too) on the AI, the TV director on the cameras */
  private startSpectate(setup: RaceSetup) {
    // a simulated qualifying sets the grid (nobody has to drive a lap)
    const diff = aiLevel(setup, this.career).value;
    const times = this.entries.map((e) => ({ e, t: aiQualifyingTime(e, diff, 1, 1) })).sort((a, b) => a.t - b.t);
    this.gridOrder = times.map((x) => x.e);
    this.startRace('race', setup);
    this.gridOrder = null;
    // (startRace cleared these)
    this.spectating = true;
    this.recorded = true; // never counts for the career
    this.celMoment = true; // and makes no highlights
    const race = this.race;
    const p = race.player;
    this.autopilot = new AIDriver(aiPace(p.entry, race.opts.difficulty), p.entry.driver.aggression);
    this.autopilot.startFrom(p.car, this.track);
    p.car.allowReverse = false;
    p.car.assists = { traction: 'full', abs: true, stability: true, autoGear: true };
    race.playerDrsAuto = true;
    this.specPitLap = setup.laps >= 8 ? Math.max(2, Math.round(setup.laps * (0.4 + Math.random() * 0.2))) : -1;
    this.specFinish = -1;
    this.state = 'spectate';
    this.stateTime = 0;
    this.simSpeed = 1;
    this.directorOn = true;
    this.focusId = race.cars.find((c) => c.position === 1)?.id ?? p.id;
    this.director.reset(this.focusId);
    this.replay.fresh.length = 0;
    this.cams.set('gantry');
    this.gfx.setDepthOfField(false);
    this.enterBroadcast('live');
  }

  private enterBroadcast(mode: 'live' | 'replay') {
    this.broadcast.show(mode);
    this.hud.show(true);
    this.hud.setBroadcast(true, mode === 'replay');
    this.hud.setHint(null);
    this.gfx.setSpeedBlur(0);
    this.gfx.setAberration(0);
    (this.gfx as unknown as { setLensRain?: (a: number) => void }).setLensRain?.(0);
  }

  private leaveBroadcast() {
    this.broadcast?.show(null);
    this.hud.setBroadcast(false);
    if (this.povRig) {
      this.povRig.setDriverVisible(true);
      this.povRig = null;
    }
  }

  /** the AI-driven player car's strategy: one planned stop, weather calls, a new nose */
  private spectatePits() {
    const race = this.race;
    const p = race.player;
    if (p.pit.phase !== 'none' || race.playerPitRequest || p.finished || p.retired || race.phase !== 'racing' || p.laps < 0) return;
    const wrongTyre = COMPOUNDS[p.compound].type !== race.conditionsType();
    const planned = this.specPitLap >= 0 && p.stops === 0 && p.laps + 1 >= this.specPitLap;
    const lapsLeft = race.opts.laps - p.laps;
    if ((planned || wrongTyre || p.car.wingDamage > 0.45) && lapsLeft > 1) race.playerPitRequest = true;
  }

  private spectateFrame(dt: number) {
    const race = this.race;
    // (the keyboard goes through the broadcast overlay; a pad's start button pauses)
    if (this.input.state.pause) return this.pause();
    if (race.phase === 'grid' && this.stateTime > 3.5) race.startLights();
    // faster than real time: more fixed steps, never a bigger one
    const steps = race.phase === 'grid' || race.phase === 'lights' ? 1 : this.simSpeed;
    for (let k = 0; k < steps; k++) {
      this.spectatePits();
      this.driveInput(dt);
      race.update(dt);
      this.replay.record(dt, race);
      if (this.audioReady) for (const e of race.events) if (e.kind === 'lights-out') this.audio.startBeep(true);
    }
    const lit = race.lightsLit;
    if (lit !== this.lastLit) {
      if (lit > 0 && this.audioReady) this.audio.startBeep(false);
      this.lastLit = lit;
    }
    const ev = this.replay.events;
    const fresh = this.replay.fresh;
    for (let i = 0; i < fresh.length; i++) this.announce(fresh[i]);
    fresh.length = 0;
    this.syncAllViews(dt);
    const simDt = dt * steps;
    if (this.directorOn) {
      this.director.update(simDt, race.time, race.raceTime, this.fieldLive(), ev, 0, this.cams, this.track, race.player.id);
      if (this.director.cutNow) this.applyDirector();
    }
    const fc = race.cars[this.focusId];
    this.cams.update(simDt, fc.car, this.rigs.get(fc.entry)!, this.track);
    this.povUpdate();
    this.hud.update(dt, race);
    this.hud.setFocus(this.focusId);
    this.hud.setBroadcast(true, false, this.broadcast.clean);
    this.effects(dt);
    const f = this.follow;
    f.entry = fc.entry;
    f.position = fc.position;
    f.speed = fc.car.vx;
    f.gapAhead = fc.gapAhead;
    f.status = fc.retired ? 'OUT' : fc.pit.phase !== 'none' ? 'PIT' : fc.finished ? 'FINISHED' : '';
    f.caption = this.directorOn && this.director.focus === this.focusId ? this.director.caption : '';
    this.broadcast.setFollow(f);
    this.broadcast.setShot(CAMERA_LABEL[this.cams.mode], this.cams.where, this.directorOn, this.simSpeed);
    // the flag: once everyone still running is home (or half a minute after the winner), the podium
    if (race.phase === 'finished') {
      if (this.specFinish < 0) this.specFinish = 0;
      this.specFinish += simDt;
      const running = race.cars.some((c) => !c.finished && !c.retired);
      if ((!running && this.specFinish > 6) || this.specFinish > 30) {
        this.leaveBroadcast();
        this.startCelebration();
      }
    }
  }
  private readonly follow = { entry: null as unknown as Entry, position: 1, speed: 0, caption: '', gapAhead: 0, status: '' as '' | 'PIT' | 'OUT' | 'FINISHED' };

  private fieldArr(): FieldCar[] {
    const n = this.race.cars.length;
    while (this.field.length < n) this.field.push({ id: this.field.length, s: 0, speed: 0, position: 1, pit: false, out: false, finished: false });
    this.field.length = n;
    return this.field;
  }

  private fieldLive(): FieldCar[] {
    const f = this.fieldArr();
    for (const c of this.race.cars) {
      const o = f[c.id];
      o.id = c.id;
      o.s = c.car.s;
      o.speed = Math.max(0, c.car.vx);
      o.position = c.position;
      o.pit = c.pit.phase !== 'none';
      o.out = c.retired || c.removed;
      o.finished = c.finished;
    }
    return f;
  }

  private fieldReplay(): FieldCar[] {
    const f = this.fieldArr();
    const R = this.replay;
    for (let k = 0; k < f.length; k++) {
      const o = f[k];
      const fl = R.flags[k];
      o.id = k;
      o.s = R.ghosts[k].s;
      o.speed = Math.max(0, R.ghosts[k].vx);
      o.position = R.pos[k] || k + 1;
      o.pit = (fl & RF.pit) !== 0;
      o.out = (fl & (RF.retired | RF.removed)) !== 0;
      o.finished = (fl & RF.finished) !== 0;
    }
    return f;
  }

  private applyDirector() {
    this.focusId = this.director.focus;
    this.cams.set(this.director.mode);
  }

  /** the halo POV hides the followed car's driver (his helmet is where the lens is) */
  private povUpdate() {
    const want = (this.state === 'spectate' || this.state === 'replay') && this.cams.mode === 'cockpit' ? (this.rigs.get(this.race.cars[this.focusId].entry) ?? null) : null;
    if (want === this.povRig) return;
    this.povRig?.setDriverVisible(true);
    want?.setDriverVisible(false);
    this.povRig = want;
  }

  /** a line on the banner for the moments (live, and as a replay plays through them) */
  private announce(e: ReplayEvent) {
    const cars = this.race.cars;
    const code = (id: number) => cars[id]?.entry.driver.code ?? '';
    const A = code(e.car);
    const B = e.other >= 0 ? code(e.other) : '';
    const hud = this.hud;
    switch (e.kind) {
      case 'start':
        hud.flash('Lights out', 'and away we go', 'red', 1.8);
        break;
      case 'overtake':
        if (e.value <= 10 || e.car === this.focusId || e.other === this.focusId) hud.flash(`${A} passes ${B}`, `for P${e.value}`, 'green', 2.4);
        break;
      case 'lead':
        hud.flash('New leader', `${A} passes ${B}`, 'green', 3);
        break;
      case 'crash':
        hud.flash('Incident', `${A} · ${cars[e.car]?.entry.driver.last ?? ''}`, 'red', 2.6);
        break;
      case 'spin':
        hud.flash(`${A} spins`, cars[e.car]?.entry.driver.last ?? '', '', 2);
        break;
      case 'retired':
        hud.flash(`${A} out`, `${cars[e.car]?.entry.driver.last ?? ''} · ${e.value ? 'car on fire' : 'crash damage'}`, 'red', 3);
        break;
      case 'fastest':
        hud.flash('Fastest lap', `${A}  ${fmtTime(e.value)}`, 'purple', 3);
        break;
      case 'pit':
        if (e.car === this.focusId) hud.flash('Pit stop', describeEvent(e, code), '', 2);
        break;
      case 'finish':
        if (e.value === 1) hud.flash('Chequered flag', `${A} wins`, '', 4);
        break;
    }
  }

  // ---- broadcast controls (spectate and replay)

  private bcCamera(d: 1 | -1) {
    const i = ALL_CAMERAS.indexOf(this.cams.mode);
    this.cams.set(ALL_CAMERAS[(i + d + ALL_CAMERAS.length) % ALL_CAMERAS.length]);
    this.directorOn = false;
    if (this.audioReady) this.audio.ui('move');
  }

  /** position of car id now (live or in the replay) */
  private posOf(id: number): number {
    return this.state === 'replay' ? this.replay.pos[id] || id + 1 : this.race.cars[id].position;
  }

  private bcCar(d: 1 | -1) {
    const n = this.race.cars.length;
    let p = this.posOf(this.focusId);
    for (let k = 0; k < n; k++) {
      p = ((p - 1 + d + n) % n) + 1;
      const c = this.race.cars.find((x) => this.posOf(x.id) === p);
      if (c && !(this.state === 'replay' ? this.replay.flags[c.id] & RF.removed : c.removed)) {
        this.focusId = c.id;
        break;
      }
    }
    this.directorOn = false;
    if (this.audioReady) this.audio.ui('move');
  }

  private bcCarAt(pos: number) {
    const c = this.race.cars.find((x) => this.posOf(x.id) === pos);
    if (!c) return;
    this.focusId = c.id;
    this.directorOn = false;
    if (this.audioReady) this.audio.ui('move');
  }

  private bcDirector() {
    this.directorOn = !this.directorOn;
    if (this.directorOn) this.director.reset(this.focusId);
    if (this.audioReady) this.audio.ui('select');
  }

  private bcSpeed(d: 1 | -1) {
    if (this.state === 'replay') {
      const i = REPLAY_SPEEDS.indexOf(this.replaySpeed);
      this.replaySpeed = REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, (i < 0 ? 2 : i) + d))];
      this.replayPlaying = true;
    } else {
      const i = SIM_SPEEDS.indexOf(this.simSpeed);
      this.simSpeed = SIM_SPEEDS[Math.max(0, Math.min(SIM_SPEEDS.length - 1, (i < 0 ? 0 : i) + d))];
    }
    if (this.audioReady) this.audio.ui('move');
  }

  // ---- the full-race replay

  private startReplay() {
    if (this.replay.duration < 3) return;
    this.state = 'replay';
    this.audio.resetSession();
    this.audio.setScene('race');
    this.stateTime = 0;
    this.replayStart = this.replay.startTime;
    this.replayEnd = this.replay.endTime;
    // from just before the lights go out
    const start = this.replay.events.find((e) => e.kind === 'start');
    this.replayT = start ? Math.max(this.replayStart, start.t - 5) : this.replayStart;
    this.announcedT = this.replayT;
    this.replayPlaying = true;
    this.replaySpeed = 1;
    this.menu.show('none');
    this.gfx.setDepthOfField(false);
    this.particles.clear();
    this.enterBroadcast('replay');
    // the replay has the race's sound (the results screen muffles it)
    this.audio.setScene('race');
    const cars = this.race.cars;
    this.broadcast.buildTimeline(this.replayStart, this.replayEnd, this.replay.lapMarks, this.replay.events, (id) => cars[id]?.entry.driver.code ?? '');
    this.directorOn = true;
    this.focusId = this.race.player.id;
    this.director.reset(this.focusId);
    this.input.releaseAll();
  }

  private replaySeek(t: number) {
    this.replayT = Math.max(this.replayStart, Math.min(this.replayEnd, t));
    this.announcedT = this.replayT;
    this.cams.cut();
    this.particles.clear();
  }

  private readonly replayOut = (id: number) => (this.replay.flags[id] & RF.retired) !== 0;

  private replayFrame(dt: number) {
    const race = this.race;
    const R = this.replay;
    if (this.input.state.pause || this.input.nav.back) return this.endReplay();
    const step = this.replayPlaying ? dt * this.replaySpeed : 0;
    this.replayT = Math.min(this.replayEnd, this.replayT + step);
    if (this.replayT >= this.replayEnd) this.replayPlaying = false;
    R.apply(this.replayT, this.track.length);
    // wrecks the marshals have craned away
    for (const c of race.cars) {
      const rig = this.rigs.get(c.entry)!;
      const vis = (R.flags[c.id] & RF.removed) === 0;
      if (rig.root.visible !== vis) rig.root.visible = vis;
    }
    this.syncAllViews(dt, R.ghosts);
    if (this.directorOn) {
      // a replay knows what's coming: the director gets there a few seconds early
      this.director.update(step, this.replayT, R.raceTime, this.fieldReplay(), R.events, 3, this.cams, this.track, race.player.id);
      if (this.director.cutNow) this.applyDirector();
    }
    const k = this.focusId;
    const fc = race.cars[k];
    this.cams.update(step, R.ghosts[k], this.rigs.get(fc.entry)!, this.track);
    this.povUpdate();
    const laps = race.opts.laps;
    const lap = Math.max(1, Math.min(laps, R.leaderLap + 1));
    let fastest = -1;
    for (let i = 0; i < R.flags.length; i++) if (R.flags[i] & RF.fastest) fastest = i;
    this.hud.replayFrame(dt, `Lap <b>${lap}/${laps}</b>`, R.pos, R.gap, this.replayOut, fastest);
    this.hud.setFocus(k);
    this.hud.setBroadcast(true, true, this.broadcast.clean);
    // the banners for the moments as the replay plays through them
    if (step > 0 && this.replaySpeed <= 2) {
      for (const e of R.events) if (e.t > this.announcedT && e.t <= this.replayT) this.announce(e);
    }
    this.announcedT = this.replayT;
    const f = this.follow;
    const fl = R.flags[k];
    const p = R.pos[k] || 1;
    let ahead = -1;
    for (let i = 0; i < R.pos.length; i++) if (R.pos[i] === p - 1) ahead = i;
    f.entry = fc.entry;
    f.position = p;
    f.speed = R.ghosts[k].vx;
    f.gapAhead = ahead >= 0 && R.gap[k] > 0 && R.gap[ahead] >= 0 ? R.gap[k] - R.gap[ahead] : 0;
    f.status = fl & RF.retired ? 'OUT' : fl & RF.pit ? 'PIT' : fl & RF.finished ? 'FINISHED' : '';
    f.caption = this.directorOn && this.director.focus === k ? this.director.caption : '';
    this.broadcast.setFollow(f);
    this.broadcast.setShot(CAMERA_LABEL[this.cams.mode], this.cams.where, this.directorOn, this.replaySpeed);
    this.broadcast.setTime(this.replayT, R.raceTime, lap, laps, this.replayPlaying);
  }

  private endReplay() {
    this.leaveBroadcast();
    // back to the live cars
    const inRace = new Set(this.race.cars.map((c) => c.entry));
    for (const c of this.race.cars) {
      const rig = this.rigs.get(c.entry);
      if (rig) rig.root.visible = inRace.has(c.entry) && !c.removed;
    }
    this.cams.set('tv');
    this.input.releaseAll();
    this.showResults();
  }

  /** dev/demo hook: watch a simulated race, optionally fast-forwarded (e.g. from the console or tools/shot.mjs) */
  debugSpectate(opts: { skip?: number; camera?: CameraMode; speed?: number; director?: boolean; focus?: number; laps?: number; weather?: WeatherChoice }) {
    const setup = { ...this.menu.setup };
    if (opts.laps) setup.laps = opts.laps;
    if (opts.weather) setup.weather = opts.weather;
    this.startSpectate(setup);
    const skip = opts.skip ?? 0;
    if (skip > 0) {
      this.race.startLights();
      const dt = 1 / 60;
      for (let t = 0; t < skip; t += dt) {
        this.spectatePits();
        this.driveInput(dt);
        this.race.update(dt);
        this.replay.record(dt, this.race);
      }
      this.replay.fresh.length = 0;
      this.stateTime = 10;
      this.syncAllViews(dt);
    }
    if (opts.speed) this.simSpeed = opts.speed;
    if (opts.focus !== undefined) this.focusId = opts.focus;
    if (opts.director === false || opts.camera) this.directorOn = false;
    if (opts.camera) this.cams.set(opts.camera);
  }

  /** dev/demo hook: open the full replay of the session so far at `at` seconds in */
  debugReplay(opts: { at?: number; camera?: CameraMode; focus?: number; playing?: boolean; director?: boolean }) {
    this.startReplay();
    if (opts.at !== undefined) this.replaySeek(this.replayStart + opts.at);
    if (opts.focus !== undefined) this.focusId = opts.focus;
    if (opts.director === false || opts.camera) this.directorOn = false;
    if (opts.camera) this.cams.set(opts.camera);
    if (opts.playing !== undefined) this.replayPlaying = opts.playing;
  }

  private syncAllViews(dt: number, ghosts?: CarPhysics[]) {
    this.camPos.copy(this.camera.position);
    const cockpit = (this.state === 'race' || this.state === 'intro') && this.cams.mode === 'cockpit';
    if (cockpit !== this.driverHidden) {
      this.driverHidden = cockpit;
      this.rigs.get(this.race.player.entry)?.setDriverVisible(!cockpit);
    }
    const w = this.race.weatherState;
    // (and after dark: the red tail light is what you follow down a floodlit straight)
    const rainLight = w.wetness > 0.22 || w.rain > 0.08 || w.fog > 0.85 || w.time === 'night';
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
    if (this.audioReady) {
      this.audio.explosion(near);
      this.audio.crowdReact('gasp', 0.5 + 0.5 * near);
    }
    this.cams.impulse = Math.max(this.cams.impulse, Math.min(1, 40 / (d + 20)));
  }

  // ------------------------------------------------------------------ the garage

  /** the player's rig wears their paint (rebuilt when it changes); everyone else their team's */
  private refreshPlayerRig() {
    if (!this.race || this.rigs.size === 0) return;
    const player = this.race.player.entry;
    for (const [e, rig] of this.rigs) {
      const team = e === player ? Career.painted(e.team, this.career.paintFor(TEAMS.indexOf(e.team))) : e.team;
      if (this.rigTeam.get(e) === team.id) continue;
      const visible = rig.root.visible;
      rig.root.removeFromParent();
      rig.dispose();
      const next = createCar(team, e.driver, e.seat, { envMap: this.scene.environment ?? undefined });
      next.root.visible = visible;
      this.rigs.set(e, next);
      this.rigTeam.set(e, team.id);
      this.views.set(e, new CarView(next));
      this.rigCompound.delete(e);
      this.carsGroup.add(next.root);
    }
  }

  /**
   * A different circuit, without reloading the page: behind the travel veil the current world is
   * disposed and the new one built in steps (the cars, audio, menu, particles and career stay).
   * Asking again while travelling just changes the destination; the newest request wins.
   */
  private travel(id: string = this.menu.setup.track) {
    this.travelTo = id;
    if (!this.travelling) this.travelling = this.runTravel().finally(() => (this.travelling = null));
    return this.travelling;
  }
  private travelTo: string | null = null;
  private travelling: Promise<void> | null = null;
  /** dev/test hook: `await __game.travelAsync('spa')` */
  travelAsync(id: string) {
    return this.travel(id);
  }

  private async runTravel() {
    const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    while (this.travelTo && this.travelTo !== this.track.def.id) {
      const def = CIRCUITS.find((c) => c.id === this.travelTo);
      if (!def) break;
      const t0 = performance.now();
      const screen = this.menu.screen;
      const veil = document.createElement('div');
      veil.className = 'travel-veil';
      veil.innerHTML = `<div><span>Travelling to</span><b>${def.name}</b><div class="tv-bar"><i></i></div><div class="tv-step">Packing up</div></div>`;
      const bar = veil.querySelector('.tv-bar i') as HTMLElement;
      const step = veil.querySelector('.tv-step') as HTMLElement;
      const set = (f: number, label: string) => {
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, f)).toFixed(3)})`;
        step.textContent = label;
      };
      document.body.appendChild(veil);
      await paint();
      veil.classList.add('on');
      if (this.audioReady) this.audio.crowd(0);
      await wait(380);
      // the newest destination, now that the screen is covered
      const dest = CIRCUITS.find((c) => c.id === this.travelTo) ?? def;
      (veil.querySelector('b') as HTMLElement).textContent = dest.name;
      this.worldBusy = true;
      try {
        const oldEnv = this.scene.environment;
        set(0.04, 'Packing up');
        await paint();
        let tp = performance.now();
        this.disposeWorld();
        const tDispose = Math.round(performance.now() - tp);
        await this.buildWorld(dest, async (f, label) => {
          set(0.06 + f * 0.8, label);
          await paint();
        });
        // the cars keep their materials: point their reflections at the new sky
        const env = this.scene.environment;
        if (env !== oldEnv) for (const rig of this.rigs.values()) rig.setEnvMap?.(env);
        tp = performance.now();
        this.finishWorld();
        this.worldTimes.dispose = tDispose;
        this.worldTimes.finish = Math.round(performance.now() - tp);
        set(0.9, 'Warming up');
        await paint();
        tp = performance.now();
        this.state = 'menu';
        this.toMenu();
        await this.warmUp();
        this.worldTimes.warm = Math.round(performance.now() - tp);
      } catch (e) {
        // a half-built world can't be raced: fall back to a clean start there (the setup is saved)
        console.error('[travel] failed, reloading', e);
        location.reload();
        return;
      }
      this.worldBusy = false;
      if (screen !== 'title' && screen !== 'none') this.menu.show(screen);
      set(1, 'Ready');
      // a couple of real frames behind the veil (garage build, texture uploads), then reveal
      await paint();
      await paint();
      this.travelMs = Math.round(performance.now() - t0);
      console.info(`[shot] [travel] ${dest.id} in ${this.travelMs} ms ${JSON.stringify(this.worldTimes)}`);
      veil.classList.remove('on');
      setTimeout(() => veil.remove(), 600);
    }
    this.travelTo = null;
  }
  /** how long the last circuit switch took (ms) */
  travelMs = 0;

  /** soft work lights over the bays: the garage ceiling blocks the sun */
  private buildGarageLights() {
    const g = this.garageLights;
    g.name = 'garage-lights';
    const key = new THREE.SpotLight(0xfff4e8, 130, 16, 0.75, 0.6, 1.6);
    key.position.set(0, 4.3, 0.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 8;
    // only the garage (its props, people and the two cars) casts into the key light's
    // shadow map: the world's big merged meshes would all intersect its frustum
    key.shadow.camera.layers.set(GARAGE_SHADOW_LAYER);
    g.add(key, key.target);
    // two soft fills from the ceiling strips (each light costs every lit pixel on screen)
    for (const [z, i] of [[2.6, 22], [-2.4, 19]] as const) {
      const p = new THREE.PointLight(0xf4f1ea, i, 10, 1.7);
      p.position.set(0, 3.7, z);
      g.add(p);
    }
    const rim = new THREE.PointLight(0xbfd6ff, 18, 10, 1.6);
    rim.position.set(0, 1.6, -4.6);
    g.add(rim);
    // the lights also light the car in the floor mirror
    g.traverse((o) => o.layers.enable(GARAGE_MIRROR_LAYER));
    g.visible = false;
    this.scene.add(g);
  }

  /** menu: the player's car in their garage (teammate's in the other bay), a slow cinematic camera per tab */
  private garageFrame(dt: number) {
    const team = TEAMS.indexOf(this.race.player.entry.team);
    const player = this.race.player.entry;
    const mate = this.entries.find((e) => e.team === player.team && e !== player)!;
    const up = this.tmp.set(0, 1, 0);
    for (const [e, rig] of this.rigs) {
      const k = e === player ? player.seat : e === mate ? mate.seat : -1;
      rig.root.visible = k >= 0;
      if (k < 0) continue;
      const b = this.pits.bay(team, k as 0 | 1);
      rig.root.position.copy(b.pos);
      rig.root.quaternion.setFromAxisAngle(up, b.yaw);
      rig.body.rotation.set(0, 0, 0);
      rig.body.position.y = 0.02;
      rig.setSteer(0);
      rig.setWheelSpeed(0);
      rig.setBrakeGlow(0);
      rig.setDrs(0);
      rig.setRainLight(false);
      rig.setDetail(0);
      rig.setDriverVisible(false);
    }
    const b = this.pits.bay(team, player.seat);
    const c = b.pos;
    const rig = this.rigs.get(player)!;
    // the garage dressing: rebuilt when the car (paint) or the team changes
    if (!this.garage || this.garageRig !== rig) {
      this.garage?.dispose();
      rig.root.updateMatrixWorld(true);
      this.garage = new GarageScene(peopleKit(), rig, b, player.team, player.driver, this.highlights, this.career, this.track, { renderer: this.gfx.renderer, shadowLayer: GARAGE_SHADOW_LAYER, reflectLayer: GARAGE_MIRROR_LAYER });
      this.garageRig = rig;
      this.scene.add(this.garage.group);
    }
    if (!rig.root.userData.garageShadow) {
      rig.root.userData.garageShadow = true;
      rig.root.traverse((o) => {
        o.layers.enable(GARAGE_SHADOW_LAYER);
        o.layers.enable(GARAGE_MIRROR_LAYER);
      });
    }
    this.garage.setActive(true);
    this.enterGarageLook();
    this.garageLights.position.copy(c);
    this.garageLights.rotation.set(0, b.yaw, 0);
    this.garageLights.updateMatrixWorld(true);
    const key = this.garageLights.children[0] as THREE.SpotLight;
    key.target.position.set(0, 0, 0);
    // car frame: +z out to the lane, +x to the car's left; the camera works on the side with room
    const fwd = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const side = left.dot(b.inward) > 0 ? 1 : -1;
    const t = this.stateTime;
    type Shot = { cam: [number, number, number]; look: [number, number, number]; shift: number; fov: number };
    const shots: Record<HubTab, Shot> = {
      race: { cam: [3.5, 1.3, 6.2], look: [0, 0.75, -0.6], shift: 1.45, fov: 38 },
      career: { cam: [4.3, 2.0, 3.0], look: [0, 0.35, -0.3], shift: 1.35, fov: 36 },
      highlights: { cam: [1.6, 2.5, -0.2], look: [0, 2.05, -6.0], shift: 1.0, fov: 42 },
      car: { cam: [3.4, 1.7, -4.6], look: [0, 0.45, -0.5], shift: 1.45, fov: 36 },
      setup: { cam: [3.6, 1.6, 3.6], look: [0, 0.35, 0], shift: 1.3, fov: 36 },
      paint: { cam: [3.1, 3.4, 4.1], look: [0, 0.15, 0.2], shift: 1.45, fov: 38 },
      settings: { cam: [2.3, 0.7, 3.2], look: [0.75, 0.3, 1.55], shift: 0.7, fov: 34 },
    };
    let sh: Shot = shots[this.hubTab];
    const toW = (v: readonly [number, number, number], out: THREE.Vector3) =>
      out.copy(c).addScaledVector(left, v[0] * side).addScaledVector(fwd, v[2]).setY(c.y + v[1]);
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    const part = this.hubTab === 'setup' ? this.focusPart : null;
    if (part && this.garage.parts[part === 'tyres' ? 'tyres' : part]) {
      // a close look at the part being set up, from the open side
      const P = this.garage.parts[part];
      const rel = P.clone().sub(c);
      const onSide = Math.sign(rel.dot(left)) || side;
      const along = rel.dot(fwd);
      const off: Record<string, [number, number, number]> = {
        frontWing: [1.2, 0.75, 1.5], rearWing: [1.4, 1.1, -1.6], brakes: [1.1, 0.45, 0.7], suspension: [1.2, 0.95, 0.9], floor: [1.6, 0.35, 0.4], tyres: [1.2, 0.5, -0.8],
      };
      const o = off[part] ?? [1.4, 0.8, 1];
      wantPos.copy(P).addScaledVector(left, o[0] * onSide).addScaledVector(fwd, o[2]).add(new THREE.Vector3(0, o[1], 0));
      wantLook.copy(P);
      sh = { ...sh, shift: 0.35 + 0.02 * Math.abs(along), fov: 38 };
    } else if (this.garageOrbit.active) {
      // looking around the car by hand
      const O = this.garageOrbit;
      const center = c.clone().add(new THREE.Vector3(0, 0.45, 0));
      const dir = new THREE.Vector3(Math.sin(O.yaw) * Math.cos(O.pitch), Math.sin(O.pitch), Math.cos(O.yaw) * Math.cos(O.pitch));
      // yaw is measured in the car's frame
      const q = new THREE.Quaternion().setFromAxisAngle(up, b.yaw);
      dir.applyQuaternion(q);
      wantPos.copy(center).addScaledVector(dir, O.dist);
      wantLook.copy(center);
      sh = { ...sh, shift: 0.9, fov: 38 };
    } else {
      const drift = Math.sin(t * 0.21) * 0.25;
      toW([sh.cam[0], sh.cam[1] + Math.sin(t * 0.17) * 0.05, sh.cam[2] + drift], wantPos);
      toW(sh.look, wantLook);
      if (this.hubTab === 'highlights') wantLook.copy(this.garage.wallCenter);
    }
    // push the subject left of centre: the hub panel is on the right
    const dirV = wantLook.clone().sub(wantPos).normalize();
    const camRight = new THREE.Vector3().crossVectors(dirV, up).normalize();
    wantLook.addScaledVector(camRight, sh.shift);
    // the camera flies between shots on springs (eased in and out), arcing around the car
    // rather than cutting through it: position in cylindrical coordinates about the car
    const g = this.garageCam;
    const rel = wantPos.clone().sub(c);
    const thW = Math.atan2(rel.x, rel.z), rW = Math.hypot(rel.x, rel.z);
    if (!g.init) {
      Object.assign(g, { th: thW, r: rW, y: rel.y, fov: sh.fov, vth: 0, vr: 0, vy: 0, vfov: 0, init: true });
      g.look.copy(wantLook);
      g.vl.set(0, 0, 0);
    }
    const w = this.garageOrbit.dragging ? 14 : part ? 3.6 : 3.0;
    const thT = g.th + Math.atan2(Math.sin(thW - g.th), Math.cos(thW - g.th));
    for (let left2 = Math.min(dt, 0.1); left2 > 1e-5; left2 -= 1 / 120) {
      const h = Math.min(left2, 1 / 120);
      g.vth += (w * w * (thT - g.th) - 2 * w * g.vth) * h;
      g.vr += (w * w * (rW - g.r) - 2 * w * g.vr) * h;
      g.vy += (w * w * (rel.y - g.y) - 2 * w * g.vy) * h;
      g.vfov += (w * w * (sh.fov - g.fov) - 2 * w * g.vfov) * h;
      g.th += g.vth * h;
      g.r += g.vr * h;
      g.y += g.vy * h;
      g.fov += g.vfov * h;
      const a = this.tmp2.copy(wantLook).sub(g.look).multiplyScalar(w * w).addScaledVector(g.vl, -2 * w);
      g.vl.addScaledVector(a, h);
      g.look.addScaledVector(g.vl, h);
    }
    g.pos.set(c.x + Math.sin(g.th) * g.r, c.y + g.y, c.z + Math.cos(g.th) * g.r);
    this.camera.position.copy(g.pos);
    this.camera.lookAt(g.look);
    this.camera.fov = g.fov;
    this.camera.updateProjectionMatrix();
    this.dofTarget.copy(part ? this.garage.parts[part] : this.hubTab === 'highlights' ? this.garage.wallCenter : c.clone().setY(c.y + 0.5));
    // crisp: no depth of field in the garage, except a whisper of it on a part close-up
    if (part) this.gfx.setDepthOfField(true, this.dofTarget, 3.2, 1.1);
    else this.gfx.setDepthOfField(false);
    // nobody stands between the camera and the car
    this.pits.clearView(g.pos, c, 1.6);
    this.pits.hideCrew(team);
    this.garage.update(dt, g.pos, this.dofTarget, this.camera);
    this.updateHotspots();
  }

  // ---------------------------------------------------------------- garage: a sharp picture
  /**
   * The garage is a still life, so it gets a sharper picture than the race: rendered up
   * to 1.5× the CSS resolution on high-density screens, and never below 0.7 (the race's
   * dynamic-resolution governor is held off in the menu; if the menu itself runs under
   * 55 fps for 1.5 s the scale steps down, 0.15 at a time), less film grain, and the sun's
   * shadow map frozen (the garage roof hides the sun, and its cascades were ~2/3 of the
   * menu's triangles) with a refresh every 2 s. All undone when the menu closes.
   */
  private garageLook: { grain: number; suns: THREE.DirectionalLight[]; refresh: number; maxDyn: number; fps: number; slow: number } | null = null;
  private enterGarageLook() {
    const gfx = this.gfx;
    const menuMax = () => Math.max(gfx.maxDynamic, Math.min(window.devicePixelRatio || 1, 1.5) / Math.max(0.01, gfx.renderer.getPixelRatio() / gfx.dynamicScale));
    if (!this.garageLook) {
      // every shadow-casting light out in the world (the sun's cascades), not the garage's own
      const suns: THREE.DirectionalLight[] = [];
      const mine = new Set<THREE.Object3D>();
      this.garageLights.traverse((o) => mine.add(o));
      this.scene.traverse((o) => {
        const l = o as THREE.DirectionalLight;
        if (l.isLight && l.castShadow && l.shadow?.autoUpdate && !mine.has(l)) suns.push(l);
      });
      for (const l of suns) {
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = true;
      }
      this.garageLook = { grain: gfx.grain.blendMode.opacity.value, suns, refresh: 0, maxDyn: gfx.maxDynamic, fps: 50, slow: 0 };
      gfx.grain.blendMode.opacity.value = 0.02;
      gfx.maxDynamic = menuMax();
      gfx.setDynamicScale(gfx.maxDynamic);
    }
    const L = this.garageLook;
    L.refresh += this.lastDt;
    if (L.refresh > 2) {
      L.refresh = 0;
      for (const l of L.suns) l.shadow.needsUpdate = true;
    }
    // (a graphics-level change in the settings resets the ceiling)
    if (gfx.maxDynamic < L.maxDyn + 1e-3) {
      L.maxDyn = gfx.maxDynamic;
      gfx.maxDynamic = menuMax();
    }
    // the race's resolution governor is held off; the menu steps itself down if it must
    this.aq.settleUntil = Math.max(this.aq.settleUntil, performance.now() / 1000 + 0.6);
    L.fps = L.fps * 0.95 + (1 / Math.max(this.lastDt, 1e-3)) * 0.05;
    // (perf pass: it steps down below 55 fps, not 40 — orbiting the car by hand should feel smooth —
    // and may go down to 0.7; on a Retina MacBook the 1.5 start costs ~2.3× the pixels of 1.0)
    L.slow = L.fps < 55 ? L.slow + this.lastDt : 0;
    if (gfx.dynamicScale < 0.7) gfx.setDynamicScale(0.7);
    else if (L.slow > 1.5 && gfx.dynamicScale > 0.701) {
      gfx.setDynamicScale(Math.max(0.7, gfx.dynamicScale - 0.15));
      L.slow = 0;
      L.fps = 50;
    }
  }
  private leaveGarageLook() {
    const L = this.garageLook;
    if (!L) return;
    this.garageLook = null;
    this.gfx.grain.blendMode.opacity.value = L.grain;
    this.gfx.maxDynamic = L.maxDyn;
    if (this.gfx.dynamicScale > L.maxDyn) this.gfx.setDynamicScale(Math.min(1, L.maxDyn));
    for (const l of L.suns) {
      l.shadow.autoUpdate = true;
      l.shadow.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- garage: look around, hotspots
  private garage: GarageScene | null = null;
  private garageRig: CarRig | null = null;
  private focusPart: SetupPart | null = null;
  private garageOrbit = { active: false, dragging: false, yaw: 0.8, pitch: 0.25, dist: 6.2, lx: 0, ly: 0 };
  private hotspotLayer: HTMLDivElement | null = null;

  private bindGarageInput() {
    const O = this.garageOrbit;
    const onUi = (e: Event) => (e.target as HTMLElement).closest('.hub-panel, .hub-rail, .htab, .hotspot, .cta, .screen:not(.hub)') !== null;
    addEventListener('pointerdown', (e) => {
      if (this.state !== 'menu' || this.menu.screen !== 'title' || onUi(e)) return;
      O.dragging = true;
      if (!O.active) {
        // start from where the camera is now
        const rel = this.camera.position.clone().sub(this.playerRigPos());
        const b = this.pits.bay(TEAMS.indexOf(this.race.player.entry.team), this.race.player.entry.seat);
        rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), -b.yaw);
        O.dist = THREE.MathUtils.clamp(rel.length(), 3, 9);
        O.yaw = Math.atan2(rel.x, rel.z);
        O.pitch = THREE.MathUtils.clamp(Math.asin((rel.y - 0.45) / Math.max(0.1, rel.length())), 0.02, 1.2);
      }
      O.active = true;
      O.lx = e.clientX;
      O.ly = e.clientY;
    });
    addEventListener('pointermove', (e) => {
      if (!O.dragging) return;
      O.yaw -= (e.clientX - O.lx) * 0.006;
      O.pitch = THREE.MathUtils.clamp(O.pitch + (e.clientY - O.ly) * 0.004, 0.02, 1.2);
      O.lx = e.clientX;
      O.ly = e.clientY;
    });
    addEventListener('pointerup', () => (O.dragging = false));
    addEventListener(
      'wheel',
      (e) => {
        if (this.state !== 'menu' || this.menu.screen !== 'title' || onUi(e)) return;
        O.active = true;
        O.dist = THREE.MathUtils.clamp(O.dist * (1 + e.deltaY * 0.001), 2.6, 10);
      },
      { passive: true },
    );
    this.hotspotLayer = document.createElement('div');
    this.hotspotLayer.className = 'hotspots';
    (this.hud.root.parentElement ?? document.body).appendChild(this.hotspotLayer);
    const labels: [SetupPart, string][] = [['frontWing', 'Front wing'], ['rearWing', 'Rear wing'], ['brakes', 'Brakes'], ['suspension', 'Suspension'], ['floor', 'Ride height'], ['tyres', 'Tyres']];
    labels.forEach(([id, label], i) => {
      const h = document.createElement('button');
      h.className = 'hotspot';
      h.dataset.part = id;
      h.style.setProperty('--i', String(i));
      h.innerHTML = `<i class="hs-dot"></i><span class="hs-tag"><b>${label}</b><em></em></span>`;
      h.addEventListener('click', () => {
        this.menu.focusPart(id);
        if (this.audioReady) this.audio.ui('select');
      });
      this.hotspotLayer!.appendChild(h);
    });
  }

  private updateHotspots() {
    const L = this.hotspotLayer;
    if (!L) return;
    const show = this.state === 'menu' && this.menu.screen === 'title' && this.hubTab === 'setup' && !!this.garage;
    L.classList.toggle('on', show);
    if (!show) return;
    const v = new THREE.Vector3();
    for (const h of Array.from(L.children) as HTMLElement[]) {
      const id = h.dataset.part as SetupPart;
      const P = this.garage!.parts[id];
      if (!P) continue;
      v.copy(P).project(this.camera);
      const sx = ((v.x + 1) / 2) * innerWidth;
      // not under the tab rail or the panel
      const vis = v.z < 1 && Math.abs(v.y) < 0.9 && sx > 280 && sx < innerWidth - 500;
      h.style.transform = `translate3d(${Math.round(sx * 2) / 2}px, ${Math.round(((1 - v.y) / 2) * innerHeight * 2) / 2}px, 0)`;
      h.classList.toggle('hidden', !vis);
      h.classList.toggle('sel', id === this.focusPart);
      // the part's current setting on its tag
      const d = SETUP.find((x) => x.part === id);
      const val = d ? d.fmt(this.career.data.setup[d.id]) : '';
      if (h.dataset.val !== val) {
        h.dataset.val = val;
        const em = h.querySelector('em');
        if (em) em.textContent = val;
      }
    }
  }

  private playerRigPos(): THREE.Vector3 {
    const rig = this.rigs.get(this.race.player.entry)!;
    return rig.root.getWorldPosition(this.tmp2);
  }

  // ------------------------------------------------------------------ fx

  private effects(dt: number) {
    this.carFx.update(dt, this.race, this.rigs, this.camera.position, this.race.weather.state);
    if (dt > 0) this.skids.update(this.race.cars, this.race.weather.state.wetness);
  }

  /**
   * Pit stops on screen: each team's crew follows the car it's working on (coming
   * down the lane, stopped — on the stop's own clock — or leaving), and a stopped
   * car goes up on the jacks while its wheels come off and the new set goes on.
   */
  private readonly pitPose = newStopPose();
  private readonly pitBest: (Competitor | null)[] = [];
  private lastPlayerPit = 'none';
  private updatePits(dt: number, race: Race) {
    const live = this.state !== 'replay' && this.state !== 'flashback';
    const prio = { none: 0, out: 1, in: 2, stop: 3 } as const;
    for (let k = 0; k < TEAMS.length; k++) this.pitBest[k] = null;
    for (const c of race.cars) {
      const ps = c.pit;
      const view = this.views.get(c.entry);
      if (view) {
        if (live && ps.phase === 'stop') {
          const P = stopPose(ps.timer, ps.stopTime, ps.slow, this.pitPose);
          view.setPit(P.liftF, P.liftR, P.wheel);
        } else view.setPit(0, 0, null);
      }
      if (!live || ps.phase === 'none' || (ps.phase === 'out' && ps.s > ps.boxS + 60)) continue;
      const k = TEAMS.indexOf(c.entry.team);
      const cur = this.pitBest[k];
      if (!cur || prio[ps.phase] > prio[cur.pit.phase] || (ps.phase === cur.pit.phase && ps.s > cur.pit.s)) this.pitBest[k] = c;
    }
    for (let k = 0; k < TEAMS.length; k++) {
      const c = this.pitBest[k];
      if (!c) {
        this.pits.setStop(k, null);
        continue;
      }
      const ps = c.pit;
      this.pits.setStop(k, { phase: ps.phase as 'in' | 'stop' | 'out', dist: ps.boxS - ps.s, t: ps.timer, T: ps.stopTime, slow: ps.slow, held: ps.held, green: ps.green, old: ps.prev, fresh: ps.next });
    }
    // the autopilot (demo / tests) picks the car up again at the pit exit
    const pp = race.player.pit.phase;
    if (pp === 'none' && this.lastPlayerPit !== 'none') this.autopilot?.startFrom(race.player.car, this.track);
    this.lastPlayerPit = pp;
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

  /** the player's position last frame (crowd reactions) */
  private audioPos = 0;

  private updateAudio(dt: number) {
    if (!this.audioReady) return;
    const a = this.audio;
    const race = this.race;
    const w = race.weatherState;
    if (this.state === 'menu' || this.state === 'results' || this.state === 'paused' || this.state === 'flashback' || this.state === 'celebration') {
      const paused = this.state === 'paused' || this.state === 'flashback';
      a.weather(paused ? 0 : w.rain, w.wetness, 0, paused ? 0 : w.lightning, paused ? 0 : Math.hypot(w.windX, w.windZ));
      // engine off in the garage / under the results / at the podium; idling behind the pause menu
      a.updatePlayer({ rpm: paused ? 4200 : 0, throttle: 0, brake: 0, speed: 0, gear: 0, slip: 0, surface: 0, onKerb: false, drs: false, ers: 0, limiter: false });
      a.updateOpponents([]);
      a.space(60, 60, false);
      a.update(dt);
      return;
    }
    const replaying = this.state === 'replay';
    const carOf = (c: (typeof race.cars)[number]) => (replaying ? this.replay.ghosts[c.id] : c.car);
    // the car the cameras are on is "ours" (the followed car when watching)
    const watching = this.state === 'spectate' || replaying;
    const ours = watching ? (race.cars[this.focusId] ?? race.player) : race.player;
    const car = carOf(ours);
    a.setView(ONBOARD[this.cams.mode] ? 'cockpit' : isRemoteCam(this.cams.mode) ? 'tv' : 'chase');
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
      // the pit-lane speed limiter: on while running down the lane at the limit
      pitLimiter: ours.pit.phase !== 'none' && ours.pit.phase !== 'stop' && car.vx > 17 && car.vx < 25,
    });
    // the space around our car: barriers either side, the pit lane's walls and garages
    a.space(this.track.barrierAt(car.s, -1) + car.lateral, this.track.barrierAt(car.s, 1) - car.lateral, ours.pit.phase !== 'none');
    // the grandstands cheer the player's overtakes
    if (!watching && race.phase === 'racing' && !race.isTimeTrial) {
      if (this.audioPos && race.player.position < this.audioPos) a.crowdReact('cheer', 0.6);
      this.audioPos = race.player.position;
    }
    // opponents relative to the camera
    const cam = this.camera;
    const camRight = this.tmp.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const q = cam.quaternion;
    const fwdX = -2 * (q.x * q.z + q.w * q.y), fwdZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const fwdL = Math.hypot(fwdX, fwdZ) || 1;
    const camVel = this.tmp2.copy(cam.position).sub(this.prevCamPos).divideScalar(Math.max(dt, 1e-3));
    this.prevCamPos.copy(cam.position);
    const list: { id: number; rpm: number; throttle: number; distance: number; relVel: number; pan: number; behind: number }[] = [];
    for (const c of race.cars) {
      if (c === ours) {
        if (isRemoteCam(this.cams.mode)) {
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
      // (far cars still count: they make the distant drone of the rest of the field)
      if (d > 1500 || c.removed) continue;
      const [wx, wz] = carOf(c).worldVelocity();
      // closing speed along the line of sight (+ = approaching)
      const relVel = -((wx - camVel.x) * dx + (wz - camVel.z) * dz) / Math.max(d, 1);
      const pan = Math.max(-1, Math.min(1, (dx * camRight.x + dz * camRight.z) / Math.max(d, 1)));
      const behind = Math.max(0, Math.min(1, -(dx * fwdX + dz * fwdZ) / (fwdL * Math.max(d, 1))));
      list.push({ id: c.id, rpm: carOf(c).rpm, throttle: carOf(c).throttle, distance: d, relVel, pan, behind });
    }
    a.updateOpponents(list);
    a.update(dt);
  }

  // ------------------------------------------------------------------ perf

  /**
   * Dynamic resolution that holds 60 fps, checked twice a second with hysteresis.
   * With the GPU timer the render scale follows the GPU's own frame time (aiming at ~13 ms,
   * so a CPU-bound frame never costs resolution); without it, the frame rate.
   * Down: at once, in proportion to the overrun. Up: one 5 % step after 2 s of headroom; a
   * raise that turns slow again within 4 s caps the scale below it for 30 s. The only
   * automatic quality step is Ultra → High (never up: a level change recompiles shaders).
   */
  private adaptQuality(dt: number) {
    this.fpsAvg = this.fpsAvg * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    const aq = this.aq;
    aq.t += dt;
    aq.frames++;
    if (aq.t < 0.5) return;
    const fps = aq.frames / aq.t;
    aq.t = 0;
    aq.frames = 0;
    const g = this.gfx.takeGpuSamples();
    let gpu = NaN;
    if (g.length >= 4) {
      g.sort((a, b) => a - b);
      gpu = g[g.length >> 1];
    }
    const w = window as unknown as { __fps: number; __gpuMs: number };
    w.__fps = Math.round(fps);
    w.__gpuMs = Math.round(gpu * 10) / 10;
    const s = this.state;
    if (this.worldBusy || s === 'paused' || s === 'boot' || s === 'flashback') return;
    const now = performance.now() / 1000;
    if (now < aq.settleUntil) return;
    const gfx = this.gfx;
    const st = this.menu.settings;
    const timed = isFinite(gpu);
    const slow = timed ? gpu > 14.5 && fps < 58 : fps < 55;
    const roomy = timed ? gpu < 10.5 : fps > 59;
    if (slow) {
      aq.headroom = 0;
      // the last raise didn't hold: stay below it for a while
      if (aq.raisedFrom > 0 && now - aq.raisedAt < 4) {
        aq.ceiling = aq.raisedFrom;
        aq.ceilingUntil = now + 30;
      }
      aq.raisedFrom = 0;
      const k = timed ? THREE.MathUtils.clamp(Math.sqrt(13 / gpu), 0.72, 0.95) : fps < 40 ? 0.82 : 0.92;
      const next = Math.max(gfx.minDynamic, Math.floor(gfx.dynamicScale * k * 20) / 20);
      if (next < gfx.dynamicScale - 0.001) {
        gfx.setDynamicScale(next);
        aq.settleUntil = now + 0.8;
      }
      // still slow at the lowest resolution for 2 s on Ultra: step down to High (auto quality only)
      if (gfx.dynamicScale <= gfx.minDynamic + 0.001 && st.autoQuality && st.quality === 'ultra') {
        if (++aq.slowAtFloor >= 4) {
          aq.slowAtFloor = 0;
          this.setAutoQuality('high');
        }
      } else aq.slowAtFloor = 0;
    } else if (roomy && fps >= 57) {
      aq.slowAtFloor = 0;
      const ceil = now < aq.ceilingUntil ? Math.min(aq.ceiling, gfx.maxDynamic) : gfx.maxDynamic;
      if (++aq.headroom >= 4 && gfx.dynamicScale < ceil - 0.001) {
        aq.raisedFrom = gfx.dynamicScale;
        aq.raisedAt = now;
        gfx.setDynamicScale(Math.min(ceil, Math.round((gfx.dynamicScale + 0.05) * 20) / 20));
        aq.headroom = 0;
        aq.settleUntil = now + 0.8;
      }
    } else aq.headroom = Math.max(0, aq.headroom - 1);
  }
  private setAutoQuality(q: QualityLevel) {
    // this session only: the saved setting stays what the player (or the default) chose
    const st = this.menu.settings;
    st.quality = q;
    this.applySettings(st);
    this.aq.ceilingUntil = 0;
    this.aq.settleUntil = performance.now() / 1000 + 1.5;
  }
  /** adaptive resolution state (see adaptQuality) */
  private readonly aq = { t: 0, frames: 0, headroom: 0, slowAtFloor: 0, settleUntil: 0, raisedFrom: 0, raisedAt: 0, ceiling: 1, ceilingUntil: 0 };
}
