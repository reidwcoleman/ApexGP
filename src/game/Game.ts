import * as THREE from 'three';
import { MOTION_CARS, Renderer, type QualityLevel } from '../core/Renderer.ts';
import { Input } from '../core/Input.ts';
import { GameAudio } from '../core/Audio.ts';
import { Track, SURF } from '../world/Track.ts';
import { CIRCUITS, MONZA } from '../world/Circuits.ts';
import type { CircuitDef } from '../world/CircuitGen.ts';
import { collectDeep, collectResources, disposeTree, holdMaterials, releaseHeldMaterials, sweepGpu, trackGpuUploads } from '../core/dispose.ts';
import { createCloudNoise } from '../world/env/skyNoise.ts';
import { buildTreeKit } from '../world/env/treeproto.ts';
import { loadAsphaltScan, makeGroundTextures } from '../world/trackside/textures.ts';
import { noiseTexture, detailNormalTexture } from '../world/env/textures.ts';
import { sponsorTexture, teamBoardTexture } from '../world/env/signage.ts';
import { setEvent, EVENT } from '../world/event.ts';
const EVENT_GP = () => EVENT.gp;
import { buildTrackside, type Trackside } from '../world/TrackMesh.ts';
import { createEnvironment, type Environment, type Scenery } from '../world/Environment.ts';
import { sceneryBuilder } from '../world/env/scenery.ts';
import { DriverCareer, teamIndex as careerTeamIndex, teamColor as careerTeamColor, type Contract, type RoundSummary } from '../career/DriverCareer.ts';
import { applyGrid, currentSeries, type PlayerDriver } from '../career/Series.ts';
import { createCar, preloadCarAssets, type CarRig } from '../car/CarModel.ts';
import { TEAMS, allEntries, uiColor, type Entry, type Team } from '../race/Teams.ts';
import { Engineer } from '../race/Engineer.ts';
import { AIDriver } from '../sim/AIDriver.ts';
import { Race, aiQualifyingTime, aiPace, type Competitor } from '../race/Race.ts';
import { CarView } from './CarView.ts';
import { Cameras, CAMERA_LABEL, ONBOARD, INSIDE_CAR, ALL_CAMERAS, DEFAULT_CAM, isRemoteCam, type CameraMode } from './Cameras.ts';
import { ReplayBuffer, RF, type ReplayEvent } from './Replay.ts';
import { Director, type FieldCar } from './Director.ts';
import { Sightlines } from './Sightlines.ts';
import { IntroDirector, type IntroCaption } from './IntroDirector.ts';
import { Broadcast, describeEvent } from '../ui/Broadcast.ts';
import { SimSetup, type SimConfig } from '../ui/SimSetup.ts';
import { Flashback } from './Flashback.ts';
import type { CarPhysics, CarSpec } from '../sim/CarPhysics.ts';
import { Particles } from '../fx/Particles.ts';
import { CarEffects } from '../fx/CarEffects.ts';
import { Debris } from '../fx/Debris.ts';
import { SkidMarks } from '../fx/SkidMarks.ts';
import { HUD, fmtTime } from '../ui/HUD.ts';
import { Menu, aiLevel, GRID, CIRCUIT_INFO, circuitPath, type MotionBlurLevel, type RaceSetup, type Settings } from '../ui/Menu.ts';
import { Weather, planWeather, isLowSun, floodlit, WEATHER_LABEL, TIME_LABEL, type WeatherPlan, type WeatherState, type WeatherChoice, type TimeChoice } from '../world/Weather.ts';
import { applyWeatherUniforms, suppressFloods } from '../world/weatherUniforms.ts';
import { Headlights, type HeadlightCar } from '../world/env/headlights.ts';
import { BRAND_FONTS } from '../world/brands.ts';
import { aerialLens, aerialParams } from '../world/env/fog.ts';
import { buildPitComplex, type PitComplex } from '../world/PitComplex.ts';
import { PlayerControl } from '../sim/PlayerControl.ts';
import { RacingProfile } from '../sim/RacingProfile.ts';
import { F1_SPEC } from '../sim/CarPhysics.ts';
import { RacingLineAssist } from './RacingLineAssist.ts';
import { Celebration } from './Celebration.ts';
import type { AssistConfig } from './Assists.ts';
import { COMPOUNDS, newStopPose, stopPose } from '../race/Pit.ts';
import { Career, SETUP } from '../career/Career.ts';
import { rollForecast, CAREER_LAPS, type Forecast } from '../career/Season.ts';
import { ACHIEVEMENTS as ACH, unlockAchievement } from '../core/steam.ts';
import { artFor } from '../ui/loadingArt.ts';
import { loadPeople } from '../people/Humans.ts';
import { Highlights } from '../career/Highlights.ts';
import { GarageScene } from './GarageScene.ts';
import { SPOT_ORDER, type SpotId } from './GarageDressing.ts';
import { GarageTourUI } from '../ui/GarageTour.ts';
import { uiScale } from '../ui/scale.ts';
import { setCarAORenderer } from '../car/carAO.ts';
import { keepData, loadData, pixelKey, preloadPixels } from '../core/pixelCache.ts';
import { peopleKit } from '../people/Humans.ts';
import { crowdReactions } from '../people/reactions.ts';
import type { SetupPart } from '../career/Career.ts';
import type { HubTab } from '../ui/Menu.ts';

/** objects that cast shadows into the garage key light (see buildGarageLights) */
const GARAGE_SHADOW_LAYER = 3;
/** what the garage floor mirrors: the player's car, its blankets and the garage lights */
const GARAGE_MIRROR_LAYER = 4;

const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

/** Settings → Motion blur: the shutter as a fraction of a 60 fps frame (0.5 = a film camera's 180°) */
const MOTION_SHUTTER: Record<MotionBlurLevel, number> = { off: 0, subtle: 0.6, cinematic: 1.7 };

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

/**
 * Cameras that sit right on the bodywork get the tight, fine-texel shadow cascade (every onboard:
 * ONBOARD); the ones inside the cockpit also get the dark, defocused cockpit (INSIDE_CAR). Both
 * test what is on screen (Cameras.view: under the TV director, the shot it has on air).
 */
