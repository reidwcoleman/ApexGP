import type { World } from './collide.ts';
import type { Door, MapData, Pane } from './world.ts';
import { Nav, type Node } from './nav.ts';
import { Bot, botName } from './bots.ts';
import { trace, type Tracer } from './ballistics.ts';
import { BOARDS, BOARDS_ALL, CHARGE_FUSE, F, GUN_LADDER, PRIMARIES, SIEGE, W_BOOT, WEAPONS, WEAPON_LIST, ZONE, hitDamage, oneLife, solo, type Ev, type MatchConfig, type NadeKind, type Phase, type PlayerInfo, type Req, type WeaponId, flaresAt, type FlareNow } from './shared.ts';
import { barPassable, openingsOf, type Opening } from './fort.ts';
import { Tactics } from './tactics.ts';
import { stepNade, type NadeSim } from './nade.ts';
import type { Body } from './hitbox.ts';

export interface BodyState extends Body {
  pitch: number;
  flags: number;
  w: number;
}

/** The match itself: runs in the host's browser (or alone, for solo play). */
export class Match {
  players: PlayerInfo[] = [];
  bodies: BodyState[] = [];
  bots = new Map<number, Bot>();
  phase: Phase = 'warmup';
  clock = 5;
  round = 1;
  score: [number, number] = [0, 0];
  holdZone = 0;
  holdOwner = -1;
  holdProg = 0;
  private respawn = new Map<number, number>();
  /** where each side starts this round: picked fresh every round, a long way apart */
  private anchors: { x: number; y: number; z: number }[] = [];
  /** on a map with sides: the teams have swapped ends this round */
  private swapped = false;
  /** seconds since the match began: the star shells run off it */
  elapsed = 0;
  private flareNow: FlareNow[] = [];
  private nades: (NadeSim & { id: number; s: number; kind: NadeKind; fuse: number })[] = [];
  private nadeId = 1;
  private holdTick = 0;
  private goals: Node[] = [];
  /** where each bot is headed when it isn't hunting: the others steer clear of it */
  private claimed = new Map<number, Node>();
  readonly nav: Nav;
  private doorCool: number[] = [];
  /** per slot: hp a second still leaving, and bandages left */
  private bleed = new Map<number, number>();
  private wraps = new Map<number, number>();
  private bleedTick = 0;

  // ---- the attack-and-defend game
  /** the side attacking this round */
  atk = 0;
  /** the room being fought over: its box (x0, y0, z0, x1, y1, z1) and the doorways into it */
  obj: { name: string; box: number[]; c: Node; doors: number[] } | null = null;
  readonly openings: Opening[];
  /** per doorway: which boards are up */
  bars: number[] = [];
  private barHp: number[][] = [];
  /** nav steps that cross a doorway: a * 65536 + b -> doorway */
  private barEdge = new Map<number, number>();
  private charges: { i: number; s: number; t: number; side: number }[] = [];
  private chargesLeft = new Map<number, number>();
  secureProg = 0;
  /** who is in the room: attackers, defenders */
  secureN: [number, number] = [0, 0];
  private secureTick = 0;
  private overtime = false;
  private lastObj = '';
  /** what each side knows: where one of the other side was last seen, and when (match seconds) */
  readonly intel: Map<number, { x: number; y: number; z: number; t: number }>[] = [new Map(), new Map(), new Map()];
  readonly tactics: Tactics;

  objName() {
    return this.obj ? Match.roomName(this.obj.name) : 'room';
  }
  /** the label a room goes by on the radio and the screen */
  static roomName(n: string) {
    return ROOM_NAMES[n] ?? n.replace(/_/g, ' ');
  }

  /** the rooms of this map that can be fought over: enclosed, with a doorway that takes a barricade and room to stand */
  private siegeRooms() {
    const out: NonNullable<Match['obj']>[] = [];
    for (const r of this.map.rooms) {
      if (!SIEGE_ROOMS.includes(r.name)) continue;
      const box = [r.a[0], r.a[1], r.a[2], r.b[0], r.b[1], r.b[2]];
      const doors = this.openings.filter((o) => {
        if (o.y < box[1] - 0.6 || o.y > box[1] + 0.6) return false;
        return o.alongX
          ? (Math.abs(o.z - box[2]) < 0.5 || Math.abs(o.z - box[5]) < 0.5) && o.x > box[0] - 0.2 && o.x < box[3] + 0.2
          : (Math.abs(o.x - box[0]) < 0.5 || Math.abs(o.x - box[3]) < 0.5) && o.z > box[2] - 0.2 && o.z < box[5] + 0.2;
      }).map((o) => o.i);
      const inside = this.nav.nodes.filter((n) => this.inBox(box, n.x, n.y, n.z, -0.3));
      // two ways in at least: a room with one door is a cupboard, not a fight
      if (doors.length < 2 || inside.length < 8) continue;
      // and one room, not a row of cells that only meet in the corridor: all of it walkable without leaving it
      const set = new Set(inside.map((n) => n.i)), seen = new Set<number>([inside[0].i]), q = [inside[0]];
      while (q.length) for (const k of q.pop()!.next) if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        q.push(this.nav.nodes[k]);
      }
      if (seen.size < inside.length * 0.9) continue;
      const cx = (box[0] + box[3]) / 2, cz = (box[2] + box[5]) / 2;
      const c = inside.reduce((b, n) => (Math.hypot(n.x - cx, n.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? n : b), inside[0]);
      out.push({ name: r.name, box, c, doors });
    }
    return out;
  }

  inBox(box: number[], x: number, y: number, z: number, grow = 0.25) {
    return x > box[0] - grow && x < box[3] + grow && z > box[2] - grow && z < box[5] + grow && y > box[1] - 0.6 && y < box[1] + 2.4;
  }
  inObj(x: number, y: number, z: number) {
    return !!this.obj && this.inBox(this.obj.box, x, y, z);
  }
  isDefender(slot: number) {
    return this.cfg.mode === 'siege' && this.teamOf(slot) !== this.atk;
  }
  /** may this one move and act right now? (in the preparation only the defenders) */
  active(slot: number) {
    return this.phase === 'live' || (this.phase === 'prep' && this.isDefender(slot));
  }

  /** what a step costs a side beyond its length: a barricade across it. Defenders go round their own; attackers would
   *  rather find an open way but will take a boarded one */
  stepCost(slot: number) {
    if (!this.bars.some((b) => b)) return undefined;
    const k = this.isDefender(slot) ? 30 : 18;
    return (a: number, b: number) => {
      const i = this.barEdge.get(a * 65536 + b);
      return i !== undefined && !barPassable(this.bars[i]) ? k : 0;
    };
  }

  /** the step from node a to node b goes through a doorway with boards across it: which doorway, or -1 */
  barOnStep(a: number, b: number) {
    const i = this.barEdge.get(a * 65536 + b);
    return i !== undefined && !barPassable(this.bars[i]) ? i : -1;
  }

  private setBar(i: number, boards: number, by = -1, blast = false) {
    if (this.bars[i] === boards) return;
    this.bars[i] = boards;
    this.emit({ t: 'bar', i, boards, by, blast });
  }

