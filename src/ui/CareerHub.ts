import { CIRCUITS } from '../world/Circuits.ts';
import { TEAMS, type DriverLook } from '../race/Teams.ts';
import { ATTRS, DriverCareer, NATIONS, RD, RD_MAX, SERIES_NAME, levelLabel, levelOf, rdCost, statusLabel, teamColor, teamName, type Ask, type AttrId, type Choice, type Contract, type Msg, type RoundSummary, type Status } from '../career/DriverCareer.ts';
import { f1Original, f2Teams, type PlayerDriver } from '../career/Series.ts';
import { PALETTE } from '../career/Career.ts';
import { artFor } from './loadingArt.ts';
import { GEO, PIN_OFFSET, MAP, MAP_H, project, landPath } from '../career/Season.ts';

/**
 * The driver career's screens: the hub (who you are, the next round, the inbox where the
 * season talks back, your contract and the championship) and the new-career wizard (create a
 * driver, or take over a current F1 driver's seat). Rendered as HTML over the garage.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface HubCtx {
  dc: DriverCareer;
  /** register a clickable for the menu's keyboard/gamepad navigation */
  action(e: HTMLElement, fn: () => void, disabled?: boolean): void;
  onRace(track: string): void;
  onCalendar(): void;
  onNewCareer(): void;
  /** something in the career changed (an answer, a signature): re-render, and the game re-syncs its grid */
  changed(): void;
  /** re-render the hub (a section switched) */
  rerender(): void;
  /** open the car-development tab (the R&D) */
  onDevelop(): void;
  forecast(track: string): string;
  circuitPath(points: number[]): string;
}

export type HubView = 'overview' | 'inbox' | 'standings' | 'driver' | 'history';
let view: HubView = 'overview';
/** open the hub on a section next time it renders */
export function setHubView(v: HubView) {
  view = v;
}

const pos = (p: number, dnf: boolean) => (dnf ? 'DNF' : `P${p}`);
const meter = (label: string, v: number, note = '') => `<div class="ch-meter"><span>${label}</span><div class="bar"><i style="width:${Math.round(v)}%"></i></div><b>${Math.round(v)}</b>${note ? `<em>${note}</em>` : ''}</div>`;

/** the career hub, in the garage's wide panel */
export function renderHub(p: HTMLElement, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  const me = d.driver;
  const { pos: cp, points } = dc.position();
  const tn = teamName(d.series, d.contract.team);
  const tc = teamColor(d.series, d.contract.team);
  p.classList.add('ch');
  p.style.setProperty('--team', tc);

  // ---- who you are
  const head = el('div', 'ch-head', p);
  head.innerHTML =
    `<div class="ch-id"><div class="ch-num" style="--h1:${me.helmet[0]};--h2:${me.helmet[1]}">${me.number}</div>` +
    `<div><div class="cap">${SERIES_NAME[d.series]} · ${d.year} · ${esc(me.nationality)} · Age ${d.age}</div><div class="ch-name">${esc(me.first)} <b>${esc(me.last.toUpperCase())}</b></div><div class="ch-team"><i></i>${esc(tn)} · ${statusLabel(d.contract.status)}</div></div></div>` +
    `<div class="ch-stats">` +
    `<div class="cs ovr"><b>${dc.ovr}</b><span>Overall</span></div>` +
    `<div class="cs"><b>${cp ? `P${cp}` : '—'}</b><span>Championship · ${points} pts</span></div>` +
    `<div class="cs"><b>${d.wins}</b><span>Wins · ${d.starts} starts</span></div>` +
    `<div class="cs"><b>${d.titles}</b><span>Titles</span></div>` +
    `</div>`;

  if (d.choosing) {
    renderChoose(p, ctx);
    return;
  }
  // ---- sections
  const tabs = el('div', 'ch-tabs', p);
  const unread = dc.unread();
  const views: [HubView, string][] = [['overview', 'Overview'], ['inbox', `Inbox${unread ? ` <em>${unread}</em>` : ''}`], ['standings', 'Standings'], ['driver', 'Driver'], ['history', 'History']];
  for (const [v, label] of views) {
    const t = el('div', 'ch-tab' + (v === view ? ' on' : ''), tabs, label);
    ctx.action(t, () => {
      view = v;
      ctx.rerender();
    });
  }
  const body = el('div', 'ch-body', p);
  if (view === 'inbox') inboxView(body, ctx);
  else if (view === 'standings') standingsView(body, ctx);
  else if (view === 'driver') driverView(body, ctx);
  else if (view === 'history') historyView(body, ctx);
  else overview(body, ctx);
}

/** the round picked on the season map (null = the next one) */
let mapSel: string | null = null;

/**
 * The overview is the season: a world map of the calendar (the route flown so far, the next leg
 * drawing itself, every finish on its pin) with the picked round beneath it — and the paddock,
 * kept short, beside that.
 */
