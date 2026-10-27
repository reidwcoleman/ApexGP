import { ALL_CIRCUITS, CIRCUITS, SCENIC, isScenic } from '../world/Circuits.ts';
import type { CircuitDef } from '../world/CircuitGen.ts';
import { RANKS, SCENIC_STARS, START_OPEN, STARS, TOUR_LAPS, UNLOCK_POS, medalFor, type Career, type Medal } from '../career/Career.ts';
import { GEO, PIN_OFFSET } from '../career/Season.ts';
import { WORLD_BORDERS, WORLD_GRATICULE, WORLD_H, WORLD_LAND, WORLD_OUTLINE, WORLD_PROJ, WORLD_W } from '../career/worldLand.ts';
import { stillFor } from './loadingArt.ts';

/**
 * The career: the World Tour. No team to join, no season — a map of the world with every circuit on
 * it. Three are open to start and you race them in any order; a first medal (a top five) at a circuit
 * earns a Tour pass that opens any circuit you choose. Each circuit's best result is a medal worth
 * stars (top five 1, podium 2, win 3); stars raise your rank and open the three scenic road courses.
 * You race with the car and team you've set up in the garage.
 *
 * Rendered into the garage's wide hub panel: the map fills it, the tour's title and score sit over
 * its top-left, the picked circuit's card on the right.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface TourCtx {
  career: Career;
  /** register a clickable for the menu's keyboard/gamepad navigation */
  action(e: HTMLElement, fn: () => void, disabled?: boolean): void;
  /** race a tour round at this circuit (travels there first) */
  onRace(id: string): void;
  /** a time trial at this circuit (travels there first) */
  onTimeTrial(id: string): void;
  /** watch a simulated race (its own setup screen) */
  onWatch?(): void;
  /** the tour changed (a circuit opened with a pass): draw it again */
  rerender(): void;
  sound(kind: 'move' | 'select' | 'back'): void;
  forecast(id: string): string;
  info(id: string): { country: string; km: string; turns: number; line?: string };
  circuitPath(points: number[], w: number, h: number, pad: number): string;
  layoutPoints(def: CircuitDef): number[];
}

/** Natural Earth I, as tools/build_world.mjs projects the land */
export function worldProject(lat: number, lon: number): [number, number] {
  const R = Math.PI / 180;
  const p = lat * R, l = lon * R, p2 = p * p, p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [(x + WORLD_PROJ.xMax) * WORLD_PROJ.s, (WORLD_PROJ.yTop - y) * WORLD_PROJ.s];
}

/** the circuit picked on the map (null: the round you're working on) */
let sel: string | null = null;
/** the map's filter (kept while the garage is open) */
let filter: 'all' | 'open' | 'medals' | 'challenges' = 'all';
/** the circuit a pass has just opened (its pin bursts on the redraw) */
let justOpened: string | null = null;
/** a forecast's icon, from its label ("Rain · Afternoon"): sun, moon, cloud, rain, storm, fog */
function wxKind(label: string): 'sun' | 'moon' | 'cloud' | 'rain' | 'storm' | 'fog' {
  const l = label.toLowerCase();
  if (/thunder|storm/.test(l)) return 'storm';
  if (/rain|drizzle|shower|wet|changeable/.test(l)) return 'rain';
  if (/fog|mist|haze/.test(l)) return 'fog';
  if (/cloud|overcast/.test(l)) return 'cloud';
  return /night|dusk/.test(l) ? 'moon' : 'sun';
}
const WX_ICON: Record<ReturnType<typeof wxKind>, string> = {
  sun: '<circle r="2.6" fill="#ffd25a"/><path d="M0-5.2v1.4M0 3.8v1.4M-5.2 0h1.4M3.8 0h1.4M-3.7-3.7l1 1M2.7 2.7l1 1M-3.7 3.7l1-1M2.7-2.7l1-1" stroke="#ffd25a" stroke-width="1.1" stroke-linecap="round"/>',
  moon: '<path d="M1.6-4.2a4.4 4.4 0 1 0 2.8 6.4A3.6 3.6 0 0 1 1.6-4.2z" fill="#cfd8ff"/>',
  cloud: '<path d="M-4.2 2.6h7.6a2.4 2.4 0 0 0 0-4.8 3.2 3.2 0 0 0-6.1-.7A2.3 2.3 0 0 0-4.2 2.6z" fill="#dfe5ee"/>',
  rain: '<path d="M-4.2 0.6h7.6a2.3 2.3 0 0 0 0-4.6 3.1 3.1 0 0 0-5.9-.7A2.2 2.2 0 0 0-4.2.6z" fill="#b8c4d4"/><path d="M-2.6 2.2l-.8 2.2M0 2.2l-.8 2.2M2.6 2.2l-.8 2.2" stroke="#5fb4ff" stroke-width="1.1" stroke-linecap="round"/>',
  storm: '<path d="M-4.2 0.4h7.6a2.3 2.3 0 0 0 0-4.6 3.1 3.1 0 0 0-5.9-.7A2.2 2.2 0 0 0-4.2.4z" fill="#8f9aab"/><path d="M0.4 0.8L-1.2 3.4h1.6L-.6 5.6 1.8 2.6H.2z" fill="#ffd25a"/>',
  fog: '<path d="M-4.4-2h8.8M-3.6 0h7.2M-4.4 2h8.8" stroke="#c9d1dc" stroke-width="1.2" stroke-linecap="round"/>',
};

