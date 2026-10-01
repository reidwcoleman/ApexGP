import { CIRCUITS } from '../world/Circuits.ts';
import { TEAMS, type DriverLook } from '../race/Teams.ts';
import { DriverCareer, NATIONS, SERIES_NAME, levelLabel, levelOf, statusLabel, teamColor, teamName, type Contract, type Msg } from '../career/DriverCareer.ts';
import { f1Original, f2Teams, type PlayerDriver } from '../career/Series.ts';
import { PALETTE } from '../career/Career.ts';
import { artFor } from './loadingArt.ts';

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
  forecast(track: string): string;
  circuitPath(points: number[]): string;
}

/** the career hub, in the garage's wide panel */
export function renderHub(p: HTMLElement, ctx: HubCtx) {
  const dc = ctx.dc;
  const d = dc.data!;
  const me = d.driver;
  const { pos, points } = dc.position();
  const tn = teamName(d.series, d.contract.team);
  const tc = teamColor(d.series, d.contract.team);
  p.classList.add('ch');
  p.style.setProperty('--team', tc);

  // ---- who you are
  const head = el('div', 'ch-head', p);
  head.innerHTML =
    `<div class="ch-id"><div class="ch-num" style="--h1:${me.helmet[0]};--h2:${me.helmet[1]}">${me.number}</div>` +
    `<div><div class="cap">${SERIES_NAME[d.series]} · ${d.year} · ${esc(me.nationality)}</div><div class="ch-name">${esc(me.first)} <b>${esc(me.last.toUpperCase())}</b></div><div class="ch-team"><i></i>${esc(tn)}</div></div></div>` +
    `<div class="ch-stats">` +
    `<div class="cs"><b>${pos ? `P${pos}` : '—'}</b><span>Championship</span></div>` +
    `<div class="cs"><b>${points}</b><span>Points</span></div>` +
    `<div class="cs"><b>${d.wins}</b><span>Career wins · ${d.starts} starts</span></div>` +
    `<div class="cs"><b>${d.titles}</b><span>Titles</span></div>` +
    `</div>`;

  if (d.choosing) {
    renderChoose(p, ctx);
    return;
  }
  const grid = el('div', 'ch-grid', p);
  const left = el('div', 'ch-col', grid);
  const right = el('div', 'ch-col', grid);

  // ---- the next round
  const nt = dc.nextTrack;
  const cd = nt ? CIRCUITS.find((c) => c.id === nt) : null;
  const next = el('div', 'ch-next', left);
  if (cd) {
    const ci = d.calendar.indexOf(cd.id);
    next.style.backgroundImage = `url("${artFor(cd.id)}")`;
    next.innerHTML =
      `<div class="ch-next-in"><div class="cap">Round ${ci + 1} of ${d.calendar.length}</div><div class="nm">${esc(cd.name)}</div>` +
      `<div class="facts"><span>${dc.laps} laps</span><span>${esc(ctx.forecast(cd.id))}</span></div></div>` +
      (cd.centerline ? `<svg class="ch-track" viewBox="0 0 120 84"><path d="${ctx.circuitPath(cd.centerline.points)}"/></svg>` : '');
    const go = el('div', 'cta ch-go', left, `Race round ${ci + 1}`);
    ctx.action(go, () => ctx.onRace(cd.id));
  } else {
    next.innerHTML = `<div class="ch-next-in"><div class="cap">Season over</div><div class="nm">See you next year</div></div>`;
  }
  const cal = el('div', 'cta ghost ch-cal', left, 'Season calendar');
  ctx.action(cal, () => ctx.onCalendar());

  // ---- the championship
  const tbl = el('div', 'ch-table', left);
  el('div', 'hp-cap', tbl, `${SERIES_NAME[d.series]} standings`);
  const rows = dc.table();
  if (!rows.length) el('div', 'ch-empty', tbl, 'The table fills in after the first round.');
  else {
    const mine = rows.findIndex((r) => r.code === me.code);
    const show = rows.slice(0, 6);
    if (mine >= 6) show.push(rows[mine]);
    for (const r of show) {
      const i = rows.indexOf(r);
      el('div', 'ch-row' + (r.code === me.code ? ' me' : ''), tbl, `<span class="p">${i + 1}</span><i style="background:${r.color}"></i><span class="n">${esc(r.name)}</span><span class="t">${esc(r.team)}</span><b>${r.points}</b>`);
    }
  }

  // ---- the inbox
  const inbox = el('div', 'ch-inbox', right);
  const unread = dc.unread();
  el('div', 'hp-cap', inbox, `Inbox${unread ? ` <em>${unread}</em>` : ''}`);
  const list = el('div', 'ch-msgs', inbox);
  for (const m of d.inbox.slice(0, 8)) list.appendChild(msgCard(m, ctx));

  // ---- the contract and the driver's standing
  const con = el('div', 'ch-contract', right);
  const c = d.contract;
  const meter = (label: string, v: number) => `<div class="ch-meter"><span>${label}</span><div class="bar"><i style="width:${Math.round(v)}%"></i></div><b>${Math.round(v)}</b></div>`;
  con.innerHTML =
    `<div class="hp-cap">Contract</div>` +
    `<div class="ch-deal"><span><b>${esc(tn)}</b> · ${statusLabel(c.status)}</span><span>to ${c.until} · $${c.salary.toFixed(1)}M</span></div>` +
    (d.next ? `<div class="ch-deal next"><span>Signed for ${d.year + 1}: <b>${esc(teamName(d.next.series, d.next.team))}</b></span></div>` : '') +
    meter('Reputation', d.rep) +
    meter('Fan hype', d.hype) +
    meter('Team trust', d.rel) +
    `<div class="ch-foot"><span>Earnings $${d.money.toFixed(1)}M</span><span>vs teammate ${d.h2h.race[0]}–${d.h2h.race[1]}</span></div>`;
  const nc = el('div', 'ch-new', right, 'Start a new career');
  ctx.action(nc, () => ctx.onNewCareer());
}

