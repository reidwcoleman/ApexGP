import type { RacingProfile } from './RacingProfile.ts';

/**
 * What the AI drivers learn. Every driver keeps, for every corner of a circuit, how much faster
 * (or slower) than the speed profile they dare to take it and how many metres later (or earlier)
 * they brake for it. A driver new to a circuit starts a little shy of the profile and converges on
 * the limit lap by lap from what actually happened in each corner: running wide, putting wheels off
 * or snapping sideways backs them off; a corner taken with grip to spare (the wheel short of the
 * tyres' limit, back on the line) lets them carry a little more next time; arriving at the apex too
 * fast (on full brakes and still over the target) moves the braking point back, braking too early
 * and having to get back on the power before the apex moves it on. Pushing has to pay: a corner
 * that got slower once the driver started pushing harder there gives back half the extra. Under
 * pressure drivers push past what they know, so a fight is where the mistakes come from. The
 * fastest anyone (the player too) has gone through a corner today tells the others there is time
 * there: they push harder to find it, never beyond their own ceiling. Nobody is ever slowed down or
 * sped up for the player's sake — it's what each driver has found out on the road.
 *
 * The knowledge outlives the race: per driver and circuit (blended back toward a fresh driver's a
 * little between visits — the details fade) plus a slow development of every driver over the races
 * they drive, in localStorage under `apexgp.ailearn`. The ceilings follow the difficulty, so a
 * Rookie field never learns its way to a Legend's pace and the AI always stays beatable.
 */

/** the corners of a circuit as the AI sees them: from the speed profile's braking zones */
export interface CornerZones {
  count: number;
  /** per metre: the corner this metre belongs to (−1: none) */
  of: Int16Array;
  /** per metre: how much of that corner's learned speed applies here (0 … 1: fades in before the braking point, out on the exit) */
  w: Float32Array;
  /** per metre: how much of the learned braking point applies (the braking zone, faded out past the apex) */
  wb: Float32Array;
  /** per corner: braking point, apex (slowest point), exit (metres along the lap) */
  brake: Float32Array;
  apex: Float32Array;
  exit: Float32Array;
}

const zoneCache = new WeakMap<RacingProfile, CornerZones>();

/** the corners of the profile: every slow point a car has to brake at least 5 m/s for */
export function cornerZones(profile: RacingProfile): CornerZones {
  const hit = zoneCache.get(profile);
  if (hit) return hit;
  const v = profile.vmax;
  const n = profile.n;
  const at = (i: number) => v[((i % n) + n) % n];
  const apexes: number[] = [];
  for (let i = 0; i < n; i++) {
    const vi = v[i];
    let isMin = true;
    for (let d = 1; d <= 15 && isMin; d++) if (at(i - d) < vi || at(i + d) <= vi) isMin = false;
    if (!isMin) continue;
    let peak = vi;
    for (let d = 1; d <= 400; d++) peak = Math.max(peak, at(i - d));
    if (peak - vi >= 5) apexes.push(i);
  }
  const count = apexes.length;
  const z: CornerZones = {
    count,
    of: new Int16Array(n).fill(-1),
    w: new Float32Array(n),
    wb: new Float32Array(n),
    brake: new Float32Array(count),
    apex: new Float32Array(count),
    exit: new Float32Array(count),
  };
  for (let c = 0; c < count; c++) {
    const a = apexes[c];
    // back up the braking zone while the profile keeps rising behind us
    let b = a;
    while (a - b < 600 && at(b - 1) > at(b)) b--;
    // the exit: until the profile stops rising, at most a few seconds of acceleration out of it
    let e = a;
    const eMax = a + Math.max(60, Math.min(260, 3 * v[a]));
    while (e < eMax && at(e + 1) > at(e)) e++;
    z.brake[c] = ((b % n) + n) % n;
    z.apex[c] = a;
    z.exit[c] = e % n;
    const FADE_IN = 60;
    const FADE_OUT = 40;
    for (let s = b - FADE_IN; s <= e; s++) {
      const i = ((s % n) + n) % n;
      const w = s < b ? (s - (b - FADE_IN)) / FADE_IN : s > e - FADE_OUT ? (e - s) / FADE_OUT : 1;
      const wb = s <= a ? Math.min(1, w) : Math.max(0, 1 - (s - a) / 20);
      // (overlapping zones, a chicane: the corner that matters more here wins)
      if (z.of[i] < 0 || w >= z.w[i]) {
        z.of[i] = c;
        z.w[i] = Math.max(0, w);
        z.wb[i] = wb;
      }
    }
  }
  zoneCache.set(profile, z);
  return z;
}

