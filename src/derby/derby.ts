import * as THREE from 'three';
import { Bot } from '../marbles/ai.ts';
import { courseAI } from '../marbles/ai-course.ts';
import { STYLES } from '../marbles/ai-style.ts';
import { Sound } from '../marbles/audio.ts';
import { Caustics } from '../marbles/fx-caustics.ts';
import { Marble, RADIUS } from '../marbles/physics.ts';
import { DESIGNS, marbleMaterial } from '../marbles/shaders.ts';
import { BAILOUT, BETA, FIELD, fmtPrice, loadPurse, price, probs, recOf, savePurse, STABLE, stars, type Probs, type Purse, type Runner } from './book.ts';
import { KEY, NightStage } from './night.ts';
import { buildTrack, neonAt, TRACKS, type Built } from './tracks.ts';
import { DerbyUI, type BetView, type CardRow, type LiveRow } from './ui.ts';

/**
 * Marble Derby: bet on the race, then watch it. A race card of eight runners from the stable with
 * their prices (to win, or to finish in the first three); you put chips on as many as you like, and
 * the race is run by the bots with a broadcast director cutting between cameras (or the camera on
 * your pick). The first three across the line settle the book. Your purse is kept in this browser.
 */

type State = 'lobby' | 'countdown' | 'race' | 'finish' | 'payout';
type Kind = 'win' | 'top3';

export interface Bet {
  id: number;
  runner: number;
  kind: Kind;
  stake: number;
  price: number;
}

interface Entry {
  r: Runner;
  /** the number on the race card (1..8) */
  no: number;
  m: Marble;
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  bot: Bot;
  hint: number;
  s: number;
  cp: number;
  fin: number;
  finT: number;
  fell: number;
  hold: number;
}

type Shot = 'gate' | 'chase' | 'side' | 'heli' | 'fixed' | 'finish' | 'follow';

const UP = new THREE.Vector3(0, 1, 0);
const RACE_T = 120;

