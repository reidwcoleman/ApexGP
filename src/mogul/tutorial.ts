// The guided tutorial: Penny (a friendly gold coin) walks a new player from the first cart to the first
// Frenzy. Each step spotlights a control or a spot on the map and waits for the player to actually do it.
import type { Sim } from './sim.ts';
import type { UI } from './ui.ts';
import type { World } from './world.ts';
import type { Props } from './props.ts';
import { money } from './sim.ts';

export const PENNY = `<svg viewBox="0 0 120 120" class="penny">
  <defs><radialGradient id="pg" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff4b8"/><stop offset="0.45" stop-color="#ffc83d"/><stop offset="1" stop-color="#d98a00"/></radialGradient></defs>
  <ellipse cx="60" cy="112" rx="30" ry="5" fill="rgba(0,0,0,0.15)"/>
  <circle cx="60" cy="62" r="44" fill="url(#pg)" stroke="#b97300" stroke-width="4"/>
  <circle cx="60" cy="62" r="35" fill="none" stroke="#e8a412" stroke-width="2.5" stroke-dasharray="4 5"/>
  <path d="M30 30 Q60 4 90 30 L86 36 Q60 18 34 36 Z" fill="#e5533d"/><rect x="28" y="32" width="64" height="8" rx="4" fill="#c23a28"/>
  <circle cx="46" cy="58" r="6.5" fill="#23201b"/><circle cx="74" cy="58" r="6.5" fill="#23201b"/>
  <circle cx="48.5" cy="55.5" r="2.2" fill="#fff"/><circle cx="76.5" cy="55.5" r="2.2" fill="#fff"/>
  <circle cx="38" cy="72" r="5" fill="#ff8a7a" opacity="0.55"/><circle cx="82" cy="72" r="5" fill="#ff8a7a" opacity="0.55"/>
  <path d="M48 74 Q60 86 72 74" fill="none" stroke="#23201b" stroke-width="4" stroke-linecap="round"/>
  <path d="M16 70 Q6 62 12 52" fill="none" stroke="#b97300" stroke-width="5" stroke-linecap="round"/><path d="M104 70 Q116 60 108 48" fill="none" stroke="#b97300" stroke-width="5" stroke-linecap="round"/>
</svg>`;

interface Step {
  title: string;
  body: string;
  /** a CSS selector to spotlight, or 'cart' for your first cart on the map */
  target?: string;
  world?: () => { x: number; y: number; z: number } | null;
  done?: () => boolean;
  next?: string; // a Next button label (steps without `done`)
  enter?: () => void;
}

export class Tutorial {
  active = false;
  i = 0;
  root: HTMLElement;
  rushes = 0;
  grabbed = 0;
  private spot: HTMLElement;
  private card: HTMLElement;
  private arrow: HTMLElement;
  private steps: Step[];
  private camStart = { x: 0, z: 0, d: 0 };
  private stepT = 0;
  onDone: () => void = () => {};