/** what happened in one pass through a corner (clean passes only: no traffic, no mistakes) */
export interface CornerPass {
  /** seconds from the braking point's run-in to the exit */
  time: number;
  /** metres the car drifted wide of its path (most) */
  wide: number;
  /** ran out of road: all four wheels off, or the lift at the kerb's edge */
  off: boolean;
  /** most rear slip angle (rad) */
  slide: number;
  /** most of the front tyres' grip used (combined slip: 1 = at the peak) */
  grip: number;
  /** seconds on full brakes still over the target speed (braked too late) */
  over: number;
  /** seconds back on the power before the apex below the target (braked too early) */
  under: number;
  /** most front lock-up */
  lock: number;
  /** m/s over the target speed at the apex (+ = arrived too fast) */
  apex: number;
  /** a wet track (lessons there carry less) */
  wet: boolean;
}

/** a driver new to a circuit: a touch shy of the profile in the corners, braking a few metres early */
const CS_FRESH = 0.994;
const BK_FRESH = -4;
const CS_MIN = 0.965;
const BK_MIN = -22;

/** how close to the limit a difficulty lets the drivers learn to go (0 … 1: Rookie … Legend and beyond) */
export function learnLevel(difficulty: number): number {
  return Math.max(0.15, Math.min(1, (difficulty - 0.86) / 0.14));
}
/** how far past "knows the circuit" a difficulty goes (0 … 1: below Elite … Legend): sim-prepared, no warm-up laps */
export function eliteLevel(difficulty: number): number {
  return Math.max(0, Math.min(1, (difficulty - 0.97) / 0.055));
}

/** one driver's knowledge of one circuit */
export class DriverKnowledge {
  readonly z: CornerZones;
  /** per corner: corner-speed factor on the profile, braking point (m, + = later), clean passes */
  readonly cs: Float32Array;
  readonly bk: Float32Array;
  readonly n: Uint16Array;
  /** this session: best clean time through each corner and the speed factor it was set with; passes to hold off pushing */
  private readonly bt: Float32Array;
  private readonly btCs: Float32Array;
  private readonly btBk: Float32Array;
  private readonly hold: Uint8Array;
  /** the most a driver dares: corner speed and braking point (from the difficulty and their bravery) */
  csMax = 1.01;
  bkMax = 8;
  /** 0 … 1: how quickly lessons sink in (talent, experience) */
  rate = 0.25;
  /** 0 … 1: bravery (aggression) — pushes nearer the edge, backs off less after a moment */
  brave = 0.5;
  /** (the tools) every pass learned from */
  onPass: ((c: number, p: CornerPass, push: number) => void) | null = null;

  constructor(z: CornerZones) {
    this.z = z;
    const k = z.count;
    this.cs = new Float32Array(k).fill(CS_FRESH);
    this.bk = new Float32Array(k).fill(BK_FRESH);
    this.n = new Uint16Array(k);
    this.bt = new Float32Array(k).fill(Infinity);
    this.btCs = new Float32Array(k).fill(CS_FRESH);
    this.btBk = new Float32Array(k).fill(BK_FRESH);
    this.hold = new Uint8Array(k);
  }

  /** the corner-speed factor at s (1 away from the corners); `beyond`: pushing past what they know (a fight) */
  factor(s: number, beyond = 0): number {
    const z = this.z;
    const n = z.of.length;
    const i = Math.floor(((s % n) + n) % n);
    const c = z.of[i];
    return c < 0 ? 1 : 1 + (this.cs[c] - 1 + beyond) * z.w[i];
  }

  /** metres later than the profile this driver brakes at s (− = earlier; 0 away from braking zones) */
  brakeLate(s: number): number {
    const z = this.z;
    const n = z.of.length;
    const i = Math.floor(((s % n) + n) % n);
    const c = z.of[i];
    return c < 0 ? 0 : this.bk[c] * z.wb[i];
  }

