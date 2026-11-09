// Bluebird Peak HUD: resort badge + level, cash and income rate, clock and speed, goals, the growth
// bottleneck, the rating breakdown, the build dock, labels over the 3D view, drops, celebrations.
import './ui.css';
import { RUNS, LIFTS, LIFT_BY, RUN_BY, DIFF_COLOR, SIZE, type Mountain } from './mountain.ts';
import { ITEMS, ITEM_BY, WEATHER, type Cat, itemEffect, nextMilestone, prevMilestone, priceOf, OPEN } from './data.ts';
import { money, type Sim } from './sim.ts';

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
  play: '<path d="M7 4l12 8-12 8z" />',
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
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />',
  green: '<circle cx="12" cy="12" r="7" fill="#2fb65a" stroke="none"/>',
  blue: '<rect x="5" y="5" width="14" height="14" fill="#2f7fe0" stroke="none"/>',
  black: '<path d="M12 3l9 9-9 9-9-9z" fill="#1d1d22" stroke="none"/>',
  double: '<path d="M7 5l6 7-6 7-6-7zM17 5l6 7-6 7-6-7z" fill="#1d1d22" stroke="none"/>',
  park: '<rect x="4" y="4" width="16" height="16" rx="3" fill="#f08a24" stroke="none"/><path d="M8 15l3-6 2 4 1-2 2 4" stroke="#fff"/>',
};
export const icon = (k: string, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[k] ?? I.star}</svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const num = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : Math.round(v).toLocaleString());
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

const CATS: { id: Cat; name: string; icon: string }[] = [
  { id: 'lifts', name: 'Lifts', icon: 'chair' },
  { id: 'trails', name: 'Trails', icon: 'ski' },
  { id: 'village', name: 'Village', icon: 'lodge' },
  { id: 'snow', name: 'Snow', icon: 'flake' },
  { id: 'crew', name: 'Crew', icon: 'people' },
];

export class UI {
  root: HTMLElement;
  tab: Cat = 'trails';
  buyN: number = 1; // 0 = max
  dockOpen = true;
  onBuy: (id: string, n: number) => void = () => {};
  onSpeed: (n: number) => void = () => {};
  onFocus: (x: number, z: number) => void = () => {};
  onClaim: (id: string, x: number, y: number) => void = () => {};
  onTour: () => void = () => {};
  onSound: () => void = () => {};
  private el: Record<string, HTMLElement> = {};
  private mapBg: HTMLCanvasElement | null = null;
  private mapCv!: HTMLCanvasElement;
  private labelNodes = new Map<string, HTMLElement>();
  private refreshT = 0;
  private cardsKey = '';
  private cashShown = 0;
  private flashId = '';
  private celT = 0;
  markers: { x: number; z: number; kind: string }[] = [];

