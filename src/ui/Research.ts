import { MAX_LEVEL, UPGRADES, upgradeCost, type Career, type UpgradeId } from '../career/Career.ts';

/**
 * Research: the R&D centre. The car as a blueprint in the middle (each department's parts light up
 * as they're developed), the five departments down the left with the car's performance profile
 * under them, the picked department's five tiers on the right with what the next one is worth and
 * the button that researches it — a short run of the lab (the part scanned on the blueprint, a
 * progress count) before the tier lights up.
 *
 * Rendered into the garage's wide hub panel.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export interface ResearchCtx {
  career: Career;
  /** register a clickable for the menu's keyboard/gamepad navigation */
  action(e: HTMLElement, fn: () => void, disabled?: boolean): void;
  fmtCr(n: number): string;
  /** a tier was researched: the car is rebuilt, the credits and the tab redrawn */
  researched(): void;
  sound(kind: 'move' | 'select' | 'back'): void;
}

interface Dept {
  /** per tier, in the stat's own terms */
  per: number;
  unit: string;
  /** rough lap time per tier on an average circuit (for the card; an estimate) */
  lap: number;
  blurb: string;
  tiers: [string, string][];
  icon: string;
}

const DEPTS: Record<UpgradeId, Dept> = {
  engine: {
    per: 1.5,
    unit: '% power',
    lap: 0.09,
    blurb: 'More from the V6 hybrid: a higher top speed and harder drives out of slow corners.',
    tiers: [
      ['Combustion chamber', 'Faster burn, more torque low down'],
      ['Turbo compressor', 'Less lag on the throttle'],
      ['Exhaust tuning', 'Freer breathing at the top end'],
      ['Fuel injection', 'Higher pressure, a cleaner burn'],
      ['Qualifying map', 'Everything turned up, all race'],
    ],
    icon: '<path d="M3 6h7l2 2h2v5h-2l-2 2H5l-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 3h4M8 3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  },
  aero: {
    per: 2.5,
    unit: '% downforce',
    lap: 0.11,
    blurb: 'More downforce from the wings and the floor: faster through every quick corner.',
    tiers: [
      ['Front wing cascade', 'Cleaner air down the car'],
      ['Floor edge', 'A tighter seal under the car'],
      ['Diffuser kick', 'More suction at the back'],
      ['Rear wing profile', 'Load without the drag'],
      ['Beam wing', 'The diffuser and the wing working together'],
    ],
    icon: '<path d="M1.5 10.5C5 6 11 5.5 14.5 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2 13.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>',
  },
  chassis: {
    per: 1,
    unit: '% grip',
    lap: 0.1,
    blurb: 'Sharper suspension: more mechanical grip in slow corners and over the kerbs.',
    tiers: [
      ['Push-rod geometry', 'More camber where it counts'],
      ['Anti-dive', 'A flat car on the brakes'],
      ['Heave springs', 'Steady ride height at speed'],
      ['Dampers', 'Rides the kerbs without bouncing'],
      ['Ride-height control', 'The floor exactly where it works best'],
    ],
    icon: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/><path d="M8 2.5v3.7M8 9.8v3.7M2.5 8h3.7M9.8 8h3.7" stroke="currentColor" stroke-width="1.2"/>',
  },
  brakes: {
    per: 4,
    unit: '% stopping power',
    lap: 0.04,
    blurb: 'More stopping power: brake later into every corner and stay stable doing it.',
    tiers: [
      ['Disc cooling', 'More vent holes, no fade'],
      ['Caliper stiffness', 'A firmer pedal'],
      ['Pad compound', 'Bite from the first lap'],
      ['Brake-by-wire', 'The rear axle balanced to the corner'],
      ['Carbon discs', 'The lightest, strongest stop'],
    ],
    icon: '<circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11.5 3.2l2.2 2.6-1.6 1.2" fill="currentColor"/>',
  },
  ers: {
    per: 8,
    unit: '% deployment',
    lap: 0.05,
    blurb: 'More electrical energy per lap: longer boosts down the straights and out of the corners.',
    tiers: [
      ['Battery cells', 'More energy in the same weight'],
      ['MGU-K motor', 'More harvest under braking'],
      ['Harvest map', 'Recovers on every lift'],
      ['Deployment software', 'The boost where it gains most'],
      ['Overtake mode', 'One more push when you need it'],
    ],
    icon: '<path d="M9.2 1.5L3.5 9h4l-1 5.5L12.5 7h-4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  },
};

/**
 * The blueprint: the car from above, nose up. Each department's parts in its own group (the base
 * structure is dim line work), and a labelled callout per department out to the side.
 */
const BLUEPRINT_BASE =
  // floor outline, monocoque, nose, cockpit, halo
  `<path class="bp-ghost" d="M58 170 L182 170 L190 382 L176 424 L64 424 L50 382 Z"/>` +
  `<path d="M112 38 Q120 22 128 38 L134 150 L106 150 Z"/>` +
  `<path d="M106 150 L134 150 L140 270 L100 270 Z"/>` +
  `<ellipse cx="120" cy="226" rx="13" ry="26"/>` +
  `<path d="M106 240 L104 206 Q120 186 136 206 L134 240 M120 192 V180"/>` +
  `<path class="bp-ghost" d="M120 30 V500" stroke-dasharray="2 4"/>`;

const PARTS: Record<UpgradeId, { d: string; label: [number, number, number, number, 'start' | 'end'] }> = {
  aero: {
    d:
      `<path d="M30 54 L40 34 L200 34 L210 54 L196 62 L44 62 Z"/><path d="M42 44 H198 M46 52 H194"/>` +
      `<path d="M58 175 L50 382 L64 424 M182 175 L190 382 L176 424"/>` +
      `<path d="M80 430 L160 430 L168 462 L72 462 Z"/><path d="M96 432 V460 M112 432 V460 M128 432 V460 M144 432 V460"/>` +
      `<path d="M56 470 L184 470 L184 494 L56 494 Z"/><path d="M56 462 V502 M184 462 V502 M60 482 H180"/>`,
    label: [210, 40, 262, 26, 'start'],
  },
  chassis: {
    d:
      `<rect x="30" y="84" width="36" height="70" rx="6"/><rect x="174" y="84" width="36" height="70" rx="6"/>` +
      `<rect x="24" y="380" width="42" height="76" rx="7"/><rect x="174" y="380" width="42" height="76" rx="7"/>` +
      `<path d="M66 104 L106 112 M66 134 L106 128 M66 120 L106 140 M174 104 L134 112 M174 134 L134 128 M174 120 L134 140"/>` +
      `<path d="M66 398 L102 390 M66 434 L108 438 M66 416 L104 414 M174 398 L138 390 M174 434 L132 438 M174 416 L136 414"/>`,
    label: [210, 140, 262, 166, 'start'],
  },
  brakes: {
    d:
      `<circle cx="48" cy="119" r="12"/><circle cx="192" cy="119" r="12"/><circle cx="45" cy="418" r="13"/><circle cx="195" cy="418" r="13"/>` +
      `<circle cx="48" cy="119" r="4.5"/><circle cx="192" cy="119" r="4.5"/><circle cx="45" cy="418" r="5"/><circle cx="195" cy="418" r="5"/>`,
    label: [30, 119, -22, 100, 'end'],
  },
  ers: {
    d:
      `<path d="M100 200 L74 208 Q62 214 62 240 L70 330 Q76 350 100 360 Z"/><path d="M140 200 L166 208 Q178 214 178 240 L170 330 Q164 350 140 360 Z"/>` +
      `<path d="M66 222 H98 M174 222 H142"/>` +
      `<rect x="106" y="276" width="28" height="38" rx="3"/><path d="M122 282 L114 296 H122 L118 308 L127 292 H120 Z"/>`,
    label: [64, 270, -22, 280, 'end'],
  },
  engine: {
    d:
      `<path d="M100 270 L140 270 L138 360 L128 422 L112 422 L102 360 Z"/><circle cx="120" cy="262" r="7"/>` +
      `<rect x="108" y="322" width="24" height="46" rx="3"/><path d="M114 326 V364 M120 326 V364 M126 326 V364"/>`,
    label: [138, 344, 262, 360, 'start'],
  },
};

const AXIS: Record<UpgradeId, string> = { engine: 'POWER', aero: 'AERO', chassis: 'GRIP', brakes: 'BRAKES', ers: 'ERS' };
const LABEL: Record<UpgradeId, string> = { aero: 'Aerodynamics', chassis: 'Suspension', brakes: 'Brakes', ers: 'Energy recovery', engine: 'Power unit' };

/** a department's gain at n tiers, as the cards print it ("+4.5", "+0") */
const pctOf = (d: Dept, n: number) => (n === 0 ? '0' : d.per % 1 ? (d.per * n).toFixed(1) : String(d.per * n));

/** the department picked (kept while the garage is open) */
let pick: UpgradeId = 'engine';
/** the tier researched a moment ago (lit with a burst on the redraw) */
let fresh: { id: UpgradeId; n: number } | null = null;

export function renderResearch(p: HTMLElement, ctx: ResearchCtx) {
  const c = ctx.career;
  p.classList.add('rnd-lab');
  const lv = (id: UpgradeId) => c.level(id);
  const total = UPGRADES.reduce((a, u) => a + lv(u.id), 0);
  const all = UPGRADES.length * MAX_LEVEL;
  const just = fresh;
  fresh = null;

  // ---------------------------------------------------------------- left: the lab, the departments, the profile
  const left = el('div', 'rl-left', p);
  const pct = Math.round((total / all) * 100);
  const R = 30;
  const C = 2 * Math.PI * R;
  el(
    'div',
    'rl-head',
    left,
    `<div class="eyebrow">Car development</div><div class="rl-title">R&amp;D <span>Centre</span></div>` +
      `<div class="rl-overall"><svg class="ring" viewBox="0 0 72 72"><circle class="bg" cx="36" cy="36" r="${R}"/><circle class="fg" cx="36" cy="36" r="${R}" stroke-dasharray="${((C * total) / all).toFixed(1)} ${C.toFixed(1)}"/></svg>` +
      `<div class="ro-n"><b>${pct}<small>%</small></b><span>Developed</span></div>` +
      `<div class="ro-n"><b>${total}<small>/${all}</small></b><span>Tiers</span></div></div>`,
  );
  const list = el('div', 'rl-depts', left);
  const cards = new Map<UpgradeId, HTMLElement>();
  for (const u of UPGRADES) {
    const d = DEPTS[u.id];
    const n = lv(u.id);
    const max = n >= MAX_LEVEL;
    const afford = c.data.credits >= upgradeCost(n);
    const card = el('div', 'rl-dept' + (max ? ' max' : afford ? ' ready' : ''), list);
    card.dataset.id = u.id;
    const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < n ? 'on' : ''}${just?.id === u.id && k === n - 1 ? ' burst' : ''}"></i>`).join('');
    card.innerHTML =
      `<span class="ic"><svg viewBox="0 0 16 16" width="18" height="18">${d.icon}</svg></span>` +
      `<div class="dn"><b>${u.name}</b><span class="pips">${pips}</span></div>` +
      `<div class="dv"><b>+${pctOf(d, n)}%</b><span>${u.stat}</span></div>`;
    cards.set(u.id, card);
    ctx.action(card, () => choose(u.id));
    card.addEventListener('mouseenter', () => hover(u.id));
    card.addEventListener('mouseleave', () => hover(null));
  }

  // ---------------------------------------------------------------- centre: the blueprint and the profile radar
  const stage = el('div', 'rl-stage', p);
  const groups = UPGRADES.map((u) => {
    const P = PARTS[u.id];
    const [x1, y1, x2, y2, anchor] = P.label;
    const n = lv(u.id);
    return (
      `<g class="bp-part" data-id="${u.id}" style="--lv:${(n / MAX_LEVEL).toFixed(2)}">${P.d}` +
      `<g class="bp-call"><path d="M${x1} ${y1} L${x2 + (anchor === 'start' ? -6 : 6)} ${y2} H${x2}"/>` +
      `<text x="${x2 + (anchor === 'start' ? 4 : -4)}" y="${y2 + 3.5}" text-anchor="${anchor}">${LABEL[u.id].toUpperCase()}</text>` +
      `<text class="lvt" x="${x2 + (anchor === 'start' ? 4 : -4)}" y="${y2 + 15}" text-anchor="${anchor}">TIER ${n}/${MAX_LEVEL}</text></g></g>`
    );
  }).join('');
  stage.innerHTML =
    `<div class="bp-grid"></div>` +
    `<svg class="bp" viewBox="-110 0 460 520" preserveAspectRatio="xMidYMid meet"><g class="bp-base">${BLUEPRINT_BASE}</g>${groups}</svg>` +
    `<div class="bp-scan"></div>` +
    `<div class="bp-tag"><span>Chassis</span><b>AGP-26</b><em>Plan view · 1:20</em></div>`;
  // the profile: five axes, the car as it is (filled) and with the picked department's next tier (dashed)
  const radar = el('div', 'rl-radar', left);
  const ax = UPGRADES.map((u, i) => {
    const a = -Math.PI / 2 + (i / UPGRADES.length) * Math.PI * 2;
    return { u, x: Math.cos(a), y: Math.sin(a) };
  });
  const rr = (n: number) => 14 + (46 * n) / MAX_LEVEL;
  const poly = (f: (id: UpgradeId) => number) => ax.map(({ u, x, y }) => `${(x * rr(f(u.id))).toFixed(1)},${(y * rr(f(u.id))).toFixed(1)}`).join(' ');
  const drawRadar = () => {
    const nx = (id: UpgradeId) => Math.min(MAX_LEVEL, lv(id) + (id === pick ? 1 : 0));
    radar.innerHTML =
      `<div class="rr-cap">Performance profile</div>` +
      `<svg viewBox="-112 -82 224 160">` +
      [1, 2, 3, 4, 5].map((k) => `<polygon class="ring" points="${poly(() => k)}"/>`).join('') +
      ax.map(({ x, y }) => `<line class="ax" x1="0" y1="0" x2="${(x * 60).toFixed(1)}" y2="${(y * 60).toFixed(1)}"/>`).join('') +
      `<polygon class="next" points="${poly(nx)}"/><polygon class="now" points="${poly(lv)}"/>` +
      ax.map(({ u, x, y }) => `<circle class="pt${u.id === pick ? ' on' : ''}" cx="${(x * rr(lv(u.id))).toFixed(1)}" cy="${(y * rr(lv(u.id))).toFixed(1)}" r="2.6"/>`).join('') +
      ax.map(({ u, x, y }) => `<text class="${u.id === pick ? 'on' : ''}" x="${(x * 72).toFixed(1)}" y="${(y * 72 + 3).toFixed(1)}" text-anchor="${Math.abs(x) < 0.2 ? 'middle' : x > 0 ? 'start' : 'end'}">${AXIS[u.id]}</text>`).join('') +
      `</svg>`;
  };

  // ---------------------------------------------------------------- right: the picked department
  const side = el('div', 'rl-side', p);
  const det = el('div', 'rl-det', side);
  const buy = el('div', 'cta rl-go', side);
  const note = el('div', 'rl-note', side);
  let busy = false;

  const parts = Array.from(stage.querySelectorAll<SVGGElement>('.bp-part'));
  const hover = (id: UpgradeId | null) => {
    for (const g of parts) g.classList.toggle('hov', g.dataset.id === id && id !== pick);
  };
  const draw = () => {
    const u = UPGRADES.find((x) => x.id === pick)!;
    const d = DEPTS[pick];
    const n = lv(pick);
    const max = n >= MAX_LEVEL;
    const cost = upgradeCost(n);
    const afford = c.data.credits >= cost;
    for (const [id, card] of cards) card.classList.toggle('on', id === pick);
    for (const g of parts) g.classList.toggle('on', g.dataset.id === pick);
    stage.dataset.pick = pick;
    const now = pctOf(d, n);
    const nxt = pctOf(d, Math.min(MAX_LEVEL, n + 1));
    det.innerHTML =
      `<div class="rd-top"><span class="ic"><svg viewBox="0 0 16 16" width="22" height="22">${d.icon}</svg></span><div><div class="eyebrow">Department · ${String(UPGRADES.indexOf(u) + 1).padStart(2, '0')}</div><div class="rd-name">${u.name}</div></div></div>` +
      `<div class="rd-blurb">${d.blurb}</div>` +
      `<div class="rd-stat"><div class="cur"><span>${u.stat} now</span><b>+${now}<small>%</small></b></div>` +
      (max
        ? `<div class="nx max"><span>Fully developed</span><b>Tier ${MAX_LEVEL}</b></div>`
        : `<svg class="arr" viewBox="0 0 24 12" width="24" height="12"><path d="M1 6h20M16 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><div class="nx"><span>Next tier</span><b>+${nxt}<small>%</small></b></div>`) +
      `</div>` +
      (max ? '' : `<div class="rd-gain"><span>Est. lap time</span><b>−${d.lap.toFixed(2)} s</b><em>a lap, on an average circuit</em></div>`) +
      `<div class="rd-tiers">${d.tiers
        .map(([name, what], k) => {
          const st = k < n ? 'done' : k === n ? 'next' : 'todo';
          return `<div class="tier ${st}${just?.id === pick && k === n - 1 ? ' burst' : ''}"><i class="node">${k < n ? '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : `<span>${k + 1}</span>`}</i><div class="tt"><b>${name}</b><span>${what}</span></div><em>${st === 'done' ? 'Done' : st === 'next' ? ctx.fmtCr(upgradeCost(k)) : ''}</em></div>`;
        })
        .join('')}</div>`;
    buy.className = 'cta rl-go' + (max || !afford ? ' dis' : '');
    buy.innerHTML = max ? 'Fully developed' : `<span class="lbl">Research tier ${n + 1}</span><span class="cost">${ctx.fmtCr(cost)}</span><i class="bar"></i>`;
    note.innerHTML = max
      ? 'Every tier of this department is on the car.'
      : afford
        ? `${ctx.fmtCr(c.data.credits - cost)} left after this. Upgrades apply to your car only.`
        : `<b>${ctx.fmtCr(cost - c.data.credits)}</b> more needed. Points pay credits: a win pays ${ctx.fmtCr(75000)}.`;
    drawRadar();
  };
  const choose = (id: UpgradeId) => {
    if (busy) return;
    if (pick !== id) ctx.sound('move');
    pick = id;
    hover(null);
    draw();
  };
  for (const g of parts) {
    g.addEventListener('click', () => choose(g.dataset.id as UpgradeId));
    g.addEventListener('mouseenter', () => hover(g.dataset.id as UpgradeId));
    g.addEventListener('mouseleave', () => hover(null));
  }

  // research: the lab runs for a moment (the part scanned on the blueprint, the count up), then the tier lights
  const research = () => {
    if (busy) return;
    if (!c.canBuy(pick)) return ctx.sound('back');
    busy = true;
    const id = pick;
    p.classList.add('busy');
    stage.classList.add('scanning');
    buy.classList.add('running');
    const lbl = buy.querySelector<HTMLElement>('.lbl')!;
    const bar = buy.querySelector<HTMLElement>('.bar')!;
    const t0 = performance.now();
    const DUR = 1300;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / DUR);
      const e = 1 - (1 - k) ** 2.2;
      bar.style.transform = `scaleX(${e.toFixed(3)})`;
      lbl.textContent = k < 1 ? `Researching… ${Math.round(e * 100)}%` : 'Done';
      if (k < 1) return void requestAnimationFrame(tick);
      if (c.buy(id)) fresh = { id, n: lv(id) };
      busy = false;
      ctx.researched();
    };
    requestAnimationFrame(tick);
  };
  ctx.action(buy, research);
  draw();
  return { cards };
}
