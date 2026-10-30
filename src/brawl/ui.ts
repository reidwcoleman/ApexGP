import * as THREE from 'three';
import { COLORS, COLOR_NAMES, type Game, type Seat } from './game.ts';
import { HATS } from './look.ts';
import { ARENAS } from './arenas/index.ts';
import type { ArenaDef } from './arena.ts';
import { HEAD } from './fighter.ts';

/**
 * Every screen over the 3D view: the title, the lobby (join with any device, pick a colour and a
 * hat, add CPUs, pick the arena), the fight HUD (scores, name tags, callouts, the countdown, round
 * results) and the pause menu. Driven by the same devices as the fighters.
 */

const HAT_NAMES: Record<string, string> = {
  party: 'Party hat', crown: 'Crown', beanie: 'Beanie', chef: 'Chef', propeller: 'Propeller', cone: 'Traffic cone', tophat: 'Top hat',
  daisy: 'Daisy', sunhat: 'Sun hat', viking: 'Horns', phones: 'Headphones', bucket: 'Bucket hat', sailor: 'Sailor',
};
const LEVELS = ['Easy', 'Normal', 'Hard'];

type Screen = 'title' | 'lobby' | 'game' | 'pause' | 'help';

export class Ui {
  private screen: Screen = 'title';
  private el: HTMLElement;
  private title!: HTMLElement;
  private lobbyEl!: HTMLElement;
  private hudEl!: HTMLElement;
  private pauseEl!: HTMLElement;
  private helpEl!: HTMLElement;
  private tags = new Map<number, HTMLElement>();
  private feed!: HTMLElement;
  private big!: HTMLElement;
  private banner!: HTMLElement;
  private board!: HTMLElement;
  private veil!: HTMLElement;
  private lobby: Seat[] = [];
  private arenaIdx = 0;
  private rounds = 3;
  private lastCount = -1;
  private hintT = 0;

