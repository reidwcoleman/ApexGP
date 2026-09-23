import type { Track } from '../world/Track.ts';
import { CarPhysics, F1_SPEC, type DriveInput } from '../sim/CarPhysics.ts';
import { AIDriver, type Neighbour } from '../sim/AIDriver.ts';
import { RacingProfile } from '../sim/RacingProfile.ts';
import type { Entry } from './Teams.ts';

/**
 * Race session: grid, start lights, the physics/AI step, timing & scoring,
 * DRS, car-to-car contact, finish.
 */

export type RacePhase = 'grid' | 'lights' | 'racing' | 'finished';
export type RaceMode = 'race' | 'timetrial';

export interface RaceOptions {
  mode: RaceMode;
  laps: number;
  /** multiplies every AI's pace (0.9 easy … 1.0 legend) */
  difficulty: number;
  playerEntry: Entry;
  /** 0-based grid slot for the player */
  playerGrid: number;
  entries: Entry[];
}

export interface Competitor {
  id: number;
  entry: Entry;
  car: CarPhysics;
  ai: AIDriver | null;
  isPlayer: boolean;
  /** laps completed (−1 until the first crossing of the line from the grid) */
  laps: number;
  lapDist: number;
  raceDist: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  lapTimes: number[];
  sector: number;
  sectorStart: number;
  sectorTimes: [number, number, number];
  lastSectors: [number, number, number];
  bestSectors: [number, number, number];
  position: number;
  gapLeader: number;
  gapAhead: number;
  finished: boolean;
  finishTime: number;
  drsEligible: boolean;
  drsZone: number;
  lapValid: boolean;
  penalty: number;
  /** ring of checkpoint pass times (every CP metres) for timing gaps */
  cpTimes: Float64Array;
  cpIndex: number;
  contactTimer: number;
}

export interface RaceEvent {
  kind: 'fastest-lap' | 'personal-best' | 'sector' | 'drs-enabled' | 'track-limits' | 'final-lap' | 'finish' | 'lap' | 'contact' | 'lights-out';
  car: number;
  value?: number;
  sector?: number;
  color?: 'purple' | 'green' | 'yellow';
}

const CP = 20;
const CP_RING = 1024;
const SUBSTEPS = 4;

export class Race {
  readonly track: Track;
  readonly opts: RaceOptions;
  readonly profile: RacingProfile;
  readonly cars: Competitor[] = [];
  readonly player: Competitor;
  phase: RacePhase = 'grid';
  /** seconds since the session started */
  time = 0;
  /** race clock since lights out */
  raceTime = 0;
  lightsLit = 0;
  private lightsTimer = 0;
  private lightsHold = 0;
  bestLap = Infinity;
  bestLapCar = -1;
  bestSectors: [number, number, number] = [Infinity, Infinity, Infinity];
  leaderLaps = 0;
  finishOrder: number[] = [];
  events: RaceEvent[] = [];
  playerInput: DriveInput = { throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false };
  /** player's DRS button edge */
  playerDrsRequest = false;
  /** live delta to the player's best lap (s, NaN until there is one) */
  playerDelta = NaN;
  private deltaCur = new Float32Array(1).fill(-1);
  private deltaBest: Float32Array | null = null;
  private sectorLapDist: [number, number];
  private drsLapDist: { detect: number; start: number; end: number }[];
  private neighbours: Neighbour[] = [];
  private gridStartDist: number[] = [];

