import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { GATES } from './course-gates.ts';
import { CUP_COLORS, CUP_NAMES, bowlBallArt, cupBallArt, fenceBallArt, hoopBallArt, pushBallArt, volleyBallArt, type BowlDrive, type BowlSpot, type CupArena, type CupBall, type CupCfg } from './course-soccer.ts';

/**
 * Bean Cup's rules. The balls are the host's: it moves them, works out the kicks from wherever the
 * beans are, and tells everyone. A guest runs the same flight between the host's reports (no kicks)
 * and eases back onto them, so a ball never stutters.
 */

interface Who {
  c: { id: number; name: string; player: boolean; human: boolean; owner?: string; skill?: number };
  m: Marble;
  out: boolean;
  local: boolean;
}

export type CupEvent =
  | { k: 'goal'; team: number; by: number; own: boolean; ball: number; a: number; b: number; pts?: number }
  | { k: 'kick'; ball: number; id: number; v: number; shot: boolean }
  | { k: 'hit'; id: number; vx: number; vy: number; vz: number }
  | { k: 'bang'; ball: number; v: number }
  /** Bean Bowl: the ball's changed hands. `id` has it now (-1: it's loose), `was` had it (-1: nobody); `how` it happened */
  | { k: 'bowl'; id: number; was: number; how: 'pick' | 'catch' | 'steal' | 'fumble' | 'pass' | 'snap' | 'hand' }
  /** something for the announcer to say (Bean Bowl: the down and distance, how a play came out) */
  | { k: 'say'; a: string; b: string; big: boolean }
  /** Gate Crashers: a ball's gone through a gate (whose it was is the gate's to say) */
  | { k: 'gate'; ball: number; gate: number; by: number };

const P = new THREE.Vector3(), N = new THREE.Vector3(), AX = new THREE.Vector3();
/** Bean Hoops: how near the iron the middle of the ball can come (less than the ball: a rim that size and a ball that size would never go in) */
const RIM = 0.82;
const UPY = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);

// ---- Bean Bowl's playbook
/** how many of a side of n block on the line (the rest: a quarterback, a back from five up, receivers) */
const OLINE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 5];
/** the routes: steps of [toward the middle of the field, up it], in metres from where the receiver lines up */
const ROUTES: Record<string, number[][]> = {
  go: [[0, 30]],
  slant: [[0, 3], [7, 10], [11, 17]],
  out: [[0, 6.5], [-4.5, 7], [-4.5, 13]],
  curl: [[0, 8.5], [1.6, 6.5]],
  cross: [[0, 4], [13, 7.5], [19, 9.5]],
  post: [[0, 7.5], [7, 18], [9, 27]],
  block: [],
};
const ROUTE_CALL: Record<string, string> = { go: 'GO: straight up the field, deep', slant: 'SLANT: three steps, then cut in', out: 'OUT: up, then cut to the sideline', curl: 'CURL: up, then turn back for it', cross: 'CROSS: across the middle', post: 'POST: up, then in to the posts', block: 'block your defender' };
/** the plays: what the receivers run (the widest first), what the back does, and is it a run */
export const PLAYS: { name: string; run: boolean; wr: string[]; rb: string }[] = [
  { name: 'SLANTS', run: false, wr: ['slant', 'slant'], rb: 'flat' },
  { name: 'FOUR VERTICALS', run: false, wr: ['go', 'post'], rb: 'flat' },
  { name: 'OUTS', run: false, wr: ['out', 'curl'], rb: 'block' },
  { name: 'CURLS', run: false, wr: ['curl', 'cross'], rb: 'flat' },
  { name: 'CROSSERS', run: false, wr: ['cross', 'go'], rb: 'block' },
  { name: 'POST AND OUT', run: false, wr: ['post', 'out'], rb: 'flat' },
  { name: 'DIVE', run: true, wr: ['block'], rb: 'dive' },
  { name: 'SWEEP', run: true, wr: ['block'], rb: 'sweep' },
];
const ordinalOf = (n: number) => ['', '1ST', '2ND', '3RD', '4TH'][n] ?? `${n}TH`;
const Q = new THREE.Quaternion();

export class CupPlay {
  readonly arena: CupArena;
  /** this pitch's numbers (Bean Cup, Big Push or Over the Fence) */
  readonly cfg: CupCfg;
  readonly score = [0, 0];
  /** seconds the ball's spent in each team's attacking half: the last word if nothing else settles it */
  readonly attack = [0, 0];
  overtime = false;
  /** the second ball's in */
  second = false;
  private meshes: THREE.Mesh[] = [];
  private marks: THREE.Mesh[] = [];
  private rings: THREE.InstancedMesh;
  private M = new THREE.Matrix4();
  private col = new THREE.Color();
  private S = new THREE.Vector3();
  private net: { p: THREE.Vector3; v: THREE.Vector3 }[];