  constructor(readonly g: Game, root: HTMLElement) {
    this.el = root;
    root.innerHTML = '';
    this.title = this.div('pp-title', root);
    this.title.innerHTML = `
      <div class="pp-logo"><span class="a">PLUSH</span><span class="b">PANIC</span></div>
      <div class="pp-tag">Wobbly plush brawling for 1–8 players</div>
      <div class="pp-menu">
        <button class="pp-btn pp-primary" data-act="play">Play</button>
        <button class="pp-btn" data-act="help">How to play</button>
        <a class="pp-btn pp-ghost" href="./index.html?pick">Back to ApexGP</a>
      </div>
      <div class="pp-press">Press <b>Space</b> or <b>A</b> to start</div>`;
    this.lobbyEl = this.div('pp-lobby', root);
    this.hudEl = this.div('pp-hud', root);
    this.board = this.div('pp-board', this.hudEl);
    this.feed = this.div('pp-feed', this.hudEl);
    this.big = this.div('pp-big', this.hudEl);
    this.banner = this.div('pp-banner', this.hudEl);
    this.pauseEl = this.div('pp-pause', root);
    this.pauseEl.innerHTML = `<div class="pp-card"><h2>Paused</h2><button class="pp-btn pp-primary" data-act="resume">Resume</button><button class="pp-btn" data-act="quit">Quit to menu</button></div>`;
    this.helpEl = this.div('pp-help', root);
    this.helpEl.innerHTML = `<div class="pp-card pp-wide"><h2>How to play</h2>
      <p class="pp-lead">Knock everyone else off the arena. Last plush standing wins the round.</p>
      <div class="pp-cols">
        <div><h3>Keyboard</h3><table>
          <tr><td>Move</td><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td></tr>
          <tr><td>Run</td><td><kbd>Shift</kbd></td></tr>
          <tr><td>Jump / climb</td><td><kbd>Space</kbd></td></tr>
          <tr><td>Punch</td><td><kbd>J</kbd></td></tr>
          <tr><td>Grab (both hands)</td><td><kbd>K</kbd> or mouse buttons</td></tr>
          <tr><td>Lift / raise arms</td><td><kbd>I</kbd></td></tr>
          <tr><td>Kick</td><td><kbd>L</kbd></td></tr></table>
          <p class="pp-small">Second keyboard player: arrows, <kbd>.</kbd> punch, <kbd>,</kbd> grab, <kbd>;</kbd> lift, <kbd>'</kbd> kick, <kbd>/</kbd> jump.</p></div>
        <div><h3>Controller</h3><table>
          <tr><td>Move</td><td>Left stick</td></tr>
          <tr><td>Run</td><td>L1 / LB or stick click</td></tr>
          <tr><td>Jump / climb</td><td>Cross / A</td></tr>
          <tr><td>Punch</td><td>Square / X</td></tr>
          <tr><td>Grab left / right</td><td>L2 / R2</td></tr>
          <tr><td>Lift</td><td>Triangle / Y or R1</td></tr>
          <tr><td>Kick</td><td>Circle / B</td></tr></table></div>
      </div>
      <ul class="pp-tips"><li>Punch heads to daze. Enough hits and they go limp: then grab, lift and throw.</li>
      <li>Grab a ledge to hang on, jump to climb back up.</li><li>Grabbed? Mash any button to wriggle free.</li></ul>
      <button class="pp-btn pp-primary" data-act="helpback">Got it</button></div>`;
    this.veil = this.div('pp-veil', root);
    root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      this.g.sound.click();
      this.act(t.dataset.act!, t.dataset.arg);
    });
    this.showTitle();
  }

  private div(cls: string, parent: HTMLElement) {
    const d = document.createElement('div');
    d.className = cls;
    parent.appendChild(d);
    return d;
  }

  private show(s: Screen) {
    this.screen = s;
    this.title.classList.toggle('on', s === 'title');
    this.lobbyEl.classList.toggle('on', s === 'lobby');
    this.hudEl.classList.toggle('on', s === 'game' || s === 'pause');
    this.pauseEl.classList.toggle('on', s === 'pause');
    this.helpEl.classList.toggle('on', s === 'help');
    for (const t of this.tags.values()) t.style.display = s === 'game' || s === 'pause' ? '' : 'none';
  }

  showTitle() {
    this.show('title');
    this.banner.className = 'pp-banner';
    this.big.textContent = '';
  }

  private act(a: string, arg?: string) {
    switch (a) {
      case 'play':
        return this.openLobby();
      case 'help':
        return this.show('help');
      case 'helpback':
        return this.show('title');
      case 'resume':
        this.g.paused = false;
        return this.show('game');
      case 'quit':
        this.g.paused = false;
        this.g.backToMenu();
        return;
      case 'addcpu':
        return this.addCpu();
      case 'delcpu':
        return this.delCpu();
      case 'level': {
        const s = this.lobby[Number(arg)];
        if (s) s.level = (s.level + 1) % 3;
        return this.drawLobby();
      }
      case 'arena':
        this.arenaIdx = Number(arg);
        return this.drawLobby();
      case 'rounds':
        this.rounds = this.rounds === 3 ? 5 : this.rounds === 5 ? 1 : 3;
        return this.drawLobby();
      case 'start':
        return this.start();
      case 'lobbyback':
        return this.showTitle();
    }
  }

  // ------------------------------------------------------------------ lobby

  private openLobby() {
    this.show('lobby');
    if (!this.lobby.length) {
      // whoever opened it is in; the keyboard by default
      const dev = this.g.input.lastKind === 'pad' ? this.g.input.list().find((d) => d.kind === 'pad')?.id ?? 'kb1' : 'kb1';
      this.join(dev);
      this.addCpu();
      this.addCpu();
      this.addCpu();
    }
    this.drawLobby();
  }

  private freeColor() {
    const used = new Set(this.lobby.map((s) => s.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[0];
  }

  private join(dev: string) {
    if (this.lobby.some((s) => s.dev === dev) || this.lobby.length >= 8 && !this.lobby.some((s) => s.cpu)) return;
    if (this.lobby.length >= 8) this.lobby.splice(this.lobby.findIndex((s) => s.cpu), 1);
    const humans = this.lobby.filter((s) => !s.cpu).length;
    const seat: Seat = { id: 0, dev, cpu: false, name: 'P' + (humans + 1), color: this.freeColor(), hat: HATS[(humans * 3) % HATS.length], level: 1, wins: 0 };
    // humans first
    this.lobby.splice(humans, 0, seat);
    this.g.sound.join(humans);
    this.drawLobby();
  }

  private addCpu() {
    if (this.lobby.length >= 8) return;
    const [s] = this.g.cpuSeats(1, this.lobby);
    s.color = this.freeColor();
    while (this.lobby.some((o) => o.name === s.name)) s.name = s.name + '!';
    s.hat = HATS[(this.lobby.length * 5 + 2) % HATS.length];
    this.lobby.push(s);
    this.drawLobby();
  }

  private delCpu() {
    for (let i = this.lobby.length - 1; i >= 0; i--) if (this.lobby[i].cpu) {
      this.lobby.splice(i, 1);
      break;
    }
    this.drawLobby();
  }

  private drawLobby() {
    const cards = this.lobby
      .map((s, i) => {
        const dev = s.cpu ? `<button class="pp-chip" data-act="level" data-arg="${i}">CPU · ${LEVELS[s.level]}</button>` : `<span class="pp-chip pp-you">${this.g.input.get(s.dev!)?.label ?? 'Player'}</span>`;
        const cn = COLOR_NAMES[COLORS.indexOf(s.color)] ?? '';
        return `<div class="pp-seat ${s.cpu ? 'cpu' : 'human'}" style="--c:#${new THREE.Color(s.color).getHexString()}">
          <div class="pp-plush"><i></i><b></b></div>
          <div class="pp-name">${s.name}</div>
          <div class="pp-sub">${cn} · ${HAT_NAMES[s.hat] ?? s.hat}</div>${dev}</div>`;
      })
      .join('');
    const empty = Array.from({ length: Math.max(0, 8 - this.lobby.length) }, () => `<div class="pp-seat open"><div class="pp-join">Press a button<br>to join</div></div>`).join('');
    const arenas = [...ARENAS.map((a) => ({ id: a.id, name: a.name, blurb: a.blurb })), { id: 'shuffle', name: 'Shuffle', blurb: 'A different arena every round.' }]
      .map((a, i) => `<button class="pp-arena ${i === this.arenaIdx ? 'on' : ''}" data-act="arena" data-arg="${i}" style="--art:url(${this.g.base}brawl/thumb_${a.id}.webp)"><b>${a.name}</b><i>${a.blurb}</i></button>`)
      .join('');
    const n = this.lobby.length;
    this.lobbyEl.innerHTML = `
      <div class="pp-lhead"><button class="pp-btn pp-ghost pp-sm" data-act="lobbyback">Back</button><h2>Who's playing?</h2>
        <div class="pp-lhint">Controllers and the second keyboard join with any button. <b>Left / right</b> changes your hat, <b>up / down</b> your colour.</div></div>
      <div class="pp-seats">${cards}${empty}</div>
      <div class="pp-lrow">
        <div class="pp-cpu"><button class="pp-btn pp-sm" data-act="delcpu">− CPU</button><button class="pp-btn pp-sm" data-act="addcpu">+ CPU</button></div>
        <button class="pp-btn pp-sm" data-act="rounds">First to ${this.rounds}</button>
      </div>
      <div class="pp-arenas">${arenas}</div>
      <div class="pp-lfoot"><button class="pp-btn pp-primary pp-go" data-act="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Need 2 fighters' : 'Start brawl'}</button><span class="pp-keys"><kbd>Q</kbd><kbd>E</kbd> arena · <kbd>B</kbd><kbd>N</kbd> CPUs · <kbd>Enter</kbd> start</span></div>`;
  }

  private start() {
    if (this.lobby.length < 2) return;
    const list = [...ARENAS.map((a) => a.id), 'shuffle'];
    this.show('game');
    this.makeTags(this.lobby.length);
    void this.g.startMatch(this.lobby.map((s) => ({ ...s })), list[this.arenaIdx], this.rounds);
  }

  private lobbyInput() {
    const inp = this.g.input;
    for (const d of inp.list()) {
      const seat = this.lobby.find((s) => s.dev === d.id);
      if (!seat) {
        if (d.pressed('any') || d.pressed('confirm')) {
          if (d.id === 'kb1' && d.pressed('confirm') && this.lobby.some((s) => s.dev === 'kb1')) continue;
          this.join(d.id);
        }
        continue;
      }
      let ch = false;
      if (d.pressed('left') || d.pressed('right')) {
        const k = HATS.indexOf(seat.hat);
        seat.hat = HATS[(k + (d.pressed('right') ? 1 : HATS.length - 1)) % HATS.length];
        ch = true;
      }
      if (d.pressed('up') || d.pressed('down')) {
        const used = new Set(this.lobby.filter((s) => s !== seat).map((s) => s.color));
        let k = COLORS.indexOf(seat.color);
        for (let i = 0; i < COLORS.length; i++) {
          k = (k + (d.pressed('down') ? 1 : COLORS.length - 1)) % COLORS.length;
          if (!used.has(COLORS[k])) break;
        }
        seat.color = COLORS[k];
        ch = true;
      }
      if (d.id !== 'kb1' && d.pressed('back')) {
        this.lobby.splice(this.lobby.indexOf(seat), 1);
        ch = true;
      }
      if (d.pressed('prev')) {
        this.arenaIdx = (this.arenaIdx + ARENAS.length) % (ARENAS.length + 1);
        ch = true;
      }
      if (d.pressed('next')) {
        this.arenaIdx = (this.arenaIdx + 1) % (ARENAS.length + 1);
        ch = true;
      }
      if (d.pressed('start') || (d.kind === 'pad' && d.pressed('start'))) this.start();
      if (ch) {
        this.g.sound.click();
        this.drawLobby();
      }
    }
    if (this.edge('KeyB')) this.addCpu();
    if (this.edge('KeyN')) this.delCpu();
    if (this.edge('Escape')) this.showTitle();
  }
  private prevKeys = new Set<string>();
  private edge(code: string) {
    return this.g.input.key(code) && !this.prevKeys.has(code);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number) {
    const inp = this.g.input;
    if (this.screen === 'title') {
      for (const d of inp.list()) if (d.pressed('confirm') || d.pressed('start')) {
        this.g.sound.click();
        this.openLobby();
        break;
      }
    } else if (this.screen === 'lobby') this.lobbyInput();
    else if (this.screen === 'help') {
      for (const d of inp.list()) if (d.pressed('back') || d.pressed('confirm')) this.show('title');
    } else if (this.screen === 'game' || this.screen === 'pause') {
      for (const d of inp.list()) {
        if (d.pressed('start') || (d.id === 'kb1' && this.edge('Escape'))) {
          if (this.g.state === 'loading') continue;
          this.g.paused = !this.g.paused;
          this.show(this.g.paused ? 'pause' : 'game');
          break;
        }
      }
      if (this.g.state === 'matchEnd' && this.g.stateT > 3) {
        for (const d of inp.list()) if (d.pressed('confirm') || d.pressed('start')) {
          this.g.backToMenu();
          break;
        }
      }
    }
    this.prevKeys = inp.active();
    this.hintT += dt;
  }

  private makeTags(n: number) {
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
    for (let i = 0; i < n; i++) this.tags.set(i, this.div('pp-nametag', this.hudEl));
  }

  hud(_dt: number) {
    if (this.screen !== 'game' && this.screen !== 'pause') return;
    const g = this.g;
    const cam = g.camera;
    const w = innerWidth, h = innerHeight;
    const v = new THREE.Vector3();
    g.fighters.forEach((f, i) => {
      const t = this.tags.get(i);
      if (!t) return;
      if (!f.alive || f.out) {
        t.style.opacity = '0';
        return;
      }
      v.copy(f.pos[HEAD]).add(new THREE.Vector3(0, 0.75, 0)).project(cam);
      if (v.z > 1) {
        t.style.opacity = '0';
        return;
      }
      t.style.opacity = '1';
      t.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      const seat = g.seats[i];
      const txt = seat?.name ?? f.name;
      if (t.dataset.txt !== txt || t.dataset.c !== String(f.color)) {
        t.dataset.txt = txt;
        t.dataset.c = String(f.color);
        t.textContent = txt;
        t.style.setProperty('--c', '#' + new THREE.Color(f.color).getHexString());
        t.classList.toggle('cpu', !!seat?.cpu);
      }
      t.classList.toggle('ko', f.ko > 0);
      t.style.setProperty('--d', String(Math.min(1, f.daze / 100)));
    });
    // scoreboard
    const key = g.seats.map((s) => s.wins + ':' + s.color).join(',') + g.fighters.map((f) => (f.out ? 1 : 0)).join('') + g.roundsToWin;
    if (this.board.dataset.k !== key) {
      this.board.dataset.k = key;
      this.board.innerHTML = g.seats
        .map((s, i) => {
          const f = g.fighters[i];
          const pips = Array.from({ length: g.roundsToWin }, (_, k) => `<i class="${k < s.wins ? 'on' : ''}"></i>`).join('');
          return `<div class="pp-score ${f && (f.out || !f.alive) ? 'out' : ''}" style="--c:#${new THREE.Color(s.color).getHexString()}"><b>${s.name}</b><span>${pips}</span></div>`;
        })
        .join('');
    }
  }

  // ------------------------------------------------------------------ events from the game

  callout(text: string, color: number) {
    const d = document.createElement('div');
    d.className = 'pp-call';
    d.style.setProperty('--c', '#' + new THREE.Color(color).getHexString());
    d.textContent = text;
    this.feed.prepend(d);
    setTimeout(() => d.classList.add('gone'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (this.feed.children.length > 4) this.feed.lastChild?.remove();
  }

  countdown(n: number) {
    if (n === this.lastCount) return;
    this.lastCount = n;
    if (n > 0) {
      this.flash(String(n), 'count');
      this.g.sound.countdown(false);
    } else {
      this.flash('BRAWL!', 'go');
      this.g.sound.countdown(true);
      this.g.sound.bell();
    }
  }

  private flash(text: string, cls: string) {
    this.big.className = 'pp-big';
    void this.big.offsetWidth;
    this.big.textContent = text;
    this.big.className = 'pp-big show ' + cls;
  }

  roundIntro(round: number, def: ArenaDef) {
    this.lastCount = -1;
    this.banner.className = 'pp-banner';
    this.banner.innerHTML = `<small>Round ${round}</small><b>${def.name}</b>`;
    void this.banner.offsetWidth;
    this.banner.className = 'pp-banner intro';
    setTimeout(() => {
      if (this.banner.classList.contains('intro')) this.banner.className = 'pp-banner';
    }, 2600);
  }

  roundResult(seat: Seat | null, seats: Seat[], done: boolean) {
    const c = seat ? '#' + new THREE.Color(seat.color).getHexString() : '#ffffff';
    if (done && seat) {
      const order = seats.slice().sort((a, b) => b.wins - a.wins);
      this.banner.innerHTML = `<small>Champion</small><b style="--c:${c}">${seat.name} wins!</b>
        <div class="pp-podium">${order.map((s, i) => `<div style="--c:#${new THREE.Color(s.color).getHexString()}"><em>${i + 1}</em>${s.name}<span>${s.wins}</span></div>`).join('')}</div>
        <div class="pp-press">Press <b>Space</b> or <b>A</b> for the menu</div>`;
      this.banner.className = 'pp-banner result final';
    } else {
      this.banner.innerHTML = seat ? `<small>Round winner</small><b style="--c:${c}">${seat.name}</b>` : `<small>Nobody left</small><b>Draw!</b>`;
      this.banner.className = 'pp-banner result';
      setTimeout(() => {
        if (this.banner.classList.contains('result') && !this.banner.classList.contains('final')) this.banner.className = 'pp-banner';
      }, 3600);
    }
  }

  loading(on: boolean, name = '') {
    this.veil.classList.toggle('on', on);
    this.veil.textContent = on ? name : '';
  }
}
