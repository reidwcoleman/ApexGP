// A short guided first campaign turn: select a legion, march, attack, run a city, build, end the turn.
// Each step watches the game state and advances on its own; any step can be skipped.
import { ICONS } from '../ui/icons.js';
import { audio } from '../audio.js';

const STEPS = [
  {
    id: 'hello', title: 'Ave, Consul', icon: 'eagle',
    text: 'Rome holds three cities in Italy. Your job: grow them, raise legions and take the known world, one province at a time. This takes about two minutes.',
    next: 'Show me',
  },
  {
    id: 'select', title: 'Select a legion', icon: 'eagle',
    text: 'Click <b>Legio I</b>, the red banner over Roma, or click it in the <b>Legions</b> list on the right.',
    glow: () => ['.ol-armies .olr'],
    done: (c) => c.sel && c.sel.kind === 'army' && c.s.armies.find((a) => a.id === c.sel.id)?.owner === c.s.player,
  },
  {
    id: 'march', title: 'March', icon: 'run',
    text: 'The <b style="color:#f3d98e">gold</b> provinces are where this legion can march this year. <b style="color:#ff8a6a">Red</b> ones can be attacked. <b>Click a gold or red province</b> to send it there.',
    done: (c, t) => c.s.armies.some((a) => a.owner === c.s.player && a.mp < t.mp0) || c.s.stats.won + c.s.stats.lost > t.b0,
    enter: (c, t) => { t.mp0 = Math.max(...c.s.armies.filter((a) => a.owner === c.s.player).map((a) => a.mp), 0); t.b0 = c.s.stats.won + c.s.stats.lost; },
  },
  {
    id: 'battle', title: 'Take a province', icon: 'sword',
    text: 'Attacking a red province starts a battle. <b>Fight the Battle</b> to command it yourself (click troops, then click the ground or an enemy), or <b>Auto-Resolve</b>. Win, and the province is yours. You can come back to this later.',
    next: 'Got it',
    done: (c, t) => c.s.stats.won > t.w0,
    enter: (c, t) => { t.w0 = c.s.stats.won; },
  },
  {
    id: 'city', title: 'Run your city', icon: 'forum',
    text: 'Cities pay for everything. <b>Double-click Roma</b> on the map (or click it, then <b>Manage City</b>).',
    glow: () => ['.p-manage', '.ol-cities .olr'],
    done: (c) => !!c.city,
  },
  {
    id: 'build', title: 'Build something', icon: 'hammer',
    text: 'Pick a building in the bar at the bottom, then press the <b>gold button</b> on the right. A <b>Forum</b> earns denarii, <b>Farms</b> grow the city, <b>Barracks</b> unlock better troops.',
    glow: () => ['.cs-primary:not([disabled])', '.cs-bar'],
    done: (c) => c.s.provs.some((p) => p.owner === c.s.player && p.queue.length),
  },
  {
    id: 'recruit', title: 'Raise soldiers', icon: 'shield',
    text: 'The <b>Recruit</b> tab adds new units to the legion in this city. More men win more battles, but every unit costs upkeep each year.',
    glow: () => ['.cs-tabs button[data-v="recruit"]'],
    next: 'Next',
  },
  {
    id: 'end', title: 'End the year', icon: 'eagle',
    text: 'Leave the city (<b>World</b> or Esc) and press the <b>gold eagle</b> (or Enter). Buildings progress, money comes in, legions can march again, and rivals take their turns.',
    glow: () => ['.endturn', '.cs-back'],
    done: (c, t) => c.s.turn > t.turn0,
    enter: (c, t) => { t.turn0 = c.s.turn; },
  },
  {
    id: 'bye', title: 'The world awaits', icon: 'laurel',
    text: 'Each year: <b>build</b> in idle cities, <b>march</b> ready legions, then <b>end the turn</b>. The badges above the eagle tell you what is left to do. Hold 100 provinces to win. The <b>Guide</b> button has every rule.',
    next: 'Ave!',
  },
];

export class Tutorial {
  constructor(ctl) {
    this.ctl = ctl;
    const s = ctl.s;
    s.tut = s.tut ?? { step: 0, off: false };
    this.t = {};
    this.el = document.createElement('div');
    this.el.className = 'coach';
    ctl.uiRoot.appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      audio.init(); audio.sfx('click');
      if (b.dataset.tut === 'skip') this.finish();
      else this.advance();
    });
    this.lastStep = -1;
    this.timer = setInterval(() => this.tick(), 250);
    this.tick();
  }

  get on() { const t = this.ctl.s.tut; return !t.off && t.step < STEPS.length; }

  restart() { this.ctl.s.tut = { step: 0, off: false }; this.lastStep = -1; this.tick(); }

  finish() { this.ctl.s.tut.off = true; this.clearGlow(); this.el.style.display = 'none'; }

  advance() {
    const t = this.ctl.s.tut;
    t.step++;
    if (t.step >= STEPS.length) { this.finish(); return; }
    audio.sfx('coin', 0.4);
    this.tick();
  }

  clearGlow() { document.querySelectorAll('.coach-glow').forEach((e) => e.classList.remove('coach-glow')); }

  tick() {
    const c = this.ctl;
    if (window.__auto || c.disabled && !c.city) { this.el.style.display = 'none'; return; }
    if (!this.on) { this.el.style.display = 'none'; this.clearGlow(); return; }
    const t = c.s.tut, st = STEPS[t.step];
    if (t.step !== this.lastStep) {
      this.lastStep = t.step;
      this.t = {};
      st.enter?.(c, this.t);
      this.el.innerHTML = `<span class="ic">${ICONS[st.icon] || ICONS.eagle}</span><div class="cb"><small>Step ${t.step + 1} of ${STEPS.length}</small><h3>${st.title}</h3><p>${st.text}</p>
        <div class="ca">${st.next ? `<button class="cn" data-tut="next">${st.next}</button>` : '<span class="cw">Waiting for you…</span>'}<button class="cs" data-tut="skip">Skip tutorial</button></div></div>`;
      this.el.classList.remove('pop'); void this.el.offsetWidth; this.el.classList.add('pop');
    }
    this.el.style.display = document.querySelector('.modal-wrap') ? 'none' : '';
    this.el.classList.toggle('incity', !!c.city);
    this.clearGlow();
    for (const q of st.glow?.() || []) { const e = document.querySelector(q); if (e && e.offsetParent !== null) { e.classList.add('coach-glow'); break; } }
    if (st.done && st.done(c, this.t)) this.advance();
  }

  destroy() { clearInterval(this.timer); this.clearGlow(); this.el.remove(); }
}
