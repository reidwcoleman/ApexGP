// The city screen: a 3D diorama of one settlement with the controls to run it.
// Answers "how is this city doing and what should it build next?"
import { FACTIONS, RANKS } from '../data/factions.js';
import { UNITS } from '../data/units.js';
import {
  BUILDINGS, BLD_KEYS, TIERS, TAX, RESOURCES, tierOf, resourceOf, cityIncome, cityOrder, popCap, growthRate, orderLabel,
  usedSlots, plannedLevel, cancelBuild, gamesCost, goodsOf,
} from './city.js';
import { canBuild, build, canRecruit, recruit, unitCost, rosterFor, armiesIn, provsOf, goodsBonus, defencePower } from './state.js';
import { CityView } from './cityview.js';
import { ICONS, BLD_ICON, RES_ICON, unitArt } from '../ui/icons.js';
import { audio } from '../audio.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sgn = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
const kfmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : fmt(n));

export class CityScreen {
  constructor(ctl, prov, { onClose } = {}) {
    this.ctl = ctl; this.s = ctl.s; this.world = ctl.world; this.renderer = ctl.renderer;
    this.prov = prov; this.onClose = onClose;
    this.tab = 'build';
    this.root = document.createElement('div');
    this.root.className = 'cityscreen';
    ctl.uiRoot.appendChild(this.root);
    this.open(prov);
    this.bind();
  }

  get pr() { return this.s.provs[this.prov]; }
  get p() { return this.world.provinces[this.prov]; }
  get mine() { return this.pr.owner === this.s.player; }

  open(prov) {
    this.view?.dispose();
    this.prov = prov;
    this.view = new CityView(this.renderer, this.world, this.s, prov);
    const pr = this.pr;
    this.sel = pr.queue[0]?.b || this.suggest() || 'market';
    this.view.setHighlight(this.sel, true);
    this.render();
  }

  // the building we'd recommend next: affordable and useful
  suggest() {
    const order = ['market', 'farm', 'temple', 'barracks', 'walls', 'aqueduct', 'port', 'mine', 'smithy', 'arena', 'stables', 'academy'];
    for (const b of order) if (canBuild(this.s, this.world, this.prov, b).ok) return b;
    return null;
  }

  visibleKeys() {
    const p = this.p;
    return BLD_KEYS.filter((k) => !(k === 'port' && !p.coastal) && !(k === 'mine' && RESOURCES[resourceOf(p)].kind !== 'metal'));
  }

  myCities() { return this.s.provs.map((pr, i) => (pr.owner === this.s.player ? i : -1)).filter((i) => i >= 0); }

