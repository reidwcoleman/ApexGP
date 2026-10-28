import { TEAMS } from '../race/Teams.ts';
import type { QualityLevel } from '../core/Renderer.ts';
import type { CameraMode } from '../game/Cameras.ts';
import { CAMERA_LABEL, CAMERA_ORDER, DEFAULT_CAM, NO_OFFSET, driveCamera, type CamPrefs, type CamOffset } from '../game/Cameras.ts';
import { ALL_CIRCUITS, CIRCUITS, SCENIC, layoutPoints } from '../world/Circuits.ts';
import { fmtTime } from './HUD.ts';
import { PIT_RACE_LAPS, POINTS, type TrackLimitsMode } from '../race/Race.ts';
import { uiColor, type Entry } from '../race/Teams.ts';
import type { DamageMode } from '../sim/CarPhysics.ts';
import { ASSIST_PRESETS, DEFAULT_ASSISTS, PRESET_LABEL, PRESET_ORDER, presetOf, type AssistConfig } from '../game/Assists.ts';
import { COMPOUNDS, COMPOUND_ORDER, type Compound } from '../race/Pit.ts';
import { WEATHER_LABEL, TIME_LABEL, Weather, planWeather, type WeatherChoice, type TimeChoice, type TimeOfDay } from '../world/Weather.ts';
import { WX_ICON, WX_CHOICE_ICON } from './wxIcons.ts';
import { createSkyStage } from './skyStage.ts';
import { Career, UPGRADES, MAX_LEVEL, upgradeCost, PALETTE, PATTERNS, TEAM_PATTERNS, FINISHES, CARBON, PART_PAINTS, RIMS, SPONSORS, UNLOCK_POS, UNLOCK_ALL, SCENIC_STARS, TOUR_LAPS, medalFor, SETUP, type Paint, type RaceReward, type SetupPart } from '../career/Career.ts';
import { CAREER_LAPS, type Forecast } from '../career/Season.ts';
import { MOMENT_LABEL, type Highlights } from '../career/Highlights.ts';
import { artFor } from './loadingArt.ts';
import { openWizard, renderHub, renderRd, renderRoundSummary, renderStart } from './CareerHub.ts';
import { renderResearch } from './Research.ts';
import { renderTour, resetTour } from './Tour.ts';
import { LAP_CHOICES, type DriverCareer, type Contract, type RoundSummary } from '../career/DriverCareer.ts';
import type { PlayerDriver } from '../career/Series.ts';
import { BIND_PROMPT, BIND_STEPS, Binder, DEFAULT_CONTROLS, controlPrefs, deviceName, findDev, isWheelId, padSteer, pedal, wheelSteer, type ControlPrefs } from '../core/controllers.ts';

export interface RaceSetup {
  team: number;
  seat: 0 | 1;
  laps: number;
  difficulty: number; // index into DIFFICULTY
  grid: number; // index into GRID
  weather: WeatherChoice;
  time: TimeChoice;
  assists: AssistConfig;
  compound: Compound | 'auto';
  /** circuit id (see CIRCUITS) */
  track: string;
  /** crash damage */
  damage: DamageMode;
  /** track-limit rules */
  trackLimits: TrackLimitsMode;
  /** a World Tour round's sky: 'auto' (its own rolled forecast) or the player's pick */
  tourWx?: WeatherChoice | 'auto';
  tourTime?: TimeChoice | 'auto';
  /** save format: bumped when the defaults change in a way old saves should pick up */
  v?: number;
}

export type MotionBlurLevel = 'off' | 'subtle' | 'cinematic';
const MOTION_BLUR: MotionBlurLevel[] = ['off', 'subtle', 'cinematic'];
const MOTION_BLUR_LABEL: Record<MotionBlurLevel, string> = { off: 'Off', subtle: 'Subtle', cinematic: 'Cinematic' };

export interface Settings {
  /** save format: bumped when the defaults change in a way old saves should pick up */
  v?: number;
  quality: QualityLevel;
  /** true until the player picks a graphics level themselves: the game may step it down */
  autoQuality?: boolean;
  camera: CameraMode;
  /** camera tuning (Settings → Camera tuning) */
  cam?: CamPrefs;
  volume: number;
  /** background music level in the menus (0..1) */
  music: number;
  /** camera motion blur (missing = cinematic) */
  motionBlur?: MotionBlurLevel;
  /** Settings → Controls: wheel binding and calibration, pad shaping, rumble (missing = defaults) */
  controls?: Partial<ControlPrefs>;
}

/** quick-race distances (5 by default); the career offers the same from 5 up (DriverCareer LAP_CHOICES) */
export const LAPS = [3, 5, 10, 15, 20, 30];
/** AI level. Dynamic (the default) races at the player's own rating (career.aiSkill), learnt race by race */
export const DIFFICULTY = [
  { label: 'Dynamic', value: 0.96, dynamic: true },
  { label: 'Rookie', value: 0.925, dynamic: false },
  { label: 'Pro', value: 0.965, dynamic: false },
  // (Legend: the front of the field at each circuit's own limit (Race.limitedPace), sim-prepared,
  // metronomic, rarely a bad start; Elite a few tenths behind it)
  { label: 'Elite', value: 0.985, dynamic: false },
  { label: 'Legend', value: 1.0, dynamic: false },
];
/** the AI level a race with this setup runs at, and whether it adapts */
export function aiLevel(setup: RaceSetup, career: Career): { value: number; dynamic: boolean } {
  const d = DIFFICULTY[setup.difficulty] ?? DIFFICULTY[0];
  return d.dynamic ? { value: career.aiSkill, dynamic: true } : { value: d.value, dynamic: false };
}
const TRACK_LIMITS: TrackLimitsMode[] = ['lenient', 'strict', 'off'];
const TRACK_LIMITS_LABEL: Record<TrackLimitsMode, string> = { lenient: 'Lenient', strict: 'Strict', off: 'Off' };
/** the setup save format (2: dynamic AI, lenient track limits; 3: random weather and time of day; 4: medium braking assist, weather and time random again; 5: low braking assist; 6: low again for every save) */
const SETUP_V = 7;
const DEFAULT_SETUP: RaceSetup = { v: SETUP_V, team: 0, seat: 0, laps: 5, difficulty: 0, grid: 1, weather: 'random', time: 'random', assists: { ...DEFAULT_ASSISTS }, compound: 'auto', track: 'monza', damage: 'full', trackLimits: 'lenient' };
export const GRID = [
  { label: 'Pole position', slot: 0 },
  { label: 'Midfield', slot: 10 },
  { label: 'Back of the grid', slot: 21 },
  { label: 'Qualifying lap', slot: -1 },
];
const WEATHERS: WeatherChoice[] = [
  'random',
  'clear',
  'haze',
  'heatwave',
  'windy',
  'cloudy',
  'overcast',
  'mist',
  'fog',
  'frost',
  'sandstorm',
  'drying',
  'sunshower',
  'drizzle',
  'rain',
  'storm',
  'thunderstorm',
  'hail',
  'sleet',
  'flurries',
  'snow',
  'blizzard',
  'changeable',
];
const weatherLabel = (w: WeatherChoice) => (w === 'random' ? 'Random' : w === 'changeable' ? 'Changeable' : WEATHER_LABEL[w]);
const TIMES: TimeChoice[] = ['random', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];
const timeLabel = (t: TimeChoice) => (t === 'random' ? 'Random' : TIME_LABEL[t]);
const TIME_SHORT: Record<TimeOfDay, string> = { dawn: 'Dawn', morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', golden: 'Golden', sunset: 'Sunset', dusk: 'Twilight', night: 'Night' };
/** the briefing's sky families (the first is filled in per mode: Auto or Random, and Changeable) */
const WX_GROUPS: { id: string; label: string; kinds: (WeatherChoice | 'auto')[] }[] = [
  { id: 'mix', label: 'Mixed', kinds: [] },
  { id: 'dry', label: 'Dry', kinds: ['clear', 'haze', 'heatwave', 'cloudy', 'windy', 'overcast'] },
  { id: 'wet', label: 'Wet', kinds: ['drying', 'sunshower', 'drizzle', 'rain', 'storm', 'thunderstorm'] },
  { id: 'winter', label: 'Winter', kinds: ['frost', 'flurries', 'sleet', 'snow', 'blizzard'] },
  { id: 'wild', label: 'Murk & wild', kinds: ['mist', 'fog', 'hail', 'sandstorm'] },
];

/**
 * The race's weather lap by lap: the chosen sky simulated over the race's length (a fixed seed — the race
 * rolls its own, so this is the forecast, not a promise): what is falling, the track temperature, and a bar
 * for how hard it comes down.
 */
function forecastStrip(w: WeatherChoice, t: TimeChoice, laps: number, km: number): string {
  if (w === 'random') return '<div class="fc-none">The weather is rolled when the lights go out.</div>';
  const lapS = (km / 205) * 3600;
  const dur = Math.max(1, laps) * lapS;
  const tod: TimeOfDay = t === 'random' ? 'afternoon' : t;
  const wx = new Weather(planWeather(w, tod, dur, 7));
  const N = Math.min(6, Math.max(2, laps + 1));
  const cols: string[] = [];
  let simT = 0;
  for (let i = 0; i < N; i++) {
    const at = (dur * i) / (N - 1);
    while (simT < at - 1e-3) {
      const dt = Math.min(5, at - simT);
      wx.update(dt);
      simT += dt;
    }
    const s = wx.state;
    const fall = Math.max(s.rain, s.snow ?? 0, s.hail ?? 0, s.dust ?? 0);
    const kind = (s.dust ?? 0) > 0.2 ? 'dust' : (s.hail ?? 0) > 0.2 ? 'hail' : (s.snow ?? 0) > s.rain ? 'snow' : 'rain';
    const surf = (s.snowCover ?? 0) > 0.35 && (s.snow ?? 0) > 0.05 ? 'Slush' : s.wetness > 0.55 ? 'Wet' : s.wetness > 0.12 ? 'Damp' : 'Dry';
    const lap = i === 0 ? 'Start' : i === N - 1 ? 'Finish' : `Lap ${Math.max(1, Math.round((laps * i) / (N - 1)))}`;
    cols.push(
      `<div class="fc-col"><span class="fc-lap">${lap}</span><svg viewBox="0 0 16 16">${WX_ICON[s.kind]}</svg>` +
        `<b>${Math.round(s.trackTemp)}°</b><i class="fc-bar ${kind}" style="--h:${fall > 0.02 ? Math.max(0.12, Math.min(1, fall)) : 0}"></i><span class="fc-surf ${surf.toLowerCase()}">${surf}</span></div>`,
    );
  }
  return `<div class="fc-k">Race forecast</div><div class="fc-row">${cols.join('')}</div>`;
}
const TYRE_CHOICES: (Compound | 'auto')[] = ['auto', ...COMPOUND_ORDER];
const QUALITY: QualityLevel[] = ['low', 'medium', 'high', 'ultra', 'tuned'];
const SETTINGS_V = 3;
const DAMAGE: DamageMode[] = ['full', 'cosmetic', 'off'];
const DAMAGE_LABEL: Record<DamageMode, string> = { full: 'Full · cars can be destroyed', cosmetic: 'Visual only', off: 'Off' };

type ScreenId = 'title' | 'setup' | 'settings' | 'assists' | 'camera' | 'controls' | 'pause' | 'results' | 'none';
/** Settings → Controls → wheel rotation choices (degrees lock to lock: the common wheel-base settings) */
const WHEEL_ROTATIONS = [180, 270, 360, 450, 540, 720, 900, 1080];

interface Item {
  el: HTMLElement;
  kind: 'action' | 'option';
  select?: () => void;
  change?: (dir: number) => void;
}

export interface MenuCallbacks {
  onSetupChange(setup: RaceSetup): void;
  /** what the rolled forecast is, shown next to a 'Random' weather / time choice */
  forecast(): { weather: string; time: string };
  onStart(mode: 'race' | 'timetrial' | 'career', setup: RaceSetup): void;
  onSettings(s: Settings): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onResetCar(): void;
  onUi(kind: 'move' | 'select' | 'back'): void;
  /** the garage: which tab is open (the camera frames the car for it) */
  onHubTab(tab: HubTab): void;
  /** the player's car changed (upgrade bought or paint changed): rebuild it */
  onCarChange(): void;
  /** go to another (unlocked) circuit: the world is rebuilt */
  onTravel(track: string): void;
  /** the set-up page is looking at this part of the car (null = the whole car) */
  onFocusPart(part: SetupPart | null): void;
  /** play this highlight on the garage wall */
  onPlayHighlight(id: string): void;
  /** the highlight on the garage wall right now */
  nowPlaying?(): string | null;
  /** the garage tour takes the keys while it runs (returns true when it used them) */
  tourNav?(nav: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean }): boolean;
  /** watch a simulated race (every car on AI, broadcast cameras) */
  onSpectate?(setup: RaceSetup): void;
  /** a career round's weekend forecast (rolled from the circuit's climate, new every race there) */
  careerForecast(track: string): Forecast;
  /** race this career round: travel there if needed, then open the career race screen */
  onCareerRace(track: string): void;
  /** a time trial at an open circuit: travel there if needed, then open its session screen */
  onTimeTrial?(track: string): void;
  /** the session at a glance for the pause screen (circuit, session kind, a few numbers) */
  pauseInfo?(): { title: string; kind: string; stats: [string, string][] } | null;
  /** the driver career (the game's main mode) */
  driverCareer?(): DriverCareer;
  /** a new driver career from the wizard */
  onCareerStart?(driver: PlayerDriver, contract: Contract): void;
  /** the career changed (an answer, a signature, a new season): the game re-syncs its grid */
  onCareerChanged?(): void;
}

