import { SHOW } from './courses.ts';
/** The show's screens and HUD (DOM over the canvas). */

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const css = (n: number) => '#' + n.toString(16).padStart(6, '0');
export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};

export interface Row {
  name: string;
  color: number;
  state: 'q' | 'out' | 'win' | 'live';
  me: boolean;
  /** a bot's racing style */
  style?: string;
  note?: string;
}

export class UI {
  private menuEl: HTMLElement;
  private cardEl: HTMLElement;
  private countEl: HTMLElement;
  private bannerEl: HTMLElement;
  private hudEl: HTMLElement;
  private resultsEl: HTMLElement;
  private pauseEl: HTMLElement;
  private lobbyEl: HTMLElement;
  private noteEl: HTMLElement;
  private noteT = 0;
  private tagsEl: HTMLElement;
  private tags = new Map<number, HTMLElement>();
  private progEl: HTMLElement;
  private dots = new Map<number, HTMLElement>();
  private bannerT = 0;
  touch: { x: number; y: number; jump: boolean; dash: boolean; grab: boolean } | null = null;

  constructor(private root: HTMLElement) {
    this.tagsEl = this.layer('mm-tags');
    this.hudEl = this.layer('mm-hud mm-hide');
    this.hudEl.innerHTML = `
      <div class="mm-pos"></div>
      <div class="top"><div class="mm-pill" data-k="title"></div><div class="mm-pill yel" data-k="status"></div><div class="mm-pill hot mm-hide" data-k="timer"></div></div>
      <div class="mm-spec mm-hide"></div>
      <div class="mm-prog"><div class="flag"></div></div>
      <div class="mm-dash"><span>DIVE</span></div>
      <div class="mm-keys"><b>WASD</b> run &nbsp; <b>SPACE</b> jump &nbsp; <b>SHIFT</b> dive &nbsp; <b>E</b> grab &nbsp; <b>ESC</b> pause</div>`;
    this.progEl = this.hudEl.querySelector('.mm-prog') as HTMLElement;
    this.cardEl = this.layer('mm-card mm-hide');
    this.countEl = this.layer('mm-count mm-hide');
    this.bannerEl = this.layer('mm-banner mm-hide');
    this.menuEl = this.layer('mm-menu mm-hide');
    this.resultsEl = this.layer('mm-results mm-hide');
    this.pauseEl = this.layer('mm-pause mm-hide');
    this.lobbyEl = this.layer('mm-lobby mm-hide');
    this.noteEl = this.layer('mm-note mm-hide');
    if (matchMedia('(pointer: coarse)').matches) this.touchControls();
  }

  private layer(cls: string) {
    const e = h('div', 'mm-layer ' + cls);
    this.root.appendChild(e);
    return e;
  }