  constructor(root: HTMLElement, private sim: Sim, private ui: UI, private world: World, private props: Props) {
    this.root = document.createElement('div');
    this.root.className = 'tut';
    this.root.innerHTML = `<div class="tspot"></div><div class="tarrow"><svg viewBox="0 0 40 52"><path d="M20 50 L4 26 H14 V2 H26 V26 H36 Z" fill="#ffc83d" stroke="#23201b" stroke-width="3" stroke-linejoin="round"/></svg></div><div class="tcard glass"></div>`;
    root.appendChild(this.root);
    this.spot = this.root.querySelector('.tspot') as HTMLElement;
    this.card = this.root.querySelector('.tcard') as HTMLElement;
    this.arrow = this.root.querySelector('.tarrow') as HTMLElement;
    this.root.style.display = 'none';
    const firstCart = () => this.sim.myCarts()[0];
    const cartPos = () => { const c = firstCart(); return c ? { x: c.x, y: 7, z: c.z } : null; };
    const s = this.sim;
    this.steps = [
      { title: `Hi, I'm Penny!`, body: `Welcome to <b>${s.city.def.area}</b>. Every street and building here is real. You start with ${money(s.s.cash)} and one free food cart. By the end you'll own the skyline. Ready?`, next: "Let's go" },
      {
        title: 'Look around', body: '<b>Drag</b> to move the map, <b>scroll</b> to zoom, <b>right-drag</b> (or Q/E) to turn. Give it a try.',
        enter: () => { const t = this.world.controls.target; this.camStart = { x: t.x, z: t.z, d: this.world.camera.position.distanceTo(t) }; },
        done: () => { const t = this.world.controls.target; const d = this.world.camera.position.distanceTo(t); return Math.hypot(t.x - this.camStart.x, t.z - this.camStart.z) > 50 || Math.abs(d - this.camStart.d) > 80; },
        next: 'Skip',
      },
      { title: 'Follow the crowd', body: 'The coloured streets show <b>foot traffic</b>. <span class="hot">Red and orange</span> streets are the busiest. More people walking by = more customers.', enter: () => { this.world.heat.visible = true; }, next: 'Got it' },
      { title: 'Grab your cart', body: 'Click the <b>Cart</b> button in the dock (or press <kbd>C</kbd>). Your first one is free.', target: '[data-tool="cart"]', done: () => this.ui.tool === 'cart' || s.myCarts().length > 0 },
      { title: 'Park it somewhere busy', body: 'Move over the map: the tip shows how many people pass each spot. Click a <b>hot sidewalk</b> to park.', done: () => s.myCarts().length > 0 },
      { title: 'Customers!', body: 'People walking past stop, line up and pay. Every coin you see popping up is real money.', world: cartPos, enter: () => { const c = firstCart(); if (c) this.world.flyTo(c.x, c.z, 130); }, done: () => s.s.stats.served >= 3 },
      { title: 'Serve faster', body: 'When a line forms, <b>click your cart</b> to serve the person at the front instantly. Click fast for a <b>Rush combo</b>! Try it 3 times.', world: cartPos, done: () => this.rushes >= 3, next: 'Skip' },
      {
        title: 'Two things on the menu', body: 'Add a second item. <b>Coffee</b> sells in the morning, <b>tacos</b> at night, <b>lemonade</b> on hot days.', target: '.panel .menu',
        enter: () => { const c = firstCart(); if (c) this.ui.select({ k: 'cart', id: c.id }); },
        done: () => s.myCarts().some((c) => c.menu.length >= 2),
      },
      { title: 'Pick your price', body: 'Line always full? <b>Raise the price</b>: you earn more from each customer. Nobody stopping? Lower it. The label tells you how people feel about it.', target: '.panel .price', next: 'Next' },
      { title: 'Build up HYPE', body: 'Every sale fills the <b>Hype</b> meter. When it\'s full, your business goes into a <b>FRENZY</b>: double the crowds and faster service for 25 seconds.', target: '.hype', next: 'Next' },
      {
        title: 'Money on the street!', body: 'Cash drops appear on the pavement now and then. <b>Click it</b> before it fades away!',
        enter: () => { const c = firstCart(); if (c) { const sp = s.sidewalk(c.x + 14, c.z + 10); this.props.spawnDrop(sp.x, sp.z, Math.max(60, s.bonusSize())); this.dropPos = { x: sp.x, z: sp.z }; } },
        world: () => (this.dropPos ? { x: this.dropPos.x, y: 8, z: this.dropPos.z } : null),
        done: () => this.grabbed > 0, next: 'Skip',
      },
      { title: 'City orders', body: 'The city posts short <b>orders</b>: serve so many customers or make so much before the clock runs out. Finish them for bonus cash.', target: '.orders', next: 'Next' },
      { title: 'Your next goal', body: 'Your next goal is always here, with a cash reward. Follow them and you\'ll learn every part of the game.', target: '.quest', next: 'Next' },
      { title: 'Then think bigger', body: '<b>Rent</b> rooms for shops, buy whole <b>Property</b>, <b>Survey</b> for buried ore, build factories, hire <b>Trucks</b> and trade on the <b>Exchange</b>.', target: '.dock', next: 'Next' },
      { title: 'Beat the rivals', body: 'Nine companies race you every month. Finish top 3 for a trophy that raises your income for good. Speed time up here when you want.', target: '.clock', next: 'Start playing!' },
    ];
  }
  private dropPos: { x: number; z: number } | null = null;