  // ---------------------------------------------------------------- DOM
  render() {
    const s = this.s, w = this.world, i = this.prov, pr = this.pr, p = this.p;
    const F = FACTIONS[pr.owner];
    const tier = tierOf(pr.pop), T = TIERS[tier], next = TIERS[tier + 1];
    const gb = goodsBonus(s, w, pr.owner);
    const inc = cityIncome(s, w, i, gb);
    const garrisoned = armiesIn(s, i).some((a) => a.owner === pr.owner);
    const ord = cityOrder(s, w, i, provsOf(s, pr.owner), garrisoned);
    const g = growthRate(w, i, pr), cap = popCap(w, i, pr);
    const res = RESOURCES[resourceOf(p)];
    const cities = this.myCities();
    const ci = cities.indexOf(i);
    const ordCls = pr.order >= 60 ? 'good' : pr.order >= 40 ? 'warn' : 'bad';
    const tierPct = next ? Math.min(100, ((pr.pop - T.min) / (next.min - T.min)) * 100) : 100;
    const slotsUsed = usedSlots(pr);

    this.root.style.setProperty('--fc', F.color);
    this.root.innerHTML = `
      <header class="cs-top">
        <button class="cs-back" data-a="close" title="Back to the map (Esc)"><span class="ic">${ICONS.back}</span>World</button>
        <div class="cs-title">
          <div class="cs-kick"><span class="cs-tier">${T.name}</span>${p.region} · ${F.name}</div>
          <h1>${p.name}</h1>
        </div>
        ${this.mine && cities.length > 1 ? `<div class="cs-cycle"><button data-a="prev" title="Previous city">${ICONS.back}</button><span>${ci + 1} / ${cities.length}</span><button data-a="next" title="Next city">${ICONS.next}</button></div>` : ''}
        <div class="cs-sp"></div>
        <div class="cs-kpis">
          <div class="kpi"><small>People</small><b>${kfmt(pr.pop)}</b><em class="${g > 0.05 ? 'pos' : 'mut'}">${g > 0.05 ? '+' + g.toFixed(1) + '%' : 'stagnant'}</em></div>
          <div class="kpi"><small>Order</small><b class="${ordCls}">${Math.round(pr.order)}</b><em class="${ordCls}">${orderLabel(pr.order)}</em></div>
          <div class="kpi"><small>Income</small><b>${sgn(inc.total)}</b><em class="mut">a year</em></div>
          ${this.mine ? `<div class="kpi"><small>Treasury</small><b class="gold">${fmt(s.factions[s.player].gold)}</b><em class="mut">denarii</em></div>` : ''}
        </div>
      </header>

      <aside class="cs-left">
        <section class="cs-card">
          <h3>Growth <span>${next ? `${kfmt(next.min - pr.pop)} more to become a ${next.name}` : 'The greatest of cities'}</span></h3>
          <div class="cs-meter"><i style="width:${tierPct}%"></i></div>
          <div class="cs-row mut"><span>Room for ${kfmt(cap)}</span><span>${slotsUsed} / ${T.slots} building slots</span></div>
        </section>
        <section class="cs-card">
          <h3>Income <span>${sgn(inc.total)}</span></h3>
          ${inc.lines.map(([k, v]) => `<div class="cs-row"><span>${k}</span><b class="${v < 0 ? 'bad' : ''}">${sgn(v)}</b></div>`).join('')}
          ${gb ? `<div class="cs-row mut"><span>${goodsOf(s, w, pr.owner).size} trade goods held</span><span>+${Math.round(gb * 100)}% tax</span></div>` : ''}
        </section>
        <section class="cs-card">
          <h3>Order <span>heading to ${Math.round(ord.total)}</span></h3>
          ${ord.lines.map(([k, v]) => `<div class="cs-row"><span>${k}</span><b class="${v < 0 ? 'bad' : v > 0 && k !== 'Base' ? 'good' : ''}">${v > 0 && k !== 'Base' ? '+' : ''}${v}</b></div>`).join('')}
        </section>
        ${this.mine ? `<section class="cs-card">
          <h3>Taxes <span>${TAX[pr.tax].desc}</span></h3>
          <div class="cs-seg">${TAX.map((t, k) => `<button data-a="tax" data-v="${k}" class="${k === pr.tax ? 'on' : ''}">${t.name}</button>`).join('')}</div>
          <div class="cs-row mut"><span>×${TAX[pr.tax].mul.toFixed(2)} tax</span><span>${TAX[pr.tax].order > 0 ? '+' : ''}${TAX[pr.tax].order} order · ${TAX[pr.tax].growth > 0 ? '+' : ''}${TAX[pr.tax].growth}% growth</span></div>
        </section>
        <section class="cs-card">
          <h3>Games</h3>
          <div class="cs-games">
            <div><b>${pr.games > 0 ? `+${Math.round(pr.games)} order, fading` : 'Hold games in the arena'}</b><small>+25 order now, halving every year${pr.bld.arena ? ` · Arena saves ${[0, 25, 45, 65][pr.bld.arena]}%` : ''}</small></div>
            <button class="cs-btn" data-a="games" ${s.factions[s.player].gold < gamesCost(pr) ? 'disabled' : ''}>${fmt(gamesCost(pr))}</button>
          </div>
        </section>` : ''}
        <section class="cs-card cs-res">
          <div class="ic">${ICONS[RES_ICON[res.kind]]}</div>
          <div><b>${res.name}</b><small>${res.note}${res.kind === 'lux' ? ` · +${res.value} trade` : res.kind === 'metal' ? ` · ${res.value} per mine level` : ''}</small></div>
        </section>
      </aside>

      <aside class="cs-right">
        ${this.mine ? `<div class="cs-tabs"><button data-a="tab" data-v="build" class="${this.tab === 'build' ? 'on' : ''}">Build</button><button data-a="tab" data-v="recruit" class="${this.tab === 'recruit' ? 'on' : ''}">Recruit</button></div>` : ''}
        ${this.tab === 'recruit' && this.mine ? this.recruitHtml() : this.detailHtml()}
      </aside>

      <footer class="cs-bar">
        ${this.visibleKeys().map((k) => this.cardHtml(k)).join('')}
      </footer>
      <div class="cs-hover" style="display:none"></div>`;
  }