/** menu navigation edges (src/core/Input.ts) */
type MenuNav = { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean; tabL?: boolean; tabR?: boolean };

export type HubTab = 'home' | 'career' | 'highlights' | 'car' | 'setup' | 'paint' | 'settings';
const HUB_TABS: { id: HubTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'career', label: 'Career' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'car', label: 'Research' },
  { id: 'setup', label: 'Set-up' },
  { id: 'paint', label: 'Paint shop' },
  { id: 'settings', label: 'Settings' },
];

/** facts for the circuit cards */
export const CIRCUIT_INFO: Record<string, { country: string; km: string; turns: number; line: string }> = {
  monza: { country: 'Italy', km: '5.793', turns: 11, line: 'The Temple of Speed' },
  spa: { country: 'Belgium', km: '7.004', turns: 19, line: 'Eau Rouge, Raidillon and the Ardennes' },
  silverstone: { country: 'Great Britain', km: '5.891', turns: 18, line: 'Maggotts, Becketts and Chapel' },
  suzuka: { country: 'Japan', km: '5.807', turns: 18, line: 'The S Curves, Spoon and 130R' },
  interlagos: { country: 'Brazil', km: '4.309', turns: 15, line: 'The S do Senna, the lake and the climb to the line' },
  spielberg: { country: 'Austria', km: '4.318', turns: 10, line: 'Up the hill to Remus, down through Rauch and Würth' },
  zandvoort: { country: 'Netherlands', km: '4.259', turns: 14, line: 'Tarzan, the dunes and the banked Hugenholtz' },
  austin: { country: 'United States', km: '5.513', turns: 20, line: 'The climb to Turn 1, the esses and the Tower' },
  montreal: { country: 'Canada', km: '4.361', turns: 14, line: 'The Senna S, the hairpin and the Wall of Champions' },
  melbourne: { country: 'Australia', km: '5.278', turns: 14, line: 'Around the lake in Albert Park, the city skyline beyond' },
  sakhir: { country: 'Bahrain', km: '5.412', turns: 15, line: 'Floodlights over the desert, three heavy stops' },
  yasmarina: { country: 'Abu Dhabi', km: '5.554', turns: 21, line: 'Twilight at the marina, under the Yas hotel' },
  mexico: { country: 'Mexico', km: '4.304', turns: 17, line: 'Thin air, the long run to Turn 1 and the Foro Sol' },
  hungaroring: { country: 'Hungary', km: '4.381', turns: 14, line: 'Twisting through the hills outside Budapest' },
  serena: { country: 'Riviera', km: '4.845', turns: 16, line: 'Clifftop road above the sea, round the lighthouse and up the switchbacks' },
  bergsee: { country: 'Alps', km: '4.487', turns: 14, line: 'Along the glacier lake, up through the spruce under snowy peaks' },
  redmesa: { country: 'High desert', km: '5.723', turns: 11, line: 'Flat out across the plain, down into the wash among the buttes' },
};

const fmtCr = (n: number) => '₵\u2009' + Math.round(n).toLocaleString('en-US');

/** a circuit's outline as an SVG path, fitted to a w × h box */
export function circuitPath(points: number[], w: number, h: number, pad = 4): string {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]);
    z0 = Math.min(z0, points[i + 1]); z1 = Math.max(z1, points[i + 1]);
  }
  const k = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (z1 - z0));
  const ox = (w - (x1 - x0) * k) / 2, oz = (h - (z1 - z0) * k) / 2;
  let d = '';
  for (let i = 0; i < points.length; i += 8) d += `${i ? 'L' : 'M'}${(ox + (points[i] - x0) * k).toFixed(1)} ${(oz + (points[i + 1] - z0) * k).toFixed(1)}`;
  return d + 'Z';
}

/** readable ink on a colour */
function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#0a0c11' : '#ffffff';
}

/** "Rain · Afternoon" */
function fcLabel(f: Forecast): string {
  return `${weatherLabel(f.weather)} · ${timeLabel(f.time)}`;
}