  /** nail one up: anyone alive, standing at the doorway, with nothing across it yet */
  build(slot: number, i: number) {
    const o = this.openings[i], b = this.bodies[slot];
    if (!o || this.bars[i] || !b || !this.players.find((p) => p.slot === slot)?.alive) return false;
    if (Math.hypot(b.x - o.x, b.z - o.z) > 2.4 || Math.abs(b.y - o.y) > 1.2) return false;
    // nobody stood in it
    for (const p of this.players) {
      if (!p.alive) continue;
      const q = this.bodies[p.slot];
      const across = o.alongX ? Math.abs(q.z - o.z) : Math.abs(q.x - o.x), along = o.alongX ? Math.abs(q.x - o.x) : Math.abs(q.z - o.z);
      if (across < 0.36 && along < o.w / 2 + 0.3 && Math.abs(q.y - o.y) < 1.2) return false;
    }
    this.barHp[i] = new Array(BOARDS).fill(2);
    this.setBar(i, BOARDS_ALL, slot);
    this.noise({ x: o.x, y: o.y + 1, z: o.z }, 22);
    return true;
  }

  /** rounds into boards: ids are doorway * 8 + board */
  barHit(ids: number[], k: number, by: number) {
    const touched = new Set<number>();
    for (const id of ids) {
      const i = id >> 3, b = id & 7;
      if (!(this.bars[i] >> b & 1)) continue;
      const hp = (this.barHp[i] ??= new Array(BOARDS).fill(2));
      hp[b] -= k;
      if (hp[b] <= 0) {
        this.bars[i] &= ~(1 << b);
        touched.add(i);
      }
    }
    for (const i of touched) this.emit({ t: 'bar', i, boards: this.bars[i], by });
  }

  /** a boot: the three lowest boards still up */
  barKick(slot: number, i: number) {
    const o = this.openings[i];
    if (!o || !this.bars[i]) return;
    let m = this.bars[i], n = 0;
    for (let b = 0; b < BOARDS && n < 3; b++) if (m >> b & 1) {
      m &= ~(1 << b);
      n++;
    }
    this.setBar(i, m, slot);
    this.noise({ x: o.x, y: o.y + 1, z: o.z }, 45);
  }

  /** a breaching charge on a barricade, from `side` of it */
  setCharge(slot: number, i: number, side: number) {
    const left = this.chargesLeft.get(slot) ?? SIEGE.charges;
    if (left <= 0 || !this.bars[i] || this.charges.some((c) => c.i === i)) return false;
    this.chargesLeft.set(slot, left - 1);
    this.charges.push({ i, s: slot, t: CHARGE_FUSE, side: side >= 0 ? 1 : -1 });
    this.emit({ t: 'charge', i, s: slot, side: side >= 0 ? 1 : -1, fuse: CHARGE_FUSE });
    return true;
  }
  chargesOf(slot: number) {
    return this.chargesLeft.get(slot) ?? SIEGE.charges;
  }
  chargeOn(i: number) {
    return this.charges.some((c) => c.i === i);
  }

  private siegeUpdate(dt: number) {
    for (let k = this.charges.length - 1; k >= 0; k--) {
      const c = this.charges[k];
      c.t -= dt;
      if (c.t > 0) continue;
      this.charges.splice(k, 1);
      const o = this.openings[c.i];
      if (!o) continue;
      this.setBar(c.i, 0, c.s, true);
      // it goes off into the room behind: whoever stood close to the boards is hurt, and nobody near sees for a moment
      const x = o.x - (o.alongX ? 0 : c.side * 0.7), z = o.z - (o.alongX ? c.side * 0.7 : 0);
      this.blast({ id: this.nadeId++, s: c.s, kind: 'frag', x, y: o.y + 1, z }, 0.45);
      for (const b of this.bots.values()) {
        const q = this.bodies[b.slot];
        const d = Math.hypot(q.x - x, q.z - z, q.y - o.y);
        if (d < 5 && this.players.find((p) => p.slot === b.slot)?.alive) b.flashed(0.55 * (1 - d / 5));
      }
    }
    if (this.phase !== 'live' || !this.obj) return;
    const n: [number, number] = [0, 0];
    for (const p of this.players) {
      if (!p.alive || p.team > 1) continue;
      const b = this.bodies[p.slot];
      if (this.inObj(b.x, b.y, b.z)) n[p.team === this.atk ? 0 : 1]++;
    }
    const before = this.secureProg;
    if (n[0] > 0 && n[1] === 0) this.secureProg = Math.min(1, this.secureProg + dt / SIEGE.secure);
    else if (n[0] === 0) this.secureProg = Math.max(0, this.secureProg - dt / (SIEGE.secure * 2));
    this.secureTick += dt;
    if (this.secureTick >= 0.25 && (before !== this.secureProg || n[0] !== this.secureN[0] || n[1] !== this.secureN[1])) {
      this.secureTick = 0;
      this.secureN = n;
      this.emit({ t: 'secure', prog: this.secureProg, n });
    }
    if (this.secureProg >= 1) return this.endRound(this.atk, `${Match.roomName(this.obj.name)} secured`);
    // the clock ran out with them in the room and nobody to stop them: it runs on until they have it, or lose it
    if (this.overtime && !(n[0] > 0 && n[1] === 0)) this.endRound(1 - this.atk, 'Time');
  }