const EYE_CAMS = ONBOARD;

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
  /** the field's headlights after dark (lamps, beams, and the light they throw) */
  private headlights = new Headlights();
  private readonly lampCars: HeadlightCar[] = [];
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
  /** this session is a career round (10 laps, the round's own weather; counts for medals and unlocks) */
  private careerRace = false;
  /** each round's weekend forecast, rolled from its climate when first asked for and again after every race there */
  private readonly careerFc = new Map<string, Forecast>();
  private readonly lastFc = new Map<string, Forecast>();
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
  private simSetup!: SimSetup;
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
  /** the driver career (the game's main mode): one driver's seasons, teams, contracts and inbox */
  readonly dc = new DriverCareer();
  private rigDriverKey = new Map<Entry, string>();
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
    // (boot) three's per-program error check (info logs + link status read back on each program's first use)
    // is a blocking round trip to the GPU process per program: dev builds only (tools/console.mjs
    // runs against the dev server), or ?shadercheck
    this.gfx.renderer.debug.checkShaderErrors = import.meta.env.DEV || /[?&]shadercheck\b/.test(location.search);
    this.hud = new HUD(uiRoot);
    // the helmet cam's view through the visor opening: the padded edges of the helmet frame it
    this.visor = document.createElement('div');
    this.visor.className = 'visor-frame';
    Object.assign(this.visor.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.25s',
      background: [
        'linear-gradient(to bottom, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 7%, rgba(0,0,0,0) 17%)',
        'radial-gradient(ellipse 78% 92% at 50% 58%, rgba(0,0,0,0) 70%, rgba(4,4,6,0.55) 88%, rgba(4,4,6,0.95) 100%)',
      ].join(','),
    });
    canvas.insertAdjacentElement('afterend', this.visor);
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
      onStart: (mode, s) => {
        void this.worldReady().then((ok) => {
          if (!ok) return;
          this.careerRace = mode === 'career';
          this.startRace(mode === 'career' ? 'race' : mode, this.sessionSetup(s));
        });
      },
      careerForecast: (id) => this.careerForecast(id),
      onCareerRace: (id) => void this.goCareerRound(id),
      onSettings: (s) => this.applySettings(s),
      onResume: () => this.resume(),
      onRestart: () => (this.spectating && this.simCfg ? void this.startSimulation(this.simCfg) : this.startRace(this.mode, this.sessionSetup(this.menu.setup))),
      onQuit: () => this.toMenu(),
      onResetCar: () => {
        this.resume();
        this.resetPlayer();
      },
      onUi: (k) => this.audioReady && this.audio.ui(k),
      onHubTab: (t) => {
        this.hubTab = t;
        this.garageOrbit.active = false;
        if (this.tour.at) this.tourExit();
        if (t === 'career' || t === 'race') this.garage?.refreshStats();
      },
      onFocusPart: (p) => (this.focusPart = p),
      onPlayHighlight: (id) => this.garage?.playHighlight(id),
      nowPlaying: () => this.garage?.current?.id ?? null,
      tourNav: (nav) => this.tourNav(nav),
      onCarChange: () => this.refreshPlayerRig(),
      onTravel: (id) => void this.travel(id),
      driverCareer: () => this.dc,
      onCareerStart: (driver, contract) => this.startDriverCareer(driver, contract),
      onCareerChanged: () => {
        // (a signature that starts the next season: other series or team, maybe another first round)
        if (this.syncCareerGrid()) void this.travel(this.dc.nextTrack ?? this.track.def.id, true);
      },
      onSpectate: () => this.openSimSetup(),
      // (UI only) the session at a glance on the pause screen
      pauseInfo: () => {
        const r = this.race;
        const p = r.player;
        const laps = r.opts.laps;
        const stats: [string, string][] = this.spectating
          ? [['Lap', `${Math.max(1, Math.min(laps, r.leaderLaps + 1))}/${laps}`], ['Weather', WEATHER_LABEL[r.weatherState.kind]]]
          : [
              ['Position', r.isTimeTrial ? 'TT' : `P${p.position}`],
              ['Lap', r.isTimeTrial ? String(Math.max(1, p.laps + 1)) : `${Math.max(1, Math.min(laps, p.laps + 1))}/${laps}`],
              ['Best lap', fmtTime(p.bestLap)],
              ['Weather', WEATHER_LABEL[r.weatherState.kind]],
            ];
        return { title: this.track.def.name, kind: this.spectating ? 'Simulated race' : r.isTimeTrial ? 'Time trial' : this.quali ? 'Qualifying' : 'Race', stats };
      },
    }, this.career);
    this.simSetup = new SimSetup(this.menu.root, {
      onStart: (cfg) => void this.startSimulation(cfg),
      onBack: () => {
        this.simSetup.hide();
        this.menu.show('title');
      },
      onUi: (k) => this.audioReady && this.audio.ui(k),
      currentTrack: () => this.track?.def.id ?? '',
    });
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

  /** boot timeline (ms since boot start, per step) — dev readout */
  bootSteps: Record<string, number> = {};
  async boot(progress: (f: number, step: string) => void) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    const mark = (k: string) => (this.bootSteps[k] = Math.round(performance.now() - t0));
    progress(0.02, 'Surveying the circuit');
    // the downloads and decodes (main.ts started them before the Game was made; these pick up the
    // same promises): the people (~13 MB over the network, the core ~6 MB waited for), the liveries
    // and atlases painted on an earlier visit (read + decoded off the main thread), the scanned road
    // surface, the brand fonts. Nothing waits on them up front: buildWorld awaits each just before
    // the step that uses it, so its CPU work (the track survey first) overlaps them.
    const people = loadPeople().catch((e) => console.warn('people failed to load', e));
    const pixels = preloadPixels();
    const asphalt = loadAsphaltScan();
    const fonts = Promise.all(BRAND_FONTS.map((f) => document.fonts.load(f))).then(
      () => void mark('fonts'),
      () => undefined /* fallback fonts are fine */,
    );
    void Promise.all([pixels, asphalt]).then(() => mark('pixels'));
    this.applySettings(this.menu.settings);
    // the career's grid (Formula 2 or 1, the player's driver in their seat) before any car or pit garage is built
    this.syncCareerGrid();
    Career.extraUnlocked = (id) => this.dc.visited(id);
    this.rollWeather(this.menu.setup);

    setCarAORenderer(this.gfx.renderer);
    // ?track=<id> (dev/demo links) overrides the saved choice
    // (the garage opens at the circuit you race next: the career's next round, the newest unlocked)
    const unlocked = this.career.unlockedCircuits();
    const next = this.dc.nextTrack ?? this.career.nextRound() ?? unlocked[unlocked.length - 1]?.id ?? this.menu.setup.track;
    const want = new URLSearchParams(location.search).get('track') ?? next;
    await this.buildWorld(
      CIRCUITS.find((c) => c.id === want) ?? MONZA,
      async (f, step) => {
        progress(0.06 + f * 0.56, step);
        await tick();
      },
      { people, signs: fonts, ground: asphalt, pixels },
    );

    mark('world');
    // every light the garage frame will have, before anything is compiled (light counts are part of
    // every program's key) …
    this.scene.add(this.particles.group);
    this.scene.add(this.headlights.group);
    this.buildGarageLights();
    // … then the world's programs, garage-lit, queued now: the driver builds them on its own threads
    // (KHR_parallel_shader_compile) while the cars are made below
    this.garageLights.visible = true;
    const worldPrograms = this.compileQueued(this.scene);
    this.garageLights.visible = false;
    progress(0.62, 'Rolling out the cars');
    await preloadCarAssets();
    this.scene.add(this.carsGroup);
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const rig = createCar(e.team, e.driver, e.seat, { envMap: this.scene.environment ?? undefined });
      this.rigs.set(e, rig);
      this.rigTeam.set(e, e.team.id);
      this.rigDriverKey.set(e, driverKey(e));
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
    mark('cars');
    this.particles.setLight(smokeLight(new Weather(this.plan).state));
    this.menu.highlights = this.highlights;
    this.highlights.onChange(() => {
      if (this.state === 'menu' && this.hubTab === 'highlights') this.menu.refreshTab();
    });
    // the highlights re-film finished races offscreen (career/clip/studio.ts): what they may use of the world
    this.highlights.attach({
      gfx: this.gfx,
      scene: this.scene,
      trackId: () => (this.worldBusy || !this.track ? null : this.track.def.id),
      world: () => (this.worldBusy || !this.env ? null : { track: this.track, env: this.env, trackside: this.trackside, pits: this.pits }),
      liveObjects: () => [this.carsGroup, this.garage?.group, this.garageLights, this.particles.group, this.headlights.group, this.celebration?.group, this.line?.mesh, this.debris?.group],
      rigKey: (e) => this.rigTeam.get(e) ?? e.team.id,
      makeRig: (e) => {
        const painted = (this.rigTeam.get(e) ?? e.team.id) !== e.team.id;
        const team = painted ? Career.painted(e.team, this.career.paintFor(TEAMS.indexOf(e.team))) : e.team;
        return createCar(team, e.driver, e.seat, { envMap: this.scene.environment ?? undefined });
      },
    });
    this.bindGarageInput();
    this.finishWorld();
    mark('finish');

    progress(0.9, 'Opening the garage');
    await tick();
    this.toMenu();
    await this.warmGarage(worldPrograms);
    mark('menu');
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
        // (highlight production: after the frame, outside its GPU timing; paused while racing)
        this.highlights.tick(dt, this.state);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // the garage is up: the landscape, the stands and the race's shaders follow behind it
    void this.completeWorldInBackground().then(() => mark('warm'));
  }

  // ------------------------------------------------------------------ the driver career's grid

  /**
   * Put the career's grid on track: its series (Formula 2 or 1) and the player's driver in their seat
   * (the menu's team/seat follow). Returns true when names, colours or helmets changed — the cars are
   * then repainted, and the pit garages need the circuit rebuilt.
   */
  private syncCareerGrid(): boolean {
    const d = this.dc.data;
    let changed: boolean;
    if (d) {
      const ti = careerTeamIndex(d.series, d.contract.team);
      changed = applyGrid(d.series, d.driver, ti, d.contract.seat, { market: d.market, dev: this.dc.devMap() });
      this.menu.setup.team = ti;
      this.menu.setup.seat = d.contract.seat;
    } else changed = applyGrid('f1', null, 0, 0);
    if (changed && this.rigs.size) this.refreshPlayerRig();
    return changed;
  }
  /**
   * The player's car. A driver career's round: the set-up on the car the team built — a backmarker's
   * is down on power and downforce against a front-runner's — plus the parts the R&D has bought.
   * Otherwise the garage's own car (bought upgrades + set-up).
   */
  private playerSpec(team: Team): CarSpec {
    if (!(this.careerRace && this.dc.active)) return this.career.spec();
    const s = this.career.setupSpec();
    const f = this.dc.carFactors(team.pace);
    s.power *= f.power;
    s.clA *= f.clA;
    s.mu *= f.mu;
    s.ersBoost *= f.ers;
    return s;
  }
  /** a new driver career from the menu's wizard: its grid, then to its first round */
  private startDriverCareer(driver: PlayerDriver, contract: Contract) {
    this.dc.start(driver, contract);
    const regrid = this.syncCareerGrid();
    const first = this.dc.nextTrack ?? this.track.def.id;
    this.menu.setup.track = first;
    if (first !== this.track.def.id || regrid) void this.travel(first, true);
    else this.toMenu();
  }

  // ------------------------------------------------------------------ the rest of the world, behind the garage

  /** bumped on every world switch: a background build of an older world stops at its next slice */
  private worldGen = 0;
  private worldDone: Promise<void> = Promise.resolve();
  /** 0 … 1 of the background build (1 = the circuit is complete and its race shaders are ready) */
  worldProgress = 1;
  /** resolves when the current circuit is complete (landscape, broadcast cameras, race shaders) */
  whenWorld(): Promise<void> {
    return this.worldDone;
  }
  private completeWorldInBackground(): Promise<void> {
    const gen = ++this.worldGen;
    this.worldProgress = 0;
    this.worldDone = this.completeWorld(gen).catch((e) => {
      console.error('[world] background build failed', e);
      this.worldProgress = 1;
    });
    return this.worldDone;
  }
  /**
   * The costly half of a circuit — terrain, woods, grass, grandstands and crowds, villages, the
   * skyline — built one slice per frame while the garage is up, then swapped in for the stand-in
   * ground; the broadcast cameras re-sited on the real landscape; every race shader compiled.
   */
  private async completeWorld(gen: number) {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const t0 = performance.now();
    let busy = 0;
    // (wall time per phase, for the dev readout: worldTimes.bg*)
    const phase: Record<string, number> = {};
    let tPhase = t0;
    const lap = (k: string) => {
      const n = performance.now();
      phase[k] = Math.round(n - tPhase);
      tPhase = n;
    };
    // the rest of the avatars keep downloading while the landscape is built
    const kit = peopleKit();
    const everyone = kit ? Promise.race([kit.whenAll, new Promise((r) => setTimeout(r, 20000))]) : Promise.resolve();
    const it = sceneryBuilder(this.track, this.gfx);
    let partial: THREE.Group | null = null;
    let scenery: Scenery | null = null;
    const SLICES = 10;
    for (let n = 0; ; n++) {
      await frame();
      if (gen !== this.worldGen) {
        if (partial) disposeTree(partial);
        return;
      }
      const ts = performance.now();
      const r = it.next();
      busy += performance.now() - ts;
      if (r.done) {
        scenery = r.value;
        break;
      }
      partial = r.value.group;
      this.worldProgress = 0.75 * Math.min(1, (n + 1) / SLICES);
    }
    lap('bgScenery');
    // the landscape's programs queued before it is adopted, lit as its reflection capture and the
    // race see it (sun and sky, the garage's work lights out): built on the driver's threads while
    // the garage keeps drawing, where the capture would build them one by one, blocking
    const lit0 = this.garageLights.visible;
    this.garageLights.visible = false;
    const landscape = this.compileQueued(scenery.group, this.scene);
    this.garageLights.visible = lit0;
    await landscape;
    lap('bgShaders');
    await frame();
    if (gen !== this.worldGen) {
      disposeTree(scenery.group);
      return;
    }
    let ts = performance.now();
    // (the garage's work lights stay out of the reflection capture)
    const lit = this.garageLights.visible;
    this.garageLights.visible = false;
    this.env.adoptScenery(scenery);
    this.garageLights.visible = lit;
    if (this.leanOn) this.env.setLean(true);
    busy += performance.now() - ts;
    lap('bgAdopt');
    this.worldProgress = 0.82;
    await frame();
    if (gen !== this.worldGen) return;
    ts = performance.now();
    const sight = await this.sightlines();
    if (gen !== this.worldGen) return;
    this.placeBroadcastCameras(sight);
    busy += performance.now() - ts;
    lap('bgCameras');
    this.worldProgress = 0.88;
    await frame();
    if (gen !== this.worldGen) return;
    // every pit crew (people, wheels, guns, jacks), so nothing is built mid-race: a team at a time,
    // as many as fit in ~10 ms before the next garage frame
    for (let n = 0; n < 40; n++) {
      ts = performance.now();
      let done = false;
      do done = this.pits.prebuildNext?.() ?? true;
      while (!done && performance.now() - ts < 10);
      busy += performance.now() - ts;
      if (done) break;
      await frame();
      if (gen !== this.worldGen) return;
    }
    lap('bgCrews');
    // everyone, not just the first few: marshals, photographers, the paddock and the fans on the
    // concourses are built from the full set, and would otherwise pop in mid-race
    await everyone;
    lap('bgPeople');
    await frame();
    if (gen !== this.worldGen) return;
    ts = performance.now();
    await this.warmUp(gen);
    busy += performance.now() - ts;
    if (gen !== this.worldGen) return;
    lap('bgWarm');
    this.worldProgress = 1;
    Object.assign(this.worldTimes, phase);
    this.worldTimes.background = Math.round(busy);
    this.worldTimes.backgroundWall = Math.round(performance.now() - t0);
    console.info(`[shot] [world] ${this.track.def.id} complete behind the garage: ${Math.round(busy)} ms of work over ${Math.round(performance.now() - t0)} ms`);
  }

  /**
   * The broadcast cameras, placed with what they can see (`sight`: the occupancy grid of the whole
   * world, see sightlines()) — or, before the landscape exists, along the track alone (only the
   * garage is up then: completeWorld places them again before any session can start).
   */
  private placeBroadcastCameras(sight: Sightlines | null) {
    const mode = this.cams?.mode;
    const prefs = this.cams?.prefs;
    this.cams = new Cameras(this.camera, this.track, sight);
    this.cams.prefs = prefs ?? { ...DEFAULT_CAM, ...(this.menu.settings.cam ?? {}) };
    if (sight) console.info(`[shot] [sightlines] ${this.track.def.id} grid ${sight.buildMs} ms${sight.fromCache ? ' (cached)' : ''}, cameras ${this.cams.placeMs} ms ${JSON.stringify(sight.stats)} tv ${this.cams.tvCount}`);
    if (mode) this.cams.mode = mode;
  }

  /**
   * The occupancy grid of the whole world (trackside, pit complex, landscape) for the broadcast
   * cameras. The same for every visit to a circuit with a given build, so it is kept in IndexedDB
   * (pixelCache loadData/keepData) under a fingerprint of the geometry it is made from — anything
   * that changes the world (a new build, a different circuit, other meshes) misses and rebuilds.
   */
  private async sightlines(): Promise<Sightlines | null> {
    const t0 = performance.now();
    const roots = [this.trackside.group, this.pits.group, this.env.group];
    // (instance counts are left out: a few instanced sets — people about the place — vary from visit
    // to visit, and so would the grid built from any one moment of them)
    let meshes = 0, verts = 0;
    for (const r of roots)
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
        if (!mat || mat.visible === false || mat.depthWrite === false) return;
        meshes++;
        verts += m.geometry?.attributes.position?.count ?? 0;
      });
    const key = pixelKey('sightlines', this.track.def.id, meshes, verts);
    const t1 = performance.now();
    const cached = await loadData(key);
    this.worldTimes.sightKey = Math.round(t1 - t0);
    this.worldTimes.sightRead = Math.round(performance.now() - t1);
    try {
      const sight = new Sightlines(this.track, (x, z) => this.env.heightAt(x, z), roots, cached);
      this.worldTimes.sightGrid = sight.buildMs;
      if (!sight.fromCache) keepData(key, sight.toBytes());
      return sight;
    } catch (e) {
      console.warn('[sightlines] failed', e);
      return null;
    }
  }

  /**
   * The garage's shaders, all queued at once before its first frame (with `queued`, programs queued
   * earlier), then that frame once the driver has built them: with KHR_parallel_shader_compile it
   * builds them on its own threads and the main thread stays free, where a plain compile + render
   * would block on each program in turn. (The shadow maps' depth programs are built by the frame.)
   */
  private async warmGarage(queued?: Promise<unknown>) {
    this.garageFrame(0.016);
    this.garageLights.visible = true;
    await Promise.all([queued, this.compileQueued(this.scene)]);
    this.gfx.render(0.016);
  }

  /** a 1 × 1 linear target: programs compiled with it bound get the post chain's keys */
  private linearRT: THREE.WebGLRenderTarget | null = null;
  /**
   * Queue the programs `obj` needs (lit by `lights`' lights, as drawn by the camera into the post
   * chain's linear targets — never straight to the canvas, so that's the key to compile for) and
   * resolve once the driver has built them (at most `cap` ms: a driver that never says leaves the
   * rest to the first frame). Nothing blocks: the compile runs on the driver's threads.
   */
  private compileQueued(obj: THREE.Object3D, lights: THREE.Object3D | null = null, cap = 20000): Promise<unknown> {
    const r = this.gfx.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget((this.linearRT ??= new THREE.WebGLRenderTarget(1, 1)));
    try {
      const done = r.compileAsync(obj, this.camera, lights as THREE.Scene | null);
      return Promise.race([done, new Promise((res) => setTimeout(res, cap))]);
    } catch (e) {
      console.warn('[shaders] compile failed', e);
      return Promise.resolve();
    } finally {
      r.setRenderTarget(prev);
    }
  }

  /**
   * Run `go` once the circuit is complete. Usually it already is; if the player is quicker than the
   * build, a small card shows how far along it is (and Esc/back gives up waiting).
   */
  private async worldReady(): Promise<boolean> {
    // (a circuit picked in the calendar a moment ago: go there first)
    if (this.travelTimer) {
      clearTimeout(this.travelTimer);
      this.travelTimer = 0;
    }
    if (this.menu.setup.track !== this.track.def.id) await this.travel(this.menu.setup.track);
    if (this.travelling) await this.travelling;
    if (this.worldProgress >= 1) return true;
    const gen = this.worldGen;
    const card = document.createElement('div');
    card.className = 'world-wait';
    card.innerHTML = `<span>Finishing</span><b>${this.track.def.name}</b><div class="ww-bar"><i></i></div>`;
    document.body.appendChild(card);
    const bar = card.querySelector('i') as HTMLElement;
    requestAnimationFrame(() => card.classList.add('on'));
    const tick = () => {
      if (!card.isConnected) return;
      bar.style.transform = `scaleX(${this.worldProgress.toFixed(3)})`;
      requestAnimationFrame(tick);
    };
    tick();
    await this.worldDone;
    card.classList.remove('on');
    setTimeout(() => card.remove(), 400);
    return gen === this.worldGen && this.worldProgress >= 1 && this.state === 'menu';
  }
  /** a quick-race circuit picked in the calendar: the garage moves there once the pick settles */
  private travelTimer = 0;
  /** the garage's status chip while the circuit grows behind it */
  private worldChip: HTMLElement | null = null;
  private updateWorldChip() {
    const show = this.state === 'menu' && !this.worldBusy && this.worldProgress < 1 && this.menu.screen !== 'none';
    if (!this.worldChip) {
      if (!show) return;
      const c = document.createElement('div');
      c.className = 'world-chip';
      c.innerHTML = '<span class="wc-ring"></span><span class="wc-text"></span>';
      document.body.appendChild(c);
      this.worldChip = c;
    }
    const c = this.worldChip;
    c.classList.toggle('on', show);
    if (show) {
      c.style.setProperty('--p', this.worldProgress.toFixed(3));
      const t = c.querySelector('.wc-text') as HTMLElement;
      const label = `Building ${this.track.def.name}`;
      if (t.textContent !== label) t.textContent = label;
    }
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
  private async buildWorld(
    def: CircuitDef,
    step: (f: number, label: string) => Promise<void>,
    /** the boot's downloads, each awaited just before the step that needs it (a circuit switch has them all) */
    wait: { people?: Promise<unknown>; signs?: Promise<unknown>; ground?: Promise<unknown>; pixels?: Promise<unknown> } = {},
  ) {
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

    // (the pit complex before the trackside — they don't depend on each other — so the ground
    // textures, made off the main thread, have its build time to arrive in)
    await step(0.14, 'Opening the pit lane');
    // (the fonts its boards are lettered in)
    await wait.signs;
    lap('fonts');
    this.pits = buildPitComplex(this.track, this.gfx);
    this.scene.add(this.pits.group);
    lap('pits');

    await step(0.3, 'Laying asphalt, kerbs and barriers');
    // (the road scan and the ground textures)
    await wait.ground;
    lap('ground');
    this.trackside = buildTrackside(this.track, this.gfx);
    this.scene.add(this.trackside.group);
    lap('trackside');

    if (wait.people) {
      // the uniforms and faces (the garage's people); the fans' avatars and the pit crews follow
      // behind the garage (completeWorld), before any session can start
      await step(0.36, 'Getting the people in');
      await wait.people;
      lap('people');
    }
    // the liveries and atlases from an earlier visit (the cars, the trees) are read back by now
    if (wait.pixels) {
      await wait.pixels;
      lap('pixels');
    }

    await step(0.4, 'Setting up the sky');
    const w0 = new Weather(this.plan).state;
    applyWeatherUniforms(w0);
    // (the landscape itself grows behind the garage afterwards: completeWorld)
    this.env = createEnvironment(this.track, this.gfx, this.scene, w0, { scenery: false });
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
    // (along the track alone: placed again with their sight lines over the real landscape once it
    // exists — completeWorld — before any session can start)
    this.placeBroadcastCameras(null);
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
   * Compile the shader variants of both lighting set-ups up front (menu garage, race). Both are
   * queued at once and awaited without blocking: with KHR_parallel_shader_compile the driver builds
   * them on its own threads while the menu is up, so the first race frame and the first fast lap
   * (speed blur) find their programs ready. (The podium's are built when a race ends.)
   */
  private async warmUp(gen: number) {
    const r = this.gfx.renderer;
    const warm: number[] = [];
    let t = performance.now();
    const lap = () => {
      warm.push(Math.round(performance.now() - t));
      t = performance.now();
    };
    const menu = this.state === 'menu';
    // the lazily built sets (trackside people, strollers, the paddock) build on their first update
    this.env.update(0, this.camera);
    this.trackside.update(0, this.camera);
    this.pits.update(0, this.camera);
    // the pit crews are hidden until the camera nears them: show them all for the compile + first render
    this.pits.warm?.(true);
    // and so is much else until the camera comes near (levels of detail, far people, distant crowds):
    // unhide the world for the compile, so nothing first appears — or compiles — mid-race
    const keepHidden = new Set<THREE.Object3D>([this.garageLights]);
    const findHidden = () => {
      const out: THREE.Object3D[] = [];
      this.scene.traverse((o) => {
        if (!o.visible && !keepHidden.has(o) && !(o as THREE.Light).isLight) out.push(o);
      });
      return out;
    };
    let hidden = findHidden();
    // every texture onto the GPU now (not on the frame something first shows it)
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
        const u = (m as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) if ((u[k]?.value as THREE.Texture)?.isTexture) textures.add(u[k].value as THREE.Texture);
      }
    });
    for (const t of textures) {
      try {
        if (!(t as THREE.VideoTexture).isVideoTexture && !(t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) r.initTexture(t);
      } catch {
        /* a texture whose image isn't ready yet uploads when it is */
      }
    }
    // every lighting set-up's programs queued at once (compileQueued: for the post chain's linear
    // targets, built on the driver's threads), then awaited without blocking — the garage keeps
    // drawing meanwhile (its own programs are built already)
    const queued: Promise<unknown>[] = [];
    const progs = [r.info.programs?.length ?? 0];
    // the menu: the garage and its work lights
    this.garageFrame(0.016);
    this.garageLights.visible = true;
    if (this.garage) this.garage.group.visible = true;
    queued.push(this.compileQueued(this.scene));
    progs.push(r.info.programs?.length ?? 0);
    // racing: sun and sky only — with everything the camera may meet out on the lap shown
    this.garageLights.visible = false;
    if (this.garage) this.garage.group.visible = false;
    for (const o of hidden) o.visible = true;
    queued.push(this.compileQueued(this.scene));
    progs.push(r.info.programs?.length ?? 0);
    this.warmPrograms = progs;
    for (const o of hidden) o.visible = false;
    // (the podium's lighting — one more spot light, so every program again — is compiled when the
    // race is over: startCelebration)
    // (the garage as it was while the driver works: the crews only drawn for the warm frame below)
    this.garageLights.visible = menu;
    if (this.garage) this.garage.group.visible = menu;
    this.pits.warm?.(false);
    await Promise.all(queued);
    if (gen !== this.worldGen) return;
    this.pits.warm?.(true);
    // (the garage frames since may have switched levels of detail: what is hidden now)
    hidden = findHidden();
    const garageVis = this.garage?.group.visible ?? false;
    this.garageLights.visible = false;
    if (this.garage) this.garage.group.visible = false;
    // one real frame in race lighting: the shadow-map depth programs (light counts are part of their
    // key, so the menu's garage-lit frame doesn't build them) and the first uploads — of everything,
    // hidden levels of detail included (a buffer uploaded mid-race is a dropped frame)
    for (const o of hidden) o.visible = true;
    this.gfx.render(0.016);
    for (const o of hidden) o.visible = false;
    lap();
    this.garageLights.visible = menu;
    if (this.garage) this.garage.group.visible = garageVis;
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
  /** shader programs before / after each of warmUp's compile passes (garage, race) — dev readout */
  warmPrograms: number[] = [];

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
      // the weekend's driver form (qualifying and the race agree); everything else is fresh each session
      formSeed: this.weekendSeed,
      playerEntry,
      playerGrid: GRID[setup.grid].slot,
      entries: this.entries,
      playerCompound: setup.compound,
      gridOrder: this.gridOrder ?? undefined,
      weather: this.plan,
      damage: setup.damage,
      playerSpec: seriesSpec(this.playerSpec(team)),
      // the rivals develop their cars through the season too (in a driver career: through their pace)
      aiSpec: seriesSpec(this.careerRace && this.dc.active ? { ...F1_SPEC, gears: F1_SPEC.gears.slice() } : this.career.rivalSpec()),
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
    // (the last race's recording is still being made into highlights: record into a new one)
    if (this.highlights.owns(this.replay)) this.replay = new ReplayBuffer();
    this.replay.reset(this.race);
    this.flash.reset();
    this.flashbacksUsed = 0;
    return this.race;
  }

  /** a career round's forecast (kept until it has been raced) */
  private careerForecast(id: string): Forecast {
    let f = this.careerFc.get(id);
    if (!f) {
      f = rollForecast(id, this.lastFc.get(id));
      this.careerFc.set(id, f);
    }
    return f;
  }
  /** the setup this session actually runs: a career round fixes the distance and takes the circuit's weather */
  private sessionSetup(s: RaceSetup): RaceSetup {
    if (!this.careerRace) return s;
    const f = this.careerForecast(this.track.def.id);
    return { ...s, laps: this.dc.active ? this.dc.laps : CAREER_LAPS, weather: f.weather, time: f.time };
  }
  /** on to a career round: travel there if it's another circuit, then its race screen */
  private async goCareerRound(id: string) {
    if (this.dc.active ? id !== this.dc.nextTrack : !this.career.isUnlocked(id)) return;
    // (a new season may have changed the grid: other series, other team)
    const regrid = this.syncCareerGrid();
    if (id !== this.track.def.id || regrid) await this.travel(id, regrid);
    else if (this.state !== 'menu') this.toMenu();
    if (this.track.def.id !== id) return;
    this.menu.showCareerSetup();
  }

  /** roll a new forecast for the setup's weather/time choices */
  private weekendSeed = (Math.random() * 2 ** 31) | 0;
  /** the forecast hasn't been raced yet (the garage shows it; the next session uses it, later ones roll again) */
  private planFresh = false;
  private rollWeather(setup: RaceSetup) {
    const laps = setup.laps;
    // a different sky from the last race's (Random only: a fixed choice is a fixed choice)
    const last = this.plan;
    for (let i = 0; i < 8; i++) {
      this.plan = planWeather(setup.weather, setup.time, laps * 85 + 60);
      const skyNew = setup.weather !== 'random' || this.plan.start !== last?.start || this.plan.end !== last?.end;
      const lightNew = setup.time !== 'random' || this.plan.time !== last?.time;
      if (!last || (skyNew && lightNew)) break;
    }
    this.planFresh = true;
    // a new weekend: new form for every driver
    this.weekendSeed = (Math.random() * 2 ** 31) | 0;
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
    this.hideIntroCard(true);
    this.hud.root.classList.remove('intro-hide');
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
    // a different circuit means a different world: the garage moves there once the pick settles
    // (scrolling down the calendar doesn't rebuild every circuit on the way)
    if (this.travelTimer) {
      clearTimeout(this.travelTimer);
      this.travelTimer = 0;
    }
    if (s.track !== this.track.def.id) {
      this.travelTimer = window.setTimeout(() => {
        this.travelTimer = 0;
        if (this.state === 'menu' && this.menu.setup.track !== this.track.def.id) void this.travel(this.menu.setup.track);
      }, 700);
      return;
    }
    if (`${s.weather}/${s.time}` !== this.planKey) this.rollWeather(s);
    this.makeRace('race', s);
  }

  private applySettings(s: Settings) {
    if (s.quality !== this.gfx.qualityLevel) {
      this.gfx.setQuality(s.quality);
      this.leanOn = false;
    }
    this.particles.resolution = { low: 0.35, medium: 0.4, high: 0.5, ultra: 0.6 }[s.quality];
    if (this.cams) this.cams.prefs = { ...DEFAULT_CAM, ...(s.cam ?? {}) };
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
    const times = this.entries.map((e) => ({ entry: e, time: e === player ? (valid ? time : Infinity) : this.race.qualifyingTime(e, diff, wf, this.trackLapScale()) }));
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

  // ------------------------------------------------------------------ race intro
  /** this session opens with the full intro (a race from the garage, not a restart mid-weekend) */
  private introLong = false;
  private introSkip = false;
  private introCard: HTMLDivElement | null = null;

  /** the title card: round, circuit, distance and conditions, the layout drawing itself */
  private showIntroCard() {
    this.hideIntroCard(true);
    const d = this.track.def;
    const info = CIRCUIT_INFO[d.id];
    const i = CIRCUITS.findIndex((c) => c.id === d.id);
    const w = this.race.weatherState;
    const card = document.createElement('div');
    card.className = 'race-intro';
    const path = d.centerline ? circuitPath(d.centerline.points, 200, 140, 8) : '';
    const kicker = this.careerRace ? `Career · Round ${String(i + 1).padStart(2, '0')}` : 'Grand Prix';
    card.innerHTML =
      `<svg class="ri-map" viewBox="0 0 200 140"><path d="${path}"/></svg>` +
      `<div class="ri-text"><div class="ri-kick">${kicker}</div><div class="ri-name">${d.name}</div>` +
      `<div class="ri-facts"><span>${info?.country ?? d.country}</span><span>${this.race.opts.laps} laps</span><span>${WEATHER_LABEL[w.kind]}</span><span>${TIME_LABEL[this.plan.time]}</span></div></div>`;
    card.addEventListener('click', () => (this.introSkip = true));
    (this.hud.root.parentElement ?? document.body).appendChild(card);
    requestAnimationFrame(() => card.classList.add('on'));
    this.introCard = card;
  }
  /** `now`: gone this instant, and the director's film with it (a new session, the pause menu, leaving) */
  private hideIntroCard(now = false) {
    if (now) this.endIntroFilm();
    const c = this.introCard;
    if (!c) return;
    this.introCard = null;
    if (now) return c.remove();
    c.classList.remove('on');
    c.classList.add('off');
    setTimeout(() => c.remove(), 700);
  }

  /** the full intro's director (IntroDirector: the shot list), built on its first frame — the cars are on the grid by then */
  private introDirector: IntroDirector | null = null;
  /** dev/tools: hold the intro clock at this time (−1: let it run) — tools/introshot.mjs */
  introHold = -1;
  /** the director has the lens (the player's own camera waits in introCamMode) */
  private introFilming = false;
  private introCamMode: CameraMode | null = null;
  private introShotIndex = -1;
  /** the last filmed frame, which the race camera blends out of at the drop */
  private introFrom: { pos: THREE.Vector3; q: THREE.Quaternion; fov: number } | null = null;
  /** letterbox, fade from black and the lower-third captions */
  private introFilm: HTMLDivElement | null = null;
  private introCaptionKey = '';
  private introHazeOn = false;
  /** while the director films: where the shadows and the rain centre (null: on your car) */
  private introFocus: THREE.Vector3 | null = null;
  private readonly introFocusPt = new THREE.Vector3();
  /** the drop from the last shot into the race camera (s) */
  private static readonly INTRO_DROP = 1.1;

  private makeIntroDirector(): IntroDirector {
    const race = this.race;
    const player = race.player;
    // cars[] is in grid order: the pole sitter — or P2, when that's you (you get the next shot)
    const pole = race.cars[0] === player ? (race.cars[1] ?? player) : race.cars[0];
    const name = (c: Competitor) => `${c.entry.driver.first} ${c.entry.driver.last}`;
    const grid = race.cars.indexOf(player) + 1;
    const t0 = performance.now();
    const d = new IntroDirector({
      track: this.track,
      sight: this.cams.sight,
      heightAt: (x, z) => this.env.heightAt(x, z),
      scene: this.scene,
      headlights: floodlit(race.weatherState.time) > 0,
      dark: race.weatherState.time === 'night',
      cars: {
        pole: { s: pole.car.s, lateral: pole.car.lateral, caption: { kick: pole === race.cars[0] ? 'Pole position' : 'Front row', title: name(pole), sub: pole.entry.team.name } },
        player: { s: player.car.s, lateral: player.car.lateral, caption: { kick: `Starting P${grid}`, title: name(player), sub: player.entry.team.name } },
      },
    });
    console.info(`[intro] ${this.track.def.id} ${d.length.toFixed(1)} s, planned in ${(performance.now() - t0).toFixed(1)} ms · ${d.report.join(' · ')}`);
    return d;
  }

  /** the letterbox (and its fade from black and captions) over the full intro */
  private showFilm(on: boolean) {
    if (on && !this.introFilm) {
      const el = document.createElement('div');
      el.className = 'intro-film';
      el.innerHTML =
        '<div class="if-bar if-top"></div><div class="if-bar if-bot"></div>' +
        '<div class="if-lower"><div class="if-kick"></div><div class="if-title"></div><div class="if-sub"></div></div>' +
        '<div class="if-skip"><kbd>Enter</kbd> skip</div><div class="if-fade"></div>';
      el.addEventListener('click', () => (this.introSkip = true));
      (this.hud.root.parentElement ?? document.body).appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));
      this.introFilm = el;
    } else if (!on && this.introFilm) {
      const el = this.introFilm;
      this.introFilm = null;
      this.introCaptionKey = '';
      el.classList.remove('on');
      el.classList.add('off');
      setTimeout(() => el.remove(), 900);
    }
  }

  /** the lower third: who / what we're looking at */
  private filmCaption(c: IntroCaption | null) {
    const el = this.introFilm;
    if (!el) return;
    const key = c ? `${c.kick}|${c.title}` : '';
    if (key === this.introCaptionKey) return;
    this.introCaptionKey = key;
    const low = el.querySelector<HTMLElement>('.if-lower')!;
    low.classList.remove('show');
    if (!c) return;
    low.querySelector('.if-kick')!.textContent = c.kick;
    low.querySelector('.if-title')!.textContent = c.title;
    low.querySelector('.if-sub')!.textContent = c.sub ?? '';
    void low.offsetWidth;
    low.classList.add('show');
  }

  /**
   * The long lens's heat haze: the day's own shimmer (Environment sets it from the heat, the sun
   * and a dry track), turned up through a telephoto. Only when there is some: no haze on a cold,
   * wet or dark day. (The Renderer's lens pass reads the uniform; its own `shimmer` stays the
   * weather's, so the next weather update and the end of the shot put it back.)
   */
  private introHaze(on: boolean) {
    const g = this.gfx as unknown as { shimmer?: number; lensRain?: { uniforms: Map<string, THREE.Uniform> } };
    const u = g.lensRain?.uniforms.get('shimmer');
    if (!u || g.shimmer === undefined) return;
    if (on && g.shimmer > 0.01) {
      u.value = Math.min(1, g.shimmer * 2.5 + 0.2);
      this.introHazeOn = true;
    } else if (this.introHazeOn) {
      u.value = g.shimmer;
      this.introHazeOn = false;
    }
  }

  /** one frame of the director's film at intro time t */
  private filmIntro(D: IntroDirector, t: number) {
    if (!this.introFilming) {
      this.introFilming = true;
      // (an aerial mode while the director has the lens: no racing line, no onboard grade or cockpit
      // hiding, the sound heard from where the camera is)
      if (this.cams.mode !== 'heli') {
        this.introCamMode = this.cams.mode;
        this.cams.set('heli');
      }
      this.hud.root.classList.add('intro-hide');
    }
    this.showFilm(true);
    const f = D.frame(t, this.camera);
    if (!f) return;
    if (f.index !== this.introShotIndex) {
      // a cut: nothing to smear between the last frame of one shot and the first of the next
      this.gfx.motionCut = true;
      this.introShotIndex = f.index;
    }
    // the title card stays over the establishing shot
    if (f.index >= 1) this.hideIntroCard();
    this.filmCaption(f.caption);
    if (f.dof) {
      this.gfx.setDepthOfField(true, f.dof.target, f.dof.range, f.dof.bokeh);
      this.introDof = true;
    } else if (this.introDof) {
      this.introDof = false;
      this.gfx.setDepthOfField(false);
    }
    this.introHaze(f.haze);
    this.introFocus = this.introFocusPt.copy(f.focus);
  }

  /** the director hands the lens back (the drop, a skip, the pause menu, leaving) */
  private endIntroFilm() {
    if (!this.introFilming) return;
    this.introFilming = false;
    this.introShotIndex = -1;
    if (this.introCamMode) {
      this.cams.set(this.introCamMode);
      this.introCamMode = null;
    }
    if (this.introDof) {
      this.introDof = false;
      this.gfx.setDepthOfField(false);
    }
    this.introHaze(false);
    this.introFocus = null;
    this.showFilm(false);
  }

  /**
   * The race intro. From the garage (or after qualifying): the director's film (IntroDirector —
   * establishing aerial, the venue, the stands, the pits, the kerbs, the long lens down the grid,
   * pole, your car), then the drop into your race camera and the lights. A restart: the short
   * version, a low orbit of your car on the grid. Both skippable.
   */
  private introFrame(dt: number, st: Game['input']['state']) {
    const race = this.race;
    race.playerInput.throttle = st.throttle;
    race.update(dt);
    if (st.pause) {
      this.syncAllViews(dt);
      this.pause();
      this.handleRaceEvents();
      return;
    }
    if (this.introHold >= 0) this.stateTime = this.introHold;
    if (this.introLong) {
      const D = (this.introDirector ??= this.makeIntroDirector());
      const FILM = D.length;
      const END = FILM + Game.INTRO_DROP;
      if (this.stateTime < END && ((this.input.nav.accept && this.stateTime > 0.35) || this.introSkip)) this.stateTime = END;
      this.introSkip = false;
      const t = this.stateTime;
      if (t < FILM) {
        this.filmIntro(D, t);
        this.syncAllViews(dt);
      } else {
        const k = (t - FILM) / Game.INTRO_DROP;
        if (this.introFilming) {
          // the drop: blend out of the last shot into the race camera (a hard cut into an onboard
          // camera, or after a skip)
          const mode = this.introCamMode ?? this.cams.mode;
          const cam = this.camera;
          this.introFrom = k < 1 && !ONBOARD[mode] ? { pos: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov } : null;
          this.endIntroFilm();
          this.hideIntroCard();
          this.hud.root.classList.remove('intro-hide');
          if (!this.introFrom) this.gfx.motionCut = true;
        }
        this.syncAllViews(dt);
        this.cams.update(dt, race.player.car, this.rigs.get(race.player.entry)!, this.track);
        const F = this.introFrom;
        if (F && k < 1) {
          const e = k * k * (3 - 2 * k);
          const cam = this.camera;
          cam.position.lerpVectors(F.pos, cam.position, e);
          cam.quaternion.slerpQuaternions(F.q, cam.quaternion, e);
          cam.fov = F.fov + (cam.fov - F.fov) * e;
          cam.updateProjectionMatrix();
        } else this.introFrom = null;
        if (t > END + 0.5 && race.phase === 'grid') race.startLights();
      }
    } else {
      // the short intro: the low sweep round your car, then your camera and the lights
      this.syncAllViews(dt);
      const IB = 6.8;
      const IC = 9.6;
      this.introSkip = false;
      const t0 = this.stateTime + IB;
      this.hud.root.classList.remove('intro-hide');
      this.hideIntroCard();
      if (t0 < IC) {
        const t = t0 - IB + 1.4;
        this.cams.orbit(dt, this.playerRigPos(), 8.2 - t * 0.55, 0.55 + t * 0.2, 0.34);
        // a real lens: the car sharp, the grid behind it soft
        this.gfx.setDepthOfField(true, this.dofTarget.copy(this.playerRigPos()).setY(this.dofTarget.y + 0.5), 7, 1.15);
        this.introDof = true;
      } else {
        if (this.introDof) {
          this.introDof = false;
          this.gfx.setDepthOfField(false);
        }
        this.cams.update(dt, race.player.car, this.rigs.get(race.player.entry)!, this.track);
        if (t0 > IC + 0.8 && race.phase === 'grid') race.startLights();
      }
    }
    if (race.phase === 'racing') {
      this.state = 'race';
      this.hud.setHint(null);
    }
    this.handleRaceEvents();
  }

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
    // every session gets its own weather and time of day: the forecast shown in the garage is used
    // once, and a restart / race again rolls a new one (qualifying and its race share the weekend's)
    const weekendRace = mode === 'race' && !!this.gridOrder;
    if (`${setup.weather}/${setup.time}` !== this.planKey || (!this.planFresh && !weekendRace)) this.rollWeather(setup);
    this.planFresh = false;
    // (a restart — the pause menu, race again — gets the short intro; a race from the garage or after
    // qualifying the director's full one)
    const restart = this.state === 'paused' || this.state === 'results' ? !!this.race && !this.race.isTimeTrial && this.race.track === this.track : false;
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
    this.introLong = mode === 'race' && !restart;
    this.introDirector = null;
    if (this.introLong) this.showIntroCard();
    else this.hideIntroCard(true);
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
    this.hideIntroCard(true);
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
    this.queueHighlights();
    const top = this.race.classification().slice(0, 3).map((r) => r.entry);
    if (top.length < 3 || this.race.isTimeTrial) return this.showResults();
    const cel = new Celebration(this.track, (x, z) => this.env.heightAt(x, z), top, this.hud.root.parentElement ?? document.body);
    // (perf) its shaders — the crowd, the stage, and the world under its extra spot light (the light
    // count is part of every program's key: ~80 programs warmUp no longer builds at boot) — compile on
    // the driver's threads while the race keeps running for a few more frames; then the ceremony
    // starts without a stall
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
    Promise.all([this.compileQueued(cel.group, this.scene), this.compileQueued(this.scene, cel.group)]).then(go, go);
  }
  private celebrationPending = false;
  private introDof = false;
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

  /** hand this session's recording over to the highlights, once: they are produced from it in the background */
  private queueHighlights() {
    const race = this.race;
    if (race.isTimeTrial || this.quali || this.highlights.owns(this.replay) || this.replay.duration < 20) return;
    const cls = race.classification();
    const me = cls.find((r) => r.isPlayer);
    this.highlights.queueRace({
      id: `${Date.now().toString(36)}-${this.track.def.id}`,
      replay: this.replay,
      track: this.track,
      trackId: this.track.def.id,
      trackName: this.track.def.name,
      trackShort: this.track.def.short,
      laps: race.opts.laps,
      playerId: race.player.id,
      spectating: this.spectating,
      cars: race.cars.map((c) => ({ id: c.id, entry: c.entry, code: c.entry.driver.code, first: c.entry.driver.first, last: c.entry.driver.last, color: uiColor(c.entry.team), compound: c.compound })),
      date: Date.now(),
      weather: { ...race.weatherState },
      result: me ? (me.dnf ? 'DNF' : `P${me.pos}`) : '',
      podium: cls.slice(0, 3).map((r) => r.entry.driver.last).join(' · '),
    });
  }

  private showResults() {
    this.hideIntroCard(true);
    this.hud.root.classList.remove('intro-hide');
    this.queueHighlights();
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
      reward = this.career.recordRace(this.track.def.id, me.pos, !!me.dnf, me.fastest && me.pos <= 10, TEAMS.indexOf(me.entry.team), rows.length, this.careerRace);
      // a new weekend here next time: the round's weather is rolled again
      if (this.careerRace) {
        const f = this.careerFc.get(this.track.def.id);
        if (f) this.lastFc.set(this.track.def.id, f);
        this.careerFc.delete(this.track.def.id);
      }
      // Steam achievements (no-ops on the website)
      unlockAchievement(ACH.FIRST_RACE);
      if (!me.dnf && me.pos <= 10) unlockAchievement(ACH.FIRST_POINTS);
      if (!me.dnf && me.pos <= 3) unlockAchievement(ACH.FIRST_PODIUM);
      if (!me.dnf && me.pos === 1) unlockAchievement(ACH.FIRST_WIN);
      if (me.fastest) unlockAchievement(ACH.FASTEST_LAP);
      if (!me.dnf && me.pos === 1 && me.fastest && this.gridOrder?.[0] === me.entry) unlockAchievement(ACH.GRAND_SLAM);
      const open = this.career.unlockedCircuits().length;
      if (open >= 5) unlockAchievement(ACH.UNLOCK_5);
      if (open >= CIRCUITS.length) unlockAchievement(ACH.SEASON_OPEN);
      if (this.career.medals().gold >= CIRCUITS.length) unlockAchievement(ACH.ALL_MEDALS);
      if (this.career.development() >= 1) unlockAchievement(ACH.FULL_DEV);
      // Dynamic AI: the rating learns from this race (lap pace and result)
      if (this.race.opts.dynamicAI) this.career.setAiSkill(this.race.rateAiSkill());
      this.lastReward = reward;
    } else if (!this.race.isTimeTrial) reward = this.lastReward;
    const again = () => (this.spectating && this.simCfg ? void this.startSimulation(this.simCfg) : this.startRace(this.mode, this.sessionSetup(this.menu.setup)));
    // a career round: straight on to the next one (new circuit, its own weather and light)
    let next: { label: string; go: () => void } | undefined;
    let careerSum: RoundSummary | null = null;
    if (this.careerRace && this.dc.active && !this.spectating && !this.race.isTimeTrial) {
      // the driver career: the round goes into the championship (once), then on to the next on its calendar
      if (reward) {
        const player = this.race.player.entry;
        careerSum = this.dc.recordRound(this.track.def.id, rows.map((r) => ({
          code: r.entry.driver.code,
          name: `${r.entry.driver.first} ${r.entry.driver.last}`,
          team: r.entry.team.name,
          teamId: r.entry.team.id,
          color: uiColor(r.entry.team),
          pos: r.pos,
          dnf: !!r.dnf,
          fastest: !!r.fastest,
          isPlayer: r.isPlayer,
          seatMate: r.entry.team === player.team && r.entry !== player,
        })));
      }
      const nt = this.dc.nextTrack;
      const nc = nt ? CIRCUITS.find((c) => c.id === nt) : null;
      if (nc) next = { label: this.dc.data!.round === 0 ? `New season · ${nc.short}` : `Next round · ${nc.short}`, go: () => void this.goCareerRound(nc.id) };
    } else if (this.careerRace && !this.spectating && !this.race.isTimeTrial) {
      const i = CIRCUITS.findIndex((c) => c.id === this.track.def.id);
      const nc = CIRCUITS[i + 1];
      if (nc && this.career.isUnlocked(nc.id)) next = { label: `Next round · ${nc.short}`, go: () => void this.goCareerRound(nc.id) };
    }
    this.menu.showResults(rows, title, this.spectating ? `Simulated race · ${lede}` : this.careerRace ? `Career round · ${lede}` : lede, again, () => this.toMenu(), () => this.startReplay(), careerSum ? null : reward, next, careerSum);
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
      if (this.simSetup.open) this.simSetup.update(this.input.nav);
      else this.menu.update(this.input.nav);
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
    this.updateWorldChip();
    if (this.state === 'menu') {
      race.update(dt);
      this.syncAllViews(dt);
      this.garageFrame(dt);
    } else if (this.state === 'intro') {
      this.introFrame(dt, st);
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
        // (the podium is filmed from the screen: from ~7 s before the trophy, which is the moment)
        if (place <= 3 && !this.race.player.retired && this.celebration.time > tTrophy - 6.8) {
          this.celMoment = true;
          this.highlights.moment(place === 1 ? 'win' : 'podium', place === 1 ? `Victory at ${this.track.def.short}` : `P${place} on the podium`, `${EVENT_GP()} · ${new Date().toLocaleDateString()}`, place === 1 ? 100 : 85 - place * 3, this.track.def.short, tTrophy + 0.2 - this.celebration.time);
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

    // the gantry is lit only while a live countdown runs (never over a replay, the results or the menu)
    const liveCountdown = (this.state === 'race' || this.state === 'intro' || this.state === 'spectate') && race.phase === 'lights';
    this.trackside.startLights.set(liveCountdown ? race.lightsLit : 0);
    const showLine = (this.state === 'race' || this.state === 'intro') && this.line.mode !== 'off' && !isRemoteCam(this.cams.view) && this.cams.view !== 'gtchase' && !race.player.finished;
    this.line.mesh.visible = showLine;
    // the line's colours compare against dry targets: scale the car's speed up by the grip it lacks
    if (showLine) this.line.update(race.player.car.s, Math.max(0, race.player.car.vx) / Math.sqrt(Math.max(0.3, race.player.car.gripFactor)));
    // dev/tools: a free camera (tools/tour.mjs) overrides whatever the state's camera did
    if (this.freeCam) {
      const F = this.freeCam;
      this.camera.position.set(F.pos[0], F.pos[1], F.pos[2]);
      this.camera.lookAt(F.look[0], F.look[1], F.look[2]);
      if (this.camera.fov !== F.fov) {
        this.camera.fov = F.fov;
        this.camera.updateProjectionMatrix();
      }
    }
    // (back in the garage, the last race's weather stays until its highlights are filmed)
    const wx = (this.state === 'menu' && this.highlights.worldWeather(this.track.def.id)) || race.weatherState;
    applyWeatherUniforms(wx);
    // in the garage the roof and walls shut most of the sky's light out
    const indoor = this.state === 'menu';
    this.env.setIndoor(indoor ? 1 : 0);
    this.gfx.indoor = indoor;
    this.env.setWeather(wx);
    this.env.update(dt, this.camera);
    const eyeCam = !this.celebration && (this.state === 'race' || this.state === 'intro' || this.state === 'paused') && EYE_CAMS[this.cams.view];
    this.env.focusShadow(this.celebration ? this.celebration.center : (this.introFocus ?? this.playerRigPos()), eyeCam ? 16 : undefined);
    // the crowds and the trackside people follow the race
    if (this.state === 'race' || this.state === 'intro' || this.state === 'results' || this.state === 'spectate' || this.state === 'celebration') crowdReactions.update(dt, race);
    else if (this.state !== 'paused') crowdReactions.quiet(dt);
    this.updatePits(dt, race);
    this.updateHeadlights(wx);
    this.trackside.update(dt, this.camera);
    this.particles.glowScale = 1 / Math.sqrt(Math.max(1, this.gfx.grade.uniforms.get('lookExposure')!.value as number));
    this.particles.update(this.state === 'paused' ? 0 : dt);
    this.updateAudio(dt);
    this.updateMotionBlur();
    // a long lens looks through hundreds of metres of air at its subject, yet broadcast telephoto
    // shots stay contrasty: thin the haze as the lens narrows (full below ~28°, a third at ~3°)
    aerialLens.x = THREE.MathUtils.clamp(0.33 + (this.camera.fov - 3) * (0.67 / 25), 0.33, 1);
    this.gfx.render(dt);
    // (nothing is filmed while racing: highlights come from the replay recording; the podium is captured)
    if (this.state === 'celebration') this.highlights.afterRender(this.canvas, dt);
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
  /** the "Simulate a race" setup over the garage */
  private openSimSetup() {
    this.menu.show('none');
    this.simSetup.show();
  }

  /** a simulated race from its setup: travel to the circuit if needed, then lights out */
  private async startSimulation(cfg: SimConfig) {
    this.simSetup.hide();
    const c = { ...cfg };
    if (c.track === 'random') {
      const others = CIRCUITS.filter((x) => x.id !== this.track.def.id);
      c.track = (others.length ? others : CIRCUITS)[Math.floor(Math.random() * (others.length || CIRCUITS.length))].id;
    }
    this.simCfg = c;
    this.menu.setup.track = c.track;
    if (!(await this.worldReady()) || this.track.def.id !== c.track) return;
    const setup: RaceSetup = { ...this.menu.setup, track: c.track, laps: c.laps, weather: c.weather, time: c.time, damage: c.damage };
    // every simulated race gets its own sky (a Random choice rolls again)
    this.planKey = '';
    this.startSpectate(setup, c);
  }
  /** the last simulated race's setup (circuit resolved), for "Race again" / Restart */
  private simCfg: SimConfig | null = null;

  /** a simulated race: every car (the player's too) on the AI, the TV director on the cameras */
  private startSpectate(setup: RaceSetup, cfg: SimConfig | null = this.simCfg) {
    this.careerRace = false;
    const diff = aiLevel(setup, this.career).value;
    // the grid: a simulated qualifying (nobody drives a lap), a draw, reversed, or on pace
    const times = this.entries.map((e) => ({ e, t: aiQualifyingTime(e, diff, 1, 1) })).sort((a, b) => a.t - b.t);
    let order = times.map((x) => x.e);
    const grid = cfg?.grid ?? 'quali';
    if (grid === 'reversed') order.reverse();
    else if (grid === 'random') {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } else if (grid === 'pace') order = this.entries.slice().sort((a, b) => b.team.pace * b.driver.skill - a.team.pace * a.driver.skill);
    this.gridOrder = order;
    this.startRace('race', setup);
    this.gridOrder = null;
    // (startRace cleared these)
    this.spectating = true;
    this.recorded = true; // never counts for the career
    this.celMoment = true; // and films no podium (its race highlights are still produced from the recording)
    const race = this.race;
    const p = race.player;
    this.autopilot = new AIDriver(aiPace(p.entry, race.opts.difficulty), p.entry.driver.aggression);
    this.autopilot.startFrom(p.car, this.track);
    p.car.allowReverse = false;
    p.car.assists = { traction: 'full', abs: true, stability: true, autoGear: true };
    race.playerDrsAuto = true;
    // the field: a tight pack, the real spread, or a wild one (bigger gaps, harder racing)
    const field = cfg?.field ?? 'mixed';
    const spread = field === 'close' ? 0.003 : field === 'mixed' ? 0.006 : 0.014;
    for (const c of race.cars) {
      const ai = c.ai ?? (c.isPlayer ? this.autopilot : null);
      if (!ai) continue;
      if (field === 'close') ai.pace = 1 - (1 - ai.pace) * 0.5;
      ai.pace *= 1 + (Math.random() * 2 - 1) * spread;
      if (field === 'wild') ai.aggression = Math.min(1, ai.aggression + 0.25 + Math.random() * 0.2);
    }
    this.specPitLap = setup.laps >= 8 ? Math.max(2, Math.round(setup.laps * (0.4 + Math.random() * 0.2))) : -1;
    this.specFinish = -1;
    this.state = 'spectate';
    this.stateTime = 0;
    this.simSpeed = cfg?.speed ?? 1;
    // the director is on unless a car was chosen to follow (then it still picks the cameras, on that car)
    this.directorOn = true;
    const lockEntry = cfg && cfg.follow >= 0 ? this.entries[cfg.follow] : null;
    const locked = lockEntry ? race.cars.find((c) => c.entry === lockEntry) : undefined;
    this.director.lock = locked ? locked.id : -1;
    this.focusId = locked?.id ?? race.cars.find((c) => c.position === 1)?.id ?? p.id;
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
    if (this.cams) this.cams.timeScale = 1;
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
      // (shots are timed in real seconds: at 8× a 10 s shot would otherwise flash by in a second)
      this.director.update(dt, race.time, race.raceTime, this.fieldLive(), ev, 0, this.cams, this.track, race.player.id);
      if (this.director.cutNow) this.applyDirector();
    }
    const fc = race.cars[this.focusId];
    this.cams.timeScale = steps;
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
    this.broadcast.setShot(this.cams.lost ? CAMERA_LABEL.heli : CAMERA_LABEL[this.cams.mode], this.cams.lost ? '' : this.cams.where, this.directorOn, this.simSpeed);
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
    const want = (this.state === 'spectate' || this.state === 'replay') && INSIDE_CAR[this.cams.view] ?(this.rigs.get(this.race.cars[this.focusId].entry) ?? null) : null;
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
      this.director.update(this.replayPlaying ? dt : 0, this.replayT, R.raceTime, this.fieldReplay(), R.events, 3, this.cams, this.track, race.player.id);
      if (this.director.cutNow) this.applyDirector();
    }
    const k = this.focusId;
    const fc = race.cars[k];
    this.cams.timeScale = Math.max(1, this.replaySpeed);
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
    this.broadcast.setShot(this.cams.lost ? CAMERA_LABEL.heli : CAMERA_LABEL[this.cams.mode], this.cams.lost ? '' : this.cams.where, this.directorOn, this.replaySpeed);
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
    this.startSpectate(setup, null);
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

  /** dev/tools: hold the camera here (null: back to the game's cameras) */
  freeCam: { pos: [number, number, number]; look: [number, number, number]; fov: number } | null = null;
  /** dev/tools: a point on the track: world position of (s, lateral, height) */
  trackPoint(s: number, lat = 0, h = 0): [number, number, number] {
    const p = this.track.point(s, lat, h);
    return [p.x, p.y, p.z];
  }

  private dashT = 0;
  private readonly visor: HTMLDivElement;
  private visorOn = false;
  private syncAllViews(dt: number, ghosts?: CarPhysics[]) {
    CarView.lodScale = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(25));
    this.camPos.copy(this.camera.position);
    const onboardEye = INSIDE_CAR[this.cams.view] === true;
    const visor = this.cams.view === 'helmet' && (this.state === 'race' || this.state === 'intro' || this.state === 'paused');
    if (visor !== this.visorOn) {
      this.visorOn = visor;
      this.visor.style.opacity = visor ? '1' : '0';
    }
    const cockpit = (this.state === 'race' || this.state === 'intro') && onboardEye;
    if (cockpit !== this.driverHidden) {
      this.driverHidden = cockpit;
      this.rigs.get(this.race.player.entry)?.setDriverVisible(!cockpit);
    }
    const w = this.race.weatherState;
    // (and after dark: the red tail light is what you follow down a floodlit straight)
    const rainLight = w.wetness > 0.22 || w.rain > 0.08 || w.fog > 0.85 || w.time === 'night';
    for (const c of this.race.cars) {
      const view = this.views.get(c.entry)!;
      view.sync(ghosts ? ghosts[c.id] : c.car, this.track, dt, this.camPos, c.isPlayer, rainLight, !ghosts);
      // the steering wheel's screen and shift lights, live, when the driver's eyes are the camera (15 Hz)
      if (c.isPlayer && onboardEye && !ghosts) {
        this.dashT -= dt;
        if (this.dashT <= 0) {
          this.dashT = 1 / 15;
          const car = c.car;
          const sp = car.spec;
          this.rigs.get(c.entry)?.setDash?.({
            gear: car.gear,
            kmh: Math.abs(car.vx) * 3.6,
            rpm: (car.rpm - sp.rpmIdle) / (sp.rpmLimit - sp.rpmIdle),
            delta: this.race.playerDelta,
            straight: car.drsAnim > 0.5,
            ers: car.ers,
            code: c.entry.driver.code,
            lights: true,
          });
        }
      }
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
      if (this.rigTeam.get(e) === team.id && this.rigDriverKey.get(e) === driverKey(e)) continue;
      const visible = rig.root.visible;
      rig.root.removeFromParent();
      rig.dispose();
      const next = createCar(team, e.driver, e.seat, { envMap: this.scene.environment ?? undefined });
      next.root.visible = visible;
      this.rigs.set(e, next);
      this.rigTeam.set(e, team.id);
      this.rigDriverKey.set(e, driverKey(e));
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
  private travel(id: string = this.menu.setup.track, force = false) {
    this.travelTo = id;
    if (force) this.travelForce = true;
    if (!this.travelling) this.travelling = this.runTravel().finally(() => (this.travelling = null));
    return this.travelling;
  }
  private travelTo: string | null = null;
  /** rebuild the circuit even if it's the one we're at (the grid changed: other teams in the pit garages) */
  private travelForce = false;
  private travelling: Promise<void> | null = null;
  /** dev/test hook: `await __game.travelAsync('spa')` */
  travelAsync(id: string) {
    return this.travel(id);
  }

  private async runTravel() {
    const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    while (this.travelTo && (this.travelTo !== this.track.def.id || this.travelForce)) {
      this.travelForce = false;
      const def = CIRCUITS.find((c) => c.id === this.travelTo);
      if (!def) break;
      const t0 = performance.now();
      const screen = this.menu.screen;
      const veil = document.createElement('div');
      veil.className = 'travel-veil';
      // a title card over the circuit's own key art while its garage is built (the rest follows
      // behind the garage): no "travelling" screen to sit through
      const round = CIRCUITS.indexOf(def) + 1;
      veil.innerHTML = `<img class="tv-art" alt=""><div><span>Round ${round} · ${def.country}</span><b>${def.name}</b><div class="tv-bar"><i></i></div><div class="tv-step"></div></div>`;
      // the destination's key art (decoded before the build blocks the main thread)
      const art = veil.querySelector('img') as HTMLImageElement;
      art.src = artFor(def.id);
      const artReady = art.decode().then(
        () => veil.classList.add('art'),
        () => art.remove(),
      );
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
      await Promise.race([artReady, wait(350)]);
      await wait(120);
      // the newest destination, now that the screen is covered
      const dest = CIRCUITS.find((c) => c.id === this.travelTo) ?? def;
      (veil.querySelector('b') as HTMLElement).textContent = dest.name;
      // the old circuit's background build (if still going) stops at its next slice
      this.worldGen++;
      await this.worldDone;
      this.worldBusy = true;
      try {
        const oldEnv = this.scene.environment;
        set(0.04, 'Packing up');
        await paint();
        let tp = performance.now();
        // (the old materials outlive the build: the new world reuses their shader programs)
        holdMaterials();
        this.disposeWorld();
        const tDispose = Math.round(performance.now() - tp);
        await this.buildWorld(dest, async (f, label) => {
          set(0.06 + f * 0.8, label);
          await paint();
        });
        // the cars keep their materials: point their reflections at the new sky
        const env = this.scene.environment;
        if (env !== oldEnv) for (const rig of this.rigs.values()) rig.setEnvMap?.(env);
        if (this.leanOn) this.env.setLean(true);
        tp = performance.now();
        this.finishWorld();
        this.worldTimes.dispose = tDispose;
        this.worldTimes.finish = Math.round(performance.now() - tp);
        set(0.95, 'Opening the garage');
        await paint();
        tp = performance.now();
        this.state = 'menu';
        this.toMenu();
        await this.warmGarage();
        this.worldTimes.warm = Math.round(performance.now() - tp);
      } catch (e) {
        // a half-built world can't be raced: fall back to a clean start there (the setup is saved)
        releaseHeldMaterials();
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
      // the landscape, stands and race shaders grow behind the garage (the old materials are
      // held until then: the new world reuses their shader programs)
      void this.completeWorldInBackground().then(() => releaseHeldMaterials());
    }
    this.travelTo = null;
  }
  /** how long the last circuit switch took (ms) */
  travelMs = 0;

  /** soft work lights over the bays: the garage ceiling blocks the sun */
  private buildGarageLights() {
    const g = this.garageLights;
    g.name = 'garage-lights';
    // a studio key from the light box: bright on the car, falling off fast so the garage stays moody
    const key = new THREE.SpotLight(0xfff6ee, 78, 14, 0.62, 0.75, 1.6);
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
    for (const [z, i] of [[2.6, 13], [-2.4, 11]] as const) {
      const p = new THREE.PointLight(0xf4f1ea, i, 10, 1.7);
      p.position.set(0, 3.7, z);
      g.add(p);
    }
    // a cool rim from behind: picks out the car's silhouette against the dark garage. A narrow spot
    // from up high, aimed at the bodywork: as a point light 1.6 m off the floor its own reflection in
    // the glossy epoxy sat in front of the car as a glowing blue-white oval
    const rim = new THREE.SpotLight(0xa9c8ff, 40, 12, 0.36, 0.6, 1.6);
    rim.position.set(0, 2.9, -5.4);
    rim.target.position.set(0, 0.55, 0.2);
    g.add(rim, rim.target);
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
      // the teammate's car is up on stands with its wheels off (put back when the menu closes)
      if (e === mate) {
        rig.root.position.y += 0.3;
        for (const w of ['wFL', 'wFR', 'wRL', 'wRR'] as const) rig.setWheelOff(w, 1);
        this.mateOnStands = rig;
        this.mateOnStandsEntry = e;
      }
    }
    const b = this.pits.bay(team, player.seat);
    const c = b.pos;
    const rig = this.rigs.get(player)!;
    // the garage dressing: rebuilt when the car (paint) or the team changes
    if (!this.garage || this.garageRig !== rig) {
      this.garage?.dispose();
      rig.root.updateMatrixWorld(true);
      const mb = this.pits.bay(team, mate.seat).pos.clone();
      this.garage = new GarageScene(peopleKit(), rig, b, player.team, player.driver, this.highlights, this.career, this.track, { renderer: this.gfx.renderer, shadowLayer: GARAGE_SHADOW_LAYER, reflectLayer: GARAGE_MIRROR_LAYER, mateBay: mb });
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
      career: { cam: [3.45, 1.78, -4.85], look: [3.45, 1.35, -7.35], shift: 0.62, fov: 44 },
      highlights: { cam: [1.6, 2.5, -0.2], look: [0, 2.05, -6.0], shift: 1.0, fov: 42 },
      car: { cam: [3.4, 1.7, -4.6], look: [0, 0.45, -0.5], shift: 1.45, fov: 36 },
      setup: { cam: [3.6, 1.6, 3.6], look: [0, 0.35, 0], shift: 1.3, fov: 36 },
      paint: { cam: [3.1, 3.4, 4.1], look: [0, 0.15, 0.2], shift: 1.45, fov: 38 },
      settings: { cam: [3.9, 0.95, 4.6], look: [0.1, 0.5, 0.4], shift: 1.3, fov: 32 },
    };
    let sh: Shot = shots[this.hubTab];
    const toW = (v: readonly [number, number, number], out: THREE.Vector3) =>
      out.copy(c).addScaledVector(left, v[0] * side).addScaledVector(fwd, v[2]).setY(c.y + v[1]);
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    const T = this.tour;
    const spot = T.at ? this.garage.spots[T.at] : null;
    const part = this.hubTab === 'setup' && !spot ? this.focusPart : null;
    if (spot && (!spot.orbit || T.flight)) {
      // a place on the garage tour (the car's own place orbits once the camera is there)
      wantPos.copy(spot.pos);
      wantLook.copy(spot.look);
      sh = { ...sh, shift: 0, fov: spot.fov * (spot.orbit ? 1 : T.zoom) };
    } else if (part && this.garage.parts[part === 'tyres' ? 'tyres' : part]) {
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
    // push the subject left of centre: the hub panel is on the right (not while touring: it steps aside)
    if (spot) sh = { ...sh, shift: 0 };
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
    const flying = this.tourFly(dt, wantPos, wantLook, sh.fov);
    const atStop = !flying && !!spot && !spot.orbit;
    if (atStop) {
      // at a tour stop: its framing, plus where you've dragged the view to (eased)
      const k = 1 - Math.exp(-10 * dt);
      T.yawS += (T.yaw - T.yawS) * k;
      T.pitchS += (T.pitch - T.pitchS) * k;
      const m = new THREE.Matrix4().lookAt(wantPos, wantLook, up);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(up, T.yawS));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), T.pitchS));
      this.camera.position.copy(wantPos);
      this.camera.quaternion.copy(q);
      this.camera.fov += (sh.fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
      g.init = false;
    }
    for (let left2 = flying || atStop ? 0 : Math.min(dt, 0.1); left2 > 1e-5; left2 -= 1 / 120) {
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
    if (!flying && !atStop) {
      // a long move round the car rises like a crane and keeps inside the bay: flying low at full
      // radius it skimmed the teammate's car on its stands next door (a wheel filling the frame
      // whenever the move was caught half-way)
      const swing = THREE.MathUtils.smoothstep(Math.max(Math.abs(thT - g.th), Math.abs(g.vth) * 0.45), 0.2, 1.0);
      const r = Math.min(g.r, THREE.MathUtils.lerp(g.r, 5.2, swing));
      g.pos.set(c.x + Math.sin(g.th) * r, c.y + g.y + 1.2 * swing, c.z + Math.cos(g.th) * r);
      this.camera.position.copy(g.pos);
      this.camera.lookAt(g.look);
      this.camera.fov = g.fov;
      this.camera.updateProjectionMatrix();
    }
    this.dofTarget.copy(spot ? wantLook : part ? this.garage.parts[part] : this.hubTab === 'highlights' ? this.garage.wallCenter : c.clone().setY(c.y + 0.5));
    // crisp: no depth of field in the garage, except a whisper of it on a part close-up
    if (part) this.gfx.setDepthOfField(true, this.dofTarget, 3.2, 1.1);
    else this.gfx.setDepthOfField(false);
    // nobody stands between the camera and the car
    this.pits.clearView(this.camera.position, c, 1.6);
    this.pits.hideCrew(team);
    this.garage.update(dt, this.camera.position, this.dofTarget, this.camera, { onlyTooClose: atStop });
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
      // a showroom grade: deeper blacks, a little more punch, the edges falling away to dark
      gfx.grade.set({ contrast: 1.07, exposure: 0.97, saturation: 1.03 });
      this.garageVignette = gfx.vignette.darkness;
      gfx.vignette.darkness = 0.52;
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
  private garageVignette = 0.38;
  private leaveGarageLook() {
    const L = this.garageLook;
    if (!L) return;
    this.garageLook = null;
    // the teammate's car back on its wheels
    const m = this.mateOnStands;
    if (m) {
      for (const w of ['wFL', 'wFR', 'wRL', 'wRR'] as const) m.setWheelOff(w, 0);
      this.mateOnStands = null;
      this.mateOnStandsEntry = null;
    }
    this.gfx.grain.blendMode.opacity.value = L.grain;
    this.gfx.grade.set({ contrast: 1, exposure: 1, saturation: 1 });
    this.gfx.vignette.darkness = this.garageVignette;
    this.gfx.maxDynamic = L.maxDyn;
    // (a session starts at full resolution whatever the menu stepped down to; the governor takes it from there)
    this.gfx.setDynamicScale(Math.min(1, L.maxDyn));
    for (const l of L.suns) {
      l.shadow.autoUpdate = true;
      l.shadow.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- garage: the tour
  /**
   * Walk around the garage: buttons in the picture fly the camera to another place (the
   * car, the cockpit, the front wing, the gantry, the tool chests, the tyre sets, the
   * telemetry desk, the video wall, the pit lane, the pit wall). The flight is a lifted
   * Bézier arc (over the car, under the gantry, straight up out of the cockpit), eased,
   * the view turning with it; at a stop you drag to look around (the car's place orbits)
   * and the wheel zooms.
   */
  private tour = {
    at: null as SpotId | null,
    flight: null as null | { pending: boolean; t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; q0: THREE.Quaternion; fov0: number; up: boolean; down: boolean },
    yaw: 0,
    pitch: 0,
    yawS: 0,
    pitchS: 0,
    zoom: 1,
    dragging: false,
    lx: 0,
    ly: 0,
  };
  private tourUi: GarageTourUI | null = null;
  private mateOnStands: CarRig | null = null;
  private mateOnStandsEntry: unknown = null;

  private tourGo(id: SpotId) {
    const T = this.tour;
    if (T.at === id && !T.flight) return;
    const from = T.at;
    T.at = id;
    T.yaw = T.pitch = 0;
    T.zoom = 1;
    this.garageOrbit.active = false;
    this.garageOrbit.dragging = false;
    this.tourFlight(from === 'cockpit', id === 'cockpit');
    this.menu.setExploring(true);
    if (this.audioReady) this.audio.ui('select');
  }
  private tourExit() {
    const T = this.tour;
    if (!T.at) return;
    const from = T.at;
    T.at = null;
    this.garageOrbit.active = false;
    this.tourFlight(from === 'cockpit', false);
    this.menu.setExploring(false);
    if (this.audioReady) this.audio.ui('back');
  }
  private tourStep(dir: 1 | -1) {
    const n = SPOT_ORDER.length;
    const i = this.tour.at ? SPOT_ORDER.indexOf(this.tour.at) : dir > 0 ? -1 : 0;
    this.tourGo(SPOT_ORDER[(i + dir + n) % n]);
  }
  private tourNav(nav: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean }): boolean {
    if (!this.tour.at) return false;
    if (nav.back) this.tourExit();
    else if (nav.left || nav.up) this.tourStep(-1);
    else if (nav.right || nav.down) this.tourStep(1);
    return true;
  }
  /** start a flight from wherever the camera is now (its path is laid out on the next garage frame) */
  private tourFlight(upOut: boolean, downIn: boolean) {
    this.tour.flight = { pending: true, t: 0, dur: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), q0: new THREE.Quaternion(), fov0: 40, up: upOut, down: downIn };
  }
  /** advance the flight toward (pos, look, fov); false when there is none */
  private tourFly(dt: number, pos: THREE.Vector3, look: THREE.Vector3, fov: number): boolean {
    const T = this.tour;
    const F = T.flight;
    if (!F || !this.garage) return false;
    const up = new THREE.Vector3(0, 1, 0);
    if (F.pending) {
      F.pending = false;
      const cam = this.camera;
      F.p0.copy(cam.position);
      F.q0.copy(cam.quaternion);
      F.fov0 = cam.fov;
      const p0 = F.p0, p3 = pos;
      const d = p0.distanceTo(p3);
      // inside the garage the arc stays under the light box and the gantry; out in the lane it may rise
      const inside = (v: THREE.Vector3) => this.garage!.group.worldToLocal(v.clone()).z < 5.3;
      const top = inside(p0) || inside(p3) ? 3.1 : 5;
      const hi = Math.max(p0.y, p3.y);
      const yMid = hi > top ? hi : THREE.MathUtils.clamp(hi + 0.3 + d * 0.04, 1.85, top);
      const h = Math.max(0, (yMid - (p0.y + p3.y) / 2) / 0.75);
      F.p1.copy(p0).lerp(p3, 0.3).setY(p0.y + (p3.y - p0.y) * 0.3 + h);
      F.p2.copy(p0).lerp(p3, 0.7).setY(p0.y + (p3.y - p0.y) * 0.7 + h);
      if (F.up) F.p1.copy(p0).setY(p0.y + Math.max(h, 1.1));
      if (F.down) F.p2.copy(p3).setY(p3.y + Math.max(h, 1.1));
      F.dur = THREE.MathUtils.clamp(1.0 + d * 0.1, 1.2, 2.8);
      if (d < 0.05) F.dur = 0.6;
    }
    F.t = Math.min(1, F.t + dt / F.dur);
    const t = F.t;
    const e = t * t * t * (t * (t * 6 - 15) + 10);
    // cubic Bézier p0 → p3 (the destination follows the shot, which drifts a little)
    const u = 1 - e;
    const p = new THREE.Vector3()
      .addScaledVector(F.p0, u * u * u)
      .addScaledVector(F.p1, 3 * u * u * e)
      .addScaledVector(F.p2, 3 * u * e * e)
      .addScaledVector(pos, e * e * e);
    const qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, up));
    this.camera.position.copy(p);
    this.camera.quaternion.copy(F.q0).slerp(qd, e);
    this.camera.fov = F.fov0 + (fov - F.fov0) * e;
    this.camera.updateProjectionMatrix();
    if (t >= 1) {
      T.flight = null;
      T.yawS = T.pitchS = 0;
      // hand over to the springs (tabs, the car's orbit) from exactly here
      this.garageCam.init = false;
      const sp = T.at ? this.garage.spots[T.at] : null;
      if (sp?.orbit) {
        const O = this.garageOrbit;
        const b = this.pits.bay(TEAMS.indexOf(this.race.player.entry.team), this.race.player.entry.seat);
        const rel = pos.clone().sub(b.pos).setY(pos.y - b.pos.y - 0.45).applyAxisAngle(up, -b.yaw);
        O.dist = rel.length();
        O.yaw = Math.atan2(rel.x, rel.z);
        O.pitch = Math.asin(rel.y / Math.max(0.1, O.dist));
        O.active = true;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- garage: look around, hotspots
  private garage: GarageScene | null = null;
  private garageRig: CarRig | null = null;
  private focusPart: SetupPart | null = null;
  private garageOrbit = { active: false, dragging: false, yaw: 0.8, pitch: 0.25, dist: 6.2, lx: 0, ly: 0 };
  private hotspotLayer: HTMLDivElement | null = null;

  private bindGarageInput() {
    const O = this.garageOrbit;
    const onUi = (e: Event) => (e.target as HTMLElement).closest('.hub-panel, .hub-rail, .htab, .hotspot, .cta, .screen:not(.hub), .wp, .tour-bar, .tour-pill') !== null;
    const T = this.tour;
    const freeLook = () => !!T.at && !T.flight && !this.garage?.spots[T.at].orbit;
    addEventListener('pointerdown', (e) => {
      if (this.state !== 'menu' || this.menu.screen !== 'title' || onUi(e)) return;
      if (T.flight) return;
      if (freeLook()) {
        T.dragging = true;
        T.lx = e.clientX;
        T.ly = e.clientY;
        return;
      }
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
      if (T.dragging) {
        T.yaw = THREE.MathUtils.clamp(T.yaw + (e.clientX - T.lx) * 0.0035, -1.4, 1.4);
        T.pitch = THREE.MathUtils.clamp(T.pitch + (e.clientY - T.ly) * 0.003, -0.75, 0.75);
        T.lx = e.clientX;
        T.ly = e.clientY;
        return;
      }
      if (!O.dragging) return;
      O.yaw -= (e.clientX - O.lx) * 0.006;
      O.pitch = THREE.MathUtils.clamp(O.pitch + (e.clientY - O.ly) * 0.004, 0.02, 1.2);
      O.lx = e.clientX;
      O.ly = e.clientY;
    });
    addEventListener('pointerup', () => {
      O.dragging = false;
      T.dragging = false;
    });
    addEventListener(
      'wheel',
      (e) => {
        if (this.state !== 'menu' || this.menu.screen !== 'title' || onUi(e) || T.flight) return;
        if (freeLook()) {
          T.zoom = THREE.MathUtils.clamp(T.zoom * (1 + e.deltaY * 0.001), 0.5, 1.3);
          return;
        }
        O.active = true;
        O.dist = THREE.MathUtils.clamp(O.dist * (1 + e.deltaY * 0.001), 2.6, 10);
      },
      { passive: true },
    );
    this.hotspotLayer = document.createElement('div');
    this.hotspotLayer.className = 'hotspots';
    (this.hud.root.parentElement ?? document.body).appendChild(this.hotspotLayer);
    this.tourUi = new GarageTourUI(this.hud.root.parentElement ?? document.body, {
      go: (id) => this.tourGo(id),
      exit: () => this.tourExit(),
      step: (d) => this.tourStep(d),
      enter: () => this.tourGo('car'),
    });
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
    const onHub = this.state === 'menu' && this.menu.screen === 'title' && !!this.garage;
    if (!onHub && this.tour.at) {
      // left the garage mid-tour: back to the overview next time
      this.tour.at = null;
      this.tour.flight = null;
      this.menu.setExploring(false);
    }
    this.tourUi?.sync({
      visible: onHub,
      at: this.tour.at,
      spots: this.garage?.spots ?? null,
      camera: this.camera,
      // (the parts you can click to look at up close: on the car development tab, not over every screen)
      overviewMarkers: this.hubTab === 'car',
      panelLeft: this.tour.at ? innerWidth : innerWidth - 500 * uiScale(),
      flying: !!this.tour.flight,
    });
    const show = onHub && this.hubTab === 'setup' && !this.tour.at;
    L.classList.toggle('on', show);
    if (!show) return;
    const v = new THREE.Vector3();
    for (const h of Array.from(L.children) as HTMLElement[]) {
      const id = h.dataset.part as SetupPart;
      const P = this.garage!.parts[id];
      if (!P) continue;
      v.copy(P).project(this.camera);
      const sx = ((v.x + 1) / 2) * innerWidth;
      // not under the tab rail or the panel (both scale with the UI zoom; the layer is zoomed too)
      const k = uiScale();
      const vis = v.z < 1 && Math.abs(v.y) < 0.9 && sx > 280 * k && sx < innerWidth - 500 * k;
      h.style.transform = `translate3d(${Math.round((sx / k) * 2) / 2}px, ${Math.round((((1 - v.y) / 2) * innerHeight * 2) / k) / 2}px, 0)`;
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
        } else if (!(this.state === 'menu' && c.entry === this.mateOnStandsEntry)) view.setPit(0, 0, null); // (the garage keeps the teammate's wheels off)
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

  private readonly motionSort: THREE.Object3D[] = [];
  private lastCuts = 0;
  /** camera motion blur while cars run (Settings → Motion blur); the cars nearest the lens stay sharp as moving objects */
  private updateMotionBlur() {
    const st = this.state;
    const live = st === 'race' || st === 'intro' || st === 'results' || st === 'replay' || st === 'spectate' || st === 'flashback';
    const g = this.gfx;
    g.motionBlur = live ? MOTION_SHUTTER[this.menu.settings.motionBlur ?? 'cinematic'] : 0;
    const eye = (st === 'race' || st === 'intro' || st === 'flashback' || st === 'paused') && INSIDE_CAR[this.cams.view];
    g.onboardCar = eye ? (this.rigs.get(this.race.player.entry)?.root ?? null) : null;
    if (this.cams.cuts !== this.lastCuts) {
      this.lastCuts = this.cams.cuts;
      g.motionCut = true;
    }
    const out = g.motionCars;
    out.length = 0;
    if (g.motionBlur <= 0) return;
    const cp = this.camera.position;
    const all = this.motionSort;
    all.length = 0;
    for (const rig of this.rigs.values()) if (rig.root.visible && rig.root.parent) all.push(rig.root);
    all.sort((a, b) => a.position.distanceToSquared(cp) - b.position.distanceToSquared(cp));
    // the car the camera follows always moves as a car (a long lens 150 m off has other cars nearer
    // it: left out, the panning lens' own motion would smear the car it holds sharp)
    const followed = this.cams.followed;
    if (followed && followed.visible && followed.parent) out.push(followed);
    for (let i = 0; i < all.length && out.length < MOTION_CARS; i++) if (all[i] !== followed) out.push(all[i]);
  }

  private speedFx() {
    const car = this.race.player.car;
    const kmh = Math.max(0, car.vx * 3.6);
    // the chase cameras get a hint of radial speed blur at the edges; the onboards stay crisp (the
    // cockpit, the halo and the wheel are right in front of the lens — any smear reads as soft focus)
    // (with camera motion blur on, the real per-pixel streaks replace the radial approximation)
    const chaseCam = this.cams.view === 'chase' || this.cams.view === 'far' || this.cams.view === 'lowchase';
    const k = chaseCam ? Math.max(0, Math.min(1, (kmh - 190) / 150)) : 0;
    const radial = (this.menu.settings.motionBlur ?? 'cinematic') === 'off';
    this.gfx.setSpeedBlur(radial ? k * k * 0.006 + (chaseCam && car.ersDeploying ? 0.001 : 0) : 0);
    this.gfx.setAberration(k * 0.0004);
    // rain on the lens for the onboard cameras, plus spray thrown up by the car ahead
    const w = this.race.weatherState;
    const cam = this.cams.view;
    const lensCam = ONBOARD[cam] ? 1 : cam === 'chase' || cam === 'lowchase' ? 0.35 : 0;
    const spray = car.dirty * Math.min(1, car.speed / 40) * w.wetness;
    const lens = lensCam * Math.min(1, w.rain * (0.55 + 0.45 * Math.min(1, car.speed / 45)) + spray * 0.8);
    (this.gfx as unknown as { setLensRain?: (a: number) => void }).setLensRain?.(this.state === 'race' || this.state === 'intro' ? lens : 0);
  }

  /**
   * After dark every car runs its headlights: on at night, and from twilight (with the floodlights).
   * Not in the garage or on the podium (their own scenes and lights).
   */
  private updateHeadlights(w: WeatherState) {
    const st = this.state;
    const level = floodlit(w.time);
    if (level <= 0 || st === 'menu' || st === 'boot' || st === 'celebration') {
      this.headlights.suspend();
      return;
    }
    const cars = this.lampCars;
    cars.length = 0;
    for (const c of this.race.cars) {
      const rig = this.rigs.get(c.entry);
      if (rig) cars.push(rig);
    }
    // (mist and rain catch the beams and swell the glare)
    this.headlights.set(level, THREE.MathUtils.clamp(w.fog * 0.8 + w.rain * 0.6, 0, 1), aerialParams.x);
    this.headlights.update(cars, this.camera);
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
    a.setView(ONBOARD[this.cams.view] ? 'cockpit' : isRemoteCam(this.cams.view) || this.cams.view === 'gtchase' ? 'tv' : 'chase');
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
        if (isRemoteCam(this.cams.view) || this.cams.view === 'gtchase') {
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
   * Dynamic resolution, checked twice a second with hysteresis. It gives up pixels only below
   * ~50 fps and never below the preset's floor (0.8 on High): a sharp picture first.
   * With the GPU timer the render scale follows the GPU's own frame time (aiming at ~17 ms,
   * so a CPU-bound frame never costs resolution); without it, the frame rate.
   * Down: at once, in proportion to the overrun. Up: one 5 % step after 2 s of headroom; a
   * raise that turns slow again within 4 s caps the scale below it for 30 s. The only
   * automatic quality step is Ultra → High (never up: a level change recompiles shaders).
   */
  /** the governor's lean tier is on (see adaptQuality) */
  private leanOn = false;
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
    // (a timer that claims more than the frame interval while the frame rate holds is lying)
    const timed = isFinite(gpu) && gfx.timerTrusted && !(gpu > 1000 / Math.max(fps, 1) * 1.15 && fps > 55);
    // (below ~54 fps a 60 Hz screen judders visibly: step the resolution down; a raise that
    // doesn't hold sets a ceiling for 30 s, so this doesn't pump)
    const slow = timed ? gpu > 19 && fps < 52 : fps < 54;
    const roomy = timed ? gpu < 12.5 : fps > 58;
    if (slow) {
      aq.headroom = 0;
      // the last raise didn't hold: stay below it for a while
      if (aq.raisedFrom > 0 && now - aq.raisedAt < 4) {
        aq.ceiling = aq.raisedFrom;
        aq.ceilingUntil = now + 30;
      }
      aq.raisedFrom = 0;
      const k = timed ? THREE.MathUtils.clamp(Math.sqrt(17 / gpu), 0.8, 0.95) : fps < 40 ? 0.86 : 0.93;
      const next = Math.max(gfx.minDynamic, Math.floor(gfx.dynamicScale * k * 20) / 20);
      if (next < gfx.dynamicScale - 0.001) {
        gfx.setDynamicScale(next);
        aq.settleUntil = now + 0.8;
      }
      // still slow at the lowest resolution for 2 s: first give up the native-resolution output
      // (the browser stretches the frame again), then on Ultra step down to High (auto quality only)
      if (gfx.dynamicScale <= gfx.minDynamic + 0.001 && gfx.nativeUpscale) {
        if (++aq.slowAtFloor >= 4) {
          aq.slowAtFloor = 0;
          gfx.nativeUpscale = false;
          aq.settleUntil = now + 1.5;
        }
      } else if (gfx.dynamicScale <= gfx.minDynamic + 0.001 && st.autoQuality && st.quality === 'ultra') {
        if (++aq.slowAtFloor >= 4) {
          aq.slowAtFloor = 0;
          this.setAutoQuality('high');
        }
      } else if (gfx.dynamicScale <= gfx.minDynamic + 0.001 && gfx.qualityLevel === 'high' && !this.leanOn) {
        // High, lowest resolution, native output off, still short of 60: the lean tier (fewer 3D
        // trees, no grass blades, a smaller shadow atlas) — kept for the session, every circuit
        if (++aq.slowAtFloor >= 4) {
          aq.slowAtFloor = 0;
          this.leanOn = true;
          this.env.setLean(true);
          aq.settleUntil = now + 1.5;
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

/** a car's driver identity (a new name or helmet repaints it) */
function driverKey(e: Entry): string {
  return `${e.driver.code}|${e.driver.number}|${e.driver.helmet[0]}|${e.driver.helmet[1]}`;
}
/** Formula 2: a smaller, slower spec car than the F1 one (power and downforce down) */
function seriesSpec(spec: CarSpec): CarSpec {
  if (currentSeries() !== 'f2') return spec;
  return { ...spec, power: spec.power * 0.76, clA: spec.clA * 0.74 };
}
