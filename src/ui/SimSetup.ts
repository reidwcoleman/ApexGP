import { CIRCUITS } from '../world/Circuits.ts';
import { allEntries, uiColor } from '../race/Teams.ts';
import { WEATHER_LABEL, TIME_LABEL, type WeatherChoice, type TimeChoice, type WeatherKind, type TimeOfDay } from '../world/Weather.ts';
import type { DamageMode } from '../sim/CarPhysics.ts';
import { CIRCUIT_INFO, circuitPath } from './Menu.ts';

/**
 * "Simulate a race": the setup screen for a race the AI drives and the TV
 * director films. Same look and keys as the race setup (a glass panel of ‹ ›
 * options over the garage), plus "Randomise everything". It lives inside the
 * menu's root but runs its own keyboard (capture phase) while open.
 */

export type SimGrid = 'quali' | 'random' | 'reversed' | 'pace';
export type SimField = 'close' | 'mixed' | 'wild';

export interface SimConfig {
  /** circuit id, or 'random' (a different one every time) */
  track: string;
  laps: number;
  weather: WeatherChoice;
  time: TimeChoice;
  grid: SimGrid;
  field: SimField;
  damage: DamageMode;
  speed: number;
  /** -1 = the director picks the car; else an index into allEntries() */
  follow: number;
}

export const SIM_LAPS = [3, 5, 8, 10, 15, 20, 30];
export const SIM_SPEEDS = [1, 2, 4, 8];
const GRIDS: SimGrid[] = ['quali', 'random', 'reversed', 'pace'];
const GRID_LABEL: Record<SimGrid, string> = { quali: 'Simulated qualifying', random: 'Random draw', reversed: 'Reversed qualifying', pace: 'Fastest first' };
const FIELDS: SimField[] = ['close', 'mixed', 'wild'];
const FIELD_LABEL: Record<SimField, string> = { close: 'Close racing', mixed: 'Realistic', wild: 'Wild · aggressive, big spread' };
const DAMAGES: DamageMode[] = ['full', 'cosmetic', 'off'];
const DAMAGE_LABEL: Record<DamageMode, string> = { full: 'Full · cars can be destroyed', cosmetic: 'Visual only', off: 'Off' };
const KINDS = Object.keys(WEATHER_LABEL) as WeatherKind[];
const WEATHERS: WeatherChoice[] = ['random', 'changeable', ...KINDS];
const TODS = Object.keys(TIME_LABEL) as TimeOfDay[];
const TIMES: TimeChoice[] = ['random', ...TODS];

const DEFAULT: SimConfig = { track: 'random', laps: 5, weather: 'random', time: 'random', grid: 'quali', field: 'mixed', damage: 'full', speed: 1, follow: -1 };

function load(): SimConfig {
  try {
    const raw = localStorage.getItem('apexgp.sim');
    const c = raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
    if (c.track !== 'random' && !CIRCUITS.some((x) => x.id === c.track)) c.track = 'random';
    if (!SIM_LAPS.includes(c.laps)) c.laps = 5;
    if (!WEATHERS.includes(c.weather)) c.weather = 'random';
    if (!TIMES.includes(c.time)) c.time = 'random';
    if (!GRIDS.includes(c.grid)) c.grid = 'quali';
    if (!FIELDS.includes(c.field)) c.field = 'mixed';
    if (!DAMAGES.includes(c.damage)) c.damage = 'full';
    if (!SIM_SPEEDS.includes(c.speed)) c.speed = 1;
    if (!(c.follow >= -1 && c.follow < allEntries().length)) c.follow = -1;
    return c;
  } catch {
    return { ...DEFAULT };
  }
}

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const cycle = <T,>(a: readonly T[], v: T, d: number): T => a[(Math.max(0, a.indexOf(v)) + d + a.length) % a.length];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

interface Row {
  el: HTMLElement;
  change?: (d: number) => void;
  select: () => void;
  render?: () => void;
}