function msgCard(m: Msg, ctx: HubCtx): HTMLElement {
  const card = el('div', `ch-msg k-${m.kind}` + (m.read ? '' : ' unread') + (m.choices && m.picked === undefined ? ' ask' : ''));
  card.innerHTML = `<div class="mh"><span class="from">${esc(m.from)}</span><span class="r">R${m.round + 1}</span></div><div class="mt">${esc(m.title)}</div><div class="mb">${esc(m.body)}</div>`;
  if (m.choices) {
    if (m.picked === undefined) {
      const row = el('div', 'ch-choices', card);
      m.choices.forEach((c, i) => {
        const b = el('button', 'ch-choice' + (m.kind === 'offer' && i === 0 ? ' sign' : ''), row, esc(c.label));
        ctx.action(b, () => {
          ctx.dc.choose(m.id, i);
          ctx.changed();
        });
      });
    } else {
      const c = m.choices[m.picked];
      el('div', 'ch-reply', card, `<b>${esc(c.label)}</b> ${esc(c.reply)}`);
    }
  }
  card.addEventListener('mouseenter', () => ctx.dc.markRead(m.id));
  return card;
}

/** the season is over and the contract has run out: pick next year's team */
function renderChoose(p: HTMLElement, ctx: HubCtx) {
  const d = ctx.dc.data!;
  const box = el('div', 'ch-choose', p);
  el('div', 'ch-choose-h', box, `<div class="cap">${d.year + 1} season</div><div class="big">Choose your team</div><div class="sub">Your contract has ended. These teams want you.</div>`);
  const offers = d.inbox.filter((m) => m.kind === 'offer' && m.picked === undefined && m.offer);
  const row = el('div', 'ch-offers', box);
  for (const m of offers) {
    const o = m.offer!;
    const col = teamColor(o.series, o.team);
    const lvl = levelOf(o.series, o.team);
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
  }
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