export interface ResultRow {
  pos: number;
  entry: Entry;
  isPlayer: boolean;
  laps: number;
  time: number;
  gap: number;
  best: number;
  penalty: number;
  fastest: boolean;
  /** retired from the race */
  dnf?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export class Menu {
  readonly root: HTMLDivElement;
  screen: ScreenId = 'none';
  setup: RaceSetup;
  settings: Settings;
  private mode: 'race' | 'timetrial' | 'career' = 'race';
  private cb: MenuCallbacks;
  private screens = new Map<ScreenId, HTMLDivElement>();
  private items: Item[] = [];
  private sel = 0;
  private settingsReturn: ScreenId = 'title';
  private assistsReturn: ScreenId = 'setup';
  /** the race briefing's live parts (facts, the sky card): redrawn when the set-up changes */
  private briefRefresh: (() => void) | null = null;
  private controlsReturn: ScreenId = 'settings';
  /** the Controls screen's live-input loop, and the wheel binding in progress */
  private ctlRaf = 0;
  private binder: Binder | null = null;
  private bindKeys: ((e: KeyboardEvent) => void) | null = null;
  private driverCard!: HTMLDivElement;

  readonly career: Career;
  highlights: Highlights | null = null;
  /** the garage opens on Home: just the car, and the one thing to do next */
  hubTab: HubTab = 'home';
  private focusedPart: SetupPart | null | undefined = undefined;
  private hubFocus: 'tabs' | 'panel' = 'tabs';
  private hubTabs: HTMLElement[] = [];
  private hubPanel: HTMLElement | null = null;
  private hubCredits: HTMLElement | null = null;

  constructor(parent: HTMLElement, cb: MenuCallbacks, career: Career) {
    this.cb = cb;
    this.career = career;
    this.root = el('div', '', parent);
    this.root.id = 'menu';
    // (v: 0 here so a save without a version reads as an old one)
    this.setup = load<RaceSetup>('apexgp.setup', { ...DEFAULT_SETUP, v: 0, assists: { ...DEFAULT_ASSISTS } });
    // saves from before the current defaults: pick up the new assists,
    // Dynamic AI and lenient track limits once; everything else the player chose stays
    const sv = this.setup.v ?? 0;
    if (sv < 2) this.setup = { ...this.setup, assists: { ...DEFAULT_ASSISTS }, difficulty: 0, trackLimits: 'lenient' };
    // every race different: the weather and the light are rolled fresh each time (once; a player's own choice after this stays)
    if (sv < 3) this.setup = { ...this.setup, weather: 'random', time: 'random' };
    // the medium braking assist is the default now (and the sky changes every race again)
    if (sv < 4) this.setup = { ...this.setup, weather: 'random', time: 'random', assists: { ...DEFAULT_ASSISTS, ...(this.setup.assists ?? {}), braking: 'medium' } };
    // and then low: the assist leaves most of the braking to the player
    if (sv < 5) this.setup = { ...this.setup, assists: { ...DEFAULT_ASSISTS, ...(this.setup.assists ?? {}), braking: 'low' } };
    // (6: the braking assist back to its default, low, on every save)
    if (sv < 6) this.setup = { ...this.setup, assists: { ...DEFAULT_ASSISTS, ...(this.setup.assists ?? {}), braking: 'low' } };
    // (7: realistic driving — the real handling and steering — is the default; a Simulation save stays)
    if (sv < 7 && presetOf(this.setup.assists) !== 'expert') this.setup = { ...this.setup, assists: { ...DEFAULT_ASSISTS } };
    if (sv < SETUP_V) {
      this.setup.v = SETUP_V;
      save('apexgp.setup', this.setup);
    }
    if (!(this.setup.difficulty >= 0 && this.setup.difficulty < DIFFICULTY.length)) this.setup.difficulty = 0;
    if (!TRACK_LIMITS.includes(this.setup.trackLimits)) this.setup.trackLimits = 'lenient';
    if (!DAMAGE.includes(this.setup.damage)) this.setup.damage = 'full';
    // saves from before per-assist settings stored a preset index
    if (!this.setup.compound) this.setup.compound = 'auto';
    if (!ALL_CIRCUITS.some((c) => c.id === this.setup.track)) this.setup.track = CIRCUITS[0].id;
    // (a save from when every circuit was open may sit at one the career hasn't reached yet)
    if (!career.isUnlocked(this.setup.track)) this.setup.track = career.nextRound() ?? CIRCUITS[0].id;
    // saves from before the weather system
    if (!WEATHERS.includes(this.setup.weather)) this.setup.weather = 'random';
    if (!TIMES.includes(this.setup.time)) this.setup.time = 'random';
    if (typeof this.setup.assists !== 'object' || this.setup.assists === null) this.setup.assists = { ...DEFAULT_ASSISTS };
    else this.setup.assists = { ...DEFAULT_ASSISTS, ...this.setup.assists };
    this.settings = load<Settings>('apexgp.settings', { v: SETTINGS_V, quality: 'high', camera: 'chase', volume: 0.8, music: 0.35, autoQuality: true });
    // (driving cameras only: a save from before may hold the helicopter, the tactical map or the TV director)
    this.settings.camera = driveCamera(this.settings.camera);
    if (typeof this.settings.music !== 'number') this.settings.music = 0.35;
    if (this.settings.autoQuality === undefined) this.settings.autoQuality = true;
    // older saves may have been stepped down by the automatic quality: start again from High
    if ((this.settings.v ?? 0) < SETTINGS_V) {
      this.settings = { ...this.settings, v: SETTINGS_V, quality: this.settings.quality === 'ultra' || this.settings.quality === 'tuned' ? this.settings.quality : 'high', autoQuality: true };
      save('apexgp.settings', this.settings);
    }
    for (const id of ['title', 'setup', 'settings', 'assists', 'camera', 'controls', 'pause', 'results'] as ScreenId[]) {
      const s = el('div', 'screen', this.root);
      this.screens.set(id, s);
    }
  }

  // ------------------------------------------------------------ screens

  show(id: ScreenId) {
    this.endControls();
    this.screen = id;
    for (const [k, s] of this.screens) s.classList.toggle('on', k === id);
    this.items = [];
    this.sel = 0;
    if (id === 'title') {
      this.hubFocus = 'tabs';
      this.buildTitle();
    }
    if (id === 'setup') this.buildSetup();
    if (id === 'settings') this.buildSettings();
    if (id === 'assists') this.buildAssists();
    if (id === 'camera') this.buildCameraPrefs();
    if (id === 'controls') this.buildControls();
    if (id === 'pause') this.buildPause();
    this.highlight();
  }

  // ------------------------------------------------------------ the garage (title screen)

  /** the line under the driver's name: the career's season, else the quick-race tally */
  private careerSub(c: { races: number; points: number }): string {
    const dc = this.cb.driverCareer?.();
    if (dc?.data) {
      const { pos, points } = dc.position();
      return `${dc.data.series === 'f2' ? 'Formula 2' : 'Formula 1'} ${dc.data.year}${pos ? ` · P${pos} · ${points} pts` : ''}`;
    }
    return c.races ? `${c.races} race${c.races === 1 ? '' : 's'} · ${c.points} pts` : 'Rookie season';
  }
  /** the new-career wizard is open (it takes the keys) */
  private wizardOpen = false;
  /** open the new-career wizard */
  openCareerWizard() {
    if (this.wizardOpen) return;
    this.wizardOpen = true;
    openWizard(document.body, {
      onDone: (driver, contract) => {
        this.wizardOpen = false;
        this.cb.onCareerStart?.(driver, contract);
      },
      onCancel: () => {
        this.wizardOpen = false;
      },
      onUi: (k) => this.cb.onUi(k),
    });
  }

  private buildTitle() {
    // (back in the garage: the career map opens on the round you're working on)
    resetTour();
    const s = this.screens.get('title')!;
    s.innerHTML = '';
    s.classList.add('hub');
    const team = TEAMS[this.setup.team];
    const d = team.drivers[this.setup.seat];
    const paint = this.career.paintFor(this.setup.team);
    const accent = paint ? (paint.primary === '#111214' || paint.primary === '#2a2d33' ? paint.secondary : paint.primary) : uiColor(team);
    s.style.setProperty('--accent', accent);
    s.style.setProperty('--on-accent', onColor(accent));
    if (!s.querySelector(':scope > .hub-scrim')) s.prepend(el('div', 'hub-scrim'));
    const c = this.career.data;
    // the nameplate, bottom-left: the number big in the team colour, the surname bigger still
    el(
      'div',
      'hub-id',
      s,
      `<div class="num">${this.career.paintFor(this.setup.team)?.number ?? d.number}</div><div class="who"><div class="first">${d.first}</div><div class="name">${d.last}</div><div class="sub"><span>${team.name}</span><span>${this.careerSub(c)}</span></div></div>`,
    );
    // the bar across the top: the brand, the tabs (Q / E or the bumpers step through them), the credits
    const top = el('div', 'hub-top', s);
    el('div', 'hub-brand', top, 'Apex<span>GP</span>');
    const rail = el('div', 'hub-rail', top);
    el('kbd', 'hub-bump', rail, 'Q');
    this.hubTabs = HUB_TABS.map((t, i) => {
      const e = el('div', 'htab', rail, t.label);
      e.addEventListener('click', () => {
        this.setTab(HUB_TABS[i].id);
        this.hubFocus = 'panel';
        this.sel = 0;
        this.highlight();
      });
      return e;
    });
    el('kbd', 'hub-bump', rail, 'E');
    this.hubCredits = el('div', 'hub-credits', top);
    this.renderCredits();
    this.hubPanel = el('div', 'hub-panel', s);
    el('div', 'keys hub-keys', s, '<span><kbd>Q</kbd><kbd>E</kbd> tabs</span><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> select</span><span><kbd>←</kbd><kbd>→</kbd> change</span><span><kbd>Esc</kbd> back</span><span><kbd>Drag</kbd><kbd>Scroll</kbd> look around the car</span>');
    this.setTab(this.hubTab);
  }

  private renderCredits() {
    if (!this.hubCredits) return;
    const dc = this.cb.driverCareer?.();
    this.hubCredits.innerHTML = dc?.active
      ? `<div class="cap">Research</div><div class="val">${dc.data!.rp} RP</div>`
      : `<div class="cap">Credits</div><div class="val">${fmtCr(this.career.data.credits)}</div>`;
  }

  setTab(tab: HubTab) {
    this.hubTab = tab;
    this.hubTabs.forEach((e, i) => e.classList.toggle('on', HUB_TABS[i].id === tab));
    this.cb.onHubTab(tab);
    this.renderTab();
  }

  private renderTab() {
    const p = this.hubPanel;
    if (!p) return;
    p.innerHTML = '';
    p.className = this.hubTab === 'home' ? 'hub-panel home' : 'hub-panel glass' + (this.hubTab === 'career' || this.hubTab === 'car' ? ' wide' : '');
    p.style.backgroundImage = '';
    p.style.removeProperty('--team');
    void p.offsetWidth;
    p.classList.add('in');
    this.items = [];
    this.sel = Math.min(this.sel, 0);
    if (this.hubTab === 'home') this.tabHome(p);
    else if (this.hubTab === 'career') this.tabCareer(p);
    else if (this.hubTab === 'car') this.tabCar(p);
    else if (this.hubTab === 'paint') this.tabPaint(p);
    else if (this.hubTab === 'highlights') this.tabHighlights(p);
    else if (this.hubTab === 'setup') this.tabSetup(p);
    else this.tabSettings(p);
    this.highlight();
  }

  private action(e: HTMLElement, fn: () => void, disabled = false) {
    const idx = this.items.length;
    if (disabled) e.classList.add('dis');
    this.items.push({ el: e, kind: 'action', select: () => (disabled ? this.cb.onUi('back') : fn()) });
    e.addEventListener('click', () => {
      this.hubFocus = 'panel';
      this.sel = idx;
      this.highlight();
      if (disabled) return this.cb.onUi('back');
      this.cb.onUi('select');
      fn();
    });
    e.addEventListener('mouseenter', () => {
      this.hubFocus = 'panel';
      this.sel = idx;
      this.highlight();
    });
  }

  /**
   * The career: the season as a map (the driver career's hub, its Overview the map of the rounds,
   * each unlocked by a top-five finish at the one before). Without a career yet, the map of the
   * season to come and the way in.
   */
  /**
   * Home: the garage and the car, nothing over it but the one thing to do next — the next career
   * round (or the way into a career), a quick race at this circuit as the quiet alternative.
   */
  private tabHome(p: HTMLElement) {
    const dc = this.cb.driverCareer?.();
    const nt = dc?.active ? dc.nextTrack : null;
    const cd = ALL_CIRCUITS.find((c) => c.id === (nt ?? this.setup.track)) ?? CIRCUITS[0];
    const info = CIRCUIT_INFO[cd.id];
    const box = el('div', 'home-next', p);
    if (dc?.active && nt) {
      const d = dc.data!;
      el('div', 'eyebrow', box, `Next up · Round ${d.round + 1} of ${d.calendar.length}`);
      el('div', 'title', box, cd.name);
      el('div', 'meta', box, `${info?.country ?? cd.country} · ${dc.laps} laps · ${fcLabel(this.cb.careerForecast(cd.id))}`);
      const go = el('div', 'cta home-go', box, 'Race weekend');
      this.action(go, () => this.cb.onCareerRace(nt));
    } else if (dc?.active) {
      el('div', 'eyebrow', box, 'Season complete');
      el('div', 'title', box, 'See where you finished');
      const go = el('div', 'cta home-go', box, 'Career');
      this.action(go, () => this.setTab('career'));
    } else {
      // the World Tour: the next circuit to win your way through, or the tour complete
      const tn = this.career.nextRound();
      const tc = tn ? ALL_CIRCUITS.find((c) => c.id === tn)! : null;
      const st = this.career.stars();
      const pz = this.career.passes();
      el('div', 'eyebrow', box, `World Tour · ${this.career.rank().name} · ${st} of ${this.career.maxStars()} stars`);
      el('div', 'title', box, tc ? `Next up: ${tc.short}` : pz ? 'Open a new circuit' : 'Go for the wins');
      el('div', 'meta', box, pz ? `You have ${pz} Tour pass${pz === 1 ? '' : 'es'}: open any circuit on the map.` : tc ? `Top ${UNLOCK_POS} at ${tc.short} earns a star and a Tour pass to open any circuit.` : 'Every win is three stars. Race any open circuit, in any order.');
      const go = el('div', 'cta home-go', box, tc ? `Race ${tc.short}` : 'World Tour');
      this.action(go, () => (tc ? this.cb.onCareerRace(tc.id) : this.setTab('career')));
      const map = el('div', 'home-quick', box, 'World Tour map ›');
      this.action(map, () => this.setTab('career'));
    }
    // the open world: its own page, so none of the race world loads with it
    const ow = el('div', 'home-ow', p);
    el('div', 'eyebrow', ow, 'Open world');
    el('div', 'ow-title', ow, 'Miami');
    el('div', 'meta', ow, 'Brickell to South Beach in the Roadster — it flies. Traffic, police, helicopters, boats.');
    const drive = el('div', 'home-quick', ow, 'Drive Miami ›');
    this.action(drive, () => {
      location.href = './miami.html';
    });
    this.sel = 0;
  }

  private tabCareer(p: HTMLElement) {
    const dc = this.cb.driverCareer?.();
    if (dc?.active) {
      renderHub(p, {
        dc,
        action: (e, fn, dis) => this.action(e, fn, dis),
        onRace: (id) => this.cb.onCareerRace(id),
        onQuickRace: (id) => {
          this.setTab('career');
          if (id !== this.setup.track) {
            this.setup.track = id;
            save('apexgp.setup', this.setup);
            this.cb.onTravel(id);
          }
        },
        onNewCareer: () => this.openCareerWizard(),
        changed: () => {
          this.cb.onCareerChanged?.();
          this.buildTitle();
        },
        rerender: () => {
          this.renderTab();
        },
        onDevelop: () => this.setTab('car'),
        forecast: (id) => fcLabel(this.cb.careerForecast(id)),
        circuitPath: (pts) => circuitPath(pts, 120, 84, 6),
        info: (id) => CIRCUIT_INFO[id] ?? { country: ALL_CIRCUITS.find((c) => c.id === id)?.country ?? '', km: '', turns: 0 },
      });
      this.sel = 0;
      return;
    }
    // the World Tour: the world map of circuits, each opened by a top-five finish at the one before
    const before = this.items.length;
    const { go } = renderTour(p, {
      career: this.career,
      action: (e, fn, dis) => this.action(e, fn, dis),
      onRace: (id) => this.cb.onCareerRace(id),
      onTimeTrial: (id) => {
        this.setup.track = id;
        save('apexgp.setup', this.setup);
        this.cb.onTimeTrial?.(id);
      },
      onWatch: this.cb.onSpectate ? () => this.cb.onSpectate?.({ ...this.setup }) : undefined,
      rerender: () => {
        this.renderTab();
        this.renderCredits();
      },
      sound: (k) => this.cb.onUi(k),
      forecast: (id) => fcLabel(this.cb.careerForecast(id)),
      info: (id) => CIRCUIT_INFO[id] ?? { country: ALL_CIRCUITS.find((c) => c.id === id)?.country ?? '', km: '', turns: 0 },
      circuitPath,
      layoutPoints,
    });
    // (focus starts on the race button)
    this.sel = Math.max(before, this.items.findIndex((it) => it.el === go));
  }

  private tabCar(p: HTMLElement) {
    const dc = this.cb.driverCareer?.();
    if (dc?.active) {
      // a driver career: the team's research points into the car
      renderRd(p, {
        dc,
        action: (e, fn, dis) => this.action(e, fn, dis),
        changed: () => {
          this.cb.onCareerChanged?.();
          this.cb.onCarChange();
          const keep = this.sel;
          this.renderCredits();
          this.renderTab();
          this.sel = keep;
          this.highlight();
          this.items[keep]?.el.classList.add('bought');
        },
      });
      return;
    }
    renderResearch(p, {
      career: this.career,
      action: (e, fn, dis) => this.action(e, fn, dis),
      fmtCr,
      sound: (k) => this.cb.onUi(k),
      researched: () => {
        this.cb.onCarChange();
        this.cb.onUi('select');
        const keep = this.sel;
        this.renderCredits();
        this.renderTab();
        this.sel = keep;
        this.highlight();
      },
    });
  }

  private paintSec: 'colours' | 'design' | 'details' | 'number' = 'colours';
  private tabPaint(p: HTMLElement) {
    const team = TEAMS[this.setup.team];
    const driver = team.drivers[this.setup.seat] ?? team.drivers[0];
    const cur: Paint = { ...(this.career.paintFor(this.setup.team) ?? { primary: team.primary, secondary: team.secondary, accent: team.accent, pattern: team.pattern, finish: team.matte > 0.6 ? 'matte' : 'gloss' }) };
    const custom = !!this.career.paintFor(this.setup.team);
    p.classList.add('paintshop');
    el('div', 'hp-cap', p, `Paint shop · ${custom ? 'Your livery' : team.name + ' livery'}`);
    let timer = 0;
    const commit = (wait = 140) => {
      this.career.setPaint(this.setup.team, { ...cur });
      clearTimeout(timer);
      timer = window.setTimeout(() => this.cb.onCarChange(), wait);
      const hub = this.screens.get('title')!;
      const a = cur.primary === '#111214' || cur.primary === '#2a2d33' ? cur.secondary : cur.primary;
      hub.style.setProperty('--accent', a);
      hub.style.setProperty('--on-accent', onColor(a));
    };
    // the sections, as a segmented bar
    const SECS = [
      { id: 'colours', name: 'Colours' },
      { id: 'design', name: 'Design' },
      { id: 'details', name: 'Details' },
      { id: 'number', name: 'Number' },
    ] as const;
    const seg = el('div', 'ps-seg', p);
    for (const sc of SECS) {
      const b = el('div', 'ps-tab' + (sc.id === this.paintSec ? ' on' : ''), seg, sc.name);
      this.action(b, () => {
        if (this.paintSec === sc.id) return;
        this.paintSec = sc.id;
        const keep = this.sel;
        this.renderTab();
        this.sel = keep;
        this.highlight();
      });
    }
    /** a row the arrows step through (change) */
    const optRow = (row: HTMLElement, change: (d: number) => void) => {
      const idx = this.items.length;
      this.items.push({ el: row, kind: 'option', change: (d) => { change(d); this.cb.onUi('move'); }, select: () => {} });
      row.addEventListener('mouseenter', () => {
        this.hubFocus = 'panel';
        this.sel = idx;
        this.highlight();
      });
    };
    const swatches = (label: string, get: () => string, set: (c: string) => void) => {
      const row = el('div', 'prow', p);
      el('div', 'pk', row, label);
      const wrap = el('div', 'sw', row);
      const draw = () => {
        wrap.innerHTML = '';
        const now = get().toLowerCase();
        PALETTE.forEach((c) => {
          const b = el('i', c.toLowerCase() === now ? 'on' : '', wrap);
          b.style.background = c;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            set(c);
            commit();
            draw();
          });
        });
        // any colour at all: the system picker
        const own = !PALETTE.some((c) => c.toLowerCase() === now);
        const pk = el('label', 'pick' + (own ? ' on' : ''), wrap);
        pk.title = 'Any colour';
        if (own) pk.style.background = get();
        const inp = el('input', '', pk);
        inp.type = 'color';
        inp.value = get();
        inp.addEventListener('input', () => {
          set(inp.value);
          pk.style.background = inp.value;
          commit(260);
        });
        inp.addEventListener('change', () => draw());
      };
      draw();
      optRow(row, (d) => {
        let i = PALETTE.findIndex((c) => c.toLowerCase() === get().toLowerCase());
        i = (i < 0 ? 0 : i + d + PALETTE.length) % PALETTE.length;
        set(PALETTE[i]);
        commit();
        draw();
      });
    };
    const chips = <T extends string>(label: string, list: readonly { id: T; name: string }[], get: () => T, set: (v: T) => void, cls = '') => {
      const row = el('div', 'prow ' + cls, p);
      el('div', 'pk', row, label);
      const wrap = el('div', 'chips', row);
      const draw = () => {
        wrap.innerHTML = '';
        for (const it of list) {
          const b = el('span', it.id === get() ? 'on' : '', wrap, it.name);
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            set(it.id);
            commit();
            draw();
          });
        }
      };
      draw();
      optRow(row, (d) => {
        const i = Math.max(0, list.findIndex((x) => x.id === get()));
        set(list[(i + d + list.length) % list.length].id);
        commit();
        draw();
      });
    };
    if (this.paintSec === 'colours') {
      swatches('Base', () => cur.primary, (c) => (cur.primary = c));
      swatches('Secondary', () => cur.secondary, (c) => (cur.secondary = c));
      swatches('Accent', () => cur.accent, (c) => (cur.accent = c));
      chips('Finish', FINISHES, () => cur.finish, (v) => (cur.finish = v));
    } else if (this.paintSec === 'design') {
      chips('Design', PATTERNS, () => cur.pattern, (v) => (cur.pattern = v), 'wide');
      chips('Grid layouts', TEAM_PATTERNS, () => cur.pattern, (v) => (cur.pattern = v), 'wide');
      chips('Bare carbon', CARBON, () => cur.carbon ?? (team.carbon > 0.45 ? 'lots' : team.carbon > 0.1 ? 'some' : 'none'), (v) => (cur.carbon = v));
    } else if (this.paintSec === 'details') {
      chips('Halo', PART_PAINTS, () => cur.halo ?? 'team', (v) => (cur.halo = v));
      chips('Front wing', PART_PAINTS, () => cur.wing ?? 'team', (v) => (cur.wing = v));
      chips('Wheel rings', RIMS, () => cur.rim ?? 'team', (v) => (cur.rim = v));
      swatches('Helmet', () => (cur.helmet ?? driver.helmet)[0], (c) => (cur.helmet = [c, (cur.helmet ?? driver.helmet)[1]]));
      swatches('Helmet stripe', () => (cur.helmet ?? driver.helmet)[1], (c) => (cur.helmet = [(cur.helmet ?? driver.helmet)[0], c]));
    } else {
      // the race number: big, stepped with the arrows or typed
      const row = el('div', 'prow ps-num', p);
      el('div', 'pk', row, 'Race number');
      const box = el('div', 'num-box', row);
      const dn = el('span', 'chev', box, '‹');
      const val = el('input', 'num-in', box);
      val.type = 'text';
      val.inputMode = 'numeric';
      val.maxLength = 2;
      const up = el('span', 'chev', box, '›');
      const num = () => cur.number ?? driver.number;
      const show = () => (val.value = String(num()));
      show();
      const step = (d: number) => {
        cur.number = ((num() - 1 + d + 99) % 99) + 1;
        show();
        commit(450);
      };
      dn.addEventListener('click', (e) => (e.stopPropagation(), step(-1)));
      up.addEventListener('click', (e) => (e.stopPropagation(), step(1)));
      val.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') val.blur();
      });
      val.addEventListener('input', () => {
        const n = parseInt(val.value.replace(/\D/g, ''), 10);
        if (n >= 1 && n <= 99) {
          cur.number = n;
          commit(600);
        }
      });
      val.addEventListener('blur', show);
      optRow(row, step);
      // the title sponsor: typed, or one of the suggestions
      const srow = el('div', 'prow ps-spon', p);
      el('div', 'pk', srow, 'Title sponsor');
      const inp = el('input', 'spon-in', srow);
      inp.type = 'text';
      inp.maxLength = 10;
      inp.spellcheck = false;
      inp.placeholder = team.sponsor;
      inp.value = cur.sponsor ?? '';
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') inp.blur();
      });
      inp.addEventListener('input', () => {
        inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9 &.-]/g, '');
        cur.sponsor = inp.value;
        for (const k of Array.from(sugg.children)) k.classList.toggle('on', k.textContent === (inp.value || team.sponsor));
        commit(700);
      });
      const sugg = el('div', 'chips', srow);
      for (const sp of SPONSORS) {
        const b = el('span', sp === (cur.sponsor || team.sponsor) ? 'on' : '', sugg, sp);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          cur.sponsor = sp;
          inp.value = sp;
          for (const k of Array.from(sugg.children)) k.classList.toggle('on', k === b);
          commit();
        });
      }
      optRow(srow, (d) => {
        const i = SPONSORS.indexOf(cur.sponsor || team.sponsor);
        cur.sponsor = SPONSORS[(i + d + SPONSORS.length) % SPONSORS.length];
        inp.value = cur.sponsor;
        for (const k of Array.from(sugg.children)) k.classList.toggle('on', k.textContent === cur.sponsor);
        commit();
      });
      el('div', 'hp-note', p, 'The number goes on the nose, the fin and the halo; the sponsor on the sidepods, the wings and the helmet.');
    }
    const reset = el('div', 'cta ghost', p, 'Restore team livery');
    this.action(reset, () => {
      this.career.setPaint(this.setup.team, null);
      this.cb.onCarChange();
      this.buildTitle();
      this.hubFocus = 'panel';
      this.highlight();
    }, !custom);
  }

  private tabHighlights(p: HTMLElement) {
    const list = this.highlights?.list ?? [];
    el('div', 'hp-cap', p, list.length ? `Highlights <span class="hp-count">${list.length} clip${list.length === 1 ? '' : 's'}</span>` : 'Highlights');
    if (!list.length) {
      el('div', 'hp-empty', p, '<b>No highlights yet</b>Overtakes, taking the lead, fastest laps, the chequered flag and the podium are filmed as you race, and play on the video wall behind your car.');
      const go = el('div', 'cta ghost', p, 'Go racing');
      this.action(go, () => this.setTab('career'));
      return;
    }
    const playing = this.cb.nowPlaying?.() ?? null;
    for (const h of list.slice(0, 12)) {
      const row = el('div', 'hlrow' + (h.id === playing ? ' playing' : ''), p);
      row.dataset.id = h.id;
      const when = new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const secs = Math.max(1, Math.round(h.duration || 0));
      const poster = this.highlights?.posterUrl(h) ?? '';
      row.innerHTML =
        `<div class="hl-thumb">${poster ? `<img src="${poster}" alt="">` : ''}<span class="hl-dur">0:${String(secs).padStart(2, '0')}</span><span class="hl-play"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg></span><span class="hl-eq"><i></i><i></i><i></i></span></div>` +
        `<div class="hl-text"><div class="hk"><span>${MOMENT_LABEL[h.kind]}</span><time>${when}</time></div><div class="ht">${h.title}</div><div class="hs">${h.sub}</div></div>`;
      this.action(row, () => {
        this.cb.onPlayHighlight(h.id);
        this.markPlaying(h.id);
      });
    }
    const clr = el('div', 'hrowlink danger', p, 'Clear highlights<span class="chev">›</span>');
    let armed = false;
    this.action(clr, () => {
      if (!armed) {
        armed = true;
        clr.innerHTML = 'Press again to delete all highlights<span class="chev">›</span>';
        return;
      }
      this.highlights?.clear();
      this.renderTab();
    });
  }

  private tabSetup(p: HTMLElement) {
    el('div', 'hp-cap', p, 'Set-up');
    const sum = el('div', 'setsum', p);
    const drawSum = () => {
      const m = this.career.setupSummary();
      const bar = (k: string, v: number, txt: string) => `<div class="sb"><span>${k}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><em>${txt}</em></div>`;
      sum.innerHTML =
        bar('Downforce', m.downforce, `${Math.round(m.downforce * 100)}`) +
        bar('Drag', m.drag, `${Math.round(m.drag * 100)}`) +
        bar('Aero balance', (m.balance - 0.35) / 0.15, `${(m.balance * 100).toFixed(1)}% front`) +
        `<div class="sb top"><span>Top speed</span><strong>${m.topSpeed}<small> km/h</small></strong></div>`;
    };
    drawSum();
    for (const d of SETUP) {
      const row = el('div', 'setrow', p);
      const draw = () => {
        const v = this.career.data.setup[d.id];
        const f = (v - d.min) / (d.max - d.min);
        row.innerHTML = `<div class="sr-top"><span class="sn">${d.name}</span><span class="sv"><span class="chev" data-d="-1">‹</span>${d.fmt(v)}<span class="chev" data-d="1">›</span></span></div><div class="sr-track"><i style="left:${f * 100}%"></i><b style="left:${((d.def - d.min) / (d.max - d.min)) * 100}%"></b></div><div class="sr-ends"><span>${d.lo}</span><span>${d.hi}</span></div>`;
      };
      draw();
      const change = (dir: number) => {
        this.career.setSetup(d.id, this.career.data.setup[d.id] + dir);
        draw();
        drawSum();
        this.cb.onUi('move');
      };
      row.addEventListener('click', (e) => {
        const dd = Number((e.target as HTMLElement).dataset.d ?? 0);
        if (dd) change(dd);
      });
      const idx = this.items.length;
      row.addEventListener('mouseenter', () => {
        this.hubFocus = 'panel';
        this.sel = idx;
        this.highlight();
      });
      row.dataset.part = d.part;
      this.items.push({ el: row, kind: 'option', change, select: () => change(1) });
    }
    const reset = el('div', 'cta ghost', p, 'Reset to baseline');
    this.action(reset, () => {
      this.career.resetSetup();
      this.renderTab();
    });
    el('div', 'hp-note', p, 'Pick a part on the car to look at it up close. The set-up applies to your car from the next session.');
  }

  /** the garage tour is on: the panel and the tabs step aside for the picture */
  setExploring(on: boolean) {
    this.screens.get('title')?.classList.toggle('exploring', on);
  }

  /** the highlights list shows which clip the wall is playing */
  private playingMark: string | null = null;
  private markPlaying(id: string | null) {
    if (id === this.playingMark || !this.hubPanel) return;
    this.playingMark = id;
    for (const r of Array.from(this.hubPanel.querySelectorAll<HTMLElement>('.hlrow'))) r.classList.toggle('playing', r.dataset.id === id);
  }

  /** re-render the open hub tab (new data arrived) */
  refreshTab() {
    if (this.screen === 'title') this.renderTab();
  }

  /** the set-up row with this part, focused from a hotspot on the car */
  focusPart(part: SetupPart) {
    if (this.hubTab !== 'setup') this.setTab('setup');
    const i = this.items.findIndex((it) => it.el.dataset.part === part);
    if (i >= 0) {
      this.hubFocus = 'panel';
      this.sel = i;
      this.highlight();
    }
  }

  private tabSettings(p: HTMLElement) {
    el('div', 'hp-cap', p, 'Settings');
    const go = el('div', 'hrowlink', p, 'Graphics, camera and sound<span class="chev">›</span>');
    this.action(go, () => {
      this.settingsReturn = 'title';
      this.show('settings');
    });
    const ct = el('div', 'hrowlink', p, 'Controls and steering wheel<span class="chev">›</span>');
    this.action(ct, () => {
      this.controlsReturn = 'title';
      this.show('controls');
    });
    const as = el('div', 'hrowlink', p, 'Driving assists<span class="chev">›</span>');
    this.action(as, () => {
      this.assistsReturn = 'title';
      this.show('assists');
    });
    const wipe = el('div', 'hrowlink danger', p, 'Start a new career<span class="chev">›</span>');
    let armed = false;
    this.action(wipe, () => {
      if (!armed) {
        armed = true;
        wipe.innerHTML = 'Press again to erase your career<span class="chev">›</span>';
        return;
      }
      this.career.reset();
      this.cb.onCarChange();
      this.buildTitle();
    });
  }

  private buildSetup() {
    const s = this.screens.get('setup')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    // the race briefing: where and what for, the sky (picked from its own strip), the race's rules as
    // tiles, and the start pinned at the foot of the panel
    const p = el('div', 'panel glass brief', s);
    const st = this.setup;
    const career = this.mode === 'career';
    const racing = this.mode === 'race' || career;
    const ri = CIRCUITS.findIndex((c) => c.id === st.track);
    const def = ALL_CIRCUITS.find((c) => c.id === st.track) ?? CIRCUITS[0];
    const info = CIRCUIT_INFO[def.id];
    const fc = career ? this.cb.careerForecast(st.track) : null;
    const dc = career ? this.cb.driverCareer?.() : undefined;
    const dcd = dc?.active ? dc.data! : null;

    // ---- header: the round, the circuit, what's at stake; its layout drawn beside it
    const head = el('div', 'br-head', p);
    const ht = el('div', 'br-title', head);
    let goal = '';
    if (dcd) {
      const r = dcd.calendar.indexOf(st.track);
      el('div', 'pcap round', ht, `${dcd.series === 'f2' ? 'Formula 2' : 'Formula 1'} ${dcd.year} · Round ${r + 1} of ${dcd.calendar.length}`);
      const next = dcd.calendar[r + 1] ? CIRCUITS.find((c) => c.id === dcd.calendar[r + 1]) : null;
      goal = `The car should finish around P${dc!.expected()}. Top ${UNLOCK_POS} ${next ? `unlocks ${next.short}` : 'completes the season'}.`;
    } else if (career) {
      const scenic = ri < 0;
      el('div', 'pcap round', ht, scenic ? 'World Tour · Scenic road' : `World Tour · Round ${ri + 1} of ${CIRCUITS.length}`);
      const m = medalFor(this.career.data.best[st.track]);
      goal = !m ? (scenic ? `Top ${UNLOCK_POS} earns your first star here.` : `Top ${UNLOCK_POS} earns a star and a Tour pass.`) : m === 'gold' ? 'All three stars won here. Race for the fun of it.' : `Your best here is P${this.career.data.best[st.track]}. Beat it for more stars.`;
    } else el('div', 'pcap round', ht, this.mode === 'race' ? 'Race' : 'Time trial');
    el('h2', '', ht, def.name);
    if (!career) goal = this.mode === 'race' ? 'Standing start from the grid.' : 'Flying lap. Beat your best.';
    const stars = career && !dcd ? ['bronze', 'silver', 'gold'].indexOf(medalFor(this.career.data.best[st.track]) ?? '') + 1 : -1;
    el('p', 'br-goal', ht, (stars >= 0 ? `<span class="br-stars">${[0, 1, 2].map((i) => `<i class="${i < stars ? 'on' : ''}"></i>`).join('')}</span>` : '') + goal);
    head.insertAdjacentHTML('beforeend', `<svg class="br-map" viewBox="0 0 150 110"><path class="b" d="${circuitPath(layoutPoints(def), 150, 110, 6)}"/><path class="f" pathLength="1" d="${circuitPath(layoutPoints(def), 150, 110, 6)}"/></svg>`);
    const facts = el('div', 'br-facts', p);
    const lapsNow = () => (dcd ? dc!.laps : career ? this.career.tourLaps : st.laps);
    const renderFacts = () => {
      const laps = lapsNow();
      facts.innerHTML =
        (info ? `<div><span>Length</span><b>${info.km}<small> km</small></b></div><div><span>Turns</span><b>${info.turns}</b></div>` : '') +
        (racing ? `<div><span>Laps</span><b>${laps}</b></div><div><span>Distance</span><b>${info ? (parseFloat(info.km) * laps).toFixed(0) : '—'}<small> km</small></b></div>` : '') +
        `<div><span>Country</span><b>${info?.country ?? def.country}</b></div>`;
    };
    renderFacts();

    // ---- conditions: a window onto the sky (the chosen weather and time, painted live), the race's forecast
    // lap by lap, then every sky as tiles in families and the time of day as a ruler
    el('div', 'pcap', p, 'Conditions');
    const wx = el('div', 'wxcard', p);
    const stageBox = el('div', 'wx-stage', wx);
    const stage = createSkyStage();
    stageBox.appendChild(stage.el);
    const now = el('div', 'wx-now', stageBox);
    const fcBox = el('div', 'wx-fc', wx);
    const wxChoice = (): WeatherChoice => (dcd ? fc!.weather : career ? (!st.tourWx || st.tourWx === 'auto' ? fc!.weather : st.tourWx) : st.weather);
    const tmChoice = (): TimeChoice => (dcd ? fc!.time : career ? (!st.tourTime || st.tourTime === 'auto' ? fc!.time : st.tourTime) : st.time);
    const wxIcon = (w: WeatherChoice) => `<svg viewBox="0 0 16 16">${w === 'random' || w === 'changeable' ? WX_CHOICE_ICON[w] : WX_ICON[w]}</svg>`;
    const renderNow = () => {
      const w = wxChoice();
      const t = tmChoice();
      const tod: TimeOfDay = t === 'random' ? 'afternoon' : t;
      const auto = career && (dcd || !st.tourWx || st.tourWx === 'auto');
      // what that sky feels like: a fixed sky rolled with a fixed seed (the race rolls its own)
      let feel = '';
      if (w !== 'random') {
        const plan = planWeather(w, tod, 600, 7);
        const ws = new Weather(plan).state;
        const kmh = Math.round(Math.hypot(ws.windX, ws.windZ) * 3.6);
        const label = w === 'changeable' ? `${WEATHER_LABEL[plan.start]} turning ${WEATHER_LABEL[plan.end].toLowerCase()}` : '';
        feel = `${label ? `<span>${label}</span>` : ''}<span><i>Air</i> ${Math.round(ws.airTemp)}°</span><span><i>Track</i> ${Math.round(ws.trackTemp)}°</span><span><i>Wind</i> ${kmh} km/h</span>`;
      } else feel = '<span>Rolled when the lights go out</span>';
      now.innerHTML =
        `<div class="wx-txt"><small>${timeLabel(t)}</small><b>${weatherLabel(w)}</b><div class="wx-sub">${feel}</div></div>` +
        (career ? `<em class="${auto ? 'on' : ''}">${dcd ? 'Forecast' : auto ? 'Automatic' : 'Your pick'}</em>` : '');
      now.dataset.kind = w;
      stage.set(w, tod);
      fcBox.innerHTML = forecastStrip(w, t, lapsNow(), info ? parseFloat(info.km) : 5);
    };
    if (!dcd) {
      this.wxPicker(
        wx,
        career ? 'auto' : 'random',
        () => (career ? (st.tourWx ?? 'auto') : st.weather),
        (v) => {
          if (career) st.tourWx = v;
          else st.weather = v as WeatherChoice;
        },
        (v) => (v === 'auto' ? `${wxIcon(fc!.weather)}<b>Auto</b><small>${weatherLabel(fc!.weather)}</small>` : `${wxIcon(v)}<b>${weatherLabel(v)}</b>`),
      );
      const TM: (TimeChoice | 'auto')[] = career ? ['auto', ...TIMES.filter((t) => t !== 'random')] : TIMES;
      this.timeRuler(
        wx,
        TM,
        () => (career ? (st.tourTime ?? 'auto') : st.time),
        (v) => {
          if (career) st.tourTime = v as TimeChoice | 'auto';
          else st.time = v as TimeChoice;
        },
        (v) => (v === 'auto' ? 'Auto' : v === 'random' ? 'Random' : TIME_SHORT[v as TimeOfDay]),
      );
    }
    wx.appendChild(fcBox);
    renderNow();

    // ---- the race's rules, as tiles
    el('div', 'pcap', p, racing ? 'Race' : 'Session');
    const grid = el('div', 'br-grid', p);
    // a driver career's distance is the player's (5 laps by default), kept with the career
    if (dcd)
      this.opt(grid, 'Laps', () => `${dc!.laps}<span class="dim">${dc!.laps === LAP_CHOICES[0] ? 'Sprint' : dc!.laps >= PIT_RACE_LAPS ? 'Mandatory stop' : 'No pit stops'}</span>`, (d) => {
        const i = Math.max(0, LAP_CHOICES.indexOf(dc!.laps));
        dc!.setLaps(LAP_CHOICES[(i + d + LAP_CHOICES.length) % LAP_CHOICES.length]);
      });
    else if (career)
      this.opt(grid, 'Laps', () => `${this.career.tourLaps}<span class="dim">${this.career.tourLaps >= PIT_RACE_LAPS ? 'Mandatory stop' : 'No pit stops'}</span>`, (d) => {
        const i = Math.max(0, TOUR_LAPS.indexOf(this.career.tourLaps as 5 | 10));
        this.career.setTourLaps(TOUR_LAPS[(i + d + TOUR_LAPS.length) % TOUR_LAPS.length]);
      });
    if (racing) {
      if (!career)
        this.opt(grid, 'Laps', () => `${st.laps}<span class="dim">${st.laps >= PIT_RACE_LAPS ? 'Mandatory stop' : 'No pit stops'}</span>`, (d) => {
          const i = LAPS.indexOf(st.laps);
          st.laps = LAPS[(Math.max(0, i) + d + LAPS.length) % LAPS.length];
        });
      this.opt(grid, 'Opponents', () => {
        const dd = DIFFICULTY[st.difficulty] ?? DIFFICULTY[0];
        return dd.dynamic ? `Dynamic<span class="dim">${Math.round(this.career.aiSkill * 100)}% pace</span>` : dd.label;
      }, (d) => {
        st.difficulty = (st.difficulty + d + DIFFICULTY.length) % DIFFICULTY.length;
      });
      this.opt(grid, 'Start from', () => GRID[st.grid].label, (d) => {
        st.grid = (st.grid + d + GRID.length) % GRID.length;
      });
      this.opt(
        grid,
        'Starting tyres',
        () => (st.compound === 'auto' ? 'Team choice' : `<span class="tyredot" style="background:${COMPOUNDS[st.compound].color}"></span>${COMPOUNDS[st.compound].label}`),
        (d) => {
          const i = TYRE_CHOICES.indexOf(st.compound);
          st.compound = TYRE_CHOICES[(i + d + TYRE_CHOICES.length) % TYRE_CHOICES.length];
        },
      );
      this.opt(grid, 'Damage', () => DAMAGE_LABEL[st.damage].replace(' · ', '<span class="dim">').replace(/$/, DAMAGE_LABEL[st.damage].includes(' · ') ? '</span>' : ''), (d) => {
        const i = DAMAGE.indexOf(st.damage);
        st.damage = DAMAGE[(i + d + DAMAGE.length) % DAMAGE.length];
      });
    }
    this.opt(grid, 'Track limits', () => TRACK_LIMITS_LABEL[st.trackLimits] ?? 'Lenient', (d) => {
      const i = Math.max(0, TRACK_LIMITS.indexOf(st.trackLimits));
      st.trackLimits = TRACK_LIMITS[(i + d + TRACK_LIMITS.length) % TRACK_LIMITS.length];
    });
    const open = [...this.career.unlockedCircuits(), ...SCENIC];
    if (open.length > 1 && !career)
      this.opt(grid, 'Circuit', () => (ALL_CIRCUITS.find((c) => c.id === st.track) ?? CIRCUITS[0]).name, (d) => {
        const i = Math.max(0, open.findIndex((c) => c.id === st.track));
        st.track = open[(i + d + open.length) % open.length].id;
      });
    // (a driver career races its own seat: the driver card shows it)
    el('div', 'pcap', p, dcd ? 'Driving' : 'Driver');
    const g2 = el('div', 'br-grid', p);
    if (!dcd) {
      this.opt(g2, 'Team', () => {
        const t = TEAMS[st.team];
        return `<span class="swatch" style="background:${t.primary}"></span>${t.name}`;
      }, (d) => {
        st.team = (st.team + d + TEAMS.length) % TEAMS.length;
      });
      this.opt(g2, 'Driver', () => {
        const dr = TEAMS[st.team].drivers[st.seat];
        return `${dr.first} ${dr.last}`;
      }, () => {
        st.seat = st.seat === 0 ? 1 : 0;
      });
    }
    this.opt(
      g2,
      'Assists',
      () => {
        const pr = presetOf(st.assists);
        return `${pr === 'custom' ? 'Custom' : PRESET_LABEL[pr]}<span class="dim">Enter to fine-tune</span>`;
      },
      (d) => {
        const pr = presetOf(st.assists);
        const i = pr === 'custom' ? 0 : PRESET_ORDER.indexOf(pr);
        st.assists = { ...ASSIST_PRESETS[PRESET_ORDER[(i + d + PRESET_ORDER.length) % PRESET_ORDER.length]] };
      },
      false,
      () => {
        this.assistsReturn = 'setup';
        this.show('assists');
      },
    );
    this.briefRefresh = () => {
      renderFacts();
      renderNow();
    };

    // ---- the start, pinned to the foot of the panel
    // (a driver career's round number is its place in the career's own calendar, not the circuit list's)
    const round = dcd ? dcd.calendar.indexOf(st.track) + 1 : ri + 1;
    const foot = el('div', 'br-foot', p);
    const cta = el('div', 'cta', foot, `<span>${career ? (ri < 0 && !dcd ? 'Start the drive' : `Start round ${round}`) : this.mode === 'race' ? 'Start race' : 'Start time trial'}</span><i class="go">›</i>`);
    this.items.push({ el: cta, kind: 'action', select: () => this.cb.onStart(this.mode, { ...this.setup }) });
    cta.addEventListener('click', () => this.cb.onStart(this.mode, { ...this.setup }));
    el('div', 'keys', foot, '<span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>←</kbd><kbd>→</kbd> change</span><span><kbd>Esc</kbd> back</span>');
    this.driverCard = el('div', 'drivercard', s);
    this.updateDriverCard();
    this.sel = this.items.length - 1;
  }

  /**
   * The briefing's sky picker: the skies in families (dry, wet, winter, the murky and the wild) behind a row
   * of tabs, each a tile with its icon. A click picks; ← → step through every sky in turn (the tabs follow).
   */
  private wxPicker(parent: HTMLElement, first: 'auto' | 'random', get: () => WeatherChoice | 'auto', set: (v: WeatherChoice | 'auto') => void, tile: (v: WeatherChoice | 'auto') => string) {
    const groups = WX_GROUPS.map((g) => (g.id === 'mix' ? { ...g, label: first === 'auto' ? 'Auto' : 'Mixed', kinds: [first, 'changeable'] as (WeatherChoice | 'auto')[] } : g));
    const flat = groups.flatMap((g) => g.kinds);
    const row = el('div', 'chiprow wxpick', parent);
    const head = el('div', 'wxp-head', row);
    el('span', 'k', head, 'Weather');
    const tabs = el('div', 'wxp-tabs', head);
    const tiles = el('div', 'wxp-tiles', row);
    const groupOf = (v: WeatherChoice | 'auto') => Math.max(0, groups.findIndex((g) => g.kinds.includes(v)));
    let shown = groupOf(get());
    const tabEls = groups.map((g, i) => {
      const t = el('button', 'wxp-tab', tabs, g.label);
      t.type = 'button';
      t.tabIndex = -1;
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        if (shown === i) return;
        shown = i;
        this.cb.onUi('move');
        render(true);
      });
      return t;
    });
    const pick = (v: WeatherChoice | 'auto') => {
      set(v);
      shown = groupOf(v);
      render(false);
      this.cb.onUi('move');
      this.commitSetup();
    };
    let lastShown = -1;
    const render = (animate: boolean) => {
      const cur = get();
      tabEls.forEach((t, i) => {
        t.classList.toggle('on', i === shown);
        t.classList.toggle('has', i === groupOf(cur));
      });
      if (shown !== lastShown) {
        tiles.innerHTML = '';
        tiles.classList.toggle('swap', animate);
        tiles.style.setProperty('--n', String(Math.max(4, groups[shown].kinds.length)));
        groups[shown].kinds.forEach((v, j) => {
          const b = el('button', 'wxp-tile', tiles, tile(v));
          b.type = 'button';
          b.tabIndex = -1;
          b.dataset.v = v;
          b.style.setProperty('--i', String(j));
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            pick(v);
          });
        });
        lastShown = shown;
      }
      tiles.querySelectorAll<HTMLElement>('.wxp-tile').forEach((b) => b.classList.toggle('on', b.dataset.v === cur));
    };
    render(false);
    const change = (d: number) => {
      const i = Math.max(0, flat.indexOf(get()));
      pick(flat[(i + d + flat.length) % flat.length]);
    };
    const idx = this.items.length;
    row.addEventListener('mouseenter', () => {
      this.sel = idx;
      this.highlight();
    });
    this.items.push({ el: row, kind: 'option', change, select: () => change(1) });
  }

  /** the time of day as a ruler across the sky window: every hour visible, the picked one lit */
  private timeRuler<V extends string>(parent: HTMLElement, values: V[], get: () => V, set: (v: V) => void, label: (v: V) => string) {
    const row = el('div', 'chiprow tmrow', parent);
    el('span', 'k', row, 'Time of day');
    const ruler = el('div', 'tm-ruler', row);
    const els = values.map((v) => {
      const b = el('button', 'tm-seg', ruler, `<i></i><span>${label(v)}</span>`);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.v = v;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        pickT(v);
      });
      return b;
    });
    const sync = () => {
      const cur = get();
      els.forEach((b) => b.classList.toggle('on', b.dataset.v === cur));
    };
    const pickT = (v: V) => {
      set(v);
      sync();
      this.cb.onUi('move');
      this.commitSetup();
    };
    sync();
    const change = (d: number) => {
      const i = Math.max(0, values.indexOf(get()));
      pickT(values[(i + d + values.length) % values.length]);
    };
    const idx = this.items.length;
    row.addEventListener('mouseenter', () => {
      this.sel = idx;
      this.highlight();
    });
    this.items.push({ el: row, kind: 'option', change, select: () => change(1) });
  }

  /** the race set-up changed: keep it, tell the garage, redraw what depends on it */
  private commitSetup() {
    save('apexgp.setup', this.setup);
    this.updateDriverCard();
    this.cb.onSetupChange({ ...this.setup });
    // the driver name depends on the team
    this.items.forEach((it) => it.el.dispatchEvent(new Event('rerender')));
    this.briefRefresh?.();
  }

  /** a read-only row (career rules the player can't change) */
  private fixed(parent: HTMLElement, key: string, value: string) {
    const row = el('div', 'opt fixed', parent);
    el('span', 'k', row, key);
    el('span', 'v', row, value);
  }

  /** the career race screen for the round the garage is at */
  showCareerSetup() {
    this.mode = 'career';
    this.show('setup');
  }

  /** a World Tour race screen is open (the garage previews that round's sky) */
  isCareerSetup() {
    return this.screen === 'setup' && this.mode === 'career';
  }

  /** the time trial screen for the circuit the garage is at */
  showTimeTrialSetup() {
    this.mode = 'timetrial';
    this.show('setup');
  }

  private updateDriverCard() {
    if (!this.driverCard) return;
    const t = TEAMS[this.setup.team];
    const d = t.drivers[this.setup.seat];
    this.driverCard.innerHTML = `<div class="num" style="color:${t.primary}">${d.number}</div><div class="name">${d.first} ${d.last}</div><div class="team"><span class="swatch" style="background:${t.primary}"></span>${t.name}</div>`;
  }

  private buildSettings() {
    const s = this.screens.get('settings')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    const p = el('div', 'panel glass', s);
    el('h2', '', p, 'Settings');
    el('p', 'lede', p, 'Changes apply straight away.');
    const st = this.settings;
    const label: Record<QualityLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', tuned: 'Ultra Tuned' };
    this.opt(p, 'Graphics', () => label[st.quality] + (st.autoQuality ? ' <span class="dim">· auto</span>' : ''), (d) => {
      const i = QUALITY.indexOf(st.quality);
      st.quality = QUALITY[(i + d + QUALITY.length) % QUALITY.length];
      st.autoQuality = false;
    }, true);
    this.opt(p, 'Motion blur', () => MOTION_BLUR_LABEL[st.motionBlur ?? 'cinematic'], (d) => {
      const i = MOTION_BLUR.indexOf(st.motionBlur ?? 'cinematic');
      st.motionBlur = MOTION_BLUR[(i + d + MOTION_BLUR.length) % MOTION_BLUR.length];
    }, true);
    this.opt(p, 'Camera', () => CAMERA_LABEL[st.camera], (d) => {
      const i = CAMERA_ORDER.indexOf(st.camera);
      st.camera = CAMERA_ORDER[(i + d + CAMERA_ORDER.length) % CAMERA_ORDER.length];
    }, true);
    const cp = el('div', 'opt', p);
    el('span', 'k', cp, 'Camera tuning');
    el('span', 'v', cp, `${(() => {
      const c = { ...DEFAULT_CAM, ...(st.cam ?? {}) };
      const same = (Object.keys(DEFAULT_CAM) as (keyof CamPrefs)[]).every((k) => c[k] === DEFAULT_CAM[k]);
      const moved = Object.values(c.per ?? {}).some((x) => x && (x.fov || x.lat || x.fwd || x.up || x.angle));
      return same && !moved ? 'Default' : 'Custom';
    })()}<span class="chev">›</span>`);
    const openCam = () => this.show('camera');
    cp.addEventListener('click', openCam);
    this.items.push({ el: cp, kind: 'action', select: openCam });
    const ctl = el('div', 'opt', p);
    el('span', 'k', ctl, 'Controls');
    el('span', 'v', ctl, `${st.controls?.wheel ? 'Wheel set up' : 'Keyboard · pad · wheel'}<span class="chev">›</span>`);
    const openControls = () => {
      this.controlsReturn = 'settings';
      this.show('controls');
    };
    ctl.addEventListener('click', openControls);
    this.items.push({ el: ctl, kind: 'action', select: openControls });
    const as = el('div', 'opt', p);
    el('span', 'k', as, 'Driving assists');
    el('span', 'v', as, `${(() => {
      const pr = presetOf(this.setup.assists);
      return pr === 'custom' ? 'Custom' : PRESET_LABEL[pr];
    })()}<span class="chev">›</span>`);
    const openAssists = () => {
      this.assistsReturn = 'settings';
      this.show('assists');
    };
    as.addEventListener('click', openAssists);
    this.items.push({ el: as, kind: 'action', select: openAssists });
    this.opt(p, 'Volume', () => `${Math.round(st.volume * 100)}%`, (d) => {
      st.volume = Math.max(0, Math.min(1, Math.round((st.volume + d * 0.1) * 10) / 10));
    }, true);
    this.opt(p, 'Music', () => `${Math.round(st.music * 100)}%`, (d) => {
      st.music = Math.max(0, Math.min(1, Math.round((st.music + d * 0.05) * 20) / 20));
    }, true);
    const cta = el('div', 'cta', p, 'Done');
    const done = () => this.show(this.settingsReturn);
    this.items.push({ el: cta, kind: 'action', select: done });
    cta.addEventListener('click', done);
  }

  private buildCameraPrefs() {
    const s = this.screens.get('camera')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    const p = el('div', 'panel glass', s);
    el('h2', '', p, 'Camera tuning');
    el('p', 'lede', p, 'Each camera keeps its own placement, as in F1 25. C cycles the cameras in the race.');
    const st = this.settings;
    const c: CamPrefs = { ...DEFAULT_CAM, ...(st.cam ?? {}) };
    st.cam = c;
    const step = (v: number, d: number, k: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round((v + d * k) / k) * k));
    const sgn = (v: number, unit: string, dp = 0) => (Math.abs(v) < 1e-6 ? 'Default' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}${unit}`);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    // (the camera being tuned is the one you race with: pick it here and the sliders below are its own)
    const o = (): CamOffset => {
      const per = (c.per ??= {});
      return (per[st.camera] ??= { ...NO_OFFSET });
    };
    const chase = st.camera === 'chase' || st.camera === 'far' || st.camera === 'lowchase';
    this.opt(p, 'Camera', () => CAMERA_LABEL[st.camera], (d) => {
      const i = CAMERA_ORDER.indexOf(st.camera);
      st.camera = CAMERA_ORDER[(i + d + CAMERA_ORDER.length) % CAMERA_ORDER.length];
      // (the sliders below change with the camera)
      queueMicrotask(() => this.show('camera'));
    }, true);
    el('div', 'pcap', p, CAMERA_LABEL[st.camera]);
    this.opt(p, 'Field of view', () => sgn(o().fov, '°'), (d) => (o().fov = step(o().fov, d, 1, -20, 20)), true);
    this.opt(p, 'Offset lateral', () => sgn(o().lat * 100, ' cm'), (d) => (o().lat = step(o().lat, d, 0.02, -0.4, 0.4)), true);
    this.opt(p, 'Offset horizontal', () => sgn(o().fwd * 100, ' cm'), (d) => (o().fwd = step(o().fwd, d, chase ? 0.25 : 0.02, chase ? -4 : -0.4, chase ? 3 : 0.4)), true);
    this.opt(p, 'Offset vertical', () => sgn(o().up * 100, ' cm'), (d) => (o().up = step(o().up, d, chase ? 0.1 : 0.01, chase ? -1 : -0.2, chase ? 2 : 0.25)), true);
    this.opt(p, 'Angle', () => sgn(o().angle, '°'), (d) => (o().angle = step(o().angle, d, 1, -15, 15)), true);
    if (st.camera === 'cockpit') this.opt(p, 'Halo column', () => (c.haloCol === false ? 'Off' : 'On'), () => (c.haloCol = c.haloCol === false), true);
    el('div', 'pcap', p, 'Every camera');
    this.opt(p, 'Dynamic field of view', () => (c.dynFov ? 'On' : 'Off'), () => (c.dynFov = !c.dynFov), true);
    this.opt(p, 'Camera shake', () => (c.shake === 0 ? 'Off' : pct(c.shake)), (d) => (c.shake = step(c.shake, d, 0.25, 0, 1.5)), true);
    // (F1 25's "camera movement": how far the view leans and rolls with the car; stored as the
    // horizon lock, 100 % movement = the horizon free)
    this.opt(p, 'Camera movement', () => pct(1 - c.horizon), (d) => (c.horizon = 1 - step(1 - c.horizon, d, 0.1, 0, 1)), true);
    this.opt(p, 'Look to apex', () => (c.apex === 0 ? 'Off' : pct(c.apex)), (d) => (c.apex = step(c.apex, d, 0.25, 0, 1.5)), true);
    const reset = el('div', 'opt', p);
    el('span', 'k', reset, 'Reset to defaults');
    el('span', 'v', reset, '<span class="chev">›</span>');
    const doReset = () => {
      st.cam = { ...DEFAULT_CAM };
      save('apexgp.settings', st);
      this.cb.onSettings({ ...st });
      this.show('camera');
    };
    reset.addEventListener('click', doReset);
    this.items.push({ el: reset, kind: 'action', select: doReset });
    const cta = el('div', 'cta', p, 'Done');
    const done = () => this.show('settings');
    this.items.push({ el: cta, kind: 'action', select: done });
    cta.addEventListener('click', done);
  }

  /**
   * Settings → Controls, laid out like ACC's: the wheel and pedals (bound by moving them, with live
   * meters to check the calibration), then the gamepad's four knobs and the rumble, then the keyboard.
   */
  private buildControls() {
    const s = this.screens.get('controls')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    const p = el('div', 'panel glass', s);
    el('h2', '', p, 'Controls');
    const lede = el('p', 'lede', p, '');
    const st = this.settings;
    const c: ControlPrefs = controlPrefs(st.controls);
    st.controls = c;
    const step = (v: number, d: number, k: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round((v + d * k) / k) * k));
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const commit = () => {
      save('apexgp.settings', st);
      this.cb.onSettings({ ...st });
    };

    el('div', 'pcap', p, 'Steering wheel');
    const wr = el('div', 'opt', p);
    el('span', 'k', wr, 'Wheel and pedals');
    const wv = el('span', 'v', wr, `${c.wheel ? deviceName(c.wheel.name, 24) : 'Set up'}<span class="chev">›</span>`);
    const bind = () => this.startBind();
    wr.addEventListener('click', bind);
    this.items.push({ el: wr, kind: 'action', select: bind });
    this.opt(p, 'Wheel rotation', () => `${c.wheelRotation}° <span class="dim">· as set on the wheel</span>`, (d) => {
      const i = WHEEL_ROTATIONS.indexOf(c.wheelRotation);
      c.wheelRotation = WHEEL_ROTATIONS[Math.max(0, Math.min(WHEEL_ROTATIONS.length - 1, (i < 0 ? WHEEL_ROTATIONS.indexOf(900) : i) + d))];
    }, true);
    this.opt(p, 'Steering linearity', () => (c.wheelLinearity === 1 ? '1.0 <span class="dim">· 1:1</span>' : c.wheelLinearity.toFixed(1)), (d) => (c.wheelLinearity = step(c.wheelLinearity, d, 0.1, 1, 2.5)), true);
    this.opt(p, 'Brake linearity', () => c.brakeLinearity.toFixed(1), (d) => (c.brakeLinearity = step(c.brakeLinearity, d, 0.1, 1, 3)), true);
    this.opt(p, 'Pedal deadzone', () => pct(c.pedalDeadzone), (d) => (c.pedalDeadzone = step(c.pedalDeadzone, d, 0.01, 0, 0.1)), true);
    // live input: what the game reads from the device that would drive
    const meters = el('div', 'ctl-meters', p);
    const meter = (k: string, centred: boolean) => {
      const row = el('div', 'ctl-meter' + (centred ? ' centred' : ''), meters);
      el('span', 'k', row, k);
      const bar = el('span', 'bar', row);
      return el('i', '', bar);
    };
    const mSteer = meter('Steering', true);
    const mThr = meter('Throttle', false);
    const mBrk = meter('Brake', false);

    el('div', 'pcap', p, 'Gamepad');
    this.opt(p, 'Steering deadzone', () => pct(c.padDeadzone), (d) => (c.padDeadzone = step(c.padDeadzone, d, 0.02, 0, 0.3)), true);
    this.opt(p, 'Steering linearity', () => c.padLinearity.toFixed(1), (d) => (c.padLinearity = step(c.padLinearity, d, 0.1, 1, 3)), true);
    this.opt(p, 'Steering filter', () => (c.padFilter === 0 ? 'Off' : pct(c.padFilter)), (d) => (c.padFilter = step(c.padFilter, d, 0.1, 0, 1)), true);
    this.opt(p, 'Speed sensitivity', () => pct(c.padSpeedSens), (d) => (c.padSpeedSens = step(c.padSpeedSens, d, 0.1, 0, 1)), true);
    this.opt(p, 'Vibration', () => (c.vibration === 0 ? 'Off' : pct(c.vibration)), (d) => (c.vibration = step(c.vibration, d, 0.25, 0, 1.5)), true);

    el('div', 'pcap', p, 'Keyboard');
    this.opt(p, 'Steering speed', () => pct(c.kbSteerSpeed), (d) => (c.kbSteerSpeed = step(c.kbSteerSpeed, d, 0.1, 0.5, 1.5)), true);

    const reset = el('div', 'opt', p);
    el('span', 'k', reset, 'Reset to defaults');
    el('span', 'v', reset, `${c.wheel ? '<span class="dim">keeps the wheel set-up</span>' : ''}<span class="chev">›</span>`);
    const doReset = () => {
      st.controls = { ...DEFAULT_CONTROLS, wheel: c.wheel };
      commit();
      this.show('controls');
    };
    reset.addEventListener('click', doReset);
    this.items.push({ el: reset, kind: 'action', select: doReset });
    if (c.wheel) {
      const forget = el('div', 'opt', p);
      el('span', 'k', forget, 'Forget the wheel set-up');
      el('span', 'v', forget, '<span class="chev">›</span>');
      const doForget = () => {
        delete c.wheel;
        commit();
        this.show('controls');
      };
      forget.addEventListener('click', doForget);
      this.items.push({ el: forget, kind: 'action', select: doForget });
    }
    const cta = el('div', 'cta', p, 'Done');
    const done = () => this.show(this.controlsReturn);
    this.items.push({ el: cta, kind: 'action', select: done });
    cta.addEventListener('click', done);

    // ---- the live loop: device line + meters (only while this screen is up)
    let lastLede = '';
    const tick = () => {
      if (this.screen !== 'controls' || this.binder) return;
      this.ctlRaf = requestAnimationFrame(tick);
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const wb = c.wheel;
      const wheel = (wb ? findDev(pads, wb.steer.dev) : null) ?? pads.find((q) => q && q.connected && q.mapping !== 'standard' && isWheelId(q.id)) ?? null;
      const pad = pads.find((q) => q && q.connected && q !== wheel && !isWheelId(q.id)) ?? null;
      let sv = 0;
      let tv = 0;
      let bv = 0;
      if (wheel) {
        const sc = wb && wheel.id === wb.steer.dev ? wb.steer : { dev: wheel.id, axis: 0, center: 0, sign: -1 as const };
        sv = wheelSteer(wheel.axes[sc.axis] ?? 0, sc, c);
        const td = wb?.throttle ? findDev(pads, wb.throttle.dev) : null;
        const bd = wb?.brake ? findDev(pads, wb.brake.dev) : null;
        if (td && wb?.throttle) tv = pedal(td.axes[wb.throttle.axis] ?? wb.throttle.rest, wb.throttle, c.pedalDeadzone);
        if (bd && wb?.brake) bv = pedal(bd.axes[wb.brake.axis] ?? wb.brake.rest, wb.brake, c.pedalDeadzone, c.brakeLinearity);
      } else if (pad) {
        sv = padSteer(pad.axes[0] ?? 0, c);
        tv = pad.buttons[7]?.value ?? 0;
        bv = Math.pow(pad.buttons[6]?.value ?? 0, c.brakeLinearity);
      }
      // (+ is left: the bar grows to the left of centre)
      mSteer.style.cssText = sv >= 0 ? `right:50%;width:${(sv * 50).toFixed(1)}%` : `left:50%;width:${(-sv * 50).toFixed(1)}%`;
      mThr.style.width = `${(tv * 100).toFixed(1)}%`;
      mBrk.style.width = `${(bv * 100).toFixed(1)}%`;
      const rumble = pad && (pad as unknown as { vibrationActuator?: unknown }).vibrationActuator ? ' · vibration' : '';
      const parts: string[] = [];
      if (wheel) parts.push(`Wheel: ${deviceName(wheel.id)}${wb ? '' : ' · not set up'}`);
      if (pad) parts.push(`Pad: ${deviceName(pad.id)}${rumble}`);
      // (browsers only reveal a controller once one of its buttons has been pressed)
      const text = parts.length ? parts.join('  ·  ') : 'No pad or wheel found. Press a button on it to wake it up.';
      if (text !== lastLede) {
        lastLede = text;
        lede.textContent = text;
        if (!wb) wv.innerHTML = `${wheel ? 'Detected · set up' : 'Set up'}<span class="chev">›</span>`;
      }
    };
    tick();
  }

  /** bind and calibrate a wheel and pedals: one prompt per step, the device's own movement completes it */
  private startBind() {
    this.endControls();
    const binder = new Binder();
    this.binder = binder;
    const s = this.screens.get('controls')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    const p = el('div', 'panel glass', s);
    el('h2', '', p, 'Wheel and pedals');
    const lede = el('p', 'lede', p, '');
    const prompt = el('div', 'ctl-prompt', p);
    const bar = el('div', 'ctl-meter', p);
    el('span', 'k', bar, 'Input');
    const fill = el('i', '', el('span', 'bar', bar));
    const skip = el('div', 'opt', p);
    el('span', 'k', skip, 'Skip this step');
    el('span', 'v', skip, '<span class="dim">Enter</span>');
    const cancel = el('div', 'opt', p);
    el('span', 'k', cancel, 'Cancel');
    el('span', 'v', cancel, '<span class="dim">Esc</span>');
    this.items = [];
    const render = () => {
      const n = BIND_STEPS.indexOf(binder.step);
      lede.textContent = `Step ${n + 1} of ${BIND_STEPS.length - 1}`;
      prompt.innerHTML = BIND_PROMPT[binder.step];
      skip.style.visibility = binder.step === 'steer' ? 'hidden' : '';
    };
    const finish = (keep: boolean) => {
      const b = binder.binding();
      this.endControls();
      if (keep && b) {
        const c = controlPrefs(this.settings.controls);
        c.wheel = b;
        this.settings.controls = c;
        save('apexgp.settings', this.settings);
        this.cb.onSettings({ ...this.settings });
      }
      this.cb.onUi(keep ? 'select' : 'back');
      this.show('controls');
    };
    const doSkip = () => {
      if (binder.skip()) {
        this.cb.onUi('move');
        if (binder.step === 'done') finish(true);
        else render();
      }
    };
    skip.addEventListener('click', doSkip);
    cancel.addEventListener('click', () => finish(false));
    this.bindKeys = (e: KeyboardEvent) => {
      if (e.code === 'Enter') doSkip();
      else if (e.code === 'Escape' || e.code === 'Backspace') finish(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', this.bindKeys, true);
    render();
    const tick = () => {
      if (this.binder !== binder) return;
      this.ctlRaf = requestAnimationFrame(tick);
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      if (binder.update(pads)) {
        this.cb.onUi('select');
        if (binder.step === 'done') return finish(true);
        render();
      }
      fill.style.width = `${(binder.level * 100).toFixed(1)}%`;
    };
    tick();
  }

  /** stop the Controls screen's loop and any binding in progress */
  private endControls() {
    if (this.ctlRaf) cancelAnimationFrame(this.ctlRaf);
    this.ctlRaf = 0;
    this.binder = null;
    if (this.bindKeys) removeEventListener('keydown', this.bindKeys, true);
    this.bindKeys = null;
  }

  private buildAssists() {
    const s = this.screens.get('assists')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    const p = el('div', 'panel glass', s);
    el('h2', '', p, 'Assists');
    const lede = el('p', 'lede', p, '');
    const a = this.setup.assists;
    const updateLede = () => {
      const pr = presetOf(a);
      lede.textContent = pr === 'custom' ? 'Custom set-up.' : `${PRESET_LABEL[pr]} preset.`;
    };
    updateLede();
    const cycle = <T,>(list: T[], cur: T, d: number) => list[(list.indexOf(cur) + d + list.length) % list.length];
    const onOff = (b: boolean) => (b ? 'On' : 'Off');
    const row = (k: string, v: () => string, ch: (d: number) => void) =>
      this.opt(p, k, v, (d) => {
        ch(d);
        updateLede();
      });
    row('Handling', () => (a.arcade ? 'Arcade' : 'Simulation'), () => (a.arcade = !a.arcade));
    row('Traction control', () => ({ off: 'Off', medium: 'Medium', full: 'Full' })[a.traction], (d) => (a.traction = cycle(['off', 'medium', 'full'] as const, a.traction, d)));
    row('Anti-lock brakes', () => onOff(a.abs), () => (a.abs = !a.abs));
    row('Stability control', () => onOff(a.stability), () => (a.stability = !a.stability));
    row('Braking assist', () => ({ off: 'Off', low: 'Low', medium: 'Medium', high: 'High' })[a.braking], (d) => (a.braking = cycle(['off', 'low', 'medium', 'high'] as const, a.braking, d)));
    row('Racing line', () => ({ off: 'Off', corners: 'Corners only', full: 'Full' })[a.line], (d) => (a.line = cycle(['off', 'corners', 'full'] as const, a.line, d)));
    row('Gearbox', () => (a.gearbox === 'auto' ? 'Automatic' : 'Manual (Q / E)'), () => (a.gearbox = a.gearbox === 'auto' ? 'manual' : 'auto'));
    row('DRS', () => (a.drs === 'auto' ? 'Automatic' : 'Manual (Space)'), () => (a.drs = a.drs === 'auto' ? 'manual' : 'auto'));
    row('Keyboard steering', () => (a.keyboard === 'rate' ? 'Assisted' : 'Direct'), () => (a.keyboard = a.keyboard === 'rate' ? 'direct' : 'rate'));
    const cta = el('div', 'cta', p, 'Done');
    const done = () => this.show(this.assistsReturn);
    this.items.push({ el: cta, kind: 'action', select: done });
    cta.addEventListener('click', done);
  }

  private buildPause() {
    const s = this.screens.get('pause')!;
    s.innerHTML = '';
    el('div', 'pause-bg', s);
    const w = el('div', 'title-wrap pause-wrap', s);
    const info = this.cb.pauseInfo?.() ?? null;
    if (info) el('div', 'pause-cap', w, `<span>${info.kind}</span><span>${info.title}</span>`);
    el('div', 'logo', w, 'Paused');
    if (info?.stats.length) el('div', 'pause-stats', w, info.stats.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join(''));
    const list = el('div', 'mlist', w);
    const add = (label: string, fn: () => void) => {
      const e = el('div', 'mitem', list, label);
      this.items.push({ el: e, kind: 'action', select: fn });
    };
    add('Resume', () => this.cb.onResume());
    add('Reset car to track', () => this.cb.onResetCar());
    add('Restart', () => this.cb.onRestart());
    add('Settings', () => {
      this.settingsReturn = 'pause';
      this.show('settings');
    });
    add('Quit to garage', () => this.cb.onQuit());
    el('div', 'keys', w, '<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> resume</span>');
  }

  /** qualifying classification → grid; primary action starts the race */
  showQualifying(rows: { pos: number; entry: Entry; isPlayer: boolean; time: number; gap: number }[], title: string, lede: string, onStart: () => void, onMenu: () => void) {
    this.show('results');
    const s = this.screens.get('results')!;
    s.innerHTML = '';
    el('div', 'pause-bg', s);
    const box = el('div', 'results glass', s);
    const head = el('div', '', box);
    el('h2', '', head, title);
    el('p', 'lede', head, lede);
    const table = el('div', 'rtable', box);
    el('div', 'rrow head', table, '<span class="p">Pos</span><span></span><span>Driver</span><span>Team</span><span class="gap">Time</span><span class="best">Gap</span><span class="pts"></span>');
    rows.forEach((r, i) => {
      const t = isFinite(r.time) ? fmtTime(r.time) : 'No time';
      const gap = r.pos === 1 ? '' : isFinite(r.gap) ? `+${r.gap.toFixed(3)}` : '';
      const row = el(
        'div',
        'rrow' + (r.isPlayer ? ' me' : ''),
        table,
        `<span class="p">${r.pos}</span><span class="bar" style="background:${uiColor(r.entry.team)}"></span><span>${r.entry.driver.first} ${r.entry.driver.last}</span><span class="team">${r.entry.team.name}</span><span class="gap">${t}</span><span class="best${r.pos === 1 ? ' purple' : ''}">${gap}</span><span class="pts"></span>`,
      );
      row.style.animationDelay = `${0.15 + i * 0.035}s`;
    });
    const act = el('div', 'actions', box);
    const start = el('div', 'cta', act, 'Start race');
    const menu = el('div', 'cta ghost', act, 'Main menu');
    this.items = [
      { el: start, kind: 'action', select: onStart },
      { el: menu, kind: 'action', select: onMenu },
    ];
    start.addEventListener('click', onStart);
    menu.addEventListener('click', onMenu);
    this.sel = 0;
    this.highlight();
  }

  showResults(rows: ResultRow[], title: string, lede: string, onAgain: () => void, onMenu: () => void, onReplay?: () => void, reward?: RaceReward | null, onNext?: { label: string; go: () => void }, career?: RoundSummary | null) {
    this.show('results');
    const s = this.screens.get('results')!;
    s.innerHTML = '';
    el('div', 'pause-bg', s);
    const box = el('div', 'results glass', s);
    const head = el('div', '', box);
    el('h2', '', head, title);
    el('p', 'lede', head, lede);
    const table = el('div', 'rtable', box);
    el('div', 'rrow head', table, '<span class="p">Pos</span><span></span><span>Driver</span><span>Team</span><span class="gap">Time</span><span class="best">Best lap</span><span class="pts">Pts</span>');
    rows.forEach((r, i) => {
      const gap = r.dnf ? 'DNF' : r.pos === 1 ? (isFinite(r.time) ? fmtTime(r.time) : 'Leader') : r.gap < 0 ? `+${-r.gap} lap${r.gap < -1 ? 's' : ''}` : isFinite(r.gap) && r.gap > 0 ? `+${r.gap.toFixed(3)}` : '—';
      const pts = r.pos <= 10 && !r.dnf ? POINTS[r.pos - 1] + (r.fastest && r.pos <= 10 ? 1 : 0) : 0;
      const row = el(
        'div',
        'rrow' + (r.isPlayer ? ' me' : ''),
        table,
        `<span class="p">${r.pos}</span><span class="bar" style="background:${uiColor(r.entry.team)}"></span><span>${r.entry.driver.first} ${r.entry.driver.last}</span><span class="team">${r.entry.team.name}</span><span class="gap">${gap}${r.penalty ? ` (+${r.penalty}s)` : ''}</span><span class="best${r.fastest ? ' purple' : ''}">${fmtTime(r.best)}</span><span class="pts">${pts || ''}</span>`,
      );
      row.style.animationDelay = `${0.15 + i * 0.035}s`;
    });
    if (reward) {
      const rw = el('div', 'reward', box);
      const parts = reward.breakdown.map((b) => `<span>${b.label} <b>+${fmtCr(b.credits)}</b></span>`).join('');
      el('div', 'rw-main', rw, `<div class="cap">Prize money</div><div class="val">+${fmtCr(reward.credits)}</div>`);
      el('div', 'rw-parts', rw, parts + `<span>Balance <b>${fmtCr(this.career.data.credits)}</b></span>`);
      if (reward.medal) {
        const word = reward.medal === 'gold' ? 'Gold · the win' : reward.medal === 'silver' ? 'Silver · a podium' : `Bronze · top ${UNLOCK_POS}`;
        el('div', `rw-medal ${reward.medal}`, box, `<i class="md ${reward.medal}"></i><b>New medal</b> · ${word} · ${'★'.repeat(reward.medal === 'gold' ? 3 : reward.medal === 'silver' ? 2 : 1)}`);
      }
      if (reward.challenge) el('div', 'rw-medal gold', box, `<b>Challenge complete</b> · ${reward.challenge} · ★`);
      if (reward.pass) el('div', 'rw-unlock', box, `<b>Tour pass earned</b> · open any circuit you like on the World Tour map (${this.career.passes()} in hand)`);
      else if (reward.unlocked) {
        const cd = ALL_CIRCUITS.find((c) => c.id === reward.unlocked);
        el('div', 'rw-unlock', box, `<b>New circuit unlocked</b> · ${cd?.name ?? reward.unlocked} is open on the map`);
      }
    }
    if (career) renderRoundSummary(box, career);
    const act = el('div', 'actions' + (onReplay || onNext ? ' three' : '') + (onReplay && onNext ? ' four' : ''), box);
    this.items = [];
    if (onNext) {
      const nx = el('div', 'cta', act, onNext.label);
      this.items.push({ el: nx, kind: 'action', select: onNext.go });
      nx.addEventListener('click', onNext.go);
    }
    const again = el('div', onNext ? 'cta ghost' : 'cta', act, 'Race again');
    this.items.push({ el: again, kind: 'action', select: onAgain });
    again.addEventListener('click', onAgain);
    if (onReplay) {
      const rp = el('div', 'cta ghost', act, 'Watch replay');
      this.items.push({ el: rp, kind: 'action', select: onReplay });
      rp.addEventListener('click', onReplay);
    }
    const menu = el('div', 'cta ghost', act, 'Back to garage');
    this.items.push({ el: menu, kind: 'action', select: onMenu });
    menu.addEventListener('click', onMenu);
    this.sel = 0;
    this.highlight();
  }

  private opt(parent: HTMLElement, key: string, value: () => string, change: (dir: number) => void, isSetting = false, onSelect?: () => void) {
    const row = el('div', 'opt', parent);
    el('span', 'k', row, key);
    const v = el('span', 'v', row);
    const render = () => {
      v.innerHTML = `<span class="chev" data-d="-1">‹</span><span class="val">${value()}</span><span class="chev" data-d="1">›</span>`;
    };
    render();
    const doChange = (d: number) => {
      change(d);
      render();
      this.cb.onUi('move');
      if (isSetting) {
        save('apexgp.settings', this.settings);
        this.cb.onSettings({ ...this.settings });
      } else this.commitSetup();
    };
    row.addEventListener('rerender', render);
    row.addEventListener('click', (e) => {
      const d = Number((e.target as HTMLElement).dataset.d ?? 1);
      doChange(d);
    });
    const idx = this.items.length;
    row.addEventListener('mouseenter', () => {
      this.sel = idx;
      this.highlight();
    });
    this.items.push({ el: row, kind: 'option', change: doChange, select: onSelect ?? (() => doChange(1)) });
  }

  /**
   * Keep a keyboard / gamepad selection in view inside its scrolling panel (the calendar, a long
   * set-up): clear of the sticky actions at the bottom of the hub panel. Mouse hover never scrolls.
   */
  private reveal(e: HTMLElement | undefined, block: 'nearest' | 'center' = 'nearest', behavior: ScrollBehavior = 'smooth') {
    if (!e) return;
    const box = e.closest<HTMLElement>('.hub-panel, .panel');
    if (!box || box.scrollHeight <= box.clientHeight + 1) return;
    // (the sticky actions scroll with the panel: an item inside them is always in view)
    const foot = box.querySelector<HTMLElement>(':scope > .hp-actions, :scope > .br-foot');
    if (foot?.contains(e)) return;
    const b = box.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    // (rects are screen px; scrollTop is in the zoomed layout's px)
    const k = b.height / Math.max(1, box.offsetHeight) || 1;
    const pad = 16 * k;
    const top = b.top + pad;
    const bottom = b.bottom - (foot ? foot.getBoundingClientRect().height : 0) - pad;
    let dy = 0;
    if (block === 'center') dy = r.top + r.height / 2 - (top + bottom) / 2;
    else if (r.top < top) dy = r.top - top;
    else if (r.bottom > bottom) dy = r.bottom - bottom;
    if (Math.abs(dy) < 1) return;
    box.scrollTo({ top: box.scrollTop + dy / k, behavior });
  }

  private highlight() {
    const hub = this.screen === 'title';
    if (hub) {
      const part = this.hubTab === 'setup' && this.hubFocus === 'panel' ? ((this.items[this.sel]?.el.dataset.part as SetupPart | undefined) ?? null) : null;
      if (part !== this.focusedPart) {
        this.focusedPart = part;
        this.cb.onFocusPart(part);
      }
    }
    this.hubTabs.forEach((e) => e.classList.toggle('sel', hub && this.hubFocus === 'tabs' && e.classList.contains('on')));
    this.items.forEach((it, i) => {
      it.el.classList.toggle('sel', i === this.sel && (!hub || this.hubFocus === 'panel'));
      if (it.kind === 'action' && !it.el.dataset.bound) {
        it.el.dataset.bound = '1';
        it.el.addEventListener('mouseenter', () => {
          this.sel = this.items.indexOf(it);
          this.highlight();
        });
        if (it.el.classList.contains('mitem')) it.el.addEventListener('click', () => it.select?.());
      }
    });
  }

  private hubNav(nav: MenuNav) {
    // Q / E step through the tabs from anywhere in the hub
    if (nav.tabL || nav.tabR) {
      const i = HUB_TABS.findIndex((t) => t.id === this.hubTab);
      const n = HUB_TABS.length;
      this.setTab(HUB_TABS[(i + (nav.tabR ? 1 : -1) + n) % n].id);
      this.hubFocus = 'tabs';
      this.highlight();
      this.cb.onUi('move');
      return;
    }
    if (this.hubFocus === 'tabs') {
      if (nav.left || nav.right) {
        const i = HUB_TABS.findIndex((t) => t.id === this.hubTab);
        const n = HUB_TABS.length;
        this.setTab(HUB_TABS[(i + (nav.right ? 1 : -1) + n) % n].id);
        this.cb.onUi('move');
      }
      if ((nav.accept || nav.down) && this.items.length) {
        this.hubFocus = 'panel';
        this.sel = Math.min(this.sel, this.items.length - 1);
        this.highlight();
        this.cb.onUi('select');
      }
      return;
    }
    // up from the panel's first row climbs back to the tab bar above it
    if (nav.up && this.sel === 0) {
      this.hubFocus = 'tabs';
      this.highlight();
      this.cb.onUi('move');
      return;
    }
    if (nav.up || nav.down) {
      const n = this.items.length;
      this.sel = (this.sel + (nav.down ? 1 : -1) + n) % n;
      this.highlight();
      this.reveal(this.items[this.sel]?.el);
      this.cb.onUi('move');
    }
    const it = this.items[this.sel];
    if (it && (nav.left || nav.right) && it.kind === 'option') it.change?.(nav.right ? 1 : -1);
    if (it && nav.accept) {
      this.cb.onUi('select');
      it.select?.();
    }
    if (nav.back || (nav.left && it?.kind !== 'option')) {
      this.cb.onUi('back');
      this.hubFocus = 'tabs';
      this.highlight();
    }
  }

  /** keyboard/gamepad navigation */
  update(nav: MenuNav) {
    if (this.wizardOpen) return;
    // binding a wheel: its own buttons and axes must not navigate (Enter / Esc are read directly)
    if (this.binder) return;
    if (this.screen === 'none' || this.items.length === 0) {
      if (this.screen === 'none') return;
    }
    if (this.screen === 'title') {
      if (this.hubTab === 'highlights') this.markPlaying(this.cb.nowPlaying?.() ?? null);
      if (this.cb.tourNav?.(nav)) return;
      return this.hubNav(nav);
    }
    if (nav.up || nav.down) {
      const n = this.items.length;
      this.sel = (this.sel + (nav.down ? 1 : -1) + n) % n;
      this.highlight();
      this.reveal(this.items[this.sel]?.el);
      this.cb.onUi('move');
    }
    const it = this.items[this.sel];
    if (it && (nav.left || nav.right) && it.kind === 'option') it.change?.(nav.right ? 1 : -1);
    if (it && nav.accept) {
      this.cb.onUi('select');
      it.select?.();
    }
    if (nav.back) {
      this.cb.onUi('back');
      if (this.screen === 'setup') this.show('title');
      else if (this.screen === 'settings') this.show(this.settingsReturn);
      else if (this.screen === 'assists') this.show(this.assistsReturn);
      else if (this.screen === 'camera') this.show('settings');
      else if (this.screen === 'controls') this.show(this.controlsReturn);
      else if (this.screen === 'pause') this.cb.onResume();
    }
  }
}