const agoText = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : d < 14 ? 'last week' : `${Math.floor(d / 7)} weeks ago`;
};
/** back in the garage: the map opens on the next round */
export function resetTour() {
  sel = null;
}

type State = 'done' | 'next' | 'open' | 'locked';
const MEDAL_WORD: Record<Exclude<Medal, null>, string> = { gold: 'Win', silver: 'Podium', bronze: `Top ${UNLOCK_POS}` };
const LOCK = `<path d="M-2.6 -0.6v-1.7a2.6 2.6 0 0 1 5.2 0V-0.6" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="-3.8" y="-0.7" width="7.6" height="5.4" rx="1.2" fill="currentColor"/>`;
const LOCK_ICON = `<svg class="lk-i" viewBox="-5 -5 10 10" width="14" height="14">${LOCK}</svg>`;
const STAR = `<path d="M0-5.2l1.53 3.1 3.42.5-2.47 2.41.58 3.4L0 2.6l-3.06 1.61.58-3.4-2.47-2.41 3.42-.5z"/>`;
const starsSvg = (n: number, size = 12) => [0, 1, 2].map((i) => `<svg class="st${i < n ? ' on' : ''}" viewBox="-6 -6 12 12" width="${size}" height="${size}">${STAR}</svg>`).join('');
/** the leader offsets for the scenic pins (their spots sit close to real circuits) */
const OFFSET: Record<string, [number, number]> = { ...PIN_OFFSET, serena: [46, 42], bergsee: [-3, -38], redmesa: [-30, -18] };