  constructor(track: Track, opts: RaceOptions) {
    this.track = track;
    this.opts = opts;
    this.profile = new RacingProfile(track, F1_SPEC);
    this.deltaCur = new Float32Array(Math.ceil(track.length / 10) + 2).fill(-1);
    this.sectorLapDist = [track.lapDistance(track.sectorS[0]), track.lapDistance(track.sectorS[1])];
    this.drsLapDist = track.drs.map((z) => ({ detect: track.lapDistance(z.detect), start: track.lapDistance(z.start), end: track.lapDistance(z.end) }));

    const entries = opts.mode === 'timetrial' ? [opts.playerEntry] : opts.entries;
    // grid order: AI by pace (fastest first), player dropped into their chosen slot
    const ai = entries.filter((e) => e !== opts.playerEntry);
    ai.sort((a, b) => b.team.pace * b.driver.skill - a.team.pace * a.driver.skill);
    const order: Entry[] = ai.slice();
    const pSlot = opts.mode === 'timetrial' ? 0 : Math.max(0, Math.min(order.length, opts.playerGrid));
    order.splice(pSlot, 0, opts.playerEntry);

    order.forEach((entry, i) => {
      const car = new CarPhysics(F1_SPEC);
      const isPlayer = entry === opts.playerEntry;
      if (opts.mode === 'timetrial') {
        // flying lap: start on the pit straight behind the line at speed
        car.placeOnTrack(track, track.startS - 420, track.racingLineAt(track.startS - 420));
      } else {
        const g = track.gridSlot(i);
        car.placeOnTrack(track, g.s, g.lateral);
      }
      let aiDriver: AIDriver | null = null;
      if (!isPlayer) {
        const pace = opts.difficulty * entry.team.pace * (0.975 + entry.driver.skill * 0.025);
        aiDriver = new AIDriver(pace, entry.driver.aggression);
        aiDriver.startFrom(car, track);
        car.allowReverse = false;
      }
      const c: Competitor = {
        id: i,
        entry,
        car,
        ai: aiDriver,
        isPlayer,
        laps: -1,
        lapDist: track.lapDistance(car.s),
        raceDist: 0,
        lapStart: 0,
        lastLap: 0,
        bestLap: Infinity,
        lapTimes: [],
        sector: 0,
        sectorStart: 0,
        sectorTimes: [0, 0, 0],
        lastSectors: [0, 0, 0],
        bestSectors: [Infinity, Infinity, Infinity],
        position: i + 1,
        gapLeader: 0,
        gapAhead: 0,
        finished: false,
        finishTime: 0,
        drsEligible: false,
        drsZone: -1,
        lapValid: true,
        penalty: 0,
        cpTimes: new Float64Array(CP_RING).fill(-1),
        cpIndex: -1,
        contactTimer: 0,
      };
      c.raceDist = c.laps * track.length + c.lapDist;
      this.cars.push(c);
      this.gridStartDist.push(c.lapDist);
    });
    this.player = this.cars.find((c) => c.isPlayer)!;
    if (opts.mode === 'timetrial') {
      this.player.car.vx = 60;
      this.player.car.gear = 7;
      this.player.laps = -1;
      this.phase = 'racing';
    }
  }

  get isTimeTrial() {
    return this.opts.mode === 'timetrial';
  }

  /** begin the start-light sequence */
  startLights() {
    if (this.phase !== 'grid') return;
    this.phase = 'lights';
    this.lightsLit = 0;
    this.lightsTimer = 0;
    this.lightsHold = 0.6 + Math.random() * 2.2;
  }

  update(dt: number) {
    this.events.length = 0;
    this.time += dt;

    if (this.phase === 'lights') {
      this.lightsTimer += dt;
      const lit = Math.min(5, Math.floor(this.lightsTimer / 1.0) + 1);
      if (lit !== this.lightsLit && this.lightsTimer < 5) {
        this.lightsLit = lit;
      }
      if (this.lightsTimer >= 5 + this.lightsHold) {
        this.lightsLit = 0;
        this.phase = 'racing';
        this.raceTime = 0;
        for (const c of this.cars) {
          c.lapStart = 0;
          c.sectorStart = 0;
        }
        for (const c of this.cars) c.car.reverse = false;
        this.events.push({ kind: 'lights-out', car: this.player.id });
      }
    }

    const racing = this.phase === 'racing' || this.phase === 'finished';
    if (racing) this.raceTime += dt;

    const h = dt / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS; k++) {
      this.neighbours.length = 0;
      for (const c of this.cars) this.neighbours.push({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx });
      for (const c of this.cars) {
        const zone = this.drsLapDist[c.drsZone];
        const inZone = !!zone && c.drsEligible && this.inRange(c.lapDist, zone.start, zone.end);
        if (c.isPlayer) {
          const inp = this.playerInput;
          if (this.playerDrsRequest && inZone) c.car.drsOpen = true;
          if (!inZone) c.car.drsOpen = false;
          if (this.phase === 'grid' || this.phase === 'lights') {
            // held on the grid; the throttle only revs the engine
            c.car.step(h, { ...inp, hold: true }, this.track, false);
          } else c.car.step(h, inp, this.track, inZone);
        } else if (c.ai) {
          const aiRacing = this.phase === 'racing' || this.phase === 'finished';
          const reset = c.ai.update(h, c.car, this.track, this.profile, aiRacing, this.neighbours, c.id);
          if (reset) this.resetCar(c);
          c.car.drsOpen = inZone && this.inRange(c.lapDist, zone!.start + 10, zone!.end - 60);
          c.car.step(h, c.ai.input, this.track, inZone);
        }
      }
      this.collideCars();
    }
    this.playerDrsRequest = false;

