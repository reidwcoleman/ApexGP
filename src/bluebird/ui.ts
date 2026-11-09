// Bluebird: the HUD. Resort card, clock + weather, mode switcher, the jobs list, the upgrade shop,
// ticket pricing, the trail map, prompts, trick callouts, toasts and the end-of-day report.
import './ui.css';
import { RUNS, LIFTS, RUN_BY, LIFT_BY, DIFF_COLOR, DIFF_NAME, HALF, SIZE, GN, GS, type Mountain } from './mountain.ts';
import { UPGRADES, UP_BY, WEATHER, liftCapacity, type Cat, OPEN } from './data.ts';
import { money, type Sim, type DayStats } from './sim.ts';

export type Mode = 'manage' | 'ski' | 'cat' | 'sled';
export interface Job { id: string; kind: 'lift' | 'hurt' | 'guns' | 'groom' | 'snow'; text: string; sub: string; x: number; z: number; mode: Mode; urgent: boolean }
export interface Label { id: string; x: number; y: number; html: string; cls?: string; click?: () => void; hidden?: boolean }

const I: Record<string, string> = {
  chair: '<path d="M6 3v6M18 3v6M5 9h14l-1.5 6h-11zM7 15l-1 5M17 15l1 5" />',
  carpet: '<path d="M3 17l18-6M3 20l18-6M6 15.5v3M12 13.5v3M18 11.5v3" />',
  gondola: '<path d="M3 4l18 2M12 5v3M6 8h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 12h12" />',
  ski: '<path d="M4 20L20 4M7 21L21 7M9 12l3 3" />',
  cat: '<path d="M3 15h18v4H3zM5 15V9h8l3 6M14 9h4l2 6M2 12h3" />',
  sled: '<path d="M3 18h12l4-3M6 15l3-5h6l2 5M8 18l-1 2M15 18l1 2" />',
  manage: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />',
  lodge: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5" />',
  car: '<path d="M4 16l2-6h12l2 6v3H4zM7 19v1M17 19v1M6 13h12" />',
  school: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5" />',
  hotel: '<path d="M5 21V4h14v17M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4" />',
  lamp: '<path d="M12 22V9M8 4h8l-2 5h-4zM9 22h6" />',
  gun: '<path d="M5 21l5-9M7 9a5 5 0 1 1 7 7M14 16l6 3M15 12l6-1M13 8l4-4" />',
  wrench: '<path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z" />',
  cross: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />',
  mega: '<path d="M3 10v4h3l7 5V5L6 10zM17 8a5 5 0 0 1 0 8" />',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 18z" />',
  flake: '<path d="M12 2v20M3.5 7l17 10M3.5 17l17-10M9 4l3 2 3-2M9 20l3-2 3 2" />',
  snow: '<path d="M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 14zM8 18v.1M12 20v.1M16 18v.1M10 22v.1M14 22v.1" />',
  storm: '<path d="M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 14zM12 14l-2 4h4l-2 4" />',
  pause: '<path d="M8 5v14M16 5v14" />',
  play: '<path d="M7 4l12 8-12 8z" />',
  ff: '<path d="M3 5l9 7-9 7zM12 5l9 7-9 7z" />',
  moon: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z" />',
  x: '<path d="M6 6l12 12M18 6L6 18" />',
  star: '<path d="M12 3l2.8 5.9 6.2.8-4.6 4.4 1.2 6.2L12 17.3l-5.6 3 1.2-6.2L3 9.7l6.2-.8z" />',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />',
  ticket: '<path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3zM14 4v12" />',
  green: '<circle cx="12" cy="12" r="7" fill="#2fb65a" stroke="none"/>',
  blue: '<rect x="5" y="5" width="14" height="14" fill="#2f7fe0" stroke="none"/>',
  black: '<path d="M12 3l9 9-9 9-9-9z" fill="#1d1d22" stroke="none"/>',
  double: '<path d="M7 5l6 7-6 7-6-7zM17 5l6 7-6 7-6-7z" fill="#1d1d22" stroke="none"/>',
  park: '<rect x="4" y="4" width="16" height="16" rx="3" fill="#f08a24" stroke="none"/><path d="M8 15l3-6 2 4 1-2 2 4" stroke="#fff"/>',
};
export const icon = (k: string, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[k] ?? I.star}</svg>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fmtHour(h: number) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const ap = hh >= 12 ? 'pm' : 'am';
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}
function stars(n: number) {
  let s = '';
  for (let i = 0; i < 5; i++) { const f = Math.max(0, Math.min(1, n - i)); s += `<i style="--f:${(f * 100).toFixed(0)}%">${icon('star', 15)}</i>`; }
  return `<span class="stars">${s}</span>`;
}

