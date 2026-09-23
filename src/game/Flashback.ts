import type { Race } from '../race/Race.ts';

/**
 * Flashback, as in the F1 games: the whole race state is snapshotted four times
 * a second for the last ~12 seconds; the player can rewind and resume from any
 * snapshot. Snapshots copy plain numbers, booleans, strings and number arrays of
 * the race, every competitor, every car's physics and every AI driver.
 */

type Snap = Record<string, unknown>;

const SKIP = new Set(['spec', 'track', 'opts', 'profile', 'cars', 'player', 'entry', 'car', 'ai', 'cpTimes', 'events', 'neighbours', 'input', 'contact', 'assists']);

function snapshotOf(obj: object): Snap {
  const out: Snap = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v;
    else if (Array.isArray(v)) {
      if (v.every((x) => typeof x === 'number' || typeof x === 'string')) out[k] = v.slice();
    } else if (v instanceof Float32Array || v instanceof Float64Array) out[k] = v.slice();
    else if (v === null) out[k] = null;
    else if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) out[k] = { ...(v as object) }; // e.g. pit state
  }
  return out;
}

function restoreInto(obj: object, snap: Snap) {
  const o = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(snap)) {
    const cur = o[k];
    if (Array.isArray(v) && Array.isArray(cur)) {
      cur.length = 0;
      for (const x of v) cur.push(x);
    } else if ((v instanceof Float32Array || v instanceof Float64Array) && (cur instanceof Float32Array || cur instanceof Float64Array) && cur.length === v.length) {
      cur.set(v);
    } else if (v instanceof Float32Array || v instanceof Float64Array) {
      o[k] = v.slice();
    } else if (v && typeof v === 'object' && cur && typeof cur === 'object') {
      Object.assign(cur, v);
    } else o[k] = v;
  }
}

interface RaceSnap {
  t: number;
  race: Snap;
  comps: Snap[];
  cars: Snap[];
  ais: (Snap | null)[];
}

export class Flashback {
  private snaps: RaceSnap[] = [];
  private acc = 0;
  /** seconds of history kept */
  readonly span = 12;

  reset() {
    this.snaps = [];
    this.acc = 0;
  }

  record(dt: number, race: Race) {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this.snaps.push({
      t: race.time,
      race: snapshotOf(race),
      comps: race.cars.map((c) => snapshotOf(c)),
      cars: race.cars.map((c) => snapshotOf(c.car)),
      ais: race.cars.map((c) => (c.ai ? snapshotOf(c.ai) : null)),
    });
    while (this.snaps.length && race.time - this.snaps[0].t > this.span) this.snaps.shift();
  }

  get oldest(): number {
    return this.snaps.length ? this.snaps[0].t : 0;
  }

  get available(): boolean {
    return this.snaps.length > 2;
  }

  /** restore the newest snapshot at or before session time t; returns its time */
  restore(race: Race, t: number): number {
    let s = this.snaps[0];
    for (const x of this.snaps) if (x.t <= t) s = x;
    restoreInto(race, s.race);
    race.cars.forEach((c, i) => {
      restoreInto(c, s.comps[i]);
      restoreInto(c.car, s.cars[i]);
      const a = s.ais[i];
      if (c.ai && a) restoreInto(c.ai, a);
    });
    // drop the future we just rewound away from
    this.snaps = this.snaps.filter((x) => x.t <= s.t);
    return s.t;
  }
}