  /** the corner at s (−1: none) */
  cornerAt(s: number): number {
    const n = this.z.of.length;
    return this.z.of[Math.floor(((s % n) + n) % n)];
  }

  /** how well the driver knows the circuit, 0 (never driven it) … 1 */
  familiarity(): number {
    let k = 0;
    for (let c = 0; c < this.n.length; c++) k += Math.min(1, this.n[c] / 8);
    return this.n.length ? k / this.n.length : 0;
  }

  /** learn from a clean pass through corner `c`; `push`: someone has been quicker through it today (0 … 1) */
  learn(c: number, p: CornerPass, push = 0) {
    this.onPass?.(c, p, push);
    const r = this.rate * (p.wet ? 0.5 : 1);
    const csNow = this.cs[c];
    // ---- corner speed
    if (p.off || p.wide > 1.9 || p.slide > 0.2) {
      // overstepped it: back off, and don't push here again for a few laps
      this.cs[c] -= 0.004 + 0.004 * (1 - this.brave);
      this.hold[c] = 2 + Math.round(2 * (1 - this.brave));
    } else if (p.wide > 1.1 || p.slide > 0.14) {
      // on the edge: a hair back
      this.cs[c] -= 0.0015;
    } else if (this.hold[c] > 0) this.hold[c]--;
    else {
      // grip to spare: carry more next time (more when the wheel had plenty left, more when someone showed it can be done)
      const spare = p.grip < 0.85 ? 1 : p.grip < 0.97 ? 0.55 : p.grip < 1.1 ? 0.2 : 0;
      this.cs[c] += Math.max(0, this.csMax - csNow) * r * spare * (1 + 0.6 * push);
    }
    // ---- braking point: judged by the speed at the apex — over the target, it was too late (or a
    // lock-up, or still over it on full brakes); under it and back on the power before the apex, too early
    const bkNow = this.bk[c];
    if (p.apex > 0.9 || p.over > 0.2 || p.lock > 0.45) this.bk[c] -= 1 + Math.min(5, 2 * Math.max(0, p.apex - 0.9) + 6 * p.over);
    else if (p.apex < 0.3 && p.under > 0.15 && p.wide < 1.1) this.bk[c] += Math.max(0.4, (this.bkMax - bkNow) * r * (1 + 0.6 * push));
    else if (p.apex < 0.7 && p.wide < 1.1) this.bk[c] += (this.bkMax - bkNow) * r * 0.25;
    // pushing has to pay: slower through here since we started carrying more or braking later — give
    // half of it back (the best ages a little, so worn tyres alone don't undo everything)
    this.bt[c] *= 1.002;
    if (p.time < this.bt[c]) {
      this.bt[c] = p.time;
      this.btCs[c] = csNow;
      this.btBk[c] = bkNow;
    } else if (p.time > this.bt[c] * 1.012) {
      if (csNow > this.btCs[c] + 0.002) this.cs[c] -= 0.5 * (csNow - this.btCs[c]);
      if (bkNow > this.btBk[c] + 1) this.bk[c] -= 0.5 * (bkNow - this.btBk[c]);
    }
    this.cs[c] = Math.max(CS_MIN, Math.min(this.csMax, this.cs[c]));
    this.bk[c] = Math.max(BK_MIN, Math.min(this.bkMax, this.bk[c]));
    if (this.n[c] < 60000) this.n[c]++;
  }
}

/** times a car the AI doesn't drive (the player's) through the corners, for the field's benchmark */
export class CornerClock {
  private c = -1;
  private t0 = 0;
  private clean = false;

  /** every step: where the car is, the race clock, whether it's on the road and racing */
  step(learning: AILearning, s: number, time: number, ok: boolean, who: number) {
    const n = learning.zones.of.length;
    const c = learning.zones.of[Math.floor(((s % n) + n) % n)];
    if (c !== this.c) {
      if (this.c >= 0 && this.clean && time - this.t0 > 0.5) learning.benchmark(this.c, time - this.t0, who);
      this.c = c;
      this.t0 = time;
      // (a pass only counts from the start of the corner's run-in)
      this.clean = c >= 0 && ok;
    }
    if (!ok) this.clean = false;
  }
}

