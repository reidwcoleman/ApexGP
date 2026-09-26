import { TEAMS } from '../race/Teams.ts';
import type { QualityLevel } from '../core/Renderer.ts';
import type { CameraMode } from '../game/Cameras.ts';
import { CAMERA_LABEL, CAMERA_ORDER } from '../game/Cameras.ts';
import { CIRCUITS } from '../world/Circuits.ts';
import { fmtTime } from './HUD.ts';
import { POINTS, type TrackLimitsMode } from '../race/Race.ts';
import { uiColor, type Entry } from '../race/Teams.ts';
import type { DamageMode } from '../sim/CarPhysics.ts';
import { ASSIST_PRESETS, DEFAULT_ASSISTS, PRESET_LABEL, PRESET_ORDER, presetOf, type AssistConfig } from '../game/Assists.ts';
import { COMPOUNDS, COMPOUND_ORDER, type Compound } from '../race/Pit.ts';
import { WEATHER_LABEL, TIME_LABEL, type WeatherChoice, type TimeChoice } from '../world/Weather.ts';
import { Career, UPGRADES, MAX_LEVEL, upgradeCost, PALETTE, PATTERNS, FINISHES, UNLOCK_POS, UNLOCK_ALL, SETUP, type Paint, type RaceReward, type SetupPart } from '../career/Career.ts';
import { MOMENT_LABEL, type Highlights } from '../career/Highlights.ts';

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
  /** save format: bumped when the defaults change in a way old saves should pick up */
  v?: number;
}

export interface Settings {
  /** save format: bumped when the defaults change in a way old saves should pick up */
  v?: number;
  quality: QualityLevel;
  /** true until the player picks a graphics level themselves: the game may step it down */
  autoQuality?: boolean;
  camera: CameraMode;
  volume: number;
  /** background music level in the menus (0..1) */
  music: number;
}

export const LAPS = [3, 5, 10, 20];
/** AI level. Dynamic (the default) races at the player's own rating (career.aiSkill), learnt race by race */
export const DIFFICULTY = [
  { label: 'Dynamic', value: 0.92, dynamic: true },
  { label: 'Rookie', value: 0.9, dynamic: false },
  { label: 'Pro', value: 0.95, dynamic: false },
  { label: 'Elite', value: 0.98, dynamic: false },
  { label: 'Legend', value: 1.0, dynamic: false },
];
/** the AI level a race with this setup runs at, and whether it adapts */
export function aiLevel(setup: RaceSetup, career: Career): { value: number; dynamic: boolean } {
  const d = DIFFICULTY[setup.difficulty] ?? DIFFICULTY[0];
  return d.dynamic ? { value: career.aiSkill, dynamic: true } : { value: d.value, dynamic: false };
}
const TRACK_LIMITS: TrackLimitsMode[] = ['lenient', 'strict', 'off'];
const TRACK_LIMITS_LABEL: Record<TrackLimitsMode, string> = { lenient: 'Lenient', strict: 'Strict', off: 'Off' };
/** the setup save format (2: dynamic AI, lenient track limits, no braking assist by default; 3: random weather and time of day) */
const SETUP_V = 3;
const DEFAULT_SETUP: RaceSetup = { v: SETUP_V, team: 0, seat: 0, laps: 5, difficulty: 0, grid: 1, weather: 'random', time: 'random', assists: { ...DEFAULT_ASSISTS }, compound: 'auto', track: 'monza', damage: 'full', trackLimits: 'lenient' };
export const GRID = [
  { label: 'Pole position', slot: 0 },
  { label: 'Midfield', slot: 10 },
  { label: 'Back of the grid', slot: 21 },
  { label: 'Qualifying lap', slot: -1 },
];
const WEATHERS: WeatherChoice[] = ['random', 'clear', 'haze', 'windy', 'cloudy', 'overcast', 'mist', 'fog', 'drying', 'sunshower', 'drizzle', 'rain', 'storm', 'thunderstorm', 'changeable'];
const weatherLabel = (w: WeatherChoice) => (w === 'random' ? 'Random' : w === 'changeable' ? 'Changeable' : WEATHER_LABEL[w]);
const TIMES: TimeChoice[] = ['random', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];
const timeLabel = (t: TimeChoice) => (t === 'random' ? 'Random' : TIME_LABEL[t]);
const TYRE_CHOICES: (Compound | 'auto')[] = ['auto', ...COMPOUND_ORDER];
const QUALITY: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const SETTINGS_V = 3;
const DAMAGE: DamageMode[] = ['full', 'cosmetic', 'off'];
const DAMAGE_LABEL: Record<DamageMode, string> = { full: 'Full · cars can be destroyed', cosmetic: 'Visual only', off: 'Off' };