  cardHtml(k) {
    const B = BUILDINGS[k], pr = this.pr;
    const lv = pr.bld[k], q = pr.queue.findIndex((x) => x.b === k);
    const c = this.mine ? canBuild(this.s, this.world, this.prov, k) : { ok: false };
    const state = q === 0 ? 'busy' : q > 0 ? 'queued' : c.locked && lv === 0 ? 'locked' : c.ok ? 'can' : lv >= B.max ? 'max' : '';
    const pips = Array.from({ length: B.max }, (_, n) => `<i class="${n < lv ? 'on' : n < plannedLevel(pr, k) ? 'plan' : ''}"></i>`).join('');
    const badge = q === 0 ? `${pr.queue[0].turns}y` : q > 0 ? 'queued' : state === 'can' && this.mine ? '' : '';
    return `<button class="bc ${state} ${this.sel === k ? 'sel' : ''} ${lv ? 'built' : ''}" data-a="sel" data-b="${k}">
${badge ? `<span class="badge">${badge}</span>` : ''}
      <span class="ic">${ICONS[BLD_ICON[k]]}</span><span class="nm">${B.name}</span><span class="pips">${pips}</span></button>`;
  }

  detailHtml() {
    const k = this.sel, B = BUILDINGS[k], pr = this.pr, s = this.s;
    const lv = pr.bld[k], plan = plannedLevel(pr, k);
    const c = this.mine ? canBuild(s, this.world, this.prov, k) : { ok: false, why: 'Not our city' };
    const nextName = plan < B.max ? B.lv[plan] : null;
    const turns = plan < B.max ? B.turns[plan] : 0;
    let action = '';
    if (this.mine) {
      if (c.ok) action = `<button class="cs-primary" data-a="build" data-b="${k}">${lv === 0 && plan === 0 ? 'Build' : 'Upgrade to'} ${nextName}<small>${fmt(c.cost)} denarii · ${turns} ${turns === 1 ? 'year' : 'years'}</small></button>`;
      else if (c.done) action = `<div class="cs-why ok">${plan > lv ? 'Final level is under way.' : 'Fully built.'}</div>`;
      else action = `<button class="cs-primary" disabled>${nextName ? (lv === 0 && plan === 0 ? 'Build ' : 'Upgrade to ') + nextName : B.name}<small>${c.cost ? fmt(c.cost) + ' denarii · ' : ''}${c.why}</small></button>`;
    }
    const levels = B.lv.map((nm, n) => {
      const st = n < lv ? 'done' : n < plan ? 'plan' : n === plan ? 'next' : '';
      return `<li class="${st}"><span class="n">${['I', 'II', 'III', 'IV'][n]}</span><div><b>${nm}</b><small>${B.fx(n + 1)}</small></div></li>`;
    }).join('');
    const queue = pr.queue.length ? `<div class="cs-queue"><h3>Construction <span>${pr.queue.length} / 3</span></h3>${pr.queue.map((q, n) => `
      <div class="qrow ${n === 0 ? 'active' : ''}"><span class="ic">${ICONS[BLD_ICON[q.b]]}</span><div class="qn"><b>${BUILDINGS[q.b].lv[pr.bld[q.b] + pr.queue.slice(0, n).filter((x) => x.b === q.b).length]}</b>
      <div class="cs-meter sm"><i style="width:${n === 0 ? ((q.total - q.turns) / q.total) * 100 : 0}%"></i></div></div><span class="qt">${n === 0 ? q.turns + 'y left' : q.total + 'y'}</span>${this.mine ? `<button class="qx" data-a="cancel" data-i="${n}" title="Cancel and refund">${ICONS.close}</button>` : ''}</div>`).join('')}</div>` : (this.mine ? '<div class="cs-queue empty"><h3>Construction</h3><p>Nothing is being built. Pick a building below.</p></div>' : '');
    return `<div class="cs-detail">
      <div class="cd-head"><span class="ic">${ICONS[BLD_ICON[k]]}</span><div><h2>${lv ? B.lv[lv - 1] : B.name}</h2><small>${lv ? `${B.name} · level ${lv} of ${B.max}` : 'Not yet built'} · ${B.desc}</small></div></div>
      <ol class="cd-levels">${levels}</ol>
      ${action}
    </div>${queue}`;
  }

