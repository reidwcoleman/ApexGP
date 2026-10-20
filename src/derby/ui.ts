/** Marble Derby's screens: the race card and bet slip, the live board, the result and the payout. */

export interface CardRow {
  no: number;
  name: string;
  color: number;
  color2: number;
  style: string;
  stars: number;
  form: string;
  record: string;
  win: string;
  top3: string;
  mine: { kind: 'win' | 'top3'; stake: number }[];
}
export interface BetView {
  id: number;
  no: number;
  name: string;
  color: number;
  kind: 'win' | 'top3';
  stake: number;
  price: string;
  ret: number;
}
export interface LiveRow {
  no: number;
  name: string;
  color: number;
  gap: string;
  fin: number;
  fell: boolean;
  mine: ('win' | 'top3')[];
  follow: boolean;
}

interface Handlers {
  onChip(v: number): void;
  onBet(i: number, kind: 'win' | 'top3'): void;
  onUnbet(id: number): void;
  onClear(): void;
  onStart(): void;
  onHover(i: number): void;
  onFollow(i: number): void;
  onNext(): void;
  onBailout(): void;
  onSound(): boolean;
}

const CHIPS = [10, 50, 100, 250, 1000];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const coins = (n: number) => Math.floor(n).toLocaleString('en-US');
const ball = (c: number, c2 = 0xffffff) => `<i class="dy-ball" style="--a:${css(c)};--b:${css(c2)}"></i>`;

export class DerbyUI {
  private root: HTMLElement;
  private top: HTMLElement;
  private cardEl: HTMLElement;
  private liveEl: HTMLElement;
  private capEl: HTMLElement;
  private countEl: HTMLElement;
  private bannerEl: HTMLElement;
  private resEl: HTMLElement;
  private toastEl: HTMLElement;
  private purseEl: HTMLElement;
  private toastT = 0;
  private capT = 0;
  private bannerT = 0;
  private liveKey = '';

  constructor(
    host: HTMLElement,
    private h: Handlers,
  ) {
    const root = (this.root = document.createElement('div'));
    root.className = 'dy';
    host.appendChild(root);
    const el = (cls: string, tag = 'div') => {
      const e = document.createElement(tag);
      e.className = cls;
      root.appendChild(e);
      return e;
    };
    this.top = el('dy-top');
    this.top.innerHTML = `
      <a class="dy-back" href="./">&#8592; All games</a>
      <div class="dy-logo"><b>Marble</b><span>Derby</span></div>
      <div class="dy-race"></div>
      <div class="dy-right">
        <button class="dy-snd" aria-label="Music on or off">&#9835;</button>
        <div class="dy-purse"><i class="dy-coin"></i><b>0</b></div>
      </div>`;
    this.purseEl = this.top.querySelector('.dy-purse b')!;
    this.top.querySelector('.dy-snd')!.addEventListener('click', (e) => {
      const on = this.h.onSound();
      (e.currentTarget as HTMLElement).classList.toggle('off', !on);
    });
    this.cardEl = el('dy-card dy-hide');
    this.liveEl = el('dy-live dy-hide');
    this.capEl = el('dy-cap dy-hide');
    this.countEl = el('dy-count dy-hide');
    this.bannerEl = el('dy-banner dy-hide');
    this.resEl = el('dy-res dy-hide');
    this.toastEl = el('dy-toast dy-hide');
  }

  // ------------------------------------------------------------------------------------- the race card
  lobby(on: boolean) {
    this.cardEl.classList.toggle('dy-hide', !on);
    if (on) {
      this.capEl.classList.add('dy-hide');
      this.bannerEl.classList.add('dy-hide');
    }
  }

