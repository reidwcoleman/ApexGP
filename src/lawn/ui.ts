/** All the DOM: HUD, title, result card, shop, pause, floating numbers and flying coins. */
import { MOWERS, UPGRADES, upgradeCost, type SaveData, type UpgradeId } from './save.ts';
import { clamp } from './util.ts';

const IC = {
  back: 'M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  bag: 'M7 8V7a5 5 0 0 1 10 0v1h3.2l.8 13H3l.8-13zm2 0h6V7a3 3 0 0 0-6 0z',
  sound: 'M3 9v6h4l5 4V5L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M3 9v6h4l5 4V5L7 9zm13 .6 1.4-1.4 2.1 2.1 2.1-2.1L22 9.6l-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1z',
  music: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z',
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z',
  arrow: 'M12 2 3.5 20.5 12 16l8.5 4.5z',
  speed: 'M13 2 4 14h6l-1 8 9-12h-6z',
  width: 'M2 12l5-5v4h10V7l5 5-5 5v-4H7v4z',
  magnet: 'M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0zm0 0h5v3H4zm11 0h5v3h-5z',
  value: 'M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21l1.4-7L2 9.3l7-.8z',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export interface ResultInfo {
  name: string;
  rows: { label: string; value: string; bonus?: boolean }[];
  earned: number;
  shopDot: boolean;
  onNext: () => void;
  onShop: () => void;
}

export interface ShopModel {
  save: () => SaveData;
  thumbs: Record<string, string>;
  buyUpgrade: (id: UpgradeId) => void;
  buyMower: (id: string) => void;
  equip: (id: string) => void;
  close: () => void;
}

export class UI {
  readonly hud: HTMLElement;
  private coinsEl!: HTMLElement;
  private coinPill!: HTMLElement;
  private bar!: HTMLElement;
  private barFill!: HTMLElement;
  private barPct!: HTMLElement;
  private nameEl!: HTMLElement;
  private hint!: HTMLElement;
  private ring!: HTMLElement;
  private ringKnob!: HTMLElement;
  private arrow!: HTMLElement;
  private title!: HTMLElement;
  private titleCoins!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private result!: HTMLElement;
  private shop!: HTMLElement;
  private shopCard!: HTMLElement;
  private pause!: HTMLElement;
  private toastEl!: HTMLElement;
  private shopDot!: HTMLElement;
  private soundBtn!: HTMLElement;
  private musicBtn!: HTMLElement;
  private shown = 0;
  private target = 0;
  private countRaf = 0;
  private shopTab: 'up' | 'mow' = 'up';
  private shopModel: ShopModel | null = null;
  private lastPct = -1;
  tick: () => void = () => {};
  click: () => void = () => {};

  constructor(private root: HTMLElement, h: { onPause: () => void; onShop: () => void; onSound: () => void; onMusic: () => void }) {
    this.hud = el('div', 'hud', root);
    const top = el('div', 'top', this.hud);
    const left = el('div', 'left', top);
    this.coinPill = el('div', 'pill hit', left, '<span class="coin-ico"></span><span class="n">0</span>');
    this.coinsEl = this.coinPill.querySelector('.n') as HTMLElement;
    const mid = el('div', 'mid', top);
    this.nameEl = el('div', 'name', mid, 'Lawn 1');
    this.bar = el('div', 'bar', mid, '<i></i><b>0%</b>');
    this.barFill = this.bar.querySelector('i') as HTMLElement;
    this.barPct = this.bar.querySelector('b') as HTMLElement;
    const right = el('div', 'right', top);
    const shopBtn = el('button', 'round hit', right, svg(IC.bag));
    shopBtn.setAttribute('aria-label', 'Shop');
    this.shopDot = el('span', 'dot', shopBtn);
    this.shopDot.style.display = 'none';
    shopBtn.onclick = () => (this.click(), h.onShop());
    const pauseBtn = el('button', 'round hit', right, svg(IC.pause));
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.onclick = () => (this.click(), h.onPause());

    this.hint = el('div', 'hint', root, '<div class="finger"></div><div>Drag to mow</div>');
    this.ring = el('div', 'ring', root, '<i></i>');
    this.ringKnob = this.ring.querySelector('i') as HTMLElement;
    this.arrow = el('div', 'arrow', root, svg(IC.arrow));

    // title
    this.title = el('div', 'title', root);
    const logo = el('div', 'logo', this.title);
    const small = el('small', '', logo, 'APEX GP');
    void small;
    const word = el('div', '', logo);
    for (const ch of 'LAWN') el('span', '', word, ch);
    el('div', 'tag', logo, 'one more lawn, then maybe another');
    el('div', '', this.title);
    const bottom = el('div', 'bottom', this.title);
    this.playBtn = el('button', 'btn big pulse hit', bottom, 'Mow') as HTMLButtonElement;
    const row = el('div', 'row', bottom);
    const tShop = el('button', 'round hit', row, svg(IC.bag));
    tShop.onclick = () => (this.click(), h.onShop());
    this.soundBtn = el('button', 'round hit', row, svg(IC.sound));
    this.soundBtn.onclick = () => (this.click(), h.onSound());
    this.musicBtn = el('button', 'round hit', row, svg(IC.music));
    this.musicBtn.onclick = () => (this.click(), h.onMusic());
    const back = el('a', 'back hit', this.title, `${svg(IC.back)}Apex GP`) as HTMLAnchorElement;
    back.href = './index.html';
    this.titleCoins = el('div', 'pill coinsline hit', this.title, '<span class="coin-ico"></span><span class="n">0</span>');

    this.result = el('div', 'scrim', root);
    this.shop = el('div', 'scrim', root);
    this.shopCard = el('div', 'card sheet', this.shop);
    this.pause = el('div', 'scrim', root);
    this.toastEl = el('div', 'toast', root);
  }

  // ---------------------------------------------------------------- hud
  setHud(on: boolean) {
    this.hud.classList.toggle('on', on);
  }
  setLawnName(text: string, accent: string) {
    this.nameEl.textContent = text;
    document.documentElement.style.setProperty('--accent', accent);
  }
  setProgress(p: number) {
    const pct = Math.floor(clamp(p, 0, 1) * 100);
    this.barFill.style.width = `${clamp(p, 0, 1) * 100}%`;
    if (pct !== this.lastPct) {
      this.barPct.textContent = `${pct}%`;
      this.lastPct = pct;
    }
  }
  flashBar() {
    this.bar.classList.remove('flash');
    void this.bar.offsetWidth;
    this.bar.classList.add('flash');
  }
  setCoins(n: number, instant = false) {
    this.target = n;
    if (instant) {
      this.shown = n;
      this.paintCoins();
      return;
    }
    if (this.countRaf) return;
    const step = () => {
      const d = this.target - this.shown;
      if (d === 0) {
        this.countRaf = 0;
        return;
      }
      this.shown += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * 0.18));
      if ((d > 0 && this.shown > this.target) || (d < 0 && this.shown < this.target)) this.shown = this.target;
      this.paintCoins();
      this.countRaf = requestAnimationFrame(step);
    };
    this.countRaf = requestAnimationFrame(step);
  }
  private paintCoins() {
    const t = String(this.shown);
    this.coinsEl.textContent = t;
    (this.titleCoins.querySelector('.n') as HTMLElement).textContent = t;
  }
  bumpCoins() {
    this.coinPill.classList.remove('bump');
    void this.coinPill.offsetWidth;
    this.coinPill.classList.add('bump');
  }
  coinTarget() {
    const r = this.coinPill.getBoundingClientRect();
    return { x: r.left + 24, y: r.top + r.height / 2 };
  }
  flyCoin(x: number, y: number, then: () => void) {
    const e = el('div', 'fly coin-ico', this.root);
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    const t = this.coinTarget();
    const dx = t.x - x;
    const dy = t.y - y;
    const a = e.animate(
      [
        { transform: 'translate(0,0) scale(0.6)', opacity: 1, offset: 0 },
        { transform: `translate(${dx * 0.04}px,${dy * 0.04 - 38}px) scale(1.25)`, opacity: 1, offset: 0.22 },
        { transform: `translate(${dx}px,${dy}px) scale(0.85)`, opacity: 1, offset: 1 },
      ],
      { duration: 640, easing: 'cubic-bezier(.45,.05,.55,.95)' },
    );
    a.onfinish = () => {
      e.remove();
      then();
    };
  }
  floatText(x: number, y: number, text: string) {
    const e = el('div', 'float', this.root, text);
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    const a = e.animate(
      [
        { transform: 'translate(-50%,0) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%,-22px) scale(1.15)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%,-64px) scale(1)', opacity: 0 },
      ],
      { duration: 900, easing: 'ease-out' },
    );
    a.onfinish = () => e.remove();
  }
  setHint(on: boolean) {
    this.hint.classList.toggle('on', on);
  }
  setRing(r: { show: boolean; x: number; y: number; nx: number; ny: number }) {
    this.ring.classList.toggle('on', r.show);
    if (r.show) {
      this.ring.style.left = `${r.x}px`;
      this.ring.style.top = `${r.y}px`;
      this.ringKnob.style.transform = `translate(${r.nx * 42}px, ${r.ny * 42}px)`;
    }
  }
  setArrow(show: boolean, x = 0, y = 0, ang = 0) {
    this.arrow.classList.toggle('on', show);
    if (show) {
      this.arrow.style.left = `${x}px`;
      this.arrow.style.top = `${y}px`;
      this.arrow.style.transform = `rotate(${ang}rad)`;
    }
  }
  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    window.setTimeout(() => this.toastEl.classList.remove('on'), 1800);
  }
  setShopDot(on: boolean) {
    this.shopDot.style.display = on ? '' : 'none';
  }
  setToggles(sound: boolean, music: boolean) {
    this.soundBtn.innerHTML = svg(sound ? IC.sound : IC.mute);
    this.soundBtn.classList.toggle('off', !sound);
    this.musicBtn.classList.toggle('off', !music);
  }

  // ---------------------------------------------------------------- title
  showTitle(lawn: number, onPlay: () => void) {
    this.playBtn.textContent = `Mow lawn ${lawn}`;
    this.playBtn.onclick = () => {
      this.click();
      onPlay();
    };
    this.title.classList.add('on');
  }
  hideTitle() {
    this.title.classList.remove('on');
  }

  // ---------------------------------------------------------------- result
  showResult(info: ResultInfo) {
    const r = this.result;
    r.innerHTML = '';
    r.classList.add('clear', 'res');
    const card = el('div', 'card compact', r);
    el('h2', '', card, 'Lawn complete!');
    el('div', 'sub', card, `${info.name} is looking lovely`);
    const chips = el('div', 'chips', card);
    const main = info.rows.filter((x) => !x.bonus);
    main.forEach((row, i) => {
      const s = el('div', 'chip', chips, `<b>${row.value}</b><small>${row.label}</small>`);
      s.style.opacity = '0';
      s.style.transform = 'translateY(8px) scale(0.9)';
      window.setTimeout(() => {
        s.style.transition = 'all 0.35s cubic-bezier(.2,1.4,.4,1)';
        s.style.opacity = '1';
        s.style.transform = 'none';
        this.tick();
      }, 450 + i * 230);
    });
    const bonusRow = info.rows.find((x) => x.bonus);
    if (bonusRow) {
      const s = el('div', 'stat bonus', card, `<span>${bonusRow.label}</span><span>${bonusRow.value}</span>`);
      s.style.opacity = '0';
      window.setTimeout(() => {
        s.style.transition = 'opacity 0.35s ease';
        s.style.opacity = '1';
        this.tick();
      }, 450 + main.length * 230);
    }
    const earn = el('div', 'earn', card, '<span class="coin-ico"></span><span class="n">+0</span>');
    const n = earn.querySelector('.n') as HTMLElement;
    const t0 = performance.now() + 450 + info.rows.length * 230;
    const run = () => {
      const t = clamp((performance.now() - t0) / 900, 0, 1);
      n.textContent = `+${Math.round(info.earned * (1 - Math.pow(1 - t, 3)))}`;
      if (t < 1) requestAnimationFrame(run);
      else this.bumpEl(earn);
    };
    requestAnimationFrame(run);
    const actions = el('div', 'actions', card);
    const next = el('button', 'btn big pulse', actions, 'One more lawn') as HTMLButtonElement;
    next.onclick = () => {
      this.click();
      this.hideResult();
      info.onNext();
    };
    const shop = el('button', 'btn ghost sm', actions, 'Shop') as HTMLButtonElement;
    if (info.shopDot) shop.innerHTML = 'Shop <span style="color:#ff4f6e">●</span>';
    shop.onclick = () => {
      this.click();
      info.onShop();
    };
    // the card waits for the confetti to start
    window.setTimeout(() => r.classList.add('on'), 700);
  }
  private bumpEl(e: HTMLElement) {
    e.classList.remove('bump');
    void e.offsetWidth;
    e.classList.add('bump');
  }
  hideResult() {
    this.result.classList.remove('on');
  }

  // ---------------------------------------------------------------- pause
  showPause(h: { resume: () => void; shop: () => void; home: () => void; sound: boolean; music: boolean; onSound: () => void; onMusic: () => void }) {
    const p = this.pause;
    p.innerHTML = '';
    const card = el('div', 'card', p);
    el('h2', '', card, 'Taking a break');
    el('div', 'sub', card, 'The grass will wait');
    const actions = el('div', 'actions', card);
    const r = el('button', 'btn', actions, 'Keep mowing') as HTMLButtonElement;
    r.onclick = () => {
      this.click();
      this.hidePause();
      h.resume();
    };
    const row = el('div', 'row', actions);
    const s = el('button', 'btn ghost sm', row, 'Shop') as HTMLButtonElement;
    s.onclick = () => {
      this.click();
      this.hidePause();
      h.shop();
    };
    const hm = el('button', 'btn ghost sm', row, 'Home') as HTMLButtonElement;
    hm.onclick = () => {
      this.click();
      this.hidePause();
      h.home();
    };
    const row2 = el('div', 'row', actions);
    const so = el('button', 'round', row2, svg(h.sound ? IC.sound : IC.mute));
    so.classList.toggle('off', !h.sound);
    so.onclick = () => {
      h.onSound();
      this.click();
      so.innerHTML = svg(this.soundBtn.classList.contains('off') ? IC.mute : IC.sound);
      so.classList.toggle('off', this.soundBtn.classList.contains('off'));
    };
    const mu = el('button', 'round', row2, svg(IC.music));
    mu.classList.toggle('off', !h.music);
    mu.onclick = () => {
      h.onMusic();
      this.click();
      mu.classList.toggle('off', this.musicBtn.classList.contains('off'));
    };
    p.classList.add('on');
  }
  hidePause() {
    this.pause.classList.remove('on');
  }

  // ---------------------------------------------------------------- shop
  openShop(model: ShopModel) {
    this.shopModel = model;
    this.renderShop();
    this.shop.classList.add('on');
  }
  closeShop() {
    this.shop.classList.remove('on');
    this.shopModel = null;
  }
  get shopOpen() {
    return this.shopModel !== null;
  }
  refreshShop() {
    if (this.shopModel) this.renderShop();
  }
  private renderShop() {
    const m = this.shopModel!;
    const s = m.save();
    const c = this.shopCard;
    const scroll = c.scrollTop;
    c.innerHTML = '';
    const x = el('button', 'round close', c, svg(IC.close));
    x.onclick = () => {
      this.click();
      m.close();
    };
    el('h2', '', c, 'Shed');
    const bal = el('div', 'sub', c, '');
    bal.innerHTML = `<span class="price"><span class="coin-ico sm"></span><b style="color:#d98c00;font-size:20px">${s.coins}</b></span>`;
    const tabs = el('div', 'tabs', c);
    for (const [id, label] of [['up', 'Upgrades'], ['mow', 'Mowers']] as const) {
      const b = el('button', this.shopTab === id ? 'on' : '', tabs, label);
      b.onclick = () => {
        this.shopTab = id;
        this.click();
        this.renderShop();
      };
    }
    if (this.shopTab === 'up') {
      const list = el('div', 'list', c);
      const icons: Record<string, string> = { speed: IC.speed, width: IC.width, magnet: IC.magnet, value: IC.value };
      for (const u of UPGRADES) {
        const lvl = s.upgrades[u.id];
        const row = el('div', 'up', list);
        el('div', 'ico', row, svg(icons[u.id]));
        const mid = el('div', '', row);
        el('b', '', mid, u.name);
        el('small', '', mid, u.desc);
        const pips = el('div', 'pips', mid);
        for (let i = 0; i < u.max; i++) el('i', i < lvl ? 'on' : '', pips);
        const maxed = lvl >= u.max;
        const cost = upgradeCost(u, lvl);
        const b = el('button', `btn sm ${maxed ? '' : 'gold'}`, row, maxed ? 'Max' : `<span class="price"><span class="coin-ico sm"></span>${cost}</span>`) as HTMLButtonElement;
        b.disabled = maxed || s.coins < cost;
        b.onclick = () => m.buyUpgrade(u.id);
      }
    } else {
      const grid = el('div', 'mowers', c);
      const maxS = Math.max(...MOWERS.map((q) => q.speed));
      const maxW = Math.max(...MOWERS.map((q) => q.width));
      for (const mw of MOWERS) {
        const owned = s.owned.includes(mw.id);
        const card = el('div', `mw${s.mower === mw.id ? ' sel' : ''}`, grid);
        const img = el('img', '', card) as HTMLImageElement;
        img.src = m.thumbs[mw.id] ?? '';
        img.alt = mw.name;
        el('b', '', card, mw.name);
        el('small', '', card, mw.tagline);
        const mini = el('div', 'mini', card);
        el('span', '', mini, 'Speed');
        el('div', '', mini, `<i style="width:${(mw.speed / maxS) * 100}%"></i>`);
        el('span', '', mini, 'Width');
        el('div', '', mini, `<i style="width:${(mw.width / maxW) * 100}%"></i>`);
        let label: string;
        let gold = false;
        let dis = false;
        if (s.mower === mw.id) {
          label = 'Using';
          dis = true;
        } else if (owned) label = 'Use';
        else {
          label = `<span class="price"><span class="coin-ico sm"></span>${mw.price}</span>`;
          gold = true;
          dis = s.coins < mw.price;
        }
        const b = el('button', `btn sm ${gold ? 'gold' : ''}`, card, label) as HTMLButtonElement;
        b.disabled = dis;
        b.onclick = () => (owned ? m.equip(mw.id) : m.buyMower(mw.id));
      }
    }
    c.scrollTop = scroll;
  }
}
