import * as THREE from 'three';
import type { Marble } from './physics.ts';
import type { Course } from './courses.ts';
import type { Sound } from './audio.ts';
import type { UI } from './ui.ts';
import { Boost, KART } from './kart-sim.ts';
import { Racer as Sim, RACE, stepRace, type KartHit } from './kart-race.ts';
import { Surf } from './kart-track.ts';
import { KartModel } from './kart-model.ts';
import { Bits, Skids, type Edge } from './kart-fx.ts';
import { KartAudio } from './kart-audio.ts';
import { KartBrain } from './ai-kart.ts';

/**
 * The game side of the go-karts: a kart under every bean. Each browser steps the karts it owns (its
 * player, and on the host the bots), reads the rest from the network, and draws the lot: the
 * karts, the driver in the seat, the smoke, the sparks, the rubber on the road, the sound of it.
 */

type Bean = {
  m: Marble;
  c: { id: number; name: string; outfit: { a: number; b?: number; limb?: number }; player: boolean; skill: number };
  rig: { root: THREE.Object3D; seat: THREE.Vector3 | null; tilt: THREE.Quaternion | null; steer: number | null; pose: string | null };
  bot: unknown;
  local: boolean;
  out: boolean;
  fin: number;
  s: number;
};

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Qa = new THREE.Quaternion();
const Qb = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);
const SEAT = new THREE.Vector3();

/** each rear wheel's strip of rubber so far */
interface Mark extends Edge {
  x: number;
  y: number;
  z: number;
  on: boolean;
  /** how far it's rolled since the last time it was laying rubber */
  gap: number;
  dirt: boolean;
}
const mark = (): Mark => ({ x: 0, y: 0, z: 0, on: false, gap: 0, dirt: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, a: 0 });

/** the colour of each boost: its flame, its sparks, the call it gets */
const FLAME = [0xff9030, 0xff9a24, 0x35c8ff, 0xff46cf, 0x54ffb4, 0xffdf3a, 0x7cff5a, 0xa8ecff];
const CALL = ['', 'BOOST!', 'SUPER BOOST!', 'ULTRA BOOST!', '', 'TRICK!', 'PERFECT START!', 'SLINGSHOT!'];
const RGB = [[1, 0.62, 0.2], [1, 0.62, 0.2], [0.3, 0.75, 1.4], [1.4, 0.3, 1.1]];

