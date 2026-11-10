// Bluebird Peak HUD. Dark glass over the snow: the resort badge, the money, the clock; a live business
// card and goals on the left; the shop as a list on the right; the map views at the bottom; a full report
// (income, trails, lifts, events, Legend); labels, drops and celebrations over the 3D view.
import './ui.css';
import { RUNS, LIFTS, LIFT_BY, RUN_BY, DIFF_COLOR, DIFF_NAME, type Mountain } from './mountain.ts';
import { ITEMS, ITEM_BY, WEATHER, EVENTS, type Cat, itemEffect, nextMilestone, prevMilestone, priceOf, OPEN, liftCap, runAppeal, legendMul, LEGEND_LV, tierOf, CHAIR_TIERS, GONDOLA_TIERS, CARPET_TIERS } from './data.ts';
import { money, INCOME_KEYS, type Sim, type DayStats } from './sim.ts';

export interface Label { id: string; x: number; y: number; html: string; cls?: string; click?: () => void; hidden?: boolean }

const I: Record<string, string> = {
  chair: '<path d="M6 3v6M18 3v6M5 9h14l-1.5 6h-11zM7 15l-1 5M17 15l1 5" />',
  carpet: '<path d="M3 17l18-6M3 20l18-6M6 15.5v3M12 13.5v3M18 11.5v3" />',
  gondola: '<path d="M3 4l18 2M12 5v3M6 8h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 12h12" />',
  ski: '<path d="M4 20L20 4M7 21L21 7M9 12l3 3" />',
  cat: '<path d="M3 15h18v4H3zM5 15V9h8l3 6M14 9h4l2 6M2 12h3" />',
  lodge: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5" />',
  car: '<path d="M4 16l2-6h12l2 6v3H4zM7 19v1M17 19v1M6 13h12" />',
  school: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5" />',
  hotel: '<path d="M5 21V4h14v17M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4" />',
  lamp: '<path d="M12 22V9M8 4h8l-2 5h-4zM9 22h6" />',
  gun: '<path d="M5 21l5-9M7 9a5 5 0 1 1 7 7M14 16l6 3M15 12l6-1M13 8l4-4" />',
  wrench: '<path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z" />',
  mega: '<path d="M3 10v4h3l7 5V5L6 10zM17 8a5 5 0 0 1 0 8" />',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 18z" />',
  flake: '<path d="M12 2v20M3.5 7l17 10M3.5 17l17-10M9 4l3 2 3-2M9 20l3-2 3 2" />',
  snow: '<path d="M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 14zM8 18v.1M12 20v.1M16 18v.1M10 22v.1M14 22v.1" />',
  storm: '<path d="M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 14zM12 14l-2 4h4l-2 4" />',
  pause: '<path d="M8 5v14M16 5v14" />',
  x: '<path d="M6 6l12 12M18 6L6 18" />',
  star: '<path d="M12 3l2.8 5.9 6.2.8-4.6 4.4 1.2 6.2L12 17.3l-5.6 3 1.2-6.2L3 9.7l6.2-.8z" />',
  ticket: '<path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM14 4v12" />',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" />',
  up: '<path d="M12 19V5M5 12l7-7 7 7" />',
  gift: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z" />',
  camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
  cup: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3" />',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M16 11a3 3 0 1 0-1-5.8M21 20c0-3-2-5-4-5.6" />',
  chev: '<path d="M6 9l6 6 6-6" />',
  right: '<path d="M9 6l6 6-6 6" />',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />',
  tube: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  skate: '<path d="M6 3h5v9l7 2v3H6zM4 21h16M8 17v4M16 17v4" />',
  spa: '<path d="M3 15c3 3 15 3 18 0M5 19h14M8 4c-1 2 1 3 0 5M12 3c-1 2 1 3 0 5M16 4c-1 2 1 3 0 5" />',
  heli: '<path d="M2 5h20M12 5v3M5 12a7 4 0 0 0 7 4h3v-6H9a4 4 0 0 0-4 2zM15 12h7M19 10v4M8 16l-1 3M13 16l1 3M5 19h10" />',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5" />',
  flame: '<path d="M12 22a6 6 0 0 0 6-6c0-4-3-6-4-10-2 3-3 4-4 6-1-1-1-2-2-3-1 2-2 4-2 7a6 6 0 0 0 6 6z" />',
  spark: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" />',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6v4H9z" />',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5zM5 21h14" />',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  green: '<circle cx="12" cy="12" r="7" fill="#2fb65a" stroke="none"/>',
  blue: '<rect x="5" y="5" width="14" height="14" fill="#2f7fe0" stroke="none"/>',
  black: '<path d="M12 3l9 9-9 9-9-9z" fill="#15161c" stroke="#fff" stroke-width="1.2"/>',
  double: '<path d="M7 5l6 7-6 7-6-7zM17 5l6 7-6 7-6-7z" fill="#15161c" stroke="#fff" stroke-width="1.2"/>',
  park: '<rect x="4" y="4" width="16" height="16" rx="3" fill="#f08a24" stroke="none"/><path d="M8 15l3-6 2 4 1-2 2 4" stroke="#fff"/>',
};
export const icon = (k: string, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[k] ?? I.star}</svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const num = (v: number) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : Math.round(v).toLocaleString());
const eta = (sec: number) => (!isFinite(sec) ? '…' : sec < 60 ? `${Math.ceil(sec)}s` : sec < 3600 ? `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s` : `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`);
function fmtHour(h: number) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`;
}
function stars(n: number, size = 15) {
  let s = '';
  for (let i = 0; i < 5; i++) { const f = Math.max(0, Math.min(1, n - i)); s += `<i style="--f:${(f * 100).toFixed(0)}%;width:${size}px;height:${size}px">${icon('star', size)}</i>`; }
  return `<span class="stars">${s}</span>`;
}
const setHtml = (el: HTMLElement, html: string) => { if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; return true; } return false; };

const CATS: { id: Cat; name: string; icon: string }[] = [
  { id: 'lifts', name: 'Lifts', icon: 'chair' },
  { id: 'trails', name: 'Trails', icon: 'ski' },
  { id: 'village', name: 'Village', icon: 'lodge' },
  { id: 'fun', name: 'Fun', icon: 'skate' },
  { id: 'snow', name: 'Snow', icon: 'flake' },
  { id: 'crew', name: 'Crew', icon: 'people' },
];
export const VIEWS: { name: string; icon: string; tip: string }[] = [
  { name: 'Resort', icon: 'eye', tip: 'The resort as it is' },
  { name: 'Trail map', icon: 'map', tip: 'Every trail in its colour' },
  { name: 'Snow', icon: 'flake', tip: 'Snow condition: green is perfect, red is worn out' },
  { name: 'Crowds', icon: 'people', tip: 'Where the skiers are' },
];
type ReportTab = 'overview' | 'league' | 'trails' | 'lifts' | 'events' | 'legend';
export interface Thought { text: string; good: boolean; who: string }

export class UI {
  root: HTMLElement;
  tab: Cat = 'trails';
  buyN: number = 1; // 0 = max
  shopOpen = true;
  view = 0;
  report: ReportTab | null = null;
  onBuy: (id: string, n: number) => void = () => {};
  onSpeed: (n: number) => void = () => {};
  onClaim: (id: string, x: number, y: number) => void = () => {};
  onTour: () => void = () => {};
  onSound: () => void = () => {};
  onView: (n: number) => void = () => {};
  onHost: (id: string) => void = () => {};
  onSeason: () => void = () => {};
  onFocusItem: (id: string) => void = () => {};
  onDeal: (accept: boolean) => void = () => {};
  /** the latest things guests have said, newest first */
  voices: Thought[] = [];
  private el: Record<string, HTMLElement> = {};
  private labelNodes = new Map<string, HTMLElement>();
  private refreshT = 0;
  private rowsKey = '';
  private cashShown = 0;
  private flashId = '';
  private celT = 0;
  private seasonArm = false;

  constructor(root: HTMLElement, private sim: Sim, private m: Mountain) {
    this.root = root;
    root.innerHTML = `
      <div class="vignette"></div>
      <div class="labels" id="u-labels"></div>
      <div class="top">
        <div class="badge glass" id="u-badge"></div>
        <div class="money"><div class="cashbox" id="u-cash"></div><div class="chips" id="u-chips"></div></div>
        <div class="clock glass" id="u-clock"></div>
      </div>
      <div class="side">
        <div class="glass league" id="u-league"></div>
        <div class="glass goals" id="u-goals"></div>
        <div class="glass biz" id="u-biz"></div>
        <div class="glass evcard" id="u-ev"></div>
      </div>
      <div class="shop glass" id="u-shop">
        <div class="shead">
          <div class="tabs" id="u-tabs">${CATS.map((c) => `<button data-tab="${c.id}" title="${c.name}">${icon(c.icon, 17)}<span>${c.name}</span><i class="dot"></i></button>`).join('')}</div>
          <div class="srow2"><div class="buyn" id="u-buyn">${[1, 10, 100, 0].map((n) => `<button data-n="${n}">${n ? '×' + n : 'Max'}</button>`).join('')}</div><button class="fold" id="u-fold" title="Hide the shop">${icon('right', 16)}</button></div>
        </div>
        <div class="rows" id="u-rows"></div>
      </div>
      <button class="shoptab glass" id="u-shoptab">${icon('up', 16)} Shop<i class="dot"></i></button>
      <div class="viewbar glass" id="u-viewbar">
        ${VIEWS.map((v, i) => `<button data-view="${i}" title="${v.tip}">${icon(v.icon, 15)}<span>${v.name}</span></button>`).join('')}
        <i class="sep"></i>
        <button data-report="overview" title="Business report (R)">${icon('chart', 15)}<span>Report</span></button>
        <button id="u-tour" title="Cinematic camera">${icon('film', 15)}</button>
        <button id="u-sound" title="Sound on/off">${icon('mega', 15)}</button>
      </div>
      <div class="legendk" id="u-legendk"></div>
      <div class="toasts" id="u-toasts"></div>
      <div class="celebrate" id="u-celebrate"></div>
      <div class="modal" id="u-modal"></div>
      <div class="radio glass" id="u-radio"></div>
    `;
    for (const id of ['league', 'labels', 'badge', 'cash', 'chips', 'clock', 'goals', 'biz', 'ev', 'shop', 'shoptab', 'tabs', 'buyn', 'rows', 'fold', 'viewbar', 'legendk', 'toasts', 'celebrate', 'modal', 'radio', 'tour', 'sound']) this.el[id] = root.querySelector('#u-' + id)!;
    const on = (id: string, ev: string, f: (e: Event) => void) => this.el[id].addEventListener(ev, f);
    const closest = (e: Event, sel: string) => (e.target as HTMLElement).closest(sel) as HTMLElement | null;
    on('tabs', 'click', (e) => { const b = closest(e, 'button'); if (b) { this.tab = b.dataset.tab as Cat; this.renderShop(true); this.el.rows.scrollTop = 0; } });
    on('buyn', 'click', (e) => { const b = closest(e, 'button'); if (b) { this.buyN = +b.dataset.n!; this.renderShop(true); } });
    on('fold', 'click', () => this.setShop(false));
    on('shoptab', 'click', () => this.setShop(true));
    on('rows', 'click', (e) => {
      const b = closest(e, '[data-buy]');
      if (b && !b.classList.contains('no')) { this.onBuy(b.dataset.buy!, this.buyN === 0 ? Infinity : this.buyN); this.renderShop(true); return; }
      const f = closest(e, '[data-look]');
      if (f) this.onFocusItem(f.dataset.look!);
    });
    on('goals', 'click', (e) => { const b = closest(e, '[data-claim]'); if (b) { const r = b.getBoundingClientRect(); this.onClaim(b.dataset.claim!, r.left + r.width / 2, r.top + r.height / 2); } });
    on('biz', 'click', (e) => {
      const b = closest(e, '[data-fix]'); if (b) this.openItem(b.dataset.fix!);
      const a = closest(e, '[data-auto]'); if (a) { this.sim.s.autoPrice = !this.sim.s.autoPrice; this.sim.planDay(true); this.renderBiz(true); }
      const r = closest(e, '[data-report]'); if (r) this.openReport(r.dataset.report as ReportTab);
    });
    on('biz', 'input', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'u-price') { this.sim.s.autoPrice = false; this.sim.s.price = +t.value; this.sim.planDay(true); this.renderBiz(false); } });
    on('league', 'click', () => this.openReport('league'));
    on('ev', 'click', (e) => {
      const d = closest(e, '[data-deal]'); if (d) { this.onDeal(d.dataset.deal === '1'); this.renderEvents(); return; }
      const h = closest(e, '[data-host]'); if (h && !h.classList.contains('no')) { this.onHost(h.dataset.host!); this.renderEvents(); return; }
      const r = closest(e, '[data-report]'); if (r) this.openReport('events');
    });
    on('clock', 'click', (e) => { const b = closest(e, 'button'); if (b?.dataset.sp) this.onSpeed(+b.dataset.sp); });
    on('viewbar', 'click', (e) => {
      const b = closest(e, 'button'); if (!b) return;
      if (b.dataset.view) this.setView(+b.dataset.view);
      else if (b.dataset.report) this.openReport('overview');
    });
    on('tour', 'click', (e) => { e.stopPropagation(); this.onTour(); });
    on('sound', 'click', (e) => { e.stopPropagation(); this.onSound(); });
    on('modal', 'click', (e) => {
      if (closest(e, '[data-close]') || e.target === this.el.modal) { this.closeModal(); return; }
      const t = closest(e, '[data-rtab]'); if (t) { this.report = t.dataset.rtab as ReportTab; this.seasonArm = false; this.renderReport(); return; }
      const h = closest(e, '[data-host]'); if (h && !h.classList.contains('no')) { this.onHost(h.dataset.host!); this.renderReport(); return; }
      const f = closest(e, '[data-look]'); if (f) { this.closeModal(); this.onFocusItem(f.dataset.look!); return; }
      const u = closest(e, '[data-up]'); if (u) { this.closeModal(); this.openItem(u.dataset.up!); return; }
      const s = closest(e, '[data-season]');
      if (s) { if (!this.seasonArm) { this.seasonArm = true; this.renderReport(); } else { this.seasonArm = false; this.closeModal(); this.onSeason(); } }
    });
    this.cashShown = sim.s.cash;
    this.setView(0);
    this.renderShop(true);
  }

  setShop(open: boolean) { this.shopOpen = open; this.root.classList.toggle('shop-closed', !open); }
  setView(n: number) {
    this.view = n;
    for (const b of this.el.viewbar.querySelectorAll('[data-view]')) b.classList.toggle('on', +(b as HTMLElement).dataset.view! === n);
    this.onView(n);
    this.renderLegendKey();
  }
  private renderLegendKey() {
    const k = this.el.legendk;
    const html = this.view === 1 ? `<span>${icon('green', 13)} Easy</span><span>${icon('blue', 13)} Intermediate</span><span>${icon('black', 13)} Expert</span><span>${icon('park', 13)} Park</span>`
      : this.view === 2 ? `<span><i style="background:#2fbd5c"></i>Perfect</span><span><i style="background:#f9b72e"></i>Worn</span><span><i style="background:#dc3328"></i>Bare / icy</span><small>Snowcats fix it overnight</small>`
      : this.view === 3 ? `<span><i style="background:#4d9bfa"></i>Quiet</span><span><i style="background:#f9c733"></i>Busy</span><span><i style="background:#e5302f"></i>Packed</span>`
      : '';
    setHtml(k, html);
    k.classList.toggle('on', !!html);
  }

  /** jump the shop to an item and flash it */
  openItem(id: string) {
    const it = ITEM_BY[id];
    if (!it) return;
    this.tab = it.cat;
    this.setShop(true);
    this.flashId = id;
    this.renderShop(true);
    const c = this.el.rows.querySelector(`[data-row="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (c) this.el.rows.scrollTo({ top: c.offsetTop - 8, behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const sim = this.sim, s = sim.s;
    this.cashShown += (s.cash - this.cashShown) * Math.min(1, dt * 9);
    if (Math.abs(s.cash - this.cashShown) < 1) this.cashShown = s.cash;
    setHtml(this.el.cash, `<div class="cash">${money(this.cashShown)}</div><div class="rate"><b>+${money(sim.perMinute)}</b> a minute</div>`);
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.25;
    this.renderBadge();
    this.renderChips();
    this.renderClock();
    this.renderLeague();
    this.renderGoals();
    this.renderBiz(false);
    this.renderEvents();
    this.renderShop(false);
    if (this.report) this.renderReport();
  }

  private renderBadge() {
    const s = this.sim.s, xp = this.sim.xpProgress;
    setHtml(this.el.badge, `<div class="lvring" style="--p:${(xp.frac * 100).toFixed(1)}%"><b>${s.resortLv}</b><small>LEVEL</small></div>
      <div class="bt"><div class="rname">${esc(s.name)}${s.legend ? `<span class="leg" title="Legend stars: all income ×${legendMul(s.legend).toFixed(2)}">${icon('crown', 12)}${s.legend}</span>` : ''}</div>
      <div class="srow">${stars(s.stars)}<span class="sv">${s.stars.toFixed(1)}</span></div>
      <div class="xp"><i style="width:${(xp.frac * 100).toFixed(1)}%"></i></div><small>${num(Math.max(0, xp.need - xp.cur))} more guests to level ${s.resortLv + 1}</small></div>`);
  }

  private renderChips() {
    const sim = this.sim, s = sim.s;
    const c: string[] = [];
    const e = sim.eventToday;
    if (e) c.push(`<span class="chip ev">${icon(e.icon, 13)} ${esc(e.name)} ${s.event?.state === 'live' ? '<b>live</b>' : 'today'}</span>`);
    if (s.powderDay) c.push(`<span class="chip pow">${icon('flake', 13)} Powder day <b>+45%</b></span>`);
    if (s.buzz > 0.01) c.push(`<span class="chip buzz">${icon('camera', 13)} Buzz <b>+${Math.round(s.buzz * 100)}%</b></span>`);
    if (sim.lunchRushLeft > 0) c.push(`<span class="chip cocoa">${icon('cup', 13)} Cocoa rush <b>×2</b></span>`);
    if (s.legend) c.push(`<span class="chip leg">${icon('crown', 13)} Legend <b>×${legendMul(s.legend).toFixed(2)}</b></span>`);
    setHtml(this.el.chips, c.join(''));
  }

  private renderClock() {
    const sim = this.sim;
    const w = WEATHER[sim.weather];
    const ph = sim.phase;
    const status = ph === 'open' ? 'Lifts open' : ph === 'evening' ? 'Night skiing' : ph === 'prep' ? `Opens ${fmtHour(OPEN)}` : 'Snowcats grooming';
    const sp = sim.paused ? 0 : sim.speed;
    const fc = sim.s.weather.slice(1, 4).map((q, i) => `<span title="${WEATHER[q].name}">${icon(WEATHER[q].icon, 13)}<small>${['Tmr', '+2', '+3'][i]}</small></span>`).join('');
    setHtml(this.el.clock, `<div class="crow"><b>${sim.dayName} · Day ${sim.day}</b><span class="time">${fmtHour(sim.hour)}</span></div>
      <div class="crow small"><span class="st ${sim.isOpen ? 'live' : ''}">${status}</span><span class="wx">${icon(w.icon, 14)} ${w.name} ${Math.round(sim.temp)}°</span></div>
      <div class="crow small"><span class="speed">${([[0, ''], [1, '1×'], [2, '2×'], [4, '4×']] as [number, string][]).map(([n, l]) => `<button data-sp="${n}" class="${sp === n ? 'on' : ''}">${n === 0 ? icon('pause', 12) : l}</button>`).join('')}</span><span class="fc">${fc}</span></div>`);
  }

  private renderLeague() {
    const sim = this.sim;
    const st = sim.standings();
    const rank = st.findIndex((r) => r.you) + 1;
    const next = rank > 1 ? st[rank - 2] : null;
    const me = sim.leagueScore;
    const p = next ? Math.min(1, me / Math.max(1, next.guests)) : 1;
    setHtml(this.el.league, `<div class="rk"><small>League</small><b>#${rank}</b></div>
      <div class="lgm">${next ? `<span>Next: <b>${esc(next.name)}</b></span><span class="gap">${num(Math.max(0, next.guests - me))} guests/day to pass</span>` : `<span><b>Top of the league!</b></span><span class="gap">Best resort in the region</span>`}
      <div class="gbar"><i style="width:${(p * 100).toFixed(1)}%"></i></div></div><span class="more">${icon('right', 14)}</span>`);
  }

  private renderGoals() {
    const list = this.sim.activeGoals(3);
    setHtml(this.el.goals, `<h4>${icon('star', 13)} Goals</h4>` + list.map(({ g, p }) => `<div class="goal ${p >= 1 ? 'done' : ''}">
        <div class="gt"><b>${esc(g.text)}</b><div class="gbar"><i style="width:${(p * 100).toFixed(0)}%"></i></div></div>
        ${p >= 1 ? `<button class="claim" data-claim="${g.id}">Claim<br><b>${money(this.sim.goalReward(g.reward, g.reward ? 75 : 150))}</b></button>` : `<span class="rw">${money(this.sim.goalReward(g.reward, g.reward ? 75 : 150))}</span>`}
      </div>`).join(''));
  }

  /** the live business card: who's here, what's coming in, what's holding growth back */
  renderBiz(force: boolean) {
    const sim = this.sim, P = sim.plan, t = sim.s.today;
    if (!force && (document.activeElement as HTMLElement | null)?.id === 'u-price') {
      const d = this.el.biz.querySelector('#u-pv'); if (d) d.textContent = '$' + sim.s.price;
      return;
    }
    const total = sim.todayIncome;
    const bar = INCOME_KEYS.filter(([k]) => (t[k] as number) > 0).map(([k, n, c]) => `<i style="flex:${(t[k] as number).toFixed(0)};background:${c}" title="${n}: ${money(t[k] as number)}"></i>`).join('');
    const top3 = INCOME_KEYS.map(([k, n, c]) => [n, t[k] as number, c] as [string, number, string]).filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const lim = P.limit;
    const rows: [string, string, number][] = [['demand', 'Want to come', P.demand], ['parking', 'Parking', P.parking], ['lifts', 'Lift capacity', P.lifts]];
    const max = Math.max(...rows.map((r) => r[2]), 1);
    const fixId = lim === 'parking' ? (sim.lv('hotel') && priceOf(ITEM_BY.hotel, sim.lv('hotel')) < priceOf(ITEM_BY.parking, sim.lv('parking')) * 3 ? 'hotel' : 'parking') : lim === 'lifts' ? this.cheapest('lift.') : this.cheapest('run.');
    const why = { demand: 'More guests want in: better trails, rating or marketing', parking: 'Parking is full: expand it (or the hotel)', lifts: 'Lift lines are long: upgrade a lift' }[lim];
    const html = `<h4>${icon('chart', 13)} Your business <button class="link" data-report="overview">Report ${icon('right', 12)}</button></h4>
      <div class="kpis">
        <div title="Skiers on the mountain right now"><small>Skiing now</small><b>${num(sim.onMountain)}</b></div>
        <div title="Guests through the gates today, of the expected total"><small>Guests</small><b>${num(t.visitors + t.night)}<em>/${num(sim.forecastV)}</em></b></div>
        <div title="Everything earned since 6 am"><small>Today</small><b class="g">${money(total)}</b></div>
      </div>
      <div class="ibar">${bar || '<i style="flex:1;background:rgba(255,255,255,0.08)"></i>'}</div>
      <div class="ilegend">${top3.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} ${money(v)}</span>`).join('') || '<span>Gates open at 8:30</span>'}</div>
      ${rows.map(([k, n, v]) => `<div class="gr ${k === lim ? 'lim' : ''}"><span>${n}</span><i><b style="width:${Math.max(3, (v / max) * 100)}%"></b></i><em>${num(v)}</em></div>`).join('')}
      <div class="tip"><span>${why}</span><button data-fix="${fixId}">Fix ${icon('up', 12)}</button></div>
      <div class="price"><span>${icon('ticket', 14)} Day ticket</span><b id="u-pv">$${sim.s.price}</b><button data-auto="1" class="${sim.s.autoPrice ? 'on' : ''}" title="Let the resort pick the best price">Auto</button></div>
      ${sim.s.autoPrice ? '' : `<input type="range" id="u-price" min="5" max="${Math.max(150, Math.round(P.fair * 2.5))}" value="${sim.s.price}">`}`;
    setHtml(this.el.biz, html);
  }
  private cheapest(prefix: string) {
    let best = prefix === 'lift.' ? 'lift.carpet' : 'run.bunny', bc = Infinity;
    for (const it of ITEMS) { if (!it.id.startsWith(prefix) || this.sim.lockReason(it.id) || this.sim.lv(it.id) >= it.max) continue; const c = priceOf(it, this.sim.lv(it.id)); if (c < bc) { bc = c; best = it.id; } }
    return best;
  }

  /** the event card: what's on, or the best one you could host now */
  private renderEvents() {
    const sim = this.sim;
    const cur = sim.s.event;
    let html = `<h4>${icon('flag', 13)} Events &amp; sponsors <button class="link" data-report="events">All ${icon('right', 12)}</button></h4>`;
    const d = sim.s.deal;
    if (d) {
      const p = Math.min(1, sim.dealProgress());
      html += d.state === 'offer'
        ? `<div class="deal offer"><div class="dh"><span class="sp">${esc(d.sponsor)}</span><b>${money(d.reward)}</b></div><p>${esc(d.text)}</p><div class="dacts"><button data-deal="1">Accept</button><button data-deal="0" class="ghost">Not now</button></div></div>`
        : `<div class="deal"><div class="dh"><span class="sp">${esc(d.sponsor)} contract</span><b>${money(d.reward)}</b></div><p>${esc(d.text)}</p><div class="gbar"><i style="width:${(p * 100).toFixed(0)}%"></i></div></div>`;
    }
    if (cur) {
      const e = EVENTS.find((q) => q.id === cur.id)!;
      const end = sim.eventEnd(e);
      const p = cur.state === 'live' ? Math.min(1, Math.max(0, (sim.hour - OPEN) / (end - OPEN))) : 0;
      html += `<div class="evnow"><span class="ei">${icon(e.icon, 18)}</span><div><b>${esc(e.name)}</b><small>${cur.state === 'live' ? `On now · prize ${money(sim.eventPrize(e))} at ${fmtHour(end)}` : `Booked for ${cur.day === sim.day ? 'today' : 'tomorrow'} · ${Math.round((e.guestMul - 1) * 100)}% more guests`}</small><div class="gbar"><i style="width:${(p * 100).toFixed(0)}%"></i></div></div></div>`;
    } else {
      const ready = EVENTS.filter((e) => !sim.eventLock(e));
      const pick = ready.sort((a, b) => sim.eventPrize(b) - sim.eventPrize(a))[0];
      if (pick) {
        const cost = sim.eventCost(pick), can = sim.s.cash >= cost;
        html += `<div class="evnow"><span class="ei">${icon(pick.icon, 18)}</span><div><b>${esc(pick.name)}</b><small>${esc(pick.blurb)}</small></div></div>
          <button class="host ${can ? '' : 'no'}" data-host="${pick.id}"><span>Host ${sim.eventDay(pick) === sim.day ? 'today' : 'tomorrow'}</span><b>${money(cost)}</b><small>wins ${money(sim.eventPrize(pick))} + ${Math.round((pick.guestMul - 1) * 100)}% guests</small></button>`;
      } else {
        const next = EVENTS.map((e) => [e, sim.eventLock(e)] as const).find(([, l]) => l && l.startsWith('Ready'));
        const locked = EVENTS.find((e) => sim.eventLock(e)?.startsWith('Resort') || sim.eventLock(e)?.startsWith('Needs'));
        html += `<p class="note">${next ? `${esc(next[0].name)}: ${next[1]!.toLowerCase()}` : locked ? `Next: ${esc(locked.name)} (${sim.eventLock(locked)!.toLowerCase()})` : 'No events right now'}</p>`;
      }
    }
    setHtml(this.el.ev, html);
  }

  // ------------------------------------------------------------------ the shop
  renderShop(force: boolean) {
    const sim = this.sim;
    let anyAll = false;
    for (const b of this.el.tabs.querySelectorAll('button')) {
      const c = (b as HTMLElement).dataset.tab as Cat;
      b.classList.toggle('on', c === this.tab);
      const any = ITEMS.some((it) => it.cat === c && !sim.lockReason(it.id) && sim.lv(it.id) < it.max && sim.quote(it.id, 1).total <= sim.s.cash);
      anyAll ||= any;
      (b.querySelector('.dot') as HTMLElement).style.display = any ? '' : 'none';
    }
    (this.el.shoptab.querySelector('.dot') as HTMLElement).style.display = anyAll ? '' : 'none';
    for (const b of this.el.buyn.querySelectorAll('button')) b.classList.toggle('on', +(b as HTMLElement).dataset.n! === this.buyN);
    const html = ITEMS.filter((it) => it.cat === this.tab).map((it) => this.row(it.id)).join('');
    if (!force && html === this.rowsKey) return;
    this.rowsKey = html;
    const st = this.el.rows.scrollTop;
    this.el.rows.innerHTML = html;
    this.el.rows.scrollTop = st;
    if (this.flashId) { const c = this.el.rows.querySelector(`[data-row="${CSS.escape(this.flashId)}"]`); c?.classList.add('flash'); this.flashId = ''; }
  }

  private row(id: string) {
    const sim = this.sim;
    const it = ITEM_BY[id];
    const lv = sim.lv(id);
    const lock = sim.lockReason(id);
    const maxed = lv >= it.max;
    const want = this.buyN === 0 ? Infinity : this.buyN;
    const q = sim.quote(id, lv === 0 ? 1 : want);
    const can = q.n > 0 && q.total <= sim.s.cash;
    const rate = Math.max(1e-6, sim.perMinute / 60 || sim.s.rate);
    const eff = itemEffect(it, lv);
    const nextEff = maxed ? '' : itemEffect(it, lv + Math.max(1, q.n));
    const nm = nextMilestone(lv), pm = prevMilestone(lv);
    const ms = it.max > 8 && nm && lv ? `<div class="ms"><i><b style="width:${(((lv - pm) / (nm - pm)) * 100).toFixed(0)}%"></b></i><span>×2 at ${nm}</span></div>` : '';
    const status = this.rowStatus(id);
    const look = id.startsWith('lift.') || id.startsWith('run.') ? `<button class="look" data-look="${id}" title="Show me">${icon('eye', 13)}</button>` : '';
    let btn: string;
    if (lock) btn = `<div class="locked">${icon('lock', 13)} ${esc(lock)}</div>`;
    else if (maxed) btn = `<div class="maxed">${it.max === 1 ? 'Built' : 'Maxed'}</div>`;
    else btn = `<button class="buy ${can ? '' : 'no'}" data-buy="${id}"><span>${lv === 0 ? 'Build' : q.n > 1 ? '×' + q.n : 'Upgrade'}</span><b>${money(q.total)}</b>${can ? '' : `<small>${eta((q.total - sim.s.cash) / rate)}</small>`}</button>`;
    const fresh = lv === 0 && !lock && can;
    return `<div class="irow ${lock ? 'is-lock' : ''} ${fresh ? 'glow' : ''} ${can && !lock && !maxed ? 'can' : ''}" data-row="${id}" style="--c:${it.color}">
      <span class="ci">${icon(it.icon, 19)}</span>
      <div class="im">
        <div class="in"><b>${esc(it.name)}</b>${lv ? `<span class="lvb">${lv}</span>` : ''}${look}</div>
        <div class="ie">${lv ? `${esc(eff)}${status ? ' · ' + status : ''}` : esc(this.blurb(id))}${!maxed && !lock && lv ? ` <span class="nx">→ ${esc(nextEff)}</span>` : ''}</div>
        ${ms}
      </div>
      ${btn}
    </div>`;
  }
  private rowStatus(id: string) {
    const sim = this.sim;
    if (id.startsWith('lift.')) return sim.broken[id.slice(5)] !== undefined ? '<em class="bad">being fixed</em>' : '';
    if (id.startsWith('run.')) { const r = id.slice(4); return sim.runBuilt(r) ? `${Math.round((sim.runQ[r] ?? 0) * 100)}% snow` : ''; }
    return '';
  }
  private blurb(id: string) {
    if (id.startsWith('lift.')) { const l = LIFT_BY[id.slice(5)]; return `Opens ${RUNS.filter((r) => r.from === l.to).map((r) => r.name).join(', ')}`; }
    if (id.startsWith('run.')) { const r = RUN_BY[id.slice(4)]; return `${DIFF_NAME[r.diff]} trail, ${Math.round(this.m.runOf[r.id].len)} m long`; }
    return ({
      rental: 'Guests rent skis and boots', school: 'Lessons bring families', hotel: 'Guests stay over; rooms skip the parking limit', lights: 'Floodlit lower trails: open until 9 pm',
      snowmaking: 'Guns fire on cold nights to keep thin trails open', mechanic: 'Fewer breakdowns, faster fixes', marketing: 'Ads, influencers and ski magazines', service: 'Friendly staff: a straight rating boost',
      fleet: 'More snowcats groom more trails each night', catpower: 'Faster cats, wider tillers',
      tubing: 'A snow ramp with tubing lanes for the whole family', rink: 'Skating under string lights on the plaza', summithut: 'Lunch with the best view in the state',
      spa: 'Steaming pools next to the hotel', heli: 'A helicopter flies experts to untouched backcountry peaks',
    } as Record<string, string>)[id] ?? '';
  }

  // ------------------------------------------------------------------ the report
  openReport(tab: ReportTab) { this.report = tab; this.seasonArm = false; this.el.modal.classList.add('on', 'wide'); this.el.modal.dataset.h = ''; this.renderReport(); }
  closeModal() { this.report = null; this.el.modal.classList.remove('on', 'wide'); }
  private renderReport() {
    const tab = this.report!;
    const tabs: [ReportTab, string, string][] = [['overview', 'Overview', 'chart'], ['league', 'League', 'trophy'], ['trails', 'Trails', 'ski'], ['lifts', 'Lifts', 'chair'], ['events', 'Events', 'flag'], ['legend', 'Legend', 'crown']];
    const body = tab === 'overview' ? this.repOverview() : tab === 'league' ? this.repLeague() : tab === 'trails' ? this.repTrails() : tab === 'lifts' ? this.repLifts() : tab === 'events' ? this.repEvents() : this.repLegend();
    const html = `<div class="sheet report"><div class="rhead"><h2>${esc(this.sim.s.name)}</h2><div class="rtabs">${tabs.map(([k, n, ic]) => `<button data-rtab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic, 15)} ${n}${k === 'legend' && this.sim.legendReady ? '<i class="dot"></i>' : ''}</button>`).join('')}</div><button class="x" data-close="1">${icon('x', 18)}</button></div><div class="rbody">${body}</div></div>`;
    const m = this.el.modal;
    if (m.dataset.h !== html) { const sc = m.querySelector('.rbody')?.scrollTop ?? 0; m.dataset.h = html; m.innerHTML = html; const rb = m.querySelector('.rbody'); if (rb) rb.scrollTop = sc; }
  }
  private repOverview() {
    const sim = this.sim, s = sim.s, t = s.today;
    const hist = [...s.history.slice(-13)];
    const maxI = Math.max(1, ...hist.map((h) => h.income), sim.todayIncome);
    const days = [...hist.map((h) => ({ d: h.day, inc: h.income, v: h.visitors, parts: h.parts })), { d: sim.day, inc: sim.todayIncome, v: Math.round(t.visitors + t.night), parts: Object.fromEntries(INCOME_KEYS.map(([k]) => [k, t[k] as number])) as Record<string, number>, now: true }];
    const chart = days.map((d) => `<div class="col ${(d as any).now ? 'now' : ''}" title="Day ${d.d}: ${money(d.inc)} · ${num(d.v)} guests"><div class="stack" style="height:${((d.inc / maxI) * 100).toFixed(1)}%">${INCOME_KEYS.map(([k, , c]) => { const v = d.parts?.[k] ?? 0; return v > 0 ? `<i style="flex:${v.toFixed(0)};background:${c}"></i>` : ''; }).join('') || (d.inc > 0 ? '<i style="flex:1;background:#2f7fe0"></i>' : '')}</div><small>${(d as any).now ? 'Today' : d.d}</small></div>`).join('');
    const total = sim.todayIncome || 1;
    const src = INCOME_KEYS.map(([k, n, c]) => `<div class="srcr"><i style="background:${c}"></i><span>${n}</span><b>${money(t[k as keyof DayStats] as number)}</b><em>${Math.round(((t[k] as number) / total) * 100)}%</em></div>`).join('');
    const p = sim.starParts;
    const rr: [string, number, number, string, string][] = [['Snow', p.snow, 1.7, 'flake', 'catpower'], ['Lifts', p.lifts, 1, 'chair', this.cheapest('lift.')], ['Food', p.food, 0.6, 'cup', 'lodge'], ['Variety', p.variety, 0.55, 'ski', this.cheapest('run.')], ['Service', p.service, 0.6, 'star', 'service']];
    return `<div class="rgrid2">
      <section><h3>Income, last two weeks</h3><div class="chart">${chart}</div><div class="ilegend wrap">${INCOME_KEYS.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div></section>
      <section><h3>Today so far <b class="g">${money(sim.todayIncome)}</b></h3>${src}</section>
      <section><h3>Rating <b>${sim.starTarget.toFixed(1)}</b> ${stars(sim.starTarget, 14)}</h3>${rr.map(([n, v, mx, ic, up]) => `<div class="rr ${v / mx < 0.5 ? 'low' : ''}">${icon(ic, 13)}<span>${n}</span><i><b style="width:${Math.min(100, (v / mx) * 100)}%"></b></i>${v / mx < 0.85 && up && ITEM_BY[up] && !this.sim.lockReason(up) ? `<button data-up="${up}">Improve</button>` : '<em></em>'}</div>`).join('')}</section>
      <section class="voices"><h3>What guests are saying</h3>${this.voices.length ? this.voices.slice(0, 7).map((v) => `<div class="voice ${v.good ? 'good' : 'bad'}"><i>${esc(v.who)}</i><span>“${esc(v.text)}”</span></div>`).join('') : '<p class="note">Open the gates and listen in.</p>'}</section>
      <section><h3>Records</h3><div class="recs">
        <div><small>Best day</small><b>${num(s.best)} guests</b></div><div><small>Best takings</small><b>${money(s.bestIncome)}</b></div>
        <div><small>Guests all time</small><b>${num(s.lifetime)}</b></div><div><small>Earned this season</small><b>${money(s.earned)}</b></div>
        <div><small>Events hosted</small><b>${s.evCount}</b></div><div><small>Sponsor deals won</small><b>${s.deals}</b></div>
      </div></section></div>`;
  }
  private repLeague() {
    const sim = this.sim;
    const st = sim.standings();
    const max = Math.max(...st.map((r) => r.guests), 1);
    return `<div class="league-t">${st.map((r, i) => `<div class="lrow ${r.you ? 'you' : ''}"><b class="pos">${i + 1}</b><span class="nm"><i style="background:${r.color}"></i>${esc(r.name)}${r.you ? ' <em>you</em>' : ''}</span><div class="lbar"><i style="width:${((r.guests / max) * 100).toFixed(1)}%;background:${r.you ? 'linear-gradient(90deg,#db951c,#f6bd47)' : r.color}"></i></div><span class="gv">${num(r.guests)} <small>a day</small></span></div>`).join('')}</div>
      <p class="note">Your score is your best day of the last three. Pass a rival and the league pays a bonus and gets people talking. Rivals grow a little every day too.</p>`;
  }
  private repTrails() {
    const sim = this.sim;
    const rows = RUNS.map((r) => {
      const lv = sim.lv('run.' + r.id), built = sim.runBuilt(r.id);
      const q = sim.runQ[r.id] ?? 0, on = sim.onRun[r.id] ?? 0;
      const open = sim.runOpen(r.id);
      const lock = sim.lockReason('run.' + r.id);
      return `<tr class="${built ? '' : 'dim'}"><td>${icon(r.diff, 15)}</td><td><b>${r.name}</b><small>${DIFF_NAME[r.diff]} · ${Math.round(this.m.runOf[r.id].len)} m</small></td>
        <td>${built ? `<span class="lvb">${lv}</span>` : '-'}</td>
        <td>${built ? `<div class="qbar"><i style="width:${(q * 100).toFixed(0)}%;background:${q > 0.66 ? '#2fbd5c' : q > 0.4 ? '#f9b72e' : '#dc3328'}"></i></div><small>${Math.round(q * 100)}%</small>` : ''}</td>
        <td>${built ? num(on) : ''}</td><td>${built ? num(runAppeal(r.id, lv)) : ''}</td>
        <td>${built ? (open ? '<span class="pill ok">Open</span>' : sim.isOpen ? '<span class="pill bad">Closed: thin snow</span>' : '<span class="pill">After hours</span>') : `<span class="pill">${esc(lock ?? 'Not built')}</span>`}</td>
        <td><button data-look="run.${r.id}">${icon('eye', 14)}</button>${!lock ? `<button data-up="run.${r.id}">${built ? 'Upgrade' : 'Build'}</button>` : ''}</td></tr>`;
    }).join('');
    return `<table class="tbl"><thead><tr><th></th><th>Trail</th><th>Level</th><th>Snow</th><th>Skiing now</th><th>Appeal</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Snowcats groom the worst trails first every night. Thin trails close until snowmaking or a storm fills them back in.</p>`;
  }
  private repLifts() {
    const sim = this.sim;
    const rows = LIFTS.map((l) => {
      const lv = sim.lv('lift.' + l.id), built = lv > 0;
      const load = sim.liftLoad[l.id] ?? 0;
      const br = sim.broken[l.id] !== undefined;
      const tiers = l.kind === 'gondola' ? GONDOLA_TIERS : l.kind === 'carpet' ? CARPET_TIERS : CHAIR_TIERS;
      const lock = sim.lockReason('lift.' + l.id);
      const lc = load > 0.9 ? '#dc3328' : load > 0.6 ? '#f9b72e' : '#2fbd5c';
      return `<tr class="${built ? '' : 'dim'}"><td>${icon(l.kind === 'chair' ? 'chair' : l.kind, 15)}</td><td><b>${l.name}</b><small>${built ? tiers[tierOf(lv, l.kind === 'chair' ? 5 : 3)] : 'Serves ' + RUNS.filter((r) => r.from === l.to).length + ' trails'}</small></td>
        <td>${built ? `<span class="lvb">${lv}</span>` : '-'}</td><td>${built ? num(liftCap(l.id, lv)) + '/h' : ''}</td>
        <td>${built && sim.isOpen ? `<div class="qbar"><i style="width:${Math.min(100, load * 100).toFixed(0)}%;background:${lc}"></i></div><small>${load > 1 ? 'Lines!' : Math.round(load * 100) + '%'}</small>` : ''}</td>
        <td>${built ? (br ? `<span class="pill bad">Broken · ${Math.ceil(sim.fixLeft(l.id))} min</span>` : '<span class="pill ok">Running</span>') : `<span class="pill">${esc(lock ?? 'Not built')}</span>`}</td>
        <td><button data-look="lift.${l.id}">${icon('eye', 14)}</button>${!lock ? `<button data-up="lift.${l.id}">${built ? 'Upgrade' : 'Build'}</button>` : ''}</td></tr>`;
    }).join('');
    return `<table class="tbl"><thead><tr><th></th><th>Lift</th><th>Level</th><th>Capacity</th><th>How busy</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">A busy lift means long lines and a lower rating. Upgrades every 10, 25, 50 and 100 levels swap in faster chairs.</p>`;
  }
  private repEvents() {
    const sim = this.sim;
    return `<div class="evlist">${EVENTS.map((e) => {
      const lock = sim.eventLock(e);
      const cost = sim.eventCost(e), prize = sim.eventPrize(e);
      const can = !lock && sim.s.cash >= cost;
      const live = sim.s.event?.id === e.id;
      return `<div class="evrow ${lock && !live ? 'is-lock' : ''} ${live ? 'live' : ''}"><span class="ei">${icon(e.icon, 22)}</span>
        <div class="im"><b>${esc(e.name)}</b><small>${esc(e.blurb)}</small><div class="evm"><span>${icon('people', 12)} +${Math.round((e.guestMul - 1) * 100)}% guests</span><span>${icon('trophy', 12)} prize ${money(prize)}</span><span>${icon('camera', 12)} +${Math.round(e.buzz * 100)}% buzz</span><span>every ${e.cooldown} days</span></div></div>
        ${lock ? `<div class="locked">${icon(live ? 'flag' : 'lock', 13)} ${esc(lock)}</div>` : `<button class="host ${can ? '' : 'no'}" data-host="${e.id}"><span>Host ${sim.eventDay(e) === sim.day ? 'today' : 'tomorrow'}</span><b>${money(cost)}</b></button>`}</div>`;
    }).join('')}</div><p class="note">An event pulls a bigger crowd for the day and pays its prize when it wraps up. Bigger resorts win bigger prizes.</p>`;
  }
  private repLegend() {
    const sim = this.sim, s = sim.s;
    const gain = sim.legendGain;
    const ready = sim.legendReady;
    const nextAt = Math.pow(gain + 1, 2) * 4e6;
    return `<div class="legend">
      <div class="lg-hero">${icon('crown', 40)}<div><h3>Legend stars <b>${s.legend}</b></h3><p>Every Legend star multiplies all the money your resort makes by another 25%, for good. Right now: <b>×${legendMul(s.legend).toFixed(2)}</b>.</p></div></div>
      <div class="lg-grid">
        <div><small>Earned this season</small><b>${money(s.earned)}</b></div>
        <div><small>Stars if you start a new season now</small><b class="g">+${gain}</b></div>
        <div><small>Next star at</small><b>${money(nextAt)}</b></div>
        <div><small>New multiplier</small><b>×${legendMul(s.legend + gain).toFixed(2)}</b></div>
      </div>
      <p class="note">A new season wipes the mountain back to the bunny slope: cash, lifts, trails, levels and goals all reset. You keep your Legend stars, your resort name and your settings, and you start with more cash. Seasons played: ${s.seasons}.</p>
      ${ready ? `<button class="season ${this.seasonArm ? 'arm' : ''}" data-season="1">${this.seasonArm ? `Tap again to start season ${s.seasons + 2}` : `Start a new season · +${gain} ${icon('crown', 14)}`}</button>` : `<div class="locked">${icon('lock', 13)} ${s.resortLv < LEGEND_LV ? `Reach resort level ${LEGEND_LV}` : `Earn ${money(4e6)} this season`} to start a new season</div>`}
    </div>`;
  }

  // ------------------------------------------------------------------ labels over the 3D view
  labels(list: Label[]) {
    const seen = new Set<string>();
    const placed: [number, number, number, number][] = [];
    // drops and events first, then problems, then everything else; overlapping labels step up or hide
    const rank = (L: Label) => (L.cls?.includes('drop') ? 0 : L.cls?.includes('ev') ? 1 : L.cls?.includes('bad') ? 2 : 3);
    const order = list.map((L, i) => [rank(L), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [r, i] of order) {
      const L = list[i];
      seen.add(L.id);
      let n = this.labelNodes.get(L.id);
      if (!n) {
        n = document.createElement('div');
        const node = n;
        node.addEventListener('pointerdown', (e) => e.stopPropagation());
        node.addEventListener('click', (e) => { e.stopPropagation(); (node as any)._click?.(); });
        this.el.labels.appendChild(node);
        this.labelNodes.set(L.id, node);
      }
      (n as any)._click = L.click;
      const cls = 'lbl ' + (L.cls ?? '') + (L.click ? ' clk' : '');
      if (n.className !== cls) { n.className = cls; (n as any)._w = 0; }
      if (n.dataset.h !== L.html) { n.dataset.h = L.html; n.innerHTML = L.html; (n as any)._w = 0; }
      if (L.hidden) { n.style.display = 'none'; continue; }
      n.style.display = '';
      if (!(n as any)._w) { (n as any)._w = n.offsetWidth; (n as any)._h = n.offsetHeight; }
      const w = (n as any)._w as number, h = (n as any)._h as number;
      let y = L.y, ok = false;
      for (let k = 0; k < 3 && !ok; k++) {
        const box: [number, number, number, number] = [L.x - w / 2 - 2, y - h - 2, L.x + w / 2 + 2, y + 2];
        ok = !placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]);
        if (ok) placed.push(box); else y -= h + 4;
      }
      if (!ok && r >= 2) { n.style.display = 'none'; continue; }
      n.style.transform = `translate(${L.x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
    }
    for (const [id, n] of this.labelNodes) if (!seen.has(id)) { n.remove(); this.labelNodes.delete(id); }
  }

  floatCash(x: number, y: number, amount: number, big = false) {
    const n = document.createElement('div');
    n.className = 'fcash' + (big ? ' big' : '');
    n.textContent = '+' + money(amount);
    n.style.left = x + 'px'; n.style.top = y + 'px';
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 1600);
  }
  coins(x: number, y: number, n = 14) {
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'coin';
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
      c.style.left = x + 'px'; c.style.top = y + 'px';
      c.style.setProperty('--dx', Math.cos(a) * d + 'px'); c.style.setProperty('--dy', Math.sin(a) * d - 40 + 'px');
      c.style.animationDelay = Math.random() * 0.08 + 's';
      this.root.appendChild(c);
      setTimeout(() => c.remove(), 1100);
    }
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'info', ms = 4200) {
    const n = document.createElement('div');
    n.className = 'toast ' + tone;
    n.innerHTML = text;
    this.el.toasts.appendChild(n);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild!.remove();
    setTimeout(() => n.classList.add('out'), ms);
    setTimeout(() => n.remove(), ms + 600);
  }
  dayEnd(day: number, visitors: number, income: number, starsN: number, best: boolean) {
    this.toast(`<div class="de"><small>Day ${day} wrap-up${best ? ' · <b class="rec">New record!</b>' : ''}</small><div><span>${icon('people', 14)} ${num(visitors)} guests</span><span>${icon('ticket', 14)} +${money(income)}</span><span>${icon('star', 14)} ${starsN.toFixed(1)}</span></div></div>`, best ? 'gold' : 'info', 6000);
  }
  celebrate(title: string, sub: string, kind: 'level' | 'milestone' | 'event' | 'league' = 'level') {
    const c = this.el.celebrate;
    c.innerHTML = `<div class="cb ${kind}"><small>${kind === 'level' ? 'Resort level up' : kind === 'event' ? 'Event wrapped up' : kind === 'league' ? 'League climb' : 'Milestone'}</small><b>${esc(title)}</b><span>${sub}</span></div>`;
    for (let i = 0; i < (kind === 'milestone' ? 30 : 70); i++) {
      const p = document.createElement('i');
      p.className = 'conf';
      p.style.left = 50 + (Math.random() - 0.5) * 20 + '%';
      p.style.background = ['#f2b33d', '#2f7fe0', '#d2453a', '#2fb65a', '#fff'][i % 5];
      p.style.setProperty('--dx', (Math.random() - 0.5) * 1000 + 'px');
      p.style.setProperty('--dy', 250 + Math.random() * 500 + 'px');
      p.style.setProperty('--r', Math.random() * 900 + 'deg');
      p.style.animationDelay = Math.random() * 0.2 + 's';
      c.appendChild(p);
    }
    c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
    clearTimeout(this.celT);
    this.celT = window.setTimeout(() => { c.classList.remove('on'); c.innerHTML = ''; }, kind === 'milestone' ? 2200 : 3400);
  }
  radio(html: string | null) {
    const r = this.el.radio;
    if (!html) { r.classList.remove('on'); return; }
    if (r.dataset.h !== html) { r.dataset.h = html; r.innerHTML = `<div class="who"><i>M</i><b>Marta</b><small>general manager</small></div><p>${html}</p>`; }
    r.classList.add('on');
  }
  welcome(earned: number) {
    this.el.modal.classList.remove('wide');
    this.el.modal.innerHTML = `<div class="sheet"><h2>Welcome back</h2><p class="lead">The resort kept running while you were away. Your managers banked</p><div class="bigcash">${money(earned)}</div><div class="acts"><button data-close="1" class="primary">Collect</button></div></div>`;
    this.el.modal.dataset.h = '';
    this.el.modal.classList.add('on');
  }
  get modalOpen() { return this.el.modal.classList.contains('on') && !this.report; }
  setTour(on: boolean) { this.el.tour.classList.toggle('on', on); this.root.classList.toggle('touring', on); }
  setSound(on: boolean) { this.el.sound.classList.toggle('off', !on); }
}

export { DIFF_COLOR };