    for (const c of this.cars) this.scoreCar(c);
    this.rankCars();
  }

  resetCar(c: Competitor) {
    const s = c.car.s - 15;
    c.car.placeOnTrack(this.track, s, this.track.racingLineAt(s));
    c.car.vx = 8;
    c.car.gear = 2;
    c.ai?.startFrom(c.car, this.track);
  }

  private inRange(d: number, a: number, b: number) {
    return a <= b ? d >= a && d <= b : d >= a || d <= b;
  }

  private scoreCar(c: Competitor) {
    const track = this.track;
    const L = track.length;
    const prev = c.lapDist;
    const d = track.lapDistance(c.car.s);
    c.lapDist = d;
    const racing = this.phase === 'racing' || this.phase === 'finished';
    if (!racing) {
      c.raceDist = c.laps * L + d;
      return;
    }
    const t = this.raceTime;
    const crossedLine = prev > L - 60 && d < 60;
    const crossedBack = prev < 60 && d > L - 60;
    if (crossedBack) c.laps--;
    if (crossedLine) {
      c.laps++;
      if (c.laps >= 1) {
        const lapTime = t - c.lapStart;
        c.lastLap = lapTime;
        c.lapTimes.push(lapTime);
        // sector 3 closes with the lap
        this.closeSector(c, 2, t);
        const valid = c.lapValid;
        if (valid && lapTime < c.bestLap) {
          c.bestLap = lapTime;
          if (c.isPlayer) {
            this.deltaBest = this.deltaCur.slice();
            this.deltaBest[this.deltaBest.length - 1] = lapTime;
          }
          if (lapTime < this.bestLap) {
            this.bestLap = lapTime;
            this.bestLapCar = c.id;
            this.events.push({ kind: 'fastest-lap', car: c.id, value: lapTime });
          } else if (c.isPlayer) this.events.push({ kind: 'personal-best', car: c.id, value: lapTime });
        }
        if (c.isPlayer) this.events.push({ kind: 'lap', car: c.id, value: lapTime });
      }
      c.lapStart = t;
      c.sectorStart = t;
      c.sector = 0;
      c.lapValid = true;
      if (!this.isTimeTrial) {
        if (c.laps > this.leaderLaps) this.leaderLaps = c.laps;
        if (c.isPlayer && c.laps === this.opts.laps - 1) this.events.push({ kind: 'final-lap', car: c.id });
        if (!c.finished && (c.laps >= this.opts.laps || (this.phase === 'finished' && c.laps >= 1))) {
          c.finished = true;
          c.finishTime = t + c.penalty;
          // cool-down lap
          if (c.ai) c.ai.pace *= 0.72;
          this.finishOrder.push(c.id);
          if (this.phase !== 'finished') this.phase = 'finished';
          this.events.push({ kind: 'finish', car: c.id });
        }
      }
    }
    // sectors
    if (c.laps >= 0) {
      if (c.sector === 0 && this.crossed(prev, d, this.sectorLapDist[0])) this.closeSector(c, 0, t);
      else if (c.sector === 1 && this.crossed(prev, d, this.sectorLapDist[1])) this.closeSector(c, 1, t);
    }
    // track limits: all four wheels beyond the kerbs
    if (c.car.offTrack && c.car.speed > 15 && c.lapValid && c.laps >= 0) {
      c.lapValid = false;
      if (c.isPlayer) this.events.push({ kind: 'track-limits', car: c.id });
    }
    // DRS detection
    for (let zi = 0; zi < this.drsLapDist.length; zi++) {
      const z = this.drsLapDist[zi];
      if (this.crossed(prev, d, z.detect)) {
        const allowed = this.isTimeTrial || (c.laps >= 1 && !this.cars.some((o) => o.finished));
        const gap = this.gapToAhead(c);
        const was = c.drsEligible;
        c.drsEligible = allowed && (this.isTimeTrial || (gap > 0 && gap < 1.0));
        c.drsZone = zi;
        if (c.isPlayer && c.drsEligible && !was) this.events.push({ kind: 'drs-enabled', car: c.id });
      }
      if (c.drsZone === zi && this.crossed(prev, d, z.end)) {
        c.drsEligible = false;
      }
    }
    // live delta to the player's best lap (lap time sampled every 10 m)
    if (c.isPlayer && c.laps >= 0) {
      if (crossedLine) this.deltaCur.fill(-1);
      const lt = t - c.lapStart;
      const k = Math.min(this.deltaCur.length - 2, Math.floor(d / 10));
      if (this.deltaCur[k] < 0) this.deltaCur[k] = lt;
      const ref = this.deltaBest;
      if (ref && ref[k] >= 0 && ref[k + 1] >= 0) {
        const f = d / 10 - Math.floor(d / 10);
        this.playerDelta = lt - (ref[k] + (ref[k + 1] - ref[k]) * f);
      } else this.playerDelta = NaN;
    }
    // checkpoint timing for gaps
    const cp = Math.floor((c.laps * L + d) / CP);
    if (cp !== c.cpIndex && cp >= 0) {
      for (let k = Math.max(c.cpIndex + 1, cp - 5); k <= cp; k++) c.cpTimes[((k % CP_RING) + CP_RING) % CP_RING] = t;
      c.cpIndex = cp;
    }
    c.raceDist = c.laps * L + d;
  }

  private crossed(prev: number, cur: number, mark: number) {
    if (prev <= cur) return prev < mark && cur >= mark;
    return prev < mark || cur >= mark; // wrapped
  }

  private closeSector(c: Competitor, idx: number, t: number) {
    const st = t - c.sectorStart;
    c.sectorTimes[idx] = st;
    c.lastSectors[idx] = st;
    c.sectorStart = t;
    c.sector = idx + 1;
    if (c.laps < 0) return;
    let color: 'purple' | 'green' | 'yellow' = 'yellow';
    if (c.lapValid && st < this.bestSectors[idx]) {
      this.bestSectors[idx] = st;
      c.bestSectors[idx] = Math.min(c.bestSectors[idx], st);
      color = 'purple';
    } else if (c.lapValid && st < c.bestSectors[idx]) {
      c.bestSectors[idx] = st;
      color = 'green';
    }
    if (c.isPlayer) this.events.push({ kind: 'sector', car: c.id, sector: idx, value: st, color });
  }

  /** time gap to the car directly ahead on the road (s), 0 if none */
  gapToAhead(c: Competitor): number {
    const ahead = this.cars.find((o) => o.position === c.position - 1);
    if (!ahead) return 0;
    return this.timeGap(c, ahead);
  }

  private timeGap(c: Competitor, ahead: Competitor): number {
    if (c.cpIndex < 0) return 0;
    const k = c.cpIndex;
    if (ahead.cpIndex < k) return 0;
    if (ahead.cpIndex - k >= CP_RING - 10) return 999;
    const ta = ahead.cpTimes[((k % CP_RING) + CP_RING) % CP_RING];
    const tc = c.cpTimes[((k % CP_RING) + CP_RING) % CP_RING];
    if (ta < 0 || tc < 0) return 0;
    return Math.max(0, tc - ta);
  }

  private rankCars() {
    const sorted = this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return this.finishOrder.indexOf(a.id) - this.finishOrder.indexOf(b.id);
      if (a.finished !== b.finished) {
        // a finished car is ahead of anyone on the same or fewer laps
        return a.finished ? -1 : 1;
      }
      return b.raceDist - a.raceDist;
    });
    const leader = sorted[0];
    sorted.forEach((c, i) => {
      c.position = i + 1;
      if (i === 0) {
        c.gapLeader = 0;
        c.gapAhead = 0;
      } else {
        const ahead = sorted[i - 1];
        const lapsDown = Math.floor((leader.raceDist - c.raceDist) / this.track.length);
        c.gapLeader = lapsDown >= 1 && !c.finished ? -lapsDown : c.finished && leader.finished ? c.finishTime - leader.finishTime : this.timeGap(c, leader);
        c.gapAhead = this.timeGap(c, ahead);
      }
    });
  }

  /** two circles per car along its heading; equal-mass impulse + separation */
  private collideCars() {
    const cars = this.cars;
    const R = 0.98;
    const OFF = 1.35;
    for (let i = 0; i < cars.length; i++) {
      const A = cars[i].car;
      for (let j = i + 1; j < cars.length; j++) {
        const B = cars[j].car;
        const dxc = A.x - B.x;
        const dzc = A.z - B.z;
        if (dxc * dxc + dzc * dzc > 49) continue;
        const sa = Math.sin(A.yaw), ca = Math.cos(A.yaw);
        const sb = Math.sin(B.yaw), cb = Math.cos(B.yaw);
        let hit = false;
        for (const oa of [OFF, -OFF]) {
          for (const ob of [OFF, -OFF]) {
            const ax = A.x + sa * oa, az = A.z + ca * oa;
            const bx = B.x + sb * ob, bz = B.z + cb * ob;
            let nx = ax - bx, nz = az - bz;
            const d = Math.hypot(nx, nz);
            if (d >= R * 2 || d < 1e-4) continue;
            nx /= d;
            nz /= d;
            const pen = R * 2 - d;
            A.x += nx * pen * 0.5;
            A.z += nz * pen * 0.5;
            B.x -= nx * pen * 0.5;
            B.z -= nz * pen * 0.5;
            const [avx, avz] = A.worldVelocity();
            const [bvx, bvz] = B.worldVelocity();
            const rel = (avx - bvx) * nx + (avz - bvz) * nz;
            if (rel < 0) {
              const jimp = (-(1 + 0.25) * rel) / 2;
              A.setWorldVelocity(avx + jimp * nx, avz + jimp * nz);
              B.setWorldVelocity(bvx - jimp * nx, bvz - jimp * nz);
              // off-centre hits rotate the cars
              const torqueA = (oa > 0 ? 1 : -1) * (nx * ca - nz * sa) * jimp * 0.05;
              const torqueB = (ob > 0 ? 1 : -1) * (-nx * cb + nz * sb) * jimp * 0.05;
              A.r += torqueA;
              B.r += torqueB;
              hit = true;
              if (-rel > 2) {
                const strength = -rel;
                if (cars[i].isPlayer || cars[j].isPlayer) this.events.push({ kind: 'contact', car: cars[i].isPlayer ? i : j, value: strength });
              }
            }
          }
        }
        if (hit) {
          cars[i].contactTimer = 0.3;
          cars[j].contactTimer = 0.3;
        }
      }
    }
  }

  /** classification rows for the results screen */
  classification() {
    const L = this.track.length;
    return this.cars
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        pos: c.position,
        entry: c.entry,
        isPlayer: c.isPlayer,
        laps: Math.max(0, c.laps),
        time: c.finished ? c.finishTime : NaN,
        gap: c.position === 1 ? 0 : c.gapLeader,
        best: c.bestLap,
        penalty: c.penalty,
        fastest: c.id === this.bestLapCar,
        raceDist: c.raceDist / L,
      }));
  }
}

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