export class KartPlay {
  readonly arena;
  private sims: Sim[] = [];
  private byId = new Map<number, Sim>();
  private model: KartModel;
  private smoke = new Bits(520, false);
  private sparks = new Bits(320, true);
  private skids = new Skids(2600);
  private audio: KartAudio;
  /** each kart's last skid point per rear wheel */
  private marks = new Map<number, Mark[]>();
  /** how far each bean's leaning into the bend */
  private lean: number[] = [];
  /** how long each has held the throttle on the grid, and whether it was still held last frame */
  private rev: number[] = [];
  private wasHeld: boolean[] = [];
  /** seconds to the off (-1: not counting) */
  private goLeft = -1;
  /** your kart drives itself once the flag's fallen */
  private cruise: KartBrain | null = null;
  /** seconds since you took the flag (-1: not yet) */
  private flag = -1;
  /** what you did out there */
  private stats = { top: 0, drift: 0, air: 0, boosts: 0, passes: 0 };
  private rank = 0;
  private rankT = 0;
  private boardT = 0;
  private levelSeen = 0;
  private slingSeen = false;
  /** the wheels as the drawing wants them */
  private wheelArgs = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, r: 0, spin: 0, steer: 0, comp: 0 }));
  /** the chase camera */
  private camYaw = NaN;
  private camUp = new THREE.Vector3(0, 1, 0);
  private camAt = new THREE.Vector3();
  private bump = 0;
  private fov = 0;
  /** what's been called to the player */
  private lapSeen = 0;
  private boostSeen = 0;
  private bestSeen = 0;
  private wrongShown = false;
  private gearSeen = 1;
  private hud: HTMLElement;
  private hudEls: Record<string, HTMLElement> = {};
  private map: CanvasRenderingContext2D;
  private mapBase: HTMLCanvasElement;
  private mapK = 1;
  private mapX = 0;
  private mapZ = 0;
  private mapT = 0;
  private hits: KartHit[] = [];
  /** the headings other people's karts had last frame */
  private yaws = new Map<number, number>();

  constructor(
    private course: Course,
    private scene: THREE.Scene,
    private beans: () => Bean[],
    private ui: UI,
    private sound: Sound,
    slots: number[],
  ) {
    const A = (this.arena = course.kart!);
    const all = beans();
    all.forEach((r, k) => {
      const s = new Sim(r.m.id);
      s.grid(A.track, slots[k]);
      s.local = r.local;
      this.sims.push(s);
      this.byId.set(r.m.id, s);
      this.copy(r, s);
      this.marks.set(r.m.id, [mark(), mark()]);
      this.lean.push(0);
      this.rev.push(0);
      this.wasHeld.push(true);
    });
    A.bind(this.sims);
    this.model = new KartModel(scene, all.length, all.map((r) => ({ a: r.c.outfit.a, b: r.c.outfit.b ?? r.c.outfit.limb ?? 0xffffff })));
    scene.add(this.smoke.mesh, this.sparks.mesh, this.skids.mesh);
    this.audio = new KartAudio(sound);
    // ---- the dash
    this.hud = document.createElement('div');
    this.hud.className = 'mk-dash';
    this.hud.innerHTML = `
      <div class="mk-lapbox"><div class="mk-lap"><span>LAP</span><b>1</b><i>/ ${RACE.laps}</i></div><div class="mk-times"><span class="mk-now">0:00.0</span><span class="mk-best"></span></div></div>
      <ol class="mk-board"></ol>
      <canvas class="mk-map" width="340" height="340"></canvas>
      <div class="mk-gauge"><svg viewBox="0 0 240 132" aria-hidden="true"><path class="mk-arc0" d="M20 122 A100 100 0 0 1 220 122"/><path class="mk-arc" d="M20 122 A100 100 0 0 1 220 122"/></svg><div class="mk-speed"><b>0</b><span>KM/H</span></div><div class="mk-gear">1</div></div>
      <div class="mk-drift"><span><i></i></span><span><i></i></span><span><i></i></span></div>
      <div class="mk-tow">SLIPSTREAM</div>
      <div class="mk-wrong">WRONG WAY</div>
      <div class="mk-help"><b>W / UP</b> go &nbsp; <b>S / DOWN</b> brake, then reverse &nbsp; <b>A D</b> steer &nbsp; <b>SPACE / SHIFT</b> hold to drift, let go to boost, tap off a jump for a trick</div>
      <div class="mk-launch">Hit the gas on the <b>last red light</b> for a perfect start</div>
      <div class="mk-report"></div>`;
    document.body.appendChild(this.hud);
    document.body.classList.add('mk-on');
    for (const k of ['lap', 'now', 'best', 'speed', 'gear', 'rev', 'drift', 'tow', 'wrong', 'help', 'launch', 'report', 'board', 'gauge'])
      this.hudEls[k] = this.hud.querySelector(
        { lap: '.mk-lap b', now: '.mk-now', best: '.mk-best', speed: '.mk-speed b', gear: '.mk-gear', rev: '.mk-arc', drift: '.mk-drift', tow: '.mk-tow', wrong: '.mk-wrong', help: '.mk-help', launch: '.mk-launch', report: '.mk-report', board: '.mk-board', gauge: '.mk-gauge' }[k]!,
      ) as HTMLElement;
    const cv = this.hud.querySelector('.mk-map') as HTMLCanvasElement;
    this.map = cv.getContext('2d')!;
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.mapBase.height = 340;
    this.drawMap();
  }

  dispose() {
    this.model.dispose();
    this.scene.remove(this.smoke.mesh, this.sparks.mesh, this.skids.mesh);
    this.smoke.dispose();
    this.sparks.dispose();
    this.skids.dispose();
    this.audio.dispose();
    this.hud.remove();
    document.body.classList.remove('mk-on');
    delete document.body.dataset.mkb;
    for (const r of this.beans()) {
      r.rig.seat = r.rig.tilt = null;
      r.rig.steer = null;
      r.rig.pose = null;
    }
    this.cam?.up.set(0, 1, 0);
  }
  private cam: THREE.Camera | null = null;

  /** the standings round you */
  private board(s: Sim, sp: number) {
    const all = this.beans(), order = all.map((r, i) => ({ r, i, o: this.order(all, i) })).sort((a, b) => b.o - a.o);
    const me = order.findIndex((e) => this.sims[e.i] === s);
    const from = Math.max(0, Math.min(order.length - 5, me - 2));
    const rows = order.slice(from, from + 5).map((e, n) => {
      const o = this.sims[e.i], gap = (o.prog - s.prog) / Math.max(sp, 12), mine = o === s, you = e.r.c.player;
      const col = `#${(e.r.c.outfit.a & 0xffffff).toString(16).padStart(6, '0')}`;
      const fin = e.r.fin ? 'FIN' : mine ? '' : `${gap > 0 ? '+' : '-'}${Math.abs(gap).toFixed(1)}`;
      return `<li class="${you ? 'me' : ''}${e.r.out && !e.r.fin ? ' out' : ''}"><u>${from + n + 1}</u><i style="background:${col}"></i><b>${you ? 'You' : esc(e.r.c.name)}</b><span>${fin}</span></li>`;
    });
    const html = rows.join('');
    if (html !== this.boardHtml) {
      this.boardHtml = html;
      this.hudEls.board.innerHTML = html;
    }
  }
  private boardHtml = '';
  private frameDt = 0;

  private drawMap() {
    const tr = this.arena.track, c = this.mapBase.getContext('2d')!;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < tr.n; i++) {
      x0 = Math.min(x0, tr.P[i * 3]);
      x1 = Math.max(x1, tr.P[i * 3]);
      z0 = Math.min(z0, tr.P[i * 3 + 2]);
      z1 = Math.max(z1, tr.P[i * 3 + 2]);
    }
    this.mapK = 300 / Math.max(x1 - x0, z1 - z0);
    this.mapX = (x0 + x1) / 2;
    this.mapZ = (z0 + z1) / 2;
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= tr.n; i += 3) {
        const k = tr.idx(i), [x, y] = this.toMap(tr.P[k * 3], tr.P[k * 3 + 2]);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.closePath();
    };
    c.lineJoin = 'round';
    path();
    c.strokeStyle = 'rgba(10,12,30,0.75)';
    c.lineWidth = 19;
    c.stroke();
    path();
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineWidth = 10;
    c.stroke();
    const [sx, sy] = this.toMap(tr.P[RACE.start * 3], tr.P[RACE.start * 3 + 2]);
    c.fillStyle = '#ffc21f';
    c.fillRect(sx - 3, sy - 12, 6, 24);
  }
  /** (north up, as the map of a place should be: the world's -z) */
  private toMap(x: number, z: number): [number, number] {
    return [170 + (x - this.mapX) * this.mapK, 170 + (z - this.mapZ) * this.mapK];
  }

  of(id: number) {
    return this.byId.get(id);
  }
  /** what a kart's flame is doing, for the network: its boost and its drift charge, packed into one number */
  fx(id: number) {
    const k = this.byId.get(id)?.kart;
    return k ? (k.boost > 0 ? k.boostKind : 0) * 4 + k.level : 0;
  }
  setFx(id: number, v: number) {
    const k = this.byId.get(id)?.kart;
    if (!k) return;
    k.boostKind = Math.floor(v / 4);
    k.level = v % 4;
  }

  /** done its laps */
  done(id: number) {
    const s = this.byId.get(id);
    return !!s && s.prog >= RACE.laps * this.arena.track.length;
  }

  /** the sim's kart into the bean's body */
  private copy(r: Bean, s: Sim) {
    const m = r.m, k = s.kart;
    m.pos.copy(k.pos);
    m.vel.copy(k.vel);
    m.quat.copy(k.quat);
    m.yaw = Math.atan2(k.az.x, k.az.z);
    m.groundT = k.air > 0.22 ? 1 : 0;
    r.s = s.prog;
  }

  step(dt: number, t: number, go: number) {
    const A = this.arena, tr = A.track, x = t - go;
    if (dt <= 0) return;
    const all = this.beans();
    all.forEach((r, i) => {
      const s = this.sims[i], k = s.kart, m = r.m;
      s.held = m.frozen;
      s.cool = r.fin > 0;
      if (!r.local) {
        // (someone else's: as reported)
        k.pos.copy(m.pos);
        k.vel.copy(m.vel);
        k.quat.copy(m.quat);
        k.refresh();
        tr.at(k.pos.x, k.pos.y, k.pos.z, k.hint, k.q);
        k.hint = k.q.i;
        s.prog = r.s;
        s.held = false;
        return;
      }
      if (s.held) this.grid(r, i, t, dt);
      else if (this.wasHeld[i]) this.launch(r, i);
      this.wasHeld[i] = s.held;
      if (r.out && !r.fin) {
        s.input = { steer: s.input.steer * 0.9, throttle: 0, brake: 0.55, drift: false };
      } else if (r.fin && !r.bot) {
        // (the flag's out: the kart takes itself round, so nobody's left parked on the racing line)
        this.cruise ??= new KartBrain(s, tr, 0.85, 1 + r.m.id, 1);
        s.input = this.cruise.drive(dt, t, this.sims, 0);
      } else if (!r.bot) {
        s.input = { steer: m.input.x, throttle: Math.max(0, m.input.z), brake: Math.max(0, -m.input.z), drift: m.jet };
      }
    });
    this.hits.length = 0;
    stepRace(this.sims, dt, tr, t, (h) => this.hits.push(h));
    all.forEach((r, i) => {
      const s = this.sims[i];
      if (!r.local) return;
      s.track(tr, Math.max(0, x));
      if (!s.held && s.watch(tr, dt, t) && r.c.player) this.ui.note('Back on track', 900);
      this.copy(r, s);
    });
    // the driver in the seat, leaning into the bend (and round with a trick)
    all.forEach((r, i) => {
      const k = this.sims[i].kart;
      const lean = THREE.MathUtils.clamp(k.ang.dot(k.ay) * Math.min(k.vel.length(), 24) * 0.018, -0.32, 0.32);
      this.lean[i] += (lean - this.lean[i]) * Math.min(1, dt * 7);
      const q = this.spun(k, Qb);
      SEAT.set(0, -KART.hcg + 0.13, -0.24).applyQuaternion(q);
      r.rig.seat = (r.rig.seat ?? new THREE.Vector3()).copy(k.pos).add(SEAT);
      r.rig.tilt = (r.rig.tilt ?? new THREE.Quaternion()).copy(q).multiply(Qa.setFromAxisAngle(FWD, -this.lean[i]));
      r.rig.steer = k.hands;
    });
  }

  /** the kart as drawn: its own orientation, plus however far through a trick it is */
  private spun(k: Sim['kart'], out: THREE.Quaternion) {
    out.copy(k.quat);
    if (k.trick > 0) {
      const u = k.trick, e = u * u * (3 - 2 * u);
      out.multiply(Qa.setFromAxisAngle(FWD, e * 6.2832 * k.trickDir));
    }
    return out;
  }

  /** on the grid: revving, and how long the foot's been down */
  private grid(r: Bean, i: number, t: number, dt: number) {
    const k = this.sims[i].kart;
    // (the bots blip it as the lights come on)
    const thr = r.bot ? (this.goLeft >= 0 && this.goLeft < 1.6 && (t * 2.7 + i * 0.37) % 1 < 0.45 ? 1 : 0) : Math.max(0, r.m.input.z);
    k.throttle = thr;
    k.rpm += ((thr > 0.1 ? 11800 : KART.idle) - k.rpm) * Math.min(1, dt * (thr > 0.1 ? 6 : 3));
    this.rev[i] = this.goLeft >= 0 && thr > 0.5 ? this.rev[i] + dt : 0;
  }

  /** the lights go out: on the last red you get away clean, too early and the clutch just cooks */
  private launch(r: Bean, i: number) {
    const k = this.sims[i].kart, held = this.rev[i];
    if (r.bot) {
      const roll = Math.random();
      if (roll < 0.1 + r.c.skill * 0.3) k.give(KART.launchT, Boost.Start);
      else if (roll > 0.9) k.bog = KART.bogT;
      return;
    }
    if (held > 0 && held <= KART.launchWin) k.give(KART.launchT, Boost.Start);
    else if (held > KART.launchWin + 0.65 && r.c.player) {
      k.bog = KART.bogT;
      this.ui.pop('WHEELSPIN!', true);
    }
  }

  /** the lap calls, the boosts, the air, the places, going the wrong way */
  calls(id: number, t: number) {
    const s = this.byId.get(id);
    if (!s) return;
    const k = s.kart;
    if (s.lap > this.lapSeen && s.prog > 0) {
      this.lapSeen = s.lap;
      if (s.lap === RACE.laps - 1) {
        this.ui.shout('FINAL LAP!', s.bestLap ? `Last lap ${lapTime(s.bestLap)}` : '', 1500);
        this.sound.notes([72, 76, 79, 84], 0.06, 0.4, true);
        this.sound.cheer(0.8);
      }
    }
    if (k.fired) {
      const f = k.fired;
      k.fired = 0;
      this.stats.boosts++;
      if (f === Boost.Start) this.ui.shout(CALL[f], '', 1300);
      else if (CALL[f]) this.ui.pop(CALL[f], true);
      if (f <= Boost.Drift3) this.sound.notes(f === 3 ? [79, 86, 91, 96] : f === 2 ? [79, 86, 91] : [76, 83], 0.04, 0.34, true);
      else if (f === Boost.Trick) this.sound.notes([81, 88], 0.05, 0.34, true);
      else if (f === Boost.Start) {
        this.sound.notes([72, 79, 84], 0.05, 0.4, true);
        this.sound.cheer(0.5);
      }
      this.audio.whoosh(f === Boost.Drift3 || f === Boost.Start ? 1 : f === Boost.Drift1 ? 0.2 : 0.55);
      this.fov = Math.max(this.fov, f === Boost.Drift3 ? 9 : f === Boost.Drift2 || f === Boost.Start ? 7 : 5);
    }
    // (a tick each time the charge steps up)
    if (k.level !== this.levelSeen) {
      if (k.level > this.levelSeen) this.sound.notes([64 + k.level * 5], 0, 0.22, true);
      this.levelSeen = k.level;
    }
    if (k.jump > 0) {
      const air = k.jump;
      k.jump = 0;
      this.stats.air += air;
      if (air > 0.5) {
        this.ui.pop(`BIG AIR ${air.toFixed(1)}s`);
        this.sound.cheer(0.3);
      }
      this.audio.thump(air * 2);
    }
    const ready = s.sling > 0;
    if (ready !== this.slingSeen) {
      this.slingSeen = ready;
      if (ready) this.sound.notes([84], 0, 0.2, true);
    }
    // the places, once they've settled for a moment
    const place = this.placeOf(s);
    if (!this.rank) this.rank = place;
    if (place !== this.rank && t > this.rankT) {
      if (place < this.rank) {
        this.stats.passes += this.rank - place;
        if (t > 3) this.sound.notes([76 + Math.min(8, 24 - place)], 0, 0.16, true);
      }
      this.rank = place;
      this.rankT = t + 0.35;
      document.body.dataset.mkb = document.body.dataset.mkb === 'a' ? 'b' : 'a';
    }
    const wrong = s.wrong > 1.2;
    if (wrong !== this.wrongShown) {
      this.wrongShown = wrong;
      this.hudEls.wrong.classList.toggle('on', wrong);
    }
  }

  /** where it stands: those who've taken the flag in order, then how far round */
  private placeOf(s: Sim) {
    const all = this.beans(), me = this.order(all, this.sims.indexOf(s));
    let n = 1;
    all.forEach((_, i) => {
      if (this.sims[i] !== s && this.order(all, i) > me) n++;
    });
    return n;
  }
  private order(all: Bean[], i: number) {
    return all[i].fin ? 1e7 - all[i].fin : this.sims[i].prog;
  }

  /** you took the flag */
  flagged(id: number, place: number, through: boolean) {
    const s = this.byId.get(id);
    if (!s) return;
    this.flag = 0;
    const st = this.stats, last = s.laps[s.laps.length - 1] ?? 0;
    this.hudEls.report.innerHTML = `<h4>${through ? 'Race report' : 'Race report'}</h4><dl>
      <div><dt>Time</dt><dd>${lapTime(last)}</dd></div>
      <div><dt>Best lap</dt><dd>${s.bestLap ? lapTime(s.bestLap) : '-'}</dd></div>
      <div><dt>Top speed</dt><dd>${Math.round(st.top * 3.6)} km/h</dd></div>
      <div><dt>Drifting</dt><dd>${st.drift.toFixed(1)}s</dd></div>
      <div><dt>Air</dt><dd>${st.air.toFixed(1)}s</dd></div>
      <div><dt>Boosts</dt><dd>${st.boosts}</dd></div>
      <div><dt>Places gained</dt><dd>${st.passes}</dd></div></dl>`;
    this.hudEls.report.classList.add('on');
    setText(this.hudEls.now, lapTime(last));
    void place;
    const me = this.beans().find((r) => r.m.id === id);
    if (me && through) me.rig.pose = 'win';
  }

  /** how hard the screen should rush: a boost, or a long way past fast */
  rush(id: number) {
    const k = this.byId.get(id)?.kart;
    return k && k.boost > 0 ? 0.62 : 0;
  }

  /** this frame's jolt for the camera, from the hits and the landings */
  jolt(id: number) {
    const s = this.byId.get(id);
    if (!s) return 0;
    const v = this.bump;
    this.bump = 0;
    const sp = s.kart.vel.length();
    // (kerbs and grass through the seat, and a fine tremble at the top end)
    return v + (s.kart.q.mat === Surf.Kerb ? 0.012 : s.kart.q.mat >= Surf.Grass ? 0.03 : 0) * Math.min(1, sp / 20) + Math.max(0, sp - 29) * 0.0006;
  }
  kick(_id: number) {
    const v = this.fov;
    this.fov = 0;
    return v;
  }

  private camBoost = 0;
  /** the chase camera: it hangs back and swings wide of a slide, so a drift looks like one */
  aim(cam: THREE.PerspectiveCamera, id: number, dt: number, snap: boolean, look: THREE.Vector3) {
    this.cam = cam;
    const s = this.byId.get(id);
    if (!s) return;
    const k = s.kart, tr = this.arena.track, sp = k.vel.length();
    const nose = Math.atan2(k.az.x, k.az.z), way = sp > 5 ? Math.atan2(k.vel.x, k.vel.z) : nose;
    let d = way - nose;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const want = nose + d * 0.72;
    if (Number.isNaN(this.camYaw) || snap) this.camYaw = want;
    let e = want - this.camYaw;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    this.camYaw += e * Math.min(1, dt * 6.5);
    // (a boost drops you back a touch, so you feel it pull away)
    this.camBoost += ((k.boost > 0 ? 1 : 0) - this.camBoost) * Math.min(1, dt * 4);
    const dist = 4.9 + Math.min(1.9, sp * 0.05) + this.camBoost * 0.75, hgt = 2.05 + Math.min(0.4, sp * 0.012);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    V.set(k.pos.x - fx * dist, k.pos.y + hgt, k.pos.z - fz * dist);
    // (the flag's out: round to the front of the kart for a look at the winner)
    let orbit = 0;
    if (this.flag >= 0) {
      this.flag += dt;
      orbit = THREE.MathUtils.smoothstep(this.flag, 0.5, 2.2);
      const a = this.camYaw + Math.PI * 0.82 * orbit + this.flag * 0.22;
      V.lerp(V2.set(k.pos.x - Math.sin(a) * 6.4, k.pos.y + 1.55, k.pos.z - Math.cos(a) * 6.4), orbit);
    }
    // (not out through a barrier)
    const q = tr.at(V.x, V.y, V.z, k.hint, probeCam);
    const wall = (q.lat > 0 ? q.wl : q.wr) - 0.4, over = Math.abs(q.lat) - wall;
    if (over > 0) V.addScaledVector(V2.set(q.lx, q.ly, q.lz), -Math.sign(q.lat) * over);
    // (and above the road, on a bank)
    if (q.h < 1.1) V.y += 1.1 - q.h;
    if (snap) this.camAt.copy(V);
    else {
      const f = Math.min(1, dt * 16), fy = Math.min(1, dt * 7);
      this.camAt.x += (V.x - this.camAt.x) * f;
      this.camAt.z += (V.z - this.camAt.z) * f;
      this.camAt.y += (V.y - this.camAt.y) * fy;
    }
    cam.position.copy(this.camAt);
    look.set(k.pos.x + fx * 6 * (1 - orbit), k.pos.y + 0.75, k.pos.z + fz * 6 * (1 - orbit));
    // (the horizon leans a little with the banking)
    V2.set(0, 1, 0).lerp(V.set(k.q.nx, k.q.ny, k.q.nz), 0.5).normalize();
    this.camUp.lerp(V2, Math.min(1, dt * 4));
    cam.up.copy(this.camUp);
    cam.lookAt(look);
  }

  /** everything you see and hear of it */
  sync(t: number, dt: number, cam: THREE.PerspectiveCamera, focus: number, goLeft: number, show: boolean) {
    const A = this.arena, all = this.beans();
    this.frameDt = dt;
    this.hud.classList.toggle('on', show);
    this.goLeft = goLeft;
    // the gantry: five reds come on through the count, the last with `launchWin` to go, and all out on the off
    const step = (LIGHTS - KART.launchWin) / 4;
    if (goLeft >= 0) A.lights(Math.min(5, Math.max(0, Math.ceil((LIGHTS + step - goLeft) / step) - 1)), false);
    else A.lights(0, t - this.course.state.go < 3);
    const fs = this.byId.get(focus);
    this.model.begin();
    const ranked: { d: number; s: Sim; i: number }[] = [];
    all.forEach((r, i) => {
      const s = this.sims[i], k = s.kart, m = r.m;
      const sp = k.vel.length();
      const blink = s.ghost > t && Math.floor(t * 12) % 2 === 0;
      if (!r.local) {
        // (nothing's been simulated here: wheels and hands from how it's moving)
        k.vf = k.vel.dot(k.az);
        k.vl = k.vel.dot(k.ax);
        k.beta = sp > 2 ? Math.atan2(k.vl, Math.max(Math.abs(k.vf), 0.5)) : 0;
        // (near enough: revs climbing through each gear's band, steering from how fast the nose is turning)
        const nose = Math.atan2(k.az.x, k.az.z), lastY = this.yaws.get(m.id) ?? nose;
        this.yaws.set(m.id, nose);
        const turn = Math.atan2(Math.sin(nose - lastY), Math.cos(nose - lastY)) / Math.max(dt, 0.004);
        k.delta += (THREE.MathUtils.clamp((turn * 2) / Math.max(sp, 4), -0.42, 0.42) - k.delta) * Math.min(1, dt * 10);
        k.hands = -k.delta * 2.6;
        k.air = m.groundT > 0.5 ? 1 : 0;
        k.drifting = Math.abs(k.beta) > 0.2 && sp > 7;
        // (`k.boostKind` and `k.level` came in with the network's state, in the slot a bean sends its heading)
        k.boost = k.boostKind ? 0.1 : 0;
        k.rpm = 7600 + ((sp * 3.6) % 34) * 170;
        for (const w of k.wheels) {
          w.spin += ((k.vf / w.r) * dt) % 6.283;
          w.comp = 0.05;
          w.on = k.air < 0.05;
          w.slide = Math.abs(k.beta) > 0.2 ? 1 : 0;
          w.q.nx = k.q.nx;
          w.q.ny = k.q.ny;
          w.q.nz = k.q.nz;
        }
      }
      k.wheels.forEach((w, j) => {
        const a = this.wheelArgs[j];
        a.x = w.x;
        a.z = w.z;
        a.r = w.r;
        a.y = w.y - (KART.rest - (w.on ? w.comp : 0));
        a.spin = w.spin;
        a.steer = w.front ? k.delta : 0;
      });
      const flame = k.boost > 0 ? 1.1 : k.level > 0 ? 0.32 : 0;
      this.model.put(i, k.pos, this.spun(k, Qb), k.hands, this.wheelArgs, blink, flame, k.brake > 0.2, FLAME[k.boost > 0 ? k.boostKind : k.level]);
      if (blink) r.rig.root.visible = false;
      const near = k.pos.distanceToSquared(cam.position);
      ranked.push({ d: near, s, i });
      if (near < 110 * 110) this.tyreFx(r.m.id, s, dt, near);
    });
    this.model.end();
    // bangs
    for (const h of this.hits) {
      const near = V.set(h.x, h.y, h.z).distanceTo(cam.position);
      if (near > 90) continue;
      for (let n = 0; n < Math.min(26, h.power * 2.4); n++) this.spark(h.x, h.y, h.z, 1, 0.62, 0.22, 6 + h.power);
      this.audio.crash(h.power, Math.max(0.1, 1 - near / 70), this.panOf(cam, V));
      if ((h.a === focus || h.b === focus) && h.power > 3) this.bump = Math.max(this.bump, Math.min(0.32, h.power * 0.03));
    }
    for (const s of this.sims) {
      const k = s.kart;
      if (k.wallHit > 1.2) {
        const near = V.set(k.wx, k.wy, k.wz).distanceTo(cam.position);
        for (let n = 0; n < Math.min(34, k.wallHit * 3); n++) this.spark(k.wx, k.wy, k.wz, 1, 0.68, 0.28, 5 + k.wallHit);
        for (let n = 0; n < 4; n++) this.smoke.add(k.wx, k.wy, k.wz, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.8, 1.2, 2.2, 0.82, 0.8, 0.74, 0.34);
        if (near < 80) this.audio.crash(k.wallHit, Math.max(0.1, 1 - near / 60), this.panOf(cam, V));
        if (s === fs) this.bump = Math.max(this.bump, Math.min(0.42, k.wallHit * 0.04));
      }
      if (k.scrape > 0) {
        for (let n = 0; n < 6; n++) this.spark(k.wx, k.wy, k.wz, 1, 0.78, 0.34, 7);
        if (s === fs) this.bump = Math.max(this.bump, Math.min(0.22, k.scrape * 0.03));
      }
      if (k.landed > 2) {
        if (s === fs) this.bump = Math.max(this.bump, Math.min(0.3, k.landed * 0.05));
        // (the dust a landing kicks up)
        if (k.pos.distanceToSquared(cam.position) < 70 * 70) {
          const g = k.q.mat >= Surf.Grass;
          for (let n = 0; n < Math.min(14, k.landed * 2.4); n++) {
            const a = Math.random() * 6.283;
            this.smoke.add(k.pos.x + Math.cos(a) * 0.9, k.pos.y - 0.25, k.pos.z + Math.sin(a) * 0.9, Math.cos(a) * 2.6 + k.vel.x * 0.25, 0.5 + Math.random(), Math.sin(a) * 2.6 + k.vel.z * 0.25, 0.7, 0.7, 2.2, g ? 0.62 : 0.86, g ? 0.6 : 0.86, g ? 0.4 : 0.86, 0.26);
          }
        }
      }
      k.wallHit = k.scrape = k.landed = 0;
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
    // the sound: your own kart, and the nearest three (and none of it over the results)
    if (fs && !show) this.audio.hush();
    else if (fs) {
      const k = fs.kart;
      this.audio.engine(0, k.rpm, k.throttle, 1, 0);
      let slide = 0, rough = 0;
      for (const w of k.wheels) {
        if (!w.on) continue;
        slide = Math.max(slide, w.mat <= Surf.Kerb ? Math.min(1.4, w.slide * 1.1) : 0);
        rough = Math.max(rough, w.mat === Surf.Kerb ? 0.5 : w.mat >= Surf.Grass ? 1 : 0);
      }
      this.audio.tyres(slide * Math.min(1, k.vel.length() / 8), rough, k.vel.length());
      if (k.gear !== this.gearSeen) {
        if (k.gear > this.gearSeen) this.audio.pop(1);
        this.gearSeen = k.gear;
      }
    }
    ranked.sort((a, b) => a.d - b.d);
    let v = 1;
    for (const e of show ? ranked : []) {
      if (e.s === fs) continue;
      if (v > 3) break;
      const k = e.s.kart, d = Math.sqrt(e.d);
      this.audio.engine(v++, k.rpm, Math.min(1, k.throttle + 0.3), Math.max(0, 1 - d / 55) ** 2 * 0.7, this.panOf(cam, k.pos));
    }
    this.dash(fs, t);
  }

  private panOf(cam: THREE.Camera, p: THREE.Vector3) {
    V2.copy(p).sub(cam.position).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    return THREE.MathUtils.clamp(V2.dot(right), -1, 1);
  }

  private spark(x: number, y: number, z: number, r: number, g: number, b: number, sp: number) {
    const a = Math.random() * 6.28, u = Math.random();
    this.sparks.add(x, y, z, Math.cos(a) * sp * u, sp * 0.5 * Math.random() + 1, Math.sin(a) * sp * u, 0.25 + Math.random() * 0.45, 0.09, -0.08, r * 3, g * 3, b * 3, 1, 15);
  }

  /** smoke, dust, the drift's charge in sparks, the boost's fire, and the lines on the road */
  private tyreFx(id: number, s: Sim, dt: number, near: number) {
    const k = s.kart, marks = this.marks.get(id)!;
    const sp = k.vel.length();
    // the exhaust on a boost: sparks of its own colour, thrown back past you
    if (k.boost > 0 && near < 60 * 60 && Math.random() < dt * 90) {
      const c = new THREE.Color(FLAME[k.boostKind]), x = (Math.random() < 0.5 ? -1 : 1) * 0.74;
      V.copy(k.pos).addScaledVector(k.ax, x).addScaledVector(k.az, -1.6).addScaledVector(k.ay, 0.05);
      this.sparks.add(V.x, V.y, V.z, -k.az.x * 9 + k.vel.x * 0.7 + (Math.random() - 0.5) * 2, Math.random() * 2, -k.az.z * 9 + k.vel.z * 0.7 + (Math.random() - 0.5) * 2, 0.26, 0.1, -0.1, c.r * 3, c.g * 3, c.b * 3, 1, 6);
    }
    k.wheels.forEach((w, j) => {
      const m = j >= 2 ? marks[j - 2] : null;
      // (a wheel skipping off the road for a moment doesn't end the line it's laying)
      if (!w.on || sp < 3) {
        if (m && sp < 3) m.on = false;
        return;
      }
      const dirt = w.mat >= Surf.Grass;
      const slide = Math.min(1, w.slide * 0.8);
      const wx = w.cx, wy = w.cy, wz = w.cz;
      if (dirt && Math.random() < dt * sp * 1.4) {
        const sand = w.mat === Surf.Gravel;
        this.smoke.add(wx, wy + 0.1, wz, -k.vel.x * 0.08 + (Math.random() - 0.5), 1.2 + Math.random(), -k.vel.z * 0.08 + (Math.random() - 0.5), 0.8, 0.6, 1.7, sand ? 0.86 : 0.5, sand ? 0.76 : 0.6, sand ? 0.56 : 0.28, 0.42);
      }
      if (j < 2) {
        // (locked or scrubbing fronts: a wisp)
        if (!dirt && slide > 0.5 && Math.random() < dt * 24) this.smoke.add(wx, wy + 0.08, wz, k.vel.x * 0.1, 0.5, k.vel.z * 0.1, 0.6, 0.45, 1.8, 0.92, 0.92, 0.94, 0.12);
        return;
      }
      // (real smoke is for a real slide: a tyre working near its limit only leaves a faint line)
      const burn = k.drifting ? Math.max(slide, 0.6) : k.bog > 0 ? 1 : slide - 0.42;
      if (!dirt && burn > 0 && near < 70 * 70 && Math.random() < dt * 84 * burn) this.smoke.add(wx + (Math.random() - 0.5) * 0.3, wy + 0.14, wz + (Math.random() - 0.5) * 0.3, k.vel.x * 0.2 + (Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 0.9, k.vel.z * 0.2 + (Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 0.6, 0.42, 2.4, 0.95, 0.95, 0.97, 0.07 + burn * 0.09);
      // the charge: amber, blue, pink, thrown back off the rears
      if (k.level > 0 && Math.random() < dt * (60 + k.level * 30)) {
        const c = RGB[k.level];
        this.sparks.add(wx, wy + 0.06, wz, -k.az.x * 5 + k.vel.x * 0.6 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, -k.az.z * 5 + k.vel.z * 0.6 + (Math.random() - 0.5) * 3, 0.32, 0.075, -0.05, c[0], c[1], c[2], 1, 14);
      }
      this.rubber(m!, wx, wy, wz, w, dirt, !dirt && (slide > 0.24 || k.drifting) ? Math.min(0.62, 0.1 + slide * 0.6) : dirt && sp > 5 ? 0.3 : 0);
    });
  }

  /** the next stretch of a wheel's line: edges square to the way it's going, sharing the last piece's edge so there's no gap */
  private rubber(m: Mark, x: number, y: number, z: number, w: { q: { nx: number; ny: number; nz: number } }, dirt: boolean, a: number) {
    const d = Math.hypot(x - m.x, y - m.y, z - m.z);
    if (a <= 0) {
      // (a slide that eases for a moment and comes back is one line, not a row of dashes)
      if (m.on && d > 1.6) m.on = false;
      return;
    }
    if (!m.on || d > 3 || dirt !== m.dirt) {
      m.on = true;
      m.dirt = dirt;
      m.x = x;
      m.y = y;
      m.z = z;
      m.a = 0;
      m.lx = m.rx = x;
      m.ly = m.ry = y;
      m.lz = m.rz = z;
      return;
    }
    if (d < 0.32) return;
    const tx = (x - m.x) / d, ty = (y - m.y) / d, tz = (z - m.z) / d, n = w.q, h = 0.13;
    const px = (n.ny * tz - n.nz * ty) * h, py = (n.nz * tx - n.nx * tz) * h, pz = (n.nx * ty - n.ny * tx) * h;
    const e: Edge = { lx: x + px, ly: y + py, lz: z + pz, rx: x - px, ry: y - py, rz: z - pz, a };
    if (dirt) this.skids.add(m, e, 0.2, 0.14, 0.07);
    else this.skids.add(m, e, 0.02, 0.02, 0.02);
    m.x = x;
    m.y = y;
    m.z = z;
    m.lx = e.lx;
    m.ly = e.ly;
    m.lz = e.lz;
    m.rx = e.rx;
    m.ry = e.ry;
    m.rz = e.rz;
    m.a = a;
  }

  private dash(s: Sim | undefined, t: number) {
    const e = this.hudEls;
    if (s) {
      const k = s.kart, sp = k.vel.length();
      if (this.flag < 0) {
        this.stats.top = Math.max(this.stats.top, sp);
        if (k.drifting && k.air < 0.05) this.stats.drift += this.frameDt;
      }
      setText(e.speed, String(Math.round(sp * 3.6)));
      setText(e.gear, k.gear === 0 ? 'R' : String(k.gear));
      const f = Math.min(1, k.rpm / KART.limit);
      e.rev.style.strokeDashoffset = (314.2 * (1 - f)).toFixed(1);
      e.gauge.classList.toggle('hot', k.rpm > 12900);
      e.gauge.classList.toggle('boost', k.boost > 0);
      setText(e.lap, String(Math.min(RACE.laps, s.lap + 1)));
      const go = this.course.state.go < 1e8 ? Math.max(0, t - this.course.state.go) : 0;
      const last = s.laps[s.laps.length - 1] ?? 0;
      if (this.flag < 0) setText(e.now, lapTime(Math.max(0, go - last)));
      if (s.bestLap !== this.bestSeen) {
        this.bestSeen = s.bestLap;
        e.best.textContent = s.bestLap ? `BEST ${lapTime(s.bestLap)}` : '';
      }
      // the drift's three steps, each filling as you hold it
      const C = KART.charge, bars = e.drift.children;
      for (let n = 0; n < 3; n++) {
        const a = n ? C[n - 1] : 0;
        (bars[n].firstElementChild as HTMLElement).style.transform = `scaleX(${THREE.MathUtils.clamp((k.driftT - a) / (C[n] - a), 0, 1).toFixed(3)})`;
      }
      e.drift.className = `mk-drift${k.drifting ? ' on' : ''} l${k.level}`;
      e.tow.textContent = s.sling > 0 ? 'SLINGSHOT READY: PULL OUT!' : 'SLIPSTREAM';
      e.tow.classList.toggle('on', k.draft > 0.3 || s.sling > 0);
      e.tow.classList.toggle('hot', s.sling > 0);
      e.help.classList.toggle('off', go > 7);
      e.launch.classList.toggle('on', this.goLeft >= 0);
      if (t > this.boardT) {
        this.boardT = t + 0.22;
        this.board(s, sp);
      }
    }
    // the map, a few times a second
    if (t < this.mapT) return;
    this.mapT = t + 0.08;
    const c = this.map;
    c.clearRect(0, 0, 340, 340);
    c.drawImage(this.mapBase, 0, 0);
    const all = this.beans();
    all.forEach((r, i) => {
      if (r.out && !r.fin) return;
      const k = this.sims[i].kart, [x, y] = this.toMap(k.pos.x, k.pos.z), me = r.c.player;
      c.beginPath();
      c.arc(x, y, me ? 10 : 6.5, 0, 7);
      c.fillStyle = `#${(r.c.outfit.a & 0xffffff).toString(16).padStart(6, '0')}`;
      c.fill();
      c.lineWidth = me ? 4 : 2;
      c.strokeStyle = me ? '#ffffff' : 'rgba(10,12,30,0.8)';
      c.stroke();
    });
  }
}

/** (the same text doesn't need writing again: that's a layout every frame) */
function setText(e: HTMLElement, v: string) {
  if (e.textContent !== v) e.textContent = v;
}

/** when the first red light comes on, in seconds before the off */
const LIGHTS = 2.1;

function lapTime(s: number) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const probeCam = { i: 0, s: 0, lat: 0, h: 0, nx: 0, ny: 1, nz: 0, mat: 0, wl: 9, wr: 9, lx: 1, ly: 0, lz: 0 };