type ScreenId = 'title' | 'setup' | 'settings' | 'assists' | 'pause' | 'results' | 'none';

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
  onStart(mode: 'race' | 'timetrial', setup: RaceSetup): void;
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
}

export type HubTab = 'race' | 'career' | 'highlights' | 'car' | 'setup' | 'paint' | 'settings';
const HUB_TABS: { id: HubTab; label: string }[] = [
  { id: 'race', label: 'Race' },
  { id: 'career', label: 'Career' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'car', label: 'Car development' },
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
  private mode: 'race' | 'timetrial' = 'race';
  private cb: MenuCallbacks;
  private screens = new Map<ScreenId, HTMLDivElement>();
  private items: Item[] = [];
  private sel = 0;
  private settingsReturn: ScreenId = 'title';
  private assistsReturn: ScreenId = 'setup';
  private driverCard!: HTMLDivElement;

  readonly career: Career;
  highlights: Highlights | null = null;
  hubTab: HubTab = 'race';
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
    // saves from before the current defaults: pick up the new assists (no braking assist),
    // Dynamic AI and lenient track limits once; everything else the player chose stays
    const sv = this.setup.v ?? 0;
    if (sv < 2) this.setup = { ...this.setup, assists: { ...DEFAULT_ASSISTS }, difficulty: 0, trackLimits: 'lenient' };
    // every race different: the weather and the light are rolled fresh each time (once; a player's own choice after this stays)
    if (sv < 3) this.setup = { ...this.setup, weather: 'random', time: 'random' };
    if (sv < SETUP_V) {
      this.setup.v = SETUP_V;
      save('apexgp.setup', this.setup);
    }
    if (!(this.setup.difficulty >= 0 && this.setup.difficulty < DIFFICULTY.length)) this.setup.difficulty = 0;
    if (!TRACK_LIMITS.includes(this.setup.trackLimits)) this.setup.trackLimits = 'lenient';
    if (!DAMAGE.includes(this.setup.damage)) this.setup.damage = 'full';
    // saves from before per-assist settings stored a preset index
    if (!this.setup.compound) this.setup.compound = 'auto';
    if (!CIRCUITS.some((c) => c.id === this.setup.track)) this.setup.track = CIRCUITS[0].id;
    // saves from before the weather system
    if (!WEATHERS.includes(this.setup.weather)) this.setup.weather = 'random';
    if (!TIMES.includes(this.setup.time)) this.setup.time = 'random';
    if (typeof this.setup.assists !== 'object' || this.setup.assists === null) this.setup.assists = { ...DEFAULT_ASSISTS };
    else this.setup.assists = { ...DEFAULT_ASSISTS, ...this.setup.assists };
    this.settings = load<Settings>('apexgp.settings', { v: SETTINGS_V, quality: 'high', camera: 'chase', volume: 0.8, music: 0.35, autoQuality: true });
    if (typeof this.settings.music !== 'number') this.settings.music = 0.35;
    if (this.settings.autoQuality === undefined) this.settings.autoQuality = true;
    // older saves may have been stepped down by the automatic quality: start again from High
    if ((this.settings.v ?? 0) < SETTINGS_V) {
      this.settings = { ...this.settings, v: SETTINGS_V, quality: this.settings.quality === 'ultra' ? 'ultra' : 'high', autoQuality: true };
      save('apexgp.settings', this.settings);
    }
    for (const id of ['title', 'setup', 'settings', 'assists', 'pause', 'results'] as ScreenId[]) {
      const s = el('div', 'screen', this.root);
      this.screens.set(id, s);
    }
  }

  // ------------------------------------------------------------ screens

  show(id: ScreenId) {
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
    if (id === 'pause') this.buildPause();
    this.highlight();
  }

  // ------------------------------------------------------------ the garage (title screen)

  private buildTitle() {
    const s = this.screens.get('title')!;
    s.innerHTML = '';
    s.classList.add('hub');
    const team = TEAMS[this.setup.team];
    const d = team.drivers[this.setup.seat];
    const paint = this.career.paintFor(this.setup.team);
    const accent = paint ? (paint.primary === '#111214' || paint.primary === '#2a2d33' ? paint.secondary : paint.primary) : uiColor(team);
    s.style.setProperty('--accent', accent);
    s.style.setProperty('--on-accent', onColor(accent));
    el('div', 'hub-scrim', s);
    const c = this.career.data;
    el(
      'div',
      'hub-id',
      s,
      `<div class="num">${d.number}</div><div class="who"><div class="name">${d.first} <b>${d.last}</b></div><div class="sub">${team.name} · ${c.races ? `${c.races} race${c.races === 1 ? '' : 's'} · ${c.points} pts` : 'Rookie season'}</div></div>`,
    );
    this.hubCredits = el('div', 'hub-credits', s);
    this.renderCredits();
    const rail = el('div', 'hub-rail', s);
    el('div', 'hub-brand', rail, 'Apex <span>GP</span>');
    this.hubTabs = HUB_TABS.map((t, i) => {
      const e = el('div', 'htab', rail, t.label);
      e.addEventListener('click', () => {
        this.setTab(HUB_TABS[i].id);
        this.hubFocus = 'panel';
        this.sel = 0;
        this.highlight();
      });
      e.addEventListener('mouseenter', () => {
        if (this.hubTab !== t.id) return;
      });
      return e;
    });
    this.hubPanel = el('div', 'hub-panel', s);
    el('div', 'keys hub-keys', s, '<kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> select · <kbd>←</kbd> <kbd>→</kbd> change · <kbd>Esc</kbd> back · gamepad supported');
    this.setTab(this.hubTab);
  }

  private renderCredits() {
    if (!this.hubCredits) return;
    this.hubCredits.innerHTML = `<div class="cap">Credits</div><div class="val">${fmtCr(this.career.data.credits)}</div>`;
  }

  private setTab(tab: HubTab) {
    this.hubTab = tab;
    this.hubTabs.forEach((e, i) => e.classList.toggle('on', HUB_TABS[i].id === tab));
    this.cb.onHubTab(tab);
    this.renderTab();
  }

  private renderTab() {
    const p = this.hubPanel;
    if (!p) return;
    p.innerHTML = '';
    p.className = 'hub-panel glass';
    void p.offsetWidth;
    p.classList.add('in');
    this.items = [];
    this.sel = Math.min(this.sel, 0);
    if (this.hubTab === 'race') this.tabRace(p);
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

  private tabRace(p: HTMLElement) {
    el('div', 'hp-cap', p, 'Calendar');
    CIRCUITS.forEach((cd, i) => {
      const info = CIRCUIT_INFO[cd.id] ?? { country: cd.country, km: '', turns: cd.corners?.length ?? 0, line: '' };
      const open = this.career.isUnlocked(cd.id);
      const here = cd.id === this.setup.track;
      const best = this.career.data.best[cd.id];
      const card = el('div', 'ccard' + (open ? '' : ' locked') + (here ? ' here' : ''), p);
      const path = cd.centerline ? circuitPath(cd.centerline.points, 96, 64) : '';
      const prev = CIRCUITS[i - 1];
      const status = !open
        ? `<span class="lock"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor"/></svg>Top ${UNLOCK_POS} at ${prev?.short ?? ''} unlocks</span>`
        : best !== undefined
          ? `<span class="best">Best <b>P${best}</b></span>`
          : `<span class="best dim">Not raced</span>`;
      card.innerHTML = `<svg class="map" viewBox="0 0 96 64"><path d="${path}"/></svg><div class="cinfo"><div class="round">Round ${i + 1} · ${info.country}${here ? ' · <b>Selected</b>' : ''}</div><div class="cname">${cd.name}</div><div class="cmeta">${info.km} km · ${info.turns} turns</div>${status}</div>`;
      this.action(card, () => {
        if (here) {
          this.mode = 'race';
          this.show('setup');
        } else {
          this.setup.track = cd.id;
          save('apexgp.setup', this.setup);
          this.cb.onTravel(cd.id);
        }
      }, !open);
    });
    const row = el('div', 'hp-actions', p);
    const race = el('div', 'cta', row, 'Race weekend');
    const tt = el('div', 'cta ghost', row, 'Time trial');
    this.action(race, () => {
      this.mode = 'race';
      this.show('setup');
    });
    this.action(tt, () => {
      this.mode = 'timetrial';
      this.show('setup');
    });
    if (this.cb.onSpectate) {
      // simulate the race: all cars driven by the AI, the TV director on the cameras
      const watch = el('div', 'cta ghost watch', row, 'Watch a simulated race');
      this.action(watch, () => this.cb.onSpectate?.({ ...this.setup }));
    }
    el('div', 'hp-note', p, UNLOCK_ALL ? 'Every circuit is open: pick any round and race. Points pay credits for car development.' : `Finish in the top ${UNLOCK_POS} to unlock the next round. Points pay credits for car development.`);
    // start on the Race button
    this.sel = CIRCUITS.length;
  }

  private tabCareer(p: HTMLElement) {
    const c = this.career.data;
    el('div', 'hp-cap', p, 'Career');
    const grid = el('div', 'stats', p);
    const stat = (k: string, v: string | number, hero = false) => el('div', 'stat' + (hero ? ' hero' : ''), grid, `<div class="v">${v}</div><div class="k">${k}</div>`);
    stat('Points', c.points, true);
    stat('Wins', c.wins, true);
    stat('Races', c.races);
    stat('Podiums', c.podiums);
    stat('Retirements', c.dnfs);
    stat('Win rate', c.races ? `${Math.round((c.wins / c.races) * 100)}%` : '—');
    el('div', 'hp-cap', p, 'Best finishes');
    const bl = el('div', 'bests', p);
    for (const cd of CIRCUITS) {
      const b = c.best[cd.id];
      el('div', 'brow', bl, `<span>${cd.name}</span><b>${b !== undefined ? `P${b}` : this.career.isUnlocked(cd.id) ? '—' : 'Locked'}</b>`);
    }
    el('div', 'hp-cap', p, 'Recent races');
    const hl = el('div', 'hist', p);
    if (!c.history.length) el('div', 'empty', hl, 'No races yet. Your results, points and prize money will show up here.');
    for (const h of c.history.slice(0, 5)) {
      const cd = CIRCUITS.find((x) => x.id === h.track);
      const t = TEAMS[h.team];
      el(
        'div',
        'hrow',
        hl,
        `<span class="pos${h.pos === 1 && !h.dnf ? ' win' : ''}">${h.dnf ? 'DNF' : `P${h.pos}`}</span><span class="bar" style="background:${t ? uiColor(t) : 'var(--ink3)'}"></span><span class="where">${cd?.short ?? h.track}</span><span class="pts">${h.points ? `+${h.points} pts` : ''}</span><span class="cr">+${fmtCr(h.credits)}</span>`,
      );
    }
  }

  private tabCar(p: HTMLElement) {
    el('div', 'hp-cap', p, 'Car development');
    const dev = Math.round(this.career.development() * 100);
    el('div', 'devbar', p, `<div class="lbl"><span>Overall</span><b>${dev}%</b></div><div class="track"><i style="width:${dev}%"></i></div>`);
    for (const u of UPGRADES) {
      const n = this.career.level(u.id);
      const max = n >= MAX_LEVEL;
      const cost = upgradeCost(n);
      const afford = this.career.data.credits >= cost;
      const row = el('div', 'uprow' + (max ? ' max' : !afford ? ' poor' : ''), p);
      const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
      row.innerHTML = `<div class="ul"><div class="un">${u.name}</div><div class="us">${max ? 'Fully developed' : `Next: ${u.step}`}</div></div><div class="pips">${pips}</div><div class="ubtn">${max ? 'Max' : fmtCr(cost)}</div>`;
      this.action(row, () => {
        if (this.career.buy(u.id)) {
          this.cb.onCarChange();
          const keep = this.sel;
          this.renderCredits();
          this.renderTab();
          this.sel = keep;
          this.highlight();
          const r = this.items[keep]?.el;
          r?.classList.add('bought');
        }
      }, max || !afford);
    }
    el('div', 'hp-note', p, 'Upgrades apply to your car only. Earn credits by scoring points: a win pays ' + fmtCr(75000) + '.');
  }

  private tabPaint(p: HTMLElement) {
    const team = TEAMS[this.setup.team];
    const cur: Paint = this.career.paintFor(this.setup.team) ?? { primary: team.primary, secondary: team.secondary, accent: team.accent, pattern: 'sweep', finish: team.matte > 0.6 ? 'matte' : 'gloss' };
    const custom = !!this.career.paintFor(this.setup.team);
    el('div', 'hp-cap', p, `Paint shop · ${custom ? 'Your livery' : team.name + ' livery'}`);
    let timer = 0;
    const commit = (next: Paint) => {
      this.career.setPaint(this.setup.team, next);
      clearTimeout(timer);
      timer = window.setTimeout(() => this.cb.onCarChange(), 120);
      const hub = this.screens.get('title')!;
      const a = next.primary === '#111214' || next.primary === '#2a2d33' ? next.secondary : next.primary;
      hub.style.setProperty('--accent', a);
      hub.style.setProperty('--on-accent', onColor(a));
    };
    const swatches = (label: string, key: 'primary' | 'secondary' | 'accent') => {
      const row = el('div', 'prow', p);
      el('div', 'pk', row, label);
      const wrap = el('div', 'sw', row);
      const draw = () => {
        wrap.innerHTML = '';
        PALETTE.forEach((c) => {
          const b = el('i', c.toLowerCase() === cur[key].toLowerCase() ? 'on' : '', wrap);
          b.style.background = c;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            cur[key] = c;
            commit({ ...cur });
            draw();
          });
        });
      };
      draw();
      const idx = this.items.length;
      this.items.push({
        el: row,
        kind: 'option',
        change: (d) => {
          let i = PALETTE.findIndex((c) => c.toLowerCase() === cur[key].toLowerCase());
          i = (i < 0 ? 0 : i + d + PALETTE.length) % PALETTE.length;
          cur[key] = PALETTE[i];
          commit({ ...cur });
          draw();
          this.cb.onUi('move');
        },
        select: () => {},
      });
      row.addEventListener('mouseenter', () => {
        this.hubFocus = 'panel';
        this.sel = idx;
        this.highlight();
      });
    };
    swatches('Base', 'primary');
    swatches('Secondary', 'secondary');
    swatches('Accent', 'accent');
    const chips = <T extends string>(label: string, list: { id: T; name: string }[], get: () => T, set: (v: T) => void) => {
      const row = el('div', 'prow', p);
      el('div', 'pk', row, label);
      const wrap = el('div', 'chips', row);
      const draw = () => {
        wrap.innerHTML = '';
        for (const it of list) {
          const b = el('span', it.id === get() ? 'on' : '', wrap, it.name);
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            set(it.id);
            commit({ ...cur });
            draw();
          });
        }
      };
      draw();
      const idx = this.items.length;
      this.items.push({
        el: row,
        kind: 'option',
        change: (d) => {
          const i = list.findIndex((x) => x.id === get());
          set(list[(i + d + list.length) % list.length].id);
          commit({ ...cur });
          draw();
          this.cb.onUi('move');
        },
        select: () => {},
      });
      row.addEventListener('mouseenter', () => {
        this.hubFocus = 'panel';
        this.sel = idx;
        this.highlight();
      });
    };
    chips('Design', PATTERNS, () => cur.pattern, (v) => (cur.pattern = v));
    chips('Finish', FINISHES, () => cur.finish, (v) => (cur.finish = v));
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
      this.action(go, () => this.setTab('race'));
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
    el('div', 'hp-note', p, 'Drag the car to look around it. The set-up applies to your car from the next session.');
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
    const p = el('div', 'panel glass', s);
    el('h2', '', p, this.mode === 'race' ? 'Race' : 'Time trial');
    el('p', 'lede', p, this.mode === 'race' ? 'Standing start from the grid.' : 'Flying lap. Beat your best.');
    const st = this.setup;
    this.opt(p, 'Team', () => {
      const t = TEAMS[st.team];
      return `<span class="swatch" style="background:${t.primary}"></span>${t.name}`;
    }, (d) => {
      st.team = (st.team + d + TEAMS.length) % TEAMS.length;
    });
    this.opt(p, 'Driver', () => {
      const dr = TEAMS[st.team].drivers[st.seat];
      return `${dr.first} ${dr.last}`;
    }, () => {
      st.seat = st.seat === 0 ? 1 : 0;
    });
    if (this.mode === 'race') {
      this.opt(p, 'Laps', () => String(st.laps), (d) => {
        const i = LAPS.indexOf(st.laps);
        st.laps = LAPS[(Math.max(0, i) + d + LAPS.length) % LAPS.length];
      });
      this.opt(p, 'Opponents', () => {
        const dd = DIFFICULTY[st.difficulty] ?? DIFFICULTY[0];
        return dd.dynamic ? `Dynamic <span class="dim">· ${Math.round(this.career.aiSkill * 100)}%</span>` : dd.label;
      }, (d) => {
        st.difficulty = (st.difficulty + d + DIFFICULTY.length) % DIFFICULTY.length;
      });
      this.opt(p, 'Start from', () => GRID[st.grid].label, (d) => {
        st.grid = (st.grid + d + GRID.length) % GRID.length;
      });
    }
    if (this.mode === 'race') {
      this.opt(
        p,
        'Starting tyres',
        () => (st.compound === 'auto' ? 'Team choice' : `<span class="tyredot" style="background:${COMPOUNDS[st.compound].color}"></span>${COMPOUNDS[st.compound].label}`),
        (d) => {
          const i = TYRE_CHOICES.indexOf(st.compound);
          st.compound = TYRE_CHOICES[(i + d + TYRE_CHOICES.length) % TYRE_CHOICES.length];
        },
      );
    }
    if (this.mode === 'race') {
      this.opt(p, 'Damage', () => DAMAGE_LABEL[st.damage], (d) => {
        const i = DAMAGE.indexOf(st.damage);
        st.damage = DAMAGE[(i + d + DAMAGE.length) % DAMAGE.length];
      });
    }
    this.opt(p, 'Track limits', () => TRACK_LIMITS_LABEL[st.trackLimits] ?? 'Lenient', (d) => {
      const i = Math.max(0, TRACK_LIMITS.indexOf(st.trackLimits));
      st.trackLimits = TRACK_LIMITS[(i + d + TRACK_LIMITS.length) % TRACK_LIMITS.length];
    });
    const open = this.career.unlockedCircuits();
    if (open.length > 1)
      this.opt(p, 'Circuit', () => (CIRCUITS.find((c) => c.id === st.track) ?? CIRCUITS[0]).name, (d) => {
        const i = Math.max(0, open.findIndex((c) => c.id === st.track));
        st.track = open[(i + d + open.length) % open.length].id;
      });
    this.opt(p, 'Weather', () => (st.weather === 'random' || st.weather === 'changeable' ? `${weatherLabel(st.weather)} <span class="dim">· ${this.cb.forecast().weather}</span>` : weatherLabel(st.weather)), (d) => {
      const i = WEATHERS.indexOf(st.weather);
      st.weather = WEATHERS[(i + d + WEATHERS.length) % WEATHERS.length];
    });
    this.opt(p, 'Time of day', () => (st.time === 'random' ? `Random <span class="dim">· ${this.cb.forecast().time}</span>` : timeLabel(st.time)), (d) => {
      const i = TIMES.indexOf(st.time);
      st.time = TIMES[(i + d + TIMES.length) % TIMES.length];
    });
    this.opt(
      p,
      'Assists',
      () => {
        const pr = presetOf(st.assists);
        return pr === 'custom' ? 'Custom' : PRESET_LABEL[pr];
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
    const cta = el('div', 'cta', p, this.mode === 'race' ? 'Start race' : 'Start time trial');
    this.items.push({ el: cta, kind: 'action', select: () => this.cb.onStart(this.mode, { ...this.setup }) });
    cta.addEventListener('click', () => this.cb.onStart(this.mode, { ...this.setup }));
    el('div', 'back', p, 'Esc to go back');
    this.driverCard = el('div', 'drivercard', s);
    this.updateDriverCard();
    this.sel = this.items.length - 1;
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
    const label: Record<QualityLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };
    this.opt(p, 'Graphics', () => label[st.quality] + (st.autoQuality ? ' <span class="dim">· auto</span>' : ''), (d) => {
      const i = QUALITY.indexOf(st.quality);
      st.quality = QUALITY[(i + d + QUALITY.length) % QUALITY.length];
      st.autoQuality = false;
    }, true);
    this.opt(p, 'Camera', () => CAMERA_LABEL[st.camera], (d) => {
      const i = CAMERA_ORDER.indexOf(st.camera);
      st.camera = CAMERA_ORDER[(i + d + CAMERA_ORDER.length) % CAMERA_ORDER.length];
    }, true);
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
    const w = el('div', 'title-wrap', s);
    el('div', 'logo', w, 'Paused');
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

  showResults(rows: ResultRow[], title: string, lede: string, onAgain: () => void, onMenu: () => void, onReplay?: () => void, reward?: RaceReward | null) {
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
      if (reward.unlocked) {
        const cd = CIRCUITS.find((c) => c.id === reward.unlocked);
        el('div', 'rw-unlock', box, `<b>New circuit unlocked</b> · ${cd?.name ?? reward.unlocked} is open in the garage`);
      }
    }
    const act = el('div', 'actions' + (onReplay ? ' three' : ''), box);
    const again = el('div', 'cta', act, 'Race again');
    this.items = [{ el: again, kind: 'action', select: onAgain }];
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
      v.innerHTML = `<span class="chev" data-d="-1">‹</span>${value()}<span class="chev" data-d="1">›</span>`;
    };
    render();
    const doChange = (d: number) => {
      change(d);
      render();
      this.cb.onUi('move');
      if (isSetting) {
        save('apexgp.settings', this.settings);
        this.cb.onSettings({ ...this.settings });
      } else {
        save('apexgp.setup', this.setup);
        this.updateDriverCard();
        this.cb.onSetupChange({ ...this.setup });
        // the driver name depends on the team
        this.items.forEach((it) => it.el.dispatchEvent(new Event('rerender')));
      }
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

  private hubNav(nav: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean }) {
    if (this.hubFocus === 'tabs') {
      if (nav.up || nav.down) {
        const i = HUB_TABS.findIndex((t) => t.id === this.hubTab);
        const n = HUB_TABS.length;
        this.setTab(HUB_TABS[(i + (nav.down ? 1 : -1) + n) % n].id);
        this.cb.onUi('move');
      }
      if ((nav.accept || nav.right) && this.items.length) {
        this.hubFocus = 'panel';
        this.sel = Math.min(this.sel, this.items.length - 1);
        this.highlight();
        this.cb.onUi('select');
      }
      return;
    }
    if (nav.up || nav.down) {
      const n = this.items.length;
      this.sel = (this.sel + (nav.down ? 1 : -1) + n) % n;
      this.highlight();
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
  update(nav: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean }) {
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
      else if (this.screen === 'pause') this.cb.onResume();
    }
  }
}
