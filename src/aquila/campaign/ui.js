// Campaign controller: input, HUD panels, turn flow, battles and diplomacy.
import { FACTIONS, FACTION_IDS, RANKS } from '../data/factions.js';
import { UNITS, GENERAL_UNIT } from '../data/units.js';
import {
  BUILDINGS, BLD_KEYS, MAX_UNITS, VICTORY_PROVINCES, atWar, warKey, yearLabel, armiesIn, provsOf, armyPower, unitsPower, defencePower, factionPower,
  provinceIncome, factionIncome, upkeep, tradeIncome, canRecruit, recruit, unitCost, goodsBonus, armyMaxMp, reachable, moveArmy, declareWar, makePeace,
  battleSides, autoResolve, applyBattle, sack, transferProvince, newMission, factionUpkeepTurn, updateRank, checkEnd, log, rosterFor, linksOf, cultureOf, createArmy,
} from './state.js';
import { aiTurn } from './ai.js';
import { TIERS, RESOURCES, tierOf, resourceOf, orderLabel, goodsOf, growthRate } from './city.js';
import { CityScreen } from './cityscreen.js';
import { battleGeo } from '../map/geo.js';
import { Tutorial } from './tutorial.js';
import { CampaignView } from './view.js';
import { ICONS, unitIcon, unitArt, BLD_ICON, RES_ICON } from '../ui/icons.js';
import { audio } from '../audio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class CampaignController {
  constructor({ renderer, world, state, uiRoot, labelsRoot, fight, onQuit, view }) {
    this.renderer = renderer; this.world = world; this.s = state; this.uiRoot = uiRoot; this.fight = fight; this.onQuit = onQuit;
    this.labels = document.createElement('div');
    labelsRoot.appendChild(this.labels);
    this.view = view || new CampaignView(renderer, world, this.labels);
    if (view) { this.labels.remove(); this.labels = view.labelsEl; }
    this.sel = null; // {kind:'prov'|'army', id}
    this.busy = false;
    this.keys = new Set();
    this.reach = null;
    this.root = document.createElement('div');
    this.root.className = 'campaign';
    uiRoot.appendChild(this.root);
    this.buildHud();
    this.bindInput();
    this.view.syncOwners(this.s);
    this.view.rebuildWalls(this.s);
    this.view.syncArmies(this.s, null);
    const rome = this.world.provinces[this.s.factions[this.s.player].capital >= 0 ? this.s.factions[this.s.player].capital : 0];
    this.view.focus(rome.x, rome.z, 7);
    this.refresh();
    audio.setMode('campaign');
    if (!this.s.tut && this.s.turn > 1) this.s.tut = { step: 99, off: true }; // older saves skip the tutorial
    this.tut = new Tutorial(this);
  }

  // ---------------------------------------------------------------- HUD
  buildHud() {
    this.root.innerHTML = `
      <div class="topbar">
        <div class="spqr"><span class="em">${ICONS.eagle}</span><div><b>S·P·Q·R</b><small class="t-year"></small></div></div>
        <div class="chips">
          <div class="chip" data-tip="gold"><span class="ic">${ICONS.coin}</span><div><b class="t-gold"></b><small class="t-net"></small></div></div>
          <div class="chip" data-tip="pop"><span class="ic">${ICONS.people}</span><div><b class="t-pop"></b><small>citizens</small></div></div>
          <div class="chip" data-tip="rank"><span class="ic">${ICONS.laurel}</span><div><b class="t-prov"></b><small class="t-rank"></small><div class="rk"><i></i></div></div></div>
          <div class="chip" data-tip="goods"><span class="ic">${ICONS.amphora}</span><div><b class="t-goods"></b><small>trade goods</small></div></div>
        </div>
        <div class="sp"></div>
        <button class="tb-btn" data-act="dip"><span class="ic">${ICONS.scroll}</span>Diplomacy</button>
        <button class="tb-btn" data-act="help"><span class="ic">${ICONS.laurel}</span>Guide</button>
        <button class="tb-btn icon" data-act="sound" title="Sound"><span class="ic">${ICONS.sound}</span></button>
        <button class="tb-btn icon" data-act="menu" title="Menu"><span class="ic">${ICONS.temple}</span></button>
      </div>
      <div class="log"></div>
      <div class="toasts"></div>
      <div class="outliner">
        <div class="mission"></div>
        <section class="ol-sec"><h4>Cities <span class="ol-cn"></span></h4><div class="ol-list ol-cities"></div></section>
        <section class="ol-sec"><h4>Legions <span class="ol-an"></span></h4><div class="ol-list ol-armies"></div></section>
      </div>
      <div class="panel-slot"></div>
      <div class="et-badges"></div>
      <button class="endturn" data-act="end"><span class="ic">${ICONS.eagle}</span>End Turn<small class="et-sub"></small></button>
      <div class="tip" style="display:none"></div>`;
    this.$ = (q) => this.root.querySelector(q);
    this.root.addEventListener('click', (e) => {
      const ol = e.target.closest('[data-ol]');
      if (ol) { this.outlinerClick(ol, false); return; }
      const t = e.target.closest('[data-toast]');
      if (t) { const id = Number(t.dataset.toast); t.closest('.toast')?.remove(); if (id >= 0) this.openCity(id); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      audio.init(); audio.sfx('click');
      const a = b.dataset.act;
      if (a === 'end') this.endTurn();
      else if (a === 'dip') this.diplomacy();
      else if (a === 'help') this.help();
      else if (a === 'menu') this.menu();
      else if (a === 'idle') this.nextIdleCity();
      else if (a === 'ready') this.nextArmy();
      else if (a === 'sound') { audio.setMuted(!audio.muted); b.querySelector('.ic').innerHTML = audio.muted ? ICONS.mute : ICONS.sound; }
    });
    this.root.addEventListener('dblclick', (e) => { const ol = e.target.closest('[data-ol]'); if (ol) this.outlinerClick(ol, true); });
    this.$('.mission').addEventListener('click', () => {
      const m = this.s.mission; if (!m) return;
      const p = this.world.provinces[m.target]; this.view.focus(p.x, p.z, 6); this.select({ kind: 'prov', id: m.target });
    });
    const tipFor = {
      gold: () => {
        const s = this.s, f = s.player;
        let inc = 0; const gb = goodsBonus(s, this.world, f);
        s.provs.forEach((p, i) => { if (p.owner === f) inc += provinceIncome(s, this.world, i, gb); });
        return `<b>Treasury</b><table><tr><td>Cities</td><td>+${fmt(inc)}</td></tr><tr><td>Trade pacts</td><td>+${fmt(tradeIncome(s, f))}</td></tr><tr><td>Army upkeep</td><td>−${fmt(upkeep(s, f))}</td></tr></table>`;
      },
      pop: () => {
        const s = this.s; const by = [0, 0, 0, 0];
        s.provs.forEach((p) => { if (p.owner === s.player) by[tierOf(p.pop)]++; });
        return `<b>Citizens</b><table>${TIERS.map((t, k) => `<tr><td>${t.name}s</td><td>${by[k]}</td></tr>`).join('')}</table><div class="tt">Farms and aqueducts grow cities; bigger cities open more building slots.</div>`;
      },
      rank: () => {
        const s = this.s, n = provsOf(s, s.player), nx = RANKS[s.rank + 1];
        return `<b>${RANKS[s.rank].title}</b><div class="tt">${nx ? `${nx.at - n} more provinces to become <b>${nx.title}</b>: ${nx.note}` : 'The highest honour.'}</div><div class="tt">Victory at ${VICTORY_PROVINCES} provinces.</div>`;
      },
      goods: () => {
        const g = [...goodsOf(this.s, this.world, this.s.player)].map((k) => RESOURCES[k].name);
        return `<b>Trade goods</b><div class="tt">Each different good adds 3% to all tax. Held: ${g.join(', ') || 'none'}.</div>`;
      },
    };
    this.root.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => { const r = el.getBoundingClientRect(); this.showTip(r.left - 14, r.bottom - 8, tipFor[el.dataset.tip]()); });
      el.addEventListener('mouseleave', () => this.hideTip());
    });
  }

  refresh() {
    const s = this.s, f = s.player, w = this.world;
    const net = factionIncome(s, w, f);
    const n = provsOf(s, f);
    this.$('.t-year').textContent = `${yearLabel(s)} · Turn ${s.turn}`;
    this.$('.t-gold').textContent = fmt(s.factions[f].gold);
    const ne = this.$('.t-net'); ne.textContent = `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))} a year`; ne.className = 't-net ' + (net >= 0 ? 'pos' : 'neg');
    let pop = 0; s.provs.forEach((p) => { if (p.owner === f) pop += p.pop; });
    this.$('.t-pop').textContent = pop >= 1e6 ? (pop / 1e6).toFixed(2) + 'M' : fmt(pop / 1000) + 'k';
    this.$('.t-prov').textContent = `${n} / ${VICTORY_PROVINCES}`;
    const cur = RANKS[s.rank], nx = RANKS[s.rank + 1];
    this.$('.t-rank').textContent = cur.title;
    this.$('.rk i').style.width = (nx ? Math.min(100, ((n - cur.at) / (nx.at - cur.at)) * 100) : 100) + '%';
    this.$('.t-goods').textContent = goodsOf(s, w, f).size;
    this.$('.et-sub').textContent = `${yearLabel(s)}`;
    const m = s.mission;
    const mEl = this.$('.mission');
    if (m) { mEl.style.display = ''; mEl.innerHTML = `<small>The Senate demands</small><p>Take <b>${w.provinces[m.target].name}</b></p><div class="mt"><span>${fmt(m.reward)} denarii</span><span>${Math.max(0, m.deadline - s.turn)} years left</span></div>`; }
    else mEl.style.display = 'none';
    const logEl = this.$('.log');
    const recent = s.log.filter((l) => l.kind !== 'minor' && l.kind !== 'build' && s.turn - l.t <= 1).slice(-4);
    logEl.innerHTML = recent.map((l) => `<div class="le ${l.kind} ${s.turn - l.t > 1 ? 'old' : ''}">${l.text}</div>`).join('');
    this.renderOutliner();
    this.drainNews();
    this.renderPanel();
  }

  // ---------------------------------------------------------------- outliner: every city and legion at a glance
  cityStatus(i) {
    const pr = this.s.provs[i];
    if (pr.order < 40) return { cls: 'bad', text: orderLabel(pr.order) };
    if (pr.queue.length) { const q = pr.queue[0]; return { cls: 'busy', text: `${BUILDINGS[q.b].name} ${q.turns}y`, icon: ICONS.hammer }; }
    return { cls: 'idle', text: 'Idle' };
  }

  renderOutliner() {
    const s = this.s, w = this.world;
    const cities = s.provs.map((p, i) => (p.owner === s.player ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => (s.factions[s.player].capital === a ? -1 : s.factions[s.player].capital === b ? 1 : s.provs[b].pop - s.provs[a].pop));
    const sel = this.sel;
    this.$('.ol-cn').textContent = cities.length;
    this.$('.ol-cities').innerHTML = cities.map((i) => {
      const pr = s.provs[i], st = this.cityStatus(i), t = tierOf(pr.pop);
      return `<button class="olr ${sel && sel.kind === 'prov' && sel.id === i ? 'sel' : ''}" data-ol="city" data-id="${i}" title="Click to find · double-click to manage">
        <span class="tier" title="${TIERS[t].name}">${'<i></i>'.repeat(t + 1)}</span><span class="nm">${w.provinces[i].name}</span><span class="st ${st.cls}">${st.icon ? `<span class="ic">${st.icon}</span>` : ''}${st.text}</span></button>`;
    }).join('');
    const armies = s.armies.filter((a) => a.owner === s.player);
    this.$('.ol-an').textContent = armies.length;
    this.$('.ol-armies').innerHTML = armies.length ? armies.map((a) => {
      const max = armyMaxMp(a);
      return `<button class="olr ${a.mp > 0 ? '' : 'spent'} ${sel && sel.kind === 'army' && sel.id === a.id ? 'sel' : ''}" data-ol="army" data-id="${a.id}">
        <span class="ic">${ICONS.eagle}</span><span class="nm">Legio ${roman(a.id)}<small>${w.provinces[a.prov].name} · ${a.units.length} units</small></span><span class="mp">${Array.from({ length: max }, (_, k) => `<i class="${k < a.mp ? 'on' : ''}"></i>`).join('')}</span></button>`;
    }).join('') : '<div class="ol-empty">No legions in the field. Recruit in a city.</div>';
    // end-turn nudges
    const idle = cities.filter((i) => !s.provs[i].queue.length).length;
    const ready = armies.filter((a) => a.mp > 0).length;
    this.$('.et-badges').innerHTML = `${idle ? `<button class="etb" data-act="idle"><span class="ic">${ICONS.hammer}</span>${idle} idle ${idle === 1 ? 'city' : 'cities'}</button>` : ''}${ready ? `<button class="etb" data-act="ready"><span class="ic">${ICONS.eagle}</span>${ready} ${ready === 1 ? 'legion' : 'legions'} can march</button>` : ''}`;
  }

  outlinerClick(el, dbl) {
    const id = Number(el.dataset.id);
    audio.init();
    if (el.dataset.ol === 'city') {
      if (dbl) { this.openCity(id); return; }
      audio.sfx('click');
      const p = this.world.provinces[id]; this.view.focus(p.x, p.z);
      this.select({ kind: 'prov', id });
    } else {
      const a = this.s.armies.find((x) => x.id === id); if (!a) return;
      audio.sfx('click');
      const p = this.world.provinces[a.prov]; this.view.focus(p.x, p.z);
      this.select({ kind: 'army', id });
    }
  }

  nextIdleCity() {
    const s = this.s;
    const list = s.provs.map((p, i) => (p.owner === s.player && !p.queue.length ? i : -1)).filter((i) => i >= 0);
    if (!list.length) return;
    const cur = this.sel && this.sel.kind === 'prov' ? list.indexOf(this.sel.id) : -1;
    this.openCity(list[(cur + 1) % list.length]);
  }

  // ---------------------------------------------------------------- toasts: finished buildings, growing cities
  drainNews() {
    const s = this.s;
    if (!s.news || !s.news.length) return;
    const box = this.$('.toasts');
    const items = s.news.splice(0);
    for (const n of items.slice(-4)) {
      const name = this.world.provinces[n.prov].name;
      const pr = s.provs[n.prov];
      const html = n.kind === 'tier'
        ? `<span class="ic">${ICONS.crown}</span><div><b>${name} is now a ${TIERS[n.tier].name}</b><small>${TIERS[n.tier].slots} building slots and new levels open</small></div>`
        : `<span class="ic">${ICONS[BLD_ICON[n.b]]}</span><div><b>${BUILDINGS[n.b].lv[Math.max(0, pr.bld[n.b] - 1)]} completed</b><small>${name} · ${BUILDINGS[n.b].fx(pr.bld[n.b])}</small></div>`;
      const t = document.createElement('div');
      t.className = 'toast ' + n.kind;
      t.innerHTML = `${html}<button class="tv" data-toast="${pr.owner === s.player ? n.prov : -1}">View</button>`;
      box.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 500); }, 7000);
    }
    while (box.children.length > 4) box.firstChild.remove();
  }

  // ---------------------------------------------------------------- city screen
  openCity(id) {
    if (this.city || this.busy) return;
    this.hideTip();
    this.select({ kind: 'prov', id });
    this.root.style.display = 'none';
    this.labels.style.display = 'none';
    this.city = new CityScreen(this, id, {
      onClose: (last) => {
        this.city = null;
        this.root.style.display = '';
        this.labels.style.display = '';
        this.view.resize();
        const p = this.world.provinces[last];
        this.view.focus(p.x, p.z);
        this.select({ kind: 'prov', id: last });
        this.refresh();
      },
    });
    window.__city = this.city;
  }

  // ---------------------------------------------------------------- selection
  select(sel) {
    this.sel = sel;
    this.reach = null;
    const s = this.s;
    if (sel && sel.kind === 'army') {
      const a = s.armies.find((x) => x.id === sel.id);
      if (!a) { this.sel = null; return this.select(null); }
      if (a.owner === s.player && a.mp > 0) {
        this.reach = reachable(s, this.world, a);
        const reach = [], attack = [];
        for (const [id, r] of this.reach) (r.kind === 'move' ? reach : attack).push(id);
        this.view.setHighlights({ sel: a.prov, reach, attack });
      } else this.view.setHighlights({ sel: a.prov });
      this.view.syncArmies(s, a.id);
    } else if (sel && sel.kind === 'prov') {
      this.view.setHighlights({ sel: sel.id });
      this.view.syncArmies(s, null);
    } else {
      this.view.setHighlights({});
      this.view.syncArmies(s, null);
      this.view.showPath(null);
    }
    this.renderOutliner();
    this.renderPanel();
  }

  panelFor(html, color, icon, title, sub) {
    return `<div class="panel" style="--fc:${color}"><div class="p-head"><div class="crest">${icon}</div><div><h2>${title}</h2><div class="sub">${sub}</div></div><button class="x" data-p="close">${ICONS.close}</button></div>${html}</div>`;
  }

  chips(units, owner, removable = false) {
    const col = FACTIONS[owner].color;
    return `<div class="units">${units.map((u, i) => {
      const t = UNITS[u.t];
      return `<div class="uchip ${t.general ? 'gen' : ''}" style="--fc:${col}" data-unit="${i}" data-type="${u.t}"><span class="xp">${'▲'.repeat(Math.floor(u.xp || 0))}</span><span class="n">${u.n}</span><div class="ic">${unitArt(t)}</div><div class="nm">${t.name}</div><div class="bar"><i style="width:${(u.n / t.men) * 100}%"></i></div>${removable && !t.general ? `<button class="rm" data-p="disband" data-i="${i}">${ICONS.close}</button>` : ''}</div>`;
    }).join('')}</div>`;
  }

  renderPanel() {
    const slot = this.$('.panel-slot');
    const s = this.s, w = this.world;
    if (!this.sel) { slot.innerHTML = ''; return; }
    let html = '';
    if (this.sel.kind === 'army') {
      const a = s.armies.find((x) => x.id === this.sel.id);
      if (!a) { slot.innerHTML = ''; return; }
      const mine = a.owner === s.player;
      const stars = '★'.repeat(a.gen.stars) + '☆'.repeat(5 - a.gen.stars);
      const men = a.units.reduce((t, u) => t + u.n, 0);
      const others = armiesIn(s, a.prov).filter((x) => x !== a && x.owner === a.owner);
      let body = `<div class="p-sec"><div class="gen-line"><span>${a.gen.name}</span><span class="stars">${stars}</span></div></div>
        <div class="p-sec"><div class="stats"><div><small>Men</small><b>${fmt(men)}</b></div><div><small>Units</small><b>${a.units.length}/${MAX_UNITS + 1}</b></div><div><small>Strength</small><b>${fmt(armyPower(a) / 100)}</b></div><div><small>March</small><b>${mine ? a.mp : '—'}</b></div></div></div>
        <div class="p-sec"><h4>Units <span>${mine ? 'hover a unit to disband it' : ''}</span></h4>${this.chips(a.units, a.owner, mine)}</div>`;
      if (mine) {
        body += `<div class="p-sec">${a.mp > 0 ? `<div class="hint"><b style="color:var(--gold2)">Click a glowing province to march.</b> Gold = march there · red = attack. ${a.mp} march${a.mp > 1 ? 'es' : ''} left this year.</div>` : '<div class="hint">This legion has marched this year. It can move again after you end the turn.</div>'}
          <div class="p-actions" style="margin-top:8px">${others.length ? '<button class="btn small" data-p="merge">Merge armies here</button>' : ''}<button class="btn small ghost" data-p="province">View ${w.provinces[a.prov].name}</button></div></div>`;
      }
      html = this.panelFor(body, FACTIONS[a.owner].color, ICONS.eagle, mine ? 'Legio ' + roman(a.id) : `${FACTIONS[a.owner].adj} Army`, `${FACTIONS[a.owner].name} · ${w.provinces[a.prov].name}`);
    } else {
      const i = this.sel.id, p = w.provinces[i], pr = s.provs[i];
      const mine = pr.owner === s.player;
      const inc = provinceIncome(s, w, i);
      const t = tierOf(pr.pop), res = RESOURCES[resourceOf(p)];
      const oc = pr.order >= 60 ? 'good' : pr.order >= 40 ? 'warn' : 'bad';
      const g = growthRate(w, i, pr);
      let body = `<div class="p-sec"><div class="stats">
        <div><small>${TIERS[t].name}</small><b>${fmt(pr.pop / 1000)}k</b><em class="${g > 0.05 ? 'pos' : ''}">${g > 0.05 ? '+' + g.toFixed(1) + '%' : 'stagnant'}</em></div>
        <div><small>Income</small><b>${mine ? '+' : '~'}${fmt(inc)}</b><em>a year</em></div>
        <div><small>Order</small><b class="${oc}">${Math.round(pr.order)}</b><em class="${oc}">${orderLabel(pr.order)}</em></div>
        <div><small>Defence</small><b>${fmt(defencePower(s, i) / 100)}</b><em>${pr.bld.walls ? BUILDINGS.walls.lv[pr.bld.walls - 1] : 'no walls'}</em></div></div>
        <div class="p-res"><span class="ic">${ICONS[RES_ICON[res.kind]]}</span><b>${res.name}</b><span>${res.note}</span></div></div>`;
      if (mine) {
        const q = pr.queue[0];
        body += `<div class="p-sec p-city">${q
          ? `<div class="p-build"><span class="ic">${ICONS[BLD_ICON[q.b]]}</span><div><b>${BUILDINGS[q.b].lv[pr.bld[q.b]]}</b><div class="cs-meter sm"><i style="width:${((q.total - q.turns) / q.total) * 100}%"></i></div></div><span>${q.turns}y${pr.queue.length > 1 ? ` · +${pr.queue.length - 1} queued` : ''}</span></div>`
          : `<div class="p-build idle"><span class="ic">${ICONS.hammer}</span><div><b>Nothing under construction</b><small>Idle cities fall behind</small></div></div>`}
          <button class="btn gold p-manage" data-p="city"><span class="ic">${ICONS.forum}</span>Manage City<small>double-click a city</small></button></div>`;
        body += `<div class="p-sec"><h4>Recruit <span>${fmt(s.factions[s.player].gold)} denarii</span></h4><div class="recruit">${rosterFor(s, s.player).filter((t) => UNITS[t].rank <= s.rank).map((t) => {
          const U = UNITS[t], c = canRecruit(s, w, i, t);
          return `<button class="rc" data-p="recruit" data-t="${t}" data-type="${t}" ${c.ok ? '' : 'disabled'}><span class="ic">${unitArt(U)}</span><span class="nm">${U.name}</span><span class="cost">${fmt(unitCost(s, w, i, t))}</span>${c.ok ? '' : `<span class="why">${c.why}</span>`}</button>`;
        }).join('')}</div></div>`;
      } else {
        const built = BLD_KEYS.filter((k) => pr.bld[k]).map((k) => BUILDINGS[k].lv[pr.bld[k] - 1]);
        body += `<div class="p-sec"><h4>The City</h4><div class="hint">${built.length ? built.join(' · ') : 'No great buildings.'}</div><div class="p-actions" style="margin-top:8px"><button class="btn small" data-p="city">View City</button></div></div>`;
      }
      if (pr.garrison.length) body += `<div class="p-sec"><h4>Garrison</h4>${this.chips(pr.garrison, pr.owner)}</div>`;
      const here = armiesIn(s, i);
      if (here.length) body += `<div class="p-sec"><h4>Armies</h4><div class="p-actions">${here.map((a) => `<button class="btn small" data-p="army" data-id="${a.id}">${a.owner === s.player ? 'Legio ' + roman(a.id) : FACTIONS[a.owner].adj + ' army'} · ${a.units.length} units</button>`).join('')}</div></div>`;
      if (!mine && pr.owner !== 'free') {
        const war = atWar(s, s.player, pr.owner);
        body += `<div class="p-sec"><div class="hint">${war ? `We are at <b style="color:var(--bad)">war</b> with ${FACTIONS[pr.owner].name}.` : `We are at peace with ${FACTIONS[pr.owner].name}. Attacking will declare war.`}</div></div>`;
      } else if (pr.owner === 'free') body += `<div class="p-sec"><div class="hint">Independent peoples. They will defend their lands but never march on yours.</div></div>`;
      const cap = s.factions[pr.owner] && s.factions[pr.owner].capital === i;
      html = this.panelFor(body, FACTIONS[pr.owner].color, ICONS.shield, (cap ? '★ ' : '') + p.name, `${p.region} · ${FACTIONS[pr.owner].name}`);
    }
    slot.innerHTML = html;
    const panel = slot.firstChild;
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('wheel', (e) => e.stopPropagation());
    panel.addEventListener('click', (e) => this.panelClick(e));
    panel.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-type]');
      if (t) { const U = UNITS[t.dataset.type]; this.showTip(e.clientX, e.clientY - 10, unitTip(U), true); }
      else this.hideTip();
    });
    panel.addEventListener('mouseleave', () => this.hideTip());
  }

  panelClick(e) {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    audio.init();
    const s = this.s, w = this.world;
    const act = b.dataset.p;
    if (act === 'close') { this.select(null); return; }
    if (act === 'army') { this.select({ kind: 'army', id: Number(b.dataset.id) }); return; }
    if (act === 'province') { const a = s.armies.find((x) => x.id === this.sel.id); this.select({ kind: 'prov', id: a.prov }); return; }
    if (act === 'city' && this.sel.kind === 'prov') { this.openCity(this.sel.id); return; }
    if (act === 'recruit' && this.sel.kind === 'prov') {
      const c = canRecruit(s, w, this.sel.id, b.dataset.t);
      if (!c.ok) return;
      recruit(s, w, this.sel.id, b.dataset.t);
      audio.sfx('coin');
      this.view.syncArmies(s, null);
      this.refresh();
    }
    if (act === 'disband' && this.sel.kind === 'army') {
      const a = s.armies.find((x) => x.id === this.sel.id);
      a.units.splice(Number(b.dataset.i), 1);
      audio.sfx('click');
      this.view.syncArmies(s, a.id);
      this.refresh();
    }
    if (act === 'merge' && this.sel.kind === 'army') {
      const a = s.armies.find((x) => x.id === this.sel.id);
      for (const o of armiesIn(s, a.prov)) {
        if (o === a || o.owner !== a.owner) continue;
        while (o.units.length > 1 && a.units.length < MAX_UNITS + 1) a.units.push(o.units.splice(1, 1)[0]);
        if (o.units.length <= 1) o.units = [];
        a.mp = Math.min(a.mp, o.mp);
      }
      s.armies = s.armies.filter((x) => x.units.length);
      this.view.syncArmies(s, a.id);
      this.select({ kind: 'army', id: a.id });
    }
  }

  showTip(x, y, html, above = false) {
    const t = this.$('.tip');
    t.innerHTML = html; t.style.display = 'block';
    const r = t.getBoundingClientRect();
    t.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x + 14)) + 'px';
    t.style.top = Math.max(8, above ? y - r.height - 8 : y + 16) + 'px';
  }
  hideTip() { this.$('.tip').style.display = 'none'; }

  // ---------------------------------------------------------------- input
  bindInput() {
    const c = this.renderer.domElement;
    let down = null, dragged = false;
    this.onDown = (e) => {
      if (this.disabled || this.city) return;
      audio.init();
      if (e.button === 0) { down = { x: e.clientX, y: e.clientY }; dragged = false; }
    };
    this.onMove = (e) => {
      if (this.disabled || this.city) return;
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (dragged || Math.hypot(dx, dy) > 5) {
          dragged = true;
          const k = this.view.cam.dist * 0.0016;
          this.view.pan(-dx * k, -dy * k * 1.3);
          down = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      this.hoverAt(e.clientX, e.clientY);
    };
    this.onUp = (e) => {
      if (this.disabled || this.city) return;
      if (e.button === 0 && down) {
        if (!dragged && e.target === c) this.clickAt(e.clientX, e.clientY);
        down = null;
      }
      if (e.button === 2 && e.target === c) this.rightClick(e.clientX, e.clientY);
    };
    this.onWheel = (e) => { if (this.disabled || this.city) return; e.preventDefault(); this.view.zoom(Math.exp(e.deltaY * 0.0013)); };
    this.onCtx = (e) => e.preventDefault();
    this.onKey = (e) => {
      const k = e.key.toLowerCase();
      if (e.type === 'keyup') { this.keys.delete(k); return; }
      if (this.disabled) return;
      if (document.querySelector('.modal-wrap')) return;
      this.keys.add(k);
      if (this.city) return;
      if (k === 'escape') this.select(null);
      if (k === 'enter' && !e.repeat) this.endTurn();
      if (k === 'tab') { e.preventDefault(); this.nextArmy(); }
    };
    c.addEventListener('mousedown', this.onDown);
    addEventListener('mousemove', this.onMove);
    addEventListener('mouseup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onCtx);
    this.onDbl = (e) => {
      if (this.disabled || this.city || this.busy) return;
      if (this.view.armyAt(e.clientX, e.clientY)) return;
      const pid = this.view.provinceAt(this.view.rayGround(e.clientX, e.clientY));
      if (pid >= 0) this.openCity(pid);
    };
    c.addEventListener('dblclick', this.onDbl);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
  }

  nextArmy() {
    const list = this.s.armies.filter((a) => a.owner === this.s.player && a.mp > 0);
    if (!list.length) return;
    const cur = this.sel && this.sel.kind === 'army' ? list.findIndex((a) => a.id === this.sel.id) : -1;
    const a = list[(cur + 1) % list.length];
    const p = this.world.provinces[a.prov];
    this.view.focus(p.x, p.z);
    this.select({ kind: 'army', id: a.id });
  }

  hoverAt(x, y) {
    const g = this.view.rayGround(x, y);
    const pid = this.view.provinceAt(g);
    this.view.hoverProv = pid;
    if (this.busy) return;
    const army = this.view.armyAt(x, y);
    if (army) {
      const men = army.units.reduce((t, u) => t + u.n, 0);
      this.showTip(x, y, `<b>${army.owner === this.s.player ? 'Legio ' + roman(army.id) : FACTIONS[army.owner].adj + ' army'}</b><div class="tt">${army.gen.name} · ${army.units.length} units · ${fmt(men)} men</div>`);
      return;
    }
    if (this.reach && pid >= 0 && this.reach.has(pid)) {
      const r = this.reach.get(pid);
      const pts = r.path.map((id) => this.view.cityPos[id]);
      this.view.showPath(pts, r.kind === 'move' ? 'move' : 'attack');
      const p = this.world.provinces[pid], pr = this.s.provs[pid];
      if (r.kind !== 'move') {
        const a = this.s.armies.find((q) => q.id === this.sel.id);
        const mine = armyPower(a), theirs = defencePower(this.s, pid);
        const odds = mine / (mine + theirs);
        this.showTip(x, y, `<b>${r.kind === 'war' ? 'Declare war and attack' : 'Attack'} ${p.name}</b><div class="tt">${FACTIONS[pr.owner].name} · odds ${odds > 0.65 ? 'favourable' : odds > 0.45 ? 'even' : 'poor'} (${Math.round(odds * 100)}%)</div><div class="tt">Click to attack</div>`);
      } else this.showTip(x, y, `<b>March to ${p.name}</b><div class="tt">Click to march</div>`);
      return;
    }
    if (this.reach) this.view.showPath(null);
    if (pid >= 0) {
      const p = this.world.provinces[pid], pr = this.s.provs[pid];
      this.showTip(x, y, `<b>${p.name}</b><div class="tt">${p.region} · ${FACTIONS[pr.owner].name}</div>`);
    } else this.hideTip();
  }

  clickAt(x, y) {
    if (this.busy) return;
    // with one of our legions selected, clicking a glowing province marches (or attacks) there
    if (this.sel && this.sel.kind === 'army' && this.reach) {
      const a = this.s.armies.find((q) => q.id === this.sel.id);
      const hit = this.view.armyAt(x, y);
      const pid = hit && hit.owner !== this.s.player ? hit.prov : this.view.provinceAt(this.view.rayGround(x, y));
      if (a && a.owner === this.s.player && this.reach.has(pid) && !(hit && hit.owner === this.s.player)) { this.rightClick(x, y, pid); return; }
    }
    const army = this.view.armyAt(x, y);
    if (army) { audio.sfx('click'); this.select({ kind: 'army', id: army.id }); return; }
    const pid = this.view.provinceAt(this.view.rayGround(x, y));
    if (pid >= 0) {
      // clicking our own army's province with it selected keeps it; else select province
      audio.sfx('click');
      this.select({ kind: 'prov', id: pid });
    } else this.select(null);
  }

  async rightClick(x, y, forced) {
    if (this.busy || !this.sel || this.sel.kind !== 'army' || !this.reach) return;
    const a = this.s.armies.find((q) => q.id === this.sel.id);
    if (!a || a.owner !== this.s.player) return;
    const pid = forced ?? this.view.provinceAt(this.view.rayGround(x, y));
    const r = this.reach.get(pid);
    if (!r) return;
    this.hideTip();
    if (r.kind === 'move') {
      moveArmy(this.s, a, r.path, r.cost);
      audio.sfx('drum', 0.5);
      this.view.showPath(null);
      this.select({ kind: 'army', id: a.id });
      this.refresh();
      return;
    }
    const owner = this.s.provs[pid].owner;
    if (r.kind === 'war') {
      const ok = await this.confirm('Declare War?', `Marching on ${this.world.provinces[pid].name} means war with ${FACTIONS[owner].name}.`, 'Declare War', 'wine');
      if (!ok) return;
      declareWar(this.s, this.s.player, owner);
      audio.sfx('horn');
    }
    // march to the staging province, then attack
    const stage = r.path.slice(0, -1);
    const finalStep = this.world.provinces[stage[stage.length - 1]].neighbors.includes(pid) ? 1 : 2;
    if (stage.length > 1) moveArmy(this.s, a, stage, r.cost - finalStep);
    a.from = a.prov;
    this.view.syncArmies(this.s, a.id);
    this.view.showPath(null);
    await this.attack(a, pid, true);
  }

  // ---------------------------------------------------------------- battles
  async attack(army, prov, playerAttacking) {
    const s = this.s, w = this.world;
    const sides = battleSides(s, w, army, prov);
    const choice = await this.preBattle(sides, playerAttacking);
    if (choice === 'cancel') { this.select({ kind: 'army', id: army.id }); return; }
    let result;
    const defUnits = [...sides.defender.armies.flatMap((a) => a.units), ...sides.defender.garrison];
    if (choice === 'fight') {
      const field = defUnits.slice(0, 20);
      const p = w.provinces[prov];
      const style = { roman: 'med', hellenic: 'med', punic: 'med', ptolemaic: 'east', seleucid: 'east', eastern: 'east', african: 'east' }[p.culture] || 'hut';
      const cfg = {
        sides: [
          { owner: army.owner, culture: FACTIONS[army.owner].culture, name: FACTIONS[army.owner].name, color: FACTIONS[army.owner].color, player: army.owner === s.player, units: army.units.map((u) => ({ ...u })), gen: army.gen },
          { owner: sides.defender.owner, culture: FACTIONS[sides.defender.owner].culture, name: FACTIONS[sides.defender.owner].name, color: FACTIONS[sides.defender.owner].color, player: sides.defender.owner === s.player, units: field.map((u) => ({ ...u })), gen: sides.defender.armies[0]?.gen ?? { name: `Garrison of ${p.name}`, stars: 0 } },
        ],
        biome: p.biome, seed: (s.turn * 7919 + prov * 104729) % 100000, attacker: 0, walls: sides.defender.walls, town: { style }, geo: battleGeo(w, prov),
      };
      this.disabled = true;
      this.root.style.display = 'none';
      this.labels.style.display = 'none';
      const res = await this.fight(cfg, `The Battle of ${p.name} · ${yearLabel(s)}`);
      this.root.style.display = '';
      this.labels.style.display = '';
      this.disabled = false;
      audio.setMode('campaign');
      const defCas = [...res.sides[1].cas, ...Array(Math.max(0, defUnits.length - field.length)).fill(0)];
      result = { attackerWon: res.winner === 0, attCas: res.sides[0].cas, defCas };
    } else {
      result = autoResolve(s, sides);
      await this.autoResult(sides, result);
    }
    const attackerOwner = army.owner;
    const captured = applyBattle(s, w, sides, result);
    this.view.battleFx(prov);
    if (captured && attackerOwner === s.player) {
      const loot = Math.round(s.provs[prov].pop * 0.06 + 150);
      const c = await this.choose(`${w.provinces[prov].name} has fallen`, `The ${FACTIONS[attackerOwner].adj} standard flies over ${w.provinces[prov].name}. What are your orders for the city?`, [
        { id: 'occupy', label: 'Occupy', cls: 'gold', note: 'Keep the people and their wealth. Calmer streets.' },
        { id: 'sack', label: `Sack · +${fmt(loot)}`, cls: 'wine', note: 'Plunder the city. Fewer people, fiercer unrest.' },
      ]);
      if (c === 'sack') { sack(s, w, prov); audio.sfx('coin'); log(s, `${w.provinces[prov].name} is sacked. +${fmt(loot)} denarii.`, 'gold'); }
      audio.sfx('fanfare', 0.6);
      const rk = updateRank(s);
      if (rk) await this.rankUp(rk);
    }
    this.view.syncOwners(s);
    this.view.rebuildWalls(s);
    this.view.syncArmies(s, null);
    if (attackerOwner === s.player && s.armies.includes(army)) this.select({ kind: 'army', id: army.id }); else this.select(null);
    this.refresh();
    await this.checkEnd();
  }

  preBattle(sides, playerAttacking) {
    const s = this.s, w = this.world;
    const att = sides.attacker, def = sides.defender;
    const defUnits = [...def.armies.flatMap((a) => a.units), ...def.garrison];
    const A = armyPower(att), D = unitsPower(defUnits) * (1 + def.walls * 0.15);
    const odds = A / (A + D);
    const p = w.provinces[sides.prov];
    const genD = def.armies[0]?.gen?.name ?? `the garrison of ${p.name}`;
    const html = `<div class="m-kicker">${playerAttacking ? 'Battle' : 'We are attacked'}</div><h1>${playerAttacking ? 'Assault on' : 'Defence of'} ${p.name}</h1>
      <p class="m-sub">${playerAttacking ? `${att.gen.name} leads the legion against ${genD}.` : `${att.gen.name} leads ${FACTIONS[att.owner].name.replace(/^The /, 'the ')} against ${p.name}!`}${def.walls ? ` The city is walled (level ${def.walls}).` : ''}</p>
      <div class="vs"><div class="side" style="--c:${FACTIONS[att.owner].color}"><h3>${FACTIONS[att.owner].name}</h3><div class="gen">${att.gen.name}</div>${this.chips(att.units, att.owner)}</div><div class="mid">VS</div>
      <div class="side" style="--c:${FACTIONS[def.owner].color}"><h3>${FACTIONS[def.owner].name}</h3><div class="gen">${genD}</div>${this.chips(defUnits.slice(0, 20), def.owner)}</div></div>
      <div class="odds"><div class="bar"><i style="width:${odds * 100}%;background:${FACTIONS[att.owner].color}"></i><i style="width:${(1 - odds) * 100}%;background:${FACTIONS[def.owner].color}"></i></div><div class="lbl">${oddsLabel(att.owner === s.player ? odds : 1 - odds)}</div></div>
      <div class="m-actions"><button class="btn gold big" data-c="fight">Fight the Battle</button><button class="btn" data-c="auto">Auto-Resolve</button>${playerAttacking ? '<button class="btn ghost" data-c="cancel">Withdraw</button>' : ''}</div>`;
    audio.sfx(playerAttacking ? 'drum' : 'horn', 0.8);
    return this.modal(html, 'wide');
  }

  autoResult(sides, r) {
    const s = this.s;
    const playerWon = (sides.attacker.owner === s.player) === r.attackerWon;
    const lost = (sides.attacker.owner === s.player ? r.attCas : r.defCas).reduce((a, b) => a + b, 0);
    const killed = (sides.attacker.owner === s.player ? r.defCas : r.attCas).reduce((a, b) => a + b, 0);
    audio.sfx(playerWon ? 'fanfare' : 'dirge', 0.8);
    return this.modal(`<div class="m-kicker">${playerWon ? 'Victoria' : 'Clades'}</div><h1>${playerWon ? 'Victory' : 'Defeat'}</h1><p class="m-sub">The armies clash at ${this.world.provinces[sides.prov].name}.<br>We lost <b>${fmt(lost)}</b> men and slew <b>${fmt(killed)}</b>.</p><div class="m-actions"><button class="btn gold" data-c="ok">Continue</button></div>`, playerWon ? 'win' : 'loss');
  }

  // ---------------------------------------------------------------- modals
  modal(html, cls = '') {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${cls}">${html}</div>`;
      if (window.__auto) { // headless test mode: answer every prompt automatically
        const opts = [...wrap.querySelectorAll('[data-c]')].map((b) => b.dataset.c);
        return resolve(['auto', 'occupy', 'no', 'ok', 'yes'].find((o) => opts.includes(o)) ?? opts[0]);
      }
      this.uiRoot.appendChild(wrap);
      wrap.addEventListener('mousedown', (e) => e.stopPropagation());
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        audio.init(); audio.sfx('click');
        wrap.remove();
        resolve(b.dataset.c);
      });
    });
  }
  async confirm(title, text, yes = 'Yes', cls = 'gold') {
    const r = await this.modal(`<h1>${title}</h1><p class="m-sub">${text}</p><div class="m-actions"><button class="btn ${cls}" data-c="yes">${yes}</button><button class="btn ghost" data-c="no">Cancel</button></div>`);
    return r === 'yes';
  }
  choose(title, text, opts) {
    return this.modal(`<h1>${title}</h1><p class="m-sub">${text}</p><div class="m-actions">${opts.map((o) => `<div style="display:flex;flex-direction:column;gap:6px;max-width:220px"><button class="btn ${o.cls || ''} big" data-c="${o.id}">${o.label}</button><small style="color:var(--muted);font-style:italic">${o.note || ''}</small></div>`).join('')}</div>`);
  }
  rankUp(rk) {
    audio.sfx('fanfare');
    return this.modal(`<div class="m-kicker">The Senate Proclaims</div><h1>${rk.title}</h1><p class="m-sub">${rk.note}</p><div class="m-actions"><button class="btn gold" data-c="ok">Ave!</button></div>`, 'win');
  }

  diplomacy() {
    const s = this.s, f = s.player;
    const myP = factionPower(s, f) + provsOf(s, f) * 400;
    const rows = FACTION_IDS.filter((g) => g !== f && g !== 'free' && s.factions[g].alive).map((g) => {
      const k = warKey(f, g);
      const war = !!s.wars[k];
      const theirP = factionPower(s, g) + provsOf(s, g) * 400;
      const rel = theirP > myP * 1.3 ? 'Stronger' : theirP < myP * 0.7 ? 'Weaker' : 'Equal';
      const neighbour = s.provs.some((p, i) => p.owner === f && linksOf(this.world, i).some((l) => s.provs[l.id].owner === g));
      const tried = s.dipTried && s.dipTried[g] === s.turn;
      const st = war ? '<span class="st war">War</span>' : s.trade[k] ? '<span class="st trade">Trade</span>' : '<span class="st peace">Peace</span>';
      let acts = '';
      if (war) {
        acts += `<button class="btn small" data-c="peace:${g}" ${tried ? 'disabled' : ''}>Offer peace</button>`;
        if (provsOf(s, g) <= 3 && myP > theirP * 2.5) acts += `<button class="btn small wine" data-c="submit:${g}" ${tried ? 'disabled' : ''}>Demand submission</button>`;
      } else {
        if (!s.trade[k] && neighbour) acts += `<button class="btn small" data-c="trade:${g}" ${tried ? 'disabled' : ''}>Trade pact</button>`;
        acts += `<button class="btn small wine" data-c="war:${g}">Declare war</button>`;
      }
      return `<div class="dip" style="--c:${FACTIONS[g].color}"><span class="sw"></span><div class="nm">${FACTIONS[g].name}<small>${provsOf(s, g)} provinces · ${rel}${neighbour ? ' · neighbour' : ''}</small></div>${st}<div class="ac">${acts}</div></div>`;
    }).join('');
    this.modal(`<div class="m-kicker">Diplomacy</div><h1>The Known World</h1><div class="dip-list">${rows}</div><div class="m-actions"><button class="btn gold" data-c="close">Close</button></div>`, 'wide').then((c) => this.dipAction(c));
  }

  async dipAction(c) {
    if (!c || c === 'close') return;
    const [act, g] = c.split(':');
    const s = this.s, f = s.player;
    s.dipTried = s.dipTried || {};
    const myP = factionPower(s, f) + provsOf(s, f) * 400, theirP = factionPower(s, g) + provsOf(s, g) * 400;
    const name = FACTIONS[g].name;
    let msg = '';
    if (act === 'war') {
      if (await this.confirm('Declare War?', `War with ${name} cannot be undone lightly.`, 'Declare War', 'wine')) { declareWar(s, f, g); audio.sfx('horn'); }
    } else if (act === 'peace') {
      s.dipTried[g] = s.turn;
      const p = Math.max(0.05, Math.min(0.9, 0.2 + (myP / theirP - 1) * 0.35));
      if (Math.random() < p) { makePeace(s, f, g); msg = `${name} accepts peace.`; audio.sfx('coin'); }
      else msg = `${name} refuses. They believe they can still win.`;
    } else if (act === 'trade') {
      s.dipTried[g] = s.turn;
      if (Math.random() < 0.7) { s.trade[warKey(f, g)] = true; msg = `A trade pact with ${name}. +90 denarii a year.`; audio.sfx('coin'); log(s, `Trade pact signed with ${name}.`, 'gold'); }
      else msg = `${name} declines to trade with Rome.`;
    } else if (act === 'submit') {
      s.dipTried[g] = s.turn;
      if (Math.random() < 0.6) {
        s.provs.forEach((p, i) => { if (p.owner === g) transferProvince(s, this.world, i, f); });
        s.armies = s.armies.filter((a) => a.owner !== g);
        msg = `${name} bows to Rome and becomes a province of the Republic!`;
        audio.sfx('fanfare');
        log(s, `${name} submits to Rome.`, 'gold');
        this.view.syncOwners(s); this.view.syncArmies(s, null); this.view.rebuildWalls(s);
        const rk = updateRank(s); if (rk) await this.rankUp(rk);
      } else msg = `${name} would rather die free.`;
    }
    this.refresh();
    if (msg) await this.modal(`<h1>Envoys Return</h1><p class="m-sub">${msg}</p><div class="m-actions"><button class="btn gold" data-c="ok">Very well</button></div>`);
    this.diplomacy();
    await this.checkEnd();
  }

  help() {
    this.modal(`<div class="m-kicker">Commentarii</div><h1>How to Conquer the World</h1>
      <div class="help-grid">
        <h3>The Campaign</h3>
        <div><b>Select</b> — left-click a province or army. Drag to pan, wheel to zoom.</div>
        <div><b>March</b> — select a legion, then click a gold glowing province. Legions march 2 provinces a year; sea crossings take the whole year (1 march with a Port).</div>
        <div><b>Attack</b> — click a red glowing province. Fight the battle yourself or auto-resolve.</div>
        <div><b>Cities</b> — double-click a city (or Manage City) to enter it. Build, upgrade, set taxes and hold games. Cities grow from Village to Metropolis, opening more slots and grander buildings.</div>
        <div><b>Trade goods</b> — every province has one. Each different good you hold adds 3% to all tax; metals need a Mine, luxuries sell through the Forum and Port.</div>
        <div><b>Order</b> — newly conquered and foreign provinces are restless. Garrison an army there or build temples, or they may revolt.</div>
        <div><b>Rank</b> — more provinces raise your title and unlock Legionaries (Testudo) and the Praetorians.</div>
        <div><b>Win</b> — hold ${VICTORY_PROVINCES} provinces or destroy every rival power.</div>
        <div><b>Keys</b> — Enter ends the turn · Tab cycles armies · Esc deselects.</div>
        <div><b>Tutorial</b> — <button class="btn small" data-c="tutorial">Replay the tutorial</button></div>
        <h3>Battles</h3>
        <div><b>Select</b> — click units or their cards, drag a box, Ctrl+A for all, 1–9 hotkeys. Esc deselects.</div>
        <div><b>Move</b> — with troops selected, click the ground (or right-click). Right-drag draws a battle line: its length sets the frontage.</div>
        <div><b>Attack</b> — click an enemy unit. Double-click to charge at the run.</div>
        <div><b>Flank</b> — hits from the side and rear land far more often and break morale fast. Cavalry charging into a rear is decisive.</div>
        <div><b>Pila</b> — Roman infantry hurl a volley of pila just before contact.</div>
        <div><b>Testudo / Shield wall</b> — T. Testudo shrugs off arrows; spears in a shield wall stop cavalry cold.</div>
        <div><b>Morale</b> — losses, flanking and a dead general make units waver, then rout. Rally them with your general (G).</div>
        <div><b>Speed</b> — Space pauses; you can give orders while paused.</div>
      </div><div class="m-actions"><button class="btn gold" data-c="ok">To War</button></div>`, 'wide').then((c) => { if (c === 'tutorial') this.tut.restart(); });
  }

  async menu() {
    const c = await this.modal(`<div class="m-kicker">Aquila</div><h1>Paused</h1><div class="m-actions" style="flex-direction:column;align-items:center"><button class="btn gold" data-c="resume">Resume</button><button class="btn" data-c="save">Save Game</button><button class="btn ghost" data-c="quit">Save and Quit to Menu</button></div>`);
    if (c === 'save' || c === 'quit') { this.save(); log(this.s, 'Game saved.', 'build'); this.refresh(); }
    if (c === 'quit') { this.destroy(); this.onQuit(); }
  }

  save() { try { localStorage.setItem('aquila.save.v1', JSON.stringify(this.s)); } catch (e) { /* storage unavailable */ } }

  async checkEnd() {
    const s = this.s;
    if (s.over) return;
    const e = checkEnd(s);
    if (!e) return;
    s.over = e;
    const st = s.stats;
    const win = e === 'victory';
    audio.sfx(win ? 'fanfare' : 'dirge');
    const c = await this.modal(`<div class="m-kicker">${win ? 'Roma Victrix' : 'Finis'}</div><h1>${win ? 'The World is Rome' : 'Rome Has Fallen'}</h1>
      <p class="m-sub">${win ? `In ${yearLabel(s)}, after ${s.turn} years of war, every road leads to Rome.` : 'The eagles are lost. Rome is no more.'}</p>
      <p>Provinces taken: <b>${st.taken}</b> · Battles won: <b>${st.won}</b> · lost: <b>${st.lost}</b><br>Enemies slain: <b>${fmt(st.killed)}</b> · Romans fallen: <b>${fmt(st.lostMen)}</b></p>
      <div class="m-actions">${win ? '<button class="btn gold" data-c="go">Keep Conquering</button>' : ''}<button class="btn ghost" data-c="quit">Main Menu</button></div>`, win ? 'win' : 'loss');
    if (c === 'quit') { if (!win) localStorage.removeItem('aquila.save.v1'); this.destroy(); this.onQuit(); }
  }

  // ---------------------------------------------------------------- turns
  async endTurn() {
    if (this.busy || this.disabled || document.querySelector('.modal-wrap')) return;
    this.busy = true;
    const s = this.s, w = this.world;
    const btn = this.$('.endturn');
    btn.classList.add('busy');
    this.select(null);
    s.offers = s.offers || [];
    for (const f of FACTION_IDS) {
      if (f === s.player || !s.factions[f].alive) continue;
      btn.querySelector('.et-sub').textContent = FACTIONS[f].name.replace(/^The /, '');
      factionUpkeepTurn(s, w, f);
      const pending = [], moves = [];
      aiTurn(s, w, f, pending, moves);
      if (moves.length) {
        this.view.syncOwners(s);
        this.view.syncArmies(s, null);
        for (const m of moves) if (m.battle !== undefined) this.view.battleFx(typeof m.battle === 'number' ? m.battle : m.prov);
        await sleep(window.__auto ? 0 : 60);
      }
      for (const pb of pending) {
        const a = s.armies.find((x) => x.id === pb.armyId);
        if (!a || s.provs[pb.prov].owner !== s.player) continue;
        const p = w.provinces[pb.prov];
        this.view.focus(p.x, p.z, 7);
        await sleep(window.__auto ? 0 : 500);
        await this.attack(a, pb.prov, false);
        if (s.over) break;
      }
      if (s.over) break;
    }
    // new year for Rome
    s.turn++; s.year++;
    if (s.year === 0) s.year = 1;
    factionUpkeepTurn(s, w, s.player);
    const rk = updateRank(s);
    // senate
    if (s.mission && s.turn > s.mission.deadline) {
      log(s, `The Senate is displeased: ${w.provinces[s.mission.target].name} was not taken.`, 'loss');
      s.mission = null;
    }
    if (!s.mission && s.turn % 3 === 0) newMission(s, w);
    this.randomEvent();
    this.view.syncOwners(s);
    this.view.rebuildWalls(s);
    this.view.syncArmies(s, null);
    this.refresh();
    btn.classList.remove('busy');
    this.busy = false;
    this.save();
    if (rk) await this.rankUp(rk);
    // peace offers
    while (s.offers.length) {
      const o = s.offers.shift();
      if (!s.factions[o.from].alive || !atWar(s, s.player, o.from)) continue;
      const c = await this.modal(`<div class="m-kicker">Envoys Arrive</div><h1>${FACTIONS[o.from].name} sues for peace</h1><p class="m-sub">Their ambassadors offer ${o.gold ? `<b>${fmt(o.gold)}</b> denarii in tribute` : 'an end to the war'}.</p><div class="m-actions"><button class="btn gold" data-c="yes">Accept</button><button class="btn wine" data-c="no">Refuse — the war goes on</button></div>`);
      if (c === 'yes') { makePeace(s, s.player, o.from); s.factions[s.player].gold += o.gold; s.factions[o.from].gold -= o.gold; audio.sfx('coin'); }
    }
    await this.cityEvent();
    this.refresh();
    await this.checkEnd();
  }

  // ---------------------------------------------------------------- city decisions: small dilemmas that make cities feel alive
  async cityEvent() {
    const s = this.s, w = this.world, f = s.player;
    if (s.over || Math.random() > 0.24) return;
    const mine = s.provs.map((p, i) => (p.owner === f ? i : -1)).filter((i) => i >= 0);
    if (!mine.length) return;
    const i = mine[Math.floor(Math.random() * mine.length)];
    const pr = s.provs[i], name = w.provinces[i].name, gold = () => s.factions[f].gold;
    const opt = (id, label, note, cls = '') => ({ id, label, note, cls });
    const kinds = ['fire', 'veterans', 'grain', 'games'];
    if (pr.queue.length && pr.bld.market) kinds.push('merchants', 'merchants');
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const ask = (title, text, opts) => this.choose(title, text, opts.filter(Boolean));
    if (kind === 'fire') {
      const built = BLD_KEYS.filter((k) => pr.bld[k] > 0 && k !== 'walls');
      if (!built.length) return;
      const k = built[Math.floor(Math.random() * built.length)], cost = 150 + Math.round(pr.pop * 0.006);
      const c = await ask(`Fire in ${name}`, `Flames spread from the workshops toward the ${BUILDINGS[k].lv[pr.bld[k] - 1]}.`, [
        gold() >= cost && opt('pay', `Pay the vigiles · ${fmt(cost)}`, 'The fire is put out.', 'gold'),
        opt('burn', 'Let it burn', `The ${BUILDINGS[k].lv[pr.bld[k] - 1]} loses a level and many die.`, 'wine'),
      ]);
      if (c === 'pay') { s.factions[f].gold -= cost; log(s, `The vigiles save ${name} from the flames.`, 'build'); }
      else { pr.bld[k]--; pr.pop = Math.round(pr.pop * 0.94); log(s, `Fire ravages ${name}.`, 'loss'); }
    } else if (kind === 'veterans') {
      const cost = 300;
      const c = await ask(`Veterans at ${name}`, 'Old soldiers of the legions ask for farmland outside the city walls.', [
        gold() >= cost && opt('grant', `Grant land · ${fmt(cost)}`, '+8% population, +6 order.', 'gold'),
        opt('refuse', 'Send them away', '−10 order in the city.'),
      ]);
      if (c === 'grant') { s.factions[f].gold -= cost; pr.pop = Math.round(pr.pop * 1.08); pr.order = Math.min(100, pr.order + 6); log(s, `Veterans settle around ${name}.`, 'gold'); }
      else pr.order = Math.max(0, pr.order - 10);
    } else if (kind === 'grain') {
      const cost = 200 + Math.round(pr.pop * 0.004);
      const c = await ask(`Grain shortage in ${name}`, `The granaries of ${name} are nearly empty${pr.bld.farm < 2 ? ' — better farms would prevent this' : ''}.`, [
        gold() >= cost && opt('buy', `Buy grain · ${fmt(cost)}`, 'The people eat.', 'gold'),
        opt('starve', 'Let them go hungry', '−20 order and −5% population.', 'wine'),
      ]);
      if (c === 'buy') s.factions[f].gold -= cost;
      else { pr.order = Math.max(0, pr.order - 20); pr.pop = Math.round(pr.pop * 0.95); log(s, `Hunger in ${name}.`, 'loss'); }
    } else if (kind === 'games') {
      const cost = Math.round((150 + pr.pop * 0.012) * (1 - [0, 0.25, 0.45, 0.65][pr.bld.arena]));
      const c = await ask(`${name} demands games`, 'A crowd gathers at the forum, chanting for chariot races and gladiators.', [
        gold() >= cost && opt('games', `Hold games · ${fmt(cost)}`, '+25 order, fading over the years.', 'gold'),
        opt('refuse', 'Refuse', '−12 order in the city.'),
      ]);
      if (c === 'games') { s.factions[f].gold -= cost; pr.games = (pr.games || 0) + 25; pr.order = Math.min(100, pr.order + 10); }
      else pr.order = Math.max(0, pr.order - 12);
    } else if (kind === 'merchants') {
      const q = pr.queue[0];
      const c = await ask(`The merchants of ${name}`, `The guilds offer to finish the ${BUILDINGS[q.b].lv[pr.bld[q.b]]} at once, in return for a share of the city's taxes.`, [
        opt('deal', 'Accept the deal', 'Construction completes now. Taxes here −20% next year (−8 order).', 'gold'),
        opt('refuse', 'Refuse', 'Rome builds at its own pace.'),
      ]);
      if (c === 'deal') {
        pr.bld[q.b]++; pr.queue.shift(); pr.order = Math.max(0, pr.order - 8);
        s.factions[f].gold -= Math.round(provinceIncome(s, w, i) * 0.2);
        s.news.push({ kind: 'built', prov: i, b: q.b });
      }
    }
    this.view.rebuildWalls(s);
  }

  randomEvent() {
    const s = this.s, w = this.world;
    if (Math.random() > 0.16) return;
    const mine = s.provs.map((p, i) => (p.owner === s.player ? i : -1)).filter((i) => i >= 0);
    const i = mine[Math.floor(Math.random() * mine.length)];
    const name = w.provinces[i].name;
    const r = Math.random();
    if (r < 0.3) { const g = 200 + Math.floor(Math.random() * 300); s.factions[s.player].gold += g; log(s, `A bountiful harvest in ${name}. +${g} denarii.`, 'gold'); }
    else if (r < 0.5) { s.provs[i].pop = Math.round(s.provs[i].pop * 0.88); log(s, `Plague strikes ${name}. Many die.`, 'loss'); }
    else if (r < 0.7) { for (const j of mine) s.provs[j].order = Math.min(100, s.provs[j].order + 8); log(s, 'Games in the arena delight the people. Order rises everywhere.', 'gold'); }
    else if (r < 0.85) { s.provs[i].order = Math.max(0, s.provs[i].order - 20); log(s, `Riots break out in ${name}.`, 'loss'); }
    else { log(s, 'An eagle is seen circling the Capitol. The augurs promise victory.', 'senate'); for (const a of s.armies) if (a.owner === s.player) a.gen.xp += 1; }
  }

  // ---------------------------------------------------------------- frame
  frame(dt) {
    if (this.disabled) return;
    if (this.city) { this.city.frame(dt); return; }
    const k = this.keys, v = this.view;
    const sp = v.cam.dist * 0.9 * dt;
    if (k.has('w') || k.has('arrowup')) v.pan(0, -sp);
    if (k.has('s') || k.has('arrowdown')) v.pan(0, sp);
    if (k.has('a') || k.has('arrowleft')) v.pan(-sp, 0);
    if (k.has('d') || k.has('arrowright')) v.pan(sp, 0);
    if (k.has('q')) v.cam.tyaw += dt; if (k.has('e')) v.cam.tyaw -= dt;
    v.render(dt, this.s);
  }
  resize() { if (this.city) this.city.resize(); this.view.resize(); }

  destroy() {
    const c = this.renderer.domElement;
    c.removeEventListener('mousedown', this.onDown);
    removeEventListener('mousemove', this.onMove);
    removeEventListener('mouseup', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onCtx);
    c.removeEventListener('dblclick', this.onDbl);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    this.root.remove();
    this.tut?.destroy();
    this.disabled = true;
  }
}

function roman(n) {
  const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s;
}
function oddsLabel(o) { return o > 0.75 ? 'Overwhelming advantage' : o > 0.6 ? 'Favourable odds' : o > 0.45 ? 'An even fight' : o > 0.3 ? 'Unfavourable odds' : 'Hopeless odds'; }
function unitTip(U) {
  const rows = [['Melee', U.atk], ['Defence', U.def], ['Damage', U.dmg], ['Armour', U.armor], ['Charge', U.charge], ['Morale', U.morale]];
  if (U.range) rows.push(['Range', U.range + 'm'], ['Missile dmg', U.mdmg]);
  return `<b>${U.name}</b><div class="tt">${U.desc || ''}</div><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}<tr><td>Men</td><td>${U.men}</td></tr>${U.cost ? `<tr><td>Cost / upkeep</td><td>${U.cost} / ${U.up}</td></tr>` : ''}</table>${U.ability ? `<div class="tt">Ability: ${U.ability === 'testudo' ? 'Testudo' : 'Shield wall'}</div>` : ''}${U.pila ? '<div class="tt">Throws pila before the charge</div>' : ''}`;
}

export { roman };
