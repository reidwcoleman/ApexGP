import { FUEL_PER_LAP, type Race, type RaceEvent, type Competitor } from '../race/Race.ts';
import type { Track } from '../world/Track.ts';
import { uiColor } from '../race/Teams.ts';
import { COMPOUNDS } from '../race/Pit.ts';
import { WEATHER_LABEL, isWetKind, type WeatherKind } from '../world/Weather.ts';
import { uiHeight } from './scale.ts';

/** 16px line icons for the weather row (stroke = currentColor) */
const WX_ICON: Record<WeatherKind, string> = {
  clear: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/>',
  cloudy: '<path d="M6 3.2a2.6 2.6 0 0 1 4.3 1.2"/><path d="M4.5 13h7a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.9-.6A2.9 2.9 0 0 0 4.5 13z"/>',
  overcast: '<path d="M4 12.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 12.5z"/>',
  drizzle: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M6 12v1M10 12v1"/>',
  rain: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M5 11.5l-.8 2.5M8 11.5l-.8 2.5M11 11.5l-.8 2.5"/>',
  storm: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M5 11.5l-.8 2.5M8 11.5l-.8 2.5M11 11.5l-.8 2.5"/><path d="M6.5 11l-.6 1.6M9.5 11l-.6 1.6"/>',
  thunderstorm: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M8.6 10.5 6.8 13h2.4l-1.6 2.5"/>',
  haze: '<circle cx="8" cy="6.5" r="2.6"/><path d="M2 11h12M3.5 13.5h9"/>',
  fog: '<path d="M2 5.5h12M3 8h10M2 10.5h12M4 13h8"/>',
  mist: '<circle cx="8" cy="5.5" r="2.4"/><path d="M2 10h12M3.5 12.5h9"/>',
  windy: '<path d="M2 6h8.5a2 2 0 1 0-2-2M2 9.5h11a2 2 0 1 1-2 2M2 13h6"/>',
  drying: '<circle cx="8" cy="6" r="2.8"/><path d="M8 1v1.2M3 6h1.2M11.8 6H13M4.5 2.5l.8.8M11.5 2.5l-.8.8"/><path d="M2.5 12.5c1.5-1 3-1 4.5 0s3 1 4.5 0"/>',
  sunshower: '<circle cx="5.5" cy="5" r="2.2"/><path d="M5.5 1v.9M1.5 5h.9M2.7 2.2l.6.6"/><path d="M7.5 10.5h5a2 2 0 0 0 .2-4 2.8 2.8 0 0 0-5.3-.3A2.2 2.2 0 0 0 7.5 10.5z"/><path d="M9 12.3l-.5 1.7M12 12.3l-.5 1.7"/>',
};
const MOON_ICON = '<path d="M11.5 10.8A5 5 0 0 1 6.2 3a5 5 0 1 0 5.3 7.8z"/><path d="M12 2.5v1.4M11.3 3.2h1.4"/>';
const isWet = (k: WeatherKind) => isWetKind(k);