export class SimSetup {
  readonly root: HTMLDivElement;
  cfg: SimConfig = load();
  open = false;
  private rows: Row[] = [];
  private sel = 0;
  private card!: HTMLDivElement;
  private readonly entries = allEntries();

  constructor(
    parent: HTMLElement,
    private cb: { onStart(cfg: SimConfig): void; onBack(): void; onUi(k: 'move' | 'select' | 'back'): void; currentTrack(): string },
  ) {
    this.root = el('div', 'screen simsetup', parent);
    addEventListener('keydown', (e) => this.onKey(e), { capture: true });
  }

  show() {
    this.open = true;
    this.build();
    this.root.classList.add('on');
  }

  hide() {
    this.open = false;
    this.root.classList.remove('on');
  }

  private save() {
    try {
      localStorage.setItem('apexgp.sim', JSON.stringify(this.cfg));
    } catch {
      /* storage unavailable */
    }
  }

  /** a different race: another circuit, conditions, grid and field */
  randomise() {
    const c = this.cfg;
    const others = CIRCUITS.filter((x) => x.id !== this.cb.currentTrack());
    c.track = pick(others.length ? others : CIRCUITS).id;
    c.laps = pick([3, 5, 5, 8, 10]);
    c.weather = Math.random() < 0.25 ? 'changeable' : pick(KINDS);
    c.time = pick(TODS);
    c.grid = pick(GRIDS);
    c.field = pick(FIELDS);
    c.damage = Math.random() < 0.85 ? 'full' : 'cosmetic';
    c.follow = -1;
    this.save();
    this.rows.forEach((r) => r.render?.());
    this.renderCard();
  }

  private build() {
    const s = this.root;
    s.innerHTML = '';
    this.rows = [];
    el('div', 'scrim', s);
    const p = el('div', 'panel glass', s);
    el('h2', '', p, 'Simulate a race');
    el('p', 'lede', p, 'Every car on the AI, the TV director on the cameras.');
    const c = this.cfg;
    const opt = (key: string, value: () => string, change: (d: number) => void) => {
      const row = el('div', 'opt', p);
      el('span', 'k', row, key);
      const v = el('span', 'v', row);
      const render = () => (v.innerHTML = `<span class="chev" data-d="-1">‹</span>${value()}<span class="chev" data-d="1">›</span>`);
      render();
      const r: Row = {
        el: row,
        render,
        change: (d) => {
          change(d);
          render();
          this.save();
          this.renderCard();
          this.cb.onUi('move');
        },
        select: () => r.change!(1),
      };
      row.addEventListener('click', (e) => r.change!(Number((e.target as HTMLElement).dataset.d ?? 1)));
      this.addRow(r);
    };
    const trackIds = ['random', ...CIRCUITS.map((x) => x.id)];
    opt('Circuit', () => (c.track === 'random' ? 'Random <span class="dim">· a different one</span>' : (CIRCUITS.find((x) => x.id === c.track)?.name ?? '')), (d) => (c.track = cycle(trackIds, c.track, d)));
    opt('Laps', () => String(c.laps), (d) => (c.laps = cycle(SIM_LAPS, c.laps, d)));
    opt('Weather', () => (c.weather === 'random' ? 'Random' : c.weather === 'changeable' ? 'Changeable' : WEATHER_LABEL[c.weather]), (d) => (c.weather = cycle(WEATHERS, c.weather, d)));
    opt('Time of day', () => (c.time === 'random' ? 'Random' : TIME_LABEL[c.time]), (d) => (c.time = cycle(TIMES, c.time, d)));
    opt('Grid', () => GRID_LABEL[c.grid], (d) => (c.grid = cycle(GRIDS, c.grid, d)));
    opt('The field', () => FIELD_LABEL[c.field], (d) => (c.field = cycle(FIELDS, c.field, d)));
    opt('Damage', () => DAMAGE_LABEL[c.damage], (d) => (c.damage = cycle(DAMAGES, c.damage, d)));
    opt('Sim speed', () => `${c.speed}×`, (d) => (c.speed = cycle(SIM_SPEEDS, c.speed, d)));
    const follows = [-1, ...this.entries.map((_, i) => i)];
    opt(
      'Cameras follow',
      () => {
        if (c.follow < 0) return '<span class="simdot"></span>Director · auto';
        const e = this.entries[c.follow];
        return `<span class="swatch" style="background:${uiColor(e.team)}"></span>${e.driver.first} ${e.driver.last}`;
      },
      (d) => (c.follow = cycle(follows, c.follow, d)),
    );
    const acts = el('div', 'simacts', p);
    const rnd = el('div', 'cta ghost', acts, 'Randomise everything');
    this.addRow({ el: rnd, select: () => (this.randomise(), this.cb.onUi('select')) });
    rnd.addEventListener('click', () => (this.randomise(), this.cb.onUi('select')));
    const go = el('div', 'cta', acts, 'Start simulation');
    const start = () => {
      this.cb.onUi('select');
      this.cb.onStart({ ...this.cfg });
    };
    this.addRow({ el: go, select: start });
    go.addEventListener('click', start);
    el('div', 'back', p, 'Esc to go back');
    this.card = el('div', 'simcard', s);
    this.renderCard();
    this.sel = this.rows.length - 1;
    this.highlight();
  }