  recruitHtml() {
    const s = this.s, w = this.world, i = this.prov, pr = this.pr;
    const all = rosterFor(s, s.player), roster = all.filter((t) => UNITS[t].rank <= s.rank), locked = all.length - roster.length;
    const perks = [];
    if (pr.bld.smithy) perks.push(`+${pr.bld.smithy} armour (Smithy)`);
    if (pr.bld.temple >= 2) perks.push('Veteran (Temple)');
    if (pr.bld.stables) perks.push(`Cavalry −${pr.bld.stables * 10}% (Stables)`);
    if (pr.bld.academy) perks.push(`${pr.bld.academy}★ generals (Academy)`);
    const army = armiesIn(s, i).find((a) => a.owner === s.player);
    return `<div class="cs-recruit">
      <p class="mut">${army ? `Joins Legio ${army.id} (${army.units.length} units).` : 'Raises a new legion here.'}${perks.length ? ' ' + perks.join(' · ') : ''}</p>
      <div class="rlist">${roster.map((t) => {
        const U = UNITS[t], c = canRecruit(s, w, i, t);
        return `<button class="rrow" data-a="recruit" data-t="${t}" ${c.ok ? '' : 'disabled'}><span class="ic">${unitArt(U)}</span><span class="nm">${U.name}<small>${c.ok ? `${U.men} men · upkeep ${U.up}` : c.why}</small></span><span class="cost">${fmt(unitCost(s, w, i, t))}</span></button>`;
      }).join('')}</div>
      ${locked ? `<div class="cs-row mut" style="margin-top:8px"><span>${locked} more units unlock as Rome's rank rises</span></div>` : ''}
      <div class="cs-row mut" style="margin-top:4px"><span>Defence of the city</span><span>${fmt(defencePower(s, i) / 100)}</span></div>
    </div>`;
  }

  // ---------------------------------------------------------------- input
  bind() {
    const c = this.renderer.domElement;
    let down = null, moved = 0;
    this.onDown = (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; moved = 0; this.view.cam.idle = 0; };
    this.onMove = (e) => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        moved += Math.abs(dx) + Math.abs(dy);
        const cam = this.view.cam;
        if (down.b === 2 || e.shiftKey) {
          const k = cam.dist * 0.0022, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
          cam.tx = Math.max(-200, Math.min(200, cam.tx - (dx * cy - dy * sy) * k));
          cam.tz = Math.max(-200, Math.min(200, cam.tz - (-dx * sy - dy * cy) * k));
        } else { cam.tyaw -= dx * 0.006; cam.tpitch += dy * 0.004; }
        down.x = e.clientX; down.y = e.clientY;
        return;
      }
      if (e.target !== c) { this.hover(null); return; }
      this.hover(this.view.pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
    };
    this.onUp = (e) => {
      if (down && moved < 6 && e.target === c && down.b === 0) {
        const k = this.view.pickAt(e.clientX, e.clientY);
        if (k) this.select(k, true);
      }
      down = null;
    };
    this.onWheel = (e) => { e.preventDefault(); this.view.cam.tdist *= Math.exp(e.deltaY * 0.0012); this.view.cam.idle = 0; };
    this.onKey = (e) => {
      if (document.querySelector('.modal-wrap')) return;
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      if (e.key === 'ArrowRight' || e.key === ']') this.cycle(1);
      if (e.key === 'ArrowLeft' || e.key === '[') this.cycle(-1);
      if (e.key === 'r' || e.key === 'R') { this.tab = this.tab === 'recruit' ? 'build' : 'recruit'; this.render(); }
    };
    this.onCtx = (e) => e.preventDefault();
    c.addEventListener('mousedown', this.onDown);
    addEventListener('mousemove', this.onMove);
    addEventListener('mouseup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onCtx);
    addEventListener('keydown', this.onKey, true);
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('mouseover', (e) => {
      const b = e.target.closest('[data-b]');
      if (b && b.classList.contains('bc')) this.view.setHighlight(b.dataset.b, b.dataset.b === this.sel);
    });
    this.root.addEventListener('mouseout', (e) => { if (e.target.closest?.('.bc')) this.view.setHighlight(this.sel, true); });
  }

  hover(k, x, y) {
    const h = this.root.querySelector('.cs-hover');
    if (!k) { if (h) h.style.display = 'none'; if (this.hoverKey) { this.hoverKey = null; this.view.setHighlight(this.sel, true); this.renderer.domElement.style.cursor = ''; } return; }
    if (k !== this.hoverKey) { this.hoverKey = k; this.view.setHighlight(k, k === this.sel); }
    this.renderer.domElement.style.cursor = 'pointer';
    const B = BUILDINGS[k], lv = this.pr.bld[k];
    h.innerHTML = `<b>${lv ? B.lv[lv - 1] : B.name}</b><small>${lv ? `level ${lv} of ${B.max}` : this.mine ? 'empty plot · click to plan' : 'not built'}</small>`;
    h.style.display = 'block';
    h.style.left = x + 16 + 'px'; h.style.top = y + 12 + 'px';
  }

  select(k, fromWorld = false) {
    this.sel = k;
    this.tab = 'build';
    this.view.setHighlight(k, true);
    if (fromWorld) this.view.focus(k);
    audio.sfx('click');
    this.render();
  }

  cycle(d) {
    const list = this.myCities();
    if (list.length < 2) return;
    const n = list[(list.indexOf(this.prov) + d + list.length) % list.length];
    audio.sfx('click');
    this.open(n);
  }

  click(e) {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    audio.init();
    const a = b.dataset.a, s = this.s, w = this.world, i = this.prov, pr = this.pr;
    if (a === 'close') return this.close();
    if (a === 'prev') return this.cycle(-1);
    if (a === 'next') return this.cycle(1);
    if (a === 'sel') return this.select(b.dataset.b);
    if (a === 'tab') { this.tab = b.dataset.v; audio.sfx('click'); return this.render(); }
    if (a === 'tax') { pr.tax = Number(b.dataset.v); audio.sfx('click'); this.after(); return; }
    if (a === 'games') {
      const c = gamesCost(pr);
      if (s.factions[s.player].gold < c) return;
      s.factions[s.player].gold -= c;
      pr.games = (pr.games || 0) + 25;
      pr.order = Math.min(100, pr.order + 10);
      audio.sfx('fanfare', 0.5);
      this.after();
      return;
    }
    if (a === 'build') {
      const k = b.dataset.b;
      if (!canBuild(s, w, i, k).ok) return;
      build(s, w, i, k);
      audio.sfx('build');
      this.view.rebuild(); this.view.setHighlight(k, true);
      this.after();
      return;
    }
    if (a === 'cancel') { cancelBuild(s, i, Number(b.dataset.i)); audio.sfx('coin'); this.view.rebuild(); this.view.setHighlight(this.sel, true); this.after(); return; }
    if (a === 'recruit') {
      const t = b.dataset.t;
      if (!canRecruit(s, w, i, t).ok) return;
      recruit(s, w, i, t);
      audio.sfx('coin');
      this.after();
    }
  }

  after() { this.render(); this.ctl.refresh(); }

  frame(dt) {
    const k = this.ctl.keys, cam = this.view.cam;
    const sp = cam.dist * 0.8 * dt, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const mv = (fx, fz) => { cam.tx = Math.max(-200, Math.min(200, cam.tx + fx)); cam.tz = Math.max(-200, Math.min(200, cam.tz + fz)); cam.idle = 0; };
    if (k.has('w')) mv(-sy * sp, -cy * sp);
    if (k.has('s')) mv(sy * sp, cy * sp);
    if (k.has('a')) mv(-cy * sp, sy * sp);
    if (k.has('d')) mv(cy * sp, -sy * sp);
    if (k.has('q')) { cam.tyaw += dt; cam.idle = 0; }
    if (k.has('e')) { cam.tyaw -= dt; cam.idle = 0; }
    this.view.render(dt);
  }
  resize() { this.view.resize(); }

  close() {
    const c = this.renderer.domElement;
    c.removeEventListener('mousedown', this.onDown);
    removeEventListener('mousemove', this.onMove);
    removeEventListener('mouseup', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onCtx);
    removeEventListener('keydown', this.onKey, true);
    c.style.cursor = '';
    this.view.dispose();
    this.root.remove();
    audio.sfx('click');
    this.onClose?.(this.prov);
  }
}