// ------------------------------------------------------------------ the store (localStorage)

const KEY = 'apexgp.ailearn';
const VERSION = 1;
/** a driver's development over a career: the most pace it adds, and how much of the remaining gap a race closes */
const DEV_MAX = 0.005;
const DEV_STEP = 0.06;
/** between visits the details fade: this much of what was learned (above a fresh driver's) is kept */
const KEEP = 0.85;

interface DriverRec {
  /** races driven */
  xp: number;
  /** development: pace gained over the races (0 … DEV_MAX) */
  dev: number;
}
interface CircuitRec {
  /** corners and lap length when it was learned (a different layout starts afresh) */
  k: number;
  len: number;
  /** per driver code: corner speeds (‰ off 1), braking points (dm), clean passes */
  d: Record<string, { c: number[]; b: number[]; n: number[] }>;
}
interface StoreData {
  v: number;
  drivers: Record<string, DriverRec>;
  circuits: Record<string, CircuitRec>;
}

function readStore(): StoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as StoreData;
      if (d && d.v === VERSION && d.drivers && d.circuits) return d;
    }
  } catch {
    /* no storage: everyone starts fresh */
  }
  return { v: VERSION, drivers: {}, circuits: {} };
}

/** a driver as the race sees them: their code, skill and aggression */
export interface LearnDriver {
  code: string;
  skill: number;
  aggression: number;
}

/**
 * The field's knowledge for one race: loaded at the start (from storage when there is any),
 * learned during it, written back at the end.
 */
export class AILearning {
  readonly circuit: string;
  readonly zones: CornerZones;
  readonly level: number;
  private readonly data: StoreData;
  private readonly know = new Map<string, DriverKnowledge>();
  /** the fastest clean pass through each corner today, anyone's (the player's too), and whose (car id) */
  readonly fastest: Float32Array;
  private readonly fastestBy: Int16Array;
  private saved = false;
  private readonly persist: boolean;
  /** Elite / Legend: the drivers arrive from the simulator knowing the circuit (eliteLevel) */
  private readonly elite: number;

  /** `persist`: bring what the drivers learned before (localStorage) and keep what they learn today */
  constructor(circuit: string, profile: RacingProfile, difficulty: number, persist: boolean) {
    this.circuit = circuit;
    this.zones = cornerZones(profile);
    this.level = learnLevel(difficulty);
    this.elite = eliteLevel(difficulty);
    this.persist = persist;
    this.data = persist ? readStore() : { v: VERSION, drivers: {}, circuits: {} };
    this.fastest = new Float32Array(this.zones.count).fill(Infinity);
    this.fastestBy = new Int16Array(this.zones.count).fill(-1);
  }

  private driverRec(code: string): DriverRec {
    return (this.data.drivers[code] ??= { xp: 0, dev: 0 });
  }

  /** races this driver has driven (experience) */
  experience(code: string): number {
    return this.data.drivers[code]?.xp ?? 0;
  }

  /** the pace this driver has developed over their races (multiplier ≥ 1; scaled by the difficulty) */
  devPace(code: string): number {
    const d = this.data.drivers[code];
    return 1 + Math.max(0, Math.min(DEV_MAX, d?.dev ?? 0)) * this.level;
  }

  /** the lap-time effect of what a driver knows of this circuit (multiplier on pace; ~ for a qualifying estimate) */
  knowledgePace(code: string): number {
    const k = this.load(code);
    let sum = 0;
    for (let c = 0; c < k.cs.length; c++) sum += k.cs[c] - 1 + k.bk[c] * 0.0004;
    // (corners are roughly half a lap's time-sensitivity to speed)
    return k.cs.length ? 1 + (0.5 * sum) / k.cs.length : 1;
  }