  constructor(
    course: Course,
    private scene: THREE.Scene,
    private who: () => Who[],
  ) {
    this.arena = course.cup!;
    const C = (this.cfg = this.arena.cfg);
    this.arena.pass = (id, tx, tz) => void (this.relay ? this.relay(id, tx, tz) : this.pass(id, tx, tz, this.now));
    this.arena.handoff = (from, to) => void this.handoff(from, to);
    if (C.rule === 'bowl') this.arena.bowl = { D: this.drive, spot: (id) => this.lineup().get(id), meet: (id, fx, fz) => this.meet(id, fx, fz) };
    const tex = C.rule === 'push' ? pushBallArt() : C.rule === 'fence' ? fenceBallArt() : C.rule === 'volley' ? volleyBallArt() : C.rule === 'hoops' ? hoopBallArt() : C.rule === 'bowl' ? bowlBallArt() : cupBallArt();
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
    // (a football's long: its tips along its own y, laid over on its side)
    const geo = C.rule === 'bowl' ? new THREE.SphereGeometry(C.R, 40, 28).scale(0.74, 1.42, 0.74).rotateZ(Math.PI / 2) : new THREE.SphereGeometry(C.R, 40, 28);
    const ringGeo = new THREE.RingGeometry(C.R * 0.9, C.R * 1.15, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < this.arena.balls.length; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      const k = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
      m.visible = k.visible = false;
      scene.add(m, k);
      this.meshes.push(m);
      this.marks.push(k);
    }
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.66, 0.085, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ toneMapped: false }), 24);
    this.rings.frustumCulled = false;
    this.rings.setColorAt(0, this.col.set(0xffffff));
    scene.add(this.rings);
    this.net = this.arena.balls.map(() => ({ p: new THREE.Vector3(), v: new THREE.Vector3() }));
    if (C.rule === 'bowl') {
      // the lines television draws: the line of scrimmage (blue) and the line to gain (yellow)
      const bar = new THREE.PlaneGeometry(C.HW * 2 - 0.5, 0.34).rotateX(-Math.PI / 2);
      const mk = (color: number, opacity: number) => new THREE.Mesh(bar, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
      this.losLine = mk(0x2f7bff, 0.85);
      this.firstLine = mk(0xffd21f, 0.9);
      this.routeArt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      this.aimRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.11, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
      for (const o of [this.losLine, this.firstLine, this.routeArt, this.aimRing]) {
        o.visible = false;
        o.frustumCulled = false;
        o.renderOrder = 2;
        scene.add(o);
      }
    }
  }
  private losLine?: THREE.Mesh;
  private firstLine?: THREE.Mesh;
  private routeArt?: THREE.Mesh;
  private aimRing?: THREE.Mesh;
  private routeKey = '';
  /** (a guest) a throw by one of this browser's beans is the host's to make: this sends it there */
  relay: ((id: number, tx: number, tz: number) => void) | null = null;
  /** Bean Bowl: the bean you'd throw to if you threw now (-1: nobody; a ring's drawn at its feet) */
  aimAt = -1;
  /** the play drawn on the grass: your own route, or (you're the quarterback) every receiver's */
  private drawRoutes() {
    const A = this.arena, D = this.drive, y = A.center.y + 0.07, art = this.routeArt!;
    const me = this.who().find((r) => r.c.player && !r.out);
    const S = this.lineup(), mine = me ? S.get(me.m.id) : undefined;
    const b = A.balls[0];
    const show = !!me && !!mine && this.teamOf(me.c.id) === D.off && !D.turned && (D.phase === 'set' || (D.phase === 'live' && !D.passed && b.held === D.qb));
    art.visible = show;
    if (!show) return;
    const key = `${D.seq}:${this.spotKey}:${me!.m.id}`;
    if (key === this.routeKey) return;
    this.routeKey = key;
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    const seg = (x0: number, z0: number, x1: number, z1: number, w: number) => {
      const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) || 1, nx = (-dz / d) * w, nz = (dx / d) * w;
      pos.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz, x1 + nx, y, z1 + nz, x0 - nx, y, z0 - nz, x1 - nx, y, z1 - nz);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    };
    for (const [id, sp] of S) {
      if (!sp.route.length || (mine!.role !== 'QB' && id !== me!.m.id)) continue;
      c.set(id === me!.m.id ? 0xffe14a : 0xffffff);
      let x = sp.x, z = sp.z;
      sp.route.forEach(([rx, rz], k) => {
        seg(x, z, rx, rz, 0.13);
        if (k === sp.route.length - 1) {
          // the arrowhead
          const dx = rx - x, dz = rz - z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
          pos.push(rx + ux * 0.9, y, rz + uz * 0.9, rx - uz * 0.5, y, rz + ux * 0.5, rx + uz * 0.5, y, rz - ux * 0.5);
          for (let q = 0; q < 3; q++) col.push(c.r, c.g, c.b);
        }
        x = rx;
        z = rz;
      });
    }
    art.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    art.geometry = g;
  }
  dispose() {
    for (const o of [...this.meshes, ...this.marks]) this.scene.remove(o);
    for (const o of [this.losLine, this.firstLine, this.routeArt, this.aimRing]) {
      if (!o) continue;
      this.scene.remove(o);
      (o.material as THREE.Material).dispose();
      if (o !== this.firstLine) o.geometry.dispose();
    }
    this.scene.remove(this.rings);
    this.rings.dispose();
  }

  teamOf(id: number) {
    return this.arena.of.get(id) ?? 0;
  }
  nameOf(id: number) {
    return CUP_NAMES[this.teamOf(id)];
  }
  mine() {
    const p = this.who().find((r) => r.c.player);
    if (!p || this.arena.gates) return null;
    const t = this.teamOf(p.c.id);
    return { name: CUP_NAMES[t], color: CUP_COLORS[t] };
  }
  /** the side going home */
  loser() {
    const [a, b] = this.score;
    if (a !== b) return a < b ? 0 : 1;
    return this.attack[0] < this.attack[1] ? 0 : 1;
  }
  /** is it all over, x seconds after the off? */
  done(x: number) {
    const C = this.cfg;
    if (x < C.T) return false;
    if (this.score[0] !== this.score[1]) return true;
    return x > C.T + C.over;
  }
  /** Over the Fence: how many balls are lying in a team's yard (its score is the other yard's) */
  inYard(team: number) {
    return this.score[team === 0 ? 1 : 0];
  }
  board() {
    // (the final: who's still in, the ones still in first)
    if (this.arena.gates) {
      const G = this.arena.gates;
      return this.who()
        .map((r) => ({ name: r.c.player ? 'YOU' : r.c.name.toUpperCase().slice(0, 9), color: G.list.find((g) => g.owner === r.c.id)?.col ?? 0xffffff, share: r.out ? 0 : 1, mine: r.c.player, label: r.out ? 'OUT' : '♥'.repeat(Math.max(1, G.lives.get(r.c.id) ?? 1)), out: r.out }))
        .sort((a, b) => Number(a.out) - Number(b.out))
        .slice(0, 8);
    }
    const me = this.mine()?.name;
    if (this.cfg.rule === 'fence') {
      const n = this.arena.balls.length;
      return CUP_NAMES.map((name, i) => ({ name, color: CUP_COLORS[i], share: 1 - this.inYard(i) / n, mine: name === me, label: `${this.inYard(i)} IN YARD` }));
    }
    const top = Math.max(1, this.score[0], this.score[1]);
    return CUP_NAMES.map((n, i) => ({ name: n, color: CUP_COLORS[i], share: this.score[i] / top, mine: n === me, label: String(this.score[i]) }));
  }
  /** the score line, as the HUD and the banner say it */
  line() {
    if (this.arena.gates) return `${this.who().filter((r) => !r.out).length} LEFT`;
    if (this.cfg.rule === 'fence') return `${CUP_NAMES[0]} YARD ${this.inYard(0)} · ${CUP_NAMES[1]} YARD ${this.inYard(1)}`;
    if (this.cfg.rule === 'bowl' && this.drive.seq) return `${CUP_NAMES[0]} ${this.score[0]} - ${this.score[1]} ${CUP_NAMES[1]} · ${ordinalOf(this.drive.down)} & ${this.toGo()}`;
    return `${CUP_NAMES[0]} ${this.score[0]} - ${this.score[1]} ${CUP_NAMES[1]}`;
  }

  /** a ball onto the pitch from above, where nobody's standing on it */
  private drop(b: CupBall, x: number, z = 0) {
    const A = this.arena;
    b.pos.set(A.center.x + x, A.center.y + 9, A.center.z + z);
    b.vel.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
    b.live = true;
    b.backAt = 0;
    b.last = b.prev = -1;
    b.by[0] = b.by[1] = -1;
    b.byT[0] = b.byT[1] = -99;
    b.worth = 2;
    b.py = b.pos.y;
    b.held = b.thrower = b.fumbler = -1;
    b.inAir = false;
    b.gripT = 0;
  }
  /** kick off: the first ball down */
  start() {
    const A = this.arena, C = this.cfg;
    if (A.gates) return this.dropIn(A.balls[0]);
    if (C.rule === 'bowl') return this.bowlStart(this.now);
    if (C.rule === 'volley') return this.serve(Math.random() < 0.5 ? 0 : 1);
    if (C.rule !== 'fence') return this.drop(A.balls[0], 0);
    // (Over the Fence: half the balls in each yard, spread across it)
    A.balls.forEach((b, i) => {
      const half = A.balls.length / 2, k = Math.floor(i / 2);
      this.drop(b, ((k + 0.5) / half - 0.5) * (C.HW * 1.5), (i % 2 ? 1 : -1) * C.HL * 0.45);
    });
  }

  /** Gate Crashers: a ball comes down a little way out from the middle, anywhere round it */
  private dropIn(b: CupBall) {
    const a = Math.random() * Math.PI * 2;
    this.drop(b, Math.cos(a) * 4.5, Math.sin(a) * 4.5);
  }
  /** which of the later balls have come in */
  private more = [true, false, false, false];
  /** half the angle of an open gate, now (the game sets it), and the gate a ball's just gone through */
  gateHalf = 0.2;
  private through = -1;

  // ------------------------------------------------------------------------------ Bean Bowl
  /**
   * Football by the downs (BowlDrive in course-soccer.ts). Every play: both sides line up on the
   * line of scrimmage in a formation, the ball's snapped to the quarterback, and it's live until
   * the bean with the ball is tackled (knocked over, wrapped up, or with a defender on it for a
   * moment), a pass hits the ground, or it's a touchdown. Then the down and the distance are
   * worked out and they line up again. All of it is the host's; the guests are told the drive.
   */
  readonly drive: BowlDrive = { off: 0, down: 1, los: 0, first: 0, phase: 'set', snapAt: 0, liveAt: 0, deadAt: 0, qb: -1, play: 0, run: false, seq: 0, passed: false, turned: false };
  /** what happens when they line up again (worked out at the whistle) */
  private nextUp: { off: number; down: number; los: number } | null = null;
  /** the game so far, for the tests and the summary */
  readonly stats = { plays: 0, runs: 0, firsts: 0, complete: 0, incomplete: 0, picks: 0, sacks: 0, tds: 0, turnovers: 0, yards: [0, 0] };
  private bowlStart(t: number) {
    const C = this.cfg, b = this.arena.balls[0];
    this.drop(b, 0);
    this.nextUp = { off: Math.random() < 0.5 ? 0 : 1, down: 1, los: 0 };
    this.nextUp.los = -(this.nextUp.off === 0 ? 1 : -1) * (C.HL - C.endZone) * 0.5;
    this.drive.deadAt = t;
    this.drive.phase = 'dead';
    this.setUp(t, 3.4);
  }
  /** they line up for the next play: the down and distance as worked out, a quarterback, a play called */
  private setUp(t: number, wait = 2.7) {
    const D = this.drive, C = this.cfg, n = this.nextUp ?? { off: D.off, down: D.down, los: D.los };
    const play = C.HL - C.endZone, dir = n.off === 0 ? 1 : -1;
    const newSeries = n.off !== D.off || n.down === 1;
    D.off = n.off;
    D.down = n.down;
    D.los = THREE.MathUtils.clamp(n.los, -play + 0.5, play - 0.5);
    // (a new set of downs: ten yards on from here, or the goal line if that's nearer)
    if (newSeries || !D.seq) D.first = THREE.MathUtils.clamp(D.los + (dir * 10) / this.ypm, -play, play);
    this.nextUp = null;
    D.phase = 'set';
    D.snapAt = t + wait;
    D.passed = D.turned = false;
    D.seq++;
    const side = this.who().filter((r) => r.m.active && !r.out && this.teamOf(r.c.id) === D.off).sort((p, q) => p.c.id - q.c.id);
    const people = side.filter((r) => r.c.human), bots = side.filter((r) => !r.c.human);
    // the play: a run or a pass (short to go: run it more; long: throw it), then which
    const togo = (D.first - D.los) * dir * this.ypm;
    const run = side.length >= 5 && Math.random() < (togo <= 3 ? 0.6 : togo > 12 || (D.down >= 3 && togo > 5) ? 0.06 : 0.36);
    const book = PLAYS.map((_, k) => k).filter((k) => PLAYS[k].run === run && k !== D.play);
    D.play = book[Math.floor(Math.random() * book.length)] ?? 0;
    D.run = PLAYS[D.play].run;
    // the quarterback: a person if the side has one (they take turns). On a run the person's
    // the running back instead (lineup puts them there), and a bot hands it to them
    const qb = D.run && bots.length ? bots[0] : people.length ? people[D.seq % people.length] : side[0];
    D.qb = qb ? qb.m.id : -1;
    this.pend.push({ k: 'say', a: `${ordinalOf(D.down)} & ${this.toGo()}`, b: `${CUP_NAMES[D.off]} ball ${this.where(D.los)}`, big: false });
  }
  /** yards to a metre: the field between the goal lines is a hundred yards */
  get ypm() {
    return 50 / (this.cfg.HL - this.cfg.endZone);
  }
  /**
   * The game clock stops at the whistle and starts again at the snap: this is how long it's
   * been stopped (the round's two minutes are two minutes of football).
   */
  stopped = 0;
  /** yards to the line to gain ("GOAL" inside the ten) */
  toGo() {
    const D = this.drive, C = this.cfg, dir = D.off === 0 ? 1 : -1;
    if (Math.abs(D.first) >= C.HL - C.endZone - 0.01) return 'GOAL';
    return String(Math.max(1, Math.round((D.first - D.los) * dir * this.ypm)));
  }
  /** where a line is, the way a commentator says it: "on the PINK 35" */
  where(z: number) {
    const yard = Math.round(50 - Math.abs(z) * this.ypm);
    if (yard >= 50) return 'at midfield';
    return `on the ${CUP_NAMES[z < 0 ? 0 : 1]} ${Math.max(1, yard)}`;
  }
  /** the play called now, by name */
  playName() {
    return PLAYS[this.drive.play]?.name ?? '';
  }
  private spotKey = '';
  private spotStamp = -1;
  private spotSeq = -1;
  private spots = new Map<number, BowlSpot>();
  /**
   * The formation: where every bean lines up for this play and what its job is. Worked out from
   * who's on each side (in id order), the line of scrimmage and the play, so every browser gets
   * the same answer and puts its own beans in their places.
   */
  lineup() {
    const D = this.drive, A = this.arena, C = this.cfg;
    if (this.spotStamp === this.now && this.spotSeq === D.seq) return this.spots;
    const all = this.who().filter((r) => r.m.active && !r.out);
    const key = `${D.seq}:${D.off}:${D.qb}:${D.play}:${D.los.toFixed(2)}:${all.map((r) => r.c.id).join(',')}`;
    this.spotStamp = this.now;
    this.spotSeq = D.seq;
    if (key === this.spotKey) return this.spots;
    this.spotKey = key;
    const S = this.spots;
    S.clear();
    const dir = D.off === 0 ? 1 : -1, cx = A.center.x, cz = A.center.z;
    const los = cz + D.los;
    const bots1st = (p: Who, q: Who) => Number(p.c.human) - Number(q.c.human) || p.c.id - q.c.id;
    const off = all.filter((r) => this.teamOf(r.c.id) === D.off && r.m.id !== D.qb).sort(bots1st);
    const def = all.filter((r) => this.teamOf(r.c.id) !== D.off).sort(bots1st);
    const qb = all.find((r) => r.m.id === D.qb);
    const n = off.length + (qb ? 1 : 0);
    const P = PLAYS[D.play] ?? PLAYS[0];
    const yawOff = dir > 0 ? 0 : Math.PI, yawDef = dir > 0 ? Math.PI : 0;
    const clampX = (x: number) => THREE.MathUtils.clamp(x, cx - C.HW + 1.3, cx + C.HW - 1.3);
    const clampZ = (z: number) => THREE.MathUtils.clamp(z, cz - C.HL + 0.9, cz + C.HL - 0.9);
    /** a route: steps of [toward the middle, up the field] from where it lines up */
    const route = (x0: number, z0: number, steps: number[][], lat = 0) => {
      const inX = lat || -(Math.sign(x0 - cx) || 1);
      return steps.map(([a, u]) => [clampX(x0 + a * inX), clampZ(z0 + u * dir)] as [number, number]);
    };
    if (qb) S.set(qb.m.id, { x: cx, z: clampZ(los - dir * 3.4), yaw: yawOff, role: 'QB', route: [], call: P.run ? `hand it off: ${P.name}` : `throw it: ${P.name}`, man: -1 });
    const nOL = OLINE[Math.min(12, n)], nRB = n >= 5 ? 1 : 0;
    // (a run: a person carries it, if there's one: they take it in turns)
    const folk = off.filter((r) => r.c.human).sort((p, q) => p.c.id - q.c.id);
    if (P.run && nRB && folk.length) {
      const back = folk[D.seq % folk.length];
      off.splice(off.indexOf(back), 1);
      off.splice(Math.min(nOL, off.length), 0, back);
    }
    const rbSide = D.seq % 2 ? 1 : -1;
    const wrs: { id: number; x: number }[] = [];
    let wr = 0;
    off.forEach((r, k) => {
      if (k < nOL) {
        S.set(r.m.id, { x: cx + (k - (nOL - 1) / 2) * 1.7, z: clampZ(los - dir * 0.7), yaw: yawOff, role: 'OL', route: [], call: 'block for the quarterback', man: -1 });
      } else if (k < nOL + nRB) {
        const x0 = cx + rbSide * 1.9, z0 = clampZ(los - dir * 4.8);
        const steps = P.rb === 'dive' ? [[-rbSide * 1.2, 1.6], [-rbSide * 1.6, 10], [-rbSide * 1.6, 30]] : P.rb === 'sweep' ? [[-rbSide * 1.2, 1.4], [rbSide * 9.5, 2.5], [rbSide * 11, 30]] : P.rb === 'flat' ? [[rbSide * 5, 4.2], [rbSide * 8.5, 8.5], [rbSide * 8.5, 15]] : [];
        S.set(r.m.id, { x: x0, z: z0, yaw: yawOff, role: 'RB', route: route(x0, z0, steps, 1), call: P.rb === 'block' ? 'block for the quarterback' : P.rb === 'flat' ? 'out to the flat for a short pass' : 'take the hand-off and run', man: -1 });
      } else {
        // the receivers: out wide, left and right by turns, the first two widest
        const slot = Math.floor(wr / 2), s = wr % 2 ? 1 : -1;
        const x0 = cx + s * (C.HW - 2.3 - slot * 3.5), z0 = clampZ(los - dir * 0.75);
        const kind = P.run ? 'block' : P.wr[Math.min(slot, P.wr.length - 1)];
        S.set(r.m.id, { x: x0, z: z0, yaw: yawOff, role: 'WR', route: route(x0, z0, ROUTES[kind] ?? []), call: ROUTE_CALL[kind] ?? 'get open', man: -1 });
        wrs.push({ id: r.m.id, x: x0 });
        wr++;
      }
    });
    // the defence: a rusher for every blocker (one at least), a corner on every receiver, then
    // linebackers underneath and a safety deep
    const m = def.length;
    const nDL = Math.min(m, Math.max(nOL, m >= 3 ? 1 : 0));
    const nCB = Math.min(wrs.length, m - nDL);
    const rest = m - nDL - nCB, nS = rest >= 4 ? 2 : rest >= 1 ? 1 : 0, nLB = rest - nS;
    def.forEach((r, k) => {
      if (k < nDL) S.set(r.m.id, { x: cx + (k - (nDL - 1) / 2) * 1.7, z: clampZ(los + dir * 0.9), yaw: yawDef, role: 'DL', route: [], call: 'rush the quarterback', man: -1 });
      else if (k < nDL + nCB) {
        const w = wrs[k - nDL];
        S.set(r.m.id, { x: w.x, z: clampZ(los + dir * 3.2), yaw: yawDef, role: 'CB', route: [], call: 'cover your receiver', man: w.id });
      } else if (k < nDL + nCB + nLB) {
        const j = k - nDL - nCB;
        S.set(r.m.id, { x: cx + ((j + 0.5) / nLB - 0.5) * Math.min(13, nLB * 4.5), z: clampZ(los + dir * 5.2), yaw: yawDef, role: 'LB', route: [], call: 'stop the run, watch the short pass', man: -1 });
      } else {
        const j = k - nDL - nCB - nLB;
        S.set(r.m.id, { x: cx + ((j + 0.5) / nS - 0.5) * 13, z: clampZ(los + dir * 11.5), yaw: yawDef, role: 'S', route: [], call: 'stay deep: nothing gets behind you', man: -1 });
      }
    });
    return S;
  }
  private say(a: string, b: string, big = true) {
    this.pend.push({ k: 'say', a, b, big });
  }
  private bowl(b: CupBall, i: number, dt: number, t: number, ev: CupEvent[], all: Who[]) {
    const A = this.arena, C = this.cfg, D = this.drive, y0 = A.center.y, cz = A.center.z;
    this.engage(dt);
    b.live = true;
    b.backAt = 0;
    if (D.phase === 'set') {
      // on the line, waiting for the snap
      b.held = -1;
      b.inAir = false;
      b.pos.set(A.center.x, y0 + C.R, cz + D.los);
      b.vel.set(0, 0, 0);
      for (const r of all) r.m.carry = false;
      if (t < D.snapAt) return;
      const side = all.filter((r) => r.m.active && !r.out && this.teamOf(r.c.id) === D.off);
      const qb = side.find((r) => r.m.id === D.qb) ?? side[0];
      D.phase = 'live';
      D.liveAt = t;
      b.gripT = 0;
      b.thrower = -1;
      this.stats.plays++;
      if (qb) {
        D.qb = qb.m.id;
        b.held = qb.m.id;
        ev.push({ k: 'bowl', id: b.held, was: -1, how: 'snap' });
      } else this.whistle(t, 'tackle', cz + D.los);
      return;
    }
    if (D.phase === 'dead') {
      // (it lies where the play ended)
      if (b.held < 0) {
        this.fly(b, dt, null, i);
        this.hold(b, 0, 0, null, i);
        b.vel.x *= 0.9;
        b.vel.z *= 0.9;
      }
      if (t >= D.deadAt) this.setUp(t);
      return;
    }
    const holder = b.held >= 0 ? all.find((r) => r.m.id === b.held) : undefined;
    for (const r of all) r.m.carry = r === holder;
    if (b.held >= 0) {
      const m = holder?.m;
      if (!holder || !m || holder.out || !m.active) return this.whistle(t, 'tackle', b.pos.z);
      b.pos.set(m.pos.x, m.pos.y + 1.4, m.pos.z);
      b.vel.copy(m.vel);
      const team = this.teamOf(m.id), dir = team === 0 ? 1 : -1;
      this.attack[team] += dt;
      if ((m.pos.z - cz) * dir > C.HL - C.endZone && m.pos.y < y0 + 2.6) {
        this.score[team] += 7;
        this.stats.tds++;
        b.held = -1;
        m.carry = false;
        b.vel.set(0, 4, 0);
        ev.push({ k: 'goal', team, by: m.id, own: false, ball: i, a: this.score[0], b: this.score[1], pts: 7 });
        // (the other side's ball, on its own 25)
        const other = team === 0 ? 1 : 0;
        this.nextUp = { off: other, down: 1, los: -(other === 0 ? 1 : -1) * (C.HL - C.endZone) * 0.5 };
        D.phase = 'dead';
        D.deadAt = t + C.restart;
        return;
      }
      // tackled: knocked off its feet, wrapped up, or a defender on it for a moment
      let touch = false;
      for (const r of all) {
        if (!r.m.active || r.out || this.teamOf(r.c.id) === team || r.m.mode === Mode.Tumble || r.m.blockK < 1) continue;
        if ((r.m.pos.x - m.pos.x) ** 2 + (r.m.pos.z - m.pos.z) ** 2 < 1.32 * 1.32 && Math.abs(r.m.pos.y - m.pos.y) < 1.6) touch = true;
      }
      b.gripT = m.heldT > 0 || touch ? b.gripT + dt : Math.max(0, b.gripT - dt * 2);
      if (m.mode === Mode.Tumble || b.gripT > 0.36 || t - D.liveAt > 18) this.whistle(t, 'tackle', m.pos.z);
      return;
    }
    // in the air
    const n = 4, h = dt / n;
    for (let k = 0; k < n && b.held < 0 && D.phase === 'live'; k++) {
      this.down = -1;
      this.fly(b, h, ev, i);
      if (this.down === i || b.pos.y < y0 + C.R + 0.05) b.inAir = false;
      // (a pass that's hit the ground is over)
      if (!b.inAir) {
        this.hold(b, 0, 0, null, i);
        return this.whistle(t, 'incomplete', b.pos.z);
      }
      // (a pass that's been knocked down is nobody's: it falls incomplete)
      for (const r of b.fumbler >= 0 ? [] : all) {
        const m = r.m;
        if (!m.active || r.out || m.frozen || m.mode === Mode.Tumble) continue;
        if (m.id === b.thrower && t - b.passT < 0.5) continue;
        // (not on its way up over the line, not by whoever's just had a hand on it, and never by a lineman)
        if (b.vel.y > 0 && t - b.passT < 0.45) continue;
        const mine = this.teamOf(m.id) === D.off;
        if (mine && this.lineup().get(m.id)?.role === 'OL') continue;
        P.set(m.pos.x, m.pos.y + 0.75, m.pos.z);
        // (a receiver's hands are bigger than a defender's)
        if (P.distanceToSquared(b.pos) > (C.R + (mine ? (r.c.human ? 1.2 : 1.0) : 0.72)) ** 2) continue;
        if (!mine && this.whiff.has(m.id)) continue;
        // (a defender who gets to it: half the time it can't get a hand on it; else it knocks it
        // down, or now and then comes away with it)
        const roll = mine ? 1 : Math.random();
        if (roll < 0.5) {
          this.whiff.add(m.id);
          continue;
        }
        if (roll < 0.9) {
          // broken up: knocked down, incomplete
          b.vel.set(b.vel.x * 0.25, -4, b.vel.z * 0.25);
          b.fumbler = m.id;
          b.dropT = t;
          ev.push({ k: 'bowl', id: -1, was: m.id, how: 'fumble' });
          break;
        }
        b.held = m.id;
        b.inAir = false;
        b.gripT = 0;
        this.touched(b, m.id, t);
        if (mine) this.stats.complete++;
        else {
          this.stats.picks++;
          D.turned = true;
          this.say('INTERCEPTED!', `${r.c.human && r.c.player ? 'You' : r.c.name} picked it off`);
        }
        ev.push({ k: 'bowl', id: m.id, was: b.thrower, how: mine ? 'catch' : 'steal' });
        break;
      }
      this.hold(b, 0, 0, null, i);
    }
  }
  /**
   * The whistle: the play's over. Where the ball is now is the next line of scrimmage; it's a
   * first down if that's past the line to gain, a turnover if it was fourth down and it isn't.
   */
  private whistle(t: number, kind: 'tackle' | 'incomplete', zAbs: number) {
    const D = this.drive, C = this.cfg, b = this.arena.balls[0], cz = this.arena.center.z;
    const play = C.HL - C.endZone, dir = D.off === 0 ? 1 : -1, other = D.off === 0 ? 1 : 0;
    const carrier = b.held;
    const sacked = kind === 'tackle' && carrier === D.qb && !D.passed && !D.turned;
    b.held = -1;
    b.inAir = false;
    for (const r of this.who()) r.m.carry = false;
    D.phase = 'dead';
    D.deadAt = t + 1.25;
    const z = THREE.MathUtils.clamp(zAbs - cz, -C.HL + 0.5, C.HL - 0.5);
    if (kind === 'incomplete') {
      this.stats.incomplete++;
      if (D.down >= 4) {
        this.stats.turnovers++;
        this.nextUp = { off: other, down: 1, los: D.los };
        this.say('INCOMPLETE', `Turnover on downs: ${CUP_NAMES[other]} ball`);
      } else {
        this.nextUp = { off: D.off, down: D.down + 1, los: D.los };
        this.say('INCOMPLETE', 'No gain');
      }
      return;
    }
    if (D.turned) {
      // an interception: theirs, where the runner was brought down (in its own end zone: out to the 20)
      const nd = other === 0 ? 1 : -1;
      this.stats.turnovers++;
      this.nextUp = { off: other, down: 1, los: z * nd < -play ? -nd * play * 0.6 : z };
      return;
    }
    const gain = (z - D.los) * dir, yards = Math.round(gain * this.ypm);
    this.stats.yards[D.off] += yards;
    if (sacked && gain < 0) this.stats.sacks++;
    if (D.run || (!D.passed && !sacked)) this.stats.runs++;
    if (z * dir < -play) {
      // brought down in its own end zone: a safety, two points, and the other side's ball
      this.score[other] += 2;
      this.pend.push({ k: 'goal', team: other, by: -1, own: false, ball: 0, a: this.score[0], b: this.score[1], pts: 2 });
      this.nextUp = { off: other, down: 1, los: -(other === 0 ? 1 : -1) * play * 0.5 };
      D.deadAt = t + C.restart;
      return;
    }
    const what = sacked && gain < 0 ? 'SACK!' : yards > 0 ? `${yards} YARD${yards === 1 ? '' : 'S'}` : yards < 0 ? `LOSS OF ${-yards}` : 'NO GAIN';
    if ((z - D.first) * dir >= 0) {
      this.stats.firsts++;
      this.nextUp = { off: D.off, down: 1, los: z };
      this.say('FIRST DOWN!', what === 'SACK!' ? '' : `A gain of ${yards}`);
    } else if (D.down >= 4) {
      this.stats.turnovers++;
      this.nextUp = { off: other, down: 1, los: z };
      this.say('TURNOVER ON DOWNS', `${what} · ${CUP_NAMES[other]} ball`);
    } else {
      this.nextUp = { off: D.off, down: D.down + 1, los: z };
      this.say(what, yards >= 6 ? 'A good gain' : '', sacked && gain < 0);
    }
  }
  /**
   * Blocking. A defender with a blocker on it (a lineman, or anyone on the offence whose job
   * this play is to block) is held up: it runs at a third of its speed until it sheds the block
   * (a second and a half to two and a half, the same for a bot or a person), then it's free of
   * blocks for a moment. That's what gives a quarterback time to throw.
   */
  /** this pass: the defenders who've had their go at it and missed */
  private whiff = new Set<number>();
  private blocks = new Map<number, { seq: number; t: number; free: number; need: number }>();
  private engage(dt: number) {
    const D = this.drive, all = this.who(), ball = this.arena.balls[0];
    if (D.phase !== 'live') this.stopped += dt;
    const S = D.phase === 'live' && !D.turned ? this.lineup() : null;
    for (const r of all) {
      const m = r.m;
      m.blockK = 1;
      if (!S || r.out || !m.active || this.teamOf(r.c.id) === D.off || m.mode === Mode.Tumble) continue;
      let e = this.blocks.get(m.id);
      if (!e || e.seq !== D.seq) this.blocks.set(m.id, (e = { seq: D.seq, t: 0, free: 0, need: 1.8 + ((m.id * 7 + D.seq * 13) % 10) * 0.12 }));
      if (this.now < e.free) continue;
      let on = false;
      for (const o of all) {
        if (o.out || !o.m.active || o.m.mode === Mode.Tumble || o.m.id === D.qb || o.m.id === ball.held || this.teamOf(o.c.id) !== D.off) continue;
        if (S.get(o.m.id)?.route.length !== 0) continue;
        if ((o.m.pos.x - m.pos.x) ** 2 + (o.m.pos.z - m.pos.z) ** 2 < 1.75 * 1.75) {
          on = true;
          break;
        }
      }
      if (!on) continue;
      e.t += dt;
      if (e.t > e.need) {
        e.t = 0;
        e.free = this.now + 1.5;
        e.need *= 0.8;
      } else m.blockK = 0.3;
    }
  }
  /** the events that have happened since the game last asked (a pass is thrown between its ticks; a guest's are worked out from what it hears) */
  private pend: CupEvent[] = [];
  drain() {
    const e = this.pend;
    this.pend = [];
    return e;
  }
  /**
   * Where a throw from (fx, fz) has to come down to meet a bean on the run: on along its route
   * if it's running one (round the cut that's coming), else on the way it's heading.
   */
  meet(id: number, fx: number, fz: number): [number, number] {
    const r = this.who().find((q) => q.m.id === id);
    if (!r) return [fx, fz];
    const m = r.m, d = Math.hypot(m.pos.x - fx, m.pos.z - fz), T = 0.5 + Math.min(Math.max(d, 5), 28) * 0.034;
    const sp = this.lineup().get(id), D = this.drive;
    if (sp && sp.route.length && D.phase === 'live' && !D.passed && !D.turned && this.teamOf(id) === D.off) {
      const pts: [number, number][] = [[sp.x, sp.z], ...sp.route];
      let bi = -1, bu = 0, bd = 2.4 * 2.4;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, az] = pts[k], sx = pts[k + 1][0] - ax, sz = pts[k + 1][1] - az, l2 = sx * sx + sz * sz || 1;
        const u = THREE.MathUtils.clamp(((m.pos.x - ax) * sx + (m.pos.z - az) * sz) / l2, 0, 1);
        const dd = (ax + sx * u - m.pos.x) ** 2 + (az + sz * u - m.pos.z) ** 2;
        if (dd <= bd) (bd = dd), (bi = k), (bu = u);
      }
      if (bi >= 0) {
        let left = Math.max(Math.hypot(m.vel.x, m.vel.z), 5.5) * T * 0.85;
        for (let k = bi; k + 1 < pts.length; k++) {
          const [ax, az] = pts[k], sx = pts[k + 1][0] - ax, sz = pts[k + 1][1] - az, len = Math.hypot(sx, sz) || 1;
          const u0 = k === bi ? bu : 0, room = (1 - u0) * len;
          if (left <= room) return [ax + sx * (u0 + left / len), az + sz * (u0 + left / len)];
          left -= room;
        }
        return pts[pts.length - 1];
      }
    }
    return [m.pos.x + m.vel.x * T * 0.85, m.pos.z + m.vel.z * T * 0.85];
  }
  /** can this bean throw it now? (it has the ball, the play's live, nobody's thrown yet, and it's behind the line) */
  canPass(id: number) {
    const D = this.drive, b = this.arena.balls[0];
    if (D.phase !== 'live' || b.held !== id || D.passed || D.turned) return false;
    const m = this.who().find((r) => r.m.id === id)?.m;
    if (!m) return false;
    return (m.pos.z - this.arena.center.z - D.los) * (this.teamOf(id) === 0 ? 1 : -1) < 0.6;
  }
  /**
   * The bean with the ball throws it at a spot on the pitch (`tx`, `tz`): a lob that comes down
   * there, however far it is (up to what an arm can do). One forward pass a play, from behind the
   * line. Whoever gets under it has it; on the ground it's incomplete.
   */
  pass(id: number, tx: number, tz: number, t: number) {
    const A = this.arena, C = this.cfg, b = A.balls[0];
    if (!this.canPass(id)) return false;
    const m = this.who().find((r) => r.m.id === id)?.m;
    if (!m) return false;
    let dx = tx - m.pos.x, dz = tz - m.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.5) (dx = Math.sin(m.yaw)), (dz = Math.cos(m.yaw)), (d = 1);
    const reach = Math.min(Math.max(d, 5), 28), T = 0.5 + reach * 0.034;
    b.held = -1;
    m.carry = false;
    b.thrower = id;
    b.passT = t;
    b.inAir = true;
    b.gripT = 0;
    b.fumbler = -1;
    this.whiff.clear();
    this.drive.passed = true;
    b.pos.set(m.pos.x + (dx / d) * 0.9, m.pos.y + 1.5, m.pos.z + (dz / d) * 0.9);
    // (it leaves the hand 1.5 m up and comes down to chest height at the spot)
    b.vel.set(((dx / d) * reach) / T, 0.5 * C.g * T - 0.7 / T, ((dz / d) * reach) / T);
    this.pend.push({ k: 'bowl', id: -1, was: id, how: 'pass' });
    return true;
  }
  /** the quarterback gives it to the back beside it (a run play) */
  handoff(from: number, to: number) {
    const D = this.drive, b = this.arena.balls[0];
    if (D.phase !== 'live' || b.held !== from || D.passed || D.turned) return false;
    const all = this.who(), a = all.find((r) => r.m.id === from)?.m, c = all.find((r) => r.m.id === to)?.m;
    if (!a || !c || c.mode === Mode.Tumble || this.teamOf(from) !== this.teamOf(to) || a.pos.distanceToSquared(c.pos) > 2.4 * 2.4) return false;
    b.held = to;
    b.gripT = 0;
    this.pend.push({ k: 'bowl', id: to, was: from, how: 'hand' });
    return true;
  }
  /** who has the ball (Bean Bowl; -1: nobody) */
  holder() {
    const b = this.arena.balls[0];
    return this.cfg.rule === 'bowl' && b.live && this.drive.phase === 'live' ? b.held : -1;
  }

  /** Volley Folly: the ball comes down from high over the middle of a team's yard (theirs to play) */
  private serve(team: number) {
    const C = this.cfg, s = team === 0 ? -1 : 1;
    this.drop(this.arena.balls[0], (Math.random() - 0.5) * C.HW * 0.9, s * C.HL * (0.35 + Math.random() * 0.3));
    // (a slow one: up a little first, so there's time to get under it)
    this.arena.balls[0].pos.y = this.arena.center.y + 11.5;
    this.arena.balls[0].vel.set(0, 3, 0);
    this.rally.team = -1;
  }

  /** the flight: floor, walls, posts */
  private fly(b: CupBall, h: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, C = this.cfg;
    const was = b.pos.z - A.center.z;
    b.vel.y -= C.g * h;
    b.pos.addScaledVector(b.vel, h);
    const drag = 1 - 0.1 * h;
    b.vel.multiplyScalar(drag);
    this.hold(b, was, h, ev, i);
    // it rolls the way it's going
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.05) {
      AX.set(b.vel.z, 0, -b.vel.x).normalize();
      b.quat.premultiply(Q.setFromAxisAngle(AX, (sp / C.R) * h)).normalize();
    }
  }
  /**
   * Everything that keeps the ball where a ball can be: the floor, the roof, the walls, the posts,
   * the fence, the top speed. Run after the flight and again after the beans have had their touch,
   * so nothing a bean does can leave it in a wall or over the fence for a frame.
   */
  private hold(b: CupBall, was: number, h: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, y0 = A.center.y, C = this.cfg, R = C.R;
    if (b.pos.y < y0 + R) {
      this.down = i;
      b.pos.y = y0 + R;
      if (b.vel.y < -2.2) {
        b.vel.y *= -0.62;
        if (ev && b.vel.y > 6) ev.push({ k: 'bang', ball: i, v: b.vel.y });
      } else b.vel.y = 0;
      const k = 1 - 0.62 * h;
      b.vel.x *= k;
      b.vel.z *= k;
    }
    if (b.pos.y > y0 + C.ceil - R) {
      b.pos.y = y0 + C.ceil - R;
      if (b.vel.y > 0) b.vel.y *= -0.5;
    }
    // Gate Crashers: the ring. Through an open gate it's gone; anywhere else it comes back off the wall
    if (A.gates) {
      const G = A.gates, dx = b.pos.x - A.center.x, dzz = b.pos.z - A.center.z, rr = Math.hypot(dx, dzz), lim = G.R - R;
      if (rr > lim && rr > 1e-3) {
        const ang = Math.atan2(dzz, dx);
        let hit = -1;
        if (b.pos.y < y0 + G.H)
          for (let k = 0; k < G.list.length; k++) {
            const g = G.list[k];
            if (!g.open) continue;
            let d = Math.abs(ang - g.a) % (Math.PI * 2);
            if (d > Math.PI) d = Math.PI * 2 - d;
            // (all of the ball between the posts)
            if (d < this.gateHalf - (R * 0.55) / G.R) hit = k;
          }
        if (hit >= 0 && b.live) {
          if (rr > lim + R * 1.1 && ev) this.through = hit;
          // (a guest's copy waits just outside for the host to say)
          const far = G.R + R * 1.6;
          if (rr > far) b.pos.set(A.center.x + (dx / rr) * far, b.pos.y, A.center.z + (dzz / rr) * far);
        } else {
          const nx = dx / rr, nz = dzz / rr;
          b.pos.x = A.center.x + nx * lim;
          b.pos.z = A.center.z + nz * lim;
          const vn = b.vel.x * nx + b.vel.z * nz;
          if (vn > 0) {
            b.vel.x -= nx * vn * 1.74;
            b.vel.z -= nz * vn * 1.74;
            if (ev && vn > 6) ev.push({ k: 'bang', ball: i, v: 9 });
          }
        }
      }
    }
    // in the goal, under the bar: the roof
    const dz = Math.abs(b.pos.z - A.center.z);
    if (C.goalHalf > 0 && dz > C.HL && b.pos.y > y0 + C.goalH - R && b.vel.y > 0) {
      b.pos.y = y0 + C.goalH - R;
      b.vel.y *= -0.3;
    }
    for (const s of A.segs) this.seg(b, s[0], s[1], s[2], s[3], 0.72);
    // the bar is a bar (the ball comes off it whichever way it met it: nothing snaps back onto the
    // pitch), and over it is the wall
    const inX = Math.abs(b.pos.x - A.center.x) < C.goalHalf;
    if (inX && C.goalHalf > 0) {
      const s = Math.sign(b.pos.z - A.center.z) || 1;
      const zb = dz - C.HL, up = b.pos.y - (y0 + C.goalH);
      const d = Math.hypot(zb, up), rr = R + 0.34;
      if (d < rr && d > 1e-3) {
        const nz = zb / d, ny = up / d;
        b.pos.z = A.center.z + s * (C.HL + nz * rr);
        b.pos.y = y0 + C.goalH + ny * rr;
        const vn = b.vel.z * s * nz + b.vel.y * ny;
        if (vn < 0) {
          b.vel.z -= s * nz * vn * 1.6;
          b.vel.y -= ny * vn * 1.6;
          if (ev && vn < -5) ev.push({ k: 'bang', ball: i, v: 10 });
        }
      } else if (up > 0 && zb > -R && zb < 0.5) {
        b.pos.z = A.center.z + s * (C.HL - R);
        if (b.vel.z * s > 0) b.vel.z *= -0.72;
      }
    }
    this.fenceHold(b, was, ev, i);
    // the big bumpers: a drum with a top to it, so a ball coming down onto one rolls off it
    // (a drum with no top let a bouncing ball sink into it, then threw it out sideways)
    for (const o of A.rounds) {
      const dx = b.pos.x - o.x, dzz = b.pos.z - o.z, d = Math.hypot(dx, dzz);
      if (d >= o.r + R || d < 0.01) continue;
      const rr = Math.min(d, o.r), cy = THREE.MathUtils.clamp(b.pos.y - y0, 0, 3);
      const px = o.x + (dx / d) * rr, pz = o.z + (dzz / d) * rr, py = y0 + cy;
      let nx = b.pos.x - px, ny = b.pos.y - py, nz = b.pos.z - pz;
      const gap = Math.hypot(nx, ny, nz);
      if (gap >= R) continue;
      if (gap < 1e-3) (nx = dx / d), (ny = 0), (nz = dzz / d);
      else (nx /= gap), (ny /= gap), (nz /= gap);
      b.pos.set(px + nx * R, py + ny * R, pz + nz * R);
      const vn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
      if (vn < 0) {
        const j = -vn * 1.6 + o.kick * Math.hypot(nx, nz);
        b.vel.x += nx * j;
        b.vel.y += ny * j;
        b.vel.z += nz * j;
        if (ev) ev.push({ k: 'bang', ball: i, v: 12 });
      }
    }
    // Bean Hoops: the rims. A ball can drop through the middle; anywhere on the iron it comes off it
    for (const H of A.hoops) {
      const hx = b.pos.x - H.x, hz = b.pos.z - H.z, hr = Math.hypot(hx, hz);
      if (hr < 1e-3 || hr > C.hoopR + R || Math.abs(b.pos.y - H.y) > R) continue;
      // the nearest point of the ring
      const px = H.x + (hx / hr) * C.hoopR, pz = H.z + (hz / hr) * C.hoopR;
      let nx = b.pos.x - px, ny = b.pos.y - H.y, nz = b.pos.z - pz;
      const d = Math.hypot(nx, ny, nz);
      if (d >= RIM || d < 1e-3) continue;
      nx /= d;
      ny /= d;
      nz /= d;
      b.pos.set(px + nx * RIM, H.y + ny * RIM, pz + nz * RIM);
      const vn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
      if (vn < 0) {
        b.vel.x -= nx * vn * 1.5;
        b.vel.y -= ny * vn * 1.5;
        b.vel.z -= nz * vn * 1.5;
        if (ev && vn < -3) ev.push({ k: 'bang', ball: i, v: 9 });
      }
    }
    // (nobody kicks that hard, however many of them are in on it)
    const top = b.vel.length();
    if (top > C.top) b.vel.multiplyScalar(C.top / top);
    // (and however it got there, it isn't leaving)
    if (A.gates) return;
    const lim = C.HL + C.goalD - R, limX = C.HW - R;
    b.pos.x = THREE.MathUtils.clamp(b.pos.x, A.center.x - limX, A.center.x + limX);
    b.pos.z = THREE.MathUtils.clamp(b.pos.z, A.center.z - lim, A.center.z + lim);
  }
  /** a bean has it against them: eased out of the bean, never thrown (no jumps on the screen) */
  private clear(b: CupBall, reach: number) {
    const gap = Math.min(reach - P.distanceTo(b.pos), this.give);
    if (gap > 0) {
      b.pos.addScaledVector(N, gap);
      this.give -= gap;
    }
    const floor = this.arena.center.y + this.cfg.R;
    if (b.pos.y < floor) b.pos.y = floor;
  }
  /** how far the beans can still ease the ball this step, and the ball that touched the floor in it */
  private give = 0;
  private down = -1;
  /** who had it last, for each side (a goal is theirs) */
  private touched(b: CupBall, id: number, t: number) {
    if (b.last !== id) {
      b.prev = b.last;
      b.last = id;
    }
    if (this.arena.gates) return;
    const team = this.teamOf(id);
    b.by[team] = id;
    b.byT[team] = t;
  }
  /** Over the Fence: low enough, the net stops it; over the top it goes */
  private fenceHold(b: CupBall, was: number, ev: CupEvent[] | null, i: number) {
    const A = this.arena, C = this.cfg;
    if (C.fenceH <= 0 || Math.abs(was) < 1e-3) return;
    const now = b.pos.z - A.center.z;
    const side = Math.sign(was);
    const up = b.pos.y - (A.center.y + C.fenceH);
    if (up > 0) {
      // (above the top: the rail along it is a bar the ball rolls off, one way or the other)
      const d = Math.hypot(now, up);
      if (d >= C.R) return;
      const nz = d > 1e-3 ? now / d : side * 0.3, ny = d > 1e-3 ? up / d : 0.95;
      b.pos.z = A.center.z + nz * C.R;
      b.pos.y = A.center.y + C.fenceH + ny * C.R;
      const vn = b.vel.z * nz + b.vel.y * ny;
      if (vn < 0) {
        b.vel.z -= nz * vn * 1.45;
        b.vel.y -= ny * vn * 1.45;
        if (ev && vn < -4) ev.push({ k: 'bang', ball: i, v: 8 });
      }
      return;
    }
    if (Math.abs(now) >= C.R && Math.sign(now) === side) return;
    b.pos.z = A.center.z + side * C.R;
    if (b.vel.z * side < 0) {
      b.vel.z *= -0.5;
      if (ev && Math.abs(b.vel.z) > 3) ev.push({ k: 'bang', ball: i, v: 8 });
    }
  }
  private seg(b: CupBall, x0: number, z0: number, x1: number, z1: number, e: number) {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    const u = THREE.MathUtils.clamp(((b.pos.x - x0) * dx + (b.pos.z - z0) * dz) / l2, 0, 1);
    const cx = x0 + dx * u, cz = z0 + dz * u;
    const nx0 = b.pos.x - cx, nz0 = b.pos.z - cz, d = Math.hypot(nx0, nz0);
    const R = this.cfg.R;
    if (d >= R || d < 1e-4) return;
    const nx = nx0 / d, nz = nz0 / d;
    b.pos.x = cx + nx * R;
    b.pos.z = cz + nz * R;
    const vn = b.vel.x * nx + b.vel.z * nz;
    if (vn < 0) {
      b.vel.x -= nx * vn * (1 + e);
      b.vel.z -= nz * vn * (1 + e);
    }
  }

  /** a bean and a ball: dribble, shot, header, or a ball in the face */
  private touch(b: CupBall, i: number, r: Who, t: number, ev: CupEvent[]) {
    const m = r.m;
    P.set(m.pos.x, m.pos.y + 0.55, m.pos.z);
    N.subVectors(b.pos, P);
    const d = N.length();
    const C = this.cfg;
    // (Volley Folly: you have to get properly under it)
    const reach = C.R + (C.rule === 'volley' ? (r.c.human ? 0.8 : 0.5) : r.c.human ? 0.95 : 0.78);
    if (d >= reach || d < 1e-3) return;
    N.multiplyScalar(1 / d);
    const hs = Math.hypot(m.vel.x, m.vel.z);
    const rel = (m.vel.x - b.vel.x) * N.x + (m.vel.y - b.vel.y) * N.y + (m.vel.z - b.vel.z) * N.z;
    const speed = b.vel.length();
    const air = m.groundT > 0.1;
    const dive = m.mode === Mode.Dive;
    // (a shot goes where you're going, so you can aim it)
    const dx = hs > 1 ? m.vel.x / hs : Math.sin(m.yaw), dz = hs > 1 ? m.vel.z / hs : Math.cos(m.yaw);
    if (C.rule === 'volley') return this.bump(b, i, r, t, ev, dx, dz, dive || (air && N.y > 0.2));
    if (C.rule === 'hoops' && (dive || (air && N.y > 0.25))) return this.shoot(b, i, r, t, ev, dx, dz, !dive);
    // (a shot just gone up isn't knocked off its line by everyone stood round it: only a dive or a jump gets to it)
    if (C.rule === 'hoops' && t - b.kickT < 0.4) return;
    // a hard one coming the other way: it wins
    if (speed > 15 && rel < -11 && C.rule !== 'push' && C.rule !== 'hoops' && b.last !== m.id && t - b.kickT > 0.15 && m.mode === Mode.Run) {
      b.vel.multiplyScalar(0.45);
      ev.push({ k: 'hit', id: r.c.id, vx: -N.x * speed * 0.5, vy: 5, vz: -N.z * speed * 0.5 });
      this.touched(b, m.id, t);
      this.clear(b, reach);
      return;
    }
    this.clear(b, reach);
    if (rel < -0.5 && !dive) return;
    this.touched(b, m.id, t);
    // (dribbled since it was shot: it's a two again)
    b.worth = 2;
    if (dive) {
      if (t - b.kickT < 0.2) return;
      b.kickT = t;
      const v = (r.c.human ? 29 : 25) * C.kick;
      if (C.rule === 'push') {
        // (a shove: it adds to how the ball's already going)
        b.vel.x += dx * v;
        b.vel.z += dz * v;
        b.vel.y = Math.max(b.vel.y, C.loft);
      } else b.vel.set(dx * v, C.loft, dz * v);
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: true });
      return;
    }
    if (air && N.y > 0.25 && C.rule !== 'push') {
      // a header
      if (t - b.kickT < 0.2) return;
      b.kickT = t;
      const v = Math.max(13, hs * 1.5);
      b.vel.set(dx * v, 7 + Math.max(0, m.vel.y) * 0.4, dz * v);
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: true });
      return;
    }
    // the dribble: pushed on ahead of you, mostly the way you're running
    const k = (Math.max(0, rel) * 1.25 + 1.5) * C.push;
    const fx = N.x * 0.5 + dx * 0.5, fz = N.z * 0.5 + dz * 0.5;
    b.vel.x += fx * k;
    b.vel.z += fz * k;
    b.vel.y += Math.max(0, N.y) * k * 0.4;
    if (k > 8) ev.push({ k: 'kick', ball: i, id: m.id, v: k, shot: false });
  }

  /**
   * Bean Hoops: a dive into the ball (or a jump up into it) is a shot. It's thrown at the hoop on
   * an arc that drops into it; how true depends on how far out you are and how squarely you were
   * heading at the hoop. From outside the arc it's worth three. Facing away from the hoop it's
   * just a clearance, the way you're going.
   */
  private shoot(b: CupBall, i: number, r: Who, t: number, ev: CupEvent[], dx: number, dz: number, header: boolean) {
    const A = this.arena, C = this.cfg, m = r.m;
    if (t - b.kickT < 0.3) return;
    b.kickT = t;
    this.touched(b, m.id, t);
    const team = this.teamOf(r.c.id), H = A.hoops[team];
    const hx = H.x - b.pos.x, hz = H.z - b.pos.z, d = Math.hypot(hx, hz);
    // which way it's being hit: the way you're going and the side of the ball you're on, together
    let ax = dx + N.x, az = dz + N.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    const facing = d > 0.5 ? (ax * hx + az * hz) / d : 1;
    // (a jump up into it is only a shot close in, a tip at the rim; further out it's just knocked on)
    if (facing < 0.15 || (header && d > 9)) {
      const v = header ? 8 : 15;
      b.vel.set(ax * v, 8, az * v);
      b.worth = 2;
      ev.push({ k: 'kick', ball: i, id: m.id, v, shot: !header });
      return;
    }
    // (from the far end it's not a shot, it's a long ball up the court for someone to run on to)
    if (d > 27) {
      const T = 1.5, k = 0.55;
      b.vel.set((hx * k + (Math.random() - 0.5) * 6) / T, 0.5 * C.g * T * 0.8, (hz * k) / T);
      b.worth = 2;
      ev.push({ k: 'kick', ball: i, id: m.id, v: b.vel.length(), shot: true });
      return;
    }
    // how far off it can be (m): more from further out, more if you weren't square to it, more for a weaker bot
    const hand = r.c.human ? 1 : 1.9 - 0.7 * (r.c.skill ?? 0.7);
    const off = (0.3 + d * 0.045 + Math.max(0, d - 10) * 0.1) * (1 + (1 - facing) * 3) * hand * (header ? 1.35 : 1);
    const tx = H.x + (Math.random() + Math.random() - 1) * off * 1.6, tz = H.z + (Math.random() + Math.random() - 1) * off * 1.6;
    const T = 0.8 + d * 0.045;
    b.vel.set((tx - b.pos.x) / T, (H.y + 0.35 - b.pos.y) / T + 0.5 * C.g * T, (tz - b.pos.z) / T);
    // (the arc above has no air in it: a touch more to make up for the drag)
    b.vel.multiplyScalar(1 + 0.05 * T);
    b.worth = d > C.three ? 3 : 2;
    ev.push({ k: 'kick', ball: i, id: m.id, v: b.vel.length(), shot: true });
  }

  /**
   * Volley Folly: any touch sends it up. Run under it and it's a bump: up and on toward the net
   * for someone else (or over, if you're close to it). JUMP or DIVE into it and it's a hit: over the
   * net, the way you're heading, as deep as you were moving fast. The flight's worked out so it
   * lands where it's aimed and clears the net on the way.
   */
  private bump(b: CupBall, i: number, r: Who, t: number, ev: CupEvent[], dx: number, dz: number, hard: boolean) {
    const A = this.arena, C = this.cfg, m = r.m;
    if (t - b.kickT < 0.32) return;
    const team = this.teamOf(r.c.id), dir = team === 0 ? 1 : -1;
    const floor = A.center.y + C.R, zNet = A.center.z;
    const toNet = (zNet - b.pos.z) * dir;
    // (only in your own yard: the net's glass is in the way of anything else)
    if (toNet < 0) return;
    b.kickT = t;
    this.touched(b, m.id, t);
    // how many times this side has had it since it came over
    if (this.rally.team !== team) (this.rally.team = team), (this.rally.n = 0);
    const n = ++this.rally.n;
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (!hard) {
      // a bump: straight up off your head and a little on toward the net, for someone to hit.
      // Each one in a row comes up lower: three and it's as good as down
      const vy = n <= 1 ? 7.4 : n === 2 ? 5.4 : 2.6;
      b.vel.set(dx * 1.6, vy, dz * 1.6 + dir * Math.min(2.2, toNet * 0.3));
      ev.push({ k: 'kick', ball: i, id: m.id, v: vy, shot: false });
      return;
    }
    // a hit: over the net, the way you're heading, as deep as you were moving fast
    const deep = 3.5 + Math.min(1, hs / 11) * (C.HL - 7) * (r.c.human ? 1 : 0.55 + Math.random() * 0.55);
    const tz = zNet + dir * Math.min(C.HL - 2.2, deep);
    const tx = THREE.MathUtils.clamp(b.pos.x + dx * 9 + (r.c.human ? 0 : (Math.random() - 0.5) * 9), A.center.x - C.HW + 2.2, A.center.x + C.HW - 2.2);
    // the flight: as flat as clears the net with room to spare
    let T = 0.8;
    for (; T < 3; T += 0.1) {
      const vy = (floor - b.pos.y) / T + 0.5 * C.g * T;
      const tc = (T * toNet) / Math.max(0.1, (tz - b.pos.z) * dir);
      if (b.pos.y + vy * tc - 0.5 * C.g * tc * tc > A.center.y + C.fenceH + C.R + 0.55) break;
    }
    b.vel.set((tx - b.pos.x) / T, (floor - b.pos.y) / T + 0.5 * C.g * T, (tz - b.pos.z) / T);
    // (the flight above has no air in it: a touch more to make up for the drag)
    b.vel.multiplyScalar(1 + 0.05 * T);
    ev.push({ k: 'kick', ball: i, id: m.id, v: b.vel.length(), shot: hard });
  }

  /** (the host) the ball's moves, this frame */
  /** the world time of the last tick (a bot's throw happens between them) */
  now = 0;
  tick(dt: number, t: number, x: number) {
    const ev: CupEvent[] = this.drain();
    this.now = t;
    const A = this.arena, all = this.who(), C = this.cfg;
    if (C.second > 0 && !this.second && x > C.T - C.second) {
      this.second = true;
      this.drop(A.balls[1], 6);
      A.balls[0].backAt && (A.balls[0].backAt = t + 0.5);
    }
    // Gate Crashers: more balls as it goes on (never more than there are gates left to guard, less one)
    if (A.gates) {
      const left = all.filter((r) => !r.out).length;
      A.balls.forEach((b, k) => {
        if (k && !this.more[k] && x > GATES.ballAt[k] && left > k) {
          this.more[k] = true;
          this.dropIn(b);
          ev.push({ k: 'bang', ball: k, v: -1 });
        }
      });
    }
    const n = 4, h = dt / n;
    A.balls.forEach((b, i) => {
      if (b.backAt && t >= b.backAt) {
        if (A.gates) this.dropIn(b);
        else if (C.rule === 'volley') this.serve(this.serveTo);
        else this.drop(b, i ? 6 : this.second ? -6 : 0);
      }
      if (!b.live && !b.backAt) return;
      if (C.rule === 'bowl') return this.bowl(b, i, dt, t, ev, all);
      for (let k = 0; k < n; k++) {
        this.down = -1;
        this.fly(b, h, ev, i);
        if (!b.live) continue;
        const was = b.pos.z - A.center.z;
        this.give = 0.085;
        for (const r of all) if (r.m.active && !r.out && !r.m.frozen) this.touch(b, i, r, t, ev);
        this.hold(b, was, 0, null, i);
        const dz = b.pos.z - A.center.z;
        // Gate Crashers: through a gate
        if (A.gates) {
          if (this.through < 0) continue;
          const gate = this.through;
          this.through = -1;
          b.live = false;
          b.backAt = t + C.restart;
          ev.push({ k: 'gate', ball: i, gate, by: b.last });
          continue;
        }
        // Bean Hoops: down through a rim is a basket for the side that shoots at it
        if (C.rule === 'hoops') {
          for (let team = 0; team < 2 && b.live; team++) {
            const H = A.hoops[team];
            if (!(b.py > H.y && b.pos.y <= H.y) || Math.hypot(b.pos.x - H.x, b.pos.z - H.z) > C.hoopR - RIM * 0.6) continue;
            const mine = t - b.byT[team] < C.credit, pts = mine ? b.worth : 2;
            this.score[team] += pts;
            b.live = false;
            b.backAt = t + C.restart;
            const by = mine ? b.by[team] : b.last;
            ev.push({ k: 'goal', team, by, own: !mine && by >= 0 && this.teamOf(by) !== team, ball: i, a: this.score[0], b: this.score[1], pts });
          }
          b.py = b.pos.y;
          continue;
        }
        // Volley Folly: down on the floor is a point to the other side, and their serve to take
        if (C.rule === 'volley') {
          if (this.down !== i) continue;
          const team = dz > 0 ? 0 : 1;
          this.score[team]++;
          b.live = false;
          b.backAt = t + C.restart;
          this.serveTo = team === 0 ? 1 : 0;
          ev.push({ k: 'goal', team, by: t - b.byT[team] < 8 ? b.by[team] : -1, own: false, ball: i, a: this.score[0], b: this.score[1] });
          continue;
        }
        if (Math.abs(dz) > C.HL + C.R * 0.6 && Math.abs(b.pos.x - A.center.x) < C.goalHalf && b.pos.y < A.center.y + C.goalH) {
          const team = dz > 0 ? 0 : 1;
          this.score[team]++;
          b.live = false;
          b.backAt = t + C.restart;
          // (it's the goal of whoever on the scoring side had it last, if that was lately: a keeper
          // getting a hand to a shot hasn't scored an own goal, and nor has the bean pushing back)
          const mine = t - b.byT[team] < C.credit;
          const by = mine ? b.by[team] : b.last;
          ev.push({ k: 'goal', team, by, own: !mine && by >= 0 && this.teamOf(by) !== team, ball: i, a: this.score[0], b: this.score[1] });
        }
      }
      if (b.live) this.attack[b.pos.z > A.center.z ? 0 : 1] += dt;
    });
    // Over the Fence: the score is where the balls lie (each team's is the count in the other's yard)
    if (C.rule === 'fence') this.yards();
    return ev;
  }

  /** Volley Folly: whose yard the next ball comes down in, and who's had it how often since it came over */
  private serveTo = 0;
  private rally = { team: -1, n: 0 };

  private yards() {
    const A = this.arena;
    this.score[0] = this.score[1] = 0;
    for (const b of A.balls) if (b.live) this.score[b.pos.z > A.center.z ? 0 : 1]++;
  }

  /** what the host sends */
  packet() {
    const out: number[] = [];
    for (const b of this.arena.balls) out.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.live ? 1 : 0);
    // (Bean Bowl: and who's carrying it)
    if (this.cfg.rule === 'bowl') {
      const D = this.drive;
      out.push(this.arena.balls[0].held, D.phase === 'set' ? 0 : D.phase === 'live' ? 1 : 2, +(D.snapAt - this.now).toFixed(2), D.los, D.first, D.down, D.off, D.qb, D.play, D.seq, D.passed ? 1 : 0, D.turned ? 1 : 0, +(this.now - D.liveAt).toFixed(2), +this.stopped.toFixed(2));
    }
    return out.map((v) => Math.round(v * 100) / 100);
  }
  /** a guest hears where they are */
  heard(s: number[], a: number, b: number) {
    this.score[0] = a;
    this.score[1] = b;
    this.arena.balls.forEach((q, i) => {
      const o = i * 7;
      const n = this.net[i];
      n.p.set(s[o], s[o + 1], s[o + 2]);
      n.v.set(s[o + 3], s[o + 4], s[o + 5]);
      const was = q.live;
      q.live = s[o + 6] > 0;
      if (q.live && !was) {
        q.pos.copy(n.p);
        q.vel.copy(n.v);
      }
      q.backAt = q.live ? 0 : 1;
      q.vel.lerp(n.v, 0.6);
      if (this.cfg.rule === 'bowl') {
        const o2 = this.arena.balls.length * 7, D = this.drive;
        const held = q.live ? (s[o2] ?? -1) : -1;
        const live = D.phase === 'live';
        D.phase = s[o2 + 1] === 0 ? 'set' : s[o2 + 1] === 1 ? 'live' : 'dead';
        D.snapAt = this.now + s[o2 + 2];
        D.los = s[o2 + 3];
        D.first = s[o2 + 4];
        D.down = s[o2 + 5];
        D.off = s[o2 + 6];
        D.qb = s[o2 + 7];
        D.play = s[o2 + 8];
        D.run = !!PLAYS[D.play]?.run;
        D.seq = s[o2 + 9];
        D.passed = s[o2 + 10] > 0;
        D.turned = s[o2 + 11] > 0;
        D.liveAt = this.now - s[o2 + 12];
        if (s[o2 + 13] !== undefined) this.stopped = s[o2 + 13];
        if (held !== q.held) {
          // (what happened, as near as a guest can tell)
          if (held >= 0) {
            const mine = q.thrower < 0 || this.teamOf(q.thrower) === this.teamOf(held);
            this.pend.push({ k: 'bowl', id: held, was: q.held >= 0 ? q.held : q.thrower, how: q.held >= 0 ? 'hand' : q.inAir ? (mine ? 'catch' : 'steal') : 'snap' });
            q.inAir = false;
            q.thrower = -1;
          } else if (live && D.phase === 'live') {
            // (out of a hand with the play still on: thrown)
            q.thrower = q.held;
            q.inAir = true;
            this.pend.push({ k: 'bowl', id: -1, was: q.held, how: 'pass' });
          } else q.inAir = false;
          q.held = held;
        }
      }
    });
  }
  /** (a guest) the flight between reports, leaning back onto the host's */
  follow(dt: number) {
    this.now += dt;
    if (this.cfg.rule === 'bowl') this.engage(dt);
    this.arena.balls.forEach((b, i) => {
      if (!b.live && !b.backAt) return;
      // (Bean Bowl: carried, it's wherever the bean that has it is)
      if (this.cfg.rule === 'bowl') {
        const all = this.who();
        const holder = b.held >= 0 ? all.find((r) => r.m.id === b.held) : undefined;
        for (const r of all) r.m.carry = r === holder;
        if (holder) {
          b.pos.set(holder.m.pos.x, holder.m.pos.y + 1.4, holder.m.pos.z);
          b.vel.copy(holder.m.vel);
          return;
        }
      }
      this.fly(b, dt, null, i);
      const n = this.net[i];
      n.p.addScaledVector(n.v, dt);
      if (b.pos.distanceToSquared(n.p) > 36) b.pos.copy(n.p);
      else b.pos.lerp(n.p, Math.min(1, dt * 9));
    });
  }

  /** the nearest ball in play */
  ballNear(p: THREE.Vector3) {
    let best: CupBall | null = null, bd = Infinity;
    for (const b of this.arena.balls) {
      if (!b.live) continue;
      const d = b.pos.distanceToSquared(p);
      if (d < bd) (bd = d), (best = b);
    }
    return best;
  }

  sync() {
    const A = this.arena, y0 = A.center.y;
    if (this.losLine && this.firstLine && this.aimRing) {
      const D = this.drive, on = D.seq > 0 && (D.phase === 'set' || D.phase === 'live') && !D.turned;
      this.losLine.visible = on;
      this.losLine.position.set(A.center.x, y0 + 0.045, A.center.z + D.los);
      // (inside the ten there's no line to gain: the goal line is it)
      this.firstLine.visible = on && Math.abs(D.first) < this.cfg.HL - this.cfg.endZone - 0.01;
      this.firstLine.position.set(A.center.x, y0 + 0.05, A.center.z + D.first);
      this.drawRoutes();
      const to = this.aimAt >= 0 ? this.who().find((r) => r.m.id === this.aimAt) : undefined;
      this.aimRing.visible = !!to;
      if (to) {
        this.aimRing.position.set(to.m.pos.x, y0 + 0.12, to.m.pos.z);
        this.aimRing.scale.setScalar(1 + Math.sin(performance.now() * 0.012) * 0.12);
      }
    }
    A.balls.forEach((b, i) => {
      const on = b.live || !!b.backAt;
      const m = this.meshes[i], k = this.marks[i];
      m.visible = k.visible = on;
      if (!on) return;
      m.position.copy(b.pos);
      m.quaternion.copy(b.quat);
      // (Bean Bowl: carried, it points the way its bean is facing; thrown, along its flight in a spiral)
      if (this.cfg.rule === 'bowl') {
        const hm = b.held >= 0 ? this.who().find((r) => r.m.id === b.held)?.m : undefined;
        if (hm) m.quaternion.setFromAxisAngle(UPY, hm.yaw + Math.PI / 2);
        else if (b.inAir) m.quaternion.setFromUnitVectors(XAX, P.copy(b.vel).normalize()).multiply(Q.setFromAxisAngle(XAX, performance.now() * 0.02));
      }
      k.position.set(b.pos.x, y0 + 0.05, b.pos.z);
      const up = b.pos.y - y0 - this.cfg.R;
      k.scale.setScalar(1 + up * 0.08);
      (k.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.85 - up * 0.08);
    });
    let n = 0;
    const { M, S } = this, C = this.col;
    for (const r of this.who()) {
      if (r.out || !r.m.active || n >= 24) continue;
      const lift = THREE.MathUtils.clamp(1 - (r.m.pos.y - y0 - 0.5) * 0.2, 0.45, 1) * (r.c.player ? 1.25 : 1);
      M.makeScale(lift, 1, lift).setPosition(S.set(r.m.pos.x, y0 + 0.06, r.m.pos.z));
      this.rings.setMatrixAt(n, M);
      this.rings.setColorAt(n, C.set(A.colors ? A.colors[this.teamOf(r.c.id) % A.colors.length] : CUP_COLORS[this.teamOf(r.c.id)]));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }
}