  /** where the map's own lamps leave a pool someone can be seen in: x, y, z, reach */
  readonly pools: number[][] = [];
  /** a lamp shot out lights nobody: i is its place in the map's list */
  lampOut(i: number) {
    const k = this.pools.findIndex((p) => p[4] === i);
    if (k >= 0) this.pools.splice(k, 1);
  }
  /** is a body at this spot standing in light (a lamp's pool), not in the dark? */
  litAt(x: number, y: number, z: number) {
    // under a star shell the whole field is lit, except down in a trench
    for (const f of this.flareNow) {
      if (f.k < 0.3) continue;
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < 14 + f.y * 0.9 && y > -1.0) return true;
    }
    for (const [lx, ly, lz, r] of this.pools) {
      const dx = x - lx, dz = z - lz, dy = y + 1 - ly;
      if (dx * dx + dz * dz < r * r && dy > -3.2 && dy < 0.6) return true;
    }
    return false;
  }

  constructor(
    readonly cfg: MatchConfig,
    readonly world: World,
    readonly map: MapData,
    readonly doors: Door[],
    readonly panes: Pane[],
    nav: Nav,
    readonly emit: (e: Ev) => void,
  ) {
    this.nav = nav;
    this.goals = nav.nodes.filter((_, i) => i % 11 === 0);
    this.doorCool = doors.map(() => 0);
    this.openings = openingsOf(map.openings, world);
    this.bars = this.openings.map(() => 0);
    for (const o of this.openings) {
      for (const a of nav.nodes) {
        if (Math.abs(a.x - o.x) > 2.2 || Math.abs(a.z - o.z) > 2.2 || Math.abs(a.y - o.y) > 0.8) continue;
        for (const k of a.next) {
          const b = nav.nodes[k];
          const pa = o.alongX ? a.z - o.z : a.x - o.x, pb = o.alongX ? b.z - o.z : b.x - o.x;
          if (pa * pb > 0 || pa === pb) continue;
          const f = pa / (pa - pb);
          const at = o.alongX ? a.x + (b.x - a.x) * f - o.x : a.z + (b.z - a.z) * f - o.z;
          if (Math.abs(at) < o.w / 2 + 0.05) this.barEdge.set(a.i * 65536 + b.i, o.i);
        }
      }
    }
    this.tactics = new Tactics(this);
    if (map.night) map.lights.forEach((l, i) => { if (l.power > 2) this.pools.push([l.pos[0], l.pos[1], l.pos[2], Math.min(7, Math.max(1.6, Math.sqrt(l.power) * 0.9)), i]); });
  }

  addHuman(id: string, name: string, team: number, primary: WeaponId): PlayerInfo {
    const slot = this.freeSlot();
    const p: PlayerInfo = { slot, id, name, team: solo(this.cfg.mode) ? 2 : team, bot: false, primary: this.cfg.mode === 'gun' ? GUN_LADDER[0] : primary, kills: 0, deaths: 0, score: 0, ping: 0, hp: 100, alive: false };
    this.players.push(p);
    this.bodies[slot] = { x: 0, y: -50, z: 0, yaw: 0, pitch: 0, lean: 0, crouch: false, flags: 0, w: 0 };
    return p;
  }

  private freeSlot() {
    for (let i = 0; i < 16; i++) if (!this.players.some((p) => p.slot === i)) return i;
    return 15;
  }

  removeHuman(id: string) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i >= 0) {
      this.players.splice(i, 1);
      this.fillBots();
      this.emit({ t: 'roster', players: this.players });
    }
  }

  /** a person takes a bot's place */
  dropBot(team: number) {
    const i = this.players.findIndex((p) => p.bot && (p.team === team || p.team === 2));
    if (i < 0) return;
    const p = this.players[i];
    this.players.splice(i, 1);
    this.bots.delete(p.slot);
    this.respawn.delete(p.slot);
  }

  /** everything someone who has just walked in needs to be told */
  resync() {
    this.emit({ t: 'phase', phase: this.phase, round: this.round, clock: this.clock, score: this.score, hold: this.holdZone, ...this.siegeInfo() });
    if (this.cfg.mode !== 'siege') return;
    this.bars.forEach((b, i) => { if (b) this.emit({ t: 'bar', i, boards: b }); });
    this.emit({ t: 'secure', prog: this.secureProg, n: this.secureN });
  }

  joinNow(p: PlayerInfo) {
    if (this.players.includes(p) && !p.alive && this.phase !== 'over') this.spawn(p, false, this.phase === 'live');
  }

  /** bots make up the numbers: `cfg.bots` per side beyond the humans */
  fillBots() {
    const ffa = solo(this.cfg.mode);
    const want = this.cfg.bots;
    const teamsize = [0, 1].map((t) => this.players.filter((p) => p.team === t).length);
    for (let t = 0; t < (ffa ? 1 : 2); t++) {
      let have = ffa ? this.players.length : teamsize[t];
      while (have < want && this.players.length < 16) {
        const slot = this.freeSlot();
        const primary = this.cfg.mode === 'gun' ? GUN_LADDER[0] : rollPrimary();
        this.players.push({ slot, id: `bot-${slot}`, name: botName(slot + this.cfg.seed), team: ffa ? 2 : t, bot: true, primary, kills: 0, deaths: 0, score: 0, ping: 0, hp: 100, alive: false });
        this.bodies[slot] = { x: 0, y: -50, z: 0, yaw: 0, pitch: 0, lean: 0, crouch: false, flags: 0, w: 0 };
        const skill = Math.min(1, Math.max(0, this.cfg.skill + (Math.random() - 0.5) * 0.2));
        this.bots.set(slot, new Bot(this, slot, skill));
        have++;
      }
    }
  }

  start() {
    this.fillBots();
    this.emit({ t: 'roster', players: this.players });
    this.newRound(true);
  }

  /** what every phase message of the attack-and-defend game carries */
  private siegeInfo() {
    return this.cfg.mode === 'siege' && this.obj ? { atk: this.atk, obj: this.obj.box, objName: Match.roomName(this.obj.name) } : {};
  }

  private newRound(first: boolean) {
    const rounds = oneLife(this.cfg.mode);
    this.phase = 'warmup';
    this.clock = first ? 5 : 4;
    this.respawn.clear();
    for (const d of this.doors) this.setDoor(d.id, 0, 1);
    if (this.cfg.mode === 'siege') {
      // sides change every round; the room changes too
      this.atk = this.round % 2 === 1 ? 0 : 1;
      const rooms = this.siegeRooms();
      const pool = rooms.filter((r) => r.name !== this.lastObj);
      this.obj = (pool.length ? pool : rooms)[Math.floor(Math.random() * (pool.length || rooms.length))] ?? null;
      this.lastObj = this.obj?.name ?? '';
      for (let i = 0; i < this.bars.length; i++) this.setBar(i, 0);
      this.charges = [];
      this.chargesLeft.clear();
      this.secureProg = 0;
      this.secureN = [0, 0];
      this.overtime = false;
      this.intel.forEach((m) => m.clear());
      this.emit({ t: 'secure', prog: 0, n: [0, 0] });
    }
    this.emit({ t: 'phase', phase: this.phase, round: this.round, clock: this.clock, score: this.score, hold: this.holdZone, ...this.siegeInfo() });
    this.pickAnchors();
    this.tactics.newRound();
    for (const p of this.players) this.spawn(p, rounds);
  }

  private clockFor() {
    return this.cfg.mode === 'siege' ? SIEGE.live : this.cfg.mode === 'rounds' ? 240 : this.cfg.time * 60;
  }

  update(dt: number) {
    this.elapsed += dt;
    if (this.map.flares) flaresAt(this.elapsed, this.map.flares, this.flareNow);
    const live = this.phase === 'live';
    this.clock -= dt;
    if (this.phase === 'warmup' && this.clock <= 0 && this.cfg.mode === 'siege') {
      this.phase = 'prep';
      this.clock = SIEGE.prep;
      this.emit({ t: 'phase', phase: 'prep', round: this.round, clock: this.clock, score: this.score, ...this.siegeInfo() });
    } else if ((this.phase === 'warmup' || this.phase === 'prep') && this.clock <= 0) {
      this.phase = 'live';
      this.clock = this.clockFor();
      this.emit({ t: 'phase', phase: 'live', round: this.round, clock: this.clock, score: this.score, hold: this.holdZone, ...this.siegeInfo() });
    } else if (this.phase === 'live' && this.clock <= 0 && !this.overtime) {
      this.timeUp();
    } else if (this.phase === 'between' && this.clock <= 0) {
      this.round++;
      this.newRound(false);
    }
    for (const b of this.bots.values()) {
      const p = this.players.find((q) => q.slot === b.slot);
      if (!p?.alive) continue;
      b.update(dt, live || this.active(b.slot));
      const s = this.bodies[b.slot];
      s.x = b.m.x;
      s.y = b.m.y;
      s.z = b.m.z;
      s.yaw = b.yaw;
      s.pitch = b.pitch;
      s.crouch = b.crouch;
      s.lean = b.lean;
      s.w = WEAPON_LIST.indexOf(b.weapon);
      s.flags = F.alive | (b.crouch ? F.crouch : 0) | (b.ads ? F.ads : 0) | (b.light ? F.light : 0) | (b.reload > 0 ? F.reload : 0) | (Math.hypot(b.m.vx, b.m.vz) > 0.3 ? F.moving : 0) | (Math.hypot(b.m.vx, b.m.vz) > 4.2 ? F.sprint : 0);
    }
    const now = performance.now() / 1000;
    for (const [slot, at] of this.respawn) {
      if (now >= at && this.phase !== 'over' && !oneLife(this.cfg.mode)) {
        this.respawn.delete(slot);
        const p = this.players.find((q) => q.slot === slot);
        if (p) this.spawn(p, false, true);
      }
    }
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      stepNade(this.world, n, dt);
      n.fuse -= dt;
      if (n.fuse <= 0) {
        this.nades.splice(i, 1);
        this.blast(n);
      }
    }
    for (let i = 0; i < this.doorCool.length; i++) this.doorCool[i] -= dt;
    this.bleedTick += dt;
    if (this.bleedTick >= 1) {
      this.bleedTick -= 1;
      for (const [slot, rate] of this.bleed) {
        const p = this.players.find((q) => q.slot === slot);
        if (!p?.alive || !rate) continue;
        // a wound slows you down and ends a fight, it doesn't finish one on its own
        p.hp = Math.max(Math.min(p.hp, 8), p.hp - rate);
        if (!p.bot) this.emit({ t: 'hp', s: slot, hp: p.hp, bleed: rate });
        if (p.hp <= 8) this.bleed.delete(slot);
      }
    }
    if (live && this.cfg.mode === 'hold') this.holdUpdate(dt);
    if (this.cfg.mode === 'siege') this.siegeUpdate(dt);
    this.tactics.update(dt);
  }

  private blast(n: { id: number; s: number; kind: NadeKind; x: number; y: number; z: number }, k = 1) {
    this.emit({ t: 'boom', id: n.id, kind: n.kind, p: [n.x, n.y, n.z] });
    this.noise({ x: n.x, y: n.y, z: n.z }, 90);
    // the shock takes out nearby glass and throws doors open, flash or frag
    const reach = n.kind === 'frag' ? 7.5 : 3.5;
    this.panes.forEach((p, i) => {
      if (p.broken) return;
      const c = p.mesh.position;
      if (Math.hypot(c.x - n.x, c.y - n.y, c.z - n.z) < reach) this.emit({ t: 'pane', i, at: [n.x, n.y, n.z] });
    });
    if (n.kind === 'frag') for (const d of this.doors) {
      const c = d.centre;
      const dist = Math.hypot(c.x - n.x, c.y - n.y, c.z - n.z);
      if (dist > 5.2) continue;
      const side = d.alongX ? Math.sign(c.z - n.z) : Math.sign(c.x - n.x);
      this.emit({ t: 'door', i: d.id, open: 1, dir: side || 1, blast: 1 - dist / 5.2 });
    }
    if (n.kind !== 'frag') {
      // a flash works on them as it does on you: full in the face it's seconds of nothing, from behind hardly at all
      for (const b of this.bots.values()) {
        const o = this.bodies[b.slot];
        if (!this.players.find((p) => p.slot === b.slot)?.alive) continue;
        const dx = n.x - o.x, dz = n.z - o.z, d = Math.hypot(dx, dz, n.y - o.y - 1.5);
        if (d > 14 || !this.world.sees({ x: n.x, y: n.y + 0.2, z: n.z }, { x: o.x, y: o.y + 1.6, z: o.z })) continue;
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(-dx, -dz) - b.yaw), Math.cos(Math.atan2(-dx, -dz) - b.yaw)));
        b.flashed((1 - d / 14) * (off < 1.3 ? 1 : 0.3));
      }
      return;
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const b = this.bodies[p.slot];
      const d = Math.hypot(b.x - n.x, b.y + 1 - n.y, b.z - n.z);
      if (d > 9) continue;
      if (!this.world.sees({ x: n.x, y: n.y + 0.15, z: n.z }, { x: b.x, y: b.y + 1, z: b.z })) continue;
      const dmg = Math.round(170 * k * Math.max(0, 1 - d / 8) ** 1.4);
      if (dmg > 0) this.damage(n.s, p.slot, dmg, ZONE.blast, -1, [b.x - n.x, 0.2, b.z - n.z], d);
    }
  }

  private holdUpdate(dt: number) {
    const c = this.map.hold[this.holdZone];
    const n = [0, 0];
    for (const p of this.players) {
      if (!p.alive || p.team > 1) continue;
      const b = this.bodies[p.slot];
      if (Math.hypot(b.x - c[0], b.z - c[2]) < 6 && Math.abs(b.y - c[1]) < 4.5) n[p.team]++;
    }
    const lead = n[0] > n[1] ? 0 : n[1] > n[0] ? 1 : -1;
    if (lead >= 0 && !(n[0] && n[1])) {
      if (this.holdOwner !== lead) {
        this.holdProg += dt / 6;
        if (this.holdProg >= 1) {
          this.holdOwner = lead;
          this.holdProg = 0;
        }
      } else this.holdProg = Math.max(0, this.holdProg - dt);
    }
    this.holdTick += dt;
    if (this.holdTick >= 1) {
      this.holdTick -= 1;
      if (this.holdOwner >= 0) this.score[this.holdOwner] += 1;
      this.emit({ t: 'hold', zone: this.holdZone, owner: this.holdOwner, prog: this.holdProg, score: this.score });
      if (this.score[0] >= this.cfg.limit || this.score[1] >= this.cfg.limit) this.finish(this.score[0] > this.score[1] ? 0 : 1);
      // the fight moves on every minute and a half
      const elapsed = Math.floor(this.clockFor() - this.clock);
      const z = Math.floor(elapsed / 90) % this.map.hold.length;
      if (z !== this.holdZone) {
        this.holdZone = z;
        this.holdOwner = -1;
        this.holdProg = 0;
      }
    }
  }

  private timeUp() {
    if (this.cfg.mode === 'siege') {
      if (this.secureN[0] > 0 && this.secureN[1] === 0 && this.secureProg > 0) {
        this.overtime = true;
        this.clock = 0;
      } else this.endRound(1 - this.atk, 'Time');
    } else if (this.cfg.mode === 'rounds') {
      const a = this.players.filter((p) => p.team === 0 && p.alive).length, b = this.players.filter((p) => p.team === 1 && p.alive).length;
      this.endRound(a === b ? -1 : a > b ? 0 : 1, 'Time');
    } else if (solo(this.cfg.mode)) {
      const top = [...this.players].sort((p, q) => q.kills - p.kills)[0];
      this.finish(top?.slot ?? -1);
    } else this.finish(this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1);
  }

  private endRound(winner: number, why: string) {
    if (winner >= 0) this.score[winner]++;
    if (this.score[0] >= this.cfg.limit || this.score[1] >= this.cfg.limit) return this.finish(winner);
    this.phase = 'between';
    this.clock = 5;
    this.emit({ t: 'phase', phase: 'between', round: this.round, clock: 5, score: this.score, msg: why, winner, ...this.siegeInfo() });
  }

  finish(winner: number) {
    this.phase = 'over';
    this.clock = 14;
    this.emit({ t: 'phase', phase: 'over', round: this.round, clock: 14, score: this.score, winner });
    this.emit({ t: 'roster', players: this.players });
  }

  foes(a: number, b: number) {
    if (solo(this.cfg.mode)) return a !== b;
    const p = this.teamOf(a), q = this.teamOf(b);
    return p !== q;
  }

  teamOf(s: number) {
    return this.players.find((p) => p.slot === s)?.team ?? 2;
  }

  /** a place worth walking to */
  objective(slot: number): Node | null {
    if (this.cfg.mode === 'hold') {
      const c = this.map.hold[this.holdZone];
      const n = this.nav.nearest(c[0] + (Math.random() - 0.5) * 8, c[1], c[2] + (Math.random() - 0.5) * 8);
      if (n) return n;
    }
    // what the side knows: where one of them was seen not long ago. That is where most of it goes
    const team = Math.min(2, this.teamOf(slot));
    let fresh: { x: number; y: number; z: number; t: number } | null = null;
    for (const [s2, k] of this.intel[team]) {
      if (this.elapsed - k.t > 25 || !this.players.find((p) => p.slot === s2)?.alive || (team === 2 && s2 === slot)) continue;
      if (!fresh || k.t > fresh.t) fresh = k;
    }
    if (fresh && Math.random() < 0.6) {
      const n = this.nav.nearest(fresh.x + (Math.random() - 0.5) * 7, fresh.y, fresh.z + (Math.random() - 0.5) * 7);
      if (n) return n;
    }
    // a hunch, now and then, so a quiet building doesn't stay quiet: toward one of them, often the people playing
    const foes = this.players.filter((p) => p.alive && this.foes(slot, p.slot));
    if (foes.length && Math.random() < 0.14) {
      const me = this.bodies[slot];
      const humans = foes.filter((p) => !p.bot);
      let pick = foes[0];
      if (humans.length && Math.random() < 0.7) pick = humans[Math.floor(Math.random() * humans.length)];
      else {
        const by = foes.map((p) => [Math.hypot(this.bodies[p.slot].x - me.x, this.bodies[p.slot].z - me.z), p] as const).sort((a, b) => a[0] - b[0]);
        pick = by[Math.random() < 0.7 ? 0 : Math.min(1, by.length - 1)][1];
      }
      const b = this.bodies[pick.slot];
      const n = this.nav.nearest(b.x + (Math.random() - 0.5) * 9, b.y, b.z + (Math.random() - 0.5) * 9);
      if (n) return n;
    }
    // else where the shooting was lately
    const now = performance.now() / 1000;
    const hot = this.hot.filter((h) => now - h[3] < 25);
    if (hot.length && Math.random() < 0.3) {
      const h = hot[Math.floor(Math.random() * hot.length)];
      const n = this.nav.nearest(h[0] + (Math.random() - 0.5) * 8, h[1], h[2] + (Math.random() - 0.5) * 8);
      if (n) this.claimed.set(slot, n);
      if (n) return n;
    }
    // else work a part of the map nobody on the side is in or heading for: the team spreads through the building
    const mates = this.players.filter((p) => p.alive && p.slot !== slot && !this.foes(slot, p.slot));
    let best: Node | null = null, bs = -1;
    for (let k = 0; k < 10; k++) {
      const g = this.goals[Math.floor(Math.random() * this.goals.length)];
      if (!g) continue;
      let d = 60;
      for (const q of mates) {
        const b = this.bodies[q.slot];
        d = Math.min(d, Math.hypot(b.x - g.x, b.z - g.z, (b.y - g.y) * 3));
        const c = this.claimed.get(q.slot);
        if (c) d = Math.min(d, Math.hypot(c.x - g.x, c.z - g.z, (c.y - g.y) * 3));
      }
      const s = d + Math.random() * 6;
      if (s > bs) {
        bs = s;
        best = g;
      }
    }
    if (best) this.claimed.set(slot, best);
    return best;
  }

  openDoorsNear(x: number, y: number, z: number, dx: number, dz: number) {
    for (const d of this.doors) {
      if (d.want > 0 || this.doorCool[d.id] > 0) continue;
      const c = d.centre;
      if (Math.abs(c.y - 1 - y) > 1.5) continue;
      const ex = c.x - x, ez = c.z - z;
      const dist = Math.hypot(ex, ez);
      if (dist < 1.5 && (ex * dx + ez * dz >= 0 || !dx)) this.useDoor(d.id, [x, y, z]);
    }
  }

  private setDoor(i: number, open: number, dir: number) {
    this.emit({ t: 'door', i, open, dir });
  }

  useDoor(i: number, from: [number, number, number]) {
    const d = this.doors[i];
    if (!d || this.doorCool[i] > 0) return;
    this.doorCool[i] = 0.55;
    const side = d.alongX ? Math.sign(from[2] - d.centre.z) : Math.sign(from[0] - d.centre.x);
    const dir = -(side || 1);
    this.setDoor(i, d.want > 0 ? 0 : 1, dir);
  }

  /** somewhere a whole side can stand: indoors, with room round it, and the other side's somewhere far from it */
  private pickAnchors() {
    if (this.cfg.mode === 'siege' && this.obj) {
      // the defenders in the room; the attackers a long walk from it, somewhere with space to stand
      const c = this.obj.c;
      const N = this.nav.nodes.filter((n) => n.indoors !== false && n.next.length >= 5);
      const far = N.map((n) => [Math.hypot(n.x - c.x, n.z - c.z) + Math.abs(n.y - c.y) * 4, n] as const).filter((e) => e[0] > 24).sort((a, b) => b[0] - a[0]);
      const pick = far.length ? far[Math.floor(Math.random() * Math.min(far.length, 40))][1] : N[0] ?? c;
      this.anchors = [];
      this.anchors[this.atk] = pick;
      this.anchors[1 - this.atk] = c;
      return;
    }
    if (this.map.sides) {
      // each side in its own trenches, a different stretch of them each round, and now and then the other end
      this.swapped = Math.random() < 0.5;
      const pick = (l: number[][]) => {
        const c = l[Math.floor(Math.random() * l.length)];
        return { x: c[0], y: c[1], z: c[2] };
      };
      this.anchors = this.swapped ? [pick(this.map.spawns.b), pick(this.map.spawns.a)] : [pick(this.map.spawns.a), pick(this.map.spawns.b)];
      return;
    }
    const N = this.nav.nodes.filter((n) => n.indoors !== false && n.next.length >= 3);
    this.anchors = [];
    if (N.length < 20) return;
    const roomy = (c: { x: number; y: number; z: number }) => {
      let k = 0;
      for (let i = 0; i < N.length && k < 14; i++) if (Math.hypot(N[i].x - c.x, N[i].z - c.z, (N[i].y - c.y) * 3) < 8) k++;
      return k >= 14;
    };
    let a = N[Math.floor(Math.random() * N.length)];
    for (let t = 0; t < 30 && !roomy(a); t++) a = N[Math.floor(Math.random() * N.length)];
    let b = a, bs = -1;
    for (let k = 0; k < 90; k++) {
      const c = N[Math.floor(Math.random() * N.length)];
      const d = Math.hypot(c.x - a.x, c.z - a.z, (c.y - a.y) * 3);
      // far, but not always the very farthest corner: the pairings vary
      const sc = d * (0.7 + Math.random() * 0.6) * (roomy(c) ? 1 : 0.4);
      if (sc > bs) {
        bs = sc;
        b = c;
      }
    }
    this.anchors = Math.random() < 0.5 ? [a, b] : [b, a];
  }

  private spawn(p: PlayerInfo, fixed: boolean, near = false) {
    void fixed;
    let list = solo(this.cfg.mode) ? this.map.spawns.ffa : (p.team === 0) !== this.swapped ? this.map.spawns.a : this.map.spawns.b;
    if (this.map.sides && !solo(this.cfg.mode)) {
      // on a field with two lines you start, and come back, in your own trenches: near your side's stretch at first
      const a = this.anchors[p.team];
      if (a && !near) {
        const pool = list.filter((c) => Math.hypot(c[0] - a.x, c[2] - a.z) < 16);
        if (pool.length >= 3) list = pool;
      }
      near = false;
    } else if (!near && this.nav.nodes.length) {
      if (solo(this.cfg.mode)) {
        // everyone somewhere different, and somewhere different every time
        const pool: number[][] = [];
        for (let k = 0; k < 40; k++) {
          const n = this.nav.nodes[Math.floor(Math.random() * this.nav.nodes.length)];
          if (n && n.indoors !== false && n.next.length >= 2) pool.push([n.x, n.y, n.z]);
        }
        if (pool.length > 8) list = pool;
      } else {
        const a = this.anchors[p.team];
        if (a) {
          const obj = this.cfg.mode === 'siege' && p.team !== this.atk ? this.obj : null;
          const pool = this.nav.nodes.filter((n) => (obj ? this.inBox(obj.box, n.x, n.y, n.z, -0.4) : n.indoors !== false && n.next.length >= 2 && Math.hypot(n.x - a.x, n.z - a.z, (n.y - a.y) * 3) < (this.cfg.mode === 'siege' ? 6 : 9))).map((n) => [n.x, n.y, n.z]);
          if (pool.length >= 4) list = pool;
        }
      }
    }
    if (near && !oneLife(this.cfg.mode) && this.nav.nodes.length) {
      // back in near the fight: anywhere on the map, scored below by who's about
      const extra: number[][] = [];
      for (let k = 0; k < 40; k++) {
        const n = this.nav.nodes[Math.floor(Math.random() * this.nav.nodes.length)];
        if (n) extra.push([n.x, n.y, n.z]);
      }
      list = [...list, ...extra];
    }
    const others = this.players.filter((q) => q.alive && this.foes(p.slot, q.slot));
    let best = list[0], bs = -1e9;
    for (let k = 0; k < (near ? 46 : 10); k++) {
      const c = near ? list[k % list.length] : list[Math.floor(Math.random() * list.length)];
      let s = Math.random() * 3;
      let closest = 1e9;
      // a bot comes back within reach of the people playing, if it's against any of them
      const people = p.bot ? others.filter((q) => !q.bot) : [];
      const ref = people.length ? people : others;
      for (const q of ref) {
        const b = this.bodies[q.slot];
        closest = Math.min(closest, Math.hypot(b.x - c[0], b.z - c[2], (b.y - c[1]) * 2));
      }
      for (const q of others) {
        const b = this.bodies[q.slot];
        const d = Math.hypot(b.x - c[0], b.z - c[2], (b.y - c[1]) * 2);
        if (!near) s += Math.min(d, 28) * 0.1;
        if (d < 14) s -= near ? 24 : 8;
        if (this.world.sees({ x: c[0], y: c[1] + 1.5, z: c[2] }, { x: b.x, y: b.y + 1.5, z: b.z })) s -= near ? 40 : 12;
      }
      if (near && others.length) {
        // not on top of a fight, not across the world from one
        s += closest > 18 && closest < 60 ? 14 : closest >= 60 ? 14 - (closest - 60) * 0.4 : 0;
        // and somewhere nobody else is: a crowd doesn't come back in one corner
        let anyone = 60;
        for (const q of this.players) if (q !== p && q.alive) anyone = Math.min(anyone, Math.hypot(this.bodies[q.slot].x - c[0], this.bodies[q.slot].z - c[2], (this.bodies[q.slot].y - c[1]) * 3));
        s += Math.min(anyone, 30) * 0.7;
      }
      for (const q of this.players) if (q !== p && q.alive && Math.hypot(this.bodies[q.slot].x - c[0], this.bodies[q.slot].z - c[2]) < 1.6 && Math.abs(this.bodies[q.slot].y - c[1]) < 1.5) s -= 20;
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    // spawns sit on the walkable graph: a bed or a counter isn't somewhere to stand
    const nn = this.nav.nearest(best[0], best[1], best[2]);
    if (nn && Math.hypot(nn.x - best[0], nn.z - best[2]) < 3 && Math.abs(nn.y - best[1]) < 1) best = [nn.x, nn.y, nn.z];
    const jx = (Math.random() - 0.5) * 1.2, jz = (Math.random() - 0.5) * 1.2;
    let x = best[0] + jx, z = best[2] + jz;
    if (this.world.blocked(x, best[1] + 0.1, z, 0.3, 1.7)) {
      x = best[0];
      z = best[2];
    }
    const y = Math.max(this.world.floorAt(x, best[1] + 0.5, z, 0.2), best[1]);
    // face the middle of the block
    const foe = !solo(this.cfg.mode) ? this.anchors[1 - p.team] : undefined;
    const [cx, cz] = foe ? [foe.x, foe.z] : (this.map.centre ?? [46, -30]);
    const yaw = Math.atan2(-(cx - x), -(cz - z));
    p.hp = 100;
    p.alive = true;
    this.bleed.delete(p.slot);
    this.wraps.set(p.slot, 2);
    const b = this.bodies[p.slot];
    b.x = x;
    b.y = y;
    b.z = z;
    b.yaw = yaw;
    b.flags = F.alive;
    const bot = this.bots.get(p.slot);
    if (this.cfg.mode === 'gun') p.primary = GUN_LADDER[Math.min(p.kills, GUN_LADDER.length - 1)];
    else if (bot) p.primary = rollPrimary(p.primary);
    bot?.reset(x, y, z, yaw, p.primary);
    this.emit({ t: 'spawn', s: p.slot, p: [x, y, z], yaw, primary: p.primary });
  }

  /** a request from a player in the game */
  handle(slot: number, r: Req) {
    const me = this.players.find((p) => p.slot === slot);
    if (!me) return;
    switch (r.t) {
      case 'shot':
        this.emit({ t: 'shot', s: slot, w: r.w, o: r.o, e: r.e, surf: r.surf });
        this.noise({ x: r.o[0], y: r.o[1], z: r.o[2] }, WEAPONS[WEAPON_LIST[r.w]].loud);
        break;
      case 'hit':
        if (me.alive && this.foes(slot, r.to)) this.damage(slot, r.to, r.dmg, r.zone, r.w, r.dir, r.dist);
        break;
      case 'door':
        this.useDoor(r.i, r.from);
        break;
      case 'kick': {
        const d = this.doors[r.i];
        if (!d || this.doorCool[r.i] > 0) break;
        this.doorCool[r.i] = 0.8;
        const side = d.alongX ? Math.sign(r.from[2] - d.centre.z) : Math.sign(r.from[0] - d.centre.x);
        this.emit({ t: 'door', i: r.i, open: 1, dir: -(side || 1), blast: 0.55 });
        this.noise({ x: d.centre.x, y: d.centre.y, z: d.centre.z }, 40);
        break;
      }
      case 'heal': {
        const left = this.wraps.get(slot) ?? 2;
        if (!me.alive || left <= 0 || this.cfg.mode === 'siege') break;
        this.wraps.set(slot, left - 1);
        me.hp = Math.min(100, me.hp + 35);
        this.bleed.delete(slot);
        this.emit({ t: 'hp', s: slot, hp: me.hp, bleed: 0, healed: true });
        break;
      }
      case 'pane':
        this.emit({ t: 'pane', i: r.i, at: r.at });
        break;
      case 'nade': {
        const id = this.nadeId++;
        this.nades.push({ id, s: slot, kind: r.kind, x: r.o[0], y: r.o[1], z: r.o[2], vx: r.v[0], vy: r.v[1], vz: r.v[2], fuse: r.fuse, rest: false });
        this.emit({ t: 'nade', s: slot, kind: r.kind, o: r.o, v: r.v, fuse: r.fuse, id });
        break;
      }
      case 'chat':
        this.emit({ t: 'chat', from: me.name, text: String(r.text).slice(0, 120) });
        break;
      case 'bar':
        if (me.alive && this.active(slot)) this.build(slot, r.i);
        break;
      case 'barhit':
        if (me.alive) this.barHit(r.ids.slice(0, 24), Math.min(2, Math.max(0.5, r.k)), slot);
        break;
      case 'barkick':
        if (me.alive && this.active(slot)) this.barKick(slot, r.i);
        break;
      case 'charge':
        if (me.alive && this.phase === 'live') this.setCharge(slot, r.i, r.side);
        break;
      case 'me':
        if (r.primary && PRIMARIES.includes(r.primary) && this.cfg.mode !== 'gun') me.primary = r.primary;
        break;
    }
  }

  /** the radio: one of them says something to its own side. One voice at a time, and not all the time */
  private saidAt = [-9, -9];
  say(slot: number, text: string, chance = 1) {
    if (solo(this.cfg.mode) || Math.random() > chance) return;
    const p = this.players.find((q) => q.slot === slot);
    if (!p || p.team > 1 || !this.players.some((q) => !q.bot && q.team === p.team)) return;
    const now = performance.now() / 1000;
    if (now - this.saidAt[p.team] < 3.2) return;
    this.saidAt[p.team] = now;
    this.emit({ t: 'chat', from: p.name, text, team: p.team });
  }

  /** who a bot keeps company with: on a side with people playing, two in five of its bots go where their person goes */
  buddyFor(slot: number): number {
    if (this.cfg.mode !== 'tdm' && this.cfg.mode !== 'rounds') return -1;
    const me = this.players.find((q) => q.slot === slot);
    if (!me) return -1;
    const humans = this.players.filter((q) => !q.bot && q.team === me.team);
    const bots = this.players.filter((q) => q.bot && q.team === me.team);
    const i = bots.indexOf(me);
    if (i < 0) return -1;
    const escorts = humans.length ? Math.max(1, Math.round(bots.length * 0.4)) : 0;
    if (i < escorts) return humans[i % humans.length].slot;
    // the rest work in pairs: every second one keeps to the one before it
    const k = i - escorts;
    return k % 2 === 1 ? bots[i - 1].slot : -1;
  }

  /** a bot throws one at where it last saw someone: only with a clear line there, and never onto its own side */
  botNade(b: Bot, kind: NadeKind, at: { x: number; y: number; z: number }) {
    const m = b.m;
    const dx = at.x - m.x, dz = at.z - m.z, d = Math.hypot(dx, dz) || 1;
    const o: [number, number, number] = [m.x + (dx / d) * 0.45, m.y + 1.5, m.z + (dz / d) * 0.45];
    if (!this.world.sees({ x: o[0], y: o[1], z: o[2] }, { x: at.x, y: at.y + 0.8, z: at.z })) return false;
    for (const p of this.players) {
      if (!p.alive || p.slot === b.slot || this.foes(b.slot, p.slot)) continue;
      const q = this.bodies[p.slot];
      if (Math.hypot(q.x - at.x, q.z - at.z) < (kind === 'frag' ? 7.5 : 4)) return false;
    }
    if (kind === 'frag' && d < 9) return false;
    const sp = 13;
    const th = 0.5 * Math.asin(Math.min(0.98, (9.8 * d) / (sp * sp))) - 0.03 + (Math.random() - 0.5) * (0.1 - b.skill * 0.06);
    const yaw = Math.atan2(dx, dz) + (Math.random() - 0.5) * (0.16 - b.skill * 0.1);
    const v: [number, number, number] = [Math.sin(yaw) * Math.cos(th) * sp, Math.sin(th) * sp, Math.cos(yaw) * Math.cos(th) * sp];
    const fuse = kind === 'frag' ? 2.4 : 1.7;
    const id = this.nadeId++;
    this.nades.push({ id, s: b.slot, kind, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], fuse, rest: false });
    this.emit({ t: 'nade', s: b.slot, kind, o, v, fuse, id });
    this.say(b.slot, kind === 'frag' ? pick(['Frag out!', 'Grenade!']) : pick(['Flash out!', 'Flashing!', 'Bang going in!']));
    return true;
  }

  /** something tossed round a door frame: from a point, at a speed, by someone standing beside it */
  toss(slot: number, kind: NadeKind, o: [number, number, number], v: [number, number, number]) {
    const fuse = kind === 'frag' ? 2.4 : 1.7;
    const id = this.nadeId++;
    this.nades.push({ id, s: slot, kind, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], fuse, rest: false });
    this.emit({ t: 'nade', s: slot, kind, o, v, fuse, id });
    this.say(slot, kind === 'frag' ? pick(['Frag out!', 'Grenade!']) : pick(['Flash out!', 'Flashing!', 'Bang going in!']));
  }

  /** a bot of this side near enough to have seen it */
  private witness(team: number, at: { x: number; y: number; z: number }, not: number) {
    let best = -1, bd = 22;
    for (const b of this.bots.values()) {
      const p = this.players.find((q) => q.slot === b.slot);
      if (!p?.alive || p.team !== team || b.slot === not) continue;
      const o = this.bodies[b.slot];
      const d = Math.hypot(o.x - at.x, o.z - at.z);
      if (d < bd) {
        bd = d;
        best = b.slot;
      }
    }
    return best;
  }

  botFire(b: Bot, w: number) {
    const id = WEAPON_LIST[w];
    const spec = WEAPONS[id];
    const m = b.m;
    const ox = m.x, oy = m.y + (b.crouch ? 1.05 : 1.5), oz = m.z;
    const out: Tracer = { e: [], surf: [], hits: [], panes: [] };
    const bodies: [number, BodyState][] = this.players.filter((p) => p.alive).map((p) => [p.slot, this.bodies[p.slot]]);
    for (let i = 0; i < spec.pellets; i++) {
      const sp = ((spec.pellets > 1 ? spec.hip : 0.3 + (1 - b.skill) * 0.8 + b.sprayErr()) * Math.PI) / 180;
      const yaw = b.yaw + gauss() * sp, pitch = b.pitch + gauss() * sp;
      const cp = Math.cos(pitch);
      trace(this.world, bodies, ox, oy, oz, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp, spec, b.slot, out);
    }
    out.panes.forEach((i, n) => this.emit({ t: 'pane', i, at: out.paneAt?.[n] }));
    if (out.bars?.length) this.barHit(out.bars, spec.wreck, b.slot);
    this.emit({ t: 'shot', s: b.slot, w, o: [ox, oy, oz], e: out.e, surf: out.surf });
    this.noise({ x: ox, y: oy, z: oz }, spec.loud);
    for (const h of out.hits) {
      if (!this.foes(b.slot, h.slot)) continue;
      // bots hit a little softer than people in the body: they don't flinch, tire or miss on purpose. A round in the
      // head is a round in the head
      const dmg = Math.round(hitDamage(spec, h.zone, h.k) * (h.zone === 0 ? 1 : 0.78 + b.skill * 0.2));
      this.damage(b.slot, h.slot, dmg, h.zone, w, [h.at[0] - ox, h.at[1] - oy, h.at[2] - oz], h.dist);
    }
  }

  noise(p: { x: number; y: number; z: number }, loud: number) {
    for (const b of this.bots.values()) b.hear(p, loud);
    if (loud >= 50) {
      this.hot.push([p.x, p.y, p.z, performance.now() / 1000]);
      if (this.hot.length > 24) this.hot.shift();
    }
  }

  /** where the shooting has been: x, y, z, when */
  private hot: number[][] = [];

  /** a bot that's seen someone tells its side; the ones near enough with nothing better to do come */
  callout(slot: number, p: { x: number; y: number; z: number }) {
    for (const b of this.bots.values()) {
      if (b.slot === slot || this.foes(slot, b.slot)) continue;
      const o = this.bodies[b.slot];
      if (Math.hypot(o.x - p.x, o.z - p.z) < 50) b.hear(p, 1e9);
    }
  }

  damage(by: number, to: number, dmg: number, zone: number, w: number, dir: [number, number, number], dist: number) {
    const p = this.players.find((q) => q.slot === to);
    if (!p?.alive || this.phase === 'over' || this.phase === 'between') return;
    // nobody is hurt by anybody else while the room is being got ready
    if (this.phase === 'prep' && by !== to) return;
    p.hp = Math.max(0, p.hp - dmg);
    if (p.hp > 0 && dmg >= 18 && zone !== ZONE.blast && this.cfg.mode !== 'siege') this.bleed.set(to, Math.min(3, (this.bleed.get(to) ?? 0) + 1));
    const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d: [number, number, number] = [dir[0] / n, dir[1] / n, dir[2] / n];
    const atk = this.bodies[by];
    this.bots.get(to)?.hurt(atk ?? this.bodies[to]);
    if (p.hp > 0) {
      this.emit({ t: 'hit', s: to, by, dmg, hp: p.hp, zone, dir: d, bleed: this.bleed.get(to) ?? 0 });
      return;
    }
    p.alive = false;
    p.deaths++;
    this.bleed.delete(to);
    this.bodies[to].flags &= ~F.alive;
    const killer = this.players.find((q) => q.slot === by);
    if (killer && killer !== p) {
      killer.kills++;
      killer.score += zone === 0 ? 150 : 100;
    }
    this.emit({ t: 'die', s: to, by, zone, w, dir: d, dist });
    if (killer && killer !== p && killer.team < 2 && p.team < 2) {
      // the radio after a kill: the one who did it, or someone who watched a person do it; and the side that lost one
      const kb = this.bodies[by];
      if (killer.bot) this.say(by, pick(["He's down.", 'Got one.', 'Target down.', 'One less.', zone === 0 ? 'Headshot.' : 'Dropped him.']), 0.45);
      else {
        const w2 = this.witness(killer.team, kb, by);
        if (w2 >= 0) this.say(w2, pick(['Nice shot.', 'Good kill.', `Good hit, ${killer.name}.`, 'Keep it up.', zone === 0 ? 'Clean. Right in the head.' : "That's one."]), 0.5);
      }
      const w3 = this.witness(p.team, this.bodies[to], to);
      if (w3 >= 0) this.say(w3, pick(['Man down!', `${p.name} is down!`, `We lost ${p.name}.`, "They got one of ours."]), 0.6);
    }
    const mode = this.cfg.mode;
    if (mode === 'tdm' && killer && killer !== p && killer.team < 2) {
      this.score[killer.team]++;
      this.emit({ t: 'phase', phase: this.phase, round: this.round, clock: this.clock, score: this.score });
      if (this.score[killer.team] >= this.cfg.limit) this.finish(killer.team);
    }
    if (mode === 'gun' && killer && killer !== p) {
      // a boot costs whoever it lands on a gun
      if (w === W_BOOT && p.kills > 0) p.kills = Math.max(0, p.kills - 2);
      const next = GUN_LADDER[Math.min(killer.kills, GUN_LADDER.length - 1)];
      if (killer.kills < this.cfg.limit && next !== killer.primary) {
        killer.primary = next;
        this.bots.get(killer.slot)?.rearm(next);
        this.emit({ t: 'arm', s: killer.slot, primary: next, step: killer.kills });
      }
    }
    if (solo(mode) && killer && killer.kills >= this.cfg.limit) this.finish(killer.slot);
    // nobody goes looking for the dead
    for (const k of this.intel) k.delete(to);
    if (oneLife(mode)) {
      const a = this.players.some((q) => q.team === 0 && q.alive), b = this.players.some((q) => q.team === 1 && q.alive);
      if ((this.phase === 'live' || this.phase === 'prep') && (!a || !b)) this.endRound(a ? 0 : 1, mode === 'siege' ? ((a ? 0 : 1) === this.atk ? 'Defenders eliminated' : 'Attackers eliminated') : 'Eliminated');
    } else this.respawn.set(to, performance.now() / 1000 + (p.bot ? 5 : 7.4));
    this.emit({ t: 'roster', players: this.players });
  }
}