  /** a driver's knowledge of this circuit, as they arrive (fresh, or what they learned last time here) */
  private load(code: string): DriverKnowledge {
    let k = this.know.get(code);
    if (!k) {
      k = new DriverKnowledge(this.zones);
      this.know.set(code, k);
      const rec = this.data.circuits[this.circuit];
      const mine = rec && rec.k === this.zones.count && rec.len === this.zones.of.length ? rec.d[code] : undefined;
      if (mine && mine.c.length === k.cs.length) {
        for (let c = 0; c < k.cs.length; c++) {
          const cs = 1 + (Number(mine.c[c]) || 0) / 1000;
          const bk = (Number(mine.b[c]) || 0) / 10;
          k.cs[c] = CS_FRESH + (cs - CS_FRESH) * KEEP;
          k.bk[c] = BK_FRESH + (bk - BK_FRESH) * KEEP;
          k.n[c] = Math.min(60000, Math.max(0, Number(mine.n[c]) || 0));
        }
      }
    }
    return k;
  }

  /** a driver's knowledge of this circuit, set up for how they learn (see DriverKnowledge) */
  knowledgeOf(d: LearnDriver): DriverKnowledge {
    const k = this.load(d.code);
    // the driver: talent and experience set how fast lessons sink in, bravery and the difficulty how far they push
    const talent = Math.max(0, Math.min(1, (d.skill - 0.94) / 0.06));
    const xp = Math.min(1, this.experience(d.code) / 40);
    k.rate = 0.2 + 0.2 * talent + 0.1 * xp;
    k.brave = Math.max(0, Math.min(1, d.aggression));
    // (at Elite and Legend the race pace is already the circuit's limit (Race.limitedPace): the
    // headroom left to learn into is a fraction — past it they only overdrive, run wide and collide)
    const room = 1 - 0.7 * this.elite;
    k.csMax = 1 + (0.004 + 0.008 * this.level + 0.002 * k.brave) * room;
    k.bkMax = (2 + 7 * this.level + 2 * k.brave) * room;
    for (let c = 0; c < k.cs.length; c++) {
      // (an Elite or Legend field has done its laps in the simulator: it starts the race close to
      // what it would learn, not a few metres early everywhere)
      if (this.elite > 0) {
        // (to the profile's own speeds and braking points: the race pace is already at the circuit's
        // limit (Race.limitedPace), so what's left to learn is corner by corner, as they race)
        k.cs[c] = Math.max(k.cs[c], CS_FRESH + (1 - CS_FRESH) * this.elite);
        k.bk[c] = Math.max(k.bk[c], BK_FRESH + (1 - BK_FRESH) * this.elite);
      }
      k.cs[c] = Math.min(k.csMax, k.cs[c]);
      k.bk[c] = Math.min(k.bkMax, k.bk[c]);
    }
    return k;
  }

  /** a clean pass through corner c by car `who`: the benchmark for the others */
  benchmark(c: number, time: number, who: number) {
    if (c >= 0 && c < this.fastest.length && time > 0 && time < this.fastest[c]) {
      this.fastest[c] = time;
      this.fastestBy[c] = who;
    }
  }

  /** how much quicker than `time` someone else has been through corner c today (0 … 1, 1 = 3% or more) */
  pushFor(c: number, time: number, who: number): number {
    const f = this.fastest[c];
    return f < Infinity && time > f && this.fastestBy[c] !== who ? Math.min(1, (time / f - 1) / 0.03) : 0;
  }

  /**
   * After the race: every driver who raced (`raced`: their codes) is a race more experienced (and
   * develops a little), and their knowledge of the circuit is kept. Once per race; without storage
   * it's all forgotten.
   */
  save(raced: string[]) {
    if (this.saved || !this.persist) return;
    this.saved = true;
    const old = this.data.circuits[this.circuit];
    const rec: CircuitRec = old && old.k === this.zones.count && old.len === this.zones.of.length ? old : { k: this.zones.count, len: this.zones.of.length, d: {} };
    for (const code of raced) {
      const k = this.know.get(code);
      if (!k) continue;
      rec.d[code] = {
        c: Array.from(k.cs, (x) => Math.round((x - 1) * 1000)),
        b: Array.from(k.bk, (x) => Math.round(x * 10)),
        n: Array.from(k.n),
      };
    }
    this.data.circuits[this.circuit] = rec;
    for (const code of raced) {
      const d = this.driverRec(code);
      d.xp = Math.min(9999, d.xp + 1);
      d.dev = Math.min(DEV_MAX, d.dev + (DEV_MAX - d.dev) * DEV_STEP);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* this session only */
    }
  }
}
