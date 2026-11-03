// The HUD: company card, goal pill, clock, dock, side panel, modals (Exchange, Empire, Ranks, pickers),
// toasts, money pop-ups, hover tips and the ticker. Plain DOM; panels re-render on change and live
// numbers refresh in place through data-b bindings so sliders never lose the mouse.
import './ui.css';
import type { Sim, Cart, Shop, Fac, Quarry, Deposit } from './sim.ts';
import { money } from './sim.ts';
import type { City, Building } from './city.ts';
import {
  GOODS, GOOD_IDS, MENU, MENU_BY, SHOPS, SHOP_BY, FACILITIES, FAC_BY, ORE_BY, QUESTS, CART_COST, CART_UP, SHOP_UP, SURVEY_COST, DAYS_PER_MONTH, tierOf, peakMul,
  type GoodId, type MenuItem,
} from './data.ts';

export type Tool = 'select' | 'cart' | 'move' | 'survey';
export type Sel = { k: 'cart'; id: number } | { k: 'shop'; id: number } | { k: 'bld'; id: number } | { k: 'dep'; id: number } | { k: 'quarry'; id: number } | null;

const I: Record<string, string> = {
  cart: '<path d="M4 15h13l2-7H6"/><circle cx="8" cy="19" r="1.6"/><circle cx="16" cy="19" r="1.6"/><path d="M5 8 3.5 4H2"/><path d="M9 4h6M12 4v4"/>',
  shop: '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6"/><path d="M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/><path d="M10 20v-5h4v5"/>',
  bld: '<path d="M5 21V5l7-3v19"/><path d="M12 9h7v12"/><path d="M8 8h1M8 12h1M8 16h1M15 13h1M15 17h1"/><path d="M3 21h18"/>',
  survey: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity=".55"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  ex: '<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>',
  emp: '<path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/>',
  rank: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  heat: '<path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a8.5 8.5 0 0 1 0 13"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  leaf: '<path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19 13 11"/>',
  gem: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  home: '<path d="M4 20V10l8-6 8 6v10"/>',
};
const svg = (k: string, sw = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${I[k] ?? ''}</svg>`;
export function gIcon(g: GoodId, size = 34): string {
  const G = GOODS[g];
  const k = G.cat === 'ore' ? 'gem' : G.cat === 'made' ? 'gear' : 'leaf';
  const light = ['milk', 'flour'].includes(g);
  return `<span class="gico" style="width:${size}px;height:${size}px;background:${G.color};color:${light ? '#6b6358' : '#fff'}">${svg(k, 2.2)}</span>`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

export class UI {
  root: HTMLElement;
  sim!: Sim;
  city!: City;
  tool: Tool = 'select';
  sel: Sel = null;
  speed = 1;
  heatOn = false;
  muted = false;
  onTool: (t: Tool) => void = () => {};
  onSel: (s: Sel) => void = () => {};
  onFly: (x: number, z: number) => void = () => {};
  onSpeed: (s: number) => void = () => {};
  onHeat: (on: boolean) => void = () => {};
  onMute: (m: boolean) => void = () => {};
  onSfx: (k: 'click' | 'buy' | 'bad' | 'goal' | 'coin') => void = () => {};
  private el: Record<string, HTMLElement> = {};
  private binds: Record<string, () => string> = {};
  modalKind = '';
  private exSel: GoodId = 'stone';
  private lastCash = 0;
  private tickerKey = '';

  constructor(root: HTMLElement) {
    this.root = root;
  }

  // ---------------------------------------------------------------- title screen
  title(cities: { id: string; name: string; area: string; sky: string; save: { nw: number; company: string; day: number } | null }[], last: string | null): Promise<{ city: string; company: string }> {
    return new Promise((res) => {
      let pick = last && cities.some((c) => c.id === last) ? last : cities[0].id;
      const w = document.createElement('div');
      w.className = 'title';
      const draw = () => {
        const cur = cities.find((c) => c.id === pick)!;
        w.innerHTML = `<a class="back" href="./?pick">← All games</a><div class="sky">${skyline()}</div><div class="tbox">
          <div class="logo">Mo<span>gul</span></div>
          <div class="tag">Start with one food cart on a real street. End up owning the skyline.</div>
          <div class="cities">${cities.map((c) => `<div class="city ${c.id === pick ? 'sel' : ''}" data-c="${c.id}" style="--c:${c.sky}"><span>${esc(c.area)}</span><b>${esc(c.name)}</b>${c.save ? `<em>${esc(c.save.company)} · ${money(c.save.nw)} · day ${c.save.day}</em>` : '<em style="color:var(--ink3)">New city</em>'}</div>`).join('')}</div>
          <div class="start">${cur.save ? `<button class="btn gold" data-go="1">Continue in ${esc(cur.name)}</button><button class="btn ghost" data-new="1">Start over</button>` : `<input maxlength="24" placeholder="Name your company" value="${esc(localStorage.getItem('mogul.company') || '')}"/><button class="btn gold" data-go="1">Open for business</button>`}</div>
          <div class="feat"><div><b>Real streets</b>Every block, avenue and building comes from the city's actual map.</div><div><b>Cart to empire</b>Carts, shops, whole buildings, farms, factories and quarries.</div><div><b>Trucks run themselves</b>Your fleet hauls between your sites. No routes to draw.</div><div><b>Monthly race</b>Nine rival companies. Top 3 each month win trophies that boost income.</div></div>
        </div>`;
      };
      draw();
      w.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const c = t.closest('[data-c]') as HTMLElement | null;
        if (c) { pick = c.dataset.c!; draw(); this.onSfx('click'); return; }
        if (t.closest('[data-new]')) {
          if (!confirmInline(t.closest('[data-new]') as HTMLElement)) return;
          cities.find((x) => x.id === pick)!.save = null;
          localStorage.removeItem('mogul.v1.' + pick);
          draw();
          return;
        }
        if (t.closest('[data-go]')) {
          const inp = w.querySelector('input') as HTMLInputElement | null;
          const cur = cities.find((x) => x.id === pick)!;
          const company = cur.save?.company || inp?.value.trim() || 'Corner & Co.';
          localStorage.setItem('mogul.company', company);
          this.onSfx('buy');
          w.remove();
          res({ city: pick, company });
        }
      });
      w.addEventListener('keydown', (e) => { if (e.key === 'Enter') (w.querySelector('[data-go]') as HTMLElement)?.click(); });
      this.root.appendChild(w);
    });
  }

  // ---------------------------------------------------------------- HUD
  mount(sim: Sim, city: City) {
    this.sim = sim; this.city = city;
    this.root.insertAdjacentHTML('beforeend', `
      <div class="leftcol">
        <div class="co glass" data-r="co">
          <div class="cotop"><div class="av" data-r="av"></div><div class="coinfo"><div class="nm" data-r="nm"></div><div class="tier" data-r="tier"></div><div class="cash num" data-r="cash"></div><div class="sub num"><span>Worth <b data-r="nw"></b></span><span class="g" data-r="rate"></span></div></div><svg class="nwspark" data-r="spark" viewBox="0 0 70 40" preserveAspectRatio="none"></svg></div>
          <div class="hype" data-r="hype"><div class="hl"><b>${svg('heat', 2.4)}HYPE</b><span data-r="hypet">Every sale fills it. Full = Frenzy</span></div><div class="hb"><i data-r="hypebar"></i></div></div>
        </div>
        <div class="quest glass" data-r="quest"></div>
        <div class="orders" data-r="orders"></div>
      </div>
      <canvas class="mini glass" data-r="mini" width="400" height="400"></canvas>
      <canvas class="confetti" data-r="confetti"></canvas>
      <div class="banner" data-r="banner"></div>
      <div class="clock glass"><svg class="sun" viewBox="0 0 30 30" data-r="sun"></svg><div><div class="tm num" data-r="tm"></div><div class="dy" data-r="dy"></div></div>
        <div class="spd" data-r="spd">${[0, 1, 2, 3].map((s) => `<button data-spd="${s}">${s ? s + '×' : svg('pause', 2.4).replace('<svg', '<svg width="14" height="14"')}</button>`).join('')}</div>
        <div class="rank" data-act="ranks"><b class="num" data-r="rank"></b><span>this month</span></div>
        <button class="ic" data-act="heat" title="Foot traffic (H)">${svg('heat')}</button>
        <button class="ic" data-act="mute" title="Sound (M)" data-r="mute">${svg('vol')}</button>
      </div>
      <div class="dock glass" data-r="dock">
        <button data-tool="cart" data-tip="Park a food cart on a busy sidewalk" style="--ic:#e5533d"><span class="k">C</span><span class="dic">${svg('cart')}</span>Cart<span class="cost" data-r="cartcost"></span></button>
        <button data-act="rent" data-tip="Rent a ground-floor room and open a shop" style="--ic:#a8673a"><span class="k">R</span><span class="dic">${svg('shop')}</span>Rent</button>
        <button data-act="buyb" data-tip="Buy whole buildings, collect rent, redevelop" style="--ic:#f2a91c"><span class="k">B</span><span class="dic">${svg('bld')}</span>Property</button>
        <button data-tool="survey" data-tip="Scan for buried ore only you can see" style="--ic:#2bb3a3"><span class="k">V</span><span class="dic">${svg('survey')}</span>Survey<span class="cost" data-r="survcost"></span></button>
        <span class="sep"></span>
        <button data-act="trucks" data-tip="Your self-routing delivery fleet" style="--ic:#ffb000"><span class="k">T</span><span class="dic">${svg('truck')}</span>Trucks</button>
        <button data-act="exchange" data-tip="Buy and sell goods on the world market" style="--ic:#22b26b"><span class="k">X</span><span class="dic">${svg('ex')}</span>Exchange</button>
        <button data-act="empire" data-tip="Everything you own, in one place" style="--ic:#3d7be5"><span class="k">⇧E</span><span class="dic">${svg('emp')}</span>Empire</button>
        <button data-act="ranks" data-tip="This month's race against nine rivals" style="--ic:#8a6cff"><span class="k">L</span><span class="dic">${svg('rank')}</span>Ranks</button>
      </div>
      <div class="ticker"><div class="tl">Live</div><div class="tw"><div class="tr" data-r="tick"></div></div></div>
      <div data-r="pops" style="position:absolute;inset:0;pointer-events:none"></div>
      <div data-r="lines" style="position:absolute;inset:0;pointer-events:none"></div>
      <div class="toasts" data-r="toasts"></div>
      <div class="tip glass" data-r="tip" style="display:none"></div>
      <div class="hint" data-r="hint" style="display:none"></div>
      <div data-r="panelwrap"></div>
      <div data-r="modalwrap"></div>`);
    this.root.querySelectorAll('[data-r]').forEach((e) => (this.el[(e as HTMLElement).dataset.r!] = e as HTMLElement));
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('input', (e) => this.input(e));
    this.drawQuest();
    this.setSpeed(1);
  }

  setSpeed(s: number) {
    this.speed = s;
    this.el.spd.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +(b as HTMLElement).dataset.spd! === s));
  }
  setTool(t: Tool) {
    this.tool = t;
    this.el.dock.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === t));
    const hint = this.el.hint;
    if (t === 'cart') this.showHint(this.sim.myCarts().length ? `Place a cart for <b>${money(CART_COST(this.sim.myCarts().length))}</b> · warm streets = more people · Esc to cancel` : 'Your first cart is <b>free</b>. Hot streets = more customers. Click the sidewalk to park.');
    else if (t === 'survey') this.showHint(`Click anywhere to survey 140 m around it · <b>${money(SURVEY_COST(this.sim.s.stats.surveys))}</b> · Esc to cancel`);
    else if (t === 'move') this.showHint('Click a new spot for the cart · Esc to cancel');
    else hint.style.display = 'none';
  }
  showHint(html: string) { this.el.hint.innerHTML = html; this.el.hint.style.display = ''; }
  hideHint() { if (this.tool === 'select') this.el.hint.style.display = 'none'; }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const a = (k: string) => t.closest(`[data-${k}]`) as HTMLElement | null;
    let n: HTMLElement | null;
    if ((n = a('order'))) { const o = this.sim.s.orders.find((x) => x.id === +n!.dataset.order!); if (o) { this.sim.completeOrder(o); this.renderOrders(true); } return; }
    if (t === this.el.mini) { const r = t.getBoundingClientRect(); this.onMini((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); return; }
    if ((n = a('spd'))) { this.setSpeed(+n.dataset.spd!); this.onSpeed(this.speed); this.onSfx('click'); return; }
    if ((n = a('tool'))) { const tl = n.dataset.tool as Tool; this.onTool(this.tool === tl ? 'select' : tl); this.onSfx('click'); return; }
    if ((n = a('act'))) { this.act(n.dataset.act!, n); return; }
    if ((n = a('fly'))) {
      const [k, id] = n.dataset.fly!.split(':');
      this.closeModal();
      this.select({ k: k as any, id: +id });
      this.flyToSel();
      return;
    }
    if ((n = a('menu'))) { const c = this.selCart(); if (c) { this.sim.toggleMenu(c, n.dataset.menu!); this.onSfx('click'); this.renderPanel(); } return; }
    if ((n = a('cup'))) { const c = this.selCart(); if (c) { this.sim.upgradeCart(c, n.dataset.cup as any); this.onSfx('buy'); this.renderPanel(); } return; }
    if ((n = a('sup'))) { const s = this.selShop(); if (s) { this.sim.upgradeShop(s, n.dataset.sup as any); this.onSfx('buy'); this.renderPanel(); } return; }
    if ((n = a('openshop'))) { const b = this.city.buildings[+n.dataset.openshop!]; this.modal('shoptype', b.id); return; }
    if ((n = a('shoptype'))) {
      const [bid, type] = n.dataset.shoptype!.split(':');
      const sh = this.sim.openShop(this.city.buildings[+bid], type);
      if (sh) { this.onSfx('buy'); this.closeModal(); this.select({ k: 'shop', id: sh.id }); } else this.onSfx('bad');
      return;
    }
    if ((n = a('factype'))) {
      const [bid, type] = n.dataset.factype!.split(':');
      if (this.sim.develop(this.city.buildings[+bid], type)) { this.onSfx('buy'); this.closeModal(); this.renderPanel(); } else this.onSfx('bad');
      return;
    }
    if ((n = a('good'))) { this.exSel = n.dataset.good as GoodId; this.renderModal(); this.onSfx('click'); return; }
    if ((n = a('sell'))) {
      const g = this.exSel;
      const q = n.dataset.sell === 'all' ? this.sim.totalStock(g) : +n.dataset.sell!;
      const got = this.sim.sell(g, q);
      if (got > 0) { this.onSfx('coin'); this.toast(`Sold ${Math.floor(q)} ${GOODS[g].name} for ${money(got)}`, 'good'); } else this.onSfx('bad');
      this.renderModal();
      return;
    }
    if ((n = a('buyg'))) {
      const [to, q] = n.dataset.buyg!.split('|');
      if (this.sim.buy(this.exSel, +q, to)) { this.onSfx('buy'); this.toast(`${q} ${GOODS[this.exSel].name} on the way by courier`, 'good'); } else this.onSfx('bad');
      this.renderModal();
      return;
    }
    if ((n = a('x'))) { this.select(null); return; }
    if ((n = a('close'))) { this.closeModal(); return; }
    if (t.classList.contains('veil') && this.modalKind !== 'month' && this.modalKind !== 'away') this.closeModal();
  }

  private act(k: string, n: HTMLElement) {
    const s = this.sim;
    this.onSfx('click');
    switch (k) {
      case 'rent': this.onTool('select'); this.showHint('Click any building to see its ground-floor <b>rooms for rent</b>'); setTimeout(() => this.hideHint(), 4000); break;
      case 'buyb': this.onTool('select'); this.showHint('Click a building to see its <b>price</b>. Green-tinted ones are on sale.'); setTimeout(() => this.hideHint(), 4000); break;
      case 'exchange': this.modal('exchange'); break;
      case 'empire': this.modal('empire'); break;
      case 'ranks': this.modal('ranks'); break;
      case 'trucks': this.modal('trucks'); break;
      case 'heat': this.heatOn = !this.heatOn; n.classList.toggle('on', this.heatOn); this.onHeat(this.heatOn); break;
      case 'mute': this.muted = !this.muted; n.innerHTML = svg(this.muted ? 'mute' : 'vol'); this.onMute(this.muted); break;
      case 'buytruck': s.buyTruck(); this.onSfx('buy'); this.renderModal(); break;
      case 'buybld': { const b = this.selBld(); if (b && s.buyBuilding(b)) { this.onSfx('goal'); this.renderPanel(); } else this.onSfx('bad'); break; }
      case 'sellbld': { const b = this.selBld(); if (b && confirmInline(n)) { s.sellBuilding(b); this.renderPanel(); } break; }
      case 'develop': { const b = this.selBld(); if (b) this.modal('factype', b.id); break; }
      case 'facup': { const f = this.selFac(); if (f) { s.upgradeFac(f); this.onSfx('buy'); this.renderPanel(); } break; }
      case 'facsell': { const f = this.selFac(); if (f) { f.autoSell = !f.autoSell; this.renderPanel(); } break; }
      case 'facauto': { const f = this.selFac(); if (f) { f.auto = !f.auto; this.renderPanel(); } break; }
      case 'cartauto': { const c = this.selCart(); if (c) { c.auto = !c.auto; this.renderPanel(); } break; }
      case 'shopauto': { const sh = this.selShop(); if (sh) { sh.auto = !sh.auto; this.renderPanel(); } break; }
      case 'movecart': this.onTool('move'); break;
      case 'sellcart': { const c = this.selCart(); if (c && confirmInline(n)) { s.sellCart(c); this.select(null); } break; }
      case 'closeshop': { const sh = this.selShop(); if (sh && confirmInline(n)) { const b = sh.b; s.closeShop(sh); this.select({ k: 'bld', id: b }); } break; }
      case 'tobld': { const sh = this.selShop(); if (sh) this.select({ k: 'bld', id: sh.b }); break; }
      case 'stake': { const d = this.sel?.k === 'dep' ? s.s.deposits[this.sel.id] : null; if (d) { const q = s.stake(d); if (q) { this.onSfx('goal'); this.select({ k: 'quarry', id: q.id }); } else this.onSfx('bad'); } break; }
      case 'qup': { const q = this.selQuarry(); if (q) { s.upgradeQuarry(q); this.onSfx('buy'); this.renderPanel(); } break; }
      case 'qsell': { const q = this.selQuarry(); if (q) { q.autoSell = !q.autoSell; this.renderPanel(); } break; }
      case 'qsellnow': { const q = this.selQuarry(); if (q) { const d = s.s.deposits[q.dep]; const got = s.sell(d.ore, q.store[d.ore] ?? 0); if (got) { this.onSfx('coin'); this.toast(`Sold for ${money(got)}`, 'good'); } this.renderPanel(); } break; }
      case 'facsellnow': { const f = this.selFac(); if (f) { let got = 0; for (const [g, n2] of Object.entries(f.store)) if ((n2 as number) >= 1) { got += s.sell(g as GoodId, n2 as number); } if (got) { this.onSfx('coin'); this.toast(`Sold for ${money(got)}`, 'good'); } this.renderPanel(); } break; }
      case 'tocart': this.closeModal(); this.onTool('cart'); break;
      case 'tosurvey': this.closeModal(); this.onTool('survey'); break;
    }
  }

  private input(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.dataset.price) {
      const [k, id] = t.dataset.price.split('|');
      const o = k === 'c' ? this.selCart() : this.selShop();
      if (!o) return;
      o.prices[id] = Math.round(+t.value * 4) / 4;
      this.refresh();
    }
  }

  // ---------------------------------------------------------------- selection + side panel
  select(s: Sel) {
    this.sel = s;
    this.onSel(s);
    this.renderPanel();
  }
  flyToSel() {
    const s = this.sel, sim = this.sim;
    if (!s) return;
    if (s.k === 'cart') { const c = sim.cart(s.id); if (c) this.onFly(c.x, c.z); }
    else if (s.k === 'shop') { const sh = sim.shop(s.id); if (sh) { const b = this.city.buildings[sh.b]; this.onFly(b.door.x, b.door.z); } }
    else if (s.k === 'bld') { const b = this.city.buildings[s.id]; this.onFly(b.cx, b.cz); }
    else if (s.k === 'quarry') { const q = sim.s.quarries.find((x) => x.id === s.id); if (q) this.onFly(q.x, q.z); }
    else if (s.k === 'dep') { const d = sim.s.deposits[s.id]; this.onFly(d.x, d.z); }
  }
  selCart(): Cart | undefined { return this.sel?.k === 'cart' ? this.sim.cart(this.sel.id) : undefined; }
  selShop(): Shop | undefined { return this.sel?.k === 'shop' ? this.sim.shop(this.sel.id) : undefined; }
  selBld(): Building | undefined { return this.sel?.k === 'bld' ? this.city.buildings[this.sel.id] : undefined; }
  selFac(): Fac | undefined { return this.sel?.k === 'bld' ? this.sim.fac(this.sel.id) : undefined; }
  selQuarry(): Quarry | undefined { return this.sel?.k === 'quarry' ? this.sim.s.quarries.find((q) => q.id === (this.sel as any).id) : undefined; }

  renderPanel() {
    const w = this.el.panelwrap;
    this.binds = {};
    const s = this.sel;
    if (!s) { w.innerHTML = ''; return; }
    let h = '';
    if (s.k === 'cart') h = this.cartPanel();
    else if (s.k === 'shop') h = this.shopPanel();
    else if (s.k === 'bld') h = this.bldPanel();
    else if (s.k === 'dep') h = this.depPanel(this.sim.s.deposits[s.id]);
    else if (s.k === 'quarry') h = this.quarryPanel();
    if (!h) { this.sel = null; w.innerHTML = ''; return; }
    const scroll = w.querySelector('.pb')?.scrollTop ?? 0;
    const same = w.firstElementChild?.getAttribute('data-sel') === JSON.stringify(s);
    w.innerHTML = `<div class="panel glass" data-sel='${JSON.stringify(s)}' style="${same ? 'animation:none' : ''}">${h}</div>`;
    const pb = w.querySelector('.pb'); if (pb && same) pb.scrollTop = scroll;
    this.refresh();
  }

  private bind(name: string, f: () => string) { this.binds[name] = f; return `<span data-b="${name}">${f()}</span>`; }

  private priceRow(kind: 'c' | 's', m: MenuItem, price: number) {
    const id = m.id;
    const dm = () => {
      const r = price / m.fair;
      const o = kind === 'c' ? this.selCart() : this.selShop();
      const p = o ? o.prices[id] : price;
      const rr = p / m.fair;
      void r;
      const peak = peakMul(m.peak, this.sim.hour);
      const f = this.sim.priceF(p, m.fair) * peak;
      const label = rr <= 0.8 ? 'Bargain: lines, thin margin' : rr <= 1.08 ? 'Fair price' : rr <= 1.3 ? 'Pricey: fewer stop' : 'Too expensive';
      const col = rr <= 0.8 ? 'var(--blue)' : rr <= 1.08 ? 'var(--green)' : rr <= 1.3 ? 'var(--gold2)' : 'var(--red)';
      return `<span style="color:${col}">${label}</span> · demand now ${Math.round(f * 100)}%`;
    };
    return `<div class="price"><div class="row sp"><b><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.color};margin-right:6px"></i>${esc(m.name)}</b><span class="pv num">${this.bind('p' + id, () => { const o = kind === 'c' ? this.selCart() : this.selShop(); return money(o ? o.prices[id] : price, true); })}</span></div>
      <input type="range" min="${(m.fair * 0.4).toFixed(2)}" max="${(m.fair * 2).toFixed(2)}" step="0.25" value="${price}" data-price="${kind}|${id}"/>
      <div class="row sp"><span class="dm">${this.bind('d' + id, dm)}</span><span style="font-size:11px;color:var(--ink3)">fair ${money(m.fair, true)}</span></div></div>`;
  }

  private stockRows(st: Partial<Record<GoodId, number>>, goods: GoodId[], want: (g: GoodId) => number) {
    return goods.map((g) => `<div class="item">${gIcon(g, 30)}<div class="it"><b>${GOODS[g].name}</b><div class="bar"><i data-bw="${g}" style="width:${Math.min(100, ((st[g] ?? 0) / Math.max(1, want(g))) * 100)}%"></i></div></div><span class="num" style="font-weight:600">${this.bind('st' + g, () => (st[g] ?? 0).toFixed(1))}</span></div>`).join('');
  }

  private cartPanel(): string {
    const c = this.selCart();
    if (!c) return '';
    if (c.rival >= 0) {
      const r = this.sim.s.rivals[c.rival];
      const m = MENU_BY[c.menu[0]];
      return `<div class="ph"><button class="x" data-x="1">${svg('x')}</button><h2>${esc(r.name)} cart</h2><div class="meta">${esc(this.sim.streetAt(c.x, c.z))}</div><span class="chip"><i style="background:${r.color}"></i>Rival</span></div>
      <div class="pb"><div class="sec"><h3>Selling</h3><div class="item"><div class="it"><b>${esc(m.name)}</b><span>${money(c.prices[m.id], true)} each (fair ${money(m.fair, true)})</span></div></div><p class="note">Rivals split the crowd with you. Undercut them, or set up where they aren't.</p></div></div>`;
    }
    const goods = [...new Set(c.menu.map((m) => MENU_BY[m].good))];
    const ups = (['speed', 'sign', 'style'] as const).map((k) => {
      const lv = c.lv[k], cost = CART_UP[k][lv + 1];
      const label = { speed: 'Faster grill', sign: 'Bigger sign', style: 'Fresh look' }[k];
      const desc = { speed: 'serve quicker', sign: 'reach further', style: 'more stop' }[k];
      return `<div class="up ${cost === undefined ? 'max' : this.sim.can(cost) ? '' : 'poor'}" data-cup="${k}"><b>${label}</b><div class="pips">${[1, 2, 3, 4].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</div><span>${cost === undefined ? 'Max' : money(cost)}</span><div style="font-size:10.5px;color:var(--ink3)">${desc}</div></div>`;
    }).join('');
    return `<div class="ph"><button class="x" data-x="1">${svg('x')}</button><h2>${esc(c.name)}</h2><div class="meta">${esc(this.sim.streetAt(c.x, c.z))} · ${this.city.footAt(c.x, c.z)} people/h pass by</div></div>
      <div class="pb">
        <div class="sec stats"><div class="stat"><b class="num">${this.bind('ctoday', () => money(c.today))}</b><span>today</span></div><div class="stat"><b class="num">${this.bind('cserved', () => String(c.served))}</b><span>served</span></div><div class="stat"><b class="num">${this.bind('cline', () => String(this.lineOf('c:' + c.id)))}</b><span>in line</span></div></div>
        <p class="note mt">Click the cart on the map to serve the person at the front right away.</p>
        <div class="sec"><h3>Menu (up to 3)</h3><div class="menu">${MENU.map((m) => `<button class="${c.menu.includes(m.id) ? 'on' : ''}" data-menu="${m.id}"><i style="background:${m.color}"></i>${esc(m.name)}</button>`).join('')}</div></div>
        <div class="sec"><h3>Prices</h3>${c.menu.map((id) => this.priceRow('c', MENU_BY[id], c.prices[id])).join('')}</div>
        <div class="sec"><h3>Upgrades</h3><div class="ups">${ups}</div></div>
        <div class="sec"><h3>Ingredients</h3>${this.stockRows(c.stock, goods, (g) => c.menu.filter((m) => MENU_BY[m].good === g).reduce((a, m) => a + MENU_BY[m].use * 40, 0))}
          <div class="tog"><div>Auto-restock<span>A courier brings more from the Exchange (+10% fee) when your own trucks can't</span></div><div class="sw ${c.auto ? 'on' : ''}" data-act="cartauto"></div></div></div>
        <div class="sec row"><button class="btn ghost" data-act="movecart">Move</button><button class="btn red" data-act="sellcart">Sell cart</button></div>
      </div>`;
  }

  private shopPanel(): string {
    const sh = this.selShop();
    if (!sh) return '';
    const t = SHOP_BY[sh.type];
    const b = this.city.buildings[sh.b];
    const goods = [...new Set(t.items.map((m) => m.good))];
    const ups = (['crew', 'decor', 'ads'] as const).map((k) => {
      const lv = sh.lv[k], cost = SHOP_UP[k][lv + 1];
      const label = { crew: 'Hire crew', decor: 'Decor', ads: 'Ads' }[k];
      const desc = { crew: 'serve more at once', decor: 'more walk in', ads: 'reach further' }[k];
      return `<div class="up ${cost === undefined ? 'max' : this.sim.can(cost) ? '' : 'poor'}" data-sup="${k}"><b>${label}</b><div class="pips">${[1, 2, 3, 4].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</div><span>${cost === undefined ? 'Max' : money(cost)}</span><div style="font-size:10.5px;color:var(--ink3)">${desc}</div></div>`;
    }).join('');
    return `<div class="ph"><button class="x" data-x="1">${svg('x')}</button><h2>Your ${esc(t.name)}</h2><div class="meta">${esc(b.name || b.addr)} · ${b.traffic} people/h at the door</div><span class="chip"><i style="background:${t.color}"></i>${sh.rent ? `Rent ${money(sh.rent)}/day` : 'Rent-free: you own the building'}</span><span class="chip">Crew wages ${money(60 * (1 + sh.lv.crew))}/day</span></div>
      <div class="pb">
        <div class="sec stats"><div class="stat"><b class="num">${this.bind('stoday', () => money(sh.today))}</b><span>today</span></div><div class="stat"><b class="num">${this.bind('sserved', () => String(sh.served))}</b><span>served</span></div><div class="stat"><b class="num">${this.bind('sline', () => String(this.lineOf('s:' + sh.id)))}</b><span>waiting</span></div></div>
        <div class="sec"><h3>Prices</h3>${t.items.map((m) => this.priceRow('s', m, sh.prices[m.id])).join('')}</div>
        <div class="sec"><h3>Upgrades</h3><div class="ups">${ups}</div></div>
        <div class="sec"><h3>Stock</h3>${this.stockRows(sh.stock, goods, (g) => t.items.filter((m) => m.good === g).reduce((a, m) => a + m.use * (40 + 20 * sh.lv.crew), 0))}
          <div class="tog"><div>Auto-restock<span>Couriers top up from the Exchange (+10%) unless your trucks bring it</span></div><div class="sw ${sh.auto ? 'on' : ''}" data-act="shopauto"></div></div></div>
        <div class="sec row"><button class="btn ghost" data-act="tobld">The building</button><button class="btn red" data-act="closeshop">Close shop</button></div>
      </div>`;
  }

  private bldPanel(): string {
    const b = this.selBld();
    if (!b) return '';
    const sim = this.sim;
    const own = sim.ownerOf(b.id);
    const f = sim.fac(b.id);
    const ownChip = own === -1 ? `<span class="chip"><i style="background:var(--gold)"></i>Yours</span>` : own >= 0 ? `<span class="chip"><i style="background:${sim.s.rivals[own].color}"></i>${esc(sim.s.rivals[own].name)}</span>` : sim.s.forSale.includes(b.id) ? `<span class="chip"><i style="background:var(--green)"></i>For sale · 15% off</span>` : `<span class="chip"><i style="background:var(--ink3)"></i>Private owner</span>`;
    let body = '';
    if (f) body = this.facBody(f, b);
    else {
      const shops = sim.shopsIn(b.id);
      const rooms = [];
      for (let i = 0; i < b.units; i++) {
        const sh = shops[i];
        if (sh) rooms.push(`<div class="item click" data-fly="shop:${sh.id}"><span class="gico" style="background:${SHOP_BY[sh.type].color};color:#fff">${svg('shop')}</span><div class="it"><b>Your ${SHOP_BY[sh.type].name}</b><span>${this.bind('rs' + sh.id, () => money(sh.today))} today · ${sh.served} served</span></div></div>`);
        else rooms.push(`<div class="item"><span class="gico" style="background:#e9e1d1;color:var(--ink2)">${svg('shop')}</span><div class="it"><b>Room ${i + 1} · vacant</b><span>${own === -1 ? 'Free for you' : money(sim.unitRent(b)) + '/day rent'}</span></div><button class="btn gold" data-openshop="${b.id}" style="height:34px;padding:0 12px">Open shop</button></div>`);
      }
      body = `<div class="sec"><h3>Ground-floor rooms</h3>${rooms.join('')}</div>`;
      if (own === -1) body += `<div class="sec"><h3>Your building</h3><div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="num">${money(sim.tenantRent(b))}</b><span>tenant rent / day</span></div><div class="stat"><b class="num">${money(b.value * sim.s.propVal)}</b><span>market value</span></div></div>
        <button class="btn gold wide mt" data-act="develop">Redevelop: farm, factory, homes…</button><button class="btn red wide mt" data-act="sellbld">Sell for ${money(b.value * sim.s.propVal * 0.9)}</button></div>`;
    }
    const price = sim.buildingPrice(b);
    const buy = own === -1 ? '' : `<div class="sec"><h3>Buy the whole building</h3><div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="num">${money(price)}</b><span>${own >= 0 ? 'their asking price' : 'price'}</span></div><div class="stat"><b class="num">${money(b.value * sim.s.propVal * 0.028)}</b><span>rent / day as owner</span></div></div>
      <button class="btn ${sim.can(price) ? 'gold' : 'off'} wide mt" data-act="buybld">${sim.can(price) ? `Buy for ${money(price)}` : `Need ${money(price - sim.s.cash)} more`}</button><p class="note mt">Owners collect rent from every floor, pay no rent on their own shops, and can tear down to build farms, factories or apartments.</p></div>`;
    return `<div class="ph"><button class="x" data-x="1">${svg('x')}</button><h2>${esc(f ? FAC_BY[f.type].name : b.name || b.addr)}</h2><div class="meta">${esc(f || b.name ? b.addr : b.street || 'Side street')} · ${f ? '' : b.floors + ' floors · '}${Math.round(b.area)} m² footprint</div>${ownChip}<span class="chip">${b.traffic} people/h</span></div>
      <div class="pb">${body}${buy}</div>`;
  }

  private facBody(f: Fac, b: Building): string {
    const t = FAC_BY[f.type];
    const sim = this.sim;
    if (f.build < 1) return `<div class="sec"><h3>Under construction</h3><div class="bar" style="height:10px"><i data-bw="build" style="width:${f.build * 100}%;background:var(--gold2)"></i></div><p class="note mt">${esc(t.blurb)} Opens in about ${this.bind('bt', () => Math.max(0, Math.ceil((1 - f.build) * f.buildT)) + ' h')}.</p></div>`;
    const rate = sim.facRate(f);
    let h = '';
    if (t.recipe) {
      const ins = Object.entries(t.recipe.inp) as [GoodId, number][];
      const outs = Object.entries(t.recipe.out) as [GoodId, number][];
      h += `<div class="sec"><h3>Every hour (level ${f.lv})</h3><div class="row" style="flex-wrap:wrap;gap:6px">${ins.map(([g, n]) => `<span class="chip" style="margin:0">${gIcon(g, 18)} −${(n * rate).toFixed(0)} ${GOODS[g].name}</span>`).join('')}${ins.length ? '<span style="font-weight:700">→</span>' : ''}${outs.map(([g, n]) => `<span class="chip" style="margin:0;background:#e6f8ee">${gIcon(g, 18)} +${(n * rate).toFixed(0)} ${GOODS[g].name}</span>`).join('')}</div>
        <p class="note mt">Worth about <b>${money(outs.reduce((a, [g, n]) => a + n * rate * sim.sellPrice(g), 0) - ins.reduce((a, [g, n]) => a + n * rate * sim.buyPrice(g), 0))}</b>/h at today's prices · wages ${money(t.wage * f.lv)}/day</p></div>`;
      const goods = [...new Set([...ins.map((x) => x[0]), ...outs.map((x) => x[0])])];
      h += `<div class="sec"><h3>Storage</h3>${this.stockRows(f.store, goods, () => t.cap * 0.5)}
        <div class="tog"><div>Auto-sell output<span>Sell what your own sites don't need on the Exchange</span></div><div class="sw ${f.autoSell ? 'on' : ''}" data-act="facsell"></div></div>
        ${ins.length ? `<div class="tog"><div>Auto-buy inputs<span>Order missing inputs by courier when your quarries and farms can't</span></div><div class="sw ${f.auto ? 'on' : ''}" data-act="facauto"></div></div>` : ''}
        <button class="btn ghost wide" data-act="facsellnow">Sell everything in storage</button></div>`;
    } else if (t.rent) {
      h += `<div class="sec"><h3>Tenants</h3><div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="num">${money(t.rent * f.lv)}</b><span>rent / day</span></div><div class="stat"><b class="num">+${40 * f.lv}%</b><span>street foot traffic</span></div></div></div>`;
    } else {
      h += `<div class="sec"><h3>Stored</h3>${Object.keys(f.store).length ? this.stockRows(f.store, Object.keys(f.store) as GoodId[], () => t.cap / 4) : '<p class="note">Empty. Factories, farms and quarries send surplus here.</p>'}</div>`;
    }
    const up = sim.facUpCost(f);
    h += `<div class="sec"><button class="btn ${f.lv >= 5 ? 'off' : sim.can(up) ? 'gold' : 'off'} wide" data-act="facup">${f.lv >= 5 ? 'Max level' : `Upgrade to level ${f.lv + 1} · ${money(up)}`}</button>
      <button class="btn red wide mt" data-act="sellbld">Sell building + facility</button></div>`;
    void b;
    return h;
  }

  private depPanel(d: Deposit): string {
    const o = ORE_BY[d.ore];
    const cost = this.sim.claimCost(d);
    const worth = d.amount * this.sim.price(d.ore);
    return `<div class="ph"><button class="x" data-x="1">${svg('x')}</button><h2>${o.name} deposit</h2><div class="meta">Only you can see this · ${esc(this.sim.streetAt(d.x, d.z))}</div><span class="chip"><i style="background:${GOODS[d.ore].color}"></i>~${Math.round(d.amount).toLocaleString()} units</span></div>
      <div class="pb"><div class="sec stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="num">${money(worth)}</b><span>in the ground today</span></div><div class="stat"><b class="num">${o.rate}/h</b><span>dig rate (level 1)</span></div></div>
      <div class="sec"><button class="btn ${this.sim.can(cost) ? 'gold' : 'off'} wide" data-act="stake">${this.sim.can(cost) ? `Stake a quarry · ${money(cost)}` : `Need ${money(cost - this.sim.s.cash)} more to stake`}</button><p class="note mt">The quarry digs on its own and auto-sells what your factories don't use. Upgrades dig faster.</p></div></div>`;
  }

  private quarryPanel(): string {
    const q = this.selQuarry();
    if (!q) return '';
    const d = this.sim.s.deposits[q.dep];
    const o = ORE_BY[d.ore];
    const up = this.sim.quarryUpCost(q);
    return `<div class="ph"><button class="x" data-x="1">${svg('x')}</button><h2>${o.name} quarry</h2><div class="meta">Level ${q.lv} · ${(o.rate * (1 + 0.8 * (q.lv - 1))).toFixed(0)} units/h · wages ${money(40 * q.lv)}/day</div></div>
      <div class="pb"><div class="sec"><h3>Deposit</h3><div class="bar" style="height:10px"><i data-bw="dep" style="width:${(d.left / d.amount) * 100}%;background:${GOODS[d.ore].color}"></i></div><p class="note mt">${this.bind('qleft', () => Math.round(d.left).toLocaleString())} of ${Math.round(d.amount).toLocaleString()} left · mined ${this.bind('qmined', () => Math.round(q.mined).toLocaleString())}</p></div>
      <div class="sec"><h3>On site</h3>${this.stockRows(q.store, [d.ore], () => 260)}
      <div class="tog"><div>Auto-sell<span>Ship surplus to the Exchange; your factories get first pick</span></div><div class="sw ${q.autoSell ? 'on' : ''}" data-act="qsell"></div></div>
      <button class="btn ghost wide" data-act="qsellnow">Sell ${this.bind('qnow', () => Math.floor(q.store[d.ore] ?? 0) + ' ' + o.name)} now</button></div>
      <div class="sec"><button class="btn ${q.lv >= 5 ? 'off' : this.sim.can(up) ? 'gold' : 'off'} wide" data-act="qup">${q.lv >= 5 ? 'Max level' : `Dig faster · ${money(up)}`}</button></div></div>`;
  }

  lineOf: (key: string) => number = () => 0;
  onMini: (u: number, v: number) => void = () => {};

  // ---------------------------------------------------------------- per-frame: cash count-up, hype, confetti
  private shownCash = -1;
  tick(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    const c = sim.s.cash;
    if (this.shownCash < 0) this.shownCash = c;
    const d = c - this.shownCash;
    this.shownCash = Math.abs(d) < 0.5 ? c : this.shownCash + d * Math.min(1, dt * 7);
    const txt = money(this.shownCash);
    if (this.el.cash.textContent !== txt) this.el.cash.textContent = txt;
    // hype
    const fz = sim.frenzy;
    this.el.hype.classList.toggle('on', fz > 0);
    (this.el.hypebar as HTMLElement).style.width = (fz > 0 ? (fz / 25) * 100 : sim.hype * 100) + '%';
    const ht = fz > 0 ? `FRENZY ${Math.ceil(fz)}s · everyone wants in` : sim.hype > 0.8 ? 'Almost there…' : 'Every sale fills it. Full = Frenzy';
    if (this.el.hypet.textContent !== ht) this.el.hypet.textContent = ht;
    this.stepConfetti(dt);
  }

  // ---------------------------------------------------------------- confetti + banners
  private bits: { x: number; y: number; vx: number; vy: number; r: number; vr: number; c: string; w: number; h: number; t: number }[] = [];
  confetti(n = 120, x = innerWidth / 2, y = innerHeight * 0.3, spread = 1) {
    const cols = ['#ffc83d', '#ff5f6d', '#3d7be5', '#22b26b', '#ff9ec4', '#8a6cff', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (4 + Math.random() * 9) * spread;
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, t: 0 });
    }
  }
  private stepConfetti(dt: number) {
    const cv = this.el.confetti as HTMLCanvasElement;
    if (!this.bits.length) { if (cv.width) { cv.width = 0; } return; }
    if (cv.width !== innerWidth) { cv.width = innerWidth; cv.height = innerHeight; }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, cv.width, cv.height);
    const k = dt * 60;
    for (const b of this.bits) {
      b.t += dt; b.vy += 0.32 * k; b.vx *= Math.pow(0.985, k); b.x += b.vx * k; b.y += b.vy * k * 0.6; b.r += b.vr * k;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.globalAlpha = Math.max(0, 1 - b.t / 2.6);
      g.fillStyle = b.c; g.fillRect(-b.w / 2, -b.h / 2 * Math.abs(Math.cos(b.t * 8)), b.w, b.h * Math.abs(Math.cos(b.t * 8)) + 1); g.restore();
    }
    this.bits = this.bits.filter((b) => b.t < 2.6 && b.y < innerHeight + 40);
  }
  private bannerT: ReturnType<typeof setTimeout> | null = null;
  banner(title: string, sub: string, color = '#ffc83d') {
    const b = this.el.banner;
    b.innerHTML = `<b style="--bc:${color}">${esc(title)}</b><span>${esc(sub)}</span>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    if (this.bannerT) clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- city orders
  private ordersKey = '';
  renderOrders(force = false) {
    const sim = this.sim;
    const os = sim.s.orders;
    const key = os.map((o) => o.id + ':' + (o.kind === 'deliver' ? (o.have >= o.need ? 1 : 0) : 0)).join(',');
    const w = this.el.orders;
    if (key !== this.ordersKey || force) {
      this.ordersKey = key;
      w.innerHTML = os.length ? `<div class="oh">City orders</div>` + os.map((o) => {
        const ico = o.kind === 'serve' ? svg('cart') : o.kind === 'earn' ? svg('ex') : o.good ? '' : '';
        const icon = o.kind === 'deliver' && o.good ? gIcon(o.good, 30) : `<span class="gico" style="width:30px;height:30px;background:${o.kind === 'serve' ? '#e5533d' : '#22b26b'};color:#fff">${ico}</span>`;
        const btn = o.kind === 'deliver' ? `<button class="obtn ${o.have >= o.need ? '' : 'off'}" data-order="${o.id}">Deliver</button>` : '';
        return `<div class="ord glass" data-oid="${o.id}">${icon}<div class="ot"><b>${esc(o.title)}</b><div class="bar"><i data-ob="${o.id}"></i></div><span data-ol="${o.id}"></span></div><div class="op">+${money(o.pay)}${btn}</div></div>`;
      }).join('') : '';
    }
    for (const o of os) {
      const bar = w.querySelector(`[data-ob="${o.id}"]`) as HTMLElement | null;
      if (bar) bar.style.width = Math.min(100, (o.have / o.need) * 100) + '%';
      const l = w.querySelector(`[data-ol="${o.id}"]`) as HTMLElement | null;
      const left = Math.max(0, o.until - sim.s.t);
      const prog = o.kind === 'earn' ? `${money(o.have)} / ${money(o.need)}` : `${Math.floor(o.have)} / ${o.need}`;
      const txt = `${prog} · ${left >= 1 ? Math.floor(left) + 'h' : Math.round(left * 60) + 'min'} left`;
      if (l && l.textContent !== txt) l.textContent = txt;
    }
  }

  // ---------------------------------------------------------------- minimap
  private miniBg: HTMLCanvasElement | null = null;
  drawMini(cam: { x: number; z: number; fx: number; fz: number; d: number }, marks: { x: number; z: number; c: string; r: number }[]) {
    const cv = this.el.mini as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const c = this.city;
    const S = cv.width, sc = S / Math.max(c.W, c.D) * 0.96;
    const X = (x: number) => S / 2 + x * sc, Z = (z: number) => S / 2 + z * sc;
    if (!this.miniBg) {
      const bg = document.createElement('canvas');
      bg.width = bg.height = S;
      const b = bg.getContext('2d')!;
      b.fillStyle = '#efe6d4'; b.fillRect(0, 0, S, S);
      for (const p of c.parks) { b.fillStyle = p.kind === 1 ? '#8cc8ec' : '#a9d98f'; b.beginPath(); for (let i = 0; i < p.pts.length; i += 2) (i ? b.lineTo : b.moveTo).call(b, X(p.pts[i]), Z(p.pts[i + 1])); b.fill(); }
      b.lineCap = 'round';
      for (const e of c.edges) { b.strokeStyle = e.cls >= 5 ? '#e4d6bb' : '#ffffff'; b.lineWidth = Math.max(1.2, e.w * sc * 0.9); b.beginPath(); b.moveTo(X(c.nx[e.a]), Z(c.nz[e.a])); b.lineTo(X(c.nx[e.b]), Z(c.nz[e.b])); b.stroke(); }
      b.fillStyle = '#d7c8ae';
      for (const bd of c.buildings) { b.beginPath(); for (let i = 0; i < bd.pts.length; i += 2) (i ? b.lineTo : b.moveTo).call(b, X(bd.pts[i]), Z(bd.pts[i + 1])); b.fill(); }
      this.miniBg = bg;
    }
    g.drawImage(this.miniBg, 0, 0);
    // owned buildings in gold, rivals in their colours
    const sim = this.sim;
    for (const id of sim.s.owned) { const bd = c.buildings[id]; g.fillStyle = '#f2a91c'; g.beginPath(); for (let i = 0; i < bd.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(bd.pts[i]), Z(bd.pts[i + 1])); g.fill(); }
    for (const m of marks) { g.fillStyle = m.c; g.beginPath(); g.arc(X(m.x), Z(m.z), m.r, 0, 6.283); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    // the view: a wedge from the camera toward where it looks
    const vx = X(cam.x), vz = Z(cam.z);
    const r = Math.max(14, cam.d * sc * 0.6);
    const a = Math.atan2(cam.fz, cam.fx);
    g.fillStyle = 'rgba(35,32,27,0.12)'; g.strokeStyle = 'rgba(35,32,27,0.7)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(vx - Math.cos(a) * r * 0.5, vz - Math.sin(a) * r * 0.5); g.arc(vx - Math.cos(a) * r * 0.5, vz - Math.sin(a) * r * 0.5, r * 1.2, a - 0.55, a + 0.55); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#23201b'; g.beginPath(); g.arc(vx, vz, 4, 0, 6.283); g.fill();
  }

  // ---------------------------------------------------------------- modals
  modal(kind: string, arg?: number) {
    this.modalKind = kind;
    this.modalArg = arg ?? -1;
    this.renderModal();
  }
  private modalArg = -1;
  closeModal() { this.modalKind = ''; this.el.modalwrap.innerHTML = ''; }
  get modalOpen() { return !!this.modalKind; }

  renderModal() {
    const k = this.modalKind;
    if (!k) return;
    let h = '';
    const sim = this.sim;
    if (k === 'exchange') h = this.exchangeModal();
    else if (k === 'empire') h = this.empireModal();
    else if (k === 'ranks') h = this.ranksModal();
    else if (k === 'trucks') h = this.trucksModal();
    else if (k === 'shoptype') {
      const b = this.city.buildings[this.modalArg];
      const rent = sim.isMine(b.id) ? 0 : sim.unitRent(b);
      h = `<div class="modal glass"><div class="mh"><div><h1>Open a shop</h1><p>${esc(b.name || b.addr)} · ${b.traffic} people/h at the door · ${rent ? money(rent) + '/day rent' : 'rent-free'}</p></div><button class="btn ghost" data-close="1">Close</button></div><div class="mb"><div class="cards">${SHOPS.map((t) => {
        const cost = t.fitout + rent;
        return `<div class="card ${sim.can(cost) ? '' : 'no'}" data-shoptype="${b.id}:${t.id}"><div class="sw8" style="background:${t.color}"></div><b>${t.name}</b><div class="cd">Sells ${t.items.map((m) => m.name.toLowerCase()).join(', ')}</div><div class="cd">Needs ${[...new Set(t.items.map((m) => GOODS[m.good].name))].join(', ')}</div><div class="cc">${money(cost)}</div></div>`;
      }).join('')}</div></div></div>`;
    } else if (k === 'factype') {
      const b = this.city.buildings[this.modalArg];
      h = `<div class="modal glass"><div class="mh"><div><h1>Redevelop</h1><p>Tear down ${esc(b.name || b.addr)} and build something that makes money</p></div><button class="btn ghost" data-close="1">Close</button></div><div class="mb"><div class="cards">${FACILITIES.map((f) => {
        const miss = sim.missingMats(f.id);
        const total = f.cost + miss.reduce((a, m) => a + m.cost, 0);
        const r = f.recipe;
        const flow = r ? `${Object.keys(r.inp).map((g) => GOODS[g as GoodId].name).join(' + ') || 'Nothing'} → ${Object.keys(r.out).map((g) => GOODS[g as GoodId].name).join(' + ')}` : f.rent ? `${money(f.rent)}/day rent, busier streets` : 'Storage';
        return `<div class="card ${sim.can(total) ? '' : 'no'}" data-factype="${b.id}:${f.id}"><div class="sw8" style="background:${f.color}"></div><b>${f.name}</b><div class="cd">${esc(flow)}</div><div class="cd">${esc(f.blurb)}</div><div class="cd">Materials: ${Object.entries(f.mats).map(([g, n]) => `${n} ${GOODS[g as GoodId].name}`).join(', ')}${miss.length ? ' (bought for you)' : ''}</div><div class="cc">${money(total)}</div></div>`;
      }).join('')}</div></div></div>`;
    } else if (k === 'month') h = this.monthHtml;
    else if (k === 'away') h = this.awayHtml;
    this.el.modalwrap.innerHTML = `<div class="veil">${h}</div>`;
  }
  monthHtml = '';
  awayHtml = '';

  private spark(hist: number[], color: string) {
    const lo = Math.min(...hist), hi = Math.max(...hist);
    const pts = hist.map((v, i) => `${(i / (hist.length - 1)) * 70},${24 - ((v - lo) / (hi - lo || 1)) * 22}`).join(' ');
    return `<svg class="spark" viewBox="0 0 70 26"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  private exchangeModal(): string {
    const sim = this.sim;
    const stock = sim.stockByGood();
    const g = this.exSel;
    const G = GOODS[g];
    const hist = sim.s.hist[g];
    const ch = hist.length > 24 ? hist[hist.length - 1] / hist[hist.length - 24] - 1 : 0;
    const tiles = GOOD_IDS.map((id) => {
      const h = sim.s.hist[id];
      const c = h.length > 24 ? h[h.length - 1] / h[h.length - 24] - 1 : 0;
      const own = Math.floor(stock[id] ?? 0);
      return `<div class="tile ${id === g ? 'sel' : ''}" data-good="${id}">${gIcon(id)}${this.spark(h, c >= 0 ? '#22b26b' : '#e5533d')}${own ? `<span class="own">${own}</span>` : ''}<div class="tn">${G.id === id ? '' : ''}${GOODS[id].name}</div><div class="tp num">${money(sim.price(id), true)}</div><div class="tc ${c >= 0 ? 'up-c' : 'dn-c'}">${pct(c)}</div></div>`;
    }).join('');
    const own = stock[g] ?? 0;
    const dests: { key: string; name: string }[] = [];
    for (const f of sim.s.facs) if (f.build >= 1 && (FAC_BY[f.type].recipe?.inp[g] !== undefined || f.type === 'warehouse')) dests.push({ key: 'f:' + f.b, name: FAC_BY[f.type].name });
    const qty = [10, 50, 200];
    return `<div class="modal glass"><div class="mh"><div><h1>Exchange</h1><p>One market for the whole world. Selling a lot pushes the price down.</p></div><button class="btn ghost" data-close="1">Close</button></div>
      <div class="mb"><div class="row" style="align-items:stretch;gap:16px;flex-wrap:wrap">
        <div style="flex:2;min-width:300px"><div class="grid">${tiles}</div></div>
        <div style="flex:1;min-width:240px;background:var(--panel2);border-radius:16px;padding:16px">
          <div class="row">${gIcon(g, 44)}<div><div style="font-size:20px;font-weight:700">${G.name}</div><div class="num" style="font-size:13px"><span class="${ch >= 0 ? 'up-c' : 'dn-c'}">${pct(ch)}</span> today</div></div></div>
          <div class="stats mt" style="grid-template-columns:1fr 1fr"><div class="stat" style="background:#fff"><b class="num">${money(sim.sellPrice(g), true)}</b><span>you sell at</span></div><div class="stat" style="background:#fff"><b class="num">${money(sim.buyPrice(g), true)}</b><span>you buy at</span></div></div>
          <div class="sec"><h3>You hold ${Math.floor(own)}</h3><div class="row" style="flex-wrap:wrap">${[10, 100].map((q) => `<button class="btn ${own >= q ? '' : 'off'}" data-sell="${q}">Sell ${q}</button>`).join('')}<button class="btn gold ${own >= 1 ? '' : 'off'}" data-sell="all">Sell all · ${money(own * sim.sellPrice(g))}</button></div></div>
          <div class="sec"><h3>Buy (courier +10%)</h3>${dests.length ? dests.map((d) => `<div class="note" style="margin:6px 0 4px">to ${esc(d.name)}</div><div class="row">${qty.map((q) => `<button class="btn ghost" data-buyg="${d.key}|${q}" style="height:34px;padding:0 10px">${q} · ${money(q * sim.buyPrice(g) * 1.1)}</button>`).join('')}</div>`).join('') : '<p class="note">Goods need somewhere to go: build a factory that uses this, or a warehouse. Carts and shops restock themselves.</p>'}</div>
        </div></div></div></div>`;
  }

  private empireModal(): string {
    const sim = this.sim;
    const s = sim.s;
    const nw = sim.netWorth();
    const carts = sim.myCarts();
    const rows: string[] = [];
    const sec = (title: string, items: string[], empty: string) => `<div class="sec"><h3>${title}</h3>${items.length ? items.join('') : `<p class="note">${empty}</p>`}</div>`;
    rows.push(sec(`Carts (${carts.length})`, carts.map((c) => `<div class="item click" data-fly="cart:${c.id}"><span class="gico" style="background:${MENU_BY[c.menu[0]].color};color:#fff">${svg('cart')}</span><div class="it"><b>${esc(c.name)} · ${c.menu.map((m) => MENU_BY[m].name).join(', ')}</b><span>${esc(sim.streetAt(c.x, c.z))} · ${money(c.today)} today · ${money(c.sales)} all-time</span></div></div>`), 'No carts yet. Park one from the dock.'));
    rows.push(sec(`Shops (${s.shops.length})`, s.shops.map((sh) => `<div class="item click" data-fly="shop:${sh.id}"><span class="gico" style="background:${SHOP_BY[sh.type].color};color:#fff">${svg('shop')}</span><div class="it"><b>${SHOP_BY[sh.type].name}</b><span>${esc(this.city.buildings[sh.b].addr)} · ${money(sh.today)} today</span></div></div>`), 'Rent a room in any building to open one.'));
    rows.push(sec(`Buildings (${s.owned.length})`, s.owned.map((id) => { const b = this.city.buildings[id]; const f = sim.fac(id); return `<div class="item click" data-fly="bld:${id}"><span class="gico" style="background:${f ? FAC_BY[f.type].color : '#ffc83d'};color:#fff">${svg(f ? 'gear' : 'bld')}</span><div class="it"><b>${esc(f ? FAC_BY[f.type].name : b.name || b.addr)}</b><span>${esc(b.addr)} · worth ${money(b.value * s.propVal)}${f ? (f.build < 1 ? ' · building…' : ` · level ${f.lv}`) : ` · ${money(sim.tenantRent(b))}/day rent`}</span></div></div>`; }), 'Buy a building to collect rent and redevelop.'));
    rows.push(sec(`Quarries (${s.quarries.length})`, s.quarries.map((q) => { const d = s.deposits[q.dep]; return `<div class="item click" data-fly="quarry:${q.id}">${gIcon(d.ore)}<div class="it"><b>${ORE_BY[d.ore].name} quarry</b><span>${Math.round(d.left).toLocaleString()} left · level ${q.lv}</span></div></div>`; }), 'Survey for ore, then stake a claim.'));
    const found = s.deposits.filter((d) => d.found && !d.claimed);
    if (found.length) rows.push(sec(`Unclaimed finds (${found.length})`, found.map((d) => `<div class="item click" data-fly="dep:${d.id}">${gIcon(d.ore)}<div class="it"><b>${ORE_BY[d.ore].name}</b><span>~${Math.round(d.amount).toLocaleString()} units · claim ${money(sim.claimCost(d))}</span></div></div>`), ''));
    const tier = tierOf(nw);
    return `<div class="modal glass"><div class="mh"><div><h1>${esc(s.company)}</h1><p>${tier.name} · day ${sim.day} · everything you own, in one place</p></div><button class="btn ghost" data-close="1">Close</button></div>
      <div class="mb"><div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><b class="num">${money(s.cash)}</b><span>cash</span></div><div class="stat"><b class="num">${money(nw)}</b><span>net worth</span></div><div class="stat"><b class="num">${money(s.stats.sales)}</b><span>all-time sales</span></div><div class="stat"><b class="num">${s.trophies.length ? s.trophies.map((t) => `<span class="medal m${t}">${t}</span>`).join(' ') : '—'}</b><span>trophies ${sim.trophyBonus() ? `(+${Math.round(sim.trophyBonus() * 100)}% income)` : ''}</span></div></div>${rows.join('')}</div></div>`;
  }

  private ranksModal(): string {
    const sim = this.sim;
    const rows = sim.standings();
    const left = sim.monthLeft;
    return `<div class="modal glass sm" style="width:min(620px,94vw)"><div class="mh"><div><h1>Month ${sim.month}</h1><p>Ranked by growth this month · ${left.toFixed(1)} days left · top 3 win trophies</p></div><button class="btn ghost" data-close="1">Close</button></div>
      <div class="mb"><table class="lb">${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="rk">${i < 3 ? `<span class="medal m${i + 1}">${i + 1}</span>` : i + 1}</td><td><span class="dt" style="background:${r.color}"></span>${esc(r.name)}</td><td class="r num ${r.growth >= 0 ? 'up-c' : 'dn-c'}">${r.growth >= 0 ? '+' : ''}${money(r.growth)}</td><td class="r num" style="color:var(--ink2)">${money(r.nw)}</td></tr>`).join('')}</table>
      <p class="note mt">Gold adds +6% to all your income for good, silver +4%, bronze +2%. They stack.</p></div></div>`;
  }

  private trucksModal(): string {
    const sim = this.sim;
    const mine = sim.vehicles.filter((v) => v.own);
    const busy = mine.filter((v) => v.phase !== 'idle').length;
    const cost = sim.truckCost();
    return `<div class="modal glass sm"><div class="mh"><div><h1>Trucks</h1><p>Your fleet hauls between your own sites by itself</p></div><button class="btn ghost" data-close="1">Close</button></div>
      <div class="mb"><div class="stats" style="grid-template-columns:1fr 1fr 1fr"><div class="stat"><b class="num">${mine.length}</b><span>trucks</span></div><div class="stat"><b class="num">${busy}</b><span>on the road</span></div><div class="stat"><b class="num">${money(30 * mine.length)}</b><span>wages / day</span></div></div>
      <p class="note mt">Quarries and farms feed your factories, factories feed your shops and carts. A truck carries 40 units. Without a free truck, sites order from the Exchange by courier (+10%).</p>
      ${mine.map((v, i) => `<div class="item"><span class="gico" style="background:#ffc83d">${svg('truck')}</span><div class="it"><b>Truck ${i + 1}</b><span>${v.phase === 'idle' ? 'Waiting for a job' : v.phase === 'pick' ? `Picking up ${v.good ? GOODS[v.good].name : ''}` : `Delivering ${v.n} ${v.good ? GOODS[v.good].name : ''}`}</span></div></div>`).join('')}
      <button class="btn ${sim.can(cost) ? 'gold' : 'off'} wide mt" data-act="buytruck">Buy a truck · ${money(cost)}</button></div></div>`;
  }

  // ---------------------------------------------------------------- live refresh (4 Hz)
  refresh() {
    const sim = this.sim;
    if (!sim) return;
    const s = sim.s;
    const nw = sim.netWorth();
    const tier = tierOf(nw);
    const e = this.el;
    e.av.textContent = s.company.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    e.av.style.setProperty('--ring', tier.color);
    e.nm.textContent = s.company;
    e.tier.textContent = tier.name;
    if (s.cash > this.lastCash + 0.5) { e.cash.classList.remove('up'); void e.cash.offsetWidth; e.cash.classList.add('up'); }
    this.lastCash = s.cash;
    const hist = [...s.nwHist.slice(-40), nw];
    if (hist.length > 2) {
      const lo = Math.min(...hist), hi = Math.max(...hist);
      const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * 70).toFixed(1)},${(36 - ((v - lo) / (hi - lo || 1)) * 32).toFixed(1)}`).join(' ');
      const up = hist[hist.length - 1] >= hist[0];
      e.spark.innerHTML = `<polyline points="0,40 ${pts} 70,40" fill="${up ? 'rgba(34,178,107,0.14)' : 'rgba(229,83,61,0.12)'}" stroke="none"/><polyline points="${pts}" fill="none" stroke="${up ? '#22b26b' : '#e5533d'}" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    }
    this.renderOrders();
    e.nw.textContent = money(nw);
    e.rate.textContent = sim.incomeRate > 0.05 ? `+${money(sim.incomeRate * 60)}/min` : '';
    const h = sim.hour;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 10) * 10;
    e.tm.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
    e.dy.textContent = `Day ${sim.day} · month ${sim.month}, ${Math.ceil(sim.monthLeft)}d left`;
    const day = h > 6 && h < 20;
    e.sun.innerHTML = day ? `<circle cx="15" cy="15" r="6" fill="#ffc83d"/><g stroke="#ffc83d" stroke-width="2.2" stroke-linecap="round">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return `<line x1="${15 + Math.cos(a) * 9.5}" y1="${15 + Math.sin(a) * 9.5}" x2="${15 + Math.cos(a) * 12.5}" y2="${15 + Math.sin(a) * 12.5}"/>`; }).join('')}</g>` : `<path d="M19 21a8 8 0 0 1-6-14 9 9 0 1 0 10 10 8 8 0 0 1-4 4z" fill="#8fa6ff"/>`;
    const rows = sim.standings();
    e.rank.textContent = '#' + (rows.findIndex((r) => r.me) + 1);
    const n = sim.myCarts().length;
    e.cartcost.textContent = n === 0 ? 'FREE' : money(CART_COST(n));
    e.survcost.textContent = money(SURVEY_COST(s.stats.surveys));
    for (const [k, f] of Object.entries(this.binds)) {
      const el = this.root.querySelector(`[data-b="${k}"]`);
      if (el) { const v = f(); if (el.innerHTML !== v) el.innerHTML = v; }
    }
    // stock bars + build progress
    const pan = this.root.querySelector('.panel');
    if (pan) {
      const sel = this.sel;
      const st = sel?.k === 'cart' ? this.selCart()?.stock : sel?.k === 'shop' ? this.selShop()?.stock : sel?.k === 'bld' ? this.selFac()?.store : sel?.k === 'quarry' ? this.selQuarry()?.store : undefined;
      pan.querySelectorAll('[data-bw]').forEach((b) => {
        const k = (b as HTMLElement).dataset.bw!;
        if (k === 'build') { const f = this.selFac(); if (f) (b as HTMLElement).style.width = f.build * 100 + '%'; if (f && f.build >= 1) this.renderPanel(); }
        else if (k === 'dep') { const q = this.selQuarry(); if (q) { const d = sim.s.deposits[q.dep]; (b as HTMLElement).style.width = (d.left / d.amount) * 100 + '%'; } }
        else if (st) { const cur = parseFloat((b as HTMLElement).style.width) || 0; const tgt = Math.min(100, ((st[k as GoodId] ?? 0) / 4) * 25); void cur; void tgt; }
      });
    }
    // ticker
    const key = sim.ticker.length + ':' + (sim.ticker[sim.ticker.length - 1]?.text ?? '');
    if (key !== this.tickerKey) {
      this.tickerKey = key;
      const items = sim.ticker.slice(-14).reverse();
      const prices = GOOD_IDS.filter((_, i) => i % 3 === sim.day % 3).map((g) => `${GOODS[g].name} ${money(sim.price(g), true)}`).join(' · ');
      e.tick.innerHTML = items.map((t) => `<span class="${t.kind}">${esc(t.text)}</span>`).join('') + `<span class="market">${esc(prices)}</span>`;
    }
    if (this.modalKind === 'ranks' || this.modalKind === 'trucks') this.modalTick++ % 8 === 0 && this.renderModal();
  }
  private modalTick = 0;

  drawQuest() {
    const s = this.sim.s;
    const q = QUESTS[s.quest];
    const e = this.el.quest;
    if (!q) { e.innerHTML = `<div class="qn">★</div><div><div class="qt">Every goal done. Own the city.</div><div class="qh">Keep winning months for trophies.</div></div>`; return; }
    e.innerHTML = `<div class="qn">${s.quest + 1}</div><div><div class="qt">${esc(q.text)}</div><div class="qh">${esc(q.hint)}</div></div><div class="qr">+${money(q.reward)}</div>`;
  }
  questDone(i: number) {
    const q = QUESTS[i];
    this.toast(`Goal done: ${q.text} · +${money(q.reward)}`, 'good');
    const e = this.el.quest;
    e.classList.remove('done'); void e.offsetWidth; e.classList.add('done');
    this.drawQuest();
  }

  toast(text: string, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), 4100);
  }
  pop(x: number, y: number, text: string, cls = '') {
    const p = document.createElement('div');
    p.className = 'pop ' + cls;
    p.textContent = text;
    p.style.left = x + 'px'; p.style.top = y + 'px';
    this.el.pops.appendChild(p);
    if (this.el.pops.children.length > 40) this.el.pops.firstElementChild!.remove();
    setTimeout(() => p.remove(), 1150);
  }
  tip(x: number, y: number, html: string | null) {
    const t = this.el.tip;
    if (!html) { t.style.display = 'none'; return; }
    t.innerHTML = html;
    t.style.display = '';
    t.style.left = Math.min(x, innerWidth - 300) + 'px';
    t.style.top = Math.min(y, innerHeight - 120) + 'px';
  }
  /** queue-length badges over my carts and shops */
  lines(items: { x: number; y: number; n: number; full: boolean; label?: string; color?: string }[]) {
    const w = this.el.lines;
    while (w.children.length < items.length) { const d = document.createElement('div'); d.className = 'line'; w.appendChild(d); }
    while (w.children.length > items.length) w.lastElementChild!.remove();
    items.forEach((it, i) => {
      const d = w.children[i] as HTMLElement;
      d.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%, -100%)`;
      d.className = 'line' + (it.full ? ' full' : '');
      const t = `<i style="background:${it.color ?? '#ffc83d'}"></i>${it.label ?? ''}${it.n ? `<em>${it.full ? 'FULL ' : ''}${it.n}<small>in line</small></em>` : ''}`;
      if (d.innerHTML !== t) d.innerHTML = t;
    });
  }

  monthEnd(rank: number, rows: { name: string; growth: number; me: boolean }[]) {
    const medal = rank <= 3 ? `<span class="medal m${rank}" style="width:64px;height:64px;font-size:28px">${rank}</span>` : '';
    this.monthHtml = `<div class="modal glass sm"><div class="mh"><div><h1>${rank <= 3 ? 'Trophy!' : 'Month closed'}</h1><p>You finished #${rank} of ${rows.length}</p></div></div><div class="mb" style="text-align:center">${medal}
      <p style="font-size:15px">${rank <= 3 ? `+${rank === 1 ? 6 : rank === 2 ? 4 : 2}% to all your income, for good.` : `Top 3 win trophies. ${esc(rows[0].name)} grew ${money(rows[0].growth)}.`}</p>
      <table class="lb" style="text-align:left">${rows.slice(0, 5).map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="rk">${i + 1}</td><td>${esc(r.name)}</td><td class="r num">+${money(r.growth)}</td></tr>`).join('')}</table>
      <button class="btn gold wide mt" data-close="1">New month: let's go</button></div></div>`;
    this.modal('month');
  }
  away(r: { sec: number; earned: number; mined: number; made: number }) {
    const hrs = r.sec / 3600;
    this.awayHtml = `<div class="modal glass sm"><div class="mh"><div><h1>Welcome back</h1><p>You were away ${hrs >= 1 ? hrs.toFixed(1) + ' hours' : Math.round(r.sec / 60) + ' minutes'}. Business kept running.</p></div></div><div class="mb">
      <div class="stats" style="grid-template-columns:1fr 1fr 1fr"><div class="stat"><b class="num up-c">+${money(r.earned)}</b><span>earned</span></div><div class="stat"><b class="num">${Math.round(r.mined).toLocaleString()}</b><span>ore mined</span></div><div class="stat"><b class="num">${Math.round(r.made).toLocaleString()}</b><span>goods made</span></div></div>
      <button class="btn gold wide mt" data-close="1">Collect</button></div></div>`;
    this.modal('away');
  }
}