/** rooms worth fighting over, and what they are called */
const SIEGE_ROOMS = ['pharm', 'theatre', 'records', 'morgue', 'kitchen', 'xray', 'children', 'office', 'lab', 'staff', 'canteen', 'dorm', 'iso_a', 'boiler', 'cold_meat', 'cold_frozen', 'loft', 'triage', 'exam', 'side_a', 'side_b', 'dayroom', 'ward_n', 'scrub', 'stockroom', 'chapel', 'nurse'];
const ROOM_NAMES: Record<string, string> = {
  pharm: 'Pharmacy', theatre: 'Theatre', records: 'Records', morgue: 'Morgue', kitchen: 'Kitchen', xray: 'X-ray', children: "Children's ward", office: 'Office', lab: 'Laboratory', staff: 'Staff room',
  canteen: 'Canteen', dorm: 'Dormitory', iso_a: 'Isolation', boiler: 'Boiler room', cold_meat: 'Meat store', cold_frozen: 'Freezer', loft: 'Loft', triage: 'Triage', exam: 'Exam room', side_a: 'Side ward A',
  side_b: 'Side ward B', dayroom: 'Day room', ward_n: 'North ward', scrub: 'Scrub room', stockroom: 'Stockroom', chapel: 'Chapel', nurse: "Nurses' station",
};

function rollPrimary(prev?: WeaponId): WeaponId {
  const r = Math.random();
  return prev && r < 0.7 ? prev : r < 0.62 ? 'carbine' : r < 0.86 ? 'shotgun' : 'rifle';
}

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 0.8;
}