export function renderTour(p: HTMLElement, ctx: TourCtx) {
  const c = ctx.career;
  p.classList.add('wtour');
  const best = (id: string) => c.data.best[id];
  const stateOf = (id: string): State => {
    if (!c.isUnlocked(id)) return 'locked';
    if (medalFor(best(id))) return 'done';
    return 'open';
  };
  const next = c.nextRound();
  const states = new Map<string, State>(ALL_CIRCUITS.map((cd) => [cd.id, cd.id === next ? 'next' : stateOf(cd.id)]));
  const stars = c.stars();
  const maxStars = c.maxStars();
  const opened = ALL_CIRCUITS.filter((cd) => states.get(cd.id) !== 'locked').length;
  const med = c.medals();
  if (!sel || !ALL_CIRCUITS.some((cd) => cd.id === sel)) sel = next ?? [...CIRCUITS].reverse().find((cd) => states.get(cd.id) !== 'locked')?.id ?? CIRCUITS[0].id;

  // ---------------------------------------------------------------- the map
  const map = el('div', 'tr-map', p);
  const pts = ALL_CIRCUITS.map((cd) => {
    const g = GEO[cd.id] ?? [0, 0];
    const [x, y] = worldProject(g[0], g[1]);
    const o = OFFSET[cd.id] ?? [0, 0];
    return { cd, id: cd.id, x, y, ox: o[0], oy: o[1], st: states.get(cd.id)!, scenic: isScenic(cd.id) };
  });
  const at = (id: string) => pts.find((q) => q.id === id)!;
  // the route: your own journey, circuit to circuit in the order they opened (the three you start with,
  // then every one a pass opened), each leg a shallow arc; the legs still to fly, to the circuits you
  // could open next, dotted
  let done = '';
  let lead = '';
  let todo = '';
  const leg = (a: (typeof pts)[number], b: (typeof pts)[number]) => {
    const dd = Math.hypot(b.x - a.x, b.y - a.y);
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${((a.x + b.x) / 2).toFixed(1)} ${((a.y + b.y) / 2 - Math.min(60, dd * 0.25)).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };
  const journey = [...START_OPEN, ...(c.data.opened ?? [])].filter((id, i, arr) => arr.indexOf(id) === i && pts.some((q) => q.id === id));
  for (let i = 1; i < journey.length; i++) done += leg(at(journey[i - 1]), at(journey[i]));
  if (journey.length) {
    const last = at(journey[journey.length - 1]);
    // (from where you are now: the nearest locked calendar circuits, the ones a pass would open)
    const near = pts.filter((q) => q.st === 'locked' && !q.scenic).sort((p1, p2) => Math.hypot(p1.x - last.x, p1.y - last.y) - Math.hypot(p2.x - last.x, p2.y - last.y)).slice(0, 3);
    for (const q of near) (c.passes() > 0 ? (lead += leg(last, q)) : (todo += leg(last, q)));
  }
  const pinSvg = pts
    .map(({ cd, id, st, x, y, ox, oy, scenic }, i) => {
      const m = medalFor(best(id));
      const sh = ctx.circuitPath(ctx.layoutPoints(cd), 26, 26, 2);
      const tile = scenic ? `<rect class="tile" x="-17" y="-17" width="34" height="34" rx="6" transform="rotate(45)"/>` : `<rect class="tile" x="-19" y="-19" width="38" height="38" rx="9"/>`;
      const badge = st === 'locked' ? `<g class="lkb" transform="translate(15 -15)"><circle r="7.5"/><g class="lk" transform="scale(1.05)">${LOCK}</g></g>` : '';
      const leader = ox || oy ? `<line class="leader" x1="0" y1="0" x2="${ox}" y2="${oy}"/>` : '';
      const stars = st === 'locked' ? '' : `<g class="pst" transform="translate(0 ${scenic ? 33 : 30})">${[0, 1, 2].map((i) => `<path class="${i < (m ? STARS[m] : 0) ? 'on' : ''}" transform="translate(${(i - 1) * 11} 0) scale(0.95)" d="M0-5.2l1.53 3.1 3.42.5-2.47 2.41.58 3.4L0 2.6l-3.06 1.61.58-3.4-2.47-2.41 3.42-.5z"/>`).join('')}</g>`;
      const nm = `<g class="tag" transform="translate(0 ${st === 'locked' ? 32 : 47})"><text>${esc(cd.short.toUpperCase())}</text></g>`;
      // the weekend's forecast on every open circuit (top-left corner of the tile)
      const wx = st === 'locked' ? '' : `<g class="wxb" transform="translate(-16 -16)"><circle r="7.5"/>${WX_ICON[wxKind(ctx.forecast(id))]}</g>`;
      return (
        `<g class="pinw ${st}${scenic ? ' scenic' : ''}${m ? ` ${m}` : ''}${id === justOpened ? ' fresh' : ''}" style="--i:${i}" data-id="${id}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}">${leader}<circle class="spot" r="3"/>` +
        `<g class="pin" transform="translate(${ox} ${oy})"><circle class="halo" r="30"/>${tile}<g class="trk" transform="translate(-13 -13)"><path d="${sh}"/></g>${badge}${wx}${stars}${nm}</g></g>`
      );
    })
    .join('');
  map.innerHTML =
    `<svg class="tr-svg" viewBox="0 0 ${WORLD_W} ${WORLD_H}" preserveAspectRatio="xMidYMid slice">` +
    `<defs><pattern id="tr-dots" width="3.2" height="3.2" patternUnits="userSpaceOnUse"><circle cx="1.6" cy="1.6" r="0.62"/></pattern>` +
    `<linearGradient id="tr-land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#323947"/><stop offset="1" stop-color="#1f242d"/></linearGradient>` +
    `<filter id="tr-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>` +
    `<radialGradient id="tr-vig" cx="45%" cy="50%" r="75%"><stop offset="55%" stop-color="#05060a" stop-opacity="0"/><stop offset="100%" stop-color="#05060a" stop-opacity="0.75"/></radialGradient></defs>` +
    `<g class="tr-world">` +
    `<path class="sea" d="${WORLD_OUTLINE}"/><path class="grat" d="${WORLD_GRATICULE}"/>` +
    `<path class="shore" d="${WORLD_LAND}"/><path class="land" d="${WORLD_LAND}"/><path class="dots" d="${WORLD_LAND}"/><path class="borders" d="${WORLD_BORDERS}"/><path class="coast" d="${WORLD_LAND}"/>` +
    `<path class="route todo" d="${todo}"/><path class="route done-glow" pathLength="1" d="${done}"/><path class="route done" pathLength="1" d="${done}"/><path class="route lead" d="${lead}"/>` +
    `${pinSvg}</g>` +
    `<rect class="vig" width="${WORLD_W}" height="${WORLD_H}" fill="url(#tr-vig)" pointer-events="none"/></svg>`;

  // the tour's title, rank and score over the map's top-left
  const passes = c.passes();
  const rk = c.rank();
  const recent = c.data.history.slice(0, 6);
  const shortOf = (id: string) => ALL_CIRCUITS.find((x) => x.id === id)?.short ?? id;
  map.insertAdjacentHTML(
    'beforeend',
    `<div class="tr-head"><div class="eyebrow">Career · ${esc(rk.name)}</div><div class="tr-title">World <span>Tour</span></div>` +
      `<div class="tr-sub">Race any open circuit, in any order. A first top ${UNLOCK_POS} at a circuit earns a Tour pass: spend it to open any circuit you like.</div>` +
      `<div class="tr-stats"><div class="ts big"><b>${stars}<small>/${maxStars}</small></b><span>${starsSvg(1, 11)}Stars</span></div>` +
      `<div class="ts"><b>${opened}<small>/${ALL_CIRCUITS.length}</small></b><span>Circuits open</span></div>` +
      `<div class="ts med"><b><i class="md gold"></i>${med.gold}<i class="md silver"></i>${med.silver}<i class="md bronze"></i>${med.bronze}</b><span>Medals</span></div>` +
      `<div class="ts pass${passes ? ' have' : ''}"><b><svg viewBox="0 0 16 16" width="20" height="20"><path d="M2 4.5h12v2.2a1.6 1.6 0 0 0 0 3.1v2.2H2V9.8a1.6 1.6 0 0 0 0-3.1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.5 5v6" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.4 1.4"/></svg>${passes}</b><span>Tour pass${passes === 1 ? '' : 'es'}</span></div></div>` +
      `<div class="tr-rank"><div class="rk-top"><span class="rk-i">${rk.index + 1}</span><b>${esc(rk.name)}</b>${rk.next ? `<em>${rk.toNext} star${rk.toNext === 1 ? '' : 's'} to ${esc(rk.next)}</em>` : '<em>Top rank</em>'}</div>` +
      `<div class="rk-bar">${RANKS.slice(1).map((r, i) => `<i class="${i < rk.index ? 'on' : i === rk.index ? 'cur' : ''}" style="--k:${i === rk.index ? rk.k.toFixed(3) : i < rk.index ? 1 : 0}"></i>`).join('')}</div></div>` +
      (recent.length
        ? `<div class="tr-recent"><span class="cap">Last races</span>${recent
            .map((r) => {
              const m = r.dnf ? null : medalFor(r.pos);
              return `<span class="rr ${m ?? ''}${r.dnf ? ' dnf' : ''}"><b>${r.dnf ? 'DNF' : `P${r.pos}`}</b>${esc(shortOf(r.track))}</span>`;
            })
            .join('')}</div>`
        : '') +
      `</div>` +
      `<div class="tr-legend"><span><i class="lg tile"></i>Open</span><span><i class="lg next"></i>Suggested</span><span><i class="lg locked">${LOCK_ICON}</i>Locked</span><span><i class="lg dia"></i>Scenic bonus</span>` +
      `<span class="md-l"><i class="md gold"></i>Win ★★★<i class="md silver"></i>Podium ★★<i class="md bronze"></i>Top ${UNLOCK_POS} ★</span></div>`,
  );
  map.classList.toggle('can-open', passes > 0);

  // ---------------------------------------------------------------- the picked circuit
  const card = el('div', 'tr-card', p);
  const body = el('div', 'tr-body', card);
  const lapsRow = el('div', 'tr-laps', card, '<span>Race distance</span>');
  const chips = TOUR_LAPS.map((n) => {
    const b = el('div', 'tr-lap' + (n === c.tourLaps ? ' on' : ''), lapsRow, `${n}<small>${n >= 10 ? 'laps · 1 stop' : 'laps'}</small>`);
    ctx.action(b, () => {
      c.setTourLaps(n);
      chips.forEach((k, i) => k.classList.toggle('on', TOUR_LAPS[i] === c.tourLaps));
      const f = body.querySelector('.facts .laps');
      if (f) f.textContent = `${c.tourLaps} laps`;
    });
    return b;
  });
  const acts = el('div', 'tr-acts', card);
  const prev = el('div', 'cta ghost tr-step', acts, '‹');
  const go = el('div', 'cta tr-go', acts, 'Race');
  const fwd = el('div', 'cta ghost tr-step', acts, '›');
  // the other ways to drive an open circuit: a flying lap on your own, or a race to watch
  const more = el('div', 'tr-more', card);
  const tt = el('div', 'tr-alt', more, '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="9" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 9V6M6.4 1.8h3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Time trial</span>');
  const watch = ctx.onWatch ? el('div', 'tr-alt', more, '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="3" width="13" height="9" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.6 5.6v3.8L9.8 7.5z" fill="currentColor"/></svg><span>Watch a race</span>') : null;

  // ---------------------------------------------------------------- the camera: pan (drag), zoom (wheel,
  // buttons), the world view with every circuit on it, and a glide onto a picked circuit
  const world = map.querySelector<SVGGElement>('.tr-world')!;
  const pinws = Array.from(map.querySelectorAll<SVGGElement>('.pinw'));
  const view = { k: 1, tx: 0, ty: 0 };
  const K_MIN = 0.55;
  const K_MAX = 5;
  /** the svg's slice: map units per screen px, and the part of the map in view at k = 1 */
  const frame = () => {
    const cw = map.clientWidth || 1200;
    const ch = map.clientHeight || 600;
    const s = Math.max(cw / WORLD_W, ch / WORLD_H);
    const vw = cw / s;
    const vh = ch / s;
    return { s, vw, vh, left: WORLD_W / 2 - vw / 2, top: WORLD_H / 2 - vh / 2, free: Math.max(vw * 0.4, vw - (card.offsetWidth + 40) / s) };
  };
  const apply = (glide: boolean) => {
    const f = frame();
    view.k = Math.max(K_MIN, Math.min(K_MAX, view.k));
    // (free to wander, but the world never leaves the frame: at least a third of it stays in view)
    const lim = (v: number, a: number, b: number) => Math.min(Math.max(a, b), Math.max(Math.min(a, b), v));
    view.tx = lim(view.tx, f.left + f.vw * 0.33 - WORLD_W * view.k, f.left + f.vw * 0.67);
    view.ty = lim(view.ty, f.top + f.vh * 0.33 - WORLD_H * view.k, f.top + f.vh * 0.67);
    map.classList.toggle('instant', !glide);
    world.style.transform = `translate(${view.tx.toFixed(1)}px, ${view.ty.toFixed(1)}px) scale(${view.k.toFixed(4)})`;
    // pins keep their size on screen — a little smaller zoomed right out, where Europe's are close together
    const ps = Math.max(0.6, Math.min(1, 0.6 + 0.2 * (view.k - 1)));
    for (const w of pinws) w.style.transform = `translate(${w.dataset.x}px, ${w.dataset.y}px) scale(${(ps / view.k).toFixed(4)})`;
    map.classList.toggle('wide', view.k < 1.6);
  };
  const mark = (id: string) => {
    for (const w of pinws) w.classList.toggle('sel', w.dataset.id === id);
  };
  /** glide onto a circuit, into the part of the map the card leaves free */
  const focus = (id: string, glide = true) => {
    const q = at(id);
    const g = GEO[id] ?? [45, 10];
    const europe = g[0] > 38 && g[0] < 58 && g[1] > -12 && g[1] < 28;
    const k = Math.max(view.k, europe ? 2.6 : 1.8);
    const f = frame();
    view.k = k;
    view.tx = f.left + f.free / 2 - (q.x + q.ox / k) * k;
    view.ty = f.top + f.vh * 0.55 - (q.y + q.oy / k) * k;
    apply(glide);
  };
  /** the world view: every circuit on the tour in the part of the map the card leaves free */
  const overview = (glide = true) => {
    const f = frame();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of pts) {
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    // (below the tour's title block, left of the card)
    const padX = 40, padY = 50;
    // (the title block now carries the rank and the last races: the pins sit in the lower two thirds)
    const k = Math.max(K_MIN, Math.min(2.2, Math.min(f.free / (x1 - x0 + padX * 2), (f.vh * 0.6) / (y1 - y0 + padY * 2))));
    view.k = k;
    view.tx = f.left + f.free / 2 - ((x0 + x1) / 2) * k;
    view.ty = f.top + f.vh * 0.66 - ((y0 + y1) / 2) * k;
    apply(glide);
  };
  // drag to pan (a press that moves less than a few pixels is still a click on a pin)
  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  map.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.tr-zoom')) return;
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    map.classList.add('dragging');
    // (screen px → map units: the svg's slice scale and the menu's own zoom)
    const z = frame().s * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1);
    view.tx = drag.tx + dx / z;
    view.ty = drag.ty + dy / z;
    apply(false);
  });
  const endDrag = () => {
    map.classList.remove('dragging');
    setTimeout(() => (drag = null), 0);
  };
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);
  // wheel / pinch to zoom, about the point under the cursor
  map.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const f = frame();
      const r = map.getBoundingClientRect();
      const ux = f.left + ((e.clientX - r.left) / r.width) * f.vw;
      const uy = f.top + ((e.clientY - r.top) / r.height) * f.vh;
      const wx = (ux - view.tx) / view.k, wy = (uy - view.ty) / view.k;
      view.k = Math.max(K_MIN, Math.min(K_MAX, view.k * Math.exp(-e.deltaY * 0.0016)));
      view.tx = ux - wx * view.k;
      view.ty = uy - wy * view.k;
      apply(false);
    },
    { passive: false },
  );
  const zoomBy = (m: number) => {
    const f = frame();
    const ux = f.left + f.free / 2, uy = f.top + f.vh / 2;
    const wx = (ux - view.tx) / view.k, wy = (uy - view.ty) / view.k;
    view.k = Math.max(K_MIN, Math.min(K_MAX, view.k * m));
    view.tx = ux - wx * view.k;
    view.ty = uy - wy * view.k;
    apply(true);
  };
  const zoom = el('div', 'tr-zoom', map);
  const zin = el('button', 'zb', zoom, '+');
  const zout = el('button', 'zb', zoom, '−');
  const zall = el('button', 'zb all', zoom, '<svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.8 8h12.4M8 1.8c-2.4 2.2-2.4 10.2 0 12.4M8 1.8c2.4 2.2 2.4 10.2 0 12.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg><span>World</span>');
  zin.title = 'Zoom in';
  zout.title = 'Zoom out';
  zall.title = 'Every circuit';
  // filters: dim every pin but the ones that matter for what you're after
  type Filter = 'all' | 'open' | 'medals' | 'challenges';
  const filt = el('div', 'tr-filt', map);
  const FILTERS: [Filter, string][] = [['all', 'All'], ['open', 'Open'], ['medals', 'Stars to win'], ['challenges', 'Challenges']];
  const keep = (id: string, f: Filter) => {
    const stt = states.get(id)!;
    if (f === 'all') return true;
    if (stt === 'locked') return false;
    if (f === 'open') return true;
    if (f === 'medals') return medalFor(best(id)) !== 'gold';
    return !c.challengeFor(id).done;
  };
  const chipsF = FILTERS.map(([f, label]) => {
    const b = el('button', 'fb' + (f === filter ? ' on' : ''), filt, label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      filter = f;
      chipsF.forEach((k, i) => k.classList.toggle('on', FILTERS[i][0] === f));
      for (const w of pinws) w.classList.toggle('dim', !keep(w.dataset.id!, f));
    });
    return b;
  });
  for (const w of pinws) w.classList.toggle('dim', !keep(w.dataset.id!, filter));
  // hover: a small card by the pin — the circuit, its medal, the forecast, the challenge
  const tip = el('div', 'tr-tip', map);
  map.addEventListener('pointerover', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.pinw');
    if (!g?.dataset.id || drag?.moved) return;
    const id = g.dataset.id;
    const cd = ALL_CIRCUITS.find((x) => x.id === id)!;
    const stt = states.get(id)!;
    const m = medalFor(best(id));
    const ch = c.challengeFor(id);
    tip.innerHTML =
      `<b>${esc(cd.name)}</b><span class="tc">${esc(ctx.info(id).country)}</span>` +
      (stt === 'locked'
        ? `<span class="tl">${isScenic(id) ? `${SCENIC_STARS[id]} stars to open` : c.passes() ? 'Open it with a Tour pass' : 'Locked · earn a Tour pass'}</span>`
        : `<span class="tf"><svg viewBox="-6 -6 12 12" width="14" height="14">${WX_ICON[wxKind(ctx.forecast(id))]}</svg>${esc(ctx.forecast(id))}</span>` +
          `<span class="tm">${m ? `<i class="md ${m}"></i>${MEDAL_WORD[m]} · best P${best(id)}` : 'No medal yet'}${ch.done ? ' · challenge done' : ''}</span>`);
    const r = map.getBoundingClientRect();
    const pr = g.querySelector('.pin')!.getBoundingClientRect();
    const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
    tip.style.left = `${(pr.right - r.left) / z + 10}px`;
    tip.style.top = `${(pr.top - r.top) / z}px`;
    tip.classList.add('on');
  });
  map.addEventListener('pointerout', (e) => {
    if (!(e.relatedTarget as Element | null)?.closest?.('.pinw')) tip.classList.remove('on');
  });
  zin.addEventListener('click', () => zoomBy(1.5));
  zout.addEventListener('click', () => zoomBy(1 / 1.5));
  zall.addEventListener('click', () => overview());

  const draw = (glideTo = true) => {
    const id = sel!;
    const cd = ALL_CIRCUITS.find((x) => x.id === id)!;
    const st = states.get(id)!;
    const info = ctx.info(id);
    const b = best(id);
    const m = medalFor(b);
    const scenic = isScenic(id);
    const round = CIRCUITS.findIndex((x) => x.id === id);
    mark(id);
    if (glideTo) focus(id);
    card.className = `tr-card ${st}${m ? ` ${m}` : ''}`;
    body.innerHTML = '';
    const art = el('div', 'tr-art', body);
    art.style.backgroundImage = `url("${stillFor(id)}")`;
    art.innerHTML =
      `<svg class="tr-art-trk" viewBox="0 0 120 84"><path d="${ctx.circuitPath(ctx.layoutPoints(cd), 120, 84, 6)}"/></svg>` +
      `<span class="badge ${st}">${st === 'locked' ? `${LOCK_ICON}Locked` : st === 'next' ? 'Next up' : m ? MEDAL_WORD[m] : 'Open'}</span>` +
      `<span class="rno">${scenic ? 'Scenic' : String(round + 1).padStart(2, '0')}</span>`;
    el(
      'div',
      'tr-id',
      body,
      `<div class="cap">${esc(info.country)}${scenic ? ' · Bonus circuit' : ` · Round ${round + 1} of ${CIRCUITS.length}`}</div><div class="nm">${esc(cd.name)}</div>` +
        `<div class="facts">${st !== 'locked' ? `<span class="laps">${c.tourLaps} laps</span>` : ''}${info.km ? `<span>${info.km} km</span>` : ''}${info.turns ? `<span>${info.turns} turns</span>` : ''}</div>` +
        (info.line ? `<div class="ln">${esc(info.line)}</div>` : '') +
        (st !== 'locked' ? `<div class="fc">Forecast · ${esc(ctx.forecast(id))}</div>` : ''),
    );
    // the medal ladder: what each finish is worth, the ones won ticked
    const got = m ? STARS[m] : 0;
    const ladder = el('div', 'tr-ladder', body);
    for (const [k, word] of [['bronze', `Top ${UNLOCK_POS}`], ['silver', 'Podium'], ['gold', 'Win']] as const) {
      const n = STARS[k];
      el('div', `rung ${k}${got >= n ? ' won' : ''}`, ladder, `<i class="md ${k}"></i><span>${word}</span><em>${starsSvg(n, 11)}</em>`);
    }
    // the circuit's bonus challenge: a fourth star
    const ch = c.challengeFor(id);
    el('div', `tr-chal${ch.done ? ' done' : ''}`, body, `<i>${ch.done ? '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '★'}</i><span><em>Challenge</em>${esc(ch.c.text)}</span>`);
    const rec = c.recordAt(id);
    if (st === 'locked') {
      const why = scenic
        ? `<b>${SCENIC_STARS[id]} stars</b> open it — you have ${stars}.`
        : passes > 0
          ? `Spend a <b>Tour pass</b> to open it — you have ${passes}.`
          : `<b>Earn a Tour pass</b>: finish top ${UNLOCK_POS} at any open circuit you haven't medalled at yet.`;
      el('div', 'tr-why locked' + (!scenic && passes > 0 ? ' can' : ''), body, `${LOCK_ICON}<span>${why}</span>`);
    } else if (rec.races) {
      const ago = rec.last ? agoText(rec.last.date) : '';
      el(
        'div',
        'tr-why rec',
        body,
        `<span>Raced <b>${rec.races}×</b>${b !== undefined ? ` · best <b>P${b}</b>` : ''}${rec.last ? ` · last ${rec.last.dnf ? '<b>DNF</b>' : `<b>P${rec.last.pos}</b>`} ${ago}` : ''}${m === 'gold' ? ' · every star here is yours' : m ? ' · race again for more stars' : ''}</span>`,
      );
    } else {
      el('div', 'tr-why', body, `<span>Not raced yet. <b>Top ${UNLOCK_POS}</b> ${scenic ? 'earns its first star' : 'earns a star and a Tour pass'}.</span>`);
    }
    const openable = st === 'locked' && !scenic && passes > 0;
    lapsRow.hidden = st === 'locked';
    tt.classList.toggle('dis', st === 'locked');
    go.classList.toggle('dis', st === 'locked' && !openable);
    go.classList.toggle('pass', openable);
    go.textContent = openable ? 'Open with a pass' : st === 'locked' ? 'Locked' : `Race ${cd.short}`;
  };
  const order = [...CIRCUITS, ...SCENIC].map((x) => x.id);
  const step = (k: number) => {
    const i = order.indexOf(sel!);
    sel = order[(i + k + order.length) % order.length];
    draw();
  };
  ctx.action(prev, () => step(-1));
  ctx.action(go, () => {
    if (states.get(sel!) !== 'locked') return ctx.onRace(sel!);
    // a Tour pass spent: the circuit opens (and the map is drawn again with it lit)
    if (c.openWithPass(sel!)) {
      justOpened = sel;
      ctx.sound('select');
      ctx.rerender();
    } else ctx.sound('back');
  });
  ctx.action(fwd, () => step(1));
  ctx.action(tt, () => {
    if (states.get(sel!) !== 'locked') ctx.onTimeTrial(sel!);
  });
  if (watch) ctx.action(watch, () => ctx.onWatch?.());
  map.addEventListener('click', (e) => {
    if (drag?.moved) return;
    const g = (e.target as Element).closest<SVGGElement>('.pinw');
    if (!g?.dataset.id) return;
    sel = g.dataset.id;
    draw();
  });
  map.addEventListener('dblclick', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.pinw');
    if (g?.dataset.id && states.get(g.dataset.id) !== 'locked') ctx.onRace(g.dataset.id);
  });
  // opens on the world view: every circuit on the map, the next one picked
  const fresh = justOpened;
  justOpened = null;
  if (fresh) {
    // (a circuit just opened: the map goes straight to it)
    draw(false);
    requestAnimationFrame(() => focus(fresh, false));
    card.classList.add('opened');
    return { go };
  }
  draw(false);
  overview(false);
  // (the panel had no size yet: frame the world again once laid out)
  requestAnimationFrame(() => overview(false));
  return { go };
}