export function fmtTime(t: number, plusSign = false): string {
  if (!isFinite(t) || t <= 0) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const str = m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  return plusSign ? `+${str}` : str;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

interface Row {
  el: HTMLDivElement;
  pos: HTMLSpanElement;
  bar: HTMLSpanElement;
  code: HTMLSpanElement;
  gap: HTMLSpanElement;
  key: string;
  /** the position last drawn (0 = none yet), for the gained / lost flash */
  last: number;
}

/** a place gained or lost lights the position cell for a moment, like the TV tower */
function flashPos(row: Row, gained: boolean) {
  if (typeof row.pos.animate !== 'function') return;
  const c = gained ? '#22d17a' : '#ff2b3f';
  row.pos.animate(
    [
      { backgroundColor: c, color: '#0a0c11' },
      { backgroundColor: c, color: '#0a0c11', offset: 0.55 },
      { backgroundColor: 'rgba(0,0,0,0)' },
    ],
    { duration: 1600, easing: 'ease-out' },
  );
}

/**
 * Pirelli sets a minimum starting pressure per axle, fronts a couple of psi above the rears, in the
 * blankets (the tyres leave them at 80 °C, CarPhysics). The physics carries no pressure, so the tyre
 * widget derives each tyre's hot pressure from its simulated temperature by the gas law at constant
 * volume (absolute pressure ∝ absolute temperature): +10 °C ≈ +1.1 psi, as the engineers' rule of thumb.
 */
const PSI_SET = [24.0, 24.0, 21.5, 21.5];
const PSI_BLANKET_C = 80;
const ATM_PSI = 14.7;
const tyrePsi = (i: number, T: number) => (PSI_SET[i] + ATM_PSI) * ((T + 273.15) / (PSI_BLANKET_C + 273.15)) - ATM_PSI;
/** the delta bar's full scale either side of zero (s): ACC's bar fills at ±2 s on a GT lap; an F1 lap is won by tenths */
const DELTA_SCALE = 1.0;
const TC_LABEL = { off: 'OFF', medium: 'MED', full: 'FULL' } as const;

interface TyreCell {
  block: HTMLElement;
  fill: HTMLElement;
  temp: HTMLElement;
  psi: HTMLElement;
  wear: HTMLElement;
}

/**
 * The driving HUD, laid out like ACC's: small, flat, square-cornered panels at the edges — the
 * standings top left, the delta bar to your best lap top centre, the timing panel (position, lap,
 * sectors, the cars either side, weather) top right, the track map bottom left and the car's dash
 * bottom right (rev bar, gear, speed, pedals, brake bias / TC / ABS, ERS battery and mode, fuel),
 * with the tyre widget beside it (temperature, pressure, wear per corner). DOM is built once;
 * updates only touch text and transforms that changed. The tower re-orders by translating rows,
 * so position changes animate like the TV graphics.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private tower: HTMLDivElement;
  private towerHead: HTMLDivElement;
  private rows: Row[] = [];
  private rowByCar = new Map<number, Row>();
  private pbig: HTMLDivElement;
  private lapEl: HTMLDivElement;
  private curEl: HTMLDivElement;
  /** sector cells and their times: this lap's as they close, the last lap's (dimmed) ahead of the car */
  private sectorEls: HTMLElement[] = [];
  private sectorTimeEls: HTMLElement[] = [];
  private secTime = [NaN, NaN, NaN];
  private secColor = ['', '', ''];
  private lastEl: HTMLSpanElement;
  private bestEl: HTMLSpanElement;
  private rpmEl: HTMLElement;
  private rpmWrap: HTMLDivElement;
  private rpmTxt: HTMLElement;
  private speedEl: HTMLSpanElement;
  private gearEl: HTMLDivElement;
  private thrEl: HTMLElement;
  private brkEl: HTMLElement;
  private bbEl: HTMLElement;
  private tcEl: HTMLElement;
  private absEl: HTMLElement;
  private ersEl: HTMLElement;
  private ersWrap: HTMLDivElement;
  private ersPct: HTMLElement;
  private ersMode: HTMLElement;
  private drsEl: HTMLDivElement;
  private fuelEl: HTMLElement;
  private fuelLapEl: HTMLElement;
  private fuelRangeEl: HTMLElement;
  /** fuel used per lap, measured line to line (kg; NaN until a lap has been timed) */
  private fuelPerLap = NaN;
  private fuelAtLine = NaN;
  private fuelLaps = -2;
  private deltaWrap: HTMLDivElement;
  private deltaL: HTMLElement;
  private deltaR: HTMLElement;
  private estEl: HTMLElement;
  private relEl: HTMLDivElement;
  private aheadEl: HTMLDivElement;
  private behindEl: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerTimer = 0;
  private lights: HTMLDivElement;
  private lightCols: HTMLElement[] = [];
  private hint: HTMLDivElement;
  private camLabel: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private wxIcon!: HTMLElement;
  private wxLabel!: HTMLElement;
  private wxInfo!: HTMLElement;
  private wxKind = '';
  private pitEl!: HTMLSpanElement;
  private tyres: TyreCell[] = [];
  private cmpEl!: HTMLElement;
  private wingEl!: HTMLElement;
  private camLabelTimer = 0;
  private deltaEl: HTMLDivElement;
  private radioEl: HTMLDivElement;
  private radioTimer = 0;
  private dots = new Map<number, SVGCircleElement>();
  private mapScale = { minx: 0, minz: 0, k: 1, ox: 0, oz: 0 };
  private towerTimer = 0;
  private lastText = new WeakMap<HTMLElement, string>();
  /** the virtual safety car board (stays up while it's out) */
  private vscEl!: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', '', parent);
    this.root.id = 'hud';

    // tower
    this.tower = el('div', 'tower glass', this.root);
    this.towerHead = el('div', 'tower-head', this.tower, 'Lap <b>1/5</b>');
    el('div', 'tower-rows', this.tower);

    // delta bar (top centre), as ACC's: the live gap to your best lap on a bar that fills from
    // the middle — left and green when you're up on it, right and red when you're down (a number
    // line) — with the lap it projects to underneath
    this.deltaWrap = el('div', 'deltabar glass', this.root);
    this.deltaEl = el('div', 'dnum', this.deltaWrap, '−.---');
    const dtrack = el('div', 'dtrack', this.deltaWrap);
    this.deltaL = el('i', 'dl', dtrack);
    this.deltaR = el('i', 'dr', dtrack);
    const dfoot = el('div', 'dfoot', this.deltaWrap);
    el('span', 'k', dfoot, 'Est. lap');
    this.estEl = el('span', '', dfoot, '—');

    // timing (top right): position, lap, the lap clock, sector splits, last / best, the cars either side, weather
    const timing = el('div', 'timing glass', this.root);
    const posline = el('div', 'posline', timing);
    this.pbig = el('div', 'pbig', posline, 'P1');
    this.lapEl = el('div', 'lap', posline, 'Lap <b>1</b>');
    const curRow = el('div', 'tline cur', timing);
    el('span', 'k', curRow, 'Current');
    this.curEl = el('div', 'curt', curRow, '0:00.000');
    const sec = el('div', 'sectors', timing);
    for (let i = 0; i < 3; i++) {
      const c = el('div', 'sc', sec);
      el('span', 'k', c, `S${i + 1}`);
      this.sectorTimeEls.push(el('span', 'st', c, '—'));
      this.sectorEls.push(c);
    }
    const l1 = el('div', 'tline', timing);
    el('span', 'k', l1, 'Last');
    this.lastEl = el('span', '', l1, '—');
    const l2 = el('div', 'tline', timing);
    el('span', 'k', l2, 'Best');
    this.bestEl = el('span', '', l2, '—');
    // the cars either side of you on the road (ACC's relative, trimmed to the two that matter)
    this.relEl = el('div', 'rel', timing);
    this.aheadEl = el('div', 'relrow', this.relEl);
    this.behindEl = el('div', 'relrow', this.relEl);
    // weather: now, track temperature, and a heads-up when it's about to change
    const wx = el('div', 'wx', timing);
    this.wxIcon = el('span', 'wxi', wx);
    this.wxLabel = el('span', 'wxl', wx, '');
    this.wxInfo = el('span', 'wxr', wx, '');

    // the dash (bottom right): rev bar, pedals, gear, speed, electronics, ERS, fuel
    const cl = el('div', 'cluster glass', this.root);
    this.rpmWrap = el('div', 'rpm', cl);
    this.rpmEl = el('b', '', this.rpmWrap);
    const dm = el('div', 'dmain', cl);
    const ped = el('div', 'pedals', dm);
    const thr = el('div', 'meter thr', ped);
    this.thrEl = el('b', '', thr);
    const brk = el('div', 'meter brk', ped);
    this.brkEl = el('b', '', brk);
    this.gearEl = el('div', 'gear', dm, 'N');
    const sp = el('div', 'speed', dm);
    const spv = el('div', 'spv', sp);
    this.speedEl = el('span', '', spv, '0');
    el('small', '', spv, 'km/h');
    this.rpmTxt = el('div', 'rpmtxt', sp, '');
    const elec = el('div', 'elec', dm);
    const eRow = (k: string) => {
      const r = el('div', 'er', elec);
      el('span', 'k', r, k);
      return el('b', '', r, '');
    };
    this.bbEl = eRow('BB');
    this.tcEl = eRow('TC');
    this.absEl = eRow('ABS');
    // ERS: the battery's state of charge (2026: 350 kW MGU-K, no MGU-H), harvest / overtake light, DRS
    const ers = el('div', 'drow', cl);
    el('span', 'k', ers, 'ERS');
    this.ersWrap = el('div', 'meter ers', ers);
    this.ersEl = el('b', '', this.ersWrap);
    this.ersPct = el('span', 'v', ers, '');
    this.ersMode = el('span', 'chip', ers, '');
    this.drsEl = el('div', 'drs', ers, 'DRS');
    // fuel: on board, used per lap (measured line to line), and the laps it covers beyond the laps to go
    const fu = el('div', 'drow fuel', cl);
    el('span', 'k', fu, 'Fuel');
    this.fuelEl = el('span', 'v', fu, '');
    this.fuelLapEl = el('span', 'v2', fu, '');
    this.fuelRangeEl = el('span', 'v3', fu, '');
    this.pitEl = el('span', 'chip pitlbl', fu, '');

    // banner, lights, hints
    this.banner = el('div', 'banner glass', this.root);
    this.vscEl = el('div', 'vscboard glass', this.root);
    this.lights = el('div', 'lights', this.root);
    for (let i = 0; i < 5; i++) {
      const c = el('div', 'col', this.lights);
      el('i', '', c);
      el('i', '', c);
      this.lightCols.push(c);
    }
    this.hint = el('div', 'hint glass', this.root);
    this.camLabel = el('div', 'camlabel glass', this.root);
    this.radioEl = el('div', 'radio glass', this.root);
    // tyres, as ACC's widget: per corner the temperature (colour and °C), the pressure (psi) and the
    // life left (the block empties as it wears); the compound and the front wing along the top
    this.statusEl = el('div', 'carstatus glass', this.root);
    const th = el('div', 'tyhead', this.statusEl);
    this.cmpEl = el('span', 'cmp', th, '');
    this.wingEl = el('span', 'wing', th, '');
    const grid = el('div', 'tygrid', this.statusEl);
    for (let i = 0; i < 4; i++) {
      const c = el('div', 'tyc' + (i % 2 ? ' r' : ' l'), grid);
      const block = el('div', 'tyb', c);
      const fill = el('i', '', block);
      const txt = el('div', 'tyt', c);
      const temp = el('b', '', txt, '');
      const psi = el('span', '', txt, '');
      const wear = el('span', 'tw', txt, '');
      this.tyres.push({ block, fill, temp, psi, wear });
    }
  }

  show(on: boolean) {
    this.root.classList.toggle('on', on);
    if (!on) this.clearLights();
  }

  /** the start-light overlay off (it only belongs to a live countdown) */
  private clearLights() {
    this.lights.classList.remove('show');
    for (const c of this.lightCols) c.classList.remove('on');
  }

  /** build tower rows + minimap for a new race */
  setup(race: Race, track: Track) {
    const rowsWrap = this.tower.querySelector('.tower-rows') as HTMLDivElement;
    rowsWrap.innerHTML = '';
    this.rows = [];
    this.rowByCar.clear();
    this.rowsWrap = rowsWrap;
    this.rowCount = race.cars.length;
    this.compactH = -1;
    this.rowH();
    for (const c of race.cars) {
      const r = el('div', 'trow', rowsWrap) as HTMLDivElement;
      const row: Row = {
        el: r,
        pos: el('span', 'pos', r),
        bar: el('span', 'bar', r),
        code: el('span', 'code', r),
        gap: el('span', 'gap', r),
        key: '',
        last: 0,
      };
      row.bar.style.background = uiColor(c.entry.team);
      row.code.textContent = c.entry.driver.code;
      if (c.isPlayer) r.classList.add('me');
      this.rows.push(row);
      this.rowByCar.set(c.id, row);
    }
    this.tower.style.display = race.isTimeTrial ? 'none' : '';
    this.relEl.style.display = race.isTimeTrial ? 'none' : '';
    this.root.classList.toggle('tt', race.isTimeTrial);
    this.fuelPerLap = NaN;
    this.fuelAtLine = NaN;
    this.fuelLaps = -2;

    // minimap
    const mm = this.root.querySelector('.minimap');
    mm?.remove();
    const box = el('div', 'minimap glass', this.root);
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minx = Math.min(minx, track.px[i]); maxx = Math.max(maxx, track.px[i]);
      minz = Math.min(minz, track.pz[i]); maxz = Math.max(maxz, track.pz[i]);
    }
    const size = 100;
    const k = size / Math.max(maxx - minx, maxz - minz);
    const ox = (size - (maxx - minx) * k) / 2;
    const oz = (size - (maxz - minz) * k) / 2;
    this.mapScale = { minx, minz, k, ox, oz };
    let d = '';
    for (let i = 0; i < track.n; i += 6) {
      const [x, y] = this.mapXY(track.px[i], track.pz[i]);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    d += 'Z';
    const [sx, sy] = this.mapXY(track.px[Math.floor(track.startS)], track.pz[Math.floor(track.startS)]);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.innerHTML = `<path class="trk" d="${d}" vector-effect="non-scaling-stroke"/><path class="trk2" d="${d}" vector-effect="non-scaling-stroke"/><circle cx="${sx}" cy="${sy}" r="1.6" fill="#fff"/>`;
    box.appendChild(svg);
    this.dots.clear();
    const ordered = race.cars.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const c of ordered) {
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', c.isPlayer ? '3.4' : '2.3');
      dot.setAttribute('fill', c.isPlayer ? '#ffffff' : uiColor(c.entry.team));
      if (c.isPlayer) {
        dot.setAttribute('stroke', '#0a0c11');
        dot.setAttribute('stroke-width', '1.2');
      } else {
        dot.setAttribute('stroke', 'rgba(0,0,0,0.6)');
        dot.setAttribute('stroke-width', '0.6');
      }
      svg.appendChild(dot);
      this.dots.set(c.id, dot);
    }
    this.secTime.fill(NaN);
    this.secColor.fill('');
    this.lights.classList.remove('show');
    this.banner.classList.remove('show');
  }

  /** the tower's row height: tighter when the (zoomed) layout is short, so 22 rows clear the map */
  private rowsWrap: HTMLDivElement | null = null;
  private rowCount = 0;
  private compactH = -1;
  private rowH(): number {
    const h = innerHeight;
    if (h !== this.compactH) {
      this.compactH = h;
      const compact = uiHeight() < 880;
      this.root.classList.toggle('compact', compact);
      this.rh = compact ? 21 : 25;
      if (this.rowsWrap) this.rowsWrap.style.height = `${this.rowCount * this.rh}px`;
    }
    return this.rh;
  }
  private rh = 25;

  private mapXY(x: number, z: number): [number, number] {
    const m = this.mapScale;
    return [(x - m.minx) * m.k + m.ox, (z - m.minz) * m.k + m.oz];
  }

  /** DOM writes only when the value changes (perf: the HUD updates every frame) */
  private readonly dotAt = new WeakMap<Element, number>();
  /** a bar's fill as a transform (compositor only, no layout), in 1/200 steps */
  private readonly scaleOf = new WeakMap<HTMLElement, number>();
  private setScale(e: HTMLElement, v: number, axis: 'X' | 'Y' = 'X') {
    const q = Math.round(Math.max(0, Math.min(1, v)) * 200);
    if (this.scaleOf.get(e) === q) return;
    this.scaleOf.set(e, q);
    e.style.transform = `scale${axis}(${q / 200})`;
  }
  private setClass(e: HTMLElement, c: string) {
    if (e.className !== c) e.className = c;
  }
  private setText(e: HTMLElement, t: string) {
    if (this.lastText.get(e) !== t) {
      e.textContent = t;
      this.lastText.set(e, t);
    }
  }

  flash(title: string, sub = '', tone: '' | 'purple' | 'green' | 'red' | 'blue' | 'yellow' = '', secs = 2.6) {
    this.banner.className = `banner glass show ${tone}`;
    this.banner.innerHTML = `<span class="k">${title}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`;
    this.bannerTimer = secs;
  }

  setHint(html: string | null) {
    if (html) {
      this.hint.innerHTML = html;
      this.hint.classList.add('show');
    } else this.hint.classList.remove('show');
  }

  /** a line of team radio from the race engineer */
  radio(text: string, teamColor: string, secs = 4.5) {
    this.radioEl.innerHTML = `<span class="rbar" style="background:${teamColor}"></span><div><div class="rwho">Race engineer<span class="rwave"><i></i><i></i><i></i></span></div><div class="rmsg">${text}</div></div>`;
    this.radioEl.classList.add('show');
    this.radioTimer = secs;
  }

  cameraLabel(text: string) {
    this.camLabel.textContent = text;
    this.camLabel.classList.add('show');
    this.camLabelTimer = 1.4;
  }

  // ---------------------------------------------------------------- broadcast (spectate / replay)
  private focusId = -1;

  /** broadcast mode: only the tower (the followed car lit), banners and the map; `clean` hides it all */
  setBroadcast(on: boolean, replay = false, clean = false) {
    this.root.classList.toggle('bcast', on);
    // a replay / spectate starts clean: no start lights left over from the session (update() doesn't run there)
    this.clearLights();
    this.root.classList.toggle('replay', on && replay);
    this.root.classList.toggle('clean', on && clean);
    if (!on) this.setFocus(-1);
  }

  /** light the followed car's row in the tower */
  setFocus(id: number) {
    if (id === this.focusId) return;
    this.rowByCar.get(this.focusId)?.el.classList.remove('focus');
    this.focusId = id;
    this.rowByCar.get(id)?.el.classList.add('focus');
  }

  /**
   * The tower driven from a recording (replay): per car id its position, gap to
   * the leader (s, −n = laps down), out / fastest-lap flags. Also runs the banner timer.
   */
  replayFrame(dt: number, head: string, pos: ArrayLike<number>, gap: ArrayLike<number>, out: (id: number) => boolean, fastest: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    this.towerTimer -= dt;
    if (this.towerTimer > 0) return;
    this.towerTimer = 0.08;
    const rh = this.rowH();
    if (this.lastText.get(this.towerHead) !== head) {
      this.towerHead.innerHTML = head;
      this.lastText.set(this.towerHead, head);
    }
    for (const [id, row] of this.rowByCar) {
      const p = pos[id] || 1;
      row.el.style.transform = `translateY(${(p - 1) * rh}px)`;
      this.setText(row.pos, String(p));
      const o = out(id);
      // (a seek reshuffles everything at once: only a real pass of a place or two flashes)
      if (row.last && row.last !== p && Math.abs(row.last - p) <= 2 && !o) flashPos(row, p < row.last);
      row.last = p;
      const g = gap[id];
      this.setText(row.gap, o ? 'OUT' : p === 1 ? 'Leader' : g < 0 ? `+${-Math.round(g)} Lap${g < -1 ? 's' : ''}` : g > 0 ? `+${g.toFixed(3)}` : '');
      if (o !== row.el.classList.contains('out')) row.el.classList.toggle('out', o);
      const fl = id === fastest;
      if (fl !== row.code.classList.contains('hasfl')) {
        row.code.classList.toggle('hasfl', fl);
        row.code.innerHTML = row.code.textContent + (fl ? '<span class="fl"></span>' : '');
      }
    }
  }

  handleEvents(race: Race, events: RaceEvent[]) {
    for (const e of events) {
      const c = race.cars[e.car];
      switch (e.kind) {
        case 'lights-out':
          this.flash('Lights out', 'and away we go', 'red', 1.8);
          break;
        case 'fastest-lap':
          this.flash('Fastest lap', `${c.entry.driver.code}  ${fmtTime(e.value!)}`, 'purple', 3.2);
          break;
        case 'personal-best':
          this.flash('Personal best', fmtTime(e.value!), 'green');
          break;
        case 'drs-enabled':
          this.flash('DRS enabled', 'press Space in the zone', 'green', 2);
          break;
        case 'blue-flag':
          if (e.car === race.player.id) this.flash('Blue flag', 'let the leaders through', 'blue', 2.4);
          break;
        case 'track-limits':
          this.flash('Track limits', e.value ? `warning ${e.value} of ${race.limitWarnings} · lap time deleted` : 'lap time deleted', 'red', 2.6);
          break;
        case 'pit-in':
          this.flash('Pit limiter', '80 km/h', '', 2);
          break;
        case 'pit-stop':
          this.flash('Pit stop', `${(e.value ?? 0).toFixed(1)} s · ${COMPOUNDS[c.compound].label} tyres`, 'green', 3);
          break;
        case 'penalty':
          this.flash(`${e.value} second penalty`, e.reason ?? 'track limits', 'red', 3.2);
          break;
        case 'final-lap':
          this.flash('Final lap', '', '', 2.4);
          break;
        case 'finish':
          if (c.isPlayer) this.flash('Chequered flag', `P${c.position}`, '', 4);
          break;
        case 'retired':
          if (c.isPlayer) this.flash('Retired', e.value ? 'the car is destroyed' : 'the car is too badly damaged', 'red', 6);
          else this.flash(`${c.entry.driver.code} out`, `${c.entry.driver.last} · ${e.value === 2 ? 'mechanical failure' : e.value ? 'car on fire' : 'crash damage'}`, 'red', 3);
          break;
        case 'vsc':
          this.flash('Virtual safety car', 'slow down · no overtaking', 'yellow', 3.5);
          break;
        case 'vsc-ending':
          this.flash('VSC ending', 'get ready', 'yellow', 3);
          break;
        case 'vsc-end':
          this.flash('Green flag', 'racing resumes', 'green', 2.4);
          break;
        case 'damage':
          this.flash('Front wing damage', 'box for a new nose — press P', 'red', 3.2);
          break;
        case 'sector':
          if (e.sector !== undefined && e.car === race.player.id) {
            this.secTime[e.sector] = e.value ?? NaN;
            this.secColor[e.sector] = e.color ?? '';
            // the first split of a new lap clears the last lap's other two
            if (e.sector === 0) {
              this.secTime[1] = this.secTime[2] = NaN;
              this.secColor[1] = this.secColor[2] = '';
            }
          }
          break;
        case 'lap':
          break;
      }
    }
  }

  update(dt: number, race: Race) {
    const p = race.player;
    const car = p.car;

    // banner/labels
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.camLabelTimer > 0) {
      this.camLabelTimer -= dt;
      if (this.camLabelTimer <= 0) this.camLabel.classList.remove('show');
    }

    // virtual safety car board: out while it's deployed, with the player's delta (+ = too fast)
    const vscOn = race.vsc !== 'none';
    this.vscEl.classList.toggle('show', vscOn);
    if (vscOn) {
      const d = race.vscDelta;
      const html = `<b>VSC</b>${race.vsc === 'ending' ? '<span>ending</span>' : `<span class="${d > 0.5 ? 'over' : 'ok'}">delta ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}</span>`}`;
      if (this.lastText.get(this.vscEl) !== html) {
        this.vscEl.innerHTML = html;
        this.lastText.set(this.vscEl, html);
      }
    }

    // start lights
    const showLights = race.phase === 'lights' || (race.phase === 'racing' && race.raceTime < 1.2 && !race.isTimeTrial);
    this.lights.classList.toggle('show', showLights);
    this.lightCols.forEach((c, i) => c.classList.toggle('on', race.phase === 'lights' && i < race.lightsLit));

    // the dash
    const kmh = Math.max(0, Math.round(car.vx * 3.6));
    this.setText(this.speedEl, String(kmh));
    this.setText(this.gearEl, car.reverse ? 'R' : race.phase === 'grid' || race.phase === 'lights' ? 'N' : String(car.gear));
    const sp = car.spec;
    // the rev bar, as ACC's: one bar across the dash from idle to the limiter, white through the
    // range, amber then red as the shift point nears, flashing blue on the limiter
    const rpmF = (car.rpm - sp.rpmIdle) / (sp.rpmLimit - sp.rpmIdle);
    this.setScale(this.rpmEl, rpmF);
    const shift = car.limiter || car.rpm >= sp.rpmLimit - 250;
    this.setClass(this.rpmWrap, 'rpm' + (shift ? ' lim' : rpmF > 0.86 ? ' r' : rpmF > 0.72 ? ' y' : ''));
    this.setText(this.rpmTxt, `${Math.round(car.rpm / 50) * 50} rpm`);
    this.setScale(this.thrEl, car.throttle, 'Y');
    this.setScale(this.brkEl, car.brake, 'Y');
    // electronics: brake bias (the set-up's, % front), traction control and ABS — lit amber while they work, as ACC
    this.setText(this.bbEl, (sp.brakeBias * 100).toFixed(1));
    const tc = car.assists.traction;
    this.setText(this.tcEl, TC_LABEL[tc]);
    this.setClass(this.tcEl, tc === 'off' ? 'off' : car.tcActive ? 'act' : '');
    this.setText(this.absEl, car.assists.abs ? 'ON' : 'OFF');
    this.setClass(this.absEl, !car.assists.abs ? 'off' : car.absActive ? 'act' : '');
    // ERS: state of charge, and what the MGU-K is doing — OVT deploying the overtake boost, HARV
    // recovering under braking and lifts (CarPhysics' rules), else the balanced base map
    this.setScale(this.ersEl, car.ers);
    this.setText(this.ersPct, `${Math.round(car.ers * 100)}%`);
    const v = car.vx;
    const harv = !car.ersDeploying && car.ers < 0.999 && ((car.brake > 0.2 && v > 10) || (car.throttle < 0.05 && v > 20));
    const mode = car.ersDeploying ? 'ovt' : harv ? 'harv' : '';
    this.setText(this.ersMode, car.ersDeploying ? 'OVT' : harv ? 'HARV' : 'BAL');
    this.setClass(this.ersMode, 'chip ' + mode);
    this.ersWrap.classList.toggle('deploy', car.ersDeploying);
    const zoneOn = p.drsEligible;
    this.setClass(this.drsEl, 'drs' + (car.drsAnim > 0.5 ? ' open' : zoneOn ? ' avail' : ''));
    // fuel: per lap measured line to line (the regulation estimate until a lap is done), and the
    // margin: laps the fuel covers beyond the laps still to run (red when it's short)
    if (p.laps !== this.fuelLaps) {
      if (p.laps === this.fuelLaps + 1 && p.laps >= 1 && isFinite(this.fuelAtLine)) {
        const used = this.fuelAtLine - car.fuel;
        if (used > 0.2) this.fuelPerLap = used;
      }
      this.fuelLaps = p.laps;
      this.fuelAtLine = car.fuel;
    }
    this.setText(this.fuelEl, `${car.fuel.toFixed(1)} kg`);
    if (car.burnFuel) {
      const perLap = isFinite(this.fuelPerLap) ? this.fuelPerLap : FUEL_PER_LAP;
      this.setText(this.fuelLapEl, `${perLap.toFixed(2)}/lap`);
      const toGo = Math.max(0, race.opts.laps - Math.max(0, p.laps) - (p.laps >= 0 ? p.lapDist / race.track.length : 0));
      const margin = car.fuel / perLap - toGo;
      this.setText(this.fuelRangeEl, p.finished ? '' : `${margin < 0 ? '−' : '+'}${Math.abs(margin).toFixed(1)} laps`);
      this.setClass(this.fuelRangeEl, 'v3' + (margin < 0 ? ' bad' : margin < 0.3 ? ' warn' : ''));
    } else {
      this.setText(this.fuelLapEl, '—/lap');
      this.setText(this.fuelRangeEl, '');
    }

    // tyres: colour = temperature against the compound's window (cold / in it / hot / overheating),
    // °C and the gas-law pressure beside it, the block's fill and the % = life left
    const opt = car.tyreOpt;
    const tone = (T: number) => (T < opt - 22 ? 'cold' : T <= opt + 14 ? 'ok' : T <= opt + 26 ? 'warn' : 'bad');
    for (let i = 0; i < 4; i++) {
      const c = this.tyres[i];
      const T = car.tyreTemp[i];
      this.setClass(c.block, 'tyb ' + tone(T));
      this.setText(c.temp, `${Math.round(T)}°`);
      this.setText(c.psi, tyrePsi(i, T).toFixed(1));
      const life = 1 - car.wear[i];
      this.setScale(c.fill, life, 'Y');
      this.setText(c.wear, `${Math.floor(life * 100)}%`);
    }
    const wd = car.wingDamage;
    this.setText(this.wingEl, wd < 0.15 ? 'Wing OK' : `Wing ${Math.round(wd * 100)}%`);
    this.setClass(this.wingEl, 'wing ' + (wd < 0.15 ? 'ok' : wd < 0.5 ? 'warn' : 'bad'));
    const cmp = COMPOUNDS[p.compound];
    const cmpHtml = `<i style="color:${cmp.color}">${cmp.short}</i>${p.compound === 'inter' ? 'Inter' : cmp.label}`;
    if (this.lastText.get(this.cmpEl) !== cmpHtml) {
      this.cmpEl.innerHTML = cmpHtml;
      this.lastText.set(this.cmpEl, cmpHtml);
    }
    // weather row
    const w = race.weatherState;
    const nightKey = `${w.kind}/${w.time === 'night' || w.time === 'dusk' ? 'n' : 'd'}`;
    if (nightKey !== this.wxKind) {
      this.wxKind = nightKey;
      // a clear or hazy sky after sunset shows the moon, not the sun
      const moon = nightKey.endsWith('/n') && (w.kind === 'clear' || w.kind === 'haze' || w.kind === 'drying' || w.kind === 'windy');
      this.wxIcon.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${moon ? MOON_ICON : WX_ICON[w.kind]}</svg>`;
      this.setText(this.wxLabel, WEATHER_LABEL[w.kind]);
    }
    const soon = race.weather.forecast(150);
    const change = isWet(soon) !== isWet(w.kind) && !race.isTimeTrial;
    const info = change ? (isWet(soon) ? 'Rain coming' : 'Drying soon') : `Track ${Math.round(w.trackTemp)}°`;
    this.setText(this.wxInfo, info);
    this.wxInfo.classList.toggle('warn', change);

    // pit status in the cluster: BOX when requested, PIT in the lane
    const pitTxt = p.pit.phase !== 'none' ? 'PIT' : race.playerPitRequest ? 'BOX' : '';
    this.setText(this.pitEl, pitTxt);
    this.pitEl.classList.toggle('on', pitTxt !== '');

    // timing
    const t = race.phase === 'racing' || race.phase === 'finished' ? race.raceTime : 0;
    const lapNo = Math.max(1, Math.min(race.opts.laps, p.laps + 1));
    const posHtml = race.isTimeTrial ? 'TT' : `P${p.position}<small>/${race.cars.length}</small>`;
    if (this.lastText.get(this.pbig) !== posHtml) {
      this.pbig.innerHTML = posHtml;
      this.lastText.set(this.pbig, posHtml);
    }
    const lapHtml = !p.lapValid ? '<b class="bad">Lap deleted</b>' : race.isTimeTrial ? `Lap <b>${Math.max(1, p.laps + 1)}</b>` : `Lap <b>${lapNo}<span>/${race.opts.laps}</span></b>`;
    if (this.lastText.get(this.lapEl) !== lapHtml) {
      this.lapEl.innerHTML = lapHtml;
      this.lastText.set(this.lapEl, lapHtml);
    }
    const cur = p.laps >= 0 ? t - p.lapStart : 0;
    this.setText(this.curEl, fmtTime(Math.max(0.0001, cur)).replace('—', '0.000'));
    this.curEl.classList.toggle('invalid', !p.lapValid);
    // the delta bar: to your best lap (Race samples it every 10 m); idle until there is one to beat
    const dl = race.playerDelta;
    if (isFinite(dl) && p.laps >= 1 && p.lapValid && isFinite(p.bestLap)) {
      this.setText(this.deltaEl, `${dl < 0 ? '−' : '+'}${Math.abs(dl).toFixed(3)}`);
      this.setClass(this.deltaWrap, 'deltabar glass ' + (dl < 0 ? 'faster' : 'slower'));
      this.setScale(this.deltaL, dl < 0 ? -dl / DELTA_SCALE : 0);
      this.setScale(this.deltaR, dl > 0 ? dl / DELTA_SCALE : 0);
      this.setText(this.estEl, fmtTime(p.bestLap + dl));
    } else {
      this.setText(this.deltaEl, !p.lapValid ? 'Invalid' : '−.---');
      this.setClass(this.deltaWrap, 'deltabar glass' + (!p.lapValid ? ' invalid' : ''));
      this.setScale(this.deltaL, 0);
      this.setScale(this.deltaR, 0);
      this.setText(this.estEl, '—');
    }
    // radio fade
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioEl.classList.remove('show');
    }
    this.setText(this.lastEl, fmtTime(p.lastLap));
    this.setText(this.bestEl, fmtTime(p.bestLap));
    this.setClass(this.bestEl, p.bestLap < Infinity && p.bestLap <= race.bestLap ? 'purple' : p.bestLap < Infinity ? 'green' : '');
    // sector splits: this lap's as they close (purple / green / yellow), the running split in the
    // sector you're in, and ahead of the car the last lap's, dimmed, until this lap overwrites them
    const live = race.phase === 'racing' && p.laps >= 0;
    for (let i = 0; i < 3; i++) {
      const st = this.secTime[i];
      if (live && i === p.sector) {
        this.setClass(this.sectorEls[i], 'sc live');
        this.setText(this.sectorTimeEls[i], fmtTime(Math.max(0.0001, t - p.sectorStart)).replace('—', '0.000').slice(0, -2));
      } else if (isFinite(st)) {
        this.setClass(this.sectorEls[i], `sc ${this.secColor[i]}${i > p.sector ? ' old' : ''}`);
        this.setText(this.sectorTimeEls[i], fmtTime(st));
      } else {
        this.setClass(this.sectorEls[i], 'sc');
        this.setText(this.sectorTimeEls[i], '—');
      }
    }

    // tower + gaps at ~12 Hz
    this.towerTimer -= dt;
    if (this.towerTimer <= 0) {
      this.towerTimer = 0.08;
      this.updateTower(race);
      this.updateGaps(race);
    }

    // minimap dots
    for (const c of race.cars) {
      const dot = this.dots.get(c.id);
      if (!dot) continue;
      const [x, y] = this.mapXY(c.car.x, c.car.z);
      // (only touch the SVG when a dot actually moved a tenth of a unit)
      const key = Math.round(x * 10) * 100000 + Math.round(y * 10);
      if (this.dotAt.get(dot) === key) continue;
      this.dotAt.set(dot, key);
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
    }
  }

  private updateTower(race: Race) {
    const rh = this.rowH();
    const head = race.isTimeTrial ? 'Time trial' : `Lap <b>${Math.max(1, Math.min(race.opts.laps, race.leaderLaps + 1))}/${race.opts.laps}</b>`;
    if (this.lastText.get(this.towerHead) !== head) {
      this.towerHead.innerHTML = head;
      this.lastText.set(this.towerHead, head);
    }
    // the flag state along the top of the tower
    const flag = race.phase === 'finished' ? ' fin' : race.vsc !== 'none' ? ' vsc' : race.phase === 'racing' ? ' green' : '';
    this.setClass(this.tower, 'tower glass' + flag);
    for (const c of race.cars) {
      const row = this.rowByCar.get(c.id)!;
      row.el.style.transform = `translateY(${(c.position - 1) * rh}px)`;
      this.setText(row.pos, String(c.position));
      if (row.last && row.last !== c.position && race.phase === 'racing' && !c.retired) flashPos(row, c.position < row.last);
      row.last = c.position;
      let gap: string;
      if (c.position === 1) gap = race.phase === 'racing' || race.phase === 'finished' ? 'Leader' : '';
      else if (c.gapLeader < 0) gap = `+${-c.gapLeader} Lap${c.gapLeader < -1 ? 's' : ''}`;
      else gap = race.phase === 'grid' || race.phase === 'lights' || c.gapLeader <= 0 ? '' : `+${c.gapLeader.toFixed(3)}`;
      if (c.finished) gap = c.position === 1 ? 'Winner' : gap;
      if (c.retired) gap = 'OUT';
      this.setText(row.gap, gap);
      if (c.retired !== row.el.classList.contains('out')) row.el.classList.toggle('out', c.retired);
      const fl = c.id === race.bestLapCar;
      if (fl !== row.code.classList.contains('hasfl')) {
        row.code.classList.toggle('hasfl', fl);
        row.code.innerHTML = c.entry.driver.code + (fl ? '<span class="fl"></span>' : '');
      }
    }
  }

  private updateGaps(race: Race) {
    const p = race.player;
    const ahead = race.cars.find((c) => c.position === p.position - 1);
    const behind = race.cars.find((c) => c.position === p.position + 1);
    const fill = (box: HTMLDivElement, c: Competitor | undefined, sign: string, gap: number) => {
      if (!c || race.phase === 'grid' || race.phase === 'lights') {
        box.style.visibility = 'hidden';
        return;
      }
      box.style.visibility = '';
      const html = `<span class="rp">P${c.position}</span><span class="bar" style="background:${uiColor(c.entry.team)}"></span><span class="code">${c.entry.driver.code}</span><span class="t ${sign === '−' ? 'ah' : 'bh'}">${sign}${gap.toFixed(3)}</span>`;
      if (this.lastText.get(box) !== html) {
        box.innerHTML = html;
        this.lastText.set(box, html);
      }
    };
    fill(this.aheadEl, ahead, '−', p.gapAhead);
    fill(this.behindEl, behind, '+', behind ? behind.gapAhead : 0);
  }
}