export class Derby {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
  readonly sound = new Sound();
  private stage!: NightStage;
  private ui: DerbyUI;
  private purse: Purse = loadPurse();
  private built: Built | null = null;
  private field: Entry[] = [];
  private p: Probs = { win: [], top3: [] };
  private prices: { win: number[]; top3: number[] } = { win: [], top3: [] };
  private bets: Bet[] = [];
  private betId = 0;
  private stake = 50;
  private state: State = 'lobby';
  private stateT = 0;
  private raceT = 0;
  private finCount = 0;
  private finishAt = 0;
  private last = performance.now();
  private geo = new THREE.SphereGeometry(RADIUS, 48, 32);
  private caustics = new Caustics(16);
  private camLook = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  private slowUntil = 0;
  // the director
  private shot: Shot = 'gate';
  private shotT = 0;
  private shotLen = 6;
  private follow: Entry | null = null;
  private fixedAt = new THREE.Vector3();
  private fixedS = 0;
  private feature = -1;
  // the commentary
  private leader: Entry | null = null;
  private saidT = 0;
  private said = new Set<string>();
  private screenT = 0;
  private quality = 1;
  private fpsAcc = 0;
  private fpsN = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    root: HTMLElement,
  ) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.ui = new DerbyUI(root, {
      onChip: (v) => {
        this.stake = v;
        this.sound.start();
        this.sound.click();
        this.refreshCard();
      },
      onBet: (i, k) => this.placeBet(i, k),
      onUnbet: (id) => this.unbet(id),
      onClear: () => {
        for (const b of [...this.bets]) this.unbet(b.id);
      },
      onStart: () => this.startRace(),
      onHover: (i) => {
        this.feature = i;
      },
      onFollow: (i) => this.followNo(i),
      onNext: () => void this.nextRace(),
      onBailout: () => this.bailout(),
      onSound: () => {
        this.sound.start();
        this.sound.musicOn = !this.sound.musicOn;
        this.sound.setMusic(this.state === 'race' ? 'play' : this.state === 'lobby' ? 'menu' : 'calm');
        return this.sound.musicOn;
      },
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointerdown', () => this.sound.start());
    window.addEventListener('keydown', (e) => {
      this.sound.start();
      if (this.state === 'race' || this.state === 'finish') {
        const n = Number(e.key);
        if (n >= 1 && n <= FIELD) this.followNo(n - 1);
        if (e.key === '0' || e.code === 'Escape') this.followNo(-1);
        if (e.code === 'KeyC') this.cut(true);
      }
    });
  }

  async boot(progress: (f: number, s: string) => void) {
    const q = new URLSearchParams(location.search);
    // (?race=N: that race's card, for tests; not saved unless a race is run)
    if (q.get('race')) this.purse.race = Number(q.get('race'));
    progress(0.1, 'Switching on the floodlights');
    this.stage = new NightStage(this.renderer, this.scene, this.camera);
    this.scene.add(this.caustics.mesh);
    this.stage.fireworks.onBurst = (p) => this.sound.boom(p.x, p.y, p.z);
    this.resize();
    progress(0.35, 'Lacquering the boards');
    await this.loadRace();
    progress(0.75, 'Warming up the runners');
    await this.renderer.compileAsync(this.scene, this.camera);
    progress(1, 'Under orders');
    // (test hooks: ?go=1 starts the race at once, ?bet=N puts 100 on runner N to win)
    for (const n of (q.get('bet') ?? '').split(',').filter(Boolean)) this.placeBet(Number(n) - 1, 'win', 100);
    if (q.get('go') === '1') this.startRace();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.stage?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------------------------- the card
  private trackOf(race: number) {
    return TRACKS[race % TRACKS.length];
  }

  /** this race's track and field (the same for the same race number: a reload shows the same card) */
  private async loadRace() {
    const race = this.purse.race;
    if (this.built) {
      this.scene.remove(this.built.course.b.group);
      disposeGroup(this.built.course.b.group);
    }
    for (const e of this.field) {
      this.scene.remove(e.mesh);
      e.mat.dispose();
    }
    this.field = [];
    this.bets = [];
    this.follow = null;
    this.said.clear();
    const track = this.trackOf(race);
    const b = (this.built = buildTrack(track.id));
    const c = b.course;
    courseAI(c);
    this.scene.add(c.b.group);
    this.stage.setCourse(c.lakeY, b.center, b.radius);
    // the field: eight from the stable, drawn by the race number
    let seed = race * 7919 + 13;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pool = [...STABLE];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const runners = pool.slice(0, FIELD);
    const grid = c.grid(FIELD);
    runners.forEach((r, k) => {
      const m = new Marble(k);
      m.pos.copy(grid[k].pos);
      m.quat.setFromAxisAngle(new THREE.Vector3(rnd(), rnd(), rnd()).normalize(), rnd() * 6);
      m.frozen = true;
      c.b.world.marbles.push(m);
      const mat = marbleMaterial(DESIGNS[r.design], r.id * 1.7);
      // (what lies under a marble here: dark red lacquer, not maple)
      (mat.userData.u as { uGround: { value: THREE.Color } }).uGround.value.setRGB(0.22, 0.05, 0.03);
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      // form on the night: a little above or below its best. (The card's ability, 0.62–0.98, is
      // spread over most of the bots' range: the best are near flawless, the worst wobble and fall,
      // so a rating means something against the luck of the course.)
      const day = (rnd() - 0.5) * 0.07;
      const ability = THREE.MathUtils.clamp(0.3 + ((r.skill + day - 0.6) / 0.38) * 0.7, 0.25, 1);
      const bot = new Bot(m, ability, r.id * 31 + race * 7, STYLES[r.style], 0);
      const e: Entry = { r, no: k + 1, m, mesh, mat, bot, hint: 0, s: 0, cp: c.checkpoints[0], fin: 0, finT: 0, fell: 0, hold: 0 };
      e.hint = c.path!.projectAll(m.pos).i;
      e.s = c.path!.projectAll(m.pos).s;
      bot.reset(e.hint);
      this.field.push(e);
    });
    // the prices
    this.p = probs(runners.map((r) => r.skill), BETA[track.id] ?? 7);
    this.prices = { win: this.p.win.map(price), top3: this.p.top3.map(price) };
    this.state = 'lobby';
    this.stateT = 0;
    this.raceT = 0;
    this.finCount = 0;
    this.shot = 'gate';
    this.stage.cut();
    this.ui.hideResults();
    this.ui.hud(false);
    this.ui.lobby(true);
    this.refreshCard();
    this.drawScreen();
    this.sound.setMusic('menu');
    await new Promise((r) => setTimeout(r, 0));
  }

  private refreshCard() {
    const track = this.trackOf(this.purse.race);
    const rows: CardRow[] = this.field.map((e, i) => {
      const rec = recOf(this.purse, e.r.id);
      return {
        no: e.no,
        name: e.r.name,
        color: DESIGNS[e.r.design].a,
        color2: DESIGNS[e.r.design].b,
        style: STYLES[e.r.style].name,
        stars: stars(e.r.skill),
        form: rec.form.length ? rec.form.map((x) => (x > 8 ? '-' : String(x))).join('') : 'new',
        record: `${rec.wins}/${rec.races}`,
        win: fmtPrice(this.prices.win[i]),
        top3: fmtPrice(this.prices.top3[i]),
        mine: this.bets.filter((b) => b.runner === i).map((b) => ({ kind: b.kind, stake: b.stake })),
      };
    });
    const bets: BetView[] = this.bets.map((b) => ({ id: b.id, no: this.field[b.runner].no, name: this.field[b.runner].r.name, color: DESIGNS[this.field[b.runner].r.design].a, kind: b.kind, stake: b.stake, price: fmtPrice(b.price), ret: Math.round(b.stake * b.price) }));
    this.ui.card({
      race: this.purse.race + 1,
      track: track.name,
      blurb: track.blurb,
      coins: this.purse.coins,
      stake: this.stake,
      rows,
      bets,
      broke: this.purse.coins < 10 && this.bets.length === 0,
    });
  }

  private placeBet(i: number, kind: Kind, stake = this.stake) {
    if (this.state !== 'lobby' || !this.field[i]) return;
    this.sound.start();
    const amt = Math.min(stake, this.purse.coins);
    if (amt < 1) {
      this.ui.toast('Not enough coins');
      return;
    }
    // (the same bet again: more on it)
    const same = this.bets.find((b) => b.runner === i && b.kind === kind);
    if (same) same.stake += amt;
    else this.bets.push({ id: ++this.betId, runner: i, kind, stake: amt, price: kind === 'win' ? this.prices.win[i] : this.prices.top3[i] });
    this.purse.coins -= amt;
    savePurse(this.purse);
    this.sound.chip();
    this.refreshCard();
  }

  private unbet(id: number) {
    const k = this.bets.findIndex((b) => b.id === id);
    if (k < 0 || this.state !== 'lobby') return;
    this.purse.coins += this.bets[k].stake;
    this.bets.splice(k, 1);
    savePurse(this.purse);
    this.sound.click();
    this.refreshCard();
  }

  private bailout() {
    if (this.purse.coins >= 10) return;
    this.purse.coins += BAILOUT;
    this.purse.bailouts++;
    savePurse(this.purse);
    this.sound.coins(8);
    this.ui.toast(`The house spots you ${BAILOUT} coins`);
    this.refreshCard();
  }

  // ------------------------------------------------------------------------------------- the race
  private startRace() {
    if (this.state !== 'lobby') return;
    this.sound.start();
    this.ui.lobby(false);
    this.ui.hud(true);
    this.state = 'countdown';
    this.stateT = 0;
    this.lastCount = 0;
    this.shot = 'gate';
    this.stage.cut();
    this.sound.setMusic('calm');
    // the call to the post
    this.sound.notes([67, 72, 76, 79, 76, 79, 84], 0.13, 0.5, true);
    this.ui.caption('They’re under starter’s orders…');
  }
  private lastCount = 0;

  private go() {
    const c = this.built!.course;
    c.state.go = c.b.world.time;
    for (const e of this.field) e.m.frozen = false;
    this.state = 'race';
    this.stateT = 0;
    this.raceT = 0;
    this.ui.count('GO!');
    this.sound.countdown(0);
    this.sound.setMusic('play');
    this.ui.caption('And they’re off!');
    this.cut(true);
  }

  private followNo(i: number) {
    this.follow = i >= 0 && this.field[i] ? (this.follow === this.field[i] ? null : this.field[i]) : null;
    this.shot = this.follow ? 'follow' : 'chase';
    this.shotT = 0;
    this.stage.cut();
  }

  /** the race's rules: progress, falls and respawns, the line */
  private rules(dt: number) {
    const c = this.built!.course;
    const w = c.b.world;
    const path = c.path!;
    for (const e of this.field) {
      const m = e.m;
      if (e.fin) continue;
      if (e.fell) {
        if (w.time - e.fell > 1.2) this.respawn(e);
        continue;
      }
      if (e.hold > 0) {
        e.hold -= dt;
        if (e.hold <= 0) m.frozen = false;
      }
      const pr = path.project(m.pos, e.hint, 40);
      if (pr.d < 9) {
        e.hint = pr.i;
        e.s = Math.max(e.s, Math.min(pr.s, e.s + 30));
      }
      if (m.pos.y < c.killY || pr.h < -9) {
        e.fell = w.time;
        const at = m.pos.clone();
        const fallT = Math.sqrt(Math.max(0, (2 * (m.pos.y - c.lakeY)) / 24));
        window.setTimeout(() => {
          this.stage.fireworks.spray(new THREE.Vector3(at.x + m.vel.x * 0.3, c.lakeY + 0.2, at.z + m.vel.z * 0.3));
          this.sound.splash(at.x, c.lakeY, at.z);
        }, Math.min(1500, fallT * 900));
        this.say(`fall${e.no}${Math.floor(this.raceT / 10)}`, `${e.r.name} is over the edge!`, 1);
        if (this.bets.some((b) => b.runner === this.field.indexOf(e))) this.sound.ooh();
        continue;
      }
      for (const cp of c.checkpoints) if (pr.s > cp + 1 && cp > e.cp && m.grounded && pr.d < 6) e.cp = cp;
      if (pr.s >= c.finishS && pr.d < 8 && (this.state === 'race' || this.state === 'finish')) {
        e.fin = ++this.finCount;
        e.finT = this.raceT;
        this.crossed(e);
      }
    }
    if (this.state === 'race' && this.raceT > RACE_T) this.toFinish();
    if (this.state === 'finish') {
      const all = this.field.every((e) => e.fin);
      if (all || (this.finCount >= 3 && this.raceT - this.finishAt > 9) || this.raceT > RACE_T + 10) this.toPayout();
    }
  }

  private crossed(e: Entry) {
    const c = this.built!.course;
    const at = c.path!.at(c.finishS, 0, 3);
    const mine = this.bets.some((b) => b.runner === this.field.indexOf(e));
    if (e.fin === 1) {
      this.toFinish();
      // a photo finish?
      const second = [...this.field].filter((x) => !x.fin).sort((a, b) => b.s - a.s)[0];
      const close = second && c.finishS - second.s < 1.6;
      this.ui.banner(`${e.r.name.toUpperCase()} WINS`, close ? 'by a whisker!' : `No. ${e.no}`, DESIGNS[e.r.design].a);
      this.ui.caption(close ? `Photo finish! ${e.r.name} just holds off ${second.r.name}!` : `${e.r.name} wins it!`);
      this.slowUntil = performance.now() + 1600;
      this.sound.crowned();
      this.salvo(7, 0);
    } else if (e.fin <= 3) {
      this.ui.caption(`${e.r.name} ${e.fin === 2 ? 'second' : 'third'}`);
      this.sound.notes([79 + e.fin], 0, 0.25, true);
    }
    if (mine) this.sound.notes([84, 88], 0.08, 0.3, true);
    void at;
  }

  /** fireworks over the stand: `n` shells, from `delay` ms */
  private salvo(n: number, delay: number) {
    const b = this.built!;
    const path = b.course.path!;
    const fs = b.course.finishS;
    for (let k = 0; k < n; k++)
      setTimeout(() => {
        const at = path.at(fs - 10 - Math.random() * 30, b.standSide * (16 + Math.random() * 14), -12);
        this.stage.fireworks.launch(at, 22 + Math.random() * 22);
      }, delay + k * 240 + Math.random() * 120);
  }

  private toFinish() {
    if (this.state !== 'race') return;
    this.state = 'finish';
    this.stateT = 0;
    this.finishAt = this.raceT;
    this.shot = 'finish';
    this.shotT = 0;
  }

  private respawn(e: Entry) {
    const c = this.built!.course;
    const path = c.path!;
    e.fell = 0;
    const i = path.index(e.cp);
    const half = path.sec[i].w / 2 - 1.2;
    e.m.pos.copy(path.at(e.cp, THREE.MathUtils.clamp((Math.random() - 0.5) * 4, -half, half), 0.55));
    e.m.vel.copy(path.T[i]).multiplyScalar(3);
    e.m.ang.set(0, 0, 0);
    e.hint = i;
    e.s = e.cp;
    e.hold = 0.35;
    e.m.frozen = true;
    e.bot.reset(i);
  }

  private ranked() {
    return [...this.field].sort((a, b) => {
      if (a.fin && b.fin) return a.fin - b.fin;
      if (a.fin) return -1;
      if (b.fin) return 1;
      return b.s - a.s;
    });
  }

  /** settles the book */
  private toPayout() {
    this.state = 'payout';
    this.stateT = 0;
    const order = this.ranked();
    // (anyone not home yet is placed by how far it got)
    order.forEach((e, k) => {
      if (!e.fin) e.fin = 100 + k;
    });
    const place = (e: Entry) => order.indexOf(e) + 1;
    let ret = 0, staked = 0;
    const lines = this.bets.map((b) => {
      const e = this.field[b.runner];
      const pl = place(e);
      const won = b.kind === 'win' ? pl === 1 : pl <= 3;
      const pay = won ? Math.round(b.stake * b.price) : 0;
      ret += pay;
      staked += b.stake;
      return { no: e.no, name: e.r.name, color: DESIGNS[e.r.design].a, kind: b.kind, stake: b.stake, price: fmtPrice(b.price), place: pl, pay };
    });
    const before = this.purse.coins;
    this.purse.coins += ret;
    this.purse.staked += staked;
    this.purse.won += ret;
    this.purse.best = Math.max(this.purse.best, ret);
    for (const e of this.field) {
      const rec = recOf(this.purse, e.r.id);
      const pl = place(e);
      rec.races++;
      if (pl === 1) rec.wins++;
      if (pl <= 3) rec.top3++;
      rec.form = [...rec.form, pl].slice(-5);
    }
    this.purse.race++;
    savePurse(this.purse);
    const net = ret - staked;
    this.ui.hud(false);
    this.ui.results({
      podium: order.slice(0, 3).map((e) => ({ no: e.no, name: e.r.name, color: DESIGNS[e.r.design].a, time: e.finT ? fmtTime(e.finT) : '' })),
      rest: order.slice(3).map((e) => ({ no: e.no, name: e.r.name, color: DESIGNS[e.r.design].a })),
      lines,
      ret,
      net,
      before,
      after: this.purse.coins,
      best: this.purse.best,
    });
    this.sound.setMusic('calm');
    if (ret > 0) {
      this.sound.coins(Math.min(30, 8 + Math.floor(ret / 100)));
      if (net > 0) {
        this.salvo(12, 400);
      }
    } else if (staked > 0) this.sound.notes([67, 63, 60], 0.2, 0.4);
    this.drawScreen();
  }

  private async nextRace() {
    this.sound.start();
    this.sound.click();
    await this.loadRace();
  }

  // ------------------------------------------------------------------------------------- commentary
  private say(key: string, text: string, gap = 2.5) {
    if (this.said.has(key) || this.raceT - this.saidT < gap) return;
    this.said.add(key);
    this.saidT = this.raceT;
    this.ui.caption(text);
  }

  private commentary() {
    if (this.state !== 'race') return;
    const c = this.built!.course;
    const order = this.ranked();
    const lead = order[0];
    if (lead !== this.leader && this.raceT > 3) {
      if (this.leader) this.say(`lead${lead.no}${Math.floor(this.raceT / 6)}`, `${lead.r.name} takes the lead!`, 3);
      this.leader = lead;
    } else if (!this.leader) this.leader = lead;
    // the shortcut: anyone on the narrow lane
    for (const sp of c.b.splits) {
      for (const e of this.field) {
        if (e.s > sp.s0 + 4 && e.s < sp.s0 + 12) {
          const lat = c.path!.project(e.m.pos, e.hint, 10).lat;
          if (Math.abs(lat - sp.fast) < 2) this.say(`cut${e.no}`, `${e.r.name} gambles on the shortcut!`, 2);
        }
      }
    }
    if (lead.s > c.finishS - 90 && order[1]) this.say('home', `Into the home straight: ${lead.r.name} from ${order[1].r.name}!`, 1.5);
    if (this.raceT > 20 && this.raceT < 21) {
      const fav = this.field[this.p.win.indexOf(Math.max(...this.p.win))];
      const pos = order.indexOf(fav) + 1;
      if (pos > 4) this.say('fav', `The favourite, ${fav.r.name}, is only ${ordinal(pos)}…`, 1);
    }
  }

  // ------------------------------------------------------------------------------------- frame
  private frame() {
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.adapt(dt);
    if (this.slowUntil > now) dt *= 0.3;
    this.tick(dt, now);
    this.stage.render();
  }

  /** a test hook: runs ahead without drawing */
  ff(seconds: number) {
    for (let t = 0; t < seconds; t += 1 / 60) this.tick(1 / 60, performance.now());
  }

  private tick(dt: number, now: number) {
    const b = this.built;
    if (!b) return;
    const c = b.course;
    this.stateT += dt;
    if (this.state === 'countdown') {
      const n = 3 - Math.floor(this.stateT - 0.8);
      if (this.stateT > 0.8 && n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.ui.count(String(n));
        this.sound.countdown(n);
      }
      if (this.stateT >= 3.8) this.go();
    }
    if (this.state === 'race' || this.state === 'finish') {
      this.raceT += dt;
      this.rules(dt);
      this.commentary();
    }
    const w = c.b.world;
    for (const e of this.field) e.bot.update(dt, w.time, c, w.marbles);
    w.step(dt);
    c.b.sync(w.time);
    this.sounds(dt);
    this.visuals(dt, now / 1000);
    this.director(dt);
    this.hud();
  }

  private adapt(dt: number) {
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc < 2) return;
    const avg = this.fpsAcc / this.fpsN;
    this.fpsAcc = this.fpsN = 0;
    const max = Math.min(window.devicePixelRatio, 1.5);
    let q = this.quality;
    if (avg > 1 / 45) q = Math.max(0.6, q - 0.15);
    else if (avg < 1 / 58) q = Math.min(1, q + 0.05);
    if (q !== this.quality) {
      this.quality = q;
      this.renderer.setPixelRatio(max * q);
      this.resize();
    }
  }

  private sounds(dt: number) {
    const s = this.sound;
    if (!s.ctx) return;
    const c = this.built!.course;
    s.cam.copy(this.camera.position);
    s.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    s.hits(c.b.world.hits, this.focusEntry()?.m);
    const list = this.field.filter((e) => e.m.active && !e.m.frozen).map((e) => ({ key: e.r.id, x: e.m.pos.x, y: e.m.pos.y, z: e.m.pos.z, speed: e.m.vel.length(), on: e.m.groundT < 0.05, mat: e.m.groundMat }));
    s.rolling(list, this.focusEntry()?.r.id, dt);
    s.windAt(0);
    s.crowd(true);
    if (this.state === 'race') {
      const lead = Math.max(...this.field.map((e) => e.s / c.finishS));
      s.setHeat(THREE.MathUtils.clamp((lead - 0.4) / 0.5, 0, 1));
    } else s.setHeat(0);
    for (const e of this.field) {
      if (e.m.hopped && e.m.pos.distanceToSquared(this.camera.position) < 900) s.hop(e.m.pos.x, e.m.pos.y, e.m.pos.z, e.m.groundMat);
      if (e.m.dashed && e.m.pos.distanceToSquared(this.camera.position) < 900) s.dash(e.m.pos.x, e.m.pos.y, e.m.pos.z);
    }
  }

  private visuals(dt: number, t: number) {
    const b = this.built!;
    const c = b.course;
    const cam = this.camera;
    for (const e of this.field) {
      e.mesh.visible = e.m.pos.y > c.lakeY - 1;
      e.mesh.position.copy(e.m.pos);
      e.mesh.quaternion.copy(e.m.quat);
      e.mesh.updateMatrixWorld();
      const u = e.mat.userData.u as { uCamObj: { value: THREE.Vector3 }; uRotW: { value: THREE.Matrix3 } };
      this.inv.copy(e.mesh.matrixWorld).invert();
      u.uCamObj.value.copy(cam.position).applyMatrix4(this.inv);
      u.uRotW.value.setFromMatrix4(e.mesh.matrixWorld);
    }
    const statics = c.b.world.statics;
    this.caustics.update(
      this.field.filter((e) => e.mesh.visible).map((e) => ({ pos: e.m.pos, design: DESIGNS[e.r.design] })),
      KEY,
      (x, y, z, d) => statics.floorBelow(x, y, z, d),
      this.camLook,
    );
    // the neon and the crowd
    const hot = this.state === 'race' ? 1 : this.state === 'finish' ? 1 : 0;
    b.neon.uniforms.uTime.value = t;
    b.neon.uniforms.uHot.value += (hot - b.neon.uniforms.uHot.value) * Math.min(1, dt * 2);
    const lead = this.field.length ? Math.max(...this.field.map((e) => e.s)) / c.finishS : 0;
    const hype = this.state === 'finish' || this.state === 'payout' ? 1 : this.state === 'race' ? 0.25 + 0.75 * THREE.MathUtils.smoothstep(lead, 0.7, 1) : 0.1;
    b.stand.crowd.uniforms.uTime.value = t;
    b.stand.crowd.uniforms.uHype.value += (hype - b.stand.crowd.uniforms.uHype.value) * Math.min(1, dt * 2);
    this.pools();
    this.stage.update(dt, t);
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 0.25;
      this.drawScreen();
    }
  }

  /** the neon's light on the course: pools of its colour on the rails near where the camera looks */
  private pools() {
    const c = this.built!.course;
    const path = c.path!;
    const f = this.focusEntry();
    const s0 = f ? f.s : this.camS();
    let k = 0;
    for (const ds of [-4, 9]) {
      const s = THREE.MathUtils.clamp(s0 + ds, 0, path.length - 1);
      const i = path.index(s);
      const sec = path.sec[i];
      for (const side of [-1, 1]) {
        const l = this.stage.pools[k++];
        const wall = side < 0 ? sec.wallL : sec.wallR;
        if (!sec.floor || wall < 0.4) {
          l.intensity = 0;
          continue;
        }
        l.position.copy(path.at(s, side * (sec.w / 2 - 0.1), wall + 0.25));
        l.color.copy(neonAt(s));
        l.intensity = 9;
        l.distance = 9;
      }
    }
  }

  private camS() {
    const path = this.built!.course.path!;
    return path.project(this.camLook, path.index(this.field[0]?.s ?? 0), 80).s;
  }

  private focusEntry(): Entry | null {
    if (this.follow) return this.follow;
    if (this.state === 'lobby' && this.feature >= 0) return this.field[this.feature] ?? null;
    if (this.state === 'lobby' || this.state === 'countdown') return null;
    return this.ranked()[0] ?? null;
  }

  // ------------------------------------------------------------------------------------- the director
  private cut(force = false) {
    const c = this.built!.course;
    const lead = this.ranked()[0];
    const near = lead && c.finishS - lead.s < 70;
    const options: Shot[] = near ? ['finish'] : ['chase', 'side', 'heli', 'fixed', 'chase'];
    let next = options[Math.floor(Math.random() * options.length)];
    if (next === this.shot && options.length > 1) next = options[(options.indexOf(next) + 1) % options.length];
    if (this.follow) next = 'follow';
    if (!force && next === this.shot) return;
    this.shot = next;
    this.shotT = 0;
    this.shotLen = next === 'fixed' ? 7 : next === 'heli' ? 6 : 5 + Math.random() * 3;
    if (next === 'fixed' && lead) {
      // ahead of the leader, off to the outside, low: the field rushes past
      const path = c.path!;
      this.fixedS = Math.min(c.finishS - 10, lead.s + 26 + lead.m.vel.length() * 0.8);
      const i = path.index(this.fixedS);
      const sec = path.sec[i];
      const side = Math.random() < 0.5 ? -1 : 1;
      this.fixedAt.copy(path.at(this.fixedS, side * (sec.w / 2 + 3.5), 2.2 + Math.random() * 2));
    }
    this.stage.cut();
  }

  private director(dt: number) {
    const c = this.built!.course;
    const path = c.path!;
    const cam = this.camera;
    const dc = (window as unknown as { __cam?: { p: number[]; l: number[] } }).__cam;
    if (dc) {
      cam.position.fromArray(dc.p);
      this.camLook.fromArray(dc.l);
      cam.lookAt(this.camLook);
      return;
    }
    let pos: THREE.Vector3, look: THREE.Vector3;
    let fov = 50;
    let snap = false;
    if (this.state === 'lobby' || this.state === 'countdown') {
      // the parade: along the grid behind the gate, the featured runner up close
      const f = this.focusEntry();
      const g = this.field;
      const mid = g.reduce((v, e) => v.add(e.m.pos), new THREE.Vector3()).divideScalar(Math.max(1, g.length));
      const i = path.index(path.projectAll(mid).s);
      const T = path.T[i], R = path.Rt[i];
      // (the card is on the right: the runners are framed left of centre)
      const wide = window.innerWidth > 760;
      if (this.state === 'countdown') {
        pos = mid.clone().addScaledVector(T, -6.5).addScaledVector(UP, 3.0);
        look = mid.clone().addScaledVector(T, 5);
        fov = 54;
      } else if (f) {
        // up close behind the one under the cursor, the gate and the course beyond it
        const a = this.stateT * 0.3;
        pos = f.m.pos.clone().addScaledVector(T, -2.3).addScaledVector(R, -0.9 + Math.sin(a) * 0.25).addScaledVector(UP, 0.75);
        look = f.m.pos.clone().addScaledVector(T, 1.5).addScaledVector(R, wide ? 1.1 : 0).addScaledVector(UP, 0.15);
        fov = 44;
      } else {
        // behind the grid and above it, swaying side to side
        const a = Math.sin(this.stateT * 0.15) * 0.5;
        pos = mid.clone().addScaledVector(T, -6.2).addScaledVector(R, -2 + a * 3).addScaledVector(UP, 2.8);
        look = mid.clone().addScaledVector(T, 3).addScaledVector(R, wide ? 3.2 : 0);
        fov = 50;
      }
    } else if (this.state === 'payout') {
      // round the winner, looking up a little: the fireworks over the stand
      const win = this.ranked()[0];
      const a = this.stateT * 0.22 + 0.6;
      pos = win.m.pos.clone().add(new THREE.Vector3(Math.sin(a) * 7.5, 2.6, Math.cos(a) * 7.5));
      look = win.m.pos.clone().add(new THREE.Vector3(0, 3.2, 0));
      fov = 55;
    } else {
      this.shotT += dt;
      if (this.shotT > this.shotLen) this.cut();
      const lead = this.ranked().find((e) => !e.fell) ?? this.field[0];
      const f = this.shot === 'follow' && this.follow ? this.follow : lead;
      const fi = path.index(f.s + 3);
      const T = path.T[fi].clone().setY(0).normalize();
      const R = new THREE.Vector3().crossVectors(T, UP).normalize();
      const sp = f.m.vel.length();
      // the pack: the leaders' middle
      const top = this.ranked().slice(0, 4).filter((e) => !e.fell);
      const pack = top.reduce((v, e) => v.add(e.m.pos), new THREE.Vector3()).divideScalar(Math.max(1, top.length));
      switch (this.shot) {
        case 'side': {
          // over the rail on the outside, looking down across the chute at the leader
          const sec = path.sec[fi];
          const side = sec.bank > 0.05 ? -1 : 1;
          pos = path.at(f.s + 1.5, side * (sec.w / 2 + 3), Math.max(sec.wallL, sec.wallR) + 4.2);
          look = f.m.pos.clone().addScaledVector(T, 2);
          fov = 48;
          break;
        }
        case 'heli':
          pos = pack.clone().addScaledVector(T, -9).addScaledVector(UP, 17).addScaledVector(R, 5);
          look = pack.clone().addScaledVector(T, 6);
          fov = 52;
          break;
        case 'fixed':
          pos = this.fixedAt.clone();
          look = f.m.pos.clone();
          fov = THREE.MathUtils.clamp(70 - this.fixedAt.distanceTo(f.m.pos) * 0.8, 24, 60);
          if (f.s > this.fixedS + 12) this.shotT = this.shotLen;
          break;
        case 'finish': {
          const fp = path.at(c.finishS, 0, 0);
          const fi2 = path.index(c.finishS);
          const FT = path.T[fi2].clone().setY(0).normalize();
          // (on the side away from the stand, a little past the line, looking back up the straight
          // with the stand behind: clear of the arch's post)
          const away = -this.built!.standSide;
          pos = path.at(c.finishS + 4, away * (path.sec[fi2].w / 2 + 3.5), Math.max(path.sec[fi2].wallL, path.sec[fi2].wallR) + 3.4);
          const tgt = this.state === 'finish' ? fp.clone().addScaledVector(FT, -2).add(new THREE.Vector3(0, 0.6, 0)) : f.m.pos.clone();
          look = tgt;
          fov = THREE.MathUtils.clamp(16 + pos.distanceTo(f.m.pos) * 0.8, 24, 50);
          break;
        }
        default: {
          // chase (and follow): behind and above, along the course
          const dist = 6.5 + Math.min(sp, 25) * 0.12;
          pos = f.m.pos.clone().addScaledVector(T, -dist).addScaledVector(UP, 3.2 + Math.min(sp, 25) * 0.06);
          look = f.m.pos.clone().addScaledVector(T, 3).addScaledVector(UP, 0.4);
          fov = 56 + Math.min(10, Math.max(0, sp - 8) * 0.5);
        }
      }
      if (this.shotT === 0) snap = true;
      if (f.fell) look.y = Math.max(look.y, c.lakeY + 5);
    }
    if (snap || this.stateT < 0.05) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      const k = this.shot === 'fixed' ? 1 : Math.min(1, dt * 5);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, Math.min(1, dt * 8));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, snap ? 1 : dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------------------------- HUD and the screen
  private hud() {
    if (this.state !== 'race' && this.state !== 'finish') return;
    const c = this.built!.course;
    const order = this.ranked();
    const lead = order[0];
    const rows: LiveRow[] = order.map((e) => ({
      no: e.no,
      name: e.r.name,
      color: DESIGNS[e.r.design].a,
      gap: e.fin ? (e.fin === 1 ? e.finT.toFixed(2) : '+' + (e.finT - lead.finT).toFixed(2)) : e === lead ? '' : `${Math.max(0, Math.round(lead.s - e.s))} m`,
      fin: e.fin,
      fell: !!e.fell,
      mine: this.bets.filter((b) => this.field[b.runner] === e).map((b) => b.kind),
      follow: this.follow === e,
    }));
    this.ui.live({ rows, time: fmtTime(this.raceT), progress: Math.min(1, lead.s / c.finishS), shot: this.follow ? `Following ${this.follow.r.name}` : 'Director’s cut' });
  }

  private drawScreen() {
    const b = this.built;
    if (!b) return;
    const { ctx, canvas, tex } = b.stand.screen;
    const W = canvas.width, H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#120a2a');
    g.addColorStop(1, '#05030c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff2f9a';
    ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = '#fff';
    ctx.font = '700 40px "Fredoka", sans-serif';
    ctx.textBaseline = 'middle';
    const track = this.trackOf(this.state === 'payout' ? this.purse.race - 1 : this.purse.race);
    const head = this.state === 'lobby' || this.state === 'countdown' ? `RACE ${this.purse.race + 1} · ${track.name.toUpperCase()}` : this.state === 'payout' ? 'RESULT' : `LIVE · ${fmtTime(this.raceT)}`;
    ctx.fillText(head, 28, 33);
    const list = this.state === 'lobby' || this.state === 'countdown' ? this.field.map((e, i) => ({ e, right: fmtPrice(this.prices.win[i]) })) : this.ranked().map((e, k) => ({ e, right: e.fin && e.fin < 100 ? `${ordinal(k + 1)}` : `${k + 1}` }));
    list.forEach(({ e, right }, k) => {
      const y = 96 + k * 52;
      ctx.fillStyle = k % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(16, y - 24, W - 32, 48);
      ctx.fillStyle = '#' + DESIGNS[e.r.design].a.toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(52, y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd84a';
      ctx.font = '700 30px "Fredoka", sans-serif';
      ctx.fillText(String(e.no), 84, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(e.r.name, 130, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#7fe7ff';
      ctx.fillText(right, W - 36, y);
      ctx.textAlign = 'left';
    });
    tex.needsUpdate = true;
  }
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function disposeGroup(g: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material;
    if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
    else if (mm) mats.add(mm);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
    m.dispose();
  }
}