  private addRow(r: Row) {
    const i = this.rows.length;
    this.rows.push(r);
    r.el.addEventListener('mouseenter', () => {
      this.sel = i;
      this.highlight();
    });
  }

  /** the circuit card, bottom right: map, name, the conditions */
  private renderCard() {
    if (!this.card) return;
    const c = this.cfg;
    const cd = CIRCUITS.find((x) => x.id === c.track);
    if (!cd) {
      this.card.innerHTML = `<div class="sc-map sc-q">?</div><div class="sc-round">Any of ${CIRCUITS.length} circuits</div><div class="sc-name">Random circuit</div><div class="sc-meta">${c.laps} laps</div>`;
      return;
    }
    const info = CIRCUIT_INFO[cd.id];
    const path = cd.centerline ? circuitPath(cd.centerline.points, 180, 120, 6) : '';
    this.card.innerHTML = `<svg class="sc-map" viewBox="0 0 180 120"><path d="${path}"/></svg><div class="sc-round">${info?.country ?? cd.country}${info ? ` · ${info.km} km` : ''}</div><div class="sc-name">${cd.name}</div><div class="sc-meta">${c.laps} laps${info?.line ? ` · ${info.line}` : ''}</div>`;
  }

  private highlight() {
    this.rows.forEach((r, i) => r.el.classList.toggle('sel', i === this.sel));
  }

  /** gamepad navigation (the keyboard is handled in onKey) */
  update(nav: { up: boolean; down: boolean; left: boolean; right: boolean; accept: boolean; back: boolean }) {
    if (!this.open) return;
    this.nav(nav);
  }

  private nav(nav: { up?: boolean; down?: boolean; left?: boolean; right?: boolean; accept?: boolean; back?: boolean }) {
    const n = this.rows.length;
    if (nav.up || nav.down) {
      this.sel = (this.sel + (nav.down ? 1 : -1) + n) % n;
      this.highlight();
      this.cb.onUi('move');
    }
    const r = this.rows[this.sel];
    if (r?.change && (nav.left || nav.right)) r.change(nav.right ? 1 : -1);
    if (r && nav.accept) r.select();
    if (nav.back) {
      this.cb.onUi('back');
      this.cb.onBack();
    }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    const map: Record<string, string> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'accept', Space: 'accept', Escape: 'back', Backspace: 'back' };
    const k = map[e.code];
    if (!k) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k !== 'up' && k !== 'down' && k !== 'left' && k !== 'right' && e.repeat) return;
    this.nav({ [k]: true });
  }
}