  // ------------------------------------------------------------------ menu
  menu(o: {
    design: string;
    kind: string;
    onPrev(): void;
    onNext(): void;
    onPlay(): void;
    onHost(): void;
    onJoin(code: string): void;
    name: string;
    onName(n: string): void;
    levels: { id: string; name: string; blurb: string }[];
    level: string;
    onLevel(id: string): void;
  }) {
    const m = this.menuEl;
    m.innerHTML = `
      <a class="mm-back" href="./">&#8592; All games</a>
      <div>
        <div class="mm-title">Wobble<span>Mania</span></div>
        <div class="mm-tag">24 jelly beans. ${SHOW.length} rounds. 1 crown.</div>
        <div class="mm-show">${SHOW.map((x, i) => `<i>${x.kind === 'final' ? 'Final' : i + 1} · ${x.name}</i>`).join('')}</div>
        <div class="mm-picker">
          <button class="mm-arrow" data-a="prev" aria-label="Previous outfit">&#8249;</button>
          <div class="mm-dname"></div>
          <button class="mm-arrow" data-a="next" aria-label="Next outfit">&#8250;</button>
        </div>
        <label class="mm-name"><span>NAME</span><input maxlength="14" spellcheck="false" autocomplete="off" value="${esc(o.name)}" placeholder="Your name" aria-label="Your name"></label>
        <div class="mm-level">
          <span class="mm-level-k">BOTS</span>
          <div class="mm-seg" role="radiogroup" aria-label="Bot difficulty">${o.levels.map((l) => `<button role="radio" data-l="${l.id}" class="${l.id}">${esc(l.name)}</button>`).join('')}</div>
          <div class="mm-level-b"></div>
        </div>
        <div class="mm-actions">
          <button class="mm-btn" data-a="play">PLAY</button>
          <button class="mm-btn pink" data-a="host">HOST PARTY</button>
          <span class="mm-join"><input maxlength="4" placeholder="CODE" spellcheck="false" autocomplete="off" aria-label="Party code"><button class="mm-btn alt" data-a="join">JOIN</button></span>
        </div>
        <div class="mm-help">
          <b>WASD / Arrows</b><span>run</span>
          <b>Space</b><span>jump</span>
          <b>Shift</b><span>dive (and bowl the others over)</span>
          <b>E (hold)</b><span>grab whoever is in front of you</span>
          <b>Drag</b><span>look around &nbsp;·&nbsp; <b>M</b> music</span>
        </div>
      </div><div></div>`;
    m.querySelector('[data-a=prev]')!.addEventListener('click', o.onPrev);
    m.querySelector('[data-a=next]')!.addEventListener('click', o.onNext);
    m.querySelector('[data-a=play]')!.addEventListener('click', o.onPlay);
    m.querySelector('[data-a=host]')!.addEventListener('click', o.onHost);
    const code = m.querySelector('.mm-join input') as HTMLInputElement;
    const join = () => {
      const c = code.value.trim().toUpperCase();
      if (c.length === 4) o.onJoin(c);
      else {
        code.focus();
        this.note('Type the 4-letter party code first');
      }
    };
    m.querySelector('[data-a=join]')!.addEventListener('click', join);
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    code.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') join();
    });
    const name = m.querySelector('.mm-name input') as HTMLInputElement;
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('input', () => o.onName(name.value.trim()));
    const pick = (id: string) => {
      for (const b of m.querySelectorAll<HTMLButtonElement>('.mm-seg button')) b.setAttribute('aria-checked', String(b.dataset.l === id));
      const l = o.levels.find((x) => x.id === id);
      m.querySelector('.mm-level-b')!.textContent = l?.blurb ?? '';
    };
    for (const b of m.querySelectorAll<HTMLButtonElement>('.mm-seg button'))
      b.addEventListener('click', () => {
        pick(b.dataset.l!);
        o.onLevel(b.dataset.l!);
      });
    pick(o.level);
    this.design(o.design, o.kind);
    m.classList.remove('mm-hide');
  }

  // ------------------------------------------------------------------ the party lobby
  lobby(o: { code: string; host: boolean; members: { name: string; color: number; me: boolean; host: boolean }[]; max: number; status?: string; inShow?: boolean; onStart(): void; onLeave(): void }) {
    const l = this.lobbyEl;
    const list = o.members.map((x) => `<div class="${x.me ? 'me' : ''}"><i style="background:${css(x.color)}"></i>${esc(x.name)}${x.host ? '<em>HOST</em>' : ''}</div>`).join('');
    const bots = 24 - o.members.length;
    l.innerHTML = `<div class="panel">
      <div class="k">PARTY CODE</div>
      <div class="code">${esc(o.code || '····')}</div>
      <div class="hint">${o.host ? 'Friends join from the menu with this code' : esc(o.status ?? 'Waiting for the host to start the show')}</div>
      <div class="mm-grid">${list}</div>
      <div class="hint">${o.members.length} / ${o.max} players${bots > 0 ? ` · ${bots} bots fill the show` : ''}</div>
      <div class="row">${o.host ? `<button class="mm-btn" data-a="start" ${o.code ? '' : 'disabled'}>START SHOW</button>` : ''}<button class="mm-btn alt" data-a="leave">LEAVE</button></div>
    </div>`;
    l.querySelector('[data-a=start]')?.addEventListener('click', o.onStart);
    l.querySelector('[data-a=leave]')!.addEventListener('click', o.onLeave);
    l.classList.remove('mm-hide');
  }
  hideLobby() {
    this.lobbyEl.classList.add('mm-hide');
  }
  /** a short message at the top of the screen */
  note(text: string, ms = 3500) {
    this.noteEl.innerHTML = `<div>${esc(text)}</div>`;
    this.noteEl.classList.remove('mm-hide');
    clearTimeout(this.noteT);
    this.noteT = window.setTimeout(() => this.noteEl.classList.add('mm-hide'), ms);
  }
  design(name: string, kind: string) {
    const d = this.menuEl.querySelector('.mm-dname');
    if (d) d.innerHTML = `${esc(name)}<small>${esc(kind)}</small>`;
  }
  hideMenu() {
    this.menuEl.classList.add('mm-hide');
  }

  // ------------------------------------------------------------------ round card, countdown, banner
  card(o: { n: number; total: number; name: string; kind: string; goal: string; blurb: string }) {
    this.cardEl.innerHTML = `<div class="box">
      <div class="rn">${o.n === o.total ? 'The Final' : `Round ${o.n} of ${o.total}`}</div>
      <div class="nm">${esc(o.name)}</div>
      <div class="kind">${esc(o.kind)}</div>
      <div class="goal">${esc(o.goal)}</div>
      <div class="blurb">${esc(o.blurb)}</div>
      <div class="skip">SPACE / TAP TO SKIP</div></div>`;
    this.cardEl.classList.remove('mm-hide');
  }
  hideCard() {
    this.cardEl.classList.add('mm-hide');
  }
  count(text: string) {
    this.countEl.innerHTML = `<b class="${text === 'GO!' ? 'go' : ''}">${text}</b>`;
    this.countEl.classList.remove('mm-hide');
    clearTimeout(this.bannerT);
    if (text === 'GO!') this.bannerT = window.setTimeout(() => this.countEl.classList.add('mm-hide'), 900);
  }
  banner(text: string, tone: 'good' | 'bad' | 'gold', sub = '', ms = 2600) {
    this.bannerEl.className = 'mm-layer mm-banner ' + tone;
    this.bannerEl.innerHTML = `<div class="box"><b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    clearTimeout(this.bannerT);
    if (ms > 0) this.bannerT = window.setTimeout(() => this.bannerEl.classList.add('mm-hide'), ms);
  }
  hideBanner() {
    this.bannerEl.classList.add('mm-hide');
    this.countEl.classList.add('mm-hide');
  }

  // ------------------------------------------------------------------ HUD
  hud(show: boolean) {
    this.hudEl.classList.toggle('mm-hide', !show);
    this.tagsEl.classList.toggle('mm-hide', !show);
  }
  hudData(o: { title: string; status: string; pos?: number; total?: number; posNote?: string; timer?: string; dash: number; spectate?: string; race: boolean; keys: boolean }) {
    const q = (k: string) => this.hudEl.querySelector(`[data-k=${k}]`) as HTMLElement;
    q('title').textContent = o.title;
    q('status').textContent = o.status;
    const tm = q('timer');
    tm.classList.toggle('mm-hide', !o.timer);
    if (o.timer) tm.textContent = o.timer;
    const pos = this.hudEl.querySelector('.mm-pos') as HTMLElement;
    pos.innerHTML = o.pos ? `${o.pos}<sup>${ordinal(o.pos)}</sup><small>${o.posNote ?? `of ${o.total}`}</small>` : '';
    (this.hudEl.querySelector('.mm-dash') as HTMLElement).style.setProperty('--k', String(o.dash));
    const sp = this.hudEl.querySelector('.mm-spec') as HTMLElement;
    sp.classList.toggle('mm-hide', !o.spectate);
    if (o.spectate) sp.textContent = o.spectate;
    this.progEl.classList.toggle('mm-hide', !o.race);
    (this.hudEl.querySelector('.mm-keys') as HTMLElement).classList.toggle('mm-hide', !o.keys);
  }
  /** the race bar: a dot per marble at its share of the course */
  progress(list: { id: number; f: number; color: number; me: boolean; out: boolean }[]) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let d = this.dots.get(p.id);
      if (!d) {
        d = h('i', p.me ? 'me' : '');
        d.style.background = css(p.color);
        this.progEl.appendChild(d);
        this.dots.set(p.id, d);
      }
      d.style.left = `${Math.max(0, Math.min(1, p.f)) * 100}%`;
      d.style.opacity = p.out ? '0.25' : '1';
    }
    for (const [id, d] of this.dots) if (!seen.has(id)) {
      d.remove();
      this.dots.delete(id);
    }
  }

  tag(id: number, name: string, x: number, y: number, show: boolean, me: boolean, human = false) {
    let e = this.tags.get(id);
    if (!e) {
      e = h('div', me ? 'me' : human ? 'pal' : '');
      e.textContent = name;
      this.tagsEl.appendChild(e);
      this.tags.set(id, e);
    }
    if (!show) {
      if (e.style.display !== 'none') e.style.display = 'none';
      return;
    }
    if (e.style.display === 'none') e.style.display = '';
    e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
  clearTags() {
    for (const e of this.tags.values()) e.remove();
    this.tags.clear();
    for (const d of this.dots.values()) d.remove();
    this.dots.clear();
  }

  // ------------------------------------------------------------------ results, champion
  results(o: { title: string; sub: string; rows: Row[]; next: string; onNext(): void; extra?: { label: string; on(): void }; auto?: number; wait?: boolean }) {
    const r = this.resultsEl;
    const rows = o.rows
      .map(
        (x, k) =>
          `<div class="${x.state === 'out' ? 'out' : ''} ${x.me ? 'me' : ''} ${x.state === 'win' ? 'win' : ''}" style="animation-delay:${Math.min(k * 0.025, 0.6)}s"><i style="background:${css(x.color)}"></i>${esc(x.name)}${x.style ? `<small>${esc(x.style)}</small>` : ''}<em>${esc(x.note ?? (x.state === 'q' ? 'IN' : x.state === 'win' ? 'CROWN' : x.state === 'out' ? 'OUT' : ''))}</em></div>`,
      )
      .join('');
    r.innerHTML = `<div class="panel"><h2>${esc(o.title)}</h2><div class="sub">${esc(o.sub)}</div><div class="mm-grid">${rows}</div>
      <div class="row"><button class="mm-btn" data-a="next" ${o.wait ? 'disabled' : ''}>${esc(o.next)}</button>${o.extra ? `<button class="mm-btn alt" data-a="extra">${esc(o.extra.label)}</button>` : ''}</div>
      ${o.auto ? `<div class="mm-auto">Continuing in <span>${o.auto}</span>…</div>` : ''}</div>`;
    r.querySelector('[data-a=next]')!.addEventListener('click', o.onNext);
    if (o.extra) r.querySelector('[data-a=extra]')!.addEventListener('click', o.extra.on);
    r.classList.remove('mm-hide');
  }
  autoCount(n: number) {
    const s = this.resultsEl.querySelector('.mm-auto span');
    if (s) s.textContent = String(Math.max(0, Math.ceil(n)));
  }
  hideResults() {
    this.resultsEl.classList.add('mm-hide');
  }

  pause(show: boolean, o?: { onResume(): void; onMusic(): void; onQuit(): void; music: boolean; online?: boolean }) {
    this.pauseEl.classList.toggle('mm-hide', !show);
    if (!show || !o) return;
    this.pauseEl.innerHTML = `<div class="panel"><h2>${o.online ? 'Menu' : 'Paused'}</h2>
      ${o.online ? '<div class="hint">The show goes on while you look</div>' : ''}
      <button class="mm-btn" data-a="r">RESUME</button>
      <button class="mm-btn alt" data-a="m">MUSIC: ${o.music ? 'ON' : 'OFF'}</button>
      <button class="mm-btn alt" data-a="q">${o.online ? 'LEAVE PARTY' : 'QUIT SHOW'}</button></div>`;
    this.pauseEl.querySelector('[data-a=r]')!.addEventListener('click', o.onResume);
    this.pauseEl.querySelector('[data-a=m]')!.addEventListener('click', o.onMusic);
    this.pauseEl.querySelector('[data-a=q]')!.addEventListener('click', o.onQuit);
  }

  // ------------------------------------------------------------------ touch
  private touchControls() {
    const t: { x: number; y: number; jump: boolean; dash: boolean; grab: boolean } = { x: 0, y: 0, jump: false, dash: false, grab: false };
    this.touch = t;
    const layer = this.layer('mm-touch');
    const stick = h('div', 'mm-stick');
    const knob = h('i');
    stick.appendChild(knob);
    layer.appendChild(stick);
    let id = -1;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y);
      if (l > 1) (x /= l), (y /= l);
      t.x = x;
      t.y = -y;
      knob.style.transform = `translate(${x * 44}px, ${y * 44}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      stick.setPointerCapture(id);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const up = () => {
      id = -1;
      t.x = t.y = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', up);
    stick.addEventListener('pointercancel', up);
    for (const [cls, label, k] of [['j', 'JUMP', 'jump'], ['d', 'DIVE', 'dash'], ['g', 'GRAB', 'grab']] as const) {
      const b = h('button', 'mm-tbtn ' + cls, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        t[k] = true;
      });
      // (grab is held)
      if (k === 'grab') for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => (t.grab = false));
      layer.appendChild(b);
    }
  }
}
