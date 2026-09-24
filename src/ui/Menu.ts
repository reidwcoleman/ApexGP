import { TEAMS } from '../race/Teams.ts';
import type { QualityLevel } from '../core/Renderer.ts';
import type { CameraMode } from '../game/Cameras.ts';
import { CAMERA_LABEL, CAMERA_ORDER } from '../game/Cameras.ts';
import { CIRCUITS } from '../world/Circuits.ts';
import { fmtTime } from './HUD.ts';
import { POINTS } from '../race/Race.ts';
import { uiColor, type Entry } from '../race/Teams.ts';
import { ASSIST_PRESETS, PRESET_LABEL, PRESET_ORDER, presetOf, type AssistConfig } from '../game/Assists.ts';
import { COMPOUNDS, COMPOUND_ORDER, type Compound } from '../race/Pit.ts';
import { WEATHER_LABEL, TIME_LABEL, type WeatherChoice, type TimeChoice } from '../world/Weather.ts';

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
}

export interface Settings {
  quality: QualityLevel;
  /** true until the player picks a graphics level themselves: the game may step it down */
  autoQuality?: boolean;
  camera: CameraMode;
  volume: number;
}

export const LAPS = [3, 5, 10, 20];
export const DIFFICULTY = [
  { label: 'Rookie', value: 0.9 },
  { label: 'Pro', value: 0.95 },
  { label: 'Elite', value: 0.98 },
  { label: 'Legend', value: 1.0 },
];
export const GRID = [
  { label: 'Pole position', slot: 0 },
  { label: 'Midfield', slot: 10 },
  { label: 'Back of the grid', slot: 21 },
  { label: 'Qualifying lap', slot: -1 },
];
const WEATHERS: WeatherChoice[] = ['random', 'clear', 'haze', 'windy', 'cloudy', 'overcast', 'mist', 'fog', 'drying', 'sunshower', 'drizzle', 'rain', 'storm', 'thunderstorm', 'changeable'];
const weatherLabel = (w: WeatherChoice) => (w === 'random' ? 'Random' : w === 'changeable' ? 'Changeable' : WEATHER_LABEL[w]);
const TIMES: TimeChoice[] = ['random', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset'];
const timeLabel = (t: TimeChoice) => (t === 'random' ? 'Random' : TIME_LABEL[t]);
const TYRE_CHOICES: (Compound | 'auto')[] = ['auto', ...COMPOUND_ORDER];
const QUALITY: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

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

  constructor(parent: HTMLElement, cb: MenuCallbacks) {
    this.cb = cb;
    this.root = el('div', '', parent);
    this.root.id = 'menu';
    this.setup = load<RaceSetup>('apexgp.setup', { team: 0, seat: 0, laps: 5, difficulty: 1, grid: 1, weather: 'random', time: 'random', assists: { ...ASSIST_PRESETS.casual }, compound: 'auto', track: 'monza' });
    // saves from before per-assist settings stored a preset index
    if (!this.setup.compound) this.setup.compound = 'auto';
    if (!CIRCUITS.some((c) => c.id === this.setup.track)) this.setup.track = CIRCUITS[0].id;
    // saves from before the weather system
    if (!WEATHERS.includes(this.setup.weather)) this.setup.weather = 'random';
    if (!TIMES.includes(this.setup.time)) this.setup.time = 'random';
    if (typeof this.setup.assists !== 'object' || this.setup.assists === null) this.setup.assists = { ...ASSIST_PRESETS.casual };
    else this.setup.assists = { ...ASSIST_PRESETS.casual, ...this.setup.assists };
    this.settings = load<Settings>('apexgp.settings', { quality: 'high', camera: 'chase', volume: 0.8, autoQuality: true });
    if (this.settings.autoQuality === undefined) this.settings.autoQuality = true;
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
    if (id === 'title') this.buildTitle();
    if (id === 'setup') this.buildSetup();
    if (id === 'settings') this.buildSettings();
    if (id === 'assists') this.buildAssists();
    if (id === 'pause') this.buildPause();
    this.highlight();
  }

  private buildTitle() {
    const s = this.screens.get('title')!;
    s.innerHTML = '';
    el('div', 'scrim', s);
    const w = el('div', 'title-wrap', s);
    el('div', 'logo', w, 'Apex <span class="gp">GP</span>');
    el('div', 'logo-sub', w, 'Autodromo Nazionale Monza · 5.793 km · 11 turns');
    const list = el('div', 'mlist', w);
    const add = (label: string, desc: string, fn: () => void) => {
      const e = el('div', 'mitem', list, `${label}<span class="desc">${desc}</span>`);
      this.items.push({ el: e, kind: 'action', select: fn });
    };
    add('Race', 'Twenty cars, lights out, you against the grid', () => {
      this.mode = 'race';
      this.show('setup');
    });
    add('Time trial', 'An empty circuit and the clock', () => {
      this.mode = 'timetrial';
      this.show('setup');
    });
    add('Settings', 'Graphics, camera, sound, driving assists', () => {
      this.settingsReturn = 'title';
      this.show('settings');
    });
    el('div', 'keys', w, '<kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> select · gamepad supported');
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
      this.opt(p, 'Opponents', () => DIFFICULTY[st.difficulty].label, (d) => {
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
    this.opt(p, 'Circuit', () => (CIRCUITS.find((c) => c.id === st.track) ?? CIRCUITS[0]).name, (d) => {
      const i = Math.max(0, CIRCUITS.findIndex((c) => c.id === st.track));
      st.track = CIRCUITS[(i + d + CIRCUITS.length) % CIRCUITS.length].id;
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
    add('Quit to menu', () => this.cb.onQuit());
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

  showResults(rows: ResultRow[], title: string, lede: string, onAgain: () => void, onMenu: () => void, onReplay?: () => void) {
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
      const gap = r.pos === 1 ? fmtTime(r.time) : r.gap < 0 ? `+${-r.gap} lap${r.gap < -1 ? 's' : ''}` : isFinite(r.gap) && r.gap > 0 ? `+${r.gap.toFixed(3)}` : 'DNF';
      const pts = r.pos <= 10 ? POINTS[r.pos - 1] + (r.fastest && r.pos <= 10 ? 1 : 0) : 0;
      const row = el(
        'div',
        'rrow' + (r.isPlayer ? ' me' : ''),
        table,
        `<span class="p">${r.pos}</span><span class="bar" style="background:${uiColor(r.entry.team)}"></span><span>${r.entry.driver.first} ${r.entry.driver.last}</span><span class="team">${r.entry.team.name}</span><span class="gap">${gap}${r.penalty ? ` (+${r.penalty}s)` : ''}</span><span class="best${r.fastest ? ' purple' : ''}">${fmtTime(r.best)}</span><span class="pts">${pts || ''}</span>`,
      );
      row.style.animationDelay = `${0.15 + i * 0.035}s`;
    });
    const act = el('div', 'actions' + (onReplay ? ' three' : ''), box);
    const again = el('div', 'cta', act, 'Race again');
    this.items = [{ el: again, kind: 'action', select: onAgain }];
    again.addEventListener('click', onAgain);
    if (onReplay) {
      const rp = el('div', 'cta ghost', act, 'Watch replay');
      this.items.push({ el: rp, kind: 'action', select: onReplay });
      rp.addEventListener('click', onReplay);
    }
    const menu = el('div', 'cta ghost', act, 'Main menu');
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
    this.items.forEach((it, i) => {
      it.el.classList.toggle('sel', i === this.sel);
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

  /** keyboard/gamepad navigation */
  update(nav: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean }) {
    if (this.screen === 'none' || this.items.length === 0) {
      if (this.screen === 'none') return;
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