export class UI {
  root: HTMLElement;
  mode: Mode = 'manage';
  tab: Cat | 'tickets' = 'lifts';
  panelOpen = true;
  onMode: (m: Mode) => void = () => {};
  onBuy: (id: string) => void = () => {};
  onSkip: () => void = () => {};
  onSpeed: (n: number) => void = () => {};
  onJob: (j: Job) => void = () => {};
  onFocus: (x: number, z: number) => void = () => {};
  onSelect: (kind: 'run' | 'lift', id: string) => void = () => {};
  onSettings: (k: string) => void = () => {};
  jobs: Job[] = [];
  private el: Record<string, HTMLElement> = {};
  private mapBg: HTMLCanvasElement | null = null;
  private mapCv!: HTMLCanvasElement;
  private toasts!: HTMLElement;
  private labelsEl!: HTMLElement;
  private labelNodes = new Map<string, HTMLElement>();
  private refreshT = 0;
  private panelKey = '';
  selected: { kind: 'run' | 'lift'; id: string } | null = null;
  markers: { x: number; z: number; kind: string }[] = [];
  you: { x: number; z: number; yaw: number } | null = null;

  constructor(root: HTMLElement, private sim: Sim, private m: Mountain) {
    this.root = root;
    root.innerHTML = `
      <div class="labels" id="u-labels"></div>
      <div class="tl card">
        <div class="rname"><span>${esc(sim.s.name)}</span><small id="u-stars"></small></div>
        <div class="cash" id="u-cash"></div>
        <div class="substats" id="u-sub"></div>
      </div>
      <div class="tc">
        <div class="clock card" id="u-clock"></div>
        <div class="toasts" id="u-toasts"></div>
      </div>
      <div class="tr">
        <canvas class="minimap card" id="u-map" width="440" height="440"></canvas>
      </div>
      <div class="modes" id="u-modes">
        ${(['manage', 'ski', 'cat', 'sled'] as Mode[]).map((k, i) => `<button data-mode="${k}" title="${['Manage', 'Ski', 'Snowcat', 'Snowmobile'][i]} (${i + 1})">${icon(k, 22)}<span>${['Manage', 'Ski', 'Snowcat', 'Sled'][i]}</span><kbd>${i + 1}</kbd></button>`).join('')}
      </div>
      <div class="jobs card" id="u-jobs"></div>
      <div class="panel card" id="u-panel"></div>
      <div class="hud" id="u-hud"></div>
      <div class="prompt" id="u-prompt"></div>
      <div class="trick" id="u-trick"></div>
      <div class="arrow" id="u-arrow"><div class="ar">${icon('play', 22)}</div><span></span></div>
      <div class="modal" id="u-modal"></div>
      <div class="mini" id="u-mini"></div>
      <div class="help" id="u-help"></div>
      <div class="radio card" id="u-radio"></div>
    `;
    for (const id of ['stars', 'cash', 'sub', 'clock', 'toasts', 'map', 'modes', 'jobs', 'panel', 'hud', 'prompt', 'trick', 'arrow', 'labels', 'modal', 'mini', 'help', 'radio']) this.el[id] = root.querySelector('#u-' + id)!;
    this.toasts = this.el.toasts;
    this.labelsEl = this.el.labels;
    this.mapCv = this.el.map as HTMLCanvasElement;
    this.el.modes.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) this.onMode(b.dataset.mode as Mode); });
    this.el.panel.addEventListener('click', (e) => this.panelClick(e));
    this.el.panel.addEventListener('input', (e) => this.panelInput(e));
    this.el.jobs.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-job]') as HTMLElement | null; if (b) { const j = this.jobs.find((q) => q.id === b.dataset.job); if (j) this.onJob(j); } });
    this.el.clock.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.sp) this.onSpeed(+b.dataset.sp);
      if (b.dataset.skip) this.onSkip();
    });
    this.mapCv.addEventListener('click', (e) => {
      const r = this.mapCv.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      this.onFocus((u - 0.5) * SIZE * 0.9, (v - 0.5) * SIZE * 0.9 + 40);
    });
    this.el.modal.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.close) this.closeModal();
      if (b.dataset.skip) { this.closeModal(); this.onSkip(); }
    });
    this.el.help.innerHTML = '';
    this.renderPanel(true);
  }

  // ------------------------------------------------------------------ modes
  setMode(m: Mode) {
    this.mode = m;
    for (const b of this.el.modes.querySelectorAll('button')) b.classList.toggle('on', (b as HTMLElement).dataset.mode === m);
    this.el.panel.style.display = m === 'manage' ? '' : 'none';
    this.labelsEl.style.display = m === 'manage' ? '' : 'none';
    this.root.classList.toggle('playing', m !== 'manage');
    const help: Record<Mode, string> = {
      manage: '<b>Drag</b> orbit · <b>Right-drag</b> pan · <b>Wheel</b> zoom · <b>WASD</b> move · click a lift or trail',
      ski: '<b>A/D</b> carve · <b>W</b> tuck · <b>S</b> brake · <b>Space</b> jump · in the air: <b>A/D</b> spin <b>W/S</b> flip <b>Shift</b> grab · <b>E</b> ride lift · <b>C</b> camera',
      cat: '<b>W/S</b> drive · <b>A/D</b> steer (turns on the spot) · <b>Q</b> tiller up/down · <b>E</b> snow gun · <b>C</b> camera',
      sled: '<b>W/S</b> throttle/brake · <b>A/D</b> steer · <b>E</b> pick up / repair / snow gun · <b>C</b> camera',
    };
    this.el.help.innerHTML = help[m];
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.15;
    const sim = this.sim, s = sim.s;
    this.el.cash.textContent = money(s.cash);
    this.el.stars.innerHTML = `${stars(s.stars)}<b>${s.stars.toFixed(1)}</b>`;
    const t = s.today;
    const income = t.tickets + t.lodge + t.rental + t.school + t.hotel + t.tips;
    const cost = t.wages + t.ops + t.snowmaking + t.fuel;
    this.el.sub.innerHTML = `<span>${icon('ski', 14)} ${Math.round(sim.onMountain).toLocaleString()} on the hill</span><span>${icon('chair', 14)} ${sim.waitMin < 1 ? 'no' : Math.round(sim.waitMin) + ' min'} wait</span><span class="${income - cost >= 0 ? 'pos' : 'neg'}">today ${income - cost >= 0 ? '+' : ''}${money(income - cost)}</span>`;
    const w = WEATHER[sim.weather];
    const ph = sim.phase;
    const status = sim.closedToday ? sim.closedReason : ph === 'open' ? `Open · ${sim.demand.toLocaleString()} expected` : ph === 'evening' ? 'Night skiing' : ph === 'prep' ? `Opens at ${fmtHour(OPEN)} · groom now` : 'Night: groom & make snow';
    const fc = s.weather.slice(1, 4).map((q, i) => `<span title="${WEATHER[q].name}">${icon(WEATHER[q].icon, 14)}<small>${['Tmrw', '+2', '+3'][i]}</small></span>`).join('');
    const sp = sim.paused ? 0 : sim.speed;
    this.el.clock.innerHTML = `
      <div class="crow"><b>${sim.dayName} · Day ${sim.day}</b><span class="time">${fmtHour(sim.hour)}</span><span class="wx">${icon(w.icon, 16)} ${w.name} · ${Math.round(sim.temp)}°C · ${Math.round(sim.s.offDepth)} cm base</span></div>
      <div class="crow small"><span class="st ${ph === 'open' || ph === 'evening' ? (sim.closedToday ? '' : 'live') : ''}">${esc(status)}</span>
        <span class="speed">${[[0, 'pause'], [1, 'play'], [3, 'ff'], [8, 'ff']].map(([n, ic]) => `<button data-sp="${n}" class="${sp === n ? 'on' : ''}" title="${n ? n + 'x' : 'Pause'}">${icon(ic as string, 13)}${n === 8 ? '<sup>8</sup>' : n === 3 ? '<sup>3</sup>' : ''}</button>`).join('')}
        ${ph === 'night' || ph === 'prep' || sim.closedToday ? `<button data-skip="1" class="skip">${icon('moon', 13)} Skip to morning</button>` : ''}</span>
        <span class="fc">${fc}</span></div>`;
    this.renderJobs();
    this.renderPanel(false);
    this.drawMap();
  }

  // ------------------------------------------------------------------ jobs
  renderJobs() {
    const html = this.jobs.length
      ? this.jobs.map((j) => `<button class="job ${j.urgent ? 'urgent' : ''}" data-job="${j.id}">${icon(j.kind === 'lift' ? 'wrench' : j.kind === 'hurt' ? 'cross' : j.kind === 'guns' ? 'gun' : j.kind === 'snow' ? 'flake' : 'cat', 18)}<div><b>${esc(j.text)}</b><small>${esc(j.sub)}</small></div><span class="go">${icon(j.mode === 'cat' ? 'cat' : j.mode === 'sled' ? 'sled' : 'ski', 14)} Go</span></button>`).join('')
      : `<div class="nojobs">${icon('sun', 16)} All quiet on the mountain</div>`;
    const key = html;
    if (this.el.jobs.dataset.k !== key) { this.el.jobs.dataset.k = key; this.el.jobs.innerHTML = `<h4>Jobs</h4>${html}`; }
  }

  // ------------------------------------------------------------------ the shop panel
  private renderPanel(force: boolean) {
    if (this.mode !== 'manage' && !force) return;
    const sim = this.sim;
    let body = '';
    if (this.selected) body = this.detail();
    else if (this.tab === 'tickets') body = this.ticketsTab();
    else {
      const ups = UPGRADES.filter((u) => u.cat === this.tab);
      body = ups.map((u) => this.card(u.id)).join('');
    }
    const tabs = (['lifts', 'runs', 'base', 'fleet', 'staff', 'tickets'] as const).map((t) => `<button data-tab="${t}" class="${!this.selected && this.tab === t ? 'on' : ''}">${{ lifts: 'Lifts', runs: 'Trails', base: 'Village', fleet: 'Fleet', staff: 'Staff', tickets: 'Tickets' }[t]}</button>`).join('');
    const key = tabs + body + sim.s.cash.toFixed(0).slice(0, -2);
    if (!force && key === this.panelKey) return;
    // don't rebuild under a dragging slider
    if (!force && document.activeElement && (document.activeElement as HTMLElement).id === 'u-price') { this.updateTicketNumbers(); return; }
    this.panelKey = key;
    this.el.panel.innerHTML = `<div class="tabs">${tabs}</div><div class="pbody">${body}</div>`;
  }

  private card(id: string) {
    const st = this.sim.upgradeState(id);
    const u = st.u;
    let ic = u.icon;
    if (u.cat === 'lifts') ic = LIFT_BY[id.slice(5)].kind === 'chair' ? 'chair' : LIFT_BY[id.slice(5)].kind;
    const pips = u.max > 1 ? `<span class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < st.lv ? 'on' : ''}"></i>`).join('')}</span>` : '';
    const lvName = u.levels && st.lv ? `<small class="lvn">${esc(u.levels[st.lv])}</small>` : '';
    let btn = '';
    if (st.maxed) btn = `<span class="maxed">${st.lv ? 'Done' : ''}</span>`;
    else if (st.lock) btn = `<span class="lock">${esc(st.lock)}</span>`;
    else btn = `<button class="buy ${st.afford ? '' : 'no'}" data-buy="${id}">${st.lv ? 'Upgrade' : 'Buy'} ${money(st.cost)}</button>`;
    const extra = id.startsWith('run.') || id.startsWith('guns.') ? '' : '';
    return `<div class="up ${st.lock ? 'locked' : ''} ${st.maxed ? 'max' : ''}"><div class="uic">${icon(ic, 22)}</div><div class="ut"><b>${esc(u.name)}</b>${lvName}${pips}<p>${esc(u.blurb(st.lv))}</p>${extra}</div><div class="ub">${btn}</div></div>`;
  }

  private ticketsTab() {
    const sim = this.sim, s = sim.s;
    const d = sim.previewDemand(s.price);
    const best = [19, 29, 39, 49, 59, 69, 79, 89, 99, 119, 139, 159, 189, 219, 249].map((p) => ({ p, rev: sim.previewDemand(p) * p })).sort((a, b) => b.rev - a.rev)[0];
    return `<div class="tix">
      <h3>${icon('ticket', 18)} Day ticket</h3>
      <div class="pricebig" id="u-pv">$${s.price}</div>
      <input type="range" id="u-price" min="15" max="249" step="1" value="${s.price}">
      <div class="tixrow"><span>Visitors at this price</span><b id="u-pd">${d.toLocaleString()}</b></div>
      <div class="tixrow"><span>Ticket revenue</span><b id="u-pr">${money(d * s.price)}</b></div>
      <div class="tixrow"><span>Fair price for a ${s.stars.toFixed(1)}★ hill</span><b>~$${Math.round(sim.fair)}</b></div>
      <div class="tixrow"><span>Best-earning price now</span><b>$${best.p}</b></div>
      <p class="note">Night tickets sell at 60%. Price changes count from tomorrow's crowd; today's visitors already bought theirs. More stars, trails and a better lodge raise the price people will pay.</p>
    </div>`;
  }
  private updateTicketNumbers() {
    const sim = this.sim;
    const p = sim.s.price;
    const d = sim.previewDemand(p);
    const q = (id: string) => this.el.panel.querySelector('#' + id) as HTMLElement | null;
    q('u-pv') && (q('u-pv')!.textContent = '$' + p);
    q('u-pd') && (q('u-pd')!.textContent = d.toLocaleString());
    q('u-pr') && (q('u-pr')!.textContent = money(d * p));
  }

  private detail() {
    const sim = this.sim;
    const sel = this.selected!;
    if (sel.kind === 'run') {
      const r = RUN_BY[sel.id];
      const built = sim.runBuilt(r.id);
      const q = sim.runQ[r.id] ?? 0, d = sim.runDepth[r.id] ?? 0, g = sim.runGroom[r.id] ?? 0;
      const [b, s, gold] = sim.par(r.id);
      const medal = sim.s.medals[r.id] ?? 0;
      const best = sim.s.best[r.id];
      const len = Math.round(this.m.runOf[r.id].len);
      const drop = Math.round(this.m.runOf[r.id].h[0] - this.m.runOf[r.id].h[this.m.runOf[r.id].h.length - 1]);
      return `<div class="det"><button class="back" data-back="1">${icon('x', 14)}</button>
        <h3>${icon(r.diff, 20)} ${esc(r.name)}</h3><p class="dsub">${DIFF_NAME[r.diff]} · ${len} m long · ${drop} m drop${r.lit ? ' · lit at night' : ''}</p>
        ${built ? `<div class="bars">
          <div><span>Snow quality</span><i><b style="width:${q * 100}%;background:${q > 0.7 ? 'var(--green)' : q > 0.45 ? 'var(--gold)' : 'var(--red)'}"></b></i><em>${Math.round(q * 100)}%</em></div>
          <div><span>Groomed</span><i><b style="width:${g * 100}%"></b></i><em>${Math.round(g * 100)}%</em></div>
          <div><span>Base depth</span><i><b style="width:${Math.min(100, d / 1.5)}%;background:#9fc3e8"></b></i><em>${Math.round(d)} cm</em></div>
        </div>
        <p class="note">${d < 22 ? 'Too thin to open: make snow here on a cold night.' : q < 0.5 ? 'Skied off and bumpy. Groom it tonight.' : 'Skiing well.'} ${Math.round(sim.onRun[r.id] ?? 0)} skiers on it now.</p>
        <div class="medals"><span>Race it yourself:</span>${['Bronze', 'Silver', 'Gold'].map((n, i) => `<b class="${medal > i ? 'got' : ''} m${i}">${n} ${[b, s, gold][i].toFixed(0)}s</b>`).join('')}${best ? `<small>Best ${best.toFixed(1)}s</small>` : ''}</div>` : ''}
        ${r.cost ? this.card('run.' + r.id) : ''}${this.card('guns.' + r.id)}</div>`;
    }
    const l = LIFT_BY[sel.id];
    const lv = sim.lv('lift.' + l.id);
    const cap = Math.round(liftCapacity(l.kind, lv));
    const broken = sim.broken[l.id] !== undefined;
    const runs = RUNS.filter((r) => r.from === l.to);
    return `<div class="det"><button class="back" data-back="1">${icon('x', 14)}</button>
      <h3>${icon(l.kind === 'chair' ? 'chair' : l.kind, 20)} ${esc(l.name)}</h3><p class="dsub">${lv ? `${cap.toLocaleString()} riders an hour` : 'Not built yet'}${broken ? ' · <b class="neg">BROKEN DOWN</b>' : ''}</p>
      ${this.card('lift.' + l.id)}
      <p class="note">Serves: ${runs.map((r) => `${icon(r.diff, 12)} ${esc(r.name)}`).join(' · ')}</p></div>`;
  }

  private panelClick(e: Event) {
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-tab]') as HTMLElement | null;
    if (tab) { this.tab = tab.dataset.tab as any; this.selected = null; this.renderPanel(true); return; }
    const buy = t.closest('[data-buy]') as HTMLElement | null;
    if (buy) { this.onBuy(buy.dataset.buy!); this.renderPanel(true); return; }
    if (t.closest('[data-back]')) { this.selected = null; this.renderPanel(true); }
  }
  private panelInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.id === 'u-price') { this.sim.s.price = +t.value; this.sim.planDayKeep(); this.updateTicketNumbers(); }
  }
  select(kind: 'run' | 'lift', id: string) { this.selected = { kind, id }; this.renderPanel(true); }

  // ------------------------------------------------------------------ trail map
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
        const steep = Math.hypot(hx, hz) / 6 > 0.75;
        let r = 246, gg = 249, b = 253;
        if (forest) { const n = ((x * 7 + y * 13) % 5) * 3; r = 168 - n; gg = 196 - n; b = 186 - n; }
        else if (steep && !onRun) { r = 200; gg = 204; b = 212; }
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
    for (const r of RUNS) {
      const p = this.m.runOf[r.id];
      const built = sim.runBuilt(r.id);
      const path = () => { g.beginPath(); for (let i = 0; i < p.x.length; i += 6) { const [X, Y] = this.toMap(p.x[i], p.z[i]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } };
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (built) {
        g.globalAlpha = 1; g.setLineDash([]);
        path(); g.strokeStyle = '#fff'; g.lineWidth = 9; g.stroke();
        path(); g.strokeStyle = DIFF_COLOR[r.diff]; g.globalAlpha = sim.runOpen(r.id) ? 1 : 0.45; g.lineWidth = 5.5; g.stroke();
      } else {
        path(); g.strokeStyle = DIFF_COLOR[r.diff]; g.globalAlpha = 0.35; g.lineWidth = 2.5; g.setLineDash([2, 7]); g.stroke();
      }
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    for (const l of LIFTS) {
      const built = sim.liftBuilt(l.id);
      const [ax, ay] = this.toMap(l.a[0], l.a[1]), [bx, by] = this.toMap(l.b[0], l.b[1]);
      g.strokeStyle = sim.broken[l.id] !== undefined ? '#d2453a' : '#1d2433';
      g.globalAlpha = built ? 1 : 0.25;
      g.lineWidth = 2;
      g.setLineDash(built ? [] : [3, 4]);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.fillStyle = g.strokeStyle;
      g.beginPath(); g.arc(ax, ay, 3.5, 0, 7); g.arc(bx, by, 3.5, 0, 7); g.fill();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    for (const mk of this.markers) {
      const [X, Y] = this.toMap(mk.x, mk.z);
      const t = performance.now() / 300;
      if (mk.kind === 'hurt') { g.fillStyle = '#d2453a'; g.beginPath(); g.arc(X, Y, 6 + Math.sin(t) * 2, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(X - 3.5, Y - 1, 7, 2); g.fillRect(X - 1, Y - 3.5, 2, 7); }
      else if (mk.kind === 'gunOn') { g.fillStyle = '#3dff7a'; g.beginPath(); g.arc(X, Y, 2.5, 0, 7); g.fill(); }
      else if (mk.kind === 'gun') { g.fillStyle = '#e2a33a'; g.beginPath(); g.arc(X, Y, 2.2, 0, 7); g.fill(); }
      else if (mk.kind === 'cat') { g.fillStyle = '#d2453a'; g.fillRect(X - 3, Y - 3, 6, 6); }
      else if (mk.kind === 'sled') { g.fillStyle = '#2f7fe0'; g.fillRect(X - 2.5, Y - 2.5, 5, 5); }
      else if (mk.kind === 'target') { g.strokeStyle = '#f2b33d'; g.lineWidth = 2.5; g.beginPath(); g.arc(X, Y, 9 + Math.sin(t * 2) * 2, 0, 7); g.stroke(); }
    }
    if (this.you) {
      const [X, Y] = this.toMap(this.you.x, this.you.z);
      g.save(); g.translate(X, Y); g.rotate(-this.you.yaw + Math.PI);
      g.fillStyle = '#ffcf3f'; g.strokeStyle = '#1d2433'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
      g.restore();
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
        n.className = 'lbl';
        if (L.click) { const c = L.click; n.addEventListener('click', (e) => { e.stopPropagation(); c(); }); n.classList.add('clk'); }
        this.labelsEl.appendChild(n);
        this.labelNodes.set(L.id, n);
      }
      if (n.dataset.h !== L.html) { n.dataset.h = L.html; n.innerHTML = L.html; }
      n.className = 'lbl ' + (L.cls ?? '') + (L.click ? ' clk' : '');
      n.style.display = L.hidden ? 'none' : '';
      n.style.transform = `translate(${L.x.toFixed(0)}px, ${L.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
    for (const [id, n] of this.labelNodes) if (!seen.has(id)) { n.remove(); this.labelNodes.delete(id); }
  }

  floatCash(x: number, y: number, amount: number) {
    const n = document.createElement('div');
    n.className = 'fcash';
    n.textContent = '+' + money(amount);
    n.style.left = x + 'px'; n.style.top = y + 'px';
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 1400);
  }

  // ------------------------------------------------------------------ prompts, hud, tricks, toasts
  prompt(html: string | null) {
    const p = this.el.prompt;
    if (!html) { p.classList.remove('on'); return; }
    if (p.dataset.h !== html) { p.dataset.h = html; p.innerHTML = html; }
    p.classList.add('on');
  }
  hud(html: string) { if (this.el.hud.dataset.h !== html) { this.el.hud.dataset.h = html; this.el.hud.innerHTML = html; } }
  trick(name: string, score: number, clean: boolean) {
    const t = this.el.trick;
    t.innerHTML = clean ? `<b>${esc(name)}</b><span>+${score.toLocaleString()} style</span>` : `<b class="bail">${esc(name)}</b><span>bailed</span>`;
    t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  }
  arrow(on: boolean, angle = 0, dist = 0, label = '') {
    const a = this.el.arrow;
    a.style.display = on ? '' : 'none';
    if (!on) return;
    (a.querySelector('.ar') as HTMLElement).style.transform = `rotate(${(angle * 180) / Math.PI - 90}deg)`;
    a.querySelector('span')!.textContent = `${label} · ${Math.round(dist)} m`;
  }
  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info') {
    const n = document.createElement('div');
    n.className = 'toast ' + tone;
    n.innerHTML = esc(text);
    this.toasts.appendChild(n);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => n.classList.add('out'), 4800);
    setTimeout(() => n.remove(), 5400);
  }
  radio(html: string | null) {
    const r = this.el.radio;
    if (!html) { r.classList.remove('on'); return; }
    if (r.dataset.h !== html) { r.dataset.h = html; r.innerHTML = `<div class="who"><i>M</i><b>Marta</b><small>mountain manager</small></div><p>${html}</p>`; }
    r.classList.add('on');
  }
  mini(html: string | null) {
    const m = this.el.mini;
    if (!html) { m.classList.remove('on'); return; }
    m.innerHTML = html;
    m.classList.add('on');
  }

  // ------------------------------------------------------------------ the day report
  summary(day: number, t: DayStats, starsNow: number, profit: number, nextW: string) {
    const income = t.tickets + t.lodge + t.rental + t.school + t.hotel + t.tips;
    const rows = [
      ['Lift tickets', t.tickets], ['Lodge food & drink', t.lodge], ['Ski rentals', t.rental], ['Ski school', t.school], ['Hotel', t.hotel], ['Tips, rescues & medals', t.tips],
    ].filter((r) => (r[1] as number) > 0.5);
    const costs = [['Wages', t.wages], ['Lift power', t.ops], ['Snowmaking', t.snowmaking], ['Diesel', t.fuel]].filter((r) => (r[1] as number) > 0.5);
    const dStar = starsNow - t.starsStart;
    this.el.modal.innerHTML = `<div class="sheet">
      <h2>Day ${day} wrap-up</h2>
      <div class="big3"><div><small>Visitors</small><b>${Math.round(t.visitors + t.night).toLocaleString()}</b></div><div><small>Profit</small><b class="${profit >= 0 ? 'pos' : 'neg'}">${profit >= 0 ? '+' : ''}${money(profit)}</b></div><div><small>Rating</small><b>${starsNow.toFixed(2)}★ <em class="${dStar >= 0 ? 'pos' : 'neg'}">${dStar >= 0 ? '+' : ''}${dStar.toFixed(2)}</em></b></div></div>
      <div class="cols"><div><h4>Money in · ${money(income)}</h4>${rows.map(([n, v]) => `<p><span>${n}</span><b>${money(v as number)}</b></p>`).join('')}</div>
      <div><h4>Money out · ${money(costs.reduce((a, b) => a + (b[1] as number), 0))}</h4>${costs.map(([n, v]) => `<p><span>${n}</span><b>${money(v as number)}</b></p>`).join('')}
      <h4>Your shift</h4><p><span>Snow groomed</span><b>${Math.round(t.groomed).toLocaleString()} m²</b></p><p><span>Skiers rescued</span><b>${t.rescues}</b></p><p><span>Lifts fixed</span><b>${t.repairs}</b></p></div></div>
      <p class="note">Tomorrow: ${esc(nextW)}. Tonight is for grooming and snow guns, or a few runs under the stars.</p>
      <div class="acts"><button data-close="1">Keep working tonight</button><button data-skip="1" class="primary">${icon('moon', 16)} Sleep until morning</button></div>
    </div>`;
    this.el.modal.classList.add('on');
  }
  welcome(earned: number) {
    this.el.modal.innerHTML = `<div class="sheet small"><h2>Welcome back</h2><p class="lead">Your managers kept the lodge open while you were away and banked <b class="pos">${money(earned)}</b>.</p><div class="acts"><button data-close="1" class="primary">Back to the mountain</button></div></div>`;
    this.el.modal.classList.add('on');
  }
  closeModal() { this.el.modal.classList.remove('on'); }
  get modalOpen() { return this.el.modal.classList.contains('on'); }
}