  start() {
    this.active = true;
    this.i = 0;
    this.rushes = 0;
    this.grabbed = 0;
    this.root.style.display = '';
    this.show();
  }
  stop(finished: boolean) {
    this.active = false;
    this.root.style.display = 'none';
    try { localStorage.setItem('mogul.tutDone', '1'); } catch {}
    if (finished) {
      this.sim.gift(250);
      this.ui.banner('You\'re ready!', 'Tutorial bonus: +$250. Go build that empire.', '#22b26b');
      this.ui.confetti(180);
    }
    this.onDone();
  }

  private show() {
    const st = this.steps[this.i];
    this.stepT = 0;
    st.enter?.();
    const dots = this.steps.map((_, k) => `<i class="${k === this.i ? 'on' : k < this.i ? 'past' : ''}"></i>`).join('');
    this.card.innerHTML = `<div class="tp">${PENNY}</div><div class="tb"><div class="tt">${st.title}</div><div class="tx">${st.body}</div>
      <div class="tf"><div class="tdots">${dots}</div><div class="row"><button class="tskip">Skip tutorial</button>${st.next ? `<button class="btn gold tnext" style="height:36px">${st.next}</button>` : st.done ? '<span class="twait">Waiting for you…</span>' : ''}</div></div></div>`;
    this.card.classList.remove('in'); void this.card.offsetWidth; this.card.classList.add('in');
    (this.card.querySelector('.tskip') as HTMLElement).onclick = () => this.stop(false);
    const nb = this.card.querySelector('.tnext') as HTMLElement | null;
    if (nb) nb.onclick = () => this.advance();
  }
  private advance() {
    this.i++;
    if (this.i >= this.steps.length) { this.stop(true); return; }
    this.show();
  }

  update(dt: number) {
    if (!this.active) return;
    const st = this.steps[this.i];
    this.stepT += dt;
    if (st.done && this.stepT > 0.4 && st.done()) { this.ui.confetti(24, innerWidth / 2, innerHeight - 140, 0.4); this.advance(); return; }
    // spotlight a control
    const el = st.target ? (document.querySelector(st.target) as HTMLElement | null) : null;
    const card = this.card;
    if (el && el.offsetParent !== null) {
      const r = el.getBoundingClientRect();
      const pad = 8;
      Object.assign(this.spot.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      // the card sits beside the spotlight, wherever there's room
      const cw = card.offsetWidth, ch = card.offsetHeight;
      let x = r.right + 18, y = r.top;
      if (r.top > innerHeight * 0.6) { x = Math.min(innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2)); y = r.top - ch - 22; }
      else if (x + cw > innerWidth - 12) x = r.left - cw - 18;
      if (x < 12) { x = Math.min(innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2)); y = r.top - ch - 18; if (y < 12) y = r.bottom + 18; }
      y = Math.max(12, Math.min(innerHeight - ch - 12, y));
      card.style.left = x + 'px'; card.style.top = y + 'px';
    } else {
      this.spot.style.display = 'none';
      card.style.left = Math.max(12, innerWidth / 2 - card.offsetWidth / 2) + 'px';
      card.style.top = st.world ? '96px' : Math.max(96, innerHeight * 0.32) + 'px';
    }
    // point at something on the map
    const w = st.world?.();
    const p = w ? this.world.toScreen(w.x, w.y, w.z) : null;
    if (p) { this.arrow.style.display = 'block'; this.arrow.style.transform = `translate(${p.x - 20}px, ${p.y - 62 - Math.abs(Math.sin(performance.now() / 220)) * 14}px)`; }
    else this.arrow.style.display = 'none';
  }
}