/** An illustrated skyline for the title: layered blocks with lit windows, a cart and its umbrella. */
function skyline(): string {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const W = 1600, H = 300;
  let out = '';
  const layers = [{ c: '#f1d9b0', y: 0.25, hmin: 80, hmax: 230, win: 'rgba(255,255,255,0.35)' }, { c: '#e8c48c', y: 0.5, hmin: 60, hmax: 190, win: 'rgba(255,246,220,0.55)' }, { c: '#d9a75c', y: 0.75, hmin: 40, hmax: 140, win: 'rgba(255,240,200,0.6)' }];
  for (const L of layers) {
    let x = -20;
    while (x < W) {
      const w = 40 + r() * 90, h = L.hmin + r() * (L.hmax - L.hmin);
      out += `<rect x="${x.toFixed(0)}" y="${(H - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="3" fill="${L.c}"/>`;
      for (let wy = H - h + 12; wy < H - 14; wy += 16) for (let wx = x + 8; wx < x + w - 12; wx += 14) if (r() < 0.5) out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="6" height="8" rx="1" fill="${L.win}"/>`;
      if (r() < 0.2) out += `<rect x="${(x + w / 2 - 2).toFixed(0)}" y="${(H - h - 26).toFixed(0)}" width="4" height="26" fill="${L.c}"/>`;
      x += w + 4 + r() * 10;
    }
  }
  out += `<rect x="0" y="${H - 6}" width="${W}" height="6" fill="#c98a3c"/>`;
  // a little cart on the kerb
  const cx = 1180;
  out += `<g transform="translate(${cx},${H - 46})"><rect x="0" y="16" width="44" height="22" rx="4" fill="#fff"/><rect x="0" y="14" width="44" height="5" fill="#e5533d"/><circle cx="10" cy="40" r="5" fill="#23201b"/><circle cx="34" cy="40" r="5" fill="#23201b"/><rect x="21" y="-14" width="2" height="30" fill="#23201b"/><path d="M-6 -10 Q22 -34 50 -10 Z" fill="#ffc83d"/></g>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">${out}</svg>`;
}

/** Two-step confirm on the same button: first click arms it. */
function confirmInline(b: HTMLElement): boolean {
  if (b.dataset.armed) return true;
  b.dataset.armed = '1';
  const old = b.innerHTML;
  b.innerHTML = 'Sure? Click again';
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.innerHTML = old; } }, 2500);
  return false;
}