function overview(p: HTMLElement, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  const nt = dc.nextTrack;
  const cal = d.calendar;
  if (!mapSel || !cal.includes(mapSel)) mapSel = nt ?? cal[cal.length - 1];
  const wrap = el('div', 'ch-season', p);
  const map = el('div', 'cm-map ch-map', wrap);
  const lower = el('div', 'ch-lower', wrap);
  const card = el('div', 'ch-rnd', lower);
  const side = el('div', 'ch-side', lower);

  // ---- the map
  const pts = cal.map((id, i) => {
    const g = GEO[id] ?? [0, 0];
    const [x, y] = project(g[0], g[1]);
    const o = PIN_OFFSET[id] ?? [0, 0];
    return { id, i, x, y, ox: o[0], oy: o[1], cd: CIRCUITS.find((c) => c.id === id)! };
  });
  let done = '';
  let nextLeg = '';
  let todo = '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dd = Math.hypot(b.x - a.x, b.y - a.y);
    const seg = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${((a.x + b.x) / 2).toFixed(1)} ${((a.y + b.y) / 2 - Math.min(70, dd * 0.22)).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (i < d.round) done += seg;
    else if (i === d.round) nextLeg += seg;
    else todo += seg;
  }
  const pins = pts
    .map(({ id, i, x, y, ox, oy, cd }) => {
      const r = d.results[i];
      const medal = r && !r.dnf && r.pos <= 3 ? ['gold', 'silver', 'bronze'][r.pos - 1] : '';
      const cls = ['pin', 'open', r ? 'done' : '', medal, i === d.round ? 'next' : ''].filter(Boolean).join(' ');
      const label = r ? (r.dnf ? 'DNF' : `P${r.pos}`) : String(i + 1);
      const leader = ox || oy ? `<line class="leader" x1="0" y1="0" x2="${ox}" y2="${oy}"/>` : '';
      const face = `<circle class="halo" r="20"/><circle class="disc" r="${r ? 15 : 13}"/><text y="4.5"${label.length > 2 ? ' class="sm"' : ''}>${label}</text>`;
      const short = (cd?.short ?? id).toUpperCase();
      const tw = 22 + short.length * 9.4;
      const left = ox < 0 || x > MAP.w * 0.72;
      const tag = `<g class="tag" transform="translate(${ox + (left ? -22 : 22)} ${oy})"><rect class="tbg" x="${left ? -tw : 0}" y="-13" width="${tw.toFixed(0)}" height="26" rx="6"/><text class="tn" x="${left ? -11 : 11}" y="4.5" text-anchor="${left ? 'end' : 'start'}">${short}</text></g>`;
      return `<g class="pinw" data-id="${id}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}">${leader}<circle class="spot" r="2.4"/>${tag}<g class="${cls}" data-id="${id}" transform="translate(${ox} ${oy})">${face}</g></g>`;
    })
    .join('');
  map.innerHTML =
    `<svg viewBox="0 0 ${MAP.w} ${MAP_H}" preserveAspectRatio="xMidYMid slice">` +
    `<defs><pattern id="cm-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.05"/></pattern>` +
    `<radialGradient id="cm-vig" cx="50%" cy="45%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>` +
    `<g class="cm-world"><path class="land-base" d="${landPath()}"/><path class="land" d="${landPath()}"/>` +
    `<path class="route todo" d="${todo}"/><path class="route done" d="${done}"/><path class="route next" d="${nextLeg}"/>${pins}</g>` +
    `<rect class="vig" width="${MAP.w}" height="${MAP_H}" fill="url(#cm-vig)"/></svg>` +
    `<div class="ch-map-cap"><b>${d.year} ${SERIES_NAME[d.series]}</b><span>${nt ? `Round ${d.round + 1} of ${cal.length}` : 'Season complete'}</span></div>`;
  const world = map.querySelector<SVGGElement>('.cm-world')!;
  const pinws = Array.from(map.querySelectorAll<SVGGElement>('.pinw'));
  let first = true;
  const focus = (id: string) => {
    const g = GEO[id] ?? [45, 10];
    const europe = g[0] > 40 && g[0] < 56 && g[1] > -12 && g[1] < 28;
    const k = europe ? 2.1 : 1.4;
    const [fx, fy] = project(g[0], g[1]);
    // the part of the map the panel shows (the svg slices to fill it): centre the round in that,
    // never showing past the map's edge
    const cw = map.clientWidth || 1200;
    const ch = map.clientHeight || 260;
    const wide = cw / ch > MAP.w / MAP_H;
    const vw = wide ? MAP.w : (MAP_H * cw) / ch;
    const vh = wide ? (MAP.w * ch) / cw : MAP_H;
    const cx = MAP.w / 2;
    const cy = MAP_H / 2;
    const tx = Math.min(cx - vw / 2, Math.max(cx + vw / 2 - MAP.w * k, cx - fx * k));
    const ty = Math.min(cy - vh / 2, Math.max(cy + vh / 2 - MAP_H * k, cy - fy * k));
    map.classList.toggle('instant', first);
    world.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k})`;
    for (const w of pinws) w.style.transform = `translate(${w.dataset.x}px, ${w.dataset.y}px) scale(${(1 / k).toFixed(4)})`;
    if (first) requestAnimationFrame(() => map.classList.remove('instant'));
    first = false;
  };

  // ---- the picked round
  const draw = () => {
    const id = mapSel!;
    const i = cal.indexOf(id);
    const cd = CIRCUITS.find((c) => c.id === id)!;
    const r = d.results[i];
    const isNext = i === d.round && !!nt;
    const home = cd.country === d.driver.nationality;
    for (const g of Array.from(map.querySelectorAll<SVGGElement>('.pin'))) g.classList.toggle('sel', g.dataset.id === id);
    for (const w of pinws) w.classList.toggle('sel', w.dataset.id === id);
    focus(id);
    card.style.setProperty('--art', `url("${artFor(cd.id)}")`);
    card.innerHTML = '';
    const top = el('div', 'ch-rnd-top', card);
    top.innerHTML =
      `<div class="ch-rnd-id"><div class="cap">Round ${i + 1}${home ? ' · Home race' : ''}</div><div class="nm">${esc(cd.name)}</div>` +
      `<div class="facts"><span>${dc.laps} laps</span><span>${esc(isNext ? ctx.forecast(cd.id) : cd.country)}</span></div></div>` +
      (cd.centerline ? `<svg class="ch-rnd-track" viewBox="0 0 120 84"><path d="${ctx.circuitPath(cd.centerline.points)}"/></svg>` : '');
    if (r) {
      const mate = r.mate >= 99 ? 'DNF' : `P${r.mate}`;
      el('div', 'ch-rnd-res', card, `<b class="${r.dnf ? 'dnf' : r.pos <= 3 ? 'pod' : ''}">${r.dnf ? 'DNF' : `P${r.pos}`}</b><span>${r.points} pts${r.fastest ? ' · fastest lap' : ''}</span><span>Teammate ${mate}</span>`);
    } else if (isNext) {
      const ob = el('div', 'ch-obj', card);
      el('div', 'hp-cap', ob, `Team targets <span>expected P${dc.expected()}</span>`);
      for (const o of dc.objectives()) el('div', 'ch-o', ob, `<i></i><span>${esc(o.label)}</span><b>+${o.rp} RP</b>`);
    } else {
      const n = i - d.round;
      el('div', 'ch-rnd-res later', card, `<span>${n === 1 ? 'The round after next' : `In ${n} rounds`}</span>`);
    }
  };

  // ---- the one call to action: always the next round (whatever is picked on the map)
  const acts = el('div', 'ch-rnd-acts', lower);
  const prev = el('div', 'cta ghost ch-step', acts, '‹');
  const go = el('div', 'cta ch-go', acts, nt ? `Race round ${d.round + 1} · ${esc(CIRCUITS.find((c) => c.id === nt)?.short ?? '')}` : 'Season complete');
  const nextB = el('div', 'cta ghost ch-step', acts, '›');
  const step = (k: number) => {
    const i = cal.indexOf(mapSel!);
    mapSel = cal[(i + k + cal.length) % cal.length];
    draw();
  };
  ctx.action(prev, () => step(-1));
  if (nt) ctx.action(go, () => ctx.onRace(nt));
  else go.classList.add('dis');
  ctx.action(nextB, () => step(1));
  map.addEventListener('click', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.pin, .pinw');
    if (!g?.dataset.id) return;
    mapSel = g.dataset.id;
    draw();
  });
  map.addEventListener('dblclick', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.pin, .pinw');
    if (g?.dataset.id && g.dataset.id === nt) ctx.onRace(nt);
  });

  // ---- the paddock, short: what needs an answer, the car, the contract
  const open = d.inbox.filter((m) => m.choices && m.picked === undefined);
  const latest = open[0] ?? d.inbox[0];
  if (latest) {
    el('div', 'hp-cap', side, `Paddock${dc.unread() ? ` <span>${dc.unread()} new</span>` : ''}`);
    side.appendChild(msgCard(latest, ctx));
    if (d.inbox.length > 1) {
      const all = el('div', 'ch-link', side, `All messages (${d.inbox.length})`);
      ctx.action(all, () => {
        view = 'inbox';
        ctx.rerender();
      });
    }
  }
  draw();
  // (the first focus ran before layout: frame it again once the panel has its size)
  requestAnimationFrame(() => {
    first = true;
    draw();
  });
}

function inboxView(p: HTMLElement, ctx: HubCtx) {
  const d = ctx.dc.data!;
  const list = el('div', 'ch-msgs full', p);
  if (!d.inbox.length) el('div', 'ch-empty', list, 'Nothing yet.');
  for (const m of d.inbox) list.appendChild(msgCard(m, ctx));
  // (seen now: the badge counts what's new and what still needs an answer)
  ctx.dc.markAllRead();
}

function standingsView(p: HTMLElement, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  const grid = el('div', 'ch-grid', p);
  const drivers = el('div', 'ch-table scroll', grid);
  el('div', 'hp-cap', drivers, `${SERIES_NAME[d.series]} drivers`);
  const rows = dc.table();
  const mate = dc.mate();
  if (!rows.length) el('div', 'ch-empty', drivers, 'The table fills in after the first round.');
  rows.forEach((r, i) => {
    const tag = r.code === d.rival ? '<em class="tag riv">Rival</em>' : mate && r.code === mate.code ? '<em class="tag">Teammate</em>' : '';
    el('div', 'ch-row' + (r.code === d.driver.code ? ' me' : ''), drivers, `<span class="p">${i + 1}</span><i style="background:${r.color}"></i><span class="n">${esc(r.name)}${tag}</span><span class="t">${esc(r.team)}</span><b>${r.points}</b>`);
  });
  const teams = el('div', 'ch-table', grid);
  el('div', 'hp-cap', teams, 'Constructors');
  const tt = dc.teamTable();
  if (!tt.length) el('div', 'ch-empty', teams, 'After the first round.');
  tt.forEach((t, i) => el('div', 'ch-row team' + (t.id === d.contract.team ? ' me' : ''), teams, `<span class="p">${i + 1}</span><i style="background:${t.color}"></i><span class="n">${esc(t.name)}</span><b>${t.points}</b>`));
  // the form guide: this season's results
  if (d.results.length) {
    el('div', 'hp-cap', teams, 'Your season');
    const f = el('div', 'ch-form', teams);
    d.results.forEach((r) => {
      const cd = CIRCUITS.find((c) => c.id === r.track);
      el('div', 'fr' + (r.dnf ? ' dnf' : r.pos === 1 ? ' win' : r.pos <= 3 ? ' pod' : r.pos <= 10 ? ' pts' : ''), f, `<b>${pos(r.pos, r.dnf)}</b><span>${esc(cd?.short ?? r.track)}</span>`);
    });
  }
}

function driverView(p: HTMLElement, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  const grid = el('div', 'ch-grid', p);
  const left = el('div', 'ch-col', grid);
  const right = el('div', 'ch-col', grid);
  // ---- the ratings
  const rt = el('div', 'ch-ratings', left);
  el('div', 'hp-cap', rt, 'Driver ratings');
  el('div', 'ch-ovr', rt, `<b>${dc.ovr}</b><span>Overall rating<br><small>Teams weigh it, with your reputation, when they make offers</small></span>`);
  const delta = d.last?.attrs ?? {};
  for (const a of ATTRS) {
    const v = d.attrs[a.id];
    const dv = delta[a.id];
    el('div', 'ch-attr', rt, `<div class="an"><span>${a.name}</span><small>${a.what}</small></div><div class="bar"><i style="width:${v}%"></i></div><b>${Math.floor(v)}</b><em class="${dv && dv > 0 ? 'up' : dv && dv < 0 ? 'down' : ''}">${dv ? (dv > 0 ? `+${dv}` : dv) : ''}</em>`);
  }
  // ---- the rival and the teammate
  const riv = dc.rivalInfo();
  const rc = el('div', 'ch-rival', right);
  el('div', 'hp-cap', rc, 'Rival');
  if (riv) {
    const [a, b] = d.rivalH2H;
    rc.insertAdjacentHTML(
      'beforeend',
      `<div class="ch-vs"><div class="side me"><span>${esc(d.driver.last.toUpperCase())}</span><b>${a}</b></div><div class="mid">Head to head<br><small>${d.year}</small></div><div class="side"><b>${b}</b><span>${esc(riv.driver.last.toUpperCase())}</span></div></div>` +
        `<div class="ch-sub">${esc(riv.driver.first)} ${esc(riv.driver.last)} · ${esc(teamName(d.series, riv.team))} · Age ${riv.driver.age ?? '—'}. Lead the season series by four and a bigger rival is picked.</div>`,
    );
  } else el('div', 'ch-empty', rc, 'No rival this season.');
  const mate = dc.mate();
  const mc = el('div', 'ch-rival', right);
  el('div', 'hp-cap', mc, 'Teammate');
  if (mate) {
    const [a, b] = d.h2h.race;
    mc.insertAdjacentHTML('beforeend', `<div class="ch-vs"><div class="side me"><span>${esc(d.driver.last.toUpperCase())}</span><b>${a}</b></div><div class="mid">Races<br><small>${d.year}</small></div><div class="side"><b>${b}</b><span>${esc(mate.last.toUpperCase())}</span></div></div>`);
  }
  const st = el('div', 'ch-contract', right);
  st.innerHTML = `<div class="hp-cap">Standing</div>` + meter('Reputation', d.rep) + meter('Fan hype', d.hype) + meter('Team trust', d.rel);
}

function historyView(p: HTMLElement, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  el(
    'div',
    'ch-totals',
    p,
    [
      [d.starts, 'Starts'],
      [d.wins, 'Wins'],
      [d.podiums, 'Podiums'],
      [d.points, 'Points'],
      [d.titles, 'Titles'],
      [`$${d.money.toFixed(1)}M`, 'Earnings'],
    ]
      .map(([v, l]) => `<div class="cs"><b>${v}</b><span>${l}</span></div>`)
      .join(''),
  );
  const grid = el('div', 'ch-grid', p);
  const seasons = el('div', 'ch-table', grid);
  el('div', 'hp-cap', seasons, 'Seasons');
  el('div', 'ch-hrow head', seasons, '<span>Year</span><span>Team</span><span>Pos</span><span>Pts</span><span>Wins</span><span>Pod</span>');
  const cur = dc.position();
  el('div', 'ch-hrow live', seasons, `<span>${d.year}</span><span class="n">${esc(teamName(d.series, d.contract.team))} <small>${d.series.toUpperCase()}</small></span><span>${cur.pos ? `P${cur.pos}` : '—'}</span><span>${cur.points}</span><span>${d.results.filter((r) => !r.dnf && r.pos === 1).length}</span><span>${d.results.filter((r) => !r.dnf && r.pos <= 3).length}</span>`);
  for (const h of d.history.slice().reverse())
    el('div', 'ch-hrow' + (h.champion ? ' champ' : ''), seasons, `<span>${h.year}</span><span class="n">${esc(h.teamName)} <small>${h.series.toUpperCase()}</small></span><span>P${h.position}</span><span>${h.points}</span><span>${h.wins}</span><span>${h.podiums}</span>`);
  const tro = el('div', 'ch-table', grid);
  el('div', 'hp-cap', tro, `Trophy cabinet <span>${d.trophies.length}</span>`);
  const cab = el('div', 'ch-trophies', tro);
  if (!d.trophies.length) el('div', 'ch-empty', cab, 'Points, podiums, wins and titles end up here.');
  for (const t of d.trophies.slice().reverse()) el('div', 'tr' + (/champion|title/i.test(t.title) ? ' gold' : ''), cab, `<i></i><div><b>${esc(t.title)}</b><span>${esc(t.detail)}</span></div>`);
  const nc = el('div', 'ch-new', tro, 'Start a new career');
  ctx.action(nc, () => ctx.onNewCareer());
}

function msgCard(m: Msg, ctx: HubCtx): HTMLElement {
  const card = el('div', `ch-msg k-${m.kind}` + (m.read ? '' : ' unread') + (m.choices && m.picked === undefined ? ' ask' : ''));
  card.innerHTML = `<div class="mh"><span class="from">${esc(m.from)}</span><span class="r">${m.kind === 'market' || m.kind === 'season' ? 'Winter' : `R${m.round + 1}`}</span></div><div class="mt">${esc(m.title)}</div><div class="mb">${esc(m.body)}</div>`;
  if (m.choices) {
    if (m.picked === undefined) {
      const row = el('div', 'ch-choices', card);
      const btn = (label: string, cls: string, fn: () => void) => ctx.action(el('button', 'ch-choice' + cls, row, label.includes('<small>') ? label : esc(label)), fn);
      if (m.kind === 'offer') {
        btn('Sign', ' sign', () => (ctx.dc.choose(m.id, 0), ctx.changed()));
        btn('Negotiate', '', () => openTalks(m, ctx));
        btn('Decline', '', () => (ctx.dc.choose(m.id, 1), ctx.changed()));
      } else
        m.choices.forEach((c, i) => {
          // (a paddock event shows what each choice does)
          const fx = m.kind === 'event' ? effects(c) : '';
          btn(c.label + (fx ? ` <small>${fx}</small>` : ''), '', () => (ctx.dc.choose(m.id, i), ctx.changed()));
        });
    } else {
      const c = m.choices[m.picked];
      el('div', 'ch-reply', card, `<b>${esc(c.label)}</b> ${esc(c.reply)}`);
    }
  }
  card.addEventListener('mouseenter', () => ctx.dc.markRead(m.id));
  return card;
}

function effects(c: Choice): string {
  const out: string[] = [];
  const f = (n: number) => (n > 0 ? `+${n}` : `${n}`.replace('-', '−'));
  if (c.rp) out.push(`${f(c.rp)} RP`);
  if (c.hype) out.push(`Hype ${f(c.hype)}`);
  if (c.rel) out.push(`Trust ${f(c.rel)}`);
  if (c.rep) out.push(`Rep ${f(c.rep)}`);
  if (c.attr) out.push(`${ATTRS.find((a) => a.id === c.attr![0])!.name} ${f(c.attr[1])}`);
  return out.join(' · ');
}

/** contract talks: salary, length and status against the team's interest and patience */
function openTalks(m: Msg, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  const o = m.offer!;
  const ask: Ask = { salary: o.salary, years: o.until - d.year, status: o.status };
  const back = el('div', 'ch-talks', document.body);
  const close = () => {
    back.classList.remove('on');
    setTimeout(() => back.remove(), 250);
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => back.classList.add('on'));
  const box = el('div', 'ch-talks-in glass', back);
  box.style.setProperty('--team', teamColor(o.series, o.team));
  let note = '';
  const draw = () => {
    const p = dc.acceptance(m.id, ask);
    const lbl = p > 0.8 ? 'Very likely' : p > 0.55 ? 'Likely' : p > 0.3 ? 'Unlikely' : 'Very unlikely';
    box.innerHTML =
      `<div class="cap">Contract talks · ${SERIES_NAME[o.series]}</div><div class="big">${esc(o.teamName)}</div>` +
      `<div class="sub">Their offer: ${statusLabel(o.status).toLowerCase()}, to ${o.until}, $${o.salary.toFixed(1)}M a season.</div>` +
      `<div class="tk-rows"></div>` +
      `<div class="tk-odds"><span>${lbl} to accept</span><div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div></div>` +
      `<div class="tk-pat">Patience ${'<i class="on"></i>'.repeat(o.patience)}${'<i></i>'.repeat(Math.max(0, 3 - o.patience))}</div>` +
      (note ? `<div class="tk-note">${esc(note)}</div>` : '') +
      `<div class="tk-act"></div>`;
    const rows = box.querySelector('.tk-rows') as HTMLElement;
    const stepper = (label: string, value: string, dec: () => void, inc: () => void) => {
      const r = el('div', 'tk-row', rows, `<span>${label}</span>`);
      const minus = el('button', 'tk-b', r, '−');
      el('b', '', r, value);
      const plus = el('button', 'tk-b', r, '+');
      minus.addEventListener('click', () => (dec(), draw()));
      plus.addEventListener('click', () => (inc(), draw()));
    };
    // (steps that suit the deal: a junior's wage moves in $0.1M, a star's in $0.5M)
    const step = o.salary < 2 ? 0.1 : o.salary < 6 ? 0.2 : 0.5;
    stepper('Salary', `$${ask.salary.toFixed(1)}M`, () => (ask.salary = Math.max(0.1, +(ask.salary - step).toFixed(1))), () => (ask.salary = +(ask.salary + step).toFixed(1)));
    stepper('Length', `${ask.years} year${ask.years > 1 ? 's' : ''}`, () => (ask.years = Math.max(1, ask.years - 1)), () => (ask.years = Math.min(3, ask.years + 1)));
    const sr = el('div', 'tk-row', rows, '<span>Status</span>');
    const chips = el('div', 'tk-chips', sr);
    for (const st of ['second', 'equal', 'lead'] as Status[]) {
      const b = el('button', st === ask.status ? 'on' : '', chips, statusLabel(st));
      b.addEventListener('click', () => ((ask.status = st), draw()));
    }
    const act = box.querySelector('.tk-act') as HTMLElement;
    const prop = el('button', 'cta', act, 'Propose');
    const cancel = el('button', 'cta ghost', act, 'Back');
    cancel.addEventListener('click', close);
    prop.addEventListener('click', () => {
      const r = dc.propose(m.id, ask);
      if (r === 'refused') {
        note = 'They turned that down. Adjust the terms, or take the offer as it is.';
        draw();
        return;
      }
      close();
      ctx.changed();
    });
  };
  draw();
}

/** the season is over and the contract has run out: pick next year's team */
function renderChoose(p: HTMLElement, ctx: HubCtx) {
  const d = ctx.dc.data!;
  const box = el('div', 'ch-choose', p);
  el('div', 'ch-choose-h', box, `<div class="cap">${d.year + 1} season</div><div class="big">Choose your team</div><div class="sub">Your contract has ended. These teams want you: sign, or negotiate the terms.</div>`);
  const offers = d.inbox.filter((m) => m.kind === 'offer' && m.picked === undefined && m.offer);
  const row = el('div', 'ch-offers', box);
  for (const m of offers) {
    const o = m.offer!;
    const col = teamColor(o.series, o.team);
    const lvl = levelOf(o.series, o.team, d.teamDev);
    const card = el('div', 'ch-offer', row);
    card.style.setProperty('--team', col);
    card.innerHTML =
      `<div class="cap">${SERIES_NAME[o.series]}</div><div class="nm">${esc(o.teamName)}</div>` +
      `<div class="lv">${o.series === 'f1' ? levelLabel(lvl) : 'Formula 2'}</div>` +
      `<div class="terms"><span>${statusLabel(o.status)}</span><span>to ${o.until}</span><span>$${o.salary.toFixed(1)}M</span></div>`;
    const sign = el('div', 'cta', card, 'Sign');
    ctx.action(sign, () => {
      ctx.dc.choose(m.id, 0);
      ctx.changed();
    });
    const neg = el('div', 'cta ghost', card, 'Negotiate');
    ctx.action(neg, () => openTalks(m, ctx));
  }
}

/** what the last round did to the career: on the results screen */
export function renderRoundSummary(box: HTMLElement, s: RoundSummary) {
  const w = el('div', 'rc', box);
  const objs = s.objectives.map((o) => `<div class="rc-o${o.done ? ' done' : ''}"><i></i><span>${esc(o.label)}</span><b>${o.done ? `+${o.rp}` : '—'}</b></div>`).join('');
  el('div', 'rc-col', w, `<div class="cap">Team targets</div>${objs}`);
  const up = s.ovr[1] - s.ovr[0];
  const attrs = (Object.entries(s.attrs) as [AttrId, number][])
    .filter(([, v]) => Math.abs(v) >= 0.3)
    .map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${ATTRS.find((a) => a.id === k)!.name} ${v > 0 ? '+' : ''}${v}</span>`)
    .join('');
  el(
    'div',
    'rc-col',
    w,
    `<div class="cap">Career</div>` +
      `<div class="rc-stat"><span>Overall rating</span><b>${s.ovr[1]}${up ? ` <em class="${up > 0 ? 'up' : 'down'}">${up > 0 ? '▲' : '▼'}${Math.abs(up)}</em>` : ''}</b></div>` +
      `<div class="rc-stat"><span>Research points</span><b>+${s.rp} RP</b></div>` +
      `<div class="rc-stat"><span>Championship</span><b>P${s.champ.pos} · ${s.champ.points} pts</b></div>` +
      (s.rival ? `<div class="rc-stat"><span>vs ${esc(s.rival.name)}</span><b>${s.rival.me}–${s.rival.them}</b></div>` : '') +
      (attrs ? `<div class="rc-attrs">${attrs}</div>` : '') +
      (s.trophies.length ? `<div class="rc-tro">${s.trophies.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''),
  );
}

/** the car-development tab in a driver career: the team's research points into the car */
export function renderRd(p: HTMLElement, ctx: { dc: DriverCareer; action(e: HTMLElement, fn: () => void, disabled?: boolean): void; changed(): void }) {
  const dc = ctx.dc;
  const d = dc.data!;
  el('div', 'hp-cap', p, `Car development · ${esc(teamName(d.series, d.contract.team))}`);
  el('div', 'devbar', p, `<div class="lbl"><span>Research points</span><b>${d.rp} RP</b></div>`);
  for (const u of RD) {
    const n = dc.rdLevel(u.id);
    const max = n >= RD_MAX;
    const cost = rdCost(n);
    const can = dc.canUpgrade(u.id);
    const row = el('div', 'uprow' + (max ? ' max' : !can ? ' poor' : ''), p);
    const pips = Array.from({ length: RD_MAX }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
    row.innerHTML = `<div class="ul"><div class="un">${u.name}</div><div class="us">${max ? 'Fully developed' : `Next: ${u.step}`}</div></div><div class="pips">${pips}</div><div class="ubtn">${max ? 'Max' : `${cost} RP`}</div>`;
    ctx.action(row, () => {
      if (dc.upgrade(u.id)) ctx.changed();
    }, max || !can);
  }
  el('div', 'hp-note', p, `The team earns research points every round (more for hitting its targets and scoring). Parts make your car faster and your teammate's too; every other team is developing as well. Half the parts carry into next season with the same team; a new team starts from its own car.`);
}

// ------------------------------------------------------------------ the new-career wizard

const SKINS = [0xf4dccb, 0xf0cdb0, 0xe2b48f, 0xc99772, 0x9c6b4a, 0x6b4430];
const HAIRS = [0x16110e, 0x3a2a1e, 0x6b4c30, 0xa88452, 0xd9c08a, 0xb2552e];
const STYLES: [DriverLook['style'], string][] = [['short', 'Short'], ['buzz', 'Buzz'], ['wavy', 'Wavy'], ['curly', 'Curly'], ['long', 'Long'], ['braids', 'Braids']];
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export interface WizardCtx {
  onDone(driver: PlayerDriver, contract: Contract): void;
  onCancel(): void;
  onUi(kind: 'move' | 'select' | 'back'): void;
}

/** full-screen: how the career begins */
export function openWizard(host: HTMLElement, ctx: WizardCtx): () => void {
  const root = el('div', 'cw', host);
  const year = new Date().getFullYear();
  const close = () => {
    root.classList.remove('on');
    setTimeout(() => root.remove(), 350);
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    // the wizard has text fields: keep keys away from the game
    e.stopPropagation();
    if (e.key === 'Escape') {
      ctx.onUi('back');
      close();
      ctx.onCancel();
    }
  };
  window.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => root.classList.add('on'));

  const step = (html: string) => {
    root.innerHTML = `<div class="cw-in">${html}</div>`;
    const back = el('button', 'cw-x', root.firstElementChild as HTMLElement, 'Esc');
    back.addEventListener('click', () => {
      close();
      ctx.onCancel();
    });
    return root.firstElementChild as HTMLElement;
  };

  // ---- 1: how it begins
  const begin = () => {
    const s = step(`<div class="cap">Driver career</div><h1>Your journey to Formula 1</h1><p class="lede">Every round counts, every answer to the press is remembered, and the teams are watching.</p>`);
    const row = el('div', 'cw-paths', s);
    const a = el('button', 'cw-path', row, `<b>Create a driver</b><span>Start in Formula 2 with a junior team. Win, build a reputation, and earn an F1 seat.</span><em>Recommended</em>`);
    const b = el('button', 'cw-path', row, `<b>Race as a current driver</b><span>Take over one of the 22 F1 drivers, in their car, and decide where their career goes next.</span>`);
    a.addEventListener('click', () => (ctx.onUi('select'), create()));
    b.addEventListener('click', () => (ctx.onUi('select'), pickExisting()));
  };

  // ---- 2a: create a driver
  const draft: PlayerDriver = { first: '', last: '', code: '', number: 27, nationality: 'GBR', helmet: ['#ff2b3f', '#ffffff'], look: { skin: SKINS[1], hair: HAIRS[1], style: 'short' } };
  const create = () => {
    const s = step(`<div class="cap">Create a driver</div><h1>Who are you?</h1>`);
    const wrap = el('div', 'cw-create', s);
    const form = el('div', 'cw-form', wrap);
    const prev = el('div', 'cw-prev', wrap);
    const field = (label: string) => {
      const f = el('label', 'cw-field', form);
      el('span', '', f, label);
      return f;
    };
    const first = el('input', 'cw-input', field('First name'));
    first.maxLength = 14;
    first.value = draft.first;
    first.placeholder = 'First name';
    const last = el('input', 'cw-input', field('Last name'));
    last.maxLength = 16;
    last.value = draft.last;
    last.placeholder = 'Last name';
    const nat = el('select', 'cw-input', field('Nationality'));
    for (const [c, n] of NATIONS) el('option', '', nat, `${n}`).value = c;
    nat.value = draft.nationality;
    const taken = new Set(TEAMS.flatMap((t) => t.drivers.map((d) => d.number)));
    const num = el('input', 'cw-input', field('Race number'));
    num.type = 'number';
    num.min = '2';
    num.max = '99';
    num.value = String(draft.number);
    const swatch = (label: string, colors: string[], get: () => string, set: (c: string) => void) => {
      const f = field(label);
      const row = el('div', 'cw-sw', f);
      const draw = () => {
        row.innerHTML = '';
        for (const c of colors) {
          const b = el('i', c.toLowerCase() === get().toLowerCase() ? 'on' : '', row);
          b.style.background = c;
          b.addEventListener('click', () => {
            set(c);
            draw();
            update();
          });
        }
      };
      draw();
    };
    swatch('Helmet', PALETTE, () => draft.helmet[0], (c) => (draft.helmet[0] = c));
    swatch('Helmet detail', PALETTE, () => draft.helmet[1], (c) => (draft.helmet[1] = c));
    swatch('Skin tone', SKINS.map(hex), () => hex(draft.look.skin), (c) => (draft.look.skin = parseInt(c.slice(1), 16)));
    swatch('Hair', HAIRS.map(hex), () => hex(draft.look.hair), (c) => (draft.look.hair = parseInt(c.slice(1), 16)));
    const sf = field('Hair style');
    const sr = el('div', 'cw-chips', sf);
    const drawStyles = () => {
      sr.innerHTML = '';
      for (const [id, label] of STYLES) {
        const b = el('button', id === draft.look.style ? 'on' : '', sr, label);
        b.addEventListener('click', () => {
          draft.look.style = id;
          drawStyles();
        });
      }
    };
    drawStyles();
    const go = el('button', 'cta cw-next', s, 'Find a team');
    const update = () => {
      draft.first = first.value.trim();
      draft.last = last.value.trim();
      draft.nationality = nat.value;
      const n = Math.round(Number(num.value));
      draft.number = n >= 2 && n <= 99 ? n : draft.number;
      draft.code = (draft.last || 'NEW').normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
      const clash = taken.has(draft.number);
      prev.innerHTML =
        `<div class="cw-helmet" style="--h1:${draft.helmet[0]};--h2:${draft.helmet[1]}"><span>${draft.number}</span></div>` +
        `<div class="cw-pname">${esc(draft.first || 'First')} <b>${esc((draft.last || 'Last').toUpperCase())}</b></div>` +
        `<div class="cw-pmeta">${esc(NATIONS.find((x) => x[0] === draft.nationality)?.[1] ?? '')} · ${draft.code}</div>` +
        (clash ? `<div class="cw-warn">#${draft.number} is taken on the F1 grid. You can keep it in F2; pick another for later.</div>` : '');
      go.classList.toggle('dis', !draft.first || !draft.last);
    };
    for (const i of [first, last, nat, num]) i.addEventListener('input', update);
    update();
    first.focus();
    go.addEventListener('click', () => {
      if (!draft.first || !draft.last) return ctx.onUi('back');
      ctx.onUi('select');
      offersF2();
    });
  };

  // ---- 3a: first offers (Formula 2)
  const offersF2 = () => {
    const s = step(`<div class="cap">${year} Formula 2</div><h1>Three teams want you</h1><p class="lede">Formula 2 cars are all built the same. The team still matters: their engineers, their strategy, their trust in you.</p>`);
    const teams = f2Teams();
    const opts = [teams[1 + Math.floor(Math.random() * 3)], teams[4 + Math.floor(Math.random() * 3)], teams[7 + Math.floor(Math.random() * 4)]];
    const row = el('div', 'cw-offers', s);
    opts.forEach((t, i) => {
      const status = i === 2 ? 'lead' : 'equal';
      const card = el('button', 'cw-offer', row);
      card.style.setProperty('--team', t.primary === '#101010' || t.primary === '#1b1d22' || t.primary === '#0b1e3f' ? t.secondary : t.primary);
      card.innerHTML = `<div class="nm">${esc(t.name)}</div><div class="lv">${['Front of the grid last year', 'Midfield last year', 'Rebuilding'][i]}</div><div class="terms"><span>${statusLabel(status)}</span><span>1 season</span></div>`;
      card.addEventListener('click', () => {
        ctx.onUi('select');
        close();
        ctx.onDone({ ...draft, helmet: [draft.helmet[0], draft.helmet[1]], look: { ...draft.look } }, { series: 'f2', team: t.id, seat: 1, until: year, salary: 0.2, status });
      });
    });
  };

  // ---- 2b: a current driver
  const pickExisting = () => {
    const s = step(`<div class="cap">Formula 1 · ${year}</div><h1>Pick your driver</h1>`);
    const grid = el('div', 'cw-grid', s);
    TEAMS.forEach((_t, ti) => {
      const o = f1Original(ti);
      const col = el('div', 'cw-team', grid);
      col.style.setProperty('--team', teamColor('f1', o.team.id));
      el('div', 'tn', col, esc(o.team.name));
      ([0, 1] as const).forEach((seat) => {
        const dr = o.drivers[seat];
        const b = el('button', 'cw-driver', col, `<span class="no">${dr.number}</span><span class="nm">${esc(dr.first)} <b>${esc(dr.last.toUpperCase())}</b></span>`);
        b.addEventListener('click', () => {
          ctx.onUi('select');
          close();
          const nat = 'GBR';
          ctx.onDone(
            { first: dr.first, last: dr.last, code: dr.code, number: dr.number, nationality: nat, helmet: [dr.helmet[0], dr.helmet[1]], look: { ...dr.look }, from: dr.code },
            { series: 'f1', team: o.team.id, seat, until: year + 1, salary: +(2 + 14 * levelOf('f1', o.team.id) * dr.skill).toFixed(1), status: seat === 0 ? 'lead' : 'equal' },
          );
        });
      });
    });
  };

  begin();
  return close;
}
