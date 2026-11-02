import type { Competitor, Race, RaceNet } from '../race/Race.ts';
import type { Compound } from '../race/Pit.ts';

/**
 * An online race's car states. Each machine simulates its own car (and the host its AI cars) and
 * sends them 30 times a second; every other car is placed from the latest state it got, carried
 * forward by its age on the shared session clock (dead reckoning: the car keeps its speed and yaw
 * rate), with the jump a new state makes eased out over a few frames. Laps, lap times, the flag and
 * retirements are the owner's word.
 */

/** floats per car */
export const STRIDE = 32;
const SEND_HZ = 30;
const COMPOUND_IDX: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const F = { DRS: 1, RETIRED: 2, FINISHED: 4, GHOST: 8, REVERSE: 16, OFF: 32, KERB: 64, PIT: 128 } as const;

interface Rec {
  /** session time of the sample */
  t: number;
  d: Float32Array;
  /** the eased-out jump (world metres / radians) */
  ox: number;
  oz: number;
  oyaw: number;
  fresh: boolean;
}

export interface SyncOpts {
  host: boolean;
  /** the session clock (s) */
  now: () => number;
  /** session time origin of the race (states carry time since it, so float32 keeps ms) */
  epoch: number;
  /** guest: own car to the host; host: every car to every guest */
  send: (buf: Float32Array) => void;
  /** the owner of each car by competitor id ('' = AI) */
  owners: string[];
  /** session time the lights start, and how long they hold after the fifth */
  lightsAt: number;
  hold: number;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class RaceSync implements RaceNet {
  private readonly recs = new Map<number, Rec>();
  private sendT = 0;
  private buf: Float32Array;
  /** the last time a state for each remote car arrived (session s) */
  readonly heard = new Map<number, number>();

  constructor(readonly race: Race, readonly o: SyncOpts) {
    this.buf = new Float32Array(STRIDE * race.cars.length);
  }

  /** states from the network (any number of cars) */
  receive(b: Float32Array) {
    const race = this.race;
    for (let k = 0; k + STRIDE <= b.length; k += STRIDE) {
      const id = b[k] | 0;
      const c = race.cars[id];
      if (!c || !c.remote) continue;
      const t = b[k + 1];
      let r = this.recs.get(id);
      if (r && t <= r.t) continue;
      if (!r) this.recs.set(id, (r = { t, d: new Float32Array(STRIDE), ox: 0, oz: 0, oyaw: 0, fresh: true }));
      else {
        // (where the car is drawn now, against where the new state puts it now: eased out)
        const was = { x: c.car.x, z: c.car.z, yaw: c.car.yaw };
        r.t = t;
        r.d.set(b.subarray(k, k + STRIDE));
        const p = this.predict(r);
        r.ox = was.x - p.x;
        r.oz = was.z - p.z;
        r.oyaw = wrap(was.yaw - p.yaw);
        if (r.ox * r.ox + r.oz * r.oz > 144 || Math.abs(r.oyaw) > 1.2) r.ox = r.oz = r.oyaw = 0;
        this.heard.set(id, this.o.now());
        continue;
      }
      r.d.set(b.subarray(k, k + STRIDE));
      this.heard.set(id, this.o.now());
    }
  }

  /** the host relays the guests' cars: their latest raw states */
  latest(id: number): Float32Array | null {
    return this.recs.get(id)?.d ?? null;
  }

  private predict(r: Rec) {
    const d = r.d;
    const age = Math.max(0, Math.min(0.4, this.o.now() - this.o.epoch - r.t));
    let x = d[2], z = d[3], yaw = d[4];
    const vx = d[5], vy = d[6], yr = d[7];
    const n = Math.max(1, Math.ceil(age / 0.02));
    const h = age / n;
    for (let i = 0; i < n; i++) {
      yaw += yr * h;
      const s = Math.sin(yaw), cs = Math.cos(yaw);
      x += (vx * s + vy * cs) * h;
      z += (vx * cs - vy * s) * h;
    }
    return { x, z, yaw };
  }

  before(race: Race, dt: number) {
    // (frames that took too long are clamped: every machine's lights and race clock follow the
    // session clock instead, so the start and the lap times agree)
    const since = this.o.now() - this.o.lightsAt;
    race.syncLights(since, since - 5 - this.o.hold);
    const ease = Math.exp(-dt * 7);
    const L = race.track.length;
    for (const [id, r] of this.recs) {
      const c = race.cars[id];
      if (!c || c.removed) continue;
      const d = r.d;
      const car = c.car;
      const p = this.predict(r);
      r.ox *= ease;
      r.oz *= ease;
      r.oyaw *= ease;
      car.x = p.x + r.ox;
      car.z = p.z + r.oz;
      car.yaw = wrap(p.yaw + r.oyaw);
      car.vx = d[5];
      car.vy = d[6];
      car.r = d[7];
      car.steer = d[8];
      car.wheelAngleF = d[9];
      car.wheelAngleR = d[10];
      car.rpm = d[11];
      car.gear = d[12];
      car.throttle = d[13];
      car.brake = d[14];
      const fl = d[15] | 0;
      car.drsOpen = !!(fl & F.DRS);
      car.reverse = !!(fl & F.REVERSE);
      car.offTrack = !!(fl & F.OFF);
      car.onKerb = !!(fl & F.KERB);
      car.drsAnim = d[23];
      car.ax = d[24];
      car.ay = d[25];
      car.pitch = d[26];
      car.roll = d[27];
      car.heave = d[28];
      car.brakeHeat = d[29];
      for (let i = 0; i < 4; i++) car.omega[i] = car.vx / car.spec.wheelR;
      const pr = race.track.project(car.x, car.z, car.hint);
      car.hint = pr.index;
      car.s = pr.s;
      car.lateral = pr.lateral;
      car.relYaw = wrap(car.yaw - race.track.frame(car.s).heading);
      c.netGhost = !!(fl & (F.GHOST | F.PIT));
      this.score(c, d, fl, L);
      r.fresh = false;
    }
  }

  private score(c: Competitor, d: Float32Array, fl: number, L: number) {
    const race = this.race;
    // laps: the owner's count, corrected when the carried-forward car has crossed the line already
    let laps = d[16] | 0;
    const dNow = race.track.lapDistance(c.car.s);
    const dRec = d[17];
    if (dRec > L - 300 && dNow < 300) laps++;
    else if (dRec < 300 && dNow > L - 300) laps--;
    if (!c.finished) c.laps = laps;
    const last = d[18];
    if (last > 0 && Math.abs(last - c.lastLap) > 1e-3) {
      c.lastLap = last;
      c.lapTimes.push(last);
    }
    const best = d[19] > 0 ? d[19] : Infinity;
    c.bestLap = best;
    if (best < race.bestLap - 1e-4) {
      race.bestLap = best;
      race.bestLapCar = c.id;
      race.pendingEvents.push({ kind: 'fastest-lap', car: c.id, value: best });
    }
    c.penalty = d[21];
    const comp = COMPOUND_IDX[d[22] | 0] ?? 'medium';
    if (comp !== c.compound) {
      c.compound = comp;
      if (!c.compoundsUsed.includes(comp)) c.compoundsUsed.push(comp);
    }
    if (fl & F.RETIRED && !c.retired) {
      c.retired = true;
      c.retiredAt = race.raceTime;
      c.drsEligible = false;
      race.pendingEvents.push({ kind: 'retired', car: c.id, value: 0 });
    }
    // (at the flag the owner's own count stands: the drawn car may still be just short of the line)
    if (fl & F.FINISHED && !c.finished) this.finish(c, d[20], d[16] | 0);
  }

  /** the owner says this car took the flag (race time incl. penalties) */
  finish(c: Competitor, time: number, laps: number) {
    const race = this.race;
    if (c.finished) return;
    c.finished = true;
    c.finishTime = time;
    c.laps = laps;
    race.finishOrder.push(c.id);
    race.finishOrder.sort((a, b) => race.cars[b].laps - race.cars[a].laps || race.cars[a].finishTime - race.cars[b].finishTime);
    if (race.phase === 'racing') race.phase = 'finished';
    race.pendingEvents.push({ kind: 'finish', car: c.id });
  }

  after(race: Race, dt: number) {
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const t = this.o.now() - this.o.epoch;
    let n = 0;
    for (const c of race.cars) {
      if (c.removed && !c.isPlayer) continue;
      if (c.remote) {
        // the host passes the guests' cars on as they came in
        if (!this.o.host) continue;
        const raw = this.latest(c.id);
        if (raw) this.buf.set(raw, STRIDE * n++);
        continue;
      }
      // own car, and on the host every AI car
      if (!c.isPlayer && !this.o.host) continue;
      this.pack(c, t, STRIDE * n++);
    }
    if (n) this.o.send(this.buf.subarray(0, STRIDE * n));
  }

  private pack(c: Competitor, t: number, k: number) {
    const b = this.buf;
    const car = c.car;
    b[k] = c.id;
    b[k + 1] = t;
    b[k + 2] = car.x;
    b[k + 3] = car.z;
    b[k + 4] = car.yaw;
    b[k + 5] = car.vx;
    b[k + 6] = car.vy;
    b[k + 7] = car.r;
    b[k + 8] = car.steer;
    b[k + 9] = car.wheelAngleF;
    b[k + 10] = car.wheelAngleR;
    b[k + 11] = car.rpm;
    b[k + 12] = car.gear;
    b[k + 13] = car.throttle;
    b[k + 14] = car.brake;
    const ghost = c.pitGhost > 0 || c.resetGhost > 0 || c.pitApproach;
    b[k + 15] =
      (car.drsOpen ? F.DRS : 0) |
      (c.retired ? F.RETIRED : 0) |
      (c.finished ? F.FINISHED : 0) |
      (ghost ? F.GHOST : 0) |
      (car.reverse ? F.REVERSE : 0) |
      (car.offTrack ? F.OFF : 0) |
      (car.onKerb ? F.KERB : 0) |
      (c.pit.phase !== 'none' ? F.PIT : 0);
    b[k + 16] = c.laps;
    b[k + 17] = c.lapDist;
    b[k + 18] = c.lastLap;
    b[k + 19] = Number.isFinite(c.bestLap) ? c.bestLap : 0;
    b[k + 20] = c.finished ? c.finishTime : 0;
    b[k + 21] = c.penalty;
    b[k + 22] = Math.max(0, COMPOUND_IDX.indexOf(c.compound));
    b[k + 23] = car.drsAnim;
    b[k + 24] = car.ax;
    b[k + 25] = car.ay;
    b[k + 26] = car.pitch;
    b[k + 27] = car.roll;
    b[k + 28] = car.heave;
    b[k + 29] = car.brakeHeat;
    b[k + 30] = car.wingDamage;
    b[k + 31] = c.position;
  }
}
