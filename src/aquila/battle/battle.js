// Runs one battle: sim + renderer + AI + HUD + input + cinematics. Resolves with the results.
import { BattleSim, FIELD, isCav, ABIL } from './sim.js';
import { BattleView } from './view.js';
import { BattleAI } from './ai.js';
import { ICONS, unitIcon, unitArt, ABIL_ICON } from '../ui/icons.js';
import { audio } from '../audio.js';

const STEP = 1 / 30;
const CLASS_NAME = { inf: 'Infantry', spear: 'Spearmen', pike: 'Pikemen', missile: 'Missile', cav: 'Cavalry', harcher: 'Horse Archers', elephant: 'War Beasts' };
const GROUP = (t) => (t.general ? 0 : t.cls === 'missile' ? 2 : isCav(t) ? 3 : 1);
const moraleLabel = (u) => (u.mstate >= 3 ? 'Shattered' : u.mstate === 2 ? 'Routing' : u.mstate === 1 ? 'Wavering' : u.morale > 70 ? 'Eager' : u.morale > 45 ? 'Steady' : 'Shaken');
const staminaLabel = (f) => (f < 0.25 ? 'Fresh' : f < 0.55 ? 'Winded' : f < 0.8 ? 'Tired' : 'Exhausted');
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function startBattle({ renderer, uiRoot, labelsRoot, cfg, title }) {
  const sim = new BattleSim(cfg);
  const view = new BattleView(renderer, sim, labelsRoot);
  const ps = view.playerSide;
  const ais = sim.sides.map((s, i) => (s.player ? null : new BattleAI(sim, i)));
  const selected = new Set();
  let hovered = -1, speed = 1, paused = false, acc = 0, ended = false, resolveDone;
  let slowT = 0, slowCD = 0, cinematic = localStorage.getItem('aquila.cine') !== 'off';
  let intro = { t: 0, dur: 6.5, on: true };
  const done = new Promise((r) => (resolveDone = r));
  const keys = new Set();
  audio.setMode('battle');
  const me = sim.sides[ps], foe = sim.sides[1 - ps];
  const menCount = (si) => sim.units.reduce((t, u) => t + (u.side === si ? u.alive : 0), 0);
  const killCount = (si) => sim.units.reduce((t, u) => t + (u.side === si ? u.kills : 0), 0);
  const stars = (g) => (g && g.stars ? '★'.repeat(g.stars) : '');
  const [yearText] = (title || '').split(' · ').reverse();
  const battleName = (title || 'Battle').split(' · ')[0];

  // ---------------------------------------------------------------- HUD
  const hud = document.createElement('div');
  hud.className = 'bhud intro';
  const armyBlock = (s, cls) => `<div class="bt-army ${cls}" style="--c:${s.color}"><div class="crest">${ICONS.eagle}</div><div class="ba-txt"><b>${s.name}</b><small>${s.gen?.name ?? ''} <em>${stars(s.gen)}</em></small></div><div class="ba-count"><b data-men="${s.idx}">0</b><small>men</small></div></div>`;
  hud.innerHTML = `
    <div class="letter top"></div><div class="letter bot"></div>
    <div class="bt-intro">
      <div class="bi-kicker">${yearText && yearText !== battleName ? yearText : 'Ad Arma'}</div>
      <h1>${battleName}</h1>
      <div class="bi-vs">
        <div class="bi-side" style="--c:${me.color}"><span class="bi-crest">${ICONS.eagle}</span><b>${me.name}</b><small>${me.gen?.name ?? ''}</small><i>${fmt(menCount(ps))} men</i></div>
        <span class="bi-x">VS</span>
        <div class="bi-side" style="--c:${foe.color}"><span class="bi-crest">${ICONS.eagle}</span><b>${foe.name}</b><small>${foe.gen?.name ?? ''}</small><i>${fmt(menCount(1 - ps))} men</i></div>
      </div>
      <div class="bi-skip">Click to take command</div>
    </div>
    <div class="bt-top">
      ${armyBlock(me, 'mine')}
      <div class="bt-center">
        <div class="bt-bal"><i class="a" style="background:${me.color}"></i><i class="b" style="background:${foe.color}"></i><span class="mk"></span></div>
        <div class="bt-clock"><span class="ph">Deployment</span></div>
        <div class="bt-kills"><span><b data-kills="${ps}">0</b> slain</span><span class="sep">◆</span><span><b data-kills="${1 - ps}">0</b> fallen</span></div>
      </div>
      ${armyBlock(foe, 'theirs')}
      <button class="bt-retreat" title="Sound the retreat">Retreat</button>
    </div>
    <div class="bt-feed"></div>
    <div class="bt-announce"></div>
    <div class="bt-deploy"><div class="bd-glyph">${ICONS.shield}</div><div class="bd-text"><b>Deploy your army</b><span>Drag a box to select · <kbd>Right-drag</kbd> to draw a battle line · <kbd>Right-click</kbd> to place</span></div><button class="btn gold big" data-act="begin">Begin the Battle <kbd>Enter</kbd></button></div>
    <div class="bt-detail"></div>
    <div class="bt-cards"></div>
    <div class="bt-right">
      <div class="bt-map"><canvas width="220" height="220"></canvas><div class="bt-map-cap">${battleName}</div></div>
      <div class="bt-speed">
        <button class="sb" data-act="pause" title="Pause (Space)">${ICONS.pause}</button>
        <button class="sb on" data-speed="1" title="Normal speed">${ICONS.play}</button>
        <button class="sb" data-speed="2" title="Fast">${ICONS.ff}<span>2×</span></button>
        <button class="sb" data-speed="3" title="Faster">${ICONS.ff}<span>3×</span></button>
        <button class="sb ${cinematic ? 'on' : ''}" data-act="cine" title="Cinematic slow-motion on big moments">${ICONS.laurel}</button>
      </div>
    </div>
    <div class="bt-help"><b>Click</b> your troops, then <b>click</b> the ground to move or an enemy to attack · <b>double-click</b> to run · <kbd>Esc</kbd> deselect · drag a box to select many · <kbd>WASD</kbd> pan <kbd>Q</kbd><kbd>E</kbd> rotate <kbd>wheel</kbd> zoom <kbd>Space</kbd> pause <kbd>R</kbd> run <kbd>H</kbd> halt <kbd>Z X C V</kbd> abilities <kbd>Ctrl+A</kbd> all</div>
    <div class="bt-box"></div>
    <div class="bt-tip"></div>
    <div class="bt-slow"></div>`;
  uiRoot.appendChild(hud);
  const $ = (q) => hud.querySelector(q);
  const cardsEl = $('.bt-cards'), boxEl = $('.bt-box'), feedEl = $('.bt-feed'), tipEl = $('.bt-tip'), detailEl = $('.bt-detail');

  // ---------------------------------------------------------------- unit cards
  const myUnits = sim.units.filter((u) => u.side === ps).sort((a, b) => GROUP(a.t) - GROUP(b.t));
  const cards = new Map();
  let lastGroup = -1;
  myUnits.forEach((u, idx) => {
    if (GROUP(u.t) !== lastGroup && lastGroup >= 0) cardsEl.insertAdjacentHTML('beforeend', '<div class="uc-gap"></div>');
    lastGroup = GROUP(u.t);
    const el = document.createElement('div');
    el.className = 'uc';
    el.style.setProperty('--c', me.color);
    el.innerHTML = `<div class="uc-top"><span class="uc-key">${idx < 9 ? idx + 1 : ''}</span><span class="uc-men"></span></div><div class="uc-art">${unitArt(u.t)}</div><div class="uc-xp">${'▲'.repeat(Math.floor(u.xp))}</div><div class="uc-name">${u.t.name}</div><div class="uc-bars"><i class="hp"><b></b></i><i class="mo"><b></b></i>${u.t.range ? '<i class="am"><b></b></i>' : ''}</div><div class="uc-badge"></div><div class="uc-dots">${u.abilList.map((k) => `<i data-k="${k}"></i>`).join('')}</div>`;
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { audio.sfx('click'); const add = e.shiftKey || e.ctrlKey || e.metaKey; if (!add) selected.clear(); if (add && selected.has(u.id)) selected.delete(u.id); else selected.add(u.id); refreshAll(); });
    el.addEventListener('dblclick', () => focusUnit(u));
    el.addEventListener('mouseenter', () => (hovered = u.id));
    el.addEventListener('mouseleave', () => (hovered = -1));
    cardsEl.appendChild(el);
    cards.set(u.id, el);
    u.hotkey = idx + 1;
  });
  function focusUnit(u) { view.cam.tx = u.cx; view.cam.tz = u.cz; view.cam.tdist = Math.min(view.cam.tdist, 70); }

  // floating unit plates
  const plates = new Map();
  for (const u of sim.units) {
    const el = document.createElement('div');
    el.className = 'ub ' + (u.side === ps ? 'mine' : 'theirs');
    el.style.setProperty('--c', sim.sides[u.side].color);
    el.innerHTML = `<div class="ub-sh">${unitArt(u.t)}</div><div class="ub-hp"><i></i></div><div class="ub-name">${u.t.name} <em></em></div><div class="ub-fx"></div>`;
    labelsRoot.appendChild(el);
    plates.set(u.id, el);
  }

  // ---------------------------------------------------------------- detail panel
  let detailKey = '';
  function renderDetail() {
    const us = selUnits(true);
    const key = us.map((u) => u.id).join(',');
    if (!us.length) { detailEl.classList.remove('on'); detailKey = ''; return; }
    detailEl.classList.add('on');
    if (key !== detailKey) {
      detailKey = key;
      const u = us[0];
      const abil = [...new Set(us.flatMap((x) => x.abilList))];
      const head = us.length === 1
        ? `<div class="dt-head" style="--c:${me.color}"><div class="dt-art">${unitArt(u.t)}</div><div class="dt-title"><h3>${u.t.name}</h3><div class="dt-tags"><span>${u.general ? 'General' : CLASS_NAME[u.t.cls]}</span>${u.xp >= 1 ? `<span class="xp">${'▲'.repeat(Math.floor(u.xp))} Veteran</span>` : ''}<span class="kills"></span></div></div><div class="dt-state"></div></div>`
        : `<div class="dt-head" style="--c:${me.color}"><div class="dt-multi">${us.slice(0, 6).map((x) => `<span>${unitArt(x.t)}</span>`).join('')}</div><div class="dt-title"><h3>${us.length} units</h3><div class="dt-tags"><span>${fmt(us.reduce((t, x) => t + x.alive, 0))} men</span></div></div><div class="dt-state"></div></div>`;
      const stat = (label, v, max) => `<div class="st"><span>${label}</span><i><b style="width:${Math.min(100, (v / max) * 100)}%"></b></i><em>${v}</em></div>`;
      const stats = us.length === 1 ? `<div class="dt-stats">${stat('Attack', u.t.atk, 16)}${stat('Defence', u.t.def, 16)}${stat('Armour', u.t.armor, 14)}${stat('Charge', u.t.charge, 40)}${u.t.range ? stat('Range', u.t.range, 160) : stat('Damage', u.t.dmg, 20)}</div>` : '';
      detailEl.innerHTML = `${head}
        <div class="dt-bars"><div class="br hp"><span>Men</span><i><b></b></i><em></em></div><div class="br mo"><span>Morale</span><i><b></b></i><em></em></div><div class="br sta"><span>Stamina</span><i><b></b></i><em></em></div>${us.some((x) => x.t.range) ? '<div class="br am"><span>Ammo</span><i><b></b></i><em></em></div>' : ''}</div>
        ${stats}
        <div class="dt-abil">${abil.map((k) => `<button class="ab" data-ab="${k}" title="${ABIL[k].name} — ${ABIL[k].desc}"><span class="ab-ic">${ABIL_ICON[k]}</span><span class="ab-cd"></span><kbd>${ABIL[k].key}</kbd><span class="ab-nm">${ABIL[k].name}</span></button>`).join('')}
          <button class="ab ord" data-act="run" title="Run (R)"><span class="ab-ic">${ICONS.run}</span><kbd>R</kbd><span class="ab-nm">Run</span></button>
          <button class="ab ord" data-act="halt" title="Halt (H)"><span class="ab-ic">${ICONS.halt}</span><kbd>H</kbd><span class="ab-nm">Halt</span></button>
          ${us.some((x) => x.t.range) ? `<button class="ab ord" data-act="holdfire" title="Hold fire / fire at will (F)"><span class="ab-ic">${ICONS.fire}</span><kbd>F</kbd><span class="ab-nm">Fire at will</span></button><button class="ab ord" data-act="skirmish" title="Skirmish: fall back from melee (K)"><span class="ab-ic">${ICONS.run}</span><kbd>K</kbd><span class="ab-nm">Skirmish</span></button>` : ''}
        </div>`;
      detailEl.querySelectorAll('[data-ab]').forEach((b) => b.addEventListener('click', () => useAbility(b.dataset.ab)));
    }
    // live values
    const men = us.reduce((t, x) => t + x.alive, 0), men0 = us.reduce((t, x) => t + x.n0, 0);
    const mor = us.reduce((t, x) => t + Math.max(0, Math.min(100, x.morale)), 0) / us.length;
    const fat = us.reduce((t, x) => t + x.fatigue, 0) / us.length;
    const setBar = (cls, frac, txt, color) => { const r = detailEl.querySelector('.br.' + cls); if (!r) return; r.querySelector('b').style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; if (color) r.querySelector('b').style.background = color; r.querySelector('em').textContent = txt; };
    setBar('hp', men / men0, `${men}/${men0}`);
    const worst = us.reduce((w, x) => (x.mstate > w.mstate || (x.mstate === w.mstate && x.morale < w.morale) ? x : w), us[0]);
    setBar('mo', mor / 100, moraleLabel(worst), worst.mstate >= 2 ? '#e8e2d4' : worst.mstate === 1 ? '#e8b640' : mor > 60 ? '#e8c35e' : '#d38f3c');
    setBar('sta', 1 - fat, staminaLabel(fat), fat > 0.55 ? '#c9744a' : '#7fbf8a');
    const ms = us.filter((x) => x.t.range);
    if (ms.length) { const a = ms.reduce((t, x) => t + sim.unitAmmo(x), 0), a0 = ms.reduce((t, x) => t + x.ammo0 * x.n0, 0); setBar('am', a / Math.max(1, a0), `${Math.round((a / Math.max(1, a0)) * 100)}%`); }
    const stEl = detailEl.querySelector('.dt-state');
    const state = worst.mstate >= 2 ? 'Routing' : us.some((x) => x.engaged) ? 'Engaged' : us.some((x) => x.order.kind === 'attack') ? 'Attacking' : us.some((x) => x.order.kind === 'move' && Math.hypot(x.ax - x.cx, x.az - x.cz) > 5) ? (us.every((x) => x.run) ? 'Running' : 'Marching') : 'Holding';
    if (stEl.textContent !== state) { stEl.textContent = state; stEl.className = 'dt-state ' + state.toLowerCase(); }
    const k = detailEl.querySelector('.kills'); if (k) k.textContent = `${us[0].kills} kills`;
    detailEl.querySelectorAll('[data-ab]').forEach((b) => {
      const kk = b.dataset.ab;
      const owners = us.filter((x) => x.abilList.includes(kk));
      const M = ABIL[kk];
      let frac = 0, activeNow = false, ready = false;
      for (const x of owners) {
        const cd = sim.cooldown(x, kk);
        if (M.toggle) { activeNow = activeNow || x.ability; ready = true; }
        else if (kk === 'pila') { ready = ready || !x.pilaDone; }
        else {
          if (sim.active(x, kk) || (kk === 'rally' && sim.time < x.rallyCD - 30)) activeNow = true;
          if (cd <= 0) ready = true;
          const total = kk === 'rally' ? 45 : M.cd; frac = Math.max(frac, total ? cd / total : 0);
        }
      }
      b.classList.toggle('active', activeNow);
      b.classList.toggle('ready', ready && !activeNow && sim.phase === 'battle');
      b.classList.toggle('cool', !ready && !activeNow);
      b.querySelector('.ab-cd').style.setProperty('--p', `${ready ? 0 : Math.max(frac, kk === 'pila' ? 1 : 0) * 360}deg`);
    });
    detailEl.querySelector('[data-act=run]')?.classList.toggle('active', us.every((x) => x.run));
    detailEl.querySelector('[data-act=holdfire]')?.classList.toggle('active', ms.length > 0 && ms.every((x) => !x.holdFire));
    detailEl.querySelector('[data-act=skirmish]')?.classList.toggle('active', ms.length > 0 && ms.every((x) => x.skirmish));
  }

  function refreshCards() {
    for (const [id, el] of cards) {
      const u = sim.units[id];
      el.classList.toggle('sel', selected.has(id));
      el.classList.toggle('dead', u.alive <= 0);
      el.classList.toggle('rout', u.mstate >= 2 && u.alive > 0);
      el.classList.toggle('waver', u.mstate === 1);
      el.classList.toggle('engaged', u.engaged && u.mstate < 2);
      el.classList.toggle('hot', u.abilList.some((k) => !ABIL[k].toggle && sim.active(u, k)) || u.ability);
      el.querySelector('.uc-men').textContent = u.alive;
      el.querySelector('.hp b').style.width = `${(u.alive / u.n0) * 100}%`;
      const mo = el.querySelector('.mo b');
      mo.style.width = `${Math.max(0, Math.min(100, u.morale))}%`;
      mo.style.background = u.mstate >= 2 ? '#e8e2d4' : u.mstate === 1 ? '#e8b640' : '#e8c35e';
      const am = el.querySelector('.am b'); if (am) am.style.width = `${(sim.unitAmmo(u) / Math.max(1, u.ammo0 * u.n0)) * 100}%`;
      const badge = u.alive <= 0 ? 'Destroyed' : u.mstate >= 3 ? 'Shattered' : u.mstate === 2 ? 'Routing' : u.mstate === 1 ? 'Wavering' : u.engaged ? 'Engaged' : '';
      const b = el.querySelector('.uc-badge'); if (b.textContent !== badge) { b.textContent = badge; b.className = 'uc-badge ' + badge.toLowerCase(); }
      el.querySelectorAll('.uc-dots i').forEach((d) => { const k = d.dataset.k; d.className = ABIL[k].toggle ? (u.ability ? 'on' : 'tg') : sim.active(u, k) ? 'on' : sim.cooldown(u, k) <= 0 ? 'rd' : ''; });
    }
  }
  function refreshAll() { refreshCards(); renderDetail(); }

  // ---------------------------------------------------------------- feed, announcements, floating text
  function feed(html, kind = '') {
    const el = document.createElement('div');
    el.className = 'fe ' + kind;
    el.innerHTML = html;
    feedEl.prepend(el);
    setTimeout(() => el.classList.add('out'), 6500);
    setTimeout(() => el.remove(), 7400);
    while (feedEl.children.length > 6) feedEl.lastChild.remove();
  }
  let announceT = null;
  function announce(big, small = '', kind = '') {
    const a = $('.bt-announce');
    a.className = 'bt-announce show ' + kind;
    a.innerHTML = `<div class="an-line"></div><h2>${big}</h2>${small ? `<p>${small}</p>` : ''}<div class="an-line"></div>`;
    clearTimeout(announceT);
    announceT = setTimeout(() => a.classList.remove('show'), 2800);
  }
  const floats = [];
  function floatText(x, z, text, kind) {
    if (floats.length > 14) return;
    const el = document.createElement('div');
    el.className = 'ft ' + kind;
    el.textContent = text;
    labelsRoot.appendChild(el);
    floats.push({ el, x, z, y: sim.terrain.at(x, z) + 6, t: 0 });
  }
  const uname = (u) => `<b style="color:${sim.sides[u.side].color}">${u.side === ps ? '' : 'Enemy '}${u.t.name}</b>`;

  // ---------------------------------------------------------------- orders
  const selUnits = (all = false) => [...selected].map((id) => sim.units[id]).filter((u) => u.alive > 0 && (all || u.mstate < 2));
  function useAbility(k) {
    let any = false;
    for (const u of selUnits()) if (u.abilList.includes(k)) any = sim.useAbility(u.id, k) || any;
    if (!any) audio.sfx('click', 0.4);
    renderDetail();
  }
  function act(a) {
    const us = selUnits();
    if (a === 'begin') { if (sim.phase === 'deploy' && !intro.on) begin(); return; }
    if (a === 'pause') { paused = !paused; $('[data-act=pause]').classList.toggle('on', paused); hud.classList.toggle('paused', paused); return; }
    if (a === 'cine') { cinematic = !cinematic; localStorage.setItem('aquila.cine', cinematic ? 'on' : 'off'); $('[data-act=cine]').classList.toggle('on', cinematic); return; }
    if (a === 'run') { const on = !us.every((u) => u.run); for (const u of us) sim.setRun(u.id, on); }
    if (a === 'halt') for (const u of us) sim.orderHalt(u.id);
    if (a === 'holdfire') { const ms = us.filter((u) => u.t.range); const hold = ms.every((u) => !u.holdFire); for (const u of ms) { u.holdFire = hold; if (hold) u.fireTarget = -1; } }
    if (a === 'skirmish') { const ms = us.filter((u) => u.t.range); const on = !ms.every((u) => u.skirmish); for (const u of ms) u.skirmish = on; }
    audio.sfx('click');
    refreshAll();
  }
  hud.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act],[data-speed]');
    if (!b) return;
    if (b.dataset.speed) { speed = Number(b.dataset.speed); paused = false; hud.classList.remove('paused'); hud.querySelectorAll('[data-speed],[data-act=pause]').forEach((x) => x.classList.toggle('on', x === b)); return; }
    act(b.dataset.act);
  });
  hud.addEventListener('mousedown', (e) => { if (e.target.closest('button,.uc,.bt-detail,.bt-map')) e.stopPropagation(); });

  function begin() {
    sim.start();
    view.hideZone();
    hud.classList.add('started');
    audio.sfx('horn', 1); setTimeout(() => audio.sfx('roar', 0.8), 700);
    announce('To Battle!', `${me.gen?.name ?? 'The general'} gives the signal`, 'gold');
    refreshAll();
  }

  function planLine(us, x, z, face, width = null) {
    const rx = Math.cos(face), rz = -Math.sin(face);
    const sorted = [...us].sort((a, b) => (a.cx * rx + a.cz * rz) - (b.cx * rx + b.cz * rz));
    const nat = sorted.map((u) => Math.min(u.cols, u.alive) * u.spX);
    const gap = 3;
    const natural = nat.reduce((a, b) => a + b, 0) + gap * (sorted.length - 1);
    const scale = width ? Math.max(0.25, (width - gap * (sorted.length - 1)) / Math.max(1, natural - gap * (sorted.length - 1))) : 1;
    const ws = nat.map((w) => w * scale);
    const total = ws.reduce((a, b) => a + b, 0) + gap * (sorted.length - 1);
    let off = -total / 2;
    return sorted.map((u, i) => {
      const c = off + ws[i] / 2; off += ws[i] + gap;
      return { unit: u.id, x: x + rx * c, z: z + rz * c, face, cols: Math.max(2, Math.round(ws[i] / u.spX)) };
    });
  }
  function issuePlans(plans, run) {
    for (const p of plans) {
      const u = sim.units[p.unit];
      if (sim.phase === 'battle') view.orderArrow(u.cx, u.cz, p.x, p.z, run ? '#ffb25a' : '#ffe08a');
      sim.orderWidth(p.unit, p.cols); sim.orderMove(p.unit, p.x, p.z, p.face, run);
    }
    view.showGhost(plans); view.fadeGhost();
    audio.sfx('click', 0.6);
    renderDetail();
  }
  function moveSelectedTo(x, z, run) {
    const us = selUnits();
    if (!us.length) return;
    let gx = 0, gz = 0; for (const u of us) { gx += u.cx; gz += u.cz; } gx /= us.length; gz /= us.length;
    const d = Math.hypot(x - gx, z - gz);
    const face = d > 8 ? Math.atan2(x - gx, z - gz) : us[0].fx;
    if (us.length === 1) issuePlans([{ unit: us[0].id, x, z, face, cols: us[0].cols }], run);
    else issuePlans(planLine(us, x, z, face), run);
  }

  // ---------------------------------------------------------------- minimap
  const mapCv = $('.bt-map canvas'), mctx = mapCv.getContext('2d');
  const MW = 220, MR = FIELD + 40, ms = MW / (2 * MR);
  const bg = document.createElement('canvas'); bg.width = bg.height = MW;
  {
    const g = bg.getContext('2d'), img = g.createImageData(MW, MW);
    const c1 = view.B.g1, rgb = [parseInt(c1.slice(1, 3), 16), parseInt(c1.slice(3, 5), 16), parseInt(c1.slice(5, 7), 16)];
    for (let y = 0; y < MW; y++) for (let x = 0; x < MW; x++) {
      const wx = x / ms - MR, wz = y / ms - MR;
      const h = sim.terrain.at(wx, wz), hx = sim.terrain.at(wx + 4, wz), hz = sim.terrain.at(wx, wz + 4);
      const shade = 0.75 + Math.max(-0.35, Math.min(0.35, (h - hx) * 0.08 + (h - hz) * 0.08)) + h * 0.006;
      const k = (y * MW + x) * 4;
      img.data[k] = rgb[0] * shade * 0.8; img.data[k + 1] = rgb[1] * shade * 0.8; img.data[k + 2] = rgb[2] * shade * 0.8; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  const toMap = (x, z) => [(x + MR) * ms, (z + MR) * ms];
  const fromMap = (mx, my) => [mx / ms - MR, my / ms - MR];
  function drawMap() {
    mctx.drawImage(bg, 0, 0);
    if (sim.phase === 'deploy') {
      const zn = sim.zoneOf(ps); const [a, b] = toMap(zn.xMin - 120, zn.zMin), [c, d] = toMap(zn.xMax + 120, zn.zMax);
      mctx.strokeStyle = 'rgba(255,224,138,0.7)'; mctx.setLineDash([4, 3]); mctx.strokeRect(a, b, c - a, d - b); mctx.setLineDash([]);
    }
    for (const u of sim.units) {
      if (u.alive <= 0) continue;
      const [x, y] = toMap(u.cx, u.cz);
      const w = Math.max(3, sim.unitWidth(u) * ms), h = Math.max(2, sim.unitDepth(u) * ms);
      mctx.save(); mctx.translate(x, y); mctx.rotate(-u.fx);
      mctx.fillStyle = u.mstate >= 2 ? '#ddd' : sim.sides[u.side].color;
      mctx.globalAlpha = u.mstate >= 2 ? 0.55 : 1;
      mctx.fillRect(-w / 2, -h / 2, w, h);
      if (selected.has(u.id)) { mctx.strokeStyle = '#ffe08a'; mctx.lineWidth = 1.5; mctx.strokeRect(-w / 2 - 1.5, -h / 2 - 1.5, w + 3, h + 3); }
      mctx.restore();
    }
    // camera view
    const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([sx, sy]) => view.rayGround(sx, Math.max(sy, innerHeight * 0.08)));
    if (pts.every(Boolean)) {
      mctx.strokeStyle = 'rgba(255,255,255,0.75)'; mctx.lineWidth = 1; mctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = toMap(Math.max(-MR, Math.min(MR, p.x)), Math.max(-MR, Math.min(MR, p.z))); if (i) mctx.lineTo(x, y); else mctx.moveTo(x, y); });
      mctx.closePath(); mctx.stroke();
    }
  }
  mapCv.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const r = mapCv.getBoundingClientRect();
    const [x, z] = fromMap((e.clientX - r.left) * (MW / r.width), (e.clientY - r.top) * (MW / r.height));
    if (e.button === 2) moveSelectedTo(x, z, false); else { view.cam.tx = x; view.cam.tz = z; }
  });
  mapCv.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------- input
  const canvas = renderer.domElement;
  let lDown = null, rDown = null, mDown = null, lastRight = 0, rDrag = false;
  const skipIntro = () => { if (intro.on) { intro.t = intro.dur; return true; } return false; };
  const onDown = (e) => {
    audio.init();
    if (skipIntro()) return;
    if (e.button === 0) lDown = { x: e.clientX, y: e.clientY };
    if (e.button === 2) { rDown = { x: e.clientX, y: e.clientY, g: view.rayGround(e.clientX, e.clientY) }; rDrag = false; }
    if (e.button === 1) { mDown = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
  };
  const onMove = (e) => {
    if (intro.on) return;
    if (mDown) { view.cam.tyaw -= (e.clientX - mDown.x) * 0.006; view.cam.tpitch += (e.clientY - mDown.y) * 0.004; mDown = { x: e.clientX, y: e.clientY }; return; }
    if (lDown && Math.hypot(e.clientX - lDown.x, e.clientY - lDown.y) > 6) {
      const x0 = Math.min(lDown.x, e.clientX), y0 = Math.min(lDown.y, e.clientY);
      Object.assign(boxEl.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - lDown.x) + 'px', height: Math.abs(e.clientY - lDown.y) + 'px' });
    }
    if (rDown && rDown.g && selected.size) {
      const g = view.rayGround(e.clientX, e.clientY);
      if (g && Math.hypot(g.x - rDown.g.x, g.z - rDown.g.z) > 5) {
        rDrag = true;
        const dx = g.x - rDown.g.x, dz = g.z - rDown.g.z, L = Math.hypot(dx, dz);
        let fx = dz / L, fz = -dx / L;
        const cf = view.forward();
        if (fx * cf.x + fz * cf.z < 0) { fx = -fx; fz = -fz; }
        const plans = planLine(selUnits(), (g.x + rDown.g.x) / 2, (g.z + rDown.g.z) / 2, Math.atan2(fx, fz), L);
        view.showGhost(plans);
        rDown.plans = plans;
      }
    }
    if (!lDown && !rDown && e.target === canvas) {
      hovered = view.unitAt(e.clientX, e.clientY).unit;
      tipAt(e.clientX, e.clientY);
    } else if (e.target !== canvas) tipEl.style.display = 'none';
  };
  const onUp = (e) => {
    if (intro.on) return;
    if (e.button === 1) mDown = null;
    if (e.button === 0 && lDown) {
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (boxEl.style.display === 'block') {
        const r = boxEl.getBoundingClientRect();
        if (!add) selected.clear();
        for (const u of myUnits) {
          if (u.alive <= 0) continue;
          const s = view.screenOf(u.cx, sim.terrain.at(u.cx, u.cz) + 1, u.cz);
          if (s.vis && s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom) selected.add(u.id);
        }
        boxEl.style.display = 'none';
      } else if (e.target === canvas) {
        // trackpad-friendly: with troops selected, a left click on an enemy attacks and on open ground moves
        const { unit, ground } = view.unitAt(e.clientX, e.clientY);
        const now = performance.now(), dblL = now - (onUp.lastL || 0) < 320; onUp.lastL = now;
        const us = selUnits();
        if (unit >= 0 && sim.units[unit].side === ps) {
          if (!add) selected.clear();
          if (add && selected.has(unit)) selected.delete(unit); else selected.add(unit);
          audio.sfx('click');
        } else if (unit >= 0 && us.length && sim.phase === 'battle') {
          const T = sim.units[unit];
          for (const u of us) { sim.orderAttack(u.id, unit, dblL || u.run); view.orderArrow(u.cx, u.cz, T.cx, T.cz, '#ff6a4a'); }
          audio.sfx('click');
          const el = plates.get(unit); el.classList.add('targeted'); setTimeout(() => el.classList.remove('targeted'), 800);
        } else if (ground && us.length && !add) moveSelectedTo(ground.x, ground.z, dblL);
        else if (!add) selected.clear();
      }
      lDown = null;
      refreshAll();
    }
    if (e.button === 2 && rDown) {
      const now = performance.now();
      const dbl = now - lastRight < 320;
      lastRight = now;
      const us = selUnits();
      if (rDrag && rDown.plans) issuePlans(rDown.plans, dbl);
      else if (us.length && e.target === canvas) {
        const { unit, ground } = view.unitAt(e.clientX, e.clientY);
        if (unit >= 0 && sim.units[unit].side !== ps && sim.phase === 'battle') {
          const T = sim.units[unit];
          for (const u of us) { sim.orderAttack(u.id, unit, dbl || u.run); view.orderArrow(u.cx, u.cz, T.cx, T.cz, '#ff6a4a'); }
          audio.sfx('click');
          const el = plates.get(unit); el.classList.add('targeted'); setTimeout(() => el.classList.remove('targeted'), 800);
        } else if (ground) moveSelectedTo(ground.x, ground.z, dbl);
      }
      rDown = null; rDrag = false;
      renderDetail();
    }
  };
  const onWheel = (e) => { e.preventDefault(); if (!intro.on) view.cam.tdist *= Math.exp(e.deltaY * 0.0012); };
  const onCtx = (e) => e.preventDefault();
  const ABIL_KEYS = { z: ['pila'], x: ['charge', 'wedge'], c: ['warcry', 'fire'], v: ['inspire'], g: ['rally'], t: ['testudo', 'phalanx'] };
  const onKey = (e) => {
    if (e.type === 'keyup') { keys.delete(e.key.toLowerCase()); return; }
    const k = e.key.toLowerCase();
    if (document.querySelector('.battle-end')) return;
    if (skipIntro()) return;
    keys.add(k);
    if (e.repeat) return;
    if (k === ' ') { e.preventDefault(); act('pause'); }
    else if (k === 'r') act('run');
    else if (k === 'h' || k === 'backspace') act('halt');
    else if (k === 'f') act('holdfire');
    else if (k === 'k') act('skirmish');
    else if (ABIL_KEYS[k] && !(k === 'z' && (e.ctrlKey || e.metaKey))) { for (const ab of ABIL_KEYS[k]) useAbility(ab); }
    else if (k === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); selected.clear(); for (const u of myUnits) if (u.alive > 0 && u.mstate < 2) selected.add(u.id); refreshAll(); }
    else if (/^[1-9]$/.test(k)) { const u = myUnits[Number(k) - 1]; if (u) { if (!e.shiftKey) selected.clear(); selected.add(u.id); if (e.altKey) focusUnit(u); refreshAll(); } }
    else if (k === 'enter' && sim.phase === 'deploy') begin();
    else if (k === 'escape') { selected.clear(); refreshAll(); }
  };
  canvas.addEventListener('mousedown', onDown);
  hud.querySelector('.bt-intro').addEventListener('mousedown', () => skipIntro());
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onCtx);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  // hover tooltip
  let tipUnit = -1, tipPos = [0, 0];
  function tipAt(x, y) {
    tipPos = [x, y];
    tipUnit = hovered;
    if (hovered < 0) { tipEl.style.display = 'none'; return; }
    renderTip();
  }
  function renderTip() {
    const u = sim.units[tipUnit];
    if (!u || u.alive <= 0) { tipEl.style.display = 'none'; return; }
    tipEl.style.display = 'block';
    tipEl.style.setProperty('--c', sim.sides[u.side].color);
    tipEl.innerHTML = `<div class="tp-h"><span class="tp-art">${unitArt(u.t)}</span><div><b>${u.t.name}</b><small>${sim.sides[u.side].name}${u.side === ps ? '' : ' · enemy'}</small></div></div>
      <div class="tp-r"><span>Men</span><em>${u.alive} / ${u.n0}</em></div><div class="tp-r"><span>Morale</span><em class="m${u.mstate}">${moraleLabel(u)}</em></div><div class="tp-r"><span>Stamina</span><em>${staminaLabel(u.fatigue)}</em></div><div class="tp-r"><span>Kills</span><em>${u.kills}</em></div>
      <div class="tp-s">ATK ${u.t.atk} · DEF ${u.t.def} · ARM ${u.t.armor} · CHG ${u.t.charge}${u.t.range ? ` · RNG ${u.t.range}` : ''}</div>`;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = Math.min(innerWidth - r.width - 10, tipPos[0] + 18) + 'px';
    tipEl.style.top = Math.max(10, tipPos[1] - r.height - 12) + 'px';
  }

  // ---------------------------------------------------------------- events → sound, particles, cinematics
  let enemyBreaking = false, ourBreaking = false;
  function slowmo(dur, why) {
    if (!cinematic || slowCD > 0) return;
    slowT = dur; slowCD = 14;
    hud.classList.add('slow');
    if (why) $('.bt-slow').textContent = why;
  }
  function handleEvents() {
    const cam = view.camera.position;
    const camT = { x: view.cam.x, z: view.cam.z };
    const vol = (x, z) => Math.max(0, 1 - Math.hypot(x - cam.x, z - cam.z, cam.y) / 420);
    const near = (x, z, r) => Math.hypot(x - camT.x, z - camT.z) < r && view.cam.dist < 220;
    let fighting = 0;
    for (const ev of sim.events) {
      const y = () => sim.terrain.at(ev.x, ev.z);
      switch (ev.type) {
        case 'clash': audio.sfx('clash', vol(ev.x, ev.z) * 0.8); fighting++; if (Math.random() < 0.6) for (let k = 0; k < 4; k++) view.spark(ev.x, y() + 1.3, ev.z); break;
        case 'death': audio.sfx('death', vol(ev.x, ev.z) * 0.5); view.blood(ev.x, ev.z); if (Math.random() < 0.6) for (let k = 0; k < 4; k++) view.puff(ev.x, y() + 1.2, ev.z, 'blood'); fighting++; break;
        case 'blood': if (Math.random() < 0.5) for (let k = 0; k < 3; k++) view.puff(ev.x, y() + 1.3, ev.z, 'blood'); break;
        case 'volley': audio.sfx('volley', vol(ev.x, ev.z)); break;
        case 'block': audio.sfx('block', vol(ev.x, ev.z) * 0.5); if (Math.random() < 0.3) view.spark(ev.x, y() + 1.2, ev.z); break;
        case 'burn': view.spark(ev.x, y() + 1, ev.z, 'ember'); break;
        case 'impact': audio.sfx('impact', vol(ev.x, ev.z)); for (let k = 0; k < 2; k++) view.puff(ev.x, y() + 0.5, ev.z, 'dust'); break;
        case 'charge': if (ev.cav) audio.sfx('impact', vol(ev.x, ev.z) * 0.6); audio.sfx('roar', vol(ev.x, ev.z) * 0.7); break;
        case 'chargehit': {
          const A = sim.units[ev.unit], D = sim.units[ev.target];
          audio.sfx('impact', Math.max(0.5, vol(ev.x, ev.z))); audio.sfx('roar', vol(ev.x, ev.z) * 0.6);
          view.spark(ev.x, y() + 1.5, ev.z, 'flash');
          for (let k = 0; k < 10; k++) view.spark(ev.x + (Math.random() - 0.5) * 4, y() + 1.4, ev.z + (Math.random() - 0.5) * 4);
          for (let k = 0; k < 6; k++) view.puff(ev.x + (Math.random() - 0.5) * 5, y() + 0.6, ev.z + (Math.random() - 0.5) * 5, 'dust');
          if (near(ev.x, ev.z, 160)) view.shake(A.t.cls === 'elephant' ? 1.4 : ev.cav ? 0.9 : 0.45);
          floatText(ev.x, ev.z, A.side === ps ? 'CHARGE!' : 'CHARGED!', A.side === ps ? 'gold' : 'red');
          feed(`${uname(A)} crash into ${uname(D)}`, A.side === ps ? 'good' : 'bad');
          if (ev.cav && near(ev.x, ev.z, 140)) slowmo(1.1, 'The charge strikes home');
          break;
        }
        case 'flanked': {
          const u = sim.units[ev.unit];
          floatText(ev.x, ev.z, ev.rear ? 'REAR ATTACK!' : 'FLANKED!', u.side === ps ? 'red' : 'gold');
          feed(`${uname(u)} ${ev.rear ? 'hit from behind' : 'flanked'}!`, u.side === ps ? 'bad' : 'good');
          break;
        }
        case 'ability': {
          const u = sim.units[ev.unit];
          const M = ABIL[ev.key];
          if (!M.toggle) floatText(ev.x, ev.z, M.name.toUpperCase(), u.side === ps ? 'gold' : 'red');
          if (ev.key === 'warcry') audio.sfx('roar', 1);
          else if (ev.key === 'charge' || ev.key === 'wedge') audio.sfx('hornHigh', 0.6);
          else if (ev.key === 'inspire' || ev.key === 'rally') audio.sfx('hornHigh', 0.8);
          else if (ev.key === 'fire') audio.sfx('volley', 0.8);
          if (u.side !== ps && ['warcry', 'inspire'].includes(ev.key)) feed(`${uname(u)} use ${M.name}`, 'bad');
          break;
        }
        case 'rally': floatText(ev.x, ev.z, 'RALLY!', ev.side === ps ? 'gold' : 'red'); audio.sfx('hornHigh', 0.8); break;
        case 'rout': {
          const u = sim.units[ev.unit];
          floatText(u.cx, u.cz, 'ROUTED', u.side === ps ? 'white' : 'gold');
          feed(u.side === ps ? `Your ${u.t.name} break and run!` : `The enemy ${u.t.name} flee!`, u.side === ps ? 'bad' : 'good');
          if (Math.random() < 0.5) audio.sfx(u.side === ps ? 'horn' : 'roar', 0.5);
          const brk = (si) => sim.units.filter((x) => x.side === si && x.alive > 0 && x.mstate >= 2).length / Math.max(1, sim.units.filter((x) => x.side === si && x.alive > 0).length);
          if (!enemyBreaking && brk(1 - ps) > 0.5) { enemyBreaking = true; announce('The Enemy Breaks!', 'Ride them down', 'gold'); audio.sfx('fanfare', 0.7); }
          if (!ourBreaking && brk(ps) > 0.5) { ourBreaking = true; announce('Our Lines Are Breaking', 'Rally the men or sound the retreat', 'red'); }
          break;
        }
        case 'rallied': { const u = sim.units[ev.unit]; floatText(u.cx, u.cz, 'RALLIED', u.side === ps ? 'gold' : 'red'); if (u.side === ps) feed(`Your ${u.t.name} have rallied`, 'good'); break; }
        case 'general': {
          const mine = ev.side === ps;
          announce(mine ? 'Our General Has Fallen' : 'The Enemy General Is Slain', mine ? 'The men waver' : 'Their army loses heart', mine ? 'red' : 'gold');
          audio.sfx(mine ? 'dirge' : 'roar', 0.9);
          slowmo(1.6, mine ? '' : '');
          break;
        }
        case 'end': finish(); break;
      }
    }
    sim.events.length = 0;
    audio.setBattleIntensity(fighting / 6);
  }

  // ---------------------------------------------------------------- end
  function finish() {
    if (ended) return;
    ended = true;
    const res = sim.results();
    const won = res.winner === ps;
    const mine = res.sides[ps], theirs = res.sides[1 - ps];
    const ratio = mine.lost / Math.max(1, mine.start);
    const grade = won ? (ratio < 0.15 ? 'Heroic Victory' : ratio < 0.4 ? 'Decisive Victory' : ratio < 0.65 ? 'Close Victory' : 'Pyrrhic Victory') : (theirs.lost / Math.max(1, theirs.start) > 0.5 ? 'Valiant Defeat' : 'Crushing Defeat');
    announce(won ? 'Victory' : 'Defeat', grade, won ? 'gold' : 'red');
    audio.sfx(won ? 'fanfare' : 'dirge', 1);
    const mvp = sim.units.filter((u) => u.side === ps).sort((a, b) => b.kills - a.kills)[0];
    // strength over time
    const H = sim.history.length ? sim.history : [[1, 1]];
    const max = Math.max(...H.flat(), 1);
    const W = 560, GH = 110;
    const path = (si) => H.map((h, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, H.length - 1)) * W).toFixed(1)},${(GH - (h[si] / max) * (GH - 8)).toFixed(1)}`).join(' ');
    const area = (si) => `${path(si)} L${W},${GH} L0,${GH} Z`;
    const graph = `<svg viewBox="0 0 ${W} ${GH}" preserveAspectRatio="none"><path d="${area(1 - ps)}" fill="${foe.color}" opacity="0.18"/><path d="${area(ps)}" fill="${me.color}" opacity="0.22"/><path d="${path(1 - ps)}" stroke="${foe.color}" stroke-width="2" fill="none"/><path d="${path(ps)}" stroke="${me.color}" stroke-width="2.5" fill="none"/></svg>`;
    const rows = (si) => sim.units.filter((u) => u.side === si).map((u) => {
      const lost = u.n0 - u.alive - u.escaped;
      return `<tr class="${u.alive <= 0 ? 'gone' : ''}"><td><span class="ti">${unitIcon(u.t)}</span>${u.t.name}</td><td class="bar"><i style="width:${((u.n0 - lost) / u.n0) * 100}%;background:${sim.sides[si].color}"></i></td><td>${u.n0 - lost}/${u.n0}</td><td>${u.kills}</td></tr>`;
    }).join('');
    const t = Math.floor(sim.time);
    const el = document.createElement('div');
    el.className = 'modal-wrap battle-end';
    el.innerHTML = `<div class="be ${won ? 'win' : 'loss'}">
      <div class="be-ban"><span>${won ? 'Victoria' : 'Clades'}</span></div>
      <h1>${grade}</h1>
      <p class="be-sub">${won ? 'The field is ours. The enemy breaks and runs.' : 'Our lines are broken. The survivors fall back.'} <em>${Math.floor(t / 60)}m ${t % 60}s of battle</em></p>
      <div class="be-top">
        <div class="be-num" style="--c:${me.color}"><b data-count="${mine.kills}">0</b><small>enemies slain</small></div>
        <div class="be-num" style="--c:${foe.color}"><b data-count="${mine.lost}">0</b><small>of our men fallen</small></div>
        ${mvp ? `<div class="be-mvp" style="--c:${me.color}"><span class="mv-art">${unitArt(mvp.t)}</span><div><small>Hero of the battle</small><b>${mvp.t.name}</b><em>${mvp.kills} kills</em></div></div>` : ''}
      </div>
      <div class="be-graph"><div class="bg-cap"><span style="color:${me.color}">■</span> ${me.name} <span style="color:${foe.color}">■</span> ${foe.name} — strength through the battle</div>${graph}</div>
      <div class="be-cols">
        <div><h3 style="--c:${me.color}">${me.name}</h3><table>${rows(ps)}</table></div>
        <div><h3 style="--c:${foe.color}">${foe.name}</h3><table>${rows(1 - ps)}</table></div>
      </div>
      <div class="m-actions"><button class="btn ghost" data-x="watch">View the field</button><button class="btn gold big" data-x="cont">Continue</button></div></div>`;
    setTimeout(() => {
      uiRoot.appendChild(el);
      el.querySelectorAll('[data-count]').forEach((b) => {
        const target = Number(b.dataset.count); const t0 = performance.now();
        const tick = (now) => { const k = Math.min(1, (now - t0) / 1200); b.textContent = fmt(target * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      el.querySelector('[data-x=cont]').onclick = () => { audio.sfx('click'); cleanup(); resolveDone(res); };
      el.querySelector('[data-x=watch]').onclick = () => { el.classList.toggle('peek'); };
      el.addEventListener('mousedown', (e) => e.stopPropagation());
    }, 2600);
  }
  const retreatBtn = $('.bt-retreat');
  retreatBtn.onclick = () => {
    if (sim.phase !== 'battle') return;
    if (!retreatBtn.classList.contains('armed') && !window.__autoConfirm) { retreatBtn.classList.add('armed'); retreatBtn.textContent = 'Confirm retreat?'; setTimeout(() => { retreatBtn.classList.remove('armed'); retreatBtn.textContent = 'Retreat'; }, 3000); return; }
    for (const u of sim.units) if (u.side === ps && u.alive > 0 && u.mstate < 2) sim.rout(u);
  };

  function cleanup() {
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onCtx);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    hud.remove();
    for (const [, el] of plates) el.remove();
    for (const f of floats) f.el.remove();
    uiRoot.querySelectorAll('.battle-end').forEach((x) => x.remove());
    view.composer.dispose?.();
    view.envRT?.dispose();
    view.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); }); });
  }

  // ---------------------------------------------------------------- intro camera
  const startCam = { ...view.cam };
  function updateIntro(dt) {
    intro.t += dt;
    const k = Math.min(1, intro.t / intro.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    const c = view.cam;
    // sweep from a high view over the enemy down behind our own lines
    const enemyZ = sim.zoneOf(1 - ps).z0;
    c.tx = c.x = Math.sin(intro.t * 0.15) * 40 * (1 - e) + startCam.tx * e;
    c.tz = c.z = enemyZ * (1 - e) * 0.6 + startCam.tz * e;
    c.tdist = c.dist = 420 * (1 - e) + startCam.tdist * e;
    c.tyaw = c.yaw = startCam.tyaw + (1 - e) * 1.1;
    c.tpitch = c.pitch = 0.95 * (1 - e) + startCam.tpitch * e;
    if (k >= 1) {
      intro.on = false;
      hud.classList.remove('intro');
      hud.classList.add('deploying');
      audio.sfx('drum', 0.8);
    }
  }

  // ---------------------------------------------------------------- frame
  let uiT = 0, mapT = 0;
  function frame(dt) {
    if (intro.on) updateIntro(dt);
    const c = view.cam, sp = c.dist * 1.1 * dt;
    if (!intro.on) {
      if (keys.has('w') || keys.has('arrowup')) view.pan(0, sp);
      if (keys.has('s') || keys.has('arrowdown')) view.pan(0, -sp);
      if (keys.has('a') && !keys.has('control') && !keys.has('meta')) view.pan(-sp, 0);
      if (keys.has('arrowleft')) view.pan(-sp, 0);
      if (keys.has('d') || keys.has('arrowright')) view.pan(sp, 0);
      if (keys.has('q')) c.tyaw += dt * 1.4;
      if (keys.has('e')) c.tyaw -= dt * 1.4;
    }
    // slow motion
    let scale = speed;
    if (slowT > 0) { slowT -= dt; scale = Math.min(speed, 0.28); if (slowT <= 0) hud.classList.remove('slow'); }
    if (slowCD > 0) slowCD -= dt;
    if (!paused) {
      acc += Math.min(0.1, dt) * scale;
      let n = 0;
      while (acc >= STEP && n < 8) {
        for (const ai of ais) if (ai) ai.update(STEP);
        sim.step(STEP); acc -= STEP; n++;
      }
      if (n === 8) acc = 0;
    }
    handleEvents();
    view.render(paused ? 0 : dt * (slowT > 0 ? 0.35 : 1), selected, hovered);
    // HUD at 8 Hz
    uiT -= dt;
    if (uiT <= 0) {
      uiT = 0.12;
      refreshCards();
      renderDetail();
      const a = sim.sideStrength(ps), b = sim.sideStrength(1 - ps), fa = a / (a + b || 1);
      $('.bt-bal .a').style.width = `${fa * 100}%`; $('.bt-bal .b').style.width = `${(1 - fa) * 100}%`; $('.bt-bal .mk').style.left = `${fa * 100}%`;
      hud.querySelectorAll('[data-men]').forEach((el) => (el.textContent = fmt(menCount(Number(el.dataset.men)))));
      hud.querySelectorAll('[data-kills]').forEach((el) => (el.textContent = fmt(killCount(Number(el.dataset.kills)))));
      if (sim.phase === 'battle') {
        const left = Math.max(0, sim.timeLimit - sim.time);
        $('.bt-clock .ph').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      }
      if (tipUnit >= 0 && tipEl.style.display === 'block') renderTip();
    }
    mapT -= dt;
    if (mapT <= 0) { mapT = 0.1; drawMap(); }
    // floating plates
    const far = view.cam.dist > 260;
    for (const u of sim.units) {
      const el = plates.get(u.id);
      if (u.alive <= 0 || intro.on) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      const h = u.t.cls === 'elephant' ? 10 : isCav(u.t) ? 7.5 : 6.2;
      const s = view.screenOf(u.cx, sim.terrain.at(u.cx, u.cz) + h, u.cz);
      if (!s.vis) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${s.x | 0}px, ${s.y | 0}px) translate(-50%, -100%)`;
      el.classList.toggle('sel', selected.has(u.id));
      el.classList.toggle('hov', hovered === u.id);
      el.classList.toggle('waver', u.mstate === 1);
      el.classList.toggle('rout', u.mstate >= 2);
      el.classList.toggle('eng', u.engaged && u.mstate < 2);
      el.classList.toggle('far', far);
      el.classList.toggle('pow', u.abilList.some((k) => !ABIL[k].toggle && sim.active(u, k)));
      el.querySelector('.ub-hp i').style.width = `${(u.alive / u.n0) * 100}%`;
      el.querySelector('.ub-name em').textContent = u.alive;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.t += dt;
      const s = view.screenOf(f.x, f.y, f.z);
      if (f.t > 1.8 || !s.vis) { f.el.remove(); floats.splice(i, 1); continue; }
      f.el.style.transform = `translate(${s.x | 0}px, ${(s.y - f.t * 38) | 0}px) translate(-50%, -100%) scale(${1 + Math.max(0, 0.25 - f.t) * 1.6})`;
      f.el.style.opacity = Math.min(1, (1.8 - f.t) * 1.6);
    }
  }

  refreshAll();
  window.__battle = { sim, view, begin, selected, act, finish, skipIntro, useAbility };
  return { frame, resize: () => view.resize(), done, sim, view };
}