  card(o: { race: number; track: string; blurb: string; coins: number; stake: number; rows: CardRow[]; bets: BetView[]; broke: boolean }) {
    this.purseEl.textContent = coins(o.coins);
    this.top.querySelector('.dy-race')!.innerHTML = `<small>Race ${o.race}</small>${esc(o.track)}`;
    const staked = o.bets.reduce((a, b) => a + b.stake, 0);
    const best = o.bets.reduce((a, b) => a + b.ret, 0);
    const scroll = this.cardEl.querySelector('.dy-rows')?.scrollTop ?? 0;
    this.cardEl.innerHTML = `
      <div class="dy-head">
        <h2>Race card</h2>
        <p>${esc(o.blurb)}</p>
      </div>
      <div class="dy-chips" role="radiogroup" aria-label="Stake">
        <span>Stake</span>
        ${CHIPS.map((v) => `<button role="radio" aria-checked="${v === o.stake}" data-chip="${v}" class="c${v}">${v >= 1000 ? '1K' : v}</button>`).join('')}
      </div>
      <div class="dy-cols"><span>Runner</span><span>Form</span><span>Win</span><span>Top 3</span></div>
      <div class="dy-rows">
        ${o.rows
          .map(
            (r, i) => `<div class="dy-row" data-i="${i}">
            <div class="dy-who">${ball(r.color, r.color2)}<em>${r.no}</em><div><b>${esc(r.name)}</b><small>${esc(r.style)} · <span class="dy-stars">${'★'.repeat(r.stars)}<s>${'★'.repeat(5 - r.stars)}</s></span></small></div></div>
            <div class="dy-form"><b>${esc(r.form)}</b><small>${esc(r.record)} won</small></div>
            ${(['win', 'top3'] as const)
              .map((k) => {
                const m = r.mine.find((x) => x.kind === k);
                return `<button class="dy-odds ${m ? 'on' : ''}" data-bet="${i}" data-kind="${k}">${k === 'win' ? r.win : r.top3}${m ? `<i>${coins(m.stake)}</i>` : ''}</button>`;
              })
              .join('')}
          </div>`,
          )
          .join('')}
      </div>
      <div class="dy-slip">
        ${
          o.bets.length
            ? `<div class="dy-bets">${o.bets
                .map((b) => `<div>${ball(b.color)}<span><b>${esc(b.name)}</b> ${b.kind === 'win' ? 'to win' : 'top 3'} @ ${b.price}</span><em>${coins(b.stake)} → ${coins(b.ret)}</em><button data-unbet="${b.id}" aria-label="Take the bet back">&times;</button></div>`)
                .join('')}</div>
              <div class="dy-tot"><span>Staked <b>${coins(staked)}</b></span><span>Best return <b>${coins(best)}</b></span><button class="dy-link" data-a="clear">Clear</button></div>`
            : `<div class="dy-empty">Tap a price to bet: <b>Win</b> pays if it wins, <b>Top 3</b> if it finishes in the first three.</div>`
        }
        ${o.broke ? `<button class="dy-btn alt" data-a="bail">Out of coins: take ${250} from the house</button>` : ''}
        <button class="dy-btn" data-a="go">${o.bets.length ? 'RUN THE RACE' : 'WATCH WITHOUT BETTING'}</button>
      </div>`;
    const rowsEl = this.cardEl.querySelector('.dy-rows') as HTMLElement;
    rowsEl.scrollTop = scroll;
    this.cardEl.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((b) => b.addEventListener('click', () => this.h.onChip(Number(b.dataset.chip))));
    this.cardEl.querySelectorAll<HTMLButtonElement>('[data-bet]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.onBet(Number(b.dataset.bet), b.dataset.kind as 'win' | 'top3');
      }),
    );
    this.cardEl.querySelectorAll<HTMLButtonElement>('[data-unbet]').forEach((b) => b.addEventListener('click', () => this.h.onUnbet(Number(b.dataset.unbet))));
    this.cardEl.querySelectorAll<HTMLElement>('.dy-row').forEach((r) => {
      r.addEventListener('pointerenter', () => this.h.onHover(Number(r.dataset.i)));
      r.addEventListener('click', () => this.h.onHover(Number(r.dataset.i)));
    });
    rowsEl.addEventListener('pointerleave', () => this.h.onHover(-1));
    this.cardEl.querySelector('[data-a=go]')!.addEventListener('click', () => this.h.onStart());
    this.cardEl.querySelector('[data-a=clear]')?.addEventListener('click', () => this.h.onClear());
    this.cardEl.querySelector('[data-a=bail]')?.addEventListener('click', () => this.h.onBailout());
  }

  // ------------------------------------------------------------------------------------- the race
  hud(on: boolean) {
    this.liveEl.classList.toggle('dy-hide', !on);
    if (!on) this.liveKey = '';
  }

  live(o: { rows: LiveRow[]; time: string; progress: number; shot: string }) {
    // (rebuilt only when the order or a flag changes; the gaps and the clock are patched in place)
    const key = o.rows.map((r) => `${r.no}${r.fin}${r.fell ? 'f' : ''}${r.follow ? 'w' : ''}`).join(',') + o.shot;
    if (key !== this.liveKey) {
      this.liveKey = key;
      this.liveEl.innerHTML = `
        <div class="dy-clock"><b></b><div class="dy-bar"><i></i></div></div>
        <div class="dy-board">
          ${o.rows
            .map(
              (r, k) => `<button class="dy-lr ${r.fin === 1 ? 'won' : ''} ${r.fell ? 'fell' : ''} ${r.follow ? 'follow' : ''} ${r.mine.length ? 'mine' : ''}" data-no="${r.no}">
              <span class="p">${k + 1}</span>${ball(r.color)}<span class="n"><em>${r.no}</em>${esc(r.name)}</span>
              ${r.mine.map((m) => `<span class="tag ${m}">${m === 'win' ? 'WIN' : 'TOP 3'}</span>`).join('')}
              <span class="g"></span></button>`,
            )
            .join('')}
        </div>
        <div class="dy-shot">${esc(o.shot)} · <b>1–8</b> follow · <b>C</b> cut</div>`;
      this.liveEl.querySelectorAll<HTMLButtonElement>('.dy-lr').forEach((b) => b.addEventListener('click', () => this.h.onFollow(Number(b.dataset.no) - 1)));
    }
    (this.liveEl.querySelector('.dy-clock b') as HTMLElement).textContent = o.time;
    (this.liveEl.querySelector('.dy-bar i') as HTMLElement).style.width = `${(o.progress * 100).toFixed(1)}%`;
    const gs = this.liveEl.querySelectorAll<HTMLElement>('.dy-lr .g');
    o.rows.forEach((r, k) => {
      if (gs[k] && gs[k].textContent !== r.gap) gs[k].textContent = r.fell ? 'SPLASH' : r.gap;
    });
  }

  caption(text: string) {
    const c = this.capEl;
    c.innerHTML = `<span>${esc(text)}</span>`;
    c.classList.remove('dy-hide');
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
    clearTimeout(this.capT);
    this.capT = window.setTimeout(() => c.classList.add('dy-hide'), 3400);
  }

  count(text: string) {
    this.countEl.innerHTML = `<b class="${text === 'GO!' ? 'go' : ''}">${esc(text)}</b>`;
    this.countEl.classList.remove('dy-hide');
    if (text === 'GO!') window.setTimeout(() => this.countEl.classList.add('dy-hide'), 900);
  }

  banner(text: string, sub: string, color: number) {
    this.bannerEl.innerHTML = `<div style="--c:${css(color)}"><b>${esc(text)}</b><small>${esc(sub)}</small></div>`;
    this.bannerEl.classList.remove('dy-hide');
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => this.bannerEl.classList.add('dy-hide'), 3200);
  }

  // ------------------------------------------------------------------------------------- the payout
  results(o: {
    podium: { no: number; name: string; color: number; time: string }[];
    rest: { no: number; name: string; color: number }[];
    lines: { no: number; name: string; color: number; kind: 'win' | 'top3'; stake: number; price: string; place: number; pay: number }[];
    ret: number;
    net: number;
    before: number;
    after: number;
    best: number;
  }) {
    this.capEl.classList.add('dy-hide');
    const r = this.resEl;
    const ord = (n: number) => {
      if (n > 99) return '–';
      const v = n % 100;
      return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
    };
    const verdict = o.lines.length === 0 ? 'No bets on that one' : o.net > 0 ? `You won ${coins(o.net)}!` : o.ret > 0 ? `Back ${coins(o.ret)}` : 'The house wins this time';
    r.innerHTML = `<div class="dy-panel ${o.net > 0 ? 'win' : ''}">
      <h2>${esc(verdict)}</h2>
      <div class="dy-podium">
        ${[1, 0, 2]
          .map((k) => o.podium[k])
          .filter(Boolean)
          .map((p) => {
            const place = o.podium.indexOf(p) + 1;
            return `<div class="pl p${place}">${ball(p.color)}<b>${esc(p.name)}</b><small>No. ${p.no}${p.time ? ' · ' + p.time : ''}</small><span>${place}</span></div>`;
          })
          .join('')}
      </div>
      <div class="dy-restline">${o.rest.map((x, k) => `<span>${k + 4}. ${esc(x.name)}</span>`).join('')}</div>
      ${
        o.lines.length
          ? `<div class="dy-lines">${o.lines
              .map((l) => `<div class="${l.pay ? 'w' : 'l'}">${ball(l.color)}<span><b>${esc(l.name)}</b> ${l.kind === 'win' ? 'to win' : 'top 3'} · ${coins(l.stake)} @ ${l.price}</span><em>${ord(l.place)}</em><strong>${l.pay ? '+' + coins(l.pay) : '−' + coins(l.stake)}</strong></div>`)
              .join('')}</div>`
          : ''
      }
      <div class="dy-bal"><span>Purse</span><b data-to="${o.after}">${coins(o.before)}</b><i class="dy-coin"></i></div>
      <button class="dy-btn" data-a="next">NEXT RACE</button>
    </div>`;
    r.classList.remove('dy-hide');
    r.querySelector('[data-a=next]')!.addEventListener('click', () => this.h.onNext());
    this.purseEl.textContent = coins(o.after);
    // the purse counts up (or down) to its new total
    const b = r.querySelector('.dy-bal b') as HTMLElement;
    const t0 = performance.now();
    const from = o.before, to = o.after;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1400);
      const e = 1 - Math.pow(1 - k, 3);
      b.textContent = coins(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    if (from !== to) setTimeout(() => requestAnimationFrame(step), 500);
    else b.textContent = coins(to);
  }

  hideResults() {
    this.resEl.classList.add('dy-hide');
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('dy-hide');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl.classList.add('dy-hide'), 2200);
  }
}