  constructor(root: HTMLElement, private sim: Sim, private m: Mountain) {
    this.root = root;
    root.innerHTML = `
      <div class="labels" id="u-labels"></div>
      <div class="badge card" id="u-badge"></div>
      <div class="cashbox" id="u-cash"></div>
      <div class="clock card" id="u-clock"></div>
      <div class="side">
        <div class="card goals" id="u-goals"></div>
        <div class="card growth" id="u-growth"></div>
        <div class="card rating" id="u-rating"></div>
      </div>
      <div class="mapwrap card"><canvas class="minimap" id="u-map" width="440" height="440"></canvas><div class="mapbtns"><button id="u-tour" title="Cinematic camera">${icon('film', 16)}</button><button id="u-sound" title="Sound on/off">${icon('mega', 16)}</button></div></div>
      <div class="toasts" id="u-toasts"></div>
      <div class="dock" id="u-dock">
        <div class="dockbar">
          <div class="tabs" id="u-tabs">${CATS.map((c) => `<button data-tab="${c.id}">${icon(c.icon, 16)}<span>${c.name}</span><i class="dot"></i></button>`).join('')}</div>
          <div class="buyn" id="u-buyn">${[1, 10, 100, 0].map((n) => `<button data-n="${n}">${n ? '×' + n : 'Max'}</button>`).join('')}</div>
          <button class="fold" id="u-fold" title="Hide the shop">${icon('chev', 18)}</button>
        </div>
        <div class="cards" id="u-cards"></div>
      </div>
      <div class="celebrate" id="u-celebrate"></div>
      <div class="modal" id="u-modal"></div>
      <div class="radio card" id="u-radio"></div>
    `;
    for (const id of ['labels', 'badge', 'cash', 'clock', 'goals', 'growth', 'rating', 'map', 'toasts', 'dock', 'tabs', 'buyn', 'cards', 'celebrate', 'modal', 'radio', 'fold', 'tour', 'sound']) this.el[id] = root.querySelector('#u-' + id)!;
    this.mapCv = this.el.map as HTMLCanvasElement;
    this.el.tabs.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { this.tab = b.dataset.tab as Cat; this.setDock(true); this.renderCards(true); this.el.cards.scrollLeft = 0; } });
    this.el.buyn.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { this.buyN = +b.dataset.n!; this.renderCards(true); } });
    this.el.fold.addEventListener('click', () => this.setDock(!this.dockOpen));
    this.el.cards.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-buy]') as HTMLElement | null;
      if (b && !b.classList.contains('no')) { this.onBuy(b.dataset.buy!, this.buyN === 0 ? Infinity : this.buyN); this.renderCards(true); }
    });
    this.el.cards.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.el.cards.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    this.el.goals.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-claim]') as HTMLElement | null; if (b) { const r = b.getBoundingClientRect(); this.onClaim(b.dataset.claim!, r.left + r.width / 2, r.top + r.height / 2); } });
    this.el.growth.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-fix]') as HTMLElement | null;
      if (b) this.openItem(b.dataset.fix!);
      const a = (e.target as HTMLElement).closest('[data-auto]') as HTMLElement | null;
      if (a) { this.sim.s.autoPrice = !this.sim.s.autoPrice; this.sim.planDay(true); this.renderGrowth(true); }
    });
    this.el.growth.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'u-price') { this.sim.s.autoPrice = false; this.sim.s.price = +t.value; this.sim.planDay(true); this.renderGrowth(false); } });
    this.el.clock.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button') as HTMLElement | null; if (b?.dataset.sp) this.onSpeed(+b.dataset.sp); });
    this.el.tour.addEventListener('click', () => this.onTour());
    this.el.sound.addEventListener('click', () => this.onSound());
    this.mapCv.addEventListener('click', (e) => {
      const r = this.mapCv.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      this.onFocus((u - 0.5) * SIZE * 0.9, (v - 0.5) * SIZE * 0.9 + 40);
    });
    this.el.modal.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) this.el.modal.classList.remove('on'); });
    this.cashShown = sim.s.cash;
    this.renderCards(true);
  }

  setDock(open: boolean) { this.dockOpen = open; this.el.dock.classList.toggle('closed', !open); }

  /** jump the dock to an item and flash it */
  openItem(id: string) {
    const it = ITEM_BY[id];
    if (!it) return;
    this.tab = it.cat;
    this.setDock(true);
    this.flashId = id;
    this.renderCards(true);
    const c = this.el.cards.querySelector(`[data-card="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (c) this.el.cards.scrollTo({ left: c.offsetLeft - 16, behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const sim = this.sim, s = sim.s;
    this.cashShown += (s.cash - this.cashShown) * Math.min(1, dt * 9);
    if (Math.abs(s.cash - this.cashShown) < 1) this.cashShown = s.cash;
    const html = `<div class="cash">${money(this.cashShown)}</div><div class="rate"><b>+${money(sim.perMinute)}</b> a minute</div>`;
    if (this.el.cash.dataset.h !== html) { this.el.cash.dataset.h = html; this.el.cash.innerHTML = html; }
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.25;
    this.renderBadge();
    this.renderClock();
    this.renderGoals();
    this.renderGrowth(false);
    this.renderRating();
    this.renderCards(false);
    this.drawMap();
  }

  private renderBadge() {
    const s = this.sim.s, xp = this.sim.xpProgress;
    const html = `<div class="lvring" style="--p:${(xp.frac * 100).toFixed(1)}%"><b>${s.resortLv}</b><small>LEVEL</small></div>
      <div class="bt"><div class="rname">${esc(s.name)}</div><div class="srow">${stars(s.stars)}<span class="sv">${s.stars.toFixed(1)}</span></div>
      <div class="xp"><i style="width:${(xp.frac * 100).toFixed(1)}%"></i></div><small>${num(Math.max(0, xp.need - xp.cur))} more guests to level ${s.resortLv + 1}</small></div>`;
    if (this.el.badge.dataset.h !== html) { this.el.badge.dataset.h = html; this.el.badge.innerHTML = html; }
  }

  private renderClock() {
    const sim = this.sim;
    const w = WEATHER[sim.weather];
    const ph = sim.phase;
    const status = ph === 'open' ? 'Lifts open' : ph === 'evening' ? 'Night skiing' : ph === 'prep' ? `Opens ${fmtHour(OPEN)}` : 'Snowcats out';
    const sp = sim.paused ? 0 : sim.speed;
    const fc = sim.s.weather.slice(1, 4).map((q, i) => `<span title="${WEATHER[q].name}">${icon(WEATHER[q].icon, 13)}<small>${['Tmr', '+2', '+3'][i]}</small></span>`).join('');
    const html = `<div class="crow"><b>${sim.dayName} · Day ${sim.day}</b><span class="time">${fmtHour(sim.hour)}</span></div>
      <div class="crow small"><span class="st ${sim.isOpen ? 'live' : ''}">${status}</span><span class="wx">${icon(w.icon, 14)} ${w.name} ${Math.round(sim.temp)}°</span></div>
      ${sim.s.powderDay ? '<div class="pow">Powder day · +45% skiers</div>' : ''}
      <div class="crow small"><span class="speed">${([[0, ''], [1, '1×'], [2, '2×'], [4, '4×']] as [number, string][]).map(([n, l]) => `<button data-sp="${n}" class="${sp === n ? 'on' : ''}">${n === 0 ? icon('pause', 12) : l}</button>`).join('')}</span><span class="fc">${fc}</span></div>`;
    if (this.el.clock.dataset.h !== html) { this.el.clock.dataset.h = html; this.el.clock.innerHTML = html; }
  }

  private renderGoals() {
    const list = this.sim.activeGoals(3);
    const html = `<h4>${icon('star', 13)} Goals</h4>` + (list.length ? list.map(({ g, p }) => `<div class="goal ${p >= 1 ? 'done' : ''}">
        <div class="gt"><b>${esc(g.text)}</b><div class="gbar"><i style="width:${(p * 100).toFixed(0)}%"></i></div></div>
        ${p >= 1 ? `<button class="claim" data-claim="${g.id}">Claim<br><b>${money(this.sim.goalReward(g.reward))}</b></button>` : `<span class="rw">${money(this.sim.goalReward(g.reward))}</span>`}
      </div>`).join('') : '<p class="note">Every goal done. You built a legend.</p>');
    if (this.el.goals.dataset.h !== html) { this.el.goals.dataset.h = html; this.el.goals.innerHTML = html; }
  }

  renderGrowth(force: boolean) {
    const sim = this.sim, P = sim.plan;
    if (!force && (document.activeElement as HTMLElement | null)?.id === 'u-price') {
      const d = this.el.growth.querySelector('#u-pv'); if (d) d.textContent = '$' + sim.s.price;
      const v = this.el.growth.querySelector('.big'); if (v) v.textContent = num(sim.forecastV);
      return;
    }
    const rows: [string, string, number, string][] = [
      ['demand', 'Want to come', P.demand, 'improve trails, rating or marketing'],
      ['parking', 'Parking', P.parking, 'expand the parking (or build the hotel)'],
      ['lifts', 'Lift capacity', P.lifts, 'upgrade a lift or build a new one'],
    ];
    const max = Math.max(...rows.map((r) => r[2]), 1);
    const lim = P.limit;
    const fixId = lim === 'parking' ? 'parking' : lim === 'lifts' ? this.cheapest('lift.') : this.cheapest('run.');
    const html = `<h4>${icon('people', 13)} Guests a day <span class="big">${num(sim.forecastV)}</span></h4>
      ${rows.map(([k, n, v]) => `<div class="gr ${k === lim ? 'lim' : ''}"><span>${n}</span><i><b style="width:${Math.max(3, (v / max) * 100)}%"></b></i><em>${num(v)}</em></div>`).join('')}
      <div class="tip"><span>Growth limit: ${rows.find((r) => r[0] === lim)![3]}</span><button data-fix="${fixId}">Fix ${icon('up', 12)}</button></div>
      <div class="price"><span>${icon('ticket', 14)} Day ticket</span><b id="u-pv">$${sim.s.price}</b><button data-auto="1" class="${sim.s.autoPrice ? 'on' : ''}" title="Let the resort pick the best price">Auto</button></div>
      ${sim.s.autoPrice ? '' : `<input type="range" id="u-price" min="5" max="${Math.max(150, Math.round(P.fair * 2.5))}" value="${sim.s.price}">`}`;
    if (this.el.growth.dataset.h !== html) { this.el.growth.dataset.h = html; this.el.growth.innerHTML = html; }
  }
  private cheapest(prefix: string) {
    let best = prefix === 'lift.' ? 'lift.carpet' : 'run.bunny', bc = Infinity;
    for (const it of ITEMS) { if (!it.id.startsWith(prefix) || this.sim.lockReason(it.id)) continue; const c = priceOf(it, this.sim.lv(it.id)); if (c < bc) { bc = c; best = it.id; } }
    return best;
  }

  private renderRating() {
    const p = this.sim.starParts;
    const rows: [string, number, number, string, string][] = [
      ['Snow', p.snow, 1.7, 'flake', 'catpower'], ['Lifts', p.lifts, 1, 'chair', ''], ['Food', p.food, 0.6, 'cup', 'lodge'], ['Variety', p.variety, 0.55, 'ski', ''], ['Service', p.service, 0.6, 'star', 'service'],
    ];
    const html = `<h4>${icon('star', 13)} Rating <span class="big">${this.sim.starTarget.toFixed(1)}</span></h4>
      <div class="rgrid">${rows.map(([n, v, mx, ic]) => `<div class="rr ${v / mx < 0.5 ? 'low' : ''}">${icon(ic, 12)}<span>${n}</span><i><b style="width:${Math.min(100, (v / mx) * 100)}%"></b></i></div>`).join('')}</div>`;
    if (this.el.rating.dataset.h !== html) { this.el.rating.dataset.h = html; this.el.rating.innerHTML = html; }
  }

  // ------------------------------------------------------------------ the build dock
  renderCards(force: boolean) {
    const sim = this.sim;
    for (const b of this.el.tabs.querySelectorAll('button')) {
      const c = (b as HTMLElement).dataset.tab as Cat;
      b.classList.toggle('on', c === this.tab);
      const any = ITEMS.some((it) => it.cat === c && !sim.lockReason(it.id) && sim.lv(it.id) < it.max && sim.quote(it.id, 1).total <= sim.s.cash);
      (b.querySelector('.dot') as HTMLElement).style.display = any ? '' : 'none';
    }
    for (const b of this.el.buyn.querySelectorAll('button')) b.classList.toggle('on', +(b as HTMLElement).dataset.n! === this.buyN);
    const html = ITEMS.filter((it) => it.cat === this.tab).map((it) => this.card(it.id)).join('');
    if (!force && html === this.cardsKey) return;
    this.cardsKey = html;
    const sl = this.el.cards.scrollLeft;
    this.el.cards.innerHTML = html;
    this.el.cards.scrollLeft = sl;
    if (this.flashId) { const c = this.el.cards.querySelector(`[data-card="${CSS.escape(this.flashId)}"]`); c?.classList.add('flash'); this.flashId = ''; }
  }

  private card(id: string) {
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
    const msBar = it.max > 8 && nm ? `<div class="ms"><span>×2 at level ${nm}</span><i><b style="width:${(((lv - pm) / (nm - pm)) * 100).toFixed(0)}%"></b></i></div>` : '';
    const status = this.cardStatus(id);
    let btn: string;
    if (lock) btn = `<div class="locked">${icon('lock', 14)} ${esc(lock)}</div>`;
    else if (maxed) btn = `<div class="maxed">${it.max === 1 ? 'Built' : 'Maxed out'}</div>`;
    else btn = `<button class="buy ${can ? '' : 'no'}" data-buy="${id}"><span>${lv === 0 ? 'Build' : `Upgrade${q.n > 1 ? ' ×' + q.n : ''}`}</span><b>${money(q.total)}</b>${can ? '' : `<small>in ${eta((q.total - sim.s.cash) / rate)}</small>`}</button>`;
    const fresh = lv === 0 && !lock && can;
    return `<div class="icard ${lock ? 'is-lock' : ''} ${lv === 0 ? 'is-new' : ''} ${fresh ? 'glow' : ''}" data-card="${id}" style="--c:${it.color}">
      <div class="ch"><span class="ci">${icon(it.icon, 20)}</span><div><b>${esc(it.name)}</b>${lv ? `<small>Level ${lv}${status ? ' · ' + status : ''}</small>` : '<small>Not built yet</small>'}</div></div>
      <div class="ce">${lv ? `<span>${esc(eff)}</span>` : ''}${!maxed && !lock ? `<span class="nx">${lv ? '→ ' : ''}${esc(nextEff)}</span>` : ''}</div>
      ${lv ? msBar : `<p class="cd">${esc(this.blurb(id))}</p>`}
      ${btn}
    </div>`;
  }
  private cardStatus(id: string) {
    const sim = this.sim;
    if (id.startsWith('lift.')) return sim.broken[id.slice(5)] !== undefined ? '<em class="bad">being fixed</em>' : '';
    if (id.startsWith('run.')) { const r = id.slice(4); return sim.runBuilt(r) ? `${Math.round((sim.runQ[r] ?? 0) * 100)}% snow` : ''; }
    return '';
  }
  private blurb(id: string) {
    if (id.startsWith('lift.')) { const l = LIFT_BY[id.slice(5)]; return `Opens ${RUNS.filter((r) => r.from === l.to).map((r) => r.name).join(', ')}`; }
    if (id.startsWith('run.')) { const r = RUN_BY[id.slice(4)]; return `${{ green: 'Easy', blue: 'Intermediate', black: 'Expert', double: 'Double-black', park: 'Terrain park' }[r.diff]} trail, ${Math.round(this.m.runOf[r.id].len)} m long`; }
    return ({
      rental: 'Guests rent skis and boots', school: 'Lessons bring families who would never come otherwise', hotel: 'Guests stay over; rooms bypass the parking limit', lights: 'Floodlights on the lower trails: open until 9 pm',
      snowmaking: 'Guns fire up on cold nights so thin trails stay open', mechanic: 'Lifts break less and get fixed faster', marketing: 'Ads, influencers and ski magazines', service: 'Friendly staff everywhere: a straight rating boost',
      fleet: 'More snowcats groom more trails every night', catpower: 'Faster cats and wider tillers',
    } as Record<string, string>)[id] ?? '';
  }

  // ------------------------------------------------------------------ minimap
  private buildMapBg() {
    const c = document.createElement('canvas');
    c.width = c.height = 440;
    const g = c.getContext('2d')!;
    const img = g.createImageData(440, 440);
    const m = this.m;
    const S = SIZE * 0.9;
    for (let y = 0; y < 440; y++)
      for (let x = 0; x < 440; x++) {
        const wx = (x / 440 - 0.5) * S, wz = (y / 440 - 0.5) * S + 40;
        const h = m.at(wx, wz);
        const hx = m.at(wx + 3, wz) - m.at(wx - 3, wz), hz = m.at(wx, wz + 3) - m.at(wx, wz - 3);
        const shade = Math.max(0.55, Math.min(1.12, 0.92 + (hx * 0.55 - hz * 0.35) * 0.09));
        const k = m.cellAt(wx, wz);
        const onRun = k >= 0 && m.edge[k] < 0;
        const base = wz > 405 && wx > -330 && wx < 350;
        const forest = k >= 0 && !onRun && m.edge[k] > 5 && h < 340 && !base;
        let r = 246, gg = 249, b = 253;
        if (forest) { const n = ((x * 7 + y * 13) % 5) * 3; r = 168 - n; gg = 196 - n; b = 186 - n; }
        if (base) { r = 238; gg = 233; b = 222; }
        const i = (y * 440 + x) * 4;
        img.data[i] = r * shade; img.data[i + 1] = gg * shade; img.data[i + 2] = b * shade; img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    this.mapBg = c;
  }
  private toMap(x: number, z: number): [number, number] { const S = SIZE * 0.9; return [(x / S + 0.5) * 440, ((z - 40) / S + 0.5) * 440]; }
  drawMap() {
    if (!this.mapBg) this.buildMapBg();
    const g = this.mapCv.getContext('2d')!;
    g.drawImage(this.mapBg!, 0, 0);
    const sim = this.sim;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of RUNS) {
      const p = this.m.runOf[r.id];
      const path = () => { g.beginPath(); for (let i = 0; i < p.x.length; i += 6) { const [X, Y] = this.toMap(p.x[i], p.z[i]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } };
      if (sim.runBuilt(r.id)) { g.setLineDash([]); g.globalAlpha = 1; path(); g.strokeStyle = '#fff'; g.lineWidth = 9; g.stroke(); path(); g.strokeStyle = DIFF_COLOR[r.diff]; g.lineWidth = 5.5; g.stroke(); }
      else { path(); g.strokeStyle = DIFF_COLOR[r.diff]; g.globalAlpha = 0.3; g.lineWidth = 2.5; g.setLineDash([2, 7]); g.stroke(); }
    }
    g.setLineDash([]); g.globalAlpha = 1;
    for (const l of LIFTS) {
      const built = sim.liftBuilt(l.id);
      const [ax, ay] = this.toMap(l.a[0], l.a[1]), [bx, by] = this.toMap(l.b[0], l.b[1]);
      g.strokeStyle = sim.broken[l.id] !== undefined ? '#d2453a' : '#1d2433';
      g.globalAlpha = built ? 1 : 0.25;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    g.globalAlpha = 1;
    const t = performance.now() / 300;
    for (const mk of this.markers) {
      const [X, Y] = this.toMap(mk.x, mk.z);
      if (mk.kind === 'cat') { g.fillStyle = '#d2453a'; g.beginPath(); g.arc(X, Y, 4, 0, 7); g.fill(); }
      else if (mk.kind === 'drop') { g.strokeStyle = '#f2b33d'; g.lineWidth = 3; g.beginPath(); g.arc(X, Y, 8 + Math.sin(t * 2) * 2, 0, 7); g.stroke(); }
    }
  }

  // ------------------------------------------------------------------ labels over the 3D view
  labels(list: Label[]) {
    const seen = new Set<string>();
    for (const L of list) {
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
      if (n.dataset.h !== L.html) { n.dataset.h = L.html; n.innerHTML = L.html; }
      const cls = 'lbl ' + (L.cls ?? '') + (L.click ? ' clk' : '');
      if (n.className !== cls) n.className = cls;
      n.style.display = L.hidden ? 'none' : '';
      n.style.transform = `translate(${L.x.toFixed(0)}px, ${L.y.toFixed(0)}px) translate(-50%, -100%)`;
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
  celebrate(title: string, sub: string, kind: 'level' | 'milestone' = 'level') {
    const c = this.el.celebrate;
    c.innerHTML = `<div class="cb ${kind}"><small>${kind === 'level' ? 'Resort level up' : 'Milestone'}</small><b>${esc(title)}</b><span>${sub}</span></div>`;
    for (let i = 0; i < (kind === 'level' ? 70 : 30); i++) {
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
    this.celT = window.setTimeout(() => { c.classList.remove('on'); c.innerHTML = ''; }, kind === 'level' ? 3400 : 2200);
  }
  radio(html: string | null) {
    const r = this.el.radio;
    if (!html) { r.classList.remove('on'); return; }
    if (r.dataset.h !== html) { r.dataset.h = html; r.innerHTML = `<div class="who"><i>M</i><b>Marta</b><small>general manager</small></div><p>${html}</p>`; }
    r.classList.add('on');
  }
  welcome(earned: number) {
    this.el.modal.innerHTML = `<div class="sheet"><h2>Welcome back</h2><p class="lead">The resort kept running while you were away. Your managers banked</p><div class="bigcash">${money(earned)}</div><div class="acts"><button data-close="1" class="primary">Collect</button></div></div>`;
    this.el.modal.classList.add('on');
  }
  get modalOpen() { return this.el.modal.classList.contains('on'); }
  setTour(on: boolean) { this.el.tour.classList.toggle('on', on); this.root.classList.toggle('touring', on); }
  setSound(on: boolean) { this.el.sound.classList.toggle('off', !on); }
}
